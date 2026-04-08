import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';

const COLUMN_GROUPS = [
  ['Submissions', 'submissions_30', 'submissions_day'],
  ['Calls', 'calls_30', 'calls_day'],
  ['WhatsApp', 'whatsapp_30', 'whatsapp_day'],
  ['Profiles Opened', 'profile_opens_30', 'profile_opens_day'],
  ['Details Saved', 'details_saved_30', 'details_saved_day'],
  ['Looking For Job Marked', 'looking_for_job_marked_30', 'looking_for_job_marked_day'],
  ['Break Count', 'break_count_30', 'break_count_day'],
  ['Break Minutes', 'break_minutes_30', 'break_minutes_day'],
  ['CRM Unlocks', 'crm_unlocks_30', 'crm_unlocks_day'],
  ['Idle Minutes', 'idle_minutes_30', 'idle_minutes_day'],
  ['Login Minutes', 'session_minutes_30', 'session_minutes_day'],
  ['Work Minutes', 'productive_minutes_30', 'productive_minutes_day'],
  ['Idle 15m+', 'idle_15_flag_30', 'idle_15_flag_day'],
  ['Idle 30m+', 'idle_30_flag_30', 'idle_30_flag_day'],
  ['No Profile Open', 'no_profile_open_30', 'no_profile_open_day'],
  ['No Call', 'no_call_30', 'no_call_day'],
  ['On Break', 'on_break_30', 'on_break_day'],
  ['Avg Call Gap', 'avg_call_gap_30', 'avg_call_gap_day'],
];

function toneLabel(value) {
  if (value === 'green') return 'Strong';
  if (value === 'red') return 'Needs attention';
  return 'Watch';
}

