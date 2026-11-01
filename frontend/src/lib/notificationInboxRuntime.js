import {api,accountPrincipal} from './api';
import {getPollingLeaderSnapshot,subscribePollingLeader} from './tabLeader';
import {readPopupStudio,popupVisual,popupBounds,POPUP_FONTS} from './popupAppearance';
import {notificationTarget} from './workspaceHelpers';

// Recipients and existing delivery rules remain unchanged.
const DEFAULT_POLICY={tl_enabled:true,manager_seconds:1,tl_seconds:1};
let policyScope='',policyState={...DEFAULT_POLICY},policyAt=0,policyFlight=null;

export function readWorkNoticePolicy(){
 const scope=accountPrincipal();
 if(scope!==policyScope){
  policyScope=scope;
  policyState={...DEFAULT_POLICY};
  policyAt=0;
  policyFlight=null;
 }
 return {...policyState};
}

function applyPolicy(raw={}){
 readWorkNoticePolicy();
 const seconds=value=>Math.max(.5,Math.min(30,Number(value)||1));
 policyState={
  tl_enabled:true,
  manager_seconds:seconds(raw.manager_seconds),
  tl_seconds:seconds(raw.tl_seconds)
 };
 policyAt=Date.now();
 window.dispatchEvent(new Event('cc119-work-notice-settings'));
 return readWorkNoticePolicy();
}

export function subscribeWorkNoticePolicy(listener){
 const receive=()=>listener(readWorkNoticePolicy());
 window.addEventListener('cc119-work-notice-settings',receive);
 return()=>window.removeEventListener('cc119-work-notice-settings',receive);
}

export function canReceiveWorkNotices(user){
 return Boolean(user?.user_id);
}

export async function loadWorkNoticePolicy(force=false){
 readWorkNoticePolicy();
 if(!force&&policyAt&&Date.now()-policyAt<300000)return readWorkNoticePolicy();
 if(policyFlight)return policyFlight;

 const scope=policyScope;
 const flight=api.get('/api/notifications/policy',{
  cacheTtlMs:force?0:300000,
  background:true,
  retries:0,
  timeoutMs:12000,
  headers:{'X-CC-Dashboard-User':'global'}
 }).then(data=>
  scope===accountPrincipal()
   ?applyPolicy(data.notice_policy)
   :readWorkNoticePolicy()
 ).finally(()=>{
  if(policyFlight===flight)policyFlight=null;
 });

 policyFlight=flight;
 return flight;
}

export async function saveWorkNoticePolicy(patch){
 const scope=accountPrincipal();
 const data=await api.post('/api/notifications/policy',patch,{
  retries:0,
  headers:{'X-CC-Dashboard-User':'global'}
 });
 return scope===accountPrincipal()
  ?applyPolicy(data.notice_policy)
  :readWorkNoticePolicy();
}

if(typeof window!=='undefined'){
 window.addEventListener('career-crox-notice-policy',event=>{
  applyPolicy(event.detail||{});
 });
}

export function isManagedWorkNotice(item){
 const category=String(item?.category||'').toLowerCase();
 return Boolean(item?.notification_id)
  &&!['chat','unlock','dialer','archived'].includes(category)
  &&!/^unlock\b/i.test(item.title||'');
}

export function noticeMetadata(row){
 try{
  return typeof row?.metadata==='string'
   ?JSON.parse(row.metadata||'{}')
   :row?.metadata||{};
 }catch{
  return {};
 }
}

export function recentWorkNotices(rows,now=Date.now()){
 const ids=new Set();
 return [...(rows||[])].filter(row=>
  row?.notification_id
  &&Number.isFinite(Date.parse(row.created_at))
  &&Date.parse(row.created_at)>=now-7*86400000
  &&!['archived','deleted'].includes(
   String(row.status||'').toLowerCase()
  )
 ).sort((a,b)=>
  Date.parse(b.created_at)-Date.parse(a.created_at)
  ||String(b.notification_id).localeCompare(String(a.notification_id))
 ).filter(row=>{
  const id=String(row.notification_id);
  if(ids.has(id))return false;
  ids.add(id);
  return true;
 });
}

export const latestWorkNotices=recentWorkNotices;

export const NOTICE_CATEGORIES=[
 ['all','All'],
 ['notes','Notes'],
 ['profile','Profile edits'],
 ['transfer','Transfers'],
 ['status','Status'],
 ['submission','Submissions'],
 ['approval','Approvals'],
 ['interview','Interviews'],
 ['attendance','Attendance'],
 ['task','Tasks'],
 ['report','Reports'],
 ['chat','Team Chat'],
 ['other','Other']
];

export function noticeCategory(row){
 const meta=noticeMetadata(row);
 const category=String(row?.category||'').toLowerCase();
 const title=String(row?.title||'').toLowerCase();

 if(
  meta.approval_kind
  ||meta.manager_review
  ||['approval','profile_access','unlock'].includes(category)
  ||/\b(approved|approval rejected|crm unlocked|unlock request|self-unlock)\b/.test(title)
 )return 'approval';

 const fields=(Array.isArray(meta.changes)?meta.changes:[])
  .map(change=>String(change.field||''));

 if(meta.note_id||meta.note_body||/\bnotes?\b/.test(title))return 'notes';

 if(
  /transfer|reassign|allocat/.test(title+' '+category)
  ||fields.some(field=>
   ['project_id','recruiter_user_id','recruiter_code'].includes(field)
  )
 )return 'transfer';

 if(category==='submission'||meta.submission_id||meta.section==='submissions'){
  return 'submission';
 }

 if(category==='approval')return 'approval';
 if(category==='chat')return 'chat';

 if(
  category==='performance'
  ||meta.report_id
  ||/report|digest/.test(category+' '+title)
 )return 'report';

 if(category==='attendance')return 'attendance';
 if(category==='task'||meta.task_id)return 'task';
 if(/interview/.test(category))return 'interview';

 if(
  fields.some(field=>/status|approval|details_sent/.test(field))
  ||/\bstatus\b/.test(title)
 )return 'status';

 if(/candidate|profile|followup/.test(category)||meta.candidate_id){
  return 'profile';
 }

 return 'other';
}

export function mergeInboxRows(current,incoming,userId){
 const map=new Map(
  (current||[]).map(row=>[String(row.notification_id),row])
 );

 for(const row of incoming||[]){
  if(row?.notification_id&&String(row.user_id)===String(userId)){
   map.set(String(row.notification_id),row);
  }
 }

 return recentWorkNotices(
  [...map.values()].filter(row=>String(row.user_id)===String(userId))
 ).filter(row=>
  String(row.status||'unread').toLowerCase()!=='read'
 ).slice(0,60);
}

