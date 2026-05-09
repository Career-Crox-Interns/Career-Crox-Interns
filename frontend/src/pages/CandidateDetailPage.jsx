import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { buildCandidateUrl, readCandidateNavContext } from '../lib/candidateNav';
import { useAuth } from '../lib/auth';
import { addNoteTemplate, addWhatsAppTemplate, getNoteTemplates, getWhatsAppTemplates } from '../lib/templateStore';
import { dialCandidateWithLog, openWhatsAppWithLog, visiblePhone } from '../lib/candidateAccess';
import SafeSectionBoundary from '../components/SafeSectionBoundary';

const CAREER_GAP_OPTIONS = ['Fresher', 'Currently Working', '1 - 3 Month', '4 - 6 Month', '7 - 12 Month', '1 - 1.5 Year', '1.6 - 2 Year'];
const STATUS_OPTIONS = ['In - Progress', 'All set for Interview', 'Appeared in Interview', 'Selected', 'Rejected', 'Not Intrested', 'Not Responding', 'Rejected once, needs new Interview', 'Joined', 'Active'];
const WEEKDAY_CHOICES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CALL_CONNECTED_OPTIONS = ['No', 'Yes', 'Partially'];
const LOOKING_FOR_JOB_OPTIONS = ['Yes', 'No'];
const PROFILE_PRIORITY_OPTIONS = ['High', 'Medium', 'Low'];
const DEGREE_OPTIONS = ['NON - Graduate', 'Graduate'];
const DETAILS_SENT_OPTIONS = ['Pending', 'Completed'];
const COMMUNICATION_SKILL_OPTIONS = ['Excellent', 'Good', 'Normal', 'Average', 'Below Average'];
const EXPERIENCE_RANGE_OPTIONS = ['Fresher', '1 - 3 Month', '4 - 6 Month', '7 - 12 Month', '1 - 1.5 Year', '1.6 - 2 Year', '2 - 2.5 Year', '2.6 - 3 Year', '3 - 3.5 Year', '3.6 - 4 Year', '4 - 4.5 Year', '4.6 - 5 Year', '5+ Year'];
const SALARY_RANGE_OPTIONS = ['0', '₹1K - ₹15K', '₹16K - ₹20K', '₹21K - ₹25K', '₹26K - ₹30K', '₹31K - ₹35K'];
const PREFERRED_LOCATIONS = ['Noida', 'Gurgaon', 'Mumbai'];
const PREFERRED_LOCATION_STORAGE_KEY = 'careerCroxPreferredLocations_v3';
const INTERVIEW_MODE_OPTIONS = ['Virtual', 'Walkin'];
const DOCUMENTS_OPTIONS = ['Yes', 'No', 'Partially'];

const GLOBAL_CANDIDATE_PROFILE_CACHE = {};
const GLOBAL_CANDIDATE_PROFILE_CACHE_KEYS = [];
const MAX_GLOBAL_CANDIDATE_PROFILE_CACHE = 45;

const PROFILE_NOTES_LIMIT = 60;
const PROFILE_TIMELINE_LIMIT = 80;
const PROFILE_FILES_LIMIT = 20;
const PROFILE_NAV_LIMIT = 25;

function safeText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? fallback : value.toISOString();
  try {
    const compact = JSON.stringify(value);
    return compact === undefined ? fallback : compact;
  } catch {
    return fallback;
  }
}

function safeArray(value) {
  return Array.isArray(value) ? value.filter((row) => row !== null && row !== undefined) : [];
}

function safeTemplateList(value, limit = 80) {
  return safeArray(value)
    .map((item) => safeText(item).trim())
    .filter(Boolean)
    .slice(0, Math.max(0, Number(limit || 0) || 0));
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function trimSafeArray(value, limit = 100) {
  return safeArray(value).slice(0, Math.max(0, Number(limit || 0) || 0));
}

function sanitizeCandidateItem(source) {
  const raw = safeObject(source);
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || value === undefined) out[key] = '';
    else if (Array.isArray(value)) out[key] = value.map((item) => safeText(item)).filter(Boolean).join(', ');
    else if (typeof value === 'object') out[key] = safeText(value);
    else out[key] = value;
  }
  return out;
}

function sanitizeNoteRow(row, index = 0) {
  const raw = safeObject(row);
  return {
    ...raw,
    id: safeText(raw.id || raw.note_id || `note-${index}`),
    candidate_id: safeText(raw.candidate_id),
    username: safeText(raw.username || raw.created_by_name || raw.user_name || 'Someone'),
    body: safeText(raw.body || raw.note || raw.notes || ''),
    created_at: safeText(raw.created_at || raw.updated_at || ''),
    note_type: safeText(raw.note_type || 'public'),
    parent_note_id: safeText(raw.parent_note_id || ''),
    reply_to_note_id: safeText(raw.reply_to_note_id || ''),
    reply_to_username: safeText(raw.reply_to_username || ''),
    reply_preview: safeText(raw.reply_preview || ''),
  };
}

function sanitizeActivityRow(row, index = 0) {
  const raw = safeObject(row);
  let metadata = raw.metadata;
  if (metadata && typeof metadata === 'object') metadata = safeText(metadata, '{}');
  return {
    ...raw,
    activity_id: safeText(raw.activity_id || raw.id || `activity-${index}`),
    user_id: safeText(raw.user_id || ''),
    username: safeText(raw.username || raw.user_name || raw.created_by_name || ''),
    action_type: safeText(raw.action_type || 'activity'),
    candidate_id: safeText(raw.candidate_id || ''),
    metadata: safeText(metadata || '{}', '{}'),
    created_at: safeText(raw.created_at || raw.updated_at || ''),
  };
}

function sanitizeCandidateFileRow(row, index = 0) {
  const raw = safeObject(row);
  return {
    ...raw,
    file_id: safeText(raw.file_id || raw.id || `file-${index}`),
    candidate_id: safeText(raw.candidate_id || ''),
    file_kind: safeText(raw.file_kind || ''),
    original_name: safeText(raw.original_name || raw.file_name || raw.name || ''),
    file_name: safeText(raw.file_name || raw.original_name || raw.name || ''),
    mime_type: safeText(raw.mime_type || ''),
    size_bytes: Number(raw.size_bytes || 0) || 0,
    created_at: safeText(raw.created_at || ''),
  };
}

function sanitizeNavRow(row, index = 0) {
  const raw = safeObject(row);
  return {
    ...raw,
    candidate_id: safeText(raw.candidate_id || raw.id || ''),
    full_name: safeText(raw.full_name || raw.name || `Profile ${index + 1}`),
  };
}

function sanitizeProfilePayload(rawData, fallbackItem = null) {
  const data = safeObject(rawData);
  const itemSource = data.item || fallbackItem || null;
  return {
    item: itemSource ? ensureCandidateDefaults(sanitizeCandidateItem(itemSource)) : null,
    notes: trimSafeArray(data.notes, PROFILE_NOTES_LIMIT).map(sanitizeNoteRow),
    timeline: trimSafeArray(data.timeline, PROFILE_TIMELINE_LIMIT).map(sanitizeActivityRow),
    process_options: trimSafeArray(data.process_options, 120).map((item) => safeText(item)).filter(Boolean),
    recruiter_options: trimSafeArray(data.recruiter_options, 120).map((row, idx) => ({ ...safeObject(row), user_id: safeText(safeObject(row).user_id || `recruiter-${idx}`), recruiter_code: safeText(safeObject(row).recruiter_code || ''), full_name: safeText(safeObject(row).full_name || safeObject(row).username || '') })),
    nav_items: trimSafeArray(data.nav_items, PROFILE_NAV_LIMIT).map(sanitizeNavRow).filter((row) => row.candidate_id),
    files: trimSafeArray(data.files, PROFILE_FILES_LIMIT).map(sanitizeCandidateFileRow),
  };
}

function sanitizeCachedProfilePayload(cached, fallbackItem = null) {
  if (!cached || typeof cached !== 'object') return null;
  return sanitizeProfilePayload(cached, fallbackItem);
}


function rememberCandidateProfileCache(candidateId, payload) {
  const key = String(candidateId || '').trim();
  if (!key || !payload?.item) return;
  if (!Object.prototype.hasOwnProperty.call(GLOBAL_CANDIDATE_PROFILE_CACHE, key)) GLOBAL_CANDIDATE_PROFILE_CACHE_KEYS.push(key);
  GLOBAL_CANDIDATE_PROFILE_CACHE[key] = payload;
  while (GLOBAL_CANDIDATE_PROFILE_CACHE_KEYS.length > MAX_GLOBAL_CANDIDATE_PROFILE_CACHE) {
    const oldest = GLOBAL_CANDIDATE_PROFILE_CACHE_KEYS.shift();
    if (oldest) delete GLOBAL_CANDIDATE_PROFILE_CACHE[oldest];
  }
}

const FOLLOW_UP_PRESETS = [
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '2h', minutes: 120 },
  { label: '4h', minutes: 240 },
  { label: 'Tomorrow 10AM', custom: 'tomorrow10' },
];

const PROCESS_STORAGE_KEY = 'careerCroxCustomProcessOptions_v1';
function readStoredProcessOptions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROCESS_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map((item) => safeText(item).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}
function persistProcessOptions(options) {
  try { localStorage.setItem(PROCESS_STORAGE_KEY, JSON.stringify([...new Set(safeArray(options).map((item) => safeText(item).trim()).filter(Boolean))])); } catch {}
}
function applyAutoRangesToCandidate(row) {
  const next = ensureCandidateDefaults(row || {});
  if (!String(next.relevant_experience_range || '').trim() && String(next.relevant_experience || '').trim()) {
    next.relevant_experience_range = expRange(String(parseMonthCount(next.relevant_experience)));
  }
  if (!String(next.relevant_in_hand_range || '').trim() && String(next.in_hand_salary || '').trim()) {
    next.relevant_in_hand_range = salaryRange(next.in_hand_salary);
  }
  return next;
}

const DEFAULT_CANDIDATE_FIELD_ORDER = [
  'full_name','phone','location','qualification','preferred_location','qualification_level','total_experience','relevant_experience',
  'relevant_experience_range','ctc_monthly','in_hand_salary','relevant_in_hand_range','career_gap','documents_availability',
  'communication_skill','follow_up_at','interview_reschedule_date','virtual_onsite','status','profile_priority','all_details_sent','submission_date',
  'process','call_connected','looking_for_job','master_notes'
];

const expRange = (value) => {
  const months = Number(String(value || '').replace(/[^\d.]/g, '')) || 0;
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
};

const salaryRange = (value) => {
  const amount = Number(String(value || '').replace(/[^\d.]/g, '')) || 0;
  if (!amount) return '0';
  if (amount <= 15000) return '₹1K - ₹15K';
  if (amount <= 20000) return '₹16K - ₹20K';
  if (amount <= 25000) return '₹21K - ₹25K';
  if (amount <= 30000) return '₹26K - ₹30K';
  return '₹31K - ₹35K';
};

function normalizeIndianPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  while (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length > 10) digits = digits.slice(-10);
  return digits;
}

function normalizeQualificationCategory(value, fallbackQualification = '') {
  const rawValue = String(value || '').trim();
  const rawFallback = String(fallbackQualification || '').trim();
  const current = rawValue.toLowerCase();
  if (current === 'non - graduate' || current === 'non-graduate' || current === 'nongraduate') return 'NON - Graduate';
  if (current === 'graduate') return 'Graduate';
  const combined = `${rawValue} ${rawFallback}`.trim().toLowerCase();
  if (/(^|\b)(non[\s-]*grad|under[\s-]*grad|undergraduate|ug pursuing|pursuing|appearing|final year|last year|12th|10th|intermediate|higher secondary|hsc|diploma|iti)(\b|$)/i.test(combined)) return 'NON - Graduate';
  if (/(^|\b)(post[\s-]*grad|graduate|b\.?a|b\.?com|b\.?sc|b\.?tech|btech|bca|bba|mba|mca|m\.?a|m\.?com|m\.?sc|mtech|m\.?tech|phd|master|bachelor)(\b|$)/i.test(combined)) return 'Graduate';
  return 'Graduate';
}

function interpolateJdTemplate(template, candidate, jd) {
  return String(template || '')
    .replaceAll('{candidate_name}', candidate?.full_name || 'Candidate')
    .replaceAll('{candidate_number}', candidate?.phone || '')
    .replaceAll('{jd_name}', jd?.job_title || 'JD')
    .replaceAll('{company}', jd?.company || '')
    .replaceAll('{process}', jd?.process_name || jd?.job_title || '');
}

function splitMulti(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function toggleMultiValue(current, value, keepOneSelected = false) {
  const list = splitMulti(current);
  const exists = list.includes(value);
  if (exists) {
    if (keepOneSelected && list.length <= 1) return list.join(', ');
    return list.filter((item) => item !== value).join(', ');
  }
  return [...list, value].join(', ');
}

function readStoredPreferredLocations() {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFERRED_LOCATION_STORAGE_KEY) || '[]');
    if (!Array.isArray(stored)) return [...PREFERRED_LOCATIONS];
    return [...new Set([...PREFERRED_LOCATIONS, ...stored.map((item) => String(item || '').trim()).filter(Boolean)])];
  } catch {
    return [...PREFERRED_LOCATIONS];
  }
}

function persistPreferredLocations(options = []) {
  try {
    const cleaned = [...new Set(safeArray(options).map((item) => String(item || '').trim()).filter(Boolean))];
    localStorage.setItem(PREFERRED_LOCATION_STORAGE_KEY, JSON.stringify(cleaned.filter((item) => !PREFERRED_LOCATIONS.includes(item))));
  } catch {}
}

function localDateOnlyFromDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function toInputDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const direct = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;
  const d = new Date(raw);
  return localDateOnlyFromDate(d);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function nowDateTimeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function addMinutesDateTimeLocal(minutes = 0) {
  const d = new Date(Date.now() + Number(minutes || 0) * 60000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function tomorrowAt(hour = 10, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, minute, 0, 0);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function parseMonthCount(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Number(raw) || 0;
  const yearMatch = raw.match(/(\d+(?:\.\d+)?)\s*y/);
  const monthMatch = raw.match(/(\d+(?:\.\d+)?)\s*m/);
  const years = yearMatch ? Number(yearMatch[1]) || 0 : 0;
  const months = monthMatch ? Number(monthMatch[1]) || 0 : 0;
  if (yearMatch || monthMatch) return Math.round((years * 12) + months);
  const numeric = Number(raw.replace(/[^\d.]/g, '')) || 0;
  return numeric;
}


function parseMoneyValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  return Number(raw.replace(/[^\d.]/g, '')) || 0;
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function isDigitsOnlyValue(value) {
  return /^\d*$/.test(String(value || ''));
}

function hasExperienceMismatch(item) {
  const totalMonths = parseMonthCount(item?.total_experience || '');
  const relevantMonths = parseMonthCount(item?.relevant_experience || '');
  if (!relevantMonths) return false;
  return relevantMonths > totalMonths;
}

function hasSalaryMismatch(item) {
  const ctcValue = parseMoneyValue(item?.ctc_monthly || '');
  const inHandValue = parseMoneyValue(item?.in_hand_salary || '');
  if (!ctcValue || !inHandValue) return false;
  return ctcValue < inHandValue;
}

function splitExperienceValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { years: '', months: '' };
  const totalMonths = parseMonthCount(raw);
  if (!totalMonths && raw !== '0') return { years: '', months: '' };
  return { years: String(Math.floor(totalMonths / 12)), months: String(totalMonths % 12) };
}

function joinExperienceValue(years, months) {
  const cleanYears = Math.max(0, Number(String(years || '').replace(/[^\d]/g, '')) || 0);
  const cleanMonths = Math.max(0, Math.min(11, Number(String(months || '').replace(/[^\d]/g, '')) || 0));
  return String((cleanYears * 12) + cleanMonths);
}

function formatExperiencePreview(value) {
  const totalMonths = parseMonthCount(value);
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const parts = [];
  if (years) parts.push(`${years} Year${years === 1 ? '' : 's'}`);
  if (months || !parts.length) parts.push(`${months} Month${months === 1 ? '' : 's'}`);
  return parts.join(' ');
}

function toDateTimeLocalInput(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return raw;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00` : raw;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatTwelveHour(value) {
  const local = toDateTimeLocalInput(value);
  if (!local) return '';
  const [datePart, timePart] = local.split('T');
  const [year, month, day] = datePart.split('-');
  let [hours, minutes] = timePart.split(':').map(Number);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day}-${month}-${year} ${pad2(hours)}:${pad2(minutes)} ${suffix}`;
}

function formatLastViewedStamp(value) {
  if (!value) return 'Never Opened';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatFileSize(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const payload = result.includes(',') ? result.split(',').pop() : result;
      resolve(payload || '');
    };
    reader.onerror = () => reject(new Error('File could not be read.'));
    reader.readAsDataURL(file);
  });
}

