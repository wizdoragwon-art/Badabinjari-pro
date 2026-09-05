// lib/thefishing2.js
// 더피싱 플랫폼 실시간예약 페이지 (thefishing.kr/reservation/list.php?uid=XXXX)
//   ?mid=bk 좌석표와 달리, 날짜별로 "남은인원 N명" 또는 "예약완료"를 직접 제공.
//
//   예: https://thefishing.kr/reservation/list.php?uid=3515  (예린호)
//   현재 달 기준으로 조회됩니다(월 이동은 JS라 기본 달만 수집).
//
//   반환(표준 슬롯): { boat, species, date, ymd, dow, dep, open, cap, mul, url }

const MOCK = process.env.MOCK === "1";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const DOWNUM = { "일": 0, "월": 1, "화": 2, "수": 3, "목": 4, "금": 5, "토": 6 };
const p2 = (n) => String(n).padStart(2, "0");

export async function fetchAvailability(spot) {
  if (MOCK) return mockSlots(spot);
  const boatName = (spot.boats && spot.boats[0] && spot.boats[0].name) || spot.name;
  const cfgCap = (spot.boats && spot.boats[0] && spot.boats[0].cap) || 0;
  const dep = (spot.boats && spot.boats[0] && spot.boats[0].dep) || "";

  let html;
  try {
    const r = await fetch(spot.reserveUrl, { headers: { "User-Agent": UA, "Accept-Language": "ko" } });
    console.log(`  [thefishing2] GET ${spot.reserveUrl} → HTTP ${r.status}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    html = await r.text();
  } catch (e) { console.error(`[${spot.name}] fetch 실패: ${e.message}`); return []; }

  const slots = parseList(html, { boat: boatName, cap: cfgCap, dep, species: spot.species, url: spot.reserveUrl });
  console.log(`[${spot.name}] 슬롯 ${slots.length}건`);
  return slots;
}

export function parseList(html, opt = {}) {
  const text = stripToText(html);
  // 정원(인승)
  const capM = text.match(/(\d+)\s*인승/);
  const cap = opt.cap || (capM ? +capM[1] : 0);
  // 어종
  const species = opt.species && opt.species.length ? opt.species : fishOf(text);
  // 기준 연·월 (현재 KST)
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  let year = now.getUTCFullYear(), month = now.getUTCMonth() + 1;
  const ym = text.match(/(\d{4})\s*년?\s*(\d{1,2})\s*월/); // 페이지에 연월이 있으면 사용
  if (ym) { year = +ym[1]; month = +ym[2]; }

  // 리스트 행: "10 목요일 5물 남은인원 3명" / "5 토요일 무시 예약완료"
  const re = /(\d{1,2})\s*([일월화수목금토])요일\s*([0-9]{0,2}[가-힣]{1,4})\s*(예약완료|예약마감|남은인원\s*(\d+)\s*명)/g;
  const out = []; const seen = new Set(); let m;
  while ((m = re.exec(text)) !== null) {
    const d = +m[1], dow = m[2], mul = m[3];
    const soldout = /예약완료|예약마감/.test(m[4]);
    const open = soldout ? 0 : (m[5] ? +m[5] : 0);
    const ymd = `${year}-${p2(month)}-${p2(d)}`;
    if (seen.has(ymd)) continue; seen.add(ymd);
    out.push({
      boat: opt.boat, species, date: `${month}/${d}`, ymd, dow,
      dep: opt.dep || "", open, cap, mul, url: opt.url,
    });
  }
  return out;
}

function stripToText(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}
function fishOf(t) {
  const s = [];
  for (const f of ["쭈꾸미", "갑오징어", "백조기", "우럭", "광어", "참돔", "농어", "갈치", "문어", "꽃게"]) if (t.includes(f)) s.push(f);
  return s.length ? s : ["기타"];
}

function rnd(a, b) { const x = Math.sin(a * 928.13 + b * 47.71) * 10000; return x - Math.floor(x); }
function mockSlots(spot) {
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
  const b = (spot.boats && spot.boats[0]) || { name: "○호", cap: 20, dep: "06:00" };
  const out = []; const today = new Date();
  for (let d = 0; d < 7; d++) {
    const day = new Date(today); day.setDate(today.getDate() + d);
    const r = rnd(day.getDate() + d, 3); const open = r < 0.5 ? 0 : Math.ceil(r * 8);
    out.push({ boat: b.name, species: spot.species || ["쭈꾸미"], date: `${day.getMonth() + 1}/${day.getDate()}`,
      ymd: `${day.getFullYear()}-${p2(day.getMonth() + 1)}-${p2(day.getDate())}`,
      dow: DOW[day.getDay()], dep: b.dep || "06:00", open, cap: b.cap, mul: "-", url: spot.reserveUrl });
  }
  return out;
}
