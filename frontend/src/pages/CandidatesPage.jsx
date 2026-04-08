import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePolling } from '../lib/usePolling';
import { addWhatsAppTemplate, getWhatsAppTemplates } from '../lib/templateStore';
import { dialCandidateWithLog, openWhatsAppWithLog, shouldMaskPhone, visiblePhone } from '../lib/candidateAccess';

function EyeIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M2.4 12s3.4-6 9.6-6 9.6 6 9.6 6-3.4 6-9.6 6-9.6-6-9.6-6Z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.9" /></svg>;
}
function PhoneIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7.4 3.8h2.1c.5 0 .9.3 1.1.8l1.1 3.1c.2.5 0 1.1-.4 1.4L9.8 10.4a13.2 13.2 0 0 0 3.8 3.8l1.3-1.5c.3-.4.9-.6 1.4-.4l3.1 1.1c.5.2.8.6.8 1.1v2.1c0 .7-.6 1.3-1.3 1.3A15.9 15.9 0 0 1 6.1 5.1c0-.7.6-1.3 1.3-1.3Z" fill="currentColor" /></svg>;
}
function WhatsAppIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M19.1 4.8A9.7 9.7 0 0 0 3.8 16.7L2.7 21.3l4.8-1.1a9.7 9.7 0 0 0 4.5 1.1h.1a9.7 9.7 0 0 0 7-16.5Zm-7 14.8h-.1a7.9 7.9 0 0 1-4-1.1l-.3-.2-2.8.7.7-2.7-.2-.3a7.9 7.9 0 1 1 6.7 3.6Z" fill="currentColor" /><path d="M16.5 13.8c-.2-.1-1.3-.7-1.5-.7-.2-.1-.3-.1-.5.1l-.4.5c-.1.2-.3.2-.5.1-.2-.1-.8-.3-1.5-1a5.5 5.5 0 0 1-1-1.2c-.1-.2 0-.3.1-.4l.3-.4.2-.4c.1-.1 0-.3 0-.4l-.7-1.6c-.2-.4-.3-.3-.5-.3h-.4c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 1.9 0 1 .8 2.1.9 2.3.1.1 1.7 2.6 4 3.6 2.4 1 2.4.7 2.8.7.4-.1 1.3-.5 1.5-1 .2-.4.2-.9.2-1 0-.1-.2-.2-.4-.3Z" fill="currentColor" /></svg>;
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
function FilterIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
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
function BackIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function ArrowIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

const defaultFilters = {
  q: '',
  sr_from: '', sr_to: '',
  submission_from: '', submission_to: '',
  interview_from: '', interview_to: '',
  salary_from: '', salary_to: '',
  total_exp_from: '', total_exp_to: '',
  relevant_exp_from: '', relevant_exp_to: '',
  name: [], phone: [], location: [], qualification: [], recruiter_code: [], preferred_location: [], communication_skill: [], process: [], all_details_sent: [], status: [], approval_status: [], virtual_onsite: [], documents_availability: [], call_connected: [], manager_crm: [], submitted_by: [], career_gap: [], relevant_experience_range: [], relevant_in_hand_range: [], bucket_view: 'all'
};

const FILTER_PRESET_STORAGE_KEY = 'careerCroxCandidateFilterPresets';

function splitValues(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}
function buildInitialFilters(searchParams) {
  const next = { ...defaultFilters };
  Object.entries(defaultFilters).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      next[key] = searchParams.getAll(key).map((item) => String(item || '').trim()).filter(Boolean);
      return;
    }
    const found = searchParams.get(key);
    if (found !== null) next[key] = found;
  });
  return next;
}
function containsText(value, q) {
  return String(value || '').toLowerCase().includes(String(q || '').toLowerCase());
}
function normalizeId(value) {
  return String(value || '').trim();
}
function numericTail(value) {
  const match = String(value || '').match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}
