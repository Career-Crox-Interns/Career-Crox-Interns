const { visibleCandidateForUser, isAdminOrManager, candidateScopeSql, canReviewSubmission, submissionReviewScopeSql } = require('../lib/accessRules');
const { store, table, mode, afterCommit } = require('../lib/store');
const { nowIso, recruiterCodeMatches } = require('../lib/helpers');
const { clearAllCaches } = require('../lib/cache');
const { canApproveUnlock, eligibleApprovers, canonicalRole, sameUser } = require('../lib/unlockPolicy');
const approvalLive = require('../lib/approvalLive');
const { approvalPayload } = require('../lib/unlockService');

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

async function unlockForDecision(id) {
  let request = await store.findById('unlock_requests', 'request_id', id);
  if (request && store.pool) {
    await store.query('select pg_advisory_xact_lock(hashtext($1))', ['career-crox-unlock:' + String(request.user_id)]);
    request = await store.one('select * from public.unlock_requests where request_id=$1 for update', [id]);
  }
  return request;
}

async function supersedeOtherUnlocks(userId,id){
  if(store.pool)await store.query("update public.unlock_requests set status='Superseded',updated_at=$2 where user_id=$1 and request_id<>$3 and coalesce(access_kind,'')<>'youtube' and lower(coalesce(status,''))='pending'",[userId,nowIso(),id]);
  else for(const row of await table('unlock_requests'))if(String(row.user_id)===String(userId)&&String(row.request_id)!==String(id)&&row.access_kind!=='youtube'&&lower(row.status)==='pending')await store.update('unlock_requests','request_id',row.request_id,{status:'Superseded',updated_at:nowIso()});
}

function deletedCandidateWhereSql(alias = 'c') {
  const p = alias ? `${alias}.` : '';
  return `coalesce(${p}deleted_at, '') = ''
    and lower(coalesce(${p}status, '')) not in ('deleted', '__deleted__', 'archived')
    and lower(coalesce(${p}approval_status, '')) not in ('deleted', '__deleted__', 'archived')
    and lower(coalesce(${p}all_details_sent, '')) not in ('deleted', 'archived')
    and lower(coalesce(${p}data_notes, '')) not like '%[crm-deleted]%'`;
}

function deletedSubmissionWhereSql(alias = 's') {
  const p = alias ? `${alias}.` : '';
  return `lower(coalesce(${p}status, '')) not in ('deleted', '__deleted__', 'archived')
    and lower(coalesce(${p}approval_status, '')) not in ('deleted', '__deleted__', 'archived')`;
}
function makeFastId(prefix = 'X') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}
function makeFastBigIntId() {
  return Number(`${Date.now()}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`);
}

async function makeNotification(userId, title, message, category = 'approval', metadata = '') {
  const item = {
    notification_id: makeFastId('N'),
    user_id: userId,
    title,
    message,
    category,
    status: 'Unread',
    metadata,
    created_at: nowIso(),
  };
  try {
    await store.insert('notifications', item);
    await require('../lib/store').afterCommit(()=>approvalLive.publishToUsers([userId],'notification',{item}));
    return item;
  } catch (err) {
    try { console.warn('Notification insert skipped:', err?.message || err); } catch {}
    return null;
  }
}

function compactLower(value) {
  return String(value || '').trim().toLowerCase();
}

function userMatchesCandidateOrSubmission(user, candidate = {}, submission = {}) {
  const userId = String(user?.user_id || '').trim();
  const userCode = compactLower(user?.recruiter_code || '');
  const userName = compactLower(user?.full_name || user?.username || '');
  const directIds = [submission?.submitted_by_user_id, candidate?.created_by_user_id, candidate?.recruiter_user_id, candidate?.user_id]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (userId && directIds.includes(userId)) return true;

  const codes = [submission?.submitted_by_recruiter_code, candidate?.recruiter_code, candidate?.employee_code]
    .map(compactLower)
    .filter(Boolean);
  if (userCode && codes.some((code) => recruiterCodeMatches(code, userCode) || code === userCode)) return true;

  const names = [submission?.submitted_by_name, candidate?.recruiter_name, candidate?.employee_name, candidate?.submitted_by]
    .map(compactLower)
    .filter(Boolean);
  if (userName && names.includes(userName)) return true;
  return false;
}

async function notifyRecruiter(candidate,title,message,submission=null,extraMetadata={},actor={}) {
 return require('../lib/workflowNotifications').notify(candidate,actor,title,message,{submission_id:submission?.submission_id||'',open_path:'/candidate/'+encodeURIComponent(candidate.candidate_id),...extraMetadata});
}

async function logActivity(req, candidateId, actionType, metadata = {}) {
  const item = {
    activity_id: makeFastId('A'),
    user_id: req.user?.user_id || '',
    username: req.user?.username || '',
    action_type: actionType,
    candidate_id: candidateId,
    metadata: JSON.stringify(metadata),
    created_at: nowIso(),
  };
  await store.insert('activity_log', item);
}


async function safeLogActivity(req, candidateId, actionType, metadata = {}) {
  try {
    await logActivity(req, candidateId, actionType, metadata);
  } catch (err) {
    try { console.warn('Activity log skipped:', err?.message || err); } catch {}
  }
}


function parseSnapshot(row = {}) {
  try { return JSON.parse(row.snapshot_json || '{}'); } catch { return {}; }
}

function attendanceReportDecisionPayload(row = {}, decision = 'Full Day', note = '', approver = {}) {
  const snapshot = parseSnapshot(row);
  return {
    ...snapshot,
    manager_decision: decision,
    manager_note: String(note || '').trim(),
    approved_by_name: approver?.full_name || approver?.username || '',
    approved_by_user_id: approver?.user_id || '',
    approved_at: nowIso(),
  };
}


function approvalAlreadyCompleted(candidate = {}, submission = {}) {
  return lower(candidate.approval_status) === 'approved' || lower(submission.approval_status) === 'approved';
}
async function resolveLatestSubmission(candidateId) {
  if (store.pool) return store.one(`select * from submissions where candidate_id=$1 order by coalesce(approval_requested_at,submitted_at,'') desc limit 1`,[candidateId]);
  const submissions = await table('submissions');
  return submissions
    .filter((s) => String(s.candidate_id) === String(candidateId))
    .sort((a, b) => String(b.approval_requested_at || b.submitted_at || '').localeCompare(String(a.approval_requested_at || a.submitted_at || '')))[0] || null;
}

