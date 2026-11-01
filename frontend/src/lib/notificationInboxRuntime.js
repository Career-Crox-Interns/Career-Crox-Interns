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
 if(/\b(?:column|bucket)\b.{0,25}\b(?:expire[ds]?|expiry)\b/i.test(String(item?.title||''))&&!noticeMetadata(item).requires_action)return false;
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
 const meta=noticeMetadata(item),title=String(item?.title||'').toLowerCase(),category=String(item?.category||'').toLowerCase(),fields=(Array.isArray(meta.changes)?meta.changes:[]).map(c=>String(c.field||''));
 let kind=noticeCategory(item),label='';
 if(meta.note_id||meta.note_body||/\bnote(?:s)?\b/.test(title)){kind='notes';label=/edit|updat/.test(title)?'Note Updated':'Note Added';}
 else if(meta.approval_status||meta.approval_kind||/\b(?:profile|approval|allocation|request)\b.*\b(?:approved|rejected|pending|requested)\b/.test(title)){
  kind='approval';label=/reject/i.test(String(meta.approval_status||'')+' '+title)?'Approval Rejected':/approved/i.test(String(meta.approval_status||'')+' '+title)?'Profile Approved':'Approval Pending';
 }else if(fields.some(f=>/interview.*date|interview_reschedule/.test(f))||category.includes('interview')||/\binterview|reschedul/.test(title)){kind='interview';label=/reschedul/.test(title)?'Interview Rescheduled':'Interview Updated';}
 else if(fields.includes('status')||kind==='status'){kind='status';label='Status Updated';}
 else if(kind==='submission'||/\bsubmit|submission/.test(title)){kind='submission';label='New Submission';}
 else if(kind==='transfer'){label='Profile Transfer';}
 const tone=NOTICE_TONES[kind]||NOTICE_TONES.other;
 const strong={notes:['#006b59','#075e77'],profile:['#1c4e9f','#4f3e9c'],interview:['#9a4307','#a95508'],approval:label==='Approval Rejected'?['#a22648','#a13b17']:['#176a46','#197768'],submission:['#6d28b5','#a12770'],status:['#9c3c35','#ad5106'],transfer:['#373a99','#166397'],task:['#146d5b','#245f8b']}[kind];
 return{...tone,...(strong?{accent:strong[0],accent2:strong[1]}:{}),kind,label:label||tone.label};
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

// CC153: concise display only. Original timestamps remain in Details.
export function noticeDisplayMessage(item){
 const text=String(item?.message||'Work update');
 return text.replace(/\b(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g,(_all,date)=>{
  const d=new Date(date+'T00:00:00Z');
  return Number.isFinite(d.getTime())?d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}):date;
 });
}
export function routineWorkNotice(item){
 const m=noticeMetadata(item),title=String(item?.title||'').trim();
 if(m.requires_action||m.action_required||m.manager_review)return false;
 if(/^(?:CRM unlocked|Office (?:joined|left|exited)|Break (?:started|ended)|Report sent|Task (?:updated|completed|closed|finished))\b/i.test(title))return true;
 return false;
}

let compactUsers=0,compactCleanup;

