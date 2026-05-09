import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePolling } from '../lib/usePolling';

const METRIC_CONFIG = {
  submission: { label: 'Submission', tone: 'blue', plural: 'Submissions' },
  interview: { label: 'Interview', tone: 'purple', plural: 'Interviews' },
  selection: { label: 'Selection', tone: 'green', plural: 'Selections' },
  joining: { label: 'Joining', tone: 'amber', plural: 'Joinings' },
};

function todayYmd() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10);
}

function addDays(dateText, days) {
  const base = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(base.getTime())) return dateText;
  base.setDate(base.getDate() + Number(days || 0));
  const offset = base.getTimezoneOffset();
  const local = new Date(base.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10);
}

function startOfMonth(dateText) {
  const base = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(base.getTime())) return dateText;
  base.setDate(1);
  const offset = base.getTimezoneOffset();
  const local = new Date(base.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-IN');
}

function statusTone(status) {
  const text = String(status || '').toLowerCase();
  if (text.includes('top')) return 'green';
  if (text.includes('track')) return 'blue';
  if (text.includes('average') || text.includes('saved')) return 'orange';
  if (text.includes('attention') || text.includes('not filled')) return 'red';
  return 'purple';
}

function gapTone(value) {
  const numeric = Number(value || 0);
  if (numeric <= 0) return 'green';
  if (numeric <= 3) return 'orange';
  return 'red';
}

function emptyEntry(userId, dateText) {
  return {
    user_id: userId || '',
    date: dateText || todayYmd(),
    submission_target: '',
    submission_done: '',
    interview_target: '',
    interview_done: '',
    selection_target: '',
    selection_done: '',
    joining_target: '',
    joining_done: '',
    notes: '',
  };
}

function summaryFromRows(rows) {
  const summary = {
    target_total: 0,
    done_total: 0,
    gap_total: 0,
    completion_pct: 0,
    row_count: rows.length,
  };
  Object.keys(METRIC_CONFIG).forEach((metric) => {
    summary[`${metric}_target`] = rows.reduce((total, item) => total + Number(item?.[`${metric}_target`] || 0), 0);
    summary[`${metric}_done`] = rows.reduce((total, item) => total + Number(item?.[`${metric}_done`] || 0), 0);
    summary[`${metric}_gap`] = rows.reduce((total, item) => total + Number(item?.[`${metric}_gap`] || 0), 0);
    summary.target_total += summary[`${metric}_target`];
    summary.done_total += summary[`${metric}_done`];
    summary.gap_total += summary[`${metric}_gap`];
  });
  summary.completion_pct = summary.target_total > 0 ? Math.min(999, Math.round((summary.done_total / summary.target_total) * 100)) : 0;
  return summary;
}

