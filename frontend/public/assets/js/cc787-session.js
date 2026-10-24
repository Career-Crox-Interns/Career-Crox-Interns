/* CC835: one role-aware policy for all CRM activity guards. */
(function(){
 window.__CC835_IDLE_TIMEOUT_MS__=function(user){if(!user)try{user=JSON.parse(localStorage.getItem('careerCroxCachedUser')||'{}')}catch{}const role=String(user?.role||user?.designation||'').toLowerCase();return (/manager|admin/.test(role)?60:/^(tl|teamlead)$|team lead/.test(role)?30:10)*60000;};
 window.__CC835_LAST_ACTIVITY__=function(){let stamp=0;for(const key of ['careerCroxLastActivityAt','careerCroxHumanActivityAt','careerCroxSessionLoginAt'])try{stamp=Math.max(stamp,Number(localStorage.getItem(key))||0)}catch{}return Math.min(Date.now(),stamp);};
})();
/* One connection owner. No requests or timers are created by this guard. */
(function () {
  'use strict';
  const streams = new Set(), reads = new Set();
  const cachedUser = () => { try { const u = JSON.parse(localStorage.getItem('careerCroxCachedUser') || 'null'); return !!(u && (u.user_id || u.username)); } catch { return false; } };
  const paused = () => !!window.__CC602_NETWORK_PAUSED__ || !cachedUser();
  const pathOf = input => { try { const u = new URL(input?.url || input, location.href); return u.origin === location.origin ? u.pathname : ''; } catch { return ''; } };
  const publicApi = new Set(['/api/auth/login', '/api/auth/logout', '/api/auth/self-register', '/api/auth/password-reset-request', '/api/health']);
  const allowed = input => { const p = pathOf(input); return !p.startsWith('/api/') || publicApi.has(p) || !paused(); };
  function stop() {
    window.__CC602_NETWORK_PAUSED__ = true;
    document.documentElement.dataset.cc787Session = 'inactive';
    for (const stream of streams) { try { stream.close(); } catch {} }
    streams.clear();
    for (const controller of reads) controller.abort('session-ended');
    reads.clear();
    document.querySelectorAll('.cc388-reminder-deck,.cc379-reminder-deck,.cc730-manager-reminder-center,.cc730-manager-reminder-mini,#cc780-more-reminders,#cc611-reminders-dialog,.cc498-chat-peek').forEach(el => el.remove());
  }
  window.__CC787_STOP_CONNECTIONS__ = stop;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function (input, options = {}) {
    if (!allowed(input)) throw Object.assign(new Error('Session ended. Sign in to continue.'), { code: 'LOCAL_SESSION_EXPIRED' });
    const p = pathOf(input), method = String(options.method || input?.method || 'GET').toUpperCase();
    if (!p.startsWith('/api/') || publicApi.has(p) || method !== 'GET') return nativeFetch(input, options);
    const controller = new AbortController(), caller = options.signal || input?.signal;
    const abort = () => controller.abort(caller.reason);
    if (caller?.aborted) abort(); else caller?.addEventListener('abort', abort, { once: true });
    reads.add(controller);
    try { return await nativeFetch(input, { ...options, signal: controller.signal }); }
    finally { reads.delete(controller); caller?.removeEventListener('abort', abort); }
  };
  if(window.EventSource&&!window.__CC828_STREAM_BROKER__){
    const Native = window.EventSource;
    class SessionEventSource extends Native {
      constructor(url, options) {
        if (!allowed(url)) throw new DOMException('Session ended', 'AbortError');
        super(url, options); streams.add(this);
      }
      close() { streams.delete(this); return super.close(); }
    }
    window.EventSource = SessionEventSource;
  }
  window.addEventListener('career-crox-idle-lock-begin', stop);
  window.addEventListener('storage', event => {
    if(event.key==='careerCroxLogoutEventAt'&&event.newValue){try{if(Number(JSON.parse(event.newValue).at)<Number(localStorage.getItem('careerCroxSessionLoginAt')||0))return;}catch{}}
    if ((event.key === 'careerCroxCachedUser' && !event.newValue) || (event.key === 'careerCroxLogoutEventAt' && event.newValue)) stop();
  });
  window.addEventListener('career-crox-session-active', () => {
    if (!cachedUser()) return;
    window.__CC602_NETWORK_PAUSED__ = false;
    document.documentElement.dataset.cc787Session = 'active';
  });
  document.documentElement.dataset.cc787Session = paused() ? 'inactive' : 'active';
})();

