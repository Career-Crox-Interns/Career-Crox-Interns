import { accountPrincipal as cachePrincipal } from './api';

export const FONTS = [
  ['jakarta','Plus Jakarta Sans','"Plus Jakarta Sans",Inter,"Segoe UI",sans-serif'],
  ['inter','Inter','Inter,"Segoe UI",Arial,sans-serif'],
  ['system','System / Segoe UI','"Segoe UI",system-ui,Arial,sans-serif'],
  ['rounded','Rounded','"Trebuchet MS","Segoe UI",sans-serif'],
  ['editorial','Editorial','Georgia,"Times New Roman",serif'],
  ['mono','Mono','"Cascadia Code",Consolas,monospace'],
];
export const NEW_ADDED_THEMES = [
  [
    "new-added-1",
    "Coral Original",
    "#fffbf8",
    "#ffd6c9",
    "#ff5a7d",
    "#ff8b5f",
    "light",
    "",
    "#fff3ee",
    "#ffeef7"
  ],
  [
    "new-added-2",
    "Ocean Blue",
    "#f7fbff",
    "#d7ecff",
    "#1976d2",
    "#42a5f5",
    "light",
    "",
    "#eef7ff",
    "#eaf2ff"
  ],
  [
    "new-added-3",
    "Forest Green",
    "#fbfffb",
    "#daf4dc",
    "#2e7d32",
    "#66bb6a",
    "light",
    "",
    "#effaf0",
    "#eaf6ea"
  ],
  [
    "new-added-4",
    "Lavender Elegant",
    "#fbfaff",
    "#eadfff",
    "#845ef7",
    "#b197fc",
    "light",
    "",
    "#f3efff",
    "#eef5ff"
  ],
  [
    "new-added-5",
    "Midnight Dark",
    "#f7fbff",
    "#d8efff",
    "#1e88e5",
    "#00bcd4",
    "light",
    "",
    "#edf7ff",
    "#eaf6ff"
  ],
  [
    "new-added-6",
    "Rose Pink",
    "#fffbfd",
    "#ffdce8",
    "#ec407a",
    "#ff80ab",
    "light",
    "",
    "#fff1f6",
    "#ffedf5"
  ],
  [
    "new-added-7",
    "Sunshine Yellow",
    "#fffcf4",
    "#ffefbd",
    "#ff9800",
    "#ffc107",
    "light",
    "",
    "#fff7e4",
    "#fff3d4"
  ],
  [
    "new-added-8",
    "Teal Mint",
    "#f6fffd",
    "#d5f7f2",
    "#009688",
    "#26c6da",
    "light",
    "",
    "#eafffb",
    "#e6f8ff"
  ],
  [
    "new-added-9",
    "Royal Purple",
    "#fbf9ff",
    "#e6ddff",
    "#673ab7",
    "#7e57c2",
    "light",
    "",
    "#f3efff",
    "#efeaff"
  ],
  [
    "new-added-10",
    "Classic White",
    "#ffffff",
    "#e3f1ff",
    "#2979ff",
    "#64b5f6",
    "light",
    "",
    "#f8fbff",
    "#f3f7ff"
  ]
];

