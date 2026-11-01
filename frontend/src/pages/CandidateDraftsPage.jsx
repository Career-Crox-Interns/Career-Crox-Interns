import React,{useEffect,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import Layout from '../components/Layout';
import {api,cachePrincipal} from '../lib/api';
import {useDashboardAuth as useAuth} from '../lib/auth';
const prefix='careerCroxCandidateDurableDraft_v6_finaldraft:';
function localDrafts(){const start=prefix+cachePrincipal()+':',out=[];try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith(start))continue;const d=JSON.parse(localStorage.getItem(key)||'null');if(d?.item?.candidate_id&&d.editedFields&&!Object.keys(d.editedFields).length&&!d.conflictEdits?.length&&!String(d.noteBody||'').trim())continue;if(!d?.item||!(['full_name','phone','email','location','process','course_name'].some(k=>String(d.item[k]??'').trim())||String(d.noteBody||'').trim()))continue;out.push({draft_id:key.slice(start.length),server_id:localStorage.getItem('cc848-idless-draft:'+cachePrincipal()+':'+key.slice(start.length))||'',user_id:d.draftOwner||cachePrincipal().split('|')[0],local:true,full_name:d.item.full_name||'Untitled draft',phone:d.item.phone||'',location:d.item.location||'',process:d.item.process||'',email:d.item.email||'',preferred_location:d.item.preferred_location||'',qualification:d.item.qualification||'',course_name:d.item.course_name||'',qualification_level:d.item.qualification_level||'',total_experience:d.item.total_experience??'',in_hand_salary:d.item.in_hand_salary??'',status:d.item.status||'',note_preview:String(d.noteBody||'').slice(0,160),updated_at:new Date(Number(d.editedAt)||Date.now()).toISOString(),can_resume:true,snapshot:d,candidate_id:d.item.candidate_id||''});}}catch{}return out;}
export default function CandidateDraftsPage(){
 const {user}=useAuth(),navigate=useNavigate();
 const [rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(''),[page,setPage]=useState(1),[more,setMore]=useState(false),[total,setTotal]=useState(0),[query,setQuery]=useState('');
 const load=async(next=1)=>{setError('');try{const d=await api.get('/api/profile-safety/drafts?page='+next,{cacheTtlMs:0,allowStale:false,retries:0});const matches=(l,s)=>String(l.user_id)===String(s.user_id)&&(s.candidate_id===l.draft_id||l.server_id===s.draft_id||l.draft_id.endsWith(s.draft_id));const server=d.items||[],local=next===1?localDrafts().filter(l=>!server.some(s=>matches(l,s)&&Date.parse(s.updated_at)>=Date.parse(l.updated_at))):[],visible=server.filter(s=>!local.some(l=>matches(l,s)));setRows(r=>next===1?[...local,...visible]:[...r,...visible]);setPage(next);setMore(d.has_more);setTotal(Number(d.total||0)+local.filter(l=>!server.some(s=>matches(l,s))).length);}catch(e){if(next===1){const local=localDrafts();setRows(local);setTotal(local.length);}setError(e.message+' · Device drafts remain available.');}};
 useEffect(()=>{load();},[user?.user_id]);
 async function resume(row){
  if(busy)return;setBusy(row.draft_id);setError('');
  try{
   const localValue={fields:row.snapshot?.item||{},note:{body:row.snapshot?.noteBody||''},can_resume:true,candidate_id:row.snapshot?.item?.candidate_id||'',user_id:row.user_id,draft_id:row.server_id||row.draft_id.replace(/^new:/,''),updated_at:row.snapshot?.draftUpdatedAt||row.updated_at};
   let d=localValue;
   if(!row.local||row.server_id){try{d=await api.get('/api/profile-safety/drafts/'+encodeURIComponent(row.local?row.server_id:row.draft_id)+'?owner_user_id='+encodeURIComponent(row.user_id),{cacheTtlMs:0,allowStale:false,retries:0});}catch(e){if(!row.local||e.status!==404)throw e;}}
   if(!d.can_resume)throw Error('This draft is not editable with your current access.');
   const principal=cachePrincipal(),fields={...(d.fields||{}),...(row.local?row.snapshot.item:{}),...(d.candidate_id?{candidate_id:d.candidate_id}:{})},uuid=d.candidate_id?'':d.draft_id,key=d.candidate_id||'new:'+uuid;
   const base=fields._draft_base_values||row.snapshot?.baseSnapshot||{};
   const snapshot={...(row.snapshot||{}),candidateId:key,principal,editedAt:Date.now(),item:fields,baseSnapshot:base,baseUpdatedAt:fields._draft_base_updated_at||'',editedFields:row.snapshot?.editedFields||fields,noteBody:d.submitted?(row.snapshot?.noteBody&&row.snapshot.noteBody!==d.note?.body?row.snapshot.noteBody:''):row.local?row.snapshot?.noteBody||'':d.note?.body||'',draftOwner:d.submitted?undefined:d.user_id||row.user_id,draftUpdatedAt:d.updated_at||row.updated_at,draftBaseFields:d.fields||row.snapshot?.draftBaseFields||{},draftBaseNote:d.note||null,...(d.submitted&&row.local&&row.draft_id!==key?{sourceDraftKeys:[...new Set([...(row.snapshot?.sourceDraftKeys||[]),row.draft_id])]}:{})};
   localStorage.setItem(prefix+principal+':'+key,JSON.stringify(snapshot));
   if(!d.candidate_id)localStorage.setItem('cc848-idless-draft:'+principal+':'+key,uuid);
   navigate(d.candidate_id?'/candidate/'+encodeURIComponent(d.candidate_id):'/candidate/new?fresh='+encodeURIComponent(uuid));
  }catch(e){setError(e.message||'Could not open this draft.');}finally{setBusy('');}
 }
 const visible=rows.filter(row=>[row.full_name,row.phone,row.email,row.location,row.preferred_location,row.process,row.qualification,row.course_name,row.owner_name,row.candidate_id,row.note_preview].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 const stamp=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:true})+' IST':'Not synced yet';};
 const salary=value=>String(value??'').trim()?(Number.isFinite(Number(value))?'₹'+Number(value).toLocaleString('en-IN')+' / month':String(value)):'Salary not added';
 const experience=value=>!String(value??'').trim()?'Experience not added':Number(value)===0?'Fresher':'Experience: '+String(value);
 return <Layout title="Drafts"><section className="cc936-drafts cc109-drafts" data-cc926-keep="true">
  <header className="cc936-draft-head"><div><span>YOUR NEXT MOVES</span><h2>{['manager','admin','tl'].includes(user?.role)?'Team Drafts':'My Drafts'}</h2><p>{total} unfinished profiles · Open any row to edit the full profile.</p></div><button type="button" className="ghost-btn" onClick={()=>load()}>Refresh</button></header>
  <label className="cc936-draft-search"><span>Find a draft</span><input aria-label="Search drafts" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name, number, location, process or recruiter…"/><small>{visible.length} shown</small></label>
  {error&&<p role="alert" className="cc936-draft-error">{error}</p>}
  <div className="cc109-draft-table-wrap" tabIndex={0} role="region" aria-label="Draft profiles table">
   <table className="cc109-draft-table"><caption className="sr-only">Unfinished candidate profiles. Open a row to resume editing.</caption><thead><tr><th scope="col">Candidate</th><th scope="col">Contact</th><th scope="col">Location</th><th scope="col">Education / exp.</th><th scope="col">Process & salary</th><th scope="col">Recruiter</th><th scope="col">Last saved</th><th scope="col">Action</th></tr></thead>
   <tbody>{visible.map(row=><tr key={row.user_id+':'+row.draft_id} tabIndex={row.can_resume?0:-1} aria-label={'Open draft: '+(row.full_name||'Untitled draft')} aria-busy={busy===row.draft_id} onClick={()=>row.can_resume&&resume(row)} onKeyDown={e=>{if(e.target===e.currentTarget&&row.can_resume&&['Enter',' '].includes(e.key)){e.preventDefault();resume(row);}}}>
    <td><strong className="cc109-draft-name">{row.full_name||'Untitled draft'}</strong><span className="cc109-draft-kind">{row.candidate_id?row.candidate_id+' · Profile edits':'New profile'}</span>{row.note_preview&&<small className="cc109-draft-note" title={row.note_preview}>{row.note_preview}</small>}</td>
    <td><strong className="cc109-draft-phone">{row.phone||'Add phone number'}</strong><small>{row.email||'Email not added'}</small></td>
    <td><span>{row.location||'Location not added'}</span><small>{row.preferred_location?'Prefers '+row.preferred_location:'Preference not added'}</small></td>
    <td><span>{row.course_name||row.qualification||row.qualification_level||'Education not added'}</span><small>{experience(row.total_experience)}</small></td>
    <td><span>{row.process||'Process not added'}</span><small>{salary(row.in_hand_salary)}</small></td>
    <td><span>{row.owner_name||(String(row.user_id)===String(user?.user_id)?user?.full_name||'You':'Team member')}</span><small>{row.local?'Device copy':'Saved draft'}</small></td>
    <td><time dateTime={row.updated_at}>{stamp(row.updated_at)}</time>{row.status&&<small>{row.status}</small>}</td>
    <td><button type="button" className="cc109-draft-open" disabled={!row.can_resume||!!busy} onClick={e=>{e.stopPropagation();resume(row);}}>{busy===row.draft_id?'Opening…':'Open profile ↗'}</button></td>
   </tr>)}</tbody></table>
  </div>
  {!visible.length&&<div className="cc936-draft-empty">{query?'No loaded drafts match this search.':'All caught up. Your unfinished profiles will appear here.'}</div>}
  {more&&<button type="button" className="ghost-btn" onClick={()=>load(page+1)}>Load more drafts</button>}
 </section></Layout>;
}
