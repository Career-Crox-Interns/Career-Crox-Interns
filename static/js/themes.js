
(function() {
  const html = document.documentElement;
  const buttons = document.querySelectorAll('[data-theme]');
  const presetKey = 'career_crox_theme';
  const mixKey = 'career_crox_custom_mix';
  const stored = localStorage.getItem(presetKey) || html.getAttribute('data-theme') || 'corporate-light';
  html.setAttribute('data-theme', stored);

  function syncActive(theme) {
    buttons.forEach(btn => btn.classList.toggle('active-theme', btn.dataset.theme === theme));
  }

  function applyMix(mix) {
    if (!mix) return;
    html.style.setProperty('--grad-1-a', mix.mixA);
    html.style.setProperty('--grad-1-b', mix.mixB);
    html.style.setProperty('--grad-2-a', mix.btnA);
    html.style.setProperty('--grad-2-b', mix.btnB);
    html.style.setProperty('--sidebar-bg', `linear-gradient(180deg, ${mix.mixA}22, #ffffff, ${mix.mixB}22)`);
    html.style.setProperty('--app-bg', `linear-gradient(180deg, ${mix.mixA}16, #fffaf6 45%, ${mix.mixB}16)`);
  }

  const storedMixRaw = localStorage.getItem(mixKey);
  let storedMix = null;
  try { storedMix = storedMixRaw ? JSON.parse(storedMixRaw) : null; } catch (e) { storedMix = null; }
  if (storedMix) applyMix(storedMix);
  syncActive(stored);

  buttons.forEach(btn => {
    btn.addEventListener('click', function() {
      const theme = this.dataset.theme;
      html.setAttribute('data-theme', theme);
      localStorage.setItem(presetKey, theme);
      syncActive(theme);
    });
  });

  const a = document.getElementById('themeMixA');
  const b = document.getElementById('themeMixB');
  const c = document.getElementById('themeBtnA');
  const d = document.getElementById('themeBtnB');
  const reset = document.getElementById('customThemeReset');
  function currentMix(){ return { mixA: a?.value || '#ffb36b', mixB: b?.value || '#6db7ff', btnA: c?.value || '#5f7cff', btnB: d?.value || '#f77f9b' }; }
  function syncInputs(mix){ if(a) a.value = mix.mixA; if(b) b.value = mix.mixB; if(c) c.value = mix.btnA; if(d) d.value = mix.btnB; }
  if (storedMix) syncInputs(storedMix);
  [a,b,c,d].forEach(inp => inp && inp.addEventListener('input', () => {
    const mix = currentMix();
    applyMix(mix);
    localStorage.setItem(mixKey, JSON.stringify(mix));
  }));
  reset && reset.addEventListener('click', () => {
    localStorage.removeItem(mixKey);
    html.style.removeProperty('--grad-1-a');
    html.style.removeProperty('--grad-1-b');
    html.style.removeProperty('--grad-2-a');
    html.style.removeProperty('--grad-2-b');
    html.style.removeProperty('--sidebar-bg');
    html.style.removeProperty('--app-bg');
    syncInputs({ mixA:'#ffb36b', mixB:'#6db7ff', btnA:'#5f7cff', btnB:'#f77f9b' });
  });
})();

(function(){
  const html=document.documentElement;
  const bgInput=document.getElementById("themeBgUrl");
  const opacityInput=document.getElementById("themeGlassOpacity");
  const bgKey="career_crox_glass_wallpaper";
  const opKey="career_crox_glass_opacity";
  const applyBg=()=>{ const url=(bgInput?.value||"").trim(); if(url){ html.style.setProperty("--custom-bg-image", `url(${url})`); localStorage.setItem(bgKey,url); } else { html.style.removeProperty("--custom-bg-image"); localStorage.removeItem(bgKey); } };
  const applyOp=()=>{ const val=opacityInput?.value||"78"; html.style.setProperty("--glass-opacity", String((parseInt(val,10)||78)/100)); localStorage.setItem(opKey,val); };
  if(bgInput){ const saved=localStorage.getItem(bgKey)||""; bgInput.value=saved; if(saved) html.style.setProperty("--custom-bg-image", `url(${saved})`); bgInput.addEventListener("input", applyBg); }
  if(opacityInput){ const saved=localStorage.getItem(opKey)||"78"; opacityInput.value=saved; html.style.setProperty("--glass-opacity", String((parseInt(saved,10)||78)/100)); opacityInput.addEventListener("input", applyOp); }
})();
