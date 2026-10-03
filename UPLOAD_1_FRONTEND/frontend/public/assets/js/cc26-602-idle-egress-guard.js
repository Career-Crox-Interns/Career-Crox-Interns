/* Career Crox CC26_602: trusted employee activity, 10-minute idle logout, zero idle chat subscriptions. */
(function(){
  'use strict';
  var U='careerCroxCachedUser',H='careerCroxHumanActivityAt',L='careerCroxLastActivityAt',G='careerCroxSessionLoginAt',M='careerCroxSessionExpiredMessage',EV='careerCroxLogoutEventAt';
  var TEN=600000, stopped=false, writing=0, lastPulse=0, timer=null;
  var nativeFetch=window.fetch.bind(window);
  // CC26_621: IST 09:00–21:00; device timezone never changes this office window.
  var IST_OFFSET=330*60000, officeTimer=null, officeNow=null;
  function officeHours(at){var d=new Date((at===undefined?Date.now():at)+IST_OFFSET),m=d.getUTCHours()*60+d.getUTCMinutes();return m>=540&&m<1260;}
  window.__CC621_IS_OFFICE_HOURS__=officeHours;
  window.__CC621_NIGHT_QUIET__=function(){return !officeHours();};
  function isAutoGet(options){var hdr=options&&options.headers||{},value='';if(typeof Headers!=='undefined'&&hdr instanceof Headers){value=hdr.get('X-Career-Crox-Background')||'';}else if(Array.isArray(hdr)){for(var i=0;i<hdr.length;i++){if(String(hdr[i][0]).toLowerCase()==='x-career-crox-background')value=hdr[i][1];}}else{for(var k in hdr){if(k.toLowerCase()==='x-career-crox-background')value=hdr[k];}}return String(value).toLowerCase()==='1'&&String(options&&options.method||'GET').toUpperCase()==='GET';}
  function manualRoute(url){
    // A passive polling request is NEVER made manual merely because a page is open.
    // Only explicit foreground fetches (without the background header) are allowed at night.
    var p='';try{p=new URL(url&&url.url||url||'',location.href).pathname;}catch(_){}
    return p==='/api/auth/me';
  }
  function officeBoundary(){var current=officeHours();if(officeNow!==null&&current!==officeNow){try{window.dispatchEvent(new CustomEvent(current?'cc621:office-open':'cc621:night-quiet'))}catch(_){}}officeNow=current;if(officeTimer)clearTimeout(officeTimer);var now=Date.now(),shifted=new Date(now+IST_OFFSET),at=shifted.getUTCHours()*60+shifted.getUTCMinutes(),minutes=current?1260-at:(at<540?540-at:1980-at);officeTimer=setTimeout(officeBoundary,Math.max(1000,minutes*60000-shifted.getUTCSeconds()*1000-shifted.getUTCMilliseconds()+250));}
  officeBoundary();document.addEventListener('visibilitychange',officeBoundary);window.addEventListener('pageshow',officeBoundary);

  function n(v){var x=Number(v||0);return isFinite(x)?x:0}
  function read(k){try{return n(localStorage.getItem(k))}catch(e){return 0}}
  function user(){try{return !!localStorage.getItem(U)}catch(e){return false}}
  function last(){return read(H)||read(L)||read(G)||Date.now()}
  function isExpired(){return user()&&Date.now()-last()>=TEN}
  function networkAllowed(url){var path=String(url&&url.url||url||'');try{var target=new URL(path,location.href);if(target.origin!==location.origin)return false;path=target.pathname}catch(e){}return path==='/api/auth/logout'||path==='/api/auth/login'}
  // Old scripts may still have pending timers. One centralized gate prevents new idle Supabase work.
  window.fetch=function(url,options){
    var path=String(url&&url.url||url||'');try{path=new URL(path,location.href).pathname}catch(e){}
    if(isExpired()&&!stopped) logout();
    if(!officeHours()&&isAutoGet(options)&&!manualRoute(url))return Promise.reject(new Error('Night quiet mode (21:00–09:00 IST). Use Manual Refresh to load fresh data.'));
    if(window.__CC602_NETWORK_PAUSED__&&!networkAllowed(url))return Promise.reject(new Error('CRM logged out; sign in to reconnect.'));
    return nativeFetch(url,options).then(function(response){if(path==='/api/auth/login'&&response.ok){
      stopped=false;window.__CC602_NETWORK_PAUSED__=false;window.__CC602_IDLE_LOGOUT_RUNNING__=false;writing=0;lastPulse=Date.now();
      try{localStorage.setItem(H,String(Date.now()));localStorage.setItem(L,String(Date.now()))}catch(e){} schedule();
    }return response});
  };
  function localLogout(reason){try{sessionStorage.setItem(M,reason)}catch(e){}try{localStorage.removeItem(U);localStorage.removeItem(G);localStorage.removeItem(H);localStorage.removeItem(L);localStorage.setItem(EV,JSON.stringify({at:Date.now(),reason:reason}))}catch(e){}}
  function logout(){if(stopped||!user())return;stopped=true;window.__CC602_NETWORK_PAUSED__=true;window.__CC602_IDLE_LOGOUT_RUNNING__=true;var reason='CRM locked and logged out after 10 minutes of inactivity.';
    try{window.dispatchEvent(new CustomEvent('career-crox-idle-lock-begin'))}catch(e){}
    try{var box=document.createElement('div');box.id='cc602-idle-lock';box.style.cssText='position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:rgba(12,28,48,.78);font-family:inherit';box.innerHTML='<div style="max-width:420px;padding:28px;border-radius:20px;background:#fff;color:#17324f;text-align:center;box-shadow:0 20px 70px #0004"><h2>CRM Locked</h2><p>10 minutes inactive. All CRM connections are closing. Please log in again to resume.</p></div>';document.body.appendChild(box)}catch(e){}
    // A single best-effort keepalive logout, never a repeating approval/check loop.
    try{nativeFetch('/api/auth/logout',{method:'POST',credentials:'include',keepalive:true,headers:{'Content-Type':'application/json','X-Career-Crox-Background':'1'},body:JSON.stringify({logout_reason:'auto_inactivity_10m',reason:reason,notify_leadership:'1'})}).catch(function(){})}catch(e){}
    localLogout(reason);if(timer)clearTimeout(timer);setTimeout(function(){if(location.pathname!='/login')location.replace('/login');else location.reload()},3200);
  }
  // Local logout from another CRM tab: close connections without another database POST.
  window.addEventListener('storage',function(e){if(e.key===EV&&e.newValue&&!stopped){stopped=true;window.__CC602_NETWORK_PAUSED__=true;if(timer)clearTimeout(timer);try{window.dispatchEvent(new CustomEvent('career-crox-idle-lock-begin'))}catch(_){}location.replace('/login');}});
  function schedule(){if(timer)clearTimeout(timer);if(stopped)return;
    if(!user()){timer=setTimeout(schedule,30000);return}
    if(isExpired()){logout();return}timer=setTimeout(schedule,Math.max(500,Math.min(30000,TEN-(Date.now()-last())+80)));
  }
  function pulse(){if(stopped||document.hidden||!user()||window.__CC602_NETWORK_PAUSED__||isExpired())return;
    var now=Date.now();if(now-lastPulse<110000)return;lastPulse=now;try{localStorage.setItem('cc602_last_human_activity_pulse',String(now))}catch(_e){}
    nativeFetch('/api/auth/activity',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-Career-Crox-Last-Activity-At':String(read(H))},body:'{}'}).catch(function(){});
  }
  function human(e){if(e.isTrusted===false||stopped||!user())return;if(isExpired()){logout();return}
    var now=Date.now();if(now-writing<15000)return;writing=now;
    try{localStorage.setItem(H,String(now));localStorage.setItem(L,String(now))}catch(err){}
    pulse();schedule();
  }
  ['click','keydown','wheel','touchstart','pointerdown'].forEach(function(event){window.addEventListener(event,human,{passive:true,capture:true})});
  window.addEventListener('pageshow',schedule);document.addEventListener('visibilitychange',schedule);
  // Initialize H from the existing historical timestamp, never from a background API result.
  if(user()&&!read(H)){try{localStorage.setItem(H,String(read(L)||read(G)||Date.now()))}catch(e){}}
  schedule();
})();

/* CC26_624: manual-first Admin ARIA schedule + Daily Tasks / opt-in Recurring Work.
   Uses the existing deployed JS asset (no new script request or extra GitHub file).
   Reads already-cached CRM rows first; GETs ONLY on explicit user action. */
(function(){
'use strict';
if(window.__CC622_UI_INSTALLED__)return;window.__CC622_UI_INSTALLED__=true;
var tPanel=null,aPanel=null,lastTasks='',manualTaskRows=null,ariaTimes=null,uiScheduled=false,lastTaskPaint=0,lastTaskDay='';
var safe = function(v){return String(v==null?'':v);};
function cc630CurrentUserId(){try{return safe((JSON.parse(localStorage.getItem('careerCroxCachedUser')||'null')||{}).user_id);}catch(_){return '';}}
var make=function(tag,cls,txt){var el=document.createElement(tag);if(cls)el.className=cls;if(txt!==undefined)el.textContent=safe(txt);return el;};
var IST=330*60000;
var today=function(){return new Date(Date.now()+IST).toISOString().slice(0,10);};
var statusText=function(msg){var el=document.getElementById('cc622-task-status');if(el)el.textContent=safe(msg);};

// CC26_631: One employee directory for Tasks + Recurring Work, no user manual refresh.
// Reuse a user-scoped cached list immediately; network runs only on first need,
// one explicit modal-open retry after an earlier failure, or browser reconnect.
var cc631EmployeesPromise=null,cc631LastLookup=0,cc631Failed=false;
function cc631DirectoryKey(){return 'careerCroxTasksUsers:v2:'+cc630CurrentUserId();}
function cc631CachedEmployees(){
 var rows=readCached(cc631DirectoryKey());
 return Array.isArray(rows)?rows.filter(function(u){return u&&String(u.user_id||'').trim();}):[];
}
function cc631EmitEmployees(rows){
 if(!Array.isArray(rows)||!rows.length)return;
 writeCached(cc631DirectoryKey(),rows);
 window.dispatchEvent(new CustomEvent('cc630-task-assignees-loaded',{detail:{users:rows}}));
}
function cc631FetchEmployees(force){
 if(!cc630CurrentUserId()||window.__CC602_NETWORK_PAUSED__||/\/login(?:\/|$)/.test(location.pathname))return Promise.resolve([]);
 var cached=cc631CachedEmployees();
 if(cached.length&&!force)return Promise.resolve(cached);
 if(cc631EmployeesPromise)return cc631EmployeesPromise;
 if(!force&&cc631LastLookup&&Date.now()-cc631LastLookup<25000)return Promise.resolve(cached);
 cc631LastLookup=Date.now();
 cc631EmployeesPromise=apiJson('/api/tasks/assignees')
 .then(function(result){var rows=Array.isArray(result.users)?result.users.filter(function(u){return u&&u.user_id;}):[];
   if(rows.length){cc631Failed=false;cc631EmitEmployees(rows);}
   else cc631Failed=true;
   return rows;
 }).catch(function(){cc631Failed=true;return cached;}).finally(function(){cc631EmployeesPromise=null;});
 return cc631EmployeesPromise;
}
window.addEventListener('online',function(){if(location.pathname==='/tasks'&&cc631Failed&&!window.__CC602_NETWORK_PAUSED__)cc631FetchEmployees(true);});

var style=document.createElement('style');style.id='cc622-manual-ui';style.textContent=`
#cc622-task-panel,#cc622-aria-panel{box-sizing:border-box;color:#24344f;border:1px solid #c2d9f2;border-radius:25px;padding:22px;background:linear-gradient(120deg,#fffdfb,#eff6ff 48%,#e9fff3);box-shadow:0 15px 39px #334e7519,inset 0 2px #fff;isolation:isolate;margin:14px 0}
#cc622-task-panel *,#cc622-aria-panel *{box-sizing:border-box}
.cc622-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.cc622-title{font-size:22px;font-weight:950;color:#1b335b;line-height:1.2}
.cc622-sub{font-size:13px;font-weight:670;color:#42607b;line-height:1.5;margin:5px 0 14px}
.cc622-badge{border-radius:999px;padding:8px 13px;background:linear-gradient(112deg,#d7ffed,#e0f3ff);font-weight:850;color:#0f7756;font-size:12px}
.cc622-actions{display:flex;flex-wrap:wrap;gap:9px;align-items:center}
.cc622-btn{appearance:none;cursor:pointer;padding:11px 16px;border-radius:14px;border:1px solid #b5cceb;color:#223a63;font-weight:850;font-size:13px;background:linear-gradient(110deg,#fff,#eaf1ff);box-shadow:0 6px 16px #5774a91b;transition:transform .15s,box-shadow .15s}
.cc622-btn:hover{transform:translateY(-1px);background:linear-gradient(115deg,#d6ffea,#c8f2d8);color:#075437;box-shadow:0 10px 25px #23a66b30}
.cc622-btn:disabled{opacity:.55;cursor:wait;transform:none}
.cc622-btn.primary{background:linear-gradient(110deg,#16b48c,#336ce8);border:0;color:#fff}
.cc622-btn.primary:hover{background:linear-gradient(110deg,#0ba772,#6dd2a1);color:#073d34}
.cc622-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.cc622-card{border:1px solid #d7e4f2;padding:15px;border-radius:18px;background:linear-gradient(130deg,#fff,#f7fcff);box-shadow:0 7px 18px #4158830b}
.cc622-card strong{font-size:16px;color:#243657;font-weight:900;display:block;overflow-wrap:anywhere}
.cc622-card small{font-size:12px;color:#62738d;display:block;margin:6px 0 10px;font-weight:650}
.cc622-card p{color:#405572;font-size:13px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}
.cc622-form[hidden]{display:none!important}
.cc622-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:16px 0 7px;padding:18px;border:1px solid #c9e4ed;border-radius:20px;background:#ffffffbe}
.cc622-form label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:#476079;font-weight:850}
.cc622-form input,.cc622-form textarea,.cc622-form select{width:100%;min-height:41px;border-radius:12px;border:1px solid #bfcee6;padding:10px 12px;background:#fff;color:#203350;font:inherit;font-size:14px}
.cc622-form textarea{min-height:78px;resize:vertical}
.cc622-form .cc622-wide{grid-column:1/-1}
.cc622-assignees{max-height:148px;overflow:auto;padding:8px 10px;border:1px solid #d1dff0;border-radius:14px;background:#f8fcff}
.cc622-assignees label{flex-direction:row;align-items:center;gap:8px;font-size:13px;padding:4px}
.cc622-assignees input{min-height:0;width:auto;accent-color:#08a776}
#cc622-task-panel .cc622-status,#cc622-aria-panel .cc622-status{min-height:18px;font-size:12px;color:#365176;font-weight:750;margin-top:9px}
body.cc622-task-clean .task-filter-grid{display:none!important}
body.cc622-task-clean.cc622-show-filters .task-filter-grid{display:grid!important}
body.cc622-task-clean .task-summary-grid small,body.cc622-task-clean .task-recurring-strip small{display:none!important}
body.cc622-task-clean .task-summary-grid .metric-card{min-height:88px!important}
.task-premium-form:not(.cc622-advanced) .task-modal-grid>.field:nth-child(2),
.task-premium-form:not(.cc622-advanced) .task-modal-grid>.field:nth-child(3),
.task-premium-form:not(.cc622-advanced) .task-modal-grid>.field:nth-child(5),
.task-premium-form:not(.cc622-advanced) .task-modal-grid>.field:nth-child(6),
.task-premium-form:not(.cc622-advanced) .task-modal-grid>.field:nth-child(7),
.task-premium-form:not(.cc622-advanced) .task-quick-minute-row{display:none!important}

/* CC26_624: everyday task is the default, recurring assignments are on demand. */
#cc622-task-panel{background:linear-gradient(125deg,#fffefa 0%,#f1f8ff 53%,#effff6 100%);border-color:#cfe5fc;padding:20px 22px;box-shadow:0 18px 44px #476d9d1e,inset 0 2px 0 #fff}
#cc622-task-panel .cc624-daily-hero{display:flex;gap:20px;justify-content:space-between;align-items:center;flex-wrap:wrap;border:1px solid #bfe3e7;border-radius:22px;padding:22px 24px;margin-bottom:16px;background:linear-gradient(112deg,#f5ffff,#f1f4ff 57%,#fff3f8);box-shadow:0 9px 26px #6392b31c,inset 0 2px 0 #fff}
#cc622-task-panel .cc624-daily-copy{flex:1 1 280px;min-width:0}
#cc622-task-panel .cc624-eyebrow{font-weight:900;font-size:13px;letter-spacing:.12em;color:#277764}
#cc622-task-panel .cc624-daily-title{font-size:clamp(22px,2.2vw,30px);color:#173456;font-weight:950;margin:7px 0;line-height:1.2}
#cc622-task-panel .cc624-daily-copy p{font-size:15px;line-height:1.5;color:#415a74;font-weight:650;margin:5px 0}
#cc622-task-panel .cc624-daily-create{border:1px solid #a5d8d4;cursor:pointer;border-radius:18px;min-height:58px;padding:14px 28px;font-size:17px;font-weight:900;color:#123b39;background:linear-gradient(110deg,#d3fff0,#bfeeff 48%,#e5d5ff);box-shadow:0 12px 30px #329b932a,inset 0 2px 0 #fff;transition:transform .16s,box-shadow .16s,background .16s}
#cc622-task-panel .cc624-daily-create:hover,#cc622-task-panel .cc624-daily-create:focus-visible{transform:translateY(-2px);color:#104633;background:linear-gradient(110deg,#aaf7d3,#a5ecf4,#d1d0ff);box-shadow:0 14px 32px #2aa98634}
#cc622-task-panel .cc624-recurring-toggle{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:16px 18px;border-radius:19px;border:1px solid #dae5fb;background:linear-gradient(115deg,#ffffff,#f4f8ff,#f1fff7)}
#cc622-task-panel .cc624-recurring-toggle strong{display:block;font-size:19px;color:#243f68;font-weight:900}
#cc622-task-panel .cc624-recurring-toggle small{display:block;margin-top:5px;font-size:14px;color:#45617a;font-weight:650}
#cc622-task-panel .cc624-recurring-details{margin-top:15px;padding:15px;border-radius:20px;border:1px solid #d9e9fa;background:linear-gradient(115deg,#fbfdff,#f5fbff,#f7fff9)}
#cc622-task-panel .cc624-recurring-details[hidden]{display:none!important}
#cc622-task-panel .cc622-title{font-size:23px;color:#1b3c67}#cc622-task-panel .cc622-sub{font-size:15px}
#cc622-task-panel .cc622-btn{font-size:15px;min-height:46px;padding:12px 19px;background:linear-gradient(115deg,#ffffff,#eff7ff,#ebfff7);color:#214365;border-color:#b9d9eb;font-weight:850}
#cc622-task-panel .cc622-btn.primary{background:linear-gradient(112deg,#d6fff1,#c7eaff,#e4dfff);color:#123d41;border:1px solid #a9d4db}
#cc622-task-panel .cc622-btn:hover{background:linear-gradient(112deg,#c8fbe2,#b9f1e6,#d9e6ff);color:#104733}
#cc622-task-panel .cc622-form label,#cc622-task-panel .cc622-assignees label{font-size:15px;color:#254363}
#cc622-task-panel .cc622-form input,#cc622-task-panel .cc622-form textarea,#cc622-task-panel .cc622-form select{min-height:48px;font-size:16px;color:#1c3854;background:#fff;border:1px solid #bcd7e7}
#cc622-task-panel .cc622-form textarea{min-height:94px}
#cc622-task-panel .cc622-assignees{max-height:210px}
#cc622-task-panel .cc622-assignees input{min-height:0}
#cc622-task-panel .cc622-card{background:linear-gradient(125deg,#fff,#f1f9ff,#f5fff7);border-color:#cbdff0}
#cc622-task-panel .cc622-card strong{font-size:18px}#cc622-task-panel .cc622-card p{font-size:15px}#cc622-task-panel .cc622-card small{font-size:14px}
body.cc622-task-clean .table-panel .table-toolbar .add-profile-btn,body.cc622-task-clean .table-panel .table-toolbar .ghost-btn{background:linear-gradient(115deg,#e5fff2,#d4eeff,#f0e5ff)!important;color:#224469!important;border:1px solid #bdd6e9!important;min-height:43px!important;font-size:15px!important;font-weight:850!important}
body.cc622-task-clean .table-panel .table-title{font-size:21px!important;color:#1d3b63!important}
body.cc622-task-clean .table-panel label{font-size:15px!important;color:#234567!important}
body.cc622-task-clean .table-panel select,body.cc622-task-clean .table-panel input{min-height:44px!important;font-size:15px!important;color:#213b5a!important;background:#fff!important}
body.cc622-task-clean .task-summary-grid .metric-card{min-height:101px!important;background:linear-gradient(120deg,#fff,#eff7ff,#effef5)!important;color:#1e4166!important;border:1px solid #c9dff1!important;box-shadow:0 8px 22px #5279a719!important}
body.cc622-task-clean .task-summary-grid .metric-card span{font-size:16px!important;color:#234669!important;font-weight:850!important}
body.cc622-task-clean .task-summary-grid .metric-card strong{font-size:29px!important;color:#173a61!important}
body.cc622-task-clean .task-premium-form label{font-size:16px!important;color:#244566!important;font-weight:850!important}
body.cc622-task-clean .task-premium-form input,body.cc622-task-clean .task-premium-form select,body.cc622-task-clean .task-premium-form textarea{font-size:16px!important;min-height:48px!important;background:#fff!important;color:#183a5b!important;border-color:#bfd5ea!important}
body.cc622-task-clean .task-premium-form textarea{min-height:115px!important}
body.cc622-task-clean .task-premium-modal .add-profile-btn,body.cc622-task-clean .task-premium-modal .ghost-btn{font-size:16px!important;min-height:47px!important;background:linear-gradient(120deg,#c8f9e7,#cbeafe,#e6ddff)!important;color:#123e59!important;border:1px solid #b4d8ec!important}
body.cc622-task-clean .task-premium-modal .panel-title{font-size:25px!important;color:#163a64!important}
body.cc622-task-clean .task-list-table td,body.cc622-task-clean .task-list-table th{font-size:15px!important;color:#243f61!important}
@media(max-width:720px){#cc622-task-panel .cc624-daily-hero{padding:18px}#cc622-task-panel .cc624-daily-create{width:100%}}



/* CC26_626: premium Gen-Z readability polish for Tasks / Recurring Work / Task modal controls. */
#cc622-task-panel .cc624-daily-hero{
  background:linear-gradient(135deg,#fff8ff 0%,#f1f7ff 44%,#eefdf8 100%)!important;
  border:1px solid #cfe2ff!important;
  box-shadow:0 18px 40px rgba(79,113,175,.18),inset 0 1px 0 rgba(255,255,255,.98)!important;
}
#cc622-task-panel .cc624-eyebrow{
  color:#16796a!important;
  text-shadow:none!important;
}
#cc622-task-panel .cc624-daily-title{
  color:#17355b!important;
  letter-spacing:-.03em!important;
}
#cc622-task-panel .cc624-daily-copy p,
#cc622-task-panel .cc624-recurring-toggle small,
#cc622-task-panel .cc622-sub,
#cc622-task-panel .cc622-card p,
#cc622-task-panel .cc622-card small{
  color:#4a6383!important;
  opacity:1!important;
}
#cc622-task-panel .cc624-daily-create,
body.cc622-task-clean .table-panel .table-toolbar .add-profile-btn,
body.cc622-task-clean .task-premium-modal .add-profile-btn{
  background:linear-gradient(135deg,#ff8d56 0%,#ff5f88 38%,#7158ff 100%)!important;
  border:1px solid rgba(255,255,255,.72)!important;
  color:#ffffff!important;
  -webkit-text-fill-color:#ffffff!important;
  text-shadow:0 1px 1px rgba(20,30,80,.22)!important;
  box-shadow:0 16px 34px rgba(114,88,255,.24),inset 0 1px 0 rgba(255,255,255,.36)!important;
}
#cc622-task-panel .cc624-daily-create:hover,
#cc622-task-panel .cc624-daily-create:focus-visible,
body.cc622-task-clean .table-panel .table-toolbar .add-profile-btn:hover,
body.cc622-task-clean .task-premium-modal .add-profile-btn:hover{
  transform:translateY(-2px)!important;
  filter:saturate(1.06) brightness(1.02)!important;
}
#cc622-task-panel .cc624-recurring-toggle,
#cc622-task-panel .cc624-recurring-details,
#cc622-task-panel .cc622-card{
  background:linear-gradient(135deg,rgba(255,255,255,.98),rgba(241,248,255,.96) 54%,rgba(245,255,249,.96) 100%)!important;
  border-color:#d7e4fb!important;
  box-shadow:0 12px 28px rgba(75,103,160,.12),inset 0 1px 0 rgba(255,255,255,.9)!important;
}
#cc622-task-panel .cc624-recurring-toggle strong,
#cc622-task-panel .cc622-title,
body.cc622-task-clean .table-panel .table-title,
body.cc622-task-clean .task-premium-modal .panel-title,
body.cc622-task-clean .task-premium-form label{
  color:#17395f!important;
}
#cc622-task-panel .cc622-badge{
  background:linear-gradient(135deg,#ecfff5,#e8f2ff)!important;
  color:#0f6f58!important;
  border:1px solid #cae6d8!important;
}
#cc622-task-panel .cc622-btn,
body.cc622-task-clean .table-panel .table-toolbar .ghost-btn,
body.cc622-task-clean .task-premium-modal .ghost-btn{
  background:linear-gradient(135deg,#ffffff 0%,#eef5ff 54%,#f4fff7 100%)!important;
  border:1px solid #c8daf3!important;
  color:#1d426c!important;
  -webkit-text-fill-color:#1d426c!important;
  box-shadow:0 10px 22px rgba(77,102,153,.13),inset 0 1px 0 rgba(255,255,255,.95)!important;
}
#cc622-task-panel .cc622-btn.primary{
  background:linear-gradient(135deg,#22c38f 0%,#1f9dc7 42%,#6a5cff 100%)!important;
  border:1px solid rgba(255,255,255,.68)!important;
  color:#ffffff!important;
  -webkit-text-fill-color:#ffffff!important;
}
#cc622-task-panel .cc622-btn:hover,
body.cc622-task-clean .table-panel .table-toolbar .ghost-btn:hover,
body.cc622-task-clean .task-premium-modal .ghost-btn:hover{
  transform:translateY(-1px)!important;
}
#cc622-task-panel .cc622-form,
body.cc622-task-clean .task-premium-form .field{
  background:linear-gradient(135deg,rgba(255,255,255,.96),rgba(243,248,255,.92) 50%,rgba(248,255,252,.92) 100%)!important;
  border-color:#d4e1f8!important;
  box-shadow:0 12px 28px rgba(80,109,161,.10),inset 0 1px 0 rgba(255,255,255,.95)!important;
}
#cc622-task-panel .cc622-form label,
#cc622-task-panel .cc622-assignees label,
body.cc622-task-clean .table-panel label,
body.cc622-task-clean .task-premium-form label,
body.cc622-task-clean .task-premium-form .field > label{
  color:#27486f!important;
  font-weight:850!important;
}
#cc622-task-panel .cc622-form input,
#cc622-task-panel .cc622-form textarea,
#cc622-task-panel .cc622-form select,
body.cc622-task-clean .table-panel select,
body.cc622-task-clean .table-panel input,
body.cc622-task-clean .task-premium-form input,
body.cc622-task-clean .task-premium-form select,
body.cc622-task-clean .task-premium-form textarea,
body.cc622-task-clean .task-premium-form .inline-input{
  background:#ffffff!important;
  border:1px solid #b8cff0!important;
  color:#173a5c!important;
  -webkit-text-fill-color:#173a5c!important;
  box-shadow:inset 0 1px 2px rgba(36,63,116,.05)!important;
}
#cc622-task-panel .cc622-form input::placeholder,
#cc622-task-panel .cc622-form textarea::placeholder,
body.cc622-task-clean .task-premium-form input::placeholder,
body.cc622-task-clean .task-premium-form textarea::placeholder,
body.cc622-task-clean .task-premium-form .inline-input::placeholder{
  color:#6d82a2!important;
  opacity:1!important;
}
body.cc622-task-clean .task-summary-grid .metric-card{
  background:linear-gradient(135deg,#1f64ff 0%,#5574ff 45%,#8b5cff 100%)!important;
  color:#ffffff!important;
  border:1px solid rgba(255,255,255,.22)!important;
  box-shadow:0 16px 30px rgba(67,92,177,.22)!important;
}
body.cc622-task-clean .task-summary-grid .metric-card.tone-green{background:linear-gradient(135deg,#06a76e 0%,#0ec98b 100%)!important}
body.cc622-task-clean .task-summary-grid .metric-card.tone-orange{background:linear-gradient(135deg,#ff8a3d 0%,#ffb347 100%)!important}
body.cc622-task-clean .task-summary-grid .metric-card.tone-red{background:linear-gradient(135deg,#ff4f72 0%,#ff7b8f 100%)!important}
body.cc622-task-clean .task-summary-grid .metric-card span,
body.cc622-task-clean .task-summary-grid .metric-card strong,
body.cc622-task-clean .task-summary-grid .metric-card small{
  color:#ffffff!important;
  -webkit-text-fill-color:#ffffff!important;
}
body.cc622-task-clean .task-premium-modal .task-assignee-option{
  background:linear-gradient(135deg,#f8fbff,#f4fffa)!important;
  color:#1d456f!important;
}
body.cc622-task-clean .task-premium-modal .task-assignee-option span{
  color:#607695!important;
}



/* CC26_627: green-gloss Task editor + animated custom dropdowns. */
#cc622-task-panel .cc624-daily-hero,
#cc622-task-panel .cc624-recurring-toggle,
#cc622-task-panel .cc624-recurring-details,
#cc622-task-panel .cc622-card{
  background:linear-gradient(135deg,#fbfffc 0%,#effff6 48%,#e9fff5 100%)!important;
  border-color:#bdebd2!important;
  box-shadow:0 16px 38px rgba(7,124,83,.12),inset 0 1px 0 #fff!important;
}
#cc622-task-panel .cc624-daily-create,
#cc622-task-panel .cc622-btn.primary,
body.cc622-task-clean .table-panel .table-toolbar .add-profile-btn,
body.cc622-task-clean .task-premium-modal .add-profile-btn{
  background:linear-gradient(118deg,#057a55 0%,#08b67c 38%,#2ad29b 67%,#0b8f6a 100%)!important;
  background-size:220% 220%!important;
  animation:cc627GreenShine 4.8s ease infinite!important;
  color:#fff!important;-webkit-text-fill-color:#fff!important;
  border:1px solid rgba(255,255,255,.62)!important;
  text-shadow:0 1px 1px rgba(0,62,42,.3)!important;
  box-shadow:0 13px 30px rgba(0,133,90,.26),inset 0 1px 0 rgba(255,255,255,.42)!important;
}
#cc622-task-panel .cc624-daily-create:hover,
#cc622-task-panel .cc622-btn.primary:hover,
body.cc622-task-clean .table-panel .table-toolbar .add-profile-btn:hover,
body.cc622-task-clean .task-premium-modal .add-profile-btn:hover{
  transform:translateY(-2px) scale(1.035)!important;
  box-shadow:0 18px 38px rgba(0,138,93,.34),0 0 0 4px rgba(44,213,155,.10)!important;
}
#cc622-task-panel .cc622-btn,
body.cc622-task-clean .table-panel .table-toolbar .ghost-btn,
body.cc622-task-clean .task-premium-modal .ghost-btn{
  background:linear-gradient(135deg,#ffffff,#effff6 55%,#e8fff2)!important;
  border-color:#bfe8d2!important;
  color:#176047!important;-webkit-text-fill-color:#176047!important;
}
body.cc622-task-clean .task-summary-grid .metric-card,
body.cc622-task-clean .task-summary-grid .metric-card.tone-purple,
body.cc622-task-clean .task-summary-grid .metric-card.tone-green,
body.cc622-task-clean .task-summary-grid .metric-card.tone-orange,
body.cc622-task-clean .task-summary-grid .metric-card.tone-red{
  background:linear-gradient(125deg,#087955 0%,#0caf78 44%,#31d39e 76%,#0b8e68 100%)!important;
  background-size:220% 220%!important;
  animation:cc627GreenShine 5.5s ease infinite!important;
  border-color:rgba(255,255,255,.45)!important;
  box-shadow:0 14px 30px rgba(0,119,79,.20),inset 0 1px 0 rgba(255,255,255,.38)!important;
}
body.cc622-task-clean .task-summary-grid .metric-card:nth-child(2){animation-delay:-1.1s!important}
body.cc622-task-clean .task-summary-grid .metric-card:nth-child(3){animation-delay:-2.0s!important}
body.cc622-task-clean .task-summary-grid .metric-card:nth-child(4){animation-delay:-3.0s!important}
body.cc622-task-clean .task-summary-grid .metric-card:nth-child(5){animation-delay:-4.0s!important}
@keyframes cc627GreenShine{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}

/* Browser-native <option> hover cannot animate reliably. CC26_627 renders a lightweight custom menu only inside the Task modal. */
.task-premium-form .cc627-select{position:relative!important;width:100%!important;z-index:1!important}
.task-premium-form .cc627-select.open{z-index:500!important}
.task-premium-form select.cc627-native-select{
  position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important;
}
.task-premium-form .cc627-select-trigger{
  width:100%!important;min-height:49px!important;display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;
  border:1px solid #a9dfc3!important;border-radius:13px!important;padding:10px 13px!important;cursor:pointer!important;
  background:linear-gradient(135deg,#ffffff 0%,#f0fff7 55%,#e8fff2 100%)!important;
  color:#174c3b!important;-webkit-text-fill-color:#174c3b!important;font:850 15px/1.2 "Plus Jakarta Sans","Segoe UI",sans-serif!important;
  box-shadow:0 7px 18px rgba(7,123,81,.10),inset 0 1px 0 #fff!important;transition:.18s ease!important;text-align:left!important;
}
.task-premium-form .cc627-select-trigger:hover,.task-premium-form .cc627-select.open .cc627-select-trigger{
  transform:translateY(-1px)!important;border-color:#37c990!important;
  background:linear-gradient(120deg,#eafff4,#d8ffeb,#edfff6)!important;
  box-shadow:0 12px 26px rgba(6,145,94,.18),0 0 0 3px rgba(45,207,151,.10)!important;
}
.task-premium-form .cc627-select-arrow{font-size:15px!important;color:#0a8c61!important;transition:transform .18s ease!important}
.task-premium-form .cc627-select.open .cc627-select-arrow{transform:rotate(180deg)!important}
.task-premium-form .cc627-select-menu{
  position:absolute!important;left:0!important;right:0!important;top:calc(100% + 7px)!important;z-index:2147483000!important;
  max-height:248px!important;overflow:auto!important;padding:8px!important;border:1px solid #b8e6ce!important;border-radius:16px!important;
  background:linear-gradient(145deg,rgba(255,255,255,.99),rgba(237,255,246,.99))!important;
  box-shadow:0 24px 50px rgba(6,92,64,.22),inset 0 1px 0 #fff!important;backdrop-filter:blur(12px)!important;
}
.task-premium-form .cc627-select-menu[hidden]{display:none!important}
.task-premium-form .cc627-select-option{
  width:100%!important;display:flex!important;align-items:center!important;justify-content:space-between!important;text-align:left!important;
  min-height:42px!important;margin:3px 0!important;padding:9px 11px!important;border:1px solid transparent!important;border-radius:11px!important;
  background:transparent!important;color:#1f4c3d!important;-webkit-text-fill-color:#1f4c3d!important;
  font:800 14px/1.25 "Plus Jakarta Sans","Segoe UI",sans-serif!important;cursor:pointer!important;
  transform-origin:left center!important;transition:transform .14s ease,box-shadow .14s ease,background .14s ease,color .14s ease!important;
}
.task-premium-form .cc627-select-option:hover,
.task-premium-form .cc627-select-option:focus-visible{
  transform:translateX(5px) scale(1.045)!important;
  background:linear-gradient(118deg,#057a55 0%,#08b67c 48%,#32d49f 100%)!important;
  color:#fff!important;-webkit-text-fill-color:#fff!important;border-color:rgba(255,255,255,.55)!important;
  box-shadow:0 10px 22px rgba(0,126,84,.24),inset 0 1px 0 rgba(255,255,255,.35)!important;outline:none!important;
}
.task-premium-form .cc627-select-option.is-selected{
  background:linear-gradient(135deg,#dffff0,#caffdf)!important;color:#075d3e!important;-webkit-text-fill-color:#075d3e!important;border-color:#96dbb8!important;
}
.task-premium-form .cc627-select-option.is-selected::after{content:"✓";font-weight:1000!important;color:#07875c!important}

@media(max-width:650px){#cc622-task-panel,#cc622-aria-panel{padding:14px}.cc622-grid{grid-template-columns:1fr}}
`;document.head.append(style);
function readCached(key){try{var r=sessionStorage.getItem(key)||localStorage.getItem(key),j=JSON.parse(r||'null');return j&&Object.prototype.hasOwnProperty.call(j,'data')?j.data:j;}catch(_){return null;}}
function writeCached(key,data){try{sessionStorage.setItem(key,JSON.stringify({cachedAt:Date.now(),data:data}));}catch(_){}}
function projected(row){
 if(!row||row.recurring_parent_task_id!=='CC_PERMANENT_V1')return row;
 var start=safe(row.permanent_start_date||row.due_date).slice(0,10),end=safe(row.permanent_end_date||(safe(row.recurring_interval_minutes).match(/^UNTIL:(\d{4}-\d{2}-\d{2})$/)||[])[1]),day=today();
 var delta=Math.round((Date.parse(day+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000),weekly=safe(row.recurring_type).toLowerCase()==='weekly',active=delta>=0&&(!end||day<=end)&&(!weekly||delta%7===0);
 var done=active&&['completed','closed','done'].includes(safe(row.status).toLowerCase())&&new Date(row.closed_at||0).getTime()>0&&new Date(new Date(row.closed_at).getTime()+IST).toISOString().slice(0,10)===day;
 return Object.assign({},row,{permanent_start_date:start,permanent_end_date:end,permanent_today:active,status:active?(done?'Completed':'Open'):(end&&day>end?'Expired':'Scheduled'),due_date:active?day+safe(row.due_date).slice(10):row.due_date});
}
function getTaskRows(){var cached=readCached('careerCroxTasksRows:v2');return (Array.isArray(manualTaskRows)?manualTaskRows:(Array.isArray(cached)?cached:[])).map(projected);}
async function apiJson(path,options){var response=await fetch(path,Object.assign({credentials:'same-origin',cache:'no-store'},options||{}));var data=await response.json().catch(function(){return {};});if(!response.ok)throw Error(data.message||'Could not connect to CRM.');return data;}
function permanentRows(){return getTaskRows().filter(function(x){return x&&x.recurring_parent_task_id==='CC_PERMANENT_V1';});}
function renderTasks(force){
 if(!tPanel||!tPanel.isConnected)return;
 var currentDay=today();
 if(!force && currentDay===lastTaskDay && Date.now()-lastTaskPaint<1200)return;
 lastTaskDay=currentDay;lastTaskPaint=Date.now();
 var rows=permanentRows(),signature=JSON.stringify(rows.map(function(x){return [x.task_id,x.title,x.assigned_to_name,x.status,x.closed_at,x.due_date,x.permanent_end_date,x.updated_at];}));
 if(!force&&signature===lastTasks)return;lastTasks=signature;
 var host=tPanel.querySelector('#cc622-task-cards');if(!host)return;host.replaceChildren();
 var count=tPanel.querySelector('#cc622-permanent-count');if(count)count.textContent=rows.length+' saved assignments';
 if(!rows.length){host.append(make('p','cc622-sub','No permanent tasks yet. Assign one once; it will be shown every scheduled day without a nightly database job.'));return;}
 rows.forEach(function(raw){var row=projected(raw),card=make('article','cc622-card');
  card.append(make('strong','',row.title||'Untitled task'));
  card.append(make('small','',safe(row.assigned_to_name||'Team member')+' • '+(row.recurring_type==='weekly'?'Every week':'Every day')+' • '+(row.permanent_end_date?'Until '+row.permanent_end_date:'No end date')));
  card.append(make('span','cc622-badge',row.permanent_today?(safe(row.status).toLowerCase()==='open'?'TODAY · OPEN':'TODAY · COMPLETE'):(row.status==='Expired'?'FINISHED':'NEXT SCHEDULED')));
  var details=make('p','',row.description||''),actions=make('div','cc622-actions');details.hidden=true;
  var view=make('button','cc622-btn','Details');view.type='button';view.onclick=function(){details.hidden=!details.hidden;view.textContent=details.hidden?'Details':'Hide details';};actions.append(view);
  if(row.permanent_today && !['completed','closed','done'].includes(safe(row.status).toLowerCase())){
    var complete=make('button','cc622-btn primary','Mark done today');complete.type='button';complete.onclick=async function(){complete.disabled=true;complete.textContent='Saving…';try{var result=await apiJson('/api/tasks/'+encodeURIComponent(row.task_id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'Completed'})});var updated=result.item||Object.assign({},row,{status:'Completed',closed_at:new Date().toISOString()});var all=getTaskRows().map(function(v){return safe(v.task_id)===safe(row.task_id)?Object.assign({},v,updated):v;});manualTaskRows=all;writeCached('careerCroxTasksRows:v2',all);statusText('Today’s completion saved. The same task will reappear on its next scheduled day.');renderTasks(true);}catch(error){statusText(error.message);complete.disabled=false;complete.textContent='Mark done today';}};actions.append(complete);
  }
  card.append(details,actions);host.append(card);
 });
}
function mountTasks(){
 if(tPanel&&tPanel.isConnected){renderTasks(false);return;}
 var container=document.querySelector('.task-summary-grid');if(!container)return;
 tPanel=make('section','');tPanel.id='cc622-task-panel';
 tPanel.innerHTML='<div class="cc624-daily-hero"><div class="cc624-daily-copy"><span class="cc624-eyebrow">TASKS · YOUR WORKSPACE</span><div class="cc624-daily-title">Create a task for today</div><p>Make an everyday, one-time task in seconds. Repeat only when you choose Recurring Work below.</p></div><button type="button" id="cc624-create-daily" class="cc624-daily-create">＋ Create Task</button></div><div class="cc624-recurring-toggle"><div><strong>↻ Recurring Work</strong><small>Daily / weekly tasks that continue until the date you choose.</small></div><div class="cc622-actions"><span class="cc622-badge" id="cc624-recurring-badge">Optional</span><button type="button" id="cc624-toggle-recurring" class="cc622-btn" aria-expanded="false" aria-controls="cc624-recurring-content">＋ Set Up Recurring Work</button></div></div><div id="cc624-recurring-content" class="cc624-recurring-details" hidden><div class="cc622-head"><div><div class="cc622-title">✦ Permanent Tasks</div><p class="cc622-sub">Assign once. Everyone sees today’s work whenever they open Tasks. No nightly task creation or auto-refresh.</p></div><div class="cc622-actions"><span class="cc622-badge" id="cc622-permanent-count">0 saved assignments</span><button type="button" id="cc622-add-task" class="cc622-btn primary">+ New permanent task</button><button type="button" id="cc622-refresh-task" class="cc622-btn">↻ Refresh now</button><button type="button" id="cc622-filter-task" class="cc622-btn">Filters</button></div></div><form class="cc622-form" id="cc622-form" hidden><label>Task title<input name="title" maxlength="160" required placeholder="Daily follow-up calls"></label><label>Repeat<select name="recurring_type"><option value="daily">Every day</option><option value="weekly">Every week</option></select></label><label class="cc622-wide">Instructions<textarea name="description" maxlength="5000" required placeholder="What should be completed?"></textarea></label><label>Starts on (IST)<input type="date" name="start" required></label><label>Repeat until (leave empty for permanent)<input type="date" name="end"></label><label class="cc622-wide">Assign to employees<div class="cc622-assignees" id="cc622-assignees">Choose New permanent task to load names.</div></label><div class="cc622-actions cc622-wide"><button type="submit" class="cc622-btn primary" id="cc622-save-task">Assign permanent task</button><button type="button" class="cc622-btn" id="cc622-close-form">Cancel</button></div></form><div class="cc622-status" id="cc622-task-status" role="status"></div><div id="cc622-task-cards" class="cc622-grid"></div></div>';
 container.parentNode.insertBefore(tPanel,container);
 try{var me=JSON.parse(localStorage.getItem('careerCroxCachedUser')||'null')||{},role=safe(me.role||me.designation).toLowerCase();if(!['admin','manager','tl','team lead','teamlead'].includes(role))tPanel.querySelector('#cc622-add-task').hidden=true;}catch(_){}
 document.body.classList.add('cc622-task-clean');
 var form=tPanel.querySelector('#cc622-form');form.elements.start.value=today();
 var toggle=tPanel.querySelector('#cc624-toggle-recurring'),recurringBody=tPanel.querySelector('#cc624-recurring-content');
 toggle.onclick=function(){var expanded=toggle.getAttribute('aria-expanded')==='true';toggle.setAttribute('aria-expanded',String(!expanded));recurringBody.hidden=expanded;document.body.classList.toggle('cc624-recurring-open',!expanded);toggle.textContent=expanded?'＋ Set Up Recurring Work':'− Hide Recurring Work';if(!expanded){renderTasks(true);}};

 // CC26_630: SAMPLE test data is never a CRM UI action. No auto-seed on deploy or login.
 tPanel.querySelector('#cc624-create-daily').onclick=function(){var btn=document.querySelector('.table-panel .table-toolbar .add-profile-btn');if(!btn){statusText('Task editor is still opening. Please try again.');return;}btn.click();};
 tPanel.querySelector('#cc622-filter-task').onclick=function(){document.body.classList.toggle('cc622-show-filters');};
 tPanel.querySelector('#cc622-close-form').onclick=function(){form.hidden=true;};
 tPanel.querySelector('#cc622-add-task').onclick=async function(){
  form.hidden=false;form.elements.title.focus();var host=tPanel.querySelector('#cc622-assignees');
  var users=cc631CachedEmployees();
  if(!users.length){host.textContent='Getting employee names automatically…';users=await cc631FetchEmployees(true);}
  if(!users.length){host.textContent='Employee directory is unavailable. Reopen this form after connection returns.';return;}
  host.replaceChildren();users.filter(function(u){return u&&u.user_id&&!['0','false','disabled','deleted'].includes(safe(u.is_active).toLowerCase());}).forEach(function(u){var label=make('label'),check=make('input');check.type='checkbox';check.value=u.user_id;label.append(check,document.createTextNode(' '+safe(u.full_name||u.username||u.user_id)));host.append(label);});
 };
 tPanel.querySelector('#cc622-refresh-task').onclick=async function(e){e.currentTarget.disabled=true;statusText('Refreshing only on your request…');try{var data=await apiJson('/api/tasks?_refresh='+Date.now());manualTaskRows=Array.isArray(data.items)?data.items:[];writeCached('careerCroxTasksRows:v2',manualTaskRows);renderTasks(true);statusText('Tasks updated manually.');}catch(error){statusText(error.message);}finally{e.currentTarget.disabled=false;}};
 form.onsubmit=async function(event){event.preventDefault();var btn=tPanel.querySelector('#cc622-save-task');var title=form.elements.title.value.trim(),description=form.elements.description.value.trim(),start=form.elements.start.value,end=form.elements.end.value,type=form.elements.recurring_type.value,ids=[...tPanel.querySelectorAll('#cc622-assignees input:checked')].map(function(e){return e.value;});
  if(!ids.length){statusText('Please select at least one employee.');return;}if(end&&end<start){statusText('End date must be on or after start date.');return;}btn.disabled=true;btn.textContent='Assigning…';statusText('Saving your task…');
  try{var body={title:title,description:description,assigned_to_user_id:ids[0],assigned_to_user_ids:ids,priority:'Normal',status:'Open',due_date:start+'T09:00',recurring_type:type,permanent_task:'1',permanent_end_date:end,client_request_id:'permanent-'+Date.now()+'-'+Math.random().toString(36).slice(2)};
    var d=await apiJson('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});var items=Array.isArray(d.items)?d.items:[d.item].filter(Boolean);var rows=getTaskRows().concat(items);manualTaskRows=rows;writeCached('careerCroxTasksRows:v2',rows);form.hidden=true;form.reset();form.elements.start.value=today();renderTasks(true);statusText(items.length+' permanent assignment(s) saved. Each scheduled day appears from this one task record.');
  }catch(error){statusText(error.message);}finally{btn.disabled=false;btn.textContent='Assign permanent task';}
 };
 lastTasks='';renderTasks(true);
}

function enhanceTaskDropdowns627(form){
 if(!form||form.dataset.cc627Dropdowns==='1')return;form.dataset.cc627Dropdowns='1';
 if(!window.__CC627_DROPDOWN_DOC__){window.__CC627_DROPDOWN_DOC__=true;document.addEventListener('click',function(e){document.querySelectorAll('.cc627-select.open').forEach(function(w){if(w.contains(e.target))return;w.classList.remove('open');var m=w.querySelector('.cc627-select-menu');if(m)m.hidden=true;});},true);}
 Array.from(form.querySelectorAll('select')).forEach(function(sel){
  if(sel.dataset.cc627Enhanced)return;sel.dataset.cc627Enhanced='1';sel.classList.add('cc627-native-select');sel.tabIndex=-1;
  var wrap=make('div','cc627-select'),trigger=make('button','cc627-select-trigger'),label=make('span','cc627-select-label'),arrow=make('span','cc627-select-arrow','⌄'),menu=make('div','cc627-select-menu');
  trigger.type='button';menu.hidden=true;trigger.append(label,arrow);sel.parentNode.insertBefore(wrap,sel.nextSibling);wrap.append(trigger,menu);
  function currentText(){var opt=sel.options&&sel.selectedIndex>=0?sel.options[sel.selectedIndex]:null;return opt?safe(opt.textContent||opt.label||opt.value):'Choose option';}
  function syncLabel(){label.textContent=currentText();}
  function choose(value){
    try{var setter=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value')?.set;if(setter)setter.call(sel,value);else sel.value=value;}catch(_){sel.value=value;}
    sel.dispatchEvent(new Event('input',{bubbles:true}));sel.dispatchEvent(new Event('change',{bubbles:true}));syncLabel();wrap.classList.remove('open');menu.hidden=true;
  }
  function rebuild(){menu.replaceChildren();Array.from(sel.options||[]).forEach(function(opt){var b=make('button','cc627-select-option',safe(opt.textContent||opt.label||opt.value));b.type='button';b.dataset.value=safe(opt.value);if(String(opt.value)===String(sel.value))b.classList.add('is-selected');b.onclick=function(ev){ev.preventDefault();ev.stopPropagation();choose(opt.value);};menu.append(b);});
  if(sel.options.length<=1 && /assignee|assign to/i.test(String(sel.parentNode?.querySelector('label')?.textContent||''))){
    var loading=make('div','cc627-select-empty',cc631EmployeesPromise?'Loading employee names…':'Connecting to employee directory…');
    menu.append(loading);
    // The existing React select is populated by a small per-user event, not a manual button.
    cc631FetchEmployees(false).then(function(rows){
      if(!wrap.isConnected||!wrap.classList.contains('open'))return;
      if(rows.length){loading.textContent='Employee names available';setTimeout(function(){if(wrap.isConnected&&wrap.classList.contains('open')&&sel.options.length>1)rebuild();},120);}
      else loading.textContent='Employees unavailable — will retry when connection returns';
    });
  }
 }
  trigger.onclick=function(ev){ev.preventDefault();ev.stopPropagation();document.querySelectorAll('.cc627-select.open').forEach(function(other){if(other===wrap)return;other.classList.remove('open');var om=other.querySelector('.cc627-select-menu');if(om)om.hidden=true;});var opening=!wrap.classList.contains('open');if(opening){rebuild();wrap.classList.add('open');menu.hidden=false;}else{wrap.classList.remove('open');menu.hidden=true;}};
  trigger.onkeydown=function(ev){if(ev.key==='ArrowDown'||ev.key==='Enter'||ev.key===' '){ev.preventDefault();if(!wrap.classList.contains('open'))trigger.click();setTimeout(function(){menu.querySelector('.is-selected,.cc627-select-option')?.focus();},0);}else if(ev.key==='Escape'){wrap.classList.remove('open');menu.hidden=true;}};
  sel.addEventListener('change',function(){syncLabel();});syncLabel();
 });
}

function enhanceLegacyTaskForm(){if(location.pathname!=='/tasks')return;var taskHeader=document.querySelector('.table-panel .table-toolbar .add-profile-btn');if(taskHeader&&taskHeader.textContent.trim()==='Task Saved'&&!document.querySelector('.task-premium-form'))taskHeader.textContent='＋ Create Task';var form=document.querySelector('.task-premium-form');if(!form)return;enhanceTaskDropdowns627(form);if(!form.dataset.cc631EmployeeBoot){form.dataset.cc631EmployeeBoot='1';cc631FetchEmployees(!cc631CachedEmployees().length);}if(form.dataset.cc622Clean)return;form.dataset.cc622Clean='1';var button=make('button','cc622-btn','More options · Repeat / Second assignee / Status');button.type='button';button.style.margin='6px 0';button.onclick=function(){var advanced=form.classList.toggle('cc622-advanced');button.textContent=advanced?'Fewer options':'More options · Repeat / Second assignee / Status';};var grid=form.querySelector('.task-modal-grid');if(grid)form.insertBefore(button,grid);}
function mountAdmin(){
 if(aPanel&&aPanel.isConnected)return;
 var toolbar=document.querySelector('.admin-import-panel,.panel .panel-title');var root=document.querySelector('.main-wrap');if(!root)return;
 var panelTarget=document.querySelector('.admin-import-panel')?.parentNode||root.querySelector('.top-gap')||root;
 aPanel=make('section');aPanel.id='cc622-aria-panel';aPanel.innerHTML='<div class="cc622-head"><div><div class="cc622-title">◈ ARIA reporting schedule</div><p class="cc622-sub">India time (IST). ARIA reports each 30 minutes within these hours, including zero-work employees. Other night-time auto refresh stays OFF.</p></div><span class="cc622-badge">Manager controls</span></div><div class="cc622-form"><label>Start time · IST<input type="time" id="cc622-aria-start" step="1800" value="09:00"></label><label>End time · IST<input type="time" id="cc622-aria-end" step="1800" value="21:00"></label><div class="cc622-actions cc622-wide"><button type="button" id="cc622-aria-save" class="cc622-btn primary">Save ARIA timing</button><button type="button" id="cc622-aria-load" class="cc622-btn">↻ Load saved timing</button></div></div><div class="cc622-status" id="cc622-aria-status" role="status">Default: 09:00–21:00 IST; last report is published around the end time.</div>';
 panelTarget.parentNode.insertBefore(aPanel,panelTarget);
 var last=readCached('cc622_aria_times');if(last&&last.start&&last.end){aPanel.querySelector('#cc622-aria-start').value=last.start;aPanel.querySelector('#cc622-aria-end').value=last.end;}
 function applyTime(data){var settings=data?.lock_settings;if(!settings)return;var st=settings.aria_report_start_time,en=settings.aria_report_end_time;if(!st||!en)return;aPanel.querySelector('#cc622-aria-start').value=st;aPanel.querySelector('#cc622-aria-end').value=en;ariaTimes={start:st,end:en};writeCached('cc622_aria_times',ariaTimes);}
 if(ariaTimes)applyTime({lock_settings:{aria_report_start_time:ariaTimes.start,aria_report_end_time:ariaTimes.end}});
 window.addEventListener('cc622:admin-settings',function(e){if(aPanel?.isConnected)applyTime(e.detail||{});});
 aPanel.querySelector('#cc622-aria-save').onclick=async function(event){var btn=event.currentTarget,st=aPanel.querySelector('#cc622-aria-start').value,en=aPanel.querySelector('#cc622-aria-end').value,status=aPanel.querySelector('#cc622-aria-status');var v=function(s){if(!/^\d\d:(00|30)$/.test(s))return NaN;var t=s.split(':').map(Number);return t[0]*60+t[1];};if(!Number.isFinite(v(st))||!Number.isFinite(v(en))||v(st)>=v(en)||v(en)-v(st)<30){status.textContent='Choose valid half-hour steps with end at least 30 minutes after start.';return;}btn.disabled=true;status.textContent='Saving ARIA schedule…';try{var d=await apiJson('/api/admin/lock-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({aria_report_start_time:st,aria_report_end_time:en})});applyTime(d);status.textContent='Saved. ARIA now reports from '+st+' to '+en+' IST; other overnight auto-updates remain disabled.';}catch(err){status.textContent=err.message;}finally{btn.disabled=false;}};
 aPanel.querySelector('#cc622-aria-load').onclick=async function(event){var btn=event.currentTarget;btn.disabled=true;try{var d=await apiJson('/api/admin/aria-schedule');applyTime(d);aPanel.querySelector('#cc622-aria-status').textContent='Current ARIA time loaded manually (no database read).';}catch(err){aPanel.querySelector('#cc622-aria-status').textContent=err.message;}finally{btn.disabled=false;}};
}
// Observe only DOM composition; NEVER fetch on a timer or MutationObserver.
// Capture existing Admin response without an extra Supabase/Render request.
var priorFetch=window.fetch.bind(window);
window.fetch=function(url,options){var pathname='';try{pathname=new URL(url?.url||url,location.href).pathname;}catch(_){}return priorFetch(url,options).then(function(res){if(pathname==='/api/admin'&&res.ok){res.clone().json().then(function(d){if(d?.lock_settings){ariaTimes={start:d.lock_settings.aria_report_start_time||'09:00',end:d.lock_settings.aria_report_end_time||'21:00'};window.dispatchEvent(new CustomEvent('cc622:admin-settings',{detail:d}));}}).catch(function(){});}return res;});};
function tick(){uiScheduled=false;if(window.__CC602_NETWORK_PAUSED__)return;var page=location.pathname;
 if(page==='/tasks'){mountTasks();enhanceLegacyTaskForm();}
 else if(page==='/admin'){mountAdmin();document.body.classList.remove('cc622-task-clean','cc622-show-filters');}
 else{document.body.classList.remove('cc622-task-clean','cc622-show-filters');}
}
function schedule(){if(uiScheduled)return;var page=location.pathname;if(page!=='/tasks'&&page!=='/admin')return;
 if(page==='/tasks'&&tPanel?.isConnected&&!document.querySelector('.task-premium-form')){if(!document.querySelector('.task-summary-grid'))return;}
 uiScheduled=true;(window.requestAnimationFrame||setTimeout)(tick,0);
}
var observer=new MutationObserver(schedule);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){observer.observe(document.querySelector('#root')||document.body,{childList:true,subtree:true});schedule();},{once:true});else{observer.observe(document.querySelector('#root')||document.body,{childList:true,subtree:true});schedule();}
window.addEventListener('popstate',schedule);
window.addEventListener('career-crox-idle-lock-begin',function(){observer.disconnect();});
})();