/* Local accounting only: split elapsed intervals at the last real activity boundary. */
(function () {
  'use strict';
  window.__CC787_CLOCK_STEP__ = function (state, at, activity, mode, grace) {
    const s = { ...state }, start = Math.max(0, Number(s.office_started_at) || 0);
    const from = Math.max(start, Math.min(at, Number(s.last_tick_at) || at));
    const dt = Math.max(0, at - from), windowMs = Math.max(0, Number(grace) || 120000);
    const priorMode = s.clock_mode || mode;
    let active = 0, brk = 0;
    if (priorMode === 'break') brk = dt;
    else if (priorMode !== 'locked' && activity >= start) active = Math.max(0, Math.min(at, activity + windowMs) - Math.max(from, activity));
    s.active_ms = Math.max(0, Number(s.active_ms) || 0) + active;
    s.break_ms = Math.max(0, Number(s.break_ms) || 0) + brk;
    s.idle_ms = Math.max(0, Number(s.idle_ms) || 0) + Math.max(0, dt - active - brk);
    s.last_tick_at = at; s.clock_mode = mode;
    return s;
  };
})();

;(function(){
  if(window.__CC828_STREAM_BROKER__)return;window.__CC828_STREAM_BROKER__=true;
  // CC827: one native socket per endpoint/account, shared by all local widgets
  // and mirrored to sibling tabs. Do not occupy all six HTTP/1 browser slots.
  var NativeSource=window.EventSource;var owner=crypto.randomUUID(),hubs=new Map(),events=['open','message','ready','task-changed','submission-review','unlock','reminder-dirty','self-locked','youtube-access','dialer-live','unlock-resolved','notification','break-status','access-changed','form-layout'];
  function identity(){try{var user=JSON.parse(localStorage.getItem('careerCroxCachedUser')||'{}');return String(user.user_id||user.username||'')}catch(_){return ''}}
  function emit(hub,name,data){if(name==='unlock-resolved')try{window.__CC840_RESUME_APPROVED__?.(JSON.parse(data||'{}'))}catch(_){}window.__CC837_EVENT_INVALIDATE__?.(name,data);if(name==='ready'||name==='open')hub.ready=true;if(name==='error')hub.ready=false;hub.clients.forEach(function(client){if(client.closed)return;if(name==='message'&&client.thread&&client.thread!=='all'&&client.thread!=='*'){try{var item=JSON.parse(data||'{}').item;if(item&&String(item.thread_key||'team')!==client.thread)return;}catch(_){return;}}client.readyState=name==='error'?0:1;var event={type:name,data:data};(client.listeners[name]||[]).slice().forEach(function(fn){try{fn(event)}catch(e){setTimeout(function(){throw e})}});var callback=client['on'+name];if(typeof callback==='function')callback(event);});}
  function release(hub){if(!hub.leaseKey)return;try{var lease=JSON.parse(localStorage.getItem(hub.leaseKey)||'null');if(lease&&lease.owner===owner)localStorage.removeItem(hub.leaseKey)}catch(_){}}
  function elected(hub){try{var now=Date.now(),lease=JSON.parse(localStorage.getItem(hub.leaseKey)||'null');if(lease&&lease.owner!==owner&&lease.until>now)return false;localStorage.setItem(hub.leaseKey,JSON.stringify({owner:owner,until:now+15000}));return true}catch(_){return true}}
  function disconnect(hub){if(hub.source)hub.source.close();hub.source=null;hub.ready=false;}
  function tickHub(hub){
    if(!hub.clients.size)return;
    var id=identity();
    if(location.pathname==='/data-backup'||!id||window.__CC602_NETWORK_PAUSED__||(window.__CC874_INSTANCE_MODE__&&!['ACTIVE','LOCAL','UNCONFIGURED'].includes(window.__CC874_INSTANCE_MODE__))){disconnect(hub);release(hub);return;}
    if(id!==hub.id){disconnect(hub);release(hub);if(hub.channel)hub.channel.close();hub.id=id;hub.leaseKey='cc827-event-leader:'+id+':'+hub.url;hub.channel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('cc827-events:'+id+':'+hub.url);if(hub.channel)hub.channel.onmessage=function(event){var data=event.data;if(data&&events.includes(data.name))emit(hub,data.name,data.data);};}
    var leader=!hub.channel||elected(hub);
    if(!leader){disconnect(hub);return;}
    if(hub.source||Date.now()<hub.retryAt)return;
    var source=new NativeSource(hub.url,{withCredentials:true});hub.source=source;
    events.forEach(function(name){source.addEventListener(name,function(event){if(hub.source!==source)return;emit(hub,name,event.data||'');if(hub.channel)hub.channel.postMessage({name:name,data:event.data||''});});});
    source.onerror=function(){if(hub.source!==source)return;emit(hub,'error','');if(source.readyState===2){disconnect(hub);hub.retryAt=Date.now()+15000;}};
  }
  window.__CC819_WORKSPACE_SOURCE__=function(url){
    var parsed=new URL(url,location.href);if(parsed.origin!==location.origin)throw Error('CRM events must use this workspace.');
    if(parsed.pathname==='/api/approvals/stream')parsed.search='';var requestedThread=parsed.pathname==='/api/chat/stream'?(parsed.searchParams.get('thread_key')||'team'):null;if(parsed.pathname==='/api/chat/stream')parsed.search='?thread_key=all';var key=parsed.pathname+parsed.search,hub=hubs.get(key);
    if(!hub){hub={url:key,id:'',source:null,channel:null,clients:new Set(),retryAt:0};hubs.set(key,hub);}
    var client={thread:requestedThread,url:parsed.href,withCredentials:true,closed:false,readyState:0,listeners:{},onmessage:null,onopen:null,onerror:null,
      addEventListener:function(name,fn){(this.listeners[name]||=[]).push(fn)},
      removeEventListener:function(name,fn){this.listeners[name]=(this.listeners[name]||[]).filter(function(value){return value!==fn})},
      close:function(){if(this.closed)return;this.closed=true;this.readyState=2;hub.clients.delete(this);if(!hub.clients.size){disconnect(hub);release(hub);if(hub.channel)hub.channel.close();hubs.delete(key)}}
    };
    hub.clients.add(client);setTimeout(function(){tickHub(hub);if(hub.source&&hub.source.readyState===1||hub.ready){client.readyState=1;(client.listeners.ready||[]).slice().forEach(function(fn){fn({type:'ready',data:'{}'});});if(client.onopen)client.onopen({type:'open',data:''});}},0);return client;
  };
  function SharedSource(url,options){var parsed=new URL(url,location.href);if(parsed.origin===location.origin&&['/api/chat/stream','/api/approvals/stream','/api/securelink/events'].includes(parsed.pathname))return window.__CC819_WORKSPACE_SOURCE__(parsed.href);return new NativeSource(url,options);}
  SharedSource.CONNECTING=0;SharedSource.OPEN=1;SharedSource.CLOSED=2;if(NativeSource)window.EventSource=SharedSource;
  var timer=setInterval(function(){hubs.forEach(tickHub)},1500); // local election only; no database requests
  function closeAll(){hubs.forEach(function(hub){disconnect(hub);release(hub);if(hub.channel)hub.channel.close();hub.clients.forEach(function(client){client.closed=true;client.readyState=2})});hubs.clear();}
  window.addEventListener('pagehide',function(){clearInterval(timer);timer=null;hubs.forEach(function(hub){disconnect(hub);release(hub)})});
  window.addEventListener('pageshow',function(){if(!timer)timer=setInterval(function(){hubs.forEach(tickHub)},1500);hubs.forEach(tickHub)});
  window.addEventListener('career-crox-idle-lock-begin',closeAll);
  window.addEventListener('storage',function(event){if(event.key&&event.key.indexOf('cc827-event-leader:')===0)hubs.forEach(tickHub);});
})();


