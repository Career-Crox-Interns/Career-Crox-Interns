import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './lib/auth';

function showBootFailure(message = 'CRM boot failed safely.') {
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
  try { document.body.classList.add('app-ready'); } catch {}
} catch (error) {
  showBootFailure(error?.message || 'CRM boot failed safely.');
}
