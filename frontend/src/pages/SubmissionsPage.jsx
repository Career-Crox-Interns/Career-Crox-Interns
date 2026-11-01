import {isInactiveProfile} from '../lib/candidateAccess';
import {useSliceSearch,useSliceState,CrmSortSelect,sortCrmRows} from '../lib/workspaceHelpers';
import {useCandidateFilterCatalog} from '../lib/workspaceHelpers';
import { parseDateInput, toCrmDateTimeLocalInput } from '../lib/workspaceHelpers';
import { CrmDateTimeInput } from '../components/PremiumSelect';
import { ActionGlyph } from '../components/EmojiGlyph';
import PremiumSelect from '../components/PremiumSelect';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { api, invalidateGetResource } from '../lib/api';
import { useSmartDeltaSync } from '../lib/smartSync';
import { useDashboardAuth as useAuth } from '../lib/auth';
import { dialCandidateWithLog, openWhatsAppWithLog } from '../lib/candidateAccess';
import { openCandidateProfileInNewTab } from '../lib/candidateNav';
import { readViewState, writeViewState, updateRowSelection } from '../lib/workspaceHelpers';
import { readPageCache, writePageCache } from '../lib/persistentPageCache';
import { buildInstantSubmissionRow, onCandidateRealtime } from '../lib/realtimeProfileBridge';
import { isSameCrmDay, crmDayBoundsUtcIso } from '../lib/workspaceHelpers';

const CRM_REMINDER_LOOKAHEAD_MS = 10 * 60 * 1000;


function safeCellText(value, fallback = '') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map((item) => safeCellText(item)).filter(Boolean).join(', ') || fallback;
  try {
    const compact = JSON.stringify(value);
    return compact === undefined ? fallback : compact;
  } catch {
    return fallback;
  }
}