export default function SemiHourlyReportPage() {
  const [data, setData] = useState({ rows: [], summary: {}, generated_at: '', period_key: '' });
  const [message, setMessage] = useState('');
  const reportId = useMemo(() => new URLSearchParams(window.location.search).get('reportId') || '', []);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const endpoint = reportId
          ? `/api/reports/semi-hourly?report_id=${encodeURIComponent(reportId)}`
          : '/api/reports/semi-hourly?live=1';
        const next = await api.get(endpoint, { cacheTtlMs: 0 });
        if (active) {
          setData(next || { rows: [], summary: {}, generated_at: '', period_key: '' });
          setMessage('');
        }
      } catch (err) {
        if (active) setMessage(err.message || 'Semi-hourly report could not load.');
      }
    }

    load();
    const timer = reportId ? null : window.setInterval(load, 3500);
    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
    };
  }, [reportId]);

  const rows = useMemo(() => data.rows || [], [data.rows]);

  return (
    <Layout
      title="Semi-Hourly Report"
      subtitle={reportId ? 'Saved 30 minutes report reopened from Reports.' : 'Auto-generated leadership view for the last 30 minutes versus the running day total.'}
    >
      <style>{`
        .shr-shell{display:flex;flex-direction:column;gap:18px;}
        .shr-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;}
        .shr-note{padding:12px 14px;border-radius:16px;background:linear-gradient(135deg,rgba(78,126,255,.10),rgba(83,212,255,.10));border:1px solid rgba(90,122,225,.16);font-size:13px;font-weight:800;color:#2f5ab3;}
        .shr-panel{padding:18px;border-radius:26px;border:1px solid rgba(116,144,230,.18);background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(246,250,255,.95));box-shadow:0 20px 42px rgba(30,55,120,.10);overflow:auto;}
        .shr-table{width:100%;border-collapse:collapse;min-width:1500px;}
        .shr-table th,.shr-table td{padding:12px 12px;border-bottom:1px solid rgba(216,228,244,.9);text-align:left;vertical-align:top;font-size:13px;}
        .shr-table th{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#64739a;background:linear-gradient(180deg,#f5f8ff,#ecf2ff);}
        .shr-group-head{font-size:11px;font-weight:900;color:#4e5f84;text-transform:uppercase;letter-spacing:.06em;}
        .shr-cell-pair{border-right:2px solid rgba(190,204,230,.55);}
        .shr-tone-green td{background:rgba(37,201,107,.05);}
        .shr-tone-red td{background:rgba(235,77,109,.06);}
        .shr-tone-amber td{background:rgba(255,184,77,.07);}
        .shr-pill{display:inline-flex;padding:7px 10px;border-radius:999px;font-size:11px;font-weight:900;letter-spacing:.04em;text-transform:uppercase;}
        .shr-pill.green{background:rgba(36,201,107,.12);color:#0d8f4b;}
        .shr-pill.red{background:rgba(235,77,109,.12);color:#b3284c;}
        .shr-pill.amber{background:rgba(255,184,77,.16);color:#b87508;}
        @media (max-width:1080px){.shr-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}
        @media (max-width:720px){.shr-grid{grid-template-columns:1fr;}}
      `}</style>

      <div className="shr-shell">
        {message ? <div className="shr-note">{message}</div> : null}
        <div className="shr-grid">
          <div className="stat-card blue"><div className="stat-label">Active People</div><div className="stat-value">{data.summary?.active_people || 0}</div></div>
          <div className="stat-card green"><div className="stat-label">Submissions in Last 30m</div><div className="stat-value">{data.summary?.submissions_30 || 0}</div></div>
          <div className="stat-card orange"><div className="stat-label">Calls in Last 30m</div><div className="stat-value">{data.summary?.calls_30 || 0}</div></div>
          <div className="stat-card purple"><div className="stat-label">Idle Minutes in Last 30m</div><div className="stat-value">{data.summary?.idle_minutes_30 || 0}</div></div>
          <div className="stat-card orange"><div className="stat-label">Breaks in Last 30m</div><div className="stat-value">{data.summary?.break_count_30 || 0}</div></div>
          <div className="stat-card blue"><div className="stat-label">Break Minutes in Last 30m</div><div className="stat-value">{data.summary?.break_minutes_30 || 0}</div></div>
          <div className="stat-card green"><div className="stat-label">Login Minutes in Last 30m</div><div className="stat-value">{data.summary?.login_minutes_30 || 0}</div></div>
          <div className="stat-card purple"><div className="stat-label">Work Minutes in Last 30m</div><div className="stat-value">{data.summary?.work_minutes_30 || 0}</div></div>
          <div className="stat-card orange"><div className="stat-label">Idle 15m+</div><div className="stat-value">{data.summary?.idle_people_15 || 0}</div></div>
          <div className="stat-card orange"><div className="stat-label">Idle 30m+</div><div className="stat-value">{data.summary?.idle_people_30 || 0}</div></div>
          <div className="stat-card blue"><div className="stat-label">No Profile Open 30m</div><div className="stat-value">{data.summary?.no_profile_open_30 || 0}</div></div>
          <div className="stat-card red"><div className="stat-label">No Call 30m</div><div className="stat-value">{data.summary?.no_call_30 || 0}</div></div>
          <div className="stat-card purple"><div className="stat-label">Currently On Break</div><div className="stat-value">{data.summary?.active_breaks || 0}</div></div>
        </div>

        <div className="shr-note">
          {data.is_saved_snapshot ? 'Saved snapshot' : 'Generated'} at {data.generated_at ? new Date(data.generated_at).toLocaleString() : '-'} • Period key {data.period_key || '-'}{data.saved_title ? ` • ${data.saved_title}` : ''}
        </div>

        <div className="shr-panel">
          <table className="shr-table">
            <thead>
              <tr>
                <th rowSpan="2">User</th>
                <th rowSpan="2">Role</th>
                <th rowSpan="2">Code</th>
                <th rowSpan="2">Performance</th>
                <th rowSpan="2">Last Activity</th>
                <th rowSpan="2">On Break</th>
                {COLUMN_GROUPS.map(([label]) => <th key={label} colSpan="2" className="shr-group-head">{label}</th>)}
              </tr>
              <tr>
                {COLUMN_GROUPS.map(([label, firstKey, secondKey]) => (
                  <React.Fragment key={`${label}-${firstKey}`}>
                    <th>30m</th>
                    <th className="shr-cell-pair">Today</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.user_id} className={`shr-tone-${row.tone || 'amber'}`}>
                  <td><strong>{row.full_name}</strong></td>
                  <td>{row.role}</td>
                  <td>{row.recruiter_code || '-'}</td>
                  <td><span className={`shr-pill ${row.tone || 'amber'}`}>{toneLabel(row.tone)}</span></td>
                  <td>{row.last_activity_at ? new Date(row.last_activity_at).toLocaleString() : '-'}</td>
                  <td>{row.active_break ? 'Yes' : 'No'}</td>
                  {COLUMN_GROUPS.map(([label, firstKey, secondKey]) => (
                    <React.Fragment key={`${row.user_id}-${firstKey}`}>
                      <td>{row.metrics?.[firstKey] ?? 0}</td>
                      <td className="shr-cell-pair">{row.metrics?.[secondKey] ?? 0}</td>
                    </React.Fragment>
                  ))}
                </tr>
              ))}
              {!rows.length ? <tr><td colSpan={6 + (COLUMN_GROUPS.length * 2)}>No data available for this window.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
