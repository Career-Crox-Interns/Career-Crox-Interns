import React, { useLayoutEffect, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { applyPersonalSettings, readPersonalSettings } from '../lib/personalSettings';
import '../styles/genz-motion.css';
import { useLocation } from 'react-router-dom';

// CC888: restore popup owner and notes; retain the compact header and colours.
const COMPACT_WORKSPACE_CSS = `
@layer cc878-final {
  .cc887-compact .main-wrap > .topbar[data-cc886-header] {
    display:flex!important;flex-wrap:nowrap!important;align-items:center!important;
    gap:4px!important;padding:6px 8px!important;min-height:46px!important;
    height:auto!important;max-height:none!important;box-sizing:border-box!important;
  }
  .cc887-compact .topbar[data-cc886-header] .topbar-left {
    order:0!important;display:flex!important;align-items:center!important;
    flex:0 1 118px!important;min-width:100px!important;max-width:140px!important;
    width:auto!important;gap:5px!important;
  }
  .cc887-compact .topbar[data-cc886-header] .topbar-title {
    min-width:0!important;font-size:13px!important;line-height:1.25!important;
  }
  .cc887-compact .topbar[data-cc886-header] .cc875-switch-trigger {
    width:27px!important;min-width:27px!important;height:27px!important;
    min-height:27px!important;padding:3px!important;
  }
  .cc887-compact .topbar[data-cc886-header] .topbar-center {
    order:1!important;flex:0 0 28px!important;min-width:28px!important;
    width:28px!important;max-width:28px!important;padding:0!important;
  }
  .cc887-compact .topbar[data-cc886-header] .cc783-header-search,
  .cc887-compact .topbar[data-cc886-header] .cc783-header-search > button {
    width:28px!important;min-width:28px!important;height:28px!important;
    min-height:28px!important;padding:3px!important;
  }
  .cc887-compact .main-wrap > .topbar[data-cc886-header] .topbar-right {
    order:2!important;display:flex!important;flex:1 1 auto!important;
    justify-content:flex-end!important;align-items:center!important;
    flex-wrap:nowrap!important;gap:3px!important;min-width:0!important;
    width:auto!important;height:auto!important;min-height:30px!important;
    margin:0!important;padding:0!important;overflow:visible!important;
  }
  .cc887-compact .topbar[data-cc886-header] .topbar-right > * {
    flex-shrink:0!important;margin:0!important;
  }
  .cc887-compact .topbar[data-cc886-header] .topbar-right :is(.top-pill,.add-profile-btn) {
    width:auto!important;min-width:0!important;height:28px!important;
    min-height:28px!important;max-height:28px!important;
    padding:4px 5px!important;font-size:10.5px!important;line-height:1.2!important;
    gap:3px!important;white-space:nowrap!important;border-radius:8px!important;
  }
  .cc887-compact .topbar[data-cc886-header] .topbar-right .pill-count {
    min-width:12px!important;width:12px!important;height:12px!important;
    flex:0 0 12px!important;font-size:9px!important;line-height:12px!important;
  }
  .cc887-compact .topbar[data-cc886-header] .cc813-pair-shortcut {
    width:72px!important;min-width:72px!important;max-width:72px!important;
    flex:0 0 72px!important;height:28px!important;min-height:28px!important;
    padding:3px!important;font-size:10px!important;
  }
  .cc887-compact .topbar[data-cc886-header] .cc456-work-timer-pill {
    width:84px!important;min-width:84px!important;max-width:84px!important;
    flex:0 0 84px!important;height:32px!important;min-height:32px!important;
    max-height:32px!important;padding:2px 5px!important;gap:4px!important;
  }
  .cc887-compact .topbar[data-cc886-header] .cc456-label,
  .cc887-compact .topbar[data-cc886-header] .cc456-sub {
    font-size:7px!important;line-height:8px!important;margin:0!important;
  }
  .cc887-compact .topbar[data-cc886-header] .cc456-value {
    font-size:12px!important;line-height:13px!important;margin:0!important;
  }
  .cc887-compact .topbar[data-cc886-header] :is(.manual-dialer-top-icon,.cc790-addcandidate-top-icon) {
    width:28px!important;min-width:28px!important;max-width:28px!important;
    flex:0 0 28px!important;height:28px!important;min-height:28px!important;
    padding:3px!important;
  }
  .cc887-compact .topbar[data-cc886-header] .cc878-minimize-popups {
    width:24px!important;min-width:24px!important;height:28px!important;
    min-height:28px!important;padding:2px!important;
  }
  .cc887-compact .main-wrap > .topbar[data-cc886-header] .cc781-header-session {
    order:3!important;flex:0 0 150px!important;min-width:150px!important;
    max-width:150px!important;width:150px!important;margin:0!important;padding:0!important;
  }
  .cc887-compact .topbar[data-cc886-header] .cc781-header-session .user-chip {
    width:100%!important;min-width:0!important;min-height:34px!important;
    height:auto!important;padding:3px 5px!important;gap:5px!important;
  }
  .cc887-compact .topbar[data-cc886-header] .user-chip-copy {
    flex:1 1 auto!important;min-width:0!important;gap:1px!important;
  }
  .cc887-compact .topbar[data-cc886-header] .user-name {
    font-size:11px!important;line-height:1.25!important;white-space:normal!important;
    overflow:visible!important;overflow-wrap:anywhere!important;text-overflow:clip!important;
  }
  .cc887-compact .topbar[data-cc886-header] .user-role {
    font-size:9px!important;line-height:1.2!important;white-space:normal!important;
  }
  .cc887-compact .topbar[data-cc886-header] .logout-mini {
    min-height:25px!important;height:25px!important;padding:3px 5px!important;
    font-size:10px!important;
  }
  .cc887-compact .cc730-direct-reminder-deck {
    left:7px!important;right:auto!important;bottom:8px!important;
    width:min(190px,calc(100vw - 14px))!important;
    max-width:calc(100vw - 14px)!important;max-height:calc(100dvh - 16px)!important;
  }
  .cc887-compact .cc730-direct-reminder-deck .cc388-card {
    display:flex!important;flex-direction:column!important;gap:6px!important;
    padding:8px!important;min-height:0!important;height:auto!important;
    max-height:min(245px,calc(100dvh - 16px))!important;
    overflow:auto!important;border-radius:11px!important;
  }
  .cc887-compact .cc730-direct-reminder-deck .cc388-head {
    min-height:20px!important;gap:4px!important;flex-shrink:0!important;
  }
  .cc887-compact .cc730-direct-reminder-deck .cc388-label {
    min-width:0!important;padding:3px 5px!important;
    font-size:8.5px!important;line-height:1.2!important;letter-spacing:0!important;
  }
  .cc887-compact .cc730-direct-reminder-deck .cc388-head-actions {
    gap:3px!important;flex:0 0 auto!important;
  }
  .cc887-compact .cc730-direct-reminder-deck :is(.cc388-x,.cc878-deck-minimize) {
    width:18px!important;min-width:18px!important;height:18px!important;
    min-height:18px!important;padding:0!important;font-size:13px!important;
  }
  .cc887-compact .cc730-direct-reminder-deck .cc388-count {
    font-size:9px!important;padding:2px!important;
  }
  .cc887-compact .cc730-direct-reminder-deck .cc388-title {
    display:block!important;flex:0 0 auto!important;height:auto!important;
    min-height:17px!important;margin:0!important;font-size:12.5px!important;
    line-height:1.35!important;font-weight:700!important;white-space:normal!important;
    overflow:visible!important;overflow-wrap:anywhere!important;text-overflow:clip!important;
  }
  .cc887-compact .cc730-direct-reminder-deck .cc882-reminder-owner {
    display:grid!important;flex:0 0 auto!important;gap:3px!important;
    margin:0!important;min-height:0!important;
  }
  .cc887-compact .cc730-direct-reminder-deck .cc882-reminder-owner span {
    display:block!important;padding:3px 5px!important;font-size:10.5px!important;
    line-height:1.3!important;font-weight:600!important;white-space:normal!important;
    overflow-wrap:anywhere!important;
  }
  .cc887-compact .cc730-direct-reminder-deck .cc388-note {
    display:block!important;flex:0 1 auto!important;margin:0!important;
    padding:6px 7px!important;min-height:40px!important;max-height:76px!important;
    overflow:auto!important;white-space:normal!important;
    background:#fff!important;border:1px solid #cbd5e1!important;border-radius:8px!important;
  }
  .cc887-compact .cc730-direct-reminder-deck .cc388-note b {
    display:block!important;margin:0 0 3px!important;font-size:9px!important;
    line-height:1.2!important;font-weight:700!important;color:#475569!important;
    -webkit-text-fill-color:#475569!important;
  }
  .cc887-compact .cc730-direct-reminder-deck .cc388-note span {
    display:block!important;font-size:12px!important;line-height:1.4!important;
    font-weight:500!important;white-space:pre-wrap!important;overflow-wrap:anywhere!important;
    color:#172b45!important;-webkit-text-fill-color:#172b45!important;
  }
  .cc887-compact .cc730-direct-reminder-deck :is(.cc388-time,.cc388-preset-label) {
    display:none!important;
  }
  .cc887-compact .cc730-direct-reminder-deck .cc388-presets {
    display:grid!important;flex:0 0 auto!important;gap:3px!important;margin:0!important;
  }
  .cc887-compact .cc730-direct-reminder-deck .cc388-preset {
    min-width:0!important;height:23px!important;min-height:23px!important;
    padding:0 2px!important;font-size:10px!important;line-height:1.2!important;
  }
  @media(max-width:1100px) {
    .cc887-compact .main-wrap > .topbar[data-cc886-header] {flex-wrap:wrap!important;}
    .cc887-compact .topbar[data-cc886-header] .topbar-left {flex:1 1 auto!important;max-width:none!important;}
    .cc887-compact .main-wrap > .topbar[data-cc886-header] .topbar-right {
      order:4!important;flex:1 1 100%!important;flex-wrap:wrap!important;
    }
  }
}
@layer cc829 {
  html#cc787-workspace.cc887-compact:root[data-theme] body:not(.login-body):not(.cc-style15-login-body) .cc730-direct-reminder-deck .cc388-card[data-reminder-kind="interview"] {
    --cc836-ink:#793d0b!important;--cc785-reminder-ink:#793d0b!important;--accent:#ea8a23!important;--accent2:#ea8a23!important;
    background:linear-gradient(135deg,#fffaf2,#ffecd2)!important;
    border-color:#e99a43!important;border-left:4px solid #ea8a23!important;
  }
  html#cc787-workspace.cc887-compact:root[data-theme] body:not(.login-body):not(.cc-style15-login-body) .cc730-direct-reminder-deck .cc388-card[data-reminder-kind="interview"] .cc388-label {
    background:#e67d19!important;color:#fff!important;-webkit-text-fill-color:#fff!important;
  }
  html#cc787-workspace.cc887-compact:root[data-theme] body:not(.login-body):not(.cc-style15-login-body) .cc730-direct-reminder-deck .cc388-card[data-reminder-kind="feedback"] {
    --cc836-ink:#8b2434!important;--cc785-reminder-ink:#8b2434!important;--accent:#d34252!important;--accent2:#d34252!important;
    background:linear-gradient(135deg,#fff8f8,#ffe1e5)!important;
    border-color:#df7884!important;border-left:4px solid #d34252!important;
  }
  html#cc787-workspace.cc887-compact:root[data-theme] body:not(.login-body):not(.cc-style15-login-body) .cc730-direct-reminder-deck .cc388-card[data-reminder-kind="feedback"] .cc388-label {
    background:#c93548!important;color:#fff!important;-webkit-text-fill-color:#fff!important;
  }
}
`;

export function GlobalTextToneOverride() {
  useLayoutEffect(() => {
    document.getElementById('crm-global-text-tone-override')?.remove();
    document.documentElement.classList.add('cc887-compact');
    return () => document.documentElement.classList.remove('cc887-compact');
  }, []);
  return <style id="cc887-compact-workspace">{COMPACT_WORKSPACE_CSS}</style>;
}

export function PersonalSettingsBridge() {
  const { user, theme } = useAuth();
  const location = useLocation();
  useLayoutEffect(() => {
    document.documentElement.dataset.cc825Page = location.pathname.split('/')[1] || 'home';
  }, [location.pathname]);
  useLayoutEffect(() => {
    const apply = () => { if (user) applyPersonalSettings(readPersonalSettings(), theme, user.role); };
    apply();
    window.addEventListener('cc787-settings-changed', apply);
    const onStorage = event => {
      if (!event.key || event.key.startsWith('cc787:preferences:') ||
          ['careerCroxTheme', 'careerCroxCustomTheme', 'careerCroxCachedUser'].includes(event.key)) apply();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('cc787-settings-changed', apply);
      window.removeEventListener('storage', onStorage);
    };
  }, [user, theme]);
  return null;
}

export function GenZMotionLayer() {
  const location = useLocation();
  useEffect(() => {
    const body = document.body;
    body.classList.remove('cc-genz-motion-enabled');
    body.classList.remove('cc-no-morph-motion');
    body.classList.add('cc785-premium-motion');
    return () => body.classList.remove('cc785-premium-motion');
  }, []);
  useEffect(() => {
    const page = document.querySelector('.cc785-route-content');
    if (!page || document.documentElement.dataset.cc787Motion === 'reduced' ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const motion = page.animate(
      [{ transform: 'translateY(3px)' }, { transform: 'translateY(0)' }],
      { duration: 160, easing: 'cubic-bezier(.2,.7,.2,1)' }
    );
    return () => motion.cancel();
  }, [location.pathname]);
  return null;
}
