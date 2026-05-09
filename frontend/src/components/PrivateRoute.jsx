import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const CRM_BOOT_WAIT_MS = 4000;

export default function PrivateRoute({ children }) {
  const { user, booted } = useAuth();
  const location = useLocation();
  const [showBootCard, setShowBootCard] = useState(false);

  useEffect(() => {
    if (booted) return undefined;
    const timer = window.setTimeout(() => setShowBootCard(true), CRM_BOOT_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [booted]);

  if (!booted) {
    return showBootCard ? (
      <div className="auth-boot-fallback">
        <div className="panel">
          <div className="panel-title">Opening Career Crox...</div>
          <div className="helper-text top-gap-small">Checking login safely. If this stays here, hard refresh once.</div>
        </div>
      </div>
    ) : null;
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}
