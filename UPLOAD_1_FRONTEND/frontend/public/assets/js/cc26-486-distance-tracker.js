(function(){
  'use strict';
  if (window.__CC_DISTANCE_TRACKER_486) return;
  window.__CC_DISTANCE_TRACKER_486 = true;

  var STORE_KEY='careerCroxDistancePresets:v1';
  var ROUTE_CACHE_KEY='careerCroxDistanceRouteCache:v2';
  var NEAREST_CACHE_KEY='careerCroxDistanceNearestCache:v2';
  var BUILTINS=[
    {id:'eos62',name:'EOS Globe - Sector 62',pin:'201309',address:'2nd Floor, Trapezoid IT Park, C-56, C Block, Phase 2, Industrial Area, Sector 62, Noida, Uttar Pradesh 201309, India',builtin:true},
    {id:'altruist-cogent127',name:'Altruist / Cogent - Sector 127',pin:'201304',address:'Tower C, Plot No. 6, Tech Boulevard, Sector 127, Noida, Uttar Pradesh 201304, India',builtin:true},
    {id:'altruist-tvs58',name:'Altruist - TVS - Sector 58',pin:'201309',address:'C-69, Ground Floor, Sector 58, Noida, Uttar Pradesh 201309, India',builtin:true},
    {id:'ienergizer60',name:'iEnergizer - Sector 60',pin:'201301',address:'A-37, Block A, Sector 60, Noida, Uttar Pradesh 201301, India',builtin:true},
    {id:'globiva18',name:'Globiva - Sector 18',pin:'122015',address:'2nd Floor, AIHP Signature, 418-419, Phase IV, Udyog Vihar, Sector 18, Gurugram, Haryana 122015, India',builtin:true},
    {id:'1point1-18',name:'1Point1 - Sector 18',pin:'122015',address:'Plot No. 17, Industrial Estate, Sector 18, Gurugram, Haryana 122015, India',builtin:true}
  ];

  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]})}
  function digits(v){return String(v||'').replace(/\D+/g,'').slice(0,6)}
  function validPin(v){return /^[1-9][0-9]{5}$/.test(String(v||''))}
  function readJson(key,fallback){try{var v=JSON.parse(localStorage.getItem(key)||'null');return v==null?fallback:v}catch(e){return fallback}}
  function writeJson(key,v){try{localStorage.setItem(key,JSON.stringify(v));return true}catch(e){return false}}
  function customs(){var rows=readJson(STORE_KEY,[]);return Array.isArray(rows)?rows.filter(function(x){return x&&validPin(x.pin)&&String(x.name||'').trim()}).slice(0,12):[]}
  function allSites(){var out=[],seen={};BUILTINS.concat(customs()).forEach(function(s){var p=digits(s.pin),id=String(s.id||('site-'+p+'-'+String(s.name||''))).trim(),key=id.toLowerCase();if(validPin(p)&&!seen[key]){seen[key]=1;out.push({id:id,name:String(s.name||('PIN '+p)).trim().slice(0,52),pin:p,address:String(s.address||'').trim().slice(0,220),builtin:!!s.builtin})}});return out.slice(0,15)}
  function fmtMin(n){n=Math.max(0,Number(n)||0);var h=Math.floor(n/60),m=Math.round(n%60);return h? h+'h '+m+'m' : m+' min'}
  function fmtKm(n){var x=Number(n)||0;return x<10?x.toFixed(1)+' km':Math.round(x)+' km'}
  function cacheGet(key,sub,ttl){var c=readJson(key,{}),h=c&&c[sub];if(h&&h.at&&Date.now()-h.at<ttl&&h.data)return h.data;return null}
  function cacheSet(key,sub,data,limit){var c=readJson(key,{});c[sub]={at:Date.now(),data:data};var keys=Object.keys(c).sort(function(a,b){return (c[b].at||0)-(c[a].at||0)}).slice(0,limit||20),next={};keys.forEach(function(k){next[k]=c[k]});writeJson(key,next)}
  function routeCacheKey(a,b){return a+'>'+b}
  function nearestCacheKey(pin,sites){return pin+'|'+sites.map(function(s){return s.id+':'+s.pin+':'+s.name+':'+(s.address||'')}).join('|')}

  var css=document.createElement('style');
  css.id='cc26-486-distance-style';
  css.textContent='\
.cc-distance-top-btn{height:38px;min-height:38px;padding:0 11px;border:1px solid rgba(91,99,240,.20);border-radius:12px;background:linear-gradient(135deg,#edf5ff 0%,#f1edff 48%,#e8fbf6 100%);color:#203963!important;-webkit-text-fill-color:#203963!important;font-size:10px;font-weight:1000;letter-spacing:-.15px;box-shadow:0 7px 18px rgba(69,91,184,.12);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;flex:0 0 auto}\
.cc-distance-top-btn:hover{transform:translateY(-1px);box-shadow:0 10px 22px rgba(69,91,184,.17)}.cc-distance-top-btn svg{width:15px;height:15px;flex:0 0 15px;color:#5b5ff0}\
.topbar-right .top-action-wrap>.add-profile-btn{width:78px!important;min-width:78px!important;max-width:78px!important;flex:0 0 78px!important}\
.professional-add-menu .cc-distance-menu-item,.add-menu .cc-distance-menu-item{display:block;width:100%;padding:12px 14px;border:0;border-radius:14px;margin:6px 0;background:linear-gradient(90deg,rgba(109,183,255,.10),rgba(72,214,177,.12));color:#183a63!important;-webkit-text-fill-color:#183a63!important;font:800 13px/1.2 inherit;text-align:left;cursor:pointer}\
.professional-add-menu .cc-distance-menu-item:hover,.add-menu .cc-distance-menu-item:hover{background:linear-gradient(90deg,rgba(109,183,255,.20),rgba(72,214,177,.22));transform:translateX(2px)}\
\
.cc502-quick-menu{position:fixed;z-index:220000;min-width:242px;max-width:292px;max-height:min(540px,calc(100vh - 20px));overflow:auto;padding:9px;border:1px solid rgba(86,116,173,.18);border-radius:20px;background:linear-gradient(155deg,rgba(255,255,255,.99),rgba(244,249,255,.99));box-shadow:0 24px 70px rgba(31,51,91,.24);backdrop-filter:blur(16px) saturate(1.18);transform-origin:top right;animation:cc502QuickIn .16s ease-out}.cc502-quick-head{padding:7px 9px 9px;color:#17365f;font-size:11px;font-weight:1000;letter-spacing:.08em;text-transform:uppercase}.cc502-quick-item{display:block;width:100%;min-height:41px;margin:4px 0;padding:0 12px;border:1px solid rgba(100,126,178,.10);border-radius:13px;background:linear-gradient(135deg,#f5f9ff,#f8f6ff);color:#17365f!important;-webkit-text-fill-color:#17365f!important;font:900 12.5px/1.2 Inter,system-ui,sans-serif;text-align:left;cursor:pointer;box-shadow:0 5px 13px rgba(56,78,118,.055);transition:transform .12s ease,box-shadow .12s ease,filter .12s ease}.cc502-quick-item:hover{transform:translateX(2px);box-shadow:0 8px 18px rgba(56,78,118,.10);filter:saturate(1.08)}.cc502-quick-item.cc502-distance-green{background:linear-gradient(135deg,#0d9b5d 0%,#20c66b 52%,#86d93c 100%)!important;border-color:#26b86b!important;color:#fff!important;-webkit-text-fill-color:#fff!important;box-shadow:0 10px 22px rgba(25,165,90,.24),inset 0 1px 0 rgba(255,255,255,.25)!important}.cc502-quick-item.cc502-distance-green:hover{background:linear-gradient(135deg,#078a51 0%,#18b960 50%,#75cf31 100%)!important;box-shadow:0 13px 27px rgba(25,165,90,.31),inset 0 1px 0 rgba(255,255,255,.3)!important}@keyframes cc502QuickIn{from{opacity:0;transform:translateY(-5px) scale(.98)}to{opacity:1;transform:none}}\
.cc-dist-backdrop{position:fixed;inset:0;background:rgba(20,34,63,.30);backdrop-filter:blur(7px);z-index:120000;display:grid;place-items:center;padding:18px}.cc-dist-modal{width:min(780px,96vw);max-height:92vh;overflow:auto;border:1px solid rgba(102,121,190,.17);border-radius:25px;background:linear-gradient(145deg,#fbfdff 0%,#f8f6ff 47%,#f5fffb 100%);box-shadow:0 28px 90px rgba(35,52,95,.27);padding:22px;color:#152b4e}.cc-dist-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.cc-dist-kicker{font-size:12px;font-weight:1000;letter-spacing:.9px;color:#6a66e8;text-transform:uppercase}.cc-dist-title{font-size:28px;font-weight:1000;letter-spacing:-.8px;margin-top:3px;color:#102a4f}.cc-dist-sub{font-size:14px;font-weight:760;color:#61708c;margin-top:4px;max-width:560px}.cc-dist-close{border:0;width:38px;height:38px;border-radius:12px;background:#edf2ff;color:#29456e;font-size:20px;font-weight:900;cursor:pointer}\
.cc-dist-tabs{display:flex;gap:7px;margin-top:16px;padding:4px;border-radius:14px;background:#edf2fb}.cc-dist-tab{flex:1;height:42px;border:0;border-radius:10px;background:transparent;color:#62728a;font-size:13px;font-weight:1000;cursor:pointer}.cc-dist-tab.active{background:linear-gradient(135deg,#e2edff,#ece8ff,#e2f8f2);color:#213d67;box-shadow:0 5px 13px rgba(71,92,148,.12)}.cc-dist-panel{display:none}.cc-dist-panel.active{display:block}\
.cc-dist-nearbox{margin-top:14px;padding:16px;border:1px solid rgba(84,106,164,.12);border-radius:18px;background:linear-gradient(135deg,#edf6ff,#f4f0ff 55%,#edfbf6)}.cc-dist-field label{display:block;font-size:12px;font-weight:1000;color:#556681;margin:0 0 6px 3px;text-transform:uppercase;letter-spacing:.55px}.cc-dist-field input{width:100%;box-sizing:border-box;height:47px;border:1px solid rgba(76,100,157,.20);border-radius:14px;background:#fff;color:#17365f!important;-webkit-text-fill-color:#17365f!important;padding:0 15px;font-size:20px;font-weight:1000;outline:none}.cc-dist-field input:focus{border-color:#787cf5;box-shadow:0 0 0 4px rgba(120,124,245,.10)}.cc-dist-near-row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end}.cc-dist-find{height:49px;border:0;border-radius:14px;padding:0 18px;background:linear-gradient(135deg,#5367ed,#826be9 56%,#36bfa7);color:#fff!important;-webkit-text-fill-color:#fff!important;font-size:14px;font-weight:1000;cursor:pointer;box-shadow:0 10px 22px rgba(83,103,237,.20)}.cc-dist-find[disabled]{opacity:.55;cursor:wait}.cc-dist-note{font-size:12px;font-weight:760;color:#72809a;margin-top:8px}.cc-dist-presets{display:flex;gap:7px;flex-wrap:wrap;margin-top:13px}.cc-dist-chip{border:1px solid rgba(92,105,188,.14);border-radius:999px;padding:7px 10px;background:linear-gradient(135deg,#eef5ff,#f3efff);color:#294163;font-size:12px;font-weight:950}.cc-dist-chip.custom{background:linear-gradient(135deg,#e9fbf5,#ecf7ff)}\
.cc-dist-top2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}.cc-dist-rank-card{border:1px solid rgba(80,105,165,.13);border-radius:18px;padding:14px;box-shadow:0 10px 24px rgba(62,83,137,.08);position:relative;overflow:hidden}.cc-dist-rank-card.one{background:linear-gradient(135deg,#d9ffe8 0%,#eafff2 50%,#d8f8e8 100%);border-color:rgba(30,180,105,.28);box-shadow:0 12px 28px rgba(32,176,107,.14)}.cc-dist-rank-card.two{background:linear-gradient(135deg,#eef3ff,#f5efff 52%,#fff2f7)}.cc-dist-rank-card.one .cc-dist-rank{background:linear-gradient(135deg,#1fbf75,#45d797);color:#fff}.cc-dist-rank-card.one .cc-dist-site-name,.cc-dist-rank-card.one .cc-dist-metric b{color:#11623f}.cc-dist-rank-card.one .cc-dist-track-one{background:linear-gradient(135deg,#e9fff3,#dff8eb);color:#17734d;border-color:rgba(31,189,118,.24)}.cc-dist-rank{display:inline-flex;align-items:center;height:26px;padding:0 10px;border-radius:999px;background:#ffffffba;color:#35556b;font-size:11px;font-weight:1000;text-transform:uppercase}.cc-dist-site-name{font-size:20px;font-weight:1000;color:#16365e;margin-top:8px}.cc-dist-site-pin{font-size:12px;font-weight:850;color:#687894;margin-top:2px}.cc-dist-site-metrics{display:flex;gap:12px;flex-wrap:wrap;margin-top:10px}.cc-dist-metric b{display:block;font-size:18px;color:#193c67}.cc-dist-metric span{font-size:11px;font-weight:850;color:#77849a}.cc-dist-track-one{margin-top:10px;height:30px;padding:0 10px;border:1px solid rgba(74,93,169,.14);border-radius:10px;background:#ffffffbd;color:#4254bc;font-size:12px;font-weight:1000;cursor:pointer}\
.cc-dist-list{margin-top:12px;border-radius:16px;overflow:hidden;border:1px solid rgba(81,104,160,.12);background:#fff}.cc-dist-list-head,.cc-dist-list-row{display:grid;grid-template-columns:42px minmax(150px,1.6fr) .8fr 1fr;gap:8px;align-items:center;padding:9px 11px}.cc-dist-list-head{background:#f0f4fb;color:#62728a;font-size:10.5px;font-weight:1000;text-transform:uppercase}.cc-dist-list-row{border-top:1px solid #edf0f6;color:#29415f;font-size:12.5px;font-weight:850}.cc-dist-list-row:nth-child(odd){background:#fbfdff}.cc-dist-list-row .rank{width:26px;height:26px;border-radius:9px;background:#edf2ff;display:grid;place-items:center;color:#5966c9;font-weight:1000}.cc-dist-list-row strong{display:block;color:#1b385f;font-size:13.5px}.cc-dist-list-row small{display:block;color:#6f7d92;font-size:11px;margin-top:1px}.cc-dist-list-empty{padding:16px;color:#6e7d93;font-size:13px;font-weight:850}\
.cc-dist-actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:13px}.cc-dist-add{height:39px;border:1px solid rgba(69,105,167,.17);border-radius:12px;padding:0 13px;background:#eef6ff;color:#264568;font-size:12.5px;font-weight:1000;cursor:pointer}.cc-dist-addbox{display:none;margin-top:10px;padding:11px;border-radius:15px;background:linear-gradient(135deg,#f1f8ff,#f7f3ff);border:1px solid rgba(83,101,163,.11)}.cc-dist-addbox.show{display:grid;grid-template-columns:1.5fr 1fr auto;gap:8px}.cc-dist-addbox input{height:39px;border:1px solid rgba(76,100,157,.19);border-radius:11px;background:#fff;color:#17365f;padding:0 11px;font-weight:850;outline:none}.cc-dist-save{border:0;border-radius:11px;padding:0 13px;background:#2ebf8f;color:#fff;font-weight:1000;cursor:pointer}\
.cc-dist-status{display:none;margin-top:12px;border-radius:14px;padding:12px;font-size:12.5px;font-weight:850}.cc-dist-status.show{display:block}.cc-dist-status.error{background:#fff0f0;color:#9b2c36;border:1px solid #ffd1d6}.cc-dist-status.loading{background:#eef5ff;color:#315583;border:1px solid #d6e5ff}\
.cc-dist-grid{display:grid;grid-template-columns:1fr 46px 1fr;gap:10px;align-items:end;margin-top:14px}.cc-dist-swap{height:42px;width:42px;border:0;border-radius:14px;background:linear-gradient(135deg,#6269ee,#8e72f2);color:#fff;font-size:20px;font-weight:1000;cursor:pointer}.cc-dist-check{height:43px;border:0;border-radius:13px;padding:0 18px;background:linear-gradient(135deg,#5367ed,#8a64e8 58%,#3fc9b1);color:#fff!important;-webkit-text-fill-color:#fff!important;font-size:12px;font-weight:1000;cursor:pointer}.cc-dist-check[disabled]{opacity:.55;cursor:wait}.cc-dist-result{display:none;margin-top:14px}.cc-dist-result.show{display:block}.cc-dist-route-label{font-size:13px;font-weight:900;color:#5b6c86;margin-bottom:9px}.cc-dist-cards{display:grid;grid-template-columns:1fr 1fr;gap:10px}.cc-dist-card{border-radius:18px;padding:14px;border:1px solid rgba(78,101,156,.12)}.cc-dist-card.distance{background:linear-gradient(135deg,#eaf4ff,#e9fbff)}.cc-dist-card.time{background:linear-gradient(135deg,#f2edff,#fff0f6)}.cc-dist-card .lbl{font-size:10px;font-weight:1000;color:#5d6e89;text-transform:uppercase}.cc-dist-card .big{font-size:22px;font-weight:1000;color:#16365e;margin-top:4px}.cc-dist-card .range{font-size:11px;font-weight:850;color:#60718c;margin-top:3px}.cc-dist-foot{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-top:10px;padding:10px 12px;border-radius:13px;background:#ffffffa8;color:#6a778d;font-size:10.5px;font-weight:800}.cc-dist-map{color:#4d5edb;font-weight:1000;text-decoration:none}\
@media(max-width:900px){.cc-distance-top-btn{width:40px;min-width:40px;padding:0}.cc-distance-top-btn span{display:none}.cc-dist-near-row,.cc-dist-grid{grid-template-columns:1fr}.cc-dist-swap{justify-self:center;transform:rotate(90deg)}.cc-dist-top2,.cc-dist-cards{grid-template-columns:1fr}.cc-dist-addbox.show{grid-template-columns:1fr}.cc-dist-list-head,.cc-dist-list-row{grid-template-columns:34px 1.4fr .8fr 1fr}.cc-dist-modal{padding:15px}}';
  document.head.appendChild(css);

  function modalHtml(){
    return '<div class="cc-dist-backdrop" id="cc-distance-backdrop"><div class="cc-dist-modal" role="dialog" aria-modal="true" aria-label="Distance Tracker">'+
      '<div class="cc-dist-head"><div><div class="cc-dist-kicker">On-call location check</div><div class="cc-dist-title">Distance Tracker</div><div class="cc-dist-sub">Enter only the candidate PIN. CRM compares every saved site and shows the nearest two first.</div></div><button class="cc-dist-close" type="button" aria-label="Close">×</button></div>'+
      '<div class="cc-dist-tabs"><button class="cc-dist-tab active" data-tab="nearest" type="button">Nearest Site</button><button class="cc-dist-tab" data-tab="route" type="button">Specific Route</button></div>'+
      '<div class="cc-dist-panel active" data-panel="nearest">'+
        '<div class="cc-dist-nearbox"><div class="cc-dist-near-row"><div class="cc-dist-field"><label>Candidate PIN</label><input id="cc-dist-candidate" inputmode="numeric" maxlength="6" placeholder="Ask candidate 6 digit PIN" autofocus></div><button class="cc-dist-find" type="button">Find Nearest Sites</button></div><div class="cc-dist-note">One click compares all saved sites • no background polling</div></div>'+
        '<div class="cc-dist-presets" id="cc-dist-presets"></div>'+
        '<div class="cc-dist-actions"><button class="cc-dist-add" type="button">+ Add Default Site</button><span class="cc-dist-note" id="cc-dist-site-count"></span></div>'+
        '<div class="cc-dist-addbox"><input id="cc-dist-site-name" placeholder="Site name"><input id="cc-dist-site-pin" inputmode="numeric" maxlength="6" placeholder="PIN code"><button class="cc-dist-save" type="button">Save</button></div>'+
        '<div class="cc-dist-status" id="cc-dist-near-status"></div><div id="cc-dist-near-result"></div>'+
      '</div>'+
      '<div class="cc-dist-panel" data-panel="route">'+
        '<div class="cc-dist-grid"><div class="cc-dist-field"><label>Site PIN</label><input id="cc-dist-from" inputmode="numeric" maxlength="6" value="122015" placeholder="6 digit PIN"></div><button class="cc-dist-swap" type="button" title="Swap PIN codes">⇄</button><div class="cc-dist-field"><label>Candidate PIN</label><input id="cc-dist-to" inputmode="numeric" maxlength="6" placeholder="Candidate PIN"></div></div>'+
        '<div class="cc-dist-actions"><button class="cc-dist-check" type="button">Check Specific Route</button><span class="cc-dist-note">Detailed min/max route estimate</span></div><div class="cc-dist-status" id="cc-dist-route-status"></div><div class="cc-dist-result" id="cc-dist-result"></div>'+
      '</div>'+
    '</div></div>';
  }

  function renderPresets(root){
    var sites=allSites(),box=root.querySelector('#cc-dist-presets'),count=root.querySelector('#cc-dist-site-count');
    if(box)box.innerHTML=sites.map(function(s){return '<span class="cc-dist-chip '+(s.builtin?'':'custom')+'">'+esc(s.name)+' · '+esc(s.pin)+'</span>'}).join('');
    if(count)count.textContent=sites.length+' saved site'+(sites.length===1?'':'s')+' compared';
  }
  function statusEl(root,kind){return root.querySelector(kind==='near'?'#cc-dist-near-status':'#cc-dist-route-status')}
  function showStatus(root,text,type,kind){var el=statusEl(root,kind||'near');if(!el)return;el.className='cc-dist-status show '+(type||'');el.textContent=text||''}
  function clearStatus(root,kind){var el=statusEl(root,kind||'near');if(el){el.className='cc-dist-status';el.textContent=''}}
  function switchTab(root,name){root.querySelectorAll('.cc-dist-tab').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-tab')===name)});root.querySelectorAll('.cc-dist-panel').forEach(function(p){p.classList.toggle('active',p.getAttribute('data-panel')===name)})}

  function renderRouteResult(root,d){
    var r=root.querySelector('#cc-dist-result');
    var dmin=Number(d.min_distance_km||d.distance_km||0),dmax=Number(d.max_distance_km||d.distance_km||0),tmin=Number(d.min_minutes||0),tmax=Number(d.max_minutes||tmin||0);
    var route=(d.from_label||d.from_pin)+' → '+(d.to_label||d.to_pin);
    var map='https://www.google.com/maps/dir/?api=1&origin='+encodeURIComponent(d.from_pin+', India')+'&destination='+encodeURIComponent(d.to_pin+', India')+'&travelmode=driving';
    r.innerHTML='<div class="cc-dist-route-label">'+esc(route)+'</div><div class="cc-dist-cards"><div class="cc-dist-card distance"><div class="lbl">Road Distance</div><div class="big">'+fmtKm(d.distance_km||dmin)+'</div><div class="range">Min '+fmtKm(dmin)+' · Max '+fmtKm(dmax)+'</div></div><div class="cc-dist-card time"><div class="lbl">Travel Time</div><div class="big">'+fmtMin(tmin)+' – '+fmtMin(tmax)+'</div><div class="range">Fastest to practical upper estimate</div></div></div><div class="cc-dist-foot"><span>Route estimate; live traffic can change actual time.</span><a class="cc-dist-map" target="_blank" rel="noopener" href="'+esc(map)+'">Open Route ↗</a></div>';
    r.className='cc-dist-result show';
  }

  function topCard(item,rank){
    return '<div class="cc-dist-rank-card '+(rank===1?'one':'two')+'"><span class="cc-dist-rank">'+(rank===1?'#1 Nearest':'#2 Second Nearest')+'</span><div class="cc-dist-site-name">'+esc(item.name)+'</div><div class="cc-dist-site-pin">PIN '+esc(item.pin)+(item.label?' · '+esc(item.label):'')+'</div><div class="cc-dist-site-metrics"><div class="cc-dist-metric"><b>'+fmtKm(item.distance_km)+'</b><span>Road distance</span></div><div class="cc-dist-metric"><b>'+fmtMin(item.min_minutes)+' – '+fmtMin(item.max_minutes)+'</b><span>Estimated drive time</span></div></div><button class="cc-dist-track-one" type="button" data-track-pin="'+esc(item.pin)+'">Open detailed route</button></div>';
  }
  function renderNearest(root,d){
    var box=root.querySelector('#cc-dist-near-result'),rows=Array.isArray(d.sites)?d.sites:[];
    if(!rows.length){box.innerHTML='<div class="cc-dist-list"><div class="cc-dist-list-empty">No route result found.</div></div>';return}
    var topRows=rows.slice(0,2),remaining=rows.slice(2);
    var top=topRows.map(function(x,i){return topCard(x,i+1)}).join('');
    var list='';
    if(remaining.length){list='<div class="cc-dist-list"><div class="cc-dist-list-head"><span>Rank</span><span>Site</span><span>Distance</span><span>Travel time</span></div>'+remaining.map(function(x,i){return '<div class="cc-dist-list-row"><span class="rank">'+(i+3)+'</span><span><strong>'+esc(x.name)+'</strong><small>PIN '+esc(x.pin)+'</small></span><span>'+fmtKm(x.distance_km)+'</span><span>'+fmtMin(x.min_minutes)+' – '+fmtMin(x.max_minutes)+'</span></div>'}).join('')+'</div>';}
    box.innerHTML='<div class="cc-dist-route-label" style="margin-top:14px">Candidate: '+esc(d.candidate_label||('PIN '+d.candidate_pin))+'</div><div class="cc-dist-top2">'+top+'</div>'+list+'<div class="cc-dist-foot"><span>Sorted by road distance. ETA is traffic-free route time with a practical upper buffer.</span></div>';
    box.querySelectorAll('[data-track-pin]').forEach(function(btn){btn.addEventListener('click',function(){var p=btn.getAttribute('data-track-pin');root.querySelector('#cc-dist-from').value=p;root.querySelector('#cc-dist-to').value=d.candidate_pin||'';switchTab(root,'route');setTimeout(function(){checkRoute(root)},20)})});
  }

  async function findNearest(root){
    var pin=digits(root.querySelector('#cc-dist-candidate').value),sites=allSites(),btn=root.querySelector('.cc-dist-find');root.querySelector('#cc-dist-candidate').value=pin;
    if(!validPin(pin)){showStatus(root,'Enter a valid 6 digit candidate PIN.','error','near');return}
    if(!sites.length){showStatus(root,'Add at least one default site first.','error','near');return}
    var key=nearestCacheKey(pin,sites),cached=cacheGet(NEAREST_CACHE_KEY,key,21600000);if(cached){clearStatus(root,'near');renderNearest(root,cached);return}
    btn.disabled=true;btn.textContent='Comparing...';showStatus(root,'Comparing '+sites.length+' saved sites in one route check...','loading','near');root.querySelector('#cc-dist-near-result').innerHTML='';
    try{
      var ac=new AbortController(),timer=setTimeout(function(){ac.abort()},15000);
      var q=encodeURIComponent(JSON.stringify(sites.map(function(s){return{id:s.id,name:s.name,pin:s.pin,address:s.address||''}})));
      var res=await fetch('/api/distance/nearest?candidate='+encodeURIComponent(pin)+'&sites='+q,{credentials:'include',cache:'no-store',signal:ac.signal});
      clearTimeout(timer);var d=await res.json().catch(function(){return{}});
      if(!res.ok||!d||d.ok===false)throw new Error(d.message||d.error||'Nearest site could not be calculated.');
      cacheSet(NEAREST_CACHE_KEY,key,d,12);clearStatus(root,'near');renderNearest(root,d);
    }catch(e){showStatus(root,(e&&e.name==='AbortError')?'Nearest-site check timed out. Try once again.':(e.message||'Nearest-site check failed.'),'error','near')}
    finally{btn.disabled=false;btn.textContent='Find Nearest Sites'}
  }

  async function checkRoute(root){
    var a=digits(root.querySelector('#cc-dist-from').value),b=digits(root.querySelector('#cc-dist-to').value),btn=root.querySelector('.cc-dist-check');root.querySelector('#cc-dist-from').value=a;root.querySelector('#cc-dist-to').value=b;
    if(!validPin(a)||!validPin(b)){showStatus(root,'Enter valid 6 digit Indian PIN codes.','error','route');return}
    var key=routeCacheKey(a,b),cached=cacheGet(ROUTE_CACHE_KEY,key,21600000);if(cached){clearStatus(root,'route');renderRouteResult(root,cached);return}
    btn.disabled=true;btn.textContent='Checking...';showStatus(root,'Finding detailed road route...','loading','route');root.querySelector('#cc-dist-result').className='cc-dist-result';
    try{
      var ac=new AbortController(),timer=setTimeout(function(){ac.abort()},12000);
      var res=await fetch('/api/distance/route?from='+encodeURIComponent(a)+'&to='+encodeURIComponent(b),{credentials:'include',cache:'no-store',signal:ac.signal});clearTimeout(timer);var d=await res.json().catch(function(){return{}});
      if(!res.ok||!d||d.ok===false)throw new Error(d.message||d.error||'Route could not be calculated.');cacheSet(ROUTE_CACHE_KEY,key,d,20);clearStatus(root,'route');renderRouteResult(root,d);
    }catch(e){showStatus(root,(e&&e.name==='AbortError')?'Distance check timed out. Try once again.':(e.message||'Distance check failed.'),'error','route')}
    finally{btn.disabled=false;btn.textContent='Check Specific Route'}
  }

  function openModal(){
    var old=document.getElementById('cc-distance-backdrop');if(old)old.remove();var wrap=document.createElement('div');wrap.innerHTML=modalHtml();var root=wrap.firstChild;document.body.appendChild(root);renderPresets(root);
    function pinInput(e){e.target.value=digits(e.target.value)}
    ['#cc-dist-candidate','#cc-dist-from','#cc-dist-to','#cc-dist-site-pin'].forEach(function(sel){var el=root.querySelector(sel);if(el)el.addEventListener('input',pinInput)});
    root.querySelector('.cc-dist-close').addEventListener('click',function(){root.remove()});root.addEventListener('click',function(e){if(e.target===root){e.preventDefault();e.stopPropagation();}});
    root.querySelectorAll('.cc-dist-tab').forEach(function(b){b.addEventListener('click',function(){switchTab(root,b.getAttribute('data-tab'))})});
    root.querySelector('.cc-dist-find').addEventListener('click',function(){findNearest(root)});root.querySelector('#cc-dist-candidate').addEventListener('keydown',function(e){if(e.key==='Enter')findNearest(root)});
    var from=root.querySelector('#cc-dist-from'),to=root.querySelector('#cc-dist-to');root.querySelector('.cc-dist-swap').addEventListener('click',function(){var x=from.value;from.value=to.value;to.value=x});root.querySelector('.cc-dist-check').addEventListener('click',function(){checkRoute(root)});to.addEventListener('keydown',function(e){if(e.key==='Enter')checkRoute(root)});from.addEventListener('keydown',function(e){if(e.key==='Enter')to.focus()});
    root.querySelector('.cc-dist-add').addEventListener('click',function(){root.querySelector('.cc-dist-addbox').classList.toggle('show')});
    root.querySelector('.cc-dist-save').addEventListener('click',function(){var n=String(root.querySelector('#cc-dist-site-name').value||'').trim().slice(0,36),p=digits(root.querySelector('#cc-dist-site-pin').value);if(!n||!validPin(p)){showStatus(root,'Add a site name and valid 6 digit PIN.','error','near');return}var rows=customs().filter(function(x){return x.pin!==p&&String(x.name||'').toLowerCase()!==n.toLowerCase()});rows.unshift({id:'custom-'+Date.now(),name:n,pin:p});writeJson(STORE_KEY,rows.slice(0,12));renderPresets(root);root.querySelector('#cc-dist-site-name').value='';root.querySelector('#cc-dist-site-pin').value='';root.querySelector('.cc-dist-addbox').classList.remove('show');clearStatus(root,'near')});
    setTimeout(function(){try{root.querySelector('#cc-dist-candidate').focus()}catch(e){}},40);
  }

  function removeLegacyTopButton(){document.querySelectorAll('.cc-distance-top-btn').forEach(function(el){el.remove()})}

  /* CC26_502: Quick Action uses a body-level fixed menu so topbar/React repaint cannot hide the options. */
  var QUICK_MENU_ID='cc502-quick-action-menu';
  var quickTrigger=null;
  function userRole(){
    var el=document.querySelector('.topbar .user-role,.user-chip .user-role');
    return String(el&&el.textContent||'').trim().toLowerCase();
  }
  function quickNavigate(path){
    closeQuickMenu();
    try{history.pushState({},'',path);window.dispatchEvent(new PopStateEvent('popstate'));}
    catch(_e){location.assign(path)}
  }
  function closeQuickMenu(){
    var menu=document.getElementById(QUICK_MENU_ID);if(menu)menu.remove();
    if(quickTrigger){quickTrigger.setAttribute('aria-expanded','false')}
  }
  function quickItems(){
    var role=userRole(),manager=/admin|manager/.test(role),tl=role==='tl'||role.indexOf('team lead')>=0||role.indexOf('teamlead')>=0;
    var items=[
      {label:'Add Candidate',path:'/candidate/new'},
      {label:'Distance Tracker',distance:true,green:true},
      {label:'Add Task',path:'/quick-add/task'},
      {label:'Add Note',path:'/quick-add/note'}
    ];
    if(manager)items.push({label:'Add JD',path:'/quick-add/jd'});
    items.push({label:'Add Interview',path:'/quick-add/interview'});
    items.push({label:'Open Submissions',path:'/submissions'});
    if(manager||tl||role.indexOf('recruiter')>=0)items.push({label:'Attendance & Break Time',path:'/attendance'});
    if(manager)items.push({label:'Open BDA',path:'/bda'});
    if(manager||tl)items.push({label:'YT Hub',path:'/learning-hub'});
    return items;
  }
  function positionQuickMenu(menu,trigger){
    if(!menu||!trigger)return;
    var r=trigger.getBoundingClientRect(),w=Math.min(292,Math.max(242,menu.offsetWidth||268));
    var left=Math.max(8,Math.min((window.innerWidth||document.documentElement.clientWidth)-w-8,r.right-w));
    var top=Math.min((window.innerHeight||document.documentElement.clientHeight)-12,r.bottom+8);
    menu.style.left=Math.round(left)+'px';menu.style.top=Math.round(top)+'px';menu.style.width=Math.round(w)+'px';
    requestAnimationFrame(function(){
      if(!menu.isConnected)return;
      var mr=menu.getBoundingClientRect(),vh=window.innerHeight||document.documentElement.clientHeight;
      if(mr.bottom>vh-8){var above=r.top-mr.height-8;menu.style.top=Math.max(8,Math.round(above))+'px'}
    });
  }
  function openQuickMenu(trigger){
    var existing=document.getElementById(QUICK_MENU_ID);
    if(existing){closeQuickMenu();return}
    quickTrigger=trigger;trigger.setAttribute('aria-expanded','true');
    var menu=document.createElement('div');menu.id=QUICK_MENU_ID;menu.className='cc502-quick-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Quick Action');
    var head=document.createElement('div');head.className='cc502-quick-head';head.textContent='Quick Action';menu.appendChild(head);
    quickItems().forEach(function(item){
      var btn=document.createElement('button');btn.type='button';btn.className='cc502-quick-item'+(item.green?' cc502-distance-green':'');btn.setAttribute('role','menuitem');btn.textContent=item.label;
      btn.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();if(item.distance){closeQuickMenu();openModal()}else quickNavigate(item.path)});
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);positionQuickMenu(menu,trigger);
  }
  function bindQuickTrigger(trigger){
    if(!trigger||trigger.getAttribute('data-cc502-bound')==='1')return;
    trigger.setAttribute('data-cc502-bound','1');trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-expanded','false');
    trigger.addEventListener('click',function(ev){
      ev.preventDefault();ev.stopPropagation();
      openQuickMenu(trigger);
    },true);
  }
  function ensureQuickAction(){
    removeLegacyTopButton();
    var wrap=document.querySelector('.top-action-wrap');
    if(!wrap)return false;
    var trigger=wrap.querySelector('button.add-profile-btn');
    if(trigger){
      if(String(trigger.textContent||'').trim()!=='Quick Action')trigger.textContent='Quick Action';
      trigger.setAttribute('aria-label','Quick Action');trigger.title='Quick Action';bindQuickTrigger(trigger);
    }
    return !!trigger;
  }
  document.addEventListener('pointerdown',function(ev){var menu=document.getElementById(QUICK_MENU_ID);if(!menu)return;if(menu.contains(ev.target)||(quickTrigger&&quickTrigger.contains(ev.target)))return;closeQuickMenu()},true);
  document.addEventListener('keydown',function(ev){if(ev.key==='Escape')closeQuickMenu()},true);
  window.addEventListener('resize',function(){var m=document.getElementById(QUICK_MENU_ID);if(m&&quickTrigger)positionQuickMenu(m,quickTrigger)},{passive:true});
  window.addEventListener('scroll',function(){var m=document.getElementById(QUICK_MENU_ID);if(m&&quickTrigger)positionQuickMenu(m,quickTrigger)},{passive:true,capture:true});
  window.__CC_OPEN_DISTANCE_TRACKER=openModal;
  window.addEventListener('career-crox-open-distance-tracker',openModal);
  if(window.__CC_DISTANCE_PENDING){window.__CC_DISTANCE_PENDING=false;setTimeout(openModal,0)}
  var tries=0,quickRaf=0;
  function scheduleQuick(){if(quickRaf)return;quickRaf=requestAnimationFrame(function(){quickRaf=0;ensureQuickAction()})}
  function boot(){if(ensureQuickAction())return;if(++tries<20)setTimeout(boot,Math.min(400,80+tries*15))}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.addEventListener('career-crox-react-ready',function(){tries=0;boot()});
  window.addEventListener('popstate',function(){closeQuickMenu();tries=0;setTimeout(boot,30)});
  window.addEventListener('cc-route-change',function(){closeQuickMenu();tries=0;setTimeout(boot,30)});
  try{new MutationObserver(function(records){
    var useful=records.some(function(r){return Array.prototype.some.call(r.addedNodes||[],function(node){return node&&node.nodeType===1&&((node.matches&&node.matches('.top-action-wrap,.add-profile-btn'))||(node.querySelector&&node.querySelector('.top-action-wrap,.add-profile-btn')))})});
    if(useful)scheduleQuick();
  }).observe(document.documentElement,{childList:true,subtree:true})}catch(_e){}
})();
