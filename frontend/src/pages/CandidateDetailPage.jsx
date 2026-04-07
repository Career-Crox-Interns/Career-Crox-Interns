import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { addNoteTemplate, addWhatsAppTemplate, getNoteTemplates, getWhatsAppTemplates } from '../lib/templateStore';
import { dialCandidateWithLog, maskPhone, openWhatsAppWithLog, shouldMaskPhone, visiblePhone } from '../lib/candidateAccess';

const CAREER_GAP_OPTIONS = ['Fresher', 'Currently Working', '1 - 3 Month', '4 - 6 Month', '7 - 12 Month', '1 - 1.5 Year', '1.6 - 2 Year'];
const STATUS_OPTIONS = ['In - Progress', 'All set for Interview', 'Appeared in Interview', 'Selected', 'Rejected', 'Not Intrested', 'Not Responding', 'Rejected once, needs new Interview', 'Joined', 'Active'];
const WEEKDAY_CHOICES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CALL_CONNECTED_OPTIONS = ['No', 'Yes', 'Partially'];
const LOOKING_FOR_JOB_OPTIONS = ['Yes', 'No'];
const DEGREE_OPTIONS = ['NON - Graduate', 'Graduate'];
const DETAILS_SENT_OPTIONS = ['Pending', 'Completed'];
const COMMUNICATION_SKILL_OPTIONS = ['Excellent', 'Good', 'Normal', 'Average', 'Below Average'];
const EXPERIENCE_RANGE_OPTIONS = ['Fresher', '1 - 3 Month', '4 - 6 Month', '7 - 12 Month', '1 - 1.5 Year', '1.6 - 2 Year', '2 - 2.5 Year', '2.6 - 3 Year', '3 - 3.5 Year', '3.6 - 4 Year', '4 - 4.5 Year', '4.6 - 5 Year', '5+ Year'];
const SALARY_RANGE_OPTIONS = ['0', '₹1K - ₹15K', '₹16K - ₹20K', '₹21K - ₹25K', '₹26K - ₹30K', '₹31K - ₹35K'];
const PREFERRED_LOCATIONS = ['Noida', 'Gurgaon', 'Mumbai'];
const PREFERRED_LOCATION_STORAGE_KEY = 'careerCroxPreferredLocations_v3';
const INTERVIEW_MODE_OPTIONS = ['Virtual', 'Walkin'];
const DOCUMENTS_OPTIONS = ['Yes', 'No', 'Partially'];

const FOLLOW_UP_PRESETS = [
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '2h', minutes: 120 },
  { label: '4h', minutes: 240 },
  { label: 'Tomorrow 10AM', custom: 'tomorrow10' },
];

const DEFAULT_CANDIDATE_FIELD_ORDER = [
  'full_name','phone','location','qualification','preferred_location','qualification_level','total_experience','relevant_experience',
  'relevant_experience_range','ctc_monthly','in_hand_salary','relevant_in_hand_range','career_gap','documents_availability',
  'communication_skill','follow_up_at','interview_reschedule_date','virtual_onsite','status','all_details_sent','submission_date',
  'process','call_connected','looking_for_job','master_notes'
];

const expRange = (value) => {
  const months = Number(String(value || '').replace(/[^\d.]/g, '')) || 0;
  if (!months) return 'Fresher';
  if (months <= 3) return '1 - 3 Month';
  if (months <= 6) return '4 - 6 Month';
  if (months <= 12) return '7 - 12 Month';
  if (months <= 18) return '1 - 1.5 Year';
  if (months <= 24) return '1.6 - 2 Year';
  if (months <= 30) return '2 - 2.5 Year';
  if (months <= 36) return '2.6 - 3 Year';
  if (months <= 42) return '3 - 3.5 Year';
  if (months <= 48) return '3.6 - 4 Year';
  if (months <= 54) return '4 - 4.5 Year';
  if (months <= 60) return '4.6 - 5 Year';
  return '5+ Year';
};

const salaryRange = (value) => {
  const amount = Number(String(value || '').replace(/[^\d.]/g, '')) || 0;
  if (!amount) return '0';
  if (amount <= 15000) return '₹1K - ₹15K';
  if (amount <= 20000) return '₹16K - ₹20K';
  if (amount <= 25000) return '₹21K - ₹25K';
  if (amount <= 30000) return '₹26K - ₹30K';
  return '₹31K - ₹35K';
};

function normalizeIndianPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  while (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length > 10) digits = digits.slice(-10);
  return digits;
}

function splitMulti(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function toggleMultiValue(current, value, keepOneSelected = false) {
  const list = splitMulti(current);
  const exists = list.includes(value);
  if (exists) {
    if (keepOneSelected && list.length <= 1) return list.join(', ');
    return list.filter((item) => item !== value).join(', ');
  }
  return [...list, value].join(', ');
}

function readStoredPreferredLocations() {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFERRED_LOCATION_STORAGE_KEY) || '[]');
    if (!Array.isArray(stored)) return [...PREFERRED_LOCATIONS];
    return [...new Set([...PREFERRED_LOCATIONS, ...stored.map((item) => String(item || '').trim()).filter(Boolean)])];
  } catch {
    return [...PREFERRED_LOCATIONS];
  }
}

function persistPreferredLocations(options = []) {
  const cleaned = [...new Set(options.map((item) => String(item || '').trim()).filter(Boolean))];
  localStorage.setItem(PREFERRED_LOCATION_STORAGE_KEY, JSON.stringify(cleaned.filter((item) => !PREFERRED_LOCATIONS.includes(item))));
}

function toInputDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function nowDateTimeLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function addMinutesDateTimeLocal(minutes = 0) {
  const d = new Date(Date.now() + Number(minutes || 0) * 60000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function tomorrowAt(hour = 10, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, minute, 0, 0);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function parseMonthCount(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Number(raw) || 0;
  const yearMatch = raw.match(/(\d+(?:\.\d+)?)\s*y/);
  const monthMatch = raw.match(/(\d+(?:\.\d+)?)\s*m/);
  const years = yearMatch ? Number(yearMatch[1]) || 0 : 0;
  const months = monthMatch ? Number(monthMatch[1]) || 0 : 0;
  if (yearMatch || monthMatch) return Math.round((years * 12) + months);
  const numeric = Number(raw.replace(/[^\d.]/g, '')) || 0;
  return numeric;
}

function splitExperienceValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { years: '', months: '' };
  const totalMonths = parseMonthCount(raw);
  if (!totalMonths && raw !== '0') return { years: '', months: '' };
  return { years: String(Math.floor(totalMonths / 12)), months: String(totalMonths % 12) };
}

function joinExperienceValue(years, months) {
  const cleanYears = Math.max(0, Number(String(years || '').replace(/[^\d]/g, '')) || 0);
  const cleanMonths = Math.max(0, Math.min(11, Number(String(months || '').replace(/[^\d]/g, '')) || 0));
  return String((cleanYears * 12) + cleanMonths);
}

function formatExperiencePreview(value) {
  const totalMonths = parseMonthCount(value);
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const parts = [];
  if (years) parts.push(`${years} Year${years === 1 ? '' : 's'}`);
  if (months || !parts.length) parts.push(`${months} Month${months === 1 ? '' : 's'}`);
  return parts.join(' ');
}

function toDateTimeLocalInput(value) {
  if (!value) return '';
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return raw;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00` : raw;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatTwelveHour(value) {
  const local = toDateTimeLocalInput(value);
  if (!local) return '';
  const [datePart, timePart] = local.split('T');
  const [year, month, day] = datePart.split('-');
  let [hours, minutes] = timePart.split(':').map(Number);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day}-${month}-${year} ${pad2(hours)}:${pad2(minutes)} ${suffix}`;
}

function formatFileSize(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function buildSubmitValidation(item) {
  const required = [
    ['full_name', 'Name'],
    ['phone', 'Number'],
    ['location', 'Location'],
    ['qualification', 'Qualification'],
    ['preferred_location', 'Preferred Location'],
    ['qualification_level', 'Degree'],
    ['total_experience', 'Total Experience'],
    ['relevant_experience', 'Relevant Experience'],
    ['communication_skill', 'Communication Skill'],
    ['in_hand_salary', 'In-hand Monthly'],
    ['ctc_monthly', 'CTC Monthly'],
    ['career_gap', 'Career Gap'],
    ['relevant_experience_range', 'Relevant Experience Range'],
    ['relevant_in_hand_range', 'Relevant In-hand Range'],
    ['interview_reschedule_date', 'Interview Date'],
    ['status', 'Status'],
    ['all_details_sent', 'All Details Sent'],
    ['submission_date', 'Submission Date'],
    ['virtual_onsite', 'Interview Mode'],
    ['documents_availability', 'All Documents Availability'],
  ];
  const missingPairs = required.filter(([key]) => !String(item?.[key] || '').trim());
  const flaggedPairs = [
    String(item?.looking_for_job || 'Yes').trim().toLowerCase() !== 'yes' ? ['looking_for_job', 'Looking For Job'] : null,
  ].filter(Boolean);

  const seen = new Set();
  const missing = [];
  const flagged = [];
  const missingKeys = [];
  for (const [key, label] of [...missingPairs, ...flaggedPairs]) {
    if (seen.has(key)) continue;
    seen.add(key);
    missingKeys.push(key);
    if (missingPairs.some(([missingKey]) => missingKey == key)) missing.push(label);
    else flagged.push(label);
  }

  const messages = [];
  if (flaggedPairs.some(([key]) => key === 'looking_for_job')) messages.push('Looking For Job must stay Yes before submit.');
  if (missing.length) messages.push(`Missing fields: ${missing.join(', ')}`);
  if (flagged.length) messages.push(`Check these fields: ${flagged.join(', ')}`);
  if (messages.length) return { ok: false, message: messages.join(' • '), missingKeys };
  return { ok: true, message: '', missingKeys: [] };
}

function nextDateForWeekday(label) {
  const target = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(label);
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const delta = (target - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function normalizeDocumentsAvailability(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return 'Yes';
  if (['yes', 'available', 'all available', 'done'].includes(text)) return 'Yes';
  if (['partially', 'partial', 'some available', 'partly'].includes(text)) return 'Partially';
  if (['no', 'not available', 'missing'].includes(text)) return 'No';
  return value;
}

function stableOptions(options = [], value = '') {
  const cleaned = options.map((item) => String(item || '').trim()).filter(Boolean);
  const current = String(value || '').trim();
  if (current && !cleaned.includes(current)) cleaned.push(current);
  return cleaned;
}

function ensureCandidateDefaults(source) {
  if (!source) return source;
  return {
    ...source,
    phone: normalizeIndianPhone(source.phone || ''),
    call_connected: source.call_connected || 'No',
    looking_for_job: source.looking_for_job || 'Yes',
    preferred_location: source.preferred_location || 'Noida',
    qualification_level: source.qualification_level || source.degree || 'Graduate',
    career_gap: source.career_gap || 'Fresher',
    status: source.status || 'In - Progress',
    all_details_sent: source.all_details_sent || 'Pending',
    virtual_onsite: source.virtual_onsite || 'Walkin',
    documents_availability: normalizeDocumentsAvailability(source.documents_availability || 'Yes'),
    submission_date: toDateTimeLocalInput(source.submission_date || nowDateTimeLocal()) || nowDateTimeLocal(),
  };
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeCandidatePayload(source) {
  const payload = JSON.parse(JSON.stringify(source || {}));
  delete payload.jd_fit_summary;
  delete payload.notes_list;
  delete payload.timeline;
  delete payload.nav_items;
  delete payload.process_options;
  return payload;
}

function makeOptimisticNote(body, username) {
  return {
    id: `optimistic-note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    body,
    username,
    created_at: nowIso(),
    optimistic: true,
  };
}

function makeOptimisticTimeline(actionType, username, metadata = {}) {
  return {
    activity_id: `optimistic-${actionType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    action_type: actionType,
    username,
    created_at: nowIso(),
    metadata: JSON.stringify(metadata || {}),
    optimistic: true,
  };
}

function timelineText(row) {
  const meta = (() => {
    try { return JSON.parse(row.metadata || '{}'); } catch { return {}; }
  })();
  const changed = Array.isArray(meta.changed_fields) ? meta.changed_fields.join(', ') : '';
  const trimmedBody = String(meta.body || '').trim();
  const map = {
    profile_opened: `${row.username || 'Someone'} opened the profile${meta.section ? ` from ${meta.section}` : ''}`,
    candidate_created: `${row.username || 'Someone'} created the profile`,
    profile_updated: `${row.username || 'Someone'} saved the profile${changed ? ` • ${changed}` : meta.change_count === 0 ? ' • no field change' : ''}`,
    note_added: `${row.username || 'Someone'} added a note${trimmedBody ? `: ${trimmedBody}` : ''}`,
    call_logged: `${row.username || 'Someone'} logged a call${meta.phone ? ` to ${maskPhone(meta.phone)}` : ''}`,
    whatsapp_opened: `${row.username || 'Someone'} opened WhatsApp${meta.phone ? ` for ${maskPhone(meta.phone)}` : ''}`,
    submitted_for_approval: `${row.username || 'Someone'} submitted the profile for approval`,
    submission_approved: `${row.username || 'Someone'} approved the submission`,
    submission_rejected: `${row.username || 'Someone'} rejected the submission${meta.reason ? `: ${meta.reason}` : ''}`,
    follow_up_updated: `${row.username || 'Someone'} updated follow-up status${meta.follow_up_status ? ` to ${meta.follow_up_status}` : ''}`,
    interview_date_removal_requested: `${row.username || 'Someone'} requested interview date removal${meta.reason ? `: ${meta.reason}` : ''}`,
    interview_date_removed: `${row.username || 'Someone'} removed the interview date`,
    candidate_file_uploaded: `${row.username || 'Someone'} uploaded ${meta.file_kind === 'call_recording' ? 'a call recording' : 'a resume'}${meta.file_name ? `: ${meta.file_name}` : ''}`,
  };
  return map[row.action_type] || `${row.username || 'Someone'} did ${row.action_type || 'an update'}`;
}

function timelineBadge(row) {
  const map = {
    profile_opened: 'Opened',
    candidate_created: 'Created',
    profile_updated: 'Saved',
    note_added: 'Note',
    call_logged: 'Call',
    whatsapp_opened: 'WhatsApp',
    submitted_for_approval: 'Submitted',
    submission_approved: 'Approved',
    submission_rejected: 'Rejected',
    follow_up_updated: 'Follow-up',
    interview_date_removal_requested: 'Removal Request',
    interview_date_removed: 'Interview Removed',
    candidate_file_uploaded: 'File',
  };
  return map[row.action_type] || 'Activity';
}

function formatTimelineTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isTodayAction(value) {
  return String(value || '').slice(0, 10) === new Date().toISOString().slice(0, 10);
}

function timelineBucket(value) {
  const raw = String(value || '');
  if (!raw) return 'all';
  const now = new Date();
  const actionDate = new Date(raw);
  if (Number.isNaN(actionDate.getTime())) return 'all';
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startPastThreeDays = new Date(startToday);
  startPastThreeDays.setDate(startPastThreeDays.getDate() - 2);
  if (actionDate >= startToday) return 'today';
  if (actionDate >= startPastThreeDays) return 'past3';
  return 'all';
}

function MiniIconButton({ title, onClick, children, className = '', disabled = false }) {
  return <button className={`mini-btn bounceable detail-nav-btn ${className}`} type="button" title={title} onClick={onClick} disabled={disabled}>{children}</button>;
}

function PrevIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M15 18 9 12l6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function NextIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m9 18 6-6-6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function PhoneIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7.4 3.8h2.1c.5 0 .9.3 1.1.8l1.1 3.1c.2.5 0 1.1-.4 1.4L9.8 10.4a13.2 13.2 0 0 0 3.8 3.8l1.3-1.5c.3-.4.9-.6 1.4-.4l3.1 1.1c.5.2.8.6.8 1.1v2.1c0 .7-.6 1.3-1.3 1.3A15.9 15.9 0 0 1 6.1 5.1c0-.7.6-1.3 1.3-1.3Z" fill="currentColor" /></svg>;
}
function WhatsAppIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M19.1 4.8A9.7 9.7 0 0 0 3.8 16.7L2.7 21.3l4.8-1.1a9.7 9.7 0 0 0 4.5 1.1h.1a9.7 9.7 0 0 0 7-16.5Zm-7 14.8h-.1a7.9 7.9 0 0 1-4-1.1l-.3-.2-2.8.7.7-2.7-.2-.3a7.9 7.9 0 1 1 6.7 3.6Z" fill="currentColor" /><path d="M16.5 13.8c-.2-.1-1.3-.7-1.5-.7-.2-.1-.3-.1-.5.1l-.4.5c-.1.2-.3.2-.5.1-.2-.1-.8-.3-1.5-1a5.5 5.5 0 0 1-1-1.2c-.1-.2 0-.3.1-.4l.3-.4.2-.4c.1-.1 0-.3 0-.4l-.7-1.6c-.2-.4-.3-.3-.5-.3h-.4c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 1.9 0 1 .8 2.1.9 2.3.1.1 1.7 2.6 4 3.6 2.4 1 2.4.7 2.8.7.4-.1 1.3-.5 1.5-1 .2-.4.2-.9.2-1 0-.1-.2-.2-.4-.3Z" fill="currentColor" /></svg>;
}

function CelebrationBurst({ active }) {
  if (!active) return null;
  return (
    <div className="celebration-burst" aria-hidden="true">
      {Array.from({ length: 18 }).map((_, idx) => <span key={idx} className={`confetti-piece p${idx % 6}`} />)}
    </div>
  );
}

function ChoiceField({ label, value, options, onChange, disabled = false, compact = false, invalid = false, showAll = false }) {
  const normalizedOptions = stableOptions(options, value);
  const current = String(value || '').trim();
  let chipOptions = showAll ? normalizedOptions.slice() : normalizedOptions.slice(0, Math.min(5, normalizedOptions.length));
  if (current && !chipOptions.includes(current)) {
    chipOptions = [...chipOptions.slice(0, 4), current];
  }
  return (
    <div className={`field ${compact ? 'compact-field' : ''} ${invalid ? 'invalid-field' : ''}`.trim()}>
      <label>{label}</label>
      <div className="choice-chip-row compact-row">
        {chipOptions.map((option) => (
          <button
            key={option}
            type="button"
            disabled={disabled}
            className={`choice-chip bounceable ${String(value) === String(option) ? 'active' : ''}`}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
      {current ? <div className="helper-text top-gap-small">Selected: {current}</div> : null}
    </div>
  );
}

function MultiChoiceField({ label, value, options, onChange, disabled = false, invalid = false, keepOneSelected = false }) {
  const selected = splitMulti(value);
  const mergedOptions = [...new Set([...(options || []).map((option) => String(option || '').trim()).filter(Boolean), ...selected])];
  return (
    <div className={`field ${invalid ? 'invalid-field' : ''}`.trim()}>
      <label>{label}</label>
      <div className="choice-chip-row compact-row">
        {mergedOptions.map((option) => (
          <button
            key={option}
            type="button"
            disabled={disabled}
            className={`choice-chip bounceable ${selected.includes(option) ? 'active' : ''}`}
            onClick={() => onChange(toggleMultiValue(value, option, keepOneSelected))}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="helper-text top-gap-small">{selected.length ? selected.join(', ') : 'Select one or more options.'}</div>
    </div>
  );
}


function SelectField({ label, value, options, onChange, disabled = false, invalid = false }) {
  const normalizedOptions = stableOptions(options, value);
  return (
    <div className={`field native-select-field ${invalid ? 'invalid-field' : ''}`.trim()}>
      <label>{label}</label>
      <select value={String(value || '')} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={invalid ? 'invalid-input' : ''}>
        <option value="">Select</option>
        {normalizedOptions.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
  );
}

export default function CandidateDetailPage() {
  const { candidateId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const formRef = useRef(null);
  const openLoggedRef = useRef('');
  const candidateCacheRef = useRef({});
  const resetSnapshotRef = useRef(null);
  const [item, setItem] = useState(null);
  const [notes, setNotes] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [noteBody, setNoteBody] = useState('');
  const [message, setMessage] = useState('');
  const [candidateFiles, setCandidateFiles] = useState([]);
  const [fileBusy, setFileBusy] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [timelineTab, setTimelineTab] = useState('today');
  const [processOptions, setProcessOptions] = useState([]);
  const [preferredLocations, setPreferredLocations] = useState(() => readStoredPreferredLocations());
  const [candidateList, setCandidateList] = useState([]);
  const [noteTemplates, setNoteTemplates] = useState(getNoteTemplates());
  const [waTemplates, setWaTemplates] = useState(getWhatsAppTemplates());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [removeInterviewOpen, setRemoveInterviewOpen] = useState(false);
  const [removeInterviewReason, setRemoveInterviewReason] = useState('');
  const [statusFlash, setStatusFlash] = useState('');
  const [celebrate, setCelebrate] = useState(false);
  const [invalidFields, setInvalidFields] = useState([]);
  const [syncState, setSyncState] = useState('idle');
  const [actionBusy, setActionBusy] = useState('');
  const actionLockRef = useRef('');
  const [routeBusy, setRouteBusy] = useState(false);
  const [jdSuggestionPopup, setJdSuggestionPopup] = useState(null);
  const fieldOrderStorageKey = `careerCroxCandidateFieldOrder_v3:${String(user?.user_id || user?.role || 'guest').toLowerCase()}`;
  const [fieldOrder, setFieldOrder] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(fieldOrderStorageKey) || '[]');
      return Array.isArray(saved) && saved.length ? saved : DEFAULT_CANDIDATE_FIELD_ORDER;
    } catch {
      return DEFAULT_CANDIDATE_FIELD_ORDER;
    }
  });
  const [dragFieldKey, setDragFieldKey] = useState('');

  const leadership = ['admin', 'manager', 'tl'].includes(user?.role);
  const canDirectRemoveInterview = leadership;
  const latestResumeFile = useMemo(() => candidateFiles.find((file) => file.file_kind === 'resume') || null, [candidateFiles]);
  const latestRecordingFile = useMemo(() => candidateFiles.find((file) => file.file_kind === 'call_recording') || null, [candidateFiles]);
  const visibleNotes = useMemo(() => (showHistory ? notes : notes.slice(0, 5)), [showHistory, notes]);
  const filteredTimeline = useMemo(() => {
    if (timelineTab === 'today') return timeline.filter((row) => timelineBucket(row.created_at) === 'today');
    if (timelineTab === 'past3') return timeline.filter((row) => ['today', 'past3'].includes(timelineBucket(row.created_at)));
    return timeline;
  }, [timeline, timelineTab]);
  const visibleTimeline = useMemo(() => (showTimeline ? filteredTimeline : filteredTimeline.slice(0, 12)), [showTimeline, filteredTimeline]);
  const approvalPending = String(item?.approval_status || '').toLowerCase() === 'pending';
  const editingLocked = approvalPending && !leadership;
  const processIsCustom = !!item?.process && !processOptions.includes(item.process);
  const selectedDate = toInputDate(item?.interview_reschedule_date || '');
  const prevCandidate = useMemo(() => {
    const idx = candidateList.findIndex((row) => row.candidate_id === candidateId);
    return idx > 0 ? candidateList[idx - 1] : null;
  }, [candidateList, candidateId]);
  const nextCandidate = useMemo(() => {
    const idx = candidateList.findIndex((row) => row.candidate_id === candidateId);
    return idx >= 0 && idx < candidateList.length - 1 ? candidateList[idx + 1] : null;
  }, [candidateList, candidateId]);
  const displayStatusOptions = useMemo(() => {
    const current = String(item?.status || '');
    return current && !STATUS_OPTIONS.includes(current) ? [...STATUS_OPTIONS, current] : STATUS_OPTIONS;
  }, [item?.status]);
  const canEditDataNotes = ['manager'].includes(String(user?.role || '').trim().toLowerCase()) || String(user?.designation || '').trim().toLowerCase() === 'manager';
  const phoneIsMaskedForRecruiter = shouldMaskPhone(user) && Boolean(normalizeIndianPhone(item?.phone || ''));

  useEffect(() => {
    setFieldOrder((current) => {
      const base = Array.isArray(current) && current.length ? current.filter((key) => DEFAULT_CANDIDATE_FIELD_ORDER.includes(key)) : [];
      for (const key of DEFAULT_CANDIDATE_FIELD_ORDER) if (!base.includes(key)) base.push(key);
      return base;
    });
  }, []);

  useEffect(() => {
    try { localStorage.setItem(fieldOrderStorageKey, JSON.stringify(fieldOrder)); } catch {}
  }, [fieldOrder, fieldOrderStorageKey]);

  function fieldOrderIndex(fieldKey) {
    const idx = fieldOrder.indexOf(fieldKey);
    return idx >= 0 ? idx : fieldOrder.length + 1;
  }

  function moveField(dragKey, targetKey) {
    if (!dragKey || !targetKey || dragKey === targetKey) return;
    setFieldOrder((current) => {
      const base = (current.length ? current : DEFAULT_CANDIDATE_FIELD_ORDER).filter(Boolean);
      const filtered = base.filter((key) => key !== dragKey);
      const targetIndex = filtered.indexOf(targetKey);
      if (targetIndex < 0) return [...filtered, dragKey];
      filtered.splice(targetIndex, 0, dragKey);
      return filtered;
    });
  }

  function sortableFieldProps(fieldKey) {
    return {
      draggable: true,
      onDragStart: () => setDragFieldKey(fieldKey),
      onDragOver: (event) => event.preventDefault(),
      onDrop: (event) => { event.preventDefault(); moveField(dragFieldKey, fieldKey); },
      onDragEnd: () => setDragFieldKey(''),
      style: { order: fieldOrderIndex(fieldKey) },
      'data-sort-no': pad2(fieldOrderIndex(fieldKey) + 1),
      'data-dragging': dragFieldKey === fieldKey ? 'true' : 'false',
    };
  }

  function buildResetSnapshot(source) {
    const base = ensureCandidateDefaults(clonePlain(source) || {});
    return {
      ...base,
      call_connected: base.call_connected || 'No',
      looking_for_job: base.looking_for_job || 'Yes',
      preferred_location: base.preferred_location || '',
      qualification_level: base.qualification_level || '',
      full_name: base.full_name || '',
      phone: base.phone || '',
      location: base.location || '',
      qualification: base.qualification || '',
      recruiter_code: base.recruiter_code || '',
      recruiter_name: base.recruiter_name || '',
      data_uploading_date: base.data_uploading_date || '',
      data_notes: base.data_notes || '',
      source_sr_no: base.source_sr_no || '',
      status: 'In - Progress',
      all_details_sent: 'Pending',
      total_experience: '',
      relevant_experience: '',
      in_hand_salary: '',
      ctc_monthly: '',
      career_gap: 'Fresher',
      relevant_experience_range: '',
      relevant_in_hand_range: '',
      communication_skill: '',
      interview_reschedule_date: '',
      submission_date: nowDateTimeLocal(),
      process: '',
      notes: '',
      virtual_onsite: 'Walkin',
      documents_availability: 'Yes',
      follow_up_at: '',
      follow_up_status: '',
      follow_up_note: '',
    };
  }

  function applyFollowUpPreset(preset) {
    if (!preset) return;
    if (preset.custom === 'tomorrow10') {
      patch({ follow_up_at: tomorrowAt(10, 0), follow_up_status: 'Open' });
      return;
    }
    patch({ follow_up_at: addMinutesDateTimeLocal(preset.minutes || 0), follow_up_status: 'Open' });
  }

  async function resetFilledDetails() {
    if (actionLockRef.current || actionBusy) return;
    if (!window.confirm('Reset filled details and keep only base/imported values?')) return;
    const snapshot = buildResetSnapshot(resetSnapshotRef.current || item);
    setInvalidFields([]);
    if (!beginAction('reset')) return;
    markSync('saving', 'Resetting filled details...');
    try {
      const data = await api.put(`/api/candidates/${candidateId}`, sanitizeCandidatePayload(snapshot));
      const nextItem = ensureCandidateDefaults(data.item || snapshot);
      setItem(nextItem);
      resetSnapshotRef.current = clonePlain(nextItem);
      candidateCacheRef.current[candidateId] = {
        item: nextItem,
        notes,
        timeline,
        process_options: processOptions,
        nav_items: candidateList,
        files: candidateFiles,
      };
      markSync('saved', 'Filled details reset to base values.');
    } catch (err) {
      markSync('error', err.message || 'Reset failed.');
    } finally {
      endAction();
    }
  }

  async function load() {
    const cached = candidateCacheRef.current[candidateId];
    if (cached) {
      resetSnapshotRef.current = clonePlain(cached.item);
      setItem(cached.item);
      setNotes(cached.notes);
      setTimeline(cached.timeline);
      setProcessOptions(cached.process_options);
      setCandidateList(cached.nav_items);
      setCandidateFiles(cached.files || []);
      setLoading(false);
    } else if (!item) {
      setLoading(true);
    }
    setError('');
    try {
      const data = await api.get(`/api/candidates/${candidateId}`, { cacheTtlMs: 0, timeoutMs: 30000 });
      const nextItem = ensureCandidateDefaults(data.item || null);
      if (nextItem && String(nextItem.approval_status || '').toLowerCase() === 'pending') {
        nextItem.status = 'In - Progress';
        nextItem.all_details_sent = 'Pending';
      }
      const payload = {
        item: nextItem,
        notes: data.notes || [],
        timeline: data.timeline || [],
        process_options: data.process_options || [],
        nav_items: data.nav_items || [],
        files: data.files || [],
      };
      candidateCacheRef.current[candidateId] = payload;
      resetSnapshotRef.current = clonePlain(payload.item);
      setItem(payload.item);
      setNotes(payload.notes);
      setTimeline(payload.timeline);
      setProcessOptions(payload.process_options);
      setCandidateList(payload.nav_items);
      setCandidateFiles(payload.files || []);
    } catch (err) {
      setError(err.message || 'Candidate detail could not be loaded.');
      if (!candidateCacheRef.current[candidateId]) setItem(null);
    } finally {
      setLoading(false);
      setRouteBusy(false);
    }
  }

  useEffect(() => {
    const hasVisibleItem = Boolean(item);
    if (hasVisibleItem) setRouteBusy(true);
    load({ soft: hasVisibleItem });
  }, [candidateId]);
  useEffect(() => {
    if (openLoggedRef.current === candidateId) return;
    openLoggedRef.current = candidateId;
    api.post(`/api/candidates/${candidateId}/open`, {}, { timeoutMs: 6000, background: true })
      .then(() => {
        setTimeline((current) => current);
      })
      .catch(() => {});
  }, [candidateId]);
  useEffect(() => {
    if (!statusFlash && !celebrate) return undefined;
    const timer = window.setTimeout(() => { setStatusFlash(''); setCelebrate(false); }, 1800);
    return () => window.clearTimeout(timer);
  }, [statusFlash, celebrate]);
  useEffect(() => {
    if (syncState !== 'saved') return undefined;
    const timer = window.setTimeout(() => setSyncState('idle'), 1400);
    return () => window.clearTimeout(timer);
  }, [syncState]);

  async function prefetchCandidate(targetId) {
    if (!targetId || candidateCacheRef.current[targetId]) return;
    try {
      const data = await api.get(`/api/candidates/${targetId}?prefetch=1`, { cacheTtlMs: 0, timeoutMs: 12000, background: true });
      candidateCacheRef.current[targetId] = {
        item: ensureCandidateDefaults(data.item || null),
        notes: data.notes || [],
        timeline: data.timeline || [],
        process_options: data.process_options || processOptions,
        nav_items: candidateList,
        files: data.files || [],
      };
    } catch {}
  }

  function openCandidate(targetId) {
    if (!targetId) return;
    const cached = candidateCacheRef.current[targetId];
    if (cached?.item) {
      setItem(cached.item);
      setNotes(cached.notes || []);
      setTimeline(cached.timeline || []);
      setProcessOptions(cached.process_options || []);
      setCandidateList(cached.nav_items || candidateList);
      setCandidateFiles(cached.files || []);
      setLoading(false);
      setError('');
    }
    navigate(`/candidate/${targetId}`);
  }

  function markSync(next, note = '') {
    setSyncState(next);
    if (note) setMessage(note);
  }

  function beginAction(name) {
    if (actionLockRef.current || actionBusy) return false;
    actionLockRef.current = name;
    setActionBusy(name);
    return true;
  }

  function endAction() {
    actionLockRef.current = '';
    setActionBusy('');
  }

  async function uploadCandidateAsset(fileKind, file) {
    if (!file || !candidateId) return;
    const busyKey = `${fileKind}:${file.name}`;
    setFileBusy(busyKey);
    setMessage('');
    try {
      const contentBase64 = await readFileAsBase64(file);
      const data = await api.post(`/api/candidates/${candidateId}/files`, {
        file_kind: fileKind,
        file_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        content_base64: contentBase64,
      }, { timeoutMs: 45000, retries: 1 });
      const nextItem = ensureCandidateDefaults({ ...(item || {}), ...(data.candidate_updates || {}) });
      setCandidateFiles(data.files || []);
      setItem(nextItem);
      candidateCacheRef.current[candidateId] = {
        item: nextItem,
        notes,
        timeline,
        process_options: processOptions,
        nav_items: candidateList,
        files: data.files || [],
      };
      setMessage(`${fileKind === 'resume' ? 'Resume' : 'Call recording'} uploaded successfully.`);
    } catch (err) {
      setMessage(err.message || 'File upload failed.');
    } finally {
      setFileBusy('');
    }
  }

  function downloadCandidateAsset(fileId) {
    if (!fileId) return;
    window.open(`/api/candidates/${candidateId}/files/${fileId}/download`, '_blank');
  }

  useEffect(() => {
    setItem((current) => ensureCandidateDefaults(current));
  }, [candidateId, item?.candidate_id]);

  useEffect(() => {
    prefetchCandidate(prevCandidate?.candidate_id);
    prefetchCandidate(nextCandidate?.candidate_id);
  }, [prevCandidate?.candidate_id, nextCandidate?.candidate_id]);

  function patch(next) {
    setInvalidFields((current) => current.filter((key) => !Object.prototype.hasOwnProperty.call(next, key)));
    setItem((current) => {
      const merged = ensureCandidateDefaults({ ...(current || {}), ...next });
      if (Object.prototype.hasOwnProperty.call(next, 'phone')) {
        merged.phone = normalizeIndianPhone(merged.phone || '');
      }
      if (Object.prototype.hasOwnProperty.call(next, 'relevant_experience') && !Object.prototype.hasOwnProperty.call(next, 'relevant_experience_range')) {
        merged.relevant_experience_range = expRange(String(parseMonthCount(merged.relevant_experience)));
      }
      if (String(merged.approval_status || '').toLowerCase() === 'pending') {
        merged.status = merged.status || 'In - Progress';
        merged.all_details_sent = merged.all_details_sent || 'Pending';
      }
      return merged;
    });
  }

  function focusInvalidField(direction = 1, currentTarget = null) {
    if (!formRef.current || !invalidFields.length) return false;
    const pending = invalidFields.map((key) => document.querySelector(`[data-field="${key}"] input, [data-field="${key}"] textarea, [data-field="${key}"] select, [data-field="${key}"] button`)).filter(Boolean);
    if (!pending.length) return false;
    const idx = currentTarget ? pending.indexOf(currentTarget) : -1;
    const next = pending[(idx + direction + pending.length) % pending.length] || pending[0];
    next.focus();
    return true;
  }

  function moveToNextField(event) {
    if (event.key === 'Tab' && invalidFields.length) {
      event.preventDefault();
      focusInvalidField(event.shiftKey ? -1 : 1, event.target);
      return;
    }
    if (event.key !== 'Enter' || event.target.tagName === 'TEXTAREA' || event.target.tagName === 'BUTTON') return;
    event.preventDefault();
    const inputs = [...formRef.current.querySelectorAll('input, select, textarea, button')]
      .filter((el) => !el.disabled && el.type !== 'hidden' && el.offsetParent !== null);
    const idx = inputs.indexOf(event.target);
    if (idx >= 0 && idx < inputs.length - 1) inputs[idx + 1].focus();
  }

  async function save(e) {
    e?.preventDefault?.();
    if (actionLockRef.current || actionBusy) return;
    const beforeItem = clonePlain(item);
    const beforeStatus = item?.status || '';
    const payload = sanitizeCandidatePayload({ ...item });
    if (approvalPending && !leadership) {
      payload.status = 'In - Progress';
      payload.all_details_sent = 'Pending';
    }
    setItem(payload);
    setInvalidFields([]);
    if (!beginAction('save')) return;
    markSync('saving', 'Saving draft...');
    try {
      const data = await api.put(`/api/candidates/${candidateId}`, payload, { timeoutMs: 90000 });
      const nextItem = ensureCandidateDefaults(data.item || payload);
      setItem(nextItem);
      candidateCacheRef.current[candidateId] = {
        item: nextItem,
        notes,
        timeline,
        process_options: processOptions,
        nav_items: candidateList,
        files: candidateFiles,
      };
      markSync('saved', 'Candidate saved successfully.');
      if (String(nextItem?.status || '').toLowerCase() === 'selected' && String(beforeStatus || '').toLowerCase() !== 'selected') {
        setCelebrate(true);
      }
    } catch (err) {
      setItem(beforeItem);
      markSync('error', err.message || 'Save failed. UI rolled back.');
    } finally {
      endAction();
    }
  }

  async function checkJdFit() {
    if (actionLockRef.current || actionBusy) return;
    const beforeItem = clonePlain(item);
    const payload = sanitizeCandidatePayload({ ...item });
    if (approvalPending && !leadership) {
      payload.status = 'In - Progress';
      payload.all_details_sent = 'Pending';
    }
    setInvalidFields([]);
    if (!beginAction('check')) return;
    markSync('saving', 'Checking JD fit...');
    try {
      const data = await api.put(`/api/candidates/${candidateId}?include_fit=1`, payload, { timeoutMs: 90000 });
      const nextItem = ensureCandidateDefaults(data.item || payload);
      setItem(nextItem);
      candidateCacheRef.current[candidateId] = {
        item: nextItem,
        notes,
        timeline,
        process_options: processOptions,
        nav_items: candidateList,
        files: candidateFiles,
      };
      const fit = nextItem?.jd_fit_summary || { score: 0, label: 'No JD Linked', suggestions: [] };
      const nextSuggestions = (fit.suggestions || []).slice(0, 6);
      if (nextSuggestions.length) {
        setJdSuggestionPopup({
          score: fit.score || 0,
          label: fit.label || 'Possible Fit',
          suggestions: nextSuggestions,
        });
        markSync('saved', 'Draft synced. Relevant JD popup ready.');
      } else {
        setJdSuggestionPopup(null);
        markSync('saved', 'Draft synced. No relevant JD matched yet.');
      }
    } catch (err) {
      setItem(beforeItem);
      markSync('error', err.message || 'Check JD failed. Draft not synced.');
    } finally {
      endAction();
    }
  }



  function buildJdOpenUrl(jdId) {
    const params = new URLSearchParams();
    if (jdId) params.set('focus', jdId);
    if (candidateId) params.set('candidateId', candidateId);
    params.set('standalone', '1');
    return `/jds?${params.toString()}`;
  }

  function openJdInNewTab(jdId) {
    const url = buildJdOpenUrl(jdId);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function openAllSuggestedJds() {
    const suggestions = (jdSuggestionPopup?.suggestions || []).filter((jd) => jd?.jd_id);
    suggestions.forEach((jd) => openJdInNewTab(jd.jd_id));
  }


  async function confirmSubmissionCommit() {
    const pause = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
    for (let attempt = 0; attempt < 7; attempt += 1) {
      try {
        const [candidateData, submissionData] = await Promise.all([
          api.get(`/api/candidates/${candidateId}?prefetch=1`, { cacheTtlMs: 0, timeoutMs: 12000, retries: 1 }),
          api.get('/api/submissions?show_old=1&days=30', { cacheTtlMs: 0, timeoutMs: 12000, retries: 1 }),
        ]);
        const latestCandidate = ensureCandidateDefaults(candidateData?.item || item || {});
        const matchedSubmission = (submissionData?.items || []).find((row) => String(row.candidate_id || '') === String(candidateId));
        if (String(latestCandidate?.approval_status || '').toLowerCase() === 'pending' && matchedSubmission) {
          return { ok: true, item: latestCandidate, submission: matchedSubmission };
        }
      } catch {}
      await pause(900 + (attempt * 250));
    }
    return { ok: false };
  }

  async function submitForApproval() {
    if (actionLockRef.current || actionBusy) return;
    const validation = buildSubmitValidation(item);
    const assetMissingKeys = [];
    const assetMessages = [];
    if (!latestResumeFile && !String(item?.resume_filename || '').trim()) {
      assetMissingKeys.push('resume_upload');
      assetMessages.push('Resume required');
    }
    if (!latestRecordingFile && !String(item?.recording_filename || '').trim()) {
      assetMissingKeys.push('recording_upload');
      assetMessages.push('Call recording required');
    }
    if (!validation.ok || assetMissingKeys.length) {
      const mergedKeys = [...new Set([...(validation.missingKeys || []), ...assetMissingKeys])];
      const mergedMessage = [validation.message, assetMessages.join(' • ')].filter(Boolean).join(' • ');
      setInvalidFields(mergedKeys);
      setMessage(mergedMessage || 'Required details are missing.');
      const firstInvalid = mergedKeys[0];
      if (firstInvalid) window.setTimeout(() => document.querySelector(`[data-field="${firstInvalid}"] input, [data-field="${firstInvalid}"] textarea, [data-field="${firstInvalid}"] select, [data-field="${firstInvalid}"] button, [data-field="${firstInvalid}"] label`)?.focus(), 0);
      return;
    }
    const beforeItem = clonePlain(item);
    const optimisticItem = ensureCandidateDefaults({
      ...sanitizeCandidatePayload(item),
      status: 'In - Progress',
      all_details_sent: 'Pending',
      approval_status: 'Pending',
      submission_date: item?.submission_date || nowDateTimeLocal(),
    });
    setItem(optimisticItem);
    setInvalidFields([]);
    setStatusFlash('pending');
    if (!beginAction('submit')) return;
    markSync('saving', 'Submitting profile...');
    try {
      let data;
      try {
        data = await api.post(`/api/candidates/${candidateId}/submit`, sanitizeCandidatePayload(optimisticItem), { timeoutMs: 45000 });
      } catch (firstErr) {
        const transient = String(firstErr?.message || '').toLowerCase().includes('timed out') || [502, 503, 504].includes(Number(firstErr?.status || 0));
        if (!transient) throw firstErr;
        data = await api.post(`/api/candidates/${candidateId}/submit`, sanitizeCandidatePayload(optimisticItem), { timeoutMs: 45000 });
      }
      const savedItem = ensureCandidateDefaults(data?.item || optimisticItem);
      setItem(savedItem);
      markSync('saved', data?.already_pending
        ? 'Profile is already pending for approval. It stays on this page, and TL / Manager can act from the Submissions section.'
        : 'Profile sent for approval. It stays on this page, and TL / Manager can approve or reject it from the Submissions section.');
      window.setTimeout(() => { load().catch(() => {}); }, 120);
    } catch (err) {
      const confirmed = await confirmSubmissionCommit();
      if (confirmed.ok) {
        setItem(ensureCandidateDefaults(confirmed.item || optimisticItem));
        setStatusFlash('pending');
        markSync('saved', 'Submission was created after retry confirmation. The profile stays on this page, and TL / Manager can act from the Submissions section.');
        window.setTimeout(() => { load().catch(() => {}); }, 120);
      } else {
        setItem(beforeItem);
        setStatusFlash('');
        markSync('error', err.message || 'Submit failed. UI rolled back.');
      }
    } finally {
      endAction();
    }
  }

  async function requestInterviewDateRemoval() {
    if (!removeInterviewReason.trim()) {
      setMessage('Interview date remove reason required.');
      return;
    }
    await api.post(`/api/candidates/${candidateId}/request-remove-interview-date`, { reason: removeInterviewReason.trim() });
    setRemoveInterviewOpen(false);
    setRemoveInterviewReason('');
    setMessage('Interview date removal request sent for TL / Manager approval.');
    await load();
  }

  async function removeInterviewDateDirectly() {
    if (!item?.interview_reschedule_date) return;
    try {
      await api.post(`/api/candidates/${candidateId}/remove-interview-date`, {});
      setRemoveInterviewOpen(false);
      setRemoveInterviewReason('');
      setMessage('Interview date removed successfully.');
      await load();
    } catch (err) {
      setMessage(err.message || 'Interview date remove failed.');
    }
  }

  async function addNote(e) {
    e.preventDefault();
    if (!noteBody.trim()) return;
    const beforeNotes = clonePlain(notes) || [];
    const beforeTimeline = clonePlain(timeline) || [];
    const body = noteBody.trim();
    const username = user?.username || user?.full_name || user?.name || 'You';
    const optimisticNote = makeOptimisticNote(body, username);
    const optimisticTimeline = makeOptimisticTimeline('note_added', username, { body, candidate_id: candidateId });
    setNotes((current) => [optimisticNote, ...(current || [])]);
    setTimeline((current) => [optimisticTimeline, ...(current || [])]);
    setNoteBody('');
    markSync('saving', 'Adding note...');
    setNoteSaving(true);
    try {
      await api.post(`/api/candidates/${candidateId}/notes`, { body, note_type: 'public' });
      markSync('saved', 'Note added instantly.');
    } catch (err) {
      setNotes(beforeNotes);
      setTimeline(beforeTimeline);
      setNoteBody(body);
      markSync('error', err.message || 'Note save failed. UI rolled back.');
    } finally {
      setNoteSaving(false);
    }
  }

  function useNoteTemplate(value) {
    if (!value) return;
    if (value === '__add_new__') {
      const fresh = window.prompt('Type new reusable note');
      if (fresh) {
        const next = addNoteTemplate(fresh);
        setNoteTemplates(next);
        setNoteBody(fresh);
      }
      return;
    }
    setNoteBody(value);
  }

  function useWaTemplate(value) {
    if (!value) {
      openWhatsApp('');
      return;
    }
    if (value === '__add_new__') {
      const fresh = window.prompt('Type new WhatsApp template');
      if (fresh) setWaTemplates(addWhatsAppTemplate(fresh));
      return;
    }
    openWhatsApp(value);
  }

  async function onDial() {
    if (!item?.phone) return;
    dialCandidateWithLog(candidateId, item.phone || '');
  }

  function openWhatsApp(text = '') {
    openWhatsAppWithLog(candidateId, item?.phone || '', text);
  }

  function patchExperienceField(fieldKey, part, value) {
    const current = splitExperienceValue(item?.[fieldKey] || '');
    const nextParts = { ...current, [part]: String(value || '').replace(/[^\d]/g, '').slice(0, 2) };
    const totalMonths = joinExperienceValue(nextParts.years, nextParts.months);
    const nextPayload = { [fieldKey]: totalMonths };
    if (fieldKey === 'relevant_experience') nextPayload.relevant_experience_range = expRange(totalMonths);
    patch(nextPayload);
  }


  function copyTotalExperienceToRelevant() {
    const total = String(item?.total_experience || '').trim();
    patch({ relevant_experience: total, relevant_experience_range: expRange(total) });
  }

  function matchRelevantExperienceRange() {
    patch({ relevant_experience_range: expRange(item?.relevant_experience || '') });
  }

  function matchSalaryRange() {
    patch({ relevant_in_hand_range: salaryRange(item?.in_hand_salary || '') });
  }

  function addPreferredLocationOption() {
    if (editingLocked) return;
    const fresh = String(window.prompt('Add new preferred location') || '').trim();
    if (!fresh) return;
    const nextOptions = [...new Set([...preferredLocations, fresh])];
    setPreferredLocations(nextOptions);
    persistPreferredLocations(nextOptions);
    patch({ preferred_location: fresh });
  }

  if (loading && !item) {
    return <Layout title={`Candidate • ${candidateId}`} subtitle="Loading profile details."><div className="panel top-gap"><div className="helper-text">Loading candidate profile...</div></div></Layout>;
  }

  if (error || !item) {
    return (
      <Layout title={`Candidate • ${candidateId}`} subtitle="This profile could not be opened right now.">
        <div className="panel top-gap">
          <div className="panel-title">Profile not available</div>
          <div className="helper-text top-gap-small">{error || 'Candidate not found.'}</div>
          <div className="row-actions top-gap">
            <button className="ghost-btn bounceable" type="button" onClick={() => navigate('/candidates')}>Back to Candidates</button>
            <button className="add-profile-btn bounceable" type="button" onClick={load}>Retry</button>
          </div>
        </div>
      </Layout>
    );
  }

  const approvalState = String(item.approval_status || 'Draft').toLowerCase();
  const stateLabel = approvalState === 'approved' ? 'Approved' : approvalState === 'rejected' ? 'Rejected' : approvalState === 'pending' ? 'Pending Approval' : 'Draft';
  const totalExperienceParts = splitExperienceValue(item?.total_experience || '');
  const relevantExperienceParts = splitExperienceValue(item?.relevant_experience || '');

  const candidateFilesPanel = (
    <div className="panel top-gap-small candidate-files-panel">
      <div className="panel-title">Required Files</div>
      <div className="helper-text top-gap-small">Resume and call recording are required before the profile can be sent for approval.</div>
      <div className="candidate-file-stack top-gap-small">
        <div className={`candidate-file-row ${invalidFields.includes('resume_upload') ? 'invalid-field' : ''}`} data-field="resume_upload">
          <div className="candidate-file-copy">
            <strong>Resume</strong>
            <div className="helper-text">{latestResumeFile?.original_name || item.resume_filename || 'No resume uploaded yet.'}</div>
          </div>
          <div className="candidate-file-actions">
            <input id="candidate-resume-upload" type="file" hidden disabled={editingLocked || !!fileBusy} onChange={async (e) => { const file = e.target.files?.[0]; if (file) await uploadCandidateAsset('resume', file); e.target.value = ''; }} />
            <label htmlFor="candidate-resume-upload" className={`ghost-btn bounceable file-action-btn ${editingLocked || !!fileBusy ? 'is-disabled' : ''}`}>Upload</label>
            <button type="button" className="add-profile-btn bounceable file-action-btn" disabled={!latestResumeFile} onClick={() => latestResumeFile && downloadCandidateAsset(latestResumeFile.file_id)}>View</button>
          </div>
        </div>
        <div className="candidate-file-chip-row">{candidateFiles.filter((file) => file.file_kind === 'resume').slice(0, 3).map((file) => <button key={file.file_id} type="button" className="candidate-file-chip bounceable" onClick={() => downloadCandidateAsset(file.file_id)}><span>{file.original_name}</span><small>{formatFileSize(file.size_bytes)}</small></button>)}</div>

        <div className={`candidate-file-row top-gap-small ${invalidFields.includes('recording_upload') ? 'invalid-field' : ''}`} data-field="recording_upload">
          <div className="candidate-file-copy">
            <strong>Call Recording</strong>
            <div className="helper-text">{latestRecordingFile?.original_name || item.recording_filename || 'No call recording uploaded yet.'}</div>
          </div>
          <div className="candidate-file-actions">
            <input id="candidate-recording-upload" type="file" hidden disabled={editingLocked || !!fileBusy} onChange={async (e) => { const file = e.target.files?.[0]; if (file) await uploadCandidateAsset('call_recording', file); e.target.value = ''; }} />
            <label htmlFor="candidate-recording-upload" className={`ghost-btn bounceable file-action-btn ${editingLocked || !!fileBusy ? 'is-disabled' : ''}`}>Upload</label>
            <button type="button" className="add-profile-btn bounceable file-action-btn" disabled={!latestRecordingFile} onClick={() => latestRecordingFile && downloadCandidateAsset(latestRecordingFile.file_id)}>View</button>
          </div>
        </div>
        <div className="candidate-file-chip-row">{candidateFiles.filter((file) => file.file_kind === 'call_recording').slice(0, 3).map((file) => <button key={file.file_id} type="button" className="candidate-file-chip bounceable" onClick={() => downloadCandidateAsset(file.file_id)}><span>{file.original_name}</span><small>{formatFileSize(file.size_bytes)}</small></button>)}</div>
      </div>
    </div>
  );

  return (
    <Layout title={`Candidate • ${item.full_name || item.candidate_id}`} subtitle="Candidate profile, contact details, and follow-up controls.">
      <CelebrationBurst active={celebrate} />
      <div className={`panel top-gap candidate-detail-full-panel ${statusFlash ? `approval-wash approval-wash-${statusFlash}` : ''}`}>
        <div className="panel-heading-row">
          <div>
            <div className="panel-title">Candidate Detail Form</div>
            <div className="helper-text top-gap-small">Review the profile, update fields, and send it for approval when the details are ready.</div>
          </div>
          <div className="detail-header-actions detail-header-actions-modern">
            <MiniIconButton title="Previous Profile" className="modern-eye-btn" onClick={() => prevCandidate && openCandidate(prevCandidate.candidate_id)} disabled={!prevCandidate}><PrevIcon /></MiniIconButton>
            <MiniIconButton title="Dial Call" className="modern-call-btn" onClick={onDial}><PhoneIcon /></MiniIconButton>
            <div className="wa-template-shell">
              <MiniIconButton title="Open WhatsApp" className="modern-wa-btn" onClick={() => openWhatsApp('')}><WhatsAppIcon /></MiniIconButton>
              <select className="wa-template-select genz-wa-select" defaultValue="" onChange={(e) => { useWaTemplate(e.target.value); e.target.value = ''; }}>
                <option value="">WA template</option>
                {waTemplates.map((tpl) => <option key={tpl} value={tpl}>{tpl.slice(0, 70)}</option>)}
                <option value="__add_new__">Add New...</option>
              </select>
            </div>
            <MiniIconButton title="Next Profile" className="modern-eye-btn" onClick={() => nextCandidate && openCandidate(nextCandidate.candidate_id)} disabled={!nextCandidate}><NextIcon /></MiniIconButton>
          </div>
        </div>


        <div className={`approval-action-banner state-${approvalState || 'draft'}`}>
          <div className="approval-banner-left">
            <span className={`profile-state-chip state-${approvalState || 'draft'}`}>{stateLabel}</span>
            {syncState !== 'idle' ? (
              <span className={`mini-chip sync-chip ${syncState}`}>{syncState === 'saving' ? 'Syncing...' : syncState === 'saved' ? 'Synced' : 'Sync failed'}</span>
            ) : null}
            <span className="helper-text">Status: {item.status || '-'} • Details Sent: {item.all_details_sent || 'Pending'}</span>
          </div>
          {approvalState === 'pending' ? (
            <div className="approval-banner-actions approval-banner-noteonly">
              <span className="helper-text">Approve or reject this profile from the Submissions section only.</span>
            </div>
          ) : null}
        </div>

        <form className="stack-form" ref={formRef} onKeyDown={moveToNextField}>
          <div className="candidate-sequence-shell">
            <div className="candidate-meta-row">
              <div className="field compact-id-field candidate-meta-card"><label>Candidate ID</label><input className="compact-id-input" value={item.candidate_id || ''} readOnly /></div>
              <div className="field compact-id-field candidate-meta-card" data-field="recruiter_code"><label>Recruiter Code</label><input className="compact-id-input" value={item.recruiter_code || ''} readOnly /></div>
              <div className="candidate-meta-card candidate-meta-support-card">
                <div className="candidate-mini-support-grid candidate-mini-support-grid-inline">
                  <div data-field="call_connected"><ChoiceField compact label="Call Connected" value={item.call_connected || 'No'} options={CALL_CONNECTED_OPTIONS} onChange={(value) => patch({ call_connected: value })} disabled={editingLocked} /></div>
                  <div data-field="looking_for_job"><ChoiceField compact label="Looking for Job" value={item.looking_for_job || 'Yes'} options={LOOKING_FOR_JOB_OPTIONS} onChange={(value) => patch({ looking_for_job: value })} disabled={editingLocked} invalid={invalidFields.includes('looking_for_job')} /></div>
                </div>
              </div>
            </div>

            {candidateFilesPanel}

            <div className="candidate-form-grid candidate-sequence-grid candidate-basic-row">
              <div className={`field ${invalidFields.includes('full_name') ? 'invalid-field' : ''}`.trim()} data-field="full_name"><label>Name</label><input className={invalidFields.includes('full_name') ? 'invalid-input' : ''} value={item.full_name || ''} onChange={(e) => patch({ full_name: e.target.value })} disabled={editingLocked} /></div>
              <div className={`field ${invalidFields.includes('phone') ? 'invalid-field' : ''}`.trim()} data-field="phone"><label>Number</label>{phoneIsMaskedForRecruiter ? <><input className={invalidFields.includes('phone') ? 'invalid-input' : ''} value={visiblePhone(user, item.phone || '', '')} readOnly /><div className="helper-text top-gap-small">Recruiter view keeps digits 5, 6, 7 masked. Use Call or WhatsApp to work with the full number.</div></> : <input className={invalidFields.includes('phone') ? 'invalid-input' : ''} value={item.phone || ''} onChange={(e) => patch({ phone: e.target.value })} disabled={editingLocked} />}</div>
              <div className={`field ${invalidFields.includes('location') ? 'invalid-field' : ''}`.trim()} data-field="location"><label>Location</label><input className={invalidFields.includes('location') ? 'invalid-input' : ''} value={item.location || ''} onChange={(e) => patch({ location: e.target.value })} disabled={editingLocked} /></div>
              <div className={`field ${invalidFields.includes('qualification') ? 'invalid-field' : ''}`.trim()} data-field="qualification"><label>Qualification</label><input className={invalidFields.includes('qualification') ? 'invalid-input' : ''} value={item.qualification || ''} onChange={(e) => patch({ qualification: e.target.value })} disabled={editingLocked} /></div>
            </div>

            <div className="candidate-form-grid candidate-sequence-grid candidate-two-col-row top-gap-small">
              <div className={`field ${invalidFields.includes('preferred_location') ? 'invalid-field' : ''}`.trim()} data-field="preferred_location">
                <div className="field-label-line"><label>Preferred Location</label><button type="button" className="mini-inline-action bounceable" disabled={editingLocked} onClick={addPreferredLocationOption}>+ Add New</button></div>
                <div className="choice-chip-row compact-row">
                  {preferredLocations.map((option) => {
                    const checked = splitMulti(item.preferred_location || 'Noida').includes(option);
                    return <button key={option} type="button" disabled={editingLocked} className={`choice-chip bounceable ${checked ? 'active' : ''}`} onClick={() => patch({ preferred_location: toggleMultiValue(item.preferred_location || 'Noida', option, true) })}>{option}</button>;
                  })}
                </div>
                <div className="helper-text top-gap-small">Selected: {item.preferred_location || 'Noida'}</div>
              </div>
              <div data-field="qualification_level"><ChoiceField label="Degree / Qualification" value={item.qualification_level || 'Graduate'} options={DEGREE_OPTIONS} onChange={(value) => patch({ qualification_level: value })} disabled={editingLocked} invalid={invalidFields.includes('qualification_level')} /></div>
            </div>

            <div className="candidate-form-grid candidate-sequence-grid candidate-three-col-row top-gap-small">
              <div className={`field exp-split-field ${invalidFields.includes('total_experience') ? 'invalid-field' : ''}`.trim()} data-field="total_experience"><label>Total Experience</label><div className="split-exp-grid"><input className={invalidFields.includes('total_experience') ? 'invalid-input' : ''} value={totalExperienceParts.years} onChange={(e) => patchExperienceField('total_experience', 'years', e.target.value)} disabled={editingLocked} placeholder="Years" /><input className={invalidFields.includes('total_experience') ? 'invalid-input' : ''} value={totalExperienceParts.months} onChange={(e) => patchExperienceField('total_experience', 'months', e.target.value)} disabled={editingLocked} placeholder="Months" /></div><div className="helper-text top-gap-small">Saved as: {formatExperiencePreview(item.total_experience || '0')}</div></div>
              <div className={`field exp-split-field ${invalidFields.includes('relevant_experience') ? 'invalid-field' : ''}`.trim()} data-field="relevant_experience"><div className="field-label-line"><label>Relevant Experience</label><button type="button" className="mini-inline-action bounceable" disabled={editingLocked} onClick={copyTotalExperienceToRelevant}>Same</button></div><div className="split-exp-grid"><input className={invalidFields.includes('relevant_experience') ? 'invalid-input' : ''} value={relevantExperienceParts.years} onChange={(e) => patchExperienceField('relevant_experience', 'years', e.target.value)} disabled={editingLocked} placeholder="Years" /><input className={invalidFields.includes('relevant_experience') ? 'invalid-input' : ''} value={relevantExperienceParts.months} onChange={(e) => patchExperienceField('relevant_experience', 'months', e.target.value)} disabled={editingLocked} placeholder="Months" /></div><div className="helper-text top-gap-small">Saved as: {formatExperiencePreview(item.relevant_experience || '0')}</div></div>
              <div data-field="relevant_experience_range"><div className="field field-with-header-action"><div className="field-label-line"><label>Relevant Experience Range</label><button type="button" className="mini-inline-action bounceable" disabled={editingLocked} onClick={matchRelevantExperienceRange}>Match</button></div><SelectField label="" value={item.relevant_experience_range || ''} options={EXPERIENCE_RANGE_OPTIONS} onChange={(value) => patch({ relevant_experience_range: value })} disabled={editingLocked} invalid={invalidFields.includes('relevant_experience_range')} /></div></div>
            </div>

            <div className="candidate-form-grid candidate-sequence-grid candidate-three-col-row top-gap-small">
              <div className={`field ${invalidFields.includes('ctc_monthly') ? 'invalid-field' : ''}`.trim()} data-field="ctc_monthly"><label>CTC Monthly</label><input className={invalidFields.includes('ctc_monthly') ? 'invalid-input' : ''} value={item.ctc_monthly || ''} onChange={(e) => patch({ ctc_monthly: e.target.value })} disabled={editingLocked} /></div>
              <div className={`field ${invalidFields.includes('in_hand_salary') ? 'invalid-field' : ''}`.trim()} data-field="in_hand_salary"><label>In-hand Monthly Salary</label><input className={invalidFields.includes('in_hand_salary') ? 'invalid-input' : ''} value={item.in_hand_salary || ''} onChange={(e) => patch({ in_hand_salary: e.target.value })} disabled={editingLocked} /></div>
              <div data-field="relevant_in_hand_range"><div className="field field-with-header-action"><div className="field-label-line"><label>In-hand Salary Range</label><button type="button" className="mini-inline-action bounceable" disabled={editingLocked} onClick={matchSalaryRange}>Match</button></div><SelectField label="" value={item.relevant_in_hand_range || ''} options={SALARY_RANGE_OPTIONS} onChange={(value) => patch({ relevant_in_hand_range: value })} disabled={editingLocked} invalid={invalidFields.includes('relevant_in_hand_range')} /></div></div>
            </div>

            <div className="candidate-form-grid candidate-sequence-grid candidate-three-col-row top-gap-small">
              <div data-field="career_gap"><ChoiceField label="Career Gap" value={item.career_gap || 'Fresher'} options={CAREER_GAP_OPTIONS} onChange={(value) => patch({ career_gap: value })} disabled={editingLocked} invalid={invalidFields.includes('career_gap')} /></div>
              <div data-field="documents_availability"><ChoiceField label="All Documents Availability" value={normalizeDocumentsAvailability(item.documents_availability || 'Yes')} options={DOCUMENTS_OPTIONS} onChange={(value) => patch({ documents_availability: value })} disabled={editingLocked} invalid={invalidFields.includes('documents_availability')} showAll /></div>
              <div data-field="communication_skill"><ChoiceField label="Communication Skill" value={item.communication_skill || 'Average'} options={COMMUNICATION_SKILL_OPTIONS} onChange={(value) => patch({ communication_skill: value })} disabled={editingLocked} invalid={invalidFields.includes('communication_skill')} /></div>
            </div>

            <div className="candidate-form-grid candidate-sequence-grid candidate-three-col-row top-gap-small">
              <div className="field" data-field="follow_up_at"><label>Follow-up</label><input type="datetime-local" value={toDateTimeLocalInput(item.follow_up_at || '')} onChange={(e) => patch({ follow_up_at: e.target.value, follow_up_status: e.target.value ? 'Open' : '' })} disabled={editingLocked} /><div className="choice-chip-row compact-row top-gap-small followup-preset-row">{FOLLOW_UP_PRESETS.map((preset) => <button key={preset.label} type="button" className="choice-chip bounceable" disabled={editingLocked} onClick={() => applyFollowUpPreset(preset)}>{preset.label}</button>)}<button type="button" className="choice-chip bounceable" disabled={editingLocked} onClick={() => patch({ follow_up_at: '', follow_up_status: '', follow_up_note: '' })}>Clear</button></div></div>
              <div className={`field ${invalidFields.includes('interview_reschedule_date') ? 'invalid-field' : ''}`.trim()} data-field="interview_reschedule_date"><label>Interview Date</label><div className="weekday-date-wrap"><input type="date" value={selectedDate} onChange={(e) => patch({ interview_reschedule_date: e.target.value })} disabled={editingLocked} /></div><div className="weekday-shortcuts">{WEEKDAY_CHOICES.map((day) => <button key={day} type="button" className="weekday-chip bounceable" disabled={editingLocked} onClick={() => patch({ interview_reschedule_date: nextDateForWeekday(day) })}>{day.slice(0, 3)}</button>)}</div><div className="row-actions top-gap-small"><button className="ghost-btn bounceable" type="button" onClick={() => (canDirectRemoveInterview ? removeInterviewDateDirectly() : setRemoveInterviewOpen(true))} disabled={editingLocked || !item?.interview_reschedule_date}>{canDirectRemoveInterview ? 'Remove' : 'Request Remove'}</button>{String(item?.interview_remove_status || '').toLowerCase() === 'pending' && <span className="helper-text">Removal request pending.</span>}</div></div>
              <div data-field="virtual_onsite"><SelectField label="Interview Mode" value={item.virtual_onsite || 'Walkin'} options={INTERVIEW_MODE_OPTIONS} onChange={(value) => patch({ virtual_onsite: value })} disabled={editingLocked} invalid={invalidFields.includes('virtual_onsite')} /></div>
            </div>

            <div className="candidate-form-grid candidate-sequence-grid candidate-three-col-row top-gap-small">
              <div data-field="status"><ChoiceField label="Status" value={approvalPending && !leadership ? 'In - Progress' : (item.status || displayStatusOptions[0])} options={displayStatusOptions} onChange={(value) => patch({ status: value })} disabled={editingLocked && !leadership} invalid={invalidFields.includes('status')} showAll /></div>
              <div data-field="all_details_sent"><ChoiceField label="All Details Sent" value={approvalPending && !leadership ? 'Pending' : (item.all_details_sent || 'Pending')} options={DETAILS_SENT_OPTIONS} onChange={(value) => patch({ all_details_sent: value })} disabled={editingLocked && !leadership} invalid={invalidFields.includes('all_details_sent')} showAll /></div>
              <div className={`field ${invalidFields.includes('submission_date') ? 'invalid-field' : ''}`.trim()} data-field="submission_date"><label>Submission Date</label><input className={invalidFields.includes('submission_date') ? 'invalid-input' : ''} type="datetime-local" value={toDateTimeLocalInput(item.submission_date || nowDateTimeLocal())} onChange={(e) => patch({ submission_date: e.target.value })} disabled={editingLocked} /><div className="row-actions top-gap-small"><button className="ghost-btn bounceable today-inline-btn" type="button" disabled={editingLocked} onClick={() => patch({ submission_date: nowDateTimeLocal() })}>Now</button><span className="helper-text">{formatTwelveHour(item.submission_date || nowDateTimeLocal())}</span></div></div>
            </div>

            <div className="field top-gap-small" data-field="process"><MultiChoiceField label="Process" value={item.process || ''} options={processOptions} onChange={(value) => patch({ process: value })} disabled={editingLocked} invalid={invalidFields.includes('process')} /></div>

            <div className="field top-gap-small" data-field="master_notes">
              <div className="field-label-line"><label>Notes</label><select className="inline-input note-template-select compact-inline-select" defaultValue="" onChange={(e) => { const value = e.target.value; if (value && value !== '__add_new__') patch({ notes: item.notes ? `${item.notes}\n${value}` : value }); e.target.value = ''; }}><option value="">Preset notes</option>{noteTemplates.map((tpl) => <option key={tpl} value={tpl}>{tpl.slice(0, 80)}</option>)}</select></div>
              <textarea rows="4" value={item.notes || ''} onChange={(e) => patch({ notes: e.target.value })} disabled={editingLocked}></textarea>
            </div>
          </div>

          <div className="row-actions top-gap">
            <button className="ghost-btn bounceable candidate-action-btn candidate-reset-btn" type="button" onClick={resetFilledDetails} disabled={Boolean(actionBusy)}>Reset</button>
            <button className="add-profile-btn bounceable candidate-action-btn candidate-save-btn" type="button" onClick={save} disabled={Boolean(actionBusy)}>{actionBusy === 'save' ? 'Saving...' : 'Save'}</button>
            <button className="add-profile-btn bounceable candidate-action-btn candidate-check-jd-btn" type="button" onClick={checkJdFit} disabled={Boolean(actionBusy)}>{actionBusy === 'check' ? 'Working...' : 'Check JD'}</button>
            <button className="add-profile-btn bounceable candidate-action-btn candidate-submit-btn" type="button" onClick={submitForApproval} disabled={(approvalPending && !leadership) || Boolean(actionBusy)}>{actionBusy === 'submit' ? 'Submitting...' : 'Submit'}</button>
            {!!message && <span className={`helper-text sync-message ${syncState === 'error' ? 'is-error' : syncState === 'saved' ? 'is-success' : ''}`}>{message}</span>}
          </div>
          <div className="helper-text top-gap-small">Save keeps the draft. Check JD auto-saves and opens the JD in a separate tab without throwing you off this page.</div>

          <div className="panel top-gap-small candidate-timeline-panel">
            <div className="panel-heading-row">
              <div>
                <div className="panel-title">Timeline</div>
                <div className="helper-text top-gap-small">Every profile open, save, note, upload, submission, approval, and follow-up action shows here.</div>
              </div>
              <div className="timeline-tab-row">
                <button className={`choice-chip bounceable ${timelineTab === 'today' ? 'active' : ''}`} type="button" onClick={() => { setTimelineTab('today'); setShowTimeline(false); }}>Today</button>
                <button className={`choice-chip bounceable ${timelineTab === 'past3' ? 'active' : ''}`} type="button" onClick={() => { setTimelineTab('past3'); setShowTimeline(false); }}>Past 3 Days</button>
                <button className={`choice-chip bounceable ${timelineTab === 'all' ? 'active' : ''}`} type="button" onClick={() => { setTimelineTab('all'); setShowTimeline(false); }}>All History</button>
                {filteredTimeline.length > 12 ? <button className="ghost-btn bounceable" type="button" onClick={() => setShowTimeline((current) => !current)}>{showTimeline ? 'Show Less' : `Show More (${filteredTimeline.length})`}</button> : null}
              </div>
            </div>
            <div className="timeline-list top-gap-small">
              {visibleTimeline.length ? visibleTimeline.map((row) => (
                <div key={row.activity_id || `${row.action_type}-${row.created_at}`} className={`activity-item timeline-item ${isTodayAction(row.created_at) ? 'today-action' : ''}`.trim()}>
                  <div className="activity-left">
                    <div className="activity-name">{timelineText(row)}</div>
                    <div className="activity-sub">{formatTimelineTime(row.created_at)}</div>
                  </div>
                  <span className="badge">{timelineBadge(row)}</span>
                </div>
              )) : <div className="helper-text">No timeline items in this section yet. Open, save, add note, call, or submit the profile and the history will appear here.</div>}
            </div>
          </div>
        </form>

      {removeInterviewOpen && !canDirectRemoveInterview && (
        <div className="crm-modal-backdrop" onClick={() => setRemoveInterviewOpen(false)}>
          <div className="crm-premium-modal task-premium-modal task-modal-no-overlap interview-remove-modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-title">Request Interview Date Removal</div>
            <div className="helper-text top-gap-small">Recruiter removal needs approval. Add the reason so TL / Manager can review it.</div>
            <div className="field top-gap-small">
              <label>Reason</label>
              <textarea rows="4" value={removeInterviewReason} onChange={(e) => setRemoveInterviewReason(e.target.value)} placeholder="Why should the interview date be removed?" />
            </div>
            <div className="row-actions top-gap">
              <button className="ghost-btn bounceable" type="button" onClick={() => setRemoveInterviewOpen(false)}>Cancel</button>
              <button className="add-profile-btn bounceable" type="button" disabled={!removeInterviewReason.trim()} onClick={requestInterviewDateRemoval}>Request Approval</button>
            </div>
          </div>
        </div>
      )}
    </div>
    </Layout>
  );
}
