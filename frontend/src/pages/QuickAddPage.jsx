import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { candidatePayloadFromPreview, downloadCsv, extractCandidateFields, readResumeFileText } from '../lib/importExtractors';

const sections = [
  { key: 'candidate', label: 'Add Candidate' },
  { key: 'task', label: 'Add Task' },
  { key: 'note', label: 'Add Note' },
  { key: 'interview', label: 'Add Interview' },
  { key: 'jd', label: 'Add JD' },
];

const CALL_CONNECTED_OPTIONS = ['No', 'Yes', 'Partially'];
const LOOKING_FOR_JOB_OPTIONS = ['Yes', 'No'];
const DEGREE_OPTIONS = ['NON - Graduate', 'Graduate'];
const CAREER_GAP_OPTIONS = ['Fresher', 'Currently Working', '1 - 3 Month', '4 - 6 Month', '7 - 12 Month', '1 - 1.5 Year', '1.6 - 2 Year'];
const COMMUNICATION_SKILL_OPTIONS = ['Excellent', 'Good', 'Normal', 'Average', 'Below Average'];
const EXPERIENCE_RANGE_OPTIONS = ['Fresher', '1 - 3 Month', '4 - 6 Month', '7 - 12 Month', '1 - 1.5 Year', '1.6 - 2 Year', '2 - 2.5 Year', '2.6 - 3 Year', '3 - 3.5 Year', '3.6 - 4 Year', '4 - 4.5 Year', '4.6 - 5 Year', '5+ Year'];
const SALARY_RANGE_OPTIONS = ['0', '₹1K - ₹15K', '₹16K - ₹20K', '₹21K - ₹25K', '₹26K - ₹30K', '₹31K - ₹35K'];
const DOCUMENTS_OPTIONS = ['Yes', 'No', 'Partially'];
const INTERVIEW_MODE_OPTIONS = ['Virtual', 'Walkin'];
const PROFILE_PRIORITY_OPTIONS = ['High', 'Medium', 'Low'];
const DETAILS_SENT_OPTIONS = ['Pending', 'Completed'];
const CANDIDATE_STATUS_OPTIONS = ['In - Progress', 'Follow Up', 'All set for Interview', 'Appeared in Interview', 'Selected', 'Rejected', 'Not Intrested', 'Not Responding', 'Rejected once, needs new Interview', 'Joined', 'Active', 'Needs Update'];

function makeCandidateInitial() {
  return {
    call_connected: 'No',
    looking_for_job: 'Yes',
    full_name: '',
    phone: '',
    location: '',
    qualification: '',
    preferred_location: 'Noida',
    qualification_level: 'Graduate',
    total_experience: '0',
    relevant_experience: '0',
    relevant_experience_range: 'Fresher',
    ctc_monthly: '',
    in_hand_salary: '',
    relevant_in_hand_range: '0',
    career_gap: 'Fresher',
    documents_availability: 'Yes',
    communication_skill: 'Average',
    process: '',
    interview_reschedule_date: '',
    virtual_onsite: 'Walkin',
    follow_up_at: '',
    status: 'In - Progress',
    profile_priority: 'Medium',
    all_details_sent: 'Pending',
    submission_date: nowDateTimeLocal(),
    notes: '',
  };
}
const taskInitial = {
  title: '',
  description: '',
  assigned_to_user_id: '',
  assigned_to_user_ids: [],
  priority: 'Normal',
  due_date: '',
  recurring_type: '',
  recurring_interval_minutes: '',
};
const noteInitial = { candidate_id: '', body: '', note_type: 'public' };
const interviewInitial = { candidate_id: '', jd_id: '', stage: 'Screening', scheduled_at: '' };
const jdInitial = { job_title: '', company: '', location: '', experience: '', salary: '' };

const QUICK_TASK_PRESETS = [
  { label: 'Today', action: 'today' },
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '90m', minutes: 90 },
  { label: '2h', minutes: 120 },
  { label: '2.5h', minutes: 150 },
  { label: '3h', minutes: 180 },
  { label: '5h', minutes: 300 },
  { label: '6h', minutes: 360 },
  { label: '9h', minutes: 540 },
];

const REPEAT_OPTIONS = [
  { value: '', label: 'One Time' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'custom', label: 'Custom' },
];

