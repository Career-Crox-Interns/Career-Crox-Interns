import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { addWhatsAppTemplate, getWhatsAppTemplates } from '../lib/templateStore';
import { useAuth } from '../lib/auth';
import { dialCandidateWithLog, openWhatsAppWithLog, visiblePhone } from '../lib/candidateAccess';

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
function PhoneIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7.4 3.8h2.1c.5 0 .9.3 1.1.8l1.1 3.1c.2.5 0 1.1-.4 1.4L9.8 10.4a13.2 13.2 0 0 0 3.8 3.8l1.3-1.5c.3-.4.9-.6 1.4-.4l3.1 1.1c.5.2.8.6.8 1.1v2.1c0 .7-.6 1.3-1.3 1.3A15.9 15.9 0 0 1 6.1 5.1c0-.7.6-1.3 1.3-1.3Z" fill="currentColor" /></svg>;
}
function WhatsAppIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M19.1 4.8A9.7 9.7 0 0 0 3.8 16.7L2.7 21.3l4.8-1.1a9.7 9.7 0 0 0 4.5 1.1h.1a9.7 9.7 0 0 0 7-16.5Zm-7 14.8h-.1a7.9 7.9 0 0 1-4-1.1l-.3-.2-2.8.7.7-2.7-.2-.3a7.9 7.9 0 1 1 6.7 3.6Z" fill="currentColor" /><path d="M16.5 13.8c-.2-.1-1.3-.7-1.5-.7-.2-.1-.3-.1-.5.1l-.4.5c-.1.2-.3.2-.5.1-.2-.1-.8-.3-1.5-1a5.5 5.5 0 0 1-1-1.2c-.1-.2 0-.3.1-.4l.3-.4.2-.4c.1-.1 0-.3 0-.4l-.7-1.6c-.2-.4-.3-.3-.5-.3h-.4c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 1.9 0 1 .8 2.1.9 2.3.1.1 1.7 2.6 4 3.6 2.4 1 2.4.7 2.8.7.4-.1 1.3-.5 1.5-1 .2-.4.2-.9.2-1 0-.1-.2-.2-.4-.3Z" fill="currentColor" /></svg>;
}
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

const ALWAYS_HIDDEN_STATUSES = new Set(['not intrested', 'not interested', 'not responding', 'rejected']);
const ALWAYS_HIDDEN_APPROVALS = new Set(['rejected']);
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
  { key: 'total', label: 'Total Interview', cardClass: 'violet', sub: 'All visible interviews' },
  { key: 'upcoming', label: 'Upcoming Interview', cardClass: 'blue', sub: 'After today' },
  { key: 'missed', label: 'Missed Interview', cardClass: 'danger', sub: 'Date already crossed' },
  { key: 'week', label: 'This Week Interview', cardClass: 'orange', sub: '3 days before to 3 days after' },
];

function containsText(value, q) {
  return String(value || '').toLowerCase().includes(String(q || '').toLowerCase());
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
function offsetDateYmd(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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
function isInterviewEligible(row) {
  const status = normalizeStatus(row.status);
  const approvalStatus = normalizeStatus(row.approval_status);
  if (ALWAYS_HIDDEN_STATUSES.has(status)) return false;
  if (ALWAYS_HIDDEN_APPROVALS.has(approvalStatus)) return false;
  return true;
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
    return compareValues(a.full_name, b.full_name, 'text');
  });
}

