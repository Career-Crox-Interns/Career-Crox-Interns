import React,{useEffect,useState} from 'react';
import {api} from '../lib/api';
const BASE='/api/data-backup/full-excel';
const XLSX='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const digest=async file=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
const date=value=>value?new Date(value).toLocaleString('en-IN'):'Not downloaded yet';
export default function FullExcelBackupPanel(){
 const [password,setPassword]=useState(''),[busy,setBusy]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState('');
 const [reminder,setReminder]=useState(null),[file,setFile]=useState(null),[preview,setPreview]=useState(null),[confirmed,setConfirmed]=useState(false),[pending,setPending]=useState(null);
 useEffect(()=>{api.get(BASE+'/reminder',{cacheTtlMs:0,allowStale:false,retries:0}).then(r=>setReminder(r.reminder)).catch(()=>{});},[]);
 async function grant(action){if(!password.trim())throw Error('Enter your current Manager password.');return (await api.post('/api/auth/export-access',{password,route_key:action==='download'?'data-backup/download':'data-backup/restore'},{retries:0})).export_token;}
 async function binary(path,token,body,headers={}){
  const r=await fetch(BASE+path,{method:'POST',credentials:'include',headers:{'X-Export-Token':token,...headers},body,cache:'no-store'});
  if(!r.ok){let data;try{data=await r.json();}catch{}throw Error(data?.message||data?.error||'Request failed ('+r.status+').');}return r;
 }
 async function run(action,fn){if(busy)return;setBusy(action);setMessage('');setError('');try{await fn();}catch(e){setError(e.name==='AbortError'?'File selection was cancelled.':e.message||'Operation failed.');}finally{setBusy('');}}
 async function saved(token,sha256,receipt){
  const result=await api.post(BASE+'/saved',{sha256,receipt},{headers:{'X-Export-Token':token},retries:0});
  setReminder(result.reminder);setPending(null);window.dispatchEvent(new Event('cc876-backup-state'));
 }
 async function download(){
  const filename='Career_Crox_FULL_CRM_'+new Date().toISOString().slice(0,10)+'.xlsx';
  let handle=null;
  if(window.showSaveFilePicker)handle=await window.showSaveFilePicker({suggestedName:filename,types:[{description:'CRM Excel backup',accept:{[XLSX]:['.xlsx']}}]});
  const token=await grant('download');setMessage('Preparing a complete snapshot. Keep this page open.');
  const response=await binary('/download',token,'{}',{'Content-Type':'application/json'}),blob=await response.blob();
  const sha256=await digest(blob),server=response.headers.get('X-CRM-Backup-SHA256'),receipt=response.headers.get('X-CRM-Backup-Receipt');
  if(sha256!==server||!receipt)throw Error('Download verification failed. No backup was marked as saved.');
  if(handle){
   const stream=await handle.createWritable();await stream.write(blob);await stream.close();
   if(await digest(await handle.getFile())!==sha256)throw Error('The saved file differs from the download. Download again.');
   const fresh=await grant('download');await saved(fresh,sha256,receipt);setMessage('Excel saved and verified. Your next reminder is in 3 days.');
  }else{
   const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
   setPending({sha256,receipt});setMessage('Download sent to your browser. Confirm below after the Excel file is saved on your device.');
  }
 }
 async function inspect(){
  if(!file)throw Error('Choose the Full CRM Excel file.');if(file.size>48*1024*1024)throw Error('The Excel file exceeds the 48 MB limit.');
  setPreview(null);setConfirmed(false);
  const result=await (await binary('/preview',await grant('restore'),file,{'Content-Type':XLSX})).json();
  setPreview(result);setMessage('Preview verified. Check the profiles and employee mapping before restoring.');
 }
 async function restore(){
  if(!preview||!file||!confirmed)throw Error('Preview the workbook and confirm replacement first.');
  if(await digest(file)!==preview.sha256)throw Error('File changed after preview. Preview it again.');
  const result=await(await binary('/restore',await grant('restore'),file,{'Content-Type':XLSX,'X-CRM-Workbook-Hash':preview.sha256,'X-CRM-Preview-Token':preview.preview_token,'X-CRM-Confirm-Restore':'RESTORE'})).json();
  setPreview(null);setConfirmed(false);setMessage('Restore verified: '+result.verified_candidates+' profiles and '+result.total+' CRM records. Ownership, team links and due dates are restored. Staff can reopen their dashboards.');
  window.dispatchEvent(new Event('cc837-read-invalidated'));window.dispatchEvent(new CustomEvent('career-crox-team-changed',{detail:{source:'/data-backup/full-excel/restore'}}));
 }
 return <section className="cc877-excel-panel" data-cc877-full-excel="true">
  <header className="cc877-excel-head"><div><span className="cc877-eyebrow">MANAGER WORKSPACE</span><h2>Full CRM Excel</h2><p>Download here. Upload in your next Career Crox CRM. Continue with the same profiles, ownership and reminder dates.</p></div><span className="cc877-data-badge">Records only</span></header>
  <div className="cc877-backup-summary"><div><small>Last saved backup</small><strong>{date(reminder?.last_saved_at)}</strong></div><div><small>Next reminder</small><strong>{date(reminder?.next_due_at)}</strong></div><div><small>Included files</small><strong>0 · No resumes or recordings</strong></div></div>
  <div className="cc877-password"><label htmlFor="cc877-backup-password">Your Manager password</label><input id="cc877-backup-password" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Confirm your identity"/></div>
  <div className="cc877-excel-actions"><article><span className="cc877-step">01</span><h3>Download this CRM</h3><p>Profiles, interviews, submissions, notes, tasks, follow-ups, teams and history in one Excel backup.</p><button className="add-profile-btn" disabled={!!busy||!password} onClick={()=>run('download',download)}>{busy==='download'?'Preparing Excel…':'Download Full CRM Excel'}</button>{pending&&<button className="ghost-btn" disabled={!!busy} onClick={()=>run('saved',async()=>{await saved(await grant('download'),pending.sha256,pending.receipt);setMessage('Saved backup confirmed. Next reminder in 3 days.');})}>I saved the Excel safely</button>}</article>
  <article><span className="cc877-step">02</span><h3>Restore in this CRM</h3><p>Use a compatible Career Crox CRM with matching employee usernames and roles. Login passwords remain on this CRM.</p><label className="cc877-file-label">Choose your backup<input type="file" aria-label="Select Career Crox Full Excel" accept=".xlsx" onChange={e=>{setFile(e.target.files?.[0]||null);setPreview(null);setConfirmed(false);}}/></label><button className="ghost-btn" disabled={!!busy||!password||!file} onClick={()=>run('preview',inspect)}>{busy==='preview'?'Checking records…':'Preview & Verify'}</button></article></div>
  {preview&&<div className="cc877-restore-preview"><h3>Check this snapshot</h3><div className="cc877-preview-metrics">{[['Profiles','candidates'],['Follow-ups','followups'],['Tasks','tasks'],['Interviews','interviews'],['Submissions','submissions'],['Notifications','reminders']].map(([label,key])=><div key={key}><strong>{preview.summary[key]||0}</strong><small>{label}</small></div>)}</div><p>Snapshot: {date(preview.summary.source_date)}. This CRM currently has <b>{preview.summary.existing_candidates} profiles</b>.</p>
  <div className="cc877-map-table"><table><thead><tr><th>Employee</th><th>Old ID</th><th>This CRM ID</th><th>Profiles</th></tr></thead><tbody>{preview.summary.employee_mapping.map(row=><tr key={row.username}><td>{row.username}</td><td>{row.from_id}</td><td>{row.to_id}</td><td>{row.profiles}</td></tr>)}</tbody></table></div>
  <label className="cc877-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>I saved a backup of this CRM and authorize replacing its structured CRM records with this snapshot.</span></label><button className="add-profile-btn" disabled={!!busy||!confirmed} onClick={()=>run('restore',restore)}>{busy==='restore'?'Restoring & verifying…':'Restore This Snapshot'}</button></div>}
  {message&&<p className="cc877-backup-message" role="status">{message}</p>}{error&&<p className="cc877-backup-error" role="alert">{error}</p>}
  <footer className="helper-text">Keep your Excel backup private. Reminders retain their saved due dates; the receiving CRM must be running. You can postpone the backup reminder by 6 hours, including after day 3.</footer>
 </section>;
}
