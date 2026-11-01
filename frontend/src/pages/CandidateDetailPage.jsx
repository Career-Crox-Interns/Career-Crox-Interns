import {normalizeCandidateName} from '../lib/workspaceHelpers';
import { requestProfileDelete, normalizeCandidatePhoneInput } from '../lib/workspaceHelpers';
import DuplicatePhoneNotice from '../components/DuplicatePhoneNotice';
import { parseDateInput, crmYmd, toCrmDateTimeLocalInput } from '../lib/workspaceHelpers';
import { CrmDateTimeInput } from '../components/PremiumSelect';
import {readPageCache,writePageCache} from '../lib/persistentPageCache';
import {buildJdFitSummary,openJdShareDialog} from '../lib/workspaceHelpers';
import { ActionGlyph } from '../components/EmojiGlyph';
import PremiumSelect from '../components/PremiumSelect';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { stageCandidateSubmit, completeCandidateSubmit } from '../lib/candidateSubmitOutbox';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import ContactTextExtractor from '../components/ContactTextExtractor';
import { displayStaffName, api, cachePrincipal, reportWriteFailure } from '../lib/api';
import { appendCandidateNavContext, buildCandidateUrl, readCandidateNavContext, readCandidateInstantProfile, writeCandidateInstantProfile } from '../lib/candidateNav';
import { emitCandidateUpsert, onCandidateRealtime } from '../lib/realtimeProfileBridge';
import { useDashboardAuth as useAuth } from '../lib/auth';
import { addNoteTemplate, addWhatsAppTemplate, getNoteTemplates, getWhatsAppTemplates, loadSharedWhatsAppTemplates, editSharedWhatsAppTemplate } from '../lib/templateStore';
import { dialCandidateWithLog, openWhatsAppWithLog, visiblePhone } from '../lib/candidateAccess';
import { SafeSectionBoundary as SafeSectionBoundary } from '../components/RouteSafety';


// CC26_560: Jump within the existing profile. No fetch, reload, or new browser tab.
function cc560CandidateJump(section) {
  const root = document.querySelector('.candidate-detail-full-panel');
  if (!root) return;
  const special = { notes:'[data-field="master_notes"]',submission:'[data-field="all_details_sent"]',followup:'[data-field="follow_up_at"]',interview:'[data-field="interview_reschedule_date"]', files: '.candidate-files-panel', save: '.candidate-save-btn' };
  const selector = special[section] || `[data-field="${section}"]`;
  const target = root.querySelector(selector);
  if (!target) return;
  const highlight=target.closest('.cc790-field-section') || target;
  root.querySelectorAll('.cc790-jump-arrived').forEach(el=>el.classList.remove('cc790-jump-arrived'));
  highlight.classList.add('cc790-jump-arrived');
  root.querySelectorAll('.cc560-jump-btn').forEach(el=>el.classList.toggle('cc790-selected-jump',el.dataset.jump===section));
  target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });
  if(document.documentElement.dataset.cc787Motion!=='reduced'&&!matchMedia('(prefers-reduced-motion: reduce)').matches)highlight.animate([{transform:'scale(.99)'},{transform:'scale(1.012)'},{transform:'scale(1)'}],{duration:380,easing:'ease-out'});
  clearTimeout(highlight.__arrivalTimer);highlight.__arrivalTimer=setTimeout(()=>highlight.classList.remove('cc790-jump-arrived'),4000);
  const focusTarget = section === 'master_notes'
    ? target.querySelector('.candidate-notes-main-textarea')
    : target.matches('input, textarea, select') ? target
    : target.querySelector('input:not([readonly]):not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled])');
  if (focusTarget && section !== 'files' && section !== 'save') {
    try { focusTarget.focus({ preventScroll: true }); } catch (_) { focusTarget.focus(); }
  }
}

const CAREER_GAP_OPTIONS = ['Fresher', 'No Gap', 'Currently Working', '1 - 3 Month', '4 - 6 Month', '7 - 12 Month', '1 - 1.5 Year', '1.6 - 2 Year'];
const STATUS_OPTIONS = ['Draft', 'In - Progress', 'Not Interested', 'All set for Interview', 'Appeared in Interview', 'Selected', 'Joining Due', 'Joined', 'Backout', 'Completed 60 Days', 'Rejected once, needs new Interview', 'Rejected'];
function approvedStatusValue(value) {
  const current = safeText(value).trim();
  const mapped = current === 'Not Intrested' ? 'Not Interested' : current;
  return mapped === 'Approved' ? 'In - Progress' : (STATUS_OPTIONS.includes(mapped) ? mapped : '');
}
const WEEKDAY_CHOICES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CALL_CONNECTED_OPTIONS = ['No', 'Yes', 'Partially'];
const DETAIL_AUTO_CONNECT_IGNORE_FIELDS = new Set(['call_connected', 'recruiter_code', 'recruiter_name', 'recruiter_designation', 'data_uploading_date', 'source_sr_no', 'last_viewed_at', 'last_viewed_by_name', 'approval_status', 'status', 'all_details_sent', 'submission_date', 'approved_at', 'approved_by_name']);
const LOOKING_FOR_JOB_OPTIONS = ['Yes', 'No'];
const PROFILE_PRIORITY_OPTIONS = ['High', 'Medium', 'Low'];
const DEGREE_OPTIONS = ['Graduate', 'NON - Graduate'];
const DETAILS_SENT_OPTIONS = ['Pending', 'Completed', 'Only Resume Pending'];
const PROFILE_START_DEFAULTS = Object.freeze({
  preferred_location: 'Gurgaon',
  qualification_level: 'Graduate',
  career_gap: 'Fresher',
  communication_skill: 'Good',
  profile_priority: 'Medium',
  virtual_onsite: 'Walkin',
  documents_availability: 'Yes',
  looking_for_job: 'Yes',
  all_details_sent: 'Pending',
});
const COMMUNICATION_SKILL_OPTIONS = ['Excellent', 'Good', 'Normal', 'Average', 'Below Average'];
const EXPERIENCE_RANGE_OPTIONS = ['Fresher', '1 - 3 Month', '4 - 6 Month', '7 - 12 Month', '1 - 1.5 Year', '1.6 - 2 Year', '2 - 2.5 Year', '2.6 - 3 Year', '3 - 3.5 Year', '3.6 - 4 Year', '4 - 4.5 Year', '4.6 - 5 Year', '5+ Year'];
const SALARY_RANGE_OPTIONS = ['0', '₹1K - ₹15K', '₹16K - ₹20K', '₹21K - ₹25K', '₹26K - ₹30K', '₹31K - ₹35K', '₹35K - ₹50K', '₹50K+'];
const PREFERRED_LOCATIONS = ['Noida', 'Gurgaon', 'Mumbai'];
const PREFERRED_LOCATION_STORAGE_KEY = 'careerCroxPreferredLocations_v3';
const INTERVIEW_MODE_OPTIONS = ['Virtual', 'Walkin'];
const DOCUMENTS_OPTIONS = ['Yes', 'No', 'Partially'];

