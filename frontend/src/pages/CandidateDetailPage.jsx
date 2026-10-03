import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { appendCandidateNavContext, buildCandidateUrl, readCandidateNavContext, readCandidateInstantProfile, writeCandidateInstantProfile } from '../lib/candidateNav';
import { emitCandidateUpsert } from '../lib/realtimeProfileBridge';
import { useAuth } from '../lib/auth';
import { addNoteTemplate, addWhatsAppTemplate, getNoteTemplates, getWhatsAppTemplates } from '../lib/templateStore';
import { dialCandidateWithLog, openWhatsAppWithLog, visiblePhone } from '../lib/candidateAccess';
import SafeSectionBoundary from '../components/SafeSectionBoundary';


// CC26_560: Jump within the existing profile. No fetch, reload, or new browser tab.
function cc560CandidateJump(section) {
  const root = document.querySelector('.candidate-detail-full-panel');
  if (!root) return;
  const special = { files: '.candidate-files-panel', save: '.candidate-save-btn' };
  const selector = special[section] || `[data-field="${section}"]`;
  const target = root.querySelector(selector);
  if (!target) return;
  target.scrollIntoView({ behavior: 'auto', block: 'start', inline: 'nearest' });
  const focusTarget = section === 'master_notes'
    ? target.querySelector('.candidate-notes-main-textarea')
    : target.matches('input, textarea, select') ? target
    : target.querySelector('input:not([readonly]):not([disabled]),select:not([disabled]),textarea:not([disabled])');
  if (focusTarget && section !== 'files' && section !== 'save') {
    try { focusTarget.focus({ preventScroll: true }); } catch (_) { focusTarget.focus(); }
  }
}

const CAREER_GAP_OPTIONS = ['Fresher', 'Currently Working', '1 - 3 Month', '4 - 6 Month', '7 - 12 Month', '1 - 1.5 Year', '1.6 - 2 Year'];
const STATUS_OPTIONS = ['Draft', 'In - Progress', 'All set for Interview', 'Not Intrested', 'Rejected once, needs new Interview', 'Rejected', 'Appeared in Interview'];
function approvedStatusValue(value) {
  const current = safeText(value).trim();
  const mapped = current === 'Not Interested' ? 'Not Intrested' : current;
  return STATUS_OPTIONS.includes(mapped) ? mapped : '';
}
const WEEKDAY_CHOICES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CALL_CONNECTED_OPTIONS = ['No', 'Yes', 'Partially'];
const DETAIL_AUTO_CONNECT_IGNORE_FIELDS = new Set(['call_connected', 'recruiter_code', 'recruiter_name', 'recruiter_designation', 'data_uploading_date', 'source_sr_no', 'last_viewed_at', 'last_viewed_by_name', 'approval_status', 'status', 'all_details_sent', 'submission_date', 'approved_at', 'approved_by_name']);
const LOOKING_FOR_JOB_OPTIONS = ['Yes', 'No'];
const PROFILE_PRIORITY_OPTIONS = ['High', 'Medium', 'Low'];
const DEGREE_OPTIONS = ['NON - Graduate', 'Graduate'];
const DETAILS_SENT_OPTIONS = ['Pending', 'Completed'];
const COMMUNICATION_SKILL_OPTIONS = ['Excellent', 'Good', 'Normal', 'Average', 'Below Average'];
const EXPERIENCE_RANGE_OPTIONS = ['Fresher', '1 - 3 Month', '4 - 6 Month', '7 - 12 Month', '1 - 1.5 Year', '1.6 - 2 Year', '2 - 2.5 Year', '2.6 - 3 Year', '3 - 3.5 Year', '3.6 - 4 Year', '4 - 4.5 Year', '4.6 - 5 Year', '5+ Year'];
const SALARY_RANGE_OPTIONS = ['0', '₹1K - ₹15K', '₹16K - ₹20K', '₹21K - ₹25K', '₹26K - ₹30K', '₹31K - ₹35K', '₹35K - ₹50K', '₹50K+'];
const PREFERRED_LOCATIONS = ['Noida', 'Gurgaon', 'Mumbai'];
const PREFERRED_LOCATION_STORAGE_KEY = 'careerCroxPreferredLocations_v3';
const INTERVIEW_MODE_OPTIONS = ['Virtual', 'Walkin', 'Onsite'];
const DOCUMENTS_OPTIONS = ['Yes', 'No', 'Partially'];

const GLOBAL_CANDIDATE_PROFILE_CACHE = {};
const GLOBAL_CANDIDATE_PROFILE_CACHE_KEYS = [];
const MAX_GLOBAL_CANDIDATE_PROFILE_CACHE = 45;

const PROFILE_NOTES_LIMIT = 60;
const PROFILE_TIMELINE_LIMIT = 80;
const PROFILE_FILES_LIMIT = 20;
const PROFILE_NAV_LIMIT = 500;

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

function normalizeWhatsAppTemplateOption(raw, index = 0) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const body = safeText(raw.body || raw.message || raw.text || '').trim();
    const title = safeText(raw.title || raw.heading || raw.name || body.split(/\r?\n/).find(Boolean) || `WhatsApp Preset ${index + 1}`).trim();
    return body ? { title, body } : null;
  }
  const body = safeText(raw || '').trim();
  if (!body) return null;
  const title = body.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.replace(/^[^\w{]+/, '').slice(0, 42) || `WhatsApp Preset ${index + 1}`;
  return { title, body };
}

function encodeWhatsAppTemplateOption(raw, index = 0) {
  const tpl = normalizeWhatsAppTemplateOption(raw, index);
  if (!tpl) return '';
  try { return JSON.stringify(tpl); } catch { return tpl.body || ''; }
}

function decodeWhatsAppTemplateOption(value = '') {
  const raw = safeText(value).trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return normalizeWhatsAppTemplateOption(parsed);
  } catch {
    return normalizeWhatsAppTemplateOption(raw);
  }
}

function candidateFirstName(source = {}) {
  const raw = safeObject(source);
  const name = safeText(raw.full_name || raw.name || raw.candidate_name || '').trim();
  return name.split(/\s+/).filter(Boolean)[0] || 'Candidate';
}

function recruiterDisplayName(source = {}, currentUser = {}) {
  const raw = safeObject(source);
  const usr = safeObject(currentUser);
  return safeText(
    raw.recruiter_name
      || raw.employee_name
      || raw.assigned_recruiter_name
      || raw.tl_name
      || usr.full_name
      || usr.name
      || usr.username
      || raw.recruiter_code
      || raw.employee_code
      || 'Career Crox'
  ).trim();
}

function renderWhatsAppTemplateBody(body = '', source = {}, currentUser = {}) {
  const first = candidateFirstName(source);
  const candidateName = safeText(safeObject(source).full_name || safeObject(source).name || first).trim();
  const recruiterName = recruiterDisplayName(source, currentUser);
  return safeText(body)
    .replace(/\{\{first_name\}\}/g, first)
    .replace(/\{\{candidate_name\}\}/g, candidateName)
    .replace(/\{\{recruiter_name\}\}/g, recruiterName);
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

function navRowIdentity(rawRow = {}, index = 0) {
  const raw = safeObject(rawRow);
  const candidateId = safeText(raw.candidate_id || raw.id || '').trim();
  const rowSpecific = safeText(
    raw._nav_row_key
      || raw.nav_row_key
      || raw.submission_id
      || raw.interview_id
      || raw.follow_up_id
      || raw.followup_id
      || raw.task_id
      || raw.activity_id
      || raw.call_log_id
      || ''
  ).trim();
  if (rowSpecific) return `${candidateId || 'row'}::${rowSpecific}`;
  return candidateId ? candidateId : `row::${index}`;
}

function sanitizeNavRow(row, index = 0) {
  const raw = safeObject(row);
  const candidateId = safeText(raw.candidate_id || raw.id || '').trim();
  return {
    ...sanitizeCandidateItem(raw),
    candidate_id: candidateId,
    full_name: safeText(raw.full_name || raw.name || raw.candidate_name || `Profile ${index + 1}`),
    _nav_row_key: navRowIdentity({ ...raw, candidate_id: candidateId }, index),
  };
}

function buildInstantCandidateShell(candidateId, source = null) {
  const id = safeText(candidateId || safeObject(source).candidate_id || safeObject(source).id || '').trim();
  if (!id) return null;
  const base = ensureCandidateDefaults(sanitizeCandidateItem(source || {}));
  const approval = safeText(base.approval_status || 'Draft').toLowerCase();
  const submittedFlow = ['pending', 'approved', 'rejected'].includes(approval);
  return ensureCandidateDefaults({
    ...base,
    candidate_id: id,
    full_name: safeText(base.full_name || base.name || base.candidate_name || id),
    status: submittedFlow ? safeText(base.status || 'In - Progress') : safeText(base.status || 'Draft'),
    all_details_sent: safeText(base.all_details_sent || 'Pending'),
  });
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
const BLOCKED_LEGACY_PROCESS_OPTIONS = new Set([
  'technical support executive',
]);
const DEFAULT_PROCESS_OPTIONS = Object.freeze([
  'Air India', 'Airtel', 'UrbanClap', 'Urban Company', 'Urban Company Tech', 'UAE Customer Retention', 'Kotak', 'Tata 1mg', 'Axis Bank', 'Samsung',
  'Tata Motors', 'Icegate', 'Icertate', 'Xiaomi', 'Xiaomi - Regional Language', 'American Express', 'Nykaa',
  'Razorpay', 'RBL / OLX', 'HDFC Back Office', 'Other',
]);
function mergeProcessOptions(...sources) {
  const merged = [];
  const seen = new Set();
  for (const source of [DEFAULT_PROCESS_OPTIONS, ...sources]) {
    for (const option of safeArray(source).map((item) => safeText(item).trim()).filter(Boolean)) {
      const key = option.toLowerCase();
      if (BLOCKED_LEGACY_PROCESS_OPTIONS.has(key) || seen.has(key)) continue;
      seen.add(key);
      merged.push(option);
    }
  }
  return merged;
}
function readStoredProcessOptions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROCESS_STORAGE_KEY) || '[]');
    return mergeProcessOptions(Array.isArray(parsed) ? parsed : []);
  } catch {
    return mergeProcessOptions();
  }
}
function persistProcessOptions(options) {
  try { localStorage.setItem(PROCESS_STORAGE_KEY, JSON.stringify(mergeProcessOptions(options))); } catch {}
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
  'full_name','phone','client','location','qualification','course_name','preferred_location','qualification_level','total_experience','relevant_experience',
  'relevant_experience_range','ctc_monthly','in_hand_salary','relevant_in_hand_range','career_gap','documents_availability',
  'communication_skill','follow_up_at','interview_reschedule_date','virtual_onsite','status','profile_priority','all_details_sent','submission_date',
  'process','call_connected','looking_for_job','master_notes'
];

const CRITICAL_SAVE_FIELDS = [
  ...DEFAULT_CANDIDATE_FIELD_ORDER,
  'candidate_id','full_name','phone','number','client','location','qualification','course_name','recruiter_code','recruiter_name','recruiter_designation',
  'preferred_location','qualification_level','total_experience','relevant_experience','relevant_experience_range','ctc_monthly',
  'in_hand_salary','relevant_in_hand_range','career_gap','documents_availability','communication_skill','follow_up_at',
  'follow_up_status','follow_up_note','interview_reschedule_date','interview_availability','virtual_onsite','status',
  'profile_priority','all_details_sent','submission_date','approval_status','process','call_connected','looking_for_job',
  'notes','reference_details','data_notes','resume_filename','recording_filename','lead_source','hot_lead_status','profile_status',
  'jd_name','jd_notes','employee_code','employee_no','employee_name','employee_file_url','employee_row_no'
];
const PERSISTENCE_VERIFY_FIELDS = new Set([
  'client','location','preferred_location','qualification_level','total_experience','relevant_experience','relevant_experience_range',
  'ctc_monthly','in_hand_salary','relevant_in_hand_range','career_gap','documents_availability','communication_skill',
  'submission_date','interview_date','interview_reschedule_date','process','virtual_onsite','recruiter_code','recruiter_name'
]);
const PROFILE_AUTOSAVE_DELAY_MS = 850;
const CANDIDATE_DRAFT_STORAGE_PREFIX = 'careerCroxCandidateDurableDraft_v6_finaldraft:';

function candidateDraftStorageKey(candidateId) {
  return `${CANDIDATE_DRAFT_STORAGE_PREFIX}${String(candidateId || '').trim()}`;
}

