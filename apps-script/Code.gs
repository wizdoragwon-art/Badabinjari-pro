/**
 * 물때빈자리 — Google Apps Script 백엔드
 *
 *  · 지인이 공유한 예약 사이트 URL을 시트(Submissions)에 쌓음
 *  · PWA가 읽을 데이터(spots/boats/submissions/weather)를 JSON으로 제공
 *  · Config 시트에 날씨 설정(위치·제공자·키)을 넣으면 자동 반영 (기본 Open-Meteo, 키 불필요)
 *
 *  설치: 시트 → 확장 프로그램 → Apps Script 에 이 코드를 붙이고
 *        1) setup() 한 번 실행 (탭·기본값 생성)
 *        2) 배포 → 새 배포 → 웹 앱 (액세스: 모든 사용자) → /exec URL 복사
 *        3) PWA app.js 의 API_URL 에 그 URL 붙여넣기
 */

const CONFIG_DEFAULTS = {
  WEATHER_PROVIDER: 'open-meteo',   // 'open-meteo'(키 불필요, 파고 포함) 또는 'openweather'
  WEATHER_API_KEY: '',              // openweather 쓸 때만
  LAT: '36.99',                     // 기본: 서산 삼길포 부근
  LON: '126.35',
  TZ: 'Asia/Seoul',
  FORECAST_DAYS: '14',
};

// ── 시트 유틸 ─────────────────────────────────────────
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(name) { const s = ss_(); return s.getSheetByName(name) || s.insertSheet(name); }

/** 탭·헤더·기본값을 만든다. 최초 1회 실행. */
function setup() {
  const sp = sheet_('Spots');
  if (sp.getLastRow() === 0) {
    sp.appendRow(['name', 'port', 'active', 'lat', 'lon']);
    sp.appendRow(['삼길포 씨유만석낚시', '충남 서산 삼길포', true, 36.99, 126.35]);
  }
  const bt = sheet_('Boats');
  if (bt.getLastRow() === 0) {
    bt.appendRow(['spot', 'name', 'species', 'dep', 'fee', 'cap', 'minGo', 'url']);
    bt.appendRow(['삼길포 씨유만석낚시', '만석호', '쭈꾸미,갑오징어', '일출', '', 20, 10, 'http://www.mscufishing.com/index.php?mid=bk']);
    bt.appendRow(['삼길포 씨유만석낚시', '헌터호', '갑오징어', '일출', '', 15, 8, 'http://www.mscufishing.com/index.php?mid=bk']);
  }
  const sub = sheet_('Submissions');
  if (sub.getLastRow() === 0) sub.appendRow(['timestamp', 'url', 'name', 'by', 'note']);
  const su = sheet_('Subs');
  if (su.getLastRow() === 0) su.appendRow(['boatId', 'boatName', 'ranges', 'updated']);
  const cf = sheet_('Config');
  if (cf.getLastRow() === 0) {
    cf.appendRow(['key', 'value']);
    Object.keys(CONFIG_DEFAULTS).forEach(k => cf.appendRow([k, CONFIG_DEFAULTS[k]]));
  }
  SpreadsheetApp.flush();
  return 'setup 완료';
}

// ── 웹 엔드포인트 ─────────────────────────────────────
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'data';
  if (action === 'setup') return json_({ ok: true, msg: setup() });
  if (action === 'submit') return json_(appendSubmission_(e.parameter)); // GET 방식 공유(폴백)
  if (action === 'subs') return json_({ ok: true, subs: readSubs_() });   // 봇이 읽는 구독 목록
  if (action === 'savesub') return json_(saveSub_(e.parameter));          // GET 방식 저장(폴백)
  return json_(buildData_());
}

function doPost(e) {
  let body = {};
  try { body = (e.postData && e.postData.contents) ? JSON.parse(e.postData.contents) : (e.parameter || {}); }
  catch (_) { body = e.parameter || {}; }
  if (body.action === 'savesub') return json_(saveSub_(body));
  return json_(appendSubmission_(body));
}

