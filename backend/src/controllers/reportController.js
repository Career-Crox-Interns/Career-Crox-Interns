const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { GENERATED_DIR } = require('../config/env');
const { store, table } = require('../lib/store');
const { nextId, nowIso } = require('../lib/helpers');
const { callMetricForRow, presenceMinutes, dedupeCallRows } = require('../lib/crmMetrics');
const { getCallChangeSnapshot } = require('../lib/callChange');
const { candidateScopeSql, simpleOwnerSql, isAdminOrManager, candidateBelongsToUser, candidateBelongsToTeam } = require('../lib/accessRules');
const { parseReminderTime } = require('../lib/reminderWindow');

const BASIC_CRM_MODE = String(process.env.BASIC_CRM_MODE || '').trim().toLowerCase() === 'true';

const CATEGORY_CONFIG = [
  { key: 'submissions', label: 'Submissions', table_name: 'submissions' },
  { key: 'interviews', label: 'Interviews', table_name: 'interviews' },
  { key: 'calls', label: 'Calls', table_name: 'call_logs' },
  { key: 'selections', label: 'Selections', table_name: 'revenue_hub_entries' },
  { key: 'joining', label: 'Joining', table_name: 'revenue_hub_entries' },
  { key: 'allocated_profiles', label: 'Allocated Profiles', table_name: 'candidates' },
  { key: 'due_profiles', label: 'Due Profiles', table_name: 'candidates' },
  { key: 'not_interested', label: 'Not Interested', table_name: 'candidates' },
  { key: 'not_responding', label: 'Not Responding', table_name: 'candidates' },
  { key: 'attendance_summary', label: 'Attendance Summary', table_name: 'presence' },
  { key: 'login_timing', label: 'Login Timing', table_name: 'presence' },
  { key: 'breaks', label: 'Breaks', table_name: 'presence' },
  { key: 'logout_activity', label: 'Logout Activity', table_name: 'activity_log' },
];

const DEFAULT_CATEGORY_KEYS = CATEGORY_CONFIG.map((item) => item.key);
const CATEGORY_KEY_SET = new Set(DEFAULT_CATEGORY_KEYS);

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function reportCandidateIsDeleted(row = {}) {
  const status = normalizeText(row.status || row.candidate_status || '');
  const approval = normalizeText(row.approval_status || '');
  const details = normalizeText(row.all_details_sent || '');
  const notes = normalizeText(row.data_notes || '');
  return Boolean(String(row.deleted_at || '').trim())
    || status === 'deleted'
    || status === '__deleted__'
    || status === 'archived'
    || approval === 'deleted'
    || approval === '__deleted__'
    || approval === 'archived'
    || details === 'deleted'
    || details === 'archived'
    || notes.includes('[crm-deleted]');
}

function activeReportCandidates(rows = []) {
  return (rows || []).filter((row) => !reportCandidateIsDeleted(row));
}

function rowLinkedToActiveCandidate(row = {}, activeCandidateIds = new Set()) {
  const candidateId = String(row.candidate_id || '').trim();
  return !candidateId || activeCandidateIds.has(candidateId);
}

function isManager(user) {
  return normalizeText(user?.role) === 'manager';
}

function isTruthy(value) {
  const text = normalizeText(value);
  return ['1', 'true', 'yes', 'y'].includes(text);
}

