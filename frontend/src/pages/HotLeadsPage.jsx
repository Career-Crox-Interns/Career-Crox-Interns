import {useSliceSearch,useSliceState,CrmSortSelect,sortCrmRows} from '../lib/workspaceHelpers';
import {useCandidateFilterCatalog} from '../lib/workspaceHelpers';
import { ActionGlyph } from '../components/EmojiGlyph';
import PremiumSelect from '../components/PremiumSelect';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { useDashboardAuth as useAuth } from '../lib/auth';
import { openCandidateProfileInNewTab, navigateSameTab } from '../lib/candidateNav';
import { dialCandidateWithLog, openWhatsAppWithLog } from '../lib/candidateAccess';
import { updateRowSelection } from '../lib/workspaceHelpers';

function WhatsAppIcon() { return <ActionGlyph kind="whatsapp"/>; }
function FilterIcon(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}
function PhoneIcon() { return <ActionGlyph kind="phone"/>; }
function DialerIcon(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 4h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="9" cy="8" r="1"/><circle cx="12" cy="8" r="1"/><circle cx="15" cy="8" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="16" r="1"/><circle cx="12" cy="16" r="1"/><circle cx="15" cy="16" r="1"/></svg>}
function SelectAllIcon(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M8.3 12.2 10.9 15l4.9-5.3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
function CheckIcon(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5.2 12.7 9.4 17l9.4-9.4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
function CloseIcon(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>}
function PrevIcon(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m14.5 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
function NextIcon(){return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
function normalizeId(value){return String(value||'').trim()}

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
  const filterCatalog=useCandidateFilterCatalog(user);
  const staffFilterOptions=(filterCatalog.users||[]).map(u=>({value:u.recruiter_code||u.user_id,label:u.full_name||u.username||u.recruiter_code}));

 const userRole = roleOf(user);
 const leadership = ['admin','manager','tl'].includes(userRole);
 const maxRows = rowLimitForRole(userRole);
 const [rows,setRows]=useState([]);
 const [dialerRows,setDialerRows]=useState([]);
 const [summary,setSummary]=useState({});
 const [recruiterOptions,setRecruiterOptions]=useState([]);
 const [q,setQ]=useSliceState("q:hot-leads",'');
 useSliceSearch(q,setQ);
 const [page,setPage]=useSliceState("page:hot-leads",1);
 const [pageSize,setPageSize]=useSliceState("pageSize:hot-leads",Math.min(10,maxRows));
 const [filters,setFilters]=useSliceState("filters:hot-leads",{bucket_view:'all',recruiter_code:'',last_viewed_mode:''});
 const [sortBy,setSortBy]=useSliceState('hot-leads:sort','default');
 const [selectedIds,setSelectedIds]=useState([]);
 const selectionAnchorRef=useRef(null);
 const [dialerOpen,setDialerOpen]=useState(false);
 const [dialerIndex,setDialerIndex]=useState(0);
 const [autoNextCountdown,setAutoNextCountdown]=useState(0);
 const [loading,setLoading]=useState(false);
 const [message,setMessage]=useState('');
 const totalRows=Number(summary.filtered_total ?? summary.total ?? 0);
 const totalPages=useMemo(()=>Math.max(1,Math.ceil(totalRows/pageSize)),[totalRows,pageSize]);
 function buildHotLeadSourceApi(nextPage=page,nextQ=q,nextSize=pageSize,nextFilters=filters){
   const safeSize=Math.min(rowLimitForRole(userRole),Math.max(1,Number(nextSize)||10));
   const p=new URLSearchParams();
   p.set('page',String(nextPage));p.set('sort_by',sortBy);
   p.set('page_size',String(safeSize));
   p.set('bucket_view',String(nextFilters.bucket_view||'all'));
   p.set('last_viewed_mode',String(nextFilters.last_viewed_mode||''));
   if(leadership&&String(nextFilters.recruiter_code||'').trim())p.set('recruiter_code',String(nextFilters.recruiter_code).trim());
   if(String(nextQ||'').trim())p.set('q',String(nextQ).trim());
   return `/api/hot-leads?${p.toString()}`;
 }
 async function load(nextPage=page,nextQ=q,nextSize=pageSize,nextFilters=filters){
   const safeSize=Math.min(rowLimitForRole(userRole),Math.max(1,Number(nextSize)||10));
   setLoading(true);setMessage('');
   try{
     const p=new URLSearchParams();
     p.set('page',String(nextPage));p.set('sort_by',sortBy);
     p.set('page_size',String(safeSize));
     p.set('bucket_view',String(nextFilters.bucket_view||'all'));
     p.set('last_viewed_mode',String(nextFilters.last_viewed_mode||''));
     if(leadership&&String(nextFilters.recruiter_code||'').trim())p.set('recruiter_code',String(nextFilters.recruiter_code).trim());
     if(String(nextQ||'').trim())p.set('q',String(nextQ).trim());
     const data=await api.get(`/api/hot-leads?${p.toString()}`,{cacheTtlMs:60000,allowStale:true,timeoutMs:18000,retries:1});
     setRows(data.items||[]);
     setDialerRows(data.dialer_items||data.items||[]);
     setSummary(data.summary||{total:Number(data.total||0),filtered_total:Number(data.total||0)});
     setRecruiterOptions(Array.isArray(data.recruiter_options)?data.recruiter_options:[]);
     setPage(Number(data.page||nextPage||1));
     setPageSize(Number(data.page_size||safeSize));
   }catch(e){setRows([]);setMessage(e.message||'Hot Leads load failed.');}
   finally{setLoading(false)}
 }
 useEffect(()=>{load(page,q,pageSize,filters).catch(()=>{})},[]);
 const sortMounted=useRef(false);useEffect(()=>{if(!sortMounted.current){sortMounted.current=true;return;}load(1,q,pageSize,filters).catch(()=>{})},[sortBy]);
 function openProfile(row){if(!row?.candidate_id)return;openCandidateProfileInNewTab(row,rows,{sourcePath:window.location.pathname+(window.location.search||''),sourceApi:buildHotLeadSourceApi(page,q,pageSize,filters),sourceKind:'hot-leads',page,pageSize,totalRows,hasMore:page*pageSize<Number(totalRows||0)})}
 function openWhatsApp(row){const digits=phoneDigits(row);if(!digits)return;openWhatsAppWithLog(row.candidate_id,digits,'')}
 function searchNow(e){e?.preventDefault?.();load(1,q,pageSize,filters).catch(()=>{})}
 function setBucketView(view){const next={...filters,bucket_view:view};setFilters(next);setPage(1);load(1,q,pageSize,next).catch(()=>{})}
 function setRecruiterCode(code){const next={...filters,recruiter_code:code};setFilters(next);setPage(1);load(1,q,pageSize,next).catch(()=>{})}
 function setLastViewedMode(mode){const next={...filters,last_viewed_mode:mode};setFilters(next);setPage(1);load(1,q,pageSize,next).catch(()=>{})}
 function changePageSize(e){const n=Math.min(maxRows,Math.max(1,Number(e.target.value)||10));setPageSize(n);load(1,q,n,filters).catch(()=>{})}
 const visibleRowIds=useMemo(()=>Array.from(new Set(rows.map(row=>normalizeId(row.candidate_id)).filter(Boolean))),[rows]);
 const selectableRowIds=useMemo(()=>Array.from(new Set((dialerRows.length?dialerRows:rows).map(row=>normalizeId(row.candidate_id)).filter(Boolean))),[dialerRows,rows]);
 const selectedRows=useMemo(()=>{const sourceRows=dialerRows.length?dialerRows:rows;const rowById=new Map(sourceRows.map(row=>[normalizeId(row.candidate_id),row]));return selectedIds.map(normalizeId).map(id=>rowById.get(id)).filter(Boolean)},[dialerRows,rows,selectedIds]);
 const currentDialerTarget=selectedRows[dialerIndex]||selectedRows[0]||null;
 const allSelected=selectableRowIds.length>0&&selectableRowIds.every(id=>selectedIds.includes(id));
 useEffect(()=>{setSelectedIds(prev=>prev.filter(id=>selectableRowIds.includes(id)))},[selectableRowIds]);
 useEffect(()=>{if(!selectedRows.length){setDialerOpen(false);setDialerIndex(0);return}if(dialerIndex>=selectedRows.length)setDialerIndex(0)},[selectedRows.length,dialerIndex]);
 function toggleSelection(candidateId,event){event?.stopPropagation?.();const id=normalizeId(candidateId);if(!id)return;const shiftKey=Boolean(event?.shiftKey||event?.nativeEvent?.shiftKey),anchorId=selectionAnchorRef.current;setSelectedIds(current=>updateRowSelection(current,visibleRowIds,id,{shiftKey,anchorId}));if(!shiftKey||!visibleRowIds.includes(anchorId))selectionAnchorRef.current=id;}
 function toggleSelectAll(event){event?.stopPropagation?.();selectionAnchorRef.current=null;setSelectedIds(prev=>allSelected?prev.filter(id=>!selectableRowIds.includes(id)):Array.from(new Set([...prev,...selectableRowIds])))}
 function clearSelection(){selectionAnchorRef.current=null;setSelectedIds([]);setDialerOpen(false);setDialerIndex(0);setAutoNextCountdown(0)}
 function loadSelectedToAutoDialer(){if(!selectedRows.length)return;const startRow=currentDialerTarget||selectedRows[0];const startId=normalizeId(startRow?.candidate_id);const startIndex=selectedRows.findIndex(row=>normalizeId(row.candidate_id)===startId);const orderedItems=startIndex>0?[...selectedRows.slice(startIndex),...selectedRows.slice(0,startIndex)]:selectedRows;const payload={source:'Hot Leads',items:orderedItems.map((row,index)=>({...row,queue_order:index+1,dialer_sequence:index+1,__dialer_order:index+1})),start_candidate_id:startId,created_at:new Date().toISOString()};try{sessionStorage.setItem('careerCroxAutoDialerQueue:v1',JSON.stringify(payload));localStorage.setItem('careerCroxAutoDialerQueue:v1',JSON.stringify(payload))}catch{}navigateSameTab('/auto-dialer')}
 function markCallDoneAndAutoNext(){if(!selectedRows.length)return;setAutoNextCountdown(7)}
 function nextSelected(){if(!selectedRows.length)return;setDialerIndex(prev=>(prev+1)%selectedRows.length)}
 function prevSelected(){if(!selectedRows.length)return;setDialerIndex(prev=>(prev-1+selectedRows.length)%selectedRows.length)}
 useEffect(()=>{if(!autoNextCountdown)return undefined;const timer=window.setTimeout(()=>{setAutoNextCountdown(current=>{if(current<=1){window.setTimeout(()=>nextSelected(),0);return 0}return current-1})},1000);return()=>window.clearTimeout(timer)},[autoNextCountdown,selectedRows.length]);
 function dialHotLead(row){const digits=phoneDigits(row);if(!digits)return;setMessage('Sending call to paired mobile app...');dialCandidateWithLog(row.candidate_id,digits,{candidate_name:row.full_name||row.name||'',process:row.process||row.jd_name||'Hot Lead'}).then(()=>setMessage('Mobile app call command sent.')).catch((e)=>setMessage(e.message||'Pair/open mobile app first.'))}
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
 return <Layout title="Hot Leads" subtitle=""><CrmSortSelect value={sortBy} onChange={setSortBy}/>
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
           {leadership?<label className="compact-select-shell shell-sky candidate-recruiter-shell"><span className="compact-shell-label">Recruiter</span><PremiumSelect className="inline-input compact-inline-input bucket-target-select" value={filters.recruiter_code||''} onChange={e=>setRecruiterCode(e.target.value)}><option value="">All Recruiters</option>{staffFilterOptions.map(opt=><option key={opt.value||opt.code||opt.label} value={opt.value||opt.code||''}>{opt.label||opt.value||opt.code}</option>)}</PremiumSelect></label>:null}
           <input className="inline-input compact-inline-input hot-leads-search-field" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search hot lead"/>
           <button className="ghost-btn bounceable modern-filter-btn gradient-action-btn gradient-slate" type="submit" disabled={loading}>{loading?'Loading...':'Search'}</button>
           <label className="compact-select-shell shell-sky candidate-recruiter-shell hot-leads-row-shell"><span className="compact-shell-label">Rows</span><PremiumSelect className="inline-input compact-inline-input bucket-target-select" value={String(pageSize)} onChange={changePageSize}>{rowOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</PremiumSelect></label>
         </form>
       </div>
       <div className="bucket-quick-filter-row hot-leads-quick-filter-row">
         {QUICK_FILTERS.map(([key,label])=><button key={key} type="button" className={`bucket-quick-pill bounceable ${filters.bucket_view===key?'active':''}`} onClick={()=>setBucketView(key)}>{label}</button>)}
         <label className="compact-select-shell shell-sky candidate-recruiter-shell"><span className="compact-shell-label">Last Viewed</span><PremiumSelect className="inline-input compact-inline-input bucket-target-select" value={filters.last_viewed_mode||''} onChange={e=>setLastViewedMode(e.target.value)}><option value="">All Last Viewed</option><option value="today">Today</option><option value="lt1">&lt; 1 Day</option><option value="lt2">&lt; 2 Days</option><option value="lt5">&lt; 5 Days</option></PremiumSelect></label>
         <button type="button" className="ghost-btn bounceable modern-filter-btn gradient-action-btn gradient-slate" onClick={()=>load(1,q,pageSize,filters).catch(()=>{})}><FilterIcon/> Update Details</button>
       </div>
       <div className="candidate-master-row top-gap-small">
         <button type="button" className={`selection-master-pill bounceable ${allSelected?'active':''}`} onClick={toggleSelectAll}>
           <span className="selection-master-icon"><SelectAllIcon/></span>
           {allSelected?'Clear All':`Select All ${selectableRowIds.length||''}`}
         </button>
         <span className="selection-count-chip">{selectedIds.length} selected</span>
         <button type="button" className={`open-dialer-pill bounceable ${selectedRows.length>=2?'active':''}`} onClick={()=>setDialerOpen(prev=>selectedRows.length>=2?!prev:false)} disabled={selectedRows.length < 2}><DialerIcon/> Dialer</button>
         <button type="button" className="add-profile-btn bounceable" onClick={loadSelectedToAutoDialer} disabled={selectedRows.length < 2}>Load to Auto Dialer</button>
         {selectedRows.length?<button type="button" className="ghost-btn bounceable" onClick={clearSelection}>Clear Selection</button>:null}
         <button type="button" className="open-dialer-pill bounceable active" onClick={()=>load(page,q,pageSize,filters).catch(()=>{})}>Update Hot Leads</button>
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
       <div className="crm-table-wrap dense-wrap top-gap-small candidates-scroll-wrap hot-leads-candidate-scroll"><table className="crm-table colorful-table dense-table candidates-overview-table hot-leads-candidate-table"><thead><tr><th style={{width:84,minWidth:84}}><button type="button" className={`table-master-check ${allSelected?'active':''}`} onClick={toggleSelectAll} title={allSelected?'Clear All':`Select All ${selectableRowIds.length||''}`}><CheckIcon/></button></th>{COLUMNS.map(([k,l,w])=><th key={k} style={{width:w,minWidth:w}}>{l}</th>)}<th className="sticky-action-col hot-leads-action-col">Actions</th></tr></thead><tbody>{rows.map(row=>{const rowId=normalizeId(row.candidate_id);const rowSelected=selectedIds.includes(rowId);return <tr key={row.candidate_id||`${row.full_name}-${row.phone}`} aria-selected={rowSelected} className={`clickable-row ${rowSelected?'selected-row':''}`} onClick={()=>openProfile(row)}><td onClick={e=>e.stopPropagation()}><button type="button" className={`table-row-check ${rowSelected?'active':''}`} role="checkbox" aria-checked={rowSelected} aria-label={`Select hot lead ${row.candidate_id}`} onClick={e=>toggleSelection(row.candidate_id,e)} title="Click to toggle; Shift-click another row to select or clear a range"><CheckIcon/></button></td>{COLUMNS.map(([k])=><Cell key={k} row={row} field={k}/>)}<td className="sticky-actions-cell hot-leads-action-cell" onClick={e=>e.stopPropagation()}><button type="button" className="mini-btn view bounceable modern-icon-btn modern-call-btn" onClick={()=>dialHotLead(row)} title="Call on Mobile" disabled={!phoneDigits(row)}><PhoneIcon/></button><button type="button" className="mini-btn call bounceable modern-icon-btn modern-whatsapp-btn" onClick={()=>openWhatsApp(row)} title="Open WhatsApp" disabled={!phoneDigits(row)}><WhatsAppIcon/></button></td></tr>})}{!rows.length&&<tr><td colSpan={COLUMNS.length+2} className="hot-leads-empty-cell">No Hot Leads found. Upload from Admin Panel → Hot Leads or import into Supabase hot_leads table.</td></tr>}</tbody></table></div>
       <div className="row-actions top-gap-small candidate-pager-row hot-leads-pager-row" style={{justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}><div className="helper-text">Page {page} of {totalPages} • Showing {rows.length} of {totalRows} • Max rows for this role: {maxRows}</div><div className="row-actions candidate-page-jump-wrap" style={{gap:8,flexWrap:'wrap',alignItems:'center'}}><button type="button" className="ghost-btn bounceable" disabled={page<=1||loading} onClick={()=>load(page-1,q,pageSize,filters)}>Previous</button><button type="button" className="bucket-quick-pill bounceable active">{page}</button><button type="button" className="add-profile-btn bounceable" disabled={page>=totalPages||loading} onClick={()=>load(page+1,q,pageSize,filters)}>Next</button></div></div>
     </div>
   </div>
 </Layout>;
}
