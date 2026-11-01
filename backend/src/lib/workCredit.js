// Credit the union of real activity windows once; never turn an idle gap into work.
function workCreditMinutes(presence, at, activityAt, hasActivity, windowMinutes = 2, lockExempt = false) {
  if (String(presence.is_on_break || '0') === '1' || (String(presence.locked || '0') === '1' && !lockExempt)) return 0;
  const from = Date.parse(presence.activity_credit_at || presence.work_started_at || '');
  if (!Number.isFinite(from) || from >= at) return 0;
  const size = Math.max(1, Number(windowMinutes) || 2) * 60000;
  const prior = Date.parse(presence.last_activity_at || presence.work_started_at || '');
  const latest = Number(activityAt);
  const valid = Number.isFinite(latest) && latest > 0 && latest <= at;
  if (!hasActivity && !(valid && at - latest < size)) return 0;
  const spans = [prior, valid ? latest : hasActivity ? at : NaN]
    .filter(Number.isFinite).map(t => [Math.max(from, t), Math.min(at, t + size)])
    .filter(([a,b]) => b > a).sort((a,b) => a[0] - b[0]);
  let total = 0, end = from;
  for (const [a,b] of spans) { total += Math.max(0, b - Math.max(a,end)); end = Math.max(end,b); }
  return Math.min(at - from, size, total) / 60000;
}
module.exports = { workCreditMinutes };
