// lib/sunsang24.js
// 선상24(sunsang24.com) — 각 선사는 서브도메인 사이트를 가진다: {선사}.sunsang24.com
// 예약현황(실시간예약) 페이지: /ship/schedule_fleet  (다음 달: /ship/schedule_fleet/YYYYMM)
//
//  페이지 구조(서버 렌더링 HTML, 관찰됨):
//   · 날짜 행: "9월 1일(화)  12물  반도호 바로예약  공지사항 … 어종 : 갈치  운항시간 : 18:00 ~ 03:00 …"
//   · 상태/남은자리 칸:
//       "출항확정  남은자리  14명  예약/6명"   → 잔여 14, 예약 6, 정원 20
//       "남은자리  20명"                      → 잔여 20 (예약 0)
//       "예약마감  20명  예약/20명"            → 마감(0)
//       "출항취소"                            → 그날 출항 없음(건너뜀)
//
//  선상24는 남은자리를 직접 알려주므로 좌석 계산이 필요 없다.
//
//  spots.json 예시:
//   {
//     "name": "진해 반도낚시", "platform": "sunsang24",
//     "reserveUrl": "https://bando.sunsang24.com/ship/schedule_fleet",
//     "months": 2,
//     "boats": [{ "name": "반도호", "cap": 20 }]
//   }
//
//  반환(표준 슬롯): { boat, species, date:"9/6", ymd, dow, dep, open, cap, mul, url }

const MOCK = process.env.MOCK === "1";
const UA = "Mozilla/5.0 (compatible; BinjariBot/0.1; personal use)";
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

export async function fetchAvailability(spot) {
  if (MOCK) return mockSlots(spot);

  const base = (spot.reserveUrl || "").replace(/\/+$/, "");
  if (!/\/ship\/schedule_fleet$/.test(base)) {
    throw new Error(`[${spot.name}] reserveUrl은 …/ship/schedule_fleet 형태여야 합니다.`);
  }
  const months = Math.max(1, spot.months || 2);

  // 이번 달 페이지 → 표시된 연-월 파악 → 다음 달들 순회
  const first = await getText(base);
  const ym = pageYearMonth(first) || defaultYM();
  const all = [{ ym, text: first }];
  let cur = ym;
  for (let i = 1; i < months; i++) {
    cur = nextYM(cur);
    all.push({ ym: cur, text: await getText(`${base}/${cur}`) });
  }

  const out = [];
  for (const { ym, text } of all) out.push(...parseSchedule(text, Math.floor(ym / 100)));
  console.log(`[${spot.name}] 슬롯 ${out.length}건`);
  return out.map((s) => ({ ...s, url: base }));
}