const POPUP_THEMES={
 calls:['Calls','📞','#9b4b08','#fff5e5','#edc58f'],
 activity:['Activity','⚡','#a33140','#fff0f1','#edb8c1'],
 notes:['Notes','📝','#087369','#eaf9f4','#a1d9ca'],
 profile:['Profile','👤','#075b91','#edf7ff','#afd3eb'],
 transfer:['Transfer','🔀','#a03c13','#fff2ea','#ecc0a6'],
 status:['Status','🔄','#65509c','#f4efff','#ccc0e8'],
 submission:['Submission','📤','#2365aa','#edf3ff','#b5cbea'],
 approval:['Approval','✅','#24703e','#eff9ed','#b1d7ae'],
 interview:['Interview','🎤','#813b9d','#faf0ff','#d9b6e5'],
 attendance:['Attendance','⏱️','#896012','#fff9df','#ddce8d'],
 task:['Task','📌','#4943b5','#f1f0ff','#c4bff0'],
 report:['Report','📊','#146679','#ebf8fc','#aed6df'],
 chat:['Team chat','💬','#a52c71','#fff0f8','#eab8d3'],
 goal:['Goals','🎯','#667015','#f5f8e6','#d0d8a3'],
 learning:['Learning','📚','#456d21','#f1f8e9','#c0d7a4'],
 aaria:['Aaria','✨','#963d6f','#fff1f7','#e7bbd1'],
 system:['System','⚙️','#435d72','#edf4fa','#bdcddd'],
 warning:['Warning','⚠️','#ad3030','#fff0ed','#edbab0'],
 other:['Update','🔔','#5a607b','#f2f3fa','#cacedf']
};

function popupTheme(item){
 const meta=noticeMetadata(item);
 const raw=String(item?.category||'').toLowerCase();
 const title=String(item?.title||'');
 let kind=noticeCategory(item);

 if(/call ratio|no[- ]?call|low.call|call.*warning/i.test(
  title+' '+String(meta.reason||'')
 ))kind='calls';
 else if(/low activity|idle.*warning|low_activity/i.test(
  title+' '+String(meta.reason||'')
 ))kind='activity';
 else if(raw==='goal-post')kind='goal';
 else if(['learning','aaria','system','warning'].includes(raw))kind=raw;
 else if(kind==='other'&&raw&&!['general','other'].includes(raw)){
  let hash=0;
  for(const ch of raw)hash=(hash*31+ch.charCodeAt(0))>>>0;
  const hue=hash%360;
  const label=raw.replace(/[_-]+/g,' ')
   .replace(/^./,c=>c.toUpperCase()).slice(0,24);

  return {
   kind:raw,
   label,
   icon:'🔔',
   accent:`hsl(${hue} 62% 32%)`,
   soft:`hsl(${hue} 76% 96%)`,
   line:`hsl(${hue} 46% 80%)`
  };
 }

 const [label,icon,accent,soft,line]=POPUP_THEMES[kind]||POPUP_THEMES.other;
 return {kind,label,icon,accent,soft,line};
}

function highlightNotice(target,value,metadata){
 const text=String(value||'Work update');
 const ranges=[];
 const lower=text.toLocaleLowerCase();
 const terms=[
  metadata.candidate_name,
  ...(Array.isArray(metadata.changes)
   ?metadata.changes.slice(0,12).map(change=>change.to)
   :[])
 ];

 for(const value of terms){
  if(!['string','number'].includes(typeof value))continue;

  const term=String(value).trim();
  if(!term||term.length>120)continue;

  const needle=term.toLocaleLowerCase();
  let from=0,index;

  while((index=lower.indexOf(needle,from))!==-1&&ranges.length<80){
   ranges.push([index,index+term.length]);
   from=index+term.length;
  }
 }

 const keyValues=/\b(?:\d+\s*\/\s*\d+|\d+(?:\.\d+)?(?:\s*(?:minutes?|mins?|hours?|hrs?|days?|calls?))?|approved|rejected|pending|completed|rescheduled|selected|joined|cancelled|on hold|in progress)\b/gi;

 for(const match of text.matchAll(keyValues)){
  if(ranges.length>=120)break;
  ranges.push([match.index,match.index+match[0].length]);
 }

 ranges.sort((a,b)=>a[0]-b[0]||b[1]-a[1]);
 const merged=[];

 for(const range of ranges){
  const last=merged[merged.length-1];
  if(last&&range[0]<last[1]){
   last[1]=Math.max(last[1],range[1]);
  }else{
   merged.push([...range]);
  }
 }

 let offset=0;
 for(const [start,end]of merged){
  target.append(document.createTextNode(text.slice(offset,start)));
  const mark=document.createElement('mark');
  mark.textContent=text.slice(start,end);
  target.append(mark);
  offset=end;
 }
 target.append(document.createTextNode(text.slice(offset)));
}

const COMPACT_FONT='Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif';

export function noticeSubject(item){
 const m=noticeMetadata(item);
 const name=String(
  m.candidate_name||m.profile_name||m.candidate?.full_name||''
 ).trim();

 if(name)return name;

 const found=String(item?.message||'').match(
  /^(.{1,120}?)\s+(?:has been|was approved|was rejected|is now|has submitted)\b/i
 );

 return found?.[1]?.trim()||String(
  m.task_title
  ||m.employee_name
  ||m.full_name
  ||m.candidate_id
  ||item?.title
  ||'Work update'
 );
}

