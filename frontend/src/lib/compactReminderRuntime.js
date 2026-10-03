import { navigateSameTab } from './candidateNav';

const VERSION = 'CC26_729_REMINDER_EXACT_LOCAL_CLOCK';
const STYLE_ID = 'cc392-landscape-reminder-style';
const BACKLOG_KEY = 'cc391_due_reminder_backlog';
const SNOOZE_KEY = 'cc391_snoozed_reminder_map';
const REFRESH_MS = 15 * 60 * 1000; // network fallback only; visible due clock is local
const LEGACY_BACKLOG_KEY = 'cc379_due_reminder_backlog';

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
  return ({ submission: 'Submission', interview: 'Interview', followups: 'Follow-up', task: 'Task', break: 'Break', report: 'Report', notification: 'Notification', idle: 'Activity', generic: 'CRM' })[type] || 'CRM';
}
function repeatMinutes(item = {}) {
  const type = typeFor(item);
  return Number(item.repeat_minutes || (['submission', 'interview', 'followups'].includes(type) ? 10 : 20));
}
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

    .cc361-reminder-panel,.cc362-reminder-dock,.cc364-reminder-stack,.cc365-reminder-stack,.cc366-reminder-stack,.cc367-reminder-rail,.cc376-reminder-rail,.cc377-reminder-rail,.cc378-reminder-deck,.cc379-reminder-deck,.cc383-reminder-deck,.cc388-reminder-deck,.cc389-reminder-deck,.cc390-reminder-deck,.global-submission-reminder-wrap{display:none!important;visibility:hidden!important;pointer-events:none!important}
    .cc391-reminder-deck{position:fixed;right:14px;bottom:14px;z-index:102900;width:min(520px,calc(100vw - 24px));font-family:"Plus Jakarta Sans", "Segoe UI Variable Text", "Segoe UI", Arial, system-ui, sans-serif;pointer-events:none}
    .cc391-card{--accent:#f97316;--accent2:#ff9b4b;--soft:rgba(249,115,22,.11);position:relative;pointer-events:auto;border-radius:20px;padding:14px 16px 13px;color:#17243a;background:linear-gradient(135deg,rgba(255,255,255,.985),rgba(255,249,242,.965));border:1px solid rgba(245,158,93,.34);box-shadow:0 20px 52px rgba(45,55,72,.17),0 4px 14px rgba(45,55,72,.08);backdrop-filter:blur(16px) saturate(112%);-webkit-backdrop-filter:blur(16px) saturate(112%);overflow:hidden}
    .cc391-card::before{content:"";position:absolute;inset:0 0 auto 0;height:3px;background:linear-gradient(90deg,var(--accent),var(--accent2),rgba(255,255,255,.35));opacity:.98}
    .cc391-card::after{content:"";position:absolute;right:-72px;top:-88px;width:230px;height:230px;border-radius:50%;background:radial-gradient(circle,var(--soft),transparent 68%);pointer-events:none}
    .cc391-card.interview{--accent:#f97316;--accent2:#fb923c;--soft:rgba(249,115,22,.14);background:linear-gradient(135deg,rgba(255,255,255,.985),rgba(255,247,238,.97));border-color:rgba(249,115,22,.28)}
    .cc391-card.submission{--accent:#7c3aed;--accent2:#a78bfa;--soft:rgba(124,58,237,.13);background:linear-gradient(135deg,rgba(255,255,255,.985),rgba(248,245,255,.97));border-color:rgba(124,58,237,.24)}
    .cc391-card.followups{--accent:#f97316;--accent2:#fb923c;--soft:rgba(249,115,22,.13);background:linear-gradient(135deg,rgba(255,255,255,.985),rgba(255,248,239,.97));border-color:rgba(249,115,22,.27)}
    .cc391-card.task{--accent:#059669;--accent2:#34d399;--soft:rgba(5,150,105,.12);background:linear-gradient(135deg,rgba(255,255,255,.985),rgba(240,253,248,.97));border-color:rgba(5,150,105,.24)}
    .cc391-card.break{--accent:#e11d48;--accent2:#fb7185;--soft:rgba(225,29,72,.11);background:linear-gradient(135deg,rgba(255,255,255,.985),rgba(255,243,247,.97));border-color:rgba(225,29,72,.22)}
    .cc391-card.report{--accent:#0284c7;--accent2:#38bdf8;--soft:rgba(2,132,199,.11);background:linear-gradient(135deg,rgba(255,255,255,.985),rgba(240,249,255,.97));border-color:rgba(2,132,199,.23)}
    .cc391-card.notification{--accent:#9333ea;--accent2:#c084fc;--soft:rgba(147,51,234,.11);background:linear-gradient(135deg,rgba(255,255,255,.985),rgba(250,245,255,.97));border-color:rgba(147,51,234,.22)}
    .cc391-card.idle,.cc391-card.generic{--accent:#64748b;--accent2:#94a3b8;--soft:rgba(100,116,139,.10);background:linear-gradient(135deg,rgba(255,255,255,.985),rgba(248,250,252,.97));border-color:rgba(100,116,139,.22)}
    .cc391-head{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:9px}
    .cc391-label{display:inline-flex;align-items:center;font-size:11px;line-height:1;font-weight:900;text-transform:uppercase;letter-spacing:.055em;padding:6px 9px;border-radius:999px;background:var(--soft);color:var(--accent);border:1px solid color-mix(in srgb,var(--accent),transparent 78%)}
    .cc391-head-actions{display:flex;align-items:center;gap:6px}.cc391-count{font-size:11px;line-height:1;font-weight:900;color:#43536b;background:rgba(255,255,255,.88);padding:6px 8px;border-radius:999px;border:1px solid rgba(125,145,174,.20)}
    .cc391-x{width:28px;height:28px;border:1px solid rgba(100,116,139,.20);border-radius:10px;background:rgba(255,255,255,.90);color:#3d4f67;font-size:18px;line-height:1;font-weight:800;cursor:pointer;display:grid;place-items:center;padding:0}
    .cc391-title{position:relative;z-index:1;margin-top:9px;color:#15243a;font-size:20px;line-height:1.2;font-weight:900;letter-spacing:-.018em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .cc391-landscape{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1.35fr) minmax(190px,.90fr);gap:12px;margin-top:10px;align-items:stretch}
    .cc391-note{margin:0;background:rgba(255,255,255,.82);color:#24364d;border-radius:14px;padding:11px 12px;font-size:18px;line-height:1.38;font-weight:720;min-height:112px;max-height:142px;overflow:auto;border:1px solid rgba(125,145,174,.18);box-shadow:inset 0 1px 0 rgba(255,255,255,.76)}
    .cc391-note b{display:block;color:var(--accent);font-size:10.5px;line-height:1;font-weight:900;letter-spacing:.07em;margin-bottom:8px}.cc391-note span{font-size:18px;line-height:1.38;font-weight:720;color:#263a52}
    .cc391-side{display:flex;min-width:0;flex-direction:column;justify-content:flex-start;background:rgba(255,255,255,.55);border:1px solid rgba(125,145,174,.14);border-radius:14px;padding:10px}
    .cc391-time{margin:0;color:#263b56;background:var(--soft);border-radius:11px;padding:10px 11px;border:1px solid color-mix(in srgb,var(--accent),transparent 83%);white-space:normal;overflow:visible}
    .cc391-time b{display:block;color:#66768b;font-size:9.5px;line-height:1;font-weight:900;letter-spacing:.065em;margin-bottom:5px}.cc391-time span{display:block;color:var(--accent);font-size:16px;line-height:1.22;font-weight:900}
    .cc391-preset-label{margin-top:10px;color:#66768b;font-size:9.5px;font-weight:900;letter-spacing:.065em;text-transform:uppercase;text-align:center}
    .cc391-presets{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:5px;margin-top:6px}.cc391-preset{height:32px;border:1px solid rgba(125,145,174,.22);border-radius:9px;background:rgba(255,255,255,.92);color:#293f59;font-size:12px;font-weight:900;cursor:pointer;white-space:nowrap}.cc391-preset:hover{background:var(--soft);border-color:color-mix(in srgb,var(--accent),transparent 70%);color:var(--accent)}
    .cc391-actions{position:relative;z-index:1;display:grid;grid-template-columns:1fr;gap:7px;margin-top:10px;align-items:center}.cc391-actions.has-next{grid-template-columns:minmax(0,1.45fr) minmax(170px,.75fr)}
    .cc391-open,.cc391-next-day{min-height:40px;border-radius:11px;padding:0 13px;font-size:14px;line-height:1;font-weight:900;cursor:pointer}.cc391-open{border:0;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;box-shadow:0 8px 18px color-mix(in srgb,var(--accent),transparent 78%)}.cc391-next-day{border:1px solid color-mix(in srgb,var(--accent),transparent 72%);background:rgba(255,255,255,.90);color:var(--accent)}.cc391-open:hover{filter:brightness(.97)}.cc391-next-day:hover{background:var(--soft)}
    @media(max-width:720px){.cc391-reminder-deck{right:8px;bottom:8px;width:min(96vw,520px)}.cc391-card{padding:12px}.cc391-title{font-size:18px}.cc391-landscape{grid-template-columns:1fr;gap:8px}.cc391-note{min-height:88px;max-height:120px;font-size:15.5px}.cc391-note span{font-size:15.5px}.cc391-side{padding:8px}.cc391-actions.has-next{grid-template-columns:1fr}.cc391-open,.cc391-next-day{min-height:38px}}

    /* CC26_398 Gen-Z premium landscape reminder — content first, colorful but professional */
    html body .cc391-reminder-deck{right:16px!important;bottom:16px!important;width:min(455px,calc(100vw - 24px))!important;font-family:"Plus Jakarta Sans", "Segoe UI Variable Text", "Segoe UI", Arial, system-ui, sans-serif!important}
    html body .cc391-card{--accent:#7c3aed;--accent2:#ec4899;--accent3:#38bdf8;--soft:rgba(124,58,237,.12);border-radius:22px!important;padding:13px 14px 12px!important;background:linear-gradient(132deg,rgba(255,255,255,.985) 0%,rgba(248,247,255,.985) 48%,rgba(239,246,255,.98) 100%)!important;border:1px solid color-mix(in srgb,var(--accent),transparent 73%)!important;box-shadow:0 20px 48px rgba(49,46,129,.20),0 5px 15px rgba(15,23,42,.07)!important;backdrop-filter:blur(18px) saturate(130%)!important;-webkit-backdrop-filter:blur(18px) saturate(130%)!important}
    html body .cc391-card::before{height:4px!important;background:linear-gradient(90deg,var(--accent),var(--accent3),var(--accent2))!important}
    html body .cc391-card::after{right:-58px!important;top:-72px!important;width:190px!important;height:190px!important;background:radial-gradient(circle,color-mix(in srgb,var(--accent3),transparent 80%),transparent 67%)!important}
    html body .cc391-card.interview{--accent:#2563eb;--accent2:#8b5cf6;--accent3:#38bdf8!important;background:linear-gradient(132deg,#fff 0%,#f4f8ff 48%,#f2edff 100%)!important}
    html body .cc391-card.submission{--accent:#7c3aed;--accent2:#ec4899;--accent3:#8b5cf6!important;background:linear-gradient(132deg,#fff 0%,#faf6ff 48%,#fff1f8 100%)!important}
    html body .cc391-card.followups{--accent:#f97316;--accent2:#fb7185;--accent3:#f59e0b!important;background:linear-gradient(132deg,#fff 0%,#fff8ef 48%,#fff0f3 100%)!important}
    html body .cc391-card.task{--accent:#059669;--accent2:#22c55e;--accent3:#2dd4bf!important;background:linear-gradient(132deg,#fff 0%,#f1fff9 48%,#ecfeff 100%)!important}
    html body .cc391-head{align-items:center!important}
    html body .cc391-label{font-size:10.5px!important;padding:6px 9px!important;font-weight:950!important;letter-spacing:.055em!important;background:color-mix(in srgb,var(--accent),white 90%)!important;color:var(--accent)!important}
    html body .cc391-count{font-size:10.5px!important;padding:6px 8px!important}
    html body .cc391-x{width:28px!important;height:28px!important;border-radius:10px!important;background:rgba(255,255,255,.88)!important}
    html body .cc391-title{margin-top:8px!important;font-size:20px!important;line-height:1.1!important;font-weight:1000!important;color:#111c38!important;letter-spacing:-.025em!important}
    html body .cc391-landscape{grid-template-columns:minmax(0,1.45fr) minmax(154px,.72fr)!important;gap:9px!important;margin-top:9px!important}
    html body .cc391-note{min-height:86px!important;max-height:112px!important;padding:10px 11px!important;border-radius:14px!important;background:linear-gradient(135deg,rgba(255,255,255,.91),color-mix(in srgb,var(--accent3),white 93%))!important;border:1px solid color-mix(in srgb,var(--accent),transparent 84%)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.9)!important;overflow:auto!important}
    html body .cc391-note b{font-size:10px!important;line-height:1!important;margin-bottom:6px!important;font-weight:1000!important;color:var(--accent)!important;letter-spacing:.08em!important}
    html body .cc391-note span{font-size:16.5px!important;line-height:1.28!important;font-weight:760!important;color:#17223c!important;letter-spacing:-.012em!important}
    html body .cc391-side{padding:8px!important;border-radius:14px!important;background:rgba(255,255,255,.72)!important;border:1px solid rgba(148,163,184,.16)!important}
    html body .cc391-time{padding:8px 9px!important;border-radius:11px!important;background:color-mix(in srgb,var(--accent),white 92%)!important}
    html body .cc391-time b{font-size:8.5px!important;margin-bottom:4px!important}
    html body .cc391-time span{font-size:14px!important;line-height:1.15!important}
    html body .cc391-preset-label{margin-top:7px!important;font-size:8.5px!important}
    html body .cc391-presets{gap:4px!important;margin-top:5px!important}
    html body .cc391-preset{height:29px!important;border-radius:8px!important;font-size:10.5px!important;padding:0 3px!important}
    html body .cc391-actions{margin-top:8px!important}
    html body .cc391-open,html body .cc391-next-day{min-height:37px!important;border-radius:11px!important;font-size:13px!important}
    html body .cc391-open{background:linear-gradient(100deg,var(--accent),var(--accent3),var(--accent2))!important;box-shadow:0 9px 20px color-mix(in srgb,var(--accent),transparent 77%)!important}
    @media(max-width:620px){html body .cc391-reminder-deck{right:7px!important;bottom:7px!important;width:min(96vw,440px)!important}html body .cc391-card{padding:11px!important}html body .cc391-landscape{grid-template-columns:1fr!important}html body .cc391-note{min-height:76px!important;max-height:100px!important}html body .cc391-note span{font-size:15.5px!important}html body .cc391-side{display:grid!important;grid-template-columns:1fr 1.6fr!important;gap:6px!important;align-items:center!important}html body .cc391-preset-label{display:none!important}html body .cc391-presets{margin-top:0!important}}
  `;
  document.head.appendChild(style);
}

export function installCompactReminderRuntime() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__CC391_PREMIUM_REMINDER_RUNTIME__ === VERSION) return;
  window.__CC391_PREMIUM_REMINDER_RUNTIME__ = VERSION;
  installStyle();
  try { ['cc377_due_reminder_backlog','cc388_due_reminder_backlog','cc389_due_reminder_backlog','cc390_due_reminder_backlog'].forEach((key) => localStorage.removeItem(key)); } catch {}

  let latestActions = [];
  let refreshTimer = null;
  let tickTimer = null;
  let summaryInFlight = null;
  let writeRefreshTimer = null;

  function readSnooze() { const value = readJson(SNOOZE_KEY, {}); return value && typeof value === 'object' ? value : {}; }
  function writeSnooze(value) { writeJson(SNOOZE_KEY, value); }
  function saveActions(actions = []) { latestActions = Array.isArray(actions) ? actions : []; writeJson(BACKLOG_KEY, latestActions); }
  function loadActions() {
    if (latestActions.length) return latestActions;
    const stored = readJson(BACKLOG_KEY, []);
    latestActions = Array.isArray(stored) ? stored : [];
    return latestActions;
  }
  function isLogin() { return location.pathname.includes('/login'); }
  function ensureDeck() {
    let deck = document.querySelector('.cc391-reminder-deck');
    if (!deck) { deck = document.createElement('div'); deck.className = 'cc391-reminder-deck'; document.body.appendChild(deck); }
    return deck;
  }
  function dueAt(item) { return parseMs(item.due_at || item.created_at || item.updated_at) || Date.now(); }
function reminderSort(a, b) {
  const personal = Number(Boolean(b?.personal_owner)) - Number(Boolean(a?.personal_owner));
  if (personal) return personal;
  return dueAt(a) - dueAt(b);
}
  function validRow(item) {
    const type = typeFor(item);
    if (type === 'interview') return Boolean(item.scheduled_at) && istDateKey(item.scheduled_at) === istDateKey(Date.now());
    if (type === 'followups') return istDateKey(item.due_at) === istDateKey(Date.now());
    return true;
  }
  function dueRows() {
    const snooze = readSnooze();
    const now = Date.now();
    return loadActions()
      .filter(validRow)
      .filter((item) => dueAt(item) <= now)
      .filter((item) => Number(snooze[keyOf(item)] || 0) <= now)
      .sort(reminderSort);
  }
  function formatTime(item) {
    const type = typeFor(item);
    const stamp = type === 'interview' ? item.scheduled_at : item.due_at;
    try {
      const date = new Date(stamp || Date.now());
      const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }).format(date).replace('Sept', 'Sep');
      const clock = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }).format(date).replace(/\s+/g, ' ').trim().toUpperCase();
      return `${day} · ${clock}`;
    } catch { return 'Now'; }
  }
  function render() {
    if (document.body.classList.contains('cc451-await-join')) { const deck = document.querySelector('.cc391-reminder-deck'); if (deck) deck.innerHTML = ''; return; }
    installStyle();
    document.querySelectorAll('.cc379-reminder-deck,.cc383-reminder-deck,.cc388-reminder-deck,.cc389-reminder-deck,.cc390-reminder-deck').forEach((el) => { el.style.display = 'none'; });
    if (isLogin()) { document.querySelectorAll('.cc391-reminder-deck').forEach((el) => el.remove()); return; }
    const deck = ensureDeck();
    const rows = dueRows();
    if (!rows.length) { deck.innerHTML = ''; return; }
    const item = rows[0];
    const type = typeFor(item);
    const key = keyOf(item);
    const sameTypeCount = rows.filter((row) => typeFor(row) === type).length;
    const countText = sameTypeCount > 1 ? `1 / ${sameTypeCount}` : '1 due';
    const title = cleanText(item.full_name || item.candidate_name || item.employee_name || item.recruiter_name || item.user_name || item.username || String(item.title || labelFor(type)).replace(/^Submission Reminder:\s*/i, '').replace(/^Interview Reminder:\s*/i, '').replace(/^FollowUp Reminder:\s*/i, '').replace(/^Activity Reminder:?\s*/i, '')) || labelFor(type);
    const note = cleanText(item.notes || item.last_notes || item.message || 'Reminder needs action.');
    const openPath = item.candidate_id ? `/candidate/${encodeURIComponent(String(item.candidate_id))}` : cleanText(item.open_path || '/reports');
    const nextDay = type === 'interview' && item.allow_next_day_same_time ? '<button class="cc391-next-day" type="button">Next day · same time</button>' : '';
    deck.innerHTML = `<div class="cc391-card ${type}" data-key="${key}" data-type="${type}" data-open="${openPath}" data-candidate="${cleanText(item.candidate_id || '')}" data-interview="${cleanText(item.interview_id || '')}" title="Open profile"><div class="cc391-head"><span class="cc391-label">${labelFor(type)}</span><span class="cc391-head-actions"><span class="cc391-count">${countText}</span><button class="cc391-x" type="button" aria-label="Close">×</button></span></div><div class="cc391-title">${title}</div><div class="cc391-note"><b>NOTE</b><span>${note}</span></div><div class="cc391-time"><b>${type === 'interview' ? 'INTERVIEW' : 'DUE'}</b><span>${formatTime(item).replace(' · ', ' · ')}</span></div>${nextDay ? `<div class="cc391-actions">${nextDay}</div>` : ''}<div class="cc391-preset-label">Snooze</div><div class="cc391-presets"><button class="cc391-preset" data-min="5">5m</button><button class="cc391-preset" data-min="15">15m</button><button class="cc391-preset" data-min="60">1h</button><button class="cc391-preset" data-min="180">3h</button><button class="cc391-preset" data-min="360">6h</button></div></div>`;
  }
  function suppress(key, minutes) {
    const map = readSnooze();
    map[key] = Date.now() + Math.max(1, Number(minutes || 1)) * 60000;
    writeSnooze(map);
    render();
  }
  async function refresh() {
    if (window.__CC621_NIGHT_QUIET__?.()) return;
    if (isLogin()) return;
    if (summaryInFlight) return summaryInFlight;
    summaryInFlight = (async () => {
      try {
        const response = await fetch('/api/reports/reminder-summary?fresh=1', { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json', 'X-Career-Crox-Background': '1' } });
        if (response.ok) {
          const payload = await response.json();
          if (payload?.ok) saveActions(payload.actions || []);
        } else if (response.status === 401 || response.status === 403) saveActions([]);
      } catch {} finally { summaryInFlight = null; render(); }
    })();
    return summaryInFlight;
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
    const card = event.target.closest?.('.cc391-card');
    if (!card) return;
    const key = card.getAttribute('data-key') || '';
    const type = card.getAttribute('data-type') || '';
    if (event.target.closest('.cc391-preset')) { event.preventDefault(); suppress(key, Number(event.target.closest('.cc391-preset').getAttribute('data-min') || 5)); return; }
    if (event.target.closest('.cc391-next-day')) { event.preventDefault(); rescheduleNextDay(card); return; }
    if (event.target.closest('.cc391-x')) { event.preventDefault(); event.stopPropagation(); suppress(key, repeatMinutes({ type })); return; }
    event.preventDefault();
    const target = card.getAttribute('data-open') || '/candidates';
    window.open(target, '_blank', 'noopener,noreferrer');
    suppress(key, repeatMinutes({ type }));
    return;
  }, true);

  // Production CC379 already owns the 5-minute network refresh. Reuse ONLY its current backlog
  // (not older CC388/389/390 stores) to avoid duplicate egress and stale reminder queues.
  if (window.__CC379_CONSOLIDATED_RUNTIME__) {
    const pullLegacy = () => {
      const rows = readJson(LEGACY_BACKLOG_KEY, []);
      saveActions(Array.isArray(rows) ? rows : []);
      render();
    };
    setTimeout(pullLegacy, 1500);
    window.addEventListener('career-crox-reminder-backlog-updated', pullLegacy);
    refreshTimer = window.setInterval(pullLegacy, 30000);
  } else {
    setTimeout(refresh, 700);
    refreshTimer = window.setInterval(refresh, REFRESH_MS);
  }
  tickTimer = window.setInterval(render, 1000); // local-only clock; zero database egress
  const onDataWritten = (event) => {
    const path = String(event?.detail?.path || '');
    if (!/\/api\/(candidates|submissions|interviews|followups)/.test(path)) return;
    if (window.__CC379_CONSOLIDATED_RUNTIME__) setTimeout(() => {
      const rows = readJson(LEGACY_BACKLOG_KEY, []);
      saveActions(Array.isArray(rows) ? rows : []);
      render();
    }, 1000);
    else {
      if (writeRefreshTimer) clearTimeout(writeRefreshTimer);
      writeRefreshTimer = setTimeout(() => { writeRefreshTimer = null; refresh(); }, 1600);
    }
  };
  window.addEventListener('career-crox-data-written', onDataWritten);
  window.addEventListener('beforeunload', () => {
    if (refreshTimer) clearInterval(refreshTimer);
    if (tickTimer) clearInterval(tickTimer);
    window.removeEventListener('career-crox-data-written', onDataWritten);
  }, { once: true });
}


// CC26_394 source visual parity. Production uses the same CSS override from prebuilt runtime patch.

/* CC26_394 FINAL REMINDER VISUAL OVERRIDE
   Compact landscape + large readable Name/Notes + light premium gradients.
   Visual-only: reminder calculations, snooze, open-profile and APIs are untouched. */
(function(){
  'use strict';
  var ID='cc394-compact-colorful-reminder-style';
  function install(){
    var old=document.getElementById(ID); if(old) old.remove();
    var s=document.createElement('style'); s.id=ID; s.textContent=`
      .cc391-reminder-deck{
        right:12px!important;bottom:12px!important;
        width:min(445px,calc(100vw - 20px))!important;
        font-family:"Plus Jakarta Sans", "Segoe UI Variable Text", "Segoe UI", Arial, system-ui, sans-serif!important;
      }
      .cc391-card{
        --accent:#f97316;--accent2:#fb7185;--soft:rgba(249,115,22,.12);
        border-radius:17px!important;padding:10px 11px 9px!important;
        border:1px solid color-mix(in srgb,var(--accent),transparent 74%)!important;
        box-shadow:0 14px 34px rgba(31,41,55,.16),0 3px 10px rgba(31,41,55,.07)!important;
        backdrop-filter:blur(13px) saturate(116%)!important;
        -webkit-backdrop-filter:blur(13px) saturate(116%)!important;
        color:#10213a!important;
        background:linear-gradient(135deg,rgba(255,255,255,.985) 0%,rgba(255,255,255,.94) 48%,var(--soft) 145%)!important;
      }
      .cc391-card::before{height:3px!important;background:linear-gradient(90deg,var(--accent),var(--accent2))!important}
      .cc391-card::after{right:-88px!important;top:-105px!important;width:210px!important;height:210px!important;opacity:.75!important}

      .cc391-card.interview{--accent:#2563eb;--accent2:#8b5cf6;--soft:rgba(99,102,241,.14)!important;background:linear-gradient(135deg,#ffffff 0%,#f6f8ff 57%,#eee9ff 135%)!important}
      .cc391-card.submission{--accent:#7c3aed;--accent2:#ec4899;--soft:rgba(124,58,237,.13)!important;background:linear-gradient(135deg,#ffffff 0%,#faf7ff 58%,#f2e9ff 135%)!important}
      .cc391-card.followups{--accent:#f97316;--accent2:#fb7185;--soft:rgba(249,115,22,.13)!important;background:linear-gradient(135deg,#ffffff 0%,#fff9f2 58%,#ffeadf 135%)!important}
      .cc391-card.task{--accent:#059669;--accent2:#22c55e;--soft:rgba(5,150,105,.12)!important;background:linear-gradient(135deg,#ffffff 0%,#f3fff9 58%,#e1fbed 135%)!important}
      .cc391-card.break{--accent:#e11d48;--accent2:#fb7185;--soft:rgba(225,29,72,.11)!important;background:linear-gradient(135deg,#ffffff 0%,#fff6f8 58%,#ffe5ec 135%)!important}
      .cc391-card.report{--accent:#0284c7;--accent2:#06b6d4;--soft:rgba(2,132,199,.11)!important;background:linear-gradient(135deg,#ffffff 0%,#f3fbff 58%,#e0f7ff 135%)!important}
      .cc391-card.notification{--accent:#9333ea;--accent2:#6366f1;--soft:rgba(147,51,234,.11)!important;background:linear-gradient(135deg,#ffffff 0%,#faf6ff 58%,#eee8ff 135%)!important}

      .cc391-head{gap:6px!important;min-height:24px!important}
      .cc391-label{font-size:9.5px!important;padding:5px 8px!important;letter-spacing:.055em!important;border-radius:999px!important}
      .cc391-head-actions{gap:4px!important}
      .cc391-count{font-size:9.5px!important;padding:5px 7px!important}
      .cc391-x{width:24px!important;height:24px!important;border-radius:8px!important;font-size:16px!important}

      /* Name and Notes intentionally same visual reading size */
      .cc391-title{
        margin-top:5px!important;font-size:17px!important;line-height:1.18!important;
        font-weight:900!important;letter-spacing:-.015em!important;color:#10213a!important;
      }
      .cc391-landscape{
        grid-template-columns:minmax(0,1.52fr) minmax(148px,.78fr)!important;
        gap:8px!important;margin-top:6px!important;align-items:stretch!important;
      }
      .cc391-note{
        padding:8px 9px!important;border-radius:11px!important;
        min-height:78px!important;max-height:96px!important;
        font-size:17px!important;line-height:1.24!important;font-weight:760!important;
        color:#13243b!important;background:rgba(255,255,255,.79)!important;
        border:1px solid color-mix(in srgb,var(--accent),transparent 84%)!important;
      }
      .cc391-note b{
        font-size:9px!important;line-height:1!important;margin-bottom:5px!important;
        color:var(--accent)!important;font-weight:950!important;letter-spacing:.075em!important;
      }
      .cc391-note span{
        font-size:17px!important;line-height:1.24!important;font-weight:760!important;
        color:#13243b!important;letter-spacing:-.006em!important;
      }
      .cc391-side{
        padding:7px!important;border-radius:11px!important;
        background:rgba(255,255,255,.58)!important;
        border:1px solid color-mix(in srgb,var(--accent),transparent 87%)!important;
      }
      .cc391-time{padding:7px 8px!important;border-radius:9px!important}
      .cc391-time b{font-size:8px!important;margin-bottom:4px!important}
      .cc391-time span{font-size:13px!important;line-height:1.15!important;font-weight:950!important}
      .cc391-preset-label{margin-top:7px!important;font-size:8px!important}
      .cc391-presets{gap:3px!important;margin-top:4px!important}
      .cc391-preset{
        height:27px!important;min-width:0!important;padding:0 3px!important;
        border-radius:7px!important;font-size:10.5px!important;font-weight:900!important;
      }
      .cc391-actions{gap:5px!important;margin-top:7px!important}
      .cc391-actions.has-next{grid-template-columns:minmax(0,1.45fr) minmax(145px,.7fr)!important}
      .cc391-open,.cc391-next-day{
        min-height:34px!important;height:34px!important;border-radius:9px!important;
        padding:0 10px!important;font-size:12.5px!important;font-weight:900!important;
      }
      .cc391-open{box-shadow:0 6px 14px color-mix(in srgb,var(--accent),transparent 80%)!important}

      @media(max-width:600px){
        .cc391-reminder-deck{right:7px!important;bottom:7px!important;width:min(96vw,420px)!important}
        .cc391-card{padding:9px!important}
        .cc391-title{font-size:16px!important}
        .cc391-landscape{grid-template-columns:1fr!important;gap:5px!important}
        .cc391-note{min-height:65px!important;max-height:86px!important}
        .cc391-note,.cc391-note span{font-size:15.5px!important}
        .cc391-side{display:grid!important;grid-template-columns:1fr 1.45fr!important;gap:5px!important;align-items:center!important}
        .cc391-preset-label{display:none!important}
        .cc391-presets{margin-top:0!important}
        .cc391-actions.has-next{grid-template-columns:1fr!important}
      }
    `; document.head.appendChild(s);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',install,{once:true}); else install();
  new MutationObserver(function(){ if(!document.getElementById(ID)) install(); }).observe(document.documentElement,{childList:true,subtree:true});
})();


/* CC26_396 FINAL LANDSCAPE REMINDER — selected variant #4
   Light premium colorful gradients, readable name + real notes, compact but not tiny. */
(function(){
  'use strict';
  var ID='cc396-final-landscape-reminder-style';
  function install(){
    ['cc394-compact-colorful-reminder-style',ID].forEach(function(id){var e=document.getElementById(id);if(e)e.remove();});
    var s=document.createElement('style');s.id=ID;s.textContent=`
      .cc391-reminder-deck{right:14px!important;bottom:14px!important;width:min(500px,calc(100vw - 24px))!important;font-family:Inter,\"Segoe UI Variable\",\"Segoe UI\",system-ui,-apple-system,Arial,sans-serif!important}
      .cc391-card{--accent:#f97316;--accent2:#fb923c;--soft:rgba(249,115,22,.13);border-radius:20px!important;padding:13px 14px 12px!important;border:1px solid color-mix(in srgb,var(--accent),transparent 72%)!important;box-shadow:0 18px 42px rgba(30,41,59,.16),0 4px 12px rgba(30,41,59,.07)!important;background:linear-gradient(135deg,#fff 0%,#fffaf5 55%,#ffe9d7 138%)!important;backdrop-filter:blur(14px) saturate(118%)!important;-webkit-backdrop-filter:blur(14px) saturate(118%)!important;color:#14213a!important}
      .cc391-card::before{height:3px!important;background:linear-gradient(90deg,var(--accent),var(--accent2))!important}.cc391-card::after{right:-86px!important;top:-104px!important;width:220px!important;height:220px!important;opacity:.72!important}
      .cc391-card.interview{--accent:#f97316;--accent2:#fb923c;--soft:rgba(249,115,22,.13);background:linear-gradient(135deg,#fff 0%,#fffaf5 56%,#ffe9d8 138%)!important}
      .cc391-card.submission{--accent:#7c3aed;--accent2:#ec4899;--soft:rgba(124,58,237,.12);background:linear-gradient(135deg,#fff 0%,#fbf8ff 56%,#efe7ff 138%)!important}
      .cc391-card.followups{--accent:#ea580c;--accent2:#fb7185;--soft:rgba(234,88,12,.12);background:linear-gradient(135deg,#fff 0%,#fff9f4 56%,#ffe6dc 138%)!important}
      .cc391-card.task{--accent:#059669;--accent2:#2dd4bf;--soft:rgba(5,150,105,.11);background:linear-gradient(135deg,#fff 0%,#f5fffb 56%,#def8ef 138%)!important}
      .cc391-card.report{--accent:#0284c7;--accent2:#38bdf8;--soft:rgba(2,132,199,.11);background:linear-gradient(135deg,#fff 0%,#f4fbff 56%,#def4ff 138%)!important}
      .cc391-card.notification{--accent:#9333ea;--accent2:#6366f1;--soft:rgba(147,51,234,.11);background:linear-gradient(135deg,#fff 0%,#faf7ff 56%,#ece8ff 138%)!important}
      .cc391-head{gap:7px!important;min-height:27px!important}.cc391-label{font-size:10.5px!important;padding:6px 9px!important}.cc391-count{font-size:10px!important;padding:5px 7px!important}.cc391-x{width:27px!important;height:27px!important;border-radius:9px!important;font-size:17px!important}
      .cc391-title{margin-top:7px!important;font-size:19px!important;line-height:1.18!important;font-weight:900!important;letter-spacing:-.016em!important;color:#15233b!important}
      .cc391-landscape{grid-template-columns:minmax(0,1.48fr) minmax(178px,.78fr)!important;gap:10px!important;margin-top:8px!important;align-items:stretch!important}
      .cc391-note{padding:10px 11px!important;border-radius:13px!important;min-height:96px!important;max-height:122px!important;font-size:18px!important;line-height:1.28!important;font-weight:720!important;color:#172941!important;background:rgba(255,255,255,.82)!important;border:1px solid color-mix(in srgb,var(--accent),transparent 84%)!important;overflow:auto!important}
      .cc391-note b{font-size:10px!important;line-height:1!important;margin-bottom:7px!important;color:var(--accent)!important;font-weight:950!important;letter-spacing:.075em!important}.cc391-note span{font-size:18px!important;line-height:1.28!important;font-weight:720!important;color:#172941!important;letter-spacing:-.006em!important}
      .cc391-side{padding:9px!important;border-radius:13px!important;background:rgba(255,255,255,.60)!important;border:1px solid color-mix(in srgb,var(--accent),transparent 86%)!important}.cc391-time{padding:9px 10px!important;border-radius:10px!important}.cc391-time b{font-size:9px!important;margin-bottom:5px!important}.cc391-time span{font-size:14px!important;line-height:1.2!important;font-weight:950!important}.cc391-preset-label{margin-top:9px!important;font-size:9px!important}.cc391-presets{gap:4px!important;margin-top:5px!important}.cc391-preset{height:30px!important;border-radius:8px!important;font-size:11px!important;font-weight:900!important;padding:0 3px!important}
      .cc391-actions{gap:6px!important;margin-top:9px!important}.cc391-actions.has-next{grid-template-columns:minmax(0,1.45fr) minmax(155px,.7fr)!important}.cc391-open,.cc391-next-day{min-height:38px!important;height:38px!important;border-radius:10px!important;padding:0 11px!important;font-size:13.5px!important;font-weight:900!important}.cc391-open{box-shadow:0 7px 16px color-mix(in srgb,var(--accent),transparent 80%)!important}
      @media(max-width:620px){.cc391-reminder-deck{right:8px!important;bottom:8px!important;width:min(96vw,470px)!important}.cc391-card{padding:11px!important}.cc391-title{font-size:18px!important}.cc391-landscape{grid-template-columns:1fr!important;gap:7px!important}.cc391-note{min-height:82px!important;max-height:108px!important}.cc391-note,.cc391-note span{font-size:16.5px!important}.cc391-side{display:grid!important;grid-template-columns:1fr 1.45fr!important;gap:6px!important;align-items:center!important}.cc391-preset-label{display:none!important}.cc391-presets{margin-top:0!important}.cc391-actions.has-next{grid-template-columns:1fr!important}}
    `;document.head.appendChild(s);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
  new MutationObserver(function(){if(!document.getElementById(ID))install();}).observe(document.documentElement,{childList:true,subtree:true});
})();


/* CC26_399 — restore the familiar pre-redesign compact reminder card.
   UI-only override: reminder selection/timing/snooze/navigation logic is unchanged.
   Candidate Notes remain sourced from the existing reminder payload. */
(function(){
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var STYLE_ID='cc399-classic-premium-reminder-style';
  function installClassicReminderStyle(){
    if(document.getElementById(STYLE_ID)) return;
    var s=document.createElement('style');
    s.id=STYLE_ID;
    s.textContent=`
      html body .cc391-reminder-deck{
        right:14px!important;bottom:14px!important;width:min(324px,calc(100vw - 22px))!important;
        font-family:Inter,"Segoe UI Variable Display","Segoe UI Variable","Segoe UI",system-ui,-apple-system,Arial,sans-serif!important;
      }
      html body .cc391-card{
        --accent:#5b63d8;--accent2:#8b5cf6;--soft:rgba(91,99,216,.11);
        border-radius:18px!important;padding:12px 13px 12px!important;color:#10233d!important;
        background:linear-gradient(145deg,rgba(255,255,255,.985),rgba(246,249,255,.965))!important;
        border:1px solid rgba(108,126,168,.22)!important;
        box-shadow:0 16px 38px rgba(32,48,82,.17),0 3px 10px rgba(32,48,82,.07)!important;
        backdrop-filter:blur(16px) saturate(116%)!important;-webkit-backdrop-filter:blur(16px) saturate(116%)!important;
      }
      html body .cc391-card::before{left:0!important;right:auto!important;top:0!important;bottom:0!important;width:4px!important;height:auto!important;background:linear-gradient(180deg,var(--accent),var(--accent2))!important}
      html body .cc391-card::after{right:-46px!important;top:-52px!important;width:140px!important;height:140px!important;background:radial-gradient(circle,var(--soft),transparent 70%)!important;opacity:.9!important}
      html body .cc391-card.interview{--accent:#f97316;--accent2:#fb923c;--soft:rgba(249,115,22,.12);background:linear-gradient(145deg,#fffdf9,#fff6ec)!important}
      html body .cc391-card.submission{--accent:#6d5ce7;--accent2:#9b7df6;--soft:rgba(109,92,231,.12);background:linear-gradient(145deg,#fefeff,#f5f3ff)!important}
      html body .cc391-card.followups{--accent:#ea6a24;--accent2:#fb7185;--soft:rgba(234,106,36,.11);background:linear-gradient(145deg,#fffdf9,#fff5ee)!important}
      html body .cc391-card.task{--accent:#0f9f7a;--accent2:#2dd4bf;--soft:rgba(15,159,122,.10);background:linear-gradient(145deg,#fbfffd,#effcf8)!important}
      html body .cc391-card.break{--accent:#e11d48;--accent2:#fb7185;--soft:rgba(225,29,72,.10);background:linear-gradient(145deg,#fff,#fff3f6)!important}
      html body .cc391-card.report{--accent:#0284c7;--accent2:#38bdf8;--soft:rgba(2,132,199,.10);background:linear-gradient(145deg,#fff,#f0faff)!important}
      html body .cc391-card.notification{--accent:#9333ea;--accent2:#c084fc;--soft:rgba(147,51,234,.10);background:linear-gradient(145deg,#fff,#faf5ff)!important}
      html body .cc391-head{min-height:25px!important;gap:6px!important}
      html body .cc391-label{font-size:10px!important;line-height:1!important;font-weight:900!important;letter-spacing:.055em!important;padding:5px 8px!important;color:var(--accent)!important;background:var(--soft)!important;border:1px solid color-mix(in srgb,var(--accent),transparent 82%)!important}
      html body .cc391-count{font-size:10px!important;font-weight:900!important;color:#42536c!important;padding:5px 7px!important;background:rgba(255,255,255,.82)!important}
      html body .cc391-x{width:25px!important;height:25px!important;border-radius:9px!important;font-size:17px!important;color:#40526c!important;background:rgba(255,255,255,.86)!important}
      html body .cc391-title{margin-top:7px!important;font-size:17px!important;line-height:1.18!important;font-weight:900!important;letter-spacing:-.018em!important;color:#10233d!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
      html body .cc391-landscape{display:block!important;margin-top:7px!important}
      html body .cc391-note{min-height:0!important;max-height:92px!important;margin:0!important;padding:9px 10px!important;border-radius:11px!important;overflow:auto!important;background:rgba(255,255,255,.80)!important;border:1px solid color-mix(in srgb,var(--accent),transparent 85%)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.86)!important}
      html body .cc391-note b{display:block!important;margin-bottom:5px!important;font-size:9.5px!important;line-height:1!important;font-weight:950!important;letter-spacing:.075em!important;color:var(--accent)!important}
      html body .cc391-note span{font-size:14.5px!important;line-height:1.38!important;font-weight:720!important;letter-spacing:-.004em!important;color:#1d334f!important}
      html body .cc391-side{display:block!important;margin-top:7px!important;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important}
      html body .cc391-time{margin:0!important;padding:7px 9px!important;border-radius:9px!important;background:var(--soft)!important;border:1px solid color-mix(in srgb,var(--accent),transparent 85%)!important}
      html body .cc391-time b{display:inline!important;margin:0 6px 0 0!important;font-size:9px!important;line-height:1!important;font-weight:950!important;color:#66768c!important;letter-spacing:.055em!important}
      html body .cc391-time span{display:inline!important;font-size:12.5px!important;line-height:1.2!important;font-weight:900!important;color:var(--accent)!important}
      html body .cc391-preset-label{margin-top:7px!important;font-size:9px!important;line-height:1!important;font-weight:900!important;color:#68788e!important;text-align:left!important;letter-spacing:.055em!important}
      html body .cc391-presets{display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:5px!important;margin-top:5px!important}
      html body .cc391-preset{height:29px!important;min-width:0!important;padding:0 3px!important;border-radius:8px!important;font-size:10.5px!important;font-weight:900!important;color:#30455f!important;background:rgba(255,255,255,.88)!important;border:1px solid rgba(119,139,172,.21)!important}
      html body .cc391-preset:hover{color:var(--accent)!important;background:var(--soft)!important;border-color:color-mix(in srgb,var(--accent),transparent 70%)!important}
      html body .cc391-actions,html body .cc391-actions.has-next{display:grid!important;grid-template-columns:1fr!important;gap:5px!important;margin-top:8px!important}
      html body .cc391-actions.has-next{grid-template-columns:minmax(0,1.35fr) minmax(0,.85fr)!important}
      html body .cc391-open,html body .cc391-next-day{min-height:34px!important;height:34px!important;border-radius:9px!important;padding:0 10px!important;font-size:12px!important;line-height:1!important;font-weight:900!important}
      html body .cc391-open{background:linear-gradient(135deg,var(--accent),var(--accent2))!important;color:#fff!important;border:0!important;box-shadow:0 6px 14px color-mix(in srgb,var(--accent),transparent 78%)!important}
      html body .cc391-next-day{background:rgba(255,255,255,.88)!important;color:var(--accent)!important;border:1px solid color-mix(in srgb,var(--accent),transparent 75%)!important}
      @media(max-width:560px){html body .cc391-reminder-deck{right:7px!important;bottom:7px!important;width:min(312px,calc(100vw - 14px))!important}html body .cc391-title{font-size:16.5px!important}html body .cc391-note span{font-size:14px!important}html body .cc391-actions.has-next{grid-template-columns:1fr!important}}
    `;
    document.head.appendChild(s);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installClassicReminderStyle,{once:true});else installClassicReminderStyle();
})();

/* CC26_399 legacy session timer retired in CC26_463. */
(function(){
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  return; // retired: CC456/CC463 is the only timer owner
  var KEY='cc399_session_work_timer';
  var STYLE='cc399-session-work-timer-style';
  var memory=null, lastSaved=0;
  function now(){return Date.now();}
  function userIdentity(){
    try{var u=JSON.parse(localStorage.getItem('careerCroxCachedUser')||'{}');return String(u.user_id||u.recruiter_code||u.username||u.email||'').trim();}catch(_){return '';}
  }
  function hasUser(){return !!userIdentity();}
  function isLogin(){return /\/login(?:\/|$)/i.test(location.pathname||'');}
  function read(){if(memory)return memory;try{memory=JSON.parse(sessionStorage.getItem(KEY)||'null');}catch(_){memory=null;}return memory;}
  function save(force){if(!memory)return;var t=now();if(!force&&t-lastSaved<10000)return;lastSaved=t;try{sessionStorage.setItem(KEY,JSON.stringify(memory));}catch(_){}}
  function clear(){memory=null;lastSaved=0;try{sessionStorage.removeItem(KEY);}catch(_){}var p=document.querySelector('.cc399-session-work-pill');if(p)p.remove();}
  function state(){
    var id=userIdentity();
    if(!id||isLogin()){clear();return null;}
    var s=read();
    if(!s||s.identity!==id){s={identity:id,accumulated_ms:0,last_at:now(),created_at:now()};memory=s;save(true);}
    return s;
  }
  function onBreak(){var old=document.querySelector('.cc379-work-timer-pill');if(old&&old.classList.contains('break'))return true;var chips=document.querySelectorAll('.lock-premium-chip');for(var i=0;i<chips.length;i++){if(/break mode|break exceeded/i.test(String(chips[i].textContent||'')))return true;}return false;}
  function format(ms){var sec=Math.max(0,Math.floor(Number(ms||0)/1000));var h=Math.floor(sec/3600);var m=Math.floor((sec%3600)/60);var s=sec%60;return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');}
  function installStyle(){
    if(document.getElementById(STYLE))return;
    var st=document.createElement('style');st.id=STYLE;st.textContent=`
      html body .cc379-work-timer-pill,html body .cc376-work-timer-pill,html body .cc378-work-timer-pill{display:none!important;visibility:hidden!important;pointer-events:none!important}
      html body .cc399-session-work-pill{position:relative!important;isolation:isolate!important;display:flex!important;align-items:center!important;gap:8px!important;min-width:146px!important;max-width:146px!important;height:46px!important;padding:6px 12px 6px 10px!important;border-radius:17px!important;border:1px solid rgba(99,102,241,.22)!important;background:linear-gradient(125deg,rgba(255,255,255,.98) 0%,rgba(239,246,255,.96) 47%,rgba(247,240,255,.95) 100%)!important;box-shadow:0 10px 24px rgba(62,76,153,.14),inset 0 1px 0 #fff!important;overflow:hidden!important;color:#17213d!important;flex:0 0 auto!important}
      html body .cc399-session-work-pill::before{content:"";position:absolute;inset:0 0 auto 0;height:2px;background:linear-gradient(90deg,#2563eb,#7c3aed,#ec4899,#f97316);z-index:-1}
      html body .cc399-session-work-pill::after{content:"";position:absolute;right:-25px;top:-31px;width:72px;height:72px;border-radius:50%;background:radial-gradient(circle,rgba(139,92,246,.18),transparent 68%);z-index:-1}
      html body .cc399-session-dot{width:9px!important;height:9px!important;border-radius:50%!important;background:#22c55e!important;box-shadow:0 0 0 4px rgba(34,197,94,.12),0 0 12px rgba(34,197,94,.35)!important;flex:0 0 9px!important}
      html body .cc399-session-work-pill.break .cc399-session-dot{background:#f59e0b!important;box-shadow:0 0 0 4px rgba(245,158,11,.12),0 0 12px rgba(245,158,11,.32)!important}
      html body .cc399-session-copy{display:block!important;min-width:0!important;line-height:1!important}
      html body .cc399-session-label{font-size:7.7px!important;line-height:1!important;font-weight:950!important;letter-spacing:.10em!important;text-transform:uppercase!important;color:#65728b!important;margin-bottom:3px!important}
      html body .cc399-session-value{font-size:16px!important;line-height:1!important;font-weight:1000!important;letter-spacing:0!important;color:#18213e!important;font-variant-numeric:tabular-nums!important;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace!important;display:block!important;min-width:72px!important}
      html body .cc399-session-sub{font-size:8.5px!important;line-height:1!important;font-weight:850!important;color:#64748b!important;margin-top:4px!important;white-space:nowrap!important}
      @media(max-width:1180px){html body .cc399-session-work-pill{min-width:124px!important;height:40px!important;padding:4px 9px!important}html body .cc399-session-value{font-size:15px!important}}
    `;document.head.appendChild(st);
  }
  function ensurePill(){
    installStyle();
    if(!hasUser()||isLogin()){clear();return null;}
    var top=document.querySelector('.topbar-right');if(!top)return null;
    var p=document.querySelector('.cc399-session-work-pill');
    if(!p){p=document.createElement('div');p.className='cc399-session-work-pill';p.title='Work time for this login session. Resets after logout.';p.innerHTML='<span class="cc399-session-dot"></span><span class="cc399-session-copy"><div class="cc399-session-label">Working Time</div><div class="cc399-session-value">00:00:00</div><div class="cc399-session-sub">This login</div></span>';top.insertBefore(p,top.firstChild);}
    return p;
  }
  function tick(){
    var s=state();if(!s)return;
    var t=now();var delta=Math.max(0,t-Number(s.last_at||t));var paused=onBreak();
    if(!paused)s.accumulated_ms=Math.max(0,Number(s.accumulated_ms||0))+delta;
    s.last_at=t;memory=s;save(false);
    var p=ensurePill();if(!p)return;p.classList.toggle('break',paused);
    var v=p.querySelector('.cc399-session-value');var sub=p.querySelector('.cc399-session-sub');if(v)v.textContent=format(s.accumulated_ms);if(sub)sub.textContent=paused?'Paused on break':'This login';
  }
  var lastPath=location.pathname;
  setInterval(function(){if(location.pathname!==lastPath){lastPath=location.pathname;if(isLogin())clear();}tick();},1000);
  window.addEventListener('beforeunload',function(){save(true);},{capture:true});
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')save(true);});
  setTimeout(tick,80);
})();


(function(){
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var STYLE_ID='cc402-polished-reminder-style';
  function installPolishedReminderStyle(){
    if(document.getElementById(STYLE_ID)) return;
    var s=document.createElement('style');
    s.id=STYLE_ID;
    s.textContent=`
      html body .cc391-reminder-deck{
        right:16px!important;bottom:16px!important;width:min(366px,calc(100vw - 22px))!important;
        font-family:Inter,"Segoe UI Variable Display","Segoe UI Variable","Segoe UI",system-ui,-apple-system,Arial,sans-serif!important;
      }
      html body .cc391-card{
        --accent:#6d5ce7;--accent2:#9b7df6;--accent3:#ec4899;--soft:rgba(109,92,231,.12);
        border-radius:22px!important;padding:13px 14px 13px!important;color:#10233d!important;
        background:linear-gradient(145deg,rgba(255,255,255,.99),rgba(247,246,255,.98) 54%,rgba(255,245,251,.96))!important;
        border:1px solid rgba(129,140,248,.22)!important;
        box-shadow:0 20px 44px rgba(40,48,96,.18),0 3px 10px rgba(32,48,82,.07)!important;
        backdrop-filter:blur(18px) saturate(118%)!important;-webkit-backdrop-filter:blur(18px) saturate(118%)!important;
        overflow:hidden!important;
      }
      html body .cc391-card::before{left:0!important;right:auto!important;top:0!important;bottom:0!important;width:5px!important;height:auto!important;background:linear-gradient(180deg,var(--accent),var(--accent2),var(--accent3))!important}
      html body .cc391-card::after{right:-44px!important;top:-48px!important;width:148px!important;height:148px!important;background:radial-gradient(circle,color-mix(in srgb,var(--accent3),transparent 86%),transparent 68%)!important;opacity:.92!important}
      html body .cc391-card.interview{--accent:#2563eb;--accent2:#60a5fa;--accent3:#8b5cf6;--soft:rgba(37,99,235,.11);background:linear-gradient(145deg,#ffffff,#f3f8ff 55%,#f2eeff)!important}
      html body .cc391-card.submission{--accent:#7c3aed;--accent2:#a78bfa;--accent3:#ec4899;--soft:rgba(124,58,237,.11);background:linear-gradient(145deg,#fff,#f8f5ff 55%,#fff1f8)!important}
      html body .cc391-card.followups{--accent:#f97316;--accent2:#fb923c;--accent3:#fb7185;--soft:rgba(249,115,22,.11);background:linear-gradient(145deg,#fff,#fff8ef 55%,#fff0f3)!important}
      html body .cc391-card.task{--accent:#0f9f7a;--accent2:#2dd4bf;--accent3:#22c55e;--soft:rgba(15,159,122,.10);background:linear-gradient(145deg,#fbfffd,#effcf8 55%,#ecfffb)!important}
      html body .cc391-card.break{--accent:#e11d48;--accent2:#fb7185;--accent3:#f97316;--soft:rgba(225,29,72,.10);background:linear-gradient(145deg,#fff,#fff5f7 55%,#fff7ed)!important}
      html body .cc391-card.report{--accent:#0284c7;--accent2:#38bdf8;--accent3:#2dd4bf;--soft:rgba(2,132,199,.10);background:linear-gradient(145deg,#fff,#f0faff 55%,#effffd)!important}
      html body .cc391-card.notification{--accent:#9333ea;--accent2:#c084fc;--accent3:#6366f1;--soft:rgba(147,51,234,.10);background:linear-gradient(145deg,#fff,#faf5ff 55%,#eef2ff)!important}
      html body .cc391-head{min-height:27px!important;gap:7px!important}
      html body .cc391-label{font-size:10px!important;line-height:1!important;font-weight:950!important;letter-spacing:.06em!important;padding:5px 9px!important;color:var(--accent)!important;background:color-mix(in srgb,var(--accent),white 90%)!important;border:1px solid color-mix(in srgb,var(--accent),transparent 82%)!important}
      html body .cc391-count{font-size:10px!important;font-weight:900!important;color:#42536c!important;padding:5px 8px!important;background:rgba(255,255,255,.84)!important}
      html body .cc391-x{width:26px!important;height:26px!important;border-radius:10px!important;font-size:17px!important;color:#40526c!important;background:rgba(255,255,255,.88)!important}
      html body .cc391-title{margin-top:8px!important;font-size:19px!important;line-height:1.15!important;font-weight:1000!important;letter-spacing:-.018em!important;color:#14233e!important;text-shadow:none!important}
      html body .cc391-landscape{display:block!important;margin-top:8px!important}
      html body .cc391-note{min-height:0!important;max-height:98px!important;margin:0!important;padding:10px 11px!important;border-radius:13px!important;overflow:auto!important;background:linear-gradient(135deg,rgba(255,255,255,.88),rgba(248,250,255,.84))!important;border:1px solid color-mix(in srgb,var(--accent),transparent 85%)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.88)!important}
      html body .cc391-note b{display:block!important;margin-bottom:6px!important;font-size:9.5px!important;line-height:1!important;font-weight:1000!important;letter-spacing:.09em!important;color:var(--accent)!important}
      html body .cc391-note span{font-size:15.5px!important;line-height:1.5!important;font-weight:760!important;letter-spacing:-.003em!important;color:#1d334f!important}
      html body .cc391-side{display:block!important;margin-top:8px!important;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important}
      html body .cc391-time{margin:0!important;padding:9px 11px!important;border-radius:11px!important;background:color-mix(in srgb,var(--accent),white 93%)!important;border:1px solid color-mix(in srgb,var(--accent),transparent 84%)!important}
      html body .cc391-time b{display:block!important;margin:0 0 4px 0!important;font-size:9px!important;line-height:1!important;font-weight:950!important;color:#66768c!important;letter-spacing:.06em!important}
      html body .cc391-time span{display:block!important;font-size:13px!important;line-height:1.3!important;font-weight:900!important;color:var(--accent)!important}
      html body .cc391-preset-label{margin-top:8px!important;font-size:9px!important;line-height:1!important;font-weight:900!important;color:#68788e!important;text-align:left!important;letter-spacing:.06em!important}
      html body .cc391-presets{display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:5px!important;margin-top:6px!important}
      html body .cc391-preset{height:30px!important;min-width:0!important;padding:0 4px!important;border-radius:10px!important;font-size:10.5px!important;font-weight:900!important;color:#30455f!important;background:rgba(255,255,255,.92)!important;border:1px solid rgba(119,139,172,.21)!important;transition:all .15s ease!important}
      html body .cc391-preset:hover{color:var(--accent)!important;background:var(--soft)!important;border-color:color-mix(in srgb,var(--accent),transparent 70%)!important;transform:translateY(-1px)!important}
      html body .cc391-actions{display:grid!important;grid-template-columns:1fr!important;gap:6px!important;margin-top:10px!important}
      html body .cc391-actions.has-next{grid-template-columns:minmax(0,1.35fr) minmax(0,.85fr)!important}
      html body .cc391-open,html body .cc391-next-day{min-height:38px!important;height:38px!important;border-radius:12px!important;padding:0 11px!important;font-size:12.5px!important;line-height:1!important;font-weight:950!important}
      html body .cc391-open{background:linear-gradient(135deg,var(--accent),var(--accent2),var(--accent3))!important;color:#fff!important;border:0!important;box-shadow:0 8px 18px color-mix(in srgb,var(--accent),transparent 77%)!important}
      html body .cc391-next-day{background:rgba(255,255,255,.9)!important;color:var(--accent)!important;border:1px solid color-mix(in srgb,var(--accent),transparent 75%)!important}
      @media(max-width:560px){html body .cc391-reminder-deck{right:7px!important;bottom:7px!important;width:min(330px,calc(100vw - 14px))!important}html body .cc391-title{font-size:17px!important}html body .cc391-note span{font-size:14.5px!important}html body .cc391-actions.has-next{grid-template-columns:1fr!important}}
    `;
    document.head.appendChild(s);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installPolishedReminderStyle,{once:true});else installPolishedReminderStyle();
})();

/* CC26_406 — RESTORE ACTUAL INITIAL ZIP REMINDER LOOK.
   Uses the exact original CC379 color palette/radius/glass treatment already present
   in the initial pre-redesign package, while KEEPING the newer CC391 reminder actions
   (5m/15m/1h/3h/6h, same-tab Open Profile, next-day interview action).
   No reminder API cadence is added here, so no extra egress is introduced. */
(function(){
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var ID='cc406-original-popup-clock-fix';
  function install(){
    var old=document.getElementById(ID); if(old) old.remove();
    var s=document.createElement('style'); s.id=ID; s.textContent=`
      html body .cc379-reminder-deck,html body .cc388-reminder-deck,html body .cc389-reminder-deck,html body .cc390-reminder-deck{display:none!important;visibility:hidden!important;pointer-events:none!important}
      html body .cc391-reminder-deck{display:block!important;visibility:visible!important;right:18px!important;bottom:18px!important;width:min(342px,calc(100vw - 34px))!important;pointer-events:none!important;font-family:Inter,system-ui,"Segoe UI",Arial,sans-serif!important}
      html body .cc391-card{--accent:#64748b;--accent2:#334155;position:relative!important;overflow:hidden!important;border-radius:24px!important;padding:14px!important;color:#fff!important;border:1px solid rgba(255,255,255,.42)!important;box-shadow:0 24px 65px rgba(15,23,42,.30)!important;pointer-events:auto!important;min-height:158px!important;background:linear-gradient(135deg,#64748b,#334155)!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
      html body .cc391-card::before{content:""!important;position:absolute!important;inset:0!important;height:auto!important;background:radial-gradient(circle at 88% 12%,rgba(255,255,255,.34),transparent 31%),linear-gradient(135deg,rgba(255,255,255,.14),rgba(255,255,255,0))!important;pointer-events:none!important;opacity:1!important}
      html body .cc391-card::after{display:none!important}
      html body .cc391-card.submission{--accent:#7c3aed;--accent2:#3b82f6;background:linear-gradient(135deg,#7c3aed,#3b82f6)!important}
      html body .cc391-card.interview{--accent:#fb923c;--accent2:#ec4899;background:linear-gradient(135deg,#fb923c,#ec4899)!important}
      html body .cc391-card.task{--accent:#14b8a6;--accent2:#22c55e;background:linear-gradient(135deg,#14b8a6,#22c55e)!important}
      html body .cc391-card.followups{--accent:#f59e0b;--accent2:#f97316;background:linear-gradient(135deg,#f59e0b,#f97316)!important}
      html body .cc391-card.break{--accent:#f97316;--accent2:#ef4444;background:linear-gradient(135deg,#f97316,#ef4444)!important}
      html body .cc391-card.idle{--accent:#6366f1;--accent2:#a855f7;background:linear-gradient(135deg,#6366f1,#a855f7)!important}
      html body .cc391-card.report{--accent:#06b6d4;--accent2:#2563eb;background:linear-gradient(135deg,#06b6d4,#2563eb)!important}
      html body .cc391-card.notification{--accent:#ef4444;--accent2:#db2777;background:linear-gradient(135deg,#ef4444,#db2777)!important}
      html body .cc391-head{position:relative!important;z-index:2!important;display:flex!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;min-height:28px!important}
      html body .cc391-label{display:inline-flex!important;padding:6px 9px!important;border-radius:999px!important;background:rgba(255,255,255,.22)!important;border:0!important;color:#fff!important;font-size:9px!important;font-weight:1000!important;text-transform:uppercase!important;letter-spacing:.06em!important}
      html body .cc391-head-actions{display:flex!important;gap:6px!important;align-items:center!important}
      html body .cc391-count{display:inline-flex!important;padding:6px 9px!important;border-radius:999px!important;background:rgba(255,255,255,.92)!important;border:0!important;color:#17345d!important;font-size:10px!important;font-weight:1000!important}
      html body .cc391-x{width:30px!important;height:30px!important;border:0!important;border-radius:12px!important;padding:0!important;background:rgba(255,255,255,.20)!important;color:#fff!important;font-size:18px!important;font-weight:1000!important}
      html body .cc391-title{position:relative!important;z-index:2!important;margin-top:10px!important;font-size:16px!important;line-height:1.15!important;font-weight:1000!important;color:#fff!important;letter-spacing:0!important;white-space:normal!important;max-height:40px!important;overflow:hidden!important;text-overflow:ellipsis!important}
      html body .cc391-landscape{position:relative!important;z-index:2!important;display:block!important;margin-top:10px!important}
      html body .cc391-note{margin:0!important;padding:10px!important;border-radius:15px!important;background:rgba(255,255,255,.92)!important;border:0!important;color:#17233b!important;font-size:11px!important;line-height:1.38!important;font-weight:850!important;min-height:46px!important;max-height:72px!important;overflow:auto!important;box-shadow:none!important}
      html body .cc391-note b{display:block!important;color:#5b6b82!important;font-size:9px!important;line-height:1!important;font-weight:1000!important;letter-spacing:.07em!important;margin-bottom:5px!important}
      html body .cc391-note span{font-size:12.5px!important;line-height:1.38!important;font-weight:850!important;color:#17233b!important}
      html body .cc391-side{display:block!important;margin-top:9px!important;padding:0!important;border:0!important;border-radius:0!important;background:transparent!important}
      html body .cc391-time{height:30px!important;border-radius:999px!important;background:rgba(255,255,255,.88)!important;border:0!important;color:#17345d!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:5px!important;padding:0 8px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
      html body .cc391-time b{display:inline!important;margin:0!important;color:#52647c!important;font-size:8.5px!important;line-height:1!important;font-weight:1000!important;letter-spacing:.04em!important}
      html body .cc391-time span{display:inline!important;color:#17345d!important;font-size:10px!important;line-height:1!important;font-weight:1000!important}
      html body .cc391-preset-label{margin-top:8px!important;color:rgba(255,255,255,.92)!important;font-size:8.5px!important;line-height:1!important;font-weight:1000!important;letter-spacing:.06em!important;text-transform:uppercase!important;text-align:left!important}
      html body .cc391-presets{display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:5px!important;margin-top:5px!important}
      html body .cc391-preset{height:29px!important;border:1px solid rgba(255,255,255,.35)!important;border-radius:10px!important;background:rgba(255,255,255,.22)!important;color:#fff!important;font-size:10px!important;font-weight:1000!important;padding:0 2px!important;box-shadow:none!important}
      html body .cc391-preset:hover{background:rgba(255,255,255,.94)!important;color:#17345d!important;border-color:rgba(255,255,255,.95)!important}
      html body .cc391-actions,html body .cc391-actions.has-next{position:relative!important;z-index:2!important;display:grid!important;grid-template-columns:1fr!important;gap:6px!important;margin-top:9px!important}
      html body .cc391-actions.has-next{grid-template-columns:minmax(0,1.25fr) minmax(0,.95fr)!important}
      html body .cc391-open,html body .cc391-next-day{height:34px!important;min-height:34px!important;border:0!important;border-radius:12px!important;padding:0 10px!important;background:rgba(255,255,255,.94)!important;color:#17345d!important;font-size:10.5px!important;font-weight:1000!important;box-shadow:none!important}
      html body .cc391-next-day{background:rgba(255,255,255,.24)!important;color:#fff!important;border:1px solid rgba(255,255,255,.30)!important}
      html body .cc399-session-work-pill{width:150px!important;min-width:150px!important;max-width:150px!important;height:44px!important;min-height:44px!important;max-height:44px!important;flex:0 0 150px!important;margin:0!important;transform:none!important;animation:none!important;border-radius:16px!important;background:linear-gradient(135deg,#ffffff,#eff6ff 52%,#f8f5ff)!important;border:1px solid rgba(96,165,250,.32)!important;box-shadow:0 9px 22px rgba(37,99,235,.10)!important}
      html body .cc399-session-value{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace!important;font-variant-numeric:tabular-nums!important;font-feature-settings:"tnum" 1!important;letter-spacing:0!important;display:block!important;width:78px!important;min-width:78px!important;text-align:left!important}
      html body .cc399-session-label{font-size:8px!important;letter-spacing:.085em!important}
      html body .cc399-session-sub{font-size:8.5px!important}
      @media(max-width:760px){html body .cc391-reminder-deck{right:10px!important;bottom:12px!important;width:calc(100vw - 20px)!important}html body .cc391-actions.has-next{grid-template-columns:1fr!important}}
    `;
    document.head.appendChild(s);
  }
  function clearTimerOnLogoutClick(e){
    var el=e&&e.target&&e.target.closest?e.target.closest('button,a'):null;if(!el)return;
    var tx=String(el.textContent||'').trim().toLowerCase();
    if(tx==='logout'||el.getAttribute('data-action')==='logout'){
      try{sessionStorage.removeItem('cc399_session_work_timer');}catch(_){}
      try{sessionStorage.removeItem('cc406_session_work_timer');}catch(_){}
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
  document.addEventListener('click',clearTimerOnLogoutClick,true);
  new MutationObserver(function(){if(!document.getElementById(ID))install();}).observe(document.documentElement,{childList:true,subtree:true});
})();


/* CC26_407 FINAL — dashboard-like gradient popup, larger readable text, popup open in new tab only. */
(function(){
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var STYLE_ID='cc407-gradient-reminder-style';
  var REMOVE_IDS=['cc394-compact-colorful-reminder-style','cc396-final-landscape-reminder-style','cc399-classic-premium-reminder-style'];
  function install(){
    REMOVE_IDS.forEach(function(id){ var el=document.getElementById(id); if(el) el.remove(); });
    if(document.getElementById(STYLE_ID)) return;
    var s=document.createElement('style'); s.id=STYLE_ID; s.textContent=`
      html body .cc391-reminder-deck{right:14px!important;bottom:14px!important;width:min(382px,calc(100vw - 22px))!important;font-family:Inter,"Segoe UI Variable Display","Segoe UI Variable","Segoe UI",system-ui,-apple-system,Arial,sans-serif!important}
      html body .cc391-card{--accent:#3b82f6;--accent2:#8b5cf6;--accent3:#ec4899;position:relative!important;border-radius:22px!important;padding:13px 14px 13px!important;color:#11233d!important;border:1px solid rgba(255,255,255,.52)!important;box-shadow:0 20px 44px rgba(31,41,55,.18),0 4px 12px rgba(31,41,55,.08)!important;backdrop-filter:blur(14px) saturate(118%)!important;-webkit-backdrop-filter:blur(14px) saturate(118%)!important;overflow:hidden!important}
      html body .cc391-card::before{content:""!important;position:absolute!important;inset:0!important;background:linear-gradient(135deg,var(--accent) 0%,var(--accent2) 56%,var(--accent3) 108%)!important;opacity:.97!important;z-index:0!important}
      html body .cc391-card::after{content:""!important;position:absolute!important;right:-72px!important;top:-72px!important;width:180px!important;height:180px!important;border-radius:999px!important;background:radial-gradient(circle,rgba(255,255,255,.32),rgba(255,255,255,0) 70%)!important;z-index:0!important}
      html body .cc391-card.interview{--accent:#ff8a3d;--accent2:#ff5d8f;--accent3:#8b5cf6}
      html body .cc391-card.submission{--accent:#5b5df7;--accent2:#8b5cf6;--accent3:#d946ef}
      html body .cc391-card.followups{--accent:#14b8a6;--accent2:#3b82f6;--accent3:#8b5cf6}
      html body .cc391-card.task{--accent:#22c55e;--accent2:#14b8a6;--accent3:#3b82f6}
      html body .cc391-card.break{--accent:#ef4444;--accent2:#f97316;--accent3:#fb7185}
      html body .cc391-card.report{--accent:#0ea5e9;--accent2:#3b82f6;--accent3:#8b5cf6}
      html body .cc391-card.notification{--accent:#8b5cf6;--accent2:#6366f1;--accent3:#ec4899}
      html body .cc391-card.idle,html body .cc391-card.generic{--accent:#64748b;--accent2:#475569;--accent3:#94a3b8}
      html body .cc391-head,html body .cc391-title,html body .cc391-landscape,html body .cc391-actions{position:relative!important;z-index:1!important}
      html body .cc391-head{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:8px!important}
      html body .cc391-label{display:inline-flex!important;align-items:center!important;background:rgba(255,255,255,.20)!important;color:#fff!important;border:1px solid rgba(255,255,255,.30)!important;border-radius:999px!important;padding:6px 10px!important;font-size:10.8px!important;font-weight:900!important;letter-spacing:.055em!important;text-transform:uppercase!important;text-shadow:0 1px 2px rgba(0,0,0,.16)!important}
      html body .cc391-head-actions{display:flex!important;align-items:center!important;gap:5px!important}
      html body .cc391-count{background:rgba(255,255,255,.22)!important;color:#fff!important;border:1px solid rgba(255,255,255,.30)!important;padding:6px 8px!important;border-radius:999px!important;font-size:10.5px!important;font-weight:900!important;text-shadow:0 1px 2px rgba(0,0,0,.14)!important}
      html body .cc391-x{width:26px!important;height:26px!important;border-radius:9px!important;border:1px solid rgba(255,255,255,.30)!important;background:rgba(255,255,255,.22)!important;color:#fff!important;font-size:17px!important;font-weight:900!important;display:grid!important;place-items:center!important;padding:0!important}
      html body .cc391-title{margin-top:9px!important;font-size:22px!important;line-height:1.14!important;font-weight:900!important;color:#fff!important;letter-spacing:-.02em!important;text-shadow:0 2px 8px rgba(15,23,42,.18)!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
      html body .cc391-landscape{display:grid!important;grid-template-columns:minmax(0,1.34fr) minmax(122px,.76fr)!important;gap:10px!important;margin-top:10px!important;align-items:stretch!important}
      html body .cc391-note{margin:0!important;background:rgba(255,255,255,.94)!important;color:#15253d!important;border:1px solid rgba(255,255,255,.58)!important;border-radius:15px!important;padding:11px 12px!important;min-height:100px!important;max-height:136px!important;overflow:auto!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.85)!important}
      html body .cc391-note b{display:block!important;margin-bottom:8px!important;font-size:10px!important;font-weight:900!important;line-height:1!important;color:var(--accent)!important;letter-spacing:.08em!important}
      html body .cc391-note span{display:block!important;font-size:17px!important;line-height:1.34!important;font-weight:800!important;color:#14263f!important;letter-spacing:-.01em!important}
      html body .cc391-side{display:flex!important;flex-direction:column!important;gap:8px!important;background:rgba(255,255,255,.18)!important;border:1px solid rgba(255,255,255,.28)!important;border-radius:15px!important;padding:9px!important}
      html body .cc391-time{background:rgba(255,255,255,.94)!important;border-radius:12px!important;padding:10px 10px!important;border:1px solid rgba(255,255,255,.64)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.84)!important}
      html body .cc391-time b{display:block!important;margin-bottom:5px!important;font-size:8.8px!important;line-height:1!important;color:#68768f!important;font-weight:900!important;letter-spacing:.08em!important}
      html body .cc391-time span{display:block!important;font-size:14.2px!important;line-height:1.24!important;font-weight:900!important;color:#152a46!important}
      html body .cc391-preset-label{margin-top:0!important;color:#fff!important;font-size:9px!important;font-weight:900!important;letter-spacing:.08em!important;text-transform:uppercase!important;text-align:center!important;text-shadow:0 1px 2px rgba(0,0,0,.14)!important}
      html body .cc391-presets{display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:4px!important;margin-top:2px!important}
      html body .cc391-preset{height:28px!important;border:1px solid rgba(255,255,255,.40)!important;border-radius:9px!important;background:rgba(255,255,255,.94)!important;color:#16304f!important;font-size:10.5px!important;font-weight:900!important;padding:0 2px!important;box-shadow:none!important;white-space:nowrap!important}
      html body .cc391-actions{display:grid!important;grid-template-columns:1fr!important;gap:7px!important;margin-top:10px!important}
      html body .cc391-actions.has-next{grid-template-columns:minmax(0,1.26fr) minmax(132px,.74fr)!important}
      html body .cc391-open,html body .cc391-next-day{height:38px!important;min-height:38px!important;border-radius:11px!important;padding:0 12px!important;font-size:13.2px!important;line-height:1!important;font-weight:900!important}
      html body .cc391-open{border:1px solid rgba(255,255,255,.34)!important;background:linear-gradient(135deg,rgba(255,255,255,.18),rgba(255,255,255,.10))!important;color:#fff!important;box-shadow:0 8px 18px rgba(17,24,39,.16)!important;text-shadow:0 1px 2px rgba(0,0,0,.18)!important}
      html body .cc391-next-day{border:1px solid rgba(255,255,255,.38)!important;background:rgba(255,255,255,.94)!important;color:#162d4f!important}
      html body .cc391-open:hover,html body .cc391-next-day:hover{transform:translateY(-1px)!important}
      @media(max-width:620px){html body .cc391-reminder-deck{right:8px!important;bottom:8px!important;width:min(95vw,382px)!important}html body .cc391-card{padding:12px!important}html body .cc391-title{font-size:20px!important}html body .cc391-landscape{grid-template-columns:1fr!important;gap:8px!important}html body .cc391-note{min-height:84px!important;max-height:118px!important}html body .cc391-note span{font-size:16px!important}html body .cc391-side{display:grid!important;grid-template-columns:1fr 1.35fr!important;align-items:center!important}html body .cc391-preset-label{display:none!important}html body .cc391-actions.has-next{grid-template-columns:1fr!important}}
    `; document.head.appendChild(s);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', install, {once:true}); else install();
  new MutationObserver(function(){ if(!document.getElementById(STYLE_ID)) install(); }).observe(document.documentElement,{childList:true,subtree:true});
})();


/* CC26_408 FINAL UI OVERRIDE
   Career Crox logo theme (blue + orange), larger readable reminder, high contrast,
   popup-only Open Profile stays new-tab, and Working Time is a zero-egress shared login timer. */
(function(){
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__CC456_SESSION_ATTENDANCE_RUNTIME__) return;
  var STYLE_ID='cc408-careercrox-reminder-clock-style';
  function installStyle(){
    if(document.getElementById(STYLE_ID)) return;
    var s=document.createElement('style'); s.id=STYLE_ID; s.textContent=`
      /* hide legacy timer visual only; legacy timer makes no network calls */
      html body .cc399-session-work-pill{display:none!important;visibility:hidden!important;pointer-events:none!important}

      html body .cc391-reminder-deck{
        right:16px!important;bottom:16px!important;width:min(470px,calc(100vw - 26px))!important;
        font-family:"Segoe UI Variable Display","Segoe UI Variable","Aptos",Inter,"Segoe UI",system-ui,-apple-system,Arial,sans-serif!important;
      }
      html body .cc391-card{
        --cc-blue:#0877c9;--cc-blue2:#18a8e0;--cc-orange:#ff6b16;--cc-orange2:#ff9a34;--cc-ink:#102b46;
        position:relative!important;border-radius:24px!important;padding:15px!important;color:var(--cc-ink)!important;
        background:linear-gradient(135deg,#f8fcff 0%,#ffffff 45%,#fff7ef 100%)!important;
        border:1px solid rgba(8,119,201,.24)!important;
        box-shadow:0 22px 50px rgba(20,65,110,.20),0 6px 18px rgba(255,107,22,.08)!important;
        backdrop-filter:blur(16px) saturate(118%)!important;-webkit-backdrop-filter:blur(16px) saturate(118%)!important;
        overflow:hidden!important;
      }
      html body .cc391-card::before{
        content:""!important;position:absolute!important;left:0!important;right:0!important;top:0!important;height:5px!important;
        background:linear-gradient(90deg,var(--cc-blue) 0%,var(--cc-blue2) 46%,var(--cc-orange) 72%,var(--cc-orange2) 100%)!important;
        z-index:0!important;
      }
      html body .cc391-card::after{
        content:""!important;position:absolute!important;right:-92px!important;top:-100px!important;width:230px!important;height:230px!important;border-radius:50%!important;
        background:radial-gradient(circle,rgba(24,168,224,.15) 0%,rgba(255,154,52,.08) 44%,transparent 70%)!important;z-index:0!important;pointer-events:none!important;
      }
      html body .cc391-head,html body .cc391-title,html body .cc391-landscape,html body .cc391-actions{position:relative!important;z-index:1!important}
      html body .cc391-head{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;min-height:30px!important}
      html body .cc391-label{
        display:inline-flex!important;align-items:center!important;padding:7px 11px!important;border-radius:999px!important;
        background:linear-gradient(135deg,#e8f6ff,#fff2e7)!important;border:1px solid rgba(8,119,201,.20)!important;
        color:#075f9f!important;font-size:11px!important;line-height:1!important;font-weight:900!important;letter-spacing:.06em!important;text-transform:uppercase!important;text-shadow:none!important;
      }
      html body .cc391-count{
        padding:7px 9px!important;border-radius:999px!important;background:#ffffff!important;border:1px solid rgba(16,43,70,.15)!important;
        color:#173954!important;font-size:11px!important;line-height:1!important;font-weight:900!important;text-shadow:none!important;
      }
      html body .cc391-x{
        width:29px!important;height:29px!important;border-radius:10px!important;background:#ffffff!important;border:1px solid rgba(16,43,70,.15)!important;
        color:#173954!important;font-size:18px!important;font-weight:900!important;display:grid!important;place-items:center!important;padding:0!important;
      }
      html body .cc391-title{
        margin-top:10px!important;font-size:25px!important;line-height:1.14!important;font-weight:900!important;letter-spacing:-.025em!important;
        color:#0d2e4c!important;text-shadow:none!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;
      }
      html body .cc391-landscape{
        display:grid!important;grid-template-columns:minmax(0,1.42fr) minmax(165px,.72fr)!important;gap:11px!important;margin-top:11px!important;align-items:stretch!important;
      }
      html body .cc391-note{
        margin:0!important;min-height:122px!important;max-height:158px!important;padding:13px 14px!important;border-radius:16px!important;overflow:auto!important;
        background:#ffffff!important;border:1px solid rgba(8,119,201,.18)!important;box-shadow:0 8px 20px rgba(8,119,201,.055),inset 0 1px 0 rgba(255,255,255,.95)!important;
      }
      html body .cc391-note b{
        display:block!important;margin-bottom:9px!important;color:#0877c9!important;font-size:10.5px!important;line-height:1!important;font-weight:900!important;letter-spacing:.09em!important;
      }
      html body .cc391-note span{
        display:block!important;color:#102b46!important;font-size:19px!important;line-height:1.42!important;font-weight:800!important;letter-spacing:-.012em!important;text-shadow:none!important;
      }
      html body .cc391-side{
        display:flex!important;flex-direction:column!important;gap:9px!important;padding:10px!important;border-radius:16px!important;
        background:linear-gradient(180deg,#edf8ff 0%,#ffffff 52%,#fff5eb 100%)!important;border:1px solid rgba(255,107,22,.18)!important;
      }
      html body .cc391-time{
        margin:0!important;padding:11px!important;border-radius:13px!important;background:#ffffff!important;border:1px solid rgba(8,119,201,.17)!important;
      }
      html body .cc391-time b{display:block!important;margin:0 0 6px!important;color:#6c7f91!important;font-size:9px!important;line-height:1!important;font-weight:900!important;letter-spacing:.075em!important}
      html body .cc391-time span{display:block!important;color:#075f9f!important;font-size:15.5px!important;line-height:1.3!important;font-weight:900!important;text-shadow:none!important}
      html body .cc391-preset-label{margin:0!important;color:#8a4a18!important;font-size:9.5px!important;line-height:1!important;font-weight:900!important;letter-spacing:.075em!important;text-transform:uppercase!important;text-align:center!important;text-shadow:none!important}
      html body .cc391-presets{display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:5px!important;margin-top:0!important}
      html body .cc391-preset{
        height:32px!important;min-width:0!important;padding:0 3px!important;border-radius:10px!important;background:#ffffff!important;border:1px solid rgba(16,43,70,.16)!important;
        color:#173954!important;font-size:11px!important;font-weight:900!important;box-shadow:none!important;white-space:nowrap!important;
      }
      html body .cc391-preset:hover{background:#fff1e4!important;border-color:rgba(255,107,22,.35)!important;color:#ba4a00!important;transform:translateY(-1px)!important}
      html body .cc391-actions{display:grid!important;grid-template-columns:1fr!important;gap:7px!important;margin-top:11px!important}
      html body .cc391-actions.has-next{grid-template-columns:minmax(0,1.35fr) minmax(150px,.65fr)!important}
      html body .cc391-open,html body .cc391-next-day{min-height:43px!important;height:43px!important;border-radius:13px!important;padding:0 14px!important;font-size:14.5px!important;line-height:1!important;font-weight:900!important}
      html body .cc391-open{
        border:0!important;background:linear-gradient(100deg,#0877c9 0%,#119bd6 46%,#ff6b16 100%)!important;color:#ffffff!important;
        box-shadow:0 10px 22px rgba(8,119,201,.19)!important;text-shadow:0 1px 2px rgba(0,0,0,.12)!important;
      }
      html body .cc391-next-day{background:#ffffff!important;color:#075f9f!important;border:1px solid rgba(8,119,201,.23)!important;box-shadow:none!important}
      html body .cc391-open:hover,html body .cc391-next-day:hover{transform:translateY(-1px)!important;filter:none!important}

      html body .cc408-work-timer-pill{
        position:relative!important;display:flex!important;align-items:center!important;gap:9px!important;width:188px!important;min-width:188px!important;max-width:188px!important;
        height:54px!important;min-height:54px!important;max-height:54px!important;flex:0 0 188px!important;margin-left:12px!important;padding:6px 11px 12px!important;border-radius:17px!important;
        background:linear-gradient(135deg,#f8fbff 0%,#ffffff 54%,#fff7ed 100%)!important;border:1px solid rgba(8,119,201,.22)!important;
        box-shadow:0 10px 24px rgba(8,119,201,.12)!important;overflow:hidden!important;color:#102b46!important;
      }
      html body .cc408-work-timer-pill::before{content:"";position:absolute;inset:0 0 auto 0;height:3px;background:linear-gradient(90deg,#0877c9,#18a8e0 52%,#ff6b16 76%,#ff9a34)}
      html body .cc408-work-dot{width:9px!important;height:9px!important;border-radius:50%!important;background:#20bf6b!important;box-shadow:0 0 0 4px rgba(32,191,107,.12)!important;flex:0 0 9px!important}
      html body .cc408-work-timer-pill.break .cc408-work-dot{background:#ff8a21!important;box-shadow:0 0 0 4px rgba(255,138,33,.13)!important}
      html body .cc408-work-timer-pill.idle .cc408-work-dot{background:#f59e0b!important;box-shadow:0 0 0 4px rgba(245,158,11,.14)!important}
      html body .cc408-work-timer-pill.locked .cc408-work-dot{background:#ef4444!important;box-shadow:0 0 0 4px rgba(239,68,68,.14)!important}
      html body .cc408-work-copy{display:block!important;min-width:0!important;line-height:1!important;flex:1 1 auto!important}
      html body .cc408-work-label{font-size:8px!important;line-height:1!important;font-weight:900!important;letter-spacing:.09em!important;text-transform:uppercase!important;color:#62788c!important;margin-bottom:3px!important}
      html body .cc408-work-value{display:block!important;width:92px!important;min-width:92px!important;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace!important;font-variant-numeric:tabular-nums!important;font-feature-settings:"tnum" 1!important;font-size:16px!important;line-height:1!important;font-weight:900!important;letter-spacing:0!important;color:#0d2e4c!important}
      html body .cc408-work-sub{font-size:8.5px!important;line-height:1!important;font-weight:800!important;color:#6f8193!important;margin-top:4px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
      html body .cc455-work-progress{position:absolute!important;left:10px!important;right:10px!important;bottom:5px!important;height:7px!important;border-radius:999px!important;background:linear-gradient(90deg,rgba(239,68,68,.16),rgba(245,158,11,.13),rgba(34,197,94,.14))!important;overflow:hidden!important;box-shadow:inset 0 1px 3px rgba(15,23,42,.14),0 1px 5px rgba(59,130,246,.08)!important}
      html body .cc455-work-progress>span{display:block!important;height:100%!important;width:0;border-radius:999px!important;transition:width .45s ease,background .45s ease!important;background:#ef4444!important}

      @media(max-width:620px){
        html body .cc391-reminder-deck{right:8px!important;bottom:8px!important;width:min(96vw,470px)!important}
        html body .cc391-card{padding:12px!important}
        html body .cc391-title{font-size:22px!important}
        html body .cc391-landscape{grid-template-columns:1fr!important;gap:8px!important}
        html body .cc391-note{min-height:96px!important;max-height:130px!important}
        html body .cc391-note span{font-size:17px!important}
        html body .cc391-side{display:grid!important;grid-template-columns:1fr 1.4fr!important;align-items:center!important}
        html body .cc391-preset-label{display:none!important}
        html body .cc391-actions.has-next{grid-template-columns:1fr!important}
      }
    `; document.head.appendChild(s);
  }

  // CC26_640: Keep the reminder-card appearance above, but never start the
  // retired CC408 timer. CC456 owns all clock arithmetic and DOM updates.
  installStyle();
  return;
  var TIMER_KEY='cc456_session_activity_state';
  var ACTIVITY_KEY='cc434_work_activity_at';
  var ACTIVE_IDLE_GRACE_MS=2*60*1000;
  var FULL_DAY_MS=9*60*60*1000;
  var WRITE_EVERY_MS=5000;
  function now(){return Date.now();}
  function getUser(){try{return JSON.parse(localStorage.getItem('careerCroxCachedUser')||'{}')||{};}catch(_){return {};}}
  function identity(){var u=getUser();return String(u.user_id||u.recruiter_code||u.username||u.email||'').trim();}
  function loginMarker(){try{return String(localStorage.getItem('careerCroxSessionLoginAt')||'').trim();}catch(_){return '';}}
  function officeJoin(){try{var x=JSON.parse(localStorage.getItem('careerCroxOfficeJoinedSession')||'null');return x&&x.identity===identity()&&x.login_marker===loginMarker()&&x.joined_at?x:null;}catch(_){return null;}}
  function isLogin(){return /\/login(?:\/|$)/i.test(location.pathname||'');}
  function readState(){try{var x=JSON.parse(localStorage.getItem(TIMER_KEY)||'null');return x&&typeof x==='object'?x:null;}catch(_){return null;}}
  function writeState(x,force){try{var t=now();if(!force&&Number(x._last_write_at||0)&&t-Number(x._last_write_at||0)<WRITE_EVERY_MS)return;x._last_write_at=t;localStorage.setItem(TIMER_KEY,JSON.stringify(x));}catch(_){}}
  function clearState(){try{localStorage.removeItem(TIMER_KEY);localStorage.removeItem(ACTIVITY_KEY);}catch(_){}document.querySelectorAll('.cc408-work-timer-pill,.cc379-work-timer-pill,.cc455-work-timer-pill,.cc456-work-pill,.cc456-work-timer-pill').forEach(function(p){try{p.remove();}catch(_){}});}
  function breakActive(){var old=document.querySelector('.cc379-work-timer-pill,.cc399-session-work-pill');if(old&&old.classList.contains('break'))return true;var chips=document.querySelectorAll('.lock-premium-chip');for(var i=0;i<chips.length;i++){if(/break mode|break exceeded/i.test(String(chips[i].textContent||'')))return true;}return false;}
  function crmLocked(){return !!document.querySelector('.crm-lock-backdrop,.crm-lock-modal,.break-overdue-modal');}
  function lastActivity(){try{return Math.max(0,Number(localStorage.getItem(ACTIVITY_KEY)||0)||0);}catch(_){return 0;}}
  function markActivity(){var t=now();var joined=officeJoin();if(!joined)return;var marker=loginMarker();var loginStart=Number(marker||0)||0;var joinStart=new Date(joined.joined_at||0).getTime()||0;var officeStart=Math.max(loginStart,joinStart);if(officeStart&&t<officeStart)return;try{localStorage.setItem(ACTIVITY_KEY,String(t));}catch(_){} }
  function format(ms){var sec=Math.max(0,Math.floor(Number(ms||0)/1000));var h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');}
  function sessionStarts(joined,t){var marker=loginMarker();var loginStart=Number(marker||0)||0;if(!Number.isFinite(loginStart)||loginStart<=0)loginStart=0;var joinStart=new Date(joined&&joined.joined_at||0).getTime()||0;if(!Number.isFinite(joinStart)||joinStart<=0)joinStart=0;var headerStart=loginStart||joinStart||t;var officeStart=Math.max(loginStart||0,joinStart||0)||headerStart;return {headerStart:headerStart,officeStart:officeStart};}
  function freshState(id,marker,joined,t){try{localStorage.removeItem(ACTIVITY_KEY);}catch(_){}/* CC456_UPGRADE_CLEAR_LEGACY_ACTIVITY */var starts=sessionStarts(joined,t),elapsed=Math.max(0,t-starts.officeStart),grace=Math.min(elapsed,ACTIVE_IDLE_GRACE_MS);return {version:456,identity:id,login_marker:marker,started_at:starts.headerStart,office_started_at:starts.officeStart,last_tick_at:Math.max(starts.officeStart,t),active_ms:0,idle_ms:Math.max(0,elapsed-grace),break_ms:0,grace_ms:grace,last_activity_at:0,_last_write_at:0};}
  function normalizeState(st,id,marker,joined,t){var starts=sessionStarts(joined,t);if(!st||st.identity!==id||(marker&&st.login_marker!==marker))return freshState(id,marker,joined,t);var oldVersion=Number(st.version||0);st.version=456;st.identity=id;st.login_marker=marker;st.started_at=starts.headerStart;st.office_started_at=starts.officeStart;st.active_ms=Math.max(0,Number(st.active_ms||0)||0);st.idle_ms=Math.max(0,Number(st.idle_ms||0)||0);st.break_ms=Math.max(0,Number(st.break_ms||0)||0);st.grace_ms=Math.max(0,Number(st.grace_ms||0)||0);st.last_activity_at=Math.max(0,Number(st.last_activity_at||0)||0);st.last_tick_at=Math.max(starts.officeStart,Number(st.last_tick_at||0)||starts.officeStart);
    if(oldVersion<456){var elapsed=Math.max(0,t-starts.officeStart);var la=lastActivity();var realLa=la>=starts.officeStart?la:0;st.last_activity_at=realLa;if(!st.active_ms&&!st.idle_ms&&!st.break_ms&&!st.grace_ms){st.grace_ms=Math.min(elapsed,ACTIVE_IDLE_GRACE_MS);st.idle_ms=Math.max(0,elapsed-st.grace_ms);st.last_tick_at=t;}}
    return st;}
  function ensurePill(){
    var top=document.querySelector('.topbar-right');if(!top)return null;
    document.querySelectorAll('.cc379-work-timer-pill,.cc455-work-timer-pill,.cc456-work-pill,.cc456-work-timer-pill').forEach(function(node){try{node.remove();}catch(_){}});
    var p=document.querySelector('.cc408-work-timer-pill');
    if(!p){p=document.createElement('div');p.className='cc408-work-timer-pill';p.title='Active work for the current login. Break, idle and lock are excluded.';p.innerHTML='<span class="cc408-work-dot"></span><span class="cc408-work-copy"><div class="cc408-work-label">Working Time</div><div class="cc408-work-value">00:00:00</div><div class="cc408-work-sub">Current login</div></span><div class="cc455-work-progress"><span></span></div>';var anchor=top.children&&top.children.length?top.children[0]:null;anchor&&anchor.nextSibling?top.insertBefore(p,anchor.nextSibling):top.appendChild(p);}
    return p;
  }
  function tick(){
    installStyle();
    var id=identity();
    if(!id||isLogin()){clearState();return;}
    var joined=officeJoin();
    if(!joined){var old=document.querySelector('.cc408-work-timer-pill');if(old)old.remove();return;}
    var marker=loginMarker(),t=now(),st=normalizeState(readState(),id,marker,joined,t);
    var officeStart=Math.max(0,Number(st.office_started_at||t));
    var lastTick=Math.max(officeStart,Math.min(t,Number(st.last_tick_at||officeStart)));
    var dt=Math.max(0,t-lastTick);
    var onBreak=breakActive(),locked=crmLocked();
    var la=lastActivity();if(la>=officeStart)st.last_activity_at=la;
    var hasRecentActivity=Boolean(st.last_activity_at&&t-st.last_activity_at<ACTIVE_IDLE_GRACE_MS);
    var officeElapsed=Math.max(0,t-officeStart);
    if(dt>0){
      if(onBreak)st.break_ms+=dt;
      else if(locked)st.idle_ms+=dt;
      else if(hasRecentActivity)st.active_ms+=dt;
      else if(officeElapsed<=ACTIVE_IDLE_GRACE_MS)st.grace_ms+=dt;
      else st.idle_ms+=dt;
    }
    st.last_tick_at=t;
    var elapsed=Math.max(0,officeElapsed);
    var activeElapsed=Math.max(0,Number(st.active_ms||0)||0);
    var progress=Math.max(0,Math.min(100,(activeElapsed/FULL_DAY_MS)*100));
    var hue=Math.round(120*(progress/100));
    var idle=!onBreak&&!locked&&!hasRecentActivity&&officeElapsed>ACTIVE_IDLE_GRACE_MS;
    var p=ensurePill();if(!p)return;
    p.classList.toggle('break',onBreak);p.classList.toggle('idle',idle);p.classList.toggle('locked',locked);
    var v=p.querySelector('.cc408-work-value'),sub=p.querySelector('.cc408-work-sub'),fill=p.querySelector('.cc455-work-progress>span');
    if(v)v.textContent=format(activeElapsed);
    if(sub)sub.textContent=onBreak?'Break • active work paused':locked?'CRM locked • active work paused':idle?'Idle • active work paused':'Active work • '+Math.round(progress)+'% of 9h';
    if(fill){fill.style.width=progress.toFixed(2)+'%';fill.style.background='linear-gradient(90deg,hsl('+Math.max(0,hue-10)+' 88% 48%),hsl('+hue+' 82% 42%))';}
    writeState(st,false);
    try{window.dispatchEvent(new CustomEvent('career-crox-work-session-tick',{detail:{...st,elapsed_ms:elapsed,active_elapsed_ms:activeElapsed,office_elapsed_ms:officeElapsed,on_break:onBreak,locked:locked,idle:idle,progress_percent:progress}}));}catch(_){}
  }
  installStyle();
  ['mousedown','keydown','touchstart','click','wheel','scroll'].forEach(function(ev){window.addEventListener(ev,markActivity,{passive:true,capture:true});});
  setInterval(tick,1000);setTimeout(tick,60);
  window.addEventListener('storage',function(e){if(e&&e.key==='careerCroxCachedUser'&&!e.newValue)clearState();});
  window.addEventListener('career-crox-work-timer-reset',function(){clearState();});
  window.addEventListener('career-crox-office-joined',function(){try{localStorage.removeItem(ACTIVITY_KEY);localStorage.removeItem(TIMER_KEY);}catch(_){}tick();});
})();

/* CC26_411 COMPACT CARD REMINDER FINAL
   Screenshot-matched compact footprint with recent-note-card styling and hard contrast.
   Visual-only: reminder timing, snooze logic, API cadence, storage and popup-only new-tab profile behavior are unchanged. */
(function(){
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  var ID='cc411-compact-card-reminder-style';
  function install(){
    if(document.getElementById(ID)) return;
    var s=document.createElement('style');s.id=ID;s.textContent=`
      html body .cc391-reminder-deck{
        right:12px!important;bottom:12px!important;width:min(262px,calc(100vw - 18px))!important;
        font-family:"Segoe UI Variable Display","Segoe UI Variable","Aptos",Inter,"Segoe UI",system-ui,-apple-system,Arial,sans-serif!important;
      }
      html body .cc391-card{
        --card1:#167fc0;--card2:#23a5d5;--card3:#ff8b34;--ink:#102b46;
        position:relative!important;border-radius:16px!important;padding:10px 10px 9px!important;color:#fff!important;
        background:linear-gradient(145deg,var(--card1) 0%,var(--card2) 74%,var(--card3) 150%)!important;
        border:1px solid rgba(7,77,126,.22)!important;box-shadow:0 14px 32px rgba(21,58,96,.20),0 3px 8px rgba(15,23,42,.08)!important;
        overflow:hidden!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;
      }
      html body .cc391-card::before{content:""!important;position:absolute!important;inset:0 0 auto 0!important;height:3px!important;background:linear-gradient(90deg,#ff8b34,#ffc36a)!important;opacity:1!important;z-index:0!important}
      html body .cc391-card::after{display:none!important}
      html body .cc391-card.submission{--card1:#5d59df;--card2:#7263e8;--card3:#ff8b45!important;background:linear-gradient(145deg,var(--card1) 0%,var(--card2) 76%,var(--card3) 155%)!important}
      html body .cc391-card.interview{--card1:#0877c9;--card2:#18a8e0;--card3:#ff8b34!important;background:linear-gradient(145deg,var(--card1) 0%,var(--card2) 76%,var(--card3) 155%)!important}
      html body .cc391-card.followups{--card1:#e76b22;--card2:#f08a28;--card3:#ef5971!important;background:linear-gradient(145deg,var(--card1) 0%,var(--card2) 76%,var(--card3) 155%)!important}
      html body .cc391-card.task{--card1:#0a8f70;--card2:#22ad7f;--card3:#31c6a2!important;background:linear-gradient(145deg,var(--card1) 0%,var(--card2) 76%,var(--card3) 155%)!important}
      html body .cc391-card.break{--card1:#c73b5e;--card2:#e45472;--card3:#f28a52!important;background:linear-gradient(145deg,var(--card1) 0%,var(--card2) 76%,var(--card3) 155%)!important}
      html body .cc391-card.report{--card1:#0877c9;--card2:#1d9ed2;--card3:#40bfd0!important;background:linear-gradient(145deg,var(--card1) 0%,var(--card2) 76%,var(--card3) 155%)!important}
      html body .cc391-card.notification{--card1:#713bc1;--card2:#8755d7;--card3:#e65b96!important;background:linear-gradient(145deg,var(--card1) 0%,var(--card2) 76%,var(--card3) 155%)!important}
      html body .cc391-card.idle,html body .cc391-card.generic{--card1:#4e647b;--card2:#637b91;--card3:#8194a4!important;background:linear-gradient(145deg,var(--card1) 0%,var(--card2) 76%,var(--card3) 155%)!important}
      html body .cc391-head,html body .cc391-title,html body .cc391-landscape,html body .cc391-actions{position:relative!important;z-index:1!important}
      html body .cc391-head{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:5px!important;min-height:24px!important}
      html body .cc391-label{
        display:inline-flex!important;align-items:center!important;max-width:154px!important;padding:5px 7px!important;border-radius:999px!important;
        background:#fff!important;border:1px solid rgba(255,255,255,.72)!important;color:#173955!important;
        font-size:9.4px!important;line-height:1!important;font-weight:950!important;letter-spacing:.045em!important;text-transform:uppercase!important;text-shadow:none!important;
        white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;
      }
      html body .cc391-head-actions{display:flex!important;align-items:center!important;gap:4px!important}
      html body .cc391-count{padding:5px 6px!important;border-radius:999px!important;background:#fff!important;border:1px solid rgba(255,255,255,.72)!important;color:#173955!important;font-size:9px!important;line-height:1!important;font-weight:950!important;text-shadow:none!important;white-space:nowrap!important}
      html body .cc391-x{width:24px!important;height:24px!important;border-radius:8px!important;background:#fff!important;border:1px solid rgba(255,255,255,.72)!important;color:#183a55!important;font-size:16px!important;font-weight:950!important;display:grid!important;place-items:center!important;padding:0!important;line-height:1!important}
      html body .cc391-title{margin-top:6px!important;font-size:17px!important;line-height:1.16!important;font-weight:950!important;letter-spacing:-.018em!important;color:#fff!important;text-shadow:0 1px 2px rgba(0,0,0,.15)!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
      html body .cc391-landscape{display:grid!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important;gap:6px!important;margin-top:6px!important;align-items:stretch!important}
      html body .cc391-note{margin:0!important;min-height:0!important;max-height:102px!important;padding:7px 8px!important;border-radius:10px!important;overflow:auto!important;background:#fff!important;border:1px solid rgba(255,255,255,.78)!important;box-shadow:none!important;color:#102b46!important}
      html body .cc391-note b{display:block!important;margin:0 0 4px!important;color:#31566f!important;font-size:8.3px!important;line-height:1!important;font-weight:950!important;letter-spacing:.075em!important}
      html body .cc391-note span{display:block!important;color:#102b46!important;font-size:14.2px!important;line-height:1.3!important;font-weight:800!important;letter-spacing:-.006em!important;text-shadow:none!important}
      html body .cc391-side{display:block!important;margin-top:0!important;padding:6px!important;border-radius:10px!important;background:#fff!important;border:1px solid rgba(255,255,255,.78)!important;box-shadow:none!important}
      html body .cc391-time{display:block!important;margin:0!important;padding:5px 7px!important;border-radius:8px!important;background:#eef8ff!important;border:1px solid #cce8f7!important;box-shadow:none!important;white-space:normal!important;overflow:visible!important}
      html body .cc391-time b{display:block!important;margin:0 0 3px!important;color:#49647a!important;font-size:8.2px!important;line-height:1!important;font-weight:950!important;letter-spacing:.065em!important;text-transform:uppercase!important}
      html body .cc391-time span{display:block!important;color:#0a568b!important;font-size:12.2px!important;line-height:1.14!important;font-weight:950!important;text-shadow:none!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important;text-align:center!important}
      html body .cc391-preset-label{margin:5px 0 0!important;padding:0!important;background:transparent!important;border:0!important;color:#49647a!important;font-size:8.5px!important;line-height:1!important;font-weight:950!important;letter-spacing:.065em!important;text-transform:uppercase!important;text-align:left!important;text-shadow:none!important}
      html body .cc391-presets{display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:3px!important;margin-top:4px!important}
      html body .cc391-preset{height:24px!important;min-width:0!important;padding:0 1px!important;border-radius:6px!important;background:#fff!important;border:1px solid #b9d9ec!important;color:#173955!important;font-size:9px!important;line-height:1!important;font-weight:950!important;box-shadow:none!important;white-space:nowrap!important;opacity:1!important}
      html body .cc391-preset:hover{background:#eaf7ff!important;border-color:#72b7de!important;color:#084f80!important;transform:none!important}
      html body .cc391-actions{display:grid!important;grid-template-columns:1fr!important;gap:5px!important;margin-top:6px!important}
      html body .cc391-actions.has-next{grid-template-columns:1fr!important}
      html body .cc391-open,html body .cc391-next-day{min-height:30px!important;height:30px!important;border-radius:8px!important;padding:0 8px!important;font-size:11.8px!important;line-height:1!important;font-weight:950!important;opacity:1!important}
      html body .cc391-open{border:1px solid rgba(255,255,255,.75)!important;background:#fff!important;color:#0c5e91!important;box-shadow:none!important;text-shadow:none!important}
      html body .cc391-next-day{background:#fff4ea!important;color:#9b4808!important;border:1px solid #ffd1ae!important;box-shadow:none!important}
      html body .cc391-open:hover,html body .cc391-next-day:hover{transform:none!important;filter:brightness(.98)!important}
      @media(max-width:420px){
        html body .cc391-reminder-deck{right:7px!important;bottom:7px!important;width:min(262px,calc(100vw - 14px))!important}
      }
    `;document.head.appendChild(s);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
  // Re-append once after the module finishes so this final visual layer always sits after legacy reminder CSS.
  setTimeout(function(){var current=document.getElementById(ID);if(current)current.remove();install();},0);
  new MutationObserver(function(){if(!document.getElementById(ID))install()}).observe(document.documentElement,{childList:true,subtree:true});
})();


/* CC26_583 FINAL REMINDER OVERRIDE */
(function(){
  var ID='cc583-reminder-final-style';
  function install(){
    if(document.getElementById(ID))return;
    var s=document.createElement('style');s.id=ID;s.textContent=`
      .cc391-reminder-deck{width:min(352px,calc(100vw - 24px))!important;font-family:Arial,"Plus Jakarta Sans",Segoe UI,sans-serif!important}
      .cc391-card{border-radius:22px!important;padding:13px!important;color:#fff!important;cursor:pointer!important;box-shadow:0 22px 48px rgba(15,23,42,.30),inset 0 1px 0 rgba(255,255,255,.25)!important}
      .cc391-label{font-size:12.5px!important;font-weight:1000!important;padding:7px 11px!important;border-radius:999px!important;background:linear-gradient(135deg,rgba(255,255,255,.34),rgba(255,255,255,.16))!important;border:1px solid rgba(255,255,255,.30)!important;color:#fff!important}
      .cc391-title{margin-top:9px!important;font-size:21px!important;line-height:1.14!important;font-weight:1000!important;color:#fff!important}
      .cc391-note{margin-top:9px!important;background:linear-gradient(180deg,#fff,#f5f9ff)!important;color:#102f55!important;border-radius:15px!important;padding:11px 12px 12px!important;min-height:86px!important;max-height:124px!important;overflow:auto!important;font-family:Arial,"Plus Jakarta Sans",Segoe UI,sans-serif!important;box-shadow:0 8px 18px rgba(21,55,109,.10)!important}
      .cc391-note b{display:block!important;font:900 12px Arial,"Plus Jakarta Sans",sans-serif!important;letter-spacing:.04em!important;color:#315780!important;margin-bottom:6px!important}.cc391-note span{font:800 15px/1.42 Arial,"Plus Jakarta Sans",sans-serif!important;color:#102f55!important}
      .cc391-time{margin-top:8px!important;background:linear-gradient(135deg,#fff,#edf5ff)!important;border-radius:12px!important;padding:8px 10px!important;color:#14375f!important;font-size:13.5px!important;font-weight:1000!important;text-align:center!important}.cc391-time b,.cc391-time span{display:inline!important;color:#14375f!important}.cc391-time b{margin-right:5px!important}
      .cc391-landscape{display:block!important}.cc391-side{display:block!important}.cc391-actions:empty{display:none!important}
      .cc391-preset-label{margin-top:9px!important;font-size:11.5px!important;font-weight:1000!important;color:#fff!important}.cc391-presets{display:grid!important;grid-template-columns:repeat(4,1fr)!important;gap:7px!important;margin-top:6px!important}.cc391-preset{height:36px!important;border-radius:11px!important;background:linear-gradient(135deg,rgba(255,255,255,.30),rgba(255,255,255,.16))!important;color:#fff!important;font-size:13.5px!important;font-weight:1000!important}
      .cc391-x{width:32px!important;height:32px!important;border-radius:11px!important;background:linear-gradient(135deg,#ffb348,#ff5a65 55%,#7c5cff)!important;color:#fff!important;font-size:21px!important;box-shadow:0 8px 18px rgba(65,32,95,.25),inset 0 1px 0 rgba(255,255,255,.35)!important;animation:cc583ClosePulse 1.45s ease-in-out infinite!important}@keyframes cc583ClosePulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
      @media(max-width:700px){.cc391-reminder-deck{width:min(340px,calc(100vw - 16px))!important}.cc391-title{font-size:19px!important}.cc391-note{min-height:80px!important}.cc391-note span{font-size:14px!important}}
      @media(prefers-reduced-motion:reduce){.cc391-x{animation:none!important}}
    `;document.head.appendChild(s);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
