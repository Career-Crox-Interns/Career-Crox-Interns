(() => {
  'use strict';

  // CC26_537: soft-shell 10-theme system with login isolation and safe CC26_526 original-theme reset. Layout/card/button sizes are intentionally untouched.
  const THEMES = [
    ['orange','Orange',{page:'linear-gradient(130deg,#fff8f2,#fee9da)',side:'linear-gradient(150deg,#ffb14f,#f37321)',top:'linear-gradient(112deg,#fff9f5,#ffe5d3)',swatch:'linear-gradient(145deg,#ffb14f,#f37321)',glow:'linear-gradient(112deg,transparent,rgba(255,255,255,.2) 45%,transparent 70%)',shadow:'rgba(31,51,81,.10)'}],
    ['blue','Blue',{page:'linear-gradient(130deg,#f4f9ff,#e5f0ff)',side:'linear-gradient(150deg,#55b0ff,#1f73ff)',top:'linear-gradient(112deg,#f8fbff,#dbeaff)',swatch:'linear-gradient(145deg,#55b0ff,#1f73ff)',glow:'linear-gradient(112deg,transparent,rgba(255,255,255,.2) 45%,transparent 70%)',shadow:'rgba(31,51,81,.10)'}],
    ['green','Green',{page:'linear-gradient(130deg,#f4fdf8,#e2f8ec)',side:'linear-gradient(150deg,#45d987,#0fa95b)',top:'linear-gradient(112deg,#f8fdf9,#ddf7ea)',swatch:'linear-gradient(145deg,#45d987,#0fa95b)',glow:'linear-gradient(112deg,transparent,rgba(255,255,255,.2) 45%,transparent 70%)',shadow:'rgba(31,51,81,.10)'}],
    ['pink','Rose',{page:'linear-gradient(130deg,#fff8f9,#ffe4ec)',side:'linear-gradient(150deg,#f58aa7,#da4e75)',top:'linear-gradient(112deg,#fffcfd,#ffe8ee)',swatch:'linear-gradient(145deg,#f58aa7,#da4e75)',glow:'linear-gradient(112deg,transparent,rgba(255,255,255,.2) 45%,transparent 70%)',shadow:'rgba(31,51,81,.10)'}],
    ['purple','Purple',{page:'linear-gradient(130deg,#faf8ff,#f0eaff)',side:'linear-gradient(150deg,#b07bff,#7440e6)',top:'linear-gradient(112deg,#fdfbff,#ebe2ff)',swatch:'linear-gradient(145deg,#b07bff,#7440e6)',glow:'linear-gradient(112deg,transparent,rgba(255,255,255,.2) 45%,transparent 70%)',shadow:'rgba(31,51,81,.10)'}],
    ['gold','Gold',{page:'linear-gradient(130deg,#fffcf6,#fff2d8)',side:'linear-gradient(150deg,#f7ca53,#d39a1d)',top:'linear-gradient(112deg,#fffdf8,#fff1cf)',swatch:'linear-gradient(145deg,#f7ca53,#d39a1d)',glow:'linear-gradient(112deg,transparent,rgba(255,255,255,.2) 45%,transparent 70%)',shadow:'rgba(31,51,81,.10)'}],
    ['rose','Pink',{page:'linear-gradient(130deg,#fff9fc,#ffe8f4)',side:'linear-gradient(150deg,#fff3f9,#ffbedb)',top:'linear-gradient(112deg,#fffafd,#ffe6f1)',swatch:'linear-gradient(145deg,#fff3f9,#ffbedb)',glow:'linear-gradient(112deg,transparent,rgba(255,255,255,.2) 45%,transparent 70%)',shadow:'rgba(31,51,81,.10)'}],
    ['burgundy','Managers Only',{page:'linear-gradient(130deg,#fff8fb,#f3e7ec)',side:'linear-gradient(150deg,#9a4b66,#67203c)',top:'linear-gradient(112deg,#fffafd,#f0dce5)',swatch:'linear-gradient(145deg,#9a4b66,#67203c)',glow:'linear-gradient(112deg,transparent,rgba(255,255,255,.2) 45%,transparent 70%)',shadow:'rgba(31,51,81,.10)'}],
    ['dark-navy','Dark Navy',{page:'linear-gradient(130deg,#eef4fb,#dceafa)',side:'linear-gradient(150deg,#184685,#0f2853)',top:'linear-gradient(112deg,#edf5ff,#d8e6fb)',swatch:'linear-gradient(145deg,#184685,#0f2853)',glow:'linear-gradient(112deg,transparent,rgba(255,255,255,.2) 45%,transparent 70%)',shadow:'rgba(31,51,81,.10)'}],
    ['midnight','Midnight',{page:'linear-gradient(130deg,#101d31,#22344b)',side:'linear-gradient(150deg,#1b2b45,#0e1727)',top:'linear-gradient(112deg,#223854,#17273e)',swatch:'linear-gradient(145deg,#1b2b45,#0e1727)',glow:'linear-gradient(112deg,transparent,rgba(255,255,255,.2) 45%,transparent 70%)',shadow:'rgba(31,51,81,.10)'}],
    ['dark-midnight','Dark Sapphire',{page:'linear-gradient(135deg,#182b4a,#101e34)',side:'linear-gradient(160deg,#192a4a,#09172d)',top:'linear-gradient(112deg,#192a4a,#09172d)',swatch:'linear-gradient(145deg,#192a4a,#09172d)',glow:'none',shadow:'rgba(13,19,38,.28)'}],
    ['crimson-noir','Crimson Noir',{page:'linear-gradient(135deg,#32121f,#15131e)',side:'linear-gradient(160deg,#6a152c,#090d18)',top:'linear-gradient(112deg,#6a152c,#090d18)',swatch:'linear-gradient(145deg,#6a152c,#090d18)',glow:'none',shadow:'rgba(13,19,38,.28)'}],
    ['cosmic-berry','Cosmic Berry',{page:'linear-gradient(135deg,#321d4b,#152e5a)',side:'linear-gradient(160deg,#703047,#173f7f)',top:'linear-gradient(112deg,#703047,#173f7f)',swatch:'linear-gradient(145deg,#703047,#173f7f)',glow:'none',shadow:'rgba(13,19,38,.28)'}],
    ['magenta-pop','Magenta Pop',{page:'linear-gradient(130deg,#fff1fa,#fce0fb)',side:'linear-gradient(150deg,#fa62d0,#b72cc7)',top:'linear-gradient(112deg,#fff8fe,#f5d6fb)',swatch:'linear-gradient(145deg,#ef8ddb,#b72cc7)',glow:'none',shadow:'rgba(80,65,155,.12)'}],
    ['neon-ink','Neon Ink',{page:'linear-gradient(130deg,#111427,#192647)',side:'linear-gradient(150deg,#1b1d38,#071422)',top:'linear-gradient(112deg,#1b1328,#14152a)',swatch:'linear-gradient(145deg,#f642bb,#071422)',glow:'none',shadow:'rgba(14,13,35,.24)'}],
    ['berry-chrome','Berry Chrome',{page:'linear-gradient(130deg,#2d132b,#241539)',side:'linear-gradient(150deg,#69234f,#201333)',top:'linear-gradient(112deg,#431c37,#311b43)',swatch:'linear-gradient(145deg,#e96cd1,#201333)',glow:'none',shadow:'rgba(14,13,35,.24)'}],
    ['ice-lilac','Ice Lilac',{page:'linear-gradient(130deg,#f2f6ff,#f2e5ff)',side:'linear-gradient(150deg,#cfc1ff,#8f9dfa)',top:'linear-gradient(112deg,#f9fcff,#e4defc)',swatch:'linear-gradient(145deg,#acb9ff,#8f9dfa)',glow:'none',shadow:'rgba(80,65,155,.12)'}],
  ];

  THEMES.sort((a,b) => (a[0]==='crimson-noir' ? -1 : b[0]==='crimson-noir' ? 1 : a[0]==='burgundy' ? -1 : b[0]==='burgundy' ? 1 : 0));
  const KEYS = THEMES.map(x => x[0]);
  const MAP = Object.fromEntries(THEMES.map(x => [x[0], x]));
  const SAVED_KEY = 'careerCroxApprovedV12Theme';
  const ORIGINAL_THEME = 'peach-sky';
  function managerThemeAllowed(){
    try { const u=JSON.parse(localStorage.getItem('careerCroxCachedUser')||'null');
      return [u?.role,u?.designation].some(v=>String(v||'').trim().toLowerCase()==='manager');
    }catch(_){return false;}
  }
  function syncManagerFlag(){
    document.documentElement.dataset.ccBurgundyAllowed=managerThemeAllowed()?'1':'0';
  }
  function allowedTheme(t){return (t!=='burgundy'&&t!=='crimson-noir')||managerThemeAllowed();}

  let applying = false;

  function ensurePolishCss(){
    if(document.getElementById('cc26-535-theme-polish')) return;
    const style = document.createElement('style');
    style.id = 'cc26-535-theme-polish';
    style.textContent = `
      .sidebar,.topbar{transition:background-color .18s ease,border-color .18s ease!important}
      body::before{content:"";position:fixed;inset:-18%;pointer-events:none;z-index:0;background:var(--cc535-glow,none);opacity:.75;transform:rotate(-2deg)}
      #root,.app-shell,.main-wrap,.page-scroll{position:relative;z-index:1}
      .sidebar,.topbar{backdrop-filter:blur(16px) saturate(1.14)!important;-webkit-backdrop-filter:blur(16px) saturate(1.14)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.58),0 10px 28px var(--cc535-shadow,rgba(20,50,90,.12))!important}
      .sidebar{border-right-color:rgba(255,255,255,.45)!important}
      .topbar{border-color:rgba(255,255,255,.48)!important}
      [data-theme="dark-navy"] .sidebar,[data-theme="dark-navy"] .topbar,[data-theme="midnight"] .sidebar,[data-theme="midnight"] .topbar{color:#f7fbff!important}
      [data-theme="dark-navy"] .sidebar a,[data-theme="dark-navy"] .sidebar button,[data-theme="dark-navy"] .sidebar span,[data-theme="dark-navy"] .sidebar strong,[data-theme="midnight"] .sidebar a,[data-theme="midnight"] .sidebar button,[data-theme="midnight"] .sidebar span,[data-theme="midnight"] .sidebar strong{color:#f7fbff!important;-webkit-text-fill-color:#f7fbff!important}
      [data-theme="dark-navy"] .sidebar .prominent-theme-box,[data-theme="midnight"] .sidebar .prominent-theme-box,[data-theme="dark-navy"] .sidebar .prominent-theme-box :is(.theme-heading,.theme-look-copy,.theme-choice-copy,.theme-look-copy strong,.theme-choice-copy strong,.theme-look-copy small,.theme-choice-copy small,.theme-look-action,.theme-choice-status,.helper-text,.selection-count-chip,.theme-select-shell,.theme-select-shell span,.custom-theme-box),[data-theme="midnight"] .sidebar .prominent-theme-box :is(.theme-heading,.theme-look-copy,.theme-choice-copy,.theme-look-copy strong,.theme-choice-copy strong,.theme-look-copy small,.theme-choice-copy small,.theme-look-action,.theme-choice-status,.helper-text,.selection-count-chip,.theme-select-shell,.theme-select-shell span,.custom-theme-box){color:#173052!important;-webkit-text-fill-color:#173052!important;opacity:1!important}
      [data-theme="dark-navy"] .sidebar .prominent-theme-box :is(.theme-look-option,.theme-choice-card,.custom-theme-box,.theme-select-shell,.selection-count-chip),[data-theme="midnight"] .sidebar .prominent-theme-box :is(.theme-look-option,.theme-choice-card,.custom-theme-box,.theme-select-shell,.selection-count-chip){background:linear-gradient(145deg,rgba(255,255,255,.98),rgba(235,243,252,.95))!important;color:#173052!important;-webkit-text-fill-color:#173052!important;border-color:#c4d4e7!important}
      [data-theme="dark-navy"] .sidebar .prominent-theme-box .theme-heading-row>.ghost-btn,[data-theme="midnight"] .sidebar .prominent-theme-box .theme-heading-row>.ghost-btn,[data-theme="dark-navy"] .sidebar .prominent-theme-box .custom-theme-box .ghost-btn:not(.custom-theme-reset),[data-theme="midnight"] .sidebar .prominent-theme-box .custom-theme-box .ghost-btn:not(.custom-theme-reset){background:linear-gradient(145deg,#fff,#eaf2fb)!important;color:#173052!important;-webkit-text-fill-color:#173052!important;border-color:#bfd0e6!important;opacity:1!important;text-shadow:none!important}
      [data-theme="dark-navy"] .sidebar .prominent-theme-box select,[data-theme="midnight"] .sidebar .prominent-theme-box select{background:#fff!important;color:#173052!important;-webkit-text-fill-color:#173052!important;border-color:#bfd0e6!important;opacity:1!important}
      [data-theme="dark-navy"] .sidebar .prominent-theme-box :is(.theme-look-number,.theme-choice-number,.custom-theme-reset),[data-theme="midnight"] .sidebar .prominent-theme-box :is(.theme-look-number,.theme-choice-number,.custom-theme-reset){color:#fff!important;-webkit-text-fill-color:#fff!important;opacity:1!important}
    `;
    document.head.appendChild(style);
  }

  function savedTheme(){
    try{
      const saved = String(localStorage.getItem(SAVED_KEY) || '').toLowerCase();
      if(KEYS.includes(saved) && allowedTheme(saved)) return saved;
      const legacy = String(localStorage.getItem('careerCroxTheme') || '').toLowerCase();
      if(legacy === ORIGINAL_THEME) return '__original__';
      return KEYS.includes(legacy) && allowedTheme(legacy) ? legacy : 'orange';
    }catch(_){ return 'orange'; }
  }

  function importantBackground(el, value){
    if(!el) return;
    el.style.setProperty('background', value, 'important');
    el.style.setProperty('background-image', value, 'important');
    el.style.setProperty('background-attachment', 'fixed', 'important');
  }

  function isLoginSurface(){
    try{
      const path = String(window.location && window.location.pathname || '').toLowerCase();
      const body = document.body;
      return path === '/login' || path.startsWith('/login/') || !!(body && (body.classList.contains('login-body') || body.classList.contains('cc-style15-login-body'))) || !!document.querySelector('.cc-style15-login');
    }catch(_){ return false; }
  }

  function clearInlineSurfaceBackgrounds(){
    [document.body,...document.querySelectorAll('.app-shell,.main-wrap,.page-scroll,.sidebar,.topbar')].filter(Boolean).forEach((el)=>{
      el.style.removeProperty('background');
      el.style.removeProperty('background-image');
      el.style.removeProperty('background-attachment');
    });
  }

  function applySurface(theme){
    ensurePolishCss();
    const spec = MAP[theme] || MAP.orange;
    // CC26_537: never paint saturated theme gradients directly onto the CRM.
    // The stylesheet's data-theme rules own the shell: stronger sidebar, soft topbar,
    // very light page tint, while cards/tables/forms keep their original surfaces.
    clearInlineSurfaceBackgrounds();
    if(isLoginSurface()){
      document.documentElement.style.removeProperty('--cc535-glow');
      document.documentElement.style.removeProperty('--cc535-shadow');
      return;
    }
    document.documentElement.style.setProperty('--cc535-glow', spec[2].glow);
    document.documentElement.style.setProperty('--cc535-shadow', spec[2].shadow);
  }

  function allThemeOptions(){
    const look = [...document.querySelectorAll('.theme-look-list .theme-look-option')];
    if(look.length) return look;
    return [...document.querySelectorAll('.theme-choice-grid .theme-choice-card')];
  }

  function syncOptions(theme){
    const cards = allThemeOptions();
    cards.forEach((card,index) => {
      const t = THEMES.find(x=>card.classList.contains('theme-'+x[0])); if(!t) return;
      const restricted = (t[0]==='burgundy'||t[0]==='crimson-noir') && !managerThemeAllowed();
      if(card.hidden) card.hidden=false;
      if(restricted){
        card.setAttribute('aria-disabled','true');card.setAttribute('title','Managers Only');
        card.dataset.managerOnly='1';
      }else{
        card.removeAttribute('aria-disabled');card.removeAttribute('data-manager-only');
        card.setAttribute('title',t[1]+' theme');
      }
      card.dataset.cc531Theme = t[0];
      card.classList.toggle('active-theme', t[0] === theme);
      card.setAttribute('aria-label', restricted ? 'Managers Only — available to managers' : t[1] + ' theme');
      const strong = card.querySelector('.theme-look-copy strong,.theme-choice-copy strong');
      const small = card.querySelector('.theme-look-copy small,.theme-choice-copy small');
      const status = card.querySelector('.theme-look-action,.theme-choice-status');
      const number = card.querySelector('.theme-look-number,.theme-choice-number');
      if(strong && strong.textContent !== t[1]) strong.textContent = t[1];
      if(small){const exclusive=t[0]==='burgundy'||t[0]==='crimson-noir';const label=exclusive?'Managers Only':t[0]===theme?'Active':'Tap to apply';if(small.textContent!==label)small.textContent=label;}
      if(status){const label=restricted?'Locked':t[0]===theme?'Active':'Choose';if(status.textContent!==label)status.textContent=label;}
      if(number){
        const label=t[0]===theme?'✓':String(index+1);
        if(number.textContent!==label)number.textContent=label;
        number.style.setProperty('background', t[2].swatch, 'important');
        number.style.setProperty('box-shadow', 'inset 0 1px 0 rgba(255,255,255,.62),0 5px 14px '+t[2].shadow, 'important');
        number.style.setProperty('color', '#fff', 'important');
        number.style.setProperty('-webkit-text-fill-color', '#fff', 'important');
      }
    });
  }


  function styleResetButton(el){
    if(!el) return;
    try{
      el.disabled = false;
      el.removeAttribute('disabled');
      el.removeAttribute('aria-disabled');
      el.textContent = 'Reset Original Theme';
      el.title = 'Restore the exact original CC26_526 CRM theme';
      const st = el.style;
      st.setProperty('background','linear-gradient(135deg,#ff7a18 0%,#ff5b3d 46%,#e92f61 100%)','important');
      st.setProperty('color','#ffffff','important');
      st.setProperty('-webkit-text-fill-color','#ffffff','important');
      st.setProperty('border','1px solid rgba(255,255,255,.88)','important');
      st.setProperty('box-shadow','inset 0 1px 0 rgba(255,255,255,.55),0 10px 24px rgba(210,54,64,.28)','important');
      st.setProperty('text-shadow','0 1px 2px rgba(83,18,28,.52)','important');
      st.setProperty('opacity','1','important');
      st.setProperty('filter','none','important');
      st.setProperty('visibility','visible','important');
      st.setProperty('font-size','13px','important');
      st.setProperty('font-weight','1000','important');
      st.setProperty('line-height','1.24','important');
      st.setProperty('cursor','pointer','important');
    }catch(_){ }
  }

  function removeOldColourTools(){
    document.querySelectorAll('.theme-labels').forEach(el => el.remove());
    document.querySelectorAll('.custom-theme-box').forEach(box => {
      box.querySelectorAll('.custom-theme-title').forEach(el => el.remove());
      box.querySelectorAll('.theme-slider-row,.custom-theme-grid').forEach(el => el.remove());
      box.querySelectorAll('.theme-select-row').forEach(el => {
        if(/Background Colour/i.test(el.textContent || '')) el.remove();
      });
      box.querySelectorAll('.custom-theme-save').forEach(el => el.remove());
      box.querySelectorAll('.custom-theme-reset').forEach(el => {
        styleResetButton(el);
      });
    });
  }

  function clearSurfaceOverrides(){
    ['--cc535-glow','--cc535-shadow'].forEach((key)=>document.documentElement.style.removeProperty(key));
    [document.body,...document.querySelectorAll('.app-shell,.main-wrap,.page-scroll,.sidebar,.topbar')].filter(Boolean).forEach((el)=>{
      el.style.removeProperty('background');
      el.style.removeProperty('background-image');
      el.style.removeProperty('background-attachment');
    });
  }

  function persistThemeName(name){
    try{
      fetch('/api/theme',{
        method:'POST',credentials:'include',
        headers:{'Content-Type':'application/json','X-Career-Crox-Background':'1'},
        body:JSON.stringify({theme_name:name,custom_theme_json:''})
      }).catch(()=>{});
    }catch(_){ }
  }

  function resetOriginalTheme(remember=true){
    if(applying) return;
    applying = true;
    try{
      clearStaleCustomThemeVars?.();
    }catch(_){ }
    try{
      localStorage.removeItem(SAVED_KEY);
      localStorage.removeItem('careerCroxCustomTheme');
      localStorage.setItem('careerCroxTheme', ORIGINAL_THEME);
    }catch(_){ }
    clearSurfaceOverrides();
    document.documentElement.setAttribute('data-theme', ORIGINAL_THEME);
    syncOptions('__original__');
    removeOldColourTools();
    document.querySelectorAll('.custom-theme-reset').forEach((b)=>{
      styleResetButton(b);
    });
    if(remember) persistThemeName(ORIGINAL_THEME);
    applying = false;
  }

  function applyTheme(theme, remember=true){
    if(!KEYS.includes(theme) || !allowedTheme(theme)) theme = 'orange';
    if(applying) return;
    applying = true;
    try{
      try{
        localStorage.removeItem('careerCroxCustomTheme');
        localStorage.setItem('careerCroxTheme', theme);
        if(remember) localStorage.setItem(SAVED_KEY, theme);
      }catch(_){ }
      document.documentElement.setAttribute('data-theme', theme);
      applySurface(theme);
      syncOptions(theme);
      removeOldColourTools();
      document.querySelectorAll('.custom-theme-reset').forEach((b)=>{styleResetButton(b)});
      if(remember) persistThemeName(theme);
    } finally { applying = false; }
  }

  // CC26_544: React owns allowed clicks; never intercept them in capture phase.
  // Otherwise its theme state stays stale and next render reverts active selections.
  // Only block direct attempts to select manager-only Burgundy.
  document.addEventListener('click', (event) => {
    const card=event.target && event.target.closest && event.target.closest('.theme-look-option.theme-burgundy,.theme-choice-card.theme-burgundy,.theme-look-option.theme-crimson-noir,.theme-choice-card.theme-crimson-noir');
    if(card && !managerThemeAllowed()){
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    }
  },true);
  const attrObserver = new MutationObserver(() => {
    if(applying) return;
    syncManagerFlag();
    let chosen=String(document.documentElement.getAttribute('data-theme')||'orange').toLowerCase();
    if((chosen==='burgundy'||chosen==='crimson-noir') && !managerThemeAllowed()){
      chosen='orange';document.documentElement.setAttribute('data-theme',chosen);
      try{localStorage.setItem('careerCroxTheme',chosen)}catch(_){}
    }
    // React has committed this theme, so mirror it; do not overwrite React from
    // a stale approved-key and do not write the DOM attribute again.
    try{if(chosen===ORIGINAL_THEME)localStorage.removeItem(SAVED_KEY);
        else if(KEYS.includes(chosen))localStorage.setItem(SAVED_KEY,chosen)}catch(_){}
    syncOptions(chosen===ORIGINAL_THEME?'__original__':chosen);
  });
  attrObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});

  // CC26_543: React may remount Appearance. Observe only NEW relevant elements.
  // Updating textContent inside the options/reset button creates childList records.
  // Never schedule another refresh for those records (the old code ran on EVERY
  // mutation and created an endless requestAnimationFrame -> mutation loop).
  let scheduled = false;
  const domObserver = new MutationObserver((changes) => {
    if(scheduled || applying) return;
    const isThemeElement = (node) => node && node.nodeType === 1 && (
      (node.matches && node.matches('.prominent-theme-box,.theme-panel-body,.theme-look-list,.theme-choice-grid,.theme-look-option,.theme-choice-card')) ||
      (node.querySelector && node.querySelector('.prominent-theme-box,.theme-panel-body,.theme-look-list,.theme-choice-grid,.theme-look-option,.theme-choice-card'))
    );
    if(!changes.some(record => Array.from(record.addedNodes).some(isThemeElement))) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if(applying) return;
      const t = savedTheme();
      // The observer watches only React insertions, NOT our own updates.
      syncManagerFlag();
      if(t === '__original__') syncOptions('__original__');
      else syncOptions(t);
      removeOldColourTools();
    });
  });
  function boot(){
    syncManagerFlag();
    const initial=savedTheme(); if(initial==='__original__') resetOriginalTheme(false); else applyTheme(initial, false);
    if(document.body) domObserver.observe(document.body,{childList:true,subtree:true});
  }
  window.addEventListener('storage', e=>{if(e.key==='careerCroxCachedUser'){syncManagerFlag();const t=savedTheme();if(t!=='__original__')applyTheme(t,false);syncOptions(t);}});
  window.__CC532_APPLY_THEME = (theme)=>applyTheme(theme,true);
  window.__CC532_RESET_THEME = ()=>resetOriginalTheme(true);

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true}); else boot();
})();
