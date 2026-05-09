import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';

const PERIODS = [
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
];

function todayYmd() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function toneClass(row) {
  if (row.pickup_ratio >= 70 || row.details >= 5) return 'tone-green';
  if (row.pickup_ratio >= 45 || row.calls >= 4) return 'tone-blue';
  if (row.calls === 0 && row.details === 0) return 'tone-slate';
  return 'tone-orange';
}

export default function PrimeTimeInsightsPage() {
  const [period, setPeriod] = useState('daily');
  const [anchor, setAnchor] = useState(() => todayYmd());
  const [recruiterCode, setRecruiterCode] = useState('all');
  const [data, setData] = useState({ meta: {}, cards: {}, summary: {}, hourly: [], top_windows: [], recruiter_breakdown: [] });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('period', period);
        params.set('anchor', anchor);
        if (recruiterCode && recruiterCode !== 'all') params.set('recruiter_code', recruiterCode);
        const response = await api.get(`/api/reports/timing-insights?${params.toString()}`);
        if (!active) return;
        setData(response || { meta: {}, cards: {}, summary: {}, hourly: [], top_windows: [], recruiter_breakdown: [] });
        if (response?.meta?.scope !== 'leadership' && response?.meta?.recruiter_code) {
          setRecruiterCode(response.meta.recruiter_code);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [period, anchor, recruiterCode]);

  const periodLabel = data?.meta?.period_label || '';
  const recruiterOptions = data?.meta?.recruiter_options || [];
  const recruiterDisabled = data?.meta?.scope !== 'leadership';
  const fallbackNote = useMemo(() => {
    const using = data?.meta?.using_fallback || {};
    if (!using.connected && !using.details) return '';
    if (using.connected && using.details) return 'Legacy records do not include explicit connected or detail events, so a fallback activity pattern is also being used for this view.';
    if (using.connected) return 'Connected ratio is using a legacy fallback pattern for older records.';
    return 'Details saved is using a legacy profile-update fallback for older records.';
  }, [data?.meta?.using_fallback]);

  return (
    <Layout title="Prime Time Insights" subtitle="Track the strongest calling, pickup, and detail windows across daily, weekly, and monthly views.">
      <style>{`
        .pti-shell{display:flex;flex-direction:column;gap:18px;}
        .pti-hero{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;}
        .pti-panel{padding:18px;border-radius:24px;border:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.94),rgba(247,251,255,.95));box-shadow:var(--shadow-soft);}
        .pti-controls{display:grid;grid-template-columns:1.2fr 1fr 1.2fr auto;gap:14px;align-items:end;}
        .pti-field{display:flex;flex-direction:column;gap:8px;}
        .pti-field label{font-size:12px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);}
        .pti-field select,.pti-field input{min-height:46px;border-radius:16px;border:1px solid var(--line);padding:0 14px;font-weight:800;background:rgba(255,255,255,.92);color:var(--text-main);box-shadow:inset 0 1px 0 rgba(255,255,255,.82);}
        .pti-periods{display:flex;flex-wrap:wrap;gap:10px;}
        .pti-period-btn{border:none;border-radius:999px;padding:11px 16px;font-weight:900;cursor:pointer;background:linear-gradient(135deg,#f7fbff,#e9f0ff);color:#4867db;box-shadow:0 10px 20px rgba(17,21,35,.07);}
        .pti-period-btn.active{background:linear-gradient(135deg,#4e7eff,#6b63ff);color:#fff;box-shadow:0 16px 28px rgba(78,126,255,.22);}
        .pti-mini-note{font-size:12px;font-weight:800;color:var(--muted);}
        .pti-card-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;}
        .pti-window-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;}
        .pti-window-card{padding:18px;border-radius:24px;color:#fff;box-shadow:0 16px 30px rgba(31,41,55,.12);display:flex;flex-direction:column;gap:8px;min-height:146px;}
        .pti-window-card.blue{background:linear-gradient(135deg,#4578ff,#56d4ff);}
        .pti-window-card.green{background:linear-gradient(135deg,#22c55e,#81d742);}
        .pti-window-card.purple{background:linear-gradient(135deg,#6b63ff,#d45cff);}
        .pti-window-card.orange{background:linear-gradient(135deg,#ff7a45,#ffb347);}
        .pti-window-card .eyebrow{font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;opacity:.88;}
        .pti-window-card .value{font-size:28px;font-weight:900;line-height:1.05;}
        .pti-window-card .sub{font-size:13px;font-weight:700;opacity:.92;}
        .pti-table-wrap{overflow:auto;padding-bottom:8px;}
        .pti-table{width:100%;min-width:1080px;border-collapse:separate;border-spacing:0 10px;}
        .pti-table th{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#5470a3;padding:0 12px 8px;text-align:left;white-space:nowrap;}
        .pti-table td{padding:14px 12px;vertical-align:middle;font-size:14px;font-weight:800;color:var(--text-main);background:#fff;}
        .pti-table tbody tr td:first-child,.pti-recruiter-table tbody tr td:first-child{border-radius:18px 0 0 18px;}
        .pti-table tbody tr td:last-child,.pti-recruiter-table tbody tr td:last-child{border-radius:0 18px 18px 0;}
        .pti-table tbody tr,.pti-recruiter-table tbody tr{box-shadow:0 12px 24px rgba(20,33,61,.06);}
        .pti-chip{display:inline-flex;align-items:center;justify-content:center;padding:7px 11px;border-radius:999px;font-size:12px;font-weight:900;white-space:nowrap;}
        .pti-chip.tone-green{background:rgba(34,197,94,.16);color:#15803d;}
        .pti-chip.tone-blue{background:rgba(59,130,246,.16);color:#2554c7;}
        .pti-chip.tone-orange{background:rgba(249,115,22,.15);color:#c76710;}
        .pti-chip.tone-slate{background:rgba(148,163,184,.18);color:#475569;}
        .pti-chip.tone-purple{background:rgba(139,92,246,.15);color:#6d28d9;}
        .pti-tag-line{display:flex;flex-wrap:wrap;gap:10px;}
        .pti-card-grid .pti-tag-line{gap:12px;}
        .pti-card-grid .pti-chip{padding:8px 13px;font-size:13px;font-weight:900;color:#fff;border:1px solid rgba(255,255,255,.2);box-shadow:0 8px 18px rgba(15,23,42,.12);}
        .pti-card-grid .pti-chip.tone-purple{background:rgba(109,40,217,.24);color:#fff;}
        .pti-card-grid .pti-chip.tone-green{background:rgba(21,128,61,.24);color:#fff;}
        .pti-card-grid .pti-chip.tone-blue{background:rgba(37,84,199,.24);color:#fff;}
        .pti-card-grid .pti-chip.tone-orange{background:rgba(199,103,16,.24);color:#fff;}
        .pti-recruiter-table{width:100%;min-width:760px;border-collapse:separate;border-spacing:0 10px;}
        .pti-recruiter-table th{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#5470a3;padding:0 12px 8px;text-align:left;white-space:nowrap;}
        .pti-recruiter-table td{padding:14px 12px;background:#fff;font-size:14px;font-weight:800;color:var(--text-main);}
        .pti-empty{padding:18px;border-radius:18px;background:rgba(76,111,255,.08);font-weight:800;color:#3b5ccc;}
        @media (max-width: 1180px){.pti-hero,.pti-card-grid,.pti-window-grid{grid-template-columns:repeat(2,minmax(0,1fr));}.pti-controls{grid-template-columns:1fr 1fr;}}
        @media (max-width: 760px){.pti-hero,.pti-card-grid,.pti-window-grid,.pti-controls{grid-template-columns:1fr;}}
      `}</style>

      <div className="pti-shell">
        <div className="pti-hero">
          <div className="stat-card blue"><div className="stat-label">Calls Logged</div><div className="stat-value">{data?.cards?.calls_logged ?? 0}</div><div className="stat-hint">{periodLabel || 'Window'}</div></div>
          <div className="stat-card green"><div className="stat-label">Connected Calls</div><div className="stat-value">{data?.cards?.connected_calls ?? 0}</div><div className="stat-hint">Call pickup marks</div></div>
          <div className="stat-card orange"><div className="stat-label">Details Filled</div><div className="stat-value">{data?.cards?.details_saved ?? 0}</div><div className="stat-hint">Profile detail saves</div></div>
          <div className="stat-card purple"><div className="stat-label">Pickup Ratio</div><div className="stat-value">{data?.cards?.pickup_ratio || '0%'}</div><div className="stat-hint">Connected ÷ calls</div></div>
        </div>

        <div className="pti-panel">
          <div className="pti-controls">
            <div className="pti-field"><label>Period</label><div className="pti-periods">{PERIODS.map((item) => <button key={item.key} type="button" className={`pti-period-btn ${period === item.key ? 'active' : ''}`} onClick={() => setPeriod(item.key)}>{item.label}</button>)}</div></div>
            <div className="pti-field"><label>Anchor Date</label><input type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} /></div>
            <div className="pti-field"><label>Recruiter</label><select value={recruiterCode} onChange={(e) => setRecruiterCode(e.target.value)} disabled={recruiterDisabled}><option value="all">All Recruiters</option>{recruiterOptions.map((item) => <option key={`${item.user_id}-${item.recruiter_code}`} value={item.recruiter_code || ''}>{item.recruiter_code || 'No Code'} · {item.full_name}</option>)}</select></div>
            <div className="pti-field"><label>Status</label><div className="pti-mini-note">{loading ? 'Loading window...' : (periodLabel || 'Window ready')}</div>{fallbackNote ? <div className="pti-mini-note">{fallbackNote}</div> : <div className="pti-mini-note">Prime Time cards are auto-scored using calls, connects, details, and submissions.</div>}</div>
          </div>
        </div>

        <div className="pti-window-grid">
          <div className="pti-window-card blue"><div className="eyebrow">Best Calling Window</div><div className="value">{data?.cards?.best_call_hour || 'No data yet'}</div><div className="sub">This slot logged the highest call volume.</div></div>
          <div className="pti-window-card green"><div className="eyebrow">Best Pickup Window</div><div className="value">{data?.cards?.best_pickup_hour || 'No data yet'}</div><div className="sub">This slot delivered the strongest pickup ratio.</div></div>
          <div className="pti-window-card purple"><div className="eyebrow">Best Detail Window</div><div className="value">{data?.cards?.best_detail_hour || 'No data yet'}</div><div className="sub">This slot recorded the highest detail-fill volume.</div></div>
        </div>

        <div className="pti-card-grid">
          {(data?.top_windows || []).slice(0, 4).map((item, index) => (
            <div key={`${item.hour}-${index}`} className={`pti-window-card ${index === 0 ? 'orange' : index === 1 ? 'blue' : index === 2 ? 'green' : 'purple'}`}>
              <div className="eyebrow">Top Window #{index + 1}</div>
              <div className="value">{item.label}</div>
              <div className="pti-tag-line"><span className="pti-chip tone-purple">Calls {item.calls}</span><span className="pti-chip tone-green">Connected {item.connected}</span><span className="pti-chip tone-blue">Details {item.details}</span><span className="pti-chip tone-orange">Sub {item.submissions}</span></div>
              <div className="sub">Pickup {item.pickup_ratio}% • Detail/Call {item.detail_per_call}% • Strength {item.strength}</div>
            </div>
          ))}
        </div>

        <div className="pti-panel">
          <div className="panel-title">Hour-Wise Productivity Grid</div>
          <div className="helper-text top-gap-small">This grid gives a clear slot-level view across daily, weekly, and monthly performance patterns.</div>
          <div className="pti-table-wrap top-gap">
            <table className="pti-table colorful-table">
              <thead><tr><th>Hour Slot</th><th>Calls</th><th>Connected</th><th>Pickup Ratio</th><th>Details Saved</th><th>Detail / Call</th><th>Submissions</th><th>Strength</th></tr></thead>
              <tbody>{(data?.hourly || []).map((row) => (<tr key={row.hour}><td>{row.label}</td><td>{row.calls}</td><td>{row.connected}</td><td><span className={`pti-chip ${toneClass(row)}`}>{row.pickup_ratio}%</span></td><td>{row.details}</td><td><span className="pti-chip tone-blue">{row.detail_per_call}%</span></td><td>{row.submissions}</td><td><span className="pti-chip tone-purple">{row.strength}</span></td></tr>))}</tbody>
            </table>
          </div>
        </div>

        <div className="pti-panel">
          <div className="panel-title">Recruiter Timing Breakdown</div>
          <div className="helper-text top-gap-small">See which recruiter performs best in which time window across daily, weekly, and monthly views.</div>
          <div className="pti-table-wrap top-gap">
            {(data?.recruiter_breakdown || []).length ? (
              <table className="pti-recruiter-table colorful-table">
                <thead><tr><th>Recruiter</th><th>Code</th><th>Calls</th><th>Connected</th><th>Pickup Ratio</th><th>Details</th><th>Detail / Call</th><th>Submissions</th></tr></thead>
                <tbody>{data.recruiter_breakdown.map((row) => (<tr key={`${row.user_id}-${row.recruiter_code}`}><td>{row.full_name}</td><td>{row.recruiter_code || '-'}</td><td>{row.calls}</td><td>{row.connected}</td><td><span className={`pti-chip ${row.pickup_ratio >= 55 ? 'tone-green' : row.pickup_ratio >= 30 ? 'tone-blue' : 'tone-orange'}`}>{row.pickup_ratio}%</span></td><td>{row.details}</td><td><span className="pti-chip tone-blue">{row.detail_ratio}%</span></td><td>{row.submissions}</td></tr>))}</tbody>
              </table>
            ) : <div className="pti-empty">No data is available for this window yet. Try changing the date or recruiter filter.</div>}
          </div>
        </div>
      </div>
    </Layout>
  );
}
