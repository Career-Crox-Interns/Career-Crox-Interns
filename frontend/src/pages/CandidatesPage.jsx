import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { mergeRowsById, useSmartDeltaSync } from '../lib/smartSync';
import { addWhatsAppTemplate, getWhatsAppTemplates } from '../lib/templateStore';
import { dialCandidateWithLog, openWhatsAppWithLog, visiblePhone } from '../lib/candidateAccess';
import { openCandidateProfileInSameTab } from '../lib/candidateNav';
import { readPageCache, writePageCache } from '../lib/persistentPageCache';
import { onCandidateRealtime } from '../lib/realtimeProfileBridge';

function EyeIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M2.4 12s3.4-6 9.6-6 9.6 6 9.6 6-3.4 6-9.6 6-9.6-6-9.6-6Z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.9" /></svg>;
}
function PhoneIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7.4 3.8h2.1c.5 0 .9.3 1.1.8l1.1 3.1c.2.5 0 1.1-.4 1.4L9.8 10.4a13.2 13.2 0 0 0 3.8 3.8l1.3-1.5c.3-.4.9-.6 1.4-.4l3.1 1.1c.5.2.8.6.8 1.1v2.1c0 .7-.6 1.3-1.3 1.3A15.9 15.9 0 0 1 6.1 5.1c0-.7.6-1.3 1.3-1.3Z" fill="currentColor" /></svg>;
}
function WhatsAppIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M19.1 4.8A9.7 9.7 0 0 0 3.8 16.7L2.7 21.3l4.8-1.1a9.7 9.7 0 0 0 4.5 1.1h.1a9.7 9.7 0 0 0 7-16.5Zm-7 14.8h-.1a7.9 7.9 0 0 1-4-1.1l-.3-.2-2.8.7.7-2.7-.2-.3a7.9 7.9 0 1 1 6.7 3.6Z" fill="currentColor" /><path d="M16.5 13.8c-.2-.1-1.3-.7-1.5-.7-.2-.1-.3-.1-.5.1l-.4.5c-.1.2-.3.2-.5.1-.2-.1-.8-.3-1.5-1a5.5 5.5 0 0 1-1-1.2c-.1-.2 0-.3.1-.4l.3-.4.2-.4c.1-.1 0-.3 0-.4l-.7-1.6c-.2-.4-.3-.3-.5-.3h-.4c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 1.9 0 1 .8 2.1.9 2.3.1.1 1.7 2.6 4 3.6 2.4 1 2.4.7 2.8.7.4-.1 1.3-.5 1.5-1 .2-.4.2-.9.2-1 0-.1-.2-.2-.4-.3Z" fill="currentColor" /></svg>;
}
function CheckIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5.2 12.7 9.4 17l9.4-9.4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function SelectAllIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M8.3 12.2 10.9 15l4.9-5.3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function DialerIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 4h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="9" cy="8" r="1"/><circle cx="12" cy="8" r="1"/><circle cx="15" cy="8" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="16" r="1"/><circle cx="12" cy="16" r="1"/><circle cx="15" cy="16" r="1"/></svg>;
}
function FilterIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}
function PrevIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m14.5 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function NextIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function CloseIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>;
}
function BackIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function ArrowIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function TrashIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M9 4h6l1 2H8l1-2Z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/><path d="M7 7l.7 11.2A2 2 0 0 0 9.7 20h4.6a2 2 0 0 0 2-1.8L17 7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

const defaultFilters = {
  q: '',
  sr_from: '', sr_to: '',
  submission_from: '', submission_to: '',
  interview_from: '', interview_to: '',
  salary_from: '', salary_to: '',
  total_exp_from: '', total_exp_to: '',
  relevant_exp_from: '', relevant_exp_to: '',
  name: [], phone: [], location: [], qualification: [], course_name: [], recruiter_code: [], preferred_location: [], communication_skill: [], process: [], all_details_sent: [], status: [], approval_status: [], virtual_onsite: [], documents_availability: [], call_connected: [], manager_crm: [], submitted_by: [], career_gap: [], relevant_experience_range: [], relevant_in_hand_range: [], data_notes: [], data_uploading_from: '', data_uploading_to: '', bucket_view: 'all'
};

const FILTER_PRESET_STORAGE_KEY = 'careerCroxCandidateFilterPresets';
const DEGREE_FILTER_OPTIONS = ['NON - Graduate', 'Graduate'];
const DEFAULT_PREFERRED_LOCATION_OPTIONS = ['Noida', 'Gurgaon', 'Mumbai'];
const PREFERRED_LOCATION_STORAGE_KEY = 'careerCroxPreferredLocations_v3';
const FILTER_ALL_MARKER = '__ALL__';

function normalizeFilterValue(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function normalizeLocationFilterValue(value) {
  return normalizeFilterValue(value).replace(/\bgurugram\b/g, 'gurgaon');
}
function mergeLocationOptions(primary = [], fallback = [], selected = []) {
  const seen = new Set();
  const out = [];
  [...primary, ...(primary.length ? [] : fallback), ...selected].forEach((raw) => {
    const value = String(raw || '').trim();
    if (!value || value === FILTER_ALL_MARKER) return;
    const key = normalizeLocationFilterValue(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(value);
  });
  return out.sort((a, b) => String(a).localeCompare(String(b)));
}

function readStoredPreferredLocationOptions() {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFERRED_LOCATION_STORAGE_KEY) || '[]');
    const list = Array.isArray(stored) ? stored : [];
    return [...new Set([...DEFAULT_PREFERRED_LOCATION_OPTIONS, ...list.map((item) => String(item || '').trim()).filter(Boolean)])]
      .sort((a, b) => String(a).localeCompare(String(b)));
  } catch {
    return [...DEFAULT_PREFERRED_LOCATION_OPTIONS];
  }
}


function splitValues(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function candidateDataNotesOptionText(row = {}) {
  return String(row.data_notes || row.notes || row.note || '').trim();
}
function candidateDataNotesOptionValues(row = {}) {
  return candidateDataNotesOptionText(row).split(/[,|;]+/).map((item) => item.trim()).filter(Boolean);
}

function displayCandidateCode(index = 0, currentPage = 1, currentPageSize = 10) {
  const serial = ((Number(currentPage || 1) - 1) * Number(currentPageSize || 10)) + Number(index || 0) + 1;
  return `C${String(Math.max(1, serial)).padStart(3, '0')}`;
}

function safeCellText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map((item) => safeCellText(item)).filter(Boolean).join(', ');
  try {
    const text = JSON.stringify(value);
    return text === undefined ? fallback : text;
  } catch {
    return fallback;
  }
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeWhatsAppTemplateOption(raw, index = 0) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const body = safeCellText(raw.body || raw.message || raw.text || '').trim();
    const title = safeCellText(raw.title || raw.heading || raw.name || body.split(/\r?\n/).find(Boolean) || `WhatsApp Preset ${index + 1}`).trim();
    return body ? { title, body } : null;
  }
  const body = safeCellText(raw || '').trim();
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
  const raw = safeCellText(value).trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return normalizeWhatsAppTemplateOption(parsed);
  } catch {
    return normalizeWhatsAppTemplateOption(raw);
  }
}

function candidateFirstName(row = {}) {
  const raw = safeObject(row);
  const name = safeCellText(raw.full_name || raw.name || raw.candidate_name || '').trim();
  return name.split(/\s+/).filter(Boolean)[0] || 'Candidate';
}

function recruiterDisplayName(row = {}, currentUser = {}) {
  const raw = safeObject(row);
  const usr = safeObject(currentUser);
  return safeCellText(
    raw.recruiter_name
      || raw.employee_name
      || raw.assigned_recruiter_name
      || raw.submitted_by_name
      || raw.tl_name
      || usr.full_name
      || usr.name
      || usr.username
      || raw.recruiter_code
      || raw.employee_code
      || 'Career Crox'
  ).trim();
}

function renderWhatsAppTemplateBody(body = '', row = {}, currentUser = {}) {
  const first = candidateFirstName(row);
  const raw = safeObject(row);
  const candidateName = safeCellText(raw.full_name || raw.name || raw.candidate_name || first).trim();
  const recruiterName = recruiterDisplayName(raw, currentUser);
  return safeCellText(body)
    .replace(/\{\{first_name\}\}/g, first)
    .replace(/\{\{candidate_name\}\}/g, candidateName)
    .replace(/\{\{recruiter_name\}\}/g, recruiterName);
}

function buildInitialFilters(searchParams) {
  const next = { ...defaultFilters };
  Object.entries(defaultFilters).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      next[key] = searchParams.getAll(key).map((item) => String(item || '').trim()).filter(Boolean);
      return;
    }
    const found = searchParams.get(key);
    if (found !== null) next[key] = found;
  });
  return next;
}
function containsText(value, q) {
  return String(value || '').toLowerCase().includes(String(q || '').toLowerCase());
}
function normalizeId(value) {
  return String(value || '').trim();
}
function numericTail(value) {
  const match = String(value || '').match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}
