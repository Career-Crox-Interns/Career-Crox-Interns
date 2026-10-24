import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {useLocation} from 'react-router-dom';
import {useAuth} from '../lib/auth';
import {api} from '../lib/api';

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
 if(!(node instanceof Element)||node.closest('[data-no-copy],.cc911-copy-button,.cc911-copy-feedback'))return null;
 const explicit=node.closest('[data-copy-value]');
 if(explicit)return {anchor:explicit,label:explicit.dataset.copyLabel||'detail',read:()=>explicit.dataset.copyValue??''};
 if(node.closest('button,[role="button"],[role="checkbox"],nav,.sidebar,.topbar'))return null;
 const contact=node.closest('a[href^="mailto:"],a[href^="tel:"]');
 if(contact)return {anchor:contact,label:contact.href.startsWith('mailto:')?'email':'phone',read:()=>decodeURIComponent(contact.getAttribute('href').replace(/^(mailto:|tel:)/,'' ).split('?')[0])};
 const field=node.closest('input,textarea,select,[contenteditable="true"]');
 if(field){
  if(field.matches('input[type="password"],input[type="file"],input[type="hidden"],input[type="checkbox"],input[type="radio"],input[type="submit"],input[type="button"]'))return null;
  const key=field.closest('[data-field]')?.dataset.field||'',label=field.getAttribute('aria-label')||field.labels?.[0]?.textContent||key||field.name||'detail';
  if(forbidden.test([key,field.name,field.id,label,field.autocomplete].join(' ')))return null;
  return {anchor:field,label:String(label).trim(),read:()=>field.tagName==='SELECT'?[...field.selectedOptions].map(o=>o.textContent).join(', '):('value'in field?String(field.value??''):field.textContent||'')};
 }
 const cell=node.closest('td');
 if(cell){
  const head=cell.closest('table')?.tHead?.rows?.[0]?.cells?.[cell.cellIndex]?.textContent||'detail';
  if(/actions|select/i.test(head)||cell.matches('.sticky-actions-cell,.candidate-select-cell')||cell.querySelector('input,textarea,select'))return null;
  let target=cell;
  if(cell.classList.contains('candidate-name-cell'))target=node.closest('.subtle')||cell.querySelector('strong')||cell;
  else target=cell.querySelector('.cc803-cell-ellipsis,[data-full-value]')||cell;
  return {anchor:cell,label:head.trim(),read:()=>target.dataset.fullValue||target.getAttribute('title')||target.textContent||''};
 }
 const detail=node.closest('.candidate-note-body,.candidate-notes-body,.ccqu-latest p,.ccqu-aria-note-preview,p,dd,[data-detail-value]');
 if(detail&&!detail.closest('.cc911-break-panel'))return {anchor:detail,label:/note/i.test(detail.className)?'note':'detail',read:()=>detail.dataset.detailValue??detail.textContent??''};
 const labelField=node.closest('[data-field]');
 if(labelField){const control=labelField.querySelector('input:not([type="hidden"]),textarea,select');if(control)return copyTarget(control);}
 return null;
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
  const button=document.createElement('button');button.type='button';button.className='cc911-copy-button';button.textContent='Copy';button.hidden=true;button.dataset.noCopy='1';document.body.appendChild(button);
  const toast=document.createElement('div');toast.className='cc911-copy-feedback';toast.setAttribute('role','status');toast.hidden=true;document.body.appendChild(toast);
  const place=()=>{if(!active?.anchor?.isConnected){button.hidden=true;return;}const r=active.anchor.getBoundingClientRect();if(r.width<10||r.height<8||r.bottom<0||r.top>innerHeight){button.hidden=true;return;}
   button.style.left=Math.max(4,Math.min(innerWidth-58,r.right-54))+'px';button.style.top=Math.max(4,Math.min(innerHeight-30,r.top+Math.max(0,Math.min(5,(r.height-26)/2))))+'px';button.hidden=false;button.setAttribute('aria-label','Copy '+active.label);
  };
  const show=e=>{if(e.target===button)return;clearTimeout(hideTimer);const found=copyTarget(e.target);if(!found||!String(found.read()??'').trim()){button.hidden=true;active=null;return;}active=found;place();};
  const out=e=>{if(e.relatedTarget===button||button.contains(e.relatedTarget)||active?.anchor.contains(e.relatedTarget))return;clearTimeout(hideTimer);hideTimer=setTimeout(()=>{if(document.activeElement!==button&&!button.matches(':hover')){button.hidden=true;active=null;}},160);};
  const copy=async e=>{e.preventDefault();e.stopPropagation();if(!active?.anchor.isConnected)return;const value=String(active.read()??'');try{if(!value.trim())throw Error('Nothing to copy');await writeClipboard(value);toast.textContent='Copied '+active.label;}catch(error){toast.textContent=error.message;}toast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.hidden=true;},1800);};
  const escape=e=>{if(e.key==='Escape'){active=null;button.hidden=true;}};
  button.addEventListener('pointerenter',()=>clearTimeout(hideTimer));button.addEventListener('mousedown',e=>e.preventDefault());button.addEventListener('click',copy);
  document.addEventListener('pointerover',show,true);document.addEventListener('pointerout',out,true);document.addEventListener('focusin',show,true);document.addEventListener('focusout',out,true);document.addEventListener('keydown',escape,true);window.addEventListener('scroll',place,true);window.addEventListener('resize',place);
  return()=>{clearTimeout(hideTimer);clearTimeout(toastTimer);document.removeEventListener('pointerover',show,true);document.removeEventListener('pointerout',out,true);document.removeEventListener('focusin',show,true);document.removeEventListener('focusout',out,true);document.removeEventListener('keydown',escape,true);window.removeEventListener('scroll',place,true);window.removeEventListener('resize',place);button.remove();toast.remove();};
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
 return <><style>{styles}</style><HoverCopy enabled={enabled} route={location.pathname}/></>;
}
export function BreakRoster(){
 const state=useSyncExternalStore(subscribe,()=>snapshot,()=>snapshot),[open,setOpen]=useState(false),[position,setPosition]=useState({}),anchor=useRef(null),panel=useRef(null);
 function place(){const r=anchor.current?.getBoundingClientRect();if(r)setPosition({top:Math.min(innerHeight-110,r.bottom+7),left:Math.max(8,Math.min(innerWidth-306,r.right-300)),maxHeight:Math.max(100,innerHeight-r.bottom-22)});}
 useEffect(()=>{if(!open)return;const outside=e=>{if(!anchor.current?.contains(e.target)&&!panel.current?.contains(e.target))setOpen(false);};const key=e=>{if(e.key==='Escape'){setOpen(false);anchor.current?.focus();}};document.addEventListener('pointerdown',outside);document.addEventListener('keydown',key);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',key);window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};},[open]);
 return <><button type="button" ref={anchor} className="cc911-break-trigger" aria-label="Who's on break" aria-expanded={open} title="Who's on break" onClick={()=>{place();setOpen(!open);if(!open)refreshBreaks();}}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 8h12v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Zm12 1h2a3 3 0 1 1 0 6h-2M7 3v2m4-2v2m4-2v2M2 21h17"/></svg><b>{state.loaded?state.items.length:'·'}</b></button>{open?createPortal(<section ref={panel} style={position} className="cc911-break-panel" role="dialog" aria-label="People currently on break" data-no-copy="1"><header><div><strong>On break <em>{state.loaded?state.items.length:'…'}</em></strong><small>{state.scope==='all'?'All teams':'Your team'}</small></div><button type="button" aria-label="Refresh break list" title="Refresh break list" disabled={state.busy} onClick={refreshBreaks}>↻</button><button type="button" aria-label="Close break list" onClick={()=>setOpen(false)}>×</button></header>{state.busy?<p role="status">Checking latest status…</p>:null}{state.error?<p className="cc911-break-error" role="alert">{state.error} · Refresh to verify.</p>:null}<div className="cc911-break-rows">{state.items.map(row=><div key={row.user_id} className="cc911-break-row"><span className="cc911-break-dot"/><div><strong>{row.full_name}</strong><small>{String(row.role).toUpperCase()} · Since {time(row.started_at)}</small></div>{row.expected_end_at?<span className="cc911-break-until">{Date.parse(row.expected_end_at)<Date.now()?'Over time':'Until '+time(row.expected_end_at)}</span>:null}</div>)}{state.loaded&&!state.items.length&&!state.error?<p>No one is on break.</p>:null}</div><footer>{state.asOf?'Updated '+time(state.asOf):'Waiting for verified status'} · IST</footer></section>,document.body):null}</>;
}
const styles=`
.cc911-copy-button{position:fixed!important;z-index:2147482000!important;border:1px solid #163aa4!important;background:linear-gradient(120deg,#194acc,#7a37c8)!important;color:#fff!important;-webkit-text-fill-color:#fff!important;border-radius:7px!important;padding:3px 9px!important;min-height:26px!important;height:26px!important;font:750 12px/18px "Segoe UI",sans-serif!important;box-shadow:0 3px 12px #18368842!important;cursor:pointer!important;margin:0!important;width:auto!important;min-width:50px!important;animation:cc911-in .13s ease-out}
.cc911-copy-button[hidden],.cc911-copy-feedback[hidden]{display:none!important}.cc911-copy-button:focus-visible{outline:2px solid #bf95ff!important;outline-offset:2px!important}
.cc911-copy-feedback{position:fixed!important;bottom:18px!important;left:50%!important;transform:translateX(-50%)!important;z-index:2147482001!important;background:#125c43!important;color:white!important;border-radius:10px!important;padding:9px 14px!important;font:700 13px/18px "Segoe UI",sans-serif!important;pointer-events:none!important;box-shadow:0 5px 20px #155d4333!important}
.cc911-break-trigger{position:relative!important;display:inline-grid!important;place-items:center!important;width:31px!important;min-width:31px!important;height:29px!important;min-height:29px!important;border:1px solid #f7c880!important;border-radius:9px!important;background:linear-gradient(135deg,#fff4bc,#ffb64d)!important;color:#7a3d08!important;-webkit-text-fill-color:#7a3d08!important;padding:5px!important;margin:0!important;cursor:pointer!important;box-shadow:0 2px 7px #a1621922!important;flex:none!important;transition:transform .15s ease!important}.cc911-break-trigger:hover{transform:translateY(-1px)!important}.cc911-break-trigger svg{width:18px!important;height:18px!important;stroke:currentColor!important;fill:none!important}.cc911-break-trigger b{position:absolute!important;top:-5px!important;right:-5px!important;min-width:15px!important;height:15px!important;background:#9a3909!important;color:white!important;-webkit-text-fill-color:white!important;border:1px solid #ffecc7!important;border-radius:10px!important;font:800 9px/13px "Segoe UI",sans-serif!important;padding:0 3px!important;text-align:center!important}
.cc911-break-panel{position:fixed!important;z-index:12500!important;display:flex!important;flex-direction:column!important;width:300px!important;max-width:calc(100vw - 16px)!important;border:1px solid #ebc58a!important;border-radius:14px!important;box-shadow:0 13px 40px #43321038!important;background:#fffefb!important;color:#243653!important;font:13px/1.4 "Segoe UI",sans-serif!important;overflow:hidden!important;animation:cc911-in .17s ease-out}
.cc911-break-panel *{box-sizing:border-box!important}.cc911-break-panel header{display:flex!important;align-items:center!important;gap:5px!important;padding:10px 11px!important;background:linear-gradient(100deg,#fff1bc,#ffe3c9)!important;border-bottom:1px solid #f0d5aa!important;flex:none!important}.cc911-break-panel header>div{flex:1!important}.cc911-break-panel header strong{display:block!important;font:800 14px/1.4 "Segoe UI",sans-serif!important;color:#713a0b!important}.cc911-break-panel header small{font-size:11px!important;color:#805d3b!important}.cc911-break-panel em{font-style:normal!important;background:#a64c13!important;color:#fff!important;border-radius:6px!important;padding:0 5px!important;margin-left:3px!important}.cc911-break-panel button{font:700 19px/22px "Segoe UI",sans-serif!important;height:28px!important;width:28px!important;min-height:0!important;padding:0!important;display:grid!important;place-items:center!important;color:#744719!important;background:#fff9e9!important;border:1px solid #e5c792!important;border-radius:7px!important;cursor:pointer!important}.cc911-break-panel button:disabled{opacity:.4!important}.cc911-break-panel p{font:12px/1.4 "Segoe UI",sans-serif!important;margin:10px!important;color:#71819b!important}.cc911-break-panel .cc911-break-error{color:#a1243a!important;background:#fff0f1!important;padding:8px!important;border-radius:7px!important}.cc911-break-rows{overflow:auto!important;min-height:0!important}.cc911-break-row{display:flex!important;align-items:center!important;gap:8px!important;padding:10px!important;border-bottom:1px solid #f0e9dc!important}.cc911-break-row>div{flex:1!important;min-width:0!important}.cc911-break-row strong{display:block!important;font-size:13px!important;font-weight:750!important;color:#263756!important;overflow-wrap:anywhere!important}.cc911-break-row small{font-size:10px!important;color:#7787a0!important}.cc911-break-dot{width:7px!important;height:7px!important;border-radius:50%!important;background:#ee9c2b!important;box-shadow:0 0 0 3px #fff1d4!important;flex:none!important}.cc911-break-until{font-size:10px!important;font-weight:700!important;color:#a34f0d!important;max-width:83px!important;text-align:right!important}.cc911-break-panel footer{padding:7px 10px!important;border-top:1px solid #efe4d4!important;font-size:10px!important;color:#998269!important;flex:none!important}
@keyframes cc911-in{from{opacity:0;translate:0 4px}to{opacity:1;translate:0 0}}@media(prefers-reduced-motion:reduce){.cc911-copy-button,.cc911-break-panel,.cc911-break-trigger{animation:none!important;transition:none!important}}
`;
