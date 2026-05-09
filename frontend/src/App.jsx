import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import PrivateRoute from './components/PrivateRoute';
import RoleRoute from './components/RoleRoute';
import LoginPage from './pages/LoginPage';
import CandidatesPage from './pages/CandidatesPage';
import CandidateDetailPage from './pages/CandidateDetailPage';
import CandidateDetailRoute from './pages/CandidateDetailRoute';
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
import DailyInterviewFlowPage from './pages/DailyInterviewFlowPage';
import MailPage from './pages/MailPage';
import DuplicateProfilesPage from './pages/DuplicateProfilesPage';
import SemiHourlyReportPage from './pages/SemiHourlyReportPage';
import BDAHeadPage from './pages/BDAHeadPage';
import GoalPostPage from './pages/GoalPostPage';
import PrimeTimeInsightsPage from './pages/PrimeTimeInsightsPage';
import DisabledSlicesPage from './pages/DisabledSlicesPage';
import HotLeadsPage from './pages/HotLeadsPage';
import LiveDialingRoomPage from './pages/LiveDialingRoomPage';
import AutoDialerPage from './pages/AutoDialerPage';
import GlobalTextToneOverride from './components/GlobalTextToneOverride';
import AppErrorBoundary from './components/AppErrorBoundary';

function SmartFallback() {
  const { user, booted } = useAuth();
  if (!booted) return null;
  return <Navigate to={user ? '/candidates' : '/login'} replace />;
}

export default function App() {
  const location = useLocation();
  return (
    <>
      <GlobalTextToneOverride />
      <AppErrorBoundary key={location.pathname} routeName={location.pathname}>
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
      <Route path="/jds" element={<PrivateRoute><JDsPage /></PrivateRoute>} />
      <Route path="/submissions" element={<PrivateRoute><SubmissionsPage /></PrivateRoute>} />
      <Route path="/notifications" element={<PrivateRoute><NotificationsPage /></PrivateRoute>} />
      <Route path="/attendance" element={<RoleRoute featureKey="attendance"><AttendancePage /></RoleRoute>} />
      <Route path="/reports" element={<RoleRoute featureKey="reports"><ReportsPage /></RoleRoute>} />
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
      <Route path="/quick-add/:kind" element={<PrivateRoute><QuickAddPage /></PrivateRoute>} />
      <Route path="/aaria" element={<PrivateRoute><AariaPage /></PrivateRoute>} />
      <Route path="/bucket-out" element={<RoleRoute featureKey="bucket"><BucketOutPage /></RoleRoute>} />
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
      <Route path="/prime-time-insights" element={<RoleRoute featureKey="timing-insights"><PrimeTimeInsightsPage /></RoleRoute>} />
      <Route path="*" element={<SmartFallback />} />
      </Routes>
      </AppErrorBoundary>
    </>
  );
}
