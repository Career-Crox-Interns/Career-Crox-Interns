import {isInactiveProfile} from '../lib/candidateAccess';
import {openReminderSchedule} from '../lib/reminderPause';
import {useSliceSearch,useSliceState,CrmSortSelect,sortCrmRows} from '../lib/workspaceHelpers';
import {useCandidateFilterCatalog} from '../lib/workspaceHelpers';
import { ActionGlyph } from '../components/EmojiGlyph';
import PremiumSelect from '../components/PremiumSelect';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import Layout from '../components/Layout';
import {useSearchParams} from 'react-router-dom';
import { api } from '../lib/api';
import { mergeRowsById, useSmartDeltaSync } from '../lib/smartSync';
import { addWhatsAppTemplate, getWhatsAppTemplates } from '../lib/templateStore';
import { useDashboardAuth as useAuth } from '../lib/auth';
import { dialCandidateWithLog, openWhatsAppWithLog, visiblePhone } from '../lib/candidateAccess';
import { openCandidateProfileInNewTab, navigateSameTab } from '../lib/candidateNav';
import { clearViewState, readViewState, writeViewState } from '../lib/workspaceHelpers';
import { readPageCache, writePageCache } from '../lib/persistentPageCache';
import { buildInstantInterviewRow, hasInterviewDate, onCandidateRealtime } from '../lib/realtimeProfileBridge';
import { crmYmd, formatCrmDateTime } from '../lib/workspaceHelpers';


function safeCellText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map((item) => safeCellText(item)).filter(Boolean).join(', ');
  try {
    const text = JSON.stringify(value);
    return text === undefined ? fallback : text;
  } catch {
    return fallback;
  }
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeWhatsAppTemplateOption(raw, index = 0) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const body = safeCellText(raw.body || raw.message || raw.text || '').trim();
    const title = safeCellText(raw.title || raw.heading || raw.name || body.split(/\r?\n/).find(Boolean) || `WhatsApp Preset ${index + 1}`).trim();
    return body ? { title, body } : null;
  }
  const body = safeCellText(raw || '').trim();
  if (!body) return null;
  const title = body.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.replace(/^[^\w{]+/, '').slice(0, 42) || `WhatsApp Preset ${index + 1}`;
  return { title, body };
}

function encodeWhatsAppTemplateOption(raw, index = 0) {
  const tpl = normalizeWhatsAppTemplateOption(raw, index);
  if (!tpl) return '';
  try { return JSON.stringify(tpl); } catch { return tpl.body || ''; }
}

function decodeWhatsAppTemplateOption(value = '') {
  const raw = safeCellText(value).trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return normalizeWhatsAppTemplateOption(parsed);
  } catch {
    return normalizeWhatsAppTemplateOption(raw);
  }
}

function candidateFirstName(row = {}) {
  const raw = safeObject(row);
  const name = safeCellText(raw.full_name || raw.name || raw.candidate_name || '').trim();
  return name.split(/\s+/).filter(Boolean)[0] || 'Candidate';
}

function recruiterDisplayName(row = {}, currentUser = {}) {
  const raw = safeObject(row);
  const usr = safeObject(currentUser);
  return safeCellText(
    raw.recruiter_name
      || raw.employee_name
      || raw.assigned_recruiter_name
      || raw.submitted_by_name
      || raw.tl_name
      || usr.full_name
      || usr.name
      || usr.username
      || raw.recruiter_code
      || raw.employee_code
      || 'Career Crox'
  ).trim();
}

function renderWhatsAppTemplateBody(body = '', row = {}, currentUser = {}) {
  const first = candidateFirstName(row);
  const raw = safeObject(row);
  const candidateName = safeCellText(raw.full_name || raw.name || raw.candidate_name || first).trim();
  const recruiterName = recruiterDisplayName(raw, currentUser);
  return safeCellText(body)
    .replace(/\{\{first_name\}\}/g, first)
    .replace(/\{\{candidate_name\}\}/g, candidateName)
    .replace(/\{\{recruiter_name\}\}/g, recruiterName);
}


function FilterIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}
function ArrowIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function CheckIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5.2 12.7 9.4 17l9.4-9.4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function SelectAllIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M8.3 12.2 10.9 15l4.9-5.3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function DialerIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 4h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="9" cy="8" r="1"/><circle cx="12" cy="8" r="1"/><circle cx="15" cy="8" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="16" r="1"/><circle cx="12" cy="16" r="1"/><circle cx="15" cy="16" r="1"/></svg>;
}
function PhoneIcon() { return <ActionGlyph kind="phone"/>; }
function WhatsAppIcon() { return <ActionGlyph kind="whatsapp"/>; }
function EyeIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M2.4 12s3.4-6 9.6-6 9.6 6 9.6 6-3.4 6-9.6 6-9.6-6-9.6-6Z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.9" /></svg>;
}
function PrevIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m14.5 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function NextIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function CloseIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>;
}

const defaultFilters = {
  recruiter_code: [],
  preferred_location: [],
  communication_skill: [],
  process: [],
  virtual_onsite: [],
  status: [],
  all_details_sent: [],
  submission_from: '',
  submission_to: '',
  interview_from: '',
  interview_to: '',
  interview_mode: '',
  interview_days: '',
  career_gap: [],
  relevant_exp_range: [],
  relevant_salary_range: [],
  qualification: [],
};
const defaultCompactFilters = {
  recruiter_code: '',
  communication_skill: '',
  preferred_location: '',
  qualification: '',
  relevant_exp_range: '',
  relevant_salary_range: '',
};
const defaultSort = {
  key: 'interview_date_effective',
  order: 'desc',
};
const sortOptions = [
  { value: 'interview_date_effective', label: 'Interview Date' },
  { value: 'recruiter_code', label: 'Recruiter Code' },
  { value: 'communication_skill', label: 'Communication' },
  { value: 'preferred_location', label: 'Preferred Location' },
  { value: 'qualification_level', label: 'Qualification' },
  { value: 'relevant_experience_range', label: 'Relevant Experience Range' },
  { value: 'relevant_in_hand_range', label: 'Inhand Salary Range' },
  { value: 'process', label: 'Process' },
  { value: 'full_name', label: 'Candidate Name' },
];
const quickViewOptions = [
  { key: 'today', label: "Today's Interview", cardClass: 'green', sub: 'Only today' },
  { key: 'tomorrow', label: "Tomorrow's Interview", cardClass: 'sky', sub: 'Only next day' },
  { key: 'total', label: 'Total Interview', cardClass: 'violet', sub: 'All visible interviews' },
  { key: 'upcoming', label: 'Upcoming Interview', cardClass: 'blue', sub: 'After today' },
  { key: 'missed', label: 'Missed Interview', cardClass: 'danger', sub: 'Date already crossed' },
  { key: 'week', label: 'This Week Interview', cardClass: 'orange', sub: '3 days before to 3 days after' },
  { key: 'inactive', label: 'Not Interested / Rejected', cardClass: 'danger', sub: 'Includes Not Responding' },
];
const INTERVIEWS_VIEW_STATE_KEY = 'careerCroxInterviewsViewState_v1';

