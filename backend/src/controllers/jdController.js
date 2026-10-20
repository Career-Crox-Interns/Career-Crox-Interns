const {clearAllCaches,createTimedCache}=require('../lib/cache');
const jdListCache=createTimedCache(15000, {tags:["staff", "access"]});
const { store, table, callController } = require('../lib/store');
const { visibleCandidateForUser, candidateScopeSql } = require('../lib/accessRules');
const { nextId, nowIso } = require('../lib/helpers');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function splitLines(value) {
  return String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function parseInstructionItems(value) {
  if (Array.isArray(value)) {
    return value.map((item, idx) => {
      if (typeof item === 'string') return { title: `Instruction ${idx + 1}`, content: item.trim() };
      return {
        title: String(item?.title || `Instruction ${idx + 1}`).trim(),
        content: String(item?.content || item?.message || '').trim(),
      };
    }).filter((item) => item.content);
  }
  try {
    const parsed = JSON.parse(String(value || '[]'));
    if (Array.isArray(parsed)) return parseInstructionItems(parsed);
  } catch {}
  return splitLines(value).map((item, idx) => ({ title: `Instruction ${idx + 1}`, content: item }));
}

function serializeInstructionItems(value) {
  return JSON.stringify(parseInstructionItems(value));
}

function parseSendItems(value) {
  if (Array.isArray(value)) {
    return value.map((item, idx) => ({
      order_no: Number(item?.order_no || idx + 1),
      label: String(item?.label || `Send Material ${idx + 1}`).trim(),
      message: String(item?.message || item?.content || '').trim(),
      link: String(item?.link || '').trim(),
      kind: 'text',
    })).filter((item) => item.message || item.link);
  }
  try {
    const parsed = JSON.parse(String(value || '[]'));
    if (Array.isArray(parsed)) return parseSendItems(parsed);
  } catch {}
  return splitLines(value).map((line, idx) => {
    const [label, message, link] = String(line || '').split('|').map((part) => String(part || '').trim());
    if (!label && !message && !link) return null;
    return { order_no: idx + 1, label: label || `Send Material ${idx + 1}`, message: message || '', link: link || '', kind: 'text' };
  }).filter(Boolean);
}

function serializeSendItems(value) {
  return JSON.stringify(parseSendItems(value));
}

function normalizeJd(body = {}, existing = {}) {
  const salaryMin = body.salary_min ?? existing.salary_min ?? '';
  const salaryMax = body.salary_max ?? existing.salary_max ?? '';
  const expMin = body.exp_min ?? existing.exp_min ?? '';
  const expMax = body.exp_max ?? existing.exp_max ?? '';
  return {
    ...existing,
    sector: String(body.sector ?? existing.sector ?? '').trim(),
    pincode: String(body.pincode ?? existing.pincode ?? '').trim(),
    qualification_required: String(body.qualification_required ?? existing.qualification_required ?? '').trim(),
    in_hand_min: String(body.in_hand_min ?? existing.in_hand_min ?? '').trim(),
    in_hand_max: String(body.in_hand_max ?? existing.in_hand_max ?? '').trim(),
    interview_mode: String(body.interview_mode ?? existing.interview_mode ?? '').trim(),
    working_days: String(body.working_days ?? existing.working_days ?? '').trim(),
    shift_timing: String(body.shift_timing ?? existing.shift_timing ?? '').trim(),
    rotational_shift: String(body.rotational_shift ?? existing.rotational_shift ?? '').trim(),
    women_shift: String(body.women_shift ?? existing.women_shift ?? '').trim(),
    cab: String(body.cab ?? existing.cab ?? '').trim(),
    travel_allowance: String(body.travel_allowance ?? existing.travel_allowance ?? '').trim(),
    meal: String(body.meal ?? existing.meal ?? '').trim(),
    incentive: String(body.incentive ?? existing.incentive ?? '').trim(),
    process_type: String(body.process_type ?? existing.process_type ?? '').trim(),
    role_responsibilities: String(body.role_responsibilities ?? existing.role_responsibilities ?? '').trim(),
    sample_label: String(body.sample_label ?? existing.sample_label ?? '').trim(),
    job_title: body.job_title ?? existing.job_title ?? '',
    company: body.company ?? existing.company ?? '',
    location: body.location ?? existing.location ?? '',
    preferred_location_rule: body.preferred_location_rule ?? existing.preferred_location_rule ?? '',
    qualification_rule: body.qualification_rule ?? existing.qualification_rule ?? '',
    communication_rule: body.communication_rule ?? existing.communication_rule ?? '',
    career_gap_rule: body.career_gap_rule ?? existing.career_gap_rule ?? '',
    documents_rule: body.documents_rule ?? existing.documents_rule ?? '',
    all_details_sent_rule: body.all_details_sent_rule ?? existing.all_details_sent_rule ?? '',
    relevant_experience_rule: body.relevant_experience_rule ?? existing.relevant_experience_rule ?? '',
    relevant_salary_rule: body.relevant_salary_rule ?? existing.relevant_salary_rule ?? '',
    process_name: body.process_name ?? existing.process_name ?? '',
    experience: body.experience ?? existing.experience ?? ([expMin, expMax].filter(Boolean).join('-')),
    salary: body.salary ?? existing.salary ?? ([salaryMin, salaryMax].filter(Boolean).join('-')),
    salary_min: salaryMin,
    salary_max: salaryMax,
    exp_min: expMin,
    exp_max: expMax,
    pdf_url: body.pdf_url ?? existing.pdf_url ?? '',
    jd_status: body.jd_status ?? existing.jd_status ?? 'Open',
    notes: body.notes ?? existing.notes ?? '',
    instruction_points: serializeInstructionItems(body.instruction_points ?? existing.instruction_points ?? []),
    message_template: body.message_template ?? existing.message_template ?? '',
    send_items: serializeSendItems(body.send_items ?? existing.send_items ?? []),
    updated_at: nowIso(),
  };
}

function decorate(row) {
  return {
    ...row,
    job_title: row.job_title || row.title || row.role_title || '',
    process_name: row.process_name || row.process || '',
    jd_status: row.jd_status || row.status || 'Open',
    instruction_points_list: parseInstructionItems(row.instruction_points),
    send_items_list: parseSendItems(row.send_items),
  };
}

function assertManager(user) {
  const role = lower(user?.role);
  if (!['admin', 'manager'].includes(role)) {
    const err = new Error('Only manager can edit JD Centre');
    err.statusCode = 403;
    err.status = 403;
    throw err;
  }
}

function validateJd(item) {
  for(const key of ['job_title','company','process_name','location']) if(!String(item[key]||'').trim()) return `${key.replaceAll('_',' ')} is required.`;
  if(item.pincode && !/^\d{6}$/.test(item.pincode))return 'Pincode must contain exactly 6 digits.';
  for(const [low,high,label] of [['salary_min','salary_max','Monthly CTC'],['in_hand_min','in_hand_max','In-hand salary'],['exp_min','exp_max','Experience in months']]) {
    for(const key of [low,high])if(String(item[key]??'').trim() && (!Number.isFinite(Number(item[key])) || Number(item[key])<0))return `${label} must be a non-negative number.`;
    if(String(item[low]??'').trim() && String(item[high]??'').trim() && Number(item[low])>Number(item[high]))return `${label} maximum must be at least its minimum.`;
  }
  if(item.interview_mode && !['Virtual','Walkin'].includes(item.interview_mode))return 'Interview mode must be Virtual or Walkin.';
  if(item.pdf_url && !/^https?:\/\//i.test(item.pdf_url) && !/^\/(?!\/)[a-zA-Z0-9_./%-]+$/.test(item.pdf_url))return 'PDF URL must be an http(s) link or a path on this CRM.';
  return '';
}
function pdfText(value){return String(value??'').replace(/₹/g,'INR ').replace(/[–—]/g,'-').replace(/•/g,' / ').replace(/[^\x20-\x7e\n]/g,' ').trim();}
function jdDocumentSections(jd){
 const band=(a,b)=>[a,b].filter(x=>String(x??'').trim()).join(' - ');
 return [
  ['Opportunity',[['Company',jd.company],['Process',jd.process_name],['Role type',jd.process_type],['Location',[jd.location,jd.sector?`Sector ${jd.sector}`:'',jd.pincode?`PIN ${jd.pincode}`:''].filter(Boolean).join(', ')]]],
  ['Pay & benefits',[['Monthly CTC',band(jd.salary_min,jd.salary_max)||jd.salary],['Monthly in-hand',band(jd.in_hand_min,jd.in_hand_max)],['Meal',jd.meal],['Cab',jd.cab],['Travel allowance',jd.travel_allowance],['Incentives',jd.incentive]]],
  ['Eligibility',[['Qualification',jd.qualification_required||jd.qualification_rule],['Experience',jd.experience||(band(jd.exp_min,jd.exp_max)?band(jd.exp_min,jd.exp_max)+' months':'')],['Communication',jd.communication_rule],['Interview',jd.interview_mode]]],
  ['Schedule',[['Working days',jd.working_days],['Shift',jd.shift_timing],['Rotational shift',jd.rotational_shift],['Shift for women',jd.women_shift]]],
  ['Responsibilities',splitLines(jd.role_responsibilities).map(line=>['',line])],
  ['Recruiter guidance',parseInstructionItems(jd.instruction_points).map(item=>[item.title,item.content])],
  ['Important',[[jd.sample_label?'Sample':'Notes',jd.sample_label||jd.notes]]],
 ];
}
async function makeJdPdf(jd){
 const doc=await PDFDocument.create();doc.setTitle(pdfText(jd.job_title));doc.setAuthor('Career Crox');
 const font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 let page,y;const W=595.28,H=841.89,margin=42,ink=rgb(.1,.18,.25),green=rgb(.05,.44,.35);
 function addPage(){page=doc.addPage([W,H]);page.drawRectangle({x:0,y:H-77,width:W,height:77,color:rgb(.9,.97,.95)});page.drawText('CAREER CROX',{x:margin,y:H-33,font:bold,size:13,color:green});page.drawText('Recruitment opportunities',{x:margin,y:H-52,font,size:10,color:ink});y=H-100;}
 function line(text,weight=font,size=10){if(y<52)addPage();page.drawText(text,{x:margin,y,font:weight,size,color:ink});y-=size+5;}
 function wrap(value,width=W-margin*2,size=10){let cur='';for(const word of pdfText(value).split(/\s+/)){let rest=word;while(font.widthOfTextAtSize(rest,size)>width){let n=rest.length;while(n>1&&font.widthOfTextAtSize(rest.slice(0,n),size)>width)n--;if(cur){line(cur,font,size);cur='';}line(rest.slice(0,n),font,size);rest=rest.slice(n);}const next=cur?cur+' '+rest:rest;if(font.widthOfTextAtSize(next,size)>width){line(cur,font,size);cur=rest}else cur=next;}if(cur)line(cur,font,size);}
 addPage();wrap(jd.job_title,W-margin*2,18);y-=9;
 for(const [heading,items] of jdDocumentSections(jd)){const valid=items.filter(([,value])=>String(value??'').trim());if(!valid.length)continue;if(y<100)addPage();line(heading.toUpperCase(),bold,11);for(const [label,value]of valid)wrap(label?`${label}: ${value}`:value);y-=10;}
 doc.getPages().forEach((p,i)=>p.drawText(`Career Crox | ${i+1} / ${doc.getPageCount()}`,{x:margin,y:25,font,size:8,color:rgb(.4,.5,.55)}));return Buffer.from(await doc.save());
}
async function pdf(req,res){const row=await store.findById('jd_master','jd_id',req.params.jdId);if(!row)return res.status(404).json({message:'JD not found'});const bytes=await makeJdPdf(decorate(row));const name=(row.job_title||'job-description').replace(/[^a-zA-Z0-9]+/g,'-').slice(0,65);res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`inline; filename="${name}.pdf"`);res.setHeader('Cache-Control','private, no-store');return res.send(bytes);}

async function list(req, res) {
  const cached=jdListCache.get('all');if(cached)return res.json({items:cached});
  const rows = (await table('jd_master')).map(decorate).sort((a, b) => String(a.job_title || '').localeCompare(String(b.job_title || '')));
  jdListCache.set('all',rows);
  return res.json({ items: rows });
}

async function getOne(req, res) {
  const item = await store.findById('jd_master', 'jd_id', req.params.jdId);
  if (!item) return res.status(404).json({ message: 'JD not found' });
  let feedback;
  if (store.pool) {
    const scope = candidateScopeSql('c', req.user, [String(req.params.jdId)]);
    feedback = (await store.query(`select f.* from public.candidate_jd_feedback f join public.candidates c on c.candidate_id=f.candidate_id where f.jd_id=$1 and ${scope.sql} order by f.updated_at desc limit 100`, scope.params)).rows;
  } else {
    const allowed = new Set((await table('candidates')).filter(row => visibleCandidateForUser(row, req.user)).map(row => String(row.candidate_id)));
    feedback = (await table('candidate_jd_feedback')).filter(row => String(row.jd_id) === String(req.params.jdId) && allowed.has(String(row.candidate_id))).sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))).slice(0, 100);
  }
  return res.json({ item: decorate(item), feedback });
}

