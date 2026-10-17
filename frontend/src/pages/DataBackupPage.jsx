import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { api, cachePrincipal } from '../lib/api';
import { workspaceIntentKey } from '../lib/workspaceHelpers';

export default function DataBackupPage() {
  const [password,setPassword]=useState(''), [phrase,setPhrase]=useState(''), [file,setFile]=useState(null);
  const [preview,setPreview]=useState(null), [envelope,setEnvelope]=useState(null), [busy,setBusy]=useState(''), [status,setStatus]=useState('');
  const [restored,setRestored]=useState(false);
  const mounted=useRef(true), epoch=useRef(0), restoring=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;};},[]);
  const resetPreview=()=>{epoch.current++;setPreview(null);setRestored(false);setStatus('');};
  const grant=async route=>{if(!password)throw Error('Enter your manager login password.');const data=await api.post('/api/auth/export-access',{password,route_key:route},{retries:0});return data.export_token;};
  async function download(){
    const principal=cachePrincipal();setBusy('download');setStatus('Preparing one complete encrypted backup…');
    try{
      const token=await grant('data-backup/download');
      const res=await fetch('/api/data-backup/download',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-Export-Token':token,'X-Career-Crox-Last-Activity-At':localStorage.getItem('careerCroxLastActivityAt')||''},body:JSON.stringify({manager_password:password})});
      if(!res.ok)throw Error((await res.json()).message||'Backup failed.');
      const blob=await res.blob();if(!mounted.current||principal!==cachePrincipal()||window.__CC602_NETWORK_PAUSED__)return;
      window.CC787Backup.save(blob,`Career_Crox_${new Date().toISOString().slice(0,10)}_CC787.ccbackup`);setStatus('Backup downloaded. Restore it using the manager password used for this file.');setPassword('');
    }catch(e){if(mounted.current)setStatus(e.message);}finally{if(mounted.current)setBusy('');}
  }
  async function downloadCandidates(){setBusy('excel');setStatus('Preparing candidate Excel with notes, interviews and submissions…');try{const token=await grant('data-backup/download');const payload=await api.post('/api/data-backup/candidate-excel',{}, {headers:{'X-Export-Token':token},retries:0,timeoutMs:120000,allowStale:false});window.CC787Backup.save(window.CC787Backup.candidateWorkbook(payload),'Career_Crox_Candidates_'+new Date().toISOString().slice(0,10)+'.xlsx');setStatus('Excel downloaded. Admin Control → Upload sheet can restore this original file after a reset.');setPassword('');}catch(e){setStatus(e.message);}finally{setBusy('');}}
  async function chooseFile(selected){
    resetPreview();const current=epoch.current;setFile(selected);setEnvelope(null);setLegacyFile(false);setPhrase('');
    if(!selected)return;
    setBusy('file');setStatus('Checking the selected file on your device…');
    try{
      if(selected.size>64*1024*1024)throw Error('Choose a backup smaller than 64 MB.');
      let raw;try{raw=JSON.parse(await selected.text());}catch{throw Error('This is not a valid Career Crox backup file.');}
      if(raw?.format!=='career-crox-backup'||raw.version!==1)throw Error('Choose a Career Crox .ccbackup file. Candidate Excel files go in Admin Control → Upload sheet.');
      if(current!==epoch.current||!mounted.current)return;
      const legacy=raw.password_mode!=='manager_login_v1';setEnvelope(raw);setLegacyFile(legacy);
      setStatus(legacy?'Legacy backup selected. Enter its backup passphrase, then preview.':'File selected. Enter your manager login password, then preview the backup.');
    }catch(e){if(current===epoch.current&&mounted.current)setStatus(e.message);}
    finally{if(current===epoch.current&&mounted.current)setBusy('');}
  }
  async function inspect(){
    if(busy||!file||!envelope)return;
    const current=++epoch.current;setBusy('preview');setStatus('Reading this backup on your device…');setPreview(null);setRestored(false);
    try{
      const secret=legacyFile?phrase:password;
      if(!secret)throw Error(legacyFile?'Enter the backup passphrase.':'Enter your manager login password.');
      const data=await window.CC787Backup.decode(envelope,secret);
      if(!data.tables||typeof data.tables!=='object'||Array.isArray(data.tables)||Object.values(data.tables).some(rows=>!Array.isArray(rows)))throw Error('Unsupported backup contents.');
      if(current!==epoch.current||!mounted.current)return;
      setPreview(data);setStatus('Preview ready. Review the contents below, then click Restore & save to CRM.');
    }catch(e){if(current===epoch.current&&mounted.current)setStatus(e.message);}
    finally{if(current===epoch.current&&mounted.current)setBusy('');}
  }
  async function restore(){
    if(restoring.current||busy||restored||!preview||!envelope||!password)return;restoring.current=true;setBusy('restore');setStatus('Restoring the reviewed backup. Matching IDs are updated; other records are kept…');
    try{const command=await workspaceIntentKey('backup-restore',{sha256:envelope.sha256});const token=await grant('data-backup/restore');const data=await api.post('/api/data-backup/restore',{backup:envelope,passphrase:envelope.password_mode==='manager_login_v1'?'CC828_MANAGER_BACKUP:'+password:phrase,command_id:command},{headers:{'X-Export-Token':token},retries:0,timeoutMs:300000,allowStale:false});if(!mounted.current)return;
      for(const storage of [localStorage,sessionStorage])for(const key of Object.keys(storage))if(key!=='careerCroxCachedUser' && /careerCrox.*(?:Cache|CandidateNav|InstantCandidate)|cc_chat_cache|cc489_chat_shell/.test(key))storage.removeItem(key);
      window.dispatchEvent(new Event('career-crox-account-changed'));window.dispatchEvent(new CustomEvent('career-crox-data-written',{detail:{path:'/api/candidates/restore',method:'POST'}}));
      setRestored(true);setStatus(`${data.replayed?'Already restored safely':'Restore completed'} · ${data.counts?.candidates||0} candidates · ${data.counts?.notes||0} notes · ${data.counts?.revenue_hub_entries||0} revenue records. Open Candidates to see them.`);setPassword('');
    }catch(e){if(mounted.current)setStatus(e.message);}finally{restoring.current=false;if(mounted.current)setBusy('');}
  }
  const [tableSearch,setTableSearch]=useState('');
  const [mode,setMode]=useState('candidates');const [legacyFile,setLegacyFile]=useState(false);
  const canPreview=!!file&&!!envelope&&(legacyFile?phrase.length>=12:!!password);
  const entries=preview?Object.entries(preview.tables).filter(([,rows])=>rows.length):[];
  return <Layout title="Data Backup">
    <div id="cc826-backup" className="cc826-studio">
    <header className="cc826-studio-hero"><div><span className="cc826-eyebrow">BACKUP STUDIO</span><h2>Your records. Your safety net.</h2></div><Link className="ghost-btn" to="/candidates">Open candidates ↗</Link></header>
    <div className="cc826-mode-grid">{[['candidates','Candidate Excel','Profiles, notes, approvals and interviews.','mint'],['complete','Complete backup','All CRM records in one encrypted file.','peach'],['restore','Restore a backup','Review a saved backup before restoring.','lavender']].map(([key,title,description,tone])=><button key={key} className={`cc826-mode-card ${tone} ${mode===key?'active':''}`} aria-pressed={mode===key} disabled={!!busy} onClick={()=>{if(key!==mode){resetPreview();setMode(key);}}}><strong>{title}</strong><span>{description}</span></button>)}</div>
    <section className="panel cc826-backup-workspace">
      <h2>{mode==='candidates'?'Download candidate Excel':mode==='complete'?'Download complete backup':'Review & restore'}</h2>
      <div className="cc826-form-grid"><label className="field">Manager login password<input id="backup-password" type="password" autoComplete="current-password" value={password} disabled={!!busy} onChange={e=>{resetPreview();setPassword(e.target.value);}}/></label>{mode==='restore'&&legacyFile?<label className="field">Legacy backup passphrase<input id="backup-phrase" type="password" autoComplete="off" placeholder="12–256 characters" value={phrase} disabled={!!busy} onChange={e=>{resetPreview();setPhrase(e.target.value);}}/></label>:null}</div>
      {mode==='candidates'?<><p>Download the workbook. Restore it later from Admin Control → Upload sheet.</p><button className="add-profile-btn" disabled={!!busy||!password} onClick={downloadCandidates}>{busy==='excel'?'Preparing Excel…':'Download candidate Excel'}</button></>:null}
      {mode==='complete'?<><div className="cc826-includes"><span>Profiles & notes</span><span>Tasks & team history</span><span>Calls & attendance</span><span>Revenue & documents</span></div><p>Use your manager login password. Active logins and phone pairing are excluded.</p><div className="cc826-actions"><button className="add-profile-btn" disabled={!!busy||!password} onClick={download}>{busy==='download'?'Preparing backup…':'Download complete backup'}</button><a className="ghost-btn" href="/recover-backup.html" target="_blank" rel="noreferrer">Recovery after reset ↗</a></div></>:null}
      {mode==='restore'?<><label className="field cc826-file-zone">Choose your .ccbackup file<input aria-label="Backup file" type="file" accept=".ccbackup,application/json" disabled={!!busy} onChange={e=>chooseFile(e.target.files?.[0]||null)}/></label><p>Preview stays on this device. Restore adds missing records and updates matching IDs.</p><div className="cc826-actions"><button type="button" className="ghost-btn" disabled={!!busy||!canPreview||restored} onClick={inspect}>{busy==='file'?'Checking file…':busy==='preview'?'Reading backup…':'Preview backup'}</button><button type="button" className="add-profile-btn" disabled={!!busy||!preview||!envelope||!password||restored} onClick={restore}>{busy==='restore'?'Restoring…':restored?'Restore complete':'Restore & save to CRM'}</button></div>{!preview&&!restored?<p className="helper-text">Preview the file to enable Restore & save to CRM.</p>:null}</>:null}
      {status?<div className="cc791-backup-status top-gap" role="status" aria-live="polite">{status}</div>:null}
    </section>
        {mode==='restore'&&preview?<section className="panel cc787-settings-section cc791-backup-review"><div className="panel-heading-row"><div><h2 className="panel-title">Backup contents</h2><p className="helper-text">Created {new Date(preview.created_at).toLocaleString()} · {(preview.files||[]).length} saved documents{preview.missing_attachments?.length?` · ${preview.missing_attachments.length} referenced files were already missing at source`:''}</p></div><input type="search" aria-label="Find backup table" placeholder="Find a table…" value={tableSearch} onChange={e=>setTableSearch(e.target.value)}/></div><div className="cc787-backup-counts">{entries.filter(([name])=>name.replace(/_/g,' ').includes(tableSearch.toLowerCase())).map(([name,rows])=><div key={name}><span>{name.replace(/_/g,' ')}</span><strong>{rows.length}</strong></div>)}</div><div className="row-actions top-gap"><button type="button" className="ghost-btn" disabled={!!busy} onClick={async()=>{try{window.CC787Backup.save(await window.CC787Backup.recoveryZip(preview),'Career_Crox_Recovery_CC791.zip');}catch(e){setStatus(e.message);}}}>Download offline recovery ZIP</button></div></section>:null}
    </div>
  </Layout>;
}
