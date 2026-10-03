import { useLayoutEffect } from 'react';

const OVERRIDE_CSS = `
/* Runtime late-order text dullness override */
:root{
  --crm-text-strong-unified:#0b2a4a;
  --crm-text-primary-unified:#123b63;
  --crm-text-secondary-unified:#214f79;
  --crm-text-muted-unified:#2d587f;
}
body:not(.login-body) .main-wrap .panel-title,
body:not(.login-body) .main-wrap .table-title,
body:not(.login-body) .main-wrap .topbar-title,
body:not(.login-body) .main-wrap .field > label,
body:not(.login-body) .main-wrap .field label,
body:not(.login-body) .main-wrap .compact-shell-label,
body:not(.login-body) .main-wrap .table-select-heading,
body:not(.login-body) .main-wrap .theme-heading,
body:not(.login-body) .main-wrap .custom-theme-title,
body:not(.login-body) .main-wrap .reports-panel-title,
body:not(.login-body) .main-wrap .mail-title,
body:not(.login-body) .main-wrap .bda-title-lg,
body:not(.login-body) .main-wrap .jd-rule-title,
body:not(.login-body) .main-wrap .jd-section-title,
body:not(.login-body) .main-wrap .qa-task-card-title,
body:not(.login-body) .main-wrap .qa-file-name,
body:not(.login-body) .main-wrap .qa-dropzone strong,
body:not(.login-body) .main-wrap .crm-table thead th,
body:not(.login-body) .main-wrap .pti-table th,
body:not(.login-body) .main-wrap .pti-recruiter-table th,
body:not(.login-body) .main-wrap .reports-table th,
body:not(.login-body) .main-wrap .jd-card h3,
body:not(.login-body) .main-wrap .bda-box h3,
body:not(.login-body) .main-wrap .bda-result-title,
body:not(.login-body) .main-wrap .bda-db-card h4,
body:not(.login-body) .main-wrap .bda-activity-card h4{
  color:var(--crm-text-strong-unified) !important;
}
body:not(.login-body) .main-wrap .helper-text,
body:not(.login-body) .main-wrap .activity-sub,
body:not(.login-body) .main-wrap .subtle,
body:not(.login-body) .main-wrap .topbar-sub,
body:not(.login-body) .main-wrap .professional-hero-sub,
body:not(.login-body) .main-wrap .user-role,
body:not(.login-body) .main-wrap .user-code,
body:not(.login-body) .main-wrap .user-sub,
body:not(.login-body) .main-wrap .small-note,
body:not(.login-body) .main-wrap .footer-note,
body:not(.login-body) .main-wrap .group-title,
body:not(.login-body) .main-wrap .bda-sub,
body:not(.login-body) .main-wrap .bda-inline-note,
body:not(.login-body) .main-wrap .bda-meta-line,
body:not(.login-body) .main-wrap .bda-empty,
body:not(.login-body) .main-wrap .bda-box-head p,
body:not(.login-body) .main-wrap .mail-sub,
body:not(.login-body) .main-wrap .mail-mini,
body:not(.login-body) .main-wrap .mail-field label,
body:not(.login-body) .main-wrap .mail-card span,
body:not(.login-body) .main-wrap .mail-template-card small,
body:not(.login-body) .main-wrap .reports-mini-note,
body:not(.login-body) .main-wrap .reports-selection-note,
body:not(.login-body) .main-wrap .pti-mini-note,
body:not(.login-body) .main-wrap .qa-note,
body:not(.login-body) .main-wrap .qa-media-meta,
body:not(.login-body) .main-wrap .qa-task-card-sub,
body:not(.login-body) .main-wrap .qa-dropzone small,
body:not(.login-body) .main-wrap .qa-box ul,
body:not(.login-body) .main-wrap .crm-table tbody td .subtle,
body:not(.login-body) .main-wrap .crm-table tbody td .helper-text,
body:not(.login-body) .main-wrap .crm-table tbody td small{
  color:var(--crm-text-muted-unified) !important;
  opacity:1 !important;
}
body:not(.login-body) .main-wrap .crm-table tbody td,
body:not(.login-body) .main-wrap .field input,
body:not(.login-body) .main-wrap .field select,
body:not(.login-body) .main-wrap .field textarea,
body:not(.login-body) .main-wrap .inline-input,
body:not(.login-body) .main-wrap .search-box input,
body:not(.login-body) .main-wrap .mail-field input,
body:not(.login-body) .main-wrap .mail-field textarea,
body:not(.login-body) .main-wrap .mail-field select,
body:not(.login-body) .main-wrap .reports-field select,
body:not(.login-body) .main-wrap .reports-field input,
body:not(.login-body) .main-wrap .pti-field select,
body:not(.login-body) .main-wrap .pti-field input,
body:not(.login-body) .main-wrap .bda-box input,
body:not(.login-body) .main-wrap .bda-box select,
body:not(.login-body) .main-wrap .bda-box textarea,
body:not(.login-body) .main-wrap .bda-result-card input,
body:not(.login-body) .main-wrap .bda-result-card select,
body:not(.login-body) .main-wrap .bda-result-card textarea,
body:not(.login-body) .main-wrap .bda-db-card input,
body:not(.login-body) .main-wrap .bda-db-card select,
body:not(.login-body) .main-wrap .bda-db-card textarea{
  color:var(--crm-text-primary-unified) !important;
}
body:not(.login-body) .main-wrap .field input::placeholder,
body:not(.login-body) .main-wrap .field textarea::placeholder,
body:not(.login-body) .main-wrap .search-box input::placeholder,
body:not(.login-body) .main-wrap .mail-field input::placeholder,
body:not(.login-body) .main-wrap .mail-field textarea::placeholder,
body:not(.login-body) .main-wrap .bda-box input::placeholder,
body:not(.login-body) .main-wrap .bda-box textarea::placeholder,
body:not(.login-body) .main-wrap .bda-result-card input::placeholder,
body:not(.login-body) .main-wrap .bda-result-card textarea::placeholder,
body:not(.login-body) .main-wrap .bda-db-card input::placeholder,
body:not(.login-body) .main-wrap .bda-db-card textarea::placeholder{
  color:var(--crm-text-secondary-unified) !important;
  opacity:1 !important;
}
body:not(.login-body) .main-wrap .stat-card,
body:not(.login-body) .main-wrap .stat-card *,
body:not(.login-body) .main-wrap .action-card,
body:not(.login-body) .main-wrap .action-card *,
body:not(.login-body) .main-wrap .metric-card.colorful-card,
body:not(.login-body) .main-wrap .metric-card.colorful-card *,
body:not(.login-body) .main-wrap .metric-strip > div,
body:not(.login-body) .main-wrap .metric-strip > div *,
body:not(.login-body) .main-wrap .bucket-click-card,
body:not(.login-body) .main-wrap .bucket-click-card *,
body:not(.login-body) .main-wrap .revenue-journey-card,
body:not(.login-body) .main-wrap .revenue-journey-card *,
body:not(.login-body) .main-wrap .approval-strip-card,
body:not(.login-body) .main-wrap .approval-strip-card *{
  color:#ffffff !important;
}


/* CC26_151_RENDER_PRODUCTION_CARD_FIX
   Keeps the original premium gradient card look, only makes card height,
   padding and typography compact in production too. Render was loading older
   CSS order, so this runtime style is intentionally late and high-priority. */
body:not(.login-body) .main-wrap .bucket-card-grid,
body:not(.login-body) .main-wrap .task-summary-grid,
body:not(.login-body) .main-wrap .workflow-summary-grid,
body:not(.login-body) .main-wrap .attendance-card-grid,
body:not(.login-body) .main-wrap .activity-card-grid,
body:not(.login-body) .main-wrap .notification-summary-grid,
body:not(.login-body) .main-wrap .pipeline-summary-grid,
body:not(.login-body) .main-wrap .revenue-card-grid,
body:not(.login-body) .main-wrap .compact-lower-grid,
body:not(.login-body) .main-wrap .auto-stat-grid,
body:not(.login-body) .main-wrap .assistant-stat-grid,
body:not(.login-body) .main-wrap .master-stat-grid,
body:not(.login-body) .main-wrap .bda-stat-grid,
body:not(.login-body) .main-wrap .bda-summary-grid,
body:not(.login-body) .main-wrap .duplicate-summary-grid,
body:not(.login-body) .main-wrap .pti-card-grid{
  gap:10px !important;
}
@media (min-width:1181px){
  body:not(.login-body) .main-wrap .bucket-card-grid.bucket-card-grid-wide,
  body:not(.login-body) .main-wrap .bucket-card-grid{
    grid-template-columns:repeat(5,minmax(0,1fr)) !important;
  }
}
body:not(.login-body) .main-wrap button.stat-card,
body:not(.login-body) .main-wrap .stat-card.bucket-click-card,
body:not(.login-body) .main-wrap .metric-card.colorful-card,
body:not(.login-body) .main-wrap .metric-card.gradient-card,
body:not(.login-body) .main-wrap .attendance-metric-card,
body:not(.login-body) .main-wrap .task-summary-button,
body:not(.login-body) .main-wrap .clickable-summary-card,
body:not(.login-body) .main-wrap .revenue-journey-card,
body:not(.login-body) .main-wrap .pipeline-summary-card,
body:not(.login-body) .main-wrap .approval-strip-card,
body:not(.login-body) .main-wrap .duplicate-summary-card,
body:not(.login-body) .main-wrap .master-stat,
body:not(.login-body) .main-wrap .bda-stat-card,
body:not(.login-body) .main-wrap .assistant-stat-card,
body:not(.login-body) .main-wrap .auto-stat-match{
  min-height:74px !important;
  height:auto !important;
  padding:10px 12px !important;
  border-radius:17px !important;
  overflow:hidden !important;
  align-content:center !important;
}
body:not(.login-body) .main-wrap button.stat-card span,
body:not(.login-body) .main-wrap .stat-card.bucket-click-card span,
body:not(.login-body) .main-wrap .metric-card.colorful-card span,
body:not(.login-body) .main-wrap .metric-card.gradient-card span,
body:not(.login-body) .main-wrap .attendance-metric-card span,
body:not(.login-body) .main-wrap .task-summary-button span,
body:not(.login-body) .main-wrap .clickable-summary-card span,
body:not(.login-body) .main-wrap .revenue-journey-card span,
body:not(.login-body) .main-wrap .pipeline-summary-card span,
body:not(.login-body) .main-wrap .approval-strip-card span,
body:not(.login-body) .main-wrap .duplicate-summary-card span,
body:not(.login-body) .main-wrap .master-stat div,
body:not(.login-body) .main-wrap .bda-stat-card span,
body:not(.login-body) .main-wrap .assistant-stat-card span{
  font-size:12.5px !important;
  line-height:1.05 !important;
  font-weight:1000 !important;
  margin:0 !important;
}
body:not(.login-body) .main-wrap button.stat-card strong,
body:not(.login-body) .main-wrap .stat-card.bucket-click-card strong,
body:not(.login-body) .main-wrap .metric-card.colorful-card strong,
body:not(.login-body) .main-wrap .metric-card.gradient-card strong,
body:not(.login-body) .main-wrap .attendance-metric-card strong,
body:not(.login-body) .main-wrap .task-summary-button strong,
body:not(.login-body) .main-wrap .clickable-summary-card strong,
body:not(.login-body) .main-wrap .revenue-journey-card strong,
body:not(.login-body) .main-wrap .pipeline-summary-card strong,
body:not(.login-body) .main-wrap .approval-strip-card strong,
body:not(.login-body) .main-wrap .duplicate-summary-card strong,
body:not(.login-body) .main-wrap .master-stat b,
body:not(.login-body) .main-wrap .bda-stat-card strong,
body:not(.login-body) .main-wrap .bda-stat-card b,
body:not(.login-body) .main-wrap .assistant-stat-card strong,
body:not(.login-body) .main-wrap .stat-value{
  display:block !important;
  font-size:32px !important;
  line-height:.88 !important;
  margin:4px 0 2px !important;
  font-weight:1000 !important;
  letter-spacing:-.05em !important;
}
body:not(.login-body) .main-wrap button.stat-card small,
body:not(.login-body) .main-wrap .stat-card.bucket-click-card small,
body:not(.login-body) .main-wrap .metric-card.colorful-card small,
body:not(.login-body) .main-wrap .metric-card.gradient-card small,
body:not(.login-body) .main-wrap .attendance-metric-card small,
body:not(.login-body) .main-wrap .task-summary-button small,
body:not(.login-body) .main-wrap .clickable-summary-card small,
body:not(.login-body) .main-wrap .revenue-journey-card small,
body:not(.login-body) .main-wrap .pipeline-summary-card small,
body:not(.login-body) .main-wrap .approval-strip-card small,
body:not(.login-body) .main-wrap .duplicate-summary-card small,
body:not(.login-body) .main-wrap .master-stat small,
body:not(.login-body) .main-wrap .bda-stat-card small,
body:not(.login-body) .main-wrap .assistant-stat-card small{
  display:block !important;
  font-size:10px !important;
  line-height:1.08 !important;
  margin:0 !important;
  font-weight:900 !important;
  opacity:.95 !important;
  max-width:100% !important;
  white-space:nowrap !important;
  overflow:hidden !important;
  text-overflow:ellipsis !important;
}
body:not(.login-body) .main-wrap .top-gap,
body:not(.login-body) .main-wrap .top-gap-small{
  margin-top:10px !important;
}
@media (max-width:1180px){
  body:not(.login-body) .main-wrap button.stat-card,
  body:not(.login-body) .main-wrap .stat-card.bucket-click-card,
  body:not(.login-body) .main-wrap .metric-card.colorful-card,
  body:not(.login-body) .main-wrap .metric-card.gradient-card{
    min-height:70px !important;
  }
}

body:not(.login-body) .main-wrap .chat-theme-midnight-neon,
body:not(.login-body) .main-wrap .chat-theme-midnight-neon *,
body:not(.login-body) .main-wrap .chat-theme-midnight-luxe,
body:not(.login-body) .main-wrap .chat-theme-midnight-luxe *{
  color:#f5f7ff !important;
}

/* CC26_411_COPY_CLEANUP */
body:not(.login-body) .main-wrap .helper-text:empty,
body:not(.login-body) .main-wrap .subtle:empty,
body:not(.login-body) .main-wrap .small-note:empty,
body:not(.login-body) .main-wrap .footer-note:empty,
body:not(.login-body) .main-wrap .bda-sub:empty,
body:not(.login-body) .main-wrap .reports-mini-note:empty,
body:not(.login-body) .main-wrap .pti-mini-note:empty,
body:not(.login-body) .main-wrap .activity-sub:empty,
body:not(.login-body) .main-wrap .qa-note:empty,
body:not(.login-body) .main-wrap .mail-sub:empty{
  display:none !important;
  margin:0 !important;
  padding:0 !important;
}

/* CC26_448: requested slight readability lift. Keep layout compact; do not globally zoom the CRM. */
body:not(.login-body) .main-wrap{font-size:15px!important;}
body:not(.login-body) .main-wrap button,
body:not(.login-body) .main-wrap input,
body:not(.login-body) .main-wrap select,
body:not(.login-body) .main-wrap textarea{font-size:13.5px!important;}
body:not(.login-body) .main-wrap .crm-table thead th,
body:not(.login-body) .main-wrap .reports-table th,
body:not(.login-body) .main-wrap .pti-table th{font-size:12.5px!important;}
body:not(.login-body) .main-wrap .crm-table tbody td,
body:not(.login-body) .main-wrap .reports-table td,
body:not(.login-body) .main-wrap .pti-table td{font-size:13.5px!important;}
body:not(.login-body) .main-wrap .helper-text,
body:not(.login-body) .main-wrap .subtle,
body:not(.login-body) .main-wrap small{font-size:11px!important;}
body:not(.login-body) .main-wrap .panel-title,
body:not(.login-body) .main-wrap .table-title{font-size:16px!important;}

`;

export default function GlobalTextToneOverride() {
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const existing = document.getElementById('crm-global-text-tone-override');
    if (existing) existing.remove();
    const style = document.createElement('style');
    style.id = 'crm-global-text-tone-override';
    style.setAttribute('data-cc26-fix', '151-render-production-card-fix');
    style.textContent = OVERRIDE_CSS;
    document.body.appendChild(style);
    return () => {
      style.remove();
    };
  }, []);

  return null;
}
