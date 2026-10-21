const streams = new Map();
const streamUsers = new Map();
let staffRoster=[];
function setStaffRoster(users=[]) { staffRoster=users; }
function ownerLabels(row={}) {
  const text=v=>String(v||'').trim(), low=v=>text(v).toLowerCase();
  const oid=text(row.recruiter_user_id||row.assigned_to_user_id||row.owner_user_id);
  const code=low(row.recruiter_code||row.assigned_to_code);
  const name=low(row.recruiter_name||row.assigned_to_name||row.owner_name);
  const owner=staffRoster.find(u=>oid?text(u.user_id)===oid:code?low(u.recruiter_code)===code:name&&[u.full_name,u.username].some(v=>low(v)===name));
  const ownerRole=roleOf(owner||{role:row.recruiter_designation||row.owner_role});
  const tlId=ownerRole==='tl'?text(owner?.user_id):text(owner?.tl_user_id||owner?.team_lead_user_id||owner?.reporting_tl_user_id||owner?.reports_to_user_id||owner?.reporting_manager_user_id||row.tl_user_id);
  const tlCode=low(owner?.tl_code||owner?.team_lead_code||owner?.reporting_tl_code||owner?.reports_to_code||row.tl_code);
  const tlName=text(owner?.tl_name||owner?.team_lead_name||owner?.reports_to_name||row.tl_name);
  const tl=staffRoster.find(u=>roleOf(u)==='tl'&&(tlId?text(u.user_id)===tlId:tlCode?low(u.recruiter_code)===tlCode:tlName&&low(u.full_name)===low(tlName)));
  const ownerName=text(owner?.full_name||row.recruiter_name||row.assigned_to_name||row.owner_name||owner?.username||row.recruiter_code||'Unassigned');
  return {owner_name:ownerName,owner_role:ownerRole||'recruiter',recruiter_name:ownerName,recruiter_user_id:text(owner?.user_id||oid),tl_name:text(tl?.full_name||tl?.username||tlName),tl_user_id:text(tl?.user_id||tlId)};
}

function userKey(user = {}) {
  return String(user?.user_id || user?.id || user?.username || '').trim();
}

