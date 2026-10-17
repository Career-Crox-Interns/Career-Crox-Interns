import React, { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { PrivateRoute as PrivateRoute } from './components/RouteSafety';
import { RoleRoute as RoleRoute } from './components/RouteSafety';

// Login stays separate; authenticated routes never wait for a new page import.
import DataBackupPage from './pages/DataBackupPage';
import SettingsPage from './pages/SettingsPage';
import WorkspaceToolsPage from './pages/WorkspaceToolsPage';
const LoginPage = lazy(() => import('./pages/LoginPage'));
import CandidatesPage from './pages/CandidatesPage';
import CandidateDetailPage from './pages/CandidateDetailPage';
import TasksPage from './pages/TasksPage';
import InterviewsPage from './pages/InterviewsPage';
import FollowUpsPage from './pages/FollowUpsPage';
import JDsPage from './pages/JDsPage';
import SubmissionsPage from './pages/SubmissionsPage';
import NotificationsPage from './pages/NotificationsPage';
import AttendancePage from './pages/AttendancePage';
import ReportsPage from './pages/ReportsPage';
import AdminPage from './pages/AdminPage';
import ChatPage from './pages/ChatPage';
import ClientPipelinePage from './pages/ClientPipelinePage';
import RevenueHubPage from './pages/RevenueHubPage';
import PerformancePage from './pages/PerformancePage';
import RecentActivityPage from './pages/RecentActivityPage';
import ApprovalsPage from './pages/ApprovalsPage';
import SearchPage from './pages/SearchPage';
import LearningHubPage from './pages/LearningHubPage';
import QuickAddPage from './pages/QuickAddPage';
import AariaPage from './pages/AariaPage';
import BucketOutPage from './pages/BucketOutPage';
import TeamScopeFlowchartPage from './pages/TeamScopeFlowchartPage';
import DailyInterviewFlowPage from './pages/DailyInterviewFlowPage';
import MailPage from './pages/MailPage';
import DuplicateProfilesPage from './pages/DuplicateProfilesPage';
import SemiHourlyReportPage from './pages/SemiHourlyReportPage';
import BDAHeadPage from './pages/BDAHeadPage';
import GoalPostPage from './pages/GoalPostPage';
import DisabledSlicesPage from './pages/DisabledSlicesPage';
import HotLeadsPage from './pages/HotLeadsPage';
import LiveDialingRoomPage from './pages/LiveDialingRoomPage';
import AutoDialerPage from './pages/AutoDialerPage';
import EgressControlPage from './pages/EgressControlPage';
import EmployeeFraudReportPage from './pages/EmployeeFraudReportPage';
import MobileAppPage from './pages/MobileAppPage';
import { PersonalSettingsBridge as PersonalSettingsBridge } from './components/WorkspaceAppearance';
import { GlobalTextToneOverride as GlobalTextToneOverride } from './components/WorkspaceAppearance';
import { AppErrorBoundary as AppErrorBoundary } from './components/RouteSafety';
import { GenZMotionLayer as GenZMotionLayer } from './components/WorkspaceAppearance';
import { PersistentWorkspaceShell } from './components/Layout';

// CC829: protected page components are prepared with the workspace.
// Navigation mounts its real controls immediately; data reads remain page-scoped.

function RouteOpeningFallback() {
  const location = useLocation();
  if (/^\/login(?:\/|$)/.test(location.pathname || '')) {
    return <div className="cc754-login-firstpaint" aria-hidden="true">
      <div className="cc754-login-firstpaint-left"><div className="cc754-login-logo-skeleton"/><div className="cc754-login-line lg"/><div className="cc754-login-line"/><div className="cc754-login-field"/><div className="cc754-login-field"/><div className="cc754-login-button"/></div>
      <div className="cc754-login-firstpaint-right"/>
    </div>;
  }
  return <div className="cc783-page-opening" role="status" aria-live="polite"><span className="cc783-loading-label">Opening page…</span><div className="cc783-skeleton-cards">{[1,2,3,4].map((n) => <div key={n}/>)}</div><div className="cc783-skeleton-table">{[1,2,3,4,5,6,7].map((n) => <div key={n}/>)}</div></div>;
}

function SmartFallback() {
  const { user, booted } = useAuth();
  if (!booted) return null;
  return <Navigate to={user ? '/candidates' : '/login'} replace />;
}

function WorkspaceFrame({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  return user && location.pathname !== '/login' ? <PersistentWorkspaceShell>{children}</PersistentWorkspaceShell> : <>{children}</>;
}
export default function App() {
  const location = useLocation();
  return (
    <>
      <GlobalTextToneOverride /><PersonalSettingsBridge />
      <GenZMotionLayer />
      <WorkspaceFrame>
      <AppErrorBoundary routeName={location.pathname}>
      <Suspense fallback={<RouteOpeningFallback />}>
      <Routes>
      <Route path="/data-backup" element={<RoleRoute featureKey="data-backup"><DataBackupPage /></RoleRoute>} />
      <Route path="/settings" element={<PrivateRoute><SettingsPage /></PrivateRoute>} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Navigate to="/candidates" replace />} />
      <Route path="/dashboard" element={<Navigate to="/candidates" replace />} />
      <Route path="/candidates" element={<PrivateRoute><CandidatesPage /></PrivateRoute>} />
      <Route path="/hot-leads" element={<RoleRoute featureKey="hot-leads"><HotLeadsPage /></RoleRoute>} />
      <Route path="/candidate/:candidateId" element={<PrivateRoute><CandidateDetailPage /></PrivateRoute>} />
      <Route path="/tasks" element={<PrivateRoute><TasksPage /></PrivateRoute>} />
      <Route path="/interviews" element={<PrivateRoute><InterviewsPage /></PrivateRoute>} />
      <Route path="/followups" element={<PrivateRoute><FollowUpsPage /></PrivateRoute>} />
      <Route path="/live-dialing" element={<PrivateRoute><LiveDialingRoomPage /></PrivateRoute>} />
      <Route path="/auto-dialer" element={<PrivateRoute><AutoDialerPage /></PrivateRoute>} />
      <Route path="/egress-control" element={<RoleRoute featureKey="egress-control"><EgressControlPage /></RoleRoute>} />
      <Route path="/employee-fraud-report" element={<RoleRoute featureKey="employee-fraud-report"><EmployeeFraudReportPage /></RoleRoute>} />
      <Route path="/mobile-app" element={<RoleRoute featureKey="mobile-app"><MobileAppPage /></RoleRoute>} />
      <Route path="/jds" element={<PrivateRoute><JDsPage /></PrivateRoute>} />
      <Route path="/submissions" element={<PrivateRoute><SubmissionsPage /></PrivateRoute>} />
      <Route path="/notifications" element={<PrivateRoute><NotificationsPage /></PrivateRoute>} />
      <Route path="/attendance" element={<RoleRoute featureKey="attendance"><AttendancePage /></RoleRoute>} />
      <Route path="/reports" element={<RoleRoute featureKey="reports"><ReportsPage /></RoleRoute>} />
      <Route path="/master-report" element={<Navigate to="/reports" replace />} />
      <Route path="/mail-centre" element={<RoleRoute featureKey="mail-centre"><MailPage /></RoleRoute>} />
      <Route path="/admin" element={<RoleRoute featureKey="admin-control"><AdminPage /></RoleRoute>} />
      <Route path="/chat" element={<PrivateRoute><ChatPage /></PrivateRoute>} />
      <Route path="/client-pipeline" element={<RoleRoute featureKey="client-pipeline"><ClientPipelinePage /></RoleRoute>} />
      <Route path="/revenue-hub" element={<RoleRoute featureKey="revenue-hub"><RevenueHubPage /></RoleRoute>} />
      <Route path="/performance-centre" element={<RoleRoute featureKey="performance-centre"><PerformancePage /></RoleRoute>} />
      <Route path="/recent-activity" element={<RoleRoute featureKey="recent-activity"><RecentActivityPage /></RoleRoute>} />
      <Route path="/approvals" element={<PrivateRoute><ApprovalsPage /></PrivateRoute>} />
      <Route path="/learning-hub" element={<RoleRoute featureKey="learning-hub"><LearningHubPage /></RoleRoute>} />
      <Route path="/search" element={<PrivateRoute><SearchPage /></PrivateRoute>} />
      <Route path="/quick-add" element={<PrivateRoute><QuickAddPage /></PrivateRoute>} />
      <Route path="/quick-add/candidate" element={<PrivateRoute><Navigate to="/candidate/new" replace /></PrivateRoute>} />
      <Route path="/quick-add/:kind" element={<PrivateRoute><QuickAddPage /></PrivateRoute>} />
      <Route path="/aaria" element={<PrivateRoute><AariaPage /></PrivateRoute>} />
      <Route path="/bucket-out" element={<RoleRoute featureKey="bucket"><BucketOutPage /></RoleRoute>} />
      <Route path="/flowchart" element={<RoleRoute featureKey="flowchart"><TeamScopeFlowchartPage /></RoleRoute>} />
      <Route path="/duplicate-profiles" element={<RoleRoute featureKey="duplicate-profiles"><DuplicateProfilesPage /></RoleRoute>} />
      <Route path="/daily-interview-workflow" element={<PrivateRoute><DailyInterviewFlowPage /></PrivateRoute>} />
      <Route path="/semi-hourly-report" element={<PrivateRoute><SemiHourlyReportPage /></PrivateRoute>} />
      <Route path="/disabled-slices" element={<RoleRoute featureKey="disabled-slices"><DisabledSlicesPage /></RoleRoute>} />
      <Route path="/data-extractor" element={<RoleRoute featureKey="data-extractor"><WorkspaceToolsPage /></RoleRoute>} />
      <Route path="/quality-analyst" element={<RoleRoute featureKey="quality-analyst"><WorkspaceToolsPage /></RoleRoute>} />
      <Route path="/bda" element={<RoleRoute featureKey="bda"><BDAHeadPage /></RoleRoute>} />
      <Route path="/bda-head" element={<RoleRoute featureKey="bda"><BDAHeadPage /></RoleRoute>} />
      <Route path="/hr-head" element={<RoleRoute featureKey="hr-head"><WorkspaceToolsPage /></RoleRoute>} />
      <Route path="/goal-post" element={<RoleRoute featureKey="goal-post"><GoalPostPage /></RoleRoute>} />
      <Route path="/prime-time-insights" element={<Navigate to="/reports" replace />} />
      <Route path="*" element={<SmartFallback />} />
      </Routes>
      </Suspense>
      </AppErrorBoundary>
      </WorkspaceFrame>
    </>
  );
}
