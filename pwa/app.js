/* 물때빈자리 — 설치형 PWA (의존성 없음) */
"use strict";

// ── 백엔드(Google Apps Script) 주소 ──
// 배포한 웹앱 /exec URL을 넣으면 구글 시트에서 데이터를 읽고, 공유한 URL이 시트에 쌓입니다.
// 비워두면 로컬 data.json 을 사용합니다.
const API_URL = "https://script.google.com/macros/s/AKfycbwNycJ8YFtaxd9rYknRg7qXZAYwgbB4l3lNOyxwgs4uiBOMcf0qrnnRvlHa-Cns6a2m/exec";

// ── 팔레트 (CSS 변수와 동일) ──
const C = { ink:"#0e2a30", inkSoft:"#4a636a", tide:"#2b8896", tideSoft:"#d3e9ea",
  beacon:"#e07d2a", full:"#9aa6a4", urgent:"#c25236", line:"#d3dcda", ok:"#2f8f6b" };

// ── 기본 데이터(데이터 파일이 없을 때 폴백) ──
const DEFAULT_DATA = {
  updated: null,
  spots: [
    { name:"삼길포 씨유만석낚시", port:"충남 서산 삼길포", lat:36.99, lon:126.35, boats:[
      { id:"cu-manseok", name:"만석호", sp:["쭈꾸미","갑오징어"], dep:"일출", fee:null, cap:20, minGo:10, url:"http://www.mscufishing.com/index.php?mid=bk" },
      { id:"cu-hunter", name:"헌터호", sp:["갑오징어"], dep:"일출", fee:null, cap:15, minGo:8, url:"http://www.mscufishing.com/index.php?mid=bk" },
      { id:"cu-gold", name:"골드피싱호", sp:["백조기","갑오징어"], dep:"일출", fee:null, cap:15, minGo:8, url:"http://www.mscufishing.com/index.php?mid=bk" },
    ]},
    { name:"오천항 대박호", port:"보령 오천항", lat:36.31, lon:126.50, boats:[
      { id:"oc-daebak", name:"대박호", sp:["쭈꾸미","갑오징어"], dep:"06:30", fee:6.5, cap:20, minGo:10, url:"" },
    ]},
  ],
  availability: {},
};

// 어종별 이모지 (실제 모양에 맞춤: 쭈꾸미=문어류 🐙, 갑오징어=오징어 🦑)
const SP_EMOJI = { "쭈꾸미":"🐙", "갑오징어":"🦑", "주꾸미":"🐙", "오징어":"🦑", "한치":"🦑",
  "백조기":"🐟", "우럭":"🐠", "광어":"🐟", "참돔":"🐡", "농어":"🐟", "갈치":"🐟", "고등어":"🐟", "삼치":"🐟" };
const spEmoji = (n) => SP_EMOJI[n] || "🐟";
const BASE_SPECIES = ["쭈꾸미", "갑오징어", "백조기"];

// 어종별 헤더 배경 이미지 (img/ 폴더에 추가하고 여기 매핑만 채우면 됩니다)
const SP_BG = {
  "전체":"img/bada.jpg",
  "쭈꾸미":"img/bada.jpg", "갑오징어":"img/bada.jpg", "주꾸미":"img/bada.jpg", "오징어":"img/bada.jpg", "한치":"img/bada.jpg",
  "백조기":"img/bada.jpg", "우럭":"img/bada.jpg", "광어":"img/bada.jpg",
  "참돔":"img/chamdom.jpg", "돔":"img/chamdom.jpg", "감성돔":"img/chamdom.jpg",
};
const bgFor = (n) => SP_BG[n] || "img/bada.jpg";

const MODELS = [
  { id:"openmeteo", label:"Open-Meteo", sub:"멀티모델(ECMWF 포함)" },
  { id:"ecmwf", label:"ECMWF", sub:"중기 전지구" },
  { id:"kma", label:"기상청", sub:"LDAPS 국지 1.5km" },
];

// ── 영속 상태 ──
const LS = {
  get(k, d){ try{ return JSON.parse(localStorage.getItem("binjari."+k)) ?? d; }catch{ return d; } },
  set(k, v){ localStorage.setItem("binjari."+k, JSON.stringify(v)); },
};

const S = {
  monthOff: 0, species: "전체", port: "전체", sel: null, model: "openmeteo", tab: "cal",
  subs: LS.get("subsMap", {}),        // boatId → ["2026-09-19~2026-09-20", ...]
  editBoat: null, editRanges: [], editFrom: "", editTo: "",  // 기간 편집 중
  extra: LS.get("extra", []),          // URL로 추가된 출조점
  speciesList: LS.get("speciesList", BASE_SPECIES),  // 어종 목록(사용자 추가 가능)
  addingSp: false, spDraft: "",
  ports: LS.get("ports", null),      // 사용자 편집 항구목록(null=자동)
  addingPort: false, portDraft: "",
  portCoords: LS.get("portCoords", {}),   // 사용자 추가 항구 좌표: {name:{lat,lon}}
  portResults: [], portSearching: false,
  hidden: LS.get("hidden", []),      // 숨긴 배 id 목록
  data: DEFAULT_DATA,
  result: null, analyzing: false, urlDraft: "",
  deferredPrompt: null,
  weather: {},        // (구시트 폴백) date → {temp,wind,wave,rain}
  wx: {},             // 실날씨 캐시: "lat,lon" → { date: {temp,wind,wave,rain, am, pm} }
  wxLoading: {},
  submissions: [],    // 지인이 공유한 URL 목록
};

// ── 유틸 ──
const rnd = (a,b) => { const x=Math.sin(a*928.13+b*47.71)*10000; return x-Math.floor(x); };
const pad2 = (n)=>String(n).padStart(2,"0");
const DOW = ["일","월","화","수","목","금","토"];

