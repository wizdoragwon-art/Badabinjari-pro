// lib/thefishing.js
// 더피싱(thefishing.kr / myfishmap) 플랫폼 예약현황(mid=bk) 실제 파서.
//
//  페이지 구조(관찰됨):
//   · 날짜 섹션 헤더:  "2026년 09월 01일, 화요일, 11물"   (물때 포함)
//   · 각 배 행:  선박명 / 공지(어종·출항시각) / 입금자 목록 / 남은자리
//   · 입금자 표기:  "김*선님(3명/10,9,8)"  ← 예약된 좌석번호
//   · 마감 표시:  남은자리 칸에 r_x_0.gif (예약완료) 이미지
//   · [독배] = 배 전체 대절 → 마감
//
//  잔여석 = (그 배의 정원) − (예약된 좌석번호의 개수)
//   · 정원은 좌석표에서 관찰된 최대 좌석번호로 자동 추정(여러 날 중 만석일 때 드러남)
//   · 남은자리 칸이 '예약완료'거나 [독배]면 0으로 확정
//
//  반환(표준 슬롯): { boat, species, date:"9/6", dow:"토", dep:"06:00",
//                    open, cap, mul, url }

const MOCK = process.env.MOCK === "1";
const UA = "Mozilla/5.0 (compatible; BinjariBot/0.1; personal use)";

