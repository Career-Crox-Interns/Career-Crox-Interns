const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { GENERATED_DIR } = require('../config/env');
const { store, table } = require('../lib/store');
const { nextId, nowIso } = require('../lib/helpers');

const CATEGORY_CONFIG = [
  { key: 'submissions', label: 'Submissions', table_name: 'submissions' },
  { key: 'interviews', label: 'Interviews', table_name: 'interviews' },
  { key: 'calls', label: 'Calls', table_name: 'activity_log' },
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
  const workStarted = toTimestamp(row?.work_started_at);
  const now = Date.now();
  const sessionMinutes = workStarted ? Math.max(0, Math.round((now - workStarted) / 60000)) : 0;
  const breakMinutes = Number(row?.total_break_minutes || 0);
  const productiveMinutes = Math.max(sessionMinutes - breakMinutes, 0);
  return {
    session_minutes: String(sessionMinutes),
    total_work_minutes: String(sessionMinutes),
    total_break_minutes: String(breakMinutes),
    productive_work_minutes: String(productiveMinutes),
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
  const [users, candidates, submissions, interviews, activityLog, presence, revenueHubEntries, scheduledReports] = await Promise.all([
    table('users'),
    table('candidates'),
    table('submissions'),
    table('interviews'),
    table('activity_log'),
    table('presence'),
    table('revenue_hub_entries'),
    table('scheduled_reports'),
  ]);
  return { users, candidates, submissions, interviews, activityLog, presence, revenueHubEntries, scheduledReports };
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

    calls: buildCallsRows(source.activityLog, usersById, recruiterCode),

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
  for (const row of filtered.calls || []) addHoldMetric(summaryMap, row, 'calls_dialed', usersById, usersByName);
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
    ...(filtered.calls || []).map((row) => ({ metric: 'Call Dialed', candidate_id: row.candidate_id, candidate_name: '', recruiter_code: row.recruiter_code, recruiter_name: row.recruiter_name, date_time: row.range_date || row.created_at, status: row.action_type || '', process: '' })),
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
  const items = (await table('scheduled_reports'))
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

module.exports = {
  list,
  generate,
  generateHold,
};
