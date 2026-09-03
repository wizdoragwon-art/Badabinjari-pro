// check.js
// 관심 출조점(더피싱·선상24) 예약현황을 확인해
//   1) 새로 뜬 빈자리를 텔레그램으로 알리고
//   2) PWA가 읽을 data.json(출조점·배·잔여석)을 갱신한다.
//
//   실행: node check.js         (로컬 테스트: MOCK=1 node check.js)
//        DRY_RUN=1 이면 전송 없이 메시지만 출력

import { readFile, writeFile } from "node:fs/promises";
import { sendMessage, formatAlert } from "./lib/telegram.js";
import { fetchAvailability as thefishing } from "./lib/thefishing.js";
import { fetchAvailability as sunsang24 } from "./lib/sunsang24.js";
import { fetchOcean } from "./lib/khoa.js";

const ADAPTERS = { thefishing, sunsang24 };

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-|-$/g, "");
const keyOf = (spot, boat, ymd) => `${spot.uid || slug(spot.name)}|${boat}|${ymd}`;

function isQuietHour() {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const h = kst.getUTCHours();
  return !(h >= 8 && h < 23);  // KST 08~23시에만 작동, 그 외 조용시간
}
async function loadJSON(path, fb) { try { return JSON.parse(await readFile(path, "utf8")); } catch { return fb; } }

// 구글 시트(Apps Script)에서 구독 목록을 읽는다: [{boatId, ranges:["2026-09-19~2026-09-20", ...]}]
async function fetchSubs(sheetUrl) {
  if (!sheetUrl) { console.log("SHEET_URL 미설정 — 구독 기반 알림 비활성(알림 없음)"); return {}; }
  try {
    const res = await fetch(sheetUrl + "?action=subs");
    const j = await res.json();
    const map = {};
    for (const s of (j.subs || [])) map[s.boatId] = parseRanges(s.ranges);
    console.log(`구독 ${Object.keys(map).length}개 배 로드`);
    return map;
  } catch (e) { console.error("구독 조회 실패:", e.message); return {}; }
}
function parseRanges(ranges) {
  return (ranges || []).map(r => {
    const [a, b] = String(r).split("~").map(x => x.trim());
    return { from: a, to: b || a };
  }).filter(x => x.from);
}
function inAnyRange(ymd, ranges) {
  return (ranges || []).some(r => ymd >= r.from && ymd <= r.to);
}

async function main() {
  if (isQuietHour() && process.env.MOCK !== "1") { console.log("조용시간(KST 23~08시) — 건너뜀"); return; }

  const cfg = await loadJSON("./spots.json", { filters: {}, spots: [] });
  const prev = await loadJSON("./state.json", {});
  const f = cfg.filters || {};
  const subMap = await fetchSubs(process.env.SHEET_URL);  // 시트에서 구독(배+기간) 로드

  const next = {};              // 상태(중복 알림 방지): key → open
  const newlyOpen = [];         // 이번에 새로 뜬 빈자리
  const pwaSpots = [];          // data.json 용
  const availability = {};      // data.json 용: boatId → { ymd: open }

  for (const spot of cfg.spots) {
    const adapter = ADAPTERS[spot.platform];
    if (!adapter) { console.warn(`어댑터 없음: ${spot.platform}`); continue; }

    let slots = [];
    try { slots = await adapter(spot); }
    catch (e) { console.error(`수집 실패 [${spot.name}]: ${e.message}`); continue; }
    console.log(`[${spot.name}] 수집 결과 ${slots.length}건, 빈자리>0 ${slots.filter(s=>s.open>0).length}건`);

    // PWA용 배 목록(설정 기준) + 잔여석 기록
    const boatMeta = {};
    (spot.boats || []).forEach((b) => { boatMeta[b.name] = b; });

    for (const s of slots) {
      const boatId = slug(`${spot.name}-${s.boat}`);
      (availability[boatId] ||= {})[s.ymd] = s.open;

      const k = keyOf(spot, s.boat, s.ymd);
      next[k] = s.open;

      // 알림은 "구독한 배 + 지정 기간"에 새로 뜬 빈자리만
      const ranges = subMap[boatId];
      if (!ranges || !ranges.length) continue;          // 구독 안 한 배 → 알림 안 함
      if (!inAnyRange(s.ymd, ranges)) continue;          // 지정 기간 밖 → 알림 안 함
      if (s.open < (f.minSeats ?? 1)) continue;

      const before = prev[k] ?? 0;
      if (before === 0 && s.open > 0) {
        newlyOpen.push({ ...s, spot: spot.name, minGo: boatMeta[s.boat]?.minGo });
      }
    }

    // data.json 스팟(배 메타 + 어종 집계)
    const boatsForPwa = (spot.boats || []).map((b) => ({
      id: slug(`${spot.name}-${b.name}`),
      name: b.name,
      sp: b.sp || spot.species || [],
      dep: b.dep || "", fee: b.fee ?? null,
      cap: b.cap || 0, minGo: b.minGo || Math.round((b.cap || 0) * 0.5),
      url: spot.reserveUrl,
    }));
    if (boatsForPwa.length) {
      const entry = { name: spot.name, port: spot.port || "", lat: spot.lat ?? null, lon: spot.lon ?? null, boats: boatsForPwa };
      if (process.env.KHOA_KEY) {
        try { entry.ocean = await fetchOcean(spot, process.env.KHOA_KEY);
          const cd = Object.keys(entry.ocean.current || {}).length;
          console.log(`[${spot.name}] KHOA 조류 ${cd}일 · 수온 ${entry.ocean.temp ? entry.ocean.temp.value + "℃" : "없음"}`);
        } catch (e) { console.error(`[${spot.name}] KHOA 실패: ${e.message}`); }
      }
      pwaSpots.push(entry);
    }
  }

  // 1) 텔레그램 알림
  if (newlyOpen.length) {
    const msg = formatAlert(newlyOpen);
    if (process.env.DRY_RUN === "1") console.log("[DRY_RUN] 보낼 메시지:\n" + msg + "\n");
    else { await sendMessage(msg); console.log(`알림 전송: 새 빈자리 ${newlyOpen.length}건`); }
  } else {
    console.log("새로 뜬 빈자리 없음");
  }

  // 2) PWA용 data.json 갱신 (앱과 알림이 같은 데이터 공유)
  const data = { updated: new Date().toISOString(), spots: pwaSpots, availability, submissions: [], weather: {} };
  const outPath = process.env.DATA_OUT || "./data.json";
  await writeFile(outPath, JSON.stringify(data, null, 0));
  console.log(`data.json 갱신(${outPath}): 출조점 ${pwaSpots.length} · 배 ${Object.keys(availability).length}`);

  // 상태 저장
  await writeFile("./state.json", JSON.stringify(next, null, 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
