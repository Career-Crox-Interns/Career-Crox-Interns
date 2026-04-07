function nowIso() {
  return new Date().toISOString();
}

function ymd() {
  return nowIso().slice(0, 10);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeIndianPhone(value) {
  let digits = digitsOnly(value);
  while (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length > 10) digits = digits.slice(-10);
  return digits;
}

function phoneMatches(value, query) {
  const valueDigits = normalizeIndianPhone(value);
  const queryDigits = normalizeIndianPhone(query);
  if (!queryDigits) return false;
  return valueDigits.includes(queryDigits) || queryDigits.includes(valueDigits);
}

function containsText(value, query) {
  const source = String(value || '').toLowerCase();
  const target = String(query || '').toLowerCase();
  if (source.includes(target)) return true;
  return phoneMatches(value, query);
}

function nextId(prefix, rows, field) {
  let max = 0;
  for (const row of rows) {
    const numeric = Number(String(row[field] || '').replace(/\D/g, ''));
    if (!Number.isNaN(numeric) && numeric > max) max = numeric;
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}


function splitCsvValues(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function recruiterCodeMatches(sourceValue, recruiterCode) {
  const target = String(recruiterCode || '').trim().toLowerCase();
  if (!target) return false;
  return splitCsvValues(sourceValue).some((item) => item.toLowerCase() === target);
}

function buildCsv(rows) {
  if (!rows.length) return 'no_data\n';
  const cols = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  return [cols.join(','), ...rows.map((row) => cols.map((col) => esc(row[col])).join(','))].join('\n');
}

function toNumber(value) {
  const n = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function calcExperienceRange(value) {
  const months = toNumber(value);
  if (!months) return 'Fresher';
  if (months <= 3) return '1 - 3 Month';
  if (months <= 6) return '4 - 6 Month';
  if (months <= 12) return '7 - 12 Month';
  if (months <= 18) return '1 - 1.5 Year';
  if (months <= 24) return '1.6 - 2 Year';
  if (months <= 30) return '2 - 2.5 Year';
  if (months <= 36) return '2.6 - 3 Year';
  if (months <= 42) return '3 - 3.5 Year';
  if (months <= 48) return '3.6 - 4 Year';
  if (months <= 54) return '4 - 4.5 Year';
  if (months <= 60) return '4.6 - 5 Year';
  return '5+ Year';
}

function calcSalaryRange(value) {
  const amount = toNumber(value);
  if (!amount) return '0';
  if (amount <= 15000) return '₹1K - ₹15K';
  if (amount <= 20000) return '₹16K - ₹20K';
  if (amount <= 25000) return '₹21K - ₹25K';
  if (amount <= 30000) return '₹26K - ₹30K';
  return '₹31K - ₹35K';
}

module.exports = {
  nowIso,
  ymd,
  clone,
  containsText,
  digitsOnly,
  normalizeIndianPhone,
  phoneMatches,
  nextId,
  splitCsvValues,
  recruiterCodeMatches,
  buildCsv,
  toNumber,
  calcExperienceRange,
  calcSalaryRange,
};
