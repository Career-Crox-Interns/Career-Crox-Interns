// CC905: every CRM WhatsApp action requests the installed app, without a web tab.
(function () {
  'use strict';
  if (window.CareerCroxWhatsApp?.version === 'CC905') return;
  const owner = () => {
    try { const u=JSON.parse(localStorage.getItem('careerCroxCachedUser')||'{}');return String(u.user_id||u.username||''); }
    catch (_) { return ''; }
  };
  function phone(value) {
    const raw=String(value||'').trim();
    let digits=raw.replace(/[०-९٠-٩۰-۹]/g,c=>String(c.charCodeAt(0)-(c.charCodeAt(0)>=0x966?0x966:c.charCodeAt(0)>=0x6f0?0x6f0:0x660))).replace(/\D/g,'');
    if(raw.startsWith('00'))digits=digits.slice(2);
    else if(!raw.startsWith('+')&&digits.length===10)digits='91'+digits;
    else if(!raw.startsWith('+')&&digits.length===11&&digits.startsWith('0'))digits='91'+digits.slice(1);
    if(!/^[1-9]\d{6,14}$/.test(digits))throw Error('Enter a valid WhatsApp number with country code.');
    return digits;
  }
  function build(input, message) {
    const raw=String(input||'').trim();
    let number=raw,text=message;
    if(/^[a-z][a-z0-9+.-]*:/i.test(raw)){
      const u=new URL(raw);
      if(u.protocol==='whatsapp:'){
        if(u.hostname==='chat'){
          const code=u.searchParams.get('code')||'';
          if(!/^[A-Za-z0-9]+$/.test(code))throw Error('Invalid WhatsApp group link.');
          return 'whatsapp://chat?code='+encodeURIComponent(code);
        }
        if(u.hostname!=='send')throw Error('Unsupported WhatsApp app link.');
        number=u.searchParams.get('phone')||'';
      }else{
        if(u.protocol!=='https:'||!['wa.me','www.wa.me','api.whatsapp.com','web.whatsapp.com','chat.whatsapp.com'].includes(u.hostname))throw Error('Unsupported WhatsApp link.');
        if(u.hostname==='chat.whatsapp.com'){
          const code=u.pathname.replace(/^\/+|\/+$/g,'');
          if(!/^[A-Za-z0-9]+$/.test(code))throw Error('Invalid WhatsApp group link.');
          return 'whatsapp://chat?code='+encodeURIComponent(code);
        }
        number=u.hostname.endsWith('wa.me')?u.pathname.replace(/^\/+|\/+$/g,''):u.searchParams.get('phone')||'';
      }
      if(text===undefined)text=u.searchParams.get('text')||'';
    }
    const parameters=[];
    if(number)parameters.push('phone='+encodeURIComponent(phone(number)));
    if(text)parameters.push('text='+encodeURIComponent(String(text)));
    if(!parameters.length)throw Error('Enter a WhatsApp number or message first.');
    return 'whatsapp://send?'+parameters.join('&');
  }
  let notice=null;
  function dismiss(){if(notice){notice.remove();notice=null;}}
  function panel(message, action) {
    dismiss();
    const box=document.createElement('section');box.className='cc905-desktop-prompt';box.setAttribute('role','status');
    Object.assign(box.style,{position:'fixed',right:'18px',bottom:'18px',zIndex:'2147483000',width:'min(340px, calc(100vw - 36px))',padding:'14px',borderRadius:'14px',border:'1px solid #9bd6b8',background:'linear-gradient(135deg,#effcf4,#fff)',color:'#123b2a',boxShadow:'0 10px 32px #123b2a25',font:'13px/1.5 Segoe UI,Arial,sans-serif'});
    const body=document.createElement('div');body.textContent=message;box.append(body);
    const actions=document.createElement('div');Object.assign(actions.style,{display:'flex',gap:'8px',marginTop:'10px'});
    if(action){
      const launch=document.createElement('button');launch.type='button';launch.textContent='Open WhatsApp Desktop';
      Object.assign(launch.style,{border:'0',borderRadius:'8px',padding:'9px 12px',background:'#087b46',color:'#fff',font:'600 12px Segoe UI,Arial,sans-serif',cursor:'pointer'});
      launch.onclick=()=>{dismiss();action();};actions.append(launch);
    }
    const close=document.createElement('button');close.type='button';close.textContent='Dismiss';
    Object.assign(close.style,{border:'1px solid #cbded3',borderRadius:'8px',padding:'9px 11px',background:'#fff',color:'#24583c',cursor:'pointer'});
    close.onclick=dismiss;actions.append(close);box.append(actions);(document.body||document.documentElement).append(box);notice=box;
  }
  function open(input,message,options={}) {
    let url;
    try{url=build(input,message);}catch(error){panel(error.message);return {error:error.message,requested:false};}
    const initialOwner=owner();let launched=false;
    const launch=()=>{
      if(initialOwner!==owner()||window.__CC602_NETWORK_PAUSED__||options.guard?.()===false){panel('Session changed. Open the profile again before using WhatsApp.');return false;}
      if(launched)return false;
      // External protocol dispatch keeps the current CRM page; never window.open.
      window.location.assign(url);launched=true;
      try{options.onLaunch?.();}catch(_){}
      window.dispatchEvent(new CustomEvent('career-crox-whatsapp-requested',{detail:{channel:'desktop',source:options.source||'crm',requested:true}}));
      return true;
    };
    if(navigator.userActivation&&!navigator.userActivation.isActive){
      panel('WhatsApp is ready. Click below to open the installed app.',launch);
      return {url,window:null,requested:false,needsClick:true};
    }
    try{dismiss();return {url,window:null,requested:launch(),deliveryConfirmed:false};}
    catch(error){panel('Could not request WhatsApp Desktop. Check that the app is installed and try again.');return {url,window:null,requested:false,error:error.message};}
  }
  window.CareerCroxWhatsApp=Object.freeze({version:'CC905',build,open,notice:message=>panel(String(message))});
  // Old message/JD anchors get the same desktop route, including keyboard clicks.
  document.addEventListener('click',event=>{
    const anchor=event.target?.closest?.('a[href]');if(!anchor||event.defaultPrevented||event.button>0)return;
    const href=anchor.getAttribute('href')||'';
    if(!/^https:\/\/(?:wa\.me|www\.wa\.me|api\.whatsapp\.com|web\.whatsapp\.com|chat\.whatsapp\.com)(?:\/|$)/i.test(href))return;
    event.preventDefault();open(href,undefined,{source:'crm_whatsapp_link'});
  });
  window.addEventListener('career-crox-auth-changed',dismiss);
})();

