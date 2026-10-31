import {api,accountPrincipal} from './api';
import {getPollingLeaderSnapshot,subscribePollingLeader} from './tabLeader';
import {notificationTarget} from './workspaceHelpers';

// CC116 recipients are unchanged; this policy controls preview time only.
const DEFAULT_POLICY={tl_enabled:true,manager_seconds:1,tl_seconds:1};
let policyScope='',policyState={...DEFAULT_POLICY},policyAt=0,policyFlight=null;
export function readWorkNoticePolicy(){const scope=accountPrincipal();if(scope!==policyScope){policyScope=scope;policyState={...DEFAULT_POLICY};policyAt=0;policyFlight=null;}return {...policyState};}
function applyPolicy(raw={}){readWorkNoticePolicy();const seconds=value=>Math.max(.5,Math.min(30,Number(value)||1));policyState={tl_enabled:true,manager_seconds:seconds(raw.manager_seconds),tl_seconds:seconds(raw.tl_seconds)};policyAt=Date.now();window.dispatchEvent(new Event('cc119-work-notice-settings'));return readWorkNoticePolicy();}
export function subscribeWorkNoticePolicy(listener){const receive=()=>listener(readWorkNoticePolicy());window.addEventListener('cc119-work-notice-settings',receive);return()=>window.removeEventListener('cc119-work-notice-settings',receive);}
export function canReceiveWorkNotices(user){return Boolean(user?.user_id);}
export async function loadWorkNoticePolicy(force=false){
 readWorkNoticePolicy();if(!force&&policyAt&&Date.now()-policyAt<300000)return readWorkNoticePolicy();if(policyFlight)return policyFlight;
 const scope=policyScope;const flight=api.get('/api/notifications/policy',{cacheTtlMs:force?0:300000,background:true,retries:0,timeoutMs:12000,headers:{'X-CC-Dashboard-User':'global'}}).then(data=>scope===accountPrincipal()?applyPolicy(data.notice_policy):readWorkNoticePolicy()).finally(()=>{if(policyFlight===flight)policyFlight=null;});policyFlight=flight;return flight;
}
export async function saveWorkNoticePolicy(patch){const scope=accountPrincipal();const data=await api.post('/api/notifications/policy',patch,{retries:0,headers:{'X-CC-Dashboard-User':'global'}});return scope===accountPrincipal()?applyPolicy(data.notice_policy):readWorkNoticePolicy();}
if(typeof window!=='undefined')window.addEventListener('career-crox-notice-policy',event=>applyPolicy(event.detail||{}));

export function isManagedWorkNotice(item){const category=String(item?.category||'').toLowerCase();return Boolean(item?.notification_id)&&!['chat','unlock','dialer','archived'].includes(category)&&!/^unlock\b/i.test(item.title||'');}
export function noticeMetadata(row){try{return typeof row?.metadata==='string'?JSON.parse(row.metadata||'{}'):row?.metadata||{};}catch{return {};}}
export function recentWorkNotices(rows,now=Date.now()){
 const ids=new Set();return [...(rows||[])].filter(row=>row?.notification_id&&Number.isFinite(Date.parse(row.created_at))&&Date.parse(row.created_at)>=now-7*86400000&&!['archived','deleted'].includes(String(row.status||'').toLowerCase()))
  .sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||String(b.notification_id).localeCompare(String(a.notification_id)))
  .filter(row=>{const id=String(row.notification_id);if(ids.has(id))return false;ids.add(id);return true;});
}
export const latestWorkNotices=recentWorkNotices;
export const NOTICE_CATEGORIES=[['all','All'],['notes','Notes'],['profile','Profile edits'],['transfer','Transfers'],['status','Status'],['submission','Submissions'],['approval','Approvals'],['interview','Interviews'],['attendance','Attendance'],['task','Tasks'],['report','Reports'],['chat','Team Chat'],['other','Other']];
export function noticeCategory(row){
 const meta=noticeMetadata(row),category=String(row?.category||'').toLowerCase(),title=String(row?.title||'').toLowerCase();
 if(meta.approval_kind||meta.manager_review||['approval','profile_access','unlock'].includes(category)||/\b(approved|approval rejected|crm unlocked|unlock request|self-unlock)\b/.test(title))return 'approval';
 const fields=(Array.isArray(meta.changes)?meta.changes:[]).map(change=>String(change.field||''));
 if(meta.note_id||meta.note_body||/\bnotes?\b/.test(title))return 'notes';
 if(/transfer|reassign|allocat/.test(title+' '+category)||fields.some(field=>['project_id','recruiter_user_id','recruiter_code'].includes(field)))return 'transfer';
 if(category==='submission'||meta.submission_id||meta.section==='submissions')return 'submission';
 if(category==='approval')return 'approval';
 if(category==='chat')return 'chat';
 if(category==='performance'||meta.report_id||/report|digest/.test(category+' '+title))return 'report';
 if(category==='attendance')return 'attendance';
 if(category==='task'||meta.task_id)return 'task';
 if(/interview/.test(category))return 'interview';
 if(fields.some(field=>/status|approval|details_sent/.test(field))||/\bstatus\b/.test(title))return 'status';
 if(/candidate|profile|followup/.test(category)||meta.candidate_id)return 'profile';
 return 'other';
}
export function mergeInboxRows(current,incoming,userId){
 const map=new Map((current||[]).map(row=>[String(row.notification_id),row]));
 for(const row of incoming||[])if(row?.notification_id&&String(row.user_id)===String(userId))map.set(String(row.notification_id),row);
 return recentWorkNotices([...map.values()].filter(row=>String(row.user_id)===String(userId))).filter(row=>String(row.status||'unread').toLowerCase()!=='read').slice(0,60);
}

