/* Career Crox SecureLink: single, clearly labelled CRM slice. No requests, timers, or data changes. */
(() => {
  'use strict';
  if (/^\/(?:securelink|login)(?:\/|$)/.test(location.pathname)) return;
  let link = null;
  let scheduled = false;
  function apply(){
    scheduled=false;
    const nav=document.querySelector('.sidebar-nav');
    if(!nav) return;
    const existing=nav.querySelector('a[href="/securelink"]');
    if(existing){
      link=existing;
      existing.dataset.careercroxSecurelink='1';
      existing.setAttribute('title','SecureLink — Remote Support');
      existing.setAttribute('aria-label','SecureLink — Remote Support');
      if(existing!==nav.lastElementChild)nav.append(existing);
      return;
    }
    const a=document.createElement('a');
    a.href='/securelink';
    a.className='nav-item bounceable cc-securelink-slice';
    a.dataset.careercroxSecurelink='1';
    a.title='SecureLink — Remote Support';
    a.setAttribute('aria-label','SecureLink — Remote Support');
    const serial=document.createElement('span');
    serial.className='nav-serial';
    serial.textContent=String(nav.querySelectorAll('.nav-item').length+1).padStart(2,'0');
    const label=document.createElement('span');label.textContent='🔐 SecureLink';
    a.append(serial,label);
    nav.append(a); // SecureLink stays as the last navigation item.
    link=a;
  }
  function schedule(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(apply);
  }
  function watch(){
    apply();
    const root=document.getElementById('root')||document.body;
    new MutationObserver(()=>{
      // No repeated DOM queries on the CRM's frequent cards/messages updates.
      if(link && link.isConnected)return;
      schedule();
    }).observe(root,{childList:true,subtree:true});
  }
  // Authenticated push: one lightweight connection while the CRM is open and active.
  // The server sends an event only when a colleague asks; no Supabase inbox polling.
  let stream=null,notice=null,lastActivity=Date.now(),closed=false;
  function dismiss(){notice?.remove();notice=null;}
  function pause(){closed=true;stream?.close();stream=null;dismiss();}
  function showRequest(event){
    if(closed || window.__CC602_NETWORK_PAUSED__ || Date.now()-lastActivity>=600000)return;
    dismiss();const person=String(event.requester||'Your teammate').slice(0,90);
    notice=document.createElement('section');notice.className='cc605-request';notice.setAttribute('role','alertdialog');
    const title=document.createElement('strong');title.textContent=event.kind==='code-request'?'Screen sharing request':'SecureLink access request';
    const content=document.createElement('p');content.textContent=person+' is requesting screen-sharing access. Your screen stays private until you choose a screen and approve.';
    const actions=document.createElement('div');const open=document.createElement('button');open.type='button';open.textContent='Open request & approve';
    open.onclick=()=>{pause();location.assign('/securelink?incoming=1');};
    const later=document.createElement('button');later.type='button';later.textContent='Not now';later.className='cc605-later';later.onclick=dismiss;
    actions.append(open,later);notice.append(title,content,actions);document.body.append(notice);
  }
  function start(){
    if(window.__CC621_NIGHT_QUIET__?.()||closed||stream||document.hidden||window.__CC602_NETWORK_PAUSED__||Date.now()-lastActivity>=600000||!window.EventSource)return;
    stream=new EventSource('/api/securelink/events');
    stream.onmessage=e=>{try{const d=JSON.parse(e.data);if(d.kind==='invite'||d.kind==='code-request')showRequest(d);}catch(_){}};
    stream.onerror=()=>{stream?.close();stream=null;}; // No idle/reconnect storm; next user action can reopen.
    // EventSource has native reconnect only while the employee is active.
  }
  ['pointerdown','keydown'].forEach(name=>document.addEventListener(name,()=>{lastActivity=Date.now();if(!closed&&!stream)start();},{passive:true}));
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stream?.close();stream=null;}else if(!closed)start();});
  window.addEventListener('cc621:night-quiet',()=>{stream?.close();stream=null;dismiss();});
  window.addEventListener('pagehide',pause,{once:true});
  window.addEventListener('cc:logout',pause);window.addEventListener('cc:network-paused',pause);
  // Local idle timer: no network request, and no live SecureLink listener after 10min.
  const idle=setInterval(()=>{if(closed){clearInterval(idle);return;}if(Date.now()-lastActivity>=600000 || window.__CC602_NETWORK_PAUSED__)pause();},15000);
  start();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',watch,{once:true});
  else watch();
})();

