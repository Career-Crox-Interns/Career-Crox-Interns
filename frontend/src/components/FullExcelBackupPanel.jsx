import React,{useEffect,useRef,useState} from 'react';
import {api} from '../lib/api';
const BASE='/api/data-backup/full-excel',XLSX='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const digest=async file=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');
const date=value=>value?new Date(value).toLocaleString('en-IN'):'No saved copy yet';
export default function FullExcelBackupPanel(){
 const [password,setPassword]=useState(''),[passcode,setPasscode]=useState(''),[newPin,setNewPin]=useState(''),[repeatPin,setRepeatPin]=useState(''),[pinReady,setPinReady]=useState(null);
 const busyRef=useRef(false);
 const [report,setReport]=useState(null),[uncertain,setUncertain]=useState(false);
 const [busy,setBusy]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState(''),[done,setDone]=useState(false);
 const [reminder,setReminder]=useState(null),[file,setFile]=useState(null),[preview,setPreview]=useState(null),[confirmed,setConfirmed]=useState(false),[pending,setPending]=useState(null);
 useEffect(()=>{let live=true;api.get(BASE+'/reminder',{cacheTtlMs:0,allowStale:false,retries:0}).then(r=>{if(live)setReminder(r.reminder);}).catch(()=>{});api.get('/api/auth/transfer-passcode',{cacheTtlMs:0,allowStale:false,retries:0}).then(r=>{if(live)setPinReady(r.configured);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[]);
 async function grant(action){if(!password)throw Error('Enter your Manager password.');if(!/^\d{4}$/.test(passcode))throw Error('Enter your separate four-digit transfer passcode.');return(await api.post('/api/auth/export-access',{password,passcode,route_key:action==='download'?'data-backup/download':'data-backup/restore'},{retries:0})).export_token;}
 async function binary(path,token,body,headers={},base=BASE){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);
  const readableError=error=>error.name==='AbortError'?Error('The request did not finish in three minutes. No automatic retry was sent. For an import, sign in again and check Last import before starting another import.'):error;
  try{
   const r=await fetch(base+path,{method:'POST',credentials:'include',headers:{'X-Export-Token':token,...headers},body,cache:'no-store',signal:controller.signal});
   if(!r.ok){let data;try{data=await r.json();}catch(error){if(error.name==='AbortError')throw error;}const error=Error(data?.message||data?.error||'Request failed ('+r.status+').');error.report=data?.report;throw error;}
   const read=async kind=>{try{return await r[kind]();}catch(error){throw readableError(error);}finally{clearTimeout(timer);}};
   return {headers:r.headers,json:()=>read('json'),blob:()=>read('blob')};
  }catch(error){clearTimeout(timer);throw readableError(error);}
 }
 async function run(action,fn){if(busyRef.current)return;busyRef.current=true;setBusy(action);setMessage('');setError('');try{await fn();}catch(e){if(e.report)setReport(e.report);setError(e.name==='AbortError'?'File selection was cancelled.':e.message||'Operation failed.');}finally{busyRef.current=false;setBusy('');setPasscode('');setPassword('');}}
 async function checkLastImport(){const r=await api.get(BASE+'/reminder',{cacheTtlMs:0,allowStale:false,retries:0});setReminder(r.reminder);const last=r.reminder?.last_restore;if(!last){setMessage('No committed import record is stored here. A lost connection alone does not prove success.');return;}const same=file&&await digest(file)===last.sha256;setMessage((same?'This selected file was committed. ':'Last committed import: ')+date(last.restored_at)+' · '+last.profiles+' profiles. Sign in with the transferred account.');}
 function saveReport(){const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Career_Crox_Import_Checks.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 async function savePin(){if(newPin!==repeatPin)throw Error('The new passcodes do not match.');if(!/^\d{4}$/.test(newPin))throw Error('Choose exactly four digits.');await api.post('/api/auth/transfer-passcode',{password,old_passcode:passcode,new_passcode:newPin},{retries:0});setPinReady(true);setNewPin('');setRepeatPin('');setMessage('Transfer passcode saved. Use the new passcode for download or upload.');}
 async function saved(token,sha256,receipt){const result=await api.post(BASE+'/saved',{sha256,receipt},{headers:{'X-Export-Token':token},retries:0});setReminder(result.reminder);setPending(null);window.dispatchEvent(new Event('cc876-backup-state'));}
 async function download(){
  const filename='Career_Crox_FULL_CRM_'+new Date().toISOString().slice(0,10)+'.xlsx';let handle=null;
  if(window.showSaveFilePicker)handle=await window.showSaveFilePicker({suggestedName:filename,types:[{description:'Career Crox CRM transfer',accept:{[XLSX]:['.xlsx']}}]});
  const token=await grant('download');setMessage('Preparing all CRM records and staff accounts. Keep this page open.');
  const response=await binary('/download',token,'{}',{'Content-Type':'application/json'}),blob=await response.blob(),sha256=await digest(blob),server=response.headers.get('X-CRM-Backup-SHA256'),receipt=response.headers.get('X-CRM-Backup-Receipt');
  if(sha256!==server||!receipt)throw Error('File verification failed. Download again.');
  if(handle){const stream=await handle.createWritable();await stream.write(blob);await stream.close();if(await digest(await handle.getFile())!==sha256)throw Error('The saved file differs. Download again.');await saved(await grant('download'),sha256,receipt);setMessage('Excel saved and verified. Next copy reminder in 3 days.');}
  else{const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);setPending({sha256,receipt});setMessage('Download sent to your browser. Confirm after the Excel file is saved.');}
 }
 async function inspect(){if(!file)throw Error('Choose your Full CRM Excel file.');if(file.size>48*1024*1024)throw Error('The Excel file exceeds 48 MB.');setPreview(null);setReport(null);setConfirmed(false);const result=await(await binary('/preview?diagnostics=1',await grant('restore'),file,{'Content-Type':XLSX})).json();setPreview(result);setReport(result.report||null);setUncertain(false);setMessage('Preview verified. Review the checks and any display-preference repair before importing.');}
 async function restore(){
  if(!preview||!file||!confirmed)throw Error('Preview the workbook and confirm replacement first.');if(await digest(file)!==preview.sha256)throw Error('File changed. Preview again.');
  const token=await grant('restore');let result;try{result=await(await binary('/restore',token,file,{'Content-Type':XLSX,'X-CRM-Workbook-Hash':preview.sha256,'X-CRM-Preview-Token':preview.preview_token,'X-CRM-Confirm-Restore':'RESTORE'})).json();}catch(error){setUncertain(true);setPreview(null);setConfirmed(false);throw error;}
  setPreview(null);setConfirmed(false);setUncertain(false);setDone(true);setMessage('Transfer complete: '+result.verified_candidates+' profiles. This CRM is ready for normal work. Sign in with the transferred username and password.');
  for(const storage of [localStorage,sessionStorage])try{storage.clear();}catch{}
  window.dispatchEvent(new Event('cc837-read-invalidated'));
 }
 const unlocked=!!password&&/^\d{4}$/.test(passcode)&&pinReady===true;
 return <section className="cc877-excel-panel cc878-transfer-panel" data-cc878-transfer="true">
  <header className="cc877-excel-head"><div><span className="cc877-eyebrow">MANAGER WORKSPACE</span><h2>Full CRM Excel</h2><p>Move your CRM data here and continue working. Staff logins, ownership and reminder dates stay together.</p></div><span className="cc877-data-badge">CRM transfer</span></header>
  <div className="cc877-backup-summary"><div><small>Last saved copy</small><strong>{date(reminder?.last_saved_at)}</strong></div><div><small>Next copy reminder</small><strong>{date(reminder?.next_due_at)}</strong></div><div><small>Media files</small><strong>0 · No resumes or recordings</strong></div></div>
  <form className="cc878-transfer-security" autoComplete="off" onSubmit={e=>e.preventDefault()}>
   <div className="cc878-credentials"><label>Your Manager password<input aria-label="Your Manager password" type="password" autoComplete="off" name="transfer-manager-confirm" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Confirm your identity"/></label><label>Transfer passcode<input aria-label="Transfer passcode" type="password" inputMode="numeric" autoComplete="off" name="crm-transfer-code" maxLength={4} value={passcode} onChange={e=>setPasscode(e.target.value.replace(/\D/g,''))} placeholder="4 separate digits"/></label></div>
   <details open={pinReady===false} className="cc878-pin-settings"><summary>{pinReady===false?'Set your transfer passcode':'Change transfer passcode'}</summary><p>{pinReady===false?'Choose your own four-digit passcode before transferring data.':'Enter the current passcode above, then choose a new one below.'}</p><div className="cc878-credentials"><label>New passcode<input aria-label="New passcode" type="password" inputMode="numeric" maxLength={4} autoComplete="new-password" value={newPin} onChange={e=>setNewPin(e.target.value.replace(/\D/g,''))}/></label><label>Repeat new passcode<input aria-label="Repeat new passcode" type="password" inputMode="numeric" maxLength={4} autoComplete="new-password" value={repeatPin} onChange={e=>setRepeatPin(e.target.value.replace(/\D/g,''))}/></label></div><button type="button" className="ghost-btn" disabled={!!busy||!password||!newPin||newPin!==repeatPin||(pinReady&&!passcode)} onClick={()=>run('pin',savePin)}>{busy==='pin'?'Saving…':'Save passcode'}</button></details>
  </form>
  <WorkingCopyPanel unlocked={unlocked} busy={busy} run={run} grant={grant} binary={binary}/>
  <div className="cc877-excel-actions"><article><span className="cc877-step">01</span><h3>Download this CRM</h3><p>Includes staff login hashes, profiles, interviews, submissions, notes, tasks, follow-ups, teams, settings and history.</p><button className="add-profile-btn" disabled={!!busy||!unlocked||done} onClick={()=>run('download',download)}>{busy==='download'?'Preparing Excel…':'Download Full CRM Excel'}</button>{pending&&<button className="ghost-btn" disabled={!!busy||!unlocked} onClick={()=>run('saved',async()=>{await saved(await grant('download'),pending.sha256,pending.receipt);setMessage('Saved copy confirmed. Next reminder in 3 days.');})}>I saved the Excel safely</button>}</article>
  <article><span className="cc877-step">02</span><h3>Import & use this CRM</h3><p>Missing staff accounts are created. Source usernames, passwords and roles replace this CRM’s staff roster. Everyone signs in on this URL and continues working.</p><label className="cc877-file-label">Choose your transfer file<input type="file" disabled={!!busy||done} aria-label="Select Career Crox Full Excel" accept=".xlsx" onChange={e=>{setFile(e.target.files?.[0]||null);setPreview(null);setReport(null);setError('');setConfirmed(false);}}/></label><button className="ghost-btn" disabled={!!busy||!unlocked||!file||done} onClick={()=>run('preview',inspect)}>{busy==='preview'?'Checking records…':'Preview & Verify'}</button></article></div>
  <div className="helper-text" style={{marginTop:12}}><b>Last recorded import:</b> {reminder?.last_restore?date(reminder.last_restore.restored_at)+' · '+reminder.last_restore.profiles+' profiles':'No recorded import'} <button type="button" className="ghost-btn" disabled={!!busy} onClick={()=>run('status',checkLastImport)}>Check last import</button></div>
  {uncertain&&<p className="cc877-backup-error" role="alert">The import result is not confirmed in this tab. No automatic retry was sent. Sign in again if required and check Last import before importing again.</p>}
  {report&&<div className="cc877-restore-preview" aria-label="Import check report"><h3>Import checks · {report.version||'CC188'}</h3><p>{report.issues?.length?'Verification stopped before changing CRM records. Review these issues. Checks marked Not checked did not complete.':'Completed checks passed. Review the repairs below before confirming replacement.'}</p><div className="cc877-preview-metrics">{report.stages?.map(item=><div key={item.name}><strong style={{fontSize:13}}>{({passed:'Passed',failed:'Blocked',not_checked:'Not checked',checking:'Checking'})[item.status]||item.status}</strong><small>{item.name}</small></div>)}</div>{report.issues?.length>0&&<div className="cc877-map-table" style={{maxHeight:320,overflow:'auto'}}><table><thead><tr><th>Table / field</th><th>Issue</th><th>Records</th></tr></thead><tbody>{report.issues.map((issue,index)=><tr key={index}><td>{issue.table||'Backup'}{issue.column?' / '+issue.column:''}</td><td>{issue.message}{issue.rows?.length>0&&<small style={{display:'block'}}>Record positions: {issue.rows.join(', ')}</small>}</td><td>{issue.count||1}</td></tr>)}</tbody></table></div>}{report.warnings?.length>0&&<div style={{maxHeight:240,overflow:'auto'}}><b>Repairs to review</b><ul>{report.warnings.map((warning,index)=><li key={index}>{warning.message}{warning.employee_id?' Employee: '+warning.employee_id:''}</li>)}</ul></div>}<button type="button" className="ghost-btn" onClick={saveReport}>Save check report</button></div>}
  {preview&&<div className="cc877-restore-preview"><h3>Review this transfer</h3><div className="cc877-preview-metrics">{[['Profiles','candidates'],['Follow-ups','followups'],['Tasks','tasks'],['Interviews','interviews'],['Submissions','submissions'],['Staff','staff_mapped']].map(([label,key])=><div key={key}><strong>{preview.summary[key]||0}</strong><small>{label}</small></div>)}</div><p>Saved {date(preview.summary.source_date)} · This CRM currently has <b>{preview.summary.existing_candidates} profiles</b>. <b>{preview.summary.staff_created} staff accounts</b> will be created; {preview.summary.staff_replaced} destination-only accounts will be removed.</p><div className="cc877-map-table"><table><thead><tr><th>Employee</th><th>Account action</th><th>Profiles</th></tr></thead><tbody>{preview.summary.employee_mapping.map(row=><tr key={row.username}><td>{row.username}</td><td>{row.action}</td><td>{row.profiles}</td></tr>)}</tbody></table></div><p className="helper-text">{preview.warning}</p>{preview.summary.columns_added_on_restore?.length>0&&<p className="helper-text">Missing fields will be added safely when you confirm: {preview.summary.columns_added_on_restore.join(", ")}</p>}{Object.keys(preview.summary.defaulted_columns||{}).length>0&&<p className="helper-text">New fields absent in the older Excel use this CRM’s normal database defaults.</p>}<label className="cc877-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>I saved this CRM’s current data and authorize replacing its records and staff logins. All users will sign in again with the transferred credentials. I reviewed the display-preference repairs above; both alternatives will be preserved in this import record.</span></label><button className="add-profile-btn" disabled={!!busy||!confirmed||!unlocked} onClick={()=>run('restore',restore)}>{busy==='restore'?'Importing & verifying…':'Import & Start Using This CRM'}</button></div>}
  {message&&<p className="cc877-backup-message" role="status">{message}</p>}{error&&<p className="cc877-backup-error" role="alert">{error}</p>}{done&&<a className="add-profile-btn" href="/login">Sign in to this CRM</a>}
  <footer className="helper-text">Keep this Excel private: it contains CRM data and login hashes. This file is not encrypted. Your separate transfer passcode and hosting credentials stay on each CRM. Due dates remain unchanged; there is no automatic sync between CRMs.</footer>
 </section>;
}


const WORK_BASE='/api/data-backup/working-copy';
const encodedPassword=value=>btoa(String.fromCharCode(...new TextEncoder().encode(value))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function WorkingCopyPanel({unlocked,busy,run,grant,binary}){
 const [format,setFormat]=useState('xlsx'),[dateRange,setDateRange]=useState(false);
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[password,setPassword]=useState('');
 const [file,setFile]=useState(null),[review,setReview]=useState(null),[status,setStatus]=useState('');
 async function send(route,action,body,headers){
  return binary('/'+route,await grant(action),body,headers,WORK_BASE);
 }
 function checkPassword(){
  if(password.length<8||!password.trim())throw Error('Enter the separate file password of at least 8 characters.');
 }
 async function download(){
  checkPassword();
  if(dateRange&&(!from||!to||from>to))throw Error('Choose the start and end date.');
  const response=await send('download','download',JSON.stringify({format,file_password:password,from:dateRange?from:'',to:dateRange?to:''}),{'Content-Type':'application/json'});
  const href=URL.createObjectURL(await response.blob()),link=document.createElement('a');
  const stamp=new Date().toISOString().slice(0,10);
  link.href=href;link.download='Career_Crox_Working_Copy_'+stamp+(format==='csv'?'_CSV.zip':'.xlsx');
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(href),60000);
  setPassword('');
  setStatus('Encrypted file downloaded. Open it with your file password.');
 }
 async function inspect(){
  checkPassword();
  if(!file||file.size>48*1024*1024)throw Error('Choose a Working Copy under 48 MB.');
  const kind=file.name.toLowerCase().endsWith('.zip')?'application/zip':XLSX;
  const response=await send('preview','restore',file,{'Content-Type':kind,'X-CRM-File-Password':encodedPassword(password)});
  setReview(await response.json());setPassword('');
 }
 async function apply(){
  const response=await send('apply','restore',JSON.stringify({review:review.review}),{'Content-Type':'application/json'});
  const result=await response.json();
  setReview(null);setFile(null);
  setStatus(result.applied+' rows applied. Open the affected CRM list to view the changes.');
 }
 function start(label,action){setStatus('');run(label,action);}
 return <div className="cc877-restore-preview" aria-label="Editable CRM Working Copy">
  <span className="cc877-step">WORKING COPY</span><h3>Download Excel or CSV</h3>
  <p>Use the tabs to filter by recruiter, date and status. Upload the edited file to preview additions and changes before applying them.</p>
  <div className="cc878-credentials">
   <label>Download format<select value={format} onChange={e=>setFormat(e.target.value)} disabled={!!busy}><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV tables (.zip)</option></select></label>
   <label>File password<input type="password" autoComplete="new-password" maxLength={96} placeholder="At least 8 characters" value={password} onChange={e=>setPassword(e.target.value)} disabled={!!busy}/></label>
   <label>Records<select value={dateRange?'range':'all'} onChange={e=>setDateRange(e.target.value==='range')} disabled={!!busy}><option value="all">All dates</option><option value="range">Date range</option></select></label>
   {dateRange&&<><label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)} disabled={!!busy}/></label><label>To<input type="date" value={to} onChange={e=>setTo(e.target.value)} disabled={!!busy}/></label></>}
  </div>
  <p className="helper-text">The file password opens this download. Enter your Manager credentials and transfer passcode above to authorize downloads and imports.</p>
  <button className="add-profile-btn" type="button" disabled={!!busy||!unlocked||password.length<8} onClick={()=>start('working-download',download)}>{busy==='working-download'?'Preparing your file…':'Download '+(format==='csv'?'CSV ZIP':'Excel')}</button>
  <label className="cc877-file-label">Upload a Working Copy<input type="file" accept=".xlsx,.zip" disabled={!!busy} onChange={e=>{setFile(e.target.files?.[0]||null);setReview(null);setStatus('');}}/></label>
  {file&&<p className="helper-text">{file.name}</p>}
  <button className="ghost-btn" type="button" disabled={!!busy||!unlocked||!file||password.length<8} onClick={()=>{setReview(null);start('working-preview',inspect);}}>{busy==='working-preview'?'Checking your file…':'Preview changes'}</button>
  {review&&<div>
   <h4>{review.conflict_count?'Resolve '+review.conflict_count+' issues before applying':review.changes+' changes ready for review'}</h4>
   <div className="cc877-map-table"><table><thead><tr><th>Sheet</th><th>New</th><th>Updated</th><th>Unchanged</th><th>Reference</th></tr></thead><tbody>{Object.entries(review.counts).map(([name,x])=><tr key={name}><td>{name}</td><td>{x.new}</td><td>{x.updated}</td><td>{x.unchanged}</td><td>{x.reference}</td></tr>)}</tbody></table></div>
   {review.conflicts.length>0&&<ul>{review.conflicts.map((x,i)=><li key={i}>{x.sheet} · Row {x.row} · {x.record||'New row'} · {x.message}</li>)}</ul>}
   {review.review&&<button className="add-profile-btn" type="button" disabled={!!busy||!unlocked} onClick={()=>start('working-apply',apply)}>{busy==='working-apply'?'Applying changes…':'Apply reviewed changes'}</button>}
  </div>}
  {status&&<p role="status">{status}</p>}
  <p className="helper-text">Breaks, attendance, calls, follow-up summaries and pipeline update summaries are reference tabs. Edit follow-ups on All Profiles and feedback on Pipeline. Keep the headers and existing IDs. For a new profile with linked rows, use an ID such as NEW-1 on the profile and in the linked rows. Use desktop Excel to save edits with the password. Keep the CSV metadata file if you repackage the archive.</p>
 </div>;
}
