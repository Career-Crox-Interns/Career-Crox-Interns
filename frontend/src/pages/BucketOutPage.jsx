import React, { useEffect, useMemo, useRef, useState } from 'react';
import { openCandidateProfileInNewTab } from '../lib/candidateNav';
import { clearViewState, readViewState, writeViewState } from '../lib/viewState';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePolling } from '../lib/usePolling';
import { visiblePhone } from '../lib/candidateAccess';

const EXP_BANDS = [
  { key: '', label: 'All Experience Range', from: '', to: '' },
  { key: '0-0', label: 'Fresher', from: '0', to: '0' },
  { key: '1-2', label: '1-2 Years', from: '1', to: '2' },
  { key: '3-5', label: '3-5 Years', from: '3', to: '5' },
  { key: '6+', label: '6+ Years', from: '6', to: '' },
];

const QUICK_FILTER_DEFS = [
  { key: 'recruiter_code', label: 'Recruiter Code', type: 'select' },
  { key: 'sr_range', label: 'Sr. Number', type: 'range' },
  { key: 'communication_skill', label: 'Communication', type: 'select' },
  { key: 'preferred_location', label: 'Preferred Location', type: 'select' },
  { key: 'qualification', label: 'Qualification', type: 'select' },
  { key: 'relevant_exp_band', label: 'Relevant Experience', type: 'select' },
  { key: 'salary_band', label: 'Inhand Salary', type: 'select' },
];

const BUCKET_VIEW_STATE_KEY = 'careerCroxBucketViewState_v1';

const SALARY_BANDS = [
  { key: '', label: 'All Salary Range', from: '', to: '' },
  { key: '0-15000', label: 'Up to 15k', from: '0', to: '15000' },
  { key: '15001-20000', label: '15k-20k', from: '15001', to: '20000' },
  { key: '20001-30000', label: '20k-30k', from: '20001', to: '30000' },
  { key: '30001+', label: '30k+', from: '30001', to: '' },
];

function CheckIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5.2 12.7 9.4 17l9.4-9.4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function FilterIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}
function normalizeId(value) {
  return String(value || '').trim();
}
function uniqueOptions(rows, getter, split = false) {
  return Array.from(new Set(rows.flatMap((row) => {
    const value = getter(row);
    if (Array.isArray(value)) return value.filter(Boolean);
    if (split) return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
    return [String(value || '').trim()].filter(Boolean);
  }))).sort((a, b) => String(a).localeCompare(String(b)));
}
function formatDate(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function toneForBucket(stage) {
  const value = String(stage || '').toLowerCase();
  if (value === 'bucket_out' || value === 'last_day') return 'danger';
  if (value === 'warning') return 'warn';
  if (value === 'followup') return 'follow';
  if (value === 'fresh') return 'info';
  return 'safe';
}
function buildQuery(filters, page = 1, pageSize = 10) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  params.set('bucket_view', filters.bucket_view || 'all');
  if (filters.recruiter_code) params.append('recruiter_code', filters.recruiter_code);
  if (filters.sr_from !== '') params.append('sr_from', filters.sr_from);
  if (filters.sr_to !== '') params.append('sr_to', filters.sr_to);
  if (filters.communication_skill) params.append('communication_skill', filters.communication_skill);
  if (filters.preferred_location) params.append('preferred_location', filters.preferred_location);
  if (filters.qualification) params.append('qualification', filters.qualification);
  const expBand = EXP_BANDS.find((item) => item.key === filters.relevant_exp_band);
  if (expBand) {
    if (expBand.from !== '') params.set('relevant_exp_from', expBand.from);
    if (expBand.to !== '') params.set('relevant_exp_to', expBand.to);
  }
  const salaryBand = SALARY_BANDS.find((item) => item.key === filters.salary_band);
  if (salaryBand) {
    if (salaryBand.from !== '') params.set('salary_from', salaryBand.from);
    if (salaryBand.to !== '') params.set('salary_to', salaryBand.to);
  }
  return params.toString();
}