function containsText(value, q) {
  return String(value || '').toLowerCase().includes(String(q || '').toLowerCase());
}
function normalizeQualificationCategory(value, fallbackQualification = '') {
  const rawValue = String(value || '').trim();
  const rawFallback = String(fallbackQualification || '').trim();
  const current = rawValue.toLowerCase();
  if (current === 'non - graduate' || current === 'non-graduate' || current === 'nongraduate') return 'NON - Graduate';
  if (current === 'graduate') return 'Graduate';
  const combined = `${rawValue} ${rawFallback}`.trim().toLowerCase();
  if (/(^|\b)(non[\s-]*grad|under[\s-]*grad|undergraduate|ug pursuing|pursuing|appearing|final year|last year|12th|10th|intermediate|higher secondary|hsc|diploma|iti)(\b|$)/i.test(combined)) return 'NON - Graduate';
  if (/(^|\b)(post[\s-]*grad|graduate|b\.?a|b\.?com|b\.?sc|b\.?tech|btech|bca|bba|mba|mca|m\.?a|m\.?com|m\.?sc|mtech|m\.?tech|phd|master|bachelor)(\b|$)/i.test(combined)) return 'Graduate';
  return 'Graduate';
}
function splitValues(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}
function uniqueOptions(rows, getter, split = false) {
  return Array.from(new Set(rows.flatMap((row) => {
    const value = getter(row);
    if (Array.isArray(value)) return value.filter(Boolean);
    return split ? splitValues(value) : [String(value || '').trim()].filter(Boolean);
  }))).sort((a, b) => String(a).localeCompare(String(b)));
}
function toggleArrayValue(filters, key, value) {
  const current = filters[key] || [];
  return current.includes(value)
    ? { ...filters, [key]: current.filter((item) => item !== value) }
    : { ...filters, [key]: [...current, value] };
}
function formatDateLabel(value) {
  if (!value) return 'No date';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatLocalDateYmd(date) {
  return crmYmd(date);
}
function offsetDateYmd(days) {
  return crmYmd(Date.now() + Number(days || 0) * 24 * 60 * 60 * 1000);
}
export function interviewViewWindow(view,today=crmYmd(Date.now())){
  const shift=days=>new Date(Date.parse(today+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
  const range=view==='today'?[today,today]:view==='tomorrow'?[shift(1),shift(1)]:view==='week'?[shift(-3),shift(3)]:view==='upcoming'?[shift(1),'']:view==='missed'?['',shift(-1)]:['',''];
  return {interview_from:range[0],interview_to:range[1],interview_mode:'',interview_days:''};
}
export function matchesInterviewDateWindow(row,filters,today=crmYmd(Date.now())){
  const date=row.interview_date_effective||interviewDateKey(row);
  if(!date)return false;
  if(filters.interview_from&&date<filters.interview_from||filters.interview_to&&date>filters.interview_to)return false;
  const days=Number(filters.interview_days||0);
  if(filters.interview_mode==='previous'&&(date>today||days>0&&date<new Date(Date.parse(today+'T00:00:00Z')-days*86400000).toISOString().slice(0,10)))return false;
  if(filters.interview_mode==='upcoming'&&(date<today||days>0&&date>new Date(Date.parse(today+'T00:00:00Z')+days*86400000).toISOString().slice(0,10)))return false;
  return true;
}
function countSelectedForSection(section, filters) {
  if (!section) return 0;
  if (section.type === 'options') return (filters[section.key] || []).length;
  if (section.type === 'interview-date') {
    return [filters.interview_from, filters.interview_to, filters.interview_mode, filters.interview_days].filter((item) => String(item || '').trim()).length;
  }
  return [filters[section.from], filters[section.to]].filter((item) => String(item || '').trim()).length;
}
function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}
function interviewDateKey(row = {}) {
  const raw = String(row?.interview_reschedule_date || row?.interview_date || row?.scheduled_at || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return crmYmd(raw) || raw.slice(0, 10);
}
function isNegativeProfileOutcome(row = {}) {
  const text = [row.status, row.candidate_status, row.profile_status, row.approval_status]
    .map((value) => String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' '))
    .join(' ');
  return /\bnot\s+int(?:er|r)ested\b/.test(text) || /\brejected\b/.test(text);
}

function isInterviewEligible(row) {
  // Interview pipeline is date-backed. Candidate status/approval must not hide a
  // profile that still has an interview date; removal/deletion is enforced by backend.
  return Boolean(interviewDateKey(row));
}
function compareValues(a, b, type = 'text') {
  if (type === 'date') return String(a || '').localeCompare(String(b || ''));
  if (type === 'number') return Number(a || 0) - Number(b || 0);
  return String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base', numeric: true });
}
function getSortMeta(sortKey) {
  if (sortKey === 'interview_date_effective') return { key: 'interview_date_effective', type: 'date' };
  return { key: sortKey, type: 'text' };
}
function sortRows(rows, sortConfig) {
  const { key, type } = getSortMeta(sortConfig.key);
  const factor = sortConfig.order === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary = compareValues(a[key], b[key], type);
    if (primary) return primary * factor;
    const dateFallback = compareValues(a.interview_date_effective, b.interview_date_effective, 'date');
    if (dateFallback) return dateFallback * -1;
    const recruiterFallback = compareValues(a.recruiter_code, b.recruiter_code, 'text');
    if (recruiterFallback) return recruiterFallback;
    const nameFallback = compareValues(a.full_name, b.full_name, 'text');
    if (nameFallback) return nameFallback;
    const interviewFallback = String(b.interview_id || '').localeCompare(String(a.interview_id || ''));
    if (interviewFallback) return interviewFallback;
    return String(b.candidate_id || '').localeCompare(String(a.candidate_id || ''));
  });
}


function readInstantInterviewRowsFromStorage() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem('careerCroxRealtimeCandidatePatch:v2');
    if (!raw) return [];
    const payload = JSON.parse(raw);
    const item = payload?.item || {};
    if (!item?.candidate_id || !hasInterviewDate(item)) return [];
    return [buildInstantInterviewRow(item)];
  } catch {
    return [];
  }
}

function mergeInterviewRowsWithInstant(incomingRows = [], currentRows = []) {
  const incoming = Array.isArray(incomingRows) ? incomingRows : [];
  const incomingIds = new Set(incoming.map((row) => String(row?.candidate_id || '').trim()).filter(Boolean));
  const pending = [
    ...(Array.isArray(currentRows) ? currentRows.filter((row) => row?.__instant_frontend_row) : []),
    ...readInstantInterviewRowsFromStorage(),
  ].filter((row) => String(row?.candidate_id || '').trim() && !incomingIds.has(String(row?.candidate_id || '').trim()));
  return mergeRowsById(pending, incoming.map((row) => ({ ...row, __instant_frontend_row: false })), 'candidate_id');
}