const GLOBAL_CANDIDATE_PROFILE_CACHE = {};
const GLOBAL_CANDIDATE_PROFILE_CACHE_KEYS = [];
window.addEventListener('career-crox-access-changed', () => { for (const key of Object.keys(GLOBAL_CANDIDATE_PROFILE_CACHE)) delete GLOBAL_CANDIDATE_PROFILE_CACHE[key]; GLOBAL_CANDIDATE_PROFILE_CACHE_KEYS.length=0; });
window.addEventListener('career-crox-account-changed', () => { for (const key of Object.keys(GLOBAL_CANDIDATE_PROFILE_CACHE)) delete GLOBAL_CANDIDATE_PROFILE_CACHE[key]; GLOBAL_CANDIDATE_PROFILE_CACHE_KEYS.length = 0; });
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
    return body ? { title, body, ...(raw.id?{id:raw.id}:{}), ...(raw.revision?{revision:raw.revision}:{}) } : null;
  }
  const body = safeText(raw || '').trim();
  if (!body) return null;
  const title = body.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.replace(/^[^\w{]+/, '').slice(0, 42) || `WhatsApp Preset ${index + 1}`;
  return { title, body, ...(raw?.id?{id:raw.id}:{}), ...(raw?.revision?{revision:raw.revision}:{}) };
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
  'full_name','phone','location','email','preferred_location','qualification_level','qualification','course_name','last_working_date','project_id','total_experience','relevant_experience',
  'relevant_experience_range','career_gap','ctc_monthly','in_hand_salary','relevant_in_hand_range','documents_availability',
  'virtual_onsite','interview_reschedule_date','follow_up_at','communication_skill','profile_priority','status','all_details_sent','submission_date',
  'process','client','call_connected','looking_for_job','master_notes'
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
  return `${CANDIDATE_DRAFT_STORAGE_PREFIX}${cachePrincipal()}:${String(candidateId || '').trim()}`;
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

function writeCandidateDraftSnapshot(candidateId, item, baseline = null) {
  const key = String(candidateId || '').trim();
  if (!key || !item) return;
  try {
    const previous = readCandidateDraftSnapshot(key) || {};
    const base = previous.baseSnapshot || baseline || (key === 'new' || key.startsWith('new:') ? {} : item);
    const fields = sanitizeCandidatePayload(item);
    const editedFields = {};
    for (const [field,value] of Object.entries(fields)) {
      if (['candidate_id','updated_at','last_viewed_at','last_viewed_by_name'].includes(field)) continue;
      if (String(value ?? '') !== String(base[field] ?? '')) editedFields[field] = value;
    }
    localStorage.setItem(candidateDraftStorageKey(key), JSON.stringify({ ...previous,
      candidateId:key, principal:cachePrincipal(), editedAt:Date.now(), item:fields,
      baseSnapshot:base, editedFields }));
  } catch {}
}
function restoreEditedDraft(server, draft) {
  if (!draft) return server;
  const edited = draft.editedFields || draft.item || {};
  const safe = { ...edited };
  for (const field of ['approval_status','approval_requested_at','approved_at','approved_by_name','submission_id','submission_exists','submitted_at']) delete safe[field];
  return ensureCandidateDefaults({ ...server, ...safe });
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
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const months = Number(raw.replace(/[^\d.]/g, '')) || 0;
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
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const amount = Number(raw.replace(/[^\d.]/g, '')) || 0;
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
  return normalizeCandidatePhoneInput(value);
}

function normalizeQualificationCategory(value, fallbackQualification = '') {
  const rawValue = String(value || '').trim();
  const rawFallback = String(fallbackQualification || '').trim();
  if (!rawValue && !rawFallback) return '';
  const current = rawValue.toLowerCase();
  if (current === 'non - graduate' || current === 'non-graduate' || current === 'nongraduate') return 'NON - Graduate';
  if (/^post[\s-]*graduate$/.test(current)) return 'Postgraduate';
  if (current === 'graduate') return 'Graduate';
  const combined = `${rawValue} ${rawFallback}`.trim().toLowerCase();
  if (!rawValue && /\b(post[\s-]*grad|mba|mca|m\.?sc|m\.?com|m\.?tech|phd|master)\b/i.test(rawFallback)) return 'Postgraduate';
  if (/(^|\b)(non[\s-]*grad|under[\s-]*grad|undergraduate|ug pursuing|pursuing|appearing|final year|last year|12th|10th|intermediate|higher secondary|hsc|diploma|iti)(\b|$)/i.test(combined)) return 'NON - Graduate';
  if (/(^|\b)(post[\s-]*grad|graduate|b\.?a|b\.?com|b\.?sc|b\.?tech|btech|bca|bba|mba|mca|m\.?a|m\.?com|m\.?sc|mtech|m\.?tech|phd|master|bachelor)(\b|$)/i.test(combined)) return 'Graduate';
  return '';
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

function canonicalPreferredLocationValue(value, allowedOptions = []) {
  const allowed = safeArray(allowedOptions)
    .map((item) => safeText(item).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const allowedMap = new Map(allowed.map((item) => [item.toLowerCase(), item]));
  const selected = [];
  for (const rawPart of splitMulti(value)) {
    const key = String(rawPart || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const canonical = allowedMap.get(key);
    if (canonical && !selected.includes(canonical)) selected.push(canonical);
  }
  return selected.join(', ');
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

function preferredLocationPresets() {
  let usage={};
  try { usage=JSON.parse(localStorage.getItem(`cc787:location-use:${cachePrincipal()}`)||'{}'); } catch {}
  // Only the three built-in quick choices stay on the front. Any user-added
  // location is shared permanently, but is shown inside the dropdown only.
  return [...PREFERRED_LOCATIONS].sort((a,b)=>(Number(usage[b])||0)-(Number(usage[a])||0));
}
function rememberPreferredLocationUse(value) {
  try { const key=`cc787:location-use:${cachePrincipal()}`,usage=JSON.parse(localStorage.getItem(key)||'{}'); for(const option of splitMulti(value)) usage[option]=(Number(usage[option])||0)+1; localStorage.setItem(key,JSON.stringify(usage)); } catch {}
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

function localDateOnlyFromDate(date) {return crmYmd(date); }

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

function nowDateTimeLocal(date=new Date()) {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const value=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}

function sleepMs(ms = 0) {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function addMinutesDateTimeLocal(minutes=0){return nowDateTimeLocal(new Date(Date.now()+Number(minutes||0)*60000));}
function tomorrowAt(hour=10,minute=0){const d=new Date(nowDateTimeLocal().slice(0,10)+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)+'T'+pad2(hour)+':'+pad2(minute);}

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
  return value ? toCrmDateTimeLocalInput(value) : '';
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
  const remainingMinutes = Math.max(0, Math.ceil((10 * 60000 - elapsedMs) / 60000));
  return { locked: elapsedMs < 10 * 60000, remainingMinutes };
}

function formatTwelveHour(value) {
  const local = toDateTimeLocalInput(value);
  if (!local) return '';
  const [datePart, timePart] = local.split('T');
  const [year, month, day] = datePart.split('-');
  let [hours, minutes] = timePart.split(':').map(Number);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day}-${month}-${year} ${hours}:${pad2(minutes)} ${suffix}`;
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
  if (String(item?.phone ?? '').trim() && !/^[0-9]+$/.test(normalizeIndianPhone(item.phone))) {
    issues.push('Phone number can contain digits only.');
    missingKeys.push('phone');
  }
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
  return Boolean(safeText(source.submission_id || source.approval_requested_at || source.submitted_at || '').trim());
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

function candidateProfileWorkStarted(source = {}) {
  const row = source && typeof source === 'object' ? source : {};
  if (safeText(row.last_updated_at || '').trim()) return true;
  const status = safeText(row.status || '').trim().toLowerCase();
  const approval = safeText(row.approval_status || '').trim().toLowerCase();
  if (status && status !== 'draft') return true;
  if (approval && approval !== 'draft') return true;
  if (safeText(row.call_connected || '').trim()) return true;
  if (safeText(row.process || '').trim()) return true;
  if (safeText(row.follow_up_at || '').trim()) return true;
  if (safeText(row.interview_reschedule_date || row.interview_date || '').trim()) return true;
  if (safeText(row.submission_id || row.approval_requested_at || row.submitted_at || '').trim()) return true;
  return ['total_experience','relevant_experience','ctc_monthly','in_hand_salary','relevant_experience_range','relevant_in_hand_range']
    .some((key) => {
      const value = safeText(row[key] ?? '').trim();
      return value !== '' && value !== '0' && value.toLowerCase() !== 'fresher';
    });
}

function blankLegacyConvenienceDefaults(source = {}) {
  const row = { ...(source || {}) };
  if (candidateProfileWorkStarted(row)) return row;
  // Preferred Location on untouched legacy rows could even contain Current Location text,
  // because old bulk-import code copied location -> preferred_location. Keep it blank until work starts.
  row.preferred_location = '';
  const synthetic = {
    qualification_level: new Set(['graduate']),
    career_gap: new Set(['fresher']),
    communication_skill: new Set(['average','good']),
    profile_priority: new Set(['medium']),
    virtual_onsite: new Set(['walkin']),
    documents_availability: new Set(['yes']),
    looking_for_job: new Set(['yes']),
    all_details_sent: new Set(['pending']),
  };
  Object.entries(synthetic).forEach(([key, values]) => {
    const current = safeText(row[key] || '').trim().toLowerCase();
    if (current && values.has(current)) row[key] = '';
  });
  if (['fresher'].includes(safeText(row.relevant_experience_range || '').trim().toLowerCase())) row.relevant_experience_range = '';

  row.submission_date = safeText(row.submission_date || '').trim();
  return row;
}

function applyProfileStartDefaults(source = {}, patch = {}) {
  const current = { ...(source || {}) };
  if (candidateProfileWorkStarted(current)) return current;
  const next = { ...current };
  Object.entries(PROFILE_START_DEFAULTS).forEach(([key, value]) => {
    if (!safeText(next[key] || '').trim()) next[key] = value;
  });
  // Salary and experience are intentionally NOT defaulted. They stay blank until the employee enters them.
  ['total_experience','relevant_experience','ctc_monthly','in_hand_salary','relevant_experience_range','relevant_in_hand_range','submission_date']
    .forEach((key) => { if (!Object.prototype.hasOwnProperty.call(patch || {}, key) && !safeText(next[key] || '').trim()) next[key] = ''; });
  return next;
}

function profileCareerGap(row = {}) {
  const experienced = parseMonthCount(row.total_experience) > 0 || parseMonthCount(row.relevant_experience) > 0;
  return experienced && (!row.career_gap || String(row.career_gap).trim().toLowerCase()==='fresher') ? 'No Gap' : (row.career_gap || '');
}
function submissionStampForCommit(row, intent, text) {
  if (['1','true'].includes(String(row?.__cc801_submission_date_manual).toLowerCase()) || row?.submission_id || row?.approval_requested_at) return String(row?.submission_date || '').trim() || nowDateTimeLocal();
  try {
    const previous=JSON.parse(intent?.signature || 'null');
    if(previous?.action==='submit' && String(previous.note?.body || '')===text
      && Object.entries(previous.fields || {}).every(([key,value]) => key.startsWith('_') || key==='submission_date' || String(row?.[key] ?? '')===String(value ?? '')))
      return previous.fields.submission_date || nowDateTimeLocal();
  } catch {}
  return nowDateTimeLocal();
}
function todayWeekday() {return new Intl.DateTimeFormat('en-US',{weekday:'long',timeZone:'Asia/Kolkata'}).format(new Date());}

function ensureCandidateDefaults(source) {
  if (!source) return source;
  // CC26_766: every candidate scalar is sanitized before JSX. A legacy/imported
  // object in ANY candidate column must not crash the whole profile after Submit.
  source = blankLegacyConvenienceDefaults(sanitizeCandidateItem(source));
  for (const key of CANDIDATE_VISIBLE_TEXT_FIELDS) {
    if (source[key] !== null && source[key] !== undefined && typeof source[key] !== 'string') source[key] = safeText(source[key]);
  }
  // Durable drafts can serialize false as "false". Treat only an explicit true
  // flag as redacted, otherwise an old phone_masked value replaces pasted edits.
  const phoneRedacted = /^(true|1|yes)$/i.test(String(source.phone_redacted ?? '').trim());
  const safePhone = phoneRedacted ? String(source.phone_masked || source.phone || '') : normalizeIndianPhone(source.phone || '');
  const approval = String(source.approval_status || 'Draft').trim().toLowerCase();
  const submittedFlow = hasRealSubmittedWorkflow(source, approval);
  return {
    ...source,
    phone: safePhone,
    phone_redacted: phoneRedacted,
    phone_masked: phoneRedacted ? String(source.phone_masked || safePhone) : safePhone,
    // CC85: Values shown as selected in the form must also exist in its model.
    // Previously Good / Graduate / Walkin / Yes appeared selected by JSX fallbacks
    // while validation saw empty strings, forcing employees to toggle away/back.
    // Never manufacture salaries, experience, dates, contact data or process choices.
    communication_skill: source.communication_skill || PROFILE_START_DEFAULTS.communication_skill,
    total_experience: source.total_experience == null ? '' : source.total_experience,
    relevant_experience: source.relevant_experience == null ? '' : source.relevant_experience,
    ctc_monthly: source.ctc_monthly == null ? '' : source.ctc_monthly,
    in_hand_salary: source.in_hand_salary == null ? '' : source.in_hand_salary,
    relevant_experience_range: source.relevant_experience_range || (String(source.relevant_experience ?? '').trim() ? expRange(source.relevant_experience) : ''),
    relevant_in_hand_range: source.relevant_in_hand_range || (String(source.in_hand_salary ?? '').trim() ? salaryRange(source.in_hand_salary) : ''),
    call_connected: source.call_connected || '',
    preferred_location: Object.prototype.hasOwnProperty.call(source,'preferred_location')?source.preferred_location:PROFILE_START_DEFAULTS.preferred_location,
    qualification_level: source.qualification_level ? normalizeQualificationCategory(source.qualification_level || source.degree || '', source.qualification || '') : PROFILE_START_DEFAULTS.qualification_level,
    career_gap: profileCareerGap(source) || PROFILE_START_DEFAULTS.career_gap,
    status: source.status || (submittedFlow ? (approval === 'approved' ? 'Approved' : approval === 'rejected' ? 'Rejected' : 'In - Progress') : 'Draft'),
    profile_priority: source.profile_priority || PROFILE_START_DEFAULTS.profile_priority,
    all_details_sent: source.all_details_sent || PROFILE_START_DEFAULTS.all_details_sent,
    virtual_onsite: /^(onsite|on-site|walk[ -]?in)$/i.test(source.virtual_onsite || '') ? 'Walkin' : (source.virtual_onsite || PROFILE_START_DEFAULTS.virtual_onsite),
    documents_availability: source.documents_availability ? normalizeDocumentsAvailability(source.documents_availability) : PROFILE_START_DEFAULTS.documents_availability,
    looking_for_job: source.looking_for_job || PROFILE_START_DEFAULTS.looking_for_job,
    submission_date: toDateTimeLocalInput(source.submission_date || ''),
    __cc801_submission_date_manual: source.__cc801_submission_date_manual !== undefined ? (['1','true'].includes(String(source.__cc801_submission_date_manual).toLowerCase()) ? '1' : '0') : (source.submission_date && !source.submission_id && !source.approval_requested_at ? '1' : '0'),
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
  if(payload.full_name!==undefined)payload.full_name=normalizeCandidateName(payload.full_name);
  delete payload._edit_base_json;
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
  const principal=String(note?.user_id||note?.created_by_user_id||note?.username||'').trim();
  return displayStaffName(principal,note?.full_name||note?.created_by_name||note?.username||'Someone');
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
    .sort(asc)
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
    const actor = String(row?.full_name||row?.employee_name||'').trim() || displayStaffName(row?.user_id||row?.username,'Team member');
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
function PhoneIcon() { return <ActionGlyph kind="phone"/>; }
function WhatsAppIcon() { return <ActionGlyph kind="whatsapp"/>; }

function CelebrationBurst({ active }) {
  if (!active) return null;
  return (
    <div className="celebration-burst" aria-hidden="true">
      {Array.from({ length: 18 }).map((_, idx) => <span key={idx} className={`confetti-piece p${idx % 6}`} />)}
    </div>
  );
}

function SelectField({ label, value, options, onChange, disabled = false, invalid = false, disabledOptions = [], strictOptions = false, optionLabel = (option) => option }) {
  const normalized = strictOptions ? [...new Set(safeArray(options).map((option) => safeText(option).trim()).filter(Boolean))] : stableOptions(options, value);
  const locked = new Set(disabledOptions);
  return <div className={`field cc783-select-field ${invalid ? 'invalid-field' : ''}`}>
    {label ? <label>{label}</label> : null}<PremiumSelect aria-label={label || 'Recruiter Name - Code'} aria-invalid={invalid || undefined} value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {!normalized.includes(String(value || '')) ? <option value={value || ''}>{value || 'Choose…'}</option> : null}
      {normalized.map((option) => <option key={option} value={option} disabled={locked.has(option)}>{optionLabel(option)}</option>)}
    </PremiumSelect>
  </div>;
}
function ChoiceField(props) {
  const { label, value, options, onChange, disabled = false, compact = false, invalid = false, disabledOptions = [], strictOptions = false, optionLabel = (option) => option } = props;
  const normalizedOptions = strictOptions ? [...new Set(safeArray(options).map((option) => safeText(option).trim()).filter(Boolean))] : stableOptions(options, value);
  if (normalizedOptions.length > 3) return <SelectField {...props} />;
  const current = String(value || '').trim();
  return <div className={`field visible-choice-field ${compact ? 'compact-field' : ''} ${invalid ? 'invalid-field' : ''}`}>
    {label ? <label>{label}</label> : null}<div className="choice-chip-row compact-row" role="group" aria-label={label || 'Available choices'} aria-invalid={invalid || undefined}>
      {normalizedOptions.map((option) => <button key={option} type="button" disabled={disabled || disabledOptions.includes(option)} aria-pressed={current === option} className={`choice-chip bounceable ${current === option ? 'active' : ''}`} title={disabledOptions.includes(option) ? 'Locked by CRM rule' : undefined} onClick={() => onChange(option)}>{optionLabel(option)}</button>)}
    </div>
  </div>;
}
function cc793AnchoredPopupPosition(anchor, minWidth = 240, maxHeight = 300) {
  const rect = anchor?.getBoundingClientRect?.();
  if (!rect) return { left: 12, top: 12, width: minWidth, maxHeight: 220 };
  const viewportWidth = window.visualViewport?.width || window.innerWidth || 1280;
  const viewportHeight = window.visualViewport?.height || window.innerHeight || 720;
  const width = Math.min(Math.max(rect.width, minWidth), Math.max(220, viewportWidth - 24));
  const left = Math.max(12, Math.min(rect.left, viewportWidth - width - 12));
  const top = Math.max(12, rect.bottom + 5);
  const roomBelow = Math.max(96, viewportHeight - top - 12);
  return { left, top, width, maxHeight: Math.min(maxHeight, roomBelow) };
}

function cc793PrepareAnchorForBelowPopup(anchor, openPopup) {
  if (!anchor) { openPopup(); return; }
  const viewportHeight = window.visualViewport?.height || window.innerHeight || 720;
  const rect = anchor.getBoundingClientRect();
  // User requirement: menus must open BELOW their own field. If the field is
  // too close to the viewport bottom, reveal a little room first instead of
  // flipping the menu above it. This is local UI work only; no API/egress.
  if (viewportHeight - rect.bottom < 150) {
    anchor.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    window.requestAnimationFrame(openPopup);
    return;
  }
  openPopup();
}

function MultiChoiceField({ label, value, options, onChange, disabled = false, invalid = false, keepOneSelected = false, onAddNew = null, strictOptions = false, presets = [] }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12, width: 280, maxHeight: 280 });
  const popup = useRef(null);
  const menuRef = useRef(null);
  const selected = splitMulti(value);
  const baseOptions = safeArray(options).map((option) => safeText(option).trim()).filter(Boolean);
  const mergedOptions = strictOptions ? [...new Set(baseOptions)] : [...new Set([...baseOptions, ...selected])];
  const trigger = () => popup.current?.querySelector('summary');
  const refreshPosition = () => setPosition(cc793AnchoredPopupPosition(trigger(), 260, 300));
  const openMenu = () => cc793PrepareAnchorForBelowPopup(trigger(), () => { refreshPosition(); setOpen(true); });
  const closeMenu = () => { setOpen(false); setSearch(''); };
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (popup.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      closeMenu();
    };
    const reposition = () => refreshPosition();
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('scroll', reposition, true);
    };
  }, [open]);
  useEffect(() => { if (disabled) closeMenu(); }, [disabled]);
  return <div className={`field cc783-multi-field ${invalid ? 'invalid-field' : ''}`}>
    <div className="field-label-line"><label>{label}</label>{onAddNew ? <button type="button" disabled={disabled} className="mini-inline-action bounceable" onClick={onAddNew}>+ Add New</button> : null}</div>
    {presets.length ? <div className="choice-chip-row cc787-location-presets" role="group" aria-label={`${label} quick choices`}>{presets.slice(0,3).map(option=><button key={option} type="button" className={`choice-chip ${selected.includes(option)?'active':''}`} aria-pressed={selected.includes(option)} disabled={disabled} onClick={()=>onChange(toggleMultiValue(value,option,keepOneSelected))}>{option}</button>)}</div> : null}
    <details ref={popup} className="cc783-multi-select cc793-portal-select" open={open} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); trigger()?.focus({ preventScroll: true }); } }}>
      <summary aria-label={label} aria-disabled={disabled} aria-expanded={open} onClick={(e) => { e.preventDefault(); if (disabled) return; open ? closeMenu() : openMenu(); }}><span>{selected.join(', ') || 'Choose…'}</span><span aria-hidden="true">⌄</span></summary>
    </details>
    {open ? createPortal(<div ref={menuRef} className="cc783-select-popup cc793-floating-select-popup cc793-multi-popup" style={{ '--cc793-left': `${position.left}px`, '--cc793-top': `${position.top}px`, '--cc793-width': `${position.width}px`, '--cc793-max-height': `${position.maxHeight}px` }} role="dialog" aria-label={`${label} options`}>
      <input aria-label={`Search ${label}`} placeholder="Type to search…" value={search} onChange={(e) => setSearch(e.target.value)} disabled={disabled} autoFocus />
      <div className="cc783-select-options">{mergedOptions.filter((option) => option.toLowerCase().includes(search.toLowerCase())).map((option) => <label key={option}><input type="checkbox" checked={selected.includes(option)} disabled={disabled} onChange={() => onChange(toggleMultiValue(value, option, keepOneSelected))}/><span>{option}</span></label>)}</div>
      <button type="button" className="ghost-btn" onClick={() => { closeMenu(); trigger()?.focus({ preventScroll: true }); }}>Done{selected.length ? ` · ${selected.length} selected` : ''}</button>
    </div>, document.body) : null}
  </div>;
}
function LiveSubmissionDateField({ storedValue = '', submitted = false, manual = false, invalid = false, onChange, disabled = false }) {
  const [liveValue, setLiveValue] = useState(() => new Date());
  const [editing, setEditing] = useState(false);
  useEffect(() => {const timer=window.setInterval(()=>setLiveValue(new Date()),1000);return()=>window.clearInterval(timer);},[]);
  const fixed = Boolean(storedValue && (submitted || manual));
  const shownValue = fixed ? toDateTimeLocalInput(storedValue) : nowDateTimeLocal();
  const liveText = new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true,timeZone:'Asia/Kolkata'}).format(liveValue);
  return <div className={`field cc792-live-submission ${invalid ? 'invalid-field' : ''}`} data-field="submission_date">
    <div className="field-label-line"><label>Submission Date</label><button type="button" className="mini-inline-action cc801-date-change" disabled={disabled} onClick={()=>setEditing(value=>!value)}>{editing ? 'Done' : 'Change'}</button></div>
    {editing ? <CrmDateTimeInput type="datetime-local" disabled={disabled} aria-label="Change submission date" value={shownValue} onChange={event=>onChange?.(event.target.value)} /> : null}
    <div className={`cc792-live-time-value ${fixed ? 'is-fixed' : 'is-live'}`}>{fixed ? formatTwelveHour(shownValue) : liveText}</div>
  </div>;
}

const COURSE_PRESETS = ['BCA','B.Tech','B.Sc','B.Com','BA','LLB','B.E','BBA','BBM','BMS','BFA','B.Arch','B.Des','B.Ed','B.P.Ed','B.Pharma','BPT','BHM','B.Voc','MBBS','BDS','BAMS','BHMS','B.Sc Nursing','B.Sc IT','B.Sc Computer Science','B.Sc Agriculture','B.Sc Biotechnology','B.Com (Hons)','BA (Hons)','B.Tech CSE','B.Tech ECE','B.Tech Mechanical','B.Tech Civil','BA LLB','BBA LLB','B.Com LLB','MBA','MCA','M.Tech','M.E','M.Sc','M.Com','MA','LLM','M.Ed','M.Pharma','MPT','M.Arch','PhD','Diploma','Polytechnic','ITI','12th','10th','CA','CS','CMA','Other'];
const courseKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function CourseComboField({ value, onChange, disabled, invalid, sortableProps={} }) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12, width: 300, maxHeight: 280 });
  const shell = useRef(null);
  const menuRef = useRef(null);
  const choices = COURSE_PRESETS.filter((course) => showAll || !value || courseKey(course).includes(courseKey(value)));
  const inputNode = () => shell.current?.querySelector('input');
  const refreshPosition = () => setPosition(cc793AnchoredPopupPosition(inputNode(), 260, 300));
  const openMenu = (all = false) => {
    setShowAll(all);
    setHighlighted(0);
    cc793PrepareAnchorForBelowPopup(inputNode(), () => { refreshPosition(); setOpen(true); });
  };
  const pick = (course) => { onChange(course); setOpen(false); };
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (shell.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const reposition = () => refreshPosition();
    document.addEventListener('pointerdown', close, true);
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('scroll', reposition, true);
    };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const option = menuRef.current?.querySelector(`#cc783-course-${highlighted}`);
    const list = menuRef.current;
    if (!option || !list) return;
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
  }, [open, highlighted]);
  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); event.stopPropagation();
      if (!open) openMenu(true);
      else setHighlighted((n) => choices.length ? (n + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length : 0);
    } else if (event.key === 'Enter' && open) {
      event.preventDefault(); event.stopPropagation();
      if (choices[highlighted]) pick(choices[highlighted]); else setOpen(false);
    } else if (event.key === 'Escape') { setOpen(false); event.stopPropagation(); }
    else if (event.key === 'Tab') setOpen(false);
  };
  return <div className={`field ${invalid ? 'invalid-field' : ''}`} data-field="qualification" {...sortableProps}><label>Course Name</label><div className="cc783-course-combo" ref={shell}>
    <input role="combobox" aria-label="Course Name" aria-autocomplete="list" aria-expanded={open} aria-controls="cc783-course-options" aria-activedescendant={open && choices[highlighted] ? `cc783-course-${highlighted}` : undefined} value={value || ''} disabled={disabled} onFocus={() => openMenu(false)} onChange={(e) => { const typed = e.target.value; onChange(COURSE_PRESETS.find((course) => courseKey(course) === courseKey(typed)) || typed); setShowAll(false); setHighlighted(0); if (!open) openMenu(false); }} onKeyDown={onKeyDown}/>
    <button type="button" aria-label="Show course choices" aria-expanded={open} disabled={disabled} onClick={() => { if (open) { setOpen(false); return; } openMenu(true); }}>⌄</button>
  </div>{open ? createPortal(<div ref={menuRef} className="cc783-select-popup cc793-floating-select-popup cc793-course-popup" id="cc783-course-options" role="listbox" aria-label="Course choices" style={{ '--cc793-left': `${position.left}px`, '--cc793-top': `${position.top}px`, '--cc793-width': `${position.width}px`, '--cc793-max-height': `${position.maxHeight}px` }}>{choices.map((course, index) => <button key={course} id={`cc783-course-${index}`} type="button" role="option" tabIndex={-1} aria-selected={value === course} className={index === highlighted ? 'highlighted' : ''} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setHighlighted(index)} onClick={() => pick(course)}>{course}</button>)}{!choices.length ? <div className="cc784-custom-course">Custom course — your typed value will be kept.</div> : null}</div>, document.body) : null}</div>;
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
      ? React.cloneElement(React.Children.only(this.props.children), { key: `profile-retry:${this.state.retry}:${this.props.freshEntryKey || 'current'}` })
      : this.props.children;
  }
}


function initialExistingCandidateItem(candidateId) {
  const id = safeText(candidateId || '').trim();
  if (!id) return null;
  // First render must never call navigation helpers that depend on hooks declared
  // later in CandidateDetailPage. Use the already-written instant profile snapshot
  // only; full cache/draft/server hydration continues after the component mounts.
  const instant = GLOBAL_CANDIDATE_PROFILE_CACHE[id]?.item || readCandidateInstantProfile(id);
  return buildInstantCandidateShell(id, instant || { candidate_id: id });
}