export const LEGACY_THEMES = [
  ['orange','Orange Sunrise','#fff8f0','#ffcc99','#ff982e','#ed701d'],
  ['blue','Ocean Glass','#f5fbff','#d5eaff','#62aefe','#9b83f5'],
  ['green','Mint Garden','#f3fff9','#daf5e4','#2ebc99','#7bd956'],
  ['pink','Rose Quartz','#fff7fb','#ffe0ed','#ff78a4','#ffb279'],
  ['purple','Lilac Dream','#faf7ff','#e8dfff','#a779f1','#8f73e8'],
  ['gold','Golden Hour','#fffdf4','#ffedc7','#ffc937','#ff9d44'],
  ['ice-lilac','Ice Lilac','#f6faff','#e9e2ff','#8fb9ff','#a779f1'],
  ['peach-sky','Peach Sky','#fffaf5','#ffebe2','#ffbda1','#a9d9ff'],
  ['dark-navy','Navy Night','#111d32','#1b3050','#79c4ff','#9b83f5','dark'],
  ['midnight','Midnight Ink','#121827','#232d46','#abbcff','#85caff','dark'],
  ['dark-midnight','Sapphire Night','#111c34','#203253','#8db6ff','#92d1f0','dark'],
  ['cosmic-berry','Cosmic Berry','#251b35','#382a4b','#ca93ff','#faa7cf','dark'],
  ['neon-ink','Aurora Ink','#15172b','#272b48','#aeb0ff','#55e0c4','dark'],
  ['pine-night','Pine Night','#102a26','#1c3b36','#6ddcaf','#a2d9e9','dark'],
  ['slate-night','Graphite Night','#181e29','#2a3444','#b8c8e4','#adbcfc','dark'],
  ['burgundy','Maroon','#4d1735','#702741','#ecacc9','#d7b3e9','dark','manager'],
  ['crimson-noir','Crimson Noir','#311526','#562237','#f4aabc','#debaeb','dark','manager'],
];
// Exact theme IDs, names and palettes from the supplied 1(1).zip.
export const PREVIOUS_THEMES = LEGACY_THEMES;
export const PREMIUM_THEMES = [
  ['premium-team-velvet','Velvet Prism','#fcf8ff','#ebdcfa','#6827b5','#922b52','light','all','#f5edff','#fff0ed'],
  ['premium-ios-orange','Orange Glass','#fff9f3','#ffe2bf','#ff982e','#ff8d42','light','manager','#fff0df','#ffeadf'],
  ['premium-ios-burgundy','Burgundy Glass','#fff8fb','#f2dce5','#8e294d','#5f1f39','light','manager','#fcecf4','#f4e1ee'],
  ['premium-macos-orange','macOS Orange Studio','#fffaf4','#ffdbb1','#ffb020','#f58b35','light','manager','#ffe6c2','#fff0dc'],
  ['premium-macos-burgundy','macOS Burgundy Studio','#fff9fc','#eddae6','#8b2850','#57213b','light','manager','#f8ecf3','#eeebfc'],
  ['premium-royal-violet-glass','Royal Violet Glass','#fbf8ff','#e4dcff','#6024b9','#441487','light','manager','#f3edff','#e8e8fb'],
  ['premium-royal-velvet-studio','Royal Velvet Studio','#fff9fe','#ebdaef','#722251','#4c1546','light','manager','#f8e9f4','#eee9fb'],
  ['premium-royal-purple-glass','Royal Purple Glass','#faf8ff','#e2d9fc','#5e28a6','#351b79','light','manager','#efe9ff','#e4edfc'],
  ['premium-ruby-glass','Ruby Glass','#fff9f8','#ffdcd8','#bd243d','#7c172f','light','manager','#ffedeb','#ffe4dd'],
];
export const THEMES = [...PREVIOUS_THEMES,...NEW_ADDED_THEMES,...PREMIUM_THEMES];
export const canUsePremiumTheme = (id,role) => id==='premium-team-velvet' || !String(id||'').startsWith('premium-') || String(role||'').trim().toLowerCase()==='manager';
export const CHAT_THEMES = [
  ['messenger','Messenger','#f4f8ff','#62aefe','#9b83f5','#123250'],
  ['mint','Mint Social','#f0faf5','#2ebc99','#7bd956','#123e30'],
  ['peach','Peach Club','#fff5f0','#ff982e','#ef6d91','#552722'],
  ['lilac','Lilac Lounge','#f7f3ff','#a779f1','#8f73e8','#342450'],
  ['rose','Rose Lounge','#fff4f8','#ff78a4','#ffb279','#51263e'],
  ['aqua','Aqua Wave','#effaff','#70dfe2','#89c7ff','#173c4b'],
  ['sunset','Sunset Studio','#fff8ea','#ffc937','#ff9d44','#573217'],
  ['berry','Berry Studio','#faf1ff','#e9adff','#c6b1ff','#402449'],
  ['midnight','Midnight Chat','#18243a','#a0bfff','#c0a9ff','#182b50','dark'],
  ['forest','Forest Chat','#18342e','#79d6b6','#b2dea0','#18372b','dark'],
];
export const CURSORS=[["cc922-classic","Classic Sharp",["manager","admin","tl","recruiter"]],["cc922-precision","Blue Precision \u00b7 TL / Manager",["manager","admin","tl"]],["cc922-reference","Prism Ribbon \u00b7 Manager",["manager","admin"]],["cc922-blade","Split Blade \u00b7 Manager",["manager","admin"]],["cc922-orbit","Prism Wing \u00b7 Manager",["manager","admin"]],["cc922-lance","Crystal Lance \u00b7 Manager",["manager","admin"]],["cc922-split","Twin Facet \u00b7 Manager",["manager","admin"]]];
const CURSOR_SVG={"cc922-classic":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"34\" height=\"44\" viewBox=\"0 0 34 44\"><defs><linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0%\" stop-color=\"#243652\"/><stop offset=\"100%\" stop-color=\"#617c9e\"/></linearGradient><clipPath id=\"c\"><path d=\"M2 1L24 23L15 22L11 38L8 24L2 29Z\"/></clipPath></defs><path d=\"M2 1L24 23L15 22L11 38L8 24L2 29Z\" fill=\"url(#g)\" stroke=\"#ffffff\" stroke-width=\".8\" stroke-linejoin=\"miter\"/><path d=\"M3 4L3 21\" stroke=\"#ffffff\" stroke-opacity=\".55\" stroke-width=\".7\"/></svg>","cc922-precision":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"34\" height=\"44\" viewBox=\"0 0 34 44\"><defs><linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0%\" stop-color=\"#0589cc\"/><stop offset=\"100%\" stop-color=\"#48c9ff\"/></linearGradient><clipPath id=\"c\"><path d=\"M2 1L25 23L15 23L10 38L7 23L2 29Z\"/></clipPath></defs><path d=\"M2 1L25 23L15 23L10 38L7 23L2 29Z\" fill=\"url(#g)\" stroke=\"#ffffff\" stroke-width=\".8\" stroke-linejoin=\"miter\"/><path d=\"M3 4L3 21\" stroke=\"#ffffff\" stroke-opacity=\".55\" stroke-width=\".7\"/></svg>","cc922-reference":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"34\" height=\"44\" viewBox=\"0 0 34 44\"><defs><linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0%\" stop-color=\"#7664a8\"/><stop offset=\"50%\" stop-color=\"#fb47a8\"/><stop offset=\"100%\" stop-color=\"#ffbe24\"/></linearGradient><clipPath id=\"c\"><path d=\"M2 1L30 25L22 26L15 38L10 26L2 30Z\"/></clipPath></defs><path d=\"M2 1L30 25L22 26L15 38L10 26L2 30Z\" fill=\"url(#g)\" stroke=\"#ffffff\" stroke-width=\".8\" stroke-linejoin=\"miter\"/><g clip-path=\"url(#c)\"><path d=\"M0 12L28 36H14L0 24Z\" fill=\"#fb45a4\"/><path d=\"M0 25L17 40H0Z\" fill=\"#ffc323\"/></g><circle cx=\"25\" cy=\"35\" r=\"2.4\" fill=\"#ec55ad\"/><circle cx=\"29\" cy=\"40\" r=\"1.6\" fill=\"#8e71b9\"/><circle cx=\"21\" cy=\"40\" r=\"1.2\" fill=\"#ffd13b\"/><path d=\"M3 4L3 21\" stroke=\"#ffffff\" stroke-opacity=\".55\" stroke-width=\".7\"/></svg>","cc922-blade":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"34\" height=\"44\" viewBox=\"0 0 34 44\"><defs><linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0%\" stop-color=\"#302969\"/><stop offset=\"50%\" stop-color=\"#8e5cff\"/><stop offset=\"100%\" stop-color=\"#2be5de\"/></linearGradient><clipPath id=\"c\"><path d=\"M2 1L31 18L18 20L11 39L8 22Z\"/></clipPath></defs><path d=\"M2 1L31 18L18 20L11 39L8 22Z\" fill=\"url(#g)\" stroke=\"#ffffff\" stroke-width=\".8\" stroke-linejoin=\"miter\"/><path d=\"M5 6L23 17L15 19L10 32Z\" fill=\"#cdfaff\" fill-opacity=\".78\"/><path d=\"M7 8L16 21L11 34\" fill=\"none\" stroke=\"#6238ad\" stroke-width=\"1.1\"/><path d=\"M3 4L3 21\" stroke=\"#ffffff\" stroke-opacity=\".55\" stroke-width=\".7\"/></svg>","cc922-orbit":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"34\" height=\"44\" viewBox=\"0 0 34 44\"><defs><linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0%\" stop-color=\"#062d55\"/><stop offset=\"50%\" stop-color=\"#05b7d6\"/><stop offset=\"100%\" stop-color=\"#6e65ff\"/></linearGradient><clipPath id=\"c\"><path d=\"M2 1L29 15L19 19L31 29L18 25L12 39L9 22Z\"/></clipPath></defs><path d=\"M2 1L29 15L19 19L31 29L18 25L12 39L9 22Z\" fill=\"url(#g)\" stroke=\"#ffffff\" stroke-width=\".8\" stroke-linejoin=\"miter\"/><path d=\"M4 5L18 17L12 21L13 32Z\" fill=\"#8efbe8\"/><path d=\"M19 20L27 26L18 23Z\" fill=\"#e2a9ff\"/><path d=\"M3 4L3 21\" stroke=\"#ffffff\" stroke-opacity=\".55\" stroke-width=\".7\"/></svg>","cc922-lance":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"34\" height=\"44\" viewBox=\"0 0 34 44\"><defs><linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0%\" stop-color=\"#8a3045\"/><stop offset=\"50%\" stop-color=\"#fa668a\"/><stop offset=\"100%\" stop-color=\"#ffc55b\"/></linearGradient><clipPath id=\"c\"><path d=\"M2 1L25 23L16 25L12 39L8 22Z\"/></clipPath></defs><path d=\"M2 1L25 23L16 25L12 39L8 22Z\" fill=\"url(#g)\" stroke=\"#ffffff\" stroke-width=\".8\" stroke-linejoin=\"miter\"/><path d=\"M5 6L19 21L13 23L11 32Z\" fill=\"#fff3ca\"/><path d=\"M7 11L12 22L11 28Z\" fill=\"#df5079\"/><path d=\"M3 4L3 21\" stroke=\"#ffffff\" stroke-opacity=\".55\" stroke-width=\".7\"/></svg>","cc922-split":"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"34\" height=\"44\" viewBox=\"0 0 34 44\"><defs><linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0%\" stop-color=\"#251d63\"/><stop offset=\"50%\" stop-color=\"#8648dc\"/><stop offset=\"100%\" stop-color=\"#f1a140\"/></linearGradient><clipPath id=\"c\"><path d=\"M2 1L31 24L20 23L24 37L16 39L12 25L5 31Z\"/></clipPath></defs><path d=\"M2 1L31 24L20 23L24 37L16 39L12 25L5 31Z\" fill=\"url(#g)\" stroke=\"#ffffff\" stroke-width=\".8\" stroke-linejoin=\"miter\"/><path d=\"M4 5L24 22L17 20L19 35L16 35L11 22L6 27Z\" fill=\"#dec4ff\"/><path d=\"M12 22L16 39L19 37L17 24Z\" fill=\"#ffb933\"/><path d=\"M3 4L3 21\" stroke=\"#ffffff\" stroke-opacity=\".55\" stroke-width=\".7\"/></svg>"};
export const allowedCursors=role=>CURSORS.filter(c=>c[2].includes(String(role||'recruiter').toLowerCase()));
export function defaultCursor(role){if(!role)try{role=JSON.parse(localStorage.getItem('careerCroxCachedUser')||'{}').role;}catch{}return /^(manager|admin)$/.test(String(role).toLowerCase())?'cc922-reference':String(role).toLowerCase()==='tl'?'cc922-precision':'cc922-classic';}
export const cursorUrl=id=>'data:image/svg+xml,'+encodeURIComponent(CURSOR_SVG[id]||CURSOR_SVG['cc922-classic']);
const REFERENCE_HAND="<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"34\" height=\"44\" viewBox=\"0 0 34 44\"><defs><linearGradient id=\"g\" x2=\"1\" y2=\"1\"><stop stop-color=\"#ff4ca8\"/><stop offset=\".55\" stop-color=\"#b36ac4\"/><stop offset=\"1\" stop-color=\"#785ba6\"/></linearGradient></defs><path d=\"M7 1L18 19L16 9L19 8L22 19L21 11L25 11L28 24L29 17L32 18L33 33L28 41L17 40L8 31L2 22L6 20L13 27Z\" fill=\"url(#g)\" stroke=\"white\" stroke-width=\".8\" stroke-linejoin=\"miter\"/><path d=\"M2 22L7 21L15 31L19 40L15 39L7 30Z\" fill=\"#ffc327\"/><circle cx=\"26\" cy=\"42\" r=\"1.6\" fill=\"#f54aab\"/><path d=\"M8 5L17 22\" stroke=\"#ffb9de\" stroke-width=\"1.2\"/></svg>";
export const pointerUrl=id=>id==='cc922-reference'?'data:image/svg+xml,'+encodeURIComponent(REFERENCE_HAND):cursorUrl(id);

