import { CrmDateTimeInput } from '../components/PremiumSelect';
import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import Layout from '../components/Layout';
import {api} from '../lib/api';
import {useAuth} from '../lib/auth';
import {openCandidateProfileInNewTab} from '../lib/candidateNav';
const day=()=>new Date(Date.now()+330*60000).toISOString().slice(0,10),month=()=>day().slice(0,7),money=n=>'₹'+Number(n||0).toLocaleString('en-IN');
const stages=[['will_come_for_interview','Interview','peach'],['appeared_for_interview','Feedback','violet'],['selected','Selected','mint'],['pending_joining','Joining due','amber'],['joined','Joined','green'],['not_joined','Backout','rose'],['rejected','Rejected','rose'],['completed_60_days','60 days','teal']];
const label=s=>stages.find(x=>x[0]===s)?.[1]||s;
// CC86: Dates are stored unchanged; show interview weekday without timezone conversions.
const interviewWeekday=(value)=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(value||''));if(!m)return '';const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));if(d.getUTCFullYear()!==+m[1]||d.getUTCMonth()!==+m[2]-1||d.getUTCDate()!==+m[3])return '';return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getUTCDay()];};
const interviewDateCaption=(value)=>{const weekday=interviewWeekday(value);if(!weekday)return '';const date=String(value).slice(0,10).split('-');return `${weekday} · ${date[2]}-${date[1]}-${date[0]}`;};
const REVENUE_OFFICE_CLIENTS=["1Point1", "Globiva", "Vertex Group", "Eureka", "iEnergizer", "Alturist"];
const REVENUE_OFFICE_LOCATIONS=["Noida Sector 62", "Noida Sector 58", "Noida Sector 127", "Gurgaon Sector 18", "Gurgaon Sector 20", "Gurgaon Sector 17", "Thane, Mumbai", "Navi Mumbai", "Panchkula", "Pune", "Jaipur"];
const initial=()=>({status:'will_come_for_interview',interview_datetime:day()+'T10:00',interview_mode:'Walkin',communication_skill:'Good',experience_range:'Fresher',salary_range:'₹0',submission_date:day(),payout_status:'none',payout_amount:'5000',payout_days:'5',payout_duration_days:'60',invoice_lead_days:'1'});

// CC816: Use a visible native dropdown for presets; never overwrite existing custom values.
const cleanOptions=(items=[])=>[...new Map((Array.isArray(items)?items:[]).map(x=>String(x??'').trim()).filter(Boolean).map(x=>[x.toLowerCase(),x])).values()];
const REVENUE_FORM_PRESETS=Object.freeze({
  preferred_location:REVENUE_OFFICE_LOCATIONS,
  qualification:['12th Pass','Non-Graduate','Graduate','B.A','B.Com','B.Sc','BBA','BCA','B.Tech','MBA','MCA','Other'],
  communication_skill:['Average','Normal','Good','Excellent','More Than Excellent'],
  experience_range:['Fresher','0 - 6 Month','7 - 12 Month','1 - 2 Years','2 - 3 Years','3 - 5 Years','5+ Years'],
  salary_range:['₹0','₹1K - ₹15K','₹15K - ₹20K','₹20K - ₹25K','₹25K - ₹30K','₹30K - ₹40K','₹40K+'],
  payout_amount:['2000','5000','6000','7000','10000'],
  payout_days:['5','7','10','15','30','45','60','90'],
  payout_duration_days:['45','60','90'],
});
function PresetChoice({label,value,options,onChange,allowCustom=true}){
 const [customMode,setCustomMode]=useState(false);
 const values=useMemo(()=>cleanOptions(options),[options]);
 const raw=String(value??'').trim();
 const saved=values.find(v=>v.toLowerCase()===raw.toLowerCase());
 const otherValue=Boolean(raw)&&!saved;
 const showOther=allowCustom&&(customMode||otherValue);
 return <label className="field cc816-preset-field"><span>{label}</span>
   <select aria-label={label} value={showOther?'__cc_custom__':saved||''} onChange={event=>{
     const next=event.target.value;
     if(next==='__cc_custom__'){setCustomMode(true);onChange('');}
     else {setCustomMode(false);onChange(next);}
   }}><option value="">Select {label}</option>{values.map(option=><option value={option} key={option}>{option}</option>)}{allowCustom&&<option value="__cc_custom__">+ Add / type another...</option>}</select>
   {showOther&&<input aria-label={'Type '+label} type="text" autoFocus placeholder={'Type '+label} value={otherValue?raw:''} onChange={event=>onChange(event.target.value)}/>}
 </label>;
}