// CC151: precise category headings and light gradients; no extra API calls.
const NOTICE_TONES={
 notes:{label:'Notes',start:'#e9f9f4',end:'#f9fffc',accent:'#097b65',accent2:'#35a68f',ink:'#155847'},
 submission:{label:'Submission',start:'#e9f2ff',end:'#f8faff',accent:'#235cbe',accent2:'#568be3',ink:'#194276'},
 interview:{label:'Interview',start:'#f4ecff',end:'#fcf9ff',accent:'#7d43ae',accent2:'#b276da',ink:'#57317b'},
 approval:{label:'Approval',start:'#e8f8ef',end:'#f8fffa',accent:'#18744c',accent2:'#46a878',ink:'#18583d'},
 transfer:{label:'Transfer',start:'#fff1e7',end:'#fffaf5',accent:'#ac5d29',accent2:'#dc965e',ink:'#81451e'},
 status:{label:'Status Update',start:'#f2edff',end:'#fcfbff',accent:'#6754b5',accent2:'#9c87dc',ink:'#4b388b'},
 profile:{label:'Profile Update',start:'#eaf6ff',end:'#f7fbff',accent:'#2472a5',accent2:'#59a6d1',ink:'#19557e'},
 task:{label:'Task',start:'#efefff',end:'#fafaff',accent:'#5152b6',accent2:'#8786dd',ink:'#393b82'},
 attendance:{label:'Attendance',start:'#fff7df',end:'#fffdf4',accent:'#906d21',accent2:'#c4a044',ink:'#694e0c'},
 chat:{label:'Team Chat',start:'#fff0f7',end:'#fffbfd',accent:'#a23d78',accent2:'#d47aaa',ink:'#742752'},
 report:{label:'Report',start:'#eaf9fc',end:'#faffff',accent:'#267686',accent2:'#6ab6c5',ink:'#195b68'},
 calls:{label:'Calls',start:'#fff2e7',end:'#fffaf4',accent:'#b26a27',accent2:'#d9a45b',ink:'#804912'},
 warning:{label:'Warning',start:'#fff0ee',end:'#fff9f8',accent:'#b94343',accent2:'#df8b77',ink:'#873333'},
 other:{label:'Notification',start:'#f2f4fd',end:'#fdfdff',accent:'#59669f',accent2:'#8d9bd0',ink:'#38446c'}
};

export function noticeHeadline(item){
 const meta=noticeMetadata(item);
 const category=String(item?.category||'').trim().toLowerCase();
 const title=String(item?.title||'').trim().toLowerCase();
 const full=category+' '+title;
 let kind=noticeCategory(item);
 let label='';
 // Explicit subject of the event wins over a generic candidate_update type.
 if(/\b(approval rejected|rejected approval|profile rejected)\b/.test(full)){
  kind='approval';label='Approval Rejected';
 }else if(/\b(profile|candidate|submission|allocation|request)\b.*\bapproved\b|\bapproved\b.*\b(profile|candidate|submission|allocation|request)\b/.test(full)){
  kind='approval';label=/allocat/.test(full)?'Allocation Approved':'Profile Approved';
 }else if(/\b(approval|allocation|access)\b.*\b(pending|requested|request)\b|\bpending approval\b/.test(full)){
  kind='approval';label=/allocat/.test(full)?'Allocation Request':'Approval Pending';
 }else if(/\b(interview|reschedul)\b/.test(full)||meta.interview_id||meta.interview_date){
  kind='interview';label=/reschedul/.test(full)?'Interview Rescheduled':/schedul|booked/.test(full)?'Interview Scheduled':'Interview Update';
 }else if(/\b(submi(?:ssion|tted|t))\b/.test(full)||meta.submission_id||meta.section==='submissions'){
  kind='submission';label=/\bsubmitted\b|\bnew submission\b/.test(full)?'New Submission':'Submission Update';
 }else if(/\bnote(?:s)?\b/.test(full)||meta.note_id||meta.note_body){
  kind='notes';label=/\badded\b|\bnew note\b/.test(full)?'Note Added':'Note Updated';
 }else if(/follow.?up|reminder/.test(full)){
  kind='task';label='Follow-up Reminder';
 }else if(/transfer|reassign|allocat/.test(full)){
  kind='transfer';label='Profile Transfer';
 }else if(/\b(approved|rejected)\b/.test(full)){
  kind='approval';label=/rejected/.test(full)?'Approval Rejected':'Profile Approved';
 }else if(kind==='status')label='Status Updated';
 const tone=NOTICE_TONES[kind]||NOTICE_TONES.other;
 return {...tone,kind,label:label||tone.label};
}

function candidateNameFromVisibleRows(candidateId){
 const wanted=String(candidateId||'').trim();
 if(!wanted||typeof document==='undefined')return '';
 // Only use already visible, authorized candidate-list rows. No Supabase request.
 for(const cell of document.querySelectorAll('td.candidate-id-cell')){
  if(String(cell.textContent||'').trim()!==wanted)continue;
  const name=cell.closest('tr')?.querySelector('td.candidate-name-cell strong');
  const value=String(name?.textContent||'').trim();
  if(value&&value!=='-')return value;
 }
 return '';
}

export function noticeCandidateIdentity(item){
 const meta=noticeMetadata(item);
 const id=String(meta.candidate_id||'').trim();
 const name=String(meta.candidate_name||meta.profile_name||meta.full_name||meta.candidate?.full_name||'').trim()
  ||candidateNameFromVisibleRows(id);
 return {name,id};
}

let compactUsers=0,compactCleanup;

