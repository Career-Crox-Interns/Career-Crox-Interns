import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { notificationTarget } from '../lib/notificationLink';
import { useAuth } from '../lib/auth';

const CATEGORY_LABELS = {
  all: 'All Categories',
  approval: 'Approvals',
  attendance: 'Attendance',
  candidate: 'Candidates',
  chat: 'Team Chat',
  general: 'General',
  interview: 'Interviews',
  learning: 'Learning',
  submission: 'Submissions',
  system: 'System',
  task: 'Tasks',
};

const CATEGORY_ORDER = ['approval', 'submission', 'task', 'interview', 'attendance', 'chat', 'candidate', 'learning', 'system', 'general'];

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase() === 'unread' ? 'pending' : 'completed';
}

function normalizeCategory(value) {
  return String(value || '').trim().toLowerCase() || 'general';
}

function formatStamp(value) {
  const stamp = String(value || '');
  if (!stamp) return '-';
  return stamp.replace('T', ' ').slice(0, 16);
}

function withinHours(value, hours) {
  const numericHours = Number.parseFloat(hours);
  if (!Number.isFinite(numericHours) || numericHours <= 0) return true;
  const createdAt = new Date(value || 0).getTime();
  if (!createdAt) return false;
  return Date.now() - createdAt <= numericHours * 60 * 60 * 1000;
}

function categoryLabel(value) {
  return CATEGORY_LABELS[normalizeCategory(value)] || String(value || 'General');
}

