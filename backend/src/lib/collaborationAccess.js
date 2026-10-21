const crypto = require('crypto');
const {store, table, afterCommit} = require('./store');
const {createTimedCache, clearAllCaches} = require('./cache');
const {canonicalRole, isAdminOrManager, candidateOwnerSql, candidateScopeSql, visibleCandidateForUser, candidateBelongsToUser} = require('./accessRules');
const KEY='cc831_collaboration_projects';
const UI_KEY='cc831_shared_form_layout';
const cache=createTimedCache(30000,{maxEntries:16});
const text=v=>String(v||'').trim();
const active=u=>!['0','false','no','inactive','disabled','deleted'].includes(text(u.is_active??'1').toLowerCase());
const role=u=>canonicalRole(u.role,u.designation);
const id=u=>text(u.user_id);
function primaryTl(u,users){
 const owner=text(u.tl_user_id||u.team_lead_user_id||u.reporting_tl_user_id||u.reports_to_user_id||u.reporting_manager_user_id);
 if(owner)return owner;
 const code=text(u.tl_code||u.team_lead_code||u.reporting_tl_code||u.reports_to_code||u.reporting_manager_code).toLowerCase();
 const name=text(u.tl_name||u.team_lead_name||u.reports_to_name||u.reporting_manager_name).toLowerCase();
 return id(users.find(t=>role(t)==='tl'&&(code&&text(t.recruiter_code).toLowerCase()===code||!code&&name&&[t.full_name,t.username].some(v=>text(v).toLowerCase()===name)))||{});
}
async function roster(){return cache.load('roster',async()=>{
 const fields=['user_id','username','full_name','recruiter_code','role','designation','is_active','tl_user_id','tl_code','tl_name','team_lead_user_id','reporting_tl_user_id','reports_to_user_id','reporting_manager_user_id','team_lead_code','reporting_tl_code','reports_to_code','reporting_manager_code','team_lead_name','reports_to_name','reporting_manager_name'];
 const users=store.pool?await store.query(`select ${fields.map(f=>`to_jsonb(u)->>'${f}' as ${f}`).join(',')} from public.users u`):await table('users');
 return users.filter(active).map(u=>Object.fromEntries(fields.map(f=>[f,u[f]||''])));
 });}
