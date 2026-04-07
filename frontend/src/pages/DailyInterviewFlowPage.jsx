import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { useAuth } from '../lib/auth';
import { dialCandidateWithLog } from '../lib/candidateAccess';

const TERMINAL_STATUSES = new Set([
  'selected', 'rejected', 'joined', 'not intrested', 'not interested', 'not responding', 'closed'
]);
const RESOLVED_TOMORROW_STATUSES = new Set(['all set for interview', 'appeared in interview', 'selected', 'joined']);

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatLocalYmd(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatLocalDateTimeInput(date) {
  return `${formatLocalYmd(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function addDays(baseDate, days) {
  const next = new Date(baseDate.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function parseInterviewStamp(row) {
  const scheduled = String(row.scheduled_at || '').trim();
  if (scheduled) {
    const parsed = new Date(scheduled);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const fallbackDate = String(row.interview_reschedule_date || row.interview_date || '').slice(0, 10);
  if (!fallbackDate) return null;
  const parsed = new Date(`${fallbackDate}T09:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function interviewDateKey(row) {
  const dateOnly = String(row.interview_reschedule_date || row.interview_date || '').slice(0, 10);
  if (dateOnly) return dateOnly;
  const parsed = parseInterviewStamp(row);
  return parsed ? formatLocalYmd(parsed) : '';
}

function interviewTimeLabel(row) {
  const scheduled = parseInterviewStamp(row);
  if (!scheduled) return '-';
  return scheduled.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function interviewDateLabel(row) {
  const parsed = parseInterviewStamp(row);
  if (!parsed) return '-';
  return parsed.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
}

function isPastInterview(row, now) {
  const parsed = parseInterviewStamp(row);
  if (parsed) return parsed.getTime() <= now.getTime();
  const dateKey = interviewDateKey(row);
  return Boolean(dateKey) && dateKey < formatLocalYmd(now);
}

function isTomorrowPending(row, tomorrowKey) {
  if (interviewDateKey(row) !== tomorrowKey) return false;
  return !RESOLVED_TOMORROW_STATUSES.has(lower(row.status));
}

function recruiterLabel(row) {
  return row.recruiter_code || row.recruiter_name || '-';
}

function flowSnoozeKey(userId, kind, dateKey) {
  return `dailyInterviewWorkflow:snooze:${userId}:${kind}:${dateKey}`;
}

export default function DailyInterviewFlowPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [savingId, setSavingId] = useState('');

  const view = searchParams.get('view') || 'today';
  const previousTab = searchParams.get('tab') || 'pending';

  async function load() {
    const data = await api.get('/api/interviews');
    setRows(data.items || []);
  }

  useEffect(() => { load(); }, []);
  usePolling(load, 45000, []);

  const timeline = useMemo(() => {
    const now = new Date();
    const todayKey = formatLocalYmd(now);
    const tomorrowKey = formatLocalYmd(addDays(now, 1));
    const activeRows = rows.filter((row) => !TERMINAL_STATUSES.has(lower(row.status)));

    const todayRows = activeRows.filter((row) => interviewDateKey(row) === todayKey);
    const pastRows = activeRows.filter((row) => isPastInterview(row, now));
    const previousPending = pastRows.filter((row) => lower(row.all_details_sent) === 'pending');
    const previousCompleted = pastRows.filter((row) => lower(row.all_details_sent) !== 'pending');
    const tomorrowRows = activeRows.filter((row) => interviewDateKey(row) === tomorrowKey);
    const tomorrowPending = tomorrowRows.filter((row) => isTomorrowPending(row, tomorrowKey));

    return {
      now,
      todayKey,
      tomorrowKey,
      todayRows,
      previousPending,
      previousCompleted,
      tomorrowRows,
      tomorrowPending,
    };
  }, [rows]);

  const title = view === 'previous'
    ? 'Follow Previous Candidate'
    : view === 'tomorrow'
      ? 'Next Day Interview Follow-up'
      : "Today's Interviews";

  const subtitle = view === 'previous'
    ? '1 PM workflow. One tab for all details pending and one tab for latest attempt completed rows.'
    : view === 'tomorrow'
      ? '5 PM workflow. Call tomorrow interview candidates and mark All Set For Interview. Pending rows reappear after 15 minutes.'
      : 'Morning login workflow. Open the list and call every candidate scheduled for today.';

  const visibleRows = useMemo(() => {
    if (view === 'previous') {
      return previousTab === 'completed' ? timeline.previousCompleted : timeline.previousPending;
    }
    if (view === 'tomorrow') return timeline.tomorrowPending;
    return timeline.todayRows;
  }, [timeline, view, previousTab]);

  function setView(nextView, extra = {}) {
    const next = new URLSearchParams(searchParams);
    next.set('view', nextView);
    if (nextView === 'previous') next.set('tab', extra.tab || previousTab || 'pending');
    else next.delete('tab');
    setSearchParams(next);
  }

  function openProfile(row) {
    window.open(`/candidate/${row.candidate_id}`, '_blank', 'noopener,noreferrer');
  }

  function callCandidate(row) {
    if (!row.phone) return;
    dialCandidateWithLog(row.candidate_id, row.phone);
  }

  async function markAllSet(row) {
    setSavingId(row.candidate_id);
    try {
      await api.put(`/api/candidates/${row.candidate_id}`, {
        status: 'All set for Interview',
        interview_availability: 'Confirmed',
      });
      await load();
    } finally {
      setSavingId('');
    }
  }

  async function markDetailsSent(row) {
    setSavingId(row.candidate_id);
    try {
      await api.put(`/api/candidates/${row.candidate_id}`, {
        all_details_sent: 'Completed',
      });
      await load();
    } finally {
      setSavingId('');
    }
  }

  async function markCallNotPicked(row) {
    setSavingId(row.candidate_id);
    try {
      const retryAt = new Date(Date.now() + 15 * 60 * 1000);
      await api.put(`/api/candidates/${row.candidate_id}`, {
        follow_up_at: formatLocalDateTimeInput(retryAt),
        follow_up_status: 'Open',
        follow_up_note: 'Call not picked for next day interview follow-up. Retry after 15 minutes.',
      });
      if (user?.user_id) {
        localStorage.setItem(flowSnoozeKey(user.user_id, 'tomorrow', timeline.tomorrowKey), String(Date.now() + 15 * 60 * 1000));
      }
      await load();
    } finally {
      setSavingId('');
    }
  }

  function snoozeTomorrowFifteenMinutes() {
    if (!user?.user_id) return;
    localStorage.setItem(flowSnoozeKey(user.user_id, 'tomorrow', timeline.tomorrowKey), String(Date.now() + 15 * 60 * 1000));
  }

  function renderActions(row) {
    const saving = savingId === row.candidate_id;
    return (
      <div className="workflow-inline-actions">
        <button type="button" className="mini-btn view bounceable" onClick={() => openProfile(row)}>Open Profile</button>
        <button type="button" className="mini-btn call bounceable" onClick={() => callCandidate(row)}>Call</button>
        {view === 'tomorrow' ? (
          <>
            <button type="button" className="mini-btn edit bounceable" disabled={saving} onClick={() => markAllSet(row)}>{saving ? 'Saving...' : 'All Set'}</button>
            <button type="button" className="ghost-btn bounceable" disabled={saving} onClick={() => markCallNotPicked(row)}>No Answer +15m</button>
          </>
        ) : null}
        {view === 'previous' && previousTab === 'pending' ? (
          <button type="button" className="ghost-btn bounceable" disabled={saving} onClick={() => markDetailsSent(row)}>{saving ? 'Saving...' : 'Mark Details Sent'}</button>
        ) : null}
      </div>
    );
  }

  return (
    <Layout title={title} subtitle={subtitle}>
      <div className="workflow-summary-grid top-gap-small">
        <button type="button" className={`metric-card colorful-card tone-blue task-summary-button ${view === 'today' ? 'metric-card-active' : ''}`} onClick={() => setView('today')}>
          <span>Today Interviews</span>
          <strong>{timeline.todayRows.length}</strong>
          <small>Morning login list</small>
        </button>
        <button type="button" className={`metric-card colorful-card tone-orange task-summary-button ${view === 'previous' && previousTab === 'pending' ? 'metric-card-active' : ''}`} onClick={() => setView('previous', { tab: 'pending' })}>
          <span>All Details Pending</span>
          <strong>{timeline.previousPending.length}</strong>
          <small>Interview done but details missing</small>
        </button>
        <button type="button" className={`metric-card colorful-card tone-green task-summary-button ${view === 'previous' && previousTab === 'completed' ? 'metric-card-active' : ''}`} onClick={() => setView('previous', { tab: 'completed' })}>
          <span>Latest Attempt Complete</span>
          <strong>{timeline.previousCompleted.length}</strong>
          <small>Past interview rows already completed</small>
        </button>
        <button type="button" className={`metric-card colorful-card tone-violet task-summary-button ${view === 'tomorrow' ? 'metric-card-active' : ''}`} onClick={() => setView('tomorrow')}>
          <span>Tomorrow Pending</span>
          <strong>{timeline.tomorrowPending.length}</strong>
          <small>5 PM all-set follow-up queue</small>
        </button>
      </div>

      <div className="table-panel top-gap glassy-card fade-up">
        <div className="table-toolbar no-wrap-toolbar">
          <div className="table-title">Daily Interview Workflow</div>
          <div className="toolbar-actions compact-pills top-toolbar-safe">
            <span className="mini-chip">{visibleRows.length} visible</span>
            <span className="mini-chip">{view === 'previous' ? (previousTab === 'pending' ? 'Pending details tab' : 'Completed tab') : (view === 'tomorrow' ? 'Pending all set list' : 'Today call list')}</span>
            <span className="mini-chip live-chip">45s live refresh</span>
            {view === 'tomorrow' ? <button type="button" className="ghost-btn bounceable" onClick={snoozeTomorrowFifteenMinutes}>Snooze 15m</button> : null}
            <button type="button" className="ghost-btn bounceable" onClick={load}>Refresh Now</button>
          </div>
        </div>

        {view === 'previous' ? (
          <div className="workflow-tab-strip top-gap-small">
            <button type="button" className={`top-pill bounceable ${previousTab === 'pending' ? 'active' : ''}`} onClick={() => setView('previous', { tab: 'pending' })}>All Details Pending</button>
            <button type="button" className={`top-pill bounceable ${previousTab === 'completed' ? 'active' : ''}`} onClick={() => setView('previous', { tab: 'completed' })}>Latest Attempt Complete</button>
          </div>
        ) : null}
      </div>

      <div className="table-panel top-gap glassy-card fade-up">
        <div className="crm-table-wrap dense-wrap">
          <table className="crm-table colorful-table dense-table">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Recruiter</th>
                <th>Process</th>
                <th>Interview Date</th>
                <th>Time</th>
                <th>Status</th>
                <th>All Details Sent</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const statusLower = lower(row.status);
                const badgeClass = statusLower === 'all set for interview' ? 'success' : statusLower === 'pending' ? 'warning' : 'default';
                return (
                  <tr key={`${row.candidate_id}-${row.interview_id || interviewDateKey(row)}`}>
                    <td>
                      <strong>{row.full_name || '-'}</strong>
                      <br />
                      <span className="subtle">{row.candidate_id}</span>
                    </td>
                    <td>{recruiterLabel(row)}</td>
                    <td>{row.process || '-'}</td>
                    <td>{interviewDateLabel(row)}</td>
                    <td>{interviewTimeLabel(row)}</td>
                    <td><span className={`workflow-status-pill ${badgeClass}`}>{row.status || '-'}</span></td>
                    <td><span className={`workflow-status-pill ${lower(row.all_details_sent) === 'completed' ? 'success' : 'warning'}`}>{row.all_details_sent || '-'}</span></td>
                    <td>{renderActions(row)}</td>
                  </tr>
                );
              })}
              {!visibleRows.length ? (
                <tr>
                  <td colSpan="8" className="helper-text">
                    {view === 'tomorrow'
                      ? 'No pending next-day interview rows right now.'
                      : view === 'previous'
                        ? 'No previous candidate rows matched this tab.'
                        : 'No interviews are scheduled for today in your visible list.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel top-gap glassy-card fade-up">
        <div className="panel-title">What this page is doing</div>
        <div className="activity-list workflow-note-list top-gap-small">
          <div className="activity-item">
            <div className="activity-left">
              <div className="activity-name">Morning login popup</div>
              <div className="activity-sub">Shows today interview count and opens this page in today mode.</div>
            </div>
          </div>
          <div className="activity-item">
            <div className="activity-left">
              <div className="activity-name">1 PM follow previous candidate popup</div>
              <div className="activity-sub">Opens two tabs: All Details Pending and Latest Attempt Complete.</div>
            </div>
          </div>
          <div className="activity-item">
            <div className="activity-left">
              <div className="activity-name">5 PM next-day interview popup</div>
              <div className="activity-sub">Pending rows stay here until status becomes All set for Interview. No answer button snoozes the reminder by 15 minutes.</div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