function inRange(value, from, to) {
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  if (String(from).trim() !== '' && n < Number(from)) return false;
  if (String(to).trim() !== '' && n > Number(to)) return false;
  return true;
}
function uniqueOptions(rows, getter, split = false) {
  return Array.from(new Set(rows.flatMap((row) => {
    const value = getter(row);
    if (Array.isArray(value)) return value.filter(Boolean);
    return split ? splitValues(value) : [String(value || '').trim()].filter(Boolean);
  }))).sort((a, b) => String(a).localeCompare(String(b)));
}
function optionSummary(filters, key, rangeKeys = []) {
  if (rangeKeys.length) {
    const count = rangeKeys.filter((item) => String(filters[item] || '').trim()).length;
    return count ? `${count} set` : 'All';
  }
  const values = filters[key] || [];
  if (!values.length) return 'All';
  if (values.length === 1) return values[0];
  return `${values.length} selected`;
}
function toggleArrayValue(filters, key, value) {
  const current = filters[key] || [];
  return current.includes(value)
    ? { ...filters, [key]: current.filter((item) => item !== value) }
    : { ...filters, [key]: [...current, value] };
}

function readSavedFilterPresets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FILTER_PRESET_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function countSelectedForSection(section, filters) {
  if (!section) return 0;
  if (section.type === 'options') return (filters[section.key] || []).length;
  return [filters[section.from], filters[section.to]].filter((item) => String(item || '').trim()).length;
}
function filtersHaveAnyValue(filters) {
  return Object.entries(filters || {}).some(([key, value]) => {
    if (key === 'bucket_view') return false;
    if (key === 'q') return String(value || '').trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return String(value || '').trim().length > 0;
  });
}

function buildCandidateQuery(filters, page = 1, pageSize = 10) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.filter(Boolean).forEach((item) => params.append(key, String(item)));
      return;
    }
    if (String(value ?? '').trim()) params.set(key, String(value));
  });
  return params.toString();
}

function formatBucketDate(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}
function formatShortDate(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  return String(value).slice(0, 10) || '-';
}
function toneForBucket(stage) {
  if (stage === 'last_day' || stage === 'bucket_out') return 'danger';
  if (stage === 'warning') return 'warn';
  if (stage === 'fresh') return 'info';
  if (stage === 'followup') return 'follow';
  return 'safe';
}
function priorityTone(priority) {
  const value = String(priority || '').toLowerCase();
  if (value === 'urgent' || value === 'expired') return 'priority-urgent';
  if (value === 'high') return 'priority-high';
  if (value === 'done') return 'priority-done';
  return 'priority-normal';
}

