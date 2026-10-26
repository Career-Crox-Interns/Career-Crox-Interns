import {useSliceState,CrmSortSelect,sortCrmRows,parseDateInput,formatCrmDate} from '../lib/workspaceHelpers';
const cc911RevenueCss=String.raw`/* CC864: Revenue editor follows the active CRM palette. Keep every override
   inside this dialog; legacy theme rules use repeated root IDs. */
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay {
  --cc864-primary: var(--brand-primary, #ed8b38);
  --cc864-secondary: var(--brand-secondary, #a74753);
  --cc864-line: color-mix(in srgb, var(--cc864-primary) 24%, #e9dfd8);
  --cc864-ink: #332a32;
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100dvh !important;
  min-height: 0 !important;
  box-sizing: border-box !important;
  margin: 0 !important;
  padding: 20px !important;
  transform: none !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  overflow: hidden !important;
  background: #271a2a69 !important;
  backdrop-filter: blur(8px);
  z-index: 100050 !important;
}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay *, :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay *::before, :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay *::after { box-sizing: border-box; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-revenue-editor {
  width: min(1160px, 97vw) !important;
  height: min(710px, 92dvh) !important;
  max-width: 100% !important;
  max-height: 100% !important;
  min-height: 0 !important;
  display: flex !important;
  flex-direction: column !important;
  gap: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  border: 1px solid #ffffffd9 !important;
  border-radius: 22px !important;
  background: #fffaf5 !important;
  color: var(--cc864-ink) !important;
  box-shadow: 0 24px 85px #21132d57, inset 0 1px 0 #fff !important;
}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-revenue-editor > header {
  flex: none !important;
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 14px !important;
  min-height: 70px !important;
  padding: 12px 20px !important;
  border-bottom: 1px solid var(--cc864-line) !important;
  background: linear-gradient(115deg, color-mix(in srgb, var(--cc864-primary) 25%, #fff), #fff5e9 58%, color-mix(in srgb, var(--cc864-secondary) 15%, #fff)) !important;
}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-editor-heading { display: flex !important; align-items: center !important; gap: 11px !important; min-width: 0; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-heading-icon { display: grid; place-items: center; width: 39px; height: 39px; flex: none; border: 1px solid #ffffffc9; border-radius: 13px; background: #ffffffa1; color: #7c4435 !important; font-size: 24px !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-editor-heading small { font-size: 10px !important; font-weight: 750 !important; letter-spacing: 1.3px !important; line-height: 1.3 !important; color: #805044 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-editor-heading h2 { margin: 3px 0 0 !important; font-size: 20px !important; line-height: 1.25 !important; font-weight: 800 !important; color: #352832 !important; overflow-wrap: anywhere; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay button, :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay a { text-shadow: none !important; letter-spacing: 0 !important; text-transform: none !important; cursor: pointer; transition: box-shadow .15s ease, background .15s ease !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay button { display: inline-flex !important; align-items: center !important; justify-content: center !important; gap: 7px !important; width: auto !important; min-width: 0 !important; max-width: 100% !important; min-height: 38px !important; height: auto !important; margin: 0 !important; padding: 9px 14px !important; border: 1px solid var(--cc864-line) !important; border-radius: 11px !important; font: inherit !important; font-size: 13px !important; font-weight: 700 !important; line-height: 1.25 !important; color: var(--cc864-ink) !important; -webkit-text-fill-color: currentColor !important; background: #fff8f0 !important; box-shadow: 0 2px 4px #68452709 !important; transform: none !important; white-space: normal !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay button:hover:not(:disabled), :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay a:hover:not([aria-disabled=true]) { box-shadow: 0 3px 10px #68452722 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay button:focus-visible, :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay a:focus-visible, :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay [role=button]:focus-visible { outline: 3px solid color-mix(in srgb, var(--cc864-secondary) 70%, #784438) !important; outline-offset: 2px !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay button:disabled, :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay a[aria-disabled=true] { opacity: .5 !important; cursor: not-allowed !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-editor-close { width: 34px !important; min-height: 34px !important; height: 34px !important; padding: 0 !important; flex: none; background: #ffffffbd !important; color: #69483f !important; font-size: 23px !important; border-color: #ffffffdd !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-editor-tabs { flex: none !important; display: flex !important; flex-wrap: wrap !important; gap: 8px !important; padding: 9px 18px !important; background: #fff7ef !important; border-bottom: 1px solid var(--cc864-line) !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-editor-tabs button { min-height: 36px !important; padding: 8px 13px !important; border-radius: 10px !important; background: #ffffffb8 !important; color: #69504a !important; box-shadow: none !important; font-size: 13px !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-editor-tabs button[aria-pressed=true] { background: linear-gradient(115deg, color-mix(in srgb, var(--cc864-primary) 38%, #fff), color-mix(in srgb, var(--cc864-secondary) 21%, #fff)) !important; border-color: color-mix(in srgb, var(--cc864-secondary) 35%, #e4b795) !important; color: #512e2a !important; box-shadow: inset 0 1px 0 #ffffffa8, 0 2px 5px #7b443611 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-editor-body { flex: 1 !important; min-height: 0 !important; display: grid !important; grid-template-columns: 268px minmax(0, 1fr) !important; gap: 0 !important; padding: 0 !important; overflow: hidden !important; background: linear-gradient(125deg, #fff8ee, #fff6f3 58%, #f9f7ee) !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-editor-sidebar { min-width: 0; min-height: 0; padding: 16px !important; overflow: auto !important; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: #d7bfa9 transparent; background: linear-gradient(160deg, color-mix(in srgb, var(--cc864-primary) 12%, #fff), #fff9ed 60%, #edf6ee) !important; border-right: 1px solid var(--cc864-line) !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-editor-main { min-width: 0; min-height: 0; padding: 18px !important; overflow: auto !important; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: #d7bfa9 transparent; background: transparent !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay [hidden] { display: none !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .field { display: flex !important; flex-direction: column !important; gap: 6px !important; min-width: 0 !important; margin: 0 !important; padding: 10px !important; border: 1px solid color-mix(in srgb, var(--cc864-primary) 17%, #e9e0d8) !important; border-radius: 12px !important; background: #ffffffc2 !important; color: #5d4843 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .field > span, :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .field > label { display: block; font-size: 12px !important; line-height: 1.35 !important; font-weight: 650 !important; color: #695047 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay input, :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay select, :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay textarea { width: 100% !important; min-width: 0 !important; max-width: 100% !important; min-height: 40px !important; height: auto !important; padding: 9px 10px !important; border: 1px solid #dccfc5 !important; border-radius: 8px !important; background: #fffefc !important; color: #382e35 !important; -webkit-text-fill-color: #382e35 !important; font-size: 14px !important; line-height: 1.35 !important; font-weight: 500 !important; box-shadow: inset 0 1px 2px #76543c04 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay input::placeholder, :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay textarea::placeholder { color: #94817b !important; -webkit-text-fill-color: #94817b !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay input:focus, :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay select:focus, :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay textarea:focus { outline: 2px solid color-mix(in srgb, var(--cc864-primary) 68%, #a05c40) !important; outline-offset: 1px !important; background: #fff !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay textarea { min-height: 84px !important; resize: vertical; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc814-form-grid { display: grid !important; grid-template-columns: repeat(3, minmax(0, 1fr)) !important; gap: 11px !important; margin: 0 0 12px !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc814-form-grid .field:nth-child(3n+2) { background: color-mix(in srgb, var(--cc864-primary) 6%, #fff) !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc814-form-grid .field:nth-child(3n) { background: color-mix(in srgb, var(--cc864-secondary) 5%, #fff) !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc86-interview-weekday { font-size: 10px !important; color: #856355 !important; line-height: 1.25; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay [data-revenue-field="interview_datetime"] { grid-column: span 2 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .field > .cc839-time-input { display: grid !important; grid-template-columns: minmax(125px, 1.6fr) minmax(48px, .7fr) minmax(48px, .7fr) minmax(60px, .9fr) !important; align-items: center !important; gap: 6px !important; padding: 0 !important; margin: 0 !important; border: 0 !important; background: transparent !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc839-time-input > input[type=date], :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc839-time-input > select { width: 100% !important; min-width: 0 !important; max-width: none !important; min-height: 40px !important; padding: 8px 7px !important; font-size: 12px !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc839-time-input > small { display: none !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc855-message-preview { font-weight: 450 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc855-message-preview strong { font-weight: 750 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc854-candidate-first { margin-bottom: 12px !important; background: #ffffffd9 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc854-candidate-selected { font-size: 11px !important; line-height: 1.4; color: #276247 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc814-search-result { width: 100% !important; display: flex !important; flex-direction: column !important; gap: 4px !important; align-items: flex-start !important; text-align: left !important; font-size: 12px !important; background: #fff3df !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc814-search-result span { font-size: 11px !important; overflow-wrap: anywhere; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc851-dual-resume { display: grid !important; grid-template-columns: 1fr !important; gap: 11px !important; margin: 0 0 13px !important; padding: 0 !important; background: transparent !important; border: 0 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc854-file-tile { position: relative !important; padding: 12px !important; gap: 9px !important; border: 1px solid #e9c5a7 !important; background: linear-gradient(135deg, #ffecd7, #fff9ec) !important; border-radius: 13px !important; cursor: pointer; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc854-file-tile:nth-child(2) { border-color: color-mix(in srgb, var(--cc864-secondary) 25%, #e6c8c4) !important; background: linear-gradient(135deg, #fff0e9, color-mix(in srgb, var(--cc864-secondary) 10%, #fff)) !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc854-file-tile > span:first-child { font-size: 12px !important; font-weight: 650 !important; color: #694636 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc854-file-action { display: inline-flex !important; align-items: center !important; justify-content: center !important; align-self: flex-start !important; width: auto !important; min-height: 32px !important; padding: 7px 10px !important; border: 1px solid #d9ad85 !important; border-radius: 8px !important; background: linear-gradient(120deg, #ffe0bd, #ffedce) !important; color: #6a3925 !important; -webkit-text-fill-color: #6a3925 !important; font-size: 12px !important; font-weight: 750 !important; box-shadow: inset 0 1px 0 #ffffffc7 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc854-file-tile:nth-child(2) .cc854-file-action { border-color: #d8b4b3 !important; background: linear-gradient(120deg, #f6d3cb, #ffe6db) !important; color: #713c43 !important; -webkit-text-fill-color: #713c43 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc854-file-tile input[type=file] { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; min-height: 0 !important; opacity: 0 !important; cursor: pointer; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc854-file-tile:focus-within { outline: 2px solid #b26b43 !important; outline-offset: 2px; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc854-file-name { font-size: 11px !important; font-weight: 650 !important; overflow-wrap: anywhere; color: #615345 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc854-file-attached { border-color: #8cc2a3 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc851-contact-actions { display: grid !important; grid-template-columns: 1fr !important; gap: 8px !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc851-contact-actions a { display: flex !important; align-items: center !important; justify-content: center !important; width: 100% !important; min-height: 38px !important; border: 1px solid #b1d6bd !important; border-radius: 10px !important; padding: 9px !important; font-size: 12px !important; font-weight: 700 !important; line-height: 1.35 !important; text-decoration: none !important; background: linear-gradient(120deg, #d8efdb, #eaf6e6) !important; color: #2b6446 !important; -webkit-text-fill-color: #2b6446 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc851-contact-actions .cc851-call { border-color: #e3c3a3 !important; background: linear-gradient(120deg, #ffe9cc, #fff1df) !important; color: #78512e !important; -webkit-text-fill-color: #78512e !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc814-share-box { margin: 0 !important; padding: 0 !important; border: 0 !important; border-radius: 0 !important; background: transparent !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-section-heading { display: flex; align-items: center; gap: 10px; margin: 0 0 15px; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-section-icon { display: grid; place-items: center; flex: none; width: 38px; height: 38px; border-radius: 12px; background: #f4ddbc; color: #7a4f36 !important; font-size: 21px !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-section-heading h3 { margin: 0 0 4px !important; font-size: 17px !important; line-height: 1.3 !important; color: #48322d !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-section-heading p, :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-field-help { margin: 0 !important; font-size: 12px !important; line-height: 1.45 !important; color: #887064 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-settings-card { padding: 13px !important; border: 1px solid var(--cc864-line) !important; border-radius: 14px !important; background: #fffdf9d9 !important; margin: 0 0 13px !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-settings-card > .field { border: 0 !important; padding: 0 !important; margin-bottom: 11px !important; background: transparent !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-settings-card > .field:last-child { margin-bottom: 0 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-destination-grid { display: grid; grid-template-columns: 175px minmax(0, 1fr); gap: 10px; margin-bottom: 11px; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-destination-grid .field { padding: 0 !important; border: 0 !important; background: transparent !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-message-card textarea { min-height: 220px !important; font-size: 13px !important; line-height: 1.65 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-message-fields { display: flex; flex-wrap: wrap; gap: 5px; margin: 8px 0; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-message-fields button { min-height: 26px !important; padding: 4px 7px !important; font-size: 10px !important; border-radius: 6px !important; background: #f9ebdf !important; box-shadow: none !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-text-action { min-height: 30px !important; margin-top: 6px !important; padding: 5px 0 !important; border: 0 !important; background: transparent !important; color: #88503e !important; box-shadow: none !important; font-size: 12px !important; text-decoration: underline; text-underline-offset: 3px; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-settings-actions, :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-inform-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-settings-save, :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-save { background: linear-gradient(115deg, color-mix(in srgb, var(--cc864-primary) 48%, #fff), color-mix(in srgb, var(--cc864-secondary) 24%, #fff)) !important; border-color: color-mix(in srgb, var(--cc864-secondary) 40%, #dab491) !important; color: #4e2b28 !important; -webkit-text-fill-color: #4e2b28 !important; box-shadow: inset 0 1px 0 #ffffffb8, 0 3px 7px #8e553b16 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-secondary { background: #fffaf3 !important; color: #745342 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-settings-feedback { padding: 11px 13px; border: 1px solid #bfceb1; border-radius: 10px; color: #4b5c35 !important; background: #f4f5df !important; font-size: 13px !important; line-height: 1.5 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-destination-summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; margin-bottom: 10px; background: #edf4e6; border: 1px solid #cad7b8; border-radius: 12px; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-destination-summary > div { min-width: 0; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-destination-summary small { display: block; margin-bottom: 4px; font-size: 10px !important; font-weight: 750 !important; letter-spacing: .7px; color: #66764e !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-destination-summary strong { display: block; color: #395639 !important; font-size: 14px !important; line-height: 1.4; overflow-wrap: anywhere; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-destination-summary span { display: block; margin-top: 3px; font-size: 11px !important; color: #74806a !important; overflow-wrap: anywhere; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc831-owner-strip { display: flex; flex-wrap: wrap; gap: 10px; margin: 10px 0; color: #866956 !important; font-size: 12px !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc855-message-preview { display: block !important; max-height: 245px !important; padding: 15px 17px !important; overflow: auto !important; white-space: pre-wrap !important; overflow-wrap: anywhere !important; margin: 10px 0 !important; border: 1px solid #e6c8ae !important; border-radius: 13px !important; background: linear-gradient(125deg, #fff8e9, #fff0e5) !important; color: #493c35 !important; font-family: inherit !important; font-size: 13px !important; line-height: 1.7 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-open-whatsapp, :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc853-share-primary { background: linear-gradient(115deg, #d4efd9, #bfe1cb) !important; border-color: #a3cdb1 !important; color: #235a3e !important; -webkit-text-fill-color: #235a3e !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc853-share-panel { padding: 14px !important; margin: 15px 0 0 !important; border: 1px solid #d6d7ba !important; border-radius: 14px !important; background: linear-gradient(130deg, #f0f5e4, #fff5e3) !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc853-share-heading { color: #4b5b38 !important; margin: 0 0 10px !important; font-size: 13px !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc853-share-file-list { display: grid; gap: 8px; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc853-attached-file { display: flex !important; align-items: center !important; gap: 9px !important; min-width: 0; padding: 10px !important; border: 1px solid #e0ddc5 !important; border-radius: 10px !important; background: #ffffffb8 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc853-attached-file > div { flex: 1; min-width: 0; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc853-attached-file b { display: block; color: #524c3b !important; font-size: 12px !important; overflow-wrap: anywhere; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc853-attached-file small { display: block; margin-top: 4px; font-size: 11px !important; color: #8b826d !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc853-file-ready, :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc853-file-waiting { flex: none; font-size: 10px !important; color: #4c6c42 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc853-file-waiting { color: #9c8262 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc853-share-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 11px; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc851-group-hint { margin: 10px 0 0 !important; padding: 10px !important; border: 1px solid #ddc5a6 !important; border-radius: 10px !important; background: #fff5de !important; color: #805a32 !important; font-size: 12px !important; line-height: 1.5; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-revenue-editor > footer { flex: none !important; display: flex !important; align-items: center !important; justify-content: space-between !important; gap: 12px !important; padding: 12px 18px !important; border-top: 1px solid var(--cc864-line) !important; background: linear-gradient(110deg, #fff4e4, #fffaf4 70%, #f6eee7) !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-footer-actions { display: flex; align-items: center; gap: 9px; min-width: 0; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-footer-actions button { min-height: 42px !important; padding: 10px 16px !important; font-size: 13px !important; font-weight: 750 !important; white-space: nowrap !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-inform { background: linear-gradient(115deg, #dcedd4, #c7e5ce) !important; border-color: #accb9e !important; color: #365a36 !important; -webkit-text-fill-color: #365a36 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-inform[aria-pressed=true] { border-color: #679b67 !important; box-shadow: inset 0 0 0 1px #91b78b, 0 2px 6px #6583581c !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-candidate-chip { padding: 6px 10px; border: 1px solid #e5d8c7; border-radius: 9px; background: #fffdf5; font-size: 11px !important; font-weight: 650; color: #8b7664 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc857-validation-banner { margin: 0 0 12px !important; padding: 11px !important; border: 1px solid #deaf9d !important; border-radius: 10px !important; background: #ffeadf !important; color: #913e30 !important; font-size: 12px !important; line-height: 1.4 !important; }
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc857-field-missing { border-color: #c16b4e !important; box-shadow: 0 0 0 1px #d4a080 !important; }
@media (max-width: 1000px) {
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-editor-body { grid-template-columns: 245px minmax(0, 1fr) !important; }
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc814-form-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
}
@media (max-width: 700px) {
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay { padding: 8px !important; }
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-revenue-editor { width: 100% !important; height: 96dvh !important; border-radius: 17px !important; }
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-revenue-editor > header { min-height: 64px !important; padding: 10px 13px !important; }
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-editor-heading h2 { font-size: 18px !important; }
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-editor-tabs { padding: 8px 11px !important; gap: 6px !important; }
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-editor-tabs button { flex: 1 !important; padding: 8px !important; font-size: 11px !important; }
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-editor-body { display: block !important; overflow: auto !important; overscroll-behavior: contain; }
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-editor-sidebar, :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-editor-main { padding: 13px !important; overflow: visible !important; }
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-editor-sidebar { border-right: 0 !important; border-bottom: 1px solid var(--cc864-line) !important; }
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc851-dual-resume { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc851-contact-actions { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc854-file-action { font-size: 11px !important; padding: 6px 7px !important; }
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-revenue-editor > footer { padding: 10px 11px !important; }
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-footer-actions { width: 100%; gap: 7px; }
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-footer-actions button { flex: 1; min-height: 42px !important; padding: 10px 8px !important; font-size: 11px !important; }
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-candidate-chip { display: none; }
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-destination-grid { grid-template-columns: 1fr; }
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay [data-revenue-field="interview_datetime"] { grid-column: 1 / -1 !important; }
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .field > .cc839-time-input { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; }
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc839-time-input > input[type=date] { grid-column: 1 / -1 !important; }
}
@media (max-width: 380px) {
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc814-form-grid { grid-template-columns: 1fr !important; }
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc851-dual-resume { grid-template-columns: 1fr !important; }
}
@media (prefers-reduced-motion: reduce) {
  :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay *, :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay *::before, :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}

/* CC871: focused interview editor with a local live clock. */
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-revenue-editor{background:#f8fafc!important;color:#233d51!important;border-color:#e0e8ee!important;}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-revenue-editor > header{background:linear-gradient(115deg,#edf6fc,#fff8f1)!important;border-color:#dce6ee!important;}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-editor-tabs{background:#f8fbfd!important;}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-editor-body{background:#f7fafc!important;}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-editor-sidebar{background:linear-gradient(160deg,#edf7fd,#fffaf5)!important;border-color:#dce6ee!important;}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .field{background:#fff!important;border-color:#dce6ee!important;border-radius:13px!important;}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc814-form-grid .field:nth-child(n){background:#fff!important;}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .field > span{color:#597082!important;font-size:11px!important;font-weight:600!important;}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay input, :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay select, :is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay textarea{border-color:#d5e0e9!important;background:#fff!important;color:#233d51!important;-webkit-text-fill-color:#233d51!important;font-weight:500!important;}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-editor-heading h2{color:#183e59!important;font-weight:700!important;}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc861-revenue-editor > footer{background:#f5f9fc!important;border-color:#dce6ee!important;}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc864-footer-actions{flex-wrap:wrap!important;}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc871-add-another{background:#edf5fc!important;color:#285f8b!important;border-color:#bfd8ed!important;}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc871-live-clock{grid-column:span 2;display:grid!important;grid-template-columns:1fr auto!important;}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc871-live-clock > span{grid-column:1/-1;}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc871-live-clock > strong{font-size:17px!important;line-height:1.6!important;color:#244a66!important;font-weight:650!important;}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc871-live-clock small{background:#def4e8;color:#26774b;padding:3px 6px;border-radius:6px;margin-left:7px;font-size:9px;}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc871-live-clock > .cc839-time-input{grid-column:1/-1;}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc871-candidate-email{margin-top:12px!important;}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc871-candidate-email small{font-size:11px!important;overflow-wrap:anywhere;color:#527283!important;}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc871-email-conflict{padding:12px;background:#fff6e8;border:1px solid #edc38c;border-radius:12px;margin-top:10px;font-size:12px;}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc871-email-conflict button{width:100%!important;font-size:11px!important;overflow-wrap:anywhere;margin-top:6px!important;}
:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc871-save-option{background:#edf6ff!important;color:#296a9f!important;font-size:11px!important;}
@media(max-width:700px){:is(html#cc787-workspace, html#cc780-workspace, html) #cc861-revenue-overlay#cc861-revenue-overlay .cc871-live-clock{grid-column:1/-1!important;}}
`;
if(typeof document!=='undefined'&&!document.getElementById('cc911RevenueCss')){const style=document.createElement('style');style.id='cc911RevenueCss';style.textContent=cc911RevenueCss;document.head.appendChild(style);}

