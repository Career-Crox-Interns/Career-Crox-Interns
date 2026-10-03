import React, { useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';

export default function MobileAppPage() {
  const [app, setApp] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Career Crox APK download is ready.');

  async function load() {
    setBusy(true);
    setMessage('Checking latest Career Crox APK...');
    try {
      const d = await api.get(`/api/mobile-app/latest?_ts=${Date.now()}`, { cacheTtlMs: 0, timeoutMs: 15000 });
      setApp(d);
      setMessage('Latest Career Crox APK info loaded.');
    } catch (e) {
      setMessage(e.message || 'Version check failed. Direct download is still available.');
    } finally {
      setBusy(false);
    }
  }

  function downloadApk() {
    const fileName = app?.file_name || 'Career Crox.apk';
    const apkUrl = app?.download_url || '/download/android-apk';
    const link = document.createElement('a');
    link.href = apkUrl;
    link.download = fileName;
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setMessage('Career Crox APK download requested.');
  }

  const file = app?.file_name || 'Career Crox.apk';

  return <Layout title="Android App" subtitle="">
    <div style={{display:'grid',gap:16}}>
      <div style={{padding:20,borderRadius:26,background:'linear-gradient(135deg,#0f172a,#2563eb,#10b981)',color:'#fff',boxShadow:'0 18px 48px rgba(15,23,42,.20)'}}>
        <div style={{fontWeight:1000,fontSize:28}}>Career Crox Calling Assistant</div>
        <div style={{fontWeight:900,opacity:.88,marginTop:6}}>Latest: {file}</div>
        <div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:16}}>
          <button onClick={load} disabled={busy} style={btn('#ffffff','#0f172a')}>{busy?'Checking...':'Update Version'}</button>
          <button onClick={downloadApk} style={btn('#22c55e','#fff')}>Download Android App</button>
        </div>
        <div style={{fontWeight:800,marginTop:12,opacity:.9}}>{message}</div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:14}}>
        <Box title="Single setup file" text="APK download is directly connected to this CRM button. No external link needed." />
        <Box title="Pair-code calling" text="CRM Sync Mobile Queue and Start Calling go through the paired Calling Assistant app so call list, records, ring time and early-cut guard stay trackable." />
        <Box title="Required permissions" text="Call Phone, Read Call Log, Read Phone State, Notifications. No SMS, overlay, or accessibility permissions." />
      </div>
      <div style={{padding:18,borderRadius:24,background:'#fff',boxShadow:'0 14px 38px rgba(15,23,42,.10)'}}>
        <div style={{fontWeight:1000,fontSize:20,color:'#0f172a'}}>Install Flow</div>
        <ol style={{fontWeight:850,color:'#475569',lineHeight:1.8}}>
          <li>Click Download Android App from this page.</li>
          <li>Install APK and allow requested permissions.</li>
          <li>Generate 4 digit pair code from CRM Calling Assistant / Dialer page.</li>
          <li>Pair phone. After that CRM queue, Start, Pause, Resume, Stop and call records stay linked to this app.</li>
        </ol>
      </div>
    </div>
  </Layout>;
}

function Box({title,text}) {
  return <div style={{padding:18,borderRadius:22,background:'linear-gradient(135deg,#f8fafc,#eef2ff)',border:'1px solid #e2e8f0'}}>
    <div style={{fontWeight:1000,color:'#0f172a',fontSize:17}}>{title}</div>
    <div style={{fontWeight:800,color:'#475569',marginTop:8}}>{text}</div>
  </div>;
}

function btn(bg,color) {
  return {border:0,borderRadius:16,padding:'13px 17px',background:bg,color,fontWeight:1000,cursor:'pointer',boxShadow:'0 12px 26px rgba(15,23,42,.18)'};
}
