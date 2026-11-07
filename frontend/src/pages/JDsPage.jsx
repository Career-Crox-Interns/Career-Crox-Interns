import {evaluateJdMatch,openJdShareDialog} from '../lib/workspaceHelpers';
import { ActionGlyph } from '../components/EmojiGlyph';
import PremiumSelect from '../components/PremiumSelect';
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { visiblePhone } from '../lib/candidateAccess';
import {readPageCache,writePageCache} from '../lib/persistentPageCache';

const DEGREE_OPTIONS = ['NON - Graduate', 'Graduate'];
const PREFERRED_LOCATIONS = ['Noida', 'Gurgaon', 'Mumbai'];
const COMMUNICATION_OPTIONS = ['Average', 'Good', 'Excellent'];
const CAREER_GAP_OPTIONS = ['Fresher', 'Currently Working', '1 - 3 Month', '4 - 6 Month', '7 - 12 Month', '1 - 1.5 Year', '1.6 - 2 Year'];
const EXPERIENCE_RANGE_OPTIONS = ['Fresher', 'Currently Working', '0-1 year', '1-2 years', '2-3 years', '3-5 years', '5+ years'];
const SALARY_RANGE_OPTIONS = ['0-20k', '20k-30k', '30k-40k', '40k+'];
const DETAILS_SENT_OPTIONS = ['Pending', 'Completed'];
const DOCUMENTS_OPTIONS = ['Yes', 'No', 'Partially', 'Available'];

const DEFAULT_INSTRUCTION_ITEMS = [
  { title: 'Instruction 1', content: 'Explain role, salary, and working days clearly.' },
  { title: 'Instruction 2', content: 'Confirm candidate location comfort and communication level.' },
  { title: 'Instruction 3', content: 'Check salary expectation and relevant experience quickly.' },
  { title: 'Instruction 4', content: 'Tell the next step in one clean line before ending the call.' },
];

const DEFAULT_MATERIAL_ITEMS = [
  { order_no: 1, label: 'Location', message: 'Share office location, nearest landmark, and reporting details here.', link: '' },
  { order_no: 2, label: 'JD Details', message: 'Share short JD details in WhatsApp-ready format here.', link: '' },
  { order_no: 3, label: 'Interview Info', message: 'Share interview steps, date rules, and document checklist here.', link: '' },
];

const EMPTY_FORM = {
  job_title: '',
  company: '',
  process_name: '',
  location: '',
  preferred_location_rule: '',
  qualification_rule: '',
  communication_rule: '',
  career_gap_rule: '',
  documents_rule: '',
  all_details_sent_rule: '',
  relevant_experience_rule: '',
  relevant_salary_rule: '',
  salary_min: '',
  salary_max: '',
  exp_min: '',
  exp_max: '',
  pdf_url: '',
  jd_status: 'Open',
  notes: '',
  salary: '',
  experience: '',
  message_template: 'Hi {candidate_name}, sharing the {jd_name} opportunity. Please review the attached details and confirm if you are interested.',
  instruction_points: '[]',
  send_items: '[]',
  sector:'',pincode:'',qualification_required:'',in_hand_min:'',in_hand_max:'',interview_mode:'Walkin',working_days:'',shift_timing:'',rotational_shift:'',women_shift:'',cab:'',travel_allowance:'',meal:'',incentive:'',process_type:'',role_responsibilities:'',sample_label:'',
};

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBand(value) {
  return lower(value).replace(/[^a-z0-9]+/g, '');
}

function sameish(a, b) {
  const first = normalizeBand(a);
  const second = normalizeBand(b);
  if (!first || !second) return false;
  return first === second || first.includes(second) || second.includes(first);
}

function asNumber(value) {
  const cleaned = String(value || '').replace(/,/g, '');
  const match = cleaned.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function amountFromText(value) {
  const raw = lower(value).replace(/,/g, '');
  const num = asNumber(raw);
  if (!num) return 0;
  if (raw.includes('lpa') || raw.includes('lac') || raw.includes('lakh')) return Math.round((num * 100000) / 12);
  if (raw.includes('k') && num < 1000) return num * 1000;
  return num;
}

function monthsFromText(value) {
  const raw = lower(value);
  const num = asNumber(raw);
  if (!num) return 0;
  if (raw.includes('month')) return Math.round(num);
  if (raw.includes('year') || raw.includes('yr')) return Math.round(num * 12);
  return Math.round(num * 12);
}

function deriveNumericRange(rawValue, minValue, maxValue, mode = 'amount') {
  let min = Number(minValue || 0) || 0;
  let max = Number(maxValue || 0) || 0;
  if (min || max) return { min, max };
  const numbers = String(rawValue || '').match(/\d+(?:\.\d+)?/g) || [];
  if (!numbers.length) return { min: 0, max: 0 };
  const parsed = numbers.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  if (!parsed.length) return { min: 0, max: 0 };
  if (mode === 'months') {
    const raw = lower(rawValue);
    min = parsed[0] || 0;
    max = parsed[1] || parsed[0] || 0;
    if (!raw.includes('month')) {
      min *= 12;
      max *= 12;
    }
    return { min, max };
  }
  min = parsed[0] || 0;
  max = parsed[1] || parsed[0] || 0;
  return { min, max };
}

function parseInstructionItems(value) {
  if (Array.isArray(value)) {
    return value.map((item, idx) => {
      if (typeof item === 'string') return { title: `Instruction ${idx + 1}`, content: item.trim() };
      return {
        title: String(item?.title || `Instruction ${idx + 1}`).trim(),
        content: String(item?.content || item?.message || '').trim(),
      };
    }).filter((item) => item.title || item.content);
  }
  try {
    const parsed = JSON.parse(String(value || '[]'));
    if (Array.isArray(parsed)) return parseInstructionItems(parsed);
  } catch {}
  return String(value || '')
    .split(/\r?\n/)
    .map((item, idx) => ({ title: `Instruction ${idx + 1}`, content: String(item || '').trim() }))
    .filter((item) => item.content);
}

function serializeInstructionItems(items) {
  const clean = parseInstructionItems(items).map((item, idx) => ({
    title: String(item?.title || `Instruction ${idx + 1}`).trim(),
    content: String(item?.content || '').trim(),
  })).filter((item) => item.title || item.content);
  return JSON.stringify(clean);
}

function parseSendItems(value) {
  if (Array.isArray(value)) {
    return value.map((item, idx) => ({
      order_no: Number(item?.order_no || idx + 1),
      label: String(item?.label || `Send Material ${idx + 1}`).trim(),
      message: String(item?.message || item?.content || '').trim(),
      link: String(item?.link || '').trim(),
    })).filter((item) => item.label || item.message || item.link);
  }
  try {
    const parsed = JSON.parse(String(value || '[]'));
    if (Array.isArray(parsed)) return parseSendItems(parsed);
  } catch {}
  return String(value || '')
    .split(/\r?\n/)
    .map((line, idx) => {
      const [label, message, link] = String(line || '').split('|').map((part) => String(part || '').trim());
      if (!label && !message && !link) return null;
      return { order_no: idx + 1, label: label || `Send Material ${idx + 1}`, message: message || '', link: link || '' };
    })
    .filter(Boolean);
}

function serializeSendItems(items) {
  const clean = parseSendItems(items).map((item, idx) => ({
    order_no: idx + 1,
    label: String(item?.label || `Send Material ${idx + 1}`).trim(),
    message: String(item?.message || '').trim(),
    link: String(item?.link || '').trim(),
  })).filter((item) => item.label || item.message || item.link);
  return JSON.stringify(clean);
}

function normalizeCandidateDocs(value) {
  const raw = normalizeBand(value);
  if (raw === 'yes' || raw === 'available') return 'available';
  if (raw === 'partially' || raw === 'partial') return 'partially';
  if (raw === 'no') return 'no';
  return raw;
}

function candidateMatchesMultiRule(candidateValue, ruleValue, mode = 'contains') {
  const candidateValues = Array.isArray(candidateValue) ? candidateValue : [candidateValue];
  const rules = splitCsv(ruleValue);
  if (!rules.length) return true;
  return rules.some((rule) => candidateValues.some((item) => {
    if (!String(item || '').trim()) return false;
    if (mode === 'exact') return sameish(item, rule);
    return sameish(item, rule) || lower(item).includes(lower(rule)) || lower(rule).includes(lower(item));
  }));
}

function qualifies(candidate,jd){return evaluateJdMatch(candidate,jd);}

function interpolate(template, candidate, jd) {
  return String(template || '')
    .replaceAll('{candidate_name}', candidate?.full_name || 'Candidate')
    .replaceAll('{candidate_number}', candidate?.phone || '')
    .replaceAll('{jd_name}', jd?.job_title || 'JD')
    .replaceAll('{company}', jd?.company || '')
    .replaceAll('{process}', jd?.process_name || jd?.job_title || '');
}

function openWhatsApp(candidate, body) {
  const phone = String(candidate?.phone || '').replace(/\D/g, '').slice(-10);
  const url = phone ? `https://wa.me/91${phone}?text=${encodeURIComponent(body)}` : `https://wa.me/?text=${encodeURIComponent(body)}`;
  window.CareerCroxWhatsApp.open(url,undefined,{source:'jd_message'});
}

function toAbsoluteUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  try {
    return new URL(raw, window.location.origin).toString();
  } catch {
    return raw;
  }
}


