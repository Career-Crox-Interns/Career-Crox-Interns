import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { useAuth } from '../lib/auth';

const PRESET_OPTIONS = [
  { key: '10m', label: 'Last 10m', minutes: 10 },
  { key: '30m', label: 'Last 30m', minutes: 30 },
  { key: '1h', label: 'Last 1h', minutes: 60 },
  { key: '3h', label: 'Last 3h', minutes: 180 },
  { key: '6h', label: 'Last 6h', minutes: 360 },
  { key: '9h', label: 'Last 9h', minutes: 540 },
  { key: '1d', label: 'Last 1 day', minutes: 1440 },
  { key: '3d', label: 'Last 3 days', minutes: 4320 },
  { key: '1w', label: 'Last week', minutes: 10080 },
  { key: '1m', label: 'Last month', minutes: 43200 },
];

const CUSTOM_UNITS = [
  { value: 'hours', label: 'Hours' },
  { value: 'days', label: 'Days' },
];

const CATEGORY_OPTIONS = [
  { value: '', label: 'All Categories' },
  { value: 'idle', label: 'Idle Activity' },
  { value: 'submission', label: 'Submission Activity' },
  { value: 'call', label: 'Calls' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'profile_open', label: 'Profile Open' },
  { value: 'profile_edit', label: 'Details Edit' },
  { value: 'task', label: 'Task Activity' },
  { value: 'attendance', label: 'Attendance' },
  { value: 'other', label: 'Other' },
];

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '-');
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function toDateTimeLocalValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function isoFromNowMinus(minutes) {
  return new Date(Date.now() - (Number(minutes || 0) * 60000)).toISOString();
}

function cardTone(category) {
  if (category === 'idle') return 'tone-orange';
  if (category === 'submission') return 'tone-purple';
  if (category === 'call') return 'tone-blue';
  if (category === 'whatsapp') return 'tone-green';
  if (category === 'profile_open') return 'tone-sky';
  if (category === 'profile_edit') return 'tone-indigo';
  return 'tone-blue';
}

function computeRange({ mode, presetKey, customValue, customUnit, fromDateTime, toDateTime }) {
  if (mode === 'range') {
    return {
      from: fromDateTime ? new Date(fromDateTime).toISOString() : '',
      to: toDateTime ? new Date(toDateTime).toISOString() : new Date().toISOString(),
      label: fromDateTime || toDateTime ? 'Custom date range' : 'Current timeline',
    };
  }

  if (mode === 'custom') {
    const numericValue = Math.max(1, Number(customValue || 1));
    const multiplier = customUnit === 'days' ? 1440 : 60;
    return {
      from: isoFromNowMinus(numericValue * multiplier),
      to: new Date().toISOString(),
      label: `Last ${numericValue} ${customUnit}`,
    };
  }

  const preset = PRESET_OPTIONS.find((item) => item.key === presetKey) || PRESET_OPTIONS[2];
  return {
    from: isoFromNowMinus(preset.minutes),
    to: new Date().toISOString(),
    label: preset.label,
  };
}

function getVisibleCategory(activeCard, filterCategory) {
  return activeCard || filterCategory || '';
}