function normalizeIssueLines(input) {
  return [...new Set(String(input || '')
    .split(/\s*[•\n]+\s*/)
    .map((line) => String(line || '').trim())
    .filter(Boolean))];
}

function buildSubmitValidation(item) {
  const required = [
    ['full_name', 'Name'],
    ['phone', 'Number'],
    ['location', 'Location'],
    ['qualification', 'Qualification'],
    ['preferred_location', 'Preferred Location'],
    ['qualification_level', 'Degree'],
    ['total_experience', 'Total Experience'],
    ['relevant_experience', 'Relevant Experience'],
    ['communication_skill', 'Communication Skill'],
    ['in_hand_salary', 'In-hand Monthly'],
    ['ctc_monthly', 'CTC Monthly'],
    ['career_gap', 'Career Gap'],
    ['relevant_experience_range', 'Relevant Experience Range'],
    ['relevant_in_hand_range', 'Relevant In-hand Range'],
    ['interview_reschedule_date', 'Interview Date'],
    ['status', 'Status'],
    ['all_details_sent', 'All Details Sent'],
    ['submission_date', 'Submission Date'],
    ['virtual_onsite', 'Interview Mode'],
    ['documents_availability', 'All Documents Availability'],
  ];
  const missingPairs = required.filter(([key]) => !String(item?.[key] || '').trim());
  const lookingForJobBlocked = String(item?.looking_for_job || 'Yes').trim().toLowerCase() !== 'yes';
  const callConnectedIssue = String(item?.call_connected || 'No').trim().toLowerCase() !== 'yes' && (missingPairs.length || lookingForJobBlocked);
  const flaggedPairs = [
    lookingForJobBlocked ? ['looking_for_job', 'Looking For Job'] : null,
    callConnectedIssue ? ['call_connected', 'Call Connected'] : null,
  ].filter(Boolean);

  const seen = new Set();
  const missing = [];
  const flagged = [];
  const missingKeys = [];
  for (const [key, label] of [...missingPairs, ...flaggedPairs]) {
    if (seen.has(key)) continue;
    seen.add(key);
    missingKeys.push(key);
    if (missingPairs.some(([missingKey]) => missingKey == key)) missing.push(label);
    else flagged.push(label);
  }

  const experienceMismatch = hasExperienceMismatch(item);
  const salaryMismatch = hasSalaryMismatch(item);
  if (experienceMismatch) {
    missingKeys.push('total_experience', 'relevant_experience');
  }
  if (salaryMismatch) {
    missingKeys.push('ctc_monthly', 'in_hand_salary');
  }

  const issues = [];
  if (lookingForJobBlocked) issues.push('Looking For Job is set to No. Save is allowed, but submit is blocked.');
  if (callConnectedIssue) issues.push(`Call Connected is still ${String(item?.call_connected || 'No')}. Complete the connected-call step or finish the pending details before submit.`);
  if (missing.length) issues.push(`Missing fields: ${missing.join(', ')}`);
  if (flagged.length) issues.push(`Check these fields: ${flagged.join(', ')}`);
  if (experienceMismatch) issues.push('Relevant Experience must stay equal to or lower than Total Experience.');
  if (salaryMismatch) issues.push('CTC Monthly cannot stay lower than In-hand Monthly Salary.');
  if (issues.length) {
    return {
      ok: false,
      message: 'Submit blocked. Fix the issues below.',
      issues,
      missingKeys: [...new Set(missingKeys)],
    };
  }
  return { ok: true, message: '', issues: [], missingKeys: [] };
}