function parseJsonSafe(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function pickFirst(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function toTimestamp(value) {
  if (!value) return 0;
  const date = new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}

function toIsoDisplay(value) {
  if (!value) return '';
  const time = toTimestamp(value);
  if (!time) return String(value || '');
  return new Date(time).toISOString();
}

function computePresenceMinutes(row) {
  const live = presenceMinutes(row);
  return {
    session_minutes: String(live.session_minutes),
    total_work_minutes: String(live.productive_work_minutes),
    total_break_minutes: String(live.total_break_minutes),
    productive_work_minutes: String(live.productive_work_minutes),
    active_work_minutes: String(live.active_work_minutes),
    idle_minutes: String(live.idle_minutes),
  };
}

function normalizePhone(value) {
  return String(value || '').replace(/\D+/g, '');
}

function submissionStamp(row, candidate = null) {
  return String(
    row?.submission_origin_at
    || row?.submitted_at
    || row?.approval_requested_at
    || candidate?.submission_date
    || row?.created_at
    || ''
  );
}

function buildSubmitterContext(row, candidate, usersById, usersByName) {
  const explicitName = row?.submitted_by_name || '';
  const derivedByName = usersByName.get(normalizeText(explicitName || candidate?.submitted_by || candidate?.recruiter_name || '')) || {};
  const derivedById = usersById.get(String(row?.submitted_by_user_id || '')) || {};
  return {
    user_id: row?.submitted_by_user_id || derivedById.user_id || derivedByName.user_id || '',
    recruiter_code: pickFirst(row?.submitted_by_recruiter_code, derivedById.recruiter_code, explicitName ? derivedByName.recruiter_code : '', row?.recruiter_code, candidate?.recruiter_code),
    recruiter_name: pickFirst(explicitName, derivedById.full_name, explicitName ? derivedByName.full_name : '', candidate?.submitted_by, candidate?.recruiter_name),
  };
}

function buildSubmissionIdentity(row, candidate = null) {
  const phone = normalizePhone(candidate?.phone || row?.phone || '');
  if (phone.length >= 10) return `phone:${phone.slice(-10)}`;
  const candidateId = String(row?.candidate_id || candidate?.candidate_id || '').trim().toLowerCase();
  if (candidateId) return `candidate:${candidateId}`;
  const fullName = normalizeText(candidate?.full_name || row?.candidate_name || '');
  if (fullName) return `name:${fullName}`;
  return String(row?.submission_id || '').trim().toLowerCase();
}

function dedupeSubmissionRows(rows = [], candidatesById = new Map()) {
  const winners = new Map();
  for (const row of rows) {
    const candidate = candidatesById.get(String(row?.candidate_id || '')) || {};
    const key = buildSubmissionIdentity(row, candidate);
    const current = winners.get(key);
    const currentStamp = current ? toTimestamp(current.submitted_at || current.range_date || '') : 0;
    const nextStamp = toTimestamp(row.submitted_at || row.range_date || '');
    if (!current || nextStamp >= currentStamp) winners.set(key, row);
  }
  return Array.from(winners.values());
}

function inDateRange(row, fromTs, toTs) {
  if (!fromTs && !toTs) return true;
  if (row?.range_date) {
    const stamp = toTimestamp(row.range_date);
    if (!stamp) return !fromTs && !toTs;
    if (fromTs && stamp < fromTs) return false;
    if (toTs && stamp > toTs) return false;
    return true;
  }
  const possibleDates = [
    row.created_at,
    row.updated_at,
    row.submitted_at,
    row.approved_at,
    row.approval_requested_at,
    row.scheduled_at,
    row.follow_up_at,
    row.next_follow_up_at,
    row.selection_date,
    row.joining_date,
    row.joined_date,
    row.interview_date,
    row.last_seen_at,
    row.work_started_at,
    row.break_started_at,
    row.break_expected_end_at,
    row.last_run_at,
  ].map(toTimestamp).filter(Boolean);
  if (!possibleDates.length) return !fromTs && !toTs;
  return possibleDates.some((stamp) => {
    if (fromTs && stamp < fromTs) return false;
    if (toTs && stamp > toTs) return false;
    return true;
  });
}

function recruiterMatches(row, recruiterCode) {
  if (!recruiterCode || recruiterCode === 'all') return true;
  const expected = normalizeText(recruiterCode);
  const candidates = [
    row.recruiter_code,
    row.recruiterCode,
    row.recruiter_name,
    row.recruiterName,
    row.username,
    row.assigned_to_name,
    row.full_name,
  ].map(normalizeText).filter(Boolean);
  return candidates.includes(expected);
}

function formatDurationLabel(fromTs, toTs) {
  if (fromTs && toTs) return 'Custom';
  if (!fromTs && !toTs) return 'All Time';
  return 'Range';
}

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHtmlWorkbook({ title, filters, sections }) {
  const filterRows = [
    ['Recruiter', filters.recruiter_code || 'All Recruiters'],
    ['Categories', (filters.categories || []).join(', ') || 'All'],
    ['From', filters.from || '-'],
    ['To', filters.to || '-'],
    ['Preset', filters.preset || 'Custom'],
    ['Generated At', nowIso()],
  ];

  const sectionHtml = sections.map((section) => {
    const rows = section.rows || [];
    const columns = rows.length ? Object.keys(rows[0]) : ['message'];
    const body = rows.length
      ? rows.map((row) => `<tr>${columns.map((column) => `<td>${htmlEscape(row[column])}</td>`).join('')}</tr>`).join('')
      : `<tr><td>${htmlEscape('No records found for this filter.')}</td></tr>`;
    return `
      <div class="sheet-break"></div>
      <h2>${htmlEscape(section.label)}</h2>
      <div class="meta">Source: ${htmlEscape(section.table_name || '-')} | Records: ${rows.length}</div>
      <table>
        <thead><tr>${columns.map((column) => `<th>${htmlEscape(column)}</th>`).join('')}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    `;
  }).join('');

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #1f2937; }
          h1 { margin: 0 0 10px; color: #1d4ed8; }
          h2 { margin: 20px 0 8px; color: #0f172a; }
          .meta { margin-bottom: 12px; color: #64748b; font-size: 12px; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 22px; }
          th, td { border: 1px solid #dbe4f0; padding: 8px 10px; font-size: 12px; text-align: left; vertical-align: top; }
          th { background: #eff6ff; color: #1e3a8a; }
          .sheet-break { page-break-before: always; }
          .filter-table td:first-child { width: 180px; font-weight: 700; background: #f8fafc; }
        </style>
      </head>
      <body>
        <h1>${htmlEscape(title)}</h1>
        <div class="meta">Local Excel export. Saved on app server disk only. No Supabase storage used.</div>
        <table class="filter-table">
          <tbody>
            ${filterRows.map(([label, value]) => `<tr><td>${htmlEscape(label)}</td><td>${htmlEscape(value)}</td></tr>`).join('')}
          </tbody>
        </table>
        ${sectionHtml}
      </body>
    </html>
  `;
}

function buildCallsRows(activityLog, usersById, recruiterCode) {
  return activityLog
    .filter((row) => normalizeText(row.action_type).includes('call'))
    .map((row) => ({
      activity_id: row.activity_id,
      recruiter_code: pickFirst(usersById.get(String(row.user_id))?.recruiter_code, row.recruiter_code),
      recruiter_name: pickFirst(usersById.get(String(row.user_id))?.full_name, row.username),
      action_type: row.action_type,
      candidate_id: row.candidate_id,
      created_at: row.created_at,
      metadata: JSON.stringify(parseJsonSafe(row.metadata)),
    }))
    .filter((row) => recruiterMatches(row, recruiterCode));
}

function buildLogoutRows(activityLog, usersById, recruiterCode) {
  return activityLog
    .filter((row) => {
      const action = normalizeText(row.action_type);
      return action.includes('logout') || action.includes('signout') || action.includes('session_end');
    })
    .map((row) => ({
      activity_id: row.activity_id,
      recruiter_code: pickFirst(usersById.get(String(row.user_id))?.recruiter_code, row.recruiter_code),
      recruiter_name: pickFirst(usersById.get(String(row.user_id))?.full_name, row.username),
      action_type: row.action_type,
      created_at: row.created_at,
      metadata: JSON.stringify(parseJsonSafe(row.metadata)),
    }))
    .filter((row) => recruiterMatches(row, recruiterCode));
}

function buildAttendanceSummaryRows(presence, usersById, recruiterCode) {
  return presence
    .map((row) => {
      const user = usersById.get(String(row.user_id)) || {};
      const live = computePresenceMinutes(row);
      return {
        recruiter_code: user.recruiter_code || '',
        recruiter_name: user.full_name || user.username || row.user_id,
        role: user.role || '',
        work_started_at: row.work_started_at || '',
        last_seen_at: row.last_seen_at || '',
        total_work_minutes: live.total_work_minutes,
        productive_work_minutes: live.productive_work_minutes,
        total_break_minutes: live.total_break_minutes,
        active_break: isTruthy(row.is_on_break) ? 'Yes' : 'No',
        break_reason: row.break_reason || '',
        locked: isTruthy(row.locked) ? 'Yes' : 'No',
        last_page: row.last_page || '',
      };
    })
    .filter((row) => recruiterMatches(row, recruiterCode));
}

function buildLoginRows(presence, usersById, recruiterCode) {
  return presence
    .map((row) => {
      const user = usersById.get(String(row.user_id)) || {};
      const live = computePresenceMinutes(row);
      return {
        recruiter_code: user.recruiter_code || '',
        recruiter_name: user.full_name || user.username || row.user_id,
        role: user.role || '',
        login_at: row.work_started_at || '',
        last_seen_at: row.last_seen_at || '',
        session_minutes: live.session_minutes,
        productive_work_minutes: live.productive_work_minutes,
        total_break_minutes: live.total_break_minutes,
        screen_sharing: isTruthy(row.screen_sharing) ? 'Yes' : 'No',
        meeting_joined: isTruthy(row.meeting_joined) ? 'Yes' : 'No',
      };
    })
    .filter((row) => recruiterMatches(row, recruiterCode));
}

function buildBreakRows(presence, usersById, recruiterCode) {
  return presence
    .map((row) => {
      const user = usersById.get(String(row.user_id)) || {};
      return {
        recruiter_code: user.recruiter_code || '',
        recruiter_name: user.full_name || user.username || row.user_id,
        break_reason: row.break_reason || '',
        break_started_at: row.break_started_at || '',
        break_expected_end_at: row.break_expected_end_at || '',
        total_break_minutes: row.total_break_minutes || '0',
        active_break: isTruthy(row.is_on_break) ? 'Yes' : 'No',
      };
    })
    .filter((row) => recruiterMatches(row, recruiterCode))
    .filter((row) => row.break_reason || Number(row.total_break_minutes || 0) > 0 || row.active_break === 'Yes');
}

async function loadSourceData() {
  const [users, rawCandidates, rawSubmissions, rawInterviews, activityLog, presence, rawRevenueHubEntries, scheduledReports, callLogs] = await Promise.all([
    table('users'),
    table('candidates'),
    table('submissions'),
    table('interviews'),
    table('activity_log'),
    table('presence'),
    table('revenue_hub_entries'),
    table('scheduled_reports'),
    table('call_logs').catch(() => []),
  ]);
  const candidates = activeReportCandidates(rawCandidates);
  const activeCandidateIds = new Set(candidates.map((row) => String(row.candidate_id || '').trim()).filter(Boolean));
  const submissions = rawSubmissions.filter((row) => rowLinkedToActiveCandidate(row, activeCandidateIds));
  const interviews = rawInterviews.filter((row) => rowLinkedToActiveCandidate(row, activeCandidateIds));
  const revenueHubEntries = rawRevenueHubEntries.filter((row) => rowLinkedToActiveCandidate(row, activeCandidateIds));
  return { users, candidates, submissions, interviews, activityLog, presence, revenueHubEntries, scheduledReports, callLogs };
}

function buildDatasets(source, recruiterCode) {
  const candidatesById = new Map(source.candidates.map((row) => [String(row.candidate_id), row]));
  const usersById = new Map(source.users.map((row) => [String(row.user_id), row]));
  const usersByName = new Map(source.users.map((row) => [normalizeText(row.full_name), row]));
  const now = Date.now();

  const datasets = {
    submissions: dedupeSubmissionRows(source.submissions.map((row) => {
      const candidate = candidatesById.get(String(row.candidate_id)) || {};
      const submitter = buildSubmitterContext(row, candidate, usersById, usersByName);
      const stamp = submissionStamp(row, candidate);
      return {
        submission_id: row.submission_id,
        candidate_id: row.candidate_id,
        candidate_name: candidate.full_name || '',
        recruiter_code: submitter.recruiter_code,
        recruiter_name: submitter.recruiter_name,
        process: candidate.process || '',
        approval_status: row.approval_status || '',
        status: row.status || '',
        submitted_at: stamp,
        next_follow_up_at: row.next_follow_up_at || '',
        updated_at: row.updated_at || '',
        range_date: stamp,
      };
    }), candidatesById).filter((row) => recruiterMatches(row, recruiterCode)),

    interviews: source.interviews.map((row) => {
      const candidate = candidatesById.get(String(row.candidate_id)) || {};
      return {
        interview_id: row.interview_id,
        candidate_id: row.candidate_id,
        candidate_name: candidate.full_name || '',
        recruiter_code: candidate.recruiter_code || '',
        recruiter_name: candidate.recruiter_name || '',
        process: candidate.process || '',
        location: candidate.location || '',
        stage: row.stage || '',
        status: row.status || '',
        scheduled_at: row.scheduled_at || '',
        created_at: row.created_at || '',
        range_date: row.scheduled_at || row.created_at || '',
      };
    }).filter((row) => recruiterMatches(row, recruiterCode)),

    calls: (source.callLogs && source.callLogs.length ? buildCallLogRows(source.callLogs, usersById, usersByName, recruiterCode, source.candidates) : buildCallsRows(source.activityLog, usersById, recruiterCode)),

    selections: source.revenueHubEntries
      .filter((row) => row.selection_date || normalizeText(row.status).includes('select'))
      .filter((row) => recruiterMatches(row, recruiterCode))
      .map((row) => ({
        revenue_id: row.revenue_id,
        candidate_id: row.candidate_id,
        candidate_name: row.full_name,
        recruiter_code: row.recruiter_code,
        recruiter_name: row.recruiter_name,
        process: row.process,
        client_name: row.client_name,
        selection_date: row.selection_date || '',
        status: row.status || '',
        updated_at: row.updated_at || '',
        range_date: row.selection_date || row.updated_at || '',
      })),

    joining: source.revenueHubEntries
      .filter((row) => row.joining_date || row.joined_date || normalizeText(row.status).includes('join'))
      .filter((row) => recruiterMatches(row, recruiterCode))
      .map((row) => ({
        revenue_id: row.revenue_id,
        candidate_id: row.candidate_id,
        candidate_name: row.full_name,
        recruiter_code: row.recruiter_code,
        recruiter_name: row.recruiter_name,
        process: row.process,
        joining_date: row.joining_date || '',
        joined_date: row.joined_date || '',
        status: row.status || '',
        updated_at: row.updated_at || '',
        range_date: row.joining_date || row.joined_date || row.updated_at || '',
      })),

    allocated_profiles: source.candidates
      .filter((row) => row.recruiter_code || row.recruiter_name)
      .filter((row) => recruiterMatches(row, recruiterCode))
      .map((row) => ({
        candidate_id: row.candidate_id,
        candidate_name: row.full_name,
        recruiter_code: row.recruiter_code,
        recruiter_name: row.recruiter_name,
        process: row.process,
        location: row.location,
        preferred_location: row.preferred_location,
        follow_up_at: row.follow_up_at || '',
        status: row.status || '',
        created_at: row.created_at || '',
        updated_at: row.updated_at || '',
        range_date: row.updated_at || row.created_at || '',
      })),

    due_profiles: source.candidates
      .filter((row) => {
        const followUpTs = toTimestamp(row.follow_up_at);
        return followUpTs && followUpTs <= now;
      })
      .filter((row) => recruiterMatches(row, recruiterCode))
      .map((row) => ({
        candidate_id: row.candidate_id,
        candidate_name: row.full_name,
        recruiter_code: row.recruiter_code,
        recruiter_name: row.recruiter_name,
        process: row.process,
        status: row.status,
        follow_up_at: row.follow_up_at,
        follow_up_note: row.follow_up_note || '',
        updated_at: row.updated_at || '',
        range_date: row.follow_up_at || row.updated_at || '',
      })),

    not_interested: source.candidates
      .filter((row) => ['not intrested', 'not interested'].includes(normalizeText(row.status)))
      .filter((row) => recruiterMatches(row, recruiterCode))
      .map((row) => ({
        candidate_id: row.candidate_id,
        candidate_name: row.full_name,
        recruiter_code: row.recruiter_code,
        recruiter_name: row.recruiter_name,
        process: row.process,
        location: row.location,
        status: row.status,
        updated_at: row.updated_at || '',
        range_date: row.updated_at || '',
      })),

    not_responding: source.candidates
      .filter((row) => {
        const status = normalizeText(row.status);
        return status.includes('not responding') || status.includes('no response');
      })
      .filter((row) => recruiterMatches(row, recruiterCode))
      .map((row) => ({
        candidate_id: row.candidate_id,
        candidate_name: row.full_name,
        recruiter_code: row.recruiter_code,
        recruiter_name: row.recruiter_name,
        process: row.process,
        location: row.location,
        status: row.status,
        follow_up_at: row.follow_up_at || '',
        updated_at: row.updated_at || '',
        range_date: row.updated_at || row.follow_up_at || '',
      })),

    attendance_summary: buildAttendanceSummaryRows(source.presence, usersById, recruiterCode),
    login_timing: buildLoginRows(source.presence, usersById, recruiterCode),
    breaks: buildBreakRows(source.presence, usersById, recruiterCode),
    logout_activity: buildLogoutRows(source.activityLog, usersById, recruiterCode),
  };

  return datasets;
}

function filterDatasetsByRange(datasets, fromTs, toTs) {
  const filtered = {};
  for (const [key, rows] of Object.entries(datasets)) {
    filtered[key] = rows.filter((row) => inDateRange(row, fromTs, toTs));
  }
  return filtered;
}


function metricDateForCandidate(row) {
  return pickFirst(row.updated_at, row.created_at, row.data_uploading_date, row.submission_date, row.approval_requested_at);
}

function makeEmptyHoldRow(code = 'Unassigned', name = 'Unassigned') {
  return {
    recruiter_code: code || 'Unassigned',
    recruiter_name: name || code || 'Unassigned',
    submissions: 0,
    interviews: 0,
    selections: 0,
    joinings: 0,
    calls_dialed: 0,
    whatsapp_sent: 0,
    shortlisted_profiles: 0,
    pending_profiles: 0,
    completed_profiles: 0,
    profiles_touched: 0,
  };
}

function recruiterIdentity(row = {}, usersById = new Map(), usersByName = new Map()) {
  const userById = usersById.get(String(row.user_id || row.submitted_by_user_id || '')) || {};
  const possibleName = pickFirst(row.recruiter_name, row.submitted_by_name, row.assigned_to_name, row.full_name, row.username, row.employee_name);
  const userByName = usersByName.get(normalizeText(possibleName)) || {};
  const code = pickFirst(
    row.recruiter_code,
    row.submitted_by_recruiter_code,
    row.assigned_to_code,
    userById.recruiter_code,
    userByName.recruiter_code
  );
  const name = pickFirst(
    row.recruiter_name,
    row.submitted_by_name,
    row.assigned_to_name,
    userById.full_name,
    userByName.full_name,
    row.full_name,
    row.username,
    row.employee_name
  );
  return {
    code: String(code || 'Unassigned').trim() || 'Unassigned',
    name: String(name || code || 'Unassigned').trim() || String(code || 'Unassigned').trim() || 'Unassigned',
  };
}

function holdKey(identity) {
  return normalizeText(identity.code || identity.name || 'Unassigned') || 'unassigned';
}

function ensureHoldRow(summaryMap, identity) {
  const key = holdKey(identity);
  if (!summaryMap.has(key)) summaryMap.set(key, makeEmptyHoldRow(identity.code, identity.name));
  const row = summaryMap.get(key);
  if ((!row.recruiter_name || row.recruiter_name === 'Unassigned') && identity.name) row.recruiter_name = identity.name;
  if ((!row.recruiter_code || row.recruiter_code === 'Unassigned') && identity.code) row.recruiter_code = identity.code;
  return row;
}

function addHoldMetric(summaryMap, row, metric, usersById, usersByName, amount = 1) {
  const identity = recruiterIdentity(row, usersById, usersByName);
  const item = ensureHoldRow(summaryMap, identity);
  item[metric] = Number(item[metric] || 0) + amount;
}

function holdCandidateMatches(row, recruiterCode) {
  return recruiterMatches({
    recruiter_code: row.recruiter_code,
    recruiter_name: row.recruiter_name,
    submitted_by: row.submitted_by,
    employee_name: row.employee_name,
    full_name: row.full_name,
  }, recruiterCode);
}

function buildWhatsappRows(activityLog, usersById, recruiterCode) {
  return activityLog
    .filter((row) => normalizeText(row.action_type).includes('whatsapp'))
    .map((row) => ({
      activity_id: row.activity_id,
      user_id: row.user_id,
      username: row.username,
      recruiter_code: pickFirst(usersById.get(String(row.user_id))?.recruiter_code, row.recruiter_code),
      recruiter_name: pickFirst(usersById.get(String(row.user_id))?.full_name, row.username),
      action_type: row.action_type,
      candidate_id: row.candidate_id,
      created_at: row.created_at,
      range_date: row.created_at,
      metadata: JSON.stringify(parseJsonSafe(row.metadata)),
    }))
    .filter((row) => recruiterMatches(row, recruiterCode));
}

function buildCallLogRows(callLogs, usersById, usersByName, recruiterCode, candidates = []) {
  const usersByUsername = new Map([...usersById.values()].map((user) => [normalizeText(user.username), user]));
  const usersByCode = new Map([...usersById.values()].map((user) => [normalizeText(user.recruiter_code || user.employee_code), user]));
  const candidateIds = new Set((candidates || []).map((c) => String(c.candidate_id || '').trim()).filter(Boolean));
  const candidatePhones = new Set((candidates || []).map((c) => normalizePhone(c.phone || c.number || c.mobile || c.candidate_phone || '').slice(-10)).filter(Boolean));
  return dedupeCallRows(callLogs || [])
    .filter((row) => {
      const cid = String(row.candidate_id || row.current_candidate_id || '').trim();
      const p = normalizePhone(row.phone || row.number || row.mobile || row.candidate_phone || '').slice(-10);
      return Boolean((cid && candidateIds.has(cid)) || (p && candidatePhones.has(p)));
    })
    .map((row) => {
      const user = usersById.get(String(row.employee_user_id || row.user_id || ''))
        || usersByUsername.get(normalizeText(row.employee_username || row.username || ''))
        || usersByCode.get(normalizeText(row.recruiter_code || ''))
        || usersByName.get(normalizeText(row.employee_name || row.recruiter_name || ''))
        || {};
      const metrics = callMetricForRow(row);
      const direction = metrics.incoming_calls_count ? 'Incoming' : 'Outgoing';
      const status = metrics.connected_calls_count ? 'Connected' : (metrics.missed_calls_count ? 'Missed' : (metrics.incoming_calls_count ? 'Incoming' : 'Not Connected'));
      return {
        call_log_id: row.call_log_id || '',
        session_id: row.session_id || '',
        queue_item_id: row.queue_item_id || '',
        candidate_id: row.candidate_id || '',
        candidate_name: row.candidate_name || '',
        recruiter_code: pickFirst(user.recruiter_code, row.recruiter_code),
        recruiter_name: pickFirst(user.full_name, row.employee_name, row.recruiter_name, row.employee_username),
        phone: row.phone || '',
        direction,
        status,
        connected_calls: metrics.connected_calls_count,
        not_connected_calls: metrics.not_connected_calls_count,
        incoming_calls: metrics.incoming_calls_count,
        outgoing_calls: metrics.outgoing_calls_count,
        missed_calls: metrics.missed_calls_count,
        talktime_seconds: metrics.talktime_seconds,
        call_source: row.call_source || row.source_mode || '',
        created_at: row.call_started_at || row.created_at || '',
        range_date: row.call_started_at || row.created_at || row.updated_at || '',
      };
    })
    .filter((row) => recruiterMatches(row, recruiterCode));
}

function isShortlistedProfile(row) {
  const text = normalizeText(`${row.status || ''} ${row.profile_status || ''} ${row.approval_status || ''}`);
  return text.includes('shortlist') || text.includes('sort');
}

function isPendingProfile(row) {
  const text = normalizeText(`${row.all_details_sent || ''} ${row.approval_status || ''} ${row.status || ''}`);
  if (text.includes('complete') || text.includes('approved') || text.includes('joined')) return false;
  return text.includes('pending') || text.includes('draft') || text.includes('in - progress') || text.includes('in progress') || text.includes('progress') || !text.trim();
}

function isCompletedProfile(row) {
  const text = normalizeText(`${row.all_details_sent || ''} ${row.approval_status || ''} ${row.status || ''}`);
  return text.includes('complete') || text.includes('approved') || text.includes('selected') || text.includes('joined');
}

function buildHoldReportSections(source, normalized) {
  const usersById = new Map(source.users.map((row) => [String(row.user_id), row]));
  const usersByName = new Map(source.users.map((row) => [normalizeText(row.full_name), row]));
  const datasets = buildDatasets(source, normalized.recruiter_code);
  const fromTs = toTimestamp(normalized.from);
  const toTs = toTimestamp(normalized.to);
  const filtered = filterDatasetsByRange(datasets, fromTs, toTs);
  const whatsappRows = buildWhatsappRows(source.activityLog, usersById, normalized.recruiter_code)
    .filter((row) => inDateRange(row, fromTs, toTs));

  const candidatesInRange = source.candidates
    .filter((row) => holdCandidateMatches(row, normalized.recruiter_code))
    .map((row) => ({
      ...row,
      range_date: metricDateForCandidate(row),
    }))
    .filter((row) => inDateRange(row, fromTs, toTs));

  const summaryMap = new Map();

  for (const row of filtered.submissions || []) addHoldMetric(summaryMap, row, 'submissions', usersById, usersByName);
  for (const row of filtered.interviews || []) addHoldMetric(summaryMap, row, 'interviews', usersById, usersByName);
  for (const row of filtered.selections || []) addHoldMetric(summaryMap, row, 'selections', usersById, usersByName);
  for (const row of filtered.joining || []) addHoldMetric(summaryMap, row, 'joinings', usersById, usersByName);
  for (const row of filtered.calls || []) {
    const dialedAmount = Number(row.outgoing_calls || 0) || 0;
    if (dialedAmount > 0) addHoldMetric(summaryMap, row, 'calls_dialed', usersById, usersByName, dialedAmount);
  }
  for (const row of whatsappRows) addHoldMetric(summaryMap, row, 'whatsapp_sent', usersById, usersByName);
  for (const row of candidatesInRange) {
    addHoldMetric(summaryMap, row, 'profiles_touched', usersById, usersByName);
    if (isShortlistedProfile(row)) addHoldMetric(summaryMap, row, 'shortlisted_profiles', usersById, usersByName);
    if (isPendingProfile(row)) addHoldMetric(summaryMap, row, 'pending_profiles', usersById, usersByName);
    if (isCompletedProfile(row)) addHoldMetric(summaryMap, row, 'completed_profiles', usersById, usersByName);
  }

  const recruiterRows = Array.from(summaryMap.values())
    .sort((a, b) => String(a.recruiter_code || '').localeCompare(String(b.recruiter_code || '')));

  const total = makeEmptyHoldRow('TOTAL', 'All Recruiters');
  for (const row of recruiterRows) {
    for (const key of ['submissions','interviews','selections','joinings','calls_dialed','whatsapp_sent','shortlisted_profiles','pending_profiles','completed_profiles','profiles_touched']) {
      total[key] += Number(row[key] || 0);
    }
  }

  const detailRows = [
    ...(filtered.submissions || []).map((row) => ({ metric: 'Submission', candidate_id: row.candidate_id, candidate_name: row.candidate_name, recruiter_code: row.recruiter_code, recruiter_name: row.recruiter_name, date_time: row.range_date, status: row.approval_status || row.status || '', process: row.process || '' })),
    ...(filtered.interviews || []).map((row) => ({ metric: 'Interview', candidate_id: row.candidate_id, candidate_name: row.candidate_name, recruiter_code: row.recruiter_code, recruiter_name: row.recruiter_name, date_time: row.range_date, status: row.status || row.stage || '', process: row.process || '' })),
    ...(filtered.selections || []).map((row) => ({ metric: 'Selection', candidate_id: row.candidate_id, candidate_name: row.candidate_name, recruiter_code: row.recruiter_code, recruiter_name: row.recruiter_name, date_time: row.range_date, status: row.status || '', process: row.process || '' })),
    ...(filtered.joining || []).map((row) => ({ metric: 'Joining', candidate_id: row.candidate_id, candidate_name: row.candidate_name, recruiter_code: row.recruiter_code, recruiter_name: row.recruiter_name, date_time: row.range_date, status: row.status || '', process: row.process || '' })),
    ...(filtered.calls || []).map((row) => ({ metric: 'Call Dialed', candidate_id: row.candidate_id, candidate_name: row.candidate_name || '', recruiter_code: row.recruiter_code, recruiter_name: row.recruiter_name, date_time: row.range_date || row.created_at, status: row.action_type || '', process: '' })),
    ...whatsappRows.map((row) => ({ metric: 'WhatsApp', candidate_id: row.candidate_id, candidate_name: '', recruiter_code: row.recruiter_code, recruiter_name: row.recruiter_name, date_time: row.range_date || row.created_at, status: row.action_type || '', process: '' })),
  ].sort((a, b) => String(b.date_time || '').localeCompare(String(a.date_time || '')));

  return [
    {
      key: 'hold_overall_summary',
      label: 'Hold Report - Overall Summary',
      table_name: 'manual_range_summary',
      rows: [total],
    },
    {
      key: 'hold_recruiter_summary',
      label: 'Hold Report - Recruiter Wise Summary',
      table_name: 'manual_range_summary',
      rows: recruiterRows.length ? recruiterRows : [makeEmptyHoldRow('No Data', 'No matching activity found')],
    },
    {
      key: 'hold_activity_details',
      label: 'Hold Report - Activity Details',
      table_name: 'manual_range_details',
      rows: detailRows,
    },
  ];
}

async function writeHoldReport(filters, user) {
  const normalized = normalizeFilters({ ...(filters || {}), categories: DEFAULT_CATEGORY_KEYS });
  const source = await loadSourceData();
  const fromTs = toTimestamp(normalized.from);
  const toTs = toTimestamp(normalized.to);
  const sections = buildHoldReportSections(source, normalized);
  const safeRecruiter = normalized.recruiter_code === 'all' ? 'all_recruiters' : normalized.recruiter_code.replace(/[^a-z0-9_-]/gi, '_');
  const nonce = crypto.randomBytes(6).toString('hex');
  const file = `hold_report_${safeRecruiter}_${Date.now()}_${nonce}.xls`;
  const filePath = path.join(GENERATED_DIR, file);
  fs.writeFileSync(filePath, buildHtmlWorkbook({
    title: 'Career Crox Hold Report',
    filters: {
      recruiter_code: normalized.recruiter_code === 'all' ? 'All Recruiters' : normalized.recruiter_code,
      categories: ['Hold Report'],
      from: normalized.from || '',
      to: normalized.to || '',
      preset: normalized.preset || formatDurationLabel(fromTs, toTs),
    },
    sections,
  }));

  const reports = await table('scheduled_reports');
  const entry = await store.insert('scheduled_reports', {
    report_id: nextId('RPT', reports, 'report_id'),
    user_id: user?.user_id || 'manual',
    title: `Hold report (${normalized.recruiter_code === 'all' ? 'All Recruiters' : normalized.recruiter_code})`,
    report_type: 'hold-report',
    filters_json: JSON.stringify(normalized),
    file_format: 'xls',
    frequency_minutes: '',
    status: 'generated',
    next_run_at: '',
    last_run_at: nowIso(),
    last_file_name: file,
    created_at: nowIso(),
  });

  return {
    download_url: `/generated/${file}`,
    file_name: file,
    generated_sections: sections.map((item) => ({ key: item.key, label: item.label, count: item.rows.length })),
    item: entry,
  };
}

function normalizeFilters(input = {}) {
  const recruiter_code = String(input.recruiter_code || 'all').trim() || 'all';
  const categories = Array.isArray(input.categories)
    ? input.categories.filter((key) => CATEGORY_KEY_SET.has(String(key)))
    : DEFAULT_CATEGORY_KEYS;
  const from = String(input.from || '').trim();
  const to = String(input.to || '').trim();
  return {
    recruiter_code,
    categories: categories.length ? categories : DEFAULT_CATEGORY_KEYS,
    from,
    to,
    preset: String(input.preset || '').trim(),
  };
}

async function getReportMeta() {
  const source = await loadSourceData();
  const datasets = buildDatasets(source, 'all');
  const recruiters = source.users
    .filter((row) => String(row.recruiter_code || '').trim())
    .map((row) => ({
      user_id: row.user_id,
      recruiter_code: row.recruiter_code,
      full_name: row.full_name,
      role: row.role,
    }))
    .sort((a, b) => String(a.recruiter_code).localeCompare(String(b.recruiter_code)));

  const tables_ready = CATEGORY_CONFIG.map((config) => ({
    ...config,
    record_count: (datasets[config.key] || []).length,
  }));

  const sortedReports = source.scheduledReports.slice().sort((a, b) => String(b.last_run_at || '').localeCompare(String(a.last_run_at || '')));
  return {
    recruiters,
    categories: CATEGORY_CONFIG,
    tables_ready,
    cards: {
      last_report_made: sortedReports[0]?.last_run_at || '',
      reports_generated: sortedReports.length,
      recruiter_codes: recruiters.length,
      tables_ready: tables_ready.length,
    },
  };
}


async function getLightReportMeta() {
  const scheduledReports = await table('scheduled_reports');
  const sortedReports = scheduledReports.slice().sort((a, b) => String(b.last_run_at || '').localeCompare(String(a.last_run_at || '')));
  return {
    recruiters: [],
    categories: CATEGORY_CONFIG,
    tables_ready: CATEGORY_CONFIG.map((config) => ({ ...config, record_count: '-' })),
    cards: {
      last_report_made: sortedReports[0]?.last_run_at || '',
      reports_generated: sortedReports.length,
      recruiter_codes: 0,
      tables_ready: CATEGORY_CONFIG.length,
    },
  };
}

async function writeReport(filters, user) {
  const normalized = normalizeFilters(filters);
  const source = await loadSourceData();
  const datasets = buildDatasets(source, normalized.recruiter_code);
  const fromTs = toTimestamp(normalized.from);
  const toTs = toTimestamp(normalized.to);
  const filtered = filterDatasetsByRange(datasets, fromTs, toTs);
  const sections = CATEGORY_CONFIG
    .filter((item) => normalized.categories.includes(item.key))
    .map((item) => ({
      ...item,
      rows: filtered[item.key] || [],
    }));

  const safeRecruiter = normalized.recruiter_code === 'all' ? 'all_recruiters' : normalized.recruiter_code.replace(/[^a-z0-9_-]/gi, '_');
  const nonce = crypto.randomBytes(6).toString('hex');
  const file = `reports_${safeRecruiter}_${Date.now()}_${nonce}.xls`;
  const filePath = path.join(GENERATED_DIR, file);
  const title = `Career Crox Reports Export`;
  fs.writeFileSync(filePath, buildHtmlWorkbook({
    title,
    filters: {
      recruiter_code: normalized.recruiter_code === 'all' ? 'All Recruiters' : normalized.recruiter_code,
      categories: sections.map((item) => item.label),
      from: normalized.from || '',
      to: normalized.to || '',
      preset: normalized.preset || formatDurationLabel(fromTs, toTs),
    },
    sections,
  }));

  const reports = await table('scheduled_reports');
  const entry = await store.insert('scheduled_reports', {
    report_id: nextId('RPT', reports, 'report_id'),
    user_id: user?.user_id || 'manual',
    title: `Reports export (${sections.map((item) => item.label).join(', ')})`,
    report_type: 'multi-category',
    filters_json: JSON.stringify(normalized),
    file_format: 'xls',
    frequency_minutes: '',
    status: 'generated',
    next_run_at: '',
    last_run_at: nowIso(),
    last_file_name: file,
    created_at: nowIso(),
  });
  return {
    download_url: `/generated/${file}`,
    file_name: file,
    generated_sections: sections.map((item) => ({ key: item.key, label: item.label, count: item.rows.length })),
    item: entry,
  };
}

async function list(req, res) {
  const includeArchived = String(req.query?.include_archived || req.query?.archived || '') === '1';
  const isArchived = (row = {}) => ['archived', 'deleted', '__deleted__'].includes(normalizeText(row.status || row.category || ''));
  const items = (await table('scheduled_reports'))
    .filter((row) => includeArchived || !isArchived(row))
    .slice()
    .sort((a, b) => String(b.last_run_at || '').localeCompare(String(a.last_run_at || '')))
    .map((row) => ({
      ...row,
      open_url: normalizeText(row.report_type) === 'semi-hourly'
        ? `/semi-hourly-report?reportId=${encodeURIComponent(row.report_id)}`
        : (row.last_file_name ? `/generated/${row.last_file_name}` : ''),
    }));
  const wantsFull = String(req.query?.full || '') === '1';
  const meta = wantsFull ? await getReportMeta() : await getLightReportMeta();
  return res.json({ items, meta });
}


function managerOnly(req, res) {
  const role = String(req.user?.role || '').toLowerCase();
  if (!['admin', 'manager'].includes(role)) {
    res.status(403).json({ message: 'Only manager can access Attendance Report.' });
    return false;
  }
  return true;
}

function parseReportSnapshot(row = {}) {
  try { return JSON.parse(row.snapshot_json || '{}'); } catch { return {}; }
}

function reportDateInRange(workDate, from = '', to = '') {
  const key = String(workDate || '').slice(0, 10);
  if (!key) return true;
  if (from && key < String(from).slice(0, 10)) return false;
  if (to && key > String(to).slice(0, 10)) return false;
  return true;
}

function attendanceReportRow(row = {}) {
  const snap = parseReportSnapshot(row);
  const s = snap.summary || {};
  const employee = snap.employee || {};
  return {
    report_id: row.report_id,
    user_id: row.user_id || '',
    status: row.status || '',
    decision_status: row.decision_status || snap.manager_decision || '',
    decision_note: row.decision_note || snap.manager_note || '',
    work_date: snap.work_date || String(row.last_run_at || row.created_at || '').slice(0, 10),
    employee_name: employee.full_name || '',
    recruiter_code: employee.recruiter_code || '',
    productivity_status: snap.productivity_status || '',
    recommended_day_status: snap.recommended_day_status || s.day_status || '',
    work_time: s.work_time_label || '',
    active_work_minutes: Number(s.productive_work_minutes || s.active_work_minutes || 0) || 0,
    idle_minutes: Number(s.idle_minutes || 0) || 0,
    break_minutes: Number(s.total_break_minutes || 0) || 0,
    dialed_calls: Number(s.outgoing_calls_count ?? s.dialed_calls_count ?? 0) || 0,
    connected_calls: Number(s.connected_calls_count || 0) || 0,
    talktime_minutes: Number(s.talktime_minutes || 0) || 0,
    submissions: Number(s.submissions_count || 0) || 0,
    missed_interviews: Number(s.missed_interviews_today || 0) || 0,
    notes: snap.notes || '',
    generated_at: snap.generated_at || row.last_run_at || row.created_at || '',
  };
}

async function attendanceReports(req, res) {
  if (!managerOnly(req, res)) return null;
  const from = String(req.query?.from || '').slice(0, 10);
  const to = String(req.query?.to || '').slice(0, 10);
  const userId = String(req.query?.user_id || '').trim();
  const reports = (await table('scheduled_reports'))
    .filter((row) => String(row.report_type || '').toLowerCase() === 'attendance-daily')
    .map(attendanceReportRow)
    .filter((row) => reportDateInRange(row.work_date, from, to))
    .filter((row) => !userId || String(row.user_id || '') === userId)
    .sort((a, b) => String(b.work_date || '').localeCompare(String(a.work_date || '')) || String(a.employee_name || '').localeCompare(String(b.employee_name || '')));
  return res.json({ items: reports, summary: { count: reports.length }, filters: { from, to, user_id: userId } });
}

async function exportAttendanceReports(req, res) {
  if (!managerOnly(req, res)) return null;
  const from = String(req.query?.from || '').slice(0, 10);
  const to = String(req.query?.to || '').slice(0, 10);
  const reports = (await table('scheduled_reports'))
    .filter((row) => String(row.report_type || '').toLowerCase() === 'attendance-daily')
    .map(attendanceReportRow)
    .filter((row) => reportDateInRange(row.work_date, from, to));
  const headers = ['Date','Employee','Code','Productivity','Recommended Day','Manager Decision','Work Time','Idle Minutes','Break Minutes','Dialed','Connected','Talktime Minutes','Submissions','Missed Interviews','Notes'];
  const rows = reports.map((row) => [row.work_date,row.employee_name,row.recruiter_code,row.productivity_status,row.recommended_day_status,row.decision_status,row.work_time,row.idle_minutes,row.break_minutes,row.dialed_calls,row.connected_calls,row.talktime_minutes,row.submissions,row.missed_interviews,row.notes]);
  const escape = (v) => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const html = `<html><head><meta charset="utf-8" /></head><body><h2>Attendance Report</h2><table border="1"><thead><tr>${headers.map((h) => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${escape(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
  res.setHeader('Content-Type', 'application/vnd.ms-excel');
  res.setHeader('Content-Disposition', 'attachment; filename="career-crox-attendance-report.xls"');
  return res.send(html);
}


function reminderLower(value) {
  return String(value || '').trim().toLowerCase();
}

function reminderIsDeleted(row = {}) {
  const status = reminderLower(row.status || row.candidate_status || '');
  const approval = reminderLower(row.approval_status || '');
  const details = reminderLower(row.all_details_sent || '');
  const notes = reminderLower(row.data_notes || row.notes || '');
  return Boolean(String(row.deleted_at || '').trim())
    || ['deleted', '__deleted__', 'archived'].includes(status)
    || ['deleted', '__deleted__', 'archived'].includes(approval)
    || ['deleted', '__deleted__', 'archived'].includes(details)
    || notes.includes('[crm-deleted]');
}

function reminderRole(user = {}) {
  const raw = reminderLower(user.role || user.designation || user.user_role || '');
  if (raw.includes('admin')) return 'admin';
  if (raw.includes('manager')) return 'manager';
  if (raw === 'tl' || raw.includes('team lead')) return 'tl';
  if (raw.includes('recruiter')) return 'recruiter';
  return raw;
}

function reminderCandidateVisible(row = {}, user = {}) {
  const role = reminderRole(user);
  if (['admin','manager'].includes(role)) return true;
  // CC26_767: reminder visibility follows the exact same canonical candidate
  // ownership rule as Candidates/Submissions. Audit fields such as submitted_by
  // never grant an intern/recruiter access to another owner's reminder.
  return role === 'tl' ? candidateBelongsToTeam(row, user) : candidateBelongsToUser(row, user);
}

function reminderPendingSubmission(row = {}) {
  if (reminderIsDeleted(row)) return false;
  const approval = reminderLower(row.approval_status || row.submission_status || '');
  const status = reminderLower(row.status || row.candidate_status || '');
  const details = reminderLower(row.all_details_sent || '');
  if (/(rejected|cancelled|canceled|deleted|archived)/.test(`${approval} ${status}`)) return false;
  if (/^(complete|completed|done|yes|sent)$/.test(details)) return false;
  // A real submission first reminds 5 minutes after submit; local snooze controls later recurrence until All Details Sent is completed.
  return Boolean(String(row.submission_id || row.candidate_id || '').trim());
}

function reminderSubmissionDueAt(row = {}) {
  const snoozed = String(row.reminder_snoozed_until || '').trim();
  if (snoozed) return snoozed;
  // CC26_765: a submission reminder is anchored to the real submit/approval-request
  // event, never to a generic follow-up field or a date-only candidate submission_date.
  // Example: submitted 10:36 => due 10:41 unless the user explicitly snoozes it.
  const base = row.approval_requested_at || row.submitted_at || row.effective_submission_at || row.submission_origin_at || row.created_at || row.updated_at || row.submission_date || '';
  const baseMs = parseReminderTime(base);
  if (!baseMs) return reminderSafeDueAt('', Date.now());
  return new Date(baseMs + 5 * 60000).toISOString();
}

function reminderInterviewStamp(row = {}) {
  // Candidate profile date/reschedule is the workflow source of truth after an edit.
  // If it is date-only, keep the existing scheduled clock time instead of silently moving to 09:00.
  const edited = String(row.interview_reschedule_date || row.interview_date || '').trim();
  const scheduled = String(row.scheduled_at || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(edited) && scheduled && !/^\d{4}-\d{2}-\d{2}$/.test(scheduled)) {
    const scheduledMs = parseReminderTime(scheduled);
    if (scheduledMs) {
      try {
        const parts = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
        }).formatToParts(new Date(scheduledMs));
        const get = (type) => parts.find((part) => part.type === type)?.value || '';
        const hh = get('hour');
        const mm = get('minute');
        if (hh && mm) return `${edited}T${hh}:${mm}:00+05:30`;
      } catch {}
    }
  }
  return edited || scheduled;
}

function reminderInterviewMs(row = {}) {
  const raw = reminderInterviewStamp(row);
  if (!raw) return 0;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const t = Date.parse(`${raw}T09:00:00+05:30`);
    return Number.isFinite(t) ? t : 0;
  }
  return parseReminderTime(raw);
}

function reminderIstDateKey(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return new Date(date.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
  }
}

function reminderPendingInterview(row = {}) {
  if (reminderIsDeleted(row)) return false;
  const status = reminderLower(`${row.interview_status || ''} ${row.status || ''}`);
  if (/(complete|completed|done|appeared|selected|rejected|joined|cancelled|canceled|not interested|not intrested)/.test(status)) return false;
  return Boolean(reminderInterviewStamp(row));
}


function reminderPresenceInfo(presence = {}) {
  const now = Date.now();
  const joinedStamp = Date.parse(presence.work_started_at || '');
  const joinedToday = Number.isFinite(joinedStamp) && isToday(presence.work_started_at);
  const onBreak = joinedToday && String(presence.is_on_break || '0') === '1';
  const breakStarted = Date.parse(presence.break_started_at || '');
  const lastSeen = Date.parse(presence.last_seen_at || presence.updated_at || presence.work_started_at || '');
  const breakMinutes = onBreak && Number.isFinite(breakStarted) ? Math.max(0, Math.floor((now - breakStarted) / 60000)) : 0;
  const idleMinutes = joinedToday && Number.isFinite(lastSeen) ? Math.max(0, Math.floor((now - lastSeen) / 60000)) : 0;
  return { joined_today: joinedToday, on_break: onBreak, break_minutes: breakMinutes, idle_minutes: idleMinutes };
}

function reminderFollowupDue(row = {}, includeUpcomingToday = false) {
  if (reminderIsDeleted(row)) return false;
  const status = reminderLower(`${row.status || ''} ${row.follow_up_status || ''}`);
  if (/(complete|completed|done|closed|deleted|archived)/.test(status)) return false;
  const stamp = row.next_follow_up_at || row.follow_up_at || row.followup_date || row.follow_up_date || row.callback_at || '';
  if (!stamp) return false;
  const t = reminderDateMs(stamp);
  if (!t || (!includeUpcomingToday && t > Date.now())) return false;
  // Today's upcoming items reach the laptop early; its LOCAL clock displays at exact due time.
  // Past-day historical overdue profiles remain in the FollowUps report, not the global popup.
  return reminderIstDateKey(t) === reminderIstDateKey(Date.now());
}

function reminderDateMs(value) {
  return parseReminderTime(value);
}


function reminderDisplayName(row = {}) {
  return String(row.full_name || row.candidate_name || row.name || row.client_name || row.process || 'Profile').trim();
}

function reminderShortDetail(row = {}) {
  // CC26_396: reminder popup should show the last meaningful conversation/note first,
  // not a generic recruiter/status pair like "Khushi Mehta • Approved".
  const noteCandidates = [
    row.last_notes, row.notes, row.note, row.data_notes, row.reminder_note, row.profile_notes,
  ];
  for (const value of noteCandidates) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (/^(approved|pending|completed|complete|in progress|submitted|selected|rejected)$/i.test(text)) continue;
    return text.slice(0, 420);
  }
  // Do not fake a conversation note from recruiter/status. If no real note exists, say so clearly.
  return 'No previous note saved yet.';
}

function reminderOpenSubmissionPath(row = {}) {
  const id = encodeURIComponent(String(row.submission_id || row.candidate_id || '').trim());
  return id ? `/submissions?reminder=${id}` : '/submissions';
}


function reminderTaskBelongsToSelf(row = {}, user = {}) {
  const ownId = String(user.user_id || '').trim();
  const ownCode = reminderLower(user.recruiter_code || user.employee_code || '');
  const ownNames = new Set([user.full_name, user.username, user.name].map(reminderLower).filter(Boolean));
  return [row.assigned_to_user_id,row.user_id,row.owner_user_id].some((v) => ownId && String(v || '').trim() === ownId)
    || [row.assigned_to_code,row.recruiter_code,row.employee_code].some((v) => ownCode && reminderLower(v) === ownCode)
    || [row.assigned_to_name,row.recruiter_name,row.employee_name,row.assigned_to_username,row.username].some((v) => ownNames.has(reminderLower(v)) && reminderLower(v));
}

function reminderTaskVisible(row = {}, user = {}) {
  const role = reminderRole(user);
  if (['admin','manager'].includes(role)) return true;
  const ownIds = new Set([user.user_id].map((v) => String(v || '').trim()).filter(Boolean));
  const ownCodes = new Set([user.recruiter_code,user.employee_code].map(reminderLower).filter(Boolean));
  const ownNames = new Set([user.full_name,user.username,user.name].map(reminderLower).filter(Boolean));
  const teamIds = new Set([...(role === 'tl' ? (user.__ccTeamUserIds || []) : [])].map((v) => String(v || '').trim()).filter(Boolean));
  const teamCodes = new Set([...(role === 'tl' ? (user.__ccTeamCodes || []) : [])].map(reminderLower).filter(Boolean));
  const teamNames = new Set([...(role === 'tl' ? (user.__ccTeamNames || []) : [])].map(reminderLower).filter(Boolean));
  for (const value of ownIds) teamIds.add(value); for (const value of ownCodes) teamCodes.add(value); for (const value of ownNames) teamNames.add(value);
  const ids = role === 'tl' ? teamIds : ownIds;
  const codes = role === 'tl' ? teamCodes : ownCodes;
  const names = role === 'tl' ? teamNames : ownNames;
  return [row.assigned_to_user_id,row.user_id,row.owner_user_id].some((v) => ids.has(String(v || '').trim()) && String(v || '').trim())
    || [row.assigned_to_code,row.recruiter_code,row.employee_code].some((v) => codes.has(reminderLower(v)) && reminderLower(v))
    || [row.assigned_to_name,row.recruiter_name,row.employee_name,row.assigned_to_username,row.username].some((v) => names.has(reminderLower(v)) && reminderLower(v));
}

function reminderTaskDue(row = {}, includeUpcomingToday = false) {
  if (reminderIsDeleted(row)) return false;
  const status = reminderLower(row.status || '');
  if (/(done|closed|completed|cancelled|canceled|deleted|archived)/.test(status)) return false;
  const stamp = row.reminder_at || row.due_at || row.due_date || row.created_at || '';
  const t = reminderDateMs(stamp);
  return Boolean(t && (t <= Date.now() || (includeUpcomingToday && reminderIstDateKey(t) === reminderIstDateKey(Date.now()))));
}

function reminderTaskStamp(row = {}) {
  return String(row.reminder_at || row.due_at || row.due_date || row.created_at || row.updated_at || '').trim();
}

function reminderNotificationDue(row = {}, user = {}) {
  if (reminderIsDeleted(row)) return false;
  const userId = String(user.user_id || '').trim();
  const target = String(row.user_id || row.target_user_id || '').trim();
  if (target && userId && target !== userId && !['admin','manager'].includes(reminderRole(user))) return false;
  const status = reminderLower(`${row.status || ''} ${row.read_status || ''}`);
  if (/(read|seen|closed|deleted|archived)/.test(status)) return false;
  return true;
}

function reminderSafeDueAt(value, fallback = Date.now()) {
  const t = reminderDateMs(value);
  return t ? new Date(t).toISOString() : new Date(fallback).toISOString();
}


async function reminderLatestNotesMap(candidateIds = []) {
  const ids = Array.from(new Set((candidateIds || []).map((v) => String(v || '').trim()).filter(Boolean)));
  const out = new Map();
  if (!ids.length) return out;
  // Postgres: fetch only the newest note for the relevant candidate IDs. This avoids loading the full notes table.
  if (store.pool) {
    try {
      const rows = await store.query(`
        select distinct on (candidate_id)
          candidate_id,
          body,
          created_at
        from public.notes
        where candidate_id::text = any($1::text[])
          and coalesce(trim(body), '') <> ''
        order by candidate_id, created_at desc
      `, [ids]);
      for (const row of rows || []) {
        const id = String(row.candidate_id || '').trim();
        const body = String(row.body || '').replace(/\s+/g, ' ').trim();
        if (id && body) out.set(id, body.slice(0, 420));
      }
      return out;
    } catch (error) {
      // Fall through to compatibility mode without breaking reminders.
    }
  }
  try {
    const rows = await table('notes');
    const wanted = new Set(ids);
    const sorted = (rows || []).filter((row) => wanted.has(String(row.candidate_id || '').trim()))
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    for (const row of sorted) {
      const id = String(row.candidate_id || '').trim();
      if (out.has(id)) continue;
      const body = String(row.body || '').replace(/\s+/g, ' ').trim();
      if (id && body) out.set(id, body.slice(0, 420));
    }
  } catch (error) {}
  return out;
}

// Tiny per-user cache prevents simultaneous tabs/popups from repeating full-table reads.
// TTL is intentionally short; privileged lists are NEVER shared across employee identities.
const reminderSummaryCache = new Map();
const REMINDER_SUMMARY_CACHE_MS = 20000;
async function reminderSummary(req, res) {
  const now = Date.now();
  const user = req.user || {};
  const forceFresh = String(req.query?.fresh || '').trim() === '1';
  const cacheKey = [user.user_id, user.role, user.recruiter_code, user.team_id].map((x) => String(x || '')).join('|');
  const existing = cacheKey && reminderSummaryCache.get(cacheKey);
  if (!forceFresh && existing && now - existing.at < REMINDER_SUMMARY_CACHE_MS) {
    res.set('Cache-Control', 'private, no-store');
    return res.json(existing.payload);
  }
  let submissions = [], candidates = [], interviews = [], reports = [], tasks = [], notifications = [];
  if (store.pool) {
    // CC26_766: each reminder source fails independently. One optional/missing column
    // must never blank Submission + Interview + Follow-up + Task reminders together.
    // Queries remain targeted, so this adds resilience without full-table reads or polling.
    const reminderQuery = async (label, fn) => {
      try { return await fn(); }
      catch (error) {
        try { console.error(`Targeted reminder ${label} query failed:`, error?.message || error); } catch {}
        return [];
      }
    };

    const candidateParams = [];
    const cScope = candidateScopeSql('c', user, candidateParams);
    const subParams = [];
    const subScope = candidateScopeSql('c', user, subParams);
    const intParams = [];
    const intScope = candidateScopeSql('c', user, intParams);
    const taskParams = [];
    const taskScope = simpleOwnerSql('t', ['assigned_to_user_id','assigned_to_code','assigned_to_name'], user, taskParams);

    [candidates, submissions, interviews, tasks, notifications, reports] = await Promise.all([
      reminderQuery('candidates', () => store.query(`select c.* from public.candidates c
        where (${cScope.sql}) and (
          (coalesce(c.follow_up_at,'') <> '' and left(c.follow_up_at,10) <= to_char((now() at time zone 'Asia/Kolkata')::date,'YYYY-MM-DD'))
          or left(coalesce(nullif(c.interview_reschedule_date,''),nullif(c.interview_date,''),''),10) = to_char((now() at time zone 'Asia/Kolkata')::date,'YYYY-MM-DD')
          or lower(coalesce(c.approval_status,'')) = 'pending'
          or (lower(coalesce(c.approval_status,'')) = 'approved' and lower(coalesce(c.all_details_sent,'')) = 'pending')
        ) order by coalesce(c.updated_at,c.created_at,'') desc limit 500`, cScope.params)),
      reminderQuery('submissions', () => store.query(`select s.* from public.submissions s join public.candidates c on c.candidate_id=s.candidate_id
        where (${subScope.sql}) and lower(coalesce(s.approval_status,'')) not in ('deleted','__deleted__','archived','rejected','draft')
          and (lower(coalesce(s.approval_status,''))='pending' or lower(coalesce(c.approval_status,''))='pending' or (lower(coalesce(c.approval_status,''))='approved' and lower(coalesce(c.all_details_sent,''))='pending'))
        order by coalesce(s.updated_at,s.submitted_at,s.created_at,'') desc limit 300`, subScope.params)),
      reminderQuery('interviews', () => store.query(`select i.* from public.interviews i join public.candidates c on c.candidate_id=i.candidate_id
        where (${intScope.sql}) and left(coalesce(nullif(c.interview_reschedule_date,''),nullif(c.interview_date,''),nullif(i.scheduled_at,''),''),10)
          = to_char((now() at time zone 'Asia/Kolkata')::date,'YYYY-MM-DD')
        order by coalesce(i.scheduled_at,i.updated_at,i.created_at,'') asc limit 200`, intScope.params)),
      reminderQuery('tasks', () => store.query(`select * from public.tasks t where (${taskScope.sql})
        and lower(coalesce(t.status,'')) not in ('done','completed','closed','deleted','archived')
        and coalesce(nullif(to_jsonb(t)->>'reminder_at',''), nullif(to_jsonb(t)->>'due_at',''), nullif(t.due_date,''), '') <> ''
        and left(coalesce(nullif(to_jsonb(t)->>'reminder_at',''), nullif(to_jsonb(t)->>'due_at',''), nullif(t.due_date,''), ''),10) <= to_char((now() at time zone 'Asia/Kolkata')::date,'YYYY-MM-DD')
        order by coalesce(nullif(to_jsonb(t)->>'reminder_at',''), nullif(to_jsonb(t)->>'due_at',''), nullif(t.due_date,''), t.updated_at,t.created_at,'') asc limit 150`, taskScope.params)),
      BASIC_CRM_MODE ? Promise.resolve([]) : reminderQuery('notifications', () => store.query(`select * from public.notifications where user_id=$1 and lower(coalesce(status,'unread')) <> 'read' order by coalesce(created_at,updated_at,'') desc limit 100`, [String(user.user_id || '')])),
      // Basic CRM has no attendance/report reminders. Avoid those DB reads entirely.
      BASIC_CRM_MODE ? Promise.resolve([]) : reminderQuery('reports', () => store.query(`select * from public.scheduled_reports where (coalesce(user_id,'')='' or user_id=$1) and lower(coalesce(status,'')) not in ('archived','deleted','__deleted__') and report_type in ('semi-hourly','attendance-daily') order by coalesce(last_run_at,created_at,'') desc limit 30`, [String(user.user_id || '')])),
    ]);
  } else {
    submissions = await table('submissions').catch(() => []);
    candidates = await table('candidates').catch(() => []);
    interviews = await table('interviews').catch(() => []);
    reports = BASIC_CRM_MODE ? [] : await table('scheduled_reports').catch(() => []);
    tasks = await table('tasks').catch(() => []);
    notifications = BASIC_CRM_MODE ? [] : await table('notifications').catch(() => []);
  }
  const presence = BASIC_CRM_MODE ? null : await store.findById('presence', 'user_id', user.user_id).catch(() => null);
  const presenceInfo = reminderPresenceInfo(presence || {});
  const dueFollowups = (candidates || []).filter((row) => reminderFollowupDue(row)).filter((row) => reminderCandidateVisible(row, user));
  const todayFollowupSchedule = (candidates || []).filter((row) => reminderFollowupDue(row, true)).filter((row) => reminderCandidateVisible(row, user));

  const candidateById = new Map((candidates || []).map((row) => [String(row.candidate_id || '').trim(), row]));
  const latestReminderNotes = new Map(); // Hydrate only actionable reminders after filtering.

  const pendingSubmissionMap = new Map();
  (submissions || [])
    .map((row) => {
      const candidate = candidateById.get(String(row.candidate_id || '').trim()) || {};
      return {
        ...row,
        full_name: candidate.full_name || row.full_name || '',
        phone: candidate.phone || row.phone || '',
        recruiter_code: candidate.recruiter_code || row.recruiter_code || '',
        recruiter_name: candidate.recruiter_name || row.recruiter_name || '',
        status: candidate.status || row.status || '',
        all_details_sent: candidate.all_details_sent || row.all_details_sent || 'Pending',
        submission_date: candidate.submission_date || row.submission_date || '',
        // CC26_396: hydrate actual profile conversation notes into submission reminders.
        last_notes: latestReminderNotes.get(String(row.candidate_id || '').trim()) || candidate.last_notes || candidate.notes || candidate.note || candidate.data_notes || row.last_notes || row.notes || row.note || row.data_notes || row.reminder_note || '',
        notes: latestReminderNotes.get(String(row.candidate_id || '').trim()) || candidate.notes || candidate.last_notes || candidate.note || candidate.data_notes || row.notes || row.last_notes || row.note || row.data_notes || row.reminder_note || '',
        data_notes: candidate.data_notes || candidate.notes || candidate.last_notes || row.data_notes || row.notes || row.last_notes || '',
      };
    })
    .filter((row) => reminderPendingSubmission(row))
    .filter((row) => store.pool ? true : reminderCandidateVisible(row, user))
    .forEach((row) => {
      const candidateKey = String(row.candidate_id || row.submission_id || '').trim();
      if (!candidateKey) return;
      const current = pendingSubmissionMap.get(candidateKey);
      const rowStamp = reminderDateMs(row.updated_at || row.submitted_at || row.approval_requested_at || row.created_at || '');
      const currentStamp = reminderDateMs(current?.updated_at || current?.submitted_at || current?.approval_requested_at || current?.created_at || '');
      if (!current || rowStamp >= currentStamp) pendingSubmissionMap.set(candidateKey, row);
    });
  const pendingSubmissions = Array.from(pendingSubmissionMap.values());

  const interviewRows = [];
  for (const row of interviews || []) {
    const candidate = candidateById.get(String(row.candidate_id || '').trim()) || {};
    // Keep interview-table metadata, but candidate-edited interview dates must take effect immediately.
    interviewRows.push({
      ...candidate,
      ...row,
      interview_reschedule_date: candidate.interview_reschedule_date || row.interview_reschedule_date || '',
      interview_date: candidate.interview_date || row.interview_date || '',
      last_notes: latestReminderNotes.get(String(row.candidate_id || '').trim()) || candidate.last_notes || candidate.notes || candidate.data_notes || row.last_notes || row.notes || row.data_notes || '',
      notes: latestReminderNotes.get(String(row.candidate_id || '').trim()) || candidate.notes || candidate.last_notes || candidate.data_notes || row.notes || row.last_notes || row.data_notes || '',
    });
  }
  for (const row of candidates || []) {
    if (reminderInterviewStamp(row)) interviewRows.push(row);
  }
  const seenInterview = new Set();
  const todayInterviews = [];
  const pendingInterviews = [];
  const missedInterviews = [];
  const todayIstKey = reminderIstDateKey(now);
  for (const row of interviewRows) {
    if (!reminderPendingInterview(row) || !reminderCandidateVisible(row, user)) continue;
    const key = String(row.candidate_id || row.interview_id || row.phone || `${row.full_name || ''}:${reminderInterviewStamp(row)}`).trim();
    if (seenInterview.has(key)) continue;
    seenInterview.add(key);
    const t = reminderInterviewMs(row);
    if (!t || reminderIstDateKey(t) !== todayIstKey) continue; // interview reminder queue is TODAY (IST) only
    const hydrated = { ...row, __interview_ms: t, __reminder_trigger_ms: t };
    todayInterviews.push(hydrated);
    if (t < now) missedInterviews.push(hydrated);
    else pendingInterviews.push(hydrated);
  }

  // Notes are the largest reminder-only lookup in large CRMs. Never ask for notes
  // of every candidate: only candidates in today's visible pending reminder queue.
  const visibleReminderIds = Array.from(new Set([
    ...pendingSubmissions.map((row) => row.candidate_id),
    ...todayInterviews.map((row) => row.candidate_id),
    ...todayFollowupSchedule.map((row) => row.candidate_id),
  ].map((id) => String(id || '').trim()).filter(Boolean)));
  const selectedNotes = await reminderLatestNotesMap(visibleReminderIds);
  for (const row of [...pendingSubmissions, ...todayInterviews, ...todayFollowupSchedule]) {
    const latestNote = selectedNotes.get(String(row.candidate_id || '').trim());
    if (latestNote) { row.last_notes = latestNote; row.notes = latestNote; }
  }

  const dueTasks = (tasks || [])
    .filter((row) => reminderTaskDue(row))
    .filter((row) => reminderTaskVisible(row, user))
    .sort((a, b) => reminderDateMs(reminderTaskStamp(a)) - reminderDateMs(reminderTaskStamp(b)));
  const todayTaskSchedule = (tasks || [])
    .filter((row) => reminderTaskDue(row, true))
    .filter((row) => reminderTaskVisible(row, user))
    .sort((a, b) => reminderDateMs(reminderTaskStamp(a)) - reminderDateMs(reminderTaskStamp(b)));

  const dueNotifications = (notifications || [])
    .filter((row) => reminderNotificationDue(row, user))
    .sort((a, b) => reminderDateMs(a.created_at || a.updated_at) - reminderDateMs(b.created_at || b.updated_at));

  const userId = String(user.user_id || '').trim();
  const semiReports = (reports || [])
    .filter((row) => reminderLower(row.report_type) === 'semi-hourly')
    .filter((row) => !['archived','deleted','__deleted__'].includes(reminderLower(row.status || '')))
    .filter((row) => !String(row.user_id || '').trim() || String(row.user_id || '').trim() === userId || ['admin','manager'].includes(reminderRole(user)))
    .sort((a, b) => reminderDateMs(b.last_run_at || b.created_at || b.updated_at) - reminderDateMs(a.last_run_at || a.created_at || a.updated_at));
  const lastSemi = semiReports[0] || null;
  const lastSemiAt = reminderDateMs(lastSemi?.last_run_at || lastSemi?.created_at || lastSemi?.updated_at);
  const semiHourlyDue = !lastSemiAt || now - lastSemiAt >= 30 * 60 * 1000;

  const dailyReports = (reports || [])
    .filter((row) => reminderLower(row.report_type) === 'attendance-daily')
    .filter((row) => String(row.user_id || '').trim() === userId)
    .filter((row) => String(row.period_key || '').includes(new Date(now + 330 * 60 * 1000).toISOString().slice(0, 10)));
  const dailyReportSent = dailyReports.length > 0;

  res.set('Cache-Control', 'private, no-store');
  const payload = {
    ok: true,
    generated_at: nowIso(),
    low_egress: true,
    counts: {
      pending_submissions: pendingSubmissions.length,
      pending_interviews: pendingInterviews.length,
      missed_interviews: missedInterviews.length,
      due_followups: dueFollowups.length,
      due_tasks: dueTasks.length,
      unread_notifications: dueNotifications.length,
      break_minutes: presenceInfo.break_minutes,
      idle_minutes: presenceInfo.idle_minutes,
    },
    semi_hourly: {
      due: semiHourlyDue,
      last_report_at: lastSemiAt ? new Date(lastSemiAt).toISOString() : '',
      window_minutes: 30,
    },
    attendance: {
      joined_today: Boolean(presence?.work_started_at),
      on_break: presenceInfo.on_break,
      break_minutes: presenceInfo.break_minutes,
      idle_minutes: presenceInfo.idle_minutes,
      idle_warning_due: presenceInfo.idle_minutes >= 5,
    },
    daily_report: {
      sent_today: dailyReportSent,
      required_before_logout: ['recruiter','tl'].includes(reminderRole(user)),
    },
    actions: [
      ...pendingSubmissions.map((row, index) => ({
        key: `submission:${row.submission_id || row.candidate_id || index}`,
        type: 'submission',
        title: `Submission Reminder: ${reminderDisplayName(row)}`,
        message: reminderShortDetail(row) || 'Submission profile needs review.',
        open_path: row.candidate_id ? `/candidate/${encodeURIComponent(String(row.candidate_id))}` : reminderOpenSubmissionPath(row),
        due_at: reminderSafeDueAt(reminderSubmissionDueAt(row), now),
        repeat_minutes: 5,
        snooze_presets: [5, 15, 60, 180, 360],
        candidate_id: row.candidate_id || '',
        submission_id: row.submission_id || '',
        owner_label: [row.recruiter_name, row.recruiter_code].filter(Boolean).join(' • '),
        owner_is_self: candidateBelongsToUser(row, user),
      })),
      ...todayInterviews.map((row, index) => ({
        key: `interview:${row.interview_id || row.candidate_id || index}`,
        type: 'interview',
        title: `Interview Reminder: ${reminderDisplayName(row)}`,
        message: String(row.last_note || row.last_notes || row.notes || row.data_notes || `${reminderDisplayName(row)} interview is scheduled today.`),
        open_path: row.candidate_id ? `/candidate/${encodeURIComponent(String(row.candidate_id))}` : '/interviews',
        due_at: new Date(Number(row.__reminder_trigger_ms || now)).toISOString(),
        scheduled_at: new Date(Number(row.__interview_ms || now)).toISOString(),
        repeat_minutes: 5,
        snooze_presets: [5, 15, 60, 180, 360],
        allow_next_day_same_time: true,
        candidate_id: row.candidate_id || '',
        interview_id: row.interview_id || '',
        owner_label: [row.recruiter_name, row.recruiter_code].filter(Boolean).join(' • '),
        owner_is_self: candidateBelongsToUser(row, user),
      })),
      ...todayFollowupSchedule.map((row, index) => ({
        key: `followup:${row.candidate_id || row.phone || index}`,
        type: 'followups',
        title: `FollowUp Reminder: ${reminderDisplayName(row)}`,
        message: reminderShortDetail(row) || 'Follow-up profile is due.',
        open_path: '/followups',
        due_at: reminderSafeDueAt(row.next_follow_up_at || row.follow_up_at || row.followup_date || row.follow_up_date || row.callback_at, now),
        candidate_id: row.candidate_id || '',
        owner_label: [row.recruiter_name, row.recruiter_code].filter(Boolean).join(' • '),
        owner_is_self: candidateBelongsToUser(row, user),
      })),
      ...todayTaskSchedule.map((row, index) => ({
        key: `task:${row.task_id || index}`,
        type: 'task',
        title: `Task Reminder: ${row.title || 'Task'}`,
        message: row.description || `${row.title || 'Task'} is due.`,
        open_path: '/tasks',
        due_at: reminderSafeDueAt(reminderTaskStamp(row), now),
        task_id: row.task_id || '',
        owner_label: [row.assigned_to_name, row.assigned_to_code].filter(Boolean).join(' • '),
        owner_is_self: reminderTaskBelongsToSelf(row, user),
      })),
      ...dueNotifications.map((row, index) => ({
        key: `notification:${row.notification_id || index}`,
        type: 'notification',
        title: row.title || 'Notification',
        message: row.message || 'Notification needs review.',
        open_path: '/notifications',
        due_at: reminderSafeDueAt(row.created_at || row.updated_at, now),
        notification_id: row.notification_id || '',
      })),
      !BASIC_CRM_MODE && presenceInfo.joined_today && presenceInfo.on_break ? { key: 'break', type: 'break', title: 'Break Reminder', message: `Break is active for ${presenceInfo.break_minutes} minute(s). End break when work resumes.`, open_path: '/attendance', due_at: reminderSafeDueAt(presence?.break_started_at || now, now) } : null,
      (!BASIC_CRM_MODE && presenceInfo.joined_today && !presenceInfo.on_break && presenceInfo.idle_minutes >= 5) ? { key: 'idle', type: 'idle', title: 'Activity Reminder', message: 'No recent CRM activity was detected. Continue work to maintain active status.', open_path: '/attendance', due_at: new Date(now - presenceInfo.idle_minutes * 60 * 1000).toISOString() } : null,
      !BASIC_CRM_MODE && presenceInfo.joined_today && semiHourlyDue ? { key: 'semi_hourly', type: 'report', title: '30-Minute Report Ready', message: 'Current 30-minute performance report is due. Generate and review it now.', open_path: '/semi-hourly-report', due_at: new Date(lastSemiAt ? lastSemiAt + 30 * 60 * 1000 : now).toISOString() } : null,
    ].filter(Boolean).sort((a, b) => reminderDateMs(a.due_at) - reminderDateMs(b.due_at)),
  };
  if (cacheKey) {
    if (reminderSummaryCache.size >= 96) {
      for (const [key, value] of reminderSummaryCache) {
        if (now - value.at >= REMINDER_SUMMARY_CACHE_MS) reminderSummaryCache.delete(key);
      }
      if (reminderSummaryCache.size >= 96) reminderSummaryCache.delete(reminderSummaryCache.keys().next().value);
    }
    reminderSummaryCache.set(cacheKey, { at: now, payload });
  }
  return res.json(payload);
}

async function generate(req, res) {
  if (!isManager(req.user)) return res.status(403).json({ message: 'Only manager can generate or download reports.' });
  const payload = await writeReport(req.body || {}, req.user || null);
  return res.json(payload);
}


async function generateHold(req, res) {
  if (!isManager(req.user)) return res.status(403).json({ message: 'Only manager can generate hold reports.' });
  const payload = await writeHoldReport(req.body || {}, req.user || null);
  return res.json(payload);
}



// CC26_434: one central, egress-safe tracking hub. Summary is small and details load only on click.
const trackingHubCache = new Map();
const TRACKING_CACHE_MS = 15000;
const IST_OFFSET_MS_TRACKING = 330 * 60 * 1000;

function trackingIstDateKey(value = Date.now()) {
  const t = typeof value === 'number' ? value : toTimestamp(value);
  if (!t) return '';
  const d = new Date(t + IST_OFFSET_MS_TRACKING);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
}
function trackingUserContext(row = {}, usersById = new Map(), usersByName = new Map()) {
  const byId = usersById.get(String(row.employee_user_id || row.user_id || row.owner_user_id || row.assigned_user_id || row.submitted_by_user_id || '')) || {};
  const byName = usersByName.get(normalizeText(row.employee_name || row.employee_username || row.recruiter_name || row.username || row.submitted_by_name || '')) || {};
  const user = Object.keys(byId).length ? byId : byName;
  return {
    user_id: pickFirst(row.employee_user_id, row.user_id, row.owner_user_id, row.assigned_user_id, row.submitted_by_user_id, user.user_id),
    recruiter_code: pickFirst(row.recruiter_code, row.submitted_by_recruiter_code, user.recruiter_code),
    recruiter_name: pickFirst(row.employee_name, row.recruiter_name, row.submitted_by_name, user.full_name, row.employee_username, row.username),
  };
}
function trackingCandidateContext(row = {}, candidatesById = new Map(), candidatesByPhone = new Map()) {
  const cid = String(row.candidate_id || row.current_candidate_id || '').trim();
  const phone = normalizePhone(row.phone || row.number || row.mobile || row.candidate_phone || '');
  const byId = cid ? (candidatesById.get(cid) || {}) : {};
  const byPhone = phone ? (candidatesByPhone.get(phone.slice(-10)) || {}) : {};
  const candidate = Object.keys(byId).length ? byId : byPhone;
  return {
    candidate,
    candidate_id: pickFirst(cid, candidate.candidate_id),
    candidate_name: pickFirst(row.candidate_name, candidate.full_name, candidate.candidate_name),
    phone: pickFirst(phone ? phone.slice(-10) : '', normalizePhone(candidate.phone || candidate.number || candidate.mobile || '').slice(-10)),
    sr_no: pickFirst(candidate.source_sr_no, candidate.profile_number, candidate.profile_no, row.profile_number, row.source_sr_no),
  };
}
function trackingCallDirection(row = {}) {
  return callMetricForRow(row).incoming_calls_count > 0 ? 'Incoming' : 'Outgoing';
}
function trackingCallStamp(row = {}) { return pickFirst(row.call_started_at, row.created_at, row.updated_at); }
function trackingCallKey(row = {}, ctx = {}) {
  return String(row.call_log_id || '').trim() || `${ctx.user_id || ctx.recruiter_code}|${ctx.phone || ''}|${trackingCallStamp(row)}|${trackingCallDirection(row)}`;
}
function trackingInRange(stamp, fromTs, toTs) {
  const t = toTimestamp(stamp);
  if (!t) return false;
  if (fromTs && t < fromTs) return false;
  if (toTs && t > toTs) return false;
  return true;
}
function trackingTerminalStatus(row = {}) {
  const s = normalizeText(`${row.status || ''} ${row.stage || ''} ${row.interview_status || ''} ${row.follow_up_status || ''}`);
  return ['selected','joined','rejected','completed','done','closed','cancelled','canceled','not interested','not intrested'].some((x) => s.includes(x));
}
function trackingIncomplete(row = {}, candidate = {}) {
  const v = normalizeText(pickFirst(row.all_details_sent, candidate.all_details_sent));
  return !['all details sent complete','complete','completed','done','yes'].includes(v);
}
function trackingInterviewStamp(row = {}, candidate = {}) {
  return pickFirst(row.interview_reschedule_date, candidate.interview_reschedule_date, row.scheduled_at, row.interview_date, candidate.interview_date, row.created_at);
}
function trackingWorkRowFromSnapshot(report = {}) {
  const snap = parseJsonSafe(report.snapshot_json);
  if (!snap || typeof snap !== 'object') return null;
  const employee = snap.employee || {};
  const summary = snap.summary || {};
  const date = String(snap.work_date || report.period_key || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] || trackingIstDateKey(report.last_run_at || report.created_at);
  if (!date) return null;
  return {
    date,
    user_id: employee.user_id || report.user_id || '',
    recruiter_code: employee.recruiter_code || '',
    recruiter_name: employee.full_name || employee.username || '',
    login_at: summary.joined_at || summary.login_at || '',
    logout_at: summary.logout_at || report.last_run_at || '',
    active_minutes: Number(summary.productive_work_minutes || summary.active_work_minutes || 0) || 0,
    break_minutes: Number(summary.total_break_minutes || 0) || 0,
    idle_minutes: Number(summary.idle_minutes || 0) || 0,
    remaining_minutes: Number(summary.remaining_work_minutes || 0) || 0,
    calls: Number(summary.calls_count || 0) || 0,
    submissions: Number(summary.submissions_count || 0) || 0,
    interviews: Number(summary.interviews_count || 0) || 0,
    selections: Number(summary.selections_count || 0) || 0,
    joinings: Number(summary.joinings_count || 0) || 0,
    source: 'daily_attendance_report',
  };
}
function trackingFormatDetailTime(stamp) { return toIsoDisplay(stamp); }

async function buildTrackingHubData(query = {}, includeDetailsMetric = '') {
  const recruiterCode = String(query.recruiter_code || 'all').trim() || 'all';
  const fromTs = toTimestamp(query.from || '') || 0;
  const toTs = toTimestamp(query.to || '') || Date.now();
  const source = await loadSourceData();
  const usersById = new Map(source.users.map((u) => [String(u.user_id || ''), u]));
  const usersByName = new Map();
  source.users.forEach((u) => {
    [u.full_name, u.username, u.recruiter_code].map(normalizeText).filter(Boolean).forEach((k) => usersByName.set(k, u));
  });
  const candidatesById = new Map(source.candidates.map((c) => [String(c.candidate_id || ''), c]));
  const candidatesByPhone = new Map();
  source.candidates.forEach((c) => {
    const p = normalizePhone(c.phone || c.number || c.mobile || c.candidate_phone || '').slice(-10);
    if (p) candidatesByPhone.set(p, c);
  });

  const allTrackedCalls = [];
  const seenCallKeys = new Set();
  for (const row of dedupeCallRows(source.callLogs || [])) {
    const userCtx = trackingUserContext(row, usersById, usersByName);
    const candCtx = trackingCandidateContext(row, candidatesById, candidatesByPhone);
    if (!candCtx.candidate_id && !candCtx.phone) continue;
    // Only CRM candidate calls: candidate id is active OR current phone matches an active CRM profile.
    const matched = (candCtx.candidate_id && candidatesById.has(String(candCtx.candidate_id))) || (candCtx.phone && candidatesByPhone.has(String(candCtx.phone).slice(-10)));
    if (!matched) continue;
    if (!recruiterMatches({ ...userCtx, ...row }, recruiterCode)) continue;
    const key = trackingCallKey(row, { ...userCtx, ...candCtx });
    if (seenCallKeys.has(key)) continue;
    seenCallKeys.add(key);
    const metric = callMetricForRow(row);
    allTrackedCalls.push({ row, ...userCtx, ...candCtx, key, metric, stamp: trackingCallStamp(row), direction: trackingCallDirection(row) });
  }
  allTrackedCalls.sort((a,b) => toTimestamp(a.stamp) - toTimestamp(b.stamp));
  const rangeCalls = allTrackedCalls.filter((x) => trackingInRange(x.stamp, fromTs, toTs));
  const firstSeen = new Map();
  for (const c of allTrackedCalls) {
    const identity = c.candidate_id ? `id:${c.candidate_id}` : `phone:${c.phone}`;
    if (!identity || firstSeen.has(identity)) continue;
    firstSeen.set(identity, toTimestamp(c.stamp));
  }
  const uniqueRange = new Set(rangeCalls.map((c) => c.candidate_id ? `id:${c.candidate_id}` : `phone:${c.phone}`).filter(Boolean));
  const firstTimeRange = rangeCalls.filter((c) => {
    const id = c.candidate_id ? `id:${c.candidate_id}` : `phone:${c.phone}`;
    return id && firstSeen.get(id) === toTimestamp(c.stamp);
  });
  const callSummary = rangeCalls.reduce((acc, c) => {
    acc.total += 1;
    if (c.direction === 'Incoming') acc.incoming += 1; else acc.outgoing += 1;
    const talk = Number(c.metric?.talktime_seconds || 0) || 0;
    acc.talk_seconds += talk;
    if (c.direction === 'Incoming') acc.incoming_talk_seconds += talk; else acc.outgoing_talk_seconds += talk;
    return acc;
  }, { total:0, outgoing:0, incoming:0, unique:uniqueRange.size, first_time:firstTimeRange.length, talk_seconds:0, outgoing_talk_seconds:0, incoming_talk_seconds:0 });

  const datasetsAll = buildDatasets(source, recruiterCode);
  const datasetsRange = filterDatasetsByRange(datasetsAll, fromTs, toTs);
  const submissionsRange = datasetsRange.submissions || [];
  const interviewsRange = datasetsRange.interviews || [];
  const selectionsRange = datasetsRange.selections || [];
  const joiningsRange = datasetsRange.joining || [];
  const allSubmissions = datasetsAll.submissions || [];
  const allInterviews = datasetsAll.interviews || [];
  const allSelections = datasetsAll.selections || [];
  const allJoinings = datasetsAll.joining || [];

  const candidateCallIdentity = new Set(rangeCalls.flatMap((c) => [c.candidate_id ? `id:${c.candidate_id}` : '', c.phone ? `phone:${c.phone}` : '']).filter(Boolean));
  const incompleteSubmissions = allSubmissions.filter((s) => {
    const candidate = candidatesById.get(String(s.candidate_id || '')) || {};
    return recruiterMatches({ ...candidate, ...s }, recruiterCode) && trackingIncomplete(s, candidate);
  });
  const now = Date.now();
  const overdueInterviews = [];
  const pendingInterviews = [];
  const interviewNotCalled = [];
  const interviewSeen = new Set();
  const combinedInterviews = [...source.interviews];
  for (const c of source.candidates) {
    if (c.interview_reschedule_date || c.interview_date || normalizeText(c.status).includes('interview')) combinedInterviews.push({ candidate_id: c.candidate_id, ...c });
  }
  for (const row of combinedInterviews) {
    const candidate = candidatesById.get(String(row.candidate_id || '')) || row || {};
    if (!recruiterMatches({ ...candidate, ...row }, recruiterCode)) continue;
    const stamp = trackingInterviewStamp(row, candidate);
    const t = toTimestamp(stamp);
    if (!t) continue;
    const id = String(row.interview_id || row.candidate_id || `${candidate.full_name}:${stamp}`);
    if (interviewSeen.has(id)) continue;
    interviewSeen.add(id);
    if (!trackingTerminalStatus({ ...candidate, ...row })) {
      if (t < now) overdueInterviews.push({ ...row, candidate, stamp });
      else pendingInterviews.push({ ...row, candidate, stamp });
    }
    if (trackingInRange(stamp, fromTs, toTs)) {
      const phone = normalizePhone(candidate.phone || candidate.number || '').slice(-10);
      const called = candidateCallIdentity.has(`id:${row.candidate_id || candidate.candidate_id}`) || (phone && candidateCallIdentity.has(`phone:${phone}`));
      if (!called) interviewNotCalled.push({ ...row, candidate, stamp });
    }
  }
  const pendingFollowups = source.candidates.filter((c) => {
    if (!recruiterMatches(c, recruiterCode) || trackingTerminalStatus(c)) return false;
    const t = toTimestamp(c.follow_up_at || c.next_follow_up_at || c.followup_date || '');
    return t && t <= now;
  });

  // Work rows: historical daily snapshots + current live presence. Current day wins over a sent snapshot.
  const workMap = new Map();
  for (const report of source.scheduledReports || []) {
    if (normalizeText(report.report_type) !== 'attendance-daily') continue;
    const wr = trackingWorkRowFromSnapshot(report);
    if (!wr || !recruiterMatches(wr, recruiterCode)) continue;
    const dayStamp = Date.parse(`${wr.date}T12:00:00+05:30`);
    if ((fromTs && dayStamp < fromTs - 12*3600000) || (toTs && dayStamp > toTs + 12*3600000)) continue;
    workMap.set(`${wr.date}|${wr.user_id || wr.recruiter_code || wr.recruiter_name}`, wr);
  }
  const todayKey = trackingIstDateKey(Date.now());
  if ((!fromTs || Date.parse(`${todayKey}T23:59:59+05:30`) >= fromTs) && (!toTs || Date.parse(`${todayKey}T00:00:00+05:30`) <= toTs)) {
    for (const p of source.presence || []) {
      const user = usersById.get(String(p.user_id || '')) || {};
      const ctx = { user_id:p.user_id || '', recruiter_code:user.recruiter_code || '', recruiter_name:user.full_name || user.username || p.user_id || '' };
      if (!recruiterMatches(ctx, recruiterCode)) continue;
      const start = toTimestamp(p.work_started_at || '');
      if (!start || trackingIstDateKey(start) !== todayKey) continue;
      const live = presenceMinutes(p);
      const session = Number(live.session_minutes || 0) || 0;
      const breakMinutes = Number(live.total_break_minutes || 0) || 0;
      const active = Math.max(0, Math.min(Math.max(0, session - breakMinutes), Number(live.productive_work_minutes || 0) || 0));
      const idle = Math.max(0, Math.min(session, Number(live.idle_minutes || 0) || 0));
      workMap.set(`${todayKey}|${ctx.user_id || ctx.recruiter_code}`, {
        date:todayKey, ...ctx, login_at:p.work_started_at || '', logout_at:'', active_minutes:active, break_minutes:breakMinutes, idle_minutes:idle,
        remaining_minutes:Math.max(540-active,0), source:'live_presence'
      });
    }
  }
  const workRows = Array.from(workMap.values());

  const relevantActivity = (source.activityLog || []).filter((a) => {
    const ctx = trackingUserContext(a, usersById, usersByName);
    return recruiterMatches({ ...ctx, ...a }, recruiterCode) && trackingInRange(a.created_at, fromTs, toTs);
  }).sort((a,b) => toTimestamp(a.created_at)-toTimestamp(b.created_at));
  const lockEvents = relevantActivity.filter((a) => ['crm_locked','break_exceeded_lock','no_call_lock'].includes(normalizeText(a.action_type)));
  const loginEvents = relevantActivity.filter((a) => ['join_work','login','user_login','session_login'].includes(normalizeText(a.action_type)));
  const logoutEvents = relevantActivity.filter((a) => ['logout','user_logout','session_end','session_logout'].includes(normalizeText(a.action_type)));

  // Pair breaks from the full event stream, then clip each break to the requested range.
  // This prevents a break that started just before `from` and ended inside the range from disappearing.
  const breakEvents = (source.activityLog || []).filter((a) => {
    const type = normalizeText(a.action_type);
    if (!['break_started','break_ended'].includes(type)) return false;
    const ctx = trackingUserContext(a, usersById, usersByName);
    if (!recruiterMatches({ ...ctx, ...a }, recruiterCode)) return false;
    const t = toTimestamp(a.created_at);
    return t && (!toTs || t <= toTs);
  }).sort((a,b) => toTimestamp(a.created_at)-toTimestamp(b.created_at));
  const breakRows = [];
  const openBreak = new Map();
  const pushClippedBreak = (startEvent, endEvent, ctx) => {
    const actualFrom = toTimestamp(startEvent?.created_at);
    const actualTo = endEvent ? toTimestamp(endEvent.created_at) : Math.min(Date.now(), toTs || Date.now());
    if (!actualFrom || !actualTo || actualTo < actualFrom) return;
    const clippedFrom = Math.max(actualFrom, fromTs || actualFrom);
    const clippedTo = Math.min(actualTo, toTs || actualTo);
    if (clippedTo < clippedFrom) return;
    const meta = parseJsonSafe(startEvent.metadata);
    breakRows.push({
      ...ctx,
      break_start: new Date(clippedFrom).toISOString(),
      break_end: endEvent ? new Date(clippedTo).toISOString() : '',
      minutes: Math.max(0, Math.round((clippedTo-clippedFrom)/60000)),
      reason: meta.reason || startEvent.reason || 'Break',
      actual_break_start: startEvent.created_at,
      actual_break_end: endEvent?.created_at || '',
    });
  };
  for (const e of breakEvents) {
    const ctx = trackingUserContext(e, usersById, usersByName);
    const key = ctx.user_id || ctx.recruiter_code || normalizeText(ctx.recruiter_name);
    const type = normalizeText(e.action_type);
    if (type === 'break_started') {
      // If duplicate start events arrive, keep the newest open start rather than double-counting.
      openBreak.set(key, { event:e, ctx });
    } else if (type === 'break_ended') {
      const start = openBreak.get(key);
      if (!start) continue;
      pushClippedBreak(start.event, e, ctx);
      openBreak.delete(key);
    }
  }
  for (const {event,ctx} of openBreak.values()) pushClippedBreak(event, null, ctx);

  const aggregateWork = workRows.reduce((a,r)=>{a.active_minutes+=Number(r.active_minutes||0);a.break_minutes+=Number(r.break_minutes||0);a.idle_minutes+=Number(r.idle_minutes||0);a.remaining_minutes+=Number(r.remaining_minutes||0);return a;},{active_minutes:0,break_minutes:0,idle_minutes:0,remaining_minutes:0});
  aggregateWork.lock_count = lockEvents.length;
  aggregateWork.sessions = workRows.length;

  const recruiterMap = new Map();
  function recRow(ctx={}) {
    const key = String(ctx.recruiter_code || ctx.user_id || normalizeText(ctx.recruiter_name) || 'unassigned');
    if (!recruiterMap.has(key)) recruiterMap.set(key,{recruiter_code:ctx.recruiter_code||'',recruiter_name:ctx.recruiter_name||'Unassigned',calls:0,talk_seconds:0,submissions:0,interviews:0,selections:0,joinings:0,active_minutes:0,break_minutes:0,idle_minutes:0,lock_count:0,login_at:'',logout_at:''});
    return recruiterMap.get(key);
  }
  rangeCalls.forEach((c)=>{const r=recRow(c);r.calls++;r.talk_seconds+=Number(c.metric?.talktime_seconds||0)||0;});
  submissionsRange.forEach((x)=>recRow({recruiter_code:x.recruiter_code,recruiter_name:x.recruiter_name}).submissions++);
  interviewsRange.forEach((x)=>recRow({recruiter_code:x.recruiter_code,recruiter_name:x.recruiter_name}).interviews++);
  selectionsRange.forEach((x)=>recRow({recruiter_code:x.recruiter_code,recruiter_name:x.recruiter_name}).selections++);
  joiningsRange.forEach((x)=>recRow({recruiter_code:x.recruiter_code,recruiter_name:x.recruiter_name}).joinings++);
  workRows.forEach((x)=>{const r=recRow(x);r.active_minutes+=Number(x.active_minutes||0);r.break_minutes+=Number(x.break_minutes||0);r.idle_minutes+=Number(x.idle_minutes||0);if(x.login_at&&(!r.login_at||String(x.login_at)<String(r.login_at)))r.login_at=x.login_at;if(x.logout_at&&String(x.logout_at)>String(r.logout_at))r.logout_at=x.logout_at;});
  lockEvents.forEach((x)=>{const ctx=trackingUserContext(x,usersById,usersByName);recRow(ctx).lock_count++;});
  loginEvents.forEach((x)=>{const ctx=trackingUserContext(x,usersById,usersByName);const r=recRow(ctx);if(!r.login_at||String(x.created_at)<String(r.login_at))r.login_at=x.created_at;});
  logoutEvents.forEach((x)=>{const ctx=trackingUserContext(x,usersById,usersByName);const r=recRow(ctx);if(!r.logout_at||String(x.created_at)>String(r.logout_at))r.logout_at=x.created_at;});

  const summary = {
    calls: { ...callSummary },
    performance: {
      submissions: submissionsRange.length, submissions_all_time: allSubmissions.length,
      interviews: interviewsRange.length, interviews_all_time: allInterviews.length,
      selections: selectionsRange.length, selections_all_time: allSelections.length,
      joinings: joiningsRange.length, joinings_all_time: allJoinings.length,
      incomplete_submissions: incompleteSubmissions.length,
      overdue_interviews: overdueInterviews.length,
    },
    work: aggregateWork,
    pending: {
      incomplete_submissions: incompleteSubmissions.length,
      overdue_interviews: overdueInterviews.length,
      interview_not_called: interviewNotCalled.length,
      pending_followups: pendingFollowups.length,
      pending_interviews: pendingInterviews.length,
    },
  };

  if (!includeDetailsMetric) {
    return {
      ok:true,
      generated_at:nowIso(),
      timezone:'Asia/Kolkata',
      range:{from:query.from||'',to:query.to||'',recruiter_code:recruiterCode},
      summary,
      recruiters:Array.from(recruiterMap.values()).sort((a,b)=>String(a.recruiter_name).localeCompare(String(b.recruiter_name))),
      recruiter_options: source.users.filter((u)=>String(u.recruiter_code||'').trim()).map((u)=>({user_id:u.user_id,recruiter_code:u.recruiter_code,full_name:u.full_name||u.username,role:u.role})).sort((a,b)=>String(a.full_name).localeCompare(String(b.full_name))),
      egress_note:'Summary only. Detail rows load on card click; no automatic polling.',
    };
  }

  const callDetail = (calls) => calls.slice().sort((a,b)=>toTimestamp(b.stamp)-toTimestamp(a.stamp)).slice(0,500).map((c,i)=>({
    sr_no:i+1,timestamp:trackingFormatDetailTime(c.stamp),recruiter:c.recruiter_name||c.recruiter_code,candidate:c.candidate_name||'',candidate_id:c.candidate_id||'',profile_sr_no:c.sr_no||'',phone:c.phone||'',direction:c.direction,status:c.row.status||'',talk_seconds:Number(c.metric?.talktime_seconds||0)||0,call_log_id:c.row.call_log_id||''
  }));
  const genericCandidateRows = (rows, stampFn) => rows.slice(0,500).map((x,i)=>{
    const candidate=x.candidate||candidatesById.get(String(x.candidate_id||''))||{};
    return {sr_no:i+1,timestamp:trackingFormatDetailTime(stampFn(x,candidate)),recruiter:pickFirst(x.recruiter_name,candidate.recruiter_name),candidate:pickFirst(x.candidate_name,candidate.full_name),candidate_id:pickFirst(x.candidate_id,candidate.candidate_id),profile_sr_no:pickFirst(candidate.source_sr_no,candidate.profile_number),phone:normalizePhone(candidate.phone||candidate.number||'').slice(-10),status:pickFirst(x.status,candidate.status),process:pickFirst(x.process,candidate.process)};
  });
  let items=[];
  switch (includeDetailsMetric) {
    case 'call_total': items=callDetail(rangeCalls); break;
    case 'call_outgoing': items=callDetail(rangeCalls.filter((c)=>c.direction==='Outgoing')); break;
    case 'call_incoming': items=callDetail(rangeCalls.filter((c)=>c.direction==='Incoming')); break;
    case 'call_unique': { const seen=new Set();items=callDetail(rangeCalls.filter((c)=>{const k=c.candidate_id||c.phone;if(!k||seen.has(k))return false;seen.add(k);return true;})); break; }
    case 'call_first_time': items=callDetail(firstTimeRange); break;
    case 'performance_submissions': items=genericCandidateRows(submissionsRange,(x)=>x.range_date||x.submitted_at); break;
    case 'performance_interviews': items=genericCandidateRows(interviewsRange,(x)=>x.range_date||x.scheduled_at); break;
    case 'performance_selections': items=genericCandidateRows(selectionsRange,(x)=>x.range_date||x.selection_date); break;
    case 'performance_joinings': items=genericCandidateRows(joiningsRange,(x)=>x.range_date||x.joining_date||x.joined_date); break;
    case 'pending_incomplete_submissions': items=genericCandidateRows(incompleteSubmissions,(x,c)=>x.submitted_at||x.range_date||c.submission_date); break;
    case 'pending_overdue_interviews': items=genericCandidateRows(overdueInterviews,(x)=>x.stamp); break;
    case 'pending_interview_not_called': items=genericCandidateRows(interviewNotCalled,(x)=>x.stamp); break;
    case 'pending_followups': items=genericCandidateRows(pendingFollowups,(x)=>x.follow_up_at||x.next_follow_up_at); break;
    case 'pending_interviews': items=genericCandidateRows(pendingInterviews,(x)=>x.stamp); break;
    case 'work_breaks': items=breakRows.slice().sort((a,b)=>toTimestamp(b.break_start)-toTimestamp(a.break_start)).slice(0,500).map((x,i)=>({sr_no:i+1,timestamp:trackingFormatDetailTime(x.break_start),recruiter:x.recruiter_name||x.recruiter_code,break_start:trackingFormatDetailTime(x.break_start),break_end:trackingFormatDetailTime(x.break_end),minutes:x.minutes,reason:x.reason})); break;
    case 'work_locks': items=lockEvents.slice().sort((a,b)=>toTimestamp(b.created_at)-toTimestamp(a.created_at)).slice(0,500).map((x,i)=>{const ctx=trackingUserContext(x,usersById,usersByName);const meta=parseJsonSafe(x.metadata);return {sr_no:i+1,timestamp:trackingFormatDetailTime(x.created_at),recruiter:ctx.recruiter_name||ctx.recruiter_code,reason:pickFirst(meta.reason,x.reason,x.action_type),idle_minutes:meta.idle_minutes||'',page:meta.page||''};}); break;
    case 'work_sessions': items=workRows.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,500).map((x,i)=>({sr_no:i+1,date:x.date,recruiter:x.recruiter_name||x.recruiter_code,login_at:trackingFormatDetailTime(x.login_at),logout_at:trackingFormatDetailTime(x.logout_at),active_minutes:x.active_minutes,break_minutes:x.break_minutes,idle_minutes:x.idle_minutes,remaining_minutes:x.remaining_minutes})); break;
    default: items=[];
  }
  return {ok:true,metric:includeDetailsMetric,count:items.length,items,timezone:'Asia/Kolkata',generated_at:nowIso()};
}

async function trackingHub(req, res) {
  const callRevision = Number(getCallChangeSnapshot().revision || 0);
  const key = JSON.stringify({from:req.query?.from||'',to:req.query?.to||'',recruiter_code:req.query?.recruiter_code||'all',call_revision:callRevision});
  const hit = trackingHubCache.get(key);
  if (hit && Date.now()-hit.at < TRACKING_CACHE_MS) return res.json(hit.data);
  const data = await buildTrackingHubData(req.query || {}, '');
  const payload = { ...data, call_revision: callRevision };
  trackingHubCache.set(key,{at:Date.now(),data:payload});
  if (trackingHubCache.size > 20) trackingHubCache.delete(trackingHubCache.keys().next().value);
  return res.json(payload);
}

async function trackingDetails(req, res) {
  const metric = String(req.query?.metric || '').trim();
  if (!metric) return res.status(400).json({message:'metric required'});
  return res.json(await buildTrackingHubData(req.query || {}, metric));
}


module.exports = {
  list,
  reminderSummary,
  attendanceReports,
  exportAttendanceReports,
  generate,
  generateHold,
  trackingHub,
  trackingDetails,
};