async function resolvePendingSubmission(candidateId) {
  if (store.pool) return store.one(`select * from submissions where candidate_id=$1 and lower(approval_status)='pending' limit 1`,[candidateId]);
  const submissions = await table('submissions');
  return submissions.find((s) => String(s.candidate_id) === String(candidateId) && lower(s.approval_status) === 'pending') || null;
}

function candidateApprovalIsPending(candidate = {}, submission = {}) {
  return lower(candidate?.approval_status) === 'pending' && lower(submission?.approval_status) === 'pending';
}

async function list(req, res) {
  const scope = String(req.query?.scope || 'all').trim().toLowerCase();
  const candidateScope = candidateScopeSql('c', req.user, []);
  const users = await require('../lib/collaborationAccess').roster();
  const userById = new Map(users.map((u) => [String(u.user_id), u]));
  // CC26_604: the ops approval page only needs names for pending interview-remove requests.
  // In Postgres never scan/load the entire candidates table just to render a few rows.
  const relatedCandidates = (mode === 'postgres' && store.pool)
    ? await store.query(`select c.*
        from public.candidates c
        where c.candidate_id in (
          select ir.candidate_id from public.interview_remove_requests ir
          where lower(coalesce(ir.status, '')) = 'pending'
        ) and ${candidateScope.sql}`, candidateScope.params)
    : await table('candidates');
  const candidateById = new Map(relatedCandidates.map((c) => [String(c.candidate_id), c]));

  const reviewScope=submissionReviewScopeSql("c","s",req.user,[...candidateScope.params]);
  let candidates = [];
  if (mode === 'postgres' && store.pool) {
    if (scope !== 'ops') candidates = await store.query(`
      select
        'candidate'::text as type,
        s.submission_id as id,
        c.full_name as title,
        s.approval_status as status,
        coalesce(s.approval_requested_at, s.submitted_at, c.updated_at) as requested_at,
        c.candidate_id,
        c.recruiter_name,
        c.process
      from public.submissions s
      join public.candidates c on c.candidate_id = s.candidate_id
      where lower(coalesce(s.approval_status, '')) = 'pending'
        and lower(coalesce(c.approval_status, 'pending')) = 'pending'
        and ${deletedCandidateWhereSql('c')}
        and ${deletedSubmissionWhereSql('s')}
        and ${candidateScope.sql}
        and ${reviewScope.sql}
        and coalesce(c.candidate_id, '') <> ''
        and coalesce(c.full_name, '') <> ''
      order by coalesce(s.approval_requested_at, s.submitted_at, c.updated_at) desc
    `, reviewScope.params);
  } else {
    const submissions = await table('submissions');
    candidates = submissions
      .filter((s) => lower(s.approval_status) === 'pending' && !['deleted', '__deleted__', 'archived'].includes(lower(s.status)))
      .map((s) => {
        const c = candidateById.get(String(s.candidate_id)) || {};
        return {
          type: 'candidate', id: s.submission_id, title: c.full_name, status: s.approval_status,
          requested_at: s.approval_requested_at || s.submitted_at || c.updated_at,
          candidate_id: c.candidate_id || s.candidate_id, recruiter_name: c.recruiter_name || '', process: c.process || '', candidate_status: c.approval_status || '',
        };
      })
      .filter((item) => item.candidate_id && item.title && lower(item.candidate_status || 'pending') === 'pending' && visibleCandidateForUser(candidateById.get(String(item.candidate_id)), req.user) && canReviewSubmission(req.user,candidateById.get(String(item.candidate_id)),submissions.find(s=>s.submission_id===item.id)||{},users));
  }

  const pendingInterviewRows = (mode === 'postgres' && store.pool)
    ? await store.query(`select * from public.interview_remove_requests where lower(coalesce(status, '')) = 'pending'`)
    : (await table('interview_remove_requests')).filter((r) => lower(r.status) === 'pending');
  const interviewRemovals = pendingInterviewRows.map((r) => {
    const candidate = candidateById.get(String(r.candidate_id));
    if (!candidate || !visibleCandidateForUser(candidate, req.user)) return null;
    return {
      type: 'interview_remove',
      id: r.request_id,
      title: `${candidate.full_name || r.candidate_id || 'Candidate'} interview date remove request`,
      status: r.status,
      requested_at: r.requested_at || r.created_at,
      candidate_id: r.candidate_id || '',
      recruiter_name: candidate.recruiter_name || r.requested_by_name || '',
      process: r.reason || '',
    };
  }).filter(Boolean);

  const pendingUnlockRows = (mode === 'postgres' && store.pool)
    ? await store.query(`select * from public.unlock_requests where (lower(coalesce(status, '')) = 'pending' or lower(coalesce(manager_review_status,''))='pending') and coalesce(auto_created,'0')<>'1'`)
    : (await table('unlock_requests')).filter((r) => (lower(r.status) === 'pending'||lower(r.manager_review_status)==='pending')&&r.auto_created!=='1');
  const currentUnlockRows=[];for(const row of pendingUnlockRows)if(await require('./learningController').requestCurrent(row))currentUnlockRows.push(row);
  const unlocks = currentUnlockRows.map((r) => {
    const requester = userById.get(String(r.user_id));
    if (!requester) return null;
    if (lower(r.manager_review_status)==='pending'&&!isAdminOrManager(req.user)) return null;
    if (r.access_kind==='youtube'?!require('./learningController').canApproveYoutube(req.user,requester):!canApproveUnlock(req.user, requester)) return null;
    return { ...approvalPayload(requester,r), candidate_id:'' };
  }).filter(Boolean);

  const pendingSuggestions = (mode === 'postgres' && store.pool)
    ? await store.query(`select * from public.suggested_videos where lower(coalesce(status, '')) = 'pending'`)
    : (await table('suggested_videos')).filter((r) => lower(r.status) === 'pending');
  const suggestions = (isAdminOrManager(req.user) ? pendingSuggestions : []).map((r) => ({
    type: 'learning', id: r.suggestion_id, title: r.title, status: r.status, requested_at: r.created_at, candidate_id: '', recruiter_name: r.suggested_by_name, process: r.category,
  }));

  const pendingAttendanceReports = (mode === 'postgres' && store.pool)
    ? await store.query(`select ${req.query?.summary ? 'report_id,status,report_type,created_at,last_run_at' : '*'} from public.scheduled_reports where lower(coalesce(report_type, '')) = 'attendance-daily' and lower(coalesce(status, '')) = 'pending'`)
    : (await table('scheduled_reports')).filter((r) => lower(r.report_type) === 'attendance-daily' && lower(r.status) === 'pending');
  const attendanceReports = (isAdminOrManager(req.user) ? pendingAttendanceReports : [])
    .map((r) => {
      const snapshot = parseSnapshot(r);
      return {
        type: 'attendance_report',
        id: r.report_id,
        title: r.title || `${snapshot.employee?.full_name || 'Employee'} Attendance Report`,
        status: r.status,
        requested_at: r.last_run_at || r.created_at,
        candidate_id: '',
        recruiter_name: snapshot.employee?.full_name || '',
        process: `${snapshot.productivity_status || '-'} • ${snapshot.recommended_day_status || '-'}`,
        attendance_report: snapshot,
      };
    });

  const submissionItems = [...candidates].sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || '')));
  const accessRows=isAdminOrManager(req.user)?(store.pool?await store.query("select * from public.crm_profile_access_requests where status='Pending' order by created_at limit 200"):(await table('crm_profile_access_requests')).filter(r=>r.status==='Pending')):[];
  const accessItems=accessRows.map(r=>({type:'profile_access',id:r.request_id,title:'Lost profile access · '+r.candidate_id,status:r.status,requested_at:r.created_at,candidate_id:r.candidate_id,recruiter_name:r.requester_name,process:r.note}));
  const allocationItems=(await require('./workspaceController').allocation.requests({pending:true})).filter(()=>isAdminOrManager(req.actorUser||req.user)).map(r=>({type:'allocation',id:r.id,title:(r.kind==='lock'?'Allocation lock':'Profile allocation')+' · '+r.candidate_id,status:r.status,requested_at:r.created_at,candidate_id:r.candidate_id,recruiter_name:r.requester_name,process:r.reason+(r.until?' · Until '+r.until:'')}));
  const opsItems = [...allocationItems,...accessItems, ...interviewRemovals, ...unlocks, ...suggestions, ...attendanceReports].sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || '')));
  const items = scope === 'submissions'
    ? submissionItems
    : scope === 'ops'
      ? opsItems
      : [...submissionItems, ...opsItems].sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || '')));
  const submissionCount = scope === 'ops' && mode === 'postgres' && store.pool
    ? Number(await store.scalar(`select count(*)::int as value from public.submissions s
          join public.candidates c on c.candidate_id = s.candidate_id
          where lower(coalesce(s.approval_status, '')) = 'pending'
            and lower(coalesce(c.approval_status, 'pending')) = 'pending'
            and ${deletedCandidateWhereSql('c')}
            and ${deletedSubmissionWhereSql('s')}
            and ${candidateScope.sql} and ${reviewScope.sql}
            and coalesce(c.candidate_id, '') <> '' and coalesce(c.full_name, '') <> ''`, reviewScope.params, 'value') || 0)
    : submissionItems.length;
  return res.json({ items, counts: { submissions: submissionCount, ops: opsItems.length, total: submissionCount + opsItems.length } });
}