function readCandidateDraftSnapshot(candidateId) {
  try {
    const raw = localStorage.getItem(candidateDraftStorageKey(candidateId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || String(parsed.candidateId || '') !== String(candidateId || '')) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCandidateDraftSnapshot(candidateId, item) {
  const key = String(candidateId || '').trim();
  if (!key || !item) return;
  try {
    localStorage.setItem(candidateDraftStorageKey(key), JSON.stringify({
      candidateId: key,
      editedAt: Date.now(),
      item: sanitizeCandidatePayload(item),
    }));
  } catch {}
}

function clearCandidateDraftSnapshot(candidateId) {
  try { localStorage.removeItem(candidateDraftStorageKey(candidateId)); } catch {}
}

function clearCandidateResetCaches(candidateId) {
  const id = String(candidateId || '').trim();
  if (!id || typeof window === 'undefined') return;
  try { delete GLOBAL_CANDIDATE_PROFILE_CACHE[id]; } catch {}
  const needles = [
    candidateDraftStorageKey(id),
    `/api/candidates/${id}`,
    `/candidate/${id}`,
    `candidate/${id}`,
    'careerCroxSubmissionsCache',
    'careerCroxInterviewsCache',
  ];
  for (const storage of [window.sessionStorage, window.localStorage]) {
    if (!storage) continue;
    try {
      const keys = [];
      for (let i = 0; i < storage.length; i += 1) keys.push(storage.key(i));
      keys.filter(Boolean).forEach((key) => {
        if (needles.some((needle) => String(key || '').includes(needle))) storage.removeItem(key);
      });
    } catch {}
  }
}

function mergeProfileWithoutBlankLoss(primary, fallback) {
  const rawPrimary = sanitizeCandidateItem(primary || {});
  const rawFallback = sanitizeCandidateItem(fallback || {});
  const primarySafe = ensureCandidateDefaults(rawPrimary);
  const fallbackSafe = ensureCandidateDefaults(rawFallback);
  // CC26_751: only fields actually present in the server response may override
  // the already-filled screen snapshot. ensureCandidateDefaults(primary) adds
  // UI defaults for missing keys (Noida/Graduate/Fresher/etc.); spreading that
  // object used to make those defaults overwrite the user's real filled values.
  const merged = ensureCandidateDefaults({ ...fallbackSafe, ...rawPrimary });
  // CC26.211: never let empty/server-default draft fields wipe filled screen values after Save.
  ['status', 'approval_status', 'all_details_sent', 'submission_date'].forEach((key) => {
    const primaryHasRealValue = Object.prototype.hasOwnProperty.call(rawPrimary, key) && String(rawPrimary[key] ?? '').trim();
    const fallbackHasRealValue = Object.prototype.hasOwnProperty.call(rawFallback, key) && String(rawFallback[key] ?? '').trim();
    if (!primaryHasRealValue && fallbackHasRealValue) merged[key] = rawFallback[key];
  });
  for (const key of CRITICAL_SAVE_FIELDS) {
    const primaryOwnsKey = Object.prototype.hasOwnProperty.call(rawPrimary, key);
    const primaryValue = rawPrimary[key];
    const fallbackValue = fallbackSafe[key];
    const primaryBlank = !String(primaryValue ?? '').trim();
    const fallbackFilled = String(fallbackValue ?? '').trim();
    if ((!primaryOwnsKey || primaryBlank) && fallbackFilled) merged[key] = fallbackValue;
  }
  return applyAutoRangesToCandidate(merged);
}

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
  if (amount <= 35000) return '₹31K - ₹35K';
  if (amount <= 50000) return '₹35K - ₹50K';
  return '₹50K+';
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
    try { localStorage.setItem(PREFERRED_LOCATION_STORAGE_KEY, JSON.stringify(cleaned.filter((item) => !PREFERRED_LOCATIONS.includes(item)))); } catch {}
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

function sleepMs(ms = 0) {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, Number(ms || 0))));
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



function candidateSubmittedAtMs(item = {}) {
  const raw = item?.approval_requested_at || item?.submission_date || item?.submitted_at || '';
  const normalized = toDateTimeLocalInput(raw) || String(raw || '').trim();
  if (!normalized) return 0;
  const ts = Date.parse(normalized);
  return Number.isFinite(ts) ? ts : 0;
}

function detailsCompletedLockInfo(item = {}) {
  const submittedAt = candidateSubmittedAtMs(item);
  if (!submittedAt) return { locked: true, remainingMinutes: 15 };
  const elapsedMs = Date.now() - submittedAt;
  const remainingMinutes = Math.max(0, Math.ceil((15 * 60000 - elapsedMs) / 60000));
  return { locked: elapsedMs < 15 * 60000, remainingMinutes };
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
    ['submission_date', 'Submission Date'],
    ['virtual_onsite', 'Interview Mode'],
    ['documents_availability', 'All Documents Availability'],
  ];
  const missingPairs = required.filter(([key]) => !String(item?.[key] || '').trim());
  const lookingForJobBlocked = String(item?.looking_for_job || 'Yes').trim().toLowerCase() !== 'yes';
  const callConnectedIssue = String(item?.call_connected || '').trim().toLowerCase() !== 'yes' && (missingPairs.length || lookingForJobBlocked);
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
  if (callConnectedIssue) issues.push(`Call Connected is still ${String(item?.call_connected || 'blank')}. Complete the connected-call step or finish the pending details before submit.`);
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

function hasRealSubmittedWorkflow(source = {}, approvalValue = '') {
  const explicit = safeText(source.submission_exists ?? source.has_submission ?? '').trim().toLowerCase();
  if (['0', 'false', 'no'].includes(explicit)) return false;
  if (['1', 'true', 'yes'].includes(explicit)) return true;
  const approval = safeText(approvalValue || source.approval_status || '').trim().toLowerCase();
  if (!['pending', 'approved', 'rejected'].includes(approval)) return false;
  return Boolean(safeText(source.submission_id || source.approval_requested_at || source.submitted_at || source.submission_date || '').trim());
}

function stripWorkflowDraftCacheFields(item = {}) {
  const next = { ...(item || {}) };
  // Draft status is a candidate field, not proof that Submission has happened.
  // Only discard stale local status when a real submission workflow is in progress.
  if (['pending', 'approved', 'rejected'].includes(String(next.approval_status || '').toLowerCase())) delete next.status;
  delete next.approval_status;
  delete next.all_details_sent;
  // Keep draft submission_date: user-selected date must survive refresh before actual submit.
  delete next.approval_requested_at;
  delete next.approved_at;
  delete next.approved_by_name;
  delete next.submitted_by;
  delete next.submission_id;
  delete next.submission_exists;
  return next;
}

const CANDIDATE_VISIBLE_TEXT_FIELDS = ['candidate_id','full_name','phone','phone_masked','status','approval_status','all_details_sent','location','preferred_location','qualification','course_name','communication_skill','interview_reschedule_date','submission_date','follow_up_at','follow_up_note','notes','process','client','recruiter_name','recruiter_code','last_viewed_at','interview_remove_status'];
function ensureCandidateDefaults(source) {
  if (!source) return source;
  // CC26_766: every candidate scalar is sanitized before JSX. A legacy/imported
  // object in ANY candidate column must not crash the whole profile after Submit.
  source = sanitizeCandidateItem(source);
  for (const key of CANDIDATE_VISIBLE_TEXT_FIELDS) {
    if (source[key] !== null && source[key] !== undefined && typeof source[key] !== 'string') source[key] = safeText(source[key]);
  }
  const safePhone = source.phone_redacted ? String(source.phone_masked || source.phone || '') : normalizeIndianPhone(source.phone || '');
  const approval = String(source.approval_status || 'Draft').trim().toLowerCase();
  const submittedFlow = hasRealSubmittedWorkflow(source, approval);
  return {
    ...source,
    phone: safePhone,
    phone_masked: source.phone_masked || (source.phone_redacted ? safePhone : normalizeIndianPhone(source.phone || '')),
    call_connected: source.call_connected || '',
    looking_for_job: source.looking_for_job || 'Yes',
    preferred_location: source.preferred_location || 'Noida',
    qualification_level: normalizeQualificationCategory(source.qualification_level || source.degree || '', source.qualification || ''),
    career_gap: source.career_gap || 'Fresher',
    status: source.status || (submittedFlow ? (approval === 'approved' ? 'Approved' : approval === 'rejected' ? 'Rejected' : 'In - Progress') : 'Draft'),
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

function ChoiceField({ label, value, options, onChange, disabled = false, compact = false, invalid = false, showAll = false, disabledOptions = [], strictOptions = false }) {
  const normalizedOptions = strictOptions
    ? [...new Set(safeArray(options).map((item) => safeText(item).trim()).filter(Boolean))]
    : stableOptions(options, value);
  const current = String(value || '').trim();
  const disabledSet = new Set((Array.isArray(disabledOptions) ? disabledOptions : []).map((option) => String(option || '').trim()).filter(Boolean));
  let chipOptions = showAll ? normalizedOptions.slice() : normalizedOptions.slice(0, Math.min(5, normalizedOptions.length));
  if (current && !strictOptions && !chipOptions.includes(current)) {
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
            disabled={disabled || disabledSet.has(String(option || '').trim())}
            className={`choice-chip bounceable ${String(value) === String(option) ? 'active' : ''}`}
            title={disabledSet.has(String(option || '').trim()) ? 'Locked by CRM rule' : undefined}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function MultiChoiceField({ label, value, options, onChange, disabled = false, invalid = false, keepOneSelected = false, onAddNew = null, strictOptions = false }) {
  const selected = splitMulti(value);
  const baseOptions = safeArray(options).map((option) => safeText(option).trim()).filter(Boolean);
  const mergedOptions = strictOptions ? [...new Set(baseOptions)] : [...new Set([...baseOptions, ...selected])];
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
    this.state = { crashed: false, retry: 0 };
    this.retryTimer = null;
  }

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error) {
    try { console.error('Candidate profile render guard:', error); } catch {}
    if (this.state.retry < 3 && !this.retryTimer) {
      const nextRetry = this.state.retry + 1;
      this.retryTimer = window.setTimeout(() => {
        this.retryTimer = null;
        this.setState({ crashed: false, retry: nextRetry });
      }, 60 + (this.state.retry * 120));
    }
  }

  componentDidUpdate(prevProps) {
    if (String(prevProps.candidateId || '') !== String(this.props.candidateId || '') && (this.state.crashed || this.state.retry)) {
      this.setState({ crashed: false, retry: 0 });
    }
  }

  componentWillUnmount() {
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
  }

  render() {
    if (this.state.crashed) {
      return (
        <Layout title={`Candidate • ${this.props.candidateId || ''}`} subtitle="">
          <div className="panel top-gap">
            <div className="panel-title">Profile recovery</div>
            <div className="helper-text top-gap-small">{this.state.message || 'A malformed profile value was isolated safely.'}</div>
            <div className="row-actions top-gap-small">
              <button type="button" className="ghost-btn bounceable" onClick={() => this.setState({ crashed: false, message: '', retry: 0 })}>Retry Profile</button>
            </div>
          </div>
        </Layout>
      );
    }
    // Keep the same CandidateDetailPageInner instance when /candidate/new becomes
    // /candidate/Cxxxx after Submit. Candidate ID changes must not blank/remount the
    // profile; only an actual render-crash retry is allowed to remount the child.
    return React.cloneElement
      ? React.cloneElement(React.Children.only(this.props.children), { key: `profile-retry:${this.state.retry}` })
      : this.props.children;
  }
}


function initialExistingCandidateItem(candidateId) {
  const id = safeText(candidateId || '').trim();
  if (!id) return null;
  // First render must never call navigation helpers that depend on hooks declared
  // later in CandidateDetailPage. Use the already-written instant profile snapshot
  // only; full cache/draft/server hydration continues after the component mounts.
  const instant = readCandidateInstantProfile(id);
  return buildInstantCandidateShell(id, instant || { candidate_id: id });
}

function CandidateDetailPageInner() {
  const { candidateId: routeCandidateId } = useParams();
  const candidateId = routeCandidateId;
  const isNewCandidate = String(candidateId || '').trim().toLowerCase() === 'new';
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  // CC26_752: once a brand-new candidate receives its real Candidate ID, hand
  // the complete visible profile to the REAL React Router route. This restores
  // the proven CC552 route flow while keeping the newer instant-cache protection:
  // the filled profile is written to memory/session cache BEFORE navigation, so
  // the same profile remains visible even if React re-renders/remounts the route.
  function navigateCreatedCandidateInPlace(newId, snapshotItem = null, handoffExtras = {}) {
    const id = safeText(newId || '').trim();
    if (!id) return;
    const visibleItem = ensureCandidateDefaults({ ...(snapshotItem || item || {}), candidate_id: id });
    const handoff = {
      id,
      item: clonePlain(visibleItem),
      notes: clonePlain(handoffExtras.notes ?? notes) || [],
      timeline: clonePlain(handoffExtras.timeline ?? timeline) || [],
      noteBody: handoffExtras.noteBody !== undefined ? String(handoffExtras.noteBody || '') : String(noteBody || ''),
      replyContext: clonePlain(handoffExtras.replyContext !== undefined ? handoffExtras.replyContext : replyContext),
      processOptions: clonePlain(handoffExtras.processOptions ?? processOptions) || [],
      candidateList: clonePlain(handoffExtras.candidateList ?? candidateList) || [],
      candidateFiles: clonePlain(handoffExtras.candidateFiles ?? candidateFiles) || [],
      recruiterOptions: clonePlain(handoffExtras.recruiterOptions ?? recruiterOptions) || [],
      message: safeText(handoffExtras.message || ''),
      statusFlash: safeText(handoffExtras.statusFlash || ''),
      submissionIssues: clonePlain(handoffExtras.submissionIssues ?? submissionIssues) || [],
      noteRequiredError: Boolean(handoffExtras.noteRequiredError),
      at: Date.now(),
    };

    // Persist the complete screen BEFORE changing the route. This is the key
    // safety rule: the target /candidate/Cxxxx route can paint immediately from
    // this snapshot and backend hydration may continue later without blanking it.
    try { window.__CC749_PROFILE_HANDOFF__ = handoff; } catch {}
    setItem(visibleItem);
    resetSnapshotRef.current = clonePlain(visibleItem);
    setNotes(handoff.notes);
    setTimeline(handoff.timeline);
    setReplyContext(handoff.replyContext || null);
    setNoteBody(handoff.noteBody);
    if (handoff.statusFlash) setStatusFlash(handoff.statusFlash);
    setSubmissionIssues(handoff.submissionIssues || []);
    setNoteRequiredError(Boolean(handoff.noteRequiredError));
    setLoading(false);
    setHydratingProfile(false);
    setProfileVerified(true);
    setRouteBusy(false);
    setError('');
    if (handoff.message) setMessage(handoff.message);
    try {
      writeProfileCacheSnapshot(visibleItem, {
        notes: handoff.notes,
        timeline: handoff.timeline,
        process_options: handoff.processOptions,
        nav_items: handoff.candidateList,
        files: handoff.candidateFiles,
        recruiter_options: handoff.recruiterOptions,
      }, id);
    } catch {}
    try { writeCandidateInstantProfile(visibleItem, handoff.candidateList); } catch {}

    // Remove the failed CC750/751 "adopted ID while Router still says /new"
    // mechanism. A Router/URL mismatch was able to retrigger new-profile effects
    // and clear the form. The real route is now authoritative everywhere.
    try { window.__CC750_ADOPTED_CANDIDATE_ID__ = ''; sessionStorage.removeItem('cc750_adopted_candidate_id'); } catch {}
    const params = new URLSearchParams(location.search || '');
    params.delete('fresh');
    const query = params.toString();
    navigate(`/candidate/${encodeURIComponent(id)}${query ? `?${query}` : ''}`, {
      replace: true,
      state: { ...(location.state || {}), cc752ProfileHandoff: true, candidateId: id },
    });
  }
  const formRef = useRef(null);
  const notesPanelRef = useRef(null);
  const cc718NoteWriteRef = useRef(null);
  const openLoggedRef = useRef('');
  const candidateCacheRef = useRef(GLOBAL_CANDIDATE_PROFILE_CACHE);
  const resetSnapshotRef = useRef(null);
  const [item, setItem] = useState(() => isNewCandidate ? ensureCandidateDefaults({ candidate_id: '', approval_status: 'Draft', status: 'Draft', all_details_sent: 'Pending', looking_for_job: 'Yes', preferred_location: 'Noida', qualification_level: 'Graduate', career_gap: 'Fresher', profile_priority: 'Medium', virtual_onsite: 'Walkin', documents_availability: 'Yes', submission_date: nowDateTimeLocal() }) : initialExistingCandidateItem(candidateId));
  const latestItemRef = useRef(item);
  const newCandidateCreateRef = useRef({ promise: null, created: null, autoInFlight: false });
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
  useEffect(() => {
    let cancelled = false;
    // Shared process list is loaded once per profile open (API cache keeps route changes cheap).
    // No polling is used: new options are saved only when the user explicitly adds one.
    api.get('/api/candidates/process-options', { cacheTtlMs: 300000, timeoutMs: 12000, retries: 0 })
      .then((data) => {
        if (cancelled) return;
        const shared = safeArray(data?.items).map((entry) => safeText(entry)).filter(Boolean);
        if (!shared.length) return;
        setProcessOptions((current) => {
          const merged = mergeProcessOptions(current, shared, readStoredProcessOptions());
          persistProcessOptions(merged);
          return merged;
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [recruiterOptions, setRecruiterOptions] = useState([]);
  const selectedRecruiterMeta = useMemo(() => {
    const code = safeText(item?.recruiter_code || '');
    const matched = safeArray(recruiterOptions).find((row) => safeText(row?.recruiter_code || row?.user_code || row?.username || '') === code);
    const itemName = safeText(item?.recruiter_name || '');
    const currentCode = safeText(user?.recruiter_code || user?.user_code || user?.employee_code || user?.username || '');
    const currentName = safeText(user?.full_name || user?.name || user?.display_name || user?.employee_name || user?.username || '');
    const name = safeText(matched?.full_name || matched?.name || matched?.display_name || matched?.employee_name || (code === currentCode ? currentName : '') || (itemName && itemName !== code ? itemName : '') || code);
    const emp = safeText(matched?.recruiter_code || matched?.user_code || matched?.employee_code || matched?.username || code);
    return name ? `${name}${emp && emp !== name ? ` • ${emp}` : ''}` : code;
  }, [item?.recruiter_code, item?.recruiter_name, recruiterOptions, user]);
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
  const [noteRequiredError, setNoteRequiredError] = useState(false);
  const [syncState, setSyncState] = useState('idle');
  const [actionBusy, setActionBusy] = useState('');
  const [approvalDecisionBusy, setApprovalDecisionBusy] = useState('');
  const [detailRejectOpen, setDetailRejectOpen] = useState(false);
  const [detailRejectReason, setDetailRejectReason] = useState('');
  const actionLockRef = useRef('');
  const backgroundProfileSaveRef = useRef({ inFlight: false, queued: null, seq: 0 });
  const autoSaveTimerRef = useRef(null);
  const [routeBusy, setRouteBusy] = useState(false);
  const [hydratingProfile, setHydratingProfile] = useState(false);
  const [profileVerified, setProfileVerified] = useState(false);
  const [fetchingNavPage, setFetchingNavPage] = useState(false);
  const [navEndReached, setNavEndReached] = useState(false);
  const pendingOpenFirstNavRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const localEditGuardRef = useRef({ candidateId: '', editedAt: 0 });
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
  const navRowKey = useMemo(() => new URLSearchParams(location.search || '').get('nav_row') || '', [location.search]);
  const preservedNavContext = useMemo(() => readCandidateNavContext(navKey), [navKey]);
  const [navPageMeta, setNavPageMeta] = useState(() => ({
    source_api: preservedNavContext?.source_api || '',
    source_kind: preservedNavContext?.source_kind || '',
    page: Number(preservedNavContext?.page || 1) || 1,
    page_size: Number(preservedNavContext?.page_size || 10) || 10,
    total: Number(preservedNavContext?.total || 0) || 0,
    has_more: Boolean(preservedNavContext?.has_more),
  }));
  const dialerProfileLockMode = typeof window !== 'undefined' ? new URLSearchParams(window.location.search || '').get('dialer_lock') === '1' || new URLSearchParams(window.location.search || '').get('no_auto_refresh') === '1' : false;

  useEffect(() => {
    latestItemRef.current = item;
  }, [item]);


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
  const currentCandidateIndex = useMemo(() => {
    const list = safeArray(candidateList);
    if (navRowKey) {
      const rowIndex = list.findIndex((row, index) => String(row?._nav_row_key || navRowIdentity(row, index)) === String(navRowKey));
      if (rowIndex >= 0) return rowIndex;
    }
    return list.findIndex((row) => String(row?.candidate_id || '') === String(candidateId || ''));
  }, [candidateList, candidateId, navRowKey]);
  const prevCandidate = useMemo(() => currentCandidateIndex > 0 ? candidateList[currentCandidateIndex - 1] : null, [candidateList, currentCandidateIndex]);
  const nextCandidate = useMemo(() => currentCandidateIndex >= 0 && currentCandidateIndex < candidateList.length - 1 ? candidateList[currentCandidateIndex + 1] : null, [candidateList, currentCandidateIndex]);
  // Only approved candidate statuses appear in the dropdown. A legacy status
  // remains visible as an informational label, never as an extra selectable item.
  const currentApprovedStatus = approvedStatusValue(item?.status);
  const displayStatusOptions = STATUS_OPTIONS;
  const draftStatusOptions = STATUS_OPTIONS;
  const canEditDataNotes = ['manager'].includes(String(user?.role || '').trim().toLowerCase()) || String(user?.designation || '').trim().toLowerCase() === 'manager';
  const canManagerReassignRecruiter = ['admin', 'manager'].includes(String(user?.role || '').trim().toLowerCase());
  const phoneIsMaskedForRecruiter = false;

  useEffect(() => {
    setNavPageMeta({
      source_api: preservedNavContext?.source_api || '',
      source_kind: preservedNavContext?.source_kind || '',
      page: Number(preservedNavContext?.page || 1) || 1,
      page_size: Number(preservedNavContext?.page_size || 10) || 10,
      total: Number(preservedNavContext?.total || 0) || 0,
      has_more: Boolean(preservedNavContext?.has_more),
    });
    setNavEndReached(false);
    pendingOpenFirstNavRef.current = false;
  }, [navKey, preservedNavContext?.source_api, preservedNavContext?.page, preservedNavContext?.page_size, preservedNavContext?.total, preservedNavContext?.has_more]);

  const hasMoreNavAfter = useMemo(() => {
    const total = Number(navPageMeta?.total || preservedNavContext?.total || 0) || 0;
    const loaded = safeArray(candidateList).length;
    if (Boolean(navPageMeta?.has_more || preservedNavContext?.has_more)) return true;
    return total > 0 && loaded > 0 && loaded < total;
  }, [navPageMeta?.has_more, navPageMeta?.total, preservedNavContext?.has_more, preservedNavContext?.total, candidateList]);

  const canProbeNextNavPage = useMemo(() => {
    if (navEndReached) return false;
    return sourceCanFetchAnotherPage();
  }, [
    navEndReached,
    navPageMeta?.source_api,
    navPageMeta?.source_kind,
    navPageMeta?.page,
    navPageMeta?.page_size,
    navPageMeta?.total,
    navPageMeta?.has_more,
    preservedNavContext?.source_api,
    preservedNavContext?.source_kind,
    preservedNavContext?.total,
    preservedNavContext?.has_more,
    candidateList.length,
    navKey,
  ]);

  function latestNavContext() {
    return readCandidateNavContext(navKey) || preservedNavContext || null;
  }

  function mergeCandidateNavRows(...sources) {
    const seen = new Set();
    const merged = [];
    for (const source of sources) {
      const rows = Array.isArray(source) ? source : (source?.nav_items || []);
      for (const row of safeArray(rows)) {
        const clean = sanitizeNavRow(row, merged.length);
        const id = String(clean?.candidate_id || '').trim();
        if (!id) continue;
        const key = id.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(clean);
        if (merged.length >= PROFILE_NAV_LIMIT) return merged;
      }
    }
    return merged;
  }

  function mergedCandidateListFrom(...sources) {
    const latest = latestNavContext();
    return mergeCandidateNavRows(candidateList, latest?.nav_items || [], ...sources);
  }

  function activeNavSourceKind() {
    return String(navPageMeta?.source_kind || latestNavContext()?.source_kind || preservedNavContext?.source_kind || '').trim().toLowerCase();
  }

  function sourceApiPath(value = '') {
    return String(value || '').split('?')[0].trim().toLowerCase();
  }

  function sourceApiMatchesKind(sourceApi = '', sourceKind = activeNavSourceKind()) {
    const path = sourceApiPath(sourceApi);
    const kind = String(sourceKind || '').trim().toLowerCase();
    if (!path || !path.startsWith('/api/')) return false;
    if (kind === 'candidates' || kind === 'bucket-out') return path === '/api/candidates';
    if (kind === 'hot-leads') return path === '/api/hot-leads';
    return false;
  }

  function sourceCanFetchAnotherPage() {
    const latest = latestNavContext();
    const sourceApi = String(navPageMeta?.source_api || latest?.source_api || preservedNavContext?.source_api || '').trim();
    if (!sourceApiMatchesKind(sourceApi)) return false;
    const loaded = safeArray(candidateList).length || safeArray(latest?.nav_items).length || 0;
    const total = Number(navPageMeta?.total || latest?.total || preservedNavContext?.total || 0) || 0;
    const hasMore = Boolean(navPageMeta?.has_more || latest?.has_more || preservedNavContext?.has_more);
    if (hasMore) return true;
    return total > 0 && loaded > 0 && loaded < total;
  }

  function sourceBoundNavItemsFromPayload(payloadNavItems = []) {
    const latest = latestNavContext();
    const storedItems = safeArray(latest?.nav_items || preservedNavContext?.nav_items).filter((row) => row?.candidate_id);
    if (navKey && storedItems.length) return mergeCandidateNavRows(candidateList, storedItems);
    return mergeCandidateNavRows(candidateList, payloadNavItems);
  }

  function instantProfileFromNavigation(targetId = candidateId) {
    const id = safeText(targetId || '').trim();
    if (!id) return null;
    const latest = latestNavContext();
    const navItems = safeArray(latest?.nav_items).map((row, index) => sanitizeNavRow(row, index));
    const navRow = (navRowKey ? navItems.find((row) => String(row._nav_row_key || '') === String(navRowKey)) : null) || navItems.find((row) => String(row.candidate_id) === id);
    const instantRow = readCandidateInstantProfile(id);
    return buildInstantCandidateShell(id, instantRow || navRow || { candidate_id: id });
  }

  function showInstantProfileShell(targetId = candidateId, source = null) {
    const shell = buildInstantCandidateShell(targetId, source || instantProfileFromNavigation(targetId));
    if (!shell) return false;
    setItem(shell);
    setNotes([]);
    setTimeline([]);
    setCandidateFiles([]);
    setFilesLoaded(false);
    setLoading(false);
    setError('');
    setHydratingProfile(true);
    setRouteBusy(false);
    setProfileVerified(false);
    try { writeCandidateInstantProfile(shell, candidateList); } catch {}
    return true;
  }

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
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    localEditGuardRef.current = { candidateId: String(candidateId || ''), editedAt: 0 };
    try {
      const lock = JSON.parse(localStorage.getItem('career_crox_candidate_edit_lock') || '{}');
      if (String(lock?.candidateId || '') !== String(candidateId || '')) localStorage.removeItem('career_crox_candidate_edit_lock');
    } catch {}
    const handoff = window.__CC749_PROFILE_HANDOFF__ || null;
    const inPlaceHandoff = !isNewCandidate && safeText(handoff?.id || '') === safeText(candidateId || '');
    if (!inPlaceHandoff) {
      setReplyContext(null);
      setNoteBody('');
      setShowHistory(false);
    }
    return () => {
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
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

  function hasLocalEditsAfter(requestStamp) {
    const guard = localEditGuardRef.current || {};
    return String(guard.candidateId || '') === String(candidateId || '') && Number(guard.editedAt || 0) > Number(requestStamp || 0);
  }

  function buildResetSnapshot(source) {
    const base = ensureCandidateDefaults(clonePlain(source) || {});
    return {
      ...base,
      call_connected: '',
      looking_for_job: 'Yes',
      preferred_location: base.preferred_location || '',
      qualification_level: base.qualification_level || '',
      full_name: base.full_name || '',
      phone: base.phone || '',
      client: base.client || '',
      location: base.location || '',
      qualification: base.qualification || '',
      recruiter_code: base.recruiter_code || '',
      recruiter_name: base.recruiter_name || '',
      recruiter_designation: base.recruiter_designation || '',
      data_uploading_date: base.data_uploading_date || '',
      data_notes: base.data_notes || '',
      source_sr_no: base.source_sr_no || '',
      status: 'Draft',
      approval_status: 'Draft',
      approval_requested_at: '',
      approved_at: '',
      approved_by_name: '',
      submitted_by: '',
      submission_id: '',
      submission_exists: '0',
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
      interview_date: '',
      submission_date: '',
      interview_remove_request_id: '',
      interview_remove_status: '',
      interview_remove_reason: '',
      interview_remove_approved_at: '',
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
    if (!window.confirm('Reset filled details, notes, and submitted/approval state for this candidate?')) return;
    clearCandidateResetCaches(candidateId);
    const snapshot = buildResetSnapshot(resetSnapshotRef.current || item);
    const emptyNotes = [];
    const emptyTimeline = [];
    setInvalidFields([]);
    if (!beginAction('reset')) return;
    markSync('saving', 'Resetting profile, notes and submitted state...');
    try {
      let data = null;
      try {
        data = await api.post(`/api/candidates/${candidateId}/reset-filled-details`, { _client_updated_at: safeText(resetSnapshotRef.current?.updated_at || item?.updated_at || '') }, { timeoutMs: 45000, retries: 1 });
      } catch (resetApiError) {
        const resetPayload = {
          ...sanitizeCandidatePayload(snapshot),
          _client_updated_at: safeText(resetSnapshotRef.current?.updated_at || item?.updated_at || ''),
          _changed_fields: Object.keys(sanitizeCandidatePayload(snapshot)).filter((key) => !['candidate_id', 'created_at', 'updated_at', '_crm_row_id', 'last_viewed_at', 'last_viewed_by_name'].includes(key)),
          _client_base_values: {},
        };
        data = await api.put(`/api/candidates/${candidateId}`, resetPayload);
      }
      const nextItem = ensureCandidateDefaults({ ...snapshot, ...(data?.item || {}) });
      nextItem.approval_status = 'Draft';
      nextItem.status = 'Draft';
      nextItem.all_details_sent = 'Pending';
      nextItem.approval_requested_at = '';
      nextItem.approved_at = '';
      nextItem.approved_by_name = '';
      nextItem.submitted_by = '';
      nextItem.submission_id = '';
      nextItem.submission_exists = '0';
      nextItem.has_submission = '0';
      nextItem.submission_date = '';
      nextItem.interview_date = '';
      nextItem.interview_reschedule_date = '';
      nextItem.interview_remove_request_id = '';
      nextItem.interview_remove_status = '';
      nextItem.interview_remove_reason = '';
      nextItem.interview_remove_approved_at = '';
      nextItem.notes = '';
      setItem(nextItem);
      setNotes(emptyNotes);
      setTimeline(emptyTimeline);
      setReplyContext(null);
      setNoteBody('');
      resetSnapshotRef.current = clonePlain(nextItem);
      clearCandidateDraftSnapshot(candidateId);
      candidateCacheRef.current[candidateId] = {
        item: nextItem,
        notes: emptyNotes,
        timeline: emptyTimeline,
        process_options: processOptions,
        nav_items: candidateList,
        files: candidateFiles,
        recruiter_options: recruiterOptions || [],
      };
      rememberCandidateProfileCache(candidateId, candidateCacheRef.current[candidateId]);
      emitCandidateUpsert(nextItem, { source: 'candidate_profile_reset', instant: true });
      clearCandidateResetCaches(candidateId);
      markSync('saved', 'Reset done. Notes and submitted state cleared. Add fresh details before submit.');
    } catch (err) {
      markSync('error', err.message || 'Reset failed.');
    } finally {
      endAction();
    }
  }

  function applyCandidatePayload(rawData, options = {}) {
    const safeData = sanitizeProfilePayload(rawData, item);
    const preserveSecondary = Boolean(options.preserveSecondary);
    const localDraft = readCandidateDraftSnapshot(candidateId);
    let nextItem = applyAutoRangesToCandidate(safeData.item || ensureCandidateDefaults(sanitizeCandidateItem(item || {})));
    if (localDraft?.item) {
      nextItem = mergeProfileWithoutBlankLoss(nextItem, stripWorkflowDraftCacheFields(localDraft.item));
    }
    if (nextItem && hasRealSubmittedWorkflow(nextItem, nextItem.approval_status) && String(nextItem.approval_status || '').toLowerCase() === 'pending') {
      nextItem.status = 'In - Progress';
      nextItem.all_details_sent = 'Pending';
    } else if (nextItem && !hasRealSubmittedWorkflow(nextItem, nextItem.approval_status)) {
      nextItem.approval_status = 'Draft';
      nextItem.status = nextItem.status || 'Draft';
      nextItem.all_details_sent = 'Pending';
      // Do not blank submission_date for an unsent draft. It is a user-editable field
      // and must remain available after refresh so Submit uses the chosen date/time.
      nextItem.submission_id = '';
      nextItem.submission_exists = '0';
      nextItem.approval_requested_at = '';
      nextItem.approved_at = '';
      nextItem.approved_by_name = '';
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
    const mergedNavItems = sourceBoundNavItemsFromPayload(payload.nav_items);
    if (mergedNavItems.length) payload.nav_items = mergedNavItems;
    candidateCacheRef.current[candidateId] = payload;
    rememberCandidateProfileCache(candidateId, payload);
    resetSnapshotRef.current = clonePlain(payload.item);
    setItem(payload.item);
    setNotes(payload.notes);
    setTimeline(payload.timeline);
    setProcessOptions([...new Set([...(payload.process_options || []), ...readStoredProcessOptions()])]);
    setRecruiterOptions(payload.recruiter_options || []);
    setCandidateList(payload.nav_items);
    if (!rawData?.files_deferred) { setCandidateFiles(payload.files || []); setFilesLoaded(Boolean((payload.files || []).length)); }
    return payload;
  }

  async function load() {
    const requestId = Date.now() + Math.random();
    loadSequenceRef.current = requestId;
    const isCurrentRequest = () => loadSequenceRef.current === requestId;
    const cached = sanitizeCachedProfilePayload(candidateCacheRef.current[candidateId], item);
    const instantFallback = instantProfileFromNavigation(candidateId);
    const durableDraft = readCandidateDraftSnapshot(candidateId);
    const durableDraftItem = durableDraft?.item ? ensureCandidateDefaults(sanitizeCandidateItem(durableDraft.item)) : null;
    setError('');
    setProfileVerified(false);

    if (cached?.item) {
      const visibleCachedItem = durableDraftItem
        ? mergeProfileWithoutBlankLoss(cached.item, stripWorkflowDraftCacheFields(durableDraftItem))
        : cached.item;
      resetSnapshotRef.current = clonePlain(cached.item);
      setItem(visibleCachedItem);
      setNotes(cached.notes || []);
      setTimeline(cached.timeline || []);
      setProcessOptions([...new Set([...(cached.process_options || []), ...readStoredProcessOptions()])]);
      setRecruiterOptions(cached.recruiter_options || []);
      {
        const mergedNavItems = sourceBoundNavItemsFromPayload(cached.nav_items || []);
        setCandidateList(mergedNavItems.length ? mergedNavItems : (cached.nav_items || []));
      }
      setCandidateFiles([]);
      setFilesLoaded(false);
      setLoading(false);
      setHydratingProfile(true);
      setMessage('Profile opened from a local snapshot. Notes sync in the background; files open on demand.');
    } else if (instantFallback) {
      const visibleInstantItem = durableDraftItem
        ? mergeProfileWithoutBlankLoss(instantFallback, stripWorkflowDraftCacheFields(durableDraftItem))
        : instantFallback;
      resetSnapshotRef.current = clonePlain(instantFallback);
      setItem(visibleInstantItem);
      setNotes([]);
      setTimeline([]);
      {
        const mergedNavItems = sourceBoundNavItemsFromPayload([]);
        setCandidateList(mergedNavItems.length ? mergedNavItems : candidateList);
      }
      setCandidateFiles([]);
      setFilesLoaded(false);
      setLoading(false);
      setHydratingProfile(true);
      setMessage('Profile opened instantly. Latest details are syncing in background.');
    } else if (durableDraftItem) {
      showInstantProfileShell(candidateId, durableDraftItem);
      setMessage('Unsaved filled details restored from this browser. Backend verification is running.');
    } else {
      showInstantProfileShell(candidateId, { candidate_id: candidateId });
    }

    let hasCoreProfile = Boolean(cached?.item || instantFallback || durableDraftItem);

    // CC26_694: when navigation/cache already supplied the visible core profile, do not
    // download the same candidate twice. The single full detail request below verifies
    // the backend and hydrates notes/timeline. Direct URLs with no local core still use
    // the lightweight prefetch first so the profile can become visible as soon as possible.
    if (!hasCoreProfile) {
      try {
        const coreData = await api.get(`/api/candidates/${candidateId}?prefetch=1`, { cacheTtlMs: 60000, allowStale: true, timeoutMs: 10000, retries: 1 });
        if (!isCurrentRequest()) return;
        if (hasLocalEditsAfter(requestId)) {
          hasCoreProfile = Boolean(coreData?.item) || hasCoreProfile;
          setProfileVerified(Boolean(coreData?.item));
          setLoading(false);
          setHydratingProfile(false);
          setRouteBusy(false);
          setMessage('Live refresh paused while you have unsaved edits. Save first to protect every field.');
          return;
        }
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
        showInstantProfileShell(candidateId, { candidate_id: candidateId });
        markSync('error', 'Backend refresh failed. Profile shell is open; click Retry to verify latest data.');
        return;
      }
    }

    if (dialerProfileLockMode) {
      setHydratingProfile(false);
      setRouteBusy(false);
      return;
    }

    window.setTimeout(() => {
      if (!isCurrentRequest()) return;
      api.get(`/api/candidates/${candidateId}?no_files=1`, { cacheTtlMs: 0, timeoutMs: 16000, retries: 1, background: true })
        .then((data) => {
          if (!isCurrentRequest()) return;
          if (hasLocalEditsAfter(requestId)) {
            setMessage('Live refresh paused while you have unsaved edits. Save first to protect every field.');
            return;
          }
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
    }, 80);
  }

  useEffect(() => {
    const handoff = window.__CC749_PROFILE_HANDOFF__ || null;
    const inPlaceHandoff = !isNewCandidate
      && safeText(handoff?.id || '').trim() === safeText(candidateId || '').trim();
    if (inPlaceHandoff) {
      // Restore from the durable handoff itself. Do not inspect `item` here:
      // React may commit the Router update before the previous setItem call.
      const restoredItem = ensureCandidateDefaults({ ...(handoff?.item || {}), candidate_id: candidateId });
      const restoredNotes = Array.isArray(handoff?.notes) ? handoff.notes : [];
      const restoredTimeline = Array.isArray(handoff?.timeline) ? handoff.timeline : [];
      const restoredProcesses = Array.isArray(handoff?.processOptions) ? handoff.processOptions : processOptions;
      const restoredNav = Array.isArray(handoff?.candidateList) ? handoff.candidateList : candidateList;
      const restoredFiles = Array.isArray(handoff?.candidateFiles) ? handoff.candidateFiles : candidateFiles;
      const restoredRecruiters = Array.isArray(handoff?.recruiterOptions) ? handoff.recruiterOptions : recruiterOptions;
      setItem(restoredItem);
      resetSnapshotRef.current = clonePlain(restoredItem);
      setNotes(restoredNotes);
      setTimeline(restoredTimeline);
      setProcessOptions(restoredProcesses);
      setCandidateList(restoredNav);
      setCandidateFiles(restoredFiles);
      setRecruiterOptions(restoredRecruiters);
      setFilesLoaded(restoredFiles.length > 0);
      setReplyContext(handoff?.replyContext || null);
      setNoteBody(String(handoff?.noteBody || ''));
      if (handoff?.statusFlash) setStatusFlash(handoff.statusFlash);
      setSubmissionIssues(Array.isArray(handoff?.submissionIssues) ? handoff.submissionIssues : []);
      setNoteRequiredError(Boolean(handoff?.noteRequiredError));
      const cachedPayload = {
        item: restoredItem,
        notes: restoredNotes,
        timeline: restoredTimeline,
        process_options: restoredProcesses,
        nav_items: restoredNav,
        files: restoredFiles,
        recruiter_options: restoredRecruiters,
      };
      candidateCacheRef.current[candidateId] = cachedPayload;
      try { rememberCandidateProfileCache(candidateId, cachedPayload); } catch {}
      try { writeCandidateInstantProfile(restoredItem, restoredNav); } catch {}
      try { window.__CC749_PROFILE_HANDOFF__ = null; } catch {}
      try { window.__CC748_PROFILE_HANDOFF_ID__ = ''; } catch {}
      setLoading(false);
      setHydratingProfile(false);
      setProfileVerified(true);
      setRouteBusy(false);
      setError('');
      setMessage(handoff?.message || 'Profile saved. It stays open on the same screen.');
      loadSequenceRef.current = Date.now() + Math.random();
      return () => { loadSequenceRef.current = Date.now() + Math.random(); };
    }
    if (isNewCandidate) {
      // Fresh /candidate/new route. The real saved route is adopted through
      // React Router only after the create endpoint returns a real Candidate ID.
      const durableNewDraft = readCandidateDraftSnapshot('new')?.item || {};
      const draft = ensureCandidateDefaults({
        candidate_id: '', approval_status: 'Draft', status: 'Draft', all_details_sent: 'Pending', looking_for_job: 'Yes',
        preferred_location: 'Noida', qualification_level: 'Graduate', career_gap: 'Fresher', profile_priority: 'Medium',
        virtual_onsite: 'Walkin', documents_availability: 'Yes', submission_date: nowDateTimeLocal(),
        recruiter_code: user?.recruiter_code || '', recruiter_name: user?.full_name || user?.username || '',
        recruiter_designation: user?.designation || '',
        ...durableNewDraft,
      });
      if (String(draft.status || '').toLowerCase() === 'draft' && Object.keys(durableNewDraft).length) draft.status = 'In - Progress';
      latestItemRef.current = draft;
      setItem((current) => ensureCandidateDefaults({ ...draft, ...(current || {}), ...durableNewDraft, candidate_id: '' }));
      setNotes([]); setTimeline([]); setCandidateFiles([]); setCandidateList([]); setFilesLoaded(false);
      setLoading(false); setHydratingProfile(false); setProfileVerified(true); setRouteBusy(false); setError('');
      setMessage('New candidate profile. Fill details and Save or Submit.');
      // One small preview fetch; the server assigns the final ID during Save.
      let previewActive = true;
      api.get('/api/candidates/next-id', { cacheTtlMs: 0, timeoutMs: 8000 })
        .then((response) => { if (previewActive && response?.candidate_id) setItem((row) => ({ ...row, candidate_id: response.candidate_id })); })
        .catch(() => {});
      api.get('/api/ui/lookups?scope=profile', { cacheTtlMs: 120000, allowStale: true, timeoutMs: 10000, retries: 1, background: true })
        .then((data) => {
          const safe = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
          if (Array.isArray(safe.process_options) && safe.process_options.length) setProcessOptions(mergeProcessOptions(safe.process_options));
          if (Array.isArray(safe.users)) setRecruiterOptions(safe.users);
          if (Array.isArray(safe.location_options) && safe.location_options.length) setPreferredLocations((current) => [...new Set([...(current || []), ...safe.location_options.map((value) => String(value || '').trim()).filter(Boolean)])]);
        }).catch(() => {});
      return () => { previewActive = false; };
    }
    showInstantProfileShell(candidateId, instantProfileFromNavigation(candidateId) || { candidate_id: candidateId });
    setError('');
    setReplyContext(null);
    setNoteBody('');
    setShowHistory(false);
    load().catch((err) => {
      showInstantProfileShell(candidateId, { candidate_id: candidateId });
      markSync('error', err?.message || 'Backend refresh failed. Profile shell stayed open.');
    });
    return () => {
      loadSequenceRef.current = Date.now() + Math.random();
    };
  // CC26_752: the route itself is the source of truth. A successful create moves
  // from /candidate/new to /candidate/Cxxxx, while the pre-written handoff keeps
  // the profile visible during that transition.
  }, [routeCandidateId]);
  // CC16 profile load fail-safe timer: never leave the profile screen on endless loading.
  useEffect(() => {
    if (isNewCandidate || !loading || item) return undefined;
    const timer = window.setTimeout(() => {
      showInstantProfileShell(candidateId, { candidate_id: candidateId });
      markSync('error', 'Backend is slow. Profile shell stayed open; click Retry to verify latest data.');
    }, 12000);
    return () => window.clearTimeout(timer);
  }, [candidateId, loading, item]);

  useEffect(() => {
    if (isNewCandidate || openLoggedRef.current === candidateId) return;
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

  // CC26_78: removed the old 3-previous + 3-next adjacent profile preload.
  // Auto Dialer now controls only the current profile plus one next profile slot.
  // Normal profile pages do not fire hidden neighbouring profile requests anymore.

  async function prefetchCandidate(targetId) {
    if (!targetId || candidateCacheRef.current[targetId]) return;
    try {
      const data = await api.get(`/api/candidates/${targetId}?prefetch=1`, { cacheTtlMs: 120000, allowStale: true, timeoutMs: 10000, background: true });
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

  function buildNextNavApiPath(targetPage) {
    const latest = latestNavContext();
    const sourceApi = String(navPageMeta?.source_api || latest?.source_api || preservedNavContext?.source_api || '').trim();
    if (!sourceApiMatchesKind(sourceApi)) return '';
    if (!sourceCanFetchAnotherPage()) return '';
    const [path, queryText = ''] = sourceApi.split('?');
    const params = new URLSearchParams(queryText);
    params.set('page', String(Math.max(1, Number(targetPage || 1) || 1)));
    if (!params.get('page_size')) params.set('page_size', String(Number(navPageMeta?.page_size || latest?.page_size || preservedNavContext?.page_size || 10) || 10));
    return `${path}?${params.toString()}`;
  }

  function rowsFromNavPagePayload(data) {
    const kind = activeNavSourceKind();
    let source = [];
    if (kind === 'hot-leads') source = Array.isArray(data?.items) ? data.items : Array.isArray(data?.rows) ? data.rows : [];
    else if (kind === 'candidates' || kind === 'bucket-out') source = Array.isArray(data?.items) ? data.items : Array.isArray(data?.candidates) ? data.candidates : Array.isArray(data?.rows) ? data.rows : [];
    else source = [];
    return source.map((row, index) => sanitizeNavRow(row, index)).filter((row) => row.candidate_id);
  }

  async function loadNextNavPage({ openFirst = false, quiet = false } = {}) {
    if (fetchingNavPage) {
      if (openFirst) pendingOpenFirstNavRef.current = true;
      return null;
    }
    if (navEndReached) return null;
    const latest = latestNavContext();
    const currentPage = Number(navPageMeta?.page || latest?.page || preservedNavContext?.page || 1) || 1;
    const targetPage = currentPage + 1;
    const apiPath = buildNextNavApiPath(targetPage);
    if (!apiPath) {
      setNavEndReached(true);
      if (!quiet) setMessage('No further profile page is linked with this list.');
      return null;
    }
    setFetchingNavPage(true);
    try {
      const data = await api.get(apiPath, { cacheTtlMs: 60000, allowStale: true, timeoutMs: 18000, retries: 1, background: !openFirst });
      const existing = sourceBoundNavItemsFromPayload([]);
      const seen = new Set(existing.map((row) => String(row.candidate_id).toLowerCase()));
      const incoming = rowsFromNavPagePayload(data).filter((row) => {
        const id = String(row.candidate_id || '').toLowerCase();
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      const pageSize = Number(data?.page_size || navPageMeta?.page_size || latestNavContext()?.page_size || preservedNavContext?.page_size || 10) || 10;
      const pageNo = Number(data?.page || targetPage) || targetPage;
      const total = Number(data?.total || navPageMeta?.total || latestNavContext()?.total || preservedNavContext?.total || 0) || 0;
      const hasMore = data?.has_more !== undefined ? Boolean(data.has_more) : (total ? pageNo * pageSize < total : incoming.length >= pageSize);
      const nextMeta = {
        source_api: buildNextNavApiPath(pageNo),
        source_kind: navPageMeta?.source_kind || latestNavContext()?.source_kind || preservedNavContext?.source_kind || '',
        page: pageNo,
        page_size: pageSize,
        total,
        has_more: hasMore,
      };
      setNavPageMeta(nextMeta);
      if (!incoming.length) {
        appendCandidateNavContext(navKey, [], nextMeta);
        if (!hasMore) setNavEndReached(true);
        if (!quiet) setMessage(hasMore ? 'Next profile page loaded but no new candidate row was found.' : 'This list reached the last profile.');
        pendingOpenFirstNavRef.current = false;
        return null;
      }
      const merged = mergeCandidateNavRows(existing, incoming);
      setCandidateList(merged);
      for (const row of incoming) writeCandidateInstantProfile(row, merged);
      appendCandidateNavContext(navKey, incoming, nextMeta);
      setNavEndReached(!hasMore && Boolean(total) && merged.length >= total);
      const shouldOpenFirst = openFirst || pendingOpenFirstNavRef.current;
      pendingOpenFirstNavRef.current = false;
      if (shouldOpenFirst) {
        const first = incoming[0];
        showInstantProfileShell(first.candidate_id, first);
        navigate(buildCandidateUrl(first.candidate_id, navKey, first._nav_row_key || ''));
      } else if (!quiet) {
        setMessage(`${incoming.length} more profiles loaded for Next navigation.`);
      }
      return incoming;
    } catch (error) {
      pendingOpenFirstNavRef.current = false;
      if (!quiet) setMessage(error?.message || 'Could not load the next profile page.');
      return null;
    } finally {
      setFetchingNavPage(false);
    }
  }

  function openCandidate(targetId, targetRow = null) {
    if (!targetId) return;
    const targetNavRowKey = safeText(targetRow?._nav_row_key || targetRow?.nav_row_key || '');
    const cached = sanitizeCachedProfilePayload(candidateCacheRef.current[targetId], item);
    const navRow = targetRow
      || (targetNavRowKey ? safeArray(candidateList).find((row) => String(row?._nav_row_key || '') === String(targetNavRowKey)) : null)
      || safeArray(candidateList).find((row) => String(row?.candidate_id || '') === String(targetId || ''))
      || instantProfileFromNavigation(targetId);
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
      setHydratingProfile(true);
      setProfileVerified(false);
      setError('');
      try { writeCandidateInstantProfile(cached.item, candidateList); } catch {}
    } else {
      showInstantProfileShell(targetId, navRow || { candidate_id: targetId });
    }
    navigate(buildCandidateUrl(targetId, navKey, navRow?._nav_row_key || targetNavRowKey || ''));
  }

  function openNextCandidate() {
    if (nextCandidate?.candidate_id) {
      openCandidate(nextCandidate.candidate_id, nextCandidate);
      return;
    }
    if (hasMoreNavAfter || canProbeNextNavPage) loadNextNavPage({ openFirst: true });
  }

  // CC26_694: no hidden adjacent-profile or next-page network reads. The compact
  // navigation rows already make Prev/Next instant. If Next reaches an unloaded page,
  // openNextCandidate() performs exactly one user-triggered request at that moment.

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

  function scheduleProfileAutoSave(snapshot, targetCandidateId = candidateId) {
    if (!snapshot || !targetCandidateId || editingLocked || actionLockRef.current) return;
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    const safeSnapshot = ensureCandidateDefaults(sanitizeCandidatePayload(snapshot));
    const queuedCandidateId = String(targetCandidateId || '');
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      if (String(candidateId || '') !== queuedCandidateId || editingLocked || actionLockRef.current) return;
      const changedMeta = buildChangedFieldSavePayload(safeSnapshot);
      if (!changedMeta._changed_fields.length) return;
      const savePayload = {
        ...sanitizeCandidatePayload(safeSnapshot),
        _client_updated_at: changedMeta._client_updated_at,
        _changed_fields: changedMeta._changed_fields,
        _client_base_values: changedMeta._client_base_values,
      };
      writeCandidateDraftSnapshot(queuedCandidateId, safeSnapshot);
      writeProfileCacheSnapshot(safeSnapshot);
      queueBackgroundProfileSave({
        payload: savePayload,
        beforeItem: resetSnapshotRef.current || {},
        beforeStatus: resetSnapshotRef.current?.status || '',
        optimisticItem: safeSnapshot,
        silent: true,
      });
    }, PROFILE_AUTOSAVE_DELAY_MS);
  }

  function patch(next) {
    const nextPatch = { ...(next || {}) };
    const detailTouched = Object.keys(nextPatch).some((key) => !DETAIL_AUTO_CONNECT_IGNORE_FIELDS.has(key));
    if (detailTouched && String(item?.call_connected || '').trim().toLowerCase() !== 'yes') {
      nextPatch.call_connected = 'Yes';
    }
    localEditGuardRef.current = { candidateId: String(candidateId || ''), editedAt: Date.now() };
    try { localStorage.setItem('career_crox_candidate_edit_lock', JSON.stringify(localEditGuardRef.current)); } catch {}
    if (Object.prototype.hasOwnProperty.call(nextPatch, 'ctc_monthly') || Object.prototype.hasOwnProperty.call(nextPatch, 'in_hand_salary')) {
      const nextCtc = String(nextPatch.ctc_monthly ?? item?.ctc_monthly ?? '');
      const nextInHand = String(nextPatch.in_hand_salary ?? item?.in_hand_salary ?? '');
      if (isDigitsOnlyValue(nextCtc) && isDigitsOnlyValue(nextInHand)) setSalaryInputError('');
    }
    setInvalidFields((current) => current.filter((key) => !Object.prototype.hasOwnProperty.call(nextPatch, key)));
    if (submissionIssues.length) setSubmissionIssues([]);
    setItem((current) => {
      const merged = ensureCandidateDefaults({ ...(current || {}), ...nextPatch });
      if (Object.prototype.hasOwnProperty.call(nextPatch, 'phone')) {
        merged.phone = normalizeIndianPhone(merged.phone || '');
      }
      if (Object.prototype.hasOwnProperty.call(nextPatch, 'relevant_experience') && !Object.prototype.hasOwnProperty.call(nextPatch, 'relevant_experience_range')) {
        merged.relevant_experience_range = expRange(String(parseMonthCount(merged.relevant_experience)));
      }
      if (Object.prototype.hasOwnProperty.call(nextPatch, 'in_hand_salary') && !Object.prototype.hasOwnProperty.call(nextPatch, 'relevant_in_hand_range')) {
        merged.relevant_in_hand_range = salaryRange(merged.in_hand_salary || '');
      }
      if (detailTouched && String(merged.approval_status || 'Draft').toLowerCase() === 'draft' && String(merged.status || 'Draft').toLowerCase() === 'draft') {
        merged.status = 'In - Progress';
      }
      if (String(merged.approval_status || '').toLowerCase() === 'pending') {
        merged.status = merged.status || 'In - Progress';
        merged.all_details_sent = merged.all_details_sent || 'Pending';
      }
      latestItemRef.current = merged;
      if (isNewCandidate) {
        writeCandidateDraftSnapshot('new', merged);
        if (detailTouched) scheduleNewCandidateAutoCreate(merged);
      } else {
        writeCandidateDraftSnapshot(candidateId, merged);
        scheduleProfileAutoSave(merged, candidateId);
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

  function writeProfileCacheSnapshot(nextItem, nextExtras = {}, targetCandidateId = candidateId) {
    const cacheCandidateId = String(targetCandidateId || candidateId || '').trim();
    if (!cacheCandidateId || !nextItem) return;
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
    candidateCacheRef.current[cacheCandidateId] = cachedPayload;
    rememberCandidateProfileCache(cacheCandidateId, cachedPayload);
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

  function queueBackgroundProfileSave({ payload, beforeItem, beforeStatus, optimisticItem, silent = false }) {
    if (!candidateId || !payload) return;
    const ref = backgroundProfileSaveRef.current;
    ref.seq += 1;
    const queuedAt = Date.now();
    const safeOptimisticItem = ensureCandidateDefaults(sanitizeCandidateItem(optimisticItem || payload));
    ref.queued = {
      seq: ref.seq,
      queuedAt,
      candidateId,
      payload: {
        ...sanitizeCandidatePayload(payload),
        _client_updated_at: safeText(payload?._client_updated_at || resetSnapshotRef.current?.updated_at || payload?.updated_at || ''),
        _changed_fields: Array.isArray(payload?._changed_fields) ? payload._changed_fields.map((field) => safeText(field)).filter(Boolean) : [],
        _client_base_values: payload?._client_base_values && typeof payload._client_base_values === 'object' && !Array.isArray(payload._client_base_values)
          ? clonePlain(payload._client_base_values) || {}
          : {},
      },
      optimisticItem: safeOptimisticItem,
      beforeItem: clonePlain(beforeItem),
      beforeStatus: safeText(beforeStatus || ''),
      silent: Boolean(silent),
    };
    runNextBackgroundProfileSave();
  }

  function runNextBackgroundProfileSave() {
    const ref = backgroundProfileSaveRef.current;
    if (ref.inFlight || !ref.queued) return;
    const job = ref.queued;
    ref.queued = null;
    ref.inFlight = true;

    // CC26_520: the screen is optimistic. Background persistence must never
    // flash "Updating/Syncing" or replace the values the employee is reading.
    api.put(`/api/candidates/${job.candidateId}`, job.payload, { timeoutMs: 90000, detachedWrite: true })
      .then((data) => {
        const rawServerItem = sanitizeCandidateItem(data?.item || {});
        const verifyFields = (Array.isArray(job.payload?._changed_fields) ? job.payload._changed_fields : [])
          .filter((field) => PERSISTENCE_VERIFY_FIELDS.has(field));
        const persistenceMismatch = verifyFields.filter((field) => {
          const expected = String(job.optimisticItem?.[field] ?? job.payload?.[field] ?? '');
          const actual = String(rawServerItem?.[field] ?? '');
          return expected !== actual;
        });
        if (persistenceMismatch.length) {
          writeCandidateDraftSnapshot(job.candidateId, job.optimisticItem || job.payload);
          if (job.seq === backgroundProfileSaveRef.current.seq && String(candidateId || '') === String(job.candidateId || '')) {
            markSync('error', `Backend did not confirm: ${persistenceMismatch.slice(0, 4).join(', ')}. Your screen values were kept; click Save to retry.`);
          }
          return;
        }

        const serverItem = ensureCandidateDefaults(rawServerItem);
        const savedBaseline = mergeProfileWithoutBlankLoss(serverItem, job.optimisticItem || job.payload);
        const cacheItem = ensureCandidateDefaults({
          ...(job.optimisticItem || job.payload),
          updated_at: serverItem?.updated_at || job.optimisticItem?.updated_at || job.payload?.updated_at || '',
          _crm_row_id: serverItem?._crm_row_id || job.optimisticItem?._crm_row_id || job.payload?._crm_row_id || '',
        });
        const latestSeq = backgroundProfileSaveRef.current.seq;

        if (job.seq === latestSeq && String(candidateId || '') === String(job.candidateId || '')) {
          // Keep every visible field exactly as the employee left it. Only
          // accept invisible server metadata, so no font/value/range flicker.
          setItem((current) => {
            if (!current || String(current.candidate_id || '') !== String(job.candidateId || '')) return current;
            return ensureCandidateDefaults({
              ...current,
              updated_at: serverItem?.updated_at || current.updated_at || '',
              _crm_row_id: serverItem?._crm_row_id || current._crm_row_id || '',
            });
          });
          resetSnapshotRef.current = clonePlain(savedBaseline);
          localEditGuardRef.current = { candidateId: String(job.candidateId || ''), editedAt: 0 };
          try { localStorage.removeItem('career_crox_candidate_edit_lock'); } catch {}
          clearCandidateDraftSnapshot(job.candidateId);
          writeProfileCacheSnapshot(cacheItem);
          emitCandidateUpsert(cacheItem, { source: 'candidate_profile_save_synced', instant: true });
          if (!job.silent) markSync('saved', 'Saved');
          if (String(job.optimisticItem?.status || '').toLowerCase() === 'selected' && String(job.beforeStatus || '').toLowerCase() !== 'selected') {
            setCelebrate(true);
          }
        }
      })
      .catch((err) => {
        if (job.seq === backgroundProfileSaveRef.current.seq && String(candidateId || '') === String(job.candidateId || '')) {
          markSync('error', Number(err?.status || 0) === 409
            ? 'Newer update found. Refresh profile before saving to avoid overwriting someone else.'
            : (err?.message || 'Background sync failed. Your edited details are still on screen. Click Save again.'));
        }
      })
      .finally(() => {
        const refNow = backgroundProfileSaveRef.current;
        refNow.inFlight = false;
        if (refNow.queued) runNextBackgroundProfileSave();
      });
  }

  async function createNewCandidateRecord(snapshotItem = item, { navigateAfter = true, updateVisible = true } = {}) {
    const requestedSnapshot = ensureCandidateDefaults(sanitizeCandidatePayload({ ...(snapshotItem || latestItemRef.current || {}) }));
    if (String(requestedSnapshot.status || 'Draft').toLowerCase() === 'draft') requestedSnapshot.status = 'In - Progress';
    latestItemRef.current = ensureCandidateDefaults({ ...(latestItemRef.current || {}), ...requestedSnapshot });

    const ref = newCandidateCreateRef.current;
    let serverCreated = ref.created?.candidate_id ? ensureCandidateDefaults(ref.created) : null;
    let createPromise = ref.promise;
    if (!serverCreated && !createPromise) {
      const createPayload = ensureCandidateDefaults(sanitizeCandidatePayload({ ...latestItemRef.current }));
      if (String(createPayload.status || 'Draft').toLowerCase() === 'draft') createPayload.status = 'In - Progress';
      delete createPayload.candidate_id;
      delete createPayload.created_at;
      delete createPayload.updated_at;
      delete createPayload.last_viewed_at;
      delete createPayload.last_viewed_by_name;
      delete createPayload._crm_row_id;

      createPromise = api.post('/api/candidates', createPayload, { timeoutMs: 45000, retries: 0 })
        .then((data) => {
          const serverCreated = ensureCandidateDefaults(data?.item || {});
          const newId = String(serverCreated?.candidate_id || '').trim();
          if (!newId) throw new Error('Candidate was not created. Please try again.');
          ref.created = serverCreated;
          return serverCreated;
        })
        .finally(() => {
          if (ref.promise === createPromise) ref.promise = null;
        });
      ref.promise = createPromise;
    }

    if (!serverCreated) serverCreated = await createPromise;
    const newId = String(serverCreated?.candidate_id || '').trim();
    const freshestVisible = ensureCandidateDefaults(sanitizeCandidatePayload({
      ...requestedSnapshot,
      ...(latestItemRef.current || {}),
      candidate_id: newId,
      status: String((latestItemRef.current || requestedSnapshot)?.status || '').trim() || 'In - Progress',
    }));
    const created = mergeProfileWithoutBlankLoss(serverCreated, freshestVisible);
    created.candidate_id = newId;
    latestItemRef.current = created;
    if (updateVisible) setItem(created);
    resetSnapshotRef.current = clonePlain(created);
    clearCandidateDraftSnapshot('new');
    writeCandidateDraftSnapshot(newId, created);
    if (updateVisible || navigateAfter) emitCandidateUpsert(created, { source: 'candidate_profile_new_create', instant: true });
    if (navigateAfter) navigateCreatedCandidateInPlace(newId, created);
    return created;
  }

  function scheduleNewCandidateAutoCreate(snapshot) {
    if (!isNewCandidate || editingLocked || actionLockRef.current) return;
    const safeSnapshot = ensureCandidateDefaults(sanitizeCandidatePayload({ ...(snapshot || latestItemRef.current || {}) }));
    if (String(safeSnapshot.status || 'Draft').toLowerCase() === 'draft') safeSnapshot.status = 'In - Progress';
    latestItemRef.current = safeSnapshot;
    writeCandidateDraftSnapshot('new', safeSnapshot);
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      if (!isNewCandidate || editingLocked || actionLockRef.current) return;
      const ref = newCandidateCreateRef.current;
      if (ref.autoInFlight) return;
      ref.autoInFlight = true;
      const requested = ensureCandidateDefaults(sanitizeCandidatePayload({ ...(latestItemRef.current || safeSnapshot) }));
      markSync('saving', 'Auto-saving In Progress...');
      void createNewCandidateRecord(requested, { navigateAfter: false, updateVisible: false })
        .then(async (created) => {
          const id = String(created?.candidate_id || '').trim();
          if (!id) throw new Error('Candidate ID was not created.');
          let latest = ensureCandidateDefaults(sanitizeCandidatePayload({
            ...created,
            ...(latestItemRef.current || {}),
            candidate_id: id,
            status: String((latestItemRef.current || {})?.status || '').trim() || 'In - Progress',
          }));
          try {
            const response = await api.put(`/api/candidates/${id}`, sanitizeCandidatePayload(latest), { timeoutMs: 90000, detachedWrite: true });
            latest = mergeProfileWithoutBlankLoss(response?.item || {}, latest);
            clearCandidateDraftSnapshot(id);
            markSync('saved', 'In Progress • Auto-saved');
          } catch {
            writeCandidateDraftSnapshot(id, latest);
            markSync('error', 'In Progress saved locally. Backend sync will retry on the saved profile.');
          }
          latestItemRef.current = latest;
          setItem(latest);
          resetSnapshotRef.current = clonePlain(latest);
          writeProfileCacheSnapshot(latest, {}, id);
          try { writeCandidateInstantProfile(latest, candidateList); } catch {}
          emitCandidateUpsert(latest, { source: 'candidate_profile_new_autosave', instant: true });
          clearCandidateDraftSnapshot('new');
          if (!actionLockRef.current) {
            navigateCreatedCandidateInPlace(id, latest, {
              message: 'In Progress • Auto-saved',
              submissionIssues: [],
              noteRequiredError: false,
            });
          }
        })
        .catch((err) => {
          writeCandidateDraftSnapshot('new', latestItemRef.current || requested);
          markSync('error', err?.message || 'Auto-save could not reach the backend. Your In Progress draft is still safe on this computer.');
        })
        .finally(() => {
          ref.autoInFlight = false;
        });
    }, PROFILE_AUTOSAVE_DELAY_MS);
  }

  async function save(e) {
    e?.preventDefault?.();
    if (!item || !candidateId || actionLockRef.current || (actionBusy && actionBusy !== 'save')) return;
    setNoteRequiredError(false);
    if (isNewCandidate) {
      if (!beginAction('save')) return;
      markSync('saving', 'Saving candidate...');
      try {
        const created = await createNewCandidateRecord(item, { navigateAfter: false });
        let visibleNotes = Array.isArray(notes) ? notes : [];
        let preservedNoteBody = String(noteBody || '');
        if (noteBody.trim()) {
          const noteText = noteBody.trim();
          try {
            const noteResult = await api.post(`/api/candidates/${created.candidate_id}/notes`, { body: noteText, note_type: 'public', parent_note_id: '', reply_to_note_id: '', reply_to_username: '' }, { timeoutMs: 20000, retries: 0 });
            const visibleNote = noteResult?.item?.id
              ? noteResult.item
              : makeOptimisticNote(noteText, user?.full_name || user?.username || user?.name || 'You');
            visibleNotes = [visibleNote, ...visibleNotes.filter((row) => String(row?.id || '') !== String(visibleNote?.id || ''))];
            setNotes(visibleNotes);
            preservedNoteBody = '';
            setNoteBody('');
          } catch (noteError) {
            try { sessionStorage.setItem(`cc718_pending_note_${created.candidate_id}`, noteText); } catch {}
            markSync('error', 'Candidate saved, but note could not be saved. Retry it on this profile.');
            navigateCreatedCandidateInPlace(created.candidate_id, created, { notes: visibleNotes, noteBody: noteText, message: 'Candidate saved, but note could not be saved. Retry it on this profile.' });
            return;
          }
        }
        markSync('saved', 'Saved');
        navigateCreatedCandidateInPlace(created.candidate_id, created, { notes: visibleNotes, noteBody: preservedNoteBody, message: 'Saved' });
      } catch (err) {
        markSync('error', err?.message || 'Candidate create failed. Your filled details are still on screen.');
      } finally {
        endAction();
      }
      return;
    }
    // If Add Note has already started, join the same write instead of posting twice.
    if (cc718NoteWriteRef.current?.candidateId === String(candidateId || '')) {
      try { await cc718NoteWriteRef.current.promise; } catch (err) { markSync('error', err?.message || 'Note save failed. Save stopped.'); return; }
    } else if (noteBody.trim()) {
      try { await addNote(); } catch (err) { markSync('error', err?.message || 'Note save failed. Save stopped.'); return; }
    }
    const beforeItem = clonePlain(item);
    const beforeStatus = item?.status || '';
    const fullPayload = ensureCandidateDefaults(sanitizeCandidatePayload({ ...item }));
    if (approvalPending && !leadership) {
      fullPayload.status = 'In - Progress';
      fullPayload.all_details_sent = 'Pending';
    }
    const changedMeta = buildChangedFieldSavePayload(fullPayload);
    const savePayload = {
      ...sanitizeCandidatePayload(fullPayload),
      _client_updated_at: changedMeta._client_updated_at,
      _changed_fields: changedMeta._changed_fields,
      _client_base_values: changedMeta._client_base_values,
    };
    if (!changedMeta._changed_fields.length) {
      clearCandidateDraftSnapshot(candidateId);
      markSync('saved', 'Saved');
      return;
    }
    setItem(fullPayload);
    setInvalidFields([]);
    writeCandidateDraftSnapshot(candidateId, fullPayload);
    writeProfileCacheSnapshot(fullPayload);
    emitCandidateUpsert(fullPayload, { source: 'candidate_profile_save', instant: true });
    markSync('saving', 'Saving profile...');
    queueBackgroundProfileSave({ payload: savePayload, beforeItem, beforeStatus, optimisticItem: fullPayload, silent: false });
  }

  async function checkJdFit() {
    if (actionLockRef.current || actionBusy) return;
    if (isNewCandidate) {
      if (!beginAction('check')) return;
      markSync('saving', 'Creating candidate before JD check...');
      try {
        const created = await createNewCandidateRecord(item, { navigateAfter: false });
        let visibleNotes = Array.isArray(notes) ? notes : [];
        let preservedNoteBody = String(noteBody || '');
        if (noteBody.trim()) {
          const noteText = noteBody.trim();
          try {
            const noteResult = await api.post(`/api/candidates/${created.candidate_id}/notes`, {
              body: noteText, note_type: 'public', parent_note_id: '', reply_to_note_id: '', reply_to_username: '',
            }, { timeoutMs: 20000, retries: 0 });
            const visibleNote = noteResult?.item?.id
              ? noteResult.item
              : makeOptimisticNote(noteText, user?.full_name || user?.username || user?.name || 'You');
            visibleNotes = [visibleNote, ...visibleNotes.filter((row) => String(row?.id || '') !== String(visibleNote?.id || ''))];
            setNotes(visibleNotes);
            preservedNoteBody = '';
            setNoteBody('');
          } catch {
            try { sessionStorage.setItem(`cc718_pending_note_${created.candidate_id}`, noteText); } catch {}
          }
        }
        const data = await api.put(`/api/candidates/${created.candidate_id}?include_fit=1`, sanitizeCandidatePayload(created), { timeoutMs: 90000 });
        const nextItem = mergeProfileWithoutBlankLoss(data?.item || {}, created);
        setItem(nextItem);
        markSync('saved', 'Candidate created and JD fit checked.');
        navigateCreatedCandidateInPlace(created.candidate_id, nextItem, { notes: visibleNotes, noteBody: preservedNoteBody, message: 'Candidate created and JD fit checked.' });
      } catch (err) {
        markSync('error', err?.message || 'JD check failed. Filled details are still on screen.');
      } finally { endAction(); }
      return;
    }
    const beforeItem = clonePlain(item);
    const draftPayload = sanitizeCandidatePayload({ ...item });
    const changedMeta = buildChangedFieldSavePayload(draftPayload);
    const payload = {
      ...draftPayload,
      _client_updated_at: changedMeta._client_updated_at,
      _changed_fields: changedMeta._changed_fields,
      _client_base_values: changedMeta._client_base_values,
      include_fit: true,
    };
    if (approvalPending && !leadership) {
      payload.status = 'In - Progress';
      payload.all_details_sent = 'Pending';
    }
    setInvalidFields([]);
    if (!beginAction('check')) return;
    markSync('saving', 'Checking JD fit...');
    try {
      const data = await api.put(`/api/candidates/${candidateId}?include_fit=1`, payload, { timeoutMs: 90000 });
      const nextItem = mergeProfileWithoutBlankLoss(data.item || {}, draftPayload);
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
          label: fit.label || 'Match Signal',
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
    const candidateKey = String(item.candidate_id || '');
    const beforeItem = clonePlain(item);
    setApprovalDecisionBusy('approve');
    setDetailRejectOpen(false);
    setDetailRejectReason('');

    const optimisticApproved = ensureCandidateDefaults({
      ...item,
      approval_status: 'Approved',
      approved_at: new Date().toISOString(),
      approved_by_name: user?.full_name || user?.username || item.approved_by_name || '',
      status: 'Approved',
    });
    setItem(optimisticApproved);
    writeProfileCacheSnapshot(optimisticApproved);
    emitCandidateUpsert(optimisticApproved, { source: 'candidate_profile_approve_optimistic', instant: true });
    markSync('saved', 'Approved');

    void api.post('/api/approvals/approve', { type: 'candidate', id: candidateKey })
      .then(() => {
        resetSnapshotRef.current = clonePlain(optimisticApproved);
        markSync('saved', 'Approved');
      })
      .catch((err) => {
        setItem(beforeItem);
        writeProfileCacheSnapshot(beforeItem);
        emitCandidateUpsert(beforeItem, { source: 'candidate_profile_approve_rollback', instant: true });
        markSync('error', err?.message || 'Approve failed. Previous status was restored.');
      })
      .finally(() => setApprovalDecisionBusy(''));
  }

  async function rejectFromDetail() {
    if (!leadership || approvalDecisionBusy || !item?.candidate_id || approvalState === 'rejected') return;
    const reason = String(detailRejectReason || '').trim();
    if (!reason) return;
    const candidateKey = String(item.candidate_id || '');
    const beforeItem = clonePlain(item);
    setApprovalDecisionBusy('reject');

    const optimisticRejected = ensureCandidateDefaults({
      ...item,
      approval_status: 'Rejected',
      approved_at: '',
      approved_by_name: '',
      status: 'Rejected',
      rejection_reason: reason,
    });
    setItem(optimisticRejected);
    setDetailRejectOpen(false);
    setDetailRejectReason('');
    writeProfileCacheSnapshot(optimisticRejected);
    emitCandidateUpsert(optimisticRejected, { source: 'candidate_profile_reject_optimistic', instant: true });
    markSync('saved', 'Rejected');

    void api.post('/api/approvals/reject', { type: 'candidate', id: candidateKey, reason })
      .then(() => {
        resetSnapshotRef.current = clonePlain(optimisticRejected);
        markSync('saved', 'Rejected');
      })
      .catch((err) => {
        setItem(beforeItem);
        writeProfileCacheSnapshot(beforeItem);
        emitCandidateUpsert(beforeItem, { source: 'candidate_profile_reject_rollback', instant: true });
        markSync('error', err?.message || 'Reject failed. Previous status was restored.');
      })
      .finally(() => setApprovalDecisionBusy(''));
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


  async function confirmSubmissionCommit(targetId = candidateId) {
    // CC26_520 egress-safe confirmation: verify the candidate itself only.
    // No full submissions-list fetch and no long retry loop.
    const pause = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const candidateData = await api.get(`/api/candidates/${targetId}?prefetch=1`, { cacheTtlMs: 0, timeoutMs: 12000, retries: 0 });
        const latestCandidate = ensureCandidateDefaults(candidateData?.item || {});
        if (String(latestCandidate?.approval_status || '').toLowerCase() === 'pending') {
          return { ok: true, item: latestCandidate, submission: null };
        }
      } catch {}
      if (attempt === 0) await pause(900);
    }
    return { ok: false };
  }

  function latestProfileSnapshotForSubmit() {
    const currentItem = ensureCandidateDefaults(sanitizeCandidatePayload(item || {}));
    const localDraft = readCandidateDraftSnapshot(candidateId);
    if (localDraft?.item) return mergeProfileWithoutBlankLoss(localDraft.item, currentItem);
    return currentItem;
  }

  async function saveProfileSnapshotForSubmit(snapshotItem, { updateVisible = true } = {}) {
    const fullPayload = ensureCandidateDefaults(sanitizeCandidatePayload({ ...(snapshotItem || item || {}) }));
    if (approvalPending && !leadership) {
      fullPayload.status = 'In - Progress';
      fullPayload.all_details_sent = 'Pending';
    }
    const changedMeta = buildChangedFieldSavePayload(fullPayload);
    const savePayload = {
      ...sanitizeCandidatePayload(fullPayload),
      _client_updated_at: changedMeta._client_updated_at,
      _changed_fields: changedMeta._changed_fields,
      _client_base_values: changedMeta._client_base_values,
    };
    if (updateVisible) setItem(fullPayload);
    setInvalidFields([]);
    writeCandidateDraftSnapshot(candidateId, fullPayload);
    writeProfileCacheSnapshot(fullPayload);
    emitCandidateUpsert(fullPayload, { source: 'candidate_profile_submit_presave', instant: true });
    if (!changedMeta._changed_fields.length) return fullPayload;
    const data = await api.put(`/api/candidates/${candidateId}?include_fit=1`, savePayload, { timeoutMs: 90000 });
    const nextItem = mergeProfileWithoutBlankLoss(data?.item || {}, fullPayload);
    if (updateVisible) setItem(nextItem);
    resetSnapshotRef.current = clonePlain(nextItem);
    writeProfileCacheSnapshot(nextItem);
    emitCandidateUpsert(nextItem, { source: 'candidate_profile_submit_presave_synced', instant: true });
    clearCandidateDraftSnapshot(candidateId);
    return nextItem;
  }

  async function submitForApproval(event) {
    try { event?.preventDefault?.(); event?.stopPropagation?.(); } catch {}
    if (actionLockRef.current || actionBusy) return;

    const startSnapshot = ensureCandidateDefaults(sanitizeCandidatePayload(
      isNewCandidate ? (item || {}) : latestProfileSnapshotForSubmit()
    ));
    const validation = buildSubmitValidation(startSnapshot);
    const hasSavedNotes = !isNewCandidate && (noteThreads.length > 0 || cc718NoteWriteRef.current?.candidateId === String(candidateId || ''));
    const draftNote = String(noteBody || '').trim();
    const draftReplyContext = clonePlain(replyContext);
    const hasDraftNote = Boolean(draftNote);

    if (!hasSavedNotes && !hasDraftNote) {
      const noteIssue = 'Note required before Submit. Add what happened / candidate update in Notes, then Submit again. Your profile details have been saved and will not disappear.';
      setNoteRequiredError(true);
      setSubmissionIssues([noteIssue]);
      markSync('error', 'Note required • Profile saved safely');
      window.setTimeout(() => {
        jumpToNotesPanel();
        const textarea = notesPanelRef.current?.querySelector('textarea');
        try { textarea?.focus({ preventScroll: true }); } catch { textarea?.focus(); }
      }, 0);

      void (async () => {
        if (!beginAction('save-note-required')) return;
        let protectedSnapshot = startSnapshot;
        try {
          protectedSnapshot = ensureCandidateDefaults({
            ...startSnapshot,
            status: String(startSnapshot?.status || '').toLowerCase() === 'draft' ? 'In - Progress' : (startSnapshot?.status || 'In - Progress'),
            approval_status: 'Draft',
          });
          latestItemRef.current = protectedSnapshot;
          if (isNewCandidate) {
            const created = await createNewCandidateRecord(protectedSnapshot, { navigateAfter: false, updateVisible: false });
            const activeId = String(created?.candidate_id || '').trim();
            let savedVisible = ensureCandidateDefaults({ ...protectedSnapshot, ...created, candidate_id: activeId, status: 'In - Progress' });
            try {
              const response = await api.put(`/api/candidates/${activeId}`, sanitizeCandidatePayload(savedVisible), { timeoutMs: 90000, detachedWrite: true });
              savedVisible = mergeProfileWithoutBlankLoss(response?.item || {}, savedVisible);
              clearCandidateDraftSnapshot(activeId);
            } catch {
              writeCandidateDraftSnapshot(activeId, savedVisible);
            }
            latestItemRef.current = savedVisible;
            setItem(savedVisible);
            resetSnapshotRef.current = clonePlain(savedVisible);
            emitCandidateUpsert(savedVisible, { source: 'candidate_profile_note_required_presave', instant: true });
            navigateCreatedCandidateInPlace(activeId, savedVisible, {
              noteBody: '',
              message: 'Note required • Profile saved safely',
              submissionIssues: [noteIssue],
              noteRequiredError: true,
            });
          } else {
            const savedVisible = await saveProfileSnapshotForSubmit(protectedSnapshot, { updateVisible: true });
            latestItemRef.current = savedVisible;
            setSubmissionIssues([noteIssue]);
            setNoteRequiredError(true);
            markSync('error', 'Note required • Profile saved safely');
            window.setTimeout(() => {
              jumpToNotesPanel();
              const textarea = notesPanelRef.current?.querySelector('textarea');
              try { textarea?.focus({ preventScroll: true }); } catch { textarea?.focus(); }
            }, 0);
          }
        } catch (err) {
          writeCandidateDraftSnapshot(isNewCandidate ? 'new' : candidateId, protectedSnapshot || startSnapshot);
          setSubmissionIssues([noteIssue, err?.message || 'Backend save is pending; your draft is still safe on this computer.']);
          setNoteRequiredError(true);
          markSync('error', 'Note required • Draft kept safely');
        } finally {
          endAction();
        }
      })();
      return;
    }
    setNoteRequiredError(false);
    if (!validation.ok) {
      setInvalidFields(validation.missingKeys || []);
      setSubmissionIssues(validation.issues || normalizeIssueLines(validation.message));
      markSync('error', 'Submit blocked. Fix the highlighted details.');
      const firstInvalid = (validation.missingKeys || [])[0];
      if (firstInvalid) {
        window.setTimeout(() => document.querySelector(
          `[data-field="${firstInvalid}"] input, [data-field="${firstInvalid}"] textarea, [data-field="${firstInvalid}"] select, [data-field="${firstInvalid}"] button`
        )?.focus(), 0);
      }
      return;
    }
    if (!beginAction('submit')) return;

    // CC26_520: employee gets the finished state immediately. The safe
    // persistence chain continues in the background and rolls back only if
    // the backend genuinely rejects the action.
    const optimisticItem = ensureCandidateDefaults({
      ...startSnapshot,
      call_connected: 'Yes',
      status: 'In - Progress',
      all_details_sent: 'Pending',
      approval_status: 'Pending',
      submission_date: startSnapshot?.submission_date || nowDateTimeLocal(),
      submission_exists: true,
    });
    setItem(optimisticItem);
    setInvalidFields([]);
    setSubmissionIssues([]);
    setStatusFlash('pending');
    setNoteBody('');
    writeProfileCacheSnapshot(optimisticItem);
    if (!isNewCandidate) {
      writeCandidateDraftSnapshot(candidateId, optimisticItem);
      backgroundProfileSaveRef.current.seq += 1;
      backgroundProfileSaveRef.current.queued = null;
      emitCandidateUpsert(optimisticItem, { source: 'candidate_profile_submit_optimistic', submitted: true, instant: true });
    }
    markSync('saving', 'Submitting...');

    void (async () => {
      let activeCandidateId = String(candidateId || '');
      let savedSnapshot = startSnapshot;
      let cc718NoteCommitted = false;
      let visibleNotesForHandoff = Array.isArray(notes) ? notes : [];
      try {
        if (isNewCandidate) {
          const created = await createNewCandidateRecord(startSnapshot, { navigateAfter: false, updateVisible: false });
          activeCandidateId = String(created.candidate_id || '').trim();
          if (!activeCandidateId) throw new Error('Candidate was not created.');
          savedSnapshot = created;
        } else {
          savedSnapshot = await saveProfileSnapshotForSubmit(startSnapshot, { updateVisible: false });
        }

        if (isNewCandidate && hasDraftNote) {
          const noteResult = await api.post(`/api/candidates/${activeCandidateId}/notes`, {
            body: draftNote, note_type: 'public', parent_note_id: '', reply_to_note_id: '', reply_to_username: '',
          }, { timeoutMs: 20000, retries: 0 });
          const visibleNote = noteResult?.item?.id
            ? noteResult.item
            : makeOptimisticNote(draftNote, user?.full_name || user?.username || user?.name || 'You');
          visibleNotesForHandoff = [visibleNote, ...visibleNotesForHandoff.filter((row) => String(row?.id || '') !== String(visibleNote?.id || ''))];
          setNotes(visibleNotesForHandoff);
          cc718NoteCommitted = true;
        } else if (!isNewCandidate && cc718NoteWriteRef.current?.candidateId === String(activeCandidateId)) {
          await cc718NoteWriteRef.current.promise;
        } else if (!isNewCandidate && hasDraftNote) {
          const noteResult = await api.post(`/api/candidates/${activeCandidateId}/notes`, {
            body: draftNote,
            note_type: 'public',
            parent_note_id: draftReplyContext?.rootId || '',
            reply_to_note_id: draftReplyContext?.replyToId || '',
            reply_to_username: draftReplyContext?.replyToUsername || '',
          }, { timeoutMs: 20000, retries: 0 });
          const visibleNote = noteResult?.item?.id
            ? noteResult.item
            : makeOptimisticNote(draftNote, user?.full_name || user?.username || user?.name || 'You');
          visibleNotesForHandoff = [visibleNote, ...visibleNotesForHandoff.filter((row) => String(row?.id || '') !== String(visibleNote?.id || ''))];
          setNotes(visibleNotesForHandoff);
          cc718NoteCommitted = true;
        }

        const submitPayload = ensureCandidateDefaults({
          ...sanitizeCandidatePayload(savedSnapshot),
          call_connected: 'Yes',
          status: 'In - Progress',
          all_details_sent: 'Pending',
          approval_status: 'Pending',
          submission_date: savedSnapshot?.submission_date || optimisticItem.submission_date || nowDateTimeLocal(),
        });

        let data;
        try {
          data = await api.post(`/api/candidates/${activeCandidateId}/submit`, sanitizeCandidatePayload(submitPayload), { timeoutMs: 45000 });
        } catch (firstErr) {
          const transient = String(firstErr?.message || '').toLowerCase().includes('timed out')
            || [502, 503, 504].includes(Number(firstErr?.status || 0));
          if (!transient) throw firstErr;
          data = await api.post(`/api/candidates/${activeCandidateId}/submit`, sanitizeCandidatePayload(submitPayload), { timeoutMs: 45000 });
        }

        const serverItem = ensureCandidateDefaults(data?.item || {});
        const confirmedVisible = ensureCandidateDefaults({
          ...optimisticItem,
          candidate_id: activeCandidateId,
          submission_id: serverItem.submission_id || data?.submission?.submission_id || data?.submission?.id || optimisticItem.submission_id || '',
          submission_exists: true,
          approval_requested_at: serverItem.approval_requested_at || optimisticItem.approval_requested_at || new Date().toISOString(),
          submitted_at: serverItem.submitted_at || optimisticItem.submitted_at || '',
          updated_at: serverItem.updated_at || optimisticItem.updated_at || '',
        });

        setItem((current) => current ? ensureCandidateDefaults({
          ...current,
          candidate_id: activeCandidateId,
          approval_status: 'Pending',
          status: current.status || 'In - Progress',
          all_details_sent: current.all_details_sent || 'Pending',
          submission_date: current.submission_date || confirmedVisible.submission_date,
          submission_id: confirmedVisible.submission_id,
          submission_exists: true,
          approval_requested_at: confirmedVisible.approval_requested_at,
          submitted_at: confirmedVisible.submitted_at,
          updated_at: confirmedVisible.updated_at,
        }) : confirmedVisible);
        resetSnapshotRef.current = clonePlain(mergeProfileWithoutBlankLoss(serverItem, confirmedVisible));
        if (!isNewCandidate) clearCandidateDraftSnapshot(activeCandidateId);
        writeProfileCacheSnapshot(confirmedVisible, {}, activeCandidateId);
        try { writeCandidateInstantProfile(confirmedVisible, candidateList); } catch {}
        emitCandidateUpsert(confirmedVisible, {
          source: isNewCandidate ? 'candidate_profile_new_submit' : 'candidate_profile_submit',
          submitted: true,
          submission: data?.submission || null,
          instant: true,
        });
        markSync('saved', 'Submitted');

        if (isNewCandidate) {
          const pathNow = String(window.location?.pathname || '').toLowerCase();
          if (pathNow.includes('/candidate/new') || pathNow.endsWith('/candidate')) {
            navigateCreatedCandidateInPlace(activeCandidateId, confirmedVisible, { notes: visibleNotesForHandoff, noteBody: '', message: 'Submitted', statusFlash: 'pending' });
          }
        }
      } catch (err) {
        let confirmed = { ok: false };
        if (activeCandidateId && !isNewCandidate) {
          const transient = String(err?.message || '').toLowerCase().includes('timed out')
            || [502, 503, 504].includes(Number(err?.status || 0));
          if (transient) confirmed = await confirmSubmissionCommit(activeCandidateId);
        }

        if (confirmed.ok) {
          const serverItem = ensureCandidateDefaults(confirmed.item || {});
          setItem((current) => current ? ensureCandidateDefaults({
            ...current,
            approval_status: 'Pending',
            submission_exists: true,
            approval_requested_at: serverItem.approval_requested_at || current.approval_requested_at || '',
            submission_id: serverItem.submission_id || current.submission_id || '',
            updated_at: serverItem.updated_at || current.updated_at || '',
          }) : current);
          setStatusFlash('pending');
          setSubmissionIssues([]);
          markSync('saved', 'Submitted');
        } else {
          // New candidate creation may have committed even though notes/submit failed:
          // preserve that exact ID and navigate to it; never create a duplicate on retry.
          if (isNewCandidate && activeCandidateId && activeCandidateId.toLowerCase() !== 'new') {
            if (hasDraftNote && !cc718NoteCommitted) try { sessionStorage.setItem(`cc718_pending_note_${activeCandidateId}`, draftNote); } catch {}
            const preservedCreated = ensureCandidateDefaults({ ...startSnapshot, candidate_id: activeCandidateId });
            setItem(preservedCreated);
            resetSnapshotRef.current = clonePlain(preservedCreated);
            writeProfileCacheSnapshot(preservedCreated, {}, activeCandidateId);
            try { writeCandidateInstantProfile(preservedCreated, candidateList); } catch {}
            markSync('error', err?.message || 'Candidate created. Complete note/submit on the saved profile.');
            navigateCreatedCandidateInPlace(activeCandidateId, preservedCreated, { noteBody: hasDraftNote && !cc718NoteCommitted ? draftNote : '', message: err?.message || 'Candidate created. Complete note/submit on the saved profile.' });
            return;
          }
          setItem(startSnapshot);
          if (hasDraftNote && !cc718NoteCommitted) setNoteBody(draftNote);
          if (!isNewCandidate) {
            writeCandidateDraftSnapshot(candidateId, startSnapshot);
            writeProfileCacheSnapshot(startSnapshot);
            emitCandidateUpsert(startSnapshot, { source: 'candidate_profile_submit_rollback', instant: true });
          }
          setStatusFlash('');
          setSubmissionIssues(normalizeIssueLines(err?.message || 'Submit failed. Your details were kept safely on screen.'));
          markSync('error', err?.message || 'Submit failed. Your details were kept safely on screen.');
        }
      } finally {
        endAction();
      }
    })();
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
    setNoteRequiredError(false);
    if (cc718NoteWriteRef.current?.candidateId === String(candidateId || '')) return cc718NoteWriteRef.current.promise;
    if (!noteBody.trim()) return null;
    if (isNewCandidate) {
      if (!(String(item?.full_name || '').trim() || String(item?.phone || '').trim())) {
        markSync('error', 'Add a candidate name or number before saving the note.');
        return null;
      }
      if (!beginAction('note')) return null;
      markSync('saving', 'Saving candidate and note...');
      try {
        const created = await createNewCandidateRecord(item, { navigateAfter: false });
        const pendingBody = noteBody.trim();
        let visibleNotes = Array.isArray(notes) ? notes : [];
        let preservedNoteBody = pendingBody;
        try {
          const noteResult = await api.post(`/api/candidates/${created.candidate_id}/notes`, {
            body: pendingBody, note_type: 'public', parent_note_id: '', reply_to_note_id: '', reply_to_username: '',
          }, { timeoutMs: 20000, retries: 0 });
          const visibleNote = noteResult?.item?.id
            ? noteResult.item
            : makeOptimisticNote(pendingBody, user?.full_name || user?.username || user?.name || 'You');
          visibleNotes = [visibleNote, ...visibleNotes.filter((row) => String(row?.id || '') !== String(visibleNote?.id || ''))];
          setNotes(visibleNotes);
          preservedNoteBody = '';
          setNoteBody('');
          markSync('saved', 'Note saved.');
        } catch (err) {
          try { sessionStorage.setItem(`cc718_pending_note_${created.candidate_id}`, pendingBody); } catch {}
          markSync('error', 'Candidate saved. Note could not be saved; retry on this profile.');
        }
        navigateCreatedCandidateInPlace(created.candidate_id, created, { notes: visibleNotes, noteBody: preservedNoteBody, message: preservedNoteBody ? 'Candidate saved. Note could not be saved; retry on this profile.' : 'Note saved.' });
      } catch (err) { markSync('error', err?.message || 'Candidate could not be created. Details are still here.'); }
      finally { endAction(); }
      return null;
    }
    const body = noteBody.trim();
    const beforeReplyContext = clonePlain(replyContext);
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

    // Immediately show the note; report success only after the backend confirms it.
    setNotes((current) => [optimisticNote, ...(current || [])]);
    setTimeline((current) => [optimisticTimeline, ...(current || [])]);
    setNoteBody('');
    setReplyContext(null);
    markSync('saving', 'Saving note...');

    const noteWrite = api.post(`/api/candidates/${candidateId}/notes`, payload, { detachedWrite: true, timeoutMs: 45000, retries: 0 })
      .then((data) => {
        const saved = data?.item;
        if (saved && saved.id) {
          setNotes((current) => (current || []).map((row) => String(row?.id || '') === String(optimisticNote?.id || '') ? { ...optimisticNote, ...saved } : row));
        }
        markSync('saved', payload.reply_to_note_id ? 'Reply saved.' : 'Note saved.');
      })
      .catch((err) => {
        // Roll back only this failed optimistic note, never newer employee work.
        setNotes((current) => (current || []).filter((row) => String(row?.id || '') !== String(optimisticNote?.id || '')));
        setTimeline((current) => (current || []).filter((row) => String(row?.id || '') !== String(optimisticTimeline?.id || '')));
        setNoteBody((current) => current ? current : body);
        setReplyContext((current) => current || beforeReplyContext || null);
        markSync('error', err?.message || 'Note could not sync. Text restored for retry.');
        throw err;
      })
      .finally(() => {
        if (cc718NoteWriteRef.current?.promise === noteWrite) cc718NoteWriteRef.current = null;
      });
    cc718NoteWriteRef.current = { candidateId: String(candidateId || ''), promise: noteWrite };
    return noteWrite;
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
    const template = decodeWhatsAppTemplateOption(value);
    if (!template?.body) return;
    openWhatsApp(renderWhatsAppTemplateBody(template.body, item, user));
  }

  async function onDial() {
    if (!item?.phone) return;
    markSync('saving', 'Sending call to paired mobile app...');
    try {
      await dialCandidateWithLog(candidateId, item.phone || '', { candidate_name: item.full_name || item.name || '', process: item.process || item.jd_name || '', location: item.location || item.preferred_location || '' });
      markSync('saved', 'Mobile app call command sent. Browser dialer is disabled.');
    } catch (err) {
      markSync('error', err.message || 'Pair mobile app first, then call again.');
      try { window.alert(err.message || 'Pair mobile app first, then call again.'); } catch {}
    }
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
    const fresh = String(window.prompt('Add new process name') || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!fresh) return;
    const nextOptions = mergeProcessOptions(processOptions, [fresh]);
    // Instant frontend: show/select it immediately and keep a browser fallback.
    setProcessOptions(nextOptions);
    persistProcessOptions(nextOptions);
    patch({ process: fresh });

    // Permanent shared save happens once in the background; no auto-polling / egress loop.
    void api.post('/api/candidates/process-options', { name: fresh }, { timeoutMs: 15000, retries: 1 })
      .then((data) => {
        const shared = safeArray(data?.items).map((entry) => safeText(entry)).filter(Boolean);
        if (shared.length) {
          const merged = mergeProcessOptions(nextOptions, shared);
          setProcessOptions(merged);
          persistProcessOptions(merged);
        }
        setMessage(`Process saved permanently: ${fresh}`);
      })
      .catch((err) => {
        // Keep local option + selected candidate data safe even if the network is temporarily down.
        setMessage(err?.message || `Process selected. Permanent server save will need retry when connection is available: ${fresh}`);
      });
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
      <Layout title={`Candidate • ${candidateId}`} subtitle="Opening profile...">
        <div className="panel top-gap">
          <div className="helper-text">Opening profile...</div>
          <div className="row-actions top-gap-small">
            <button className="ghost-btn bounceable" type="button" onClick={() => navigate('/candidates')}>Back</button>
          </div>
        </div>
      </Layout>
    );
  }

  if (error || !item) {
    return (
      <Layout title={`Candidate • ${candidateId}`} subtitle="Profile is temporarily unavailable.">
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
  const submittedWorkflowActive = hasRealSubmittedWorkflow(item || {}, approvalState);
  const draftWorkflowActive = !submittedWorkflowActive;
  const stateLabel = approvalState === 'approved' ? 'Approved' : approvalState === 'rejected' ? 'Rejected' : approvalState === 'pending' ? 'Pending Approval' : 'Draft';
  const bannerStatusText = submittedWorkflowActive ? (item.status || stateLabel) : 'Draft';
  const bannerDetailsText = item.all_details_sent || 'Pending';
  const draftWorkflowDisplayLocked = false;
  const detailStatusValue = currentApprovedStatus;
  const detailDetailsSentValue = approvalPending && !leadership ? 'Pending' : (item.all_details_sent || 'Pending');
  const detailSubmissionDateValue = toDateTimeLocalInput(item.submission_date || nowDateTimeLocal());
  const detailsLockInfo = detailsCompletedLockInfo(item || {});
  const detailsCompletionLocked = String(detailDetailsSentValue || '').trim().toLowerCase() !== 'completed' && detailsLockInfo.locked;
  function handleDetailsSentChange(value) {
    const nextValue = String(value || '').trim();
    if (nextValue === 'Completed' && detailsCompletionLocked) {
      markSync('error', `All Details Sent can be marked completed only 15 minutes after submission${detailsLockInfo.remainingMinutes ? ` (${detailsLockInfo.remainingMinutes} min left)` : ''}.`);
      return;
    }
    patch({ all_details_sent: nextValue || 'Pending' });
  }
  const showApprovalDecisionControls = leadership && approvalState === 'pending';
  const submissionLocked = approvalState === 'pending' || approvalState === 'approved';
  const submitButtonLabel = submissionLocked ? 'Submitted' : 'Submit';
  const totalExperienceParts = splitExperienceValue(item?.total_experience || '');
  const relevantExperienceParts = splitExperienceValue(item?.relevant_experience || '');
  const liveExperienceInvalid = hasExperienceMismatch(item);
  const liveSalaryInvalid = hasSalaryMismatch(item);
  const experienceGuardText = 'Relevant Experience cannot stay higher than Total Experience. Keep it equal or lower.';
  const salaryGuardText = 'CTC Monthly cannot stay lower than In-hand Monthly Salary. Keep it equal or higher.';

  const candidateDisplayName = item.full_name || (isNewCandidate ? 'New Candidate' : item.candidate_id);

  return (
    <Layout
      title={(
        <span className="candidate-top-title-wrap">
          <span className="candidate-top-title-kicker">{isNewCandidate ? 'Add Candidate' : 'Candidate'}</span>
          <span className="candidate-top-title-name">{candidateDisplayName}</span>
        </span>
      )}
      subtitle=""
    >
      <CelebrationBurst active={celebrate} />
      <div className={`panel top-gap candidate-detail-full-panel ${draftWorkflowActive ? 'candidate-draft-profile-panel' : ''} ${statusFlash ? `approval-wash approval-wash-${statusFlash}` : ''}`.trim()}>
        <div className="panel-heading-row">
          <div>
            <div className="panel-title">{isNewCandidate ? 'Add Candidate • Full Profile' : 'Candidate Profile'}</div>
            <div className="helper-text top-gap-small">One profile. Every signal. Ready for action.</div>
          </div>
          <div className="detail-header-actions detail-header-actions-modern">
            <MiniIconButton title="Previous Profile" className="modern-eye-btn" onClick={() => prevCandidate && openCandidate(prevCandidate.candidate_id, prevCandidate)} disabled={isNewCandidate || !prevCandidate}><PrevIcon /></MiniIconButton>
            <MiniIconButton title="Dial Call" className="modern-call-btn" onClick={onDial} disabled={isNewCandidate}><PhoneIcon /></MiniIconButton>
            <div className="wa-template-shell">
              <MiniIconButton title="Open WhatsApp" className="modern-wa-btn" onClick={() => openWhatsApp('')} disabled={isNewCandidate}><WhatsAppIcon /></MiniIconButton>
              <select className="wa-template-select genz-wa-select" defaultValue="" onChange={(e) => { useWaTemplate(e.target.value); e.target.value = ''; }}>
                <option value="">WA template</option>
                {safeArray(waTemplates).slice(0, 80).map((tpl, index) => {
                  const option = normalizeWhatsAppTemplateOption(tpl, index);
                  return option ? <option key={`${option.title}-${index}`} value={encodeWhatsAppTemplateOption(option, index)}>{option.title}</option> : null;
                })}
                <option value="__add_new__">Add New...</option>
              </select>
            </div>
            <MiniIconButton title="Next Profile" className="modern-eye-btn" onClick={openNextCandidate} disabled={isNewCandidate || (!nextCandidate && !hasMoreNavAfter && !canProbeNextNavPage && !fetchingNavPage)}>{fetchingNavPage ? <span style={{fontWeight:1000,fontSize:12}}>...</span> : <NextIcon />}</MiniIconButton>
            {!isNewCandidate && canDeleteProfile ? <button type="button" className="mini-btn edit bounceable modern-delete-btn" onClick={deleteCurrentCandidate}>Delete</button> : null}
          </div>
        </div>


        <div className={`approval-action-banner state-${approvalState || 'draft'}`}>
          <div className="approval-banner-left">
            <span className={`profile-state-chip state-${approvalState || 'draft'}`}>{stateLabel}</span>
            {syncState !== 'idle' ? (
              <span className={`mini-chip sync-chip ${syncState}`}>{syncState === 'saving' ? 'Saved' : syncState === 'saved' ? 'Saved' : 'Save failed'}</span>
            ) : null}
            <span className="helper-text">Status: {bannerStatusText} • Details Sent: {bannerDetailsText} • {profileVerified ? 'Fresh verified' : 'Safe edit enabled, verifying in background'}</span>
          </div>
          <div className="approval-banner-right approval-banner-right-with-view">
            <div className="last-viewed-highlight">
              <span className="last-viewed-label">Last Viewed</span>
              <strong>{formatLastViewedStamp(item.last_viewed_at)}</strong>
            </div>
            {showApprovalDecisionControls ? (
              <div className="approval-banner-actions approval-banner-noteonly" style={{ display: 'grid', gap: 10, justifyItems: 'end', minWidth: 260 }}>
                <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                  <button className="mini-btn call bounceable" type="button" disabled={approvalDecisionBusy === 'approve' || approvalDecisionBusy === 'reject'} onClick={approveFromDetail}>Approve</button>
                  <button className="mini-btn edit bounceable" type="button" disabled={approvalDecisionBusy === 'approve' || approvalDecisionBusy === 'reject'} onClick={() => { setDetailRejectOpen((current) => !current); if (detailRejectOpen) setDetailRejectReason(''); }}>Reject</button>
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

        <div className="cc560-quicknav" role="navigation" aria-label="Candidate quick jump">
          <span className="cc560-quicknav-label">QUICK NAVIGATION</span>
          <div className="cc560-quicknav-scroll">
            {[
              ['Contact', 'full_name'], ['Location', 'preferred_location'],
              ['Experience', 'total_experience'], ['Salary', 'ctc_monthly'],
              ['Interview', 'interview_reschedule_date'], ['Status', 'status'],
              ['Notes', 'master_notes'], ['Files', 'files'], ['Save', 'save'],
            ].map(([label, section]) => (
              <button key={section} className="cc560-jump-btn" type="button" onClick={() => cc560CandidateJump(section)}>{label}</button>
            ))}
          </div>
        </div>

        <SafeSectionBoundary title="Recent Notes">
        <div className="candidate-recent-note-strip-shell top-gap-small">
          <div className="candidate-recent-note-strip-head">
            <div className="panel-title">Recent 3 Notes</div>
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

        <form className="stack-form" ref={formRef} onSubmit={(event) => event.preventDefault()} onKeyDown={moveToNextField}>
          <div className="candidate-sequence-shell">
            <div className="candidate-meta-row">
              <div className="field compact-id-field candidate-meta-card"><label>Candidate ID</label><input className="compact-id-input" value={item.candidate_id || ''} readOnly /></div>
              <div className="field compact-id-field candidate-meta-card" data-field="recruiter_code">
                <label>Recruiter Name - Code</label>
                {canManagerReassignRecruiter ? (
                  <select className="compact-id-input recruiter-identity-input" value={item.recruiter_code || ''} onChange={(e) => {
                    const code = e.target.value;
                    const matched = safeArray(recruiterOptions).find((row) => safeText(row?.recruiter_code || row?.user_code || row?.employee_code || row?.username || '') === safeText(code));
                    const currentCode = safeText(user?.recruiter_code || user?.user_code || user?.employee_code || user?.username || '');
                    const currentName = safeText(user?.full_name || user?.name || user?.display_name || user?.employee_name || user?.username || '');
                    const itemName = safeText(item.recruiter_name || '');
                    patch({ recruiter_code: code, recruiter_name: safeText(matched?.full_name || matched?.name || matched?.display_name || matched?.employee_name || matched?.username || (safeText(code) === currentCode ? currentName : '') || (safeText(code) === safeText(item.recruiter_code) && itemName !== safeText(code) ? itemName : '') || '') });
                  }}>
                    <option value="">Select recruiter</option>
                    {stableOptions(safeArray(recruiterOptions).map((row) => safeText(row?.recruiter_code || row?.user_code || row?.employee_code || row?.username || '')), item.recruiter_code || '').map((code) => {
                      const matched = safeArray(recruiterOptions).find((row) => safeText(row?.recruiter_code || row?.user_code || row?.employee_code || row?.username || '') === safeText(code));
                      const currentCode = safeText(user?.recruiter_code || user?.user_code || user?.employee_code || user?.username || '');
                      const currentName = safeText(user?.full_name || user?.name || user?.display_name || user?.employee_name || user?.username || '');
                      const itemName = safeText(item.recruiter_name || '');
                      const name = safeText(matched?.full_name || matched?.name || matched?.display_name || matched?.employee_name || matched?.username || (safeText(code) === currentCode ? currentName : '') || (safeText(code) === safeText(item.recruiter_code) && itemName !== safeText(code) ? itemName : '') || 'Recruiter');
                      const recruiterCode = safeText(matched?.recruiter_code || matched?.user_code || matched?.employee_code || matched?.username || code);
                      return <option key={code} value={code}>{`${name} - ${recruiterCode}`}</option>;
                    })}
                  </select>
                ) : <input className="compact-id-input recruiter-identity-input" value={`${safeText((safeText(item.recruiter_code) === safeText(user?.recruiter_code || user?.user_code || user?.employee_code || user?.username) ? (user?.full_name || user?.name || user?.display_name || user?.employee_name || user?.username) : '') || (safeText(item.recruiter_name) !== safeText(item.recruiter_code) ? item.recruiter_name : '') || item.recruiter_code || '')}${item.recruiter_code ? ` - ${safeText(item.recruiter_code)}` : ''}`.replace(/^\s*-\s*/, '')} readOnly />}
                {selectedRecruiterMeta ? <div className="helper-text top-gap-small cc730-recruiter-meta">{selectedRecruiterMeta}</div> : null}
              </div>
              <div className="candidate-meta-card candidate-meta-support-card">
                <div className="candidate-mini-support-grid candidate-mini-support-grid-inline">
                  <div data-field="call_connected"><ChoiceField compact label="Call Connected" value={item.call_connected || ''} options={CALL_CONNECTED_OPTIONS} onChange={(value) => patch({ call_connected: value })} disabled={editingLocked} /></div>
                  <div data-field="looking_for_job"><ChoiceField compact label="Looking for Job" value={item.looking_for_job || 'Yes'} options={LOOKING_FOR_JOB_OPTIONS} onChange={(value) => patch({ looking_for_job: value })} disabled={editingLocked} invalid={invalidFields.includes('looking_for_job')} /></div>
                </div>
              </div>
            </div>

            <div className="candidate-form-grid candidate-sequence-grid candidate-basic-row">
              <div className={`field ${invalidFields.includes('full_name') ? 'invalid-field' : ''}`.trim()} data-field="full_name"><label>Name</label><input className={invalidFields.includes('full_name') ? 'invalid-input' : ''} value={item.full_name || ''} onChange={(e) => patch({ full_name: e.target.value })} disabled={editingLocked} /></div>
              <div className={`field ${invalidFields.includes('phone') ? 'invalid-field' : ''}`.trim()} data-field="phone"><label>Number</label><div className="candidate-phone-input-shell"><span className="candidate-phone-prefix">+91</span><input className={invalidFields.includes('phone') ? 'invalid-input' : ''} type="tel" key={String(item.candidate_id || 'phone-field')} inputMode="numeric" pattern="[0-9]*" autoComplete="tel-national" defaultValue={String(item.phone || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '').slice(-10)} onBlur={(e) => { const raw = String(e.currentTarget.value || '').replace(/\D/g, ''); const digits = raw.length === 12 && raw.startsWith('91') ? raw.slice(2) : raw.slice(-10); e.currentTarget.value = digits; patch({ phone: digits }); }} disabled={editingLocked} /></div></div>
              <div className={`field ${invalidFields.includes('location') ? 'invalid-field' : ''}`.trim()} data-field="location"><label>Location</label><input className={invalidFields.includes('location') ? 'invalid-input' : ''} value={item.location || ''} onChange={(e) => patch({ location: e.target.value })} disabled={editingLocked} /></div>
              <div className={`field ${invalidFields.includes('qualification') ? 'invalid-field' : ''}`.trim()} data-field="qualification"><label>Course Name</label><input className={invalidFields.includes('qualification') ? 'invalid-input' : ''} value={item.course_name || item.qualification || ''} onChange={(e) => patch({ qualification: e.target.value, course_name: e.target.value })} list="cc645-course-options" disabled={editingLocked} /><datalist id="cc645-course-options">{['B.Tech','BCA','BBA','B.Com','B.Sc','M.Tech','MCA','MBA','M.Com','M.Sc','Diploma','Other'].map((v) => <option key={v} value={v} />)}</datalist></div>
            </div>

            <div className="candidate-form-grid candidate-sequence-grid candidate-four-col-row top-gap-small">
              <div className={`field ${invalidFields.includes('preferred_location') ? 'invalid-field' : ''}`.trim()} data-field="preferred_location">
                <div className="field-label-line"><label>Preferred Location</label><button type="button" className="mini-inline-action bounceable" disabled={editingLocked} onClick={addPreferredLocationOption}>+ Add New</button></div>
                <div className="choice-chip-row compact-row">
                  {safeTemplateList(preferredLocations, 80).map((option) => {
                    const checked = splitMulti(item.preferred_location || 'Noida').includes(option);
                    return <button key={option} type="button" disabled={editingLocked} className={`choice-chip bounceable ${checked ? 'active' : ''}`} onClick={() => patch({ preferred_location: toggleMultiValue(item.preferred_location || 'Noida', option, true) })}>{option}</button>;
                  })}
                </div>
              </div>
              <div data-field="qualification_level"><ChoiceField label="Degree" value={item.qualification_level || 'Graduate'} options={DEGREE_OPTIONS} onChange={(value) => patch({ qualification_level: value })} disabled={editingLocked} invalid={invalidFields.includes('qualification_level')} /></div>
              <div className={`field exp-split-field ${(invalidFields.includes('total_experience') || liveExperienceInvalid) ? 'invalid-field live-invalid-field' : ''}`.trim()} data-field="total_experience"><label>Total Experience</label><div className="split-exp-grid"><input className={(invalidFields.includes('total_experience') || liveExperienceInvalid) ? 'invalid-input live-invalid-input' : ''} value={totalExperienceParts.years} onChange={(e) => patchExperienceField('total_experience', 'years', e.target.value)} disabled={editingLocked} placeholder="Years" /><input className={(invalidFields.includes('total_experience') || liveExperienceInvalid) ? 'invalid-input live-invalid-input' : ''} value={totalExperienceParts.months} onChange={(e) => patchExperienceField('total_experience', 'months', e.target.value)} disabled={editingLocked} placeholder="Months" /></div><div className="helper-text top-gap-small">Saved as: {formatExperiencePreview(item.total_experience || '0')}</div>{liveExperienceInvalid ? <div className="helper-text top-gap-small live-validation-text">{experienceGuardText}</div> : null}</div>
              <div className={`field exp-split-field ${(invalidFields.includes('relevant_experience') || liveExperienceInvalid) ? 'invalid-field live-invalid-field' : ''}`.trim()} data-field="relevant_experience"><div className="field-label-line"><label>Relevant Experience</label><button type="button" className="mini-inline-action bounceable" disabled={editingLocked} onClick={copyTotalExperienceToRelevant}>Same</button></div><div className="split-exp-grid"><input className={(invalidFields.includes('relevant_experience') || liveExperienceInvalid) ? 'invalid-input live-invalid-input' : ''} value={relevantExperienceParts.years} onChange={(e) => patchExperienceField('relevant_experience', 'years', e.target.value)} disabled={editingLocked} placeholder="Years" /><input className={(invalidFields.includes('relevant_experience') || liveExperienceInvalid) ? 'invalid-input live-invalid-input' : ''} value={relevantExperienceParts.months} onChange={(e) => patchExperienceField('relevant_experience', 'months', e.target.value)} disabled={editingLocked} placeholder="Months" /></div><div className="helper-text top-gap-small">Saved as: {formatExperiencePreview(item.relevant_experience || '0')}</div>{liveExperienceInvalid ? <div className="helper-text top-gap-small live-validation-text">{experienceGuardText}</div> : null}</div>
              <div data-field="relevant_experience_range"><div className="field field-with-header-action"><div className="field-label-line"><label>Relevant Experience Range</label><button type="button" className="mini-inline-action bounceable" disabled={editingLocked} onClick={matchRelevantExperienceRange}>Same</button></div><SelectField label="" value={item.relevant_experience_range || ''} options={EXPERIENCE_RANGE_OPTIONS} onChange={(value) => patch({ relevant_experience_range: value })} disabled={editingLocked} invalid={invalidFields.includes('relevant_experience_range')} /></div></div>

              <div className={`field ${(invalidFields.includes('ctc_monthly') || liveSalaryInvalid || salaryInputError) ? 'invalid-field live-invalid-field' : ''}`.trim()} data-field="ctc_monthly"><label>CTC Monthly</label><input className={(invalidFields.includes('ctc_monthly') || liveSalaryInvalid || salaryInputError) ? 'invalid-input live-invalid-input' : ''} value={item.ctc_monthly || ''} onChange={(e) => handleSalaryFieldChange('ctc_monthly', e.target.value, 'CTC Monthly')} onBeforeInput={(e) => handleSalaryBeforeInput(e, 'CTC Monthly')} onPaste={(e) => handleSalaryPaste(e, 'CTC Monthly')} inputMode="numeric" pattern="[0-9]*" disabled={editingLocked} />{salaryInputError ? <div className="helper-text top-gap-small live-validation-text">{salaryInputError}</div> : liveSalaryInvalid ? <div className="helper-text top-gap-small live-validation-text">{salaryGuardText}</div> : null}</div>
              <div className={`field ${(invalidFields.includes('in_hand_salary') || liveSalaryInvalid || salaryInputError) ? 'invalid-field live-invalid-field' : ''}`.trim()} data-field="in_hand_salary"><label>In-hand Monthly Salary</label><input className={(invalidFields.includes('in_hand_salary') || liveSalaryInvalid || salaryInputError) ? 'invalid-input live-invalid-input' : ''} value={item.in_hand_salary || ''} onChange={(e) => handleSalaryFieldChange('in_hand_salary', e.target.value, 'In-hand Monthly Salary')} onBeforeInput={(e) => handleSalaryBeforeInput(e, 'In-hand Monthly Salary')} onPaste={(e) => handleSalaryPaste(e, 'In-hand Monthly Salary')} inputMode="numeric" pattern="[0-9]*" disabled={editingLocked} />{salaryInputError ? <div className="helper-text top-gap-small live-validation-text">{salaryInputError}</div> : liveSalaryInvalid ? <div className="helper-text top-gap-small live-validation-text">{salaryGuardText}</div> : null}</div>
              <div data-field="relevant_in_hand_range"><div className="field field-with-header-action"><div className="field-label-line"><label>In-hand Salary Range</label><button type="button" className="mini-inline-action bounceable" disabled={editingLocked} onClick={matchSalaryRange}>Same</button></div><SelectField label="" value={item.relevant_in_hand_range || ''} options={SALARY_RANGE_OPTIONS} onChange={(value) => patch({ relevant_in_hand_range: value })} disabled={editingLocked} invalid={invalidFields.includes('relevant_in_hand_range')} /></div></div>

              <div data-field="career_gap"><ChoiceField label="Career Gap" value={item.career_gap || 'Fresher'} options={CAREER_GAP_OPTIONS} onChange={(value) => patch({ career_gap: value })} disabled={editingLocked} invalid={invalidFields.includes('career_gap')} strictOptions /></div>
              <div data-field="documents_availability"><ChoiceField label="All Documents Availability" value={normalizeDocumentsAvailability(item.documents_availability || 'Yes')} options={DOCUMENTS_OPTIONS} onChange={(value) => patch({ documents_availability: value })} disabled={editingLocked} invalid={invalidFields.includes('documents_availability')} showAll strictOptions /></div>
              <div data-field="communication_skill"><ChoiceField label="Communication Skill" value={item.communication_skill || 'Average'} options={COMMUNICATION_SKILL_OPTIONS} onChange={(value) => patch({ communication_skill: value })} disabled={editingLocked} invalid={invalidFields.includes('communication_skill')} /></div>

              <div className="field field-followup-panel" data-field="follow_up_at"><label>Follow-up</label><input type="datetime-local" value={toDateTimeLocalInput(item.follow_up_at || '')} onChange={(e) => patch({ follow_up_at: e.target.value, follow_up_status: e.target.value ? 'Open' : '' })} disabled={editingLocked} /><div className="choice-chip-row compact-row top-gap-small followup-preset-row">{safeArray(FOLLOW_UP_PRESETS).map((preset) => <button key={preset.label} type="button" className="choice-chip bounceable" disabled={editingLocked} onClick={() => applyFollowUpPreset(preset)}>{preset.label}</button>)}<button type="button" className="choice-chip bounceable" disabled={editingLocked} onClick={() => patch({ follow_up_at: '', follow_up_status: '', follow_up_note: '' })}>Clear</button></div><div className="field-subnote-title top-gap-small">Follow-up Notes</div><textarea rows="3" className="followup-note-textarea" value={item.follow_up_note || ''} onChange={(e) => patch({ follow_up_note: e.target.value })} disabled={editingLocked} placeholder="Mention follow-up note so the reminder also shows it." /></div>
              <div className={`field ${invalidFields.includes('interview_reschedule_date') ? 'invalid-field' : ''}`.trim()} data-field="interview_reschedule_date"><label>Interview Date</label><div className="weekday-date-wrap"><input type="date" value={selectedDate} onChange={(e) => patch({ interview_reschedule_date: e.target.value })} disabled={editingLocked} /></div><div className="weekday-shortcuts">{WEEKDAY_CHOICES.map((day) => <button key={day} type="button" className="weekday-chip bounceable" disabled={editingLocked} onClick={() => patch({ interview_reschedule_date: nextDateForWeekday(day) })}>{day.slice(0, 3)}</button>)}</div><div className="row-actions top-gap-small"><button className="ghost-btn bounceable" type="button" onClick={() => (canDirectRemoveInterview ? removeInterviewDateDirectly() : setRemoveInterviewOpen(true))} disabled={editingLocked || !item?.interview_reschedule_date}>{canDirectRemoveInterview ? 'Remove' : 'Request Remove'}</button>{String(item?.interview_remove_status || '').toLowerCase() === 'pending' && <span className="helper-text">Removal request pending.</span>}</div></div>
              <div data-field="virtual_onsite"><SelectField label="Interview Mode" value={item.virtual_onsite || 'Walkin'} options={INTERVIEW_MODE_OPTIONS} onChange={(value) => patch({ virtual_onsite: value })} disabled={editingLocked} invalid={invalidFields.includes('virtual_onsite')} /></div>

              <div data-field="status"><div className="cc701-status-shell"><ChoiceField label="Status" value={detailStatusValue} options={STATUS_OPTIONS} onChange={(value) => patch({ status: value })} disabled={editingLocked && !leadership} invalid={invalidFields.includes('status')} showAll strictOptions />{item.status && !currentApprovedStatus ? <span className="helper-text">Existing status: {safeText(item.status)}</span> : null}</div></div>
              <div data-field="profile_priority"><ChoiceField label="Priority" value={item.profile_priority || 'Medium'} options={PROFILE_PRIORITY_OPTIONS} onChange={(value) => patch({ profile_priority: value })} disabled={editingLocked} showAll strictOptions /></div>
              <div data-field="all_details_sent"><ChoiceField label="All Details Sent" value={detailDetailsSentValue} options={DETAILS_SENT_OPTIONS} onChange={handleDetailsSentChange} disabled={editingLocked && !leadership} invalid={invalidFields.includes('all_details_sent')} showAll disabledOptions={detailsCompletionLocked ? ['Completed'] : []} />{detailsCompletionLocked ? <div className="helper-text top-gap-small">Completed lock: Completed can be marked only 15 minutes after profile submission{detailsLockInfo.remainingMinutes ? ` (${detailsLockInfo.remainingMinutes} min left)` : ''}.</div> : null}</div>
              <div className={`field ${invalidFields.includes('submission_date') ? 'invalid-field' : ''}`.trim()} data-field="submission_date"><label>Submission Date</label><input className={invalidFields.includes('submission_date') ? 'invalid-input' : ''} type="datetime-local" value={detailSubmissionDateValue} onChange={(e) => patch({ submission_date: e.target.value })} disabled={editingLocked} /><div className="row-actions top-gap-small"><button className="ghost-btn bounceable today-inline-btn" type="button" disabled={editingLocked} onClick={() => patch({ submission_date: nowDateTimeLocal() })}>Now</button><span className="helper-text">{item.submission_date ? formatTwelveHour(item.submission_date) : 'Select submission date before submit.'}</span></div></div>
            </div>

            <div className="candidate-form-grid candidate-sequence-grid candidate-two-col-row top-gap-small">
              <div className="field" data-field="client"><label>Client</label><input value={item.client || ''} onChange={(e) => patch({ client: e.target.value })} disabled={editingLocked} placeholder="Client / Company" /></div>
              <div className="field" data-field="process"><MultiChoiceField label="Process" value={item.process || ''} options={processOptions} onChange={(value) => patch({ process: value })} onAddNew={addNewProcessOption} disabled={editingLocked} invalid={invalidFields.includes('process')} strictOptions /></div>
            </div>

            <SafeSectionBoundary title="Notes Chat">
            <div className={`panel top-gap-small candidate-notes-chat-panel ${noteRequiredError ? 'note-required-error' : ''}`.trim()} data-field="master_notes" ref={notesPanelRef}>
              <div className="panel-heading-row">
                <div>
                  <div className="panel-title">Notes Chat</div>
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
              {noteRequiredError ? (
                <div className="note-required-banner" role="alert">
                  Note required before Submit. यहाँ लिखें कि candidate के साथ क्या हुआ / क्या update है. फिर Submit दबाएँ. आपकी बाकी profile details पहले ही safe save हैं.
                </div>
              ) : null}
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
                    rows="6"
                    className="candidate-notes-main-textarea"
                    value={noteBody}
                    onChange={(e) => {
                      setNoteBody(e.target.value);
                      if (e.target.value.trim()) {
                        setNoteRequiredError(false);
                        setSubmissionIssues((current) => (current || []).filter((line) => !String(line || '').toLowerCase().includes('note required')));
                      }
                    }}
                    placeholder={replyContext ? 'Type reply. Save will save the reply automatically.' : 'Type note. Save or Submit will save it automatically.'}
                  />
                </div>
              </div>
              {visibleNotes.length ? <div className="candidate-notes-thread-list top-gap-small">
                {visibleNotes.map((thread) => renderNoteThread(thread, false))}
              </div> : null}
            </div>
            </SafeSectionBoundary>
          </div>

          <div className="row-actions top-gap">
            <button className="ghost-btn bounceable candidate-action-btn candidate-reset-btn" type="button" onClick={resetFilledDetails} disabled={Boolean(actionBusy)}>Reset</button>
            <button className="add-profile-btn bounceable candidate-action-btn candidate-check-jd-btn" type="button" onClick={checkJdFit} disabled={Boolean(actionBusy)}>{'Check JD'}</button>
            <button className="add-profile-btn bounceable candidate-action-btn candidate-submit-btn" type="button" onClick={submitForApproval} disabled={submissionLocked || Boolean(actionBusy)}>{submitButtonLabel}</button>
            <button className="add-profile-btn bounceable candidate-action-btn candidate-save-btn" type="button" onClick={save} disabled={Boolean(actionBusy && actionBusy !== 'save')} style={{ minWidth: 92, paddingInline: 18 }}>Save</button>
            {!!message && <span className={`helper-text sync-message ${syncState === 'error' ? 'is-error' : syncState === 'saved' ? 'is-success' : ''}`}>{message}</span>}
          </div>
          {submissionIssues.length ? <div className="top-gap-small">{submissionIssues.map((issue, index) => <div key={`submit-issue-${index}`} className="helper-text sync-message is-error">{issue}</div>)}</div> : null}

          <SafeSectionBoundary title="Candidate Files">
          <div className="panel top-gap-small candidate-files-panel">
            <div className="panel-heading-row">
              <div>
                <div className="panel-title">Candidate Files</div>
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
            ) : null}
          </div>
          </SafeSectionBoundary>

          <SafeSectionBoundary title="Timeline">
          <div className="panel top-gap-small candidate-timeline-panel">
            <div className="panel-heading-row">
              <div>
                <div className="panel-title">Timeline</div>
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
              )) : <div className="helper-text">Timeline starts as soon as this profile gets activity.</div>}
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
                <div className="helper-text top-gap-small">{jdSuggestionPopup.label || 'Match Signal'} • {jdSuggestionPopup.score || 0}% match score. Open one JD, open all JDs, or send the best fit on WhatsApp from here.</div>
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
            <div className="helper-text top-gap-small">Open JD for the full brief. Send pushes the first ready WhatsApp asset instantly.</div>
          </div>
        </div>
        </SafeSectionBoundary>
      ) : null}

      {removeInterviewOpen && !canDirectRemoveInterview && (
        <div className="crm-modal-backdrop" onClick={() => setRemoveInterviewOpen(false)}>
          <div className="crm-premium-modal task-premium-modal task-modal-no-overlap interview-remove-modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-title">Request Interview Date Removal</div>
            <div className="helper-text top-gap-small">Removal requires approval. Add context for TL or Manager review.</div>
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
    <CandidateProfileErrorBoundary candidateId={candidateId}>
      <CandidateDetailPageInner />
    </CandidateProfileErrorBoundary>
  );
}


// CC26_561: +30% mouse-wheel speed while pointer is over the profile form only. No global scroll override.
(function(){
  if(typeof window==='undefined'||window.__cc561ProfileWheel)return;
  window.__cc561ProfileWheel=true;
  document.addEventListener('wheel',function(ev){
    if(ev.defaultPrevented||ev.ctrlKey||ev.metaKey||ev.altKey||ev.shiftKey||ev.deltaMode!==0||Math.abs(ev.deltaY)<16)return;
    const node=ev.target;
    if(!(node instanceof Element))return;
    if(node.closest('textarea,select,[role="listbox"],[role="dialog"],.cc560-quicknav-scroll,.candidate-notes-chat-panel,.candidate-files-panel'))return;
    const panel=node.closest('.candidate-detail-full-panel');if(!panel)return;
    const scroller=panel.closest('.page-scroll');if(!scroller||scroller.scrollHeight<=scroller.clientHeight)return;
    scroller.scrollTop+=Math.sign(ev.deltaY)*Math.min(90,Math.abs(ev.deltaY)*.30);
  },{passive:true});
})();
