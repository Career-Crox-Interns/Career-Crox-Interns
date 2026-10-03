(function(){
  'use strict';
  if (window.__CC26_474_RUNTIME_SAFE__) return;
  window.__CC26_474_RUNTIME_SAFE__ = true;

  var TRACK_KEY = 'cc456_session_activity_state';
  var FULL_DAY_MS = 9 * 60 * 60 * 1000;
  var lastState = null;

  function readState(){
    try { return JSON.parse(localStorage.getItem(TRACK_KEY) || '{}') || {}; }
    catch (_) { return {}; }
  }
  function stateNow(extra){
    var x = Object.assign({}, lastState || {}, readState(), extra || {});
    lastState = x;
    return x;
  }
  function activeMs(x){ return Math.max(0, Number(x.active_elapsed_ms != null ? x.active_elapsed_ms : x.active_ms) || 0); }
  function idleMs(x){ return Math.max(0, Number(x.idle_ms || 0) || 0); }
  function breakMs(x){ return Math.max(0, Number(x.break_ms || 0) || 0); }
  function remainingMs(x){ return Math.max(0, FULL_DAY_MS - activeMs(x)); }
  function minsLabel(ms, roundUp){
    var raw = Math.max(0, Number(ms || 0) || 0) / 60000;
    var mins = roundUp ? Math.ceil(raw) : Math.floor(raw);
    return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
  }
  function hms(ms){
    var sec = Math.max(0, Math.floor((Number(ms || 0) || 0) / 1000));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
  }

  function injectStyle(){
    if (document.getElementById('cc26-474-runtime-style')) return;
    var style = document.createElement('style');
    style.id = 'cc26-474-runtime-style';
    style.textContent = `
      .topbar-right .cc379-work-timer-pill,
      .topbar-right .cc376-work-timer-pill,
      .topbar-right .cc378-work-timer-pill,
      .topbar-right .cc399-session-work-pill,
      .topbar-right .cc408-work-timer-pill,
      .topbar-right .cc445-work-timer-pill,
      .topbar-right .cc455-work-timer-pill,
      .topbar-right .cc456-work-pill{display:none!important;visibility:hidden!important;pointer-events:none!important;width:0!important;min-width:0!important;max-width:0!important;padding:0!important;margin:0!important;border:0!important;overflow:hidden!important}
      .topbar-right .cc456-work-timer-pill{display:flex!important;visibility:visible!important;pointer-events:auto!important}
      body.cc464-attendance .attendance-card-grid:first-of-type .attendance-metric-card:nth-child(1){background:linear-gradient(135deg,#3157f4,#6c47d9 58%,#a83ba9)!important}
      body.cc464-attendance .attendance-card-grid:first-of-type .attendance-metric-card:nth-child(2){background:linear-gradient(135deg,#ff5c45,#ff7b39 55%,#ffb13b)!important}
      body.cc464-attendance .attendance-card-grid:first-of-type .attendance-metric-card:nth-child(3){background:linear-gradient(135deg,#3d73f1,#37aaf2 55%,#42c9ea)!important}
      body.cc464-attendance .attendance-card-grid:first-of-type .attendance-metric-card:nth-child(4){background:linear-gradient(135deg,#159f67,#42c958 56%,#a8d938)!important}
      body.cc464-attendance .attendance-card-grid:first-of-type .attendance-metric-card:nth-child(5){background:linear-gradient(135deg,#ff4a7d,#ef4d79 55%,#ff8b70)!important}
      body.cc464-attendance .attendance-card-grid:first-of-type .attendance-metric-card,
      body.cc464-attendance .attendance-card-grid:first-of-type .attendance-metric-card *{color:#fff!important;-webkit-text-fill-color:#fff!important}
      body.cc464-attendance .attendance-progress-bar{height:10px!important;border-radius:999px!important;background:linear-gradient(90deg,#fee2e2,#fef3c7 50%,#dcfce7)!important;overflow:hidden!important}
      body.cc464-attendance .attendance-progress-bar>span{height:100%!important;border-radius:999px!important;background:linear-gradient(90deg,#ef4444,#f59e0b 55%,#22c55e)!important;transition:width .45s ease!important}
    `;
    document.head.appendChild(style);
  }

  function routeClasses(){
    var p = location.pathname || '';
    document.body.classList.toggle('cc474-chat', /\/chat(?:\/|$)/.test(p));
    document.body.classList.toggle('cc464-attendance', /\/attendance(?:\/|$)/.test(p));
  }

  function canonicalTimer(extra){
    // CC26_640: CC456 writes the active clock. Only run compatibility
    // fallback when the canonical runtime is genuinely absent.
    if(window.__CC456_SESSION_ATTENDANCE__)return;
    var live = document.querySelectorAll('.topbar-right .cc456-work-timer-pill');
    for (var i = 1; i < live.length; i += 1) { try { live[i].remove(); } catch (_) {} }
    var pill = live[0];
    if (!pill) return;
    var state = stateNow(extra), active = activeMs(state), pct = Math.max(0, Math.min(100, active / FULL_DAY_MS * 100));
    var val = pill.querySelector('.cc456-value');
    var sub = pill.querySelector('.cc456-sub');
    var fill = pill.querySelector('.cc456-progress span');
    if (val) val.textContent = hms(active);
    if (sub) sub.textContent = state.on_break ? 'Break • active timer paused' : state.locked ? 'CRM locked • active timer paused' : state.idle ? 'Idle • active timer paused' : Math.round(pct) + '% of 9h active';
    if (fill) { fill.style.width = pct.toFixed(2) + '%'; fill.style.background = 'hsl(' + Math.round(120 * pct / 100) + ' 82% 45%)'; }
    pill.title = 'Working Time = real active work only. Break, idle and lock are excluded.';
  }

  function attendance(extra){
    if (!document.body.classList.contains('cc464-attendance')) return;
    var state = stateNow(extra), active = activeMs(state), idle = idleMs(state), brk = breakMs(state), remaining = remainingMs(state);
    var grid = document.querySelector('.attendance-card-grid');
    if (!grid) return;
    var cards = grid.querySelectorAll('.attendance-metric-card');
    if (cards[0]) {
      var v0 = cards[0].querySelector('strong'), h0 = cards[0].querySelector('small');
      if (v0) v0.textContent = minsLabel(remaining, true);
      if (h0) h0.textContent = '9h active target • ' + minsLabel(active, false) + ' active completed';
    }
    if (cards[1]) {
      var v1 = cards[1].querySelector('strong'), h1 = cards[1].querySelector('small');
      if (v1) v1.textContent = minsLabel(active, false);
      if (h1) h1.textContent = 'Real active work • break + idle excluded';
    }
    if (cards[2]) {
      var v2 = cards[2].querySelector('strong'), h2 = cards[2].querySelector('small');
      if (v2) v2.textContent = minsLabel(idle, false);
      if (h2) h2.textContent = 'No meaningful CRM work after grace';
    }
    if (cards[3]) {
      var v3 = cards[3].querySelector('strong'), h3 = cards[3].querySelector('small');
      if (v3) v3.textContent = minsLabel(brk, false);
      if (h3) h3.textContent = 'Actual break time taken';
    }
    if (cards[4]) {
      var h4 = cards[4].querySelector('small');
      if (h4) h4.textContent = 'Connected incoming + outgoing • same call metrics everywhere';
    }
    var progress = document.querySelector('.attendance-progress-bar > span');
    if (progress) progress.style.width = Math.max(0, Math.min(100, active / FULL_DAY_MS * 100)).toFixed(2) + '%';
  }

  function tick(extra){ injectStyle(); routeClasses(); canonicalTimer(extra); attendance(extra); }
  window.addEventListener('career-crox-work-session-tick', function(e){ tick(e && e.detail || {}); });
  window.addEventListener('career-crox-react-ready', function(){ setTimeout(tick, 0); setTimeout(tick, 120); }, { once:true });
  window.addEventListener('popstate', function(){ setTimeout(tick, 0); });
  window.addEventListener('cc-route-change', function(){ setTimeout(tick, 0); });
  document.addEventListener('visibilitychange', function(){ if (!document.hidden) tick(); });

  if (!window.__CC26_474_HISTORY_HOOK__) {
    window.__CC26_474_HISTORY_HOOK__ = true;
    ['pushState','replaceState'].forEach(function(k){
      var old = history[k];
      if (typeof old !== 'function') return;
      history[k] = function(){
        var r = old.apply(this, arguments);
        try { window.dispatchEvent(new Event('cc-route-change')); } catch (_) {}
        return r;
      };
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ tick(); }, { once:true });
  else tick();
})();


/* CC26_582: standalone native emoji picker. It lives OUTSIDE React-owned DOM.
   This deliberately intercepts the legacy CC469 plus toggle; legacy short reaction
   strip is not used. No network, images, fonts, polling or backend requests. */
(function () {
  'use strict';
  if (window.__cc582PickerReady) return;
  window.__cc582PickerReady = true;

  const KEY = 'cc582_chat_recent_emoji';
  const CATEGORY_DATA = [
    { id: 'recent', label: 'Recent', icon: '🕘', items: '🧿 😂 🥰 🎉 🥳 🎊 😇 😘 😔 😍 😌 🙂 🤣 🥲 😎 😄 👏 🙏 🔥 ✅' },
    { id: 'smileys', label: 'Smileys & People', icon: '😊', items: '😀 😃 😄 😁 😆 😅 😂 🤣 🥲 🥹 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 🙂‍↔️ 😏 😒 🙂‍↕️ 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😮‍💨 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫣 🤭 🫢 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🫠 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 👹 👺 🤡 💩 👻 💀 ☠️ 👽 🤖 🎃 😺 😸 😹 😻 😼 😽 🙀 😿 😾 👋 🤚 🖐️ ✋ 🖖 🫱 🫲 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 🫵 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🦿 🦵 🦶 👂 👃 👀 👁️ 👅 👄 👶 🧒 👦 👧 🧑 👨 👩 🧔 👱 👴 👵 🧓 👮 👷 💂 🕵️ 👩‍⚕️ 👨‍⚕️ 👩‍💻 👨‍💻 👩‍🏫 👨‍🏫 👩‍🚀 👨‍🚀' },
    { id: 'animals', label: 'Animals & Nature', icon: '🐻', items: '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐻‍❄️ 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐒 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🪱 🐛 🦋 🐌 🐞 🐜 🦟 🕷️ 🦂 🐢 🐍 🦎 🦖 🦕 🐙 🦑 🦀 🦞 🦐 🐠 🐟 🐡 🦈 🐬 🐳 🐋 🦭 🐊 🐅 🐆 🦓 🦍 🦧 🦣 🐘 🦛 🦏 🐪 🐫 🦒 🦘 🦬 🐃 🐂 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🐩 🦮 🐈 🦃 🦚 🦜 🦢 🦩 🕊️ 🐇 🦝 🦨 🦡 🦫 🦦 🦥 🐁 🐀 🐿️ 🦔 🌵 🎄 🌲 🌳 🌴 🌱 🌿 ☘️ 🍀 🎍 🎋 🍃 🍂 🍁 🍄 🌾 💐 🌷 🌹 🥀 🌺 🌸 🌼 🌻 🌞 🌝 🌛 🌜 🌚 🌕 🌙 ⭐ 🌟 ✨ ⚡ ☄️ 💥 🔥 🌈 ☀️ ⛅ 🌤️ 🌦️ 🌧️ ⛈️ ❄️ ☃️ ⛄ 💧 💦 🌊' },
    { id: 'food', label: 'Food & Drink', icon: '🍔', items: '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶️ 🫑 🌽 🥕 🫒 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🥙 🧆 🌮 🌯 🫔 🥗 🥘 🫕 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍙 🍚 🍘 🍥 🥠 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🥛 🍼 ☕ 🍵 🧃 🥤 🧋 🫖 🧊 🥢 🍽️ 🍴 🥄' },
    { id: 'travel', label: 'Travel & Places', icon: '🚗', items: '🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🛵 🏍️ 🛺 🚲 🛴 🚏 🛣️ 🛤️ 🚦 🚥 🚧 ⚓ ⛵ 🚤 🛳️ 🚢 ✈️ 🛫 🛬 🚀 🛸 🚁 🚡 🚠 🚟 🚠 🚆 🚄 🚅 🚇 🚈 🚉 🚊 🚝 🚞 🚋 🚃 🏙️ 🌆 🌇 🌃 🌉 🌌 🎆 🎇 🌄 🌅 🏞️ 🏝️ 🏖️ 🏜️ 🌋 ⛰️ 🏔️ 🗻 🏕️ ⛺ 🛖 🏠 🏡 🏢 🏣 🏤 🏥 🏦 🏨 🏪 🏫 🏬 🏭 🏯 🏰 🗼 🗽 ⛪ 🕌 🛕 🕍 🕋 ⛲ 🌁 🌍 🌎 🌏 🌐' },
    { id: 'objects', label: 'Objects', icon: '💡', items: '⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 📷 📸 📹 🎥 📞 ☎️ 📟 📺 📻 🎙️ 🎤 🎧 🎵 🎶 🎹 🥁 🎸 🎻 🎺 🎷 🎮 🕹️ 🎲 ♟️ 🎯 🎳 🎨 🖌️ 🧩 🧸 🎁 🎈 🎀 🎊 🎉 ✉️ 📩 📨 📧 💌 📦 📋 📌 📍 📎 🖇️ 📏 📐 ✂️ 🗂️ 📂 📁 📚 📖 📝 ✏️ 🖊️ 🖋️ 🖍️ 🔍 🔎 🔒 🔓 🔑 🗝️ 🔨 🪛 🔧 🛠️ ⚙️ ⚖️ 💡 🔦 🕯️ 🧯 🛒 🛍️ 🏆 🥇 🥈 🥉 🏅 🎖️ 💎 💍 💰 💴 💵 💶 💷 💸 💳 🧾' },
    { id: 'symbols', label: 'Symbols', icon: '❤️', items: '❤️ 🧡 💛 💚 💙 🩵 💜 🤎 🖤 🩶 🤍 🩷 💔 ❤️‍🔥 ❤️‍🩹 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉️ ☸️ ✡️ ☯️ ⚛️ 🪯 ☦️ 🛐 ⛎ ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ 🆔 ⚠️ 🚸 ⛔ 🚫 ❌ ⭕ 💢 ♨️ 📛 🔞 ❗ ❕ ❓ ❔ ‼️ ⁉️ 💯 ✅ ☑️ ✔️ ❎ ➕ ➖ ➗ ✖️ ♾️ ™️ ©️ ®️ 〽️ 🔰 ⚜️ 🔱 🔆 🔅 🌟 ⭐ 🔥 ⚡ 💤 🎵 💬 💭 🗯️ 🔔 🔕 🔊 🔉 🔈 🔇' },
    { id: 'flags', label: 'Flags', icon: '🏳️', items: '🏁 🚩 🎌 🏳️ 🏴 🏳️‍🌈 🏳️‍⚧️ 🇮🇳 🇺🇸 🇬🇧 🇦🇺 🇨🇦 🇩🇪 🇫🇷 🇯🇵 🇰🇷 🇨🇳 🇧🇷 🇮🇹 🇪🇸 🇸🇬 🇦🇪 🇿🇦 🇳🇿 🇳🇵 🇧🇩 🇱🇰 🇵🇰 🇧🇹 🇲🇻 🇹🇭 🇲🇾 🇮🇩 🇵🇭 🇻🇳 🇷🇺 🇺🇦 🇪🇺' }
  ];
  const SEARCH_WORDS = {
    '😂':'laugh tears joy funny','🤣':'rofl laughing rolling','🥰':'love smiling hearts','😍':'heart eyes love','😘':'kiss','🥳':'party celebration birthday','🎉':'party popper celebration','🎊':'confetti','🔥':'fire lit','✅':'check done approved','👍':'thumbs up like yes','🙏':'pray thanks please','😎':'cool sunglasses','😊':'smile happy','🥹':'happy tears touched','😢':'sad cry','😭':'crying sad','🥲':'smile tear','🥺':'pleading face','😡':'angry','😇':'angel innocent','⭐':'star','✨':'sparkles','🚀':'rocket launch','💯':'hundred perfect','❤️':'red heart love','🩵':'blue heart love','💚':'green heart','💙':'blue heart','💕':'hearts love','🫶':'heart hands','👏':'clapping applause','☕':'coffee tea','🍕':'pizza','🍔':'burger','🧿':'evil eye nazar','📞':'call phone','📱':'mobile phone','🎂':'birthday cake','🇮🇳':'india flag','🎯':'target bullseye','👀':'eyes seen','🤝':'handshake agreement','💪':'strong muscle','🫡':'salute respect','🤔':'thinking','🤗':'hug','👌':'okay ok','💻':'laptop computer','🌈':'rainbow','🌹':'rose flower','🌸':'flower blossom'
  };
  let overlay = null, search = null, results = null, category = 'recent', focusInput = null, trigger = null;
  let lastRecent = null;
  let recent = readRecent();
  function isChat(){ return /^\/chat(?:\/|$)/.test(location.pathname || ''); }
  function readRecent(){try{const rows=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(rows)&&rows.length?rows.slice(0,24):(lastRecent||CATEGORY_DATA[0].items.split(' '));}catch(_){return lastRecent||CATEGORY_DATA[0].items.split(' ');}}
  function recordRecent(emoji){recent=[emoji,...recent.filter(x=>x!==emoji)].slice(0,24);lastRecent=recent;try{localStorage.setItem(KEY,JSON.stringify(recent));}catch(_){} }
  function itemsFor(id){return (id==='recent'?recent:CATEGORY_DATA.find(x=>x.id===id)?.items.split(' ')||[]).filter(Boolean);}
  function createEl(tag,cls,txt){const el=document.createElement(tag);if(cls)el.className=cls;if(txt!==undefined)el.textContent=txt;return el;}
  function ensureStyles(){if(document.getElementById('cc582-emoji-style'))return;const s=createEl('style');s.id='cc582-emoji-style';s.textContent=`
body.cc469-chat .composer .emojiBar,body.cc474-chat .composer .emojiBar,body.cc469-chat .composer.cc469-emoji-open .emojiBar,body.cc474-chat .composer.emojiOpen .emojiBar{display:none!important}
#cc582-picker{position:fixed!important;z-index:2147483600!important;width:min(470px,calc(100vw - 18px))!important;height:min(500px,calc(100dvh - 90px))!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;background:#fff!important;border:1px solid #d6dfe9!important;border-radius:26px!important;box-shadow:0 30px 80px rgba(20,43,84,.28),0 8px 22px rgba(36,65,104,.12),inset 0 1px 0 rgba(255,255,255,.96)!important;font-family:'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji','Segoe UI',sans-serif!important;color:#27394e!important;text-align:left!important;pointer-events:auto!important;isolation:isolate!important}
#cc582-picker *{box-sizing:border-box!important}
#cc582-picker .cc582-tabs{height:58px!important;min-height:58px!important;display:flex!important;align-items:center!important;justify-content:space-around!important;gap:7px!important;border-bottom:1px solid #edf0f5!important;padding:7px 9px!important;background:linear-gradient(135deg,#fff,#f5f9ff)!important}
#cc582-picker button.cc582-tab{min-width:40px!important;flex:1!important;max-width:50px!important;height:42px!important;padding:0!important;display:flex!important;align-items:center!important;justify-content:center!important;border:1px solid rgba(210,221,240,.9)!important;border-radius:14px!important;background:linear-gradient(135deg,#fff,#f0f5ff)!important;color:#52627d!important;font-size:21px!important;box-shadow:0 8px 16px rgba(38,64,112,.09),inset 0 1px 0 #fff!important;line-height:1!important;cursor:pointer!important;opacity:1!important}
#cc582-picker button.cc582-tab.is-active{color:#203f84!important;border-color:#bcd2ff!important;background:linear-gradient(135deg,#eaf2ff,#eee8ff)!important;box-shadow:0 10px 20px rgba(68,91,190,.16),inset 0 1px 0 #fff!important;transform:translateY(-1px)!important}
#cc582-picker button.cc582-tab:hover{background:linear-gradient(135deg,#edf5ff,#f5efff)!important;transform:translateY(-1px)!important}
#cc582-picker .cc582-searchwrap{position:relative!important;flex:none!important;padding:10px 11px 6px!important;background:#fff!important}
#cc582-picker .cc582-magnify{position:absolute!important;left:26px!important;top:19px!important;color:#778396!important;font-size:19px!important;pointer-events:none!important;font-family:'Segoe UI Symbol','Segoe UI',sans-serif!important}
#cc582-picker input.cc582-search{width:100%!important;height:46px!important;border:1px solid #b8cbe4!important;border-radius:28px!important;background:#fff!important;color:#243950!important;-webkit-text-fill-color:#243950!important;padding:0 14px 0 42px!important;font:500 14px 'Segoe UI',Arial,sans-serif!important;outline:none!important;box-shadow:none!important;letter-spacing:0!important}
#cc582-picker input.cc582-search:focus{border-color:#628ce9!important;box-shadow:0 0 0 3px rgba(93,137,226,.12)!important}
#cc582-picker input.cc582-search::placeholder{color:#66788d!important;opacity:1!important}
#cc582-picker .cc582-scroll{flex:1 1 auto!important;min-height:0!important;overflow-y:auto!important;overflow-x:hidden!important;scrollbar-width:thin!important;scrollbar-color:#c2cad8 #fff!important;padding:2px 11px 12px!important;background:#fff!important}
#cc582-picker .cc582-title{font:600 13px 'Segoe UI',Arial,sans-serif!important;color:#495667!important;margin:10px 2px 8px!important;letter-spacing:0!important}
#cc582-picker .cc582-grid{display:grid!important;grid-template-columns:repeat(10,minmax(0,1fr))!important;gap:7px!important;justify-items:stretch!important}
#cc582-picker button.cc582-item{border:1px solid transparent!important;background:transparent!important;border-radius:13px!important;width:100%!important;min-width:0!important;height:40px!important;padding:0!important;display:flex!important;align-items:center!important;justify-content:center!important;font-family:'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif!important;font-size:27px!important;font-weight:400!important;line-height:1!important;box-shadow:0 5px 12px rgba(42,67,111,.06),inset 0 1px 0 rgba(255,255,255,.8)!important;cursor:pointer!important;opacity:1!important;transform:none!important;color:initial!important;-webkit-text-fill-color:initial!important}
#cc582-picker button.cc582-item:hover,#cc582-picker button.cc582-item:focus-visible{background:linear-gradient(135deg,#edf5ff,#f7efff)!important;border-color:#bfd4ff!important;box-shadow:0 10px 20px rgba(75,113,188,.16)!important;transform:translateY(-1px) scale(1.06)!important;outline:none!important}
#cc582-picker .cc582-empty{padding:28px 10px!important;color:#536680!important;font:500 13px 'Segoe UI',Arial,sans-serif!important}
body.cc469-chat .cc469-emoji-toggle.cc582-trigger,body.cc474-chat .emojiToggle.cc582-trigger{color:#284c99!important;-webkit-text-fill-color:#284c99!important;background:linear-gradient(135deg,#ffffff,#dfeeff 55%,#eee6ff)!important;font-size:21px!important;border:1px solid #c8d9f5!important;border-radius:14px!important;box-shadow:0 10px 22px rgba(52,81,139,.16),inset 0 1px 0 #fff!important}
@media(max-width:550px){#cc582-picker{width:min(440px,calc(100vw - 14px))!important}#cc582-picker .cc582-grid{grid-template-columns:repeat(8,minmax(0,1fr))!important}#cc582-picker button.cc582-item{height:39px!important}}
@media(prefers-reduced-motion:reduce){#cc582-picker *{transition:none!important;animation:none!important}}
`;document.head.appendChild(s);}
  function position(){if(!overlay||!trigger)return;const r=trigger.getBoundingClientRect();const w=Math.min(470,innerWidth-18),h=Math.min(500,innerHeight-90);overlay.style.left=Math.max(7,Math.min(r.left-8,innerWidth-w-7))+'px';overlay.style.top=Math.max(8,Math.min(r.top-h-10,innerHeight-h-8))+'px';}
  function makeButton(emoji){const btn=createEl('button','cc582-item',emoji);btn.type='button';btn.setAttribute('aria-label',SEARCH_WORDS[emoji]?.split(' ').slice(0,3).join(' ')||emoji);btn.title=SEARCH_WORDS[emoji]||emoji;btn.addEventListener('click',()=>selectEmoji(emoji));return btn;}
  function appendSection(label,arr){if(!arr.length)return;const h=createEl('div','cc582-title',label);const grid=createEl('div','cc582-grid');arr.forEach(e=>grid.appendChild(makeButton(e)));results.append(h,grid);}
  function render(){if(!results||!search)return;results.replaceChildren();let q=search.value.trim().toLowerCase();const match=e=>!q||e.toLowerCase().includes(q)||String(SEARCH_WORDS[e]||'').includes(q);if(q){let found=0;CATEGORY_DATA.slice(1).forEach(cat=>{const arr=itemsFor(cat.id).filter(match);if(arr.length){found+=arr.length;appendSection(cat.label,arr);}});if(!found)results.appendChild(createEl('div','cc582-empty','No matching emoji found.'));}else if(category==='recent'){appendSection('Recent',recent);appendSection('Smileys & People',itemsFor('smileys'));}else{const cat=CATEGORY_DATA.find(c=>c.id===category);appendSection(cat?.label||'Emoji',itemsFor(category));} }
  function ensureOverlay(){if(overlay)return;ensureStyles();overlay=createEl('section');overlay.id='cc582-picker';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label','Emoji picker');const tabs=createEl('div','cc582-tabs');CATEGORY_DATA.forEach(cat=>{const b=createEl('button','cc582-tab',cat.icon);b.type='button';b.title=cat.label;b.setAttribute('aria-label',cat.label);b.dataset.cat=cat.id;b.addEventListener('click',()=>{category=cat.id;search.value='';tabs.querySelectorAll('button').forEach(x=>x.classList.toggle('is-active',x===b));render();});tabs.appendChild(b);});tabs.querySelector('button').classList.add('is-active');const sw=createEl('div','cc582-searchwrap');sw.appendChild(createEl('span','cc582-magnify','⌕'));search=createEl('input','cc582-search');search.type='search';search.placeholder='Search emoji';search.setAttribute('aria-label','Search emoji');search.addEventListener('input',render);sw.appendChild(search);results=createEl('div','cc582-scroll');overlay.append(tabs,sw,results);}
  function activeTextarea(btn){return btn?.closest('.composer')?.querySelector('.composeBox textarea')||document.querySelector('.chatMain .composer textarea');}
  function selectEmoji(emoji){const ta=focusInput?.isConnected?focusInput:activeTextarea(trigger);if(!ta){close();return;}const old=ta.value||'';const start=typeof ta.selectionStart==='number'?ta.selectionStart:old.length;const end=typeof ta.selectionEnd==='number'?ta.selectionEnd:old.length;const next=old.slice(0,start)+emoji+old.slice(end);const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set;if(setter)setter.call(ta,next);else ta.value=next;try{ta.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:emoji}));}catch(_){ta.dispatchEvent(new Event('input',{bubbles:true}));}try{ta.focus({preventScroll:true});const pos=start+emoji.length;ta.setSelectionRange(pos,pos);}catch(_){}recordRecent(emoji);close();}
  function close(){if(overlay?.parentNode)overlay.remove();if(trigger)trigger.setAttribute('aria-expanded','false');overlay=null;search=null;results=null;focusInput=null;trigger=null;}
  function open(btn){if(!isChat())return;const wasOpen=!!overlay;if(wasOpen){close();return;}trigger=btn;focusInput=activeTextarea(btn);category='recent';recent=readRecent();btn.setAttribute('aria-expanded','true');ensureOverlay();document.body.appendChild(overlay);position();render();try{search.focus({preventScroll:true});}catch(_){} }
  document.addEventListener('click',function(event){const target=event.target instanceof Element?event.target:null;if(!target)return;const btn=target.closest('.cc469-emoji-toggle,.emojiToggle');if(btn&&isChat()&&btn.closest('.composer')){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();btn.classList.add('cc582-trigger');open(btn);return;}if(overlay&&!overlay.contains(target)){close();} },true);
  document.addEventListener('keydown',function(event){if(event.key==='Escape'&&overlay){close();event.preventDefault();}},true);
  window.addEventListener('resize',()=>{if(overlay)position();},{passive:true});
  window.addEventListener('popstate',()=>{if(!isChat())close();});
  window.addEventListener('scroll',()=>{if(overlay)position();},true);
})();
