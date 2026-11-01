let revision = 1;
let changedAt = new Date().toISOString();
let lastReason = 'startup';

function bumpCallChange(reason = 'call_update') {
  revision += 1;
  if (revision > Number.MAX_SAFE_INTEGER - 1000) revision = 2;
  changedAt = new Date().toISOString();
  lastReason = String(reason || 'call_update').slice(0, 80);
  return revision;
}

function getCallChangeSnapshot() {
  return { revision, changed_at: changedAt, reason: lastReason };
}

module.exports = { bumpCallChange, getCallChangeSnapshot };