function allSpots(){ return [...S.data.spots, ...S.extra]; }
function allBoats(){ const out=[]; for(const sp of allSpots()) for(const b of (sp.boats||[])) out.push({...b, _spot:sp.name, _port:sp.port}); return out.filter(b=>!(S.hidden||[]).includes(b.id)); }
function allBoatsRaw(){ const out=[]; for(const sp of allSpots()) for(const b of (sp.boats||[])) out.push({...b, _spot:sp.name, _port:sp.port}); return out; }
function boatsForSp(sp){
  let bs=allBoats();
  if(S.port && S.port!=="전체") bs=bs.filter(b=>(b._port||"")===S.port);
  return sp==="전체"?bs:bs.filter(b=>(b.sp||[]).includes(sp));
}
function portsList(){ const set=[]; for(const s of allSpots()){ if(s.port && !set.includes(s.port)) set.push(s.port); } return set; }
function activePorts(){ return Array.isArray(S.ports)?S.ports:portsList(); }
function addPort(){
  const n=(S.portDraft||"").trim();
  if(!n){ toast("항구 이름을 입력하세요"); return; }
  const base=activePorts();
  if(n==="전체"||base.includes(n)){ toast("이미 있는 항구예요"); S.addingPort=false; S.portDraft=""; render(); return; }
  S.ports=[...base,n]; LS.set("ports",S.ports);
  S.port=n; S.addingPort=false; S.portDraft=""; S.portResults=[]; S.sel=null; render();
  toast(`📍 ${n} 추가됨`);
}
// 지명 검색(Open-Meteo Geocoding, 키 불필요)
async function searchPorts(){
  const q=(S.portDraft||"").trim();
  if(!q){ toast("검색어를 입력하세요"); return; }
  S.portSearching=true; S.portResults=[]; render();
  try{
    const r=await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=ko&format=json`);
    const j=await r.json();
    S.portResults=(j.results||[]).map(x=>({
      name:x.name, lat:x.latitude, lon:x.longitude,
      admin:[x.admin1,x.admin2].filter(Boolean).join(" "), cc:x.country_code||""
    }));
    if(!S.portResults.length) toast("결과 없음 — 인근 지명으로 검색하거나 이름만 추가하세요");
  }catch{ toast("검색 실패 — 네트워크 확인"); }
  finally{ S.portSearching=false; render(); }
}
function pickPort(i){
  const r=S.portResults[i]; if(!r) return;
  const label=r.admin ? `${r.name}(${r.admin.split(" ")[0]})` : r.name;
  const base=activePorts();
  if(!base.includes(label)){ S.ports=[...base,label]; LS.set("ports",S.ports); }
  S.portCoords[label]={lat:r.lat,lon:r.lon}; LS.set("portCoords",S.portCoords);
  S.port=label; S.addingPort=false; S.portDraft=""; S.portResults=[]; S.sel=null; render();
  ensureWeather();
  toast(`📍 ${label} 추가됨 (좌표 자동)`);
}
function removePort(name){
  const base=activePorts();
  S.ports=base.filter(x=>x!==name); LS.set("ports",S.ports);
  if(S.portCoords&&S.portCoords[name]){ delete S.portCoords[name]; LS.set("portCoords",S.portCoords); }
  if(S.port===name) S.port="전체";
  render(); toast(`${name} 삭제됨`);
}
// 그날 물높이 비율(0~1): 물때가 클수록(사리) 높게, 조금일수록 낮게
function tideFrac(di){ const mul=((di%15)+15)%15+1; return Math.round(Math.abs(Math.sin((mul/15)*Math.PI))*100)/100; }

function dayIndex(y,m,d){ return Math.round((Date.UTC(y,m,d)-Date.UTC(2024,0,1))/86400000); }
function ymd(y,m,d){ return `${y}-${pad2(m+1)}-${pad2(d)}`; }

// 잔여석: data.json(봇)에 실데이터가 있으면 그 값, 없으면 null(정보 없음)
function seatsOf(boat, y, m, d){
  const av = S.data.availability?.[boat.id];
  const v = av ? av[ymd(y,m,d)] : undefined;
  return (typeof v === "number") ? v : null;
}
function tideInfo(di){ const mul=((di%15)+15)%15+1; const spring=Math.abs(Math.sin((mul/15)*Math.PI)); const amp=130+spring*190;
  const label = (mul>=7&&mul<=9)?`${mul}물·사리`:(mul<=2||mul>=14)?`${mul}물·조금`:`${mul}물`; return {mul,amp,label}; }
// ── 실날씨(Open-Meteo, 항구별 직접 호출) ──
function curCoords(){
  if(S.port && S.port!=="전체"){
    const sp=allSpots().find(s=>s.port===S.port && s.lat!=null && s.lon!=null);
    if(sp) return {lat:Number(sp.lat),lon:Number(sp.lon)};
    const pc=S.portCoords&&S.portCoords[S.port];
    if(pc) return {lat:Number(pc.lat),lon:Number(pc.lon)};
  }
  const first=allSpots().find(s=>s.lat!=null && s.lon!=null);
  return first?{lat:Number(first.lat),lon:Number(first.lon)}:null;
}
function curKey(){ const c=curCoords(); return c?`${c.lat.toFixed(3)},${c.lon.toFixed(3)}`:null; }
function curWeather(){ const k=curKey(); return (k&&S.wx[k])||S.weather||{}; }

async function ensureWeather(){
  const c=curCoords(); if(!c) return;
  const k=`${c.lat.toFixed(3)},${c.lon.toFixed(3)}`;
  if(S.wx[k]||S.wxLoading[k]) return;
  S.wxLoading[k]=true;
  try{
    const days=14, tz="Asia%2FSeoul";
    const f=`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&hourly=temperature_2m,wind_speed_10m,precipitation_probability&wind_speed_unit=ms&timezone=${tz}&forecast_days=${days}`;
    const m=`https://marine-api.open-meteo.com/v1/marine?latitude=${c.lat}&longitude=${c.lon}&hourly=wave_height&timezone=${tz}&forecast_days=${days}`;
    const [fr,mr]=await Promise.all([fetch(f), fetch(m).catch(()=>null)]);
    const fj=await fr.json(); let mj=null; try{ mj=mr?await mr.json():null; }catch{}
    S.wx[k]=parseOpenMeteo(fj,mj);
    LS.set("wxCache", S.wx);   // 오프라인 폴백용
    render();
  }catch{/* 오프라인: 데모/캐시 사용 */}
  finally{ S.wxLoading[k]=false; }
}
function parseOpenMeteo(fj,mj){
  const H=(fj&&fj.hourly)||{}; const times=H.time||[];
  const T=H.temperature_2m||[], W=H.wind_speed_10m||[], R=H.precipitation_probability||[];
  const waveByT={};
  if(mj&&mj.hourly&&mj.hourly.time){ mj.hourly.time.forEach((t,i)=>{ waveByT[t]=mj.hourly.wave_height[i]; }); }
  const byDate={};
  times.forEach((t,i)=>{ const date=t.slice(0,10), hr=+t.slice(11,13);
    const rec=byDate[date]||(byDate[date]={all:[],am:[],pm:[]});
    const p={temp:T[i],wind:W[i],rain:R[i]||0,wave:waveByT[t]!=null?waveByT[t]:null};
    rec.all.push(p); if(hr>=6&&hr<12) rec.am.push(p); if(hr>=12&&hr<18) rec.pm.push(p);
  });
  const agg=(arr)=>{ if(!arr||!arr.length) return null;
    const avg=a=>a.reduce((x,y)=>x+y,0)/a.length, mx=a=>Math.max(...a);
    const waves=arr.map(p=>p.wave).filter(v=>v!=null);
    return { temp:Math.round(avg(arr.map(p=>p.temp))), wind:Math.round(mx(arr.map(p=>p.wind))),
      rain:Math.round(mx(arr.map(p=>p.rain))), wave:waves.length?+mx(waves).toFixed(1):null }; };
  const out={};
  Object.keys(byDate).forEach(date=>{ const r=byDate[date]; out[date]=Object.assign(agg(r.all)||{},{am:agg(r.am),pm:agg(r.pm)}); });
  return out;
}