async function setting(key){const row=await store.findById('app_settings','key',key);try{return JSON.parse(row?.value||'{}');}catch{return {};}}
async function state(){return cache.load(KEY,async()=>{const value=await setting(KEY);return {revision:Number(value.revision)||0,projects:Array.isArray(value.projects)?value.projects.slice(0,60):[],solo_pairs:Array.isArray(value.solo_pairs)?value.solo_pairs.slice(0,100):[]};});}
function peerIds(groups,own,allowed){const out=new Set([own]);for(const group of groups||[]){if(!Array.isArray(group)||!group.includes(own))continue;for(const peer of group)if(allowed.has(peer))out.add(peer);}return [...out];}
function identities(ids,users){const allowed=new Set(ids);const members=users.filter(u=>allowed.has(id(u)));return {ids:members.map(id),codes:members.map(u=>text(u.recruiter_code)).filter(Boolean),names:members.flatMap(u=>[text(u.full_name),text(u.username)]).filter(Boolean)};}
function hydrateFrom(user={},config={},users=[]){
 const self=users.find(u=>id(u)===id(user))||user,own=id(user),scopes=[],choices=[];
 const soloTl=role(self)==='tl'?own:primaryTl(self,users);
 const soloMembers=new Set(users.filter(u=>role(u)==='recruiter'&&primaryTl(u,users)===soloTl).map(id));
 const soloPairs=(config.solo_pairs||[]).filter(p=>text(p.tl_id)===soloTl).map(p=>(p.members||[]).filter(k=>soloMembers.has(k)));
 const soloPeers=role(self)==='recruiter'?peerIds(soloPairs,own,soloMembers):[own];
 for(const p of config.projects||[]){
  if(p.active===false)continue;
  const tls=(p.tl_ids||[]).filter(k=>users.some(u=>id(u)===k&&role(u)==='tl'));
  const recruiters=(p.recruiter_ids||[]).filter(k=>users.some(u=>id(u)===k&&role(u)==='recruiter'));
  const allowed=new Set([...tls,...recruiters]);
  if(!isAdminOrManager(user)&&!allowed.has(own))continue;
  choices.push({id:p.id,name:p.name,tl_ids:tls,recruiter_ids:recruiters});
  const visible=isAdminOrManager(user)||role(self)==='tl'?[...allowed]:peerIds(p.pairs,own,allowed);
  scopes.push({project_id:text(p.id),...identities(visible,users)});
 }
 return {...user,__ccSharedScopes:scopes,__ccSoloPeers:identities(soloPeers,users),__ccProjectChoices:choices,__ccAccessRevision:Number(config.revision)||0};
}
async function hydrate(user){const [config,users]=await Promise.all([state(),roster()]);return hydrateFrom(user,config,users);}
async function validateAssignment(before={},next={},actor={}){
 const project=text(next.project_id),previous=text(before.project_id),newOwner=text(next.recruiter_user_id||before.recruiter_user_id||actor.user_id),oldOwner=text(before.recruiter_user_id||actor.user_id);
 if(project===previous&&newOwner===oldOwner)return;
 const {candidateBelongsToUser}=require('./accessRules');
 if(project!==previous&&before.candidate_id&&!isAdminOrManager(actor)&&!candidateBelongsToUser(before,actor))throw Object.assign(new Error('Only the profile owner or manager can move it between projects.'),{status:403});
 if(!project)return;
 const config=await state(),p=config.projects.find(p=>p.id===project&&p.active!==false);
 const owner=text(next.recruiter_user_id||before.recruiter_user_id||actor.user_id);
 if(!p||![...p.tl_ids,...p.recruiter_ids].includes(owner)||!isAdminOrManager(actor)&&![...p.tl_ids,...p.recruiter_ids].includes(id(actor)))throw Object.assign(new Error('Choose a project containing both you and the profile owner.'),{status:403});
}
function validateConfig(input,users){
 const unique=values=>[...new Set((Array.isArray(values)?values:[]).map(text).filter(Boolean))];
 if((input.projects||[]).length>60||(input.solo_pairs||[]).length>100)throw Object.assign(new Error('Too many collaboration groups.'),{status:400});
 const find=(key,wanted)=>users.find(u=>id(u)===key&&role(u)===wanted);
 const seen=new Set();
 const projects=(input.projects||[]).map(p=>{
  const key=text(p.id)||'project_'+crypto.randomUUID();if(key==='__solo__'||!/^[a-zA-Z0-9_-]{1,80}$/.test(key)||seen.has(key))throw Object.assign(new Error('Project IDs must be unique.'),{status:400});seen.add(key);
  const tl_ids=unique(p.tl_ids),recruiter_ids=unique(p.recruiter_ids),name=text(p.name).slice(0,120);
  if(!name||tl_ids.length<1||tl_ids.length>8||recruiter_ids.length>80||tl_ids.some(k=>!find(k,'tl'))||recruiter_ids.some(k=>!find(k,'recruiter')))throw Object.assign(new Error('Choose active TLs and recruiters for each project.'),{status:400});
  const paired=new Set(),allowed=new Set(recruiter_ids);const pairs=(p.pairs||[]).map(group=>{const members=unique(group);if(members.length<2||members.some(k=>!allowed.has(k)||paired.has(k)))throw Object.assign(new Error('Each recruiter can belong to one pairing group in a project.'),{status:400});members.forEach(k=>paired.add(k));return members;});
  return {id:key,name,tl_ids,recruiter_ids,pairs,active:p.active!==false};
 });
 const paired=new Set();const solo_pairs=(input.solo_pairs||[]).map(p=>{const tl_id=text(p.tl_id),members=unique(p.members);if(!find(tl_id,'tl')||members.length<2||members.some(k=>!find(k,'recruiter')||primaryTl(find(k,'recruiter'),users)!==tl_id||paired.has(k)))throw Object.assign(new Error('Solo pairings must use recruiters from the same primary TL team.'),{status:400});members.forEach(k=>paired.add(k));return {tl_id,members};});
 return {projects,solo_pairs};
}
async function getConfig(req,res){const [config,users]=await Promise.all([state(),roster()]);const manager=isAdminOrManager(req.user);return res.json({revision:config.revision,projects:config.projects.filter(p=>manager||p.tl_ids.includes(id(req.user))||p.recruiter_ids.includes(id(req.user))),solo_pairs:config.solo_pairs.filter(p=>manager||p.tl_id===id(req.user)||p.members.includes(id(req.user))),can_manage:manager,can_pair:manager||role(req.user)==='tl',choices:hydrateFrom(req.user,config,users).__ccProjectChoices});}
async function saveConfig(req,res){
 if(!isAdminOrManager(req.user)&&role(req.user)!=='tl')return res.status(403).json({message:'Only leadership can change collaboration.'});
 if(store.pool){await store.query(`insert into public.app_settings(key,value,updated_at) values($1,'{}',$2) on conflict(key) do nothing`,[KEY,new Date().toISOString()]);await store.query('select key from public.app_settings where key=$1 for update',[KEY]);}
 const current=await setting(KEY),users=await roster();
 if(Number(req.body.expected_revision)!==(Number(current.revision)||0))return res.status(409).json({message:'Collaboration changed. Refresh before saving.'});
 let input=req.body;
 if(!isAdminOrManager(req.user)){
  const own=id(req.user),incoming=(input.projects||[]);
  const projects=(current.projects||[]).map(p=>{
   const replacement=incoming.find(v=>v.id===p.id);if(!replacement)return p;
   if(!p.tl_ids.includes(own))throw Object.assign(new Error('This project is outside your team.'),{status:403});
   if(['id','name','active'].some(k=>replacement[k]!==p[k])||['tl_ids','recruiter_ids'].some(k=>JSON.stringify(replacement[k])!==JSON.stringify(p[k])))throw Object.assign(new Error('TLs can edit recruiter pairings only. The manager sets project membership.'),{status:403});
   return {...p,pairs:replacement.pairs};
  });
  if(incoming.some(p=>!(current.projects||[]).some(v=>v.id===p.id)))throw Object.assign(new Error('Only the manager creates projects.'),{status:403});
  if((input.solo_pairs||[]).some(p=>p.tl_id!==own))throw Object.assign(new Error('Only your solo team can be paired.'),{status:403});
  input={projects,solo_pairs:[...(current.solo_pairs||[]).filter(p=>p.tl_id!==own),...(input.solo_pairs||[])]};
 }
 const valid=validateConfig(input,users),saved={...valid,revision:(Number(current.revision)||0)+1};
 await store.upsert('app_settings','key',{key:KEY,value:JSON.stringify(saved),updated_at:new Date().toISOString()});
 let sharedCount=0;
 if(req.body.share_existing){if(!isAdminOrManager(req.user))throw Object.assign(new Error('Only the manager can share old data when changing a project.'),{status:403});const project=saved.projects.find(p=>p.id===text(req.body.share_existing.project_id)&&p.active!==false);if(!project)throw Object.assign(new Error('Choose an active project for old data.'),{status:400});sharedCount=await applyExisting(req.user,req.body.share_existing,project,users);}
 clearAllCaches();
 await afterCommit(()=>{const bus=require('./approvalLive');bus.refreshCollaborationScopes(saved,users);bus.publishToUsers(users.map(id),'access-changed',{revision:saved.revision});});
 return res.json({ok:true,shared_count:sharedCount,...saved,projects:saved.projects.filter(p=>isAdminOrManager(req.user)||p.tl_ids.includes(id(req.user))),solo_pairs:saved.solo_pairs.filter(p=>isAdminOrManager(req.user)||p.tl_id===id(req.user))});
}

