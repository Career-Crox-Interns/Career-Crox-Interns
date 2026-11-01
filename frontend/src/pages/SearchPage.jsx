import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SearchCandidateRow } from '../components/HeaderSearch';
import Layout from '../components/Layout';
import { api } from '../lib/api';
export default function SearchPage(){
 const [params]=useSearchParams(),q=params.get('q')||'';
 const [data,setData]=useState({candidates:[],has_more:false}),[error,setError]=useState(''),[loading,setLoading]=useState(false);const epoch=useRef(0);
 useEffect(()=>{const turn=++epoch.current;setLoading(true);setError('');setData({candidates:[],has_more:false});api.get('/api/search?q='+encodeURIComponent(q)+'&candidates_only=1',{headers:{'X-CC-Dashboard-User':'global'}}).then(d=>{if(turn===epoch.current)setData({candidates:Array.isArray(d.candidates)?d.candidates:[],has_more:Boolean(d.has_more)});}).catch(e=>{if(turn===epoch.current)setError(e.message||'Search could not load. Retry this search.');}).finally(()=>{if(turn===epoch.current)setLoading(false);});return()=>{epoch.current++;};},[q]);
 const rows=data.candidates;
 async function more(){if(loading||!data.has_more)return;const turn=epoch.current;setLoading(true);setError('');try{const d=await api.get('/api/search?q='+encodeURIComponent(q)+'&candidates_only=1&offset='+rows.length,{headers:{'X-CC-Dashboard-User':'global'}});if(turn===epoch.current)setData(current=>({candidates:[...current.candidates,...(d.candidates||[]).filter(x=>!current.candidates.some(y=>y.candidate_id===x.candidate_id))],has_more:Boolean(d.has_more)}));}catch(e){if(turn===epoch.current)setError(e.message||'More results could not load. Retry.');}finally{if(turn===epoch.current)setLoading(false);}}

 return <Layout title="Candidate Search"><section className="panel"><div className="panel-title">Candidates <span className="mini-chip">{rows.length}{data.has_more?'+':''} matches</span></div><p className="helper-text">Search by candidate name, phone, email or candidate ID. Your existing access rules apply.</p>{error?<p role="alert">{error}</p>:null}<div className="activity-list">{rows.length?rows.map(row=><SearchCandidateRow key={row.candidate_id} row={row} rows={rows}/>):<p className="helper-text">{loading?'Searching candidates…':'No matching candidate found.'}</p>}</div>{data.has_more?<button className="mini-btn view" type="button" disabled={loading} onClick={more}>{loading?'Loading…':'Load more candidates'}</button>:null}</section></Layout>;
}
