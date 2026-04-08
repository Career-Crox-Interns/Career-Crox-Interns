import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';
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
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

  async function load() {
    setLoading(true);
    try {
      const [clients, lookups] = await Promise.all([
        api.get('/api/client-pipeline'),
        api.get('/api/ui/lookups'),
      ]);
      setRows(clients.items || []);
      setTlUsers((lookups.users || []).filter((item) => String(item.role || '').toLowerCase() === 'tl'));
    } catch (error) {
      setNotice(error.message || 'Unable to load client pipeline');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  usePolling(load, 10000, []);

  const todayKey = ymdNow();

  const stats = useMemo(() => {
    const active = rows.filter((row) => String(row.status || '').toLowerCase() === 'active');
    const followUpDue = rows.filter((row) => String(row.next_follow_up_at || '').slice(0, 10) && String(row.next_follow_up_at || '').slice(0, 10) <= todayKey);
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

  const filteredRows = useMemo(() => {
    switch (quickFilter) {
      case 'due':
        return rows.filter((row) => String(row.next_follow_up_at || '').slice(0, 10) && String(row.next_follow_up_at || '').slice(0, 10) <= todayKey);
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

  function toggleSelected(id) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function createClient(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/client-pipeline', form);
      setForm(emptyForm);
      setNotice('Client added');
      await load();
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

  function dialSelected() {
    const target = selectedRows.find((row) => row.contact_phone);
    if (!target) return;
    window.location.href = `tel:${target.contact_phone}`;
  }

  return (
    <Layout title="Client Pipeline" subtitle="Client list, call flow, TL visibility, raw data parsing and a separate mail section that no longer eats the whole page.">
      <style>{`
        .cp-shell{display:flex;flex-direction:column;gap:16px}
        .cp-card-row{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px}
        .cp-summary-card{border:none;border-radius:26px;padding:18px 18px 16px;color:#fff;cursor:pointer;box-shadow:0 20px 38px rgba(43,69,131,.14);text-align:left;transition:transform .18s ease, box-shadow .18s ease}
        .cp-summary-card:hover,.cp-summary-card.active{transform:translateY(-2px);box-shadow:0 24px 42px rgba(43,69,131,.20)}
        .cp-summary-card strong{display:block;font-size:30px;line-height:1;font-weight:900}
        .cp-summary-card span{display:block;margin-top:8px;font-size:14px;font-weight:800}
        .cp-summary-card small{display:block;margin-top:8px;font-size:12px;line-height:1.45;opacity:.92}
        .cp-summary-card.peach{background:linear-gradient(135deg,#ffb064,#fb7d97)}
        .cp-summary-card.blue{background:linear-gradient(135deg,#64b0ff,#6079ff)}
        .cp-summary-card.sky{background:linear-gradient(135deg,#77c8ff,#78e2ff);color:#0d3769}
        .cp-summary-card.purple{background:linear-gradient(135deg,#7b8dff,#8d66ff)}
        .cp-summary-card.mint{background:linear-gradient(135deg,#74d7c0,#6fb8ff)}
        .cp-grid{display:grid;grid-template-columns:minmax(0,1.22fr) minmax(360px,.78fr);gap:16px}
        .cp-panel{background:linear-gradient(180deg,rgba(255,255,255,.97),rgba(246,250,255,.95));border:1px solid rgba(102,132,212,.12);border-radius:28px;box-shadow:0 18px 44px rgba(44,71,132,.10);padding:18px}
        .cp-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
        .cp-title{font-size:22px;font-weight:900;color:#18356f;margin-bottom:4px}
        .cp-sub{font-size:12px;line-height:1.5;color:#61708f;max-width:720px}
        .cp-banner{padding:12px 14px;border-radius:18px;background:linear-gradient(135deg,rgba(80,121,255,.10),rgba(118,102,255,.10));margin-top:12px;color:#23417c;font-weight:700}
        .cp-quick-bar{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
        .cp-btn{border:none;border-radius:16px;padding:11px 16px;font-weight:800;cursor:pointer;transition:.18s ease}.cp-btn.primary{background:linear-gradient(135deg,#4d78ff,#7d67ff);color:#fff;box-shadow:0 14px 24px rgba(62,96,194,.22)}.cp-btn.ghost{background:rgba(74,116,255,.08);color:#35539c}.cp-btn.warm{background:linear-gradient(135deg,#ffb261,#fb7d96);color:#fff}
        .cp-checks{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:18px}
        .cp-check-card{border:none;border-radius:22px;padding:16px;background:linear-gradient(135deg,#ffffff,#f4f8ff);box-shadow:0 14px 26px rgba(47,77,140,.08);cursor:pointer;text-align:left}
        .cp-check-card strong{display:block;font-size:22px;font-weight:900;color:#15336f}
        .cp-check-card span{display:block;margin-top:8px;font-size:13px;font-weight:800;color:#294b93}
        .cp-check-card small{display:block;margin-top:6px;font-size:12px;color:#61708f;line-height:1.45}
        .cp-table-wrap{overflow:auto;margin-top:18px;border-radius:24px;background:linear-gradient(180deg,rgba(247,250,255,.84),rgba(242,247,255,.92));padding:8px}
        .cp-table{width:100%;border-collapse:separate;border-spacing:0 10px;min-width:1020px}
        .cp-table th{padding:0 12px 8px;text-align:left;font-size:11px;font-weight:900;color:#5f7092;text-transform:uppercase;letter-spacing:.08em}
        .cp-row{background:#fff;box-shadow:0 14px 24px rgba(47,77,140,.06)}
        .cp-row td{padding:14px 12px;font-size:12px;color:#204078;vertical-align:top;border-top:1px solid rgba(111,138,212,.08);border-bottom:1px solid rgba(111,138,212,.08)}
        .cp-row td:first-child{border-left:1px solid rgba(111,138,212,.08);border-radius:18px 0 0 18px}
        .cp-row td:last-child{border-right:1px solid rgba(111,138,212,.08);border-radius:0 18px 18px 0}
        .cp-name{font-size:14px;font-weight:900;color:#15336f}
        .cp-muted{font-size:12px;color:#61708f;line-height:1.45;margin-top:4px}
        .cp-status,.cp-priority{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;font-size:11px;font-weight:900}
        .cp-status{background:rgba(90,222,177,.16);color:#137458}.cp-status.warm{background:rgba(255,172,96,.18);color:#9d4e07}.cp-status.cold{background:rgba(124,138,173,.14);color:#50617f}.cp-priority.high{background:rgba(252,119,151,.16);color:#b12646}.cp-priority.medium{background:rgba(98,129,255,.14);color:#35539c}.cp-priority.low{background:rgba(90,222,177,.16);color:#137458}
        .cp-pill{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:rgba(80,121,255,.10);font-size:11px;font-weight:800;color:#35539c;margin-right:6px;margin-bottom:6px;cursor:pointer;border:none}
        .cp-actions{display:flex;gap:8px;flex-wrap:wrap}.cp-link{border:none;background:rgba(74,116,255,.08);color:#35539c;padding:8px 10px;border-radius:12px;font-weight:800;cursor:pointer}.cp-link.warm{background:rgba(255,176,100,.16);color:#a24d08}
        .cp-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:16px}.cp-field{display:flex;flex-direction:column;gap:6px}.cp-field.full{grid-column:1/-1}
        .cp-field label{font-size:12px;font-weight:800;color:#55647f;text-transform:uppercase;letter-spacing:.06em}
        .cp-field input,.cp-field textarea,.cp-field select{width:100%;border:none;outline:none;border-radius:16px;padding:12px 14px;background:linear-gradient(180deg,#fff,#f5f8ff);box-shadow:inset 0 0 0 1px rgba(107,133,214,.18),0 8px 18px rgba(44,72,137,.08);color:#17346d}
        .cp-field textarea{min-height:96px;resize:vertical}
        .cp-side-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:16px}
        .cp-side-card{border-radius:22px;padding:14px;background:linear-gradient(135deg,#fff8e8,#ffe0b5);box-shadow:0 14px 26px rgba(47,77,140,.08)}
        .cp-side-card.blue{background:linear-gradient(135deg,#e8f2ff,#dfe6ff)}
        .cp-side-card.mint{background:linear-gradient(135deg,#ebfff6,#d5f7ef)}
        .cp-side-card strong{display:block;font-size:20px;color:#17346d}
        .cp-side-card span{display:block;margin-top:6px;font-size:12px;font-weight:800;color:#36539c}
        .cp-side-card small{display:block;margin-top:6px;font-size:12px;color:#61708f;line-height:1.45}
        .cp-parse-cards{display:flex;flex-direction:column;gap:10px;margin-top:14px;max-height:280px;overflow:auto}
        .cp-card{border:1px solid rgba(102,132,212,.12);border-radius:18px;padding:12px;background:linear-gradient(135deg,#fff,#f7faff)}
        .cp-card strong{display:block;color:#18356f}
        @media (max-width:1260px){.cp-card-row{grid-template-columns:repeat(3,minmax(0,1fr))}.cp-grid{grid-template-columns:1fr}.cp-checks{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media (max-width:760px){.cp-card-row,.cp-checks,.cp-side-cards,.cp-form{grid-template-columns:1fr}.cp-title{font-size:20px}}
      `}</style>

      <div className="cp-shell">
        <div className="cp-card-row">
          <button type="button" className={`cp-summary-card peach ${quickFilter === 'all' ? 'active' : ''}`} onClick={() => setQuickFilter('all')}>
            <strong>{rows.length}</strong>
            <span>Total Clients</span>
            <small>Full visible pipeline. Manager sees all, TL sees only marked rows.</small>
          </button>
          <button type="button" className={`cp-summary-card blue ${quickFilter === 'due' ? 'active' : ''}`} onClick={() => setQuickFilter('due')}>
            <strong>{stats.followUpDue}</strong>
            <span>Follow Up Due</span>
            <small>Daily check card. Opens only due follow up rows in the table below.</small>
          </button>
          <button type="button" className={`cp-summary-card purple ${quickFilter === 'high' ? 'active' : ''}`} onClick={() => setQuickFilter('high')}>
            <strong>{stats.highPriority}</strong>
            <span>High Priority</span>
            <small>Quick access to urgent client rows that need attention first.</small>
          </button>
          <button type="button" className={`cp-summary-card mint ${quickFilter === 'mail' ? 'active' : ''}`} onClick={() => setQuickFilter('mail')}>
            <strong>{stats.mailReady}</strong>
            <span>Mail Ready</span>
            <small>Clients with usable email IDs. Open mail section only when you actually need it.</small>
          </button>
          <button type="button" className={`cp-summary-card sky ${quickFilter === 'shared' ? 'active' : ''}`} onClick={() => setQuickFilter('shared')}>
            <strong>{stats.tlShared}</strong>
            <span>TL Shared</span>
            <small>Manager-marked rows visible to TL. Recruiters stay out, as requested repeatedly.</small>
          </button>
        </div>

        <div className="cp-grid">
          <div className="cp-panel">
            <div className="cp-head">
              <div>
                <div className="cp-title">Client Pipeline Board</div>
                <div className="cp-sub">The pipeline stays a client dashboard, not a full mail dashboard wearing a fake moustache. Mail lives in its own section, and this page stays focused on client list, calls, follow ups and visibility.</div>
              </div>
            </div>

            {notice ? <div className="cp-banner">{notice}</div> : null}

            <div className="cp-quick-bar">
              <button type="button" className="cp-btn primary" onClick={() => openMailCentre(selectedRows.length ? selectedRows : filteredRows.filter((row) => String(row.contact_email || '').trim()), bulkMode)}>
                Open Mail Clients
              </button>
              <button type="button" className="cp-btn ghost" onClick={() => setBulkMode('bcc')}>Mode: BCC</button>
              <button type="button" className="cp-btn ghost" onClick={() => setBulkMode('cc')}>Mode: CC</button>
              <button type="button" className="cp-btn ghost" disabled={!selectedRows.length} onClick={dialSelected}>Dial Selected</button>
              {isManager ? <button type="button" className="cp-btn ghost" onClick={() => window.open('/api/client-pipeline/export', '_blank')}>Export Excel/CSV</button> : null}
              <button type="button" className="cp-btn warm" onClick={() => setQuickFilter('all')}>Reset View</button>
            </div>

            <div className="cp-checks">
              <button type="button" className="cp-check-card" onClick={() => setQuickFilter('due')}>
                <strong>{stats.followUpDue}</strong>
                <span>Today Follow Up</span>
                <small>Openable daily check card for manager review.</small>
              </button>
              <button type="button" className="cp-check-card" onClick={() => setQuickFilter('nofollow')}>
                <strong>{stats.noFollowUp}</strong>
                <span>No Follow Up Date</span>
                <small>Rows that still need a proper next action date.</small>
              </button>
              <button type="button" className="cp-check-card" onClick={() => setQuickFilter('warm')}>
                <strong>{rows.filter((row) => ['warm', 'follow up'].includes(String(row.status || '').toLowerCase())).length}</strong>
                <span>Warm / Follow Up</span>
                <small>A good starting point before the next follow-up call.</small>
              </button>
              <button type="button" className="cp-check-card" onClick={() => openMailCentre(filteredRows.filter((row) => String(row.contact_email || '').trim()), bulkMode)}>
                <strong>{stats.mailReady}</strong>
                <span>Open Mail Section</span>
                <small>Jumps to Mail Centre with visible client picks ready.</small>
              </button>
            </div>

            <div className="cp-table-wrap">
              <table className="cp-table">
                <thead>
                  <tr>
                    <th></th>
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
                        <td><input type="checkbox" checked={selected.includes(row.lead_id)} onChange={() => toggleSelected(row.lead_id)} /></td>
                        <td>
                          <div className="cp-name">{row.client_name}</div>
                          <div className="cp-muted">{row.city || '-'} • {row.industry || '-'}</div>
                          <div className="cp-muted">Openings: {row.openings_count || '-'} • Owner: {row.owner_username || '-'}</div>
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
                            <button key={tl.user_id} type="button" className="cp-pill" style={{ opacity: visibleToTl.includes(tl.user_id) ? 1 : .42 }} onClick={() => toggleTlVisibility(row, tl)}>
                              {tl.full_name}
                            </button>
                          )) : <span className="cp-muted">No TL users</span> : <span className="cp-muted">{csvList(row.visible_to_tl_names).length ? 'Shared by manager' : 'Private to manager'}</span>}
                        </td>
                        <td>
                          <div className="cp-actions">
                            {row.contact_phone ? <button type="button" className="cp-link" onClick={() => { window.location.href = `tel:${row.contact_phone}`; }}>Call</button> : null}
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
          </div>

          <div className="cp-panel">
            <div className="cp-title">Manager Controls</div>
            <div className="cp-sub">Create new clients, parse raw data, and keep daily checks visible without turning this page into an email compose monster.</div>

            <div className="cp-side-cards">
              <div className="cp-side-card">
                <strong>{stats.followUpDue}</strong>
                <span>Daily Follow Up Check</span>
                <small>Openable check from the left cards. Good for morning review.</small>
              </div>
              <div className="cp-side-card blue">
                <strong>{selectedRows.length}</strong>
                <span>Selected Right Now</span>
                <small>Use these picks for dial selected or opening Mail Centre.</small>
              </div>
              <div className="cp-side-card mint">
                <strong>{stats.mailReady}</strong>
                <span>Mail Ready Clients</span>
                <small>Client mail section stays separate, but ready count stays visible here.</small>
              </div>
              <div className="cp-side-card blue">
                <strong>{stats.tlShared}</strong>
                <span>Shared To TL</span>
                <small>Manager decides what TL sees. Recruiter gets nothing here.</small>
              </div>
            </div>

            {isManager ? (
              <>
                <form className="cp-form" onSubmit={createClient}>
                  <div className="cp-field"><label>Client Name</label><input value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} /></div>
                  <div className="cp-field"><label>Contact Person</label><input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} /></div>
                  <div className="cp-field"><label>Email</label><input value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} /></div>
                  <div className="cp-field"><label>Phone</label><input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} /></div>
                  <div className="cp-field"><label>City</label><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
                  <div className="cp-field"><label>Industry</label><input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} /></div>
                  <div className="cp-field"><label>Status</label><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option>Active</option><option>Follow Up</option><option>Warm</option><option>Cold</option></select></div>
                  <div className="cp-field"><label>Priority</label><select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option>High</option><option>Medium</option><option>Low</option></select></div>
                  <div className="cp-field"><label>Openings</label><input value={form.openings_count} onChange={(e) => setForm({ ...form, openings_count: e.target.value })} /></div>
                  <div className="cp-field"><label>Next Follow Up</label><input type="date" value={form.next_follow_up_at} onChange={(e) => setForm({ ...form, next_follow_up_at: e.target.value })} /></div>
                  <div className="cp-field full"><label>Notes</label><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
                  <div className="cp-field full"><button type="submit" className="cp-btn primary" disabled={busy || !form.client_name}>{busy ? 'Saving...' : 'Add Client'}</button></div>
                </form>

                <div className="cp-title" style={{ marginTop: 22 }}>Manager Data Extractor</div>
                <div className="cp-sub">Heavy imports, posters, screenshots, public URLs and messy lead cleanup now stay in the separate <strong>Data Extractor</strong> slice so this page stays clean.</div>
                <div className="cp-quick-bar">
                  <button type="button" className="cp-btn primary" onClick={() => navigate('/data-extractor')}>Open Data Extractor</button>
                  <button type="button" className="cp-btn ghost" onClick={() => navigate('/data-extractor')}>Review Imported Rows</button>
                </div>
              </>
            ) : (
              <div className="cp-banner">Only manager can create clients, export sheets and parse raw data. TL sees only what manager marks. Recruiter gets no client section access.</div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
