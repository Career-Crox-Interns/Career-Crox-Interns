import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(root, 'backend');
const archive = path.join(backend, 'source.bundle.json.gz');
const manifestFile = path.join(backend, 'source-manifest.json');
const sync = process.argv.includes('--sync-manifest');
const marker = '// CC_SPEED_20261029_V1';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function once(source, before, after) {
  const at = source.indexOf(before);
  if (at < 0 || source.indexOf(before, at + before.length) >= 0)
    throw Error('Speed update: source differs near ' + before.slice(0, 85));
  return source.slice(0, at) + after + source.slice(at + before.length);
}

function section(source, start, end, replacement) {
  const at = source.indexOf(start), stop = source.indexOf(end, at + start.length);
  if (at < 0 || stop < 0 || source.indexOf(start, at + start.length) >= 0)
    throw Error('Speed update: section differs near ' + start);
  return source.slice(0, at) + replacement + source.slice(stop);
}

function fasterFrontend(source) {
  source = once(source, "import {api} from '../lib/api';",
    "import {api,readCandidateSuggestions,cachePrincipal} from '../lib/api';");
  source = once(source,
    ' const active=useRef(true),searchSeq=useRef(0),reminderOpened=useRef(false);',
    String.raw` const active=useRef(true),searchSeq=useRef(0),reminderOpened=useRef(false);
 const [searchLoading,setSearchLoading]=useState(false);
 const [attachmentStatus,setAttachmentStatus]=useState({});
 const attachmentJobs=useRef({}),emailRevision=useRef(0),saveRevision=useRef(0);
 const liveForm=useRef(form);liveForm.current=form;
 const editorKey=cachePrincipal()+'|'+(form?String(form.candidate_id||'')+'|'+String(form.revenue_id||form.command_id||'new'):'closed');
 const liveEditorKey=useRef(editorKey);liveEditorKey.current=editorKey;
 const revenueFlight=useRef(null),refreshTimer=useRef(null),refreshPending=useRef(false),refreshAgain=useRef(false),dataRevision=useRef(0);
 useEffect(()=>{
  for(const job of Object.values(attachmentJobs.current))job.controller.abort();
  attachmentJobs.current={};setAttachmentStatus({});emailRevision.current++;
  return()=>{for(const job of Object.values(attachmentJobs.current))job.controller.abort();attachmentJobs.current={};};
 },[editorKey]);
 useEffect(()=>{if(!form&&refreshPending.current)requestRevenueRefresh(100);},[Boolean(form)]);
 function requestRevenueRefresh(delay=650){
  refreshPending.current=true;clearTimeout(refreshTimer.current);
  if(liveForm.current||!active.current)return;
  refreshTimer.current=setTimeout(()=>{refreshTimer.current=null;if(active.current&&!liveForm.current)void load(true);},delay);
 }
 async function chooseSpeedPreview(row){
  const ticket=++searchSeq.current,key=liveEditorKey.current,scope=cachePrincipal();
  setSearchLoading(true);
  try{
   const reply=await api.get('/api/revenue-hub/candidate-search?q='+encodeURIComponent(row.candidate_id),{cacheTtlMs:0,retries:0,timeoutMs:12000});
   if(!active.current||ticket!==searchSeq.current||key!==liveEditorKey.current||scope!==cachePrincipal())return;
   const full=(reply.items||[]).find(item=>String(item.candidate_id)===String(row.candidate_id));
   if(!full)throw Error('This profile is no longer available. Search again.');
   choose({...full,__speedScope:scope});
  }catch(error){if(active.current&&ticket===searchSeq.current&&scope===cachePrincipal())setMessage(error.message);}
  finally{if(active.current&&ticket===searchSeq.current)setSearchLoading(false);}
 }
`);
  source = section(source, ' async function load(force=false)',
    ' useEffect(()=>{if(!form||form.revenue_id||form.candidate_id)return;', String.raw` async function load(force=false){
  if(revenueFlight.current){if(force)refreshAgain.current=true;return revenueFlight.current;}
  const revision=dataRevision.current,scope=cachePrincipal();refreshPending.current=false;
  const flight=Promise.resolve().then(async()=>{
   try{
    const result=await api.get('/api/revenue-hub?target_month='+encodeURIComponent(targetMonthRef.current),{cacheTtlMs:force?0:90000,allowStale:!force,timeoutMs:20000,retries:0});
    if(!active.current||scope!==cachePrincipal())return;
    if(revision!==dataRevision.current){requestRevenueRefresh();return;}
    setData(result);
    if(!destinationDefaults.current){destinationDefaults.current=true;const preferred=cc864SharePreferences(user?.user_id||user?.username,result.share_default);setDestination(preferred.value);setDestinationType(preferred.type);setGroupLabel(preferred.group_label);setMessageTemplate(preferred.message_template);}
    lastRevenueLoad.current=Date.now();
   }catch(error){if(active.current&&scope===cachePrincipal())setMessage(error.message);}
   finally{revenueFlight.current=null;if(refreshAgain.current&&active.current){refreshAgain.current=false;requestRevenueRefresh();}}
  });
  revenueFlight.current=flight;return flight;
 }
 useEffect(()=>{
  active.current=true;void load();
  const changed=event=>{
   const route=String(event.detail?.path||event.detail?.source||'').split('?')[0];
   if(/resume-autofill|fresh-rotation|\/(?:open|contact-access|whatsapp-log)$/.test(route))return;
   if(savingRevenueRef.current&&/^\/api\/revenue-hub\/(?:add-candidate|[^/]+\/status)$/.test(route))return;
   if(deletingRevenueRef.current&&event.detail?.method==='DELETE'&&/^\/api\/revenue-hub\/[^/]+$/.test(route))return;
   if(/revenue|flowchart|candidate/.test(route)){dataRevision.current++;requestRevenueRefresh();}
  };
  const focus=()=>{if(document.visibilityState==='visible'&&Date.now()-lastRevenueLoad.current>120000)requestRevenueRefresh();};
  window.addEventListener('career-crox-data-written',changed);window.addEventListener('career-crox-manager-reminder-dirty',changed);window.addEventListener('focus',focus);
  return()=>{active.current=false;clearTimeout(refreshTimer.current);window.removeEventListener('career-crox-data-written',changed);window.removeEventListener('career-crox-manager-reminder-dirty',changed);window.removeEventListener('focus',focus);};
 },[]);
`);
  source = section(source,
    ' useEffect(()=>{if(!form||form.revenue_id||form.candidate_id)return;',
    ' useEffect(()=>{if(reminderOpened.current)return;', String.raw` useEffect(()=>{
  const ticket=++searchSeq.current,q=search.normalize('NFKC').trim().slice(0,80),scope=cachePrincipal();
  if(!form||form.revenue_id||form.candidate_id||!q){setFound([]);setSearchLoading(false);return;}
  setFound(readCandidateSuggestions(q).slice(0,12).map(row=>({...row,__speedPreview:true,__speedScope:scope})));
  setSearchLoading(true);
  const controller=new AbortController();
  const timer=setTimeout(async()=>{
   try{
    const result=await api.get('/api/revenue-hub/candidate-search?q='+encodeURIComponent(q),{cacheTtlMs:15000,retries:0,timeoutMs:12000,signal:controller.signal});
    if(active.current&&ticket===searchSeq.current&&scope===cachePrincipal())setFound((result.items||[]).slice(0,12).map(row=>({...row,__speedScope:scope})));
   }catch(error){if(!controller.signal.aborted&&active.current&&ticket===searchSeq.current&&scope===cachePrincipal())setMessage(error.message);}
   finally{if(active.current&&ticket===searchSeq.current)setSearchLoading(false);}
  },120);
  return()=>{clearTimeout(timer);controller.abort();if(ticket===searchSeq.current)searchSeq.current++;};
 },[search,Boolean(form),form?.candidate_id,form?.revenue_id,editorKey]);
`);
  source = once(source, ' function choose(c){c=', String.raw` function choose(c){
  if(c.__speedScope&&c.__speedScope!==cachePrincipal()){setFound([]);setMessage('Dashboard access changed. Search again.');return;}
  if(c.__speedPreview){void chooseSpeedPreview(c);return;}
  searchSeq.current++;setSearchLoading(false);c=`);
  source = once(source, "if(key==='email')setEmailConflict(null);",
    "if(key==='email'){emailRevision.current++;setEmailConflict(null);}");
  source = once(source, 'const width=Math.min(3000,picture.width)', 'const width=Math.min(2200,picture.width)');
  source = once(source, "canvas.toBlob(resolve,'image/jpeg',0.94)", "canvas.toBlob(resolve,'image/jpeg',0.86)");
  source = section(source, " async function attach(file,kind='original_resume')", ' const draft=form?', String.raw` async function attach(file,kind='original_resume'){
  if(!file)return;
  if(busy||savingRevenueRef.current){setMessage('Let the current save finish before changing attachments.');return;}
  const cid=liveForm.current?.candidate_id;
  if(!cid){setMessage('Select a candidate first.');return;}
  const ext=String(file.name||'').split('.').pop().toLowerCase(),isImage=['jpg','jpeg','png','webp'].includes(ext);
  if(!['pdf','doc','docx','jpg','jpeg','png','webp'].includes(ext)){setMessage('Choose a PDF, Word document, JPG, PNG or WEBP.');return;}
  if(!file.size||file.size>6*1024*1024){setMessage('Choose a file up to 6 MB.');return;}
  attachmentJobs.current[kind]?.controller.abort();
  const job={controller:new AbortController()},key=liveEditorKey.current,scope=cachePrincipal(),edited=emailRevision.current,saved=saveRevision.current;
  attachmentJobs.current[kind]=job;
  const current=()=>active.current&&attachmentJobs.current[kind]===job&&key===liveEditorKey.current&&scope===cachePrincipal();
  const status=text=>{if(current())setAttachmentStatus(old=>({...old,[kind]:text}));};
  if(kind==='client_image')setClientImage(null);else setResume(null);
  status('Preparing attachment...');setShareFollowUp('');setShareHint('');
  try{
   await new Promise(resolve=>setTimeout(resolve,0));
   if(!current())return;
   const prepared=kind==='client_image'&&isImage?await brandRevenueImage(file):file;
   if(!current())return;
   if(prepared.size>6*1024*1024)throw Error('Prepared file exceeds 6 MB.');
   if(kind==='client_image')setClientImage(prepared);else setResume(prepared);
   setMessage('Attachment ready. Continue editing; files remain temporary.');
   if(!isImage){
    status('Checking email in background...');
    const content=await base64(file);if(!current())return;
    const extracted=await api.post('/api/candidates/resume-autofill',{name:file.name,mime_type:file.type,content_base64:content},{retries:0,timeoutMs:20000,detachedWrite:true,background:true,signal:job.controller.signal});
    if(!current()||edited!==emailRevision.current||saved!==saveRevision.current)return;
    const proposed=String(extracted?.fields?.email||'').trim();
    const email=extracted?.email_verified&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(proposed)?proposed:'';
    const existing=String(liveForm.current?.email||'').trim();
    if(email&&existing&&email.toLowerCase()!==existing.toLowerCase())setEmailConflict({current:existing,resume:email});
    else if(email)setForm(old=>old?.candidate_id===cid?{...old,email:old.email||email}:old);
    setMessage(email?'Email checked. Review it before saving.':'Attachment ready. Enter email manually if needed.');
   }
  }catch(error){if(current()&&!job.controller.signal.aborted)setMessage('Attachment: '+error.message+'. You can continue editing.');}
  finally{if(current()){setAttachmentStatus(old=>({...old,[kind]:''}));delete attachmentJobs.current[kind];}}
 }
`);
  let share = source.slice(source.indexOf(" async function shareFiles(mode='auto')"), source.indexOf(' function makeWhatsAppUrl()'));
  const oldShare = share;
  share = once(share, '  if(busy||shareInProgressRef.current)return;', String.raw`  if(busy||shareInProgressRef.current)return;
  if(Object.values(attachmentStatus).includes('Preparing attachment...')){setShareHint('The attachment is preparing. Continue editing while it finishes.');return;}
  const key=liveEditorKey.current,scope=cachePrincipal();
  const current=()=>active.current&&key===liveEditorKey.current&&scope===cachePrincipal();`);
  share = once(share, "   });\n   if(mode==='image')", "   });\n   if(!current())return;\n   if(mode==='image')");
  share = once(share, '  }catch(e){', '  }catch(e){\n   if(!current())return;');
  share = once(share, 'shareInProgressRef.current=false;setSharing(false);', 'shareInProgressRef.current=false;if(active.current)setSharing(false);');
  source = once(source, oldShare, share);
  source = once(source, 'if(savingRevenueRef.current||busy||sharing||!form)return;', 'if(savingRevenueRef.current||busy||!form)return;');
  source = once(source, '  savingRevenueRef.current=true;\n  setBusy(true);',
    '  savingRevenueRef.current=true;saveRevision.current++;dataRevision.current++;\n  const saveKey=liveEditorKey.current,saveScope=cachePrincipal();\n  setBusy(true);');
  source = once(source, 'expected_updated_at:form.updated_at}:payload,{retries:0,allowStale:false});',
    'expected_updated_at:form.updated_at}:payload,{retries:0,allowStale:false,detachedWrite:true});');
  source = once(source, '   if(andInform)inform({windowRef:popup,savedCandidateId:result.item.candidate_id});',
    '   if(!active.current||saveKey!==liveEditorKey.current||saveScope!==cachePrincipal())return;\n   dataRevision.current++;\n   if(andInform)inform({windowRef:popup,savedCandidateId:result.item.candidate_id});');
  source = once(source, '   void load(true);\n  }catch(e){', '   requestRevenueRefresh();\n  }catch(e){');
  source = once(source, '   void load(true);\n  }catch(error){', '   dataRevision.current++;requestRevenueRefresh();\n  }catch(error){');
  source = once(source, 'disabled={busy||sharing} onClick={()=>{setForm(null);', 'disabled={busy} onClick={()=>{setForm(null);');
  source = once(source, 'disabled={busy||sharing} onClick={()=>save(false)}', 'disabled={busy} onClick={()=>save(false)}');
  source = once(source, 'disabled={busy||sharing} onClick={addAnother}', 'disabled={busy} onClick={addAnother}');
  source = once(source, 'disabled={busy||sharing} onClick={()=>{setEditorTab(\'share\');',
    'disabled={busy||sharing||Object.values(attachmentStatus).includes(\'Preparing attachment...\')} onClick={()=>{setEditorTab(\'share\');');
  source = once(source, 'placeholder="Search candidate by name, phone or serial…"/>',
    'placeholder="Type a name, number or candidate ID…"/>{searchLoading&&<small role="status">Finding profiles…</small>}');
  source = once(source, "<span>{c.phone||c.number} · {c.candidate_id}</span>",
    "<span>{c.phone||c.number} · {c.candidate_id}{c.location||c.preferred_location?' · '+(c.location||c.preferred_location):''}</span>");
  source = once(source, "{form.candidate_id||'Select a candidate'}</span></footer>",
    "{form.candidate_id||'Select a candidate'}<small role=\"status\" style={{display:'block',maxWidth:280}}>{Object.values(attachmentStatus).filter(Boolean).join(' · ')}{sharing?' · WhatsApp Share panel open':''}</small></span></footer>");
  return marker + '\n' + source;
}

