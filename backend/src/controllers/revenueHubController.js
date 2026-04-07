const { store, table } = require('../lib/store');
const { containsText, nowIso, ymd, normalizeIndianPhone, buildCsv } = require('../lib/helpers');

const STATUS_OPTIONS = [
  'will_come_for_interview',
  'appeared_for_interview',
  'rejected',
  'selected',
  'pending_joining',
  'joined',
  'not_joined',
  'completed_60_days',
];
const PAYOUT_OPTIONS = ['none', 'payout_pending', 'payout_received'];

function lower(value) {
  return String(value || '').trim().toLowerCase();
}
function isLeadership(user) {
  return ['admin', 'manager', 'tl'].includes(lower(user?.role));
}
function isManager(user) {
  return ['admin', 'manager'].includes(lower(user?.role));
}
function toDateOnly(value) {
  return String(value || '').slice(0, 10);
}
function dateDiffDays(fromValue, toValue) {
  const a = new Date(`${toDateOnly(fromValue)}T00:00:00`);
  const b = new Date(`${toDateOnly(toValue)}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.floor((a.getTime() - b.getTime()) / 86400000);
}
function genId() {
  return `REV${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
}
function userOwnsCandidate(user, row) {
  if (isLeadership(user)) return true;
  const ownName = lower(user?.full_name);
  const ownCode = lower(user?.recruiter_code);
  const rowName = lower(row?.recruiter_name);
  const codes = String(row?.recruiter_code || '').split(',').map((item) => lower(item.trim())).filter(Boolean);
  return rowName === ownName || codes.includes(ownCode);
}
function hydrateEntry(entry) {
  const today = ymd();
  const interviewDate = toDateOnly(entry.interview_date);
  const selectionDate = toDateOnly(entry.selection_date);
  const joiningDate = toDateOnly(entry.joining_date);
  const joinedDate = toDateOnly(entry.joined_date);
  const daysToJoining = joiningDate ? dateDiffDays(joiningDate, today) : null;
  const daysFromJoined = joinedDate ? dateDiffDays(today, joinedDate) : null;
  const payoutStatus = lower(entry.payout_status) || 'none';
  const status = lower(entry.status) || 'will_come_for_interview';
  const overdueInterview = ['will_come_for_interview', 'appeared_for_interview'].includes(status) && interviewDate && interviewDate <= today;
  const joiningPendingDue = ['selected', 'pending_joining'].includes(status) && joiningDate && daysToJoining !== null && daysToJoining <= 3;
  const completed60 = daysFromJoined !== null && daysFromJoined >= 60;
  const payoutPending = (status === 'joined' || status === 'completed_60_days' || completed60) && payoutStatus !== 'payout_received' && daysFromJoined !== null && daysFromJoined >= 55;
  const missed = overdueInterview && today > interviewDate;
  let stageColor = 'blue';
  if (['rejected', 'not_joined'].includes(status) || missed) stageColor = 'red';
  else if (['selected', 'joined', 'completed_60_days'].includes(status) || payoutStatus === 'payout_received') stageColor = 'green';
  else if (['pending_joining', 'appeared_for_interview'].includes(status) || joiningPendingDue || payoutPending) stageColor = 'orange';
  return {
    ...entry,
    interview_date: interviewDate,
    selection_date: selectionDate,
    joining_date: joiningDate,
    joined_date: joinedDate,
    days_to_joining: daysToJoining,
    days_from_joined: daysFromJoined,
    completed_60_days: completed60,
    payout_pending: payoutPending,
    missed,
    overdue_interview: overdueInterview,
    joining_pending_due: joiningPendingDue,
    stage_color: stageColor,
  };
}
function matchesFilter(entry, query) {
  if (query.status && lower(entry.status) !== lower(query.status)) return false;
  if (query.payout_status && lower(entry.payout_status) !== lower(query.payout_status)) return false;
  if (query.client_name && lower(entry.client_name) !== lower(query.client_name)) return false;
  if (query.process && lower(entry.process) !== lower(query.process)) return false;
  if (query.recruiter_name && lower(entry.recruiter_name) !== lower(query.recruiter_name)) return false;
  if (query.candidate_id && !containsText(entry.candidate_id, query.candidate_id)) return false;
  if (query.candidate_name && !containsText(entry.full_name, query.candidate_name)) return false;
  if (query.interview_date_from && String(entry.interview_date || '') < String(query.interview_date_from)) return false;
  if (query.interview_date_to && String(entry.interview_date || '') > String(query.interview_date_to)) return false;
  if (query.selection_date_from && String(entry.selection_date || '') < String(query.selection_date_from)) return false;
  if (query.selection_date_to && String(entry.selection_date || '') > String(query.selection_date_to)) return false;
  if (query.joining_date_from && String(entry.joining_date || '') < String(query.joining_date_from)) return false;
  if (query.joining_date_to && String(entry.joining_date || '') > String(query.joining_date_to)) return false;
  return true;
}
function cardSummary(entries) {
  return {
    will_come_for_interview: entries.filter((item) => lower(item.status) === 'will_come_for_interview').length,
    appeared_for_interview: entries.filter((item) => lower(item.status) === 'appeared_for_interview').length,
    rejected: entries.filter((item) => lower(item.status) === 'rejected').length,
    selected: entries.filter((item) => lower(item.status) === 'selected').length,
    pending_joining: entries.filter((item) => lower(item.status) === 'pending_joining').length,
    joined: entries.filter((item) => lower(item.status) === 'joined').length,
    not_joined: entries.filter((item) => lower(item.status) === 'not_joined').length,
    completed_60_days: entries.filter((item) => item.completed_60_days || lower(item.status) === 'completed_60_days').length,
    payout_pending: entries.filter((item) => item.payout_pending || lower(item.payout_status) === 'payout_pending').length,
    payout_received: entries.filter((item) => lower(item.payout_status) === 'payout_received').length,
  };
}
async function getVisibleEntries(user) {
  const rows = await table('revenue_hub_entries');
  return rows
    .filter((row) => isLeadership(user) ? true : userOwnsCandidate(user, row))
    .map(hydrateEntry)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}
async function getVisibleCandidates(user, query = '') {
  const rows = await table('candidates');
  return rows
    .filter((row) => userOwnsCandidate(user, row))
    .filter((row) => {
      if (!query) return true;
      return [row.candidate_id, row.full_name, row.phone, row.process, row.recruiter_name, row.recruiter_code].some((value) => containsText(value, query));
    })
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))
    .slice(0, 12);
}
function shapeFromCandidate(candidate, payload = {}) {
  return {
    revenue_id: genId(),
    candidate_id: candidate.candidate_id,
    full_name: candidate.full_name || '',
    phone: normalizeIndianPhone(candidate.phone || candidate.number || ''),
    process: candidate.process || payload.process || '',
    client_name: payload.client_name || candidate.client_name || candidate.company_name || candidate.process || '',
    location: candidate.location || candidate.preferred_location || '',
    qualification: candidate.qualification_level || candidate.qualification || '',
    recruiter_name: candidate.recruiter_name || '',
    recruiter_code: candidate.recruiter_code || '',
    interview_date: toDateOnly(payload.interview_date || candidate.interview_date || candidate.interview_reschedule_date || ymd()),
    selection_date: '',
    joining_date: '',
    joined_date: '',
    status: 'will_come_for_interview',
    payout_status: 'none',
    notes: payload.notes || '',
    created_at: nowIso(),
    updated_at: nowIso(),
    created_by_user_id: payload.created_by_user_id || '',
  };
}

