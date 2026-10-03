/* removed superseded runtime */

;(() => {
  const VERSION = 'CC26_384_GITHUB_BACKEND_UPLOAD_SAFE_SPLIT_FIX';
  if (window.__CC379_CONSOLIDATED_RUNTIME__ === VERSION) return;
  window.__CC379_CONSOLIDATED_RUNTIME__ = VERSION;

  const originalFetch = window.fetch.bind(window);
  const STYLE_ID = 'cc379-runtime-style';
  const BACKLOG_KEY = 'cc379_due_reminder_backlog';
  const LEGACY_BACKLOG_KEY = 'cc377_due_reminder_backlog';
  const DISMISSED_KEY = 'cc379_dismissed_reminder_keys';
  const SNOOZE_KEY = 'cc379_snoozed_reminder_map';
  const TIMER_KEY = 'cc379_stable_timer_state';
  const LEGACY_TIMER_KEY = 'cc376_attendance_timer_state';
  const REMINDER_CHECK_MS = 15 * 60 * 1000; // Local reminder clock continues without repeated database reads.
  const ATTENDANCE_CHECK_MS = 15 * 60 * 1000; // CC26_399: duplicate legacy attendance refresh reduced; React attendance tracking remains active
  const MAX_BACKLOG_AGE_MS = 14 * 24 * 60 * 60 * 1000;
  const DISMISSED_TTL_MS = 20 * 60 * 1000;
  let lastReminderCheckAt = 0;
  let reminderInFlight = null;
  let refreshAfterFlight = false;
  let reminderWriteTimer = null;
  let lastReminderRenderKey = "";
  let lastAttendanceCheckAt = 0;
  let reminderFetchStatus = 'No manual refresh in this session.';

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .cc361-reminder-panel,.cc362-reminder-dock,.cc364-reminder-stack,.cc365-reminder-stack,.cc366-reminder-stack,.cc367-reminder-rail,.cc376-reminder-rail,.cc377-reminder-rail,.cc378-reminder-deck{display:none!important}
      .cc379-reminder-deck{position:fixed;right:18px;bottom:18px;z-index:101300;width:min(342px,calc(100vw - 34px));font-family:Inter,system-ui,Segoe UI,Arial,sans-serif;pointer-events:none}
      .cc379-reminder-card{position:relative;overflow:hidden;border-radius:24px;padding:14px;color:#fff;border:1px solid rgba(255,255,255,.42);box-shadow:0 24px 65px rgba(15,23,42,.30);pointer-events:auto!important;min-height:158px}
      .cc379-reminder-card::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 88% 12%,rgba(255,255,255,.34),transparent 31%),linear-gradient(135deg,rgba(255,255,255,.14),rgba(255,255,255,0));pointer-events:none}
      .cc379-reminder-card.submission{background:linear-gradient(135deg,#7c3aed,#3b82f6)}
      .cc379-reminder-card.interview{background:linear-gradient(135deg,#fb923c,#ec4899)}
      .cc379-reminder-card.task{background:linear-gradient(135deg,#14b8a6,#22c55e)}
      .cc379-reminder-card.followups{background:linear-gradient(135deg,#f59e0b,#f97316)}
      .cc379-reminder-card.break{background:linear-gradient(135deg,#f97316,#ef4444)}
      .cc379-reminder-card.idle{background:linear-gradient(135deg,#6366f1,#a855f7)}
      .cc379-reminder-card.report{background:linear-gradient(135deg,#06b6d4,#2563eb)}
      .cc379-reminder-card.notification{background:linear-gradient(135deg,#ef4444,#db2777)}
      .cc379-reminder-card.generic{background:linear-gradient(135deg,#64748b,#334155)}
      .cc379-reminder-top{position:relative;display:flex;align-items:center;justify-content:space-between;gap:10px}.cc379-reminder-label{display:inline-flex;padding:6px 9px;border-radius:999px;background:rgba(255,255,255,.22);font-size:9px;font-weight:1000;text-transform:uppercase;letter-spacing:.06em}.cc379-reminder-count{display:inline-flex;padding:6px 9px;border-radius:999px;background:rgba(255,255,255,.92);color:#17345d;font-size:10px;font-weight:1000}
      .cc379-reminder-title{position:relative;margin-top:10px;font-size:16px;line-height:1.15;font-weight:1000;color:#fff;max-height:40px;overflow:hidden}.cc379-reminder-notes{position:relative;margin-top:10px;padding:10px;border-radius:15px;background:rgba(255,255,255,.92);color:#17233b;font-size:11px;line-height:1.38;font-weight:850;min-height:46px;max-height:72px;overflow:auto}.cc379-reminder-bottom{position:relative;display:flex;align-items:center;gap:8px;margin-top:10px}.cc379-reminder-time{flex:1;height:30px;border-radius:999px;background:rgba(255,255,255,.88);color:#17345d;font-size:10px;font-weight:1000;display:flex;align-items:center;justify-content:center;padding:0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cc379-reminder-open,.cc379-reminder-snooze,.cc379-reminder-close{height:32px;border:0;border-radius:12px;padding:0 11px;background:rgba(255,255,255,.94);color:#17345d;font-size:10.5px;font-weight:1000;cursor:pointer}.cc379-reminder-snooze{background:rgba(255,255,255,.24);color:#fff}.cc379-reminder-close{width:32px;padding:0;background:rgba(255,255,255,.20);color:#fff}
      .cc379-work-timer-pill{height:44px;min-width:188px;padding:0 15px;border-radius:18px;background:linear-gradient(135deg,#ffffff,#eff6ff 50%,#fff7ed);border:1px solid rgba(96,165,250,.38);box-shadow:0 14px 34px rgba(37,99,235,.15);display:flex!important;align-items:center;gap:11px;color:#10233f;position:relative;overflow:hidden}
      .cc379-work-timer-pill::after{content:"";position:absolute;right:-18px;bottom:-28px;width:86px;height:86px;border-radius:999px;background:rgba(59,130,246,.11)}
      .cc379-work-timer-dot{width:10px;height:10px;border-radius:999px;background:#22c55e;box-shadow:0 0 0 5px rgba(34,197,94,.13);position:relative;z-index:1}.cc379-work-timer-pill.break .cc379-work-timer-dot{background:#f97316;box-shadow:0 0 0 5px rgba(249,115,22,.13)}
      .cc379-work-timer-text{position:relative;z-index:1}.cc379-work-timer-label{font-size:9px;font-weight:1000;text-transform:uppercase;letter-spacing:.09em;color:#64748b;line-height:1}.cc379-work-timer-value{font-size:18px;font-weight:1000;letter-spacing:.02em;color:#10233f;line-height:1.08;margin-top:2px}.cc379-work-timer-sub{font-size:9.5px;font-weight:900;color:#64748b;line-height:1;margin-top:2px}
      .cc376-work-timer-pill,.cc378-work-timer-pill{display:none!important}
      .premium-minute-chip[data-cc379-five]{background:linear-gradient(135deg,#16a34a,#22c55e)!important;color:#fff!important}
      @media(max-width:760px){.cc379-reminder-deck{right:10px;bottom:12px;width:calc(100vw - 20px)}.cc379-work-timer-pill{min-width:150px;height:42px}.cc379-work-timer-value{font-size:16px}}
      /* CC26_611: Reminders is a local list, not a blind network refresh button. */
      #cc611-reminders-dialog[hidden]{display:none!important}
      #cc611-reminders-dialog{position:fixed;inset:0;z-index:110200;display:grid;place-items:center;padding:16px;font-family:'Plus Jakarta Sans',system-ui,'Segoe UI',sans-serif}
      .cc611-r-backdrop{position:absolute;inset:0;background:rgba(18,28,51,.45);backdrop-filter:blur(8px)}
      .cc611-r-modal{position:relative;display:flex;flex-direction:column;max-height:min(82vh,740px);width:min(660px,100%);overflow:hidden;border-radius:26px;background:linear-gradient(145deg,#fff,#f7f9ff 65%,#effdf5);box-shadow:0 26px 95px rgba(20,34,75,.34);border:1px solid rgba(255,255,255,.95);color:#14213e}
      .cc611-r-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:22px 22px 15px;border-bottom:1px solid #e8eef8}
      .cc611-r-kicker{font-size:11px;color:#208a65;font-weight:900;letter-spacing:.12em;text-transform:uppercase}
      .cc611-r-title{margin:5px 0 6px;font-size:27px;line-height:1.15;font-weight:900;color:#172849}
      .cc611-r-desc{margin:0;color:#526585;font-size:13px;line-height:1.5;font-weight:600}
      .cc611-r-close{border:1px solid #dce7f4;background:#fff;color:#22385b;cursor:pointer;border-radius:13px;min-width:42px;height:42px;font-size:24px;font-weight:700}
      .cc611-r-controls{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:14px 22px}
      .cc611-r-count{font-size:13px;font-weight:850;color:#2d4569}
      .cc611-r-refresh{border:1px solid #9cdabe;background:linear-gradient(135deg,#ddfbe9,#e8f9ff);color:#176347;cursor:pointer;border-radius:13px;min-height:39px;padding:8px 16px;font-size:13px;font-weight:900}
      .cc611-r-refresh:hover{background:linear-gradient(135deg,#a4f1c8,#cff9dc)}
      .cc611-r-refresh:disabled{opacity:.6;cursor:wait}
      .cc611-r-status{margin:0;padding:0 22px 10px;font-size:12px;min-height:27px;color:#647592}
      .cc611-r-list{overflow:auto;min-height:110px;padding:2px 18px 18px;overscroll-behavior:contain}
      .cc611-r-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;padding:35px 16px;border:1px dashed #c5d9ed;border-radius:18px;background:rgba(255,255,255,.8);color:#526585}
      .cc611-r-empty strong{font-size:18px;color:#172849}
      .cc611-r-card{background:#fff;border:1px solid #e4edf8;border-radius:17px;padding:15px;margin:8px 0;box-shadow:0 8px 19px rgba(30,64,125,.05)}
      .cc611-r-card-top{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px}
      .cc611-r-type{display:inline-flex;border-radius:100px;padding:5px 10px;background:linear-gradient(135deg,#e5f7ff,#e9e9ff);font-size:10px;font-weight:900;letter-spacing:.04em;color:#284d87}
      .cc611-r-type.task{background:#dcfce7;color:#166534}.cc611-r-type.interview{background:#ffedd5;color:#9a3412}.cc611-r-type.followups{background:#fef9c3;color:#854d0e}.cc611-r-type.submission{background:#f3e8ff;color:#6b21a8}
      .cc611-r-when{font-size:11px;font-weight:800;color:#657894}
      .cc611-r-card-title{font-size:16px;line-height:1.4;font-weight:900;color:#172849;margin-bottom:5px;overflow-wrap:anywhere}
      .cc611-r-card-note{font-size:12px;line-height:1.5;color:#435677;white-space:pre-wrap;overflow-wrap:anywhere;max-height:110px;overflow:auto}
      .cc611-r-card-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:13px}
      .cc611-r-action{border:none;border-radius:10px;min-height:34px;padding:7px 12px;font-size:12px;font-weight:850;cursor:pointer;background:#e8effa;color:#2b4675}
      .cc611-r-action.open{background:linear-gradient(135deg,#d1fae5,#abedcb);color:#11603c}
      .cc611-r-action.snooze{background:#fff0d6;color:#805008}
      .cc611-r-footer{padding:10px 22px 17px;border-top:1px solid #ebeff9;color:#69809e;font-size:11px;font-weight:700}
      @media(max-width:560px){.cc611-r-modal{max-height:90vh;border-radius:19px}.cc611-r-head{padding:17px}.cc611-r-title{font-size:23px}.cc611-r-controls{padding:12px 17px}.cc611-r-list{padding:2px 12px 12px}}

    `;
    document.head.appendChild(style);
  }

  function nowMs() { return Date.now(); }
  function parseMs(value) { const t = Date.parse(String(value || '')); return Number.isFinite(t) ? t : 0; }
  function pad(n) { return String(Math.max(0, Math.floor(n))).padStart(2, '0'); }
  function fmt(seconds) { const s = Math.max(0, Math.floor(seconds || 0)); return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`; }
  function safeText(value) { return String(value || '').replace(/[<>&]/g, '').replace(/\s+/g, ' ').trim(); }
  function readJson(key, fallback) { try { const value = JSON.parse(localStorage.getItem(key) || ''); return value ?? fallback; } catch { return fallback; } }
  function writeJson(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
  function readBacklog() {
    const latest = readJson(BACKLOG_KEY, []);
    return Array.isArray(latest) ? latest : [];
  }
  function saveBacklog(rows) {
    writeJson(BACKLOG_KEY, rows);
    if (typeof renderReminderDialog === 'function') renderReminderDialog();
    // Compact reminder UI can consume the same local snapshot without a second request.
    try { window.dispatchEvent(new Event('career-crox-reminder-backlog-updated')); } catch {}
  }

  // CC26_611: List opens from local cache without a database/API read.
  // Refresh Now is the only network operation initiated by this dialog.
  function ensureReminderDialog() {
    let dialog = document.getElementById('cc611-reminders-dialog');
    if (dialog) return dialog;
    dialog = document.createElement('div');
    dialog.id = 'cc611-reminders-dialog';
    dialog.hidden = true;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'cc611-reminders-title');
    dialog.innerHTML = `<div class="cc611-r-backdrop" data-reminder-close></div>
      <section class="cc611-r-modal" aria-label="Reminders list">
        <header class="cc611-r-head"><div><div class="cc611-r-kicker">Your personal queue</div>
          <h2 class="cc611-r-title" id="cc611-reminders-title">Reminders</h2>
          <p class="cc611-r-desc">Your saved follow-ups, interviews, submissions and tasks.</p></div>
          <button type="button" class="cc611-r-close" data-reminder-close aria-label="Close reminders">×</button></header>
        <div class="cc611-r-controls"><span id="cc611-reminder-count" class="cc611-r-count">Saved reminders</span>
          <button type="button" class="cc611-r-refresh" id="cc611-refresh-now">↻ Refresh Now</button></div>
        <p id="cc611-reminder-status" class="cc611-r-status" role="status">Opening a saved list uses no network request.</p>
        <div class="cc611-r-list" id="cc611-reminder-list"></div>
        <footer class="cc611-r-footer">Only Refresh Now fetches updated reminders. Closing this window does not dismiss them.</footer>
      </section>`;
    dialog.addEventListener('click', (event) => {
      if (event.target.closest('[data-reminder-close]')) closeReminderDialog();
    });
    document.body.appendChild(dialog);
    dialog.querySelector('#cc611-refresh-now').addEventListener('click', async () => {
      if (window.__CC602_NETWORK_PAUSED__ || location.pathname.includes('/login')) return;
      const refresh = dialog.querySelector('#cc611-refresh-now');
      if (refresh.disabled) return;
      refresh.disabled = true;
      const status = dialog.querySelector('#cc611-reminder-status');
      status.textContent = 'Checking for updated reminders…';
      try {
        // Reuse the existing in-flight promise: never queue a second expensive table summary.
        if (reminderInFlight) await reminderInFlight;
        else await refreshReminders(true);
        status.textContent = reminderFetchStatus || 'Check finished. Saved reminders are shown below.';
      } finally {
        refresh.disabled = false;
        renderReminderDialog();
      }
    });
    return dialog;
  }
  function closeReminderDialog() {
    const dialog = document.getElementById('cc611-reminders-dialog');
    if (dialog) dialog.hidden = true;
    const btn = document.getElementById('cc603-reminders-refresh');
    if (btn) {btn.setAttribute('aria-expanded', 'false');try{btn.focus({preventScroll:true});}catch{}}
  }
  function reminderSafePath(path) {
    const val = String(path || '/tasks').trim();
    return val.startsWith('/') && !val.startsWith('//') && !val.includes('\\') ? val : '/tasks';
  }
  function renderReminderDialog() {
    const dialog = document.getElementById('cc611-reminders-dialog');
    if (!dialog || dialog.hidden) return;
    const list = dialog.querySelector('#cc611-reminder-list');
    const dismissed = readDismissedMap(), snoozed = readSnoozedMap();
    const all = readBacklog().filter((item) => item && !dismissed[keyOf(item)]);
    all.sort((a,b)=>dueMs(a)-dueMs(b));
    const pending = all.filter(item => !(Number(snoozed[keyOf(item)] || 0) > nowMs()));
    const paused = all.length - pending.length;
    dialog.querySelector('#cc611-reminder-count').textContent = `${pending.length} reminders${paused ? ` · ${paused} snoozed` : ''}`;
    list.replaceChildren();
    if (!all.length) {
      const box = document.createElement('div');box.className='cc611-r-empty';
      const title=document.createElement('strong');title.textContent='No saved reminders';
      const text=document.createElement('span');text.textContent='Select Refresh Now to check for new reminders. Opening this list needs no internet request.';
      box.append(title,text);list.appendChild(box);return;
    }
    for (const item of all.slice(0, 100)) {
      const key = keyOf(item), type = typeFor(item);
      const snoozeUntil=Number(snoozed[key] || 0), isSnoozed=snoozeUntil > nowMs();
      const card = document.createElement('article'); card.className='cc611-r-card';
      const top=document.createElement('div');top.className='cc611-r-card-top';
      const badge=document.createElement('span');badge.className='cc611-r-type '+type;badge.textContent=labelFor(type);
      const when=document.createElement('span');when.className='cc611-r-when';when.textContent = isSnoozed ? 'Snoozed until '+new Date(snoozeUntil).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : (dueMs(item) <= nowMs() ? 'Due · ' : 'Upcoming · ')+formatDue(item);
      top.append(badge,when);
      const title=document.createElement('div');title.className='cc611-r-card-title';title.textContent=item.title||labelFor(type);
      const notes=document.createElement('div');notes.className='cc611-r-card-note';notes.textContent=item.message||'No additional notes.';
      const actions=document.createElement('div');actions.className='cc611-r-card-actions';
      const open=document.createElement('button');open.type='button';open.className='cc611-r-action open';open.textContent='Open';
      open.onclick=()=>{const path=reminderSafePath(item.open_path);closeReminderDialog();window.location.assign(path);};
      const snoozeButton=document.createElement('button');snoozeButton.type='button';snoozeButton.className='cc611-r-action snooze';snoozeButton.textContent=isSnoozed?'Snoozed':'Snooze 5m';snoozeButton.disabled=isSnoozed;
      snoozeButton.onclick=()=>{snooze(key);renderReminderDialog();};
      const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='cc611-r-action';dismiss.textContent='Dismiss';
      dismiss.onclick=()=>{softDismiss(key);renderReminderDialog();};
      actions.append(open,snoozeButton,dismiss);card.append(top,title,notes,actions);list.appendChild(card);
    }
    if(all.length > 100){const more=document.createElement('p');more.className='cc611-r-status';more.textContent=`${all.length-100} more reminders saved. Narrow your queue by completing earlier items.`;list.appendChild(more);}
  }
  function openReminderDialog() {
    if (window.__CC602_NETWORK_PAUSED__ || location.pathname.includes('/login')) return;
    const dialog = ensureReminderDialog();dialog.hidden=false;
    document.getElementById('cc603-reminders-refresh')?.setAttribute('aria-expanded','true');
    dialog.querySelector('#cc611-reminder-status').textContent='Opening a saved list uses no network request. Click Refresh Now only when you need new data.';
    renderReminderDialog();
    try { dialog.querySelector('#cc611-refresh-now').focus({preventScroll:true}); }catch{}
  }
  document.addEventListener('keydown', (event) => {if(event.key==='Escape' && !document.getElementById('cc611-reminders-dialog')?.hidden)closeReminderDialog();});

  function readDismissedMap() { const obj = readJson(DISMISSED_KEY, {}); return obj && typeof obj === 'object' ? obj : {}; }
  function saveDismissedMap(obj) { writeJson(DISMISSED_KEY, obj); }
  function readSnoozedMap() { const obj = readJson(SNOOZE_KEY, {}); return obj && typeof obj === 'object' ? obj : {}; }
  function saveSnoozedMap(obj) { writeJson(SNOOZE_KEY, obj); }
  function keyOf(item = {}) {
    return safeText(item.key || `${item.type || 'reminder'}:${item.candidate_id || item.task_id || item.notification_id || item.submission_id || item.interview_id || item.title || ''}`);
  }
  function dueMs(item = {}) { return parseMs(item.due_at || item.created_at || item.updated_at) || nowMs(); }
  function cleanDismissed() {
    const obj = readDismissedMap();
    const next = {};
    Object.entries(obj).forEach(([key, at]) => { if (nowMs() - Number(at || 0) < DISMISSED_TTL_MS) next[key] = at; });
    saveDismissedMap(next);
    return next;
  }
  function isDue(item = {}) {
    const key = keyOf(item);
    const snoozeUntil = Number(readSnoozedMap()[key] || 0);
    return dueMs(item) <= nowMs() && (!snoozeUntil || snoozeUntil <= nowMs());
  }
  function typeFor(item = {}) {
    const text = `${item.type || ''} ${item.key || ''} ${item.title || ''} ${item.message || ''}`.toLowerCase();
    if (text.includes('submission')) return 'submission';
    if (text.includes('interview')) return 'interview';
    if (text.includes('task')) return 'task';
    if (text.includes('follow')) return 'followups';
    if (text.includes('break')) return 'break';
    if (text.includes('idle') || text.includes('activity')) return 'idle';
    if (text.includes('notification')) return 'notification';
    if (text.includes('30') || text.includes('semi') || text.includes('report')) return 'report';
    return 'generic';
  }
  function labelFor(type) {
    return ({submission:'Submission Reminder', interview:'Interview Reminder', task:'Task Reminder', followups:'Follow-up Reminder', break:'Break Reminder', idle:'Activity Reminder', report:'30-Min Report', notification:'Notification', generic:'CRM Reminder'})[type] || 'CRM Reminder';
  }
  function mergeBacklog(actions = []) {
    const map = new Map();
    (Array.isArray(actions) ? actions : []).forEach((item) => {
      const key = keyOf(item);
      if (!key) return;
      map.set(key, { ...item, key });
    });
    const rows = Array.from(map.values()).sort((a, b) => dueMs(a) - dueMs(b));
    saveBacklog(rows);
    return rows;
  }
  function dueRows() {
    const dismissed = cleanDismissed();
    return readBacklog()
      .filter((item) => !dismissed[keyOf(item)])
      .filter(isDue)
      .sort((a, b) => dueMs(a) - dueMs(b));
  }
  function formatDue(item = {}) {
    try { return new Date(dueMs(item)).toLocaleString([], { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }); } catch { return 'Due now'; }
  }
  function ensureDeck() {
    installStyle();
    document.querySelectorAll('.cc377-reminder-rail,.cc376-reminder-rail,.cc378-reminder-deck,.cc361-reminder-panel,.cc362-reminder-dock').forEach((el) => el.remove());
    let deck = document.querySelector('.cc379-reminder-deck');
    if (!deck) {
      deck = document.createElement('div');
      deck.className = 'cc379-reminder-deck';
      document.body.appendChild(deck);
    }
    return deck;
  }
  function renderSingleReminder() {
    if (window.__CC730_DIRECT_REMINDER_OWNER__) { const old=document.querySelector('.cc379-reminder-deck'); if(old) old.innerHTML=''; return; }
    if (location.pathname.includes('/login')) return;
    const deck = ensureDeck();
    const rows = dueRows();
    if (!rows.length) { deck.innerHTML = ''; return; }
    const item = rows[0];
    const type = typeFor(item);
    const key = keyOf(item);
    const title = safeText(String(item.title || labelFor(type)).replace(/^Submission Reminder:\s*/i, ''));
    const msg = safeText(item.message || 'Reminder needs action.');
    const open = safeText(item.open_path || '/reports');
    deck.innerHTML = `<div class="cc379-reminder-card ${type}" data-key="${key}">
      <div class="cc379-reminder-top"><div class="cc379-reminder-label">${labelFor(type)}</div><div class="cc379-reminder-count">1 of ${rows.length} • ${rows.length} pending</div></div>
      <div class="cc379-reminder-title">${title}</div>
      <div class="cc379-reminder-notes"><b>LAST NOTES</b><br>${msg}</div>
      <div class="cc379-reminder-bottom"><div class="cc379-reminder-time">Due ${formatDue(item)}</div><button type="button" class="cc379-reminder-open" data-open="${open}">Open</button><button type="button" class="cc379-reminder-snooze">Snooze</button><button type="button" class="cc379-reminder-close">×</button></div>
    </div>`;
  }
  function softDismiss(key) {
    const dismissed = cleanDismissed();
    dismissed[key] = nowMs();
    saveDismissedMap(dismissed);
    saveBacklog(readBacklog().filter((item) => keyOf(item) !== key));
    renderSingleReminder();
  }
  function snooze(key) {
    const obj = readSnoozedMap();
    obj[key] = nowMs() + 5 * 60 * 1000;
    saveSnoozedMap(obj);
    renderSingleReminder();
  }

  document.addEventListener('click', (event) => {
    const card = event.target.closest && event.target.closest('.cc379-reminder-card');
    if (!card) return;
    const key = card.getAttribute('data-key') || '';
    if (event.target.closest('.cc379-reminder-open')) {
      event.preventDefault();
      event.stopPropagation();
      const open = event.target.closest('.cc379-reminder-open').getAttribute('data-open') || '/reports';
      window.open(open, '_blank', 'noopener,noreferrer');
      softDismiss(key);
      return;
    }
    if (event.target.closest('.cc379-reminder-snooze')) {
      event.preventDefault();
      event.stopPropagation();
      snooze(key);
      return;
    }
    if (event.target.closest('.cc379-reminder-close')) {
      event.preventDefault();
      event.stopPropagation();
      softDismiss(key);
    }
  }, true);

  async function refreshReminders(force = false) {
    if (window.__CC730_DIRECT_REMINDER_OWNER__) { if (typeof window.__CC730_REFRESH_REMINDERS__ === 'function') return window.__CC730_REFRESH_REMINDERS__(force); return; }
    if (location.pathname.includes('/login')) return;
    // One flight for simultaneous writes and refreshes; browser popup clock is fully local.
    if (reminderInFlight) {
      if (force) refreshAfterFlight = true; // Save happened while a snapshot was loading.
      return reminderInFlight;
    }
    if (!force && lastReminderCheckAt && nowMs() - lastReminderCheckAt < REMINDER_CHECK_MS - 1000) {
      renderSingleReminder();
      return;
    }
    lastReminderCheckAt = nowMs();
    reminderInFlight = (async () => {
      try {
        const res = await originalFetch('/api/reports/reminder-summary', { credentials:'include', cache:'no-store', headers:{Accept:'application/json','X-Career-Crox-Background':'1'} });
        if (res.ok) {
          const payload = await res.json().catch(() => null);
          if (payload?.ok) { mergeBacklog(Array.isArray(payload.actions) ? payload.actions : []);reminderFetchStatus='Updated just now.'; }
          else reminderFetchStatus='Could not update. Showing last saved reminders.';
        } else if (res.status === 401 || res.status === 403) {
          // A previous employee's reminder list must never show after logout/account switch.
          saveBacklog([]);
          reminderFetchStatus='Sign in again to check reminders.';
        } else reminderFetchStatus='Could not refresh right now. Saved reminders are still visible.';
      } catch {reminderFetchStatus='Connection unavailable. Showing last saved reminders.';} // Keep the last known reminders visible when offline.
      finally {
        reminderInFlight = null;
        renderSingleReminder();
        if (refreshAfterFlight) {
          refreshAfterFlight = false;
          setTimeout(() => refreshReminders(true), 0);
        }
      }
    })();
    return reminderInFlight;
  }

  function readTimer() { return { ...readJson(LEGACY_TIMER_KEY, {}), ...readJson(TIMER_KEY, {}) }; }
  function writeTimer(patch) { writeJson(TIMER_KEY, { ...readTimer(), ...patch, updated_at: nowMs() }); }
  function timerState() {
    const s = readTimer();
    const start = parseMs(s.work_started_at || s.joined_at);
    if (!start) {
      const fallbackStart = s.local_work_started_at || new Date().toISOString();
      writeTimer({ local_work_started_at: fallbackStart, work_started_at: fallbackStart, total_break_seconds: Number(s.total_break_seconds || 0) || 0, is_on_break: s.is_on_break || '0' });
      return readTimer();
    }
    return s;
  }
  function timerSeconds(s = timerState()) {
    const start = parseMs(s.work_started_at || s.local_work_started_at || s.joined_at);
    if (!start) return 0;
    const totalBreak = Math.max(0, Number(s.total_break_seconds || 0) || 0);
    if (String(s.is_on_break || '0') === '1') return Math.max(0, Number(s.frozen_work_seconds || 0) || 0);
    return Math.max(0, Math.floor((nowMs() - start) / 1000) - totalBreak);
  }
  function updateFromPresence(p = {}, stats = {}) {
    if (!p || typeof p !== 'object') return;
    const current = timerState();
    const serverStart = p.work_started_at || p.joined_at || current.work_started_at || current.local_work_started_at;
    const onBreak = String(p.is_on_break || '0') === '1';
    const serverBreakSeconds = Math.max(0, Number(p.total_break_seconds || 0) || 0);
    const serverBreakMinutes = Math.max(0, Number(p.total_break_minutes || stats.total_break_minutes || 0) || 0) * 60;
    const totalBreak = Math.max(Number(current.total_break_seconds || 0) || 0, serverBreakSeconds, serverBreakMinutes);
    const next = { ...current, work_started_at: serverStart, is_on_break: onBreak ? '1' : '0', total_break_seconds: totalBreak };
    if (onBreak) {
      if (!next.break_started_at) next.break_started_at = p.break_started_at || new Date().toISOString();
      if (!next.frozen_work_seconds) next.frozen_work_seconds = timerSeconds({ ...next, is_on_break:'0' });
    } else {
      next.break_started_at = '';
      next.frozen_work_seconds = 0;
    }
    writeTimer(next);
  }
  async function refreshAttendance(force = false) { return; }
  function ensureTimerPill() {
    // CC26_462: legacy CC379 timer is permanently retired. CC456 owns the single topbar timer.
    document.querySelectorAll('.cc379-work-timer-pill,.cc376-work-timer-pill,.cc378-work-timer-pill').forEach((el) => { try { el.remove(); } catch {} });
    return null;
  }
  function addFiveMinutePreset() {
    // React renders its own real 5m button. Only remove old DOM clones; never make a fake button.
    const row = document.querySelector('.premium-minute-row');
    if (!row) return;
    row.querySelectorAll('[data-cc379-five]').forEach((duplicate) => duplicate.remove());
  }

  document.addEventListener('click', (event) => {
    const btn = event.target && event.target.closest ? event.target.closest('button') : null;
    if (!btn) return;
    const text = (btn.textContent || '').trim();
    if (/^Start Break$/i.test(text)) {
      const current = timerState();
      const frozen = timerSeconds({ ...current, is_on_break:'0' });
      const now = new Date().toISOString();
      writeTimer({ ...current, is_on_break:'1', break_started_at: now, frozen_work_seconds: frozen });
      setTimeout(ensureTimerPill, 20);
    }
    if (/^End Break$/i.test(text)) {
      const current = timerState();
      const started = parseMs(current.break_started_at);
      const used = started ? Math.max(0, Math.floor((nowMs() - started) / 1000)) : 0;
      writeTimer({ ...current, is_on_break:'0', break_started_at:'', frozen_work_seconds:0, total_break_seconds: Math.max(0, Number(current.total_break_seconds || 0) || 0) + used });
      setTimeout(ensureTimerPill, 20);
    }
  }, true);

  function cc765ReminderWriteRelevant(url, method, input, options = {}) {
    if (['GET','HEAD','OPTIONS'].includes(String(method || '').toUpperCase())) return false;
    const path = String(url || '');
    if (/\/api\/(submissions|interviews|followups|tasks|approvals)(?:\/|\?|$)/i.test(path)) return true;
    if (/\/api\/reports\/semi-hourly(?:\/|\?|$)/i.test(path)) return true;
    if (!/\/api\/candidates(?:\/|\?|$)/i.test(path)) return false;
    if (/\/(submit|delete|restore|revive|remove-interview-date)(?:\/|\?|$)/i.test(path)) return true;
    let body = options && options.body;
    if (!body && input && typeof input === 'object') body = input.body;
    if (typeof body !== 'string') return false;
    let payload = null;
    try { payload = JSON.parse(body); } catch { return false; }
    if (!payload || typeof payload !== 'object') return false;
    const reminderKey = (key) => /^(follow_up_at|next_follow_up_at|followup_date|follow_up_date|callback_at|interview_date|interview_reschedule_date|scheduled_at|approval_status|all_details_sent|submission_date|submitted_at|due_date|due_at|reminder_at|status)$/.test(String(key || '').toLowerCase());
    const changed = Array.isArray(payload._changed_fields) ? payload._changed_fields.map((key) => String(key || '').toLowerCase()).filter(Boolean) : [];
    if (changed.length) return changed.some(reminderKey);
    const keys = Object.keys(payload).map((key) => String(key).toLowerCase()).filter((key) => key !== '_changed_fields');
    return keys.some(reminderKey);
  }

  window.fetch = async function cc379Fetch(input, options = {}) {
    const res = await originalFetch(input, options);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.includes('/api/reports/reminder-summary')) {
        res.clone().json().then((payload) => {
          if (payload?.ok) {
            mergeBacklog(Array.isArray(payload.actions) ? payload.actions : []);
            renderSingleReminder();
          }
        }).catch(() => {});
      }
      // CC26_765: read-only page loads never trigger reminder reads. A successful
      // reminder-relevant write emits one local signal; CC730 then performs one
      // consolidated refresh. This fixes same-user submit -> +5m reminder without polling.
      const method = String(options?.method || (input && input.method) || 'GET').toUpperCase();
      if (res.ok && cc765ReminderWriteRelevant(url, method, input, options)) {
        try { window.dispatchEvent(new CustomEvent('career-crox-data-written', { detail:{ path:String(url || ''), method, at:Date.now() } })); } catch {}
        if (!window.__CC730_DIRECT_REMINDER_OWNER__) {
          if (reminderWriteTimer) clearTimeout(reminderWriteTimer);
          reminderWriteTimer = setTimeout(() => { reminderWriteTimer = null; refreshReminders(true); }, 900);
        }
      }
    } catch {}
    return res;
  };

  installStyle();
  try { localStorage.removeItem(LEGACY_BACKLOG_KEY); } catch {}
  window.addEventListener('career-crox-work-timer-reset', () => { try { localStorage.removeItem(TIMER_KEY); localStorage.removeItem(LEGACY_TIMER_KEY); } catch {} setTimeout(ensureTimerPill, 20); });
  // CC26_603: data snapshots are fetched once at login, after the relevant user WRITE,
  // or when the user explicitly clicks Refresh Reminders. No unattended 15-minute fetch.
  const manualReminderButton = () => {
    if (window.__CC602_NETWORK_PAUSED__ || location.pathname.includes('/login')) return;
    const host = document.querySelector('.topbar-right');
    if (!host || host.querySelector('#cc603-reminders-refresh')) return;
    const button = document.createElement('button');button.id='cc603-reminders-refresh';button.type='button';
    button.className='ghost-btn bounceable';button.textContent='Reminders';
    button.style.cssText='font-size:12px;white-space:nowrap;flex:0 0 auto;padding:9px 12px;font-weight:850';
    button.title='Open your saved reminders instantly (Refresh Now is inside)';
    button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','cc611-reminders-dialog');button.setAttribute('aria-expanded','false');
    button.addEventListener('click', openReminderDialog);
    host.appendChild(button);
  };
  setTimeout(() => { ensureTimerPill(); addFiveMinutePreset();manualReminderButton(); if(!window.__CC730_DIRECT_REMINDER_OWNER__) refreshReminders(true); }, 1200);
  const pillTimer=setInterval(() => {ensureTimerPill();manualReminderButton();}, 2500);
  // Cached reminders remain displayed by a local clock, with zero network reads.
  const localReminderTimer=setInterval(renderSingleReminder, 15 * 1000);
  window.addEventListener('focus', renderSingleReminder);
  window.addEventListener('career-crox-idle-lock-begin',()=>{clearInterval(pillTimer);clearInterval(localReminderTimer);if(reminderWriteTimer)clearTimeout(reminderWriteTimer);closeReminderDialog();document.getElementById('cc611-reminders-dialog')?.remove();document.getElementById('cc603-reminders-refresh')?.remove();},{once:true});
})();



/* CC26_388 compact smart reminder runtime: source parity with frontend/src/lib/compactReminderRuntime.js */
;(() => {
const VERSION = 'CC26_388_COMPACT_SMART_REMINDER_FINAL';
const STYLE_ID = 'cc388-compact-reminder-style';
const BACKLOG_KEY = 'cc388_due_reminder_backlog';
const SNOOZE_KEY = 'cc388_snoozed_reminder_map';
const REFRESH_MS = 15 * 60 * 1000;

function readJson(key, fallback) {
  try { const value = JSON.parse(localStorage.getItem(key) || ''); return value ?? fallback; } catch { return fallback; }
}
function writeJson(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
function cleanText(value) { return String(value || '').replace(/[<>&]/g, '').replace(/\s+/g, ' ').trim(); }
function keyOf(item = {}) { return cleanText(item.key || `${item.type || 'reminder'}:${item.candidate_id || item.task_id || item.notification_id || item.submission_id || item.interview_id || item.title || ''}`); }
function parseMs(value) { const t = Date.parse(String(value || '')); return Number.isFinite(t) ? t : 0; }
function typeFor(item = {}) {
  const text = `${item.type || ''} ${item.key || ''} ${item.title || ''}`.toLowerCase();
  if (text.includes('submission')) return 'submission';
  if (text.includes('interview')) return 'interview';
  if (text.includes('follow')) return 'followups';
  if (text.includes('task')) return 'task';
  if (text.includes('break')) return 'break';
  if (text.includes('report') || text.includes('semi')) return 'report';
  if (text.includes('notification')) return 'notification';
  if (text.includes('idle') || text.includes('activity')) return 'idle';
  return 'generic';
}
function labelFor(type) {
  return ({ submission: 'Submission Reminder', interview: 'Interview Reminder', followups: 'Follow-up Reminder', task: 'Task Reminder', break: 'Break Reminder', report: 'Report Reminder', notification: 'Notification', idle: 'Activity Reminder', generic: 'CRM Reminder' })[type] || 'CRM Reminder';
}
function repeatMinutes(item = {}) { const type = typeFor(item); return Number(item.repeat_minutes || (type === 'submission' ? 10 : type === 'interview' ? 10 : 20)); }
function istDateKey(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch { return new Date(date.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10); }
}

function installStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .cc383-reminder-deck,.cc379-reminder-deck,.cc378-reminder-deck,.cc377-reminder-rail,.global-submission-reminder-wrap{display:none!important;visibility:hidden!important;pointer-events:none!important}
    .cc388-reminder-deck{position:fixed;right:14px;bottom:14px;z-index:102500;width:min(292px,calc(100vw - 24px));font-family:Roboto,"Segoe UI",Arial,sans-serif;pointer-events:none}
    .cc388-card{position:relative;pointer-events:auto;border-radius:19px;padding:10px;color:#fff;border:1px solid rgba(255,255,255,.58);box-shadow:0 20px 44px rgba(15,23,42,.28),inset 0 1px 0 rgba(255,255,255,.25);overflow:hidden;cursor:pointer;backdrop-filter:blur(14px);transition:transform .16s ease,box-shadow .16s ease;font-family:Roboto,"Segoe UI",Arial,sans-serif}.cc388-card:hover{transform:translateY(-2px);box-shadow:0 28px 58px rgba(15,23,42,.34),inset 0 1px 0 rgba(255,255,255,.3)}
    .cc388-card.interview{background:linear-gradient(135deg,#ff8a3d,#ff5f76 58%,#e9328b)}
    .cc388-card.submission{background:linear-gradient(135deg,#6657e8,#357ded 55%,#12abc5)}
    .cc388-card.task{background:linear-gradient(135deg,#10a978,#16a89d,#367eea)}
    .cc388-card.followups{background:linear-gradient(135deg,#e99a16,#f66c1d,#e64242)}
    .cc388-card.break{background:linear-gradient(135deg,#ef7c21,#e94444,#b91c4b)}
    .cc388-card.report{background:linear-gradient(135deg,#07a7c3,#2563cf,#7244d7)}
    .cc388-card.notification{background:linear-gradient(135deg,#e74444,#ce2e79,#7342ca)}
    .cc388-card.idle,.cc388-card.generic{background:linear-gradient(135deg,#5361d9,#844fd3,#cc3e91)}
    .cc388-head{display:flex;align-items:center;justify-content:space-between;gap:6px}.cc388-label{display:inline-flex;align-items:center;justify-content:center;min-width:132px;font-size:13.5px;font-weight:1000;text-transform:uppercase;letter-spacing:.04em;padding:6px 10px;border-radius:999px;background:linear-gradient(135deg,rgba(255,255,255,.46),rgba(255,255,255,.20));border:1px solid rgba(255,255,255,.40);box-shadow:inset 0 1px 0 rgba(255,255,255,.40),0 6px 14px rgba(15,23,42,.13);text-shadow:0 1px 2px rgba(0,0,0,.24);font-family:Roboto,"Segoe UI",Arial,sans-serif}
    .cc388-head-actions{display:flex;align-items:center;gap:5px}.cc388-count{font-size:11.5px;font-weight:1000;color:#15345e;background:linear-gradient(135deg,#fff,#e9f3ff);padding:5px 7px;border-radius:999px;box-shadow:0 5px 12px rgba(12,39,84,.12);font-family:Roboto,"Segoe UI",Arial,sans-serif}.cc388-x{width:28px;height:28px;border:0;border-radius:10px;background:linear-gradient(135deg,#ffb348,#ff5a65 55%,#7c5cff);color:#fff;font-size:19px;line-height:1;font-weight:1000;cursor:pointer;box-shadow:0 7px 16px rgba(65,32,95,.23),inset 0 1px 0 rgba(255,255,255,.35);animation:cc388ClosePulse 1.45s ease-in-out infinite;font-family:Roboto,"Segoe UI",Arial,sans-serif}@keyframes cc388ClosePulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
    .cc388-title{margin-top:6px;font-size:22px;line-height:1.14;font-weight:1000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 3px rgba(0,0,0,.2);font-family:Roboto,"Segoe UI",Arial,sans-serif}.cc388-note{margin-top:7px;background:linear-gradient(180deg,#ffffff 0%,#f7fbff 100%);color:#0e2d52;border-radius:14px;padding:9px 10px;font-size:16px;line-height:1.35;font-weight:800;min-height:68px;max-height:82px;overflow:auto;border:1px solid rgba(210,225,248,.95);box-shadow:inset 0 1px 0 #fff,0 8px 18px rgba(21,55,109,.11);font-family:Roboto,"Segoe UI",Arial,sans-serif}.cc388-note b{display:block;font-size:13px;letter-spacing:.04em;margin-bottom:5px;color:#234c7d;font-family:Roboto,"Segoe UI",Arial,sans-serif}.cc388-note span{font-size:16px;color:#102f55;font-weight:900;font-family:Roboto,"Segoe UI",Arial,sans-serif}
    .cc388-time{margin-top:6px;font-size:14.5px;font-weight:1000;color:#14375f;background:linear-gradient(135deg,#fff,#edf5ff);border-radius:11px;padding:7px 8px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:inset 0 1px 0 #fff,0 5px 12px rgba(20,54,108,.10);font-family:Roboto,"Segoe UI",Arial,sans-serif}
    .cc388-actions{display:flex;gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap}.cc388-next-day{height:32px;border:1px solid rgba(255,255,255,.30);border-radius:10px;padding:0 10px;font-size:12.5px;font-weight:1000;cursor:pointer;background:rgba(255,255,255,.24);color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.28);font-family:Roboto,"Segoe UI",Arial,sans-serif}
    .cc388-preset-label{margin-top:6px;font-size:12px;font-weight:1000;letter-spacing:.045em;text-transform:uppercase;color:rgba(255,255,255,.96);font-family:Roboto,"Segoe UI",Arial,sans-serif}.cc388-presets{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-top:4px}.cc388-preset{height:32px;border:1px solid rgba(255,255,255,.92);border-radius:10px;background:linear-gradient(180deg,#ffffff,#eef5ff);color:#143c66;font-size:15px;font-weight:1000;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.96),0 5px 12px rgba(15,23,42,.11);font-family:Roboto,"Segoe UI",Arial,sans-serif}.cc388-preset:hover,.cc388-next-day:hover{background:linear-gradient(180deg,#fff,#e8f2ff)}
    @media(max-width:700px){.cc388-reminder-deck{right:8px;bottom:8px;width:min(292px,calc(100vw - 16px))}.cc388-title{font-size:22px}.cc388-note{font-size:16px;min-height:68px;max-height:82px}.cc388-presets{gap:5px}}@media(prefers-reduced-motion:reduce){.cc388-x{animation:none!important}.cc388-card{transition:none!important}}
  `;
  document.head.appendChild(style);
}

function installCompactReminderRuntime() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__CC388_COMPACT_REMINDER_RUNTIME__ === VERSION) return;
  window.__CC388_COMPACT_REMINDER_RUNTIME__ = VERSION;
  installStyle();
  // CC26_736: retain the exact CC660 reference popup CSS, but the direct scoped reminder owner
  // in cc26-730-client-fixes.js handles data/timing so local/live backends both work reliably.
  return;

  let latestActions = [];
  let refreshTimer = null;
  let tickTimer = null;

  function readSnooze() { const value = readJson(SNOOZE_KEY, {}); return value && typeof value === 'object' ? value : {}; }
  function writeSnooze(value) { writeJson(SNOOZE_KEY, value); }
  function saveActions(actions = []) { latestActions = Array.isArray(actions) ? actions : []; writeJson(BACKLOG_KEY, latestActions); }
  function loadActions() { if (latestActions.length) return latestActions; const stored = readJson(BACKLOG_KEY, []); latestActions = Array.isArray(stored) ? stored : []; return latestActions; }
  function isLogin() { return location.pathname.includes('/login'); }
  function ensureDeck() { let deck = document.querySelector('.cc388-reminder-deck'); if (!deck) { deck = document.createElement('div'); deck.className = 'cc388-reminder-deck'; document.body.appendChild(deck); } return deck; }
  function dueAt(item) { return parseMs(item.due_at || item.created_at || item.updated_at) || Date.now(); }
  function validInterview(item) { return typeFor(item) !== 'interview' || (item.scheduled_at && istDateKey(item.scheduled_at) === istDateKey(Date.now())); }
  function dueRows() {
    const snooze = readSnooze();
    return loadActions().filter(validInterview).filter((item) => dueAt(item) <= Date.now()).filter((item) => Number(snooze[keyOf(item)] || 0) <= Date.now()).sort((a, b) => dueAt(a) - dueAt(b));
  }
  function formatTime(item) {
    const type = typeFor(item);
    const stamp = type === 'interview' ? item.scheduled_at : item.due_at;
    try { return new Date(stamp || Date.now()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return 'Now'; }
  }
  function render() {
    installStyle();
    document.querySelectorAll('.cc383-reminder-deck,.cc379-reminder-deck').forEach((el) => { el.style.display = 'none'; });
    if (isLogin()) { document.querySelectorAll('.cc388-reminder-deck').forEach((el) => el.remove()); return; }
    const deck = ensureDeck();
    const rows = dueRows();
    if (!rows.length) { deck.innerHTML = ''; return; }
    const item = rows[0]; const type = typeFor(item); const key = keyOf(item);
    const sameTypeCount = rows.filter((row) => typeFor(row) === type).length;
    const countText = type === 'interview' ? `Today ${sameTypeCount}` : type === 'submission' ? `Pending ${sameTypeCount}` : `${sameTypeCount} due`;
    const title = cleanText(item.full_name || item.candidate_name || item.employee_name || item.recruiter_name || item.user_name || item.username || String(item.title || labelFor(type)).replace(/^Submission Reminder:\s*/i, '').replace(/^Interview Reminder:\s*/i, '').replace(/^Activity Reminder:?\s*/i, '')) || labelFor(type);
    const note = cleanText(item.message || 'Reminder needs action.');
    const openPath = item.candidate_id ? `/candidate/${encodeURIComponent(String(item.candidate_id))}` : cleanText(item.open_path || '/reports');
    const nextDay = type === 'interview' && item.allow_next_day_same_time ? '<button class="cc388-next-day" type="button">Next day · same time</button>' : '';
    deck.innerHTML = `<div class="cc388-card ${type}" data-key="${key}" data-type="${type}" data-open="${openPath}" data-candidate="${cleanText(item.candidate_id || '')}" data-interview="${cleanText(item.interview_id || '')}" title="Open profile"><div class="cc388-head"><span class="cc388-label">${labelFor(type)}</span><span class="cc388-head-actions"><span class="cc388-count">${countText}</span><button class="cc388-x" type="button" aria-label="Close">×</button></span></div><div class="cc388-title">${title}</div><div class="cc388-note"><b>NOTE</b><span>${note}</span></div><div class="cc388-time">${type === 'interview' ? 'Interview' : 'Due'}: ${formatTime(item)}</div>${nextDay ? `<div class="cc388-actions">${nextDay}</div>` : ''}<div class="cc388-preset-label">Snooze</div><div class="cc388-presets"><button class="cc388-preset" data-min="5">5m</button><button class="cc388-preset" data-min="30">30m</button><button class="cc388-preset" data-min="60">1h</button><button class="cc388-preset" data-min="180">3h</button></div></div>`;
  }
  function suppress(key, minutes) { const map = readSnooze(); map[key] = Date.now() + Math.max(1, Number(minutes || 1)) * 60000; writeSnooze(map); render(); }
  async function refresh() {
    if (isLogin()) return;
    try {
      const response = await fetch(`/api/reports/reminder-summary?cc388=${Date.now()}`, { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json', 'X-Career-Crox-Background': '1' } });
      if (response.ok) { const payload = await response.json(); if (payload?.ok) saveActions(payload.actions || []); }
    } catch {}
    render();
  }
  async function rescheduleNextDay(card) {
    const key = card.getAttribute('data-key') || '';
    try {
      const response = await fetch('/api/interviews/reschedule-next-day', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidate_id: card.getAttribute('data-candidate') || '', interview_id: card.getAttribute('data-interview') || '' }) });
      if (!response.ok) throw new Error('Could not reschedule');
      saveActions(loadActions().filter((item) => keyOf(item) !== key));
      render();
      setTimeout(refresh, 500);
    } catch { suppress(key, 5); }
  }

  document.addEventListener('click', (event) => {
    const card = event.target.closest?.('.cc388-card'); if (!card) return;
    const key = card.getAttribute('data-key') || ''; const type = card.getAttribute('data-type') || '';
    if (event.target.closest('.cc388-preset')) { event.preventDefault(); suppress(key, Number(event.target.closest('.cc388-preset').getAttribute('data-min') || 5)); return; }
    if (event.target.closest('.cc388-next-day')) { event.preventDefault(); rescheduleNextDay(card); return; }
    
    if (event.target.closest('.cc388-x')) { event.preventDefault(); event.stopPropagation(); suppress(key, type === 'submission' ? 10 : type === 'interview' ? 10 : 20); return; }
    event.preventDefault(); const open = card.getAttribute('data-open') || '/candidates'; window.open(open, '_blank', 'noopener,noreferrer'); suppress(key, type === 'submission' ? 5 : type === 'interview' ? 10 : repeatMinutes({ type })); return;
  }, true);

  // In a normal source build there is no legacy CC379 runtime, so this runtime owns the low-egress 5-minute refresh.
  if (!window.__CC379_CONSOLIDATED_RUNTIME__) {
    refreshTimer = window.setInterval(refresh, REFRESH_MS);
    setTimeout(refresh, 700);
  } else {
    // Legacy prebuilt runtime owns the network refresh; read its active backlog locally.
    const legacyKeys = ['cc379_due_reminder_backlog'];
    const pullLegacy = () => {
      const map = new Map();
      legacyKeys.forEach((storageKey) => { const rows = readJson(storageKey, []); if (Array.isArray(rows)) rows.forEach((item) => { const key = keyOf(item); if (key) map.set(key, item); }); });
      saveActions(Array.from(map.values())); render();
    };
    setTimeout(pullLegacy, 1600);
    window.addEventListener('career-crox-reminder-backlog-updated', pullLegacy);
    refreshTimer = window.setInterval(pullLegacy, 30000);
  }
  tickTimer = window.setInterval(render, 1000); // local-only reminder clock
  const onDataWritten = (event) => {
    const path = String(event?.detail?.path || '');
    if (/\/api\/(candidates|submissions|interviews)/.test(path) && !window.__CC379_CONSOLIDATED_RUNTIME__) setTimeout(refresh, 500);
  };
  window.addEventListener('career-crox-data-written', onDataWritten);
  window.addEventListener('beforeunload', () => { if (refreshTimer) clearInterval(refreshTimer); if (tickTimer) clearInterval(tickTimer); window.removeEventListener('career-crox-data-written', onDataWritten); }, { once: true });
}

installCompactReminderRuntime();
})();

/* CC26_455 legacy timer removed in CC26_462: CC456 is the only timer owner. */

/* CC26_456 CURRENT-SESSION ATTENDANCE INTEGRITY FINAL */
;(() => {
  'use strict';
  if (window.__CC456_SESSION_ATTENDANCE__) return;
  window.__CC456_SESSION_ATTENDANCE__ = 'CC26_456_SESSION_ATTENDANCE_FINAL';
  const KEY='cc456_session_activity_state', ACT='cc434_work_activity_at', JOIN='careerCroxOfficeJoinedSession', LOGIN='careerCroxSessionLoginAt';
  const GRACE=2*60*1000, FULL=9*60*60*1000, WRITE=5000;
  let lastIdentity='', lastMarker='', freshBoot=true;
  const now=()=>Date.now();
  function json(k){try{const x=JSON.parse(localStorage.getItem(k)||'null');return x&&typeof x==='object'?x:null}catch{return null}}
  function user(){try{return JSON.parse(localStorage.getItem('careerCroxCachedUser')||'{}')||{}}catch{return{}}}
  function identity(){const u=user();return String(u.user_id||u.recruiter_code||u.username||u.email||'').trim()}
  function marker(){try{return String(localStorage.getItem(LOGIN)||'').trim()}catch{return''}}
  function rawJoin(){return json(JOIN)}
  function session(){
    const id=identity(), mk=marker(); if(!id||!mk)return null;
    const login=Number(mk||0)||0, j=rawJoin();
    if(!j||j.identity!==id||!j.joined_at||!j.manual_confirmed_at)return null;
    const joined=new Date(j.joined_at).getTime();
    if(!Number.isFinite(joined)||joined<=0)return null;
    // Daily join is canonical. Never replace it with the later refresh/login time.
    const today=new Date(now()+19800000).toISOString().slice(0,10);
    const day=new Date(joined+19800000).toISOString().slice(0,10);
    if(day!==today||joined>now()+300000)return null;
    return {id,mk,login:login||joined,joined,office:joined};
  }
  function fmt(ms){let x=Math.max(0,Math.floor(Number(ms||0)/1000)),h=Math.floor(x/3600),m=Math.floor((x%3600)/60),sec=x%60;return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0')}
  function hm(ms){const mins=Math.max(0,Math.floor(Number(ms||0)/60000)),h=Math.floor(mins/60),m=mins%60;return h+'h '+m+'m'}
  function clock(ms){if(!ms)return '-';try{return new Date(ms).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:true})}catch{return'-'}}
  function read(){return json(KEY)}
  function write(st,force){try{const t=now();if(!force&&st._last_write_at&&t-st._last_write_at<WRITE)return;st._last_write_at=t;localStorage.setItem(KEY,JSON.stringify(st));localStorage.setItem('cc729_daily_timer_backup',JSON.stringify(st))}catch{}}
  function act(){try{return Math.max(0,Number(localStorage.getItem(ACT)||0)||0)}catch{return 0}}
  function mark(){const ss=session();if(!ss)return;const t=now();if(t<ss.office)return;try{localStorage.setItem(ACT,String(t))}catch{}}
  function onBreak(){const chips=document.querySelectorAll('.lock-premium-chip');for(const x of chips){if(/break mode|break exceeded/i.test(String(x.textContent||'')))return true}const old=document.querySelector('.cc455-work-timer-pill,.cc408-work-timer-pill');return !!(old&&old.classList.contains('break'))}
  function locked(){return !!document.querySelector('.crm-lock-backdrop,.crm-lock-modal,.break-overdue-modal')}
  function clear(){try{localStorage.removeItem(KEY);localStorage.removeItem(ACT)}catch{}document.querySelectorAll('.cc456-work-timer-pill').forEach(x=>x.remove())}
  function stateFor(ss,t){let st=read(),sameDay=st&&st.identity===ss.id&&Number(st.version||0)===456&&
      Number.isFinite(Number(st.office_started_at))&&new Date(Number(st.office_started_at)+19800000).toISOString().slice(0,10)===new Date(ss.office+19800000).toISOString().slice(0,10);
    if(!sameDay){
      try{localStorage.removeItem(ACT)}catch{}
      st={version:456,identity:ss.id,login_marker:ss.mk,started_at:ss.login,office_started_at:ss.office,last_tick_at:t,active_ms:0,idle_ms:0,break_ms:0,grace_ms:Math.min(Math.max(0,t-ss.office),GRACE),last_activity_at:0,_last_write_at:0};
      st.idle_ms=Math.max(0,t-ss.office-st.grace_ms);write(st,true);freshBoot=false;return st;
    }
    // A refresh or a new login marker must NOT throw away today's active/break/idle counters.
    if(String(st.login_marker||'')!==ss.mk){
      try{localStorage.removeItem(ACT)}catch{}
      st.idle_ms=Math.max(0,Number(st.idle_ms||0)||0)+Math.max(0,t-Math.max(ss.office,Number(st.last_tick_at||t)||t));
      st.login_marker=ss.mk;st.last_tick_at=t;st.last_activity_at=0;st._last_write_at=0;
    }
    st.started_at=ss.login;st.office_started_at=ss.office;st.active_ms=Math.max(0,Number(st.active_ms||0)||0);st.idle_ms=Math.max(0,Number(st.idle_ms||0)||0);st.break_ms=Math.max(0,Number(st.break_ms||0)||0);st.grace_ms=Math.max(0,Number(st.grace_ms||0)||0);st.last_activity_at=Math.max(0,Number(st.last_activity_at||0)||0);st.last_tick_at=Math.max(ss.office,Math.min(t,Number(st.last_tick_at||t)||t));return st}
  function account(ss){const t=now();let st=stateFor(ss,t),dt=Math.max(0,t-st.last_tick_at),b=onBreak(),l=locked(),a=act();if(a>=ss.office)st.last_activity_at=Math.max(st.last_activity_at,a);const recent=!!(st.last_activity_at&&t-st.last_activity_at<GRACE),officeElapsed=Math.max(0,t-ss.office);
    if(dt>0){if(b)st.break_ms+=dt;else if(l)st.idle_ms+=dt;else if(recent)st.active_ms+=dt;else if(officeElapsed<=GRACE)st.grace_ms+=dt;else st.idle_ms+=dt}st.last_tick_at=t;
    // Clamp buckets to current session duration so impossible values can never leak into UI.
    st.break_ms=Math.min(st.break_ms,officeElapsed);let left=Math.max(0,officeElapsed-st.break_ms);st.active_ms=Math.min(st.active_ms,left);left-=st.active_ms;st.grace_ms=Math.min(st.grace_ms,left);left-=st.grace_ms;st.idle_ms=Math.min(st.idle_ms,left);left-=st.idle_ms;if(left>0)st.idle_ms+=left;
    write(st,false);return {st,t,b,l,recent,officeElapsed,loginElapsed:Math.max(0,t-ss.login),idle:!b&&!l&&!recent&&officeElapsed>GRACE}}
  function style(){if(document.getElementById('cc456-session-style'))return;const e=document.createElement('style');e.id='cc456-session-style';e.textContent=`
    .cc455-work-timer-pill,.cc445-work-timer-pill,.cc408-work-timer-pill,.cc379-work-timer-pill,.cc376-work-timer-pill,.cc378-work-timer-pill{display:none!important}
    .cc456-work-timer-pill{position:relative;height:54px;min-width:202px;padding:6px 14px 12px;border-radius:18px;background:linear-gradient(135deg,#fff,#eff8ff 52%,#fff8ee);border:1px solid rgba(96,165,250,.42);box-shadow:0 12px 30px rgba(37,99,235,.14);display:flex;align-items:center;gap:11px;color:#10233f;overflow:hidden}
    .cc456-dot{width:10px;height:10px;border-radius:999px;background:#22c55e;box-shadow:0 0 0 5px rgba(34,197,94,.13);flex:0 0 10px}.cc456-work-timer-pill.idle .cc456-dot{background:#f59e0b;box-shadow:0 0 0 5px rgba(245,158,11,.15)}.cc456-work-timer-pill.break .cc456-dot{background:#f97316}.cc456-work-timer-pill.locked .cc456-dot{background:#ef4444}
    .cc456-label{font-size:8.5px;font-weight:1000;text-transform:uppercase;letter-spacing:.09em;color:#64748b;line-height:1}.cc456-value{font:1000 17px/1.05 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;color:#10233f;margin-top:2px}.cc456-sub{font-size:8.5px;font-weight:900;color:#64748b;line-height:1;margin-top:3px;white-space:nowrap}
    .cc456-progress{position:absolute;left:11px;right:11px;bottom:5px;height:7px;border-radius:999px;background:linear-gradient(90deg,rgba(239,68,68,.16),rgba(245,158,11,.13),rgba(34,197,94,.14));overflow:hidden;box-shadow:inset 0 1px 3px rgba(15,23,42,.13)}.cc456-progress span{display:block;height:100%;width:0;border-radius:999px;background:#ef4444;transition:width .4s ease,background .4s ease}
    body[data-cc456-attendance='1'] .attendance-progress-bar{height:10px!important;border-radius:999px!important;background:linear-gradient(90deg,#fee2e2,#fef3c7 52%,#dcfce7)!important;box-shadow:inset 0 1px 3px rgba(15,23,42,.12)!important}body[data-cc456-attendance='1'] .attendance-progress-bar>span{border-radius:999px!important;transition:width .45s ease!important}
  `;document.head.appendChild(e)}
  function pill(){style();let p=document.querySelector('.cc456-work-timer-pill');if(p)return p;const top=document.querySelector('.topbar-right');if(!top)return null;p=document.createElement('div');p.className='cc456-work-timer-pill';p.title='Active work for this login. Break, idle and lock are excluded.';p.innerHTML='<span class="cc456-dot"></span><span><div class="cc456-label">Working Time</div><div class="cc456-value">00:00:00</div><div class="cc456-sub">Active work</div></span><div class="cc456-progress"><span></span></div>';top.insertBefore(p,top.firstChild);return p}
  function renderPill(ss,x){document.querySelectorAll('.cc455-work-timer-pill,.cc445-work-timer-pill,.cc408-work-timer-pill,.cc379-work-timer-pill,.cc376-work-timer-pill,.cc378-work-timer-pill,.cc456-work-pill').forEach(e=>{try{e.remove()}catch(_){e.style.display='none'}});const all=document.querySelectorAll('.cc456-work-timer-pill');for(let i=1;i<all.length;i++){try{all[i].remove()}catch(_){all[i].style.display='none'}}const p=pill();if(!p)return;p.classList.remove('cc641-await-join');p.classList.toggle('break',x.b);p.classList.toggle('locked',x.l);p.classList.toggle('idle',x.idle);const val=p.querySelector('.cc456-value'),sub=p.querySelector('.cc456-sub'),fill=p.querySelector('.cc456-progress span'),active=Math.max(0,Number(x.st.active_ms||0)||0);if(val)val.textContent=fmt(active);const pct=Math.max(0,Math.min(100,active/FULL*100)),h=Math.round(120*pct/100);if(sub)sub.textContent=x.b?'Break • active timer paused':x.l?'CRM locked • active timer paused':x.idle?'Idle • active timer paused':Math.round(pct)+'% of 9h active';if(fill){fill.style.width=pct.toFixed(2)+'%';fill.style.background='hsl('+h+' 82% 45%)'}}
  function tick(){
    style();
    // Always keep ONE header clock mounted for an authenticated, active browser session.
    // CC26_640 removed the only fallback before Join Office and thereby hid the clock.
    // Do not invent active seconds or start attendance before a verified Join Office.
    if(/\/login(?:\/|$)/i.test(location.pathname||'') ||
       !identity() || !marker() || window.__CC602_NETWORK_PAUSED__){clear();return}
    const ss=session();
    if(!ss){
      const p=pill(); if(!p)return;
      p.classList.add('cc641-await-join');
      p.classList.remove('idle','break','locked');
      const value=p.querySelector('.cc456-value'),sub=p.querySelector('.cc456-sub'),fill=p.querySelector('.cc456-progress span');
      if(value && value.textContent!=='00:00:00')value.textContent='00:00:00';
      if(sub && sub.textContent!=='Join Office to start')sub.textContent='Join Office to start';
      if(fill && fill.style.width!=='0%')fill.style.width='0%';
      return;
    }
    const key=ss.id+'|'+ss.mk;if(lastIdentity+'|'+lastMarker!==key){lastIdentity=ss.id;lastMarker=ss.mk}const x=account(ss);renderPill(ss,x);try{window.dispatchEvent(new CustomEvent('career-crox-work-session-tick',{detail:{...x.st,elapsed_ms:Math.max(0,Number(x.st.active_ms||0)||0),active_elapsed_ms:Math.max(0,Number(x.st.active_ms||0)||0),office_elapsed_ms:x.officeElapsed,on_break:x.b,locked:x.l,idle:x.idle}}))}catch{}}
  // Real human interactions only. Pointer movement does not count as productive activity.
  ['mousedown','keydown','touchstart','click','wheel','scroll'].forEach(ev=>window.addEventListener(ev,mark,{passive:true,capture:true}));
  window.addEventListener('career-crox-office-joined',e=>{if(!e?.detail?.restored){try{localStorage.removeItem(KEY);localStorage.removeItem(ACT)}catch{}}if(e?.detail?.explicit_join){tick();mark();setTimeout(tick,20)}else setTimeout(tick,20)});
  window.addEventListener('career-crox-work-timer-reset',clear);window.addEventListener('storage',e=>{if(e&&e.key==='careerCroxCachedUser'&&!e.newValue)clear()});
  // Render immediately when React mounts the header; no 1-second blank gap.
  window.addEventListener('career-crox-react-ready',tick,{once:true});
  setInterval(tick,1000);setTimeout(tick,80);
})();

/* CC26_556: one lightweight display-only clock handler for the existing React break gate.
   A manager/admin never receives a manager warning modal and is never auto-locked by this script.
   No API polling. The existing React end-break request is the only expiry write. */
;(() => {
  'use strict';
  function currentRole(){
    try {
      const user=JSON.parse(localStorage.getItem('careerCroxCachedUser')||'null')||{};
      const role=String(user.role||user.designation||user.user_role||'').trim().toLowerCase();
      return role.includes('manager')||role.includes('admin')?'manager':role;
    } catch {return '';}
  }
  const two = n => String(Math.floor(n)).padStart(2,'0');
  function tick(){
    document.querySelectorAll('.cc555-manager-warning').forEach(node=>node.remove());
    if(currentRole()==='manager'||/^\/login(?:\/|$)/.test(location.pathname))return;
    const modal=document.querySelector('.crm-lock-backdrop .crm-lock-modal');
    if(!modal)return;
    const overlay=modal.closest('.crm-lock-backdrop');
    if(!overlay)return;
    const clock=modal.querySelector('.cc556-negative-clock[data-break-expiry]');
    if(clock){
      const end=Number(clock.dataset.breakExpiry);
      if(Number.isFinite(end)&&end>0){
        // The allotted break never increases after expiry. Any overrun is handled by the required-reason approval modal.
        if(clock.textContent!=='00:00:00') clock.textContent='00:00:00';
      }
      return;
    }
    const timer=modal.querySelector('.lock-overlay-timer');
    if(!timer)return;
    const text=String(timer.textContent||'').replace(/[^0-9:]/g,'');
    const pieces=text.split(':').map(Number);
    const remaining=pieces.length===3 ? pieces[0]*3600+pieces[1]*60+pieces[2] : pieces.length===2 ? pieces[0]*60+pieces[1] : 3600;
    const expired=timer.textContent.trim().startsWith('-')||modal.querySelector('.panel-title')?.textContent?.includes('Exceeded');
    overlay.classList.toggle('cc556-near-end',remaining<=60&&!expired);
    overlay.classList.toggle('cc556-time-up',Boolean(expired));
    // NEVER auto-click an access request. Employee must enter the reason and
    // explicitly submit; React renders the expiry form and verifies backend save.
  }
  setInterval(tick,1000);
  window.addEventListener('focus',tick);
})();
