import React, { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import PrivateRoute from './components/PrivateRoute';
import RoleRoute from './components/RoleRoute';
import GlobalTextToneOverride from './components/GlobalTextToneOverride';
import AppErrorBoundary from './components/AppErrorBoundary';
import GenZMotionLayer from './components/GenZMotionLayer';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const CandidatesPage = lazy(() => import('./pages/CandidatesPage'));
const CandidateDetailRoute = lazy(() => import('./pages/CandidateDetailRoute'));
const TasksPage = lazy(() => import('./pages/TasksPage'));
const InterviewsPage = lazy(() => import('./pages/InterviewsPage'));
const FollowUpsPage = lazy(() => import('./pages/FollowUpsPage'));
const SubmissionsPage = lazy(() => import('./pages/SubmissionsPage'));
const LiveDialingRoomPage = lazy(() => import('./pages/LiveDialingRoomPage'));
const AutoDialerPage = lazy(() => import('./pages/AutoDialerPage'));
const GoalPostPage = lazy(() => import('./pages/GoalPostPage'));
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage'));
const RecentActivityPage = lazy(() => import('./pages/RecentActivityPage'));
const BasicAdminPage = lazy(() => import('./pages/BasicAdminPage'));

function Opening() {
  return <div className="cc604-route-opening" role="status"><div className="cc604-route-opening-top"><strong>Career Crox</strong><span>Opening workspace…</span></div></div>;
}

function Fallback() {
  const { user, booted } = useAuth();
  if (!booted) return null;
  return <Navigate to={user ? '/candidates' : '/login'} replace />;
}

export default function App() {
  const location = useLocation();
  return <>
    <GlobalTextToneOverride />
    <GenZMotionLayer />
    <AppErrorBoundary routeName={location.pathname}>
      <Suspense fallback={<Opening />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<Navigate to="/candidates" replace />} />
          <Route path="/dashboard" element={<Navigate to="/candidates" replace />} />
          <Route path="/candidates" element={<PrivateRoute><CandidatesPage /></PrivateRoute>} />
          <Route path="/candidate/:candidateId" element={<PrivateRoute><CandidateDetailRoute /></PrivateRoute>} />
          <Route path="/tasks" element={<PrivateRoute><TasksPage /></PrivateRoute>} />
          <Route path="/interviews" element={<PrivateRoute><InterviewsPage /></PrivateRoute>} />
          <Route path="/followups" element={<PrivateRoute><FollowUpsPage /></PrivateRoute>} />
          <Route path="/submissions" element={<PrivateRoute><SubmissionsPage /></PrivateRoute>} />
          <Route path="/live-dialing" element={<PrivateRoute><LiveDialingRoomPage /></PrivateRoute>} />
          <Route path="/auto-dialer" element={<PrivateRoute><AutoDialerPage /></PrivateRoute>} />
          <Route path="/goal-post" element={<RoleRoute featureKey="goal-post"><GoalPostPage /></RoleRoute>} />
          <Route path="/approvals" element={<RoleRoute featureKey="approvals"><ApprovalsPage /></RoleRoute>} />
          <Route path="/recent-activity" element={<RoleRoute featureKey="recent-activity"><RecentActivityPage /></RoleRoute>} />
          <Route path="/admin" element={<RoleRoute featureKey="admin-control"><BasicAdminPage /></RoleRoute>} />
          <Route path="*" element={<Fallback />} />
        </Routes>
      </Suspense>
    </AppErrorBoundary>
  </>;
}