// CC834: explicit, atomic bulk sharing. No candidate payload download or polling.
function selectedIds(value,limit){const list=Array.isArray(value)?value:[];if(list.length>limit)throw Object.assign(new Error('Selection is too large.'),{status:400});return [...new Set(list.map(text).filter(Boolean))];}
async function projectSelection(actor,input,project,users){
 if(!['owners','selected'].includes(input.mode))throw Object.assign(new Error('Choose selected profiles or recruiter profiles.'),{status:400});
 if(!isAdminOrManager(actor)&&!(role(actor)==='tl'&&project.tl_ids.includes(id(actor))))throw Object.assign(new Error('Only this project’s leadership can share profiles.'),{status:403});
 const candidateIds=selectedIds(input.candidate_ids,5000),members=selectedIds(input.recruiter_ids,80);
 if(members.some(k=>!project.recruiter_ids.includes(k)))throw Object.assign(new Error('Choose recruiters from this project.'),{status:400});
 if(input.mode==='selected'&&!candidateIds.length)throw Object.assign(new Error('Select profiles first.'),{status:400});
 const ownerIds=input.mode==='selected'?[...project.tl_ids,...project.recruiter_ids]:(members.length?members:project.recruiter_ids);
 const params=[],memberScope=candidateOwnerSql('c',{role:'recruiter',__ccSoloPeers:identities(ownerIds,users),__ccSharedScopes:[{project_id:project.id,...identities(ownerIds,users)}]},params);
 const actorScope=candidateScopeSql('c',actor,params);
 const clauses=[actorScope.sql,memberScope.sql,"coalesce(trim(c.project_id),'')='' "];
 if(input.mode==='selected'){params.push(candidateIds);clauses.push(`c.candidate_id=any($${params.length}::text[])`);}
 // candidateBelongsToUser intentionally checks only one owner; use the SQL-equivalent owner viewer for local mode.
 const localMatch=c=>!text(c.project_id)&&visibleCandidateForUser(c,actor)&&ownerIds.some(k=>candidateBelongsToUser(c,users.find(u=>id(u)===k)||{}))&&(!candidateIds.length||candidateIds.includes(text(c.candidate_id)));
 return {where:clauses.map(v=>'('+v+')').join(' and '),params,candidateIds,localMatch};
}
async function alreadyShared(actor,input,project,users){if(input.mode!=='selected')return 0;const selection=await projectSelection(actor,input,project,users);if(store.pool){const params=[...selection.params,project.id];const where=selection.where.replace("coalesce(trim(c.project_id),'')='' ","coalesce(trim(c.project_id),'')=$"+params.length);return Number(await store.scalar('select count(*)::int as n from public.candidates c where '+where,params,'n'));}return (await table('candidates')).filter(c=>text(c.project_id)===project.id&&visibleCandidateForUser(c,actor)&&selection.candidateIds.includes(text(c.candidate_id))&&[...project.tl_ids,...project.recruiter_ids].some(k=>candidateBelongsToUser(c,users.find(u=>id(u)===k)||{}))).length;}
async function countSelection(selection){return store.pool?Number(await store.scalar('select count(*)::int as n from public.candidates c where '+selection.where,selection.params,'n')):(await table('candidates')).filter(selection.localMatch).length;}
async function applyExisting(actor,input,project,users){
 const selection=await projectSelection(actor,input,project,users),count=await countSelection(selection);
 if(input.expected_count!==undefined&&Number(input.expected_count)!==count)throw Object.assign(new Error('The profile count changed. Preview again before sharing.'),{status:409});
 if(input.mode==='selected'&&count+(await alreadyShared(actor,input,project,users))!==selection.candidateIds.length)throw Object.assign(new Error('Some selected profiles are already in a project, outside your access, or owned by someone outside this project. No profiles were changed.'),{status:409});
 const stamp=new Date().toISOString();let changed=0;
 if(store.pool){
  const params=[...selection.params,project.id,stamp],pi='$'+(params.length-1),ts='$'+params.length;
  const rows=await store.query(`with moved as (update public.candidates c set project_id=${pi},updated_at=${ts} where ${selection.where} returning c.candidate_id), revenue as (update public.revenue_hub_entries r set project_id=${pi} where r.candidate_id in(select candidate_id from moved) returning r.candidate_id) select count(*)::int as n from moved`,params);changed=Number(rows[0]?.n||0);
 }else{for(const row of (await table('candidates')).filter(selection.localMatch)){await store.update('candidates','candidate_id',row.candidate_id,{project_id:project.id,updated_at:stamp});for(const entry of (await table('revenue_hub_entries')).filter(r=>text(r.candidate_id)===text(row.candidate_id)))await store.update('revenue_hub_entries','revenue_id',entry.revenue_id,{project_id:project.id});changed++;}}
 if(changed!==count)throw Object.assign(new Error('Profiles changed during sharing. Preview again. Nothing was partially saved.'),{status:409});
 clearAllCaches();return changed;
}
async function projectProfiles(req,res){
 const [config,users]=await Promise.all([state(),roster()]);
 if(!isAdminOrManager(req.user)&&role(req.user)!=='tl')return res.status(403).json({message:'Leadership access only.'});
 const project=config.projects.find(p=>p.id===text(req.body.project_id)&&p.active!==false);if(!project)return res.status(404).json({message:'Project not found.'});
 if(Number(req.body.expected_revision)!==config.revision)return res.status(409).json({message:'Project membership changed. Refresh the project list.'});
 const selection=await projectSelection(req.user,req.body,project,users);
 return res.json({project_id:project.id,project_name:project.name,count:await countSelection(selection),already_shared:await alreadyShared(req.user,req.body,project,users),revision:config.revision});
}
async function shareProjectProfiles(req,res){
 if(!isAdminOrManager(req.user)&&role(req.user)!=='tl')return res.status(403).json({message:'Leadership access only.'});
 if(store.pool)await store.query('select key from public.app_settings where key=$1 for update',[KEY]);
 const [config,users]=await Promise.all([setting(KEY),roster()]);
 if(Number(req.body.expected_revision)!==(Number(config.revision)||0))return res.status(409).json({message:'Project membership changed. Preview again.'});
 const project=(config.projects||[]).find(p=>p.id===text(req.body.project_id)&&p.active!==false);if(!project)return res.status(404).json({message:'Project not found.'});
 const count=await applyExisting(req.user,req.body,project,users);
 await afterCommit(()=>require('./approvalLive').publishToUsers(users.map(id),'access-changed',{revision:config.revision,source:'project-bulk-sharing'}));
 return res.json({ok:true,count,project_id:project.id,project_name:project.name});
}