// ── 구독(배 + 여러 기간) ──────────────────────────────
// ranges: "2026-09-19~2026-09-20,2026-10-03~2026-10-10" 형식
function saveSub_(p) {
  const boatId = String(p.boatId || '').trim();
  if (!boatId) return { ok: false, error: 'boatId 필요' };
  const boatName = String(p.boatName || '');
  const ranges = String(p.ranges || '').trim(); // 빈 문자열이면 구독 해제
  const su = sheet_('Subs');
  if (su.getLastRow() === 0) setup();
  const rows = su.getDataRange().getValues();
  let found = -1;
  for (let i = 1; i < rows.length; i++) if (String(rows[i][0]) === boatId) { found = i + 1; break; }
  if (!ranges) { // 해제
    if (found > 0) su.deleteRow(found);
    return { ok: true, removed: true };
  }
  if (found > 0) su.getRange(found, 1, 1, 4).setValues([[boatId, boatName, ranges, new Date()]]);
  else su.appendRow([boatId, boatName, ranges, new Date()]);
  return { ok: true };
}

function readSubs_() {
  const su = sheet_('Subs');
  const rows = su.getDataRange().getValues();
  if (rows.length < 2) return [];
  return rows.slice(1).filter(r => r[0]).map(r => ({
    boatId: String(r[0]), boatName: String(r[1]),
    ranges: String(r[2]).split(',').map(s => s.trim()).filter(Boolean),
  }));
}

/** 공유된 URL을 Submissions에 추가 (중복 방지) */
function appendSubmission_(p) {
  const url = (p && p.url ? String(p.url) : '').trim();
  if (!url || !/\./.test(url)) return { ok: false, error: 'invalid url' };
  const sub = sheet_('Submissions');
  if (sub.getLastRow() === 0) setup();
  const n = sub.getLastRow() - 1;
  if (n > 0) {
    const existing = sub.getRange(2, 2, n, 1).getValues().map(r => String(r[0]).trim());
    if (existing.indexOf(url) !== -1) return { ok: true, dup: true };
  }
  sub.appendRow([new Date(), url, String(p.name || ''), String(p.by || ''), String(p.note || '')]);
  return { ok: true };
}

// ── 데이터 조립 ───────────────────────────────────────
function buildData_() {
  const cfg = getConfig_();
  const spotsRows = readTable_('Spots');
  const boatsRows = readTable_('Boats');

  const byspot = {};
  boatsRows.forEach(b => {
    if (!b.spot || !b.name) return;
    (byspot[b.spot] = byspot[b.spot] || []).push({
      id: slug_(b.spot + '-' + b.name),
      name: b.name,
      sp: String(b.species || '').split(',').map(s => s.trim()).filter(Boolean),
      dep: b.dep || '',
      fee: (b.fee === '' || b.fee == null) ? null : Number(b.fee),
      cap: Number(b.cap) || 0,
      minGo: Number(b.minGo) || 0,
      url: b.url || '',
    });
  });

  const spots = spotsRows.filter(s => truthy_(s.active)).map(s => ({
    name: s.name, port: s.port,
    lat: s.lat !== '' ? Number(s.lat) : null,
    lon: s.lon !== '' ? Number(s.lon) : null,
    boats: byspot[s.name] || [],
  }));

  const submissions = readTable_('Submissions').slice(-30).map(r => ({
    url: r.url, name: r.name, by: r.by,
    ts: r.timestamp instanceof Date ? r.timestamp.toISOString() : r.timestamp,
  }));

  return {
    updated: new Date().toISOString(),
    spots: spots,
    submissions: submissions,
    subs: readSubs_(),
    weather: getWeather_(cfg),
    availability: {},   // (다음 단계) 스크래퍼가 채움
  };
}

function getConfig_() {
  const cf = sheet_('Config');
  const v = Object.assign({}, CONFIG_DEFAULTS);
  const rows = cf.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const k = rows[i][0]; if (k) v[String(k).trim()] = String(rows[i][1]).trim();
  }
  return v;
}