function MissingList({ items = [] }) {
  if (!items.length) return <span className="helper-text">Ready to import</span>;
  return <div className="toolbar-actions compact-pills">{items.map((item) => <span key={item} className="top-pill">{item} missing</span>)}</div>;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toLocalDateTimeInput(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '';
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const min = pad2(date.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function parseTaskDueDate(value) {
  if (!String(value || '').trim()) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function nowDateTimeLocal() {
  return toLocalDateTimeInput(new Date());
}

function dateOnlyValue(value) {
  return String(value || '').slice(0, 10);
}

function cleanNumberInput(value, maxLength = 10) {
  return String(value || '').replace(/[^0-9]/g, '').slice(0, maxLength);
}

function splitExperienceValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { years: '', months: '' };
  const totalMonths = Number(cleanNumberInput(raw, 4) || 0);
  return { years: String(Math.floor(totalMonths / 12)), months: String(totalMonths % 12) };
}

function joinExperienceValue(years, months) {
  const cleanYears = Math.max(0, Number(cleanNumberInput(years, 2)) || 0);
  const cleanMonths = Math.max(0, Math.min(11, Number(cleanNumberInput(months, 2)) || 0));
  return String((cleanYears * 12) + cleanMonths);
}

function quickExperienceRange(value) {
  const months = Number(cleanNumberInput(value, 4) || 0);
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
}

function quickSalaryRange(value) {
  const amount = Number(cleanNumberInput(value, 9) || 0);
  if (!amount) return '0';
  if (amount <= 15000) return '₹1K - ₹15K';
  if (amount <= 20000) return '₹16K - ₹20K';
  if (amount <= 25000) return '₹21K - ₹25K';
  if (amount <= 30000) return '₹26K - ₹30K';
  return '₹31K - ₹35K';
}

function validateQuickCandidate(form) {
  const required = [
    ['full_name', 'Full Name'], ['phone', 'Phone'], ['location', 'Location'], ['qualification', 'Qualification'],
    ['preferred_location', 'Preferred Location'], ['qualification_level', 'Degree / Qualification'],
    ['total_experience', 'Total Experience'], ['relevant_experience', 'Relevant Experience'], ['communication_skill', 'Communication Skill'],
    ['in_hand_salary', 'In-hand Monthly Salary'], ['ctc_monthly', 'CTC Monthly'], ['career_gap', 'Career Gap'],
    ['relevant_experience_range', 'Relevant Experience Range'], ['relevant_in_hand_range', 'In-hand Salary Range'],
    ['interview_reschedule_date', 'Interview Date'], ['status', 'Status'], ['all_details_sent', 'All Details Sent'],
    ['submission_date', 'Submission Date'], ['virtual_onsite', 'Interview Mode'], ['documents_availability', 'All Documents Availability'],
  ];
  const missing = required.filter(([key]) => !String(form?.[key] ?? '').trim()).map(([, label]) => label);
  if (missing.length) return `Fill required fields first: ${missing.join(', ')}`;
  if (String(form.looking_for_job || '').toLowerCase() !== 'yes') return 'Looking For Job is No. Candidate can be saved, but submission will stay blocked later.';
  const total = Number(form.total_experience || 0);
  const relevant = Number(form.relevant_experience || 0);
  if (relevant > total) return 'Relevant Experience cannot be higher than Total Experience.';
  const ctc = Number(cleanNumberInput(form.ctc_monthly, 9) || 0);
  const inHand = Number(cleanNumberInput(form.in_hand_salary, 9) || 0);
  if (ctc && inHand && ctc < inHand) return 'CTC Monthly cannot be lower than In-hand Monthly Salary.';
  return '';
}

export default function QuickAddPage() {
  const { kind = 'candidate' } = useParams();
  const navigate = useNavigate();
  const [lookups, setLookups] = useState({ users: [], candidates: [], jds: [], process_options: [] });
  const [candidateForm, setCandidateForm] = useState(() => makeCandidateInitial());
  const [candidateMode, setCandidateMode] = useState('single');
  const [bulkRows, setBulkRows] = useState([]);
  const [bulkProcess, setBulkProcess] = useState('');
  const [parsing, setParsing] = useState(false);
  const [bulkCreating, setBulkCreating] = useState(false);
  const [taskForm, setTaskForm] = useState(taskInitial);
  const [customHours, setCustomHours] = useState('');
  const [customMinutes, setCustomMinutes] = useState('');
  const [taskUserQuery, setTaskUserQuery] = useState('');
  const [noteForm, setNoteForm] = useState(noteInitial);
  const [interviewForm, setInterviewForm] = useState(interviewInitial);
  const [jdForm, setJdForm] = useState(jdInitial);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.get('/api/ui/lookups').then(setLookups).catch(() => {}); }, []);
  const current = useMemo(() => sections.find((s) => s.key === kind) || sections[0], [kind]);

  function patchCandidateForm(patch) {
    setCandidateForm((currentForm) => ({ ...currentForm, ...patch }));
  }

  function patchCandidateExperience(fieldKey, part, value) {
    setCandidateForm((currentForm) => {
      const currentParts = splitExperienceValue(currentForm[fieldKey]);
      const nextParts = { ...currentParts, [part]: cleanNumberInput(value, 2) };
      const joined = joinExperienceValue(nextParts.years, nextParts.months);
      const patch = { [fieldKey]: joined };
      if (fieldKey === 'relevant_experience') patch.relevant_experience_range = quickExperienceRange(joined);
      return { ...currentForm, ...patch };
    });
  }

  async function submitCandidate(e) {
    e.preventDefault();
    setMessage('');
    const validationMessage = validateQuickCandidate(candidateForm);
    if (validationMessage && !validationMessage.startsWith('Looking For Job is No')) {
      setMessage(validationMessage);
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...candidateForm,
        phone: cleanNumberInput(candidateForm.phone, 10),
        ctc_monthly: cleanNumberInput(candidateForm.ctc_monthly, 9),
        in_hand_salary: cleanNumberInput(candidateForm.in_hand_salary, 9),
        relevant_experience_range: quickExperienceRange(candidateForm.relevant_experience),
        relevant_in_hand_range: quickSalaryRange(candidateForm.in_hand_salary),
      };
      const data = await api.post('/api/candidates', payload);
      setCandidateForm(makeCandidateInitial());
      setMessage(`Candidate created: ${data.item.candidate_id}`);
      navigate(`/candidate/${data.item.candidate_id}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleResumeFiles(fileList) {
    const files = Array.from(fileList || []).slice(0, 30);
    if (!files.length) return;
    setParsing(true);
    setMessage('');
    try {
      const nextRows = [];
      for (const file of files) {
        const text = await readResumeFileText(file);
        const extracted = extractCandidateFields(text, file.name);
        nextRows.push({ ...extracted, process: bulkProcess || extracted.process || '', row_key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}` });
      }
      setBulkRows(nextRows);
      setCandidateMode('bulk-files');
      setMessage(`${nextRows.length} resume${nextRows.length > 1 ? 's' : ''} parsed. Review missing fields, then add to database.`);
    } catch (error) {
      setMessage(error.message || 'Unable to read resume files.');
    } finally {
      setParsing(false);
    }
  }

  function patchBulkRow(rowKey, patch) {
    setBulkRows((currentRows) => currentRows.map((row) => (row.row_key === rowKey ? { ...row, ...patch } : row)));
  }

  function toggleBulkRow(rowKey) {
    setBulkRows((currentRows) => currentRows.map((row) => (row.row_key === rowKey ? { ...row, include: !row.include } : row)));
  }

  async function createBulkCandidates() {
    const selected = bulkRows.filter((row) => row.include);
    if (!selected.length) {
      setMessage('Select at least one parsed row to create candidate profiles.');
      return;
    }
    setBulkCreating(true);
    setMessage('');
    try {
      const payload = selected.map((row) => candidatePayloadFromPreview({ ...row, process: row.process || bulkProcess }, bulkProcess));
      const data = await api.post('/api/candidates/bulk-create', { items: payload }, { timeoutMs: 45000, retries: 1 });
      setMessage(`${data.count || data.items?.length || 0} candidate profiles created from resumes.`);
      if (data.items?.[0]?.candidate_id) navigate(`/candidate/${data.items[0].candidate_id}`);
    } catch (error) {
      setMessage(error.message || 'Bulk create failed.');
    } finally {
      setBulkCreating(false);
    }
  }

  function syncTaskAssignees(nextIds) {
    const cleaned = [...new Set((nextIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
    setTaskForm((currentForm) => ({
      ...currentForm,
      assigned_to_user_ids: cleaned,
      assigned_to_user_id: cleaned[0] || '',
    }));
  }

  function toggleTaskAssignee(userId) {
    const normalized = String(userId || '').trim();
    if (!normalized) return;
    const exists = taskForm.assigned_to_user_ids.includes(normalized);
    syncTaskAssignees(exists
      ? taskForm.assigned_to_user_ids.filter((item) => item !== normalized)
      : [...taskForm.assigned_to_user_ids, normalized]);
  }

  function applyTaskPreset(preset) {
    if (preset.action === 'today') {
      const base = new Date();
      base.setHours(18, 0, 0, 0);
      setTaskForm((currentForm) => ({ ...currentForm, due_date: toLocalDateTimeInput(base) }));
      return;
    }
    const next = parseTaskDueDate(taskForm.due_date);
    next.setMinutes(next.getMinutes() + Number(preset.minutes || 0));
    setTaskForm((currentForm) => ({ ...currentForm, due_date: toLocalDateTimeInput(next) }));
  }

  function applyCustomTaskOffset() {
    const hours = Number(customHours || 0);
    const minutes = Number(customMinutes || 0);
    const totalMinutes = (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
    if (!totalMinutes) return;
    const next = parseTaskDueDate(taskForm.due_date);
    next.setMinutes(next.getMinutes() + totalMinutes);
    setTaskForm((currentForm) => ({ ...currentForm, due_date: toLocalDateTimeInput(next) }));
    setCustomHours('');
    setCustomMinutes('');
  }

  async function submitTask(e) {
    e.preventDefault();
    const selectedAssignees = [...new Set((taskForm.assigned_to_user_ids || []).filter(Boolean))];
    if (!selectedAssignees.length && !String(taskForm.assigned_to_user_id || '').trim()) {
      setMessage('Select at least one team member.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const payload = {
        ...taskForm,
        assigned_to_user_id: selectedAssignees[0] || taskForm.assigned_to_user_id || '',
        assigned_to_user_ids: selectedAssignees,
        due_date: taskForm.due_date || toLocalDateTimeInput(new Date()),
        recurring_type: taskForm.recurring_type || '',
        recurring_interval_minutes: taskForm.recurring_type === 'custom' ? taskForm.recurring_interval_minutes : '',
      };
      const data = await api.post('/api/tasks', payload);
      const count = data.items?.length || 1;
      setTaskForm(taskInitial);
      setCustomHours('');
      setCustomMinutes('');
      setTaskUserQuery('');
      setMessage(count > 1 ? `${count} tasks created for selected team members.` : `Task created: ${data.item.task_id}`);
      navigate('/tasks');
    } finally {
      setSaving(false);
    }
  }

  async function submitNote(e) {
    e.preventDefault();
    setSaving(true); setMessage('');
    try {
      const data = await api.post('/api/notes', noteForm);
      setNoteForm(noteInitial);
      setMessage('Note added successfully.');
      navigate(`/candidate/${data.item.candidate_id}`);
    } finally { setSaving(false); }
  }
  async function submitInterview(e) {
    e.preventDefault();
    setSaving(true); setMessage('');
    try {
      await api.post('/api/interviews', interviewForm);
      setInterviewForm(interviewInitial);
      setMessage('Interview created successfully.');
      navigate('/interviews');
    } finally { setSaving(false); }
  }
  async function submitJd(e) {
    e.preventDefault();
    setSaving(true); setMessage('');
    try {
      await api.post('/api/jds', jdForm);
      setJdForm(jdInitial);
      setMessage('JD created successfully.');
      navigate('/jds');
    } finally { setSaving(false); }
  }

  const userOptions = lookups.users || [];
  const candidateOptions = lookups.candidates || [];
  const jdOptions = lookups.jds || [];
  const processOptions = lookups.process_options || [];
  const bulkMissingCount = bulkRows.filter((row) => row.include && row.missing?.length).length;
  const filteredTaskUsers = useMemo(() => {
    const query = String(taskUserQuery || '').trim().toLowerCase();
    if (!query) return userOptions;
    return userOptions.filter((user) => [user.full_name, user.designation, user.username, user.recruiter_code]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query)));
  }, [taskUserQuery, userOptions]);
  const selectedTaskUsers = useMemo(() => userOptions.filter((user) => taskForm.assigned_to_user_ids.includes(String(user.user_id))), [taskForm.assigned_to_user_ids, userOptions]);

  return (
    <Layout title={`Quick Add • ${current.label}`} subtitle="Open key actions from anywhere and save directly into the workflow.">
      <style>{`
        .qa-mode-row{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0 10px}
        .qa-note{font-size:13px;color:#5972a0;line-height:1.7}
        .qa-dropzone{border:1px dashed rgba(91,122,208,.34);border-radius:24px;padding:18px;background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(244,248,255,.96));display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap}
        .qa-dropzone strong{display:block;color:#18356f;font-size:18px}
        .qa-dropzone small{display:block;margin-top:6px;color:#607091;line-height:1.5}
        .qa-hidden-input{display:none}
        .qa-file-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-top:18px}
        .qa-file-card{border:1px solid rgba(98,131,218,.16);border-radius:24px;background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(246,250,255,.94));box-shadow:0 12px 26px rgba(44,72,137,.08);padding:16px}
        .qa-file-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px}
        .qa-file-name{font-size:16px;font-weight:900;color:#18356f}
        .qa-include{display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:800;color:#35539c}
        .qa-mini-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
        .qa-mini-grid .field textarea{min-height:84px}
        .qa-mini-grid .field.full{grid-column:1/-1}
        .qa-bulk-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:16px}
        .qa-summary{display:flex;gap:10px;flex-wrap:wrap}
        .qa-summary .top-pill{cursor:default}
        .qa-task-shell{display:grid;gap:18px}
        .qa-task-top{display:grid;grid-template-columns:1.15fr .85fr;gap:16px}
        .qa-task-card{border:1px solid rgba(101,131,208,.18);border-radius:24px;padding:18px;background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(245,249,255,.96));box-shadow:0 14px 30px rgba(33,65,128,.08)}
        .qa-task-card.glossy{background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(239,246,255,.98));box-shadow:0 16px 34px rgba(48,87,168,.11), inset 0 1px 0 rgba(255,255,255,.7)}
        .qa-task-card-title{font-size:17px;font-weight:900;color:#163152;margin-bottom:8px}
        .qa-task-card-sub{font-size:13px;color:#607395;line-height:1.6;margin-bottom:14px}
        .qa-selected-row{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px}
        .qa-selected-pill{display:inline-flex;align-items:center;gap:10px;padding:10px 14px;border-radius:999px;background:linear-gradient(90deg,rgba(109,183,255,.16),rgba(183,156,255,.16));border:1px solid rgba(99,132,216,.18);font-size:13px;font-weight:800;color:#1d3961;box-shadow:0 10px 22px rgba(64,94,168,.08)}
        .qa-selected-pill button{border:none;background:rgba(255,255,255,.82);width:22px;height:22px;border-radius:50%;cursor:pointer;color:#365a94;font-weight:900}
        .qa-user-search{margin-bottom:12px}
        .qa-user-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;max-height:260px;overflow:auto;padding-right:4px}
        .qa-user-chip{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:18px;border:1px solid rgba(114,147,219,.16);background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(247,250,255,.96));cursor:pointer;transition:transform .16s ease, box-shadow .18s ease, border-color .18s ease}
        .qa-user-chip:hover{transform:translateY(-1px);box-shadow:0 12px 22px rgba(56,84,151,.09)}
        .qa-user-chip.active{background:linear-gradient(135deg,rgba(111,190,255,.20),rgba(190,169,255,.20));border-color:rgba(89,131,255,.32);box-shadow:0 14px 24px rgba(69,105,190,.12)}
        .qa-user-name{font-size:14px;font-weight:900;color:#163152}
        .qa-user-meta{font-size:12px;color:#61779b;margin-top:3px}
        .qa-user-mark{min-width:30px;height:30px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;background:rgba(255,255,255,.84);color:#315388;border:1px solid rgba(100,136,220,.16)}
        .qa-shortcut-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
        .qa-shortcut-btn{min-height:48px;border:none;border-radius:18px;cursor:pointer;font-weight:900;color:#163152;background:linear-gradient(135deg,rgba(255,255,255,.98),rgba(241,247,255,.98));border:1px solid rgba(110,143,217,.16);box-shadow:0 12px 22px rgba(49,84,155,.08)}
        .qa-shortcut-btn:hover{transform:translateY(-1px)}
        .qa-time-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;align-items:end}
        .qa-repeat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
        .qa-repeat-btn{min-height:48px;border-radius:18px;border:1px solid rgba(104,136,214,.18);background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(243,248,255,.96));font-weight:900;color:#163152;cursor:pointer;box-shadow:0 10px 20px rgba(50,84,152,.08)}
        .qa-repeat-btn.active{background:linear-gradient(90deg,rgba(111,190,255,.20),rgba(184,165,255,.20));border-color:rgba(92,132,255,.32);box-shadow:0 12px 24px rgba(55,96,185,.12)}
        .qa-form-spacer{display:grid;gap:16px}
        .qa-task-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
        .qa-task-grid .field.full{grid-column:1/-1}
        .qa-task-meta{display:flex;flex-wrap:wrap;gap:10px}
        .qa-task-meta .top-pill{cursor:default;background:linear-gradient(90deg,rgba(255,255,255,.96),rgba(240,246,255,.96))}
        .qa-candidate-shell{display:grid;gap:16px}
        .qa-required-note{border:1px solid rgba(91,122,208,.18);border-radius:18px;padding:12px 14px;background:linear-gradient(135deg,rgba(219,235,255,.9),rgba(245,249,255,.96));color:#24476f!important;font-weight:800}
        .qa-section-title{font-size:15px;font-weight:900;color:#173252;margin:4px 0 -4px;text-transform:uppercase;letter-spacing:.04em}
        .qa-exp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
        .qa-candidate-shell .field input,.qa-candidate-shell .field select,.qa-candidate-shell .field textarea{background:linear-gradient(180deg,#f8fbff 0%,#eaf3ff 100%)!important;color:#173252!important;-webkit-text-fill-color:#173252!important;border:1px solid rgba(92,132,204,.24)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.8)!important}
        .qa-candidate-shell .field input::placeholder,.qa-candidate-shell .field textarea::placeholder{color:#55739c!important;opacity:1!important;-webkit-text-fill-color:#55739c!important}
        .qa-candidate-shell .top-pill,.qa-mode-row .top-pill{background:linear-gradient(135deg,#e8f2ff 0%,#d8e8ff 100%)!important;color:#173252!important;-webkit-text-fill-color:#173252!important;border:1px solid rgba(92,132,204,.24)!important;box-shadow:0 10px 22px rgba(31,65,124,.10)!important;text-shadow:none!important}
        .qa-candidate-shell .top-pill.active,.qa-mode-row .top-pill.active{background:linear-gradient(135deg,#8bd2ff 0%,#6fa4ff 54%,#b79cff 100%)!important;color:#0e2340!important;-webkit-text-fill-color:#0e2340!important}
        @media (max-width:1100px){.qa-task-top{grid-template-columns:1fr}.qa-user-grid,.qa-shortcut-grid,.qa-repeat-grid,.qa-time-row{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media (max-width:760px){.qa-mini-grid,.qa-task-grid,.qa-user-grid,.qa-shortcut-grid,.qa-repeat-grid,.qa-time-row,.qa-exp-grid{grid-template-columns:1fr}}
      `}</style>

      <div className="table-panel top-gap-small glassy-card fade-up">
        <div className="table-toolbar">
          <div className="table-title">Quick Add Hub</div>
          <div className="toolbar-actions compact-pills">
            {sections.map((section) => (
              <button key={section.key} type="button" className={`top-pill bounceable ${section.key === kind ? 'active' : ''}`} onClick={() => navigate(`/quick-add/${section.key}`)}>{section.label}</button>
            ))}
          </div>
        </div>
      </div>
      {kind === 'candidate' && (
        <div className="panel top-gap">
          <div className="panel-title">Quick Add Candidate</div>
          <div className="qa-mode-row">
            <button type="button" className={`top-pill bounceable ${candidateMode === 'single' ? 'active' : ''}`} onClick={() => setCandidateMode('single')}>Single Candidate</button>
          </div>

          {candidateMode === 'single' && (
            <form className="stack-form qa-candidate-shell" onSubmit={submitCandidate}>
              <div className="helper-text qa-required-note">All required Candidate Detail fields are available here, so the profile can be created complete from Quick Add.</div>

              <div className="qa-section-title">Basic Details</div>
              <div className="candidate-form-grid candidate-compact-grid">
                <div className="field"><label>Full Name</label><input value={candidateForm.full_name} onChange={(e) => patchCandidateForm({ full_name: e.target.value })} required /></div>
                <div className="field"><label>Phone</label><input value={candidateForm.phone} onChange={(e) => patchCandidateForm({ phone: cleanNumberInput(e.target.value, 10) })} inputMode="numeric" pattern="[0-9]*" required /></div>
                <div className="field"><label>Location</label><input value={candidateForm.location} onChange={(e) => patchCandidateForm({ location: e.target.value })} required /></div>
                <div className="field"><label>Qualification</label><input value={candidateForm.qualification} onChange={(e) => patchCandidateForm({ qualification: e.target.value })} required /></div>
                <div className="field"><label>Preferred Location</label><input value={candidateForm.preferred_location} onChange={(e) => patchCandidateForm({ preferred_location: e.target.value })} required /></div>
                <div className="field"><label>Degree / Qualification</label><select value={candidateForm.qualification_level} onChange={(e) => patchCandidateForm({ qualification_level: e.target.value })} required>{DEGREE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
              </div>

              <div className="qa-section-title">Experience</div>
              <div className="candidate-form-grid candidate-compact-grid">
                <div className="field"><label>Total Experience</label><div className="qa-exp-grid"><input placeholder="Years" value={splitExperienceValue(candidateForm.total_experience).years} onChange={(e) => patchCandidateExperience('total_experience', 'years', e.target.value)} inputMode="numeric" /><input placeholder="Months" value={splitExperienceValue(candidateForm.total_experience).months} onChange={(e) => patchCandidateExperience('total_experience', 'months', e.target.value)} inputMode="numeric" /></div><div className="helper-text top-gap-small">Saved as: {candidateForm.total_experience || '0'} months</div></div>
                <div className="field"><label>Relevant Experience</label><div className="qa-exp-grid"><input placeholder="Years" value={splitExperienceValue(candidateForm.relevant_experience).years} onChange={(e) => patchCandidateExperience('relevant_experience', 'years', e.target.value)} inputMode="numeric" /><input placeholder="Months" value={splitExperienceValue(candidateForm.relevant_experience).months} onChange={(e) => patchCandidateExperience('relevant_experience', 'months', e.target.value)} inputMode="numeric" /></div><div className="helper-text top-gap-small">Saved as: {candidateForm.relevant_experience || '0'} months</div></div>
                <div className="field"><label>Relevant Experience Range</label><select value={candidateForm.relevant_experience_range} onChange={(e) => patchCandidateForm({ relevant_experience_range: e.target.value })} required>{EXPERIENCE_RANGE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
                <div className="field"><label>Career Gap</label><select value={candidateForm.career_gap} onChange={(e) => patchCandidateForm({ career_gap: e.target.value })} required>{CAREER_GAP_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
              </div>

              <div className="qa-section-title">Salary & Documents</div>
              <div className="candidate-form-grid candidate-compact-grid">
                <div className="field"><label>CTC Monthly</label><input value={candidateForm.ctc_monthly} onChange={(e) => patchCandidateForm({ ctc_monthly: cleanNumberInput(e.target.value, 9) })} inputMode="numeric" pattern="[0-9]*" required /></div>
                <div className="field"><label>In-hand Monthly Salary</label><input value={candidateForm.in_hand_salary} onChange={(e) => patchCandidateForm({ in_hand_salary: cleanNumberInput(e.target.value, 9), relevant_in_hand_range: quickSalaryRange(e.target.value) })} inputMode="numeric" pattern="[0-9]*" required /></div>
                <div className="field"><label>In-hand Salary Range</label><select value={candidateForm.relevant_in_hand_range} onChange={(e) => patchCandidateForm({ relevant_in_hand_range: e.target.value })} required>{SALARY_RANGE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
                <div className="field"><label>All Documents Availability</label><select value={candidateForm.documents_availability} onChange={(e) => patchCandidateForm({ documents_availability: e.target.value })} required>{DOCUMENTS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
                <div className="field"><label>Communication Skill</label><select value={candidateForm.communication_skill} onChange={(e) => patchCandidateForm({ communication_skill: e.target.value })} required>{COMMUNICATION_SKILL_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
              </div>

              <div className="qa-section-title">Interview & Workflow</div>
              <div className="candidate-form-grid candidate-compact-grid">
                <div className="field"><label>Process</label><input list="quick-process-list" value={candidateForm.process} onChange={(e) => patchCandidateForm({ process: e.target.value })} /><datalist id="quick-process-list">{processOptions.map((option) => <option key={option} value={option} />)}</datalist></div>
                <div className="field"><label>Interview Date</label><input type="date" value={dateOnlyValue(candidateForm.interview_reschedule_date)} onChange={(e) => patchCandidateForm({ interview_reschedule_date: e.target.value })} required /></div>
                <div className="field"><label>Interview Mode</label><select value={candidateForm.virtual_onsite} onChange={(e) => patchCandidateForm({ virtual_onsite: e.target.value })} required>{INTERVIEW_MODE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
                <div className="field"><label>Follow-up</label><input type="datetime-local" value={candidateForm.follow_up_at ? toLocalDateTimeInput(candidateForm.follow_up_at) : ''} onChange={(e) => patchCandidateForm({ follow_up_at: e.target.value, follow_up_status: e.target.value ? 'Open' : '' })} /></div>
                <div className="field"><label>Status</label><select value={candidateForm.status} onChange={(e) => patchCandidateForm({ status: e.target.value })} required>{CANDIDATE_STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
                <div className="field"><label>Priority</label><select value={candidateForm.profile_priority} onChange={(e) => patchCandidateForm({ profile_priority: e.target.value })}>{PROFILE_PRIORITY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
              </div>

              <div className="qa-section-title">Submission Control</div>
              <div className="candidate-form-grid candidate-compact-grid">
                <div className="field"><label>Call Connected</label><select value={candidateForm.call_connected} onChange={(e) => patchCandidateForm({ call_connected: e.target.value })}>{CALL_CONNECTED_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
                <div className="field"><label>Looking for Job</label><select value={candidateForm.looking_for_job} onChange={(e) => patchCandidateForm({ looking_for_job: e.target.value })}>{LOOKING_FOR_JOB_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
                <div className="field"><label>All Details Sent</label><select value={candidateForm.all_details_sent} onChange={(e) => patchCandidateForm({ all_details_sent: e.target.value })} required>{DETAILS_SENT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>
                <div className="field"><label>Submission Date</label><input type="datetime-local" value={toLocalDateTimeInput(candidateForm.submission_date)} onChange={(e) => patchCandidateForm({ submission_date: e.target.value })} required /></div>
              </div>

              <div className="field"><label>Starter Note</label><textarea rows="4" value={candidateForm.notes} onChange={(e) => patchCandidateForm({ notes: e.target.value })} /></div>
              <div className="row-actions top-gap"><button className="add-profile-btn bounceable" disabled={saving} type="submit">{saving ? 'Creating...' : 'Create Candidate'}</button></div>
            </form>
          )}

          <div className="helper-text top-gap-small">Bulk resume parsing now lives in the separate <strong>Data Extractor</strong> slice for manager control and cleaner review.</div>
        </div>
      )}
      {kind === 'task' && (
        <div className="panel top-gap">
          <div className="panel-title">Quick Add Task</div>
          <form className="qa-task-shell" onSubmit={submitTask}>
            <div className="qa-task-top">
              <div className="qa-task-card glossy">
                <div className="qa-task-card-title">Assign Team Members</div>
                <div className="qa-task-card-sub">A single task can be assigned to multiple users. The system creates a separate task for each selected user.</div>
                <div className="qa-selected-row">
                  {selectedTaskUsers.length ? selectedTaskUsers.map((user) => (
                    <span key={user.user_id} className="qa-selected-pill">
                      <span>{user.full_name} • {user.designation || user.username || '-'}</span>
                      <button type="button" aria-label={`Remove ${user.full_name}`} onClick={() => toggleTaskAssignee(user.user_id)}>×</button>
                    </span>
                  )) : <span className="helper-text">No team member selected yet.</span>}
                </div>
                <div className="field qa-user-search no-label-field">
                  <input value={taskUserQuery} onChange={(e) => setTaskUserQuery(e.target.value)} placeholder="Search recruiter, TL, manager" />
                </div>
                <div className="qa-user-grid">
                  {filteredTaskUsers.map((user) => {
                    const active = taskForm.assigned_to_user_ids.includes(String(user.user_id));
                    return (
                      <button key={user.user_id} type="button" className={`qa-user-chip ${active ? 'active' : ''}`} onClick={() => toggleTaskAssignee(user.user_id)}>
                        <span>
                          <div className="qa-user-name">{user.full_name}</div>
                          <div className="qa-user-meta">{user.designation || '-'} • {user.recruiter_code || user.username || '-'}</div>
                        </span>
                        <span className="qa-user-mark">{active ? '✓' : 'Add'}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="qa-task-card">
                <div className="qa-task-card-title">Due Date & Time</div>
                <div className="qa-task-card-sub">Date and time are both stored here. Quick preset buttons and custom hours or minutes are available below.</div>
                <div className="field">
                  <label>Due Date & Time</label>
                  <input type="datetime-local" value={taskForm.due_date} onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })} />
                </div>
                <div className="qa-shortcut-grid">
                  {QUICK_TASK_PRESETS.map((preset) => (
                    <button key={preset.label} type="button" className="qa-shortcut-btn bounceable" onClick={() => applyTaskPreset(preset)}>{preset.label}</button>
                  ))}
                </div>
                <div className="qa-time-row top-gap-small">
                  <div className="field">
                    <label>Add Hours</label>
                    <input type="number" min="0" step="1" value={customHours} onChange={(e) => setCustomHours(e.target.value)} placeholder="2" />
                  </div>
                  <div className="field">
                    <label>Add Minutes</label>
                    <input type="number" min="0" step="5" value={customMinutes} onChange={(e) => setCustomMinutes(e.target.value)} placeholder="30" />
                  </div>
                  <button type="button" className="add-profile-btn bounceable" style={{ minHeight: 52 }} onClick={applyCustomTaskOffset}>Apply Time</button>
                </div>
              </div>
            </div>

            <div className="qa-task-card qa-form-spacer">
              <div className="qa-task-card-title">Task Details</div>
              <div className="qa-task-grid">
                <div className="field"><label>Task Title</label><input value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} required /></div>
                <div className="field"><label>Priority</label><select value={taskForm.priority} onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}><option>Low</option><option>Normal</option><option>High</option><option>Critical</option></select></div>
                <div className="field full"><label>Description</label><textarea rows="4" value={taskForm.description} onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })} /></div>
              </div>

              <div>
                <div className="qa-task-card-title" style={{ marginBottom: 10 }}>Repeat</div>
                <div className="qa-task-card-sub">Daily waale tasks ke liye yahi word use kiya: <strong>Repeat</strong>. Daily matlab task dobara khulta rahega. Morning-evening wale ritual humans clearly adore.</div>
                <div className="qa-repeat-grid">
                  {REPEAT_OPTIONS.map((item) => (
                    <button key={item.value || 'one'} type="button" className={`qa-repeat-btn bounceable ${taskForm.recurring_type === item.value ? 'active' : ''}`} onClick={() => setTaskForm({ ...taskForm, recurring_type: item.value, recurring_interval_minutes: item.value === 'custom' ? (taskForm.recurring_interval_minutes || '120') : '' })}>{item.label}</button>
                  ))}
                </div>
              </div>

              {taskForm.recurring_type === 'custom' && (
                <div className="field">
                  <label>Custom Repeat Minutes</label>
                  <input type="number" min="5" step="5" value={taskForm.recurring_interval_minutes} onChange={(e) => setTaskForm({ ...taskForm, recurring_interval_minutes: e.target.value })} placeholder="120" />
                </div>
              )}

              <div className="qa-task-meta">
                <span className="top-pill">Selected users: {taskForm.assigned_to_user_ids.length}</span>
                <span className="top-pill">Repeat: {REPEAT_OPTIONS.find((item) => item.value === taskForm.recurring_type)?.label || 'One Time'}</span>
                <span className="top-pill">Due: {taskForm.due_date ? new Date(taskForm.due_date).toLocaleString('en-IN', { hour12: true }) : 'Not set yet'}</span>
              </div>
            </div>

            <div className="row-actions"><button className="add-profile-btn bounceable" disabled={saving} type="submit">{saving ? 'Creating...' : 'Create Task'}</button></div>
          </form>
        </div>
      )}
      {kind === 'note' && (
        <div className="panel top-gap"><div className="panel-title">Quick Add Note</div><form className="stack-form" onSubmit={submitNote}><div className="candidate-form-grid candidate-compact-grid"><div className="field"><label>Candidate</label><select value={noteForm.candidate_id} onChange={(e) => setNoteForm({ ...noteForm, candidate_id: e.target.value })} required><option value="">Select candidate</option>{candidateOptions.map((candidate) => <option key={candidate.candidate_id} value={candidate.candidate_id}>{candidate.full_name} • {candidate.candidate_id}</option>)}</select></div><div className="field"><label>Note Type</label><select value={noteForm.note_type} onChange={(e) => setNoteForm({ ...noteForm, note_type: e.target.value })}><option value="public">Public</option><option value="internal">Internal</option><option value="follow_up">Follow Up</option></select></div></div><div className="field"><label>Note</label><textarea rows="5" value={noteForm.body} onChange={(e) => setNoteForm({ ...noteForm, body: e.target.value })} required /></div><div className="row-actions top-gap"><button className="add-profile-btn bounceable" disabled={saving} type="submit">Add Note</button></div></form></div>
      )}
      {kind === 'interview' && (
        <div className="panel top-gap"><div className="panel-title">Quick Add Interview</div><form className="stack-form" onSubmit={submitInterview}><div className="candidate-form-grid candidate-compact-grid"><div className="field"><label>Candidate</label><select value={interviewForm.candidate_id} onChange={(e) => setInterviewForm({ ...interviewForm, candidate_id: e.target.value })} required><option value="">Select candidate</option>{candidateOptions.map((candidate) => <option key={candidate.candidate_id} value={candidate.candidate_id}>{candidate.full_name} • {candidate.candidate_id}</option>)}</select></div><div className="field"><label>JD</label><select value={interviewForm.jd_id} onChange={(e) => setInterviewForm({ ...interviewForm, jd_id: e.target.value })}><option value="">Select JD</option>{jdOptions.map((jd) => <option key={jd.jd_id} value={jd.jd_id}>{jd.job_title} • {jd.company}</option>)}</select></div><div className="field"><label>Stage</label><select value={interviewForm.stage} onChange={(e) => setInterviewForm({ ...interviewForm, stage: e.target.value })}><option>Screening</option><option>HR</option><option>Ops</option><option>Final</option></select></div><div className="field"><label>Scheduled At</label><input type="datetime-local" value={interviewForm.scheduled_at} onChange={(e) => setInterviewForm({ ...interviewForm, scheduled_at: e.target.value })} required /></div></div><div className="row-actions top-gap"><button className="add-profile-btn bounceable" disabled={saving} type="submit">Create Interview</button></div></form></div>
      )}
      {kind === 'jd' && (
        <div className="panel top-gap"><div className="panel-title">Quick Add JD</div><form className="stack-form" onSubmit={submitJd}><div className="candidate-form-grid candidate-compact-grid"><div className="field"><label>Job Title</label><input value={jdForm.job_title} onChange={(e) => setJdForm({ ...jdForm, job_title: e.target.value })} required /></div><div className="field"><label>Company</label><input value={jdForm.company} onChange={(e) => setJdForm({ ...jdForm, company: e.target.value })} required /></div><div className="field"><label>Location</label><input value={jdForm.location} onChange={(e) => setJdForm({ ...jdForm, location: e.target.value })} /></div><div className="field"><label>Experience</label><input value={jdForm.experience} onChange={(e) => setJdForm({ ...jdForm, experience: e.target.value })} /></div><div className="field"><label>Salary</label><input value={jdForm.salary} onChange={(e) => setJdForm({ ...jdForm, salary: e.target.value })} /></div></div><div className="row-actions top-gap"><button className="add-profile-btn bounceable" disabled={saving} type="submit">Create JD</button></div></form></div>
      )}
      {!!message && <div className="panel top-gap"><div className="helper-text">{message}</div></div>}
    </Layout>
  );
}