function weatherOf(y, m, d, model){
  const di=dayIndex(y,m,d);
  const b=rnd(di+11,5), b2=rnd(di+7,9); const sh=model==="ecmwf"?-0.12:model==="kma"?0.1:0;
  const SEA_TEMP=[2,4,9,15,20,24,27,28,24,18,11,4]; // 서해 월평균 근사(데모 폴백용)
  const mock={ wave:+Math.max(0.2,0.4+b*1.7+sh*0.6).toFixed(1), wind:Math.round(Math.max(1,3+b2*8+sh*4)), temp:Math.round(SEA_TEMP[m]+(b-0.5)*6), rain:Math.round((b2*70)%100) };
  const real=curWeather()[ymd(y,m,d)];
  if(real){ return {
    temp: real.temp!=null?real.temp:mock.temp,
    wind: real.wind!=null?real.wind:mock.wind,
    wave: real.wave!=null?real.wave:mock.wave,
    rain: real.rain!=null?real.rain:mock.rain,
    _real:true }; }
  return mock;
}
// 날씨 상태 → 아이콘 (파고·강수 기준)
function skyIcon(w){ if((w.rain||0)>=60||(w.wave||0)>1.8) return "🌧️"; if((w.rain||0)>=30||(w.wave||0)>1.2) return "⛅"; return "☀️"; }
// 오전/오후 날씨 (실측 am/pm 있으면 사용, 없으면 데모)
function weatherAMPM(y,m,d,model){
  const real=curWeather()[ymd(y,m,d)];
  if(real && real.am && real.pm) return { am:skyIcon(real.am), pm:skyIcon(real.pm), _real:true };
  const base=weatherOf(y,m,d,model);
  const s=rnd(dayIndex(y,m,d)+3,2);
  const am={ rain:Math.round((base.rain||0)*0.65), wave:+((base.wave||0.5)*0.9).toFixed(1) };
  const pm={ rain:Math.min(100,Math.round((base.rain||0)*1.15+s*18)), wave:+((base.wave||0.5)*1.1).toFixed(1) };
  return { am:skyIcon(am), pm:skyIcon(pm) };
}
function goScore(w){ if(w.wave<=1.0&&w.wind<=7)return{t:"출조 좋음",c:C.tide}; if(w.wave<=1.5&&w.wind<=10)return{t:"무난",c:C.inkSoft}; return{t:"너울 주의",c:C.urgent}; }
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

// ── URL 분석(플랫폼 감지) 시뮬레이션 ──
function analyzeUrl(raw){
  const url=(raw||"").trim().toLowerCase();
  if(!url) return { ok:false, msg:"예약 사이트 주소를 입력하세요." };
  if(!/\./.test(url)) return { ok:false, msg:"올바른 주소 형식이 아니에요. (예: www.○○fishing.com)" };
  if(/sunsang24\.com/.test(url)){
    const sub=(raw.match(/^https?:\/\/([a-z0-9-]+)\.sunsang24\.com/i)||[])[1]||"";
    const isSub=sub && sub!=="www";
    return { ok:true, tier:isSub?"auto":"semi", platform:"선상24(sunsang24)",
      name:isSub?`선상24 · ${sub}`:"선상24 (선사 선택 필요)", port:"전국",
      species:["갈치","쭈꾸미","갑오징어"],
      reserveUrl:isSub?`https://${sub}.sunsang24.com/ship/schedule_fleet`:raw,
      boats:isSub?[{name:sub,cap:20}]:[],
      notes:isSub?["schedule_fleet에서 남은자리를 직접 파싱 — 좌석 계산 불필요","배 이름은 봇이 예약현황을 읽으면 실제 이름으로 채워집니다","정확한 실데이터는 spots.json(봇)에 추가하세요"]
                 :["www 집계 페이지 — 원하는 선사의 서브도메인(○○.sunsang24.com)을 골라 연동하세요"] };
  }
  if(/mscufishing|thefishing|myfishmap|fishmap/.test(url)){
    const cu=/mscufishing/.test(url);
    return { ok:true, tier:"auto", platform:"더피싱(thefishing.kr)",
      name:cu?"삼길포 씨유만석낚시":"감지된 출조점", port:cu?"충남 서산 삼길포":"충남 서해권",
      species:["쭈꾸미","갑오징어","우럭"], reserveUrl:raw.replace(/\/+$/,"")+"/index.php?mid=bk",
      boats:cu?[{name:"만석호",cap:20},{name:"헌터호",cap:15},{name:"골드피싱호",cap:15}]:[{name:"1호선",cap:18}],
      notes:["플랫폼 어댑터로 자동 연동 — 예약현황에서 잔여석 파싱","선비 입금확인=예약완료 · 최소 출항인원 있음"] };
  }
  if(/naver|booking|place/.test(url)) return { ok:true, tier:"semi", platform:"네이버 예약(추정)", name:"네이버 예약 출조점", port:"확인 필요", species:["쭈꾸미","갑오징어"], reserveUrl:raw, boats:[{name:"배편 A",cap:20}], notes:["예약 위젯 동적 로딩 — 반자동 연동"] };
  if(/blog|cafe|band/.test(url)) return { ok:true, tier:"link", platform:"블로그/카페", name:"블로그 기반 선사", port:"확인 필요", species:[], reserveUrl:raw, boats:[], notes:["정형 예약창 없음 — 링크로 연결"] };
  return { ok:true, tier:"semi", platform:"자체 사이트(미지 구조)", name:"새 출조점", port:"확인 필요", species:["쭈꾸미"], reserveUrl:raw, boats:[{name:"배편",cap:18}], notes:["알려진 플랫폼 아님 — 예약 페이지 지정 후 반자동, 실패 시 링크"] };
}
const TIER = { auto:{t:"자동 연동",c:C.ok,ic:"✅"}, semi:{t:"반자동 (확인 필요)",c:C.beacon,ic:"⚠️"}, link:{t:"링크 연결",c:C.inkSoft,ic:"🔗"} };

// ── 물때 곡선 SVG ──
function tideSVG(amp){
  const W=320,H=110,mean=55,period=12.42,t0=2.1;
  const y=(t)=>mean-(amp/900*42)*Math.cos((2*Math.PI*(t-t0))/period);
  let pts=[]; for(let t=0;t<=24;t+=0.4) pts.push(`${(t/24*W).toFixed(1)},${y(t).toFixed(1)}`);
  const highs=[],lows=[];
  for(let k=-1;k<3;k++){ const th=t0+k*period, tl=t0+period/2+k*period; if(th>=0&&th<=24)highs.push(th); if(tl>=0&&tl<=24)lows.push(tl); }
  const fmt=(t)=>`${pad2(Math.floor(t))}:${pad2(Math.round((t%1)*60))}`;
  let g="";
  [0,6,12,18,24].forEach(t=>{ g+=`<line x1="${t/24*W}" y1="8" x2="${t/24*W}" y2="92" stroke="${C.line}"/>`; });
  g+=`<polygon points="0,92 ${pts.join(" ")} ${W},92" fill="${C.tideSoft}" opacity="0.7"/>`;
  g+=`<polyline points="${pts.join(" ")}" fill="none" stroke="${C.tide}" stroke-width="2.5"/>`;
  highs.forEach(t=>{ g+=`<circle cx="${t/24*W}" cy="${y(t)}" r="3.5" fill="${C.tide}"/><text x="${t/24*W}" y="${y(t)-7}" font-size="9" fill="${C.ink}" text-anchor="middle">만조 ${fmt(t)}</text>`; });
  lows.forEach(t=>{ g+=`<circle cx="${t/24*W}" cy="${y(t)}" r="3.5" fill="${C.beacon}"/><text x="${t/24*W}" y="${y(t)+14}" font-size="9" fill="${C.inkSoft}" text-anchor="middle">간조 ${fmt(t)}</text>`; });
  [0,6,12,18,24].forEach(t=>{ g+=`<text x="${t/24*W}" y="104" font-size="8" fill="${C.inkSoft}" text-anchor="middle">${t}시</text>`; });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%">${g}</svg>`;
}

// ── 상대시간 ──
function relTime(iso){ if(!iso)return null; const diff=(Date.now()-new Date(iso))/60000; if(diff<1)return "방금"; if(diff<60)return `${Math.floor(diff)}분 전`; if(diff<1440)return `${Math.floor(diff/60)}시간 전`; return `${Math.floor(diff/1440)}일 전`; }

// ── 렌더 ──
function view(){ return new Date(new Date().getFullYear(), new Date().getMonth()+S.monthOff, 1); }

