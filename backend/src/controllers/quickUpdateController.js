'use strict';
// CC907 local comparison: reuse the CRM's authenticated atomic profile command.
const {store, withTransaction, callController, activeTransactionClient} = require('../lib/store');
const {visibleCandidateForUser,candidateBelongsToUser} = require('../lib/accessRules');
const command = require('../lib/candidateCommand');
const STATUSES = ['Draft','In - Progress','Not Interested','All set for Interview','Appeared in Interview','Selected','Joining Due','Joined','Backout','Completed 60 Days','Rejected once, needs new Interview','Rejected'];
const allowed = new Set(['status','interview_reschedule_date','interview_date','follow_up_at','follow_up_status','all_details_sent']);
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const fail = (status,message,code) => {throw Object.assign(new Error(message),{status,code});};
function validDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):00\+05:30$/.exec(value);
  if (!match) return false;
  const d = new Date(Date.UTC(+match[1],+match[2]-1,+match[3]));
  return d.getUTCFullYear()===+match[1] && d.getUTCMonth()===+match[2]-1 && d.getUTCDate()===+match[3];
}
async function update(req,res) {
  try {
    const input=req.body||{},fields=input.fields,base=input.base_values;
    if(!fields||typeof fields!=='object'||Array.isArray(fields)||!base||typeof base!=='object'||Array.isArray(base))fail(400,'Refresh the candidate before saving.','QUICK_BASE_REQUIRED');
    if(Object.keys(fields).some(k=>!allowed.has(k)||typeof fields[k]!=='string'))fail(400,'Quick update supports only status, interview, follow-up and notes.','QUICK_FIELDS_INVALID');
    for(const k of Object.keys(fields))if(!own(base,k)||typeof base[k]!=='string')fail(400,'Refresh the candidate before saving.','QUICK_BASE_REQUIRED');
    if(own(fields,'all_details_sent')&&!['Pending','Completed','Only Resume Pending'].includes(fields.all_details_sent))fail(400,'Choose a valid All Details Sent value.','QUICK_DETAILS_INVALID');
    if(own(fields,'status')&&!STATUSES.includes(fields.status))fail(400,'Choose a listed status.','QUICK_STATUS_INVALID');
    if(own(fields,'interview_reschedule_date')&&(!validDate(fields.interview_reschedule_date)||fields.interview_date!==fields.interview_reschedule_date))fail(400,'Choose a complete interview date and time.','QUICK_DATE_INVALID');
    if(own(fields,'interview_date')&&!own(fields,'interview_reschedule_date'))fail(400,'Choose the interview date using the calendar.','QUICK_DATE_INVALID');
    if(own(fields,'follow_up_at')&&fields.follow_up_at!==''&&!validDate(fields.follow_up_at))fail(400,'Choose a complete follow-up date and time.','QUICK_DATE_INVALID');
    if(own(fields,'follow_up_status')&&(!own(fields,'follow_up_at')||fields.follow_up_status!==(fields.follow_up_at?'Open':'')))fail(400,'Choose the follow-up time using the calendar.','QUICK_DATE_INVALID');
    const text=String(input.note||'').trim();
    if(text.length>4000)fail(400,'Keep the note under 4,000 characters.','QUICK_NOTE_LONG');
    if(!Object.keys(fields).length&&!text)fail(400,'Choose a change before Save.','QUICK_EMPTY');
    const key=String(input.command_id||'');
    if(!/^[a-zA-Z0-9_-]{16,128}$/.test(key))fail(400,'A save ID is required. Reopen the panel.','QUICK_KEY_REQUIRED');
    const id=String(req.params.candidateId||'');
    const result=await withTransaction(async()=>{
      const receiptKey=String(req.user.user_id||req.user.username)+':'+key;
      // Match the existing command lock order; no table-wide locks.
      const linked=req.__ccAriaLocked,client=activeTransactionClient();
      const locked=!!(client&&linked?.client===client&&String(linked.candidate?.candidate_id)===id);
      if(store.pool&&!locked) {
        await store.query('select pg_advisory_xact_lock(hashtext($1))',[receiptKey]);
        await store.query('select candidate_id from public.candidates where candidate_id=$1 for update',[id]);
      }
      const current=locked?linked.candidate:await store.findById('candidates','candidate_id',id);
      if(!current||current.deleted_at||['deleted','__deleted__','archived'].includes(String(current.status||'').toLowerCase())||String(current.data_notes||'').toLowerCase().includes('[crm-deleted]')||!visibleCandidateForUser(current,req.user))fail(404,'Candidate not found in this dashboard.','QUICK_NOT_FOUND');
      const picked=String(req.headers?.['x-cc-dashboard-user']||(['tl','recruiter'].includes(String(req.user.role).toLowerCase())?'self':''));
      if((picked==='self'||picked===String(req.user.user_id))&&!candidateBelongsToUser(current,req.user))fail(404,'Candidate not found in My dashboard.','QUICK_NOT_FOUND');
      const prior=await store.findById('crm_command_receipts','command_id',receiptKey);
      if(!prior){
        const changed=Object.keys(fields).filter(k=>String(current[k]??'')!==base[k]);
        if(changed.length)fail(409,'This field was changed elsewhere. Your edits are kept. Use Refresh, review the latest value, then Save.','QUICK_FIELD_CONFLICT');
      }
      return callController(command.commit,{...req,__ccProfileCommand:{client,candidate:current,receipt:prior,receiptKey},body:{action:'save',workflow_release:command.RELEASE,workflow_version:command.WORKFLOW_VERSION,command_id:key,fields,note:text?{body:text,note_type:'public'}:null}});
    },{retryConflicts:true});
    return res.json(result); // The outer transaction has committed before success.
  } catch(error) {
    if(error.status)return res.status(error.status).json({ok:false,committed:false,message:error.message,code:error.code});
    throw error;
  }
}
module.exports={update,STATUSES,validDate};