async function list(req, res) {
  const allEntries = (await getVisibleEntries(req.user)).filter((item) => matchesFilter(item, req.query || {}));
  const lookupSource = await getVisibleEntries(req.user);
  return res.json({
    items: allEntries,
    cards: cardSummary(lookupSource),
    lookups: {
      clients: Array.from(new Set(lookupSource.map((item) => item.client_name).filter(Boolean))).sort(),
      processes: Array.from(new Set(lookupSource.map((item) => item.process).filter(Boolean))).sort(),
      recruiters: Array.from(new Set(lookupSource.map((item) => item.recruiter_name).filter(Boolean))).sort(),
      statuses: STATUS_OPTIONS,
      payout_statuses: PAYOUT_OPTIONS,
    },
  });
}

async function searchCandidates(req, res) {
  const items = await getVisibleCandidates(req.user, req.query.q || '');
  return res.json({ items });
}

async function addCandidate(req, res) {
  const candidateId = String(req.body?.candidate_id || '').trim();
  if (!candidateId) return res.status(400).json({ message: 'Candidate code is required.' });
  const candidate = (await table('candidates')).find((row) => String(row.candidate_id) === candidateId);
  if (!candidate) return res.status(404).json({ message: 'Candidate not found.' });
  const existing = (await table('revenue_hub_entries')).find((row) => String(row.candidate_id) === candidateId);
  if (existing) return res.status(400).json({ message: 'Candidate already exists in Revenue Hub.' });
  const item = shapeFromCandidate(candidate, { ...req.body, created_by_user_id: req.user?.user_id || '' });
  const inserted = await store.insert('revenue_hub_entries', item);
  return res.json({ item: hydrateEntry(inserted) });
}