async function approve(req, res) {
  if(req.body?.type==='allocation') return require('./workspaceController').allocation.decide({...req,params:{...req.params,requestId:req.body.id},body:{...req.body,approve:true}},res);
  if(req.body?.type==='profile_access'){req.params={...req.params,requestId:req.body.id};req.body={...req.body,approve:true};return require('./workspaceController').decideAccess(req,res);}
  if(req.body?.type==='youtube')return require('./learningController').resolveAccess(req,res,true);
  const { type, id } = req.body || {};
  if (type === 'candidate') {
    let submission = await store.findById('submissions', 'submission_id', id);
    let candidate = null;
    if (submission) candidate = await store.findById('candidates', 'candidate_id', submission.candidate_id);
    if (!candidate) {
      candidate = await store.findById('candidates', 'candidate_id', id);
      submission = candidate ? await resolveLatestSubmission(candidate.candidate_id) : null;
    }
    if (!candidate) return res.status(404).json({ message: 'Candidate not found' });
    if (!visibleCandidateForUser(candidate, req.user)) return res.status(403).json({ message: 'Not allowed for this team' });
    if (!canReviewSubmission(req.user,candidate,submission||{},await require('../lib/collaborationAccess').roster())) return res.status(403).json({message:'You can approve your own submission or a permitted recruiter submission. Another TL’s submission needs manager approval.'});
    if (!submission || !candidateApprovalIsPending(candidate, submission)) {
      if (approvalAlreadyCompleted(candidate, submission || {})) {
        clearAllCaches();
        return res.json({ ok: true, already_approved: true });
      }
      return res.status(409).json({ message: 'Approve allowed only after profile is submitted and pending.' });
    }
    await store.update('candidates', 'candidate_id', candidate.candidate_id, { approval_status: 'Approved', approved_at: nowIso(), approved_by_name: req.user.full_name, rejected_at: '', all_details_sent: candidate.all_details_sent || 'Pending', updated_at: nowIso() });
    await store.update('submissions', 'submission_id', submission.submission_id, { approval_status: 'Approved', approved_by_name: req.user.full_name, approved_at: nowIso(), rejected_at: '', decision_note: String(req.body?.note||'').trim().slice(0,4000), status: candidate.status || 'In - Progress' });
    const reviewNote=String(req.body?.note||'').trim().slice(0,4000);
    if(reviewNote)await store.insert('notes',{id:makeFastBigIntId(),candidate_id:candidate.candidate_id,username:req.user.username,note_type:'approval',body:`Approved: ${reviewNote}`,created_at:nowIso()});
    await safeLogActivity(req, candidate.candidate_id, 'submission_approved', { approved_by: req.user.full_name || '' });
    await notifyRecruiter(candidate, 'Profile approved', `${candidate.full_name} has been approved by ${req.user.full_name}.`, submission, { approval_status: 'Approved' },req.user);
    clearAllCaches();
    return res.json({ ok: true, item: { ...candidate, approval_status: 'Approved', approved_at: nowIso(), status: candidate.status } });
  }
  if (type === 'interview_remove') {
    const request = await store.findById('interview_remove_requests', 'request_id', id);
    if (!request) return res.status(404).json({ message: 'Interview remove request not found' });
    const candidate = await store.findById('candidates', 'candidate_id', request.candidate_id);
    if (!candidate) return res.status(404).json({ message: 'Candidate not found' });
    if (!visibleCandidateForUser(candidate, req.user)) return res.status(403).json({ message: 'Not allowed for this team' });
    const reviewSubmission = await resolveLatestSubmission(candidate.candidate_id);
    if (!canReviewSubmission(req.user,candidate,reviewSubmission||{},await require('../lib/collaborationAccess').roster())) return res.status(403).json({message:'You can approve your own submission or a permitted recruiter submission. Another TL’s submission needs manager approval.'});
    await store.update('interview_remove_requests', 'request_id', id, { status: 'Approved', approved_at: nowIso(), approved_by_name: req.user.full_name, approved_by_user_id: req.user.user_id });
    await store.update('candidates', 'candidate_id', candidate.candidate_id, {
      interview_reschedule_date: '',
      follow_up_at: '',
      interview_remove_status: 'Approved',
      interview_remove_approved_at: nowIso(),
      updated_at: nowIso(),
    });
    await safeLogActivity(req, candidate.candidate_id, 'interview_date_removed', { approved_by: req.user.full_name || '', request_id: id });
    await notifyRecruiter(candidate, 'Interview date removed', `${candidate.full_name} interview date removal was approved by ${req.user.full_name}.`, null, { approval_status: 'Approved', request_type: 'interview_remove' },req.user);
    clearAllCaches();
    return res.json({ ok: true });
  }
  if (type === 'unlock') {
    const request = await unlockForDecision(id);
    if (!request || request.access_kind==='youtube' || request.auto_created==='1') return res.status(404).json({ message: 'Explicit unlock request not found' });
    const requester = await store.findById('users', 'user_id', request.user_id) || {};
    if (!canApproveUnlock(req.user, requester)) {
      const targetRole = canonicalRole(requester);
      return res.status(403).json({ message: targetRole === 'tl' ? 'TL unlock can be approved only by Manager.' : 'You are not allowed to approve this unlock request.' });
    }
    const selfApproved=canonicalRole(req.user)==='tl'&&sameUser(req.user,requester);
    if(selfApproved&&(await store.findById('presence','user_id',requester.user_id))?.lock_reason==='manager_flag')return res.status(403).json({message:'Manager approval is required for this suspended session.'});
    if(lower(request.manager_review_status)==='pending'&&!isAdminOrManager(req.user))return res.status(403).json({message:'A manager must review this self-unlock.'});
    if(lower(request.manager_review_status)==='pending'&&isAdminOrManager(req.user)){
      await store.update('unlock_requests','request_id',id,{manager_review_status:'Approved',manager_reviewed_at:nowIso(),manager_reviewed_by:req.user.user_id,updated_at:nowIso()});
      await afterCommit(()=>{clearAllCaches();approvalLive.publishToUsers([req.user.user_id,request.user_id],'unlock-resolved',{id,status:'Approved',requester_user_id:request.user_id,review_only:true});});return res.json({ok:true,reviewed:true});
    }
    if(lower(request.status)!=='pending')return res.json({ok:true,already_resolved:true});
    await supersedeOtherUnlocks(request.user_id,id);
    await store.update('unlock_requests','request_id',id,{status:'Approved',approved_at:nowIso(),approved_by_name:req.user.full_name,approved_by_user_id:req.user.user_id,...(selfApproved?{self_approved_at:nowIso(),manager_review_status:'Pending'}:{})});
    const breakStillRunning=String((await store.findById('presence','user_id',request.user_id))?.is_on_break)==='1';
    await store.update('presence', 'user_id', request.user_id, {
      locked: '0',
      lock_reason: '',
      lock_message: '',
      unlock_grace_until: new Date(Date.now() + 60000).toISOString(),
      locked_at:'',
      last_activity_at:nowIso(),
      last_activity_source:breakStillRunning?'approved_break_workspace':'approved_unlock',
      activity_credit_at:nowIso(),
      last_seen_at: nowIso(),
      last_call_alert_sent_at: '',
      last_call_dial_at: nowIso(),
    });
    const unlockedAt=nowIso();
    const currentSession=await store.findById('active_sessions','username',requester.username);
    let resumedSession=null;
    if(currentSession?.session_token){
      if(store.pool){const rows=await store.query('update public.active_sessions set last_seen_at=$3,updated_at=$4 where username=$1 and session_token=$2 returning session_token',[requester.username,currentSession.session_token,unlockedAt,unlockedAt]);if(rows.length)resumedSession={...requester,session_token:currentSession.session_token};}
      else{await store.update('active_sessions','username',requester.username,{last_seen_at:unlockedAt,updated_at:unlockedAt});resumedSession={...requester,session_token:currentSession.session_token};}
    }
    if(resumedSession)await afterCommit(()=>require('../lib/recentHumanActivity').markRecentHumanActivity(resumedSession,Date.parse(unlockedAt)));
    await afterCommit(()=>clearAllCaches(['approvals','auth','access']));
    await makeNotification(request.user_id, 'CRM unlocked', `CRM access was restored by ${req.user.full_name}. You can continue working normally.`, 'attendance', JSON.stringify({ open_path: '/attendance' }));
    await safeLogActivity(req, '', 'crm_unlocked', { unlocked_user_id: request.user_id, request_id: id });
    await afterCommit(async()=>{
    clearAllCaches();
    approvalLive.publishToUsers([request.user_id],'unlock-resolved',{id,status:'Approved',requester_user_id:request.user_id,unlocked_at:unlockedAt});
    try {
      const users = await table('users');
      if(selfApproved){const managers=users.filter(u=>['manager','admin'].includes(canonicalRole(u)));approvalLive.publishToUsers([request.user_id],'unlock-resolved',{id,status:'Approved',requester_user_id:request.user_id,unlocked_at:nowIso()});const pending={...request,status:'Approved',manager_review_status:'Pending',self_approved_at:nowIso()};approvalLive.publishToUsers(managers.map(u=>u.user_id),'unlock',approvalPayload(requester,pending));await Promise.all(managers.map(u=>makeNotification(u.user_id,'TL self-unlocked · Review pending',`${requester.full_name} resumed work. ${request.reason}`,'attendance',JSON.stringify({request_id:id,open_path:'/approvals',manager_review:true}))));}
      else approvalLive.publishToUsers([...eligibleApprovers(users,requester).map(u=>u.user_id),request.user_id],'unlock-resolved',{id,status:'Approved',requester_user_id:request.user_id,unlocked_at:nowIso()});
    } catch {}
    });
    clearAllCaches();
    return res.json({ ok: true, id, status:'Approved', requester_user_id:request.user_id, unlocked_at:unlockedAt });
  }
  if (type === 'attendance_report') {
    const report = await store.findById('scheduled_reports', 'report_id', id);
    if (!report) return res.status(404).json({ message: 'Attendance report not found' });
    if (!isAdminOrManager(req.user)) return res.status(403).json({ message: 'Manager access required' });
    const decision = String(req.body?.decision || 'Full Day').trim();
    const note = String(req.body?.note || req.body?.reason || '').trim();
    const snapshot = attendanceReportDecisionPayload(report, decision, note, req.user);
    await store.update('scheduled_reports', 'report_id', id, {
      status: 'Approved',
      last_run_at: nowIso(),
      snapshot_json: JSON.stringify(snapshot),
    });
    await makeNotification(report.user_id, 'Attendance report approved', `Attendance report marked as ${decision} by ${req.user.full_name || req.user.username}.`, 'attendance', JSON.stringify({ open_path: '/attendance', report_id: id, decision }));
    await safeLogActivity(req, '', 'attendance_report_approved', { report_id: id, decision, note });
    clearAllCaches();
    return res.json({ ok: true, decision });
  }
  if (type === 'learning') {
    await store.update('suggested_videos', 'suggestion_id', id, { status: 'Approved', approved_at: nowIso(), approved_by_name: req.user.full_name });
    clearAllCaches();
    return res.json({ ok: true });
  }
  return res.status(400).json({ message: 'Unsupported approval type' });
}