export default function InterviewsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [allRows, setAllRows] = useState([]);
  const [filters, setFilters] = useState(defaultFilters);
  const [compactFilters, setCompactFilters] = useState(defaultCompactFilters);
  const [sortConfig, setSortConfig] = useState(defaultSort);
  const [quickView, setQuickView] = useState('today');
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [activeFilterKey, setActiveFilterKey] = useState('status');
  const [optionSearches, setOptionSearches] = useState({});
  const [waTemplates, setWaTemplates] = useState(getWhatsAppTemplates());
  const [selectedIds, setSelectedIds] = useState([]);
  const [dialerOpen, setDialerOpen] = useState(false);
  const [dialerIndex, setDialerIndex] = useState(0);

  async function load() {
    const data = await api.get('/api/interviews');
    const items = (data.items || []).map((row) => {
      const interviewDate = String(row.interview_reschedule_date || row.interview_date || row.scheduled_at || '').slice(0, 10);
      return {
        ...row,
        interview_date_effective: interviewDate,
        recruiter_code_list: splitValues(row.recruiter_code),
        process_list: splitValues(row.process),
        preferred_location_list: splitValues(row.preferred_location),
      };
    });
    setAllRows(items);
  }

  useEffect(() => { load(); }, []);
  usePolling(load, 7000, []);

  const eligibleRows = useMemo(() => allRows.filter(isInterviewEligible), [allRows]);

  const filterSections = useMemo(() => ([
    { key: 'recruiter_code', label: 'Recruiter code', type: 'options', options: uniqueOptions(eligibleRows, (row) => row.recruiter_code, true) },
    { key: 'interview_date', label: 'Interview date', type: 'interview-date' },
    { key: 'preferred_location', label: 'Preferred Location', type: 'options', options: uniqueOptions(eligibleRows, (row) => row.preferred_location, true) },
    { key: 'communication_skill', label: 'Communication Skill', type: 'options', options: uniqueOptions(eligibleRows, (row) => row.communication_skill) },
    { key: 'process', label: 'Process', type: 'options', options: uniqueOptions(eligibleRows, (row) => row.process, true) },
    { key: 'virtual_onsite', label: 'Virtual', type: 'options', options: uniqueOptions(eligibleRows, (row) => row.virtual_onsite) },
    { key: 'status', label: 'Status', type: 'options', options: uniqueOptions(eligibleRows, (row) => row.status) },
    { key: 'all_details_sent', label: 'All Details Sent', type: 'options', options: uniqueOptions(eligibleRows, (row) => row.all_details_sent) },
    { key: 'submission_date', label: 'Submission Date', type: 'date-range', from: 'submission_from', to: 'submission_to' },
    { key: 'career_gap', label: 'Career Gap', type: 'options', options: uniqueOptions(eligibleRows, (row) => row.career_gap) },
    { key: 'relevant_exp_range', label: 'Relavant Exp Range', type: 'options', options: uniqueOptions(eligibleRows, (row) => row.relevant_experience_range) },
    { key: 'relevant_salary_range', label: 'Relavant Inhand Salary Range', type: 'options', options: uniqueOptions(eligibleRows, (row) => row.relevant_in_hand_range) },
    { key: 'qualification', label: 'Current Qualification', type: 'options', options: uniqueOptions(eligibleRows, (row) => row.qualification_level || row.qualification) },
  ]), [eligibleRows]);

  const compactFilterOptions = useMemo(() => ({
    recruiter_code: uniqueOptions(eligibleRows, (row) => row.recruiter_code, true),
    communication_skill: uniqueOptions(eligibleRows, (row) => row.communication_skill),
    preferred_location: uniqueOptions(eligibleRows, (row) => row.preferred_location, true),
    qualification: uniqueOptions(eligibleRows, (row) => row.qualification_level || row.qualification),
    relevant_exp_range: uniqueOptions(eligibleRows, (row) => row.relevant_experience_range),
    relevant_salary_range: uniqueOptions(eligibleRows, (row) => row.relevant_in_hand_range),
  }), [eligibleRows]);

  const activeSection = useMemo(() => filterSections.find((section) => section.key === activeFilterKey) || filterSections[0] || null, [filterSections, activeFilterKey]);
  const activeOptionSearch = optionSearches[activeSection?.key] || '';
  const activeVisibleOptions = useMemo(() => {
    if (!activeSection || activeSection.type !== 'options') return [];
    return (activeSection.options || []).filter((item) => containsText(item, activeOptionSearch));
  }, [activeSection, activeOptionSearch]);

  const baseFilteredRows = useMemo(() => {
    const today = offsetDateYmd(0);
    const pastLimit = filters.interview_days ? offsetDateYmd(-Number(filters.interview_days || 0)) : '';
    const futureLimit = filters.interview_days ? offsetDateYmd(Number(filters.interview_days || 0)) : '';

    return eligibleRows.filter((row) => {
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
      if (filters.interview_from && interviewDate < String(filters.interview_from)) return false;
      if (filters.interview_to && interviewDate > String(filters.interview_to)) return false;

      if (filters.interview_mode === 'upcoming') {
        if (!interviewDate || interviewDate < today) return false;
        if (futureLimit && interviewDate > futureLimit) return false;
      }
      if (filters.interview_mode === 'previous') {
        if (!interviewDate || interviewDate > today) return false;
        if (pastLimit && interviewDate < pastLimit) return false;
      }
      return true;
    });
  }, [eligibleRows, filters, compactFilters]);

  const cardStats = useMemo(() => {
    const today = offsetDateYmd(0);
    const weekStart = offsetDateYmd(-3);
    const weekEnd = offsetDateYmd(3);
    return {
      today: baseFilteredRows.filter((row) => row.interview_date_effective === today).length,
      total: baseFilteredRows.length,
      upcoming: baseFilteredRows.filter((row) => row.interview_date_effective && row.interview_date_effective > today).length,
      missed: baseFilteredRows.filter((row) => row.interview_date_effective && row.interview_date_effective < today).length,
      week: baseFilteredRows.filter((row) => row.interview_date_effective && row.interview_date_effective >= weekStart && row.interview_date_effective <= weekEnd).length,
    };
  }, [baseFilteredRows]);

  const quickViewRows = useMemo(() => {
    const today = offsetDateYmd(0);
    const weekStart = offsetDateYmd(-3);
    const weekEnd = offsetDateYmd(3);
    const currentView = quickView || 'today';
    const visible = baseFilteredRows.filter((row) => {
      if (currentView === 'total') return true;
      if (currentView === 'today') return row.interview_date_effective === today;
      if (currentView === 'upcoming') return row.interview_date_effective && row.interview_date_effective > today;
      if (currentView === 'missed') return row.interview_date_effective && row.interview_date_effective < today;
      if (currentView === 'week') return row.interview_date_effective && row.interview_date_effective >= weekStart && row.interview_date_effective <= weekEnd;
      return true;
    });
    return sortRows(visible, sortConfig);
  }, [baseFilteredRows, quickView, sortConfig]);

  const dialerSourceRows = useMemo(() => Array.from(new Map(quickViewRows.map((row) => [String(row.candidate_id), row])).values()), [quickViewRows]);
  const selectedRows = useMemo(() => dialerSourceRows.filter((row) => selectedIds.includes(row.candidate_id)), [dialerSourceRows, selectedIds]);
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

  function resetFilters() {
    setFilters(defaultFilters);
    setCompactFilters(defaultCompactFilters);
    setOptionSearches({});
    setSortConfig(defaultSort);
    setQuickView('today');
    setSelectedIds([]);
    setDialerOpen(false);
    setDialerIndex(0);
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

  async function dialCandidate(candidateId, phone) {
    dialCandidateWithLog(candidateId, phone);
  }

  function openWhatsApp(candidateId, phone, template = '') {
    openWhatsAppWithLog(candidateId, phone, template);
  }

  function onDialerTemplatePick(value) {
    if (!currentDialerTarget || !value) return;
    if (value === '__add_new__') {
      const fresh = window.prompt('Type new WhatsApp template');
      if (fresh) setWaTemplates(addWhatsAppTemplate(fresh));
      return;
    }
    openWhatsApp(currentDialerTarget.candidate_id, currentDialerTarget.phone, value);
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

  function nextSelected() {
    if (!selectedRows.length) return;
    setDialerIndex((prev) => (prev + 1) % selectedRows.length);
  }

  function prevSelected() {
    if (!selectedRows.length) return;
    setDialerIndex((prev) => (prev - 1 + selectedRows.length) % selectedRows.length);
  }

  return (
    <Layout title="Interview Pipeline" subtitle="Recruiter-wise and interview-date-wise view.">
      <div className="panel top-gap-small interview-summary-grid five-up">
        {quickViewOptions.map((card) => {
          const metricValue = card.key === 'today' ? cardStats.today : card.key === 'total' ? cardStats.total : card.key === 'upcoming' ? cardStats.upcoming : card.key === 'missed' ? cardStats.missed : cardStats.week;
          const active = quickView === card.key;
          return (
            <button
              type="button"
              key={card.key}
              className={`metric-card compact gradient-card clickable-summary-card ${card.cardClass} ${active ? 'metric-card-active' : ''}`}
              onClick={() => setQuickView(card.key)}
            >
              <div className="metric-label">{card.label}</div>
              <div className="metric-value">{metricValue}</div>
              <div className="metric-sub">{card.sub}</div>
            </button>
          );
        })}
      </div>

      <div className="table-panel top-gap glassy-card fade-up">
        <div className="table-toolbar no-wrap-toolbar interview-toolbar-wrap">
          <div className="table-title">Interview Pipeline</div>
          <div className="toolbar-actions compact-pills candidate-toolbar-actions interview-toolbar-actions">
            <div className="interview-sort-strip">
              <div className="compact-select-shell interview-sort-shell shell-violet">
                <span className="compact-shell-label">Sort by</span>
                <select className="inline-input compact-inline-input" value={sortConfig.key} onChange={(e) => setSortConfig((prev) => ({ ...prev, key: e.target.value }))}>
                  {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <div className="compact-select-shell interview-sort-shell narrow shell-blue">
                <span className="compact-shell-label">Order</span>
                <select className="inline-input compact-inline-input" value={sortConfig.order} onChange={(e) => setSortConfig((prev) => ({ ...prev, order: e.target.value }))}>
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              </div>
            </div>
            <span className="metric-mini-chip records">{quickViewRows.length} records</span>
            <span className="metric-mini-chip filters">{activeCount} filters</span>
            <button type="button" className="ghost-btn bounceable gradient-action-btn gradient-rose" onClick={resetFilters}>Reset All</button>
            <button type="button" className="ghost-btn bounceable modern-filter-btn gradient-action-btn gradient-slate" onClick={() => setShowFilterModal(true)}><FilterIcon /> Filters</button>
          </div>
        </div>

        <div className="interview-quick-filter-strip">
          <div className="compact-select-shell shell-indigo">
            <span className="compact-shell-label">Recruiter Code</span>
            <select className="inline-input compact-inline-input" value={compactFilters.recruiter_code} onChange={(e) => handleCompactChange('recruiter_code', e.target.value)}>
              <option value="">All Recruiters</option>
              {compactFilterOptions.recruiter_code.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div className="compact-select-shell shell-cyan">
            <span className="compact-shell-label">Communication</span>
            <select className="inline-input compact-inline-input" value={compactFilters.communication_skill} onChange={(e) => handleCompactChange('communication_skill', e.target.value)}>
              <option value="">All Communication</option>
              {compactFilterOptions.communication_skill.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div className="compact-select-shell shell-green">
            <span className="compact-shell-label">Preferred Location</span>
            <select className="inline-input compact-inline-input" value={compactFilters.preferred_location} onChange={(e) => handleCompactChange('preferred_location', e.target.value)}>
              <option value="">All Preferred Location</option>
              {compactFilterOptions.preferred_location.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div className="compact-select-shell shell-peach">
            <span className="compact-shell-label">Qualification</span>
            <select className="inline-input compact-inline-input" value={compactFilters.qualification} onChange={(e) => handleCompactChange('qualification', e.target.value)}>
              <option value="">All Qualification</option>
              {compactFilterOptions.qualification.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div className="compact-select-shell shell-gold">
            <span className="compact-shell-label">Relevant Experience</span>
            <select className="inline-input compact-inline-input" value={compactFilters.relevant_exp_range} onChange={(e) => handleCompactChange('relevant_exp_range', e.target.value)}>
              <option value="">All Experience Range</option>
              {compactFilterOptions.relevant_exp_range.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div className="compact-select-shell shell-lilac">
            <span className="compact-shell-label">Inhand Salary</span>
            <select className="inline-input compact-inline-input" value={compactFilters.relevant_salary_range} onChange={(e) => handleCompactChange('relevant_salary_range', e.target.value)}>
              <option value="">All Salary Range</option>
              {compactFilterOptions.relevant_salary_range.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
        </div>

        <div className="candidate-master-row interview-selection-row">
          <button type="button" className={`selection-master-pill bounceable ${allSelected ? 'active' : ''}`} onClick={toggleSelectAll}>
            <span className="selection-master-icon"><SelectAllIcon /></span>
            {allSelected ? 'Clear All' : 'Select All'}
          </button>
          <span className="selection-count-chip interview-master-count">{selectedIds.length} selected</span>
          <button type="button" className={`open-dialer-pill bounceable ${selectedRows.length ? 'active' : ''}`} onClick={() => setDialerOpen((prev) => selectedRows.length ? !prev : false)} disabled={!selectedRows.length}>
            <DialerIcon /> Open Dialer
          </button>
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
              {currentDialerTarget.full_name || '-'} • {visiblePhone(user, currentDialerTarget.phone || '')}
            </div>

            <div className="dialer-actions-row row-actions nowrap-actions">
              <button type="button" className="mini-btn ghost bounceable modern-nav-btn" onClick={prevSelected} title="Previous"><PrevIcon /></button>
              <button type="button" className="mini-btn view bounceable modern-icon-btn modern-call-btn" onClick={() => dialCandidate(currentDialerTarget.candidate_id, currentDialerTarget.phone)} title="Dial now"><PhoneIcon /></button>
              <button type="button" className="mini-btn edit bounceable modern-icon-btn modern-wa-btn" onClick={() => openWhatsApp(currentDialerTarget.candidate_id, currentDialerTarget.phone, '')} title="Open WhatsApp"><WhatsAppIcon /></button>
              <select className="wa-template-select dialer-template-select" defaultValue="" onChange={(e) => { onDialerTemplatePick(e.target.value); e.target.value = ''; }}>
                <option value="">WA Template</option>
                {waTemplates.map((tpl) => <option key={tpl} value={tpl}>{tpl.slice(0, 44)}</option>)}
                <option value="__add_new__">Add New...</option>
              </select>
              <button type="button" className="mini-btn ghost bounceable modern-nav-btn" onClick={nextSelected} title="Next"><NextIcon /></button>
              <button type="button" className="open-profile-chip bounceable" onClick={() => navigate(`/candidate/${currentDialerTarget.candidate_id}`)}>Open Profile</button>
            </div>
          </div>
        ) : null}

        <div className="interview-groups-stack top-gap-small">
          {grouped.map((group) => (
            <div className="panel interview-date-panel" key={group.dateKey}>
              <div className="interview-date-header">
                <div>
                  <div className="panel-title">{group.dateLabel}</div>
                  <div className="helper-text">Latest interview dates appear first.</div>
                </div>
                <span className="metric-mini-chip records stat-chip stat-chip-interviews">{group.recruiters.reduce((sum, recruiter) => sum + recruiter.items.length, 0)} interviews</span>
              </div>

              <div className="interview-recruiter-blocks top-gap-small">
                {group.recruiters.map((bucket) => (
                  <div className="interview-recruiter-panel" key={`${group.dateKey}-${bucket.recruiterCode}`}>
                    <div className="interview-recruiter-head">
                      <div className="interview-recruiter-title">{bucket.recruiterCode}</div>
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
                              <tr key={`${row.candidate_id}-${row.interview_date_effective}-${row.recruiter_code}`} className={`clickable-row ${selected ? 'selected-row' : ''}`} onClick={() => navigate(`/candidate/${row.candidate_id}`)}>
                                <td>
                                  <button type="button" className={`row-check-btn bounceable ${selected ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); toggleSelection(row.candidate_id); }} title={selected ? 'Selected' : 'Select this candidate'}>
                                    <CheckIcon />
                                  </button>
                                </td>
                                <td><strong>{row.full_name || '-'}</strong><br /><span className="subtle">{row.candidate_id}</span></td>
                                <td>{visiblePhone(user, row.phone)}</td>
                                <td>{row.location || '-'}</td>
                                <td>{row.preferred_location || '-'}</td>
                                <td>{row.communication_skill || '-'}</td>
                                <td><span className="status-chip">{row.status || '-'}</span></td>
                                <td><span className="status-chip secondary">{row.all_details_sent || '-'}</span></td>
                                <td>{row.submission_date || '-'}</td>
                                <td className="sticky-actions-cell">
                                  <div className="row-actions nowrap-actions compact-row-actions">
                                    <button className="mini-btn call bounceable modern-icon-btn modern-eye-btn" type="button" title="Open Profile" onClick={(e) => { e.stopPropagation(); navigate(`/candidate/${row.candidate_id}`); }}><EyeIcon /></button>
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
                                <span>{item}</span>
                              </label>
                            );
                          })}
                          {!activeVisibleOptions.length ? <div className="helper-text">No options found.</div> : null}
                        </div>
                      </>
                    ) : activeSection.type === 'interview-date' ? (
                      <div className="top-gap-small interview-filter-stack">
                        <div className="candidate-range-row wider">
                          <div className="field"><label>From Date</label><input className="inline-input" type="date" value={filters.interview_from} onChange={(e) => setFilters((prev) => ({ ...prev, interview_from: e.target.value }))} /></div>
                          <div className="field"><label>To Date</label><input className="inline-input" type="date" value={filters.interview_to} onChange={(e) => setFilters((prev) => ({ ...prev, interview_to: e.target.value }))} /></div>
                        </div>
                        <div className="field top-gap-small"><label>Quick View</label>
                          <div className="choice-chip-row">
                            <button type="button" className={`choice-chip bounceable ${filters.interview_mode === 'previous' ? 'active' : ''}`} onClick={() => setFilters((prev) => ({ ...prev, interview_mode: prev.interview_mode === 'previous' ? '' : 'previous' }))}>Previous</button>
                            <button type="button" className={`choice-chip bounceable ${filters.interview_mode === 'upcoming' ? 'active' : ''}`} onClick={() => setFilters((prev) => ({ ...prev, interview_mode: prev.interview_mode === 'upcoming' ? '' : 'upcoming' }))}>Upcoming</button>
                          </div>
                        </div>
                        <div className="field top-gap-small"><label>Days</label><input className="inline-input" type="number" min="1" value={filters.interview_days} onChange={(e) => setFilters((prev) => ({ ...prev, interview_days: e.target.value }))} placeholder="Example: 7" /></div>
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
