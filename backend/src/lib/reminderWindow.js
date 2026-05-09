const REMINDER_LOOKAHEAD_MINUTES = Number(process.env.CRM_REMINDER_LOOKAHEAD_MINUTES || 10);
const REMINDER_LOOKAHEAD_MS = Math.max(0, REMINDER_LOOKAHEAD_MINUTES) * 60 * 1000;

function reminderTriggerNowMs(baseMs = Date.now()) {
  return Number(baseMs || Date.now()) + REMINDER_LOOKAHEAD_MS;
}

function parseReminderTime(value) {
  const stamp = new Date(value || 0).getTime();
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
