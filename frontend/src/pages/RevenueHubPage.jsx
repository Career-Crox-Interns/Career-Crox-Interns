import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { openManagerProtectedExport } from '../lib/exportAuth';
import { useAuth } from '../lib/auth';
import { visiblePhone } from '../lib/candidateAccess';
import { mergeRowsById, useSmartDeltaSync } from '../lib/smartSync';

const cardConfig = [
  ['will_come_for_interview', 'Will Come', 'blue'],
  ['appeared_for_interview', 'Appeared', 'orange'],
  ['rejected', 'Rejected', 'red'],
  ['selected', 'Selected', 'teal'],
  ['pending_joining', 'Joining Pending', 'purple'],
  ['joined', 'Joined', 'green'],
  ['not_joined', 'Not Joined', 'pink'],
  ['completed_60_days', 'Completed 60 Days', 'violet'],
  ['payout_pending', 'Payout Pending', 'orange'],
  ['payout_received', 'Payout Received', 'mint'],
  ['all_profiles', 'All Profiles', 'purple'],
];
const statusOptions = [
  ['will_come_for_interview', 'Will Come for Interview'],
  ['appeared_for_interview', 'Appeared in Interview'],
  ['rejected', 'Rejected'],
  ['selected', 'Selected'],
  ['pending_joining', 'Pending Joining'],
  ['joined', 'Joined'],
  ['not_joined', 'Not Joined'],
  ['completed_60_days', 'Completed 60 Days'],
];
const payoutOptions = [
  ['none', 'No Payout Stage'],
  ['payout_pending', 'Payout Pending'],
  ['payout_received', 'Payout Received'],
];
const DEFAULT_WA_NUMBER = '7836095291';
const TEMPLATE_STORAGE_KEY = 'career_crox_pipeline_client_templates_v1';
const CUSTOM_PROCESS_STORAGE_KEY = 'career_crox_pipeline_custom_processes_v1';
const CUSTOM_CLIENT_STORAGE_KEY = 'career_crox_pipeline_custom_clients_v1';
const DEGREE_OPTIONS = ['NON - Graduate', 'Graduate'];
const DEFAULT_CLIENT_OPTIONS = ['Eureka', 'iEnergizer', '1 POINT 1', 'Globiva', 'Altruist ( Sector 58 )', 'Altruist ( Sector 5 127 )'];
const INTERVIEW_MODE_OPTIONS = ['Virtual', 'Walk-in'];
const COMMUNICATION_SKILL_OPTIONS = ['Excellent', 'Good', 'Normal', 'Average', 'Below Average'];
const EXPERIENCE_RANGE_OPTIONS = ['Fresher', '1 - 3 Month', '4 - 6 Month', '7 - 12 Month', '1 - 1.5 Year', '1.6 - 2 Year', '2 - 2.5 Year', '2.6 - 3 Year', '3 - 3.5 Year', '3.6 - 4 Year', '4 - 4.5 Year', '4.6 - 5 Year', '5+ Year'];
const SALARY_RANGE_OPTIONS = ['0', '₹1K - ₹15K', '₹16K - ₹20K', '₹21K - ₹25K', '₹26K - ₹30K', '₹31K - ₹35K'];
const MASTER_PROCESS_OPTIONS = [
  'Air India', 'Airtel', 'UrbanClap', 'Kotak', 'Tata 1mg', 'Axis Bank', 'Samsung',
  'Tata Motors', 'Icegate', 'Icertate', 'Xiaomi', 'Xiaomi - Regional Language', 'American Express',
  'Razorpay', 'RBL / OLX', 'HDFC Back Office', 'Other',
];
const DEFAULT_TEMPLATE_PRESETS = [
  {
    id: 'candidate_reached',
    label: 'Candidate Reached - Interview',
    body: 'HI Team,\n{candidate_name} has reached for the interview\nWe have attached the details and the resume\n\n1- NAME :- {candidate_name}\n2- NUMBER :- {candidate_number}\n3- PROCESS :- {candidate_process}\n4- INTERVIEW DATE :- {interview_date}\n\n*CAREER CROX*',
  },
  {
    id: 'interview_update_short',
    label: 'Interview Update - Short',
    body: 'HI Team,\nSharing quick interview update for {candidate_name}.\n\nName: {candidate_name}\nNumber: {candidate_number}\nProcess: {candidate_process}\nInterview: {interview_date}\nStatus: {candidate_status}\n\n*CAREER CROX*',
  },
];

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return '-';
  const clean = String(value || '').trim();
  const candidate = clean.length === 10 ? `${clean}T10:00` : clean;
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) return clean;
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