export default function BucketOutPage() {
  const storedViewState = readViewState(BUCKET_VIEW_STATE_KEY, {});
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);
  const [activeFilterKey, setActiveFilterKey] = useState(storedViewState.activeFilterKey || 'recruiter_code');
  const [visibleQuickFilters, setVisibleQuickFilters] = useState(Array.isArray(storedViewState.visibleQuickFilters) && storedViewState.visibleQuickFilters.length ? storedViewState.visibleQuickFilters : ['recruiter_code', 'sr_range']);
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [filterRows, setFilterRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [selectedIds, setSelectedIds] = useState([]);
  const [targets, setTargets] = useState([]);
  const [targetUserId, setTargetUserId] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(Number(storedViewState.page || 1) || 1);
  const [pageJumpValue, setPageJumpValue] = useState('1');
  const [pageSize, setPageSize] = useState(10);
  const [filters, setFilters] = useState(() => ({
    bucket_view: 'all',
    recruiter_code: '',
    sr_from: '',
    sr_to: '',
    communication_skill: '',
    preferred_location: '',
    qualification: '',
    relevant_exp_band: '',
    salary_band: '',
    ...(storedViewState.filters || {}),
  }));

  const userRole = String(user?.role || '').toLowerCase();
  const canManage = ['admin', 'manager'].includes(userRole);
  const canViewUnallocated = ['admin', 'manager', 'tl'].includes(userRole);
  const isManager = canManage;
  const lastSelectedIndexRef = useRef(-1);

  async function load(nextPage = page, nextFilters = filters) {
    const data = await api.get(`/api/candidates?${buildQuery(nextFilters, nextPage, pageSize)}`);
    setRows(data.items || []);
    setFilterRows(data.filter_source_rows || []);
    setSummary(data.summary || {});
    setTotalRows(Number(data.total || 0));
    setPage(Number(data.page || nextPage || 1));
  }

  function normalizeTargetItems(items = []) {
    const seen = new Set();
    return (items || [])
      .map((item) => {
        const role = String(item?.role || item?.designation || '').trim().toLowerCase();
        const normalizedRole = role.includes('admin')
          ? 'admin'
          : (role === 'tl' || role.includes('team lead') || role.includes('teamlead'))
            ? 'tl'
            : role.includes('manager')
              ? 'manager'
              : role.includes('recruit')
                ? 'recruiter'
                : '';
        const userId = String(item?.user_id || item?.id || item?.username || item?.recruiter_code || '').trim();
        if (!normalizedRole || !userId) return null;
        const key = `${userId}__${normalizedRole}`;
        if (seen.has(key)) return null;
        seen.add(key);
        return {
          user_id: userId,
          full_name: String(item?.full_name || item?.username || item?.recruiter_code || userId).trim(),
          role: normalizedRole,
          recruiter_code: String(item?.recruiter_code || '').trim(),
          designation: String(item?.designation || item?.role || '').trim(),
        };
      })
      .filter(Boolean)
      .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
  }

  async function loadTargets() {
    if (!user?.user_id || !canManage) {
      setTargets([]);
      return;
    }
    try {
      const data = await api.get('/api/candidates/reassign-targets');
      const normalized = normalizeTargetItems(data.items || []);
      if (normalized.length) {
        setTargets(normalized);
        return;
      }
      const fallback = await api.get('/api/ui/lookups');
      setTargets(normalizeTargetItems(fallback.users || []));
    } catch {
      try {
        const fallback = await api.get('/api/ui/lookups');
        setTargets(normalizeTargetItems(fallback.users || []));
      } catch {
        setTargets([]);
      }
    }
  }

  useEffect(() => {
    if (!user?.user_id) return;
    load(page, filters).catch(() => {});
  }, [user?.user_id]);

  useEffect(() => { setPageJumpValue(String(page || 1)); }, [page]);

  useEffect(() => {
    if (!user?.user_id) return;
    load(1, filters).catch(() => {});
  }, [pageSize]);

  useEffect(() => {
    writeViewState(BUCKET_VIEW_STATE_KEY, {
      page,
      filters,
      activeFilterKey,
      visibleQuickFilters,
    });
  }, [page, filters, activeFilterKey, visibleQuickFilters]);

  useEffect(() => {
    if (!user?.user_id) return;
    loadTargets().catch(() => {});
  }, [user?.user_id, user?.role, canManage]);
  useEffect(() => {
    const timer = window.setTimeout(() => { load(1, filters).catch(() => {}); }, 180);
    return () => window.clearTimeout(timer);
  }, [JSON.stringify(filters)]);
  usePolling(() => load(page, filters), 180000, [page, JSON.stringify(filters)]);


  useEffect(() => {
    if (filters.bucket_view !== 'all') return;
    if (rows.length) return;
    const expiredCount = Number(summary?.all_bucket_out_profiles || summary?.bucket_out_profiles || 0);
    if (!expiredCount) return;
    setFilters((prev) => (prev.bucket_view === 'all' ? { ...prev, bucket_view: 'all_bucket_out_profiles' } : prev));
    setMessage(`Active bucket empty tha, isliye expired profiles view khol diya. Total bucket-out profiles: ${expiredCount}.`);
  }, [filters.bucket_view, rows.length, summary?.all_bucket_out_profiles, summary?.bucket_out_profiles]);

  const optionSourceRows = useMemo(() => (filterRows.length ? filterRows : rows), [filterRows, rows]);
  const recruiterOptions = useMemo(() => uniqueOptions(optionSourceRows, (row) => row.recruiter_code), [optionSourceRows]);
  const communicationOptions = useMemo(() => uniqueOptions(optionSourceRows, (row) => row.communication_skill), [optionSourceRows]);
  const preferredLocationOptions = useMemo(() => uniqueOptions(optionSourceRows, (row) => row.preferred_location, true), [optionSourceRows]);
  const qualificationOptions = useMemo(() => uniqueOptions(optionSourceRows, (row) => row.qualification || row.qualification_level), [optionSourceRows]);

  const quickFilterDefs = useMemo(() => QUICK_FILTER_DEFS, []);
  const hiddenQuickFilterDefs = useMemo(() => quickFilterDefs.filter((item) => !visibleQuickFilters.includes(item.key)), [quickFilterDefs, visibleQuickFilters]);
  const visibleQuickFilterDefs = useMemo(() => quickFilterDefs.filter((item) => visibleQuickFilters.includes(item.key)), [quickFilterDefs, visibleQuickFilters]);
  const activeQuickFilter = useMemo(() => quickFilterDefs.find((item) => item.key === activeFilterKey) || quickFilterDefs[0], [quickFilterDefs, activeFilterKey]);

  function addQuickFilter(key) {
    if (!key) return;
    setVisibleQuickFilters((prev) => prev.includes(key) ? prev : [...prev, key]);
    setActiveFilterKey(key);
  }
  function removeQuickFilter(key) {
    setVisibleQuickFilters((prev) => prev.filter((item) => item !== key));
    if (activeFilterKey === key) {
      const fallback = quickFilterDefs.find((item) => item.key !== key && visibleQuickFilters.includes(item.key));
      if (fallback) setActiveFilterKey(fallback.key);
    }
  }
  function optionListForFilter(key) {
    if (key == 'recruiter_code') return recruiterOptions;
    if (key == 'sr_range') return [];
    if (key == 'communication_skill') return communicationOptions;
    if (key == 'preferred_location') return preferredLocationOptions;
    if (key == 'qualification') return qualificationOptions;
    if (key == 'relevant_exp_band') return EXP_BANDS.map((item) => item.label);
    if (key == 'salary_band') return SALARY_BANDS.map((item) => item.label);
    return [];
  }
  function activeFilterOptionSelected(key, item) {
    if (key === 'relevant_exp_band') return (EXP_BANDS.find((band) => band.key === filters.relevant_exp_band)?.label || '') === item;
    if (key === 'salary_band') return (SALARY_BANDS.find((band) => band.key === filters.salary_band)?.label || '') === item;
    return String(filters[key] || '') === String(item || '');
  }
  function setActiveFilterOption(key, item) {
    if (key === 'relevant_exp_band') {
      const found = EXP_BANDS.find((band) => band.label === item);
      updateFilter('relevant_exp_band', found?.key || '');
      return;
    }
    if (key === 'salary_band') {
      const found = SALARY_BANDS.find((band) => band.label === item);
      updateFilter('salary_band', found?.key || '');
      return;
    }
    updateFilter(key, item);
  }
  const visibleRowIds = useMemo(() => Array.from(new Set(rows.map((row) => normalizeId(row.candidate_id)).filter(Boolean))), [rows]);
  const allSelected = visibleRowIds.length > 0 && visibleRowIds.every((id) => selectedIds.includes(id));
  const selectedRows = useMemo(() => {
    const picked = new Set(selectedIds.map(normalizeId));
    return rows.filter((row) => picked.has(normalizeId(row.candidate_id)));
  }, [rows, selectedIds]);
  const selectedEligibleIds = useMemo(() => selectedRows.map((row) => normalizeId(row.candidate_id)), [selectedRows]);

  useEffect(() => {
    setSelectedIds((prev) => prev.map(normalizeId).filter((id) => visibleRowIds.includes(id)));
  }, [visibleRowIds]);

  function toggle(id, rowIndex, shiftKey = false) {
    const cleanId = normalizeId(id);
    if (shiftKey && lastSelectedIndexRef.current >= 0 && rowIndex >= 0) {
      const start = Math.min(lastSelectedIndexRef.current, rowIndex);
      const end = Math.max(lastSelectedIndexRef.current, rowIndex);
      const rangeIds = rows.slice(start, end + 1).map((row) => normalizeId(row.candidate_id)).filter(Boolean);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...rangeIds])));
      return;
    }
    lastSelectedIndexRef.current = rowIndex;
    setSelectedIds((prev) => prev.includes(cleanId) ? prev.filter((item) => item !== cleanId) : [...prev, cleanId]);
  }
  function toggleAll() {
    setSelectedIds((prev) => allSelected ? prev.filter((id) => !visibleRowIds.includes(id)) : Array.from(new Set([...prev, ...visibleRowIds])));
  }
  function updateFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }
  function setBucketView(bucketView) {
    setSelectedIds([]);
    setTargetUserId('');
    setPage(1);
    if (bucketView === 'all_bucket_out_profiles') {
      setFilters((prev) => ({
        ...prev,
        bucket_view: 'all_bucket_out_profiles',
        recruiter_code: '',
        sr_from: '',
        sr_to: '',
        communication_skill: '',
        preferred_location: '',
        qualification: '',
        relevant_exp_band: '',
        salary_band: '',
      }));
      return;
    }
    setFilters((prev) => ({ ...prev, bucket_view: bucketView }));
  }
  function clearQuickFilters() {
    setFilters((prev) => ({ ...prev, recruiter_code: '', sr_from: '', sr_to: '', communication_skill: '', preferred_location: '', qualification: '', relevant_exp_band: '', salary_band: '' }));
    setPage(1);
    clearViewState(BUCKET_VIEW_STATE_KEY);
  }

  function openCandidateProfile(row) {
    if (!row?.candidate_id) return;
    const navRows = rows.length ? rows : (filterRows.length ? filterRows : []);
    openCandidateProfileInNewTab(row.candidate_id, navRows, { sourcePath: `${window.location.pathname}${window.location.search || ''}` });
  }

  const totalPages = useMemo(() => Math.max(1, Math.ceil((Number(totalRows || 0) || 0) / pageSize)), [totalRows, pageSize]);
  const pageButtons = useMemo(() => {
    if (totalPages <= 1) return [1];
    const set = new Set([1, totalPages, page, page - 1, page + 1]);
    if (page <= 3) [2, 3, 4].forEach((item) => set.add(item));
    if (page >= totalPages - 2) [totalPages - 1, totalPages - 2, totalPages - 3].forEach((item) => set.add(item));
    return [...set].filter((item) => item >= 1 && item <= totalPages).sort((a, b) => a - b);
  }, [page, totalPages]);

  function goToPage(nextPage) {
    const safePage = Math.min(totalPages, Math.max(1, Number(nextPage || 1)));
    if (safePage === page) return;
    load(safePage, filters).catch(() => {});
  }

  function submitPageJump() {
    const wanted = Number(pageJumpValue || 1);
    if (!Number.isFinite(wanted)) return;
    goToPage(wanted);
  }

  async function deleteCandidate(candidateId, fullName) {
    if (!isManager) return;
    const ok = window.confirm(`Delete ${fullName || candidateId || 'this candidate'}? This removes the profile from CRM.`);
    if (!ok) return;
    setMessage('');
    try {
      await api.post(`/api/candidates/${encodeURIComponent(candidateId)}/delete`, {});
      setSelectedIds((prev) => prev.filter((item) => item !== normalizeId(candidateId)));
      setMessage(`${fullName || candidateId} deleted.`);
      await load(filters);
    } catch (error) {
      setMessage(error.message || 'Delete failed');
    }
  }

  async function bulkReassign() {
    if (!canManage || !selectedEligibleIds.length || !targetUserId) return;
    setSaving(true);
    setMessage('');
    try {
      const data = await api.post('/api/candidates/bulk-reassign', { candidate_ids: selectedEligibleIds, target_user_id: targetUserId });
      setMessage(`${data.count || 0} profiles reassigned.`);
      setSelectedIds([]);
      setTargetUserId('');
      await load(filters);
    } catch (error) {
      setMessage(error.message || 'Reassign failed');
    } finally {
      setSaving(false);
    }
  }

  const bucketCards = [
    { key: 'all', label: 'Total Profiles', value: summary.total_visible || 0, note: `${summary.allocated_profiles || 0} allocated live`, tone: 'blue' },
    { key: 'fresh', label: 'Fresh Profile', value: summary.fresh_profiles || 0, note: 'Never called yet', tone: 'green' },
    { key: 'allocated', label: 'Allocated', value: summary.allocated_profiles || 0, note: 'Active recruiter buckets', tone: 'teal' },
    ...(canViewUnallocated ? [{ key: 'unallocated', label: 'Unallocated', value: summary.unallocated_profiles || 0, note: 'Visible only to TL and manager', tone: 'indigo' }] : []),
    { key: 'warning', label: 'Warning', value: summary.warning_profiles || 0, note: '2-3 days left', tone: 'orange' },
    { key: 'last_day', label: 'Last Day', value: summary.last_day_profiles || 0, note: 'Call first', tone: 'red' },
    { key: 'followup_due', label: 'Follow Up Due', value: summary.pending_followups || 0, note: `${summary.followup_profiles || 0} total follow ups`, tone: 'purple' },
    { key: 'bucket_out', label: 'Expired', value: summary.bucket_out_profiles || 0, note: 'Ready for review', tone: 'pink' },
    { key: 'all_bucket_out_profiles', label: 'All Bucket Out Profiles', value: summary.all_bucket_out_profiles || summary.bucket_out_profiles || 0, note: 'All expired profiles for reassignment', tone: 'pink' },
  ];

  return (
    <Layout title="Bucket" subtitle="Leadership bucket view with CRM totals, flexible profile assignment and controlled ownership.">
      {!!message && <div className="panel top-gap-small"><div className="helper-text">{message}</div></div>}

      <div className="bucket-card-grid bucket-card-grid-wide top-gap-small fade-up">
        {bucketCards.map((card) => (
          <button key={card.key} type="button" className={`stat-card bucket-click-card ${card.tone} ${filters.bucket_view === card.key ? 'active' : ''}`} onClick={() => setBucketView(card.key)}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.note}</small>
          </button>
        ))}
      </div>

      <div className="table-panel top-gap glassy-card fade-up bucket-toolbar-panel">
        <div className="table-toolbar no-wrap-toolbar bucket-toolbar-stack">
          <div>
            <div className="table-title">Bucket Slice</div>
            <div className="helper-text">CRM total: {summary.total_visible || 0} • Fresh: {summary.fresh_profiles || 0} • Allocated: {summary.allocated_profiles || 0} • Expired: {summary.bucket_out_profiles || 0} • All Bucket Out: {summary.all_bucket_out_profiles || summary.bucket_out_profiles || 0}</div>
          </div>
          <div className="toolbar-actions compact-pills candidate-toolbar-actions bucket-head-actions">
            <span className="mini-chip">{totalRows} records</span>
            {hiddenQuickFilterDefs.length ? (
              <select className="bucket-modern-select bucket-add-filter-select" value="" onChange={(e) => { addQuickFilter(e.target.value); e.target.value = ''; }}><option value="">Add Filter</option>{hiddenQuickFilterDefs.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select>
            ) : null}
            <button type="button" className="ghost-btn bounceable modern-filter-btn" onClick={() => setShowFilterDrawer(true)}><FilterIcon /> Filters</button>
            <button type="button" className="ghost-btn bounceable modern-filter-btn" onClick={clearQuickFilters}><FilterIcon /> Reset Filters</button>
          </div>
        </div>


        <div className="bucket-inline-filter-grid">
          {visibleQuickFilterDefs.map((section) => {
            if (section.key === 'recruiter_code') return (
              <label key={section.key} className="bucket-filter-box bucket-filter-box-removable">
                <span>{section.label}<button type="button" className="bucket-filter-remove" onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeQuickFilter(section.key); }}>×</button></span>
                <select className="bucket-modern-select" value={filters.recruiter_code} onChange={(e) => updateFilter('recruiter_code', e.target.value)}>
                  <option value="">All Recruiters</option>
                  {recruiterOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            );
            if (section.key === 'sr_range') return (
              <label key={section.key} className="bucket-filter-box bucket-filter-box-removable bucket-filter-box-range">
                <span>{section.label}<button type="button" className="bucket-filter-remove" onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeQuickFilter(section.key); }}>×</button></span>
                <div className="bucket-range-row">
                  <input className="bucket-modern-select bucket-text-input" value={filters.sr_from} onChange={(e) => updateFilter('sr_from', e.target.value.replace(/[^0-9]/g, ''))} placeholder="From" />
                  <input className="bucket-modern-select bucket-text-input" value={filters.sr_to} onChange={(e) => updateFilter('sr_to', e.target.value.replace(/[^0-9]/g, ''))} placeholder="To" />
                </div>
              </label>
            );
            if (section.key === 'communication_skill') return (
              <label key={section.key} className="bucket-filter-box bucket-filter-box-removable">
                <span>{section.label}<button type="button" className="bucket-filter-remove" onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeQuickFilter(section.key); }}>×</button></span>
                <select className="bucket-modern-select" value={filters.communication_skill} onChange={(e) => updateFilter('communication_skill', e.target.value)}>
                  <option value="">All Communication</option>
                  {communicationOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            );
            if (section.key === 'preferred_location') return (
              <label key={section.key} className="bucket-filter-box bucket-filter-box-removable">
                <span>{section.label}<button type="button" className="bucket-filter-remove" onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeQuickFilter(section.key); }}>×</button></span>
                <select className="bucket-modern-select" value={filters.preferred_location} onChange={(e) => updateFilter('preferred_location', e.target.value)}>
                  <option value="">All Preferred Location</option>
                  {preferredLocationOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            );
            if (section.key === 'qualification') return (
              <label key={section.key} className="bucket-filter-box bucket-filter-box-removable">
                <span>{section.label}<button type="button" className="bucket-filter-remove" onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeQuickFilter(section.key); }}>×</button></span>
                <select className="bucket-modern-select" value={filters.qualification} onChange={(e) => updateFilter('qualification', e.target.value)}>
                  <option value="">All Qualification</option>
                  {qualificationOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            );
            if (section.key === 'relevant_exp_band') return (
              <label key={section.key} className="bucket-filter-box bucket-filter-box-removable">
                <span>{section.label}<button type="button" className="bucket-filter-remove" onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeQuickFilter(section.key); }}>×</button></span>
                <select className="bucket-modern-select" value={filters.relevant_exp_band} onChange={(e) => updateFilter('relevant_exp_band', e.target.value)}>
                  {EXP_BANDS.map((item) => <option key={item.key || 'all'} value={item.key}>{item.label}</option>)}
                </select>
              </label>
            );
            return (
              <label key={section.key} className="bucket-filter-box bucket-filter-box-removable">
                <span>{section.label}<button type="button" className="bucket-filter-remove" onClick={(e) => { e.preventDefault(); e.stopPropagation(); removeQuickFilter(section.key); }}>×</button></span>
                <select className="bucket-modern-select" value={filters.salary_band} onChange={(e) => updateFilter('salary_band', e.target.value)}>
                  {SALARY_BANDS.map((item) => <option key={item.key || 'all'} value={item.key}>{item.label}</option>)}
                </select>
              </label>
            );
          })}
        </div>


        {canManage ? (
          <div className="candidate-master-row bucket-management-row">
            <button type="button" className={`selection-master-pill bounceable ${allSelected ? 'active' : ''}`} onClick={toggleAll}>
              <span className="selection-master-icon"><CheckIcon /></span>
              {allSelected ? 'Clear All' : 'Select All'}
            </button>
            <span className="selection-count-chip">{selectedIds.length} selected</span>
            {canManage ? (
              <div className="bucket-reassign-shell">
                <div className="bucket-target-shell">
                  <span className="bucket-target-label">Reassign To</span>
                  <select className="bucket-modern-select bucket-modern-target" value={targetUserId} onChange={(e) => setTargetUserId(e.target.value)}>
                    <option value="">Select owner</option>
                    {targets.map((target) => <option key={target.user_id} value={target.user_id}>{target.full_name} • {target.recruiter_code || target.role}</option>)}
                  </select>
                </div>
                <button type="button" className="add-profile-btn bounceable" disabled={!selectedEligibleIds.length || !targetUserId || saving} onClick={bulkReassign}>{saving ? 'Reassigning...' : 'Reassign Selected'}</button>
              </div>
            ) : <span className="helper-text">View only access</span>}
          </div>
        ) : (
          <div className="bucket-view-note">You can review this bucket view here. All Bucket Out Profiles card se expired profiles ek jagah mil jayengi aur unhe seedha reassign kar sakte ho.</div>
        )}

        <div className="crm-table-wrap dense-wrap top-gap-small">
          <table className="crm-table colorful-table dense-table">
            <thead>
              <tr>
                <th style={{ width: 84 }}>
                  <button type="button" className={`table-master-check ${allSelected ? 'active' : ''}`} onClick={toggleAll} title={allSelected ? 'Clear All' : 'Select All'}>
                    <CheckIcon />
                  </button>
                </th>
                <th>Candidate ID</th>
                <th>Candidate</th>
                <th>Number</th>
                <th>Recruiter</th>
                <th>Assigned On</th>
                <th>Date / Days</th>
                <th>Status</th>
                <th className="sticky-action-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const selected = selectedIds.includes(normalizeId(row.candidate_id));
                const dateText = row.bucket_is_fresh
                  ? '-'
                  : row.bucket_is_followup_due && row.follow_up_at
                    ? `FU ${formatDate(row.follow_up_at)}`
                    : row.bucket_is_bucket_out
                      ? `${row.bucket_days_passed || 0} days passed`
                      : `${row.bucket_days_left || 0} Day${Number(row.bucket_days_left || 0) === 1 ? '' : 's'}`;
                return (
                  <tr key={row.candidate_id} className={`clickable-row ${selected ? 'selected-row' : ''}`}>
                    <td>
                      <button type="button" className={`row-check-btn bounceable ${selected ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); toggle(row.candidate_id, index, e.shiftKey); }} title={selected ? 'Selected' : 'Select candidate'}>
                        <CheckIcon />
                      </button>
                    </td>
                    <td><strong>{row.candidate_id || '-'}</strong></td>
                    <td><strong>{row.full_name}</strong>{row.data_notes ? <div className="helper-text submission-mini-text">Notes: {row.data_notes}</div> : null}</td>
                    <td>{visiblePhone(user, row.phone)}</td>
                    <td>{row.recruiter_code || row.recruiter_name || '-'}</td>
                    <td>{formatDate(row.bucket_assigned_at)}</td>
                    <td><span className={`bucket-status-chip ${toneForBucket(row.bucket_stage)}`}>{dateText}</span></td>
                    <td><span className={`bucket-status-chip ${toneForBucket(row.bucket_stage)}`}>{row.bucket_status_label || row.status || '-'}</span></td>
                    <td className="sticky-actions-cell"><div className="row-actions nowrap-actions compact-row-actions"><button type="button" className="mini-btn call bounceable modern-icon-btn modern-eye-btn" onClick={(e) => { e.stopPropagation(); openCandidateProfile(row); }}>Open</button>{isManager ? <button type="button" className="mini-btn edit bounceable modern-delete-btn" onClick={(e) => { e.stopPropagation(); deleteCandidate(row.candidate_id, row.full_name); }}>Delete</button> : null}</div></td>
                  </tr>
                );
              })}
              {!rows.length ? <tr><td colSpan="9" className="helper-text">No profiles found for this bucket filter.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="row-actions top-gap-small candidate-pager-row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="row-actions" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="helper-text">Page {page} of {totalPages} • Showing {rows.length} of {totalRows}</div>
            <label className="helper-text" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>Rows
              <select
                className="inline-input"
                value={pageSize}
                onChange={(e) => { setSelectedIds([]); setPageSize(Number(e.target.value) || 10); setPage(1); }}
                style={{ width: 90 }}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
          </div>
          <div className="row-actions candidate-page-jump-wrap" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="ghost-btn bounceable" disabled={page <= 1} onClick={() => goToPage(page - 1)}>Previous {pageSize}</button>
            <div className="row-actions candidate-page-number-row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {pageButtons.map((value, index) => {
                const prevValue = pageButtons[index - 1];
                const showGap = index > 0 && value - prevValue > 1;
                return (
                  <React.Fragment key={value}>
                    {showGap ? <span className="helper-text">...</span> : null}
                    <button type="button" className={`bucket-quick-pill bounceable ${page === value ? 'active' : ''}`} onClick={() => goToPage(value)}>{value}</button>
                  </React.Fragment>
                );
              })}
            </div>
            <div className="row-actions" style={{ gap: 8, alignItems: 'center' }}>
              <input
                className="inline-input candidate-page-jump-input"
                type="number"
                min="1"
                max={totalPages}
                value={pageJumpValue}
                onChange={(e) => setPageJumpValue(e.target.value.replace(/[^\d]/g, '').slice(0, 4) || '')}
                onKeyDown={(e) => { if (e.key === 'Enter') submitPageJump(); }}
                placeholder="Page"
              />
              <button type="button" className="selection-master-pill bounceable" onClick={submitPageJump}>Go</button>
            </div>
            <button type="button" className="add-profile-btn bounceable" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>Next {pageSize}</button>
          </div>
        </div>
      </div>


      {showFilterDrawer ? (

        <div className="candidate-filter-modal-shell" role="dialog" aria-modal="true">
          <div className="candidate-filter-modal-card bucket-filter-modal-card">
            <div className="candidate-filter-modal-header">
              <div>
                <div className="candidate-filter-modal-title"><FilterIcon /> Bucket Filters</div>
                <div className="candidate-filter-modal-subtitle">Manage quick filters, add or remove fields, and update the active filter without leaving this page.</div>
              </div>
              <div className="candidate-filter-modal-actions">
                <span className="mini-chip">{totalRows} matching profiles</span>
                <button type="button" className="ghost-btn bounceable" onClick={clearQuickFilters}>Clear All</button>
                <button type="button" className="add-profile-btn bounceable" onClick={() => setShowFilterDrawer(false)}>Done</button>
              </div>
            </div>
            <div className="candidate-filter-modal-body">
              <aside className="candidate-filter-sidebar">
                <div className="candidate-filter-sidebar-card">
                  <div className="candidate-filter-sidebar-title">Visible Filters</div>
                  <div className="helper-text">Toggle any filter on or off from here.</div>
                </div>
                {quickFilterDefs.map((section) => {
                  const active = activeFilterKey === section.key;
                  const visible = visibleQuickFilters.includes(section.key);
                  return (
                    <button key={section.key} type="button" className={`candidate-filter-nav-item ${active ? 'active' : ''} ${visible ? 'visible-filter' : 'hidden-filter'}`} onClick={() => setActiveFilterKey(section.key)}>
                      <div>
                        <strong>{section.label}</strong>
                        <span>{visible ? 'Visible' : 'Hidden'}</span>
                      </div>
                      <span className="candidate-filter-nav-actions" onClick={(e) => e.stopPropagation()}>
                        {visible ? <button type="button" className="candidate-filter-quick-toggle" onClick={() => removeQuickFilter(section.key)}>Hide</button> : <button type="button" className="candidate-filter-quick-toggle" onClick={() => addQuickFilter(section.key)}>Show</button>}
                      </span>
                    </button>
                  );
                })}
              </aside>
              <section className="candidate-filter-main bucket-filter-main">
                <div className="candidate-filter-main-head">
                  <div>
                    <div className="candidate-filter-main-title">{activeQuickFilter?.label || 'Filter'}</div>
                    <div className="candidate-filter-main-subtitle">{totalRows} profiles match the current filter state.</div>
                  </div>
                </div>
                {activeQuickFilter?.key === 'sr_range' ? (
                  <div className="field top-gap-small bucket-modal-range-grid">
                    <label>Serial Number Range</label>
                    <div className="bucket-range-row">
                      <input className="inline-input" value={filters.sr_from} onChange={(e) => updateFilter('sr_from', e.target.value.replace(/[^0-9]/g, ''))} placeholder="From" />
                      <input className="inline-input" value={filters.sr_to} onChange={(e) => updateFilter('sr_to', e.target.value.replace(/[^0-9]/g, ''))} placeholder="To" />
                    </div>
                  </div>
                ) : (
                  <div className="candidate-filter-option-grid top-gap-small">
                    {optionListForFilter(activeQuickFilter?.key).map((item) => {
                      const checked = activeFilterOptionSelected(activeQuickFilter?.key, item);
                      return (
                        <button key={item} type="button" className={`candidate-filter-option ${checked ? 'active' : ''}`} onClick={() => setActiveFilterOption(activeQuickFilter?.key, checked ? '' : item)}>
                          <span className="candidate-filter-option-check">{checked ? '✓' : ''}</span>
                          <span>{item}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </Layout>
  );
}