function renderHeader(){
  const upd = relTime(S.data.updated);
  const chips = ["전체", ...S.speciesList];
  const addForm = S.addingSp ? `
    <div class="row gap" style="margin-top:8px">
      <input id="spIn" value="${esc(S.spDraft)}" placeholder="어종 입력 (예: 광어)" maxlength="10"
        style="flex:1;border:none;border-radius:10px;padding:9px 12px;font-size:13px;outline:none;color:#0e2a30" />
      <button data-action="spadd" style="background:${C.beacon};color:#fff;border:none;border-radius:10px;padding:0 14px;font-size:13px;font-weight:800;cursor:pointer">추가</button>
      <button data-action="spcancel" style="background:rgba(255,255,255,.15);color:#fff;border:none;border-radius:10px;padding:0 12px;font-size:13px;font-weight:700;cursor:pointer">취소</button>
    </div>` : "";
  return `<div class="hdr" style="background-image:linear-gradient(180deg,rgba(14,42,48,.74),rgba(14,42,48,.48)),url('${bgFor(S.species)}');background-size:cover;background-position:center;">
    <div class="row gap">
      <span style="font-size:18px">⚓</span>
      <div style="font-size:19px;font-weight:800;letter-spacing:-.5px">물때빈자리</div>
      <div style="margin-left:auto;font-size:11px;opacity:.85">${upd?`↻ ${upd} 업데이트`:"오프라인 데이터"}</div>
    </div>
    <div style="font-size:12px;opacity:.85;margin-top:4px">서해 선상 · 쭈꾸미 · 갑오징어 · 백조기</div>
    <div class="chips">
      ${chips.map(s=>{
        const isCustom = s!=="전체" && !BASE_SPECIES.includes(s);
        const label = s==="전체"?s:spEmoji(s)+" "+esc(s);
        const del = (isCustom && S.species===s) ? ` <span data-action="spdel" data-v="${esc(s)}" style="opacity:.85;font-weight:900">✕</span>` : "";
        return `<button class="chip ${S.species===s?"on":""}" data-action="species" data-v="${esc(s)}">${label}${del}</button>`;
      }).join("")}
      <button class="chip" data-action="addsp" title="어종 추가" style="font-weight:800">＋ 어종</button>
    </div>
    ${addForm}
  </div>`;
}

// 달력 뒤 물 흐름 배경은 제거됨 (요청)


function renderCalendar(){
  const v=view(), y=v.getFullYear(), m=v.getMonth();
  const dim=new Date(y,m+1,0).getDate(), fdow=new Date(y,m,1).getDay();
  const weeks=Math.ceil((fdow+dim)/7);
  const today=new Date(); const todayMid=new Date(today.getFullYear(),today.getMonth(),today.getDate());
  let cells="";
  for(let i=0;i<fdow;i++) cells+=`<div></div>`;
  const portSel = S.port && S.port!=="전체";
  for(let d=1;d<=dim;d++){
    const dt=new Date(y,m,d), past=dt<todayMid, di=dayIndex(y,m,d);
    let sum=0, hasData=false;
    if(!past) for(const b of boatsForSp(S.species)){ const s=seatsOf(b,y,m,d); if(s!==null){ hasData=true; sum+=s; } }
    const t=tideInfo(di), on=S.sel===d, ap=weatherAMPM(y,m,d,S.model);
    const fill = portSel ? `<div class="cellfill" style="height:${Math.round(tideFrac(di)*100)}%"></div>` : "";
    cells+=`<button class="cell ${on?"on":""}" data-action="day" data-v="${d}" ${past?"disabled":""}>
      ${fill}
      <div class="cellin">
        <div class="d">${d}</div>
        ${past ? `<div class="none">지남</div>`
          : (!hasData ? `<div class="none" style="font-size:9px">정보없음</div>`
            : (sum>0 ? `<div class="open">빈 ${sum}</div>` : `<div class="none">마감</div>`))}
        <div class="mul">${t.mul}물</div>
        <div class="wv" style="justify-content:center;gap:3px;font-size:9px"><span title="오전">${ap.am}</span><span title="오후">${ap.pm}</span></div>
      </div>
    </button>`;
  }
  const ml=`${y}.${pad2(m+1)}`;
  let detail = S.sel ? renderDetail(y,m,S.sel) : `<div style="margin-top:20px;text-align:center;color:${C.inkSoft};font-size:13px;padding:24px 0">⚓<br>날짜를 눌러 물때·날씨·빈자리 배를 확인하세요.</div>`;
  const ports=activePorts();
  const results = S.portResults.length ? `<div class="card" style="margin-bottom:8px;padding:4px">
      ${S.portResults.map((r,i)=>`<div data-action="portpick" data-v="${i}" style="padding:9px 10px;border-radius:8px;cursor:pointer;display:flex;align-items:center;gap:8px">
        <span>📍</span><span style="font-size:13px;font-weight:700">${esc(r.name)}</span>
        <span style="font-size:11px;color:${C.inkSoft};flex:1">${esc(r.admin)}${r.cc&&r.cc!=="KR"?" · "+esc(r.cc):""}</span>
        <span style="font-size:11px;color:${C.tide};font-weight:700">선택</span></div>`).join("")}
    </div>` : "";
  const addRow = S.addingPort ? `<div style="margin-bottom:8px">
      <div class="row gap">
        <input id="portIn" value="${esc(S.portDraft)}" placeholder="지명 검색 (예: 격포, 오천, 남당)" maxlength="20" style="flex:1;border:1px solid ${C.line};border-radius:8px;padding:8px;font-size:12.5px;outline:none" />
        <button data-action="portsearch" style="background:${C.tide};color:#fff;border:none;border-radius:8px;padding:0 12px;font-size:12.5px;font-weight:800;cursor:pointer">${S.portSearching?"검색중…":"🔍 검색"}</button>
        <button data-action="portcancel" style="background:#fff;color:${C.inkSoft};border:1px solid ${C.line};border-radius:8px;padding:0 10px;font-size:12.5px;cursor:pointer">취소</button>
      </div>
      ${results}
      <div style="font-size:10.5px;color:${C.inkSoft};margin-top:2px">검색해서 고르면 좌표가 자동 입력돼 그 지역 실날씨가 나와요. 안 잡히면 <button data-action="portadd2" style="border:none;background:none;color:${C.tide};font-weight:700;cursor:pointer;padding:0;font-size:10.5px">이름만 추가</button></div>
    </div>` : "";
  const portRow = `<div class="ports">
      <button class="port ${S.port==="전체"?"on":""}" data-action="port" data-v="전체">전체 항구</button>
      ${ports.map(p=>{
        const sel=S.port===p;
        const del = sel ? ` <span data-action="portdel" data-v="${esc(p)}" style="font-weight:900;opacity:.9">✕</span>` : "";
        return `<button class="port ${sel?"on":""}" data-action="port" data-v="${esc(p)}">📍 ${esc(p)}${del}</button>`;
      }).join("")}
      <button class="port" data-action="portadd" style="font-weight:800">＋ 항구</button>
    </div>${addRow}`;
  return `<div class="pad">
    <div class="row" style="justify-content:space-between;margin-bottom:10px">
      <button class="navbtn" data-action="month" data-v="-1">◀</button>
      <div style="font-size:16px;font-weight:800">${ml}</div>
      <button class="navbtn" data-action="month" data-v="1">▶</button>
    </div>
    ${portRow}
    <div class="cal" style="margin-bottom:5px">${DOW.map((d,i)=>`<div class="dow" style="color:${i===0?C.urgent:i===6?C.tide:C.inkSoft}">${d}</div>`).join("")}</div>
    <div class="cal">${cells}</div>
    <div class="row" style="gap:12px;margin-top:12px;font-size:10.5px;color:${C.inkSoft}">
      <span><b style="color:${C.beacon}">빈 N</b> 빈자리</span><span><b style="color:${C.full}">마감</b> 예약완료</span><span><b style="color:${C.inkSoft}">정보없음</b> 미수집</span>${S.port&&S.port!=="전체"?`<span><b style="color:#3fbfa0">▨</b> 물높이(물때)</span>`:`<span>🌊 파고</span>`}
    </div>
    ${detail}
  </div>`;
}

