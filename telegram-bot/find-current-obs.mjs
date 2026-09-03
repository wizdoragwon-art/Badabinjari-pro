// find-current-obs.mjs
// 조류예보 예보점(obsCode)을 훑어서, 내 항구별로 '가장 가까운 예보점'을 찾아준다.
//
//   실행:  KHOA_KEY=발급키  node find-current-obs.mjs
//   결과:  각 항구에 매핑할 예보점 코드를 출력 (spots.json 의 khoa.currentObs 에 넣으면 됨)
//
//   예보점 코드 패턴: {지역2자리}LTC{번호2자리}  (예: 16LTC10 = 비진도남측)
//   지역 접두어와 번호를 넓게 스캔해 실제 존재하는 예보점의 좌표를 수집한다.

const KEY = process.env.KHOA_KEY;
if (!KEY) { console.error("KHOA_KEY 환경변수가 필요합니다.  예)  KHOA_KEY=xxxx node find-current-obs.mjs"); process.exit(1); }

const BASE = "https://apis.data.go.kr/1192136/crntFcstTime/GetCrntFcstTimeApiService";
const REQDATE = (() => { const d = new Date(Date.now() + 9 * 3600e3); return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}${String(d.getUTCDate()).padStart(2,"0")}`; })();

// 내 항구 (spots.json 과 동일)
const HARBORS = [
  { name: "삼길포 씨유만석낚시", lat: 36.99, lon: 126.35 },
  { name: "남당항 은가비호",     lat: 36.44, lon: 126.49 },
  { name: "진해 반도낚시",       lat: 35.13, lon: 128.66 },
];

// 스캔할 지역 접두어(01~30)와 번호(01~60) — 넓게 훑되 존재하는 것만 수집
const PREFIXES = Array.from({ length: 30 }, (_, i) => String(i + 1).padStart(2, "0"));
const NUMS = Array.from({ length: 60 }, (_, i) => String(i + 1).padStart(2, "0"));

const dist = (a, b) => { const dy = (a.lat - b.lat) * 111, dx = (a.lon - b.lon) * 89; return Math.sqrt(dx*dx + dy*dy); }; // km 근사

async function probe(code) {
  const url = `${BASE}?serviceKey=${encodeURIComponent(KEY)}&pageNo=1&numOfRows=1&type=json&obsCode=${code}&reqDate=${REQDATE}&min=60`;
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const j = await r.json();
    const it = j?.response?.body?.items?.item;
    const row = Array.isArray(it) ? it[0] : it;
    if (row && row.lat && row.lon !== undefined) {
      return { code, name: row.obsvtrNm || "", lat: +row.lat, lon: +(row.lon ?? row.lot) };
    }
  } catch {}
  return null;
}

const found = [];
let scanned = 0;
console.log(`스캔 시작 (기준일 ${REQDATE}) … 존재하는 예보점만 수집합니다.`);
for (const p of PREFIXES) {
  let hitInPrefix = 0;
  for (const n of NUMS) {
    const code = `${p}LTC${n}`;
    const res = await probe(code);
    scanned++;
    if (res) { found.push(res); hitInPrefix++; process.stdout.write("."); }
    // 같은 접두어에서 앞쪽 10개가 전부 비면 그 접두어는 없는 것으로 보고 건너뜀(호출 절약)
    if (n === "10" && hitInPrefix === 0) break;
  }
}
console.log(`\n스캔 완료: ${scanned}개 시도, 예보점 ${found.length}개 발견\n`);

// 서해권만 추려 보기(경도 124~127, 위도 34~38) + 전체도 저장
const west = found.filter(f => f.lon >= 124 && f.lon <= 127.2 && f.lat >= 33.5 && f.lat <= 38.5);
console.log("── 서해권 예보점 ──");
west.sort((a,b)=>a.lat-b.lat).forEach(f => console.log(`  ${f.code}  ${f.name}  (${f.lat}, ${f.lon})`));

console.log("\n── 항구별 최근접 예보점 (spots.json 의 khoa.currentObs 에 입력) ──");
for (const h of HARBORS) {
  const cand = found.map(f => ({ ...f, d: dist(h, f) })).sort((a,b)=>a.d-b.d).slice(0,3);
  console.log(`\n📍 ${h.name} (${h.lat},${h.lon})`);
  cand.forEach((c,i)=> console.log(`   ${i===0?"➤":" "} ${c.code}  ${c.name}  ${c.d.toFixed(0)}km  (${c.lat},${c.lon})`));
}

import { writeFileSync } from "node:fs";
writeFileSync("obs-found.json", JSON.stringify(found, null, 2));
console.log("\n전체 목록은 obs-found.json 에도 저장했습니다.");