(function () {
  'use strict';
  if (window.__cc861SharedFetch) return;
  window.__cc861SharedFetch=true;
  const native=window.fetch.bind(window),prefix='cc861-shared-read:',epochKey='cc861-shared-epoch';
  const read=key=>{try{return localStorage.getItem(key)||'';}catch(_){return '';}};
  const epoch=()=>read(epochKey)||'0';
  function scope() {
    try {
      const u=JSON.parse(read('careerCroxCachedUser')||'{}');
      if (!u.user_id) return '';
      return JSON.stringify([u.user_id,u.role,u.team_id,u.recruiter_code,read('careerCroxSessionLoginAt'),window.__CC875_DASHBOARD_KEY__?.()||'overview',window.__CC875_POPUP_SETTINGS__?.().managerTeamPopups!==false]);
    } catch (_) { return ''; }
  }
  function clear() {
    try {
      localStorage.setItem(epochKey,Date.now()+':'+Math.random());
      for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key);
    } catch (_) {}
  }
  // A remote submission must invalidate the same short cache as a local save.
  ['career-crox-access-changed','career-crox-team-changed','career-crox-auth-changed','cc875-dashboard-changed',
   'career-crox-workspace-change','career-crox-submission-review','career-crox-manager-reminder-dirty',
   'career-crox-data-written','career-crox-reminder-ready'].forEach(name=>window.addEventListener(name,clear));
  const watched=/^\/api\/(?:reports\/reminder-summary|submissions(?:\/review-summary)?|approvals\/(?:pending|summary|submission-review))$/;
  window.fetch=async function (input,init={}) {
    let url;
    try { url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href); }
    catch (_) { return native(input,init); }
    const method=String(init.method||input?.method||'GET').toUpperCase();
    if (url.origin!==location.origin||!url.pathname.startsWith('/api/')) return native(input,init);
    if (!['GET','HEAD','OPTIONS'].includes(method)) {
      const response=await native(input,init);if(response.ok)clear();return response;
    }
    const identity=scope();
    if(method!=='GET'||!identity||!watched.test(url.pathname))return native(input,init);
    const bypass=init.cache==='reload'||['fresh','_fresh','_refresh','cacheBust'].some(key=>{
      const value=url.searchParams.get(key);return value!==null&&value!==''&&value!=='0';
    });
    [...url.searchParams.keys()].filter(key=>/^(fresh|_fresh|_cc\d+|_refresh|_ts|ts|cacheBust)$/.test(key)).forEach(key=>url.searchParams.delete(key));
    url.searchParams.sort();
    const key=prefix+identity+':'+url.pathname+url.search;
    async function load() {
      if(!bypass)try {
        const hit=JSON.parse(read(key)||'null');
        if(hit&&hit.principal===identity&&hit.epoch===epoch()&&Date.now()-hit.at<2500)
          return new Response(hit.body,{status:200,headers:{'Content-Type':'application/json','X-CC861-Shared':'1'}});
      }catch(_){}
      let generation=epoch(),response=await native(input,init);
      // Repair a read that started before the committed write signal arrived.
      if(response.ok&&scope()===identity&&generation!==epoch()) {
        generation=epoch();response=await native(input,init);
      }
      if(response.ok&&scope()===identity&&generation===epoch()) {
        const body=await response.clone().text();
        if(body.length<160000&&generation===epoch())try {
          const keys=Object.keys(localStorage).filter(value=>value.startsWith(prefix));
          while(keys.length>=8)localStorage.removeItem(keys.shift());
          localStorage.setItem(key,JSON.stringify({body,at:Date.now(),principal:identity,epoch:generation}));
        }catch(_){}
      }
      return response;
    }
    return navigator.locks ? navigator.locks.request(key,{mode:'exclusive',signal:init.signal},load) : load();
  };
})();

