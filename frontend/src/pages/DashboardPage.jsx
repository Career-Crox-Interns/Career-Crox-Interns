import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';

function stamp(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function shortDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  }
  return String(value).slice(0, 10) || '-';
}

export default function DashboardPage() {
  const [data, setData] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('careerCroxDashboardCache') || 'null'); } catch { return null; }
  });

  async function load() {
    const next = await api.get('/api/dashboard');
    setData(next);
    try { sessionStorage.setItem('careerCroxDashboardCache', JSON.stringify(next)); } catch {}
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    try {
      if (sessionStorage.getItem('careerCroxLoginTransition') !== '1') return undefined;
      document.body.classList.add('crm-dashboard-entry-active');
      sessionStorage.removeItem('careerCroxLoginTransition');
      const timer = window.setTimeout(() => document.body.classList.remove('crm-dashboard-entry-active'), 1300);
      return () => window.clearTimeout(timer);
    } catch {
      return undefined;
    }
  }, []);
  usePolling(load, 6000, []);

  if (!data) {
    return (
      <Layout title="Career Crox Dashboard" subtitle="Freelancer operations dashboard for confidential candidate workflow.">
        <div className="dashboard-grid professional-dashboard-grid">
          <div className="clean-hero panel professional-hero compact-color-hero glow-box">
            <div>
              <div className="lux-hero-kicker">CAREER CROX</div>
              <h1 className="professional-hero-title">Freelancer Recruitment Dashboard</h1>
              <p className="professional-hero-sub">Opening the dashboard first, then filling the live data behind the scenes.</p>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  const dueTasks = (data.due_tasks || []).slice(0, 8);
  const recentActivity = (data.recent_activity || []).slice(0, 8);
  const untouchedProfiles = (data.untouched_profiles || []).slice(0, 8);

  return (
    <Layout title="Career Crox Dashboard" subtitle="Confidential freelancer CRM with role-based visibility and team-scoped control.">
      <div className="dashboard-grid professional-dashboard-grid">
        <div className="clean-hero panel professional-hero compact-color-hero glow-box">
          <div>
            <div className="lux-hero-kicker">CAREER CROX</div>
            <h1 className="professional-hero-title">Freelancer Recruitment Dashboard</h1>
            <p className="professional-hero-sub">Only the essential workflow stays here: candidates, submissions, interviews, follow-ups, tasks, and JD matching.</p>
          </div>
        </div>

        <div className="stats-row">
          <Link className="stat-card blue clickable-stat bounceable" to="/candidates">
            <div className="stat-label">Total Profiles</div>
            <div className="stat-value">{data.total_profiles || 0}</div>
          </Link>
          <Link className="stat-card purple clickable-stat bounceable" to="/submissions">
            <div className="stat-label">Pending Approvals</div>
            <div className="stat-value">{data.pending_approvals || 0}</div>
          </Link>
          <Link className="stat-card green clickable-stat bounceable" to="/interviews">
            <div className="stat-label">Interviews Today</div>
            <div className="stat-value">{data.interviews_today || 0}</div>
          </Link>
          <Link className="stat-card orange clickable-stat bounceable" to="/tasks">
            <div className="stat-label">Due Tasks</div>
            <div className="stat-value">{dueTasks.length}</div>
          </Link>
        </div>

        <div className="action-row">
          <Link className="action-card action-profiles bounceable" to="/candidates">Candidates <span>→</span></Link>
          <Link className="action-card action-task bounceable" to="/submissions">Submissions <span>→</span></Link>
          <Link className="action-card action-dialer bounceable" to="/interviews">Interviews <span>→</span></Link>
          <Link className="action-card action-admin bounceable" to="/followups">FollowUps <span>→</span></Link>
          <Link className="action-card action-admin bounceable" to="/tasks">Tasks <span>→</span></Link>
          <Link className="action-card action-dialer bounceable" to="/jds">JD Centre <span>→</span></Link>
        </div>

        <div className="section-row dashboard-section-grid">
          <div className="panel">
            <div className="panel-title">Recent Candidate Activity</div>
            <div className="activity-list">
              {recentActivity.length ? recentActivity.map((item) => (
                <div className="activity-item" key={item.candidate_id}>
                  <div className="activity-left">
                    <div className="activity-name">{item.full_name}</div>
                    <div className="activity-sub">{item.status || '-'} • {item.recruiter_name || 'Unassigned'} • {item.location || '-'}</div>
                  </div>
                  <Link className="badge active" to={`/candidate/${item.candidate_id}`}>Open</Link>
                </div>
              )) : <div className="helper-text">No candidate activity available right now.</div>}
            </div>
          </div>

          <div className="panel" id="untouched">
            <div className="panel-title">Interview Attention</div>
            <div className="helper-text top-gap-small">Profiles with scheduled interviews that have not been opened recently.</div>
            <div className="activity-list top-gap-small">
              {untouchedProfiles.length ? untouchedProfiles.map((item) => (
                <div className="activity-item" key={item.candidate_id}>
                  <div className="activity-left">
                    <div className="activity-name">{item.full_name}</div>
                    <div className="activity-sub">{item.recruiter_name || '-'} • {item.process || '-'} • {item.location || '-'}</div>
                    <div className="activity-sub">Interview: {item.interview_reschedule_date || '-'} • Last touch: {stamp(item.last_touched_at)}</div>
                  </div>
                  <Link className="badge pending" to={`/candidate/${item.candidate_id}`}>Open</Link>
                </div>
              )) : <div className="helper-text">No interview attention items right now.</div>}
            </div>
          </div>

          <div className="panel">
            <div className="panel-title">Open Tasks</div>
            <div className="activity-list">
              {dueTasks.length ? dueTasks.map((task) => (
                <div className="activity-item" key={task.task_id}>
                  <div className="activity-left">
                    <div className="activity-name">{task.title || task.task_id}</div>
                    <div className="activity-sub">{task.assigned_to_name || '-'} • {task.priority || 'Normal'} • Due {shortDate(task.due_date)}</div>
                  </div>
                  <Link className="badge active" to={`/tasks?task_id=${encodeURIComponent(task.task_id)}`}>Open</Link>
                </div>
              )) : <div className="helper-text">No open tasks right now.</div>}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