function categoryChipClass(value) {
  const category = normalizeCategory(value);
  if (category === 'approval') return 'chip-approval';
  if (category === 'submission') return 'chip-submission';
  if (category === 'task') return 'chip-task';
  if (category === 'interview') return 'chip-interview';
  if (category === 'attendance') return 'chip-attendance';
  if (category === 'chat') return 'chip-chat';
  return 'chip-default';
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const role = String(user?.role || '').toLowerCase();
  const leadership = ['admin', 'manager', 'tl'].includes(role);

  const [rows, setRows] = useState([]);
  const [scope, setScope] = useState('self');
  const [statusTab, setStatusTab] = useState('all');
  const [recruiterCodeFilter, setRecruiterCodeFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [durationHours, setDurationHours] = useState('');

  async function load() {
    const data = await api.get('/api/notifications');
    setRows(data.items || []);
    setScope(data.scope || 'self');
  }

  useEffect(() => { load(); }, []);
  usePolling(load, 2500, []);

  async function openNotification(row) {
    try { await api.post(`/api/notifications/${row.notification_id}/read`, {}); } catch {}
    navigate(notificationTarget(row));
  }

  function resetFilters() {
    setStatusTab('all');
    setRecruiterCodeFilter('all');
    setCategoryFilter('all');
    setDurationHours('');
  }

  const recruiterOptions = useMemo(() => {
    return [...new Set(rows.map((row) => String(row.recruiter_code || '').trim()).filter(Boolean))]
      .sort((a, b) => {
        const aRecruiter = /^cc-/i.test(a);
        const bRecruiter = /^cc-/i.test(b);
        if (aRecruiter !== bRecruiter) return aRecruiter ? -1 : 1;
        return a.localeCompare(b);
      });
  }, [rows]);

  const categoryOptions = useMemo(() => {
    const available = new Set(rows.map((row) => normalizeCategory(row.category)));
    return CATEGORY_ORDER.filter((item) => available.has(item)).concat([...available].filter((item) => !CATEGORY_ORDER.includes(item)).sort());
  }, [rows]);

  const scopedRows = useMemo(() => rows.filter((row) => {
    if (leadership && recruiterCodeFilter !== 'all' && String(row.recruiter_code || '').trim() !== recruiterCodeFilter) return false;
    if (!withinHours(row.created_at, durationHours)) return false;
    if (categoryFilter !== 'all' && normalizeCategory(row.category) !== categoryFilter) return false;
    return true;
  }), [rows, leadership, recruiterCodeFilter, durationHours, categoryFilter]);

  const filteredRows = useMemo(() => scopedRows.filter((row) => {
    const rowStatus = normalizeStatus(row.status);
    if (statusTab === 'pending') return rowStatus === 'pending';
    if (statusTab === 'completed') return rowStatus === 'completed';
    return true;
  }), [scopedRows, statusTab]);

  const pendingCount = useMemo(() => scopedRows.filter((row) => normalizeStatus(row.status) === 'pending').length, [scopedRows]);
  const completedCount = useMemo(() => scopedRows.filter((row) => normalizeStatus(row.status) === 'completed').length, [scopedRows]);

  const durationLabel = durationHours && Number.parseFloat(durationHours) > 0
    ? `${Number.parseFloat(durationHours)}h window`
    : 'Live stream';

  return (
    <Layout title="Notifications" subtitle="Live notification feed with recruiter, category, and duration control.">
      <div className="notification-summary-grid top-gap-small">
        <button type="button" className={`metric-card colorful-card tone-blue task-summary-button ${statusTab === 'all' ? 'metric-card-active' : ''}`} onClick={() => setStatusTab('all')}>
          <span>All Notifications</span>
          <strong>{scopedRows.length}</strong>
          <small>Everything in current filtered view</small>
        </button>
        <button type="button" className={`metric-card colorful-card tone-orange task-summary-button ${statusTab === 'pending' ? 'metric-card-active' : ''}`} onClick={() => setStatusTab('pending')}>
          <span>Pending</span>
          <strong>{pendingCount}</strong>
          <small>Unread notifications still waiting</small>
        </button>
        <button type="button" className={`metric-card colorful-card tone-green task-summary-button ${statusTab === 'completed' ? 'metric-card-active' : ''}`} onClick={() => setStatusTab('completed')}>
          <span>Completed</span>
          <strong>{completedCount}</strong>
          <small>Read notifications already handled</small>
        </button>
        <div className="metric-card colorful-card tone-violet notification-info-card">
          <span>{durationLabel}</span>
          <strong>{filteredRows.length}</strong>
          <small>{leadership ? 'Leadership view can filter recruiter codes' : 'Recruiters only see their own notifications'}</small>
        </div>
      </div>

      <div className="table-panel top-gap glassy-card fade-up">
        <div className="table-toolbar no-wrap-toolbar">
          <div className="table-title">Notification Center</div>
          <div className="toolbar-actions compact-pills top-toolbar-safe">
            <span className="mini-chip">{filteredRows.length} visible</span>
            <span className="mini-chip">{scope === 'team' ? 'Team scope' : 'My scope'}</span>
            <span className="mini-chip live-chip">3s live refresh</span>
            <button className="ghost-btn bounceable" type="button" onClick={resetFilters}>Reset Filters</button>
            <button className="ghost-btn bounceable" type="button" onClick={() => api.post('/api/notifications/mark-all-read', {}).then(load)}>Mark my notifications completed</button>
          </div>
        </div>

        <div className="notification-filter-strip top-gap-small">
          {leadership ? (
            <div className="compact-select-shell shell-indigo">
              <span className="compact-shell-label">Recruiter Code</span>
              <select className="compact-inline-input" value={recruiterCodeFilter} onChange={(e) => setRecruiterCodeFilter(e.target.value)}>
                <option value="all">All Recruiter Codes</option>
                {recruiterOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
          ) : (
            <div className="compact-select-shell shell-indigo notification-own-shell">
              <span className="compact-shell-label">Recruiter Code</span>
              <div className="notification-own-code">{user?.recruiter_code || 'Own notifications only'}</div>
            </div>
          )}

          <div className="compact-select-shell shell-cyan">
            <span className="compact-shell-label">Category</span>
            <select className="compact-inline-input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="all">All Categories</option>
              {categoryOptions.map((item) => <option key={item} value={item}>{categoryLabel(item)}</option>)}
            </select>
          </div>

          <div className="compact-select-shell shell-green notification-duration-shell">
            <span className="compact-shell-label">Duration</span>
            <div className="notification-duration-row">
              <button type="button" className={`top-pill bounceable ${durationHours ? '' : 'active'}`} onClick={() => setDurationHours('')}>Live</button>
              <button type="button" className={`top-pill bounceable ${durationHours === '6' ? 'active' : ''}`} onClick={() => setDurationHours('6')}>6h</button>
              <button type="button" className={`top-pill bounceable ${durationHours === '24' ? 'active' : ''}`} onClick={() => setDurationHours('24')}>24h</button>
              <input className="compact-inline-input notification-hours-input" type="number" min="1" step="1" value={durationHours} onChange={(e) => setDurationHours(e.target.value)} placeholder="Hours" />
            </div>
          </div>
        </div>
      </div>

      <div className="panel top-gap glassy-card fade-up">
        <div className="table-toolbar">
          <div className="table-title">Notification Feed</div>
          <div className="toolbar-actions compact-pills">
            <span className="mini-chip">{statusTab === 'all' ? 'All status' : statusTab === 'pending' ? 'Pending only' : 'Completed only'}</span>
            {categoryFilter !== 'all' ? <span className="mini-chip">{categoryLabel(categoryFilter)}</span> : null}
            {leadership && recruiterCodeFilter !== 'all' ? <span className="mini-chip">{recruiterCodeFilter}</span> : null}
            {durationHours ? <span className="mini-chip">Last {durationHours}h</span> : <span className="mini-chip">Live mode</span>}
          </div>
        </div>

        <div className="notification-feed-list top-gap-small">
          {filteredRows.map((row) => {
            const pending = normalizeStatus(row.status) === 'pending';
            return (
              <button
                type="button"
                className={`activity-item notification-history-item notification-feed-card ${pending ? 'is-pending' : 'is-completed'}`}
                key={row.notification_id}
                onClick={() => openNotification(row)}
              >
                <div className="activity-left notification-feed-left">
                  <div className="notification-feed-topline">
                    <div className="activity-name">{row.title}</div>
                    <div className={`badge ${pending ? 'pending' : 'active'}`}>{pending ? 'Pending' : 'Completed'}</div>
                  </div>
                  <div className="activity-sub notification-message-line">{row.message}</div>
                  <div className="notification-meta-row">
                    <span className={`notification-category-chip ${categoryChipClass(row.category)}`}>{categoryLabel(row.category)}</span>
                    <span className="mini-chip">{row.recruiter_code || user?.recruiter_code || 'No code'}</span>
                    <span className="mini-chip">{row.owner_name ? `${row.owner_name}${row.owner_designation ? ` · ${row.owner_designation}` : ''}` : (row.owner_designation || 'Assigned user')}</span>
                    <span className="mini-chip">{formatStamp(row.created_at)}</span>
                  </div>
                </div>
              </button>
            );
          })}

          {filteredRows.length === 0 ? <div className="helper-text">No notifications matched the selected filters.</div> : null}
        </div>
      </div>
    </Layout>
  );
}