async function updateStatus(req, res) {
  const revenueId = String(req.params.revenueId || '').trim();
  const existing = await store.findById('revenue_hub_entries', 'revenue_id', revenueId);
  if (!existing) return res.status(404).json({ message: 'Revenue entry not found.' });
  const nextStatus = lower(req.body?.status || existing.status);
  if (!STATUS_OPTIONS.includes(nextStatus)) return res.status(400).json({ message: 'Invalid status.' });
  const nextPayout = lower(req.body?.payout_status || existing.payout_status || 'none');
  if (!PAYOUT_OPTIONS.includes(nextPayout)) return res.status(400).json({ message: 'Invalid payout status.' });
  const updates = {
    status: nextStatus,
    payout_status: nextPayout,
    interview_date: toDateOnly(req.body?.interview_date || existing.interview_date),
    joining_date: toDateOnly(req.body?.joining_date || existing.joining_date),
    selection_date: toDateOnly(req.body?.selection_date || existing.selection_date),
    joined_date: toDateOnly(req.body?.joined_date || existing.joined_date),
    notes: String(req.body?.notes ?? existing.notes ?? ''),
    updated_at: nowIso(),
  };
  if (nextStatus === 'selected' && !updates.selection_date) updates.selection_date = ymd();
  if (nextStatus === 'pending_joining' && !updates.selection_date) updates.selection_date = ymd();
  if (nextStatus === 'joined' && !updates.joined_date) updates.joined_date = ymd();
  if (nextStatus === 'completed_60_days' && !updates.joined_date) updates.joined_date = existing.joined_date || ymd();
  if (nextStatus === 'rejected' || nextStatus === 'not_joined') updates.payout_status = 'none';
  if (nextPayout === 'payout_received' && nextStatus === 'joined') updates.status = 'completed_60_days';
  const item = await store.update('revenue_hub_entries', 'revenue_id', revenueId, updates);
  return res.json({ item: hydrateEntry(item) });
}

async function reminders(req, res) {
  const now = new Date();
  const hour = now.getHours();
  const today = ymd();
  const items = (await getVisibleEntries(req.user)).filter((item) => {
    const status = lower(item.status);
    if (status === 'will_come_for_interview' && item.interview_date === today) return true;
    if (['will_come_for_interview', 'appeared_for_interview'].includes(status) && item.interview_date && item.interview_date <= today) return true;
    if (['selected', 'pending_joining'].includes(status) && item.joining_date && (item.days_to_joining ?? 99) <= 3) return true;
    if ((status === 'joined' || status === 'completed_60_days') && item.payout_pending) return true;
    return false;
  });
  const first = items[0] || null;
  if (!first) return res.json({ item: null });
  let title = 'Revenue follow-up due';
  let message = 'Update candidate status in Revenue Hub.';
  if (lower(first.status) === 'will_come_for_interview' && first.interview_date === today) {
    title = 'Interview scheduled today';
    message = `${first.full_name} is due for interview today. Confirm movement and status.`;
  } else if (['will_come_for_interview', 'appeared_for_interview'].includes(lower(first.status))) {
    title = hour >= 17 ? 'Interview status pending before logout' : 'Interview result pending';
    message = `${first.full_name} still needs interview outcome update.`;
  } else if (['selected', 'pending_joining'].includes(lower(first.status))) {
    title = 'Joining follow-up pending';
    message = `${first.full_name} has joining follow-up due${first.joining_date ? ` on ${first.joining_date}` : ''}.`;
  } else if (first.payout_pending) {
    title = 'Payout action pending';
    message = `${first.full_name} is in payout follow-up stage.`;
  }
  return res.json({ item: { ...first, title, message } });
}

async function logoutCheck(req, res) {
  const hour = new Date().getHours();
  if (hour < 17) return res.json({ blocked: false, count: 0, items: [] });
  const items = (await getVisibleEntries(req.user)).filter((item) => ['will_come_for_interview', 'appeared_for_interview'].includes(lower(item.status)) && item.interview_date && item.interview_date <= ymd());
  return res.json({ blocked: items.length > 0, count: items.length, items: items.slice(0, 12) });
}

async function exportCsv(req, res) {
  if (!isManager(req.user)) return res.status(403).json({ message: 'Only manager can export Revenue Hub data.' });
  const items = (await getVisibleEntries(req.user)).filter((item) => matchesFilter(item, req.query || {})).map((item) => ({
    candidate_code: item.candidate_id,
    name: item.full_name,
    number: item.phone,
    client: item.client_name,
    process: item.process,
    recruiter: item.recruiter_name,
    interview_date: item.interview_date,
    selection_date: item.selection_date,
    joining_date: item.joining_date,
    joined_date: item.joined_date,
    status: item.status,
    payout_status: item.payout_status,
    notes: item.notes,
  }));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="revenue_hub_export.csv"');
  return res.send(buildCsv(items));
}

module.exports = {
  STATUS_OPTIONS,
  PAYOUT_OPTIONS,
  list,
  searchCandidates,
  addCandidate,
  updateStatus,
  reminders,
  logoutCheck,
  exportCsv,
};
