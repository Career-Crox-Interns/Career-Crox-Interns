import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { canAccessFeature, resolveUserRole } from '../lib/roleAccess';

const CRM_BOOT_WAIT_MS = 1200;

export default function RoleRoute({ featureKey, children }) {
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
