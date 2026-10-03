import React from 'react';
import { clearCareerCroxBrowserBloat } from '../lib/safeStorage';

function safeText(value, fallback = '') {
  try {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    return JSON.stringify(value) || fallback;
  } catch {
    return fallback;
  }
}

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false, message: '', crashKey: '', autoRetrying: false };
  }

  static getDerivedStateFromError(error) {
    return {
      crashed: true,
      message: safeText(error?.message, 'Page render failed safely.'),
      crashKey: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };
  }

  componentDidUpdate(prevProps) {
    if (this.state.crashed && prevProps?.routeName !== this.props?.routeName) {
      this.setState({ crashed: false, message: '', crashKey: '' });
    }
  }

  componentDidCatch(error, info) {
    try {
      console.error('Career Crox route safety guard:', {
        route: this.props?.routeName || window.location.pathname,
        error,
        info,
      });
      const payload = {
        route: this.props?.routeName || window.location.pathname,
        message: safeText(error?.message, 'Route crash blocked'),
        at: new Date().toISOString(),
      };
      window.sessionStorage.setItem('careerCroxLastRouteCrash', JSON.stringify(payload));
      const routeKey = `careerCroxRouteAutoRecovered:${payload.route || 'route'}`;
      const alreadyTried = window.sessionStorage.getItem(routeKey);
      if (!alreadyTried) {
        window.sessionStorage.setItem(routeKey, '1');
        clearCareerCroxBrowserBloat({ aggressive: true });
        window.setTimeout(() => this.setState({ crashed: false, message: '', crashKey: '', autoRetrying: false }), 40);
      }
    } catch {}
  }

  resetHere = () => {
    try { clearCareerCroxBrowserBloat({ aggressive: true }); } catch {}
    this.setState({ crashed: false, message: '', crashKey: '' });
  };

  render() {
    if (!this.state.crashed) return this.props.children;
    const message = safeText(this.state.message, 'A temporary CRM page issue was blocked safely.');
    return (
      <div style={{ minHeight: '100vh', padding: 24, background: 'linear-gradient(135deg,#eef6ff 0%,#f8fbff 48%,#fff7ed 100%)', color: '#172033', fontFamily: 'Inter, system-ui, Arial, sans-serif' }}>
        <div style={{ maxWidth: 760, margin: '48px auto', background: 'rgba(255,255,255,.92)', border: '1px solid rgba(59,130,246,.18)', borderRadius: 28, padding: 28, boxShadow: '0 34px 90px rgba(15, 23, 42, 0.16)', backdropFilter: 'blur(18px)' }}>
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 0.8, textTransform: 'uppercase', color: '#6b7280' }}>Career Crox Recovery Mode</div>
          <h1 style={{ margin: '8px 0 8px', fontSize: 28, lineHeight: 1.15 }}>CRM Recovery Mode</h1>
          <p style={{ margin: '0 0 10px', color: '#4b5563', lineHeight: 1.6 }}>A temporary workspace issue was isolated safely. Retry the page to continue.</p>
          <p style={{ margin: '0 0 18px', color: '#6b7280', fontSize: 13, lineHeight: 1.5 }}>Detail: {message.slice(0, 180)}</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button type="button" onClick={this.resetHere} style={{ border: 0, borderRadius: 14, padding: '11px 16px', fontWeight: 800, background: 'linear-gradient(135deg,#2563eb,#7c3aed)', color: '#fff', cursor: 'pointer' }}>Retry This Page</button>
            <button type="button" onClick={() => { window.location.href = '/candidates'; }} style={{ border: '1px solid #d1d5db', borderRadius: 14, padding: '11px 16px', fontWeight: 800, background: '#fff', color: '#111827', cursor: 'pointer' }}>Back to Candidates</button>
            <button type="button" onClick={() => { try { clearCareerCroxBrowserBloat({ aggressive: true }); } catch {} window.location.reload(); }} style={{ border: '1px solid #d1d5db', borderRadius: 14, padding: '11px 16px', fontWeight: 800, background: '#fff', color: '#111827', cursor: 'pointer' }}>Clear Cache + Reload</button>
          </div>
        </div>
      </div>
    );
  }
}
