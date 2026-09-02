/* 물때빈자리 — 설치형 PWA (의존성 없음) */
"use strict";

// ── 백엔드(Google Apps Script) 주소 ──
// 배포한 웹앱 /exec URL을 넣으면 구글 시트에서 데이터를 읽고, 공유한 URL이 시트에 쌓입니다.
// 비워두면 로컬 data.json 을 사용합니다.
const API_URL = ""; // 예: "https://script.google.com/macros/s/XXXX/exec"

// ── 팔레트 (CSS 변수와 동일) ──
const C = { ink:"#0e2a30", inkSoft:"#4a636a", tide:"#2b8896", tideSoft:"#d3e9ea",
  beacon:"#e07d2a", full:"#9aa6a4", urgent:"#c25236", line:"#d3dcda", ok:"#2f8f6b" };

// ── 기본 데이터(데이터 파일이 없을 때 폴백) ──
const DEFAULT_DATA = {
  updated: null,
  spots: [
    { name:"삼길포 씨유만석낚시", port:"충남 서산 삼길포", boats:[
      { id:"cu-manseok", name:"만석호", sp:["쭈꾸미","갑오징어"], dep:"일출", fee:null, cap:20, minGo:10, url:"http://www.mscufishing.com/index.php?mid=bk" },
      { id:"cu-hunter", name:"헌터호", sp:["갑오징어"], dep:"일출", fee:null, cap:15, minGo:8, url:"http://www.mscufishing.com/index.php?mid=bk" },
      { id:"cu-gold", name:"골드피싱호", sp:["백조기","갑오징어"], dep:"일출", fee:null, cap:15, minGo:8, url:"http://www.mscufishing.com/index.php?mid=bk" },
    ]},
    { name:"오천항 대박호", port:"보령 오천항", boats:[
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
  monthOff: 0, species: "전체", sel: null, model: "openmeteo", tab: "cal",
  subs: new Set(LS.get("subs", [])),
  extra: LS.get("extra", []),          // URL로 추가된 출조점
  speciesList: LS.get("speciesList", BASE_SPECIES),  // 어종 목록(사용자 추가 가능)
  addingSp: false, spDraft: "",
  data: DEFAULT_DATA,
  result: null, analyzing: false, urlDraft: "",
  deferredPrompt: null,
  weather: {},        // 시트/Open-Meteo에서 온 실측 날씨 (date → {temp,wind,wave,rain})
  submissions: [],    // 지인이 공유한 URL 목록
};

// ── 유틸 ──
const strSeed = (s) => { let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return ((h>>>0)%100000)/100000; };
const rnd = (a,b) => { const x=Math.sin(a*928.13+b*47.71)*10000; return x-Math.floor(x); };
const pad2 = (n)=>String(n).padStart(2,"0");
const DOW = ["일","월","화","수","목","금","토"];

function allSpots(){ return [...S.data.spots, ...S.extra]; }
function allBoats(){ const out=[]; for(const sp of allSpots()) for(const b of (sp.boats||[])) out.push({...b, _spot:sp.name, _port:sp.port}); return out; }
function boatsForSp(sp){ const bs=allBoats(); return sp==="전체"?bs:bs.filter(b=>(b.sp||[]).includes(sp)); }

function dayIndex(y,m,d){ return Math.round((Date.UTC(y,m,d)-Date.UTC(2024,0,1))/86400000); }
function ymd(y,m,d){ return `${y}-${pad2(m+1)}-${pad2(d)}`; }

// 잔여석: data.json 우선, 없으면 결정적 자체 생성
function seatsOf(boat, y, m, d){
  const key = ymd(y,m,d);
  const av = S.data.availability?.[boat.id];
  if(av && typeof av[key]==="number") return av[key];
  const r = strSeed(boat.id+key);
  return r<0.42 ? 0 : Math.min(boat.cap||20, Math.ceil(r*9));
}
function tideInfo(di){ const mul=((di%15)+15)%15+1; const spring=Math.abs(Math.sin((mul/15)*Math.PI)); const amp=130+spring*190;
  const label = (mul>=7&&mul<=9)?`${mul}물·사리`:(mul<=2||mul>=14)?`${mul}물·조금`:`${mul}물`; return {mul,amp,label}; }
function weatherOf(y, m, d, model){
  const di=dayIndex(y,m,d);
  const b=rnd(di+11,5), b2=rnd(di+7,9); const sh=model==="ecmwf"?-0.12:model==="kma"?0.1:0;
  const mock={ wave:+Math.max(0.2,0.4+b*1.7+sh*0.6).toFixed(1), wind:Math.round(Math.max(1,3+b2*8+sh*4)), temp:Math.round(17+b*8-di*0.08), rain:Math.round((b2*70)%100) };
  const real=S.weather && S.weather[ymd(y,m,d)];
  if(real){ return {
    temp: real.temp!=null?real.temp:mock.temp,
    wind: real.wind!=null?real.wind:mock.wind,
    wave: real.wave!=null?real.wave:mock.wave,
    rain: real.rain!=null?real.rain:mock.rain,
    _real:true }; }
  return mock;
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
      boats:isSub?[{name:"관심 배",cap:20}]:[],
      notes:isSub?["schedule_fleet에서 남은자리를 직접 파싱 — 좌석 계산 불필요","물때·어종·운항시각 함께 수집"]
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
  return `<div class="hdr">
    <div class="row gap">
      <span style="font-size:18px">⚓</span>
      <div style="font-size:19px;font-weight:800;letter-spacing:-.5px">물때빈자리</div>
      <div style="margin-left:auto;font-size:11px;opacity:.7">${upd?`↻ ${upd} 업데이트`:"오프라인 데이터"}</div>
    </div>
    <div style="font-size:12px;opacity:.75;margin-top:4px">서해 선상 · 쭈꾸미 · 갑오징어 · 백조기</div>
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

function renderCalendar(){
  const v=view(), y=v.getFullYear(), m=v.getMonth();
  const dim=new Date(y,m+1,0).getDate(), fdow=new Date(y,m,1).getDay();
  const today=new Date(); const todayMid=new Date(today.getFullYear(),today.getMonth(),today.getDate());
  let cells="";
  for(let i=0;i<fdow;i++) cells+=`<div></div>`;
  for(let d=1;d<=dim;d++){
    const dt=new Date(y,m,d), past=dt<todayMid, di=dayIndex(y,m,d);
    let open=0; if(!past) for(const b of boatsForSp(S.species)) open+=seatsOf(b,y,m,d);
    const t=tideInfo(di), w=weatherOf(y,m,d,S.model), on=S.sel===d;
    cells+=`<button class="cell ${on?"on":""}" data-action="day" data-v="${d}" ${past?"disabled":""}>
      <div class="d">${d}</div>
      ${open>0?`<div class="open">빈 ${open}</div>`:`<div class="none">${past?"지남":"마감"}</div>`}
      <div class="mul">${t.mul}물</div>
      <div class="wv">🌊<span>${w.wave}m</span></div>
    </button>`;
  }
  const ml=`${y}.${pad2(m+1)}`;
  let detail = S.sel ? renderDetail(y,m,S.sel) : `<div style="margin-top:20px;text-align:center;color:${C.inkSoft};font-size:13px;padding:24px 0">⚓<br>날짜를 눌러 물때·날씨·빈자리 배를 확인하세요.</div>`;
  return `<div class="pad">
    <div class="row" style="justify-content:space-between;margin-bottom:10px">
      <button class="navbtn" data-action="month" data-v="-1">◀</button>
      <div style="font-size:16px;font-weight:800">${ml}</div>
      <button class="navbtn" data-action="month" data-v="1">▶</button>
    </div>
    <div class="cal" style="margin-bottom:5px">${DOW.map((d,i)=>`<div class="dow" style="color:${i===0?C.urgent:i===6?C.tide:C.inkSoft}">${d}</div>`).join("")}</div>
    <div class="cal">${cells}</div>
    <div class="row" style="gap:12px;margin-top:12px;font-size:10.5px;color:${C.inkSoft}">
      <span><b style="color:${C.beacon}">빈 N</b> 빈자리</span><span><b style="color:${C.full}">마감</b> 예약완료</span><span>🌊 파고</span>
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
    const open=seatsOf(b,y,m,d), soldout=open===0, urgent=open>0&&open<=2, on=S.subs.has(b.id);
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
          ${soldout?`<div style="font-size:13px;font-weight:800;color:${C.full}">마감</div>`:
            `<div style="font-size:20px;font-weight:900;color:${urgent?C.urgent:C.beacon};line-height:1">${open}</div>
             <div style="font-size:10px;color:${C.inkSoft};margin-top:2px">👥 /${b.cap}석</div>
             ${open<(b.minGo||0)?`<div style="font-size:9.5px;color:${C.inkSoft};margin-top:2px">최소 ${b.minGo}인</div>`:""}
             ${urgent?`<div style="font-size:10px;font-weight:800;color:${C.urgent};margin-top:2px">마감임박</div>`:""}`}
        </div>
      </div>
      <button class="subbtn ${on?"on":""}" data-action="sub" data-v="${esc(b.id)}">${on?"🔔 알림 켜짐":"🔕 빈자리 알림"}</button>
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
      <div style="font-size:10px;color:${C.inkSoft};margin-bottom:10px">${w._real?"소스: 실데이터 · Open-Meteo(시트 연동)":"소스: "+MODELS.find(x=>x.id===S.model).sub+" · 데모값"}</div>
      <div class="cal" style="grid-template-columns:repeat(4,1fr)">
        ${metric("🌡️",w.temp+"°","기온")}${metric("🌊",w.wave+"m","파고",w.wave>1.5)}${metric("💨",w.wind,"풍속 m/s",w.wind>10)}${metric("💧",w.rain+"%","강수")}
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
  const added = S.extra.length?`<div style="margin-top:16px"><div style="font-size:13px;font-weight:800;margin-bottom:8px">연동된 선사</div>${S.extra.map(sp=>`<div class="card row gap" style="padding:9px 12px;margin-bottom:6px">✅ <span style="font-size:13px;font-weight:700">${esc(sp.name)}</span><span style="font-size:11px;color:${C.inkSoft}">${esc(sp.port)}</span></div>`).join("")}</div>`:"";
  const shared = S.submissions.length?`<div style="margin-top:16px"><div style="font-size:13px;font-weight:800;margin-bottom:8px">지인이 공유한 곳 ${S.submissions.length}</div>${S.submissions.slice().reverse().slice(0,12).map(s=>`<div class="card" style="padding:10px 12px;margin-bottom:6px"><div style="font-size:12.5px;font-weight:700">${esc(s.name||s.url)}</div><div style="font-size:11px;color:${C.inkSoft};word-break:break-all">${esc(s.url)}</div><button data-action="fillurl" data-v="${esc(s.url)}" style="margin-top:6px;font-size:11px;color:${C.tide};background:none;border:none;cursor:pointer;padding:0;font-weight:700">이 주소 분석 →</button></div>`).join("")}</div>`:"";
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
    ${shared}
  </div>`;
}

function renderAlerts(){
  const subBoats=[...S.subs].map(id=>allBoats().find(b=>b.id===id)).filter(Boolean);
  const body = subBoats.length ? subBoats.map(b=>`<div class="card row" style="padding:13px;margin-bottom:8px">
      <div style="flex:1">
        <div class="row gap">🔔 <span style="font-size:15px;font-weight:800">${esc(b.name)}</span></div>
        <div style="font-size:11.5px;color:${C.inkSoft};margin-top:3px">${esc(b._port||"")} · ${(b.sp||[]).join("·")}</div>
        <div style="font-size:11px;color:${C.tide};margin-top:3px;font-weight:700">나 · 지인 2명이 함께 보는 중</div>
      </div>
      <button data-action="sub" data-v="${esc(b.id)}" style="border:none;background:none;cursor:pointer;font-size:18px">🔔</button>
    </div>`).join("")
    : `<div class="card" style="border-style:dashed;padding:28px;text-align:center;color:${C.inkSoft}">🔔<div style="font-size:13px;font-weight:700;color:${C.ink};margin-top:8px">아직 담아둔 배가 없어요</div><div style="font-size:12px;margin-top:4px">캘린더에서 배를 골라 알림을 켜보세요.</div></div>`;
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
  return `<div class="tabbar">${t("cal","🌊","빈자리")}${t("add","➕","선사추가")}${t("alerts","🔔","알림"+(S.subs.size?" "+S.subs.size:""))}</div>`;
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
  else if(a==="day"){ S.sel=parseInt(v,10); render(); }
  else if(a==="model"){ S.model=v; render(); }
  else if(a==="sub"){ S.subs.has(v)?S.subs.delete(v):S.subs.add(v); LS.set("subs",[...S.subs]); render(); }
  else if(a==="tab"){ S.tab=v; render(); }
  else if(a==="fillurl"){ S.urlDraft=v; render(); const i=document.getElementById("urlIn"); if(i)i.focus(); }
  else if(a==="analyze"){ const i=document.getElementById("urlIn"); S.urlDraft=i?i.value:""; S.analyzing=true; S.result=null; render(); setTimeout(()=>{ S.result=analyzeUrl(S.urlDraft); S.analyzing=false; render(); },800); }
  else if(a==="addop"){ addOperator(); }
  else if(a==="tg"){ toast("알림봇 저장소 README의 텔레그램 설정을 따라주세요"); }
  else if(a==="share"){ submitUrl(S.urlDraft, (S.result&&S.result.ok)?S.result.name:""); }
  else if(a==="install"){ doInstall(); }
});
// 입력값 유지
document.addEventListener("input",(e)=>{ if(e.target.id==="urlIn") S.urlDraft=e.target.value; if(e.target.id==="spIn") S.spDraft=e.target.value; });
// 어종 입력에서 엔터로 추가
document.addEventListener("keydown",(e)=>{ if(e.target.id==="spIn" && e.key==="Enter"){ e.preventDefault(); addSpecies(); } });

function removeSpecies(name){
  S.speciesList = S.speciesList.filter(x=>x!==name);
  LS.set("speciesList", S.speciesList);
  if(S.species===name) S.species="전체";
  render();
  toast(`${name} 삭제됨`);
}

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
  render();
  // 1) 빈자리·출조점: data.json(텔레그램 봇이 갱신) 우선
  try{
    const r = await fetch("data.json", { cache:"no-cache" });
    if(r.ok){ const d = await r.json();
      if(d && d.spots && d.spots.length) S.data = d;
      if(d && d.weather) S.weather = d.weather;
      if(d && d.submissions) S.submissions = d.submissions;
    }
  }catch{ /* 오프라인: 캐시 사용 */ }
  // 2) 구글 시트(Apps Script): 날씨·공유목록 보강, 출조점 없으면 시트 것으로
  if(API_URL){
    try{
      const r = await fetch(API_URL + "?action=data", { cache:"no-cache" });
      if(r.ok){ const d = await r.json();
        if(d.weather && Object.keys(d.weather).length) S.weather = d.weather;
        if(d.submissions && d.submissions.length) S.submissions = d.submissions;
        if(!(S.data.spots && S.data.spots.length) && d.spots && d.spots.length) S.data = d;
      }
    }catch{}
  }
  render();
}

// 공유된 URL을 시트에 등록 (text/plain 이라 CORS 프리플라이트 없음)
async function submitUrl(url, name){
  url = (url||"").trim();
  if(!url){ toast("먼저 주소를 입력하세요"); return; }
  if(!API_URL){ toast("백엔드(API_URL) 설정 후 공유돼요"); return; }
  try{
    await fetch(API_URL, { method:"POST", headers:{"Content-Type":"text/plain;charset=utf-8"}, body: JSON.stringify({url, name, by:"me"}) });
    toast("시트에 공유했어요");
    boot();
  }catch{ toast("공유 실패 — 네트워크 확인"); }
}
boot();

// ── 서비스워커 등록 ──
if("serviceWorker" in navigator){ window.addEventListener("load",()=>{ navigator.serviceWorker.register("sw.js").catch(()=>{}); }); }