async function reject(req, res) {
  if(req.body?.type==='allocation') return require('./workspaceController').allocation.decide({...req,params:{...req.params,requestId:req.body.id},body:{...req.body,approve:false}},res);
  if(req.body?.type==='profile_access'){req.params={...req.params,requestId:req.body.id};req.body={...req.body,approve:false};return require('./workspaceController').decideAccess(req,res);}
  if(req.body?.type==='youtube')return require('./learningController').resolveAccess(req,res,false);
  const { type, id, reason } = req.body || {};
  if (!String(reason || '').trim()) return res.status(400).json({ message: 'Reason required' });
  if (type === 'candidate') {
    let submission = await store.findById('submissions', 'submission_id', id);
    let candidate = null;
    if (submission) candidate = await store.findById('candidates', 'candidate_id', submission.candidate_id);
    if (!candidate) {
      candidate = await store.findById('candidates', 'candidate_id', id);
      submission = candidate ? await resolveLatestSubmission(candidate.candidate_id) : null;
    }
    if (!candidate) return res.status(404).json({ message: 'Candidate not found' });
    if (!visibleCandidateForUser(candidate, req.user)) return res.status(403).json({ message: 'Not allowed for this team' });
    if (!canReviewSubmission(req.user,candidate,submission||{},await require('../lib/collaborationAccess').roster())) return res.status(403).json({message:'You can approve your own submission or a permitted recruiter submission. Another TL’s submission needs manager approval.'});
    if (!['tl','manager','admin'].includes(canonicalRole(req.user))) return res.status(403).json({message:'Only TLs and managers can reject a submission.'});
    if (!submission || ![candidate.approval_status,submission.approval_status].some(value=>['pending','approved'].includes(lower(value)))) return res.status(409).json({ message: 'Only pending or approved submissions can be rejected.' });
    await store.update('candidates', 'candidate_id', candidate.candidate_id, { approval_status: 'Rejected', approved_at: '', approved_by_name: '', status: 'Rejected', rejected_at: nowIso(), updated_at: nowIso() });
    await store.update('submissions', 'submission_id', submission.submission_id, { approval_status: 'Rejected', decision_note: reason, approved_at: '', approved_by_name: '', rejected_at: nowIso(), status: 'Rejected' });
    await store.insert('notes', { id: makeFastBigIntId(), candidate_id: candidate.candidate_id, username: req.user.username, note_type: 'rejection', body: `Rejected: ${reason}`, created_at: nowIso() });
    await safeLogActivity(req, candidate.candidate_id, 'submission_rejected', { reason });
    await notifyRecruiter(candidate, 'Approval rejected', `${candidate.full_name} approval was rejected. Reason: ${reason}`, submission, { approval_status: 'Rejected', reason },req.user);
    clearAllCaches();
    return res.json({ ok: true, item: { ...candidate, approval_status: 'Rejected', status: 'Rejected', approved_at:'',approved_by_name:'',rejected_at:nowIso() } });
  }
  if (type === 'interview_remove') {
    const request = await store.findById('interview_remove_requests', 'request_id', id);
    if (!request) return res.status(404).json({ message: 'Interview remove request not found' });
    const candidate = await store.findById('candidates', 'candidate_id', request.candidate_id);
    if (!candidate) return res.status(404).json({ message: 'Candidate not found' });
    if (!visibleCandidateForUser(candidate, req.user)) return res.status(403).json({ message: 'Not allowed for this team' });
    const reviewSubmission = await resolveLatestSubmission(candidate.candidate_id);
    if (!canReviewSubmission(req.user,candidate,reviewSubmission||{},await require('../lib/collaborationAccess').roster())) return res.status(403).json({message:'You can approve your own submission or a permitted recruiter submission. Another TL’s submission needs manager approval.'});
    await store.update('interview_remove_requests', 'request_id', id, { status: 'Rejected', reason, approved_at: nowIso(), approved_by_name: req.user.full_name, approved_by_user_id: req.user.user_id });
    await store.update('candidates', 'candidate_id', candidate.candidate_id, { interview_remove_status: 'Rejected', updated_at: nowIso() });
    await safeLogActivity(req, candidate.candidate_id, 'interview_date_removal_rejected', { reason, request_id: id });
    await notifyRecruiter(candidate, 'Interview date removal rejected', `${candidate.full_name} interview date removal request was rejected. Reason: ${reason}`, null, { approval_status: 'Rejected', request_type: 'interview_remove', reason },req.user);
    clearAllCaches();
    return res.json({ ok: true });
  }
  if (type === 'unlock') {
    const request = await unlockForDecision(id);
    if (!request || request.access_kind==='youtube' || request.auto_created==='1') return res.status(404).json({ message: 'Explicit unlock request not found' });
    const requester = await store.findById('users', 'user_id', request.user_id) || {};
    if(req.body.flag_session===true){
      if(!isAdminOrManager(req.user))return res.status(403).json({message:'Only a manager can suspend a session.'});
      if(lower(request.manager_review_status)==='flagged')return res.json({ok:true,reviewed:true,session_suspended:true,already_flagged:true});
      if(lower(request.manager_review_status)!=='pending')return res.status(409).json({message:'This self-unlock review is already resolved.'});
    }

    if (!canApproveUnlock(req.user, requester)) {
      const targetRole = canonicalRole(requester);
      return res.status(403).json({ message: targetRole === 'tl' ? 'TL unlock can be rejected only by Manager.' : 'You are not allowed to reject this unlock request.' });
    }
    if(lower(request.manager_review_status)==='pending'){if(!isAdminOrManager(req.user))return res.status(403).json({message:'Only a manager can review this self-unlock.'});
    if(req.body.flag_session===true){
     const stamp=nowIso();await store.update('unlock_requests','request_id',id,{manager_review_status:'Flagged',manager_reviewed_at:stamp,manager_reviewed_by:req.user.user_id,manager_review_note:reason,updated_at:stamp});
     await store.update('presence','user_id',request.user_id,{locked:'1',locked_at:stamp,lock_reason:'manager_flag',lock_message:'Session suspended by a manager. Request manager approval to resume.',unlock_grace_until:'',last_activity_source:'manager_flag',updated_at:stamp});
     const session=await store.findById('active_sessions','username',requester.username);if(session)await store.update('active_sessions','username',requester.username,{session_token:'',status:'Logged Out',revoked_at:stamp,logout_at:stamp,updated_at:stamp});
     await afterCommit(async()=>{clearAllCaches();await require('../middleware/auth').revokeMobilePairingForExpiredCrmSession(requester,'manager_flag_session_suspended');require('./mobileDialerController').invalidateMobileSessionForLogout(request.user_id);approvalLive.publishToUsers([request.user_id],'self-locked',{request_id:id,reason:'manager_flag',message:'Manager suspended this session.'});approvalLive.publishToUsers([req.user.user_id,request.user_id],'unlock-resolved',{id,status:'Flagged',requester_user_id:request.user_id});require('../lib/recentHumanActivity').markInactive({...requester,session_token:session?.session_token},session?.session_token);});
     return res.json({ok:true,reviewed:true,session_suspended:true});
    }
    await store.update('unlock_requests','request_id',id,{manager_review_status:'Rejected',manager_reviewed_at:nowIso(),manager_reviewed_by:req.user.user_id,manager_review_note:reason,updated_at:nowIso()});await makeNotification(request.user_id,'Self-unlock reviewed',`Manager review: ${reason}`,'attendance',JSON.stringify({open_path:'/attendance'}));approvalLive.publishToUsers([req.user.user_id,request.user_id],'unlock-resolved',{id,status:'Rejected',requester_user_id:request.user_id});clearAllCaches();return res.json({ok:true,reviewed:true});}
    if(lower(request.status)!=='pending')return res.json({ok:true,already_resolved:true});
    await supersedeOtherUnlocks(request.user_id,id);
    await store.update('unlock_requests', 'request_id', id, { status: 'Rejected', reason, approved_at: nowIso(), approved_by_name: req.user.full_name, approved_by_user_id: req.user.user_id });
    await makeNotification(request.user_id, 'Unlock request rejected', `Unlock request was rejected by ${req.user.full_name}. Reason: ${reason}`, 'attendance', JSON.stringify({ open_path: '/attendance' }));
    try {
      const users = await table('users');
      approvalLive.publishToUsers([...eligibleApprovers(users, requester).map((u) => u.user_id), request.user_id], 'unlock-resolved', { id, status: 'Rejected', requester_user_id: request.user_id });
    } catch {}
    clearAllCaches();
    return res.json({ ok: true });
  }
  if (type === 'attendance_report') {
    const report = await store.findById('scheduled_reports', 'report_id', id);
    if (!report) return res.status(404).json({ message: 'Attendance report not found' });
    if (!isAdminOrManager(req.user)) return res.status(403).json({ message: 'Manager access required' });
    const decision = String(req.body?.decision || 'Half Day').trim();
    const note = String(reason || '').trim();
    const snapshot = attendanceReportDecisionPayload(report, decision, note, req.user);
    await store.update('scheduled_reports', 'report_id', id, {
      status: 'Rejected',
      last_run_at: nowIso(),
      snapshot_json: JSON.stringify(snapshot),
    });
    await makeNotification(report.user_id, 'Attendance report reviewed', `Attendance report was reviewed as ${decision}. Reason: ${note}`, 'attendance', JSON.stringify({ open_path: '/attendance', report_id: id, decision, reason: note }));
    await safeLogActivity(req, '', 'attendance_report_rejected', { report_id: id, decision, reason: note });
    clearAllCaches();
    return res.json({ ok: true, decision });
  }
  if (type === 'learning') {
    await store.update('suggested_videos', 'suggestion_id', id, { status: 'Rejected', rejection_reason: reason, approved_at: nowIso(), approved_by_name: req.user.full_name });
    clearAllCaches();
    return res.json({ ok: true });
  }
  return res.status(400).json({ message: 'Unsupported approval type' });
}


