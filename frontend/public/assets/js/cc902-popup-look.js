/* CC902: compact, high-contrast popup appearance. No requests or timers. */
(function () {
  'use strict';
  const id = 'cc902-popup-look';
  if (document.getElementById(id)) return;
  const sheet = document.createElement('style');
  sheet.id = id;
  sheet.textContent = `
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