function fasterBackend(source) {
  source = once(source, "async function getVisibleCandidates(user, query = '') {\n  const trimmedQuery = String(query || '').trim();",
    "async function getVisibleCandidates(user, query = '') {\n  const trimmedQuery = String(query || '').normalize('NFKC').trim().slice(0,80);\n  if(!trimmedQuery)return [];");
  source = once(source, '        limit 100\n      `, params);', '        limit 12\n      `, params);');
  source = once(source, '  return buildVisibleCandidateSearchFallback(user, trimmedQuery);',
    '  return (await buildVisibleCandidateSearchFallback(user, trimmedQuery)).slice(0,12);');
  source = once(source,
    "  const items = await getVisibleCandidates(req.user, req.query.q || '');\n  const users=await require('../lib/collaborationAccess').roster();",
    "  res.setHeader('Cache-Control','private, no-store');\n  const [items,users]=await Promise.all([getVisibleCandidates(req.user,req.query.q||''),require('../lib/collaborationAccess').roster()]);");
  source = once(source,
    'async function syncLatestInterviewToCandidate(candidateId){\n  const latest=await findRevenueEntryByCandidateId(candidateId);',
    'async function syncLatestInterviewToCandidate(candidateId,knownLatest=null){\n  const latest=knownLatest&&normalizeCandidateCode(knownLatest.candidate_id)===normalizeCandidateCode(candidateId)?knownLatest:await findRevenueEntryByCandidateId(candidateId);');
  source = once(source, ' await syncLatestInterviewToCandidate(candidateId);\n const note=await savePipelineNote(req,inserted);\n const current=await store.findById(\'candidates\',\'candidate_id\',candidateId);',
    ' const synced=await syncLatestInterviewToCandidate(candidateId);\n const note=await savePipelineNote(req,inserted);\n const current=!note&&synced?synced:await store.findById(\'candidates\',\'candidate_id\',candidateId);');
  source = section(source, "  // The linked candidate's current owner permissions also apply to revenue edits.",
    '  if(!isLeadership(req.user)){req.body=',
    '  // linkedProfile above already passed the same current-owner permission check.\n');
  source = once(source,
    "  if(latest?.revenue_id===revenueId)await syncLatestInterviewToCandidate(existing.candidate_id);\n  const note=await savePipelineNote(req,item,existing.notes);\n  const current=await store.findById('candidates','candidate_id',existing.candidate_id);\n  if(String(updates.process||'').trim())await require('./candidateController').saveSharedCandidateOption('process',updates.process);",
    "  const synced=latest?.revenue_id===revenueId?await syncLatestInterviewToCandidate(existing.candidate_id,latest):null;\n  const note=await savePipelineNote(req,item,existing.notes);\n  const current=!note&&synced?synced:await store.findById('candidates','candidate_id',existing.candidate_id);\n  if(String(updates.process||'').trim()&&singleProcess(updates.process)!==singleProcess(existing.process))await require('./candidateController').saveSharedCandidateOption('process',updates.process);");
  source = once(source,
    "  const officePresetRow = await store.findById('app_settings','key','revenue_hub_office_choices_v86').catch(()=>null);",
    "  const [officePresetRow,config,roster,candidateProcessOptions]=await Promise.all([store.findById('app_settings','key','revenue_hub_office_choices_v86').catch(()=>null),revenueConfig(),visibleRoster(req.user),getVisibleCandidateProcessOptions(req.user)]);");
  source = once(source, '  const config=await revenueConfig(),roster=await visibleRoster(req.user),month=isoMonth(todayIst());',
    '  const month=isoMonth(todayIst());');
  source = once(source, '  const candidateProcessOptions = await getVisibleCandidateProcessOptions(req.user);\n', '');
  return marker + '\n' + source;
}

