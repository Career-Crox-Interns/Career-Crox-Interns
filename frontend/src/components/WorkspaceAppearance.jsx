import React, {Children,Fragment,cloneElement,isValidElement,useId,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {useLocation} from 'react-router-dom';
import {useAuth} from '../lib/auth';
import {useDashboardScope} from '../lib/dashboardScope';
import {applyPersonalSettings, readPersonalSettings, savePersonalSettings, allowedCursors, cursorUrl, pointerUrl} from '../lib/personalSettings';
import '../styles/genz-motion.css';
import {api,accountPrincipal,reportWriteFailure,shouldReportWriteFailure,trackUserWrite,hasPendingUserWrite,resolveWriteFailure} from '../lib/api';
import {CrmSortSelect} from '../lib/workspaceHelpers';

const BLUE='#169ce0';
const validColour=value=>/^#[0-9a-f]{6}$/i.test(value||'');
const eligible=user=>Boolean(user?.user_id)&&allowedCursors(user.role).length>0;
const selected=(p,user)=>allowedCursors(user?.role).find(c=>c[0]===p.cursor)||allowedCursors(user?.role)[0];
const original=`<svg xmlns="http://www.w3.org/2000/svg" width="28" height="32" viewBox="0 0 28 32"><path d="M5 3 L23 21 L15 22 L11 30 Z" fill="${BLUE}" stroke="#fff" stroke-width="1.1" stroke-linejoin="miter"/></svg>`;
function source(id,hand=false){
 const url=hand?pointerUrl(id):cursorUrl(id);
 const text=id==='cc922-precision'?original:decodeURIComponent(url.slice(url.indexOf(',')+1));
 return new DOMParser().parseFromString(text,'image/svg+xml').documentElement;
}
function options(p,id){
 const saved=p.cursorAppearance?.[id]||{};
 const svg=source(id),base=Number(svg.getAttribute('width'))||34;
 const legacy=id==='cc922-precision';
 const rawSize=saved.size??(legacy?p.cursorSize:undefined);
 const rawColour=saved.colour??(legacy?p.cursorColour:undefined);
 return {size:Math.max(18,Math.min(64,Math.round(Number(rawSize)||base))),colour:validColour(rawColour)?rawColour:'',base};
}
function tint(old,base){
 if(!/^#[0-9a-f]{6}$/i.test(old)||/^#(?:ffffff|000000)$/i.test(old))return old;
 const rgb=hex=>[1,3,5].map(n=>parseInt(hex.slice(n,n+2),16));
 const light=rgb(old).reduce((a,b)=>a+b,0)/765;
 const amount=light>.5?(light-.5)*1.1:(.5-light)*.5;
 const to=light>.5?255:0;
 return '#'+rgb(base).map(n=>Math.round(n*(1-amount)+to*amount).toString(16).padStart(2,'0')).join('');
}
function asset(p,id,hand=false){
 const svg=source(id,hand),o=options(p,id);
 const width=Number(svg.getAttribute('width'))||o.base;
 const height=Number(svg.getAttribute('height'))||44;
 if(!svg.hasAttribute('viewBox'))svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
 svg.setAttribute('width',String(o.size));
 svg.setAttribute('height',String(Math.round(height*o.size/width)));
 if(o.colour){
  for(const node of [svg,...svg.querySelectorAll('*')]){
   for(const key of ['fill','stop-color']){
    const old=node.getAttribute(key);
    if(old&&/^#[0-9a-f]{6}$/i.test(old))node.setAttribute(key,tint(old,o.colour));
   }
  }
 }
 const x=hand&&id==='cc922-reference'?7:id==='cc922-precision'?5:2;
 const y=id==='cc922-precision'?3:1;
 return {url:'data:image/svg+xml,'+encodeURIComponent(new XMLSerializer().serializeToString(svg)),x:Math.round(x*o.size/width),y:Math.round(y*o.size/width),size:o.size,height:Math.round(height*o.size/width)};
}
function applyCursor(p,user){
 const root=document.documentElement;
 const choice=eligible(user)&&selected(p,user);
 root.toggleAttribute('data-cc923-precision',Boolean(choice));
 if(!choice)return;
 const id=choice[0],arrow=asset(p,id),hand=asset(p,id,true);
 root.style.setProperty('--cc923-arrow',`url("${arrow.url}") ${arrow.x} ${arrow.y},auto`);
 root.style.setProperty('--cc923-point',`url("${hand.url}") ${hand.x} ${hand.y},pointer`);
}
function CursorControls({user}){
 const [p,setP]=useState(readPersonalSettings);
 const [status,setStatus]=useState('');
 useEffect(()=>{
  const sync=()=>setP(readPersonalSettings());
  window.addEventListener('cc787-settings-changed',sync);window.addEventListener('storage',sync);
  return()=>{window.removeEventListener('cc787-settings-changed',sync);window.removeEventListener('storage',sync);};
 },[]);
 const choice=selected(p,user);
 if(!choice)return null;
 const id=choice[0],o=options(p,id),preview=asset(p,id);
 const initial=source(id).querySelector('[stop-color]')?.getAttribute('stop-color')||source(id).querySelector('[fill]')?.getAttribute('fill')||BLUE;
 const change=patch=>{
  const latest=readPersonalSettings(),current=selected(latest,user);
  if(!current)return;
  const key=current[0],previous=options(latest,key);
  const next=savePersonalSettings({cursorAppearance:{...latest.cursorAppearance,[key]:{size:previous.size,colour:previous.colour,...patch}}});
  applyCursor(next,user);setP(next);setStatus('Saved for this cursor on this browser');
 };
 return <section aria-label="Selected cursor appearance" style={{marginTop:18,padding:18,border:'1px solid #c7d8ec',borderRadius:16,background:'#fff',color:'#173654'}}>
  <h3 style={{margin:'0 0 8px'}}>Selected cursor: {choice[1]}</h3>
  <p style={{margin:'0 0 12px',fontSize:13}}>Colour aur size isi selected design ke liye save honge.</p>
  <div style={{display:'flex',gap:18,alignItems:'center',flexWrap:'wrap'}}>
   <img src={preview.url} alt="Selected cursor preview" width={preview.size} height={preview.height}/>
   <label>Cursor colour<input aria-label="Cursor colour" type="color" value={o.colour||(validColour(initial)?initial:BLUE)} onChange={e=>change({colour:e.target.value})}/></label>
   <label>Cursor size: {o.size}px<input aria-label="Cursor size" type="range" min="18" max="64" step="1" value={o.size} onChange={e=>change({size:Number(e.target.value)})}/></label>
   <button type="button" className="ghost-btn" onClick={()=>change({colour:'',size:o.base})}>Reset selected cursor</button>
  </div>
  <small role="status" aria-live="polite">{status}</small>
 </section>;
}

export function GlobalTextToneOverride(){
 useLayoutEffect(()=>{document.getElementById('crm-global-text-tone-override')?.remove();},[]);
 return null;
}

export function PersonalSettingsBridge(){
 const {user,theme}=useAuth();
 const location=useLocation();
 const [host,setHost]=useState(null);
 useLayoutEffect(()=>{document.documentElement.dataset.cc825Page=location.pathname.split('/')[1]||'home';},[location.pathname]);
 useLayoutEffect(()=>{
  const apply=()=>{
   if(user){const p=readPersonalSettings();applyPersonalSettings(p,theme,user.role);applyCursor(p,user);}
   else document.documentElement.removeAttribute('data-cc923-precision');
  };
  apply();
  window.addEventListener('cc787-settings-changed',apply);
  const storage=e=>{if(!e.key||e.key.startsWith('cc787:preferences:')||['careerCroxTheme','careerCroxCustomTheme','careerCroxCachedUser'].includes(e.key))apply();};
  window.addEventListener('storage',storage);
  return()=>{window.removeEventListener('cc787-settings-changed',apply);window.removeEventListener('storage',storage);};
 },[user,theme]);
 useLayoutEffect(()=>{
  setHost(null);
  if(location.pathname!=='/settings'||!eligible(user))return;
  let mount=null;
  const attach=()=>{
   const panel=document.querySelector('#cc791-panel-interaction .cc787-settings-section');
   if(!panel){if(mount){mount.remove();mount=null;setHost(null);}return;}
   if(mount?.isConnected)return;
   mount=document.createElement('div');panel.appendChild(mount);setHost(mount);
  };
  const observer=new MutationObserver(attach);
  observer.observe(document.getElementById('root')||document.body,{childList:true,subtree:true});attach();
  return()=>{observer.disconnect();mount?.remove();};
 },[location.pathname,user?.user_id,user?.role]);
 return <>
  <style>{`
   html#cc787-workspace#cc787-workspace[data-cc923-precision]{--cc922-cursor:var(--cc923-arrow)!important;--cc922-pointer:var(--cc923-point)!important}
   html#cc787-workspace#cc787-workspace[data-cc923-precision] body:not(.login-body),
   html#cc787-workspace#cc787-workspace[data-cc923-precision] body:not(.login-body) *:not(input):not(textarea):not([contenteditable="true"]){cursor:var(--cc922-cursor)!important}
   html#cc787-workspace#cc787-workspace[data-cc923-precision][data-theme][data-cc787-cursor] body :is(button,a,summary,select,[role="button"]),
   html#cc787-workspace#cc787-workspace[data-cc923-precision][data-theme][data-cc787-cursor] body :is(button,a,summary,[role="button"]) *{cursor:var(--cc922-pointer)!important}
   html#cc787-workspace#cc787-workspace[data-cc923-precision] body :is(textarea,[contenteditable="true"],input:not([type="color"]):not([type="range"]):not([type="checkbox"]):not([type="radio"])){cursor:text!important}
  `}</style>
  {host?createPortal(<CursorControls key={user?.user_id} user={user}/>,host):null}
 </>;
}

export function GenZMotionLayer(){
 const location=useLocation();
 useEffect(()=>{
  const body=document.body;
  body.classList.remove('cc-genz-motion-enabled','cc-no-morph-motion');body.classList.add('cc785-premium-motion');
  return()=>body.classList.remove('cc785-premium-motion');
 },[]);
 useEffect(()=>{
  const page=document.querySelector('.cc785-route-content');
  if(!page||document.documentElement.dataset.cc787Motion==='reduced'||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const motion=page.animate([{transform:'translateY(3px)'},{transform:'translateY(0)'}],{duration:160,easing:'cubic-bezier(.2,.7,.2,1)'});
  return()=>motion.cancel();
 },[location.pathname]);
 return null;
}


// Shared table tools stay next to the table, below the dashboard cards.
const FILTER_BLOCKS=new Set(['cc88-filter-panel','interview-quick-filter-strip','interview-sort-strip','bucket-quick-filter-row','bucket-inline-filter-grid','cc918-filters','notification-filter-strip','goal-filter-panel','cc826-activity-filters','cc434-filter','candidate-recruiter-shell','cc873-sort']);
const textOf=value=>Children.toArray(value).map(child=>typeof child==='string'||typeof child==='number'?String(child):isValidElement(child)&&!['option','select','svg','style'].includes(child.type)?textOf(child.props.children):'').join(' ').replace(/\s+/g,' ').trim();
function inspect(node,result,label=''){
 Children.forEach(node,child=>{
  if(!isValidElement(child))return;const p=child.props||{},caption=textOf(p.children),name=p.label||p['aria-label']||(child.type==='label'?caption:label)||p.name||'Filter';
  if(child.type==='button'&&/^(?:reset\s*(?:all|filters)?|clear filters)$/i.test(caption)&&p.onClick)result.reset.add(p.onClick);
  if(child.type==='button'&&/^more filters\b/i.test(caption)&&p.onClick)result.more.add(p.onClick);
  if(p.value!==undefined&&p.onChange&&!p.disabled&&!p.readOnly&&!/find a filter|search (?:filter|options)|sort|date type|date based/i.test(name)){
   const value=Array.isArray(p.value)?p.value.join(', '):String(p.value??'');
   if(value&&!['all','any','default','interview_date'].includes(value.toLowerCase()))result.values.set(name+'|'+value,{label:name,value});
  }
  inspect(p.children,result,name);
 });
}
function originalRef(ref,node){if(typeof ref==='function')ref(node);else if(ref&&typeof ref==='object')ref.current=node;}
function containsFilterDialog(nodes){return Children.toArray(nodes).some(node=>isValidElement(node)&&(/filter.*modal|modal.*filter|filter.*drawer/i.test(String(node.props.className||''))||/filter/i.test(node.props['aria-label']||'')||containsFilterDialog(node.props.children)));}
const tableHash=value=>{let hash=2166136261;for(const c of value)hash=Math.imul(hash^c.charCodeAt(0),16777619);return (hash>>>0).toString(16);};
const SharedTablesContext=React.createContext(null);
// The Vite JSX transform routes native tables here, including tables inside child components.
// React still owns every cell; changing order never moves DOM nodes behind React's back.
export function ManagedWorkspaceTable(props){const shared=React.useContext(SharedTablesContext);const node=React.createElement('table',props);return shared?<SharedTable node={node} {...shared}/>:node;}
function SharedTable({node,layouts,onSave,manager,query='',ordinal=0}){
 const head=Children.toArray(node.props.children).find(n=>isValidElement(n)&&n.type==='thead');
 const headings=Children.toArray(head?.props?.children).filter(n=>isValidElement(n)&&n.type==='tr').at(-1);
 const cells=Children.toArray(headings?.props?.children),seen=new Map(),labels=cells.map((cell,i)=>{let name=(textOf(cell.props?.children)||('Column '+i)).toLowerCase();if(/^(?:client \/ process|process)$/.test(name))name='process';const n=seen.get(name)||0;seen.set(name,n+1);return name+(n?'#'+n:'');});
 const tableKey='t-'+tableHash(location.pathname+'|'+(node.props.id||node.props['data-table-key']||String(node.props.className||'').split(/\s+/).filter(Boolean).slice(0,2).join(' ')||'table-'+ordinal));
 const stored=layouts[tableKey],order=[...(stored?.columns||[]).filter(k=>labels.includes(k)),...labels.filter(k=>!(stored?.columns||[]).includes(k))];
 const indices=order.map(k=>labels.indexOf(k)),[drag,setDrag]=useState(''),[saving,setSaving]=useState(false);
 const move=async(from,to)=>{if(saving||!manager||from===to||!order.includes(from)||!order.includes(to))return;const columns=order.filter(k=>k!==from);columns.splice(columns.indexOf(to),0,from);setSaving(true);try{await onSave(tableKey,columns,stored?.revision||0);}finally{setSaving(false);setDrag('');}};
 function transform(nodes){return Children.map(nodes,child=>{
  if(!isValidElement(child))return child;
  if(child.type==='tr'){
   const row=Children.toArray(child.props.children),plain=row.length===labels.length&&row.every(c=>isValidElement(c)&&Number(c.props.colSpan||1)===1&&Number(c.props.rowSpan||1)===1);
   if(query&&row.some(c=>c.type==='td')&&!textOf(child.props.children).toLocaleLowerCase().includes(query.toLocaleLowerCase()))return null;
   if(!plain)return child;
   return cloneElement(child,undefined,indices.map(index=>{const cell=row[index],id=labels[index];return cell.type==='th'?cloneElement(cell,{key:id,'data-column-key':id,draggable:manager&&!saving,tabIndex:manager?0:cell.props.tabIndex,title:manager?'Drag to arrange columns for everyone. Alt + Left/Right also moves this column.':cell.props.title,onDragStart:e=>{e.stopPropagation();e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/cc929-column',id);setDrag(id);},onDragOver:e=>{if(manager&&drag){e.preventDefault();e.dataTransfer.dropEffect='move';}},onDrop:e=>{e.preventDefault();e.stopPropagation();move(e.dataTransfer.getData('text/cc929-column')||drag,id);},onDragEnd:()=>setDrag(''),onKeyDown:e=>{if(manager&&e.altKey&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const target=order[order.indexOf(id)+(e.key==='ArrowLeft'?-1:1)];if(target)move(id,target);}else cell.props.onKeyDown?.(e);}}):cloneElement(cell,{key:id});}));
  }
  if(child.type==='colgroup'){const cols=Children.toArray(child.props.children);return cols.length===indices.length?cloneElement(child,undefined,indices.map(i=>cols[i])):child;}
  return child.props.children===undefined?child:cloneElement(child,undefined,transform(child.props.children));
 });}
 return cloneElement(node,{'data-cc929-table':tableKey,'aria-busy':saving||undefined},transform(node.props.children));
}
export default function CompactFilters({children}){
 const {user}=useAuth(),route=useLocation(),[open,setOpen]=useState(false),[searchOpen,setSearchOpen]=useState(false),[query,setQuery]=useState(''),[bound,setBound]=useState(false),[layouts,setLayouts]=useState({}),[layoutNotice,setLayoutNotice]=useState('');
 const searchTimer=useRef(),uid=useId(),blocks=[],openers=[],summary={values:new Map(),declared:0,reset:new Set(),more:new Set()};let advancedVisible=false,tableOrdinal=0;
 useEffect(()=>{const read=()=>{const b=window.__CC929_SLICE_SEARCH__;setBound(b?.path===route.pathname);if(b?.path===route.pathname)setQuery(b.query||'');};read();window.addEventListener('cc929-slice-search-ready',read);return()=>window.removeEventListener('cc929-slice-search-ready',read);},[route.pathname]);
 useEffect(()=>{if(!user?.user_id)return;let live=true;const load=(force=false)=>api.get('/api/ui/table-layouts',{cacheTtlMs:force?0:300000,allowStale:false,retries:0}).then(r=>{if(live)setLayouts(previous=>{const next={...previous};for(const [key,value] of Object.entries(r.layouts||{}))if(Number(value.revision||0)>=Number(next[key]?.revision||0))next[key]=value;return next;});}).catch(()=>{});load();const changed=e=>{if((e.detail?.source||e.detail?.path)==='/ui/table-layouts')load(true);};window.addEventListener('career-crox-workspace-change',changed);return()=>{live=false;window.removeEventListener('career-crox-workspace-change',changed);};},[user?.user_id]);
 useEffect(()=>()=>clearTimeout(searchTimer.current),[]);
 function search(value){setQuery(value);clearTimeout(searchTimer.current);const b=window.__CC929_SLICE_SEARCH__;if(b?.path===route.pathname){if(!value)b.set(value);else searchTimer.current=setTimeout(()=>b.set(value),180);}}
 async function saveColumns(key,columns,revision){try{const r=await api.post('/api/ui/table-layouts',{key,columns,expected_revision:revision},{retries:0});if(!r.ok||!r.item)throw Error('Column order was not confirmed.');setLayouts(p=>({...p,[key]:r.item}));setLayoutNotice('Column order saved for everyone');window.dispatchEvent(new CustomEvent('career-crox-workspace-change',{detail:{source:'/ui/table-layouts',key}}));}catch(e){setLayoutNotice('Column order was not saved: '+e.message);reportWriteFailure(e,{force:true,path:'/api/ui/table-layouts'});}}
 function conceal(node,key){const id=node.props.id||uid+'-block-'+blocks.length;blocks.push(id);inspect(node,summary);if(typeof node.type!=='string')return <div key={key} id={id} data-cc926-filter-block="" hidden={!open} style={{display:open?'contents':'none'}}>{node}</div>;const ref=node.ref,display=node.props.style?.display;return cloneElement(node,{id,'data-cc926-filter-block':'',hidden:!open,ref:el=>{originalRef(ref,el);if(el){if(!open)el.style.setProperty('display','none','important');else if(display)el.style.setProperty('display',display);else el.style.removeProperty('display');}}});}
 function walk(nodes,path='root'){return Children.map(nodes,(node,index)=>{
  if(node?.$$typeof===Symbol.for('react.portal'))return createPortal(walk(node.children,path+'.portal'),node.containerInfo,node.key);
  if(!isValidElement(node))return node;const p=node.props||{},type=node.type,classes=String(p.className||'').split(/\s+/),key=path+'.'+index;
  if(p.role==='dialog'||p['aria-modal']||classes.some(c=>/modal|backdrop|overlay/.test(c))){if(classes.some(c=>/filter/.test(c))||/filter/i.test(p['aria-label']||'')||containsFilterDialog(p.children)){advancedVisible=true;inspect(node,summary);}return node;}
  if(type==='table')return <SharedTable key={node.key||key} node={node} ordinal={tableOrdinal++} layouts={layouts} onSave={saveColumns} manager={['manager','admin'].includes(String(user?.role).toLowerCase())} query={bound?'':query}/>;
  if(p['data-cc926-keep']||['thead','tbody','tr','form'].includes(type))return node;
  if(type===CrmSortSelect||classes.some(c=>FILTER_BLOCKS.has(c)))return conceal(node,key);
  const caption=type==='button'?textOf(p.children):'';
  if(type==='button'&&/^(?:filters?|reset\s*(?:all|filters)?|clear filters)$/i.test(caption)){if(/^filters?$/i.test(caption)&&p.onClick)openers.push(p.onClick);return conceal(/^filters?$/i.test(caption)?cloneElement(node,{children:'Advanced filters'}):node,key);}
  if(classes.includes('filters')&&/^\d+\s+filters$/i.test(textOf(p.children))){summary.declared=Math.max(summary.declared,parseInt(textOf(p.children),10)||0);return null;}
  return p.children===undefined?node:cloneElement(node,undefined,walk(p.children,key));
 });}
 let content=walk(children);if(query)summary.values.set('slice-query',{label:'Search',value:query});const active=Math.max(summary.values.size,summary.declared),expanded=open||advancedVisible;
 const chips=<div className="cc929-active-filters" role="status" aria-label="Applied filters">{summary.values.size?[...summary.values.values()].map((f,i)=><span key={i}><b>{f.label}</b>: {f.value}</span>):<span>{active?active+' filters applied - current selections are shown below':'No additional filters applied'}</span>}</div>;
 function toggle(event){if(open){setOpen(false);return;}if(openers.length){openers[0](event);return;}for(const more of summary.more)more(event);setOpen(true);}
 const tools=<div className="cc926-filter-tools" role="group" aria-label="Page filters and search"><button type="button" className={'cc926-filter-toggle cc929-search-toggle'+(searchOpen?' is-open':'')} aria-label="Search this slice" aria-expanded={searchOpen} onClick={()=>setSearchOpen(v=>!v)}><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="m15 15 5 5" stroke="currentColor" strokeWidth="1.8"/></svg></button>{searchOpen?<label className="cc929-slice-search"><input autoFocus aria-label="Search in this slice" placeholder={bound?'Name, phone or profile ID…':'Search shown records…'} value={query} onChange={e=>search(e.target.value)}/>{query&&<button type="button" aria-label="Clear slice search" onClick={()=>search('')}>×</button>}</label>:null}{blocks.length>0?<><button type="button" className={'cc926-filter-toggle '+(expanded?'is-open ':'')+(active?'has-active':'')} aria-label={expanded?'Hide page filters':'Show page filters'} aria-expanded={expanded} aria-controls={openers.length?undefined:blocks.join(' ')} onClick={toggle}><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 5h16l-6.5 7.5V19l-3-1.5v-5z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/></svg>{active>0&&<b className="cc929-filter-count">{active}</b>}</button><span className="cc926-filter-summary">{active?active+' active':'Filters'}</span>{active>0&&summary.reset.size>0?<button type="button" className="cc926-clear" onClick={e=>{for(const reset of summary.reset)reset(e);search('');}}>Clear</button>:null}</>:null}{layoutNotice?<small role="status">{layoutNotice}</small>:null}{expanded&&!advancedVisible?chips:null}</div>;
 let inserted=false;const hasMarker=nodes=>Children.toArray(nodes).some(n=>isValidElement(n)&&(n.props['data-cc929-tools']||hasMarker(n.props.children)));const marked=hasMarker(content);
 function inject(nodes){return Children.map(nodes,n=>{if(n?.$$typeof===Symbol.for('react.portal'))return createPortal(inject(n.children),n.containerInfo,n.key);if(!isValidElement(n))return n;const p=n.props||{},classes=String(p.className||'');if(!inserted&&(marked?p['data-cc929-tools']:/table-toolbar|cc814-stage-pills|cc814-toolbar/.test(classes))){inserted=true;return cloneElement(n,undefined,p.children,tools);}if(n.type===SharedTable||n.type===ManagedWorkspaceTable){if(inserted)return n;inserted=true;return <Fragment key={n.key}>{tools}{n}</Fragment>;}/* Advanced dialogs own their header, summary and grid rows. */return p.children===undefined?n:cloneElement(n,undefined,inject(p.children));});}
 content=inject(content);return <SharedTablesContext.Provider value={{layouts,onSave:saveColumns,manager:['manager','admin'].includes(String(user?.role).toLowerCase()),query:bound?'':query}}><style>{styles}</style>{content}{!inserted&&(blocks.length||bound)?tools:null}</SharedTablesContext.Provider>;
}
const styles=`
html#cc787-workspace body .cc926-filter-tools{display:flex!important;align-items:center;justify-content:flex-end;gap:7px;min-height:34px;margin-left:auto;padding:2px;color:#58677d;font:400 11px/1.4 "Segoe UI",Arial,sans-serif;flex-wrap:wrap}
html#cc787-workspace body .cc926-filter-tools .cc926-filter-toggle{position:relative;display:inline-flex!important;align-items:center;justify-content:center;width:32px!important;height:32px!important;min-width:32px!important;min-height:32px!important;padding:6px!important;border:1px solid #c9d5eb!important;border-radius:10px!important;background:linear-gradient(135deg,#f9fcff,#e7eefe)!important;color:#435bb2!important;box-shadow:0 2px 7px #6272a316!important;cursor:pointer;flex:none}
html#cc787-workspace body .cc926-filter-toggle.has-active{background:linear-gradient(135deg,#ffe8d9,#f8d3e5)!important;border-color:#d66d98!important;animation:cc929-filter-bounce 2.7s ease-in-out infinite}
html#cc787-workspace body .cc926-filter-toggle:is(:hover,:focus-visible,.is-open){animation:none;outline-offset:2px}
.cc929-filter-count{position:absolute;right:-4px;top:-6px;background:#ac2851;color:white;border-radius:10px;min-width:15px;padding:1px 3px;font-size:9px}
.cc929-active-filters{display:flex;gap:6px;flex-wrap:wrap;flex-basis:100%;padding:8px 2px}.cc929-active-filters>span{font:400 12px/1.5 "Segoe UI",sans-serif!important;background:#e8f4eb!important;color:#245a45!important;border:1px solid #b5d6c4;border-radius:9px;padding:5px 9px;max-width:100%;overflow-wrap:anywhere}.cc929-active-filters b{font-weight:600}
.cc929-slice-search{display:flex!important;align-items:center;gap:3px;background:white;border:1px solid #b7c9df;border-radius:10px;padding:3px 7px!important;margin:0!important}.cc929-slice-search input{width:210px!important;max-width:35vw;border:0!important;background:white!important;font:400 13px "Segoe UI",sans-serif!important;padding:5px!important}.cc929-slice-search button{border:0;background:white;color:#914258;padding:3px}
html#cc787-workspace body .cc926-filter-summary{font:400 11px/1.4 "Segoe UI",Arial,sans-serif!important;white-space:nowrap;color:#58677d!important}.cc926-clear{padding:4px 8px!important;border-radius:8px!important;background:white!important;border:1px solid #d9e1ef!important;font-size:11px!important}
[data-cc926-filter-block][hidden]{display:none!important}th[draggable=true]{cursor:grab!important}th[draggable=true]:active{cursor:grabbing!important}table[aria-busy=true]{opacity:.7}
@keyframes cc929-filter-bounce{0%,65%,100%{transform:translateY(0) rotate(0)}72%{transform:translateY(-3px) rotate(-7deg)}80%{transform:translateY(0) rotate(7deg)}88%{transform:translateY(-1px) rotate(0)}}
@media(prefers-reduced-motion:reduce){.cc926-filter-toggle{animation:none!important}}
`;


export function LostProfilesCard(){
 const scope=useDashboardScope();
 const {user}=useAuth(),route=useLocation(),manager=['manager','admin'].includes(String(user?.role).toLowerCase());
 const [open,setOpen]=useState(()=>new URLSearchParams(location.search).get('lost')==='1'),[data,setData]=useState({items:[],total:0,counts:{}}),[query,setQuery]=useState(''),[group,setGroup]=useState('all'),[page,setPage]=useState(1),[busy,setBusy]=useState(false),[asking,setAsking]=useState(''),[message,setMessage]=useState(''),[reason,setReason]=useState({}),[history,setHistory]=useState({}),[expanded,setExpanded]=useState({});
 const sequence=useRef(0),loadRef=useRef(null);
 const date=value=>{if(!value)return 'Not set';let raw=String(value);if(/^\d{4}-\d\d-\d\d$/.test(raw))raw+='T00:00:00+05:30';else if(!/(Z|[+-]\d\d:?\d\d)$/.test(raw))raw=raw.replace(' ','T')+'+05:30';const d=new Date(raw);return Number.isFinite(d.getTime())?d.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):value;};
 useEffect(()=>{if(new URLSearchParams(route.search).get('lost')==='1')setOpen(true);},[route.search]);
 useEffect(()=>{window.dispatchEvent(new Event('cc922-reminder-pauses-changed'));return()=>window.dispatchEvent(new Event('cc922-reminder-pauses-changed'));},[open]);
 async function load(){
  const ticket=++sequence.current;setBusy(true);setMessage('');
  try{const result=await api.get('/api/workspace/lost-profiles?'+new URLSearchParams({...(open?{}:{count_only:'1'}),q:query,group,page:String(page)}),{cacheTtlMs:0,allowStale:false,retries:1,background:true});if(ticket===sequence.current)setData(current=>({...result,items:open?result.items||[]:current.items||[]}));}
  catch(e){if(ticket===sequence.current)setMessage(e.message||'Lost profiles could not load. Tap Refresh.');}finally{if(ticket===sequence.current)setBusy(false);}
 }
 loadRef.current=load;
 useEffect(()=>{const timer=setTimeout(()=>load(),query?160:0);return()=>{clearTimeout(timer);sequence.current++;};},[open,query,page,group,user?.user_id,scope]);
 useEffect(()=>{setData({items:[],total:0,counts:{}});setHistory({});setExpanded({});},[user?.user_id,scope]);
 useEffect(()=>{
  let timer;const refresh=()=>{clearTimeout(timer);timer=setTimeout(()=>loadRef.current?.(),80);},changed=event=>{if(/candidate|access|ownership|profile|interview/.test(event.detail?.source||event.detail?.path||''))refresh();};
  window.addEventListener('career-crox-access-changed',refresh);window.addEventListener('career-crox-workspace-change',changed);window.addEventListener('career-crox-data-written',changed);window.addEventListener('focus',refresh);
  return()=>{clearTimeout(timer);window.removeEventListener('career-crox-access-changed',refresh);window.removeEventListener('career-crox-workspace-change',changed);window.removeEventListener('career-crox-data-written',changed);window.removeEventListener('focus',refresh);};
 },[user?.user_id]);
 useEffect(()=>{const at=Date.parse(data.next_expiry_at);if(!Number.isFinite(at)||at<=Date.now())return;const timer=setTimeout(()=>loadRef.current?.(),Math.min(2147480000,at-Date.now()+100));return()=>clearTimeout(timer);},[data.next_expiry_at]);
 async function ask(row){setAsking(row.candidate_id);setMessage('');try{const result=await api.post('/api/workspace/lost-profiles/'+encodeURIComponent(row.candidate_id)+'/request',{note:reason[row.candidate_id]||''},{retries:0,headers:{'X-CC-Dashboard-User':'global'}});if(!result.ok)throw Error('Access request was not confirmed.');await load();setMessage('Request sent. Your manager will review it in Approvals.');}catch(e){setMessage(e.message);}finally{setAsking('');}}
 async function notes(row,more=false){const cid=row.candidate_id,prior=history[cid];if(!more)setExpanded(value=>({...value,[cid]:!value[cid]}));if(!more&&prior)return;try{const result=await api.get('/api/workspace/lost-profiles/'+encodeURIComponent(cid)+'/notes'+(more&&prior?.next_before?'?before='+encodeURIComponent(prior.next_before):''),{cacheTtlMs:0,retries:0,headers:{'X-CC-Dashboard-User':'global'}});setHistory(value=>({...value,[cid]:{items:more?[...(value[cid]?.items||[]),...(result.items||[])]:result.items||[],next_before:result.next_before}}));}catch(e){setMessage(e.message);}}
 const names=[['all','All profiles'],['upcoming','Upcoming interview'],['missed','Missed interview'],['no_date','No interview date'],['completed','Updated / completed']];
 return <><button type="button" className="stat-card bucket-click-card purple cc929-lost-card" data-cc926-keep="true" onClick={()=>{setOpen(true);setPage(1);}} style={{background:'linear-gradient(135deg,#eee6ff,#e9f0ff)',border:'1px solid #cfc2e5',borderRadius:14,padding:12,textAlign:'left',color:'#503969'}}><strong style={{display:'block',fontSize:25}}>{data.counts?.all??data.total??0}</strong><span>Lost Profiles</span><small style={{display:'block',fontSize:12}}>Dates · notes · access requests</small></button>{open?createPortal(<div id="cc929-lost" className="crm-modal-backdrop" data-cc926-keep="true"><section role="dialog" aria-modal="true" aria-labelledby="cc929-lost-title"><header><div><h2 id="cc929-lost-title">Lost Profiles</h2><p>Interview dates, submission dates and notes stay available here.</p></div><button type="button" aria-label="Close Lost Profiles" onClick={()=>setOpen(false)}>×</button></header><nav className="cc123-lost-slices" aria-label="Lost profile categories">{names.map(([key,label])=><button type="button" key={key} aria-pressed={group===key} onClick={()=>{setGroup(key);setPage(1);}}><strong>{data.counts?.[key]||0}</strong><span>{label}</span></button>)}</nav><div className="cc929-lost-tools"><input aria-label="Search lost profiles" placeholder="Name or candidate ID…" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}}/><button type="button" disabled={busy} onClick={load}>{busy?'Updating…':'↻ Refresh'}</button>{manager?<a href="/approvals">Access requests → Approvals</a>:null}<small>Latest interview date first</small></div>{message?<p role="status" className="cc123-lost-message">{message}</p>:null}<div className="cc129-table-wrap"><table className="cc129-profile-table cc129-lost-table"><thead><tr><th>#</th><th>Candidate / status</th><th>Location / process</th><th>Interview · IST</th><th>Submission / lost on · IST</th><th>Phone</th><th>Latest note</th><th>Action</th></tr></thead><tbody>{(data.items||[]).map((row,index)=><React.Fragment key={row.loss_id}><tr data-locked={row.locked}><td>{(page-1)*30+index+1}</td><td><strong>{row.full_name||row.candidate_id}</strong><small>{row.candidate_id} · {row.status||'Not set'}</small><span className={'cc129-stage '+row.interview_group}>{row.interview_group==='missed'?'Missed':row.interview_group==='upcoming'?'Upcoming':'History'}</span></td><td>{row.location||'—'}<small>{row.process||'—'}</small></td><td>{date(row.interview_date)}</td><td>{date(row.submission_date)}<small>Lost: {date(row.lost_at)}</small></td><td>{manager?row.phone||'Not set':'Hidden until approved'}</td><td className="cc129-note-cell"><p>{row.last_note||'No saved note.'}</p>{row.loss_note&&row.loss_note!==row.last_note?<details><summary>Note at loss</summary><p>{row.loss_note}</p></details>:null}<button type="button" onClick={()=>notes(row)}>{expanded[row.candidate_id]?'Hide history':'Notes history'}</button></td><td>{row.locked?row.request_status==='Pending'?<span className="cc929-pending">Pending in Approvals</span>:<div className="cc123-lost-request"><textarea aria-label={'Reason for '+row.candidate_id} placeholder="Reason for access…" rows="2" maxLength={1000} value={reason[row.candidate_id]||''} onChange={e=>setReason(value=>({...value,[row.candidate_id]:e.target.value}))}/><button type="button" disabled={!!asking||!(reason[row.candidate_id]||'').trim()} onClick={()=>ask(row)}>{asking===row.candidate_id?'Sending…':'Request access'}</button></div>:<a href={'/candidate/'+encodeURIComponent(row.candidate_id)} target="_blank" rel="noopener noreferrer">Open profile ↗</a>}</td></tr>{expanded[row.candidate_id]?<tr><td colSpan="8"><div className="cc123-lost-history">{(history[row.candidate_id]?.items||row.notes||[]).map(note=><div key={note.id}><small>{note.username} · {date(note.created_at)}</small><p>{note.body}</p></div>)}{history[row.candidate_id]?.next_before?<button type="button" onClick={()=>notes(row,true)}>More notes</button>:null}</div></td></tr>:null}</React.Fragment>)}{!data.items?.length?<tr><td colSpan="8">{busy?'Loading lost profiles…':'No profiles in this category.'}</td></tr>:null}</tbody></table></div><footer><button type="button" disabled={page<=1||busy} onClick={()=>setPage(value=>value-1)}>Previous</button><span>{data.total||0} matching · Page {page}</span><button type="button" disabled={!data.has_more||busy} onClick={()=>setPage(value=>value+1)}>Next</button></footer></section><style>{lostStyles}</style></div>,document.body):null}</>;
}
const lostStyles='body:has(#cc929-lost) :is(.cc730-direct-reminder-deck,.cc803-review-popup,.task-reminder-wrap,.cc808-task-toast){visibility:hidden!important;pointer-events:none!important}#cc929-lost{z-index:100180!important;background:#20304455!important;padding:16px!important;display:grid!important;place-items:center!important}#cc929-lost>section{box-sizing:border-box;width:min(1500px,97vw);max-height:92dvh;overflow:auto;background:#f8faff;color:#283d58;border:1px solid #cdd9ea;border-radius:18px;padding:18px;font:14px/1.5 "Segoe UI",sans-serif}#cc929-lost header,#cc929-lost footer,.cc929-lost-tools{display:flex;align-items:center;gap:10px;justify-content:space-between}#cc929-lost h2{font-size:22px;margin:0}#cc929-lost p{margin:5px 0 10px;overflow-wrap:anywhere}#cc929-lost button,#cc929-lost a{padding:7px 10px;border-radius:8px;border:1px solid #c6d2e5;background:#f0f4ff;color:#3e5785;font:13px/1.4 "Segoe UI",sans-serif;cursor:pointer}#cc929-lost button:disabled{opacity:.5}#cc929-lost input,#cc929-lost textarea{box-sizing:border-box;max-width:100%;background:white;color:#29415e;border:1px solid #c1cee2;padding:8px 30px 8px 9px;border-radius:8px;font:13px/1.5 "Segoe UI",sans-serif}.cc123-lost-slices{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.cc123-lost-slices button{flex:1;min-width:120px;text-align:left!important;background:#fff!important}.cc123-lost-slices button[aria-pressed=true]{border-color:#7b8cd0!important;background:#edf0ff!important}.cc123-lost-slices strong{font-size:21px;display:block}.cc123-lost-slices span{font-size:12px}.cc929-lost-tools{flex-wrap:wrap}.cc929-lost-tools input{flex:1;min-width:180px}.cc929-lost-tools small{color:#61748e}.cc929-lost-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:12px;margin:14px 0}.cc929-lost-grid>article{background:#fff;border:1px solid #d7e0ed;border-radius:13px;padding:13px}.cc123-lost-name{display:flex;align-items:center;gap:8px}.cc123-lost-name>span{background:#edf0fa;border-radius:7px;padding:3px 6px;font-size:12px}.cc123-lost-name>div{flex:1;min-width:0}.cc123-lost-name strong{font-size:16px;display:block}.cc123-lost-name small{font-size:12px;color:#65768d}.cc123-lost-name>b{font-size:11px;background:#e7f3ef;color:#347258;padding:3px 7px;border-radius:6px}.cc123-lost-missed .cc123-lost-name>b{background:#fff0e9;color:#a35636}.cc929-lost-grid dl{margin:9px 0}.cc929-lost-grid dl>div{display:flex;gap:7px;margin:4px 0}.cc929-lost-grid dt{font-size:12px;color:#6c7f96;width:80px;flex:none}.cc929-lost-grid dd{font-size:13px;color:#344e6b;margin:0}.cc123-lost-note{background:#f5f2fc;border:1px solid #e4def1;border-radius:9px;padding:9px;margin:10px 0}.cc123-lost-note>b{font-size:12px;color:#74628d}.cc123-lost-note p{font-size:13px;white-space:pre-wrap;max-height:100px;overflow:auto;margin:4px 0!important}.cc123-lost-request textarea{width:100%;margin:10px 0 6px}.cc929-pending{color:#8d692f;font-size:13px;padding-top:8px}.cc123-lost-history{margin-top:8px;max-height:270px;overflow:auto;border:1px solid #dce4f0;border-radius:8px;padding:8px}.cc123-lost-history>div{padding:7px 0;border-bottom:1px solid #e8edf6}.cc123-lost-history small{color:#6b7e96;font-size:11px}.cc123-lost-history p{white-space:pre-wrap;font-size:13px}.cc123-lost-open{display:block;margin-top:10px;text-align:center}.cc123-lost-message{padding:8px;background:#edf3ff;border-radius:8px}@media(max-width:700px){#cc929-lost{padding:6px!important}#cc929-lost>section{padding:12px}.cc929-lost-grid{grid-template-columns:1fr}.cc123-lost-slices button{min-width:100px}}';

// popupStudio - consolidated to retain the 100-file frontend upload limit.

export const POPUP_FONTS={system:'"Segoe UI",Arial,sans-serif',inter:'Inter,"Segoe UI",sans-serif',jakarta:'"Plus Jakarta Sans","Segoe UI",sans-serif',rounded:'"Trebuchet MS","Segoe UI",sans-serif',editorial:'Georgia,"Times New Roman",serif',mono:'Consolas,"Cascadia Code",monospace'};
export const POPUP_TYPES=[['notification','Notifications'],['submission','Submission reminders'],['task','Task reminders'],['reminder','Other reminders']];
const defaults={notification:{x:.66,y:.14,w:.32,h:.24,bg:'#ffffff',ink:'#1f3550',accent:'#6276d8',seconds:10},submission:{x:.02,y:.60,w:.30,h:.36,bg:'#f0f7ff',ink:'#173b57',accent:'#4b87d8',seconds:0},task:{x:.66,y:.52,w:.32,h:.44,bg:'#effcf5',ink:'#183e35',accent:'#168860',seconds:0},reminder:{x:.66,y:.24,w:.32,h:.40,bg:'#fff8eb',ink:'#4d3b22',accent:'#ce8c30',seconds:0}};
const clamp=(n,min,max,fallback)=>Math.max(min,Math.min(max,Number.isFinite(Number(n))?Number(n):fallback));
export const popupKind=value=>['notification','submission','task'].includes(value)?value:/submission|approval/.test(String(value))?'submission':/task/.test(String(value))?'task':'reminder';
export function defaultPopupProfile(kind){return {...defaults[popupKind(kind)],enabled:false,styleEnabled:false,font:'system',fontSize:14,radius:18};}
export function sanitizePopupProfile(value={},kind='notification'){
 const fallback=defaultPopupProfile(kind),next={...fallback,...value};
 for(const key of ['x','y'])next[key]=clamp(next[key],0,.98,fallback[key]);
 for(const key of ['w','h'])next[key]=clamp(next[key],.10,.98,fallback[key]);
 for(const key of ['bg','ink','accent'])next[key]=/^#[a-f0-9]{6}$/i.test(next[key])?next[key]:fallback[key];
 next.font=Object.hasOwn(POPUP_FONTS,next.font)?next.font:'system';next.fontSize=clamp(next.fontSize,12,26,14);
 next.radius=clamp(next.radius,0,32,18);next.seconds=clamp(next.seconds,0,600,fallback.seconds);next.enabled=next.enabled===true;next.styleEnabled=next.styleEnabled===true;
 return Object.fromEntries(Object.keys(fallback).map(key=>[key,next[key]]));
}
const settingsKey=()=>`cc927:popup-studio:${accountPrincipal().split('|')[0]}`;
export function readPopupStudio(){let raw={};try{raw=JSON.parse(localStorage.getItem(settingsKey())||'{}');}catch{}return Object.fromEntries(POPUP_TYPES.map(([kind])=>[kind,sanitizePopupProfile(raw[kind],kind)]));}
export function writePopupStudio(kind,profile){
 const next={...readPopupStudio(),[kind]:sanitizePopupProfile(profile,kind)},encoded=JSON.stringify(next);
 try{localStorage.setItem(settingsKey(),encoded);if(localStorage.getItem(settingsKey())!==encoded)throw Error();}
 catch{throw Object.assign(new Error('Popup settings could not be saved in this browser.'),{code:'LOCAL_SETTINGS_NOT_SAVED',payload:{committed:false}});}
 window.dispatchEvent(new Event('cc927-popup-settings-changed'));return next;
}
export const isPopupStudioEnabled=kind=>readPopupStudio()[popupKind(kind)]?.enabled===true;
export function popupBounds(profile,width=innerWidth,height=innerHeight){
 const p=sanitizePopupProfile(profile),margin=8,availableW=Math.max(1,width-margin*2),availableH=Math.max(1,height-margin*2);
 const w=Math.min(availableW,Math.max(Math.min(240,availableW),p.w*width)),h=Math.min(availableH,Math.max(Math.min(110,availableH),p.h*height));
 return {left:Math.max(margin,Math.min(p.x*width,width-margin-w)),top:Math.max(margin,Math.min(p.y*height,height-margin-h)),width:w,height:h};
}
export function readablePopupInk(bg){const c=bg.slice(1).match(/../g).map(x=>parseInt(x,16));return c[0]*.299+c[1]*.587+c[2]*.114>155?'#17324d':'#ffffff';}
export function describeWriteFailure(record){
 const action=record.action==='submit'?'Submission':'Save',code=record.code||'',raw=record.message||'';
 const rejected=record.committed===false||record.localRejected||/no changes were saved|no records were changed|not sent|not submitted|was not saved/i.test(raw);
 const uncertain=!rejected&&(!record.status||record.status>=500||/acknowledg|confirm|timed out|network|fetch/i.test(raw));
 let reason=uncertain?"The server hasn't confirmed this update yet. Check the latest saved record before moving on.":"The server couldn't accept this update. Review the details, then try saving again.";
 if(/IDENTITY_LOCKED|CANDIDATE_ID_LOCKED/.test(code)||/saved .* differs from this form/i.test(raw))reason="This profile's name or phone number doesn't match the saved record. Use the saved details or ask your manager to make a correction.";
 else if(/PROFILE.*CONFLICT/.test(code))reason='This profile was updated elsewhere. Open the latest version, review your changes, then save again.';
 else if(/NOTE_REQUIRED/.test(code)||/note.*required|required.*note/i.test(raw))reason='A note is required. Add one, then save or submit again.';
 else if(/LOCAL_VALIDATION|PROFILE_NAME_REQUIRED/.test(code))reason='Required details need attention. Complete the highlighted fields, then save or submit again.';
 else if(record.status===401)reason='Your session has expired. Keep your entered details, sign in again, then check the saved record.';
 else if(record.status===403)reason="Your account isn't allowed to make this change. Contact your TL or manager for access.";
 else if(record.status===423)reason='This CRM is locked or in read-only mode. Use the active CRM or contact your manager to continue.';
 else if(record.status===409)reason='This form differs from the saved record. Check the latest version and review your changes before retrying.';
 else if([400,422].includes(record.status))reason='Some details are missing or invalid. Review the fields, make the corrections, then save again.';
 return {title:uncertain?`${action} status unconfirmed`:rejected?`${action} needs a quick fix`:`${action} needs attention`,reason,uncertain};
}

const targets='.mini-toast.cc835-notice,.cc808-task-toast,#cc917-task-reminder,.cc803-review-popup,.cc730-direct-reminder-deck,.task-reminder-wrap,.followup-reminder-wrap,.revenue-reminder-wrap,.global-submission-reminder-wrap';
function kindFor(node){if(node.matches('.mini-toast,.cc808-task-toast'))return'notification';if(node.matches('#cc917-task-reminder,.task-reminder-wrap')||node.querySelector('.cc388-card.task'))return'task';if(node.matches('.cc803-review-popup,.global-submission-reminder-wrap')||node.querySelector('.cc388-card.submission,.cc388-card.submissions'))return'submission';return popupKind(node.querySelector('[data-reminder-kind]')?.dataset.reminderKind||'reminder');}
function occurrence(node){return node.dataset.cc927Occurrence||node.shadowRoot?.querySelector('h2')?.textContent||node.querySelector('[data-key]')?.dataset.key||node.querySelector('.cc803-review-title,.cc388-title')?.textContent||node.textContent.slice(0,180);}
const rules=`
[data-cc927-styled]{box-sizing:border-box!important;box-shadow:0 15px 48px #13294130!important;transform:none!important}
html body [data-cc927-styled],html body [data-cc927-styled] *{font-family:var(--cc927-font)!important;color:var(--cc927-ink)!important;-webkit-text-fill-color:var(--cc927-ink)!important;letter-spacing:normal!important}
html body [data-cc927-styled] :is(.panel,.cc388-card,section,.cc835-notice-open){background:var(--cc927-bg)!important;min-width:0!important;max-width:100%!important;width:100%!important;max-height:none!important;height:auto!important;border-radius:var(--cc927-radius)!important}
html body [data-cc927-styled] :is(p,span,small,strong,div,label,button,input,textarea){font-size:var(--cc927-size)!important;line-height:1.4!important;font-weight:500!important;overflow-wrap:anywhere}
html body [data-cc927-styled] :is(h1,h2,h3,.cc388-title,.cc803-review-title,.mini-toast-title){font-size:calc(var(--cc927-size) * 1.15)!important;line-height:1.35!important;font-weight:600!important}
html body [data-cc927-styled] button{border-color:var(--cc927-accent)!important;background:var(--cc927-bg)!important}
html body [data-cc927-popup][data-cc927-collapsed="true"]{visibility:hidden!important;pointer-events:none!important}
html body [data-cc927-popup][data-cc927-suspended="true"]{visibility:hidden!important;pointer-events:none!important}
#cc927-popup-dock{position:fixed;right:12px;bottom:12px;z-index:2147481100;display:flex;gap:6px;flex-wrap:wrap;max-width:calc(100vw - 24px)}
#cc927-popup-dock[hidden]{display:none!important}
#cc927-popup-dock button{font:500 12px/1.4 "Segoe UI",sans-serif!important;color:#244c69!important;background:#fff!important;border:1px solid #8db1c8!important;border-radius:10px!important;padding:8px 11px!important;box-shadow:0 4px 14px #12334d25!important}
`;
const shadowRules=`:host([data-cc927-styled]){color:var(--cc927-ink)!important;font-family:var(--cc927-font)!important} :host([data-cc927-styled]) section{background:var(--cc927-bg)!important;border-color:var(--cc927-accent)!important;border-radius:var(--cc927-radius)!important;max-height:none!important;height:100%!important;overflow:auto} :host([data-cc927-styled]) *{font-family:var(--cc927-font)!important;font-size:var(--cc927-size)!important;color:var(--cc927-ink)!important;line-height:1.4!important;font-weight:500!important} :host([data-cc927-styled]) button,:host([data-cc927-styled]) .note{background:var(--cc927-bg)!important;border-color:var(--cc927-accent)!important} :host([data-cc927-styled]) h2{font-size:calc(var(--cc927-size) * 1.15)!important;font-weight:600!important}`;
export function installPopupStudioDriver(){
 const owner=accountPrincipal(),states=new Map(),style=document.createElement('style'),dock=document.createElement('div');style.textContent=rules.replaceAll('html body ','html#cc787-workspace#cc787-workspace#cc787-workspace body ');document.head.append(style);dock.id='cc927-popup-dock';document.body.append(dock);
 let stopped=false,frame=0,config=readPopupStudio(),badgeSignature='';
 function restore(node,state){clearTimeout(state.timer);for(const[key,[value,priority]]of state.before){if(value)node.style.setProperty(key,value,priority);else node.style.removeProperty(key);}node.removeAttribute('data-cc927-popup');node.removeAttribute('data-cc927-styled');node.removeAttribute('data-cc927-collapsed');node.removeAttribute('data-cc927-suspended');states.delete(node);}
 function put(node,state,key,value){if(!state.before.has(key))state.before.set(key,[node.style.getPropertyValue(key),node.style.getPropertyPriority(key)]);if(state.desired.get(key)!==value||node.style.getPropertyValue(key)!==state.applied.get(key)||node.style.getPropertyPriority(key)!=='important'){node.style.setProperty(key,value,'important');state.desired.set(key,value);state.applied.set(key,node.style.getPropertyValue(key));}}
 const minimized=kind=>[...states].filter(([node,state])=>state.kind===kind&&node.isConnected&&node.dataset.cc927Collapsed==='true');
 function badges(){const entries=POPUP_TYPES.map(([kind,label])=>[kind,label,minimized(kind).length]).filter(x=>x[2]),signature=JSON.stringify(entries);if(signature===badgeSignature)return;badgeSignature=signature;dock.replaceChildren();for(const[kind,label,count]of entries){const button=document.createElement('button');button.textContent=`Show ${label.toLowerCase()} (${count})`;button.onclick=()=>{for(const[node,state]of minimized(kind)){node.removeAttribute('data-cc927-collapsed');state.expired=false;arm(node,state,config[kind]);}badges();};dock.append(button);}}
 function arm(node,state,p){clearTimeout(state.timer);if(!p.seconds)return;state.timer=setTimeout(function finish(){if(stopped||!node.isConnected)return;if(node.contains(document.activeElement)||node.shadowRoot?.contains(node.shadowRoot.activeElement)||node.matches(':hover')||window.__CC922_PAUSE_DIALOG_OPEN__){state.timer=setTimeout(finish,1000);return;}state.expired=true;node.dataset.cc927Collapsed='true';badges();},p.seconds*1000);}
 function apply(){frame=0;if(stopped)return;if(accountPrincipal()!==owner){for(const[node,state]of states)restore(node,state);badges();return;}
  const groups=new Map(),blocked=Boolean(document.querySelector('#cc497-unlock-approval,#cc498-tl-lock,.cc604-locked-request-modal')||document.body.classList.contains('cc451-await-join'));
  dock.hidden=blocked;
  for(const node of document.querySelectorAll(targets)){
   if(node.hidden||getComputedStyle(node).display==='none'||(!node.dataset.cc927Popup&&getComputedStyle(node).visibility==='hidden'))continue;
   const kind=kindFor(node),p=config[kind];if(!p?.enabled)continue;
   if(node.parentElement?.closest(targets))continue;
   if(!groups.has(kind))groups.set(kind,[]);groups.get(kind).push(node);
  }
  for(const[node,state]of states)if(!node.isConnected||!config[state.kind]?.enabled)restore(node,state);
  for(const[kind,nodes]of groups){const p=config[kind],rect=popupBounds(p),slot=rect.height/nodes.length;
   nodes.forEach((node,index)=>{
    let state=states.get(node);const id=occurrence(node),version=JSON.stringify(p);
    if(!state){state={kind,before:new Map(),applied:new Map(),desired:new Map(),id,version};states.set(node,state);arm(node,state,p);}
    else if(state.id!==id||state.version!==version){state.id=id;state.version=version;node.removeAttribute('data-cc927-collapsed');arm(node,state,p);}
    if(node.getAttribute('data-cc927-popup')!==kind)node.setAttribute('data-cc927-popup',kind);
    if(p.styleEnabled)node.setAttribute('data-cc927-styled',kind);else node.removeAttribute('data-cc927-styled');
    if(node.dataset.cc927Suspended!==String(blocked))node.dataset.cc927Suspended=String(blocked);
    const values={position:'fixed',left:rect.left+'px',top:(rect.top+index*slot)+'px',right:'auto',bottom:'auto',width:rect.width+'px',height:'auto','max-width':rect.width+'px','max-height':slot+'px','min-width':'0','min-height':'0',margin:'0',overflow:'auto','z-index':'2147480000',background:p.bg,color:p.ink,border:'2px solid '+p.accent,'border-radius':p.radius+'px','font-family':POPUP_FONTS[p.font],'font-size':p.fontSize+'px','--cc927-font':POPUP_FONTS[p.font],'--cc927-size':p.fontSize+'px','--cc927-ink':p.ink,'--cc927-bg':p.bg,'--cc927-accent':p.accent,'--cc927-radius':p.radius+'px'};
    const appearance=new Set(['background','color','border','border-radius','font-family','font-size']);
    for(const[key,value]of Object.entries(values)){if(!p.styleEnabled&&(appearance.has(key)||key.startsWith('--cc927-'))){if(state.before.has(key)){const [original,priority]=state.before.get(key);if(original)node.style.setProperty(key,original,priority);else node.style.removeProperty(key);state.before.delete(key);state.applied.delete(key);state.desired.delete(key);}continue;}put(node,state,key,value);}
    if(node.shadowRoot&&!node.shadowRoot.querySelector('[data-cc927-style]')){const s=document.createElement('style');s.dataset.cc927Style='';s.textContent=shadowRules;node.shadowRoot.append(s);}
   });
  }badges();
 }
 function schedule(){if(!frame&&!stopped)frame=requestAnimationFrame(apply);}
 const observer=new MutationObserver(records=>{if(records.some(r=>!dock.contains(r.target)))schedule();});observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','data-cc927-occurrence']});
 function changed(){config=readPopupStudio();schedule();}
 function storage(event){if(event.key===settingsKey())changed();}
 window.addEventListener('cc927-popup-settings-changed',changed);window.addEventListener('resize',schedule);window.addEventListener('storage',storage);schedule();
 const oldBridge=window.__CC927_POPUP_CUSTOM__;window.__CC927_POPUP_CUSTOM__=isPopupStudioEnabled;
 return()=>{stopped=true;observer.disconnect();cancelAnimationFrame(frame);for(const[node,state]of states)restore(node,state);style.remove();dock.remove();window.removeEventListener('cc927-popup-settings-changed',changed);window.removeEventListener('resize',schedule);window.removeEventListener('storage',storage);if(window.__CC927_POPUP_CUSTOM__===isPopupStudioEnabled)window.__CC927_POPUP_CUSTOM__=oldBridge;};
}


// PopupStudio - consolidated to retain the 100-file frontend upload limit.

const samples={notification:['Notification','RNS updated · Feedback changed','Updated details and who changed them appear here.'],submission:['SUBMISSION REMINDER','Candidate follow-up','This profile is still pending. Choose Review, Later or + to set the next reminder.'],task:['TASK REMINDER','Agenda meeting','Mark completed when the task is done, or choose Later to reschedule.'],reminder:['REMINDER','Interview follow-up','Your due date and next steps appear here.']};
function Sample({kind,profile}){const text=samples[kind];return <div className="cc927-sample" style={{'--sample-bg':profile.bg,'--sample-ink':profile.ink,'--sample-accent':profile.accent,'--sample-font':POPUP_FONTS[profile.font],'--sample-size':profile.fontSize+'px',borderRadius:profile.radius}}><small>{text[0]}</small><h3>{text[1]}</h3><p>{text[2]}</p><div className="cc927-sample-actions"><span>Open</span><span>Later</span></div></div>;}

function PlacementEditor({kind,profile,onDone,onClose}){
 const [rect,setRect]=useState(profile),[viewport,setViewport]=useState({width:innerWidth,height:innerHeight}),gesture=useRef(null),doneRef=useRef(null);
 useEffect(()=>{const old=document.activeElement;doneRef.current?.focus();const resize=()=>setViewport({width:innerWidth,height:innerHeight});const key=e=>{if(e.key==='Escape')onClose();if(e.key==='Tab'){const nodes=[...document.querySelectorAll('#cc927-placement button')],index=nodes.indexOf(document.activeElement);if(e.shiftKey&&index<=0){e.preventDefault();nodes.at(-1)?.focus();}else if(!e.shiftKey&&index===nodes.length-1){e.preventDefault();nodes[0]?.focus();}}};document.addEventListener('keydown',key);window.addEventListener('resize',resize);return()=>{document.removeEventListener('keydown',key);window.removeEventListener('resize',resize);if(old?.isConnected)old.focus();};},[]);
 const bounds=popupBounds(rect,viewport.width,viewport.height),normal=b=>({...rect,x:b.left/innerWidth,y:b.top/innerHeight,w:b.width/innerWidth,h:b.height/innerHeight});
 function begin(event,mode){if(event.button!==0)return;event.preventDefault();event.stopPropagation();gesture.current={mode,x:event.clientX,y:event.clientY,b:popupBounds(rect)};event.currentTarget.setPointerCapture(event.pointerId);}
 function move(event){const g=gesture.current;if(!g)return;const dx=event.clientX-g.x,dy=event.clientY-g.y;let b={...g.b};if(g.mode==='move'){b.left+=dx;b.top+=dy;}else if(g.mode==='resize'){b.width=Math.max(240,b.width+dx);b.height=Math.max(110,b.height+dy);}else{b={left:Math.min(g.x,event.clientX),top:Math.min(g.y,event.clientY),width:Math.max(240,Math.abs(dx)),height:Math.max(110,Math.abs(dy))};}setRect(normal(b));}
 function keys(event,resize=false){if(!/^Arrow/.test(event.key))return;event.preventDefault();const step=event.shiftKey?20:5,b=popupBounds(rect);if(event.key==='ArrowLeft')b[resize?'width':'left']-=step;if(event.key==='ArrowRight')b[resize?'width':'left']+=step;if(event.key==='ArrowUp')b[resize?'height':'top']-=step;if(event.key==='ArrowDown')b[resize?'height':'top']+=step;setRect(normal(b));}
 return createPortal(<div id="cc927-placement" data-cc730-skip="1" role="dialog" aria-modal="true" aria-label="Choose popup area" onPointerDown={e=>{if(e.target===e.currentTarget)begin(e,'draw');}} onPointerMove={move} onPointerUp={()=>{gesture.current=null;}}>
  <style>{studioStyles}</style><div className="cc927-placement-hint">Drag to choose an area · Move the box · Resize from a corner</div>
  <section className="cc927-placement-box" style={{left:bounds.left,top:bounds.top,width:bounds.width,height:bounds.height}}>
   <button type="button" className="cc927-move-handle" aria-label="Move popup area" onPointerDown={e=>begin(e,'move')} onPointerMove={move} onPointerUp={()=>{gesture.current=null;}} onKeyDown={e=>keys(e)}>⠿ Drag to move</button>
   <Sample kind={kind} profile={rect}/><button type="button" className="cc927-resize-handle" aria-label="Resize popup area" onPointerDown={e=>begin(e,'resize')} onPointerMove={move} onPointerUp={()=>{gesture.current=null;}} onKeyDown={e=>keys(e,true)}>↘</button>
  </section><div className="cc927-placement-footer"><span>{Math.round(bounds.width)} × {Math.round(bounds.height)} px</span><button type="button" onClick={onClose}>Cancel</button><button type="button" ref={doneRef} onClick={()=>onDone({...rect,...normal(bounds),enabled:true})}>Done · Save area</button></div>
 </div>,document.body);
}
export function PopupStudioSettings({includeNotifications=true}={}){
 const types=POPUP_TYPES.filter(([key])=>includeNotifications||key!=='notification'),initialType=types[0][0];
 const [kind,setKind]=useState(initialType),[profiles,setProfiles]=useState(readPopupStudio),[draft,setDraft]=useState(()=>readPopupStudio()[initialType]),[editing,setEditing]=useState(false),[status,setStatus]=useState('Choose a type, then set its look and screen area.');
 function change(key,value){setDraft(p=>sanitizePopupProfile({...p,[key]:value,...(['font','fontSize','bg','ink','accent','radius'].includes(key)?{styleEnabled:true}:{})},kind));setStatus('Preview changed · press Save settings or Done to apply.');}
 function save(value={...draft,enabled:true}){try{const next=writePopupStudio(kind,value);setProfiles(next);setDraft(next[kind]);setEditing(false);setStatus('✓ Saved for your account in this browser.');}catch(error){setStatus("Settings couldn't be saved.");reportWriteFailure(error,{force:true,localRejected:true,path:'/local/popup-settings'});}}
 function choose(value){setKind(value);setDraft(profiles[value]);setStatus('Choose a type, then set its look and screen area.');}
 function preset(x,y){change('x',x);change('y',y);}
 return <section id="cc927-studio" data-cc926-keep="1" className="cc927-studio"><style>{studioStyles}</style>
  <header><h3>Popup Studio · Make it yours</h3><p>Give notifications, submission reminders and task popups their own position and style.</p></header>
  <div className="cc927-profile-tabs" role="group" aria-label="Popup type">{types.map(([key,label])=><button type="button" key={key} aria-pressed={kind===key} onClick={()=>choose(key)}>{label}</button>)}</div>
  <div className="cc927-studio-grid"><div className="cc927-controls">
   <label>Popup font<select aria-label="Popup font" value={draft.font} onChange={e=>change('font',e.target.value)}>{Object.keys(POPUP_FONTS).map(key=><option key={key} value={key}>{key==='system'?'System / Segoe UI':key==='jakarta'?'Plus Jakarta Sans':key}</option>)}</select></label>
   <label>Text size · {draft.fontSize}px<input aria-label="Popup text size" type="range" min="12" max="26" value={draft.fontSize} onChange={e=>change('fontSize',Number(e.target.value))}/></label>
   <div className="cc927-colours">{[['bg','Background'],['ink','Text colour'],['accent','Border / accent']].map(([key,label])=><label key={key}>{label}<input aria-label={label} type="color" value={draft[key]} onChange={e=>change(key,e.target.value)}/></label>)}</div>
   <button type="button" onClick={()=>change('ink',readablePopupInk(draft.bg))}>Choose readable text colour</button>
   <label>Display seconds · 0 = keep visible<input aria-label="Popup display seconds" type="number" min="0" max="600" value={draft.seconds} onChange={e=>change('seconds',Number(e.target.value))}/></label>
   <label>Corner roundness<input aria-label="Popup corner roundness" type="range" min="0" max="32" value={draft.radius} onChange={e=>change('radius',Number(e.target.value))}/></label>
   <div className="cc927-coordinates">{[['x','Left %'],['y','Top %'],['w','Width %'],['h','Height %']].map(([key,label])=><label key={key}>{label}<input type="number" aria-label={label} min={key==='w'||key==='h'?10:0} max="98" value={Math.round(draft[key]*100)} onChange={e=>change(key,Number(e.target.value)/100)}/></label>)}</div>
   <div className="cc927-position-presets">{[['Top left',.02,.13],['Top right',.66,.13],['Centre',.34,.32],['Bottom left',.02,.62],['Bottom right',.66,.62]].map(([label,x,y])=><button type="button" key={label} onClick={()=>preset(x,y)}>{label}</button>)}</div>
  </div><aside><Sample kind={kind} profile={draft}/><p>Use the button below to fine-tune your popup area. Arrow keys also work on the drag handles.</p><button type="button" className="cc927-main-button" onClick={()=>setEditing(true)}>Place & resize on screen ↗</button><p>When the display time ends, the popup minimizes. Use “Show…” to bring it back. Minimizing a popup does not complete the task.</p></aside></div>
  <footer><button type="button" className="cc927-main-button" onClick={()=>save()}>Save settings</button><button type="button" onClick={()=>save(defaultPopupProfile(kind))}>Restore original for this type</button><span role="status">{status}</span></footer>
  <p className="cc927-safety-note">Save / Submit failure alerts stay visible until you acknowledge them. Essential sign-in and approval locks keep their protected layout.</p>
  {editing?<PlacementEditor kind={kind} profile={draft} onClose={()=>setEditing(false)} onDone={save}/>:null}
 </section>;
}

async function boundedErrorPayload(response){const reader=response.body?.getReader();if(!reader)return{};let bytes=0,text='';const decoder=new TextDecoder(),timer=setTimeout(()=>reader.cancel().catch(()=>{}),1000);try{while(bytes<16384){const{value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>16384)return{};text+=decoder.decode(value,{stream:true});}return JSON.parse(text);}catch{return{};}finally{clearTimeout(timer);reader.cancel().catch(()=>{});}}
function installWriteMonitor(){
 const previous=window.fetch,principal=accountPrincipal();let stopped=false;
 const wrapper=async function(input,init={}){
  let path='',method='GET',background=false,managed=false,action='save';const route=location.pathname+location.search;
  try{const url=new URL(input instanceof Request?input.url:String(input),location.href);if(url.origin===location.origin&&url.pathname.startsWith('/api/'))path=url.pathname;method=String(init.method||input?.method||'GET').toUpperCase();const headers=new Headers(init.headers||input?.headers||{});background=headers.get('X-Career-Crox-Background')==='1';managed=init.__cc927ManagedWrite===true;if(typeof init.body==='string'&&init.body.length<32768&&JSON.parse(init.body)?.action==='submit')action='submit';}catch{}
  const eligible=path&&!managed&&shouldReportWriteFailure(path,method,background),finish=eligible?trackUserWrite(principal):()=>{};
  try{const response=await previous.apply(this,arguments);if(eligible&&!stopped){const payload=!response.ok||/json/i.test(response.headers.get('content-type')||'')?await boundedErrorPayload(response.clone()):{};if(!response.ok||payload.ok===false||payload.success===false)reportWriteFailure(Object.assign(new Error(payload.message||payload.error||'Server rejected the request.'),{status:response.ok?409:response.status,code:payload.code,payload}),{path,method,principal,action,route});else resolveWriteFailure(path,principal);}return response;}
  catch(error){if(eligible&&!stopped)reportWriteFailure(error,{path,method,principal,action,route});throw error;}finally{finish();}
 };
 window.fetch=wrapper;
 const invalid=event=>{const node=event.target;if(!node?.form)return;const button=document.activeElement?.closest('button')||node.form.querySelector('button[type=submit],button:not([type])'),action=/submit|जमा/i.test(button?.textContent||'')?'submit':'save';setTimeout(()=>{if(stopped)return;reportWriteFailure(Object.assign(new Error('Complete the required or invalid fields.'),{code:'LOCAL_VALIDATION',payload:{committed:false}}),{force:true,localRejected:true,action,path:'/local/form-validation',fields:[node.getAttribute('aria-label')||node.name||'Required field']});},0);};
 document.addEventListener('invalid',invalid,true);
 const unload=event=>{if(hasPendingUserWrite()){event.preventDefault();event.returnValue='';}};
 window.addEventListener('beforeunload',unload);
 return()=>{stopped=true;if(window.fetch===wrapper)window.fetch=previous;document.removeEventListener('invalid',invalid,true);window.removeEventListener('beforeunload',unload);};
}
export function PopupStudioRuntime({userId}){
 const [failures,setFailures]=useState(()=> (window.__CC927_WRITE_FAILURES__||[]).filter(r=>r.principal===accountPrincipal())),[issue,setIssue]=useState(0);
 useEffect(()=>{const principal=accountPrincipal(),sync=()=>setFailures((window.__CC927_WRITE_FAILURES__||[]).filter(r=>r.principal===principal));sync();const clean=installPopupStudioDriver(),unwatch=installWriteMonitor();window.addEventListener('cc927-write-failed',sync);window.addEventListener('cc936-write-resolved',sync);return()=>{clean();unwatch();window.removeEventListener('cc927-write-failed',sync);window.removeEventListener('cc936-write-resolved',sync);};},[userId]);
 const record=failures.find(r=>r.principal===accountPrincipal());useEffect(()=>setIssue(0),[record?.id]);
 if(!record)return null;
 const description=describeWriteFailure(record),fields=[...new Set(record.fields||[])],label=k=>({full_name:'Candidate name',phone:'Phone number',location:'Location',preferred_location:'Preferred location',master_notes:'Profile note',qualification:'Qualification',qualification_level:'Degree',ctc_monthly:'CTC monthly',in_hand_salary:'In-hand salary',total_experience:'Total experience',relevant_experience:'Relevant experience',interview_reschedule_date:'Interview date',submission_date:'Submission date',virtual_onsite:'Interview mode',communication_skill:'Communication skill',documents_availability:'Documents availability'}[k]||k.replaceAll('_',' '));
 const action=/attendance\/start-break/.test(record.path)?'Start Break':/attendance\/end-break/.test(record.path)?'End Break':/attendance/.test(record.path)?'Attendance update':/reminders\/pauses/.test(record.path)?'Reschedule reminder':/\/tasks\//.test(record.path)?'Task update':/\/chat\//.test(record.path)?'Send message':record.action==='submit'?'Submission':'Save';
 const title=action+' '+(description.uncertain?'needs verification':'needs attention');
 const technical=/activity_log_pkey|duplicate key|25P02|schema|connection terminated|ECONN/.test(record.message);
 const reason=technical?'A CRM database error interrupted this action. Your entered details have been kept. Check its saved status before retrying.':record.code==='LOCAL_VALIDATION'?description.reason:record.message||description.reason;
 function dismiss(all=false){window.__CC927_WRITE_FAILURES__=(window.__CC927_WRITE_FAILURES__||[]).filter(r=>r.principal===accountPrincipal()&&(!all&&r.id!==record.id));setFailures((window.__CC927_WRITE_FAILURES__||[]));}
 function go(index=issue){const field=fields[index%fields.length];if(!field)return;if(record.route&&record.route!==location.pathname+location.search){window.open(record.route,'_blank','noopener,noreferrer');return;}window.dispatchEvent(new CustomEvent('cc936-go-to-error',{detail:{field,fields,issues:record.issues,record}}));const node=document.querySelector('[data-field="'+CSS.escape(field)+'"]');if(node){node.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});const input=node.querySelector('input:not(:disabled),textarea:not(:disabled),select:not(:disabled),button:not(:disabled)');input?.focus({preventScroll:true});}setIssue(index%fields.length);}
 return createPortal(<aside id="cc927-write-error" data-cc730-skip="1" role="alert" aria-label={title}>
  <style>{studioStyles+cc936ErrorStyles}</style><section className="cc927-error-panel"><header><span className="cc927-error-kicker">ACTION CHECK · {action}</span><button type="button" aria-label="Dismiss error" onClick={()=>dismiss()}>×</button></header><h2>{title}</h2><p>{reason}</p>
  {record.issues?.length>0?<ul className="cc936-error-issues">{record.issues.map((message,i)=><li key={i}>{message}</li>)}</ul>:null}
  {fields.length>0?<div className="cc936-error-fields">{fields.map((field,i)=><button type="button" key={field} onClick={()=>go(i)} aria-pressed={issue===i}>{label(field)}</button>)}</div>:null}
  <details><summary>Details / Manager help</summary><pre>{record.code?record.code+'\n':''}{record.message}</pre></details>
  <footer>{record.existingProfile&&<button type="button" onClick={()=>window.open(record.existingProfile,'_blank','noopener,noreferrer')}>Open saved profile ↗</button>}{fields.length>0?<><button type="button" onClick={()=>go()}>Go to error ↗</button>{fields.length>1&&<button type="button" onClick={()=>go((issue+1)%fields.length)}>Next issue · {issue+1}/{fields.length}</button>}</>:record.route&&record.route!==location.pathname+location.search?<button type="button" onClick={()=>window.open(record.route,'_blank','noopener,noreferrer')}>Open affected page ↗</button>:null}<button type="button" className="cc936-error-ok" onClick={()=>dismiss()}>OK · Continue</button>{failures.length>1&&<button type="button" onClick={()=>dismiss(true)}>Dismiss all · {failures.length}</button>}</footer><small>Keep working. Acknowledge this notice, then retry the affected action when ready.</small>
  </section></aside>,document.body);
}

const studioStyles=`
html#cc787-workspace body #cc927-studio{background:#fff;border:1px solid #dbe4f0;border-radius:17px;padding:19px;margin-top:20px;color:#253d56;font:400 13px/1.5 "Segoe UI",sans-serif}
#cc927-studio header h3{font-size:19px!important;font-weight:600!important;margin:0 0 5px}#cc927-studio p{font-size:12px;line-height:1.6;margin:8px 0;color:#5a6b80}
html body #cc927-studio button,#cc927-placement button{font:500 12px/1.4 "Segoe UI",sans-serif!important;color:#324e72!important;background:#fff!important;border:1px solid #c8d6e8!important;border-radius:9px!important;padding:8px 11px!important;cursor:pointer}
#cc927-studio .cc927-profile-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:17px 0}#cc927-studio button[aria-pressed=true],html body #cc927-studio .cc927-main-button{background:#eaf0ff!important;color:#3b51a5!important;border-color:#9eb0ea!important}
#cc927-studio .cc927-studio-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(230px,1fr);gap:22px}#cc927-studio .cc927-controls{display:flex;flex-direction:column;gap:12px}#cc927-studio label{display:block;font-size:12px!important;font-weight:500!important;color:#455c76!important}
html body #cc927-studio :is(select,input[type=number]){display:block;width:100%;padding:9px 10px;margin-top:4px;border:1px solid #cdd9e8!important;border-radius:9px!important;background:#fff!important;color:#2b4566!important;font:400 13px/1.4 "Segoe UI",sans-serif!important}
#cc927-studio input[type=range]{width:100%;height:24px;padding:0;margin:3px 0}#cc927-studio input[type=color]{display:block;width:100%;height:34px;padding:2px;border:1px solid #d3ddeb;border-radius:8px;background:white}
#cc927-studio .cc927-colours{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}#cc927-studio .cc927-coordinates{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}#cc927-studio .cc927-position-presets{display:flex;gap:5px;flex-wrap:wrap}#cc927-studio footer{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding-top:17px;margin-top:17px;border-top:1px solid #e3eaf3}#cc927-studio footer span{font-size:12px;color:#536e88}#cc927-studio .cc927-safety-note{background:#fff7e9;padding:10px;border-radius:10px;color:#745b31}
html#cc787-workspace body :is(#cc927-studio,#cc927-placement) .cc927-sample{box-sizing:border-box;background:var(--sample-bg)!important;color:var(--sample-ink)!important;border:2px solid var(--sample-accent)!important;font:400 var(--sample-size)/1.45 var(--sample-font)!important;padding:17px;overflow:auto}
html#cc787-workspace body :is(#cc927-studio,#cc927-placement) .cc927-sample *{font-family:var(--sample-font)!important;color:var(--sample-ink)!important;-webkit-text-fill-color:var(--sample-ink)!important;font-size:var(--sample-size)!important;font-weight:500!important;line-height:1.45!important}html body :is(#cc927-studio,#cc927-placement) .cc927-sample h3{margin:10px 0;font-size:1.15em!important;font-weight:600!important}.cc927-sample-actions{display:flex;gap:8px;margin-top:12px}.cc927-sample-actions span{padding:6px 12px;border:1px solid var(--sample-accent);border-radius:8px}
#cc927-placement{position:fixed!important;inset:0!important;background:#102b4659!important;backdrop-filter:blur(2px);z-index:2147482000!important;touch-action:none;color:#1e3b57;font-family:"Segoe UI",sans-serif}#cc927-placement .cc927-placement-hint{position:fixed;top:8px;left:50%;transform:translateX(-50%);padding:10px 15px;border-radius:12px;background:white;box-shadow:0 5px 25px #0a25302a;font-size:13px;width:max-content;max-width:calc(100vw - 24px);text-align:center}
#cc927-placement .cc927-placement-box{position:fixed;box-sizing:border-box!important;border:2px dashed #3275ce!important;background:#fff;border-radius:15px;box-shadow:0 0 0 3px #fff9;overflow:hidden;min-width:0}
#cc927-placement .cc927-move-handle{position:absolute;top:0;left:0;width:100%;height:32px;border:0!important;border-radius:0!important;background:#eaf2ff!important;cursor:move!important;touch-action:none;z-index:2}#cc927-placement .cc927-sample{height:100%;padding-top:43px!important;border:0!important;border-radius:0!important}#cc927-placement .cc927-resize-handle{position:absolute;right:0;bottom:0;width:30px;height:30px;padding:3px!important;border-radius:8px 0 0 0!important;background:#eaf2ff!important;cursor:nwse-resize!important;touch-action:none;z-index:3}
#cc927-placement .cc927-placement-footer{position:fixed;bottom:15px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:10px;background:white;border:1px solid #cedcec;border-radius:14px;padding:10px;box-shadow:0 10px 30px #122e4630;white-space:nowrap;max-width:calc(100vw - 16px);z-index:4;font-size:12px}
#cc927-write-error{position:fixed!important;inset:0!important;background:#1725348c!important;z-index:2147483000!important;display:flex!important;align-items:flex-start!important;justify-content:center!important;padding:clamp(18px,9vh,90px) 14px!important;overflow:auto!important;font-family:"Segoe UI",Arial,sans-serif!important;color:#362635!important}
html body #cc927-write-error .cc927-error-panel{box-sizing:border-box;width:560px;max-width:100%;background:#fff!important;border:2px solid #d44960!important;border-radius:20px;padding:25px;box-shadow:0 25px 80px #0c172452;color:#382735!important}html body #cc927-write-error .cc927-error-kicker{font:600 11px/1.5 "Segoe UI",sans-serif!important;color:#a3344c!important;letter-spacing:.06em}html body #cc927-write-error h2{font:600 25px/1.4 "Segoe UI",sans-serif!important;color:#a72843!important;margin:8px 0 12px!important}html body #cc927-write-error p{font:400 16px/1.7 "Segoe UI",sans-serif!important;color:#3f3340!important;margin:12px 0!important}
html body #cc927-write-error .cc927-error-next{font:500 14px/1.6 "Segoe UI",sans-serif!important;background:#fff1f2!important;border:1px solid #edc9d0!important;border-radius:11px;padding:13px;color:#82394b!important}#cc927-write-error details{margin-top:16px;font:400 12px/1.5 "Segoe UI",sans-serif;color:#647083}#cc927-write-error pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto;font:400 12px/1.5 Consolas,monospace;color:#5e6673}#cc927-write-error footer{display:flex;gap:8px;justify-content:flex-end;margin-top:21px;flex-wrap:wrap}html body #cc927-write-error button{font:500 14px/1.5 "Segoe UI",sans-serif!important;background:#b83751!important;color:#fff!important;-webkit-text-fill-color:#fff!important;border:1px solid #ac2c47!important;border-radius:11px!important;padding:11px 15px!important;cursor:pointer}#cc927-write-error small{display:block;text-align:right;margin-top:12px;font-size:11px;color:#7f6d75}
@media(max-width:700px){#cc927-studio .cc927-studio-grid{grid-template-columns:1fr}#cc927-studio .cc927-coordinates{grid-template-columns:repeat(2,1fr)}#cc927-placement .cc927-placement-footer{gap:5px;font-size:10px}#cc927-placement .cc927-placement-footer button{font-size:10px!important;padding:8px!important}}
`.replaceAll('html body ','html#cc787-workspace#cc787-workspace#cc787-workspace body ').replaceAll('html#cc787-workspace body ','html#cc787-workspace#cc787-workspace#cc787-workspace body ');

const cc936ErrorStyles=`
html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body #cc927-write-error{position:fixed!important;inset:auto 16px 16px auto!important;width:min(350px,calc(100vw - 24px))!important;max-height:42dvh!important;padding:0!important;background:transparent!important;backdrop-filter:none!important;display:block!important;z-index:100950!important;pointer-events:none!important;overflow:visible!important}
html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body #cc927-write-error .cc927-error-panel{pointer-events:auto!important;width:100%!important;max-height:42dvh!important;overflow:auto!important;padding:12px!important;border:1px solid #e8b8c4!important;border-radius:12px!important;box-shadow:0 12px 34px #23395b2b!important;background:#fff!important;color:#29374e!important}
html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body #cc927-write-error header{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:10px!important}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body #cc927-write-error h2{font:600 17px/1.35 'Segoe UI',sans-serif!important;margin:6px 0!important}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body #cc927-write-error p{font:400 13px/1.5 'Segoe UI',sans-serif!important;margin:7px 0!important}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body #cc927-write-error button{padding:6px 9px!important;min-height:30px!important;border:1px solid #d6ddea!important;border-radius:9px!important;background:#f8faff!important;color:#344867!important;-webkit-text-fill-color:#344867!important;font:500 12px/1.3 'Segoe UI',sans-serif!important}
html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body #cc927-write-error footer{display:flex!important;flex-wrap:wrap!important;gap:6px!important;margin-top:10px!important}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body #cc927-write-error .cc936-error-ok{background:#405ed5!important;color:#fff!important;-webkit-text-fill-color:#fff!important;border-color:#405ed5!important}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body #cc927-write-error small{font:400 11px/1.4 'Segoe UI',sans-serif!important;display:block!important;margin-top:8px!important;color:#627089!important}
.cc936-error-fields{display:flex;gap:5px;flex-wrap:wrap}.cc936-error-issues{max-height:65px;overflow:auto;margin:8px 0;padding-left:18px;font:400 12px/1.5 'Segoe UI',sans-serif}.cc936-error-fields button[aria-pressed=true]{outline:2px solid #d69c55!important}
`;
