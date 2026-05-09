import { useLayoutEffect } from 'react';

const OVERRIDE_CSS = `
/* Runtime late-order text dullness override */
:root{
  --crm-text-strong-unified:#17304d;
  --crm-text-primary-unified:#214066;
  --crm-text-secondary-unified:#3d5d87;
  --crm-text-muted-unified:#526c93;
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
body:not(.login-body) .main-wrap .chat-theme-midnight-neon,
body:not(.login-body) .main-wrap .chat-theme-midnight-neon *,
body:not(.login-body) .main-wrap .chat-theme-midnight-luxe,
body:not(.login-body) .main-wrap .chat-theme-midnight-luxe *{
  color:#f5f7ff !important;
}
`;

export default function GlobalTextToneOverride() {
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const existing = document.getElementById('crm-global-text-tone-override');
    if (existing) existing.remove();
    const style = document.createElement('style');
    style.id = 'crm-global-text-tone-override';
    style.textContent = OVERRIDE_CSS;
    document.body.appendChild(style);
    return () => {
      style.remove();
    };
  }, []);

  return null;
}