function renderDetail(y,m,d){
  const di=dayIndex(y,m,d), t=tideInfo(di), w=weatherOf(y,m,d,S.model), gs=goScore(w);
  const dt=new Date(y,m,d);
  const boats=boatsForSp(S.species);
  let list="";
  for(const b of boats){
    const open=seatsOf(b,y,m,d), noData=open===null, soldout=open===0, urgent=open>0&&open<=2;
    const ranges=S.subs[b.id]||[]; const on=ranges.length>0; const editing=S.editBoat===b.id;
    list+=`<div class="card" style="padding:12px;margin-top:8px;${soldout?"opacity:.62":""}">
      <div class="row" style="align-items:flex-start">
        <div style="flex:1">
          <div class="row gap"><span>🚢</span><span style="font-size:15px;font-weight:800">${esc(b.name)}</span>${b.url?`<span style="font-size:9px;font-weight:800;color:${C.ok};background:#d6ede2;border-radius:5px;padding:1px 5px">연동</span>`:""}</div>
          <div style="font-size:11.5px;color:${C.inkSoft};margin-top:4px">📍 ${esc(b._port||"")} · ${esc(b._spot||"")}</div>
          <div class="row" style="gap:10px;font-size:11.5px;color:${C.inkSoft};margin-top:5px"><span>🕕 ${esc(b.dep||"")} 출항</span><span>선비 ${b.fee?b.fee+"만":"문의"}</span></div>
          <div style="margin-top:6px">${(b.sp||[]).map(s=>`<span class="tag">${spEmoji(s)} ${esc(s)}</span>`).join("")}</div>
          ${b.url?`<a href="${esc(b.url)}" target="_blank" rel="noopener" style="display:inline-flex;gap:3px;font-size:11px;font-weight:700;margin-top:7px">↗ 예약 사이트에서 확정</a>`:""}
        </div>
        <div style="text-align:right;min-width:66px">
          ${noData?`<div style="font-size:12px;font-weight:700;color:${C.inkSoft}">정보 없음</div><div style="font-size:9.5px;color:${C.inkSoft};margin-top:2px">예약 사이트 확인</div>`:
            soldout?`<div style="font-size:13px;font-weight:800;color:${C.full}">마감</div>`:
            `<div style="font-size:20px;font-weight:900;color:${urgent?C.urgent:C.beacon};line-height:1">${open}</div>
             <div style="font-size:10px;color:${C.inkSoft};margin-top:2px">👥 /${b.cap}석</div>
             ${open<(b.minGo||0)?`<div style="font-size:9.5px;color:${C.inkSoft};margin-top:2px">최소 ${b.minGo}인</div>`:""}
             ${urgent?`<div style="font-size:10px;font-weight:800;color:${C.urgent};margin-top:2px">마감임박</div>`:""}`}
        </div>
      </div>
      ${editing ? periodEditor(b) : `<div class="row" style="gap:8px;margin-top:10px">
        <button class="subbtn ${on?"on":""}" style="margin-top:0;flex:1" data-action="sub" data-v="${esc(b.id)}">${on?`🔔 알림 ${ranges.length}개 기간`:"🔕 빈자리 알림"}</button>
        <button data-action="boatdel" data-v="${esc(b.id)}" title="이 배 숨기기" style="border:1px solid ${C.line};background:#fff;color:${C.inkSoft};border-radius:10px;padding:9px 11px;font-size:12.5px;font-weight:700;cursor:pointer">🗑</button>
      </div>`}
    </div>`;
  }
  return `<div style="margin-top:16px">
    <div class="row gap" style="margin-bottom:8px">
      <div style="font-size:16px;font-weight:800">${m+1}월 ${d}일 (${DOW[dt.getDay()]})</div>
      <span style="background:${C.tideSoft};color:${C.tide};font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px">${t.label}</span>
    </div>
    <div class="card" style="padding:12px 12px 6px">
      <div class="row" style="gap:4px;font-size:12px;font-weight:700;color:${C.inkSoft};margin-bottom:2px">💧 조석 (물때 곡선)</div>
      ${tideSVG(t.amp)}
    </div>
    <div class="card" style="padding:12px;margin-top:10px">
      <div class="row" style="justify-content:space-between;margin-bottom:10px">
        <div style="font-size:12px;font-weight:700;color:${C.inkSoft}">기상 예보</div>
        <div class="row" style="gap:4px">${MODELS.map(md=>`<button class="modelbtn ${S.model===md.id?"on":""}" data-action="model" data-v="${md.id}">${md.label}</button>`).join("")}</div>
      </div>
      <div style="font-size:10px;color:${C.inkSoft};margin-bottom:10px">${w._real?"소스: 실측 · Open-Meteo(항구별·오전/오후)":"소스: 데모값 (실측 로딩 중이거나 예보 범위 밖)"}</div>
      <div class="cal" style="grid-template-columns:repeat(4,1fr)">
        ${metric("🌡️",w.temp+"°","기온")}${metric("🌊",w.wave+"m","파고",w.wave>1.5)}${metric("💨",w.wind,"풍속 m/s",w.wind>10)}${metric("💧",w.rain+"%","강수")}
      </div>
      <div class="row" style="justify-content:center;gap:22px;margin-top:10px;padding:8px 0;border-top:1px solid ${C.line}">
        ${(()=>{const ap=weatherAMPM(y,m,d,S.model);return `<div style="text-align:center"><div style="font-size:18px">${ap.am}</div><div style="font-size:10px;color:${C.inkSoft};margin-top:1px">오전</div></div><div style="text-align:center"><div style="font-size:18px">${ap.pm}</div><div style="font-size:10px;color:${C.inkSoft};margin-top:1px">오후</div></div>`;})()}
      </div>
      <div style="margin-top:10px;background:${"#eef2f1"};border-radius:8px;padding:8px 10px;font-size:12px;font-weight:700;color:${gs.c}">⚓ ${gs.t}</div>
    </div>
    <div style="font-size:13px;font-weight:800;margin:16px 2px 8px">이 날 배 ${boats.length}척</div>
    ${list}
  </div>`;
}
function metric(ic,v,l,hot){ return `<div class="metric"><div style="font-size:15px">${ic}</div><div class="v" style="color:${hot?C.urgent:C.ink}">${v}</div><div class="l">${l}</div></div>`; }