function attach(req, res) {
  const key = userKey(req.user);
  if (!key) return res.status(401).json({ message: 'Not authenticated' });
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (typeof res.flushHeaders === 'function') res.flushHeaders();
  const set = streams.get(key) || new Set();
  if(set.size>=2){const oldest=set.values().next().value;try{oldest.end();}catch{}set.delete(oldest);}
  set.add(res);
  streams.set(key, set);
  streamUsers.set(key, { ...(req.user || {}) });
  const untrackIdle = require('./recentHumanActivity').registerStream(req.user, res);
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, transport: 'sse' })}\n\n`);
  const heartbeat = setInterval(() => {
    // CC26_760: session inactivity owns stream shutdown. Do not force periodic reconnects.
    try { res.write(': keepalive\n\n'); }
    catch { cleanup(); }
  }, 45000);
  heartbeat.unref?.();
  function cleanup() {
    clearInterval(heartbeat);
    untrackIdle();
    const current = streams.get(key);
    if (!current) return;
    current.delete(res);
    if (!current.size) { streams.delete(key); streamUsers.delete(key); }
  }
  res.on('close', cleanup);
  req.on('aborted', cleanup);
}

function publishToUsers(userIds = [], event = 'approval', payload = {}) {
  const ids = new Set((userIds || []).map((value) => String(value || '').trim()).filter(Boolean));
  if (!ids.size) return 0;
  if(event==='access-changed')try{require('../controllers/mobileDialerController').publishMobileAccessInvalidation?.([...ids],payload)}catch{}
  if (event === 'dialer-live') {
    const owner = String(payload.call?.employee_user_id || payload.session?.assigned_user_id || [...ids][0]);
    for (const [id, viewer] of streamUsers) {
      if (['admin','manager'].includes(roleOf(viewer)) || roleOf(viewer)==='tl' && (viewer.__ccTeamUserIds || []).map(String).includes(owner)) ids.add(id);
    }
  }
  let delivered = 0;
  for (const id of ids) {
    const set = streams.get(id);
    if (!set) continue;
    for (const res of [...set]) {
      try {
        const out = event==='dialer-live' && !userIds.map(String).includes(id) ? {...payload,team_only:true} : payload;
        if(res.writableLength>262144){res.end();set.delete(res);continue;}
        res.write(`event: ${event}\ndata: ${JSON.stringify(out || {})}\n\n`);
        delivered += 1;
      } catch {
        try { res.end(); } catch {}
        set.delete(res);
      }
    }
    if (!set.size) streams.delete(id);
  }
  return delivered;
}

function roleOf(user = {}) {
  const raw = String(user.role || user.designation || '').trim().toLowerCase();
  if (raw.includes('admin')) return 'admin';
  if (raw.includes('manager')) return 'manager';
  if (raw === 'tl' || raw.includes('team lead') || raw.includes('teamlead')) return 'tl';
  if (raw.includes('recruiter')) return 'recruiter';
  return raw;
}
function lower(value) { return String(value || '').trim().toLowerCase(); }
function refreshStaffScopes(users=[]) {
  setStaffRoster(users);
  for (const [id, viewer] of streamUsers) {
    const current=users.find(u=>String(u.user_id)===id);
    if (!current) continue;
    const team=users.filter(u=>{
      if(roleOf(u)!=='recruiter')return false;
      const ownerId=String(u.tl_user_id||u.team_lead_user_id||u.reporting_tl_user_id||u.reports_to_user_id||u.reporting_manager_user_id||'');
      const ownerCode=lower(u.tl_code||u.team_lead_code||u.reporting_tl_code||u.reports_to_code||u.reporting_manager_code);
      const ownerName=lower(u.tl_name||u.team_lead_name||u.reporting_tl_name||u.reports_to_name||u.reporting_manager_name);
      if(ownerId)return ownerId===id;
      if(ownerCode)return ownerCode===lower(current.recruiter_code);
      return Boolean(ownerName&&ownerName===lower(current.full_name||current.username));
    });
    const roster=[current,...team];
    streamUsers.set(id,{...viewer,...current,__ccTeamUserIds:roster.map(u=>String(u.user_id)),__ccTeamCodes:roster.map(u=>u.recruiter_code).filter(Boolean),__ccTeamNames:roster.flatMap(u=>[u.full_name,u.username]).filter(Boolean)});
  }
}
function viewerOwnsActor(viewer = {}, actor = {}) {
  if(actor.candidate_id){const acl=require('./accessRules');return acl.isAdminOrManager(viewer)||acl.candidateBelongsToTeam(actor,viewer);}
  const viewerRole = roleOf(viewer);
  if (viewerRole === 'admin' || viewerRole === 'manager') return true;
  const actorId = String(actor.recruiter_user_id || actor.assigned_to_user_id || actor.created_by_user_id || actor.user_id || actor.id || '').trim();
  const actorCode = lower(actor.recruiter_code || actor.employee_code || actor.assigned_to_code || '');
  const actorNames = [actor.recruiter_name,actor.assigned_to_name,actor.full_name,actor.username,actor.name].map(lower).filter(Boolean);
  if (viewerRole === 'tl') {
    const ids = new Set([viewer.user_id, ...(viewer.__ccTeamUserIds || [])].map((v) => String(v || '').trim()).filter(Boolean));
    const codes = new Set([viewer.recruiter_code, ...(viewer.__ccTeamCodes || [])].map(lower).filter(Boolean));
    const names = new Set([viewer.full_name, viewer.username, ...(viewer.__ccTeamNames || [])].map(lower).filter(Boolean));
    return Boolean((actorId && ids.has(actorId)) || (actorCode && codes.has(actorCode)) || actorNames.some((name) => names.has(name)));
  }
  const viewerId = String(viewer.user_id || viewer.id || '').trim();
  const viewerCode = lower(viewer.recruiter_code || viewer.employee_code || '');
  const viewerNames = new Set([viewer.full_name, viewer.username, viewer.name].map(lower).filter(Boolean));
  return Boolean((actorId && viewerId && actorId === viewerId) || (actorCode && viewerCode && actorCode === viewerCode) || actorNames.some((name) => viewerNames.has(name)));
}
// Small permission-filtered row patch on the existing stream. No new DB read.
const LIVE_FIELDS = ['deleted_at','project_id','candidate_id','submission_id','task_id','interview_id','follow_up_id','full_name','candidate_name','phone','location','preferred_location','qualification_level','process','communication_skill','recruiter_name','recruiter_code','recruiter_user_id','status','candidate_status','approval_status','all_details_sent','submission_date','submitted_at','approval_requested_at','submission_origin_at','updated_at','created_at','scheduled_at','interview_date','interview_reschedule_date','follow_up_at','next_follow_up_at','reminder_snoozed_until','bucket_allocated_at','bucket_expires_at','bucket_is_bucket_out','title','description','assigned_to_user_id','assigned_to_name','assigned_to_code','created_by_user_id','created_by_name','priority','due_date','due_at','reminder_at','closed_at','recurring_parent_task_id','recurring_type','recurring_interval_minutes'];
function compactLiveRow(row={}) {
  const out={};
  for(const field of [...LIVE_FIELDS,'bucket_assigned_at']) {
    const value=row[field];
    if(value===undefined||value===null||!['string','number','boolean'].includes(typeof value))continue;
    // A partial update must never turn a shortened preview into saved field data.
    if(typeof value==='string'&&value.length>(field==='description'?4000:1000))continue;
    out[field]=value;
  }
  return out;
}
function publishReminderDirty(actor = {}, payload = {}) {
  if(actor.candidate_id)try{require('../controllers/mobileDialerController').publishCandidateDisposition?.(actor);}catch{}
  let delivered = 0;
  const actorKey = userKey(actor);
  for (const [key, set] of streams) {
    const viewer = streamUsers.get(key) || {};
    // CC26_765: include the actor too. The production bundle does not emit a reliable
    // local career-crox-data-written event for every write, so excluding the actor could
    // leave their reminder snapshot stale forever. This is one tiny SSE invalidation only.
    if (!(['/flowchart/team','/revenue-hub/config'].includes(payload.source) && !actorKey) && !viewerOwnsActor(viewer, actor)) continue;
    const acl=require('./accessRules');const canSeeRow=!actor.candidate_id||acl.visibleCandidateForUser(actor,viewer)||acl.isDeletedCandidate(actor)&&(acl.isAdminOrManager(viewer)||acl.candidateBelongsToTeam(actor,viewer));
    for (const res of [...set]) {
      try {
        res.write(`event: reminder-dirty\ndata: ${JSON.stringify({ source: String(payload.source || ''), resource_id:String(payload.resource_id || ''), at: Number(payload.at || Date.now()), item:canSeeRow?compactLiveRow(actor):{}, meta:canSeeRow?(payload.meta||{}):{} })}\n\n`);
        if(canSeeRow&&payload.meta?.submitted&&require('./accessRules').canReviewSubmission(viewer,actor,payload.meta.submission||{},staffRoster)){
          const sub=payload.meta?.submission||{};const id=String(sub.submission_id||actor.submission_id||'');
          if(id&&actor.candidate_id)res.write(`event: submission-review\ndata: ${JSON.stringify({type:'candidate',id,candidate_id:actor.candidate_id,title:actor.full_name||actor.candidate_name||'Candidate',...ownerLabels(actor),process:actor.process||'',profile_note:String(actor.notes||'').slice(-1000),requested_at:sub.approval_requested_at||sub.submitted_at||actor.approval_requested_at||actor.submitted_at||new Date().toISOString()})}\n\n`);
        }
        delivered += 1;
      } catch {
        try { res.end(); } catch {}
        set.delete(res);
      }
    }
    if (!set.size) { streams.delete(key); streamUsers.delete(key); }
  }
  return delivered;
}

function refreshCollaborationScopes(config,users){for(const [key,viewer] of streamUsers)streamUsers.set(key,require('./collaborationAccess').hydrateFrom(viewer,config,users));}
module.exports = { ownerLabels,setStaffRoster,refreshCollaborationScopes, attach, publishToUsers, publishReminderDirty, refreshStaffScopes };

module.exports.disconnectAll=function(){for(const set of streams.values())for(const res of set)try{res.end();}catch{}streams.clear();streamUsers.clear();};
