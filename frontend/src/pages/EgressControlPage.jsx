import React, {useState} from 'react';
import Layout from '../components/Layout';
import {api} from '../lib/api';

export default function UsageControlPage(){
  const [data,setData]=useState(null),[percent,setPercent]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  async function refresh(){setBusy(true);try{const next=await api.get('/api/dialer/egress-guard',{cacheTtlMs:0,retries:0,timeoutMs:12000});setData(next);setPercent(String(next.today_percent??''));setMessage('Updated');}catch(e){setMessage(e.message);}finally{setBusy(false);}}
  async function save(){if(percent.trim()===''||!Number.isFinite(Number(percent))||Number(percent)<0||Number(percent)>100){setMessage('Enter a usage percentage from 0 to 100');return;}setBusy(true);try{const next=await api.post('/api/dialer/egress-guard',{today_percent:Number(percent)},{retries:0});setData(next);setMessage('Usage note saved');}catch(e){setMessage(e.message);}finally{setBusy(false);}}
  const estimate=data?.database_response_estimate;
  const cards=[['Data estimate',estimate?`${(Number(estimate.estimated_response_bytes||0)/1048576).toFixed(2)} MB`:'—','tone-orange'],['Queries',estimate?estimate.queries:'—','tone-purple'],['Update transport','Push + catch-up','tone-green'],['Recorded usage',data?.today_percent!=null?`${Number(data.today_percent).toFixed(2)}%`:'Not entered','tone-red']];
  return <Layout title="System Health">
    <div className="summary-grid top-gap-small">{cards.map(([title,value,tone])=><div key={title} className={`metric-card colorful-card ${tone}`}><span>{title}</span><strong>{value}</strong></div>)}</div>
    <section className="panel top-gap"><div className="panel-header"><h2 className="panel-title">Live health</h2><button className="add-profile-btn" disabled={busy} onClick={refresh}>{busy?'Checking…':'Refresh health ↻'}</button></div><p className="helper-text">The estimate covers measured responses during this server session. It is not the billing total.</p>{message?<div className="helper-text" role="status">{message}</div>:null}</section>
    <section className="panel top-gap"><h2 className="panel-title">Usage note</h2><div className="row-actions"><input aria-label="Recorded billing usage percentage" type="number" min="0" max="100" step="0.01" placeholder="Usage % from billing dashboard" value={percent} onChange={e=>setPercent(e.target.value)}/><button className="ghost-btn" disabled={busy} onClick={save}>Save note</button></div></section>
  </Layout>;
}