function syncReviewTop(){
 const bar=document.querySelector('.topbar')?.getBoundingClientRect();
 const notice=document.querySelector('.cc120-work-notice-host:not([hidden])');
 const bottom=notice?.getBoundingClientRect().bottom||bar?.bottom||144;
 const top=Math.round(Math.max((bar?.bottom||64)+8,Math.min(bottom+10,innerHeight-250)));
 const value=top+'px';
 if(document.documentElement.style.getPropertyValue('--cc153-review-top')!==value)document.documentElement.style.setProperty('--cc153-review-top',value);
}

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

  sheet.textContent+=`@layer cc829 {
 ${p}${base}>.cc388-card{width:min(224px,calc(100vw - 16px))!important;padding:8px!important;gap:5px!important;background:linear-gradient(145deg,#fff 45%,#f0f5ff)!important;border:1px solid #c3d2ee!important;border-top:3px solid #6543d6!important;border-radius:15px!important;box-shadow:0 9px 26px #253c6a24!important;}
 ${p}${base} .cc388-head{gap:4px!important;padding:2px 0!important;}
 ${p}${base} .cc388-label{flex:1!important;max-width:none!important;justify-content:flex-start!important;padding:5px 7px!important;min-height:25px!important;font:800 11px/1.15 ${COMPACT_FONT}!important;letter-spacing:.015em!important;color:#fff!important;-webkit-text-fill-color:#fff!important;background:linear-gradient(115deg,#245ed4,#7541d7)!important;border-radius:8px!important;white-space:nowrap!important;}
 ${p}${base}>.cc388-card.interview .cc388-label{background:linear-gradient(115deg,#b44310,#e97816)!important;}
 ${p}${base}>.cc388-card.task .cc388-label{background:linear-gradient(115deg,#057b61,#10a080)!important;}
 ${p}${base} .cc150-name{font:800 15px/1.3 ${COMPACT_FONT}!important;color:#122c51!important;-webkit-text-fill-color:#122c51!important;}
 ${p}${base} .cc388-note{padding:7px 8px!important;border:1px solid #d8e2f2!important;border-radius:9px!important;background:#f7faff!important;}
 ${p}${base} .cc388-note span{font:550 12px/1.45 ${COMPACT_FONT}!important;color:#233b60!important;-webkit-text-fill-color:#233b60!important;}
 ${p}${base} .cc388-time{padding:5px 7px!important;border-radius:7px!important;color:#7a3a0b!important;}
 ${p}${base} .cc388-time span{font:650 10.5px/1.35 ${COMPACT_FONT}!important;}
 ${p}${base} .cc388-presets{display:flex!important;flex-wrap:wrap!important;gap:4px!important;margin-top:2px!important;}
 ${p}${base} .cc388-presets button{flex:1 0 26px!important;padding:4px!important;height:25px!important;min-width:25px!important;font:650 10.5px/1 ${COMPACT_FONT}!important;border-radius:7px!important;}
 ${p}.cc803-review-popup{position:fixed!important;left:auto!important;right:14px!important;bottom:auto!important;top:var(--cc153-review-top,154px)!important;width:min(340px,calc(100vw - 28px))!important;max-width:340px!important;max-height:calc(100dvh - var(--cc153-review-top,154px) - 12px)!important;overflow:auto!important;z-index:100970!important;padding:0!important;border:1px solid #bfcff0!important;border-radius:18px!important;background:linear-gradient(145deg,#fff,#f1f5ff)!important;box-shadow:0 15px 38px #223a6b2b!important;font-family:${COMPACT_FONT}!important;animation:cc153-review-in .2s cubic-bezier(.22,1,.36,1) both!important;}
 ${p}.cc803-review-popup .cc604-approval-popup{box-sizing:border-box!important;width:100%!important;max-width:100%!important;min-width:0!important;max-height:none!important;overflow:visible!important;padding:12px!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;}
 ${p}.cc803-review-popup .cc803-review-head{padding:10px 11px!important;margin:-12px -12px 11px!important;background:linear-gradient(115deg,#265bd2,#7c3cda)!important;border:0!important;color:#fff!important;display:flex!important;align-items:center!important;gap:7px!important;}
 ${p}.cc803-review-popup .cc803-review-head *{font-family:${COMPACT_FONT}!important;color:#fff!important;-webkit-text-fill-color:#fff!important;text-shadow:none!important;}
 ${p}.cc803-review-popup .cc604-approval-eyebrow{margin:0!important;padding:0!important;min-width:0!important;background:transparent!important;border:0!important;border-radius:0!important;font:800 11px/1.3 ${COMPACT_FONT}!important;letter-spacing:.04em!important;}
 ${p}.cc803-review-popup .cc803-review-count{margin-left:auto!important;font:650 10.5px/1.3 ${COMPACT_FONT}!important;background:#ffffff24!important;border-radius:20px!important;padding:4px 6px!important;}
 ${p}.cc803-review-popup .cc803-review-close{flex:0 0 26px!important;min-width:26px!important;min-height:26px!important;width:26px!important;height:26px!important;padding:0!important;line-height:1!important;border:0!important;border-radius:8px!important;background:#ffffff25!important;font-size:19px!important;}
 ${p}.cc803-review-popup .cc803-review-title{font:800 17px/1.3 ${COMPACT_FONT}!important;color:#172e50!important;-webkit-text-fill-color:#172e50!important;white-space:normal!important;margin:7px 0!important;}
 ${p}.cc803-review-popup :is(.cc882-review-owner,.cc882-review-process,.cc803-review-meta){font:550 11px/1.45 ${COMPACT_FONT}!important;color:#516381!important;}
 ${p}.cc803-review-popup .cc803-review-note{font:600 12px/1.45 ${COMPACT_FONT}!important;color:#1c3e67!important;background:linear-gradient(115deg,#edf4ff,#f2edff)!important;border:1px solid #c5d5ef!important;border-radius:10px!important;padding:9px!important;}
 ${p}.cc803-review-popup .cc803-review-field{font:650 12px/1.4 ${COMPACT_FONT}!important;color:#354b6a!important;margin-top:10px!important;}
 ${p}.cc803-review-popup textarea{font:450 12px/1.5 ${COMPACT_FONT}!important;background:#fff!important;color:#1d385b!important;border:1px solid #bacce9!important;border-radius:10px!important;min-height:64px!important;padding:9px!important;}
 ${p}.cc803-review-popup .cc803-review-actions{display:flex!important;gap:6px!important;flex-wrap:wrap!important;margin-top:8px!important;}
 ${p}.cc803-review-popup .cc803-review-actions button{font:700 11px/1.3 ${COMPACT_FONT}!important;border-radius:8px!important;padding:7px 9px!important;border:1px solid #c4d4ef!important;background:#f1f5ff!important;color:#294879!important;-webkit-text-fill-color:#294879!important;}
 ${p}.cc803-review-popup .cc803-review-actions .cc803-review-approve{background:linear-gradient(115deg,#057e5d,#13a078)!important;border-color:#087b5f!important;color:#fff!important;-webkit-text-fill-color:#fff!important;}
 ${p}.cc803-review-popup .cc803-review-actions .cc803-review-reject{background:linear-gradient(115deg,#b82e52,#de4565)!important;border-color:#b82e52!important;color:#fff!important;-webkit-text-fill-color:#fff!important;}
 ${p}.cc803-review-popup button:focus-visible{outline:2px solid #2766df!important;outline-offset:2px!important;}
}
@keyframes cc153-review-in{from{opacity:0;transform:translateX(12px) scale(.98)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){${p}.cc803-review-popup{animation:none!important;transition:none!important;}}
`;
  document.head.append(sheet);
  let frame=0;

  const decorate=()=>{
   frame=0;
   syncReviewTop();

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
.queue-count{flex:none;font:750 10px/1.3 Inter,system-ui,sans-serif;color:#fff;background:#ffffff24;border:1px solid #ffffff4d;border-radius:12px;padding:3px 6px;font-variant-numeric:tabular-nums;white-space:nowrap}

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
 background:linear-gradient(115deg,var(--cc151-accent,#245ed4),var(--cc151-accent-2,#7541d7));
 border-bottom:1px solid var(--cc151-head-border,#e0e7f4);
 color:#ffffff;
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
 color:#ffffff;
 padding:0;
}

.close{
 width:22px;
 height:22px;
 border-radius:50%;
 background:#ffffff2e;
 color:#ffffff;
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
 .subject-name{font-size:14px;font-weight:800;overflow-wrap:anywhere}
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
 let queueIndex=0,queueTotal=0;
 let history=[],historyIndex=-1;

 let hideTimer,removeTimer,recoveryTimer,queueTimer,placeFrame;

 const QUICK_RECEIPT_MS=3000;

 const quickReceipt=routineWorkNotice;

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
 style.textContent=POPUP_STYLE+`:host article[role="status"][data-category] header .heading{white-space:normal!important;line-height:1.25!important;font-size:12px!important;font-weight:800!important;color:var(--notice-header-ink,#fff)!important;-webkit-text-fill-color:var(--notice-header-ink,#fff)!important;text-shadow:none!important} .subject-name{font-size:15px!important;font-weight:800!important;color:var(--notice-ink,#14243b)!important} .next:disabled{opacity:.4;cursor:default} article{backdrop-filter:none!important;-webkit-font-smoothing:antialiased} :host article[role="status"][data-category] header{background:linear-gradient(110deg,var(--notice-accent),var(--notice-end))!important} .body{color:var(--notice-ink,#172c48)!important} .subject{color:var(--notice-ink,#14243b)!important} header .queue-count,header .close{color:var(--notice-header-ink,#fff)!important;-webkit-text-fill-color:var(--notice-header-ink,#fff)!important}`;
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
   const theme=noticeHeadline(current);
   article.style.setProperty(
    '--notice-accent',
    raw.styleEnabled?p.accent:theme.accent
   );
   const end=raw.styleEnabled?p.accent2:(theme.accent2||theme.accent);article.style.setProperty('--notice-end',end);
   const start=raw.styleEnabled?p.accent:theme.accent;
   const lightness=hex=>{const values=String(hex).replace('#','').match(/../g);if(values?.length!==3)return 0;const rgb=values.map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];};
   const highest=Math.max(lightness(start),lightness(end));article.style.setProperty('--notice-header-ink',1.05/(highest+.05)>=4.5?'#fff':'#14243b');
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
 const appearanceStorage=event=>{if(event.key?.startsWith('cc927:popup-studio:'))appearanceChanged();};
 window.addEventListener('storage',appearanceStorage);
 appearance();

 function place(){
  const custom=noticeProfile();

  if(custom.placementEnabled&&noticeCategory(current)!=='approval'){
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
   '.topbar'
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
    innerWidth-width-14
   )
  ))+'px';

  host.style.top=Math.round(Math.max(
   8,
   Math.min(
    innerHeight-height-8,
    rect?rect.bottom+7:64
   )
  ))+'px';
  syncReviewTop();
 }

 function queueBadge(){const badge=shadow.querySelector('.queue-count');if(badge){const position=Math.max(1,historyIndex+1),total=Math.max(position,history.length+queue.length);badge.textContent=position+'/'+total;badge.title=queue.length+' more notifications';}}
 function moveNotice(direction){
  clearTimeout(hideTimer);clearTimeout(removeTimer);clearTimeout(queueTimer);closing=false;
  if(direction<0){if(historyIndex>0){historyIndex--;show(history[historyIndex],true);}return;}
  if(historyIndex<history.length-1){historyIndex++;show(history[historyIndex],true);return;}
  if(queue.length){current=null;next();}
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
    show(item,true);

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
  if(queue.length){current=null;closing=false;hover=false;next();return;}
  let delay=160;

  if(reason==='dismiss'){
   rememberNoticeUndo(item);
  }

  if(delay===160)article?.classList.add('leaving');

  removeTimer=setTimeout(()=>{
   host.hidden=true;
   syncReviewTop();
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

 function show(item,replay=false){
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
  if(!replay){history.push(item);if(history.length>60)history.shift();historyIndex=history.length-1;queueIndex++;}
  queueTotal=Math.max(queueTotal,queueIndex);
  hover=false;
  shown[item.notification_id]=Date.now();
  persist();

  const article=document.createElement('article');
  article.setAttribute('role','status');
  article.setAttribute('aria-label','Work notification');

  const theme=popupTheme(item);
  const banner=noticeHeadline(item);
  const metadata=noticeMetadata(item);
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
  const actor=String(metadata.actor_name||metadata.approved_by_name||'').trim()||String(item.title||'').match(/^(.+?)\s+(?:added|updated|edited|changed|approved|rejected|submitted)\b/i)?.[1]||'';
  const fields=(Array.isArray(metadata.changes)?metadata.changes:[]).map(row=>String(row.field||''));
  let action=banner.kind==='notes'?(/edit|updat/i.test(item.title||'')?'edited a note':'added a note')
   :banner.kind==='approval'?(/reject/i.test(banner.label)?'rejected the profile':/approved/i.test(banner.label)?'approved the profile':'requested approval')
   :fields.some(f=>/interview.*date|interview_reschedule/.test(f))?'changed the interview date'
   :fields.some(f=>f==='status')?'changed the status'
   :banner.kind==='interview'?'changed the interview'
   :banner.kind==='submission'?'submitted a profile':banner.kind==='task'?'updated a task':banner.kind==='report'?'updated a report':banner.kind==='attendance'?'updated attendance':'updated the profile';
  const namedActor=actor&&!/^(?:profile|candidate|submission|approval|interview|allocation|request|note|status)$/i.test(actor)?actor:'';
  heading.textContent=namedActor?namedActor+' '+action:banner.label;
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
  highlightNotice(changes,noticeDisplayMessage(item),metadata);
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
    String(item.message||''),
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
  nextButton.onclick=()=>moveNotice(1);
  nextButton.disabled=!queue.length&&historyIndex>=history.length-1;
  const backButton=document.createElement('button');backButton.type='button';backButton.className='next';backButton.textContent='←';backButton.setAttribute('aria-label','Previous update');backButton.disabled=historyIndex<=0;backButton.onclick=()=>moveNotice(-1);

  const footerActions=document.createElement('div');
  footerActions.className='footer-actions';
  footerActions.append(more,backButton,nextButton);
  footer.append(hint,footerActions);

  const counter=document.createElement('span');counter.className='queue-count';counter.setAttribute('aria-label','Notification queue position');
  header.append(dot,heading,counter,close);
  article.append(header,subject,body,footer);
  shadow.querySelector('article')?.remove();
  shadow.append(article);
  queueBadge();

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
  let newest=null;

  if(!current&&!queue.length&&!closing){queueIndex=0;queueTotal=0;}
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
    queue.push(item);queueTotal++;if(!newest||Date.parse(item.created_at)>Date.parse(newest.created_at))newest=item;
   }
  }

  persist();
  if(newest&&!initial&&current&&!document.hidden&&getPollingLeaderSnapshot()?.isLeader){
   clearTimeout(hideTimer);clearTimeout(removeTimer);closing=false;
   queue=queue.filter(row=>row.notification_id!==newest.notification_id);show(newest);
  }
  queueBadge();
  const nextButton=shadow.querySelector('.next:last-child');if(nextButton)nextButton.disabled=!queue.length&&historyIndex>=history.length-1;
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

  const beforeQueue=queue.length;
  queue=queue.filter(row=>
   !data.all
   &&String(row.notification_id)!==String(data.notification_id)
  );

  queueTotal=Math.max(queueIndex,queueTotal-(beforeQueue-queue.length));queueBadge();
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
    const beforeQueue=queue.length;queue=queue.filter(item=>!shown[item.notification_id]);queueTotal=Math.max(queueIndex,queueTotal-(beforeQueue-queue.length));queueBadge();
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
  window.removeEventListener('storage',appearanceStorage);
  host.remove();
 };
}