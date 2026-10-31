const crypto = require('crypto');
const { store, withTransaction, callController } = require('../lib/store');
const { visibleCandidateForUser } = require('../lib/accessRules');
const { sanitizeCandidateForUser } = require('../lib/dataLeakGuard');
const { DOCUMENT_TYPES } = require('../lib/hrDocuments');
const HR_FIELDS=['employee_code','full_name','phone','email','designation','department','employment_status','work_location','date_of_joining','offer_date','probation_period','reporting_manager','salary_monthly','salary_in_hand','shift_start','shift_end','weekly_off','notes'];
function guard(req,res,next) {
  const role=String(req.user?.role||'').toLowerCase();
  if(!['admin','manager'].includes(role)) return res.status(403).json({message:'Manager or admin access required.'});
  next();
}
function clean(row={}) {
  const out={employee_id:row.employee_id,updated_at:row.updated_at};
  for(const key of HR_FIELDS) if(row[key]!==undefined) out[key]=row[key];
  return out;
}
async function hrWorkspace(req,res) {
  const page=Math.max(1,Math.min(10000,Number(req.query.page)||1)),offset=(page-1)*50;
  const query=String(req.query.q||'').slice(0,100).trim();
  let rows;
  if(store.pool) rows=await store.query(`select employee_id, ${HR_FIELDS.join(',')}, updated_at from public.hr_employees where ($1='' or full_name ilike $2 or employee_code ilike $2) order by full_name,employee_id limit 51 offset $3`,[query,`%${query}%`,offset]);
  else rows=(await store.all('hr_employees')).filter(row=>!query||`${row.full_name} ${row.employee_code}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>String(a.full_name).localeCompare(String(b.full_name))).slice(offset,offset+51);
  return res.json({items:rows.slice(0,50).map(clean),page,has_more:rows.length>50,document_types:DOCUMENT_TYPES.map(({key,label})=>({key,label}))});
}
async function saveEmployee(req,res) {
  const id=String(req.params.employeeId||'').trim();
  const key=String(req.body.command_id||'');
  if(!/^[a-zA-Z0-9_-]{16,128}$/.test(key))return res.status(400).json({message:'A stable save key is required.'});
  const payload={};
  for(const key of HR_FIELDS) if(Object.prototype.hasOwnProperty.call(req.body||{},key)) {
    if(['salary_monthly','salary_in_hand'].includes(key)){const n=Number(req.body[key]);if(!Number.isFinite(n)||n<0)return res.status(400).json({message:'Salary must be a valid non-negative amount.'});payload[key]=n;}
    else payload[key]=String(req.body[key]??'').trim().slice(0,key==='notes'?2000:180);
  }
  const actor=String(req.user.user_id||req.user.username),receiptId=`${actor}:hr:${key}`;
  const hash=crypto.createHash('sha256').update(JSON.stringify({id,payload,expected:req.body.expected_updated_at||''})).digest('hex');
  try {
    const response=await withTransaction(async()=>{
      if(store.pool)await store.query('select pg_advisory_xact_lock(hashtext($1))',[receiptId]);
      const old=await store.findById('crm_command_receipts','command_id',receiptId);
      if(old){if(old.payload_hash!==hash){const e=new Error('Save key was used for a different employee change.');e.status=409;throw e;}return {...JSON.parse(old.receipt_json),replayed:true};}
      const current=id?(store.pool?(await store.query('select * from hr_employees where employee_id=$1 for update',[id]))[0]:await store.findById('hr_employees','employee_id',id)):null;
      if(id&&!current){const e=new Error('Employee not found.');e.status=404;throw e;}
      if(id&&String(req.body.expected_updated_at||'')!==String(current.updated_at||'')){const e=new Error('This employee changed. Reload the directory and reopen Edit before saving.');e.status=409;throw e;}
      if(!String(payload.full_name??current?.full_name??'').trim()){const e=new Error('Employee name is required.');e.status=400;throw e;}
      const stamp=new Date().toISOString();
      const item=id?await store.update('hr_employees','employee_id',id,{...payload,updated_at:stamp}):await store.insert('hr_employees',{employee_id:`HREMP-${crypto.randomUUID()}`,...payload,employment_status:payload.employment_status||'active',created_at:stamp,updated_at:stamp});
      const result={ok:true,item:clean(item)};
      await store.insert('crm_command_receipts',{command_id:receiptId,user_id:actor,candidate_id:'',payload_hash:hash,receipt_json:JSON.stringify(result),created_at:stamp});
      return result;
    });
    return res.json(response);
  }catch(error){if(error.status)return res.status(error.status).json({message:error.message});throw error;}
}
async function history(req,res) {
  const id=String(req.query.employee_id||'').trim();
  let items;
  if(store.pool)items=await store.query('select run_id,employee_id,employee_name,document_type,file_url,preview_url,created_at from public.hr_document_runs where ($1=\'\' or employee_id=$1) order by created_at desc limit 50',[id]);
  else items=(await store.all('hr_document_runs')).filter(row=>!id||row.employee_id===id).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,50);
  return res.json({items});
}
async function importCandidates(req,res) {
  const key=String(req.body.command_id||'');
  if(!/^[a-zA-Z0-9_-]{16,128}$/.test(key)) return res.status(400).json({message:'A stable import key is required.'});
  if(Array.isArray(req.body.items)&&req.body.items.length>30)return res.status(400).json({message:'Import up to 30 reviewed rows at a time.'});
  const items=Array.isArray(req.body.items)?req.body.items:[];
  if(!items.length||items.some(row=>!String(row.full_name||'').trim()||!/^\d+$/.test(require('../lib/candidatePhoneGuard').normalizeInput(row.phone))))return res.status(400).json({message:'Review candidate names and phone numbers first.'});
  const actor=String(req.user.user_id||req.user.username),receiptId=`${actor}:bulk:${key}`;
  const hash=crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex');
  try {
    const result=await withTransaction(async()=>{
      if(store.pool)await store.query('select pg_advisory_xact_lock(hashtext($1))',[receiptId]);
      const old=await store.findById('crm_command_receipts','command_id',receiptId);
      if(old){if(old.payload_hash!==hash){const e=new Error('Import key was already used for different rows.');e.status=409;throw e;}const receipt=JSON.parse(old.receipt_json);for(const row of receipt.items||[]){const current=await store.findById('candidates','candidate_id',row.candidate_id);if(!current||!visibleCandidateForUser(current,req.user)){const e=new Error('Imported profile access changed.');e.status=403;throw e;}}return {...receipt,replayed:true};}
      const controller=require('./candidateController');
      const result=await callController(controller.bulkCreate,{...req,body:{items}});
      const response={...result,items:result.items.map(item=>sanitizeCandidateForUser(item,req.user))};
      await store.insert('crm_command_receipts',{command_id:receiptId,user_id:actor,candidate_id:response.items[0]?.candidate_id||'',payload_hash:hash,receipt_json:JSON.stringify(response),created_at:new Date().toISOString()});
      return response;
    });
    return res.json(result);
  }catch(error){if(error.status)return res.status(error.status).json({message:error.message});throw error;}
}
module.exports={guard,hrWorkspace,saveEmployee,history,importCandidates};

// Explicit optional photo generation; no database/storage writes or photo retention.
const cc129ImageLimits=new Map();let cc129ActiveImages=0;
async function companionCartoon(req,res){
 res.setHeader('Cache-Control','private, no-store');const key=process.env.CC129_IMAGE_API_KEY||process.env.OPENAI_API_KEY||'';
 if(req.method==='GET')return res.json({configured:!!key,provider:'OpenAI',styles:6});
 if(!key)return res.status(503).json({message:'AI image generation needs manager setup. Six local photo styles are available without an image service.'});
 const raw=String(req.body?.image||''),m=raw.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
 if(!m||m[2].length>1400000)return res.status(400).json({message:'Choose a PNG, JPEG or WebP image below 1 MB.'});
 const bytes=Buffer.from(m[2],'base64'),mime=m[1],valid=mime==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!valid||bytes.length<32||bytes.length>1024*1024)return res.status(400).json({message:'This photo format is invalid. Choose another image.'});
 const uid=String(req.user?.user_id||'');if(!uid)return res.status(401).json({message:'Sign in to create a companion.'});
 const now=Date.now();for(const [id,r]of cc129ImageLimits)if(!r.busy&&now-r.at>3600000)cc129ImageLimits.delete(id);
 const record=cc129ImageLimits.get(uid)||{at:now,count:0,busy:false};if(record.busy||record.count>=3||cc129ActiveImages>=2||cc129ImageLimits.size>=250&&!cc129ImageLimits.has(uid))return res.status(429).json({message:record.busy?'Your cartoon is already being created. Please wait.':'Please try again later. The image service is at its generation limit.'});
 record.busy=true;record.count++;cc129ImageLimits.set(uid,record);cc129ActiveImages++;
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),180000),abort=()=>{if(!res.writableEnded)controller.abort();};res.on('close',abort);
 try{const form=new FormData();form.set('model',process.env.CC129_IMAGE_MODEL||'gpt-image-1.5');form.set('image[]',new Blob([bytes],{type:'image/'+mime}),'portrait.'+(mime==='jpeg'?'jpg':mime));
 form.set('prompt','Use the uploaded person as the identity reference. Create a premium sharp 3D cartoon office mascot contact sheet: EXACTLY 3 equal columns by 2 equal rows, six separate full-body characters centred inside their cells. Genuine transparent background, generous transparent margins. Preserve the person’s face, hair, glasses and recognizable identity. Cute professional adult proportions, large friendly head, small office outfit, expressive eyes. Six distinct tasteful looks, one per cell: modern blue recruiter, teal coordinator, warm orange creative, purple studio professional, mint support, cheerful rose team leader. Same identity with different outfit and cartoon styling in each cell. Include feet and an independent silhouette. No lettering, captions, panels, overlapping characters, extra people, logos or shadows outside cells. Sharp premium detailed rendered finish.');
 for(const [name,value]of Object.entries({n:'1',size:'1536x1024',quality:'medium',background:'transparent',output_format:'webp',output_compression:'88'}))form.set(name,value);
 const response=await fetch('https://api.openai.com/v1/images/edits',{method:'POST',headers:{Authorization:'Bearer '+key},body:form,signal:controller.signal});
 if(!response.ok){await response.body?.cancel();return res.status(502).json({message:'The image service could not create your cartoon. Check the manager image-service configuration or use local styles.'});}
 const d=await response.json(),image=d?.data?.[0]?.b64_json;if(typeof image!=='string'||image.length>18*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(image))throw Error('Invalid image response');const output=Buffer.from(image,'base64');if(output.toString('ascii',0,4)!=='RIFF'||output.toString('ascii',8,12)!=='WEBP')throw Error('Unexpected format');
 return res.json({image,mime:'image/webp',columns:3,rows:2,styles:6});
 }catch(e){if(res.destroyed)return;return res.status(502).json({message:e.name==='AbortError'?'The image service took too long. Your photo was not saved. Use local styles or retry later.':'Your cartoon could not be generated. No photo was saved. Try local styles or retry later.'});}
 finally{clearTimeout(timeout);res.removeListener('close',abort);record.busy=false;cc129ActiveImages--;}
}
module.exports.companionCartoon=companionCartoon;
