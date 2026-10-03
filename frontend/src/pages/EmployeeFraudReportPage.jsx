import React, { useEffect, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';

const arr = (x) => Array.isArray(x) ? x : [];
const hasLoc = (x = {}) => String(x.latest_latitude || x.employee_latitude || '').trim() && String(x.latest_longitude || x.employee_longitude || '').trim();
const fmt = (s = 0) => { const n = Math.max(0, Number(s || 0)); const m = Math.floor(n / 60); const x = n % 60; return m ? `${m}m ${x}s` : `${x}s`; };
const IST_OFFSET_MS = 330 * 60 * 1000;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function parseTimeMs(value = '') {
  if (!value) return 0;
  const raw = String(value || '').trim();
  const isoish = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const t = Date.parse(isoish);
  return Number.isFinite(t) ? t : 0;
}
function formatIstDateTime(value = '') {
  const t = parseTimeMs(value);
  if (!t) return '-';
  const d = new Date(t + IST_OFFSET_MS);
  let h = d.getUTCHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(h)}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${ampm}`;
}
function TimeCell({ row = {} }) {
  const updated = row.display_updated_ist || formatIstDateTime(row.updated_at || row.call_ended_at || row.created_at || row.call_started_at || '');
  return <small style={{color:'#64748b',fontWeight:900,display:'inline-block',lineHeight:1.35}}>Updated: {updated}</small>;
}

function todayYmd() {
  const now = new Date(Date.now() + (5.5 * 60 * 60 * 1000));
  return now.toISOString().slice(0, 10);
}

const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'last_30_min', label: 'Last 30 min' },
  { value: 'last_1_hour', label: 'Last 1 hour' },
  { value: 'last_2_hour', label: 'Last 2 hours' },
  { value: 'last_5_hour', label: 'Last 5 hours' },
  { value: 'whole_day', label: 'Whole day' },
  { value: 'custom', label: 'Calendar range' },
];

function presetLabel(value = 'today') {
  return PRESETS.find((item) => item.value === value)?.label || 'Today';
}

export default function EmployeeFraudReportPage() {
  const today = todayYmd();
  const [data, setData] = useState({ employees: [], employee_options: [], items: [], summary: {} });
  const [filters, setFilters] = useState({ preset: 'today', date_from: today, date_to: today, employee: '' });
  const [busy, setBusy] = useState(false);
  const [showDates, setShowDates] = useState(false);
  const [message, setMessage] = useState('Today preset is ready. Click Update Details when you want latest call data.');
  const filtersRef = useRef(filters);
  useEffect(() => { filtersRef.current = filters; }, [filters]);

  async function load(silent = false, forcePhoneSync = true) {
    if (!silent) { setBusy(true); setMessage(forcePhoneSync ? 'Requesting latest phone call-log sync from paired app...' : 'Loading call review...'); }
    try {
      const p = new URLSearchParams();
      Object.entries(filtersRef.current).forEach(([k, v]) => { if (String(v || '').trim()) p.set(k, String(v).trim()); });
      if (forcePhoneSync) p.set('force_phone_sync', '1');
      p.set('_ts', String(Date.now()));
      const d = await api.get(`/api/dialer/fraud-report?${p.toString()}`, { cacheTtlMs: 0, timeoutMs: 45000, forceNetwork: true });
      setData(d);
      const rangeText = d?.range?.label || presetLabel(filtersRef.current.preset);
      const requested = Number(d?.sync_request?.requested || 0);
      setMessage(`${requested ? `Phone sync requested on ${requested} paired app(s). ` : ''}Updated manually: ${arr(d.items).length} call row(s). Range: ${rangeText}. Last refresh: ${d?.last_refreshed_ist || formatIstDateTime(new Date().toISOString())}. Auto-refresh is OFF; Update Details triggers a manual safe sync.`);
      if (forcePhoneSync) {
        window.setTimeout(async () => {
          try {
            const q = new URLSearchParams();
            Object.entries(filtersRef.current).forEach(([k, v]) => { if (String(v || '').trim()) q.set(k, String(v).trim()); });
            q.set('_ts', String(Date.now()));
            const latest = await api.get(`/api/dialer/fraud-report?${q.toString()}`, { cacheTtlMs: 0, timeoutMs: 45000, forceNetwork: true });
            setData(latest);
            const latestRange = latest?.range?.label || presetLabel(filtersRef.current.preset);
            setMessage(`Fresh phone-log check complete: ${arr(latest.items).length} call row(s). Range: ${latestRange}. Last refresh: ${latest?.last_refreshed_ist || formatIstDateTime(new Date().toISOString())}.`);
          } catch {}
        }, 2800);
      }
    } catch (e) {
      if (!silent) setMessage(e.message || 'Call Review update failed.');
    } finally {
      if (!silent) setBusy(false);
    }
  }

  function clearFilters() {
    const blank = { preset: 'today', date_from: todayYmd(), date_to: todayYmd(), employee: '' };
    setFilters(blank);
    filtersRef.current = blank;
    setShowDates(false);
    setTimeout(() => load(false), 0);
  }

  function applyDateRange() {
    const next = { ...filters, preset: 'custom' };
    setFilters(next);
    filtersRef.current = next;
    setShowDates(false);
  }

  const summary = data.summary || {};
  const employeeOptions = arr(data.employee_options).length ? arr(data.employee_options) : arr(data.employees).map((x) => ({
    value: x.employee_username || x.employee_user_id || x.employee_name,
    label: x.employee_name || x.employee_username || 'Employee',
  }));

  return <Layout title="Call Review" subtitle="">
    <div style={{display:'grid',gap:16}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,minmax(0,1fr))',gap:12}}>
        <Card label="Dialed Calls" value={summary.dialed_calls || summary.dialed || 0} tone="linear-gradient(135deg,#2563eb,#7c3aed)" accent="#ffffff" />
        <Card label="Connected Calls" value={summary.connected_calls || summary.connected || 0} tone="linear-gradient(135deg,#16a34a,#22c55e)" accent="#ffffff" />
        <Card label="Talk Time" value={fmt(summary.talktime_seconds || 0)} tone="linear-gradient(135deg,#7c3aed,#ec4899)" accent="#ffffff" />
        <Card label="Missed Calls" value={summary.missed_calls || summary.missed || 0} tone="linear-gradient(135deg,#ef4444,#f97316)" accent="#ffffff" />
        <Card label="Incoming Calls" value={summary.incoming_calls || summary.incoming || 0} tone="linear-gradient(135deg,#06b6d4,#2563eb)" accent="#ffffff" />
        <Card label="Outgoing Calls" value={summary.outgoing_calls || summary.outgoing || 0} tone="linear-gradient(135deg,#f97316,#f59e0b)" accent="#ffffff" />
        <Card label="Unique Calls" value={summary.unique_calls || summary.unique_numbers || 0} tone="linear-gradient(135deg,#14b8a6,#22c55e)" accent="#ffffff" />
      </div>

      <div style={{padding:16,borderRadius:22,background:'#fff',boxShadow:'0 14px 38px rgba(15,23,42,.10)',position:'relative'}}>
        <div style={{display:'grid',gridTemplateColumns:'1.1fr 1.3fr 1.5fr 1.5fr 1fr',gap:10,alignItems:'stretch'}}>
          <select value={filters.preset} onChange={(e)=>setFilters({...filters,preset:e.target.value})} style={field}>
            {PRESETS.map((item)=><option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <button type="button" onClick={()=>setShowDates((x)=>!x)} style={dateBtn}>
            📅 {filters.date_from || 'Start'} → {filters.date_to || 'End'}
          </button>
          <select value={filters.employee} onChange={(e)=>setFilters({...filters,employee:e.target.value})} style={field}>
            <option value="">All Employees</option>
            {employeeOptions.map((x, i)=><option key={`${x.value || x.username || i}`} value={x.value || x.username || x.user_id || x.label}>{x.label || x.full_name || x.username}</option>)}
          </select>
          <button onClick={()=>load(false)} disabled={busy} style={btn('linear-gradient(135deg,#2563eb,#7c3aed)', true)}>{'Update Details'}</button>
          <button onClick={clearFilters} style={btn('linear-gradient(135deg,#64748b,#334155)')}>Clear</button>
        </div>

        {showDates ? <div style={datePopup}>
          <div style={{fontWeight:1000,fontSize:15,color:'#0f172a',marginBottom:10}}>Calendar Range</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <label style={labelStyle}>Start Date<input type="date" value={filters.date_from} onChange={(e)=>setFilters({...filters,date_from:e.target.value,preset:'custom'})} style={{...field,width:'100%',marginTop:6}} /></label>
            <label style={labelStyle}>End Date<input type="date" value={filters.date_to} onChange={(e)=>setFilters({...filters,date_to:e.target.value,preset:'custom'})} style={{...field,width:'100%',marginTop:6}} /></label>
          </div>
          <button type="button" onClick={applyDateRange} style={{...btn('#0f766e'),width:'100%',marginTop:12}}>Apply Date Range</button>
        </div> : null}

        <div style={{fontWeight:900,color:'#475569',marginTop:10,fontSize:14}}>{message}</div>
      </div>

      <Panel title="Employee Summary">
        <Table heads={['Employee','Dialed','Connected','Talk','Missed','Incoming','Outgoing','Unique','Avg Risk','Last Location']} rows={arr(data.employees).map((x)=>[x.employee_name || x.employee_username || '-', x.dialed_calls || x.total_calls || 0, x.connected_calls || x.connected || 0, fmt(x.talktime_seconds || 0), x.missed_calls || 0, x.incoming_calls || 0, x.outgoing_calls || x.dialed_calls || 0, x.unique_calls || x.unique_numbers || 0, x.avg_risk || 0, <LocationCell key="loc" row={x} latest />])} empty="No employee calls yet for this range." />
      </Panel>
      <Panel title="Call Evidence">
        <div style={{overflowX:'auto'}}><table style={tableStyle}><thead><tr>{['Time','Employee','Candidate','Phone','Status','Ring','Hold','Talk','Quality','Reason','Risk','Location'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead><tbody>{arr(data.items).map((x,i)=><tr key={x.event_id || x.call_log_id || i}><td style={td}><TimeCell row={x} /></td><td style={td}>{x.employee_name || x.employee_username || '-'}</td><td style={td}>{x.candidate_name || x.candidate_id || '-'}</td><td style={td}>{x.phone || '-'}</td><td style={td}>{x.status || '-'}</td><td style={td}>{fmt(x.ring_seconds)}</td><td style={td}>{fmt(x.dial_hold_seconds)}</td><td style={td}>{fmt(x.talktime_seconds)}</td><td style={td}>{x.disconnect_by || x.call_quality || '-'}</td><td style={td}>{x.early_cut_reason || '-'}</td><td style={td}>{x.suspicious_score || 0}</td><td style={td}><LocationCell row={x} /></td></tr>)}{!arr(data.items).length?<tr><td colSpan="12" style={td}>No mobile calls found yet. Start calling from the app, then click Update Details here.</td></tr>:null}</tbody></table></div>
      </Panel>
    </div>
  </Layout>;
}
function LocationCell({ row = {}, latest = false }) {
  const lat = latest ? (row.latest_latitude || row.employee_latitude) : (row.employee_latitude || row.latest_latitude);
  const lng = latest ? (row.latest_longitude || row.employee_longitude) : (row.employee_longitude || row.latest_longitude);
  const at = latest ? (row.latest_location_at || row.employee_location_captured_at) : (row.employee_location_captured_at || row.latest_location_at);
  if (!lat || !lng) return <span style={{color:'#94a3b8'}}>N/A</span>;
  const href = `https://maps.google.com/?q=${encodeURIComponent(`${lat},${lng}`)}`;
  return <a href={href} target="_blank" rel="noreferrer" style={{fontWeight:1000,color:'#2563eb',textDecoration:'none'}}>Map <small style={{color:'#64748b',display:'block'}}>{row.display_location_time_ist || formatIstDateTime(at)}</small></a>;
}
function Card({label,value,tone,accent}){return <div className="cc371-call-review-card" style={{padding:20,borderRadius:26,background:tone,color:'#fff',boxShadow:'0 22px 54px rgba(15,23,42,.18)',border:'1px solid rgba(255,255,255,.72)',position:'relative',overflow:'hidden',minHeight:96}}><div style={{position:'absolute',right:-26,bottom:-36,width:126,height:126,borderRadius:999,background:'rgba(255,255,255,.18)'}} /><div style={{position:'absolute',inset:0,background:'linear-gradient(135deg,rgba(255,255,255,.10),rgba(255,255,255,0))'}} /><div style={{fontWeight:1000,fontSize:12,color:'rgba(255,255,255,.88)',lineHeight:1.2,letterSpacing:'.07em',textTransform:'uppercase',position:'relative',zIndex:1}}>{label}</div><div style={{fontWeight:1000,fontSize:38,marginTop:8,color:accent,position:'relative',zIndex:1,letterSpacing:'-.04em'}}>{value}</div></div>;}
function Panel({title,children}){return <div style={{padding:16,borderRadius:22,background:'#fff',boxShadow:'0 14px 38px rgba(15,23,42,.10)'}}><div style={{fontWeight:1000,fontSize:20,marginBottom:12,color:'#0f172a'}}>{title}</div>{children}</div>;}
function Table({heads,rows,empty}){return <div style={{overflowX:'auto'}}><table style={tableStyle}><thead><tr>{heads.map(h=><th key={h} style={th}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j} style={td}>{c ?? '-'}</td>)}</tr>)}{!rows.length?<tr><td colSpan={heads.length} style={td}>{empty}</td></tr>:null}</tbody></table></div>;}
const field={padding:'13px 14px',borderRadius:14,border:'1px solid #cbd5e1',fontWeight:900,minWidth:0,background:'#fff',color:'#0f172a',fontSize:14};
const dateBtn={...field,textAlign:'left',cursor:'pointer'};
const labelStyle={fontWeight:900,color:'#334155',fontSize:13};
function btn(bg, big=false){return {border:0,borderRadius:14,padding:big?'15px 18px':'13px 14px',background:bg,color:'#fff',fontWeight:1000,cursor:'pointer',fontSize:big?15:14,boxShadow:big?'0 12px 24px rgba(37,99,235,.22)':'none'};}
const datePopup={position:'absolute',left:145,top:62,zIndex:20,width:360,padding:14,borderRadius:18,background:'#fff',boxShadow:'0 24px 60px rgba(15,23,42,.22)',border:'1px solid #dbeafe'};
const tableStyle={width:'100%',borderCollapse:'separate',borderSpacing:0,minWidth:1120};
const th={textAlign:'left',padding:12,background:'#eff6ff',color:'#0f172a',fontWeight:1000,borderBottom:'1px solid #dbeafe'};
const td={padding:12,borderBottom:'1px solid #e2e8f0',fontWeight:800,color:'#334155'};
