import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const REPORT_COLUMNS = [
  ['Idle', 'idle_minutes'],
  ['Sub', 'submissions'],
  ['Dialed', 'dialed_calls'],
  ['Conn', 'connected_calls'],
  ['Incoming', 'incoming_calls'],
  ['Talk', 'talk_time_minutes'],
  ['Act%', 'activity_ratio'],
  ['Breaks', 'break_count'],
  ['Br Min', 'break_minutes'],
  ['Locks', 'crm_locks'],
  ['Pend Int', 'pending_interviews'],
  ['Miss Int', 'missed_interviews'],
  ['Office', 'office_minutes'],
  ['Active', 'active_work_minutes'],
  ['Worked', 'profiles_worked'],
];

const VIEW_BUTTONS = [
  { key: 'current', label: 'Current 30m' },
  { key: 'previous', label: 'Check Previous Report' },
  { key: 'day', label: 'Check All Day Report' },
];

function toneLabel(value) {
  if (value === 'green') return 'Top';
  if (value === 'red') return 'Low';
  return 'Watch';
}

function fmtTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
}

export default function SemiHourlyReportPage() {
  const { user } = useAuth();
  const [data, setData] = useState({ rows: [], summary: {}, generated_at: '', period_key: '', presets: [] });
  const [message, setMessage] = useState('');
  const [view, setView] = useState('current');
  const [sendingId, setSendingId] = useState('');
  const [selectedPresets, setSelectedPresets] = useState({});
  const reportId = useMemo(() => new URLSearchParams(window.location.search).get('reportId') || '', []);
  const leadership = ['admin', 'manager', 'tl'].includes(String(user?.role || '').toLowerCase());

  const generateReport = useCallback(async (nextView = view) => {
    setMessage('Generating egress-safe performance report...');
    try {
      const endpoint = reportId && nextView === 'current'
        ? `/api/reports/semi-hourly?report_id=${encodeURIComponent(reportId)}`
        : `/api/reports/semi-hourly?generate=1&window=${encodeURIComponent(nextView)}`;
      const next = await api.get(endpoint, { cacheTtlMs: 0 });
      setData(next || { rows: [], summary: {}, generated_at: '', period_key: '', presets: [] });
      setMessage('');
    } catch (err) {
      setMessage(err.message || 'Performance report could not load.');
    }
  }, [reportId, view]);

  useEffect(() => { generateReport('current'); }, [generateReport]);

  async function sendMessage(row) {
    const presetKey = selectedPresets[row.user_id] || data.presets?.[0]?.key || 'improve';
    setSendingId(row.user_id);
    try {
      await api.post('/api/reports/semi-hourly/message', { target_user_id: row.user_id, preset_key: presetKey }, { timeoutMs: 12000 });
      setMessage(`Message sent to ${row.full_name}.`);
    } catch (err) {
      setMessage(err.message || 'Message could not be sent.');
    } finally {
      setSendingId('');
    }
  }

  const rows = useMemo(() => data.rows || [], [data.rows]);
  const presets = data.presets || [];

  return (
    <Layout title="30-Minute Performance Report" subtitle={data.scope_label || 'Performance pulse'}>
      <style>{`
        .shr-shell{display:flex;flex-direction:column;gap:16px;}
        .shr-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;}
        .shr-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:14px;}
        .shr-note{padding:12px 14px;border-radius:16px;background:linear-gradient(135deg,rgba(78,126,255,.10),rgba(83,212,255,.10));border:1px solid rgba(90,122,225,.16);font-size:13px;font-weight:800;color:#2f5ab3;}
        .shr-panel{padding:16px;border-radius:30px;border:1px solid rgba(116,144,230,.20);background:linear-gradient(135deg,rgba(255,255,255,.97),rgba(239,246,255,.98) 58%,rgba(255,247,237,.96));box-shadow:0 26px 64px rgba(30,55,120,.14);overflow:auto;}
        .shr-table{width:100%;border-collapse:collapse;min-width:1320px;}
        .shr-table th,.shr-table td{padding:12px 10px;border-bottom:1px solid rgba(196,211,235,.88);text-align:left;vertical-align:middle;font-size:13px;white-space:nowrap;font-weight:850;color:#1b355c;}
        .shr-table th{font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:#40547b;background:linear-gradient(135deg,#dbeafe,#ede9fe 52%,#fff7ed);font-weight:1000;position:sticky;top:0;z-index:1;}
        .shr-name{min-width:190px;white-space:normal!important;font-weight:1000;color:#10233f!important;}
        .shr-thin{text-align:center!important;}
        .shr-tone-green td{background:linear-gradient(135deg,rgba(236,253,245,.90),rgba(220,252,231,.70));}
        .shr-tone-red td{background:linear-gradient(135deg,rgba(255,241,242,.95),rgba(254,226,226,.74));}
        .shr-tone-amber td{background:linear-gradient(135deg,rgba(255,251,235,.95),rgba(254,243,199,.70));}
        .shr-pill{display:inline-flex;padding:5px 8px;border-radius:999px;font-size:10px;font-weight:900;letter-spacing:.04em;text-transform:uppercase;}
        .shr-pill.green{background:rgba(36,201,107,.12);color:#0d8f4b;}
        .shr-pill.red{background:rgba(235,77,109,.12);color:#b3284c;}
        .shr-pill.amber{background:rgba(255,184,77,.16);color:#b87508;}
        .shr-message-cell{display:flex;gap:6px;align-items:center;}
        .shr-message-cell select{height:30px;min-width:138px;border-radius:10px;border:1px solid rgba(133,159,210,.35);font-size:11px;font-weight:800;}
        
        .shr-grid .stat-card{border-radius:26px!important;padding:18px 20px!important;min-height:92px!important;box-shadow:0 22px 52px rgba(15,23,42,.14)!important;border:1px solid rgba(255,255,255,.72)!important;position:relative;overflow:hidden;color:#fff!important}
        .shr-grid .stat-card::after{content:"";position:absolute;right:-26px;bottom:-36px;width:130px;height:130px;border-radius:50%;background:rgba(255,255,255,.16)}
        .shr-grid .stat-card.purple{background:linear-gradient(135deg,#7c3aed,#2563eb)!important}
        .shr-grid .stat-card.green{background:linear-gradient(135deg,#16a34a,#22c55e)!important}
        .shr-grid .stat-card.orange{background:linear-gradient(135deg,#f97316,#fb923c)!important}
        .shr-grid .stat-card.blue{background:linear-gradient(135deg,#0ea5e9,#2563eb)!important}
        .shr-grid .stat-card.red{background:linear-gradient(135deg,#ef4444,#ec4899)!important}
        .shr-grid .stat-label{font-size:12px!important;letter-spacing:.075em!important;text-transform:uppercase!important;color:rgba(255,255,255,.86)!important;font-weight:1000!important;position:relative;z-index:1}
        .shr-grid .stat-value{font-size:36px!important;line-height:1!important;color:#fff!important;font-weight:1000!important;letter-spacing:-.04em!important;position:relative;z-index:1;margin-top:8px}
        .shr-manual-refresh{background:linear-gradient(135deg,#2563eb,#7c3aed)!important;color:#fff!important;border:0!important;box-shadow:0 14px 30px rgba(37,99,235,.22)!important}
        .shr-message-cell .mini-btn{background:linear-gradient(135deg,#2563eb,#7c3aed)!important;color:#fff!important}

        @media (max-width:1080px){.shr-grid{grid-template-columns:repeat(3,minmax(0,1fr));}}
        @media (max-width:720px){.shr-grid{grid-template-columns:1fr;}}

        .shr-premium-hero{position:relative;overflow:hidden;padding:22px;border-radius:28px;background:radial-gradient(circle at 8% 0%,rgba(37,99,235,.22),transparent 34%),linear-gradient(135deg,#ffffff 0%,#eef6ff 58%,#fff7ed 100%);border:1px solid rgba(59,130,246,.22);box-shadow:0 28px 72px rgba(15,23,42,.13);display:flex;align-items:center;justify-content:space-between;gap:18px}
        .shr-premium-hero h2{margin:0;font-size:26px;font-weight:1000;letter-spacing:-.035em;color:#10233f}
        .shr-premium-hero p{margin:7px 0 0;color:#52637f;font-size:13px;line-height:1.55;font-weight:850}
        .shr-premium-kicker{display:inline-flex;padding:7px 12px;border-radius:999px;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;font-size:11px;font-weight:1000;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}
        .shr-toolbar,.shr-panel,.shr-note{backdrop-filter:blur(16px)}
        .shr-panel{border-radius:28px!important}
        .shr-table tbody tr{transition:background .16s ease,transform .16s ease}
        .shr-table tbody tr:hover{background:rgba(78,126,255,.06)!important;transform:translateY(-1px)}
      `}</style>

      <div className="shr-shell">
        <div className="shr-premium-hero">
          <div>
            <div className="shr-premium-kicker">30-Minute Performance</div>
            <h2>Team Performance Scorecard</h2>
            <p>Ranked performance, interview signals, and leadership actions in one focused view.</p>
          </div>
        </div>
        <div className="shr-toolbar">
          <div className="row-actions">
            {VIEW_BUTTONS.map((item) => (
              <button key={item.key} type="button" className={`mini-btn bounceable ${view === item.key ? 'success' : 'view'}`} onClick={() => { setView(item.key); generateReport(item.key); }}>{item.label}</button>
            ))}
            <button type="button" className="mini-btn primary bounceable shr-manual-refresh" onClick={() => generateReport(view)}>Manual Refresh</button>
          </div>
          <span className="helper-text">Refresh on demand. Half-hour snapshots stay lightweight and focused.</span>
        </div>
        {message ? <div className="shr-note">{message}</div> : null}
        <div className="shr-grid">
          <div className="stat-card purple"><div className="stat-label">Idle Time</div><div className="stat-value">{data.summary?.idle_minutes || 0}</div></div>
          <div className="stat-card green"><div className="stat-label">Submissions</div><div className="stat-value">{data.summary?.submissions || 0}</div></div>
          <div className="stat-card orange"><div className="stat-label">Dialed</div><div className="stat-value">{data.summary?.dialed_calls || 0}</div></div>
          <div className="stat-card green"><div className="stat-label">Connected</div><div className="stat-value">{data.summary?.connected_calls || 0}</div></div>
          <div className="stat-card blue"><div className="stat-label">Incoming</div><div className="stat-value">{data.summary?.incoming_calls || 0}</div></div>
          <div className="stat-card blue"><div className="stat-label">Talk Time</div><div className="stat-value">{data.summary?.talk_time_minutes || 0}m</div></div>
          <div className="stat-card red"><div className="stat-label">CRM Locks</div><div className="stat-value">{data.summary?.crm_locks || 0}</div></div>
        </div>

        <div className="shr-note">
          {data.window_label || 'Report'} • {data.generated_at ? fmtTime(data.generated_at) : '-'} • Top performers are sorted first, low performers are at the bottom.
        </div>

        <div className="shr-panel">
          <table className="shr-table">
            <thead>
              <tr>
                <th className="shr-name">Employee</th>
                <th>Role</th>
                <th>Code</th>
                <th>Score</th>
                {REPORT_COLUMNS.map(([label]) => <th key={label} className="shr-thin">{label}</th>)}
                <th>Last Activity</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.user_id} className={`shr-tone-${row.tone || 'amber'}`}>
                  <td className="shr-name"><strong>{row.full_name}</strong></td>
                  <td>{row.role}</td>
                  <td>{row.recruiter_code || '-'}</td>
                  <td><span className={`shr-pill ${row.tone || 'amber'}`}>{toneLabel(row.tone)} • {row.performance_score || 0}</span></td>
                  {REPORT_COLUMNS.map(([label, key]) => <td key={`${row.user_id}-${key}`} className="shr-thin">{row.metrics?.[key] ?? 0}</td>)}
                  <td>{fmtTime(row.last_activity_at)}</td>
                  <td>
                    {leadership && row.can_message ? (
                      <div className="shr-message-cell">
                        <select value={selectedPresets[row.user_id] || presets?.[0]?.key || 'improve'} onChange={(e) => setSelectedPresets({ ...selectedPresets, [row.user_id]: e.target.value })}>
                          {presets.map((preset) => <option key={preset.key} value={preset.key}>{preset.label}</option>)}
                        </select>
                        <button className="mini-btn view bounceable" type="button" disabled={sendingId === row.user_id} onClick={() => sendMessage(row)}>{sendingId === row.user_id ? 'Sending' : 'Send'}</button>
                      </div>
                    ) : '-'}
                  </td>
                </tr>
              ))}
              {!rows.length ? <tr><td colSpan={8 + REPORT_COLUMNS.length}>No visible employees in your report scope.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
