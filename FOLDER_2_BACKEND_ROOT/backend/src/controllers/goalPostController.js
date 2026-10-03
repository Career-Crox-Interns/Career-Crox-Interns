const { nowIso, nextId, splitCsvValues } = require('../lib/helpers');
const { table, store } = require('../lib/store');

const INDIA_TZ = 'Asia/Kolkata';
const METRICS = ['submission', 'interview', 'selection', 'joining'];
const LEADERSHIP_ROLES = new Set(['admin', 'manager', 'tl']);

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function safeNumber(value) {
  if (value === '' || value === null || value === undefined) return '';
  const cleaned = String(value).replace(/[^\d.-]/g, '');
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) return '';
  return Math.max(0, Math.round(numeric));
}

function numberOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function sumMetric(record, suffix) {
  return METRICS.reduce((total, metric) => total + numberOrZero(record[`${metric}_${suffix}`]), 0);
}

function istParts(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: INDIA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const map = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: Number(map.hour || 0),
    minute: Number(map.minute || 0),
    second: Number(map.second || 0),
    weekday: map.weekday || '',
  };
}

function istToday() {
  const parts = istParts(new Date());
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateOnly(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const matched = raw.match(/^\d{4}-\d{2}-\d{2}/);
  if (matched) return matched[0];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  const parts = istParts(parsed);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseDateOnly(value) {
  const text = dateOnly(value);
  if (!text) return null;
  const [year, month, day] = text.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(dateText, days) {
  const parsed = parseDateOnly(dateText);
  if (!parsed) return dateText;
  parsed.setUTCDate(parsed.getUTCDate() + Number(days || 0));
  return parsed.toISOString().slice(0, 10);
}

function diffDays(startText, endText) {
  const start = parseDateOnly(startText);
  const end = parseDateOnly(endText);
  if (!start || !end) return 0;
  const ms = end.getTime() - start.getTime();
  return Math.max(0, Math.round(ms / 86400000));
}

function dateRange(startText, endText) {
  const days = diffDays(startText, endText);
  return Array.from({ length: days + 1 }, (_, index) => addDays(startText, index));
}

function startOfWeek(dateText) {
  const parsed = parseDateOnly(dateText);
  if (!parsed) return dateText;
  const day = parsed.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return parsed.toISOString().slice(0, 10);
}

function startOfMonth(dateText) {
  const parsed = parseDateOnly(dateText);
  if (!parsed) return dateText;
  parsed.setUTCDate(1);
  return parsed.toISOString().slice(0, 10);
}

function normalizePeriod(value) {
  const option = lower(value);
  if (option === 'weekly') return 'weekly';
  if (option === 'monthly') return 'monthly';
  return 'daily';
}

function defaultWindow(period) {
  const today = istToday();
  if (period === 'monthly') return { start: addDays(today, -89), end: today };
  if (period === 'weekly') return { start: addDays(today, -27), end: today };
  return { start: addDays(today, -6), end: today };
}

function isLeadership(user) {
  return LEADERSHIP_ROLES.has(lower(user?.role));
}

function matchRecruiterCode(sourceValue, recruiterCode) {
  const target = lower(recruiterCode);
  if (!target) return false;
  return splitCsvValues(sourceValue).some((value) => lower(value) === target);
}

function userOwnsCandidate(candidate, user) {
  if (!candidate || !user) return false;
  if (String(candidate.user_id || '') === String(user.user_id || '')) return true;
  if (lower(candidate.recruiter_name) === lower(user.full_name)) return true;
  if (lower(candidate.submitted_by) === lower(user.full_name)) return true;
  if (matchRecruiterCode(candidate.recruiter_code, user.recruiter_code)) return true;
  return false;
}

function userOwnsSubmission(entry, user, candidateMap) {
  const candidate = candidateMap.get(String(entry?.candidate_id || ''));
  if (userOwnsCandidate(candidate, user)) return true;
  if (matchRecruiterCode(entry?.recruiter_code, user?.recruiter_code)) return true;
  return false;
}

function userOwnsRevenue(entry, user) {
  if (!entry || !user) return false;
  if (matchRecruiterCode(entry.recruiter_code, user.recruiter_code)) return true;
  if (lower(entry.recruiter_name) === lower(user.full_name)) return true;
  if (String(entry.created_by_user_id || '') === String(user.user_id || '')) return true;
  return false;
}

function findUser(users, userId) {
  return users.find((item) => String(item.user_id) === String(userId)) || null;
}

async function readGoalPostRows() {
  try {
    return { rows: await table('goal_post_targets'), storageReady: true };
  } catch (error) {
    return { rows: [], storageReady: false, storageMessage: 'Goal Post table is missing in database. Run the new Supabase SQL file before using this module on live data.' };
  }
}

async function getContext() {
  const [users, candidates, submissions, interviews, revenueEntries, notifications] = await Promise.all([
    table('users'),
    table('candidates'),
    table('submissions'),
    table('interviews'),
    table('revenue_hub_entries').catch(() => []),
    table('notifications').catch(() => []),
  ]);
  const candidateMap = new Map(candidates.map((item) => [String(item.candidate_id), item]));
  return { users, candidates, submissions, interviews, revenueEntries, notifications, candidateMap };
}

function autoCountsForDate(dateText, user, context) {
  const day = dateOnly(dateText);
  const counts = {
    submission_auto: 0,
    interview_auto: 0,
    selection_auto: 0,
    joining_auto: 0,
  };

  for (const entry of context.submissions) {
    if (dateOnly(entry.submitted_at) !== day) continue;
    if (userOwnsSubmission(entry, user, context.candidateMap)) counts.submission_auto += 1;
  }

  const interviewSeen = new Set();
  for (const entry of context.interviews) {
    const candidate = context.candidateMap.get(String(entry.candidate_id || ''));
    if (!userOwnsCandidate(candidate, user)) continue;
    if (dateOnly(entry.scheduled_at || entry.interview_reschedule_date || entry.interview_date) !== day) continue;
    const key = String(entry.interview_id || `${entry.candidate_id}:${entry.scheduled_at || entry.interview_reschedule_date || entry.interview_date}`);
    if (interviewSeen.has(key)) continue;
    interviewSeen.add(key);
    counts.interview_auto += 1;
  }

  const selectionSeen = new Set();
  const joiningSeen = new Set();
  for (const entry of context.revenueEntries) {
    if (!userOwnsRevenue(entry, user)) continue;
    const selectionDate = dateOnly(entry.selection_date || (lower(entry.status) === 'selected' ? entry.updated_at : ''));
    if (selectionDate === day) {
      const key = String(entry.revenue_id || entry.candidate_id || Math.random());
      if (!selectionSeen.has(key)) {
        selectionSeen.add(key);
        counts.selection_auto += 1;
      }
    }
    const joiningDate = dateOnly(entry.joined_date || entry.joining_date || (lower(entry.status) === 'joined' ? entry.updated_at : ''));
    if (joiningDate === day) {
      const key = String(entry.revenue_id || entry.candidate_id || Math.random());
      if (!joiningSeen.has(key)) {
        joiningSeen.add(key);
        counts.joining_auto += 1;
      }
    }
  }

  if (!counts.selection_auto || !counts.joining_auto) {
    for (const candidate of context.candidates) {
      if (!userOwnsCandidate(candidate, user)) continue;
      const status = lower(candidate.status);
      const approval = lower(candidate.approval_status);
      const updated = dateOnly(candidate.updated_at || candidate.approved_at || candidate.created_at);
      if (!counts.selection_auto && updated === day && (status === 'selected' || approval === 'selected')) counts.selection_auto += 1;
      if (!counts.joining_auto && updated === day && (status === 'joined' || status === 'joining done' || approval === 'joined')) counts.joining_auto += 1;
    }
  }

  return counts;
}

function entryField(entry, field) {
  if (!entry) return '';
  const value = entry[field];
  return value === undefined ? '' : value;
}

function buildDailyRecord(dateText, user, entry, context) {
  const auto = autoCountsForDate(dateText, user, context);
  const record = {
    user_id: user.user_id,
    recruiter_name: user.full_name,
    designation: user.designation,
    recruiter_code: user.recruiter_code,
    date: dateOnly(dateText),
    entry_id: entry?.goal_post_id || '',
    notes: String(entry?.notes || ''),
    entry_updated_at: entry?.updated_at || '',
  };

  for (const metric of METRICS) {
    const target = numberOrZero(entryField(entry, `${metric}_target`));
    const manualDoneRaw = entryField(entry, `${metric}_done`);
    const manualDone = manualDoneRaw === '' || manualDoneRaw === null || manualDoneRaw === undefined ? '' : numberOrZero(manualDoneRaw);
    const autoDone = numberOrZero(auto[`${metric}_auto`]);
    const effectiveDone = manualDone === '' ? autoDone : manualDone;
    record[`${metric}_target`] = target;
    record[`${metric}_done`] = effectiveDone;
    record[`${metric}_done_manual`] = manualDone;
    record[`${metric}_auto`] = autoDone;
    record[`${metric}_gap`] = Math.max(0, target - effectiveDone);
  }

  record.target_total = sumMetric(record, 'target');
  record.done_total = sumMetric(record, 'done');
  record.gap_total = sumMetric(record, 'gap');
  record.completion_pct = record.target_total > 0 ? Math.min(999, Math.round((record.done_total / record.target_total) * 100)) : 0;
  if (!entry) record.status = 'Not Filled';
  else if (!record.target_total && !record.done_total) record.status = 'Saved';
  else if (record.gap_total === 0) record.status = 'Top Performer';
  else if (record.completion_pct >= 75) record.status = 'On Track';
  else if (record.completion_pct >= 40) record.status = 'Average';
  else record.status = 'Needs Attention';
  return record;
}

function groupKey(period, record) {
  if (period === 'monthly') return `${record.user_id}__${startOfMonth(record.date)}`;
  if (period === 'weekly') return `${record.user_id}__${startOfWeek(record.date)}`;
  return `${record.user_id}__${record.date}`;
}

function groupLabel(period, dateText) {
  if (period === 'monthly') return `${dateText.slice(0, 7)}`;
  if (period === 'weekly') return `${dateText} to ${addDays(dateText, 6)}`;
  return dateText;
}

function aggregateRecords(period, dailyRecords) {
  const grouped = new Map();
  for (const record of dailyRecords) {
    const key = groupKey(period, record);
    const baseDate = period === 'monthly' ? startOfMonth(record.date) : period === 'weekly' ? startOfWeek(record.date) : record.date;
    if (!grouped.has(key)) {
      grouped.set(key, {
        user_id: record.user_id,
        recruiter_name: record.recruiter_name,
        designation: record.designation,
        recruiter_code: record.recruiter_code,
        period,
        period_start: baseDate,
        period_label: groupLabel(period, baseDate),
        notes: [],
        entry_count: 0,
        filled_count: 0,
      });
      for (const metric of METRICS) {
        grouped.get(key)[`${metric}_target`] = 0;
        grouped.get(key)[`${metric}_done`] = 0;
        grouped.get(key)[`${metric}_auto`] = 0;
        grouped.get(key)[`${metric}_gap`] = 0;
      }
    }
    const bucket = grouped.get(key);
    bucket.entry_count += 1;
    if (record.entry_id) bucket.filled_count += 1;
    if (record.notes) bucket.notes.push(record.notes);
    for (const metric of METRICS) {
      bucket[`${metric}_target`] += numberOrZero(record[`${metric}_target`]);
      bucket[`${metric}_done`] += numberOrZero(record[`${metric}_done`]);
      bucket[`${metric}_auto`] += numberOrZero(record[`${metric}_auto`]);
      bucket[`${metric}_gap`] += numberOrZero(record[`${metric}_gap`]);
    }
  }

  const rows = [...grouped.values()].map((item) => {
    item.target_total = sumMetric(item, 'target');
    item.done_total = sumMetric(item, 'done');
    item.gap_total = sumMetric(item, 'gap');
    item.completion_pct = item.target_total > 0 ? Math.min(999, Math.round((item.done_total / item.target_total) * 100)) : 0;
    item.notes = item.notes.filter(Boolean).slice(0, 3).join(' | ');
    if (!item.filled_count) item.status = 'Not Filled';
    else if (item.gap_total === 0 && item.target_total > 0) item.status = 'Top Performer';
    else if (item.completion_pct >= 75) item.status = 'On Track';
    else if (item.completion_pct >= 40) item.status = 'Average';
    else item.status = 'Needs Attention';
    return item;
  });

  rows.sort((a, b) => {
    const dateCompare = String(b.period_start || '').localeCompare(String(a.period_start || ''));
    if (dateCompare !== 0) return dateCompare;
    return String(a.recruiter_name || '').localeCompare(String(b.recruiter_name || ''));
  });

  return rows;
}

function summaryFromRows(rows) {
  const summary = {
    target_total: 0,
    done_total: 0,
    gap_total: 0,
    filled_rows: rows.filter((item) => String(item.status || '') !== 'Not Filled').length,
    row_count: rows.length,
  };
  for (const metric of METRICS) {
    summary[`${metric}_target`] = rows.reduce((total, item) => total + numberOrZero(item[`${metric}_target`]), 0);
    summary[`${metric}_done`] = rows.reduce((total, item) => total + numberOrZero(item[`${metric}_done`]), 0);
    summary[`${metric}_gap`] = rows.reduce((total, item) => total + numberOrZero(item[`${metric}_gap`]), 0);
    summary.target_total += summary[`${metric}_target`];
    summary.done_total += summary[`${metric}_done`];
    summary.gap_total += summary[`${metric}_gap`];
  }
  summary.completion_pct = summary.target_total > 0 ? Math.min(999, Math.round((summary.done_total / summary.target_total) * 100)) : 0;
  return summary;
}

function leaderboardFromRows(rows) {
  return rows
    .filter((item) => item.target_total > 0)
    .slice()
    .sort((a, b) => {
      if (b.completion_pct !== a.completion_pct) return b.completion_pct - a.completion_pct;
      if (a.gap_total !== b.gap_total) return a.gap_total - b.gap_total;
      return String(a.recruiter_name || '').localeCompare(String(b.recruiter_name || ''));
    })
    .slice(0, 6)
    .map((item, index) => ({
      rank: index + 1,
      user_id: item.user_id,
      recruiter_name: item.recruiter_name,
      designation: item.designation,
      completion_pct: item.completion_pct,
      gap_total: item.gap_total,
      target_total: item.target_total,
      done_total: item.done_total,
      period_label: item.period_label,
      status: item.status,
    }));
}

function attentionFromRows(rows) {
  const today = istToday();
  return rows
    .filter((item) => item.gap_total > 0 || (item.status === 'Not Filled' && item.period_start === today))
    .slice()
    .sort((a, b) => {
      if (b.gap_total !== a.gap_total) return b.gap_total - a.gap_total;
      if (a.completion_pct !== b.completion_pct) return a.completion_pct - b.completion_pct;
      return String(a.recruiter_name || '').localeCompare(String(b.recruiter_name || ''));
    })
    .slice(0, 8);
}

function sanitizeUsers(users) {
  return users
    .filter((item) => String(item.is_active || '1') !== '0')
    .map((item) => ({
      user_id: item.user_id,
      full_name: item.full_name,
      designation: item.designation,
      recruiter_code: item.recruiter_code,
      role: item.role,
    }))
    .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
}

async function buildPayload(req) {
  const period = normalizePeriod(req.query.period);
  const window = defaultWindow(period);
  const start = dateOnly(req.query.date_from) || window.start;
  const end = dateOnly(req.query.date_to) || window.end;
  const { rows: goalRows, storageReady, storageMessage } = await readGoalPostRows();
  const context = await getContext();
  const users = sanitizeUsers(context.users);
  const selectedUserId = String(req.query.user_id || '').trim();
  const visibleUsers = isLeadership(req.user)
    ? (selectedUserId ? users.filter((item) => String(item.user_id) === selectedUserId) : users)
    : users.filter((item) => String(item.user_id) === String(req.user.user_id));
  const entryUserId = String(req.query.editor_user_id || selectedUserId || req.user.user_id || '').trim();
  const entryDate = dateOnly(req.query.editor_date) || istToday();
  const dailyRecords = [];

  for (const dateText of dateRange(start, end)) {
    for (const user of visibleUsers) {
      const entry = goalRows.find((item) => String(item.user_id) === String(user.user_id) && dateOnly(item.date) === dateText) || null;
      dailyRecords.push(buildDailyRecord(dateText, user, entry, context));
    }
  }

  const rows = aggregateRecords(period, dailyRecords);
  const summary = summaryFromRows(rows);
  const leaderboard = leaderboardFromRows(rows);
  const attention = attentionFromRows(rows);
  const editorUser = findUser(users, entryUserId) || findUser(users, req.user.user_id) || users[0] || { user_id: req.user.user_id, full_name: req.user.full_name, designation: req.user.designation, recruiter_code: req.user.recruiter_code };
  const editorEntry = goalRows.find((item) => String(item.user_id) === String(editorUser.user_id) && dateOnly(item.date) === entryDate) || null;
  const editorReference = autoCountsForDate(entryDate, editorUser, context);

  return {
    storage_ready: storageReady,
    storage_message: storageMessage || '',
    period,
    filters: { date_from: start, date_to: end, user_id: selectedUserId },
    users,
    summary,
    leaderboard,
    attention,
    items: rows,
    editor: {
      user_id: editorUser.user_id,
      recruiter_name: editorUser.full_name,
      date: entryDate,
      entry: editorEntry || {
        user_id: editorUser.user_id,
        date: entryDate,
        submission_target: '',
        submission_done: '',
        interview_target: '',
        interview_done: '',
        selection_target: '',
        selection_done: '',
        joining_target: '',
        joining_done: '',
        notes: '',
      },
      reference: editorReference,
    },
  };
}

async function list(req, res) {
  const payload = await buildPayload(req);
  res.json(payload);
}

async function save(req, res) {
  const requestedUserId = String(req.body.user_id || req.user.user_id || '').trim();
  if (!requestedUserId) return res.status(400).json({ message: 'User is required.' });
  if (!isLeadership(req.user) && String(req.user.user_id) !== requestedUserId) {
    return res.status(403).json({ message: 'You can update only your own Goal Post tracker.' });
  }
  const { rows: goalRows, storageReady, storageMessage } = await readGoalPostRows();
  if (!storageReady && process.env.DATABASE_URL) {
    return res.status(500).json({ message: storageMessage || 'Goal Post storage is not ready.' });
  }
  const dateText = dateOnly(req.body.date) || istToday();
  const existing = goalRows.find((item) => String(item.user_id) === requestedUserId && dateOnly(item.date) === dateText) || null;
  const payload = {
    user_id: requestedUserId,
    date: dateText,
    submission_target: safeNumber(req.body.submission_target),
    submission_done: safeNumber(req.body.submission_done),
    interview_target: safeNumber(req.body.interview_target),
    interview_done: safeNumber(req.body.interview_done),
    selection_target: safeNumber(req.body.selection_target),
    selection_done: safeNumber(req.body.selection_done),
    joining_target: safeNumber(req.body.joining_target),
    joining_done: safeNumber(req.body.joining_done),
    notes: String(req.body.notes || '').trim(),
    updated_by_user_id: req.user.user_id,
    updated_at: nowIso(),
  };

  if (existing) {
    await store.update('goal_post_targets', 'goal_post_id', existing.goal_post_id, payload);
  } else {
    payload.goal_post_id = nextId('GOALPOST', goalRows, 'goal_post_id');
    payload.created_at = nowIso();
    await store.insert('goal_post_targets', payload);
  }

  res.json({ ok: true, message: 'Goal Post updated successfully.' });
}

function parseMetadata(value) {
  try {
    return JSON.parse(String(value || '{}'));
  } catch {
    return {};
  }
}

async function ensureMorningDigest(req) {
  if (!isLeadership(req.user)) return;
  const now = istParts(new Date());
  if (now.hour < 8 || now.hour > 11) return;
  const today = istToday();
  const context = await getContext();
  const { rows: goalRows } = await readGoalPostRows();
  const goalPostDigestKey = `goalpost-morning-digest:${today}:${req.user.user_id}`;
  const already = context.notifications.find((item) => {
    if (String(item.user_id) !== String(req.user.user_id)) return false;
    const meta = parseMetadata(item.metadata);
    return String(meta.goal_post_key || '') === goalPostDigestKey;
  });
  if (already) return;
  const users = sanitizeUsers(context.users);
  const todayRows = users.map((user) => {
    const entry = goalRows.find((item) => String(item.user_id) === String(user.user_id) && dateOnly(item.date) === today) || null;
    return buildDailyRecord(today, user, entry, context);
  });
  const worst = attentionFromRows(todayRows)[0];
  const leader = leaderboardFromRows(todayRows)[0];
  const rows = await table('notifications').catch(() => []);
  await store.insert('notifications', {
    notification_id: nextId('N', rows, 'notification_id'),
    user_id: req.user.user_id,
    title: 'Goal Post Morning Review',
    message: `${leader ? `${leader.recruiter_name} is leading at ${leader.completion_pct}%` : 'No leader yet'}${worst ? ` • Attention needed: ${worst.recruiter_name}` : ''}`,
    category: 'goal-post',
    status: 'Unread',
    metadata: JSON.stringify({ goal_post_key: goalPostDigestKey, page: '/goal-post', date: today }),
    created_at: nowIso(),
  });
}

async function reminders(req, res) {
  try { await ensureMorningDigest(req); } catch {}
  const context = await getContext();
  const { rows: goalRows } = await readGoalPostRows();
  const now = istParts(new Date());
  const today = istToday();
  const selfUser = findUser(sanitizeUsers(context.users), req.user.user_id) || { user_id: req.user.user_id, full_name: req.user.full_name, designation: req.user.designation, recruiter_code: req.user.recruiter_code };
  const entry = goalRows.find((item) => String(item.user_id) === String(req.user.user_id) && dateOnly(item.date) === today) || null;
  const record = buildDailyRecord(today, selfUser, entry, context);
  let popup = null;
  if (now.hour >= 16 && now.hour <= 21) {
    if (!entry) {
      popup = {
        tone: 'danger',
        title: 'Goal Post update pending',
        message: 'Today\'s target entry is still missing. Fill the Goal Post sheet before logout.',
      };
    } else if (record.target_total > 0 && record.gap_total > 0) {
      popup = {
        tone: 'danger',
        title: 'Target gap still open',
        message: `${record.gap_total} total gap is still open for today. Update Goal Post before sign out.`,
      };
    }
  }
  res.json({ popup, today: record, now_hour: now.hour, today_date: today });
}

async function logoutCheck(req, res) {
  if (!['admin', 'manager'].includes(lower(req.user?.role))) {
    return res.json({ blocked: false, message: '', page: '' });
  }
  const { rows: goalRows } = await readGoalPostRows();
  const today = istToday();
  const entry = goalRows.find((item) => String(item.user_id) === String(req.user.user_id) && dateOnly(item.date) === today) || null;
  if (!entry) {
    return res.json({ blocked: true, message: 'Update the Goal Post tracker before logout.', page: '/goal-post' });
  }
  return res.json({ blocked: false });
}

module.exports = { list, save, reminders, logoutCheck };