function inRange(value, from, to) {
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  if (String(from).trim() !== '' && n < Number(from)) return false;
  if (String(to).trim() !== '' && n > Number(to)) return false;
  return true;
}
function uniqueOptions(rows, getter, split = false) {
  return Array.from(new Set(rows.flatMap((row) => {
    const value = getter(row);
    if (Array.isArray(value)) return value.filter(Boolean);
    return split ? splitValues(value) : [String(value || '').trim()].filter(Boolean);
  }))).sort((a, b) => String(a).localeCompare(String(b)));
}
function optionSummary(filters, key, rangeKeys = []) {
  if (rangeKeys.length) {
    const count = rangeKeys.filter((item) => String(filters[item] || '').trim()).length;
    return count ? `${count} set` : 'All';
  }
  const values = filters[key] || [];
  if (!values.length) return 'All';
  if (values.length === 1) return values[0];
  return `${values.length} selected`;
}
function toggleArrayValue(filters, key, value, allOptions = []) {
  const cleanOptions = (allOptions || []).filter((item) => String(item || '').trim() && item !== FILTER_ALL_MARKER);
  const current = Array.isArray(filters[key]) ? filters[key] : [];
  if (current.includes(FILTER_ALL_MARKER)) {
    return { ...filters, [key]: cleanOptions.filter((item) => item !== value) };
  }
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
  const allSelected = cleanOptions.length > 0 && cleanOptions.every((item) => next.includes(item));
  return { ...filters, [key]: allSelected ? [FILTER_ALL_MARKER] : next };
}

function readSavedFilterPresets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FILTER_PRESET_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function countSelectedForSection(section, filters) {
  if (!section) return 0;
  if (section.type === 'options') {
    const values = Array.isArray(filters[section.key]) ? filters[section.key] : [];
    if (values.includes(FILTER_ALL_MARKER)) return Math.max(1, (section.options || []).length);
    return values.length;
  }
  return [filters[section.from], filters[section.to]].filter((item) => String(item || '').trim()).length;
}
function filtersHaveAnyValue(filters) {
  return Object.entries(filters || {}).some(([key, value]) => {
    if (key === 'bucket_view') return false;
    if (key === 'q') return String(value || '').trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return String(value || '').trim().length > 0;
  });
}

function buildCandidateQuery(filters, page = 1, pageSize = 10) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      // CC26_519: selecting every option means "no restriction" for that filter.
      // Never send the UI-only __ALL__ marker to the API; older/local servers would
      // otherwise try to match it literally and incorrectly return 0 profiles.
      if (value.includes(FILTER_ALL_MARKER)) return;
      value.filter(Boolean).forEach((item) => params.append(key, String(item)));
      return;
    }
    if (String(value ?? '').trim()) params.set(key, String(value));
  });
  return params.toString();
}

function formatBucketDate(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}
function formatLastViewed(value) {
  if (!value) return 'Never';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatRelativeDays(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const diffDays = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 86400000));
  if (diffDays === 0) return 'Checked today';
  if (diffDays === 1) return '1 day ago';
  return `${diffDays} days ago`;
}

function formatDaysLeft(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  if (numeric <= 0) return 'Last day';
  if (numeric === 1) return '1 day left';
  return `${numeric} days left`;
}

function normalizeLastViewedMode(value) {
  return String(value || '').trim().toLowerCase();
}
function sanitizeLastViewedDays(value) {
  const digits = String(value || '').replace(/[^\d]/g, '').slice(0, 3);
  if (!digits) return '';
  const numeric = Math.max(1, Math.min(365, Number(digits) || 0));
  return numeric ? String(numeric) : '';
}
function lastViewedFilterSummary(filters) {
  const mode = normalizeLastViewedMode(filters?.last_viewed_mode);
  if (!mode) return 'All Last Viewed';
  if (mode === 'today') return 'Today';
  if (mode === 'lt1') return '< 1 Day';
  if (mode === 'lt2') return '< 2 Day';
  if (mode === 'lt5') return '< 5 Day';
  if (mode === 'custom') {
    const days = sanitizeLastViewedDays(filters?.last_viewed_days);
    return days ? `< ${days} Day` : 'Custom Days';
  }
  return 'All Last Viewed';
}
function toneForBucket(stage) {
  if (stage === 'last_day' || stage === 'bucket_out') return 'danger';
  if (stage === 'warning') return 'warn';
  if (stage === 'fresh') return 'info';
  if (stage === 'followup') return 'follow';
  return 'safe';
}
function priorityTone(priority) {
  const value = String(priority || '').toLowerCase();
  if (value === 'urgent' || value === 'expired') return 'priority-urgent';
  if (value === 'high') return 'priority-high';
  if (value === 'done') return 'priority-done';
  return 'priority-normal';
}

function instantOwnerRole(row) {
  const designation = String(row?.recruiter_designation || row?.role || '').trim().toLowerCase();
  if (designation.includes('admin')) return 'admin';
  if (designation === 'tl' || designation.includes('team lead') || designation.includes('teamlead')) return 'tl';
  if (designation.includes('manager')) return 'manager';
  if (designation.includes('recruit')) return 'recruiter';
  const code = String(row?.recruiter_code || '').trim().toUpperCase();
  if (code.startsWith('ADM')) return 'admin';
  if (code.startsWith('MGR')) return 'manager';
  if (code.startsWith('TL')) return 'tl';
  if (code.startsWith('CC') || code.startsWith('REC')) return 'recruiter';
  return '';
}
function instantIsAllocated(row) {
  const code = String(row?.recruiter_code || '').trim();
  const name = String(row?.recruiter_name || '').trim();
  if (!code && !name) return false;
  const role = instantOwnerRole(row);
  return role !== 'manager' && role !== 'admin';
}
function instantStableOrder(row) {
  const sr = Number(String(row?.source_sr_no || '').replace(/[^\d]/g, ''));
  if (Number.isFinite(sr) && sr > 0) return sr;
  const match = String(row?.candidate_id || '').match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}
function instantBucketMatches(row, view) {
  const key = String(view || 'all').toLowerCase();
  if (!key || key === 'all') return true;
  if (key === 'fresh') return Boolean(row?.bucket_is_fresh) && !row?.bucket_is_bucket_out;
  if (key === 'followup') return Boolean(row?.bucket_is_followup) && !row?.bucket_is_bucket_out;
  if (key === 'followup_due') return Boolean(row?.bucket_is_followup_due) && !row?.bucket_is_bucket_out;
  if (key === 'allocated') return instantIsAllocated(row);
  if (key === 'warning') return row?.bucket_stage === 'warning';
  if (key === 'last_day') return row?.bucket_stage === 'last_day';
  if (key === 'days_1') return Number(row?.bucket_days_left) === 1 && !row?.bucket_is_bucket_out;
  if (key === 'days_2') return Number(row?.bucket_days_left) === 2 && !row?.bucket_is_bucket_out;
  if (key === 'days_3') return Number(row?.bucket_days_left) === 3 && !row?.bucket_is_bucket_out;
  if (key === 'days_4_plus') return Number(row?.bucket_days_left) >= 4 && !row?.bucket_is_bucket_out && !row?.bucket_is_terminal && !row?.bucket_is_fresh;
  return true;
}
function instantBucketSort(rows, view) {
  const key = String(view || 'all').toLowerCase();
  return [...rows].sort((a, b) => {
    const stable = () => (instantStableOrder(b) - instantStableOrder(a)) || String(b?.created_at || b?.updated_at || '').localeCompare(String(a?.created_at || a?.updated_at || '')) || String(b?.candidate_id || '').localeCompare(String(a?.candidate_id || ''));
    if (key === 'all') return stable();
    if (key === 'fresh') {
      const aTouched = String(a?.last_dialed_at || '').trim() ? 1 : 0;
      const bTouched = String(b?.last_dialed_at || '').trim() ? 1 : 0;
      if (aTouched !== bTouched) return aTouched - bTouched;
      if (!aTouched) return stable();
      const aDial = new Date(a?.last_dialed_at || 0).getTime() || 0;
      const bDial = new Date(b?.last_dialed_at || 0).getTime() || 0;
      if (aDial !== bDial) return aDial - bDial;
      return stable();
    }
    if (key === 'followup') {
      const aDate = new Date(a?.follow_up_at || 0).getTime() || Number.MAX_SAFE_INTEGER;
      const bDate = new Date(b?.follow_up_at || 0).getTime() || Number.MAX_SAFE_INTEGER;
      if (aDate !== bDate) return aDate - bDate;
      return stable();
    }
    const aLeft = Number.isFinite(Number(a?.bucket_days_left)) ? Number(a.bucket_days_left) : Number.MAX_SAFE_INTEGER;
    const bLeft = Number.isFinite(Number(b?.bucket_days_left)) ? Number(b.bucket_days_left) : Number.MAX_SAFE_INTEGER;
    if (aLeft !== bLeft) return aLeft - bLeft;
    return stable();
  });
}
function instantBucketSummaryCount(summary, view) {
  const key = String(view || 'all').toLowerCase();
  if (key === 'fresh') return Number(summary?.fresh_profiles || 0);
  if (key === 'allocated') return Number(summary?.allocated_profiles || 0);
  if (key === 'followup' || key === 'followup_due') return Number(key === 'followup_due' ? summary?.pending_followups : summary?.followup_profiles || 0);
  if (key === 'warning') return Number(summary?.warning_profiles || 0);
  if (key === 'last_day') return Number(summary?.last_day_profiles || 0);
  if (key === 'days_1') return Number(summary?.last_day_profiles || 0);
  return Number(summary?.total_visible || 0);
}

