import React, { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { PrivateRoute as PrivateRoute } from './components/RouteSafety';
import { RoleRoute as RoleRoute } from './components/RouteSafety';

const routeLoaders = new Map();
function deferredPage(paths, loader) {
  let pending;
  const load = () => pending || (pending = loader().catch(error => { pending = null; throw error; }));
  for (const path of paths) routeLoaders.set(path, load);
  return lazy(load);
}
const DataBackupPage = deferredPage(['/data-backup'], () => import('./pages/DataBackupPage'));
const SettingsPage = deferredPage(['/settings'], () => import('./pages/SettingsPage'));
const WorkspaceToolsPage = deferredPage(['/data-extractor','/quality-analyst','/hr-head'], () => import('./pages/WorkspaceToolsPage'));
const LoginPage = deferredPage(['/login'], () => import('./pages/LoginPage'));
const CandidatesPage = deferredPage(['/candidates'], () => import('./pages/CandidatesPage'));
const CandidateDraftsPage = deferredPage(['/candidate-drafts'], () => import('./pages/CandidateDraftsPage'));
const ProfileSafetyPage = deferredPage(['/profile-safety'], () => import('./pages/ProfileSafetyPage'));
const CandidateDetailPage = deferredPage(['/candidate'], () => import('./pages/CandidateDetailPage'));
const TasksPage = deferredPage(['/tasks'], () => import('./pages/TasksPage'));
const InterviewsPage = deferredPage(['/interviews'], () => import('./pages/InterviewsPage'));
const FollowUpsPage = deferredPage(['/followups'], () => import('./pages/FollowUpsPage'));
const JDsPage = deferredPage(['/jds'], () => import('./pages/JDsPage'));
const SubmissionsPage = deferredPage(['/submissions'], () => import('./pages/SubmissionsPage'));
const NotificationsPage = deferredPage(['/notifications'], () => import('./pages/NotificationsPage'));
const AttendancePage = deferredPage(['/attendance'], () => import('./pages/AttendancePage'));
const ReportsPage = deferredPage(['/reports'], () => import('./pages/ReportsPage'));
const AdminPage = deferredPage(['/admin'], () => import('./pages/AdminPage'));
const ChatPage = deferredPage(['/chat'], () => import('./pages/ChatPage'));
const ClientPipelinePage = deferredPage(['/client-pipeline'], () => import('./pages/ClientPipelinePage'));
const RevenueHubPage = deferredPage(['/revenue-hub'], () => import('./pages/RevenueHubPage'));
const PerformancePage = deferredPage(['/performance-centre'], () => import('./pages/PerformancePage'));
const RecentActivityPage = deferredPage(['/recent-activity'], () => import('./pages/RecentActivityPage'));
const ApprovalsPage = deferredPage(['/approvals'], () => import('./pages/ApprovalsPage'));
const SearchPage = deferredPage(['/search'], () => import('./pages/SearchPage'));
const LearningHubPage = deferredPage(['/learning-hub'], () => import('./pages/LearningHubPage'));
const QuickAddPage = deferredPage(['/quick-add','/quick-add/:kind'], () => import('./pages/QuickAddPage'));
const AariaPage = deferredPage(['/aaria'], () => import('./pages/AariaPage'));
const BucketOutPage = deferredPage(['/bucket-out'], () => import('./pages/BucketOutPage'));
const TeamScopeFlowchartPage = deferredPage(['/flowchart'], () => import('./pages/TeamScopeFlowchartPage'));
const DailyInterviewFlowPage = deferredPage(['/daily-interview-workflow'], () => import('./pages/DailyInterviewFlowPage'));
const MailPage = deferredPage(['/mail-centre'], () => import('./pages/MailPage'));
const DuplicateProfilesPage = deferredPage(['/duplicate-profiles'], () => import('./pages/DuplicateProfilesPage'));
const SemiHourlyReportPage = deferredPage(['/semi-hourly-report'], () => import('./pages/SemiHourlyReportPage'));
const BDAHeadPage = deferredPage(['/bda','/bda-head'], () => import('./pages/BDAHeadPage'));
const GoalPostPage = deferredPage(['/goal-post'], () => import('./pages/GoalPostPage'));
const DisabledSlicesPage = deferredPage(['/disabled-slices'], () => import('./pages/DisabledSlicesPage'));
const HotLeadsPage = deferredPage(['/hot-leads'], () => import('./pages/HotLeadsPage'));
const LiveDialingRoomPage = deferredPage(['/live-dialing'], () => import('./pages/LiveDialingRoomPage'));
const AutoDialerPage = deferredPage(['/auto-dialer'], () => import('./pages/AutoDialerPage'));
const EgressControlPage = deferredPage(['/egress-control'], () => import('./pages/EgressControlPage'));
const EmployeeFraudReportPage = deferredPage(['/employee-fraud-report'], () => import('./pages/EmployeeFraudReportPage'));
const MobileAppPage = deferredPage(['/mobile-app'], () => import('./pages/MobileAppPage'));
import { PersonalSettingsBridge as PersonalSettingsBridge } from './components/WorkspaceAppearance';
import { GlobalTextToneOverride as GlobalTextToneOverride } from './components/WorkspaceAppearance';
import { AppErrorBoundary as AppErrorBoundary } from './components/RouteSafety';
import { GenZMotionLayer as GenZMotionLayer } from './components/WorkspaceAppearance';
import { PersistentWorkspaceShell } from './components/Layout';
import CandidateSubmitOutboxWorker from './components/CandidateSubmitOutboxWorker';
import QuickUpdate from './components/QuickUpdate';
import WorkspaceUtilities from './components/WorkspaceUtilities';

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
  useEffect(() => {
    const prepare = event => {
      const link = event.target?.closest?.('a[href]');
      if (!link) return;
      try {
        const url = new URL(link.href, window.location.href);
        if (url.origin !== window.location.origin) return;
        const load = routeLoaders.get(url.pathname) || routeLoaders.get('/'+url.pathname.split('/')[1]);
        load?.().catch(() => {});
      } catch {}
    };
    document.addEventListener('pointerover', prepare, { passive: true });
    document.addEventListener('focusin', prepare);
    return () => {
      document.removeEventListener('pointerover', prepare);
      document.removeEventListener('focusin', prepare);
    };
  }, []);
  return (
    <>
      <CandidateSubmitOutboxWorker />
      <QuickUpdate /><WorkspaceUtilities />
      <GlobalTextToneOverride /><PersonalSettingsBridge />
      <GenZMotionLayer />
      <WorkspaceFrame>
      <AppErrorBoundary routeName={location.pathname}>
      <Suspense fallback={null}>
      <Routes>
      <Route path="/data-backup" element={<RoleRoute featureKey="data-backup"><DataBackupPage /></RoleRoute>} />
      <Route path="/settings" element={<PrivateRoute><SettingsPage /></PrivateRoute>} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Navigate to="/candidates" replace />} />
      <Route path="/dashboard" element={<Navigate to="/candidates" replace />} />
      <Route path="/profile-safety" element={<PrivateRoute><ProfileSafetyPage /></PrivateRoute>} />
      <Route path="/candidate-drafts" element={<PrivateRoute><CandidateDraftsPage /></PrivateRoute>} />
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
