import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {useLocation} from 'react-router-dom';
import {useAuth} from '../lib/auth';
import {api} from '../lib/api';

// CC913: controls inside this surface are independent of CRM theme CSS/scripts.
export function useIsolatedSurface(id){
 const [surface,setSurface]=useState(null);
 useEffect(()=>{const host=document.createElement('div');host.id=id;host.dataset.noTheme='1';host.style.cssText='all:initial!important;display:contents!important';document.body.appendChild(host);const root=host.attachShadow({mode:'open'});setSurface(root);window.dispatchEvent(new CustomEvent('career-crox-isolated-surface',{detail:{root}}));return()=>{host.remove();};},[id]);
 return surface;
}

const listeners=new Set();
let snapshot={principal:'',items:[],loaded:false,busy:false,error:'',asOf:'',scope:'team'},flight=null,sequence=0,eventVersion=0;
const breakEvents=new Map();
const publish=next=>{snapshot=next;for(const fn of listeners)fn();};
const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
const sorted=rows=>[...rows].sort((a,b)=>String(a.full_name).localeCompare(String(b.full_name)));
async function refreshBreaks(){
 if(!snapshot.principal)return;
 if(flight?.principal===snapshot.principal)return flight.promise;
 const principal=snapshot.principal,ticket=++sequence,version=eventVersion;
 publish({...snapshot,busy:true,error:''});
 const promise=api.get('/api/attendance/on-break',{cacheTtlMs:0,allowStale:false,retries:0,timeoutMs:10000}).then(data=>{
  if(ticket!==sequence||snapshot.principal!==principal)return;
  const rows=new Map((data.items||[]).map(row=>[String(row.user_id),row]));
  for(const {version:v,item} of breakEvents.values())if(v>version){rows.delete(String(item.user_id));if(item.is_on_break)rows.set(String(item.user_id),item);}
  publish({...snapshot,items:sorted(rows.values()),loaded:true,busy:false,error:'',asOf:data.as_of||new Date().toISOString(),scope:data.scope||'team'});
 }).catch(error=>{if(ticket===sequence&&snapshot.principal===principal)publish({...snapshot,busy:false,error:error.message||'Could not verify break status'});})
 .finally(()=>{if(flight?.ticket===ticket)flight=null;});
 flight={principal,ticket,promise};return promise;
}
const time=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'}):'Time unavailable';};