export async function fetchAvailability(spot) {
  if (MOCK) return mockSlots(spot);
  const res = await fetch(spot.reserveUrl, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${spot.reserveUrl}`);
  const html = await res.text();
  const slots = parseReservation(html, (spot.boats || []).map((b) => b.name));
  return slots.map((s) => ({ ...s, url: spot.reserveUrl }));
}

// ── 핵심 파서 (태그 제거된 텍스트 기준) ─────────────────
export function parseReservation(html, knownBoats = []) {
  const text = stripToText(html);

  // 날짜 섹션 분리
  const dateRe = /(\d{4})년\s*0?(\d{1,2})월\s*0?(\d{1,2})일,\s*([일월화수목금토])요일,\s*([가-힣0-9]+)/g;
  const heads = [];
  let m;
  while ((m = dateRe.exec(text)) !== null) {
    heads.push({ idx: m.index, y: +m[1], mo: +m[2], d: +m[3], dow: m[4], mul: m[5] });
  }
  if (!heads.length) return [];

  // 1차 파스: 배별로 (날짜→예약좌석/마감) 수집, 동시에 정원(최대좌석) 추정
  const raw = []; // {y,mo,d,dow,mul, boat, seats:Set, soldout, species, dep}
  const capSeen = {};
  for (let i = 0; i < heads.length; i++) {
    const seg = text.slice(heads[i].idx, i + 1 < heads.length ? heads[i + 1].idx : text.length);
    const boats = splitBoats(seg, knownBoats);
    for (const b of boats) {
      const seats = seatSet(b.body);
      const soldout = /\[\[SOLDOUT\]\]/.test(b.body) || /\[독배\]/.test(b.body);
      const { species, dep } = noticeInfo(b.body);
      capSeen[b.name] = Math.max(capSeen[b.name] || 0, seats.size ? Math.max(...seats) : 0);
      raw.push({ ...heads[i], boat: b.name, seats, soldout, species, dep });
    }
  }

  // 2차: 정원으로 잔여석 확정
  const DOWs = ["일", "월", "화", "수", "목", "금", "토"];
  return raw.map((r) => {
    const cap = capSeen[r.boat] || r.seats.size;
    const taken = r.seats.size;
    const open = r.soldout ? 0 : Math.max(0, cap - taken);
    const p2 = (n) => String(n).padStart(2, "0");
    return {
      boat: r.boat,
      species: r.species,
      date: `${r.mo}/${r.d}`,
      ymd: `${r.y}-${p2(r.mo)}-${p2(r.d)}`,
      dow: r.dow,
      dep: r.dep,
      open, cap,
      mul: r.mul,
    };
  });
}

// HTML → 텍스트. 남은자리 '예약완료' 이미지는 [[SOLDOUT]] 토큰으로 보존.
function stripToText(html) {
  return String(html)
    .replace(/<img[^>]*r_x_0\.gif[^>]*>/gi, " [[SOLDOUT]] ")
    .replace(/r_x_0\.gif/gi, " [[SOLDOUT]] ")   // 마크다운/텍스트 폴백
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// 한 날짜 구간을 배별 블록으로 분리.
// 각 배 블록은 남은자리 토큰([[SOLDOUT]] 또는 숫자)으로 끝난다는 점을 이용하되,
// 배 이름 경계는 알려진 배 목록으로 잡는다(설정/드롭다운 기반).
function splitBoats(seg, knownBoats) {
  let names = knownBoats.slice();
  if (!names.length) names = boatNamesFromDropdown(seg);
  // 이름 등장 위치로 경계 산정
  const marks = [];
  for (const n of names) {
    let from = 0, p;
    while ((p = seg.indexOf(n, from)) !== -1) { marks.push({ i: p, name: n }); from = p + n.length; }
  }
  marks.sort((a, b) => a.i - b.i);
  // 예약현황 표 영역만: 첫 날짜 헤더 이후 첫 배부터
  const out = [];
  for (let k = 0; k < marks.length; k++) {
    const start = marks[k].i + marks[k].name.length;
    const end = k + 1 < marks.length ? marks[k + 1].i : seg.length;
    const body = seg.slice(start, end);
    // 예약현황 신호(입금/공지/출항/독배/SOLDOUT)가 있는 블록만 채택 → 드롭다운·링크 중복 제거
    if (/입금|출항|공지|독배|\[\[SOLDOUT\]\]|명\//.test(body)) out.push({ name: marks[k].name, body });
  }
  // 같은 배가 한 날짜에 여러 번 잡히면 첫 유효 블록만
  const seen = new Set();
  return out.filter((b) => (seen.has(b.name) ? false : (seen.add(b.name), true)));
}

function boatNamesFromDropdown(seg) {
  // "선박선택 만석호 낚시대회 헌터호 ... 헤르메스호" 패턴에서 이름 추출(폴백)
  const m = seg.match(/선박선택\s+([가-힣0-9()\s]+?)\s+(?:리스트형|캘린더형|◀|\d{4}년)/);
  if (!m) return [];
  return m[1].split(/\s+/).filter((s) => /호|낚시대회/.test(s));
}

// "이름님(N명/1,2,3)" 들에서 예약 좌석번호 집합
function seatSet(body) {
  const set = new Set();
  const re = /\((\d+)명\/([0-9,\s]+)\)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    m[2].split(",").forEach((x) => { const n = parseInt(x.trim(), 10); if (n) set.add(n); });
  }
  return set;
}

// 공지에서 어종·출항시각
function noticeInfo(body) {
  const species = [];
  if (/쭈꾸미/.test(body)) species.push("쭈꾸미");
  if (/갑오징어/.test(body)) species.push("갑오징어");
  if (/백조기/.test(body)) species.push("백조기");
  if (/우럭/.test(body)) species.push("우럭");
  if (/광어/.test(body)) species.push("광어");
  if (/참돔/.test(body)) species.push("참돔");
  if (/농어/.test(body)) species.push("농어");
  let dep = "";
  let d = body.match(/[▶▣]?\s*출항\s*[:：]?\s*0?(\d{1,2})\s*[시:]/);
  if (!d) d = body.match(/▶\s*0?(\d{1,2})\s*시/);
  if (d) dep = `${String(d[1]).padStart(2, "0")}:00`;
  return { species: species.length ? species : ["기타"], dep };
}

// ── 오프라인 검증용 MOCK ────────────────────────────
function rnd(a, b) { const x = Math.sin(a * 928.13 + b * 47.71) * 10000; return x - Math.floor(x); }
function mockSlots(spot) {
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
  const boats = spot.boats?.length ? spot.boats : [{ name: "1호선", cap: 20, dep: "일출" }];
  const out = []; const today = new Date();
  for (let d = 0; d < 7; d++) {
    const day = new Date(today); day.setDate(today.getDate() + d);
    for (let bi = 0; bi < boats.length; bi++) {
      const b = boats[bi]; const r = rnd(day.getDate() + d * 3, bi + (spot.uid || 1));
      const open = r < 0.55 ? 0 : Math.min(b.cap, Math.ceil(r * 8));
      const p2 = (n) => String(n).padStart(2, "0");
      out.push({ boat: b.name, species: [(spot.species || ["쭈꾸미"])[0]], date: `${day.getMonth() + 1}/${day.getDate()}`,
        ymd: `${day.getFullYear()}-${p2(day.getMonth() + 1)}-${p2(day.getDate())}`,
        dow: DOW[day.getDay()], dep: b.dep || "06:00", open, cap: b.cap, mul: "-", url: spot.reserveUrl });
    }
  }
  return out;
}
