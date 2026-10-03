import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';

const blankEdit = { full_name:'', username:'', recruiter_code:'', password:'', is_active:true };

export default function BasicAdminPage(){
  const [interns,setInterns]=useState([]);
  const [health,setHealth]=useState(null);
  const [editId,setEditId]=useState('');
  const [form,setForm]=useState(blankEdit);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);

  async function load(){
    setBusy(true); setMessage('');
    try{
      const [users,system]=await Promise.all([
        api.get('/api/basic/admin/interns',{cacheTtlMs:0,timeoutMs:15000}),
        api.get('/api/basic/admin/health',{cacheTtlMs:0,timeoutMs:15000}),
      ]);
      setInterns(users.items||[]); setHealth(system||null);
    }catch(e){ setMessage(e.message||'Admin data load failed.'); }
    finally{ setBusy(false); }
  }
  useEffect(()=>{ load(); },[]);

  function startEdit(row){
    setEditId(row.user_id);
    setForm({full_name:row.full_name||'',username:row.username||'',recruiter_code:row.recruiter_code||'',password:'',is_active:String(row.is_active||'true').toLowerCase()!=='false'});
  }
  async function save(){
    if(!editId) return;
    setBusy(true); setMessage('');
    try{
      await api.put(`/api/basic/admin/interns/${encodeURIComponent(editId)}`,form,{timeoutMs:15000});
      setMessage('Intern profile updated.'); setEditId(''); setForm(blankEdit); await load();
    }catch(e){ setMessage(e.message||'Update failed.'); }
    finally{ setBusy(false); }
  }
  async function repair(){
    setBusy(true); setMessage('Checking and repairing required Supabase structure…');
    try{ const out=await api.post('/api/basic/admin/repair',{}, {timeoutMs:45000}); setHealth((h)=>({...h,schema:out.schema,ok:out.ok})); setMessage(out.ok?'Database structure is complete.':'Repair finished with remaining issues.'); await load(); }
    catch(e){ setMessage(e.message||'Database repair failed.'); }
    finally{ setBusy(false); }
  }

  const missing=(health?.schema?.missing_tables?.length||0)+(health?.schema?.missing_columns?.length||0);
  return <Layout title="Admin Control" subtitle="Intern Basic CRM">
    <div className="basic-admin-grid">
      <section className="panel glassy-card">
        <div className="panel-title">System Status</div>
        <div className="basic-admin-metrics">
          <div><span>Intern Profiles</span><strong>{health?.counts?.interns ?? '-'}</strong></div>
          <div><span>Candidates</span><strong>{health?.counts?.candidates ?? '-'}</strong></div>
          <div><span>CRM Logs</span><strong>{health?.counts?.crm_logs ?? '-'}</strong></div>
          <div><span>Schema Missing</span><strong>{missing}</strong></div>
        </div>
        <div className={`basic-health ${health?.schema?.ok?'ok':'warn'}`}>{health?.schema?.ok?'Supabase basic schema is complete.':'Supabase needs repair.'}</div>
        <div className="row-actions top-gap-small">
          <button type="button" className="add-profile-btn" disabled={busy} onClick={repair}>Check & Repair Supabase</button>
          <button type="button" className="ghost-btn" disabled={busy} onClick={load}>Refresh</button>
        </div>
        {health?.schema?.missing_tables?.length ? <div className="helper-text top-gap-small">Missing tables: {health.schema.missing_tables.join(', ')}</div>:null}
        {health?.schema?.missing_columns?.length ? <div className="helper-text top-gap-small">Missing columns: {health.schema.missing_columns.slice(0,30).join(', ')}{health.schema.missing_columns.length>30?'…':''}</div>:null}
      </section>

      <section className="panel glassy-card">
        <div className="panel-title">5 Intern Login Profiles</div>
        <div className="helper-text">Names, usernames and passwords can be changed anytime. Role stays Intern/Recruiter so access remains basic.</div>
        <div className="table-wrap top-gap-small"><table><thead><tr><th>Profile</th><th>Name</th><th>Username</th><th>Code</th><th>Status</th><th></th></tr></thead><tbody>
          {interns.map(row=><tr key={row.user_id}><td>{row.user_id}</td><td>{row.full_name}</td><td>{row.username}</td><td>{row.recruiter_code}</td><td>{String(row.is_active).toLowerCase()==='false'?'Inactive':'Active'}</td><td><button type="button" className="mini-btn view" onClick={()=>startEdit(row)}>Edit</button></td></tr>)}
        </tbody></table></div>
      </section>
    </div>

    {editId ? <div className="crm-modal-backdrop" onClick={()=>setEditId('')}><div className="crm-premium-modal" onClick={e=>e.stopPropagation()}>
      <div className="panel-title">Edit {editId}</div>
      <div className="form-grid top-gap-small">
        <label className="field"><span>Name</span><input value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})}/></label>
        <label className="field"><span>Username</span><input value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/></label>
        <label className="field"><span>Recruiter Code</span><input value={form.recruiter_code} onChange={e=>setForm({...form,recruiter_code:e.target.value})}/></label>
        <label className="field"><span>New Password (optional)</span><input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Leave blank to keep current"/></label>
        <label className="field"><span>Status</span><select value={form.is_active?'active':'inactive'} onChange={e=>setForm({...form,is_active:e.target.value==='active'})}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      </div>
      <div className="row-actions top-gap"><button type="button" className="add-profile-btn" disabled={busy} onClick={save}>Save Profile</button><button type="button" className="ghost-btn" onClick={()=>setEditId('')}>Cancel</button></div>
    </div></div>:null}
    {message?<div className="panel top-gap-small helper-text">{message}</div>:null}
  </Layout>;
}
