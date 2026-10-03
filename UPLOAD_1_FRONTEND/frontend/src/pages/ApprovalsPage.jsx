import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { openCandidateProfileInNewTab } from '../lib/candidateNav';


function safeRows(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function safeCellText(value, fallback = '-') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map((item) => safeCellText(item, '')).filter(Boolean).join(', ') || fallback;
  try {
    const compact = JSON.stringify(value);
    return compact === undefined ? fallback : compact;
  } catch {
    return fallback;
  }
}

export default function ApprovalsPage() {
  const [rows, setRows] = useState([]);
  const [activeReject, setActiveReject] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [syncState, setSyncState] = useState('idle');

  async function load() {
    const data = await api.get('/api/approvals?scope=ops', { cacheTtlMs: 0, timeoutMs: 12000 });
    setRows(data.items || []);
  }

  async function manualRefreshApprovals() {
    setSyncState('saving');
    setMessage('Refreshing approvals...');
    try {
      await load();
      setSyncState('saved');
      setMessage('Approvals refreshed.');
    } catch (err) {
      setSyncState('error');
      setMessage(err.message || 'Refresh failed.');
    }
  }

  useEffect(() => { load().catch(() => {}); }, []);
  useEffect(() => {
    const onRequest = () => { if (!document.hidden && !window.__CC602_NETWORK_PAUSED__) load().catch(() => {}); };
    window.addEventListener('cc609:approval-request', onRequest);
    return () => window.removeEventListener('cc609:approval-request', onRequest);
  }, []);
  // CC26_603: approvals update only on explicit Check / Refresh button.
  useEffect(() => {
    if (syncState !== 'saved') return undefined;
    const timer = window.setTimeout(() => setSyncState('idle'), 1200);
    return () => window.clearTimeout(timer);
  }, [syncState]);

  async function approve(item, decision = '') {
    const beforeRows = [...rows];
    setRows((current) => current.filter((row) => !(row.type === item.type && row.id === item.id)));
    setMessage(`${item.title || item.id}: saving approval…`);
    setSyncState('saving');
    try {
      await api.post('/api/approvals/approve', { type: item.type, id: item.id, decision });
      setSyncState('saved');
      // CC26_604: no automatic full approval re-read after each write; manual refresh is available.
    } catch (err) {
      setRows(beforeRows);
      setMessage(err.message || 'Approval failed. UI rolled back.');
      setSyncState('error');
    }
  }

  async function reject(item) {
    if (!reason.trim()) return;
    const beforeRows = [...rows];
    const reasonText = reason.trim();
    setRows((current) => current.filter((row) => !(row.type === item.type && row.id === item.id)));
    setActiveReject('');
    setReason('');
    setMessage(`${item.title || item.id}: saving rejection…`);
    setSyncState('saving');
    try {
      await api.post('/api/approvals/reject', { type: item.type, id: item.id, reason: reasonText });
      setSyncState('saved');
      // CC26_604: no automatic full approval re-read after each write; manual refresh is available.
    } catch (err) {
      setRows(beforeRows);
      setActiveReject(item.id);
      setReason(reasonText);
      setMessage(err.message || 'Reject failed. UI rolled back.');
      setSyncState('error');
    }
  }

  async function approveAll() {
    const beforeRows = [...rows];
    setRows([]);
    setMessage('All visible operational approvals cleared.');
    setSyncState('saving');
    try {
      await api.post('/api/approvals/approve-all', {});
      setSyncState('saved');
      // CC26_604: no automatic full approval re-read after each write; manual refresh is available.
    } catch (err) {
      setRows(beforeRows);
      setMessage(err.message || 'Approve all failed. UI rolled back.');
      setSyncState('error');
    }
  }

  return (
    <Layout title="Approvals" subtitle="">
      <div className="table-panel top-gap-small glassy-card fade-up cc604-approval-page-hero"><div className="table-toolbar"><div className="table-title">Operational Approvals <span className="cc604-approval-count">{rows.length} pending</span></div><div className="toolbar-actions compact-pills"><span className={`mini-chip ${syncState === 'saving' ? 'live-chip' : syncState === 'saved' ? 'sync-chip saved' : syncState === 'error' ? 'sync-chip error' : ''}`}>{syncState === 'saving' ? 'Saving…' : syncState === 'saved' ? 'Updated' : syncState === 'error' ? 'Update failed' : 'Manual mode'}</span><button className="mini-btn view bounceable" type="button" disabled={syncState === 'saving'} onClick={manualRefreshApprovals}>{'Refresh Now'}</button></div></div></div>
      {rows.some((item) => item.type === 'attendance_report') ? <div className="helper-text cc628-day-status-help">Attendance decisions: <strong>Short shift</strong> = joined office, but active work was below the required minimum. <strong>Did not join</strong> = no recorded office session. Both count as 0-day credit; they have different attendance reasons. Reports stay pending until you choose a decision, even after closing your laptop.</div> : null}
      {message ? <div className={`helper-text top-gap-small sync-message ${syncState === 'error' ? 'is-error' : syncState === 'saved' ? 'is-success' : ''}`}>{message}</div> : null}
      <div className="panel top-gap cc604-approval-page-table"><div className="crm-table-wrap dense-wrap"><table className="crm-table colorful-table dense-table"><thead><tr><th>Type</th><th>Title</th><th>Requested By</th><th>Extra</th><th>Requested At</th><th>Actions</th></tr></thead><tbody>{safeRows(rows).map((row) => <tr key={`${safeCellText(row.type, '-')}_${safeCellText(row.id, '-')}`}><td>{safeCellText(row.type, '-')}</td><td>{row.type === 'candidate' ? <button type="button" className="link-like" onClick={() => openCandidateProfileInNewTab(row.candidate_id)}>{safeCellText(row.title, '-')}</button> : row.title}</td><td>{safeCellText(row.recruiter_name, '-')}</td><td>{safeCellText(row.process, '-')}</td><td>{safeCellText(row.requested_at, '-')}</td><td>{row.type === 'attendance_report' ? <div className="row-actions compact-pills"><button className="mini-btn call bounceable cc609-full-day" type="button" onClick={() => approve(row, 'Full Day')}>Full Day</button><button className="mini-btn view bounceable cc609-half-day" type="button" onClick={() => approve(row, 'Half Day')}>Half Day</button><button className="mini-btn edit bounceable cc609-zero-day" type="button" title="Employee joined office but recorded fewer than 5 productive work hours; 0-day attendance credit." onClick={() => approve(row, 'Zero Day')}>Short shift · 0 day</button><button className="ghost-btn bounceable cc609-no-work" type="button" title="Employee did not join office or has no recorded office session; 0-day attendance credit." onClick={() => approve(row, 'No Work Day')}>Did not join · 0 day</button></div> : <div className="row-actions"><button className="mini-btn view bounceable cc609-open" type="button" onClick={() => row.candidate_id ? openCandidateProfileInNewTab(row.candidate_id) : row.type === 'unlock' && window.dispatchEvent(new CustomEvent('cc609:show-note', { detail: row }))}>Open</button><button className="mini-btn call bounceable cc609-approve" type="button" onClick={() => approve(row)}>Approve</button><button className="mini-btn edit bounceable cc609-reject" type="button" onClick={() => setActiveReject(activeReject === row.id ? '' : row.id)}>Reject</button></div>}{activeReject === row.id && <div className="field top-gap-small"><textarea rows="2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reject note required"></textarea><button className="ghost-btn bounceable top-gap-small" type="button" onClick={() => reject(row)}>Save Reject Note</button></div>}</td></tr>)}{rows.length === 0 && <tr><td colSpan="6" className="helper-text">No operational approvals pending.</td></tr>}</tbody></table></div></div>
    </Layout>
  );
}
