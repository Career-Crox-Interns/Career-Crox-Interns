/* CC902: compact, high-contrast popup appearance. No requests or timers. */
(function () {
  'use strict';
  const id = 'cc902-popup-look';
  if (document.getElementById(id)) return;
  const sheet = document.createElement('style');
  sheet.id = id;
  sheet.textContent = `
    html body #root > .cc459-shell,
    html body #root > .cc459-source-shell,
    html body .cc783-page-opening,
    html body .cc754-login-firstpaint,
    html body .cc604-route-opening { display: none !important; }
    html body .auth-boot-fallback > .panel {
      background: transparent !important;
      border: 0 !important;
      box-shadow: none !important;
    }
    :root {
      --cc902-call-bg: linear-gradient(145deg,#2563eb,#1239a7);
      --cc902-call-shadow: 0 3px 7px #1749b847,inset 0 1px #ffffff5e;
      --cc902-wa-bg: linear-gradient(145deg,#17a966,#067740);
      --cc902-wa-shadow: 0 3px 7px #06774040,inset 0 1px #ffffff6b;
      --cc902-icon-ink: #fff;
      --cc902-icon-size: 16px;
      --cc902-note-bg: linear-gradient(115deg,#edf3ff,#eeeaff);
      --cc902-note-border: 1px solid #a9bdf2;
      --cc902-context-bg: linear-gradient(115deg,#f3edff,#eaf6ff);
      --cc902-body-ink: #173450;
      --cc902-due-bg: linear-gradient(110deg,#dcefff,#e8f4ff);
    }
    html body .cc730-direct-reminder-deck,
    html body .cc803-review-popup {
      font-family: 'Segoe UI',Inter,Arial,sans-serif !important;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }
    html body .cc730-direct-reminder-deck .cc388-card {
      border-radius: 13px !important;
      box-shadow: 0 9px 27px #143c7029,0 2px 6px #143c7012 !important;
    }
    html body .cc901-contact-actions { gap: 4px !important; }
    html body .cc901-contact.call,
    html body .cc901-contact.whatsapp {
      border: 1px solid #ffffffa6 !important;
      border-radius: 7px !important;
      color: #fff !important;
      -webkit-text-fill-color: #fff !important;
      background: linear-gradient(145deg,#2563eb,#1239a7) !important;
      box-shadow: 0 3px 7px #1749b847,inset 0 1px #ffffff5e !important;
      transition: transform .14s ease,box-shadow .14s ease !important;
    }
    html body .cc901-contact.whatsapp {
      background: linear-gradient(145deg,#17a966,#067740) !important;
      box-shadow: 0 3px 7px #06774040,inset 0 1px #ffffff6b !important;
    }
    html body .cc901-contact svg {
      width: 16px !important;
      height: 16px !important;
      stroke: #fff !important;
      stroke-width: 1.9 !important;
    }
    html body .cc901-contact:hover,
    html body .cc901-contact:focus-visible {
      transform: scale(1.2) !important;
      outline: 2px solid #8db6fa !important;
      outline-offset: 2px !important;
    }
    html body .cc901-contact.whatsapp:hover,
    html body .cc901-contact.whatsapp:focus-visible {
      outline-color: #6ad8a1 !important;
    }
    html body .cc388-head-actions > button {
      border: 1px solid #b8c9e4 !important;
      background: #fff !important;
      color: #21466f !important;
      border-radius: 6px !important;
      box-shadow: 0 1px 3px #183b6617 !important;
    }
    html body .cc388-head-actions > .cc388-x {
      color: #b32245 !important;
      background: #fff0f3 !important;
      border-color: #edb6c4 !important;
    }
    html body .cc388-count {
      color: #173c75 !important;
      font-weight: 800 !important;
    }
    html body .cc388-note span { font-weight: 600 !important; }
    html body .cc898-reminder-context b { font-weight: 750 !important; }
    html body .cc388-presets button {
      border: 1px solid #9fbbec !important;
      background: linear-gradient(180deg,#f2f7ff,#dce9ff) !important;
      color: #153d82 !important;
      font-family: inherit !important;
      font-weight: 750 !important;
      box-shadow: inset 0 1px #fff,0 1px 2px #183b6614 !important;
      cursor: pointer !important;
    }
    html body .cc388-presets button:hover,
    html body .cc388-presets button:focus-visible {
      color: #fff !important;
      background: linear-gradient(135deg,#295ad5,#6545c5) !important;
      outline: 2px solid #c0d4ff !important;
      outline-offset: 1px !important;
    }
    html body .cc803-review-note {
      background: var(--cc902-note-bg) !important;
      border: var(--cc902-note-border) !important;
      color: var(--cc902-body-ink) !important;
      border-radius: 7px !important;
      padding: 5px 7px !important;
      font-weight: 600 !important;
    }
    @media (prefers-reduced-motion: reduce) {
      html body .cc901-contact { transition: none !important; }
    }
  `;
  (document.head || document.documentElement).appendChild(sheet);
})();

