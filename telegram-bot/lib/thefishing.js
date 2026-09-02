// lib/thefishing.js
// 더피싱(thefishing.kr / myfishmap) 플랫폼 예약현황(mid=bk) 파서.
// PC/모바일 두 형식 모두 대응:
//   PC   : "2026년 09월 01일, 화요일, 11물"
//   모바일: "2026년 09월 19일 (토요일)" + 물때(무시)  ← 괄호 형식
// 좌석: "이름님(15 명/15,14,...)"  ← 숫자와 '명' 사이 공백 허용
// 마감: 남은자리에 '예약완료'/'예약마감' 또는 r_x_0.gif, [독배]

const MOCK = process.env.MOCK === "1";
const UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36";

export async function fetchAvailability(spot) {
  if (MOCK) return mockSlots(spot);
  const res = await fetch(spot.reserveUrl, { headers: { "User-Agent": UA, "Accept-Language": "ko" } });
  console.log(`[${spot.name}] HTTP ${res.status}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${spot.reserveUrl}`);
  const html = await res.text();
  console.log(`[${spot.name}] HTML ${html.length}자`);
  const slots = parseReservation(html, (spot.boats || []).map((b) => b.name), spot.name);
  console.log(`[${spot.name}] 슬롯 ${slots.length}건`);
  return slots.map((s) => ({ ...s, url: spot.reserveUrl }));
}

export function parseReservation(html, knownBoats = [], label = "") {
  const text = stripToText(html);

  // 날짜 헤더: 쉼표형 / 괄호형 모두 + 물때(선택)
  const dateRe = /(\d{4})년\s*0?(\d{1,2})월\s*0?(\d{1,2})일\s*,?\s*\(?\s*([일월화수목금토])요일\s*\)?\s*,?\s*([0-9]{1,2}물|조금|무시|사리|대객기|한객기|[가-힣]{1,4}물)?/g;
  const heads = [];
  let m;
  while ((m = dateRe.exec(text)) !== null) {
    heads.push({ idx: m.index, y: +m[1], mo: +m[2], d: +m[3], dow: m[4], mul: m[5] || "-" });
  }
  if (label) console.log(`  [${label}] 날짜 ${heads.length}개 발견`);
  if (!heads.length) {
    if (label) console.log(`  [${label}] 날짜 미발견 — 앞부분: ${text.slice(0, 120)}`);
    return [];
  }

  const raw = [];
  const capSeen = {};
  let matchedBoats = 0;
  for (let i = 0; i < heads.length; i++) {
    const seg = text.slice(heads[i].idx, i + 1 < heads.length ? heads[i + 1].idx : text.length);
    const boats = splitBoats(seg, knownBoats);
    matchedBoats += boats.length;
    for (const b of boats) {
      const seats = seatSet(b.body);
      const soldout = /예약완료|예약마감|\[\[SOLDOUT\]\]|\[독배\]/.test(b.body);
      const { species, dep } = noticeInfo(b.body);
      capSeen[b.name] = Math.max(capSeen[b.name] || 0, seats.size ? Math.max(...seats) : 0);
      raw.push({ ...heads[i], boat: b.name, seats, soldout, species, dep });
    }
  }
  if (label) console.log(`  [${label}] 배매칭 ${matchedBoats}회, raw ${raw.length}건`);

  const p2 = (n) => String(n).padStart(2, "0");
  return raw.map((r) => {
    const cfgCap = (knownBoats.__cap && knownBoats.__cap[r.boat]) || 0;
    const cap = Math.max(capSeen[r.boat] || 0, cfgCap, r.seats.size);
    const taken = r.seats.size;
    const open = r.soldout ? 0 : Math.max(0, cap - taken);
    return { boat: r.boat, species: r.species, date: `${r.mo}/${r.d}`,
      ymd: `${r.y}-${p2(r.mo)}-${p2(r.d)}`, dow: r.dow, dep: r.dep, open, cap, mul: r.mul };
  });
}

function stripToText(html) {
  return String(html)
    .replace(/<img[^>]*r_x_0\.gif[^>]*>/gi, " [[SOLDOUT]] ")
    .replace(/r_x_0\.gif/gi, " [[SOLDOUT]] ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// 배 이름 경계: 설정 배 이름(괄호 suffix는 떼고도 매칭)으로 위치를 잡는다.
function splitBoats(seg, knownBoats) {
  const names = (knownBoats && knownBoats.length) ? knownBoats : [];
  const marks = [];
  for (const full of names) {
    const base = String(full).replace(/\s*\([^)]*\)\s*$/, "").trim(); // "골드피싱(20)"→"골드피싱"
    for (const needle of [full, base]) {
      if (!needle) continue;
      let from = 0, p;
      while ((p = seg.indexOf(needle, from)) !== -1) { marks.push({ i: p, name: full, len: needle.length }); from = p + needle.length; }
    }
  }
  marks.sort((a, b) => a.i - b.i);
  const out = [];
  for (let k = 0; k < marks.length; k++) {
    const start = marks[k].i + marks[k].len;
    const end = k + 1 < marks.length ? marks[k + 1].i : seg.length;
    const body = seg.slice(start, end);
    if (/입금|출항|공지|독배|예약완료|예약마감|\[\[SOLDOUT\]\]|명\s*\//.test(body)) out.push({ name: marks[k].name, body });
  }
  const seen = new Set();
  return out.filter((b) => (seen.has(b.name) ? false : (seen.add(b.name), true)));
}

// "이름님(15 명/1,2,3)" — 숫자와 '명' 사이 공백 허용
function seatSet(body) {
  const set = new Set();
  const re = /\(\s*\d+\s*명\s*\/\s*([0-9,\s]+)\)/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    m[1].split(",").forEach((x) => { const n = parseInt(x.trim(), 10); if (n) set.add(n); });
  }
  return set;
}

function noticeInfo(body) {
  const species = [];
  for (const s of ["쭈꾸미", "갑오징어", "백조기", "우럭", "광어", "참돔", "농어", "갈치"]) if (body.includes(s)) species.push(s);
  let dep = "";
  let d = body.match(/[▶▣]\s*0?(\d{1,2})\s*시/) || body.match(/출항\s*[:：]?\s*0?(\d{1,2})\s*시/);
  if (d) dep = `${String(d[1]).padStart(2, "0")}:00`;
  return { species: species.length ? species : ["기타"], dep };
}

function rnd(a, b) { const x = Math.sin(a * 928.13 + b * 47.71) * 10000; return x - Math.floor(x); }
function mockSlots(spot) {
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
  const boats = spot.boats?.length ? spot.boats : [{ name: "1호선", cap: 20, dep: "일출" }];
  const out = []; const today = new Date();
  for (let d = 0; d < 7; d++) {
    const day = new Date(today); day.setDate(today.getDate() + d);
    const p2 = (n) => String(n).padStart(2, "0");
    for (let bi = 0; bi < boats.length; bi++) {
      const b = boats[bi]; const r = rnd(day.getDate() + d * 3, bi + (spot.uid || 1));
      const open = r < 0.55 ? 0 : Math.min(b.cap, Math.ceil(r * 8));
      out.push({ boat: b.name, species: [(spot.species || ["쭈꾸미"])[0]], date: `${day.getMonth() + 1}/${day.getDate()}`,
        ymd: `${day.getFullYear()}-${p2(day.getMonth() + 1)}-${p2(day.getDate())}`,
        dow: DOW[day.getDay()], dep: b.dep || "06:00", open, cap: b.cap, mul: "-", url: spot.reserveUrl });
    }
  }
  return out;
}