export default function InterviewsPage() {
  const [searchParams]=useSearchParams();
  const [createCandidates,setCreateCandidates]=useState([]);
  useEffect(()=>{if(searchParams.get('create')==='1'){let active=true;api.get('/api/candidates?page=1&limit=50',{cacheTtlMs:15000}).then(d=>{if(active)setCreateCandidates(d.items||[]);}).catch(()=>{});return()=>{active=false;};}},[searchParams]);
  const storedViewState = readViewState(INTERVIEWS_VIEW_STATE_KEY, {});
  const { user } = useAuth();
  const [today,setToday]=useState(()=>crmYmd(Date.now()));
  useEffect(()=>{
    const refreshDay=()=>setToday(crmYmd(Date.now()));
    const midnight=Date.parse(today+'T00:00:00+05:30')+86400000;
    const timer=setTimeout(refreshDay,Math.max(1000,midnight-Date.now()+100));
    const wake=()=>{if(!document.hidden)refreshDay();};
    document.addEventListener('visibilitychange',wake);
    return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',wake);};
  },[today]);
  const filterCatalog=useCandidateFilterCatalog(user);
  const staffFilterOptions=(filterCatalog.users||[]).map(u=>({value:u.recruiter_code||u.user_id,label:u.full_name||u.username||u.recruiter_code}));

  const interviewsCacheKey = `careerCroxInterviewsCache:${user?.user_id || user?.username || 'anon'}:${user?.role || ''}:${user?.recruiter_code || ''}`;
  const [allRows, setAllRows] = useState(() => readPageCache(interviewsCacheKey, []));
  const [filters, setFilters] = useState(() => ({ ...defaultFilters, ...(storedViewState.filters || {}),...(searchParams.get('date')?{interview_from:searchParams.get('date'),interview_to:searchParams.get('date')}: {}) }));
  useSliceSearch(filters.q||'',value=>setFilters(current=>({...current,q:value})));
  const [compactFilters, setCompactFilters] = useState(() => ({ ...defaultCompactFilters, ...(storedViewState.compactFilters || {}) }));
  const [sortConfig, setSortConfig] = useState(() => ({ ...defaultSort, ...(storedViewState.sortConfig || {}) }));
  const [quickView, setQuickView] = useState(searchParams.get('date')?'total':storedViewState.quickView||'today');
  useEffect(()=>{
    if(quickView!=='total')setFilters(previous=>({...previous,...interviewViewWindow(quickView,today)}));
  },[quickView,today]);
  const requestedDate=searchParams.get('date')||'';
  useEffect(()=>{if(/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)){setQuickView('total');setFilters(previous=>({...previous,interview_from:requestedDate,interview_to:requestedDate,interview_mode:'',interview_days:''}));}},[requestedDate]);
  const [sortBy,setSortBy]=useSliceState('interviews:sort','default');
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [activeFilterKey, setActiveFilterKey] = useState('status');
  const [optionSearches, setOptionSearches] = useState({});
  const [waTemplates, setWaTemplates] = useState(getWhatsAppTemplates());
  const [dialerTemplateValue, setDialerTemplateValue] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [dialerOpen, setDialerOpen] = useState(false);
  const [dialerIndex, setDialerIndex] = useState(0);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [message, setMessage] = useState('');

  const loadSeqRef = useRef(0);

  async function load(options = {}) {
    const force = Boolean(options.force);
    const loadSeq = ++loadSeqRef.current;
    // CC26_683: cached rows render immediately. Only an explicit manual Refresh bypasses
    // cache; normal navigation must not create a full interview-table read.
    const interviewUrl = force ? '/api/interviews?_refresh=1' : '/api/interviews';
    const data = await api.get(interviewUrl, { cacheTtlMs: force ? 0 : 60000, timeoutMs: 15000, retries: 0, allowStale: !force, background: false });
    if (loadSeq !== loadSeqRef.current) return;
    const items = (Array.isArray(data?.items) ? data.items : []).map((row) => {
      const interviewDate = interviewDateKey(row);
      return {
        ...row,
        interview_date_effective: interviewDate,
        recruiter_code_list: splitValues(row.recruiter_code),
        process_list: splitValues(row.process),
        preferred_location_list: splitValues(row.preferred_location),
      };
    });
    const mergedItems = mergeInterviewRowsWithInstant(items, readPageCache(interviewsCacheKey, []));
    setAllRows(mergedItems);
    writePageCache(interviewsCacheKey, mergedItems.slice(0, 1200));
  }

  useEffect(() => { load().catch(() => {}); }, []);

  useEffect(() => onCandidateRealtime(({ item }) => {
    const candidateKey = String(item?.candidate_id || '');
    if (!candidateKey || !hasInterviewDate(item)) return;
    const instantRow = buildInstantInterviewRow(item);
    setAllRows((current) => {
      const base = Array.isArray(current) ? current : [];
      const next = mergeRowsById(base, [instantRow], 'candidate_id');
      writePageCache(interviewsCacheKey, next.slice(0, 1200));
      return next;
    });
    setMessage('Instant update: profile added/updated in Interview Pipeline. Manual Refresh can verify backend sync.');
  }), [interviewsCacheKey]);
  useSmartDeltaSync({
    onInvalidate:()=>load({force:true}).catch(()=>{}),
    scope: 'interviews',
    idKey: 'candidate_id',
    rows: allRows,
    onRows: (changedRows) => {
      const mapped = changedRows.map((row) => {
        const interviewDate = interviewDateKey(row);
        return {
          ...row,
          interview_date_effective: interviewDate,
          recruiter_code_list: splitValues(row.recruiter_code),
          process_list: splitValues(row.process),
          preferred_location_list: splitValues(row.preferred_location),
        };
      });
      setAllRows((current) => {
        const next = mergeRowsById(current, mapped, 'candidate_id');
        writePageCache(interviewsCacheKey, next.slice(0, 1200));
        return next;
      });
    },
  });

  const eligibleRows = useMemo(() => allRows.filter(isInterviewEligible), [allRows]);

  useEffect(() => {
    writeViewState(INTERVIEWS_VIEW_STATE_KEY, { filters, compactFilters, sortConfig,quickView });
  }, [filters, compactFilters, sortConfig, quickView]);

  function openCandidateProfile(row) {
    if (!row?.candidate_id) return;
    // Exactly the displayed date/recruiter groups, in their rendered order.
    const navRows = grouped.flatMap(group => group.recruiters.flatMap(bucket => bucket.items));
    openCandidateProfileInNewTab(row, navRows, { sourcePath: `${window.location.pathname}${window.location.search || ''}`, sourceKind: 'interviews', totalRows: navRows.length, hasMore: false });
  }

  const optionRows=useMemo(()=>[...eligibleRows,...(filterCatalog.rows||[])],[eligibleRows,filterCatalog.rows]);
  const filterSections = useMemo(() => ([
    { key: 'recruiter_code', label: 'Recruiter / TL', type: 'options', options: staffFilterOptions.map(o=>o.value) },
    { key: 'interview_date', label: 'Interview date', type: 'interview-date' },
    { key: 'preferred_location', label: 'Preferred Location', type: 'options', options: uniqueOptions(optionRows, (row) => row.preferred_location, true) },
    { key: 'communication_skill', label: 'Communication Skill', type: 'options', options: uniqueOptions(optionRows, (row) => row.communication_skill) },
    { key: 'process', label: 'Process', type: 'options', options: uniqueOptions(optionRows, (row) => row.process, true) },
    { key: 'virtual_onsite', label: 'Virtual', type: 'options', options: uniqueOptions(optionRows, (row) => row.virtual_onsite) },
    { key: 'status', label: 'Status', type: 'options', options: uniqueOptions(optionRows, (row) => row.status) },
    { key: 'all_details_sent', label: 'All Details Sent', type: 'options', options: uniqueOptions(optionRows, (row) => row.all_details_sent) },
    { key: 'submission_date', label: 'Submission Date', type: 'date-range', from: 'submission_from', to: 'submission_to' },
    { key: 'career_gap', label: 'Career Gap', type: 'options', options: uniqueOptions(optionRows, (row) => row.career_gap) },
    { key: 'relevant_exp_range', label: 'Relavant Exp Range', type: 'options', options: uniqueOptions(optionRows, (row) => row.relevant_experience_range) },
    { key: 'relevant_salary_range', label: 'Relavant Inhand Salary Range', type: 'options', options: uniqueOptions(optionRows, (row) => row.relevant_in_hand_range) },
    { key: 'qualification', label: 'Current Qualification', type: 'options', options: uniqueOptions(optionRows, (row) => normalizeQualificationCategory(row.qualification_level || '', row.qualification || '')) },
  ]), [optionRows,filterCatalog.users]);

  const compactFilterOptions = useMemo(() => ({
    recruiter_code: staffFilterOptions.map(o=>o.value),
    communication_skill: uniqueOptions(optionRows, (row) => row.communication_skill),
    preferred_location: uniqueOptions(optionRows, (row) => row.preferred_location, true),
    qualification: uniqueOptions(optionRows, (row) => normalizeQualificationCategory(row.qualification_level || '', row.qualification || '')),
    relevant_exp_range: uniqueOptions(optionRows, (row) => row.relevant_experience_range),
    relevant_salary_range: uniqueOptions(optionRows, (row) => row.relevant_in_hand_range),
  }), [optionRows,filterCatalog.users]);

  const activeSection = useMemo(() => filterSections.find((section) => section.key === activeFilterKey) || filterSections[0] || null, [filterSections, activeFilterKey]);
  const activeOptionSearch = optionSearches[activeSection?.key] || '';
  const activeVisibleOptions = useMemo(() => {
    if (!activeSection || activeSection.type !== 'options') return [];
    return (activeSection.options || []).filter((item) => containsText(activeSection.key==='recruiter_code'?(staffFilterOptions.find(o=>o.value===item)?.label||item):item, activeOptionSearch));
  }, [activeSection, activeOptionSearch]);

  const baseFilteredRows = useMemo(() => {
    return eligibleRows.filter((row) => {
      if(filters.q&&!['full_name','phone','candidate_id'].some(key=>String(row[key]||'').toLowerCase().includes(filters.q.toLowerCase())))return false;
      const interviewDate = row.interview_date_effective || '';
      if ((filters.recruiter_code || []).length && !row.recruiter_code_list.some((item) => filters.recruiter_code.includes(item))) return false;
      if ((filters.preferred_location || []).length && !row.preferred_location_list.some((item) => filters.preferred_location.includes(item))) return false;
      if ((filters.communication_skill || []).length && !(filters.communication_skill || []).includes(String(row.communication_skill || ''))) return false;
      if ((filters.process || []).length && !row.process_list.some((item) => filters.process.includes(item))) return false;
      if ((filters.virtual_onsite || []).length && !(filters.virtual_onsite || []).includes(String(row.virtual_onsite || ''))) return false;
      if ((filters.status || []).length && !(filters.status || []).includes(String(row.status || ''))) return false;
      if ((filters.all_details_sent || []).length && !(filters.all_details_sent || []).includes(String(row.all_details_sent || ''))) return false;
      if ((filters.career_gap || []).length && !(filters.career_gap || []).includes(String(row.career_gap || ''))) return false;
      if ((filters.relevant_exp_range || []).length && !(filters.relevant_exp_range || []).includes(String(row.relevant_experience_range || ''))) return false;
      if ((filters.relevant_salary_range || []).length && !(filters.relevant_salary_range || []).includes(String(row.relevant_in_hand_range || ''))) return false;
      if ((filters.qualification || []).length && !(filters.qualification || []).includes(String(row.qualification_level || row.qualification || ''))) return false;

      if (compactFilters.recruiter_code && !row.recruiter_code_list.includes(compactFilters.recruiter_code)) return false;
      if (compactFilters.communication_skill && String(row.communication_skill || '') !== compactFilters.communication_skill) return false;
      if (compactFilters.preferred_location && !row.preferred_location_list.includes(compactFilters.preferred_location)) return false;
      if (compactFilters.qualification && String(row.qualification_level || row.qualification || '') !== compactFilters.qualification) return false;
      if (compactFilters.relevant_exp_range && String(row.relevant_experience_range || '') !== compactFilters.relevant_exp_range) return false;
      if (compactFilters.relevant_salary_range && String(row.relevant_in_hand_range || '') !== compactFilters.relevant_salary_range) return false;

      if (filters.submission_from && String(row.submission_date || '') < String(filters.submission_from)) return false;
      if (filters.submission_to && String(row.submission_date || '') > String(filters.submission_to)) return false;
      return true;
    });
  }, [eligibleRows, filters, compactFilters]);

  const cardStats = useMemo(() => {
    const tomorrow = interviewViewWindow('tomorrow',today).interview_from;
    const weekStart = interviewViewWindow('week',today).interview_from;
    const weekEnd = interviewViewWindow('week',today).interview_to;
    const activeRows = baseFilteredRows.filter(row=>!isInactiveProfile(row));
    return {
      inactive: baseFilteredRows.filter(isInactiveProfile).length,
      today: activeRows.filter((row) => row.interview_date_effective === today).length,
      tomorrow: activeRows.filter((row) => row.interview_date_effective === tomorrow).length,
      total: activeRows.length,
      upcoming: activeRows.filter((row) => row.interview_date_effective && row.interview_date_effective > today).length,
      missed: activeRows.filter((row) => row.interview_date_effective && row.interview_date_effective < today).length,
      week: activeRows.filter((row) => row.interview_date_effective && row.interview_date_effective >= weekStart && row.interview_date_effective <= weekEnd).length,
    };
  }, [baseFilteredRows,today]);

  const quickViewRows = useMemo(() => {
    const currentView = quickView || 'today';
    const dateWindow=currentView==='total'?filters:interviewViewWindow(currentView,today);
    const visible = baseFilteredRows.filter((row) => {
      if(currentView==='inactive')return isInactiveProfile(row)&&matchesInterviewDateWindow(row,dateWindow,today);
      if(isInactiveProfile(row))return false;
      return matchesInterviewDateWindow(row,dateWindow,today);
    });
    return sortCrmRows(sortRows(visible, sortConfig),sortBy);
  }, [baseFilteredRows, quickView, sortConfig,sortBy,filters,today]);

  const dialerSourceRows = useMemo(() => Array.from(new Map(quickViewRows.filter(row=>!isInactiveProfile(row)).map((row) => [String(row.candidate_id), row])).values()), [quickViewRows]);
  const selectedRows = useMemo(() => {
    const rowById = new Map(dialerSourceRows.map((row) => [String(row.candidate_id), row]));
    return selectedIds.map((id) => rowById.get(String(id))).filter(Boolean);
  }, [dialerSourceRows, selectedIds]);
  const currentDialerTarget = selectedRows[dialerIndex] || selectedRows[0] || null;
  const allSelected = dialerSourceRows.length > 0 && selectedIds.length === dialerSourceRows.length;

  const grouped = useMemo(() => {
    const dateMap = new Map();
    quickViewRows.forEach((row) => {
      const dateKey = row.interview_date_effective || 'No date';
      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, {
          dateKey,
          dateLabel: formatDateLabel(dateKey),
          recruiterMap: new Map(),
        });
      }
      const group = dateMap.get(dateKey);
      const recruiterKey = row.recruiter_code || 'No recruiter';
      if (!group.recruiterMap.has(recruiterKey)) {
        group.recruiterMap.set(recruiterKey, { recruiterCode: recruiterKey, items: [] });
      }
      group.recruiterMap.get(recruiterKey).items.push(row);
    });
    return Array.from(dateMap.values()).map((group) => ({
      dateKey: group.dateKey,
      dateLabel: group.dateLabel,
      recruiters: Array.from(group.recruiterMap.values()),
    }));
  }, [quickViewRows]);

  const activeCount = useMemo(() => {
    const modalCount = filterSections.reduce((sum, section) => sum + countSelectedForSection(section, filters), 0);
    const compactCount = Object.values(compactFilters).filter((item) => String(item || '').trim()).length;
    return modalCount + compactCount;
  }, [filterSections, filters, compactFilters]);

  useEffect(() => {
    const visibleIds = new Set(dialerSourceRows.map((row) => String(row.candidate_id)));
    setSelectedIds((prev) => prev.filter((id) => visibleIds.has(String(id))));
  }, [dialerSourceRows]);

  useEffect(() => {
    if (!selectedRows.length) {
      setDialerOpen(false);
      setDialerIndex(0);
      return;
    }
    if (selectedRows.length >= 2) setDialerOpen(true);
    if (dialerIndex >= selectedRows.length) setDialerIndex(0);
  }, [selectedRows.length, dialerIndex]);

  async function manualRefreshInterviews() {
    setManualRefreshing(true);
    try {
      await load({ force: true });
      setMessage('Interview Pipeline manually refreshed from backend.');
    } catch (err) {
      setMessage(err?.message || 'Manual refresh failed.');
    } finally {
      setManualRefreshing(false);
    }
  }

  function resetFilters() {
    clearViewState(INTERVIEWS_VIEW_STATE_KEY);
    setFilters(defaultFilters);
    setCompactFilters(defaultCompactFilters);
    setOptionSearches({});
    setSortConfig(defaultSort);
    setQuickView('today');
    setSelectedIds([]);
    setDialerOpen(false);
    setDialerIndex(0);
  }
  function selectInterviewView(view){
    setQuickView(view);
    setFilters(previous=>({...previous,...interviewViewWindow(view,today)}));
  }
  function changeInterviewDate(key,value){
    setQuickView('total');
    setFilters(previous=>({...previous,[key]:value}));
  }



  function clearSection(section) {
    if (!section) return;
    if (section.type === 'options') setFilters((prev) => ({ ...prev, [section.key]: [] }));
    else if (section.type === 'interview-date') setFilters((prev) => ({ ...prev, interview_from: '', interview_to: '', interview_mode: '', interview_days: '' }));
    else setFilters((prev) => ({ ...prev, [section.from]: '', [section.to]: '' }));
  }

  function handleCompactChange(key, value) {
    setCompactFilters((prev) => ({ ...prev, [key]: value }));
  }

  async function dialCandidate(candidateId, phone, row = {}) {
    try {
      await dialCandidateWithLog(candidateId, phone, row || {});
      setMessage('Calling command sent to paired mobile app.');
    } catch (error) {
      setMessage(error?.message || 'Could not start mobile call.');
    }
  }

  function selectedDialerWhatsAppMessage(row = currentDialerTarget) {
    const template = decodeWhatsAppTemplateOption(dialerTemplateValue);
    return template?.body ? renderWhatsAppTemplateBody(template.body, row || {}, user) : '';
  }

  function openWhatsApp(candidateId, phone, template = '', options = {}) {
    return openWhatsAppWithLog(candidateId, phone, template, options);
  }

  function onDialerTemplatePick(value) {
    if (value === '__add_new__') {
      const fresh = window.prompt('Type new WhatsApp template');
      if (fresh) {
        const next = addWhatsAppTemplate(fresh);
        setWaTemplates(next);
        const last = Array.isArray(next) ? next[next.length - 1] : fresh;
        setDialerTemplateValue(encodeWhatsAppTemplateOption(last, Math.max(0, (Array.isArray(next) ? next.length : 1) - 1)));
      }
      return;
    }
    setDialerTemplateValue(value || '');
  }

  async function startCallingWithWhatsApp(row = currentDialerTarget) {
    if (!row?.candidate_id) return;
    // CC905: the shared action opens WhatsApp Desktop; no preparatory tab.
    const messageText = selectedDialerWhatsAppMessage(row);
    const callPromise = dialCandidateWithLog(row.candidate_id, row.phone, row || {});
    const waPromise = openWhatsAppWithLog(row.candidate_id, row.phone, messageText);
    const results = await Promise.allSettled([callPromise, waPromise]);
    const callOk = results[0]?.status === 'fulfilled';
    const waOk = results[1]?.status === 'fulfilled';
    setMessage(callOk && waOk ? 'Mobile call started + WhatsApp Desktop requested with selected preset.' : callOk ? 'Call started. WhatsApp could not open.' : 'Could not start combined Call + WhatsApp action.');
  }

  function toggleSelection(candidateId) {
    setSelectedIds((prev) => prev.includes(candidateId) ? prev.filter((id) => id !== candidateId) : [...prev, candidateId]);
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => (prev.length === dialerSourceRows.length ? [] : dialerSourceRows.map((row) => row.candidate_id)));
  }

  function clearSelection() {
    setSelectedIds([]);
    setDialerOpen(false);
    setDialerIndex(0);
  }

  async function loadSelectedToAutoDialer() {
    if (!selectedRows.length) return;
    const startRow = currentDialerTarget || selectedRows[0];
    const startId = String(startRow?.candidate_id || '');
    const startIndex = selectedRows.findIndex((row) => String(row.candidate_id) === startId);
    const orderedItems = startIndex > 0 ? [...selectedRows.slice(startIndex), ...selectedRows.slice(0, startIndex)] : selectedRows;
    const payload = { source: 'Interviews', items: orderedItems.map((row, index) => ({ ...row, queue_order: index + 1, dialer_sequence: index + 1, __dialer_order: index + 1 })), start_candidate_id: startId, created_at: new Date().toISOString() };
    try { sessionStorage.setItem('careerCroxAutoDialerQueue:v1', JSON.stringify(payload)); localStorage.setItem('careerCroxAutoDialerQueue:v1', JSON.stringify(payload)); } catch {}
    navigateSameTab('/auto-dialer');
  }


  function nextSelected() {
    if (!selectedRows.length) return;
    setDialerIndex((prev) => (prev + 1) % selectedRows.length);
  }

  function prevSelected() {
    if (!selectedRows.length) return;
    setDialerIndex((prev) => (prev - 1 + selectedRows.length) % selectedRows.length);
  }

  return (
    <Layout title="Interview Pipeline" subtitle="">
      {searchParams.get('create')==='1'?<section className="panel cc790-interview-create"><h2 className="panel-title">Schedule an interview</h2><p className="helper-text">Choose a candidate to open their interview details.</p><div className="row-actions">{createCandidates.slice(0,12).map(c=><button key={c.candidate_id} className="ghost-btn" onClick={()=>openCandidateProfileInNewTab(c,createCandidates,{sourceKind:'interviews',sourcePath:'/interviews',jump:'interview'})}>{c.full_name||c.candidate_id}</button>)}<button className="add-profile-btn" onClick={()=>navigateSameTab('/candidates?add-interview=1')}>Find candidate</button></div></section>:null}
      {message ? <div className="alert success">{message}</div> : null}
      <div className="panel top-gap-small interview-summary-grid six-up">
        {quickViewOptions.map((card) => {
          const metricValue = cardStats[card.key] || 0;
          const active = quickView === card.key;
          return (
            <button
              type="button"
              key={card.key}
              className={`metric-card compact gradient-card clickable-summary-card ${card.cardClass} ${active ? 'metric-card-active' : ''}`}
              aria-pressed={active}
              onClick={() => selectInterviewView(card.key)}
            >
              <div className="metric-label">{card.label}</div>
              <div className="metric-value">{metricValue}</div>
              <div className="metric-sub">{card.sub}</div>
            </button>
          );
        })}
      </div>

      <div className="table-panel top-gap glassy-card fade-up interview-workspace-panel">
        <div className="table-toolbar no-wrap-toolbar interview-toolbar-wrap">
          <div className="table-title">{quickViewOptions.find(card=>card.key===quickView)?.label||'Interview Pipeline'}<small style={{display:'block',fontSize:11,fontWeight:400}}>{quickView==='today'?formatDateLabel(today)+' · IST':quickView==='tomorrow'?formatDateLabel(interviewViewWindow('tomorrow',today).interview_from)+' · IST':filters.interview_from||filters.interview_to?(filters.interview_from||'Start')+' → '+(filters.interview_to||'Any date')+' · IST':'All interview dates'}</small></div>
          <div className="toolbar-actions compact-pills candidate-toolbar-actions interview-toolbar-actions">
            <button type="button" data-cc926-keep="true" className="ghost-btn" aria-label="Interview reminder settings" onClick={()=>openReminderSchedule('interview')}>⏰ Reminders</button>
            <div className="interview-sort-strip"><CrmSortSelect value={sortBy} onChange={setSortBy}/>
              <div className="compact-select-shell interview-sort-shell shell-violet">
                <span className="compact-shell-label">Sort by</span>
                <PremiumSelect className="inline-input compact-inline-input" value={sortConfig.key} onChange={(e) => setSortConfig((prev) => ({ ...prev, key: e.target.value }))}>
                  {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </PremiumSelect>
              </div>
              <div className="compact-select-shell interview-sort-shell narrow shell-blue">
                <span className="compact-shell-label">Order</span>
                <PremiumSelect className="inline-input compact-inline-input" value={sortConfig.order} onChange={(e) => setSortConfig((prev) => ({ ...prev, order: e.target.value }))}>
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </PremiumSelect>
              </div>
            </div>
            <button type="button" className="ghost-btn bounceable gradient-action-btn gradient-blue" onClick={manualRefreshInterviews} disabled={manualRefreshing}>{manualRefreshing ? 'Refreshing...' : 'Manual Refresh'}</button>
            <span className="metric-mini-chip records">{quickViewRows.length} records</span>
            <span className="metric-mini-chip filters">{activeCount} filters</span>
            <button type="button" className="ghost-btn bounceable gradient-action-btn gradient-rose" onClick={resetFilters}>Reset All</button>
            <button type="button" className="ghost-btn bounceable modern-filter-btn gradient-action-btn gradient-slate" onClick={() => setShowFilterModal(true)}><FilterIcon /> Filters</button>
          </div>
        </div>

        <div className="interview-quick-filter-strip">
          <div className="compact-select-shell shell-indigo">
            <span className="compact-shell-label">Recruiter</span>
            <PremiumSelect className="inline-input compact-inline-input" value={compactFilters.recruiter_code} onChange={(e) => handleCompactChange('recruiter_code', e.target.value)}>
              <option value="">All Recruiters</option>
              {compactFilterOptions.recruiter_code.map((item) => <option key={item} value={item}>{staffFilterOptions.find(o=>o.value===item)?.label||item}</option>)}
            </PremiumSelect>
          </div>
          <div className="compact-select-shell shell-cyan">
            <span className="compact-shell-label">Communication</span>
            <PremiumSelect className="inline-input compact-inline-input" value={compactFilters.communication_skill} onChange={(e) => handleCompactChange('communication_skill', e.target.value)}>
              <option value="">All Communication</option>
              {compactFilterOptions.communication_skill.map((item) => <option key={item} value={item}>{staffFilterOptions.find(o=>o.value===item)?.label||item}</option>)}
            </PremiumSelect>
          </div>
          <div className="compact-select-shell shell-green">
            <span className="compact-shell-label">Preferred Location</span>
            <PremiumSelect className="inline-input compact-inline-input" value={compactFilters.preferred_location} onChange={(e) => handleCompactChange('preferred_location', e.target.value)}>
              <option value="">All Preferred Location</option>
              {compactFilterOptions.preferred_location.map((item) => <option key={item} value={item}>{staffFilterOptions.find(o=>o.value===item)?.label||item}</option>)}
            </PremiumSelect>
          </div>
          <div className="compact-select-shell shell-peach">
            <span className="compact-shell-label">Qualification</span>
            <PremiumSelect className="inline-input compact-inline-input" value={compactFilters.qualification} onChange={(e) => handleCompactChange('qualification', e.target.value)}>
              <option value="">All Qualification</option>
              {compactFilterOptions.qualification.map((item) => <option key={item} value={item}>{staffFilterOptions.find(o=>o.value===item)?.label||item}</option>)}
            </PremiumSelect>
          </div>
          <div className="compact-select-shell shell-gold">
            <span className="compact-shell-label">Relevant Experience</span>
            <PremiumSelect className="inline-input compact-inline-input" value={compactFilters.relevant_exp_range} onChange={(e) => handleCompactChange('relevant_exp_range', e.target.value)}>
              <option value="">All Experience Range</option>
              {compactFilterOptions.relevant_exp_range.map((item) => <option key={item} value={item}>{staffFilterOptions.find(o=>o.value===item)?.label||item}</option>)}
            </PremiumSelect>
          </div>
          <div className="compact-select-shell shell-lilac">
            <span className="compact-shell-label">Inhand Salary</span>
            <PremiumSelect className="inline-input compact-inline-input" value={compactFilters.relevant_salary_range} onChange={(e) => handleCompactChange('relevant_salary_range', e.target.value)}>
              <option value="">All Salary Range</option>
              {compactFilterOptions.relevant_salary_range.map((item) => <option key={item} value={item}>{staffFilterOptions.find(o=>o.value===item)?.label||item}</option>)}
            </PremiumSelect>
          </div>
        </div>

        <div className="candidate-master-row interview-selection-row">
          <button type="button" className={`selection-master-pill bounceable ${allSelected ? 'active' : ''}`} onClick={toggleSelectAll}>
            <span className="selection-master-icon"><SelectAllIcon /></span>
            {allSelected ? 'Clear All' : 'Select All'}
          </button>
          <span className="selection-count-chip interview-master-count">{selectedIds.length} selected</span>
          <button type="button" className={`open-dialer-pill bounceable ${selectedRows.length >= 2 ? 'active' : ''}`} onClick={() => setDialerOpen((prev) => selectedRows.length >= 2 ? !prev : false)} disabled={selectedRows.length < 2}>
            <DialerIcon /> Open Dialer
          </button>
          <button type="button" className="add-profile-btn bounceable" onClick={loadSelectedToAutoDialer} disabled={selectedRows.length < 2}>Load to Auto Dialer</button>
          {selectedRows.length ? <button type="button" className="ghost-btn bounceable gradient-action-btn gradient-amber" onClick={clearSelection}>Clear Selection</button> : null}
        </div>

        {dialerOpen && currentDialerTarget ? (
          <div className="floating-dialer show top-gap-small">
            <div className="dialer-head">
              <div>
                <h3 className="dialer-title">Interview Dialer</h3>
                <div className="helper-text">{selectedRows.length} selected • {dialerIndex + 1} / {selectedRows.length}</div>
              </div>
              <button type="button" className="mini-btn ghost bounceable" onClick={() => setDialerOpen(false)} title="Close Dialer"><CloseIcon /></button>
            </div>

            <div className="dialer-now">
              <div className="helper-text">Current target</div>
              {safeCellText(currentDialerTarget.full_name, '-')} • {visiblePhone(user, currentDialerTarget.phone || '')}
            </div>

            <div className="dialer-actions-row row-actions interview-dialer-actions">
              <button type="button" className="mini-btn ghost bounceable modern-nav-btn" onClick={prevSelected} title="Previous"><PrevIcon /></button>
              <button type="button" className="interview-call-action start-call" onClick={() => dialCandidate(currentDialerTarget.candidate_id, currentDialerTarget.phone, currentDialerTarget)} title="Start mobile calling"><PhoneIcon /><span>Start Calling</span></button>
              <button type="button" className="interview-call-action start-call-wa" onClick={() => startCallingWithWhatsApp(currentDialerTarget)} title="Start call and open WhatsApp"><span className="combo-icons"><PhoneIcon /><WhatsAppIcon /></span><span>Start Calling + WhatsApp</span></button>
              <button type="button" className="mini-btn edit bounceable modern-icon-btn modern-wa-btn" onClick={() => openWhatsApp(currentDialerTarget.candidate_id, currentDialerTarget.phone, selectedDialerWhatsAppMessage(currentDialerTarget))} title="Open WhatsApp only"><WhatsAppIcon /></button>
              <PremiumSelect className="wa-template-select dialer-template-select" value={dialerTemplateValue} onChange={(e) => onDialerTemplatePick(e.target.value)}>
                <option value="">WA Preset (optional)</option>
                {(Array.isArray(waTemplates) ? waTemplates : []).slice(0, 80).map((tpl, index) => {
                  const option = normalizeWhatsAppTemplateOption(tpl, index);
                  return option ? <option key={`${option.title}-${index}`} value={encodeWhatsAppTemplateOption(option, index)}>{option.title}</option> : null;
                })}
                <option value="__add_new__">+ Add New Preset...</option>
              </PremiumSelect>
              <button type="button" className="mini-btn ghost bounceable modern-nav-btn" onClick={nextSelected} title="Next"><NextIcon /></button>
              <button type="button" className="open-profile-chip bounceable" onClick={() => openCandidateProfile(currentDialerTarget)}>Open Profile</button>
            </div>
          </div>
        ) : null}

        <div className="interview-groups-stack top-gap-small">
          {grouped.map((group) => (
            <div className="panel interview-date-panel" key={group.dateKey}>
              <div className="interview-date-header">
                <div>
                  <div className="panel-title">{group.dateLabel}</div>
                </div>
                <span className="metric-mini-chip records stat-chip stat-chip-interviews">{group.recruiters.reduce((sum, recruiter) => sum + recruiter.items.length, 0)} interviews</span>
              </div>

              <div className="interview-recruiter-blocks top-gap-small">
                {group.recruiters.map((bucket) => (
                  <div className="interview-recruiter-panel" key={`${group.dateKey}-${bucket.recruiterCode}`}>
                    <div className="interview-recruiter-head">
                      <div className="interview-recruiter-title">{bucket.items.find(row => row.recruiter_name)?.recruiter_name || bucket.recruiterCode}</div>
                      <span className="metric-mini-chip records stat-chip stat-chip-profiles">{bucket.items.length} profiles</span>
                    </div>
                    <div className="crm-table-wrap dense-wrap top-gap-small">
                      <table className="crm-table colorful-table dense-table interview-readable-table readable-flow-table">
                        <thead>
                          <tr>
                            <th style={{ width: 84 }} className="interview-table-check-col"><span className="table-select-heading">Select</span></th>
                            <th>Candidate</th>
                            <th>Phone</th>
                            <th>Location</th>
                            <th>Preferred Location</th>
                            <th>Communication</th>
                            <th>Status</th>
                            <th>All Details Sent</th>
                            <th>Submission Date</th>
                            <th className="sticky-action-col">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bucket.items.map((row) => {
                            const selected = selectedIds.includes(row.candidate_id);
                            return (
                              <tr key={`${row.candidate_id}-${row.interview_date_effective}-${row.recruiter_code}`} className={`clickable-row ${selected ? 'selected-row' : ''} ${isNegativeProfileOutcome(row) ? 'cc-negative-profile-row' : ''}`} onClick={() => openCandidateProfile(row)}>
                                <td>
                                  <button type="button" className={`row-check-btn bounceable ${selected ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); toggleSelection(row.candidate_id); }} title={selected ? 'Selected' : 'Select this candidate'}>
                                    <CheckIcon />
                                  </button>
                                </td>
                                <td><strong>{row.full_name || '-'}</strong><br /><span className="subtle">{row.candidate_id}</span>{row.data_notes ? <div className="helper-text submission-mini-text">Notes: {row.data_notes}</div> : null}</td>
                                <td>{visiblePhone(user, row.phone)}</td>
                                <td>{row.location || '-'}</td>
                                <td>{row.preferred_location || '-'}</td>
                                <td>{row.communication_skill || '-'}</td>
                                <td><span className="status-chip">{row.status || '-'}</span></td>
                                <td><span className="status-chip secondary">{row.all_details_sent || '-'}</span></td>
                                <td>{formatCrmDateTime(row.submission_date) || '-'}</td>
                                <td className="sticky-actions-cell">
                                  <div className="row-actions nowrap-actions compact-row-actions">
                                    <button type="button" className="mini-btn view" aria-label={'Interview reminders for '+(row.full_name||row.candidate_id)} title="Reminder settings" onClick={e=>{e.stopPropagation();openReminderSchedule('interview',row);}}>⏰</button>
                                    <button className="mini-btn call bounceable modern-icon-btn modern-eye-btn" type="button" title="Open Profile" onClick={(e) => { e.stopPropagation(); openCandidateProfile(row); }}><EyeIcon /></button>
                                    <button className="mini-btn view bounceable modern-icon-btn modern-call-btn" type="button" title="Dial Call" onClick={(e) => { e.stopPropagation(); dialCandidate(row.candidate_id, row.phone); }}><PhoneIcon /></button>
                                    <button className="mini-btn edit bounceable modern-icon-btn modern-wa-btn" type="button" title="Open WhatsApp" onClick={(e) => { e.stopPropagation(); openWhatsApp(row.candidate_id, row.phone, ''); }}><WhatsAppIcon /></button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!grouped.length ? <div className="panel top-gap-small"><div className="helper-text">No interview profiles match the current filter set.</div></div> : null}
        </div>
      </div>

      {showFilterModal && (
        <div className="crm-modal-backdrop candidate-drawer-backdrop wide" onClick={() => setShowFilterModal(false)}>
          <div className="candidate-filter-modal" onClick={(e) => e.stopPropagation()}>
            <div className="candidate-filter-modal-head">
              <div>
                <div className="candidate-filter-modal-title"><FilterIcon /> Interview Filters</div>
                <div className="helper-text">Choose a filter on the left and mark options on the right.</div>
              </div>
              <div className="candidate-filter-head-actions">
                {activeCount ? <span className="mini-chip live-chip">{activeCount} active</span> : <span className="mini-chip">Default view</span>}
                <button type="button" className="ghost-btn bounceable" onClick={resetFilters}>Reset</button>
                <button type="button" className="add-profile-btn bounceable" onClick={() => setShowFilterModal(false)}>Done</button>
              </div>
            </div>
            <div className="candidate-filter-modal-body">
              <aside className="candidate-filter-sidebar">
                <div className="candidate-filter-nav">
                  {filterSections.map((section) => {
                    const selectedCount = countSelectedForSection(section, filters);
                    const isActive = activeSection?.key === section.key;
                    return (
                      <button key={section.key} type="button" className={`candidate-filter-nav-item ${isActive ? 'active' : ''} ${selectedCount ? 'selected' : ''}`} onClick={() => setActiveFilterKey(section.key)}>
                        <div>
                          <strong>{section.label}</strong>
                          <span>{selectedCount ? `${selectedCount} selected` : 'All'}</span>
                        </div>
                        <ArrowIcon />
                      </button>
                    );
                  })}
                </div>
              </aside>

              <section className="candidate-filter-detail-panel">
                {activeSection ? (
                  <>
                    <div className="candidate-filter-detail-head">
                      <div>
                        <div className="candidate-filter-detail-title">{activeSection.label}</div>
                        <div className="candidate-filter-detail-sub">Mark the exact values you want to keep in the interview view.</div>
                      </div>
                      <button type="button" className="ghost-btn bounceable candidate-inline-clear" onClick={() => clearSection(activeSection)}>Clear</button>
                    </div>

                    {activeSection.type === 'options' ? (
                      <>
                        <div className="field no-label-field">
                          <input className="inline-input" value={activeOptionSearch} onChange={(e) => setOptionSearches((prev) => ({ ...prev, [activeSection.key]: e.target.value }))} placeholder={`Search ${activeSection.label}`} />
                        </div>
                        <div className="candidate-option-grid roomy two-col top-gap-small">
                          {activeVisibleOptions.map((item) => {
                            const checked = (filters[activeSection.key] || []).includes(item);
                            return (
                              <label key={item} className={`candidate-option-card ${checked ? 'checked' : ''}`}>
                                <input type="checkbox" checked={checked} onChange={() => setFilters((prev) => toggleArrayValue(prev, activeSection.key, item))} />
                                <span>{activeSection.key==='recruiter_code'?(staffFilterOptions.find(o=>o.value===item)?.label||item):item}</span>
                              </label>
                            );
                          })}
                          {!activeVisibleOptions.length ? <div className="helper-text">No options found.</div> : null}
                        </div>
                      </>
                    ) : activeSection.type === 'interview-date' ? (
                      <div className="top-gap-small interview-filter-stack">
                        <div className="candidate-range-row wider">
                          <div className="field"><label>From Date</label><input className="inline-input" type="date" value={filters.interview_from} onChange={(e) => changeInterviewDate('interview_from',e.target.value)} /></div>
                          <div className="field"><label>To Date</label><input className="inline-input" type="date" value={filters.interview_to} onChange={(e) => changeInterviewDate('interview_to',e.target.value)} /></div>
                        </div>
                        <div className="field top-gap-small"><label>Quick View</label>
                          <div className="choice-chip-row">
                            <button type="button" className={`choice-chip bounceable ${filters.interview_mode === 'previous' ? 'active' : ''}`} onClick={() => changeInterviewDate('interview_mode',filters.interview_mode==='previous'?'':'previous')}>Previous</button>
                            <button type="button" className={`choice-chip bounceable ${filters.interview_mode === 'upcoming' ? 'active' : ''}`} onClick={() => changeInterviewDate('interview_mode',filters.interview_mode==='upcoming'?'':'upcoming')}>Upcoming</button>
                          </div>
                        </div>
                        <div className="field top-gap-small"><label>Days</label><input className="inline-input" type="number" min="1" value={filters.interview_days} onChange={(e) => changeInterviewDate('interview_days',e.target.value)} placeholder="Example: 7" /></div>
                      </div>
                    ) : (
                      <div className="candidate-range-row wider top-gap-small">
                        <div className="field"><label>{activeSection.type === 'date-range' ? 'From Date' : 'From'}</label><input className="inline-input" type={activeSection.type === 'date-range' ? 'date' : 'number'} value={filters[activeSection.from]} onChange={(e) => setFilters((prev) => ({ ...prev, [activeSection.from]: e.target.value }))} /></div>
                        <div className="field"><label>{activeSection.type === 'date-range' ? 'To Date' : 'To'}</label><input className="inline-input" type={activeSection.type === 'date-range' ? 'date' : 'number'} value={filters[activeSection.to]} onChange={(e) => setFilters((prev) => ({ ...prev, [activeSection.to]: e.target.value }))} /></div>
                      </div>
                    )}
                  </>
                ) : null}
              </section>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