function installCompactReminders(){
 if(compactUsers++===0){
  const sheet=document.createElement('style');
  sheet.id='cc150-compact-reminders';

  const p='html'
   +':is(#cc787-workspace,#cc780-workspace)'.repeat(44)
   +' body ';

  const base='.cc730-direct-reminder-deck'
   +':not([hidden])'
   +':not([data-cc927-positioned="true"])'
   +':not([data-cc927-collapsed="true"])'
   +':not([data-cc927-suspended="true"])';

  sheet.textContent=`
@font-face{
 font-family:Inter;
 font-style:normal;
 font-weight:400 800;
 font-display:swap;
 src:local("Inter"),url("https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2") format("woff2");
}

@layer cc829 {
 ${p}${base}{
  display:contents!important;
  pointer-events:none!important;
 }

 ${p}${base}>.cc388-card{
  position:fixed!important;
  left:8px!important;
  bottom:48px!important;
  right:auto!important;
  top:auto!important;
  z-index:100940!important;
  width:min(208px,calc(100vw - 16px))!important;
  max-width:calc(100vw - 16px)!important;
  display:grid!important;
  grid-template-columns:minmax(0,1fr)!important;
  background:#fff!important;
  color:#14243b!important;
  border:1px solid #c8d5e8!important;
  border-top:3px solid #6d48df!important;
  border-radius:14px!important;
  box-shadow:0 9px 24px #14243b26!important;
  pointer-events:auto!important;
  font-family:${COMPACT_FONT}!important;
  isolation:isolate!important;
  animation:cc150-reminder-in .2s cubic-bezier(.22,1,.36,1) both!important;
 }

 ${p}${base}>.cc388-card.interview{border-top-color:#e75b22!important}
 ${p}${base}>.cc388-card.task{border-top-color:#077f69!important}
 ${p}${base}>.cc388-card.followups{border-top-color:#7c3fd6!important}
 ${p}${base}>.cc388-card:is(.submission,.submissions){border-top-color:#1c63d5!important}

 ${p}${base} .cc388-title{
  grid-row:1!important;
  font-family:${COMPACT_FONT}!important;
 }

 ${p}${base} .cc150-name{
  display:block!important;
  font:750 15px/1.25 ${COMPACT_FONT}!important;
  white-space:normal!important;
  overflow-wrap:anywhere!important;
  color:#14243b!important;
 }

 ${p}${base} :is(.cc900-owner,.cc900-dash){display:none!important}

 ${p}${base} .cc388-head{
  grid-row:2!important;
  background:transparent!important;
  padding:0!important;
  border:0!important;
  border-radius:0!important;
  justify-content:flex-end!important;
 }

 ${p}${base} .cc388-label{
   display:inline-flex!important;
   align-items:center!important;
   min-width:0!important;
   width:auto!important;
   max-width:calc(100% - 50px)!important;
   padding:3px 5px!important;
   border-radius:7px!important;
   border:0!important;
   background:linear-gradient(115deg,#efedff,#e7f0ff)!important;
   color:#51408d!important;
   -webkit-text-fill-color:#51408d!important;
   font:750 9px/1.2 ${COMPACT_FONT}!important;
   letter-spacing:0!important;
   text-transform:none!important;
   white-space:normal!important;
   overflow-wrap:anywhere!important;
 }
  ${p}${base} .cc388-card.interview .cc388-head{background:linear-gradient(115deg,#f5eaff,#fff8fd)!important}
  ${p}${base} .cc388-card:is(.submission,.submissions) .cc388-head{background:linear-gradient(115deg,#e9f1ff,#f8fbff)!important}
  ${p}${base} .cc388-card.task .cc388-head{background:linear-gradient(115deg,#e6f8f0,#f9fefa)!important}
  ${p}${base} .cc388-card.followups .cc388-head{background:linear-gradient(115deg,#f0e9ff,#f9f6ff)!important}

 ${p}${base} .cc388-head-actions>button{
  background:#edf2ff!important;
  color:#233e62!important;
  -webkit-text-fill-color:#233e62!important;
  border-color:#c7d5ea!important;
 }

 ${p}${base} .cc388-count{
  background:#edf2ff!important;
  color:#425775!important;
  -webkit-text-fill-color:#425775!important;
 }

 ${p}${base} .cc388-head-actions{
  display:flex!important;
  gap:3px!important;
  align-items:center!important;
 }

 ${p}${base} .cc388-note{
  grid-row:3!important;
  background:#f4f7fc!important;
 }

 ${p}${base} .cc388-time{
  grid-row:4!important;
  background:#edf3ff!important;
 }

 ${p}${base} .cc150-extra{
  grid-row:5!important;
  font:11px/1.4 ${COMPACT_FONT}!important;
  color:#425775!important;
 }

 ${p}${base} .cc150-extra>summary{
  cursor:pointer!important;
  padding:2px 0!important;
  font-weight:650!important;
 }

 ${p}${base} .cc388-presets{
  grid-row:6!important;
  grid-template-columns:repeat(4,minmax(0,1fr))!important;
 }

 ${p}${base} .cc388-presets button{
  color:#234266!important;
  background:#f5f8ff!important;
  border:1px solid #c8d5e8!important;
 }

 ${p}${base} :is(
  .cc388-count,
  .cc388-note,
  .cc388-time,
  .cc388-presets,
  .cc150-extra
 ) *{
  font-family:${COMPACT_FONT}!important;
 }

 ${p}${base} .cc388-head button:focus-visible,
 ${p}${base} summary:focus-visible{
  outline:2px solid #346ae5!important;
  outline-offset:2px!important;
 }
}

@keyframes cc150-reminder-in{
 from{opacity:0;transform:translateY(8px) scale(.98)}
 to{opacity:1;transform:none}
}

@media(prefers-reduced-motion:reduce){
 ${p}${base}>.cc388-card{
  animation:none!important;
  transition:none!important;
 }
}
`;

  document.head.append(sheet);
  let frame=0;

  const decorate=()=>{
   frame=0;

   for(const card of document.querySelectorAll(
    '.cc730-direct-reminder-deck>.cc388-card'
   )){
    const name=card.querySelector('.cc900-name');

    if(name&&!name.querySelector('.cc150-name')){
     const span=document.createElement('span');
     span.className='cc150-name';
     span.textContent=name.textContent;
     name.replaceChildren(span);
    }

    const box=card.querySelector('.cc898-reminder-context');

    if(box&&!box.closest('.cc150-extra')){
     const details=document.createElement('details');
     const summary=document.createElement('summary');

     details.className='cc150-extra';
     summary.textContent='Details';

     summary.addEventListener('click',event=>event.stopPropagation());
     summary.addEventListener('keydown',event=>event.stopPropagation());

     box.before(details);
     details.append(summary,box);
    }
   }
  };

  const inside=node=>
   node.nodeType===1&&node.closest('.cc730-direct-reminder-deck');

  const inserted=node=>
   node.nodeType===1&&(
    node.matches('.cc730-direct-reminder-deck')
    ||node.querySelector('.cc730-direct-reminder-deck')
   );

  const observer=new MutationObserver(records=>{
   if(
    !frame
    &&records.some(record=>
     inside(record.target)
     ||[...record.addedNodes].some(inserted)
    )
   ){
    frame=requestAnimationFrame(decorate);
   }
  });

  observer.observe(document.body,{childList:true,subtree:true});
  decorate();

  compactCleanup=()=>{
   observer.disconnect();
   cancelAnimationFrame(frame);

   for(const span of document.querySelectorAll('.cc150-name')){
    span.replaceWith(document.createTextNode(span.textContent));
   }

   for(const details of document.querySelectorAll('.cc150-extra')){
    const box=details.querySelector('.cc898-reminder-context');
    if(box)details.before(box);
    details.remove();
   }

   sheet.remove();
  };
 }

 return()=>{
  if(--compactUsers===0){
   compactCleanup?.();
   compactCleanup=null;
  }
 };
}

