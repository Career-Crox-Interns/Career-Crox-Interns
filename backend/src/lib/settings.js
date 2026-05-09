const { store, table, mode } = require('./store');

const DEFAULT_SETTINGS = {
  crm_lock_idle_minutes: '10',
  crm_lock_no_call_minutes: '15',
  crm_lock_break_limit_minutes: '120',
  crm_lock_break_warning_minutes: '3',
  crm_lock_reminder_minutes: '3',
  live_refresh_seconds: '8',
  notification_popup_seconds: '3',
  approval_popup_repeat_minutes: '3',
  logout_nudge_time: '18:30',
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

async function ensureDefaultSettings() {
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
}

async function getSettingsMap() {
  await ensureDefaultSettings();
  const rows = await table('settings');
  const out = { ...DEFAULT_SETTINGS };
  for (const row of rows) out[row.setting_key] = row.setting_value;
  return out;
}

async function setSettingsMap(patch = {}) {
  await ensureSettingsTable();
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    await store.upsert('settings', 'setting_key', {
      setting_key: key,
      setting_value: String(value ?? DEFAULT_SETTINGS[key]),
      notes: 'Manager-updated CRM setting',
      Instructions: '',
    });
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