// CC127 changes presentation only; delivery, read state and Undo stay unchanged.
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
 other:['Update','🔔','#5a607b','#f2f3fa','#cacedf'],
};
function popupTheme(item){
 const meta=noticeMetadata(item),raw=String(item?.category||'').toLowerCase(),title=String(item?.title||'');
 let kind=noticeCategory(item);
 if(/call ratio|no[- ]?call|low.call|call.*warning/i.test(title+' '+String(meta.reason||'')))kind='calls';
 else if(/low activity|idle.*warning|low_activity/i.test(title+' '+String(meta.reason||'')))kind='activity';
 else if(raw==='goal-post')kind='goal';
 else if(['learning','aaria','system','warning'].includes(raw))kind=raw;
 else if(kind==='other'&&raw&&!['general','other'].includes(raw)){
  let hash=0;for(const ch of raw)hash=(hash*31+ch.charCodeAt(0))>>>0;
  const hue=hash%360,label=raw.replace(/[_-]+/g,' ').replace(/^./,c=>c.toUpperCase()).slice(0,24);
  return {kind:raw,label,icon:'🔔',accent:`hsl(${hue} 62% 32%)`,soft:`hsl(${hue} 76% 96%)`,line:`hsl(${hue} 46% 80%)`};
 }
 const [label,icon,accent,soft,line]=POPUP_THEMES[kind]||POPUP_THEMES.other;
 return {kind,label,icon,accent,soft,line};
}
function highlightNotice(target,value,metadata){
 const text=String(value||'Work update'),ranges=[],lower=text.toLocaleLowerCase();
 // Exact metadata values and numbers are marked with DOM nodes, never HTML.
 const terms=[metadata.candidate_name,...(Array.isArray(metadata.changes)?metadata.changes.slice(0,12).map(change=>change.to):[])];
 for(const value of terms){
  if(!['string','number'].includes(typeof value))continue;
  const term=String(value).trim();if(!term||term.length>120)continue;
  const needle=term.toLocaleLowerCase();let from=0,index;
  while((index=lower.indexOf(needle,from))!==-1&&ranges.length<80){ranges.push([index,index+term.length]);from=index+term.length;}
 }
 const keyValues=/\b(?:\d+\s*\/\s*\d+|\d+(?:\.\d+)?(?:\s*(?:minutes?|mins?|hours?|hrs?|days?|calls?))?|approved|rejected|pending|completed|rescheduled|selected|joined|cancelled|on hold|in progress)\b/gi;
 for(const match of text.matchAll(keyValues)){if(ranges.length>=120)break;ranges.push([match.index,match.index+match[0].length]);}
 ranges.sort((a,b)=>a[0]-b[0]||b[1]-a[1]);const merged=[];
 for(const range of ranges){const last=merged[merged.length-1];if(last&&range[0]<last[1])last[1]=Math.max(last[1],range[1]);else merged.push([...range]);}
 let offset=0;
 for(const [start,end]of merged){target.append(document.createTextNode(text.slice(offset,start)));const mark=document.createElement('mark');mark.textContent=text.slice(start,end);target.append(mark);offset=end;}
 target.append(document.createTextNode(text.slice(offset)));
}
const POPUP_STYLE=`
:host([hidden]){display:none!important}
*{box-sizing:border-box}
article{font:11px/1.4 "Segoe UI",Arial,sans-serif;color:#263247;background:linear-gradient(135deg,#fff 62%,var(--notice-soft));border:1px solid var(--notice-line);border-left:4px solid var(--notice-accent);border-radius:12px;box-shadow:0 6px 20px #25384d26;transform-origin:top right;animation:notice-boing .68s both cubic-bezier(.22,.7,.3,1)}
header{display:flex;align-items:center;gap:8px;min-height:38px;padding:7px 6px 5px 10px}
button{font:inherit;color:inherit;border:0;background:none;cursor:pointer}
button:focus-visible,.changes:focus-visible{outline:2px solid var(--notice-accent);outline-offset:2px}
.category-icon-static{display:grid;place-items:center;flex:none;width:25px;height:25px;border-radius:8px;background:var(--notice-soft);font-size:14px}
.heading{flex:1;min-width:0;padding:0;text-align:left;font-size:11.5px;line-height:1.3;font-weight:750;overflow-wrap:anywhere;color:var(--notice-accent)}
.close{flex:none;align-self:flex-start;display:grid;place-items:center;width:23px;height:23px;padding:0;margin-top:-2px;font-size:18px;line-height:1;color:#667386;border-radius:6px}
.close:hover{background:var(--notice-soft);color:var(--notice-accent)}
.subject{display:block;padding:0 10px 4px;font-size:10px;font-weight:600;color:#5d697d;overflow-wrap:anywhere}.subject:empty{display:none}
.body{padding:0 8px 4px;max-height:min(170px,38vh);overflow:auto;overscroll-behavior:contain;overflow-wrap:anywhere}
.changes{padding:7px 8px;background:var(--notice-soft);border:1px solid var(--notice-line);border-radius:8px;font-size:11.5px;line-height:1.5;font-weight:650;color:var(--notice-accent);white-space:pre-wrap;cursor:pointer}
.changes mark{padding:0 3px;border-radius:4px;background:var(--notice-accent);color:#fff;font-weight:800;box-decoration-break:clone;-webkit-box-decoration-break:clone}
.note-kicker{display:block;margin-bottom:3px;font-size:9px;font-weight:600;color:var(--notice-accent)}
.notice-footer{display:flex;align-items:center;justify-content:space-between;gap:7px;padding:1px 9px 6px;font-size:9.5px;color:#5e6a7a}
.kind{max-width:95px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-radius:5px;padding:1px 4px;background:var(--notice-soft);color:var(--notice-accent);font-weight:700}
.footer-actions{display:flex;align-items:center;gap:5px}
.more{padding:3px 2px;color:var(--notice-accent);font-size:9.5px}
.next{padding:3px 6px;border:1px solid var(--notice-line);border-radius:6px;background:#fff;color:var(--notice-accent);font-size:9.5px;font-weight:600}
.context{padding:7px 2px 2px;color:#526176;font-size:10px;white-space:pre-wrap}
.leaving{animation:notice-bye .16s ease-in forwards}
@keyframes notice-boing{0%{opacity:0;transform:translateX(38px) scale(.85) rotate(4deg)}48%{opacity:1;transform:translateX(-7px) scale(1.018) rotate(-1.5deg)}70%{transform:translateX(3px) scale(.99) rotate(.8deg)}86%{transform:translateX(-1px) rotate(-.35deg)}100%{opacity:1;transform:none}}
@keyframes notice-bye{to{opacity:0;transform:translateX(16px) scale(.96)}}
@media(prefers-reduced-motion:reduce){article,.leaving{animation:none!important}}
`;

