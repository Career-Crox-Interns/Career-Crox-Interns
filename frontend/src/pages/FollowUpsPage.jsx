import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { useAuth } from '../lib/auth';
import { visiblePhone } from '../lib/candidateAccess';

function toTime(value) {
  const d = new Date(value || 0);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function toDate(value) {
  const d = new Date(value || 0);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

function addMinutes(minutes) {
  const d = new Date(Date.now() + Number(minutes || 0) * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function FollowUpsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [busyId, setBusyId] = useState('');

  async function load() {
    const data = await api.get('/api/followups/upcoming');
    setItems(data.items || []);
  }

  useEffect(() => { load(); }, []);
  usePolling(load, 15000, []);

  const groups = useMemo(() => {
    const now = Date.now();
    const inHour = [];
    const nextHour = [];
    const today = [];
    const upcoming = [];
    const overdue = [];
    for (const row of items) {
      const due = new Date(row.follow_up_at || 0).getTime();
      if (!due) continue;
      const diff = due - now;
      const sameDay = new Date(due).toDateString() === new Date(now).toDateString();
      if (diff <= 0) overdue.push(row);
      if (diff >= 0 && diff <= 3600000) inHour.push(row);
      if (diff > 3600000 && diff <= 7200000) nextHour.push(row);
      if (sameDay) today.push(row);
      if (diff > 0) upcoming.push(row);
    }
    return { inHour, nextHour, today, upcoming, overdue };
  }, [items]);

  async function markDone(row) {
    setBusyId(row.candidate_id);
    try {
      await api.post('/api/followups/action', { candidate_id: row.candidate_id, follow_up_status: 'Done', follow_up_note: 'Closed from FollowUps page', follow_up_at: '' });
      await load();
    } finally {
      setBusyId('');
    }
  }

  async function snooze(row, minutes) {
    setBusyId(row.candidate_id);
    try {
      await api.post('/api/followups/action', {
        candidate_id: row.candidate_id,
        follow_up_status: 'Open',
        follow_up_note: `Rescheduled by ${minutes} minutes`,
        follow_up_at: addMinutes(minutes),
      });
      await load();
    } finally {
      setBusyId('');
    }
  }

  function Card({ title, count, tone, onClick }) {
    return (
      <button type="button" className={`metric-card colorful-card ${tone} task-summary-button`} onClick={onClick}>
        <span>{title}</span>
        <strong>{count}</strong>
        <small>Open filtered list</small>
      </button>
    );
  }

  const [filterKey, setFilterKey] = useState('inHour');
  const filteredRows = groups[filterKey] || [];

  return (
    <Layout title="FollowUps" subtitle="This hour, next hour, today, and upcoming follow-ups. Recruiters see their own rows, while leadership can review the full queue.">
      <div className="workflow-summary-grid top-gap-small">
        <Card title="This Hour" count={groups.inHour.length} tone="tone-red" onClick={() => setFilterKey('inHour')} />
        <Card title="Next Hour" count={groups.nextHour.length} tone="tone-orange" onClick={() => setFilterKey('nextHour')} />
        <Card title="Today" count={groups.today.length} tone="tone-blue" onClick={() => setFilterKey('today')} />
        <Card title="Upcoming" count={groups.upcoming.length} tone="tone-green" onClick={() => setFilterKey('upcoming')} />
        <Card title="Overdue" count={groups.overdue.length} tone="tone-violet" onClick={() => setFilterKey('overdue')} />
      </div>

      <div className="table-panel top-gap glassy-card fade-up">
        <div className="table-toolbar no-wrap-toolbar">
          <div className="table-title">{filterKey === 'inHour' ? 'This Hour FollowUps' : filterKey === 'nextHour' ? 'Next Hour FollowUps' : filterKey === 'today' ? 'Today FollowUps' : filterKey === 'upcoming' ? 'Upcoming FollowUps' : 'Overdue FollowUps'}</div>
          <div className="toolbar-actions compact-pills top-toolbar-safe">
            <span className="mini-chip">{filteredRows.length} visible</span>
            <span className="mini-chip live-chip">15s live refresh</span>
            <button className="ghost-btn bounceable" type="button" onClick={load}>Refresh</button>
          </div>
        </div>
      </div>

      <div className="table-panel top-gap glassy-card fade-up">
        <div className="crm-table-wrap dense-wrap">
          <table className="crm-table colorful-table dense-table readable-flow-table followups-readable-table">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Recruiter</th>
                <th>Phone</th>
                <th>FollowUp Date</th>
                <th>Time</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.candidate_id}>
                  <td><strong>{row.full_name || '-'}</strong><br /><span className="subtle">{row.candidate_id}</span></td>
                  <td>{row.recruiter_code || row.recruiter_name || '-'}</td>
                  <td>{visiblePhone(user, row.phone)}</td>
                  <td>{toDate(row.follow_up_at)}</td>
                  <td>{toTime(row.follow_up_at)}</td>
                  <td><span className={`workflow-status-pill ${String(row.is_due) === 'true' || row.is_due ? 'warning' : 'success'}`}>{row.follow_up_status || 'Open'}</span></td>
                  <td>
                    <div className="workflow-inline-actions">
                      <button type="button" className="mini-btn view bounceable highlight-choice highlight-strong" onClick={() => navigate(`/candidate/${row.candidate_id}`)}>Open Profile</button>
                      <button type="button" className="mini-btn call bounceable" disabled={busyId === row.candidate_id} onClick={() => markDone(row)}>{busyId === row.candidate_id ? 'Saving...' : 'Done'}</button>
                      <button type="button" className="ghost-btn bounceable" disabled={busyId === row.candidate_id} onClick={() => snooze(row, 5)}>+5m</button>
                      <button type="button" className="ghost-btn bounceable" disabled={busyId === row.candidate_id} onClick={() => snooze(row, 10)}>+10m</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!filteredRows.length ? <tr><td colSpan="7" className="helper-text">No follow-ups in this bucket right now.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