function safeRows(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function formatDate(value) {
  if (!value) return '-';
  const date = parseDateInput(value);
  if ((!date || Number.isNaN(date.getTime()))) return String(value).replace('T', ' ').slice(0, 16);
  return date.toLocaleString([], {
    hour12: true,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function toDateTimeLocal(value) {
  return value ? toCrmDateTimeLocalInput(value) : '';
}

function addDuration(hours, minutes) {
  const date = new Date();
  date.setHours(date.getHours() + Number(hours || 0));
  date.setMinutes(date.getMinutes() + Number(minutes || 0));
  return date.toISOString();
}

function reminderState(row) {
  const followUpAt = new Date(effectiveFollowUpAt(row) || 0).getTime();
  if (!followUpAt) return 'No Reminder';
  const snoozeUntil = new Date(row.reminder_snoozed_until || 0).getTime();
  const now = Date.now();
  if (snoozeUntil && snoozeUntil > now) return 'Scheduled';
  if (followUpAt <= now + CRM_REMINDER_LOOKAHEAD_MS) return 'Due';
  return 'Scheduled';
}

function timeLeftText(row) {
  const t = new Date(effectiveFollowUpAt(row) || 0).getTime();
  if (!t) return '';
  const diff = t - Date.now();
  const absMins = Math.round(Math.abs(diff) / 60000);
  const hrs = Math.floor(absMins / 60);
  const mins = absMins % 60;
  const parts = [];
  if (hrs) parts.push(`${hrs}h`);
  if (mins || !parts.length) parts.push(`${mins}m`);
  return diff <= 0 ? `${parts.join(' ')} overdue` : `${parts.join(' ')} left`;
}

function splitValues(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function uniqueOptions(rows, getter, split = false) {
  return Array.from(new Set(rows.flatMap((row) => {
    const value = getter(row);
    return split ? splitValues(value) : [String(value || '').trim()].filter(Boolean);
  }))).sort((a, b) => String(a).localeCompare(String(b)));
}

function matchesText(value, expected) {
  return String(value || '').trim().toLowerCase() === String(expected || '').trim().toLowerCase();
}

function PhoneIcon() { return <ActionGlyph kind="phone"/>; }

function WhatsAppIcon() { return <ActionGlyph kind="whatsapp"/>; }

const durationPresets = [
  { label: '5m', hours: '0', minutes: '5' },
  { label: '30m', hours: '0', minutes: '30' },
  { label: '1H', hours: '1', minutes: '0' },
  { label: '2H', hours: '2', minutes: '0' },
];

const SUBMISSIONS_VIEW_STATE_KEY = 'careerCroxSubmissionsViewState_v2';
const SUBMISSIONS_CACHE_PURGE_KEY = 'careerCroxSubmissionsCachePurgeVersion';
const SUBMISSIONS_CACHE_PURGE_VERSION = 'CC850-submission-cards-v1';

function clearLegacySubmissionCaches(prefix) {
  try {
    Object.keys(localStorage || {}).forEach((key) => {
      if (String(key).startsWith(prefix) || String(key).startsWith('careerCroxSubmissionsCache:')) {
        localStorage.removeItem(key);
      }
    });
    localStorage.setItem(SUBMISSIONS_CACHE_PURGE_KEY, SUBMISSIONS_CACHE_PURGE_VERSION);
  } catch {}
}

const baseNoteSuggestions = [
  'Call no answer. Retry shortly.',
  'WhatsApp sent. Waiting reply.',
  'Candidate asked for callback.',
  'Need docs before final push.',
  'Follow-up after recruiter check.',
];

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function isHiddenCrmProfileRow(row) {
  const joined = [
    row?.status,
    row?.candidate_status,
    row?.profile_status,
    row?.approval_status,
    row?.all_details_sent,
    row?.follow_up_status,
    row?.hot_lead_status,
    row?.data_notes,
  ].map(lower).join(' | ');
  return Boolean(String(row?.deleted_at || '').trim())
    || joined.includes('__deleted__')
    || joined.includes('[crm-deleted]')
    || joined.split(' | ').some((value) => value === 'deleted' || value === 'archived');
}

function visibleCrmRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => row && !isHiddenCrmProfileRow(row));
}

function submissionStamp(row) {
  // CC26_391: editable Candidate Submission Date is the workflow source of truth.
  // submitted_at remains the immutable audit timestamp in backend storage.
  return row?.candidate_submission_date || row?.submission_date || row?.effective_submission_at || row?.submission_origin_at || row?.submitted_at || row?.approval_requested_at || '';
}

function isNegativeProfileOutcome(row = {}) { return isInactiveProfile(row); }

function submissionViewLabel(viewMode) {
  if (viewMode === 'today') return "today's";
  if (viewMode === 'all') return 'all submissions';
  return 'pending';
}

function latestSubmissionVisibleStamp(row) {
  return submissionStamp(row) || row?.updated_at || row?.created_at || '';
}

function isSameLocalDayValue(value) {
  return isSameCrmDay(value);
}

function isPendingSubmissionRow(row) {
  if (isInactiveProfile(row)) return false;
  const status = lower(row?.status || row?.candidate_status || row?.profile_status || '');
  const approval = lower(row?.approval_status || '');
  const details = lower(row?.all_details_sent || '');
  if (['deleted', '__deleted__', 'archived', 'rejected'].includes(status)) return false;
  if (['deleted', '__deleted__', 'archived', 'rejected', 'draft', ''].includes(approval)) return false;
  return approval === 'pending' || (approval === 'approved' && details === 'pending');
}

// CC850: Approval and All Details Sent are independent workflows.
// Existing 'Only Resume Pending' is the actual Candidate field value, never an inferred flag.
function isOnlyResumePending(row) {
  return lower(row?.all_details_sent) === 'only resume pending';
}
function isDetailsPending(row) {
  return lower(row?.all_details_sent) === 'pending';
}
function isDetailsCompleted(row) {
  return lower(row?.all_details_sent) === 'completed';
}
function isPendingSubmissionApproval(row) {
  return isRealSubmissionRecord(row) && lower(row?.approval_status) === 'pending';
}
function rejectedSubmissionStamp(row) {
  // No fallback to generic updated_at: unrelated edits must never count as today's rejection.
  return row?.rejected_at || row?.submission_rejected_at || '';
}
function isTodayRejectedSubmissionRow(row) {
  return isRealSubmissionRecord(row) && lower(row?.approval_status) === 'rejected'
    && isSameLocalDayValue(rejectedSubmissionStamp(row));
}
const SUBMISSION_CARD_IDS = [
  'all', 'approval_pending', 'resume_pending', 'details_pending',
  'details_completed', 'today_approved', 'today_rejected', 'inactive'
];
function matchesSubmissionCard(row, cardId) {
  if (cardId === 'all') return true;
  if (cardId === 'inactive') return isInactiveProfile(row);
  if (cardId !== 'today_rejected' && isInactiveProfile(row)) return false;
  if (cardId === 'approval_pending') return isPendingSubmissionApproval(row);
  if (cardId === 'resume_pending') return isOnlyResumePending(row);
  if (cardId === 'details_pending') return isDetailsPending(row);
  if (cardId === 'details_completed') return isDetailsCompleted(row);
  if (cardId === 'today_approved') return isTodayApprovedSubmissionRow(row);
  if (cardId === 'today_rejected') return isTodayRejectedSubmissionRow(row);
  return false;
}

function approvedSubmissionStamp(row) {
  // Never use generic updated_at for Today Approved: editing an old approved profile today
  // must not turn it into a new approval.
  return row?.approved_at || row?.approval_decision_at || row?.approval_updated_at || '';
}

function isTodayApprovedSubmissionRow(row) {
  if (!isRealSubmissionRecord(row)) return false;
  if (lower(row?.approval_status || '') !== 'approved') return false;
  return isSameLocalDayValue(approvedSubmissionStamp(row));
}

function rowMatchesSubmissionView(row, viewMode) {
  if (viewMode === 'today') return !isInactiveProfile(row) && isRealSubmissionRecord(row) && isSameLocalDayValue(submissionStamp(row));
  if (viewMode === 'all_pending') return !isInactiveProfile(row) && isPendingSubmissionRow(row);
  return true;
}
function isRealSubmissionRecord(row) {
  if (!row || isHiddenCrmProfileRow(row)) return false;
  const candidateId = String(row?.candidate_id || '').trim();
  const approval = lower(row?.approval_status || '');
  const status = lower(row?.status || row?.candidate_status || row?.profile_status || '');
  if (!candidateId) return false;
  if (['', 'draft', 'deleted', '__deleted__', 'archived'].includes(approval)) return false;
  if (['draft', 'deleted', '__deleted__', 'archived'].includes(status)) return false;
  return Boolean(String(row?.submission_id || row?.approval_requested_at || row?.submitted_at || row?.submission_origin_at || row?.__instant_frontend_row || '').trim());
}


function resolveSubmissionViewMode(value) {
  const view = String(value || '').trim();
  return ['today', 'all', 'all_pending'].includes(view) ? view : 'all';
}

function submissionRowIdentity(row) {
  const candidateId = String(row?.candidate_id || '').trim();
  if (candidateId) return `candidate:${candidateId}`;
  const submissionId = String(row?.submission_id || '').trim();
  if (submissionId) return `submission:${submissionId}`;
  return '';
}

function mergeSubmissionRowSafely(savedRow = {}, incomingRow = {}) {
  const savedAt = Date.parse(savedRow.updated_at || ''), incomingAt = Date.parse(incomingRow.updated_at || '');
  if (savedRow.__instant_frontend_row && Number.isFinite(savedAt) && (!Number.isFinite(incomingAt) || savedAt > incomingAt)) {
    const latest = { ...incomingRow, ...savedRow };
    if (/^(LOCAL-|CANON-)/.test(String(savedRow.submission_id)) && incomingRow.submission_id && !/^(LOCAL-|CANON-)/.test(String(incomingRow.submission_id))) latest.submission_id = incomingRow.submission_id;
    return latest;
  }
  const next = { ...savedRow, ...incomingRow };
  Object.keys(savedRow || {}).forEach((key) => {
    const value = incomingRow?.[key];
    if (value === undefined || value === null || String(value).trim() === '') next[key] = savedRow[key];
  });
  if (savedRow.__instant_frontend_row && !incomingRow.__instant_frontend_row) next.__instant_frontend_row = false;
  return next;
}

function readInstantSubmissionRowsFromStorage() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem('careerCroxRealtimeCandidatePatch:v2');
    if (!raw) return [];
    const payload = JSON.parse(raw);
    const item = payload?.item || {};
    const meta = payload?.meta || {};
    if (!item?.candidate_id || isHiddenCrmProfileRow(item)) return [];
    const approvalPending = lower(item.approval_status) === 'pending';
    if (!meta?.submitted && !approvalPending) return [];
    return [buildInstantSubmissionRow(item, meta?.submission || {})];
  } catch {
    return [];
  }
}

function mergeSubmissionRowsForView(incomingRows = [], currentRows = [], viewMode = 'today') {
  const map = new Map();
  const addRow = (row) => {
    if (!row || !isRealSubmissionRecord(row)) return;
    const key = submissionRowIdentity(row);
    if (!key) return;
    const previous = map.get(key);
    map.set(key, previous ? mergeSubmissionRowSafely(previous, row) : row);
  };

  (Array.isArray(currentRows) ? currentRows : [])
    .filter((row) => row?.__instant_frontend_row)
    .forEach(addRow);
  readInstantSubmissionRowsFromStorage().forEach(addRow);
  (Array.isArray(incomingRows) ? incomingRows : []).forEach(addRow);

  return Array.from(map.values())
    .filter((row) => rowMatchesSubmissionView(row, viewMode))
    .sort((a, b) => String(latestSubmissionVisibleStamp(b)).localeCompare(String(latestSubmissionVisibleStamp(a))));
}

// A delta changes one submission; it is not an authoritative replacement list.
function applySubmissionUpdates(currentRows, patches, viewMode = 'all') {
  const map = new Map(currentRows.map(row => [submissionRowIdentity(row), row]));
  for (const patch of patches) {
    const key = submissionRowIdentity(patch);
    if (!key) continue;
    if (isHiddenCrmProfileRow(patch)) map.delete(key);
    else map.set(key, mergeSubmissionRowSafely(map.get(key) || {}, patch));
  }
  return [...map.values()].filter(isRealSubmissionRecord).filter(row => rowMatchesSubmissionView(row, viewMode))
    .sort((a, b) => String(latestSubmissionVisibleStamp(b)).localeCompare(String(latestSubmissionVisibleStamp(a))));
}

function statusText(row) {
  return `${row.status || ''} ${row.candidate_status || ''}`.toLowerCase();
}

function hoursSince(value) {
  const t = new Date(value || 0).getTime();
  if (!t) return 0;
  return Math.max(0, (Date.now() - t) / 3600000);
}

function nextDayAt(hour = 10, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function todayAt(hour = 18, minute = 0) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  if (date.getTime() <= Date.now()) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

function getSmartReminderPreset(row) {
  const approval = lower(row.approval_status);
  const details = lower(row.all_details_sent);
  const status = statusText(row);

  if (approval === 'pending') {
    return {
      key: 'approval_pending',
      label: 'Approval pending',
      help: 'Approval is still pending. Recheck shortly and close the decision without delay.',
      hours: '0',
      minutes: '5',
      exact_time: '',
      note: 'Approval pending. Recheck in 5 minutes and close the decision fast.',
      suggestions: [
        'Approval pending. Recheck in 5 minutes.',
        'TL/Manager decision awaited.',
        'Open approval and close this now.',
      ],
    };
  }

  if (details === 'pending' && approval === 'approved') {
    return {
      key: 'details_sent_pending',
      label: 'All details sent pending',
      help: 'Approval completed. Keep the next closure step updated.',
      hours: '0',
      minutes: '30',
      exact_time: '',
      note: 'Approved profile. Send all details and close follow-up in this push.',
      suggestions: [
        'Approved profile. Send details now.',
        'Call and confirm all details sent.',
        'WhatsApp details shared. Verify receipt.',
      ],
    };
  }

  if (status.includes('not responding') || status.includes('no response')) {
    return {
      key: 'no_response',
      label: 'No response follow-up',
      help: 'No response cases are best moved to a controlled next-day follow-up.',
      hours: '0',
      minutes: '0',
      exact_time: toDateTimeLocal(nextDayAt(10, 0)),
      note: 'No response. Push again tomorrow morning with a clean follow-up.',
      suggestions: [
        'No response. Retry tomorrow morning.',
        'WhatsApp sent. Awaiting reply till tomorrow.',
        'Call back next day 10 AM.',
      ],
    };
  }

  if (status.includes('interview')) {
    return {
      key: 'interview_pending',
      label: 'Interview pending',
      help: 'A same-day evening checkpoint is configured for the interview stage.',
      hours: '0',
      minutes: '0',
      exact_time: toDateTimeLocal(todayAt(18, 0)),
      note: 'Interview stage active. Recheck before day-end and confirm movement.',
      suggestions: [
        'Interview check pending. Close before evening.',
        'Confirm interview timing and attendance.',
        'Candidate informed. Awaiting final confirmation.',
      ],
    };
  }

  return {
    key: 'follow_up_needed',
    label: 'Follow-up needed',
    help: 'A 3-hour smart preset is configured for general follow-up cases.',
    hours: '3',
    minutes: '0',
    exact_time: '',
    note: 'Follow-up required. Revisit this profile in the next work block.',
    suggestions: [
      'General follow-up due in 3 hours.',
      'Need recruiter callback later today.',
      'Hold and revisit after current queue.',
    ],
  };
}

function smartReminderShouldStayActive(row) {
  return isPendingSubmissionRow(row);
}

function smartReminderBaseStamp(row) {
  const approval = lower(row.approval_status);
  if (approval === 'pending') return row.approval_requested_at || row.submitted_at || row.updated_at || '';
  if (approval === 'approved') return row.approved_at || row.updated_at || row.submitted_at || '';
  return row.next_follow_up_at || row.updated_at || row.submitted_at || '';
}

function buildSmartReminderIso(row) {
  if (!smartReminderShouldStayActive(row)) return '';
  const preset = getSmartReminderPreset(row);
  if (preset.exact_time) {
    const exact = parseDateInput(preset.exact_time);
    return Number.isNaN(exact.getTime()) ? '' : exact.toISOString();
  }
  const baseStamp = new Date(smartReminderBaseStamp(row) || 0).getTime();
  if (!baseStamp) return '';
  const due = new Date(baseStamp);
  due.setHours(due.getHours() + Number(preset.hours || 0));
  due.setMinutes(due.getMinutes() + Number(preset.minutes || 0));
  return due.toISOString();
}

function effectiveFollowUpAt(row) {
  return String(row?.next_follow_up_at || '').trim() || buildSmartReminderIso(row) || '';
}

function queueBucketForRow(row) {
  const approval = lower(row.approval_status);
  const details = lower(row.all_details_sent);
  const reminder = reminderState(row);
  const status = statusText(row);
  const ageHours = hoursSince(submissionStamp(row));

  if (approval === 'pending') return 'approval';
  if (details === 'pending' && reminder === 'Due') return 'urgent';
  if (details === 'pending' && approval === 'approved' && (status.includes('interested') || status.includes('in progress') || status.includes('follow') || status.includes('respond'))) return 'hot';
  if (details === 'pending' && ageHours >= 6) return 'old';
  if (details === 'pending') return 'followup';
  return 'other';
}

function queueLabel(bucket) {
  switch (bucket) {
    case 'urgent': return 'Urgent Follow-up';
    case 'approval': return 'Pending Submission Approval';
    case 'hot': return 'Hot Candidate';
    case 'old': return 'Old Pending Detail';
    case 'followup': return 'Follow-up Needed';
    default: return 'Other';
  }
}

function queuePriority(row) {
  const bucket = queueBucketForRow(row);
  const ageHours = hoursSince(submissionStamp(row));
  if (bucket === 'urgent') return 5000 + ageHours;
  if (bucket === 'approval') return 4000 + ageHours;
  if (bucket === 'hot') return 3000 + ageHours;
  if (bucket === 'old') return 2000 + ageHours;
  if (bucket === 'followup') return 1000 + ageHours;
  return ageHours;
}

function queueHint(row) {
  const bucket = queueBucketForRow(row);
  if (bucket === 'urgent') return timeLeftText(row) || 'Reminder due right now';
  if (bucket === 'approval') return 'Approval decision pending';
  if (bucket === 'hot') return 'Approved profile. Complete the details follow-up.';
  if (bucket === 'old') return `${Math.round(hoursSince(submissionStamp(row)))}h old pending`; 
  if (bucket === 'followup') return 'Follow-up reminder recommended';
  return 'Standard queue item';
}


function approvalStateText(row) {
  return String(row?.approval_status || '').trim().toLowerCase();
}

function canApproveSubmissionRow(row) {
  return row?.can_review !== false && approvalStateText(row) !== 'approved';
}

function canRejectSubmissionRow(row) {
  return row?.can_review !== false && approvalStateText(row) !== 'rejected';
}

export default function SubmissionsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const storedViewState = readViewState(SUBMISSIONS_VIEW_STATE_KEY, {});
  const { user } = useAuth();
  const filterCatalog=useCandidateFilterCatalog(user);
  const staffFilterOptions=(filterCatalog.users||[]).map(u=>({value:u.recruiter_code||u.user_id,label:u.full_name||u.username||u.recruiter_code}));

  const leadership = ['admin', 'manager', 'tl'].includes(user?.role);
  const submissionsCachePrefix = `careerCroxSubmissionsCache:${user?.user_id || user?.username || 'anon'}:${user?.role || ''}:${user?.recruiter_code || ''}`;
  const initialViewMode = resolveSubmissionViewMode(storedViewState.viewMode || 'all'); // CC850: always begin with the default All Details Sent Pending card
  const [allRows, setAllRows] = useState(() => visibleCrmRows(readPageCache(`${submissionsCachePrefix}:${initialViewMode}`, [])).filter(isRealSubmissionRecord).filter((row) => rowMatchesSubmissionView(row, initialViewMode)));
  const [summaryRows, setSummaryRows] = useState(() => visibleCrmRows(readPageCache(`${submissionsCachePrefix}:summary:all`, [])).filter(isRealSubmissionRecord));
  const [rows, setRows] = useState(() => visibleCrmRows(readPageCache(`${submissionsCachePrefix}:rows:${initialViewMode}`, [])).filter(isRealSubmissionRecord).filter((row) => rowMatchesSubmissionView(row, initialViewMode)));
  const [viewMode, setViewMode] = useSliceState("viewMode:submissions",() => initialViewMode);
  const [activeCard, setActiveCard] = useSliceState("activeCard:submissions",'details_pending');
  const [filters, setFilters] = useSliceState("filters:submissions",() => ({ recruiter_code: '', all_details_sent: '', approval_status: '', today_approved: '', reminder: '', comms: '', preferred_location: '', submitted_from: '', submitted_to: '' })); // Do not carry over stale filters: page opens on Details Pending
  useSliceSearch(filters.q||'',value=>setFilters(current=>({...current,q:value})));
  const [sortBy,setSortBy]=useSliceState('submissions:sort','latest_submission');
  const [rejectingId, setRejectingId] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [savingId, setSavingId] = useState('');
  const [message, setMessage] = useState('');
  const [syncState, setSyncState] = useState('idle');
  const [reminderModal, setReminderModal] = useState(null);
  const [reminderMeta, setReminderMeta] = useState(getSmartReminderPreset({}));
  const [reminderForm, setReminderForm] = useState({ hours: '0', minutes: '3', exact_time: '', note: '' });
  const [popupRow, setPopupRow] = useState(null);
  const [popupReminderForm, setPopupReminderForm] = useState({ exact_time: '' });
  const [queueTab, setQueueTab] = useSliceState("queueTab:submissions",() => String(storedViewState.queueTab || 'all'));
  const [selectedSubmissionIds, setSelectedSubmissionIds] = useState([]);
  const selectionAnchorRef = useRef(null);
  const [checkingSubmissions, setCheckingSubmissions] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [submissionCheckToast, setSubmissionCheckToast] = useState(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(SUBMISSIONS_CACHE_PURGE_KEY) !== SUBMISSIONS_CACHE_PURGE_VERSION) {
        clearLegacySubmissionCaches(submissionsCachePrefix);
        setAllRows([]);
        setRows([]);
      }
    } catch {}
  }, [submissionsCachePrefix]);

  const loadSeqRef = useRef(0);
  const knownSubmissions = useRef(new Map());
  knownSubmissions.current = new Map([...summaryRows, ...allRows].map(row => [String(row.candidate_id), row]));


  async function refreshSubmissionSummaryCounts() {
    const query = new URLSearchParams();
    query.set('view', 'all');
    query.set('_refresh', '1');
    const data = await api.get(`/api/submissions?${query.toString()}`, { cacheTtlMs: 0, timeoutMs: 20000, retries: 0, allowStale: false, background: false });
    const items = visibleCrmRows(safeRows(data?.items)).filter(isRealSubmissionRecord);
    const merged = mergeSubmissionRowsForView(items, [...knownSubmissions.current.values()], 'all');
    setSummaryRows(current => mergeSubmissionRowsForView(items, current, 'all'));
    writePageCache(`${submissionsCachePrefix}:summary:all`, merged);
    // CC26_680: some older live backends can return the full ledger correctly while a
    // view-specific endpoint (especially all_pending) is empty. Derive that view from the
    // already-fetched full ledger instead of showing 0 rows or making another request.
    if (viewMode !== 'all') {
      setAllRows((current) => {
        const next = mergeSubmissionRowsForView(merged, current, viewMode);
        writePageCache(`${submissionsCachePrefix}:${viewMode}`, next);
        return next;
      });
    }
    return merged;
  }

  async function load(options = {}) {
    const force = Boolean(options.force);
    const requestedViewMode = resolveSubmissionViewMode(options.viewMode || viewMode);
    const loadSeq = ++loadSeqRef.current;
    const query = new URLSearchParams();
    query.set('view', 'all');
    if (requestedViewMode === 'today') {
      const bounds = crmDayBoundsUtcIso();
      if (bounds.start) query.set('today_from', bounds.start);
      if (bounds.end) query.set('today_to', bounds.end);
    }
    if (force) query.set('_refresh', '1');
    const data = await api.get(`/api/submissions${query.toString() ? `?${query.toString()}` : ''}`, { cacheTtlMs: force ? 0 : 60000, timeoutMs: 15000, retries: 0, allowStale: !force, background: false });
    if (loadSeq !== loadSeqRef.current) return;
    const items = visibleCrmRows(safeRows(data?.items)).filter(isRealSubmissionRecord);
    setAllRows(() => {
      const next = mergeSubmissionRowsForView(items, readPageCache(`${submissionsCachePrefix}:${requestedViewMode}`, []), requestedViewMode);
      writePageCache(`${submissionsCachePrefix}:${requestedViewMode}`, next);
      return next;
    });
    { // One authoritative ledger response also supplies summary counts.
      setSummaryRows(current => {
        const mergedSummary = true
          ? mergeSubmissionRowsForView(items, current, 'all')
          : applySubmissionUpdates(current, items, 'all');
        writePageCache(`${submissionsCachePrefix}:summary:all`, mergedSummary);
        return mergedSummary;
      });
    }
  }

  useEffect(() => {
    const cached = visibleCrmRows(readPageCache(`${submissionsCachePrefix}:${viewMode}`, [])).filter(isRealSubmissionRecord).filter((row) => rowMatchesSubmissionView(row, viewMode));
    setAllRows(cached);
    load({ force: false, viewMode }).catch(() => {});
  }, [viewMode, submissionsCachePrefix]);

  useEffect(() => onCandidateRealtime(({ item, meta }) => {
    const known = knownSubmissions.current.get(String(item?.candidate_id));
    if (isHiddenCrmProfileRow(item)) {
      setAllRows(current => applySubmissionUpdates(current, [item], viewMode));
      setSummaryRows(current => applySubmissionUpdates(current, [item], 'all'));
      return;
    }
    const approvalPending = lower(item?.approval_status) === 'pending';
    if (!known && !meta?.submitted && !approvalPending) return;
    invalidateGetResource('/api/submissions'); // Local cache invalidation, no network read.
    const merged = { ...(known || {}), ...item, ...(meta?.submission || {}) };
    const instantRow = buildInstantSubmissionRow(merged, {
      ...merged,
      submission_id: meta?.submission?.submission_id || known?.submission_id,
      submitted_at: meta?.submission?.submitted_at || known?.submitted_at,
      approval_requested_at: meta?.submission?.approval_requested_at || known?.approval_requested_at,
    });
    const justCompleted = known && lower(known.all_details_sent) !== 'completed' && lower(instantRow.all_details_sent) === 'completed';
    const nextView = viewMode;
    // CC850: completion changes the matching card, not the recruiter's selected view.
    // Do not unexpectedly navigate away or clear recruiter/date filters.
    setAllRows(current => {
      const base = justCompleted ? [...knownSubmissions.current.values(), ...current] : current;
      const next = applySubmissionUpdates(base, [instantRow], nextView);
      writePageCache(`${submissionsCachePrefix}:${nextView}`, next);
      return next;
    });
    setSummaryRows(current => {
      const next = applySubmissionUpdates(current, [instantRow], 'all');
      writePageCache(`${submissionsCachePrefix}:summary:all`, next);
      return next;
    });
    setMessage('');
  }), [submissionsCachePrefix, viewMode]);
  useSmartDeltaSync({
    onInvalidate:()=>load({force:true}).catch(()=>{}),
    scope: 'submissions',
    idKey: 'submission_id',
    rows: allRows,
    query: `view=${encodeURIComponent(viewMode)}`,
    keySuffix: viewMode,
    onRows: (changedRows) => {
      setAllRows((current) => {
        const next = applySubmissionUpdates(current, changedRows, viewMode);
        writePageCache(`${submissionsCachePrefix}:${viewMode}`, next);
        return next;
      });
      setSummaryRows((current) => {
        const next = applySubmissionUpdates(current, changedRows, 'all');
        writePageCache(`${submissionsCachePrefix}:summary:all`, next);
        return next;
      });
    },
  });

  useEffect(() => {
    writeViewState(SUBMISSIONS_VIEW_STATE_KEY, { viewMode, filters, queueTab,activeCard,sortBy });
  }, [viewMode, filters, queueTab]);

  function openCandidateProfile(row) {
    if (!row?.candidate_id) return;
    const navRows = rows.length ? rows : (allRows.length ? allRows : []);
    openCandidateProfileInNewTab(row, navRows, { sourcePath: `${window.location.pathname}${window.location.search || ''}`, sourceKind: 'submissions', totalRows: navRows.length, hasMore: false });
  }

  useEffect(() => {
    if (leadership) return;
    setFilters((current) => ({ ...current, recruiter_code: user?.recruiter_code || current.recruiter_code || '' }));
  }, [leadership, user?.recruiter_code]);

  const recruiterOptions = staffFilterOptions.map(o=>o.value);
  const preferredLocationOptions = useMemo(() => uniqueOptions([...(filterCatalog.rows||[]),...allRows], (row) => row.preferred_location, true), [allRows,filterCatalog.rows]);
  const communicationOptions = useMemo(() => uniqueOptions([...(filterCatalog.rows||[]),...allRows], (row) => row.submission_comms || row.communication_skill), [allRows,filterCatalog.rows]);

  function clearSubmissionFilters() {
    setFilters((current) => ({ ...current, all_details_sent: '', approval_status: '', today_approved: '', reminder: '' }));
  }

  function openSubmissionCard(card) {
    if (!SUBMISSION_CARD_IDS.includes(card)) return;
    setViewMode('all');
    setActiveCard(card);
    // Leave recruiter/location/date filters alone, but reset conflicting status selectors.
    setFilters((current) => ({ ...current, all_details_sent: '', approval_status: '', today_approved: '', reminder: '' }));
    setSelectedSubmissionIds([]);
  }

  function switchSubmissionView(nextViewMode) {
    setViewMode(nextViewMode);
    setActiveCard(nextViewMode === 'all_pending' ? 'details_pending' : 'all');
    clearSubmissionFilters();
    setSelectedSubmissionIds([]);
  }

  useEffect(() => {
    const nextRows = visibleCrmRows(allRows).filter((row) => rowMatchesSubmissionView(row, viewMode))
      .filter((row) => matchesSubmissionCard(row, activeCard)).filter((row) => {
        if(filters.q&&!['full_name','phone','candidate_id'].some(key=>String(row[key]||'').toLowerCase().includes(filters.q.toLowerCase())))return false;
      if (filters.recruiter_code && !splitValues(row.recruiter_code).some((item) => lower(item)===lower(filters.recruiter_code))) return false;
      if (filters.all_details_sent && !matchesText(row.all_details_sent, filters.all_details_sent)) return false;
      if (filters.approval_status && !matchesText(row.approval_status, filters.approval_status)) return false;
      if (filters.today_approved === '1' && !isTodayApprovedSubmissionRow(row)) return false;
      if (filters.reminder) {
        const currentState = reminderState(row).toLowerCase();
        if (filters.reminder === 'none' && currentState !== 'no reminder') return false;
        if (filters.reminder !== 'none' && currentState !== filters.reminder) return false;
      }
      if (filters.comms && !matchesText(row.submission_comms || row.communication_skill, filters.comms)) return false;
      if (filters.preferred_location && !splitValues(row.location || row.preferred_location).some((item) => matchesText(item, filters.preferred_location))) return false;
      if (filters.submitted_from) {
        const start = parseDateInput(String(filters.submitted_from).slice(0,10)+'T00:00:00+05:30').getTime();
        const current = new Date(submissionStamp(row) || 0).getTime();
        if (start && current && current < start) return false;
      }
      if (filters.submitted_to) {
        const end = parseDateInput(String(filters.submitted_to).slice(0,10)+'T23:59:59.999+05:30').getTime();
        const current = new Date(submissionStamp(row) || 0).getTime();
        if (end && current && current > end) return false;
      }
      return true;
    });
    setRows(sortCrmRows(nextRows,sortBy));
    writePageCache(`${submissionsCachePrefix}:rows:${viewMode}`, nextRows.slice(0, 1200));
  }, [allRows, filters, viewMode, activeCard,sortBy]);

  const visibleSubmissionIds = useMemo(() => rows.map((row) => String(row.submission_id || '')).filter(Boolean), [rows]);
  const allSubmissionsSelected = visibleSubmissionIds.length > 0 && visibleSubmissionIds.every((id) => selectedSubmissionIds.includes(id));
  const selectedSubmissionRows = useMemo(() => rows.filter((row) => !isInactiveProfile(row) && selectedSubmissionIds.includes(String(row.submission_id || '')) && String(row.candidate_id || '').trim()), [rows, selectedSubmissionIds]);

  useEffect(() => {
    setSelectedSubmissionIds((prev) => prev.filter((id) => visibleSubmissionIds.includes(id)));
  }, [visibleSubmissionIds]);

  function toggleSubmissionSelection(submissionId, event) {
    const id = String(submissionId || '');
    if (!id) return;
    const shiftKey = Boolean(event?.shiftKey || event?.nativeEvent?.shiftKey);
    const anchorId = selectionAnchorRef.current;
    setSelectedSubmissionIds(current => updateRowSelection(current, visibleSubmissionIds, id, { shiftKey, anchorId }));
    if (!shiftKey || !visibleSubmissionIds.includes(anchorId)) selectionAnchorRef.current = id;
  }

  function toggleAllSubmissionSelection() {
    selectionAnchorRef.current = null;
    setSelectedSubmissionIds((prev) => allSubmissionsSelected ? prev.filter((id) => !visibleSubmissionIds.includes(id)) : Array.from(new Set([...prev, ...visibleSubmissionIds])));
  }

  function loadSelectedToAutoDialer() {
    if (selectedSubmissionRows.length < 2) return;
    const orderedItems = selectedSubmissionRows.map((row, index) => ({ ...row, queue_order: index + 1, dialer_sequence: index + 1, __dialer_order: index + 1 }));
    const startId = String(orderedItems[0]?.candidate_id || '');
    const payload = { source: 'Submissions', items: orderedItems, start_candidate_id: startId, created_at: new Date().toISOString() };
    try { sessionStorage.setItem('careerCroxAutoDialerQueue:v1', JSON.stringify(payload)); localStorage.setItem('careerCroxAutoDialerQueue:v1', JSON.stringify(payload)); } catch {}
    window.open('/auto-dialer', '_blank');
  }

  function openSelectedInManualDialer() {
    if (selectedSubmissionRows.length < 2) return;
    const orderedItems = selectedSubmissionRows.map((row, index) => ({ ...row, queue_order: index + 1, dialer_sequence: index + 1, __dialer_order: index + 1 }));
    const startId = String(orderedItems[0]?.candidate_id || '');
    const payload = { source: 'Submissions', items: orderedItems, start_candidate_id: startId, created_at: new Date().toISOString() };
    try { sessionStorage.setItem('careerCroxAutoDialerQueue:v1', JSON.stringify(payload)); localStorage.setItem('careerCroxAutoDialerQueue:v1', JSON.stringify(payload)); } catch {}
    window.open('/auto-dialer?manual=1', '_blank');
  }

  useEffect(() => {
    if (syncState !== 'saved') return undefined;
    const timer = window.setTimeout(() => setSyncState('idle'), 1200);
    return () => window.clearTimeout(timer);
  }, [syncState]);

  const queueSummary = useMemo(() => {
    const pendingRows = rows.filter((row) => isPendingSubmissionRow(row));
    const buckets = {
      urgent: pendingRows.filter((row) => queueBucketForRow(row) === 'urgent'),
      approval: pendingRows.filter((row) => queueBucketForRow(row) === 'approval'),
      hot: pendingRows.filter((row) => queueBucketForRow(row) === 'hot'),
      old: pendingRows.filter((row) => queueBucketForRow(row) === 'old'),
      followup: pendingRows.filter((row) => queueBucketForRow(row) === 'followup'),
    };

    const mergedMap = new Map();
    Object.entries(buckets).forEach(([bucket, items]) => {
      items.forEach((row) => {
        if (!mergedMap.has(row.submission_id)) {
          mergedMap.set(row.submission_id, { ...row, queue_bucket: bucket });
        }
      });
    });

    const sorted = Array.from(mergedMap.values()).sort((a, b) => queuePriority(b) - queuePriority(a)).slice(0, 10);
    return { buckets, sorted };
  }, [rows]);

  const queueRows = useMemo(() => {
    if (queueTab === 'all') return queueSummary.sorted;
    return queueSummary.sorted.filter((row) => row.queue_bucket === queueTab);
  }, [queueSummary, queueTab]);

  useEffect(() => {
    const targetId = new URLSearchParams(location.search).get('submission_id');
    if (!targetId || !rows.length) return;
    const timer = window.setTimeout(() => {
      const node = document.getElementById(`submission-row-${targetId}`);
      if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [location.search, rows]);

  useEffect(() => {
    const due = rows
      .filter((row) => isPendingSubmissionRow(row))
      .filter((row) => isPendingSubmissionRow(row))
      .filter((row) => reminderState(row) === 'Due')
      .sort((a, b) => String(a.next_follow_up_at || '').localeCompare(String(b.next_follow_up_at || '')))[0] || null;
    setPopupRow((current) => {
      if (!due) return null;
      return current?.submission_id === due.submission_id ? { ...current, ...due } : due;
    });
  }, [rows]);

  useEffect(() => {
    if (!popupRow) {
      setPopupReminderForm({ exact_time: '' });
      return;
    }
    const smart = getSmartReminderPreset(popupRow);
    setPopupReminderForm({ exact_time: smart.exact_time || '' });
  }, [popupRow]);

  async function approve(row) {
    const beforeRows = [...rows];
    setSavingId(row.candidate_id);
    setRows((current) => current.map((item) => item.candidate_id === row.candidate_id ? { ...item, approval_status: 'Approved', approved_at: new Date().toISOString() } : item));
    setRejectingId('');
    setRejectReason('');
    setMessage('Confirming approval with server...');
    setSyncState('saving');
    try {
      await api.post('/api/approvals/approve', { type: 'candidate', id: row.candidate_id });
      setMessage(`${safeCellText(row.full_name || row.candidate_id, '-')} approved.`);
      setSyncState('saved');
      await load({ force: true });
    } catch (err) {
      setRows(beforeRows);
      setMessage(err.message || 'Approval failed and the previous view was restored.');
      setSyncState('error');
    } finally { setSavingId(''); }
  }

  async function reject(row) {
    if (!rejectReason.trim()) return;
    const beforeRows = [...rows];
    const reasonText = rejectReason.trim();
    setSavingId(row.candidate_id);
    setRows((current) => current.map((item) => item.candidate_id === row.candidate_id ? { ...item, approval_status: 'Rejected', status: 'Rejected', rejected_at: new Date().toISOString(), rejection_reason: reasonText } : item));
    setRejectingId('');
    setRejectReason('');
    setMessage('Confirming rejection with server...');
    setSyncState('saving');
    try {
      await api.post('/api/approvals/reject', { type: 'candidate', id: row.candidate_id, reason: reasonText });
      setMessage(`${safeCellText(row.full_name || row.candidate_id, '-')} rejected.`);
      setSyncState('saved');
      await load({ force: true });
    } catch (err) {
      setRows(beforeRows);
      setMessage(err.message || 'Reject failed and the previous view was restored.');
      setSyncState('error');
    } finally { setSavingId(''); }
  }

  function openReminderModal(row) {
    const smart = getSmartReminderPreset(row);
    setReminderMeta(smart);
    setReminderModal(row);
    setReminderForm({
      hours: smart.hours,
      minutes: smart.minutes,
      exact_time: effectiveFollowUpAt(row) ? toDateTimeLocal(effectiveFollowUpAt(row)) : smart.exact_time,
      note: row.reminder_note || smart.note,
    });
  }

  async function saveReminder() {
    if (!reminderModal) return;
    let nextFollowUpAt = '';
    if (reminderForm.exact_time) {
      nextFollowUpAt = parseDateInput(reminderForm.exact_time).toISOString();
    } else {
      const hours = Number(reminderForm.hours || 0);
      const minutes = Number(reminderForm.minutes || 0);
      nextFollowUpAt = addDuration(hours, minutes || (hours ? 0 : 3));
    }
    await api.post(`/api/submissions/${reminderModal.submission_id}/reminder`, {
      next_follow_up_at: nextFollowUpAt,
      reminder_snoozed_until: '',
      reminder_note: reminderForm.note,
    });
    setMessage(`Reminder saved for ${reminderModal.full_name || reminderModal.candidate_id}.`);
    setReminderModal(null);
    await load();
  }

  async function applySmartReminder(row) {
    const smart = getSmartReminderPreset(row);
    const nextFollowUpAt = smart.exact_time
      ? parseDateInput(smart.exact_time).toISOString()
      : addDuration(smart.hours, smart.minutes || (smart.hours ? 0 : 3));
    await api.post(`/api/submissions/${safeCellText(row.submission_id, '-')}/reminder`, {
      next_follow_up_at: nextFollowUpAt,
      reminder_snoozed_until: '',
      reminder_note: smart.note,
    });
    setMessage(`Smart reminder applied for ${safeCellText(row.full_name || row.candidate_id, '-')}.`);
    await load();
  }

  function applyLocalReminderPatch(submissionId, patch) {
    const id = String(submissionId || '');
    if (!id) return;
    const applyPatch = (item) => String(item?.submission_id || '') === id ? { ...item, ...patch } : item;
    setAllRows((current) => (Array.isArray(current) ? current.map(applyPatch) : current));
    setRows((current) => (Array.isArray(current) ? current.map(applyPatch) : current));
  }

  function minutesLabel(minutes) {
    const value = Number(minutes || 0);
    if (value >= 60 && value % 60 === 0) return `${value / 60}H`;
    return `${value}m`;
  }

  function snoozePopup(minutes) {
    if (!popupRow) return;
    const row = popupRow;
    const safeMinutes = Number(minutes || 5);
    const until = new Date(Date.now() + safeMinutes * 60000).toISOString();
    setPopupRow(null);
    setMessage(`Submission reminder snoozed for ${minutesLabel(safeMinutes)}.`);
    applyLocalReminderPatch(row.submission_id, { reminder_snoozed_until: until });
    api.post(`/api/submissions/${safeCellText(row.submission_id, '-')}/reminder`, {
      next_follow_up_at: row.next_follow_up_at,
      reminder_snoozed_until: until,
      reminder_note: row.reminder_note || '',
    }, { timeoutMs: 12000, retries: 0 }).catch((err) => {
      setMessage(err?.message || 'Reminder snooze could not sync. Please retry once.');
    });
  }

  function savePopupExactTime() {
    if (!popupRow || !popupReminderForm.exact_time) return;
    const row = popupRow;
    const nextFollowUpAt = parseDateInput(popupReminderForm.exact_time).toISOString();
    setPopupRow(null);
    setMessage(`Submission reminder updated for ${safeCellText(row.full_name || row.candidate_id, '-')}.`);
    applyLocalReminderPatch(row.submission_id, { next_follow_up_at: nextFollowUpAt, reminder_snoozed_until: '' });
    api.post(`/api/submissions/${safeCellText(row.submission_id, '-')}/reminder`, {
      next_follow_up_at: nextFollowUpAt,
      reminder_snoozed_until: '',
      reminder_note: row.reminder_note || getSmartReminderPreset(row).note || '',
    }, { timeoutMs: 12000, retries: 0 }).catch((err) => {
      setMessage(err?.message || 'Reminder update could not sync. Please retry once.');
    });
  }

  function callCandidate(row) {
    dialCandidateWithLog(row.candidate_id, row.phone);
  }

  function openWhatsApp(row) {
    openWhatsAppWithLog(row.candidate_id, row.phone, '');
  }

  async function manualRefreshSubmissions() {
    setManualRefreshing(true);
    setSyncState('saving');
    try {
      await load({ force: true });
      setMessage('');
      setSyncState('saved');
    } catch (err) {
      setMessage(err?.message || 'Manual refresh failed.');
      setSyncState('error');
    } finally {
      setManualRefreshing(false);
    }
  }

  async function checkNewSubmissionsNow() {
    setCheckingSubmissions(true);
    setSubmissionCheckToast(null);
    try {
      const query = new URLSearchParams();
      query.set('view', viewMode);
      if (viewMode === 'today') {
        const bounds = crmDayBoundsUtcIso();
        if (bounds.start) query.set('today_from', bounds.start);
        if (bounds.end) query.set('today_to', bounds.end);
      }
      query.set('_refresh', '1');
      const lastCheck = Number(localStorage.getItem('careerCroxLastSubmissionCheckAt') || 0) || 0;
      const data = await api.get(`/api/submissions?${query.toString()}`, { cacheTtlMs: 0, timeoutMs: 18000, retries: 0 });
      const items = visibleCrmRows(safeRows(data?.items)).filter(isRealSubmissionRecord);
      const newCount = lastCheck ? items.filter((row) => {
        const stamp = new Date(submissionStamp(row) || row.updated_at || row.created_at || 0).getTime();
        return stamp && stamp > lastCheck;
      }).length : items.length;
      const nextItems = items;
      setAllRows(nextItems);
      setRows(nextItems.filter((row) => rowMatchesSubmissionView(row, viewMode)));
      writePageCache(`${submissionsCachePrefix}:${viewMode}`, nextItems);
      writePageCache(`${submissionsCachePrefix}:rows:${viewMode}`, nextItems.slice(0, 1200));
      refreshSubmissionSummaryCounts().catch(() => {});
      try { localStorage.setItem('careerCroxLastSubmissionCheckAt', String(Date.now())); } catch {}
      const label = newCount === 1 ? 'new submission' : 'new submissions';
      setSubmissionCheckToast(null);
      setMessage('');
      window.setTimeout(() => setSubmissionCheckToast(null), 4200);
    } catch (err) {
      setSubmissionCheckToast(null);
      setMessage(err?.message || 'New submission check failed.');
      window.setTimeout(() => setSubmissionCheckToast(null), 4200);
    } finally {
      setCheckingSubmissions(false);
    }
  }

  const submissionCardCounts = useMemo(() => Object.fromEntries(
    SUBMISSION_CARD_IDS.map((id) => [id, summaryRows.filter((row) => isRealSubmissionRecord(row) && matchesSubmissionCard(row, id)).length])
  ), [summaryRows]);
  const submissionCards = [
    { id: 'all', label: 'All Submissions', tone: 'tone-blue' },
    { id: 'approval_pending', label: 'Pending Submission Approval', tone: 'tone-purple' },
    { id: 'resume_pending', label: 'Only Resume Pending', tone: 'tone-orange' },
    { id: 'details_pending', label: 'All Details Sent Pending', tone: 'tone-peach' },
    { id: 'details_completed', label: 'All Details Sent Completed', tone: 'tone-green' },
    { id: 'today_approved', label: 'Today Approved', tone: 'tone-cyan' },
    { id: 'today_rejected', label: 'Today Rejected', tone: 'tone-rose' },
    { id: 'inactive', label: 'Not Interested / Rejected', tone: 'tone-rose' },
  ];

  return (
    <Layout title="Submissions" subtitle="Approval and profile status are separate · All Details Sent Pending opens by default">
      {submissionCheckToast ? (
        <div className="submission-check-toast">
          <strong>{submissionCheckToast.count}</strong>
          <span>{submissionCheckToast.text}</span>
        </div>
      ) : null}
      <div className="cc850-submission-cards top-gap-small" aria-label="Submission summary filters">
        {submissionCards.map((card) => (
          <button type="button" key={card.id}
            aria-pressed={activeCard === card.id && viewMode === 'all'}
            className={`metric-card colorful-card ${card.tone} cc850-submission-card ${activeCard === card.id && viewMode === 'all' ? 'metric-card-active' : ''}`}
            onClick={() => openSubmissionCard(card.id)}>
            <span>{card.label}</span>
            <strong>{submissionCardCounts[card.id] || 0}</strong>
          </button>
        ))}
      </div>

      <div className="table-panel top-gap-small glassy-card fade-up">
        <div className="table-toolbar no-wrap-toolbar">
          <div className="table-title">Submission View</div>
          <div data-cc929-tools="true" className="toolbar-actions compact-pills candidate-toolbar-actions">
            <button type="button" className={`choice-chip bounceable ${viewMode === 'all' ? 'active' : ''}`} onClick={() => switchSubmissionView('all')}>All Submissions</button>
            <button type="button" className={`choice-chip bounceable ${viewMode === 'today' ? 'active' : ''}`} onClick={() => switchSubmissionView('today')}>Today's Submission</button>
            <button type="button" className={`choice-chip bounceable ${activeCard === 'details_pending' && viewMode === 'all' ? 'active' : ''}`} onClick={() => openSubmissionCard('details_pending')}>All Details Sent Pending</button>
            <button type="button" className={`submission-check-new-btn ${checkingSubmissions ? 'is-checking' : ''}`} onClick={checkNewSubmissionsNow} disabled={checkingSubmissions}><span>{checkingSubmissions ? 'Checking...' : 'Check New Submissions'}</span></button>
            <span className="mini-chip">{rows.length} records</span>
            <span className="mini-chip live-chip">{rows.length} matching card</span>
            <span className={`mini-chip ${syncState === 'saving' ? 'live-chip' : syncState === 'saved' ? 'sync-chip saved' : syncState === 'error' ? 'sync-chip error' : ''}`}>{syncState === 'saving' ? 'Saved' : syncState === 'saved' ? 'Saved' : syncState === 'error' ? 'Save failed' : 'Live Save'}</span>
          </div>
        </div>

        <div className="interview-quick-filter-strip submission-quick-filter-strip">
          <label className="compact-select-shell shell-indigo">
            <span className="compact-shell-label">Recruiter</span>
            {leadership ? (
              <PremiumSelect className="inline-input compact-inline-input" value={filters.recruiter_code} onChange={(e) => setFilters((current) => ({ ...current, recruiter_code: e.target.value }))}>
                <option value="">All</option>
                {recruiterOptions.map((item) => <option key={item} value={item}>{staffFilterOptions.find(o=>o.value===item)?.label||item}</option>)}
              </PremiumSelect>
            ) : (
              <PremiumSelect className="inline-input compact-inline-input" value={filters.recruiter_code || user?.recruiter_code || ''} disabled>
                <option value={filters.recruiter_code || user?.recruiter_code || ''}>{filters.recruiter_code || user?.recruiter_code || 'My submissions'}</option>
              </PremiumSelect>
            )}
          </label>
          <label className="compact-select-shell shell-cyan">
            <span className="compact-shell-label">All Details Sent</span>
            <PremiumSelect className="inline-input compact-inline-input" value={filters.all_details_sent} onChange={(e) => { setActiveCard('all'); setFilters((current) => ({ ...current, all_details_sent: e.target.value })); }}>
              <option value="">All</option>
              <option value="Pending">Pending</option>
              <option value="Completed">Completed</option>
              <option value="Only Resume Pending">Only Resume Pending</option>
            </PremiumSelect>
          </label>
          <label className="compact-select-shell shell-green">
            <span className="compact-shell-label">Reminder</span>
            <PremiumSelect className="inline-input compact-inline-input" value={filters.reminder} onChange={(e) => setFilters((current) => ({ ...current, reminder: e.target.value }))}>
              <option value="">All</option>
              <option value="due">Due</option>
              <option value="scheduled">Scheduled</option>
              <option value="none">No Reminder</option>
            </PremiumSelect>
          </label>
          <label className="compact-select-shell shell-peach">
            <span className="compact-shell-label">Communication</span>
            <PremiumSelect className="inline-input compact-inline-input" value={filters.comms} onChange={(e) => setFilters((current) => ({ ...current, comms: e.target.value }))}>
              <option value="">All</option>
              {communicationOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </PremiumSelect>
          </label>
          <label className="compact-select-shell shell-gold">
            <span className="compact-shell-label">Preferred Location</span>
            <PremiumSelect className="inline-input compact-inline-input" value={filters.preferred_location} onChange={(e) => setFilters((current) => ({ ...current, preferred_location: e.target.value }))}>
              <option value="">All</option>
              {preferredLocationOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </PremiumSelect>
          </label>
          <label className="compact-select-shell shell-violet">
            <span className="compact-shell-label">Submission From</span>
            <input aria-label="Submission from date" className="inline-input compact-inline-input" type="date" value={(filters.submitted_from||'').slice(0,10)} onChange={(e) => setFilters((current) => ({ ...current, submitted_from: e.target.value }))} />
          </label>
          <div className="cc876-submission-sort-slot"><CrmSortSelect value={sortBy} onChange={setSortBy}/></div>
          <label className="compact-select-shell shell-blue">
            <span className="compact-shell-label">Submission To</span>
            <input aria-label="Submission to date" className="inline-input compact-inline-input" type="date" value={(filters.submitted_to||'').slice(0,10)} onChange={(e) => setFilters((current) => ({ ...current, submitted_to: e.target.value }))} />
          </label>
        </div>


        {!!message && <div className={`helper-text top-gap-small sync-message ${syncState === 'error' ? 'is-error' : syncState === 'saved' ? 'is-success' : ''}`}>{message}</div>}

        <div className="candidate-master-row top-gap-small" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className={`selection-master-pill bounceable ${allSubmissionsSelected ? 'active' : ''}`} onClick={toggleAllSubmissionSelection}>
            <span className="selection-master-icon">✓</span>
            {allSubmissionsSelected ? 'Clear All' : 'Select All'}
          </button>
          <span className="selection-count-chip">{selectedSubmissionIds.length} selected</span>
          {selectedSubmissionRows.length >= 2 ? <button type="button" className="add-profile-btn bounceable" onClick={loadSelectedToAutoDialer}>Auto Dialer</button> : null}
          {selectedSubmissionRows.length >= 2 ? <button type="button" className="ghost-btn bounceable" onClick={openSelectedInManualDialer}>Manual Dialer</button> : null}
        </div>

        <div className="crm-table-wrap dense-wrap top-gap-small submissions-table-wrap">
          <table className="crm-table colorful-table dense-table submissions-table slim-submissions-table compact-submissions-table readable-flow-table">
            <thead>
              <tr>
                <th style={{ width: 84 }}>Select</th>
                <th style={{ width: 88 }}>SR No.</th>
                <th>Candidate</th>
                <th>Recruiter</th>
                <th>Process</th>
                <th>Location</th>
                <th>Status</th>
                <th>Approval</th>
                <th>All Details Sent</th>
                <th>Next Follow-Up</th>
                <th>Submitted At</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <React.Fragment key={safeCellText(row.submission_id, '-')}>
                  <tr id={`submission-row-${safeCellText(row.submission_id, '-')}`} aria-selected={selectedSubmissionIds.includes(String(row.submission_id || ''))} className={`clickable-row ${selectedSubmissionIds.includes(String(row.submission_id || '')) ? 'selected-row' : ''} ${isNegativeProfileOutcome(row) ? 'cc-negative-profile-row' : ''}`} onClick={() => openCandidateProfile(row)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button type="button" className={`row-check-btn bounceable ${selectedSubmissionIds.includes(String(row.submission_id || '')) ? 'active' : ''}`} role="checkbox" aria-checked={selectedSubmissionIds.includes(String(row.submission_id || ''))} aria-label={`Select submission ${row.submission_id}`} onClick={event => toggleSubmissionSelection(row.submission_id, event)} title="Click to toggle; Shift-click another row to select or clear a range">
                        ✓
                      </button>
                    </td>
                    <td><strong>{index + 1}</strong></td>
                    <td><strong>{safeCellText(row.full_name || row.candidate_id, '-')}</strong><br /><span className="subtle">{safeCellText(row.candidate_id, '-')}</span></td>
                    <td>{safeCellText(row.recruiter_name || 'Team member', '-')}</td>
                    <td>{safeCellText(row.process, '-')}</td>
                    <td>{safeCellText(row.location || row.preferred_location, '-')}</td>
                    <td><span className="status-chip">{safeCellText(row.status, '-')}</span></td>
                    <td><span className={`status-chip secondary cc790-status-${String(row.approval_status||'pending').toLowerCase()}`}>{safeCellText(row.approval_status, '-')}</span></td>
                    <td>
                      <span className="status-chip secondary">{safeCellText(row.all_details_sent, 'Pending')}</span>
                      
                    </td>
                    <td>
                      <div>{effectiveFollowUpAt(row) ? formatDate(effectiveFollowUpAt(row)) : 'Not set'}</div>
                      {effectiveFollowUpAt(row) ? <div className="helper-text submission-mini-text">{timeLeftText(row)}</div> : null}
                    </td>
                    <td>{formatDate(submissionStamp(row))}</td>
                  </tr>
                </React.Fragment>
              ))}
              {rows.length === 0 ? (
                <tr><td colSpan="11" className="helper-text">No submissions found for the selected window.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {reminderModal ? (
        <div className="crm-modal-backdrop task-modal-fix" onClick={() => setReminderModal(null)}>
          <div className="crm-premium-modal task-premium-modal task-modal-no-overlap" onClick={(e) => e.stopPropagation()}>
            <div className="panel-title">Set Submission Reminder</div>
            <div className="helper-text top-gap-small">{reminderMeta.help}</div>
            <div className="compact-chip-row top-gap-small">
              {durationPresets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className={`choice-chip bounceable ${String(reminderForm.hours) === preset.hours && String(reminderForm.minutes) === preset.minutes && !reminderForm.exact_time ? 'active' : ''}`}
                  onClick={() => setReminderForm((current) => ({ ...current, hours: preset.hours, minutes: preset.minutes, exact_time: '' }))}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                className={`choice-chip bounceable ${reminderMeta.exact_time ? (reminderForm.exact_time === reminderMeta.exact_time ? 'active' : '') : (String(reminderForm.hours) === reminderMeta.hours && String(reminderForm.minutes) === reminderMeta.minutes && !reminderForm.exact_time ? 'active' : '')}`}
                onClick={() => setReminderForm((current) => ({ ...current, hours: reminderMeta.hours, minutes: reminderMeta.minutes, exact_time: reminderMeta.exact_time }))}
              >
                Smart {reminderMeta.exact_time ? 'time' : `${reminderMeta.hours || 0}h ${reminderMeta.minutes || 0}m`}
              </button>
            </div>
            <div className="task-modal-grid top-gap-small compact-reminder-modal-grid">
              <div className="field"><label>Hours</label><input className="inline-input" type="number" min="0" value={reminderForm.hours} onChange={(e) => setReminderForm((current) => ({ ...current, hours: e.target.value, exact_time: '' }))} /></div>
              <div className="field"><label>Minutes</label><input className="inline-input" type="number" min="0" value={reminderForm.minutes} onChange={(e) => setReminderForm((current) => ({ ...current, minutes: e.target.value, exact_time: '' }))} /></div>
              <div className="field field-span-2"><label>Or Exact Time</label><CrmDateTimeInput className="inline-input" type="datetime-local" value={reminderForm.exact_time} onChange={(e) => setReminderForm((current) => ({ ...current, exact_time: e.target.value }))} /></div>
              <div className="field field-span-2">
                <label>Stage Suggestions</label>
                <div className="compact-chip-row compact-chip-wrap">
                  {[...new Set([...reminderMeta.suggestions, ...baseNoteSuggestions])].map((note) => (
                    <button key={note} type="button" className="choice-chip bounceable" onClick={() => setReminderForm((current) => ({ ...current, note }))}>{note}</button>
                  ))}
                </div>
              </div>
              <div className="field field-span-2"><label>Reminder Note</label><textarea rows="4" value={reminderForm.note} onChange={(e) => setReminderForm((current) => ({ ...current, note: e.target.value }))} placeholder="Call done? WhatsApp sent? Next push?" /></div>
            </div>
            <div className="row-actions top-gap">
              <button className="add-profile-btn bounceable" type="button" onClick={saveReminder}>Save Reminder</button>
              <button className="ghost-btn bounceable" type="button" onClick={() => setReminderModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}

      {null}
    </Layout>
  );
}