export default function CandidatesPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const leadership = ['admin', 'manager', 'tl'].includes(String(user?.role || '').toLowerCase());
  const [allRows, setAllRows] = useState([]);
  const [filterRows, setFilterRows] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [summary, setSummary] = useState({});
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [filters, setFilters] = useState(() => buildInitialFilters(searchParams));
  const [message, setMessage] = useState('');
  const [waTemplates, setWaTemplates] = useState(getWhatsAppTemplates());
  const [selectedIds, setSelectedIds] = useState([]);
  const [dialerOpen, setDialerOpen] = useState(false);
  const [dialerIndex, setDialerIndex] = useState(0);
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);
  const [optionSearches, setOptionSearches] = useState({});
  const [activeFilterKey, setActiveFilterKey] = useState('name');
  const [savedFilters, setSavedFilters] = useState(() => readSavedFilterPresets());
  const [presetName, setPresetName] = useState('');

  async function load(targetPage = page, nextFilters = filters) {
    const qs = buildCandidateQuery(nextFilters, targetPage, pageSize);
    const data = await api.get(`/api/candidates?${qs}`);
    setAllRows(data.items || []);
    setFilterRows(data.filter_source_rows || []);
    setTotalRows(Number(data.total || 0));
    setSummary(data.summary || {});
    setPage(Number(data.page || targetPage || 1));
  }

  useEffect(() => { load(1, filters).catch(() => {}); }, []);
  usePolling(() => load(page, filters), 7000, [page, JSON.stringify(filters)]);

  const optionSourceRows = useMemo(() => (filterRows.length ? filterRows : allRows), [filterRows, allRows]);
  const recruiterOptions = useMemo(() => uniqueOptions(optionSourceRows, (row) => row.recruiter_code), [optionSourceRows]);

  const filterSections = useMemo(() => {
    const sections = [
      { key: 'sr', label: 'Sr. No.', type: 'range', from: 'sr_from', to: 'sr_to' },
      { key: 'name', label: 'Name', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.full_name) },
      ...(shouldMaskPhone(user) ? [] : [{ key: 'phone', label: 'Phone', type: 'options', options: uniqueOptions(optionSourceRows, (row) => visiblePhone(user, row.phone, '')) }]),
      { key: 'location', label: 'Candidate location', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.location, true) },
      { key: 'qualification', label: 'Qualification', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.qualification || row.qualification_level) },
      { key: 'recruiter_code', label: 'Recruiter code', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.recruiter_code) },
      { key: 'preferred_location', label: 'Preferred Location', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.preferred_location, true) },
      { key: 'salary', label: 'In-Hand Salary', type: 'range', from: 'salary_from', to: 'salary_to' },
      { key: 'relevant_exp', label: 'Relevant Experience', type: 'range', from: 'relevant_exp_from', to: 'relevant_exp_to' },
      { key: 'total_exp', label: 'Total Experience', type: 'range', from: 'total_exp_from', to: 'total_exp_to' },
      { key: 'communication_skill', label: 'Communication Skill', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.communication_skill) },
      { key: 'career_gap', label: 'Career Gap', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.career_gap) },
      { key: 'relevant_experience_range', label: 'Relevant Exp Range', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.relevant_experience_range) },
      { key: 'relevant_in_hand_range', label: 'Relevant In-hand Range', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.relevant_in_hand_range) },
      { key: 'process', label: 'Process', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.process, true) },
      { key: 'submission_date', label: 'Submission Date', type: 'date-range', from: 'submission_from', to: 'submission_to' },
      { key: 'interview_date', label: 'Interview date', type: 'date-range', from: 'interview_from', to: 'interview_to' },
      { key: 'virtual_onsite', label: 'Virtual / Onsite', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.virtual_onsite) },
      { key: 'all_details_sent', label: 'ALL Details sent', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.all_details_sent) },
      { key: 'call_connected', label: 'call connected', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.call_connected) },
      { key: 'documents_availability', label: 'All Documents Availablebility', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.documents_availability) },
      { key: 'manager_crm', label: "Manager's CRM", type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.manager_crm) },
      { key: 'submitted_by', label: 'submitted by', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.submitted_by) },
      { key: 'status', label: 'Status', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.status) },
      { key: 'approval_status', label: 'Approved by Manager', type: 'options', options: uniqueOptions(optionSourceRows, (row) => row.approval_status) },
    ];
    return sections;
  }, [optionSourceRows]);

  const activeFilterSection = useMemo(() => filterSections.find((section) => section.key === activeFilterKey) || filterSections[0] || null, [filterSections, activeFilterKey]);
  const activeOptionSearch = optionSearches[activeFilterSection?.key] || '';
  const activeVisibleOptions = useMemo(() => {
    if (!activeFilterSection || activeFilterSection.type !== 'options') return [];
    return (activeFilterSection.options || []).filter((item) => containsText(item, activeOptionSearch));
  }, [activeFilterSection, activeOptionSearch]);
  const mostUsedPresets = useMemo(() => {
    return [...savedFilters]
      .sort((a, b) => (b.use_count || 0) - (a.use_count || 0) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
      .slice(0, 5);
  }, [savedFilters]);

  useEffect(() => {
    try { localStorage.setItem(FILTER_PRESET_STORAGE_KEY, JSON.stringify(savedFilters)); } catch {}
  }, [savedFilters]);

  useEffect(() => {
    if (!activeFilterSection && filterSections[0]) setActiveFilterKey(filterSections[0].key);
  }, [activeFilterSection, filterSections]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load(1, filters).catch(() => {});
    }, 220);
    return () => window.clearTimeout(timer);
  }, [JSON.stringify(filters)]);

  const filteredRows = allRows;
  const visibleRowIds = useMemo(() => Array.from(new Set(filteredRows.map((row) => normalizeId(row.candidate_id)).filter(Boolean))), [filteredRows]);

  const selectedRows = useMemo(() => {
    const picked = new Set(selectedIds.map(normalizeId));
    return filteredRows.filter((row) => picked.has(normalizeId(row.candidate_id)));
  }, [filteredRows, selectedIds]);
  const currentDialerTarget = selectedRows[dialerIndex] || selectedRows[0] || null;
  const allSelected = visibleRowIds.length > 0 && visibleRowIds.every((id) => selectedIds.includes(id));
  const activeFilterCount = useMemo(() => {
    return Object.entries(filters).reduce((count, [key, value]) => {
      if (key === 'bucket_view') return count;
      if (key === 'q') return count + (String(value || '').trim() ? 1 : 0);
      if (Array.isArray(value)) return count + value.length;
      return count + (String(value || '').trim() ? 1 : 0);
    }, 0);
  }, [filters]);

  const bucketCards = useMemo(() => (leadership ? [
    { key: 'all', label: 'Total Profiles', value: summary.total_visible || 0, note: `${summary.allocated_profiles || 0} allocated live`, tone: 'blue' },
    { key: 'fresh', label: 'Fresh Profile', value: summary.fresh_profiles || 0, note: 'Never called yet', tone: 'green' },
    { key: 'allocated', label: 'Allocated', value: summary.allocated_profiles || 0, note: 'Active recruiter buckets', tone: 'teal' },
    { key: 'followup_due', label: 'Follow Up Due', value: summary.pending_followups || 0, note: `${summary.followup_profiles || 0} total follow ups`, tone: 'purple' },
    { key: 'warning', label: 'Warning', value: summary.warning_profiles || 0, note: '2-3 days left', tone: 'orange' },
    { key: 'last_day', label: 'Last Day', value: summary.last_day_profiles || 0, note: 'Call first', tone: 'red' },
  ] : [
    { key: 'all', label: 'Total Bucket', value: `${summary.active_bucket || 0}/70`, note: 'Active allocated', tone: 'blue' },
    { key: 'fresh', label: 'Fresh Profile', value: summary.fresh_profiles || 0, note: 'Never called', tone: 'green' },
    { key: 'followup', label: 'Follow Up', value: summary.followup_profiles || 0, note: 'Need callback', tone: 'purple' },
    { key: 'warning', label: 'Warning', value: summary.warning_profiles || 0, note: '2-3 days left', tone: 'orange' },
    { key: 'last_day', label: 'Last Day', value: summary.last_day_profiles || 0, note: 'Call first', tone: 'red' },
  ]), [summary, leadership]);

  const quickFilters = useMemo(() => (leadership ? [
    ['all', 'All Profiles'],
    ['fresh', 'Fresh Profile'],
    ['allocated', 'Allocated'],
    ['followup_due', 'Follow Up Due'],
    ['warning', 'Warning'],
    ['last_day', 'Last Day'],
  ] : [
    ['all', 'All Profiles'],
    ['fresh', 'Fresh Profile'],
    ['followup', 'Follow Up'],
    ['days_1', '1 Day Left'],
    ['days_2', '2 Days Left'],
    ['days_3', '3 Days Left'],
    ['days_4_plus', '4+ Days'],
    ['warning', 'Warning'],
    ['last_day', 'Last Day'],
  ]), [leadership]);

  useEffect(() => {
    setSelectedIds((prev) => prev.map(normalizeId).filter((id) => visibleRowIds.includes(id)));
  }, [visibleRowIds]);

  useEffect(() => {
    if (!selectedRows.length) {
      setDialerOpen(false);
      setDialerIndex(0);
      return;
    }
    if (dialerIndex >= selectedRows.length) setDialerIndex(0);
  }, [selectedRows.length, dialerIndex]);

  async function dialCandidate(candidateId, phone) {
    dialCandidateWithLog(candidateId, phone);
  }

  function openWhatsApp(candidateId, phone, template = '') {
    openWhatsAppWithLog(candidateId, phone, template);
  }

  function onTemplatePick(row, value) {
    if (!value) return;
    if (value === '__add_new__') {
      const fresh = window.prompt('Type new WhatsApp template');
      if (fresh) setWaTemplates(addWhatsAppTemplate(fresh));
      return;
    }
    openWhatsApp(row.candidate_id, row.phone, value);
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
    const id = normalizeId(candidateId);
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]);
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => allSelected ? prev.filter((id) => !visibleRowIds.includes(id)) : Array.from(new Set([...prev, ...visibleRowIds])));
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

  function resetFilters() {
    setFilters((current) => ({ ...defaultFilters, q: current.q, bucket_view: 'all' }));
    setOptionSearches({});
  }

  function clearCurrentSection(section) {
    if (!section) return resetFilters();
    if (section.type === 'options') setFilters((prev) => ({ ...prev, [section.key]: [] }));
    else setFilters((prev) => ({ ...prev, [section.from]: '', [section.to]: '' }));
    setOptionSearches((prev) => ({ ...prev, [section.key]: '' }));
  }

  function saveCurrentPreset() {
    if (!filtersHaveAnyValue(filters)) {
      setMessage('Select at least one filter before saving.');
      return;
    }
    const name = String(presetName || '').trim() || `Filter ${savedFilters.length + 1}`;
    const existing = savedFilters.find((item) => String(item.name || '').toLowerCase() === name.toLowerCase());
    const nextItem = {
      id: existing?.id || `flt_${Date.now()}`,
      name,
      filters,
      use_count: existing?.use_count || 0,
      updated_at: new Date().toISOString(),
    };
    const next = existing
      ? savedFilters.map((item) => item.id === existing.id ? nextItem : item)
      : [nextItem, ...savedFilters].slice(0, 20);
    setSavedFilters(next);
    setPresetName('');
    setMessage(`Filter "${name}" saved successfully.`);
  }

  function applyPreset(preset) {
    if (!preset?.filters) return;
    setFilters({ ...defaultFilters, ...preset.filters });
    const next = savedFilters.map((item) => item.id === preset.id ? { ...item, use_count: Number(item.use_count || 0) + 1, updated_at: new Date().toISOString() } : item);
    setSavedFilters(next);
    const firstUsedSection = filterSections.find((section) => countSelectedForSection(section, { ...defaultFilters, ...preset.filters }) > 0) || filterSections[0];
    if (firstUsedSection) setActiveFilterKey(firstUsedSection.key);
    setMessage(`Filter "${preset.name}" applied successfully.`);
  }

  function deletePreset(presetId) {
    setSavedFilters((prev) => prev.filter((item) => item.id !== presetId));
  }

  function setBucketView(bucketView) {
    setPage(1);
    setFilters((prev) => ({ ...prev, bucket_view: bucketView }));
  }