/* CC836: committed attendance survives route changes, delayed reads and sibling tabs. */
(function(){
 const KEY='cc836_attendance_receipt';let memory=null;
 const owner=()=>{try{return String(JSON.parse(localStorage.getItem('careerCroxCachedUser')||'{}').user_id||'')}catch{return ''}};
 const today=()=>new Date(Date.now()+19800000).toISOString().slice(0,10);
 function record(){try{const saved=JSON.parse(localStorage.getItem(KEY)||'null');if(saved?.owner===owner()&&saved.day===today())memory=saved;}catch{}return memory?.owner===owner()&&memory.day===today()?memory:null;}
 window.__CC836_ATTENDANCE__=()=>record()?.data||null;
 window.__CC836_ACCEPT_ATTENDANCE__=function(data,context){
  if(!data?.presence||!owner())return data;const old=record();if(data.__cc836Receipt&&data.__cc836Receipt===old?.data?.__cc836Receipt)return old.data;
  const p=data.presence,at=context?.at||Date.now(),write=/\/(?:start-break|end-break|join|self-unlock)$/.test(context?.path||'');
  if(old&&context&&at<old.mutationAt)return old.data;
  if(old&&!context&&String(old.data.presence?.is_on_break)==='1'&&String(p.is_on_break)!=='1'&&!['approved_unlock','break_ended'].includes(p.last_activity_source))return old.data;
  const stamp=Math.max(...['last_seen_at','updated_at','locked_at'].map(k=>Date.parse(p[k]||'')||0));
  if(old&&!write&&stamp&&stamp<(old.serverStamp||0))return old.data;
  const next={...(old?.data||{}),...data,presence:{...p},__cc836Receipt:Date.now()+':'+Math.random().toString(36).slice(2)};
  memory={owner:owner(),day:today(),mutationAt:write?at:old?.mutationAt||0,serverStamp:stamp,data:next};try{localStorage.setItem(KEY,JSON.stringify(memory))}catch{}return next;
 };
 window.addEventListener('career-crox-attendance-live',event=>{if(event.detail?.presence)Object.assign(event.detail,window.__CC836_ACCEPT_ATTENDANCE__(event.detail));},{capture:true});
 window.addEventListener('storage',event=>{if(event.key===KEY){const data=window.__CC836_ATTENDANCE__();if(data)window.dispatchEvent(new CustomEvent('career-crox-attendance-live',{detail:data}));}});
})();

