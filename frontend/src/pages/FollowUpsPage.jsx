import {useSliceState,CrmSortSelect,sortCrmRows} from '../lib/workspaceHelpers';
import { toCrmDateTimeLocalInput, formatCrmTime, formatCrmDate } from '../lib/workspaceHelpers';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { openCandidateProfileInNewTab } from '../lib/candidateNav';
import { readViewState, writeViewState } from '../lib/workspaceHelpers';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { mergeRowsById, useSmartDeltaSync } from '../lib/smartSync';
import { useDashboardAuth as useAuth } from '../lib/auth';
import { visiblePhone } from '../lib/candidateAccess';
import { readPageCache, writePageCache } from '../lib/persistentPageCache';
import { isSameCrmDay } from '../lib/workspaceHelpers';


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

function toTime(value) { return formatCrmTime(value); }

function toDate(value) { return formatCrmDate(value); }

const FOLLOWUPS_VIEW_STATE_KEY = 'careerCroxFollowUpsViewState_v1';

const FOLLOWUPS_CACHE_KEY = 'careerCroxFollowUpsRows:v2';

function addMinutes(minutes) { return toCrmDateTimeLocalInput(Date.now()+Number(minutes||0)*60000); }

export default function FollowUpsPage() {
  const { user } = useAuth();
  const storedViewState = readViewState(FOLLOWUPS_VIEW_STATE_KEY, {});
  const [items, setItems] = useState(() => safeRows(readPageCache(FOLLOWUPS_CACHE_KEY, [])));
  const [busyId, setBusyId] = useState('');
  const loadSeqRef = useRef(0);

  async function load(options = {}) {
    const force = Boolean(options.force);
    const loadSeq = ++loadSeqRef.current;
    // CC26_700: the visible cards are already hydrated from the local page cache.
    // Only explicit manual refresh should bypass the normal GET cache.
    const endpoint = force ? '/api/followups/upcoming?include_completed=1&_refresh=1' : '/api/followups/upcoming?include_completed=1';
    const data = await api.get(endpoint, { cacheTtlMs: force ? 0 : 60000, timeoutMs: 15000, retries: 0, allowStale: !force, background: false });
    if (loadSeq !== loadSeqRef.current) return;
    const nextItems = safeRows(data?.items);
    setItems(nextItems);
    writePageCache(FOLLOWUPS_CACHE_KEY, nextItems);
  }

  useEffect(() => { load().catch(() => {}); }, []);
  useSmartDeltaSync({
    onInvalidate:()=>load({force:true}).catch(()=>{}),
    scope: 'followups',
    idKey: 'candidate_id',
    rows: items,
    onRows: (changedRows) => setItems((current) => {
      const next = mergeRowsById(current, changedRows, 'candidate_id');
      writePageCache(FOLLOWUPS_CACHE_KEY, next);
      return next;
    }),
  });

  const [clockMinute,setClockMinute]=useState(()=>Math.floor(Date.now()/60000));
  useEffect(()=>{const timer=setInterval(()=>setClockMinute(Math.floor(Date.now()/60000)),60000);return()=>clearInterval(timer);},[]);
  const groups = useMemo(() => {
    const now = Date.now();
    const inHour = [];
    const nextHour = [];
    const today = [];
    const upcoming = [];
    const overdue = [];
    const completed = [];
    for (const row of items) {
      if (String(row.follow_up_status||'').toLowerCase()==='done') { completed.push(row); continue; }
      const due = new Date(row.follow_up_at || 0).getTime();
      if (!due) continue;
      const diff = due - now;
      const sameDay = isSameCrmDay(due, now);
      if (diff <= 0) overdue.push(row);
      if (diff >= 0 && diff <= 3600000) inHour.push(row);
      if (diff > 3600000 && diff <= 7200000) nextHour.push(row);
      if (sameDay) today.push(row);
      if (diff > 0) upcoming.push(row);
    }
    return { inHour, nextHour, today, upcoming, overdue, completed };
  }, [items,clockMinute]);

  async function markDone(row) {
    const id = String(row?.candidate_id || '');
    if (!id) return;
    const before = items;
    const next = before.map(item=>String(item.candidate_id)===id?{...item,follow_up_status:'Done',follow_up_completed_at:new Date().toISOString()}:item);
    setBusyId(id);
    setItems(next);
    writePageCache(FOLLOWUPS_CACHE_KEY, next);
    try {
      await api.post('/api/followups/action', { candidate_id: id, follow_up_status: 'Done', follow_up_note: 'Closed from FollowUps page', follow_up_at: '' });
      load({ force: true }).catch(() => {});
    } catch {
      setItems(before);
      writePageCache(FOLLOWUPS_CACHE_KEY, before);
    } finally {
      setBusyId('');
    }
  }

  async function snooze(row, minutes) {
    const id = String(row?.candidate_id || '');
    if (!id) return;
    const nextTime = addMinutes(minutes);
    const before = items;
    const next = before.map((item) => String(item.candidate_id) === id ? { ...item, follow_up_at: nextTime, follow_up_status: 'Open', follow_up_note: `Rescheduled by ${minutes} minutes` } : item);
    setBusyId(id);
    setItems(next);
    writePageCache(FOLLOWUPS_CACHE_KEY, next);
    try {
      await api.post('/api/followups/action', {
        candidate_id: id,
        follow_up_status: 'Open',
        follow_up_note: `Rescheduled by ${minutes} minutes`,
        follow_up_at: nextTime,
      });
      load({ force: true }).catch(() => {});
    } catch {
      setItems(before);
      writePageCache(FOLLOWUPS_CACHE_KEY, before);
    } finally {
      setBusyId('');
    }
  }

  function Card({ title, count, tone, onClick,cardKey }) {
    return (
      <button type="button" aria-pressed={filterKey===cardKey} className={`metric-card colorful-card ${tone} task-summary-button ${filterKey===cardKey?'metric-card-active':''}`}  onClick={onClick}>
        <span>{title}</span>
        <strong>{count}</strong>
        <small>Open filtered list</small>
      </button>
    );
  }

  const [filterKey, setFilterKey] = useState(storedViewState.filterKey || 'inHour');
  const filteredRows = groups[filterKey] || [];

  useEffect(() => {
    writeViewState(FOLLOWUPS_VIEW_STATE_KEY, { filterKey });
  }, [filterKey]);

  function openCandidateProfile(row) {
    if (!row?.candidate_id) return;
    const navRows = filteredRows.length ? filteredRows : (items.length ? items : []);
    openCandidateProfileInNewTab(row, navRows, { sourcePath: `${window.location.pathname}${window.location.search || ''}`, sourceKind: 'followups', totalRows: navRows.length, hasMore: false });
  }

  return (
    <Layout title="FollowUps" subtitle="Follow-up Pulse • now, next, and upcoming">
      <div className="workflow-summary-grid top-gap-small">
        <Card title="This Hour" count={groups.inHour.length} tone="tone-red" cardKey="inHour" onClick={() => setFilterKey('inHour')} />
        <Card title="Next Hour" count={groups.nextHour.length} tone="tone-orange" cardKey="nextHour" onClick={() => setFilterKey('nextHour')} />
        <Card title="Today" count={groups.today.length} tone="tone-blue" cardKey="today" onClick={() => setFilterKey('today')} />
        <Card title="Upcoming" count={groups.upcoming.length} tone="tone-green" cardKey="upcoming" onClick={() => setFilterKey('upcoming')} />
        <Card title="Completed" count={groups.completed.length} tone="tone-green" cardKey="completed" onClick={() => setFilterKey('completed')} />
        <Card title="Overdue" count={groups.overdue.length} tone="tone-violet" cardKey="overdue" onClick={() => setFilterKey('overdue')} />
      </div>

      <div className="table-panel top-gap glassy-card fade-up">
        <div className="table-toolbar no-wrap-toolbar">
          <div className="table-title">{filterKey === 'completed' ? 'Completed FollowUps' : filterKey === 'inHour' ? 'This Hour FollowUps' : filterKey === 'nextHour' ? 'Next Hour FollowUps' : filterKey === 'today' ? 'Today FollowUps' : filterKey === 'upcoming' ? 'Upcoming FollowUps' : 'Overdue FollowUps'}</div>
          <div className="toolbar-actions compact-pills top-toolbar-safe">
            <span className="mini-chip">{filteredRows.length} visible</span>
            <span className="mini-chip live-chip">On-demand refresh</span>
            <button className="ghost-btn bounceable" type="button" onClick={() => load({ force: true })}>Update Details</button>
          </div>
        </div>
      </div>

      <div className="table-panel top-gap glassy-card fade-up">
        <div className="crm-table-wrap dense-wrap">
          <table className="crm-table colorful-table dense-table readable-flow-table followups-readable-table">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Recruiter</th>
                <th>Phone</th>
                <th>FollowUp Date</th>
                <th>Time</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr key={safeCellText(row.candidate_id, '-')} className="clickable-row" onClick={() => openCandidateProfile(row)}>
                  <td><strong className="cc826-row-name" title={safeCellText(row.full_name)}>{safeCellText(row.full_name, '-')}</strong><span className="cc826-row-note" title={safeCellText(row.follow_up_note || row.followup_note)}>{safeCellText(row.candidate_id, '-')}{row.follow_up_note || row.followup_note ? ` · ${safeCellText(row.follow_up_note || row.followup_note)}` : ''}</span></td>
                  <td>{safeCellText(row.recruiter_name || 'Team member', '-')}</td>
                  <td>{visiblePhone(user, row.phone)}</td>
                  <td>{toDate(row.follow_up_at)}</td>
                  <td>{toTime(row.follow_up_at)}</td>
                  <td><span className={`workflow-status-pill ${String(row.is_due) === 'true' || row.is_due ? 'warning' : 'success'}`}>{safeCellText(row.follow_up_status, 'Open')}</span></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="workflow-inline-actions">
                      <button type="button" className="mini-btn view bounceable highlight-choice highlight-strong" onClick={() => openCandidateProfile(row)}>Open Profile</button>
                      <button type="button" className="mini-btn call bounceable" disabled={busyId === row.candidate_id} onClick={() => markDone(row)}>{'Done'}</button>
                      <button type="button" className="ghost-btn bounceable" disabled={busyId === row.candidate_id} onClick={() => snooze(row, 5)}>+5m</button>
                      <button type="button" className="ghost-btn bounceable" disabled={busyId === row.candidate_id} onClick={() => snooze(row, 10)}>+10m</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!filteredRows.length ? <tr><td colSpan="7" className="helper-text">No follow-ups in this bucket right now.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