function RecruiterMultiSelect({ options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const shellRef = useRef(null);
  const normalizedSelected = useMemo(() => selected.map((item) => lower(item)), [selected]);
  const allSelected = !normalizedSelected.length || normalizedSelected.length >= options.length;

  useEffect(() => {
    function handleOutside(event) {
      if (shellRef.current && !shellRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  function toggleUser(username) {
    const key = lower(username);
    if (!key) return;
    if (normalizedSelected.includes(key)) {
      onChange(selected.filter((item) => lower(item) !== key));
      return;
    }
    onChange([...selected, username]);
  }

  const buttonText = allSelected ? 'All recruiters' : `${normalizedSelected.length} selected`;

  return (
    <div className="compact-select-shell shell-indigo activity-multi-shell" ref={shellRef}>
      <span className="compact-shell-label">Recruiters</span>
      <button type="button" className="activity-multi-trigger" onClick={() => setOpen((current) => !current)}>
        <span>{buttonText}</span>
        <strong>{open ? '▲' : '▼'}</strong>
      </button>
      {open ? (
        <div className="activity-multi-menu">
          <div className="activity-multi-tools">
            <button type="button" className="choice-chip bounceable active" onClick={() => onChange([])}>All</button>
            <button type="button" className="choice-chip bounceable" onClick={() => onChange(options.map((item) => item.username))}>Mark All</button>
            <button type="button" className="choice-chip bounceable" onClick={() => onChange([])}>Clear</button>
          </div>
          <div className="activity-multi-list">
            {options.map((item) => {
              const checked = allSelected || normalizedSelected.includes(lower(item.username));
              return (
                <label key={item.username} className={`activity-multi-option ${checked ? 'checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      if (allSelected) {
                        onChange(options.filter((row) => lower(row.username) !== lower(item.username)).map((row) => row.username));
                        return;
                      }
                      toggleUser(item.username);
                    }}
                  />
                  <span>{item.label}</span>
                </label>
              );
            })}
            {!options.length ? <div className="helper-text">No recruiter activity found in this window.</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function RecentActivityPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [recruiterOptions, setRecruiterOptions] = useState([]);
  const [selectedRecruiters, setSelectedRecruiters] = useState([]);
  const [viewMode, setViewMode] = useState('preset');
  const [presetKey, setPresetKey] = useState('1h');
  const [customValue, setCustomValue] = useState('6');
  const [customUnit, setCustomUnit] = useState('hours');
  const [fromDateTime, setFromDateTime] = useState(toDateTimeLocalValue(isoFromNowMinus(180)));
  const [toDateTime, setToDateTime] = useState(toDateTimeLocalValue(new Date().toISOString()));
  const [liveMode, setLiveMode] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [activeCard, setActiveCard] = useState('');
  const [idleThreshold, setIdleThreshold] = useState('10');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);

  const range = useMemo(() => computeRange({ mode: viewMode, presetKey, customValue, customUnit, fromDateTime, toDateTime }), [viewMode, presetKey, customValue, customUnit, fromDateTime, toDateTime]);
  const visibleCategory = useMemo(() => getVisibleCategory(activeCard, categoryFilter), [activeCard, categoryFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (range.from) params.set('from', range.from);
      if (range.to) params.set('to', range.to);
      if (selectedRecruiters.length) params.set('recruiters', selectedRecruiters.join(','));
      if (idleThreshold) params.set('idle_threshold', idleThreshold);
      if (search.trim()) params.set('search', search.trim());
      params.set('limit', liveMode ? '500' : '1500');
      if (liveMode) params.set('live', '1');
      const data = await api.get(`/api/recent-activity?${params.toString()}`, { cacheTtlMs: liveMode ? 0 : 600, background: false });
      setRows(data.items || []);
      setSummary(data.summary || {});
      setRecruiterOptions(data.recruiters || []);
      setTruncated(Boolean(data.truncated));
    } catch (err) {
      setError(err.message || 'Recent activity load failed.');
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, selectedRecruiters, idleThreshold, search, liveMode]);

  useEffect(() => { load(); }, [load]);
  usePolling(load, liveMode ? 1200 : null, [load]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (visibleCategory && lower(row.activity_category) !== lower(visibleCategory)) return false;
      return true;
    });
  }, [rows, visibleCategory]);

  const cards = useMemo(() => ([
    {
      key: 'idle',
      title: 'Idle Activity',
      value: summary.idle || 0,
      note: `${idleThreshold || 0}m+ idle windows`,
    },
    {
      key: 'submission',
      title: 'Submission Activity',
      value: summary.submission || 0,
      note: 'Submit / approve / reject logs',
    },
    {
      key: 'call',
      title: 'Calls',
      value: summary.call || 0,
      note: 'Dial and call logs',
    },
    {
      key: 'whatsapp',
      title: 'WhatsApp',
      value: summary.whatsapp || 0,
      note: 'WhatsApp open and send flow',
    },
    {
      key: 'profile_open',
      title: 'Profile Open',
      value: summary.profile_open || 0,
      note: 'Who opened profiles',
    },
    {
      key: 'profile_edit',
      title: 'Details Edit',
      value: summary.profile_edit || 0,
      note: 'Profile update activity',
    },
  ]), [summary, idleThreshold]);

  function toggleCard(key) {
    setActiveCard((current) => current === key ? '' : key);
    setCategoryFilter('');
  }

  function resetFilters() {
    setSelectedRecruiters([]);
    setViewMode('preset');
    setPresetKey('1h');
    setCustomValue('6');
    setCustomUnit('hours');
    setFromDateTime(toDateTimeLocalValue(isoFromNowMinus(180)));
    setToDateTime(toDateTimeLocalValue(new Date().toISOString()));
    setCategoryFilter('');
    setActiveCard('');
    setIdleThreshold('10');
    setSearch('');
    setLiveMode(true);
  }

  function downloadReport() {
    const params = new URLSearchParams();
    if (range.from) params.set('from', range.from);
    if (range.to) params.set('to', range.to);
    if (selectedRecruiters.length) params.set('recruiters', selectedRecruiters.join(','));
    if (idleThreshold) params.set('idle_threshold', idleThreshold);
    if (search.trim()) params.set('search', search.trim());
    if (visibleCategory) params.set('category', visibleCategory);
    window.open(`/api/recent-activity/export?${params.toString()}`, '_blank');
  }

  return (
    <Layout title="Recent Activity" subtitle="Live recruiter activity tracking with fast filters and export-ready reporting.">
      <div className="activity-card-grid top-gap-small fade-up">
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            className={`metric-card colorful-card clickable-summary-card ${cardTone(card.key)} ${activeCard === card.key ? 'metric-card-active' : ''}`}
            onClick={() => toggleCard(card.key)}
          >
            <span>{card.title}</span>
            <strong>{card.value}</strong>
            <small>{card.note}</small>
          </button>
        ))}
      </div>

      <div className="table-panel top-gap-small glassy-card fade-up">
        <div className="table-toolbar no-wrap-toolbar activity-toolbar-stack">
          <div>
            <div className="table-title">Activity Control Room</div>
            <div className="helper-text">Live mode refreshes automatically. Customize and date range stay manual so the page does not behave like a tired free-hosting server.</div>
          </div>
          <div className="toolbar-actions compact-pills candidate-toolbar-actions activity-head-actions">
            <span className="metric-mini-chip records">{filteredRows.length} rows</span>
            <span className="metric-mini-chip filters">{summary.recruiters_active || 0} active users</span>
            <button type="button" className={`choice-chip bounceable ${liveMode ? 'active' : ''}`} onClick={() => setLiveMode((current) => !current)}>{liveMode ? 'Live Activity On' : 'Live Activity Off'}</button>
            {String(user?.role || "").toLowerCase() === "manager" && <button type="button" className="ghost-btn bounceable modern-filter-btn" onClick={downloadReport}>Download Report</button>}
            <button type="button" className="ghost-btn bounceable modern-filter-btn" onClick={load}>Refresh</button>
          </div>
        </div>

        <div className="activity-preset-strip top-gap-small">
          <button type="button" className={`choice-chip bounceable ${viewMode === 'preset' ? 'active' : ''}`} onClick={() => setViewMode('preset')}>Preset Duration</button>
          <button type="button" className={`choice-chip bounceable ${viewMode === 'custom' ? 'active' : ''}`} onClick={() => setViewMode('custom')}>Customize</button>
          <button type="button" className={`choice-chip bounceable ${viewMode === 'range' ? 'active' : ''}`} onClick={() => setViewMode('range')}>From &amp; To</button>
          <span className="mini-chip live-chip">{range.label}</span>
          {truncated ? <span className="mini-chip">Showing latest matched rows</span> : null}
        </div>

        {viewMode === 'preset' ? (
          <div className="activity-preset-buttons top-gap-small">
            {PRESET_OPTIONS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`choice-chip bounceable ${presetKey === item.key ? 'active' : ''}`}
                onClick={() => setPresetKey(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}

        {viewMode === 'custom' ? (
          <div className="activity-custom-grid top-gap-small">
            <label className="compact-select-shell shell-cyan">
              <span className="compact-shell-label">Custom Value</span>
              <input className="inline-input compact-inline-input" type="number" min="1" value={customValue} onChange={(e) => setCustomValue(e.target.value)} />
            </label>
            <label className="compact-select-shell shell-blue">
              <span className="compact-shell-label">Unit</span>
              <select className="inline-input compact-inline-input" value={customUnit} onChange={(e) => setCustomUnit(e.target.value)}>
                {CUSTOM_UNITS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
          </div>
        ) : null}

        {viewMode === 'range' ? (
          <div className="activity-custom-grid top-gap-small">
            <label className="compact-select-shell shell-violet">
              <span className="compact-shell-label">From Date &amp; Time</span>
              <input className="inline-input compact-inline-input" type="datetime-local" value={fromDateTime} onChange={(e) => setFromDateTime(e.target.value)} />
            </label>
            <label className="compact-select-shell shell-blue">
              <span className="compact-shell-label">To Date &amp; Time</span>
              <input className="inline-input compact-inline-input" type="datetime-local" value={toDateTime} onChange={(e) => setToDateTime(e.target.value)} />
            </label>
          </div>
        ) : null}

        <div className="activity-filter-grid top-gap-small">
          <RecruiterMultiSelect options={recruiterOptions} selected={selectedRecruiters} onChange={setSelectedRecruiters} />

          <label className="compact-select-shell shell-green">
            <span className="compact-shell-label">Activity Category</span>
            <select className="inline-input compact-inline-input" value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setActiveCard(''); }}>
              {CATEGORY_OPTIONS.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}
            </select>
          </label>

          <label className="compact-select-shell shell-peach">
            <span className="compact-shell-label">Idle Threshold</span>
            <select className="inline-input compact-inline-input" value={idleThreshold} onChange={(e) => setIdleThreshold(e.target.value)}>
              <option value="0">All Idle Logs</option>
              <option value="10">10 minutes+</option>
              <option value="20">20 minutes+</option>
              <option value="30">30 minutes+</option>
              <option value="60">60 minutes+</option>
            </select>
          </label>

          <label className="compact-select-shell shell-gold activity-search-shell">
            <span className="compact-shell-label">Search</span>
            <input className="inline-input compact-inline-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search recruiter, candidate, action, details" />
          </label>
        </div>

        <div className="activity-mini-summary top-gap-small">
          <span className="mini-chip">Idle windows: {summary.idle || 0}</span>
          <span className="mini-chip">Submission logs: {summary.submission || 0}</span>
          <span className="mini-chip">Calls: {summary.call || 0}</span>
          <span className="mini-chip">WhatsApp: {summary.whatsapp || 0}</span>
          <span className="mini-chip">Profile opens: {summary.profile_open || 0}</span>
          <span className="mini-chip">Details edits: {summary.profile_edit || 0}</span>
          <span className="mini-chip">Live breaks: {summary.live_breaks || 0}</span>
          <span className="mini-chip">Break mins today: {summary.break_minutes_today || 0}</span>
          <span className="mini-chip">Login mins today: {summary.login_minutes_today || 0}</span>
          <span className="mini-chip">Work mins today: {summary.work_minutes_today || 0}</span>
          <span className="mini-chip">Idle 15m+: {summary.live_idle_15 || 0}</span>
          <span className="mini-chip">Idle 30m+: {summary.live_idle_30 || 0}</span>
          <span className="mini-chip">No profile open 30m: {summary.no_profile_open_30 || 0}</span>
          <span className="mini-chip">No call 30m: {summary.no_call_30 || 0}</span>
          <button type="button" className="ghost-btn bounceable modern-filter-btn" onClick={resetFilters}>Reset Filters</button>
        </div>

        {error ? <div className="helper-text top-gap-small sync-message is-error">{error}</div> : null}
        {!error && loading ? <div className="helper-text top-gap-small">Loading recent activity...</div> : null}
        {visibleCategory ? <div className="helper-text top-gap-small">Card filter active: <strong>{CATEGORY_OPTIONS.find((item) => item.value === visibleCategory)?.label || visibleCategory}</strong></div> : null}

        <div className="crm-table-wrap dense-wrap top-gap-small">
          <table className="crm-table colorful-table dense-table activity-log-table">
            <thead>
              <tr>
                <th>Recruiter</th>
                <th>Category</th>
                <th>Activity</th>
                <th>Candidate</th>
                <th>Idle Window</th>
                <th>Created At</th>
                <th>Details</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={row.activity_id}>
                  <td><strong>{row.username || '-'}</strong></td>
                  <td><span className={`status-chip ${row.activity_category === 'idle' ? 'secondary' : ''}`}>{row.activity_category || '-'}</span></td>
                  <td>{row.action_label || row.action_type || '-'}</td>
                  <td>{row.candidate_id || '-'}</td>
                  <td>
                    {row.activity_category === 'idle' ? (
                      <>
                        <div>{row.idle_minutes ? `${row.idle_minutes}m` : '-'}</div>
                        <div className="helper-text activity-idle-range">{row.idle_started_at ? `${formatDateTime(row.idle_started_at)} to ${formatDateTime(row.idle_ended_at)}` : 'Idle window not available'}</div>
                      </>
                    ) : '-'}
                  </td>
                  <td>{formatDateTime(row.created_at)}</td>
                  <td>{row.details_text || '-'}</td>
                  <td>
                    {row.candidate_id ? <a className="mini-btn view bounceable" href={`/candidate/${row.candidate_id}`}>Open</a> : <span className="helper-text">-</span>}
                  </td>
                </tr>
              ))}
              {!filteredRows.length ? <tr><td colSpan="8" className="helper-text">No recent activity matched this filter set.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