function renderAdd(){
  let res="";
  if(S.analyzing) res=`<div style="text-align:center;color:${C.inkSoft};font-size:13px;padding:24px 0">사이트 구조를 분석하는 중…</div>`;
  else if(S.result && !S.result.ok) res=`<div style="margin-top:12px;background:#f7e5d1;color:${C.urgent};border-radius:12px;padding:12px;font-size:13px;font-weight:700">⚠️ ${esc(S.result.msg)}</div>`;
  else if(S.result){ const r=S.result, ti=TIER[r.tier];
    res=`<div class="card" style="margin-top:12px;overflow:hidden">
      <div class="row gap" style="padding:10px 14px;background:${r.tier==="auto"?"#d6ede2":r.tier==="semi"?"#f7e5d1":"#eef2f1"}">
        <span>${ti.ic}</span><span style="font-size:13px;font-weight:800;color:${ti.c}">${ti.t}</span>
        <span style="margin-left:auto;font-size:11px;color:${C.inkSoft}">플랫폼: ${esc(r.platform)}</span>
      </div>
      <div style="padding:14px">
        <div style="font-size:16px;font-weight:800">${esc(r.name)}</div>
        <div style="font-size:12px;color:${C.inkSoft};margin-top:3px">📍 ${esc(r.port)}</div>
        ${r.species.length?`<div style="margin-top:8px">${r.species.map(s=>`<span class="tag">${esc(s)}</span>`).join("")}</div>`:""}
        ${r.boats.length?`<div style="margin-top:12px"><div style="font-size:12px;font-weight:700;color:${C.inkSoft};margin-bottom:6px">감지된 배 ${r.boats.length}척</div>${r.boats.map(b=>`<div class="row gap" style="font-size:13px;margin-bottom:4px">🚢 <span style="font-weight:700">${esc(b.name)}</span><span style="margin-left:auto;font-size:11px;color:${C.inkSoft}">${b.cap}인승</span></div>`).join("")}</div>`:""}
        <div style="margin-top:12px;background:#eef2f1;border-radius:10px;padding:10px">${r.notes.map(n=>`<div style="font-size:11.5px;color:${C.inkSoft};margin-bottom:4px">ℹ️ ${esc(n)}</div>`).join("")}</div>
        <div style="margin-top:10px;border:1px solid ${C.line};border-radius:10px;padding:10px">
          <div style="font-size:11.5px;font-weight:800">ℹ️ 개인·지인용 관심목록</div>
          <div style="font-size:11px;color:${C.inkSoft};margin-top:5px;line-height:1.55">내가 다니는 출조점만 담아 함께 보는 용도예요. 사이트에 무리한 반복 조회는 피하고, 예약·입금은 선사 예약창에서 진행합니다.</div>
        </div>
        <button data-action="addop" style="width:100%;margin-top:12px;padding:12px;border-radius:12px;border:none;background:${C.beacon};color:#fff;font-size:14px;font-weight:800;cursor:pointer">➕ 이 선사 연동하기</button>
        <button data-action="share" style="width:100%;margin-top:8px;padding:11px;border-radius:12px;border:1px solid ${C.line};background:#fff;color:${C.ink};font-size:13px;font-weight:800;cursor:pointer">🔗 지인에게 공유 (시트에 등록)</button>
      </div>
    </div>`;
  }
  const added = S.extra.length?`<div style="margin-top:16px"><div style="font-size:13px;font-weight:800;margin-bottom:8px">연동된 선사(이 기기)</div>${S.extra.map((sp,i)=>`<div class="card row gap" style="padding:9px 12px;margin-bottom:6px">✅ <span style="font-size:13px;font-weight:700">${esc(sp.name)}</span><span style="font-size:11px;color:${C.inkSoft};flex:1">${esc(sp.port)}</span><span data-action="extradel" data-v="${i}" style="color:${C.urgent};font-weight:900;cursor:pointer;padding:0 4px">✕</span></div>`).join("")}<div style="font-size:10.5px;color:${C.inkSoft};margin-top:2px">실데이터·정확한 배 이름은 봇(spots.json)에 추가해야 나와요.</div></div>`:"";
  const hiddenList = (S.hidden&&S.hidden.length)?`<div style="margin-top:16px"><div style="font-size:13px;font-weight:800;margin-bottom:8px">숨긴 배 ${S.hidden.length}척</div>${S.hidden.map(id=>{const b=allBoatsRaw().find(x=>x.id===id);return `<div class="card row gap" style="padding:9px 12px;margin-bottom:6px">🗑 <span style="font-size:13px;font-weight:700;flex:1">${esc(b?b.name:id)}</span><button data-action="boatshow" data-v="${esc(id)}" style="border:1px solid ${C.line};background:#fff;color:${C.tide};border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:700;cursor:pointer">복원</button></div>`;}).join("")}</div>`:"";
  return `<div class="pad">
    <div style="font-size:17px;font-weight:800">선사 추가</div>
    <div style="font-size:12px;color:${C.inkSoft};margin-top:4px;line-height:1.6">예약 사이트 주소를 넣으면 플랫폼을 감지해 배·예약현황을 연동해요.</div>
    <div class="card" style="padding:12px;margin-top:12px">
      <div style="font-size:12px;font-weight:700;color:${C.inkSoft};margin-bottom:8px">🔗 예약 사이트 주소</div>
      <div class="row" style="gap:6px">
        <input id="urlIn" class="input" placeholder="www.mscufishing.com" value="${esc(S.urlDraft)}" />
        <button class="primary" data-action="analyze">🔍 분석</button>
      </div>
      <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">
        ${["www.mscufishing.com","네이버예약 링크","낚시 블로그"].map(ex=>`<button data-action="fillurl" data-v="${esc(ex)}" style="font-size:10.5px;color:${C.inkSoft};background:#eef2f1;border:1px solid ${C.line};border-radius:999px;padding:4px 10px;cursor:pointer">예: ${esc(ex)}</button>`).join("")}
      </div>
    </div>
    ${res}
    ${added}
    ${hiddenList}
    ${shared}
  </div>`;
}

function periodEditor(b){
  const rows = S.editRanges.length
    ? S.editRanges.map((r,i)=>`<div class="row gap" style="font-size:12.5px;margin-bottom:4px"><span style="flex:1">📅 ${esc(r.replace("~"," ~ "))}</span><span data-action="rangedel" data-v="${i}" style="color:${C.urgent};font-weight:900;cursor:pointer;padding:0 6px">✕</span></div>`).join("")
    : `<div style="font-size:12px;color:${C.inkSoft};margin-bottom:6px">아직 지정한 기간이 없어요. 아래에서 추가하세요.</div>`;
  return `<div style="margin-top:10px;border:1px solid ${C.line};border-radius:12px;padding:12px">
    <div style="font-size:12.5px;font-weight:800;margin-bottom:8px">🔔 ${esc(b.name)} 알림 기간</div>
    ${rows}
    <div class="row gap" style="margin-top:8px">
      <input type="date" id="edFrom" value="${esc(S.editFrom)}" style="flex:1;border:1px solid ${C.line};border-radius:8px;padding:8px;font-size:12.5px" />
      <span style="color:${C.inkSoft}">~</span>
      <input type="date" id="edTo" value="${esc(S.editTo)}" style="flex:1;border:1px solid ${C.line};border-radius:8px;padding:8px;font-size:12.5px" />
      <button data-action="rangeadd" style="background:${C.tide};color:#fff;border:none;border-radius:8px;padding:0 12px;font-size:12.5px;font-weight:800;cursor:pointer">기간 추가</button>
    </div>
    <div class="row gap" style="margin-top:10px">
      <button data-action="subsave" data-v="${esc(b.id)}" style="flex:1;background:${C.beacon};color:#fff;border:none;border-radius:10px;padding:10px;font-size:13px;font-weight:800;cursor:pointer">저장</button>
      <button data-action="suboff" data-v="${esc(b.id)}" style="background:#fff;color:${C.urgent};border:1px solid ${C.line};border-radius:10px;padding:10px 12px;font-size:12.5px;font-weight:700;cursor:pointer">알림 끄기</button>
      <button data-action="editcancel" style="background:#fff;color:${C.inkSoft};border:1px solid ${C.line};border-radius:10px;padding:10px 12px;font-size:12.5px;cursor:pointer">취소</button>
    </div>
    <div style="font-size:10.5px;color:${C.inkSoft};margin-top:8px">지정 기간에 빈자리가 뜨면 단톡방으로 알림이 가요.</div>
  </div>`;
}