function CandidateDetailPageInner() {
  const { candidateId: routeCandidateId } = useParams();
  const candidateId = routeCandidateId;
  const isNewCandidate = String(candidateId || '').trim().toLowerCase() === 'new';
  const navigate = useNavigate();
  const location = useLocation();
  const { user, actor } = useAuth();
  const dashboardReadOnly=!!actor&&!['manager','admin'].includes(String(actor.role).toLowerCase())&&String(actor.user_id)!==String(user?.user_id);
  const newDraftKeyRef = useRef('new:' + (() => {
    // Explicit fresh URL is the normal entry path. Session fallback survives reload.
    const fresh = new URLSearchParams(location.search).get('fresh');
    if (fresh) return fresh;
    try {
      let token = sessionStorage.getItem('cc848-direct-new-tab-draft');
      if (!token) {token=crypto.randomUUID(); sessionStorage.setItem('cc848-direct-new-tab-draft',token);}
      return token;
    } catch { return location.key || crypto.randomUUID(); }
  })());
  const newDraftKey = newDraftKeyRef.current;
  // CC848: A stable, hidden UUID binds retries, even after a browser refresh.
  const newDraftUuidRef = useRef('');
  useEffect(()=>{const online=()=>setItem(current=>({...current}));window.addEventListener('online',online);return()=>window.removeEventListener('online',online)},[]);
  function getNewDraftUuid() {
    if (newDraftUuidRef.current) return newDraftUuidRef.current;
    const key = `cc848-idless-draft:${cachePrincipal()}:${newDraftKey}`;
    let value = '';
    try { value = localStorage.getItem(key) || ''; } catch {}
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value)) value = crypto.randomUUID();
    newDraftUuidRef.current = value;
    try { localStorage.setItem(key, value); } catch {}
    return value;
  }
  function clearNewDraftUuid() {
    try { localStorage.removeItem(`cc848-idless-draft:${cachePrincipal()}:${newDraftKey}`); } catch {}
    newDraftUuidRef.current = '';
    try { sessionStorage.removeItem('cc848-direct-new-tab-draft'); } catch {}
  }
  const profileMountedRef = useRef(true);
  useEffect(() => { profileMountedRef.current = true; return () => { profileMountedRef.current = false; }; }, []);

  // CC26_752: once a brand-new candidate receives its real Candidate ID, hand
  // the complete visible profile to the REAL React Router route. This restores
  // the proven CC552 route flow while keeping the newer instant-cache protection:
  // the filled profile is written to memory/session cache BEFORE navigation, so
  // the same profile remains visible even if React re-renders/remounts the route.
  function navigateCreatedCandidateInPlace(newId, snapshotItem = null, handoffExtras = {}) {
    if (!profileMountedRef.current) return;
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
  const resumeInputRef = useRef(null);
  const pendingResumeRef = useRef(null);
  const [pendingResume,setPendingResume] = useState(null);
  const notesPanelRef = useRef(null);
  const notesThreadListRef=useRef(null);
  const notesScrollState=useRef({candidateId:'',opened:false,atBottom:true,lastKey:''});
  const cc718NoteWriteRef = useRef(null);
  const cc928NoteIntentRef = useRef(null);
  const openLoggedRef = useRef('');
  const candidateCacheRef = useRef(GLOBAL_CANDIDATE_PROFILE_CACHE);
  const resetSnapshotRef = useRef(null);
  const rawEditBaselineRef = useRef(null);
  const profileCommitRevisionRef = useRef(0);
  const [item, setItem] = useState(() => isNewCandidate ? ensureCandidateDefaults({ candidate_id: '', approval_status: 'Draft', status: 'Draft' }) : initialExistingCandidateItem(candidateId) || ensureCandidateDefaults({candidate_id:candidateId}));
  const latestItemRef = useRef(item);
  if(!resetSnapshotRef.current && item)resetSnapshotRef.current=clonePlain(item);
  const commandIntentRef = useRef(null);
  const newCandidateCreateRef = useRef({ promise: null, created: null, autoInFlight: false });
  const [notes, setNotes] = useState(() => GLOBAL_CANDIDATE_PROFILE_CACHE[candidateId]?.notes || []);
  const [timeline, setTimeline] = useState(() => GLOBAL_CANDIDATE_PROFILE_CACHE[candidateId]?.timeline || []);
  const [noteBody, setNoteBody] = useState('');
  const [replyContext, setReplyContext] = useState(null);
  const composerRef = useRef({ body:noteBody,reply:replyContext });
  composerRef.current = { body:noteBody,reply:replyContext };
  const [message, setMessage] = useState('');
  const [salaryInputError, setSalaryInputError] = useState('');
  const [candidateFiles, setCandidateFiles] = useState([]);
  const [fileBusy, setFileBusy] = useState('');
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(true);
  const [historyNextOffset, setHistoryNextOffset] = useState(3);
  const [historyError, setHistoryError] = useState('');
  const [processOptions, setProcessOptions] = useState(() => readStoredProcessOptions());
  useEffect(() => {
    let cancelled = false;
    // Shared process list is loaded once per profile open (API cache keeps route changes cheap).
    // No polling is used: new options are saved only when the user explicitly adds one.
    api.get('/api/candidates/process-options', { cacheTtlMs: 300000, timeoutMs: 12000, retries: 0 })
      .then((data) => {
        if (cancelled) return;
        const shared = safeArray(data?.items).map((entry) => safeText(entry)).filter(Boolean);
        const sharedLocations = safeArray(data?.preferred_location_options).map((entry) => safeText(entry)).filter(Boolean);
        if (shared.length) {
          setProcessOptions((current) => {
            const merged = mergeProcessOptions(current, shared, readStoredProcessOptions());
            persistProcessOptions(merged);
            return merged;
          });
        }
        if (sharedLocations.length) {
          const merged = [...new Set([...PREFERRED_LOCATIONS, ...sharedLocations])];
          setPreferredLocations(merged);
          persistPreferredLocations(merged);
        } else {
          setPreferredLocations([...PREFERRED_LOCATIONS]);
        }
        setPreferredLocationCatalogReady(true);
      })
      .catch(() => {
        // Do not sanitize an old saved value unless the shared catalog was
        // successfully verified. This protects custom locations when offline.
      });
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
    return name || 'Team member';
  }, [item?.recruiter_code, item?.recruiter_name, recruiterOptions, user]);
  const [preferredLocationCatalogReady, setPreferredLocationCatalogReady] = useState(false);
  const [preferredLocations, setPreferredLocations] = useState(() => [...PREFERRED_LOCATIONS]);

  useEffect(() => {
    if (!preferredLocationCatalogReady || !item) return;
    const currentValue = safeText(item.preferred_location || '');
    const cleaned = canonicalPreferredLocationValue(currentValue, preferredLocations);
    if (cleaned === currentValue) return;

    // Legacy/current-location text must never become a Preferred Location option.
    // This is frontend-only until the employee presses Save.
    const nextItem = ensureCandidateDefaults({ ...(item || {}), preferred_location: cleaned });
    latestItemRef.current = nextItem;
    setItem(nextItem);
    if (isNewCandidate) writeCandidateDraftSnapshot(newDraftKey, nextItem);
    else writeCandidateDraftSnapshot(candidateId, nextItem, resetSnapshotRef.current);
    setInvalidFields((current) => current.filter((key) => key !== 'preferred_location'));
  }, [preferredLocationCatalogReady, candidateId, item?.preferred_location, preferredLocations.join('|')]);

  const [candidateList, setCandidateList] = useState([]);
  const [noteTemplates, setNoteTemplates] = useState(getNoteTemplates());
  const [waTemplates, setWaTemplates] = useState(getWhatsAppTemplates());
  const [waEdit,setWaEdit]=useState(null),[waEditBusy,setWaEditBusy]=useState(false),[waEditError,setWaEditError]=useState('');
  useEffect(()=>{let live=true;const local=()=>{if(live)setWaTemplates(getWhatsAppTemplates());};const sync=()=>loadSharedWhatsAppTemplates(true).catch(()=>{});loadSharedWhatsAppTemplates().then(local).catch(()=>{});window.addEventListener('cc878-wa-catalog-loaded',local);window.addEventListener('cc878-wa-templates-changed',sync);window.addEventListener('storage',local);return()=>{live=false;window.removeEventListener('cc878-wa-catalog-loaded',local);window.removeEventListener('cc878-wa-templates-changed',sync);window.removeEventListener('storage',local);};},[user?.user_id]);
  function editWa(value){const option=decodeWhatsAppTemplateOption(value);const template=waTemplates.find(t=>t.id===option?.id)||waTemplates.find(t=>t.title===option?.title&&t.body===option?.body);if(template){setWaEdit({...template});setWaEditError('');}}
  async function saveWaEdit(){if(waEditBusy)return;setWaEditBusy(true);setWaEditError('');try{setWaTemplates(await editSharedWhatsAppTemplate(waEdit));setWaEdit(null);}catch(e){setWaEditError(e.message);}finally{setWaEditBusy(false);}}

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [removeInterviewOpen, setRemoveInterviewOpen] = useState(false);
  const [removeInterviewReason, setRemoveInterviewReason] = useState('');
  const [statusFlash, setStatusFlash] = useState('');
  const [celebrate, setCelebrate] = useState(false);
  const [invalidFields, setInvalidFields] = useState([]);
  const [submissionIssues, setSubmissionIssues] = useState([]);
  useEffect(()=>{
    const jump=new URLSearchParams(location.search).get('jump');
    if(!item?.candidate_id||!['notes','interview','submission','followup'].includes(jump))return;
    const frame=requestAnimationFrame(()=>cc560CandidateJump(jump));return()=>cancelAnimationFrame(frame);
  },[item?.candidate_id,location.search]);
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
  const profileHydrationPromiseRef = useRef(null);
  const serverBaselineVerifiedRef = useRef(false);
  const localEditGuardRef = useRef({ candidateId: '', editedAt: 0 });
  const [jdSuggestionPopup, setJdSuggestionPopup] = useState(null);
  const [jdPopupBusyId, setJdPopupBusyId] = useState('');
  const fieldOrderStorageKey='careerCroxSharedFieldOrder_CC831';
  const [fieldOrder,setFieldOrder]=useState(DEFAULT_CANDIDATE_FIELD_ORDER);
  const [layoutRevision,setLayoutRevision]=useState(0),[layoutMode,setLayoutMode]=useState(false),[layoutBusy,setLayoutBusy]=useState(false);
  const [projectChoices,setProjectChoices]=useState([]);
  const [,refreshStaffLabel]=useState(0);useEffect(()=>{const updated=()=>refreshStaffLabel(v=>v+1);window.addEventListener('cc814-staff-names',updated);return()=>window.removeEventListener('cc814-staff-names',updated);},[]);
  const layoutRevisionRef=useRef(-1);
  const canArrangeFields=['manager','admin'].includes(String(user?.role||'').toLowerCase());
  function acceptSharedLayout(data={}){const revision=Number(data.layout_revision??data.revision)||0;if(revision<layoutRevisionRef.current)return;layoutRevisionRef.current=revision;const saved=Array.isArray(data.field_order)?data.field_order:Array.isArray(data.order)?data.order:[];const keys=saved.filter(k=>DEFAULT_CANDIDATE_FIELD_ORDER.includes(k));setFieldOrder([...keys,...DEFAULT_CANDIDATE_FIELD_ORDER.filter(k=>!keys.includes(k))]);setLayoutRevision(Number(data.layout_revision??data.revision)||0);if(Array.isArray(data.projects))setProjectChoices(data.projects);}
  async function saveSharedLayout(){setLayoutBusy(true);try{const value=await api.post('/api/ui/form-layout',{order:fieldOrder,expected_revision:layoutRevision},{retries:0});acceptSharedLayout(value);setLayoutMode(false);setMessage('Form layout saved for everyone.');}catch(error){setMessage(error.message);}finally{setLayoutBusy(false);}}
  useEffect(()=>{let live=true;api.get('/api/ui/lookups?scope=profile',{cacheTtlMs:30000,allowStale:false,retries:0}).then(data=>{if(live)acceptSharedLayout(data);}).catch(()=>{});const changed=e=>acceptSharedLayout(e.detail||{});const sync=()=>{if(document.hidden)return;api.get('/api/ui/form-layout',{cacheTtlMs:30000,allowStale:false,retries:0}).then(value=>{if(live)acceptSharedLayout(value);}).catch(()=>{});};window.addEventListener('career-crox-form-layout',changed);window.addEventListener('career-crox-reminder-ready',sync);window.addEventListener('focus',sync);return()=>{live=false;window.removeEventListener('career-crox-form-layout',changed);window.removeEventListener('career-crox-reminder-ready',sync);window.removeEventListener('focus',sync);};},[]);
  const [dragFieldKey, setDragFieldKey] = useState('');
  const navKey = useMemo(() => new URLSearchParams(location.search || '').get('nav') || '', [location.search]);
  const navRowKey = useMemo(() => new URLSearchParams(location.search || '').get('nav_row') || '', [location.search]);
  const preservedNavContext = useMemo(() => readCandidateNavContext(navKey), [navKey]);
  const backToSource=()=>{let target='/candidates';try{const value=new URL(preservedNavContext?.source_path||target,window.location.origin);if(value.origin===window.location.origin&&!value.pathname.startsWith('/candidate/'))target=value.pathname+value.search;}catch{}navigate(target);};
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

  // CC909: apply a confirmed Quick Save to an already-open profile without a
  // reload. Rebase only the fields saved there; keep unrelated form drafts and
  // the note composer. The server acknowledgement is the new conflict baseline.
  const quickSyncExtrasRef = useRef({});
  quickSyncExtrasRef.current = { notes, timeline, process_options: processOptions,
    nav_items: candidateList, files: candidateFiles, recruiter_options: recruiterOptions };
  useEffect(() => onCandidateRealtime(({ item: incoming, meta }) => {
    if (isNewCandidate || !['quick-update','aria-bulk'].includes(meta?.source) || meta?.committed !== true
      || String(incoming?.candidate_id || '') !== String(candidateId)
      || String(latestItemRef.current?.candidate_id || '') !== String(candidateId)) return;
    const saved = ensureCandidateDefaults(incoming);
    const previous = sanitizeCandidatePayload(resetSnapshotRef.current || {});
    const current = sanitizeCandidatePayload(latestItemRef.current || {});
    const committed = new Set(meta.changed_fields || []);
    const blocked = new Set(['candidate_id','created_at','updated_at','approval_status','notes']);
    const remainingDraft = {};
    for (const key of CRITICAL_SAVE_FIELDS) {
      if (!blocked.has(key) && !committed.has(key)
        && String(current[key] ?? '') !== String(previous[key] ?? '')) remainingDraft[key] = current[key];
    }
    const visible = ensureCandidateDefaults({ ...saved, ...remainingDraft });
    latestItemRef.current = visible;
    resetSnapshotRef.current = clonePlain(saved);
    try { rawEditBaselineRef.current = JSON.parse(incoming._edit_base_json || 'null'); }
    catch { rawEditBaselineRef.current = null; }
    profileCommitRevisionRef.current += 1;
    serverBaselineVerifiedRef.current = Boolean(rawEditBaselineRef.current);
    setItem(visible);
    setProfileVerified(true);
    setHydratingProfile(false);
    const extras = quickSyncExtrasRef.current;
    const mergedNotes = meta.note?.id && String(meta.note.candidate_id) === String(candidateId)
      ? [...safeArray(extras.notes).filter(row => String(row.id) !== String(meta.note.id)), meta.note]
      : safeArray(extras.notes);
    quickSyncExtrasRef.current = { ...extras, notes: mergedNotes };
    setNotes(mergedNotes);
    writeProfileCacheSnapshot(visible, { ...extras, notes: mergedNotes }, candidateId);
    try { writeCandidateInstantProfile(visible, extras.nav_items); } catch {}
    try {
      const priorDraft = readCandidateDraftSnapshot(candidateId) || {};
      localStorage.setItem(candidateDraftStorageKey(candidateId), JSON.stringify({ ...priorDraft,
        candidateId, principal: cachePrincipal(), editedAt: Date.now(),
        item: sanitizeCandidatePayload(visible), baseSnapshot: clonePlain(saved),
        editedFields: remainingDraft }));
    } catch {}
  }), [candidateId, isNewCandidate, user?.user_id]);


  const leadership = ['admin', 'manager', 'tl'].includes(user?.role);
  const canDirectRemoveInterview = leadership;
  const latestResumeFile = useMemo(() => safeArray(candidateFiles).find((file) => file?.file_kind === 'resume') || null, [candidateFiles]);
  const latestRecordingFile = useMemo(() => safeArray(candidateFiles).find((file) => file?.file_kind === 'call_recording') || null, [candidateFiles]);
  const noteThreads = useMemo(() => buildNoteThreads(notes), [notes]);
  const visibleNotes = noteThreads;
  useEffect(()=>{
    const node=notesThreadListRef.current;
    if(!node || !noteThreads.length)return;
    let state=notesScrollState.current;
    if(state.candidateId!==candidateId)state=notesScrollState.current={candidateId,opened:false,atBottom:true,lastKey:''};
    const newest=[...notes].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))[0];
    const key=String(newest?.id||'')+':'+String(newest?.updated_at||newest?.created_at||'');
    const own=String(newest?.username||'').toLowerCase()===String(user?.username||'').toLowerCase();
    const follow=!state.opened||state.atBottom||(key!==state.lastKey&&own);
    state.opened=true;state.lastKey=key;
    if(!follow)return;
    const frame=requestAnimationFrame(()=>{scrollToLatestNote();state.atBottom=true;});
    return()=>cancelAnimationFrame(frame);
  },[candidateId,notes,noteThreads,user?.username,loading,hydratingProfile]);
  const recentSavedNotes = useMemo(() => [...notes].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))).slice(0,3).map(root=>({root})), [notes]);
  function scrollToLatestNote(smooth=false) {
    const node=notesThreadListRef.current;if(!node)return;
    const newest=[...notes].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))[0];
    const target=[...node.querySelectorAll('[data-note-id]')].find(element=>element.dataset.noteId===String(newest?.id));
    const top=target?node.scrollTop+target.getBoundingClientRect().bottom-node.getBoundingClientRect().bottom+12:node.scrollHeight;
    node.scrollTo({top:Math.max(0,top),behavior:smooth&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches?'smooth':'auto'});
    notesScrollState.current.atBottom=true;
  }
  const recentNoteTemplatePreview = useMemo(() => safeTemplateList(noteTemplates, 4), [noteTemplates]);
  // Only latest 3 are shown automatically. Older timeline pages require a click;
  // no interval, storage writes, or broad activity scans are added.
  const visibleTimeline = useMemo(() => {
    const ordered=[...safeArray(timeline)].sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')) || String(b.activity_id||b.id||'').localeCompare(String(a.activity_id||a.id||'')));
    return historyExpanded ? ordered : ordered.slice(0,3);
  }, [timeline, historyExpanded]);
  useEffect(()=>{setHistoryExpanded(false);setHistoryHasMore(true);setHistoryNextOffset(3);setHistoryError('');},[candidateId]);
  async function loadMoreTimeline() {
    if (historyLoading || !candidateId || isNewCandidate) return;
    if (historyExpanded && !historyHasMore) return;
    const offset=historyExpanded ? historyNextOffset : 3;
    setHistoryExpanded(true);
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const data=await api.get(`/api/candidates/${encodeURIComponent(candidateId)}/timeline?offset=${offset}&limit=50`,{cacheTtlMs:0,allowStale:false,retries:0,timeoutMs:15000});
      const rows=safeArray(data?.items).map(sanitizeActivityRow);
      setTimeline(current => {
        const merged=[...safeArray(current),...rows],seen=new Set();
        return merged.filter((row,index)=>{
          const key=safeText(row?.activity_id||row?.id)||`${safeText(row?.created_at)}:${safeText(row?.action_type)}:${index}`;
          if(seen.has(key))return false;
          seen.add(key);return true;
        }).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
      });
      setHistoryNextOffset(Number(data?.next_offset ?? (offset+rows.length)));
      setHistoryHasMore(Boolean(data?.has_more));
    } catch(error) {
      setHistoryError(error?.message || 'Older activity could not be loaded. Retry manually.');
    } finally {setHistoryLoading(false);}
  }
  const realSubmissionWorkflowActive = hasRealSubmittedWorkflow(item || {}, item?.approval_status || '');
  const approvalPending = realSubmissionWorkflowActive && String(item?.approval_status || '').toLowerCase() === 'pending';
  const editingLocked = dashboardReadOnly || (approvalPending && !leadership);
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
        const key = String(clean._nav_row_key || id).toLowerCase();
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
    if (navKey) return mergeCandidateNavRows(storedItems);
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
    serverBaselineVerifiedRef.current = false;
    rawEditBaselineRef.current = null;
    profileHydrationPromiseRef.current = null;
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

  useEffect(()=>{const check=()=>{if(isNewCandidate)return;api.get('/api/candidates/'+encodeURIComponent(candidateId)+'?view=core&_refresh=1',{cacheTtlMs:0,allowStale:false,retries:0}).then(()=>load()).catch(error=>{if([403,404].includes(Number(error.status))){setItem({candidate_id: candidateId});setProfileVerified(false);setError('Project access changed. This profile is no longer shared with you.');}else setError(error.message);});};window.addEventListener('career-crox-access-changed',check);return()=>window.removeEventListener('career-crox-access-changed',check);},[candidateId,isNewCandidate]);
  function fieldOrderIndex(fieldKey) {
    const idx = fieldOrder.indexOf(fieldKey);
    return idx >= 0 ? idx : fieldOrder.length + 1;
  }

  function moveField(dragKey, targetKey) {
    if (!canArrangeFields || !layoutMode || !dragKey || !targetKey || dragKey === targetKey) return;
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
      draggable: canArrangeFields && layoutMode,
      onDragStart: (event) => { if(event.target.matches('input,textarea,select,button')){event.preventDefault();return;}setDragFieldKey(fieldKey);event.dataTransfer?.setData('text/plain',fieldKey); },
      onDragOver: (event) => event.preventDefault(),
      onDrop: (event) => { event.preventDefault(); moveField(dragFieldKey, fieldKey); },
      onDragEnd: () => setDragFieldKey(''),
      style: { order: fieldOrderIndex(fieldKey), '--cc831-order':fieldOrderIndex(fieldKey) },
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
      career_gap: '',
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
      virtual_onsite: '',
      documents_availability: '',
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
    try { rawEditBaselineRef.current = JSON.parse(rawData?.item?._edit_base_json || 'null'); } catch { rawEditBaselineRef.current = null; }
    const preserveSecondary = Boolean(options.preserveSecondary);
    const localDraft = readCandidateDraftSnapshot(candidateId);
    let nextItem = applyAutoRangesToCandidate(safeData.item || ensureCandidateDefaults(sanitizeCandidateItem(item || {})));
    const serverBaseline = clonePlain(nextItem);
    if (localDraft?.item) {
      nextItem = restoreEditedDraft(nextItem, localDraft);
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
    resetSnapshotRef.current = serverBaseline;
    serverBaselineVerifiedRef.current = Boolean(serverBaseline?.candidate_id);
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
    const cachedRaw = sanitizeCachedProfilePayload(candidateCacheRef.current[candidateId], item);
    const cached = String(cachedRaw?.item?.candidate_id || '').trim() === String(candidateId || '').trim() ? cachedRaw : null;
    const instantFallback = instantProfileFromNavigation(candidateId);
    const durableDraft = readCandidateDraftSnapshot(candidateId);
    const durableDraftItem = durableDraft?.item ? ensureCandidateDefaults(sanitizeCandidateItem(durableDraft.item)) : null;
    setError('');
    setProfileVerified(false);
    serverBaselineVerifiedRef.current = false;

    if (cached?.item) {
      const visibleCachedItem = durableDraftItem
        ? restoreEditedDraft(cached.item, readCandidateDraftSnapshot(candidateId))
        : cached.item;
      resetSnapshotRef.current = clonePlain(cached.item);
      setItem(visibleCachedItem);
      setNotes(cached.notes || []);
      setTimeline(cached.timeline || []);
      setProcessOptions([...new Set([...(cached.process_options || []), ...readStoredProcessOptions()])]);
      setRecruiterOptions(cached.recruiter_options || []);
      {
        const mergedNavItems = sourceBoundNavItemsFromPayload(cached.nav_items || []);
        setCandidateList(navKey ? mergedNavItems : (mergedNavItems.length ? mergedNavItems : (cached.nav_items || [])));
      }
      setCandidateFiles([]);
      setFilesLoaded(false);
      setLoading(false);
      setHydratingProfile(true);
      setMessage('Profile opened from a local snapshot. Notes sync in the background; files open on demand.');
    } else if (instantFallback) {
      const visibleInstantItem = durableDraftItem
        ? restoreEditedDraft(instantFallback, readCandidateDraftSnapshot(candidateId))
        : instantFallback;
      resetSnapshotRef.current = clonePlain(instantFallback);
      setItem(visibleInstantItem);
      setNotes([]);
      setTimeline([]);
      {
        const mergedNavItems = sourceBoundNavItemsFromPayload([]);
        setCandidateList(navKey ? mergedNavItems : (mergedNavItems.length ? mergedNavItems : candidateList));
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

    // CC787: the shell already paints synchronously. One authorized detail request
    // hydrates fields + notes together instead of serial core/full downloads.
    // No speculative profile reads and no extra polling.



    window.setTimeout(() => {
      if (!isCurrentRequest()) return;
      const commitRevision = profileCommitRevisionRef.current;
      const hydrationPromise = api.get(`/api/candidates/${candidateId}?${dialerProfileLockMode ? 'prefetch=1' : 'no_files=1'}`, { cacheTtlMs: 0, timeoutMs: 16000, retries: 1, background: false, allowStale: false })
        .then((data) => {
          if (!isCurrentRequest()) return data;
          if (actionLockRef.current || commitRevision !== profileCommitRevisionRef.current) {
            // A GET started before a save cannot replace its committed row or
            // conflict baseline. Older notes can still be merged safely by ID.
            if (Array.isArray(data?.notes)) setNotes(current => {
              const known = new Set(current.map(row => String(row.id)));
              return [...current, ...data.notes.filter(row => !known.has(String(row.id)))];
            });
            return data;
          }
          if (hasLocalEditsAfter(requestId)) {
            // Never overwrite fields the employee already typed. We still accept the
            // fresh server row as the conflict baseline so the user's own quick edits
            // do not look like a fake "another session" conflict on Save/Submit.
            const serverBaseline = applyAutoRangesToCandidate(ensureCandidateDefaults(sanitizeCandidateItem(data?.item || {})));
            try { rawEditBaselineRef.current = JSON.parse(data?.item?._edit_base_json || 'null'); } catch { rawEditBaselineRef.current = null; }
            if (serverBaseline?.candidate_id) {
              resetSnapshotRef.current = clonePlain(serverBaseline);
              serverBaselineVerifiedRef.current = true;
              setProfileVerified(true);
            }
            setMessage('Latest server copy verified. Your unsaved edits were kept.');
            return data;
          }
          if (String(data?.item?.candidate_id || '').trim() !== String(candidateId || '').trim()) {
            throw new Error('Candidate route and server identity differ. No profile fields were applied.');
          }
          applyCandidatePayload(data);
          serverBaselineVerifiedRef.current = Boolean(data?.item);
          setProfileVerified(Boolean(data?.item));
          return data;
        })
        .catch((error) => {
          if (!isCurrentRequest()) return null;
          if (actionLockRef.current || commitRevision !== profileCommitRevisionRef.current) return null;
          serverBaselineVerifiedRef.current = false;
          setMessage('Could not verify the latest profile and notes. Save/Submit will verify once before writing.');
          throw error;
        })
        .finally(() => {
          if (profileHydrationPromiseRef.current === hydrationPromise) profileHydrationPromiseRef.current = null;
          if (!isCurrentRequest()) return;
          setHydratingProfile(false);
          setRouteBusy(false);
        });
      profileHydrationPromiseRef.current = hydrationPromise;
      // The load is intentionally fire-and-forget for instant UI. Manual Save/Submit
      // can await this same promise without issuing another request.
      void hydrationPromise.catch(() => {});
    }, 0);
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
      serverBaselineVerifiedRef.current = true;
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
      const durableNewDraft = readCandidateDraftSnapshot(newDraftKey)?.item || {};
      const draft = ensureCandidateDefaults({
        candidate_id: '', approval_status: 'Draft', status: 'Draft',
        recruiter_code: user?.recruiter_code || '', recruiter_name: user?.full_name || user?.username || '',
        recruiter_designation: user?.designation || '',
        ...durableNewDraft,
      });
      if (String(draft.status || '').toLowerCase() === 'draft' && Object.keys(durableNewDraft).length) draft.status = 'In - Progress';
      latestItemRef.current = draft;
      setItem((current) => ensureCandidateDefaults({ ...draft, ...durableNewDraft, candidate_id: '' }));
      setNotes([]); setTimeline([]); setCandidateFiles([]); setCandidateList([]); setFilesLoaded(false);
      setLoading(false); setHydratingProfile(false); setProfileVerified(true); setRouteBusy(false); setError('');
      setMessage('Fill details. Save keeps a draft; Submit saves and submits together.');
      // CC848: No provisional or permanent Candidate ID is shown before Submit.
      api.get('/api/ui/lookups?scope=profile', { cacheTtlMs: 120000, allowStale: false, timeoutMs: 10000, retries: 1, background: false })
        .then((data) => {
          const safe = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
          if (Array.isArray(safe.process_options) && safe.process_options.length) setProcessOptions(mergeProcessOptions(safe.process_options));
          if (Array.isArray(safe.users)) setRecruiterOptions(safe.users);
          // IMPORTANT: generic location_options are CURRENT locations and must never
          // be mixed into Preferred Location. Preferred options come only from the
          // dedicated shared preferred-location catalog loaded above.
          if (Array.isArray(safe.preferred_location_options) && safe.preferred_location_options.length) {
            const sharedPreferred = safe.preferred_location_options.map((value) => String(value || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
            const merged = [...new Set([...PREFERRED_LOCATIONS, ...sharedPreferred])];
            setPreferredLocations(merged);
            persistPreferredLocations(merged);
            setPreferredLocationCatalogReady(true);
          }
        }).catch(() => {});
      return undefined;
    }
    showInstantProfileShell(candidateId, instantProfileFromNavigation(candidateId) || { candidate_id: candidateId });
    setError('');
    setReplyContext(readCandidateDraftSnapshot(candidateId)?.replyContext || null);
    setNoteBody(readCandidateDraftSnapshot(candidateId)?.noteBody || '');
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
    let active = true;
    const openedCandidateId = String(candidateId || '');
    openLoggedRef.current = candidateId;
    api.post(`/api/candidates/${candidateId}/open`, {}, { timeoutMs: 6000, background: true })
      .then((data) => {
        if (!active) return;
        const viewedAt = data?.last_viewed_at || 'Never Opened';
        setItem((current) => current && String(current.candidate_id || '') === openedCandidateId ? { ...current, last_viewed_at: viewedAt, last_viewed_by_name: data?.last_viewed_by_name || '' } : current);
      })
      .catch(() => {});
    return () => { active = false; };
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
      setCandidateList(sourceBoundNavItemsFromPayload(cached.nav_items || []));
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

  async function uploadCandidateAsset(fileKind,file) {
    if(!file||fileBusy||fileKind!=='resume')return;
    if(file.size>6*1024*1024){setMessage('Choose a resume of 6 MB or smaller.');return;}
    if(!/\.(pdf|docx?|png|jpe?g|webp|txt|rtf|odt)$/i.test(file.name)){setMessage('Choose PDF, Word, image or text.');return;}
    setFileBusy('resume');setMessage('Reading resume…');
    try{
      const content=await readFileAsBase64(file);
      if(pendingResumeRef.current?.previewUrl)URL.revokeObjectURL(pendingResumeRef.current.previewUrl);
      const selected={payload:{file_name:file.name,mime_type:file.type},previewUrl:URL.createObjectURL(file)};
      pendingResumeRef.current=selected;setPendingResume({name:file.name,size:file.size});
      const data=await api.post('/api/candidates/resume-autofill',{name:file.name,mime_type:file.type,content_base64:content},{timeoutMs:45000,retries:0});
      if(pendingResumeRef.current!==selected)return;
      if(!data?.ok)throw new Error(data?.message||'Resume could not be read.');
      const values={};for(const key of ['full_name','phone','email','location','qualification','total_experience','relevant_experience']){
        const v=String(data.fields?.[key]??'').trim();if(v&&!/not available|unknown|not found/i.test(v))values[key]=v;
      }
      if(Object.keys(values).length){patch(values);setMessage('Resume details filled. Review and Save. Original file stays only in this tab.');}
      else setMessage('No readable details found. Use a text PDF/Word file or fill the fields manually. View Resume still opens this selected file.');
    }catch(e){setMessage(e.message||'Resume could not be read. Your selected file is available in View Resume.');}
    finally{setFileBusy('');}
  }

  async function loadCandidateFiles() {
    if (!candidateId || isNewCandidate || filesLoading) return [];
    setFilesLoading(true);
    try {
      const data = await api.get(`/api/candidates/${encodeURIComponent(candidateId)}/files`,{cacheTtlMs:0,timeoutMs:12000,retries:1,allowStale:false});
      setCandidateFiles(data.files || []);
      setFilesLoaded(true);
      writeProfileCacheSnapshot(latestItemRef.current || item,{files:data.files || []});
      return data.files || [];
    } catch (error) {
      setMessage(error.message || 'Resumes could not be loaded.');
      return [];
    } finally { setFilesLoading(false); }
  }

  async function downloadCandidateAsset(fileId) {
    if(!canArrangeFields){setMessage('CRM downloads are available only to the manager.');return;}
    if (fileBusy) return;
    // Open during the actual click, so a later lookup/fetch cannot trigger a popup blocker.
    const preview = window.open('about:blank','_blank');
    if (preview) { preview.opener=null; preview.document.body.textContent='Opening resume…'; }
    try {
      if (pendingResumeRef.current?.previewUrl) {
        const selected=pendingResumeRef.current;
        if (/\.(pdf|png|jpe?g|webp)$/i.test(selected.payload.file_name) && preview) preview.location.replace(selected.previewUrl);
        else {
          if (preview) preview.close();
          const link=document.createElement('a');link.href=selected.previewUrl;link.download=selected.payload.file_name;
          document.body.appendChild(link);link.click();link.remove();
        }
        return;
      }
      const id = fileId || (await loadCandidateFiles()).find(row=>row.file_kind==='resume')?.file_id;
      if (!id) throw new Error('No stored resume yet. Choose Upload Resume.');
      const url = `/api/candidates/${encodeURIComponent(candidateId)}/files/${encodeURIComponent(id)}/download`;
      const response = await fetch(url,{credentials:'include',cache:'no-store'});
      if (!response.ok) {
        const data=await response.json().catch(()=>({}));
        throw new Error(data.message || 'Resume could not be opened. Sign in and retry.');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const type = String(response.headers.get('Content-Type') || '').split(';')[0];
      if (/^(application\/pdf|image\/(png|jpeg|webp))$/.test(type) && preview) preview.location.replace(objectUrl);
      else {
        if (preview) preview.close();
        const link=document.createElement('a'); link.href=objectUrl;
        link.download=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || latestResumeFile?.original_name || 'resume';
        document.body.appendChild(link); link.click(); link.remove();
      }
      window.setTimeout(()=>URL.revokeObjectURL(objectUrl),5*60*1000);
    } catch (error) { if (preview && !preview.closed) preview.close(); setMessage(error.message || 'Resume could not be opened.'); }
  }

  useEffect(()=>{if (!isNewCandidate && item?.resume_filename && !filesLoaded && !filesLoading) loadCandidateFiles();},[candidateId]);
  useEffect(()=>()=>{if(pendingResumeRef.current?.previewUrl) URL.revokeObjectURL(pendingResumeRef.current.previewUrl);},[]);

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

  const composerIdentityRef = useRef('');
  useEffect(() => {
    composerIdentityRef.current = '';
    commandIntentRef.current = null;
    newCandidateCreateRef.current = { promise:null, created:null, autoInFlight:false };
    const draft = readCandidateDraftSnapshot(isNewCandidate ? newDraftKey : candidateId);
    setNoteBody(draft?.noteBody || ''); setReplyContext(draft?.replyContext || null);
    composerIdentityRef.current = `${cachePrincipal()}:${candidateId}`;
  }, [candidateId, user?.user_id]);
  useEffect(() => {
    if (composerIdentityRef.current !== `${cachePrincipal()}:${candidateId}`) return;
    try {
      const key = isNewCandidate ? newDraftKey : candidateId;
      const previous = readCandidateDraftSnapshot(key) || { candidateId:key, item:{} };
      localStorage.setItem(candidateDraftStorageKey(key), JSON.stringify({ ...previous,
        principal:cachePrincipal(), noteBody, replyContext, editedAt:Date.now() }));
    } catch {}
  }, [noteBody,replyContext,candidateId]);

  function patch(next) {
    const nextPatch = { ...(next || {}) };
    if (Object.prototype.hasOwnProperty.call(nextPatch, 'phone')) {
      nextPatch.phone = normalizeIndianPhone(nextPatch.phone);
      if (/^[0-9]+$/.test(nextPatch.phone)) {
        setMessage(current => /10[\s-]*digit|phone number|paste was not applied|extra characters/i.test(String(current || '')) ? '' : current);
      }
    }
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
      const baseCurrent = detailTouched ? applyProfileStartDefaults(current || {}, nextPatch) : { ...(current || {}) };
      const merged = ensureCandidateDefaults({ ...baseCurrent, ...nextPatch });
      if (Object.prototype.hasOwnProperty.call(nextPatch, 'phone')) {
        merged.phone = normalizeIndianPhone(merged.phone || '');
      }
      if (Object.prototype.hasOwnProperty.call(nextPatch, 'relevant_experience') && !Object.prototype.hasOwnProperty.call(nextPatch, 'relevant_experience_range')) {
        merged.relevant_experience_range = String(merged.relevant_experience ?? '').trim() ? expRange(merged.relevant_experience) : '';
      }
      if (Object.prototype.hasOwnProperty.call(nextPatch, 'in_hand_salary') && !Object.prototype.hasOwnProperty.call(nextPatch, 'relevant_in_hand_range')) {
        merged.relevant_in_hand_range = String(merged.in_hand_salary ?? '').trim() ? salaryRange(merged.in_hand_salary) : '';
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
        writeCandidateDraftSnapshot(newDraftKey, merged);
        markSync('idle', 'Draft kept on this computer. Save keeps it; Submit saves and submits together.');
      } else {
        writeCandidateDraftSnapshot(candidateId, merged, resetSnapshotRef.current);
        markSync('idle', 'Draft kept on this computer. Save keeps it; Submit saves and submits together.');
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
    const blockedKeys = new Set(['candidate_id', 'created_at', 'updated_at', '_crm_row_id', 'last_viewed_at', 'last_viewed_by_name', 'approval_status', 'notes']);
    const writable = new Set(CRITICAL_SAVE_FIELDS);
    const changed = {};
    const changedFields = [];
    const baseValues = {};
    for (const key of Object.keys(currentPayload)) {
      if (blockedKeys.has(key) || key.startsWith('_') || !writable.has(key)) continue;
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

  // CC848: New-profile autosave is ID-less. No direct POST /api/candidates,
  // and no new Candidate ID on Note, typing, Save, or background writes.
  useEffect(() => {
    if (!isNewCandidate || actionLockRef.current) return undefined;
    const snapshot = ensureCandidateDefaults(sanitizeCandidatePayload(latestItemRef.current || item || {}));
    if (!['full_name','phone','email','location','process','course_name'].some(key=>String(snapshot[key]??'').trim())&&!noteBody.trim()) return undefined;
    const timer = window.setTimeout(() => {
      if (actionLockRef.current || !isNewCandidate) return;
      const draftId = getNewDraftUuid();
      const fields = sanitizeCandidatePayload(latestItemRef.current || snapshot);
      delete fields.candidate_id;
      const text = String(composerRef.current?.body || '').trim();
      // Backend draft is a server-saved work-in-progress, not a candidate row.
      void api.post('/api/candidates/new/commit', {
        command_id: crypto.randomUUID(), draft_id: draftId,
        action: 'save', fields, note: text ? {body: text,note_type:'public'} : null,
        workflow_version: 'profile-commit-v2', workflow_release: 'CC861',
      }, { timeoutMs: 30000, retries: 0, background: true })
        .then(data => { if (data?.draft_saved !== true) throw new Error('Server draft was not confirmed.'); })
        .catch(() => {
          // The full local draft remains. Never treat an unconfirmed write as a submission.
          if (isNewCandidate && !actionLockRef.current) markSync('error', 'Network draft sync pending. Your details remain on this device.');
        });
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [isNewCandidate, item, noteBody, newDraftKey]);

  useEffect(()=>{
    if(isNewCandidate||loading||!profileVerified||actionLockRef.current)return;
    const current=sanitizeCandidatePayload(item||{}),base=sanitizeCandidatePayload(resetSnapshotRef.current||{});
    const fields=Object.fromEntries(Object.entries(current).filter(([key,value])=>!['candidate_id','updated_at','last_viewed_at','last_viewed_by_name'].includes(key)&&String(value??'')!==String(base[key]??'')));
    if(!Object.keys(fields).length&&!noteBody.trim())return;
    let cancelled=false;const sync=()=>{if(cancelled||actionLockRef.current)return;api.post('/api/profile-safety/drafts',{candidate_id:candidateId,base_updated_at:resetSnapshotRef.current?.updated_at,fields:{...fields,full_name:item.full_name,phone:item.phone},note:noteBody?{body:noteBody}:null},{background:true,retries:0}).catch(()=>{});};
    const timer=setTimeout(sync,1800);window.addEventListener('online',sync);return()=>{cancelled=true;clearTimeout(timer);window.removeEventListener('online',sync)};
  },[isNewCandidate,loading,profileVerified,item,noteBody,candidateId]);

  function cancelPendingProfileWritesForManualAction() {
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (backgroundProfileSaveRef.current?.queued) backgroundProfileSaveRef.current.queued = null;
  }

  async function waitForBackgroundProfileWrite() {
    const waitStartedAt = Date.now();
    while (backgroundProfileSaveRef.current?.inFlight && Date.now() - waitStartedAt < 12000) {
      await pause(40);
    }
  }

  async function fetchFreshServerBaselineForSave() {
    cancelPendingProfileWritesForManualAction();
    await waitForBackgroundProfileWrite();
    if (isNewCandidate) return null;

    // CC50: Save is now the only profile write. One fresh read happens only when
    // the employee explicitly presses Save. This removes stale cache/handoff
    // baselines without adding polling or background egress.
    const data = await api.get(`/api/candidates/${candidateId}?no_files=1`, {
      cacheTtlMs: 0,
      timeoutMs: 16000,
      retries: 1,
      background: false,
      allowStale: false,
    });
    const rawServerBaseline = sanitizeCandidateItem(data?.item || {});
    const serverBaseline = applyAutoRangesToCandidate(ensureCandidateDefaults(rawServerBaseline));
    if (!serverBaseline?.candidate_id) throw new Error('Latest profile could not be verified. Retry Save; your draft is safe.');
    resetSnapshotRef.current = clonePlain(serverBaseline);
    serverBaselineVerifiedRef.current = true;
    setProfileVerified(true);
    return { raw: rawServerBaseline, ui: serverBaseline };
  }

  function stripWorkflowTimeFromNormalSaveFields(rawFields = {}) {
    const fields = { ...(rawFields || {}) };
    delete fields.submission_date;
    if (Array.isArray(fields._changed_fields)) {
      fields._changed_fields = fields._changed_fields.filter((field) => field !== 'submission_date');
    }
    if (fields._client_base_values && typeof fields._client_base_values === 'object' && !Array.isArray(fields._client_base_values)) {
      fields._client_base_values = { ...fields._client_base_values };
      delete fields._client_base_values.submission_date;
    }
    return fields;
  }

  const SUBMIT_COMPARE_FIELDS = [
    'project_id',    'full_name','phone','location','preferred_location','qualification','course_name','qualification_level',
    'total_experience','relevant_experience','relevant_experience_range','career_gap','ctc_monthly','in_hand_salary',
    'relevant_in_hand_range','documents_availability','virtual_onsite','interview_reschedule_date','follow_up_at',
    'follow_up_status','follow_up_note','communication_skill','profile_priority','status','all_details_sent',
    'process','client','call_connected','looking_for_job','reference_details','data_notes'
  ];

  function normalizeSubmitCompareValue(field, value) {
    if (field === 'phone') return normalizeIndianPhone(value || '');
    if (field === 'preferred_location') {
      return splitMulti(value).map((part) => String(part || '').replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean).sort().join('|');
    }
    if (field === 'qualification_level') return normalizeQualificationCategory(value || '', '');
    if (['ctc_monthly','in_hand_salary'].includes(field)) return digitsOnly(value || '');
    if (['total_experience','relevant_experience'].includes(field)) return String(parseMonthCount(value || '0'));
    if (field === 'documents_availability') return normalizeDocumentsAvailability(value || '');
    if (field === 'interview_reschedule_date') return toInputDate(value || '');
    if (field === 'follow_up_at') return toDateTimeLocalInput(value || '');
    return safeText(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function buildCommitIntent(action, fields, note, baseValues, snapshot, draftCandidateId = candidateId, resumeSignature = '') {
    const signature = JSON.stringify({ action, fields, note, base_values: baseValues, ...(resumeSignature ? {resumeSignature} : {}) });
    const stored = readCandidateDraftSnapshot(draftCandidateId)?.commandIntent;
    if (!commandIntentRef.current || commandIntentRef.current.signature !== signature) {
      commandIntentRef.current = stored?.signature === signature ? stored : { signature, id: crypto.randomUUID() };
    }
    const intent = commandIntentRef.current;
    writeCandidateDraftSnapshot(draftCandidateId, snapshot, resetSnapshotRef.current);
    try {
      const d = readCandidateDraftSnapshot(draftCandidateId);
      localStorage.setItem(candidateDraftStorageKey(draftCandidateId), JSON.stringify({
        ...d,
        noteBody: String(noteBody || '').trim(),
        replyContext,
        commandIntent: intent,
      }));
    } catch {}
    return intent;
  }

  function applySuccessfulCommit(data, snapshot, action, submittedAt = '') {
    if (data?.ok !== true || data?.committed !== true || data?.workflow_version !== 'profile-commit-v2' || data?.workflow_release !== 'CC861') {
      throw new Error('The server did not confirm this save. Deploy the matching backend from this ZIP, then retry; your draft is kept.');
    }
    const saved = ensureCandidateDefaults(data?.item || {});
    if (!saved.candidate_id || (action === 'submit' && !data?.submission?.submission_id)) {
      throw new Error(action === 'submit' ? 'Submission acknowledgement incomplete. Retry Submit.' : 'Save acknowledgement incomplete. Retry Save.');
    }

    const latest = sanitizeCandidatePayload(latestItemRef.current || snapshot);
    const newer = {};
    const writable = new Set(CRITICAL_SAVE_FIELDS);
    const protectedFields = new Set(['candidate_id','created_at','updated_at','approval_status','submission_id','submission_exists','approval_requested_at','approved_at','approved_by_name','submitted_by']);
    for (const [key, value] of Object.entries(latest)) {
      if (writable.has(key) && !protectedFields.has(key) && String(value ?? '') !== String(snapshot?.[key] ?? '')) newer[key] = value;
    }
    const visible = ensureCandidateDefaults({ ...saved, ...newer });
    if (submittedAt && !Object.prototype.hasOwnProperty.call(newer, 'submission_date')) visible.submission_date = submittedAt;
    if (action === 'submit' && data?.submission?.submission_id) {
      visible.submission_id = safeText(data.submission.submission_id);
      visible.submission_exists = 'true';
      if (!visible.approval_requested_at) visible.approval_requested_at = safeText(data.submission.created_at || data.submission.submitted_at || submittedAt);
    }
    latestItemRef.current = visible;
    setItem(visible);
    resetSnapshotRef.current = clonePlain(saved);
    try { rawEditBaselineRef.current = JSON.parse(data?.item?._edit_base_json || 'null'); } catch { rawEditBaselineRef.current = null; }
    serverBaselineVerifiedRef.current = true;
    profileCommitRevisionRef.current += 1;
    setProfileVerified(true);
    setHydratingProfile(false);
    writeProfileCacheSnapshot(visible, {}, saved.candidate_id);
    // Subscribers use the committed row; typing after the request remains a local draft.
    emitCandidateUpsert(saved, { source: 'candidate_manual_commit', committed: true, submitted: action === 'submit', submission: data?.submission, instant: true });
    return { saved, visible };
  }

  async function commitProfile(requestedAction) {
    if (!item || actionLockRef.current) return null;
    const alreadySent=hasRealSubmittedWorkflow(latestItemRef.current||item,approvalState)&&String((latestItemRef.current||item)?.approval_status||approvalState).toLowerCase()!=='rejected';
    const action = requestedAction === 'submit' && !alreadySent ? 'submit' : 'save';
    if (!beginAction(action)) return null;
    cancelPendingProfileWritesForManualAction();
    markSync('saving', action === 'submit' ? 'Submitting…' : 'Saving…');
    try {
      // The draft is captured before waiting for any initial hydration.
      const submittedAt = action === 'submit'
        ? submissionStampForCommit(latestItemRef.current,commandIntentRef.current,String(composerRef.current.body || '').trim()) : '';
      let snapshot = ensureCandidateDefaults(sanitizeCandidatePayload({ ...item, ...latestItemRef.current,
        ...(submittedAt ? { submission_date: submittedAt } : {}) }));
      // CC847: the route's candidate_id is authoritative; never save a cached
      // different person's form into the currently opened candidate row.
      if (!isNewCandidate && String(snapshot.candidate_id || '').trim() !== String(candidateId || '').trim()) {
        throw new Error('Candidate identity mismatch. Profile was not saved. Reopen the correct profile or use New Candidate.');
      }
      const capturedSnapshot = clonePlain(snapshot);
      const capturedBaseline = sanitizeCandidatePayload(resetSnapshotRef.current || {});
      const writable = new Set(CRITICAL_SAVE_FIELDS);
      const editedBeforeVerification = Object.fromEntries(Object.entries(snapshot).filter(([key, value]) =>
        writable.has(key) && !['candidate_id', 'approval_status', 'notes'].includes(key)
        && String(value ?? '') !== String(capturedBaseline[key] ?? '')));
      const text = String(composerRef.current.body || '').trim();
      if (action === 'submit') { latestItemRef.current = snapshot; setItem(snapshot); }
      writeCandidateDraftSnapshot(candidateId, snapshot, resetSnapshotRef.current);
      await waitForBackgroundProfileWrite();
      if (!isNewCandidate && (!serverBaselineVerifiedRef.current || String(rawEditBaselineRef.current?.candidate_id || '') !== String(candidateId))) {
        // Only the small core-row endpoint is needed. Do not wait for notes,
        // navigation and timeline reads to finish before committing a profile.
          const data = await api.get(`/api/candidates/${candidateId}?edit_only=1`, { cacheTtlMs: 0, timeoutMs: 16000, retries: 0, allowStale: false });
          rawEditBaselineRef.current = JSON.parse(data?.item?._edit_base_json || 'null');
          if (String(rawEditBaselineRef.current?.candidate_id || '') !== String(candidateId)) throw new Error('Profile could not be verified. Your draft is safe; retry.');
          const serverItem = ensureCandidateDefaults(data.item);
          resetSnapshotRef.current = clonePlain(serverItem);
          snapshot = ensureCandidateDefaults({ ...serverItem, ...editedBeforeVerification,
            ...(submittedAt ? { submission_date: submittedAt } : {}) });
          const newerLocalEdits = Object.fromEntries(Object.entries(sanitizeCandidatePayload(latestItemRef.current || {}))
            .filter(([key, value]) => writable.has(key) && String(value ?? '') !== String(capturedSnapshot[key] ?? '')));
          latestItemRef.current = ensureCandidateDefaults({ ...snapshot, ...newerLocalEdits });
          setItem(latestItemRef.current);
          serverBaselineVerifiedRef.current = true;
          writeCandidateDraftSnapshot(candidateId, snapshot, resetSnapshotRef.current);
      }
      if (action === 'submit') {
        const validation = buildSubmitValidation(snapshot);
        if (!validation.ok) {
          setInvalidFields(validation.missingKeys || []);
          setSubmissionIssues(validation.issues || []);
          markSync('error', 'Complete the highlighted fields before Save & Submit. Save can keep an incomplete draft.');
          reportWriteFailure(Object.assign(new Error('Complete the highlighted fields before Save & Submit.'),{code:'LOCAL_VALIDATION',payload:{committed:false}}),{force:true,localRejected:true,action:'submit',path:'/local/candidate-validation',fields:validation.missingKeys||[]});
          requestAnimationFrame(() => cc560CandidateJump(validation.missingKeys?.[0] || 'save'));
          return null;
        }
      }
      const rawBase = rawEditBaselineRef.current || {};
      const fields = isNewCandidate ? sanitizeCandidatePayload(snapshot) : buildChangedFieldSavePayload(snapshot);
      if (isNewCandidate) delete fields.candidate_id;
      // CC85: displayed preset choices are real submission values, even when
      // a legacy database record still has blank columns for those presets.
      // The normal diff uses the hydrated baseline (which also displays the
      // presets); compare against the untouched server baseline for these ONLY.
      // No salary, experience, date, or profile-ownership fields are synthesized.
      if (action === 'submit' && !isNewCandidate) {
        for (const key of Object.keys(PROFILE_START_DEFAULTS)) {
          const chosen = String(snapshot[key] ?? '').trim();
          if (chosen && !String(rawBase[key] ?? '').trim() && !Object.prototype.hasOwnProperty.call(fields, key)) {
            fields[key] = snapshot[key];
          }
        }
      }
      if (action === 'submit') fields.submission_date = submittedAt;
      const edited = Object.keys(fields).filter(key => !key.startsWith('_') && !['candidate_id','created_at','updated_at'].includes(key));
      const baseValues = isNewCandidate ? {} : Object.fromEntries(edited.map(key => [key, rawBase[key] ?? '']));
      if (!isNewCandidate) {
        fields._client_updated_at = String(rawBase.updated_at || '');
        fields._changed_fields = edited;
        fields._client_base_values = baseValues;
      }
      const note = text ? { body: text, note_type: 'public', parent_note_id: replyContext?.rootId || '',
        reply_to_note_id: replyContext?.replyToId || '', reply_to_username: replyContext?.replyToUsername || '' } : null;
      const resume = null; // Original resumes are temporary, never uploaded or persisted.
      const intent = buildCommitIntent(action, fields, note, baseValues, snapshot, isNewCandidate ? newDraftKey : candidateId,resume?.signature || '');
      const commitPayload = {
        command_id: intent.id, draft_id: isNewCandidate ? getNewDraftUuid() : undefined, action, fields, note,
        workflow_version: 'profile-commit-v2', workflow_release: 'CC861',
        ...(resume ? {resume:resume.payload} : {}),
      };
      // Stage retry BEFORE network request. PostgreSQL is still the only commit authority.
      if (isNewCandidate && action === 'submit') {
        if (!stageCandidateSubmit(String(user?.user_id || ''), commitPayload)) {
          // CC861: fail closed. Without an outbox, a lost server acknowledgement
          // might be mistaken for a lost candidate with no safe retry key.
          markSync('error', 'Durable draft storage unavailable. Profile not sent; keep this form open.');
          throw new Error('Profile NOT submitted: safe local retry storage is unavailable. Do not close this tab.');
        }
      }
      const data = await api.post(`/api/candidates/${isNewCandidate ? 'new' : candidateId}/commit`, commitPayload,
        { timeoutMs: 45000, retries: 0, detachedWrite: true });
      if (data?.command_id !== intent.id || data?.action !== action
        || (!isNewCandidate && String(data?.item?.candidate_id || '') !== String(candidateId))) {
        throw new Error('Save acknowledgement did not match this profile. Your draft is kept; retry the same button.');
      }
      if (isNewCandidate && action === 'save') {
        if (data?.draft_saved !== true || data?.ok !== true || data?.committed !== true || data?.draft_id !== getNewDraftUuid()) {
          throw new Error('Database did not confirm the candidate draft. Keep the form open.');
        }
        // Name, note and every field remain editable; no permanent ID before Submit.
        writeCandidateDraftSnapshot(newDraftKey, snapshot);
        commandIntentRef.current = null;
        markSync('saved', 'Draft safely saved on server. Candidate ID will be assigned on Submit.');
        setMessage('Draft saved. Submit to create a permanent Candidate ID.');
        return data;
      }
      if(text && !data.replayed && (!data.note?.id || String(data.note.body || '').trim()!==text)) throw new Error('Note acknowledgement incomplete. Your note draft is kept; retry the same button.');
      if (resume && !data.resume?.file_id) throw new Error('Resume acknowledgement missing. Retry the same button.');
      const { saved, visible } = applySuccessfulCommit(data, snapshot, action, submittedAt);
      if (data.resume?.file_id) {
        setCandidateFiles(data.files || [data.resume]); setFilesLoaded(true);
        writeProfileCacheSnapshot(visible,{files:data.files || [data.resume]},saved.candidate_id);
        if (pendingResumeRef.current?.signature === resume?.signature) {
          URL.revokeObjectURL(resume.previewUrl); pendingResumeRef.current=null; setPendingResume(null);
        }
      }
      if (data.note?.id) {
        const committedNotes=[data.note,...notes.filter(row=>String(row.id)!==String(data.note.id))];
        setNotes(current=>[data.note,...current.filter(row=>String(row.id)!==String(data.note.id))]);
        writeProfileCacheSnapshot(visible,{notes:committedNotes},saved.candidate_id);
      }
      const remainingNote = composerRef.current.body.trim() === text ? '' : composerRef.current.body;
      setNoteBody(remainingNote);
      setReplyContext(remainingNote ? composerRef.current.reply : null);
      clearCandidateDraftSnapshot(candidateId);
      if(!isNewCandidate)void api.post('/api/profile-safety/drafts',{candidate_id:candidateId,clear:true,committed_updated_at:saved.updated_at},{background:true,retries:0}).catch(()=>{});
      if (isNewCandidate && action === 'submit') {
        completeCandidateSubmit(String(user?.user_id || ''), getNewDraftUuid());
        clearCandidateDraftSnapshot(newDraftKey); clearNewDraftUuid();
      }
      if (!sameCandidatePayload(visible, saved) || remainingNote) writeCandidateDraftSnapshot(saved.candidate_id, visible, saved);
      commandIntentRef.current = null;
      setInvalidFields([]); setSubmissionIssues([]);
      if (action === 'submit') setStatusFlash('pending');
      markSync('saved', action === 'submit' ? 'Submitted' : 'Saved');
      setMessage(action === 'submit' ? 'Saved & submitted successfully.' : 'Saved.');
      if (isNewCandidate) navigateCreatedCandidateInPlace(saved.candidate_id, visible, {
        notes: data.note ? [data.note, ...notes] : notes, noteBody: remainingNote,
        candidateFiles: data.files || candidateFiles,
        message: action === 'submit' ? 'Saved & submitted successfully.' : 'Saved', invalidFields: [], submissionIssues: [],
      });
      return data;
    } catch (error) {
      if (error?.code === 'PROFILE_CONFLICT') setSubmissionIssues([error.message]);
      if (error?.code === 'NOTE_REQUIRED') {setNoteRequiredError(true);requestAnimationFrame(()=>cc560CandidateJump('master_notes'));}
      markSync('error', error?.message || 'Could not confirm the save. Your draft is safe; retry the same button.');
      reportWriteFailure(error,{force:true,path:'/api/candidates/'+(isNewCandidate?'new':candidateId)+'/commit',action});
      return null;
    } finally { endAction(); }
  }

  async function saveProfileOnly() { return commitProfile('save'); }
  async function save(e) { e?.preventDefault?.(); return commitProfile('save'); }

  async function checkJdFit() {
    const profile=ensureCandidateDefaults(sanitizeCandidatePayload(latestItemRef.current||item||{}));
    const cached=readPageCache('jd-centre-cc803',[]);
    const initial=buildJdFitSummary(profile,Array.isArray(cached)?cached:[]);
    setJdSuggestionPopup({...initial,loading:true});
    try{
      const data=await api.get('/api/jds',{cacheTtlMs:15000,allowStale:false,timeoutMs:15000,retries:0,background:false});
      const rows=data.items||[];writePageCache('jd-centre-cc803',rows);
      const current=ensureCandidateDefaults(sanitizeCandidatePayload(latestItemRef.current||profile));
      const fit=buildJdFitSummary(current,rows);
      setJdSuggestionPopup(previous=>previous?{...fit,loading:false}:null);
    }catch(error){setJdSuggestionPopup(previous=>previous?{...previous,loading:false,error:error.message||'JD refresh failed. Retry.'}:null);}
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
      // Submission approval must not change recruiter-selected candidate Status.
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
    if(!jdId||jdPopupBusyId)return;
    setJdPopupBusyId(String(jdId));
    try{const cached=readPageCache('jd-centre-cc803',[]).find(row=>String(row.jd_id)===String(jdId));
      const jd=cached||(await api.get('/api/jds/'+encodeURIComponent(jdId),{cacheTtlMs:0,retries:0})).item;
      if(!jd)throw new Error('JD not found.');
      await openJdShareDialog(jd,[latestItemRef.current||item]);
    }catch(e){markSync('error',e.message||'JD preparation failed.');}
    finally{setJdPopupBusyId('');}
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

  async function submitForApproval() { return commitProfile('submit'); }

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
      // The new candidate's note is part of its server draft, never a separate
      // early INSERT. Submit commits candidate, note and approval request together.
      return commitProfile('save');
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
    const signature=JSON.stringify([String(candidateId),body,payload.parent_note_id,payload.reply_to_note_id,payload.reply_to_username]);
    if(cc928NoteIntentRef.current?.signature!==signature)cc928NoteIntentRef.current={signature,key:crypto.randomUUID()};
    payload.client_note_key=cc928NoteIntentRef.current.key;
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
        if (!saved?.id || String(saved.candidate_id)!==String(candidateId) || String(saved.body||'').trim()!==body)
          throw Object.assign(new Error('Note confirmation was incomplete. Text is restored; check the latest notes before retrying.'),{code:'WRITE_ACK_INVALID'});
        setNotes((current) => (current || []).map((row) => String(row?.id || '') === String(optimisticNote?.id || '') ? { ...optimisticNote, ...saved } : row));
        cc928NoteIntentRef.current=null;
        markSync('saved', payload.reply_to_note_id ? 'Reply saved.' : 'Note saved.');
      })
      .catch((err) => {
        // Roll back only this failed optimistic note, never newer employee work.
        setNotes((current) => (current || []).filter((row) => String(row?.id || '') !== String(optimisticNote?.id || '')));
        setTimeline((current) => (current || []).filter((row) => String(row?.id || '') !== String(optimisticTimeline?.id || '')));
        setNoteBody((current) => current ? current : body);
        setReplyContext((current) => current || beforeReplyContext || null);
        markSync('error', err?.message || 'Note could not sync. Text restored for retry.');
        reportWriteFailure(err,{force:true,path:'/api/candidates/'+candidateId+'/notes',method:'POST'});
        return null;
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
    const profile = latestItemRef.current || item;
    if (!profile?.phone) return;
    // A draft's displayed ID is only a preview. Dial the visible number now;
    // Save/autosave continues independently and must never delay a phone click.
    const dialId = isNewCandidate ? '' : candidateId;
    markSync('saving', 'Sending call to paired mobile app...');
    try {
      await dialCandidateWithLog(dialId, profile.phone || '', { candidate_name: profile.full_name || profile.name || '', process: profile.process || profile.jd_name || '', location: profile.location || profile.preferred_location || '' });
      markSync('saved', 'Call sent to paired phone.');
    } catch (err) {
      markSync('error', err.message || 'Pair mobile app first, then call again.');
      try { window.alert(err.message || 'Pair mobile app first, then call again.'); } catch {}
    }
  }

  function openWhatsApp(text = '') {
    openWhatsAppWithLog(isNewCandidate?'':candidateId, item?.phone || '', text);
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
    const hasAnyInput = String(nextParts.years || '').trim() !== '' || String(nextParts.months || '').trim() !== '';
    const totalMonths = hasAnyInput ? joinExperienceValue(nextParts.years, nextParts.months) : '';
    const nextPayload = { [fieldKey]: totalMonths };
    if (fieldKey === 'relevant_experience') nextPayload.relevant_experience_range = hasAnyInput ? expRange(totalMonths) : '';
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
    const fresh = String(window.prompt('Add new preferred location') || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!fresh) return;
    const nextOptions = [...new Set([...preferredLocations, fresh])];
    // Instant frontend first; the permanent shared write runs behind it once.
    setPreferredLocations(nextOptions);
    persistPreferredLocations(nextOptions);
    void api.post('/api/candidates/process-options', { kind: 'preferred_location', name: fresh }, { timeoutMs: 15000, retries: 1 })
      .then((data) => {
        const shared = safeArray(data?.preferred_location_options || data?.items).map((entry) => safeText(entry)).filter(Boolean);
        if (shared.length) {
          const merged = [...new Set([...nextOptions, ...shared])];
          setPreferredLocations(merged);
          persistPreferredLocations(merged);
        }
        setMessage(`Preferred location added to dropdown permanently: ${fresh}`);
      })
      .catch((err) => {
        setMessage(err?.message || `Location selected. Permanent server save will need retry when connection is available: ${fresh}`);
      });
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

  function isMyNote(note){const principal=String(note?.user_id||note?.created_by_user_id||note?.username||'').trim().toLowerCase();return Boolean(principal)&&[user?.user_id,user?.username,user?.full_name,user?.recruiter_code].some(v=>String(v||'').trim().toLowerCase()===principal);}
  function renderNoteThread(thread, includeAllReplies = true) {
    if (!thread?.root) return null;
    const rootId = normalizeNoteId(thread.root.id);
    const isReplyingHere = replyContext?.rootId === rootId;
    const replies = includeAllReplies ? (thread.replies || []) : (thread.replies || []).slice(-2);
    return (
      <div key={rootId || `note-thread-${thread.root.created_at}`} className="candidate-note-thread">
        <div data-note-id={thread.root.id} className={'candidate-note-bubble candidate-note-root-bubble '+(isMyNote(thread.root)?'cc834-note-own':'cc834-note-other')}>
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
                <div key={reply.id || `${rootId}-${reply.created_at}`} data-note-id={reply.id} className={'candidate-note-bubble candidate-note-reply-bubble '+(isMyNote(reply)?'cc834-note-own':'cc834-note-other')}>
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
            <button className="ghost-btn bounceable" type="button" onClick={backToSource}>Back</button>
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
          <div className="row-actions top-gap" data-profile-workflow="profile-commit-v2">
            <button className="ghost-btn bounceable" type="button" onClick={backToSource}>Back to Candidates</button>
            <button className="add-profile-btn bounceable" type="button" onClick={load}>Retry</button>
          </div>
        </div>
      </Layout>
    );
  }

  const canDeleteProfile = ['admin', 'manager'].includes(String(user?.role || '').toLowerCase());
  async function deleteCurrentCandidate() {
    if (!canDeleteProfile || !item?.candidate_id) return;
    const reason=await requestProfileDelete({candidateIds:[item.candidate_id],name:item.full_name});
    if(reason===null)return;
    try {
      const result = await api.post(`/api/candidates/${encodeURIComponent(item.candidate_id)}/delete`, {reason}, { timeoutMs: 45000,retries:0 });
      const done = [...(Array.isArray(result?.deleted_ids) ? result.deleted_ids : []), ...(Array.isArray(result?.soft_hidden_ids) ? result.soft_hidden_ids : [])];
      if (!done.includes(String(item.candidate_id))) throw new Error('Profile still exists after delete check.');
      candidateCacheRef.current[item.candidate_id] = null;
      setMessage(done.length ? `${done.length} profile removed from CRM view.` : 'Profile deleted.');
      setSyncState('saved');
      navigate('/duplicate-profiles?view=deleted&focus='+encodeURIComponent(item.candidate_id), { replace: true });
    } catch (error) {
      setSyncState('error');
      setMessage(error.message || 'Candidate could not be deleted.');
    }
  }
  const approvalState = String(item.approval_status || 'Draft').toLowerCase();
  const submittedWorkflowActive = hasRealSubmittedWorkflow(item || {}, approvalState);
  const draftWorkflowActive = !submittedWorkflowActive;
  const stateLabel = !submittedWorkflowActive ? 'Draft' : approvalState === 'approved' ? 'Approved' : approvalState === 'rejected' ? 'Rejected' : approvalState === 'pending' ? 'Pending Approval' : 'Draft';
  const bannerStatusText = submittedWorkflowActive ? (item.status || stateLabel) : 'Draft';
  const bannerDetailsText = item.all_details_sent || 'Pending';
  const draftWorkflowDisplayLocked = false;
  const detailStatusValue = String(item.status||'').trim().toLowerCase()==='approved' && String(item.all_details_sent||'').trim().toLowerCase()==='completed' ? 'All set for Interview' : currentApprovedStatus;
  const detailDetailsSentValue = approvalPending && !leadership ? 'Pending' : (item.all_details_sent || 'Pending');
  const detailsLockInfo = detailsCompletedLockInfo(item || {});
  const detailsCompletionLocked = String(detailDetailsSentValue || '').trim().toLowerCase() !== 'completed' && detailsLockInfo.locked;
  function handleDetailsSentChange(value) {
    const nextValue = String(value || '').trim();
    if (nextValue === 'Completed' && detailsCompletionLocked) {
      markSync('error', `All Details Sent can be marked completed only 10 minutes after submission${detailsLockInfo.remainingMinutes ? ` (${detailsLockInfo.remainingMinutes} min left)` : ''}.`);
      return;
    }
    // Only advance a pre-interview profile. Never downgrade an already appeared,
    // selected, joined, rejected, or backout candidate.
    const priorStatus=String(item.status||'').trim().toLowerCase();
    const advance=nextValue==='Completed'&&String(item.all_details_sent||'').toLowerCase()!=='completed'
      &&['','draft','in - progress','in-progress','approved','all set for interview'].includes(priorStatus);
    patch({ all_details_sent: nextValue || 'Pending',...(advance?{status:'All set for Interview'}:{}) });
  }
  const showApprovalDecisionControls = leadership && submittedWorkflowActive && ['pending','approved'].includes(approvalState);
  const submitButtonLabel = actionBusy === 'submit' ? 'Submitting…' : 'Save & Submit';
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
      {waEdit&&<div className="crm-modal-backdrop cc878-wa-edit-backdrop" onClick={()=>{if(!waEditBusy)setWaEdit(null);}}><section className="cc878-wa-editor" role="dialog" aria-modal="true" aria-label="Edit WhatsApp message" onClick={e=>e.stopPropagation()}><header><div><small>MANAGER MESSAGE STUDIO</small><h3>Edit WhatsApp message</h3></div><button className="ghost-btn" type="button" aria-label="Close message editor" disabled={waEditBusy} onClick={()=>setWaEdit(null)}>×</button></header><label>Message title<input aria-label="Message title" maxLength={120} value={waEdit.title} onChange={e=>setWaEdit(t=>({...t,title:e.target.value}))}/></label><label>Message text<textarea aria-label="Message text" rows={10} maxLength={8000} value={waEdit.body} onChange={e=>setWaEdit(t=>({...t,body:e.target.value}))}/></label><p className="helper-text">Keep placeholders such as {'{{first_name}}'} and {'{{recruiter_name}}'} where needed. Saved messages update for the whole team.</p>{waEditError&&<p role="alert">{waEditError}</p>}<footer><button className="ghost-btn" disabled={waEditBusy} onClick={()=>setWaEdit(null)}>Cancel</button><button className="add-profile-btn" disabled={waEditBusy||!waEdit.title.trim()||!waEdit.body.trim()} onClick={saveWaEdit}>{waEditBusy?'Saving…':'Save for everyone'}</button></footer></section></div>}
      <button type="button" className="ghost-btn cc873-back-to-list" onClick={backToSource}>← Back to list</button><CelebrationBurst active={celebrate} />
      <DuplicatePhoneNotice phone={item?.phone} candidateId={candidateId}/><div className={`panel top-gap candidate-detail-full-panel ${draftWorkflowActive ? 'candidate-draft-profile-panel' : ''} ${statusFlash ? `approval-wash approval-wash-${statusFlash}` : ''}`.trim()}>
        <div className="panel-heading-row">
          <div>
            <div className="panel-title">{isNewCandidate ? 'Add Candidate • Full Profile' : 'Candidate Profile'}</div>

          </div>
          <div className="detail-header-actions detail-header-actions-modern" data-cc804-controls="resume">
            {!isNewCandidate&&<button type="button" className="ghost-btn cc871-add-pipeline" title="Open this candidate for a new Pipeline Hub interview" onClick={()=>window.open('/revenue-hub?add_candidate='+encodeURIComponent(candidateId),'_blank','noopener,noreferrer')}>＋ Add to Pipeline Hub</button>}<button type="button" className="ghost-btn file-action-btn" disabled={!!fileBusy || !!actionBusy} onClick={()=>resumeInputRef.current?.click()}>{fileBusy ? 'Uploading…' : 'Upload Resume'}</button>
            <ContactTextExtractor disabled={!!fileBusy || !!actionBusy || editingLocked} onExtract={values=>patch(values)} />
            <MiniIconButton title="Previous Profile" className="modern-eye-btn" onClick={() => prevCandidate && openCandidate(prevCandidate.candidate_id, prevCandidate)} disabled={isNewCandidate || !prevCandidate}><PrevIcon /></MiniIconButton>
            <MiniIconButton title="Dial Call" className="modern-call-btn" onClick={onDial} disabled={!item.phone || Boolean(actionBusy)}><PhoneIcon /></MiniIconButton>
            <div className="wa-template-shell">
              
              <MiniIconButton title="Open WhatsApp" className="modern-wa-btn" onClick={() => openWhatsApp('')} disabled={!item.phone}><WhatsAppIcon /></MiniIconButton>

              <PremiumSelect onEditOption={['manager','admin'].includes(String((actor||user)?.role||'').toLowerCase())?editWa:undefined} className="wa-template-select" aria-label="WhatsApp template" defaultValue="" onChange={(e) => { useWaTemplate(e.target.value); e.target.value = ''; }}><option value="">WA Template</option>{safeArray(waTemplates).slice(0, 80).map((tpl, index) => { const option = normalizeWhatsAppTemplateOption(tpl, index); return option ? <option key={`${option.title}-${index}`} value={encodeWhatsAppTemplateOption(option, index)}>{option.title}</option> : null; })}<option value="__add_new__">Add New…</option></PremiumSelect>
            </div>
            <MiniIconButton title="Next Profile" className="modern-eye-btn" onClick={openNextCandidate} disabled={isNewCandidate || (!nextCandidate && !hasMoreNavAfter && !canProbeNextNavPage && !fetchingNavPage)}>{fetchingNavPage ? <span style={{fontWeight:1000,fontSize:12}}>...</span> : <NextIcon />}</MiniIconButton>
            {!isNewCandidate && canDeleteProfile ? <button type="button" className="mini-btn edit bounceable modern-delete-btn" onClick={deleteCurrentCandidate}>Delete</button> : null}
          </div>
        </div>


        

        <div className={`approval-action-banner state-${approvalState || 'draft'}`}>
          <div className="approval-banner-left">
            <span className={`profile-state-chip state-${approvalState || 'draft'}`}>{stateLabel}</span>
            {syncState !== 'idle' ? (
              <span className={`mini-chip sync-chip ${syncState}`}>{syncState === 'saving' ? 'Saving…' : syncState === 'saved' ? 'Saved' : 'Save failed'}</span>
            ) : null}

          </div>
          <div className="approval-banner-right approval-banner-right-with-view">
            <div className="last-viewed-highlight">
              <span className="last-viewed-label">Last Viewed</span>
              <strong>{formatLastViewedStamp(item.last_viewed_at)}</strong>
            </div>
            {showApprovalDecisionControls ? (
              <div className="approval-banner-actions approval-banner-noteonly" style={{ display: 'grid', gap: 10, justifyItems: 'end', minWidth: 260 }}>
                <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                  {approvalState==='pending'&&<button className="mini-btn call bounceable" type="button" disabled={approvalDecisionBusy === 'approve' || approvalDecisionBusy === 'reject'} onClick={approveFromDetail}>Approve</button>}
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
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="cc560-quicknav" role="navigation" aria-label="Candidate quick jump">
          <span className="cc560-quicknav-label">QUICK NAVIGATION</span>
          <div className="cc560-quicknav-scroll">
            {[
              ['Contact', 'full_name'], ['Location', 'preferred_location'],
              ['Qualification','qualification'], ['Experience', 'total_experience'], ['Salary', 'ctc_monthly'],
              ['Interview', 'interview_reschedule_date'], ['Status', 'status'],
              ['Notes', 'master_notes'], ['Save', 'save'],
            ].map(([label, section],index) => (
              <button key={section} data-jump={section} className="cc560-jump-btn" type="button" onClick={() => cc560CandidateJump(section)}><span className="cc801-jump-index">{String(index+1).padStart(2,'0')}</span>{label}<span className="cc801-jump-arrow" aria-hidden="true">↗</span></button>
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

        {canArrangeFields&&<div className="cc831-layout-tools"><button type="button" className="ghost-btn" onClick={()=>setLayoutMode(v=>!v)}>{layoutMode?'Exit arrangement':'Arrange fields'}</button>{layoutMode&&<><span>Drag a field onto another field. Save to apply for everyone.</span><button type="button" className="add-profile-btn" disabled={layoutBusy} onClick={saveSharedLayout}>{layoutBusy?'Saving…':'Save shared layout'}</button><button type="button" className="ghost-btn" onClick={()=>setFieldOrder(DEFAULT_CANDIDATE_FIELD_ORDER)}>Default order</button></>}</div>}
        <form className="stack-form" ref={formRef} onSubmit={(event) => event.preventDefault()} onKeyDown={moveToNextField}>
          <div className="candidate-sequence-shell">
            <div className={"cc783-fields-grid cc833-classic-fields "+(layoutMode?"is-arranging":"")}>
<div className="candidate-meta-row">
              {!isNewCandidate && <div className="field compact-id-field candidate-meta-card"><label>Candidate ID</label><input className="compact-id-input" value={item.candidate_id || ''} readOnly /></div>}
              <div className="field compact-id-field candidate-meta-card" data-field="recruiter_code" {...sortableFieldProps('recruiter_code')}>
                <label>Recruiter</label>
                {canManagerReassignRecruiter ? (
                  <SelectField label="" value={item.recruiter_code || ''}
                    options={safeArray(recruiterOptions).map((row) => safeText(row?.recruiter_code || row?.user_code || row?.employee_code || row?.username || ''))}
                    onChange={(code) => {
                    const matched = safeArray(recruiterOptions).find((row) => safeText(row?.recruiter_code || row?.user_code || row?.employee_code || row?.username || '') === safeText(code));
                    const currentCode = safeText(user?.recruiter_code || user?.user_code || user?.employee_code || user?.username || '');
                    const currentName = safeText(user?.full_name || user?.name || user?.display_name || user?.employee_name || user?.username || '');
                    const itemName = safeText(item.recruiter_name || '');
                    patch({ recruiter_code: code, recruiter_name: safeText(matched?.full_name || matched?.name || matched?.display_name || matched?.employee_name || matched?.username || (safeText(code) === currentCode ? currentName : '') || (safeText(code) === safeText(item.recruiter_code) && itemName !== safeText(code) ? itemName : '') || '') });
                    }} optionLabel={(code) => {
                      const matched = safeArray(recruiterOptions).find((row) => safeText(row?.recruiter_code || row?.user_code || row?.employee_code || row?.username || '') === safeText(code));
                      const currentCode = safeText(user?.recruiter_code || user?.user_code || user?.employee_code || user?.username || '');
                      const currentName = safeText(user?.full_name || user?.name || user?.display_name || user?.employee_name || user?.username || '');
                      const itemName = safeText(item.recruiter_name || '');
                      const name = safeText(matched?.full_name || matched?.name || matched?.display_name || matched?.employee_name || matched?.username || (safeText(code) === currentCode ? currentName : '') || (safeText(code) === safeText(item.recruiter_code) && itemName !== safeText(code) ? itemName : '') || 'Recruiter');
                      const recruiterCode = safeText(matched?.recruiter_code || matched?.user_code || matched?.employee_code || matched?.username || code);

                      return name;
                    }} />
                ) : <input className="compact-id-input recruiter-identity-input" value={displayStaffName(item.recruiter_user_id||item.recruiter_code,item.recruiter_name||user?.full_name||'Team member')} readOnly />}
              </div>
              <div className="candidate-meta-card candidate-meta-support-item" data-field="call_connected" {...sortableFieldProps('call_connected')}><ChoiceField compact label="Call Connected" value={item.call_connected || ''} options={CALL_CONNECTED_OPTIONS} onChange={(value) => patch({ call_connected: value })} disabled={editingLocked} /></div>
              <div className="candidate-meta-card candidate-meta-support-item" data-field="looking_for_job" {...sortableFieldProps('looking_for_job')}><ChoiceField compact label="Looking for Job" value={item.looking_for_job || 'Yes'} options={LOOKING_FOR_JOB_OPTIONS} onChange={(value) => patch({ looking_for_job: value })} disabled={editingLocked} invalid={invalidFields.includes('looking_for_job')} /></div>
            </div>
{leadership&&<div className="field" data-field="project_id" {...sortableFieldProps('project_id')}><label>Project access</label><select value={item.project_id||''} disabled={editingLocked||(!isNewCandidate&&!canArrangeFields&&String(item.recruiter_user_id||'')!==String(user?.user_id||''))} onChange={e=>patch({project_id:e.target.value})}><option value="">Solo team</option>{projectChoices.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}{item.project_id&&!projectChoices.some(p=>p.id===item.project_id)&&<option value={item.project_id}>Previous project · owner access</option>}</select></div>}<section className="cc790-field-section cc790-contact" data-section="contact"><h3>Contact & location</h3><div className="cc790-section-grid"><div className={`field ${invalidFields.includes('full_name') ? 'invalid-field' : ''}`.trim()} data-field="full_name" {...sortableFieldProps('full_name')}><label>Name</label><input className={invalidFields.includes('full_name') ? 'invalid-input' : ''} value={item.full_name || ''} onChange={(e) => patch({ full_name: e.target.value })} disabled={editingLocked} /></div>
<div className={`field ${invalidFields.includes('phone') ? 'invalid-field' : ''}`.trim()} data-field="phone" {...sortableFieldProps('phone')}><label>Number</label><div className="candidate-phone-input-shell"><span className="candidate-phone-prefix">+91</span><input className={invalidFields.includes('phone') ? 'invalid-input' : ''} type="tel" key={String(item.candidate_id||'phone-field')} inputMode="numeric" pattern="[0-9]+" autoComplete="tel-national" value={normalizeIndianPhone(item.phone??'')} onChange={e=>{const digits=normalizeIndianPhone(e.target.value);if(!/^[0-9]*$/.test(digits)){setMessage('Only digits can be entered in the phone number.');return;}patch({phone:digits});}} onPaste={e=>{const raw=e.clipboardData.getData('text').trim();const digits=normalizeIndianPhone(raw);e.preventDefault();if(!/^[0-9]+$/.test(digits)){setMessage('Paste was not applied. Use digits only.');return;}patch({phone:digits});}} disabled={editingLocked}/></div></div>
<div className="field" data-field="email" {...sortableFieldProps('email')}><label>Email</label><input type="email" autoComplete="email" value={item.email || ''} onChange={e=>patch({email:e.target.value})} disabled={editingLocked}/></div>
<div className={`field ${invalidFields.includes('location') ? 'invalid-field' : ''}`.trim()} data-field="location" {...sortableFieldProps('location')}><label>Location</label><input className={invalidFields.includes('location') ? 'invalid-input' : ''} value={item.location || ''} onChange={(e) => patch({ location: e.target.value })} disabled={editingLocked} /></div>
<div data-field="preferred_location" {...sortableFieldProps('preferred_location')}><MultiChoiceField label="Preferred Location" value={canonicalPreferredLocationValue(item.preferred_location || '', preferredLocations)} options={safeTemplateList(preferredLocations, 80)} onChange={(value) => { rememberPreferredLocationUse(value); patch({ preferred_location: canonicalPreferredLocationValue(value, preferredLocations) }); }} presets={preferredLocationPresets()} onAddNew={addPreferredLocationOption} disabled={editingLocked} invalid={invalidFields.includes('preferred_location')} keepOneSelected strictOptions/></div></div></section>
<section className="cc790-field-section cc790-qualification" data-section="qualification"><h3>Qualification</h3><div className="cc790-section-grid"><CourseComboField sortableProps={sortableFieldProps('qualification')} value={item.course_name || item.qualification || ''} onChange={(value) => patch({ qualification: value, course_name: value })} disabled={editingLocked} invalid={invalidFields.includes('qualification')}/>
<div data-field="qualification_level" {...sortableFieldProps('qualification_level')}><ChoiceField label="Degree" value={item.qualification_level === 'Postgraduate' ? 'Graduate' : (item.qualification_level || 'Graduate')} options={DEGREE_OPTIONS} onChange={(value) => patch({ qualification_level: value })} disabled={editingLocked} invalid={invalidFields.includes('qualification_level')} /></div></div></section>
<section className="cc790-field-section cc790-experience" data-section="experience"><h3>Experience</h3><div className="cc790-section-grid"><div className={`field exp-split-field ${(invalidFields.includes('total_experience') || liveExperienceInvalid) ? 'invalid-field live-invalid-field' : ''}`.trim()} data-field="total_experience" {...sortableFieldProps('total_experience')}><label>Total Experience</label><div className="split-exp-grid"><input className={(invalidFields.includes('total_experience') || liveExperienceInvalid) ? 'invalid-input live-invalid-input' : ''} value={totalExperienceParts.years} onChange={(e) => patchExperienceField('total_experience', 'years', e.target.value)} disabled={editingLocked} aria-label="Years of experience" inputMode="numeric" placeholder="Years" /><input className={(invalidFields.includes('total_experience') || liveExperienceInvalid) ? 'invalid-input live-invalid-input' : ''} value={totalExperienceParts.months} onChange={(e) => patchExperienceField('total_experience', 'months', e.target.value)} disabled={editingLocked} aria-label="Months of experience" inputMode="numeric" placeholder="Months" /></div>{String(item.total_experience ?? '').trim() ? <div className="helper-text top-gap-small">Saved as: {formatExperiencePreview(item.total_experience)}</div> : null}{liveExperienceInvalid ? <div className="helper-text top-gap-small live-validation-text">{experienceGuardText}</div> : null}</div>
<div className={`field exp-split-field ${(invalidFields.includes('relevant_experience') || liveExperienceInvalid) ? 'invalid-field live-invalid-field' : ''}`.trim()} data-field="relevant_experience" {...sortableFieldProps('relevant_experience')}><div className="field-label-line"><label>Relevant Experience</label><button type="button" className="mini-inline-action bounceable cc801-same" disabled={editingLocked} onClick={copyTotalExperienceToRelevant}>Same</button></div><div className="split-exp-grid"><input className={(invalidFields.includes('relevant_experience') || liveExperienceInvalid) ? 'invalid-input live-invalid-input' : ''} value={relevantExperienceParts.years} onChange={(e) => patchExperienceField('relevant_experience', 'years', e.target.value)} disabled={editingLocked} aria-label="Years of experience" inputMode="numeric" placeholder="Years" /><input className={(invalidFields.includes('relevant_experience') || liveExperienceInvalid) ? 'invalid-input live-invalid-input' : ''} value={relevantExperienceParts.months} onChange={(e) => patchExperienceField('relevant_experience', 'months', e.target.value)} disabled={editingLocked} aria-label="Months of experience" inputMode="numeric" placeholder="Months" /></div>{String(item.relevant_experience ?? '').trim() ? <div className="helper-text top-gap-small">Saved as: {formatExperiencePreview(item.relevant_experience)}</div> : null}{liveExperienceInvalid ? <div className="helper-text top-gap-small live-validation-text">{experienceGuardText}</div> : null}</div>
<div data-field="relevant_experience_range" {...sortableFieldProps('relevant_experience_range')}><div className="field field-with-header-action"><div className="field-label-line"><label>Relevant Experience Range</label><button type="button" className="mini-inline-action bounceable cc801-same" disabled={editingLocked} onClick={matchRelevantExperienceRange}>Same</button></div><SelectField label="" value={item.relevant_experience_range || ''} options={EXPERIENCE_RANGE_OPTIONS} onChange={(value) => patch({ relevant_experience_range: value })} disabled={editingLocked} invalid={invalidFields.includes('relevant_experience_range')} /></div></div>
<div data-field="career_gap" {...sortableFieldProps('career_gap')}><ChoiceField label="Career Gap" value={item.career_gap || 'Fresher'} options={(parseMonthCount(item.total_experience)>0 || parseMonthCount(item.relevant_experience)>0) ? CAREER_GAP_OPTIONS.filter(value=>value!=='Fresher') : CAREER_GAP_OPTIONS} onChange={(value) => patch({ career_gap: value })} disabled={editingLocked} invalid={invalidFields.includes('career_gap')} strictOptions /></div></div></section>
<section className="cc790-field-section cc790-salary" data-section="salary"><h3>Salary & documents</h3><div className="cc790-section-grid"><div className={`field ${(invalidFields.includes('ctc_monthly') || liveSalaryInvalid || salaryInputError) ? 'invalid-field live-invalid-field' : ''}`.trim()} data-field="ctc_monthly" {...sortableFieldProps('ctc_monthly')}><label>CTC Monthly</label><div className="cc787-currency-input"><span aria-hidden="true">₹</span><input className={(invalidFields.includes('ctc_monthly') || liveSalaryInvalid || salaryInputError) ? 'invalid-input live-invalid-input' : ''} value={item.ctc_monthly ?? ''} onChange={(e) => handleSalaryFieldChange('ctc_monthly', e.target.value, 'CTC Monthly')} onBeforeInput={(e) => handleSalaryBeforeInput(e, 'CTC Monthly')} onPaste={(e) => handleSalaryPaste(e, 'CTC Monthly')} inputMode="numeric" pattern="[0-9]*" disabled={editingLocked} /></div>{salaryInputError ? <div className="helper-text top-gap-small live-validation-text">{salaryInputError}</div> : liveSalaryInvalid ? <div className="helper-text top-gap-small live-validation-text">{salaryGuardText}</div> : null}</div>
<div className={`field ${(invalidFields.includes('in_hand_salary') || liveSalaryInvalid || salaryInputError) ? 'invalid-field live-invalid-field' : ''}`.trim()} data-field="in_hand_salary" {...sortableFieldProps('in_hand_salary')}><div className="field-label-line"><label>In-hand Monthly Salary</label><button type="button" className="mini-inline-action bounceable cc801-same cc573-inline-same-btn" disabled={editingLocked} onClick={()=>patch({in_hand_salary:item.ctc_monthly || '0'})}>Same</button></div><div className="cc787-currency-input"><span aria-hidden="true">₹</span><input className={(invalidFields.includes('in_hand_salary') || liveSalaryInvalid || salaryInputError) ? 'invalid-input live-invalid-input' : ''} value={item.in_hand_salary ?? ''} onChange={(e) => handleSalaryFieldChange('in_hand_salary', e.target.value, 'In-hand Monthly Salary')} onBeforeInput={(e) => handleSalaryBeforeInput(e, 'In-hand Monthly Salary')} onPaste={(e) => handleSalaryPaste(e, 'In-hand Monthly Salary')} inputMode="numeric" pattern="[0-9]*" disabled={editingLocked} /></div>{salaryInputError ? <div className="helper-text top-gap-small live-validation-text">{salaryInputError}</div> : liveSalaryInvalid ? <div className="helper-text top-gap-small live-validation-text">{salaryGuardText}</div> : null}</div>
<div data-field="relevant_in_hand_range" {...sortableFieldProps('relevant_in_hand_range')}><div className="field field-with-header-action"><div className="field-label-line"><label>In-hand Salary Range</label><button type="button" className="mini-inline-action bounceable cc801-same" disabled={editingLocked} onClick={matchSalaryRange}>Same</button></div><SelectField label="" value={item.relevant_in_hand_range || ''} options={SALARY_RANGE_OPTIONS} onChange={(value) => patch({ relevant_in_hand_range: value })} disabled={editingLocked} invalid={invalidFields.includes('relevant_in_hand_range')} /></div></div>
<div data-field="documents_availability" {...sortableFieldProps('documents_availability')}><ChoiceField label="All Documents Availability" value={normalizeDocumentsAvailability(item.documents_availability || 'Yes')} options={DOCUMENTS_OPTIONS} onChange={(value) => patch({ documents_availability: value })} disabled={editingLocked} invalid={invalidFields.includes('documents_availability')} showAll strictOptions /></div></div></section>
<section className="cc790-field-section cc790-interview" data-section="interview"><h3>Interview & follow-up</h3><div className="cc790-section-grid"><div data-field="virtual_onsite" {...sortableFieldProps('virtual_onsite')}><ChoiceField label="Interview Mode" value={item.virtual_onsite || 'Walkin'} options={INTERVIEW_MODE_OPTIONS} onChange={(value) => patch({ virtual_onsite: value })} disabled={editingLocked} invalid={invalidFields.includes('virtual_onsite')} strictOptions /></div>
<div className={`field ${invalidFields.includes('interview_reschedule_date') ? 'invalid-field' : ''}`.trim()} data-field="interview_reschedule_date" {...sortableFieldProps('interview_reschedule_date')}><label>Interview Date</label><div className="weekday-date-wrap"><input type="date" value={selectedDate} onChange={(e) => patch({ interview_reschedule_date: e.target.value })} disabled={editingLocked} /></div><div className="weekday-shortcuts">{WEEKDAY_CHOICES.map((day) => <button key={day} type="button" className={`weekday-chip bounceable ${day===todayWeekday() ? 'cc801-today' : ''}`} title={day===todayWeekday() ? 'Today' : day} disabled={editingLocked} onClick={() => patch({ interview_reschedule_date: nextDateForWeekday(day) })}>{day.slice(0, 3)}</button>)}</div><div className="row-actions top-gap-small"><button className="ghost-btn bounceable" type="button" onClick={() => (canDirectRemoveInterview ? removeInterviewDateDirectly() : setRemoveInterviewOpen(true))} disabled={editingLocked || !item?.interview_reschedule_date}>{canDirectRemoveInterview ? 'Remove' : 'Request Remove'}</button>{String(item?.interview_remove_status || '').toLowerCase() === 'pending' && <span className="helper-text">Removal request pending.</span>}</div></div>
<div className="field field-followup-panel" data-field="follow_up_at" {...sortableFieldProps('follow_up_at')}><label>Follow-up</label><CrmDateTimeInput type="datetime-local" value={toDateTimeLocalInput(item.follow_up_at || '')} onChange={(e) => patch({ follow_up_at: e.target.value, follow_up_status: e.target.value ? 'Open' : '' })} disabled={editingLocked} /><div className="choice-chip-row compact-row top-gap-small followup-preset-row">{safeArray(FOLLOW_UP_PRESETS).map((preset) => <button key={preset.label} type="button" className="choice-chip bounceable" disabled={editingLocked} onClick={() => applyFollowUpPreset(preset)}>{preset.label}</button>)}<button type="button" className="choice-chip bounceable" disabled={editingLocked} onClick={() => patch({ follow_up_at: '', follow_up_status: '', follow_up_note: '' })}>Clear</button></div><details className="cc783-followup-note"><summary>Follow-up note{item.follow_up_note ? ' · added' : ''}</summary><div className="field-subnote-title top-gap-small">Follow-up Notes</div><textarea rows="3" className="followup-note-textarea" value={item.follow_up_note || ''} onChange={(e) => patch({ follow_up_note: e.target.value })} disabled={editingLocked} placeholder="Mention follow-up note so the reminder also shows it." /></details></div></div></section>
<section className="cc790-field-section cc790-workflow" data-section="workflow"><h3>Profile & submission</h3><div className="cc790-section-grid"><div data-field="communication_skill" {...sortableFieldProps('communication_skill')}><ChoiceField label="Communication Skill" value={item.communication_skill || 'Good'} options={COMMUNICATION_SKILL_OPTIONS} onChange={(value) => patch({ communication_skill: value })} disabled={editingLocked} invalid={invalidFields.includes('communication_skill')} /></div>
<div data-field="profile_priority" {...sortableFieldProps('profile_priority')}><ChoiceField label="Priority" value={item.profile_priority || 'Medium'} options={PROFILE_PRIORITY_OPTIONS} onChange={(value) => patch({ profile_priority: value })} disabled={editingLocked} showAll strictOptions /></div>
<div data-field="status" {...sortableFieldProps('status')}><div className="cc701-status-shell"><ChoiceField label="Status" value={detailStatusValue} options={STATUS_OPTIONS} onChange={(value) => patch({ status: value })} disabled={editingLocked && !leadership} invalid={invalidFields.includes('status')} showAll strictOptions />{item.status && !currentApprovedStatus ? <span className="helper-text">Existing status: {safeText(item.status)}</span> : null}</div></div>
<div data-field="all_details_sent" {...sortableFieldProps('all_details_sent')}><ChoiceField label="All Details Sent" value={detailDetailsSentValue} options={DETAILS_SENT_OPTIONS} onChange={handleDetailsSentChange} disabled={editingLocked && !leadership} invalid={invalidFields.includes('all_details_sent')} showAll disabledOptions={detailsCompletionLocked ? ['Completed'] : []} />{detailsCompletionLocked ? <div className="helper-text top-gap-small">Completed lock: Completed can be marked only 10 minutes after profile submission{detailsLockInfo.remainingMinutes ? ` (${detailsLockInfo.remainingMinutes} min left)` : ''}.</div> : null}</div>
<LiveSubmissionDateField storedValue={item.submission_date || ''} submitted={submittedWorkflowActive} invalid={invalidFields.includes('submission_date')} disabled={editingLocked} manual={item.__cc801_submission_date_manual==='1'} onChange={value => patch({ submission_date: value, __cc801_submission_date_manual:value ? '1' : '0' })} />
<div className="field" data-field="process" {...sortableFieldProps('process')}><MultiChoiceField label="Process" value={item.process || ''} options={processOptions} onChange={(value) => patch({ process: value })} onAddNew={addNewProcessOption} disabled={editingLocked} invalid={invalidFields.includes('process')} strictOptions /></div></div></section>
</div>
            <SafeSectionBoundary title="Notes Chat">
            <div className="panel top-gap-small candidate-notes-chat-panel" data-field="master_notes" {...sortableFieldProps('master_notes')} ref={notesPanelRef}>
              <div className="panel-heading-row">
                <div>
                  <div className="panel-title">Notes Chat</div>
                </div>
                <div className="candidate-notes-head-tools">

                  <button type="button" className="ghost-btn bounceable" onClick={() => setShowHistory(true)} disabled={noteThreads.length <= 5}>Open Notes History</button>
                </div>
              </div>
              <div className="cc783-note-template"><PremiumSelect aria-label="Preset notes" defaultValue="" onChange={(e) => { useNoteTemplate(e.target.value); e.target.value = ''; }}><option value="">Preset note…</option>{safeTemplateList(noteTemplates, 80).map((tpl) => <option key={tpl} value={tpl}>{tpl}</option>)}<option value="__add_new__">Add New…</option></PremiumSelect></div>
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
                    rows="3"
                    className="candidate-notes-main-textarea"
                    value={noteBody}
                    onChange={(e) => {
                      setNoteBody(e.target.value);
                      if (e.target.value.trim()) {
                        setNoteRequiredError(false);
                        setSubmissionIssues((current) => (current || []).filter((line) => !String(line || '').toLowerCase().includes('note required')));
                      }
                    }}
                    placeholder={replyContext ? 'Type reply. Save will save the reply automatically.' : 'Type note. Save or Save & Submit will save it automatically.'}
                  />
                </div>
              </div>

            </div>
            </SafeSectionBoundary>
          </div>

          <div className="row-actions top-gap" data-profile-workflow="profile-commit-v2" data-workflow-release="CC861">
            <button className="ghost-btn bounceable candidate-action-btn candidate-reset-btn" type="button" onClick={resetFilledDetails} disabled={Boolean(actionBusy)}>Reset</button>
            <button className="add-profile-btn bounceable candidate-action-btn candidate-check-jd-btn" type="button" onClick={checkJdFit} disabled={Boolean(actionBusy)}>{'Check JD'}</button>
            <button className="add-profile-btn bounceable candidate-action-btn candidate-save-btn" type="button" onClick={save} disabled={Boolean(actionBusy)} aria-busy={actionBusy === 'save'} title="Save profile details without submitting for approval" style={{ minWidth: 92, paddingInline: 18 }}>{actionBusy === 'save' ? 'Saving…' : 'Save'}</button>
            {(!submittedWorkflowActive || approvalState==='rejected') && <button className="add-profile-btn bounceable candidate-action-btn candidate-submit-btn" type="button" onClick={submitForApproval} disabled={Boolean(actionBusy)} aria-busy={actionBusy === 'submit'} title="Save the latest details and submit for approval in one action">{submitButtonLabel}</button>}
            {!!message && <span className={`helper-text sync-message ${syncState === 'error' ? 'is-error' : syncState === 'saved' ? 'is-success' : ''}`}>{message}</span>}
          </div>
          {submissionIssues.length ? <div className="top-gap-small">{submissionIssues.map((issue, index) => <div key={`submit-issue-${index}`} className="helper-text sync-message is-error">{issue}</div>)}</div> : null}

          <SafeSectionBoundary title="Notes conversation">
          <div className="panel top-gap-small candidate-notes-conversation-panel">
            <div className="panel-heading-row"><div className="panel-title">Notes conversation <span className="helper-text">{noteThreads.length} threads saved</span></div><button type="button" className="ghost-btn" onClick={() => setShowHistory(true)}>All notes</button><button type="button" className="ghost-btn" onClick={()=>scrollToLatestNote(true)}>Latest ↓</button></div>
            <div ref={notesThreadListRef} className="candidate-notes-thread-list top-gap-small cc839-latest-notes" onScroll={event=>{const node=event.currentTarget;notesScrollState.current.atBottom=node.scrollHeight-node.scrollTop-node.clientHeight<48;}}>{visibleNotes.length ? visibleNotes.map(thread => renderNoteThread(thread,true)) : <div className="helper-text">No notes saved yet.</div>}</div>
          </div>
          </SafeSectionBoundary>

          <SafeSectionBoundary title="Resume">
          <div className="panel top-gap-small candidate-files-panel" data-cc804-controls="resume">
            <div className="panel-heading-row"><div className="panel-title">Resume</div>
              {!isNewCandidate ? <button type="button" className="ghost-btn file-action-btn" onClick={loadCandidateFiles} disabled={filesLoading || !!fileBusy}>{filesLoading ? 'Loading…' : 'Refresh resumes'}</button> : null}
            </div>
            <div className="candidate-file-row top-gap-small">
              <div className="candidate-file-copy"><strong>{pendingResume?.name || latestResumeFile?.original_name || item.resume_filename || 'No resume uploaded'}</strong>
                <div className="helper-text">{pendingResume ? 'Selected in this tab · original file is not stored in CRM' : 'Original PDF, Word, image, TXT, RTF or ODT · up to 6 MB'}</div>
              </div>
              <div className="candidate-file-actions">
                <input ref={resumeInputRef} id="candidate-resume-upload" type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.txt,.rtf,.odt" hidden disabled={!!fileBusy || !!actionBusy} onChange={async event=>{const input=event.currentTarget;const file=input.files?.[0];input.value='';if(file)await uploadCandidateAsset('resume',file);}} />
                <button type="button" className="ghost-btn file-action-btn" disabled={!!fileBusy || !!actionBusy} onClick={()=>resumeInputRef.current?.click()}>{fileBusy ? 'Uploading…' : 'Upload Resume'}</button>
                <button type="button" className="add-profile-btn file-action-btn" disabled={!!fileBusy || !!actionBusy || (!latestResumeFile && !item.resume_filename && !pendingResume)} hidden={!canArrangeFields} onClick={()=>downloadCandidateAsset(latestResumeFile?.file_id)}>View / Download</button>
              </div>
            </div>
            <div className="candidate-file-chip-row">{safeArray(candidateFiles).filter(file=>file.file_kind==='resume').slice(0,5).map(file=><button type="button" key={file.file_id} className="candidate-file-chip" hidden={!canArrangeFields} disabled={!!fileBusy} onClick={()=>downloadCandidateAsset(file.file_id)}><span>{safeText(file.original_name)}</span><small>{formatFileSize(file.size_bytes)}</small></button>)}</div>
          </div>
          </SafeSectionBoundary>

          <SafeSectionBoundary title="Timeline">
          <div className="panel top-gap-small candidate-timeline-panel">
            <div className="panel-heading-row">
              <div>
                <div className="panel-title">Timeline</div>
              </div>
              <div className="timeline-tab-row">
                <span className="helper-text">{historyExpanded ? 'History · manual pages' : 'Latest 3 activities'}</span>
                {!historyExpanded && !isNewCandidate ? <button className="ghost-btn bounceable" type="button" onClick={loadMoreTimeline} disabled={historyLoading}>{historyLoading ? 'Loading older…' : 'View older history'}</button> : null}
                {historyExpanded && historyHasMore ? <button className="ghost-btn bounceable" type="button" onClick={loadMoreTimeline} disabled={historyLoading}>{historyLoading ? 'Loading…' : 'Load next 50'}</button> : null}
                {historyExpanded ? <button className="ghost-btn bounceable" type="button" onClick={() => setHistoryExpanded(false)}>Show latest 3</button> : null}
              </div>
            </div>
            {historyError ? <p role="alert" className="helper-text sync-message is-error">{historyError}</p> : null}
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
          <div className="crm-premium-modal jd-suggestion-card jd-popup-landscape cc808-jd-fit" style={{ width: "min(1060px, 94vw)", maxWidth: "94vw", maxHeight: "86vh", overflow: "auto", padding: "18px", minHeight: 0 }} onClick={(e) => e.stopPropagation()}>
            <div className="jd-suggestion-head">
              <div>
                <span className="cc808-jd-kicker">CAREER CROX · OPPORTUNITIES</span><div className="panel-title">Find the right fit</div>
                <div className="helper-text top-gap-small">{jdSuggestionPopup.suggestions?.length || 0} eligible opportunities · matched against the current profile details.</div>
              </div>
              <div className="jd-suggestion-head-right">
                <span className="jd-suggestion-score">{jdSuggestionPopup.suggestions?.length || 0} matches</span>
                <button type="button" className="ghost-btn bounceable" onClick={openAllSuggestedJds} disabled={!jdSuggestionPopup?.suggestions?.length}>Open All JD</button>
                <button type="button" className="ghost-btn bounceable" onClick={() => setJdSuggestionPopup(null)} disabled={Boolean(jdPopupBusyId)}>Close</button>
              </div>
            </div>
            {jdSuggestionPopup.loading ? <div className="cc791-jd-progress" role="status"><span/>Updating matches…</div> : null}
            {jdSuggestionPopup.error ? <div className="sync-message is-error" role="alert">{jdSuggestionPopup.error}</div> : null}
            {!jdSuggestionPopup.loading && !jdSuggestionPopup.error && !jdSuggestionPopup.suggestions?.length ? <p className="helper-text">No relevant JD matches yet.</p> : null}
            <div className="jd-suggestion-list jd-popup-grid-4 top-gap-small">
              {safeArray(jdSuggestionPopup?.suggestions).map((rawJd, index) => {
                const jd = safeObject(rawJd);
                return (
                <div key={safeText(jd.jd_id) || `jd-suggestion-${index}`} className={`jd-suggestion-row ${Number(jd.score||0)>=85?'fit-best':Number(jd.score||0)>=70?'fit-good':'fit-review'}`}>
                  <div className="jd-suggestion-copy">
                    <strong>{safeText(jd.job_title || 'JD')}</strong>
                    <div className="helper-text top-gap-small">{[jd.company, jd.location, jd.experience, jd.salary].map(safeText).filter(Boolean).join(' • ') || 'JD details available after open'}</div>
                    <div className="jd-fit-reason-list top-gap-small">
                      {safeTemplateList(jd.reasons || [], 8).map((reason, reasonIndex) => <span key={`${safeText(jd.jd_id) || index}-${reasonIndex}`} className="jd-fit-reason">{reason}</span>)}
                    </div>
                  </div>
                  <div className="jd-suggestion-actions">
                    <span className="jd-suggestion-score">{Math.round(Number(jd.score || 0))}% Match</span>
                    <button type="button" className="ghost-btn bounceable" onClick={() => openJdInNewTab(jd.jd_id)}>Open JD</button>
                    <button type="button" className="add-profile-btn bounceable jd-wa-btn" onClick={() => sendSuggestedJdOnWhatsApp(jd.jd_id)} disabled={jdPopupBusyId === safeText(jd.jd_id)}>
                      <WhatsAppIcon />
                      <span>{jdPopupBusyId === safeText(jd.jd_id) ? 'Preparing...' : 'Share'}</span>
                    </button>
                  </div>
                </div>
              );
              })}
            </div>
            <div className="helper-text top-gap-small">Share prepares the PDF and message. Review the draft, then send from your chosen app.</div>
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
  const location = useLocation();
  const freshEntryKey = useRef('current');
  // A deliberate new-form navigation gets a new instance; Save adopts its ID in place.
  if (String(candidateId).toLowerCase() === 'new') freshEntryKey.current = location.key || location.search || 'initial';
  return (
    <CandidateProfileErrorBoundary candidateId={candidateId} freshEntryKey={freshEntryKey.current}>
      <CandidateDetailPageInner key={candidateId} />
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