// CC134: one-time, narrowly scoped removal of prior browser-only cartoon preferences.
// Do not clear Site Data: it contains unrelated unsent CRM drafts and auth state.
let cc134CharacterCleanupDone=false;
function cc134ClearOldLocalCharacterData(){
 if(cc134CharacterCleanupDone||typeof window==='undefined')return;cc134CharacterCleanupDone=true;
 try{for(let i=localStorage.length-1;i>=0;i--){const key=localStorage.key(i);if(key?.startsWith('cc128-companion:v1:'))localStorage.removeItem(key);}}catch{}
 try{sessionStorage.removeItem('cc129-welcome');}catch{}
 try{if(window.indexedDB)window.indexedDB.deleteDatabase('cc129-personal-companions');}catch{}
}

export function installNotificationInboxRuntime(user,{navigate=path=>window.location.assign(path)}={}){
 if(!user?.user_id||typeof document==='undefined')return()=>{};
 cc134ClearOldLocalCharacterData();
 const principal=accountPrincipal(),uid=String(user.user_id),mountedAt=Date.now();
 const seenKey='cc120-notice-seen:'+principal,metaKey='cc120-notice-sync:'+principal;
 const parse=(storage,key,fallback)=>{try{return JSON.parse(storage.getItem(key)||'null')||fallback;}catch{return fallback;}};
 let shown=parse(localStorage,seenKey,{}),saved=parse(sessionStorage,metaKey,{});
 let disposed=false,inflight=null,lastSync=Number(saved.at)||0,signature=saved.signature||'',current=null,queue=[],hover=false;
 let hideTimer,removeTimer,recoveryTimer,queueTimer;
 const stable=item=>/candidate_update|profile_access|approval|attendance/.test(String(item.category||''))||/note|transfer|reassign|submission|interview|follow.up|unlock|profile access/.test(String(item.title||'').toLowerCase());
 const host=document.createElement('div');host.className='cc120-work-notice-host';host.hidden=true;
 host.style.cssText='position:fixed;z-index:100960;width:min(282px,calc(100vw - 20px));pointer-events:auto;';
 const shadow=host.attachShadow({mode:'open'}),style=document.createElement('style');
 style.textContent=POPUP_STYLE;
 shadow.append(style);(document.body||document.documentElement).append(host);
 const live=()=>!disposed&&accountPrincipal()===principal;
 function persist(){const cutoff=Date.now()-7*86400000;shown=Object.fromEntries(Object.entries(shown).filter(([,at])=>Number(at)>=cutoff).slice(-1000));try{localStorage.setItem(seenKey,JSON.stringify(shown));}catch{}}
 function place(){
  const approval=/approval|allocation.lock|profile.access|unlock/i.test([current?.category,current?.title].join(' '));const anchor=document.querySelector(approval?'[data-pill=approvals]':'.topbar'),rect=anchor?.getBoundingClientRect(),box=host.getBoundingClientRect(),width=box.width||282,height=box.height||115;host.classList.toggle('cc129-approval-notice',approval);
  host.style.left=Math.round(Math.max(8,Math.min(innerWidth-width-14,approval&&rect?rect.left+rect.width/2-width/2:innerWidth-width-14)))+'px';
  host.style.top=Math.round(Math.max(8,Math.min(innerHeight-height-8,rect?rect.bottom+7:64)))+'px';
 }
 function next(){clearTimeout(queueTimer);if(!live()||current||!queue.length||document.hidden||!getPollingLeaderSnapshot()?.isLeader)return;const item=queue.shift();if(!shown[item.notification_id])show(item);else next();}
 function rememberNoticeUndo(item){
  window.__CC126_POPUP_UNDO__?.push({title:item.title,restore:()=>{
   if(!live())return false;clearTimeout(hideTimer);clearTimeout(removeTimer);clearTimeout(queueTimer);
   if(current&&String(current.notification_id)!==String(item.notification_id)&&!queue.some(row=>String(row.notification_id)===String(current.notification_id)))queue.unshift(current);
   current=null;show(item);return current?.notification_id===item.notification_id;
  }});
 }
 function finish(reason='auto'){
  clearTimeout(hideTimer);clearTimeout(removeTimer);if(!current)return;
  const article=shadow.querySelector('article'),item=current;
  let delay=160;
  if(reason==='dismiss'){
   rememberNoticeUndo(item);
  }
  if(delay===160)article?.classList.add('leaving');
  removeTimer=setTimeout(()=>{host.hidden=true;current=null;hover=false;queueTimer=setTimeout(next,100);},delay);
 }
 function scheduleHide(delay){clearTimeout(hideTimer);hideTimer=setTimeout(()=>{if(!hover)finish();},Math.max(100,delay));}
 function show(item){
  window.__CC124_REMEMBER_POPUP__?.({key:'notice:'+item.notification_id,kind:'Notification',title:item.title,note:item.message,candidate_id:noticeMetadata(item).candidate_id,time:item.created_at,path:notificationTarget(item)});
  if(!live())return;clearTimeout(hideTimer);clearTimeout(removeTimer);current=item;hover=false;shown[item.notification_id]=Date.now();persist();
  const article=document.createElement('article');article.setAttribute('role','status');article.setAttribute('aria-label','Work notification');
  const theme=popupTheme(item);article.dataset.category=theme.kind;
  for(const [key,value]of Object.entries({accent:theme.accent,soft:theme.soft,line:theme.line}))article.style.setProperty('--notice-'+key,value);
  const header=document.createElement('header'),dot=document.createElement('span'),heading=document.createElement('button'),close=document.createElement('button'),body=document.createElement('div');
  dot.className='notice-character';dot.setAttribute('aria-hidden','true');
  dot.className='category-icon-static';dot.textContent=theme.icon;dot.setAttribute('aria-hidden','true');
  heading.type='button';heading.className='heading';heading.textContent=item.title||'Work update';heading.title='Open update';close.type='button';close.className='close';close.textContent='×';close.setAttribute('aria-label','Dismiss notification');body.className='body';
  const open=()=>{
   window.open(/allocation.lock.*request|profile.allocation.*request/i.test(item.title||'')?'/approvals':notificationTarget(item),'_blank','noopener,noreferrer');finish('open');
   rememberNoticeUndo(item);
   void api.post('/api/notifications/'+encodeURIComponent(item.notification_id)+'/read',{}, {retries:0,detachedWrite:true,background:true,headers:{'X-CC-Dashboard-User':'global'}}).catch(()=>{});
  };
  heading.onclick=open;body.onclick=open;close.onclick=()=>finish('dismiss');
  article.onpointerenter=()=>{hover=true;clearTimeout(hideTimer);place();};article.onpointerleave=()=>{hover=false;scheduleHide(200);};article.onfocusin=()=>{hover=true;clearTimeout(hideTimer);};article.onfocusout=()=>{hover=false;scheduleHide(200);};
  const metadata=noticeMetadata(item),subject=document.createElement('span');subject.className='subject';subject.textContent=[metadata.candidate_name,metadata.candidate_id].filter(Boolean).join(' · ');
  const changes=document.createElement('div');changes.className='changes';highlightNotice(changes,item.message,metadata);body.append(changes);
  changes.tabIndex=0;changes.setAttribute('role','button');changes.setAttribute('aria-label','Open '+(item.title||'work update'));changes.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}};
  if(metadata.note_id||metadata.note_body){const kicker=document.createElement('small');kicker.className='note-kicker';kicker.textContent='Updated note';changes.prepend(kicker);}
  const more=document.createElement('button');more.type='button';more.className='more';more.textContent='Details';more.title='More activity details';more.setAttribute('aria-expanded','false');more.setAttribute('aria-controls','cc127-notice-context');more.onclick=event=>{event.stopPropagation();let details=body.querySelector('.context');if(details){details.remove();more.setAttribute('aria-expanded','false');place();return;}details=document.createElement('div');details.className='context';details.id='cc127-notice-context';details.textContent=[metadata.actor_name?'By '+metadata.actor_name:'',new Date(item.created_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}),metadata.candidate_id?'Candidate '+metadata.candidate_id:''].filter(Boolean).join('\n');body.append(details);more.setAttribute('aria-expanded','true');place();};body.onclick=event=>{if(!event.target.closest('button'))open();};
  const footer=document.createElement('div');footer.className='notice-footer';const hint=document.createElement('span');hint.className='kind';hint.textContent=theme.label;hint.title=stable(item)?'Stays until you close it':'Work notification';
  const nextButton=document.createElement('button');nextButton.type='button';nextButton.className='next';nextButton.textContent='Next →';nextButton.setAttribute('aria-label','Next update');nextButton.onclick=()=>finish('dismiss');
  const footerActions=document.createElement('div');footerActions.className='footer-actions';footerActions.append(more,nextButton);footer.append(hint,footerActions);
  header.append(dot,heading,close);article.append(header,subject,body,footer);shadow.querySelector('article')?.remove();shadow.append(article);host.hidden=false;place();
  const anchor=document.getElementById('cc120-notifications-trigger');anchor?.classList.remove('cc120-bell-bounce');if(anchor){void anchor.offsetWidth;anchor.classList.add('cc120-bell-bounce');}
  if(!stable(item)){const policy=readWorkNoticePolicy(),seconds=String(user.role).toLowerCase()==='tl'?policy.tl_seconds:policy.manager_seconds;scheduleHide(seconds*1000-160);}else{article.onpointerleave=()=>{hover=false;};article.onfocusout=()=>{hover=false;};}
 }
 function offer(items,initial=false){
  if(!live())return;const fresh=recentWorkNotices(items).filter(item=>String(item.user_id)===uid&&isManagedWorkNotice(item)&&String(item.status||'unread').toLowerCase()!=='read'&&!shown[item.notification_id]);
  for(const item of fresh.reverse()){if(initial&&Date.parse(item.created_at)<mountedAt-15000){shown[item.notification_id]=Date.now();continue;}if(!queue.some(row=>String(row.notification_id)===String(item.notification_id))&&String(current?.notification_id)!==String(item.notification_id))queue.push(item);}
  if(queue.length>50)queue=queue.slice(-50);persist();if(current&&fresh.length&&!initial){clearTimeout(hideTimer);current=null;host.hidden=true;const newest=queue.pop();if(newest)show(newest);}else next();
 }
 function planRecovery(){clearTimeout(recoveryTimer);recoveryTimer=setTimeout(()=>{if(live()&&!document.hidden)void sync();else if(live())planRecovery();},window.__CC940_NOTICE_STREAM_READY__?1800000:300000);}
 async function sync(){
  if(!live()||inflight||document.hidden||!getPollingLeaderSnapshot()?.isLeader||window.__CC602_NETWORK_PAUSED__)return inflight;
  if(lastSync&&Date.now()-lastSync<300000){planRecovery();return;}lastSync=Date.now();
  inflight=api.get('/api/notifications?inbox=1'+(signature?'&signature='+encodeURIComponent(signature):''),{cacheTtlMs:0,retries:0,background:true,timeoutMs:12000,headers:{'X-CC-Dashboard-User':'global'}}).then(feed=>{
   if(!live())return;if(feed.notice_policy)applyPolicy(feed.notice_policy);if(!feed.unchanged)offer(feed.items||[],true);signature=feed.signature||signature;try{sessionStorage.setItem(metaKey,JSON.stringify({at:lastSync,signature}));}catch{}
  }).catch(()=>{lastSync=0;}).finally(()=>{inflight=null;if(live())planRecovery();});return inflight;
 }
 const incoming=event=>offer([event.detail]);
 const read=event=>{const data=event.detail||{};if(String(data.user_id)!==uid)return;queue=queue.filter(row=>!data.all&&String(row.notification_id)!==String(data.notification_id));if(current&&(data.all||String(data.notification_id)===String(current.notification_id)))finish();};
 const recover=()=>{if(!live())return;if(document.hidden){queue=[];finish();return;}next();if(Date.now()-lastSync>=300000)void sync();};
 const unsubscribe=subscribePollingLeader(snapshot=>{if(snapshot.isLeader){next();void sync();}else{queue=[];finish();}});
 window.addEventListener('career-crox-notification',incoming);window.addEventListener('career-crox-notification-read',read);window.addEventListener('focus',recover);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);document.addEventListener('visibilitychange',recover);
 persist();void loadWorkNoticePolicy().catch(()=>{});void sync();
 return()=>{disposed=true;for(const timer of [hideTimer,removeTimer,recoveryTimer,queueTimer])clearTimeout(timer);unsubscribe();window.removeEventListener('career-crox-notification',incoming);window.removeEventListener('career-crox-notification-read',read);window.removeEventListener('focus',recover);window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);document.removeEventListener('visibilitychange',recover);host.remove();};
}
