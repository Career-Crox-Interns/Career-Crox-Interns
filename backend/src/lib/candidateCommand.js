const crypto = require('crypto');
const { store, withTransaction, callController, activeTransactionClient } = require('./store');
const { visibleCandidateForUser } = require('./accessRules');
const { assertCandidateIdentityStable, withManagerCorrection } = require('./candidateIdentityGuard');
// CC912_IDENTITY_SAVE_FIX

const WORKFLOW_VERSION = 'profile-commit-v2';
const RELEASE = 'CC861';
const PROTECTED_FIELDS = new Set([
  'candidate_id', 'created_at', 'updated_at', 'approval_status',
  'approval_requested_at', 'approved_at', 'approved_by_name', 'submitted_by',
  'created_by_user_id', 'created_by_name', 'user_id', 'recruiter_user_id',
  'last_viewed_at', 'last_viewed_by_name', 'previous_last_viewed_at',
  'previous_last_viewed_by_name', 'notes', 'last_updated_at',
  'bucket_state',
]);
function fail(status, message, code) {
  throw Object.assign(new Error(message), { status, code });
}
function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (plainObject(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function profileFields(input, allowed) {
  const fields = {};
  const edited = Array.isArray(input._changed_fields) ? new Set(input._changed_fields) : null;
  for (const [key, value] of Object.entries(input)) {
    if (edited && !edited.has(key)) continue;
    if (key.startsWith('_') || PROTECTED_FIELDS.has(key) || !allowed.has(key)) continue;
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
      fail(400, `Invalid value for ${key}.`, 'INVALID_PROFILE_FIELDS');
    }
    fields[key] = value === null ? '' : String(value);
  }
  return fields;
}

// Three-way draft merge. A lock serializes writes; the baseline prevents the
// second editor from replacing a newer snapshot after waiting for that lock.
function mergeDraftSnapshot(old,input,fields,note){
 if(!old)return{fields,note};
 const saved=JSON.parse(old.fields_json||'{}'),savedNote=JSON.parse(old.note_json||'null');
 if(String(input.draft_updated_at||'')===String(old.updated_at||''))return{fields,note};
 const base=plainObject(input.draft_base_fields)?input.draft_base_fields:{},merged={...saved},conflicts=[];
 for(const [key,value]of Object.entries(fields)){
  if(key.startsWith('_'))continue;
  const same=(a,b)=>String(a??'')===String(b??'');
  if(same(value,saved[key])||same(value,base[key]))continue;
  if(!same(saved[key],base[key]))conflicts.push(key);else merged[key]=value;
 }
 const body=value=>String(value?.body||'').trim(),baseNote=input.draft_base_note||null;
 let nextNote=savedNote;
 if(body(note)!==body(baseNote)&&body(note)!==body(savedNote)){
  if(body(savedNote)!==body(baseNote))conflicts.push('master_notes');else nextNote=note;
 }
 if(conflicts.length)throw Object.assign(new Error('This draft changed in another tab or by another team member. Review the highlighted edits; your device copy is kept.'),{status:409,code:'DRAFT_CONFLICT',payload:{code:'DRAFT_CONFLICT',committed:false,conflict_fields:conflicts,current_fields:saved,current_note:savedNote,draft_updated_at:old.updated_at}});
 return{fields:merged,note:nextNote};
}

// Failed commits are logged OUTSIDE the rolled-back candidate transaction.
// Never store candidate name, phone, notes, or resume in the incident journal.
async function recordFailedSubmission(req, error) {
  if (String(req.body?.action || '').toLowerCase() === 'save') return;
  const eventId = crypto.randomUUID();
  const actor = String(req.user?.user_id || req.user?.username || '').slice(0,128);
  const commandId = String(req.body?.command_id || '').slice(0,128);
  const draftId = String(req.body?.draft_id || '').slice(0,128);
  const code = String(error?.code || 'UNCLASSIFIED').slice(0,64);
  const incident = { event_id:eventId, user_id:actor, command_id:commandId,
    draft_id:draftId, requested_candidate_id:String(req.params?.candidateId || '').slice(0,64),
    error_code:code, created_at:new Date().toISOString() };
  try { await store.insert('crm_candidate_submit_failures', incident); }
  catch (loggingError) {
    // Critical: failed submission MUST never be mislabeled successful simply
    // because the incident table isn't installed or the DB is unreachable.
    console.error('[CC849_SUBMIT_FAILURE_NOT_JOURNALED]', {event_id:eventId,user_id:actor,
      draft_id:draftId,error_code:code,journal_error:String(loggingError?.code || loggingError?.message || 'unknown').slice(0,120)});
  }
  return eventId;
}

// Manager-only observability. Old failures are not deleted by this endpoint.
async function listSubmitFailures(req,res) {
  const role=String(req.user?.role || '').toLowerCase();
  if (!['manager','admin'].includes(role)) return res.status(403).json({message:'Manager access only'});
  const items=store.pool
    ? await store.query(`select event_id,user_id,requested_candidate_id,error_code,created_at
      from public.crm_candidate_submit_failures order by created_at desc limit 100`)
    : (await store.all('crm_candidate_submit_failures')).slice(-100).reverse();
  return res.json({items,limit:100});
}

// Profile, note, submission and receipt commit together. Cached presentation
// defaults never become write guards. Both workflow buttons use this command.
async function committedNote(candidateId,note,username,after=''){
  if(!note?.body?.trim())return null;
  const rows=store.pool?await store.query('select * from public.notes where candidate_id=$1 and username=$2 and body=$3 order by created_at desc,id desc limit 3',[candidateId,username,note.body]):(await require('./store').table('notes')).filter(n=>String(n.candidate_id)===String(candidateId)&&n.username===username&&n.body===note.body).slice(-3).reverse();
  return rows.find(n=>(!after||Date.parse(n.created_at)>Date.parse(after))&&String(n.parent_note_id||'')===String(note.parent_note_id||'')&&String(n.reply_to_note_id||'')===String(note.reply_to_note_id||''))||null;
}
async function identicalOwnDraft(fields,user,note){
  const normalize=require('./candidateIdentityGuard'),phone=normalize.normalizedPhone(fields.phone);
  if(!phone)return null;
  const rows=store.pool?await store.query("select * from public.candidates where public.crm_normalized_phone(phone)=$1 and recruiter_user_id=$2 and lower(coalesce(approval_status,''))='draft' limit 2",[phone,user.user_id]):(await require('./store').table('candidates')).filter(c=>normalize.normalizedPhone(c.phone)===phone&&String(c.recruiter_user_id)===String(user.user_id)&&String(c.approval_status).toLowerCase()==='draft');
  const equal=(key,a,b)=>key==='full_name'?normalize.normalizedName(a)===normalize.normalizedName(b):key==='phone'?normalize.normalizedPhone(a)===normalize.normalizedPhone(b):String(a??'').trim()===String(b??'').trim();
  for(const row of rows){
    if(!visibleCandidateForUser(row,user)||Date.now()-Date.parse(row.created_at)>600000)continue;
    // Staff designation is derived from the account (Team Leader -> tl),
    // so its display label must not turn identical candidate input into a conflict.
    if(Object.entries(fields).some(([key,value])=>!key.startsWith('_')&&!['submission_date','last_updated_at','recruiter_designation'].includes(key)&&String(value??'').trim()&&!equal(key,value,row[key])))continue;
    if(await require('../controllers/candidateController').findSubmissionCompat(row.candidate_id,['pending','approved','rejected']))continue;
    const saved=await committedNote(row.candidate_id,note,user.username);
    if(note?.body?.trim()&&!saved)continue;
    return{row,note:saved};
  }return null;
}
async function receiptStatus(req,res){
  const key=String(req.params.commandId||'');if(!/^[a-zA-Z0-9_-]{16,128}$/.test(key))return res.status(400).json({message:'Invalid save reference.'});
  const actor=String(req.user.user_id||req.user.username),row=await store.findById('crm_command_receipts','command_id',actor+':'+key);
  res.setHeader('Cache-Control','private, no-store');
  if(!row)return res.status(202).json({ok:true,committed:false,command_id:key});
  const result=JSON.parse(row.receipt_json),current=await store.findById('candidates','candidate_id',row.candidate_id);
  if(!current||!visibleCandidateForUser(current,req.user))return res.status(404).json({message:'Saved profile is not available to your account.'});
  return res.json({...result,item:require('../controllers/candidateController').candidateEditResponse(current,req.user),receipt_verified:true});
}

async function commit(req, res) {
  try {
    const controller = require('../controllers/candidateController');
    const input = req.body || {};
    // Fail closed: an old/stale SPA must never silently write through a newer
    // backend. The employee's draft remains local; no Candidate ID is allocated.
    if (input.workflow_release !== RELEASE) {
      fail(409, 'Profile app and server versions differ. Refresh after deploying the matching CC849 GitHub folder. Your draft is kept.', 'WORKFLOW_VERSION_MISMATCH');
    }
    if (input.workflow_version !== WORKFLOW_VERSION) {
      fail(409, 'This profile workflow needs the matching frontend and backend. Your draft is kept.', 'WORKFLOW_VERSION_MISMATCH');
    }
    const requestedAction = String(input.action || '').trim();
    if (!['save', 'submit', 'save_submit', 'save_and_submit'].includes(requestedAction)) {
      fail(400, 'Choose Save or Save & Submit.', 'INVALID_PROFILE_ACTION');
    }
    if(req.body?.resume)delete req.body.resume;
  const action = requestedAction === 'save' ? 'save' : 'submit';
    const persistCandidate = input.persist_candidate === true;
    if (!plainObject(input.fields || {})) fail(400, 'Profile fields are invalid.', 'INVALID_PROFILE_FIELDS');
    const key = String(input.command_id || '').trim();
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key)) fail(400, 'A stable command ID is required.', 'INVALID_COMMAND_ID');
    const actor = String(req.user?.user_id || req.user?.username || '').trim();
    if (!actor) fail(401, 'Sign in before saving.', 'NOT_AUTHENTICATED');
    const requestedId = String(req.params?.candidateId || 'new').trim();
    let fields = profileFields(input.fields || {}, new Set(controller.PERSISTED_CANDIDATE_FIELDS));
    if(Object.prototype.hasOwnProperty.call(fields,'phone'))fields.phone=require('./candidatePhoneGuard').validateInput(fields.phone,{required:action==='submit'});
    let note = input.note == null ? null : input.note;
    if (note && (!plainObject(note) || typeof note.body !== 'string')) fail(400, 'Note text is invalid.', 'INVALID_NOTE');
    // CC848: browser validation is only guidance. Server is authoritative.
    // Validate BEFORE allocating a permanent number; a rejected form stays a draft.
    if (requestedId === 'new' && action === 'submit') {
      fields.phone = require('./candidatePhoneGuard').validateInput(fields.phone, {required:true});
      // CC934: Client is not an input in Candidate Details. Keep it optional.
      if (!String(fields.full_name || '').trim() || !String(fields.location || '').trim()) {
        fail(400, 'Name and location are required before submission. Your draft remains safe.', 'PROFILE_REQUIRED_FIELDS');
      }
      if (!String(note?.body || '').trim()) {
        fail(400, 'A profile note is required before Submit. Your draft remains safe.', 'NOTE_REQUIRED');
      }
    }
    if(requestedId==='new' && action==='save' && persistCandidate){
      if(!String(fields.full_name||'').trim())fail(400,'Enter the candidate name before Save.','PROFILE_NAME_REQUIRED');
      fields.phone=require('./candidatePhoneGuard').validateInput(fields.phone,{required:true});
    }
    const resume = null; // Original files never persist through a profile commit.
    if (resume && !plainObject(resume)) fail(400,'Resume payload is invalid.','INVALID_RESUME');
    const receiptId = `${actor}:${key}`;
    const draftId = String(input.draft_id || '').trim();
    if (requestedId === 'new' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draftId)) {
      fail(400, 'New profile needs a stable draft UUID. No candidate was created.', 'DRAFT_ID_REQUIRED');
    }
    const draftOwner=String(input.draft_owner_user_id||actor).trim();
    let draftOwnerUser=req.user;
    if(draftOwner!==actor){
      const owned=await store.findById('crm_candidate_drafts','draft_id',draftOwner+':'+(requestedId==='new'?draftId:'edit:'+requestedId));
      if(!owned||!require('../controllers/profileSafetyController').canSeeDraft(owned,req.user))fail(404,'This employee draft is not available to your account.','DRAFT_ACCESS_CHANGED');
      draftOwnerUser=await store.findById('users','user_id',draftOwner);
      if(!draftOwnerUser)fail(409,'The draft owner no longer exists. Contact your manager.','DRAFT_OWNER_UNAVAILABLE');
    }
    const signature = crypto.createHash('sha256').update(JSON.stringify(canonical({ action, requestedId, draftId, ...(persistCandidate?{persist_candidate:true}:{}), ...(draftOwner!==actor?{draftOwner}:{}), fields, note, ...(resume ? {resume} : {}) }))).digest('hex');
    const scopedDraftId = requestedId === 'new' ? `${draftOwner}:${draftId}` : '';
    // Each rollback retry must merge the original input, never a failed attempt's merge.
    const attemptFields={...fields},attemptNote=note?{...note}:null;
    const resetAttempt=()=>{fields={...attemptFields};note=attemptNote?{...attemptNote}:null;};

    async function reopenSubmittedDraft(draft){
      const existing=await store.findById('candidates','candidate_id',draft.candidate_id);
      if(!existing||!visibleCandidateForUser(existing,req.user))fail(409,'This draft has already been submitted. Contact your manager to reopen the saved profile.','DRAFT_ALREADY_SUBMITTED');
      let original={},originalNote=null;try{original=JSON.parse(draft.fields_json||'{}');originalNote=JSON.parse(draft.note_json||'null');}catch{}
      const message='This draft already created '+existing.candidate_id+'. Open the saved profile to continue editing. Your entered changes are kept.';
      throw Object.assign(new Error(message),{status:409,code:'DRAFT_ALREADY_SUBMITTED',payload:{ok:false,committed:false,code:'DRAFT_ALREADY_SUBMITTED',message,existing_candidate_id:existing.candidate_id,existing_profile:'/candidate/'+encodeURIComponent(existing.candidate_id),draft_base_values:original,original_note:originalNote?.body||''}});
    }

    // Automatic draft sync stays ID-less. Explicit Save persists a Draft candidate;
    // Submit is a separate, validated workflow action.
    if (requestedId === 'new' && action === 'save' && !persistCandidate) {
      const savedDraft = await withTransaction(async () => {
        resetAttempt();
        if (store.pool) await store.query('select pg_advisory_xact_lock(hashtext($1))', [`cc848-draft:${scopedDraftId}`]);
        const old = await store.findById('crm_candidate_drafts', 'draft_id', scopedDraftId);
        if (old?.candidate_id) {
          await reopenSubmittedDraft(old);
        }
        ({fields,note}=mergeDraftSnapshot(old,input,fields,note));
        const stamp = new Date(Math.max(Date.now(),(Date.parse(old?.updated_at)||0)+1)).toISOString();
        const row = {draft_id:scopedDraftId, user_id:draftOwner, candidate_id:'', fields_json:JSON.stringify(fields),
          note_json:JSON.stringify(note), updated_at:stamp, created_at:old?.created_at || stamp};
        if (old) await store.update('crm_candidate_drafts','draft_id',scopedDraftId,row);
        else await store.insert('crm_candidate_drafts',row);
        return {ok:true, committed:true, draft_saved:true, action:'save', candidate_id:'', command_id:key,
          workflow_version:WORKFLOW_VERSION,workflow_release:RELEASE,draft_id:draftId,draft_owner_user_id:draftOwner,draft_updated_at:stamp,draft_fields:fields,draft_note:note};
      },{retryConflicts:true});
      return res.json(savedDraft);
    }

    const result = await withTransaction(async () => {
      resetAttempt();
      // Serialize every save/submit of this draft, INCLUDING different command_id retries.
      if (scopedDraftId && store.pool) await store.query('select pg_advisory_xact_lock(hashtext($1))', [`cc848-draft:${scopedDraftId}`]);
      const currentDraft = scopedDraftId ? await store.findById('crm_candidate_drafts','draft_id',scopedDraftId) : null;
      const client=activeTransactionClient(),linked=req.__ccProfileCommand;
      const locked=!!(client&&linked?.client===client&&linked.receiptKey===receiptId&&String(linked.candidate?.candidate_id)===requestedId);
      if (store.pool&&!locked) await store.query('select pg_advisory_xact_lock(hashtext($1))', [receiptId]);
      const previous = locked?linked.receipt:await store.findById('crm_command_receipts', 'command_id', receiptId);
      if (previous) {
        if (previous.payload_hash !== signature) fail(409, 'This retry contains different details. Press the button again for a new save.', 'COMMAND_CHANGED');
        const receipt = JSON.parse(previous.receipt_json);
        const current = await store.findById('candidates', 'candidate_id', receipt.candidate_id || receipt.item?.candidate_id);
        if (!current || !visibleCandidateForUser(current, req.user)) fail(403, 'Profile access changed.', 'PROFILE_ACCESS_CHANGED');
        let submission = null;
        if (action === 'submit') {
          if (!await controller.submissionNoteForCandidate(current)) fail(400,'Add a profile note before Save & Submit. Save can keep a draft without notes.','NOTE_REQUIRED');
          submission = await store.findById('submissions', 'submission_id', receipt.submission?.submission_id);
          if (!submission) fail(409, 'The earlier submission was removed or reset. Submit the profile again.', 'COMMAND_NO_LONGER_CURRENT');
        }
        const workflow = submission || await controller.findSubmissionCompat(current.candidate_id, ['pending','approved','rejected']);
        return { ...receipt, workflow_release: RELEASE, item: controller.candidateEditResponse(current, req.user, {
          ...current, submission_id: workflow?.submission_id || '', submission_exists: workflow ? '1' : '0', workflow_incomplete: false,
        }), submission, replayed: true };
      }

      let linkedCandidateId='', linkedSavedNote=null;
      if (currentDraft?.candidate_id) {
        const originalFields=JSON.parse(currentDraft.fields_json||'{}'),originalNote=JSON.parse(currentDraft.note_json||'null');
        const stable=value=>{const copy={...value};delete copy.submission_date;return JSON.stringify(canonical(copy));};
        const noteStable=value=>{if(!value)return null;const copy={...value};delete copy._saved_note_id;return canonical(copy);};
        if(stable(originalFields)!==stable(fields)||JSON.stringify(noteStable(originalNote))!==JSON.stringify(noteStable(note)))await reopenSubmittedDraft(currentDraft);
        const current=await store.findById('candidates','candidate_id',currentDraft.candidate_id);
        if(!current||!visibleCandidateForUser(current,req.user))fail(403,'Saved profile is no longer accessible.','PROFILE_ACCESS_CHANGED');
        linkedCandidateId=current.candidate_id;
        if(originalNote?._saved_note_id)linkedSavedNote=await store.findById('notes','id',originalNote._saved_note_id);
        const submission=await controller.findSubmissionCompat(current.candidate_id,['pending','approved','rejected']);
        if(action==='save'||submission?.submission_id){
          const receipt={ok:true,committed:true,replayed:true,already_submitted:Boolean(submission?.submission_id),workflow_version:WORKFLOW_VERSION,workflow_release:RELEASE,command_id:key,action,candidate_id:current.candidate_id,item:controller.candidateEditResponse(current,req.user),submission:submission||null,note:linkedSavedNote};
          await store.insert('crm_command_receipts',{command_id:receiptId,user_id:actor,candidate_id:current.candidate_id,payload_hash:signature,receipt_json:JSON.stringify(receipt),created_at:new Date().toISOString()});
          return receipt;
        }
      }

      if(requestedId==='new'&&currentDraft&&!currentDraft.candidate_id)({fields,note}=mergeDraftSnapshot(currentDraft,input,fields,note));

      let id = linkedCandidateId || requestedId;
      const base = { ...req, actorUser:req.actorUser||req.user, query: {}, params: { ...req.params }, body: { ...fields } };
      if (requestedId === 'new' && !linkedCandidateId) {
        // Do not rely on any provisional candidate number. Database assigns the ID atomically.
        if (store.pool) await store.query('select pg_advisory_xact_lock(hashtext($1))', ['crm-candidate-create']);
        const same=await identicalOwnDraft(fields,draftOwnerUser,note);
        if(same){id=same.row.candidate_id;linkedSavedNote=same.note;}
        else{const created=await callController(controller.create,{...base,user:draftOwnerUser});id=created.item?.candidate_id;}
        if (!id) fail(503, 'Database did not create the profile. Retry Save.', 'PROFILE_NOT_COMMITTED');
      } else if(!linkedCandidateId) {
        if (store.pool&&!locked) await store.query('select candidate_id from candidates where candidate_id = $1 for update', [id]);
        const current = locked?linked.candidate:await store.findById('candidates', 'candidate_id', id);
        if (!current) fail(404, 'Candidate not found.', 'PROFILE_NOT_FOUND');
        if (!visibleCandidateForUser(current, req.user)) fail(403, 'Not allowed to edit this profile.', 'PROFILE_ACCESS_CHANGED');
        const baseStamp=String(input.fields?._client_updated_at||'');
        if(baseStamp&&baseStamp!==String(current.updated_at||'')&&Object.entries(fields).every(([key,value])=>String(value??'')===String(current[key]??'')))linkedSavedNote=await committedNote(id,note,req.user.username,baseStamp);
        await withManagerCorrection(req, current, { ...current, ...fields }, async () => {
          assertCandidateIdentityStable(current, { ...current, ...fields });
          if (String(current.bucket_state || '').toLowerCase() === 'fresh') {
            await store.update('candidates', 'candidate_id', id, {bucket_state:'working',bucket_assigned_at:new Date().toISOString()});
          }
          if (Object.keys(fields).length) {
            base.body._changed_fields = Object.keys(fields);
            const meta = input.fields || {};
            if (typeof meta._client_updated_at === 'string') base.body._client_updated_at = meta._client_updated_at;
            if (plainObject(meta._client_base_values)) base.body._client_base_values = meta._client_base_values;
            await callController(controller.update, base);
          }
        });
      }

      const savedNote = linkedSavedNote || (note?.body?.trim()
        ? (await callController(controller.addNote, { ...base, params: { candidateId: id }, body: { ...note, client_note_key: key } })).item
        : null);
      const savedResume = resume ? await callController(controller.uploadCandidateFile, {
        ...base, params:{candidateId:id}, body:{...resume,file_kind:'resume'},
      }) : null;
      let submission = null;
      let alreadySubmitted = false;
      if (action === 'submit') {
        const submitted = await callController(controller.submitForApproval, {
          ...base, params: { candidateId: id }, body: { submission_date: fields.submission_date || '' },
        });
        submission = submitted.submission;
        alreadySubmitted = Boolean(submitted.already_submitted);
        if (!submission?.submission_id) fail(503, 'Database did not confirm the submission. Retry Save & Submit.', 'PROFILE_NOT_COMMITTED');
      }
      // This mapping is committed atomically with candidate, note and submission.
      // A timeout, double click or fresh command_id cannot create a second person.
      if (scopedDraftId) {
        const stamp = new Date().toISOString();
        const payload = {draft_id:scopedDraftId,user_id:draftOwner,candidate_id:id,fields_json:JSON.stringify(fields),
          note_json:JSON.stringify(note&&savedNote?.id?{...note,_saved_note_id:savedNote.id}:note),updated_at:stamp,created_at:currentDraft?.created_at || stamp};
        if (currentDraft) await store.update('crm_candidate_drafts','draft_id',scopedDraftId,payload);
        else await store.insert('crm_candidate_drafts',payload);
      }
      const row = await store.findById('candidates', 'candidate_id', id);
      if (!row) fail(503, 'Database did not confirm the profile.', 'PROFILE_NOT_COMMITTED');
      const workflow = submission || await controller.findSubmissionCompat(id, ['pending','approved','rejected']);
      const receipt = {
        ok: true, committed: true, workflow_version: WORKFLOW_VERSION, workflow_release: RELEASE,
        command_id: key, action, candidate_id: id,
        item: controller.candidateEditResponse(row, req.user, { ...row,
          submission_id: workflow?.submission_id || '', submission_exists: workflow ? '1' : '0', workflow_incomplete: false,
        }),
        note: savedNote, submission, already_submitted: alreadySubmitted,
        ...(savedResume ? {resume:savedResume.item,files:savedResume.files} : {}),
        reminder_due_at: submission?.reminder_due_at || null,
      };
      if(requestedId!=='new'&&input.draft_owner_user_id){
        const editKey=draftOwner+':edit:'+requestedId,editDraft=await store.findById('crm_candidate_drafts','draft_id',editKey);
        if(editDraft&&(!input.draft_updated_at||String(editDraft.updated_at)===String(input.draft_updated_at)))await store.update('crm_candidate_drafts','draft_id',editKey,{fields_json:'{}',note_json:'null'});
      }
      await store.insert('crm_command_receipts', {
        command_id: receiptId, user_id: actor, candidate_id: id, payload_hash: signature,
        receipt_json: JSON.stringify(receipt), created_at: new Date().toISOString(),
      });
      return receipt;
    },{retryConflicts:true});
    // Publish the compact review directly after COMMIT, ahead of optional audit/notification DB writes.
    if(result.action==='submit'&&!result.replayed&&!result.already_submitted&&result.item?.candidate_id){
      require('./approvalLive').publishReminderDirty(result.item,{source:req.path||'/candidates/commit',at:Date.now(),meta:{submitted:true,submission:result.submission||{}}});
      req.__cc882ReminderPublished=true;
    }
    return res.json(result);
  } catch (error) {
    if (String(req.body?.action || '').toLowerCase() !== 'save' && (!error.status || error.status>=500 || error.code==='CANDIDATE_IDENTITY_LOCKED')) {
      await recordFailedSubmission(req,error);
    }
    // CC849: A database guard rejection is a protected failure, never a 500
    // success-lookalike. Keep the same draft UUID and reject unsafe retry.
    if(error.code==='DUPLICATE_PHONE'||error.code==='23505'&&/DUPLICATE_PHONE/i.test(error.message||''))return res.status(409).json({ok:false,committed:false,code:'DUPLICATE_PHONE',message:require('./candidatePhoneGuard').message});
    if (error.code === '23514' && /Candidate identity locked/i.test(String(error.message || ''))) {
      return res.status(409).json({
        ok: false, committed: false, code: 'CANDIDATE_IDENTITY_LOCKED',
        message: 'This submit was stopped to protect an existing candidate. Your entered details are retained in your pending draft. Contact Manager; do not Reset or open a replacement profile.',
        draft_id: String(req.body?.draft_id || '').trim(),
      });
    }
    if (error.code === '23505' && /candidate number has already been used/i.test(String(error.message || ''))) {
      return res.status(503).json({ ok:false,committed:false,code:'CANDIDATE_ID_ALLOCATION_CONFLICT',message:'Candidate ID collision prevented by database. Your draft is preserved; retry the same submission.' });
    }
    if (error.code === 'CC081') return res.status(400).json({message:error.message,code:'NOTE_REQUIRED'});
    if (error.code === 'CC070') return res.status(409).json({ message: error.message, code: 'BUCKET_CAPACITY_REACHED' });
    if (['42P01', '42703'].includes(error.code)) return res.status(503).json({ message: 'Run CC847 and CC848 safe migrations in Supabase, then restart the matching backend. Your draft is kept.', code: 'SCHEMA_MISSING' });
    if (['25P02', 'TRANSACTION_NOT_COMMITTED'].includes(error.code)) return res.status(503).json({ message: 'Database could not commit this profile. Your draft is kept; retry the same button.', code: 'PROFILE_NOT_COMMITTED' });
    const explicitFields=error.payload?.conflict_fields?.length?error.payload.conflict_fields:error.conflict_fields||[];
    const issueFields=explicitFields.length?explicitFields:
      (/PHONE/.test(error.code||'')?['phone']:error.code==='PROFILE_NAME_REQUIRED'?['full_name']:/CTC Monthly/.test(error.message||'')?['ctc_monthly']:/In-hand Monthly/.test(error.message||'')?['in_hand_salary']:/All Details Sent/.test(error.message||'')?['all_details_sent']:error.code==='PROFILE_REQUIRED_FIELDS'?['full_name','location'].filter(k=>!String(req.body?.fields?.[k]||'').trim()):error.code==='NOTE_REQUIRED'?['master_notes']:[]);
    if (error.status) return res.status(error.status).json({...error.payload,message:error.payload?.message||error.message,code:error.payload?.code||error.code,committed:false,...(issueFields.length?{conflict_fields:issueFields}:{})});
    throw error;
  }
}
module.exports = {receiptStatus,mergeDraftSnapshot, commit, listSubmitFailures, WORKFLOW_VERSION, RELEASE };
