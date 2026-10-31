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
.mascot{position:relative;display:block;flex:none;width:24px;height:24px;margin:1px 3px 0 0;border-radius:9px;background:var(--notice-soft);border:1.5px solid var(--notice-accent);transform-origin:50% 80%;animation:mascot-dance .56s ease-in-out .18s 2}
.mascot:before,.mascot:after{content:'';position:absolute;top:12px;width:5px;height:3px;border-radius:4px;background:var(--notice-accent)}
.mascot:before{left:-5px;transform:rotate(-30deg)}
.mascot:after{right:-5px;transform-origin:left center;animation:mascot-wave .22s ease-in-out .2s 5 alternate}
.eye{position:absolute;top:8px;width:3px;height:4px;border-radius:50%;background:var(--notice-accent)}
.eye.left{left:6px}.eye.right{right:6px;animation:mascot-wink .75s ease-in-out .25s 2}
.smile{position:absolute;left:7px;top:13px;width:8px;height:5px;border:1.5px solid var(--notice-accent);border-top:0;border-radius:0 0 7px 7px}
.category-icon{position:absolute;right:-5px;top:-7px;display:grid;place-items:center;width:15px;height:15px;border-radius:50%;background:#fff;font-size:11px;line-height:1;box-shadow:0 1px 3px #26324720}
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
@keyframes mascot-dance{0%,100%{transform:none}25%{transform:translateY(-3px) rotate(-13deg) scale(1.06,.94)}50%{transform:translateY(1px) rotate(9deg) scale(.94,1.06)}75%{transform:translateY(-2px) rotate(-5deg)}}
@keyframes mascot-wave{from{transform:rotate(25deg)}to{transform:rotate(-60deg)}}
@keyframes mascot-wink{0%,30%,56%,100%{transform:scaleY(1)}42%{transform:scaleY(.16)}}
@keyframes notice-bye{to{opacity:0;transform:translateX(16px) scale(.96)}}
@media(prefers-reduced-motion:reduce){article,.leaving,.mascot,.mascot:after,.eye.right{animation:none!important}}
`;

export function installNotificationInboxRuntime(user,{navigate=path=>window.location.assign(path)}={}){
 if(!user?.user_id||typeof document==='undefined')return()=>{};
 const stopCompanion=installCareerCompanion(user);
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
 style.textContent=POPUP_STYLE+CC128_NOTICE_STYLE;
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
  const article=shadow.querySelector('article'),item=current,companion=window.__CC128_COMPANION__;
  let delay=160;
  if(reason==='dismiss'){
   rememberNoticeUndo(item);
   const r=host.getBoundingClientRect();
   window.dispatchEvent(new CustomEvent('cc128-companion-event',{detail:{kind:'push',text:'Out of the way!',speak:false,immediate:true,target:{left:r.left,top:r.top,width:r.width,height:r.height}}}));
   if(companion?.preferences().enabled&&companion.preferences().motion&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches){delay=550;article?.animate([{transform:'none',opacity:1,offset:0},{transform:'none',opacity:1,offset:.65},{transform:'translateX(340px) rotate(7deg)',opacity:0}],{duration:550,easing:'ease-in',fill:'forwards'});}
  }
  if(delay===160)article?.classList.add('leaving');
  removeTimer=setTimeout(()=>{host.hidden=true;current=null;hover=false;queueTimer=setTimeout(next,100);},delay);
 }
 function scheduleHide(delay){clearTimeout(hideTimer);hideTimer=setTimeout(()=>{if(!hover)finish();},Math.max(100,delay));}
 function show(item){
  window.__CC124_REMEMBER_POPUP__?.({key:'notice:'+item.notification_id,kind:'Notification',title:item.title,note:item.message,candidate_id:noticeMetadata(item).candidate_id,time:item.created_at,path:notificationTarget(item)});
  if(!live())return;clearTimeout(hideTimer);clearTimeout(removeTimer);current=item;hover=false;shown[item.notification_id]=Date.now();persist();
  window.__CC128_COMPANION__?.notify(item);
  const article=document.createElement('article');article.setAttribute('role','status');article.setAttribute('aria-label','Work notification');
  const theme=popupTheme(item);article.dataset.category=theme.kind;
  const vivid=CC128_NOTICE_COLORS[theme.kind]||['#1e65d9','#8430bc'];
  for(const [key,value]of Object.entries({accent:theme.accent,soft:theme.soft,line:theme.line,a:vivid[0],b:vivid[1]}))article.style.setProperty('--notice-'+key,value);
  const header=document.createElement('header'),dot=document.createElement('span'),heading=document.createElement('button'),close=document.createElement('button'),body=document.createElement('div');
  dot.className='notice-character';dot.setAttribute('aria-hidden','true');
  const portrait=document.createElement('span');portrait.className='notice-sprite';cc128Sprite(portrait,cc129Character(cc128ReadPrefs(user.user_id)),6);dot.append(portrait);
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
 return()=>{stopCompanion();disposed=true;for(const timer of [hideTimer,removeTimer,recoveryTimer,queueTimer])clearTimeout(timer);unsubscribe();window.removeEventListener('career-crox-notification',incoming);window.removeEventListener('career-crox-notification-read',read);window.removeEventListener('focus',recover);window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);document.removeEventListener('visibilitychange',recover);host.remove();};
}

// CC128 — personal, local-only cartoon companion. Art is shipped with this build.

const CC128_NOTICE_COLORS={calls:['#c64a00','#bd2858'],activity:['#cb2746','#8e2bcd'],notes:['#007f65','#0068b4'],profile:['#0861d9','#2744d1'],transfer:['#bd3d0c','#c22874'],status:['#6437d9','#a62aaa'],submission:['#1463da','#5731db'],approval:['#087b39','#007b8b'],interview:['#8433d2','#bb267f'],attendance:['#9f6209','#b33e05'],task:['#5037d7','#a52db4'],report:['#006d91','#2949c9']};
const CC128_NOTICE_STYLE=`
article{background:linear-gradient(135deg,#fff 50%,var(--notice-soft));border:1px solid var(--notice-accent);border-left:4px solid var(--notice-accent);box-shadow:0 7px 24px #1a3e6533,0 1px 0 #ffffffc0 inset}
header{padding:5px 6px 5px 7px;min-height:43px;background:linear-gradient(115deg,var(--notice-a),var(--notice-b));border-radius:10px 10px 0 0;gap:7px}
.notice-character{position:relative;display:block;flex:none;width:34px;height:34px;background:linear-gradient(145deg,#ffffff,#e8f4ff);border:1px solid #ffffffd9;border-radius:11px;box-shadow:0 2px 5px #12314d30}
.notice-sprite{position:absolute;inset:0;background-repeat:no-repeat;filter:drop-shadow(0 1px 1px #15305025)}
.heading{color:#fff;font-size:12px;font-weight:750;text-shadow:0 1px 1px #123f6420}.close{color:#fff;margin-top:0}.close:hover{background:#ffffff30;color:#fff}
.subject{padding-top:5px;font-size:10.5px;font-weight:700;color:var(--notice-accent)}.body{padding-top:5px;padding-bottom:3px}.subject:not(:empty)+.body{padding-top:0}
.changes{font-size:12px;line-height:1.45;font-weight:700;background:#fff;border:1px solid var(--notice-line);box-shadow:0 2px 5px #1d45700d;padding:7px 8px;color:#173b58}
.changes mark{background:var(--notice-accent);color:#fff;padding:1px 3px}.note-kicker{color:var(--notice-accent);font-weight:750}
.notice-footer{padding-top:2px}.next{background:linear-gradient(120deg,var(--notice-a),var(--notice-b));border-color:transparent;color:#fff;box-shadow:0 2px 4px #17466e20}.more{font-weight:700}.kind{border:1px solid var(--notice-line);font-weight:750}
`;

const CC128_ATLASES=[{"src":"/assets/img/cc128-companion-01-b76c9adad8.webp","width":1484,"height":1060,"sha256":"b76c9adad8ca60a6b73ce4e3171ce079ffd562e4a1b4d9865410222691f97ca8","bytes":900814,"frames":35},{"src":"/assets/img/cc128-companion-02-387c4cc111.webp","width":1484,"height":1060,"sha256":"387c4cc111154c0f4e61aedde18ac573a5fb8bce9c00345d3c6d25a3f6126920","bytes":902970,"frames":35},{"src":"/assets/img/cc128-companion-03-7ef6423356.webp","width":1484,"height":1060,"sha256":"7ef64233561c42090afd9b30a9442f7ccedaa31b36a5a59e417aa3d23a752592","bytes":967496,"frames":35},{"src":"/assets/img/cc128-companion-04-59997d4f39.webp","width":1484,"height":1060,"sha256":"59997d4f39a59cfe9279eefa1ad29712ee5141cd8e7505e1ab552cc9e91f8a70","bytes":1033022,"frames":35},{"src":"/assets/img/cc128-companion-05-71996dc9a8.webp","width":1484,"height":1060,"sha256":"71996dc9a86cb1652bccecb815b27d0b950d4ac30617f9e57f754356252c9ecd","bytes":1055844,"frames":35},{"src":"/assets/img/cc128-companion-06-48d5ba2db3.webp","width":1484,"height":1060,"sha256":"48d5ba2db30decbace533544c955953af9a1cb98d7243f055e867382396fe502","bytes":1008056,"frames":35},{"src":"/assets/img/cc128-companion-07-bc2be1e70a.webp","width":1484,"height":1060,"sha256":"bc2be1e70abb3b41873064eaa27a8c05163937620165b46265a914b656c0d581","bytes":934300,"frames":35},{"src":"/assets/img/cc128-companion-08-49f594ce94.webp","width":1484,"height":1060,"sha256":"49f594ce943c1573e207c3862bc80f707605ba430d98be19ab93075a2af86d35","bytes":1091078,"frames":35}];
const CC128_CHARACTERS=[
 ['01','Orbit Robot'],['02','Finn Fox'],['03','Dizzy Dragon'],['04','Jelly Buddy'],['05','Spring Bot'],
 ['06','Bella Bell'],['07','Pip Penguin'],['08','Boo Buddy'],['09','Ollie Octopus'],['10','Rocket Buddy'],
 ['11','Coco Crab'],['12','Cloud Buddy'],['13','Bub Bubble'],['14','Ollie Owl'],['15','Sunny Cube'],
 ['16','Chippy Chameleon'],['17','Milo Cat'],['18','Astro Buddy'],['19','Stella Star'],['20','Otto Otter'],
 ['71','Pip at Work'],['72','Ollie Multitasker'],['73','Owl Analyst'],['74','Milo Recruiter'],['75','Otto Approver'],
 ['76','Panda Post'],['77','Red Panda Presenter'],['78','Koala Helper'],['79','Call Buddy'],['80','Bunny Messenger'],
 ['81','Raccoon Reviewer'],['82','Fox Planner'],['83','Bear Support'],['84','Beaver Typist'],['85','Hedgehog Notes'],
 ['86','Meerkat Coordinator'],['87','Parrot Caller'],['88','Hamster Helper'],['89','Chameleon Checker'],['90','Sloth Buddy'],
].map(([id,name],index)=>({id,name,atlas:Math.floor(index/5),row:index%5}));
const CC128_DEFAULTS={enabled:true,character:'07',size:132,volume:45,sounds:true,voice:true,readNotifications:true,voiceURI:'',voiceStyle:'spark',customVariant:0,rate:1.06,idle:true,motion:true,x:1,y:.88};
const cc128Number=(value,min,max,fallback)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Number(value))):fallback;
const cc128Uid=()=>{try{return String(JSON.parse(localStorage.getItem('careerCroxCachedUser')||'{}').user_id||'');}catch{return '';}};
const cc128PrefKey=uid=>'cc128-companion:v1:'+encodeURIComponent(uid);
function cc128ReadPrefs(uid=cc128Uid()){
 let raw={};try{raw=JSON.parse(localStorage.getItem(cc128PrefKey(uid))||'{}')||{};}catch{}
 const p={...CC128_DEFAULTS,...raw};
 for(const name of ['enabled','sounds','voice','readNotifications','idle','motion'])p[name]=typeof p[name]==='boolean'?p[name]:CC128_DEFAULTS[name];
 if(p.character!=='custom'&&!CC128_CHARACTERS.some(c=>c.id===String(p.character)))p.character='07';
 p.size=cc128Number(p.size,64,180,132);p.volume=cc128Number(p.volume,0,100,45);p.rate=cc128Number(p.rate,.75,1.35,1.06);p.x=cc128Number(p.x,0,1,1);p.y=cc128Number(p.y,0,1,.88);p.voiceURI=String(p.voiceURI||'').slice(0,300);
 p.voiceStyle=CC129_VOICES.some(v=>v[0]===p.voiceStyle)?p.voiceStyle:'spark';p.customVariant=Math.max(0,Math.min(5,Math.round(Number(p.customVariant)||0)));return p;
}
function cc128SavePrefs(patch,uid=cc128Uid()){
 const next={...cc128ReadPrefs(uid),...patch};
 try{localStorage.setItem(cc128PrefKey(uid),JSON.stringify(next));}catch{}
 window.dispatchEvent(new CustomEvent('cc128-companion-settings',{detail:{uid,prefs:next}}));
 return next;
}
function cc128Element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node;}
function cc128Button(text,label,handler,className=''){const node=cc128Element('button',className,text);node.type='button';if(label)node.setAttribute('aria-label',label);if(handler)node.onclick=handler;return node;}
// Isolate display frames from atlas neighbours; original rendered pixels are kept.
const cc128AtlasImages=new Map(),cc128DisplayFrames=new Map();
function cc128AtlasImage(src){
 if(!cc128AtlasImages.has(src))cc128AtlasImages.set(src,new Promise((resolve,reject)=>{const image=new Image();image.decoding='async';image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Character artwork could not load.'));image.src=src;}));
 return cc128AtlasImages.get(src);
}
function cc128DisplayFrame(character,frame){
 if(character.id==='custom')return cc129CustomFrame();
 const meta=CC128_ATLASES[character.atlas],key=meta.src+'|'+character.row+'|'+frame;
 if(cc128DisplayFrames.has(key))return cc128DisplayFrames.get(key);
 const promise=cc128AtlasImage(meta.src).then(image=>{
  const cw=image.naturalWidth/7,ch=image.naturalHeight/5,pad=12,w=Math.round(cw+pad*2),h=Math.round(ch+pad*2),canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,frame*cw-pad,character.row*ch-pad,cw+pad*2,ch+pad*2,0,0,w,h);
  const pixels=context.getImageData(0,0,w,h),data=pixels.data,labels=new Int32Array(w*h),todo=new Int32Array(w*h),groups=[];let number=0;
  // The sloth row has a small overrun from the chameleon row above it.
  if(character.id==='90')for(let y=0;y<pad+12;y++)for(let x=0;x<w;x++)data[(y*w+x)*4+3]=0;
  for(let start=0;start<labels.length;start++){
   if(labels[start]||data[start*4+3]<24)continue;
   const id=++number;let head=0,tail=1,count=0,minX=w,minY=h,maxX=0,maxY=0,sx=0,sy=0;todo[0]=start;labels[start]=id;
   while(head<tail){const at=todo[head++],x=at%w,y=Math.floor(at/w);count++;sx+=x;sy+=y;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const next=ny*w+nx;if(!labels[next]&&data[next*4+3]>=24){labels[next]=id;todo[tail++]=next;}}
   }
   groups.push({id,count,minX,minY,maxX,maxY,cx:sx/count,cy:sy/count});
  }
  const centerX=pad+cw/2,centerY=pad+ch/2;
  const main=groups.sort((a,b)=>b.count/(1+Math.hypot(b.cx-centerX,b.cy-centerY)/cw*3)-a.count/(1+Math.hypot(a.cx-centerX,a.cy-centerY)/cw*3))[0];
  if(!main)return '';
  const keep=new Set(groups.filter(group=>group.id===main.id||group.count>Math.max(8,main.count*.08)&&group.cy>=main.minY&&group.cy<=main.maxY&&group.minX>pad+3&&group.maxX<pad+cw-3&&group.minY>pad+3&&group.maxY<pad+ch-3).map(group=>group.id));
  let minX=w,minY=h,maxX=0,maxY=0;
  for(let i=0;i<labels.length;i++)if(keep.has(labels[i])){const x=i%w,y=Math.floor(i/w);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}else data[i*4+3]=0;
  context.putImageData(pixels,0,0);const output=document.createElement('canvas');output.width=output.height=256;const draw=output.getContext('2d');draw.imageSmoothingEnabled=true;draw.imageSmoothingQuality='high';const bw=maxX-minX+1,bh=maxY-minY+1,scale=Math.min(234/bw,234/bh),dw=bw*scale,dh=bh*scale;
  draw.drawImage(canvas,minX,minY,bw,bh,(256-dw)/2,246-dh,dw,dh);return output.toDataURL('image/png');
 }).catch(()=>{cc128DisplayFrames.delete(key);return '';});
 cc128DisplayFrames.set(key,promise);while(cc128DisplayFrames.size>96)cc128DisplayFrames.delete(cc128DisplayFrames.keys().next().value);return promise;
}

function cc128Sprite(node,character,frame=0){
 node.dataset.character=character.id;node.dataset.frame=String(frame);
 cc128DisplayFrame(character,frame).then(url=>{if(url&&node.dataset.character===character.id&&node.dataset.frame===String(frame)){node.style.backgroundImage=`url("${url}")`;node.style.backgroundSize='100% 100%';node.style.backgroundPosition='center';}});
}
function cc128LocalVoices(){try{return (window.speechSynthesis?.getVoices()||[]).filter(voice=>voice.localService===true);}catch{return [];}}
const CC128_ACTIONS={
 idle:{frame:0,priority:0,duration:0,motion:'idle'},
 saved:{frame:2,priority:2,duration:2200,motion:'nod',sound:'good',prop:'check'},
 submitted:{frame:1,priority:3,duration:3000,motion:'hop',sound:'submit',prop:'plane'},
 approved:{frame:2,priority:3,duration:2900,motion:'proud',sound:'approved',prop:'badge'},
 rejected:{frame:3,priority:3,duration:3200,motion:'sad',sound:'sad',prop:'tears'},
 removed:{frame:3,priority:3,duration:2300,motion:'sad',sound:'sad',prop:'tears'},
 joined:{frame:1,priority:5,duration:4600,motion:'dance',sound:'party',prop:'fireworks'},
 joinfail:{frame:3,priority:4,duration:3600,motion:'sad',sound:'sad',prop:'tears'},
 selected:{frame:1,priority:3,duration:2800,motion:'hop',sound:'good',prop:'stars'},
 error:{frame:4,priority:5,duration:3400,motion:'panic',sound:'oops',prop:'question'},
 note:{frame:5,priority:2,duration:2900,motion:'write',sound:'pencil',prop:'notepad'},
 typing:{frame:5,priority:1,duration:1200,motion:'write',prop:'notepad'},
 notification:{frame:6,priority:1,duration:4200,motion:'read',sound:'notice',prop:'message'},
 task:{frame:6,priority:2,duration:2300,motion:'nod',sound:'good',prop:'clock'},
 taskdone:{frame:2,priority:3,duration:2600,motion:'proud',sound:'approved',prop:'check'},
 interview:{frame:6,priority:2,duration:2600,motion:'read',sound:'notice',prop:'clock'},
 push:{frame:2,priority:4,duration:1600,motion:'push',sound:'whoosh',prop:'push'},
 pull:{frame:4,priority:4,duration:1800,motion:'pull',sound:'pull',prop:'rope'},
 wave:{frame:0,priority:0,duration:1800,motion:'wave',sound:'hello',text:'Hey there! Ready when you are.'},
 laugh:{frame:1,priority:0,duration:2300,motion:'laugh',sound:'laugh',text:'Ha! You found my funny side.'},
 dance:{frame:1,priority:0,duration:2800,motion:'dance',sound:'party',text:'A tiny office dance break!'},
 spin:{frame:2,priority:0,duration:1900,motion:'spin',sound:'whoosh',text:'One little victory spin!'},
 stretch:{frame:0,priority:0,duration:2100,motion:'stretch',text:'Stretch. Breathe. Next profile!'},
 peek:{frame:6,priority:0,duration:1800,motion:'peek',text:'Just checking on you!'},
 coffee:{frame:0,priority:0,duration:2300,motion:'nod',prop:'coffee',text:'A pretend coffee break. I am still here!'},
 sleepy:{frame:0,priority:0,duration:2600,motion:'sleep',prop:'sleep',text:'Resting my eyes. Still listening!'},
 sneeze:{frame:4,priority:0,duration:1600,motion:'sneeze',sound:'sneeze',text:'Achoo! Too much paperwork!'},
 annoyed:{frame:4,priority:1,duration:2400,motion:'annoyed',sound:'oops',text:'Okay, okay! I am working here!'},
 thinking:{frame:6,priority:0,duration:1800,motion:'think',prop:'question',text:'Hmm. Thinking tiny thoughts.'},
 clap:{frame:2,priority:0,duration:2000,motion:'clap',sound:'good',prop:'stars',text:'A round of applause for you!'},
};
const CC128_PREVIEWS=[['saved','Save profile'],['submitted','Submit profile'],['approved','Approved'],['rejected','Rejected'],['joined','Joining + fireworks'],['joinfail','Joining failed'],['note','Write a note'],['error','Save issue'],['notification','Read notification'],['push','Push away'],['pull','Undo + rope'],['dance','Dance'],['laugh','Laugh'],['annoyed','Annoyed'],['sneeze','Sneeze'],['coffee','Coffee']];
const CC128_STYLE=`
:host{font:12px/1.4 "Segoe UI",Arial,sans-serif;color:#1f3156;box-sizing:border-box;contain:style}:host([hidden]){display:none!important}*{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer}button:focus-visible{outline:3px solid #198dff;outline-offset:3px}
.stage{position:relative;width:100%;height:100%;pointer-events:none}.actor{position:absolute;inset:0;width:100%;height:100%;border:0;padding:0;background:none;touch-action:none;cursor:grab;pointer-events:auto;filter:drop-shadow(0 5px 5px #143b6b27)}.actor:active{cursor:grabbing}.rig{position:absolute;inset:0;transform-origin:50% 85%;will-change:transform}.sprite{position:absolute;inset:0;background-repeat:no-repeat;transition:opacity .13s ease;backface-visibility:hidden}.sprite.old{opacity:0}.cc129-puppet{position:absolute;inset:-2%;width:104%;height:104%;pointer-events:none}.has-puppet .sprite{visibility:hidden}.stage[data-kind=idle] .has-puppet{animation:none}.stage[data-kind=idle] .rig{animation:cc128-breathe 4s ease-in-out infinite}.stage[data-kind=typing] .rig,.stage[data-kind=note] .rig{animation:cc128-write .34s ease-in-out 8 alternate}
.bubble{position:fixed;max-width:min(250px,calc(100vw - 24px));width:max-content;padding:9px 12px;border-radius:14px 14px 5px 14px;background:linear-gradient(130deg,#0868e7,#5b2eea);border:1px solid #8db7ff;box-shadow:0 6px 22px #153e782b;color:white;font-size:12px;font-weight:650;line-height:1.45;pointer-events:auto;overflow-wrap:anywhere;z-index:3}.bubble[hidden]{display:none}.bubble .close-bubble{float:right;border:0;background:transparent;color:#fff;font-size:15px;padding:0 0 0 8px}.bubble p{margin:0}.toolbar{position:absolute;top:100%;left:50%;display:flex;transform:translateX(-50%);gap:4px;opacity:0;transition:opacity .16s;pointer-events:auto;white-space:nowrap}.stage:hover .toolbar,.stage:focus-within .toolbar{opacity:1}.toolbar button{display:grid;place-items:center;border:1px solid #bbd4ff;color:#215cae;background:#fff;border-radius:9px;width:27px;height:25px;padding:3px;box-shadow:0 3px 9px #173e6820}.toolbar svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.prop{position:absolute;inset:-12%;pointer-events:none}.prop svg{width:100%;height:100%;overflow:visible}.prop .notepad{animation:cc128-notes 1.1s ease-in-out infinite}.prop .plane{animation:cc128-plane 1.8s ease-in-out both}.prop .tear{animation:cc128-tear .95s ease-in infinite}.prop .tear:nth-child(2){animation-delay:.4s}.prop .glow-star{animation:cc128-star .8s ease-in-out 3 alternate}.prop .question{animation:cc128-question .4s ease-in-out 5 alternate}.prop .zzz{animation:cc128-zzz 1.8s ease-out infinite}.rope{position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;overflow:visible;z-index:1}.rope line{stroke:#bc7b2c;stroke-width:3;stroke-linecap:round;stroke-dasharray:6 3;filter:drop-shadow(0 1px 0 #fff);animation:cc128-rope .2s linear 7}.rope .rope-glow{stroke:#ffe1a0;stroke-width:6;opacity:.5}.effects{position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2}.loading-art{position:absolute;bottom:7px;left:0;right:0;text-align:center;color:#21578e;background:#ffffffd9;border-radius:8px;font-size:10px;pointer-events:none}
.settings{padding:14px;color:#173451;background:linear-gradient(135deg,#fff,#edf8ff);border:1px solid #c7daf2;border-radius:16px}.settings h2{margin:0;font-size:21px;font-weight:800;color:#154185}.settings p{margin:4px 0 12px;color:#5b6c85}.settings .top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.saved-pill{background:#e5f9ed;color:#167a42;border:1px solid #b4e7c6;border-radius:20px;padding:4px 9px;font-size:11px;font-weight:700}.toggles{display:flex;flex-wrap:wrap;gap:8px 20px;padding:10px 0}.toggle{display:flex;gap:7px;align-items:center;font-size:12px;font-weight:600}.toggle input{accent-color:#206ce0;width:16px;height:16px}.controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;padding:10px 0}.control{display:flex;flex-direction:column;gap:5px;min-width:0}.control span{font-size:12px;font-weight:650}.control input{width:100%;accent-color:#236fe3}.control select{width:100%;border:1px solid #becfe6;border-radius:8px;padding:7px;background:white;color:#24496c}.fine{font-size:11px!important;color:#65758b!important}.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px;max-height:520px;overflow:auto;overscroll-behavior:contain;padding:6px 3px}.choice{min-width:0;border:1px solid #d2e0f0;border-radius:13px;padding:5px;background:linear-gradient(145deg,#fff,#edf5ff);color:#244b77;transition:transform .14s,border-color .14s;position:relative}.choice:hover{transform:translateY(-2px);border-color:#327cea}.choice[aria-pressed=true]{border:2px solid #3179ee;box-shadow:0 0 0 3px #3179ee19;background:linear-gradient(145deg,#dff3ff,#e9e2ff)}.choice .thumb{position:relative;display:block;width:100%;aspect-ratio:1;max-width:115px;margin:auto;background-repeat:no-repeat}.choice b{display:block;font-size:11px;line-height:1.3;min-height:27px}.choice .chosen{position:absolute;right:5px;top:4px;background:#2368df;color:white;padding:1px 5px;border-radius:10px;font-size:9px}.section-label{font-size:14px;font-weight:750;margin:18px 0 7px;color:#214776}.preview-grid{display:flex;flex-wrap:wrap;gap:6px}.preview-grid button,.minor-actions button{border:1px solid #bfd1ed;border-radius:8px;background:white;color:#225da7;padding:6px 9px;font-size:11px;font-weight:650}.preview-grid button:hover{background:#e9f3ff;border-color:#2877e4}.minor-actions{display:flex;gap:7px;flex-wrap:wrap;margin:10px 0}.preview-note{margin:6px 0;font-size:11px;color:#60718a}.status{min-height:18px;font-size:11px;font-weight:650;color:#17754a;padding-top:8px}
@keyframes cc128-breathe{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-2px) scale(1.012,.99)}}@keyframes cc128-write{from{transform:rotate(-1deg) translateY(0)}to{transform:rotate(1deg) translateY(1px)}}@keyframes cc128-notes{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}@keyframes cc128-plane{0%{transform:translate(-20px,30px) scale(.4);opacity:0}20%{opacity:1}100%{transform:translate(90px,-90px) rotate(-20deg);opacity:0}}@keyframes cc128-tear{0%{transform:translateY(-4px);opacity:0}20%{opacity:1}100%{transform:translateY(25px);opacity:0}}@keyframes cc128-star{from{opacity:.45;transform:scale(.8)}to{opacity:1;transform:scale(1.15)}}@keyframes cc128-question{from{transform:rotate(-9deg)}to{transform:rotate(9deg)}}@keyframes cc128-zzz{0%{opacity:0;transform:translateY(6px)}30%{opacity:1}100%{opacity:0;transform:translateY(-15px)}}@keyframes cc128-rope{to{stroke-dashoffset:-18}}
:host(.quiet) *,:host(.paused) *{animation:none!important;transition:none!important}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}}@media(max-width:550px){.settings{padding:10px}.gallery{grid-template-columns:repeat(3,minmax(0,1fr));max-height:430px}.choice .thumb{max-width:90px}.settings h2{font-size:18px}}
`;
function cc128Prop(kind){
 const colors='<defs><linearGradient id="cg" x2=".9" y2="1"><stop stop-color="#8cffac"/><stop offset="1" stop-color="#078954"/></linearGradient><linearGradient id="cp" x2="1" y2="1"><stop stop-color="#80dfff"/><stop offset="1" stop-color="#3659ef"/></linearGradient></defs>';
 let drawing='';
 if(['check','badge'].includes(kind))drawing='<g class="glow-star"><circle cx="91" cy="24" r="13" fill="url(#cg)" stroke="#fff" stroke-width="2"/><path d="m84 24 5 5 10-12" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g>';
 if(kind==='plane')drawing='<g class="plane"><path d="m44 51 28-11-8 27-7-10-13-6Z" fill="url(#cp)" stroke="#fff" stroke-width="1.5"/><path d="m57 57 15-17" stroke="#d5edff" stroke-width="1.5"/></g>';
 if(kind==='tears')drawing='<g fill="#54ccff" stroke="#e6faff" stroke-width=".6"><path class="tear" d="M23 43q-7 10 0 11 7-1 0-11Z"/><path class="tear" d="M94 44q-7 10 0 11 7-1 0-11Z"/></g>';
 if(kind==='notepad')drawing='<g class="notepad" transform="translate(89 77)"><rect width="24" height="30" rx="4" fill="#f8fcff" stroke="#4a82c5"/><path d="M5 9h13M5 15h9M5 21h14" stroke="#5595d2" stroke-width="2"/><path d="m16 25 11-17 3 2-11 17Z" fill="#ffc846" stroke="#9f6a19" stroke-width=".6"/></g>';
 if(kind==='question')drawing='<g class="question"><circle cx="99" cy="19" r="10" fill="#ffe267" stroke="#ffa528"/><text x="99" y="24" text-anchor="middle" font-size="17" font-weight="900" fill="#9e4712">?!</text></g>';
 if(kind==='message')drawing='<g class="glow-star"><rect x="85" y="8" width="26" height="19" rx="5" fill="url(#cp)" stroke="white"/><path d="m91 27 1 7 8-7" fill="#4a8ff9"/><path d="M91 15h14M91 20h10" stroke="white" stroke-width="2"/></g>';
 if(kind==='clock')drawing='<g class="glow-star"><circle cx="99" cy="20" r="12" fill="#fff4ce" stroke="#ee9b25" stroke-width="2"/><path d="M99 12v9l6 3" fill="none" stroke="#a55e15" stroke-width="2" stroke-linecap="round"/></g>';
 if(kind==='stars')drawing='<g class="glow-star" fill="#ffc81c" stroke="#fff"><path d="m21 14 3 7 8 1-6 5 1 8-6-4-7 4 2-8-6-5 8-1Z"/><path d="m101 30 2 5 6 1-5 3 1 6-4-3-5 3 1-6-4-3 6-1Z"/></g>';
 if(kind==='coffee')drawing='<g transform="translate(87 75)"><path d="M1 3h19v19q-9 8-18 0Z" fill="url(#cp)" stroke="#fff"/><path d="M20 7q14-1 9 10-2 4-9 2" fill="none" stroke="#5279c7" stroke-width="3"/><path d="M5 0q-6-7 0-10M13 0q-5-7 0-10" fill="none" stroke="#9eb4cb" stroke-width="1.5"/></g>';
 if(kind==='sleep')drawing='<g class="zzz" fill="#456bd4" font-size="17" font-weight="800"><text x="91" y="24">z</text><text x="103" y="12" font-size="12">z</text></g>';
 return drawing?'<svg viewBox="0 0 120 120" aria-hidden="true">'+colors+drawing+'</svg>':'';
}
function cc128KindForNotice(item){
 const meta=noticeMetadata(item),s=String(item.title||'')+' '+String(item.message||'');
 if(/not.joined|joining.failed|backout|did not join|didn.t join/i.test(s))return 'joinfail';
 if(/\bjoined\b|joining confirmed|new joining/i.test(s))return 'joined';
 if(/reject|removed|deleted/i.test(s))return 'rejected';
 if(/approved|approval granted/i.test(s))return 'approved';
 if(/submitted|submission received/i.test(s))return 'submitted';
 if(meta.note_id||meta.note_body||/added a note|note saved|updated note/i.test(s))return 'note';
 return 'notification';
}
function cc128Motion(name){
 const frames={
  nod:[{}, {transform:'translateY(4px) rotate(-3deg)',offset:.25},{transform:'translateY(-3px) rotate(3deg)',offset:.5},{}],
  hop:[{}, {transform:'scale(1.07,.9)',offset:.15},{transform:'translateY(-20px) rotate(-6deg) scale(.96,1.04)',offset:.4},{transform:'translateY(1px) rotate(4deg) scale(1.05,.95)',offset:.65},{}],
  proud:[{}, {transform:'translateY(-7px) rotate(-5deg) scale(1.04)',offset:.35},{transform:'translateY(-5px) rotate(4deg)',offset:.65},{}],
  sad:[{}, {transform:'translateY(4px) rotate(-4deg) scale(1,.97)',offset:.3},{transform:'translateY(5px) rotate(3deg)',offset:.6},{}],
  panic:[{},...Array.from({length:8},(_,i)=>({transform:`translateX(${i%2?-5:5}px) rotate(${i%2?5:-5}deg)`,offset:(i+1)/10})),{}],
  dance:[{},...Array.from({length:10},(_,i)=>({transform:`translate(${i%2?-7:7}px,${i%2?-9:-2}px) rotate(${i%2?-10:10}deg) scale(${i%2?'.98,1.03':'1.04,.96'})`,offset:(i+1)/12})),{}],
  laugh:[{},...Array.from({length:6},(_,i)=>({transform:`translateY(${i%2?2:-4}px) scale(${i%2?'1.04,.96':'.98,1.02'})`,offset:(i+1)/8})),{}],
  spin:[{}, {transform:'rotate(-12deg) scale(1.03)',offset:.15},{transform:'rotate(370deg) translateY(-8px)',offset:.75},{}],
  stretch:[{}, {transform:'scale(.94,1.09) translateY(-5px)',offset:.35},{transform:'scale(1.06,.95)',offset:.7},{}],
  peek:[{}, {transform:'translateX(-13px) rotate(-11deg)',offset:.3},{transform:'translateX(9px) rotate(9deg)',offset:.7},{}],
  sleep:[{}, {transform:'rotate(6deg) translateY(4px)',offset:.4},{transform:'rotate(-3deg) translateY(3px)',offset:.75},{}],
  sneeze:[{}, {transform:'rotate(-9deg) scale(.97,1.04)',offset:.4},{transform:'translateY(7px) rotate(12deg) scale(1.08,.9)',offset:.55},{}],
  annoyed:[{}, {transform:'rotate(-7deg) translateX(-3px)',offset:.25},{transform:'rotate(6deg) translateX(3px)',offset:.5},{transform:'rotate(-4deg)',offset:.75},{}],
  wave:[{}, {transform:'rotate(-7deg)',offset:.2},{transform:'rotate(8deg) translateY(-5px)',offset:.45},{transform:'rotate(-5deg)',offset:.7},{}],
  clap:[{}, {transform:'scale(.96,1.03)',offset:.2},{transform:'scale(1.05,.97) translateY(-6px)',offset:.4},{transform:'scale(.96,1.03)',offset:.6},{}],
  read:[{}, {transform:'rotate(-3deg) translateY(-2px)',offset:.35},{transform:'rotate(2deg)',offset:.7},{}],
  think:[{}, {transform:'rotate(-7deg) translateY(-2px)',offset:.5},{}],
 };
 return frames[name]||frames.nod;
}
export function installCareerCompanion(user){
 const uid=String(user?.user_id||'');if(!uid||typeof document==='undefined')return()=>{};
 const existing=window.__CC128_COMPANION__;
 if(existing?.userId===uid)return existing.retain();
 existing?.destroy();
 let prefs=cc128ReadPrefs(uid),disposed=false,leases=0,destroyTimer,currentKind='idle',priority=0,busyUntil=0,character=cc129Character(prefs),activeSprite=0;
 let actionTimer,bubbleTimer,idleTimer,queueTimer,typingAt=0,taps=[],funIndex=0,queue=[],audioContext,ownedSpeech=null,armed=false,drag=null,motionAnimations=[],artRevision=0,effectFrame=0,ropeFrame=0;
 const notices=new Set(),seenEvents=new Set(),preloaded=new Map(),timers=new Set();
 const later=(fn,ms)=>{const id=setTimeout(()=>{timers.delete(id);if(!disposed)fn();},ms);timers.add(id);return id;};
 const host=cc128Element('div');host.id='cc128-companion';host.style.cssText='position:fixed;z-index:100970;pointer-events:none;';
 const shadow=host.attachShadow({mode:'open'}),style=cc128Element('style');style.textContent=CC128_STYLE;
 const stage=cc128Element('div','stage');stage.dataset.kind='idle';
 const actor=cc128Button('','Play with your companion',null,'actor'),rig=cc128Element('div','rig'),sprites=[cc128Element('div','sprite'),cc128Element('div','sprite old')],prop=cc128Element('div','prop'),loading=cc128Element('span','loading-art','Loading your companion…');
 rig.append(...sprites);actor.append(rig);stage.append(actor,prop,loading);
 const bubble=cc128Element('div','bubble');bubble.setAttribute('role','status');bubble.setAttribute('aria-live','polite');bubble.hidden=true;const bubbleText=cc128Element('p');bubble.append(cc128Button('×','Dismiss companion message',()=>{bubble.hidden=true;if(ownedSpeech)try{speechSynthesis.cancel();}catch{}ownedSpeech=null;} ,'close-bubble'),bubbleText);
 const canvas=cc128Element('canvas','effects');canvas.hidden=true;
 const rope=document.createElementNS('http://www.w3.org/2000/svg','svg');rope.classList.add('rope');rope.setAttribute('aria-hidden','true');rope.style.display='none';
 const toolbar=cc128Element('div','toolbar');
 const soundButton=cc128Button('','Mute companion',()=>{arm();cc128SavePrefs({sounds:!prefs.sounds,voice:!prefs.sounds},uid);});
 const settingsButton=cc128Button('','Open companion settings',()=>{window.dispatchEvent(new CustomEvent('cc128-open-companion-settings'));});
 const playButton=cc128Button('','Try another companion activity',()=>{arm();play();});
 playButton.innerHTML='<svg viewBox="0 0 24 24"><path d="m9 5 10 7-10 7Z"/></svg>';
 soundButton.innerHTML='<svg viewBox="0 0 24 24"><path d="m4 9 5 0 5-4v14l-5-4H4Z"/><path d="M18 8q5 4 0 8"/></svg>';
 settingsButton.innerHTML='<svg viewBox="0 0 24 24"><path d="m10 3 4 0 1 3 3 1 3 3-2 3 0 3-4 1-2 3-4-1-1-3-3-1-1-4 3-2 1-3Z"/><circle cx="12" cy="12" r="3"/></svg>';
 toolbar.append(playButton,soundButton,settingsButton);stage.append(toolbar);shadow.append(style,canvas,rope,stage,bubble);document.body.append(host);
 const live=()=>!disposed&&cc128Uid()===uid&&!/^\/(login|public)(\/|$)/.test(location.pathname);
 const reduced=()=>!prefs.motion||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 const puppet=cc129InstallPuppet(rig,()=>({enabled:prefs.enabled&&live(),motion:!reduced(),idle:prefs.idle,kind:currentKind}));
 const cancelMotion=()=>{motionAnimations.forEach(a=>a.cancel());motionAnimations=[];cancelAnimationFrame(effectFrame);cancelAnimationFrame(ropeFrame);canvas.hidden=true;rope.style.display='none';};
 function geometry(){const meta=CC128_ATLASES[character.atlas],height=prefs.size*(meta.height/5)/(meta.width/7),maxX=Math.max(0,innerWidth-prefs.size-24),maxY=Math.max(0,innerHeight-height-45);return {width:prefs.size,height,maxX,maxY};}
 function place(){const g=geometry();host.style.width=g.width+'px';host.style.height=g.height+'px';host.style.left=Math.round(12+prefs.x*g.maxX)+'px';host.style.top=Math.round(8+prefs.y*g.maxY)+'px';positionBubble();}
 function positionBubble(){if(bubble.hidden)return;const r=host.getBoundingClientRect(),width=Math.min(250,innerWidth-24),height=bubble.getBoundingClientRect().height||60;let x=Math.max(12,Math.min(innerWidth-width-12,r.left+r.width/2-width/2)),y=r.top-height-10;if(y<8)y=Math.min(innerHeight-height-8,r.bottom+29);bubble.style.left=Math.round(x)+'px';bubble.style.top=Math.round(Math.max(8,y))+'px';}
 function say(text,duration=3800){if(!text)return;bubbleText.textContent=String(text).slice(0,600);bubble.hidden=false;positionBubble();clearTimeout(bubbleTimer);bubbleTimer=later(()=>{bubble.hidden=true;},Math.max(duration,Math.min(10000,String(text).length*45)));}
 function primeArt(){if(character.id==='custom'){loading.hidden=true;return;}const meta=CC128_ATLASES[character.atlas],revision=++artRevision;loading.hidden=false;let image=preloaded.get(meta.src);if(!image){image=new Image();image.decoding='async';image.src=meta.src;preloaded.set(meta.src,image);}const done=()=>{if(revision===artRevision&&!disposed)loading.hidden=true;};if(image.complete&&image.naturalWidth)done();else{image.addEventListener('load',done,{once:true});image.addEventListener('error',()=>{if(revision===artRevision)loading.textContent='Artwork unavailable. Reload once.';},{once:true});}}
 function setPose(frame){puppet.pose(character,frame);const previous=activeSprite;activeSprite=1-activeSprite;cc128Sprite(sprites[activeSprite],character,frame);sprites[activeSprite].classList.remove('old');sprites[previous].classList.add('old');stage.dataset.frame=String(frame);}
 function arm(){if(armed||!live())return;armed=true;if(prefs.sounds&&prefs.volume>0){try{const Audio=window.AudioContext||window.webkitAudioContext;if(Audio){audioContext=new Audio();void audioContext.resume().catch(()=>{});}}catch{}}}
 function sound(kind){
  if(!armed||!prefs.sounds||prefs.volume<=0||document.hidden)return;
  try{if(!audioContext){const Audio=window.AudioContext||window.webkitAudioContext;if(Audio)audioContext=new Audio();}if(!audioContext)return;void audioContext.resume().catch(()=>{});
   const seq={good:[523,659,784],submit:[392,523,659,1047],approved:[659,784,988],party:[523,659,784,1047,784,1047,1319],sad:[392,330,262],oops:[660,440,880,330],pencil:[900,1350,1100],notice:[660,880],whoosh:[900,240],pull:[260,380,520],hello:[660,830],laugh:[440,620,460,660],sneeze:[220,880,180]}[kind]||[523,659];
   const start=audioContext.currentTime,step=kind==='party'?.085:kind==='pencil'?.045:.10;
   seq.forEach((frequency,i)=>{const oscillator=audioContext.createOscillator(),gain=audioContext.createGain(),at=start+i*step;oscillator.type=['whoosh','pull'].includes(kind)?'sine':'triangle';oscillator.frequency.setValueAtTime(frequency,at);oscillator.frequency.exponentialRampToValueAtTime(Math.max(80,frequency*(kind==='sad'?.83:kind==='laugh'?1.25:1.04)),at+step);gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(.09*prefs.volume/100,at+.012);gain.gain.exponentialRampToValueAtTime(.0001,at+step+.08);oscillator.connect(gain);gain.connect(audioContext.destination);oscillator.start(at);oscillator.stop(at+step+.09);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};});
  }catch{}
 }
 function speak(text){
  if(!armed||!prefs.voice||prefs.volume<=0||!text||document.hidden||!window.speechSynthesis)return;
  const voices=cc128LocalVoices();const cute=v=>/zira|heera|female|susan|aria|samantha|swara|karen|tessa/i.test(v.name||'');const voice=voices.find(v=>v.voiceURI===prefs.voiceURI)||voices.find(v=>/^en[-_]IN/i.test(v.lang)&&cute(v))||voices.find(v=>/^en/i.test(v.lang)&&cute(v))||voices.find(v=>/^en[-_]IN/i.test(v.lang))||voices.find(v=>/^en/i.test(v.lang))||voices[0];if(!voice)return;
  try{if(ownedSpeech)speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(String(text).replace(/https?:\/\/\S+/g,'link').slice(0,550));utterance.voice=voice;utterance.lang=voice.lang;utterance.volume=prefs.volume/100;utterance.rate=prefs.rate;const style=CC129_VOICES.find(v=>v[0]===prefs.voiceStyle)||CC129_VOICES[0];utterance.pitch=style[2];utterance.rate=Math.min(1.5,prefs.rate*style[3]);ownedSpeech=utterance;utterance.onend=utterance.onerror=()=>{if(ownedSpeech===utterance)ownedSpeech=null;};speechSynthesis.speak(utterance);}catch{}
 }
 function fireworks(){
  if(reduced()||document.hidden)return;cancelAnimationFrame(effectFrame);canvas.hidden=false;const dpr=Math.min(devicePixelRatio||1,2),w=300,h=260,r=host.getBoundingClientRect(),left=Math.max(0,Math.min(innerWidth-w,r.left+r.width/2-w/2)),top=Math.max(0,Math.min(innerHeight-h,r.top+r.height/2-h/2));canvas.width=w*dpr;canvas.height=h*dpr;canvas.style.cssText='left:'+left+'px;top:'+top+'px;width:'+w+'px;height:'+h+'px';const ctx=canvas.getContext('2d');if(!ctx)return;ctx.scale(dpr,dpr);const colors=['#ff4081','#13b9ff','#ffb900','#00c982','#9758ff'],particles=Array.from({length:48},(_,i)=>{const angle=i/12*Math.PI*2;return{x:w/2+(i%2?32:-32),y:h/2-25,vx:Math.cos(angle)*(35+Math.random()*35),vy:Math.sin(angle)*(35+Math.random()*35),color:colors[i%5],delay:Math.floor(i/12)*.14};});let start;
  const draw=now=>{if(disposed||document.hidden||reduced()){canvas.hidden=true;return;}start??=now;const t=(now-start)/1000;ctx.clearRect(0,0,w,h);for(const p of particles){const age=t-p.delay;if(age<0||age>1.2)continue;ctx.globalAlpha=Math.max(0,1-age/1.2);ctx.fillStyle=p.color;ctx.save();ctx.translate(p.x+p.vx*age,p.y+p.vy*age+45*age*age);ctx.rotate(age*4);ctx.fillRect(-2,-2,4,7);ctx.restore();}ctx.globalAlpha=1;if(t<1.9)effectFrame=requestAnimationFrame(draw);else{ctx.clearRect(0,0,w,h);canvas.hidden=true;}};effectFrame=requestAnimationFrame(draw);
 }
 function targetBox(target){if(target&&Number.isFinite(target.left))return target;const notice=document.querySelector('.cc120-work-notice-host:not([hidden])');const node=notice||document.querySelector('.cc730-direct-reminder-deck,.cc803-review-popup,#cc917-task-reminder');return node?.getBoundingClientRect()||{left:Math.max(0,innerWidth-290),top:Math.min(120,innerHeight/3),width:270,height:100};}
 function travel(kind,target){
  if(reduced()||drag)return;const from=host.getBoundingClientRect(),to=targetBox(target),dx=Math.max(-innerWidth,Math.min(innerWidth,to.left-from.left-prefs.size*.62)),dy=Math.max(-innerHeight,Math.min(innerHeight,to.top+to.height*.55-from.top));
  motionAnimations.push(stage.animate([{transform:'translate(0,0)'},{transform:`translate(${dx}px,${dy}px) rotate(-9deg)`,offset:.3},{transform:`translate(${dx+(kind==='push'?12:-18)}px,${dy}px) rotate(${kind==='push'?9:-12}deg)`,offset:.53},{transform:'translate(0,0)'}],{duration:kind==='pull'?1600:1400,easing:'cubic-bezier(.22,.7,.3,1)'}));
  if(kind==='pull'){
   rope.style.display='block';rope.innerHTML='<line class="rope-glow"/><line/>';const lines=rope.querySelectorAll('line');let start;
   const draw=now=>{if(disposed||document.hidden){rope.style.display='none';return;}start??=now;const t=(now-start)/1600,rect=stage.getBoundingClientRect(),endX=to.left+Math.min(35,to.width/3),endY=to.top+to.height/2;for(const line of lines){line.setAttribute('x1',String(rect.left+rect.width*.7));line.setAttribute('y1',String(rect.top+rect.height*.45));line.setAttribute('x2',String(endX));line.setAttribute('y2',String(endY));}if(t<.82)ropeFrame=requestAnimationFrame(draw);else rope.style.display='none';};ropeFrame=requestAnimationFrame(draw);
   const popup=document.querySelector('.cc120-work-notice-host:not([hidden])')?.shadowRoot?.querySelector('article')||document.querySelector('.cc730-direct-reminder-deck,.cc803-review-popup,#cc917-task-reminder');
   if(popup)motionAnimations.push(popup.animate([{transform:'translateX(-34px) rotate(-2deg)',opacity:.3},{transform:'translateX(6px)',opacity:1},{transform:'none',opacity:1}],{duration:500,easing:'ease-out'}));
  }
 }
 function idle(){if(disposed)return;currentKind='idle';priority=0;busyUntil=0;stage.dataset.kind='idle';stage.dataset.motion='idle';prop.innerHTML='';setPose(0);drain();}
 function drain(){clearTimeout(queueTimer);if(!queue.length||disposed)return;if(Date.now()<busyUntil){queueTimer=later(drain,busyUntil-Date.now()+15);return;}const next=queue.shift();react(next.kind,next.options);}
 function react(kind,options={}){
  if(!live()||!prefs.enabled||document.hidden)return false;
  const action=CC128_ACTIONS[kind]||CC128_ACTIONS.notification;
  const eventId=options.eventId;if(eventId&&seenEvents.has(eventId))return false;if(eventId){seenEvents.add(eventId);if(seenEvents.size>180)seenEvents.delete(seenEvents.values().next().value);}
  const incomingPriority=options.preview?6:options.source==='confirmed-write'&&kind!=='note'?5:action.priority;
  if(Date.now()<busyUntil&&priority>incomingPriority&&!options.immediate){if(options.source!=='idle'){queue=queue.filter(q=>q.kind!==kind).concat({kind,options:{...options,eventId:undefined}}).slice(-5);clearTimeout(queueTimer);queueTimer=later(drain,busyUntil-Date.now()+15);}return true;}
  clearTimeout(actionTimer);cancelMotion();currentKind=kind;priority=incomingPriority;busyUntil=Date.now()+action.duration;stage.dataset.kind=kind;stage.dataset.motion=action.motion;setPose(options.source==='idle'?0:action.frame);prop.innerHTML=cc128Prop(action.prop);
  const text=options.text||action.text;if(text&&!options.silent)say(text,action.duration);
  if(!options.silent){if(action.sound)sound(action.sound);if(options.speak!==false&&text)speak(text);}
  if(!reduced()){
   if(['push','pull'].includes(kind))travel(kind,options.target);
   else motionAnimations.push(rig.animate(cc128Motion(action.motion),{duration:Math.min(action.duration||1600,['dance','laugh','sad'].includes(action.motion)?2400:1500),easing:'cubic-bezier(.25,.65,.3,1)',iterations:1}));
   if(action.prop==='fireworks'||kind==='selected')fireworks();
  }
  actionTimer=later(idle,action.duration||1600);return true;
 }
 function play(){const now=Date.now();taps=taps.filter(at=>now-at<2600);taps.push(now);if(taps.length>=5){taps=[];react('annoyed',{preview:true});return;}const choices=['wave','laugh','dance','spin','peek','stretch','coffee','sneeze','thinking','clap','sleepy'];react(choices[funIndex++%choices.length],{preview:true});}
 function planIdle(){clearTimeout(idleTimer);if(disposed||!prefs.idle)return;idleTimer=later(()=>{if(live()&&!document.hidden&&prefs.enabled&&Date.now()>busyUntil&&!drag){const choices=['peek','stretch','coffee','wave','dance','thinking','laugh'];react(choices[Math.floor(Math.random()*choices.length)],{silent:true,source:'idle'});}planIdle();},4500+Math.round(Math.random()*4500));}
 function notify(item){if(document.hidden||!getPollingLeaderSnapshot()?.isLeader||!item?.notification_id||String(item.user_id)!==uid||notices.has(String(item.notification_id)))return;notices.add(String(item.notification_id));if(notices.size>180)notices.delete(notices.values().next().value);const text=[item.title,item.message].filter(Boolean).join('. ').slice(0,550);react(cc128KindForNotice(item),{text,speak:prefs.readNotifications,eventId:'notice:'+item.notification_id,source:'notice'});}
 function sync(){if(!live())return;const previous=prefs.character,previousVariant=prefs.customVariant;prefs=cc128ReadPrefs(uid);character=cc129Character(prefs);host.hidden=!prefs.enabled||document.hidden;host.classList.toggle('quiet',reduced());soundButton.title=prefs.sounds?'Mute companion':'Unmute companion';soundButton.setAttribute('aria-label',soundButton.title);actor.setAttribute('aria-label',`${character.id} ${character.name} companion. Drag to move or click to play.`);actor.title='Drag anywhere · click for a funny activity';if(previous!==prefs.character||previousVariant!==prefs.customVariant){cancelMotion();queue=[];clearTimeout(actionTimer);setPose(0);stage.dataset.kind='idle';currentKind='idle';priority=0;busyUntil=0;primeArt();}if(!prefs.voice||!prefs.enabled||prefs.volume<=0){if(ownedSpeech)try{speechSynthesis.cancel();}catch{}ownedSpeech=null;}if(!prefs.enabled){cancelMotion();queue=[];bubble.hidden=true;clearTimeout(actionTimer);currentKind='idle';busyUntil=0;priority=0;stage.dataset.kind='idle';setPose(0);}place();puppet.wake();planIdle();}
 const onSettings=event=>{if(event.detail?.uid===uid)sync();};
 const onStorage=event=>{if(!event.key||event.key===cc128PrefKey(uid))sync();};
 const onEvent=event=>{const detail=event.detail||{};if(detail.principal&&detail.principal!==accountPrincipal())return;if(detail.user_id&&String(detail.user_id)!==uid)return;react(detail.kind,detail);};
 const onNotice=event=>notify(event.detail);
 const onFailure=event=>{if(event.detail?.principal&&event.detail.principal!==accountPrincipal())return;react('error',{text:'Oops! Please check the highlighted fields and try again.',eventId:'error:'+event.detail?.id,source:'failure'});};
 const onInput=event=>{const node=event.target;if(!(node instanceof Element)||node.tagName!=='TEXTAREA')return;const context=[node.name,node.id,node.placeholder,node.closest('[data-field]')?.dataset.field,node.closest('.notes-chat,.cc803-review-popup')?.className].join(' ');if(!/note|reply|review/i.test(context)||Date.now()-typingAt<900)return;typingAt=Date.now();react('typing',{silent:true,source:'input'});};
 const onClose=event=>{const path=event.composedPath(),button=path.find(node=>node instanceof HTMLButtonElement);if(!button||path.includes(host))return;const popup=button.closest('.cc730-direct-reminder-deck,.cc803-review-popup,#cc917-task-reminder,.cc388-reminder-deck,.cc391-reminder-deck');if(!popup)return;const label=[button.textContent,button.getAttribute('aria-label'),button.title].join(' ');if(!/^\s*[×✕x]\s*$/.test(button.textContent||'')&&!/dismiss|close popup|hide reminder/i.test(label))return;const r=popup.getBoundingClientRect();react('push',{text:'Out of the way!',target:{left:r.left,top:r.top,width:r.width,height:r.height},speak:false,immediate:true,source:'close'});};
 const onVisibility=()=>{host.hidden=document.hidden||!prefs.enabled;host.classList.toggle('paused',document.hidden);if(document.hidden){cancelMotion();queue=[];clearTimeout(actionTimer);clearTimeout(idleTimer);if(ownedSpeech)try{speechSynthesis.cancel();}catch{}ownedSpeech=null;}else{idle();place();puppet.wake();planIdle();}};
 const onResize=()=>{cancelMotion();place();};
 const onAuth=()=>destroy();
 const onScope=()=>{queue=[];cancelMotion();clearTimeout(actionTimer);clearTimeout(queueTimer);bubble.hidden=true;if(ownedSpeech)try{speechSynthesis.cancel();}catch{}ownedSpeech=null;idle();};
 const onAccount=()=>{if(cc128Uid()!==uid)destroy();else onScope();};
 const onUnlockAudio=()=>arm();
 const onHover=()=>{if(live()&&prefs.motion&&Date.now()>busyUntil&&!drag)react('peek',{silent:true,source:'idle'});};
 actor.onpointerenter=onHover;
 actor.onpointerdown=event=>{if(event.button!==0||!live())return;arm();event.preventDefault();cancelMotion();const r=host.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:r.left,top:r.top,moved:false};actor.setPointerCapture(event.pointerId);};
 actor.onpointermove=event=>{if(!drag||event.pointerId!==drag.id)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)>4)drag.moved=true;if(!drag.moved)return;const g=geometry(),left=Math.max(12,Math.min(12+g.maxX,drag.left+dx)),top=Math.max(8,Math.min(8+g.maxY,drag.top+dy));host.style.left=left+'px';host.style.top=top+'px';prefs.x=g.maxX?(left-12)/g.maxX:0;prefs.y=g.maxY?(top-8)/g.maxY:0;positionBubble();};
 const endDrag=event=>{if(!drag||event.pointerId!==drag.id)return;const moved=drag.moved;drag=null;try{actor.releasePointerCapture(event.pointerId);}catch{}if(moved)cc128SavePrefs({x:prefs.x,y:prefs.y},uid);else if(event.type!=='pointercancel')play();};actor.onpointerup=endDrag;actor.onpointercancel=endDrag;actor.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();arm();play();}};
 const listeners=[['cc128-companion-settings',onSettings],['storage',onStorage],['cc128-companion-event',onEvent],['career-crox-notification',onNotice],['cc927-write-failed',onFailure],['resize',onResize],['career-crox-auth-expired',onAuth],['career-crox-account-changed',onAccount],['cc875-dashboard-changed',onScope],['career-crox-access-changed',onScope]];
 listeners.forEach(([name,fn])=>window.addEventListener(name,fn));document.addEventListener('input',onInput,true);document.addEventListener('click',onClose,true);document.addEventListener('visibilitychange',onVisibility);window.addEventListener('pointerdown',onUnlockAudio,{capture:true,passive:true});window.addEventListener('keydown',onUnlockAudio,true);
 function destroy(){if(disposed)return;disposed=true;puppet.destroy();cancelMotion();for(const timer of timers)clearTimeout(timer);for(const timer of [destroyTimer,actionTimer,bubbleTimer,idleTimer,queueTimer])clearTimeout(timer);listeners.forEach(([name,fn])=>window.removeEventListener(name,fn));document.removeEventListener('input',onInput,true);document.removeEventListener('click',onClose,true);document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('pointerdown',onUnlockAudio,true);window.removeEventListener('keydown',onUnlockAudio,true);if(ownedSpeech)try{speechSynthesis.cancel();}catch{}if(audioContext)void audioContext.close().catch(()=>{});host.remove();if(window.__CC128_COMPANION__?.userId===uid)delete window.__CC128_COMPANION__;}
 const controller={userId:uid,react,notify,destroy,preferences:()=>({...prefs}),state:()=>({kind:currentKind,character:character.id,queued:queue.length,enabled:prefs.enabled,armed,localVoices:cc128LocalVoices().length}),preview:kind=>{arm();react(kind,{preview:true,text:({saved:'Profile saved. Nice work!',submitted:'Profile submitted! Great work!',approved:'Approved! Nicely done.',rejected:'Rejected this time. We will try again.',joined:'A new joining! Time to celebrate!',joinfail:'Joining did not work out. We will try again.',note:'Note saved. I have written it down!',error:'Oops! Please check the highlighted fields.',notification:'New work update. Your companion is ready to read it.',push:'Out of the way!',pull:'Here it is! Brought it back.'})[kind]});},retain(){clearTimeout(destroyTimer);leases++;let ended=false;return()=>{if(ended)return;ended=true;leases--;if(leases<=0)destroyTimer=setTimeout(destroy,500);};}};
 window.__CC128_COMPANION__=controller;
 cc128Sprite(sprites[0],character,0);cc128Sprite(sprites[1],character,0);primeArt();sync();setPose(0);
 try{if(sessionStorage.getItem('cc129-welcome')==='1'){sessionStorage.removeItem('cc129-welcome');later(()=>{arm();react('wave',{preview:true,text:'Welcome back, '+String(user.full_name||user.username||'friend').split(' ')[0]+'! Ready for a brilliant day?'});},650);}}catch{}
 return controller.retain();
}
export function mountCompanionSettings(container,user){
 if(!container||!user?.user_id)return()=>{};const uid=String(user.user_id),host=cc128Element('div');host.className='cc128-companion-settings';container.append(host);const shadow=host.attachShadow({mode:'open'}),style=cc128Element('style');style.textContent=CC128_STYLE;const panel=cc128Element('div','settings');shadow.append(style,panel);let disposed=false;
 const update=patch=>cc128SavePrefs(patch,uid);
 const heading=cc128Element('div','top'),title=cc128Element('div');title.append(cc128Element('h2','','Your AI Companion'),cc128Element('p','','40 friends. Your personal office sidekick.'));heading.append(title,cc128Element('span','saved-pill','Auto saved for you'));panel.append(heading);
 const toggles=cc128Element('div','toggles'),checkboxes={};
 for(const [key,label]of [['enabled','Show companion'],['sounds','Funny sounds'],['voice','Voice'],['readNotifications','Read my notifications'],['idle','Idle activities'],['motion','Smooth animation']]){const wrap=cc128Element('label','toggle'),input=cc128Element('input');input.type='checkbox';input.setAttribute('aria-label',label);input.onchange=()=>update({[key]:input.checked});wrap.append(input,document.createTextNode(label));toggles.append(wrap);checkboxes[key]=input;}panel.append(toggles);
 const controls=cc128Element('div','controls'),ranges={};
 for(const [key,label,min,max,step,unit]of [['size','Companion size',64,180,2,'px'],['volume','Companion volume',0,100,1,'%'],['rate','Reading speed',.75,1.35,.05,'×']]){const wrap=cc128Element('label','control'),caption=cc128Element('span'),input=cc128Element('input');input.type='range';input.min=min;input.max=max;input.step=step;input.setAttribute('aria-label',label);input.oninput=()=>update({[key]:Number(input.value)});wrap.append(caption,input);controls.append(wrap);ranges[key]={caption,input,label,unit};}
 const voiceWrap=cc128Element('label','control'),voiceLabel=cc128Element('span','','Notification voice'),voiceSelect=cc128Element('select');voiceSelect.setAttribute('aria-label','Notification voice');voiceSelect.onchange=()=>update({voiceURI:voiceSelect.value});voiceWrap.append(voiceLabel,voiceSelect);controls.append(voiceWrap);panel.append(controls);
 const voiceStyleWrap=cc128Element('label','control'),voiceStyleSelect=cc128Element('select');voiceStyleSelect.setAttribute('aria-label','Voice personality');for(const [key,label]of CC129_VOICES){const option=cc128Element('option','',label);option.value=key;voiceStyleSelect.append(option);}voiceStyleSelect.onchange=()=>update({voiceStyle:voiceStyleSelect.value});voiceStyleWrap.append(cc128Element('span','','Voice personality'),voiceStyleSelect);controls.append(voiceStyleWrap);
 const voiceHint=cc128Element('p','fine');panel.append(voiceHint,cc128Element('p','fine','Preferences stay with your account on this computer. Drag the character anytime to move it.'));
 const minor=cc128Element('div','minor-actions');minor.append(cc128Button('Hide companion','Hide companion from workspace',()=>update({enabled:false})),cc128Button('Test voice','Test companion voice',()=>{window.__CC128_COMPANION__?.preview('notification');}),cc128Button('Reset position','Reset companion position',()=>update({x:1,y:.88})),cc128Button('Restore default 07','Restore default companion',()=>update({...CC128_DEFAULTS})));panel.append(minor);
 panel.append(cc128Element('h3','section-label','Choose your character'));
 const gallery=cc128Element('div','gallery');gallery.setAttribute('aria-label','40 companion characters');const choices=[];
 for(const character of CC128_CHARACTERS){const button=cc128Button('',`Choose ${character.id} ${character.name}`,()=>{update({character:character.id,enabled:true});window.__CC128_COMPANION__?.react('wave',{preview:true,text:'Your new companion is ready!'});},'choice');button.setAttribute('aria-pressed','false');const thumb=cc128Element('span','thumb');thumb.setAttribute('aria-hidden','true');cc128Sprite(thumb,character,0);const label=cc128Element('b','',character.id+' · '+character.name),chosen=cc128Element('span','chosen','✓');chosen.hidden=true;button.append(thumb,label,chosen);gallery.append(button);choices.push({button,chosen,id:character.id});}panel.append(gallery);
 panel.append(cc128Element('h3','section-label','Try the reactions'),cc128Element('p','preview-note','Previews only. These buttons do not change any CRM record.'));
 const previews=cc128Element('div','preview-grid');for(const [kind,label]of CC128_PREVIEWS)previews.append(cc128Button(label,'Preview '+label,()=>window.__CC128_COMPANION__?.preview(kind)));panel.append(previews);
 const stopStudio=cc129PhotoStudio(panel,uid,update);
 const status=cc128Element('div','status');status.setAttribute('role','status');panel.append(status);
 function refresh(){if(disposed)return;const p=cc128ReadPrefs(uid);voiceStyleSelect.value=p.voiceStyle;for(const [key,input]of Object.entries(checkboxes))input.checked=p[key];for(const [key,r]of Object.entries(ranges)){r.input.value=p[key];r.caption.textContent=r.label+' · '+p[key]+r.unit;}for(const choice of choices){const selected=choice.id===p.character;choice.button.setAttribute('aria-pressed',String(selected));choice.chosen.hidden=!selected;}const voices=cc128LocalVoices();voiceSelect.replaceChildren();const auto=cc128Element('option','','Automatic local voice');auto.value='';voiceSelect.append(auto);for(const voice of voices){const option=cc128Element('option','',voice.name+' · '+voice.lang);option.value=voice.voiceURI;voiceSelect.append(option);}voiceSelect.value=p.voiceURI;voiceHint.textContent=voices.length?'Uses voices installed on this computer. Sound starts after your first click.':'No local reading voice is available in this browser yet. Install a system voice to hear notifications; funny sounds and captions still work.';status.textContent='Selected: '+cc129Character(p)?.name+' · saved';}
 const changed=event=>{if(!event.detail?.uid||event.detail.uid===uid)refresh();};window.addEventListener('cc128-companion-settings',changed);window.addEventListener('storage',refresh);window.speechSynthesis?.addEventListener('voiceschanged',refresh);refresh();
 return()=>{disposed=true;stopStudio();window.removeEventListener('cc128-companion-settings',changed);window.removeEventListener('storage',refresh);window.speechSynthesis?.removeEventListener('voiceschanged',refresh);host.remove();};
}


// CC129: personal images live only in the account's browser IndexedDB.
const CC129_VOICES=[['spark','Tiny Spark',1.72,1.06],['pip','Sunny Pip',1.55,1.1],['soft','Soft Buddy',1.38,.95],['chip','Cheeky Chip',1.88,1.13],['cheer','Cheer Captain',1.48,1.03],['calm','Calm Coach',1.18,.96]];
function cc129Character(p){return p.character==='custom'?{id:'custom',name:'Your photo companion',atlas:1,row:1}:CC128_CHARACTERS.find(c=>c.id===p.character)||CC128_CHARACTERS[6];}
let cc129Db;
function cc129Database(){if(!cc129Db)cc129Db=new Promise((resolve,reject)=>{const r=indexedDB.open('cc129-personal-companions',1);r.onupgradeneeded=()=>r.result.createObjectStore('characters');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('Local image storage is unavailable.'));});return cc129Db;}
async function cc129ImageStore(uid,value){const db=await cc129Database();return new Promise((resolve,reject)=>{const tx=db.transaction('characters',value===undefined?'readonly':'readwrite'),store=tx.objectStore('characters'),r=value===undefined?store.get(uid):value===null?store.delete(uid):store.put(value,uid);let result;r.onsuccess=()=>result=r.result;tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(Error('Could not save your personal character. Check browser storage.'));});}
async function cc129CustomFrame(uid=cc128Uid()){try{const record=await cc129ImageStore(uid),p=cc128ReadPrefs(uid);return record?.images?.[p.customVariant]||'';}catch{return '';}}
function cc129LoadImage(src){return new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('Choose a valid PNG, JPEG or WebP photo.'));i.src=src;});}

// Continuous 30fps mesh deformation paints only a small character canvas.
function cc129InstallPuppet(rig,getState){
 const canvas=document.createElement('canvas');canvas.className='cc129-puppet';canvas.width=canvas.height=384;canvas.setAttribute('aria-hidden','true');rig.append(canvas);const ctx=canvas.getContext('2d');let disposed=false,frame=0,last=0,revision=0,current=null,prior=null,blendAt=0,frames=0,nextBeat=0,turn=0,targetTurn=0,lean=0,targetLean=0,phase=Math.random()*99;
 function image(img,alpha,t,state){if(!img||alpha<=0)return;ctx.save();ctx.globalAlpha=alpha;ctx.translate(192,202);const energy=/dance|joined|submitted|laugh|wave/.test(state.kind)?1.6:1,b=Math.sin(t*2.3+phase);ctx.rotate((lean*.022+Math.sin(t*1.43+phase)*.017)*energy);ctx.scale(1+b*.008,1-b*.009);ctx.translate(-192,-202+Math.sin(t*1.9+phase)*2.2);const size=346,x=19,y=14;
  for(let sy=0;sy<256;sy+=4){const h=Math.min(4,256-sy),v=sy/256,head=1/(1+Math.exp((v-.53)*18)),wobble=Math.sin(t*(state.kind==='idle'?1.8:3.1)+v*4+phase)*Math.sin(v*Math.PI)*1.6,shift=(turn*head*4+wobble)*energy,scale=1-Math.abs(turn)*head*.018;ctx.drawImage(img,0,img.naturalHeight*sy/256,img.naturalWidth,img.naturalHeight*h/256,x+shift+(size-size*scale)/2,y+sy*size/256,size*scale,h*size/256+.7);}ctx.restore();
 }
 function tick(now){frame=0;if(disposed)return;const state=getState();if(!state.enabled||!state.motion||!state.idle||document.hidden){canvas.hidden=true;rig.classList.remove('has-puppet');return;}frame=requestAnimationFrame(tick);if(now-last<33)return;last=now;if(now>nextBeat){nextBeat=now+2500+Math.random()*4200;targetTurn=(Math.random()-.5)*2;targetLean=(Math.random()-.5)*2;}turn+=(targetTurn-turn)*.025;lean+=(targetLean-lean)*.02;ctx.clearRect(0,0,384,384);const mix=current?Math.min(1,(now-blendAt)/340):0;image(prior,1-mix,now/1000,state);image(current,mix,now/1000,state);if(current){canvas.hidden=false;rig.classList.add('has-puppet');canvas.dataset.frames=String(++frames);canvas.dataset.mode='continuous';}}
 function wake(){if(disposed)return;const s=getState();if(!s.motion||!s.idle||!s.enabled){cancelAnimationFrame(frame);frame=0;canvas.hidden=true;rig.classList.remove('has-puppet');return;}if(!frame)frame=requestAnimationFrame(tick);}
 async function pose(character,number){const ticket=++revision;try{const src=await (character.id==='custom'?cc129CustomFrame():cc128DisplayFrame(character,number));if(disposed||ticket!==revision||!src)return;const img=await cc129LoadImage(src);if(disposed||ticket!==revision)return;prior=current||img;current=img;blendAt=performance.now();wake();}catch{}}
 const media=window.matchMedia('(prefers-reduced-motion: reduce)');media.addEventListener?.('change',wake);return{pose,wake,destroy(){disposed=true;revision++;media.removeEventListener?.('change',wake);cancelAnimationFrame(frame);canvas.remove();rig.classList.remove('has-puppet');}};
}
async function cc129PhotoStyles(src){const img=await cc129LoadImage(src),outputs=[],filters=['saturate(1.45) contrast(1.1)','saturate(1.1) contrast(1.05)','saturate(1.5) hue-rotate(-12deg)','saturate(.8) sepia(.15)','saturate(1.7) hue-rotate(13deg)','saturate(1.2) contrast(1.16)'];for(let i=0;i<6;i++){const c=document.createElement('canvas');c.width=c.height=384;const ctx=c.getContext('2d',{willReadFrequently:true}),w=img.naturalWidth,h=img.naturalHeight,crop=Math.min(w,h);ctx.save();ctx.beginPath();ctx.roundRect(16,12,352,352,110);ctx.clip();ctx.filter=filters[i];ctx.drawImage(img,(w-crop)/2,(h-crop)/2,crop,crop,16,12,352,352);ctx.restore();const p=ctx.getImageData(0,0,384,384),copy=new Uint8ClampedArray(p.data),d=p.data,levels=[28,38,31,42,34,26][i];for(let y=14;y<363;y++)for(let x=18;x<366;x++){const at=(y*384+x)*4;if(copy[at+3]<230)continue;const edge=Math.abs(copy[at]-copy[at+4])+Math.abs(copy[at+1]-copy[at+1536+1]);for(let j=0;j<3;j++)d[at+j]=Math.max(0,Math.min(255,Math.round(copy[at+j]/levels)*levels-(edge>76?24:0)));}ctx.putImageData(p,0,0);ctx.strokeStyle=['#8751ed','#0aa793','#ed6855','#a77748','#357bd9','#b84b9c'][i];ctx.lineWidth=4;ctx.beginPath();ctx.roundRect(16,12,352,352,110);ctx.stroke();outputs.push(c.toDataURL('image/webp',.9));}return outputs;}
function cc129PhotoStudio(panel,uid,update){
 const section=cc128Element('section','cc129-studio'),input=cc128Element('input'),buttons=cc128Element('div','minor-actions'),message=cc128Element('p','fine'),gallery=cc128Element('div','gallery');let source='',images=[],closed=false,busy=false,configured=false,controller=null;input.type='file';input.accept='image/png,image/jpeg,image/webp';input.setAttribute('aria-label','Choose your companion photo');message.setAttribute('role','status');gallery.setAttribute('aria-label','Your six personal character styles');
 function setBusy(v){busy=v;input.disabled=v;local.disabled=v||!source;ai.disabled=v||!source||!configured;}
 function render(text){if(closed)return;gallery.replaceChildren();images.forEach((src,i)=>{const button=cc128Button('','Use personal style '+(i+1),()=>{update({character:'custom',customVariant:i,enabled:true});window.__CC128_COMPANION__?.react('wave',{preview:true,text:'Your personal companion is ready!'});},'choice'),img=cc128Element('img');img.src=src;img.alt='Personal style '+(i+1);img.width=img.height=115;img.style.cssText='width:100%;height:auto;border-radius:10px';button.append(img,cc128Element('b','','Look '+(i+1)));gallery.append(button);});message.textContent=text;}
 const local=cc128Button('Create 6 local styles','Create six local photo styles',async()=>{if(!source||busy)return;setBusy(true);try{images=await cc129PhotoStyles(source);if(closed)return;await cc129ImageStore(uid,{images,kind:'local',at:Date.now()});render('Local illustrated styles. No AI service or upload was used.');}catch(e){message.textContent=e.message;}finally{setBusy(false);}});
 const configure=cc128Button('AI availability','Check AI photo generation availability',async()=>{configure.disabled=true;try{const d=await api.get('/api/companion/cartoon',{cacheTtlMs:60000,retries:0,headers:{'X-CC-Dashboard-User':'global'}});configured=d.configured;message.textContent=configured?'AI is ready. Generate sends this photo to the configured image service. Generation charges may apply.':'AI generation needs manager setup. Six local photo styles work immediately without uploading.';}catch(e){message.textContent=e.message;}finally{configure.disabled=false;setBusy(busy);}});
 const ai=cc128Button('Generate 6 AI cartoons','Generate six AI cartoon looks',async()=>{if(!source||busy||!configured)return;setBusy(true);message.textContent='Creating your six cartoon looks. This may take a few minutes…';controller=new AbortController();try{const d=await api.post('/api/companion/cartoon',{image:source},{retries:0,timeoutMs:200000,signal:controller.signal,headers:{'X-CC-Dashboard-User':'global'},detachedWrite:true});if(closed||cc128Uid()!==uid)return;const sheet=await cc129LoadImage('data:'+d.mime+';base64,'+d.image);images=[];for(let i=0;i<6;i++){const c=document.createElement('canvas');c.width=c.height=384;c.getContext('2d').drawImage(sheet,i%3*sheet.naturalWidth/3,Math.floor(i/3)*sheet.naturalHeight/2,sheet.naturalWidth/3,sheet.naturalHeight/2,0,0,384,384);images.push(c.toDataURL('image/webp',.92));}await cc129ImageStore(uid,{images,kind:'ai',at:Date.now()});render('Six AI cartoon looks ready. Pick your favourite.');}catch(e){if(!closed)message.textContent=e.message||'Image service unavailable. Try local styles.';}finally{controller=null;setBusy(false);}});
 const remove=cc128Button('Delete my photo character','Delete personal photo and generated characters',async()=>{if(busy)return;try{await cc129ImageStore(uid,null);images=[];source='';input.value='';gallery.replaceChildren();update({character:'07',customVariant:0});message.textContent='Personal images deleted from this browser. Default 07 restored.';setBusy(false);}catch(e){message.textContent=e.message;}});
 local.disabled=ai.disabled=true;
 input.onchange=async()=>{if(!input.files?.[0]||busy)return;const file=input.files[0];if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>10*1024*1024){message.textContent='Choose a PNG, JPEG or WebP under 10 MB.';return;}setBusy(true);let url;try{url=URL.createObjectURL(file);const img=await cc129LoadImage(url),c=document.createElement('canvas'),scale=Math.min(1,640/Math.max(img.naturalWidth,img.naturalHeight));c.width=Math.round(img.naturalWidth*scale);c.height=Math.round(img.naturalHeight*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);source=c.toDataURL('image/jpeg',.88);message.textContent='Photo ready. Create local styles, or check AI availability.';}catch(e){message.textContent=e.message;}finally{if(url)URL.revokeObjectURL(url);setBusy(false);}};
 section.append(cc128Element('h3','section-label','Make it your own'),cc128Element('p','fine','Choose a photo for six local illustrated styles, or generate six AI cartoon looks with your configured image service. Your characters stay on this computer.'),input);buttons.append(local,configure,ai,remove);section.append(buttons,message,gallery);panel.append(section);cc129ImageStore(uid).then(d=>{if(!closed&&d?.images?.length){images=d.images;render(d.kind==='ai'?'Your saved AI cartoon looks.':'Your saved local illustrated styles.');}}).catch(()=>{});return()=>{closed=true;controller?.abort();};
}