async function layout(req,res){const value=await setting(UI_KEY);return res.json({order:Array.isArray(value.order)?value.order:[],revision:Number(value.revision)||0});}
async function saveLayout(req,res){
 if(!isAdminOrManager(req.user))return res.status(403).json({message:'Only the manager can arrange the shared form.'});
 const order=req.body.order;if(!Array.isArray(order)||order.length>80||new Set(order).size!==order.length||order.some(k=>!/^[a-z_]{1,60}$/.test(k)))return res.status(400).json({message:'Invalid field order.'});
 if(store.pool){await store.query(`insert into app_settings(key,value,updated_at) values($1,'{}',$2) on conflict(key) do nothing`,[UI_KEY,new Date().toISOString()]);await store.query('select key from app_settings where key=$1 for update',[UI_KEY]);}
 const previous=await setting(UI_KEY);if(Number(req.body.expected_revision)!==(Number(previous.revision)||0))return res.status(409).json({message:'Layout changed elsewhere. Reload the layout before saving.'});
 const value={order,revision:(Number(previous.revision)||0)+1};await store.upsert('app_settings','key',{key:UI_KEY,value:JSON.stringify(value),updated_at:new Date().toISOString()});
 await afterCommit(async()=>require('./approvalLive').publishToUsers((await roster()).map(id),'form-layout',value));
 return res.json({ok:true,...value});
}
module.exports={KEY,UI_KEY,roster,state,setting,primaryTl,hydrateFrom,hydrate,validateAssignment,validateConfig,getConfig,projectProfiles,shareProjectProfiles:require('./store').transactionalHandler(shareProjectProfiles),saveConfig:require('./store').transactionalHandler(saveConfig),layout,saveLayout:require('./store').transactionalHandler(saveLayout)};