function leaderboardFromRows(rows) {
  return rows
    .filter((item) => Number(item?.target_total || 0) > 0)
    .slice()
    .sort((a, b) => {
      if ((b.completion_pct || 0) !== (a.completion_pct || 0)) return (b.completion_pct || 0) - (a.completion_pct || 0);
      if ((a.gap_total || 0) !== (b.gap_total || 0)) return (a.gap_total || 0) - (b.gap_total || 0);
      return String(a.recruiter_name || '').localeCompare(String(b.recruiter_name || ''));
    })
    .slice(0, 6)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function attentionFromRows(rows) {
  return rows
    .filter((item) => Number(item?.gap_total || 0) > 0 || String(item?.status || '') === 'Not Filled')
    .slice()
    .sort((a, b) => {
      if ((b.gap_total || 0) !== (a.gap_total || 0)) return (b.gap_total || 0) - (a.gap_total || 0);
      if ((a.completion_pct || 0) !== (b.completion_pct || 0)) return (a.completion_pct || 0) - (b.completion_pct || 0);
      return String(a.recruiter_name || '').localeCompare(String(b.recruiter_name || ''));
    })
    .slice(0, 8);
}

function matchStatus(row, filterValue) {
  if (filterValue === 'all') return true;
  const status = String(row?.status || '').toLowerCase();
  if (filterValue === 'top') return status.includes('top');
  if (filterValue === 'track') return status.includes('track');
  if (filterValue === 'average') return status.includes('average') || status.includes('saved');
  if (filterValue === 'attention') return status.includes('attention');
  if (filterValue === 'not-filled') return status.includes('not filled');
  return true;
}

function buildExportHtml(rows, summary, period, applied) {
  const header = `
    <tr>
      <th>Name</th>
      <th>Role</th>
      <th>Period</th>
      <th>Submission Done</th>
      <th>Submission Target</th>
      <th>Submission Gap</th>
      <th>Interview Done</th>
      <th>Interview Target</th>
      <th>Interview Gap</th>
      <th>Selection Done</th>
      <th>Selection Target</th>
      <th>Selection Gap</th>
      <th>Joining Done</th>
      <th>Joining Target</th>
      <th>Joining Gap</th>
      <th>Total Target</th>
      <th>Total Done</th>
      <th>Total Gap</th>
      <th>Completion %</th>
      <th>Status</th>
      <th>Notes</th>
    </tr>`;

  const body = rows.map((row) => `
    <tr>
      <td>${row.recruiter_name || ''}</td>
      <td>${row.designation || ''}</td>
      <td>${row.period_label || ''}</td>
      <td>${row.submission_done || 0}</td>
      <td>${row.submission_target || 0}</td>
      <td>${row.submission_gap || 0}</td>
      <td>${row.interview_done || 0}</td>
      <td>${row.interview_target || 0}</td>
      <td>${row.interview_gap || 0}</td>
      <td>${row.selection_done || 0}</td>
      <td>${row.selection_target || 0}</td>
      <td>${row.selection_gap || 0}</td>
      <td>${row.joining_done || 0}</td>
      <td>${row.joining_target || 0}</td>
      <td>${row.joining_gap || 0}</td>
      <td>${row.target_total || 0}</td>
      <td>${row.done_total || 0}</td>
      <td>${row.gap_total || 0}</td>
      <td>${row.completion_pct || 0}%</td>
      <td>${row.status || ''}</td>
      <td>${row.notes || ''}</td>
    </tr>`).join('');

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body{font-family:Segoe UI,Arial,sans-serif;padding:20px;}
          h1{margin:0 0 6px;font-size:24px;}
          p{margin:4px 0 10px;color:#334155;}
          table{border-collapse:collapse;width:100%;}
          th,td{border:1px solid #cbd5e1;padding:8px 10px;font-size:12px;text-align:left;vertical-align:top;}
          th{background:#e2e8f0;font-weight:700;}
          .summary td{font-weight:700;background:#f8fafc;}
        </style>
      </head>
      <body>
        <h1>Goal Post Export</h1>
        <p><strong>View:</strong> ${period}</p>
        <p><strong>Applied Filters:</strong> ${applied}</p>
        <table class="summary">
          <tr><td>Total Target</td><td>${summary.target_total || 0}</td><td>Total Done</td><td>${summary.done_total || 0}</td><td>Total Gap</td><td>${summary.gap_total || 0}</td><td>Completion</td><td>${summary.completion_pct || 0}%</td></tr>
        </table>
        <br />
        <table>
          <thead>${header}</thead>
          <tbody>${body}</tbody>
        </table>
      </body>
    </html>`;
}

export default function GoalPostPage() {
  const { user } = useAuth();
  const normalizedRole = String(user?.role || '').toLowerCase();
  const leadership = ['admin', 'manager', 'tl'].includes(normalizedRole);
  const [period, setPeriod] = useState('daily');
  const [serverFilters, setServerFilters] = useState(() => ({
    user_id: '',
    duration: 'last7',
    date_from: addDays(todayYmd(), -6),
    date_to: todayYmd(),
  }));
  const [viewFilters, setViewFilters] = useState(() => ({
    status: 'all',
    metric: 'all',
    search: '',
    min_done: '',
    min_gap: '',
  }));
  const [payload, setPayload] = useState({ items: [], users: [], summary: {}, leaderboard: [], attention: [], editor: { entry: emptyEntry(user?.user_id, todayYmd()), reference: {} } });
  const [form, setForm] = useState(() => emptyEntry(user?.user_id, todayYmd()));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!leadership) {
      setServerFilters((current) => ({ ...current, user_id: user?.user_id || '' }));
      setForm((current) => ({ ...current, user_id: user?.user_id || current.user_id || '' }));
    }
  }, [leadership, user?.user_id]);

  async function load() {
    const params = new URLSearchParams();
    params.set('period', period);
    if (serverFilters.date_from) params.set('date_from', serverFilters.date_from);
    if (serverFilters.date_to) params.set('date_to', serverFilters.date_to);
    if (leadership && serverFilters.user_id) params.set('user_id', serverFilters.user_id);
    params.set('editor_user_id', leadership ? (form.user_id || serverFilters.user_id || user?.user_id || '') : (user?.user_id || ''));
    params.set('editor_date', form.date || todayYmd());
    const data = await api.get(`/api/goal-post?${params.toString()}`, { cacheTtlMs: 0, retries: 0, timeoutMs: 20000 });
    setPayload(data || {});
    const entry = data?.editor?.entry || emptyEntry(data?.editor?.user_id || user?.user_id, data?.editor?.date || todayYmd());
    setForm({
      ...emptyEntry(data?.editor?.user_id || user?.user_id, data?.editor?.date || todayYmd()),
      ...entry,
      user_id: data?.editor?.user_id || entry.user_id || user?.user_id || '',
      date: data?.editor?.date || entry.date || todayYmd(),
    });
  }

  useEffect(() => { load().catch(() => {}); }, [period, serverFilters.user_id, serverFilters.date_from, serverFilters.date_to]);
  useEffect(() => { if (form.user_id || form.date) load().catch(() => {}); }, [form.user_id, form.date]);
  usePolling(load, 180000, [period, serverFilters.user_id, serverFilters.date_from, serverFilters.date_to, form.user_id, form.date]);

  const reference = payload.editor?.reference || {};
  const users = payload.users || [];
  const rows = payload.items || [];

  const userOptions = useMemo(() => users.filter((item) => ['admin', 'manager', 'tl', 'recruiter'].includes(String(item.role || '').toLowerCase())), [users]);

  const filteredRows = useMemo(() => {
    const searchText = String(viewFilters.search || '').trim().toLowerCase();
    const selectedMetric = viewFilters.metric === 'all' ? '' : viewFilters.metric;
    const minDone = viewFilters.min_done === '' ? null : Number(viewFilters.min_done || 0);
    const minGap = viewFilters.min_gap === '' ? null : Number(viewFilters.min_gap || 0);

    return rows.filter((row) => {
      if (searchText) {
        const hay = `${row.recruiter_name || ''} ${row.designation || ''} ${row.recruiter_code || ''} ${row.period_label || ''}`.toLowerCase();
        if (!hay.includes(searchText)) return false;
      }
      if (!matchStatus(row, viewFilters.status)) return false;
      if (selectedMetric) {
        if (minDone !== null && Number(row?.[`${selectedMetric}_done`] || 0) < minDone) return false;
        if (minGap !== null && Number(row?.[`${selectedMetric}_gap`] || 0) < minGap) return false;
      } else {
        if (minDone !== null && Number(row?.done_total || 0) < minDone) return false;
        if (minGap !== null && Number(row?.gap_total || 0) < minGap) return false;
      }
      return true;
    });
  }, [rows, viewFilters]);

  const derivedSummary = useMemo(() => summaryFromRows(filteredRows), [filteredRows]);
  const derivedLeaderboard = useMemo(() => leaderboardFromRows(filteredRows), [filteredRows]);
  const derivedAttention = useMemo(() => attentionFromRows(filteredRows), [filteredRows]);

  async function saveEntry(event) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await api.post('/api/goal-post', {
        ...form,
        user_id: leadership ? form.user_id : (user?.user_id || form.user_id),
      }, { timeoutMs: 25000 });
      setMessage('Goal Post updated successfully.');
      await load();
    } catch (error) {
      setMessage(error.message || 'Goal Post update failed.');
    } finally {
      setSaving(false);
    }
  }

  function setDurationPreset(preset) {
    const today = todayYmd();
    if (preset === 'today') {
      setServerFilters((current) => ({ ...current, duration: preset, date_from: today, date_to: today }));
      return;
    }
    if (preset === 'last30') {
      setServerFilters((current) => ({ ...current, duration: preset, date_from: addDays(today, -29), date_to: today }));
      return;
    }
    if (preset === 'month') {
      setServerFilters((current) => ({ ...current, duration: preset, date_from: startOfMonth(today), date_to: today }));
      return;
    }
    if (preset === 'custom') {
      setServerFilters((current) => ({ ...current, duration: preset }));
      return;
    }
    setServerFilters((current) => ({ ...current, duration: 'last7', date_from: addDays(today, -6), date_to: today }));
  }

  function applyQuickRange(nextPeriod) {
    const today = todayYmd();
    if (nextPeriod === 'monthly') {
      setServerFilters((current) => ({ ...current, date_from: addDays(today, -89), date_to: today, duration: 'custom' }));
    } else if (nextPeriod === 'weekly') {
      setServerFilters((current) => ({ ...current, date_from: addDays(today, -27), date_to: today, duration: 'custom' }));
    } else {
      setServerFilters((current) => ({ ...current, date_from: addDays(today, -6), date_to: today, duration: 'last7' }));
    }
    setPeriod(nextPeriod);
  }

  function exportDetails() {
    const applied = [
      `Duration: ${serverFilters.duration === 'custom' ? `${serverFilters.date_from} to ${serverFilters.date_to}` : serverFilters.duration}`,
      `Status: ${viewFilters.status}`,
      `Metric: ${viewFilters.metric}`,
      leadership ? `Recruiter: ${serverFilters.user_id ? (userOptions.find((item) => item.user_id === serverFilters.user_id)?.full_name || 'Selected') : 'All Team'}` : `Recruiter: ${user?.full_name || 'Self'}`,
      viewFilters.search ? `Search: ${viewFilters.search}` : '',
      viewFilters.min_done !== '' ? `Min Done: ${viewFilters.min_done}` : '',
      viewFilters.min_gap !== '' ? `Min Gap: ${viewFilters.min_gap}` : '',
    ].filter(Boolean).join(' | ');

    const html = buildExportHtml(filteredRows, derivedSummary, period, applied);
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = `goal-post-${period}-${serverFilters.date_from}-to-${serverFilters.date_to}.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(href);
  }

  return (
    <Layout title="Goal Post" subtitle="Track goals, gaps, performance ranking and export in one clean view.">
      <div className="goalpost-shell-page fade-up goalpost-shell">
        <div className="glassy-card goalpost-hero-panel-main goalpost-hero-panel">
          <div>
            <div className="table-title">Goal Post Tracker</div>
            <div className="helper-text">Track daily goals, live gaps, recruiter performance and export the exact filtered view.</div>
          </div>
          <div className="goalpost-period-switch">
            {['daily', 'weekly', 'monthly'].map((item) => (
              <button key={item} type="button" className={`bucket-quick-pill bounceable ${period === item ? 'active' : ''}`} onClick={() => applyQuickRange(item)}>
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {!!message && <div className="panel top-gap-small"><div className="helper-text">{message}</div></div>}
        {!payload.storage_ready && payload.storage_message && <div className="panel top-gap-small"><div className="helper-text">{payload.storage_message}</div></div>}

        <div className="goalpost-summary-grid-main top-gap-small goal-summary-grid">
          <div className="stat-card goalpost-summary-card goalpost-target-card goal-card-soft goal-card-target">
            <span className="stat-label">Total Target</span>
            <strong className="stat-value">{formatNumber(derivedSummary.target_total)}</strong>
            <small>{formatNumber(derivedSummary.done_total)} completed in this filtered view</small>
          </div>
          <div className={`stat-card goalpost-summary-card goal-card-soft goal-card-gap tone-${gapTone(derivedSummary.gap_total)}`}>
            <span className="stat-label">Open Gap</span>
            <strong className="stat-value">{formatNumber(derivedSummary.gap_total)}</strong>
            <small>{derivedSummary.completion_pct || 0}% overall completion</small>
          </div>
          {Object.entries(METRIC_CONFIG).map(([metric, config]) => (
            <div key={metric} className={`stat-card goalpost-metric-card goal-card-soft metric-tone-${config.tone} tone-${gapTone(derivedSummary[`${metric}_gap`])}`}>
              <span className="stat-label">{config.label}</span>
              <strong className="stat-value">{formatNumber(derivedSummary[`${metric}_done`])} / {formatNumber(derivedSummary[`${metric}_target`])}</strong>
              <small>Gap {formatNumber(derivedSummary[`${metric}_gap`])}</small>
            </div>
          ))}
        </div>

        <div className="table-panel top-gap glassy-card goal-filter-panel">
          <div className="table-toolbar goalpost-filter-toolbar">
            <div>
              <div className="table-title">Smart Filters</div>
              <div className="helper-text">Check recruiter wise, duration wise, status wise and metric wise performance from one place.</div>
            </div>
            <div className="goalpost-filter-grid-main goal-filter-grid">
              {leadership && (
                <div className="field goal-filter-field">
                  <label>Recruiter</label>
                  <select value={serverFilters.user_id} onChange={(e) => setServerFilters((current) => ({ ...current, user_id: e.target.value }))}>
                    <option value="">All Team</option>
                    {userOptions.map((item) => <option key={item.user_id} value={item.user_id}>{item.full_name} • {item.designation}</option>)}
                  </select>
                </div>
              )}
              <div className="field goal-filter-field">
                <label>Duration</label>
                <select value={serverFilters.duration} onChange={(e) => setDurationPreset(e.target.value)}>
                  <option value="today">Today</option>
                  <option value="last7">Last 7 Days</option>
                  <option value="last30">Last 30 Days</option>
                  <option value="month">This Month</option>
                  <option value="custom">Custom Range</option>
                </select>
              </div>
              <div className="field goal-filter-field">
                <label>Status</label>
                <select value={viewFilters.status} onChange={(e) => setViewFilters((current) => ({ ...current, status: e.target.value }))}>
                  <option value="all">All Status</option>
                  <option value="top">Top Performer</option>
                  <option value="track">On Track</option>
                  <option value="average">Average</option>
                  <option value="attention">Needs Attention</option>
                  <option value="not-filled">Not Filled</option>
                </select>
              </div>
              <div className="field goal-filter-field">
                <label>Check By</label>
                <select value={viewFilters.metric} onChange={(e) => setViewFilters((current) => ({ ...current, metric: e.target.value }))}>
                  <option value="all">Overall</option>
                  <option value="submission">Submission Wise</option>
                  <option value="interview">Interview Wise</option>
                  <option value="selection">Selection Wise</option>
                  <option value="joining">Joining Wise</option>
                </select>
              </div>
              <div className="field goal-filter-field">
                <label>Search Name / Role</label>
                <input type="text" value={viewFilters.search} onChange={(e) => setViewFilters((current) => ({ ...current, search: e.target.value }))} placeholder="Type recruiter name, code or role" />
              </div>
              <div className="field goal-filter-field">
                <label>Minimum Done</label>
                <input type="number" min="0" value={viewFilters.min_done} onChange={(e) => setViewFilters((current) => ({ ...current, min_done: e.target.value }))} placeholder="0" />
              </div>
              <div className="field goal-filter-field">
                <label>Minimum Gap</label>
                <input type="number" min="0" value={viewFilters.min_gap} onChange={(e) => setViewFilters((current) => ({ ...current, min_gap: e.target.value }))} placeholder="0" />
              </div>
              {serverFilters.duration === 'custom' && (
                <>
                  <div className="field goal-filter-field">
                    <label>From</label>
                    <input type="date" value={serverFilters.date_from} onChange={(e) => setServerFilters((current) => ({ ...current, date_from: e.target.value }))} />
                  </div>
                  <div className="field goal-filter-field">
                    <label>To</label>
                    <input type="date" value={serverFilters.date_to} onChange={(e) => setServerFilters((current) => ({ ...current, date_to: e.target.value }))} />
                  </div>
                </>
              )}
            </div>
            <div className="goal-filter-actions">
              <button type="button" className="ghost-btn bounceable" onClick={() => {
                const today = todayYmd();
                setServerFilters((current) => ({ ...current, duration: 'last7', date_from: addDays(today, -6), date_to: today, user_id: leadership ? '' : (user?.user_id || '') }));
                setViewFilters({ status: 'all', metric: 'all', search: '', min_done: '', min_gap: '' });
              }}>Reset Filters</button>
              <button type="button" className="add-profile-btn bounceable" onClick={exportDetails}>Export Details</button>
            </div>
          </div>
        </div>

        <div className="goalpost-layout-grid-main top-gap goal-layout-grid">
          <form className="table-panel glassy-card goalpost-editor-panel-main goal-editor-panel" onSubmit={saveEntry}>
            <div className="table-title">Set Goal</div>
            <div className="helper-text">Set daily targets here. Manual done values can override live CRM counts when needed. Fill this before logout.</div>
            <div className="goalpost-editor-grid-main top-gap-small goal-editor-grid">
              {leadership && <div className="field goal-editor-head-field"><label>Employee</label><select value={form.user_id} onChange={(e) => setForm((current) => ({ ...current, user_id: e.target.value }))}>{userOptions.map((item) => <option key={item.user_id} value={item.user_id}>{item.full_name} • {item.designation}</option>)}</select></div>}
              <div className="field goal-editor-head-field"><label>Date</label><input type="date" value={form.date} onChange={(e) => setForm((current) => ({ ...current, date: e.target.value }))} /></div>
            </div>
            <div className="goalpost-entry-matrix top-gap-small">
              {Object.entries(METRIC_CONFIG).map(([key, config]) => (
                <div key={key} className={`goalpost-metric-editor-card goal-editor-metric-card metric-tone-${config.tone}`}>
                  <div className="panel-title">{config.plural}</div>
                  <div className="helper-text">Live CRM Count: {formatNumber(reference[`${key}_auto`] || 0)}</div>
                  <div className="field top-gap-small"><label>Target</label><input type="number" min="0" value={form[`${key}_target`] ?? ''} onChange={(e) => setForm((current) => ({ ...current, [`${key}_target`]: e.target.value }))} /></div>
                  <div className="field top-gap-small"><label>Done</label><input type="number" min="0" value={form[`${key}_done`] ?? ''} onChange={(e) => setForm((current) => ({ ...current, [`${key}_done`]: e.target.value }))} placeholder="Leave blank to use live CRM count" /></div>
                </div>
              ))}
            </div>
            <div className="field top-gap"><label>Manager / Recruiter Notes</label><textarea rows="4" value={form.notes || ''} onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))} placeholder="Reason for gap, blocker, follow-up plan or manager note." /></div>
            <div className="row-actions top-gap">
              <button className="add-profile-btn bounceable" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Goal Entry'}</button>
            </div>
          </form>

          <div className="goalpost-side-panels">
            <div className="table-panel glassy-card goal-side-card goal-board-card">
              <div className="goal-board-header">
                <div className="table-title">Leaderboard</div>
                <div className="helper-text">Top performers and at-risk recruiters in the current filtered view.</div>
              </div>

              <div className="goal-board-section goal-board-top top-gap-small">
                <div className="goal-board-section-title">Top Performers</div>
                <div className="goalpost-rank-list top-gap-small">
                  {derivedLeaderboard.length ? derivedLeaderboard.map((item) => (
                    <div key={`${item.user_id}-${item.rank}`} className={`goalpost-rank-row tone-${statusTone(item.status)}`}>
                      <div className="goalpost-rank-copy">
                        <strong>#{item.rank} {item.recruiter_name}</strong>
                        <div className="helper-text">{item.designation} • {item.period_label}</div>
                      </div>
                      <div className="goalpost-rank-score">{item.completion_pct}%</div>
                    </div>
                  )) : <div className="helper-text">No leaderboard data available in the selected range.</div>}
                </div>
              </div>

              <div className="goal-board-section goal-board-attention top-gap">
                <div className="goal-board-section-title">Needs Attention</div>
                <div className="goalpost-rank-list top-gap-small">
                  {derivedAttention.length ? derivedAttention.map((item, index) => (
                    <div key={`${item.user_id}-${index}-${item.period_start}`} className={`goalpost-rank-row tone-${statusTone(item.status)}`}>
                      <div className="goalpost-rank-copy">
                        <strong>{item.recruiter_name}</strong>
                        <div className="helper-text">{item.period_label} • {item.status}</div>
                      </div>
                      <div className="goalpost-rank-score">Gap {formatNumber(item.gap_total)}</div>
                    </div>
                  )) : <div className="helper-text">No pending attention rows.</div>}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="table-panel top-gap glassy-card goal-history-panel">
          <div className="table-toolbar">
            <div>
              <div className="table-title">Goal Post History</div>
              <div className="helper-text">Only the filtered rows are shown here, and exports use the same filtered view.</div>
            </div>
            <div className="selection-count-chip">Rows: {filteredRows.length}</div>
          </div>
          <div className="crm-table-wrap dense-wrap top-gap-small">
            <table className="crm-table colorful-table dense-table goalpost-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Period</th>
                  <th>Submission</th>
                  <th>Interview</th>
                  <th>Selection</th>
                  <th>Joining</th>
                  <th>Target</th>
                  <th>Done</th>
                  <th>Gap</th>
                  <th>Score</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, index) => (
                  <tr key={`${row.user_id}-${row.period_start}-${index}`} className={`goalpost-row-${statusTone(row.status)}`}>
                    <td>
                      <strong>{row.recruiter_name}</strong>
                      <div className="helper-text">{row.designation || '-'} • {row.recruiter_code || '-'}</div>
                    </td>
                    <td>{row.period_label}</td>
                    <td>{formatNumber(row.submission_done)} / {formatNumber(row.submission_target)}<div className="helper-text">Gap {formatNumber(row.submission_gap)}</div></td>
                    <td>{formatNumber(row.interview_done)} / {formatNumber(row.interview_target)}<div className="helper-text">Gap {formatNumber(row.interview_gap)}</div></td>
                    <td>{formatNumber(row.selection_done)} / {formatNumber(row.selection_target)}<div className="helper-text">Gap {formatNumber(row.selection_gap)}</div></td>
                    <td>{formatNumber(row.joining_done)} / {formatNumber(row.joining_target)}<div className="helper-text">Gap {formatNumber(row.joining_gap)}</div></td>
                    <td>{formatNumber(row.target_total)}</td>
                    <td>{formatNumber(row.done_total)}</td>
                    <td>{formatNumber(row.gap_total)}</td>
                    <td>{row.completion_pct}%</td>
                    <td><span className={`revenue-status-pill ${statusTone(row.status)}`}>{row.status}</span></td>
                  </tr>
                ))}
                {!filteredRows.length && <tr><td colSpan="11" className="helper-text">No Goal Post history found for the selected filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}