function toDateTimeLocal(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  if (clean.length >= 16) return clean.slice(0, 16);
  if (clean.length === 10) return `${clean}T10:00`;
  const date = new Date(clean);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatMoney(value) {
  const amount = Number(String(value ?? '').replace(/[^\d.\-]/g, '') || 0);
  if (!Number.isFinite(amount) || amount <= 0) return '₹0';
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

function formatPercent(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return '0%';
  const rounded = Math.round(amount * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function sanitizeMoneyInput(value) {
  return String(value || '').replace(/[^\d.]/g, '');
}

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  while (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length > 10) digits = digits.slice(-10);
  return digits;
}

function classForStage(item) {
  if (item.payout_status === 'payout_received') return 'green';
  if (item.payout_pending || item.joining_pending_due || item.status === 'appeared_for_interview' || item.status === 'pending_joining') return 'orange';
  if (item.missed || item.status === 'rejected' || item.status === 'not_joined') return 'red';
  if (item.status === 'selected' || item.status === 'joined' || item.completed_60_days) return 'mint';
  return 'blue';
}

function ReminderPill({ children, tone = 'blue' }) {
  return <span className={`revenue-status-pill ${tone}`}>{children}</span>;
}

function emptyFilters() {
  return {
    client_name: '',
    process: '',
    recruiter_name: '',
    candidate_name: '',
    candidate_id: '',
    status: '',
    payout_status: '',
    communication_skill: '',
    experience_range: '',
    salary_range: '',
    interview_date_from: '',
    interview_date_to: '',
    selection_date_from: '',
    selection_date_to: '',
    joining_date_from: '',
    joining_date_to: '',
  };
}

function defaultAddForm() {
  return {
    candidate_id: '',
    status: '',
    payout_status: 'none',
    full_name: '',
    client_name: '',
    process: '',
    interview_datetime: '',
    interview_mode: '',
    payout_amount: '',
    number: '',
    preferred_location: '',
    communication_skill: '',
    experience_range: '',
    salary_range: '',
    submission_date: '',
    qualification: 'Graduate',
    recruiter_code: '',
    notes: '',
    selection_date: '',
    joining_date: '',
    joined_date: '',
  };
}

function normalizeQualificationCategory(value, fallbackQualification = '') {
  const rawValue = String(value || '').trim();
  const rawFallback = String(fallbackQualification || '').trim();
  const current = lower(rawValue);
  if (current === 'non - graduate' || current === 'non-graduate' || current === 'nongraduate') return 'NON - Graduate';
  if (current === 'graduate') return 'Graduate';
  const combined = lower(`${rawValue} ${rawFallback}`);
  if (/(^|\b)(non[\s-]*grad|under[\s-]*grad|undergraduate|ug pursuing|pursuing|appearing|final year|last year|12th|10th|intermediate|higher secondary|hsc|diploma|iti)(\b|$)/i.test(combined)) return 'NON - Graduate';
  if (/(^|\b)(post[\s-]*grad|graduate|b\.?a|b\.?com|b\.?sc|b\.?tech|btech|bca|bba|mba|mca|m\.?a|m\.?com|m\.?sc|mtech|m\.?tech|phd|master|bachelor)(\b|$)/i.test(combined)) return 'Graduate';
  return 'Graduate';
}

function normalizeChoiceLabel(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function sortUniqueLabels(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(normalizeChoiceLabel).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function readCustomProcessOptions() {
  try {
    const raw = window.localStorage.getItem(CUSTOM_PROCESS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return sortUniqueLabels(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

function writeCustomProcessOptions(items) {
  try { window.localStorage.setItem(CUSTOM_PROCESS_STORAGE_KEY, JSON.stringify(sortUniqueLabels(items))); } catch {}
}

function readCustomClientOptions() {
  try {
    const raw = window.localStorage.getItem(CUSTOM_CLIENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return sortUniqueLabels(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

function writeCustomClientOptions(items) {
  try { window.localStorage.setItem(CUSTOM_CLIENT_STORAGE_KEY, JSON.stringify(sortUniqueLabels(items))); } catch {}
}

function splitChoiceValues(value) {
  const seen = new Set();
  return String(value || '')
    .split(/[\n,\/|]+/g)
    .map((item) => normalizeChoiceLabel(item))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function firstFilled(...values) {
  for (const value of values) {
    const clean = normalizeChoiceLabel(value);
    if (clean) return clean;
  }
  return '';
}

function firstChoiceValue(...values) {
  for (const value of values) {
    const choices = splitChoiceValues(value);
    if (choices[0]) return choices[0];
    const clean = normalizeChoiceLabel(value);
    if (clean) return clean;
  }
  return '';
}

function readNumericValue(value) {
  const clean = String(value ?? '').replace(/[^\d.]/g, ' ').trim();
  if (!clean) return null;
  const pieces = clean.split(/\s+/).filter(Boolean);
  for (const piece of pieces) {
    const num = Number(piece);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function mapExperienceToRange(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  if (num <= 0) return 'Fresher';
  if (num <= 0.25) return '1 - 3 Month';
  if (num <= 0.5) return '4 - 6 Month';
  if (num < 1) return '7 - 12 Month';
  if (num <= 1.5) return '1 - 1.5 Year';
  if (num <= 2) return '1.6 - 2 Year';
  if (num <= 2.5) return '2 - 2.5 Year';
  if (num <= 3) return '2.6 - 3 Year';
  if (num <= 3.5) return '3 - 3.5 Year';
  if (num <= 4) return '3.6 - 4 Year';
  if (num <= 4.5) return '4 - 4.5 Year';
  if (num <= 5) return '4.6 - 5 Year';
  return '5+ Year';
}

function mapSalaryToRange(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return '';
  if (num <= 15000) return '₹1K - ₹15K';
  if (num <= 20000) return '₹16K - ₹20K';
  if (num <= 25000) return '₹21K - ₹25K';
  if (num <= 30000) return '₹26K - ₹30K';
  return '₹31K - ₹35K';
}

function deriveExperienceRange(...sources) {
  const explicit = firstFilled(...sources.map((item) => item?.relevant_experience_range), ...sources.map((item) => item?.experience_range));
  if (explicit) return explicit;
  for (const source of sources) {
    const numeric = readNumericValue(source?.relevant_experience ?? source?.total_experience ?? source?.experience);
    const mapped = mapExperienceToRange(numeric);
    if (mapped) return mapped;
  }
  return '';
}

function deriveSalaryRange(...sources) {
  const explicit = firstFilled(...sources.map((item) => item?.relevant_in_hand_range), ...sources.map((item) => item?.salary_range));
  if (explicit) return explicit;
  for (const source of sources) {
    const numeric = readNumericValue(source?.in_hand_salary ?? source?.ctc_monthly ?? source?.payout_amount);
    const mapped = mapSalaryToRange(numeric);
    if (mapped) return mapped;
  }
  return '';
}

function derivePipelineAddForm(candidate = {}, existing = null, picked = null) {
  const source = candidate || {};
  const pickedItem = picked || {};
  const existingEntry = existing || null;
  const interviewSource = firstFilled(existingEntry?.interview_datetime, existingEntry?.interview_date, source?.interview_reschedule_date, source?.interview_date, pickedItem?.interview_reschedule_date, pickedItem?.interview_date);
  return {
    candidate_id: source.candidate_id || pickedItem.candidate_id || '',
    status: existingEntry?.status || 'will_come_for_interview',
    payout_status: existingEntry?.payout_status || 'none',
    full_name: firstFilled(source.full_name, pickedItem.full_name),
    client_name: firstChoiceValue(existingEntry?.client_name, source.client_name, source.company_name, pickedItem.client_name, pickedItem.company_name),
    process: firstChoiceValue(existingEntry?.process, source.process, pickedItem.process),
    interview_datetime: toDateTimeLocal(interviewSource),
    interview_mode: firstFilled(existingEntry?.interview_mode, source.virtual_onsite, pickedItem.virtual_onsite),
    payout_amount: firstFilled(existingEntry?.payout_amount),
    number: firstFilled(source.phone, source.number, pickedItem.phone, pickedItem.number),
    preferred_location: firstChoiceValue(existingEntry?.preferred_location, existingEntry?.location, source.preferred_location, source.location, pickedItem.preferred_location, pickedItem.location),
    communication_skill: firstFilled(existingEntry?.communication_skill, source.communication_skill, pickedItem.communication_skill),
    experience_range: firstFilled(existingEntry?.experience_range, deriveExperienceRange(source, pickedItem)),
    salary_range: firstFilled(existingEntry?.salary_range, deriveSalaryRange(source, pickedItem)),
    submission_date: String(firstFilled(existingEntry?.submission_date, source.submission_date, pickedItem.submission_date)).slice(0, 10),
    qualification: normalizeQualificationCategory(firstFilled(existingEntry?.qualification, source.qualification_level, pickedItem.qualification_level), firstFilled(source.qualification, pickedItem.qualification, existingEntry?.qualification)),
    recruiter_code: firstFilled(source.recruiter_code, pickedItem.recruiter_code),
    notes: firstFilled(existingEntry?.notes),
    selection_date: String(firstFilled(existingEntry?.selection_date)).slice(0, 10),
    joining_date: String(firstFilled(existingEntry?.joining_date)).slice(0, 10),
    joined_date: String(firstFilled(existingEntry?.joined_date)).slice(0, 10),
  };
}

function buildMergedOptions(...groups) {
  const seen = new Set();
  const result = [];
  groups.flatMap((group) => Array.isArray(group) ? group : [group]).forEach((item) => {
    const label = normalizeChoiceLabel(item);
    if (!label) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push(label);
  });
  return result;
}

function readTemplates() {
  try {
    const raw = window.localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (!raw) return DEFAULT_TEMPLATE_PRESETS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_TEMPLATE_PRESETS;
  } catch {
    return DEFAULT_TEMPLATE_PRESETS;
  }
}

function writeTemplates(items) {
  try { window.localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(items)); } catch {}
}

function templateBodyById(templates, presetId) {
  return templates.find((item) => item.id === presetId)?.body || DEFAULT_TEMPLATE_PRESETS[0].body;
}

function fillTemplate(body, tokens) {
  let text = String(body || '');
  Object.entries(tokens || {}).forEach(([key, value]) => {
    text = text.replaceAll(`{${key}}`, String(value ?? ''));
  });
  return text;
}

function buildMessageTokens(form) {
  return {
    candidate_name: form.full_name || '-',
    candidate_number: form.number || '-',
    candidate_process: form.process || '-',
    interview_date: formatDateTime(form.interview_datetime),
    candidate_status: form.status ? statusOptions.find(([value]) => value === form.status)?.[1] || form.status : 'Pending Update',
  };
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const payload = result.includes(',') ? result.split(',').pop() : result;
      resolve(payload || '');
    };
    reader.onerror = () => reject(new Error('File could not be read.'));
    reader.readAsDataURL(file);
  });
}

function RankingTable({ title, rows = [], columns = [] }) {
  return (
    <div className="table-panel glassy-card top-gap-small">
      <div className="table-title">{title}</div>
      <div className="crm-table-wrap dense-wrap top-gap-small">
        <table className="crm-table colorful-table dense-table">
          <thead>
            <tr>
              <th>#</th>
              {columns.map((col) => <th key={col.key}>{col.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 8).map((row, index) => (
              <tr key={`${title}-${row.label}-${index}`}>
                <td><strong>{index + 1}</strong></td>
                {columns.map((col) => <td key={col.key}>{col.render ? col.render(row) : row[col.key]}</td>)}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={columns.length + 1} className="helper-text">No data yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function RevenueHubPage() {
  const { user } = useAuth();
  const canEditTarget = ['admin', 'manager'].includes(lower(user?.role));
  const [items, setItems] = useState([]);
  const [cards, setCards] = useState({});
  const [summary, setSummary] = useState({});
  const [analytics, setAnalytics] = useState({ by_client: [], by_recruiter: [], by_communication: [], insights: [] });
  const [leaderboard, setLeaderboard] = useState({ by_revenue: [], by_selection_rate: [], by_joinings: [], by_retention: [], by_interviews: [] });
  const [lookups, setLookups] = useState({ clients: [], processes: [], recruiters: [], communication_skills: [], experience_ranges: [], salary_ranges: [] });
  const [activeCard, setActiveCard] = useState('all_profiles');
  const [viewMode, setViewMode] = useState('pipeline');
  const [leaderboardMetric, setLeaderboardMetric] = useState('by_revenue');
  const [filters, setFilters] = useState(emptyFilters);
  const [savingId, setSavingId] = useState('');
  const [message, setMessage] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [searchItems, setSearchItems] = useState([]);
  const [addForm, setAddForm] = useState(defaultAddForm());
  const [rowDrafts, setRowDrafts] = useState({});
  const [addBusy, setAddBusy] = useState(false);
  const [addInlineMessage, setAddInlineMessage] = useState('');
  const [candidateRecord, setCandidateRecord] = useState(null);
  const [candidateFiles, setCandidateFiles] = useState([]);
  const [fileBusy, setFileBusy] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(true);
  const [waNumber, setWaNumber] = useState(DEFAULT_WA_NUMBER);
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATE_PRESETS);
  const [selectedPresetId, setSelectedPresetId] = useState(DEFAULT_TEMPLATE_PRESETS[0].id);
  const [attachResume, setAttachResume] = useState(true);
  const [attachRecording, setAttachRecording] = useState(true);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareFiles, setShareFiles] = useState({ resume: null, call_recording: null });
  const [customProcessOptions, setCustomProcessOptions] = useState([]);
  const [customClientOptions, setCustomClientOptions] = useState([]);
  const [showTargetEditor, setShowTargetEditor] = useState(false);
  const [targetDraft, setTargetDraft] = useState('');
  const [targetSaving, setTargetSaving] = useState(false);
  const [selectedRevenueIds, setSelectedRevenueIds] = useState([]);
  const [deletingId, setDeletingId] = useState('');

  const canManagePipeline = ['admin', 'manager'].includes(String(user?.role || '').toLowerCase());
  const isManager = String(user?.role || '').toLowerCase() === 'manager';

  useEffect(() => {
    setTemplates(readTemplates());
    setCustomProcessOptions(readCustomProcessOptions());
    setCustomClientOptions(readCustomClientOptions());
  }, []);

  function buildQuery() {
    const params = new URLSearchParams();
    const merged = { ...filters };
    if (activeCard && activeCard !== 'all_profiles' && activeCard !== 'payout_pending' && activeCard !== 'payout_received' && activeCard !== 'completed_60_days') {
      merged.status = activeCard;
    }
    if (activeCard === 'payout_pending') merged.payout_status = 'payout_pending';
    if (activeCard === 'payout_received') merged.payout_status = 'payout_received';
    Object.entries(merged).forEach(([key, value]) => {
      if (String(value || '').trim()) params.set(key, value);
    });
    const query = params.toString();
    return query ? `?${query}` : '';
  }

  async function load(queryOverride = null) {
    const data = await api.get(`/api/revenue-hub${queryOverride ?? buildQuery()}`);
    setItems(data.items || []);
    setCards(data.cards || {});
    setSummary(data.summary || {});
    setAnalytics(data.analytics || { by_client: [], by_recruiter: [], by_communication: [], insights: [] });
    setLeaderboard(data.leaderboard || { by_revenue: [], by_selection_rate: [], by_joinings: [], by_retention: [], by_interviews: [] });
    setLookups(data.lookups || { clients: [], processes: [], recruiters: [], communication_skills: [], experience_ranges: [], salary_ranges: [] });
    setRowDrafts((current) => {
      const next = { ...current };
      (data.items || []).forEach((item) => {
        next[item.revenue_id] ||= {
          status: item.status || 'will_come_for_interview',
          payout_status: item.payout_status || 'none',
          interview_datetime: item.interview_datetime || item.interview_date || '',
          selection_date: item.selection_date || '',
          joining_date: item.joining_date || '',
          joined_date: item.joined_date || '',
          payout_amount: item.payout_amount || '',
          notes: item.notes || '',
        };
      });
      return next;
    });
  }

  useEffect(() => { load().catch(() => {}); }, [activeCard, JSON.stringify(filters)]);
  useSmartDeltaSync({
    scope: 'revenue-hub',
    idKey: 'revenue_id',
    rows: items,
    query: buildQuery(),
    keySuffix: `${activeCard}:${JSON.stringify(filters)}`,
    onRows: (changedRows) => setItems((current) => mergeRowsById(current, changedRows, 'revenue_id')),
    onSnapshot: (snapshot) => {
      if (snapshot?.cards) setCards((current) => ({ ...current, ...snapshot.cards }));
      if (snapshot?.summary) setSummary((current) => ({ ...current, ...snapshot.summary }));
    },
  });

  function normalizeSearchDigits(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function normalizeNameSearch(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function detectRevenueSearchIntent(value) {
    const raw = String(value || '').trim();
    const q = raw.toLowerCase();
    const digits = normalizeSearchDigits(raw);
    const compact = raw.replace(/\s+/g, '');
    const hasLetters = /[a-z]/i.test(raw);
    const hasDigits = /\d/.test(raw);
    let kind = 'name';
    if (digits && digits.length >= 4 && (!hasLetters || digits.length >= 6)) kind = 'phone';
    else if (hasDigits && /^[a-z]{0,4}\d+$/i.test(compact)) kind = 'candidate_id';
    return { raw, q, digits, kind };
  }

  function revenueNameRank(nameValue, queryText) {
    const name = normalizeNameSearch(nameValue);
    const query = normalizeNameSearch(queryText);
    if (!query || !name) return 0;
    const tokens = name.split(' ').filter(Boolean);
    let score = 0;
    if (name === query) score += 520;
    if (tokens.includes(query)) score += 470;
    if (name.startsWith(query)) score += 430;
    if (tokens.some((token) => token.startsWith(query))) score += 390;
    if (name.includes(` ${query}`)) score += 320;
    if (query.length >= 3 && name.includes(query)) score += 150;
    return score;
  }

  function matchesRevenueSearch(item, queryText) {
    const meta = detectRevenueSearchIntent(queryText);
    if (!meta.q) return true;
    const id = String(item?.candidate_id || '').toLowerCase();
    const phone = normalizeSearchDigits(item?.phone || item?.number || '');
    if (meta.kind === 'phone') return !!meta.digits && phone.includes(meta.digits);
    if (meta.kind === 'candidate_id') return id.includes(meta.q);
    return revenueNameRank(item?.full_name, meta.raw) > 0;
  }

  function revenueSearchRank(item, queryText) {
    const meta = detectRevenueSearchIntent(queryText);
    if (!meta.q) return 0;
    const id = String(item?.candidate_id || '').toLowerCase();
    const phone = normalizeSearchDigits(item?.phone || item?.number || '');
    if (meta.kind === 'phone') {
      let score = 0;
      if (meta.digits && phone === meta.digits) score += 500;
      if (meta.digits && phone.startsWith(meta.digits)) score += 380;
      if (meta.digits && phone.includes(meta.digits)) score += 240;
      return score;
    }
    if (meta.kind === 'candidate_id') {
      let score = 0;
      if (id === meta.q) score += 500;
      if (id.startsWith(meta.q)) score += 390;
      if (id.includes(meta.q)) score += 240;
      return score;
    }
    return revenueNameRank(item?.full_name, meta.raw);
  }

  async function runSearch(rawQuery = search) {
    const queryText = String(rawQuery || '').trim();
    setAddInlineMessage('');
    try {
      const data = await api.get(`/api/revenue-hub/candidate-search?q=${encodeURIComponent(queryText)}`);
      const nextItems = data.items || [];
      setSearchItems(nextItems);
      if (queryText && !nextItems.filter((item) => matchesRevenueSearch(item, queryText)).length) {
        setAddInlineMessage('No matching candidate found for this code, name or number.');
      }
    } catch (error) {
      setSearchItems([]);
      setAddInlineMessage(error?.message || 'Candidate search failed. Please try again.');
    }
  }

  useEffect(() => {
    if (!showAdd) return;
    setShowSearchResults(true);
    runSearch(search).catch(() => {});
  }, [showAdd]);

  useEffect(() => {
    if (!showAdd || !showSearchResults) return undefined;
    const timer = window.setTimeout(() => {
      runSearch(search).catch(() => {});
    }, 220);
    return () => window.clearTimeout(timer);
  }, [search, showAdd, showSearchResults]);

  function addNewProcessOption() {
    const fresh = normalizeChoiceLabel(window.prompt('Add new process', addForm.process || '') || '');
    if (!fresh) return;
    const next = sortUniqueLabels([...customProcessOptions, fresh]);
    setCustomProcessOptions(next);
    writeCustomProcessOptions(next);
    setAddForm((prev) => ({ ...prev, process: fresh }));
  }

  function addNewClientOption() {
    const fresh = normalizeChoiceLabel(window.prompt('Add new client', addForm.client_name || '') || '');
    if (!fresh) return;
    const next = sortUniqueLabels([...customClientOptions, fresh]);
    setCustomClientOptions(next);
    writeCustomClientOptions(next);
    setAddForm((prev) => ({ ...prev, client_name: fresh }));
  }

  const latestResumeFile = useMemo(() => candidateFiles.find((file) => file.file_kind === 'resume') || null, [candidateFiles]);
  const latestRecordingFile = useMemo(() => candidateFiles.find((file) => file.file_kind === 'call_recording') || null, [candidateFiles]);
  const hasResumeAvailable = useMemo(() => Boolean(latestResumeFile || candidateRecord?.resume_filename), [latestResumeFile, candidateRecord?.resume_filename]);
  const currentEntry = useMemo(() => items.find((item) => String(item.candidate_id) === String(addForm.candidate_id)) || null, [items, addForm.candidate_id]);
  const displayedSearchItems = useMemo(() => {
    const queryText = String(search || '').trim();
    return [...searchItems]
      .filter((item) => matchesRevenueSearch(item, queryText))
      .sort((a, b) => {
        const scoreDiff = revenueSearchRank(b, queryText) - revenueSearchRank(a, queryText);
        if (scoreDiff) return scoreDiff;
        return String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || ''));
      });
  }, [searchItems, search]);
  const availableProcessOptions = useMemo(() => buildMergedOptions(
    MASTER_PROCESS_OPTIONS,
    lookups.processes || [],
    customProcessOptions,
    searchItems.flatMap((item) => splitChoiceValues(item?.process)),
    items.flatMap((item) => splitChoiceValues(item?.process)),
    candidateRecord?.process,
    addForm.process,
  ), [lookups.processes, customProcessOptions, searchItems, items, candidateRecord?.process, addForm.process]);
  const availableClientOptions = useMemo(() => buildMergedOptions(
    DEFAULT_CLIENT_OPTIONS,
    lookups.clients || [],
    customClientOptions,
    searchItems.flatMap((item) => splitChoiceValues(item?.client_name || item?.company_name)),
    items.flatMap((item) => splitChoiceValues(item?.client_name)),
    candidateRecord?.client_name,
    candidateRecord?.company_name,
    addForm.client_name,
  ), [lookups.clients, customClientOptions, searchItems, items, candidateRecord?.client_name, candidateRecord?.company_name, addForm.client_name]);
  const availablePreferredLocationOptions = useMemo(() => buildMergedOptions(
    splitChoiceValues(candidateRecord?.preferred_location),
    splitChoiceValues(candidateRecord?.location),
    splitChoiceValues(addForm.preferred_location),
    items.flatMap((item) => splitChoiceValues(item?.location)),
    searchItems.flatMap((item) => splitChoiceValues(item?.preferred_location || item?.location)),
    candidateRecord?.preferred_location,
    candidateRecord?.location,
    addForm.preferred_location,
  ), [candidateRecord?.preferred_location, candidateRecord?.location, addForm.preferred_location, items, searchItems]);
  const availableCommunicationOptions = useMemo(() => buildMergedOptions(
    COMMUNICATION_SKILL_OPTIONS,
    lookups.communication_skills || [],
    items.map((item) => item?.communication_skill),
    searchItems.map((item) => item?.communication_skill),
    candidateRecord?.communication_skill,
    addForm.communication_skill,
  ), [lookups.communication_skills, items, searchItems, candidateRecord?.communication_skill, addForm.communication_skill]);
  const availableExperienceOptions = useMemo(() => buildMergedOptions(
    EXPERIENCE_RANGE_OPTIONS,
    lookups.experience_ranges || [],
    items.map((item) => item?.experience_range),
    searchItems.map((item) => item?.experience_range || item?.relevant_experience_range),
    candidateRecord?.relevant_experience_range,
    addForm.experience_range,
  ), [lookups.experience_ranges, items, searchItems, candidateRecord?.relevant_experience_range, addForm.experience_range]);
  const availableSalaryOptions = useMemo(() => buildMergedOptions(
    SALARY_RANGE_OPTIONS,
    lookups.salary_ranges || [],
    items.map((item) => item?.salary_range),
    searchItems.map((item) => item?.salary_range || item?.relevant_in_hand_range),
    candidateRecord?.relevant_in_hand_range,
    addForm.salary_range,
  ), [lookups.salary_ranges, items, searchItems, candidateRecord?.relevant_in_hand_range, addForm.salary_range]);
  const filteredCards = useMemo(() => cardConfig.map(([key, label, tone]) => ({ key, label, tone, value: cards[key] || 0 })), [cards]);
  const messagePreview = useMemo(() => fillTemplate(templateBodyById(templates, selectedPresetId), buildMessageTokens(addForm)), [templates, selectedPresetId, addForm]);
  const leaderboardRows = useMemo(() => leaderboard[leaderboardMetric] || [], [leaderboard, leaderboardMetric]);

  useEffect(() => {
    setTargetDraft(String(summary.month_target || ''));
  }, [summary.month_target]);

  async function pickCandidate(item) {
    setAddInlineMessage('');
    setMessage('');
    try {
      const data = await api.get(`/api/candidates/${item.candidate_id}`);
      const candidate = data.item || item;
      const files = data.files || [];
      const existing = items.find((row) => String(row.candidate_id) === String(item.candidate_id)) || null;
      setCandidateRecord(candidate);
      setCandidateFiles(files);
      setSearchItems([]);
      setShowSearchResults(false);
      setShareFiles({ resume: null, call_recording: null });
      setAddForm(derivePipelineAddForm(candidate, existing, item));
    } catch (error) {
      setAddInlineMessage(error.message || 'Candidate details could not be loaded.');
    }
  }

  function resetAddModal() {
    setSearch('');
    setSearchItems([]);
    setAddForm(defaultAddForm());
    setCandidateRecord(null);
    setCandidateFiles([]);
    setFileBusy('');
    setShowSearchResults(true);
    setAttachResume(true);
    setAttachRecording(true);
    setAddInlineMessage('');
    setShareFiles({ resume: null, call_recording: null });
    setWaNumber(DEFAULT_WA_NUMBER);
    setSelectedPresetId(DEFAULT_TEMPLATE_PRESETS[0].id);
  }

  async function saveTarget() {
    if (!canEditTarget) return;
    const cleaned = sanitizeMoneyInput(targetDraft);
    if (!cleaned || Number(cleaned) <= 0) {
      setMessage('Enter a valid target amount.');
      return;
    }
    setTargetSaving(true);
    try {
      const data = await api.post('/api/revenue-hub/target', { target_amount: cleaned });
      const finalTarget = Number(data.month_target || cleaned);
      setSummary((prev) => ({ ...prev, month_target: finalTarget, month_achievement_percent: prev.month_income ? Math.max(0, Math.min(999, Math.round(((Number(prev.month_income || 0) / finalTarget) * 100) * 10) / 10)) : 0 }));
      setShowTargetEditor(false);
      setMessage('Monthly target updated.');
    } catch (error) {
      setMessage(error.message || 'Target update failed.');
    } finally {
      setTargetSaving(false);
    }
  }

  async function addCandidate() {
    const selectedId = String(candidateRecord?.candidate_id || addForm.candidate_id || '').trim();
    if (!selectedId) {
      const msg = 'Select a candidate before saving the pipeline entry.';
      setAddInlineMessage(msg);
      setMessage(msg);
      return;
    }
    const requiredFields = [
      ['status', 'Status'],
      ['client_name', 'Client'],
      ['process', 'Process'],
      ['interview_datetime', 'Interview date and time'],
      ['interview_mode', 'Interview mode'],
      ['preferred_location', 'Preferred location'],
      ['qualification', 'Degree / Qualification'],
      ['communication_skill', 'Communication skill'],
      ['experience_range', 'Experience range'],
      ['salary_range', 'Salary range'],
    ];
    const missingField = requiredFields.find(([key]) => !String(addForm[key] || '').trim());
    if (missingField) {
      const msg = `${missingField[1]} is required.`;
      setAddInlineMessage(msg);
      setMessage(msg);
      return;
    }
    if (!hasResumeAvailable) {
      const msg = 'Resume is required. Upload the resume before adding the candidate.';
      setAddInlineMessage(msg);
      setMessage(msg);
      return;
    }
    setAddBusy(true);
    setAddInlineMessage('');
    try {
      const payload = {
        ...addForm,
        candidate_id: selectedId,
        interview_date: String(addForm.interview_datetime || '').slice(0, 10),
      };
      const data = await api.post('/api/revenue-hub/add-candidate', payload, { timeoutMs: 25000, retries: 1 });
      const info = data?.already_existed ? 'Candidate already existed in Pipeline Hub. The existing entry was updated.' : 'Candidate added to Pipeline Hub.';
      setViewMode('pipeline');
      setActiveCard('all_profiles');
      setFilters(emptyFilters());
      setSelectedRevenueIds([]);
      setShowAdd(false);
      resetAddModal();
      setMessage(info);
      await load('');
    } catch (error) {
      const msg = error.message || 'Add candidate failed.';
      setAddInlineMessage(msg);
      setMessage(msg);
    } finally {
      setAddBusy(false);
    }
  }

  async function saveRow(item) {
    const draft = rowDrafts[item.revenue_id];
    if (!draft) return;
    setSavingId(item.revenue_id);
    try {
      await api.post(`/api/revenue-hub/${item.revenue_id}/status`, {
        ...draft,
        interview_date: String(draft.interview_datetime || '').slice(0, 10),
      });
      setMessage('Pipeline row updated successfully.');
      await load();
    } catch (error) {
      setMessage(error.message || 'Update failed.');
    } finally {
      setSavingId('');
    }
  }


  async function deleteRow(item) {
    if (!canManagePipeline) return;
    const ok = window.confirm(`Delete pipeline entry for ${item?.full_name || item?.candidate_id || 'this candidate'}?`);
    if (!ok) return;
    setDeletingId(item.revenue_id);
    try {
      await api.del(`/api/revenue-hub/${item.revenue_id}`);
      setMessage('Pipeline entry deleted.');
      if (String(addForm.candidate_id || '') === String(item.candidate_id || '')) {
        resetAddModal();
        setShowAdd(false);
      }
      await load();
    } catch (error) {
      setMessage(error.message || 'Delete failed.');
    } finally {
      setDeletingId('');
    }
  }

  async function downloadExport() {
    const query = buildQuery();
    try {
      await openManagerProtectedExport(`/api/revenue-hub/export${query}`, 'revenue-hub/export');
    } catch (error) {
      setMessage(error.message || 'Export failed.');
    }
  }

  async function uploadCandidateAsset(fileKind, file) {
    if (!file || !addForm.candidate_id) return;
    const busyKey = `${fileKind}:${file.name}`;
    setFileBusy(busyKey);
    setAddInlineMessage('');
    try {
      const contentBase64 = await readFileAsBase64(file);
      const data = await api.post(`/api/candidates/${addForm.candidate_id}/files`, {
        file_kind: fileKind,
        file_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        content_base64: contentBase64,
      }, { timeoutMs: 45000, retries: 1 });
      setCandidateFiles(data.files || []);
      setShareFiles((prev) => ({ ...prev, [fileKind]: file }));
      setAddInlineMessage(`${fileKind === 'resume' ? 'Resume' : 'Recording'} uploaded successfully.`);
    } catch (err) {
      setAddInlineMessage(err.message || 'File upload failed.');
    } finally {
      setFileBusy('');
    }
  }

  async function fetchFileForShare(fileMeta) {
    if (!fileMeta?.file_id || !addForm.candidate_id) return null;
    const response = await fetch(`/api/candidates/${addForm.candidate_id}/files/${fileMeta.file_id}/download`, { credentials: 'include' });
    if (!response.ok) throw new Error('Stored file could not be fetched.');
    const blob = await response.blob();
    return new File([blob], fileMeta.original_name || `${fileMeta.file_kind || 'file'}.bin`, { type: fileMeta.mime_type || blob.type || 'application/octet-stream' });
  }

  async function buildShareableFiles() {
    const files = [];
    if (attachResume) {
      if (shareFiles.resume) files.push(shareFiles.resume);
      else if (latestResumeFile) files.push(await fetchFileForShare(latestResumeFile));
    }
    if (attachRecording) {
      if (shareFiles.call_recording) files.push(shareFiles.call_recording);
      else if (latestRecordingFile) files.push(await fetchFileForShare(latestRecordingFile));
    }
    return files.filter(Boolean);
  }

  async function openWhatsAppForClient() {
    const clientNumber = normalizePhone(waNumber);
    if (!clientNumber) {
      setAddInlineMessage('Please enter a valid 10 digit WhatsApp number.');
      return;
    }
    const text = messagePreview;
    const waUrl = `https://wa.me/91${clientNumber}?text=${encodeURIComponent(text)}`;
    const basicShareSupported = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    const wantsAnyFile = Boolean((attachResume && (shareFiles.resume || latestResumeFile)) || (attachRecording && (shareFiles.call_recording || latestRecordingFile)));

    if (!basicShareSupported) {
      const popup = window.open(waUrl, '_blank', 'noopener,noreferrer');
      if (!popup) window.location.href = waUrl;
      setAddInlineMessage(wantsAnyFile
        ? 'WhatsApp opened. Please attach the resume or recording manually from WhatsApp.'
        : 'WhatsApp opened.');
      return;
    }

    setShareBusy(true);
    try {
      const shareableFiles = wantsAnyFile ? await buildShareableFiles() : [];
      if (shareableFiles.length) {
        const payload = { text, title: `${addForm.full_name || 'Candidate'} update` };
        const canShareFiles = navigator.canShare ? navigator.canShare({ files: shareableFiles }) : true;
        if (canShareFiles) {
          payload.files = shareableFiles;
          await navigator.share(payload);
          setAddInlineMessage('Share sheet opened. Choose WhatsApp to send the message with files.');
          return;
        }
      }
      const popup = window.open(waUrl, '_blank', 'noopener,noreferrer');
      if (!popup) window.location.href = waUrl;
      setAddInlineMessage(shareableFiles.length
        ? 'WhatsApp opened. Please attach the resume or recording manually from WhatsApp.'
        : 'WhatsApp opened.');
    } catch (error) {
      if (error?.name !== 'AbortError') {
        const popup = window.open(waUrl, '_blank', 'noopener,noreferrer');
        if (!popup) window.location.href = waUrl;
        setAddInlineMessage(error.message || 'WhatsApp action failed. The message tab was opened as a fallback.');
      }
    } finally {
      setShareBusy(false);
    }
  }

  function handleTemplateSelect(value) {
    if (value === '__add_new__') {
      const label = window.prompt('Enter preset name');
      if (!label) return;
      const body = window.prompt('Enter preset body. You can use: {candidate_name}, {candidate_number}, {candidate_process}, {interview_date}, {candidate_status}');
      if (!body) return;
      const next = [...templates, { id: `custom_${Date.now()}`, label: label.trim(), body: body.trim() }];
      setTemplates(next);
      writeTemplates(next);
      setSelectedPresetId(next[next.length - 1].id);
      return;
    }
    setSelectedPresetId(value);
  }

  const visibleRevenueIds = useMemo(() => items.map((item) => String(item.revenue_id || '')).filter(Boolean), [items]);
  const allVisibleSelected = visibleRevenueIds.length > 0 && visibleRevenueIds.every((id) => selectedRevenueIds.includes(id));
  const visibleSelectedCount = selectedRevenueIds.filter((id) => visibleRevenueIds.includes(id)).length;

  useEffect(() => {
    setSelectedRevenueIds((current) => current.filter((id) => visibleRevenueIds.includes(id)));
  }, [visibleRevenueIds]);

  function toggleRowSelection(revenueId) {
    const normalizedId = String(revenueId || '').trim();
    if (!normalizedId) return;
    setSelectedRevenueIds((current) => (
      current.includes(normalizedId)
        ? current.filter((id) => id !== normalizedId)
        : [...current, normalizedId]
    ));
  }

  function toggleSelectAllVisibleRows() {
    setSelectedRevenueIds((current) => {
      if (allVisibleSelected) return current.filter((id) => !visibleRevenueIds.includes(id));
      return Array.from(new Set([...current, ...visibleRevenueIds]));
    });
  }

  const pipelineSummaryCards = [
    { label: "Today's Interview", value: summary.today_interviews || 0, hint: 'Today pipeline count', tone: 'summary-indigo' },
    { label: 'This Week Interview', value: summary.week_interviews || 0, hint: 'Current week pipeline count', tone: 'summary-sky' },
    { label: 'This Month Interview', value: summary.month_interviews || 0, hint: 'Current month pipeline count', tone: 'summary-violet' },
    { label: 'This Month Joined', value: summary.month_joined || 0, hint: 'Joined profiles this month', tone: 'summary-emerald' },
  ];

  return (
    <Layout title="Pipeline Hub" subtitle="Interview movement, outcome tracking, payout and analytics in one place.">
      <div className="revenue-hub-shell fade-up">
        <div className="revenue-hub-topbar glassy-card">
          <div>
            <div className="table-title">Pipeline Hub</div>
            <div className="helper-text">Candidate journey, payout tracking, recruiter-wise filters, analytics and leaderboard in one place.</div>
          </div>
          <div className="revenue-hub-head-actions pipeline-view-switches">
            <button type="button" className={`ghost-btn bounceable ${viewMode === 'pipeline' ? 'active' : ''}`} onClick={() => setViewMode('pipeline')}>Pipeline</button>
            <button type="button" className={`ghost-btn bounceable ${viewMode === 'analytics' ? 'active' : ''}`} onClick={() => setViewMode('analytics')}>Analytics</button>
            <button type="button" className={`ghost-btn bounceable ${viewMode === 'leaderboard' ? 'active' : ''}`} onClick={() => setViewMode('leaderboard')}>Leaderboard</button>
            <button type="button" className="add-profile-btn bounceable" onClick={() => setShowAdd(true)}>Add Candidate</button>
            {isManager && <button type="button" className="ghost-btn bounceable" onClick={downloadExport}>Export Details</button>}
          </div>
        </div>

        {!!message && <div className="panel top-gap-small"><div className="helper-text">{message}</div></div>}

        <div className="pipeline-summary-grid top-gap-small">
          {pipelineSummaryCards.map((card) => (
            <div key={card.label} className={`stat-card revenue-journey-card pipeline-summary-card ${card.tone}`}>
              <span className="stat-label">{card.label}</span>
              <strong className="stat-value">{card.value}</strong>
              <small>{card.hint}</small>
            </div>
          ))}
        </div>

        <div className="pipeline-income-sticky glassy-card compact-middle-income-card">
          <div className="pipeline-income-head">
            <div>
              <div className="table-title">This Month Income</div>
              <div className="helper-text">Clean monthly payout tracking with target versus achieved visibility and inline monthly target editing.</div>
            </div>
            {canEditTarget && (
              <button
                type="button"
                className={`ghost-btn bounceable revenue-target-edit-trigger ${showTargetEditor ? 'active' : ''}`}
                onClick={() => setShowTargetEditor((current) => !current)}
              >
                {showTargetEditor ? 'Close Target Edit' : 'Edit Target'}
              </button>
            )}
          </div>
          <div className="pipeline-income-metrics">
            <div className="pipeline-income-block">
              <span>Income</span>
              <strong>{formatMoney(summary.month_income || 0)}</strong>
            </div>
            <div className="pipeline-income-block target-editable-block">
              <span>Target</span>
              <strong>{formatMoney(summary.month_target || 0)}</strong>
            </div>
            <div className="pipeline-income-block">
              <span>Target Achieved</span>
              <strong>{formatPercent(summary.month_achievement_percent || 0)}</strong>
            </div>
          </div>
          {canEditTarget && showTargetEditor && (
            <div className="pipeline-target-editor top-gap-small">
              <label className="field pipeline-target-editor-field">
                <span>Monthly Target</span>
                <input
                  value={targetDraft}
                  onChange={(e) => setTargetDraft(e.target.value)}
                  placeholder="100000"
                  inputMode="decimal"
                />
              </label>
              <button
                type="button"
                className="add-profile-btn bounceable"
                onClick={saveTarget}
                disabled={targetSaving}
              >
                {targetSaving ? 'Saving...' : 'Save Target'}
              </button>
            </div>
          )}
        </div>

        
        {viewMode === 'pipeline' && (
          <>
            <div className="revenue-card-grid top-gap-small compact-lower-grid">
              {filteredCards.map((card) => {
                const isActive = activeCard === card.key || (!activeCard && card.key === 'all_profiles');
                return (
                  <button
                    key={card.key}
                    type="button"
                    className={`stat-card revenue-journey-card ${card.tone} ${isActive ? 'active' : ''}`}
                    onClick={() => setActiveCard(card.key)}
                  >
                    <span className="stat-label">{card.label}</span>
                    <strong className="stat-value">{card.value}</strong>
                    <small>{card.key === 'all_profiles' ? 'Complete tracked pool' : card.key === 'payout_pending' ? 'Needs payout action' : card.key === 'payout_received' ? 'Closed payout' : 'Current count'}</small>
                  </button>
                );
              })}
            </div>

            <div className="table-panel top-gap glassy-card">
              <div className="table-toolbar revenue-toolbar-stack">
                <div>
                  <div className="table-title">Pipeline Filters</div>
                  <div className="helper-text">Filter by recruiter, dates, client, communication skill, salary range, and experience range.</div>
                </div>
                <button type="button" className="ghost-btn bounceable" onClick={() => setFilters(emptyFilters())}>Reset Filters</button>
              </div>

              <div className="revenue-filter-grid compact-filter-grid top-gap-small">
                <label className="bucket-filter-box"><span>Client</span><select className="bucket-modern-select" value={filters.client_name} onChange={(e) => setFilters((f) => ({ ...f, client_name: e.target.value }))}><option value="">All Clients</option>{(lookups.clients || []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                <label className="bucket-filter-box"><span>Process</span><select className="bucket-modern-select" value={filters.process} onChange={(e) => setFilters((f) => ({ ...f, process: e.target.value }))}><option value="">All Process</option>{(lookups.processes || []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                <label className="bucket-filter-box"><span>Recruiter</span><select className="bucket-modern-select" value={filters.recruiter_name} onChange={(e) => setFilters((f) => ({ ...f, recruiter_name: e.target.value }))}><option value="">All Recruiters</option>{(lookups.recruiters || []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                <label className="bucket-filter-box"><span>Communication</span><select className="bucket-modern-select" value={filters.communication_skill} onChange={(e) => setFilters((f) => ({ ...f, communication_skill: e.target.value }))}><option value="">All Communication</option>{(lookups.communication_skills || []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                <label className="bucket-filter-box"><span>Experience Range</span><select className="bucket-modern-select" value={filters.experience_range} onChange={(e) => setFilters((f) => ({ ...f, experience_range: e.target.value }))}><option value="">All Experience</option>{(lookups.experience_ranges || []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                <label className="bucket-filter-box"><span>Salary Range</span><select className="bucket-modern-select" value={filters.salary_range} onChange={(e) => setFilters((f) => ({ ...f, salary_range: e.target.value }))}><option value="">All Salary</option>{(lookups.salary_ranges || []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                <label className="bucket-filter-box"><span>Status</span><select className="bucket-modern-select" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}><option value="">All Status</option>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="bucket-filter-box"><span>Payout</span><select className="bucket-modern-select" value={filters.payout_status} onChange={(e) => setFilters((f) => ({ ...f, payout_status: e.target.value }))}><option value="">All Payout</option>{payoutOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="bucket-filter-box"><span>Candidate Name</span><input className="bucket-modern-select bucket-text-input" value={filters.candidate_name} onChange={(e) => setFilters((f) => ({ ...f, candidate_name: e.target.value }))} placeholder="Search name" /></label>
                <label className="bucket-filter-box"><span>Candidate Code</span><input className="bucket-modern-select bucket-text-input" value={filters.candidate_id} onChange={(e) => setFilters((f) => ({ ...f, candidate_id: e.target.value }))} placeholder="C1006" /></label>
                <label className="bucket-filter-box"><span>Interview From</span><input type="date" className="bucket-modern-select bucket-text-input" value={filters.interview_date_from} onChange={(e) => setFilters((f) => ({ ...f, interview_date_from: e.target.value }))} /></label>
                <label className="bucket-filter-box"><span>Interview To</span><input type="date" className="bucket-modern-select bucket-text-input" value={filters.interview_date_to} onChange={(e) => setFilters((f) => ({ ...f, interview_date_to: e.target.value }))} /></label>
              </div>

              <div className="revenue-selection-strip top-gap-small">
                <span className="helper-text">Selected Rows: <strong>{visibleSelectedCount}</strong> / {items.length}</span>
              </div>

              <div className="crm-table-wrap dense-wrap top-gap-small revenue-table-scroll-wrap">
                <table className="crm-table colorful-table dense-table revenue-professional-table">
                  <thead>
                    <tr>
                      <th>
                        <button
                          type="button"
                          className={`table-master-check ${allVisibleSelected ? 'active' : ''}`}
                          onClick={toggleSelectAllVisibleRows}
                          title={allVisibleSelected ? 'Clear selection' : 'Select all visible rows'}
                        >
                          {allVisibleSelected ? '✓' : '○'}
                        </button>
                        <div className="revenue-head-helper">Select All</div>
                      </th>
                      <th>Status</th>
                      <th>Sr No</th>
                      <th>Candidate</th>
                      <th>Client</th>
                      <th>Process</th>
                      <th>Interview Date & Time</th>
                      <th>Resume</th>
                      <th>Payout</th>
                      <th>Communication</th>
                      <th>Experience / Salary</th>
                      <th>Dates</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, index) => {
                      const draft = rowDrafts[item.revenue_id] || {
                        status: item.status || 'will_come_for_interview',
                        payout_status: item.payout_status || 'none',
                        interview_datetime: item.interview_datetime || item.interview_date || '',
                        selection_date: item.selection_date || '',
                        joining_date: item.joining_date || '',
                        joined_date: item.joined_date || '',
                        payout_amount: item.payout_amount || '',
                        notes: item.notes || '',
                      };
                      const previewStage = { ...item, status: draft.status, payout_status: draft.payout_status };
                      const rowId = String(item.revenue_id || '');
                      const isSelected = selectedRevenueIds.includes(rowId);
                      return (
                        <tr key={item.revenue_id} className={isSelected ? 'revenue-row-selected' : ''}>
                          <td className="revenue-select-col">
                            <button
                              type="button"
                              className={`row-check-btn ${isSelected ? 'active' : ''}`}
                              onClick={() => toggleRowSelection(item.revenue_id)}
                              title={isSelected ? 'Deselect row' : 'Select row'}
                            >
                              {isSelected ? '✓' : String(index + 1).padStart(2, '0')}
                            </button>
                          </td>
                          <td>
                            <select className="revenue-inline-input" value={draft.status || 'will_come_for_interview'} onChange={(e) => setRowDrafts((all) => ({ ...all, [item.revenue_id]: { ...draft, status: e.target.value } }))}>
                              {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                            <div className="top-gap-small"><ReminderPill tone={classForStage(previewStage)}>{(draft.status || item.status || '').replaceAll('_', ' ')}</ReminderPill></div>
                            <div className="revenue-status-actions top-gap-small">
                              <button type="button" className="mini-btn view bounceable" onClick={() => window.open(`/candidate/${item.candidate_id}`, '_blank')}>Open</button>
                              <button type="button" className="mini-btn call bounceable" disabled={savingId === item.revenue_id} onClick={() => saveRow(item)}>{savingId === item.revenue_id ? 'Saving...' : 'Save Status'}</button>
                              {isManager ? <button type="button" className="mini-btn reject bounceable" disabled={deletingId === item.revenue_id} onClick={() => deleteRow(item)}>{deletingId === item.revenue_id ? 'Deleting...' : 'Delete'}</button> : null}
                            </div>
                          </td>
                          <td className="revenue-srno-col">
                            <strong>{index + 1}</strong>
                          </td>
                          <td>
                            <strong>{item.full_name || item.candidate_id || '-'}</strong><br />
                            <span className="subtle">{item.candidate_id}</span><br />
                            <span className="subtle">{visiblePhone(user, item.phone)}</span><br />
                            <span className="subtle">{item.recruiter_name || '-'} • {item.recruiter_code || '-'}</span>
                          </td>
                          <td>
                            <strong>{item.client_name || '-'}</strong>
                          </td>
                          <td>
                            <strong>{item.process || '-'}</strong>
                          </td>
                          <td>
                            <input type="datetime-local" className="revenue-inline-input" value={draft.interview_datetime || ''} onChange={(e) => setRowDrafts((all) => ({ ...all, [item.revenue_id]: { ...draft, interview_datetime: e.target.value } }))} />
                            <div className="top-gap-small"><span className={`revenue-status-pill ${item.missed ? 'red' : item.overdue_interview ? 'orange' : 'blue'}`}>{item.missed ? 'Missed' : item.overdue_interview ? 'Update due' : 'Tracked'}</span></div>
                          </td>
                          <td>
                            <strong>{item.resume_filename ? 'Resume Added' : 'No Resume'}</strong><br />
                            <span className="subtle">{item.resume_filename || '-'}</span>
                          </td>
                          <td>
                            <input className="revenue-inline-input" value={draft.payout_amount || ''} onChange={(e) => setRowDrafts((all) => ({ ...all, [item.revenue_id]: { ...draft, payout_amount: sanitizeMoneyInput(e.target.value) } }))} placeholder="2000" />
                            <div className="top-gap-small"><select className="revenue-inline-input" value={draft.payout_status || 'none'} onChange={(e) => setRowDrafts((all) => ({ ...all, [item.revenue_id]: { ...draft, payout_status: e.target.value } }))}>{payoutOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
                          </td>
                          <td>
                            <strong>{item.communication_skill || '-'}</strong><br />
                            <span className="subtle">{item.location || '-'}</span>
                          </td>
                          <td>
                            <strong>{item.experience_range || '-'}</strong><br />
                            <span className="subtle">{item.salary_range || '-'}</span>
                          </td>
                          <td>
                            <span className="subtle">Submission: {formatDate(item.submission_date)}</span><br />
                            <span className="subtle">Selection: {formatDate(item.selection_date)}</span><br />
                            <span className="subtle">Joining: {formatDate(item.joining_date)}</span><br />
                            <span className="subtle">Joined: {formatDate(item.joined_date)}</span>
                          </td>
                        </tr>
                      );
                    })}
                    {!items.length && <tr><td colSpan="12" className="helper-text">No Pipeline Hub items matched the current filters.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {viewMode === 'analytics' && (
          <>
            <div className="panel glassy-card top-gap-small">
              <div className="table-title">Analytics Insights</div>
              <div className="pipeline-insight-list top-gap-small">
                {(analytics.insights || []).map((item) => <div key={item} className="pipeline-insight-chip">{item}</div>)}
                {!analytics.insights?.length && <div className="helper-text">No analytics insights are available yet for the current data.</div>}
              </div>
            </div>
            <RankingTable
              title="Client Analytics"
              rows={analytics.by_client || []}
              columns={[
                { key: 'label', label: 'Client' },
                { key: 'selected', label: 'Selected' },
                { key: 'joined', label: 'Joined' },
                { key: 'revenue', label: 'Revenue', render: (row) => formatMoney(row.revenue) },
                { key: 'selection_rate', label: 'Selection %', render: (row) => `${row.selection_rate}%` },
                { key: 'retention_rate', label: 'Retention %', render: (row) => `${row.retention_rate}%` },
              ]}
            />
            <RankingTable
              title="Recruiter Analytics"
              rows={analytics.by_recruiter || []}
              columns={[
                { key: 'label', label: 'Recruiter' },
                { key: 'interviews', label: 'Interviews' },
                { key: 'selected', label: 'Selected' },
                { key: 'joined', label: 'Joined' },
                { key: 'revenue', label: 'Revenue', render: (row) => formatMoney(row.revenue) },
              ]}
            />
            <RankingTable
              title="Communication Skill Analytics"
              rows={analytics.by_communication || []}
              columns={[
                { key: 'label', label: 'Communication' },
                { key: 'interviewed', label: 'Interviewed' },
                { key: 'selected', label: 'Selected' },
                { key: 'selection_rate', label: 'Selection %', render: (row) => `${row.selection_rate}%` },
                { key: 'joined', label: 'Joined' },
              ]}
            />
          </>
        )}

        {viewMode === 'leaderboard' && (
          <>
            <div className="table-panel glassy-card top-gap-small">
              <div className="table-toolbar">
                <div>
                  <div className="table-title">Client Leaderboard</div>
                  <div className="helper-text">Review which client is leading on revenue, selection, joinings, and retention.</div>
                </div>
                <div className="pipeline-leaderboard-switches">
                  <button type="button" className={`ghost-btn bounceable ${leaderboardMetric === 'by_revenue' ? 'active' : ''}`} onClick={() => setLeaderboardMetric('by_revenue')}>Best Money</button>
                  <button type="button" className={`ghost-btn bounceable ${leaderboardMetric === 'by_selection_rate' ? 'active' : ''}`} onClick={() => setLeaderboardMetric('by_selection_rate')}>Best Selection</button>
                  <button type="button" className={`ghost-btn bounceable ${leaderboardMetric === 'by_joinings' ? 'active' : ''}`} onClick={() => setLeaderboardMetric('by_joinings')}>Most Joinings</button>
                  <button type="button" className={`ghost-btn bounceable ${leaderboardMetric === 'by_retention' ? 'active' : ''}`} onClick={() => setLeaderboardMetric('by_retention')}>Best Retention</button>
                  <button type="button" className={`ghost-btn bounceable ${leaderboardMetric === 'by_interviews' ? 'active' : ''}`} onClick={() => setLeaderboardMetric('by_interviews')}>Most Interviews</button>
                </div>
              </div>
            </div>
            <RankingTable
              title="Leaderboard Results"
              rows={leaderboardRows}
              columns={[
                { key: 'label', label: 'Client' },
                { key: 'interviews', label: 'Interviews' },
                { key: 'selected', label: 'Selected' },
                { key: 'joined', label: 'Joined' },
                { key: 'revenue', label: 'Revenue', render: (row) => formatMoney(row.revenue) },
                { key: 'selection_rate', label: 'Selection %', render: (row) => `${row.selection_rate}%` },
                { key: 'retention_rate', label: 'Retention %', render: (row) => `${row.retention_rate}%` },
              ]}
            />
          </>
        )}
      </div>

      {showAdd && (
        <div className="crm-modal-backdrop pipeline-modal-backdrop">
          <div className="crm-premium-modal revenue-add-modal pipeline-add-modal pipeline-upgrade-modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-title">Add Candidate to Pipeline Hub</div>
            <div className="helper-text top-gap-small">Pick a candidate from search and the form auto-fills the rest.</div>

            {!candidateRecord && (
              <>
                <div className="top-gap revenue-search-row">
                  <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') runSearch(search).catch(() => {}); }} placeholder="Search candidate code, first name, full name or mobile number" />
                  <button type="button" className="add-profile-btn bounceable" onClick={() => runSearch(search)}>Search</button>
                </div>
                {showSearchResults && (
                  <div className="revenue-search-results top-gap-small compact-results">
                    {displayedSearchItems.map((item) => (
                      <button key={item.candidate_id} type="button" className={`revenue-search-item ${addForm.candidate_id === item.candidate_id ? 'active' : ''}`} onClick={() => pickCandidate(item)}>
                        <strong>{item.full_name}</strong>
                        <span>{item.candidate_id} • {visiblePhone(user, item.phone || item.number)}</span>
                        <span>{item.process || item.client_name || '-'} • {item.recruiter_code || '-'}</span>
                        {item.already_in_pipeline ? <span className="pipeline-existing-pill">Already in Pipeline</span> : null}
                      </button>
                    ))}
                    {!displayedSearchItems.length && <div className="helper-text">No candidate found. Search by code, first name, full name or mobile number.</div>}
                  </div>
                )}
              </>
            )}

            {candidateRecord && (
              <div className="pipeline-add-layout top-gap">
                <div className="pipeline-main-form">
                  <div className="pipeline-autofill-banner">
                    <div className="pipeline-autofill-copy">
                      <strong>{candidateRecord.full_name}</strong>
                      <div className="helper-text">{candidateRecord.candidate_id} • {visiblePhone(user, candidateRecord.phone || candidateRecord.number)} • {candidateRecord.process || candidateRecord.client_name || '-'} • {candidateRecord.recruiter_code || '-'}</div>
                    </div>
                    <button type="button" className="ghost-btn bounceable" onClick={() => { setCandidateRecord(null); setCandidateFiles([]); setSearchItems([]); setShowSearchResults(true); }}>Change Candidate</button>
                  </div>
                  <div className="pipeline-auto-grid top-gap-small">
                    <label className="field pipeline-form-field"><span>Status *</span><select value={addForm.status} onChange={(e) => setAddForm((prev) => ({ ...prev, status: e.target.value }))}><option value="">Select Status</option>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label className="field pipeline-form-field"><span>Name</span><input value={addForm.full_name} readOnly /></label>
                    <div className="field pipeline-form-field pipeline-choice-field">
                      <span>Client</span>
                      <div className="pipeline-inline-field-row pipeline-inline-picker-row">
                        <select value={addForm.client_name} onChange={(e) => setAddForm((prev) => ({ ...prev, client_name: e.target.value }))} title={addForm.client_name || 'Select Client'}>
                          <option value="">Select Client</option>
                          {availableClientOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                        <button type="button" className="ghost-btn bounceable pipeline-inline-add-btn" onClick={addNewClientOption} aria-label="Add New Client" title="Add New Client">+</button>
                      </div>
                    </div>
                    <div className="field pipeline-form-field pipeline-choice-field">
                      <span>Process</span>
                      <div className="pipeline-inline-field-row pipeline-inline-picker-row">
                        <select value={addForm.process} onChange={(e) => setAddForm((prev) => ({ ...prev, process: e.target.value }))} title={addForm.process || 'Select Process'}>
                          <option value="">Select Process</option>
                          {availableProcessOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                        <button type="button" className="ghost-btn bounceable pipeline-inline-add-btn" onClick={addNewProcessOption} aria-label="Add New Process" title="Add New Process">+</button>
                      </div>
                    </div>
                    <label className="field pipeline-form-field"><span>Interview Date & Time</span><input type="datetime-local" value={addForm.interview_datetime} onChange={(e) => setAddForm((prev) => ({ ...prev, interview_datetime: e.target.value }))} /></label>
                    <label className="field pipeline-form-field"><span>Interview Mode</span><select value={addForm.interview_mode} onChange={(e) => setAddForm((prev) => ({ ...prev, interview_mode: e.target.value }))}><option value="">Select Interview Mode</option>{INTERVIEW_MODE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                    <div className="field pipeline-form-field pipeline-file-box">
                      <span>Resume</span>
                      <div className="helper-text">{latestResumeFile?.original_name || candidateRecord.resume_filename || 'No resume uploaded yet'}<br />Resume is required. Supported formats: PDF, JPG, PNG, WEBP, DOC, DOCX, DOCM, DOTX, DOTM, ODT, RTF, TXT, HTML, and MD. The system stores the resume in a compact format whenever possible.</div>
                      <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.docm,.dotx,.dotm,.odt,.rtf,.txt,.html,.htm,.md" onChange={(e) => uploadCandidateAsset('resume', e.target.files?.[0])} />
                      {fileBusy.startsWith('resume:') ? <div className="helper-text">Uploading...</div> : null}
                    </div>
                    <label className="field pipeline-form-field"><span>Payout</span><input value={addForm.payout_amount} onChange={(e) => setAddForm((prev) => ({ ...prev, payout_amount: sanitizeMoneyInput(e.target.value) }))} placeholder="2000" /></label>
                    <label className="field pipeline-form-field"><span>Number</span><input value={addForm.number} readOnly /></label>
                    <label className="field pipeline-form-field"><span>Preferred Location</span><select value={addForm.preferred_location} onChange={(e) => setAddForm((prev) => ({ ...prev, preferred_location: e.target.value }))}><option value="">Select Preferred Location</option>{availablePreferredLocationOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                    <label className="field pipeline-form-field"><span>Degree / Qualification</span><select value={addForm.qualification} onChange={(e) => setAddForm((prev) => ({ ...prev, qualification: e.target.value }))}>{DEGREE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                    <label className="field pipeline-form-field"><span>Communication Skill</span><select value={addForm.communication_skill} onChange={(e) => setAddForm((prev) => ({ ...prev, communication_skill: e.target.value }))}><option value="">Select Communication Skill</option>{availableCommunicationOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                    <label className="field pipeline-form-field"><span>Experience Range</span><select value={addForm.experience_range} onChange={(e) => setAddForm((prev) => ({ ...prev, experience_range: e.target.value }))}><option value="">Select Experience Range</option>{availableExperienceOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                    <label className="field pipeline-form-field"><span>Salary Range</span><select value={addForm.salary_range} onChange={(e) => setAddForm((prev) => ({ ...prev, salary_range: e.target.value }))}><option value="">Select Salary Range</option>{availableSalaryOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                    <label className="field pipeline-form-field"><span>Submission Date</span><input type="date" value={addForm.submission_date} readOnly /></label>
                    <div className="field pipeline-form-field pipeline-file-box">
                      <span>Recording</span>
                      <div className="helper-text">{latestRecordingFile?.original_name || candidateRecord.recording_filename || 'Optional recording. Supported formats include AMR, 3GP, MOV, MP3, WAV, M4A, AAC, OGG, WEBM, and MP4.'}</div>
                      <input type="file" accept=".mp3,.wav,.m4a,.aac,.ogg,.webm,.mp4,.amr,.3gp,.mov" onChange={(e) => uploadCandidateAsset('call_recording', e.target.files?.[0])} />
                      {fileBusy.startsWith('call_recording:') ? <div className="helper-text">Uploading...</div> : null}
                    </div>
                  </div>

                  <div className="revenue-add-form-grid top-gap-small extra-grid pipeline-extra-grid">
                    <div className="field"><label>Selection Date</label><input type="date" value={addForm.selection_date} onChange={(e) => setAddForm((prev) => ({ ...prev, selection_date: e.target.value }))} /></div>
                    <div className="field"><label>Joining Date</label><input type="date" value={addForm.joining_date} onChange={(e) => setAddForm((prev) => ({ ...prev, joining_date: e.target.value }))} /></div>
                    <div className="field"><label>Joined Date</label><input type="date" value={addForm.joined_date} onChange={(e) => setAddForm((prev) => ({ ...prev, joined_date: e.target.value }))} /></div>
                    <div className="field"><label>Payout Stage</label><select value={addForm.payout_status} onChange={(e) => setAddForm((prev) => ({ ...prev, payout_status: e.target.value }))}>{payoutOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
                  </div>

                  <div className="field top-gap-small pipeline-notes-field"><label>Notes</label><textarea value={addForm.notes} onChange={(e) => setAddForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Optional notes" rows={3} /></div>
                </div>

                <div className="pipeline-wa-panel">
                  <div className="table-title">Inform Client (WhatsApp)</div>
                  <div className="field top-gap-small"><label>WhatsApp Number</label><div className="pipeline-wa-number-row"><input value={waNumber} onChange={(e) => setWaNumber(e.target.value)} /><button type="button" className="ghost-btn bounceable" onClick={() => setWaNumber(window.prompt('New WhatsApp number', waNumber) || waNumber)}>Change</button></div></div>
                  <div className="field top-gap-small"><label>Message Template</label><select value={selectedPresetId} onChange={(e) => handleTemplateSelect(e.target.value)}>{templates.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}<option value="__add_new__">Add New</option></select></div>
                  <div className="pipeline-insight-chip top-gap-small">Message Preview</div>
                  <div className="pipeline-message-preview top-gap-small">{messagePreview.split('\n').map((line, index) => <div key={`${line}-${index}`}>{line || <br />}</div>)}</div>
                  <label className="pipeline-attach-check top-gap-small"><input type="checkbox" checked={attachResume} onChange={(e) => setAttachResume(e.target.checked)} /> Attach resume {latestResumeFile || candidateRecord.resume_filename ? '' : '(none uploaded)'}</label>
                  <label className="pipeline-attach-check"><input type="checkbox" checked={attachRecording} onChange={(e) => setAttachRecording(e.target.checked)} /> Attach recording {latestRecordingFile || candidateRecord.recording_filename ? '' : '(optional)'}</label>
                  <button type="button" className="add-profile-btn bounceable top-gap-small full-width-btn" onClick={openWhatsAppForClient} disabled={shareBusy}>{shareBusy ? 'Opening...' : 'Inform Client'}</button>
                  
                </div>
              </div>
            )}

            {addInlineMessage ? <div className="helper-text revenue-add-inline-message top-gap-small">{addInlineMessage}</div> : null}
            <div className="row-actions top-gap pipeline-modal-footer">
              <button type="button" className="add-profile-btn bounceable" onClick={addCandidate} disabled={addBusy || !candidateRecord}>{addBusy ? 'Working...' : currentEntry ? 'Update Candidate' : 'Add Candidate'}</button>
              <button type="button" className="ghost-btn bounceable" onClick={() => { setShowAdd(false); resetAddModal(); }} disabled={addBusy}>Close</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
