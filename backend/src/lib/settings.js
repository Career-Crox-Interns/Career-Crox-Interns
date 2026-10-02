const { store, table, mode } = require('./store');

const DEFAULT_SETTINGS = {
  crm_monitor_idle_warning_minutes: '5',
  crm_monitor_no_call_warning_minutes: '15',
  crm_monitor_low_call_window_minutes: '60',
  crm_monitor_low_call_min_calls: '5',
  crm_monitor_alert_repeat_minutes: '15',
  crm_activity_window_minutes: '2',
  crm_lock_idle_minutes: '10',
  crm_lock_no_call_minutes: '20',
  crm_lock_break_limit_minutes: '120',
  crm_lock_break_warning_minutes: '1',
  crm_lock_reminder_minutes: '3',
  live_refresh_seconds: '8',
  notification_popup_seconds: '3',
  approval_popup_repeat_minutes: '3',
  logout_nudge_time: '18:30',
  aria_report_start_time: '09:00',
  aria_report_end_time: '21:00',

  // Attendance Parameters: admin controlled, effective from the configured date onward.
  attendance_rules_effective_from: '',
  attendance_daily_salary_amount: '0',
  attendance_full_day_work_minutes: '540',
  attendance_half_day_work_minutes: '300',
  attendance_zero_day_work_minutes: '300',
  attendance_min_talktime_minutes: '0',
  attendance_min_calling_count: '0',
  attendance_min_outgoing_calls: '0',
  attendance_min_incoming_calls: '0',
  attendance_min_submissions: '0',
  attendance_min_selections: '0',
  attendance_min_interviews: '0',
  attendance_min_joinings: '0',
  attendance_shift_login_time: '10:00',
  attendance_shift_logout_time: '19:00',
  attendance_late_grace_minutes: '10',
  attendance_late_half_day_after_count: '3',
  attendance_break_limit_minutes: '480',
  attendance_break_overrun_lock_grace_seconds: '180',
};

async function ensureSettingsTable() {
  if (mode !== 'postgres' || !store.pool) return;
  await store.pool.query(`
    create table if not exists public.settings (
      setting_key text primary key,
      setting_value text,
      notes text,
      "Instructions" text
    )
  `);
}

// CC26_598: shared, bounded settings reads. The previous heartbeat performed a
// schema check + two whole-settings reads per request. Never cache credentials or
// employee attendance; only non-personal app settings, for at most 12 seconds.
let defaultsReady = false;
let defaultsInFlight = null;
let settingsCache = null;
let settingsInFlight = null;
let settingsRevision = 0;
async function ensureDefaultSettings() {
  if (defaultsReady) return;
  if (defaultsInFlight) return defaultsInFlight;
  defaultsInFlight = (async () => {
    await ensureSettingsTable();
    const rows = await table('settings');
    const existing = new Map(rows.map((row) => [row.setting_key, row]));
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (!existing.has(key)) {
        await store.upsert('settings', 'setting_key', {
          setting_key: key,
          setting_value: value,
          notes: 'Auto-created CRM setting',
          Instructions: '',
        });
      }
    }
    defaultsReady = true;
  })();
  try { await defaultsInFlight; }
  finally { defaultsInFlight = null; }
}

async function getSettingsMap() {
  if (settingsCache && Date.now() < settingsCache.expires) return { ...settingsCache.value };
  if (settingsInFlight) return { ...(await settingsInFlight) };
  const version = settingsRevision;
  const current = (async () => {
    await ensureDefaultSettings();
    const rows = await table('settings');
    const out = { ...DEFAULT_SETTINGS };
    for (const row of rows) out[row.setting_key] = row.setting_value;
    if (version === settingsRevision) settingsCache = { value: out, expires: Date.now() + 12000 };
    return out;
  })();
  settingsInFlight = current;
  try { return { ...(await current) }; }
  finally { if (settingsInFlight === current) settingsInFlight = null; }
}

async function setSettingsMap(patch = {}) {
  if ('aria_report_start_time' in patch || 'aria_report_end_time' in patch) {
    const time = (v) => { const m = /^(\d{2}):(00|30)$/.exec(String(v || '')); if (!m || +m[1] > 23) return NaN; return +m[1] * 60 + +m[2]; };
    const start = time(patch.aria_report_start_time ?? DEFAULT_SETTINGS.aria_report_start_time);
    const end = time(patch.aria_report_end_time ?? DEFAULT_SETTINGS.aria_report_end_time);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start < 30) {
      const e = new Error('ARIA times must be 30-minute steps in IST, with end at least 30 minutes after start.');
      e.status = 400; throw e;
    }
  }
  settingsRevision += 1;
  settingsCache = null;
  settingsInFlight = null;
  await ensureSettingsTable();
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULT_SETTINGS)) continue;
      await store.upsert('settings', 'setting_key', {
        setting_key: key,
        setting_value: String(value ?? DEFAULT_SETTINGS[key]),
        notes: 'Manager-updated CRM setting',
        Instructions: '',
      });
    }
  } finally { settingsRevision += 1; settingsCache = null; settingsInFlight = null; }
  if ('aria_report_start_time' in patch || 'aria_report_end_time' in patch) {
    // Reschedule in memory immediately. Do not start an extra timer or run a report on save.
    require('../controllers/semiHourlyController').setAriaShiftTimes(
      patch.aria_report_start_time || DEFAULT_SETTINGS.aria_report_start_time,
      patch.aria_report_end_time || DEFAULT_SETTINGS.aria_report_end_time
    );
  }
  return getSettingsMap();
}

module.exports = {
  DEFAULT_SETTINGS,
  ensureSettingsTable,
  ensureDefaultSettings,
  getSettingsMap,
  setSettingsMap,
};
