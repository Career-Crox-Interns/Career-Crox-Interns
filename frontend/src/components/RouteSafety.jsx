// CC788: related modules consolidated; existing behavior preserved.
import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { canAccessFeature, resolveUserRole } from '../lib/roleAccess';
import { clearCareerCroxBrowserBloat } from '../lib/safeStorage';

// Preserved from components/PrivateRoute.jsx
const CRM_BOOT_WAIT_MS = 1200;

export function PrivateRoute({ children }) {
  const { user, booted } = useAuth();
  const location = useLocation();
  const isDialerProfileOpen = /(?:dialer_lock|next_profile|mobile_open|live_profile)=1/.test(String(location.search || ''));
  const [showBootCard, setShowBootCard] = useState(false);

  useEffect(() => {
    if (booted) return undefined;
    const timer = window.setTimeout(() => setShowBootCard(true), CRM_BOOT_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [booted]);

  if (!booted && user) return children;
  if (!booted) {
    return showBootCard ? (
      <div className="auth-boot-fallback">
        <div className="panel">
          <div className="panel-title">Opening your workspace...</div>
          <div className="helper-text top-gap-small">Securing your session and restoring the workspace.</div>
        </div>
      </div>
    ) : null;
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}

// Preserved from components/RoleRoute.jsx
export function RoleRoute({ featureKey, children }) {
  const { user, booted } = useAuth();
  const location = useLocation();
  const isDialerProfileOpen = /(?:dialer_lock|next_profile|mobile_open|live_profile)=1/.test(String(location.search || ''));
  const [showBootCard, setShowBootCard] = useState(false);

  useEffect(() => {
    if (booted) return undefined;
    const timer = window.setTimeout(() => setShowBootCard(true), CRM_BOOT_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [booted]);

  // Instant shell: a valid cached user must never wait for /api/auth/me before a slice renders.
  // Server auth validation continues in AuthProvider and can redirect only on confirmed 401.
  if (!booted && user) {
    if (!canAccessFeature(resolveUserRole(user), featureKey)) return <Navigate to="/candidates" replace />;
    return children;
  }
  if (!booted) {
    return showBootCard ? (
      <div className="auth-boot-fallback">
        <div className="panel">
          <div className="panel-title">Opening your workspace...</div>
          <div className="helper-text top-gap-small">Securing your session. Refresh once only if this screen stays open.</div>
        </div>
      </div>
    ) : null;
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (!canAccessFeature(resolveUserRole(user), featureKey)) return <Navigate to="/candidates" replace />;
  return children;
}

// Preserved from components/AppErrorBoundary.jsx
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

export class AppErrorBoundary extends React.Component {
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
    // A late response from the closed workspace must not trap logout on Retry Page.
    if (window.location.pathname !== '/login' && (window.__CC602_NETWORK_PAUSED__ || !localStorage.getItem('careerCroxCachedUser'))) {
      return <Navigate to="/login" replace />;
    }
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

// Preserved from components/SafeSectionBoundary.jsx
export class SafeSectionBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return { crashed: true, message: safeText(error?.message, 'Section render failed safely.') };
  }

  componentDidUpdate(prevProps) {
    if (this.state.crashed && prevProps?.resetKey !== this.props?.resetKey) {
      this.setState({ crashed: false, message: '' });
    }
  }

  componentDidCatch(error, info) {
    try {
      console.error('Career Crox safe section guard:', this.props?.title || 'section', error, info);
    } catch {}
  }

  reset = () => {
    this.setState({ crashed: false, message: '' });
  };

  render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="panel top-gap-small safe-section-fallback">
        <div className="panel-title">{this.props?.title || 'Section recovered'}</div>
        <div className="helper-text top-gap-small">This section was isolated safely. The rest of your workspace stays live.</div>
        {this.state.message ? <div className="helper-text top-gap-small">{this.state.message.slice(0, 160)}</div> : null}
        <button type="button" className="ghost-btn bounceable top-gap-small" onClick={this.reset}>Retry Section</button>
      </div>
    );
  }
}