async function submitSub(boatId, boatName, rangesArr){
  if(!API_URL){ toast("구글 시트(API_URL) 설정 후 저장돼요"); return false; }
  try{
    const q=`?action=savesub&boatId=${encodeURIComponent(boatId)}&boatName=${encodeURIComponent(boatName||"")}&ranges=${encodeURIComponent(rangesArr.join(","))}`;
    await fetch(API_URL+q);
    return true;
  }catch{ toast("저장 실패 — 네트워크 확인"); return false; }
}


function renderAlerts(){
  const ids = Object.keys(S.subs);
  const body = ids.length ? ids.map(id=>{
    const b = allBoats().find(x=>x.id===id) || {name:id, _port:"", sp:[]};
    const ranges = S.subs[id]||[];
    return `<div class="card" style="padding:13px;margin-bottom:8px">
      <div class="row"><div style="flex:1">
        <div class="row gap">🔔 <span style="font-size:15px;font-weight:800">${esc(b.name)}</span></div>
        <div style="font-size:11.5px;color:${C.inkSoft};margin-top:3px">${esc(b._port||"")} · ${(b.sp||[]).join("·")}</div>
      </div></div>
      <div style="margin-top:8px">${ranges.map(r=>`<span style="display:inline-block;font-size:11px;font-weight:700;color:${C.tide};background:${C.tideSoft};border-radius:6px;padding:3px 8px;margin:0 4px 4px 0">📅 ${esc(r.replace("~"," ~ "))}</span>`).join("")}</div>
    </div>`;
  }).join("")
    : `<div class="card" style="border-style:dashed;padding:28px;text-align:center;color:${C.inkSoft}">🔔<div style="font-size:13px;font-weight:700;color:${C.ink};margin-top:8px">아직 알림 설정한 배가 없어요</div><div style="font-size:12px;margin-top:4px">빈자리 탭 → 날짜 → 배의 "빈자리 알림"에서 기간을 지정하세요.</div></div>`;
  return `<div class="pad">
    <div style="font-size:17px;font-weight:800;margin-bottom:4px">빈자리 알림</div>
    <div style="font-size:12px;color:${C.inkSoft};margin-bottom:14px">담아둔 배에 빈자리가 뜨면 텔레그램으로 알려드려요.</div>
    ${body}
    <div style="background:${C.ink};color:#fff;border-radius:14px;padding:14px;margin-top:16px">
      <div class="row gap" style="font-size:13px;font-weight:800">✈️ 텔레그램으로 함께 받기</div>
      <div style="font-size:11.5px;opacity:.82;margin-top:6px;line-height:1.6">봇을 우리 단톡방에 넣으면, 빈자리가 뜰 때 지인들과 한 번에 알림을 받아요. (설정은 알림봇 저장소 README 참고)</div>
      <button data-action="tg" style="width:100%;margin-top:10px;padding:9px;border-radius:10px;border:none;background:${C.beacon};color:#fff;font-size:12.5px;font-weight:800;cursor:pointer">✈️ 텔레그램 봇 연결 안내</button>
    </div>
  </div>`;
}

function renderTabbar(){
  const t=(id,ic,label)=>`<button class="tab ${S.tab===id?"on":""}" data-action="tab" data-v="${id}"><span class="ic">${ic}</span><span>${label}</span></button>`;
  return `<div class="tabbar">${t("cal","🌊","빈자리")}${t("add","➕","선사추가")}${t("alerts","🔔","알림"+(Object.keys(S.subs).length?" "+Object.keys(S.subs).length:""))}</div>`;
}

function renderInstallBar(){
  return `<div class="installbar" id="installbar"><span>📲</span><span style="font-size:12.5px">홈 화면에 설치하면 앱처럼 쓸 수 있어요</span><button data-action="install">설치</button></div>`;
}

function render(){
  let body="";
  if(S.tab==="cal") body=renderCalendar();
  else if(S.tab==="add") body=renderAdd();
  else body=renderAlerts();
  document.getElementById("app").innerHTML =
    renderHeader() + renderInstallBar() + body + renderTabbar() + `<div class="toast" id="toast"></div>`;
  if(S.deferredPrompt){ const ib=document.getElementById("installbar"); if(ib) ib.classList.add("show"); }
}

let toastTimer;
function toast(msg){ const el=document.getElementById("toast"); if(!el)return; el.textContent="✓ "+msg; el.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove("show"),2400); }

// ── 이벤트 (위임) ──
document.addEventListener("click",(e)=>{
  const el=e.target.closest("[data-action]"); if(!el)return;
  const a=el.dataset.action, v=el.dataset.v;
  if(a==="species"){ S.species=v; S.sel=null; S.addingSp=false; render(); }
  else if(a==="addsp"){ S.addingSp=!S.addingSp; S.spDraft=""; render(); if(S.addingSp){ const el=document.getElementById("spIn"); if(el) el.focus(); } }
  else if(a==="spadd"){ addSpecies(); }
  else if(a==="spcancel"){ S.addingSp=false; S.spDraft=""; render(); }
  else if(a==="spdel"){ removeSpecies(v); }
  else if(a==="month"){ S.monthOff+=parseInt(v,10); S.sel=null; render(); }
  else if(a==="port"){ S.port=v; S.sel=null; S.addingPort=false; render(); ensureWeather(); }
  else if(a==="portadd"){ S.addingPort=!S.addingPort; S.portDraft=""; S.portResults=[]; render(); if(S.addingPort){ const el=document.getElementById("portIn"); if(el) el.focus(); } }
  else if(a==="portadd2"){ addPort(); }
  else if(a==="portsearch"){ searchPorts(); }
  else if(a==="portpick"){ pickPort(parseInt(v,10)); }
  else if(a==="portcancel"){ S.addingPort=false; S.portDraft=""; render(); }
  else if(a==="portdel"){ removePort(v); }
  else if(a==="day"){ S.sel=parseInt(v,10); render(); }
  else if(a==="model"){ S.model=v; render(); }
  else if(a==="sub"){ S.editBoat=v; S.editRanges=(S.subs[v]||[]).slice(); S.editFrom=""; S.editTo=""; render(); }
  else if(a==="editcancel"){ S.editBoat=null; S.editRanges=[]; render(); }
  else if(a==="rangeadd"){
    const f=document.getElementById("edFrom"), t=document.getElementById("edTo");
    const from=f?f.value:"", to=t?t.value:"";
    if(!from){ toast("시작 날짜를 고르세요"); return; }
    const range = to && to>=from ? `${from}~${to}` : from;
    if(!S.editRanges.includes(range)) S.editRanges.push(range);
    S.editFrom=""; S.editTo=""; render();
  }
  else if(a==="rangedel"){ S.editRanges.splice(parseInt(v,10),1); render(); }
  else if(a==="subsave"){ saveSubForBoat(v); }
  else if(a==="suboff"){ saveSubForBoat(v, true); }
  else if(a==="tab"){ S.tab=v; render(); }
  else if(a==="fillurl"){ S.urlDraft=v; render(); const i=document.getElementById("urlIn"); if(i)i.focus(); }
  else if(a==="analyze"){ const i=document.getElementById("urlIn"); S.urlDraft=i?i.value:""; S.analyzing=true; S.result=null; render(); setTimeout(()=>{ S.result=analyzeUrl(S.urlDraft); S.analyzing=false; render(); },800); }
  else if(a==="addop"){ addOperator(); }
  else if(a==="extradel"){ const i=parseInt(v,10); const nm=S.extra[i]?.name||""; S.extra.splice(i,1); LS.set("extra",S.extra); render(); toast(`${nm} 삭제됨`); }
  else if(a==="boatdel"){ if(!S.hidden.includes(v)){ S.hidden.push(v); LS.set("hidden",S.hidden); } const nm=allBoatsRaw().find(x=>x.id===v)?.name||"배"; render(); toast(`${nm} 숨김 (선사추가 탭에서 복원)`); }
  else if(a==="boatshow"){ S.hidden=S.hidden.filter(x=>x!==v); LS.set("hidden",S.hidden); render(); toast("배를 다시 표시해요"); }
  else if(a==="tg"){ toast("알림봇 저장소 README의 텔레그램 설정을 따라주세요"); }
  else if(a==="share"){ submitUrl(S.urlDraft, (S.result&&S.result.ok)?S.result.name:""); }
  else if(a==="install"){ doInstall(); }
});
// 입력값 유지
document.addEventListener("input",(e)=>{ if(e.target.id==="urlIn") S.urlDraft=e.target.value; if(e.target.id==="spIn") S.spDraft=e.target.value; if(e.target.id==="portIn") S.portDraft=e.target.value; });
// 어종·항구 입력에서 엔터로 추가
document.addEventListener("keydown",(e)=>{ if(e.target.id==="spIn" && e.key==="Enter"){ e.preventDefault(); addSpecies(); } if(e.target.id==="portIn" && e.key==="Enter"){ e.preventDefault(); searchPorts(); } });