// One shared overlay: values are read at click time, with no space reserved in rows.
const forbidden=/password|passcode|secret|token|private.?key|credential|content_base64/i;
function copyTarget(node){
 if(!(node instanceof Element)||node.closest('[data-no-copy],button,[role="button"],select,option,.cc911-copy-button'))return null;
 const explicit=node.closest('[data-copy-value]');
 if(explicit&&explicit.getRootNode()?.host?.id==='cc913-aria-surface'&&/^(phone|email)$/i.test(explicit.dataset.copyLabel||''))return {anchor:explicit,label:explicit.dataset.copyLabel,read:()=>explicit.dataset.copyValue||''};
 if(!/^\/candidate\//.test(location.pathname))return null;
 const saved=node.closest('.candidate-note-body,.candidate-notes-body,[data-copy-candidate-value]');
 if(saved)return {anchor:saved,label:'candidate note',read:()=>saved.textContent||''};
 const field=node.closest('input,textarea');
 if(!field||!field.closest('[data-field]'))return null;
 if(field.matches('input[type="password"],input[type="file"],input[type="hidden"],input[type="checkbox"],input[type="radio"],input[type="date"],input[type="time"],input[type="datetime-local"],input[type="submit"]'))return null;
 const key=field.closest('[data-field]')?.dataset.field||'';
 const label=field.getAttribute('aria-label')||field.labels?.[0]?.textContent||key||field.name||'candidate detail';
 if(forbidden.test([key,field.name,field.id,label].join(' ')))return null;
 return {anchor:field,label:String(label).trim(),read:()=>String(field.value??'')};
}

async function writeClipboard(value){
 try{await navigator.clipboard.writeText(value);return;}catch{}
 const input=document.createElement('textarea'),focus=document.activeElement,selection=window.getSelection(),ranges=selection?[...Array(selection.rangeCount)].map((_,i)=>selection.getRangeAt(i).cloneRange()):[];
 input.value=value;input.readOnly=true;input.style.cssText='position:fixed;left:-9999px;top:0;opacity:0';document.body.appendChild(input);input.select();
 let ok=false;try{ok=document.execCommand('copy');}finally{input.remove();focus?.focus?.({preventScroll:true});if(selection){selection.removeAllRanges();ranges.forEach(r=>selection.addRange(r));}}
 if(!ok)throw Error('Copy unavailable. Allow clipboard access.');
}
function HoverCopy({enabled,route}){
 useEffect(()=>{
  if(!enabled)return;
  let active=null,hideTimer,toastTimer;
  const host=document.createElement('div');host.id='cc913-copy-surface';host.style.cssText='all:initial!important;display:contents!important';const surface=host.attachShadow({mode:'open'}),css=document.createElement('style');css.textContent=copyStyles;surface.appendChild(css);document.body.appendChild(host);
  const button=document.createElement('button');button.type='button';button.className='cc911-copy-button';button.textContent='Copy';button.hidden=true;button.dataset.noCopy='1';surface.appendChild(button);
  const toast=document.createElement('div');toast.className='cc911-copy-feedback';toast.setAttribute('role','status');toast.hidden=true;surface.appendChild(toast);
  const place=()=>{if(!active?.anchor?.isConnected){button.hidden=true;return;}const r=active.anchor.getBoundingClientRect();if(r.width<10||r.height<8||r.bottom<0||r.top>innerHeight){button.hidden=true;return;}
   button.style.left=Math.max(4,Math.min(innerWidth-58,r.right-54))+'px';button.style.top=Math.max(4,Math.min(innerHeight-30,r.top-29))+'px';button.hidden=false;button.setAttribute('aria-label','Copy '+active.label);
  };
  const show=e=>{const origin=e.composedPath?.().find(x=>x instanceof Element)||e.target;if(origin===button)return;clearTimeout(hideTimer);const found=copyTarget(origin);if(!found||!String(found.read()??'').trim()){button.hidden=true;active=null;return;}active=found;place();};
  const out=e=>{if(e.relatedTarget===host||e.relatedTarget===button||button.contains(e.relatedTarget)||active?.anchor.contains(e.relatedTarget))return;clearTimeout(hideTimer);hideTimer=setTimeout(()=>{if(surface.activeElement!==button&&!button.matches(':hover')){button.hidden=true;active=null;}},160);};
  const copy=async e=>{e.preventDefault();e.stopPropagation();if(!active?.anchor.isConnected)return;const value=String(active.read()??'');try{if(!value.trim())throw Error('Nothing to copy');await writeClipboard(value);toast.textContent='Copied '+active.label;}catch(error){toast.textContent=error.message;}toast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.hidden=true;},1800);};
  const escape=e=>{if(e.key==='Escape'){active=null;button.hidden=true;}};
  button.addEventListener('pointerenter',()=>clearTimeout(hideTimer));button.addEventListener('mousedown',e=>e.preventDefault());button.addEventListener('click',copy);
  const roots=new Set(),listen=root=>{if(!root||roots.has(root))return;roots.add(root);for(const [name,fn]of [['click',show]])root.addEventListener(name,fn,true);};
  const surfaced=e=>listen(e.detail?.root);document.querySelectorAll('[data-no-theme]').forEach(host=>listen(host.shadowRoot));window.addEventListener('career-crox-isolated-surface',surfaced);
  document.addEventListener('click',show,true);document.addEventListener('keydown',escape,true);window.addEventListener('scroll',place,true);window.addEventListener('resize',place);
  return()=>{window.removeEventListener('career-crox-isolated-surface',surfaced);for(const root of roots)for(const [name,fn]of [['click',show]])root.removeEventListener(name,fn,true);clearTimeout(hideTimer);clearTimeout(toastTimer);document.removeEventListener('click',show,true);document.removeEventListener('keydown',escape,true);window.removeEventListener('scroll',place,true);window.removeEventListener('resize',place);host.remove();};
 },[enabled,route]);
 return null;
}
export default function WorkspaceUtilities(){
 const {user,booted}=useAuth(),location=useLocation(),principal=user?[user.user_id,user.role].join('|'):'',enabled=!!principal&&booted&&!['/login','/data-backup'].includes(location.pathname);
 useEffect(()=>{
  sequence++;flight=null;eventVersion=0;breakEvents.clear();publish({principal,items:[],loaded:false,busy:false,error:'',asOf:'',scope:/manager|admin/.test(user?.role||'')?'all':'team'});
  if(!enabled)return;
  refreshBreaks();
  const changed=e=>{const item=e.detail?.item;if(!item?.user_id||snapshot.principal!==principal)return;const version=++eventVersion;breakEvents.set(String(item.user_id),{item,version});const rows=new Map(snapshot.items.map(x=>[String(x.user_id),x]));rows.delete(String(item.user_id));if(item.is_on_break)rows.set(String(item.user_id),item);publish({...snapshot,items:sorted(rows.values()),asOf:e.detail.at||new Date().toISOString()});};
  const ready=()=>refreshBreaks();const access=()=>{sequence++;flight=null;breakEvents.clear();publish({...snapshot,items:[],loaded:false});refreshBreaks();};
  window.addEventListener('career-crox-break-status',changed);window.addEventListener('career-crox-reminder-ready',ready);window.addEventListener('online',ready);window.addEventListener('career-crox-access-changed',access);window.addEventListener('career-crox-team-changed',access);
  return()=>{window.removeEventListener('career-crox-break-status',changed);window.removeEventListener('career-crox-reminder-ready',ready);window.removeEventListener('online',ready);window.removeEventListener('career-crox-access-changed',access);window.removeEventListener('career-crox-team-changed',access);};
 },[principal,enabled]);
 return <><style>{styles}</style><VoiceTyping enabled={enabled} principal={principal}/><HoverCopy enabled={enabled} route={location.pathname}/></>;
}
function VoiceTyping({enabled,principal}){
 useEffect(()=>{
  if(!enabled)return;
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition,entries=new Map(),surfaces=new Map(),roots=new Set([document]);let session=null,frame=0,closed=false,tipTimer,language='en-IN';
  try{language=localStorage.getItem('cc123-voice-language')==='hi-IN'?'hi-IN':'en-IN';}catch{}
  function surface(container){
   if(surfaces.has(container))return surfaces.get(container);const host=document.createElement('div');host.dataset.noTheme='1';host.dataset.cc123Voice='1';host.style.cssText='display:contents!important';const shadow=host.attachShadow({mode:'open'}),style=document.createElement('style');
   style.textContent=':host{all:initial}*{box-sizing:border-box}.mic{position:fixed;z-index:2147483647;display:grid;place-items:center;width:24px;height:24px;padding:3px;margin:0;border:1px solid #bfd0e8;border-radius:7px;background:#f4f8ffed;color:#476394;cursor:pointer;box-shadow:0 1px 4px #21436d15}.mic:hover,.mic:focus-visible{background:#e5eeff;outline:2px solid #7b97d9}.mic[aria-pressed=true]{background:#dc4560;color:white;border-color:#ca3854;animation:breathe 1s ease-in-out infinite}.mic[hidden],.voice-bar[hidden]{display:none}.voice-bar{position:fixed;z-index:2147483647;bottom:14px;left:50%;transform:translateX(-50%);display:flex;gap:8px;align-items:center;max-width:calc(100vw - 24px);padding:9px 12px;border:1px solid #b8cbe6;border-radius:12px;background:#fff;color:#28435f;box-shadow:0 5px 22px #17314d30;font:13px/1.4 "Segoe UI",sans-serif}.voice-bar select,.voice-bar button{font:inherit;border:1px solid #c4d2e7;border-radius:7px;background:#f0f5ff;color:#244574;padding:4px;cursor:pointer}.voice-bar .copy{max-width:300px}@keyframes breathe{50%{box-shadow:0 0 0 4px #dc45602a}}@media(prefers-reduced-motion:reduce){.mic{animation:none!important}}';
   const bar=document.createElement('div');bar.className='voice-bar';bar.hidden=true;bar.setAttribute('role','status');const message=document.createElement('span');message.className='copy';const lang=document.createElement('select');lang.setAttribute('aria-label','Voice typing language');lang.innerHTML='<option value="en-IN">English</option><option value="hi-IN">हिन्दी</option>';lang.value=language;
   lang.onchange=()=>{language=lang.value;try{localStorage.setItem('cc123-voice-language',language);}catch{}stop();message.textContent='Language saved. Tap a mic to speak.';tipTimer=setTimeout(()=>bar.hidden=true,3500);};
   const stopButton=document.createElement('button');stopButton.type='button';stopButton.textContent='Stop';stopButton.onclick=()=>{stop();bar.hidden=true;};bar.append(message,lang,stopButton);shadow.append(style,bar);container.append(host);const item={host,shadow,bar,message,lang};surfaces.set(container,item);return item;
  }
  function eligible(node){
   if(!(node instanceof Element)||node.disabled||node.readOnly||node.closest('[data-no-voice],.cc927-placement-box'))return false;
   if(/password|passcode|otp|one.time.code|secret|token/i.test([node.name,node.id,node.getAttribute('aria-label'),node.autocomplete].join(' ')))return false;
   return node.matches('textarea,input:not([type]),input[type=text],input[type=search],input[type=tel],input[type=email],input[type=url],input[type=number],[contenteditable=true],[contenteditable=""]');
  }
  const valueOf=node=>node.isContentEditable?node.textContent:node.value;
  function write(node,value,caret){
   if(node.isContentEditable){node.textContent=value;const range=document.createRange();range.selectNodeContents(node);range.collapse(false);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);}
   else{const prototype=node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(node,value);try{node.setSelectionRange(caret,caret);}catch{}}
   node.dispatchEvent(new Event('input',{bubbles:true,composed:true}));node.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
  }
  function stop(){const previous=session;session=null;if(previous){previous.wanted=false;clearTimeout(previous.restart);try{previous.recognition.abort();}catch{}previous.entry.button.setAttribute('aria-pressed','false');previous.entry.ui.message.textContent='Voice typing stopped.';}}
  function tip(ui,message){clearTimeout(tipTimer);ui.bar.hidden=false;ui.message.textContent=message;ui.lang.value=language;tipTimer=setTimeout(()=>{if(!session)ui.bar.hidden=true;},6500);}
  function begin(entry){
   if(session?.entry===entry){stop();entry.ui.bar.hidden=true;return;}stop();if(!Recognition){tip(entry.ui,'Voice typing needs a supported browser such as Chrome. Windows users can also use Win + H.');return;}
   const node=entry.node;if(!node.isConnected||!eligible(node))return;entry.ui.host.parentNode.append(entry.ui.host);const current=String(valueOf(node)||''),from=node.isContentEditable?current.length:node.selectionStart??current.length,to=node.isContentEditable?current.length:node.selectionEnd??from,recognition=new Recognition(),state={entry,recognition,wanted:true,prefix:current.slice(0,from),suffix:current.slice(to),lastValue:current,inserted:'',restart:null};session=state;
   recognition.lang=language;recognition.continuous=true;recognition.interimResults=true;recognition.maxAlternatives=1;entry.ui.bar.hidden=false;entry.ui.lang.value=language;entry.ui.message.textContent='Listening… Speak into your headset. Browser speech service may process audio.';entry.button.setAttribute('aria-pressed','true');node.focus({preventScroll:true});
   recognition.onresult=event=>{
    if(session!==state||!state.wanted||!node.isConnected||!eligible(node)){stop();return;}if(String(valueOf(node)||'')!==state.lastValue){stop();return;}
    let transcript=Array.from(event.results||[]).map(result=>result[0]?.transcript||'').join(' ').trim();const numeric=node.type==='number'||node.type==='tel'||node.inputMode==='numeric';
    if(numeric)transcript=transcript.replace(/[०-९]/g,c=>String(c.charCodeAt(0)-2406)).replace(/[^\d.+-]/g,'');
    const lead=!numeric&&state.prefix&&!/\s$/.test(state.prefix)&&transcript?' ':'',tail=!numeric&&state.suffix&&!/^\s/.test(state.suffix)&&transcript?' ':'',max=node.maxLength>0?Math.max(0,node.maxLength-state.prefix.length-state.suffix.length):Infinity;
    state.inserted=(lead+transcript+tail).slice(0,max);write(node,state.prefix+state.inserted+state.suffix,state.prefix.length+state.inserted.length);state.lastValue=String(valueOf(node)||'');entry.ui.message.textContent='Listening… '+(language==='hi-IN'?'हिन्दी':'English')+' · Tap the mic or Stop when done.';
   };
   recognition.onerror=event=>{if(session!==state)return;const messages={'not-allowed':'Allow microphone access in your browser, then tap the mic again.','service-not-allowed':'Speech service is unavailable in this browser. Try Chrome.','audio-capture':'Connect your headset microphone and select it in browser settings.',network:'Speech service could not connect. Check internet and try again.','language-not-supported':'This voice language is unavailable. Choose English or Hindi.'};if(event.error==='no-speech')return;stop();tip(entry.ui,messages[event.error]||'Voice typing stopped. Tap the mic to retry.');};
   recognition.onend=()=>{if(session!==state||!state.wanted)return;if(document.hidden||!node.isConnected||!eligible(node)){stop();return;}state.prefix+=state.inserted;state.inserted='';state.lastValue=String(valueOf(node)||'');state.restart=setTimeout(()=>{if(session===state&&state.wanted){try{recognition.start();}catch{stop();tip(entry.ui,'Tap the mic to continue voice typing.');}}},200);};
   try{recognition.start();}catch{stop();tip(entry.ui,'Voice typing could not start. Check microphone permission and retry.');}
  }
  function scan(){
   frame=0;if(closed)return;
   for(const root of roots)for(const node of root.querySelectorAll('input,textarea,[contenteditable]')){if(!eligible(node)||entries.has(node))continue;const container=node.closest('dialog[open]')||document.body,ui=surface(container),button=document.createElement('button');button.type='button';button.className='mic';button.innerHTML='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg>';button.setAttribute('aria-pressed','false');const label=(node.getAttribute('aria-label')||node.labels?.[0]?.textContent||node.placeholder||node.name||'this box').trim().slice(0,90);button.setAttribute('aria-label','Voice typing: '+label);button.title='Voice typing · '+label;const entry={node,button,ui};button.onpointerdown=event=>event.preventDefault();button.onclick=event=>{event.preventDefault();event.stopPropagation();begin(entry);};ui.shadow.append(button);entries.set(node,entry);}
   const activeDialog=document.querySelector('dialog[open]')||[...document.querySelectorAll('[role=dialog][aria-modal=true]')].reverse().find(node=>node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden');
   for(const [node,entry]of entries){if(!node.isConnected||!eligible(node)){if(session?.entry===entry)stop();entry.button.remove();entries.delete(node);continue;}const r=node.getBoundingClientRect(),visible=r.width>45&&r.height>20&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth&&node.getClientRects().length>0&&getComputedStyle(node).visibility!=='hidden'&&(!activeDialog||activeDialog.contains(node));entry.button.hidden=!visible;if(visible){entry.button.style.left=Math.max(2,Math.min(innerWidth-26,r.right-27))+'px';entry.button.style.top=Math.max(2,r.top+Math.min(5,(r.height-24)/2))+'px';}}
  }
  const queue=()=>{if(!frame&&!closed)frame=requestAnimationFrame(scan);},observer=new MutationObserver(queue),observe=root=>{if(!root||roots.has(root))return;roots.add(root);observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','readonly','hidden','class','open']});queue();};observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','readonly','hidden','class','open']});document.querySelectorAll('[data-no-theme]').forEach(host=>observe(host.shadowRoot));const surfaced=event=>observe(event.detail?.root);window.addEventListener('career-crox-isolated-surface',surfaced);
  const interact=event=>{if(!session)return;const origin=event.composedPath?.()[0]||event.target;if(event.type==='submit'||event.type==='beforeinput'&&event.isTrusted||event.type==='pointerdown'&&origin!==session.entry.node&&![...surfaces.values()].some(ui=>ui.host===event.target||ui.host.contains(event.target)))stop();},visibility=()=>{if(document.hidden)stop();queue();};
  document.addEventListener('beforeinput',interact,true);document.addEventListener('submit',interact,true);document.addEventListener('pointerdown',interact,true);document.addEventListener('visibilitychange',visibility);window.addEventListener('scroll',queue,true);window.addEventListener('resize',queue);queue();
  return()=>{closed=true;stop();cancelAnimationFrame(frame);clearTimeout(tipTimer);observer.disconnect();document.removeEventListener('beforeinput',interact,true);document.removeEventListener('submit',interact,true);document.removeEventListener('pointerdown',interact,true);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('scroll',queue,true);window.removeEventListener('resize',queue);window.removeEventListener('career-crox-isolated-surface',surfaced);for(const ui of surfaces.values())ui.host.remove();};
 },[enabled,principal]);return null;
}
export function BreakRoster(){
 const state=useSyncExternalStore(subscribe,()=>snapshot,()=>snapshot),[open,setOpen]=useState(false),[position,setPosition]=useState({}),anchor=useRef(null),panel=useRef(null);
 const [clock,setClock]=useState(Date.now),overdue=state.items.some(row=>row.expected_end_at&&Date.parse(row.expected_end_at)<=clock);
 useEffect(()=>{setClock(Date.now());const next=state.items.map(row=>Date.parse(row.expected_end_at)).filter(at=>at>Date.now()).sort((a,b)=>a-b)[0];if(!next)return;const timer=setTimeout(()=>setClock(Date.now()),Math.min(2147480000,next-Date.now()+50));return()=>clearTimeout(timer);},[state.items]);
 function place(){const r=anchor.current?.getBoundingClientRect();if(r)setPosition({top:Math.min(innerHeight-110,r.bottom+7),left:Math.max(8,Math.min(innerWidth-306,r.right-300)),maxHeight:Math.max(100,innerHeight-r.bottom-22)});}
 useEffect(()=>{if(!open)return;const outside=e=>{if(!anchor.current?.contains(e.target)&&!panel.current?.contains(e.target))setOpen(false);};const key=e=>{if(e.key==='Escape'){setOpen(false);anchor.current?.focus();}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};},[open]);
 return <><button type="button" ref={anchor} className={"cc911-break-trigger cc123-coffee "+(!state.items.length?"is-idle":overdue?"is-overdue":"is-active")} aria-label="Who's on break" aria-expanded={open} title="Who's on break" onClick={()=>{place();setOpen(!open);if(!open)refreshBreaks();}}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 8h12v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Zm12 1h2a3 3 0 1 1 0 6h-2M7 3v2m4-2v2m4-2v2M2 21h17"/></svg><b>{state.loaded?state.items.length:'·'}</b></button>{open?createPortal(<section ref={panel} style={position} className="cc911-break-panel" role="dialog" aria-label="People currently on break" data-no-copy="1"><header><div><strong>On break <em>{state.loaded?state.items.length:'…'}</em></strong><small>{state.scope==='all'?'All teams':'Your team'}</small></div><button type="button" aria-label="Refresh break list" title="Refresh break list" disabled={state.busy} onClick={refreshBreaks}>↻</button><button type="button" aria-label="Close break list" onClick={()=>setOpen(false)}>×</button></header>{state.busy?<p role="status">Checking latest status…</p>:null}{state.error?<p className="cc911-break-error" role="alert">{state.error} · Refresh to verify.</p>:null}<div className="cc911-break-rows">{state.items.map(row=><div key={row.user_id} className="cc911-break-row"><span className="cc911-break-dot"/><div><strong>{row.full_name}</strong><small>{String(row.role).toUpperCase()} · Since {time(row.started_at)}</small></div>{row.expected_end_at?<span className="cc911-break-until">{Date.parse(row.expected_end_at)<Date.now()?'Over time':'Until '+time(row.expected_end_at)}</span>:null}</div>)}{state.loaded&&!state.items.length&&!state.error?<p>No one is on break.</p>:null}</div><footer>{state.asOf?'Updated '+time(state.asOf):'Waiting for verified status'} · IST</footer></section>,document.body):null}</>;
}
const styles=`
.cc123-coffee.is-idle{opacity:.52!important;filter:saturate(.25)!important}.cc123-coffee.is-idle svg{filter:blur(.7px)!important}.cc123-coffee.is-active{outline:2px solid #ffc25c!important;box-shadow:0 0 11px #e6a53166!important}.cc123-coffee.is-overdue{background:#ffe2d0!important;outline:2px solid #e57958!important}.cc123-coffee.is-overdue svg{animation:cc123-cup .8s ease-in-out infinite!important;transform-origin:50% 85%}@keyframes cc123-cup{0%,100%{transform:rotate(0)}20%,60%{transform:rotate(-13deg)}40%,80%{transform:rotate(13deg)}}@media(prefers-reduced-motion:reduce){.cc123-coffee svg{animation:none!important}}

.cc911-copy-button{position:fixed!important;z-index:2147482000!important;border:1px solid #163aa4!important;background:linear-gradient(120deg,#194acc,#7a37c8)!important;color:#fff!important;-webkit-text-fill-color:#fff!important;border-radius:7px!important;padding:3px 9px!important;min-height:26px!important;height:26px!important;font:750 12px/18px "Segoe UI",sans-serif!important;box-shadow:0 3px 12px #18368842!important;cursor:pointer!important;margin:0!important;width:auto!important;min-width:50px!important;animation:cc911-in .13s ease-out}
.cc911-copy-button[hidden],.cc911-copy-feedback[hidden]{display:none!important}.cc911-copy-button:focus-visible{outline:2px solid #bf95ff!important;outline-offset:2px!important}
.cc911-copy-feedback{position:fixed!important;bottom:18px!important;left:50%!important;transform:translateX(-50%)!important;z-index:2147482001!important;background:#125c43!important;color:white!important;border-radius:10px!important;padding:9px 14px!important;font:700 13px/18px "Segoe UI",sans-serif!important;pointer-events:none!important;box-shadow:0 5px 20px #155d4333!important}
.cc911-break-trigger{position:relative!important;display:inline-grid!important;place-items:center!important;width:31px!important;min-width:31px!important;height:29px!important;min-height:29px!important;border:1px solid #f7c880!important;border-radius:9px!important;background:linear-gradient(135deg,#fff4bc,#ffb64d)!important;color:#7a3d08!important;-webkit-text-fill-color:#7a3d08!important;padding:5px!important;margin:0!important;cursor:pointer!important;box-shadow:0 2px 7px #a1621922!important;flex:none!important;transition:transform .15s ease!important}.cc911-break-trigger:hover{transform:translateY(-1px)!important}.cc911-break-trigger svg{width:18px!important;height:18px!important;stroke:currentColor!important;fill:none!important}.cc911-break-trigger b{position:absolute!important;top:-5px!important;right:-5px!important;min-width:15px!important;height:15px!important;background:#9a3909!important;color:white!important;-webkit-text-fill-color:white!important;border:1px solid #ffecc7!important;border-radius:10px!important;font:800 9px/13px "Segoe UI",sans-serif!important;padding:0 3px!important;text-align:center!important}
.cc911-break-panel{position:fixed!important;z-index:12500!important;display:flex!important;flex-direction:column!important;width:300px!important;max-width:calc(100vw - 16px)!important;border:1px solid #ebc58a!important;border-radius:14px!important;box-shadow:0 13px 40px #43321038!important;background:#fffefb!important;color:#243653!important;font:13px/1.4 "Segoe UI",sans-serif!important;overflow:hidden!important;animation:cc911-in .17s ease-out}
.cc911-break-panel *{box-sizing:border-box!important}.cc911-break-panel header{display:flex!important;align-items:center!important;gap:5px!important;padding:10px 11px!important;background:linear-gradient(100deg,#fff1bc,#ffe3c9)!important;border-bottom:1px solid #f0d5aa!important;flex:none!important}.cc911-break-panel header>div{flex:1!important}.cc911-break-panel header strong{display:block!important;font:800 14px/1.4 "Segoe UI",sans-serif!important;color:#713a0b!important}.cc911-break-panel header small{font-size:11px!important;color:#805d3b!important}.cc911-break-panel em{font-style:normal!important;background:#a64c13!important;color:#fff!important;border-radius:6px!important;padding:0 5px!important;margin-left:3px!important}.cc911-break-panel button{font:700 19px/22px "Segoe UI",sans-serif!important;height:28px!important;width:28px!important;min-height:0!important;padding:0!important;display:grid!important;place-items:center!important;color:#744719!important;background:#fff9e9!important;border:1px solid #e5c792!important;border-radius:7px!important;cursor:pointer!important}.cc911-break-panel button:disabled{opacity:.4!important}.cc911-break-panel p{font:12px/1.4 "Segoe UI",sans-serif!important;margin:10px!important;color:#71819b!important}.cc911-break-panel .cc911-break-error{color:#a1243a!important;background:#fff0f1!important;padding:8px!important;border-radius:7px!important}.cc911-break-rows{overflow:auto!important;min-height:0!important}.cc911-break-row{display:flex!important;align-items:center!important;gap:8px!important;padding:10px!important;border-bottom:1px solid #f0e9dc!important}.cc911-break-row>div{flex:1!important;min-width:0!important}.cc911-break-row strong{display:block!important;font-size:13px!important;font-weight:750!important;color:#263756!important;overflow-wrap:anywhere!important}.cc911-break-row small{font-size:10px!important;color:#7787a0!important}.cc911-break-dot{width:7px!important;height:7px!important;border-radius:50%!important;background:#ee9c2b!important;box-shadow:0 0 0 3px #fff1d4!important;flex:none!important}.cc911-break-until{font-size:10px!important;font-weight:700!important;color:#a34f0d!important;max-width:83px!important;text-align:right!important}.cc911-break-panel footer{padding:7px 10px!important;border-top:1px solid #efe4d4!important;font-size:10px!important;color:#998269!important;flex:none!important}
@keyframes cc911-in{from{opacity:0;translate:0 4px}to{opacity:1;translate:0 0}}@media(prefers-reduced-motion:reduce){.cc911-copy-button,.cc911-break-panel,.cc911-break-trigger{animation:none!important;transition:none!important}}
`;

