import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { useAuth } from '../lib/auth';

const BREAK_TYPES = ['Tea Break', 'Washroom Break', 'Lunch Break', 'Meeting Break', 'Custom Break'];
const PRESET_MINUTES = ['10', '15', '20', '30', '45', '60'];

function formatMinutes(total) {
  const mins = Number(total || 0);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function formatClock(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { hour12: true, year: 'numeric', month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit' });
}

function buildTimer(targetIso) {
  if (!targetIso) return { overdue: false, text: '00:00:00' };
  const diff = new Date(targetIso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const hrs = String(Math.floor(abs / 3600000)).padStart(2, '0');
  const mins = String(Math.floor((abs % 3600000) / 60000)).padStart(2, '0');
  const secs = String(Math.floor((abs % 60000) / 1000)).padStart(2, '0');
  return { overdue: diff < 0, text: `${hrs}:${mins}:${secs}` };
}

function MetricCard({ label, value, tone = 'blue', helper }) {
  return (
    <div className={`metric-card colorful-card fade-up attendance-metric-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {helper ? <small>{helper}</small> : null}
    </div>
  );
}

export default function AttendancePage() {
  const { user } = useAuth();
  const leadership = ['admin', 'manager', 'tl'].includes(user?.role);
  const [state, setState] = useState(null);
  const [breakReason, setBreakReason] = useState('Tea Break');
  const [presetMinutes, setPresetMinutes] = useState('15');
  const [customMinutes, setCustomMinutes] = useState('');
  const [reason, setReason] = useState('Break limit exceeded. Request CRM unlock approval.');
  const [busy, setBusy] = useState('');
  const [lastError, setLastError] = useState('');
  const [showLogs, setShowLogs] = useState(false);
  const [showPresence, setShowPresence] = useState(false);
  const [, setTick] = useState(0);

  async function load() {
    try {
      const data = await api.get('/api/attendance');
      setState(data);
      setLastError('');
    } catch (err) {
      setLastError(err?.message || 'Attendance load failed');
    }
  }

  useEffect(() => { load(); }, []);
  usePolling(load, 4000, []);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  async function doAction(type, path, payload = {}) {
    try {
      setBusy(type);
      await api.post(path, payload, { timeoutMs: 40000 });
      await load();
    } catch (err) {
      setLastError(err?.message || 'Action failed');
    } finally {
      setBusy('');
    }
  }

  const todayStats = useMemo(() => state?.today_stats || {}, [state]);
  const presence = state?.presence || {};
  const joined = Boolean(todayStats.joined_today);
  const onBreak = String(presence?.is_on_break || '0') === '1';
  const locked = String(presence?.locked || '0') === '1';
  const timer = buildTimer(presence?.break_expected_end_at);
  const plannedMinutes = customMinutes.trim() ? customMinutes.trim() : presetMinutes;
  const canStartBreak = joined && !onBreak && !locked;
  const canEndBreak = joined && onBreak && !timer.overdue;
  const team = state?.team_working || [];
  const logs = state?.logs || [];
  const requests = state?.requests || [];
  const lockedCount = team.filter((row) => String(row.locked || '0') === '1').length;
  const onBreakCount = team.filter((row) => String(row.is_on_break || '0') === '1').length;
  const activeCount = Math.max(team.length - lockedCount, 0);
  const logPreview = logs.slice(0, 4);

  if (!state) {
    return <Layout title="Attendance & Breaks" subtitle="Loading attendance dashboard." />;
  }

  return (
    <Layout title="Attendance & Breaks" subtitle="Break timer, work summary, lock state, and colorful snapshot cards without the ugly pink sludge.">
      {lastError && <div className="helper-text top-gap">{lastError}</div>}

      <div className="small-grid six top-gap attendance-card-grid">
        <MetricCard label="Working Now" value={String(activeCount)} tone="blue" helper={leadership ? 'Team active' : 'You are active'} />
        <MetricCard label="On Track" value={todayStats.day_status || 'No Work Day'} tone="green" helper={`${formatMinutes(todayStats.productive_work_minutes)} worked`} />
        <MetricCard label="Locked" value={String(lockedCount)} tone="orange" helper={leadership ? 'Team locks' : (locked ? 'CRM locked' : 'CRM open')} />
        <MetricCard label="Break Used" value={formatMinutes(todayStats.total_break_minutes)} tone="purple" helper="Used today" />
        <MetricCard label="Break Taken" value={todayStats.break_count || '0'} tone="cyan" helper="Started today" />
        <MetricCard label="Remaining" value={formatMinutes(todayStats.remaining_work_minutes)} tone="pinkless" helper={`${formatMinutes(todayStats.remaining_break_minutes)} break left`} />
      </div>

      <div className="attendance-progress-band top-gap single-band">
        <div className="attendance-progress-card">
          <div>
            <div className="panel-title">Work Progress</div>
            <div className="helper-text top-gap-small">Joined: {formatClock(todayStats.joined_at)} • Productive: {formatMinutes(todayStats.productive_work_minutes)} • Break room left: {formatMinutes(todayStats.remaining_break_minutes)} • Status: {todayStats.day_status || 'No Work Day'}</div>
          </div>
          <div className="attendance-progress-bar"><span style={{ width: `${Math.min(100, Math.round((Number(todayStats.productive_work_minutes || 0) / 480) * 100))}%` }} /></div>
        </div>
      </div>

      <div className="attendance-ref-grid top-gap">
        <div className="panel premium-break-panel ref-break-panel">
          <div className="panel-heading-row">
            <div>
              <div className="panel-title">Break Control</div>
              <div className="helper-text">Break timer with dropdowns, preset minutes, custom minutes, and controlled start/end actions.</div>
            </div>
            <div className="break-mode-chip">{leadership ? 'Leadership view' : onBreak ? 'Break running' : joined ? 'Ready' : 'Join Office first'}</div>
          </div>

          <div className="attendance-form-grid top-gap-small">
            <div className="field accent-field">
              <label>Break Type</label>
              <select className="inline-input" value={breakReason} onChange={(e) => setBreakReason(e.target.value)} disabled={!joined || onBreak}>
                {BREAK_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div className="field accent-field">
              <label>Preset Minutes</label>
              <select className="inline-input" value={presetMinutes} onChange={(e) => setPresetMinutes(e.target.value)} disabled={!joined || onBreak}>
                {PRESET_MINUTES.map((item) => <option key={item} value={item}>{item} minutes</option>)}
              </select>
            </div>
            <div className="field accent-field">
              <label>Custom Minutes</label>
              <input className="inline-input" type="number" min="1" max="180" value={customMinutes} onChange={(e) => setCustomMinutes(e.target.value)} placeholder="17" disabled={!joined || onBreak} />
            </div>
          </div>

          <div className="premium-minute-row top-gap-small">
            {PRESET_MINUTES.map((item) => (
              <button key={item} type="button" className={`premium-minute-chip ${plannedMinutes === item && !customMinutes ? 'active' : ''}`} onClick={() => { setCustomMinutes(''); setPresetMinutes(item); }} disabled={!joined || onBreak}>{item}m</button>
            ))}
          </div>

          <div className="attendance-break-cta-row top-gap">
            <button className={`premium-cta-btn break-start ${busy === 'start-break' ? 'is-busy' : ''}`} disabled={!canStartBreak} onClick={() => doAction('start-break', '/api/attendance/start-break', { reason: breakReason, planned_minutes: plannedMinutes })}>Start Break</button>
            <button className={`premium-cta-btn break-end ${busy === 'end-break' ? 'is-busy' : ''}`} disabled={!canEndBreak} onClick={() => doAction('end-break', '/api/attendance/end-break', {})}>End Break</button>
          </div>
          <div className="helper-text top-gap-small">Join Office popup controls workday start. Start Break locks CRM immediately. End Break is the only active button while break is running.</div>
        </div>

        <div className="panel premium-unlock-panel break-unlock-panel">
          <div className="panel-title">Break Status</div>
          <div className="helper-text top-gap-small">Recruiter CRM stays blocked during break. If break exceeds then only unlock request popup should be used. TL / Manager can still monitor everyone from approvals.</div>
          <div className={`attendance-lock-status-card ${locked ? 'locked' : 'open'}`}>
            <div className="attendance-lock-status-label">CRM</div>
            <div className="attendance-lock-status-value">{locked ? 'LOCKED' : 'OPEN'}</div>
            <div className="attendance-lock-status-sub">{locked ? 'No CRM actions till unlock approval' : 'Ready for work or controlled break flow'}</div>
          </div>
        </div>
      </div>

      <div className="attendance-expand-grid top-gap">
        <div className="panel glassy-card fade-up no-scroll-panel">
          <div className="table-toolbar attendance-card-toolbar"><div className="table-title">{leadership ? 'Team Working Snapshot' : 'My Working Snapshot'}</div><button className="mini-btn view bounceable" type="button" onClick={() => setShowPresence((v) => !v)}>{showPresence ? 'Hide Details' : 'Show Details'}</button></div>
          <div className="attendance-mini-card-row top-gap-small">
            {(leadership ? team : team.slice(0, 1)).slice(0, 4).map((row) => (
              <div key={row.user_id} className={`attendance-person-card ${String(row.locked || '0') === '1' ? 'locked' : String(row.is_on_break || '0') === '1' ? 'break' : 'active'}`}>
                <div className="attendance-person-name">{row.full_name}</div>
                <div className="attendance-person-sub">{row.recruiter_code || row.role || '-'}</div>
                <div className="attendance-person-meta">{String(row.is_on_break || '0') === '1' ? (row.break_reason || 'On Break') : (String(row.locked || '0') === '1' ? 'Locked' : 'Working')}</div>
                <div className="attendance-person-time">{formatClock(row.last_seen_at)}</div>
              </div>
            ))}
            {!team.length && <div className="helper-text">No active users right now.</div>}
          </div>
          {showPresence && (
            <div className="crm-table-wrap dense-wrap top-gap-small">
              <table className="crm-table colorful-table dense-table compact-attendance-table">
                <thead><tr><th>Name</th><th>Recruiter Code</th><th>Role</th><th>Status</th><th>Last Seen</th></tr></thead>
                <tbody>
                  {team.map((row) => <tr key={row.user_id}><td>{row.full_name}</td><td>{row.recruiter_code || '-'}</td><td>{row.role || '-'}</td><td>{String(row.is_on_break || '0') === '1' ? (row.break_reason || 'Break') : String(row.locked || '0') === '1' ? 'Locked' : 'Working'}</td><td>{formatClock(row.last_seen_at)}</td></tr>)}
                  {!team.length && <tr><td colSpan="5" className="helper-text">No rows.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="panel glassy-card fade-up no-scroll-panel">
          <div className="table-toolbar attendance-card-toolbar"><div className="table-title">{leadership ? 'Break / Lock Logs' : 'My Break / Lock Logs'}</div><button className="mini-btn view bounceable" type="button" onClick={() => setShowLogs((v) => !v)}>{showLogs ? 'Hide Details' : 'Show Details'}</button></div>
          <div className="attendance-log-preview top-gap-small">
            {logPreview.map((row) => <div key={row.activity_id} className="attendance-log-card"><strong>{row.action_type}</strong><span>{formatClock(row.created_at)}</span><small>{row.metadata}</small></div>)}
            {!logPreview.length && <div className="helper-text">No logs yet.</div>}
          </div>
          {showLogs && (
            <div className="crm-table-wrap dense-wrap top-gap-small">
              <table className="crm-table colorful-table dense-table compact-attendance-table">
                <thead><tr><th>When</th><th>Action</th><th>Meta</th></tr></thead>
                <tbody>{logs.map((row) => <tr key={row.activity_id}><td>{formatClock(row.created_at)}</td><td>{row.action_type}</td><td>{row.metadata}</td></tr>)}{!logs.length && <tr><td colSpan="3" className="helper-text">No logs.</td></tr>}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="table-panel top-gap glassy-card fade-up">
        <div className="table-toolbar"><div className="table-title">{leadership ? 'All Unlock Requests' : 'My Unlock Requests'}</div></div>
        <div className="crm-table-wrap dense-wrap">
          <table className="crm-table colorful-table dense-table compact-attendance-table">
            <thead><tr><th>Request ID</th><th>Status</th><th>Reason</th><th>Requested At</th><th>Approved By</th></tr></thead>
            <tbody>{requests.map((row) => <tr key={row.request_id}><td>{row.request_id}</td><td>{row.status}</td><td>{row.reason}</td><td>{formatClock(row.requested_at)}</td><td>{row.approved_by_name || '-'}</td></tr>)}{!requests.length && <tr><td colSpan="5" className="helper-text">No unlock requests yet.</td></tr>}</tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
