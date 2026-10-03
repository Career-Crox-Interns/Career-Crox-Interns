import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const CRM_BOOT_WAIT_MS = 1200;

export default function PrivateRoute({ children }) {
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
