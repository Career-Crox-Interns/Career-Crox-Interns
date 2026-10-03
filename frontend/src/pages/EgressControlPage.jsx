import React, { useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';

const fmt = (v) => Number(v || 0).toFixed(2);

export default function UsageControlPage() {
  const [data, setData] = useState(null);
  const [manualPercent, setManualPercent] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Manual-only page. Click Update Status. Background refresh stays off by default.');

  async function load() {
    setBusy(true);
    setMessage('Updating system status...');
    try {
      const d = await api.get(`/api/dialer/egress-guard?_ts=${Date.now()}`, { cacheTtlMs: 0, timeoutMs: 20000 });
      setData(d);
      setManualPercent(String(d.today_percent ?? ''));
      setMessage('System status updated manually.');
    } catch (e) {
      setMessage(e.message || 'System status update failed.');
    } finally { setBusy(false); }
  }

  async function save(mode = '') {
    setBusy(true);
    setMessage('Saving system guard...');
    try {
      const body = { today_percent: manualPercent };
      if (mode) body.mode = mode;
      const d = await api.post('/api/dialer/egress-guard', body, { cacheTtlMs: 0, timeoutMs: 20000 });
      setData(d);
      setManualPercent(String(d.today_percent ?? ''));
      setMessage('System guard saved. Heavy refresh stays locked unless a manager changes it.');
    } catch (e) { setMessage(e.message || 'Save failed.'); }
    finally { setBusy(false); }
  }

  const percent = Number(data?.today_percent || 0);
  const danger = percent >= Number(data?.danger_percent || 3);
  const warn = percent >= Number(data?.warning_percent || 2);
  const safe = data || { target_percent: 2, warning_percent: 2, hard_safe_percent: 2.5, danger_percent: 3, mode: 'manual_safe' };
  const cards = [
    ['Today Usage', `${fmt(percent)}%`, danger ? 'Danger line' : warn ? 'Warning zone' : 'Safe zone'],
    ['Target', `${fmt(safe.target_percent)}%`, 'Daily target'],
    ['Hard Safe', `${fmt(safe.hard_safe_percent)}%`, 'Heavy sections lock here'],
    ['Danger', `${fmt(safe.danger_percent)}%`, 'Must not touch'],
  ];

  return <Layout title="System Health" subtitle="">
    <div style={{display:'grid',gap:16}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:14}}>
        {cards.map((c,i)=><div key={c[0]} style={{padding:18,borderRadius:22,background:i===0?(danger?'linear-gradient(135deg,#7f1d1d,#ef4444)':warn?'linear-gradient(135deg,#92400e,#f59e0b)':'linear-gradient(135deg,#065f46,#10b981)'):'linear-gradient(135deg,#0f172a,#334155)',color:'#fff',boxShadow:'0 18px 42px rgba(15,23,42,.18)'}}><div style={{fontWeight:900,fontSize:13,opacity:.9}}>{c[0]}</div><div style={{fontWeight:1000,fontSize:30,marginTop:8}}>{c[1]}</div><div style={{fontWeight:800,fontSize:12,opacity:.85}}>{c[2]}</div></div>)}
      </div>

      <div style={{padding:18,borderRadius:24,background:'#fff',boxShadow:'0 14px 38px rgba(15,23,42,.12)',display:'grid',gap:12}}>
        <div style={{fontWeight:1000,fontSize:20,color:'#0f172a'}}>Manual Usage Guard</div>
        <div style={{fontWeight:800,color:'#64748b'}}>Supabase exact billing meter API is not polled automatically. Manager enters current dashboard percent here, then CRM locks heavy behavior. Auto-refresh stays off by default.</div>
        <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
          <input value={manualPercent} onChange={(e)=>setManualPercent(e.target.value)} placeholder="Today usage % e.g. 1.72" style={{padding:'13px 14px',borderRadius:14,border:'1px solid #cbd5e1',fontWeight:900,minWidth:220}} />
          <button onClick={load} disabled={busy} style={btn('#2563eb')}>{'Update Status'}</button>
          <button onClick={()=>save('manual_safe')} disabled={busy} style={btn('#059669')}>Save Safe Mode</button>
          <button onClick={()=>save('hard_lock')} disabled={busy} style={btn('#dc2626')}>Lock Heavy Sections</button>
        </div>
        <div style={{fontWeight:900,color:danger?'#b91c1c':warn?'#92400e':'#166534'}}>{message}</div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:14}}>
        <Rule title="Auto-refresh OFF" text="Dashboard, reports, candidates, interviews, submissions, notes, pipeline and recent activity do not refresh in background." />
        <Rule title="Only tiny command check" text="Android app checks command version only. Full queue sync is manual/morning sync, not every few seconds." />
        <Rule title="2.5% heavy lock" text="When usage goes above the hard-safe level, heavy report and table views stay manual and the warning remains visible." />
        <Rule title="3% danger line" text="CRM shows danger state before this line. Full-table refresh/realtime remains blocked. Full-table refresh remains locked by default." />
      </div>
    </div>
  </Layout>;
}
function btn(bg){return {border:0,borderRadius:14,padding:'13px 16px',background:bg,color:'#fff',fontWeight:1000,cursor:'pointer',boxShadow:'0 12px 26px rgba(15,23,42,.18)'};}
function Rule({title,text}){return <div style={{padding:18,borderRadius:22,background:'linear-gradient(135deg,#f8fafc,#eef2ff)',border:'1px solid #e2e8f0'}}><div style={{fontWeight:1000,color:'#0f172a',fontSize:17}}>{title}</div><div style={{fontWeight:800,color:'#475569',marginTop:8}}>{text}</div></div>;}