async function create(req, res) {
  assertManager(req.user);
  const rows = await table('jd_master');
  const item = normalizeJd(req.body, {
    jd_id: nextId('J', rows, 'jd_id'),
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  const issue=validateJd(item);if(issue)return res.status(400).json({message:issue});
  await store.insert('jd_master', item);clearAllCaches();
  return res.json({ item: decorate(item) });
}

async function update(req, res) {
  assertManager(req.user);
  const existing = await store.findById('jd_master', 'jd_id', req.params.jdId);
  if (!existing) return res.status(404).json({ message: 'JD not found' });
  const normalized=normalizeJd(req.body, decorate(existing));
  const issue=validateJd(normalized);if(issue)return res.status(400).json({message:issue});
  const item = await store.update('jd_master', 'jd_id', req.params.jdId, normalized);clearAllCaches();
  return res.json({ item: decorate(item) });
}

async function feedback(req, res) {
  const jd = await store.findById('jd_master', 'jd_id', req.params.jdId);
  if (!jd) return res.status(404).json({ message: 'JD not found' });
  const candidateId = String(req.body.candidate_id || '').trim();
  if (!candidateId) return res.status(400).json({ message: 'candidate_id is required' });
  const candidate = await store.findById('candidates', 'candidate_id', candidateId);
  if (!candidate || !visibleCandidateForUser(candidate, req.user)) return res.status(403).json({ message: 'This candidate is not assigned to you or your team.' });
  const status = String(req.body.feedback_status || 'Pending').trim();
  if (!['Interested', 'Pending', 'Not Interested'].includes(status)) return res.status(400).json({ message: 'Choose Interested, Pending or Not Interested.' });
  const feedbackNote = String(req.body.feedback_note || '').trim();
  if (feedbackNote.length > 4000) return res.status(400).json({ message: 'JD response note must be within 4,000 characters.' });
  if (store.pool) await store.query('select candidate_id from public.candidates where candidate_id=$1 for update', [candidateId]);
  const rows = await table('candidate_jd_feedback');
  const existing = rows.find((row) => String(row.jd_id) === String(req.params.jdId) && String(row.candidate_id) === candidateId);
  const unchanged = existing && existing.feedback_status === status && existing.feedback_note === feedbackNote;
  const payload = {
    feedback_id: existing?.feedback_id || nextId('F', rows, 'feedback_id'),
    jd_id: req.params.jdId,
    candidate_id: candidateId,
    feedback_status: status,
    feedback_note: feedbackNote,
    username: req.user?.username || '',
    user_id: req.user?.user_id || '',
    updated_at: unchanged ? existing.updated_at : nowIso(),
    created_at: existing?.created_at || nowIso(),
  };
  const item = unchanged ? existing : existing
    ? await store.update('candidate_jd_feedback', 'feedback_id', existing.feedback_id, payload)
    : await store.insert('candidate_jd_feedback', payload);
  const noteBody = [`JD Response: ${jd.job_title || 'JD'}`, `Status: ${status}`, feedbackNote ? `Note: ${feedbackNote}` : ''].filter(Boolean).join(' | ');
  const note = await callController(require('./candidateController').addNote, {
    ...req, params: { ...req.params, candidateId },
    body: { body: noteBody, note_type: 'public', client_note_key: `jd-feedback:${item.feedback_id}:${item.updated_at}` },
  });
  clearAllCaches();
  return res.json({ item, note: note.item, note_saved: true });
}

module.exports = { list, getOne, create, update, feedback, pdf, normalizeJd, validateJd, makeJdPdf };

const jdCrypto=require('node:crypto');
const MAX_JD_PDF_BYTES=6*1024*1024;
async function validatedPdf(bytes){
 if(bytes.length<20||bytes.length>MAX_JD_PDF_BYTES||bytes.subarray(0,5).toString()!=='%PDF-'){const e=new Error('Choose a valid PDF up to 6 MB.');e.status=400;throw e;}
 try{const doc=await PDFDocument.load(bytes,{ignoreEncryption:false});const pages=doc.getPageCount();if(pages<1||pages>50)throw Error('Page limit');return pages;}catch{const e=new Error('This PDF is unreadable, encrypted or exceeds 50 pages.');e.status=400;throw e;}
}
function documentName(value){const safe=String(value||'Career-Crox-JD.pdf').replace(/[^a-zA-Z0-9_. -]/g,'-').slice(0,100);return safe.toLowerCase().endsWith('.pdf')?safe:safe+'.pdf';}
function publicDocumentPath(token){return '/api/jds/shared/'+token+'/file.pdf';}
async function persistJdDocument(jd,bytes,filename,user,kind='generated'){
 const sha=jdCrypto.createHash('sha256').update(bytes).digest('hex');
 if(store.pool)await store.query('select pg_advisory_xact_lock(hashtext($1))',[String(jd.jd_id)+':'+sha]);
 let old;
 if(store.pool)old=await store.one('select document_id,public_token,filename from public.jd_documents where jd_id=$1 and sha256=$2 and coalesce(deleted_at,\'\')=\'\' limit 1',[String(jd.jd_id),sha]);
 else old=(await table('jd_documents')).find(d=>String(d.jd_id)===String(jd.jd_id)&&d.sha256===sha&&!d.deleted_at);
 if(old)return old;
 const row={document_id:'JDP-'+jdCrypto.randomUUID(),jd_id:String(jd.jd_id),filename:documentName(filename),mime_type:'application/pdf',size_bytes:String(bytes.length),sha256:sha,content_base64:bytes.toString('base64'),public_token:jdCrypto.randomBytes(24).toString('hex'),kind,created_by_user_id:String(user?.user_id||''),created_at:nowIso(),deleted_at:''};
 return await store.insert('jd_documents',row)||row;
}
const documentBytesCache=require('../lib/cache').createTimedCache(300000,{maxEntries:2,tags:['jd_documents']});
async function storedDocumentByToken(token){
 if(!/^[a-f0-9]{48}$/.test(String(token||'')))return null;
 if(!store.pool)return(await table('jd_documents')).find(d=>d.public_token===token&&!d.deleted_at);
 const meta=await store.one("select document_id,sha256,filename,size_bytes,deleted_at from public.jd_documents where public_token=$1 and coalesce(deleted_at,'')='' limit 1",[String(token)]);
 if(!meta)return null;
 return documentBytesCache.load(meta.document_id+':'+meta.sha256,()=>store.one("select document_id,public_token,filename,size_bytes,sha256,content_base64 from public.jd_documents where document_id=$1 and coalesce(deleted_at,'')='' limit 1",[meta.document_id]));
}

function currentDocumentToken(jd){return String(jd.pdf_url||'').match(/^\/api\/jds\/shared\/([a-f0-9]{48})\/file\.pdf$/)?.[1]||'';}
async function uploadPdf(req,res){
 assertManager(req.user);const jd=await store.findById('jd_master','jd_id',req.params.jdId);if(!jd)return res.status(404).json({message:'Save this JD before uploading a PDF.'});
 const raw=String(req.body?.content_base64||'').replace(/^data:application\/pdf;base64,/, '');
 if(!raw||raw.length>Math.ceil(MAX_JD_PDF_BYTES*4/3)+8||!/^([a-zA-Z0-9+/]{4})*([a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=)?$/.test(raw))return res.status(400).json({message:'Choose a valid PDF up to 6 MB.'});
 const bytes=Buffer.from(raw,'base64'),pages=await validatedPdf(bytes);
 const document=await persistJdDocument(jd,bytes,req.body?.filename,req.user,'uploaded');
 const saved=await store.update('jd_master','jd_id',jd.jd_id,{pdf_url:publicDocumentPath(document.public_token),updated_at:nowIso()});clearAllCaches();
 return res.json({ok:true,item:decorate({...jd,...saved,pdf_url:publicDocumentPath(document.public_token)}),document:{document_id:document.document_id,filename:document.filename,size_bytes:bytes.length,pages,pdf_url:publicDocumentPath(document.public_token)}});
}
async function sharedPdf(req,res){
 const document=await storedDocumentByToken(req.params.token);if(!document)return res.status(404).json({message:'JD PDF not found or removed.'});
 const bytes=Buffer.from(document.content_base64||'','base64');if(bytes.length>MAX_JD_PDF_BYTES)return res.status(413).json({message:'PDF exceeds size limit.'});
 res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition','inline; filename="'+documentName(document.filename)+'"');res.setHeader('Cache-Control','private, no-cache');res.setHeader('ETag','"'+document.sha256+'"');if(req.get?.('if-none-match')==='"'+document.sha256+'"')return res.status(304).end();res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");return res.send(bytes);
}
function jdShareSummary(jd,user){
 const band=(a,b)=>[a,b].filter(x=>String(x??'').trim()).join(' - ');
 const details=[['Role',jd.job_title],['Company',jd.company],['Process',jd.process_name],['Location',[jd.location,jd.sector?'Sector '+jd.sector:'',jd.pincode?'PIN '+jd.pincode:''].filter(Boolean).join(', ')],['Monthly in-hand',band(jd.in_hand_min,jd.in_hand_max)],['Monthly CTC',band(jd.salary_min,jd.salary_max)||jd.salary],['Experience',jd.experience||(band(jd.exp_min,jd.exp_max)?band(jd.exp_min,jd.exp_max)+' months':'')],['Qualification',jd.qualification_required||jd.qualification_rule],['Communication',jd.communication_rule],['Interview',jd.interview_mode],['Working days',jd.working_days],['Shift',jd.shift_timing],['Cab',jd.cab],['Travel allowance',jd.travel_allowance],['Meal',jd.meal],['Incentives',jd.incentive]].filter(([,v])=>String(v??'').trim());
 return ['CAREER CROX',...details.map(([k,v])=>k+': '+String(v).trim()),'',jd.sample_label?'SAMPLE ONLY - confirm terms with the recruiter before proceeding.':'','Please read the JD PDF and reply Interested / Not Interested to confirm.','Recruiter: '+String(user?.full_name||user?.username||'Career Crox')].filter(Boolean).join('\n').slice(0,3500);
}
async function prepareShare(req,res){
 const jd=await store.findById('jd_master','jd_id',req.params.jdId);if(!jd||['closed','inactive','disabled'].includes(String(jd.jd_status||'').toLowerCase()))return res.status(404).json({message:'Open JD not found.'});
 let document=currentDocumentToken(jd)?await storedDocumentByToken(currentDocumentToken(jd)):null;
 if(!document){const bytes=await makeJdPdf(decorate(jd));document=await persistJdDocument(jd,bytes,documentName(jd.job_title),req.user);}
 return res.json({ok:true,jd_id:jd.jd_id,filename:document.filename,pdf_url:publicDocumentPath(document.public_token),summary:jdShareSummary(jd,req.user),size_bytes:Number(document.size_bytes),prepared:true,sent:false});
}
async function revokePdf(req,res){
 assertManager(req.user);const jd=await store.findById('jd_master','jd_id',req.params.jdId);if(!jd)return res.status(404).json({message:'JD not found'});
 const stamp=nowIso();if(store.pool)await store.query("update public.jd_documents set deleted_at=$1 where jd_id=$2 and coalesce(deleted_at,'')=''",[stamp,String(jd.jd_id)]);else for(const d of (await table('jd_documents')).filter(d=>String(d.jd_id)===String(jd.jd_id)&&!d.deleted_at))await store.update('jd_documents','document_id',d.document_id,{deleted_at:stamp});
 if(currentDocumentToken(jd))await store.update('jd_master','jd_id',jd.jd_id,{pdf_url:'',updated_at:stamp});clearAllCaches();return res.json({ok:true});
}
module.exports.uploadPdf=uploadPdf;module.exports.sharedPdf=sharedPdf;module.exports.prepareShare=prepareShare;module.exports.revokePdf=revokePdf;module.exports.jdShareSummary=jdShareSummary;
