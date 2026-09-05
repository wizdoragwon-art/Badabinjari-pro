// lib/sunsang24.js
// 선상24 개별 선사({선사}.sunsang24.com) 예약현황 API.
//
//   엔드포인트: https://{선사}.sunsang24.com/ship/schedule_fleet_reservation/{시작일}/{종료일}
//     예: https://eungabi.sunsang24.com/ship/schedule_fleet_reservation/2026-09-05/2026-09-14
//   응답: { data: [ { sdate:"2026-09-05",
//                     reservation_end:"이름님(2) <button>19,20</button> / ...",   // 예약완료 좌석
//                     reservation_awaiters_print:"...",  // 대기(좌석없음)
//                     reservation_cancel:"..." } ] }
//
//   잔여석 = 정원 − 예약완료 좌석 수 (reservation_end 의 좌석번호 개수)
//   spots.json: reserveUrl 은 "https://{선사}.sunsang24.com/ship/schedule_fleet" 그대로 두고,
//               boats[].cap 에 정원을 넣으면 정확합니다(없으면 관찰된 최대 좌석번호로 추정).

const MOCK = process.env.MOCK === "1";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const p2 = (n) => String(n).padStart(2, "0");

export async function fetchAvailability(spot) {
  if (MOCK) return mockSlots(spot);

  // 서브도메인 추출 (reserveUrl 또는 spot.subdomain)
  const base = (spot.reserveUrl || "").replace(/\/+$/, "");
  const m = base.match(/^https?:\/\/([a-z0-9-]+)\.sunsang24\.com/i);
  if (!m) throw new Error(`[${spot.name}] sunsang24 서브도메인을 찾을 수 없어요 (reserveUrl 확인).`);
  const host = `https://${m[1]}.sunsang24.com`;

  const days = Math.max(1, spot.days || 60);
  const today = new Date(Date.now() + 9 * 3600 * 1000);
  const capByBoat = {};
  (spot.boats || []).forEach((b) => { if (b.cap) capByBoat[b.name] = b.cap; });
  const boatName = (spot.boats && spot.boats[0] && spot.boats[0].name) || spot.name;

  // 날짜 범위를 최대 30일씩 끊어 호출
  const out = [];
  const capSeen = { max: 0 };
  for (let off = 0; off < days; off += 30) {
    const s = new Date(today); s.setDate(today.getDate() + off);
    const e = new Date(today); e.setDate(today.getDate() + Math.min(off + 29, days - 1));
    const url = `${host}/ship/schedule_fleet_reservation/${s.getUTCFullYear()}-${p2(s.getUTCMonth() + 1)}-${p2(s.getUTCDate())}/${e.getUTCFullYear()}-${p2(e.getUTCMonth() + 1)}-${p2(e.getUTCDate())}`;
    let j;
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json", "Referer": `${host}/ship/schedule_fleet` } });
      console.log(`  [sunsang24] GET ${url} → HTTP ${r.status}`);
      if (!r.ok) continue;
      j = await r.json();
    } catch (err) { console.error(`  [sunsang24] ${err.message}`); continue; }
    for (const row of (j && j.data) || []) {
      const ymd = String(row.sdate || "").slice(0, 10);
      if (!ymd) continue;
      const taken = seatCount(row.reservation_end) + seatCount(row.reservation_new_end);
      if (taken > capSeen.max) capSeen.max = taken;
      out.push({ _ymd: ymd, _taken: taken, _boat: boatName });
    }
  }

  // 정원: 설정값 우선, 없으면 관찰된 최대 예약좌석수(만석일 때 정원에 근접) 사용
  const cfgCap = capByBoat[boatName] || 0;
  return out.map((r) => {
    const cap = Math.max(cfgCap, capSeen.max, r._taken);
    const open = Math.max(0, cap - r._taken);
    const [y, mo, d] = r._ymd.split("-").map(Number);
    return {
      boat: r._boat, species: spot.species || ["기타"],
      date: `${mo}/${d}`, ymd: r._ymd, dow: DOW[new Date(y, mo - 1, d).getDay()],
      dep: (spot.boats && spot.boats[0] && spot.boats[0].dep) || "", open, cap, mul: "-", url: base,
    };
  });
}

// reservation_end 문자열의 <button>좌석,번호</button> 에서 좌석 수 세기
function seatCount(str) {
  if (!str) return 0;
  const set = new Set();
  const re = /<button[^>]*>([0-9,\s]+)<\/button>/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    m[1].split(",").forEach((x) => { const n = parseInt(x.trim(), 10); if (n) set.add(n); });
  }
  // 버튼이 없고 텍스트만 있는 경우: "이름님(N)" 의 N 합으로 대체 추정
  if (set.size === 0) {
    let sum = 0, mm; const re2 = /\((\d+)\)/g;
    while ((mm = re2.exec(str)) !== null) sum += parseInt(mm[1], 10);
    return sum;
  }
  return set.size;
}

function rnd(a, b) { const x = Math.sin(a * 928.13 + b * 47.71) * 10000; return x - Math.floor(x); }
function mockSlots(spot) {
  const boats = spot.boats?.length ? spot.boats : [{ name: "○○호", cap: 20, dep: "06:00" }];
  const out = []; const today = new Date();
  for (let d = 0; d < 7; d++) {
    const day = new Date(today); day.setDate(today.getDate() + d);
    for (let bi = 0; bi < boats.length; bi++) {
      const b = boats[bi]; const r = rnd(day.getDate() + d * 5, bi + 9);
      const open = r < 0.5 ? 0 : Math.min(b.cap, Math.ceil(r * 8));
      out.push({ boat: b.name, species: (spot.species || ["갈치"]), date: `${day.getMonth() + 1}/${day.getDate()}`,
        ymd: `${day.getFullYear()}-${p2(day.getMonth() + 1)}-${p2(day.getDate())}`,
        dow: DOW[day.getDay()], dep: b.dep || "06:00", open, cap: b.cap, mul: "-", url: spot.reserveUrl });
    }
  }
  return out;
}