const copyStyles=`
:host{all:initial;color-scheme:light;font:600 12px/1.3 "Segoe UI",Arial,sans-serif}
*{box-sizing:border-box}.cc911-copy-button{position:fixed;z-index:2147482000;display:flex;align-items:center;justify-content:center;border:1px solid #ffffffdd;background:linear-gradient(135deg,#ffffffcf,#e8edffb8);backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);color:#254e9d;border-radius:8px;padding:3px 9px;height:26px;min-width:50px;font:750 12px/18px "Segoe UI",sans-serif;box-shadow:0 2px 10px #20376220;cursor:pointer;margin:0;transition:background .12s,transform .12s}.cc911-copy-button:hover{background:#f7f9fff0;transform:translateY(-1px)}.cc911-copy-button:focus-visible{outline:2px solid #5269ed;outline-offset:2px}.cc911-copy-button[hidden],.cc911-copy-feedback[hidden]{display:none!important}.cc911-copy-feedback{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:2147482001;background:#e9fff3e8;backdrop-filter:blur(14px);border:1px solid #b7e5ce;color:#155b41;border-radius:10px;padding:9px 14px;font:700 13px/18px "Segoe UI",sans-serif;pointer-events:none;box-shadow:0 5px 20px #155d4320}@media(prefers-reduced-motion:reduce){*{transition:none!important}}
`;