async function getText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  console.log(`  [sunsang24] GET ${url} → HTTP ${res.status}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.text();
}

// ── 핵심 파서 (태그 제거 텍스트) ───────────────────────
export function parseSchedule(html, year) {
  const text = stripToText(html);
  if (!year) year = pageYearMonth(html) ? Math.floor(pageYearMonth(html) / 100) : new Date().getFullYear();

  // 날짜 헤더 위치
  const dateRe = /(\d{1,2})월\s*(\d{1,2})일\(([일월화수목금토])\)/g;
  const heads = [];
  let m;
  while ((m = dateRe.exec(text)) !== null) heads.push({ idx: m.index, mo: +m[1], d: +m[2], dow: m[3] });
  console.log(`  [sunsang24] 날짜 ${heads.length}개 발견`);
  if (!heads.length) { console.log(`  [sunsang24] 앞부분: ${text.slice(0, 160)}`); return []; }

  const p2 = (n) => String(n).padStart(2, "0");
  const out = [];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const seg = text.slice(h.idx, i + 1 < heads.length ? heads[i + 1].idx : text.length);

    // 출항취소면 건너뜀
    if (/출항\s*취소/.test(seg)) continue;

    const mul = (seg.match(/일\([일월화수목금토]\)\s*(추석|설날)?\s*([0-9]{1,2}물|조금|무시|사리|대객기|한객기|[가-힣]{1,3}물)/) || [])[2] || "-";
    const boat = boatName(seg);
    const species = fishOf(seg);
    const dep = depOf(seg);

    let open = null, cap = 0;
    let mm;
    if ((mm = seg.match(/예약마감\s*(\d+)\s*명/))) { open = 0; cap = +mm[1]; }
    else if ((mm = seg.match(/남은자리\s*(\d+)\s*명(?:\s*예약\s*\/\s*(\d+)\s*명)?/))) {
      open = +mm[1]; const booked = mm[2] ? +mm[2] : 0; cap = open + booked;
    } else {
      // 출조대기/미표기 → 잔여 정보 없음: 건너뜀
      continue;
    }

    out.push({
      boat, species,
      date: `${h.mo}/${h.d}`,
      ymd: `${year}-${p2(h.mo)}-${p2(h.d)}`,
      dow: h.dow, dep, open, cap, mul,
    });
  }
  return out;
}

function stripToText(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
function boatName(seg) {
  // 물때 뒤 ~ (바로예약|대기하기|공지사항) 앞 텍스트
  const m = seg.match(/(?:[0-9]물|조금|무시|사리|대객기|한객기)\s+(.+?)\s+(?:바로예약|대기하기|공지사항)/);
  return m ? m[1].trim() : "";
}
function fishOf(seg) {
  const m = seg.match(/어종\s*[:：]\s*([가-힣, ]+?)\s*(?:\/|운항시간|예약완료|$)/);
  if (!m) return ["기타"];
  return m[1].split(/[,\s]+/).filter(Boolean);
}
function depOf(seg) {
  const m = seg.match(/운항시간\s*[:：]\s*(\d{1,2}):(\d{2})/);
  return m ? `${String(m[1]).padStart(2, "0")}:${m[2]}` : "";
}

// "2026년 9월" + 다음달 링크(/schedule_fleet/202610) 에서 연월(YYYYMM) 추출
function pageYearMonth(html) {
  const t = String(html);
  let m = t.match(/schedule_fleet\/(\d{6})/);      // 다음 달 링크가 있으면 그 이전 달
  if (m) return prevYM(+m[1]);
  m = t.match(/(\d{4})년\s*(\d{1,2})월/);
  if (m) return +m[1] * 100 + +m[2];
  return null;
}
function defaultYM() { const d = new Date(); return d.getFullYear() * 100 + (d.getMonth() + 1); }
function nextYM(ym) { let y = Math.floor(ym / 100), mo = ym % 100; mo++; if (mo > 12) { mo = 1; y++; } return y * 100 + mo; }
function prevYM(ym) { let y = Math.floor(ym / 100), mo = ym % 100; mo--; if (mo < 1) { mo = 12; y--; } return y * 100 + mo; }

// ── 오프라인 검증용 MOCK ────────────────────────────
function rnd(a, b) { const x = Math.sin(a * 928.13 + b * 47.71) * 10000; return x - Math.floor(x); }
function mockSlots(spot) {
  const boats = spot.boats?.length ? spot.boats : [{ name: "○○호", cap: 20, dep: "06:00" }];
  const out = []; const today = new Date();
  for (let d = 0; d < 7; d++) {
    const day = new Date(today); day.setDate(today.getDate() + d);
    const p2 = (n) => String(n).padStart(2, "0");
    for (let bi = 0; bi < boats.length; bi++) {
      const b = boats[bi]; const r = rnd(day.getDate() + d * 5, bi + 9);
      const open = r < 0.5 ? 0 : Math.min(b.cap, Math.ceil(r * 8));
      out.push({ boat: b.name, species: [(spot.species || ["갑오징어"])[0]], date: `${day.getMonth() + 1}/${day.getDate()}`,
        ymd: `${day.getFullYear()}-${p2(day.getMonth() + 1)}-${p2(day.getDate())}`,
        dow: DOW[day.getDay()], dep: b.dep || "06:00", open, cap: b.cap, mul: "-", url: spot.reserveUrl });
    }
  }
  return out;
}