// CC26_628: manager-only, one scoped query on a new login; never load candidates,
// employee credentials, old messages, or the complete approvals table.
async function attendancePending(req, res) {
  const role = canonicalRole(req.user);
  if (role !== 'manager' && role !== 'admin') return res.status(403).json({ message: 'Manager access required' });
  let pending = [];
  if (mode === 'postgres' && store.pool) {
    pending = await store.query(`select report_id, title from public.scheduled_reports
      where lower(coalesce(report_type, '')) = 'attendance-daily'
        and lower(coalesce(status, '')) = 'pending'
      order by last_run_at desc nulls last, created_at desc nulls last limit 51`);
  } else {
    pending = (await table('scheduled_reports'))
      .filter(r => lower(r.report_type) === 'attendance-daily' && lower(r.status) === 'pending')
      .slice(0, 51).map(r => ({ report_id: r.report_id, title: r.title }));
  }
  res.set('Cache-Control', 'no-store');
  return res.json({ ok: true, count: Math.min(50, pending.length), has_more: pending.length > 50,
    items: pending.slice(0, 3).map(r => ({ id: String(r.report_id || ''), title: String(r.title || 'Attendance report') })) });
}

async function stream(req, res) {
  // CC26_760: establish one push connection, then send at most one already-pending
  // unlock item on that same stream. No recurring approval polling is required.
  approvalLive.attach(req, res);
  try {
    const pending = (store.pool && typeof store.query === 'function')
      ? await store.query(`select * from public.unlock_requests where (lower(coalesce(status,'')) = 'pending' or lower(coalesce(manager_review_status,''))='pending') and coalesce(auto_created,'0')<>'1' order by requested_at desc nulls last, created_at desc nulls last limit 30`)
      : (await table('unlock_requests')).filter((row) => (lower(row.status) === 'pending'||lower(row.manager_review_status)==='pending')&&row.auto_created!=='1').sort((a,b) => String(b.requested_at || b.created_at || '').localeCompare(String(a.requested_at || a.created_at || ''))).slice(0, 30);
    if (!pending.length || res.writableEnded) return;
    const users = await table('users');
    const byId = new Map(users.map((u) => [String(u.user_id || ''), u]));
    const current=[];for(const item of pending)if(await require('./learningController').requestCurrent(item))current.push(item);
    const row = current.find((item) => (!item.manager_review_status||lower(item.manager_review_status)!=='pending'||isAdminOrManager(req.user))&&(item.access_kind==='youtube'?require('./learningController').canApproveYoutube(req.user,byId.get(String(item.user_id || '')) || {}):canApproveUnlock(req.user, byId.get(String(item.user_id || '')) || {})));
    if (!row || res.writableEnded) return;
    const requester = byId.get(String(row.user_id || '')) || { user_id: row.user_id, username: row.username, full_name: row.full_name };
    res.write(`event: unlock\ndata: ${JSON.stringify(approvalPayload(requester, row))}\n\n`);
  } catch (error) {
    try { console.warn('Approval stream initial snapshot skipped:', error?.message || error); } catch {}
  }
}

