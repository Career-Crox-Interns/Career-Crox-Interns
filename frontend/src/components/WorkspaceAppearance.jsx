import React, {useEffect, useLayoutEffect, useState} from 'react';
import {createPortal} from 'react-dom';
import {useLocation} from 'react-router-dom';
import {useAuth} from '../lib/auth';
import {applyPersonalSettings, readPersonalSettings, savePersonalSettings, allowedCursors, cursorUrl, pointerUrl} from '../lib/personalSettings';
import '../styles/genz-motion.css';

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
