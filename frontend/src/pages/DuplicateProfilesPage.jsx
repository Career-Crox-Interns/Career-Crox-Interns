import {useSliceSearch,useSliceState} from '../lib/workspaceHelpers';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { useDashboardAuth as useAuth } from '../lib/auth';
import { readPageCache, writePageCache } from '../lib/persistentPageCache';
import { updateRowSelection, requestProfileDelete } from '../lib/workspaceHelpers';
import { emitCandidateUpsert } from '../lib/realtimeProfileBridge';

function lower(value) {
  return String(value ?? '').trim().toLowerCase();
}

function reviewInstant(value){
 let raw=String(value??'').trim();if(!raw)return null;
 if(/^\d{4}-\d{2}-\d{2}$/.test(raw))raw+='T00:00:00+05:30';
 else if(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(raw)&&!/(Z|[+-]\d{2}:?\d{2})$/i.test(raw))raw=raw.replace(' ','T')+'+05:30';
 const date=new Date(raw);return Number.isNaN(date.getTime())?null:date;
}
function reviewDay(value){const date=reviewInstant(value);return date?new Date(date.getTime()+330*60000).toISOString().slice(0,10):'';}
function formatStamp(value){const date=reviewInstant(value);return date?new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'}).format(date):'—';}

function scoreTone(score) {
  if (Number(score || 0) >= 30) return 'success';
  if (Number(score || 0) >= 18) return 'active';
  return 'warning';
}

function yes(value) {
  const v = lower(value);
  return v === '1' || v === 'yes' || v === 'true' || v === 'completed' || v === 'complete' || v === 'done';
}

function ExistingUploadPreviewDetails({ row = {} }) {
  const serialNo = row.source_sr_no || row.candidate_id || '-';
  const details = [
    ['Serial No', serialNo],
    ['Candidate ID', row.candidate_id],
    ['Name', row.existing_name],
    ['Number', row.phone],
    ['Qualification', row.qualification || row.qualification_level],
    ['Location', row.location],
    ['Preferred Location', row.preferred_location],
    ['Total Exp', row.total_experience],
    ['Relevant Exp', row.relevant_experience],
    ['CTC', row.ctc_monthly],
    ['In-hand', row.in_hand_salary],
    ['Process', row.process],
    ['Communication', row.communication_skill],
    ['Recruiter', row.recruiter_name || 'Team member'],
    ['Status', row.status],
    ['Approval', row.approval_status],
    ['Details Sent', row.all_details_sent],
  ].filter(([, value]) => String(value ?? '').trim());
  return (
    <div className="upload-existing-detail-line">
      {details.length ? details.map(([label, value]) => (
        <span key={`${label}-${value}`} className="upload-existing-detail-item"><strong>{label}:</strong> {value}</span>
      )) : <span className="upload-existing-detail-item">Existing profile has no filled detail.</span>}
    </div>
  );
}

const PENDING_DUPLICATE_PREVIEW_KEY = 'careerCroxPendingDuplicateUploadPreview_v519';
function readPendingUploadPreview() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_DUPLICATE_PREVIEW_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    if (Number(parsed.expires_at || 0) && Date.now() > Number(parsed.expires_at || 0)) {
      localStorage.removeItem(PENDING_DUPLICATE_PREVIEW_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export default function DuplicateProfilesPage(){
 const {user}=useAuth(),[params,setParams]=useSearchParams();
 const viewingDeleted=params.get('view')==='deleted',mode=viewingDeleted?'deleted':'duplicates';
 const fromUpload=params.get('from_upload')==='1';
 const [uploadPreview,setUploadPreview]=useState(()=>params.get('upload_preview')==='1'?readPendingUploadPreview():null);
 const [rows,setRows]=useState([]),[summary,setSummary]=useState({}),[loading,setLoading]=useState(true),[message,setMessage]=useState('');
 const [selectedIds,setSelectedIds]=useState([]),[search,setSearch]=useSliceState('review:search',params.get('focus')||'',!!params.get('focus')),[filter,setFilter]=useSliceState('review:filter','all');
 useSliceSearch(search,setSearch);
 const [busy,setBusy]=useState(false),[preview,setPreview]=useState(null),[refreshedAt,setRefreshedAt]=useState('');
 const sequence=useRef(0),modeRef=useRef(mode),actionRef=useRef(false),anchor=useRef(null);modeRef.current=mode;
 const canDelete=['admin','manager'].includes(lower(user?.role))||lower(user?.designation)==='manager';
 const cachePrefix='cc865-profile-review:'+String(user?.user_id||user?.username||'anon')+':'+String(user?.role||'');
 async function load({force=false,keepMessage=false}={}){
  const wanted=mode,request=++sequence.current;setLoading(true);
  try{
   const url='/api/candidates/'+(wanted==='deleted'?'deleted-profiles':'duplicate-groups')+(force?'?refresh='+Date.now():'');
   const data=await api.get(url,{cacheTtlMs:force?0:15000,allowStale:false,retries:0,timeoutMs:20000});
   if(request!==sequence.current||modeRef.current!==wanted)return;
   const items=Array.isArray(data.items)?data.items:[];setRows(items);setSummary(data.summary||{});writePageCache(cachePrefix+':'+wanted,items);
   setSelectedIds(current=>current.filter(id=>items.some(row=>String(row.candidate_id)===id)));setRefreshedAt(new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'}));
   if(!keepMessage)setMessage('');
  }catch(error){if(request===sequence.current&&modeRef.current===wanted)setMessage(error.message||'Profiles could not load. Press Refresh to retry.');}
  finally{if(request===sequence.current&&modeRef.current===wanted)setLoading(false);}
 }
 useEffect(()=>{setRows(readPageCache(cachePrefix+':'+mode,[]));setSummary({});setSelectedIds([]);setFilter('all');void load({force:true});return()=>{sequence.current++;};},[mode,cachePrefix]);
 useEffect(()=>{const changed=e=>{if(!actionRef.current&&/candidate/.test(e.detail?.path||''))void load({force:true,keepMessage:true});};window.addEventListener('career-crox-data-written',changed);return()=>window.removeEventListener('career-crox-data-written',changed);},[mode,cachePrefix]);
 useEffect(()=>setUploadPreview(params.get('upload_preview')==='1'?readPendingUploadPreview():null),[params]);
 const selected=new Set(selectedIds),isMain=row=>String(row.duplicate_is_main||row.duplicate_recommended_keep||'0')==='1';
 const today=new Date(Date.now()+330*60000).toISOString().slice(0,10);
 const visibleRows=useMemo(()=>rows.filter(row=>{
  if(filter==='main'&&!isMain(row))return false;if(filter==='extras'&&isMain(row))return false;
  if(filter==='selected'&&!selectedIds.includes(String(row.candidate_id)))return false;
  if(filter==='today'&&reviewDay(row.deleted_at)!==today)return false;
  if(filter==='reason'&&!row.delete_reason)return false;
  return [row.full_name,row.phone,row.candidate_id,row.recruiter_name,row.recruiter_code,row.location,row.delete_reason].join(' ').toLowerCase().includes(search.trim().toLowerCase());
 }),[rows,filter,search,selectedIds,today]);
 const ids=visibleRows.map(row=>String(row.candidate_id)),allSelected=ids.length>0&&ids.every(id=>selected.has(id));
 const groups=new Set(rows.map(row=>row.duplicate_group_key).filter(Boolean)).size;
 const mainRows=rows.filter(isMain).length,autoIds=rows.filter(row=>String(row.auto_select_unfilled_duplicate||'0')==='1').map(row=>String(row.candidate_id));
 const cards=viewingDeleted?[
  ['all','Deleted profiles',rows.length,'All recoverable records'],['today','Deleted today',rows.filter(row=>reviewDay(row.deleted_at)===today).length,'Today’s archived profiles'],['reason','With a reason',rows.filter(row=>row.delete_reason).length,'Deletion note available'],['selected','Selected',selectedIds.length,'Ready to restore'],
 ]:[['all','Duplicate sets',Number(summary.totalGroups??groups),'Review matching profiles'],['main','Main profiles',mainRows,'Recommended profiles to keep'],['extras','Extra profiles',rows.length-mainRows,'Review before deleting'],['selected','Selected',selectedIds.length,'Chosen for manual action']];
 function switchView(next){if(busy)return;sequence.current++;modeRef.current=next;setSearch('');setFilter('all');setSelectedIds([]);setPreview(null);setMessage('');setParams(current=>{const nextParams=new URLSearchParams(current);nextParams.set('view',next);nextParams.delete('focus');return nextParams;});}
 function toggle(id,event){setSelectedIds(current=>updateRowSelection(current,ids,id,{checked:event.target.checked,shiftKey:event.nativeEvent?.shiftKey,anchorId:anchor.current}));anchor.current=id;}
 async function removeProfiles(wanted){
  if(!canDelete||busy||!wanted.length)return;
  const reason=await requestProfileDelete({candidateIds:wanted,name:wanted.length===1?rows.find(row=>String(row.candidate_id)===wanted[0])?.full_name:''});
  if(reason===null)return;
  actionRef.current=true;setBusy(true);setMessage('');
  try{
   const result=await api.post(wanted.length===1?'/api/candidates/'+encodeURIComponent(wanted[0])+'/delete':'/api/candidates/bulk-delete',wanted.length===1?{reason}:{candidate_ids:wanted,reason},{timeoutMs:45000,retries:0});
   const completed=new Set([...(result.soft_hidden_ids||[]),...(result.deleted_ids||[])].map(String).filter(id=>wanted.includes(id)));
   if(!completed.size)throw Error(result.failed?.[0]?.reason||'No profile was moved. Your selection is kept.');
   setRows(current=>current.filter(row=>!completed.has(String(row.candidate_id))));setSelectedIds(current=>current.filter(id=>!completed.has(id)));setPreview(null);
   setMessage(completed.size+' moved to Deleted Profiles with your reason.'+(wanted.length>completed.size?' Some profiles could not be moved.':''));
   await load({force:true,keepMessage:true});
  }catch(error){setMessage(error.message||'Delete failed. Profiles were not marked successful.');}
  finally{actionRef.current=false;setBusy(false);}
 }
 async function restoreProfiles(wanted){
  if(!canDelete||busy||!wanted.length)return;
  if(!window.confirm('Restore '+wanted.length+' profile(s) to CRM with their saved details?'))return;
  actionRef.current=true;setBusy(true);let done=0;const failed=[];
  try{
   for(const id of wanted){try{const result=await api.post('/api/candidates/'+encodeURIComponent(id)+'/restore',{},{timeoutMs:45000,retries:0});if(!result.ok||String(result.item?.candidate_id)!==id)throw Error('Restore not confirmed');emitCandidateUpsert(result.item);done++;setRows(current=>current.filter(row=>String(row.candidate_id)!==id));}catch{failed.push(id);}}
   setSelectedIds(failed);setPreview(null);setMessage(done+' restored to Candidates.'+(failed.length?' '+failed.length+' could not restore and remain selected.':''));await load({force:true,keepMessage:true});
  }finally{actionRef.current=false;setBusy(false);}
 }
 async function makeMain(id){if(busy)return;actionRef.current=true;setBusy(true);try{await api.post('/api/candidates/'+encodeURIComponent(id)+'/make-main-duplicate',{},{retries:0});setMessage(id+' is now the main profile.');await load({force:true,keepMessage:true});}catch(error){setMessage(error.message);}finally{actionRef.current=false;setBusy(false);}}
 const display=value=>value===null||value===undefined||String(value).trim()===''?'—':String(value);
 return <Layout title={viewingDeleted?'Deleted Profiles':'Duplicate Profiles'}><div id="cc865-profile-review">
  <header className="cc865-review-head"><div><span className="cc865-review-eyebrow">PROFILE CENTRE</span><h1>{viewingDeleted?'Deleted Profiles':'Duplicate Profiles'}</h1><p>{viewingDeleted?'Review deleted profiles, their reasons and restore them to CRM.':'Compare matching profiles and choose which records to keep.'}</p></div><button type="button" className="cc865-review-refresh" disabled={busy||loading} onClick={()=>load({force:true})}><ReviewIcon kind="refresh"/>{loading?'Refreshing…':'Refresh'}</button></header>
  <nav className="cc865-review-tabs" aria-label="Profile lists"><button type="button" aria-pressed={!viewingDeleted} disabled={busy} onClick={()=>switchView('duplicates')}>Duplicate profiles</button>{canDelete&&<button type="button" aria-pressed={viewingDeleted} disabled={busy} onClick={()=>switchView('deleted')}>Deleted profiles / Recycle bin</button>}<span>{refreshedAt?'Updated '+refreshedAt:''}</span></nav>
  <section className="cc865-review-cards" aria-label="Filter profiles">{cards.map(([key,label,value,note],index)=><button type="button" key={key} className={'cc865-review-card tone-'+index} aria-pressed={filter===key} disabled={busy} onClick={()=>{setFilter(key);setSearch('');}}><span>{label}</span><strong>{value}</strong><small>{note}</small></button>)}</section>
  {message&&<div className="cc865-review-notice" role="status">{message}{!viewingDeleted&&canDelete&&<button type="button" onClick={()=>switchView('deleted')}>View deleted profiles ↗</button>}</div>}
      {uploadPreview?.analysis ? (
        <div className="table-panel top-gap-small glassy-card fade-up upload-preview-panel">
          <div className="upload-preview-head">
            <div>
              <div className="upload-preview-title">Pending Upload Duplicate Preview</div>
              <div className="upload-preview-note">{uploadPreview.file_name || 'Candidate upload'} • preview only — nothing is deleted or overwritten here.</div>
            </div>
            <span className="duplicate-chip">{uploadPreview.analysis?.review_rows?.length || 0} filled matches</span>
          </div>
          {uploadPreview.analysis?.duplicate_groups?.length ? (
            <div className="top-gap-small" style={{ display: 'grid', gap: 14 }}>
              {uploadPreview.analysis.duplicate_groups.map((group, groupIndex) => (
                <div key={`preview-group-${group.group_key || groupIndex}`} style={{ border: '1px solid rgba(245,158,11,.28)', borderRadius: 16, overflow: 'hidden', background: '#fff' }}>
                  <div style={{ padding: '10px 12px', background: 'linear-gradient(135deg,#fff7ed,#eff6ff)', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <strong>Duplicate Set {groupIndex + 1} • Same phone: {group.phone || group.group_key}</strong>
                    <span className="duplicate-chip">{group.uploaded_count || 0} upload row(s) • {group.existing_count || 0} old CRM row(s)</span>
                  </div>
                  <div className="upload-pair-list">
                    {(group.uploaded_rows || []).map((uploaded, uploadIndex) => (
                      <div className="upload-pair-set" key={`pair-${group.group_key}-${uploaded.row_number}-${uploadIndex}`}>
                        <div className="upload-pair-row pending">
                          <div className="upload-pair-kind">New Upload • Row {uploaded.row_number}</div>
                          <div className="upload-pair-detail upload-blank-row">—</div>
                        </div>
                        {(group.existing_profiles || []).length ? (group.existing_profiles || []).map((existing, existingIndex) => (
                          <div className="upload-pair-row existing" key={`existing-${group.group_key}-${uploaded.row_number}-${existing.candidate_id || existingIndex}`}>
                            <div className="upload-pair-kind"><span className="upload-preview-safe">Old CRM Row</span></div>
                            <div className="upload-pair-detail"><ExistingUploadPreviewDetails row={existing} /></div>
                          </div>
                        )) : (
                          <div className="upload-pair-row existing">
                            <div className="upload-pair-kind"><span className="upload-preview-safe">Same Upload Match</span></div>
                            <div className="upload-pair-detail">No older CRM profile exists; this phone is repeated inside the current upload.</div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : uploadPreview.analysis?.review_rows?.length ? (
            <div className="upload-pair-list top-gap-small">
              {uploadPreview.analysis.review_rows.map((row) => (
                <div className="upload-pair-set" key={`pending-${row.row_number}-${row.existing_candidate_id}`}>
                  <div className="upload-pair-row pending">
                    <div className="upload-pair-kind">New Upload • Row {row.row_number}</div>
                    <div className="upload-pair-detail upload-blank-row">—</div>
                  </div>
                  <div className="upload-pair-row existing">
                    <div className="upload-pair-kind"><span className="upload-preview-safe">Old CRM Row</span></div>
                    <div className="upload-pair-detail">
                      <div className="upload-existing-detail-line">
                        <span className="upload-existing-detail-item"><strong>Candidate ID:</strong> {row.existing_candidate_id || '-'}</span>
                        <span className="upload-existing-detail-item"><strong>Name:</strong> {row.existing_name || '-'}</span>
                        <span className="upload-existing-detail-item"><strong>Number:</strong> {row.phone || '-'}</span>
                        <span className="upload-existing-detail-item"><strong>Filled:</strong> {Array.isArray(row.existing_filled_fields) && row.existing_filled_fields.length ? row.existing_filled_fields.join(', ') : '-'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="duplicate-empty">No duplicate phone sets in this upload.</div>}
        </div>
      ) : null}

  <section className="cc865-review-panel"><div className="cc865-review-tools"><label className="cc865-review-search"><ReviewIcon kind="search"/><input aria-label="Search profiles" placeholder="Search name, number, ID, owner or reason…" value={search} onChange={e=>setSearch(e.target.value)}/></label><span>{visibleRows.length} profiles · {selectedIds.length} selected</span></div>
   <div className="cc865-selection-bar"><button type="button" disabled={busy||!ids.length} onClick={()=>setSelectedIds(current=>allSelected?current.filter(id=>!ids.includes(id)):[...new Set([...current,...ids])])}>{allSelected?'Deselect visible':'Select all visible'}</button><button type="button" disabled={busy||!selectedIds.length} onClick={()=>setSelectedIds([])}>Clear selection</button>{!viewingDeleted&&<button type="button" disabled={busy||!autoIds.length} onClick={()=>setSelectedIds(autoIds)}>Select unfilled extras · {autoIds.length}</button>}{canDelete&&<button type="button" className={viewingDeleted?'cc865-restore-action':'cc865-delete-action'} disabled={busy||!selectedIds.length} onClick={()=>viewingDeleted?restoreProfiles(selectedIds):removeProfiles(selectedIds)}><ReviewIcon kind={viewingDeleted?'restore':'trash'}/>{busy?'Working…':viewingDeleted?'Restore selected':'Delete selected'}</button>}{filter!=='all'&&<button type="button" onClick={()=>setFilter('all')}>Show all</button>}</div>
   <div className="cc865-review-table-wrap" aria-busy={loading}><table className="cc865-review-table"><thead><tr><th><input type="checkbox" aria-label="Select all visible profiles" checked={allSelected} disabled={busy||!ids.length} onChange={e=>setSelectedIds(current=>e.target.checked?[...new Set([...current,...ids])]:current.filter(id=>!ids.includes(id)))}/></th><th>Candidate</th><th>Phone</th><th>Owner</th><th>{viewingDeleted?'Deleted / reason':'Duplicate match'}</th><th>In-hand</th><th>Review</th><th>Actions</th></tr></thead><tbody>
    {visibleRows.map(row=>{const id=String(row.candidate_id),main=isMain(row);return <tr key={id} className={selected.has(id)?'is-selected':''}><td><input type="checkbox" aria-label={'Select profile '+id} disabled={busy} checked={selected.has(id)} onChange={e=>toggle(id,e)}/></td><td><button type="button" className="cc865-profile-name" onClick={()=>setPreview(row)}>{row.full_name||id}</button><small>{id} · {display(row.location)}</small></td><td>{display(row.phone)}</td><td>{display(row.recruiter_name)}<small>{display(row.recruiter_code)}</small></td><td>{viewingDeleted?<><span>{formatStamp(row.deleted_at)}</span><small>By {row.deleted_by||'Not recorded'}</small><span className="cc865-delete-reason">{row.delete_reason||'No reason recorded on this older deletion.'}</span></>:<><span>{display(row.duplicate_group_phone||row.phone)}</span><small>{row.duplicate_group_size||2} profiles · Score {row.detail_score??0}</small></>}</td><td>{row.in_hand_salary!==null&&row.in_hand_salary!==undefined&&String(row.in_hand_salary).trim()!==''?'₹'+Number(row.in_hand_salary).toLocaleString('en-IN'):'—'}</td><td><span className={'cc865-review-pill '+(main?'main':'extra')}>{viewingDeleted?'Can restore':main?'Main profile':'Extra profile'}</span>{!viewingDeleted&&canDelete&&!main&&<button type="button" className="cc865-text-button" disabled={busy} onClick={()=>makeMain(id)}>Make main</button>}</td><td><div className="cc865-row-actions"><button type="button" aria-label={'Review '+id} onClick={()=>setPreview(row)}>Details</button>{!viewingDeleted&&<Link to={'/candidate/'+encodeURIComponent(id)}>Open ↗</Link>}{canDelete&&<button type="button" disabled={busy} className={viewingDeleted?'cc865-restore-action':'cc865-delete-action'} onClick={()=>viewingDeleted?restoreProfiles([id]):removeProfiles([id])}>{viewingDeleted?'Restore':'Delete'}</button>}</div></td></tr>;})}
    {!visibleRows.length&&<tr><td colSpan={8} className="cc865-review-empty">{loading?'Loading profiles…':search||filter!=='all'?'No profiles match this filter. Clear it or choose Show all.':viewingDeleted?'The recycle bin has no deleted profiles.':'No duplicate sets found.'}</td></tr>}
   </tbody></table></div>
  </section>
  {preview&&<section className="cc865-review-details" role="dialog" aria-modal="true" aria-label="Profile details"><div className="cc865-preview-card"><header><div><small>{preview.candidate_id}</small><h2>{preview.full_name||'Profile details'}</h2></div><button type="button" aria-label="Close profile details" onClick={()=>setPreview(null)}>×</button></header><div className="cc865-preview-grid">{[['Phone',preview.phone],['Email',preview.email],['Owner',preview.recruiter_name],['Location',preview.location],['Preferred location',preview.preferred_location],['Qualification',preview.qualification||preview.qualification_level],['Process',preview.process],['Status',preview.status],['In-hand salary',preview.in_hand_salary],['CTC monthly',preview.ctc_monthly],['Total experience',preview.total_experience],['Relevant experience',preview.relevant_experience],['Notes',preview.notes],['Data notes',String(preview.data_notes||'').replace(/\[CRM-DELETE-META:[A-Za-z0-9+/=]+\]/g,'')],...(viewingDeleted?[['Deleted by',preview.deleted_by],['Deleted at',formatStamp(preview.deleted_at)],['Delete reason',preview.delete_reason||'Not recorded on this older deletion']]:[])].map(([label,value])=><div key={label}><span>{label}</span><strong>{display(value)}</strong></div>)}</div><footer>{viewingDeleted&&canDelete?<button type="button" className="cc865-restore-action" disabled={busy} onClick={()=>restoreProfiles([String(preview.candidate_id)])}>Restore profile</button>:<Link to={'/candidate/'+encodeURIComponent(preview.candidate_id)}>Open candidate profile ↗</Link>}<button type="button" onClick={()=>setPreview(null)}>Close</button></footer></div></section>}
 </div></Layout>;
}

function ReviewIcon({kind}){const paths={refresh:'M20 7v5h-5 M4 17v-5h5 M6 7a7 7 0 0 1 12-2l2 2 M4 17l2 2a7 7 0 0 0 12-2',trash:'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',restore:'M3 10h5V5 M4 10a9 9 0 1 1 0 7 M12 7v5l3 2',search:'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'};return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]||paths.search}/></svg>;}
