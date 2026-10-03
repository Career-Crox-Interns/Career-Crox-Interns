import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';

const blankEdit = { full_name:'', username:'', recruiter_code:'', password:'', is_active:true };

function normalizeHeader(value){ return String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,''); }
function splitSmartLine(line,delimiter){ const out=[]; let current='',quoted=false; for(let i=0;i<line.length;i+=1){ const ch=line[i]; if(ch==='"'){ if(quoted&&line[i+1]==='"'){current+='"';i+=1;} else quoted=!quoted; continue; } if(ch===delimiter&&!quoted){out.push(current);current='';continue;} current+=ch; } out.push(current); return out.map(x=>x.trim()); }
function rowsToObjects(matrix=[]){ if(matrix.length<2)return[]; const headers=matrix[0].map(normalizeHeader); return matrix.slice(1).map(values=>{const row={};headers.forEach((h,i)=>{if(h)row[h]=String(values[i]||'').trim();});row.candidate_id='';return row;}).filter(row=>Object.values(row).some(v=>String(v||'').trim())); }
function parseGridText(text){ const lines=String(text||'').trim().split(/\r?\n/).filter(x=>x.trim()); if(lines.length<2)return[]; const d=lines[0].includes('\t')?'\t':','; return rowsToObjects(lines.map(line=>splitSmartLine(line,d))); }
function u16(v,o){return v.getUint16(o,true);} function u32(v,o){return v.getUint32(o,true);}
function cellRefToIndex(ref){const clean=String(ref||'').replace(/\d+/g,'').toUpperCase();let value=0;for(const ch of clean)value=value*26+(ch.charCodeAt(0)-64);return Math.max(0,value-1);}
async function inflateZipEntry(method,bytes){ if(method===0)return bytes; if(method!==8)throw new Error('Unsupported Excel compression.'); if(typeof DecompressionStream==='undefined')throw new Error('Browser cannot read XLSX here. Save it as CSV and retry.'); const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')); return new Uint8Array(await new Response(stream).arrayBuffer()); }
async function unzipEntries(arrayBuffer){const view=new DataView(arrayBuffer);let eocd=-1;for(let i=view.byteLength-22;i>=Math.max(0,view.byteLength-66000);i-=1){if(u32(view,i)===0x06054b50){eocd=i;break;}}if(eocd<0)throw new Error('Invalid XLSX file.');const cdSize=u32(view,eocd+12),cdOffset=u32(view,eocd+16),end=cdOffset+cdSize,entries=new Map();let ptr=cdOffset;while(ptr<end&&u32(view,ptr)===0x02014b50){const method=u16(view,ptr+10),size=u32(view,ptr+20),nl=u16(view,ptr+28),xl=u16(view,ptr+30),cl=u16(view,ptr+32),local=u32(view,ptr+42),name=new TextDecoder().decode(new Uint8Array(arrayBuffer,ptr+46,nl)),ln=u16(view,local+26),le=u16(view,local+28),start=local+30+ln+le;entries.set(name,{method,raw:new Uint8Array(arrayBuffer,start,size)});ptr+=46+nl+xl+cl;}return entries;}
async function readZipText(entries,name){const e=entries.get(name);if(!e)return'';return new TextDecoder().decode(await inflateZipEntry(e.method,e.raw));}
function xmlDoc(t){return new DOMParser().parseFromString(t,'application/xml');} function xmlText(n){return Array.from(n?.childNodes||[]).map(c=>c.textContent||'').join('');} function xmlElements(root,name){try{const a=Array.from(root?.getElementsByTagNameNS?.('*',name)||[]);if(a.length)return a;}catch{}return Array.from(root?.getElementsByTagName?.(name)||[]);}
async function parseXlsxRows(file){const buf=await file.arrayBuffer(),entries=await unzipEntries(buf),wb=xmlDoc(await readZipText(entries,'xl/workbook.xml')),rels=xmlDoc(await readZipText(entries,'xl/_rels/workbook.xml.rels')),sheets=xmlElements(wb,'sheet'),sheet=sheets.find(x=>/candidate\s*data/i.test(x.getAttribute('name')||''))||sheets[0];if(!sheet)return[];const rid=sheet.getAttribute('r:id')||sheet.getAttribute('id'),rel=xmlElements(rels,'Relationship').find(x=>x.getAttribute('Id')===rid),target=rel?.getAttribute('Target');if(!target)throw new Error('Worksheet not found.');const path=target.startsWith('/')?target.slice(1):`xl/${target.replace(/^\.\//,'')}`,ss=await readZipText(entries,'xl/sharedStrings.xml'),shared=ss?xmlElements(xmlDoc(ss),'si').map(si=>xmlText(si).trim()):[],doc=xmlDoc(await readZipText(entries,path)),matrix=xmlElements(doc,'row').map(r=>{const cells=[];xmlElements(r,'c').forEach(c=>{const idx=cellRefToIndex(c.getAttribute('r')||''),type=c.getAttribute('t')||'',v=xmlElements(c,'v')[0],inline=xmlElements(c,'is')[0];let value='';if(type==='s')value=shared[Number(v?.textContent||0)]||'';else if(type==='inlineStr')value=xmlText(inline).trim();else value=v?.textContent||xmlText(inline).trim();cells[idx]=String(value||'').trim();});return cells;}).filter(row=>row.some(Boolean));return rowsToObjects(matrix);}
async function parseExcelFile(file){const name=String(file?.name||'').toLowerCase();if(name.endsWith('.xlsx'))return parseXlsxRows(file);const text=await file.text();if(/<table[\s>]/i.test(text)){const doc=new DOMParser().parseFromString(text,'text/html'),table=doc.querySelector('table');if(table)return rowsToObjects(Array.from(table.querySelectorAll('tr')).map(row=>Array.from(row.querySelectorAll('th,td')).map(cell=>String(cell.textContent||'').trim())));}return parseGridText(text);}

export default function BasicAdminPage(){
  const [interns,setInterns]=useState([]);
  const [lastPassword,setLastPassword]=useState(null);
  const [health,setHealth]=useState(null);
  const [editId,setEditId]=useState('');
  const [form,setForm]=useState(blankEdit);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [excelRows,setExcelRows]=useState([]);
  const [excelName,setExcelName]=useState('');
  const [excelAssignee,setExcelAssignee]=useState('');
  const [excelSummary,setExcelSummary]=useState(null);
  const [excelBusy,setExcelBusy]=useState(false);

  async function load(){
    setBusy(true); setMessage('');
    try{
      const [users,system]=await Promise.all([
        api.get('/api/basic/admin/users',{cacheTtlMs:0,timeoutMs:15000}),
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
      const out=await api.put(`/api/basic/admin/users/${encodeURIComponent(editId)}`,form,{timeoutMs:15000});
      if(out?.temporary_password){ setLastPassword({full_name:out?.item?.full_name||form.full_name,username:out?.item?.username||form.username,password:out.temporary_password}); }
      setMessage(out?.temporary_password?'Login profile updated. New password is shown below.':'Login profile updated.'); setEditId(''); setForm(blankEdit); await load();
    }catch(e){ setMessage(e.message||'Update failed.'); }
    finally{ setBusy(false); }
  }
  async function repair(){
    setBusy(true); setMessage('Checking and repairing required Supabase structure…');
    try{ const out=await api.post('/api/basic/admin/repair',{}, {timeoutMs:45000}); setHealth((h)=>({...h,schema:out.schema,ok:out.ok})); setMessage(out.ok?'Database structure is complete.':'Repair finished with remaining issues.'); await load(); }
    catch(e){ setMessage(e.message||'Database repair failed.'); }
    finally{ setBusy(false); }
  }

  async function analyzeExcel(rows=excelRows){
    if(!rows.length){setMessage('Choose a valid Excel/CSV file first.');return null;}
    setExcelBusy(true);
    try{const out=await api.post('/api/admin/analyze-candidate-upload',{rows,assignee_user_id:excelAssignee,file_name:excelName},{cacheTtlMs:0,timeoutMs:20000});setExcelSummary(out?.summary||{});setMessage('Excel analysis complete. Existing phone profiles will be skipped unchanged.');return out;}catch(e){setMessage(e.message||'Excel analysis failed.');return null;}finally{setExcelBusy(false);}
  }
  async function chooseExcel(event){const file=event.target.files?.[0];if(!file)return;setExcelName(file.name||'');setExcelSummary(null);setExcelBusy(true);try{const rows=await parseExcelFile(file);if(!rows.length)throw new Error('No usable rows found. Keep headers in first row.');setExcelRows(rows);setMessage(`${rows.length} rows loaded. Checking duplicates…`);await analyzeExcel(rows);}catch(e){setExcelRows([]);setMessage(e.message||'Excel read failed.');}finally{setExcelBusy(false);}}
  async function importExcel(){if(!excelRows.length)return;setExcelBusy(true);try{const out=await api.post('/api/admin/import-candidates',{rows:excelRows.map(row=>({...row,candidate_id:''})),assignee_user_id:excelAssignee,file_name:excelName,basic_safe_new_only:true,duplicate_review_confirmed:true},{cacheTtlMs:0,timeoutMs:120000});setExcelSummary(out?.summary||{});setMessage(`Excel import complete. Added ${out?.summary?.inserted||0}; existing skipped ${out?.summary?.skipped||0}.`);await load();}catch(e){setMessage(e.message||'Excel import failed.');}finally{setExcelBusy(false);}}

  const missing=(health?.schema?.missing_tables?.length||0)+(health?.schema?.missing_columns?.length||0);
  return <Layout title="Admin Control" subtitle="Intern Basic CRM">
    <div className="basic-admin-grid">
      <section className="panel glassy-card">
        <div className="panel-title">System Status</div>
        <div className="basic-admin-metrics">
          <div><span>Login Profiles</span><strong>{interns.length || '-'}</strong></div>
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
        <div className="panel-title">Excel Candidate Upload</div>
        <div className="helper-text">XLSX/XLS/CSV. Safe mode adds only new phone numbers; existing profiles stay unchanged.</div>
        <div className="form-grid top-gap-small">
          <label className="field"><span>Excel / CSV</span><input type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel" onChange={chooseExcel}/></label>
          <label className="field"><span>Assign new profiles to</span><select value={excelAssignee} onChange={e=>setExcelAssignee(e.target.value)}><option value="">Use sheet / uploader</option>{interns.map(row=><option key={row.user_id} value={row.user_id}>{row.full_name} • {row.recruiter_code}</option>)}</select></label>
        </div>
        <div className="row-actions top-gap-small"><button type="button" className="ghost-btn" disabled={excelBusy||!excelRows.length} onClick={()=>analyzeExcel()}>{excelBusy?'Working…':'Analyze'}</button><button type="button" className="add-profile-btn" disabled={excelBusy||!excelRows.length} onClick={importExcel}>Import New Profiles</button></div>
        {excelRows.length?<div className="helper-text top-gap-small">Rows: {excelRows.length} • New: {excelSummary?.new_profiles ?? excelSummary?.inserted ?? '-'} • Existing/Skipped: {excelSummary?.skipped ?? Number(excelSummary?.blank_existing_matches||0)+Number(excelSummary?.filled_existing_matches||0)+Number(excelSummary?.exact_existing_matches||0)}</div>:null}
      </section>

      <section className="panel glassy-card">
        <div className="panel-title">CRM Login Profiles</div>
        <div className="helper-text">Manager/TL/Recruiter login profiles. Password is stored securely as a hash; after reset the new password is shown here once for copy.</div>
        {lastPassword?<div className="basic-health ok top-gap-small"><strong>New Password:</strong> {lastPassword.full_name} ({lastPassword.username}) → <code>{lastPassword.password}</code> <button type="button" className="mini-btn view" onClick={()=>navigator.clipboard?.writeText(lastPassword.password)}>Copy</button></div>:null}
        <div className="table-wrap top-gap-small"><table><thead><tr><th>Profile</th><th>Name</th><th>Username</th><th>Code</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>
          {interns.map(row=><tr key={row.user_id}><td>{row.user_id}</td><td>{row.full_name}</td><td>{row.username}</td><td>{row.recruiter_code}</td><td>{row.role||row.designation||'-'}</td><td>{String(row.is_active).toLowerCase()==='false'?'Inactive':'Active'}</td><td><button type="button" className="mini-btn view" onClick={()=>startEdit(row)}>Edit</button></td></tr>)}
        </tbody></table></div>
      </section>
    </div>

    {editId ? <div className="crm-modal-backdrop" onClick={()=>setEditId('')}><div className="crm-premium-modal" onClick={e=>e.stopPropagation()}>
      <div className="panel-title">Edit Login Profile · {editId}</div>
      <div className="form-grid top-gap-small">
        <label className="field"><span>Name</span><input value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})}/></label>
        <label className="field"><span>Username</span><input value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/></label>
        <label className="field"><span>Recruiter Code</span><input value={form.recruiter_code} onChange={e=>setForm({...form,recruiter_code:e.target.value})}/></label>
        <label className="field"><span>New Password (optional)</span><input type="text" autoComplete="off" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Leave blank to keep current"/></label>
        <label className="field"><span>Status</span><select value={form.is_active?'active':'inactive'} onChange={e=>setForm({...form,is_active:e.target.value==='active'})}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      </div>
      <div className="row-actions top-gap"><button type="button" className="add-profile-btn" disabled={busy} onClick={save}>Save Profile</button><button type="button" className="ghost-btn" onClick={()=>setEditId('')}>Cancel</button></div>
    </div></div>:null}
    {message?<div className="panel top-gap-small helper-text">{message}</div>:null}
  </Layout>;
}
