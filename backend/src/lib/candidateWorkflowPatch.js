'use strict';

// A submission changes workflow state only. Never re-write full_name or phone
// when approving/submitting a record that already has an immutable identity.
// The caller validates business rules against the complete, normalized row,
// but writes only the explicit workflow delta.
const ALLOWED = Object.freeze([
  'call_connected', 'approval_status', 'approval_requested_at', 'status',
  'all_details_sent', 'submitted_by', 'approved_at', 'approved_by_name',
  'submission_date', 'updated_at',
]);
function candidateSubmissionWorkflowPatch(normalizedRow) {
  if (!normalizedRow || typeof normalizedRow !== 'object' || Array.isArray(normalizedRow)) throw new TypeError('Normalized candidate row is required');
  const patch = {};
  for (const key of ALLOWED) {
    if (Object.prototype.hasOwnProperty.call(normalizedRow, key)) patch[key] = normalizedRow[key];
  }
  // If normalization/schema changes later, never allow the workflow write to
  // turn a blank note/phone/name into a modification of an existing person.
  if (patch.approval_status !== 'Pending') throw new Error('Only pending submission workflow may use this patch');
  return patch;
}
module.exports = { candidateSubmissionWorkflowPatch, ALLOWED };