function readLatestDurableCandidatePatch() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('careerCroxRealtimeCandidatePatch:v2');
    if (!raw) return null;
    const payload = JSON.parse(raw);
    const item = payload?.item || {};
    const at = Number(item?.__cc_durable_frontend_at || payload?.at || 0);
    if (!item?.candidate_id || !item?.__cc_durable_frontend_pending || !at) return null;
    if (Date.now() - at >= 24 * 60 * 60 * 1000) return null;
    return item;
  } catch {
    return null;
  }
}

export default function CandidatesPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialSearchFilters = buildInitialFilters(searchParams);
  const { user } = useAuth();
  const leadership = ['admin', 'manager', 'tl'].includes(String(user?.role || '').toLowerCase());
  const isManager = ['admin', 'manager'].includes(String(user?.role || '').toLowerCase());
  const candidatesCacheKey = `careerCroxCandidatesFastCache:${user?.user_id || user?.username || 'anon'}:${user?.role || ''}:${user?.recruiter_code || ''}`;
  const [allRows, setAllRows] = useState(() => readPageCache(candidatesCacheKey, []));
  const [filterRows, setFilterRows] = useState(() => readPageCache(`${candidatesCacheKey}:filter-options:v517`, []));
  const [selectableRows, setSelectableRows] = useState(() => readPageCache(`${candidatesCacheKey}:selectable`, []));
  const [totalRows, setTotalRows] = useState(0);
  const [summary, setSummary] = useState({});
  const [page, setPage] = useState(1);
  const [pageJumpValue, setPageJumpValue] = useState('1');
  const pageSize = 10;
  const [filters, setFilters] = useState(() => initialSearchFilters);
  const [message, setMessage] = useState('');
  const [waTemplates, setWaTemplates] = useState(getWhatsAppTemplates());
  const [selectedIds, setSelectedIds] = useState([]);
  const [dialerOpen, setDialerOpen] = useState(false);
  const [dialerIndex, setDialerIndex] = useState(0);
  const [autoNextCountdown, setAutoNextCountdown] = useState(0);
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);
  const [optionSearches, setOptionSearches] = useState({});
  const [activeFilterKey, setActiveFilterKey] = useState('location');
  const [savedFilters, setSavedFilters] = useState(() => readSavedFilterPresets());
  const [presetName, setPresetName] = useState('');

  const loadSeqRef = useRef(0);
  const autoBucketRecruiterRef = useRef(false);

  async function load(targetPage = page, nextFilters = filters) {
    const loadSeq = ++loadSeqRef.current;
    const qs = buildCandidateQuery(nextFilters, targetPage, pageSize);
    const exactSliceCacheKey = `${candidatesCacheKey}:slice:${qs}`;
    const exactCached = readPageCache(exactSliceCacheKey, null);
    if (exactCached && Array.isArray(exactCached.items)) {
      setAllRows(exactCached.items);
      setSelectableRows(exactCached.items);
      if (Number.isFinite(Number(exactCached.total))) setTotalRows(Number(exactCached.total));
    }
    // Frontend-first: exact cached rows render immediately; backend verification continues behind them.
    const data = await api.get(`/api/candidates?${qs}`, { cacheTtlMs: 60000, timeoutMs: 12000, retries: 0, allowStale: true, background: false });
    if (loadSeq !== loadSeqRef.current) return;
    const serverItems = Array.isArray(data?.items) ? data.items : [];
    const serverFilterSource = Array.isArray(data?.filter_source_rows) ? data.filter_source_rows : [];
    // CC26_680: a successful Create/Submit is durable. If a just-committed row is already in the
    // local fast cache but the live list endpoint is briefly stale/older, never erase it from the
    // screen. Only locally marked durable rows are retained; normal stale/deleted rows are not.
    const canRetainDurable = Number(targetPage || 1) === 1
      && !filtersHaveAnyValue(nextFilters)
      && String(nextFilters?.bucket_view || 'all') === 'all';
    const serverIds = new Set(serverItems.map((row) => String(row?.candidate_id || '').trim()).filter(Boolean));
    const cachedDurable = canRetainDurable
      ? (Array.isArray(readPageCache(candidatesCacheKey, [])) ? readPageCache(candidatesCacheKey, []) : [])
      : [];
    const latestDurable = canRetainDurable ? readLatestDurableCandidatePatch() : null;
    const durableMap = new Map();
    [...cachedDurable, ...(latestDurable ? [latestDurable] : [])]
      .filter((row) => row?.__cc_durable_frontend_pending)
      .filter((row) => Date.now() - Number(row?.__cc_durable_frontend_at || Date.now()) < 24 * 60 * 60 * 1000)
      .forEach((row) => {
        const id = String(row?.candidate_id || '').trim();
        if (id && !serverIds.has(id)) durableMap.set(id, row);
      });
    const durablePendingRows = canRetainDurable ? Array.from(durableMap.values()) : [];
    const items = canRetainDurable ? [...durablePendingRows, ...serverItems].slice(0, pageSize) : serverItems;
    const filterSource = durablePendingRows.length
      ? [...durablePendingRows, ...serverFilterSource.filter((row) => !durablePendingRows.some((pending) => String(pending?.candidate_id || '') === String(row?.candidate_id || '')))]
      : serverFilterSource;
    // CC26_100: Auto Dialer must load exactly the visible CRM table rows.
    // Hidden dialer_items/filter_source_rows caused app queue mismatch and wrong-profile calls.
    const selectable = items;
    setAllRows(items);
    setFilterRows((current) => {
      const hasActiveFilters = filtersHaveAnyValue(nextFilters);
      const defaultBucket = String(nextFilters?.bucket_view || 'all') === 'all';
      const canRefreshBaseFilterSource = (!hasActiveFilters && defaultBucket) || !current.length;
      const stableOptions = canRefreshBaseFilterSource ? filterSource : current;
      if (canRefreshBaseFilterSource) {
        writePageCache(`${candidatesCacheKey}:filter-options:v517`, stableOptions.slice(0, 5000));
      }
      return stableOptions;
    });
    setSelectableRows(selectable);
    writePageCache(candidatesCacheKey, items);
    writePageCache(`${candidatesCacheKey}:selectable`, selectable.slice(0, 1500));
    const serverTotal = Number(data?.total || 0);
    setTotalRows(canRetainDurable ? Math.max(serverTotal + durablePendingRows.length, items.length) : serverTotal);
    const resolvedSummary = (() => {
      const base = data?.summary || {};
      if (!durablePendingRows.length) return base;
      const pendingFresh = durablePendingRows.filter((row) => row?.bucket_is_fresh).length;
      const pendingAllocated = durablePendingRows.filter((row) => row?.bucket_is_fresh === false).length;
      return {
        ...base,
        total_visible: Math.max(Number(base.total_visible || 0) + durablePendingRows.length, items.length),
        fresh_profiles: Number(base.fresh_profiles || 0) + pendingFresh,
        allocated_profiles: Number(base.allocated_profiles || 0) + pendingAllocated,
      };
    })();
    setSummary(resolvedSummary);
    writePageCache(exactSliceCacheKey, { items, total: canRetainDurable ? Math.max(serverTotal + durablePendingRows.length, items.length) : serverTotal, summary: resolvedSummary });
    setPage(Number(data?.page || targetPage || 1));
  }

  useEffect(() => { load(page, filters).catch(() => {}); }, []);
  useEffect(() => { setPageJumpValue(String(page || 1)); }, [page]);
  useEffect(() => onCandidateRealtime(({ item }) => {
    const candidateId = String(item?.candidate_id || '').trim();
    if (!candidateId) return;
    // On the default All Candidates first page, show the committed profile instantly.
    // Filtered pages keep their filter contract and the next manual/page load verifies backend state.
    if (page !== 1 || filtersHaveAnyValue(filters) || String(filters.bucket_view || 'all') !== 'all') return;
    setAllRows((current) => {
      const base = Array.isArray(current) ? current : [];
      const next = [item, ...base.filter((row) => String(row?.candidate_id || '') !== candidateId)].slice(0, pageSize);
      writePageCache(candidatesCacheKey, next);
      return next;
    });
    setFilterRows((current) => {
      const base = Array.isArray(current) ? current : [];
      const next = [item, ...base.filter((row) => String(row?.candidate_id || '') !== candidateId)].slice(0, 5000);
      writePageCache(`${candidatesCacheKey}:filter-options:v517`, next);
      return next;
    });
    setSelectableRows((current) => [item, ...(Array.isArray(current) ? current : []).filter((row) => String(row?.candidate_id || '') !== candidateId)].slice(0, pageSize));
    setTotalRows((current) => Math.max(Number(current || 0), 1));
  }), [candidatesCacheKey, page, JSON.stringify(filters)]);
  useSmartDeltaSync({
    scope: 'candidates',
    idKey: 'candidate_id',
    rows: allRows,
    query: buildCandidateQuery(filters, page, pageSize),
    keySuffix: `${page}:${JSON.stringify(filters)}`,
    onRows: (changedRows) => {
      setAllRows((current) => mergeRowsById(current, changedRows, 'candidate_id').slice(0, pageSize));
      setFilterRows((current) => mergeRowsById(current, changedRows, 'candidate_id').slice(0, 5000));
    },
    onSnapshot: (snapshot) => {
      const durableRows = (Array.isArray(allRows) ? allRows : []).filter((row) => row?.__cc_durable_frontend_pending);
      if (snapshot?.summary) {
        setSummary((current) => {
          const next = { ...current, ...snapshot.summary };
          if (!durableRows.length) return next;
          return { ...next, total_visible: Math.max(Number(next.total_visible || 0), allRows.length) };
        });
      }
      if (Number.isFinite(Number(snapshot?.total))) {
        setTotalRows(durableRows.length ? Math.max(Number(snapshot.total || 0), allRows.length) : Number(snapshot.total || 0));
      }
    },
  });

  const optionSourceRows = useMemo(() => (filterRows.length ? filterRows : allRows), [filterRows, allRows]);


  function openCandidateProfile(row) {
    if (!row?.candidate_id) return;
    const navRows = filteredRows.length ? filteredRows : (optionSourceRows.length ? optionSourceRows : allRows);
    openCandidateProfileInSameTab(row, navRows, {
      sourcePath: `${window.location.pathname}${window.location.search || ''}`,
      sourceApi: `/api/candidates?${buildCandidateQuery(filters, page, pageSize)}`,
      sourceKind: 'candidates',
      page,
      pageSize,
      totalRows,
      hasMore: page * pageSize < Number(totalRows || 0),
    });
  }
  const recruiterOptions = useMemo(() => uniqueOptions(optionSourceRows, (row) => row.recruiter_code), [optionSourceRows]);
  const preferredLocationFilterOptions = useMemo(() => {
    const actual = uniqueOptions(optionSourceRows, (row) => row.preferred_location, true);
    const stored = readStoredPreferredLocationOptions();
    const selected = (filters.preferred_location || []).filter((item) => item !== FILTER_ALL_MARKER);
    return mergeLocationOptions(actual, stored, selected);
  }, [optionSourceRows, filters.preferred_location, showFilterDrawer]);


  async function deleteCandidate(candidateId, fullName) {
    if (!isManager) return;
    const ok = window.confirm(`Delete ${fullName || candidateId || 'this candidate'}? This removes the profile from CRM.`);
    if (!ok) return;
    try {
      await api.post(`/api/candidates/${encodeURIComponent(candidateId)}/delete`, {});
      setMessage(`${fullName || candidateId} deleted.`);
      setSelectedIds((prev) => prev.filter((item) => item !== normalizeId(candidateId)));
      await load(page, filters);
    } catch (error) {
      setMessage(error.message || 'Delete failed');
    }
  }

  const filterSections = useMemo(() => {
    const sections = [
      // CC26_518: filter order follows the user's numbered priority. Decimal numbers
      // mean "between" positions (2.5 after 2, 3.5 after 3).
      { key: 'recruiter_code', label: 'Recruiter code', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.recruiter_code) },
      { key: 'status', label: 'Status', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.status) },
      { key: 'submission_date', label: 'Submission Date', type: 'date-range', from: 'submission_from', to: 'submission_to' },
      { key: 'preferred_location', label: 'Preferred Location', type: 'options', options: preferredLocationFilterOptions },
      { key: 'interview_date', label: 'Interview date', type: 'date-range', from: 'interview_from', to: 'interview_to' },
      { key: 'qualification', label: 'Degree / Qualification', type: 'options', options: DEGREE_FILTER_OPTIONS },
      { key: 'course_name', label: 'Course Name', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.course_name) },
      { key: 'relevant_experience_range', label: 'Relevant Exp Range', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.relevant_experience_range) },
      { key: 'relevant_in_hand_range', label: 'Relevant In-hand Range', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.relevant_in_hand_range) },
      { key: 'communication_skill', label: 'Communication Skill', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.communication_skill) },
      { key: 'career_gap', label: 'Career Gap', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.career_gap) },
      { key: 'documents_availability', label: 'All Documents Availability', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.documents_availability) },

      // Unnumbered filters stay available after the requested sequence, preserving
      // their prior relative order so no feature disappears.
      { key: 'sr', label: 'Sr. No.', type: 'range', from: 'sr_from', to: 'sr_to' },
      { key: 'location', label: 'Candidate location', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.location, true) },
      { key: 'salary', label: 'In-Hand Salary', type: 'range', from: 'salary_from', to: 'salary_to' },
      { key: 'relevant_exp', label: 'Relevant Experience', type: 'range', from: 'relevant_exp_from', to: 'relevant_exp_to' },
      { key: 'total_exp', label: 'Total Experience', type: 'range', from: 'total_exp_from', to: 'total_exp_to' },
      { key: 'process', label: 'Process', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.process, true) },
      { key: 'data_notes', label: 'Data Notes', type: 'options', options: uniqueOptions(optionSourceRows, (row) => candidateDataNotesOptionValues(row)) },
      { key: 'data_uploading_date', label: 'Data Upload Date', type: 'date-range', from: 'data_uploading_from', to: 'data_uploading_to' },
      { key: 'virtual_onsite', label: 'Virtual / Onsite', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.virtual_onsite) },
      { key: 'all_details_sent', label: 'ALL Details sent', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.all_details_sent) },
      { key: 'call_connected', label: 'Call Connected', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.call_connected) },
      { key: 'submitted_by', label: 'Submitted By', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.submitted_by) },
      { key: 'approval_status', label: 'Approved by Manager', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.approval_status) },
    ];
    return sections;
  }, [optionSourceRows, preferredLocationFilterOptions]);

  const activeFilterSection = useMemo(() => filterSections.find((section) => section.key === activeFilterKey) || filterSections[0] || null, [filterSections, activeFilterKey]);
  const activeOptionSearch = optionSearches[activeFilterSection?.key] || '';
  const activeVisibleOptions = useMemo(() => {
    if (!activeFilterSection || activeFilterSection.type !== 'options') return [];
    return (activeFilterSection.options || []).filter((item) => containsText(item, activeOptionSearch));
  }, [activeFilterSection, activeOptionSearch]);
  const mostUsedPresets = useMemo(() => {
    return [...savedFilters]
      .sort((a, b) => (b.use_count || 0) - (a.use_count || 0) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
      .slice(0, 5);
  }, [savedFilters]);

  useEffect(() => {
    try { localStorage.setItem(FILTER_PRESET_STORAGE_KEY, JSON.stringify(savedFilters)); } catch {}
  }, [savedFilters]);

  useEffect(() => {
    if (!activeFilterSection && filterSections[0]) setActiveFilterKey(filterSections[0].key);
  }, [activeFilterSection, filterSections]);

  const filterLoadMountedRef = useRef(false);
  useEffect(() => {
    // CC26_694: the initial page already loads above. Do not schedule the same query again
    // 220ms later; this removes duplicate React work while the API dedupe remains a safety net.
    if (!filterLoadMountedRef.current) {
      filterLoadMountedRef.current = true;
      return undefined;
    }
    const timer = window.setTimeout(() => {
      load(1, filters).catch(() => {});
    }, 220);
    return () => window.clearTimeout(timer);
  }, [JSON.stringify(filters)]);

  const filteredRows = allRows;
  const visibleRowIds = useMemo(() => Array.from(new Set(filteredRows.map((row) => normalizeId(row.candidate_id)).filter(Boolean))), [filteredRows]);
  // CC26_100: selection is locked to the currently loaded/visible page only.
  // This prevents CRM from sending hidden filtered rows to the mobile APK.
  const selectableRowIds = visibleRowIds;

  const selectedRows = useMemo(() => {
    const rowById = new Map(filteredRows.map((row) => [normalizeId(row.candidate_id), row]));
    return selectedIds.map(normalizeId).map((id) => rowById.get(id)).filter(Boolean);
  }, [filteredRows, selectedIds]);
  const currentDialerTarget = selectedRows[dialerIndex] || selectedRows[0] || null;
  const allSelected = selectableRowIds.length > 0 && selectableRowIds.every((id) => selectedIds.includes(id));
  const activeFilterCount = useMemo(() => {
    const sectionCount = filterSections.reduce((count, section) => count + (countSelectedForSection(section, filters) ? 1 : 0), 0);
    return sectionCount + (String(filters.q || '').trim() ? 1 : 0);
  }, [filters, filterSections]);
  const matchingProfileCount = activeFilterCount ? Number(totalRows || 0) : 0;

  const totalPages = useMemo(() => Math.max(1, Math.ceil((Number(totalRows || 0) || 0) / pageSize)), [totalRows]);
  const pageButtons = useMemo(() => {
    if (totalPages <= 1) return [1];
    const set = new Set([1, totalPages, page, page - 1, page + 1]);
    if (page <= 3) [2, 3, 4].forEach((item) => set.add(item));
    if (page >= totalPages - 2) [totalPages - 1, totalPages - 2, totalPages - 3].forEach((item) => set.add(item));
    return [...set].filter((item) => item >= 1 && item <= totalPages).sort((a, b) => a - b);
  }, [page, totalPages]);

  const bucketCards = useMemo(() => (leadership ? [
    { key: 'all', label: 'Total Profiles', value: summary.total_visible || 0, note: `${summary.allocated_profiles || 0} allocated live`, tone: 'blue' },
    { key: 'fresh', label: 'Fresh Profile', value: summary.fresh_profiles || 0, note: 'Never called yet', tone: 'green' },
    { key: 'allocated', label: 'Allocated', value: summary.allocated_profiles || 0, note: 'Active recruiter buckets', tone: 'teal' },
    { key: 'my_fresh', label: 'My Fresh Profiles', value: summary.my_fresh_profiles || 0, note: `${user?.full_name || 'Current user'} fresh queue`, tone: 'teal' },
    { key: 'my_working', label: 'My Working Profiles', value: summary.my_working_profiles || 0, note: `${user?.full_name || 'Current user'} active working`, tone: 'purple' },
    { key: 'followup_due', label: 'Follow Up Due', value: summary.pending_followups || 0, note: `${summary.followup_profiles || 0} total follow ups`, tone: 'purple' },
    { key: 'warning', label: 'Warning', value: summary.warning_profiles || 0, note: '2-3 days left', tone: 'orange' },
    { key: 'last_day', label: 'Last Day', value: summary.last_day_profiles || 0, note: 'Call first', tone: 'red' },
  ] : [
    { key: 'all', label: 'Total Bucket', value: `${summary.active_bucket || 0}/70`, note: 'Active allocated', tone: 'blue' },
    { key: 'fresh', label: 'Fresh Profile', value: summary.fresh_profiles || 0, note: 'Never called', tone: 'green' },
    { key: 'followup', label: 'Follow Up', value: summary.followup_profiles || 0, note: 'Need callback', tone: 'purple' },
    { key: 'warning', label: 'Warning', value: summary.warning_profiles || 0, note: '2-3 days left', tone: 'orange' },
    { key: 'last_day', label: 'Last Day', value: summary.last_day_profiles || 0, note: 'Call first', tone: 'red' },
  ]), [summary, leadership, user?.full_name]);

  const quickFilters = useMemo(() => (leadership ? [
    ['all', 'All Profiles'],
    ['fresh', 'Fresh Profile'],
    ['allocated', 'Allocated'],
    ['followup_due', 'Follow Up Due'],
    ['warning', 'Warning'],
    ['last_day', 'Last Day'],
  ] : [
    ['all', 'All Profiles'],
    ['fresh', 'Fresh Profile'],
    ['followup', 'Follow Up'],
    ['days_1', '1 Day Left'],
    ['days_2', '2 Days Left'],
    ['days_3', '3 Days Left'],
    ['days_4_plus', '4+ Days'],
    ['warning', 'Warning'],
    ['last_day', 'Last Day'],
  ]), [leadership]);

  useEffect(() => {
    setSelectedIds((prev) => prev.map(normalizeId).filter((id) => selectableRowIds.includes(id)));
  }, [selectableRowIds]);

  useEffect(() => {
    if (!selectedRows.length) {
      setDialerOpen(false);
      setDialerIndex(0);
      return;
    }
    if (dialerIndex >= selectedRows.length) setDialerIndex(0);
  }, [selectedRows.length, dialerIndex]);

  async function dialCandidate(candidateId, phone) {
    dialCandidateWithLog(candidateId, phone);
  }

  function openWhatsApp(candidateId, phone, template = '') {
    openWhatsAppWithLog(candidateId, phone, template);
  }

  function onTemplatePick(row, value) {
    if (!value) return;
    if (value === '__add_new__') {
      const fresh = window.prompt('Type new WhatsApp template');
      if (fresh) setWaTemplates(addWhatsAppTemplate(fresh));
      return;
    }
    const template = decodeWhatsAppTemplateOption(value);
    if (!template?.body) return;
    openWhatsApp(row.candidate_id, row.phone, renderWhatsAppTemplateBody(template.body, row, user));
  }

  function onDialerTemplatePick(value) {
    if (!currentDialerTarget || !value) return;
    if (value === '__add_new__') {
      const fresh = window.prompt('Type new WhatsApp template');
      if (fresh) setWaTemplates(addWhatsAppTemplate(fresh));
      return;
    }
    const template = decodeWhatsAppTemplateOption(value);
    if (!template?.body) return;
    openWhatsApp(currentDialerTarget.candidate_id, currentDialerTarget.phone, renderWhatsAppTemplateBody(template.body, currentDialerTarget, user));
  }

  function toggleSelection(candidateId) {
    const id = normalizeId(candidateId);
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => allSelected ? prev.filter((id) => !selectableRowIds.includes(id)) : Array.from(new Set([...prev, ...selectableRowIds])));
  }

  function clearSelection() {
    setSelectedIds([]);
    setDialerOpen(false);
    setDialerIndex(0);
    setAutoNextCountdown(0);
  }

  async function loadSelectedToAutoDialer() {
    if (!selectedRows.length) return;
    const startRow = currentDialerTarget || selectedRows[0];
    const startId = normalizeId(startRow?.candidate_id);
    const startIndex = selectedRows.findIndex((row) => normalizeId(row.candidate_id) === startId);
    const orderedItems = startIndex > 0 ? [...selectedRows.slice(startIndex), ...selectedRows.slice(0, startIndex)] : selectedRows;
    const payload = { source: 'Candidates', items: orderedItems.map((row, index) => ({ ...row, queue_order: index + 1, dialer_sequence: index + 1, __dialer_order: index + 1 })), start_candidate_id: startId, created_at: new Date().toISOString() };
    try { sessionStorage.setItem('careerCroxAutoDialerQueue:v1', JSON.stringify(payload)); localStorage.setItem('careerCroxAutoDialerQueue:v1', JSON.stringify(payload)); } catch {}
    window.open('/auto-dialer', '_blank');
  }


  function markCallDoneAndAutoNext() {
    if (!selectedRows.length) return;
    setAutoNextCountdown(7);
  }

  function nextSelected() {
    if (!selectedRows.length) return;
    setDialerIndex((prev) => (prev + 1) % selectedRows.length);
  }

  function prevSelected() {
    if (!selectedRows.length) return;
    setDialerIndex((prev) => (prev - 1 + selectedRows.length) % selectedRows.length);
  }

  useEffect(() => {
    if (!autoNextCountdown) return undefined;
    const timer = window.setTimeout(() => {
      setAutoNextCountdown((current) => {
        if (current <= 1) {
          window.setTimeout(() => nextSelected(), 0);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [autoNextCountdown, selectedRows.length]);

  function goToPage(targetPage) {
    const nextPage = Math.min(totalPages, Math.max(1, Number(targetPage || 1) || 1));
    setPageJumpValue(String(nextPage));
    load(nextPage, filters).catch(() => {});
  }

  function submitPageJump() {
    goToPage(pageJumpValue);
  }

  function resetFilters() {
      setPage(1);
    setFilters((current) => ({ ...defaultFilters, q: current.q, bucket_view: 'all' }));
    setOptionSearches({});
  }

  function clearCurrentSection(section) {
    if (!section) return resetFilters();
    if (section.type === 'options') setFilters((prev) => ({ ...prev, [section.key]: [] }));
    else setFilters((prev) => ({ ...prev, [section.from]: '', [section.to]: '' }));
    setOptionSearches((prev) => ({ ...prev, [section.key]: '' }));
  }

  function saveCurrentPreset() {
    if (!filtersHaveAnyValue(filters)) {
      setMessage('Select at least one filter before saving.');
      return;
    }
    const name = String(presetName || '').trim() || `Filter ${savedFilters.length + 1}`;
    const existing = savedFilters.find((item) => String(item.name || '').toLowerCase() === name.toLowerCase());
    const nextItem = {
      id: existing?.id || `flt_${Date.now()}`,
      name,
      filters,
      use_count: existing?.use_count || 0,
      updated_at: new Date().toISOString(),
    };
    const next = existing
      ? savedFilters.map((item) => item.id === existing.id ? nextItem : item)
      : [nextItem, ...savedFilters].slice(0, 20);
    setSavedFilters(next);
    setPresetName('');
    setMessage(`Filter "${name}" saved successfully.`);
  }

  function applyPreset(preset) {
    if (!preset?.filters) return;
    setFilters({ ...defaultFilters, ...preset.filters });
    const next = savedFilters.map((item) => item.id === preset.id ? { ...item, use_count: Number(item.use_count || 0) + 1, updated_at: new Date().toISOString() } : item);
    setSavedFilters(next);
    const firstUsedSection = filterSections.find((section) => countSelectedForSection(section, { ...defaultFilters, ...preset.filters }) > 0) || filterSections[0];
    if (firstUsedSection) setActiveFilterKey(firstUsedSection.key);
    setMessage(`Filter "${preset.name}" applied successfully.`);
  }

  function deletePreset(presetId) {
    setSavedFilters((prev) => prev.filter((item) => item.id !== presetId));
  }

  function showInstantBucketPreview(nextFilters, requestedView) {
    const qs = buildCandidateQuery(nextFilters, 1, pageSize);
    const exact = readPageCache(`${candidatesCacheKey}:slice:${qs}`, null);
    if (exact && Array.isArray(exact.items)) {
      setAllRows(exact.items);
      setSelectableRows(exact.items);
      if (Number.isFinite(Number(exact.total))) setTotalRows(Number(exact.total));
      return true;
    }
    const source = readPageCache(`${candidatesCacheKey}:filter-options:v517`, filterRows);
    const completeSource = Array.isArray(source) && source.length > 0 && Number(summary?.total_visible || 0) <= source.length;
    const unsupported = Object.entries(nextFilters || {}).some(([key, value]) => {
      if (['bucket_view', 'recruiter_code'].includes(key)) return false;
      if (key === 'q') return Boolean(String(value || '').trim());
      return Array.isArray(value) ? value.length > 0 : Boolean(String(value || '').trim());
    });
    if (!completeSource || unsupported) return false;
    const recruiterCode = String((nextFilters?.recruiter_code || [])[0] || '').trim().toLowerCase();
    const effectiveView = requestedView === 'my_fresh' ? 'fresh' : (requestedView === 'my_working' ? 'allocated' : requestedView);
    const preview = instantBucketSort(source.filter((row) => {
      if (recruiterCode && String(row?.recruiter_code || '').trim().toLowerCase() !== recruiterCode) return false;
      return instantBucketMatches(row, effectiveView);
    }), effectiveView).slice(0, pageSize);
    setAllRows(preview);
    setSelectableRows(preview);
    const count = requestedView === 'my_fresh' ? Number(summary?.my_fresh_profiles || preview.length)
      : requestedView === 'my_working' ? Number(summary?.my_working_profiles || preview.length)
      : instantBucketSummaryCount(summary, effectiveView);
    setTotalRows(Number.isFinite(count) ? count : preview.length);
    return true;
  }

  function setBucketView(bucketView) {
    setPage(1);
    setFilters((prev) => {
      let next;
      if (bucketView === 'my_fresh') {
        autoBucketRecruiterRef.current = true;
        next = { ...prev, bucket_view: 'fresh', recruiter_code: user?.recruiter_code ? [user.recruiter_code] : prev.recruiter_code };
      } else if (bucketView === 'my_working') {
        autoBucketRecruiterRef.current = true;
        next = { ...prev, bucket_view: 'allocated', recruiter_code: user?.recruiter_code ? [user.recruiter_code] : prev.recruiter_code };
      } else {
        next = { ...prev, bucket_view: bucketView, recruiter_code: autoBucketRecruiterRef.current ? [] : prev.recruiter_code };
        autoBucketRecruiterRef.current = false;
      }
      showInstantBucketPreview(next, bucketView);
      return next;
    });
  }

  return (
    <Layout title="Candidates" subtitle="">
      {!!message && <div className="panel top-gap-small"><div className="helper-text">{message}</div></div>}

      <div className="bucket-card-grid top-gap-small fade-up">
        {bucketCards.map((card) => {
          const active = (card.key === 'my_fresh' && filters.bucket_view === 'fresh' && ((filters.recruiter_code || [])[0] || '') === String(user?.recruiter_code || '')) || (card.key === 'my_working' && filters.bucket_view === 'allocated' && ((filters.recruiter_code || [])[0] || '') === String(user?.recruiter_code || '')) || filters.bucket_view === card.key || (card.key === 'all' && !filters.bucket_view);
          return (
            <button key={card.key} type="button" className={`stat-card bucket-click-card ${card.tone} ${active ? 'active' : ''}`} onClick={() => setBucketView(card.key)}>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <small>{card.note}</small>
            </button>
          );
        })}
      </div>

      <div className="table-panel top-gap-small glassy-card fade-up bucket-toolbar-panel">
        <div className="table-toolbar no-wrap-toolbar bucket-toolbar-stack">
          <div>
            <div className="table-title">{leadership ? 'Candidate Tracker' : 'My Profile Bucket'}</div>
            <div className="helper-text">{leadership ? `Total CRM profiles: ${summary.total_visible || 0} • Fresh: ${summary.fresh_profiles || 0} • Allocated: ${summary.allocated_profiles || 0}` : `Bucket used: ${summary.active_bucket || 0}/70 • Bucket profiles move out automatically after expiry.`}</div>
          </div>
          <div className="toolbar-actions compact-pills candidate-toolbar-actions bucket-head-actions">
            <span className="metric-mini-chip records">{totalRows} records</span>
            {activeFilterCount ? <span className="metric-mini-chip filters">{activeFilterCount} filters</span> : null}
            {leadership ? (
              <label className="compact-select-shell shell-sky candidate-recruiter-shell">
                <span className="compact-shell-label">Recruiter</span>
                <select className="inline-input compact-inline-input bucket-target-select" value={(filters.recruiter_code || [])[0] || ''} onChange={(e) => { autoBucketRecruiterRef.current = false; setFilters((prev) => ({ ...prev, recruiter_code: e.target.value ? [e.target.value] : [] })); }}>
                  <option value="">All Recruiters</option>
                  {recruiterOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            ) : null}
            <button type="button" className="ghost-btn bounceable modern-filter-btn gradient-action-btn gradient-slate" onClick={() => { setShowFilterDrawer(true); }}><FilterIcon /> Filters</button>
          </div>
        </div>

        <div className="bucket-quick-filter-row">
          {quickFilters.map(([key, label]) => (
            <button key={key} type="button" className={`bucket-quick-pill bounceable ${filters.bucket_view === key ? 'active' : ''}`} onClick={() => setBucketView(key)}>{label}</button>
          ))}
          <label className="compact-select-shell shell-sky candidate-recruiter-shell">
            <span className="compact-shell-label">Last Viewed</span>
            <select
              className="inline-input compact-inline-input bucket-target-select"
              value={filters.last_viewed_mode || ''}
              onChange={(e) => {
                const nextMode = String(e.target.value || '');
                setPage(1);
                setFilters((prev) => ({
                  ...prev,
                  last_viewed_mode: nextMode,
                  last_viewed_days: nextMode === 'custom' ? prev.last_viewed_days : '',
                }));
              }}
            >
              <option value="">All Last Viewed</option>
              <option value="today">Today</option>
              <option value="lt1">&lt; 1 Day</option>
              <option value="lt2">&lt; 2 Day</option>
              <option value="lt5">&lt; 5 Day</option>
              <option value="custom">Custom Days</option>
            </select>
          </label>
          {filters.last_viewed_mode === 'custom' ? (
            <label className="compact-select-shell shell-sky candidate-recruiter-shell">
              <span className="compact-shell-label">Days</span>
              <input
                className="inline-input compact-inline-input bucket-target-select"
                type="number"
                min="1"
                max="365"
                value={filters.last_viewed_days || ''}
                onChange={(e) => {
                  const nextDays = sanitizeLastViewedDays(e.target.value);
                  setPage(1);
                  setFilters((prev) => ({ ...prev, last_viewed_days: nextDays }));
                }}
                placeholder="10"
              />
            </label>
          ) : null}
          {filters.last_viewed_mode ? (
            <button type="button" className="bucket-quick-pill bounceable active" onClick={() => { setPage(1); setFilters((prev) => ({ ...prev, last_viewed_mode: '', last_viewed_days: '' })); }}>
              {lastViewedFilterSummary(filters)}
            </button>
          ) : null}
        </div>

        <div className="candidate-master-row">
          <button type="button" className={`selection-master-pill bounceable ${allSelected ? 'active' : ''}`} onClick={toggleSelectAll}>
            <span className="selection-master-icon"><SelectAllIcon /></span>
            {allSelected ? 'Clear All' : `Select All ${selectableRowIds.length || ''}`} 
          </button>
          <span className="selection-count-chip">{selectedIds.length} selected</span>
          <button type="button" className={`open-dialer-pill bounceable ${selectedRows.length >= 2 ? 'active' : ''}`} onClick={() => setDialerOpen((prev) => selectedRows.length >= 2 ? !prev : false)} disabled={selectedRows.length < 2}>
            <DialerIcon /> Dialer
          </button>
          <button type="button" className="add-profile-btn bounceable" onClick={loadSelectedToAutoDialer} disabled={selectedRows.length < 2}>Load to Auto Dialer</button>
          {selectedRows.length ? <button type="button" className="ghost-btn bounceable" onClick={clearSelection}>Clear Selection</button> : null}
        </div>

        {dialerOpen && currentDialerTarget ? (
          <div className="floating-dialer show top-gap-small">
            <div className="dialer-head">
              <div>
                <h3 className="dialer-title">Dialer</h3>
                <div className="helper-text">{selectedRows.length} selected • {dialerIndex + 1} / {selectedRows.length}</div>
              </div>
              <button type="button" className="mini-btn ghost bounceable" onClick={() => setDialerOpen(false)} title="Close Dialer"><CloseIcon /></button>
            </div>

            <div className="dialer-now">
              <div className="helper-text">Current target</div>
              {currentDialerTarget.full_name} • {visiblePhone(user, currentDialerTarget.phone || '')}
            </div>

            <div className="dialer-actions-row row-actions nowrap-actions">
              <button type="button" className="mini-btn ghost bounceable modern-nav-btn" onClick={prevSelected} title="Previous"><PrevIcon /></button>
              <button type="button" className="mini-btn view bounceable modern-icon-btn modern-call-btn" onClick={() => dialCandidate(currentDialerTarget.candidate_id, currentDialerTarget.phone)} title="Dial now"><PhoneIcon /></button>
              <button type="button" className="mini-btn edit bounceable modern-icon-btn modern-wa-btn" onClick={() => openWhatsApp(currentDialerTarget.candidate_id, currentDialerTarget.phone, '')} title="Open WhatsApp"><WhatsAppIcon /></button>
              <select className="wa-template-select dialer-template-select" defaultValue="" onChange={(e) => { onDialerTemplatePick(e.target.value); e.target.value = ''; }}>
                <option value="">WA Template</option>
                {(Array.isArray(waTemplates) ? waTemplates : []).slice(0, 80).map((tpl, index) => {
                  const option = normalizeWhatsAppTemplateOption(tpl, index);
                  return option ? <option key={`${option.title}-${index}`} value={encodeWhatsAppTemplateOption(option, index)}>{option.title}</option> : null;
                })}
                <option value="__add_new__">Add New...</option>
              </select>
              <button type="button" className="mini-btn ghost bounceable modern-nav-btn" onClick={nextSelected} title="Next"><NextIcon /></button>
              <button type="button" className="open-profile-chip bounceable" onClick={markCallDoneAndAutoNext}>{autoNextCountdown ? `Next in ${autoNextCountdown}s` : 'Call Done'}</button>
              <button type="button" className="open-profile-chip bounceable" onClick={() => openCandidateProfile(currentDialerTarget)}>Open Profile</button>
            </div>
          </div>
        ) : null}

        <div className="crm-table-wrap dense-wrap top-gap-small candidates-scroll-wrap">
          <table className="crm-table colorful-table dense-table candidates-overview-table">
            <thead>
              <tr>
                <th style={{ width: 84 }}>
                  <button type="button" className={`table-master-check ${allSelected ? 'active' : ''}`} onClick={toggleSelectAll} title={allSelected ? 'Clear All' : `Select All ${selectableRowIds.length || ''}`} >
                    <CheckIcon />
                  </button>
                </th>
                <th className="candidate-id-col">Candidate ID</th>
                <th className="candidate-name-col">Name</th>
                <th className="candidate-number-col">Number</th>
                <th className="candidate-location-col">Location</th>
                <th className="candidate-qualification-col">Qualification</th>
                <th className="bucket-highlight-col candidate-date-col">Date / Days</th>
                <th className="bucket-highlight-col candidate-status-col">Status</th>
                <th className="bucket-highlight-col candidate-last-viewed-col">Last Viewed</th>
                <th className="bucket-highlight-col candidate-priority-col">Priority</th>
                <th className="sticky-action-col candidate-actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, rowIndex) => {
                const selected = selectedIds.includes(normalizeId(row.candidate_id));
                const freshView = row.bucket_is_fresh || filters.bucket_view === 'fresh';
                const statusText = freshView ? (row.status || 'Draft') : (row.bucket_status_label || row.status || '-');
                const statusTone = String(statusText || '').trim().toLowerCase() === 'draft' ? 'draft' : toneForBucket(row.bucket_stage);
                const priorityText = freshView ? (row.profile_priority || 'Not set') : (row.bucket_priority_label || '-');
                const lastViewedText = formatLastViewed(row.last_viewed_at);
                const lastViewedAgo = formatRelativeDays(row.last_viewed_at);
                const cc716CreatedAt = row.created_at || '';
                const daysLeftText = formatDaysLeft(row.bucket_days_left);
                const dateText = freshView
                  ? (cc716CreatedAt ? formatBucketDate(cc716CreatedAt) : '-')
                  : (filters.bucket_view === 'followup' && row.follow_up_at
                    ? formatBucketDate(row.follow_up_at)
                    : `${row.bucket_days_left || 0} Day${Number(row.bucket_days_left || 0) === 1 ? '' : 's'}`);
                return (
                  <tr key={row.candidate_id} className={`clickable-row ${selected ? 'selected-row' : ''}`} onClick={() => openCandidateProfile(row)}>
                    <td className="candidate-select-cell">
                      <button type="button" className={`row-check-btn bounceable ${selected ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); toggleSelection(row.candidate_id); }} title={selected ? 'Selected' : 'Select candidate'}>
                        <CheckIcon />
                      </button>
                    </td>
                    <td className="candidate-id-cell"><strong title={`Candidate ID: ${safeCellText(row.candidate_id, '-')}`}>{safeCellText(row.candidate_id, '-')}</strong></td>
                    <td className="candidate-name-cell"><strong>{safeCellText(row.full_name, '-')}</strong><br /><span className="subtle">{safeCellText(row.recruiter_name || row.process, '-')}</span>{row.data_notes ? <div className="helper-text submission-mini-text">Notes: {safeCellText(row.data_notes)}</div> : null}</td>
                    <td className="candidate-number-cell">{visiblePhone(user, row.phone)}</td>
                    <td className="candidate-location-cell">{safeCellText(row.location || row.preferred_location, '-')}</td>
                    <td className="candidate-qualification-cell">{safeCellText(row.qualification || row.qualification_level, '-')}</td>
                    <td className="bucket-highlight-cell"><span className={`bucket-status-chip ${toneForBucket(row.bucket_stage)}`}>{dateText}</span><div className="subtle top-gap-small">{freshView ? (daysLeftText || (cc716CreatedAt ? 'Created on' : 'Date unavailable')) : `Assigned ${formatBucketDate(row.bucket_assigned_at)}`}</div></td>
                    <td className="bucket-highlight-cell"><span className={`bucket-status-chip ${statusTone}`}>{statusText}</span></td>
                    <td className="bucket-highlight-cell"><div className="last-viewed-stack"><span className={`bucket-status-chip ${row.last_viewed_at ? 'safe' : 'info'}`}>{lastViewedText}</span>{lastViewedAgo ? <div className="subtle top-gap-small">{lastViewedAgo}</div> : null}{row.last_viewed_by_name ? <div className="subtle top-gap-small">By {safeCellText(row.last_viewed_by_name)}</div> : null}</div></td>
                    <td className="bucket-highlight-cell"><span className={`bucket-priority-chip ${priorityTone(priorityText)}`}>{priorityText}</span></td>
                    <td className="sticky-actions-cell">
                      <div className="row-actions nowrap-actions compact-row-actions">
                        <button type="button" className="mini-btn call bounceable modern-icon-btn modern-eye-btn" onClick={(e) => { e.stopPropagation(); openCandidateProfile(row); }} title="Open Profile"><EyeIcon /></button>
                        <button className="mini-btn view bounceable modern-icon-btn modern-call-btn" type="button" title="Dial Call" onClick={(e) => { e.stopPropagation(); dialCandidate(row.candidate_id, row.phone); }}><PhoneIcon /></button>
                        <button className="mini-btn edit bounceable modern-icon-btn modern-wa-btn" type="button" title="Open WhatsApp" onClick={(e) => { e.stopPropagation(); openWhatsApp(row.candidate_id, row.phone, ''); }}><WhatsAppIcon /></button>
                        <select className="wa-template-select mini-wa-template-select" defaultValue="" onClick={(e) => e.stopPropagation()} onChange={(e) => { onTemplatePick(row, e.target.value); e.target.value = ''; }}>
                          <option value="">Template</option>
                          {(Array.isArray(waTemplates) ? waTemplates : []).slice(0, 80).map((tpl, index) => {
                  const option = normalizeWhatsAppTemplateOption(tpl, index);
                  return option ? <option key={`${option.title}-${index}`} value={encodeWhatsAppTemplateOption(option, index)}>{option.title}</option> : null;
                })}
                          <option value="__add_new__">Add New...</option>
                        </select>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredRows.length === 0 && <tr><td colSpan="11" className="helper-text">No candidates found.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="row-actions top-gap-small candidate-pager-row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="helper-text">Page {page} of {totalPages} • Showing {filteredRows.length} of {totalRows}</div>
          <div className="row-actions candidate-page-jump-wrap" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="ghost-btn bounceable" disabled={page <= 1} onClick={() => goToPage(page - 1)}>Previous 10</button>
            <div className="row-actions candidate-page-number-row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {pageButtons.map((value, index) => {
                const prevValue = pageButtons[index - 1];
                const showGap = index > 0 && value - prevValue > 1;
                return (
                  <React.Fragment key={value}>
                    {showGap ? <span className="helper-text">...</span> : null}
                    <button type="button" className={`bucket-quick-pill bounceable ${page === value ? 'active' : ''}`} onClick={() => goToPage(value)}>{value}</button>
                  </React.Fragment>
                );
              })}
            </div>
            <div className="row-actions" style={{ gap: 8, alignItems: 'center' }}>
              <input
                className="inline-input candidate-page-jump-input"
                type="number"
                min="1"
                max={totalPages}
                value={pageJumpValue}
                onChange={(e) => setPageJumpValue(e.target.value.replace(/[^\d]/g, '').slice(0, 4) || '')}
                onKeyDown={(e) => { if (e.key === 'Enter') submitPageJump(); }}
                placeholder="Page"
              />
              <button type="button" className="selection-master-pill bounceable" onClick={submitPageJump}>Go</button>
            </div>
            <button type="button" className="add-profile-btn bounceable" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>Next 10</button>
          </div>
        </div>

      </div>

      {showFilterDrawer && (
        <div className="crm-modal-backdrop candidate-drawer-backdrop wide" onClick={() => setShowFilterDrawer(false)}>
          <div className="candidate-filter-modal candidate-filter-matrix-modal" onClick={(e) => e.stopPropagation()}>
            <div className="candidate-filter-modal-head">
              <div>
                <div className="candidate-filter-modal-title"><FilterIcon /> Advanced Candidate Filters</div>
                <div className="helper-text">More filters on one screen — pick a filter tile, choose values, and keep working without long scrolling.</div>
              </div>
              <div className="candidate-filter-head-actions">
                <span className="mini-chip live-chip">{matchingProfileCount} matching profiles</span>
                {activeFilterCount ? <span className="mini-chip live-chip">{activeFilterCount} active</span> : <span className="mini-chip">No active filters</span>}
                <button type="button" className="ghost-btn bounceable" onClick={resetFilters}>Clear All</button>
                <button type="button" className="add-profile-btn bounceable" onClick={() => setShowFilterDrawer(false)}>Done</button>
              </div>
            </div>
            <div className="candidate-filter-modal-body">
              <aside className="candidate-filter-sidebar">
                <div className="candidate-filter-save-card gradient-card blue">
                  <div className="candidate-filter-save-title">Most Used Filters</div>
                  <div className="candidate-preset-list">
                    {mostUsedPresets.length ? mostUsedPresets.map((preset) => (
                      <div key={preset.id} className="candidate-preset-item">
                        <button type="button" className="candidate-preset-apply" onClick={() => applyPreset(preset)}>
                          <strong>{preset.name}</strong>
                          <span>{preset.use_count || 0} uses</span>
                        </button>
                        <button type="button" className="candidate-preset-delete" onClick={() => deletePreset(preset.id)} title="Delete saved filter"><CloseIcon /></button>
                      </div>
                    )) : <div className="helper-text">No saved filters yet.</div>}
                  </div>
                </div>

                <div className="candidate-filter-save-card gradient-card violet top-gap-small">
                  <div className="candidate-filter-save-title">Save Current Filter</div>
                  <div className="field no-label-field">
                    <input className="inline-input" value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Filter name, like Noida Freshers" />
                  </div>
                  <button type="button" className="add-profile-btn bounceable full-width-btn" onClick={saveCurrentPreset}>Save Filter</button>
                </div>

                <div className="candidate-filter-nav top-gap-small">
                  {filterSections.map((section) => {
                    const selectedCount = countSelectedForSection(section, filters);
                    const isActive = activeFilterSection?.key === section.key;
                    return (
                      <button
                        key={section.key}
                        type="button"
                        className={`candidate-filter-nav-item ${isActive ? 'active' : ''} ${selectedCount ? 'selected' : ''}`}
                        onClick={() => setActiveFilterKey(section.key)}
                      >
                        <div>
                          <strong>{section.label}</strong>
                          <span>{selectedCount ? `${selectedCount} selected` : 'All'}</span>
                        </div>
                        <ArrowIcon />
                      </button>
                    );
                  })}
                </div>
              </aside>

              <section className="candidate-filter-detail-panel">
                {activeFilterSection ? (
                  <>
                    <div className="candidate-filter-detail-head">
                      <div>
                        <div className="candidate-filter-detail-title">{activeFilterSection.label}</div>
                        <div className="candidate-filter-detail-sub">Select values directly here. Active selections are highlighted in green.</div>
                        <div className="helper-text top-gap-small"><strong>{matchingProfileCount}</strong> profiles match the current filter state.</div>
                      </div>
                      <div className="row-actions" style={{ gap: 8, flexWrap: 'wrap' }}>
                        {activeFilterSection.type === 'options' ? (
                          <button
                            type="button"
                            className="ghost-btn bounceable"
                            onClick={() => setFilters((prev) => {
                              const current = Array.isArray(prev[activeFilterSection.key]) ? prev[activeFilterSection.key] : [];
                              const allSelected = current.includes(FILTER_ALL_MARKER)
                                || ((activeFilterSection.options || []).length > 0 && (activeFilterSection.options || []).every((item) => current.includes(item)));
                              return { ...prev, [activeFilterSection.key]: allSelected ? [] : [FILTER_ALL_MARKER] };
                            })}
                          >
                            {(filters[activeFilterSection.key] || []).includes(FILTER_ALL_MARKER) ? 'Clear All Options' : 'Select All'}
                          </button>
                        ) : null}
                        <button type="button" className="ghost-btn bounceable candidate-inline-clear" onClick={() => clearCurrentSection(activeFilterSection)}>Clear</button>
                      </div>
                    </div>

                    {activeFilterSection.type === 'options' ? (
                      <>
                        <div className="field no-label-field">
                          <input
                            className="inline-input"
                            value={activeOptionSearch}
                            onChange={(e) => setOptionSearches((prev) => ({ ...prev, [activeFilterSection.key]: e.target.value }))}
                            placeholder={`Search ${activeFilterSection.label}`}
                          />
                        </div>
                        <div className="candidate-option-grid roomy two-col top-gap-small">
                          {activeVisibleOptions.map((item) => {
                            const selectedValues = filters[activeFilterSection.key] || [];
                            const checked = selectedValues.includes(FILTER_ALL_MARKER) || selectedValues.includes(item);
                            return (
                              <label key={item} className={`candidate-option-card ${checked ? 'checked' : ''}`}>
                                <input type="checkbox" checked={checked} onChange={() => setFilters((prev) => toggleArrayValue(prev, activeFilterSection.key, item, activeFilterSection.options || []))} />
                                <span>{item}</span>
                              </label>
                            );
                          })}
                          {!activeVisibleOptions.length && <div className="helper-text">No options found.</div>}
                        </div>
                      </>
                    ) : (
                      <div className="candidate-range-row wider top-gap-small">
                        <div className="field">
                          <label>{activeFilterSection.type === 'date-range' ? 'From Date' : 'From'}</label>
                          <input className="inline-input" type={activeFilterSection.type === 'date-range' ? 'date' : 'number'} value={filters[activeFilterSection.from]} onChange={(e) => setFilters((prev) => ({ ...prev, [activeFilterSection.from]: e.target.value }))} />
                        </div>
                        <div className="field">
                          <label>{activeFilterSection.type === 'date-range' ? 'To Date' : 'To'}</label>
                          <input className="inline-input" type={activeFilterSection.type === 'date-range' ? 'date' : 'number'} value={filters[activeFilterSection.to]} onChange={(e) => setFilters((prev) => ({ ...prev, [activeFilterSection.to]: e.target.value }))} />
                        </div>
                      </div>
                    )}
                  </>
                ) : null}
              </section>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
