'use strict';
// A completed details checklist can advance a candidate to interview-ready.
// It must never downgrade someone who has appeared, been selected, joined,
// backed out, or been rejected. Approval remains a separate workflow.
const readyStates = new Set(['','draft','in - progress','in-progress','approved','all set for interview']);
const clean = value => String(value || '').trim().toLowerCase();
function statusAfterDetailsCompletion(before, nextDetails, requestedStatus) {
  if (clean(nextDetails)!=='completed' || clean(before?.all_details_sent)==='completed') return null;
  if (!readyStates.has(clean(before?.status))) return null;
  if (!readyStates.has(clean(requestedStatus ?? before?.status))) return null;
  return 'All set for Interview';
}
module.exports = { statusAfterDetailsCompletion };
