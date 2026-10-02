import React, { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import PrivateRoute from './components/PrivateRoute';
import RoleRoute from './components/RoleRoute';

// CC26_389: route-level code splitting remains enabled; same-tab profile and glass reminder upgrades do not remove any CRM page/module.
const LoginPage = lazy(() => import('./pages/LoginPage'));
const CandidatesPage = lazy(() => import('./pages/CandidatesPage'));
const CandidateDetailRoute = lazy(() => import('./pages/CandidateDetailRoute'));
const TasksPage = lazy(() => import('./pages/TasksPage'));
const InterviewsPage = lazy(() => import('./pages/InterviewsPage'));
const FollowUpsPage = lazy(() => import('./pages/FollowUpsPage'));
const JDsPage = lazy(() => import('./pages/JDsPage'));
const SubmissionsPage = lazy(() => import('./pages/SubmissionsPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const AttendancePage = lazy(() => import('./pages/AttendancePage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const ClientPipelinePage = lazy(() => import('./pages/ClientPipelinePage'));
const RevenueHubPage = lazy(() => import('./pages/RevenueHubPage'));
const PerformancePage = lazy(() => import('./pages/PerformancePage'));
const RecentActivityPage = lazy(() => import('./pages/RecentActivityPage'));
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const LearningHubPage = lazy(() => import('./pages/LearningHubPage'));
const QuickAddPage = lazy(() => import('./pages/QuickAddPage'));
const AariaPage = lazy(() => import('./pages/AariaPage'));
const BucketOutPage = lazy(() => import('./pages/BucketOutPage'));
const TeamScopeFlowchartPage = lazy(() => import('./pages/TeamScopeFlowchartPage'));
const DailyInterviewFlowPage = lazy(() => import('./pages/DailyInterviewFlowPage'));
const MailPage = lazy(() => import('./pages/MailPage'));
const DuplicateProfilesPage = lazy(() => import('./pages/DuplicateProfilesPage'));
const SemiHourlyReportPage = lazy(() => import('./pages/SemiHourlyReportPage'));
const BDAHeadPage = lazy(() => import('./pages/BDAHeadPage'));
const GoalPostPage = lazy(() => import('./pages/GoalPostPage'));
const DisabledSlicesPage = lazy(() => import('./pages/DisabledSlicesPage'));
const HotLeadsPage = lazy(() => import('./pages/HotLeadsPage'));
const LiveDialingRoomPage = lazy(() => import('./pages/LiveDialingRoomPage'));
const AutoDialerPage = lazy(() => import('./pages/AutoDialerPage'));
const EgressControlPage = lazy(() => import('./pages/EgressControlPage'));
const EmployeeFraudReportPage = lazy(() => import('./pages/EmployeeFraudReportPage'));
const MobileAppPage = lazy(() => import('./pages/MobileAppPage'));
import GlobalTextToneOverride from './components/GlobalTextToneOverride';
import AppErrorBoundary from './components/AppErrorBoundary';
import GenZMotionLayer from './components/GenZMotionLayer';

// CC26_604: user-intent-only route prefetch. Downloads static Render JS, never queries Supabase.
// Existing lazy chunks remain separate, so the CRM does NOT download all pages on login.
const USER_INTENT_ROUTE_MODULES = {
  '/candidates': () => import('./pages/CandidatesPage'),
  '/tasks': () => import('./pages/TasksPage'),
  '/interviews': () => import('./pages/InterviewsPage'),
  '/followups': () => import('./pages/FollowUpsPage'),
  '/jds': () => import('./pages/JDsPage'),
  '/submissions': () => import('./pages/SubmissionsPage'),
  '/notifications': () => import('./pages/NotificationsPage'),
  '/attendance': () => import('./pages/AttendancePage'),
  '/reports': () => import('./pages/ReportsPage'),
  '/admin': () => import('./pages/AdminPage'),
  '/chat': () => import('./pages/ChatPage'),
  '/client-pipeline': () => import('./pages/ClientPipelinePage'),
  '/revenue-hub': () => import('./pages/RevenueHubPage'),
  '/performance-centre': () => import('./pages/PerformancePage'),
  '/recent-activity': () => import('./pages/RecentActivityPage'),
  '/approvals': () => import('./pages/ApprovalsPage'),
  '/learning-hub': () => import('./pages/LearningHubPage'),
  '/search': () => import('./pages/SearchPage'),
  '/quick-add': () => import('./pages/QuickAddPage'),
  '/aaria': () => import('./pages/AariaPage'),
  '/bucket-out': () => import('./pages/BucketOutPage'),
  '/flowchart': () => import('./pages/TeamScopeFlowchartPage'),
  '/daily-interview-workflow': () => import('./pages/DailyInterviewFlowPage'),
  '/mail-centre': () => import('./pages/MailPage'),
  '/duplicate-profiles': () => import('./pages/DuplicateProfilesPage'),
  '/semi-hourly-report': () => import('./pages/SemiHourlyReportPage'),
  '/bda': () => import('./pages/BDAHeadPage'),
  '/goal-post': () => import('./pages/GoalPostPage'),
  '/hot-leads': () => import('./pages/HotLeadsPage'),
  '/live-dialing': () => import('./pages/LiveDialingRoomPage'),
  '/auto-dialer': () => import('./pages/AutoDialerPage'),
  '/egress-control': () => import('./pages/EgressControlPage'),
  '/mobile-app': () => import('./pages/MobileAppPage'),
  '/candidate': () => import('./pages/CandidateDetailRoute'),
};
const routePreloadInFlight = new Set();

function RouteOpeningFallback() {
  const location = useLocation();
  if (/^\/login(?:\/|$)/.test(location.pathname || '')) {
    return <div className="cc754-login-firstpaint" aria-hidden="true">
      <div className="cc754-login-firstpaint-left"><div className="cc754-login-logo-skeleton"/><div className="cc754-login-line lg"/><div className="cc754-login-line"/><div className="cc754-login-field"/><div className="cc754-login-field"/><div className="cc754-login-button"/></div>
      <div className="cc754-login-firstpaint-right"/>
    </div>;
  }
  if (/^\/chat(?:\/|$)/.test(location.pathname || '')) {
    return <div className="cc754-chat-firstpaint" aria-hidden="true">
      <div className="cc754-chat-side"><div/><div/><div/><div/><div/></div>
      <div className="cc754-chat-centre"><div className="cc754-chat-head"/><div className="cc754-chat-feed"><i/><i/><i/></div><div className="cc754-chat-compose"/></div>
      <div className="cc754-chat-info"><div/><div/><div/></div>
    </div>;
  }
  return <div className="cc604-route-opening" role="status" aria-live="polite">
    <div className="cc604-route-opening-top"><strong>Career Crox</strong><span>Opening workspace…</span></div>
    <div className="cc604-route-opening-body"><div className="cc604-route-opening-menu"/><div className="cc604-route-opening-main"><div/><div/><div/></div></div>
  </div>;
}

function SmartFallback() {
  const { user, booted } = useAuth();
  if (!booted) return null;
  return <Navigate to={user ? '/candidates' : '/login'} replace />;
}

export default function App() {
  const location = useLocation();
  useEffect(() => {
    const preloadOnIntent = (event) => {
      if (window.__CC602_NETWORK_PAUSED__ || document.hidden || navigator.connection?.saveData) return;
      const anchor = event.target?.closest?.('a[href]');
      if (!anchor) return;
      let path;
      try {
        const url = new URL(anchor.href, window.location.href);
        if (url.origin !== window.location.origin) return;
        path = url.pathname.startsWith('/candidate/') ? '/candidate' : url.pathname;
        if (path.startsWith('/quick-add/')) path = '/quick-add';
      } catch { return; }
      const load = USER_INTENT_ROUTE_MODULES[path];
      if (!load || routePreloadInFlight.has(path) || location.pathname === path) return;
      routePreloadInFlight.add(path);
      load().catch(() => routePreloadInFlight.delete(path));
    };
    document.addEventListener('pointerover', preloadOnIntent, { passive: true });
    document.addEventListener('focusin', preloadOnIntent, { passive: true });
    document.addEventListener('touchstart', preloadOnIntent, { passive: true });
    return () => {
      document.removeEventListener('pointerover', preloadOnIntent);
      document.removeEventListener('focusin', preloadOnIntent);
      document.removeEventListener('touchstart', preloadOnIntent);
    };
  }, [location.pathname]);
  return (
    <>
      <GlobalTextToneOverride />
      <GenZMotionLayer />
      <AppErrorBoundary routeName={location.pathname}>
      <Suspense fallback={<RouteOpeningFallback />}>
      <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Navigate to="/candidates" replace />} />
      <Route path="/dashboard" element={<Navigate to="/candidates" replace />} />
      <Route path="/candidates" element={<PrivateRoute><CandidatesPage /></PrivateRoute>} />
      <Route path="/hot-leads" element={<RoleRoute featureKey="hot-leads"><HotLeadsPage /></RoleRoute>} />
      <Route path="/candidate/:candidateId" element={<PrivateRoute><CandidateDetailRoute /></PrivateRoute>} />
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
      <Route path="/data-extractor" element={<RoleRoute featureKey="data-extractor"><DisabledSlicesPage /></RoleRoute>} />
      <Route path="/quality-analyst" element={<RoleRoute featureKey="quality-analyst"><DisabledSlicesPage /></RoleRoute>} />
      <Route path="/bda" element={<RoleRoute featureKey="bda"><BDAHeadPage /></RoleRoute>} />
      <Route path="/bda-head" element={<RoleRoute featureKey="bda"><BDAHeadPage /></RoleRoute>} />
      <Route path="/hr-head" element={<RoleRoute featureKey="hr-head"><DisabledSlicesPage /></RoleRoute>} />
      <Route path="/goal-post" element={<RoleRoute featureKey="goal-post"><GoalPostPage /></RoleRoute>} />
      <Route path="/prime-time-insights" element={<Navigate to="/reports" replace />} />
      <Route path="*" element={<SmartFallback />} />
      </Routes>
      </Suspense>
      </AppErrorBoundary>
    </>
  );
}
