// CC26_448 production bridge: tiny call revision watcher + live tracking reports + readability/chat polish.
// /api/dialer/call-change is process-memory only; report data is fetched only on a real revision change or user refresh.
(function(){
  'use strict';
  if (window.__CC448_BRIDGE__) return;
  window.__CC448_BRIDGE__ = true;

  var lastRevision = '';
  var busy = false;
  var timer = null;
  var reportState = { mounted:false, loading:false, from:'', to:'', recruiter:'all', data:null };

  function route(){ return String(location.pathname || '').replace(/\/+$/,'') || '/'; }
  function visible(){ return !document.hidden; }
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);}); }
  function istDateKey(date){
    var d=date||new Date(), parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
    function p(t){var x=parts.find(function(z){return z.type===t;});return x?x.value:'';}
    return p('year')+'-'+p('month')+'-'+p('day');
  }
  function rangePreset(preset){
    var today=istDateKey();
    if(preset==='month') return {from:today.slice(0,8)+'01',to:today};
    if(preset==='7d'){
      var end=new Date(today+'T12:00:00+05:30');
      return {from:istDateKey(new Date(end.getTime()-6*86400000)),to:today};
    }
    return {from:today,to:today};
  }
  function toIso(key,end){ if(!key)return ''; return new Date(key+'T'+(end?'23:59:59.999':'00:00:00.000')+'+05:30').toISOString(); }
  function fmtSec(v){ var s=Math.max(0,Number(v||0)),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),q=Math.floor(s%60); return h?h+'h '+m+'m':m?m+'m '+q+'s':q+'s'; }
  function fmtMin(v){ var n=Math.max(0,Number(v||0)),h=Math.floor(n/60),m=Math.round(n%60); return h?h+'h '+m+'m':m+'m'; }
  function fmtIst(v){ if(!v)return '-'; var d=new Date(v); if(isNaN(d.getTime()))return String(v); return new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'2-digit',hour:'numeric',minute:'2-digit',hour12:true}).format(d); }
  function clickBySelector(selector){ var el=document.querySelector(selector); if(el&&!el.disabled){try{el.click();return true;}catch(e){}} return false; }

  function authFetch(url,options){
    var opts=options||{}; opts.credentials='include'; opts.cache='no-store';
    opts.headers=Object.assign({'Accept':'application/json','X-Career-Crox-Background':'1'},opts.headers||{});
    return fetch(url,opts).then(async function(r){
      var text=await r.text(); var data={}; try{data=text?JSON.parse(text):{};}catch(e){data={message:text||('HTTP '+r.status)};}
      if(!r.ok) throw new Error(data.message||data.error||('HTTP '+r.status)); return data;
    });
  }

  function metric(label,value,sub,key,warn){
    return '<button type="button" class="cc448-metric'+(warn?' warn':'')+'"'+(key?' data-metric="'+esc(key)+'"':' disabled')+'><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong>'+(sub?'<small>'+esc(sub)+'</small>':'')+'</button>';
  }
  function renderTrackingReport(data){
    var root=document.getElementById('cc448-tracking-reports'); if(!root)return;
    var s=(data&&data.summary)||{}, calls=s.calls||{}, perf=s.performance||{}, work=s.work||{}, pending=s.pending||{};
    var recruiters=(data&&data.recruiters)||[], opts=(data&&data.recruiter_options)||[];
    var sel=root.querySelector('#cc448-recruiter');
    if(sel){
      var current=reportState.recruiter||'all';
      sel.innerHTML='<option value="all">All Recruiters</option>'+opts.map(function(x){var val=x.recruiter_code||'';return '<option value="'+esc(val)+'">'+esc((x.full_name||x.recruiter_name||val)+(val?' · '+val:''))+'</option>';}).join('');
      sel.value=current;
    }
    var cards=root.querySelector('#cc448-report-cards');
    if(cards) cards.innerHTML=''
      +'<section class="cc448-card"><div class="cc448-cardhead"><strong>Call Report</strong><span>CRM profiles only</span></div><div class="cc448-metrics">'
      +metric('Total Calls',calls.total||0,'','call_total')+metric('Outgoing',calls.outgoing||0,fmtSec(calls.outgoing_talk_seconds),'call_outgoing')+metric('Incoming',calls.incoming||0,fmtSec(calls.incoming_talk_seconds),'call_incoming')
      +metric('Unique Candidates',calls.unique||0,'','call_unique')+metric('First-Time Calls',calls.first_time||0,'','call_first_time')+metric('Total Talk Time',fmtSec(calls.talk_seconds),'Incoming + outgoing','')+'</div></section>'
      +'<section class="cc448-card blue"><div class="cc448-cardhead"><strong>Performance</strong><span>Period / All time</span></div><div class="cc448-metrics">'
      +metric('Submissions',perf.submissions||0,'All '+(perf.submissions_all_time||0),'performance_submissions')+metric('Interviews',perf.interviews||0,'All '+(perf.interviews_all_time||0),'performance_interviews')+metric('Selections',perf.selections||0,'All '+(perf.selections_all_time||0),'performance_selections')
      +metric('Joinings',perf.joinings||0,'All '+(perf.joinings_all_time||0),'performance_joinings')+metric('Incomplete Subs',perf.incomplete_submissions||0,'','pending_incomplete_submissions',true)+metric('Overdue Interviews',perf.overdue_interviews||0,'','pending_overdue_interviews',true)+'</div></section>'
      +'<section class="cc448-card green"><div class="cc448-cardhead"><strong>Work & Break</strong><span>Active work only</span></div><div class="cc448-metrics">'
      +metric('Active Work',fmtMin(work.active_minutes),'','work_sessions')+metric('Break Time',fmtMin(work.break_minutes),'','work_breaks')+metric('Idle Time',fmtMin(work.idle_minutes),'','work_sessions')+metric('Work Remaining',fmtMin(work.remaining_minutes),'','work_sessions')+metric('CRM Locks',work.lock_count||0,'','work_locks',Number(work.lock_count||0)>0)+metric('Unlock Requests',work.unlock_requests||0,'','work_locks')+'</div></section>'
      +'<section class="cc448-card red"><div class="cc448-cardhead"><strong>Pending Queue</strong><span>Needs action</span></div><div class="cc448-metrics">'
      +metric('Incomplete Subs',pending.incomplete_submissions||0,'','pending_incomplete_submissions',true)+metric('Overdue Interviews',pending.overdue_interviews||0,'','pending_overdue_interviews',true)+metric('Pending Interviews',pending.pending_interviews||0,'','pending_interviews')+metric('Interview Not Called',pending.interview_not_called||0,'','pending_interview_not_called',true)+metric('Pending Follow-Ups',pending.pending_followups||0,'','pending_followups',true)+'</div></section>';
    var tbody=root.querySelector('#cc448-recruiter-body');
    if(tbody){
      tbody.innerHTML=recruiters.length?recruiters.map(function(r){return '<tr data-recruiter="'+esc(r.recruiter_code||'')+'"><td><strong>'+esc(r.recruiter_name||r.recruiter_code||'-')+'</strong><br><small>'+esc(r.recruiter_code||'')+'</small></td><td>'+esc(r.calls||0)+'</td><td>'+esc(fmtSec(r.talk_seconds))+'</td><td>'+esc(r.submissions||0)+'</td><td>'+esc(r.interviews||0)+'</td><td>'+esc(r.selections||0)+'</td><td>'+esc(r.joinings||0)+'</td><td>'+esc(fmtMin(r.active_minutes))+'</td><td>'+esc(fmtMin(r.break_minutes))+'</td><td>'+esc(fmtMin(r.idle_minutes))+'</td><td>'+esc(r.lock_count||0)+'</td><td>'+esc(fmtIst(r.login_at))+'</td><td>'+esc(fmtIst(r.logout_at))+'</td></tr>';}).join(''):'<tr><td colspan="13" class="cc448-empty">No recruiter activity found for this range.</td></tr>';
    }
    var status=root.querySelector('#cc448-report-status'); if(status){status.className='cc448-status';status.textContent='Live calculation source • CRM candidate calls only • Last refresh: '+fmtIst((data&&data.generated_at)||new Date().toISOString());}
    reportState.data=data;
  }
  async function loadTrackingReport(silent){
    if(route()!=='/reports'||reportState.loading)return false;
    var root=document.getElementById('cc448-tracking-reports'); if(!root)return false;
    reportState.loading=true;
    var btn=root.querySelector('#cc448-refresh'); if(btn&&!silent){btn.disabled=true;btn.textContent='Refreshing…';}
    var status=root.querySelector('#cc448-report-status'); if(status&&!silent){status.className='cc448-status';status.textContent='Loading central tracking report…';}
    try{
      var q=new URLSearchParams({from:toIso(reportState.from,false),to:toIso(reportState.to,true),recruiter_code:reportState.recruiter||'all',_ts:String(Date.now())});
      var data=await authFetch('/api/reports/tracking-hub?'+q.toString()); renderTrackingReport(data); return true;
    }catch(e){ if(status){status.className='cc448-status error';status.textContent=e.message||'Tracking report could not load.';} return false; }
    finally{reportState.loading=false;if(btn){btn.disabled=false;btn.textContent='Refresh Report';}}
  }
  async function openMetric(metricKey){
    if(!metricKey)return;
    var root=document.getElementById('cc448-tracking-reports'); if(!root)return;
    var modal=root.querySelector('#cc448-modal'); if(!modal)return;
    modal.style.display='grid'; modal.innerHTML='<div class="cc448-modalbox"><div class="cc448-modalhead"><strong>Loading details…</strong><button type="button" data-close="1">×</button></div><div class="cc448-modalbody cc448-empty">Please wait…</div></div>';
    try{
      var q=new URLSearchParams({from:toIso(reportState.from,false),to:toIso(reportState.to,true),recruiter_code:reportState.recruiter||'all',metric:metricKey,_ts:String(Date.now())});
      var d=await authFetch('/api/reports/tracking-details?'+q.toString()); var items=d.items||[]; var cols=items.length?Object.keys(items[0]):[];
      var body=items.length?'<div class="cc448-tablewrap"><table class="cc448-table"><thead><tr>'+cols.map(function(c){return '<th>'+esc(c.replace(/_/g,' '))+'</th>';}).join('')+'</tr></thead><tbody>'+items.map(function(it){return '<tr>'+cols.map(function(c){return '<td>'+esc(it[c]==null?'-':it[c])+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table></div>':'<div class="cc448-empty">No matching records.</div>';
      modal.innerHTML='<div class="cc448-modalbox"><div class="cc448-modalhead"><strong>'+esc(metricKey.replace(/_/g,' '))+'</strong><button type="button" data-close="1">×</button></div><div class="cc448-modalbody">'+body+'</div></div>';
    }catch(e){modal.innerHTML='<div class="cc448-modalbox"><div class="cc448-modalhead"><strong>Details</strong><button type="button" data-close="1">×</button></div><div class="cc448-modalbody cc448-empty">'+esc(e.message||'Details could not load.')+'</div></div>';}
  }
  function mountTrackingReports(){
    if(route()!=='/reports')return;
    var old=document.querySelector('.reports-shell');
    if(old) old.style.display='none';
    var existing=document.getElementById('cc448-tracking-reports'); if(existing){reportState.mounted=true;return;}
    var parent=old&&old.parentElement?old.parentElement:document.querySelector('.main-wrap')||document.querySelector('main'); if(!parent)return;
    var r=rangePreset('today'); reportState.from=r.from; reportState.to=r.to; reportState.recruiter='all';
    var root=document.createElement('div'); root.id='cc448-tracking-reports'; root.className='cc448-wrap';
    root.innerHTML='<section class="cc448-hero"><div><div class="cc448-title">Tracking Reports</div><div class="cc448-sub">Calls, performance, work/break and pending work — one place, one calculation source, IST timestamps.</div></div><div class="cc448-filter"><button type="button" data-preset="today" class="active">Today</button><button type="button" data-preset="7d">7 Days</button><button type="button" data-preset="month">This Month</button><label>From<input id="cc448-from" type="date" value="'+esc(r.from)+'"></label><label>To<input id="cc448-to" type="date" value="'+esc(r.to)+'"></label><label>Recruiter<select id="cc448-recruiter"><option value="all">All Recruiters</option></select></label><button type="button" id="cc448-refresh" class="primary">Refresh Report</button></div></section><div id="cc448-report-status" class="cc448-status">Loading central tracking summary…</div><div id="cc448-report-cards" class="cc448-grid"></div><section class="cc448-tablecard"><div class="cc448-tablehead"><strong>Recruiter Scoreboard</strong><span>Click recruiter to filter</span></div><div class="cc448-tablewrap"><table class="cc448-table"><thead><tr><th>Recruiter</th><th>Calls</th><th>Talk Time</th><th>Submissions</th><th>Interviews</th><th>Selections</th><th>Joinings</th><th>Active Work</th><th>Break</th><th>Idle</th><th>Locks</th><th>Login IST</th><th>Logout IST</th></tr></thead><tbody id="cc448-recruiter-body"><tr><td colspan="13" class="cc448-empty">Loading…</td></tr></tbody></table></div></section><div id="cc448-modal" class="cc448-modal" style="display:none"></div>';
    if(old) parent.insertBefore(root,old); else parent.appendChild(root);
    reportState.mounted=true;
    root.addEventListener('click',function(ev){
      var preset=ev.target.closest('[data-preset]'); if(preset){var key=preset.getAttribute('data-preset'),rg=rangePreset(key);reportState.from=rg.from;reportState.to=rg.to;root.querySelector('#cc448-from').value=rg.from;root.querySelector('#cc448-to').value=rg.to;root.querySelectorAll('[data-preset]').forEach(function(b){b.classList.toggle('active',b===preset);});loadTrackingReport(false);return;}
      var met=ev.target.closest('[data-metric]'); if(met){openMetric(met.getAttribute('data-metric'));return;}
      var rr=ev.target.closest('tr[data-recruiter]'); if(rr){var rc=rr.getAttribute('data-recruiter')||'all';reportState.recruiter=rc;var ss=root.querySelector('#cc448-recruiter');if(ss)ss.value=rc;loadTrackingReport(false);return;}
      if(ev.target.closest('[data-close]')){var modal=root.querySelector('#cc448-modal');if(modal)modal.style.display='none';}
    });
    root.querySelector('#cc448-refresh').addEventListener('click',function(){loadTrackingReport(false);});
    root.querySelector('#cc448-from').addEventListener('change',function(e){reportState.from=e.target.value;root.querySelectorAll('[data-preset]').forEach(function(b){b.classList.remove('active');});});
    root.querySelector('#cc448-to').addEventListener('change',function(e){reportState.to=e.target.value;root.querySelectorAll('[data-preset]').forEach(function(b){b.classList.remove('active');});});
    root.querySelector('#cc448-recruiter').addEventListener('change',function(e){reportState.recruiter=e.target.value||'all';loadTrackingReport(false);});
    loadTrackingReport(false);
  }

  function refreshCurrentCallView(){
    var p=route();
    if(p==='/live-dialing') return clickBySelector('.assistant-update-btn');
    if(p==='/reports'){ mountTrackingReports(); loadTrackingReport(true); return true; }
    return false;
  }
  async function tick(){
    if(busy||!visible())return;
    var p=route(); if(p!=='/live-dialing'&&p!=='/reports')return;
    if(p==='/reports') mountTrackingReports();
    busy=true;
    try{
      var d=await authFetch('/api/dialer/call-change?_='+Date.now()); var rev=String((d&&d.revision)||''); if(!rev)return;
      if(!lastRevision){lastRevision=rev;return;}
      if(rev!==lastRevision){ if(refreshCurrentCallView()) lastRevision=rev; }
    }catch(e){}finally{busy=false;}
  }
  function start(){ if(timer)clearInterval(timer);timer=null; /* Manual report/phone refresh: no repeating Render checks. */ }

  var style=document.createElement('style'); style.id='cc448-production-polish';
  style.textContent=[
    'body:not(.login-body) .main-wrap{font-size:15px!important}',
    'body:not(.login-body) .main-wrap button,body:not(.login-body) .main-wrap input,body:not(.login-body) .main-wrap select,body:not(.login-body) .main-wrap textarea{font-size:13.5px!important}',
    'body:not(.login-body) .main-wrap .crm-table tbody td,body:not(.login-body) .main-wrap .reports-table td{font-size:13.5px!important}',
    'body:not(.login-body) .main-wrap .helper-text,body:not(.login-body) .main-wrap .subtle,body:not(.login-body) .main-wrap small{font-size:11px!important}',
    'body:not(.login-body) .main-wrap .panel-title,body:not(.login-body) .main-wrap .table-title{font-size:16px!important}',
    'body:not(.login-body) .teamsShell .emojiBtn{font-size:18px!important;min-width:36px!important;min-height:34px!important}',
    'body:not(.login-body) .teamsShell .composeBox textarea{font-size:14px!important;font-weight:750!important}',
    'body:not(.login-body) .teamsShell .chatBubble:hover{transform:translateY(-1px)!important;box-shadow:0 10px 23px rgba(41,77,122,.09)!important}',
    'body:not(.login-body) .teamsShell .callBtn{border-radius:999px!important;font-size:11.5px!important}',
    '.cc448-wrap{--ink:#173a67;--muted:#6a7f99;--line:#d9e7f5;display:grid;gap:16px;color:var(--ink)}',
    '.cc448-hero{border:1px solid var(--line);border-radius:24px;padding:20px;background:linear-gradient(135deg,#fff,#f5faff 58%,#fff7ed);box-shadow:0 16px 38px rgba(31,73,125,.09)}',
    '.cc448-title{font-size:26px;font-weight:1000;letter-spacing:-.035em;color:#12345e}.cc448-sub{margin-top:5px;font-size:13px;font-weight:750;color:var(--muted)}',
    '.cc448-filter{margin-top:16px;display:flex;gap:9px;align-items:end;flex-wrap:wrap}.cc448-filter label{display:grid;gap:5px;font-size:11px;font-weight:900;color:#5f7691}.cc448-filter input,.cc448-filter select,.cc448-filter button{height:40px;border:1px solid #cfe0f2;border-radius:13px;background:#fff;padding:0 12px;color:#173a67;font-weight:900}.cc448-filter button{cursor:pointer}.cc448-filter button.active{background:#fff0df;border-color:#ffc785;color:#c76011}.cc448-filter .primary{border:0;background:linear-gradient(135deg,#ff7a18,#ffad42);color:#fff}',
    '.cc448-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.cc448-card{border:1px solid var(--line);border-radius:22px;background:#fff;padding:16px;box-shadow:0 12px 28px rgba(38,78,122,.07);border-top:3px solid #ff8d2f}.cc448-card.blue{border-top-color:#2f80ed}.cc448-card.green{border-top-color:#21a179}.cc448-card.red{border-top-color:#f25f5c}.cc448-cardhead{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.cc448-cardhead strong{font-size:17px}.cc448-cardhead span{padding:6px 9px;border-radius:999px;background:#f4f9ff;color:#55708f;font-size:10px;font-weight:1000}',
    '.cc448-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.cc448-metric{min-height:92px;text-align:left;border:1px solid #dce9f6;border-radius:16px;background:linear-gradient(145deg,#fff,#f8fbff);padding:11px;cursor:pointer;color:#173a67}.cc448-metric:disabled{cursor:default}.cc448-metric span{display:block;font-size:10.5px;font-weight:900;color:#71859c;text-transform:uppercase}.cc448-metric strong{display:block;margin-top:6px;font-size:22px;font-weight:1000}.cc448-metric small{display:block;margin-top:4px;font-size:10.5px;font-weight:800;color:#7890a8}.cc448-metric.warn{background:#fff8f1;border-color:#ffd9b6}',
    '.cc448-tablecard{border:1px solid var(--line);border-radius:22px;background:#fff;overflow:hidden;box-shadow:0 12px 28px rgba(38,78,122,.06)}.cc448-tablehead{padding:15px 16px;border-bottom:1px solid #e4eef8;display:flex;justify-content:space-between}.cc448-tablewrap{overflow:auto;max-height:440px}.cc448-table{width:100%;border-collapse:collapse;min-width:980px}.cc448-table th{position:sticky;top:0;background:#f5f9ff;color:#5b728e;font-size:10.5px;padding:10px 12px;text-align:left}.cc448-table td{padding:11px 12px;border-bottom:1px solid #edf3f9;font-size:12px;font-weight:750}.cc448-table tbody tr[data-recruiter]{cursor:pointer}.cc448-table tbody tr[data-recruiter]:hover td{background:#fbfdff}',
    '.cc448-status{padding:10px 12px;border-radius:14px;background:#f7fbff;border:1px solid #d7e6f7;font-size:12px;font-weight:800;color:#617995}.cc448-status.error{background:#fff3f0;border-color:#ffc8bf;color:#aa3a2d}.cc448-empty{padding:28px;text-align:center;color:#70859b;font-weight:850}',
    '.cc448-modal{position:fixed;inset:0;background:rgba(16,42,73,.28);backdrop-filter:blur(4px);z-index:100000;place-items:center;padding:18px}.cc448-modalbox{width:min(1180px,96vw);max-height:88vh;display:flex;flex-direction:column;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 30px 80px rgba(22,54,92,.25)}.cc448-modalhead{display:flex;justify-content:space-between;align-items:center;padding:15px 18px;background:linear-gradient(135deg,#f7fbff,#fff8ef)}.cc448-modalhead button{width:34px;height:34px;border-radius:11px;border:1px solid #d7e6f7;background:#fff;font-size:20px}.cc448-modalbody{overflow:auto;min-height:180px}',
    '@media(max-width:1150px){.cc448-grid{grid-template-columns:1fr}.cc448-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:680px){.cc448-metrics{grid-template-columns:1fr 1fr}.cc448-title{font-size:22px}}'
  ].join('\n');
  document.head.appendChild(style);
  setTimeout(function(){try{if(document.body&&style.parentNode!==document.body)document.body.appendChild(style);}catch(e){}},1800);

  var chatMap={'People':'People','Channels':'Channels','All':'All','Team Channel':'Team Channel','Private Chat':'Direct Message','Today':'Today'};
  function casualizeChat(){ return; }

  function onRoute(){lastRevision='';if(route()==='/reports')setTimeout(mountTrackingReports,80);setTimeout(casualizeChat,80);}
  document.addEventListener('visibilitychange',function(){if(!document.hidden){tick();casualizeChat();}});
  window.addEventListener('popstate',onRoute);
  var oldPush=history.pushState,oldReplace=history.replaceState;
  history.pushState=function(){var r=oldPush.apply(this,arguments);onRoute();return r;};
  history.replaceState=function(){var r=oldReplace.apply(this,arguments);onRoute();return r;};
  start(); onRoute(); casualizeChat();
})();
