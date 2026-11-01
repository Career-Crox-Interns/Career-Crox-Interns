const REMINDER_LOOKAHEAD_MINUTES = Number(process.env.CRM_REMINDER_LOOKAHEAD_MINUTES || 20);
const REMINDER_LOOKAHEAD_MS = Math.max(0, REMINDER_LOOKAHEAD_MINUTES) * 60 * 1000;

function reminderTriggerNowMs(baseMs = Date.now()) {
  return Number(baseMs || Date.now()) + REMINDER_LOOKAHEAD_MS;
}

function parseReminderTime(value, dateOnlyTime = '00:00:00') {
  if (value instanceof Date) {
    const stamp = value.getTime();
    return Number.isFinite(stamp) && stamp > 0 ? stamp : 0;
  }
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : 0;
  let text = String(value || '').trim();
  if (!text) return 0;
  // CRM datetime-local fields are entered in India. Render runs in UTC, so a
  // timezone-less value must be interpreted as IST instead of server time.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    text = `${text}T${dateOnlyTime || '00:00:00'}+05:30`;
  } else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text)) {
    text = `${text.replace(' ', 'T')}+05:30`;
  }
  const stamp = Date.parse(text);
  return Number.isFinite(stamp) && stamp > 0 ? stamp : 0;
}

function isReminderEligible(value, baseMs = Date.now()) {
  const stamp = parseReminderTime(value);
  return Boolean(stamp && stamp <= reminderTriggerNowMs(baseMs));
}

function dueInMinutes(value, baseMs = Date.now()) {
  const stamp = parseReminderTime(value);
  return stamp ? Math.round((stamp - Number(baseMs || Date.now())) / 60000) : '';
}

module.exports = {
  REMINDER_LOOKAHEAD_MINUTES,
  REMINDER_LOOKAHEAD_MS,
  reminderTriggerNowMs,
  parseReminderTime,
  isReminderEligible,
  dueInMinutes,
};
