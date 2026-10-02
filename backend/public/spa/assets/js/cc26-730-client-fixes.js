(function(){
  if(window.__CC730_CLIENT_FIXES__) return;
  window.__CC730_CLIENT_FIXES__ = true;
  window.__CC730_DIRECT_REMINDER_OWNER__ = true;

  const IST_OFFSET_MS = 330 * 60 * 1000;
  const SUBMISSION_REMINDER_OFFSET_MS = 5 * 60 * 1000;
  const LOCAL_REMINDER_HEARTBEAT_MS = 5 * 1000;
  const PRE_DUE_BUFFER_MS = 20000;
  const LOGO_FALLBACKS = [
    '/assets/img/career-crox-brand.png',
    '/assets/img/career-crox-sidebar-brand.png',
    '/assets/img/career-crox-logo.svg',
    '/assets/img/career-crox-brand-icon.png'
  ];
  const TERMINAL_INTERVIEW_STATUSES = new Set(['joined','joining','selected','rejected','cancelled','declined','closed']);
  const SNOOZE_OPTIONS = [
    { label: '5m', minutes: 5 },
    { label: '30m', minutes: 30 },
    { label: '1h', minutes: 60 },
    { label: '3h', minutes: 180 }
  ];

  let popupEl = null;
  let popupKey = '';
  let pollTimer = null;
  let localReminderClockTimer=null;
  let reminderSyncChannel=null;
  let dueTimer = null;
  let recruiterCache = null;
  let recruiterRequest = null;
  let domObserver = null;
  let domRefreshTimer = null;
  const RECRUITER_CACHE_KEY = 'cc745_recruiter_meta_cache_v1';
  const RECRUITER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  let loginHandled = false;
  let forceFreshReminder = true;
  let dataWriteRefreshTimer = 0;
  let lastLocalReminderWritePath = '';
  let lastLocalReminderWriteAt = 0;
  let reminderSnapshotConfigs = [];
  let lastReminderFetchAt = 0;
  let managerCenterEl = null;
  let managerCenterExpanded = false;
  let managerExpandedReminderKey = '';
  let managerLastDueCount = 0;
  let liveReminderDirtyTimer = null;

  function lower(v){ return String(v || '').trim().toLowerCase(); }
  function safe(v){ return String(v == null ? '' : v).trim(); }
  function uniqueParts(parts){ return Array.from(new Set((Array.isArray(parts) ? parts : []).map(safe).filter(Boolean))); }
  function onLoginRoute(){ return /^\/login(?:\/|$)/.test(location.pathname || ''); }
  function hasUser(){ try { return !!localStorage.getItem('careerCroxCachedUser'); } catch(_e){ return false; } }
  function currentUser(){ try { return JSON.parse(localStorage.getItem('careerCroxCachedUser') || 'null') || {}; } catch(_e){ return {}; } }
  function currentRole(){
    const raw=lower(currentUser().role || currentUser().designation || '');
    if(raw.includes('admin')) return 'admin';
    if(raw.includes('manager')) return 'manager';
    if(raw === 'tl' || raw.includes('team lead') || raw.includes('teamlead')) return 'tl';
    if(raw.includes('recruiter')) return 'recruiter';
    return raw;
  }
  function managerReminderMode(){ return ['manager','admin'].includes(currentRole()); }
  function navigatePath(path){
    const target=safe(path || '/');
    try {
      history.pushState(null,'',target);
      window.dispatchEvent(new PopStateEvent('popstate'));
      window.dispatchEvent(new Event('cc-route-change'));
    } catch(_e){ location.href=target; }
  }
  function openFullPath(path, fallbackAction){
    const target=safe(path);
    if(target){
      try { const win=window.open(target,'_blank','noopener,noreferrer'); if(win){ try{win.focus();}catch(_e){} return; } } catch(_e){}
      navigatePath(target); return;
    }
    try { if(typeof fallbackAction === 'function') fallbackAction(); } catch(_e){}
  }
  function todayKey(){ return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10); }
  function joinedOffice(){
    try {
      if (localStorage.getItem('careerCroxOfficeJoinedSession') || sessionStorage.getItem('careerCroxOfficeJoinedSession')) return true;
      if (localStorage.getItem('cc729_daily_office_join_backup')) return true;
    } catch(_e){}
    return false;
  }
  function canPoll(){ return !onLoginRoute() && hasUser() && !window.__CC602_NETWORK_PAUSED__; }
  function isTasksRoute(){ return /^\/tasks(?:\/|$)/.test(location.pathname || ''); }
  function reminderSnoozeKey(type, key){ return `cc736_popup_snooze_${type}_${key}`; }
  function readSnooze(type, key){
    if(!type || !key) return 0;
    try { return Number(localStorage.getItem(reminderSnoozeKey(type, key)) || 0); } catch(_e){ return 0; }
  }
  function snoozeUntil(type, key, minutes){
    if(!type || !key) return;
    try { localStorage.setItem(reminderSnoozeKey(type, key), String(Date.now() + Number(minutes || 0) * 60 * 1000)); } catch(_e){}
  }
  function isSnoozed(type, key){ return readSnooze(type, key) > Date.now(); }
  function closePopup(){ if(popupEl){ popupEl.remove(); popupEl = null; popupKey = ''; } const orphan=document.querySelector('.cc388-reminder-deck.cc730-direct-reminder-deck'); if(orphan){orphan.remove();} }

  function formatDateTime(value){
    if(!value) return '-';
    const parsed = new Date(value);
    if(Number.isNaN(parsed.getTime())) return safe(value);
    try { return parsed.toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'numeric', minute:'2-digit', hour12:true }); } catch(_e){ return parsed.toLocaleString(); }
  }
  function formatDateShort(value){
    if(!value) return '-';
    const parsed = new Date(value);
    if(Number.isNaN(parsed.getTime())) return safe(value).slice(0,10);
    try { return parsed.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }); } catch(_e){ return parsed.toLocaleDateString(); }
  }
  function fetchJson(url){
    return fetch(url, { credentials:'same-origin', cache:'no-store' }).then(function(response){
      if(!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    });
  }

  function submissionKey(row){ return safe(row && (row.submission_id || row.candidate_id)); }
  function submissionSnoozed(row){ const key = submissionKey(row); return key ? isSnoozed('submission', key) || isSnoozed('submission-global', key) : false; }
  function isSubmissionPending(row){
    const approval = lower(row && row.approval_status);
    const details = lower(row && row.all_details_sent);
    const status = lower(row && (row.status || row.candidate_status || row.profile_status));
    if(['deleted','__deleted__','archived','rejected','draft'].includes(status)) return false;
    if(['deleted','__deleted__','archived','rejected','draft',''].includes(approval)) return false;
    return approval === 'pending' || (approval === 'approved' && details === 'pending');
  }
  function reminderStamp(row){
    const snoozed = safe(row && row.reminder_snoozed_until);
    if(snoozed) return snoozed;
    const base = safe(row && (row.approval_requested_at || row.submitted_at || row.effective_submission_at || row.submission_origin_at || row.updated_at || row.created_at || row.submission_date));
    const baseMs = new Date(base || 0).getTime();
    if(!baseMs) return '';
    return new Date(baseMs + SUBMISSION_REMINDER_OFFSET_MS).toISOString();
  }
  function pickSubmissionReminder(rows){
    return (Array.isArray(rows) ? rows : [])
      .filter(function(row){ return row && isSubmissionPending(row) && !submissionSnoozed(row); })
      .sort(function(a,b){ return new Date(reminderStamp(a) || 0).getTime() - new Date(reminderStamp(b) || 0).getTime(); })[0] || null;
  }

  function reminderVisualLabel(type){
    const value = lower(type);
    if(value === 'submission') return 'SUBMISSION REMINDER';
    if(value === 'interview') return 'INTERVIEW REMINDER';
    if(value === 'task') return 'TASK REMINDER';
    if(value === 'followup') return 'FOLLOW-UP REMINDER';
    if(value === 'report') return 'REPORT REMINDER';
    if(value === 'break') return 'BREAK REMINDER';
    if(value === 'idle') return 'ACTIVITY REMINDER';
    if(value === 'notification') return 'NOTIFICATION';
    return 'CRM REMINDER';
  }
  function reminderOpenTarget(config){
    const actions = Array.isArray(config && config.actions) ? config.actions : [];
    const first = actions[0];
    return first && typeof first.onClick === 'function' ? first.onClick : function(){};
  }
  function showReminderPopup(config){
    if(!config || !config.key) return;
    if(popupEl && popupKey === config.key) return;
    closePopup();
    popupKey = config.key;
    let deck = document.querySelector('.cc388-reminder-deck.cc730-direct-reminder-deck');
    if(!deck){
      deck = document.createElement('div');
      deck.className = 'cc388-reminder-deck cc730-direct-reminder-deck';
      document.body.appendChild(deck);
    }
    const typeMap = { followup:'followups' };
    const type = typeMap[lower(config.type)] || lower(config.type || 'generic');
    const label = reminderVisualLabel(config.type).replace('FOLLOW-UP','FOLLOWUP');
    const title = safe(config.name || config.title || label);
    const note = safe(config.note || 'Reminder needs action.');
    const countText = safe(config.countText || '1 due');
    const timeLabel = type === 'interview' ? 'Interview' : 'Due';
    const timeText = safe(String(config.timeText || '').replace(/^Reminder time:\s*/i,'').replace(/^Due:\s*/i,'').replace(/^Interview:\s*/i,''));
    deck.innerHTML = `<div class="cc388-card ${type}" data-key="${safe(config.key)}" title="Open profile"><div class="cc388-head"><span class="cc388-label">${label}</span><span class="cc388-head-actions"><span class="cc388-count">${countText}</span><button class="cc388-x" type="button" aria-label="Close">×</button></span></div><div class="cc388-title"></div><div class="cc388-note"><b>NOTE</b><span></span></div><div class="cc388-time">${timeLabel}: ${timeText}</div><div class="cc388-preset-label">Snooze</div><div class="cc388-presets"></div></div>`;
    const card = deck.querySelector('.cc388-card');
    card.querySelector('.cc388-title').textContent = title;
    card.querySelector('.cc388-note span').textContent = note;
    const openReminder = reminderOpenTarget(config);
    card.addEventListener('click', function(event){
      if(event.target.closest('.cc388-preset') || event.target.closest('.cc388-x')) return;
      try { openReminder(); } catch(_e){}
      // CC26_764: opening a still-unresolved reminder is a local 5-minute acknowledgement,
      // not permanent removal from the snapshot. It returns automatically if no write resolves it.
      snoozeUntil(config.type || 'generic', config.localKey || config.key, 5);
      closePopup();
      setTimeout(function(){ renderReminderConfigs(reminderSnapshotConfigs); }, 60);
    });
    card.querySelector('.cc388-x').addEventListener('click', function(event){
      event.preventDefault(); event.stopPropagation();
      // Keep the row in the local snapshot so the 5-minute close/snooze can actually expire.
      snoozeUntil(config.type || 'generic', config.localKey || config.key, 5);
      closePopup();
      setTimeout(function(){ renderReminderConfigs(reminderSnapshotConfigs); }, 60);
    });
    const presets = card.querySelector('.cc388-presets');
    (Array.isArray(config.snoozes) ? config.snoozes : SNOOZE_OPTIONS).forEach(function(option){
      const btn=document.createElement('button');
      btn.type='button'; btn.className='cc388-preset'; btn.textContent=safe(option.label);
      btn.addEventListener('click', function(event){
        event.preventDefault(); event.stopPropagation();
        // CC26_764: snooze is local-only and preserves the reminder in memory;
        // no network read is needed when the snooze expires.
        snoozeUntil(config.type || 'generic', config.localKey || config.key, Number(option.minutes || 0));
        closePopup();
        setTimeout(function(){ renderReminderConfigs(reminderSnapshotConfigs); }, 60);
      });
      presets.appendChild(btn);
    });
    popupEl = deck;
  }

  function removeManagerReminderCenter(){
    if(managerCenterEl){ managerCenterEl.remove(); managerCenterEl=null; }
    managerCenterExpanded=false; managerExpandedReminderKey=''; managerLastDueCount=0;
  }
  function managerReminderTypeLabel(type){
    const t=lower(type);
    if(t==='followup') return 'FOLLOW-UP';
    return reminderVisualLabel(t).replace(' REMINDER','').replace('CRM ','').trim() || 'REMINDER';
  }
  function ensureManagerReminderCenter(){
    let center=document.getElementById('cc763-manager-reminder-center');
    if(center){ managerCenterEl=center; return center; }
    center=document.createElement('section');
    center.id='cc763-manager-reminder-center';
    center.className='cc763-manager-center is-minimized';
    center.setAttribute('aria-label','Manager Reminder Center');
    center.innerHTML=`<button type="button" class="cc763-manager-center-head" aria-expanded="false"><span class="cc763-manager-center-icon">R</span><span class="cc763-manager-center-copy"><b>Reminder Center</b><small>Manager queue • click to review</small></span><strong class="cc763-manager-center-count">0</strong><span class="cc763-manager-center-chevron">⌃</span></button><div class="cc763-manager-center-panel"><div class="cc763-manager-center-toolbar"><span class="cc763-manager-center-status">Pending sequence</span><div><button type="button" class="cc763-manager-refresh">Refresh</button><button type="button" class="cc763-manager-minimize">Minimize</button></div></div><div class="cc763-manager-center-list"></div></div>`;
    document.body.appendChild(center);
    const head=center.querySelector('.cc763-manager-center-head');
    const minimize=center.querySelector('.cc763-manager-minimize');
    const refresh=center.querySelector('.cc763-manager-refresh');
    head.addEventListener('click',function(){
      managerCenterExpanded=!managerCenterExpanded;
      center.classList.toggle('is-open',managerCenterExpanded);
      center.classList.toggle('is-minimized',!managerCenterExpanded);
      head.setAttribute('aria-expanded',managerCenterExpanded?'true':'false');
    });
    minimize.addEventListener('click',function(){
      managerCenterExpanded=false; managerExpandedReminderKey='';
      center.classList.remove('is-open'); center.classList.add('is-minimized');
      head.setAttribute('aria-expanded','false');
    });
    refresh.addEventListener('click',function(){
      refresh.disabled=true; refresh.textContent='Refreshing…';
      Promise.resolve(window.__CC730_REFRESH_REMINDERS__ ? window.__CC730_REFRESH_REMINDERS__(true) : loadAllReminders()).finally(function(){refresh.disabled=false;refresh.textContent='Refresh';});
    });
    managerCenterEl=center;
    return center;
  }
  function renderManagerReminderCenter(dueRows){
    if(!managerReminderMode()){ removeManagerReminderCenter(); return; }
    closePopup();
    const rows=(Array.isArray(dueRows)?dueRows:[]).filter(function(item){return item && !isSnoozed(item.type,item.localKey);});
    if(!rows.length){ removeManagerReminderCenter(); return; }
    const center=ensureManagerReminderCenter();
    const count=center.querySelector('.cc763-manager-center-count');
    const status=center.querySelector('.cc763-manager-center-status');
    const list=center.querySelector('.cc763-manager-center-list');
    count.textContent=String(rows.length);
    status.textContent=`${rows.length} pending reminder${rows.length===1?'':'s'} • oldest first`;
    if(rows.length>managerLastDueCount && !managerCenterExpanded){
      center.classList.remove('cc763-manager-new'); void center.offsetWidth; center.classList.add('cc763-manager-new');
      setTimeout(function(){ if(center) center.classList.remove('cc763-manager-new'); },900);
    }
    managerLastDueCount=rows.length;
    list.innerHTML='';
    rows.forEach(function(config,index){
      const item=document.createElement('article');
      const expanded=managerExpandedReminderKey===config.key;
      item.className='cc763-manager-reminder-item'+(expanded?' is-expanded':'');
      item.setAttribute('data-reminder-key',safe(config.key));
      const top=document.createElement('button'); top.type='button'; top.className='cc763-manager-reminder-summary';
      const owner=safe(config.ownerLabel || config.subtitle || '');
      top.innerHTML=`<span class="cc763-manager-seq">${index+1}</span><span class="cc763-manager-item-copy"><b></b><small></small></span><span class="cc763-manager-type">${managerReminderTypeLabel(config.type)}</span><span class="cc763-manager-item-chevron">${expanded?'−':'+'}</span>`;
      top.querySelector('b').textContent=safe(config.name || config.title || 'Reminder');
      top.querySelector('small').textContent=owner || safe(config.timeText || 'Pending');
      const details=document.createElement('div'); details.className='cc763-manager-reminder-details';
      const note=document.createElement('div'); note.className='cc763-manager-reminder-note'; note.textContent=safe(config.note || 'Reminder needs action.');
      const due=document.createElement('div'); due.className='cc763-manager-reminder-due'; due.textContent=safe(config.timeText || 'Due now');
      const extend=document.createElement('div'); extend.className='cc763-manager-reminder-extend';
      const extendLabel=document.createElement('span'); extendLabel.textContent='Extend'; extend.appendChild(extendLabel);
      (Array.isArray(config.snoozes)?config.snoozes:SNOOZE_OPTIONS).forEach(function(option){
        const btn=document.createElement('button');btn.type='button';btn.textContent=safe(option.label);btn.addEventListener('click',function(event){event.stopPropagation();snoozeUntil(config.type||'generic',config.localKey||config.key,Number(option.minutes||0));managerExpandedReminderKey='';renderReminderConfigs(reminderSnapshotConfigs);});extend.appendChild(btn);
      });
      const open=document.createElement('button'); open.type='button'; open.className='cc763-manager-open-full'; open.textContent='Open Full'; open.addEventListener('click',function(event){event.stopPropagation();openFullPath(config.openPath,reminderOpenTarget(config));});
      details.appendChild(note); details.appendChild(due); details.appendChild(extend); details.appendChild(open);
      top.addEventListener('click',function(){
        managerExpandedReminderKey=managerExpandedReminderKey===config.key?'':config.key;
        managerCenterExpanded=true;
        renderManagerReminderCenter(rows);
      });
      item.appendChild(top); item.appendChild(details); list.appendChild(item);
    });
    center.classList.toggle('is-open',managerCenterExpanded);
    center.classList.toggle('is-minimized',!managerCenterExpanded);
    center.querySelector('.cc763-manager-center-head').setAttribute('aria-expanded',managerCenterExpanded?'true':'false');
  }

  async function loadSubmissionReminder(){
    if(!canPoll()) return null;
    try {
      const data = await fetchJson('/api/submissions?view=all_pending&_cc730=' + Date.now());
      const next = pickSubmissionReminder(Array.isArray(data && data.items) ? data.items : []);
      if(!next) return null;
      const key = submissionKey(next);
      if(!key || isSnoozed('submission', key) || isSnoozed('submission-global', key)) return null;
      const dueAt = new Date(reminderStamp(next) || 0).getTime();
      if(!dueAt) return null;
      return {
        dueAt,
        key: 'submission:' + key,
        localKey: key,
        type: 'submission',
        priority: 1,
        title: 'Submission Reminder',
        subtitle: uniqueParts([next.candidate_id, next.recruiter_name || next.recruiter_code]).join(' • '),
        name: safe(next.full_name) || 'Pending submission',
        note: safe(next.follow_up_note || next.last_note || next.last_notes || next.notes || next.note) || 'Pending submission needs action now.',
        timeText: 'Reminder time: ' + formatDateTime(reminderStamp(next)),
        actions: [
          { label: 'Open Profile', onClick: function(){ openProfile(next); } },
          { label: 'Open Queue', kind:'secondary', onClick: function(){ openSubmissionQueue(next); } }
        ]
      };
    } catch(_e){ return null; }
  }

  async function loadTaskReminder(){
    if(!canPoll()) return null;
    try {
      const data = await fetchJson('/api/tasks/reminders/next?_cc730=' + Date.now());
      const next = data && data.item || null;
      if(!next || !next.task_id) return null;
      const key = safe(next.task_id);
      if(isSnoozed('task', key)) return null;
      const dueAt = Number(next.dueAt || 0) || new Date(next.due_date || 0).getTime() || 0;
      if(!dueAt) return null;
      return {
        dueAt,
        key: 'task:' + key,
        localKey: key,
        type: 'task',
        priority: 3,
        title: 'Task Reminder',
        subtitle: uniqueParts([next.assigned_to_name, next.assigned_to_code]).join(' • '),
        name: safe(next.title) || 'Task due',
        note: safe(next.description) || 'Task is due now.',
        timeText: 'Due: ' + formatDateTime(next.due_date || dueAt),
        actions: [
          { label: 'Open Task', onClick: function(){ openTask(next); } },
          { label: 'Open Tasks', kind:'secondary', onClick: function(){ openPath('/tasks'); } }
        ]
      };
    } catch(_e){ return null; }
  }

  async function loadFollowupReminder(){
    if(!canPoll()) return null;
    try {
      const data = await fetchJson('/api/followups/reminders/next?_cc730=' + Date.now());
      const next = data && data.item || null;
      if(!next || !next.candidate_id) return null;
      const key = safe(next.candidate_id);
      if(isSnoozed('followup', key)) return null;
      const dueAt = Number(next.dueAt || 0) || new Date(next.follow_up_at || 0).getTime() || 0;
      if(!dueAt) return null;
      return {
        dueAt,
        key: 'followup:' + key,
        localKey: key,
        type: 'followup',
        priority: 2,
        title: 'Follow-up Reminder',
        subtitle: uniqueParts([next.candidate_id, next.recruiter_name || next.recruiter_code]).join(' • '),
        name: safe(next.full_name) || 'Follow-up due',
        note: safe(next.follow_up_note || next.last_note || next.last_notes || next.notes || next.note) || 'Follow-up is due now.',
        timeText: 'Due: ' + formatDateTime(next.follow_up_at || dueAt),
        actions: [
          { label: 'Open Profile', onClick: function(){ openProfile(next); } },
          { label: 'Open FollowUps', kind:'secondary', onClick: function(){ openPath('/followups'); } }
        ]
      };
    } catch(_e){ return null; }
  }

  function interviewDateValue(row){ return safe(row && (row.interview_reschedule_date || row.interview_date_effective || row.interview_date || row.scheduled_at || row.created_at)); }
  function interviewDueMs(row){
    const value = interviewDateValue(row);
    if(!value) return 0;
    const parsed = new Date(value).getTime();
    if(Number.isFinite(parsed) && parsed > 0) return parsed;
    if(/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value + 'T09:00:00').getTime();
    return 0;
  }
  function interviewStatusText(row){ return lower(row && (row.status || row.interview_status)); }
  function isInterviewRelevant(row){
    const status = interviewStatusText(row);
    if(TERMINAL_INTERVIEW_STATUSES.has(status)) return false;
    const dueAt = interviewDueMs(row);
    if(!dueAt) return false;
    const dateKey = interviewDateValue(row).slice(0,10);
    return dateKey <= todayKey() || dueAt <= Date.now() + PRE_DUE_BUFFER_MS;
  }
  async function loadSummaryExtraReminder(){
    if(!canPoll()) return null;
    try {
      const data = await fetchJson('/api/reports/reminder-summary?fresh=1&_cc736=' + Date.now());
      const actions = Array.isArray(data && data.actions) ? data.actions : [];
      const allowed = new Set(['report','notification','break','idle']);
      const rows = actions.filter(function(row){ return row && allowed.has(lower(row.type)); })
        .map(function(row){ return { row:row, dueAt:new Date(row.due_at || row.created_at || row.updated_at || 0).getTime() || Date.now() }; })
        .filter(function(entry){ return !isSnoozed(lower(entry.row.type), safe(entry.row.key || entry.row.notification_id || entry.row.type)); })
        .sort(function(a,b){ return a.dueAt-b.dueAt; });
      if(!rows.length) return null;
      const selected=rows[0]; const row=selected.row; const type=lower(row.type || 'generic'); const key=safe(row.key || row.notification_id || type);
      return {
        dueAt:selected.dueAt,
        key:type + ':' + key,
        localKey:key,
        type:type,
        priority:5,
        title:safe(row.title) || reminderVisualLabel(type),
        name:safe(row.title) || reminderVisualLabel(type),
        note:safe(row.message) || 'Reminder needs action.',
        timeText:'Due: ' + formatDateTime(row.due_at || selected.dueAt),
        actions:[{ label:'Open', onClick:function(){ openPath(safe(row.open_path) || '/reports'); } }]
      };
    } catch(_e){ return null; }
  }

  async function loadInterviewReminder(){
    if(!canPoll()) return null;
    try {
      const data = await fetchJson('/api/interviews?_cc730=' + Date.now());
      const rows = Array.isArray(data && data.items) ? data.items : [];
      const next = rows.filter(isInterviewRelevant).sort(function(a,b){ return interviewDueMs(a) - interviewDueMs(b); })[0] || null;
      if(!next) return null;
      const key = safe(next.interview_id || next.candidate_id || interviewDateValue(next));
      if(!key || isSnoozed('interview', key)) return null;
      const interviewAt = interviewDueMs(next);
      const dueAt = Math.max(1, interviewAt);
      const overdue = safe(interviewDateValue(next)).slice(0,10) < todayKey() || dueAt < Date.now();
      return {
        key: 'interview:' + key,
        localKey: key,
        dueAt,
        type: 'interview',
        priority: 4,
        title: overdue ? 'Interview Follow-up' : 'Interview Reminder',
        subtitle: uniqueParts([next.candidate_id, next.recruiter_name || next.recruiter_code, next.virtual_onsite]).join(' • '),
        name: safe(next.full_name) || 'Interview candidate',
        note: overdue ? 'Interview follow-up is pending. Please update the interview status.' : 'Interview is due today. Please check the candidate now.',
        timeText: 'Interview: ' + (safe(interviewDateValue(next)).slice(0,10) === todayKey() ? formatDateShort(interviewDateValue(next)) + ' (Today)' : formatDateShort(interviewDateValue(next))),
        actions: [
          { label: 'Open Profile', onClick: function(){ openInterview(next); } },
          { label: 'Open Interviews', kind:'secondary', onClick: function(){ openPath('/interviews'); } }
        ]
      };
    } catch(_e){ return null; }
  }


  function reminderLocalKey(row, type){
    const normalized = lower(type || row && row.type || 'generic');
    if(normalized === 'submission') return safe(row && (row.submission_id || row.candidate_id || row.key));
    if(normalized === 'interview') return safe(row && (row.interview_id || row.candidate_id || row.key));
    if(normalized === 'task') return safe(row && (row.task_id || row.key));
    if(normalized === 'followup' || normalized === 'followups') return safe(row && (row.candidate_id || row.key));
    if(normalized === 'notification') return safe(row && (row.notification_id || row.key));
    return safe(row && (row.key || normalized));
  }
  function reminderPriority(type){
    const value = lower(type);
    if(value === 'submission') return 1;
    if(value === 'followup' || value === 'followups') return 2;
    if(value === 'task') return 3;
    if(value === 'interview') return 4;
    if(value === 'report') return 5;
    if(value === 'notification') return 6;
    if(value === 'break') return 7;
    if(value === 'idle') return 8;
    return 9;
  }
  function reminderDisplayTitle(row, type){
    const raw = safe(row && row.title) || reminderVisualLabel(type);
    if(lower(type) === 'report') return raw;
    return raw.replace(/^(submission reminder|interview reminder|task reminder|follow[- ]?up reminder)\s*:\s*/i, '').trim() || raw;
  }
  function actionToReminderConfig(row, index){
    if(!row || typeof row !== 'object') return null;
    const rawType = lower(row.type || 'generic');
    const type = rawType === 'followups' ? 'followup' : rawType;
    const localKey = reminderLocalKey(row, type) || String(index || 0);
    if(isSnoozed(type, localKey)) return null;
    const dueAt = new Date(row.due_at || row.created_at || row.updated_at || 0).getTime() || Date.now();
    return {
      dueAt,
      key: safe(row.key) || `${type}:${localKey}`,
      localKey,
      type,
      priority: reminderPriority(type),
      title: safe(row.title) || reminderVisualLabel(type),
      name: reminderDisplayTitle(row, type),
      note: safe(row.message) || 'Reminder needs action.',
      timeText: `${type === 'interview' && row.scheduled_at ? 'Interview' : 'Due'}: ${formatDateTime(type === 'interview' && row.scheduled_at ? row.scheduled_at : (row.due_at || dueAt))}`,
      ownerLabel: safe(row.owner_label || row.recruiter_name || row.assigned_to_name || row.owner_name || ''),
      openPath: safe(row.open_path) || '/reports',
      actions: [{ label:'Open', onClick:function(){ navigatePath(safe(row.open_path) || '/reports'); } }]
    };
  }
  async function loadConsolidatedReminderConfigs(){
    if(!canPoll()) return [];
    try {
      const now = Date.now();
      if(!forceFreshReminder && reminderSnapshotConfigs.length && now - lastReminderFetchAt < 45000){
        return reminderSnapshotConfigs;
      }
      const fresh = forceFreshReminder ? '1' : '0';
      forceFreshReminder = false;
      const data = await fetchJson(`/api/reports/reminder-summary?fresh=${fresh}&_cc739=${Math.floor(now/1000)}`);
      const actions = Array.isArray(data && data.actions) ? data.actions : [];
      lastReminderFetchAt = Date.now();
      reminderSnapshotConfigs = actions.map(actionToReminderConfig).filter(Boolean);
      return reminderSnapshotConfigs;
    } catch(_e){ return reminderSnapshotConfigs; }
  }

  function clearDueTimer(){ if(dueTimer){ clearTimeout(dueTimer); dueTimer=null; } }
  function scheduleDueReload(at){
    clearDueTimer();
    const due = Number(at || 0);
    if(!due || !Number.isFinite(due) || due <= Date.now()) return;
    dueTimer=setTimeout(function(){ dueTimer=null; renderReminderConfigs(reminderSnapshotConfigs); }, Math.max(50, Math.min(due-Date.now()+80, 2147480000)));
  }
  function nextLocalSnoozeWake(rows, now){
    const current=Number(now||Date.now());
    let next=0;
    (Array.isArray(rows)?rows:[]).forEach(function(item){
      if(!item) return;
      const wake=readSnooze(item.type,item.localKey);
      if(wake>current && (!next || wake<next)) next=wake;
    });
    return next;
  }
  function renderReminderConfigs(available){
    const rows=Array.isArray(available)?available:[];
    const now=Date.now();
    const dueNow=rows.filter(function(item){return item && !isSnoozed(item.type,item.localKey) && Number(item.dueAt||0) <= now;})
      .sort(function(a,b){ const da=Number(a.dueAt||0), db=Number(b.dueAt||0); if(da!==db) return da-db; return Number(a.priority||999)-Number(b.priority||999); });
    const snoozeWake=nextLocalSnoozeWake(rows,now);
    if(dueNow.length){
      clearDueTimer();
      // Exact local wake for a snoozed reminder; no API/Supabase read.
      if(snoozeWake) scheduleDueReload(snoozeWake);
      if(managerReminderMode()){
        renderManagerReminderCenter(dueNow);
        return;
      }
      removeManagerReminderCenter();
      const chosen=dueNow[0];
      chosen.countText = dueNow.length > 1 ? `1 of ${dueNow.length} • ${dueNow.length} pending` : '1 due';
      showReminderPopup(chosen);
      return;
    }
    closePopup();
    removeManagerReminderCenter();
    const future=rows.filter(function(item){return item && !isSnoozed(item.type,item.localKey) && Number(item.dueAt||0) > now;}).sort(function(a,b){return Number(a.dueAt||0)-Number(b.dueAt||0);});
    const nextFuture=future.length?Number(future[0].dueAt||0):0;
    const nextWake=[nextFuture,snoozeWake].filter(function(v){return Number(v)>now;}).sort(function(a,b){return a-b;})[0]||0;
    if(nextWake) scheduleDueReload(nextWake); else clearDueTimer();
  }
  async function loadAllReminders(){
    if(!canPoll()) { closePopup(); removeManagerReminderCenter(); clearDueTimer(); return; }
    try {
      const available = await loadConsolidatedReminderConfigs();
      renderReminderConfigs(available);
    } catch(_e){}
  }
  function scheduleReminderClock(){ if(pollTimer) clearInterval(pollTimer); pollTimer=null; loadAllReminders(); if(localReminderClockTimer) clearInterval(localReminderClockTimer); localReminderClockTimer=setInterval(function(){ renderReminderConfigs(reminderSnapshotConfigs); }, LOCAL_REMINDER_HEARTBEAT_MS); }

  window.__CC730_REFRESH_REMINDERS__ = function(force){
    if(force !== false) forceFreshReminder = true;
    return loadAllReminders();
  };
  window.addEventListener('career-crox-manager-reminder-dirty', function(event){
    if(!canPoll()) return;
    const source=String(event && event.detail && event.detail.source || '');
    // Same-browser writes already emitted career-crox-data-written. Ignore the matching
    // SSE echo briefly so the actor gets reliability across devices without two DB reads here.
    if(source && lastLocalReminderWritePath && Date.now()-lastLocalReminderWriteAt < 1800 &&
       (lastLocalReminderWritePath.indexOf(source)!==-1 || source.indexOf(lastLocalReminderWritePath)!==-1)) return;
    if(liveReminderDirtyTimer) clearTimeout(liveReminderDirtyTimer);
    liveReminderDirtyTimer=setTimeout(function(){
      liveReminderDirtyTimer=null;
      forceFreshReminder=true;
      loadAllReminders();
    }, 260);
  });
  try {
    if(typeof BroadcastChannel === 'function'){
      reminderSyncChannel = new BroadcastChannel('career-crox-reminder-sync-v1');
      reminderSyncChannel.onmessage = function(event){
        const path = String(event && event.data && event.data.path || '');
        if(/\/api\/(candidates|submissions|interviews|tasks|followups|approvals)/.test(path)){
          forceFreshReminder = true;
          setTimeout(loadAllReminders, 120);
        }
      };
    }
  } catch(_e){}

  function applyLogoFallbacks(root){
    const scope = root || document;
    const imgs = scope.querySelectorAll('img.sidebar-brand-full-logo, img.topbar-logo, img[alt="Career Crox"], .sidebar-brand-shell img, .app-sidebar img, .topbar-left img, .brand-logo img');
    imgs.forEach(function(img){
      if(img.dataset.cc730LogoBound === '1') return;
      img.dataset.cc730LogoBound = '1';
      let index = 0;
      function nextLogo(){
        while(index < LOGO_FALLBACKS.length){
          const candidate = LOGO_FALLBACKS[index++];
          if(candidate && img.getAttribute('src') !== candidate){ img.src = candidate; return; }
        }
      }
      img.addEventListener('error', nextLogo);
      setTimeout(function(){
        try {
          const broken = !img.complete || !img.naturalWidth || img.naturalWidth < 10 || /undefined|null|\/assets\/img\/\s*$/i.test(String(img.getAttribute('src') || ''));
          if(broken) nextLogo();
        } catch(_e){}
      }, 500);
      setTimeout(function(){ try { if(!img.naturalWidth) nextLogo(); } catch(_e){} }, 1600);
    });
  }

  async function getRecruiters(){
    if(Array.isArray(recruiterCache)) return recruiterCache;
    try {
      const cached=JSON.parse(sessionStorage.getItem(RECRUITER_CACHE_KEY)||'null');
      if(cached&&Array.isArray(cached.rows)&&Date.now()-Number(cached.at||0)<RECRUITER_CACHE_TTL_MS){
        recruiterCache=cached.rows;return recruiterCache;
      }
    } catch(_e){}
    // CC26_745: many React DOM mutations used to start many /api/users/list calls
    // before the first request finished. Keep exactly one in-flight request.
    if(recruiterRequest) return recruiterRequest;
    recruiterRequest=fetchJson('/api/users/list').then(function(data){
      recruiterCache=Array.isArray(data&&(data.users||data.items||data.rows))?(data.users||data.items||data.rows):[];
      try{sessionStorage.setItem(RECRUITER_CACHE_KEY,JSON.stringify({at:Date.now(),rows:recruiterCache}));}catch(_e){}
      return recruiterCache;
    }).catch(function(){recruiterCache=[];return recruiterCache;}).finally(function(){recruiterRequest=null;});
    return recruiterRequest;
  }

  async function applyRecruiterMeta(){
    const holder = document.querySelector('[data-field="recruiter_code"]');
    if(!holder) return;
    let meta = holder.querySelector('.cc730-recruiter-meta');
    if(!meta){ meta = document.createElement('div'); meta.className = 'helper-text top-gap-small cc730-recruiter-meta'; holder.appendChild(meta); }
    const select = holder.querySelector('select');
    const input = holder.querySelector('input');
    async function render(rawValue, labelText){
      const raw = safe(rawValue);
      if(!raw && !labelText){ meta.textContent = ''; return; }
      const list = await getRecruiters();
      const matched = list.find(function(row){
        return [row && row.user_id, row && row.recruiter_code, row && row.user_code, row && row.username, row && row.employee_code, row && row.full_name]
          .map(lower).includes(lower(raw)) || lower(safe(row && row.full_name)) === lower(labelText);
      });
      if(matched){
        const personName=safe(matched.full_name||matched.name||labelText||raw);
        const personCode=safe(matched.employee_code||matched.recruiter_code||matched.user_code||matched.username||raw);
        meta.textContent = uniqueParts([personName, personCode,
          matched.recruiter_code && lower(matched.recruiter_code) !== lower(matched.employee_code) ? matched.recruiter_code : ''
        ]).join(' • ');
        // Keep the visible dropdown useful even when an older candidate payload only
        // supplied the code. This changes UI text only; no data is written.
        if(select){
          const option=select.options[select.selectedIndex];
          if(option&&personName&&personCode&&lower(personName)!==lower(personCode)){
            const pretty=personName+' - '+personCode;
            if(safe(option.textContent)!==pretty)option.textContent=pretty;
          }
        }
      } else {
        meta.textContent = uniqueParts([labelText || raw]).join(' • ');
      }
    }
    if(select){
      const update = function(){
        const option = select.options[select.selectedIndex];
        render(select.value, option ? safe(option.textContent) : safe(select.value));
      };
      if(select.dataset.cc730Bound !== '1'){
        select.dataset.cc730Bound = '1';
        select.addEventListener('change', update);
      }
      update();
      return;
    }
    if(input){ render(input.value, input.value); }
  }

  function applyTaskPageCompaction(){
    if(!isTasksRoute()) return;
    const summary = document.querySelector('.task-summary-grid');
    const controlPanel = Array.from(document.querySelectorAll('.table-title')).find(function(node){ return /task control/i.test(node.textContent || ''); });
    const controlPanelWrap = controlPanel ? controlPanel.closest('.table-panel') : null;
    if(summary && controlPanelWrap && controlPanelWrap.parentElement && summary.previousElementSibling !== controlPanelWrap){
      controlPanelWrap.parentElement.insertBefore(summary, controlPanelWrap);
      summary.dataset.cc730Moved = '1';
    }
    document.querySelectorAll('.crm-modal-backdrop').forEach(function(backdrop){ if(backdrop) backdrop.dataset.cc730Skip = '1'; });
    const blocks = Array.from(document.querySelectorAll('section, .panel, .table-panel, .glassy-card, .fade-up, .premium-card')).filter(function(el){
      if(!el || el.dataset.cc730Skip === '1') return false;
      if(el.closest('.crm-modal-backdrop')) return false;
      const text = lower((el.textContent || '').slice(0, 260));
      return /create a task for today/.test(text) || /set up recurring work/.test(text) || /recurring work/.test(text) && /optional/.test(text);
    });
    blocks.forEach(function(el){
      if(el.dataset.cc730TaskHidden === '1') return;
      el.dataset.cc730TaskHidden = '1';
      el.style.setProperty('display', 'none', 'important');
    });
    const toolbar = controlPanelWrap ? controlPanelWrap.querySelector('.toolbar-actions') : null;
    if(toolbar){
      const createBtn = Array.from(toolbar.querySelectorAll('button')).find(function(btn){ return /create task/i.test(btn.textContent || ''); });
      if(createBtn){
        createBtn.classList.add('cc730-toolbar-create-btn');
        if(!toolbar.querySelector('.cc730-recurring-quick-btn')){
          const recurring = document.createElement('button');
          recurring.type = 'button';
          recurring.className = 'ghost-btn bounceable cc730-recurring-quick-btn';
          recurring.textContent = 'Recurring Task';
          recurring.addEventListener('click', function(){
            try { createBtn.click(); } catch(_e){}
            setTimeout(function(){
              const modal = document.querySelector('.task-premium-modal');
              if(!modal) return;
              const select = Array.from(modal.querySelectorAll('select')).find(function(el){
                const label = el.closest('.field') && el.closest('.field').querySelector('label');
                return /recurring/i.test(String(label && label.textContent || ''));
              });
              if(select){
                select.value = 'daily';
                select.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }, 180);
          });
          createBtn.insertAdjacentElement('afterend', recurring);
        }
      }
      const refreshChip = Array.from(toolbar.querySelectorAll('.mini-chip, span')).find(function(node){ return /manual refresh/i.test(node.textContent || ''); });
      if(refreshChip) refreshChip.classList.add('cc730-manual-refresh-chip');
    }
  }

  function handleIdleRestoreLogin(){
    if(!onLoginRoute() || loginHandled) return;
    let message = '';
    try { message = safe(sessionStorage.getItem('careerCroxSessionExpiredMessage')); } catch(_e){}
    if(!message) return;
    const form = document.querySelector('form');
    if(!form || form.dataset.cc730IdleRestore === '1') return;
    form.dataset.cc730IdleRestore = '1';
    form.addEventListener('submit', function(){
      try { sessionStorage.setItem('cc730_idle_login_restore', '1'); } catch(_e){}
    }, { once: true });
    loginHandled = true;
  }

  function queueDomRefresh(delay){
    if(domRefreshTimer) return;
    domRefreshTimer=setTimeout(function(){
      domRefreshTimer=null;
      applyRecruiterMeta();
      applyTaskPageCompaction();
      handleIdleRestoreLogin();
    }, Number(delay||120));
  }
  function observeDom(){
    applyLogoFallbacks(document);
    queueDomRefresh(0);
    if(domObserver) return;
    domObserver = new MutationObserver(function(records){
      let relevant=false;
      records.forEach(function(record){
        Array.prototype.forEach.call(record.addedNodes || [], function(node){
          if(!node || node.nodeType !== 1) return;
          applyLogoFallbacks(node);
          if((node.matches&&node.matches('[data-field="recruiter_code"],.task-summary-grid,.table-title,form,.candidate-detail-full-panel'))||
             (node.querySelector&&node.querySelector('[data-field="recruiter_code"],.task-summary-grid,.table-title,form,.candidate-detail-full-panel'))) relevant=true;
        });
      });
      if(relevant)queueDomRefresh(120);
    });
    domObserver.observe(document.getElementById('root') || document.body || document.documentElement, { childList:true, subtree:true });
  }

  // CC26_745: focus/visibility and every route click must not cause extra database reads.
  // They only refresh local UI. The consolidated reminder fetch is low-frequency below
  // and user data writes can request one targeted refresh.
  document.addEventListener('visibilitychange', function(){ if(!document.hidden){ applyTaskPageCompaction(); queueDomRefresh(0); renderReminderConfigs(reminderSnapshotConfigs); } });
  window.addEventListener('focus', function(){ applyTaskPageCompaction(); queueDomRefresh(0); renderReminderConfigs(reminderSnapshotConfigs); }, {passive:true});
  window.addEventListener('popstate', function(){ setTimeout(function(){ applyTaskPageCompaction(); queueDomRefresh(0); renderReminderConfigs(reminderSnapshotConfigs); }, 180); });
  ['pushState','replaceState'].forEach(function(method){
    const orig = history[method];
    if(typeof orig !== 'function') return;
    history[method] = function(){ const res = orig.apply(this, arguments); setTimeout(function(){ applyTaskPageCompaction(); queueDomRefresh(0); renderReminderConfigs(reminderSnapshotConfigs); }, 120); return res; };
  });
  window.addEventListener('career-crox-data-written', function(event){
    const path=String(event && event.detail && event.detail.path || '');
    if(/\/api\/(candidates|submissions|interviews|tasks|followups|approvals)/.test(path)){
      try{ reminderSyncChannel&&reminderSyncChannel.postMessage({type:'write',path:path,at:Date.now()}); }catch(_e){}
      lastLocalReminderWritePath=path;
      lastLocalReminderWriteAt=Date.now();
      forceFreshReminder=true;
      if(dataWriteRefreshTimer)clearTimeout(dataWriteRefreshTimer);
      dataWriteRefreshTimer=setTimeout(function(){dataWriteRefreshTimer=0;loadAllReminders();},300);
    }
  });

  window.__CC736_REFERENCE_LOOK_DIRECT_REMINDER_OWNER__ = true;
  setTimeout(function(){ document.querySelectorAll('.cc730-submission-reminder').forEach(function(el){ try{el.remove();}catch(_e){} }); observeDom(); scheduleReminderClock(); }, 900);
})();
(function(){
  'use strict';
  if(window.__CC753_SUBMIT_DRAFT_GUARD__) return;
  window.__CC753_SUBMIT_DRAFT_GUARD__=true;

  var NOTE_FLAG='cc753_note_required';
  var autoSaveTimer=0;
  var enhanceRaf=0;
  var internalStatusChange=false;
  var saveRetry=0;

  function isCandidatePage(){ return /^\/candidate\/(?:new|[^/?#]+)(?:\/|$)/i.test(String(location.pathname||'')); }
  function isNewCandidate(){ return /^\/candidate\/new(?:\/|$)/i.test(String(location.pathname||'')); }
  function panel(){ return document.querySelector('.candidate-detail-full-panel'); }
  function notesPanel(){ return document.querySelector('.candidate-notes-chat-panel'); }
  function noteInput(){ return notesPanel()?.querySelector('textarea.candidate-notes-main-textarea, textarea'); }
  function submitButton(){ return document.querySelector('.candidate-submit-btn'); }
  function saveButton(){ return document.querySelector('.candidate-save-btn'); }
  function hasSavedNote(){ return !!document.querySelector('.candidate-notes-thread-list .candidate-note-thread, .candidate-notes-thread-list .candidate-note-bubble'); }
  function hasTypedNote(){ return !!String(noteInput()?.value||'').trim(); }

  function setNativeSelect(select,value){
    if(!select) return;
    var desc=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');
    try{ desc&&desc.set ? desc.set.call(select,value) : (select.value=value); }catch(_e){ select.value=value; }
    select.dispatchEvent(new Event('change',{bubbles:true}));
  }

  function markInProgress(){
    if(internalStatusChange) return false;
    var wrap=document.querySelector('[data-field="status"]');
    var select=wrap&&wrap.querySelector('select');
    if(select && String(select.value||'').trim().toLowerCase()==='draft'){
      internalStatusChange=true;
      setNativeSelect(select,'In - Progress');
      internalStatusChange=false;
      return true;
    }
    return false;
  }

  function showNoteRequired(){
    try{ sessionStorage.setItem(NOTE_FLAG,'1'); }catch(_e){}
    var np=notesPanel(); if(!np) return;
    np.classList.add('note-required-error');
    var banner=np.querySelector('.cc753-note-required-banner');
    if(!banner){
      banner=document.createElement('div');
      banner.className='cc753-note-required-banner';
      banner.setAttribute('role','alert');
      banner.textContent='Add a note before submission describing the latest candidate interaction or update. Profile details are already saved; add the note, then submit again.';
      var heading=np.querySelector('.panel-heading-row');
      if(heading&&heading.nextSibling) np.insertBefore(banner,heading.nextSibling); else np.prepend(banner);
    }
    try{ np.scrollIntoView({behavior:'smooth',block:'center'}); }catch(_e){ try{np.scrollIntoView();}catch(__e){} }
    setTimeout(function(){ try{ noteInput()?.focus({preventScroll:true}); }catch(_e){ try{noteInput()?.focus();}catch(__e){} } },30);
  }

  function clearNoteRequired(){
    try{ sessionStorage.removeItem(NOTE_FLAG); }catch(_e){}
    var np=notesPanel();
    if(np){ np.classList.remove('note-required-error'); np.querySelector('.cc753-note-required-banner')?.remove(); }
  }

  function persistDomSafetySnapshot(){
    if(!isCandidatePage()) return;
    var root=panel(); if(!root) return;
    var fields={};
    root.querySelectorAll('[data-field]').forEach(function(w){
      var key=w.getAttribute('data-field'); if(!key||key==='master_notes') return;
      var ctl=w.querySelector('input:not([type="hidden"]),select,textarea');
      if(ctl) fields[key]=String(ctl.value||'');
      else {
        var active=w.querySelector('button.choice-chip.active');
        if(active) fields[key]=String(active.textContent||'').trim();
      }
    });
    try{ localStorage.setItem('careerCroxCC753DomSafetyDraft',JSON.stringify({at:Date.now(),path:location.pathname,fields:fields})); }catch(_e){}
  }

  function clickSaveForProtection(){
    persistDomSafetySnapshot();
    var statusChanged=markInProgress();
    var btn=saveButton();
    if(btn && !btn.disabled){
      saveRetry=0;
      if(statusChanged){ setTimeout(function(){ var latest=saveButton(); if(latest&&!latest.disabled) latest.click(); },0); }
      else btn.click();
      return true;
    }
    if(saveRetry<2){ saveRetry+=1; setTimeout(clickSaveForProtection,700); }
    return false;
  }

  function scheduleNewCandidateSave(){
    if(!isNewCandidate()) return;
    persistDomSafetySnapshot();
    if(autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer=setTimeout(function(){
      autoSaveTimer=0;
      if(!isNewCandidate()) return;
      clickSaveForProtection();
    },1100);
  }

  function enhanceStatus(){
    var wrap=document.querySelector('[data-field="status"]'); if(!wrap) return;
    var select=wrap.querySelector('select');
    if(!select || wrap.querySelector('.cc753-status-options')) return;
    var row=document.createElement('div'); row.className='cc753-status-options';
    Array.prototype.slice.call(select.options||[]).forEach(function(opt){
      var value=String(opt.value||'').trim(); if(!value) return;
      var b=document.createElement('button'); b.type='button'; b.className='cc753-status-chip'; b.textContent=String(opt.textContent||value).trim(); b.dataset.value=value;
      if(String(select.value)===value) b.classList.add('active');
      b.addEventListener('click',function(){
        setNativeSelect(select,value);
        row.querySelectorAll('.cc753-status-chip').forEach(function(x){x.classList.toggle('active',x.dataset.value===String(select.value));});
      });
      row.appendChild(b);
    });
    select.classList.add('cc753-status-native-hidden');
    select.insertAdjacentElement('afterend',row);
    select.addEventListener('change',function(){ row.querySelectorAll('.cc753-status-chip').forEach(function(x){x.classList.toggle('active',x.dataset.value===String(select.value));}); });
  }

  function enhance(){
    enhanceRaf=0;
    if(!isCandidatePage()) return;
    enhanceStatus();
    var flagged=false; try{ flagged=sessionStorage.getItem(NOTE_FLAG)==='1'; }catch(_e){}
    if(flagged && !hasTypedNote() && !hasSavedNote()) showNoteRequired();
    else if(flagged && (hasTypedNote()||hasSavedNote())) clearNoteRequired();
  }
  function queueEnhance(){ if(enhanceRaf) return; enhanceRaf=requestAnimationFrame(enhance); }

  document.addEventListener('input',function(e){
    if(!isCandidatePage()||!panel()?.contains(e.target)) return;
    if(e.target===noteInput()){
      if(String(e.target.value||'').trim()) clearNoteRequired();
      return;
    }
    var field=e.target.closest&&e.target.closest('[data-field]');
    if(!field||field.getAttribute('data-field')==='master_notes') return;
    // React owns field state/status/autosave. Never mutate another controlled field
    // before React receives this input event; doing so can swallow the first digit.
    setTimeout(persistDomSafetySnapshot,0);
  },false);

  document.addEventListener('change',function(e){
    if(!isCandidatePage()||!panel()?.contains(e.target)||internalStatusChange) return;
    var field=e.target.closest&&e.target.closest('[data-field]');
    if(!field||field.getAttribute('data-field')==='master_notes') return;
    setTimeout(persistDomSafetySnapshot,0);
  },false);

  document.addEventListener('click',function(e){
    var submit=e.target&&e.target.closest&&e.target.closest('.candidate-submit-btn');
    if(submit && isCandidatePage() && !hasTypedNote() && !hasSavedNote()){
      e.preventDefault(); e.stopPropagation(); if(e.stopImmediatePropagation)e.stopImmediatePropagation();
      showNoteRequired();
      clickSaveForProtection();
      return false;
    }
    var add=e.target&&e.target.closest&&e.target.closest('.candidate-notes-chat-panel .add-profile-btn');
    if(add && hasTypedNote()) clearNoteRequired();
  },true);

  var observer=new MutationObserver(queueEnhance);
  function start(){ var root=document.getElementById('root')||document.body; if(root) observer.observe(root,{childList:true,subtree:true}); queueEnhance(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
  window.addEventListener('popstate',queueEnhance);
  window.addEventListener('career-crox-react-ready',queueEnhance);
})();