function nextDateForWeekday(label) {
  const target = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(label);
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const delta = (target - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return localDateOnlyFromDate(d);
}

function normalizeDocumentsAvailability(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return 'Yes';
  if (['yes', 'available', 'all available', 'done'].includes(text)) return 'Yes';
  if (['partially', 'partial', 'some available', 'partly'].includes(text)) return 'Partially';
  if (['no', 'not available', 'missing'].includes(text)) return 'No';
  return value;
}

function stableOptions(options = [], value = '') {
  const cleaned = safeArray(options).map((item) => safeText(item).trim()).filter(Boolean);
  const current = safeText(value).trim();
  if (current && !cleaned.includes(current)) cleaned.push(current);
  return [...new Set(cleaned)];
}

function ensureCandidateDefaults(source) {
  if (!source) return source;
  const safePhone = source.phone_redacted ? String(source.phone_masked || source.phone || '') : normalizeIndianPhone(source.phone || '');
  return {
    ...source,
    phone: safePhone,
    phone_masked: source.phone_masked || (source.phone_redacted ? safePhone : normalizeIndianPhone(source.phone || '')),
    call_connected: source.call_connected || 'No',
    looking_for_job: source.looking_for_job || 'Yes',
    preferred_location: source.preferred_location || 'Noida',
    qualification_level: normalizeQualificationCategory(source.qualification_level || source.degree || '', source.qualification || ''),
    career_gap: source.career_gap || 'Fresher',
    status: source.status || 'In - Progress',
    profile_priority: source.profile_priority || 'Medium',
    all_details_sent: source.all_details_sent || 'Pending',
    virtual_onsite: source.virtual_onsite || 'Walkin',
    documents_availability: normalizeDocumentsAvailability(source.documents_availability || 'Yes'),
    submission_date: toDateTimeLocalInput(source.submission_date || nowDateTimeLocal()) || nowDateTimeLocal(),
  };
}

function clonePlain(value) {
  try { return JSON.parse(JSON.stringify(value ?? null)); }
  catch { return null; }
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeCandidatePayload(source) {
  let payload = {};
  try { payload = JSON.parse(JSON.stringify(sanitizeCandidateItem(source || {}))); }
  catch { payload = sanitizeCandidateItem(source || {}); }
  delete payload.jd_fit_summary;
  delete payload.notes_list;
  delete payload.timeline;
  delete payload.nav_items;
  delete payload.process_options;
  return payload;
}

function sameCandidatePayload(left, right) {
  try {
    return JSON.stringify(sanitizeCandidatePayload(left || {})) === JSON.stringify(sanitizeCandidatePayload(right || {}));
  } catch {
    return false;
  }
}

function makeOptimisticNote(body, username, extra = {}) {
  return {
    id: `optimistic-note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    body,
    username,
    created_at: nowIso(),
    note_type: 'public',
    optimistic: true,
    ...extra,
  };
}

function normalizeNoteId(value) {
  const raw = String(value ?? '').trim();
  return raw || '';
}

function noteAuthorName(note) {
  return String(note?.username || '').trim() || 'Someone';
}

function shortNotePreview(value, limit = 88) {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'No text';
  return cleaned.length > limit ? `${cleaned.slice(0, Math.max(18, limit - 1)).trim()}…` : cleaned;
}

function formatNoteStamp(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function buildNoteThreads(noteRows = []) {
  const list = trimSafeArray(noteRows, PROFILE_NOTES_LIMIT).map(sanitizeNoteRow).filter(Boolean);
  const notesById = new Map(list.map((row) => [normalizeNoteId(row?.id), row]));
  const repliesByRoot = new Map();
  const roots = [];
  list.forEach((row) => {
    const selfId = normalizeNoteId(row?.id);
    const rootId = normalizeNoteId(row?.parent_note_id);
    const replyToId = normalizeNoteId(row?.reply_to_note_id);
    if (!rootId || !notesById.has(rootId) || rootId === selfId) {
      roots.push(row);
      return;
    }
    const bucket = repliesByRoot.get(rootId) || [];
    const target = notesById.get(replyToId) || notesById.get(rootId) || null;
    bucket.push({
      ...row,
      thread_root_id: rootId,
      reply_target_note: target || (row?.reply_to_username || row?.reply_preview ? {
        username: row?.reply_to_username || '',
        body: row?.reply_preview || '',
      } : null),
    });
    repliesByRoot.set(rootId, bucket);
  });
  const desc = (a, b) => String(b?.created_at || '').localeCompare(String(a?.created_at || '')) || String(b?.id || '').localeCompare(String(a?.id || ''));
  const asc = (a, b) => String(a?.created_at || '').localeCompare(String(b?.created_at || '')) || String(a?.id || '').localeCompare(String(b?.id || ''));
  return roots
    .sort(desc)
    .map((root) => ({
      root,
      replies: (repliesByRoot.get(normalizeNoteId(root?.id)) || []).sort(asc),
    }));
}

function makeOptimisticTimeline(actionType, username, metadata = {}) {
  return {
    activity_id: `optimistic-${actionType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action_type: actionType,
    username,
    created_at: nowIso(),
    metadata: JSON.stringify(metadata || {}),
    optimistic: true,
  };
}

function timelineText(row, currentUser = null) {
  try {
    const meta = (() => {
      try {
        if (row?.metadata && typeof row.metadata === 'object') return row.metadata;
        return typeof row?.metadata === 'object' ? row.metadata : JSON.parse(safeText(row?.metadata || '{}', '{}'));
      } catch {
        return {};
      }
    })();
    const actor = String(row?.username || '').trim() || 'Someone';
    const actionType = String(row?.action_type || '').trim();
    const changed = Array.isArray(meta.changed_fields) ? meta.changed_fields.join(', ') : '';
    const safePhone = (value) => {
      try { return visiblePhone(currentUser, value, ''); } catch { return String(value || ''); }
    };
    const map = {
      profile_opened: `${actor} opened the profile${meta.section ? ` from ${meta.section}` : ''}`,
      candidate_created: `${actor} created the profile`,
      profile_updated: `${actor} saved the profile${changed ? ` • ${changed}` : meta.change_count === 0 ? ' • no field change' : ''}`,
      note_added: `${actor} ${meta.reply_to_note_id ? 'replied on a note' : 'added a note'}`,
      call_logged: `${actor} logged a call${meta.phone ? ` to ${safePhone(meta.phone)}` : ''}`,
      whatsapp_opened: `${actor} opened WhatsApp${meta.phone ? ` for ${safePhone(meta.phone)}` : ''}`,
      submitted_for_approval: `${actor} submitted the profile for approval`,
      submission_approved: `${actor} approved the submission`,
      submission_rejected: `${actor} rejected the submission${meta.reason ? `: ${meta.reason}` : ''}`,
      follow_up_updated: `${actor} updated follow-up status${meta.follow_up_status ? ` to ${meta.follow_up_status}` : ''}`,
      interview_date_removal_requested: `${actor} requested interview date removal${meta.reason ? `: ${meta.reason}` : ''}`,
      interview_date_removed: `${actor} removed the interview date`,
      candidate_file_uploaded: `${actor} uploaded ${meta.file_kind === 'call_recording' ? 'a call recording' : 'a resume'}${meta.file_name ? `: ${meta.file_name}` : ''}`,
    };
    return map[actionType] || `${actor} did ${actionType || 'an update'}`;
  } catch {
    return 'Activity loaded';
  }
}

function timelineBadge(row) {
  const map = {
    profile_opened: 'Opened',
    candidate_created: 'Created',
    profile_updated: 'Saved',
    note_added: 'Note',
    call_logged: 'Call',
    whatsapp_opened: 'WhatsApp',
    submitted_for_approval: 'Submitted',
    submission_approved: 'Approved',
    submission_rejected: 'Rejected',
    follow_up_updated: 'Follow-up',
    interview_date_removal_requested: 'Removal Request',
    interview_date_removed: 'Interview Removed',
    candidate_file_uploaded: 'File',
  };
  return map[safeText(row?.action_type)] || 'Activity';
}

function formatTimelineTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isTodayAction(value) {
  return toInputDate(value) === localDateOnlyFromDate(new Date());
}

function timelineBucket(value) {
  const raw = String(value || '');
  if (!raw) return 'all';
  const now = new Date();
  const actionDate = new Date(raw);
  if (Number.isNaN(actionDate.getTime())) return 'all';
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startPastThreeDays = new Date(startToday);
  startPastThreeDays.setDate(startPastThreeDays.getDate() - 2);
  if (actionDate >= startToday) return 'today';
  if (actionDate >= startPastThreeDays) return 'past3';
  return 'all';
}

function MiniIconButton({ title, onClick, children, className = '', disabled = false }) {
  return <button className={`mini-btn bounceable detail-nav-btn ${className}`} type="button" title={title} onClick={onClick} disabled={disabled}>{children}</button>;
}

function PrevIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M15 18 9 12l6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function NextIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m9 18 6-6-6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function PhoneIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7.4 3.8h2.1c.5 0 .9.3 1.1.8l1.1 3.1c.2.5 0 1.1-.4 1.4L9.8 10.4a13.2 13.2 0 0 0 3.8 3.8l1.3-1.5c.3-.4.9-.6 1.4-.4l3.1 1.1c.5.2.8.6.8 1.1v2.1c0 .7-.6 1.3-1.3 1.3A15.9 15.9 0 0 1 6.1 5.1c0-.7.6-1.3 1.3-1.3Z" fill="currentColor" /></svg>;
}
function WhatsAppIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M19.1 4.8A9.7 9.7 0 0 0 3.8 16.7L2.7 21.3l4.8-1.1a9.7 9.7 0 0 0 4.5 1.1h.1a9.7 9.7 0 0 0 7-16.5Zm-7 14.8h-.1a7.9 7.9 0 0 1-4-1.1l-.3-.2-2.8.7.7-2.7-.2-.3a7.9 7.9 0 1 1 6.7 3.6Z" fill="currentColor" /><path d="M16.5 13.8c-.2-.1-1.3-.7-1.5-.7-.2-.1-.3-.1-.5.1l-.4.5c-.1.2-.3.2-.5.1-.2-.1-.8-.3-1.5-1a5.5 5.5 0 0 1-1-1.2c-.1-.2 0-.3.1-.4l.3-.4.2-.4c.1-.1 0-.3 0-.4l-.7-1.6c-.2-.4-.3-.3-.5-.3h-.4c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 1.9 0 1 .8 2.1.9 2.3.1.1 1.7 2.6 4 3.6 2.4 1 2.4.7 2.8.7.4-.1 1.3-.5 1.5-1 .2-.4.2-.9.2-1 0-.1-.2-.2-.4-.3Z" fill="currentColor" /></svg>;
}

function CelebrationBurst({ active }) {
  if (!active) return null;
  return (
    <div className="celebration-burst" aria-hidden="true">
      {Array.from({ length: 18 }).map((_, idx) => <span key={idx} className={`confetti-piece p${idx % 6}`} />)}
    </div>
  );
}

function ChoiceField({ label, value, options, onChange, disabled = false, compact = false, invalid = false, showAll = false }) {
  const normalizedOptions = stableOptions(options, value);
  const current = String(value || '').trim();
  let chipOptions = showAll ? normalizedOptions.slice() : normalizedOptions.slice(0, Math.min(5, normalizedOptions.length));
  if (current && !chipOptions.includes(current)) {
    chipOptions = [...chipOptions.slice(0, 4), current];
  }
  return (
    <div className={`field ${compact ? 'compact-field' : ''} ${invalid ? 'invalid-field' : ''}`.trim()}>
      <label>{label}</label>
      <div className="choice-chip-row compact-row">
        {chipOptions.map((option) => (
          <button
            key={option}
            type="button"
            disabled={disabled}
            className={`choice-chip bounceable ${String(value) === String(option) ? 'active' : ''}`}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
      {current ? <div className="helper-text top-gap-small">Selected: {current}</div> : null}
    </div>
  );
}

function MultiChoiceField({ label, value, options, onChange, disabled = false, invalid = false, keepOneSelected = false, onAddNew = null }) {
  const selected = splitMulti(value);
  const mergedOptions = [...new Set([...safeArray(options).map((option) => safeText(option).trim()).filter(Boolean), ...selected])];
  return (
    <div className={`field ${invalid ? 'invalid-field' : ''}`.trim()}>
      <label>{label}</label>
      <div className="choice-chip-row compact-row">
        {mergedOptions.map((option) => (
          <button
            key={option}
            type="button"
            disabled={disabled}
            className={`choice-chip bounceable ${selected.includes(option) ? 'active' : ''}`}
            onClick={() => onChange(toggleMultiValue(value, option, keepOneSelected))}
          >
            {option}
          </button>
        ))}
        {onAddNew ? <button type="button" disabled={disabled} className="choice-chip bounceable add-new-process-chip" onClick={onAddNew}>+ Add New Process</button> : null}
      </div>
      <div className="helper-text top-gap-small">{selected.length ? selected.join(', ') : 'Select one or more options.'}</div>
    </div>
  );
}


function SelectField({ label, value, options, onChange, disabled = false, invalid = false }) {
  const normalizedOptions = stableOptions(options, value);
  return (
    <div className={`field native-select-field ${invalid ? 'invalid-field' : ''}`.trim()}>
      <label>{label}</label>
      <select value={String(value || '')} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={invalid ? 'invalid-input' : ''}>
        <option value="">Select</option>
        {normalizedOptions.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
  );
}

class CandidateProfileErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { crashed: true, message: error?.message || 'Profile render failed.' };
  }

  componentDidCatch(error) {
    // Keep one poisoned activity/field from crashing the whole CRM tab.
    try { console.error('Candidate profile render guard:', error); } catch {}
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <Layout title={`Candidate • ${this.props.candidateId || ''}`} subtitle="Profile safety guard stopped a page crash.">
        <div className="panel top-gap">
          <div className="panel-title">Profile view recovered</div>
          <div className="helper-text top-gap-small">A bad activity/data value was blocked so the CRM tab does not crash.</div>
          <div className="helper-text top-gap-small">Refresh once after deploying this update. If the same profile still fails, the backend will still stay live.</div>
          <div className="row-actions top-gap">
            <button className="ghost-btn bounceable" type="button" onClick={() => window.history.back()}>Back</button>
            <button className="add-profile-btn bounceable" type="button" onClick={() => window.location.reload()}>Reload Profile</button>
          </div>
        </div>
      </Layout>
    );
  }
}

function CandidateDetailPageInner() {
  const { candidateId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const formRef = useRef(null);
  const notesPanelRef = useRef(null);
  const openLoggedRef = useRef('');
  const candidateCacheRef = useRef(GLOBAL_CANDIDATE_PROFILE_CACHE);
  const resetSnapshotRef = useRef(null);
  const [item, setItem] = useState(null);
  const [notes, setNotes] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [noteBody, setNoteBody] = useState('');
  const [replyContext, setReplyContext] = useState(null);
  const [message, setMessage] = useState('');
  const [salaryInputError, setSalaryInputError] = useState('');
  const [candidateFiles, setCandidateFiles] = useState([]);
  const [fileBusy, setFileBusy] = useState('');
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [timelineTab, setTimelineTab] = useState('today');
  const [processOptions, setProcessOptions] = useState(() => readStoredProcessOptions());
  const [recruiterOptions, setRecruiterOptions] = useState([]);
  const [preferredLocations, setPreferredLocations] = useState(() => readStoredPreferredLocations());
  const [candidateList, setCandidateList] = useState([]);
  const [noteTemplates, setNoteTemplates] = useState(getNoteTemplates());
  const [waTemplates, setWaTemplates] = useState(getWhatsAppTemplates());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [removeInterviewOpen, setRemoveInterviewOpen] = useState(false);
  const [removeInterviewReason, setRemoveInterviewReason] = useState('');
  const [statusFlash, setStatusFlash] = useState('');
  const [celebrate, setCelebrate] = useState(false);
  const [invalidFields, setInvalidFields] = useState([]);
  const [submissionIssues, setSubmissionIssues] = useState([]);
  const [syncState, setSyncState] = useState('idle');
  const [actionBusy, setActionBusy] = useState('');
  const [approvalDecisionBusy, setApprovalDecisionBusy] = useState('');
  const [detailRejectOpen, setDetailRejectOpen] = useState(false);
  const [detailRejectReason, setDetailRejectReason] = useState('');
  const actionLockRef = useRef('');
  const backgroundProfileSaveRef = useRef({ inFlight: false, queued: null, seq: 0 });
  const [routeBusy, setRouteBusy] = useState(false);
  const [hydratingProfile, setHydratingProfile] = useState(false);
  const [profileVerified, setProfileVerified] = useState(false);
  const loadSequenceRef = useRef(0);
  const [jdSuggestionPopup, setJdSuggestionPopup] = useState(null);
  const [jdPopupBusyId, setJdPopupBusyId] = useState('');
  const fieldOrderStorageKey = `careerCroxCandidateFieldOrder_v3:${String(user?.user_id || user?.role || 'guest').toLowerCase()}`;
  const [fieldOrder, setFieldOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(fieldOrderStorageKey) || '[]');
      return Array.isArray(saved) && saved.length ? saved : DEFAULT_CANDIDATE_FIELD_ORDER;
    } catch {
      return DEFAULT_CANDIDATE_FIELD_ORDER;
    }
  });
  const [dragFieldKey, setDragFieldKey] = useState('');
  const navKey = useMemo(() => new URLSearchParams(location.search || '').get('nav') || '', [location.search]);
  const preservedNavContext = useMemo(() => readCandidateNavContext(navKey), [navKey]);

  const leadership = ['admin', 'manager', 'tl'].includes(user?.role);
  const canDirectRemoveInterview = leadership;
  const latestResumeFile = useMemo(() => safeArray(candidateFiles).find((file) => file?.file_kind === 'resume') || null, [candidateFiles]);
  const latestRecordingFile = useMemo(() => safeArray(candidateFiles).find((file) => file?.file_kind === 'call_recording') || null, [candidateFiles]);
  const noteThreads = useMemo(() => buildNoteThreads(notes), [notes]);
  const visibleNotes = useMemo(() => noteThreads.slice(0, 5), [noteThreads]);
  const recentSavedNotes = useMemo(() => noteThreads.slice(0, 3), [noteThreads]);
  const recentNoteTemplatePreview = useMemo(() => safeTemplateList(noteTemplates, 4), [noteTemplates]);
  const filteredTimeline = useMemo(() => {
    if (timelineTab === 'today') return safeArray(timeline).filter((row) => timelineBucket(row?.created_at) === 'today');
    if (timelineTab === 'past3') return safeArray(timeline).filter((row) => ['today', 'past3'].includes(timelineBucket(row?.created_at)));
    return safeArray(timeline);
  }, [timeline, timelineTab]);
  const visibleTimeline = useMemo(() => (showTimeline ? filteredTimeline : filteredTimeline.slice(0, 12)), [showTimeline, filteredTimeline]);
  const approvalPending = String(item?.approval_status || '').toLowerCase() === 'pending';
  const editingLocked = approvalPending && !leadership;
  const processIsCustom = !!item?.process && !safeTemplateList(processOptions, 200).includes(safeText(item.process));
  const selectedDate = toInputDate(item?.interview_reschedule_date || '');
  const prevCandidate = useMemo(() => {
    const idx = safeArray(candidateList).findIndex((row) => row?.candidate_id === candidateId);
    return idx > 0 ? candidateList[idx - 1] : null;
  }, [candidateList, candidateId]);
  const nextCandidate = useMemo(() => {
    const idx = safeArray(candidateList).findIndex((row) => row?.candidate_id === candidateId);
    return idx >= 0 && idx < candidateList.length - 1 ? candidateList[idx + 1] : null;
  }, [candidateList, candidateId]);
  const displayStatusOptions = useMemo(() => {
    const current = safeText(item?.status || '');
    return current && !STATUS_OPTIONS.includes(current) ? [...STATUS_OPTIONS, current] : STATUS_OPTIONS;
  }, [item?.status]);
  const canEditDataNotes = ['manager'].includes(String(user?.role || '').trim().toLowerCase()) || String(user?.designation || '').trim().toLowerCase() === 'manager';
  const canManagerReassignRecruiter = ['admin', 'manager'].includes(String(user?.role || '').trim().toLowerCase());
  const phoneIsMaskedForRecruiter = false;

  useEffect(() => {
    setFieldOrder((current) => {
      const base = Array.isArray(current) && current.length ? current.filter((key) => DEFAULT_CANDIDATE_FIELD_ORDER.includes(key)) : [];
      for (const key of DEFAULT_CANDIDATE_FIELD_ORDER) if (!base.includes(key)) base.push(key);
      return base;
    });
  }, []);

  useEffect(() => {
    try { localStorage.setItem(fieldOrderStorageKey, JSON.stringify(fieldOrder)); } catch {}
  }, [fieldOrder, fieldOrderStorageKey]);

  useEffect(() => {
    setReplyContext(null);
    setNoteBody('');
    setShowHistory(false);
  }, [candidateId]);

  function fieldOrderIndex(fieldKey) {
    const idx = fieldOrder.indexOf(fieldKey);
    return idx >= 0 ? idx : fieldOrder.length + 1;
  }

  function moveField(dragKey, targetKey) {
    if (!dragKey || !targetKey || dragKey === targetKey) return;
    setFieldOrder((current) => {
      const base = (current.length ? current : DEFAULT_CANDIDATE_FIELD_ORDER).filter(Boolean);
      const filtered = base.filter((key) => key !== dragKey);
      const targetIndex = filtered.indexOf(targetKey);
      if (targetIndex < 0) return [...filtered, dragKey];
      filtered.splice(targetIndex, 0, dragKey);
      return filtered;
    });
  }

  function sortableFieldProps(fieldKey) {
    return {
      draggable: true,
      onDragStart: () => setDragFieldKey(fieldKey),
      onDragOver: (event) => event.preventDefault(),
      onDrop: (event) => { event.preventDefault(); moveField(dragFieldKey, fieldKey); },
      onDragEnd: () => setDragFieldKey(''),
      style: { order: fieldOrderIndex(fieldKey) },
      'data-sort-no': pad2(fieldOrderIndex(fieldKey) + 1),
      'data-dragging': dragFieldKey === fieldKey ? 'true' : 'false',
    };
  }

  function buildResetSnapshot(source) {
    const base = ensureCandidateDefaults(clonePlain(source) || {});
    return {
      ...base,
      call_connected: base.call_connected || 'No',
      looking_for_job: base.looking_for_job || 'Yes',
      preferred_location: base.preferred_location || '',
      qualification_level: base.qualification_level || '',
      full_name: base.full_name || '',
      phone: base.phone || '',
      location: base.location || '',
      qualification: base.qualification || '',
      recruiter_code: base.recruiter_code || '',
      recruiter_name: base.recruiter_name || '',
      data_uploading_date: base.data_uploading_date || '',
      data_notes: base.data_notes || '',
      source_sr_no: base.source_sr_no || '',
      status: 'In - Progress',
      all_details_sent: 'Pending',
      total_experience: '',
      relevant_experience: '',
      in_hand_salary: '',
      ctc_monthly: '',
      career_gap: 'Fresher',
      relevant_experience_range: '',
      relevant_in_hand_range: '',
      communication_skill: '',
      interview_reschedule_date: '',
      submission_date: nowDateTimeLocal(),
      process: '',
      notes: '',
      virtual_onsite: 'Walkin',
      documents_availability: 'Yes',
      follow_up_at: '',
      follow_up_status: '',
      follow_up_note: '',
    };
  }

  function applyFollowUpPreset(preset) {
    if (!preset) return;
    if (preset.custom === 'tomorrow10') {
      patch({ follow_up_at: tomorrowAt(10, 0), follow_up_status: 'Open' });
      return;
    }
    patch({ follow_up_at: addMinutesDateTimeLocal(preset.minutes || 0), follow_up_status: 'Open' });
  }

  async function resetFilledDetails() {
    if (actionLockRef.current || actionBusy) return;
    if (!window.confirm('Reset filled details and keep only base/imported values?')) return;
    const snapshot = buildResetSnapshot(resetSnapshotRef.current || item);
    setInvalidFields([]);
    if (!beginAction('reset')) return;
    markSync('saving', 'Resetting filled details...');
    try {
      const resetPayload = { ...buildChangedFieldSavePayload(snapshot), _client_updated_at: safeText(resetSnapshotRef.current?.updated_at || item?.updated_at || '') };
      const data = await api.put(`/api/candidates/${candidateId}`, resetPayload);
      const nextItem = ensureCandidateDefaults(data.item || snapshot);
      setItem(nextItem);
      resetSnapshotRef.current = clonePlain(nextItem);
      candidateCacheRef.current[candidateId] = {
        item: nextItem,
        notes,
        timeline,
        process_options: processOptions,
        nav_items: candidateList,
        files: candidateFiles,
        recruiter_options: recruiterOptions || [],
      };
      markSync('saved', 'Filled details reset to base values.');
    } catch (err) {
      markSync('error', err.message || 'Reset failed.');
    } finally {
      endAction();
    }
  }

  function applyCandidatePayload(rawData, options = {}) {
    const safeData = sanitizeProfilePayload(rawData, item);
    const preserveSecondary = Boolean(options.preserveSecondary);
    const nextItem = applyAutoRangesToCandidate(safeData.item || ensureCandidateDefaults(sanitizeCandidateItem(item || {})));
    if (nextItem && String(nextItem.approval_status || '').toLowerCase() === 'pending') {
      nextItem.status = 'In - Progress';
      nextItem.all_details_sent = 'Pending';
    }
    const payload = {
      item: nextItem,
      notes: preserveSecondary ? trimSafeArray(notes, PROFILE_NOTES_LIMIT).map(sanitizeNoteRow) : safeData.notes,
      timeline: preserveSecondary ? trimSafeArray(timeline, PROFILE_TIMELINE_LIMIT).map(sanitizeActivityRow) : safeData.timeline,
      process_options: [...new Set([...(safeData.process_options.length ? safeData.process_options : []), ...readStoredProcessOptions(), ...trimSafeArray(processOptions, 120).map((entry) => safeText(entry)).filter(Boolean)])],
      recruiter_options: safeData.recruiter_options.length ? safeData.recruiter_options : trimSafeArray(recruiterOptions, 120),
      nav_items: safeData.nav_items,
      files: (preserveSecondary || rawData?.files_deferred) ? trimSafeArray(candidateFiles, PROFILE_FILES_LIMIT).map(sanitizeCandidateFileRow) : safeData.files,
    };
    candidateCacheRef.current[candidateId] = payload;
    rememberCandidateProfileCache(candidateId, payload);
    resetSnapshotRef.current = clonePlain(payload.item);
    setItem(payload.item);
    setNotes(payload.notes);
    setTimeline(payload.timeline);
    setProcessOptions([...new Set([...(payload.process_options || []), ...readStoredProcessOptions()])]);
    setRecruiterOptions(payload.recruiter_options || []);
    const preservedNavItems = trimSafeArray(preservedNavContext?.nav_items, PROFILE_NAV_LIMIT).map(sanitizeNavRow).filter((row) => row.candidate_id);
    setCandidateList(preservedNavItems.length ? preservedNavItems : payload.nav_items);
    if (!rawData?.files_deferred) { setCandidateFiles(payload.files || []); setFilesLoaded(Boolean((payload.files || []).length)); }
    return payload;
  }

  async function load() {
    const requestId = Date.now() + Math.random();
    loadSequenceRef.current = requestId;
    const isCurrentRequest = () => loadSequenceRef.current === requestId;
    const cached = sanitizeCachedProfilePayload(candidateCacheRef.current[candidateId], item);
    setError('');
    setProfileVerified(false);

    if (cached?.item) {
      resetSnapshotRef.current = clonePlain(cached.item);
      setItem(cached.item);
      setNotes(cached.notes || []);
      setTimeline(cached.timeline || []);
      setProcessOptions([...new Set([...(cached.process_options || []), ...readStoredProcessOptions()])]);
      setRecruiterOptions(cached.recruiter_options || []);
      setCandidateList((preservedNavContext?.nav_items && preservedNavContext.nav_items.length) ? preservedNavContext.nav_items : (cached.nav_items || []));
      setCandidateFiles([]);
      setFilesLoaded(false);
      setLoading(false);
      setHydratingProfile(true);
      setMessage('Showing instant profile. Notes are loading with main profile; files stay lazy.');
    } else {
      setItem(null);
      setNotes([]);
      setTimeline([]);
      setCandidateFiles([]);
      setFilesLoaded(false);
      setLoading(true);
      setHydratingProfile(false);
    }

    let hasCoreProfile = Boolean(cached?.item);

    try {
      const coreData = await api.get(`/api/candidates/${candidateId}?prefetch=1`, { cacheTtlMs: 0, timeoutMs: 10000, retries: 1 });
      if (!isCurrentRequest()) return;
      applyCandidatePayload(coreData, { preserveSecondary: false });
      hasCoreProfile = Boolean(coreData?.item);
      setProfileVerified(Boolean(coreData?.item));
      setLoading(false);
      setHydratingProfile(true);
      setRouteBusy(false);
      setMessage('');
    } catch (err) {
      if (!isCurrentRequest()) return;
      setProfileVerified(false);
      if (!hasCoreProfile) {
        setError(err.message || 'Candidate detail could not be loaded.');
        setItem(null);
        setLoading(false);
        setHydratingProfile(false);
        setRouteBusy(false);
      } else {
        markSync('error', 'Latest profile verification failed. Cached profile is visible, but editing is locked until retry.');
        setHydratingProfile(false);
        setRouteBusy(false);
      }
      return;
    }

    window.setTimeout(() => {
      if (!isCurrentRequest()) return;
      api.get(`/api/candidates/${candidateId}?no_files=1`, { cacheTtlMs: 0, timeoutMs: 16000, retries: 1, background: true })
        .then((data) => {
          if (!isCurrentRequest()) return;
          applyCandidatePayload(data);
          setProfileVerified(Boolean(data?.item));
        })
        .catch(() => {
          if (!isCurrentRequest()) return;
          setMessage('Main profile and notes loaded. Files stay lazy and load only when opened.');
        })
        .finally(() => {
          if (!isCurrentRequest()) return;
          setHydratingProfile(false);
          setRouteBusy(false);
        });
    }, 800);
  }

  useEffect(() => {
    const hasVisibleItem = Boolean(item);
    if (hasVisibleItem) setRouteBusy(true);
    setError('');
    setReplyContext(null);
    setNoteBody('');
    setShowHistory(false);
    load().catch((err) => {
      setError(err?.message || 'Candidate detail could not be loaded.');
      setLoading(false);
      setHydratingProfile(false);
      setRouteBusy(false);
    });
    return () => {
      loadSequenceRef.current = Date.now() + Math.random();
    };
  }, [candidateId, preservedNavContext?.nav_items]);
  // CC16 profile load fail-safe timer: never leave the profile screen on endless loading.
  useEffect(() => {
    if (!loading || item) return undefined;
    const timer = window.setTimeout(() => {
      setLoading(false);
      setHydratingProfile(false);
      setRouteBusy(false);
      setError('Profile load took too long. Click Retry once; if it repeats, refresh CRM.');
    }, 25000);
    return () => window.clearTimeout(timer);
  }, [candidateId, loading, item]);

  useEffect(() => {
    if (openLoggedRef.current === candidateId) return;
    openLoggedRef.current = candidateId;
    api.post(`/api/candidates/${candidateId}/open`, {}, { timeoutMs: 6000, background: true })
      .then((data) => {
        const viewedAt = data?.last_viewed_at || new Date().toISOString();
        setItem((current) => current ? { ...current, last_viewed_at: viewedAt, last_viewed_by_name: user?.full_name || user?.username || current.last_viewed_by_name } : current);
      })
      .catch(() => {});
  }, [candidateId, user?.full_name, user?.username]);
  useEffect(() => {
    if (!statusFlash && !celebrate) return undefined;
    const timer = window.setTimeout(() => { setStatusFlash(''); setCelebrate(false); }, 1800);
    return () => window.clearTimeout(timer);
  }, [statusFlash, celebrate]);
  useEffect(() => {
    if (syncState !== 'saved') return undefined;
    const timer = window.setTimeout(() => setSyncState('idle'), 1400);
    return () => window.clearTimeout(timer);
  }, [syncState]);

  // CC17 safe next/previous core prefetch: only tiny prefetch=1 payload, never heavy notes/files.
  useEffect(() => {
    const ids = [prevCandidate?.candidate_id, nextCandidate?.candidate_id].filter(Boolean).slice(0, 2);
    if (!ids.length) return undefined;
    const timer = window.setTimeout(() => {
      ids.forEach((id) => prefetchCandidate(id));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [prevCandidate?.candidate_id, nextCandidate?.candidate_id]);

  async function prefetchCandidate(targetId) {
    if (!targetId || candidateCacheRef.current[targetId]) return;
    try {
      const data = await api.get(`/api/candidates/${targetId}?prefetch=1`, { cacheTtlMs: 0, timeoutMs: 12000, background: true });
      const safeData = sanitizeProfilePayload({ ...data, nav_items: candidateList }, null);
      candidateCacheRef.current[targetId] = {
        item: safeData.item,
        notes: [],
        timeline: [],
        process_options: safeData.process_options.length ? safeData.process_options : processOptions,
        nav_items: safeData.nav_items,
        files: [],
        recruiter_options: safeData.recruiter_options.length ? safeData.recruiter_options : recruiterOptions || [],
      };
    } catch {}
  }

  function openCandidate(targetId) {
    if (!targetId) return;
    const cached = sanitizeCachedProfilePayload(candidateCacheRef.current[targetId], item);
    if (cached?.item) {
      setItem(cached.item);
      setNotes(cached.notes || []);
      setTimeline(cached.timeline || []);
      setProcessOptions([...new Set([...(cached.process_options || []), ...readStoredProcessOptions()])]);
      setRecruiterOptions(cached.recruiter_options || []);
      setCandidateList(cached.nav_items || candidateList);
      setCandidateFiles([]);
      setFilesLoaded(false);
      setLoading(false);
      setProfileVerified(false);
      setError('');
    }
    navigate(buildCandidateUrl(targetId, navKey));
  }

  function markSync(next, note = '') {
    setSyncState(next);
    if (note) setMessage(note);
  }

  function beginAction(name) {
    if (actionLockRef.current || actionBusy) return false;
    actionLockRef.current = name;
    setActionBusy(name);
    return true;
  }

  function endAction() {
    actionLockRef.current = '';
    setActionBusy('');
  }

  async function uploadCandidateAsset(fileKind, file) {
    if (!file || !candidateId) return;
    const busyKey = `${fileKind}:${file.name}`;
    setFileBusy(busyKey);
    setMessage('');
    try {
      const contentBase64 = await readFileAsBase64(file);
      const data = await api.post(`/api/candidates/${candidateId}/files`, {
        file_kind: fileKind,
        file_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        content_base64: contentBase64,
      }, { timeoutMs: 45000, retries: 1 });
      const nextItem = ensureCandidateDefaults({ ...(item || {}), ...(data.candidate_updates || {}) });
      setCandidateFiles(data.files || []);
      setFilesLoaded(true);
      setItem(nextItem);
      candidateCacheRef.current[candidateId] = {
        item: nextItem,
        notes,
        timeline,
        process_options: processOptions,
        nav_items: candidateList,
        files: data.files || [],
        recruiter_options: data.recruiter_options || recruiterOptions || [],
      };
      setMessage(`${fileKind === 'resume' ? 'Resume' : 'Call recording'} uploaded successfully.`);
    } catch (err) {
      setMessage(err.message || 'File upload failed.');
    } finally {
      setFileBusy('');
    }
  }

  async function loadCandidateFiles() {
    if (!candidateId || filesLoading) return;
    setFilesLoading(true);
    try {
      const data = await api.get(`/api/candidates/${candidateId}/files`, { cacheTtlMs: 0, timeoutMs: 12000, retries: 1 });
      setCandidateFiles(data.files || []);
      setFilesLoaded(true);
      writeProfileCacheSnapshot(item, { files: data.files || [] });
    } catch (err) {
      setMessage(err?.message || 'Files could not be loaded.');
      setFilesLoaded(false);
    } finally {
      setFilesLoading(false);
    }
  }

  function downloadCandidateAsset(fileId) {
    if (!fileId) return;
    window.open(`/api/candidates/${candidateId}/files/${fileId}/download`, '_blank');
  }

  useEffect(() => {
    setItem((current) => current ? ensureCandidateDefaults(sanitizeCandidateItem(current)) : current);
  }, [candidateId, item?.candidate_id]);

  // Adjacent profile prefetch intentionally disabled for stability.
  // Opening one profile was triggering extra background profile requests, causing freezes when multiple recruiters opened profiles quickly.


  function blockInvalidSalaryFormat(fieldLabel = 'Salary') {
    setSalaryInputError(`${fieldLabel}: Enter digits only, such as 26000. Do not use 26K or symbols.`);
  }

  function handleSalaryFieldChange(fieldKey, nextRaw, fieldLabel) {
    const raw = String(nextRaw || '');
    if (!isDigitsOnlyValue(raw)) {
      blockInvalidSalaryFormat(fieldLabel);
      return;
    }
    setSalaryInputError('');
    patch({ [fieldKey]: digitsOnly(raw) });
  }

  function handleSalaryBeforeInput(event, fieldLabel) {
    const incoming = String(event?.data || '');
    if (incoming && !/^\d+$/.test(incoming)) {
      event.preventDefault();
      blockInvalidSalaryFormat(fieldLabel);
    }
  }

  function handleSalaryPaste(event, fieldLabel) {
    const pasted = event?.clipboardData?.getData('text') || '';
    if (!/^\d*$/.test(String(pasted || ''))) {
      event.preventDefault();
      blockInvalidSalaryFormat(fieldLabel);
    }
  }

  function patch(next) {
    setInvalidFields((current) => current.filter((key) => !Object.prototype.hasOwnProperty.call(next, key)));
    if (submissionIssues.length) setSubmissionIssues([]);
    setItem((current) => {
      const merged = ensureCandidateDefaults({ ...(current || {}), ...next });
      if (Object.prototype.hasOwnProperty.call(next, 'phone')) {
        merged.phone = normalizeIndianPhone(merged.phone || '');
      }
      if (Object.prototype.hasOwnProperty.call(next, 'relevant_experience') && !Object.prototype.hasOwnProperty.call(next, 'relevant_experience_range')) {
        merged.relevant_experience_range = expRange(String(parseMonthCount(merged.relevant_experience)));
      }
      if (Object.prototype.hasOwnProperty.call(next, 'in_hand_salary') && !Object.prototype.hasOwnProperty.call(next, 'relevant_in_hand_range')) {
        merged.relevant_in_hand_range = salaryRange(merged.in_hand_salary || '');
      }
      if (Object.prototype.hasOwnProperty.call(next, 'ctc_monthly') || Object.prototype.hasOwnProperty.call(next, 'in_hand_salary')) {
        const nextCtc = Object.prototype.hasOwnProperty.call(next, 'ctc_monthly') ? String(next.ctc_monthly || '') : String(merged.ctc_monthly || '');
        const nextInHand = Object.prototype.hasOwnProperty.call(next, 'in_hand_salary') ? String(next.in_hand_salary || '') : String(merged.in_hand_salary || '');
        if (isDigitsOnlyValue(nextCtc) && isDigitsOnlyValue(nextInHand)) {
          setSalaryInputError('');
        }
      }
      if (String(merged.approval_status || '').toLowerCase() === 'pending') {
        merged.status = merged.status || 'In - Progress';
        merged.all_details_sent = merged.all_details_sent || 'Pending';
      }
      return merged;
    });
  }

  function focusInvalidField(direction = 1, currentTarget = null) {
    if (!formRef.current || !invalidFields.length) return false;
    const pending = invalidFields.map((key) => document.querySelector(`[data-field="${key}"] input, [data-field="${key}"] textarea, [data-field="${key}"] select, [data-field="${key}"] button`)).filter(Boolean);
    if (!pending.length) return false;
    const idx = currentTarget ? pending.indexOf(currentTarget) : -1;
    const next = pending[(idx + direction + pending.length) % pending.length] || pending[0];
    next.focus();
    return true;
  }

  function moveToNextField(event) {
    if (event.key === 'Tab' && invalidFields.length) {
      event.preventDefault();
      focusInvalidField(event.shiftKey ? -1 : 1, event.target);
      return;
    }
    if (event.key !== 'Enter' || event.target.tagName === 'TEXTAREA' || event.target.tagName === 'BUTTON') return;
    event.preventDefault();
    const inputs = [...formRef.current.querySelectorAll('input, select, textarea, button')]
      .filter((el) => !el.disabled && el.type !== 'hidden' && el.offsetParent !== null);
    const idx = inputs.indexOf(event.target);
    if (idx >= 0 && idx < inputs.length - 1) inputs[idx + 1].focus();
  }

  function writeProfileCacheSnapshot(nextItem, nextExtras = {}) {
    if (!candidateId || !nextItem) return;
    const cachedPayload = {
      item: ensureCandidateDefaults(nextItem),
      notes,
      timeline,
      process_options: processOptions,
      nav_items: candidateList,
      files: candidateFiles,
      recruiter_options: recruiterOptions || [],
      ...nextExtras,
    };
    candidateCacheRef.current[candidateId] = cachedPayload;
    rememberCandidateProfileCache(candidateId, cachedPayload);
  }

  function buildChangedFieldSavePayload(currentItem) {
    const currentPayload = sanitizeCandidatePayload(currentItem || {});
    const basePayload = sanitizeCandidatePayload(resetSnapshotRef.current || {});
    const blockedKeys = new Set(['candidate_id', 'created_at', 'updated_at', '_crm_row_id', 'last_viewed_at', 'last_viewed_by_name']);
    const changed = {};
    const changedFields = [];
    const baseValues = {};
    for (const key of Object.keys(currentPayload)) {
      if (blockedKeys.has(key) || key.startsWith('_')) continue;
      const currentValue = currentPayload[key] ?? '';
      const baseValue = basePayload[key] ?? '';
      if (String(currentValue) !== String(baseValue)) {
        changed[key] = currentValue;
        changedFields.push(key);
        baseValues[key] = baseValue;
      }
    }
    changed._client_updated_at = safeText(resetSnapshotRef.current?.updated_at || currentPayload.updated_at || '');
    changed._changed_fields = changedFields;
    changed._client_base_values = baseValues;
    return changed;
  }

  function queueBackgroundProfileSave({ payload, beforeItem, beforeStatus }) {
    if (!candidateId || !payload) return;
    const ref = backgroundProfileSaveRef.current;
    ref.seq += 1;
    ref.queued = {
      seq: ref.seq,
      candidateId,
      payload: { ...sanitizeCandidatePayload(payload), _client_updated_at: safeText(payload?._client_updated_at || resetSnapshotRef.current?.updated_at || payload?.updated_at || '') },
      beforeItem: clonePlain(beforeItem),
      beforeStatus: safeText(beforeStatus || ''),
    };
    runNextBackgroundProfileSave();
  }

  function runNextBackgroundProfileSave() {
    const ref = backgroundProfileSaveRef.current;
    if (ref.inFlight || !ref.queued) return;
    const job = ref.queued;
    ref.queued = null;
    ref.inFlight = true;
    markSync('saving', 'Saved on screen. Background sync running...');

    api.put(`/api/candidates/${job.candidateId}`, job.payload, { timeoutMs: 90000 })
      .then((data) => {
        const nextItem = ensureCandidateDefaults(data?.item || job.payload);
        const latestSeq = backgroundProfileSaveRef.current.seq;
        if (job.seq === latestSeq && String(candidateId || '') === String(job.candidateId || '')) {
          setItem((current) => {
            if (!current || String(current.candidate_id || '') !== String(job.candidateId || '')) return current;
            return sameCandidatePayload(current, job.payload) ? nextItem : current;
          });
          resetSnapshotRef.current = clonePlain(nextItem);
          writeProfileCacheSnapshot(nextItem);
          markSync('saved', 'Saved. Backend sync completed.');
          if (String(nextItem?.status || '').toLowerCase() === 'selected' && String(job.beforeStatus || '').toLowerCase() !== 'selected') {
            setCelebrate(true);
          }
        }
      })
      .catch((err) => {
        if (job.seq === backgroundProfileSaveRef.current.seq && String(candidateId || '') === String(job.candidateId || '')) {
          markSync('error', Number(err?.status || 0) === 409 ? 'Newer update found. Refresh profile before saving to avoid overwriting someone else.' : (err?.message || 'Background sync failed. Your edited details are still on screen. Click Save again.'));
        }
      })
      .finally(() => {
        const refNow = backgroundProfileSaveRef.current;
        refNow.inFlight = false;
        if (refNow.queued) runNextBackgroundProfileSave();
      });
  }

  function save(e) {
    e?.preventDefault?.();
    if (!item || !candidateId || actionLockRef.current || (actionBusy && actionBusy !== 'save')) return;
    const beforeItem = clonePlain(item);
    const beforeStatus = item?.status || '';
    const fullPayload = ensureCandidateDefaults(sanitizeCandidatePayload({ ...item }));
    if (approvalPending && !leadership) {
      fullPayload.status = 'In - Progress';
      fullPayload.all_details_sent = 'Pending';
    }
    const savePayload = buildChangedFieldSavePayload(fullPayload);
    if (!savePayload._changed_fields.length) {
      markSync('saved', profileVerified ? 'No changes to sync.' : 'No changes. Fresh verification is still running in background.');
      return;
    }
    setItem(fullPayload);
    setInvalidFields([]);
    writeProfileCacheSnapshot(fullPayload);
    markSync('saving', 'Saved on screen. Syncing only changed fields...');
    queueBackgroundProfileSave({ payload: savePayload, beforeItem, beforeStatus });
  }

  async function checkJdFit() {
    if (actionLockRef.current || actionBusy) return;
    const beforeItem = clonePlain(item);
    const draftPayload = sanitizeCandidatePayload({ ...item });
    const payload = buildChangedFieldSavePayload(draftPayload);
    payload.include_fit = true;
    if (approvalPending && !leadership) {
      payload.status = 'In - Progress';
      payload.all_details_sent = 'Pending';
    }
    setInvalidFields([]);
    if (!beginAction('check')) return;
    markSync('saving', 'Checking JD fit...');
    try {
      const data = await api.put(`/api/candidates/${candidateId}?include_fit=1`, payload, { timeoutMs: 90000 });
      const nextItem = ensureCandidateDefaults(data.item || payload);
      setItem(nextItem);
      candidateCacheRef.current[candidateId] = {
        item: nextItem,
        notes,
        timeline,
        process_options: processOptions,
        nav_items: candidateList,
        files: candidateFiles,
        recruiter_options: recruiterOptions || [],
      };
      const fit = nextItem?.jd_fit_summary || { score: 0, label: 'No JD Linked', suggestions: [] };
      const nextSuggestions = (fit.suggestions || []).slice(0, 6);
      if (nextSuggestions.length) {
        setJdSuggestionPopup({
          score: fit.score || 0,
          label: fit.label || 'Possible Fit',
          suggestions: nextSuggestions,
        });
        markSync('saved', 'Draft synced. Relevant JD popup ready.');
      } else {
        setJdSuggestionPopup(null);
        markSync('saved', 'Draft synced. No relevant JD matched yet.');
      }
    } catch (err) {
      setItem(beforeItem);
      markSync('error', err.message || 'Check JD failed. Draft not synced.');
    } finally {
      endAction();
    }
  }



  async function approveFromDetail() {
    if (!leadership || approvalDecisionBusy || !item?.candidate_id || approvalState === 'approved') return;
    setApprovalDecisionBusy('approve');
    setDetailRejectOpen(false);
    setDetailRejectReason('');
    markSync('saving', 'Approving profile...');
    try {
      await api.post('/api/approvals/approve', { type: 'candidate', id: item.candidate_id });
      setItem((current) => current ? ensureCandidateDefaults({
        ...current,
        approval_status: 'Approved',
        approved_at: new Date().toISOString(),
        approved_by_name: user?.full_name || user?.username || current.approved_by_name || '',
        status: 'Approved',
      }) : current);
      markSync('saved', 'Profile approved from the candidate page.');
      window.setTimeout(() => { load().catch(() => {}); }, 120);
    } catch (err) {
      markSync('error', err.message || 'Approve failed on candidate page.');
    } finally {
      setApprovalDecisionBusy('');
    }
  }

  async function rejectFromDetail() {
    if (!leadership || approvalDecisionBusy || !item?.candidate_id || approvalState === 'rejected') return;
    const reason = String(detailRejectReason || '').trim();
    if (!reason) return;
    setApprovalDecisionBusy('reject');
    markSync('saving', 'Rejecting profile...');
    try {
      await api.post('/api/approvals/reject', { type: 'candidate', id: item.candidate_id, reason });
      setItem((current) => current ? ensureCandidateDefaults({
        ...current,
        approval_status: 'Rejected',
        approved_at: '',
        approved_by_name: '',
        status: 'Rejected',
      }) : current);
      setDetailRejectOpen(false);
      setDetailRejectReason('');
      markSync('saved', 'Profile rejected from the candidate page.');
      window.setTimeout(() => { load().catch(() => {}); }, 120);
    } catch (err) {
      markSync('error', err.message || 'Reject failed on candidate page.');
    } finally {
      setApprovalDecisionBusy('');
    }
  }

  function buildJdOpenUrl(jdId) {
    const params = new URLSearchParams();
    if (jdId) params.set('focus', jdId);
    if (candidateId) params.set('candidateId', candidateId);
    params.set('standalone', '1');
    return `/jds?${params.toString()}`;
  }

  function openJdInNewTab(jdId) {
    const url = buildJdOpenUrl(jdId);
    window.open(url, '_blank');
  }

  function openAllSuggestedJds() {
    const suggestions = safeArray(jdSuggestionPopup?.suggestions).filter((jd) => jd?.jd_id);
    suggestions.forEach((jd) => openJdInNewTab(jd.jd_id));
  }

  async function sendSuggestedJdOnWhatsApp(jdId) {
    if (!jdId || jdPopupBusyId) return;
    setJdPopupBusyId(String(jdId));
    try {
      const data = await api.get(`/api/jds/${jdId}`, { cacheTtlMs: 0, timeoutMs: 15000, retries: 1 });
      const jd = data?.item || null;
      if (!jd) throw new Error('JD not found');
      const firstMaterial = Array.isArray(jd.send_items_list) && jd.send_items_list.length ? jd.send_items_list[0] : null;
      const absolutePdfUrl = toAbsoluteUrl(jd.pdf_url || '');
      const firstMaterialLink = toAbsoluteUrl(firstMaterial?.link || '');
      const body = [
        interpolateJdTemplate(jd.message_template, item || {}, jd),
        firstMaterial ? `${firstMaterial.label || 'Send Material'}:
${firstMaterial.message || ''}${firstMaterialLink ? `
${firstMaterialLink}` : ''}` : '',
      ].filter(Boolean).join('\n\n').trim();
      const shared = await tryShareJdPdf(jd, body);
      if (!shared) {
        if (absolutePdfUrl) {
          await copyTextToClipboard(absolutePdfUrl);
          window.open(absolutePdfUrl, '_blank', 'noopener,noreferrer');
        }
        openWhatsApp(body);
      }
      markSync('saved', shared ? `${jd.job_title || 'JD'} shared.` : `${jd.job_title || 'JD'} opened with WhatsApp text and PDF ready.`);
    } catch (err) {
      markSync('error', err.message || 'JD send failed.');
    } finally {
      setJdPopupBusyId('');
    }
  }


  async function confirmSubmissionCommit() {
    const pause = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
    for (let attempt = 0; attempt < 7; attempt += 1) {
      try {
        const [candidateData, submissionData] = await Promise.all([
          api.get(`/api/candidates/${candidateId}?prefetch=1`, { cacheTtlMs: 0, timeoutMs: 12000, retries: 1 }),
          api.get('/api/submissions?show_old=1&days=30', { cacheTtlMs: 0, timeoutMs: 12000, retries: 1 }),
        ]);
        const latestCandidate = ensureCandidateDefaults(candidateData?.item || item || {});
        const matchedSubmission = (submissionData?.items || []).find((row) => String(row.candidate_id || '') === String(candidateId));
        if (String(latestCandidate?.approval_status || '').toLowerCase() === 'pending' && matchedSubmission) {
          return { ok: true, item: latestCandidate, submission: matchedSubmission };
        }
      } catch {}
      await pause(900 + (attempt * 250));
    }
    return { ok: false };
  }

  async function submitForApproval() {
    if (actionLockRef.current || actionBusy) return;
    const hasSavedNotes = noteThreads.length > 0;
    const hasDraftNote = Boolean(noteBody.trim());
    if (!hasSavedNotes && !hasDraftNote) {
      setSubmissionIssues(['Add note first. Profile cannot be submitted without notes.']);
      markSync('error', 'Submit blocked. Fix the issues below.');
      window.setTimeout(() => document.querySelector('.candidate-notes-chat-panel textarea')?.focus(), 0);
      return;
    }
    if (!hasSavedNotes && hasDraftNote) {
      try {
        await addNote();
      } catch {}
      await pause(180);
    }
    const validation = buildSubmitValidation(item);
    if (!validation.ok) {
      setInvalidFields(validation.missingKeys || []);
      setSubmissionIssues(validation.issues || normalizeIssueLines(validation.message));
      markSync('error', validation.message || 'Submit blocked. Fix the issues below.');
      const firstInvalid = (validation.missingKeys || [])[0];
      if (firstInvalid) window.setTimeout(() => document.querySelector(`[data-field="${firstInvalid}"] input, [data-field="${firstInvalid}"] textarea, [data-field="${firstInvalid}"] select, [data-field="${firstInvalid}"] button`)?.focus(), 0);
      return;
    }
    const beforeItem = clonePlain(item);
    const optimisticItem = ensureCandidateDefaults({
      ...sanitizeCandidatePayload(item),
      call_connected: 'Yes',
      status: 'In - Progress',
      all_details_sent: 'Pending',
      approval_status: 'Pending',
      submission_date: item?.submission_date || nowDateTimeLocal(),
    });
    setItem(optimisticItem);
    setInvalidFields([]);
    setSubmissionIssues([]);
    setStatusFlash('pending');
    if (!beginAction('submit')) return;
    markSync('saving', 'Submitting profile...');
    try {
      let data;
      try {
        data = await api.post(`/api/candidates/${candidateId}/submit`, sanitizeCandidatePayload(optimisticItem), { timeoutMs: 45000 });
      } catch (firstErr) {
        const transient = String(firstErr?.message || '').toLowerCase().includes('timed out') || [502, 503, 504].includes(Number(firstErr?.status || 0));
        if (!transient) throw firstErr;
        data = await api.post(`/api/candidates/${candidateId}/submit`, sanitizeCandidatePayload(optimisticItem), { timeoutMs: 45000 });
      }
      const savedItem = ensureCandidateDefaults(data?.item || optimisticItem);
      setItem(savedItem);
      markSync('saved', data?.already_submitted
        ? (data?.already_pending
          ? 'Profile is already pending for approval. Submit button is locked until TL / Manager approves or rejects it.'
          : 'Profile is already submitted. Submit button stays locked until the profile is rejected.')
        : 'Profile sent for approval. TL / Manager can approve or reject it from this page or the Submissions section.');
      window.setTimeout(() => { load().catch(() => {}); }, 120);
    } catch (err) {
      const confirmed = await confirmSubmissionCommit();
      if (confirmed.ok) {
        setItem(ensureCandidateDefaults(confirmed.item || optimisticItem));
        setStatusFlash('pending');
        setSubmissionIssues([]);
        markSync('saved', 'Submission was created after retry confirmation. TL / Manager can approve or reject it from this page or the Submissions section.');
        window.setTimeout(() => { load().catch(() => {}); }, 120);
      } else {
        setItem(beforeItem);
        setStatusFlash('');
        setSubmissionIssues(normalizeIssueLines(err.message || 'Submit failed. UI rolled back.'));
        markSync('error', normalizeIssueLines(err.message || '').length ? 'Submit blocked. Fix the issues below.' : (err.message || 'Submit failed. UI rolled back.'));
      }
    } finally {
      endAction();
    }
  }

  async function requestInterviewDateRemoval() {
    if (!removeInterviewReason.trim()) {
      setMessage('Interview date remove reason required.');
      return;
    }
    await api.post(`/api/candidates/${candidateId}/request-remove-interview-date`, { reason: removeInterviewReason.trim() });
    setRemoveInterviewOpen(false);
    setRemoveInterviewReason('');
    setMessage('Interview date removal request sent for TL / Manager approval.');
    await load();
  }

  async function removeInterviewDateDirectly() {
    if (!item?.interview_reschedule_date) return;
    try {
      await api.post(`/api/candidates/${candidateId}/remove-interview-date`, {});
      setRemoveInterviewOpen(false);
      setRemoveInterviewReason('');
      setMessage('Interview date removed successfully.');
      await load();
    } catch (err) {
      setMessage(err.message || 'Interview date remove failed.');
    }
  }

  async function addNote(e) {
    e?.preventDefault?.();
    if (!noteBody.trim()) return;
    const beforeNotes = clonePlain(notes) || [];
    const beforeTimeline = clonePlain(timeline) || [];
    const beforeReplyContext = clonePlain(replyContext);
    const body = noteBody.trim();
    const username = user?.full_name || user?.username || user?.name || 'You';
    const payload = {
      body,
      note_type: 'public',
      parent_note_id: replyContext?.rootId || '',
      reply_to_note_id: replyContext?.replyToId || '',
      reply_to_username: replyContext?.replyToUsername || '',
    };
    const optimisticNote = makeOptimisticNote(body, username, {
      parent_note_id: payload.parent_note_id || '',
      reply_to_note_id: payload.reply_to_note_id || '',
      reply_to_username: payload.reply_to_username || '',
      reply_preview: replyContext?.replyToBody || '',
    });
    const optimisticTimeline = makeOptimisticTimeline('note_added', username, {
      candidate_id: candidateId,
      reply_to_note_id: payload.reply_to_note_id || '',
    });
    setNotes((current) => [optimisticNote, ...(current || [])]);
    setTimeline((current) => [optimisticTimeline, ...(current || [])]);
    setNoteBody('');
    setReplyContext(null);
    markSync('saving', 'Adding note...');
    setNoteSaving(true);
    try {
      await api.post(`/api/candidates/${candidateId}/notes`, payload);
      markSync('saved', payload.reply_to_note_id ? 'Reply added instantly.' : 'Note added instantly.');
      setTimeout(() => { load().catch(() => {}); }, 120);
    } catch (err) {
      setNotes(beforeNotes);
      setTimeline(beforeTimeline);
      setNoteBody(body);
      setReplyContext(beforeReplyContext || null);
      markSync('error', err.message || 'Note save failed. UI rolled back.');
    } finally {
      setNoteSaving(false);
    }
  }

  function startReply(rootNote, replyToNote = rootNote) {
    if (!rootNote) return;
    setReplyContext({
      rootId: normalizeNoteId(rootNote?.id),
      replyToId: normalizeNoteId(replyToNote?.id || rootNote?.id),
      replyToUsername: noteAuthorName(replyToNote || rootNote),
      replyToBody: String(replyToNote?.body || rootNote?.body || '').trim(),
    });
  }

  function useNoteTemplate(value) {
    if (!value) return;
    if (value === '__add_new__') {
      const fresh = window.prompt('Type new reusable note');
      if (fresh) {
        const next = addNoteTemplate(fresh);
        setNoteTemplates(next);
        setNoteBody(fresh);
      }
      return;
    }
    const nextTemplates = addNoteTemplate(value);
    setNoteTemplates(nextTemplates);
    setNoteBody(value);
  }

  function useWaTemplate(value) {
    if (!value) {
      openWhatsApp('');
      return;
    }
    if (value === '__add_new__') {
      const fresh = window.prompt('Type new WhatsApp template');
      if (fresh) setWaTemplates(addWhatsAppTemplate(fresh));
      return;
    }
    openWhatsApp(value);
  }

  async function onDial() {
    if (!item?.phone) return;
    dialCandidateWithLog(candidateId, item.phone || '');
  }

  function openWhatsApp(text = '') {
    openWhatsAppWithLog(candidateId, item?.phone || '', text);
  }

  function toAbsoluteUrl(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    try {
      return new URL(raw, window.location.origin).toString();
    } catch {
      return raw;
    }
  }

  async function copyTextToClipboard(value = '') {
    const text = String(value || '').trim();
    if (!text) return false;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(area);
      return Boolean(copied);
    } catch {
      return false;
    }
  }

  async function tryShareJdPdf(jd, body) {
    const absolutePdfUrl = toAbsoluteUrl(jd?.pdf_url || '');
    if (!absolutePdfUrl || !navigator?.share || !navigator?.canShare) return false;
    try {
      const response = await fetch(absolutePdfUrl, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) return false;
      const blob = await response.blob();
      const safeName = String(jd?.job_title || 'jd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'jd';
      const file = new File([blob], `${safeName}.pdf`, { type: blob.type || 'application/pdf' });
      if (!navigator.canShare({ files: [file] })) return false;
      await navigator.share({ title: jd?.job_title || 'JD PDF', text: body, files: [file] });
      return true;
    } catch {
      return false;
    }
  }

  function patchExperienceField(fieldKey, part, value) {
    const current = splitExperienceValue(item?.[fieldKey] || '');
    const nextParts = { ...current, [part]: String(value || '').replace(/[^\d]/g, '').slice(0, 2) };
    const totalMonths = joinExperienceValue(nextParts.years, nextParts.months);
    const nextPayload = { [fieldKey]: totalMonths };
    if (fieldKey === 'relevant_experience') nextPayload.relevant_experience_range = expRange(totalMonths);
    patch(nextPayload);
  }


  function copyTotalExperienceToRelevant() {
    const total = String(item?.total_experience || '').trim();
    patch({ relevant_experience: total, relevant_experience_range: expRange(total) });
  }

  function matchRelevantExperienceRange() {
    patch({ relevant_experience_range: expRange(item?.relevant_experience || '') });
  }

  function matchSalaryRange() {
    patch({ relevant_in_hand_range: salaryRange(item?.in_hand_salary || '') });
  }

  function addPreferredLocationOption() {
    if (editingLocked) return;
    const fresh = String(window.prompt('Add new preferred location') || '').trim();
    if (!fresh) return;
    const nextOptions = [...new Set([...preferredLocations, fresh])];
    setPreferredLocations(nextOptions);
    persistPreferredLocations(nextOptions);
    patch({ preferred_location: fresh });
  }

  function addNewProcessOption() {
    if (editingLocked) return;
    const fresh = String(window.prompt('Add new process name') || '').trim();
    if (!fresh) return;
    const nextOptions = [...new Set([...processOptions, fresh])];
    setProcessOptions(nextOptions);
    persistProcessOptions(nextOptions);
    patch({ process: fresh });
  }

  function jumpToNotesPanel() {
    try {
      notesPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      notesPanelRef.current?.scrollIntoView();
    }
  }

  function renderNoteThread(thread, includeAllReplies = true) {
    if (!thread?.root) return null;
    const rootId = normalizeNoteId(thread.root.id);
    const isReplyingHere = replyContext?.rootId === rootId;
    const replies = includeAllReplies ? (thread.replies || []) : (thread.replies || []).slice(-2);
    return (
      <div key={rootId || `note-thread-${thread.root.created_at}`} className="candidate-note-thread">
        <div className="candidate-note-bubble candidate-note-root-bubble">
          <div className="candidate-note-meta-row">
            <strong>{noteAuthorName(thread.root)}</strong>
            <span>{formatNoteStamp(thread.root.created_at)}</span>
          </div>
          <div className="candidate-note-body">{safeText(thread.root?.body || '-')}</div>
          <div className="candidate-note-actions-row">
            <button type="button" className="ghost-btn bounceable mini-inline-action" onClick={() => startReply(thread.root, thread.root)}>Reply</button>
            <span className="helper-text">{thread.replies?.length ? `${thread.replies.length} repl${thread.replies.length === 1 ? 'y' : 'ies'}` : 'Main note'}</span>
          </div>
        </div>
        {replies.length ? (
          <div className="candidate-note-reply-stack">
            {replies.map((reply) => {
              const target = reply.reply_target_note || null;
              return (
                <div key={reply.id || `${rootId}-${reply.created_at}`} className="candidate-note-bubble candidate-note-reply-bubble">
                  <div className="candidate-note-meta-row">
                    <strong>{noteAuthorName(reply)}</strong>
                    <span>{formatNoteStamp(reply.created_at)}</span>
                  </div>
                  {target ? (
                    <div className="candidate-note-quote-box">
                      <strong>{noteAuthorName(target)}</strong>
                      <span>{shortNotePreview(target.body || reply.reply_preview || '')}</span>
                    </div>
                  ) : null}
                  <div className="candidate-note-body">{safeText(reply?.body || '-')}</div>
                  <div className="candidate-note-actions-row">
                    <button type="button" className="ghost-btn bounceable mini-inline-action" onClick={() => startReply(thread.root, reply)}>Reply</button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
        {isReplyingHere ? (
          <div className="candidate-note-reply-indicator">
            <span>Replying to {replyContext?.replyToUsername || 'note'}</span>
            <small>{shortNotePreview(replyContext?.replyToBody || '', 120)}</small>
            <button type="button" className="ghost-btn bounceable" onClick={() => setReplyContext(null)}>Cancel</button>
          </div>
        ) : null}
      </div>
    );
  }

  if (loading && !item) {
    return (
      <Layout title={`Candidate • ${candidateId}`} subtitle="Loading profile details.">
        <div className="panel top-gap">
          <div className="helper-text">Loading candidate profile...</div>
          <div className="row-actions top-gap-small">
            <button className="ghost-btn bounceable" type="button" onClick={() => navigate('/candidates')}>Back</button>
            <button className="add-profile-btn bounceable" type="button" onClick={() => { setLoading(false); setError('Profile load was taking too long. Click Retry.'); }}>Stop Loading</button>
          </div>
        </div>
      </Layout>
    );
  }

  if (error || !item) {
    return (
      <Layout title={`Candidate • ${candidateId}`} subtitle="This profile could not be opened right now.">
        <div className="panel top-gap">
          <div className="panel-title">Profile not available</div>
          <div className="helper-text top-gap-small">{error || 'Candidate not found.'}</div>
          <div className="row-actions top-gap">
            <button className="ghost-btn bounceable" type="button" onClick={() => navigate('/candidates')}>Back to Candidates</button>
            <button className="add-profile-btn bounceable" type="button" onClick={load}>Retry</button>
          </div>
        </div>
      </Layout>
    );
  }

  const canDeleteProfile = ['admin', 'manager'].includes(String(user?.role || '').toLowerCase());
  async function deleteCurrentCandidate() {
    if (!canDeleteProfile || !item?.candidate_id) return;
    const ok = window.confirm(`Delete ${item.full_name || item.candidate_id || 'this candidate'}? This removes the profile from CRM screens.`);
    if (!ok) return;
    try {
      const result = await api.post(`/api/candidates/${encodeURIComponent(item.candidate_id)}/delete`, {}, { timeoutMs: 45000 });
      const done = [...(Array.isArray(result?.deleted_ids) ? result.deleted_ids : []), ...(Array.isArray(result?.soft_hidden_ids) ? result.soft_hidden_ids : [])];
      if (!done.includes(String(item.candidate_id))) throw new Error('Profile still exists after delete check.');
      candidateCacheRef.current[item.candidate_id] = null;
      setMessage(done.length ? `${done.length} profile removed from CRM view.` : 'Profile deleted.');
      setSyncState('saved');
      navigate('/duplicate-profiles', { replace: true });
    } catch (error) {
      setSyncState('error');
      setMessage(error.message || 'Candidate could not be deleted.');
    }
  }
  const approvalState = String(item.approval_status || 'Draft').toLowerCase();
  const stateLabel = approvalState === 'approved' ? 'Approved' : approvalState === 'rejected' ? 'Rejected' : approvalState === 'pending' ? 'Pending Approval' : 'Draft';
  const submissionLocked = approvalState === 'pending' || approvalState === 'approved';
  const submitButtonLabel = actionBusy === 'submit' ? 'Submitting...' : submissionLocked ? 'Submitted' : 'Submit';
  const totalExperienceParts = splitExperienceValue(item?.total_experience || '');
  const relevantExperienceParts = splitExperienceValue(item?.relevant_experience || '');
  const liveExperienceInvalid = hasExperienceMismatch(item);
  const liveSalaryInvalid = hasSalaryMismatch(item);
  const experienceGuardText = 'Relevant Experience cannot stay higher than Total Experience. Keep it equal or lower.';
  const salaryGuardText = 'CTC Monthly cannot stay lower than In-hand Monthly Salary. Keep it equal or higher.';

  const candidateDisplayName = item.full_name || item.candidate_id;

  return (
    <Layout
      title={(
        <span className="candidate-top-title-wrap">
          <span className="candidate-top-title-kicker">Candidate</span>
          <span className="candidate-top-title-name">{candidateDisplayName}</span>
        </span>
      )}
      subtitle="Candidate profile, contact details, and follow-up controls."
    >
      <CelebrationBurst active={celebrate} />
      <div className={`panel top-gap candidate-detail-full-panel ${statusFlash ? `approval-wash approval-wash-${statusFlash}` : ''}`}>
        <div className="panel-heading-row">
          <div>
            <div className="panel-title">Candidate Detail Form</div>
            <div className="helper-text top-gap-small">Review the profile, update fields, and send it for approval when the details are ready.</div>
          </div>
          <div className="detail-header-actions detail-header-actions-modern">
            <MiniIconButton title="Previous Profile" className="modern-eye-btn" onClick={() => prevCandidate && openCandidate(prevCandidate.candidate_id)} disabled={!prevCandidate}><PrevIcon /></MiniIconButton>
            <MiniIconButton title="Dial Call" className="modern-call-btn" onClick={onDial}><PhoneIcon /></MiniIconButton>
            <div className="wa-template-shell">
              <MiniIconButton title="Open WhatsApp" className="modern-wa-btn" onClick={() => openWhatsApp('')}><WhatsAppIcon /></MiniIconButton>
              <select className="wa-template-select genz-wa-select" defaultValue="" onChange={(e) => { useWaTemplate(e.target.value); e.target.value = ''; }}>
                <option value="">WA template</option>
                {safeTemplateList(waTemplates, 80).map((tpl) => <option key={tpl} value={tpl}>{safeText(tpl).slice(0, 70)}</option>)}
                <option value="__add_new__">Add New...</option>
              </select>
            </div>
            <MiniIconButton title="Next Profile" className="modern-eye-btn" onClick={() => nextCandidate && openCandidate(nextCandidate.candidate_id)} disabled={!nextCandidate}><NextIcon /></MiniIconButton>
            {canDeleteProfile ? <button type="button" className="mini-btn edit bounceable modern-delete-btn" onClick={deleteCurrentCandidate}>Delete</button> : null}
          </div>
        </div>


        <div className={`approval-action-banner state-${approvalState || 'draft'}`}>
          <div className="approval-banner-left">
            <span className={`profile-state-chip state-${approvalState || 'draft'}`}>{stateLabel}</span>
            {syncState !== 'idle' ? (
              <span className={`mini-chip sync-chip ${syncState}`}>{syncState === 'saving' ? 'Syncing...' : syncState === 'saved' ? 'Synced' : 'Sync failed'}</span>
            ) : null}
            <span className="helper-text">Status: {item.status || '-'} • Details Sent: {item.all_details_sent || 'Pending'} • {profileVerified ? 'Fresh verified' : 'Safe edit enabled, verifying in background'}</span>
          </div>
          <div className="approval-banner-right approval-banner-right-with-view">
            <div className="last-viewed-highlight">
              <span className="last-viewed-label">Last Viewed</span>
              <strong>{formatLastViewedStamp(item.last_viewed_at)}</strong>
            </div>
            {leadership ? (
              <div className="approval-banner-actions approval-banner-noteonly" style={{ display: 'grid', gap: 10, justifyItems: 'end', minWidth: 260 }}>
                <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                  {approvalState !== 'approved' ? <button className="mini-btn call bounceable" type="button" disabled={approvalDecisionBusy === 'approve' || approvalDecisionBusy === 'reject'} onClick={approveFromDetail}>Approve</button> : null}
                  {approvalState !== 'rejected' ? <button className="mini-btn edit bounceable" type="button" disabled={approvalDecisionBusy === 'approve' || approvalDecisionBusy === 'reject'} onClick={() => { setDetailRejectOpen((current) => !current); if (detailRejectOpen) setDetailRejectReason(''); }}>Reject</button> : null}
                </div>
                {detailRejectOpen ? (
                  <div className="approval-inline-reject" style={{ width: '100%' }}>
                    <textarea rows="2" placeholder="Reject note is required." value={detailRejectReason} onChange={(e) => setDetailRejectReason(e.target.value)} />
                    <div className="row-actions top-gap-small" style={{ justifyContent: 'flex-end' }}>
                      <button className="mini-btn edit bounceable" type="button" disabled={!detailRejectReason.trim() || approvalDecisionBusy === 'approve' || approvalDecisionBusy === 'reject'} onClick={rejectFromDetail}>Confirm Reject</button>
                      <button className="ghost-btn bounceable" type="button" disabled={approvalDecisionBusy === 'approve' || approvalDecisionBusy === 'reject'} onClick={() => { setDetailRejectOpen(false); setDetailRejectReason(''); }}>Cancel</button>
                    </div>
                  </div>
                ) : <span className="helper-text">TL / Manager can change the approval state right here.</span>}
              </div>
            ) : approvalState === 'pending' ? (
              <div className="approval-banner-actions approval-banner-noteonly">
                <span className="helper-text">Pending approval. TL / Manager can approve or reject this profile from this page or the Submissions section.</span>
              </div>
            ) : null}
          </div>
        </div>

        <SafeSectionBoundary title="Recent Notes">
        <div className="candidate-recent-note-strip-shell top-gap-small">
          <div className="candidate-recent-note-strip-head">
            <div className="panel-title">Recent 3 Notes</div>
            <div className="helper-text top-gap-small">Latest saved notes now sit here too, so people do not have to scroll like archaeologists just to remember what happened.</div>
          </div>
          <div className="candidate-recent-note-strip top-gap-small">
            {recentSavedNotes.length ? recentSavedNotes.map((thread, index) => (
              <button key={`recent-note-${normalizeNoteId(thread?.root?.id) || index}`} type="button" className="candidate-note-highlight-card bounceable" onClick={jumpToNotesPanel}>
                <div className="candidate-note-highlight-top">
                  <span className="candidate-note-highlight-kicker">Recent Note {index + 1}</span>
                  <span className="candidate-note-highlight-time">{formatNoteStamp(thread?.root?.created_at)}</span>
                </div>
                <div className="candidate-note-highlight-author">{noteAuthorName(thread?.root)}</div>
                <div className="candidate-note-highlight-text">{shortNotePreview(thread?.root?.body || '-', 170)}</div>
                <div className="candidate-note-highlight-hint">Open Notes Chat</div>
              </button>
            )) : <div className="candidate-recent-note-strip-empty">No saved notes yet. Add notes below and the latest 3 will show here.</div>}
          </div>
        </div>
        </SafeSectionBoundary>

        <form className="stack-form" ref={formRef} onKeyDown={moveToNextField}>
          <div className="candidate-sequence-shell">
            <div className="candidate-meta-row">
              <div className="field compact-id-field candidate-meta-card"><label>Candidate ID</label><input className="compact-id-input" value={item.candidate_id || ''} readOnly /></div>
              <div className="field compact-id-field candidate-meta-card" data-field="recruiter_code">
                <label>Recruiter Code</label>
                {canManagerReassignRecruiter ? (
                  <select className="compact-id-input" value={item.recruiter_code || ''} onChange={(e) => patch({ recruiter_code: e.target.value })}>
                    <option value="">Select recruiter</option>
                    {stableOptions(safeArray(recruiterOptions).map((row) => safeText(row?.recruiter_code || '')), item.recruiter_code || '').map((code) => {
                      const matched = safeArray(recruiterOptions).find((row) => safeText(row?.recruiter_code || '') === safeText(code));
                      return <option key={code} value={code}>{matched ? `${safeText(matched.full_name || matched.recruiter_code)} • ${safeText(matched.recruiter_code)}` : safeText(code)}</option>;
                    })}
                  </select>
                ) : <input className="compact-id-input" value={item.recruiter_code || ''} readOnly />}
              </div>
              <div className="candidate-meta-card candidate-meta-support-card">
                <div className="candidate-mini-support-grid candidate-mini-support-grid-inline">
                  <div data-field="call_connected"><ChoiceField compact label="Call Connected" value={item.call_connected || 'No'} options={CALL_CONNECTED_OPTIONS} onChange={(value) => patch({ call_connected: value })} disabled={editingLocked} /></div>
                  <div data-field="looking_for_job"><ChoiceField compact label="Looking for Job" value={item.looking_for_job || 'Yes'} options={LOOKING_FOR_JOB_OPTIONS} onChange={(value) => patch({ looking_for_job: value })} disabled={editingLocked} invalid={invalidFields.includes('looking_for_job')} /></div>
                </div>
              </div>
            </div>

            <div className="candidate-form-grid candidate-sequence-grid candidate-basic-row">
              <div className={`field ${invalidFields.includes('full_name') ? 'invalid-field' : ''}`.trim()} data-field="full_name"><label>Name</label><input className={invalidFields.includes('full_name') ? 'invalid-input' : ''} value={item.full_name || ''} onChange={(e) => patch({ full_name: e.target.value })} disabled={editingLocked} /></div>
              <div className={`field ${invalidFields.includes('phone') ? 'invalid-field' : ''}`.trim()} data-field="phone"><label>Number</label><input className={invalidFields.includes('phone') ? 'invalid-input' : ''} value={item.phone || ''} onChange={(e) => patch({ phone: e.target.value })} disabled={editingLocked} /></div>
              <div className={`field ${invalidFields.includes('location') ? 'invalid-field' : ''}`.trim()} data-field="location"><label>Location</label><input className={invalidFields.includes('location') ? 'invalid-input' : ''} value={item.location || ''} onChange={(e) => patch({ location: e.target.value })} disabled={editingLocked} /></div>
              <div className={`field ${invalidFields.includes('qualification') ? 'invalid-field' : ''}`.trim()} data-field="qualification"><label>Qualification</label><input className={invalidFields.includes('qualification') ? 'invalid-input' : ''} value={item.qualification || ''} onChange={(e) => patch({ qualification: e.target.value })} disabled={editingLocked} /></div>
            </div>

            <div className="candidate-form-grid candidate-sequence-grid candidate-two-col-row top-gap-small">
              <div className={`field ${invalidFields.includes('preferred_location') ? 'invalid-field' : ''}`.trim()} data-field="preferred_location">
                <div className="field-label-line"><label>Preferred Location</label><button type="button" className="mini-inline-action bounceable" disabled={editingLocked} onClick={addPreferredLocationOption}>+ Add New</button></div>
                <div className="choice-chip-row compact-row">
                  {safeTemplateList(preferredLocations, 80).map((option) => {
                    const checked = splitMulti(item.preferred_location || 'Noida').includes(option);
                    return <button key={option} type="button" disabled={editingLocked} className={`choice-chip bounceable ${checked ? 'active' : ''}`} onClick={() => patch({ preferred_location: toggleMultiValue(item.preferred_location || 'Noida', option, true) })}>{option}</button>;
                  })}
                </div>
                <div className="helper-text top-gap-small">Selected: {item.preferred_location || 'Noida'}</div>
              </div>
              <div data-field="qualification_level"><ChoiceField label="Degree / Qualification" value={item.qualification_level || 'Graduate'} options={DEGREE_OPTIONS} onChange={(value) => patch({ qualification_level: value })} disabled={editingLocked} invalid={invalidFields.includes('qualification_level')} /></div>
            </div>

            <div className="candidate-form-grid candidate-sequence-grid candidate-three-col-row top-gap-small">
              <div className={`field exp-split-field ${(invalidFields.includes('total_experience') || liveExperienceInvalid) ? 'invalid-field live-invalid-field' : ''}`.trim()} data-field="total_experience"><label>Total Experience</label><div className="split-exp-grid"><input className={(invalidFields.includes('total_experience') || liveExperienceInvalid) ? 'invalid-input live-invalid-input' : ''} value={totalExperienceParts.years} onChange={(e) => patchExperienceField('total_experience', 'years', e.target.value)} disabled={editingLocked} placeholder="Years" /><input className={(invalidFields.includes('total_experience') || liveExperienceInvalid) ? 'invalid-input live-invalid-input' : ''} value={totalExperienceParts.months} onChange={(e) => patchExperienceField('total_experience', 'months', e.target.value)} disabled={editingLocked} placeholder="Months" /></div><div className="helper-text top-gap-small">Saved as: {formatExperiencePreview(item.total_experience || '0')}</div>{liveExperienceInvalid ? <div className="helper-text top-gap-small live-validation-text">{experienceGuardText}</div> : null}</div>
              <div className={`field exp-split-field ${(invalidFields.includes('relevant_experience') || liveExperienceInvalid) ? 'invalid-field live-invalid-field' : ''}`.trim()} data-field="relevant_experience"><div className="field-label-line"><label>Relevant Experience</label><button type="button" className="mini-inline-action bounceable" disabled={editingLocked} onClick={copyTotalExperienceToRelevant}>Same</button></div><div className="split-exp-grid"><input className={(invalidFields.includes('relevant_experience') || liveExperienceInvalid) ? 'invalid-input live-invalid-input' : ''} value={relevantExperienceParts.years} onChange={(e) => patchExperienceField('relevant_experience', 'years', e.target.value)} disabled={editingLocked} placeholder="Years" /><input className={(invalidFields.includes('relevant_experience') || liveExperienceInvalid) ? 'invalid-input live-invalid-input' : ''} value={relevantExperienceParts.months} onChange={(e) => patchExperienceField('relevant_experience', 'months', e.target.value)} disabled={editingLocked} placeholder="Months" /></div><div className="helper-text top-gap-small">Saved as: {formatExperiencePreview(item.relevant_experience || '0')}</div>{liveExperienceInvalid ? <div className="helper-text top-gap-small live-validation-text">{experienceGuardText}</div> : null}</div>
              <div data-field="relevant_experience_range"><div className="field field-with-header-action"><div className="field-label-line"><label>Relevant Experience Range</label><button type="button" className="mini-inline-action bounceable" disabled={editingLocked} onClick={matchRelevantExperienceRange}>Match</button></div><SelectField label="" value={item.relevant_experience_range || ''} options={EXPERIENCE_RANGE_OPTIONS} onChange={(value) => patch({ relevant_experience_range: value })} disabled={editingLocked} invalid={invalidFields.includes('relevant_experience_range')} /></div></div>
            </div>

            <div className="candidate-form-grid candidate-sequence-grid candidate-three-col-row top-gap-small">
              <div className={`field ${(invalidFields.includes('ctc_monthly') || liveSalaryInvalid || salaryInputError) ? 'invalid-field live-invalid-field' : ''}`.trim()} data-field="ctc_monthly"><label>CTC Monthly</label><input className={(invalidFields.includes('ctc_monthly') || liveSalaryInvalid || salaryInputError) ? 'invalid-input live-invalid-input' : ''} value={item.ctc_monthly || ''} onChange={(e) => handleSalaryFieldChange('ctc_monthly', e.target.value, 'CTC Monthly')} onBeforeInput={(e) => handleSalaryBeforeInput(e, 'CTC Monthly')} onPaste={(e) => handleSalaryPaste(e, 'CTC Monthly')} inputMode="numeric" pattern="[0-9]*" disabled={editingLocked} />{salaryInputError ? <div className="helper-text top-gap-small live-validation-text">{salaryInputError}</div> : liveSalaryInvalid ? <div className="helper-text top-gap-small live-validation-text">{salaryGuardText}</div> : null}</div>
              <div className={`field ${(invalidFields.includes('in_hand_salary') || liveSalaryInvalid || salaryInputError) ? 'invalid-field live-invalid-field' : ''}`.trim()} data-field="in_hand_salary"><label>In-hand Monthly Salary</label><input className={(invalidFields.includes('in_hand_salary') || liveSalaryInvalid || salaryInputError) ? 'invalid-input live-invalid-input' : ''} value={item.in_hand_salary || ''} onChange={(e) => handleSalaryFieldChange('in_hand_salary', e.target.value, 'In-hand Monthly Salary')} onBeforeInput={(e) => handleSalaryBeforeInput(e, 'In-hand Monthly Salary')} onPaste={(e) => handleSalaryPaste(e, 'In-hand Monthly Salary')} inputMode="numeric" pattern="[0-9]*" disabled={editingLocked} />{salaryInputError ? <div className="helper-text top-gap-small live-validation-text">{salaryInputError}</div> : liveSalaryInvalid ? <div className="helper-text top-gap-small live-validation-text">{salaryGuardText}</div> : null}</div>
              <div data-field="relevant_in_hand_range"><div className="field field-with-header-action"><div className="field-label-line"><label>In-hand Salary Range</label><button type="button" className="mini-inline-action bounceable" disabled={editingLocked} onClick={matchSalaryRange}>Match</button></div><SelectField label="" value={item.relevant_in_hand_range || ''} options={SALARY_RANGE_OPTIONS} onChange={(value) => patch({ relevant_in_hand_range: value })} disabled={editingLocked} invalid={invalidFields.includes('relevant_in_hand_range')} /></div></div>
            </div>

            <div className="candidate-form-grid candidate-sequence-grid candidate-three-col-row top-gap-small">
              <div data-field="career_gap"><ChoiceField label="Career Gap" value={item.career_gap || 'Fresher'} options={CAREER_GAP_OPTIONS} onChange={(value) => patch({ career_gap: value })} disabled={editingLocked} invalid={invalidFields.includes('career_gap')} /></div>
              <div data-field="documents_availability"><ChoiceField label="All Documents Availability" value={normalizeDocumentsAvailability(item.documents_availability || 'Yes')} options={DOCUMENTS_OPTIONS} onChange={(value) => patch({ documents_availability: value })} disabled={editingLocked} invalid={invalidFields.includes('documents_availability')} showAll /></div>
              <div data-field="communication_skill"><ChoiceField label="Communication Skill" value={item.communication_skill || 'Average'} options={COMMUNICATION_SKILL_OPTIONS} onChange={(value) => patch({ communication_skill: value })} disabled={editingLocked} invalid={invalidFields.includes('communication_skill')} /></div>
            </div>

            <div className="candidate-form-grid candidate-sequence-grid candidate-three-col-row top-gap-small">
              <div className="field field-followup-panel" data-field="follow_up_at"><label>Follow-up</label><input type="datetime-local" value={toDateTimeLocalInput(item.follow_up_at || '')} onChange={(e) => patch({ follow_up_at: e.target.value, follow_up_status: e.target.value ? 'Open' : '' })} disabled={editingLocked} /><div className="choice-chip-row compact-row top-gap-small followup-preset-row">{safeArray(FOLLOW_UP_PRESETS).map((preset) => <button key={preset.label} type="button" className="choice-chip bounceable" disabled={editingLocked} onClick={() => applyFollowUpPreset(preset)}>{preset.label}</button>)}<button type="button" className="choice-chip bounceable" disabled={editingLocked} onClick={() => patch({ follow_up_at: '', follow_up_status: '', follow_up_note: '' })}>Clear</button></div><div className="field-subnote-title top-gap-small">Follow-up Notes</div><textarea rows="3" className="followup-note-textarea" value={item.follow_up_note || ''} onChange={(e) => patch({ follow_up_note: e.target.value })} disabled={editingLocked} placeholder="Mention follow-up note so the reminder also shows it." /></div>
              <div className={`field ${invalidFields.includes('interview_reschedule_date') ? 'invalid-field' : ''}`.trim()} data-field="interview_reschedule_date"><label>Interview Date</label><div className="weekday-date-wrap"><input type="date" value={selectedDate} onChange={(e) => patch({ interview_reschedule_date: e.target.value })} disabled={editingLocked} /></div><div className="weekday-shortcuts">{WEEKDAY_CHOICES.map((day) => <button key={day} type="button" className="weekday-chip bounceable" disabled={editingLocked} onClick={() => patch({ interview_reschedule_date: nextDateForWeekday(day) })}>{day.slice(0, 3)}</button>)}</div><div className="row-actions top-gap-small"><button className="ghost-btn bounceable" type="button" onClick={() => (canDirectRemoveInterview ? removeInterviewDateDirectly() : setRemoveInterviewOpen(true))} disabled={editingLocked || !item?.interview_reschedule_date}>{canDirectRemoveInterview ? 'Remove' : 'Request Remove'}</button>{String(item?.interview_remove_status || '').toLowerCase() === 'pending' && <span className="helper-text">Removal request pending.</span>}</div></div>
              <div data-field="virtual_onsite"><SelectField label="Interview Mode" value={item.virtual_onsite || 'Walkin'} options={INTERVIEW_MODE_OPTIONS} onChange={(value) => patch({ virtual_onsite: value })} disabled={editingLocked} invalid={invalidFields.includes('virtual_onsite')} /></div>
            </div>

            <div className="candidate-form-grid candidate-sequence-grid candidate-three-col-row top-gap-small">
              <div data-field="status"><ChoiceField label="Status" value={approvalPending && !leadership ? 'In - Progress' : (item.status || displayStatusOptions[0])} options={displayStatusOptions} onChange={(value) => patch({ status: value })} disabled={editingLocked && !leadership} invalid={invalidFields.includes('status')} showAll /></div>
              <div data-field="profile_priority"><ChoiceField label="Priority" value={item.profile_priority || 'Medium'} options={PROFILE_PRIORITY_OPTIONS} onChange={(value) => patch({ profile_priority: value })} disabled={editingLocked} showAll /></div>
              <div data-field="all_details_sent"><ChoiceField label="All Details Sent" value={approvalPending && !leadership ? 'Pending' : (item.all_details_sent || 'Pending')} options={DETAILS_SENT_OPTIONS} onChange={(value) => patch({ all_details_sent: value })} disabled={editingLocked && !leadership} invalid={invalidFields.includes('all_details_sent')} showAll /></div>
              <div className={`field ${invalidFields.includes('submission_date') ? 'invalid-field' : ''}`.trim()} data-field="submission_date"><label>Submission Date</label><input className={invalidFields.includes('submission_date') ? 'invalid-input' : ''} type="datetime-local" value={toDateTimeLocalInput(item.submission_date || nowDateTimeLocal())} onChange={(e) => patch({ submission_date: e.target.value })} disabled={editingLocked} /><div className="row-actions top-gap-small"><button className="ghost-btn bounceable today-inline-btn" type="button" disabled={editingLocked} onClick={() => patch({ submission_date: nowDateTimeLocal() })}>Now</button><span className="helper-text">{formatTwelveHour(item.submission_date || nowDateTimeLocal())}</span></div></div>
            </div>

            <div className="field top-gap-small" data-field="process"><MultiChoiceField label="Process" value={item.process || ''} options={processOptions} onChange={(value) => patch({ process: value })} onAddNew={addNewProcessOption} disabled={editingLocked} invalid={invalidFields.includes('process')} /></div>

            <SafeSectionBoundary title="Notes Chat">
            <div className="panel top-gap-small candidate-notes-chat-panel" data-field="master_notes" ref={notesPanelRef}>
              <div className="panel-heading-row">
                <div>
                  <div className="panel-title">Notes Chat</div>
                  <div className="helper-text top-gap-small">Latest 5 notes stay visible here. Older notes open from full history without stuffing note text into the timeline.</div>
                </div>
                <div className="candidate-notes-head-tools">
                  <select className="inline-input note-template-select compact-inline-select" defaultValue="" onChange={(e) => { const value = e.target.value; useNoteTemplate(value); e.target.value = ''; }}>
                    <option value="">Preset notes</option>
                    {safeTemplateList(noteTemplates, 80).map((tpl) => <option key={tpl} value={tpl}>{safeText(tpl).slice(0, 80)}</option>)}
                    <option value="__add_new__">+ Add New Template</option>
                  </select>
                  <button type="button" className="ghost-btn bounceable" onClick={() => setShowHistory(true)} disabled={noteThreads.length <= 5}>Open Notes History</button>
                </div>
              </div>
              {replyContext ? (
                <div className="candidate-note-reply-banner top-gap-small">
                  <div>
                    <strong>Replying to {replyContext.replyToUsername || 'note'}</strong>
                    <div className="helper-text top-gap-small">{shortNotePreview(replyContext.replyToBody || '', 150)}</div>
                  </div>
                  <button type="button" className="ghost-btn bounceable" onClick={() => setReplyContext(null)}>Cancel</button>
                </div>
              ) : null}
              <div className="candidate-notes-composer-grid top-gap-small">
                <div className="candidate-notes-input-col">
                  <textarea
                    rows="5"
                    className="candidate-notes-main-textarea"
                    value={noteBody}
                    onChange={(e) => setNoteBody(e.target.value)}
                    disabled={noteSaving}
                    placeholder={replyContext ? 'Type reply for this note thread' : 'Type note and click Add Note'}
                  />
                  <div className="row-actions top-gap-small">
                    <button className="add-profile-btn bounceable" type="button" onClick={addNote} disabled={!noteBody.trim() || noteSaving}>{noteSaving ? 'Adding...' : replyContext ? 'Reply Note' : 'Add Note'}</button>
                    <span className="helper-text candidate-notes-thread-count">{noteThreads.length ? `${noteThreads.length} note thread${noteThreads.length === 1 ? '' : 's'} saved` : 'No notes added yet.'}</span>
                  </div>
                </div>
                <div className="candidate-notes-preview-col">
                  <div className="candidate-notes-preview-title">Recent preset previews</div>
                  <div className="candidate-notes-preview-list">
                    {recentNoteTemplatePreview.length ? recentNoteTemplatePreview.map((tpl, index) => (
                      <button
                        key={`${tpl}-${index}`}
                        type="button"
                        className="candidate-note-template-preview bounceable"
                        onClick={() => useNoteTemplate(tpl)}
                        title={tpl}
                      >
                        <span className="candidate-note-template-preview-index">{index + 1}</span>
                        <span className="candidate-note-template-preview-text">{tpl}</span>
                      </button>
                    )) : <div className="helper-text">No recent preset notes yet.</div>}
                  </div>
                </div>
              </div>
              <div className="candidate-notes-thread-list top-gap-small">
                {visibleNotes.length ? visibleNotes.map((thread) => renderNoteThread(thread, false)) : (
                  <div className="helper-text">No notes yet. Add the first note here and replies will stack like a clean chat thread.</div>
                )}
              </div>
            </div>
            </SafeSectionBoundary>
          </div>

          <div className="row-actions top-gap">
            <button className="ghost-btn bounceable candidate-action-btn candidate-reset-btn" type="button" onClick={resetFilledDetails} disabled={Boolean(actionBusy)}>Reset</button>
            <button className="add-profile-btn bounceable candidate-action-btn candidate-check-jd-btn" type="button" onClick={checkJdFit} disabled={Boolean(actionBusy)}>{actionBusy === 'check' ? 'Working...' : 'Check JD'}</button>
            <button className="add-profile-btn bounceable candidate-action-btn candidate-submit-btn" type="button" onClick={submitForApproval} disabled={submissionLocked || Boolean(actionBusy)}>{submitButtonLabel}</button>
            <button className="add-profile-btn bounceable candidate-action-btn candidate-save-btn" type="button" onClick={save} disabled={Boolean(actionBusy && actionBusy !== 'save')} style={{ minWidth: 92, paddingInline: 18 }}>{syncState === 'saving' ? 'Syncing' : 'Save'}</button>
            {!!message && <span className={`helper-text sync-message ${syncState === 'error' ? 'is-error' : syncState === 'saved' ? 'is-success' : ''}`}>{message}</span>}
          </div>
          {submissionIssues.length ? <div className="top-gap-small">{submissionIssues.map((issue, index) => <div key={`submit-issue-${index}`} className="helper-text sync-message is-error">{issue}</div>)}</div> : null}
          <div className="helper-text top-gap-small">Save keeps the draft. Check JD auto-saves and shows the relevant JD popup. Open All JD opens every matched JD in separate tabs.</div>

          <SafeSectionBoundary title="Candidate Files">
          <div className="panel top-gap-small candidate-files-panel">
            <div className="panel-heading-row">
              <div>
                <div className="panel-title">Candidate Files</div>
                <div className="helper-text top-gap-small">Files are lazy-loaded now. Notes stay fast; resumes/recordings load only when you open this section. Revolutionary, apparently.</div>
              </div>
              <button type="button" className="add-profile-btn bounceable file-action-btn" onClick={loadCandidateFiles} disabled={filesLoading}>
                {filesLoading ? 'Loading Files...' : filesLoaded ? 'Refresh Files' : 'Open / Load Files'}
              </button>
            </div>
            {filesLoaded ? (
            <div className="candidate-file-stack top-gap-small">
              <div className="candidate-file-row">
                <div className="candidate-file-copy">
                  <strong>Resume</strong>
                  <div className="helper-text">{latestResumeFile?.original_name || item.resume_filename || 'No resume uploaded yet. Supported resume formats include PDF, images, and Word-compatible DOC, DOCX, DOCM, DOTX, and DOTM files. The saved size appears on the file chip.'}</div>
                </div>
                <div className="candidate-file-actions">
                  <input id="candidate-resume-upload" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.docm,.dotx,.dotm,.odt,.rtf,.txt,.html,.htm,.md" hidden disabled={editingLocked || !!fileBusy} onChange={async (e) => { const file = e.target.files?.[0]; if (file) await uploadCandidateAsset('resume', file); e.target.value = ''; }} />
                  <label htmlFor="candidate-resume-upload" className={`ghost-btn bounceable file-action-btn ${editingLocked || !!fileBusy ? 'is-disabled' : ''}`}>Upload</label>
                  <button type="button" className="add-profile-btn bounceable file-action-btn" disabled={!latestResumeFile} onClick={() => latestResumeFile && downloadCandidateAsset(latestResumeFile.file_id)}>View</button>
                </div>
              </div>
              <div className="candidate-file-chip-row">{safeArray(candidateFiles).filter((file) => file?.file_kind === 'resume').slice(0, 3).map((file, index) => <button key={safeText(file.file_id) || `resume-file-${index}`} type="button" className="candidate-file-chip bounceable" onClick={() => downloadCandidateAsset(file.file_id)}><span>{safeText(file.original_name || file.file_name || 'Resume')}</span><small>{formatFileSize(file.size_bytes)}</small></button>)}</div>

              <div className="candidate-file-row top-gap-small">
                <div className="candidate-file-copy">
                  <strong>Call Recording</strong>
                  <div className="helper-text">{latestRecordingFile?.original_name || item.recording_filename || 'No call recording uploaded yet. Supported phone recording formats include AMR, 3GP, and MOV. The saved size appears on the file chip.'}</div>
                </div>
                <div className="candidate-file-actions">
                  <input id="candidate-recording-upload" type="file" accept=".mp3,.wav,.m4a,.aac,.ogg,.webm,.mp4,.amr,.3gp,.mov" hidden disabled={editingLocked || !!fileBusy} onChange={async (e) => { const file = e.target.files?.[0]; if (file) await uploadCandidateAsset('call_recording', file); e.target.value = ''; }} />
                  <label htmlFor="candidate-recording-upload" className={`ghost-btn bounceable file-action-btn ${editingLocked || !!fileBusy ? 'is-disabled' : ''}`}>Upload</label>
                  <button type="button" className="add-profile-btn bounceable file-action-btn" disabled={!latestRecordingFile} onClick={() => latestRecordingFile && downloadCandidateAsset(latestRecordingFile.file_id)}>View</button>
                </div>
              </div>
              <div className="candidate-file-chip-row">{safeArray(candidateFiles).filter((file) => file?.file_kind === 'call_recording').slice(0, 3).map((file, index) => <button key={safeText(file.file_id) || `recording-file-${index}`} type="button" className="candidate-file-chip bounceable" onClick={() => downloadCandidateAsset(file.file_id)}><span>{safeText(file.original_name || file.file_name || 'Call Recording')}</span><small>{formatFileSize(file.size_bytes)}</small></button>)}</div>
            </div>
            ) : (
              <div className="helper-text top-gap-small">Files are not loaded yet. Click Open / Load Files only when you need resume or recording.</div>
            )}
          </div>
          </SafeSectionBoundary>

          <SafeSectionBoundary title="Timeline">
          <div className="panel top-gap-small candidate-timeline-panel">
            <div className="panel-heading-row">
              <div>
                <div className="panel-title">Timeline</div>
                <div className="helper-text top-gap-small">Every profile open, save, note, upload, submission, approval, and follow-up action shows here.</div>
              </div>
              <div className="timeline-tab-row">
                <button className={`choice-chip bounceable ${timelineTab === 'today' ? 'active' : ''}`} type="button" onClick={() => { setTimelineTab('today'); setShowTimeline(false); }}>Today</button>
                <button className={`choice-chip bounceable ${timelineTab === 'past3' ? 'active' : ''}`} type="button" onClick={() => { setTimelineTab('past3'); setShowTimeline(false); }}>Past 3 Days</button>
                <button className={`choice-chip bounceable ${timelineTab === 'all' ? 'active' : ''}`} type="button" onClick={() => { setTimelineTab('all'); setShowTimeline(false); }}>All History</button>
                {filteredTimeline.length > 12 ? <button className="ghost-btn bounceable" type="button" onClick={() => setShowTimeline((current) => !current)}>{showTimeline ? 'Show Less' : `Show More (${filteredTimeline.length})`}</button> : null}
              </div>
            </div>
            <div className="timeline-list top-gap-small">
              {visibleTimeline.length ? visibleTimeline.map((row) => (
                <div key={safeText(row?.activity_id) || `${safeText(row?.action_type)}-${safeText(row?.created_at)}`} className={`activity-item timeline-item ${isTodayAction(row?.created_at) ? 'today-action' : ''}`.trim()}>
                  <div className="activity-left">
                    <div className="activity-name">{timelineText(row, user)}</div>
                    <div className="activity-sub">{formatTimelineTime(row?.created_at)}</div>
                  </div>
                  <span className="badge">{timelineBadge(row)}</span>
                </div>
              )) : <div className="helper-text">No timeline items in this section yet. Open, save, add note, call, or submit the profile and the history will appear here.</div>}
            </div>
          </div>
          </SafeSectionBoundary>
        </form>

        {showHistory ? (
          <div className="crm-modal-backdrop jd-suggestion-overlay" onClick={() => setShowHistory(false)}>
            <div className="crm-premium-modal candidate-notes-history-modal" onClick={(e) => e.stopPropagation()}>
              <div className="panel-heading-row">
                <div>
                  <div className="panel-title">Notes History</div>
                  <div className="helper-text top-gap-small">Every saved note from the start until now. Latest note threads stay on top, older history stays one click away.</div>
                </div>
                <button type="button" className="ghost-btn bounceable" onClick={() => setShowHistory(false)}>Close</button>
              </div>
              <SafeSectionBoundary title="Notes History">
              <div className="candidate-notes-history-body top-gap-small">
                {noteThreads.length ? noteThreads.map((thread) => renderNoteThread(thread, true)) : <div className="helper-text">No note history yet.</div>}
              </div>
              </SafeSectionBoundary>
            </div>
          </div>
        ) : null}

      {jdSuggestionPopup ? (
        <SafeSectionBoundary title="JD Suggestion Popup">
        <div className="crm-modal-backdrop jd-suggestion-overlay" onClick={() => { if (!jdPopupBusyId) setJdSuggestionPopup(null); }}>
          <div className="crm-premium-modal jd-suggestion-card jd-popup-landscape" style={{ width: "min(1960px, 98vw)", maxWidth: "98vw", maxHeight: "94vh", overflow: "auto", padding: "32px 34px", minHeight: "70vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="jd-suggestion-head">
              <div>
                <div className="panel-title">Relevant JD Matches</div>
                <div className="helper-text top-gap-small">{jdSuggestionPopup.label || 'Possible Fit'} • {jdSuggestionPopup.score || 0}% match score. Open one JD, open all JDs, or send the best fit on WhatsApp from here.</div>
              </div>
              <div className="jd-suggestion-head-right">
                <span className="jd-suggestion-score">{jdSuggestionPopup.score || 0}%</span>
                <button type="button" className="ghost-btn bounceable" onClick={openAllSuggestedJds} disabled={!jdSuggestionPopup?.suggestions?.length}>Open All JD</button>
                <button type="button" className="ghost-btn bounceable" onClick={() => setJdSuggestionPopup(null)} disabled={Boolean(jdPopupBusyId)}>Close</button>
              </div>
            </div>
            <div className="jd-suggestion-list jd-popup-grid-4 top-gap-small">
              {safeArray(jdSuggestionPopup?.suggestions).map((rawJd, index) => {
                const jd = safeObject(rawJd);
                return (
                <div key={safeText(jd.jd_id) || `jd-suggestion-${index}`} className="jd-suggestion-row">
                  <div className="jd-suggestion-copy">
                    <strong>{safeText(jd.job_title || 'JD')}</strong>
                    <div className="helper-text top-gap-small">{[jd.company, jd.location, jd.experience, jd.salary].map(safeText).filter(Boolean).join(' • ') || 'JD details available after open'}</div>
                    <div className="jd-fit-reason-list top-gap-small">
                      {safeTemplateList(jd.reasons || [], 8).map((reason, reasonIndex) => <span key={`${safeText(jd.jd_id) || index}-${reasonIndex}`} className="jd-fit-reason">{reason}</span>)}
                    </div>
                  </div>
                  <div className="jd-suggestion-actions">
                    <span className="jd-suggestion-score">{safeText(jd.score || 0)}%</span>
                    <button type="button" className="ghost-btn bounceable" onClick={() => openJdInNewTab(jd.jd_id)}>Open JD</button>
                    <button type="button" className="add-profile-btn bounceable jd-wa-btn" onClick={() => sendSuggestedJdOnWhatsApp(jd.jd_id)} disabled={jdPopupBusyId === safeText(jd.jd_id)}>
                      <WhatsAppIcon />
                      <span>{jdPopupBusyId === safeText(jd.jd_id) ? 'Sending...' : 'Send'}</span>
                    </button>
                  </div>
                </div>
              );
              })}
            </div>
            <div className="helper-text top-gap-small">Open JD shows the full JD with instructions and send material. Send picks the first ready WhatsApp material for this candidate so the process actually works instead of just looking decorative.</div>
          </div>
        </div>
        </SafeSectionBoundary>
      ) : null}

      {removeInterviewOpen && !canDirectRemoveInterview && (
        <div className="crm-modal-backdrop" onClick={() => setRemoveInterviewOpen(false)}>
          <div className="crm-premium-modal task-premium-modal task-modal-no-overlap interview-remove-modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-title">Request Interview Date Removal</div>
            <div className="helper-text top-gap-small">Recruiter removal needs approval. Add the reason so TL / Manager can review it.</div>
            <div className="field top-gap-small">
              <label>Reason</label>
              <textarea rows="4" value={removeInterviewReason} onChange={(e) => setRemoveInterviewReason(e.target.value)} placeholder="Why should the interview date be removed?" />
            </div>
            <div className="row-actions top-gap">
              <button className="ghost-btn bounceable" type="button" onClick={() => setRemoveInterviewOpen(false)}>Cancel</button>
              <button className="add-profile-btn bounceable" type="button" disabled={!removeInterviewReason.trim()} onClick={requestInterviewDateRemoval}>Request Approval</button>
            </div>
          </div>
        </div>
      )}
    </div>
    </Layout>
  );
}


export default function CandidateDetailPage() {
  const { candidateId } = useParams();
  return (
    <CandidateProfileErrorBoundary key={candidateId} candidateId={candidateId}>
      <CandidateDetailPageInner />
    </CandidateProfileErrorBoundary>
  );
}