function removeSpecies(name){
  S.speciesList = S.speciesList.filter(x=>x!==name);
  LS.set("speciesList", S.speciesList);
  if(S.species===name) S.species="전체";
  render();
  toast(`${name} 삭제됨`);
}

function saveSubForBoat(boatId, off){
  const b = allBoats().find(x=>x.id===boatId) || {name:""};
  const ranges = off ? [] : S.editRanges.slice();
  if(!off && ranges.length===0){ toast("기간을 하나 이상 추가하세요"); return; }
  submitSub(boatId, b.name, ranges).then(ok=>{
    if(off || ranges.length===0) delete S.subs[boatId]; else S.subs[boatId]=ranges;
    LS.set("subsMap", S.subs);
    S.editBoat=null; S.editRanges=[]; render();
    toast(off?"알림을 껐어요":`${b.name} 알림 ${ranges.length}개 기간 저장`);
  });
}

document.addEventListener("input",(e)=>{ if(e.target.id==="edFrom") S.editFrom=e.target.value; if(e.target.id==="edTo") S.editTo=e.target.value; });

function addSpecies(){
  const name = (S.spDraft||"").trim();
  if(!name){ toast("어종 이름을 입력하세요"); return; }
  if(name==="전체" || S.speciesList.includes(name)){ toast("이미 있는 어종이에요"); S.addingSp=false; S.spDraft=""; render(); return; }
  S.speciesList.push(name);
  LS.set("speciesList", S.speciesList);
  S.species=name; S.addingSp=false; S.spDraft=""; S.sel=null;
  render();
  toast(`${spEmoji(name)} ${name} 추가됨`);
}

function addOperator(){
  const r=S.result; if(!r||!r.ok)return;
  const boats=(r.boats.length?r.boats:[{name:r.name,cap:18}]).map((b,i)=>({
    id:`ext-${Date.now()}-${i}`, name:b.name, sp:(r.species.length?r.species:["기타"]).slice(0,2),
    dep:"일출", fee:null, cap:b.cap, minGo:Math.round(b.cap*0.5), url:r.reserveUrl,
  }));
  S.extra.push({ name:r.name, port:r.port, boats });
  LS.set("extra", S.extra);
  S.result=null; S.urlDraft=""; S.tab="cal"; render();
  toast(`${r.name} · 배 ${boats.length}척 연동됨`);
}

// ── 설치 프롬프트 ──
window.addEventListener("beforeinstallprompt",(e)=>{ e.preventDefault(); S.deferredPrompt=e; const ib=document.getElementById("installbar"); if(ib)ib.classList.add("show"); });
async function doInstall(){
  if(!S.deferredPrompt){ toast("설치는 브라우저 메뉴 → '홈 화면에 추가'"); return; }
  S.deferredPrompt.prompt(); await S.deferredPrompt.userChoice; S.deferredPrompt=null;
  const ib=document.getElementById("installbar"); if(ib)ib.classList.remove("show");
}

// ── 데이터 로드 + 부팅 ──
async function boot(){
  S.wx = LS.get("wxCache", {}) || {};   // 오프라인 폴백(마지막 실날씨)
  render();
  ensureWeather();                       // 기본 항구 실날씨 로드
  // 1) 빈자리·출조점: data.json(텔레그램 봇이 갱신) 우선
  try{
    const r = await fetch("data.json", { cache:"no-cache" });
    if(r.ok){ const d = await r.json();
      if(d && d.spots && d.spots.length) S.data = d;
      if(d && d.weather) S.weather = d.weather;
      if(d && d.submissions) S.submissions = d.submissions;
    }
  }catch{ /* 오프라인: 캐시 사용 */ }
  // 2) 구글 시트(Apps Script): 공유목록·구독 보강, 출조점 없으면 시트 것으로
  if(API_URL){
    try{
      const r = await fetch(API_URL + "?action=data", { cache:"no-cache" });
      if(r.ok){ const d = await r.json();
        if(d.submissions && d.submissions.length) S.submissions = d.submissions;
        if(!(S.data.spots && S.data.spots.length) && d.spots && d.spots.length) S.data = d;
        if(Array.isArray(d.subs)){ const m={}; d.subs.forEach(s=>{ if(s.boatId) m[s.boatId]=s.ranges||[]; }); S.subs=m; LS.set("subsMap",m); }
      }
    }catch{}
  }
  render();
  ensureWeather();   // 데이터 로드 후 좌표 확정되면 다시 시도
}

// 공유된 URL을 시트에 등록 (GET 방식이 Apps Script에서 가장 안정적)
async function submitUrl(url, name){
  url = (url||"").trim();
  if(!url){ toast("먼저 주소를 입력하세요"); return; }
  if(!API_URL){ toast("백엔드(API_URL) 설정 후 공유돼요"); return; }
  try{
    const q=`?action=submit&url=${encodeURIComponent(url)}&name=${encodeURIComponent(name||"")}&by=me`;
    await fetch(API_URL+q);
    toast("시트에 공유했어요");
    boot();
  }catch{ toast("공유 실패 — 네트워크 확인"); }
}
boot();

// ── 서비스워커 등록 ──
if("serviceWorker" in navigator){
  window.addEventListener("load",()=>{ navigator.serviceWorker.register("sw.js").catch(()=>{}); });
  // 새 서비스워커가 활성화되면 한 번 자동 새로고침(업데이트 즉시 반영)
  let _reloaded=false;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{ if(_reloaded) return; _reloaded=true; location.reload(); });
}