import { CrmDateTimeInput } from '../components/PremiumSelect';
import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import Layout from '../components/Layout';
import {api} from '../lib/api';
import {useDashboardAuth as useAuth} from '../lib/auth';
import {openCandidateProfileInNewTab} from '../lib/candidateNav';
import {nativeWhatsAppDocumentShare,shareCapability,fileSizeLabel} from '../lib/revenueWhatsAppShare';
const day=()=>new Date(Date.now()+330*60000).toISOString().slice(0,10),month=()=>day().slice(0,7),money=n=>'₹'+Number(n||0).toLocaleString('en-IN');
const stages=[['will_come_for_interview','Interview','peach'],['appeared_for_interview','Arrived · Feedback','violet'],['selected','Selected','amber'],['pending_joining','Joining due','amber'],['joined','Joined','green'],['not_joined','Backout','rose'],['rejected','Rejected','rose'],['completed_60_days','60 days','teal']];
const label=s=>stages.find(x=>x[0]===s)?.[1]||s;
// CC86: Dates are stored unchanged; show interview weekday without timezone conversions.
const interviewWeekday=(value)=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(value||''));if(!m)return '';const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));if(d.getUTCFullYear()!==+m[1]||d.getUTCMonth()!==+m[2]-1||d.getUTCDate()!==+m[3])return '';return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getUTCDay()];};
const interviewDateCaption=(value)=>{const weekday=interviewWeekday(value);if(!weekday)return '';const date=String(value).slice(0,10).split('-');return `${weekday} · ${date[2]}-${date[1]}-${date[0]}`;};
const REVENUE_OFFICE_CLIENTS=["1Point1", "Globiva", "Vertex Group", "Eureka", "iEnergizer", "Alturist"];
const REVENUE_OFFICE_LOCATIONS=["Noida Sector 62", "Noida Sector 58", "Noida Sector 127", "Gurgaon Sector 18", "Gurgaon Sector 20", "Gurgaon Sector 17", "Thane, Mumbai", "Navi Mumbai", "Panchkula", "Pune", "Jaipur"];
const nowIst=()=>new Date(Date.now()+330*60000).toISOString().slice(0,16);
const initial=()=>({command_id:crypto.randomUUID(),interview_live:true,status:'will_come_for_interview',interview_datetime:nowIst(),interview_mode:'Walkin',communication_skill:'Good',experience_range:'Fresher',salary_range:'₹0',submission_date:day(),payout_status:'payout_pending',payout_amount:'5000',payout_days:'60',payout_duration_days:'60',invoice_lead_days:'1'});

// CC816: Use a visible native dropdown for presets; never overwrite existing custom values.
const cleanOptions=(items=[])=>[...new Map((Array.isArray(items)?items:[]).map(x=>String(x??'').trim()).filter(Boolean).map(x=>[x.toLowerCase(),x])).values()];
const REVENUE_FORM_PRESETS=Object.freeze({
  preferred_location:REVENUE_OFFICE_LOCATIONS,
  qualification:['12th Pass','Non-Graduate','Graduate','B.A','B.Com','B.Sc','BBA','BCA','B.Tech','MBA','MCA','Other'],
  communication_skill:['Average','Normal','Good','Excellent','More Than Excellent'],
  experience_range:['Fresher','0 - 6 Month','7 - 12 Month','1 - 2 Years','2 - 3 Years','3 - 5 Years','5+ Years'],
  salary_range:['₹0','₹1K - ₹15K','₹15K - ₹20K','₹20K - ₹25K','₹25K - ₹30K','₹30K - ₹40K','₹40K+'],
  payout_amount:['2000','4000','5000','6000','7000','10000'],
  payout_days:['5','7','10','15','30','45','60','90'],
  payout_duration_days:['45','60','90'],
});
// CC857: Match the server's required fields before sending a write. This is
// local-only validation: no database read and no extra egress on invalid saves.
const CC857_REQUIRED_FIELDS=Object.freeze([
 ['status','Status'],['client_name','Client'],['process','Process'],
 ['interview_datetime','Interview time'],['interview_mode','Interview mode'],['preferred_location','Client location'],
]);
function cc857ValidateSave(candidate,lead,clientRequired=lead){
 if(!String(candidate?.candidate_id||'').trim())return {key:'candidate_id',message:'Select a CRM candidate first.'};
 for(const [key,name] of CC857_REQUIRED_FIELDS){
  if(key==='client_name'&&!clientRequired)continue;
  if(!String(candidate?.[key]??'').trim())return {key,message:`${name} is required. Please fill it before saving.`};
 }
 if(!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(String(candidate.interview_datetime||'')) || Number.isNaN(Date.parse(candidate.interview_datetime)))return {key:'interview_datetime',message:'Choose a valid interview date and time.'};
 const email=String(candidate.email||'').trim();
 if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return {key:'email',message:'Enter a valid candidate email.'};
 if(lead){
  const amount=String(candidate.payout_amount??'').trim();
  if(amount&&!/^(?:\d+)(?:\.\d{1,2})?$/.test(amount))return {key:'payout_amount',message:'Enter a valid non-negative payout amount (up to two decimal places).'};
  if(![45,60,90].includes(Number(candidate.payout_duration_days||60)))return {key:'payout_duration_days',message:'Choose payout duration: 45, 60 or 90 days.'};
  if(!Number.isInteger(Number(candidate.payout_days))||Number(candidate.payout_days)<1||Number(candidate.payout_days)>365)return {key:'payout_days',message:'Payment days must be between 1 and 365.'};
 }
 return null;
}
// Server remains authoritative (including status transitions and concurrent edits).
function cc857ServerField(message){
 const text=String(message||'').toLowerCase();
 if(/candidate (?:code|id).*required|select.*candidate|candidate not found/.test(text))return 'candidate_id';
 if(/candidate email|invalid.*email/.test(text))return 'email';
 if(/payout duration/.test(text))return 'payout_duration_days';
 if(/payout amount|non-negative.*amount/.test(text))return 'payout_amount';
 if(/payment after joining|payment days/.test(text))return 'payout_days';
 return CC857_REQUIRED_FIELDS.find(([key,name])=>{
  const aliases={client_name:['client'],interview_datetime:['interview date','interview time'],preferred_location:['preferred location','location'],qualification:['qualification','degree'],communication_skill:['communication'],experience_range:['experience'],salary_range:['salary'],interview_mode:['interview mode']};
  return [name.toLowerCase(),...(aliases[key]||[])].some(label=>text.includes(label));
 })?.[0]||'';
}
function PresetChoice({label,value,options,onChange,allowCustom=true,fieldKey='',invalid=false,onCommit,groups}){
 const [customMode,setCustomMode]=useState(false);
 const values=useMemo(()=>cleanOptions(options),[options]);
 const raw=String(value??'').trim();
 const saved=values.find(v=>v.toLowerCase()===raw.toLowerCase());
 const otherValue=Boolean(raw)&&!saved;
 const showOther=allowCustom&&(customMode||otherValue);
 return <label data-revenue-field={fieldKey} className={"field cc816-preset-field "+(invalid?"cc857-field-missing":"")}><span>{label}</span>
   <select aria-label={label} value={showOther?'__cc_custom__':saved||''} onChange={event=>{
     const next=event.target.value;
     if(next==='__cc_custom__'){setCustomMode(true);onChange('');}
     else {setCustomMode(false);onChange(next);}
   }}><option value="">Select {label}</option>{groups?.length?groups.map(group=><optgroup key={group.label} label={group.label} style={{color:group.color}}>{group.items.map(option=><option value={option} key={option} style={{color:group.color}}>{option}</option>)}</optgroup>):values.map(option=><option value={option} key={option}>{option}</option>)}{allowCustom&&<option value="__cc_custom__">+ Add / type another...</option>}</select>
   {showOther&&<input aria-label={'Type '+label} type="text" autoFocus placeholder={'Type '+label} value={raw} onChange={event=>onChange(event.target.value)}/>}
   {showOther&&onCommit&&<button type="button" className="cc871-save-option" disabled={!raw} onClick={()=>onCommit(raw)}>Save process for everyone</button>}
 </label>;
}