/* CC837: coalesce same-session JSON reads across tabs; no network polling. */
(function(){
 'use strict';if(window.__CC837_READ_BROKER__)return;window.__CC837_READ_BROKER__=true;
 const native=window.fetch.bind(window),PREFIX='cc873-read:',EPOCH='cc873-epoch:',pending=new Map(),events=new Set();
 const stats=window.__CC837_READ_STATS__={network:0,shared_hits:0};
 function user(){try{return JSON.parse(localStorage.getItem('careerCroxCachedUser')||'null')}catch{return null}}
 function identity(){const u=user();return u?JSON.stringify([u.user_id||u.username,u.role,localStorage.getItem('careerCroxSessionLoginAt')||'',window.__CC875_DASHBOARD_KEY__?.()||'overview',window.__CC875_POPUP_SETTINGS__?.().managerTeamPopups!==false]):''}
 function group(path){const root=String(path).split('?')[0].split('/')[2]||'';if(['auth','attendance'].includes(root))return 'attendance';if(['users','flowchart','collaboration'].includes(root))return 'access';return root;}
 function epoch(path){try{const root=group(path),dependencies={candidates:['candidates'],search:['candidates'],bucket:['candidates'],submissions:['submissions','candidates'],interviews:['interviews','candidates'],followups:['followups','candidates'],approvals:['approvals','candidates','attendance'],reports:['reports','candidates','submissions','interviews','tasks','revenue-hub','attendance'],reminder:['reports','candidates','tasks','revenue-hub'], 'revenue-hub':['revenue-hub','candidates'],dialer:['dialer','candidates']};return ['access',...(dependencies[root]||[root])].map(key=>localStorage.getItem(EPOCH+identity()+':'+key)||'0').join(':')}catch{return'0'}}
 function pruneAccountCaches(){const id=identity();try{for(const key of Object.keys(localStorage)){if(key.startsWith(PREFIX)&&(!id||!key.startsWith(PREFIX+id+':')))localStorage.removeItem(key);if(key.startsWith(EPOCH)&&(!id||!key.startsWith(EPOCH+id+':')))localStorage.removeItem(key);}}catch{}}
 window.addEventListener('storage',e=>{if(e.key==='careerCroxCachedUser'||e.key==='careerCroxSessionLoginAt'||e.key==='careerCroxLogoutEventAt')pruneAccountCaches()});
 window.addEventListener('career-crox-idle-lock-begin',()=>{try{for(const key of Object.keys(localStorage))if(key.startsWith(PREFIX))localStorage.removeItem(key)}catch{}});
 window.__CC837_RESOURCE_VERSION__=epoch;
 function invalidate(path,token){if(token){if(events.has(token))return;events.add(token);if(events.size>100)events.delete(events.values().next().value)}const id=identity();if(!id)return;try{localStorage.setItem(EPOCH+id+':'+group(path||'/api/candidates'),Date.now()+':'+Math.random());}catch{}window.dispatchEvent(new Event('cc837-read-invalidated'));}
 window.__CC837_INVALIDATE__=invalidate;
 window.__CC837_EVENT_INVALIDATE__=function(name,data){if(['ready','open','error'].includes(name))return;let obj;try{obj=JSON.parse(data||'{}')}catch{return}const source=String(obj.meta?.source||obj.source||obj.path||'');const path=name==='access-changed'?'/api/flowchart':name==='unlock'||name==='unlock-resolved'||name==='self-locked'?'/api/attendance':name==='message'?'/api/chat':source.startsWith('/api/')?source:source.startsWith('/')?'/api'+source:obj.item?.candidate_id||obj.candidate_id?'/api/candidates':'/api/reports';invalidate(path,name+':'+JSON.stringify(obj));};
 window.addEventListener('storage',e=>{if(e.key?.startsWith(EPOCH))window.dispatchEvent(new Event('cc837-read-invalidated'))});
 function active(id){return id&&id===identity()&&!window.__CC602_NETWORK_PAUSED__}
 function info(input,options){try{const u=new URL(typeof input==='string'?input:input.url,location.href);if(u.origin!==location.origin||!u.pathname.startsWith('/api/'))return null;const method=String(options.method||(input instanceof Request?input.method:'GET')).toUpperCase();return{u,method}}catch{return null}}
 function eligible(u){if(u.pathname.startsWith('/api/multiple-crm/'))return false;return !/\/(?:auth|files|download|export|stream|events|contact-access|pair-code|next-id|latest)(?:\/|$)/.test(u.pathname)&&!u.pathname.startsWith('/api/mobile/')&&!u.pathname.includes('/pair')}
 function read(key,ttl){try{const hit=JSON.parse(localStorage.getItem(key)||'null');return hit&&Date.now()-hit.at<ttl?hit:null}catch{return null}}
 function response(hit){return new Response(hit.body,{status:200,headers:{'Content-Type':'application/json','X-CRM-Shared-Read':'1'}})}
 function save(key,body){if(body.length>350000)return;try{const keys=Object.keys(localStorage).filter(k=>k.startsWith(PREFIX)).map(k=>({k,n:localStorage.getItem(k)?.length||0,at:read(k,Infinity)?.at||0})).sort((a,b)=>a.at-b.at);let total=keys.reduce((n,x)=>n+x.n,0);while(keys.length>=24||total+body.length>750000){const x=keys.shift();if(!x)break;localStorage.removeItem(x.k);total-=x.n;}localStorage.setItem(key,JSON.stringify({body,at:Date.now()}));}catch{}}
 window.fetch=async function(input,options={}){
  pruneAccountCaches();const meta=info(input,options);if(!meta)return native(input,options);const {u,method}=meta;
  if(method!=='GET'){const r=await native(input,options);if(r.ok)invalidate(u.pathname);return r;}
  const started=Date.now(),id=identity();if(!active(id)||!eligible(u)||options.cache==='reload')return native(input,options);
  const caller=options.signal||(input instanceof Request?input.signal:null),deadline=new AbortController();
  const abort=()=>deadline.abort(caller?.reason);if(caller?.aborted)abort();else caller?.addEventListener('abort',abort,{once:true});
  const deadlineTimer=setTimeout(()=>deadline.abort('CRM read timed out'),15000);options={...options,signal:deadline.signal};
  try{
  const fresh=u.searchParams.get('fresh')==='1'||u.searchParams.has('_refresh');['fresh','_refresh','_','t','ts','timestamp','_ts','_t'].forEach(k=>u.searchParams.delete(k));u.searchParams.sort();
  const path=u.pathname+u.search,rev=epoch(path),key=PREFIX+id+':'+rev+':'+path;
  const ttl=fresh||/\/attendance|\/dialer/.test(path)?1000:/\/search/.test(path)?3000:15000;
  function guard(){if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');if(!active(id))throw new DOMException('Session changed','AbortError')}
  async function execute(){guard();const cached=read(key,Infinity);if(cached&&(Date.now()-cached.at<ttl||cached.at>=started)&&epoch(path)===rev){stats.shared_hits++;return response(cached)}
   stats.network++;let r=await native(input,options);guard();
   if(epoch(path)!==rev){const retryRev=epoch(path);stats.network++;r=await native(input,options);guard();if(epoch(path)!==retryRev)return new Response(JSON.stringify({message:'Data changed. Refresh this view.'}),{status:409,headers:{'Content-Type':'application/json'}});return r;}
   if(r.ok&&r.status===200&&r.headers.get('content-type')?.includes('application/json')){
    try{const body=await r.clone().text(),d=JSON.parse(body);if(active(id)&&epoch(path)===rev&&!d.degraded&&!d.__stale&&d.ok!==false)save(key,body)}catch{}
   }return r;
  }
  if(navigator.locks?.request)return await navigator.locks.request(key,{mode:'exclusive',...(options.signal?{signal:options.signal}:{})},execute);
  if(pending.has(key)){await pending.get(key);guard();const cached=read(key,ttl);if(cached){stats.shared_hits++;return response(cached)}}
  const work=execute();pending.set(key,work);try{return await work}finally{if(pending.get(key)===work)pending.delete(key)}
  }finally{clearTimeout(deadlineTimer);caller?.removeEventListener('abort',abort)}
 };
})();

/* CC840: an explicit approved unlock starts a fresh idle window in every open tab.
   It does not create a login or resurrect a signed-out/revoked session. */
(function(){
 const seen=new Set();
 window.__CC840_RESUME_APPROVED__=function(data){
  if(!data||String(data.status).toLowerCase()!=='approved'||data.review_only||window.__CC602_NETWORK_PAUSED__)return;
  let user;try{user=JSON.parse(localStorage.getItem('careerCroxCachedUser')||'null')}catch{return}
  if(!user||String(user.user_id)!==String(data.requester_user_id))return;
  const key=[data.id,data.unlocked_at].join(':');if(seen.has(key))return;seen.add(key);if(seen.size>50)seen.delete(seen.values().next().value);
  const at=Date.now();try{
   localStorage.setItem('careerCroxHumanActivityAt',String(at));localStorage.setItem('careerCroxLastActivityAt',String(at));
   localStorage.removeItem('cc836_attendance_receipt');
  }catch{}
  window.dispatchEvent(new CustomEvent('career-crox-approved-work-resumed',{detail:{at}}));
 };
})();
