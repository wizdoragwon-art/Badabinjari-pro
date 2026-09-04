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
  const names = (spot.boats || []).map((b) => b.name);
  const days = spot.days || 28;          // 커버할 기간(일)
  const p2 = (n) => String(n).padStart(2, "0");
  const merged = new Map();               // "ymd|boat" → slot (중복 제거)
  const today = new Date();

  // 한 페이지가 약 8일치만 보여주므로, 7일 간격 앵커로 여러 페이지를 긁는다
  for (let off = 0; off < days; off += 7) {
    const d = new Date(today); d.setDate(today.getDate() + off);
    const url = `${spot.reserveUrl}&year=${d.getFullYear()}&month=${p2(d.getMonth() + 1)}&day=${p2(d.getDate())}`;
    let html;
    try { html = await fetchText(url, spot.name); }
    catch (e) {
      const cause = e && e.cause ? ` (${e.cause.code || e.cause.message || ""})` : "";
      console.error(`[${spot.name}] fetch 실패 @${p2(d.getMonth()+1)}/${p2(d.getDate())}: ${e.message}${cause}`);
      continue;
    }
    const slots = parseReservation(html, names, `${spot.name} ${p2(d.getMonth()+1)}/${p2(d.getDate())}`);
    for (const s of slots) merged.set(`${s.ymd}|${s.boat}`, { ...s, url: spot.reserveUrl });
  }
  const out = [...merged.values()];
  console.log(`[${spot.name}] 총 슬롯 ${out.length}건 (${days}일 커버)`);
  return out;
}

// 재시도(3회) + 20초 타임아웃 + 상세 원인
async function fetchText(url, label) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "ko", "Accept": "text/html,application/xhtml+xml,*/*" },
        signal: ctrl.signal, redirect: "follow",
      });
      clearTimeout(to);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      clearTimeout(to); lastErr = e;
      if (i < 2) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
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
      const rm = b.body.match(/\[\[REMAIN:(\d+)\]\]/);       // 남은자리 이미지 숫자
      const remain = rm ? parseInt(rm[1], 10) : null;
      const dokbae = /\[독배\]/.test(b.body);
      const soldout = /예약완료|예약마감|\[\[SOLDOUT\]\]/.test(b.body) || dokbae;
      const { species, dep } = noticeInfo(b.body);
      capSeen[b.name] = Math.max(capSeen[b.name] || 0, seats.size ? Math.max(...seats) : 0);
      raw.push({ ...heads[i], boat: b.name, seats, remain, dokbae, soldout, species, dep });
    }
  }
  if (label) console.log(`  [${label}] 배매칭 ${matchedBoats}회, raw ${raw.length}건`);

  const p2 = (n) => String(n).padStart(2, "0");
  return raw.map((r) => {
    const cfgCap = (knownBoats.__cap && knownBoats.__cap[r.boat]) || 0;
    const cap = Math.max(capSeen[r.boat] || 0, cfgCap, r.seats.size, (r.remain || 0) + r.seats.size);
    // 잔여석: 이미지 숫자가 있으면 그대로, 없으면 좌석표(정원-예약) 폴백
    const open = r.dokbae ? 0 : (r.remain != null ? r.remain : (r.soldout ? 0 : Math.max(0, cap - r.seats.size)));
    return { boat: r.boat, species: r.species, date: `${r.mo}/${r.d}`,
      ymd: `${r.y}-${p2(r.mo)}-${p2(r.d)}`, dow: r.dow, dep: r.dep, open, cap, mul: r.mul };
  });
}

function stripToText(html) {
  return String(html)
    .replace(/<img[^>]*?r_x_(\d+)\.gif[^>]*?>/gi, " [[REMAIN:$1]] ")
    .replace(/r_x_(\d+)\.gif/gi, " [[REMAIN:$1]] ")
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
