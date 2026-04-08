import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';

export default function ApprovalsPage() {
  const [rows, setRows] = useState([]);
  const [activeReject, setActiveReject] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [syncState, setSyncState] = useState('idle');

  async function load() {
    const data = await api.get('/api/approvals?scope=ops');
    setRows(data.items || []);
  }

  useEffect(() => { load(); }, []);
  usePolling(load, 3000, []);
  useEffect(() => {
    if (syncState !== 'saved') return undefined;
    const timer = window.setTimeout(() => setSyncState('idle'), 1200);
    return () => window.clearTimeout(timer);
  }, [syncState]);

  async function approve(item) {
    const beforeRows = [...rows];
    setRows((current) => current.filter((row) => !(row.type === item.type && row.id === item.id)));
    setMessage(`${item.title || item.id} approved instantly.`);
    setSyncState('saving');
    try {
      await api.post('/api/approvals/approve', { type: item.type, id: item.id });
      setSyncState('saved');
      load().catch(() => {});
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
    setMessage(`${item.title || item.id} rejected instantly.`);
    setSyncState('saving');
    try {
      await api.post('/api/approvals/reject', { type: item.type, id: item.id, reason: reasonText });
      setSyncState('saved');
      load().catch(() => {});
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
      load().catch(() => {});
    } catch (err) {
      setRows(beforeRows);
      setMessage(err.message || 'Approve all failed. UI rolled back.');
      setSyncState('error');
    }
  }

  return (
    <Layout title="Approvals" subtitle="Operational approvals for CRM access, interview changes, and learning requests.">
      <div className="table-panel top-gap-small glassy-card fade-up"><div className="table-toolbar"><div className="table-title">Operational Approvals</div><div className="toolbar-actions compact-pills"><span className={`mini-chip ${syncState === 'saving' ? 'live-chip' : syncState === 'saved' ? 'sync-chip saved' : syncState === 'error' ? 'sync-chip error' : ''}`}>{syncState === 'saving' ? 'Syncing...' : syncState === 'saved' ? 'Synced' : syncState === 'error' ? 'Sync failed' : '3s live refresh'}</span></div></div></div>
      {message ? <div className={`helper-text top-gap-small sync-message ${syncState === 'error' ? 'is-error' : syncState === 'saved' ? 'is-success' : ''}`}>{message}</div> : null}
      <div className="panel top-gap"><div className="crm-table-wrap dense-wrap"><table className="crm-table colorful-table dense-table"><thead><tr><th>Type</th><th>Title</th><th>Requested By</th><th>Extra</th><th>Requested At</th><th>Actions</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.type}_${row.id}`}><td>{row.type}</td><td>{row.type === 'candidate' ? <button type="button" className="link-like" onClick={() => window.open(`/candidate/${row.candidate_id}`, '_blank', 'noopener,noreferrer')}>{row.title}</button> : row.title}</td><td>{row.recruiter_name || '-'}</td><td>{row.process || '-'}</td><td>{row.requested_at || '-'}</td><td><div className="row-actions"><button className="mini-btn view bounceable" type="button" onClick={() => row.candidate_id && window.open(`/candidate/${row.candidate_id}`, '_blank', 'noopener,noreferrer')}>Open</button><button className="mini-btn call bounceable" type="button" onClick={() => approve(row)}>Approve</button><button className="mini-btn edit bounceable" type="button" onClick={() => setActiveReject(activeReject === row.id ? '' : row.id)}>Reject</button></div>{activeReject === row.id && <div className="field top-gap-small"><textarea rows="2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reject note required"></textarea><button className="ghost-btn bounceable top-gap-small" type="button" onClick={() => reject(row)}>Save Reject Note</button></div>}</td></tr>)}{rows.length === 0 && <tr><td colSpan="6" className="helper-text">No operational approvals pending.</td></tr>}</tbody></table></div></div>
    </Layout>
  );
}
