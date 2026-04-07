import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export default function PrivateRoute({ children }) {
  const { user, booted } = useAuth();
  const location = useLocation();
  if (!booted) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}