// CC88: Revenue analysis is computed entirely from the existing authorised
// Pipeline Hub response. No extra network request is performed on filter clicks.
const CC88_DIMS=Object.freeze([
  ['client_name','Client'],['recruiter_name','Recruiter'],['process','Process'],
  ['location','Location'],['qualification','Qualification'],['communication_skill','Communication'],
  ['experience_range','Experience'],['salary_range','Salary'],['interview_mode','Interview mode']
]);
const CC88_METRICS=Object.freeze([
  ['interviews','Interviews'],['selected','Selections'],['joined','Joinings'],
  ['retained','Completed 60 days'],['revenue','Earned revenue']
]);
const CC88_DATE_FIELDS=Object.freeze([
  ['interview_date','Interview date'],['selection_date','Selection date'],
  ['joined_date','Actual joining date'],['joining_date','Planned joining date'],
  ['submission_date','Submission date']
]);
const cc88Clean=v=>String(v??'').trim();
const cc88Date=v=>/^\d{4}-\d{2}-\d{2}/.test(String(v||''))?String(v).slice(0,10):'';
// CC883: Sort the whole filtered result before pagination. Pipeline timestamps
// use IST through the shared parser; update/create time never substitutes for an interview.
function cc883InterviewValue(row={}) {
 const date=String(row.interview_date||'').trim(),time=String(row.interview_time||'').trim();
 const legacy=/^\d{4}-\d{2}-\d{2}$/.test(date)&&time?date+'T'+time:date;
 return [row.interview_datetime,legacy].find(value=>parseDateInput(value))||'';
}
function cc883SortPipelineRows(items=[],sort='interview_newest') {
 if(!['default','interview_newest','interview_oldest'].includes(sort))return sortCrmRows(items,sort);
 const direction=sort==='interview_oldest'?1:-1;
 return [...items].sort((a,b)=>{
  const x=parseDateInput(cc883InterviewValue(a))?.getTime(),y=parseDateInput(cc883InterviewValue(b))?.getTime();
  if(x==null&&y!=null)return 1;if(y==null&&x!=null)return -1;
  return (x==null?0:(x-y)*direction)||String(a.revenue_id||a.candidate_id||'').localeCompare(String(b.revenue_id||b.candidate_id||''),'en',{numeric:true});
 });
}
function cc883PipelineTone(row={}) {
 const status=String(row.status||'').trim().toLowerCase();
 if(status==='rejected')return 'rejected';
 if(['joined','completed_60_days'].includes(status))return 'joined';
 if(['selected','pending_joining'].includes(status))return 'selected';
 return '';
}
function cc883JoiningDate(row={}) {
 return row.joined_date?{value:row.joined_date,kind:'Actual'}:row.joining_date?{value:row.joining_date,kind:'Planned'}:{value:'',kind:''};
}
function PipelineMilestoneDate({value,kind=''}) {
 const valid=Boolean(parseDateInput(value));
 return <span className="cc883-milestone-date">{valid?<time dateTime={String(value).slice(0,10)}>{formatCrmDate(value)}</time>:'—'}{valid&&kind&&<small>{kind}</small>}</span>;
}
const cc88MonthWindow=(offset=0)=>{const now=day();const d=new Date(`${now.slice(0,7)}-01T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()+offset);const start=d.toISOString().slice(0,10);d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);return {start,end:d.toISOString().slice(0,10)};};
const cc88Metric=(row,metric)=>{
  if(row._cc88_conflict || row.candidate_missing || row.invalid_payout || row.retention_inconsistent)return 0;
  const status=String(row.status||'').toLowerCase();
  const joined=['joined','completed_60_days'].includes(status);
  const selected=['selected','pending_joining','joined','completed_60_days'].includes(status);
  if(metric==='interviews')return cc88Date(row.interview_date||row.interview_datetime)?1:0;
  if(metric==='selected')return selected?1:0;
  if(metric==='joined')return joined?1:0;
  if(metric==='retained')return joined&&Boolean(row.completed_60_days)?1:0;
  if(metric==='revenue')return joined&&row.joined_date?Number(row.recognized_payout||0)||0:0;
  return 0;
};
function cc88Unique(rows){
 const seen=new Map(),conflicted=new Set();let skipped=0;
 const signature=row=>[row.client_name,row.process,row.recruiter_code,row.recruiter_name,row.status,row.payout_status,row.payout_amount,row.joined_date,row.payout_received_at].map(cc88Clean).join('|');
 for(const row of rows||[]){const key=cc88Clean(row.revenue_id)||cc88Clean(row.candidate_id).toUpperCase();if(!key){seen.set('row:'+seen.size,row);continue;}
  if(seen.has(key)){skipped++;if(signature(seen.get(key))!==signature(row))conflicted.add(key);}
  else seen.set(key,row);
 }
 // Always display one row for review. Exclude conflicting candidates from finance calculations,
 // just as the backend's financialRows() does. Never silently hide the candidate.
 return {items:[...seen.entries()].map(([k,v])=>conflicted.has(k)?{...v,_cc88_conflict:true}:v),skipped,conflicts:conflicted.size};
}
function cc88Rank(rows,dimension,metric){const map=new Map();for(const row of rows||[]){const name=cc88Clean(row[dimension]||(dimension==='location'?row.preferred_location:''))||'Not specified';let item=map.get(name);if(!item){item={label:name,count:0,interviews:0,selected:0,joined:0,retained:0,revenue:0,profiles:[]};map.set(name,item);}item.count+=1;item.profiles.push(row);for(const m of ['interviews','selected','joined','retained','revenue'])item[m]+=cc88Metric(row,m);}return [...map.values()].sort((a,b)=>b[metric]-a[metric]||b.count-a.count||a.label.localeCompare(b.label));}
const cc88SelectOptions=(rows,key,lookups=[])=>cleanOptions([...lookups,...(rows||[]).map(r=>r[key]||(key==='location'?r.preferred_location:''))]).sort((a,b)=>a.localeCompare(b));
const cc88DefaultFilters=()=>({process:'',location:'',qualification:'',communication_skill:'',experience_range:'',salary_range:'',interview_mode:''});

const amountHint=value=>{const n=Number(String(value||'0').replace(/,/g,''));return n>=1e7?(n/1e7).toLocaleString('en-IN',{maximumFractionDigits:2})+' crore rupees':n>=1e5?(n/1e5).toLocaleString('en-IN',{maximumFractionDigits:2})+' lakh rupees':n>=1000?(n/1000).toLocaleString('en-IN',{maximumFractionDigits:2})+' thousand rupees':n.toLocaleString('en-IN')+' rupees';};
const commaAmount=v=>{const raw=String(v);if(!raw)return '';const [whole,fraction]=raw.split('.');const formatted=Number(whole||0).toLocaleString('en-IN',{maximumFractionDigits:0});return raw.includes('.')?formatted+'.'+(fraction||''):formatted;};
const base64=async file=>{const bytes=new Uint8Array(await file.arrayBuffer());let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
// WhatsApp uses *one star* for bold. Remove untrusted stars from input fields.
const cc854Bold = value => '*'+String(value??'').trim().replace(/\*/g,'')+'*';
// CC855: WhatsApp Desktop can turn an email into a hyperlink BEFORE parsing *bold*.
// A zero-width WORD JOINER immediately inside the stars keeps the email characters
// unchanged while separating the formatting markers from link auto-detection.
// The receiver's WhatsApp build ultimately controls whether it renders bold.
const cc855EmailBold = value => '*\u2060'+String(value??'').trim().replace(/\*/g,'')+'\u2060*';
const cc854Date = value => {
 const match=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(value||''));
 if(!match)return '';
 const date=new Date(Date.UTC(+match[1],+match[2]-1,+match[3]));
 if(date.getUTCFullYear()!==+match[1]||date.getUTCMonth()!==+match[2]-1||date.getUTCDate()!==+match[3])return '';
 return date.toLocaleString('en-US',{month:'short',timeZone:'UTC'})+' '+(+match[3])+', 2K'+match[1].slice(2);
};
// CC864: Store a reusable template, never a candidate's resolved message.
const CC864_MESSAGE_TEMPLATE = [
 'Hi Team, our candidate has reached.', '',
 'Candidate: {candidate}', 'Phone: {phone}', 'Email: {email}',
 'Process: {process}', 'Interview: {interview_date}',
 'Interview mode: {interview_mode}', 'Recruiter ID: {recruiter_id}',
 '', '*Career Crox*',
].join('\n');
const CC864_MESSAGE_FIELDS=['candidate','phone','email','process','interview_date','interview_mode','recruiter_id'];
const revenueArrivalText = (form,template=CC864_MESSAGE_TEMPLATE) => {
 const fields={candidate:cc854Bold(form.full_name),phone:cc854Bold(form.phone),email:cc855EmailBold(form.email),
  process:String(form.process||'').trim(),interview_date:cc854Bold(cc854Date(form.interview_datetime)),
  interview_mode:cc854Bold(/^(walkin|walk-in|walk in)$/i.test(String(form.interview_mode||''))?'Walk-in':form.interview_mode||'Walk-in'),
  recruiter_id:String(form.recruiter_id||form.recruiter_code||'').trim()};
 return String(template||CC864_MESSAGE_TEMPLATE).replace(/\{(candidate|phone|email|process|interview_date|interview_mode|recruiter_id)\}/g,(_,key)=>fields[key]);
};
// Store ONLY optional destination shortcuts on this browser. Never persist resumes.
const cc854DestKey=identity=>'cc854_whatsapp_destinations_v1_'+encodeURIComponent(String(identity||'guest'));
const cc854ReadDestinations=identity=>{try{const v=JSON.parse(localStorage.getItem(cc854DestKey(identity))||'[]');return Array.isArray(v)?v.filter(x=>['group','number'].includes(x.type)&&typeof x.value==='string').slice(0,20):[];}catch{return [];}};
const cc854ValidDestination=(type,value)=>type==='group'
 ? /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+(?:\?[^\s]*)?$/.test(value)
 : /^(?:\+?91)?[6-9]\d{9}$/.test(value.replace(/[\s-]/g,''));

// Preserve the legacy screen's current link on upgrade. Once a manager saves
// the new group/message settings, recent shortcuts cannot replace that default.
const cc864PreferencesKey=identity=>'cc864_revenue_share_preferences_'+encodeURIComponent(String(identity||'guest'));
function cc864SharePreferences(identity,shared){
 let personal=null;
 try{personal=JSON.parse(localStorage.getItem(cc864PreferencesKey(identity))||'null');}catch{}
 const valid=item=>item&&['group','number'].includes(item.type)&&typeof item.value==='string'&&cc854ValidDestination(item.type,item.value.trim());
 const office=valid(shared)?shared:null,legacy=cc854ReadDestinations(identity).find(valid);
 const preferred=valid(personal)?personal:office?.message_template?office:legacy||office;
 return {type:preferred?.type||'group',value:preferred?.value||'',group_label:preferred?.group_label||'',
  message_template:(valid(personal)?personal.message_template:shared?.message_template)||CC864_MESSAGE_TEMPLATE};
}

const revenuePhone=raw=>{const digits=String(raw||'').replace(/\D/g,'');return digits.length===10?'91'+digits:digits.length===12&&digits.startsWith('91')?digits:'';};
// Keep the resume photograph intact: add branding ABOVE it, never across the candidate's text.
async function brandRevenueImage(file){
 const picture=await createImageBitmap(file);try{
  const width=Math.min(3000,picture.width),height=Math.round(picture.height*width/picture.width),banner=112;
  if(!width||!height||height>10000)throw Error('Image dimensions are not supported.');
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height+banner;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Image editor is unavailable.');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#f8fafc';ctx.fillRect(0,0,width,banner);
  ctx.fillStyle='#0f5079';ctx.fillRect(0,banner-7,width,7);
  ctx.font='bold '+Math.min(45,Math.max(23,width/19))+'px Arial, sans-serif';ctx.fillText('CAREER CROX',24,72);
  ctx.drawImage(picture,0,banner,width,height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.94));if(!blob)throw Error('Could not prepare branded image.');
  return new File([blob],file.name.replace(/\.[^.]+$/,'')+'_CAREER_CROX.jpg',{type:'image/jpeg'});
 }finally{picture.close?.();}
}
const makeDownload=(name,base64Content,mime)=>{
 const raw=atob(base64Content);const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
 const blob=new Blob([bytes],{type:mime||'application/octet-stream'});const url=URL.createObjectURL(blob);
 const link=document.createElement('a');link.href=url;link.download=String(name||'resume').replace(/[\\/]/g,'_');document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
};
function PipelineInterviewClock({value,live,onChange}){
 const [tick,setTick]=useState(Date.now()),[editing,setEditing]=useState(false);
 useEffect(()=>{if(!live)return;const timer=setInterval(()=>setTick(Date.now()),1000);return()=>clearInterval(timer);},[live]);
 const shown=live?new Date(tick):new Date(String(value||'').replace(' ','T')+(/(?:Z|[+-]\d\d:\d\d)$/.test(String(value))?'':'+05:30'));
 return <label className="field cc871-live-clock" data-revenue-field="interview_datetime"><span>Interview time · IST {live&&<small>LIVE</small>}</span><strong>{Number.isFinite(shown.getTime())?new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',second:live?'2-digit':undefined,hour12:true,timeZone:'Asia/Kolkata'}).format(shown):'Choose interview time'}</strong><button type="button" onClick={()=>{if(!editing&&live)onChange(nowIst(),false);setEditing(v=>!v);}}>{editing?'Done':'Change time'}</button>{editing&&<CrmDateTimeInput type="datetime-local" value={value||nowIst()} onChange={event=>onChange(event.target.value,false)}/>}</label>;
}
const cc871City=location=>/noida/i.test(location)?'Noida':/gurgaon|gurugram/i.test(location)?'Gurgaon':/mumbai|turbhe|thane/i.test(location)?'Mumbai':'Other locations';
const cc871Colors={'Gurgaon':'#b85c22','Noida':'#296fb5','Mumbai':'#8356b0','Other locations':'#357868'};
function cc871Groups(options,catalog,clients=false){return Object.entries(cc871Colors).map(([city,color])=>({label:city,color,items:cleanOptions(options).filter(name=>clients?(catalog.find(c=>c.name===name)?.locations||['']).some(location=>cc871City(location)===city):cc871City(name)===city)})).filter(group=>group.items.length);}
function cc871Terms(form,data){
 const name=String(form.client_name||''),loc=String(form.preferred_location||'');
 const rule=[...(data.client_rules||[])].reverse().find(r=>r.client_name===name)||{};
 const ninety=/vertex/i.test(name)||/alturist|altruist/i.test(name)&&!!loc&&!/noida sector 127/i.test(loc);
 const special=/eureka/i.test(name)||/razorpay/i.test(form.process||'')||/1point1/i.test(name)&&/indore/i.test(loc);
 return {payout_amount:String(special?4000:rule.payout_amount??5000),payout_days:String(ninety?90:rule.payout_days??60),payout_duration_days:String(ninety?90:rule.payout_duration_days??60),invoice_lead_days:String(rule.invoice_lead_days??1)};
}

function TargetFlow({flow,manager,busy,onSave,joining=false}){
 const [drafts,setDrafts]=useState({}),[search,setSearch]=useState(''),[collapsed,setCollapsed]=useState({});
 const map=useMemo(()=>new Map((flow?.nodes||[]).map(n=>[n.id,n])),[flow]);
 useEffect(()=>setDrafts(previous=>Object.fromEntries(Object.entries(previous).filter(([id,value])=>map.has(id)&&Number(value)!==Number(map.get(id).amount)))),[flow?.revision,flow?.month]);
 if(!flow?.root_id)return <div className="cc828-empty">Choose a month to see your target flow.</div>;
 const matches=id=>{const n=map.get(id);return n&&(n.name.toLowerCase().includes(search.toLowerCase())||n.children.some(matches));};
 const branch=(id,depth=0)=>{const n=map.get(id);if(!n||search&&!matches(id)&&depth>0)return null;const parent=map.get(n.parent_id),editable=(manager||n.role==='recruiter')&&(!parent||parent.children.length>1),changed=drafts[id]!==undefined&&Number(drafts[id])!==Number(n.amount),folded=collapsed[id]&&!search;
 return <li key={id} className={'cc828-flow-branch '+(depth?'':'root')}><article className={'cc828-flow-node '+n.role} data-target-fixed={n.fixed?'true':'false'}><div className="cc836-target-name"><span className="cc828-flow-role">{n.role==='manager'?'Manager':n.role==='tl'?'Team Lead':'Recruiter'}</span><h3>{n.name}</h3></div><label>{joining?'Joining target':'Revenue target'}<input type="text" inputMode={joining?'numeric':'decimal'} aria-label={'Target for '+n.name} value={commaAmount(drafts[id]??n.amount)} disabled={!editable||busy} onChange={e=>{const value=e.target.value.replace(/,/g,'');if((joining?/^\d*$/:/^\d*(?:\.\d{0,2})?$/).test(value))setDrafts(old=>({...old,[id]:value}));}} onKeyDown={e=>{if(e.key==='Enter'&&changed){e.preventDefault();onSave(id,drafts[id]);}}}/></label><small className="cc831-amount-hint">{joining?`${n.earned||0} joined · ${Math.max(0,Number(drafts[id]??n.amount)-Number(n.earned||0))} remaining`:amountHint(drafts[id]??n.amount)}</small><div className="cc828-flow-progress"><span style={{width:Math.min(100,n.percent||0)+'%'}}/></div><div className="cc828-flow-earned"><span>{joining?Number(n.earned||0)+' joined':money(n.earned)+' earned'}</span><b>{n.percent||0}%</b></div><div className="cc836-target-actions">{editable&&<button type="button" className="cc828-balance-btn" disabled={!changed||busy||drafts[id]===''} onClick={()=>onSave(id,drafts[id])}>{busy?'Saving…':'Save target'}</button>}{n.fixed&&<button type="button" className="cc836-target-unlock" disabled={!editable||busy} onClick={()=>onSave(id,n.amount,true)} title="Allow this target to rebalance">Fixed · Unlock</button>}{!n.fixed&&depth>0&&<span className="cc836-target-auto">Auto balance</span>}{n.children.length>0&&depth>0&&<button type="button" aria-expanded={!folded} className="cc836-target-fold" onClick={()=>setCollapsed(old=>({...old,[id]:!old[id]}))}>{folded?'Show':'Hide'} team · {n.children.length}</button>}</div></article>{n.children?.length>0&&!folded&&<ul className="cc828-flow-children">{n.children.map(child=>branch(child,depth+1))}</ul>}</li>;};
 return <div className="cc836-target-flow"><div className="cc836-target-toolbar"><input type="search" aria-label={joining?'Search joining targets':'Search revenue targets'} placeholder="Find an employee…" value={search} onChange={e=>setSearch(e.target.value)}/><span>Saved targets stay fixed. Auto targets share the remainder.</span></div><div className="cc828-flow-scroll"><ul className="cc828-flow-tree">{branch(flow.root_id)}</ul></div></div>;
}

export default function RevenueHubPage(){
 const [editorTab,setEditorTab]=useState('details');
 const [messageTemplate,setMessageTemplate]=useState(CC864_MESSAGE_TEMPLATE),[shareSettingsFeedback,setShareSettingsFeedback]=useState('');
 const {user}=useAuth(),role=String(user?.role||'').toLowerCase(),lead=['tl','manager','admin'].includes(role),manager=['manager','admin'].includes(role);
 const [data,setData]=useState({items:[],cards:{},summary:{},targets:[],client_rules:[],lookups:{}}),[query,setQuery]=useSliceState("pipeline:query",''),[status,setStatus]=useSliceState("pipeline:status",''),[client,setClient]=useSliceState("pipeline:client",''),[recruiter,setRecruiter]=useSliceState("pipeline:recruiter",''),[reportMonth,setReportMonth]=useSliceState("pipeline:reportMonth",month()),[tab,setTab]=useSliceState("pipeline:tab",'pipeline');
 // Business reads stay scoped to this dashboard. Editor permissions come from
 // the authenticated actor, matching the server's write policy for My dashboard.
 const canChooseClient=Boolean(data.editor?.can_choose_client??lead);
 const editorCatalog=data.editor?.client_catalog||data.lookups?.client_catalog||[];
 const [sortBy,setSortBy]=useSliceState('pipeline:sort','interview_newest');
 const [manualReminders,setManualReminders]=useState(null);
 const [sharing,setSharing]=useState(false),shareInProgressRef=useRef(false);
 const [shareFollowUp,setShareFollowUp]=useState(''); // 'image' only when needed; 'separate' if mixed native share fails.
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[form,setForm]=useState(null),[search,setSearch]=useState(''),[found,setFound]=useState([]),[resume,setResume]=useState(null),[clientImage,setClientImage]=useState(null),[groupLabel,setGroupLabel]=useState(''),[shareHint,setShareHint]=useState(''),[target,setTarget]=useState({}),[rule,setRule]=useState({client_name:'',payout_amount:5000,payout_days:60,payout_duration_days:60,invoice_lead_days:1});
 const [formError,setFormError]=useState(null);
 const [emailConflict,setEmailConflict]=useState(null);
 const directCandidateOpened=useRef(false);
 const [deleteTarget,setDeleteTarget]=useState(null),[deletingRevenue,setDeletingRevenue]=useState(false),[deleteError,setDeleteError]=useState('');
 const deletingRevenueRef=useRef(false);
 // CC859: Keep the confirmation accessible above the entire CRM, including
 // sticky tables and header. Escape closes it without any database request.
 useEffect(()=>{
  if(!deleteTarget)return;
  const closeOnEscape=(event)=>{
   if(event.key==='Escape'&&!deletingRevenueRef.current){
    event.preventDefault();setDeleteTarget(null);setDeleteError('');
   }
  };
  document.addEventListener('keydown',closeOnEscape);
  return ()=>document.removeEventListener('keydown',closeOnEscape);
 },[deleteTarget]);
 const modalBodyRef=useRef(null),savingRevenueRef=useRef(false);
 useEffect(()=>{if(form)setEditorTab('details');},[Boolean(form)]);
 const [destination,setDestination]=useState(''),[destinationType,setDestinationType]=useState('number'),[savedDestinations,setSavedDestinations]=useState(()=>cc854ReadDestinations(user?.user_id||user?.username));
 
const [page,setPage]=useSliceState("pipeline:page",0);
const [advancedFilters,setAdvancedFilters]=useState(false);
const [extraFilters,setExtraFilters]=useSliceState("pipeline:extraFilters",cc88DefaultFilters);
const [dateBasis,setDateBasis]=useSliceState("pipeline:dateBasis",'interview_date');
const [dateStart,setDateStart]=useSliceState("pipeline:dateStart",''),[dateEnd,setDateEnd]=useSliceState("pipeline:dateEnd",'');
const [rankDimension,setRankDimension]=useState(lead?'client_name':'recruiter_name');
const [rankMetric,setRankMetric]=useState('selected');
const [rankFocus,setRankFocus]=useState('');
const lastRevenueLoad=useRef(0),targetMonthRef=useRef(month()),destinationDefaults=useRef(false);
const [datePreset,setDatePreset]=useSliceState("pipeline:datePreset",'all');
 const active=useRef(true),searchSeq=useRef(0),reminderOpened=useRef(false);
 const revenueFiltersMounted=useRef(false);useEffect(()=>{if(!revenueFiltersMounted.current){revenueFiltersMounted.current=true;return;}setPage(0);},[status,client,recruiter,query,extraFilters,dateStart,dateEnd,dateBasis,sortBy]);
 async function load(force=false){try{const result=await api.get('/api/revenue-hub?target_month='+encodeURIComponent(targetMonthRef.current),{cacheTtlMs:force?0:90000,allowStale:!force,timeoutMs:20000,retries:0});if(active.current){setData(result);if(!destinationDefaults.current){destinationDefaults.current=true;const preferred=cc864SharePreferences(user?.user_id||user?.username,result.share_default);setDestination(preferred.value);setDestinationType(preferred.type);setGroupLabel(preferred.group_label);setMessageTemplate(preferred.message_template);}lastRevenueLoad.current=Date.now();}}catch(e){if(active.current)setMessage(e.message);}}
 useEffect(()=>{active.current=true;load();const changed=e=>{if(savingRevenueRef.current && /^\/api\/revenue-hub\/(?:add-candidate|[^/]+\/status)$/.test(e.detail?.path||''))return;if(deletingRevenueRef.current&&e.detail?.method==='DELETE'&&/^\/api\/revenue-hub\/[^/]+(?:\?.*)?$/.test(e.detail?.path||''))return;if(/revenue|flowchart|candidate/.test(e.detail?.path||e.detail?.source||''))load(true);};const onFocus=()=>{if(document.visibilityState==='visible'&&Date.now()-lastRevenueLoad.current>120000)load();};window.addEventListener('career-crox-data-written',changed);window.addEventListener('career-crox-manager-reminder-dirty',changed);window.addEventListener('focus',onFocus);return()=>{active.current=false;window.removeEventListener('career-crox-data-written',changed);window.removeEventListener('career-crox-manager-reminder-dirty',changed);window.removeEventListener('focus',onFocus);};},[]);
 useEffect(()=>{if(!form||form.revenue_id||form.candidate_id)return;const seq=++searchSeq.current,t=setTimeout(()=>{if(search.trim().length<3){setFound([]);return;}api.get('/api/revenue-hub/candidate-search?q='+encodeURIComponent(search),{cacheTtlMs:60000,retries:0}).then(r=>{if(seq===searchSeq.current)setFound(r.items||[]);}).catch(e=>setMessage(e.message));},450);return()=>clearTimeout(t);},[search,!!form]);
 useEffect(()=>{if(reminderOpened.current)return;const params=new URLSearchParams(window.location.search),entry=params.get('entry'),cid=params.get('candidate');const row=(data.items||[]).find(r=>entry?String(r.revenue_id)===entry:String(r.candidate_id)===String(cid));if((entry||cid)&&row){reminderOpened.current=true;edit(row);}},[data.items]);
 useEffect(()=>{const cid=new URLSearchParams(window.location.search).get('add_candidate');if(!cid||directCandidateOpened.current||!data.lookups?.processes)return;directCandidateOpened.current=true;api.get('/api/candidates/'+encodeURIComponent(cid)+'?edit_only=1',{cacheTtlMs:0,allowStale:false,retries:0}).then(result=>{defaultDestination();setForm(initial());choose(result.item);}).catch(error=>setMessage(error.message));},[data.lookups]);
 
const visibleRows=useMemo(()=>cc88Unique(data.items||[]),[data.items]);
const scopedRows=useMemo(()=>visibleRows.items.filter(r=>{
  if(client&&r.client_name!==client)return false;
  if(recruiter&&r.recruiter_name!==recruiter)return false;
  if(query&&!['full_name','phone','candidate_id','process','client_name','location','qualification'].some(key=>String(r[key]||'').toLowerCase().includes(query.toLowerCase())))return false;
  for(const [key,val] of Object.entries(extraFilters))if(val&&cc88Clean(r[key]||(key==='location'?r.preferred_location:''))!==val)return false;
  const date=cc88Date(r[dateBasis]||(dateBasis==='interview_date'?r.interview_datetime:''));
  if((dateStart||dateEnd)&&(!date||(dateStart&&date<dateStart)||(dateEnd&&date>dateEnd)))return false;
  return true;
}),[visibleRows.items,client,recruiter,query,extraFilters,dateBasis,dateStart,dateEnd]);
const effectiveSort=sortBy==='default'?'interview_newest':sortBy;
const rows=useMemo(()=>cc883SortPipelineRows(status?scopedRows.filter(r=>r.status===status):scopedRows,effectiveSort),[scopedRows,status,effectiveSort]);
const ranks=useMemo(()=>cc88Rank(rows,rankDimension,rankMetric),[rows,rankDimension,rankMetric]);
const rankSelected=ranks.find(x=>x.label===rankFocus)||ranks[0];
 const missingSelectionDates=useMemo(()=>visibleRows.items.filter(r=>cc88Metric(r,'selected')&&!cc88Date(r.selection_date)).length,[visibleRows.items]);
const scopedCounts=useMemo(()=>Object.fromEntries(stages.map(([key])=>[key,scopedRows.filter(r=>r.status===key).length])),[scopedRows]);
const scopedTotals=useMemo(()=>({interviews:rows.reduce((s,r)=>s+cc88Metric(r,'interviews'),0),selected:rows.reduce((s,r)=>s+cc88Metric(r,'selected'),0),joined:rows.reduce((s,r)=>s+cc88Metric(r,'joined'),0),retained:rows.reduce((s,r)=>s+cc88Metric(r,'retained'),0),revenue:rows.reduce((s,r)=>s+cc88Metric(r,'revenue'),0)}),[rows]);
const rankHighlights=useMemo(()=>[
  ['Top client · Selections','client_name','selected'],['Top client · Joinings','client_name','joined'],
  ['Top recruiter · Selections','recruiter_name','selected'],['Top location · Selections','location','selected'],
  ['Top communication · Selections','communication_skill','selected']
].filter(([,field])=>lead||field!=='client_name').map(([title,field,metric])=>({title,metric,top:cc88Rank(rows,field,metric).find(x=>x[metric]>0)})),[rows,lead]);
const resetRevenueFilters=()=>{setQuery('');setStatus('');setClient('');setRecruiter('');setExtraFilters(cc88DefaultFilters());setDateStart('');setDateEnd('');setDatePreset('all');setDateBasis('interview_date');setRankFocus('');};
const applyDateWindow=kind=>{setDatePreset(kind);const now=day();const start=cc88MonthWindow();if(kind==='all'){setDateStart('');setDateEnd('');}else if(kind==='month'){setDateStart(start.start);setDateEnd(start.end);}else if(kind==='last_month'){const prev=cc88MonthWindow(-1);setDateStart(prev.start);setDateEnd(prev.end);}else if(kind==='two_months'){setDateStart(cc88MonthWindow(-1).start);setDateEnd(start.end);}else if(kind==='today'){setDateStart(now);setDateEnd(now);}};
const dimLabel=CC88_DIMS.find(([key])=>key===rankDimension)?.[1]||'Group';
const metricLabel=CC88_METRICS.find(([key])=>key===rankMetric)?.[1]||'Count';
 const field=(key,value)=>{setFormError(error=>error?.key===key?null:error);if(key==='email')setEmailConflict(null);setForm(f=>{
  const routing=['client_name','process','preferred_location'].includes(key)&&f.revenue_id&&String(f[key]||'')!==String(value||'');
  const base=routing?{...f,...initial(),_new_interview_from:f.revenue_id,revenue_id:undefined,updated_at:undefined,created_at:undefined,client_name:'',process:'',preferred_location:'',selection_date:'',joining_date:'',joined_date:'',notes:''}:f;
  let next={...base,[key]:value};
  if(key==='client_name'){
   const locations=editorCatalog.find(c=>c.name===value)?.locations||[];
   if(!locations.includes(next.preferred_location))next.preferred_location=locations[0]||'';
  }
  if(['client_name','process','preferred_location'].includes(key)&&!next.revenue_id)next={...next,...cc871Terms(next,data)};
  return next;
 });};
 async function saveProcess(name){try{const result=await api.post('/api/candidates/process-options',{name,kind:'process'},{retries:0});setData(d=>({...d,lookups:{...d.lookups,processes:result.process_options}}));setMessage('Process saved for everyone.');}catch(error){setMessage(error.message);}}
 function addAnother(){setForm(f=>{const next={...f,...initial(),_new_interview_from:f.revenue_id,client_name:'',process:'',preferred_location:'',selection_date:'',joining_date:'',joined_date:'',notes:'',revenue_id:undefined,updated_at:undefined,created_at:undefined};return next;});setEditorTab('details');setFormError(null);setEmailConflict(null);setShareHint('');setSearch(form.full_name||'');setMessage('New interview ready. Choose client, process and location. Attached files remain ready in this editor.');}

 function cc857ShowMissing(error){
  setFormError(error);
  // Scroll only inside this modal (never the CRM page behind it).
  requestAnimationFrame(()=>{
   setEditorTab('details');
   const element=Array.from(modalBodyRef.current?.querySelectorAll('[data-revenue-field]')||[]).find(item=>item.getAttribute('data-revenue-field')===error.key);
   if(!element)return;
   element.scrollIntoView({behavior:'smooth',block:'center',inline:'nearest'});
   const input=element.querySelector('input:not([type="hidden"]),select,textarea,button');
   if(input&&typeof input.focus==='function')input.focus({preventScroll:true});
  });
 }
 function defaultDestination(){
  const preferred=cc864SharePreferences(user?.user_id||user?.username,data.share_default);
  setDestinationType(preferred.type);setDestination(preferred.value);setGroupLabel(preferred.group_label);setMessageTemplate(preferred.message_template);setShareSettingsFeedback('');setShareHint('');
 }
 function rememberDestination(){
  const type=destinationType,value=destination.trim(),group_label=type==='group'?groupLabel.trim().slice(0,100):'';
  if(!cc854ValidDestination(type,value)){setMessage(type==='group'?'Enter a valid WhatsApp group link.':'Enter a valid WhatsApp number.');return false;}
  const stored=[{type,value,group_label},...savedDestinations.filter(x=>!(x.type===type&&x.value===value))].slice(0,20);
  try{localStorage.setItem(cc854DestKey(user?.user_id||user?.username),JSON.stringify(stored));}catch{}
  setSavedDestinations(stored);setMessage('WhatsApp destination remembered on this browser.');return true;
 }
 function selectDestination(key){
  const item=savedDestinations.find(x=>x.type+'|'+x.value===key);if(!item)return;
  setDestinationType(item.type);setDestination(item.value);setGroupLabel(item.group_label||'');
 }

 async function saveShareDetails(){
  if(busy||sharing)return;
  const value=destination.trim(),message_template=messageTemplate.trim();
  if(!cc854ValidDestination(destinationType,value)){setShareSettingsFeedback(destinationType==='group'?'Enter a valid WhatsApp group invite link.':'Enter a valid Indian WhatsApp number.');return;}
  if(!message_template||message_template.length>4000){setShareSettingsFeedback('Enter a message template between 1 and 4,000 characters.');return;}
  const settings={type:destinationType,value,group_label:destinationType==='group'?groupLabel.trim().slice(0,100):'',message_template};
  setBusy(true);setShareSettingsFeedback('');
  try{
   if(manager){
    const result=await api.post('/api/revenue-hub/config',{type:'share_default',destination_type:settings.type,destination:settings.value,group_label:settings.group_label,message_template},{retries:0});
    if(!result?.ok)throw Error('The server did not confirm these settings.');
    setData(previous=>({...previous,share_default:settings}));
    try{localStorage.removeItem(cc864PreferencesKey(user?.user_id||user?.username));}catch{}
   }else{
    localStorage.setItem(cc864PreferencesKey(user?.user_id||user?.username),JSON.stringify(settings));
   }
   rememberDestination();setMessageTemplate(message_template);
   setShareSettingsFeedback(manager?'Saved. This group and message are the team default.':'Saved. This group and message will be reused on this browser.');
  }catch(error){setShareSettingsFeedback('Could not save: '+error.message);}
  finally{setBusy(false);}
 }

 function edit(row){row={...row,client_name:row.client_name??data.editor?.entry_clients?.[row.revenue_id]??''};setEmailConflict(null);setFormError(null);setShareHint('');defaultDestination();setForm({...initial(),...row,interview_live:false,expected_candidate_email:row.candidate_email??row.email??'',payout_status:row.payout_status==='payout_received'?'payout_received':'payout_pending',payout_amount:row.payout_amount??'5000',payout_days:String(row.payout_days||'60'),payout_duration_days:row.payout_duration_days||'60',preferred_location:row.location||row.preferred_location||'',qualification:row.qualification||'Non-Graduate'});setResume(null);setClientImage(null);setSearch('');setFound([]);}
 function choose(c){setEmailConflict(null);setFormError(null);setShareHint('');const clientName=canChooseClient?(c.editor_client_name||c.client_name||c.company_name||''):'';const clientRule=(data.client_rules||[]).find(x=>String(x.client_name||'').trim().toLowerCase()===String(clientName).trim().toLowerCase());setForm(f=>({...f,...(clientRule?{payout_days:String(clientRule.payout_days||60),payout_amount:String(clientRule.payout_amount??f.payout_amount),payout_duration_days:String(clientRule.payout_duration_days||60)}:{}),candidate_id:c.candidate_id,expected_candidate_email:c.email||'',full_name:c.full_name,phone:c.phone||c.number,email:c.email||'',preferred_location:'',qualification:c.qualification||c.qualification_level||'Non-Graduate',client_name:clientName,recruiter_id:c.recruiter_id||c.recruiter_code||'',recruiter_user_id:c.recruiter_user_id||'',recruiter_name:c.recruiter_name||'',tl_id:c.tl_id||'',tl_name:c.tl_name||'',project_id:c.project_id||'',interview_datetime:nowIst(),interview_live:true,interview_mode:c.virtual_onsite||'Walkin',submission_date:(c.submission_date||day()).slice(0,10),process:c.process||'',communication_skill:c.communication_skill||'Good',experience_range:c.relevant_experience_range||'Fresher',salary_range:c.relevant_in_hand_range||'₹0'}));setFound([]);setSearch(c.full_name||'');setResume(null);setClientImage(null);setShareFollowUp('');setShareHint('');}
 // CC852: Resume/image files are only kept in React memory while this modal stays open.
 // The resume-autofill endpoint extracts text transiently and never writes the document to Supabase.
 async function attach(file,kind='original_resume'){
  if(!file)return;
  const cid=form?.candidate_id;if(!cid){setMessage('Select a candidate first.');return;}
  const ext=String(file.name||'').split('.').pop().toLowerCase(),isImage=['jpg','jpeg','png','webp'].includes(ext);
  if(!['pdf','doc','docx','jpg','jpeg','png','webp'].includes(ext)){setMessage('Choose a PDF, Word document, JPG, PNG or WEBP in either attachment box.');return;}
  if(!file.size||file.size>6*1024*1024){setMessage('Choose a file up to 6 MB.');return;}
  setBusy(true);
  try{
   const prepared=kind==='client_image'&&isImage?await brandRevenueImage(file):file;
   if(prepared.size>6*1024*1024)throw Error('Prepared file exceeds 6 MB.');
   if(kind==='client_image')setClientImage(prepared);else setResume(prepared);
   setShareFollowUp('');setShareHint('');
   setMessage('Attachment ready in this open form. File is not stored in CRM.');
   if(!isImage){
    try{
     const extracted=await api.post('/api/candidates/resume-autofill',{name:file.name,mime_type:file.type,content_base64:await base64(file)},{retries:0,timeoutMs:45000});
     const proposed=String(extracted?.fields?.email||'').trim(),email=extracted?.email_verified&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(proposed)?proposed:'';
     if(email&&form.email&&email.toLowerCase()!==String(form.email).trim().toLowerCase())setEmailConflict({current:String(form.email),resume:email});
     else if(email)setForm(old=>old?.candidate_id===cid?{...old,email:old.email||email}:old);
     setMessage(email?'Email extracted. Review it before saving. Attachment remains temporary.':'Attachment checked. Enter email manually if needed.');
    }catch(e){setMessage('Attachment is ready. Email extraction failed: '+e.message);}
   }
  }catch(e){setMessage('Preparing attachment failed: '+e.message);}
  finally{setBusy(false);}
 }
 const draft=form?revenueArrivalText({...form,recruiter_id:form.recruiter_id||form.recruiter_code||user?.recruiter_code||''},messageTemplate):'';
 async function copyMessage(){try{await navigator.clipboard.writeText(draft);setMessage('Copied. Paste into the intended WhatsApp group/chat.');}catch{setMessage('Clipboard is blocked. Select and copy the preview manually.');}}
 // CC853: Mirror the *document share workflow* from the reference video, not its design.
 // This must run directly from a user click: browsers expire native share permission
 // after awaiting an API save, clipboard call or async extraction.
 // CC856: Both files go to the OS share sheet when supported; never silently drop
 // the first attachment. WhatsApp Desktop can accept only one mixed-type attachment
 // on some versions; then a second explicit user click is required for the image.
 async function shareFiles(mode='auto'){
  if(emailConflict){setShareHint('Choose the correct email below the resume first.');return;}
  if(busy||shareInProgressRef.current)return;
  if(!form?.candidate_id){setShareHint('Select a candidate first.');return;}
  if(mode==='image'&&!clientImage){setShareHint('Choose the first attachment.');return;}
  if(mode!=='image'&&!resume){setShareHint('Choose the second attachment.');return;}
  const wantsBoth=mode==='auto'&&Boolean(clientImage);
  const offered=mode==='image'?[clientImage]:mode==='resume'?[resume]:[resume,...(clientImage?[clientImage]:[])];
  // Check without consuming the user gesture; navigator.share must run before await.
  const bothSupported=!wantsBoth||shareCapability(navigator,offered).ok;
  const files=wantsBoth&&!bothSupported?[resume]:offered;
  shareInProgressRef.current=true;setSharing(true);
  if(mode==='auto')setShareFollowUp('');
  setShareHint(wantsBoth&&!bothSupported
   ? 'This device cannot share both attachments together. Opening the second attachment now; after sharing, use Share first attachment separately.'
   : 'Opening your device Share panel. Select WhatsApp and your group/contact, then confirm Send.');
  try{
   // This call happens synchronously from the click gesture, before any awaited API.
   await nativeWhatsAppDocumentShare(navigator,files,{
    title:'Career Crox · '+(form?.full_name||'Candidate'),
    text:mode==='image'?'':draft,
   });
   if(mode==='image'){
    setShareFollowUp(shareFollowUp==='separate'?'resume':'');
    setShareHint(shareFollowUp==='separate'?'First attachment Share panel closed. Now share the second attachment separately to the same chat.':'First attachment passed to your device Share panel. Check the WhatsApp chat to confirm it was sent.');
   }else if(wantsBoth){
    setShareFollowUp('image');
    setShareHint(bothSupported
     ? 'both attachments were both offered to the Share panel. Check WhatsApp: some desktop versions only accept the second attachment. If the image is missing, click Share first attachment separately below.'
     : 'Attachment Share panel closed. Now click Share first attachment separately below to send the first attachment to the same chat.');
   }else{
    setShareFollowUp(mode==='resume'&&clientImage?'image':'');
    setShareHint(mode==='resume'&&clientImage?'Attachment Share panel closed. Now share the first attachment separately to the same chat.':'Attachment Share panel closed. Check WhatsApp to confirm the file and message were sent.');
   }
  }catch(e){
   if(e?.name==='AbortError'){
    setShareHint('Share cancelled; no delivery confirmed. Your files remain ready in this open form.');
    if(wantsBoth&&!bothSupported)setShareFollowUp('separate');
   }else{
    setShareHint(wantsBoth
     ? 'The combined share failed ('+(e?.message||'device unsupported')+'). Use the two separate share actions below; WhatsApp may require sending both attachments individually.'
     : 'Device Share is unavailable ('+(e?.message||'share failed')+'). Attach the file manually inside WhatsApp.');
    setShareFollowUp(wantsBoth?'separate':mode==='image'?'image':'');
   }
  }finally{shareInProgressRef.current=false;setSharing(false);}
 }
 function makeWhatsAppUrl(){
  const value=String(destination||'').trim();
  if(!value)throw Error('Enter WhatsApp number or group invite link.');
  if(destinationType==='group'){
   if(!/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+(?:\?[^\s]*)?$/.test(value))throw Error('Enter a valid WhatsApp group invite link.');
   return value;
  }
  const digits=value.replace(/\D/g,'');const number=digits.length===10?'91'+digits:digits;
  if(!/^[0-9]{12}$/.test(number)||!number.startsWith('91'))throw Error('Enter a valid Indian WhatsApp number.');
  return window.CareerCroxWhatsApp.build(number,draft);
 }
 function inform(options={}){
  try{
   if(!form?.candidate_id&&!options.savedCandidateId)throw Error('Select a saved CRM candidate first.');
   const url=makeWhatsAppUrl();
   const request=window.CareerCroxWhatsApp.open(url,undefined,{source:'inform_to_manager'});
   if(request.error)throw Error(request.error);
   if(cc854ValidDestination(destinationType,destination.trim()))rememberDestination();
   setShareHint(destinationType==='group'?'Group invite link opens group info. Select the actual group in WhatsApp to share the second attachment.':'WhatsApp Desktop requested with text. Use Share Resume to attach the second attachment.');
   setMessage('WhatsApp Desktop requested. Check the app and send the message/files yourself.');
   // CC854: Opening a share screen is not a server-side event; avoid an unnecessary POST/egress.
  }catch(e){if(options.windowRef&&!options.windowRef.closed)options.windowRef.close();setMessage(e.message);}
 }
 async function save(andInform=false){
  if(savingRevenueRef.current||busy||sharing||!form)return;
  if(emailConflict){setFormError({key:'email',message:'Choose the correct email below the resume first.'});return;}
  const payload={...form,interview_datetime:form.interview_live?nowIst():form.interview_datetime,interview_live:false};
  // Hidden financial controls must never send their default values over an
  // existing saved payout when a TL/manager works in their own narrow dashboard.
  if(!lead)for(const key of ['payout_amount','payout_days','payout_duration_days','payout_status','invoice_lead_days','invoice_status','payout_received_at'])delete payload[key];
  const error=cc857ValidateSave(payload,lead,canChooseClient);
  if(error){cc857ShowMissing(error);return;}
  setFormError(null);
  // CC857: One POST and one post-save refresh. Ignore the POST's duplicate
  // "data-written" refresh; no extra request on invalid forms.
  let popup=null;
  if(andInform){try{makeWhatsAppUrl();}catch(e){setMessage(e.message);return;}}
  savingRevenueRef.current=true;
  setBusy(true);
  try{
   const path=form.revenue_id?'/api/revenue-hub/'+encodeURIComponent(form.revenue_id)+'/status':'/api/revenue-hub/add-candidate';
   setForm(payload);
   const result=await api.post(path,form.revenue_id?{...payload,expected_updated_at:form.updated_at}:payload,{retries:0,allowStale:false});
   if(!result?.item?.candidate_id)throw Error('Server did not confirm the saved candidate. Please review before retrying.');
   if(andInform)inform({windowRef:popup,savedCandidateId:result.item.candidate_id});
   setForm({...payload,...result.item,_new_interview_from:'',expected_candidate_email:result.item.email||'',preferred_location:result.item.location||payload.preferred_location,interview_live:false});
   setFormError(null);setSearch(result.item.full_name||'');setFound([]);
   setMessage('Interview saved. Add another interview to retain a separate client/process history.');
   setData(previous=>{const entries=previous.items||[],id=String(result.item.revenue_id);const exists=entries.some(item=>String(item.revenue_id)===id);return {...previous,items:exists?entries.map(item=>String(item.revenue_id)===id?{...item,...result.item}:item):[result.item,...entries]};});
   void load(true);
  }catch(e){
   if(popup&&!popup.closed)popup.close();
   const message=String(e?.message||'Unable to save.');
   const fieldKey=cc857ServerField(message);
   if(fieldKey)cc857ShowMissing({key:fieldKey,message});
   else {setFormError({key:'',message:'Save failed: '+message+'. Your form has been kept; please retry after correcting the problem.'});}
  }finally{savingRevenueRef.current=false;setBusy(false);}
 }
 // CC858: One specific Pipeline Hub row only. The server soft-removes the
 // revenue entry and leaves candidates, submissions, interviews and notes intact.
 async function deleteRevenueEntry(){
  if(!manager||!deleteTarget||deletingRevenueRef.current)return;
  const target=deleteTarget;
  deletingRevenueRef.current=true;
  setDeletingRevenue(true);setDeleteError('');
  try{
   const expected=target.updated_at?('?expected_updated_at='+encodeURIComponent(target.updated_at)):'';
   const result=await api.del('/api/revenue-hub/'+encodeURIComponent(target.revenue_id)+expected,{retries:0,allowStale:false});
   if(!result?.ok||String(result.revenue_id)!==String(target.revenue_id))throw Error('Server did not confirm this Pipeline Hub removal.');
   // Remove the exact revenue row instantly; server recalculates cards in one GET.
   setData(previous=>({...previous,items:(previous.items||[]).filter(item=>String(item.revenue_id)!==String(target.revenue_id))}));
   setDeleteTarget(null);setDeleteError('');
   setMessage('Removed from Pipeline Hub only. Candidate profile, notes, submissions and interviews were not deleted.');
   setPage(p=>Math.min(p,Math.max(0,Math.ceil((rows.length-1)/100)-1)));
   void load(true);
  }catch(error){
   setDeleteError('Could not remove this Pipeline Hub entry: '+String(error?.message||'Please retry.'));
   if(Number(error?.status)===409)void load(true);
  }finally{
   deletingRevenueRef.current=false;setDeletingRevenue(false);
  }
 }
 async function checkReminders(){try{const response=await api.get('/api/revenue-hub/reminders',{cacheTtlMs:0,allowStale:false,retries:0});setManualReminders(response.items||[]);}catch(e){setMessage('Reminder check failed: '+e.message);}}
 async function configure(payload){setBusy(true);try{await api.post('/api/revenue-hub/config',payload,{retries:0});setMessage('Saved.');await load(true);}catch(e){setMessage(e.message);}finally{setBusy(false);}}
 function exportReport(){if(!manager)return;const report=rows.map((r,index)=>{const out={sr_no:index+1,candidate_id:r.candidate_id,name:r.full_name,phone:r.phone,email:r.email,client:r.client_name,process:r.process,recruiter:r.recruiter_name,status:label(r.status),interview:r.interview_datetime,selection:r.selection_date,joining:r.joining_date,joined:r.joined_date,notes:r.notes};if(lead)Object.assign(out,{recognized_revenue:['joined','completed_60_days'].includes(r.status)?Number(r.payout_amount||0):0,payout_amount:r.payout_amount,payout_status:r.payout_status,payout_due:r.payout_due_date});return out;});window.CC787Backup.save(window.CC787Backup.excelSheets([{name:'Monthly report',rows:report}]),'Revenue_Hub_Filtered_'+(dateStart||'all')+'_'+(dateEnd||'all')+'.xlsx');}
 const formOptions=useMemo(()=>({
   client_name:canChooseClient?cleanOptions([...(data.editor?.clients||data.lookups?.clients||REVENUE_OFFICE_CLIENTS),form?.client_name]):[],
   process:[...(data.lookups?.processes||[]),...(data.items||[]).flatMap(x=>String(x.process||'').split(','))],
   preferred_location:cleanOptions(editorCatalog.find(c=>c.name===form?.client_name)?.locations||data.lookups?.locations||REVENUE_OFFICE_LOCATIONS),
   qualification:[...REVENUE_FORM_PRESETS.qualification,...(data.items||[]).map(x=>x.qualification)],
   communication_skill:[...REVENUE_FORM_PRESETS.communication_skill,...(data.lookups?.communication_skills||[])],
   experience_range:[...REVENUE_FORM_PRESETS.experience_range,...(data.items||[]).map(x=>x.experience_range)],
   salary_range:[...REVENUE_FORM_PRESETS.salary_range,...(data.items||[]).map(x=>x.salary_range)],
   payout_amount:REVENUE_FORM_PRESETS.payout_amount,
   payout_days:REVENUE_FORM_PRESETS.payout_days,
   payout_duration_days:REVENUE_FORM_PRESETS.payout_duration_days,
 }),[data.items,data.lookups,data.client_rules,data.editor,canChooseClient,form?.client_name]);
 const summary=data.summary||{},flowRoot=data.target_flow?.nodes?.find(n=>n.id===data.target_flow.root_id),targetView=tab==='targets'&&flowRoot,goal=targetView?flowRoot.amount:lead?summary.month_target:summary.joining_target,achieved=targetView?flowRoot.earned:lead?summary.month_income:summary.month_joined,headerPercent=targetView?flowRoot.percent:summary.month_achievement_percent;
 return <Layout title="Pipeline Hub"><CrmSortSelect value={effectiveSort} onChange={setSortBy}/>
 <header className="cc814-revenue-hero"><div><span className="cc814-eyebrow">PIPELINE STUDIO</span><h1>Pipeline Hub</h1><div className="cc814-progress"><span style={{width:Math.min(100,Number(headerPercent||0))+'%'}}/></div><p>{lead?money(achieved):Number(achieved||0)+' joinings'} of {lead?money(goal):Number(goal||0)+' joinings'} · {Number(headerPercent||0)}%</p></div><button className="add-profile-btn" onClick={()=>{defaultDestination();setForm(initial());setFormError(null);setResume(null);setClientImage(null);setShareHint('');setSearch('');}}>＋ Add candidate</button></header>
 <div className="cc831-joining-cards"><div><strong>{summary.joining_target||0}</strong><span>Joining target</span></div><div><strong>{summary.personal_month_joined??summary.month_joined??0}</strong><span>Achieved</span></div><div><strong>{summary.joining_remaining||0}</strong><span>Remaining</span></div></div>
 <nav className="cc814-tabs">{['pipeline','analytics','leaderboard',...(lead?['targets','client rules']:[])].map(t=><button key={t} className={tab===t?'active':''} onClick={()=>setTab(t)}>{t}</button>)}</nav>
 <div className="cc814-metrics">{(targetView?[['Joinings · '+data.target_month,flowRoot.joined,'green'],['Revenue · '+data.target_month,money(flowRoot.earned),'mint'],['Monthly budget',money(flowRoot.amount),'violet'],['Achievement',Number(flowRoot.percent||0)+'%','sky']]:[['Interviews',data.cards?.will_come_for_interview,'peach'],['Feedback',data.cards?.appeared_for_interview,'violet'],['Selected now',data.cards?.selected,'mint'],['Joined this month',summary.month_joined,'green'],...(lead?[['Revenue this month',money(summary.month_income),'amber'],['Cash received',money(summary.month_cash_received),'teal']]:[])]).map(([name,value,tone])=>{const stageKey=({Interviews:'will_come_for_interview',Feedback:'appeared_for_interview','Selected now':'selected','Joined this month':'joined'})[name];return stageKey&&!targetView?<button type="button" key={name} aria-pressed={tab==='pipeline'&&status===stageKey} className={'stat-card cc828-stat cc814-metric bucket-click-card '+tone+(tab==='pipeline'&&status===stageKey?' active':'')} onClick={()=>{setTab('pipeline');setStatus(stageKey);}}><small>{name}</small><strong>{value||0}</strong></button>:<div key={name} className={'stat-card cc828-stat cc814-metric '+tone}><small>{name}</small><strong>{value||0}</strong></div>;})}</div>
 {manualReminders&&<div className="cc814-status" role="status"><strong>Revenue reminders · {manualReminders.length}</strong> {manualReminders.slice(0,12).map(r=><button type="button" className="ghost-btn" key={r.reminder_id} onClick={()=>{setManualReminders(null);if(r.candidate_id){const found=(data.items||[]).find(row=>row.candidate_id===r.candidate_id);if(found)edit(found);}}}>{r.title} · {r.full_name}</button>)}<button type="button" onClick={()=>setManualReminders(null)}>Close</button></div>}
 {message&&<div className="cc814-status" role="status">{message}<button onClick={()=>setMessage('')} aria-label="Dismiss">×</button></div>}
 
{['pipeline','analytics','leaderboard'].includes(tab)&&<section className="panel cc88-filter-panel" aria-label="Pipeline Hub filters">
  <div className="cc88-filter-top">
    <label>Search <input aria-label="Search revenue candidates" type="search" placeholder="Name, phone, candidate ID, client, process…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    {lead&&<label>Client <select aria-label="Revenue client filter" value={client} onChange={e=>setClient(e.target.value)}><option value="">All clients</option>{cc88SelectOptions(data.items,'client_name',data.lookups?.clients).map(v=><option key={v} value={v}>{v}</option>)}</select></label>}
    <label>Recruiter <select aria-label="Revenue recruiter filter" value={recruiter} onChange={e=>setRecruiter(e.target.value)}><option value="">All recruiters</option>{cc88SelectOptions(data.items,'recruiter_name',data.lookups?.recruiters).map(v=><option key={v} value={v}>{v}</option>)}</select></label>
    <button type="button" className="ghost-btn" onClick={()=>setAdvancedFilters(v=>!v)} aria-expanded={advancedFilters}>{advancedFilters?'Hide filters':'More filters'} ▾</button>
    <button type="button" className="ghost-btn" onClick={resetRevenueFilters}>Reset all</button>
    <button type="button" className="ghost-btn" onClick={()=>load(true)}>↻ Manual Refresh</button>
    <button type="button" className="ghost-btn" onClick={checkReminders}>Check reminders</button>
  </div>
  <div className="cc88-date-filters">
    <label>Date based on <select aria-label="Date type for revenue analysis" value={dateBasis} onChange={e=>setDateBasis(e.target.value)}>{CC88_DATE_FIELDS.map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <label>From <input type="date" aria-label="Revenue from date" value={dateStart} max={dateEnd||undefined} onChange={e=>{setDateStart(e.target.value);setDatePreset('custom');}}/></label>
    <label>To <input type="date" aria-label="Revenue to date" value={dateEnd} min={dateStart||undefined} onChange={e=>{setDateEnd(e.target.value);setDatePreset('custom');}}/></label>
    <div className="cc88-date-quick"><button type="button" className={datePreset==='all'?'active':''} aria-pressed={datePreset==='all'} onClick={()=>applyDateWindow('all')}>All dates</button><button type="button" className={datePreset==='month'?'active':''} aria-pressed={datePreset==='month'} onClick={()=>applyDateWindow('month')}>This month</button><button type="button" className={datePreset==='last_month'?'active':''} aria-pressed={datePreset==='last_month'} onClick={()=>applyDateWindow('last_month')}>Last month</button><button type="button" className={datePreset==='two_months'?'active':''} aria-pressed={datePreset==='two_months'} onClick={()=>applyDateWindow('two_months')}>Last 2 months</button></div>
  </div>
  {advancedFilters&&<div className="cc88-advanced">{[
    ['process','Process','processes'],['location','Location','locations'],['qualification','Qualification',''],
    ['communication_skill','Communication','communication_skills'],['experience_range','Experience','experience_ranges'],
    ['salary_range','Salary','salary_ranges'],['interview_mode','Interview mode','']
  ].map(([key,name,lookup])=><label key={key}>{name}<select aria-label={'Filter by '+name} value={extraFilters[key]||''} onChange={e=>setExtraFilters(f=>({...f,[key]:e.target.value}))}><option value="">All {name.toLowerCase()}</option>{cc88SelectOptions(data.items,key,data.lookups?.[lookup]).map(v=><option key={v}>{v}</option>)}</select></label>)}</div>}
  <div className="cc88-filter-meta"><strong>{rows.length}</strong> matching interviews · {dateStart||dateEnd?`${dateStart||'Start'} → ${dateEnd||'Today'}`:'All dates'} · Using {CC88_DATE_FIELDS.find(([key])=>key===dateBasis)?.[1]}{visibleRows.skipped>0?` · ${visibleRows.skipped} duplicate rows excluded`:''}{visibleRows.conflicts>0?` · ${visibleRows.conflicts} conflicting candidates shown for review (excluded from financial totals)`:''}</div>
  {(dateStart||dateEnd)&&<div className="cc88-date-note">Only records with a saved {CC88_DATE_FIELDS.find(([key])=>key===dateBasis)?.[1].toLowerCase()} in this range are counted. Missing dates are excluded, never guessed.{dateBasis==='selection_date'&&missingSelectionDates>0?` ${missingSelectionDates} selection records have no saved selection date.`:''}</div>}
</section>}
{['pipeline','analytics','leaderboard'].includes(tab)&&<div className="cc88-filter-stats" aria-label="Revenue filtered totals">{[
  ['Interviews',scopedTotals.interviews],['Selections',scopedTotals.selected],['Selection rate',scopedTotals.interviews?Math.round(scopedTotals.selected/scopedTotals.interviews*100)+'%':'0%'],['Joinings',scopedTotals.joined],['Retained 60 days',scopedTotals.retained],...(lead?[['Earned revenue',money(scopedTotals.revenue)]]:[])
].map(([name,value])=><div className="cc88-filter-stat" key={name}><small>{name}</small><strong>{value}</strong></div>)}</div>}

 {tab==='pipeline'&&<section className="panel cc814-data-panel"><div className="cc814-stage-pills"><button className={!status?'active':''} onClick={()=>setStatus('')}>All · {scopedRows.length}</button>{stages.map(([key,name,tone])=><button key={key} className={tone+(status===key?' active':'')} onClick={()=>setStatus(status===key?'':key)}>{name} <b>{scopedCounts[key]||0}</b></button>)}</div><div className="table-scroll"><table className={'cc814-table cc883-pipeline-table'+(lead?'':' cc883-own-pipeline')}><thead><tr>{['Sr. No.','Candidate',lead?'Client / process':'Process','Recruiter','Interview','Selection date','Joining date','Status',...(lead?['Payout']:[]),''].map((v,i)=><th key={i}>{v}</th>)}</tr></thead><tbody>{rows.slice(page*100,(page+1)*100).map((r,rowIndex)=><tr key={r.revenue_id} className="cc815-clickable-row" data-pipeline-tone={cc883PipelineTone(r)||undefined} role="button" tabIndex={0} title="Open candidate profile" onClick={()=>openCandidateProfileInNewTab(r,rows.slice(page*100,(page+1)*100),{sourceKind:'revenue',sourcePath:window.location.pathname+window.location.search,hasMore:false})} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCandidateProfileInNewTab(r,rows.slice(page*100,(page+1)*100),{sourceKind:'revenue',sourcePath:window.location.pathname+window.location.search,hasMore:false});}}}><td className="cc883-row-number">{page*100+rowIndex+1}</td><td><strong className="cc814-text-action">{r.full_name}</strong><small>{r.phone}</small></td><td>{lead?r.client_name:r.process}{lead&&<small>{r.process}</small>}</td><td>{r.recruiter_name}</td><td>{cc883InterviewValue(r).replace('T',' ')||'—'}{interviewWeekday(cc883InterviewValue(r))&&<small>{interviewWeekday(cc883InterviewValue(r))}</small>}</td><td><PipelineMilestoneDate value={r.selection_date}/></td><td><PipelineMilestoneDate {...cc883JoiningDate(r)}/></td><td><span className={'cc814-badge '+(stages.find(s=>s[0]===r.status)?.[2]||'')}>{label(r.status)}</span>{r._cc88_conflict&&<small role="alert">⚠ Duplicate mismatch · review records</small>}</td>{lead&&<td>{money(r.recognized_payout)}<small>{r.payout_status==='payout_received'&&!'joined,completed_60_days'.split(',').includes(r.status)?'Backout · refund review':!'joined,completed_60_days'.split(',').includes(r.status)?'Not earned':r.payout_status==='payout_received'?'Received':!r.payout_duration_complete?'Eligibility: '+(r.payout_eligibility_date||'set joining date'):r.payout_pending?'Action due':'Pending'}</small></td>}<td><div className="cc858-row-actions"><button className="ghost-btn" onClick={e=>{e.stopPropagation();edit(r);}}>Update</button>{manager&&<button type="button" className="cc858-delete-trigger" aria-label={'Remove '+r.full_name+' from Pipeline Hub only'} onClick={e=>{e.stopPropagation();setDeleteError('');setDeleteTarget({revenue_id:r.revenue_id,candidate_id:r.candidate_id,full_name:r.full_name,updated_at:r.updated_at});}} onKeyDown={e=>e.stopPropagation()}>Delete</button>}</div></td></tr>)}</tbody></table>{!rows.length&&<div className="cc814-empty">No candidates in this view. Add one or change the filters.</div>}</div><div className="cc814-toolbar">{manager&&<><span className="cc88-filter-meta">Export visible records</span><button className="add-profile-btn" onClick={exportReport}>↓ Export Excel</button></>}<button className="ghost-btn" disabled={!page} onClick={()=>setPage(p=>p-1)}>Previous</button><span>{page+1} / {Math.max(1,Math.ceil(rows.length/100))}</span><button className="ghost-btn" disabled={(page+1)*100>=rows.length} onClick={()=>setPage(p=>p+1)}>Next</button><span>{rows.length} interviews · active filters apply</span></div></section>}
 {['analytics','leaderboard'].includes(tab)&&<section className="panel cc88-analysis" aria-label="Revenue analytics and leaderboard">
  <header className="cc88-analysis-header"><h2>{tab==='analytics'?'Revenue Analytics':'Revenue Leaderboard'}</h2><span>Rankings use the same filtered candidates and selected date range.</span></header>
  {tab==='analytics'&&<div className="cc88-top-cards">{rankHighlights.map(({title,top,metric})=><button type="button" key={title} className="cc88-top-card" onClick={()=>{const dimension=title.includes('recruiter')?'recruiter_name':title.includes('location')?'location':title.includes('communication')?'communication_skill':'client_name';setRankDimension(dimension);setRankMetric(metric);setRankFocus(top?.label||'');}}><small>{title}</small><strong>{top?.label||'No matching data'}</strong><span>{top?`${top[metric]} ${metric==='selected'?'selections':'joinings'}`:'0 records'}</span></button>)}</div>}
  <div className="cc88-rank-controls"><label>Rank by <select aria-label="Revenue leaderboard group by" value={rankDimension} onChange={e=>{setRankDimension(e.target.value);setRankFocus('');}}>{CC88_DIMS.filter(([key])=>lead||key!=='client_name').map(([key,name])=><option value={key} key={key}>{name}</option>)}</select></label><label>Compare <select aria-label="Revenue leaderboard metric" value={rankMetric} onChange={e=>setRankMetric(e.target.value)}>{CC88_METRICS.filter(([key])=>lead||key!=='revenue').map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label><span>{ranks.length} {dimLabel.toLowerCase()} groups</span></div>
  <div className="cc88-leaderboard-list"><table className="cc88-rank-table"><thead><tr><th>Rank</th><th>{dimLabel}</th><th>{metricLabel}</th><th>Interviews</th><th>Selections</th><th>Joinings</th><th>Profiles</th></tr></thead><tbody>{ranks.map((r,i)=><tr key={r.label} className={rankSelected?.label===r.label?'cc88-rank-active':''} onClick={()=>setRankFocus(r.label)} role="button" tabIndex={0} onKeyDown={e=>{if(e.key==='Enter')setRankFocus(r.label);}}><td>#{i+1}</td><td><strong>{r.label}</strong></td><td><strong>{rankMetric==='revenue'?money(r.revenue):r[rankMetric]}</strong></td><td>{r.interviews}</td><td>{r.selected}</td><td>{r.joined}</td><td>{r.count}</td></tr>)}{!ranks.length&&<tr><td colSpan={7}>No records match these filters. Change date type or date range.</td></tr>}</tbody></table></div>
  {rankSelected&&<div className="cc88-rank-details"><h3>{rankSelected.label} · {rankSelected.profiles.length} profiles</h3><p>Complete candidate list for the selected {dimLabel.toLowerCase()}. Click a row to open the CRM profile.</p><div className="cc88-leaderboard-list"><table className="cc88-rank-table cc883-pipeline-table"><thead><tr><th>Sr. No.</th><th>Candidate</th><th>{lead?'Client':'Process'}</th><th>Recruiter</th><th>Interview</th><th>Selection date</th><th>Joining date</th><th>Status</th></tr></thead><tbody>{rankSelected.profiles.map((r,i)=><tr key={r.revenue_id||r.candidate_id||i} data-pipeline-tone={cc883PipelineTone(r)||undefined} role="button" tabIndex={0} onClick={()=>openCandidateProfileInNewTab(r,rankSelected.profiles,{sourceKind:'revenue-rank',sourcePath:window.location.pathname+window.location.search,hasMore:false})} onKeyDown={e=>{if(e.key==='Enter')openCandidateProfileInNewTab(r,rankSelected.profiles,{sourceKind:'revenue-rank',sourcePath:window.location.pathname+window.location.search,hasMore:false});}}><td className="cc883-row-number">{i+1}</td><td>{r.full_name}<small>{r.candidate_id}</small></td><td>{(lead?r.client_name:r.process)||'—'}</td><td>{r.recruiter_name||'—'}</td><td>{cc883InterviewValue(r).replace('T',' ')||'—'}</td><td><PipelineMilestoneDate value={r.selection_date}/></td><td><PipelineMilestoneDate {...cc883JoiningDate(r)}/></td><td>{label(r.status)}</td></tr>)}</tbody></table></div></div>}
</section>}
  {tab==='targets'&&lead&&<section className="panel cc828-target-panel"><header className="cc828-section-head"><div><h2>Monthly target flow</h2><span>Set each target once. Saved targets stay fixed as you work down the team.</span></div><label>Month<input type="month" value={data.target_month||reportMonth} onChange={e=>{if(!e.target.value)return;targetMonthRef.current=e.target.value;setReportMonth(e.target.value);load(true);}}/></label></header><TargetFlow flow={data.target_flow} manager={manager} busy={busy} onSave={(id,amount,release_fixed=false)=>configure({release_fixed,type:'target_flow',month:data.target_month,user_id:id,amount,expected_revision:data.target_flow?.revision})}/><div className="cc831-joining-tree"><h2>Monthly joining flow</h2><TargetFlow joining flow={data.joining_flow} manager={manager} busy={busy} onSave={(id,amount,release_fixed=false)=>configure({release_fixed,type:'joining_flow',month:data.target_month,user_id:id,amount,expected_revision:data.joining_flow?.revision})}/></div></section>}
 {tab==='client rules'&&lead&&<section className="panel"><h2>Client payment terms</h2><div className="cc814-form-grid"><PresetChoice label="Client" value={rule.client_name} options={formOptions.client_name} onChange={v=>setRule(r=>({...r,client_name:v}))}/>
  <PresetChoice label="Payout per joining (₹)" value={rule.payout_amount} options={REVENUE_FORM_PRESETS.payout_amount} onChange={v=>setRule(r=>({...r,payout_amount:v}))} allowCustom={false}/>
  <PresetChoice label="Payment after joining · days" value={rule.payout_days} options={REVENUE_FORM_PRESETS.payout_days} onChange={v=>setRule(r=>({...r,payout_days:v}))} allowCustom={false}/>
  <PresetChoice label="Payout duration · days" value={rule.payout_duration_days??60} options={REVENUE_FORM_PRESETS.payout_duration_days} onChange={v=>setRule(r=>({...r,payout_duration_days:v}))} allowCustom={false}/>
  <PresetChoice label="Invoice reminder · days before" value={rule.invoice_lead_days} options={['0','1','2','3','5']} onChange={v=>setRule(r=>({...r,invoice_lead_days:v}))} allowCustom={false}/></div><button className="add-profile-btn" disabled={busy} onClick={()=>configure({type:'client',...rule})}>Save client terms</button><div className="cc814-ranks">{data.client_rules?.map((r,i)=><button className="cc814-rank peach" key={i} onClick={()=>setRule(r)}><b>{r.client_name}</b><span>{money(r.payout_amount)} · {r.payout_days} days</span></button>)}</div></section>}
 {deleteTarget&&manager&&createPortal(<div className="cc859-delete-overlay" onMouseDown={e=>{if(e.target===e.currentTarget&&!deletingRevenueRef.current){setDeleteTarget(null);setDeleteError('');}}}><section className="cc858-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cc858-delete-title" aria-describedby="cc858-delete-description"><h3 id="cc858-delete-title">Remove Pipeline Hub entry?</h3><p id="cc858-delete-description"><strong>{deleteTarget.full_name||'Candidate'}</strong>{deleteTarget.candidate_id&&<> · {deleteTarget.candidate_id}</>}</p><p>Only this entry will disappear from <strong>Pipeline Hub</strong>. The main Candidate Profile, Notes, Submissions and Interviews will remain unchanged.</p><p className="cc858-delete-note">The Pipeline Hub record is marked deleted for audit history. Nothing is permanently erased.</p>{deleteError&&<p className="cc858-delete-error" role="alert">{deleteError}</p>}<div className="cc858-delete-actions"><button type="button" className="ghost-btn" disabled={deletingRevenue} onClick={()=>{setDeleteTarget(null);setDeleteError('');}}>Cancel</button><button type="button" className="cc858-delete-confirm" disabled={deletingRevenue} onClick={deleteRevenueEntry}>{deletingRevenue?'Removing…':'Yes, remove Revenue entry'}</button></div></section></div>,document.body)}
 {form&&createPortal(<div id="cc861-revenue-overlay" className="modal-backdrop cc861-editor-overlay">
  <section className="cc814-modal cc861-revenue-editor" role="dialog" aria-modal="true" aria-labelledby="cc864-revenue-title">
   <header><div className="cc864-editor-heading"><span className="cc864-heading-icon" aria-hidden="true">✦</span><div><small>PIPELINE HUB</small><h2 id="cc864-revenue-title">{form.full_name||'Add a candidate'}</h2></div></div><button type="button" className="cc864-editor-close" aria-label="Close candidate editor" disabled={busy||sharing} onClick={()=>{setForm(null);setFormError(null);setResume(null);setClientImage(null);setShareHint('');setShareFollowUp('');}}>×</button></header>
   <nav className="cc861-editor-tabs" aria-label="Candidate editor">
    <button type="button" aria-pressed={editorTab==='details'} onClick={()=>setEditorTab('details')}><span aria-hidden="true">▤</span> Candidate details</button>
    <button type="button" aria-pressed={editorTab==='settings'} onClick={()=>setEditorTab('settings')}><span aria-hidden="true">⚙</span> Update group & message details</button>
   </nav>
   <div className="cc814-modal-body cc861-editor-body" ref={modalBodyRef}>
    <aside className="cc861-editor-sidebar">{formError&&<div role="alert" className="cc857-validation-banner">⚠ {formError.message}</div>}{!form.revenue_id&&<div data-revenue-field="candidate_id" className={"field cc854-candidate-first "+(formError?.key==='candidate_id'?'cc857-field-missing':'')}><label>1 · Select candidate first</label><input autoFocus={!form.candidate_id} value={search} onChange={e=>{setSearch(e.target.value);setFormError(error=>error?.key==='candidate_id'?null:error);if(form.candidate_id){setForm(f=>({...f,candidate_id:''}));setResume(null);setClientImage(null);setShareHint('');setShareFollowUp('');}}} placeholder="Search candidate by name, phone or serial…"/>{form.candidate_id&&<strong className="cc854-candidate-selected">✓ Selected: {form.full_name} · {form.candidate_id}</strong>}{found.map(c=><button type="button" key={c.candidate_id} className="cc814-search-result" onClick={()=>choose(c)}><strong>{c.full_name}</strong><span>{c.phone||c.number} · {c.candidate_id}</span></button>)}</div>}<div className="cc820-resume-start cc851-dual-resume cc854-uploads">
 <label className={'field cc854-file-tile '+(clientImage?'cc854-file-attached':'')}><span>Attachment 1 · Image / PDF / Word</span><span className="cc854-file-action">{clientImage?'✓ File attached · Change':'＋ Choose image / PDF / Word'}</span><input disabled={busy||!form.candidate_id} type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" onChange={e=>{void attach(e.target.files?.[0],'client_image');e.target.value='';}}/>{clientImage&&<strong className="cc854-file-name">{clientImage.name}</strong>}</label>
 <label className={'field cc854-file-tile '+(resume?'cc854-file-attached':'')}><span>Attachment 2 · Image / PDF / Word</span><span className="cc854-file-action">{resume?'✓ Resume attached · Change':'＋ Choose image / PDF / Word'}</span><input disabled={busy||!form.candidate_id} type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" onChange={e=>{void attach(e.target.files?.[0],'original_resume');e.target.value='';}}/>{resume&&<strong className="cc854-file-name">{resume.name} · {fileSizeLabel(resume.size)}</strong>}</label>
 </div><label className="field cc871-candidate-email" data-revenue-field="email"><span>Candidate email</span><input type="email" value={form.email||''} onChange={e=>field('email',e.target.value)} placeholder="Email from candidate / resume"/>{resume&&<small>Resume attached · {form.email||'Email not found; enter manually'}</small>}</label>{emailConflict&&<div className="cc871-email-conflict" role="alert"><strong>Email differs from resume</strong><p>Choose the correct address.</p><button type="button" onClick={()=>{field('email',emailConflict.current);setEmailConflict(null);}}>Keep profile: {emailConflict.current}</button><button type="button" onClick={()=>{field('email',emailConflict.resume);setEmailConflict(null);}}>Use resume: {emailConflict.resume}</button></div>}</aside>
    <main className="cc861-editor-main">{form._new_interview_from&&!form.revenue_id&&<p className="cc871-history-kept" role="status">New interview draft · the previous interview is kept. Choose client, process and location.</p>}
     <section hidden={editorTab!=='details'} className="cc861-editor-details" aria-label="Candidate details"><div className="cc814-form-grid">{[
     ...(canChooseClient?[['client_name','Client','preset']]:[]),
    ['process','Process','preset'],
    ['preferred_location','Client location','preset'],
    ...(lead?[
      ['payout_amount','Payout per joining (₹)','preset'],
      ['payout_days','Payment after joining · days','preset'],
      ['payout_duration_days','Payout duration · days','preset'],
    ]:[]),
  ].map(([key,name,type])=>type==='preset'
    ?<PresetChoice fieldKey={key} invalid={formError?.key===key} key={key+'-'+String(form.candidate_id||'new')} label={name} value={form[key]} options={formOptions[key]||[]} onChange={value=>field(key,value)} onCommit={key==='process'?saveProcess:undefined} groups={key==='client_name'?cc871Groups(formOptions.client_name,editorCatalog,true):key==='preferred_location'?cc871Groups(formOptions.preferred_location,[]):undefined} allowCustom={!['payout_amount','payout_days','payout_duration_days'].includes(key)}/>
    :<label data-revenue-field={key} className={"field "+(formError?.key===key?"cc857-field-missing":"")} key={key}><span>{name}</span>{type==='datetime-local'?<CrmDateTimeInput type={type} value={form[key]??''} onChange={e=>field(key,e.target.value)}/>:<input type={type} value={form[key]??''} onChange={e=>field(key,e.target.value)}/>}{key==='interview_datetime'&&interviewDateCaption(form[key])&&<small className="cc86-interview-weekday">{interviewDateCaption(form[key])}</small>}</label>
  )}
  <PipelineInterviewClock value={form.interview_datetime} live={form.interview_live} onChange={(value,live)=>setForm(f=>({...f,interview_datetime:value,interview_live:live}))}/>
  <label data-revenue-field="status" className={"field "+(formError?.key==='status'?'cc857-field-missing':'')}><span>Status</span><select value={form.status} onChange={e=>field('status',e.target.value)}>{stages.map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label><label data-revenue-field="interview_mode" className={"field "+(formError?.key==='interview_mode'?'cc857-field-missing':'')}><span>Interview mode</span><select value={form.interview_mode||'Walkin'} onChange={e=>field('interview_mode',e.target.value)}>{['Walkin','Virtual','Onsite'].map(x=><option key={x}>{x}</option>)}</select></label>{lead&&<><label className="field"><span>Payment</span><select value={form.payout_status==='payout_received'?'payout_received':'payout_pending'} onChange={e=>field('payout_status',e.target.value)}><option value="payout_pending">Payout pending</option><option value="payout_received">Payout received</option></select></label><label className="field"><span>Invoice</span><select value={form.invoice_status||'pending'} onChange={e=>field('invoice_status',e.target.value)}><option value="pending">Pending</option><option value="sent">Invoice sent</option></select></label></>}</div><label className="field"><span>Notes / feedback</span><textarea value={form.notes||''} onChange={e=>field('notes',e.target.value)}/></label></section>
     <section hidden={editorTab!=='settings'} className="cc814-share-box cc864-share-settings" aria-label="Update group and message details">
      <div className="cc864-section-heading"><span className="cc864-section-icon" aria-hidden="true">⚙</span><div><h3>Group & message details</h3><p>Keep the current group, or update the destination and message here.</p></div></div>
      <div className="cc864-settings-card">
       <label className="field"><span>Saved groups / numbers</span><select aria-label="Reuse saved WhatsApp destination" value="" onChange={e=>selectDestination(e.target.value)}><option value="">Choose previously used…</option>{savedDestinations.map(x=><option key={x.type+'|'+x.value} value={x.type+'|'+x.value}>{x.group_label||x.value} · {x.type==='group'?'Group':'Number'}</option>)}</select></label>
       <div className="cc864-destination-grid"><label className="field"><span>Send to</span><select aria-label="WhatsApp destination type" value={destinationType} onChange={e=>{setDestinationType(e.target.value);setDestination('');setGroupLabel('');setShareSettingsFeedback('');}}><option value="group">WhatsApp group</option><option value="number">WhatsApp number</option></select></label><label className="field"><span>{destinationType==='group'?'Group invite link':'WhatsApp number'}</span><input aria-label="WhatsApp destination" placeholder={destinationType==='group'?'https://chat.whatsapp.com/…':'10 digit number'} value={destination} onChange={e=>setDestination(e.target.value)}/></label></div>
       {destinationType==='group'&&<label className="field"><span>Group name</span><input aria-label="WhatsApp group name" value={groupLabel} maxLength={100} onChange={e=>setGroupLabel(e.target.value)} placeholder="Name this group"/></label>}
      </div>
      <div className="cc864-settings-card cc864-message-card">
       <label className="field"><span>Message template</span><textarea aria-label="Manager message template" value={messageTemplate} maxLength={4000} rows={10} onChange={e=>setMessageTemplate(e.target.value)}/></label>
       <div className="cc864-message-fields" aria-label="Insert candidate detail">{CC864_MESSAGE_FIELDS.map(key=><button type="button" key={key} onClick={()=>setMessageTemplate(value=>(value+' {'+key+'}').slice(0,4000))}>{'{'+key+'}'}</button>)}</div>
       <p className="cc864-field-help">Candidate details fill automatically using the fields in braces.</p>
       <button type="button" className="cc864-text-action" onClick={()=>setMessageTemplate(CC864_MESSAGE_TEMPLATE)}>Restore original message</button>
      </div>
      <div className="cc864-settings-actions"><button type="button" className="cc864-settings-save" disabled={busy||sharing} onClick={saveShareDetails}>{busy?'Saving…':manager?'Save team default':'Save my default'}</button><button type="button" className="cc864-secondary" onClick={()=>setEditorTab('share')}>Preview message ↗</button></div>
      {shareSettingsFeedback&&<p className="cc864-settings-feedback" role="status">{shareSettingsFeedback}</p>}
     </section>
     <section hidden={editorTab!=='share'} className="cc814-share-box cc864-inform-panel" aria-label="Inform to Manager">
      <div className="cc864-section-heading"><span className="cc864-section-icon" aria-hidden="true">↗</span><div><h3>Inform to Manager</h3><p>Inform to Manager shares the two attachments and message through your device.</p></div></div>
      <div className="cc864-destination-summary"><div><small>{destinationType==='group'?'WHATSAPP GROUP':'WHATSAPP NUMBER'}</small><strong>{groupLabel||destination||'Choose a destination'}</strong>{groupLabel&&<span>{destination}</span>}</div><button type="button" className="cc864-text-action" onClick={()=>setEditorTab('settings')}>Edit details</button></div>
      <div className="cc831-owner-strip"><span>Recruiter: {form.recruiter_name||user?.full_name}</span>{form.tl_name&&<span>Team lead: {form.tl_name}</span>}</div>
      <pre className="cc855-message-preview" role="button" tabIndex={0} title="Click to copy the WhatsApp message" aria-label="WhatsApp message preview: click to copy" onClick={copyMessage} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();void copyMessage();}}}>{draft.split(/(\*[^*\n]+\*)/g).map((piece,index)=>piece.startsWith('*')&&piece.endsWith('*')?<strong key={index}>{piece.slice(1,-1).replace(/\u2060/g,'')}</strong>:piece)}</pre>

      <section className="cc853-share-panel" aria-label="WhatsApp document attachment">
 <div className="cc853-share-heading"><strong>Attachments</strong></div>
 <div className="cc853-share-file-list" aria-live="polite">
  <div className="cc853-attached-file"><span className="cc853-file-symbol" aria-hidden="true">📄</span><div><b>{resume?.name||'No second attachment selected'}</b><small>{resume?fileSizeLabel(resume.size)+' · Temporary attachment ready':'Choose Attachment 2 above'}</small></div><span className={resume?'cc853-file-ready':'cc853-file-waiting'}>{resume?'Ready':'Not attached'}</span></div>
  {clientImage&&<div className="cc853-attached-file cc856-image-attached"><span className="cc853-file-symbol" aria-hidden="true">🖼️</span><div><b>{clientImage.name}</b><small>{fileSizeLabel(clientImage.size)} · Temporary attachment ready to share</small></div><span className="cc853-file-ready">Ready</span></div>}
 </div>
 <div className="cc853-share-buttons">
  {shareFollowUp==='image'&&clientImage&&<button type="button" className="cc856-share-fallback" disabled={busy||sharing} onClick={()=>shareFiles('image')}>🖼️ First attachment missing? Share first attachment separately ↗</button>}
  {shareFollowUp==='resume'&&resume&&<button type="button" className="cc856-share-fallback" disabled={busy||sharing} onClick={()=>shareFiles('resume')}>📄 Share PDF separately ↗</button>}
  {shareFollowUp==='separate'&&resume&&clientImage&&<>
   <button type="button" className="cc856-share-fallback" disabled={busy||sharing} onClick={()=>shareFiles('resume')}>📄 Share PDF separately ↗</button>
   <button type="button" className="cc856-share-fallback" disabled={busy||sharing} onClick={()=>shareFiles('image')}>🖼️ Share first attachment separately ↗</button>
  </>}
 </div>
 {shareHint&&<p className="cc851-group-hint" role="status">{shareHint}</p>}
 
 </section>
     </section>
    </main>
   </div>
   <footer><div className="cc864-footer-actions"><button type="button" className="cc864-inform" aria-pressed={editorTab==='share'} disabled={busy||sharing} onClick={()=>{setEditorTab('share');if(resume)void shareFiles('auto');else if(clientImage)void shareFiles('image');else inform();}}><span aria-hidden="true">↗</span> Inform to Manager</button><button type="button" className="cc861-save" disabled={busy||sharing} onClick={()=>save(false)}>{busy?'Saving…':'✓ Save candidate'}</button>{form.revenue_id&&<button type="button" className="cc871-add-another" disabled={busy||sharing} onClick={addAnother}>＋ Add another interview</button>}</div><span className="cc864-candidate-chip">{form.candidate_id||'Select a candidate'}</span></footer>
  </section>
 </div>,document.body)}
 </Layout>;
}