async function approveAll(req, res) {
  const submissions = (await table('submissions')).filter((s) => lower(s.approval_status) === 'pending');
  for (const submission of submissions) {
    const candidate = await store.findById('candidates', 'candidate_id', submission.candidate_id);
    if (!candidate || !candidateApprovalIsPending(candidate, submission) || !canReviewSubmission(req.user,candidate,submission,await require('../lib/collaborationAccess').roster())) continue;
    await store.update('candidates', 'candidate_id', candidate.candidate_id, { approval_status: 'Approved', approved_at: nowIso(), approved_by_name: req.user.full_name, rejected_at: '', updated_at: nowIso() });
    await store.update('submissions', 'submission_id', submission.submission_id, { approval_status: 'Approved', approved_by_name: req.user.full_name, approved_at: nowIso(), rejected_at: '', decision_note: String(req.body?.note||'').trim().slice(0,4000), status: candidate.status || 'In - Progress' });
    const reviewNote=String(req.body?.note||'').trim().slice(0,4000);
    if(reviewNote)await store.insert('notes',{id:makeFastBigIntId(),candidate_id:candidate.candidate_id,username:req.user.username,note_type:'approval',body:`Approved: ${reviewNote}`,created_at:nowIso()});
    await safeLogActivity(req, candidate.candidate_id, 'submission_approved', { approved_by: req.user.full_name || '', bulk: true });
    await notifyRecruiter(candidate,'Profile approved',candidate.full_name+' was approved by '+(req.user.full_name||req.user.username)+'.',submission,{approval_status:'Approved'},req.user);
  }
  clearAllCaches();
  return res.json({ ok: true });
}

