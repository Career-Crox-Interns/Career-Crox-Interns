import React, { useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';

function n(value) { return Number(value || 0); }
function fmt(value) { return new Intl.NumberFormat('en-IN').format(n(value)); }
function lower(value) { return String(value || '').trim().toLowerCase(); }
function when(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '-');
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
}
function roleLabel(value) { return String(value || '-').replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()); }

function MetricCard({ label, value, note, tone = 'blue' }) {
  return (
    <div className={`metric-card colorful-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

export default function PerformancePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Click Update Details to load the latest performance snapshot.');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const payload = await api.get('/api/performance-centre?live=1', {
        cacheTtlMs: 45000,
        timeoutMs: 45000,
        retries: 1,
        allowStale: true,
        background: false,
      });
      setData(payload || {});
      setStatus(`Updated at ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`);
    } catch (err) {
      setError(err.message || 'Performance data could not load.');
      setStatus('Update failed. Use Refresh after a few seconds.');
    } finally {
      setLoading(false);
    }
  }

  const rows = useMemo(() => Array.isArray(data?.items) ? data.items : [], [data]);
  const activities = useMemo(() => Array.isArray(data?.activity_items) ? data.activity_items : [], [data]);
  const filteredRows = useMemo(() => {
    const q = lower(search);
    return rows.filter((row) => {
      if (!q) return true;
      return [row.full_name, row.recruiter_code, row.role, row.designation].some((value) => lower(value).includes(q));
    });
  }, [rows, search]);
  const filteredActivities = useMemo(() => activities.filter((row) => {
    if (category !== 'all' && lower(row.category) !== category) return false;
    return true;
  }).slice(0, 80), [activities, category]);

  const totals = useMemo(() => ({
    users: rows.length,
    submissions: rows.reduce((s, r) => s + n(r.submissions_count), 0),
    calls: rows.reduce((s, r) => s + n(r.calls_count), 0),
    whatsapp: rows.reduce((s, r) => s + n(r.whatsapp_count), 0),
    profiles: rows.reduce((s, r) => s + n(r.profiles_opened_count), 0),
    interviews: rows.reduce((s, r) => s + n(r.interviews_count), 0),
    breakMinutes: rows.reduce((s, r) => s + n(r.break_minutes), 0),
    noCall: rows.reduce((s, r) => s + n(r.no_call_30), 0),
  }), [rows]);

  return (
    <Layout title="Performance Centre" subtitle="Manual performance snapshot with stable cached refresh.">
      <style>{`
        .performance-control{display:flex;gap:12px;justify-content:space-between;align-items:center;flex-wrap:wrap;margin-top:10px}
        .performance-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:12px}
        .performance-panel{background:linear-gradient(135deg,rgba(255,255,255,.96),rgba(239,247,255,.96));border:1px solid rgba(192,213,255,.72);border-radius:24px;box-shadow:0 18px 44px rgba(16,24,40,.08);padding:16px;margin-top:14px}
        .performance-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
        .performance-input{border:1px solid #cfe0ff;border-radius:16px;padding:12px 14px;font-weight:800;background:#fff;color:#12213a;min-width:240px}
        .performance-btn{border:0;border-radius:16px;padding:13px 18px;font-weight:1000;color:#fff;background:linear-gradient(135deg,#06b6d4,#2563eb,#8b5cf6);box-shadow:0 14px 28px rgba(37,99,235,.2);cursor:pointer}
        .performance-btn:disabled{opacity:.55;cursor:not-allowed;box-shadow:none}
        .performance-table{min-width:1180px}
        .performance-table td,.performance-table th{white-space:nowrap}
        .performance-status{font-weight:900;color:#3d5f8f}
        @media(max-width:1100px){.performance-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      `}</style>

      <div className="performance-control fade-up">
        <div>
          <div className="table-title">Performance Control Room</div>
          <div className="helper-text performance-status">{status}</div>
          {error ? <div className="helper-text sync-message is-error">{error}</div> : null}
        </div>
        <div className="performance-actions">
          <input className="performance-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search recruiter, code or role" />
          <button type="button" className="performance-btn" onClick={load} disabled={loading}>{loading ? 'Updating...' : 'Update Details'}</button>
        </div>
      </div>

      <div className="performance-grid fade-up">
        <MetricCard label="Team Users" value={fmt(totals.users)} note="Loaded users" tone="blue" />
        <MetricCard label="Submissions" value={fmt(totals.submissions)} note="Window count" tone="purple" />
        <MetricCard label="Calls" value={fmt(totals.calls)} note="Logged call activity" tone="sky" />
        <MetricCard label="WhatsApp" value={fmt(totals.whatsapp)} note="Tracked opens" tone="green" />
        <MetricCard label="Profiles Open" value={fmt(totals.profiles)} note="Candidate views" tone="orange" />
        <MetricCard label="Interviews" value={fmt(totals.interviews)} note="Scheduled rows" tone="blue" />
        <MetricCard label="Break Minutes" value={fmt(totals.breakMinutes)} note="Current day total" tone="red" />
        <MetricCard label="No Call 30m" value={fmt(totals.noCall)} note="Watch flag" tone="purple" />
      </div>

      <div className="performance-panel fade-up">
        <div className="table-toolbar no-wrap-toolbar">
          <div>
            <div className="table-title">Leaderboard</div>
            <div className="helper-text">Rows load only when Update Details is clicked.</div>
          </div>
          <span className="metric-mini-chip records">{filteredRows.length} rows</span>
        </div>
        <div className="crm-table-wrap dense-wrap top-gap-small">
          <table className="crm-table colorful-table dense-table performance-table">
            <thead>
              <tr>
                <th>Rank</th><th>Recruiter</th><th>Code</th><th>Role</th><th>Submissions</th><th>Calls</th><th>WhatsApp</th><th>Profiles</th><th>Interviews</th><th>Breaks</th><th>Break Min</th><th>Work Min</th><th>Idle Min</th><th>Last Activity</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, index) => (
                <tr key={row.user_id || row.recruiter_code || index}>
                  <td>{index + 1}</td>
                  <td><strong>{row.full_name || '-'}</strong></td>
                  <td>{row.recruiter_code || '-'}</td>
                  <td>{roleLabel(row.role || row.designation)}</td>
                  <td>{fmt(row.submissions_count)}</td>
                  <td>{fmt(row.calls_count)}</td>
                  <td>{fmt(row.whatsapp_count)}</td>
                  <td>{fmt(row.profiles_opened_count)}</td>
                  <td>{fmt(row.interviews_count)}</td>
                  <td>{fmt(row.break_count)}</td>
                  <td>{fmt(row.break_minutes)}</td>
                  <td>{fmt(row.work_minutes)}</td>
                  <td>{fmt(row.idle_minutes)}</td>
                  <td>{when(row.last_activity_at)}</td>
                  <td><span className={`status-chip ${row.active_break ? 'secondary' : ''}`}>{row.active_break ? 'On Break' : 'Active'}</span></td>
                </tr>
              ))}
              {!filteredRows.length ? <tr><td colSpan="15" className="helper-text">No performance data loaded yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="performance-panel fade-up">
        <div className="table-toolbar no-wrap-toolbar">
          <div>
            <div className="table-title">Activity Stream</div>
            <div className="helper-text">Filtered from the loaded snapshot.</div>
          </div>
          <select className="performance-input" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All Categories</option>
            <option value="submission">Submission</option>
            <option value="interview">Interview</option>
            <option value="calls">Calls</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="profiles_open">Profiles Open</option>
          </select>
        </div>
        <div className="crm-table-wrap dense-wrap top-gap-small">
          <table className="crm-table colorful-table dense-table performance-table">
            <thead><tr><th>#</th><th>Time</th><th>Recruiter</th><th>Code</th><th>Category</th><th>Action</th><th>Candidate</th></tr></thead>
            <tbody>
              {filteredActivities.map((row, index) => (
                <tr key={row.activity_id || `${row.created_at}-${index}`}>
                  <td>{index + 1}</td>
                  <td>{when(row.created_at)}</td>
                  <td>{row.full_name || '-'}</td>
                  <td>{row.recruiter_code || '-'}</td>
                  <td>{row.category || '-'}</td>
                  <td>{row.action_label || row.action_type || '-'}</td>
                  <td>{row.candidate_name || row.candidate_id || '-'}</td>
                </tr>
              ))}
              {!filteredActivities.length ? <tr><td colSpan="7" className="helper-text">No activity rows loaded.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