return (
  <Layout title="Candidates" subtitle="Manage confidential candidate records, approvals, and direct contact actions.">
    {!!message && <div className="panel top-gap-small"><div className="helper-text">{message}</div></div>}

    <div className="bucket-card-grid top-gap-small fade-up">
      <div className="stat-card bucket-click-card blue active">
        <span>Total Profiles</span>
        <strong>{summary.total_visible || totalRows || 0}</strong>
        <small>Visible inside your permitted scope</small>
      </div>
      <div className="stat-card bucket-click-card purple">
        <span>Pending Approval</span>
        <strong>{allRows.filter((row) => String(row.approval_status || '').toLowerCase() === 'pending').length}</strong>
        <small>Profiles waiting in submission flow</small>
      </div>
      <div className="stat-card bucket-click-card orange">
        <span>Interviews Set</span>
        <strong>{allRows.filter((row) => String(row.interview_reschedule_date || '').trim()).length}</strong>
        <small>Profiles with interview date</small>
      </div>
      <div className="stat-card bucket-click-card green">
        <span>Follow Ups</span>
        <strong>{allRows.filter((row) => String(row.follow_up_at || '').trim()).length}</strong>
        <small>Profiles with follow-up date</small>
      </div>
    </div>

    <div className="table-panel top-gap-small glassy-card fade-up bucket-toolbar-panel">
      <div className="table-toolbar no-wrap-toolbar bucket-toolbar-stack">
        <div>
          <div className="table-title">Candidate Tracker</div>
          <div className="helper-text">Bucket, bucket out, last day, warning, and expiry logic are removed here. Every profile stays with its owner unless a manager changes it.</div>
        </div>
        <div className="toolbar-actions compact-pills candidate-toolbar-actions bucket-head-actions">
          <span className="metric-mini-chip records">{totalRows} records</span>
          {activeFilterCount ? <span className="metric-mini-chip filters">{activeFilterCount} filters</span> : null}
          {leadership ? (
            <label className="compact-select-shell shell-sky candidate-recruiter-shell">
              <span className="compact-shell-label">Recruiter</span>
              <select className="inline-input compact-inline-input bucket-target-select" value={(filters.recruiter_code || [])[0] || ''} onChange={(e) => setFilters((prev) => ({ ...prev, recruiter_code: e.target.value ? [e.target.value] : [] }))}>
                <option value="">All Recruiters</option>
                {recruiterOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          ) : null}
          <button type="button" className="ghost-btn bounceable modern-filter-btn gradient-action-btn gradient-slate" onClick={() => { setShowFilterDrawer(true); }}><FilterIcon /> Filters</button>
        </div>
      </div>

      <div className="candidate-master-row">
        <button type="button" className={`selection-master-pill bounceable ${allSelected ? 'active' : ''}`} onClick={toggleSelectAll}>
          <span className="selection-master-icon"><SelectAllIcon /></span>
          {allSelected ? 'Clear All' : 'Select All'}
        </button>
        <span className="selection-count-chip">{selectedIds.length} selected</span>
        <button type="button" className={`open-dialer-pill bounceable ${selectedRows.length ? 'active' : ''}`} onClick={() => setDialerOpen((prev) => selectedRows.length ? !prev : false)} disabled={!selectedRows.length}>
          <DialerIcon /> Open Dialer
        </button>
        {selectedRows.length ? <button type="button" className="ghost-btn bounceable" onClick={clearSelection}>Clear Selection</button> : null}
      </div>

      {dialerOpen && currentDialerTarget ? (
        <div className="floating-dialer show top-gap-small">
          <div className="dialer-head">
            <div>
              <h3 className="dialer-title">Dialer</h3>
              <div className="helper-text">{selectedRows.length} selected • {dialerIndex + 1} / {selectedRows.length}</div>
            </div>
            <button type="button" className="mini-btn ghost bounceable" onClick={() => setDialerOpen(false)} title="Close Dialer"><CloseIcon /></button>
          </div>

          <div className="dialer-now">
            <div className="helper-text">Current target</div>
            {currentDialerTarget.full_name} • {visiblePhone(user, currentDialerTarget.phone || '')}
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

      <div className="crm-table-wrap dense-wrap top-gap-small">
        <table className="crm-table colorful-table dense-table">
          <thead>
            <tr>
              <th style={{ width: 84 }}>
                <button type="button" className={`table-master-check ${allSelected ? 'active' : ''}`} onClick={toggleSelectAll} title={allSelected ? 'Clear All' : 'Select All'}>
                  <CheckIcon />
                </button>
              </th>
              <th>Candidate ID</th>
              <th>Name</th>
              <th>Number</th>
              <th>Location</th>
              <th>Qualification</th>
              <th>Status</th>
              <th>Approval</th>
              <th>Follow Up</th>
              <th>Interview</th>
              <th className="sticky-action-col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              const selected = selectedIds.includes(normalizeId(row.candidate_id));
              const approvalPending = String(row.approval_status || '').toLowerCase() === 'pending';
              return (
                <tr key={row.candidate_id} className={`clickable-row ${selected ? 'selected-row' : ''}`} onClick={() => navigate(`/candidate/${row.candidate_id}`)}>
                  <td>
                    <button type="button" className={`row-check-btn bounceable ${selected ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); toggleSelection(row.candidate_id); }} title={selected ? 'Selected' : 'Select candidate'}>
                      <CheckIcon />
                    </button>
                    <div className="subtle top-gap-small">{row.candidate_id}</div>
                  </td>
                  <td><strong>{row.full_name}</strong><br /><span className="subtle">{row.process || row.recruiter_name || '-'}</span></td>
                  <td>{visiblePhone(user, row.phone)}</td>
                  <td>{row.location || row.preferred_location || '-'}</td>
                  <td>{row.qualification || row.qualification_level || '-'}</td>
                  <td><span className={`bucket-status-chip ${approvalPending ? 'warn' : 'safe'}`}>{row.status || '-'}</span></td>
                  <td><span className={`bucket-status-chip ${approvalPending ? 'warn' : 'safe'}`}>{row.approval_status || 'Draft'}</span></td>
                  <td>{formatShortDate(row.follow_up_at)}</td>
                  <td>{formatShortDate(row.interview_reschedule_date)}</td>
                  <td className="sticky-actions-cell">
                    <div className="row-actions nowrap-actions compact-row-actions">
                      <Link className="mini-btn call bounceable modern-icon-btn modern-eye-btn" to={`/candidate/${row.candidate_id}`} onClick={(e) => e.stopPropagation()} title="Open Profile"><EyeIcon /></Link>
                      <button className="mini-btn view bounceable modern-icon-btn modern-call-btn" type="button" title="Dial Call" onClick={(e) => { e.stopPropagation(); dialCandidate(row.candidate_id, row.phone); }}><PhoneIcon /></button>
                      <button className="mini-btn edit bounceable modern-icon-btn modern-wa-btn" type="button" title="Open WhatsApp" onClick={(e) => { e.stopPropagation(); openWhatsApp(row.candidate_id, row.phone, ''); }}><WhatsAppIcon /></button>
                      <select className="wa-template-select mini-wa-template-select" defaultValue="" onClick={(e) => e.stopPropagation()} onChange={(e) => { onTemplatePick(row, e.target.value); e.target.value = ''; }}>
                        <option value="">Template</option>
                        {waTemplates.map((tpl) => <option key={tpl} value={tpl}>{tpl.slice(0, 44)}</option>)}
                        <option value="__add_new__">Add New...</option>
                      </select>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredRows.length === 0 && <tr><td colSpan="11" className="helper-text">No candidates found.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="row-actions top-gap-small" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="helper-text">Page {page} • Showing {filteredRows.length} of {totalRows}</div>
        <div className="row-actions">
          <button type="button" className="ghost-btn bounceable" disabled={page <= 1} onClick={() => load(page - 1, filters)}>Previous 10</button>
          <button type="button" className="add-profile-btn bounceable" disabled={(page * pageSize) >= totalRows} onClick={() => load(page + 1, filters)}>Next 10</button>
        </div>
      </div>

    </div>

      {showFilterDrawer && (
        <div className="crm-modal-backdrop candidate-drawer-backdrop wide" onClick={() => setShowFilterDrawer(false)}>
          <div className="candidate-filter-modal" onClick={(e) => e.stopPropagation()}>
            <div className="candidate-filter-modal-head">
              <div>
                <div className="candidate-filter-modal-title"><FilterIcon /> Advanced Candidate Filters</div>
                <div className="helper-text">Select filters, review values, and apply changes without leaving this page.</div>
              </div>
              <div className="candidate-filter-head-actions">
                {activeFilterCount ? <span className="mini-chip live-chip">{activeFilterCount} active</span> : <span className="mini-chip">No active filters</span>}
                <button type="button" className="ghost-btn bounceable" onClick={resetFilters}>Clear All</button>
                <button type="button" className="add-profile-btn bounceable" onClick={() => setShowFilterDrawer(false)}>Done</button>
              </div>
            </div>
            <div className="candidate-filter-modal-body">
              <aside className="candidate-filter-sidebar">
                <div className="candidate-filter-save-card gradient-card blue">
                  <div className="candidate-filter-save-title">Most Used Filters</div>
                  <div className="candidate-preset-list">
                    {mostUsedPresets.length ? mostUsedPresets.map((preset) => (
                      <div key={preset.id} className="candidate-preset-item">
                        <button type="button" className="candidate-preset-apply" onClick={() => applyPreset(preset)}>
                          <strong>{preset.name}</strong>
                          <span>{preset.use_count || 0} uses</span>
                        </button>
                        <button type="button" className="candidate-preset-delete" onClick={() => deletePreset(preset.id)} title="Delete saved filter"><CloseIcon /></button>
                      </div>
                    )) : <div className="helper-text">No saved filters yet.</div>}
                  </div>
                </div>

                <div className="candidate-filter-save-card gradient-card violet top-gap-small">
                  <div className="candidate-filter-save-title">Save Current Filter</div>
                  <div className="field no-label-field">
                    <input className="inline-input" value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Filter name, like Noida Freshers" />
                  </div>
                  <button type="button" className="add-profile-btn bounceable full-width-btn" onClick={saveCurrentPreset}>Save Filter</button>
                </div>

                <div className="candidate-filter-nav top-gap-small">
                  {filterSections.map((section) => {
                    const selectedCount = countSelectedForSection(section, filters);
                    const isActive = activeFilterSection?.key === section.key;
                    return (
                      <button
                        key={section.key}
                        type="button"
                        className={`candidate-filter-nav-item ${isActive ? 'active' : ''} ${selectedCount ? 'selected' : ''}`}
                        onClick={() => setActiveFilterKey(section.key)}
                      >
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
                {activeFilterSection ? (
                  <>
                    <div className="candidate-filter-detail-head">
                      <div>
                        <div className="candidate-filter-detail-title">{activeFilterSection.label}</div>
                        <div className="candidate-filter-detail-sub">Select values directly here. Active selections are highlighted in green.</div>
                      </div>
                      <button type="button" className="ghost-btn bounceable candidate-inline-clear" onClick={() => clearCurrentSection(activeFilterSection)}>Clear</button>
                    </div>

                    {activeFilterSection.type === 'options' ? (
                      <>
                        <div className="field no-label-field">
                          <input
                            className="inline-input"
                            value={activeOptionSearch}
                            onChange={(e) => setOptionSearches((prev) => ({ ...prev, [activeFilterSection.key]: e.target.value }))}
                            placeholder={`Search ${activeFilterSection.label}`}
                          />
                        </div>
                        <div className="candidate-option-grid roomy two-col top-gap-small">
                          {activeVisibleOptions.map((item) => {
                            const checked = (filters[activeFilterSection.key] || []).includes(item);
                            return (
                              <label key={item} className={`candidate-option-card ${checked ? 'checked' : ''}`}>
                                <input type="checkbox" checked={checked} onChange={() => setFilters((prev) => toggleArrayValue(prev, activeFilterSection.key, item))} />
                                <span>{item}</span>
                              </label>
                            );
                          })}
                          {!activeVisibleOptions.length && <div className="helper-text">No options found.</div>}
                        </div>
                      </>
                    ) : (
                      <div className="candidate-range-row wider top-gap-small">
                        <div className="field">
                          <label>{activeFilterSection.type === 'date-range' ? 'From Date' : 'From'}</label>
                          <input className="inline-input" type={activeFilterSection.type === 'date-range' ? 'date' : 'number'} value={filters[activeFilterSection.from]} onChange={(e) => setFilters((prev) => ({ ...prev, [activeFilterSection.from]: e.target.value }))} />
                        </div>
                        <div className="field">
                          <label>{activeFilterSection.type === 'date-range' ? 'To Date' : 'To'}</label>
                          <input className="inline-input" type={activeFilterSection.type === 'date-range' ? 'date' : 'number'} value={filters[activeFilterSection.to]} onChange={(e) => setFilters((prev) => ({ ...prev, [activeFilterSection.to]: e.target.value }))} />
                        </div>
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
