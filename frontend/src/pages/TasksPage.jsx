import React, { useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { mergeRowsById, useSmartDeltaSync } from '../lib/smartSync';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { readPageCache, writePageCache } from '../lib/persistentPageCache';
import { crmYmd, toCrmDateTimeLocalInput } from '../lib/timeFormat';

const PRIORITIES = ['Low', 'Normal', 'High'];

function safeCellText(value, fallback = '') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map((item) => safeCellText(item)).filter(Boolean).join(', ') || fallback;
  try {
    const compact = JSON.stringify(value);
    return compact === undefined ? fallback : compact;
  } catch {
    return fallback;
  }
}

function safeRows(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

const STATUSES = ['Open', 'In Progress', 'Completed', 'Closed'];
const QUICK_MINUTES = [30, 45, 60, 90, 120];
const CRM_REMINDER_LOOKAHEAD_MS = 10 * 60 * 1000;
const RECURRING_TYPES = [
  { value: '', label: 'One time task' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'custom', label: 'Custom minutes' },
];
const FILTER_STATUSES = [
  { value: '', label: 'All status' },
  { value: 'open', label: 'Open' },
  { value: 'in progress', label: 'In Progress' },
  { value: 'closed', label: 'Closed / Done' },
];
const FILTER_PRIORITIES = [
  { value: '', label: 'All priority' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];

const TASKS_CACHE_KEY = 'careerCroxTasksRows:v2';
const TASKS_USERS_CACHE_KEY = 'careerCroxTasksUsers:v2';

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ').slice(0, 16);
  return date.toLocaleString([], { hour12: true, year: 'numeric', month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit' });
}

function toDateInput(date) {
  return toCrmDateTimeLocalInput(date);
}

function toLocalYmd(value) {
  return crmYmd(value);
}

function normalizeStatus(value) {
  const v = String(value || '').trim().toLowerCase();
  if (['done', 'closed', 'completed'].includes(v)) return 'closed';
  if (v === 'in progress') return 'in progress';
  if (v === 'open') return 'open';
  return v;
}

function normalizePriority(value) {
  return String(value || '').trim().toLowerCase();
}

function matchesDateRange(value, from, to) {
  const current = toLocalYmd(value);
  if (!current) return false;
  if (from && current < from) return false;
  if (to && current > to) return false;
  return true;
}

function detailValue(value) {
  return String(value || '').trim() || '-';
}

function isMissedTask(row) {
  const normalizedStatus = normalizeStatus(row?.status);
  if (!['open', 'in progress'].includes(normalizedStatus)) return false;
  const dueAt = new Date(row?.due_date || 0).getTime();
  return Number.isFinite(dueAt) && dueAt > 0 && dueAt <= Date.now() + CRM_REMINDER_LOOKAHEAD_MS;
}

export default function TasksPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState(() => safeRows(readPageCache(TASKS_CACHE_KEY, [])));
  const [users, setUsers] = useState(() => safeRows(readPageCache(`${TASKS_USERS_CACHE_KEY}:${String(user?.user_id || '')}`, [])));
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [updatingTaskId, setUpdatingTaskId] = useState('');
  const [customMinutes, setCustomMinutes] = useState('');
  const [selectedTask, setSelectedTask] = useState(null);
  const [form, setForm] = useState({
    title: '', description: '', assigned_to_user_id: '', assigned_to_user_id_2: '', assigned_to_name: '', assignee_lookup: '', priority: 'Normal', status: 'Open', due_date: '', recurring_type: '', recurring_interval_minutes: '',
  });
  const [filters, setFilters] = useState({
    assigned_by_name: '',
    assigned_to_name: '',
    due_from: '',
    due_to: '',
    status: '',
    priority: '',
    missed_only: false,
  });

  const loadSeqRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const taskRequestIdRef = useRef(`task-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const focusTaskId = useMemo(() => new URLSearchParams(location.search).get('task_id') || '', [location.search]);

  async function load(options = {}) {
    const force = Boolean(options.force);
    const loadSeq = ++loadSeqRef.current;
    // Task rows paint independently. The staff directory is optional UI data,
    // never a reason to delay opening a card/profile or to blank existing names.
    const rowsRequest = api.get(`/api/tasks${force ? `?_refresh=${Date.now()}` : ''}`,
      { cacheTtlMs: force ? 0 : 60000, timeoutMs: 20000, retries: 1, allowStale: true, background: false });
    const directoryRequest = api.get('/api/tasks/assignees',
      { cacheTtlMs: force ? 0 : 300000, timeoutMs: 12000, retries: 0, allowStale: true, background: false })
      .then((result) => {
        if (loadSeq !== loadSeqRef.current) return;
        const incoming = safeRows(result?.users);
        if (!incoming.length) return;
        setUsers(incoming);
        writePageCache(`${TASKS_USERS_CACHE_KEY}:${String(user?.user_id || '')}`, incoming);
      }).catch(() => {});
    // Do not wait for employee directory before the task page is interactive.
    const taskData = await rowsRequest;
    if (loadSeq !== loadSeqRef.current) return;
    const nextRows = safeRows(taskData?.items);
    setRows(nextRows);
    writePageCache(TASKS_CACHE_KEY, nextRows);
    void directoryRequest;

  }

  useEffect(() => { load().catch(() => {}); }, []);
  useEffect(() => {
    const onEmployeeList = (event) => {
      const nextUsers = safeRows(event?.detail?.users);
      if (!nextUsers.length) return;
      setUsers(nextUsers);
      writePageCache(`${TASKS_USERS_CACHE_KEY}:${String(user?.user_id || '')}`, nextUsers);
    };
    window.addEventListener('cc630-task-assignees-loaded', onEmployeeList);
    return () => window.removeEventListener('cc630-task-assignees-loaded', onEmployeeList);
  }, []);
  useSmartDeltaSync({
    scope: 'tasks',
    idKey: 'task_id',
    rows,
    onRows: (changedRows) => setRows((current) => {
      const next = mergeRowsById(current, changedRows, 'task_id');
      writePageCache(TASKS_CACHE_KEY, next);
      return next;
    }),
  });

  useEffect(() => {
    if (!focusTaskId || !rows.length) return;
    const focused = rows.find((row) => String(row.task_id) === String(focusTaskId));
    if (focused) {
      setSelectedTask(focused);
      const timer = window.setTimeout(() => {
        const element = document.getElementById(`task-row-${focusTaskId}`);
        if (element) element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 160);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [focusTaskId, rows]);

  useEffect(() => {
    if (!selectedTask?.task_id) return;
    const latest = rows.find((row) => String(row.task_id) === String(selectedTask.task_id));
    if (latest) setSelectedTask(latest);
  }, [rows, selectedTask?.task_id]);

  const filteredUsers = useMemo(() => {
    const q = String(form.assignee_lookup || '').trim().toLowerCase();
    if (!q) return users.slice(0, 12);
    return users.filter((u) => [u.full_name, u.username, u.recruiter_code].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))).slice(0, 12);
  }, [users, form.assignee_lookup]);

  const assignedByOptions = useMemo(() => Array.from(new Set(rows.map((row) => String(row.assigned_by_name || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [rows]);
  const assignedToOptions = useMemo(() => {
    const fromRows = rows.map((row) => String(row.assigned_to_name || '').trim()).filter(Boolean);
    const fromUsers = users.map((row) => String(row.full_name || '').trim()).filter(Boolean);
    return Array.from(new Set([...fromRows, ...fromUsers])).sort((a, b) => a.localeCompare(b));
  }, [rows, users]);

  const preFilteredRows = useMemo(() => rows.filter((row) => {
    if (filters.assigned_by_name && String(row.assigned_by_name || '') !== filters.assigned_by_name) return false;
    if (filters.assigned_to_name && String(row.assigned_to_name || '') !== filters.assigned_to_name) return false;
    if ((filters.due_from || filters.due_to) && !matchesDateRange(row.due_date, filters.due_from, filters.due_to)) return false;
    return true;
  }), [rows, filters.assigned_by_name, filters.assigned_to_name, filters.due_from, filters.due_to]);

  const summary = useMemo(() => ({
    open: preFilteredRows.filter((row) => normalizeStatus(row.status) === 'open').length,
    progress: preFilteredRows.filter((row) => normalizeStatus(row.status) === 'in progress').length,
    done: preFilteredRows.filter((row) => normalizeStatus(row.status) === 'closed').length,
    high: preFilteredRows.filter((row) => normalizePriority(row.priority) === 'high').length,
    missed: preFilteredRows.filter((row) => isMissedTask(row)).length,
  }), [preFilteredRows]);

  const recurringRows = useMemo(() => rows
    .filter((row) => String(row.recurring_enabled || '0') === '1')
    .sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''))), [rows]);

  const filteredRows = useMemo(() => preFilteredRows
    .filter((row) => {
      const normalizedStatus = normalizeStatus(row.status);
      const normalizedPriority = normalizePriority(row.priority);
      if (filters.status && normalizedStatus !== filters.status) return false;
      if (filters.priority && normalizedPriority !== filters.priority) return false;
      if (filters.missed_only && !isMissedTask(row)) return false;
      return true;
    })
    .sort((a, b) => {
      const aClosed = normalizeStatus(a.status) === 'closed';
      const bClosed = normalizeStatus(b.status) === 'closed';
      if (aClosed !== bClosed) return aClosed ? 1 : -1;
      const aDue = new Date(a.due_date || 0).getTime() || Number.MAX_SAFE_INTEGER;
      const bDue = new Date(b.due_date || 0).getTime() || Number.MAX_SAFE_INTEGER;
      if (aDue !== bDue) return aDue - bDue;
      return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    }), [preFilteredRows, filters.status, filters.priority, filters.missed_only]);

  const activeFilterCount = useMemo(() => Object.entries(filters).filter(([, value]) => {
    if (typeof value === 'boolean') return value;
    return String(value || '').trim();
  }).length, [filters]);

  async function saveTask(e) {
    e.preventDefault();
    if (saveInFlightRef.current || saving) return;
    if (!form.title.trim() || !form.description.trim()) return;
    saveInFlightRef.current = true;
    setSaving(true);
    setMessage('Task save started. You can continue working.');
    const clientRequestId = taskRequestIdRef.current || `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const result = await api.post('/api/tasks', { ...form, client_request_id: clientRequestId }, { timeoutMs: 45000, retries: 0 });
      const createdRows = safeRows(result?.items || (result?.item ? [result.item] : []));
      if (createdRows.length) {
        setRows((current) => {
          const next = mergeRowsById(current, createdRows, 'task_id');
          writePageCache(TASKS_CACHE_KEY, next);
          return next;
        });
      }
      setShowModal(false);
      setForm({ title: '', description: '', assigned_to_user_id: '', assigned_to_user_id_2: '', assigned_to_name: '', assignee_lookup: '', priority: 'Normal', status: 'Open', due_date: '', recurring_type: '', recurring_interval_minutes: '' });
      setCustomMinutes('');
      taskRequestIdRef.current = `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setMessage(result?.duplicate_blocked ? 'Task already saved. Duplicate click blocked.' : 'Task created and notification delivered successfully.');
      await load({ force: true });
    } catch (error) {
      setMessage(error?.message || 'Task save failed. Please retry once.');
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  }

  function chooseAssignee(userId) {
    const chosen = users.find((u) => String(u.user_id) === String(userId));
    if (!chosen) return;
    setForm((current) => ({
      ...current,
      assigned_to_user_id: chosen.user_id,
      assigned_to_name: chosen.full_name || '',
      assignee_lookup: `${chosen.full_name || ''} ${chosen.recruiter_code || ''} ${chosen.username || ''}`.trim(),
    }));
  }

  function applyQuickMinutes(minutes) {
    const base = new Date();
    base.setMinutes(base.getMinutes() + Number(minutes || 0));
    setForm((current) => ({ ...current, due_date: toDateInput(base) }));
  }

  function setNowDueDate() {
    setForm((current) => ({ ...current, due_date: toDateInput(new Date()) }));
  }

  function applyCustomMinutes() {
    const minutes = Number.parseInt(customMinutes, 10);
    if (!Number.isFinite(minutes) || minutes < 0) return;
    const base = new Date();
    base.setMinutes(base.getMinutes() + minutes);
    setForm((current) => ({ ...current, due_date: toDateInput(base) }));
    setCustomMinutes('');
  }

  function priorityClass(value) {
    const v = normalizePriority(value);
    if (v === 'high') return 'priority-high';
    if (v === 'low') return 'priority-low';
    return 'priority-normal';
  }

  function statusClass(value) {
    const v = normalizeStatus(value);
    if (v === 'open') return 'status-open';
    if (v === 'in progress') return 'status-progress';
    return 'status-done';
  }

  function resetFilters() {
    setFilters({ assigned_by_name: '', assigned_to_name: '', due_from: '', due_to: '', status: '', priority: '', missed_only: false });
  }

  function openTask(task) {
    setSelectedTask(task);
  }

  function closeTask() {
    setSelectedTask(null);
    const params = new URLSearchParams(location.search);
    if (params.has('task_id')) {
      params.delete('task_id');
      const search = params.toString();
      navigate({ pathname: '/tasks', search: search ? `?${search}` : '' }, { replace: true });
    }
  }

  function toggleSummaryStatus(nextStatus) {
    setFilters((current) => ({
      ...current,
      status: current.status === nextStatus ? '' : nextStatus,
    }));
  }

  function toggleSummaryPriority(nextPriority) {
    setFilters((current) => ({
      ...current,
      priority: current.priority === nextPriority ? '' : nextPriority,
    }));
  }

  function toggleMissedFilter() {
    setFilters((current) => ({
      ...current,
      missed_only: !current.missed_only,
    }));
  }

  async function updateTaskStatus(task, nextStatus) {
    if (!task?.task_id || !nextStatus) return;
    setUpdatingTaskId(String(task.task_id));
    setMessage('');
    try {
      const result = await api.put(`/api/tasks/${encodeURIComponent(task.task_id)}`, { status: nextStatus });
      const updated = result.item || { ...task, status: nextStatus };
      setRows((current) => current.map((row) => (String(row.task_id) === String(task.task_id) ? { ...row, ...updated } : row)));
      setSelectedTask((current) => (current && String(current.task_id) === String(task.task_id) ? { ...current, ...updated } : current));
      if (String(nextStatus).toLowerCase() === 'open') setMessage('Task reopened successfully.');
      else if (String(nextStatus).toLowerCase() === 'closed') setMessage('Task closed successfully.');
      else setMessage('Task marked complete successfully.');
      closeTask();
      await load();
    } finally {
      setUpdatingTaskId('');
    }
  }

  return (
    <Layout title="Tasks & Reminder" subtitle="">
      <div className="table-panel top-gap-small glassy-card fade-up">
        <div className="table-toolbar no-wrap-toolbar">
          <div className="table-title">Task Control</div>
          <div className="toolbar-actions compact-pills top-toolbar-safe">
            {activeFilterCount ? <span className="mini-chip live-chip">{activeFilterCount} filters active</span> : null}
            <button className="ghost-btn bounceable" type="button" onClick={resetFilters}>Reset Filters</button>
            <button className="add-profile-btn bounceable" type="button" disabled={saving} onClick={() => { taskRequestIdRef.current = `task-${Date.now()}-${Math.random().toString(36).slice(2)}`; setShowModal(true); }}>{'Create Task'}</button>
            <button className="ghost-btn bounceable" type="button" disabled={saving} onClick={() => { taskRequestIdRef.current = `task-${Date.now()}-${Math.random().toString(36).slice(2)}`; setShowModal(true); window.setTimeout(() => { const select = document.querySelector('.task-premium-modal .field select'); if (select) { select.value = 'daily'; select.dispatchEvent(new Event('change', { bubbles: true })); } }, 120); }}>{'Recurring Task'}</button>
            <span className="mini-chip live-chip">Manual refresh</span>
          </div>
        </div>

        <div className="task-filter-grid top-gap-small">
          <div className="field compact-field">
            <label>Given By</label>
            <select className="inline-input" value={filters.assigned_by_name} onChange={(e) => setFilters((current) => ({ ...current, assigned_by_name: e.target.value }))}>
              <option value="">All givers</option>
              {assignedByOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div className="field compact-field">
            <label>Assigned To</label>
            <select className="inline-input" value={filters.assigned_to_name} onChange={(e) => setFilters((current) => ({ ...current, assigned_to_name: e.target.value }))}>
              <option value="">All takers</option>
              {assignedToOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div className="field compact-field">
            <label>Status Type</label>
            <select className={`inline-input ${filters.status ? statusClass(filters.status === 'closed' ? 'done' : filters.status) : ''}`} value={filters.status} onChange={(e) => setFilters((current) => ({ ...current, status: e.target.value }))}>
              {FILTER_STATUSES.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}
            </select>
          </div>
          <div className="field compact-field">
            <label>Priority Type</label>
            <select className={`inline-input ${filters.priority ? priorityClass(filters.priority) : ''}`} value={filters.priority} onChange={(e) => setFilters((current) => ({ ...current, priority: e.target.value }))}>
              {FILTER_PRIORITIES.map((item) => <option key={item.value || 'all'} value={item.value}>{item.label}</option>)}
            </select>
          </div>
          <div className="field compact-field">
            <label>Due From</label>
            <input className="inline-input" type="date" value={filters.due_from} onChange={(e) => setFilters((current) => ({ ...current, due_from: e.target.value }))} />
          </div>
          <div className="field compact-field">
            <label>Due To</label>
            <input className="inline-input" type="date" value={filters.due_to} onChange={(e) => setFilters((current) => ({ ...current, due_to: e.target.value }))} />
          </div>
        </div>
      </div>

      {!!message && <div className="panel top-gap-small"><div className="helper-text">{message}</div></div>}

      <div className="task-summary-grid top-gap">
        <button type="button" className={`metric-card colorful-card tone-blue task-summary-button ${filters.status === 'open' ? 'metric-card-active' : ''}`} onClick={() => toggleSummaryStatus('open')}>
          <span>Open</span>
          <strong>{summary.open}</strong>
          <small>Click to view open tasks</small>
        </button>
        <button type="button" className={`metric-card colorful-card tone-purple task-summary-button ${filters.status === 'in progress' ? 'metric-card-active' : ''}`} onClick={() => toggleSummaryStatus('in progress')}>
          <span>In Progress</span>
          <strong>{summary.progress}</strong>
          <small>Click to view running work</small>
        </button>
        <button type="button" className={`metric-card colorful-card tone-green task-summary-button ${filters.status === 'closed' ? 'metric-card-active' : ''}`} onClick={() => toggleSummaryStatus('closed')}>
          <span>Done</span>
          <strong>{summary.done}</strong>
          <small>Click to view closed tasks</small>
        </button>
        <button type="button" className={`metric-card colorful-card tone-orange task-summary-button ${filters.priority === 'high' ? 'metric-card-active' : ''}`} onClick={() => toggleSummaryPriority('high')}>
          <span>High Priority</span>
          <strong>{summary.high}</strong>
          <small>Click to view urgent tasks</small>
        </button>
        <button type="button" className={`metric-card colorful-card tone-red task-summary-button ${filters.missed_only ? 'metric-card-active' : ''}`} onClick={toggleMissedFilter}>
          <span>Missed</span>
          <strong>{summary.missed}</strong>
          <small>Click to view overdue tasks</small>
        </button>
      </div>

      {focusTaskId && rows.some((row) => String(row.task_id) === String(focusTaskId)) && <div className="panel top-gap-small"><div className="helper-text">Task opened from notification.</div></div>}

      {recurringRows.length ? (
        <div className="table-panel top-gap glassy-card fade-up">
          <div className="table-toolbar">
            <div className="table-title">Recurring Tasks</div>
            <div className="toolbar-actions compact-pills">
              <span className="mini-chip">{recurringRows.length} recurring</span>
              <span className="mini-chip">Close once, next slot auto opens</span>
            </div>
          </div>
          <div className="task-recurring-strip top-gap-small">
            {recurringRows.map((row) => (
              <button key={safeCellText(row.task_id, '-')} type="button" className="task-recurring-card bounceable" onClick={() => openTask(row)}>
                <strong>{safeCellText(row.title, '-')}</strong>
                <span>{safeCellText(row.assigned_to_name, '-')}</span>
                <small>{safeCellText(row.recurring_type) === 'custom' ? `Every ${safeCellText(row.recurring_interval_minutes, '-')} min` : safeCellText(row.recurring_type, 'Recurring')}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="table-panel top-gap glassy-card fade-up">
        <div className="table-toolbar">
          <div className="table-title">Task Details</div>
          <div className="toolbar-actions compact-pills">
            <span className="mini-chip">{filteredRows.length} records</span>
            <span className="mini-chip">Rows are clickable</span>
          </div>
        </div>
        <div className="crm-table-wrap dense-wrap">
          <table className="crm-table colorful-table dense-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Description</th>
                <th>Assigned To</th>
                <th>Assigned By</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Due</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr id={`task-row-${safeCellText(row.task_id, '-')}`} key={safeCellText(row.task_id, '-')} className={`clickable-row ${String(row.task_id) === String(focusTaskId) ? 'approval-wash approval-wash-approved' : ''}`} onClick={() => openTask(row)}>
                  <td><strong>{safeCellText(row.title, '-')}</strong><br /><span className="subtle">{safeCellText(row.task_id, '-')}</span></td>
                  <td>{safeCellText(row.description, '-')}</td>
                  <td>{safeCellText(row.assigned_to_name, '-')}{safeCellText(row.assigned_to_code) ? <><br /><span className="subtle">{safeCellText(row.assigned_to_code)}</span></> : null}</td>
                  <td>{safeCellText(row.assigned_by_name, '-')}</td>
                  <td><span className={`task-priority-pill ${priorityClass(row.priority)}`}>{safeCellText(row.priority, '-')}</span></td>
                  <td><span className={`task-state-pill ${statusClass(row.status)}`}>{normalizeStatus(row.status) === 'closed' ? 'Done' : (row.status || '-')}</span></td>
                  <td>{formatDate(row.due_date)}</td>
                  <td><button type="button" className="ghost-btn bounceable task-open-inline-btn" onClick={(e) => { e.stopPropagation(); openTask(row); }}>Open</button></td>
                </tr>
              ))}
              {!filteredRows.length && <tr><td colSpan="8" className="helper-text">No tasks found for the current filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="crm-modal-backdrop task-modal-fix" onClick={() => !saving && setShowModal(false)}>
          <div className="crm-premium-modal task-premium-modal task-modal-no-overlap" onClick={(e) => e.stopPropagation()}>
            <div className="cc553-task-editor-heading"><div className="panel-title">Create Task</div><button type="button" className="cc553-task-editor-close" aria-label="Close task editor" title="Close task editor" onClick={() => !saving && setShowModal(false)}>×</button></div>
            <div className="helper-text top-gap-small">Priority, ownership, schedule, and context — all in one task.</div>
            <form className="task-premium-form top-gap" onSubmit={saveTask}>
              <div className="field"><label>Task Name</label><input className="inline-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Task title" /></div>
              <div className="field"><label>Description</label><textarea rows="7" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Write full task story here" /></div>
              <div className="task-modal-grid">
                <div className="field"><label>Assign To</label><select className="inline-input" value={form.assigned_to_user_id} onChange={(e) => chooseAssignee(e.target.value)}><option value="">Choose recruiter / TL / manager</option>{users.map((option) => <option key={option.user_id} value={option.user_id}>{option.full_name} • {option.recruiter_code || option.username}</option>)}</select></div>
                <div className="field"><label>Second Assignee (optional)</label><select className="inline-input" value={form.assigned_to_user_id_2} onChange={(e) => setForm({ ...form, assigned_to_user_id_2: e.target.value })}><option value="">No second assignee</option>{users.filter((option) => String(option.user_id) !== String(form.assigned_to_user_id)).map((option) => <option key={option.user_id} value={option.user_id}>{option.full_name} • {option.recruiter_code || option.username}</option>)}</select></div>
                <div className="field task-search-field"><label>Name / Username / Recruiter Code Search</label><input className="inline-input" value={form.assignee_lookup} onChange={(e) => setForm({ ...form, assignee_lookup: e.target.value, assigned_to_name: e.target.value })} placeholder="Type and choose faster" />
                  {!!filteredUsers.length && <div className="task-assignee-suggest">{filteredUsers.map((person) => <button key={person.user_id} type="button" className="task-assignee-option" onClick={() => chooseAssignee(person.user_id)}>{person.full_name} <span>{person.recruiter_code || person.username}</span></button>)}</div>}
                </div>
                <div className="field"><label>Priority</label><select className={`inline-input ${priorityClass(form.priority)}`} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>{PRIORITIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
                <div className="field"><label>Status</label><select className={`inline-input ${statusClass(form.status)}`} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
                <div className="field"><label>Recurring</label><select className="inline-input" value={form.recurring_type} onChange={(e) => setForm({ ...form, recurring_type: e.target.value })}>{RECURRING_TYPES.map((item) => <option key={item.value || 'one'} value={item.value}>{item.label}</option>)}</select></div>
                <div className="field"><label>Recurring Minutes</label><input className="inline-input" type="number" min="5" step="5" value={form.recurring_interval_minutes} onChange={(e) => setForm({ ...form, recurring_interval_minutes: e.target.value })} placeholder="120" disabled={form.recurring_type !== 'custom'} /></div>
                <div className="field field-span-2"><label>Due Date & Time</label><input className="inline-input" type="datetime-local" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /><div className="task-quick-minute-row"><button type="button" className="mini-btn edit bounceable" onClick={setNowDueDate}>Now</button>{QUICK_MINUTES.map((item) => <button key={item} type="button" className="mini-btn view bounceable" onClick={() => applyQuickMinutes(item)}>+{item} min</button>)}<input className="task-minutes-input" type="number" min="0" step="1" value={customMinutes} onChange={(e) => setCustomMinutes(e.target.value)} placeholder="Type mins" /><button type="button" className="mini-btn call bounceable" onClick={applyCustomMinutes}>Add mins</button></div></div>
              </div>
              <div className="row-actions top-gap colorful-task-actions">
                <button className="add-profile-btn bounceable task-save-btn" type="submit" disabled={saving}>{'Assign Task'}</button>
                <button className="ghost-btn bounceable task-cancel-btn" type="button" disabled={saving} onClick={() => setShowModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedTask && (
        <div className="crm-modal-backdrop task-modal-fix" onClick={closeTask}>
          <div className="crm-premium-modal task-view-modal" onClick={(e) => e.stopPropagation()}>
            <div className="task-view-head">
              <div>
                <div className="panel-title">{detailValue(selectedTask.title)}</div>
                <div className="helper-text top-gap-small">{detailValue(selectedTask.task_id)} • Direct open view</div>
              </div>
              <div className="task-view-pill-row">
                <span className={`task-priority-pill ${priorityClass(selectedTask.priority)}`}>{detailValue(selectedTask.priority)}</span>
                <span className={`task-state-pill ${statusClass(selectedTask.status)}`}>{normalizeStatus(selectedTask.status) === 'closed' ? 'Done' : detailValue(selectedTask.status)}</span>
              </div>
            </div>

            <div className="task-view-grid top-gap">
              <div className="task-view-block">
                <span>Assigned To</span>
                <strong>{detailValue(selectedTask.assigned_to_name)}</strong>
                <small>{detailValue(selectedTask.assigned_to_code)}</small>
              </div>
              <div className="task-view-block">
                <span>Assigned By</span>
                <strong>{detailValue(selectedTask.assigned_by_name)}</strong>
                <small>{detailValue(selectedTask.assigned_by_user_id)}</small>
              </div>
              <div className="task-view-block">
                <span>Due Date</span>
                <strong>{formatDate(selectedTask.due_date)}</strong>
                <small>{toLocalYmd(selectedTask.due_date) || '-'}</small>
              </div>
              <div className="task-view-block">
                <span>Last Updated</span>
                <strong>{formatDate(selectedTask.updated_at || selectedTask.created_at)}</strong>
                <small>Created: {formatDate(selectedTask.created_at)}</small>
              </div>
            </div>

            <div className="task-view-description top-gap">
              <div className="task-view-description-title">Description</div>
              <div className="task-view-description-body">{detailValue(selectedTask.description)}</div>
            </div>

            <div className="row-actions top-gap">
              {normalizeStatus(selectedTask.status) === 'closed' ? (
                <button className="mini-btn call bounceable" type="button" disabled={updatingTaskId === String(selectedTask.task_id)} onClick={() => updateTaskStatus(selectedTask, 'Open')}>{'Reopen Task'}</button>
              ) : (
                <>
                  <button className="mini-btn call bounceable" type="button" disabled={updatingTaskId === String(selectedTask.task_id)} onClick={() => updateTaskStatus(selectedTask, 'Completed')}>{'Mark Complete'}</button>
                  <button className="mini-btn edit bounceable" type="button" disabled={updatingTaskId === String(selectedTask.task_id)} onClick={() => updateTaskStatus(selectedTask, 'Closed')}>{'Close Task'}</button>
                </>
              )}
              <button className="add-profile-btn bounceable" type="button" onClick={closeTask}>Back</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
