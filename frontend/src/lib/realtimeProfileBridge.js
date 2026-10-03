import { crmYmd } from './timeFormat';
export const CANDIDATE_UPSERT_EVENT = 'career-crox-candidate-upserted';
export const CANDIDATE_SUBMITTED_EVENT = 'career-crox-candidate-submitted';
const STORAGE_KEY = 'careerCroxRealtimeCandidatePatch:v2';

function safeText(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return safeText(value).toLowerCase();
}

function splitValues(value) {
  return safeText(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeCandidateItem(item = {}) {
  const now = new Date().toISOString();
  const candidateId = safeText(item.candidate_id || item.id);
  return {
    ...item,
    candidate_id: candidateId,
    full_name: safeText(item.full_name || item.name),
    phone: safeText(item.phone || item.number),
    updated_at: item.updated_at || now,
  };
}

export function emitCandidateUpsert(item, meta = {}) {
  if (typeof window === 'undefined') return;
  const normalizedBase = normalizeCandidateItem(item || {});
  if (!normalizedBase.candidate_id) return;
  const durablePending = Boolean(meta?.durable_create || meta?.submitted);
  const normalized = durablePending
    ? { ...normalizedBase, __cc_durable_frontend_pending: true, __cc_durable_frontend_at: Date.now() }
    : normalizedBase;
  let actorUserId = '';
  try {
    const cachedUser = JSON.parse(window.localStorage.getItem('careerCroxCachedUser') || '{}');
    actorUserId = safeText(cachedUser?.user_id || cachedUser?.username || cachedUser?.recruiter_code);
  } catch {}
  const payload = {
    item: normalized,
    meta: meta || {},
    actor_user_id: actorUserId,
    at: Date.now(),
  };
  try {
    window.dispatchEvent(new CustomEvent(CANDIDATE_UPSERT_EVENT, { detail: payload }));
    if (meta?.submitted || lower(normalized.approval_status) === 'pending') {
      window.dispatchEvent(new CustomEvent(CANDIDATE_SUBMITTED_EVENT, { detail: payload }));
    }
  } catch {}
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {}
  // CC26_678: keep All Candidates instant cache in sync with every durable candidate upsert.
  // This is local-only; it adds zero Supabase/backend reads and prevents a just-created profile
  // from appearing to vanish while the page cache is still warm.
  try {
    const storages = [window.sessionStorage, window.localStorage].filter(Boolean);
    for (const storage of storages) {
      const keys = [];
      for (let i = 0; i < storage.length; i += 1) keys.push(storage.key(i));
      keys.filter((key) => String(key || '').startsWith('careerCroxCandidatesFastCache:')).forEach((key) => {
        try {
          const parsed = JSON.parse(storage.getItem(key) || 'null');
          const data = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.data) ? parsed.data : null);
          if (!data) return;
          const next = [normalized, ...data.filter((row) => safeText(row?.candidate_id) !== normalized.candidate_id)].slice(0, Math.max(10, data.length || 10));
          const out = Array.isArray(parsed) ? next : { ...parsed, cachedAt: Date.now(), data: next };
          storage.setItem(key, JSON.stringify(out));
        } catch {}
      });
    }
  } catch {}
}

export function onCandidateRealtime(handler) {
  if (typeof window === 'undefined') return () => {};
  const run = (payload) => {
    if (!payload?.item?.candidate_id) return;
    handler(payload);
  };
  const eventHandler = (event) => run(event?.detail || {});
  const storageHandler = (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try { run(JSON.parse(event.newValue)); } catch {}
  };
  window.addEventListener(CANDIDATE_UPSERT_EVENT, eventHandler);
  window.addEventListener(CANDIDATE_SUBMITTED_EVENT, eventHandler);
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener(CANDIDATE_UPSERT_EVENT, eventHandler);
    window.removeEventListener(CANDIDATE_SUBMITTED_EVENT, eventHandler);
    window.removeEventListener('storage', storageHandler);
  };
}

export function buildInstantSubmissionRow(item = {}, submission = {}) {
  const row = normalizeCandidateItem(item);
  const stamp = submission.submitted_at || submission.approval_requested_at || row.approval_requested_at || row.submission_date || new Date().toISOString();
  return {
    ...row,
    ...submission,
    submission_id: safeText(submission.submission_id) || `LOCAL-${row.candidate_id}`,
    candidate_id: row.candidate_id,
    full_name: safeText(submission.full_name || row.full_name),
    phone: safeText(submission.phone || row.phone),
    location: safeText(submission.location || row.location),
    preferred_location: safeText(submission.preferred_location || row.preferred_location || row.location),
    process: safeText(submission.process || row.process),
    recruiter_name: safeText(submission.recruiter_name || row.recruiter_name),
    recruiter_code: safeText(submission.recruiter_code || row.recruiter_code),
    candidate_status: safeText(submission.candidate_status || row.status || 'In - Progress'),
    status: safeText(submission.status || row.status || 'In - Progress'),
    all_details_sent: safeText(submission.all_details_sent || row.all_details_sent || 'Pending'),
    approval_status: safeText(submission.approval_status || row.approval_status || 'Pending'),
    submission_comms: safeText(submission.submission_comms || row.communication_skill),
    candidate_submission_date: safeText(row.submission_date || submission.candidate_submission_date),
    submitted_at: stamp,
    approval_requested_at: stamp,
    submission_origin_at: safeText(row.submission_date || submission.submission_origin_at || stamp),
    updated_at: submission.updated_at || row.updated_at || stamp,
    __instant_frontend_row: true,
  };
}

export function hasInterviewDate(item = {}) {
  return Boolean(safeText(item.interview_reschedule_date || item.interview_date || item.scheduled_at));
}

export function buildInstantInterviewRow(item = {}) {
  const row = normalizeCandidateItem(item);
  const rawInterviewDate = safeText(row.interview_reschedule_date || row.interview_date || row.scheduled_at);
  const interviewDate = /^\d{4}-\d{2}-\d{2}$/.test(rawInterviewDate) ? rawInterviewDate : (crmYmd(rawInterviewDate) || rawInterviewDate.slice(0, 10));
  return {
    ...row,
    interview_date_effective: interviewDate,
    recruiter_code_list: splitValues(row.recruiter_code),
    process_list: splitValues(row.process),
    preferred_location_list: splitValues(row.preferred_location),
    __instant_frontend_row: true,
  };
}
