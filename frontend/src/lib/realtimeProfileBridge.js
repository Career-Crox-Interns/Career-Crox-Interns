import { cachePrincipal } from './api';
import { crmYmd } from './workspaceHelpers';
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
    principal:cachePrincipal(),
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
      keys.filter((key) => String(key || '').startsWith(`${cachePrincipal()}:careerCroxCandidatesFastCache:`)).forEach((key) => {
        try {
          const parsed = JSON.parse(storage.getItem(key) || 'null');
          const data = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.data) ? parsed.data : null);
          if (!data) return;
          const remaining=data.filter(row=>safeText(row?.candidate_id)!==normalized.candidate_id);
          const next=(normalized.deleted_at||['deleted','__deleted__','archived'].includes(lower(normalized.status)))?remaining:[normalized,...remaining].slice(0,Math.max(10,data.length||10));
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
    if (payload.principal && payload.principal !== cachePrincipal()) return;
    if (!payload.principal && payload.actor_user_id && payload.actor_user_id !== cachePrincipal().split('|')[0]) return;
    handler(payload);
  };
  const eventHandler = (event) => run(event?.detail || {});
  const storageHandler = (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try { run(JSON.parse(event.newValue)); } catch {}
  };
  const pushed = event => { const data=event.detail||{}; if(data.item?.candidate_id && (data.item.full_name||data.item.deleted_at)) run({item:data.item,meta:{...data.meta,source:data.meta?.source||data.source,server_push:true},principal:cachePrincipal(),at:data.at}); };
  window.addEventListener('career-crox-workspace-change',pushed);
  window.addEventListener(CANDIDATE_UPSERT_EVENT, eventHandler);
  window.addEventListener(CANDIDATE_SUBMITTED_EVENT, eventHandler);
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener('career-crox-workspace-change',pushed);
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

// CC782: local cache/realtime must obey current owner and the bucket deadline.
export function candidateVisibleLocally(row={},user={}) {
 const removed=['deleted','__deleted__','archived'];
 if(row.deleted_at||removed.includes(lower(row.status))||removed.includes(lower(row.approval_status))||['deleted','archived'].includes(lower(row.all_details_sent))||lower(row.data_notes).includes('[crm-deleted]'))return false;
 const role=lower(user.role);if(['admin','manager'].includes(role))return true;
 const tiers=[['id',['recruiter_user_id','assigned_to_user_id','owner_user_id']],['code',['recruiter_code','assigned_to_code','owner_code']],['name',['recruiter_name','assigned_to_name','owner_name']],['code',['employee_no','employee_code','submitted_by_recruiter_code']],['id',['user_id','submitted_by_user_id','created_by_user_id']],['name',['employee_name','submitted_by','submitted_by_name','created_by_name']]];
 let owner=null;for(const [kind,fields] of tiers){for(const field of fields){const value=safeText(row[field]);if(value){owner={kind,value};break;}}if(owner)break;}
 const matches=scope=>{if(!owner)return false;if(owner.kind==='id')return (scope.ids||[]).map(String).includes(owner.value);if(owner.kind==='code')return owner.value.split(',').some(v=>(scope.codes||[]).map(lower).includes(lower(v)));return (scope.names||[]).map(lower).includes(lower(owner.value));};
 const own={ids:[user.user_id],codes:[user.recruiter_code],names:[user.full_name,user.username]};
 const project=safeText(row.project_id),solo=role==='tl'?{ids:user.__ccTeamUserIds||[],codes:user.__ccTeamCodes||[],names:user.__ccTeamNames||[]}:user.__ccSoloPeers||{};
 const visible=matches(own)||(project?(user.__ccSharedScopes||[]).some(scope=>scope.project_id===project&&matches(scope)):matches(solo));
 if(!visible)return false;if(role==='tl'||user.__ccDashboardOwn||matches(own))return true;
 if(row.bucket_is_bucket_out)return false;
 let raw=String(row.bucket_assigned_at||row.created_at||row.submission_date||'').trim();
 if(/^\d{4}-\d{2}-\d{2}$/.test(raw))raw+='T00:00:00+05:30';
 else if(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw))raw=raw.replace(' ','T')+'+05:30';
 const deadline=row.bucket_expires_at?Date.parse(row.bucket_expires_at):Date.parse(raw)+168*3600000;
 const terminal=row.bucket_is_terminal||['closed','joined','hired','rejected','not interested','not intrested','not_interested','completed','done'].includes(lower(row.status));
 if(Number.isFinite(deadline)&&deadline<=Date.now()&&!terminal)return false;
 return true;
}