/* CC900: short reminder rows, inline owner, presets last. */
(function () {
  'use strict';
  if (window.__cc900PopupLayout) return;
  window.__cc900PopupLayout = true;
  const hosts = '.cc730-direct-reminder-deck,.cc803-review-popup';
  const byKey = new Map();
  const observed = new WeakSet();
  const savedBorders = new WeakMap();
  const normalized = new Map();
  let scheduled = false;
  const text = value => String(value == null ? '' : value).trim();
  function actor() {
    try { return JSON.parse(localStorage.getItem('careerCroxCachedUser') || '{}'); }
    catch (_) { return {}; }
  }
  function principal() {
    const u = actor();
    return text(u.user_id) + '|' + text(window.__CC875_DASHBOARD_KEY__?.());
  }
  function style(node, values) {
    for (const [name, raw] of Object.entries(values)) {
      const key = name + '|' + raw;
      if (!normalized.has(key)) {
        const probe = document.createElement('div');
        probe.style.setProperty(name, raw);
        normalized.set(key, probe.style.getPropertyValue(name));
      }
      const value = normalized.get(key);
      if (node.style.getPropertyValue(name) !== value || node.style.getPropertyPriority(name) !== 'important') {
        node.style.setProperty(name, value, 'important');
      }
    }
  }
  function remember(data) {
    for (const row of Array.isArray(data?.actions) ? data.actions : []) {
      if (row?.key) byKey.set(text(row.key), row);
    }
    while (byKey.size > 1200) byKey.delete(byKey.keys().next().value);
    schedule();
  }
  // Observe existing requests only; no background contact lookups.
  const previousFetch = window.fetch;
  window.fetch = function (input, init) {
    let url;
    try { url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href); } catch (_) {}
    const method = text(init?.method || input?.method || 'GET').toUpperCase();
    const same = url?.origin === location.origin;
    const owner = principal();
    return previousFetch.call(this, input, init).then(response => {
      if (same && response.ok && owner === principal()) {
        const summary = method === 'GET' && url.pathname === '/api/reports/reminder-summary';
        const submitted = method === 'POST' && /\/api\/candidates\/(?:commit|[^/]+\/(?:submit|commit))$/.test(url.pathname);
        if (summary || submitted) try {
          response.clone().json().then(data => {
            if (owner !== principal()) return;
            if (summary) remember(data);
            if (submitted && !data.replayed && !data.already_submitted && (data.action === 'submit' || /\/submit$/.test(url.pathname))) confirmedSubmission(data.item, data.submission);
          }).catch(() => {});
        } catch (_) {}
      }
      return response;
    });
  };
  function confirmedSubmission(item, submission) {
    const role = text(actor().role || actor().designation).toLowerCase();
    if (!['tl','manager','admin'].includes(role) || !item?.candidate_id || !submission?.submission_id ||
        text(item.approval_status).toLowerCase() !== 'pending') return;
    window.dispatchEvent(new CustomEvent('career-crox-submission-review', { detail: {
      type:'candidate', id:submission.submission_id, candidate_id:item.candidate_id,
      title:item.full_name || item.candidate_name || 'Candidate',
      owner_name:item.owner_name || item.recruiter_name || '',
      owner_role:item.owner_role || item.recruiter_designation || '',
      recruiter_name:item.recruiter_name || '', recruiter_user_id:item.recruiter_user_id || '',
      phone:item.phone || '', process:item.process || '', profile_note:item.notes || '',
      requested_at:submission.approval_requested_at || submission.submitted_at || item.approval_requested_at || ''
    } }));
  }
  window.addEventListener('career-crox-workspace-change', event => {
    if (event.detail?.meta?.submitted) confirmedSubmission(event.detail.item, event.detail.meta.submission);
  });
  async function requestJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { credentials:'include', cache:'no-store', ...options, signal:controller.signal });
      let data = {}; try { data = await response.json(); } catch (_) {}
      if (!response.ok || data.ok === false) throw new Error(data.message || data.error || 'Could not complete this action.');
      return data;
    } finally { clearTimeout(timer); }
  }
  const callSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a15 15 0 0 1-7-7l2-2-2-5Z"/></svg>';
  const waSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.7a8.2 8.2 0 0 1-12.2 7.2L3 20l1.2-4.7A8.2 8.2 0 1 1 20 11.7Z"/><path d="m8 7 1.4-.2 1.1 2.5-1.1 1a8 8 0 0 0 3.3 3.2l1-1.1 2.5 1.1-.2 1.4c-.3 1.6-2.2 1.5-3.6.8-2.4-1.2-4.3-3.1-5.4-5.5C6.4 8.8 6.4 7.2 8 7Z"/></svg>';
  function actionStatus(card, message) {
    let node = card.querySelector('.cc901-contact-status');
    if (!node) { node=document.createElement('div');node.className='cc901-contact-status';node.setAttribute('role','status');node.setAttribute('aria-live','polite');card.appendChild(node); }
    node.textContent=message;
    clearTimeout(node.__removeTimer);
    node.__removeTimer=setTimeout(() => { if (node.isConnected) node.remove(); }, 7000);
  }
  function contactIcons(card, row, direct) {
    const cid = text(row?.candidate_id);
    let wrap = card.querySelector('.cc901-contact-actions');
    if (!cid) { if (wrap) wrap.remove(); return; }
    if (!wrap) {
      const head = card.querySelector(direct ? '.cc388-head-actions' : '.cc803-review-head');
      if (!head) return;
      wrap=document.createElement('span');wrap.className='cc901-contact-actions';
      for (const [kind,label,svg] of [['call','Call candidate',callSvg],['whatsapp','WhatsApp candidate',waSvg]]) {
        const button=document.createElement('button');button.type='button';button.className='cc901-contact '+kind;
        button.title=label;button.setAttribute('aria-label',label);button.innerHTML=svg;
        // Inline tokens keep contact icons readable above the older theme overrides.
        const tone=kind==='whatsapp'?'wa':'call';
        const paint={background:'var(--cc902-'+tone+'-bg, '+(tone==='wa'?'#067740':'#1239a7')+')',color:'var(--cc902-icon-ink, #fff)','-webkit-text-fill-color':'var(--cc902-icon-ink, #fff)','box-shadow':'var(--cc902-'+tone+'-shadow, none)',border:'1px solid #ffffffa6','border-radius':'7px'};
        Object.entries(paint).forEach(([name,value])=>button.style.setProperty(name,value,'important'));
        const glyph=button.querySelector('svg');
        if(glyph)Object.entries({stroke:'var(--cc902-icon-ink, #fff)',width:'var(--cc902-icon-size, 16px)',height:'var(--cc902-icon-size, 16px)','stroke-width':'1.9'}).forEach(([name,value])=>glyph.style.setProperty(name,value,'important'));

        button.addEventListener('click', async event => {
          event.preventDefault();event.stopPropagation();
          if (wrap.__busy || Date.now()<Number(window.__CC878_POPUPS_MINIMIZED_UNTIL__||0)) return;
          const selected=wrap.__row, candidateId=text(selected?.candidate_id), scope=principal();
          if (!candidateId || window.__CC602_NETWORK_PAUSED__) return;
          wrap.__busy=true;button.disabled=true;
          // CC905: request the installed WhatsApp app without opening a tab.
          try {
            let phone=text(selected.phone);
            if (!phone || /[#*]/.test(phone)) {
              const contact=await requestJson('/api/candidates/'+encodeURIComponent(candidateId)+'/contact-access?channel='+kind);
              phone=text(contact.phone);
            }
            if (scope!==principal() || !card.isConnected || text(wrap.__row?.candidate_id)!==candidateId || window.__CC602_NETWORK_PAUSED__) throw new Error('The active profile or session changed. Try again.');
            let digits=phone.replace(/\D/g,'');
            if (!digits) throw new Error('Phone number missing.');
            if (kind==='whatsapp') {
              if (digits.length===10) digits='91'+digits;
              const result=window.CareerCroxWhatsApp.open(digits,'',{
                source:'reminder_popup',
                guard:()=>scope===principal()&&card.isConnected,
                onLaunch:()=>requestJson('/api/candidates/'+encodeURIComponent(candidateId)+'/whatsapp-log',{
                  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'',source:'reminder_popup'})
                }).catch(()=>{})
              });
              actionStatus(card,result.error|| (result.needsClick?'Click Open WhatsApp Desktop to continue.':'WhatsApp Desktop requested.'));
            } else {
              if (digits.length===12 && digits.startsWith('91')) digits=digits.slice(2);
              await requestJson('/api/dialer/manual-call', { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
                phone:digits,candidate_id:candidateId,candidate_name:selected.title || selected.full_name || selected.candidate_name || '',
                process:selected.process || 'Candidate Profile',location:selected.location || '',source:'crm_popup_call_icon',
                next_call_gap_seconds:0,instant_start:'1',command_source:'crm_profile_call_icon_always_synced_instant',
                call_source:'crm_profile_call_icon',source_mode:'crm_profile_call_icon',note:'Call from CRM reminder'
              }) });
              if (scope===principal() && card.isConnected) actionStatus(card,'Call sent to paired phone.');
            }
          } catch (error) {
            if (scope===principal() && card.isConnected) actionStatus(card,error.message || 'Action failed.');
          } finally { wrap.__busy=false;button.disabled=false; }
        });
        wrap.appendChild(button);
      }
      if (direct) head.prepend(wrap); else head.insertBefore(wrap,head.querySelector('.cc803-review-close'));
    }
    wrap.__row={...row};
  }
  function compact(card, row, direct) {
    const title = card.querySelector(direct ? '.cc388-title' : '.cc803-review-title');
    const owners = card.querySelector(direct ? '.cc882-reminder-owner' : '.cc882-review-owner');
    if (title) {
      const current = title.querySelector('.cc900-name');
      const candidate = text(current ? current.textContent : title.textContent);
      const first = owners?.firstElementChild;
      const rawOwner = text(first?.querySelector('strong')?.textContent || first?.textContent);
      const owner = text(row?.owner_name || row?.recruiter_name || rawOwner)
        .replace(/^(?:recruiter|team leader|tl|manager|admin|owner|profile owner)\s*:\s*/i, '');
      if (!current) {
        const name = document.createElement('span');
        name.className = 'cc900-name';
        const dash = document.createElement('span');
        dash.className = 'cc900-dash';
        const person = document.createElement('span');
        person.className = 'cc900-owner';
        title.replaceChildren(name, dash, person);
      }
      const name = title.querySelector('.cc900-name');
      const dash = title.querySelector('.cc900-dash');
      const person = title.querySelector('.cc900-owner');
      if (name.textContent !== candidate) name.textContent = candidate;
      if (person.textContent !== owner) person.textContent = owner;
      const separator = owner ? ' --- ' : '';
      if (dash.textContent !== separator) dash.textContent = separator;
      const full = candidate + (owner ? ' --- ' + owner : '');
      if (title.title !== full) title.title = full;
      name.title = candidate;
      person.title = owner;
      style(title, { display:'flex', 'align-items':'baseline', gap:'3px', margin:'0px',
        height:'auto', 'min-height':'0px', 'font-size':'12px', 'line-height':'16px',
        'flex-shrink':'0', 'white-space':'nowrap', overflow:'hidden' });
      style(name, { flex:'1 1 auto', 'min-width':'0px', overflow:'hidden',
        'text-overflow':'ellipsis', 'white-space':'nowrap', color:'#193851', 'font-weight':'750' });
      style(dash, { flex:'0 0 auto', color:'#8b769f', 'font-size':'10px' });
      style(person, { flex:'0 1 auto', 'max-width':'44%', 'min-width':'0px',
        overflow:'hidden', 'text-overflow':'ellipsis', 'white-space':'nowrap',
        color:'#923e94', 'font-size':'10.5px', 'font-weight':'700' });
    }
    if (owners) {
      style(owners, { display:'none' });
      if (owners.getAttribute('aria-hidden') !== 'true') owners.setAttribute('aria-hidden','true');
    }
    for (const box of card.querySelectorAll('.cc898-reminder-context')) {
      style(box, { display:'block', margin:'0px', 'margin-top':'0px', padding:'4px 5px',
        gap:'0px', background:'var(--cc902-context-bg, #f5f1ff)', border:'1px solid #e1d8f0',
        'border-radius':'6px', 'font-size':'10.5px', 'line-height':'13px', 'flex':'0 0 auto' });
      [...box.children].forEach((line, index) => {
        style(line, { display:'block', margin:'0px', padding:'0px', gap:'0px', 'line-height':'13px' });
        const label = line.querySelector('b');
        const value = line.querySelector('span');
        if (label) {
          const caption = text(label.textContent).replace(/\s*[-–—:]\s*$/, '') + ' - ';
          if (label.textContent !== caption) label.textContent = caption;
          style(label, { display:'inline', 'font-size':'9.5px', 'line-height':'13px',
            'letter-spacing':'0px', color:index ? '#217353' : '#315b95', 'font-weight':'700' });
        }
        if (value) style(value, { display:'inline', 'font-size':'10.5px',
          'line-height':'13px', color:'var(--cc902-body-ink, #344256)', 'white-space':'normal', 'overflow-wrap':'anywhere' });
      });
    }
    if (!direct) return;
    const kind = text(card.dataset.reminderKind || card.className).toLowerCase();
    const ink = kind.includes('feedback') ? '#c8374b' : kind.includes('interview') ? '#c66d13'
      : kind.includes('follow') ? '#7852ae' : kind.includes('revenue') ? '#21825d'
      : kind.includes('task') ? '#187e85' : '#2d64ad';
    const head = card.querySelector('.cc388-head');
    const label = card.querySelector('.cc388-label');
    if (head) style(head, { 'min-height':'20px', gap:'4px', margin:'0px', 'flex':'0 0 auto' });
    if (label) style(label, { background:ink, color:'#ffffff', '-webkit-text-fill-color':'#ffffff',
      'font-size':'9px', 'line-height':'14px', padding:'2px 5px', 'min-height':'0px' });
    for (const button of card.querySelectorAll('.cc388-head button')) {
      style(button, { width:'20px', height:'20px', 'min-width':'20px',
        'min-height':'20px', padding:'0px', 'line-height':'18px', 'font-size':'13px' });
    }
    const note = card.querySelector('.cc388-note');
    if (note) {
      style(note, { flex:'0 0 auto', 'min-height':'0px', 'max-height':'52px',
        margin:'0px', padding:'4px 5px', 'overflow-y':'auto', 'box-sizing':'border-box',
        background:'var(--cc902-note-bg, #fff9ec)', border:'var(--cc902-note-border, 1px solid #ead3ac)', 'border-radius':'6px' });
      const caption = note.querySelector('b');
      const value = note.querySelector('span');
      if (caption) style(caption, { display:'none' });
      if (value) style(value, { display:'block', 'font-size':'11px', 'line-height':'14px',
        margin:'0px', color:'var(--cc902-body-ink, #344256)', 'font-weight':'500' });
    }
    const due = card.querySelector('.cc388-time');
    if (due) {
      style(due, { display:'flex', 'flex-direction':'row', 'align-items':'baseline',
        flex:'0 0 auto', gap:'4px', 'min-height':'0px', height:'auto',
        margin:'0px', padding:'3px 5px', background:'var(--cc902-due-bg, #eef7ff)', 'border-radius':'5px',
        'line-height':'13px', 'text-align':'left' });
      const caption = due.querySelector('b');
      const value = due.querySelector('span');
      if (caption) {
        if (caption.textContent !== 'Due -') caption.textContent = 'Due -';
        style(caption, { display:'inline', flex:'0 0 auto', 'font-size':'10px',
          'line-height':'13px', 'letter-spacing':'0px', 'text-transform':'none' });
      }
      if (value) style(value, { display:'inline', 'font-size':'10.5px',
        'line-height':'13px', 'white-space':'normal', 'font-weight':'650' });
    }
    const presetLabel = card.querySelector('.cc388-preset-label');
    if (presetLabel) style(presetLabel, { display:'none' });
    const presets = card.querySelector('.cc388-presets');
    if (presets) {
      if (card.lastElementChild !== presets) card.appendChild(presets);
      style(presets, { display:'grid', 'grid-template-columns':
        'repeat(' + Math.max(1,presets.children.length) + ', minmax(0, 1fr))',
        flex:'0 0 auto', gap:'3px', margin:'0px', padding:'0px' });
      for (const button of presets.querySelectorAll('button')) style(button, {
        height:'20px', 'min-height':'20px', padding:'0px 2px', 'font-size':'10px',
        'line-height':'16px', 'border-radius':'5px', 'box-sizing':'border-box' });
    }
  }
  function managerOwn(card, row) {
    const u = actor();
    const uid = text(u.user_id);
    const ownerId = text(row?.recruiter_user_id || row?.owner_user_id);
    const own = ['manager', 'admin'].includes(text(u.role).toLowerCase()) && !!uid && ownerId === uid;
    card.classList.toggle('cc900-own-manager', own);
    const names = ['border', 'border-left', 'background', 'animation'];
    if (own) {
      if (!savedBorders.has(card)) {
        savedBorders.set(card, names.map(name => [name, card.style.getPropertyValue(name), card.style.getPropertyPriority(name)]));
      }
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      style(card, {
        border: '2px solid transparent',
        'border-left': '2px solid transparent',
        background: 'linear-gradient(135deg, #ffffff, #fff4f5) padding-box, linear-gradient(125deg, #dc2626, #fb7185, #ef4444, #be123c) border-box',
        animation: reduced ? 'none' : 'cc900-owner-bounce 4.8s ease-in-out infinite'
      });
    } else if (savedBorders.has(card)) {
      for (const [name, value, priority] of savedBorders.get(card)) {
        if (value) card.style.setProperty(name, value, priority);
        else card.style.removeProperty(name);
      }
      savedBorders.delete(card);
    }
  }
  function reviewRow(host) {
    const queue = window.__CC804_REVIEW_QUEUE__;
    if (text(queue?.principal) !== text(actor().user_id)) return null;
    const node = host.querySelector('.cc803-review-title');
    const title = text(node?.querySelector('.cc900-name')?.textContent || node?.textContent);
    const rows = (Array.isArray(queue?.items) ? queue.items : []).filter(row => text(row.title) === title);
    // Identical names belonging to different people must never mark the wrong owner.
    const owners = new Set(rows.map(row => text(row.recruiter_user_id || row.owner_user_id)));
    return rows.length && owners.size === 1 && new Set(rows.map(row => text(row.candidate_id))).size === 1 ? rows[0] : null;
  }
  function refresh() {
    scheduled = false;
    if (!document.body) return;
    for (const host of document.querySelectorAll(hosts)) {
      const direct = host.matches('.cc730-direct-reminder-deck');
      style(host, {
        left: '8px', right: 'auto', bottom: '10px',
        ...(direct ? { width: 'min(232px, calc(100vw - 16px))', 'max-width': '232px', 'max-height': 'calc(100dvh - 20px)' } : {})
      });
      const card = host.querySelector(direct ? '.cc388-card' : '.cc604-approval-popup');
      if (card) {
        if (direct) style(card, {
          height: 'auto', 'min-height': '0px',
          'max-height': 'min(260px, calc(100dvh - 20px))',
          padding:'6px', gap:'3px',
          'overflow-y': 'auto', 'box-sizing': 'border-box'
        });
        const row = direct ? byKey.get(text(card.dataset.key)) : reviewRow(host);
        compact(card, row, direct);
        managerOwn(card, row);
        contactIcons(card, row, direct);
      }
      if (!observed.has(host)) {
        observed.add(host);
        new MutationObserver(schedule).observe(host, {
          subtree: true, childList: true, characterData: true,
          attributes: true, attributeFilter: ['style', 'data-key']
        });
      }
    }
  }
  function schedule() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(refresh); }
  }
  function install() {
    if (!document.getElementById('cc900-popup-style')) {
      const sheet = document.createElement('style');
      sheet.id = 'cc900-popup-style';
      sheet.textContent = `
        .cc901-contact-actions { display:inline-flex!important;align-items:center!important;gap:3px!important;flex:0 0 auto!important; }
        .cc901-contact { width:20px!important;height:20px!important;min-width:20px!important;padding:2px!important;border:1px solid #b8d7f1!important;border-radius:6px!important;background:#e8f3ff!important;color:#2466aa!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;cursor:pointer!important;transition:transform .14s ease!important;transform-origin:center!important; }
        .cc901-contact.whatsapp { background:#e7f8ef!important;color:#158251!important;border-color:#acd9c1!important; }
        .cc901-contact svg { width:14px!important;height:14px!important;fill:none!important;stroke:currentColor!important;stroke-width:1.7!important;stroke-linecap:round!important;stroke-linejoin:round!important;pointer-events:none!important; }
        .cc901-contact:hover,.cc901-contact:focus-visible { transform:scale(1.2)!important;outline:2px solid #86b8ec!important;outline-offset:1px!important; }
        .cc901-contact:disabled { opacity:.55!important;transform:none!important;cursor:wait!important; }
        .cc901-contact-status { color:#244b70!important;font-size:10px!important;line-height:13px!important;overflow-wrap:anywhere!important; }
        @media(prefers-reduced-motion:reduce) { .cc901-contact { transition:none!important; } }
        @keyframes cc900-owner-bounce {
          0%, 100% { transform: translateY(0); }
          45% { transform: translateY(-2px); }
          60% { transform: translateY(-1px); }
        }
        .cc900-own-manager:hover,
        .cc900-own-manager:focus-within { animation-play-state: paused !important; }
        @media (prefers-reduced-motion: reduce) {
          .cc900-own-manager { transform: none !important; }
        }
      `;
      document.head.appendChild(sheet);
    }
    new MutationObserver(records => {
      if (records.some(record => {
        const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        return target?.closest(hosts) || [...record.addedNodes].some(node => node.nodeType === 1 && (node.matches(hosts) || node.querySelector(hosts)));
      })) schedule();
    }).observe(document.body, { childList: true, subtree: true });
    refresh();
  }
  function clear() { byKey.clear(); schedule(); }
  ['career-crox-auth-changed', 'career-crox-access-changed', 'cc875-dashboard-changed'].forEach(name => window.addEventListener(name, clear));
  window.addEventListener('storage', event => {
    if (event.key === 'careerCroxCachedUser') clear();
  });
  window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', schedule);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