const POPUP_STYLE=`
:host([hidden]){display:none!important}
*{box-sizing:border-box}

article{
 font:var(--notice-size,13px)/1.4 var(--notice-font,Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);
 color:var(--notice-ink,#14243b);
 background:linear-gradient(180deg,#ffffff 0%,#fcfdff 100%);
 border:1px solid #d0d9e8;
 border-left:3px solid var(--notice-accent,#346ae5);
 border-radius:16px;
 box-shadow:0 8px 24px #14243b24;
 overflow:hidden;
 animation:notice-enter .22s cubic-bezier(.22,1,.36,1) both;
}

header{
 display:flex;
 align-items:center;
 gap:7px;
 padding:8px 9px;
 background:linear-gradient(115deg,var(--cc151-head-start,#edf3ff),var(--cc151-head-end,#fbfcff));
 border-bottom:1px solid var(--cc151-head-border,#e0e7f4);
 color:var(--cc151-heading-color,#223c62);
}

button{
 font:inherit;
 border:0;
 background:none;
 cursor:pointer;
 color:inherit;
}

button:focus-visible,.changes:focus-visible{
 outline:2px solid #346ae5;
 outline-offset:2px;
}

.category-icon-static{
 display:grid;
 place-items:center;
 width:23px;
 height:23px;
 border-radius:7px;
 background:linear-gradient(135deg,var(--cc151-accent,#346ae5),var(--cc151-accent-2,#7668d4));
 color:#fff;
 flex:none;
 font-size:14px;
}

.heading{
 flex:1;
 min-width:0;
 text-align:left;
 font-size:calc(var(--notice-size,14px) + 1px);
 line-height:1.25;
 font-weight:750;
 overflow-wrap:anywhere;
 color:var(--cc151-heading-color,#223c62);
 padding:0;
}

.close{
 width:22px;
 height:22px;
 border-radius:50%;
 background:#eaf0f8;
 color:#415572;
 font-size:17px;
 padding:0;
 align-self:flex-start;
}

 .subject{
 display:flex;
 align-items:baseline;
 flex-wrap:wrap;
 gap:3px 7px;
 min-height:0;
 padding:6px 10px 0;
 color:#1c3151;
 line-height:1.3;
 }
 .subject:empty{display:none;padding:0}
 .subject-name{font-size:12.5px;font-weight:800;overflow-wrap:anywhere}
 .subject-id{font-size:10px;font-weight:700;color:#687993;background:#f1f5fd;border:1px solid #e2eaf7;border-radius:6px;padding:1px 5px;white-space:nowrap}
 .category-subtitle{display:block;font-size:10px;line-height:1.25;font-weight:600;color:#60718e;margin-top:2px}

.body{
 padding:5px 10px 5px;
 max-height:min(120px,35vh);
 overflow:auto;
 overscroll-behavior:contain;
 overflow-wrap:anywhere;
}

.changes{
 padding:0;
 white-space:pre-wrap;
 font-size:calc(var(--notice-size,14px) - 2px);
 line-height:1.45;
 font-weight:500;
 cursor:pointer;
 color:var(--notice-ink,#14243b);
}

.changes mark{
 background:transparent;
 color:inherit;
 font-weight:700;
 padding:0;
}

.note-kicker{display:none}

.notice-footer{
 display:flex;
 align-items:center;
 justify-content:space-between;
 gap:6px;
 padding:3px 9px 7px;
 font-size:10px;
}

.kind{
 font-weight:700;
 color:var(--cc151-accent,#346ae5);
}

.footer-actions{
 display:flex;
 align-items:center;
 gap:8px;
}

.more{
 color:var(--notice-ink,#14243b);
 padding:3px;
}

.next{
 border-radius:7px;
 padding:4px 7px;
 color:#fff;
 font-weight:700;
 background:linear-gradient(110deg,var(--cc151-accent,#346ae5),var(--cc151-accent-2,#7668d4));
}

.context{
 font-size:11px;
 padding:7px 0 2px;
 white-space:pre-wrap;
 border-top:1px solid #dce4ef;
 margin-top:6px;
}

:host([data-layout=rail]) article{border-left-width:5px}
:host([data-layout=outline]) article{border-color:var(--notice-accent)}
:host([data-layout=split]) article{border-bottom:3px solid var(--notice-end)}
:host([data-layout=compact]) article{border-radius:10px}
:host([data-layout=rounded]) article{border-radius:22px}

.leaving{animation:notice-bye .12s ease-in forwards}

@keyframes notice-enter{
 from{opacity:0;transform:translateX(16px) scale(.98)}
 to{opacity:1;transform:none}
}

@keyframes notice-bye{
 to{opacity:0;transform:translateX(8px)}
}

@media(prefers-reduced-motion:reduce){
 article,.leaving{animation:none!important}
}
`;

