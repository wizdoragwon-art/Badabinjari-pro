// lib/khoa.js
// 국립해양조사원 (공공데이터포털 apis.data.go.kr, 서비스 1192136)
//   · 조류예보(시계열)  GetCrntFcstTimeApiService  — item{predcDt, crsp(cm/s), crdir}
//   · 조석예보(고·저조) GetTideFcstHghLwApiService — item{predcDt, predcTdlvVl(cm)}
//
//   키는 GitHub Secret(KHOA_KEY). spots.json 의 khoa.tideObs(조석, DT_코드) / khoa.currentObs(조류 예보점).

const BASE = "https://apis.data.go.kr/1192136/crntFcstTime/GetCrntFcstTimeApiService";
const TIDE = "https://apis.data.go.kr/1192136/tideFcstHghLw/GetTideFcstHghLwApiService";
const p2 = (n) => String(n).padStart(2, "0");
const ymdKST = (off = 0) => { const d = new Date(Date.now() + 9 * 3600 * 1000 + off * 86400000);
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}`; };

async function getJSON(url) {
  const r = await fetch(url, { headers: { "User-Agent": "BinjariBot/0.1", "Accept": "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
// data.go.kr 표준 봉투에서 item 배열 뽑기
function pickItems(j) {
  const it = j && j.response && j.response.body && j.response.body.items && j.response.body.items.item;
  if (Array.isArray(it)) return it;
  if (it && typeof it === "object") return [it];
  return [];
}

export async function fetchOcean(spot, key) {
  const out = { current: {}, tide: {} };
  if (!key) return out;

  // ── 조류 (예보점 코드 있을 때만) ──
  const code = spot.khoa && spot.khoa.currentObs;
  if (code) {
    try {
      const byDate = {};
      for (let i = 0; i < 7; i++) {
        const date = ymdKST(i);
        const url = `${BASE}?serviceKey=${encodeURIComponent(key)}&pageNo=1&numOfRows=100&type=json&obsCode=${encodeURIComponent(code)}&reqDate=${date}&min=60`;
        let j; try { j = await getJSON(url); } catch (e) { console.error(`  [조류 ${date}] ${e.message}`); continue; }
        for (const r of pickItems(j)) {
          const t = String(r.predcDt || "").slice(0, 10);
          const spd = parseFloat(r.crsp);
          if (!t || isNaN(spd)) continue;
          const rec = byDate[t] || (byDate[t] = { max: -1, dir: null, name: r.obsvtrNm || "" });
          if (spd > rec.max) { rec.max = spd; rec.dir = r.crdir || null; }
        }
      }
      for (const d in byDate) out.current[d] = { speed: +(byDate[d].max / 100).toFixed(2), dir: byDate[d].dir, obs: byDate[d].name };
    } catch (e) { console.error(`[${spot.name}] 조류 수집 실패: ${e.message}`); }
  }

  // ── 조석예보 고·저조 (관측소 코드 있을 때) ──
  const tobs = spot.khoa && spot.khoa.tideObs;
  if (tobs) {
    try {
      for (let i = 0; i < 10; i++) {   // 오늘 + 9일
        const date = ymdKST(i);
        const url = `${TIDE}?serviceKey=${encodeURIComponent(key)}&pageNo=1&numOfRows=100&type=json&obsCode=${encodeURIComponent(tobs)}&reqDate=${date}`;
        let j; try { j = await getJSON(url); } catch (e) { console.error(`  [조석 ${date}] ${e.message}`); continue; }
        const items = pickItems(j).map(r => ({
          time: String(r.predcDt || "").slice(11, 16),   // "03:19"
          level: parseFloat(r.predcTdlvVl),               // cm
        })).filter(x => x.time && !isNaN(x.level));
        if (!items.length) continue;
        const key2 = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
        const levels = items.map(x => x.level);
        const hi = Math.max(...levels), lo = Math.min(...levels);
        // 각 극치를 만조/간조로 라벨 (그날 중앙값 기준)
        const mid = (hi + lo) / 2;
        const events = items.map(x => ({ t: x.time, lv: Math.round(x.level), hl: x.level >= mid ? "만조" : "간조" }));
        out.tide[key2] = { events, hi: Math.round(hi), lo: Math.round(lo), range: Math.round(hi - lo), obs: (pickItems(j)[0] || {}).obsvtrNm || "" };
      }
    } catch (e) { console.error(`[${spot.name}] 조석 수집 실패: ${e.message}`); }
  }

  return out;
}