const DEFAULTS = { theme:'', font:'inter', fontSize:14, accent:'', cursor:'cc922-classic', sound:'office-tone', soundVolume:55, chatTheme:'sunset', chatFont:'inter', reduceMotion:false, managerTeamPopups:true, popupAutoHide:true, popupSeconds:10 };
export function readPersonalSettings() {
  let data = {};
  try { data = JSON.parse(localStorage.getItem(`cc787:preferences:${cachePrincipal()}`) || '{}'); } catch {}
  // Upgrade only the former defaults once. Deliberately chosen styles remain.
  const key = `cc791:defaults:${cachePrincipal()}`;
  try {
    if (!localStorage.getItem(key)) {
      if (!data.cursor || data.cursor === 'default') data.cursor = defaultCursor();
      if (!data.chatTheme || data.chatTheme === 'messenger') data.chatTheme = 'sunset';
      localStorage.setItem(`cc787:preferences:${cachePrincipal()}`, JSON.stringify(data));
      localStorage.setItem(key, '1');
    }
  } catch {}
  const next = { ...DEFAULTS, ...data };
  if (!THEMES.some(t=>t[0]===next.theme)) next.theme='';
  if (!FONTS.some(t=>t[0]===next.font)) next.font='inter';
  if (!FONTS.some(t=>t[0]===next.chatFont)) next.chatFont='inter';
  if (!CHAT_THEMES.some(t=>t[0]===next.chatTheme)) next.chatTheme='sunset';
  let popupRole='';try{const u=JSON.parse(localStorage.getItem('careerCroxCachedUser')||'{}');popupRole=String(u.role||u.designation||'').toLowerCase();}catch{}
  const managerPopups=/manager|admin/.test(popupRole);
  next.managerTeamPopups=managerPopups?next.managerTeamPopups!==false:true;next.popupAutoHide=managerPopups&&next.popupAutoHide!==false;next.popupSeconds=Math.max(1,Math.min(300,Number(next.popupSeconds)||10));
  next.fontSize=Math.max(13,Math.min(18,Number(next.fontSize)||14));
  next.soundVolume=Math.max(0,Math.min(100,Number(next.soundVolume)||0));
  next.accent=/^#[a-f0-9]{6}$/i.test(next.accent)?next.accent:'';
  if(!allowedCursors(popupRole).some(c=>c[0]===next.cursor))next.cursor=defaultCursor(popupRole);
  return next;
}
export function savePersonalSettings(patch) {
  const next={...readPersonalSettings(),...patch};
  try { localStorage.setItem(`cc787:preferences:${cachePrincipal()}`,JSON.stringify(next)); } catch {}
  applyPersonalSettings(next);
  window.dispatchEvent(new Event('cc787-settings-changed'));
  return next;
}
export function applyPersonalSettings(p = readPersonalSettings(), fallbackTheme='orange', accountRole) {
  const root=document.documentElement;
  let role=accountRole;
  if(role===undefined)try{role=JSON.parse(localStorage.getItem('careerCroxCachedUser')||'{}').role;}catch{role='';}
  const requested=p.theme||fallbackTheme;
  const theme=THEMES.find(t=>t[0]===(canUsePremiumTheme(requested,role)?requested:'orange'))||THEMES.find(t=>t[0]==='orange');
  const appearanceKey=JSON.stringify([cachePrincipal(),p,fallbackTheme,role]);
  if(root.__cc829AppearanceKey===appearanceKey && root.dataset.theme===theme[0])return;
  root.__cc829AppearanceKey=appearanceKey;root.dataset.cc791='true';
  root.setAttribute('data-theme',theme[0]);
  root.dataset.cc819ThemeName=theme[1];
  const previous=PREVIOUS_THEMES.some(t=>t[0]===theme[0]);
  const premium=PREMIUM_THEMES.some(t=>t[0]===theme[0]);
  root.dataset.cc823ThemeFamily=premium?'premium':previous?'previous':'new';
  root.dataset.cc824Premium=premium?'true':'false';
  root.dataset.cc824Layout=theme[0].includes('macos')||theme[0].includes('studio')?'macos':'ios';
  root.dataset.cc829='true';
  root.dataset.cc829Finish=premium?(root.dataset.cc824Layout==='macos'?'studio':'glass'):'standard';
  root.dataset.cc825Orange=theme[0].includes('orange')?'true':'false';
  root.dataset.cc787Mode=theme[6]||'light';
  const cursor=allowedCursors(role).some(c=>c[0]===p.cursor)?p.cursor:defaultCursor(role);root.dataset.cc787Cursor=cursor;root.style.setProperty('--cc922-cursor',`url("${cursorUrl(cursor)}") 2 1,auto`);root.style.setProperty('--cc922-pointer',`url("${pointerUrl(cursor)}") ${cursor==='cc922-reference'?'7 1':'2 1'},pointer`);
  root.dataset.cc787Accent=p.accent?'custom':'default';
  root.dataset.cc787Motion=p.reduceMotion?'reduced':'full';
  const dark=theme[6]==='dark';
  const mix=(a,b,t)=>'#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('');
  const luminance=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
  const inkFor=(...colours)=>['#182033','#ffffff'].sort((a,b)=>Math.min(...colours.map(c=>(Math.max(luminance(b),luminance(c))+.05)/(Math.min(luminance(b),luminance(c))+.05)))-Math.min(...colours.map(c=>(Math.max(luminance(a),luminance(c))+.05)/(Math.min(luminance(a),luminance(c))+.05))))[0];
  const primary=p.accent||theme[4],accent=theme[5],surface=dark?theme[3]:'#ffffff';
  const buttonInk=inkFor(primary,accent);
  const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
  const readableFill=colour=>{if(contrast(colour,buttonInk)>=4.5)return colour;const target=buttonInk==='#ffffff'?'#000000':'#ffffff';for(let t=.02;t<=1;t+=.02){const next=mix(colour,target,t);if(contrast(next,buttonInk)>=4.5)return next;}return target;};
  const text=inkFor(surface),muted=dark?'#c2cde0':'#526070';
  const sideA=dark?theme[3]:mix(primary,'#ffffff',.82),sideB=dark?theme[2]:mix(accent,'#ffffff',.73);
  const vars={
    '--cc787-font':FONTS.find(t=>t[0]===p.font)?.[2]||FONTS[1][2],
    '--cc787-chat-font':FONTS.find(t=>t[0]===p.chatFont)?.[2]||FONTS[1][2],
    '--cc787-font-size':`${p.fontSize}px`,'--cc787-font-scale':String(p.fontSize/14),
    '--cc787-text':text,'--cc787-muted':muted,
    '--cc787-surface':surface,'--cc787-surface-soft':dark?theme[2]:mix(primary,'#ffffff',.95),
    '--text':text,'--text-main':text,'--text-primary':text,'--text-secondary':muted,'--muted':muted,'--muted-text':muted,
    '--card':surface,'--card-bg':surface,'--surface':surface,'--input-bg':dark?theme[2]:'#ffffff','--input-text':text,'--field-bg':dark?theme[2]:'#ffffff',
    '--border-color':dark?'#455671':'#d9e2ea','--cc820-button-ink':buttonInk,
    '--cc820-cta-a':readableFill(primary),'--cc820-cta-b':readableFill(accent),
    '--cc820-soft-a':mix(primary,'#ffffff',.9),'--cc820-soft-b':mix(accent,'#ffffff',.86),
    '--grad-1-a':primary,'--grad-1-b':accent,'--grad-2-a':accent,'--grad-2-b':primary,
    '--cc787-line':dark?'#465775':'#d3dfee','--cc787-accent':p.accent||theme[4],
    '--cc550-page-a':theme[2],'--cc550-page-b':theme[8]||theme[3],'--cc550-page-c':theme[9]||theme[2],
    '--brand-primary':primary,'--brand-secondary':accent,'--brand-accent':accent,'--brand-button':primary,
    '--surface-bg-base':theme[2],'--app-bg-start':theme[2],'--app-bg-mid':theme[8]||theme[3],'--app-bg-end':theme[9]||theme[2],
    '--cc550-side-a':sideA,'--cc550-side-b':sideB,
    '--cc550-top-a':theme[2],'--cc550-top-b':theme[3],
    '--cc550-title':text,'--cc550-sidebar-text':inkFor(sideA,sideB),
  };
  if(previous) Object.assign(vars,{
    // Restore the supplied ZIP's runtime variables, not just its palette labels.
    '--cc787-text':dark?'#f0f4fc':'#17324b','--cc787-muted':dark?'#c2cde0':'#4b6076',
    '--cc787-surface':dark?theme[2]:'#ffffff','--cc787-surface-soft':dark?theme[3]:'#f7faff',
    '--cc550-page-a':theme[2],'--cc550-page-b':theme[3],'--cc550-page-c':theme[2],
    '--cc550-side-a':dark?theme[3]:theme[0]==='orange'?'#ffbe88':theme[4],
    '--cc550-side-b':dark?theme[2]:theme[0]==='orange'?'#ff974a':theme[5],
    '--cc550-title':dark?'#f0f4fc':'#17324b','--cc550-sidebar-text':dark?'#f0f4fc':'#17324b',
  });
  if(theme[0]==='orange') Object.assign(vars,{
    '--cc550-side-a':'#ffb366','--cc550-side-b':'#ff892a',
    '--cc550-top-a':'#fff1df','--cc550-top-b':'#ffc985',
    '--cc550-page-a':'#fff8f0','--cc550-page-b':'#ffcc99','--cc550-page-c':'#fff0dc',
  });
  if(premium){
    const gradient=(a,b)=>{
      const ink=inkFor(a,b),target=ink==='#ffffff'?'#000000':'#ffffff';
      const fill=c=>{for(let t=0;t<=1;t+=.02){const v=mix(c,target,t);if(contrast(v,ink)>=5.3)return v;}return target;};
      return {a:fill(a),b:fill(b),ink};
    };
    // Saturated gradients extracted from the supplied CC26_718 reference.
    const colours={blue:['#2563eb','#8b5cf6'],coral:['#f97316','#ef4444'],mint:['#10b981','#84cc16'],violet:['#6366f1','#a855f7'],pink:theme[0].includes('orange')?['#c83f16','#f37425']:['#ec4899','#fb7185'],cyan:['#0ea5e9','#22c7c7'],gold:['#ffb020','#ff8d42'],brown:['#7e2f0c','#b45318']};
    for(const [name,pair] of Object.entries(colours)){const g=gradient(...pair);vars[`--cc824-${name}-a`]=g.a;vars[`--cc824-${name}-b`]=g.b;vars[`--cc824-${name}-ink`]=g.ink;}
    const g=gradient(primary,accent);
    Object.assign(vars,{'--cc824-primary-a':g.a,'--cc824-primary-b':g.b,'--cc824-primary-ink':g.ink,
      '--cc824-ink':'#202336','--cc824-muted':'#55546a','--cc824-line':mix(primary,'#ffffff',.76),
      '--cc824-wash':mix(primary,'#ffffff',.9),'--cc824-soft':mix(primary,'#ffffff',.96),
      '--cc824-side-a':theme[0].includes('orange')?'#ffb366':'#f0c2d3','--cc824-side-b':theme[0].includes('orange')?'#ff892a':'#dca2be',
      '--cc787-text':'#202336','--cc787-muted':'#55546a','--cc550-title':'#202336','--cc550-sidebar-text':'#202336'});
  }
  if(premium && /royal|ruby/.test(theme[0])) Object.assign(vars,{
    '--cc824-side-a':mix(primary,'#ffffff',.77),'--cc824-side-b':mix(accent,'#ffffff',.66),
    '--cc550-side-a':mix(primary,'#ffffff',.77),'--cc550-side-b':mix(accent,'#ffffff',.66),
  });
  const chat=CHAT_THEMES.find(t=>t[0]===p.chatTheme)||CHAT_THEMES[0];
  root.dataset.cc787Chat=chat[6]||'light';
  Object.assign(vars,{'--cc787-chat-bg':chat[2],'--cc787-chat-a':chat[3],'--cc787-chat-b':chat[4],'--cc787-chat-ink':chat[5],'--cc787-chat-text':chat[6]?'#eff5ff':'#17324b','--cc787-chat-panel':chat[6]?chat[2]:'#ffffff'});
  for(const [key,value] of Object.entries(vars)) root.style.setProperty(key,value);
}

export function resetPersonalSettings(){
 const key=`cc787:preferences:${cachePrincipal()}`;try{localStorage.removeItem(key);localStorage.removeItem('careerCroxCustomTheme');localStorage.setItem('careerCroxTheme','orange');}catch{}
 const next={...DEFAULTS,theme:'orange'};applyPersonalSettings(next);window.dispatchEvent(new Event('cc787-settings-changed'));return next;
}

if(typeof window!=='undefined')window.__CC875_POPUP_SETTINGS__=readPersonalSettings;