async function copyTextToClipboard(value = '') {
  const text = String(value || '').trim();
  if (!text) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return Boolean(copied);
  } catch {
    return false;
  }
}

async function tryShareJdPdf(jd, body) {
  const absolutePdfUrl = toAbsoluteUrl(jd?.pdf_url || '');
  if (!absolutePdfUrl || !navigator?.share || !navigator?.canShare) return false;
  try {
    const response = await fetch(absolutePdfUrl, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) return false;
    const blob = await response.blob();
    const safeName = String(jd?.job_title || 'jd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'jd';
    const file = new File([blob], `${safeName}.pdf`, { type: blob.type || 'application/pdf' });
    if (!navigator.canShare({ files: [file] })) return false;
    await navigator.share({ title: jd?.job_title || 'JD PDF', text: body, files: [file] });
    return true;
  } catch {
    return false;
  }
}

async function sendJdOnWhatsApp(candidate,jd,material='') { return openJdShareDialog(jd,candidate?[candidate]:[],material); }

function ruleCount(jd) {
  return [
    ...splitCsv(jd.preferred_location_rule),
    ...splitCsv(jd.qualification_rule),
    ...splitCsv(jd.communication_rule),
    ...splitCsv(jd.career_gap_rule),
    ...splitCsv(jd.documents_rule),
    ...splitCsv(jd.all_details_sent_rule),
    ...splitCsv(jd.relevant_experience_rule),
    ...splitCsv(jd.relevant_salary_rule),
    jd.salary_min,
    jd.salary_max,
    jd.exp_min,
    jd.exp_max,
  ].filter(Boolean).length;
}

function formatRuleSummary(value) {
  const list = splitCsv(value);
  if (!list.length) return 'Not set';
  if (list.length === 1) return list[0];
  return `${list.length} selected`;
}

function toggleCsvValue(current, value) {
  const list = splitCsv(current);
  if (list.includes(value)) return list.filter((item) => item !== value).join(', ');
  return [...list, value].join(', ');
}

function ensureOption(options, value) {
  const clean = options.map((item) => String(item || '').trim()).filter(Boolean);
  const current = String(value || '').trim();
  if (current && !clean.includes(current)) clean.push(current);
  return clean;
}

function RuleGroup({ label, value, options, onChange, hint }) {
  const mergedOptions = ensureOption(options, value);
  const selected = splitCsv(value);
  return (
    <div className="jd-rule-card">
      <div className="jd-rule-top">
        <div>
          <div className="jd-rule-title">{label}</div>
          <div className="helper-text">{hint || 'Select one or more options.'}</div>
        </div>
        <span className="metric-mini-chip filters tiny-chip">{selected.length || 0}</span>
      </div>
      <div className="choice-chip-row compact-row top-gap-small">
        {mergedOptions.map((option) => (
          <button
            key={option}
            type="button"
            className={`choice-chip bounceable ${selected.includes(option) ? 'active' : ''}`}
            onClick={() => onChange(toggleCsvValue(value, option))}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="jd-rule-foot top-gap-small">
        <PremiumSelect
          className="choice-more-select selected"
          value=""
          onChange={(e) => {
            if (e.target.value === '__add_new__') {
              const custom = window.prompt(`Add new ${label}`, '');
              if (custom && custom.trim()) onChange(toggleCsvValue(value, custom.trim()));
            } else if (e.target.value) {
              onChange(toggleCsvValue(value, e.target.value));
            }
          }}
        >
          <option value="">More options</option>
          {mergedOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          <option value="__add_new__">Add New...</option>
        </PremiumSelect>
        <div className="helper-text">{formatRuleSummary(value)}</div>
      </div>
    </div>
  );
}

function MetricCard({ tone, label, value, subtext }) {
  return (
    <div className={`metric-card colorful-card jd-tone-card ${tone}`}>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <small>{subtext}</small>
    </div>
  );
}


function jdOptions(rows,key,presets=[]){return [...new Set([...presets,...rows.map(row=>String(row[key]||'').trim())].filter(Boolean))].sort((a,b)=>a.localeCompare(b));}
function JdCombo({label,value,options=[],onChange}){const [typing,setTyping]=useState(false);return <label className="field compact-field cc802-jd-combo"><span>{label}</span>{typing?<div className="cc802-new-value"><input autoFocus value={value} onChange={e=>onChange(e.target.value)} placeholder={`New ${label.toLowerCase()}`} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();setTyping(false)}}}/><button type="button" className="ghost-btn" onClick={()=>setTyping(false)}>Done</button></div>:<PremiumSelect value={value||''} onChange={e=>{if(e.target.value==='__custom__')setTyping(true);else onChange(e.target.value)}}><option value="">Choose {label.toLowerCase()}</option>{ensureOption(options,value).map(x=><option key={x} value={x}>{x}</option>)}<option value="__custom__">+ Add new...</option></PremiumSelect>}</label>;}
function JdBenefits({jd}){const fields=[['Sector',jd.sector],['PIN',jd.pincode],['Qualification',jd.qualification_required],['Monthly in-hand',[jd.in_hand_min,jd.in_hand_max].filter(x=>String(x??'').trim()).join(' - ')],['Interview',jd.interview_mode],['Working days',jd.working_days],['Shift',jd.shift_timing],['Rotational',jd.rotational_shift],['Shift for women',jd.women_shift],['Cab',jd.cab],['Travel allowance',jd.travel_allowance],['Meal',jd.meal],['Incentives',jd.incentive],['Role type',jd.process_type]].filter(([,v])=>String(v??'').trim());return <><div className="cc802-benefit-grid">{fields.map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>{jd.role_responsibilities?<div className="cc802-responsibilities"><strong>Responsibilities</strong><p>{jd.role_responsibilities}</p></div>:null}{jd.sample_label?<div className="cc802-sample-label">{jd.sample_label}</div>:null}</>;}

function WhatsAppIcon() { return <ActionGlyph kind="whatsapp"/>; }

export default function JDsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const candidateId = searchParams.get('candidateId') || '';
  const focusId = searchParams.get('focus') || '';
  const standalone = searchParams.get('standalone') === '1';
  const manager = ['admin', 'manager'].includes(lower(user?.role));
  const [rows, setRows] = useState(()=>readPageCache('jd-centre-cc803',[]));
  const [candidate, setCandidate] = useState(null);
  const [focusJd, setFocusJd] = useState(null);
  const [standaloneLoading, setStandaloneLoading] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('Pending');
  const [feedbackNote, setFeedbackNote] = useState('');
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState('');
  const [pdfBusy,setPdfBusy]=useState(false);
  async function uploadJdPdf(event){
    const selectedFile=event.target.files?.[0];event.target.value='';if(!selectedFile)return;
    if(!displayJd?.jd_id||editingId==='NEW'){setMessage('Save this JD before uploading its PDF.');return;}
    if(selectedFile.size>6*1024*1024||!selectedFile.name.toLowerCase().endsWith('.pdf')){setMessage('Choose a PDF up to 6 MB.');return;}
    setPdfBusy(true);setMessage('');
    try{const content=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Could not read PDF.'));reader.readAsDataURL(selectedFile);});
      const reply=await api.post('/api/jds/'+encodeURIComponent(displayJd.jd_id)+'/pdf/upload',{filename:selectedFile.name,content_base64:content},{timeoutMs:25000,retries:0});
      if(!reply.ok||!reply.document?.pdf_url)throw new Error('PDF upload was not confirmed.');
      setRows(prev=>{const next=prev.map(row=>row.jd_id===displayJd.jd_id?{...row,pdf_url:reply.document.pdf_url}:row);writePageCache('jd-centre-cc803',next);return next;});
      setForm(prev=>({...prev,pdf_url:reply.document.pdf_url}));setMessage('PDF uploaded and stored with this JD.');
    }catch(e){setMessage(e.message||'PDF upload failed.');}finally{setPdfBusy(false);}
  }
  useEffect(()=>{if(manager&&searchParams.get('create')==='1'){startNewJd();const p=new URLSearchParams(searchParams);p.delete('create');setSearchParams(p,{replace:true});}},[searchParams,manager]);

  const fieldOptions=useMemo(()=>({job_title:jdOptions(rows,'job_title',['Customer Support Executive','Sales Executive','Chat Support Executive']),company:jdOptions(rows,'company'),process_name:jdOptions(rows,'process_name',['Zomato','Airtel','Air India']),location:jdOptions(rows,'location',['Noida','Gurgaon','Mumbai','Pune','Bangalore','Chennai'])}),[rows]);
  const instructionItems = useMemo(() => parseInstructionItems(form.instruction_points), [form.instruction_points]);
  const materialItems = useMemo(() => parseSendItems(form.send_items), [form.send_items]);

  async function load() {
    if (standalone && focusId) setStandaloneLoading(true);
    const jdTask=api.get('/api/jds',{cacheTtlMs:10000,allowStale:false}).then(data=>{
      const items=Array.isArray(data.items)?data.items:[];setRows(items);writePageCache('jd-centre-cc803',items);
      const focus=items.find(row=>String(row.jd_id)===String(focusId))||null;setFocusJd(focus);
      setSelectedId(current=>editingId==='NEW'?current:current&&items.some(row=>String(row.jd_id)===String(current))?current:focusId||items[0]?.jd_id||'');
      if(standalone)setStandaloneLoading(false);
    });
    const candidateTask=candidateId?api.get(`/api/candidates/${candidateId}?edit_only=1`,{cacheTtlMs:0,allowStale:false}).then(data=>setCandidate(data?.item||null)):Promise.resolve(setCandidate(null));
    await Promise.all([jdTask,candidateTask]);
  }

  useEffect(() => {
    load().catch((err) => {
      if (standalone && focusId) setStandaloneLoading(false);
      setMessage(err.message || 'JD Centre load failed');
    });
  }, [candidateId, focusId, standalone]);

  useEffect(() => {
    if (focusId) setSelectedId(focusId);
  }, [focusId]);

  const decorated = useMemo(() => rows.filter(row=>row&&typeof row==='object'&&row.jd_id).map((row) => ({
    ...row,
    instruction_points_list: parseInstructionItems(row.instruction_points_list || row.instruction_points).filter(item=>String(item?.content||'').trim()),
    send_items_list: parseSendItems(row.send_items_list || row.send_items).filter(item=>String(item?.message||item?.link||'').trim()),
    match: candidate ? qualifies(candidate, row) : {eligible:true,reasons:[],score:0},
    active_rule_count: ruleCount(row),
  })), [rows, candidate]);

  const visibleRows = useMemo(() => candidate ? decorated.filter((row) => row.match.eligible) : decorated, [decorated, candidate]);
  const selected = useMemo(() => (candidate ? visibleRows : decorated).find((row) => String(row.jd_id) === String(selectedId)) || visibleRows[0] || (!candidate ? decorated[0] : null) || null, [decorated, visibleRows, selectedId]);

  useEffect(() => {
    if (!selected || editingId === 'NEW' || editingId === selected.jd_id) return;
    setForm({
      ...EMPTY_FORM,...selected,
      job_title: selected.job_title || '',
      company: selected.company || '',
      process_name: selected.process_name || '',
      location: selected.location || '',
      preferred_location_rule: selected.preferred_location_rule || '',
      qualification_rule: selected.qualification_rule || '',
      communication_rule: selected.communication_rule || '',
      career_gap_rule: selected.career_gap_rule || '',
      documents_rule: selected.documents_rule || '',
      all_details_sent_rule: selected.all_details_sent_rule || '',
      relevant_experience_rule: selected.relevant_experience_rule || '',
      relevant_salary_rule: selected.relevant_salary_rule || '',
      salary_min: selected.salary_min ?? '',
      salary_max: selected.salary_max ?? '',
      exp_min: selected.exp_min ?? '',
      exp_max: selected.exp_max ?? '',
      pdf_url: selected.pdf_url || '',
      jd_status: selected.jd_status || 'Open',
      notes: selected.notes || '',
      salary: selected.salary || '',
      experience: selected.experience || '',
      message_template: selected.message_template || EMPTY_FORM.message_template,
      instruction_points: serializeInstructionItems(selected.instruction_points_list || []),
      send_items: serializeSendItems(selected.send_items_list || []),
    });
  }, [selected, editingId]);

  const displayJd = useMemo(() => {
    if (editingId === 'NEW') {
      return {
        ...form,
        jd_id: 'NEW',
        instruction_points_list: instructionItems,
        send_items_list: materialItems,
        active_rule_count: ruleCount(form),
      };
    }
    return standalone ? (focusJd || selected) : selected;
  }, [editingId, form, instructionItems, materialItems, selected, standalone, focusJd]);

  const summary = useMemo(() => {
    const openCount = decorated.filter((row) => !['closed', 'inactive'].includes(lower(row.jd_status))).length;
    return {
      total: decorated.length,
      open: openCount,
      matched: candidate ? visibleRows.length : decorated.length,
      instructions: (displayJd?.instruction_points_list || []).filter(item=>String(item.content||'').trim()).length,
      materials: (displayJd?.send_items_list || []).filter(item=>String(item.message||item.link||'').trim()).length,
    };
  }, [decorated, visibleRows, candidate, displayJd, instructionItems.length, materialItems.length]);

  async function saveJd() {
    setSaving(true);
    setMessage('');
    try {
      const payload = {
        ...form,
        salary: form.salary || ([form.salary_min, form.salary_max].filter(x=>String(x??'').trim()).join('-')),
        experience: form.experience || ([form.exp_min, form.exp_max].filter(x=>String(x??'').trim()).join('-')+' months'),
        instruction_points: parseInstructionItems(form.instruction_points),
        send_items: parseSendItems(form.send_items),
      };
      const data = editingId && editingId !== 'NEW'
        ? await api.put(`/api/jds/${editingId}`, payload)
        : await api.post('/api/jds', payload);
      setEditingId('');
      setSelectedId(data.item?.jd_id || selectedId);
      setMessage(editingId && editingId !== 'NEW' ? 'JD updated.' : 'JD created.');
      await load();
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (data.item?.jd_id) next.set('focus', data.item.jd_id);
        return next;
      });
    } catch (err) {
      setMessage(err.message || 'JD save failed');
    } finally {
      setSaving(false);
    }
  }

  async function sendFeedback(nextStatus) {
    if (!candidate || !selected || feedbackSaving) return;
    setFeedbackSaving(true);
    try {
      const result = await api.post(`/api/jds/${selected.jd_id}/feedback`, {
        candidate_id: candidate.candidate_id,
        feedback_status: nextStatus,
        feedback_note: feedbackNote,
      });
      setFeedbackStatus(result.item?.feedback_status || nextStatus);
      setMessage(result.note_saved ? `Candidate marked as ${nextStatus}. Note saved.` : `Candidate marked as ${nextStatus}.`);
    } catch (err) {
      setMessage(err.message || 'Feedback save failed');
    } finally {
      setFeedbackSaving(false);
    }
  }

  function updateInstructionItems(items) {
    setForm((prev) => ({ ...prev, instruction_points: serializeInstructionItems(items) }));
  }

  function updateMaterialItems(items) {
    setForm((prev) => ({ ...prev, send_items: serializeSendItems(items) }));
  }

  function openSearchInDb(jd) {
    const params = new URLSearchParams();
    splitCsv(jd.location).forEach((item) => params.append('location', item));
    splitCsv(jd.preferred_location_rule).forEach((item) => params.append('preferred_location', item));
    splitCsv(jd.qualification_rule).forEach((item) => params.append('qualification', item));
    splitCsv(jd.communication_rule).forEach((item) => params.append('communication_skill', item));
    splitCsv(jd.career_gap_rule).forEach((item) => params.append('career_gap', item));
    splitCsv(jd.documents_rule).forEach((item) => params.append('documents_availability', item));
    splitCsv(jd.all_details_sent_rule).forEach((item) => params.append('all_details_sent', item));
    splitCsv(jd.relevant_experience_rule).forEach((item) => params.append('relevant_experience_range', item));
    splitCsv(jd.relevant_salary_rule).forEach((item) => params.append('relevant_in_hand_range', item));
    if (jd.process_name) params.append('process', jd.process_name);
    const salaryRange = deriveNumericRange(jd.salary || '', jd.salary_min, jd.salary_max, 'amount');
    if (salaryRange.min) params.set('salary_from', String(salaryRange.min));
    if (salaryRange.max) params.set('salary_to', String(salaryRange.max));
    const expRange = deriveNumericRange(jd.experience || '', jd.exp_min, jd.exp_max, 'months');
    if (expRange.min) params.set('relevant_exp_from', String(expRange.min));
    if (expRange.max) params.set('relevant_exp_to', String(expRange.max));
    window.open(`/candidates?${params.toString()}`, '_blank');
  }

  function startNewJd() {
    setEditingId('NEW');
    setSelectedId('');
    setForm({...EMPTY_FORM});
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('focus');
      return next;
    });
  }


  if (standalone) {
    return (
      <Layout title={displayJd?.job_title || 'JD Detail'} subtitle="">
        <div className="jd-centre-page-v2 cc808-jd-studio fade-up">
          {message ? <div className="flash info">{message}</div> : null}
          <div className="panel glassy-card jd-detail-shell jd-standalone-shell-large">
            {standaloneLoading ? (
              <div className="jd-standalone-loading">Opening JD...</div>
            ) : displayJd ? (
              <div className="jd-view-shell">
                <div className="jd-detail-topbar">
                  <div>
                    <div className="panel-title">{displayJd.job_title || 'JD Detail'}</div>
                    <div className="helper-text top-gap-small">{displayJd.company || '-'} • {displayJd.location || '-'} • {displayJd.process_name || displayJd.job_title || '-'}</div>
                  </div>
                  <div className="jd-head-actions">
                    {displayJd?.jd_id && displayJd.jd_id!=='NEW' ? <a className="add-profile-btn bounceable" href={toAbsoluteUrl(displayJd.pdf_url || `/api/jds/${encodeURIComponent(displayJd.jd_id)}/pdf`)} target="_blank">Open PDF</a> : null}
                  </div>
                </div>

                <JdBenefits jd={displayJd}/><div className="jd-rule-grid jd-rule-grid-colorful top-gap-small">
                  <div className="jd-rule-card"><div className="jd-rule-title">Preferred Location</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.preferred_location_rule || displayJd.location)}</div></div>
                  <div className="jd-rule-card"><div className="jd-rule-title">Qualification</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.qualification_rule)}</div></div>
                  <div className="jd-rule-card"><div className="jd-rule-title">Experience Range</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.relevant_experience_rule) || '-'}</div></div>
                  <div className="jd-rule-card"><div className="jd-rule-title">Salary Range</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.relevant_salary_rule) || '-'}</div></div>
                  <div className="jd-rule-card"><div className="jd-rule-title">Communication</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.communication_rule)}</div></div>
                  <div className="jd-rule-card"><div className="jd-rule-title">Career Gap</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.career_gap_rule)}</div></div>
                  <div className="jd-rule-card"><div className="jd-rule-title">Documents</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.documents_rule)}</div></div>
                  <div className="jd-rule-card"><div className="jd-rule-title">All Details Sent</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.all_details_sent_rule)}</div></div>
                </div>

                <div className="jd-view-two-col jd-view-two-col-premium top-gap-small">
                  <div className="jd-section-box jd-section-box-instruction">
                    <div className="panel-title">Instruction Points</div>
                    <div className="jd-display-stack top-gap-small">
                      {(displayJd.instruction_points_list || []).map((item, idx) => (
                        <div key={`standalone-instruction-${idx}`} className="jd-display-card">
                          <div className="jd-display-card-top">
                            <span className="metric-mini-chip records tiny-chip">Instruction {idx + 1}</span>
                            <strong>{item.title || `Instruction ${idx + 1}`}</strong>
                          </div>
                          <div className="jd-display-copy">{item.content || '-'}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="jd-section-box jd-section-box-material">
                    <div className="panel-title">Send Material</div>
                    <div className="jd-display-stack top-gap-small">
                      {(displayJd.send_items_list || []).map((item, idx) => (
                        <div key={`standalone-material-${idx}`} className="jd-display-card">
                          <div className="jd-display-card-top spread">
                            <div>
                              <span className="metric-mini-chip filters tiny-chip">Material {idx + 1}</span>
                              <strong>{item.label || `Send Material ${idx + 1}`}</strong>
                            </div>
                            {candidate ? (
                              <button
                                type="button"
                                className="mini-btn call bounceable jd-wa-btn"
                                onClick={() => sendJdOnWhatsApp(candidate, displayJd, `${item.label || `Send Material ${idx + 1}`}:
${item.message || ''}${item.link ? `
${item.link}` : ''}`)}
                                title="Send on WhatsApp"
                              >
                                <WhatsAppIcon />
                                <span>WhatsApp</span>
                              </button>
                            ) : null}
                          </div>
                          <div className="jd-display-copy">{item.message || '-'}</div>
                          {item.link ? <div className="helper-text top-gap-small">{item.link}</div> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="jd-section-box top-gap-small">
                  <div className="panel-title">WhatsApp Script</div>
                  <div className="jd-display-copy top-gap-small">{displayJd.message_template || '-'}</div>
                </div>

                {displayJd.notes ? (
                  <div className="jd-section-box top-gap-small">
                    <div className="panel-title">Notes</div>
                    <div className="jd-display-copy top-gap-small">{displayJd.notes}</div>
                  </div>
                ) : null}

                {candidate ? (
                  <div className="jd-feedback-shell top-gap-small">
                    <div>
                      <div className="panel-title">Candidate Interest Marking</div>
                      <div className="helper-text">Mark the response on the same call and save the note against the candidate so the system keeps the record updated.</div>
                    </div>
                    <div className="choice-chip-row compact-row">
                      {['Interested', 'Pending', 'Not Interested'].map((option) => (
                        <button key={option} type="button" className={`choice-chip bounceable ${feedbackStatus === option ? 'active' : ''}`} disabled={feedbackSaving} onClick={() => sendFeedback(option)}>{option}</button>
                      ))}
                    </div>
                    <textarea rows="3" className="inline-textarea" value={feedbackNote} onChange={(e) => setFeedbackNote(e.target.value)} placeholder="Add on-call note. This will be saved in candidate notes too." />
                    <div className="row-actions">
                      <button type="button" className="ghost-btn bounceable" onClick={() => sendJdOnWhatsApp(candidate, displayJd)}>Send JD on WhatsApp</button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : <div className="helper-text">Selected JD could not be loaded.</div>}
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="JD Centre" subtitle="">
      <div className="jd-centre-page-v2 cc808-jd-studio fade-up">
        {message ? <div className="flash info">{message}</div> : null}

        <div className="jd-summary-grid">
          <MetricCard tone="tone-blue" label="Total JDs" value={summary.total} subtext="All visible JD cards" />
          <MetricCard tone="tone-green" label="Open JDs" value={summary.open} subtext="Ready for calling" />
          <MetricCard tone="tone-orange" label={candidate ? 'Eligible JDs' : 'Companies'} value={candidate ? summary.matched : new Set(decorated.map(row=>row.company).filter(Boolean)).size} subtext="" />
          
          
        </div>

        <div className="table-panel glassy-card top-gap jd-selector-shell">
          <div className="table-toolbar jd-toolbar-stack">
            <div>
              <div className="table-title">Choose your next opportunity</div>
              <div className="helper-text"></div>
            </div>
            <div className="toolbar-actions compact-pills jd-toolbar-actions">
              {candidate ? (
                <>
                  <span className="metric-mini-chip records">Candidate: {candidate.full_name}</span>
                  <span className="metric-mini-chip filters">Phone: {visiblePhone(user, candidate.phone)}</span>
                </>
              ) : null}
              <button type="button" className="ghost-btn bounceable" onClick={()=>load().catch(error=>setMessage(error.message||'JD refresh failed'))}>Refresh JDs</button>
              {manager ? <button type="button" className="add-profile-btn bounceable" onClick={startNewJd}>Add JD</button> : null}
            </div>
          </div>
          <div className="jd-selector-grid">
            {(candidate ? visibleRows : decorated).map((row) => (
              <button
                key={row.jd_id}
                type="button"
                className={`jd-selector-card ${String(displayJd?.jd_id) === String(row.jd_id) && editingId !== 'NEW' ? 'active' : ''}`}
                onClick={() => {
                  setSelectedId(row.jd_id);
                  setEditingId('');
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    next.set('focus', row.jd_id);
                    return next;
                  });
                }}
              >
                <div className="jd-selector-card-top">
                  <span className={`status-pill ${lower(row.jd_status || 'open')}`}>{row.jd_status || 'Open'}</span>
                  <span className="metric-mini-chip records tiny-chip">{row.active_rule_count} rules</span>
                  {candidate ? <span className={`metric-mini-chip tiny-chip jd-match-chip ${row.match.score >= 85 ? 'best' : row.match.score >= 70 ? 'good' : 'review'}`}>{Math.round(row.match.score || 0)}% match</span> : null}
                </div>
                <div className="jd-selector-title">{row.job_title}</div>
                <div className="helper-text">{row.company || '-'} • {row.location || '-'}</div>
                <div className="jd-selector-meta">{row.process_name || row.job_title || '-'}</div>
                {candidate ? (
                  <div className="jd-reason-wrap">
                    {row.match.reasons.map((reason) => <span key={reason} className="sky-chip tiny">{reason}</span>)}
                  </div>
                ) : null}
              </button>
            ))}
            {!(candidate ? visibleRows : decorated).length ? <div className="helper-text">{candidate ? 'No JD matches this profile.' : 'No JD available.'}</div> : null}
          </div>
        </div>

        <div className="panel glassy-card top-gap jd-detail-shell">
          {displayJd ? (
            <>
              <div className="jd-detail-topbar">
                <div>
                  <div className="panel-title">{editingId === 'NEW' ? 'Create New JD' : (displayJd.job_title || 'JD Detail')}</div>
                  <div className="helper-text top-gap-small">{displayJd.company || '-'} • {displayJd.location || '-'} • {displayJd.process_name || displayJd.job_title || '-'}</div>
                </div>
                <div className="jd-head-actions">
                  {editingId !== 'NEW' ? <button type="button" className="ghost-btn bounceable" onClick={() => openSearchInDb(displayJd)}>Search Candidates in Database</button> : null}
                  {editingId !== 'NEW' && displayJd?.jd_id ? <a className="add-profile-btn cc802-jd-pdf" href={`/api/jds/${encodeURIComponent(displayJd.jd_id)}/pdf`} target="_blank" rel="noopener noreferrer">Generate PDF</a> : null}
                  {editingId !== 'NEW' && displayJd?.jd_id ? <button type="button" className="add-profile-btn cc803-jd-share-btn" onClick={()=>openJdShareDialog(displayJd,candidate?[candidate]:[])}>Share PDF + message</button> : null}
                  {manager && editingId !== 'NEW' && displayJd?.jd_id ? <label className="add-profile-btn cc803-jd-upload-btn">{pdfBusy?'Uploading…':'Upload PDF'}<input type="file" accept="application/pdf,.pdf" hidden disabled={pdfBusy} onChange={uploadJdPdf}/></label> : null}
                  {manager && editingId !== 'NEW' ? <button type="button" className="add-profile-btn bounceable" onClick={() => setEditingId(displayJd.jd_id)}>Edit JD</button> : null}
                </div>
              </div>

              {editingId === 'NEW' || editingId === displayJd.jd_id ? (
                <div className="jd-editor-shell top-gap-small">
                  <div className="jd-basic-grid cc802-jd-identity">
                    <JdCombo label="Job Title" value={form.job_title} options={fieldOptions.job_title} onChange={value=>setForm(prev=>({...prev,job_title:value}))}/>
                    <JdCombo label="Company" value={form.company} options={fieldOptions.company} onChange={value=>setForm(prev=>({...prev,company:value}))}/>
                    <JdCombo label="Process Name" value={form.process_name} options={fieldOptions.process_name} onChange={value=>setForm(prev=>({...prev,process_name:value}))}/>
                    <JdCombo label="Base Location" value={form.location} options={fieldOptions.location} onChange={value=>setForm(prev=>({...prev,location:value}))}/>
                    <label className="field compact-field"><span>Sector / locality</span><input value={form.sector||''}  onChange={e=>setForm(prev=>({...prev,sector:e.target.value}))} /></label>
                    <label className="field compact-field"><span>Pincode</span><input value={form.pincode||''} inputMode="numeric" maxLength="6" onChange={e=>setForm(prev=>({...prev,pincode:e.target.value}))} /></label>
                    <label className="field compact-field"><span>JD Status</span><PremiumSelect value={form.jd_status} onChange={e=>setForm(prev=>({...prev,jd_status:e.target.value}))}>{['Open','Active','Pending','Closed'].map(x=><option key={x}>{x}</option>)}</PremiumSelect></label>
                    <label className="field compact-field"><span>PDF link (optional)</span><input value={form.pdf_url} onChange={e=>setForm(prev=>({...prev,pdf_url:e.target.value}))} placeholder="https://... or /jd-samples/...pdf"/><small>Upload a PDF above, or leave blank to generate one from the saved JD.</small></label>
                  </div>
                  <div className="cc802-jd-section"><h3>Pay, eligibility & schedule</h3><div className="jd-basic-grid">
                    <label className="field compact-field"><span>Monthly CTC minimum (INR)</span><input type="number" min="0" step="1" value={form.salary_min} onChange={e=>setForm(prev=>({...prev,salary_min:e.target.value}))} /></label>
                    <label className="field compact-field"><span>Monthly CTC maximum (INR)</span><input type="number" min="0" step="1" value={form.salary_max} onChange={e=>setForm(prev=>({...prev,salary_max:e.target.value}))} /></label>
                    <label className="field compact-field"><span>In-hand minimum (INR)</span><input type="number" min="0" step="1" value={form.in_hand_min} onChange={e=>setForm(prev=>({...prev,in_hand_min:e.target.value}))} /></label>
                    <label className="field compact-field"><span>In-hand maximum (INR)</span><input type="number" min="0" step="1" value={form.in_hand_max} onChange={e=>setForm(prev=>({...prev,in_hand_max:e.target.value}))} /></label>
                    <label className="field compact-field"><span>Experience minimum (months)</span><input type="number" min="0" step="1" value={form.exp_min} onChange={e=>setForm(prev=>({...prev,exp_min:e.target.value}))} /></label>
                    <label className="field compact-field"><span>Experience maximum (months)</span><input type="number" min="0" step="1" value={form.exp_max} onChange={e=>setForm(prev=>({...prev,exp_max:e.target.value}))} /></label>
                    <JdCombo label="Minimum qualification" value={form.qualification_required||''} options={['12th pass', '12th pass (English medium)', 'Graduate', 'Graduate / Undergraduate']} onChange={value=>setForm(prev=>({...prev,qualification_required:value}))}/>
                    <label className="field compact-field"><span>Interview mode</span><PremiumSelect value={form.interview_mode||''} onChange={e=>setForm(prev=>({...prev,interview_mode:e.target.value}))}><option value="">Choose mode</option><option value="Virtual">Virtual</option><option value="Walkin">Walk-in</option></PremiumSelect></label>
                    <JdCombo label="Working days" value={form.working_days||''} options={['5 days', '6 days']} onChange={value=>setForm(prev=>({...prev,working_days:value}))}/>
                    <JdCombo label="Role type" value={form.process_type||''} options={['Voice', 'Chat', 'Blended (chat + voice)', 'Sales', 'Customer Support']} onChange={value=>setForm(prev=>({...prev,process_type:value}))}/>
                    <JdCombo label="Shift timing" value={form.shift_timing||''} options={['Day', 'Night', 'Rotational']} onChange={value=>setForm(prev=>({...prev,shift_timing:value}))}/>
                    <JdCombo label="Rotational shifts" value={form.rotational_shift||''} options={['Yes', 'No']} onChange={value=>setForm(prev=>({...prev,rotational_shift:value}))}/>
                    <JdCombo label="Shift for women" value={form.women_shift||''} options={['Day', 'Night', 'Rotational']} onChange={value=>setForm(prev=>({...prev,women_shift:value}))}/>
                    <JdCombo label="Cab" value={form.cab||''} options={['No', 'Both sides', 'Doorstep, both sides', 'One side']} onChange={value=>setForm(prev=>({...prev,cab:value}))}/>
                    <JdCombo label="Travel allowance" value={form.travel_allowance||''} options={['No', 'Yes', 'Available as alternative to cab']} onChange={value=>setForm(prev=>({...prev,travel_allowance:value}))}/>
                    <JdCombo label="Meal" value={form.meal||''} options={['No', 'One meal per working day']} onChange={value=>setForm(prev=>({...prev,meal:value}))}/>
                    <JdCombo label="Incentives" value={form.incentive||''} options={['No', 'Yes', 'Performance-based']} onChange={value=>setForm(prev=>({...prev,incentive:value}))}/>
                  </div><label className="field"><span>Responsibilities</span><textarea rows="3" value={form.role_responsibilities||''} onChange={e=>setForm(prev=>({...prev,role_responsibilities:e.target.value}))} placeholder="One responsibility per line"/></label></div>

                  <div className="jd-rule-grid top-gap-small">
                    <RuleGroup label="Preferred Location" value={form.preferred_location_rule} options={PREFERRED_LOCATIONS} onChange={(value) => setForm((prev) => ({ ...prev, preferred_location_rule: value }))} hint="Multiple location options allowed." />
                    <RuleGroup label="Qualification" value={form.qualification_rule} options={DEGREE_OPTIONS} onChange={(value) => setForm((prev) => ({ ...prev, qualification_rule: value }))} hint="Choose the accepted degree categories." />
                    <RuleGroup label="Relevant Experience Range" value={form.relevant_experience_rule} options={EXPERIENCE_RANGE_OPTIONS} onChange={(value) => setForm((prev) => ({ ...prev, relevant_experience_rule: value }))} hint="Allowed experience bands." />
                    <RuleGroup label="Relevant In-hand Salary" value={form.relevant_salary_rule} options={SALARY_RANGE_OPTIONS} onChange={(value) => setForm((prev) => ({ ...prev, relevant_salary_rule: value }))} hint="Multiple salary bands can stay active." />
                    <RuleGroup label="Communication" value={form.communication_rule} options={COMMUNICATION_OPTIONS} onChange={(value) => setForm((prev) => ({ ...prev, communication_rule: value }))} hint="Match by communication level." />
                    <RuleGroup label="Career Gap" value={form.career_gap_rule} options={CAREER_GAP_OPTIONS} onChange={(value) => setForm((prev) => ({ ...prev, career_gap_rule: value }))} hint="Pick one or many gap buckets." />
                    <RuleGroup label="All Documents Availability" value={form.documents_rule} options={DOCUMENTS_OPTIONS} onChange={(value) => setForm((prev) => ({ ...prev, documents_rule: value }))} hint="Useful when recruiter wants clean docs first." />
                    <RuleGroup label="All Details Sent" value={form.all_details_sent_rule} options={DETAILS_SENT_OPTIONS} onChange={(value) => setForm((prev) => ({ ...prev, all_details_sent_rule: value }))} hint="Pending or completed detail-sharing state." />
                  </div>

                  <div className="jd-editor-two-col top-gap-small">
                    <div className="jd-section-box tall-box">
                      <div className="jd-section-head">
                        <div>
                          <div className="panel-title">Instruction Points</div>
                          <div className="helper-text">Recruiter guidance for this JD.</div>
                        </div>
                        <button type="button" className="ghost-btn bounceable" onClick={() => updateInstructionItems([...instructionItems, { title: `Instruction ${instructionItems.length + 1}`, content: '' }])}>Add Point</button>
                      </div>
                      <div className="jd-editor-list top-gap-small">
                        {instructionItems.map((item, idx) => (
                          <div key={`instruction-${idx}`} className="jd-editor-item-card">
                            <div className="jd-editor-item-head">
                              <span className="metric-mini-chip records tiny-chip">{idx + 1}</span>
                              <button type="button" className="ghost-btn danger-ghost" onClick={() => updateInstructionItems(instructionItems.filter((_, index) => index !== idx))}>Remove</button>
                            </div>
                            <input className="inline-input" value={item.title} onChange={(e) => updateInstructionItems(instructionItems.map((entry, index) => index === idx ? { ...entry, title: e.target.value } : entry))} placeholder={`Instruction ${idx + 1}`} />
                            <textarea className="inline-textarea top-gap-small" rows="4" value={item.content} onChange={(e) => updateInstructionItems(instructionItems.map((entry, index) => index === idx ? { ...entry, content: e.target.value } : entry))} placeholder="Write what the recruiter should explain on call." />
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="jd-section-box tall-box">
                      <div className="jd-section-head">
                        <div>
                          <div className="panel-title">Send Material</div>
                          <div className="helper-text">Saved messages and links for candidates.</div>
                        </div>
                        <button type="button" className="ghost-btn bounceable" onClick={() => updateMaterialItems([...materialItems, { order_no: materialItems.length + 1, label: `Send Material ${materialItems.length + 1}`, message: '', link: '' }])}>Add Material</button>
                      </div>
                      <div className="jd-editor-list top-gap-small">
                        {materialItems.map((item, idx) => (
                          <div key={`material-${idx}`} className="jd-editor-item-card">
                            <div className="jd-editor-item-head">
                              <span className="metric-mini-chip filters tiny-chip">Material {idx + 1}</span>
                              <button type="button" className="ghost-btn danger-ghost" onClick={() => updateMaterialItems(materialItems.filter((_, index) => index !== idx))}>Remove</button>
                            </div>
                            <input className="inline-input" value={item.label} onChange={(e) => updateMaterialItems(materialItems.map((entry, index) => index === idx ? { ...entry, label: e.target.value } : entry))} placeholder="Location / JD / Interview Info" />
                            <textarea className="inline-textarea top-gap-small" rows="4" value={item.message} onChange={(e) => updateMaterialItems(materialItems.map((entry, index) => index === idx ? { ...entry, message: e.target.value } : entry))} placeholder="Paste long WhatsApp-ready content here." />
                            <input className="inline-input top-gap-small" value={item.link} onChange={(e) => updateMaterialItems(materialItems.map((entry, index) => index === idx ? { ...entry, link: e.target.value } : entry))} placeholder="Optional link" />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="jd-editor-two-col top-gap-small">
                    <label className="field"><span>WhatsApp Template</span><textarea rows="4" value={form.message_template} onChange={(e) => setForm((prev) => ({ ...prev, message_template: e.target.value }))} placeholder="Hi {candidate_name}, ..." /></label>
                    <label className="field"><span>Notes</span><textarea rows="4" value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Manager notes / recruiter guidance" /></label>
                  </div>

                  <div className="row-actions top-gap-small">
                    <button type="button" className="add-profile-btn bounceable" disabled={saving} onClick={saveJd}>{editingId && editingId !== 'NEW' ? 'Update JD' : 'Create JD'}</button>
                    {editingId ? <button type="button" className="ghost-btn bounceable" onClick={() => setEditingId('')}>Cancel Edit</button> : null}
                  </div>
                </div>
              ) : (
                <div className="jd-view-shell top-gap-small"><JdBenefits jd={displayJd}/>
                  <div className="jd-rule-grid top-gap-small">
                    <div className="jd-rule-card"><div className="jd-rule-title">Preferred Location</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.preferred_location_rule || displayJd.location)}</div></div>
                    <div className="jd-rule-card"><div className="jd-rule-title">Qualification</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.qualification_rule)}</div></div>
                    <div className="jd-rule-card"><div className="jd-rule-title">Experience Range</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.relevant_experience_rule) || '-'}</div></div>
                    <div className="jd-rule-card"><div className="jd-rule-title">Salary Range</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.relevant_salary_rule) || '-'}</div></div>
                    <div className="jd-rule-card"><div className="jd-rule-title">Communication</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.communication_rule)}</div></div>
                    <div className="jd-rule-card"><div className="jd-rule-title">Career Gap</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.career_gap_rule)}</div></div>
                    <div className="jd-rule-card"><div className="jd-rule-title">Documents</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.documents_rule)}</div></div>
                    <div className="jd-rule-card"><div className="jd-rule-title">All Details Sent</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.all_details_sent_rule)}</div></div>
                  </div>

                  <div className="jd-view-two-col top-gap-small">
                    <div className="jd-section-box">
                      <div className="panel-title">Instruction Points</div>
                      <div className="jd-display-stack top-gap-small">
                        {(displayJd.instruction_points_list || []).map((item, idx) => (
                          <div key={`view-instruction-${idx}`} className="jd-display-card">
                            <div className="jd-display-card-top">
                              <span className="metric-mini-chip records tiny-chip">Instruction {idx + 1}</span>
                              <strong>{item.title || `Instruction ${idx + 1}`}</strong>
                            </div>
                            <div className="jd-display-copy">{item.content || '-'}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="jd-section-box">
                      <div className="panel-title">Send Material</div>
                      <div className="jd-display-stack top-gap-small">
                        {(displayJd.send_items_list || []).map((item, idx) => (
                          <div key={`view-material-${idx}`} className="jd-display-card">
                            <div className="jd-display-card-top spread">
                              <div>
                                <span className="metric-mini-chip filters tiny-chip">Material {idx + 1}</span>
                                <strong>{item.label || `Send Material ${idx + 1}`}</strong>
                              </div>
                              {candidate ? (
                                <button
                                  type="button"
                                  className="mini-btn call bounceable jd-wa-btn"
                                  onClick={() => sendJdOnWhatsApp(candidate, displayJd, `${item.label || `Send Material ${idx + 1}`}:\n${item.message || ''}${item.link ? `\n${item.link}` : ''}`)}
                                  title="Send on WhatsApp"
                                >
                                  <WhatsAppIcon />
                                  <span>WhatsApp</span>
                                </button>
                              ) : null}
                            </div>
                            <div className="jd-display-copy">{item.message || '-'}</div>
                            {item.link ? <div className="helper-text top-gap-small">{item.link}</div> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {candidate ? (
                    <div className="jd-feedback-shell top-gap-small">
                      <div>
                        <div className="panel-title">Candidate Interest Marking</div>
                        <div className="helper-text">Record the response during the same call so the note is saved directly against the candidate profile.</div>
                      </div>
                      <div className="choice-chip-row compact-row">
                        {['Interested', 'Pending', 'Not Interested'].map((option) => (
                          <button key={option} type="button" className={`choice-chip bounceable ${feedbackStatus === option ? 'active' : ''}`} disabled={feedbackSaving} onClick={() => sendFeedback(option)}>{option}</button>
                        ))}
                      </div>
                      <textarea rows="3" className="inline-textarea" value={feedbackNote} onChange={(e) => setFeedbackNote(e.target.value)} placeholder="Add on-call note. This will be saved in candidate notes too." />
                      <div className="row-actions">
                        <button type="button" className="ghost-btn bounceable" onClick={() => sendJdOnWhatsApp(candidate, displayJd)}>Send JD on WhatsApp</button>
                        {displayJd?.jd_id && displayJd.jd_id!=='NEW' ? <a className="add-profile-btn bounceable" href={toAbsoluteUrl(displayJd.pdf_url || `/api/jds/${encodeURIComponent(displayJd.jd_id)}/pdf`)} target="_blank">Open PDF</a> : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </>
          ) : <div className="helper-text">Select a JD to continue.</div>}
        </div>
      </div>
    </Layout>
  );
}