/* CC26_609: consent-based unlock notice. Event-only, no table polling or automatic DB refresh. */
(() => {
  'use strict';
  if (/^\/(?:login|securelink)(?:\/|$)/.test(location.pathname)) return;
  if (window.__CC609_APPROVAL_PUSH__) return;
  window.__CC609_APPROVAL_PUSH__ = true;
  const IDLE_MS = 10 * 60 * 1000;
  const ACTIVITY_KEY = 'careerCroxLastActivityAt';
  const userKey = 'careerCroxCachedUser';
  let source = null, popup = null, request = null, closed = false, connecting = false;
  let lastInteraction = Date.now(), lastPresented = '', lastApprovalCheck = '';
  const now = () => Date.now();
  function signedIn() { try { return Boolean(localStorage.getItem(userKey)) && !window.__CC602_NETWORK_PAUSED__; } catch { return false; } }
  function idle() {
    try { const last = Number(localStorage.getItem(ACTIVITY_KEY)) || lastInteraction;
      return now() - Math.min(now(), Math.max(lastInteraction, last)) >= IDLE_MS;
    } catch { return now() - lastInteraction >= IDLE_MS; }
  }
  function element(tag, className, text) { const item = document.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = String(text); return item; }
  function removePopup() { popup?.remove(); popup = null; }
  function stop() { closed = true; connecting = false; source?.close(); source = null; removePopup(); }
  function inputActivity() { lastInteraction = now(); if (!closed && !source && !document.hidden && signedIn() && !idle()) start(); }
  const css = `
  .cc609-request{position:fixed!important;right:18px!important;bottom:20px!important;z-index:2147482500!important;width:min(455px,calc(100vw - 36px))!important;max-height:min(720px,calc(100dvh - 40px));overflow:auto;background:linear-gradient(138deg,#fffefa 0%,#fff0f7 49%,#e9f5ff 100%)!important;border:1px solid #f3c6e6!important;border-radius:26px!important;padding:22px!important;color:#283149!important;box-shadow:0 25px 78px #70437b3b,0 5px 18px #57538a24,inset 0 2px #ffffff!important;font-family:inherit!important;animation:cc609Arrival .3s ease-out both!important}
  @keyframes cc609Arrival{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
  .cc609-request *{box-sizing:border-box}.cc609-eyebrow{font-size:12px!important;font-weight:900!important;letter-spacing:.08em;color:#9952aa!important}.cc609-title{font-size:24px!important;font-weight:950!important;letter-spacing:-.025em;color:#202b44!important;margin:5px 0 6px!important;line-height:1.2!important}.cc609-subtitle{color:#43526e!important;font-size:16px!important;line-height:1.45!important;font-weight:650!important;margin:0 0 10px!important}
  .cc609-notes{padding:13px 15px!important;background:#fff!important;border:1px solid #e5cbef!important;border-radius:16px!important;box-shadow:inset 0 1px #fff,0 3px 12px #9b7fa616!important;max-height:170px;overflow-wrap:anywhere;overflow:auto;white-space:pre-wrap;color:#202e49!important;font-size:17px!important;line-height:1.5!important;font-weight:650!important}
  .cc609-caption{font-size:13px!important;color:#6e557d!important;font-weight:800!important;margin:12px 0 5px!important}.cc609-row{display:flex!important;flex-wrap:wrap;gap:9px!important;margin-top:15px!important}.cc609-request button{cursor:pointer!important;border-radius:14px!important;border:1px solid #dfc5e6!important;padding:12px 17px!important;font-size:16px!important;font-weight:900!important;min-height:44px!important;box-shadow:inset 0 1px #ffffffae,0 6px 12px #58406d22!important;color:#27334f!important;background:linear-gradient(135deg,#fff,#f5f1ff)!important}.cc609-request button:disabled{opacity:.65;cursor:wait!important}
  .cc609-request .cc609-approve{color:#fff!important;background:linear-gradient(110deg,#008e77,#13b794)!important;border-color:#008a77!important}.cc609-request .cc609-reject{color:#fff!important;background:linear-gradient(110deg,#db3858,#ff6d80)!important;border-color:#cb3c5c!important}.cc609-request .cc609-open{color:#fff!important;background:linear-gradient(110deg,#5572df,#9365d7)!important;border-color:#6674d8!important}.cc609-request button:focus-visible{outline:3px solid #af5acc!important;outline-offset:2px!important}
  .cc609-request textarea{width:100%!important;min-height:75px!important;padding:12px!important;color:#25334e!important;background:white!important;border:1px solid #bd91c7!important;border-radius:13px!important;font-size:16px!important;resize:vertical!important}
  .cc609-error{margin-top:10px!important;font-size:14px!important;font-weight:800!important;color:#b52e4c!important}
  .cc604-approval-page-table .crm-table{font-size:16px!important;color:#23334e!important}.cc604-approval-page-table .crm-table th{font-size:15px!important;font-weight:900!important;color:#23334e!important}.cc604-approval-page-table .crm-table td{font-size:16px!important;line-height:1.45!important;color:#30425e!important}.cc604-approval-page-table .row-actions button{font-size:15px!important;font-weight:900!important;min-height:39px!important;border-radius:12px!important;border:1px solid #d1d9ee!important;box-shadow:inset 0 1px #ffffff99,0 4px 11px #60718b22!important;opacity:1!important}.cc604-approval-page-table .row-actions:not(.compact-pills)>button:nth-child(1){background:linear-gradient(120deg,#596bdc,#9b70ec)!important;color:#fff!important}.cc604-approval-page-table .row-actions:not(.compact-pills)>button:nth-child(2){background:linear-gradient(120deg,#008e76,#23c29e)!important;color:#fff!important}.cc604-approval-page-table .row-actions:not(.compact-pills)>button:nth-child(3){background:linear-gradient(120deg,#d93d5b,#fc7b87)!important;color:#fff!important}
  .cc604-approval-page-table .row-actions.compact-pills>button:nth-child(1){background:linear-gradient(110deg,#08775b,#31ba8d)!important;color:#fff!important}.cc604-approval-page-table .row-actions.compact-pills>button:nth-child(2){background:linear-gradient(110deg,#3f77e0,#74b9f4)!important;color:#fff!important}.cc604-approval-page-table .row-actions.compact-pills>button:nth-child(3){background:linear-gradient(110deg,#ec922e,#ffc45a)!important;color:#55330a!important}.cc604-approval-page-table .row-actions.compact-pills>button:nth-child(4){background:linear-gradient(110deg,#8052bd,#c48be0)!important;color:#fff!important}
  .cc604-approval-popup{background:linear-gradient(140deg,#fffefa,#fff0f7,#eaf5ff)!important;border:1px solid #efc4e5!important;border-radius:24px!important;box-shadow:0 20px 50px #7554a333!important}.cc604-approval-popup .panel-title{color:#26334a!important;font-size:21px!important}.cc604-approval-popup .helper-text{color:#34435c!important;font-size:15px!important}
  @media(prefers-reduced-motion:reduce){.cc609-request{animation:none!important}}
  `;
  const style = element('style'); style.id = 'cc609-approval-glossy'; style.textContent = css; document.head.append(style);
  function showRequest(item) {
    if (!item || !item.id || !signedIn() || idle()) return;
    const id = String(item.id), note = String(item.process || item.reason || 'No reason was provided.').slice(0, 650);
    if (request?.id === id && request.process === note && popup?.isConnected) return;
    request = { ...item, id, process: note }; lastPresented = id;
    if (/^\/approvals(?:\/|$)/.test(location.pathname)) window.dispatchEvent(new CustomEvent('cc609:approval-request', {detail:request}));
    removePopup(); popup = element('section', 'cc609-request'); popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', 'Employee access approval');
    popup.append(element('div', 'cc609-eyebrow', '✦ NEW ACCESS REQUEST'), element('h2', 'cc609-title', 'CRM unlock requested'), element('p', 'cc609-subtitle', `${item.recruiter_name || item.title || 'Employee'} needs your approval to resume CRM access.`), element('div', 'cc609-caption', 'EMPLOYEE NOTES / REASON'), element('div', 'cc609-notes', note));
    const status = element('div', 'cc609-error'); status.setAttribute('role', 'status');
    const row = element('div', 'cc609-row');
    const approve = element('button', 'cc609-approve', '✓ Approve');
    const reject = element('button', 'cc609-reject', '✕ Reject');
    const open = element('button', 'cc609-open', 'Open approvals');
    const dismiss = element('button', '', 'Later');
    const reasons = element('textarea'); reasons.setAttribute('aria-label', 'Reason for rejection'); reasons.placeholder = 'Enter rejection reason (required)'; reasons.hidden = true;
    function busy(value) { approve.disabled = reject.disabled = open.disabled = value; }
    async function decide(verb) {
      if (verb === 'reject' && !reasons.value.trim()) { reasons.hidden = false; reasons.focus(); return; }
      busy(true); status.textContent = '';
      try {
        const response = await fetch(`/api/approvals/${verb}`, {method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'unlock',id, ...(verb==='reject'?{reason:reasons.value.trim()}: {})})});
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.message || `Could not ${verb} request`);
        if (request?.id === id) request = null;
        removePopup();
      } catch (error) { status.textContent = String(error.message || 'Unable to save, please try again.'); busy(false); }
    }
    approve.onclick = () => decide('approve'); reject.onclick = () => decide('reject');
    open.onclick = () => location.assign('/approvals'); dismiss.onclick = removePopup;
    row.append(approve,reject,open,dismiss); popup.append(reasons,row,status); document.body.append(popup);
  }
  function showNoteOnly(item) {
    removePopup(); popup = element('section','cc609-request');
    popup.setAttribute('role','dialog');popup.setAttribute('aria-label','Access request notes');
    popup.append(element('div','cc609-eyebrow','EMPLOYEE REQUEST'),
      element('h2','cc609-title',item.recruiter_name || item.title || 'Employee notes'),
      element('div','cc609-caption','REASON / NOTES'),
      element('div','cc609-notes',String(item.process || item.reason || 'No notes entered.').slice(0,1000)));
    const close = element('button','','Close');close.onclick=removePopup;
    const row=element('div','cc609-row');row.append(close);popup.append(row);document.body.append(popup);
  }
  window.addEventListener('cc609:show-note', e => { if (signedIn() && e.detail?.type === 'unlock') showNoteOnly(e.detail); });
  document.addEventListener('click', e => {
    const button=e.target?.closest?.('.cc604-approval-page-table .row-actions:not(.compact-pills)>button:first-child');
    if (!button || !/^open$/i.test((button.textContent || '').trim())) return;
    const cells=button.closest('tr')?.querySelectorAll('td');
    if (cells?.length >= 4 && /^unlock$/i.test((cells[0].textContent || '').trim())) {
      showNoteOnly({type:'unlock',recruiter_name:cells[2].textContent,process:cells[3].textContent});
    }
  });
  function onResolved(data) {
    if (!data?.id) return;
    if (request?.id === String(data.id)) { request = null; removePopup(); }
    if (String(data.status || '').toLowerCase() !== 'approved') return;
    if (!signedIn() || idle()) return;
    const key = String(data.id) + ':' + String(data.status);
    if (lastApprovalCheck === key) return; lastApprovalCheck = key;
    // One small attendance read via existing React action, never repeated table polling.
    const gate = document.querySelector('.premium-crm-lock-request-modal');
    const check = [...(gate?.querySelectorAll('button') || [])].find(b => /check approval/i.test(b.textContent || ''));
    if (check) check.click();
    window.dispatchEvent(new CustomEvent('cc609:unlock-resolved', {detail:data}));
  }
  function start() {
    if (closed || connecting || source || document.hidden || !signedIn() || idle() || !window.EventSource) return;
    connecting = true;
    const next = new EventSource('/api/approvals/stream'); source = next; connecting = false;
    next.addEventListener('unlock', e => { try { showRequest(JSON.parse(e.data)); } catch {} });
    next.addEventListener('unlock-resolved', e => { try { onResolved(JSON.parse(e.data)); } catch {} });
    next.onerror = () => { if (source === next) { next.close(); source = null; } }; // No reconnect storm; a new real user action may reopen.
  }
  for (const event of ['pointerdown','keydown','wheel','touchstart']) document.addEventListener(event,inputActivity,{passive:true});
  document.addEventListener('visibilitychange', () => { if (document.hidden) { source?.close(); source=null; removePopup(); } else inputActivity(); });
  window.addEventListener('career-crox-idle-lock-begin', stop);
  window.addEventListener('career-crox-auth-expired', stop);
  window.addEventListener('cc:logout', stop); window.addEventListener('cc:network-paused', stop);
  // Approval/unlock push is the single night-time notification exception while a person is signed in.
  // This is one event stream; NO repeated Supabase table reads or per-user scheduled job.
  window.addEventListener('cc621:night-quiet',()=>{if (!signedIn() || idle()) stop();});
  window.addEventListener('pagehide', stop, {once:true});
  const idleTimer = setInterval(() => { if (closed) { clearInterval(idleTimer); return; } if (idle() || !signedIn()) stop(); }, 15000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true}); else start();
})();