module.exports = { list, approve, reject, approveAll, stream, attendancePending };

const { transactionalHandler } = require('../lib/store');
module.exports.approve = transactionalHandler(approve);
module.exports.reject = transactionalHandler(reject);

// CC933_SUBMISSION_POPUP_STATUS_FIX
const reviewStopped = new Set(["not interested","not intrested","non interested","non intrested","notinterested","notintrested","noninterested","nonintrested","i am not interested","rejected","reject","not responding","not response","no response","unresponsive","not looking","not looking for job","declined","cancelled","canceled","closed","deleted","archived","draft","backout","back out","not joined","notjoined"]);
const reviewStatusFields = ["status","candidate_status","profile_status","interview_status","submission_status","approval_status","candidate_approval_status","submission_approval_status"];
function reviewNormalize(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function submissionReviewIsClosed(row = {}) {
  if (String(row.deleted_at || '').trim() || String(row.data_notes || '').toLowerCase().includes('[crm-deleted]')) return true;
  if (reviewStatusFields.some(key => reviewStopped.has(reviewNormalize(row[key])))) return true;
  return ['approval_status','candidate_approval_status','submission_approval_status'].some(key => {
    const value = reviewNormalize(row[key]);
    return value && value !== 'pending';
  });
}

async function submissionReviewQueue(req, res) {
  if (!['manager','admin','tl'].includes(canonicalRole(req.user))) return res.status(403).json({message:'TL or Manager access required'});
  const users = await require('../lib/collaborationAccess').roster();
  const limit = Math.max(1, Math.min(100, Number(req.query?.limit) || 50));
  let rows = [];
  if (mode === 'postgres' && store.pool) {
    const scope = candidateScopeSql('c', req.user, []);
    const review = submissionReviewScopeSql('c', 's', req.user, [...scope.params]);
    const values = [...reviewStopped].map(value => "'" + value.replace(/'/g, "''") + "'").join(',');
    const closedSql = alias => '(' + reviewStatusFields.map(key =>
      "trim(regexp_replace(lower(coalesce(to_jsonb(" + alias + ")->>'" + key + "','')),'[^a-z0-9]+',' ','g')) in (" + values + ")"
    ).join(' or ') + ')';
    rows = await store.query(`select 'candidate' as type,s.submission_id as id,c.candidate_id,c.full_name as title,
      c.status,c.approval_status,c.deleted_at,s.status as submission_status,s.approval_status as submission_approval_status,
      c.recruiter_user_id,c.recruiter_code,c.recruiter_designation,c.recruiter_name,c.process,c.notes as profile_note,
      coalesce(s.approval_requested_at,s.submitted_at,c.approval_requested_at) as requested_at
      from public.submissions s join public.candidates c on c.candidate_id=s.candidate_id
      where lower(trim(coalesce(s.approval_status,'')))='pending' and lower(trim(coalesce(c.approval_status,'')))='pending'
      and not ${closedSql('c')} and not ${closedSql('s')}
      and ${deletedCandidateWhereSql('c')} and ${deletedSubmissionWhereSql('s')}
      and ${scope.sql} and ${review.sql}
      order by coalesce(s.approval_requested_at,s.submitted_at,'') desc limit ${limit}`, review.params);
  } else {
    const candidates = new Map((await table('candidates')).map(row => [String(row.candidate_id), row]));
    rows = (await table('submissions')).map(sub => {
      const candidate = candidates.get(String(sub.candidate_id));
      if (!candidate || !candidateApprovalIsPending(candidate, sub) || submissionReviewIsClosed(candidate) || submissionReviewIsClosed(sub) || !canReviewSubmission(req.user, candidate, sub, users)) return null;
      return {type:'candidate',id:sub.submission_id,candidate_id:candidate.candidate_id,title:candidate.full_name,
        status:candidate.status,approval_status:candidate.approval_status,deleted_at:candidate.deleted_at,
        submission_status:sub.status,submission_approval_status:sub.approval_status,
        ...require('../lib/approvalLive').ownerLabels(candidate),process:candidate.process,
        profile_note:String(candidate.notes || '').slice(-1000),requested_at:sub.approval_requested_at || sub.submitted_at || candidate.approval_requested_at};
    }).filter(Boolean).sort((a,b) => String(b.requested_at || '').localeCompare(String(a.requested_at || ''))).slice(0, limit);
  }
  const items = rows.filter(row => !submissionReviewIsClosed(row)).map(row => ({...row,...require('../lib/approvalLive').ownerLabels(row),profile_note:String(row.profile_note || '').slice(-1000)}));
  const paused = await require('../lib/reminderPause').decorate(items, req.user);
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json({ok:true,items:paused.items,reminder_pauses:paused.pauses,has_more:items.length === limit});
}
module.exports.submissionReviewQueue=submissionReviewQueue;

module.exports.selfUnlock=async function(req,res){
 if(canonicalRole(req.user)!=='tl')return res.status(403).json({message:'Recruiters need their TL to unlock CRM.'});
 const reason=String(req.body?.reason||'').trim();if(reason.length<5||reason.length>500)return res.status(400).json({message:'Enter a reason of 5–500 characters.'});
 const presence=await store.findById('presence','user_id',req.user.user_id);
 if(!presence)return res.status(400).json({message:'Join Office before resuming work.'});
 if(presence.lock_reason==='manager_flag')return res.status(403).json({message:'A manager suspended this session. Request manager approval to resume.'});
 if(String(presence.locked)!=='1')return res.json({ok:true,already_unlocked:true});
 const result=await require('../lib/unlockService').ensureUnlockRequestForUser(req.user,reason,{autoCreated:false,notifyExisting:true,selfApprove:true});
 if(!result.item)return res.status(409).json({message:'Unlock request could not be created.'});
 req.body={type:'unlock',id:result.item.request_id};return approve(req,res);
};

module.exports.pendingCounts=async function(user){return list({user,query:{scope:'ops',summary:true}},{json:data=>data.counts});};
module.exports.requestStatus=async function(req,res){
 const user=req.actorUser||req.user,manager=isAdminOrManager(user),id=String(user.user_id);
 const accessRows=store.pool?await store.query('select request_id,candidate_id,user_id,requester_name,note,status,created_at,decided_at from public.crm_profile_access_requests'+(manager?'':' where user_id=$1')+' order by created_at desc limit 100',manager?[]:[id]):(await table('crm_profile_access_requests')).filter(row=>manager||String(row.user_id)===id).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,100);
 const unlockRows=store.pool?await store.query("select request_id,user_id,full_name,reason,status,requested_at,approved_at,access_kind,manager_review_status from public.unlock_requests where coalesce(auto_created,'0')<>'1'"+(manager?'':' and user_id=$1')+" order by requested_at desc limit 100",manager?[]:[id]):(await table('unlock_requests')).filter(row=>row.auto_created!=='1'&&(manager||String(row.user_id)===id)).sort((a,b)=>String(b.requested_at).localeCompare(String(a.requested_at))).slice(0,100);
 let submissionRows;
 if(store.pool)submissionRows=(await store.query("select to_jsonb(s) as submission,c.full_name from public.submissions s left join public.candidates c on c.candidate_id=s.candidate_id"+(manager?'':" where to_jsonb(s)->>'submitted_by_user_id'=$1 or c.recruiter_user_id=$1")+" order by coalesce(nullif(to_jsonb(s)->>'approved_at',''),nullif(to_jsonb(s)->>'rejected_at',''),to_jsonb(s)->>'submitted_at','') desc limit 100",manager?[]:[id])).map(row=>({...row.submission,full_name:row.full_name}));
 else{const candidates=new Map((await table('candidates')).map(row=>[String(row.candidate_id),row]));submissionRows=(await table('submissions')).filter(row=>manager||String(row.submitted_by_user_id)===id||String(candidates.get(String(row.candidate_id))?.recruiter_user_id)===id).slice(-100).map(row=>({...row,full_name:candidates.get(String(row.candidate_id))?.full_name}));}
 const items=[...accessRows.map(row=>({id:row.request_id,type:'Profile access',title:row.candidate_id,requested_by:row.requester_name,status:row.status,note:row.note,at:row.decided_at||row.created_at,candidate_id:row.status==='Approved'?row.candidate_id:''})),...unlockRows.map(row=>({id:row.request_id,type:row.access_kind==='youtube'?'YouTube access':'CRM unlock',title:row.full_name,requested_by:row.full_name,status:row.manager_review_status==='Pending'?'Manager review pending':row.status,note:row.reason,at:row.approved_at||row.requested_at}))].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,100);
 const allocationHistory=await require('./workspaceController').allocation.requests({user,all:manager});
 const history=[...allocationHistory.map(r=>({id:r.id,type:r.kind==='lock'?'Allocation lock':'Profile allocation',title:r.candidate_name||r.candidate_id,requested_by:r.requester_name,status:r.status,note:r.reason+(r.until?' · Until '+r.until:''),at:r.decided_at||r.created_at,candidate_id:r.candidate_id})),...items,...submissionRows.filter(row=>/^(pending|approved|rejected)$/i.test(row.approval_status||'')).map(row=>({id:row.submission_id,type:'Profile submission',title:row.full_name||row.candidate_id,requested_by:row.submitted_by_name||'',status:row.approval_status,note:row.decision_note||'',at:row.approved_at||row.rejected_at||row.approval_requested_at||row.submitted_at,candidate_id:row.candidate_id}))].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,150);
 res.set('Cache-Control','private, no-store');return res.json({items:history});
};
