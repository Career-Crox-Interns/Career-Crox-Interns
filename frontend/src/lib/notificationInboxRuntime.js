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

export function installNotificationInboxRuntime(user,{navigate=path=>window.location.assign(path)}={}){
 if(!user?.user_id||typeof document==='undefined')return()=>{};
 const principal=accountPrincipal(),uid=String(user.user_id),mountedAt=Date.now();
 const seenKey='cc120-notice-seen:'+principal,metaKey='cc120-notice-sync:'+principal;
 const parse=(storage,key,fallback)=>{try{return JSON.parse(storage.getItem(key)||'null')||fallback;}catch{return fallback;}};
 let shown=parse(localStorage,seenKey,{}),saved=parse(sessionStorage,metaKey,{});
 let disposed=false,inflight=null,lastSync=Number(saved.at)||0,signature=saved.signature||'',current=null,queue=[],hover=false;
 let hideTimer,removeTimer,recoveryTimer,queueTimer;
 const stable=item=>/candidate_update|profile_access|approval|attendance/.test(String(item.category||''))||/note|transfer|reassign|submission|interview|follow.up|unlock|profile access/.test(String(item.title||'').toLowerCase());
 const host=document.createElement('div');host.className='cc120-work-notice-host';host.hidden=true;
 host.style.cssText='position:fixed;z-index:100960;width:min(370px,calc(100vw - 20px));pointer-events:auto;';
 const shadow=host.attachShadow({mode:'open'}),style=document.createElement('style');
 style.textContent=`:host([hidden]){display:none!important}*{box-sizing:border-box}article{font:12px/1.4 "Segoe UI",Arial,sans-serif;color:#263b56;background:rgba(248,251,255,.94);border:1px solid #bfd0e5;border-radius:11px;box-shadow:0 4px 14px #26436020;animation:pop .22s ease-out;transform-origin:top right}header{display:flex;align-items:center;gap:7px;min-height:37px;padding:4px 6px 4px 10px}.dot{width:7px;height:7px;background:#5782d2;border-radius:50%;flex:none}.heading{flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:4px 0}.close{font-size:19px;width:23px;height:25px;line-height:1;color:#6c7f97}.body{display:none;padding:0 12px 10px;max-height:145px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;color:#425b78;font-size:12px}article:hover .body,article:focus-within .body{display:block}.leaving{animation:bye .16s ease-in forwards}@keyframes pop{0%{opacity:0;transform:translateY(-7px) scale(.88) rotate(-2deg)}70%{opacity:1;transform:translateY(1px) scale(1.025) rotate(1deg)}100%{opacity:1;transform:none}}@keyframes bye{to{opacity:0;transform:translateY(-5px) scale(.9) rotate(2deg)}}@media(prefers-reduced-motion:reduce){article,.leaving{animation:none}}`;
 const readable=document.createElement('style');readable.textContent='article{border-radius:14px;background:#fff;box-shadow:0 9px 28px #2434522b}header{min-height:42px;padding:8px 9px 5px 13px}.heading{font-size:14px;line-height:1.4;white-space:normal;color:#2f2948}.body{display:block;padding:0 13px 12px;max-height:min(210px,35vh);font-size:13px;line-height:1.5;color:#3e4960;overflow:auto;overflow-wrap:anywhere}.subject{display:block;padding:0 13px 7px;font-size:12px;color:#5f6780}.changes{background:#f4f0fd;border:1px solid #e0d9ef;border-radius:9px;padding:9px 10px;white-space:pre-wrap}.notice-footer{display:flex;align-items:center;justify-content:space-between;padding:0 13px 10px;gap:8px;color:#6f7890;font-size:11px}.notice-footer button{padding:4px 8px;border:1px solid #d8dfee;border-radius:7px;background:#f7f9fe}.body .more{font:inherit;border:0;text-align:left;color:#5064a3;padding-top:8px}.context{font-size:12px;color:#6b7890;white-space:pre-wrap;margin-top:6px}';
 shadow.append(style,readable);(document.body||document.documentElement).append(host);
 const live=()=>!disposed&&accountPrincipal()===principal;
 function persist(){const cutoff=Date.now()-7*86400000;shown=Object.fromEntries(Object.entries(shown).filter(([,at])=>Number(at)>=cutoff).slice(-1000));try{localStorage.setItem(seenKey,JSON.stringify(shown));}catch{}}
 function place(){
  const anchor=document.querySelector('.topbar'),rect=anchor?.getBoundingClientRect(),box=host.getBoundingClientRect(),width=box.width||370,height=box.height||140;
  host.style.left=Math.round(Math.max(8,innerWidth-width-14))+'px';
  host.style.top=Math.round(Math.max(8,Math.min(innerHeight-height-8,rect?rect.bottom+7:64)))+'px';
 }
 function next(){clearTimeout(queueTimer);if(!live()||current||!queue.length||document.hidden||!getPollingLeaderSnapshot()?.isLeader)return;const item=queue.shift();if(!shown[item.notification_id])show(item);else next();}
 function finish(){clearTimeout(hideTimer);clearTimeout(removeTimer);if(!current)return;shadow.querySelector('article')?.classList.add('leaving');removeTimer=setTimeout(()=>{host.hidden=true;current=null;hover=false;queueTimer=setTimeout(next,100);},160);}
 function scheduleHide(delay){clearTimeout(hideTimer);hideTimer=setTimeout(()=>{if(!hover)finish();},Math.max(100,delay));}
 function show(item){
  if(!live())return;clearTimeout(hideTimer);clearTimeout(removeTimer);current=item;hover=false;shown[item.notification_id]=Date.now();persist();
  const article=document.createElement('article');article.setAttribute('role','status');article.setAttribute('aria-label','Work notification');
  const header=document.createElement('header'),dot=document.createElement('span'),heading=document.createElement('button'),close=document.createElement('button'),body=document.createElement('div');
  dot.className='dot';heading.className='heading';heading.textContent=item.title||'Work update';heading.title='Open update';close.className='close';close.textContent='×';close.setAttribute('aria-label','Dismiss notification');body.className='body';body.textContent=item.message||'';
  const open=()=>{finish();navigate(notificationTarget(item));void api.post('/api/notifications/'+encodeURIComponent(item.notification_id)+'/read',{}, {retries:0,detachedWrite:true,background:true,headers:{'X-CC-Dashboard-User':'global'}}).catch(()=>{});};
  heading.onclick=open;body.onclick=open;close.onclick=finish;
  article.onpointerenter=()=>{hover=true;clearTimeout(hideTimer);place();};article.onpointerleave=()=>{hover=false;scheduleHide(200);};article.onfocusin=()=>{hover=true;clearTimeout(hideTimer);};article.onfocusout=()=>{hover=false;scheduleHide(200);};
  const metadata=noticeMetadata(item),subject=document.createElement('span');subject.className='subject';subject.textContent=[metadata.candidate_name,metadata.candidate_id].filter(Boolean).join(' · ');
  const changes=document.createElement('div');changes.className='changes';changes.textContent=item.message||'Work update';body.textContent='';body.append(changes);
  if(metadata.note_id||metadata.note_body){const kicker=document.createElement('small');kicker.textContent='Updated note';kicker.style.cssText='display:block;margin-bottom:4px;color:#76698e';changes.prepend(kicker);}
  const more=document.createElement('button');more.type='button';more.className='more';more.textContent='More activity details';more.onclick=event=>{event.stopPropagation();let details=body.querySelector('.context');if(details){details.remove();place();return;}details=document.createElement('div');details.className='context';details.textContent=[metadata.actor_name?'By '+metadata.actor_name:'',new Date(item.created_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}),metadata.candidate_id?'Candidate '+metadata.candidate_id:''].filter(Boolean).join('\n');body.append(details);place();};body.append(more);body.onclick=event=>{if(!event.target.closest('button'))open();};
  const footer=document.createElement('div');footer.className='notice-footer';const hint=document.createElement('span');hint.textContent=stable(item)?'Stays until you close it':'Work notification';const nextButton=document.createElement('button');nextButton.type='button';nextButton.textContent='Next update';nextButton.onclick=finish;footer.append(hint,nextButton);
  header.append(dot,heading,close);article.append(header,subject,body,footer);shadow.querySelector('article')?.remove();shadow.append(article);host.hidden=false;place();
  const anchor=document.getElementById('cc120-notifications-trigger');anchor?.classList.remove('cc120-bell-bounce');if(anchor){void anchor.offsetWidth;anchor.classList.add('cc120-bell-bounce');}
  if(!stable(item)){const policy=readWorkNoticePolicy(),seconds=String(user.role).toLowerCase()==='tl'?policy.tl_seconds:policy.manager_seconds;scheduleHide(seconds*1000-160);}else{article.onpointerleave=()=>{hover=false;};article.onfocusout=()=>{hover=false;};}
 }
 function offer(items,initial=false){
  if(!live())return;const fresh=recentWorkNotices(items).filter(item=>String(item.user_id)===uid&&isManagedWorkNotice(item)&&String(item.status||'unread').toLowerCase()!=='read'&&!shown[item.notification_id]);
  for(const item of fresh.reverse()){if(initial&&Date.parse(item.created_at)<mountedAt-15000){shown[item.notification_id]=Date.now();continue;}if(!queue.some(row=>String(row.notification_id)===String(item.notification_id))&&String(current?.notification_id)!==String(item.notification_id))queue.push(item);}
  if(queue.length>50)queue=queue.slice(-50);persist();next();
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
