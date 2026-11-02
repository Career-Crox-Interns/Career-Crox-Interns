import {accountPrincipal} from './api';
export const NOTICE_STYLE_CATEGORIES=[['notes','Notes'],['profile','Profile edits'],['transfer','Transfers'],['status','Status'],['submission','Submissions'],['approval','Approvals'],['interview','Interviews'],['attendance','Attendance / breaks'],['task','Tasks'],['report','Reports'],['chat','Team chat'],['other','Other updates']];
export const POPUP_LAYOUTS=[['gradient','Prism header'],['rail','Accent rail'],['outline','Studio outline'],['split','Split colour'],['compact','Compact professional'],['rounded','Soft corners']];
export function contrastRatio(a,b){const lum=hex=>{const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
export function contrastInk(bg,ink='#14243b'){return contrastRatio(bg,ink)>=4.5?ink:contrastRatio(bg,'#14243b')>=4.5?'#14243b':'#ffffff'}
export function popupVisual(profile){const p=sanitizePopupProfile(profile);return {...p,ink:contrastInk(p.bg,p.ink),accent:contrastInk('#ffffff',p.accent),accent2:contrastInk('#ffffff',p.accent2)}}
export const POPUP_FONTS={system:'"Segoe UI",Arial,sans-serif',inter:'Inter,"Segoe UI",sans-serif',jakarta:'"Plus Jakarta Sans","Segoe UI",sans-serif',rounded:'"Trebuchet MS","Segoe UI",sans-serif',editorial:'Georgia,"Times New Roman",serif',mono:'Consolas,"Cascadia Code",monospace'};
export const POPUP_TYPES=[['notification','Notifications'],['submission','Submission reminders'],['task','Task reminders'],['reminder','Other reminders'],['break','Break timer'],['chat','Team Chat messages']];
const defaults={chat:{x:.36,y:.14,w:.28,h:.20,bg:'#ffffff',ink:'#14243b',accent:'#2454d6',seconds:10},break:{x:.66,y:.60,w:.30,h:.28,bg:'#ffffff',ink:'#14243b',accent:'#b74609',seconds:0},notification:{x:.66,y:.14,w:.32,h:.24,bg:'#ffffff',ink:'#1f3550',accent:'#2454d6',seconds:10},submission:{x:.02,y:.60,w:.30,h:.36,bg:'#f0f7ff',ink:'#173b57',accent:'#b74609',seconds:0},task:{x:.66,y:.52,w:.32,h:.44,bg:'#effcf5',ink:'#183e35',accent:'#168860',seconds:0},reminder:{x:.66,y:.24,w:.32,h:.40,bg:'#fff8eb',ink:'#4d3b22',accent:'#ce8c30',seconds:0}};
const clamp=(n,min,max,fallback)=>Math.max(min,Math.min(max,Number.isFinite(Number(n))?Number(n):fallback));
export const popupKind=value=>String(value).startsWith('notification:')&&NOTICE_STYLE_CATEGORIES.some(x=>'notification:'+x[0]===value)?value:['notification','submission','task','break','chat'].includes(value)?value:/submission|approval/.test(String(value))?'submission':/task/.test(String(value))?'task':'reminder';
export function defaultPopupProfile(kind){return {...defaults[String(kind).startsWith('notification:')?'notification':popupKind(kind)],enabled:false,styleEnabled:false,placementEnabled:false,font:'system',fontSize:14,radius:18,layout:'gradient',accent2:kind==='submission'?'#cc245f':'#7136dd'};}
export function sanitizePopupProfile(value={},kind='notification'){
 value=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
 const fallback=defaultPopupProfile(kind),next={...fallback,...value};
 for(const key of ['x','y'])next[key]=clamp(next[key],0,.98,fallback[key]);
 for(const key of ['w','h'])next[key]=clamp(next[key],.10,.98,fallback[key]);
 for(const key of ['bg','ink','accent','accent2'])next[key]=/^#[a-f0-9]{6}$/i.test(next[key])?next[key]:fallback[key];
 next.layout=POPUP_LAYOUTS.some(x=>x[0]===next.layout)?next.layout:'gradient';next.ink=contrastInk(next.bg,next.ink);
 next.font=Object.hasOwn(POPUP_FONTS,next.font)?next.font:'system';next.fontSize=clamp(next.fontSize,12,26,14);
 next.placementEnabled=value.placementEnabled==null?value.enabled===true:value.placementEnabled===true;
 next.radius=clamp(next.radius,0,32,18);next.seconds=clamp(next.seconds,0,600,fallback.seconds);next.enabled=next.enabled===true;next.styleEnabled=next.styleEnabled===true;
 return Object.fromEntries(Object.keys(fallback).map(key=>[key,next[key]]));
}
const settingsKey=()=>`cc927:popup-studio:${accountPrincipal().split('|')[0]}`;
export function readPopupStudio(){let raw={};try{const parsed=JSON.parse(localStorage.getItem(settingsKey())||'{}');raw=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};}catch{}return Object.fromEntries([...POPUP_TYPES,...NOTICE_STYLE_CATEGORIES.map(([key,label])=>['notification:'+key,label])].map(([kind])=>[kind,sanitizePopupProfile(raw[kind],kind)]));}
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
