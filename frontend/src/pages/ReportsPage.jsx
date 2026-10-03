import React, { useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';

const IST = 'Asia/Kolkata';

function istDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const pick = (t) => parts.find((x) => x.type === t)?.value || '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}
function rangeForPreset(preset) {
  const today = istDateKey();
  if (preset === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  if (preset === '7d') {
    const end = new Date(`${today}T12:00:00+05:30`);
    const start = new Date(end.getTime() - 6 * 86400000);
    return { from: istDateKey(start), to: today };
  }
  return { from: today, to: today };
}
function toRangeIso(dateKey, end = false) {
  if (!dateKey) return '';
  return new Date(`${dateKey}T${end ? '23:59:59.999' : '00:00:00.000'}+05:30`).toISOString();
}
function fmtMinutes(v) {
  const n = Math.max(0, Number(v || 0));
  const h = Math.floor(n / 60); const m = Math.round(n % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
function fmtSeconds(v) {
  const s = Math.max(0, Number(v || 0));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = Math.floor(s % 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}
function fmtIst(v) {
  if (!v) return '-';
  const d = new Date(v); if (Number.isNaN(d.getTime())) return String(v);
  return new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
}
function safeValue(v) { return v === null || v === undefined || v === '' ? '-' : String(v); }

const METRIC_TITLES = {
  call_total: 'All CRM Calls', call_outgoing: 'Outgoing Calls', call_incoming: 'Incoming Calls', call_unique: 'Unique Candidate Calls', call_first_time: 'First-Time Candidate Calls',
  performance_submissions: 'Submissions', performance_interviews: 'Interviews', performance_selections: 'Selections', performance_joinings: 'Joinings',
  pending_incomplete_submissions: 'Incomplete Submissions', pending_overdue_interviews: 'Overdue Interviews', pending_interview_not_called: 'Interview Profiles Not Called', pending_followups: 'Pending Follow-Ups', pending_interviews: 'Upcoming Pending Interviews',
  work_breaks: 'Break Timeline', work_locks: 'CRM Lock Timeline', work_sessions: 'Work / Login / Logout Sessions',
};

function Metric({ label, value, sub, onClick, warn = false }) {
  return <button type="button" className={`cc434-metric ${warn ? 'warn' : ''}`} onClick={onClick} disabled={!onClick}>
    <span>{label}</span><strong>{value}</strong>{sub ? <small>{sub}</small> : null}
  </button>;
}

export default function ReportsPage() {
  const initial = rangeForPreset('today');
  const [preset, setPreset] = useState('today');
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);
  const [recruiter, setRecruiter] = useState('all');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState({ open: false, title: '', items: [], busy: false, error: '' });
  const [exporting, setExporting] = useState(false);
  const callRevisionRef = useRef('');
  const callRefreshBusyRef = useRef(false);

  const query = useMemo(() => ({ from: toRangeIso(fromDate, false), to: toRangeIso(toDate, true), recruiter_code: recruiter }), [fromDate, toDate, recruiter]);

  async function load(options = {}) {
    const silent = Boolean(options?.silent);
    if (!silent) { setBusy(true); setError(''); }
    try {
      const p = new URLSearchParams({ ...query, _ts: String(Date.now()) });
      const next = await api.get(`/api/reports/tracking-hub?${p.toString()}`, { cacheTtlMs: 0, timeoutMs: 60000, retries: 1 });
      setData(next);
    } catch (e) { if (!silent) setError(e.message || 'Tracking report could not load.'); }
    finally { if (!silent) setBusy(false); }
  }

  useEffect(() => { load(); }, []);

  // CC26_603: reports and Call Assistant update ONLY after a user action.
  // No 1.5-second revision checks; use the existing Update Details/Update Table buttons.

  function applyPreset(next) {
    setPreset(next);
    if (next !== 'custom') { const r = rangeForPreset(next); setFromDate(r.from); setToDate(r.to); }
  }

  async function openMetric(metric) {
    setDetail({ open: true, title: METRIC_TITLES[metric] || 'Details', items: [], busy: true, error: '' });
    try {
      const p = new URLSearchParams({ ...query, metric, _ts: String(Date.now()) });
      const r = await api.get(`/api/reports/tracking-details?${p.toString()}`, { cacheTtlMs: 0, timeoutMs: 60000, retries: 1 });
      setDetail({ open: true, title: METRIC_TITLES[metric] || 'Details', items: r.items || [], busy: false, error: '' });
    } catch (e) { setDetail((d) => ({ ...d, busy: false, error: e.message || 'Details could not load.' })); }
  }

  async function exportExcel() {
    setExporting(true); setError('');
    try {
      const r = await api.post('/api/reports/generate', {
        recruiter_code: recruiter, from: query.from, to: query.to, preset: preset,
        categories: ['calls', 'submissions', 'interviews', 'selections', 'joining', 'attendance_summary', 'login_timing', 'breaks', 'logout_activity'],
      }, { timeoutMs: 120000, cacheTtlMs: 0 });
      if (r?.download_url) {
        const a = document.createElement('a'); a.href = r.download_url; a.download = ''; document.body.appendChild(a); a.click(); a.remove();
      }
    } catch (e) { setError(e.message || 'Excel export failed.'); }
    finally { setExporting(false); }
  }

  const s = data?.summary || {};
  const calls = s.calls || {};
  const perf = s.performance || {};
  const work = s.work || {};
  const pending = s.pending || {};
  const recruiters = data?.recruiters || [];
  const options = data?.recruiter_options || [];
  const detailColumns = detail.items.length ? Object.keys(detail.items[0]) : [];

  return <Layout title="Reports">
    <style>{`
      .cc434-wrap{--ink:#173a67;--muted:#6a7f99;--line:#d9e7f5;--orange:#ff7a18;--orange2:#ffad42;--blue:#2f80ed;display:grid;gap:16px;color:var(--ink)}
      .cc434-hero{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:24px;padding:20px;background:linear-gradient(135deg,#fff 0%,#f5faff 58%,#fff7ed 100%);box-shadow:0 16px 38px rgba(31,73,125,.09)}
      .cc434-hero:before{content:"";position:absolute;inset:0 0 auto 0;height:4px;background:linear-gradient(90deg,#ff7a18,#ffad42,#2f80ed)}
      .cc434-title{font-size:26px;font-weight:1000;letter-spacing:-.035em;color:#12345e}.cc434-sub{margin-top:5px;font-size:13px;font-weight:750;color:var(--muted)}
      .cc434-filter{margin-top:16px;display:flex;gap:9px;align-items:end;flex-wrap:wrap}.cc434-filter label{display:grid;gap:5px;font-size:11px;font-weight:900;color:#5f7691}
      .cc434-filter select,.cc434-filter input{height:40px;border:1px solid #cfe0f2;border-radius:13px;background:#fff;padding:0 12px;color:#173a67;font-weight:850;outline:none}
      .cc434-preset{height:40px;padding:0 13px;border:1px solid #d7e6f7;border-radius:13px;background:#fff;color:#173a67;font-weight:900;cursor:pointer}.cc434-preset.active{background:#fff0df;border-color:#ffc785;color:#c76011}
      .cc434-refresh,.cc434-export{height:40px;border:0;border-radius:13px;padding:0 15px;font-weight:1000;cursor:pointer}.cc434-refresh{background:linear-gradient(135deg,#ff7a18,#ffad42);color:#fff}.cc434-export{background:#eef6ff;color:#1f5f9c;border:1px solid #cfe0f2}
      .cc434-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.cc434-card{border:1px solid var(--line);border-radius:22px;background:#fff;padding:16px;box-shadow:0 12px 28px rgba(38,78,122,.07);overflow:hidden;position:relative}.cc434-card:before{content:"";position:absolute;left:0;top:0;right:0;height:3px;background:linear-gradient(90deg,#ff7a18,#ffad42)}
      .cc434-card.blue:before{background:linear-gradient(90deg,#2f80ed,#63a7ff)}.cc434-card.green:before{background:linear-gradient(90deg,#21a179,#60c9a5)}.cc434-card.red:before{background:linear-gradient(90deg,#ff7a18,#f25f5c)}
      .cc434-cardhead{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.cc434-cardhead strong{font-size:17px;font-weight:1000;letter-spacing:-.02em}.cc434-chip{padding:6px 9px;border-radius:999px;background:#f4f9ff;color:#55708f;font-size:10px;font-weight:1000}
      .cc434-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.cc434-metric{min-height:92px;text-align:left;border:1px solid #dce9f6;border-radius:16px;background:linear-gradient(145deg,#fff,#f8fbff);padding:11px;cursor:pointer;color:#173a67;transition:.16s ease}.cc434-metric:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 10px 22px rgba(35,87,140,.09)}.cc434-metric:disabled{cursor:default}.cc434-metric span{display:block;font-size:10.5px;font-weight:900;color:#71859c;text-transform:uppercase;letter-spacing:.04em}.cc434-metric strong{display:block;margin-top:6px;font-size:22px;font-weight:1000;letter-spacing:-.03em}.cc434-metric small{display:block;margin-top:4px;font-size:10.5px;font-weight:800;color:#7890a8}.cc434-metric.warn{background:#fff8f1;border-color:#ffd9b6}.cc434-metric.warn strong{color:#c76011}
      .cc434-tablecard{border:1px solid var(--line);border-radius:22px;background:#fff;box-shadow:0 12px 28px rgba(38,78,122,.06);overflow:hidden}.cc434-tablehead{padding:15px 16px;border-bottom:1px solid #e4eef8;display:flex;justify-content:space-between;align-items:center}.cc434-tablehead strong{font-size:16px;font-weight:1000}.cc434-tablewrap{overflow:auto;max-height:440px}.cc434-table{width:100%;border-collapse:separate;border-spacing:0;min-width:980px}.cc434-table th{position:sticky;top:0;background:#f5f9ff;color:#5b728e;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;padding:10px 12px;text-align:left;border-bottom:1px solid #dce8f5}.cc434-table td{padding:11px 12px;border-bottom:1px solid #edf3f9;font-size:12px;font-weight:750;color:#25486f}.cc434-table tr:hover td{background:#fbfdff}.cc434-recrow{cursor:pointer}
      .cc434-status{padding:10px 12px;border-radius:14px;background:#f7fbff;border:1px solid #d7e6f7;font-size:12px;font-weight:800;color:#617995}.cc434-error{background:#fff3f0;border-color:#ffc8bf;color:#aa3a2d}
      .cc434-modalback{position:fixed;inset:0;background:rgba(16,42,73,.28);backdrop-filter:blur(4px);z-index:100000;display:grid;place-items:center;padding:18px}.cc434-modal{width:min(1180px,96vw);max-height:88vh;display:flex;flex-direction:column;background:#fff;border:1px solid #d7e6f7;border-radius:24px;box-shadow:0 30px 80px rgba(22,54,92,.25);overflow:hidden}.cc434-modalhead{display:flex;justify-content:space-between;align-items:center;padding:15px 18px;background:linear-gradient(135deg,#f7fbff,#fff8ef);border-bottom:1px solid #dce8f5}.cc434-modalhead strong{font-size:17px;font-weight:1000}.cc434-close{width:34px;height:34px;border-radius:11px;border:1px solid #d7e6f7;background:#fff;color:#4e6781;font-size:20px;font-weight:1000;cursor:pointer}.cc434-modalbody{overflow:auto;min-height:180px}.cc434-empty{padding:32px;text-align:center;color:#70859b;font-weight:850}
      @media(max-width:1150px){.cc434-grid{grid-template-columns:1fr}.cc434-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:680px){.cc434-metrics{grid-template-columns:1fr 1fr}.cc434-title{font-size:22px}.cc434-filter>*{flex:1 1 140px}}
    `}</style>

    <div className="cc434-wrap">
      <section className="cc434-hero">
        <div className="cc434-title">Tracking Reports</div>
        <div className="cc434-sub">Calls, performance, work/break and pending work — one place, one calculation source, IST timestamps.</div>
        <div className="cc434-filter">
          <button className={`cc434-preset ${preset === 'today' ? 'active' : ''}`} onClick={() => applyPreset('today')}>Today</button>
          <button className={`cc434-preset ${preset === '7d' ? 'active' : ''}`} onClick={() => applyPreset('7d')}>7 Days</button>
          <button className={`cc434-preset ${preset === 'month' ? 'active' : ''}`} onClick={() => applyPreset('month')}>This Month</button>
          <button className={`cc434-preset ${preset === 'custom' ? 'active' : ''}`} onClick={() => setPreset('custom')}>Custom</button>
          <label>From<input type="date" value={fromDate} onChange={(e) => { setFromDate(e.target.value); setPreset('custom'); }} /></label>
          <label>To<input type="date" value={toDate} onChange={(e) => { setToDate(e.target.value); setPreset('custom'); }} /></label>
          <label>Recruiter<select value={recruiter} onChange={(e) => setRecruiter(e.target.value)}><option value="all">All Recruiters</option>{options.map((x) => <option key={`${x.user_id}-${x.recruiter_code}`} value={x.recruiter_code}>{x.full_name} · {x.recruiter_code}</option>)}</select></label>
          <button className="cc434-refresh" disabled={busy} onClick={load}>{busy ? 'Loading…' : 'Refresh Report'}</button>
          <button className="cc434-export" disabled={exporting} onClick={exportExcel}>{exporting ? 'Exporting…' : 'Excel Export'}</button>
        </div>
      </section>

      {error ? <div className="cc434-status cc434-error">{error}</div> : null}
      {!data && busy ? <div className="cc434-status">Loading one central tracking summary…</div> : null}

      <div className="cc434-grid">
        <section className="cc434-card">
          <div className="cc434-cardhead"><strong>Call Report</strong><span className="cc434-chip">CRM profiles only</span></div>
          <div className="cc434-metrics">
            <Metric label="Total Calls" value={calls.total || 0} onClick={() => openMetric('call_total')} />
            <Metric label="Outgoing" value={calls.outgoing || 0} sub={fmtSeconds(calls.outgoing_talk_seconds)} onClick={() => openMetric('call_outgoing')} />
            <Metric label="Incoming" value={calls.incoming || 0} sub={fmtSeconds(calls.incoming_talk_seconds)} onClick={() => openMetric('call_incoming')} />
            <Metric label="Unique Candidates" value={calls.unique || 0} onClick={() => openMetric('call_unique')} />
            <Metric label="First-Time Calls" value={calls.first_time || 0} onClick={() => openMetric('call_first_time')} />
            <Metric label="Total Talk Time" value={fmtSeconds(calls.talk_seconds)} sub="Incoming + outgoing" />
          </div>
        </section>

        <section className="cc434-card blue">
          <div className="cc434-cardhead"><strong>Performance</strong><span className="cc434-chip">Period / All time</span></div>
          <div className="cc434-metrics">
            <Metric label="Submissions" value={perf.submissions || 0} sub={`All ${perf.submissions_all_time || 0}`} onClick={() => openMetric('performance_submissions')} />
            <Metric label="Interviews" value={perf.interviews || 0} sub={`All ${perf.interviews_all_time || 0}`} onClick={() => openMetric('performance_interviews')} />
            <Metric label="Selections" value={perf.selections || 0} sub={`All ${perf.selections_all_time || 0}`} onClick={() => openMetric('performance_selections')} />
            <Metric label="Joinings" value={perf.joinings || 0} sub={`All ${perf.joinings_all_time || 0}`} onClick={() => openMetric('performance_joinings')} />
            <Metric label="Incomplete Subs" value={perf.incomplete_submissions || 0} warn onClick={() => openMetric('pending_incomplete_submissions')} />
            <Metric label="Overdue Interviews" value={perf.overdue_interviews || 0} warn onClick={() => openMetric('pending_overdue_interviews')} />
          </div>
        </section>

        <section className="cc434-card green">
          <div className="cc434-cardhead"><strong>Work & Break</strong><span className="cc434-chip">Active work only</span></div>
          <div className="cc434-metrics">
            <Metric label="Active Work" value={fmtMinutes(work.active_minutes)} onClick={() => openMetric('work_sessions')} />
            <Metric label="Break Time" value={fmtMinutes(work.break_minutes)} onClick={() => openMetric('work_breaks')} />
            <Metric label="Idle Time" value={fmtMinutes(work.idle_minutes)} onClick={() => openMetric('work_sessions')} />
            <Metric label="Work Remaining" value={fmtMinutes(work.remaining_minutes)} onClick={() => openMetric('work_sessions')} />
            <Metric label="CRM Locks" value={work.lock_count || 0} warn={Number(work.lock_count || 0) > 0} onClick={() => openMetric('work_locks')} />
            <Metric label="Sessions" value={work.sessions || 0} sub="Login / logout timeline" onClick={() => openMetric('work_sessions')} />
          </div>
        </section>

        <section className="cc434-card red">
          <div className="cc434-cardhead"><strong>Pending Queue</strong><span className="cc434-chip">Needs action</span></div>
          <div className="cc434-metrics">
            <Metric label="Incomplete Subs" value={pending.incomplete_submissions || 0} warn onClick={() => openMetric('pending_incomplete_submissions')} />
            <Metric label="Overdue Interviews" value={pending.overdue_interviews || 0} warn onClick={() => openMetric('pending_overdue_interviews')} />
            <Metric label="Interview Not Called" value={pending.interview_not_called || 0} warn onClick={() => openMetric('pending_interview_not_called')} />
            <Metric label="Pending Follow-Ups" value={pending.pending_followups || 0} warn onClick={() => openMetric('pending_followups')} />
            <Metric label="Upcoming Interviews" value={pending.pending_interviews || 0} onClick={() => openMetric('pending_interviews')} />
            <Metric label="Report Timezone" value="IST" sub="Asia/Kolkata" />
          </div>
        </section>
      </div>

      <section className="cc434-tablecard">
        <div className="cc434-tablehead"><strong>Recruiter Scoreboard</strong><span className="cc434-chip">Click recruiter to filter</span></div>
        <div className="cc434-tablewrap"><table className="cc434-table"><thead><tr><th>Recruiter</th><th>Calls</th><th>Talk Time</th><th>Submissions</th><th>Interviews</th><th>Selections</th><th>Joinings</th><th>Active Work</th><th>Break</th><th>Idle</th><th>Locks</th><th>Login IST</th><th>Logout IST</th></tr></thead><tbody>
          {recruiters.map((r) => <tr key={`${r.recruiter_code}-${r.recruiter_name}`} className="cc434-recrow" onClick={() => { if (r.recruiter_code) setRecruiter(r.recruiter_code); }}><td><strong>{r.recruiter_name || r.recruiter_code}</strong><br/><small>{r.recruiter_code}</small></td><td>{r.calls}</td><td>{fmtSeconds(r.talk_seconds)}</td><td>{r.submissions}</td><td>{r.interviews}</td><td>{r.selections}</td><td>{r.joinings}</td><td>{fmtMinutes(r.active_minutes)}</td><td>{fmtMinutes(r.break_minutes)}</td><td>{fmtMinutes(r.idle_minutes)}</td><td>{r.lock_count}</td><td>{fmtIst(r.login_at)}</td><td>{fmtIst(r.logout_at)}</td></tr>)}
          {!recruiters.length ? <tr><td colSpan="13" className="cc434-empty">No recruiter activity found for this range.</td></tr> : null}
        </tbody></table></div>
      </section>
      <div className="cc434-status">Calculation rule: calls are counted only when linked to a current CRM candidate/profile. Details load only when you click a metric, so normal CRM egress stays low. Last refresh: {fmtIst(data?.generated_at)}</div>
    </div>

    {detail.open ? <div className="cc434-modalback" onMouseDown={(e) => { if (e.target === e.currentTarget) setDetail((d) => ({ ...d, open: false })); }}><div className="cc434-modal">
      <div className="cc434-modalhead"><strong>{detail.title}</strong><button className="cc434-close" onClick={() => setDetail((d) => ({ ...d, open: false }))}>×</button></div>
      <div className="cc434-modalbody">
        {detail.busy ? <div className="cc434-empty">Loading exact rows…</div> : detail.error ? <div className="cc434-empty">{detail.error}</div> : !detail.items.length ? <div className="cc434-empty">No matching records.</div> : <table className="cc434-table"><thead><tr>{detailColumns.map((c) => <th key={c}>{c.replaceAll('_', ' ')}</th>)}</tr></thead><tbody>{detail.items.map((row, i) => <tr key={i}>{detailColumns.map((c) => <td key={c}>{c.includes('timestamp') || c.endsWith('_at') ? fmtIst(row[c]) : safeValue(row[c])}</td>)}</tr>)}</tbody></table>}
      </div>
    </div></div> : null}
  </Layout>;
}