function requestTiming(source) {
  return once(source, 'const router = express.Router();', String.raw`const router = express.Router();
// Timing appears in the browser Network panel after the real response/commit.
router.use((req,res,next)=>{
 if(!/^\/revenue-hub(?:\/|$)/.test(req.path))return next();
 const started=process.hrtime.bigint(),writeHead=res.writeHead;
 res.writeHead=function(...args){
  if(!this.headersSent)this.setHeader('Server-Timing','crm;dur='+Number(process.hrtime.bigint()-started)/1000000);
  return writeHead.apply(this,args);
 };
 return next();
});`) .replace('// API entry point.', marker + '\n// API entry point.');
}

function applySpeedUpdate() {
  const updates = [
    ['frontend/src/pages/RevenueHubPage.jsx', fasterFrontend],
    ['backend/src/controllers/revenueHubController.js', fasterBackend],
    ['backend/src/routes.js', requestTiming],
  ];
  // Validate every transformation before changing any project source.
  const pending = updates.map(([relative, transform]) => {
    const file = path.join(root, relative), source = fs.readFileSync(file, 'utf8');
    return { file, source: source.includes(marker) ? source : transform(source) };
  });
  for (const { file, source } of pending) {
    if (fs.readFileSync(file, 'utf8') === source) continue;
    const temp = file + '.speed-' + process.pid;
    fs.writeFileSync(temp, source);fs.renameSync(temp, file);
  }
  console.log('Career Crox: Pipeline speed update ready. No SQL or new dependency required.');
}

