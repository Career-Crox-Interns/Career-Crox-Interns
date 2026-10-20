'use strict';

// CC847: candidate_id is a PERSON identity, not an editable form slot.
// Once both name and phone are recorded, a normal Save cannot repurpose that ID.
// The guard is intentionally stricter than ordinary field validation. Genuine
// identity corrections require a separately audited manager recovery workflow.
function normalizedName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}
function normalizedPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}
function identityDelta(previous = {}, next = {}) {
  const firstName = normalizedName(previous.full_name);
  const firstPhone = normalizedPhone(previous.phone);
  const incomingName = normalizedName(next.full_name);
  const incomingPhone = normalizedPhone(next.phone);
  const established = Boolean(firstName && firstPhone);
  const nameChanged = Boolean(firstName && incomingName !== firstName);
  const phoneChanged = Boolean(firstPhone && incomingPhone !== firstPhone);
  return { established, nameChanged, phoneChanged };
}
function assertCandidateIdentityStable(previous = {}, next = {}) {
  const delta = identityDelta(previous, next);
  if (!delta.established || (!delta.nameChanged && !delta.phoneChanged)) return;
  const error = new Error('Candidate identity is locked. This ID already belongs to a saved person. Open New Candidate for another person; ask Manager for an audited correction if the original name/phone is genuinely wrong. No changes were saved.');
  error.status = 409;
  error.code = 'CANDIDATE_IDENTITY_LOCKED';
  throw error;
}
module.exports = { normalizedName, normalizedPhone, identityDelta, assertCandidateIdentityStable };
