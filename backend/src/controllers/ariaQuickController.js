'use strict';
// ARIA CC910: scoped one-character lookup and independently committed bulk writes.
// This deliberately reuses the established candidateCommand receipt, field-conflict,
// ownership, note and workflow-notification path; it creates no new persistence table.
const {store,table,withTransaction,callController,activeTransactionClient}=require('../lib/store');
const {visibleCandidateForUser,candidateBelongsToUser,candidateScopeSql}=require('../lib/accessRules');
const {sanitizeCandidateListForUser}=require('../lib/dataLeakGuard');
const quick=require('./quickUpdateController');
const candidateProjection='candidate_id,full_name,phone,email,status,all_details_sent,recruiter_name,recruiter_code,recruiter_user_id,project_id,approval_status,deleted_at,data_notes,updated_at';
const fail=(status,message,code)=>{throw Object.assign(new Error(message),{status,code});};
function scoped(row,req){
 if(!visibleCandidateForUser(row,req.user))return false;
 const picked=String(req.headers?.['x-cc-dashboard-user']||'');
 return !['self',String(req.user.user_id)].includes(picked)||candidateBelongsToUser(row,req.user);
}
async function search(req,res){
 const raw=String(req.query.q||'').normalize('NFKC').trim().slice(0,80);
 if(!raw)return res.json({ok:true,items:[]});
 const folded=raw.toLocaleLowerCase(),digits=raw.replace(/\D/g,''),phoneDigits=digits.length===12&&digits.startsWith('91')?digits.slice(2):digits;
 const query=raw.replace(/[\\%_]/g,s=>'\\'+s),like=query+'%',any='%'+query+'%';
 let rows;
 if(store.pool){
  const params=[like,any,phoneDigits?'%'+phoneDigits+'%':null];const scope=candidateScopeSql('c',req.user,params);
  const sql=`select ${candidateProjection.split(',').map(f=>'c.'+f).join(',')} from public.candidates c
    where (${scope.sql}) and (c.full_name ilike $1 or c.candidate_id ilike $2 or ($3::text is not null and regexp_replace(coalesce(c.phone,''),'\\D','','g') like $3))
    order by case when c.full_name ilike $1 then 0 when c.candidate_id ilike $1 then 1 else 2 end,
    coalesce(c.updated_at::text,'') desc,c.candidate_id limit 30`;
  rows=await store.query(sql,scope.params);
 }else{
  rows=(await table('candidates')).filter(r=>scoped(r,req)&&(
    String(r.full_name||'').toLocaleLowerCase().startsWith(folded)||String(r.candidate_id||'').toLocaleLowerCase().includes(folded)||
    (phoneDigits&&String(r.phone||'').replace(/\D/g,'').includes(phoneDigits))
  )).sort((a,b)=>String(b.updated_at||'').localeCompare(String(a.updated_at||''))).slice(0,30);
 }
 const items=sanitizeCandidateListForUser(rows.filter(r=>scoped(r,req)),req.user).slice(0,30);
 return res.json({ok:true,items});
}
async function getInterviews(candidateId,req,lock=false){
 if(store.pool){
  const q=`select interview_id,candidate_id,scheduled_at,status,stage,jd_id from public.interviews where candidate_id=$1 order by coalesce(created_at::text,scheduled_at::text,'') desc,interview_id desc limit 30${lock?' for update':''}`;
  return store.query(q,[candidateId]);
 }
 return (await table('interviews')).filter(x=>String(x.candidate_id)===String(candidateId)).slice(-30).reverse();
}
async function interviews(req,res){
 const id=String(req.params.candidateId||'');const row=await store.findById('candidates','candidate_id',id);
 if(!row||!scoped(row,req))return res.status(404).json({message:'Candidate unavailable',code:'ARIA_NOT_FOUND'});
 return res.json({ok:true,items:await getInterviews(id,req)});
}
async function applyOne(req,entry){
 const id=String(entry?.candidate_id||'').trim();
 if(!/^[a-zA-Z0-9_-]{16,128}$/.test(String(entry?.command_id||'')))fail(400,'A save ID is required','ARIA_KEY_REQUIRED');
 if(!id||id.length>80)fail(400,'Candidate ID invalid','ARIA_BAD_ID');
 const fields=entry.fields||{},base=entry.base_values||{};
 const dateChange=Object.hasOwn(fields,'interview_date')||Object.hasOwn(fields,'interview_reschedule_date');
 return withTransaction(async()=>{
  // Same receipt -> candidate -> interview order as the established command.
  if(store.pool){
   await store.query('select pg_advisory_xact_lock(hashtext($1))',[String(req.user.user_id||req.user.username)+':'+entry.command_id]);
   await store.query('select candidate_id from public.candidates where candidate_id=$1 for update',[id]);
  }
  const candidate=await store.findById('candidates','candidate_id',id);
  if(!candidate||!scoped(candidate,req))fail(404,'Candidate unavailable or outside your team','ARIA_NOT_FOUND');
  let interview=null;
  if(dateChange){
   const interviews=await getInterviews(id,req,true);
   if(interviews.length>1&&!entry.interview_id)fail(409,'Select which interview to reschedule for this candidate','ARIA_INTERVIEW_CHOICE_REQUIRED');
   interview=entry.interview_id?interviews.find(i=>String(i.interview_id)===String(entry.interview_id)):interviews[0];
   if(entry.interview_id&&!interview)fail(409,'Selected interview is no longer available','ARIA_INTERVIEW_NOT_FOUND');
   const receipt=await store.findById('crm_command_receipts','command_id',String(req.user.user_id||req.user.username)+':'+String(entry.command_id||''));
   if(interview&&!receipt&&String(interview.scheduled_at||'')!==String(entry.interview_base||''))fail(409,'Interview was changed elsewhere. Refresh this candidate','ARIA_INTERVIEW_CONFLICT');
  }
  const payload={fields,base_values:base,note:entry.note||'',command_id:entry.command_id};
  const result=await callController(quick.update,{...req,__ccAriaLocked:{client:activeTransactionClient(),candidate},params:{...req.params,candidateId:id},body:payload});
  if(!result?.committed||!result?.item?.candidate_id)fail(503,'Database did not confirm candidate save','ARIA_NOT_COMMITTED');
  // A replay has already updated its selected child interview in the original commit.
  // Repeating the same receipt must never revert an intervening interview change.
  if(dateChange&&interview&&!result.replayed){
   await store.update('interviews','interview_id',interview.interview_id,{scheduled_at:fields.interview_date,updated_at:new Date().toISOString()});
  }
  const labels={status:'Status',interview_date:'Interview',interview_reschedule_date:'Interview',follow_up_at:'Follow-up',follow_up_status:'Follow-up',all_details_sent:'Details sent'};
  const changes=result.replayed?[]:[...new Set(Object.keys(fields).filter(k=>String(candidate[k]??'')!==String(result.item[k]??'')).map(k=>labels[k]).filter(Boolean))];
  if(result.note?.id&&!result.replayed)changes.push('Note');
  return {...result,interview_id:interview?.interview_id||'',confirmed_changes:changes};
 });
}
async function bulkUpdate(req,res){
 const entries=req.body?.updates;
 if(!Array.isArray(entries)||entries.length<1||entries.length>40)return res.status(400).json({ok:false,message:'Send 1–40 candidates per batch',code:'ARIA_BATCH_SIZE'});
 if(new Set(entries.map(x=>String(x?.candidate_id||''))).size!==entries.length)return res.status(400).json({ok:false,message:'Duplicate candidate IDs in batch',code:'ARIA_DUPLICATE'});
 const results=new Array(entries.length);let cursor=0;
 // Each candidate commits independently. At most two database transactions run
 // in parallel; local JSON mode stays serial. Results retain selection order.
 async function worker(){while(cursor<entries.length){const index=cursor++,entry=entries[index];
  try{const saved=await applyOne(req,entry);results[index]={candidate_id:entry.candidate_id,ok:true,committed:true,replayed:!!saved.replayed,item:saved.item,note:saved.note||null,interview_id:saved.interview_id,confirmed_changes:saved.confirmed_changes||[]};}
  catch(e){results[index]={candidate_id:String(entry?.candidate_id||''),ok:false,committed:false,code:e.code||'ARIA_SAVE_FAILED',message:String(e.message||'Save failed').slice(0,280)};}
 }}
 await Promise.all(Array.from({length:store.pool?Math.min(2,entries.length):1},worker));
 const succeeded=results.filter(x=>x.committed).length;
 return res.json({ok:true,committed:succeeded===results.length,success_count:succeeded,failure_count:results.length-succeeded,results});
}
module.exports={search,interviews,bulkUpdate,applyOne};
