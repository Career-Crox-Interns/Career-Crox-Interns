const {store,table,withTransaction}=require('../lib/store');
const {isAdminOrManager}=require('../lib/accessRules');
const fail=(status,message)=>Object.assign(new Error(message),{status});

function draftOwnerIds(user){return [...new Set([user.user_id,...(String(user.role).toLowerCase()==='tl'?user.__ccTeamUserIds||[]:[])].filter(Boolean).map(String))];}
function canSeeDraft(row,user){return isAdminOrManager(user)||draftOwnerIds(user).includes(String(row.user_id));}
function pendingDraft(row){return !row.candidate_id||(String(row.draft_id).startsWith(row.user_id+':edit:')&&row.fields_json!=='{}');}
const DRAFT_LIST_FIELDS=['full_name','phone','email','location','preferred_location','process','qualification','course_name','qualification_level','total_experience','in_hand_salary','status'];
async function drafts(req,res){
 const ids=draftOwnerIds(req.user),all=isAdminOrManager(req.user),page=Math.max(1,Number(req.query.page)||1),size=100;
 let rows,total;
 if(store.pool){
  const where="(coalesce(candidate_id,'')='' or (draft_id like user_id||':edit:%' and fields_json<>'{}'))"+(all?'':' and user_id=any($1::text[])'),params=all?[]:[ids];
  const counts=await store.query('select count(*)::int as total from public.crm_candidate_drafts where '+where,params);total=Number(counts[0]?.total||0);
  const projection=DRAFT_LIST_FIELDS.map(field=>`fields_json::jsonb->>'${field}' as "${field}"`).join(',');
  rows=req.query.count_only==='1'?[]:await store.query(`select draft_id,user_id,candidate_id,updated_at,${projection},left(coalesce(note_json::jsonb->>'body',''),160) as note_preview from public.crm_candidate_drafts where ${where} order by updated_at desc,draft_id limit $${params.length+1} offset $${params.length+2}`,[...params,size,(page-1)*size]);
 }else{const allRows=(await table('crm_candidate_drafts')).filter(r=>pendingDraft(r)&&canSeeDraft(r,req.user)).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)));total=allRows.length;rows=req.query.count_only==='1'?[]:allRows.slice((page-1)*size,page*size);}
 if(!rows.length)return res.json({total,page,has_more:page*size<total,items:[]});
 let roster;await require('./uiController').lookups({...req,query:{scope:'profile'}},{set(){return this},json(v){roster=v;}});
 const users=new Map((roster?.users||[]).map(u=>[String(u.user_id),u.full_name||u.username]));
 return res.json({total,page,has_more:page*size<total,items:rows.map(r=>{let fields={},note={};try{fields=JSON.parse(r.fields_json||'{}');note=JSON.parse(r.note_json||'null')||{};}catch{}return{draft_id:r.draft_id.slice((r.user_id+':').length),user_id:r.user_id,owner_name:users.get(String(r.user_id))||'Former team member',candidate_id:r.candidate_id||'',...Object.fromEntries(DRAFT_LIST_FIELDS.map(field=>[field,String(r[field]??fields[field]??'')])),full_name:r.full_name||fields.full_name||'Untitled draft',note_preview:String(r.note_preview??note.body??'').slice(0,160),updated_at:r.updated_at,can_resume:canSeeDraft(r,req.user)}})});
}
async function draft(req,res){
 const id=String(req.params.draftId||''),owner=String(req.query.owner_user_id||req.user.user_id);
 if(!/^(?:[0-9a-f-]{36}|edit:[a-zA-Z0-9_-]+)$/i.test(id))throw fail(400,'Invalid draft');
 const row=await store.findById('crm_candidate_drafts','draft_id',owner+':'+id);
 if(!row||!canSeeDraft(row,req.user))throw fail(404,'This draft is not available');
 const submitted=!!row.candidate_id&&!String(row.draft_id).startsWith(row.user_id+':edit:');
 if(submitted){const candidate=await store.findById('candidates','candidate_id',row.candidate_id);if(!candidate||!require('../lib/accessRules').visibleCandidateForUser(candidate,req.user))throw fail(404,'The submitted profile is not available');}
 const fields=JSON.parse(row.fields_json||'{}');
 return res.json({draft_id:id,user_id:row.user_id,candidate_id:row.candidate_id||'',fields:{...fields,...(submitted?{_draft_base_values:fields}:{})},note:JSON.parse(row.note_json||'null'),updated_at:row.updated_at,submitted,can_resume:canSeeDraft(row,req.user)});
}
async function saveEditDraft(req,res){
 const id=String(req.body.candidate_id||''),actor=String(req.user.user_id),draftId=actor+':edit:'+id;
 const originalNote=req.body.note?JSON.parse(JSON.stringify(req.body.note)):null;
 const payload=await withTransaction(async()=>{
  let note=originalNote?JSON.parse(JSON.stringify(originalNote)):null;
  if(store.pool)await store.query('select pg_advisory_xact_lock(hashtext($1))',['cc872-edit:'+draftId]);
  const candidate=store.pool?(await store.query('select * from public.candidates where candidate_id=$1 for update',[id]))[0]:await store.findById('candidates','candidate_id',id);
  if(!candidate||!require('../lib/accessRules').visibleCandidateForUser(candidate,req.user))throw fail(404,'Candidate is not available');
  const previous=await store.findById('crm_candidate_drafts','draft_id',draftId);
  if(req.body.clear===true){
   let base='';try{base=JSON.parse(previous?.fields_json||'{}')._draft_base_updated_at||'';}catch{}
   if(previous&&(!req.body.committed_updated_at||base!==req.body.committed_updated_at))await store.update('crm_candidate_drafts','draft_id',draftId,{fields_json:'{}',note_json:'null'});
   return {ok:true};
  }
  if(req.body.base_updated_at&&String(req.body.base_updated_at)!==String(candidate.updated_at))throw fail(409,'Profile changed; the device draft is kept.');
  let fields=Object.fromEntries(Object.entries(req.body.fields||{}).filter(([k,v])=>!k.startsWith('_')&&k.length<80&&['string','number','boolean'].includes(typeof v)).map(([k,v])=>[k,String(v).slice(0,20000)]));
  if(previous){const merged=require('../lib/candidateCommand').mergeDraftSnapshot(previous,req.body,fields,note);fields=merged.fields;note=merged.note;}
  const stamp=new Date(Math.max(Date.now(),(Date.parse(previous?.updated_at)||0)+1)).toISOString(),row={draft_id:draftId,user_id:actor,candidate_id:id,fields_json:JSON.stringify({...fields,candidate_id:id,_draft_base_updated_at:candidate.updated_at||'',_draft_base_values:req.body.base_values||{}}),note_json:JSON.stringify(note),created_at:previous?.created_at||stamp,updated_at:stamp};
  if(previous)await store.update('crm_candidate_drafts','draft_id',draftId,row);else await store.insert('crm_candidate_drafts',row);
  return {ok:true,draft_saved:true,draft_updated_at:stamp,draft_fields:fields};
 },{retryConflicts:true});return res.json(payload);
}
async function duplicate(req,res){
 const exists=await require('../lib/candidatePhoneGuard').duplicate(req.query.phone,req.query.except_id||'');
 return res.json({duplicate:exists,message:exists?require('../lib/candidatePhoneGuard').message:''});
}
async function ownership(req,res){
 if(!isAdminOrManager(req.user)||req.user.impersonator)throw fail(403,'Manager access only');
 const phone=require('../lib/candidateIdentityGuard').normalizedPhone(req.query.phone);
 const rows=store.pool?await store.query('select candidate_id,full_name,phone,recruiter_user_id,recruiter_name,recruiter_code,status,updated_at,deleted_at from public.candidates where public.crm_normalized_phone(phone)=$1',[phone]):(await table('candidates')).filter(r=>require('../lib/candidateIdentityGuard').normalizedPhone(r.phone)===phone);
 return res.json({items:rows});
}
async function correct(req,res){
 if(!isAdminOrManager(req.user)||req.user.impersonator)throw fail(403,'Manager access only');
 if(!store.pool)throw fail(503,'Audited correction requires PostgreSQL');
 const reason=String(req.body.reason||'').trim(),name=String(req.body.full_name||'').trim(),phone=require('../lib/candidatePhoneGuard').validateInput(req.body.phone,{required:true});
 if(reason.length<10||!name)throw fail(400,'Name and correction reason (10+ characters) are required');
 const result=await withTransaction(async()=>{
  await store.query('select pg_advisory_xact_lock($1)',[2644001]);
  const old=(await store.query('select * from public.candidates where candidate_id=$1 for update',[req.params.candidateId]))[0];
  if(!old)throw fail(404,'Candidate not found');if(String(old.updated_at||'')!==String(req.body.expected_updated_at||''))throw fail(409,'The profile changed. Reload before correcting');
  if(require('../lib/candidateIdentityGuard').normalizedPhone(old.phone)!==phone)await require('../lib/candidatePhoneGuard').assertUnique(phone,old.candidate_id,require('../lib/store').activeTransactionClient());
  await store.query("select set_config('career_crox.identity_correction','on',true),set_config('career_crox.actor',$1,true),set_config('career_crox.reason',$2,true)",[req.user.user_id,reason]);
  const rows=await store.query('update public.candidates set full_name=$2,phone=$3,updated_at=$4 where candidate_id=$1 returning candidate_id,full_name,phone,updated_at',[old.candidate_id,name,phone,new Date().toISOString()]);
  return {ok:true,item:rows[0]};
 });
 return res.json(result);
}
module.exports={drafts,draft,saveEditDraft,duplicate,ownership,correct,canSeeDraft};
