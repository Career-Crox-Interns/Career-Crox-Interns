import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
function buildQuery(filters) {
  const params = new URLSearchParams();
  params.set('page', '1');
  params.set('page_size', '25');
  params.set('bucket_view', filters.bucket_view || 'bucket_out');
  if (filters.recruiter_code) params.append('recruiter_code', filters.recruiter_code);
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
  const [filters, setFilters] = useState({
    bucket_view: 'bucket_out',
    recruiter_code: '',
    communication_skill: '',
    preferred_location: '',
    qualification: '',
    relevant_exp_band: '',
    salary_band: '',
  });

  const canManage = ['admin', 'manager'].includes(String(user?.role || '').toLowerCase());

  async function load(nextFilters = filters) {
    const data = await api.get(`/api/candidates?${buildQuery(nextFilters)}`);
    setRows(data.items || []);
    setFilterRows(data.filter_source_rows || []);
    setSummary(data.summary || {});
    setTotalRows(Number(data.total || 0));
  }

  async function loadTargets() {
    try {
      const data = await api.get('/api/candidates/reassign-targets');
      setTargets((data.items || []).filter((item) => ['recruiter', 'tl', 'manager', 'admin'].includes(String(item.role || '').toLowerCase())));
    } catch {
      setTargets([]);
    }
  }

  useEffect(() => { load(filters).catch(() => {}); loadTargets().catch(() => {}); }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { load(filters).catch(() => {}); }, 180);
    return () => window.clearTimeout(timer);
  }, [JSON.stringify(filters)]);
  usePolling(() => load(filters), 12000, [JSON.stringify(filters)]);

  const optionSourceRows = useMemo(() => (filterRows.length ? filterRows : rows), [filterRows, rows]);
  const recruiterOptions = useMemo(() => uniqueOptions(optionSourceRows, (row) => row.recruiter_code), [optionSourceRows]);
  const communicationOptions = useMemo(() => uniqueOptions(optionSourceRows, (row) => row.communication_skill), [optionSourceRows]);
  const preferredLocationOptions = useMemo(() => uniqueOptions(optionSourceRows, (row) => row.preferred_location, true), [optionSourceRows]);
  const qualificationOptions = useMemo(() => uniqueOptions(optionSourceRows, (row) => row.qualification || row.qualification_level), [optionSourceRows]);
  const visibleRowIds = useMemo(() => Array.from(new Set(rows.map((row) => normalizeId(row.candidate_id)).filter(Boolean))), [rows]);
  const allSelected = visibleRowIds.length > 0 && visibleRowIds.every((id) => selectedIds.includes(id));
  const selectedRows = useMemo(() => {
    const picked = new Set(selectedIds.map(normalizeId));
    return rows.filter((row) => picked.has(normalizeId(row.candidate_id)));
  }, [rows, selectedIds]);
  const selectedEligibleIds = useMemo(() => selectedRows.filter((row) => row.bucket_is_bucket_out).map((row) => normalizeId(row.candidate_id)), [selectedRows]);

  useEffect(() => {
    setSelectedIds((prev) => prev.map(normalizeId).filter((id) => visibleRowIds.includes(id)));
  }, [visibleRowIds]);

  function toggle(id) {
    const cleanId = normalizeId(id);
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
    setFilters((prev) => ({ ...prev, bucket_view: bucketView }));
  }
  function clearQuickFilters() {
    setFilters((prev) => ({ ...prev, recruiter_code: '', communication_skill: '', preferred_location: '', qualification: '', relevant_exp_band: '', salary_band: '' }));
  }

  async function bulkReassign() {
    if (!canManage || !selectedEligibleIds.length || !targetUserId) return;
    setSaving(true);
    setMessage('');
    try {
      const data = await api.post('/api/candidates/bulk-reassign', { candidate_ids: selectedEligibleIds, target_user_id: targetUserId });
      setMessage(`${data.count || 0} expired profiles reassigned.`);
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
    { key: 'warning', label: 'Warning', value: summary.warning_profiles || 0, note: '2-3 days left', tone: 'orange' },
    { key: 'last_day', label: 'Last Day', value: summary.last_day_profiles || 0, note: 'Call first', tone: 'red' },
    { key: 'followup_due', label: 'Follow Up Due', value: summary.pending_followups || 0, note: `${summary.followup_profiles || 0} total follow ups`, tone: 'purple' },
    { key: 'bucket_out', label: 'Expired', value: summary.bucket_out_profiles || 0, note: 'Ready for reassignment', tone: 'pink' },
  ];

  return (
    <Layout title="Bucket" subtitle="Leadership bucket view with CRM totals, fresh profiles, expired profiles and bulk reassignment.">
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
            <div className="helper-text">CRM total: {summary.total_visible || 0} • Fresh: {summary.fresh_profiles || 0} • Allocated: {summary.allocated_profiles || 0} • Expired: {summary.bucket_out_profiles || 0}</div>
          </div>
          <div className="toolbar-actions compact-pills candidate-toolbar-actions bucket-head-actions">
            <span className="mini-chip">{totalRows} records</span>
            <button type="button" className="ghost-btn bounceable modern-filter-btn" onClick={clearQuickFilters}><FilterIcon /> Reset Filters</button>
          </div>
        </div>

        <div className="bucket-inline-filter-grid">
          <label className="bucket-filter-box">
            <span>Recruiter Code</span>
            <select className="bucket-modern-select" value={filters.recruiter_code} onChange={(e) => updateFilter('recruiter_code', e.target.value)}>
              <option value="">All Recruiters</option>
              {recruiterOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="bucket-filter-box">
            <span>Communication</span>
            <select className="bucket-modern-select" value={filters.communication_skill} onChange={(e) => updateFilter('communication_skill', e.target.value)}>
              <option value="">All Communication</option>
              {communicationOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="bucket-filter-box">
            <span>Preferred Location</span>
            <select className="bucket-modern-select" value={filters.preferred_location} onChange={(e) => updateFilter('preferred_location', e.target.value)}>
              <option value="">All Preferred Location</option>
              {preferredLocationOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="bucket-filter-box">
            <span>Qualification</span>
            <select className="bucket-modern-select" value={filters.qualification} onChange={(e) => updateFilter('qualification', e.target.value)}>
              <option value="">All Qualification</option>
              {qualificationOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="bucket-filter-box">
            <span>Relevant Experience</span>
            <select className="bucket-modern-select" value={filters.relevant_exp_band} onChange={(e) => updateFilter('relevant_exp_band', e.target.value)}>
              {EXP_BANDS.map((item) => <option key={item.key || 'all'} value={item.key}>{item.label}</option>)}
            </select>
          </label>
          <label className="bucket-filter-box">
            <span>Inhand Salary</span>
            <select className="bucket-modern-select" value={filters.salary_band} onChange={(e) => updateFilter('salary_band', e.target.value)}>
              {SALARY_BANDS.map((item) => <option key={item.key || 'all'} value={item.key}>{item.label}</option>)}
            </select>
          </label>
        </div>

        {filters.bucket_view === 'bucket_out' ? (
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
                <button type="button" className="add-profile-btn bounceable" disabled={!selectedEligibleIds.length || !targetUserId || saving} onClick={bulkReassign}>{saving ? 'Reassigning...' : 'Bulk Reassign'}</button>
              </div>
            ) : <span className="helper-text">View only access</span>}
          </div>
        ) : (
          <div className="bucket-view-note">Bulk reassignment is available from the <strong>Expired</strong> card to keep the workflow controlled and clear.</div>
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
                <th>Candidate</th>
                <th>Number</th>
                <th>Recruiter</th>
                <th>Assigned On</th>
                <th>Date / Left</th>
                <th>Status</th>
                <th className="sticky-action-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const selected = selectedIds.includes(normalizeId(row.candidate_id));
                const dateText = row.bucket_is_fresh
                  ? '-'
                  : row.bucket_is_followup_due && row.follow_up_at
                    ? `FU ${formatDate(row.follow_up_at)}`
                    : row.bucket_is_bucket_out
                      ? `${row.bucket_days_passed || 0} days passed`
                      : `${row.bucket_days_left || 0} Day${Number(row.bucket_days_left || 0) === 1 ? '' : 's'} Left`;
                return (
                  <tr key={row.candidate_id} className={`clickable-row ${selected ? 'selected-row' : ''}`}>
                    <td>
                      <button type="button" className={`row-check-btn bounceable ${selected ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); toggle(row.candidate_id); }} title={selected ? 'Selected' : 'Select candidate'}>
                        <CheckIcon />
                      </button>
                    </td>
                    <td><strong>{row.full_name}</strong><br /><span className="subtle">{row.candidate_id}</span></td>
                    <td>{visiblePhone(user, row.phone)}</td>
                    <td>{row.recruiter_code || row.recruiter_name || '-'}</td>
                    <td>{formatDate(row.bucket_assigned_at)}</td>
                    <td><span className={`bucket-status-chip ${toneForBucket(row.bucket_stage)}`}>{dateText}</span></td>
                    <td><span className={`bucket-status-chip ${toneForBucket(row.bucket_stage)}`}>{row.bucket_status_label || row.status || '-'}</span></td>
                    <td className="sticky-actions-cell"><Link className="mini-btn call bounceable modern-icon-btn modern-eye-btn" to={`/candidate/${row.candidate_id}`}>Open</Link></td>
                  </tr>
                );
              })}
              {!rows.length ? <tr><td colSpan="8" className="helper-text">No profiles found for this bucket filter.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