export function installNotificationInboxRuntime(
 user,
 {navigate=path=>window.location.assign(path)}={}
){
 if(!user?.user_id||typeof document==='undefined')return()=>{};

 const removeCompactLook=installCompactReminders();
 const principal=accountPrincipal();
 const uid=String(user.user_id);
 const mountedAt=Date.now();

 const seenKey='cc120-notice-seen:'+principal;
 const metaKey='cc120-notice-sync:'+principal;

 const parse=(storage,key,fallback)=>{
  try{
   return JSON.parse(storage.getItem(key)||'null')||fallback;
  }catch{
   return fallback;
  }
 };

 let shown=parse(localStorage,seenKey,{});
 let saved=parse(sessionStorage,metaKey,{});
 let preferences=readPopupStudio();

 let disposed=false;
 let inflight=null;
 let lastSync=Number(saved.at)||0;
 let signature=saved.signature||'';
 let current=null;
 let queue=[];
 let hover=false;
 let closing=false;

 let hideTimer,removeTimer,recoveryTimer,queueTimer,placeFrame;

 const QUICK_RECEIPT_MS=3000;

 const quickReceipt=item=>{
  const category=String(item?.category||'').trim().toLowerCase();
  const title=String(item?.title||'').trim().toLowerCase();

  if(
   noticeCategory(item)==='approval'
   ||/approval|unlock|action required|reminder/i.test(title)
  )return false;

  return (
   category==='attendance'
   &&/^(?:office (?:joined|left|exited)|break (?:started|ended)|clocked (?:in|out))\b/.test(title)
  )||(
   category==='task'
   &&/^task (?:updated|completed|closed|finished)\b/.test(title)
  );
 };

 const isImportant=item=>{
  const category=String(item?.category||'').toLowerCase();
  const title=String(item?.title||'').toLowerCase();
  const meta=noticeMetadata(item);

  if(noticeCategory(item)==='task')return !quickReceipt(item);

  return Boolean(
   meta.requires_action||meta.action_required||meta.manager_review
  )||[
   'approval','submission','interview','notes','transfer'
  ].includes(noticeCategory(item))
   ||/candidate_update|profile_access|unlock|follow.?up/.test(category)
   ||/approval|unlock|allocation|submission|interview|follow.?up|reminder|profile access|reschedul|reassign|transfer/.test(title);
 };

 const stable=item=>
  isImportant(item)||/attendance/.test(String(item?.category||''));

 const host=document.createElement('div');
 host.className='cc120-work-notice-host';
 host.hidden=true;
 host.style.cssText=
  'position:fixed;z-index:100960;'
  +'width:min(320px,calc(100vw - 20px));pointer-events:auto;';

 const shadow=host.attachShadow({mode:'open'});
 const style=document.createElement('style');
 style.textContent=POPUP_STYLE;
 shadow.append(style);
 (document.body||document.documentElement).append(host);

 const live=()=>!disposed&&accountPrincipal()===principal;

 function persist(){
  const cutoff=Date.now()-7*86400000;
  shown=Object.fromEntries(
   Object.entries(shown)
    .filter(([,at])=>Number(at)>=cutoff)
    .slice(-1000)
  );

  try{
   localStorage.setItem(seenKey,JSON.stringify(shown));
  }catch{}
 }

 function noticeProfile(){
  const profiles=preferences;
  const custom=profiles['notification:'+noticeCategory(current)];
  return current&&custom?.enabled?custom:profiles.notification;
 }

 function appearance(){
  const raw=noticeProfile();
  const p=popupVisual(raw);
  host.dataset.layout=p.layout;

  const values={
   '--notice-bg':raw.styleEnabled?p.bg:'#ffffff',
   '--notice-ink':raw.styleEnabled?p.ink:'#14243b',
   '--notice-accent':p.accent,
   '--notice-end':p.accent2,
   '--notice-size':p.fontSize+'px',
   '--notice-font':p.font==='system'?COMPACT_FONT:POPUP_FONTS[p.font],
   '--notice-radius':p.radius+'px'
  };

  for(const [key,value]of Object.entries(values)){
   host.style.setProperty(key,value);
  }

  host.style.width=raw.placementEnabled
   ?popupBounds(raw).width+'px'
   :'min(320px,calc(100vw - 20px))';

  const article=shadow.querySelector('article');

  if(article&&current){
   const theme=popupTheme(current);
   article.style.setProperty(
    '--notice-accent',
    raw.styleEnabled?p.accent:theme.accent
   );
   article.style.setProperty(
    '--notice-end',
    raw.styleEnabled?p.accent2:theme.accent
   );
  }
 }

 function appearanceChanged(){
  preferences=readPopupStudio();
  appearance();
  place();
 }

 window.addEventListener(
  'cc927-popup-settings-changed',
  appearanceChanged
 );
 window.addEventListener('storage',appearanceChanged);
 appearance();

 function place(){
  const custom=noticeProfile();

  if(custom.placementEnabled){
   const bounds=popupBounds(custom);
   host.style.left=bounds.left+'px';
   host.style.top=Math.min(
    bounds.top,
    Math.max(8,innerHeight-host.offsetHeight-8)
   )+'px';
   return;
  }

  const meta=noticeMetadata(current);
  const approval=Boolean(
   meta.manager_review
   ||meta.requires_action
   ||meta.action_required
   ||/request|pending|needs approval/i.test(current?.title||'')
  )&&/approval|allocation.lock|profile.access|unlock/i.test(
   [current?.category,current?.title].join(' ')
  );

  const anchor=document.querySelector(
   approval?'[data-pill=approvals]':'.topbar'
  );

  const rect=anchor?.getBoundingClientRect();
  const box=host.getBoundingClientRect();
  const width=box.width||282;
  const height=box.height||115;

  host.classList.toggle('cc129-approval-notice',approval);

  host.style.left=Math.round(Math.max(
   8,
   Math.min(
    innerWidth-width-14,
    approval&&rect
     ?rect.left+rect.width/2-width/2
     :innerWidth-width-14
   )
  ))+'px';

  host.style.top=Math.round(Math.max(
   8,
   Math.min(
    innerHeight-height-8,
    rect?rect.bottom+7:64
   )
  ))+'px';
 }

 function next(){
  clearTimeout(queueTimer);

  if(
   !live()
   ||current
   ||closing
   ||!queue.length
   ||document.hidden
   ||!getPollingLeaderSnapshot()?.isLeader
  )return;

  queue.sort((a,b)=>
   Number(isImportant(b))-Number(isImportant(a))
   ||Date.parse(a.created_at||0)-Date.parse(b.created_at||0)
  );

  while(queue.length){
   const item=queue.shift();
   if(!shown[item.notification_id]){
    show(item);
    break;
   }
  }
 }

 function rememberNoticeUndo(item){
  window.__CC126_POPUP_UNDO__?.push({
   title:item.title,
   restore:()=>{
    if(!live())return false;

    clearTimeout(hideTimer);
    clearTimeout(removeTimer);
    clearTimeout(queueTimer);

    if(
     current
     &&String(current.notification_id)!==String(item.notification_id)
     &&!queue.some(row=>
      String(row.notification_id)===String(current.notification_id)
     )
    ){
     queue.unshift(current);
    }

    current=null;
    closing=false;
    show(item);

    return current?.notification_id===item.notification_id;
   }
  });
 }

 function finish(reason='auto'){
  clearTimeout(hideTimer);
  if(!current||closing)return;

  closing=true;
  clearTimeout(removeTimer);

  const article=shadow.querySelector('article');
  const item=current;
  let delay=160;

  if(reason==='dismiss'){
   rememberNoticeUndo(item);
  }

  if(delay===160)article?.classList.add('leaving');

  removeTimer=setTimeout(()=>{
   host.hidden=true;
   current=null;
   hover=false;
   closing=false;
   queueTimer=setTimeout(next,80);
  },delay);
 }

 function scheduleHide(delay){
  clearTimeout(hideTimer);
  hideTimer=setTimeout(()=>{
   if(!hover)finish();
  },Math.max(250,delay));
 }

 function suspendPopup(){
  clearTimeout(hideTimer);
  clearTimeout(removeTimer);
  clearTimeout(queueTimer);

  if(current&&!closing){
   const item=current;

   if(isImportant(item)){
    delete shown[item.notification_id];

    if(!queue.some(row=>
     String(row.notification_id)===String(item.notification_id)
    )){
     queue.unshift(item);
    }

    persist();
   }
  }

  current=null;
  closing=false;
  hover=false;
  host.hidden=true;
 }

 function show(item){
  window.__CC124_REMEMBER_POPUP__?.({
   key:'notice:'+item.notification_id,
   kind:'Notification',
   title:item.title,
   note:item.message,
   candidate_id:noticeMetadata(item).candidate_id,
   time:item.created_at,
   path:notificationTarget(item)
  });

  if(!live())return;

  clearTimeout(hideTimer);
  clearTimeout(removeTimer);
  closing=false;
  current=item;
  hover=false;
  shown[item.notification_id]=Date.now();
  persist();

  const article=document.createElement('article');
  article.setAttribute('role','status');
  article.setAttribute('aria-label','Work notification');

  const theme=popupTheme(item);
  const banner=noticeHeadline(item);
  article.dataset.category=banner.kind;
  article.style.setProperty('--cc151-head-start',banner.start);
  article.style.setProperty('--cc151-head-end',banner.end);
  article.style.setProperty('--cc151-head-border',banner.start);
  article.style.setProperty('--cc151-accent',banner.accent);
  article.style.setProperty('--cc151-accent-2',banner.accent2);
  article.style.setProperty('--cc151-heading-color',banner.ink);

  for(const [key,value]of Object.entries({
   accent:theme.accent,
   soft:theme.soft,
   line:theme.line
  })){
   article.style.setProperty('--notice-'+key,value);
  }

  const header=document.createElement('header');
  const dot=document.createElement('span');
  const heading=document.createElement('button');
  const close=document.createElement('button');
  const body=document.createElement('div');

  dot.className='category-icon-static';
  dot.setAttribute('aria-hidden','true');

  const glyph=banner.kind==='notes'
   ?'M5 3h8l3 3v11H5z M8 8h5 M8 11h5 M8 14h3'
   :banner.kind==='approval'
    ?'M4 10l4 4 8-8'
    :'M6 8a4 4 0 0 1 8 0v4l2 2H4l2-2z M8 17h4';

  const svg=document.createElementNS(
   'http://www.w3.org/2000/svg',
   'svg'
  );

  const path=document.createElementNS(
   'http://www.w3.org/2000/svg',
   'path'
  );

  for(const [key,value]of Object.entries({
   viewBox:'0 0 20 20',
   width:'15',
   height:'15',
   fill:'none',
   stroke:'currentColor',
   'stroke-width':'1.7',
   'stroke-linecap':'round',
   'stroke-linejoin':'round'
  })){
   svg.setAttribute(key,value);
  }

  path.setAttribute('d',glyph);
  svg.append(path);
  dot.append(svg);

  heading.type='button';
  heading.className='heading';
  heading.textContent=banner.label;
  heading.title=item.title||banner.label;

  close.type='button';
  close.className='close';
  close.textContent='×';
  close.setAttribute('aria-label','Dismiss notification');

  body.className='body';

  const open=()=>{
   window.open(
    /allocation.lock.*request|profile.allocation.*request/i.test(item.title||'')
     ?'/approvals'
     :notificationTarget(item),
    '_blank',
    'noopener,noreferrer'
   );

   finish('open');
   rememberNoticeUndo(item);

   void api.post(
    '/api/notifications/'+encodeURIComponent(item.notification_id)+'/read',
    {},
    {
     retries:0,
     detachedWrite:true,
     background:true,
     headers:{'X-CC-Dashboard-User':'global'}
    }
   ).catch(()=>{});
  };

  heading.onclick=open;
  body.onclick=open;
  close.onclick=()=>finish('dismiss');

  article.onpointerenter=()=>{
   hover=true;
   clearTimeout(hideTimer);
   place();
  };

  article.onpointerleave=()=>{
   hover=false;
   if(!stable(item)&&!quickReceipt(item))scheduleHide(1500);
  };

  article.onfocusin=()=>{
   hover=true;
   clearTimeout(hideTimer);
  };

  article.onfocusout=event=>{
   if(article.contains(event.relatedTarget))return;
   hover=false;
   if(!stable(item)&&!quickReceipt(item))scheduleHide(1500);
  };

  const metadata=noticeMetadata(item);
  const subject=document.createElement('span');
  subject.className='subject';
  const identity=noticeCandidateIdentity(item);
  if(identity.name){
   const name=document.createElement('strong');
   name.className='subject-name';
   name.textContent=identity.name;
   subject.append(name);
  }
  if(identity.id){
   const id=document.createElement('span');
   id.className='subject-id';
   id.textContent=identity.id;
   subject.append(id);
  }
  if(!identity.name&&!identity.id){
   // Non-candidate notices retain a meaningful subject without fabricating a name.
   const subjectText=String(noticeSubject(item)||'').trim();
   if(subjectText&&subjectText!==banner.label){
    const label=document.createElement('strong');label.className='subject-name';
    label.textContent=subjectText;subject.append(label);
   }
  }

  const changes=document.createElement('div');
  changes.className='changes';
  highlightNotice(changes,item.message,metadata);
  body.append(changes);

  changes.tabIndex=0;
  changes.setAttribute('role','button');
  changes.setAttribute('aria-label','Open '+(item.title||'work update'));

  changes.onkeydown=event=>{
   if(event.key==='Enter'||event.key===' '){
    event.preventDefault();
    open();
   }
  };

  if(metadata.note_id||metadata.note_body){
   const kicker=document.createElement('small');
   kicker.className='note-kicker';
   kicker.textContent='Updated note';
   changes.prepend(kicker);
  }

  const more=document.createElement('button');
  more.type='button';
  more.className='more';
  more.textContent='Details';
  more.title='More activity details';
  more.setAttribute('aria-expanded','false');
  more.setAttribute('aria-controls','cc127-notice-context');

  more.onclick=event=>{
   event.stopPropagation();
   let details=body.querySelector('.context');

   if(details){
    details.remove();
    more.setAttribute('aria-expanded','false');
    place();
    return;
   }

   details=document.createElement('div');
   details.className='context';
   details.id='cc127-notice-context';

   details.textContent=[
    item.title||'',
    metadata.actor_name?'By '+metadata.actor_name:'',
    new Date(item.created_at).toLocaleString('en-IN',{
     timeZone:'Asia/Kolkata'
    }),
    metadata.candidate_id?'Candidate '+metadata.candidate_id:''
   ].filter(Boolean).join('\n');

   body.append(details);
   more.setAttribute('aria-expanded','true');
   place();
  };

  body.onclick=event=>{
   if(!event.target.closest('button'))open();
  };

  const footer=document.createElement('div');
  footer.className='notice-footer';

  const hint=document.createElement('span');
  hint.className='kind';
  hint.textContent=theme.label;
  hint.title=quickReceipt(item)
   ?'Closes automatically after 3 seconds'
   :stable(item)
    ?'Stays until you close it'
    :'Work notification';

  const nextButton=document.createElement('button');
  nextButton.type='button';
  nextButton.className='next';
  nextButton.textContent='Next →';
  nextButton.setAttribute('aria-label','Next update');
  nextButton.onclick=()=>finish('dismiss');

  const footerActions=document.createElement('div');
  footerActions.className='footer-actions';
  footerActions.append(more,nextButton);
  footer.append(hint,footerActions);

  header.append(dot,heading,close);
  article.append(header,subject,body,footer);
  shadow.querySelector('article')?.remove();
  shadow.append(article);

  host.hidden=false;
  appearance();
  place();

  const anchor=document.getElementById('cc120-notifications-trigger');
  anchor?.classList.remove('cc120-bell-bounce');

  if(anchor){
   void anchor.offsetWidth;
   anchor.classList.add('cc120-bell-bounce');
  }

  if(quickReceipt(item)){
   article.onpointerenter=()=>{
    hover=true;
    place();
   };
   article.onpointerleave=()=>{hover=false;};
   article.onfocusin=()=>{hover=true;};
   article.onfocusout=()=>{hover=false;};
   hideTimer=setTimeout(()=>finish('auto'),QUICK_RECEIPT_MS-160);
  }else if(!stable(item)){
   const policy=readWorkNoticePolicy();
   const seconds=String(user.role).toLowerCase()==='tl'
    ?policy.tl_seconds
    :policy.manager_seconds;

   scheduleHide(seconds*1000-160);
  }else{
   article.onpointerleave=()=>{hover=false;};
   article.onfocusout=()=>{hover=false;};
  }
 }

 function offer(items,initial=false){
  if(!live())return;

  const fresh=recentWorkNotices(items).filter(item=>
   String(item.user_id)===uid
   &&isManagedWorkNotice(item)
   &&String(item.status||'unread').toLowerCase()!=='read'
   &&!shown[item.notification_id]
  );

  for(const item of fresh.reverse()){
   if(
    initial
    &&Date.parse(item.created_at)
     <mountedAt-(isImportant(item)?86400000:15000)
   ){
    continue;
   }

   if(
    !queue.some(row=>
     String(row.notification_id)===String(item.notification_id)
    )
    &&String(current?.notification_id)!==String(item.notification_id)
   ){
    queue.push(item);
   }
  }

  persist();
  next();
 }

 function planRecovery(){
  clearTimeout(recoveryTimer);

  recoveryTimer=setTimeout(()=>{
   if(live()&&!document.hidden)void sync();
   else if(live())planRecovery();
  },window.__CC940_NOTICE_STREAM_READY__?1800000:300000);
 }

 async function sync(){
  if(
   !live()
   ||inflight
   ||document.hidden
   ||!getPollingLeaderSnapshot()?.isLeader
   ||window.__CC602_NETWORK_PAUSED__
  )return inflight;

  if(lastSync&&Date.now()-lastSync<300000){
   planRecovery();
   return;
  }

  lastSync=Date.now();

  inflight=api.get(
   '/api/notifications?inbox=1'
    +(signature?'&signature='+encodeURIComponent(signature):''),
   {
    cacheTtlMs:0,
    retries:0,
    background:true,
    timeoutMs:12000,
    headers:{'X-CC-Dashboard-User':'global'}
   }
  ).then(feed=>{
   if(!live())return;
   if(feed.notice_policy)applyPolicy(feed.notice_policy);
   if(!feed.unchanged)offer(feed.items||[],true);

   signature=feed.signature||signature;

   try{
    sessionStorage.setItem(
     metaKey,
     JSON.stringify({at:lastSync,signature})
    );
   }catch{}
  }).catch(()=>{
   lastSync=0;
  }).finally(()=>{
   inflight=null;
   if(live())planRecovery();
  });

  return inflight;
 }

 const incoming=event=>offer([event.detail]);

 const read=event=>{
  const data=event.detail||{};
  if(String(data.user_id)!==uid)return;

  queue=queue.filter(row=>
   !data.all
   &&String(row.notification_id)!==String(data.notification_id)
  );

  if(
   current
   &&(
    data.all
    ||String(data.notification_id)===String(current.notification_id)
   )
  ){
   finish('read');
  }
 };

 const position=()=>{
  if(host.hidden||placeFrame)return;

  placeFrame=requestAnimationFrame(()=>{
   placeFrame=null;
   if(!host.hidden)place();
  });
 };

 const recover=()=>{
  if(!live())return;

  if(document.hidden){
   suspendPopup();
   return;
  }

  next();
  if(Date.now()-lastSync>=300000)void sync();
 };

 const unsubscribe=subscribePollingLeader(snapshot=>{
  if(snapshot.isLeader){
   next();
   void sync();
  }else{
   suspendPopup();
  }
 });

 const storage=event=>{
  if(event.key!==seenKey||!event.newValue)return;

  try{
   const shared=JSON.parse(event.newValue);

   if(shared&&typeof shared==='object'){
    shown=shared;
    queue=queue.filter(item=>!shown[item.notification_id]);
   }
  }catch{}
 };

 window.addEventListener('storage',storage);
 window.addEventListener('career-crox-notification',incoming);
 window.addEventListener('career-crox-notification-read',read);
 window.addEventListener('focus',recover);
 window.addEventListener('resize',position);
 window.addEventListener('scroll',position,true);
 document.addEventListener('visibilitychange',recover);

 persist();
 void loadWorkNoticePolicy().catch(()=>{});
 void sync();

 return()=>{
  removeCompactLook();
  disposed=true;

  for(const timer of [
   hideTimer,removeTimer,recoveryTimer,queueTimer
  ]){
   clearTimeout(timer);
  }

  if(placeFrame)cancelAnimationFrame(placeFrame);

  unsubscribe();
  window.removeEventListener('storage',storage);
  window.removeEventListener('career-crox-notification',incoming);
  window.removeEventListener('career-crox-notification-read',read);
  window.removeEventListener('focus',recover);
  window.removeEventListener('resize',position);
  window.removeEventListener('scroll',position,true);
  document.removeEventListener('visibilitychange',recover);
  window.removeEventListener(
   'cc927-popup-settings-changed',
   appearanceChanged
  );
  window.removeEventListener('storage',appearanceChanged);
  host.remove();
 };
}