// CC88: Revenue analysis is computed entirely from the existing authorised
// Revenue Hub response. No extra network request is performed on filter clicks.
const CC88_DIMS=Object.freeze([
  ['client_name','Client'],['recruiter_name','Recruiter'],['process','Process'],
  ['location','Location'],['qualification','Qualification'],['communication_skill','Communication'],
  ['experience_range','Experience'],['salary_range','Salary'],['interview_mode','Interview mode']
]);
const CC88_METRICS=Object.freeze([
  ['interviews','Interviews'],['selected','Selections'],['joined','Joinings'],
  ['retained','Completed 60 days'],['revenue','Earned revenue']
]);
const CC88_DATE_FIELDS=Object.freeze([
  ['interview_date','Interview date'],['selection_date','Selection date'],
  ['joined_date','Actual joining date'],['joining_date','Planned joining date'],
  ['submission_date','Submission date']
]);
const cc88Clean=v=>String(v??'').trim();
const cc88Date=v=>/^\d{4}-\d{2}-\d{2}/.test(String(v||''))?String(v).slice(0,10):'';
const cc88MonthWindow=(offset=0)=>{const now=day();const d=new Date(`${now.slice(0,7)}-01T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()+offset);const start=d.toISOString().slice(0,10);d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);return {start,end:d.toISOString().slice(0,10)};};
const cc88Metric=(row,metric)=>{
  const status=String(row.status||'').toLowerCase();
  const joined=['joined','completed_60_days'].includes(status);
  const selected=Boolean(cc88Date(row.selection_date))||joined||['selected','pending_joining'].includes(status);
  if(metric==='interviews')return cc88Date(row.interview_date||row.interview_datetime)?1:0;
  if(metric==='selected')return selected?1:0;
  if(metric==='joined')return joined?1:0;
  if(metric==='retained')return joined&&Boolean(row.completed_60_days)?1:0;
  if(metric==='revenue')return joined&&row.joined_date?Number(row.recognized_payout||0)||0:0;
  return 0;
};
function cc88Unique(rows){
 const seen=new Map(),conflicted=new Set();let skipped=0;
 const signature=row=>[row.status,row.client_name,row.process,row.recruiter_name,row.payout_amount,row.joined_date,row.payout_status].map(cc88Clean).join('|');
 for(const row of rows||[]){const key=cc88Clean(row.candidate_id)||cc88Clean(row.revenue_id);if(!key){seen.set('row:'+seen.size,row);continue;}
 if(seen.has(key)){skipped++;if(signature(seen.get(key))!==signature(row))conflicted.add(key);}
 else seen.set(key,row);
 }
 return {items:[...seen.entries()].filter(([k])=>!conflicted.has(k)).map(([,v])=>v),skipped,conflicts:conflicted.size};
}
function cc88Rank(rows,dimension,metric){const map=new Map();for(const row of rows||[]){const name=cc88Clean(row[dimension]||(dimension==='location'?row.preferred_location:''))||'Not specified';let item=map.get(name);if(!item){item={label:name,count:0,interviews:0,selected:0,joined:0,retained:0,revenue:0,profiles:[]};map.set(name,item);}item.count+=1;item.profiles.push(row);for(const m of ['interviews','selected','joined','retained','revenue'])item[m]+=cc88Metric(row,m);}return [...map.values()].sort((a,b)=>b[metric]-a[metric]||b.count-a.count||a.label.localeCompare(b.label));}
const cc88SelectOptions=(rows,key,lookups=[])=>cleanOptions([...lookups,...(rows||[]).map(r=>r[key]||(key==='location'?r.preferred_location:''))]).sort((a,b)=>a.localeCompare(b));
const cc88DefaultFilters=()=>({process:'',location:'',qualification:'',communication_skill:'',experience_range:'',salary_range:'',interview_mode:''});

const amountHint=value=>{const n=Number(String(value||'0').replace(/,/g,''));return n>=1e7?(n/1e7).toLocaleString('en-IN',{maximumFractionDigits:2})+' crore rupees':n>=1e5?(n/1e5).toLocaleString('en-IN',{maximumFractionDigits:2})+' lakh rupees':n>=1000?(n/1000).toLocaleString('en-IN',{maximumFractionDigits:2})+' thousand rupees':n.toLocaleString('en-IN')+' rupees';};
const commaAmount=v=>{const raw=String(v);if(!raw)return '';const [whole,fraction]=raw.split('.');const formatted=Number(whole||0).toLocaleString('en-IN',{maximumFractionDigits:0});return raw.includes('.')?formatted+'.'+(fraction||''):formatted;};
const base64=async file=>{const bytes=new Uint8Array(await file.arrayBuffer());let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
function TargetFlow({flow,manager,busy,onSave,joining=false}){
 const [drafts,setDrafts]=useState({}),[search,setSearch]=useState(''),[collapsed,setCollapsed]=useState({});
 const map=useMemo(()=>new Map((flow?.nodes||[]).map(n=>[n.id,n])),[flow]);
 useEffect(()=>setDrafts(previous=>Object.fromEntries(Object.entries(previous).filter(([id,value])=>map.has(id)&&Number(value)!==Number(map.get(id).amount)))),[flow?.revision,flow?.month]);
 if(!flow?.root_id)return <div className="cc828-empty">Choose a month to see your target flow.</div>;
 const matches=id=>{const n=map.get(id);return n&&(n.name.toLowerCase().includes(search.toLowerCase())||n.children.some(matches));};
 const branch=(id,depth=0)=>{const n=map.get(id);if(!n||search&&!matches(id)&&depth>0)return null;const parent=map.get(n.parent_id),editable=(manager||n.role==='recruiter')&&(!parent||parent.children.length>1),changed=drafts[id]!==undefined&&Number(drafts[id])!==Number(n.amount),folded=collapsed[id]&&!search;
 return <li key={id} className={'cc828-flow-branch '+(depth?'':'root')}><article className={'cc828-flow-node '+n.role} data-target-fixed={n.fixed?'true':'false'}><div className="cc836-target-name"><span className="cc828-flow-role">{n.role==='manager'?'Manager':n.role==='tl'?'Team Lead':'Recruiter'}</span><h3>{n.name}</h3></div><label>{joining?'Joining target':'Revenue target'}<input type="text" inputMode={joining?'numeric':'decimal'} aria-label={'Target for '+n.name} value={commaAmount(drafts[id]??n.amount)} disabled={!editable||busy} onChange={e=>{const value=e.target.value.replace(/,/g,'');if((joining?/^\d*$/:/^\d*(?:\.\d{0,2})?$/).test(value))setDrafts(old=>({...old,[id]:value}));}} onKeyDown={e=>{if(e.key==='Enter'&&changed){e.preventDefault();onSave(id,drafts[id]);}}}/></label><small className="cc831-amount-hint">{joining?`${n.earned||0} joined · ${Math.max(0,Number(drafts[id]??n.amount)-Number(n.earned||0))} remaining`:amountHint(drafts[id]??n.amount)}</small><div className="cc828-flow-progress"><span style={{width:Math.min(100,n.percent||0)+'%'}}/></div><div className="cc828-flow-earned"><span>{joining?Number(n.earned||0)+' joined':money(n.earned)+' earned'}</span><b>{n.percent||0}%</b></div><div className="cc836-target-actions">{editable&&<button type="button" className="cc828-balance-btn" disabled={!changed||busy||drafts[id]===''} onClick={()=>onSave(id,drafts[id])}>{busy?'Saving…':'Save target'}</button>}{n.fixed&&<button type="button" className="cc836-target-unlock" disabled={!editable||busy} onClick={()=>onSave(id,n.amount,true)} title="Allow this target to rebalance">Fixed · Unlock</button>}{!n.fixed&&depth>0&&<span className="cc836-target-auto">Auto balance</span>}{n.children.length>0&&depth>0&&<button type="button" aria-expanded={!folded} className="cc836-target-fold" onClick={()=>setCollapsed(old=>({...old,[id]:!old[id]}))}>{folded?'Show':'Hide'} team · {n.children.length}</button>}</div></article>{n.children?.length>0&&!folded&&<ul className="cc828-flow-children">{n.children.map(child=>branch(child,depth+1))}</ul>}</li>;};
 return <div className="cc836-target-flow"><div className="cc836-target-toolbar"><input type="search" aria-label={joining?'Search joining targets':'Search revenue targets'} placeholder="Find an employee…" value={search} onChange={e=>setSearch(e.target.value)}/><span>Saved targets stay fixed. Auto targets share the remainder.</span></div><div className="cc828-flow-scroll"><ul className="cc828-flow-tree">{branch(flow.root_id)}</ul></div></div>;
}

export default function RevenueHubPage(){
 const {user}=useAuth(),role=String(user?.role||'').toLowerCase(),lead=['tl','manager','admin'].includes(role),manager=['manager','admin'].includes(role);
 const [data,setData]=useState({items:[],cards:{},summary:{},targets:[],client_rules:[],lookups:{}}),[query,setQuery]=useState(''),[status,setStatus]=useState(''),[client,setClient]=useState(''),[recruiter,setRecruiter]=useState(''),[reportMonth,setReportMonth]=useState(month()),[tab,setTab]=useState('pipeline');
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[form,setForm]=useState(null),[search,setSearch]=useState(''),[found,setFound]=useState([]),[resume,setResume]=useState(null),[target,setTarget]=useState({}),[rule,setRule]=useState({client_name:'',payout_amount:5000,payout_days:5,payout_duration_days:60,invoice_lead_days:1});
 const [destination,setDestination]=useState(()=>localStorage.getItem('cc810_pipeline_share_destination')||'7836095291'),[destinationType,setDestinationType]=useState(()=>localStorage.getItem('cc810_pipeline_share_type')||'number');
 
const [page,setPage]=useState(0);
const [advancedFilters,setAdvancedFilters]=useState(false);
const [extraFilters,setExtraFilters]=useState(cc88DefaultFilters);
const [dateBasis,setDateBasis]=useState('interview_date');
const [dateStart,setDateStart]=useState(''),[dateEnd,setDateEnd]=useState('');
const [rankDimension,setRankDimension]=useState(lead?'client_name':'recruiter_name');
const [rankMetric,setRankMetric]=useState('selected');
const [rankFocus,setRankFocus]=useState('');
const lastRevenueLoad=useRef(0),targetMonthRef=useRef(month()),destinationDefaults=useRef(false);
const [datePreset,setDatePreset]=useState('all');
 const active=useRef(true),searchSeq=useRef(0),reminderOpened=useRef(false);
 useEffect(()=>setPage(0),[status,client,recruiter,query,extraFilters,dateStart,dateEnd,dateBasis]);
 async function load(force=false){try{const result=await api.get('/api/revenue-hub?target_month='+encodeURIComponent(targetMonthRef.current),{cacheTtlMs:force?0:90000,allowStale:!force,timeoutMs:20000,retries:0});if(active.current){setData(result);if(!destinationDefaults.current){destinationDefaults.current=true;setDestination(result.share_default?.value||'7836095291');setDestinationType(result.share_default?.type||'number');}lastRevenueLoad.current=Date.now();}}catch(e){if(active.current)setMessage(e.message);}}
 useEffect(()=>{active.current=true;load();const changed=e=>{if(/revenue|flowchart|candidate/.test(e.detail?.path||e.detail?.source||''))load(true);};const onFocus=()=>{if(document.visibilityState==='visible'&&Date.now()-lastRevenueLoad.current>120000)load();};window.addEventListener('career-crox-data-written',changed);window.addEventListener('career-crox-manager-reminder-dirty',changed);window.addEventListener('focus',onFocus);return()=>{active.current=false;window.removeEventListener('career-crox-data-written',changed);window.removeEventListener('career-crox-manager-reminder-dirty',changed);window.removeEventListener('focus',onFocus);};},[]);
 useEffect(()=>{if(!form||form.revenue_id)return;const seq=++searchSeq.current,t=setTimeout(()=>{if(search.trim().length<2){setFound([]);return;}api.get('/api/revenue-hub/candidate-search?q='+encodeURIComponent(search),{cacheTtlMs:15000}).then(r=>{if(seq===searchSeq.current)setFound(r.items||[]);}).catch(e=>setMessage(e.message));},180);return()=>clearTimeout(t);},[search,!!form]);
 useEffect(()=>{if(reminderOpened.current)return;const cid=new URLSearchParams(window.location.search).get('candidate');const row=(data.items||[]).find(r=>String(r.candidate_id)===String(cid));if(cid&&row){reminderOpened.current=true;edit(row);}},[data.items]);
 
const visibleRows=useMemo(()=>cc88Unique(data.items||[]),[data.items]);
const scopedRows=useMemo(()=>visibleRows.items.filter(r=>{
  if(client&&r.client_name!==client)return false;
  if(recruiter&&r.recruiter_name!==recruiter)return false;
  if(query&&!['full_name','phone','candidate_id','process','client_name','location','qualification'].some(key=>String(r[key]||'').toLowerCase().includes(query.toLowerCase())))return false;
  for(const [key,val] of Object.entries(extraFilters))if(val&&cc88Clean(r[key]||(key==='location'?r.preferred_location:''))!==val)return false;
  const date=cc88Date(r[dateBasis]||(dateBasis==='interview_date'?r.interview_datetime:''));
  if((dateStart||dateEnd)&&(!date||(dateStart&&date<dateStart)||(dateEnd&&date>dateEnd)))return false;
  return true;
}),[visibleRows.items,client,recruiter,query,extraFilters,dateBasis,dateStart,dateEnd]);
const rows=useMemo(()=>status?scopedRows.filter(r=>r.status===status):scopedRows,[scopedRows,status]);
const ranks=useMemo(()=>cc88Rank(rows,rankDimension,rankMetric),[rows,rankDimension,rankMetric]);
const rankSelected=ranks.find(x=>x.label===rankFocus)||ranks[0];
 const missingSelectionDates=useMemo(()=>visibleRows.items.filter(r=>cc88Metric(r,'selected')&&!cc88Date(r.selection_date)).length,[visibleRows.items]);
const scopedCounts=useMemo(()=>Object.fromEntries(stages.map(([key])=>[key,scopedRows.filter(r=>r.status===key).length])),[scopedRows]);
const scopedTotals=useMemo(()=>({interviews:rows.reduce((s,r)=>s+cc88Metric(r,'interviews'),0),selected:rows.reduce((s,r)=>s+cc88Metric(r,'selected'),0),joined:rows.reduce((s,r)=>s+cc88Metric(r,'joined'),0),retained:rows.reduce((s,r)=>s+cc88Metric(r,'retained'),0),revenue:rows.reduce((s,r)=>s+cc88Metric(r,'revenue'),0)}),[rows]);
const rankHighlights=useMemo(()=>[
  ['Top client · Selections','client_name','selected'],['Top client · Joinings','client_name','joined'],
  ['Top recruiter · Selections','recruiter_name','selected'],['Top location · Selections','location','selected'],
  ['Top communication · Selections','communication_skill','selected']
].filter(([,field])=>lead||field!=='client_name').map(([title,field,metric])=>({title,metric,top:cc88Rank(rows,field,metric).find(x=>x[metric]>0)})),[rows,lead]);
const resetRevenueFilters=()=>{setQuery('');setStatus('');setClient('');setRecruiter('');setExtraFilters(cc88DefaultFilters());setDateStart('');setDateEnd('');setDatePreset('all');setDateBasis('interview_date');setRankFocus('');};
const applyDateWindow=kind=>{setDatePreset(kind);const now=day();const start=cc88MonthWindow();if(kind==='all'){setDateStart('');setDateEnd('');}else if(kind==='month'){setDateStart(start.start);setDateEnd(start.end);}else if(kind==='last_month'){const prev=cc88MonthWindow(-1);setDateStart(prev.start);setDateEnd(prev.end);}else if(kind==='two_months'){setDateStart(cc88MonthWindow(-1).start);setDateEnd(start.end);}else if(kind==='today'){setDateStart(now);setDateEnd(now);}};
const dimLabel=CC88_DIMS.find(([key])=>key===rankDimension)?.[1]||'Group';
const metricLabel=CC88_METRICS.find(([key])=>key===rankMetric)?.[1]||'Count';
 const field=(key,value)=>setForm(f=>{
   if(key==='client_name'&&!f.revenue_id){
     const rule=(data.client_rules||[]).find(item=>String(item.client_name||'').trim().toLowerCase()===String(value).trim().toLowerCase());
     return {...f,client_name:value,...(rule?{
       payout_amount:String(rule.payout_amount??f.payout_amount??''),
       payout_days:String(rule.payout_days??f.payout_days??'5'),
       payout_duration_days:String(rule.payout_duration_days??f.payout_duration_days??'60'),
       invoice_lead_days:String(rule.invoice_lead_days??f.invoice_lead_days??'1'),
     }:{} )};
   }
   return {...f,[key]:value};
 });
 function defaultDestination(){setDestinationType(data.share_default?.type||'number');setDestination(data.share_default?.value||'7836095291');}
 function edit(row){defaultDestination();setForm({...initial(),...row,payout_amount:row.payout_amount??'5000',payout_duration_days:row.payout_duration_days||'60',preferred_location:row.location||row.preferred_location||'',qualification:row.qualification||'Non-Graduate'});setResume(null);setSearch('');setFound([]);}
 function choose(c){setForm(f=>({...f,candidate_id:c.candidate_id,full_name:c.full_name,phone:c.phone||c.number,email:c.email||'',preferred_location:c.preferred_location||c.location||'',qualification:c.qualification||c.qualification_level||'Non-Graduate',client_name:lead?(c.client_name||c.company_name||''):'',recruiter_id:c.recruiter_id||c.recruiter_code||'',recruiter_user_id:c.recruiter_user_id||'',recruiter_name:c.recruiter_name||'',tl_id:c.tl_id||'',tl_name:c.tl_name||'',project_id:c.project_id||'',interview_datetime:(c.interview_reschedule_date||c.interview_date||day()+'T10:00').replace(' ','T').slice(0,16),interview_mode:c.virtual_onsite||'Walkin',submission_date:(c.submission_date||day()).slice(0,10),process:c.process||'',communication_skill:c.communication_skill||'Good',experience_range:c.relevant_experience_range||'Fresher',salary_range:c.relevant_in_hand_range||'₹0'}));setFound([]);setSearch(c.full_name||'');}
 async function attach(file){if(!file)return;if(file.size>6*1024*1024){setMessage('Choose a resume up to 6 MB.');return;}setResume(file);setBusy(true);try{const r=await api.post('/api/candidates/resume-autofill',{name:file.name,mime_type:file.type,content_base64:await base64(file)},{retries:0,timeoutMs:45000});const f=r.fields||{};setForm(old=>({...old,email:f.email||old.email,preferred_location:f.location||old.preferred_location,qualification:f.qualification||old.qualification}));setMessage('Original resume attached. Review extracted details; the file stays only in this tab.');}catch(e){setMessage(e.message+' · Your file is still attached.');}finally{setBusy(false);}}
 const draft=form?['Hi Team, our candidate has reached.','', 'Candidate: '+(form.full_name||''),'Phone: '+(form.phone||''),'Email: '+(form.email||''),'Process: '+(form.process||''),'Interview: '+(form.interview_datetime||'').replace('T',' '),'Interview mode: '+(form.interview_mode==='Walkin'?'Walk-in':form.interview_mode||'Walk-in'),'Recruiter ID: '+(form.recruiter_id||form.recruiter_code||user?.recruiter_code||''),'','*Career Crox*','TL ID: '+(form.tl_id||'Pending assignment')].join('\n'):'';
 async function shareFiles(){try{if(!resume)return;if(navigator.share&&navigator.canShare?.({files:[resume]})){await navigator.share({title:'Career Crox · '+form.full_name,text:draft,files:[resume]});setMessage('Share panel opened. Choose the recipient and send.');}else setMessage('Attach the selected local resume from WhatsApp. This browser cannot share files.');}catch(e){if(e.name!=='AbortError')setMessage(e.message);}}
 async function inform(){try{if(!form?.candidate_id)throw Error('Select a candidate first.');if(!destination)throw Error('Enter a WhatsApp number or group invite link.');const url=destinationType==='group'?destination:'https://wa.me/'+(destination.replace(/\D/g,'').length===10?'91':'')+destination.replace(/\D/g,'')+'?text='+encodeURIComponent(draft);if(destinationType==='group'&&!/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+$/.test(destination))throw Error('Use a WhatsApp group invite link.');if(destinationType==='number'&&!/^[0-9 +]{10,16}$/.test(destination))throw Error('Enter a valid phone number.');const win=window.open(url,'_blank','noopener,noreferrer');try{await navigator.clipboard?.writeText(draft);}catch{}localStorage.setItem('cc810_pipeline_share_destination',destination);localStorage.setItem('cc810_pipeline_share_type',destinationType);setMessage(destinationType==='group'?'Group link opened. Paste the copied arrival message and attach your local resume.':'Candidate arrival chat opened with the message. Attach your selected resume, then Send.');void api.post('/api/revenue-hub/share-opened',{candidate_id:form.candidate_id},{retries:0}).catch(e=>setMessage('Chat opened; team notice failed: '+e.message));}catch(e){setMessage(e.message);}}

 async function save(andInform=false){if(!form?.candidate_id){setMessage('Select a CRM candidate first.');return;}setBusy(true);try{const path=form.revenue_id?'/api/revenue-hub/'+encodeURIComponent(form.revenue_id)+'/status':'/api/revenue-hub/add-candidate';const result=await api.post(path,form,{retries:0,allowStale:false});setForm(f=>({...f,...result.item}));setMessage('Candidate saved.');load(true);if(andInform)await inform();else{setForm(null);setResume(null);}}catch(e){setMessage(e.message);}finally{setBusy(false);}}
 async function configure(payload){setBusy(true);try{await api.post('/api/revenue-hub/config',payload,{retries:0});setMessage('Saved.');await load(true);}catch(e){setMessage(e.message);}finally{setBusy(false);}}
 function exportReport(){if(!manager)return;const report=rows.map(r=>{const out={candidate_id:r.candidate_id,name:r.full_name,phone:r.phone,email:r.email,client:r.client_name,process:r.process,recruiter:r.recruiter_name,status:label(r.status),interview:r.interview_datetime,selection:r.selection_date,joining:r.joining_date,joined:r.joined_date,notes:r.notes};if(lead)Object.assign(out,{recognized_revenue:['joined','completed_60_days'].includes(r.status)?Number(r.payout_amount||0):0,payout_amount:r.payout_amount,payout_status:r.payout_status,payout_due:r.payout_due_date});return out;});window.CC787Backup.save(window.CC787Backup.excelSheets([{name:'Monthly report',rows:report}]),'Revenue_Hub_Filtered_'+(dateStart||'all')+'_'+(dateEnd||'all')+'.xlsx');}
 const formOptions=useMemo(()=>({
   client_name:lead?cleanOptions(data.lookups?.clients?.length?data.lookups.clients:REVENUE_OFFICE_CLIENTS):[],
   process:[...(data.lookups?.processes||[]),...(data.items||[]).flatMap(x=>String(x.process||'').split(','))],
   preferred_location:cleanOptions(data.lookups?.locations?.length?data.lookups.locations:REVENUE_OFFICE_LOCATIONS),
   qualification:[...REVENUE_FORM_PRESETS.qualification,...(data.items||[]).map(x=>x.qualification)],
   communication_skill:[...REVENUE_FORM_PRESETS.communication_skill,...(data.lookups?.communication_skills||[])],
   experience_range:[...REVENUE_FORM_PRESETS.experience_range,...(data.items||[]).map(x=>x.experience_range)],
   salary_range:[...REVENUE_FORM_PRESETS.salary_range,...(data.items||[]).map(x=>x.salary_range)],
   payout_amount:REVENUE_FORM_PRESETS.payout_amount,
   payout_days:REVENUE_FORM_PRESETS.payout_days,
   payout_duration_days:REVENUE_FORM_PRESETS.payout_duration_days,
 }),[data.items,data.lookups,data.client_rules]);
 const summary=data.summary||{},flowRoot=data.target_flow?.nodes?.find(n=>n.id===data.target_flow.root_id),targetView=tab==='targets'&&flowRoot,goal=targetView?flowRoot.amount:lead?summary.month_target:summary.joining_target,achieved=targetView?flowRoot.earned:lead?summary.month_income:summary.month_joined,headerPercent=targetView?flowRoot.percent:summary.month_achievement_percent;
 return <Layout title="Revenue Hub">
 <header className="cc814-revenue-hero"><div><span className="cc814-eyebrow">REVENUE STUDIO</span><h1>Revenue Hub</h1><div className="cc814-progress"><span style={{width:Math.min(100,Number(headerPercent||0))+'%'}}/></div><p>{lead?money(achieved):Number(achieved||0)+' joinings'} of {lead?money(goal):Number(goal||0)+' joinings'} · {Number(headerPercent||0)}%</p></div><button className="add-profile-btn" onClick={()=>{defaultDestination();setForm(initial());setResume(null);setSearch('');}}>＋ Add candidate</button></header>
 <div className="cc831-joining-cards"><div><strong>{summary.joining_target||0}</strong><span>Joining target</span></div><div><strong>{summary.personal_month_joined??summary.month_joined??0}</strong><span>Achieved</span></div><div><strong>{summary.joining_remaining||0}</strong><span>Remaining</span></div></div>
 <nav className="cc814-tabs">{['pipeline','analytics','leaderboard',...(lead?['targets','client rules']:[])].map(t=><button key={t} className={tab===t?'active':''} onClick={()=>setTab(t)}>{t}</button>)}</nav>
 <div className="cc814-metrics">{(targetView?[['Joinings · '+data.target_month,flowRoot.joined,'green'],['Revenue · '+data.target_month,money(flowRoot.earned),'mint'],['Monthly budget',money(flowRoot.amount),'violet'],['Achievement',Number(flowRoot.percent||0)+'%','sky']]:[['Interviews',data.cards?.will_come_for_interview,'peach'],['Feedback',data.cards?.appeared_for_interview,'violet'],['Selected now',data.cards?.selected,'mint'],['Joined this month',summary.month_joined,'green'],...(lead?[['Revenue this month',money(summary.month_income),'amber'],['Cash received',money(summary.month_cash_received),'teal']]:[])]).map(([name,value,tone])=><div key={name} className={'stat-card cc828-stat cc814-metric '+tone}><small>{name}</small><strong>{value||0}</strong></div>)}</div>
 {message&&<div className="cc814-status" role="status">{message}<button onClick={()=>setMessage('')} aria-label="Dismiss">×</button></div>}
 
{['pipeline','analytics','leaderboard'].includes(tab)&&<section className="panel cc88-filter-panel" aria-label="Revenue Hub filters">
  <div className="cc88-filter-top">
    <label>Search <input aria-label="Search revenue candidates" type="search" placeholder="Name, phone, candidate ID, client, process…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    {lead&&<label>Client <select aria-label="Revenue client filter" value={client} onChange={e=>setClient(e.target.value)}><option value="">All clients</option>{cc88SelectOptions(data.items,'client_name',data.lookups?.clients).map(v=><option key={v} value={v}>{v}</option>)}</select></label>}
    <label>Recruiter <select aria-label="Revenue recruiter filter" value={recruiter} onChange={e=>setRecruiter(e.target.value)}><option value="">All recruiters</option>{cc88SelectOptions(data.items,'recruiter_name',data.lookups?.recruiters).map(v=><option key={v} value={v}>{v}</option>)}</select></label>
    <button type="button" className="ghost-btn" onClick={()=>setAdvancedFilters(v=>!v)} aria-expanded={advancedFilters}>{advancedFilters?'Hide filters':'More filters'} ▾</button>
    <button type="button" className="ghost-btn" onClick={resetRevenueFilters}>Reset all</button>
    <button type="button" className="ghost-btn" onClick={()=>load(true)}>↻ Manual Refresh</button>
  </div>
  <div className="cc88-date-filters">
    <label>Date based on <select aria-label="Date type for revenue analysis" value={dateBasis} onChange={e=>setDateBasis(e.target.value)}>{CC88_DATE_FIELDS.map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <label>From <input type="date" aria-label="Revenue from date" value={dateStart} max={dateEnd||undefined} onChange={e=>{setDateStart(e.target.value);setDatePreset('custom');}}/></label>
    <label>To <input type="date" aria-label="Revenue to date" value={dateEnd} min={dateStart||undefined} onChange={e=>{setDateEnd(e.target.value);setDatePreset('custom');}}/></label>
    <div className="cc88-date-quick"><button type="button" className={datePreset==='all'?'active':''} aria-pressed={datePreset==='all'} onClick={()=>applyDateWindow('all')}>All dates</button><button type="button" className={datePreset==='month'?'active':''} aria-pressed={datePreset==='month'} onClick={()=>applyDateWindow('month')}>This month</button><button type="button" className={datePreset==='last_month'?'active':''} aria-pressed={datePreset==='last_month'} onClick={()=>applyDateWindow('last_month')}>Last month</button><button type="button" className={datePreset==='two_months'?'active':''} aria-pressed={datePreset==='two_months'} onClick={()=>applyDateWindow('two_months')}>Last 2 months</button></div>
  </div>
  {advancedFilters&&<div className="cc88-advanced">{[
    ['process','Process','processes'],['location','Location','locations'],['qualification','Qualification',''],
    ['communication_skill','Communication','communication_skills'],['experience_range','Experience','experience_ranges'],
    ['salary_range','Salary','salary_ranges'],['interview_mode','Interview mode','']
  ].map(([key,name,lookup])=><label key={key}>{name}<select aria-label={'Filter by '+name} value={extraFilters[key]||''} onChange={e=>setExtraFilters(f=>({...f,[key]:e.target.value}))}><option value="">All {name.toLowerCase()}</option>{cc88SelectOptions(data.items,key,data.lookups?.[lookup]).map(v=><option key={v}>{v}</option>)}</select></label>)}</div>}
  <div className="cc88-filter-meta"><strong>{rows.length}</strong> matching profiles · {dateStart||dateEnd?`${dateStart||'Start'} → ${dateEnd||'Today'}`:'All dates'} · Using {CC88_DATE_FIELDS.find(([key])=>key===dateBasis)?.[1]}{visibleRows.skipped>0?` · ${visibleRows.skipped} duplicate rows excluded`:''}{visibleRows.conflicts>0?` · ${visibleRows.conflicts} conflicting records withheld for review`:''}</div>
  {(dateStart||dateEnd)&&<div className="cc88-date-note">Only records with a saved {CC88_DATE_FIELDS.find(([key])=>key===dateBasis)?.[1].toLowerCase()} in this range are counted. Missing dates are excluded, never guessed.{dateBasis==='selection_date'&&missingSelectionDates>0?` ${missingSelectionDates} selection records have no saved selection date.`:''}</div>}
</section>}
{['pipeline','analytics','leaderboard'].includes(tab)&&<div className="cc88-filter-stats" aria-label="Revenue filtered totals">{[
  ['Interviews',scopedTotals.interviews],['Selections',scopedTotals.selected],['Selection rate',scopedTotals.interviews?Math.round(scopedTotals.selected/scopedTotals.interviews*100)+'%':'0%'],['Joinings',scopedTotals.joined],['Retained 60 days',scopedTotals.retained],...(lead?[['Earned revenue',money(scopedTotals.revenue)]]:[])
].map(([name,value])=><div className="cc88-filter-stat" key={name}><small>{name}</small><strong>{value}</strong></div>)}</div>}

 {tab==='pipeline'&&<section className="panel cc814-data-panel"><div className="cc814-stage-pills"><button className={!status?'active':''} onClick={()=>setStatus('')}>All · {scopedRows.length}</button>{stages.map(([key,name,tone])=><button key={key} className={tone+(status===key?' active':'')} onClick={()=>setStatus(status===key?'':key)}>{name} <b>{scopedCounts[key]||0}</b></button>)}</div><div className="table-scroll"><table className="cc814-table"><thead><tr>{['Candidate',lead?'Client / process':'Process','Recruiter','Interview','Joining','Status',...(lead?['Payout']:[]),''].map((v,i)=><th key={i}>{v}</th>)}</tr></thead><tbody>{rows.slice(page*100,(page+1)*100).map(r=><tr key={r.revenue_id} className="cc815-clickable-row" role="button" tabIndex={0} title="Open candidate profile" onClick={()=>openCandidateProfileInNewTab(r,rows.slice(page*100,(page+1)*100),{sourceKind:'revenue',sourcePath:window.location.pathname+window.location.search,hasMore:false})} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCandidateProfileInNewTab(r,rows.slice(page*100,(page+1)*100),{sourceKind:'revenue',sourcePath:window.location.pathname+window.location.search,hasMore:false});}}}><td><strong className="cc814-text-action">{r.full_name}</strong><small>{r.phone}</small></td><td>{lead?r.client_name:r.process}{lead&&<small>{r.process}</small>}</td><td>{r.recruiter_name}</td><td>{(r.interview_datetime||'').replace('T',' ')}{interviewWeekday(r.interview_datetime)&&<small>{interviewWeekday(r.interview_datetime)}</small>}</td><td>{r.joined_date||r.joining_date||'—'}</td><td><span className={'cc814-badge '+(stages.find(s=>s[0]===r.status)?.[2]||'')}>{label(r.status)}</span></td>{lead&&<td>{money(r.recognized_payout)}<small>{r.payout_status==='payout_received'&&!'joined,completed_60_days'.split(',').includes(r.status)?'Backout · refund review':!'joined,completed_60_days'.split(',').includes(r.status)?'Not earned':r.payout_status==='payout_received'?'Received':r.payout_pending?'Action due':'Pending'}</small></td>}<td><button className="ghost-btn" onClick={e=>{e.stopPropagation();edit(r);}}>Update</button></td></tr>)}</tbody></table>{!rows.length&&<div className="cc814-empty">No candidates in this view. Add one or change the filters.</div>}</div><div className="cc814-toolbar">{manager&&<><span className="cc88-filter-meta">Export visible records</span><button className="add-profile-btn" onClick={exportReport}>↓ Export Excel</button></>}<button className="ghost-btn" disabled={!page} onClick={()=>setPage(p=>p-1)}>Previous</button><span>{page+1} / {Math.max(1,Math.ceil(rows.length/100))}</span><button className="ghost-btn" disabled={(page+1)*100>=rows.length} onClick={()=>setPage(p=>p+1)}>Next</button><span>{rows.length} profiles · active filters apply</span></div></section>}
 {['analytics','leaderboard'].includes(tab)&&<section className="panel cc88-analysis" aria-label="Revenue analytics and leaderboard">
  <header className="cc88-analysis-header"><h2>{tab==='analytics'?'Revenue Analytics':'Revenue Leaderboard'}</h2><span>Rankings use the same filtered candidates and selected date range.</span></header>
  {tab==='analytics'&&<div className="cc88-top-cards">{rankHighlights.map(({title,top,metric})=><button type="button" key={title} className="cc88-top-card" onClick={()=>{const dimension=title.includes('recruiter')?'recruiter_name':title.includes('location')?'location':title.includes('communication')?'communication_skill':'client_name';setRankDimension(dimension);setRankMetric(metric);setRankFocus(top?.label||'');}}><small>{title}</small><strong>{top?.label||'No matching data'}</strong><span>{top?`${top[metric]} ${metric==='selected'?'selections':'joinings'}`:'0 records'}</span></button>)}</div>}
  <div className="cc88-rank-controls"><label>Rank by <select aria-label="Revenue leaderboard group by" value={rankDimension} onChange={e=>{setRankDimension(e.target.value);setRankFocus('');}}>{CC88_DIMS.filter(([key])=>lead||key!=='client_name').map(([key,name])=><option value={key} key={key}>{name}</option>)}</select></label><label>Compare <select aria-label="Revenue leaderboard metric" value={rankMetric} onChange={e=>setRankMetric(e.target.value)}>{CC88_METRICS.filter(([key])=>lead||key!=='revenue').map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label><span>{ranks.length} {dimLabel.toLowerCase()} groups</span></div>
  <div className="cc88-leaderboard-list"><table className="cc88-rank-table"><thead><tr><th>Rank</th><th>{dimLabel}</th><th>{metricLabel}</th><th>Interviews</th><th>Selections</th><th>Joinings</th><th>Profiles</th></tr></thead><tbody>{ranks.map((r,i)=><tr key={r.label} className={rankSelected?.label===r.label?'cc88-rank-active':''} onClick={()=>setRankFocus(r.label)} role="button" tabIndex={0} onKeyDown={e=>{if(e.key==='Enter')setRankFocus(r.label);}}><td>#{i+1}</td><td><strong>{r.label}</strong></td><td><strong>{rankMetric==='revenue'?money(r.revenue):r[rankMetric]}</strong></td><td>{r.interviews}</td><td>{r.selected}</td><td>{r.joined}</td><td>{r.count}</td></tr>)}{!ranks.length&&<tr><td colSpan={7}>No records match these filters. Change date type or date range.</td></tr>}</tbody></table></div>
  {rankSelected&&<div className="cc88-rank-details"><h3>{rankSelected.label} · {rankSelected.profiles.length} profiles</h3><p>Complete candidate list for the selected {dimLabel.toLowerCase()}. Click a row to open the CRM profile.</p><div className="cc88-leaderboard-list"><table className="cc88-rank-table"><thead><tr><th>Candidate</th><th>{lead?'Client':'Process'}</th><th>Recruiter</th><th>Interview</th><th>Selection</th><th>Joined</th><th>Status</th></tr></thead><tbody>{rankSelected.profiles.map((r,i)=><tr key={r.revenue_id||r.candidate_id||i} role="button" tabIndex={0} onClick={()=>openCandidateProfileInNewTab(r,rankSelected.profiles,{sourceKind:'revenue-rank',sourcePath:window.location.pathname+window.location.search,hasMore:false})} onKeyDown={e=>{if(e.key==='Enter')openCandidateProfileInNewTab(r,rankSelected.profiles,{sourceKind:'revenue-rank',sourcePath:window.location.pathname+window.location.search,hasMore:false});}}><td>{r.full_name}<small>{r.candidate_id}</small></td><td>{(lead?r.client_name:r.process)||'—'}</td><td>{r.recruiter_name||'—'}</td><td>{cc88Date(r.interview_date||r.interview_datetime)||'—'}</td><td>{cc88Date(r.selection_date)||'—'}</td><td>{cc88Date(r.joined_date)||'—'}</td><td>{label(r.status)}</td></tr>)}</tbody></table></div></div>}
</section>}
  {tab==='targets'&&lead&&<section className="panel cc828-target-panel"><header className="cc828-section-head"><div><h2>Monthly target flow</h2><span>Set each target once. Saved targets stay fixed as you work down the team.</span></div><label>Month<input type="month" value={data.target_month||reportMonth} onChange={e=>{if(!e.target.value)return;targetMonthRef.current=e.target.value;setReportMonth(e.target.value);load(true);}}/></label></header><TargetFlow flow={data.target_flow} manager={manager} busy={busy} onSave={(id,amount,release_fixed=false)=>configure({release_fixed,type:'target_flow',month:data.target_month,user_id:id,amount,expected_revision:data.target_flow?.revision})}/><div className="cc831-joining-tree"><h2>Monthly joining flow</h2><TargetFlow joining flow={data.joining_flow} manager={manager} busy={busy} onSave={(id,amount,release_fixed=false)=>configure({release_fixed,type:'joining_flow',month:data.target_month,user_id:id,amount,expected_revision:data.joining_flow?.revision})}/></div></section>}
 {tab==='client rules'&&lead&&<section className="panel"><h2>Client payment terms</h2><div className="cc814-form-grid"><PresetChoice label="Client" value={rule.client_name} options={formOptions.client_name} onChange={v=>setRule(r=>({...r,client_name:v}))}/>
  <PresetChoice label="Payout per joining (₹)" value={rule.payout_amount} options={REVENUE_FORM_PRESETS.payout_amount} onChange={v=>setRule(r=>({...r,payout_amount:v}))} allowCustom={false}/>
  <PresetChoice label="Payment after joining · days" value={rule.payout_days} options={REVENUE_FORM_PRESETS.payout_days} onChange={v=>setRule(r=>({...r,payout_days:v}))} allowCustom={false}/>
  <PresetChoice label="Payout duration · days" value={rule.payout_duration_days??60} options={REVENUE_FORM_PRESETS.payout_duration_days} onChange={v=>setRule(r=>({...r,payout_duration_days:v}))} allowCustom={false}/>
  <PresetChoice label="Invoice reminder · days before" value={rule.invoice_lead_days} options={['0','1','2','3','5']} onChange={v=>setRule(r=>({...r,invoice_lead_days:v}))} allowCustom={false}/></div><button className="add-profile-btn" disabled={busy} onClick={()=>configure({type:'client',...rule})}>Save client terms</button><div className="cc814-ranks">{data.client_rules?.map((r,i)=><button className="cc814-rank peach" key={i} onClick={()=>setRule(r)}><b>{r.client_name}</b><span>{money(r.payout_amount)} · {r.payout_days} days</span></button>)}</div></section>}
 {form&&<div className="modal-backdrop"><section className="cc814-modal" role="dialog" aria-modal="true" aria-label="Revenue candidate"><header><div><small>REVENUE CANDIDATE</small><h2>{form.full_name||'Add a candidate'}</h2></div><button className="ghost-btn" disabled={busy} onClick={()=>{setForm(null);setResume(null);}}>×</button></header><div className="cc814-modal-body"><div className="cc820-resume-start"><label className="field"><span>Upload resume</span><input type="file" accept=".pdf,.doc,.docx,.txt,.rtf" onChange={e=>attach(e.target.files?.[0])}/>{resume&&<small>✓ {resume.name}</small>}</label></div>{!form.revenue_id&&<div className="field"><label>Find candidate · name, phone or serial</label><input autoFocus value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search your visible profiles…"/>{found.map(c=><button key={c.candidate_id} className="cc814-search-result" onClick={()=>choose(c)}><strong>{c.full_name}</strong><span>{c.phone||c.number} · {c.candidate_id}</span></button>)}</div>}<div className="cc814-form-grid">{[
    ['email','Candidate email','email'],
    ...(lead?[['client_name','Client','preset']]:[]),
    ['process','Process','preset'],
    ['interview_datetime','Interview · IST','datetime-local'],
    ['preferred_location','Location','preset'],
    ['qualification','Qualification','preset'],
    ['communication_skill','Communication','preset'],
    ['experience_range','Experience','preset'],
    ['salary_range','Salary range','preset'],
    ['selection_date','Selection date','date'],
    ['joining_date','Planned joining','date'],
    ['joined_date','Actual joining','date'],
    ...(lead?[
      ['payout_amount','Payout per joining (₹)','preset'],
      ['payout_days','Payment after joining · days','preset'],
      ['payout_duration_days','Payout duration · days','preset'],
    ]:[]),
  ].map(([key,name,type])=>type==='preset'
    ?<PresetChoice key={key+'-'+String(form.revenue_id||form.candidate_id||'new')} label={name} value={form[key]} options={formOptions[key]||[]} onChange={value=>field(key,value)} allowCustom={!['payout_amount','payout_days','payout_duration_days'].includes(key)}/>
    :<label className="field" key={key}><span>{name}</span>{type==='datetime-local'?<CrmDateTimeInput type={type} value={form[key]??''} onChange={e=>field(key,e.target.value)}/>:<input type={type} value={form[key]??''} onChange={e=>field(key,e.target.value)}/>}{key==='interview_datetime'&&interviewDateCaption(form[key])&&<small className="cc86-interview-weekday">{interviewDateCaption(form[key])}</small>}</label>
  )}
  <label className="field"><span>Status</span><select value={form.status} onChange={e=>field('status',e.target.value)}>{stages.map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label><label className="field"><span>Interview mode</span><select value={form.interview_mode||'Walkin'} onChange={e=>field('interview_mode',e.target.value)}>{['Walkin','Virtual','Onsite'].map(x=><option key={x}>{x}</option>)}</select></label>{lead&&<><label className="field"><span>Payment</span><select value={form.payout_status||'none'} onChange={e=>field('payout_status',e.target.value)}><option value="none">Not due yet</option><option value="payout_pending">Payout pending</option><option value="payout_received">Payout received</option></select></label><label className="field"><span>Invoice</span><select value={form.invoice_status||'pending'} onChange={e=>field('invoice_status',e.target.value)}><option value="pending">Pending</option><option value="sent">Invoice sent</option></select></label></>}</div><label className="field"><span>Notes / feedback</span><textarea value={form.notes||''} onChange={e=>field('notes',e.target.value)}/></label><div className="cc814-share-box"><div className="cc814-form-grid"><select aria-label="WhatsApp destination type" value={destinationType} onChange={e=>{const type=e.target.value;setDestinationType(type);setDestination(type==='group'?(data.share_default?.type==='group'?data.share_default.value:data.share_group||'https://chat.whatsapp.com/JrY2GbGJtfxHFGgzRSFWSA'):(data.share_default?.type==='number'?data.share_default.value:'7836095291'));}}><option value="group">WhatsApp group</option><option value="number">WhatsApp number</option></select><input aria-label="WhatsApp destination" placeholder={destinationType==='group'?'Group invite link':'10 digit number'} value={destination} onChange={e=>setDestination(e.target.value)}/></div><div className="cc831-owner-strip"><span>Recruiter: {form.recruiter_name||user?.full_name}</span><span>Team lead: {form.tl_name||'Pending assignment'}</span></div>{manager&&<button type="button" className="ghost-btn" onClick={()=>configure({type:'share_default',destination_type:destinationType,destination})}>Set shared default</button>}<pre>{draft}</pre>{resume&&<button type="button" className="ghost-btn" onClick={shareFiles}>Share selected resume</button>}<button className="ghost-btn" onClick={inform}>Share message {resume?'+ resume':''} ↗</button></div></div><footer><button className="ghost-btn" disabled={busy} onClick={()=>save(false)}>Save candidate</button><button className="add-profile-btn" disabled={busy} onClick={()=>save(true)}>{busy?'Saving…':'Save + inform client ↗'}</button></footer></section></div>}
 </Layout>;
}
