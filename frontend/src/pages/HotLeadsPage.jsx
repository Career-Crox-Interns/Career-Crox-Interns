import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { openCandidateProfileInNewTab } from '../lib/candidateNav';
import { dialCandidateWithLog, openWhatsAppWithLog } from '../lib/candidateAccess';

function WhatsAppIcon(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 11.5A8.5 8.5 0 0 1 7.45 18.95L4 20l1.1-3.23A8.5 8.5 0 1 1 20 11.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M9.3 8.9c.19-.42.39-.43.57-.44.15 0 .33-.02.5-.02.16 0 .42.06.64.53.22.48.74 1.62.8 1.74.06.12.1.26.02.42-.08.17-.12.27-.24.41-.12.14-.25.31-.36.42-.12.12-.24.24-.1.46.14.22.62 1.02 1.33 1.64.92.8 1.69 1.05 1.94 1.17.24.12.38.1.52-.06.14-.17.58-.67.73-.9.15-.23.31-.19.52-.12.22.08 1.36.65 1.59.76.24.12.39.18.45.28.06.1.06.62-.15 1.21-.2.6-1.19 1.15-1.65 1.22-.43.07-.98.1-1.58-.1-.36-.12-.82-.27-1.42-.53-2.49-1.08-4.11-3.72-4.23-3.9-.12-.17-1.01-1.35-1.01-2.57 0-1.21.63-1.8.85-2.05Z" fill="currentColor" stroke="none"/></svg>}
function FilterIcon(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}
function PhoneIcon(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7.4 3.8h2.1c.5 0 .9.3 1.1.8l1.1 3.1c.2.5 0 1.1-.4 1.4L9.8 10.4a13.2 13.2 0 0 0 3.8 3.8l1.3-1.5c.3-.4.9-.6 1.4-.4l3.1 1.1c.5.2.8.6.8 1.1v2.1c0 .7-.6 1.3-1.3 1.3A15.9 15.9 0 0 1 6.1 5.1c0-.7.6-1.3 1.3-1.3Z" fill="currentColor" /></svg>}
function DialerIcon(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 4h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="9" cy="8" r="1"/><circle cx="12" cy="8" r="1"/><circle cx="15" cy="8" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="16" r="1"/><circle cx="12" cy="16" r="1"/><circle cx="15" cy="16" r="1"/></svg>}
function SelectAllIcon(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M8.3 12.2 10.9 15l4.9-5.3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
function CheckIcon(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5.2 12.7 9.4 17l9.4-9.4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
function CloseIcon(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>}
function PrevIcon(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m14.5 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
function NextIcon(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
function normalizeId(value){return String(value||'').trim()}
function openTelLink(clean){if(!clean)return;const link=document.createElement('a');link.href=`tel:${clean}`;link.style.display='none';document.body.appendChild(link);link.click();document.body.removeChild(link)}

function phoneDigits(row){return String(row?.phone ?? '').replace(/\D+/g,'').trim()}
function lower(value){return String(value||'').trim().toLowerCase()}
function roleOf(user){const raw=lower(`${user?.role||''} ${user?.designation||''}`);if(raw.includes('admin'))return'admin';if(raw.includes('manager'))return'manager';if(raw==='tl'||raw.includes('team lead')||raw.includes('teamlead'))return'tl';return'recruiter'}
function rowLimitForRole(role){if(role==='admin'||role==='manager')return 5000;if(role==='tl')return 50;return 10}
function rowOptionsForRole(role){if(role==='admin'||role==='manager')return [[10,'10 rows'],[25,'25 rows'],[50,'50 rows'],[100,'100 rows'],[250,'250 rows'],[500,'500 rows'],[5000,'All rows']];if(role==='tl')return [[10,'10 rows'],[25,'25 rows'],[50,'50 rows']];return [[10,'10 rows']]}
const COLUMNS=[['candidate_id','Candidate ID',116],['recruiter_name','Recruiter Name',180],['full_name','Name',190],['phone','Number',150],['location','Location',210],['qualification','Qualification',210],['preferred_location','Preferred Location',165],['qualification_level','Qualification Level',165],['total_experience','Total Exp.',135],['relevant_experience','Relevant Exp.',145],['ctc_monthly','CTC Monthly',130],['in_hand_salary','In-hand Salary',140],['communication_skill','Communication',155],['interview_reschedule_date','Interview Date',155],['notes','Notes',240],['jd_notes','JD Notes',240],['profile_status','Profile Status',150],['jd_name','JD Name',190],['employee_no','Employee No.',135],['employee_name','Employee Name',190],['employee_row_no','Employee Row No.',150],['last_updated_at','Last Updated',175]];
const IMPORTANT=new Set(['full_name','phone','location','qualification','preferred_location','qualification_level','total_experience','relevant_experience','ctc_monthly','in_hand_salary','communication_skill','interview_reschedule_date','profile_status','jd_name']);
const QUICK_FILTERS=[['all','All Profiles'],['fresh','Fresh Profile'],['allocated','Allocated'],['followup_due','Follow Up Due'],['warning','Warning'],['last_day','Last Day']];
function val(row,key){return String(row?.[key]??'').trim()}
function dateOnly(v){const s=String(v||'').trim();const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);return m?`${m[1]}-${m[2]}-${m[3]}`:s}
function hotLeadDisplayValue(row,field){if(field==='interview_reschedule_date')return dateOnly(val(row,field));if(field==='recruiter_name')return val(row,'recruiter_name')||val(row,'employee_name')||val(row,'employee_code')||val(row,'recruiter_code');return val(row,field)}
function Cell({row,field}){const raw=hotLeadDisplayValue(row,field);const missing=!raw&&IMPORTANT.has(field);return <td className={missing?'hot-leads-missing-cell':'hot-leads-normal-cell'} title={raw||missing?'Missing field':''}><span className="hot-leads-cell-text">{raw||(missing?'Missing':'-')}</span></td>}

export default function HotLeadsPage(){
 const { user } = useAuth();
 const userRole = roleOf(user);
 const leadership = ['admin','manager','tl'].includes(userRole);
 const maxRows = rowLimitForRole(userRole);
 const [rows,setRows]=useState([]);
 const [dialerRows,setDialerRows]=useState([]);
 const [summary,setSummary]=useState({});
 const [recruiterOptions,setRecruiterOptions]=useState([]);
 const [q,setQ]=useState('');
 const [page,setPage]=useState(1);
 const [pageSize,setPageSize]=useState(Math.min(10,maxRows));
 const [filters,setFilters]=useState({bucket_view:'all',recruiter_code:'',last_viewed_mode:''});
 const [selectedIds,setSelectedIds]=useState([]);
 const [dialerOpen,setDialerOpen]=useState(false);
 const [dialerIndex,setDialerIndex]=useState(0);
 const [autoNextCountdown,setAutoNextCountdown]=useState(0);
 const [loading,setLoading]=useState(false);
 const [message,setMessage]=useState('');
 const totalRows=Number(summary.filtered_total ?? summary.total ?? 0);
 const totalPages=useMemo(()=>Math.max(1,Math.ceil(totalRows/pageSize)),[totalRows,pageSize]);
 async function load(nextPage=page,nextQ=q,nextSize=pageSize,nextFilters=filters){
   const safeSize=Math.min(rowLimitForRole(userRole),Math.max(1,Number(nextSize)||10));
   setLoading(true);setMessage('');
   try{
     const p=new URLSearchParams();
     p.set('page',String(nextPage));
     p.set('page_size',String(safeSize));
     p.set('bucket_view',String(nextFilters.bucket_view||'all'));
     p.set('last_viewed_mode',String(nextFilters.last_viewed_mode||''));
     if(leadership&&String(nextFilters.recruiter_code||'').trim())p.set('recruiter_code',String(nextFilters.recruiter_code).trim());
     if(String(nextQ||'').trim())p.set('q',String(nextQ).trim());
     const data=await api.get(`/api/hot-leads?${p.toString()}`,{cacheTtlMs:0,timeoutMs:18000,retries:1});
     setRows(data.items||[]);
     setDialerRows(data.dialer_items||data.items||[]);
     setSummary(data.summary||{total:Number(data.total||0),filtered_total:Number(data.total||0)});
     setRecruiterOptions(Array.isArray(data.recruiter_options)?data.recruiter_options:[]);
     setPage(Number(data.page||nextPage||1));
     setPageSize(Number(data.page_size||safeSize));
   }catch(e){setRows([]);setMessage(e.message||'Hot Leads load failed.');}
   finally{setLoading(false)}
 }
 useEffect(()=>{load(1,q,pageSize,filters).catch(()=>{})},[]);
 function openProfile(row){if(!row?.candidate_id)return;openCandidateProfileInNewTab(row.candidate_id,rows,{sourcePath:window.location.pathname+(window.location.search||'')})}
 function openWhatsApp(row){const digits=phoneDigits(row);if(!digits)return;openWhatsAppWithLog(row.candidate_id,digits,'')}
 function searchNow(e){e?.preventDefault?.();load(1,q,pageSize,filters).catch(()=>{})}
 function setBucketView(view){const next={...filters,bucket_view:view};setFilters(next);setPage(1);load(1,q,pageSize,next).catch(()=>{})}
 function setRecruiterCode(code){const next={...filters,recruiter_code:code};setFilters(next);setPage(1);load(1,q,pageSize,next).catch(()=>{})}
 function setLastViewedMode(mode){const next={...filters,last_viewed_mode:mode};setFilters(next);setPage(1);load(1,q,pageSize,next).catch(()=>{})}
 function changePageSize(e){const n=Math.min(maxRows,Math.max(1,Number(e.target.value)||10));setPageSize(n);load(1,q,n,filters).catch(()=>{})}
 const visibleRowIds=useMemo(()=>Array.from(new Set(rows.map(row=>normalizeId(row.candidate_id)).filter(Boolean))),[rows]);
 const selectableRowIds=useMemo(()=>Array.from(new Set((dialerRows.length?dialerRows:rows).map(row=>normalizeId(row.candidate_id)).filter(Boolean))),[dialerRows,rows]);
 const selectedRows=useMemo(()=>{const picked=new Set(selectedIds.map(normalizeId));return (dialerRows.length?dialerRows:rows).filter(row=>picked.has(normalizeId(row.candidate_id)))},[dialerRows,rows,selectedIds]);
 const currentDialerTarget=selectedRows[dialerIndex]||selectedRows[0]||null;
 const allSelected=selectableRowIds.length>0&&selectableRowIds.every(id=>selectedIds.includes(id));
 useEffect(()=>{setSelectedIds(prev=>prev.filter(id=>selectableRowIds.includes(id)))},[selectableRowIds]);
 useEffect(()=>{if(!selectedRows.length){setDialerOpen(false);setDialerIndex(0);return}if(dialerIndex>=selectedRows.length)setDialerIndex(0)},[selectedRows.length,dialerIndex]);
 function toggleSelection(candidateId,event){event?.stopPropagation?.();const id=normalizeId(candidateId);if(!id)return;setSelectedIds(prev=>prev.includes(id)?prev.filter(item=>item!==id):[...prev,id])}
 function toggleSelectAll(event){event?.stopPropagation?.();setSelectedIds(prev=>allSelected?prev.filter(id=>!selectableRowIds.includes(id)):Array.from(new Set([...prev,...selectableRowIds])))}
 function clearSelection(){setSelectedIds([]);setDialerOpen(false);setDialerIndex(0);setAutoNextCountdown(0)}
 function markCallDoneAndAutoNext(){if(!selectedRows.length)return;setAutoNextCountdown(5)}
 function nextSelected(){if(!selectedRows.length)return;setDialerIndex(prev=>(prev+1)%selectedRows.length)}
 function prevSelected(){if(!selectedRows.length)return;setDialerIndex(prev=>(prev-1+selectedRows.length)%selectedRows.length)}
 useEffect(()=>{if(!autoNextCountdown)return undefined;const timer=window.setTimeout(()=>{setAutoNextCountdown(current=>{if(current<=1){window.setTimeout(()=>nextSelected(),0);return 0}return current-1})},1000);return()=>window.clearTimeout(timer)},[autoNextCountdown,selectedRows.length]);
 function dialHotLead(row){const digits=phoneDigits(row);if(!digits)return;dialCandidateWithLog(row.candidate_id,digits)}
 const cards=[
   {key:'all',label:'Total Profiles',value:summary.total_visible||summary.total||0,note:`${summary.allocated_profiles||0} allocated live`,tone:'blue'},
   {key:'fresh',label:'Fresh Profile',value:summary.fresh_profiles||0,note:'Never called yet',tone:'green'},
   {key:'allocated',label:'Allocated',value:summary.allocated_profiles||0,note:'Active recruiter buckets',tone:'cyan'},
   {key:'my_fresh',label:'My Fresh Profiles',value:summary.my_fresh_profiles||0,note:`${user?.full_name||'My'} fresh queue`,tone:'green'},
   {key:'my_working',label:'My Working Profiles',value:summary.my_working_profiles||0,note:`${user?.full_name||'My'} active working`,tone:'purple'},
   {key:'followup_due',label:'Follow Up Due',value:summary.pending_followups||0,note:'Total follow ups',tone:'blue'},
   {key:'warning',label:'Warning',value:summary.warning_profiles||0,note:'2-3 days left',tone:'orange'},
   {key:'last_day',label:'Last Day',value:summary.last_day_profiles||0,note:'Call first',tone:'pink'},
 ];
 const rowOptions=rowOptionsForRole(userRole);
 return <Layout title="Hot Leads" subtitle="Hot leads use Candidate-style cards, recruiter filters, row limits and profile opening.">
   <div className="hot-leads-as-candidates">
     {!!message&&<div className="panel top-gap-small"><div className="helper-text">{message}</div></div>}
     <div className="bucket-card-grid top-gap-small fade-up">
       {cards.map(card=><button key={card.key} type="button" className={`stat-card bucket-click-card ${card.tone} ${(filters.bucket_view===card.key || (card.key==='all'&&!filters.bucket_view))?'active':''}`} onClick={()=>setBucketView(card.key)}><span>{card.label}</span><strong>{card.value}</strong><small>{card.note}</small></button>)}
     </div>
     <div className="table-panel top-gap-small glassy-card fade-up bucket-toolbar-panel hot-leads-tracker-panel">
       <div className="table-toolbar no-wrap-toolbar bucket-toolbar-stack hot-leads-toolbar-clean">
         <div><div className="table-title">Hot Leads Tracker</div><div className="helper-text">Total hot leads: {summary.total_visible||0} • Fresh: {summary.fresh_profiles||0} • Allocated: {summary.allocated_profiles||0}</div></div>
         <form className="toolbar-actions compact-pills candidate-toolbar-actions hot-leads-head-actions" onSubmit={searchNow}>
           <span className="metric-mini-chip records">{totalRows} records</span>
           <span className="metric-mini-chip filters">{rows.length} showing</span>
           {leadership?<label className="compact-select-shell shell-sky candidate-recruiter-shell"><span className="compact-shell-label">Recruiter</span><select className="inline-input compact-inline-input bucket-target-select" value={filters.recruiter_code||''} onChange={e=>setRecruiterCode(e.target.value)}><option value="">All Recruiters</option>{recruiterOptions.map(opt=><option key={opt.value||opt.code||opt.label} value={opt.value||opt.code||''}>{opt.label||opt.value||opt.code}</option>)}</select></label>:null}
           <input className="inline-input compact-inline-input hot-leads-search-field" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search hot lead"/>
           <button className="ghost-btn bounceable modern-filter-btn gradient-action-btn gradient-slate" type="submit" disabled={loading}>{loading?'Loading...':'Search'}</button>
           <label className="compact-select-shell shell-sky candidate-recruiter-shell hot-leads-row-shell"><span className="compact-shell-label">Rows</span><select className="inline-input compact-inline-input bucket-target-select" value={String(pageSize)} onChange={changePageSize}>{rowOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
         </form>
       </div>
       <div className="bucket-quick-filter-row hot-leads-quick-filter-row">
         {QUICK_FILTERS.map(([key,label])=><button key={key} type="button" className={`bucket-quick-pill bounceable ${filters.bucket_view===key?'active':''}`} onClick={()=>setBucketView(key)}>{label}</button>)}
         <label className="compact-select-shell shell-sky candidate-recruiter-shell"><span className="compact-shell-label">Last Viewed</span><select className="inline-input compact-inline-input bucket-target-select" value={filters.last_viewed_mode||''} onChange={e=>setLastViewedMode(e.target.value)}><option value="">All Last Viewed</option><option value="today">Today</option><option value="lt1">&lt; 1 Day</option><option value="lt2">&lt; 2 Days</option><option value="lt5">&lt; 5 Days</option></select></label>
         <button type="button" className="ghost-btn bounceable modern-filter-btn gradient-action-btn gradient-slate" onClick={()=>load(1,q,pageSize,filters).catch(()=>{})}><FilterIcon/> Refresh</button>
       </div>
       <div className="candidate-master-row top-gap-small">
         <button type="button" className={`selection-master-pill bounceable ${allSelected?'active':''}`} onClick={toggleSelectAll}>
           <span className="selection-master-icon"><SelectAllIcon/></span>
           {allSelected?'Clear All':`Select All ${selectableRowIds.length||''}`}
         </button>
         <span className="selection-count-chip">{selectedIds.length} selected</span>
         <button type="button" className={`open-dialer-pill bounceable ${selectedRows.length?'active':''}`} onClick={()=>setDialerOpen(prev=>selectedRows.length?!prev:false)} disabled={!selectedRows.length}><DialerIcon/> Dialer</button>
         {selectedRows.length?<button type="button" className="ghost-btn bounceable" onClick={clearSelection}>Clear Selection</button>:null}
         <button type="button" className="open-dialer-pill bounceable active" onClick={()=>load(page,q,pageSize,filters).catch(()=>{})}>Refresh Hot Leads</button>
       </div>
       {dialerOpen&&currentDialerTarget?(
         <div className="floating-dialer show top-gap-small">
           <div className="dialer-head">
             <div><h3 className="dialer-title">Hot Leads Dialer</h3><div className="helper-text">{selectedRows.length} selected • {dialerIndex+1} / {selectedRows.length}</div></div>
             <button type="button" className="mini-btn ghost bounceable" onClick={()=>setDialerOpen(false)} title="Close Dialer"><CloseIcon/></button>
           </div>
           <div className="dialer-now"><div className="helper-text">Current target</div>{currentDialerTarget.full_name||'-'} • {phoneDigits(currentDialerTarget)||'No number'}</div>
           <div className="dialer-actions-row row-actions nowrap-actions">
             <button type="button" className="mini-btn ghost bounceable modern-nav-btn" onClick={prevSelected} title="Previous"><PrevIcon/></button>
             <button type="button" className="mini-btn view bounceable modern-icon-btn modern-call-btn" onClick={()=>dialHotLead(currentDialerTarget)} title="Dial now" disabled={!phoneDigits(currentDialerTarget)}><PhoneIcon/></button>
             <button type="button" className="mini-btn edit bounceable modern-icon-btn modern-whatsapp-btn" onClick={()=>openWhatsApp(currentDialerTarget)} title="Open WhatsApp" disabled={!phoneDigits(currentDialerTarget)}><WhatsAppIcon/></button>
             <button type="button" className="mini-btn ghost bounceable modern-nav-btn" onClick={nextSelected} title="Next"><NextIcon/></button>
             <button type="button" className="open-profile-chip bounceable" onClick={markCallDoneAndAutoNext}>{autoNextCountdown?`Next in ${autoNextCountdown}s`:'Call Done'}</button>
             <button type="button" className="open-profile-chip bounceable" onClick={()=>openProfile(currentDialerTarget)}>Open Profile</button>
           </div>
         </div>
       ):null}
       <div className="crm-table-wrap dense-wrap top-gap-small candidates-scroll-wrap hot-leads-candidate-scroll"><table className="crm-table colorful-table dense-table candidates-overview-table hot-leads-candidate-table"><thead><tr><th style={{width:84,minWidth:84}}><button type="button" className={`table-master-check ${allSelected?'active':''}`} onClick={toggleSelectAll} title={allSelected?'Clear All':`Select All ${selectableRowIds.length||''}`}><CheckIcon/></button></th>{COLUMNS.map(([k,l,w])=><th key={k} style={{width:w,minWidth:w}}>{l}</th>)}<th className="sticky-action-col hot-leads-action-col">Actions</th></tr></thead><tbody>{rows.map(row=>{const rowId=normalizeId(row.candidate_id);const rowSelected=selectedIds.includes(rowId);return <tr key={row.candidate_id||`${row.full_name}-${row.phone}`} className={`clickable-row ${rowSelected?'selected-row':''}`} onClick={()=>openProfile(row)}><td onClick={e=>e.stopPropagation()}><button type="button" className={`table-row-check ${rowSelected?'active':''}`} onClick={e=>toggleSelection(row.candidate_id,e)} title={rowSelected?'Unselect':'Select'}><CheckIcon/></button></td>{COLUMNS.map(([k])=><Cell key={k} row={row} field={k}/>)}<td className="sticky-actions-cell hot-leads-action-cell" onClick={e=>e.stopPropagation()}><button type="button" className="mini-btn call bounceable modern-icon-btn modern-whatsapp-btn" onClick={()=>openWhatsApp(row)} title="Open WhatsApp" disabled={!phoneDigits(row)}><WhatsAppIcon/></button></td></tr>})}{!rows.length&&<tr><td colSpan={COLUMNS.length+2} className="hot-leads-empty-cell">No Hot Leads found. Upload from Admin Panel → Hot Leads or import into Supabase hot_leads table.</td></tr>}</tbody></table></div>
       <div className="row-actions top-gap-small candidate-pager-row hot-leads-pager-row" style={{justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}><div className="helper-text">Page {page} of {totalPages} • Showing {rows.length} of {totalRows} • Max rows for this role: {maxRows}</div><div className="row-actions candidate-page-jump-wrap" style={{gap:8,flexWrap:'wrap',alignItems:'center'}}><button type="button" className="ghost-btn bounceable" disabled={page<=1||loading} onClick={()=>load(page-1,q,pageSize,filters)}>Previous</button><button type="button" className="bucket-quick-pill bounceable active">{page}</button><button type="button" className="add-profile-btn bounceable" disabled={page>=totalPages||loading} onClick={()=>load(page+1,q,pageSize,filters)}>Next</button></div></div>
     </div>
   </div>
 </Layout>;
}
