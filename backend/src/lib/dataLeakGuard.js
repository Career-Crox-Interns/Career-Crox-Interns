const { normalizeIndianPhone } = require('./helpers');

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function isLeadershipUser(user) {
  return ['admin', 'manager', 'tl'].includes(lower(user?.role));
}

function maskPhoneValue(phone) {
  const digits = normalizeIndianPhone(phone || '');
  return digits || String(phone || '').trim();
}

function sanitizeCandidateForUser(row, user) {
  if (!row || typeof row !== 'object') return row;
  const clone = { ...row };
  const digits = normalizeIndianPhone(clone.phone || '');
  const fullPhone = digits || String(clone.phone || '').trim();
  clone.phone = fullPhone;
  clone.phone_masked = fullPhone;
  clone.phone_redacted = false;
  return clone;
}

function sanitizeCandidateListForUser(rows, user) {
  return Array.isArray(rows) ? rows.map((row) => sanitizeCandidateForUser(row, user)) : [];
}

module.exports = {
  isLeadershipUser,
  maskPhoneValue,
  sanitizeCandidateForUser,
  sanitizeCandidateListForUser,
};