/* CC126: full-width process choices and Undo for the original popup engines. */
(function () {
  'use strict';
  if (window.__CC126_POPUP_UNDO__) return;
  const prefix = 'html' + '#cc787-workspace'.repeat(12) + ' body ';
  const css = document.createElement('style');
  css.id = 'cc126-process-and-undo';
  css.textContent = `
    ${prefix}[data-field="process"]{grid-column:1/-1!important;flex:1 1 100%!important;box-sizing:border-box!important;width:100%!important;max-width:none!important;min-width:0!important}
    ${prefix}.cc124-process{box-sizing:border-box!important;grid-column:1/-1!important;flex:1 1 100%!important;width:100%!important;max-width:none!important;min-width:0!important;align-self:stretch!important;padding:9px 11px!important;border:1px solid #cbdbe7!important;border-radius:11px!important;background:linear-gradient(120deg,#fff,#f5fbff)!important;box-shadow:0 2px 8px #2b557609!important}
    ${prefix}.cc124-process-heading{display:flex!important;align-items:center!important;justify-content:space-between!important;margin:0 0 5px!important;gap:9px!important}
    ${prefix}.cc124-process-row{display:grid!important;grid-template-columns:78px minmax(0,1fr)!important;align-items:start!important;gap:7px!important;width:100%!important;max-width:none!important;min-width:0!important;margin:4px 0!important}
    ${prefix}.cc124-process-row>b{padding-top:7px!important;font-size:11px!important;line-height:1.3!important;color:#516882!important}
    ${prefix}.cc124-process-row>div{display:flex!important;flex-wrap:wrap!important;gap:5px!important;overflow:visible!important;width:100%!important;min-width:0!important;max-width:none!important;padding:1px 0!important}
    ${prefix}.cc124-process-row button{--cc126-a:#0866cb;--cc126-b:#4487e3;--cc126-edge:#0758ac;box-sizing:border-box!important;flex:0 1 auto!important;max-width:min(100%,270px)!important;min-height:27px!important;padding:5px 10px!important;white-space:normal!important;overflow:visible!important;overflow-wrap:anywhere!important;text-overflow:clip!important;border:1px solid #cbd7e5!important;border-radius:8px!important;background:linear-gradient(#fff,#f2f6fb)!important;color:#29435f!important;-webkit-text-fill-color:#29435f!important;box-shadow:inset 0 1px #fff,0 1px 3px #284a6710!important;font:600 12px/1.25 'Segoe UI',Arial,sans-serif!important;transition:background .12s ease,box-shadow .12s ease,transform .12s ease!important}
    ${prefix}.cc124-process-row button:nth-child(6n+2){--cc126-a:#0b7856;--cc126-b:#1b9f78;--cc126-edge:#076446}
    ${prefix}.cc124-process-row button:nth-child(6n+3){--cc126-a:#6f3cbd;--cc126-b:#9260db;--cc126-edge:#5e2f9e}
    ${prefix}.cc124-process-row button:nth-child(6n+4){--cc126-a:#b65309;--cc126-b:#d77b16;--cc126-edge:#984507}
    ${prefix}.cc124-process-row button:nth-child(6n+5){--cc126-a:#ac315e;--cc126-b:#cf537c;--cc126-edge:#94244e}
    ${prefix}.cc124-process-row button:nth-child(6n+6){--cc126-a:#067383;--cc126-b:#2195a0;--cc126-edge:#055c6a}
    ${prefix}.cc124-process-row button[aria-pressed=true]{background:linear-gradient(125deg,var(--cc126-a),var(--cc126-b))!important;border-color:var(--cc126-edge)!important;color:#fff!important;-webkit-text-fill-color:#fff!important;text-shadow:0 1px 1px #14243c28!important;box-shadow:inset 0 1px #ffffff4d,0 2px 5px #284a6729!important}
    ${prefix}.cc124-process-row button:focus-visible{outline:2px solid #618ecb!important;outline-offset:2px!important}
    @media(max-width:600px){${prefix}.cc124-process-row{grid-template-columns:64px minmax(0,1fr)!important}}
    @media(prefers-reduced-motion:reduce){${prefix}.cc124-process-row button{transition:none!important}}
  `;
  const processColours=[["#0866cb","#4487e3","#0758ac"],["#0b7856","#1b9f78","#076446"],["#6f3cbd","#9260db","#5e2f9e"],["#b65309","#d77b16","#984507"],["#ac315e","#cf537c","#94244e"],["#067383","#2195a0","#055c6a"],["#901d71","#ae2489","#7b1961"],["#386615","#49831b","#2d5010"],["#1d2f90","#2438ae","#19287b"],["#902e1d","#ae3724","#7b2719"],["#166a3a","#1c874b","#11552f"],["#711d90","#8824ae","#60197b"],["#5c5d13","#797b19","#47480f"],["#1c6687","#227ca5","#175672"],["#901d4b","#ae245a","#7b1940"],["#1f6a16","#27871c","#185511"],["#331d90","#3d24ae","#2b197b"],["#8c521d","#a96323","#774518"],["#156653","#1b836b","#105042"],["#901d89","#ae24a5","#7b1975"],["#466114","#5b7f1a","#374c10"],["#1d4690","#2455ae","#193c7b"],["#901d25","#ae242c","#7b191f"],["#166a29","#1c8734","#115521"],["#591d90","#6b24ae","#4c197b"],["#6a5a16","#87731c","#554811"],["#17656e","#1d808c","#125259"],["#901d63","#ae2477","#7b1954"],["#2e6615","#3c831b","#245010"],["#1d2090","#2426ae","#191b7b"],["#903c1d","#ae4924","#7b3419"],["#156642","#1b8356","#105034"],["#7f1d90","#9924ae","#6d197b"],["#525d13","#6c7b19","#40480f"],["#1d5e90","#2471ae","#19507b"],["#901d3c","#ae2449","#7b1934"],["#166a17","#1c871e","#115513"],["#411d90","#4f24ae","#38197b"],["#7f571a","#9d6b20","#6a4916"],["#15665d","#1b8378","#10504a"],["#901d7a","#ae2494","#7b1968"],["#3f6615","#51831b","#325010"],["#1d3890","#2443ae","#192f7b"],["#90251d","#ae2c24","#7b1f19"],["#166a34","#1c8742","#115529"],["#681d90","#7d24ae","#58197b"],["#615d14","#7f791a","#4c4910"],["#1a687f","#20809d","#16566a"]];
  css.textContent+=processColours.map((colours,index)=>`${prefix}.cc124-process-row button:nth-child(${index+1}){--cc126-a:${colours[0]};--cc126-b:${colours[1]};--cc126-edge:${colours[2]}}`).join('');
  (document.head || document.documentElement).appendChild(css);

  let entries = [], context = '', host, button, busy = false, used = false;
  function principal() {
    try {
      const user = JSON.parse(localStorage.getItem('careerCroxCachedUser') || '{}');
      if (!user.user_id || /^\/(?:login|data-backup)(?:\/|$)/.test(location.pathname)) return '';
      return String(user.user_id) + ':' + (window.__CC875_DASHBOARD_KEY__?.() || 'overview');
    } catch (_) { return ''; }
  }
  function reset() { entries = []; used = false; context = principal(); render(); }
  function maintain() {
    const reel = document.getElementById('cc124-popup-reel');
    if (reel) {
      reel.shadowRoot?.querySelector('[aria-label="Minimize popup history"]')?.click();
      reel.style.setProperty('display', 'none', 'important');
    }
    if (context !== principal()) { entries = []; used = false; context = principal(); }
    render();
  }
  function render() {
    if (!host || !button) return;
    const parent=document.querySelector('dialog[open]')||document.body;if(parent&&host.parentNode!==parent)parent.append(host);
    host.hidden = !context;
    button.disabled = busy || !entries.length;
    button.textContent = busy ? 'Restoring…' : '↶ Undo' + (entries.length ? ' · '+entries.length : '');
    button.title = entries.length ? 'Show the last popup you opened: ' + entries.at(-1).title : 'No opened popup to restore';
    button.setAttribute('aria-label', 'Undo last opened popup');
  }
  async function undo() {
    if (busy) return;
    if (context !== principal()) { reset(); return; }
    busy = true; render();
    try {
      while (entries.length) {
        const entry = entries.pop();
        if (entry.context !== principal()) continue;
        try {
          if (await entry.restore() !== false) {
            window.dispatchEvent(new CustomEvent('cc128-companion-event',{detail:{kind:'pull',text:'Here it is! Brought it back.',speak:false,immediate:true,source:'undo'}}));
            break;
          }
        } catch (_) {
          entries.push(entry);
          break;
        }
      }
    } finally { busy = false; render(); }
  }
  window.__CC126_POPUP_UNDO__ = {
    push(entry) {
      if (!entry || typeof entry.restore !== 'function') return;
      const active = principal();
      if (!active) return;
      if (context !== active) { entries = []; context = active; }
      entries.push({ title: String(entry.title || 'CRM reminder').slice(0, 160), restore: entry.restore, context: active });
      entries = entries.slice(-40); used = true; render();
    }
  };
  function start() {
    if (!document.body || host) return;
    host = document.createElement('div'); host.id = 'cc126-popup-undo'; host.hidden = true;
    host.style.cssText = 'position:fixed;left:12px;bottom:10px;z-index:2147482500;';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host([hidden]){display:none!important}button{font:600 12px/1.3 "Segoe UI",Arial,sans-serif;min-height:31px;padding:7px 15px;border:1px solid #a6bbce;border-radius:9px;color:#264969;background:linear-gradient(#fff,#eaf3fc);box-shadow:0 2px 9px #17395e24;cursor:pointer}button:hover:not(:disabled){background:linear-gradient(#f6fbff,#dcecff)}button:focus-visible{outline:2px solid #6797d2;outline-offset:2px}button:disabled{opacity:.52;cursor:default}';
    button = document.createElement('button'); button.type = 'button'; button.onclick = undo;
    shadow.append(style, button); document.body.append(host);
    new MutationObserver(maintain).observe(document.body, { childList: true });
    setInterval(()=>{if(!document.hidden)maintain();},3000);
    maintain();
  }
  window.addEventListener('cc875-dashboard-changed', reset);
  window.addEventListener('career-crox-access-changed', reset);
  window.addEventListener('cc-route-change', maintain);
  window.addEventListener('popstate', maintain);
  window.addEventListener('career-crox-isolated-surface', maintain);
  window.addEventListener('storage', event => {
    if (event.key === 'careerCroxCachedUser' || event.key?.startsWith('cc875:dashboard:')) maintain();
  });
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
})();

(()=>{const s=document.createElement('style');s.id='cc129-polished-controls';s.textContent="\nhtml#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc129-sr{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important}\nhtml#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body :is(.cc871-add-pipeline,.candidate-detail-full-panel .cc129-upload,.cc844-extract-trigger){position:relative!important;display:inline-grid!important;place-items:center!important;flex:none!important;width:35px!important;min-width:35px!important;max-width:35px!important;height:35px!important;min-height:35px!important;padding:8px!important;border-radius:11px!important;border:1px solid #ffffffa8!important;color:#fff!important;-webkit-text-fill-color:#fff!important;background:linear-gradient(140deg,#6549f5,#b52de8)!important;box-shadow:inset 0 1px #ffffff75,0 3px 9px #6f32bd32!important;transition:transform .2s,box-shadow .2s!important}\nhtml#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .candidate-detail-full-panel .cc129-upload{background:linear-gradient(140deg,#087ce3,#13c4c7)!important}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc844-extract-trigger{background:linear-gradient(140deg,#f08209,#f33376)!important}\nhtml#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body :is(.cc871-add-pipeline,.cc129-upload,.cc844-extract-trigger) svg{width:21px!important;height:21px!important;fill:none!important;stroke:white!important;stroke-width:1.7!important;stroke-linecap:round;stroke-linejoin:round;display:block!important}\nhtml#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body :is(.cc871-add-pipeline,.cc129-upload,.cc844-extract-trigger):hover{transform:translateY(-2px) rotate(-4deg)!important;box-shadow:0 6px 14px #6745c840!important}\nhtml#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc129-template-row{display:flex!important;align-items:center!important;gap:3px!important;border-radius:9px!important}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc129-template-row[data-drop=true]{outline:2px solid #8060f7!important;background:#eee8ff!important}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc129-template-row>[role=option]{flex:1!important;display:flex!important;align-items:center!important;gap:7px!important;min-width:0!important}\nhtml#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc129-drag-handle{width:25px!important;min-width:25px!important;padding:4px!important;border:0!important;background:transparent!important;color:#6f62ac!important;-webkit-text-fill-color:#6f62ac!important;cursor:grab!important;font-size:21px!important}\nhtml#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc129-sequence{display:grid!important;place-items:center;flex:none!important;width:21px!important;height:21px!important;border-radius:7px!important;background:#eae7ff!important;color:#4d32a3!important;-webkit-text-fill-color:#4d32a3!important;font:700 11px 'Segoe UI',sans-serif!important}\nhtml#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc124-allocation-badge{background:linear-gradient(120deg,#0876e0,#344bdf)!important;color:#fff!important;-webkit-text-fill-color:#fff!important;border:1px solid #75aaff!important;box-shadow:inset 0 1px #ffffff88,0 3px 9px #1558c83b!important;animation:cc129-gleam 4s ease-in-out infinite!important;padding:7px 11px!important;border-radius:10px!important}\nhtml#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc124-allocation-badge.is-amber{background:linear-gradient(120deg,#a54804,#dc7307)!important;border-color:#ffc459!important}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc124-allocation-badge.is-red{background:linear-gradient(120deg,#b31645,#ec3766)!important;border-color:#ff92ad!important}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc124-allocation-badge.is-locked{background:linear-gradient(120deg,#5135c6,#9046e9)!important;border-color:#bdaaef!important}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc124-allocation-badge.is-expired{background:linear-gradient(120deg,#52647a,#334256)!important}\nhtml#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc124-allocation-badge *{color:#fff!important;-webkit-text-fill-color:#fff!important;opacity:1!important;text-shadow:0 1px 1px #17283930!important;font-weight:700!important}\nhtml#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc560-quicknav{border:1px solid #d8d6f0!important;background:linear-gradient(100deg,#f6f2ff,#eefbff)!important;padding:7px!important;border-radius:13px!important}\nhtml#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc560-jump-btn{--a:#0866d9;--b:#4c65ee;background:linear-gradient(130deg,var(--a),var(--b))!important;color:#fff!important;-webkit-text-fill-color:#fff!important;border:1px solid #ffffffad!important;border-radius:10px!important;padding:8px 10px!important;min-height:35px!important;font-weight:750!important;box-shadow:inset 0 1px #ffffff8c,0 3px 8px #35559c26!important;animation:cc129-nav-float 5.2s ease-in-out infinite!important;animation-delay:calc(var(--n,0)*-.43s)!important}\nhtml#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc560-jump-btn *{color:#fff!important;-webkit-text-fill-color:#fff!important;opacity:1!important;text-shadow:0 1px 1px #1d315332!important}\nhtml#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc560-jump-btn:nth-child(2){--a:#006c82;--b:#008fa2;--n:1}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc560-jump-btn:nth-child(3){--a:#6930c4;--b:#9c3ce4;--n:2}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc560-jump-btn:nth-child(4){--a:#a94807;--b:#d77608;--n:3}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc560-jump-btn:nth-child(5){--a:#b02e62;--b:#d84c71;--n:4}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc560-jump-btn:nth-child(6){--a:#bd3341;--b:#e6555b;--n:5}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc560-jump-btn:nth-child(7){--a:#067251;--b:#0b9c70;--n:6}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc560-jump-btn:nth-child(8){--a:#6134c9;--b:#a03acf;--n:7}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc560-jump-btn:nth-child(9){--a:#23752b;--b:#419b23;--n:8}\nhtml#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc124-lock-dialog{background:linear-gradient(135deg,#fff,#f6f3ff 68%,#edf8ff)!important;border:1px solid #c6c3ea!important;border-radius:20px!important;box-shadow:0 24px 70px #2631643b,inset 0 1px #fff!important;font:13px/1.55 'Segoe UI',sans-serif!important;padding:18px!important;animation:cc129-dock-in .24s cubic-bezier(.16,.8,.25,1)!important}\nhtml#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc124-lock-dialog::backdrop{background:#1a244e24!important;backdrop-filter:none!important}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc124-lock-dialog header{padding:0 0 10px!important;border-bottom:1px solid #dcd8ef!important}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc124-lock-dialog header strong{font-size:15px!important;color:#372361!important;-webkit-text-fill-color:#372361!important}\nhtml#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc124-lock-dialog footer button:last-child{background:linear-gradient(130deg,#5540c9,#9639d8)!important;border-color:#7d47c7!important;color:#fff!important;-webkit-text-fill-color:#fff!important}\nhtml#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc124-lock-dialog textarea,html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc124-lock-dialog input{background:white!important;border:1px solid #c8c4e3!important;border-radius:10px!important;color:#25334f!important;font:13px/1.45 'Segoe UI',sans-serif!important}\nhtml#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc124-lock-list{width:min(1240px,96vw)!important;max-width:96vw!important;min-height:330px!important;padding:18px!important;max-height:90dvh!important;border-radius:18px!important}\nhtml#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc129-table-wrap{overflow:auto!important;max-height:65dvh!important;margin-top:12px!important;border:1px solid #d4def0!important;border-radius:12px!important}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc129-profile-table{width:100%!important;border-collapse:collapse!important;min-width:780px!important;background:white!important;color:#253b60!important}\nhtml#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc129-profile-table th{background:#edf0ff!important;color:#3e3d79!important;text-align:left!important;font-size:12px!important;font-weight:750!important;position:sticky!important;top:0!important;padding:12px!important;white-space:nowrap!important}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc129-profile-table td{border-bottom:1px solid #e1e7f1!important;padding:10px 12px!important;font:13px/1.5 'Segoe UI',sans-serif!important;vertical-align:top!important}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc129-profile-table small{display:block!important;color:#5d6e89!important;font-size:11px!important}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc129-profile-table tbody tr:hover td{background:#f5f9ff!important}\nhtml#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body #cc929-lost .cc129-profile-table{min-width:1130px!important}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body #cc929-lost .cc129-note-cell{min-width:230px!important;max-width:300px!important}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body #cc929-lost .cc129-note-cell p{max-height:90px!important;overflow:auto!important;white-space:pre-wrap!important}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body #cc929-lost .cc129-stage{display:inline-block;font-size:10px;border-radius:6px;padding:2px 6px;color:#4b5283;background:#edf0ff;margin-top:5px}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body #cc929-lost .cc129-stage.missed{color:#ac344f;background:#ffe9ee}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body #cc929-lost .cc129-stage.upcoming{color:#087659;background:#ddf6ee}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body #cc929-lost .cc123-lost-request{min-width:180px!important}\n@keyframes cc129-nav-float{0%,15%,45%,100%{translate:0 0}29%{translate:0 -2px}35%{translate:0 0}40%{translate:0 -1px}}@keyframes cc129-gleam{0%,100%{filter:brightness(1)}50%{filter:brightness(1.12)}}@keyframes cc129-dock-in{from{opacity:0;transform:translateY(-8px) scale(.965)}to{opacity:1;transform:none}}\n@media(prefers-reduced-motion:reduce){html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc560-jump-btn,html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc124-allocation-badge,html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc124-lock-dialog{animation:none!important}}\n";document.head.append(s);})();

// CC130: every quick-navigation action remains visible at normal zoom.
(()=>{const s=document.createElement("style");s.id="cc130-quicknav-fit";s.textContent="html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc560-quicknav{height:auto!important;min-height:44px!important;flex-wrap:wrap!important;gap:8px!important}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc560-quicknav-scroll{display:flex!important;flex:1 1 720px!important;min-width:0!important;max-width:100%!important;height:auto!important;flex-wrap:wrap!important;overflow:visible!important;gap:6px!important;padding:3px 2px!important}html#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace#cc787-workspace body .cc560-jump-btn{flex:1 1 auto!important;min-width:0!important;max-width:none!important;font-size:11px!important;padding:8px 7px!important;white-space:nowrap!important}";document.head.append(s);})();
