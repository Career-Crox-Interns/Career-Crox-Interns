import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import PrivateRoute from './components/PrivateRoute';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import CandidatesPage from './pages/CandidatesPage';
import CandidateDetailPage from './pages/CandidateDetailPage';
import TasksPage from './pages/TasksPage';
import InterviewsPage from './pages/InterviewsPage';
import FollowUpsPage from './pages/FollowUpsPage';
import SubmissionsPage from './pages/SubmissionsPage';
import AdminPage from './pages/AdminPage';
import QuickAddPage from './pages/QuickAddPage';
import JDsPage from './pages/JDsPage';
import MyTeamPage from './pages/MyTeamPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<PrivateRoute><DashboardPage /></PrivateRoute>} />
      <Route path="/candidates" element={<PrivateRoute><CandidatesPage /></PrivateRoute>} />
      <Route path="/candidate/:candidateId" element={<PrivateRoute><CandidateDetailPage /></PrivateRoute>} />
      <Route path="/tasks" element={<PrivateRoute><TasksPage /></PrivateRoute>} />
      <Route path="/interviews" element={<PrivateRoute><InterviewsPage /></PrivateRoute>} />
      <Route path="/followups" element={<PrivateRoute><FollowUpsPage /></PrivateRoute>} />
      <Route path="/submissions" element={<PrivateRoute><SubmissionsPage /></PrivateRoute>} />
      <Route path="/jds" element={<PrivateRoute><JDsPage /></PrivateRoute>} />
      <Route path="/admin" element={<PrivateRoute><AdminPage /></PrivateRoute>} />
      <Route path="/my-team" element={<PrivateRoute><MyTeamPage /></PrivateRoute>} />
      <Route path="/quick-add" element={<PrivateRoute><QuickAddPage /></PrivateRoute>} />
      <Route path="/quick-add/:kind" element={<PrivateRoute><QuickAddPage /></PrivateRoute>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
