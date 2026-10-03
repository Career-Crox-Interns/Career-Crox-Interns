import React from 'react';
import { installCrmIstLocaleGuard } from './lib/timeFormat';

function installCareerCroxReactNoCrashGuard() {
  try {
    if (React.__careerCroxNoCrashGuardInstalled) return;
    const originalCreateElement = React.createElement;
    const reactElementType = Symbol.for('react.element');
    const portalType = Symbol.for('react.portal');

    function safeChild(value, depth = 0) {
      if (depth > 4) return '';
      if (value === null || value === undefined || typeof value === 'boolean') return value;
      if (typeof value === 'string' || typeof value === 'number') return value;
      if (typeof value === 'bigint') return String(value);
      if (Array.isArray(value)) return value.map((item) => safeChild(item, depth + 1));
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toLocaleString();
      if (typeof value === 'object') {
        if (value.$$typeof === reactElementType || value.$$typeof === portalType) return value;
        try {
          if (value.message && Object.keys(value).length <= 4) return String(value.message);
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      }
      return String(value);
    }

    React.createElement = function careerCroxSafeCreateElement(type, props, ...children) {
      // No-cost fast path for the common React case: JSX elements/primitive children
      // never need the legacy unexpected-object recovery. Preserve that guard for bad payloads.
      if (!children.length) return originalCreateElement.call(this, type, props);
      if (children.every((child) => child === null || child === undefined || typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean' || (child && (child.$$typeof === reactElementType || child.$$typeof === portalType)))) {
        return originalCreateElement.call(this, type, props, ...children);
      }
      return originalCreateElement.call(this, type, props, ...children.map((child) => safeChild(child)));
    };
    Object.defineProperty(React, '__careerCroxNoCrashGuardInstalled', { value: true, configurable: true });
  } catch {}
}

installCrmIstLocaleGuard();
installCareerCroxReactNoCrashGuard();

import { installCareerCroxStorageGuard } from './lib/safeStorage';
if (typeof document !== 'undefined') document.documentElement.classList.add('cc26-no-page-zoom');
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './lib/auth';

installCareerCroxStorageGuard();

function showBootFailure(message = 'CRM boot failed safely.') {
  // CC26_373_BOOT_VISIBILITY_FIX: never keep the CRM root hidden when boot recovery is needed.
  try {
    document.body.classList.add('app-ready');
    const rootEl = document.getElementById('root');
    rootEl?.classList?.remove('react-hidden-until-ready');
  } catch {}

  try {
    const root = document.getElementById('root') || document.body;
    root.innerHTML = `<div style="min-height:100vh;padding:24px;background:#f7f8fc;color:#172033;font-family:Inter,system-ui,Arial,sans-serif"><div style="max-width:760px;margin:48px auto;background:#fff;border:1px solid #e5e8f0;border-radius:22px;padding:24px;box-shadow:0 18px 45px rgba(15,23,42,.08)"><div style="font-size:13px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:#6b7280">Career Crox Safety Guard</div><h1 style="margin:8px 0;font-size:28px">CRM recovered safely</h1><p style="color:#4b5563;line-height:1.6">${String(message).replace(/[<>&]/g, '')}</p><button onclick="window.location.reload()" style="border:0;border-radius:14px;padding:11px 16px;font-weight:800;background:#111827;color:#fff;cursor:pointer">Reload CRM</button></div></div>`;
  } catch {}
}

if (typeof window !== 'undefined') {
  window.__CAREER_CROX_SAFE_MODE__ = true;
  window.addEventListener('error', (event) => {
    try {
      console.error('Career Crox global UI error:', event?.error || event?.message || event);
      window.dispatchEvent(new CustomEvent('career-crox-global-error', { detail: { message: event?.message || 'UI error blocked.' } }));
    } catch {}
  });
  window.addEventListener('unhandledrejection', (event) => {
    try {
      const reason = event?.reason;
      console.error('Career Crox blocked unhandled promise:', reason);
      window.dispatchEvent(new CustomEvent('career-crox-global-error', { detail: { message: reason?.message || 'Background action failed safely.' } }));
    } catch {}
  });
}

try {
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('Root element missing.');
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </React.StrictMode>,
  );
  try {
    const markReady = () => {
      try {
        document.body.classList.add('app-ready');
        window.__CC_REACT_READY = 'CC26_466';
        window.dispatchEvent(new CustomEvent('career-crox-react-ready'));
      } catch {}
      const loadReminder = () => import('./lib/compactReminderRuntime')
        .then((mod) => mod.installCompactReminderRuntime?.())
        .catch(() => {});
      if ('requestIdleCallback' in window) window.requestIdleCallback(loadReminder, { timeout: 1600 });
      else window.setTimeout(loadReminder, 350);
    };
    // A browser may throttle requestAnimationFrame in a background tab. The CRM
    // is ready only after React actually replaces the static shell with real UI.
    const isMounted = () => {
      const first = rootEl.firstElementChild;
      return Boolean(first && !first.matches('.cc459-shell,.cc459-source-shell,.cc717-safety-guard'));
    };
    let signaled = false;
    const onMount = () => {
      if (signaled || !isMounted()) return;
      signaled = true;
      observer.disconnect();
      markReady();
    };
    const observer = new MutationObserver(onMount);
    observer.observe(rootEl, { childList: true });
    queueMicrotask(onMount);
    window.setTimeout(onMount, 0);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(onMount);
  } catch {}
} catch (error) {
  showBootFailure(error?.message || 'CRM boot failed safely.');
}
