import PremiumSelect from '../components/PremiumSelect';
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { openManagerProtectedExport, crmTodayYmd, crmYmd } from '../lib/workspaceHelpers';
import { mergeRowsById, useSmartDeltaSync } from '../lib/smartSync';
import { useAuth } from '../lib/auth';
import { downloadCsv, extractClientFields, readResumeFileText } from '../lib/importExtractors';

const emptyForm = {
  client_name: '',
  contact_person: '',
  contact_phone: '',
  contact_email: '',
  city: '',
  industry: '',
  status: 'Active',
  priority: 'Medium',
  openings_count: '',
  next_follow_up_at: '',
  notes: '',
};

function csvList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function ymdNow() {
  return crmTodayYmd();
}

function formatShortDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10) || '-';
  return date.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

export default function ClientPipelinePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const role = String(user?.role || '').toLowerCase();
  const isManager = ['admin', 'manager'].includes(role);

  const [rows, setRows] = useState([]);
  const [tlUsers, setTlUsers] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [selected, setSelected] = useState([]);
  const [rawText, setRawText] = useState('');
  const [extractorUrl, setExtractorUrl] = useState('');
  const [parsedRows, setParsedRows] = useState([]);
  const [extractorMode, setExtractorMode] = useState('raw');
  const [bulkMode, setBulkMode] = useState('bcc');
  const [quickFilter, setQuickFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [showClientEditor, setShowClientEditor] = useState(false);
  const [editingId, setEditingId] = useState('');

  async function load() {
    setLoading(true);
    try {
      const directory = api.get('/api/tasks/assignees', { cacheTtlMs: 300000, allowStale: true, timeoutMs: 12000 })
        .then((lookups) => setTlUsers((lookups.users || []).filter((item) => String(item.role || '').toLowerCase() === 'tl')))
        .catch(() => {});
      const clients = await api.get('/api/client-pipeline');
      setRows(clients.items || []);
      void directory;
    } catch (error) {
      setNotice(error.message || 'Unable to load client pipeline');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load().catch(() => {}); }, []);
  useSmartDeltaSync({
    scope: 'client-pipeline',
    idKey: 'lead_id',
    rows,
    onRows: (changedRows) => setRows((current) => mergeRowsById(current, changedRows, 'lead_id')),
  });

  const todayKey = ymdNow();

  const stats = useMemo(() => {
    const active = rows.filter((row) => String(row.status || '').toLowerCase() === 'active');
    const followUpDue = rows.filter((row) => crmYmd(row.next_follow_up_at) && crmYmd(row.next_follow_up_at) <= todayKey);
    const highPriority = rows.filter((row) => String(row.priority || '').toLowerCase() === 'high');
    const tlShared = rows.filter((row) => csvList(row.visible_to_tl_user_ids).length || csvList(row.visible_to_tl_codes).length || csvList(row.visible_to_tl_names).length);
    const mailReady = rows.filter((row) => String(row.contact_email || '').trim());
    const noFollowUp = rows.filter((row) => !String(row.next_follow_up_at || '').trim());
    return {
      active: active.length,
      followUpDue: followUpDue.length,
      highPriority: highPriority.length,
      tlShared: tlShared.length,
      mailReady: mailReady.length,
      noFollowUp: noFollowUp.length,
    };
  }, [rows, todayKey]);

  const selectedRows = useMemo(() => rows.filter((row) => selected.includes(row.lead_id)), [rows, selected]);

  const quickRows = useMemo(() => {
    switch (quickFilter) {
      case 'due':
        return rows.filter((row) => crmYmd(row.next_follow_up_at) && crmYmd(row.next_follow_up_at) <= todayKey);
      case 'high':
        return rows.filter((row) => String(row.priority || '').toLowerCase() === 'high');
      case 'shared':
        return rows.filter((row) => csvList(row.visible_to_tl_user_ids).length || csvList(row.visible_to_tl_codes).length || csvList(row.visible_to_tl_names).length);
      case 'mail':
        return rows.filter((row) => String(row.contact_email || '').trim());
      case 'nofollow':
        return rows.filter((row) => !String(row.next_follow_up_at || '').trim());
      case 'warm':
        return rows.filter((row) => ['warm', 'follow up'].includes(String(row.status || '').toLowerCase()));
      default:
        return rows;
    }
  }, [rows, quickFilter, todayKey]);

  const filteredRows = useMemo(() => quickRows.filter((row) => !search.trim() || [row.client_name, row.contact_person, row.contact_phone, row.contact_email, row.city, row.industry].some((value) => String(value || '').toLowerCase().includes(search.trim().toLowerCase()))), [quickRows, search]);

  function openClientEditor(row) {
    setEditingId(row?.lead_id || '');
    setForm(row ? { ...emptyForm, ...row, next_follow_up_at: crmYmd(row.next_follow_up_at) } : { ...emptyForm });
    setShowClientEditor(true);
  }

  function toggleSelected(id) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function createClient(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (editingId) await api.put(`/api/client-pipeline/${encodeURIComponent(editingId)}`, form);
      else await api.post('/api/client-pipeline', form);
      setForm(emptyForm);
      setShowClientEditor(false);
      setNotice(editingId ? 'Client updated' : 'Client added');
      await load();
    } catch (error) {
      setNotice(error.message || 'Client could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleTlVisibility(row, tl) {
    if (!isManager) return;
    const current = csvList(row.visible_to_tl_user_ids);
    const next = current.includes(tl.user_id) ? current.filter((item) => item !== tl.user_id) : [...current, tl.user_id];
    setBusy(true);
    try {
      await api.put(`/api/client-pipeline/${encodeURIComponent(row.lead_id)}`, {
        visible_to_tl_user_ids: next.join(', '),
        visible_to_tl_codes: next.map((id) => tlUsers.find((item) => item.user_id === id)?.recruiter_code).filter(Boolean).join(', '),
        visible_to_tl_names: next.map((id) => tlUsers.find((item) => item.user_id === id)?.full_name).filter(Boolean).join(', '),
      });
      setNotice('TL visibility updated');
      await load();
    } catch (error) {
      setNotice(error.message || 'Visibility could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  async function parseRaw() {
    setBusy(true);
    try {
      const result = await api.post('/api/client-pipeline/parse-raw', { raw_text: rawText });
      setParsedRows(result.items || []);
      setNotice(`Parsed ${result.items?.length || 0} rows`);
    } finally {
      setBusy(false);
    }
  }

  async function addParsed() {
    setBusy(true);
    try {
      await api.post('/api/client-pipeline/import-parsed', { items: parsedRows });
      setParsedRows([]);
      setRawText('');
      setExtractorUrl('');
      setNotice('Parsed data added to database');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function parseExtractorFiles(fileList) {
    const files = Array.from(fileList || []).slice(0, 20);
    if (!files.length) return;
    setBusy(true);
    try {
      const items = [];
      for (const file of files) {
        const text = await readResumeFileText(file);
        items.push({ ...extractClientFields(text, file.name), _source: file.name });
      }
      setParsedRows(items);
      setNotice(`Parsed ${items.length} file${items.length > 1 ? 's' : ''}`);
      setExtractorMode('files');
    } finally {
      setBusy(false);
    }
  }

  async function parsePublicUrl() {
    if (!extractorUrl.trim()) return;
    setBusy(true);
    try {
      const result = await api.post('/api/client-pipeline/extract-url', { url: extractorUrl.trim() }, { timeoutMs: 15000 });
      setParsedRows((result.items || []).map((item) => ({ ...item, _source: result.page?.title || result.page?.url || extractorUrl.trim() })));
      setNotice(`Parsed ${result.items?.length || 0} rows from public page`);
      setExtractorMode('url');
    } finally {
      setBusy(false);
    }
  }

  function patchParsedRow(index, patch) {
    setParsedRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function exportParsedCsv() {
    if (!parsedRows.length) return;
    downloadCsv(`client-extractor-${new Date().toISOString().slice(0, 10)}.csv`, parsedRows);
  }

  function openMailCentre(targetRows = selectedRows, mode = bulkMode) {
    const ids = targetRows.map((item) => item.lead_id).filter(Boolean);
    const query = new URLSearchParams();
    if (ids.length) query.set('clientIds', ids.join(','));
    query.set('mode', mode);
    navigate(`/mail-centre${query.toString() ? `?${query.toString()}` : ''}`);
  }

  async function dialSelected() {
    const target = selectedRows.find((row) => row.contact_phone);
    if (!target) return;
    try {
      await api.post('/api/dialer/manual-call', { phone: target.contact_phone, candidate_name: target.client_name || target.company_name || target.name || 'Client Call', process: 'Client Pipeline', note: 'Client pipeline app call' }, { timeoutMs: 18000 });
      setNotice('Call command sent to paired mobile app.');
    } catch (e) { setNotice(e.message || 'Pair/open mobile app first.'); }
  }

  return <Layout title="Client Pipeline">
    <div id="cc826-clients" className="cc826-studio cp-shell">
      <header className="cc826-studio-hero"><div><span className="cc826-eyebrow">CLIENT STUDIO</span><h2>Good contacts. Clear next moves.</h2></div><div className="cc826-actions"><button className="cp-btn warm" disabled={loading} onClick={load}>{loading ? 'Refreshing…' : 'Refresh'}</button>{isManager ? <button className="cp-btn primary" onClick={() => openClientEditor()}>+ New client</button> : null}</div></header>
      <div className="cp-card-row">
        {[['all','Total clients',rows.length,'peach'],['due','Follow-up due',stats.followUpDue,'sky'],['high','High priority',stats.highPriority,'purple'],['mail','Mail ready',stats.mailReady,'mint'],['shared','Shared with TL',stats.tlShared,'blue']].map(([key,label,count,tone]) => <button key={key} className={`cp-summary-card ${tone} ${quickFilter===key ? 'active' : ''}`} onClick={() => setQuickFilter(key)}><strong>{count}</strong><span>{label}</span></button>)}
      </div>
      {notice ? <div className="cp-banner" role="status">{notice}</div> : null}
      <section className="cp-panel"><div className="cp-toolbar"><input type="search" aria-label="Search clients" placeholder="Client, contact, phone or city…" value={search} onChange={e => setSearch(e.target.value)}/><PremiumSelect aria-label="Client view" value={quickFilter} onChange={e=>setQuickFilter(e.target.value)}>{[['all','All clients'],['due','Follow-up due'],['high','High priority'],['mail','Mail ready'],['shared','Shared with TL'],['nofollow','No follow-up date'],['warm','Warm / Follow up']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</PremiumSelect><button className="cp-btn warm" onClick={()=>{setSearch('');setQuickFilter('all');setSelected([]);}}>Clear filters</button></div>
      <div className="cp-quick-bar"><span className="cc826-count">{filteredRows.length} visible · {selectedRows.length} selected total</span><PremiumSelect aria-label="Mail mode" value={bulkMode} onChange={e=>setBulkMode(e.target.value)}><option value="bcc">Mail · BCC</option><option value="cc">Mail · CC</option></PremiumSelect><button className="cp-btn mint" disabled={!selectedRows.some(r=>r.contact_email)} onClick={()=>openMailCentre(selectedRows,bulkMode)}>Compose mail</button><button className="cp-btn lavender" disabled={!selectedRows.some(r=>r.contact_phone)} onClick={dialSelected}>Call first selected</button>{isManager ? <button className="cp-btn ghost" onClick={async()=>{try{await openManagerProtectedExport('/api/client-pipeline/export','client-pipeline/export');}catch(e){setNotice(e.message);}}}>Export Excel</button>:null}</div>
      <div className="cp-table-wrap">
              <table className="cp-table">
                <thead>
                  <tr>
                    <th><input aria-label="Select all visible clients" type="checkbox" checked={filteredRows.length > 0 && filteredRows.every(row => selected.includes(row.lead_id))} ref={el => { if (el) el.indeterminate = filteredRows.some(row => selected.includes(row.lead_id)) && !filteredRows.every(row => selected.includes(row.lead_id)); }} onChange={e => setSelected(current => e.target.checked ? [...new Set([...current, ...filteredRows.map(row => row.lead_id)])] : current.filter(id => !filteredRows.some(row => row.lead_id === id)))}/></th>
                    <th>Client</th>
                    <th>Contact</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Next Follow Up</th>
                    <th>TL Access</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const visibleToTl = csvList(row.visible_to_tl_user_ids);
                    const statusClass = ['warm', 'follow up'].includes(String(row.status || '').toLowerCase()) ? 'warm' : String(row.status || '').toLowerCase() === 'cold' ? 'cold' : '';
                    const priorityClass = String(row.priority || '').toLowerCase();
                    return (
                      <tr key={row.lead_id} className="cp-row">
                        <td><input aria-label={`Select ${row.client_name}`} type="checkbox" checked={selected.includes(row.lead_id)} onChange={() => toggleSelected(row.lead_id)} /></td>
                        <td>
                          <div className="cp-name" title={row.client_name}>{row.client_name}</div>
                          <div className="cp-muted">{row.city || '-'} • {row.industry || '-'}</div>
                          
                        </td>
                        <td>
                          <div className="cp-name" style={{ fontSize: 13 }}>{row.contact_person || '-'}</div>
                          <div className="cp-muted">{row.contact_phone || '-'}</div>
                          <div className="cp-muted">{row.contact_email || '-'}</div>
                        </td>
                        <td><span className={`cp-status ${statusClass}`}>{row.status || '-'}</span></td>
                        <td><span className={`cp-priority ${priorityClass || 'medium'}`}>{row.priority || '-'}</span></td>
                        <td>
                          <div className="cp-name" style={{ fontSize: 13 }}>{formatShortDate(row.next_follow_up_at)}</div>
                          <div className="cp-muted">Last: {formatShortDate(row.last_follow_up_at)}</div>
                        </td>
                        <td>
                          {isManager ? tlUsers.length ? tlUsers.map((tl) => (
                            <button key={tl.user_id} type="button" className={`cp-pill ${visibleToTl.includes(tl.user_id) ? 'selected' : ''}`} aria-pressed={visibleToTl.includes(tl.user_id)} disabled={busy} onClick={() => toggleTlVisibility(row, tl)}>
                              {tl.full_name}
                            </button>
                          )) : <span className="cp-muted">No TL users</span> : <span className="cp-muted">{csvList(row.visible_to_tl_names).length ? 'Shared by manager' : 'Private to manager'}</span>}
                        </td>
                        <td>
                          <div className="cp-actions">{isManager ? <button type="button" className="cp-link" onClick={() => openClientEditor(row)}>Edit</button> : null}
                            {row.contact_phone ? <button type="button" className="cp-link" onClick={async () => { try { await api.post('/api/dialer/manual-call', { phone: row.contact_phone, candidate_name: row.client_name || row.company_name || row.name || 'Client Call', process: 'Client Pipeline', note: 'Client pipeline app call' }, { timeoutMs: 18000 }); setNotice('Call command sent to paired mobile app.'); } catch(e) { setNotice(e.message || 'Pair/open mobile app first.'); } }}>App Call</button> : null}
                            {(row.contact_email || row.client_name) ? <button type="button" className="cp-link warm" onClick={() => openMailCentre([row], bulkMode)}>Mail Centre</button> : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!loading && !filteredRows.length ? (
                    <tr className="cp-row"><td colSpan="8">No client rows in this view.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
      </section>
      {showClientEditor && isManager ? <div className="cc826-modal-backdrop" onClick={()=>!busy && setShowClientEditor(false)}><section className="cc826-modal" role="dialog" aria-modal="true" aria-labelledby="client-editor-title" onClick={e=>e.stopPropagation()}><header className="cc826-modal-head"><h2 id="client-editor-title">{editingId ? 'Edit client' : 'New client'}</h2><button className="cp-btn ghost" disabled={busy} aria-label="Close client editor" onClick={()=>setShowClientEditor(false)}>Close</button></header><form className="cp-form" onSubmit={createClient}>
                  <div className="cp-field"><label>Client Name</label><input required value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} /></div>
                  <div className="cp-field"><label>Contact Person</label><input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></div>
                  <div className="cp-field"><label>Email</label><input type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} /></div>
                  <div className="cp-field"><label>Phone</label><input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} /></div>
                  <div className="cp-field"><label>City</label><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
                  <div className="cp-field"><label>Industry</label><input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} /></div>
                  <div className="cp-field"><label>Status</label><PremiumSelect value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option>Active</option><option>Follow Up</option><option>Warm</option><option>Cold</option></PremiumSelect></div>
                  <div className="cp-field"><label>Priority</label><PremiumSelect value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option>High</option><option>Medium</option><option>Low</option></PremiumSelect></div>
                  <div className="cp-field"><label>Openings</label><input value={form.openings_count} onChange={(e) => setForm({ ...form, openings_count: e.target.value })} /></div>
                  <div className="cp-field"><label>Next Follow Up</label><input type="date" value={form.next_follow_up_at} onChange={(e) => setForm({ ...form, next_follow_up_at: e.target.value })} /></div>
                  <div className="cp-field full"><label>Notes</label><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
                  <div className="cp-field full"><button type="submit" className="cp-btn primary" disabled={busy || !form.client_name}>{busy ? 'Saving…' : editingId ? 'Save changes' : 'Add client'}</button></div>
                </form></section></div>:null}
    </div>
  </Layout>;
}