function readTable_(name) {
  const sh = sheet_(name);
  const rng = sh.getDataRange().getValues();
  if (rng.length < 2) return [];
  const head = rng[0].map(h => String(h).trim());
  return rng.slice(1)
    .filter(r => r.some(c => c !== '' && c != null))
    .map(r => { const o = {}; head.forEach((h, i) => o[h] = r[i]); return o; });
}
function truthy_(v) { return v === true || /^(true|1|y|yes|active|on)$/i.test(String(v).trim()); }
function slug_(s) { return String(s).toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, ''); }

// ── 날씨 (Config 기반) ────────────────────────────────
function getWeather_(cfg) {
  const cache = CacheService.getScriptCache();
  const ckey = 'wx:' + cfg.LAT + ',' + cfg.LON + ':' + cfg.WEATHER_PROVIDER;
  const hit = cache.get(ckey);
  if (hit) return JSON.parse(hit);

  let out = {};
  try {
    if (String(cfg.WEATHER_PROVIDER).toLowerCase() === 'openweather' && cfg.WEATHER_API_KEY) {
      out = fetchOpenWeather_(cfg);
    } else {
      out = fetchOpenMeteo_(cfg);
    }
  } catch (err) {
    out = { _error: String(err) };
  }
  cache.put(ckey, JSON.stringify(out), 1800); // 30분 캐시
  return out;
}

/** Open-Meteo: 키 불필요. 기온·풍속(m/s)·강수확률 + 파고(해양 API) */
function fetchOpenMeteo_(cfg) {
  const days = Number(cfg.FORECAST_DAYS) || 14;
  const tz = encodeURIComponent(cfg.TZ);
  const wxUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + cfg.LAT + '&longitude=' + cfg.LON +
    '&daily=temperature_2m_max,wind_speed_10m_max,precipitation_probability_max' +
    '&wind_speed_unit=ms&timezone=' + tz + '&forecast_days=' + days;
  const mrUrl = 'https://marine-api.open-meteo.com/v1/marine?latitude=' + cfg.LAT + '&longitude=' + cfg.LON +
    '&daily=wave_height_max&timezone=' + tz + '&forecast_days=' + days;

  const res = UrlFetchApp.fetchAll([{ url: wxUrl, muteHttpExceptions: true }, { url: mrUrl, muteHttpExceptions: true }]);
  const w = JSON.parse(res[0].getContentText());

  const wave = {};
  try {
    const m = JSON.parse(res[1].getContentText());
    (m.daily.time || []).forEach((d, i) => { wave[d] = m.daily.wave_height_max[i]; });
  } catch (_) {}

  const out = {};
  const days_ = (w.daily && w.daily.time) || [];
  days_.forEach((d, i) => {
    out[d] = {
      temp: Math.round(w.daily.temperature_2m_max[i]),
      wind: Math.round(w.daily.wind_speed_10m_max[i]),
      rain: Math.round(w.daily.precipitation_probability_max[i] || 0),
      wave: (wave[d] != null) ? Number(Number(wave[d]).toFixed(1)) : null,
    };
  });
  return out;
}

/** OpenWeather: 키 필요. 5일/3시간 예보를 일 최대로 집계 (파고 없음) */
function fetchOpenWeather_(cfg) {
  const url = 'https://api.openweathermap.org/data/2.5/forecast?lat=' + cfg.LAT +
    '&lon=' + cfg.LON + '&units=metric&appid=' + cfg.WEATHER_API_KEY;
  const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const j = JSON.parse(r.getContentText());
  const out = {};
  (j.list || []).forEach(it => {
    const d = String(it.dt_txt).slice(0, 10);
    const o = out[d] || (out[d] = { temp: -99, wind: 0, rain: 0, wave: null });
    o.temp = Math.max(o.temp, Math.round(it.main.temp_max));
    o.wind = Math.max(o.wind, Math.round(it.wind.speed));
    o.rain = Math.max(o.rain, Math.round((it.pop || 0) * 100));
  });
  return out;
}

// ── 테스트용 ──────────────────────────────────────────
function testBuild() { Logger.log(JSON.stringify(buildData_(), null, 2)); }