function sources() {
  const files = {};
  function scan(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) scan(file);
      else if (item.isFile()) {
        const bytes = fs.readFileSync(file), relative = path.relative(backend, file).replaceAll('\\', '/');
        files[relative] = { sha256: hash(bytes), base64: bytes.toString('base64') };
      } else throw Error('Backend source must be a regular file: ' + file);
    }
  }
  scan(path.join(backend, 'src'));return files;
}

function validPath(relative) {
  return relative.startsWith('src/') && !relative.includes('\\') && !relative.includes('\0') && !relative.split('/').some(s => !s || s === '.' || s === '..');
}

if (!process.argv.includes('--pack') && fs.existsSync(manifestFile)) {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')), expected = manifest.sha256;
  if (manifest.format !== 'loose-backend-v1' || !expected || typeof expected !== 'object' || !Number.isInteger(manifest.file_count) || Object.keys(expected).length !== manifest.file_count || !Object.hasOwn(expected, 'src/server.js'))
    throw Error('Invalid loose backend source manifest.');
  let changed = 0;
  for (const [relative, digest] of Object.entries(expected)) {
    if (!validPath(relative) || !/^[a-f0-9]{64}$/.test(digest)) throw Error('Invalid source entry: ' + relative);
    const file = path.resolve(backend, relative);
    if (!file.startsWith(backend + path.sep) || !fs.existsSync(file)) throw Error('Missing backend source: ' + relative + '. Upload the complete backend folder.');
    if (hash(fs.readFileSync(file)) !== digest) {
      changed++;
      if (!sync) throw Error('Modified backend source: ' + relative + '. Run npm run render-build.');
    }
  }
  console.log('CC931: ' + manifest.file_count + ' backend files present; ' + changed + ' edited files.');
} else if (process.argv.includes('--pack')) {
  const files = sources();
  fs.writeFileSync(archive, zlib.gzipSync(JSON.stringify({ release: 'CC931', files }), { level: 9 }));
  console.log('Packed ' + Object.keys(files).length + ' complete backend source files.');
} else {
  const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(archive), { maxOutputLength: 40 * 1024 * 1024 }).toString('utf8'));
  if (!data.files || typeof data.files !== 'object') throw Error('Backend source archive is incomplete.');
  const pending = [];
  for (const [relative, item] of Object.entries(data.files)) {
    if (!validPath(relative)) throw Error('Invalid source path.');
    const file = path.resolve(backend, relative);
    if (!file.startsWith(backend + path.sep)) throw Error('Invalid source location.');
    const bytes = Buffer.from(item.base64, 'base64');
    if (hash(bytes) !== item.sha256) throw Error('Backend source checksum failed: ' + relative);
    pending.push({ file, bytes });
  }
  if (!pending.some(x => x.file === path.join(backend, 'src/server.js'))) throw Error('Backend server source is missing.');
  for (const { file, bytes } of pending) {
    if (fs.existsSync(file) && hash(fs.readFileSync(file)) === hash(bytes)) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + '.restore-' + process.pid;fs.writeFileSync(temp, bytes);fs.renameSync(temp, file);
  }
  console.log('Verified ' + pending.length + ' backend source files.');
}

if (sync) {
  applySpeedUpdate();
  const files = sources();
  fs.writeFileSync(manifestFile, JSON.stringify({ format: 'loose-backend-v1', release: 'CC931', file_count: Object.keys(files).length, sha256: Object.fromEntries(Object.entries(files).map(([name, item]) => [name, item.sha256])) }, null, 2) + '\n');
  console.log('CC931: Backend manifest updated.');
}