import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { useAuth } from '../lib/auth';
import { dialCandidateWithLog, openWhatsAppWithLog } from '../lib/candidateAccess';

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace('T', ' ').slice(0, 16);
  return date.toLocaleString([], {
    hour12: true,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function toDateTimeLocal(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function addDuration(hours, minutes) {
  const date = new Date();
  date.setHours(date.getHours() + Number(hours || 0));
  date.setMinutes(date.getMinutes() + Number(minutes || 0));
  return date.toISOString();
}

function reminderState(row) {
  const followUpAt = new Date(row.next_follow_up_at || 0).getTime();
  if (!followUpAt) return 'No Reminder';
  const snoozeUntil = new Date(row.reminder_snoozed_until || 0).getTime();
  if (snoozeUntil && snoozeUntil > Date.now()) return 'Scheduled';
  if (followUpAt <= Date.now()) return 'Due';
  return 'Scheduled';
}

function timeLeftText(row) {
  const t = new Date(row.next_follow_up_at || 0).getTime();
  if (!t) return '';
  const diff = t - Date.now();
  const absMins = Math.round(Math.abs(diff) / 60000);
  const hrs = Math.floor(absMins / 60);
  const mins = absMins % 60;
  const parts = [];
  if (hrs) parts.push(`${hrs}h`);
  if (mins || !parts.length) parts.push(`${mins}m`);
  return diff <= 0 ? `${parts.join(' ')} overdue` : `${parts.join(' ')} left`;
}

function splitValues(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function uniqueOptions(rows, getter, split = false) {
  return Array.from(new Set(rows.flatMap((row) => {
    const value = getter(row);
    return split ? splitValues(value) : [String(value || '').trim()].filter(Boolean);
  }))).sort((a, b) => String(a).localeCompare(String(b)));
}

function matchesText(value, expected) {
  return String(value || '').trim().toLowerCase() === String(expected || '').trim().toLowerCase();
}

function PhoneIcon() {
  return <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6.6 10.8a15.4 15.4 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1.1-.3 1.2.4 2.4.6 3.7.6.6 0 1 .4 1 1V21c0 .6-.4 1-1 1C10.6 22 2 13.4 2 3c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.7.1.4 0 .8-.3 1.1l-2.2 2.2Z" fill="currentColor" /></svg>;
}

function WhatsAppIcon() {
  return <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M20 11.9c0 4.4-3.6 8-8 8-1.4 0-2.8-.4-4-1.1L4 20l1.2-3.8A8 8 0 1 1 20 11.9Zm-8-6.4a6.4 6.4 0 0 0-5.5 9.8l.2.3-.7 2.2 2.3-.7.3.2a6.4 6.4 0 1 0 3.4-11.8Zm3.8 8.2c-.2-.1-1.2-.6-1.3-.6-.2-.1-.3-.1-.5.1l-.4.5c-.1.1-.2.2-.4.1-.2-.1-.8-.3-1.5-1-.6-.6-1-1.2-1.1-1.4-.1-.2 0-.3.1-.4l.3-.3.1-.3c.1-.1 0-.2 0-.3l-.6-1.4c-.1-.2-.2-.2-.4-.2h-.4c-.1 0-.3 0-.5.2-.2.2-.7.7-.7 1.7s.8 2 1 2.1c.1.1 1.6 2.5 4 3.4.6.3 1.1.4 1.5.5.6.2 1.1.2 1.5.1.5-.1 1.2-.5 1.4-1 .2-.5.2-1 .2-1.1-.1-.1-.2-.1-.4-.2Z" fill="currentColor" /></svg>;
}

const durationPresets = [
  { label: '3m', hours: '0', minutes: '3' },
  { label: '5m', hours: '0', minutes: '5' },
  { label: '10m', hours: '0', minutes: '10' },
  { label: '15m', hours: '0', minutes: '15' },
  { label: '30m', hours: '0', minutes: '30' },
  { label: '1h', hours: '1', minutes: '0' },
];

const baseNoteSuggestions = [
  'Call no answer. Retry shortly.',
  'WhatsApp sent. Waiting reply.',
  'Candidate asked for callback.',
  'Need docs before final push.',
  'Follow-up after recruiter check.',
];

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function statusText(row) {
  return `${row.status || ''} ${row.candidate_status || ''}`.toLowerCase();
}

function hoursSince(value) {
  const t = new Date(value || 0).getTime();
  if (!t) return 0;
  return Math.max(0, (Date.now() - t) / 3600000);
}

function nextDayAt(hour = 10, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function todayAt(hour = 18, minute = 0) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  if (date.getTime() <= Date.now()) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

function getSmartReminderPreset(row) {
  const approval = lower(row.approval_status);
  const details = lower(row.all_details_sent);
  const status = statusText(row);

  if (approval === 'pending') {
    return {
      key: 'approval_pending',
      label: 'Approval pending',
      help: 'Approval is still pending. Recheck shortly and close the decision without delay.',
      hours: '0',
      minutes: '10',
      exact_time: '',
      note: 'Approval pending. Recheck shortly and close the decision fast.',
      suggestions: [
        'Approval pending. Recheck in 10 minutes.',
        'TL/Manager decision awaited.',
        'Open approval and close this now.',
      ],
    };
  }

  if (details === 'pending' && approval === 'approved') {
    return {
      key: 'details_sent_pending',
      label: 'All details sent pending',
      help: 'Approval completed. Keep the next closure step updated.',
      hours: '0',
      minutes: '30',
      exact_time: '',
      note: 'Approved profile. Send all details and close follow-up in this push.',
      suggestions: [
        'Approved profile. Send details now.',
        'Call and confirm all details sent.',
        'WhatsApp details shared. Verify receipt.',
      ],
    };
  }

  if (status.includes('not responding') || status.includes('no response')) {
    return {
      key: 'no_response',
      label: 'No response follow-up',
      help: 'No response cases are best moved to a controlled next-day follow-up.',
      hours: '0',
      minutes: '0',
      exact_time: toDateTimeLocal(nextDayAt(10, 0)),
      note: 'No response. Push again tomorrow morning with a clean follow-up.',
      suggestions: [
        'No response. Retry tomorrow morning.',
        'WhatsApp sent. Awaiting reply till tomorrow.',
        'Call back next day 10 AM.',
      ],
    };
  }

  if (status.includes('interview')) {
    return {
      key: 'interview_pending',
      label: 'Interview pending',
      help: 'A same-day evening checkpoint is configured for the interview stage.',
      hours: '0',
      minutes: '0',
      exact_time: toDateTimeLocal(todayAt(18, 0)),
      note: 'Interview stage active. Recheck before day-end and confirm movement.',
      suggestions: [
        'Interview check pending. Close before evening.',
        'Confirm interview timing and attendance.',
        'Candidate informed. Awaiting final confirmation.',
      ],
    };
  }

  return {
    key: 'follow_up_needed',
    label: 'Follow-up needed',
    help: 'A 3-hour smart preset is configured for general follow-up cases.',
    hours: '3',
    minutes: '0',
    exact_time: '',
    note: 'Follow-up required. Revisit this profile in the next work block.',
    suggestions: [
      'General follow-up due in 3 hours.',
      'Need recruiter callback later today.',
      'Hold and revisit after current queue.',
    ],
  };
}

function queueBucketForRow(row) {
  const approval = lower(row.approval_status);
  const details = lower(row.all_details_sent);
  const reminder = reminderState(row);
  const status = statusText(row);
  const ageHours = hoursSince(row.submitted_at);

  if (approval === 'pending') return 'approval';
  if (details === 'pending' && reminder === 'Due') return 'urgent';
  if (details === 'pending' && approval === 'approved' && (status.includes('interested') || status.includes('in progress') || status.includes('follow') || status.includes('respond'))) return 'hot';
  if (details === 'pending' && ageHours >= 6) return 'old';
  if (details === 'pending') return 'followup';
  return 'other';
}

function queueLabel(bucket) {
  switch (bucket) {
    case 'urgent': return 'Urgent Follow-up';
    case 'approval': return 'Pending Approval';
    case 'hot': return 'Hot Candidate';
    case 'old': return 'Old Pending Detail';
    case 'followup': return 'Follow-up Needed';
    default: return 'Other';
  }
}

function queuePriority(row) {
  const bucket = queueBucketForRow(row);
  const ageHours = hoursSince(row.submitted_at);
  if (bucket === 'urgent') return 5000 + ageHours;
  if (bucket === 'approval') return 4000 + ageHours;
  if (bucket === 'hot') return 3000 + ageHours;
  if (bucket === 'old') return 2000 + ageHours;
  if (bucket === 'followup') return 1000 + ageHours;
  return ageHours;
}

function queueHint(row) {
  const bucket = queueBucketForRow(row);
  if (bucket === 'urgent') return timeLeftText(row) || 'Reminder due right now';
  if (bucket === 'approval') return 'Approval decision pending';
  if (bucket === 'hot') return 'Approved profile. Complete the details follow-up.';
  if (bucket === 'old') return `${Math.round(hoursSince(row.submitted_at))}h old pending`; 
  if (bucket === 'followup') return 'Follow-up reminder recommended';
  return 'Standard queue item';
}

export default function SubmissionsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const leadership = ['admin', 'manager', 'tl'].includes(user?.role);
  const [allRows, setAllRows] = useState([]);
  const [rows, setRows] = useState([]);
  const [showOld, setShowOld] = useState(false);
  const [days, setDays] = useState('7');
  const [filters, setFilters] = useState({ recruiter_code: '', all_details_sent: '', reminder: '', comms: '', preferred_location: '', submitted_from: '', submitted_to: '' });
  const [rejectingId, setRejectingId] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [savingId, setSavingId] = useState('');
  const [message, setMessage] = useState('');
  const [syncState, setSyncState] = useState('idle');
  const [reminderModal, setReminderModal] = useState(null);
  const [reminderMeta, setReminderMeta] = useState(getSmartReminderPreset({}));
  const [reminderForm, setReminderForm] = useState({ hours: '0', minutes: '3', exact_time: '', note: '' });
  const [popupRow, setPopupRow] = useState(null);
  const [queueTab, setQueueTab] = useState('all');

  async function load() {
    const query = new URLSearchParams();
    if (showOld) query.set('show_old', '1');
    if (showOld && days) query.set('days', days);
    const data = await api.get(`/api/submissions${query.toString() ? `?${query.toString()}` : ''}`, { cacheTtlMs: 0, timeoutMs: 20000, retries: 1 });
    setAllRows(data.items || []);
  }

  useEffect(() => { load(); }, [showOld, days]);
  usePolling(load, 5000, [showOld, days]);

  useEffect(() => {
    if (leadership) return;
    setFilters((current) => ({ ...current, recruiter_code: user?.recruiter_code || current.recruiter_code || '' }));
  }, [leadership, user?.recruiter_code]);

  const recruiterOptions = useMemo(() => uniqueOptions(allRows, (row) => row.recruiter_code, true), [allRows]);
  const preferredLocationOptions = useMemo(() => uniqueOptions(allRows, (row) => row.location || row.preferred_location, true), [allRows]);
  const communicationOptions = useMemo(() => uniqueOptions(allRows, (row) => row.submission_comms || row.communication_skill), [allRows]);


  useEffect(() => {
    setRows(allRows.filter((row) => {
      if (filters.recruiter_code && !splitValues(row.recruiter_code).some((item) => matchesText(item, filters.recruiter_code))) return false;
      if (filters.all_details_sent && !matchesText(row.all_details_sent, filters.all_details_sent)) return false;
      if (filters.reminder) {
        const currentState = reminderState(row).toLowerCase();
        if (filters.reminder === 'none' && currentState !== 'no reminder') return false;
        if (filters.reminder !== 'none' && currentState !== filters.reminder) return false;
      }
      if (filters.comms && !matchesText(row.submission_comms || row.communication_skill, filters.comms)) return false;
      if (filters.preferred_location && !splitValues(row.location || row.preferred_location).some((item) => matchesText(item, filters.preferred_location))) return false;
      if (filters.submitted_from) {
        const start = new Date(filters.submitted_from).getTime();
        const current = new Date(row.submitted_at || 0).getTime();
        if (start && current && current < start) return false;
      }
      if (filters.submitted_to) {
        const end = new Date(filters.submitted_to).getTime();
        const current = new Date(row.submitted_at || 0).getTime();
        if (end && current && current > end) return false;
      }
      return true;
    }));
  }, [allRows, filters]);

  useEffect(() => {
    if (syncState !== 'saved') return undefined;
    const timer = window.setTimeout(() => setSyncState('idle'), 1200);
    return () => window.clearTimeout(timer);
  }, [syncState]);

  const queueSummary = useMemo(() => {
    const pendingRows = rows.filter((row) => lower(row.all_details_sent) === 'pending' || lower(row.approval_status) === 'pending');
    const buckets = {
      urgent: pendingRows.filter((row) => queueBucketForRow(row) === 'urgent'),
      approval: pendingRows.filter((row) => queueBucketForRow(row) === 'approval'),
      hot: pendingRows.filter((row) => queueBucketForRow(row) === 'hot'),
      old: pendingRows.filter((row) => queueBucketForRow(row) === 'old'),
      followup: pendingRows.filter((row) => queueBucketForRow(row) === 'followup'),
    };

    const mergedMap = new Map();
    Object.entries(buckets).forEach(([bucket, items]) => {
      items.forEach((row) => {
        if (!mergedMap.has(row.submission_id)) {
          mergedMap.set(row.submission_id, { ...row, queue_bucket: bucket });
        }
      });
    });

    const sorted = Array.from(mergedMap.values()).sort((a, b) => queuePriority(b) - queuePriority(a)).slice(0, 10);
    return { buckets, sorted };
  }, [rows]);

  const queueRows = useMemo(() => {
    if (queueTab === 'all') return queueSummary.sorted;
    return queueSummary.sorted.filter((row) => row.queue_bucket === queueTab);
  }, [queueSummary, queueTab]);

  useEffect(() => {
    const targetId = new URLSearchParams(location.search).get('submission_id');
    if (!targetId || !rows.length) return;
    const timer = window.setTimeout(() => {
      const node = document.getElementById(`submission-row-${targetId}`);
      if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [location.search, rows]);

  useEffect(() => {
    const due = rows
      .filter((row) => String(row.all_details_sent || '').toLowerCase() === 'pending')
      .filter((row) => reminderState(row) === 'Due')
      .sort((a, b) => String(a.next_follow_up_at || '').localeCompare(String(b.next_follow_up_at || '')))[0] || null;
    setPopupRow((current) => {
      if (!due) return null;
      return current?.submission_id === due.submission_id ? { ...current, ...due } : due;
    });
  }, [rows]);

  async function approve(row) {
    const beforeRows = [...rows];
    setSavingId(row.candidate_id);
    setMessage('');
    setSyncState('saving');
    setRows((current) => current.map((item) => item.candidate_id === row.candidate_id ? { ...item, approval_status: 'Approved' } : item));
    try {
      await api.post('/api/approvals/approve', { type: 'candidate', id: row.candidate_id });
      setRejectingId('');
      setRejectReason('');
      setMessage(`${row.full_name || row.candidate_id} approved successfully.`);
      setSyncState('saved');
      load().catch(() => {});
    } catch (err) {
      setRows(beforeRows);
      setMessage(err.message || 'Approval failed and the previous view was restored.');
      setSyncState('error');
    } finally { setSavingId(''); }
  }

  async function reject(row) {
    if (!rejectReason.trim()) return;
    const beforeRows = [...rows];
    const reasonText = rejectReason.trim();
    setSavingId(row.candidate_id);
    setMessage('');
    setSyncState('saving');
    setRows((current) => current.map((item) => item.candidate_id === row.candidate_id ? { ...item, approval_status: 'Rejected', status: 'Rejected', rejection_reason: reasonText } : item));
    try {
      await api.post('/api/approvals/reject', { type: 'candidate', id: row.candidate_id, reason: reasonText });
      setRejectingId('');
      setRejectReason('');
      setMessage(`${row.full_name || row.candidate_id} rejected successfully.`);
      setSyncState('saved');
      load().catch(() => {});
    } catch (err) {
      setRows(beforeRows);
      setMessage(err.message || 'Reject failed and the previous view was restored.');
      setSyncState('error');
    } finally { setSavingId(''); }
  }

  function openReminderModal(row) {
    const smart = getSmartReminderPreset(row);
    setReminderMeta(smart);
    setReminderModal(row);
    setReminderForm({
      hours: smart.hours,
      minutes: smart.minutes,
      exact_time: row.next_follow_up_at ? toDateTimeLocal(row.next_follow_up_at) : smart.exact_time,
      note: row.reminder_note || smart.note,
    });
  }

  async function saveReminder() {
    if (!reminderModal) return;
    let nextFollowUpAt = '';
    if (reminderForm.exact_time) {
      nextFollowUpAt = new Date(reminderForm.exact_time).toISOString();
    } else {
      const hours = Number(reminderForm.hours || 0);
      const minutes = Number(reminderForm.minutes || 0);
      nextFollowUpAt = addDuration(hours, minutes || (hours ? 0 : 3));
    }
    await api.post(`/api/submissions/${reminderModal.submission_id}/reminder`, {
      next_follow_up_at: nextFollowUpAt,
      reminder_snoozed_until: '',
      reminder_note: reminderForm.note,
    });
    setMessage(`Reminder saved for ${reminderModal.full_name || reminderModal.candidate_id}.`);
    setReminderModal(null);
    await load();
  }

  async function applySmartReminder(row) {
    const smart = getSmartReminderPreset(row);
    const nextFollowUpAt = smart.exact_time
      ? new Date(smart.exact_time).toISOString()
      : addDuration(smart.hours, smart.minutes || (smart.hours ? 0 : 3));
    await api.post(`/api/submissions/${row.submission_id}/reminder`, {
      next_follow_up_at: nextFollowUpAt,
      reminder_snoozed_until: '',
      reminder_note: smart.note,
    });
    setMessage(`Smart reminder applied for ${row.full_name || row.candidate_id}.`);
    await load();
  }

  async function snoozePopup(minutes) {
    if (!popupRow) return;
    const until = new Date(Date.now() + Number(minutes || 10) * 60000).toISOString();
    await api.post(`/api/submissions/${popupRow.submission_id}/reminder`, {
      next_follow_up_at: popupRow.next_follow_up_at,
      reminder_snoozed_until: until,
      reminder_note: popupRow.reminder_note || '',
    });
    setMessage(`Submission reminder snoozed for ${minutes} minutes.`);
    setPopupRow(null);
    await load();
  }

  function callCandidate(row) {
    dialCandidateWithLog(row.candidate_id, row.phone);
  }

  function openWhatsApp(row) {
    openWhatsAppWithLog(row.candidate_id, row.phone, '');
  }

  const pendingApprovalCount = useMemo(() => allRows.filter((row) => String(row.approval_status || '').toLowerCase() === 'pending').length, [allRows]);
  const pendingDetailsCount = useMemo(() => allRows.filter((row) => String(row.all_details_sent || '').toLowerCase() === 'pending').length, [allRows]);
  const completedDetailsCount = useMemo(() => allRows.filter((row) => String(row.all_details_sent || '').toLowerCase() === 'completed').length, [allRows]);
  const dueReminderCount = useMemo(() => allRows.filter((row) => reminderState(row) === 'Due').length, [allRows]);

  return (
    <Layout title="Submissions" subtitle={showOld ? 'Historic submission view.' : 'Current day submission view.'}>
      <div className="task-summary-grid top-gap-small">
        <button type="button" className={`metric-card colorful-card tone-orange task-summary-button ${filters.all_details_sent === 'Pending' ? 'metric-card-active' : ''}`} onClick={() => setFilters((current) => ({ ...current, all_details_sent: current.all_details_sent === 'Pending' ? '' : 'Pending' }))}>
          <span>Pending Profiles</span>
          <strong>{pendingDetailsCount}</strong>
          <small>All details sent pending</small>
        </button>
        <button type="button" className={`metric-card colorful-card tone-green task-summary-button ${filters.all_details_sent === 'Completed' ? 'metric-card-active' : ''}`} onClick={() => setFilters((current) => ({ ...current, all_details_sent: current.all_details_sent === 'Completed' ? '' : 'Completed' }))}>
          <span>Completed</span>
          <strong>{completedDetailsCount}</strong>
          <small>All details sent completed</small>
        </button>
        <button type="button" className={`metric-card colorful-card tone-blue task-summary-button ${filters.reminder === 'due' ? 'metric-card-active' : ''}`} onClick={() => setFilters((current) => ({ ...current, reminder: current.reminder === 'due' ? '' : 'due' }))}>
          <span>Due Reminder</span>
          <strong>{dueReminderCount}</strong>
          <small>Follow-up popup ready</small>
        </button>
        <button type="button" className="metric-card colorful-card tone-purple task-summary-button">
          <span>Pending Approval</span>
          <strong>{pendingApprovalCount}</strong>
          <small>Approve / reject still pending</small>
        </button>
      </div>

      <div className="table-panel top-gap-small glassy-card fade-up">
        <div className="table-toolbar no-wrap-toolbar">
          <div className="table-title">Submission View</div>
          <div className="toolbar-actions compact-pills candidate-toolbar-actions">
            <button type="button" className={`choice-chip bounceable ${!showOld ? 'active' : ''}`} onClick={() => setShowOld(false)}>Today</button>
            <button type="button" className={`choice-chip bounceable ${showOld ? 'active' : ''}`} onClick={() => setShowOld(true)}>Old Submissions</button>
            {showOld ? <input className="inline-input compact-days-input" type="number" min="1" value={days} onChange={(e) => setDays(e.target.value)} placeholder="Days" /> : null}
            <span className="mini-chip">{rows.length} records</span>
            <span className="mini-chip live-chip">{rows.filter((row) => String(row.all_details_sent || '').toLowerCase() === 'pending').length} pending</span>
            <span className={`mini-chip ${syncState === 'saving' ? 'live-chip' : syncState === 'saved' ? 'sync-chip saved' : syncState === 'error' ? 'sync-chip error' : ''}`}>{syncState === 'saving' ? 'Saving...' : syncState === 'saved' ? 'Saved' : syncState === 'error' ? 'Save failed' : 'Live Save'}</span>
          </div>
        </div>

        <div className="interview-quick-filter-strip submission-quick-filter-strip">
          <label className="compact-select-shell shell-indigo">
            <span className="compact-shell-label">Recruiter Code</span>
            {leadership ? (
              <select className="inline-input compact-inline-input" value={filters.recruiter_code} onChange={(e) => setFilters((current) => ({ ...current, recruiter_code: e.target.value }))}>
                <option value="">All</option>
                {recruiterOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            ) : (
              <select className="inline-input compact-inline-input" value={filters.recruiter_code || user?.recruiter_code || ''} disabled>
                <option value={filters.recruiter_code || user?.recruiter_code || ''}>{filters.recruiter_code || user?.recruiter_code || 'My submissions'}</option>
              </select>
            )}
          </label>
          <label className="compact-select-shell shell-cyan">
            <span className="compact-shell-label">All Details Sent</span>
            <select className="inline-input compact-inline-input" value={filters.all_details_sent} onChange={(e) => setFilters((current) => ({ ...current, all_details_sent: e.target.value }))}>
              <option value="">All</option>
              <option value="Pending">Pending</option>
              <option value="Completed">Completed</option>
            </select>
          </label>
          <label className="compact-select-shell shell-green">
            <span className="compact-shell-label">Reminder</span>
            <select className="inline-input compact-inline-input" value={filters.reminder} onChange={(e) => setFilters((current) => ({ ...current, reminder: e.target.value }))}>
              <option value="">All</option>
              <option value="due">Due</option>
              <option value="scheduled">Scheduled</option>
              <option value="none">No Reminder</option>
            </select>
          </label>
          <label className="compact-select-shell shell-peach">
            <span className="compact-shell-label">Communication</span>
            <select className="inline-input compact-inline-input" value={filters.comms} onChange={(e) => setFilters((current) => ({ ...current, comms: e.target.value }))}>
              <option value="">All</option>
              {communicationOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="compact-select-shell shell-gold">
            <span className="compact-shell-label">Preferred Location</span>
            <select className="inline-input compact-inline-input" value={filters.preferred_location} onChange={(e) => setFilters((current) => ({ ...current, preferred_location: e.target.value }))}>
              <option value="">All</option>
              {preferredLocationOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="compact-select-shell shell-violet">
            <span className="compact-shell-label">Submission From</span>
            <input className="inline-input compact-inline-input" type="datetime-local" value={filters.submitted_from} onChange={(e) => setFilters((current) => ({ ...current, submitted_from: e.target.value }))} />
          </label>
          <label className="compact-select-shell shell-blue">
            <span className="compact-shell-label">Submission To</span>
            <input className="inline-input compact-inline-input" type="datetime-local" value={filters.submitted_to} onChange={(e) => setFilters((current) => ({ ...current, submitted_to: e.target.value }))} />
          </label>
        </div>

        {!!message && <div className="helper-text top-gap-small">{message}</div>}

        {!!message && <div className={`helper-text top-gap-small sync-message ${syncState === 'error' ? 'is-error' : syncState === 'saved' ? 'is-success' : ''}`}>{message}</div>}

        <div className="crm-table-wrap dense-wrap top-gap-small submissions-table-wrap">
          <table className="crm-table colorful-table dense-table submissions-table slim-submissions-table compact-submissions-table readable-flow-table">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Recruiter</th>
                <th>Process</th>
                <th>Location</th>
                <th>Status</th>
                <th>Approval</th>
                <th>All Details Sent</th>
                <th>Next Follow-Up</th>
                <th>Submitted At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <React.Fragment key={row.submission_id}>
                  <tr id={`submission-row-${row.submission_id}`} className="clickable-row" onClick={() => navigate(`/candidate/${row.candidate_id}`)}>
                    <td><strong>{row.full_name || row.candidate_id}</strong><br /><span className="subtle">{row.candidate_id}</span></td>
                    <td>{row.recruiter_code || row.recruiter_name || '-'}</td>
                    <td>{row.process || '-'}</td>
                    <td>{row.location || row.preferred_location || '-'}</td>
                    <td><span className="status-chip">{row.status || '-'}</span></td>
                    <td><span className="status-chip secondary">{row.approval_status || '-'}</span></td>
                    <td>
                      <span className="status-chip secondary">{row.all_details_sent || 'Pending'}</span>
                      {String(row.all_details_sent || '').toLowerCase() === 'pending' ? <div className="helper-text submission-mini-text">Smart stage: {getSmartReminderPreset(row).label}</div> : null}
                    </td>
                    <td>
                      <div>{row.next_follow_up_at ? formatDate(row.next_follow_up_at) : 'Not set'}</div>
                      {row.next_follow_up_at ? <div className="helper-text submission-mini-text">{timeLeftText(row)}</div> : null}
                    </td>
                    <td>{formatDate(row.submitted_at)}</td>
                    <td className="table-action-cell submission-actions-cell" onClick={(e) => e.stopPropagation()}>
                      <div className="submission-action-stack">
                        <button className="mini-btn call bounceable" type="button" onClick={() => applySmartReminder(row)}>Smart</button>
                        <button className="mini-btn edit bounceable" type="button" onClick={() => openReminderModal(row)}>Reminder</button>
                        {leadership && String(row.approval_status || '').toLowerCase() === 'pending' ? (
                          <>
                            <button className="mini-btn call bounceable" type="button" disabled={savingId === row.candidate_id} onClick={() => approve(row)}>Approve</button>
                            <button className="mini-btn edit bounceable" type="button" onClick={() => { setRejectingId(rejectingId === row.candidate_id ? '' : row.candidate_id); setRejectReason(''); }}>Reject</button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {leadership && rejectingId === row.candidate_id ? (
                    <tr className="submissions-reject-row">
                      <td colSpan="10">
                        <div className="approval-inline-reject">
                          <textarea rows="2" placeholder="Reject note is required." value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                          <div className="row-actions top-gap-small">
                            <button className="mini-btn edit bounceable" type="button" disabled={!rejectReason.trim() || savingId === row.candidate_id} onClick={() => reject(row)}>Confirm Reject</button>
                            <button className="ghost-btn bounceable" type="button" onClick={() => { setRejectingId(''); setRejectReason(''); }}>Cancel</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              ))}
              {rows.length === 0 ? (
                <tr><td colSpan="10" className="helper-text">No submissions found for the selected window.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {reminderModal ? (
        <div className="crm-modal-backdrop task-modal-fix" onClick={() => setReminderModal(null)}>
          <div className="crm-premium-modal task-premium-modal task-modal-no-overlap" onClick={(e) => e.stopPropagation()}>
            <div className="panel-title">Set Submission Reminder</div>
            <div className="helper-text top-gap-small">Smart stage detected: <strong>{reminderMeta.label}</strong>. {reminderMeta.help}</div>
            <div className="compact-chip-row top-gap-small">
              {durationPresets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className={`choice-chip bounceable ${String(reminderForm.hours) === preset.hours && String(reminderForm.minutes) === preset.minutes && !reminderForm.exact_time ? 'active' : ''}`}
                  onClick={() => setReminderForm((current) => ({ ...current, hours: preset.hours, minutes: preset.minutes, exact_time: '' }))}
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                className={`choice-chip bounceable ${reminderMeta.exact_time ? (reminderForm.exact_time === reminderMeta.exact_time ? 'active' : '') : (String(reminderForm.hours) === reminderMeta.hours && String(reminderForm.minutes) === reminderMeta.minutes && !reminderForm.exact_time ? 'active' : '')}`}
                onClick={() => setReminderForm((current) => ({ ...current, hours: reminderMeta.hours, minutes: reminderMeta.minutes, exact_time: reminderMeta.exact_time }))}
              >
                Smart {reminderMeta.exact_time ? 'time' : `${reminderMeta.hours || 0}h ${reminderMeta.minutes || 0}m`}
              </button>
            </div>
            <div className="task-modal-grid top-gap-small compact-reminder-modal-grid">
              <div className="field"><label>Hours</label><input className="inline-input" type="number" min="0" value={reminderForm.hours} onChange={(e) => setReminderForm((current) => ({ ...current, hours: e.target.value, exact_time: '' }))} /></div>
              <div className="field"><label>Minutes</label><input className="inline-input" type="number" min="0" value={reminderForm.minutes} onChange={(e) => setReminderForm((current) => ({ ...current, minutes: e.target.value, exact_time: '' }))} /></div>
              <div className="field field-span-2"><label>Or Exact Time</label><input className="inline-input" type="datetime-local" value={reminderForm.exact_time} onChange={(e) => setReminderForm((current) => ({ ...current, exact_time: e.target.value }))} /></div>
              <div className="field field-span-2">
                <label>Stage Suggestions</label>
                <div className="compact-chip-row compact-chip-wrap">
                  {[...new Set([...reminderMeta.suggestions, ...baseNoteSuggestions])].map((note) => (
                    <button key={note} type="button" className="choice-chip bounceable" onClick={() => setReminderForm((current) => ({ ...current, note }))}>{note}</button>
                  ))}
                </div>
              </div>
              <div className="field field-span-2"><label>Reminder Note</label><textarea rows="4" value={reminderForm.note} onChange={(e) => setReminderForm((current) => ({ ...current, note: e.target.value }))} placeholder="Call done? WhatsApp sent? Next push?" /></div>
            </div>
            <div className="row-actions top-gap">
              <button className="add-profile-btn bounceable" type="button" onClick={saveReminder}>Save Reminder</button>
              <button className="ghost-btn bounceable" type="button" onClick={() => setReminderModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}

      {popupRow ? (
        <div style={{ position: 'fixed', right: 22, bottom: 24, width: 360, zIndex: 80 }}>
          <div className="panel approval-popup-panel" style={{ boxShadow: '0 24px 60px rgba(0,0,0,0.22)' }}>
            <div className="panel-title">Submission Reminder</div>
            <div className="helper-text">{popupRow.full_name} • {popupRow.process || '-'} • {popupRow.recruiter_code || '-'}</div>
            <div className="helper-text top-gap-small">All details are still pending for this submission. This reminder will continue until the follow-up is handled.</div>
            <div className="row-actions top-gap submission-popup-actions">
              <button className="ghost-btn bounceable" type="button" onClick={() => snoozePopup(5)}>Later 5m</button>
              <button className="ghost-btn bounceable" type="button" onClick={() => snoozePopup(10)}>Later 10m</button>
              <button className="ghost-btn bounceable" type="button" onClick={() => snoozePopup(15)}>Later 15m</button>
              <button className="ghost-btn bounceable" type="button" onClick={() => snoozePopup(30)}>Later 30m</button>
              <button className="ghost-btn bounceable" type="button" onClick={() => {
                const value = window.prompt('Custom remind later minutes', '15');
                if (value) snoozePopup(Number(value || 15));
              }}>Custom</button>
            </div>
          </div>
        </div>
      ) : null}
    </Layout>
  );
}
