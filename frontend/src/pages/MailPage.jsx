import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';

const defaultTemplate = {
  template_id: '',
  title: '',
  category: 'General',
  subject: '',
  body: 'Hi {{name}},\n\n',
};

const defaultDraft = {
  draft_id: '',
  title: 'Working Draft',
  template_id: '',
  subject: '',
  body: '',
  to_emails: '',
  cc_emails: '',
  bcc_emails: '',
  target_kind: 'mixed',
};

function csvList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function joinEmails(items) {
  return [...new Set(items.filter(Boolean))].join(', ');
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export default function MailPage() {
  const [searchParams] = useSearchParams();
  const hydratedQueryRef = useRef(false);
  const [data, setData] = useState({ templates: [], drafts: [], logs: [], recipients: [], clients: [] });
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState([]);
  const [selectedClientIds, setSelectedClientIds] = useState([]);
  const [draft, setDraft] = useState(defaultDraft);
  const [templateForm, setTemplateForm] = useState(defaultTemplate);
  const [recipientMode, setRecipientMode] = useState('bcc');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [activePanel, setActivePanel] = useState('templates');

  async function load() {
    setLoading(true);
    try {
      const payload = await api.get('/api/mail/overview');
      setData(payload);
      if (!draft.draft_id && payload.drafts?.[0]) {
        setDraft({ ...defaultDraft, ...payload.drafts[0] });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  usePolling(load, 10000, []);

  function buildRecipientDraft(employeeIds, clientIds, mode, baseDraft) {
    const employees = data.recipients.filter((item) => employeeIds.includes(item.id));
    const clients = data.clients.filter((item) => clientIds.includes(item.id));
    const mixed = [...employees, ...clients];
    const primaryEmail = employees[0]?.email || clients[0]?.email || baseDraft.to_emails || '';
    return {
      ...baseDraft,
      to_emails: primaryEmail,
      cc_emails: mode === 'cc' ? joinEmails(mixed.map((item) => item.email)) : '',
      bcc_emails: mode === 'bcc' ? joinEmails(mixed.map((item) => item.email)) : '',
    };
  }

  function applyRecipients(nextMode = recipientMode, employeeIds = selectedEmployeeIds, clientIds = selectedClientIds) {
    setRecipientMode(nextMode);
    setDraft((current) => buildRecipientDraft(employeeIds, clientIds, nextMode, current));
  }

  useEffect(() => {
    if (hydratedQueryRef.current) return;
    if (!data.templates.length && !data.clients.length && !data.recipients.length) return;
    const queryEmployeeIds = csvList(searchParams.get('employeeIds'));
    const queryClientIds = csvList(searchParams.get('clientIds'));
    const mode = ['cc', 'bcc'].includes(String(searchParams.get('mode') || '').toLowerCase())
      ? String(searchParams.get('mode')).toLowerCase()
      : recipientMode;
    const templateId = String(searchParams.get('templateId') || '').trim();

    if (queryEmployeeIds.length) setSelectedEmployeeIds(queryEmployeeIds);
    if (queryClientIds.length) setSelectedClientIds(queryClientIds);
    if (queryEmployeeIds.length || queryClientIds.length) {
      setRecipientMode(mode);
      setDraft((current) => buildRecipientDraft(queryEmployeeIds, queryClientIds, mode, current));
      setToast(`Loaded ${queryEmployeeIds.length + queryClientIds.length} recipients from the previous page`);
    }
    if (templateId) {
      const template = data.templates.find((item) => item.template_id === templateId);
      if (template) loadTemplate(template);
    }
    hydratedQueryRef.current = true;
  }, [data.templates, data.clients, data.recipients, searchParams]);

  const stats = useMemo(() => {
    const today = todayKey();
    const todayLogs = data.logs.filter((row) => String(row.created_at || '').startsWith(today));
    return {
      activeDrafts: data.drafts.length,
      templates: data.templates.length,
      sentToday: todayLogs.length,
      visibleClients: data.clients.length,
      visibleEmployees: data.recipients.length,
      selectedRecipients: selectedEmployeeIds.length + selectedClientIds.length,
    };
  }, [data, selectedEmployeeIds.length, selectedClientIds.length]);

  function toggleSelected(list, setter, id) {
    const next = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
    setter(next);
    if (setter === setSelectedEmployeeIds) {
      applyRecipients(recipientMode, next, selectedClientIds);
    } else {
      applyRecipients(recipientMode, selectedEmployeeIds, next);
    }
  }

  function loadTemplate(item) {
    setDraft((current) => ({
      ...current,
      template_id: item.template_id,
      title: item.title,
      subject: item.subject,
      body: item.body,
    }));
    setActivePanel('templates');
    setToast(`Template loaded: ${item.title}`);
  }

  async function saveDraft() {
    setSaving(true);
    try {
      const result = await api.post('/api/mail/drafts', draft);
      setDraft({ ...defaultDraft, ...result.item });
      setToast('Draft saved');
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function saveTemplate() {
    setSaving(true);
    try {
      const result = await api.post('/api/mail/templates', templateForm);
      setTemplateForm({ ...defaultTemplate, ...result.item });
      setToast('Template saved');
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function openMail() {
    setSaving(true);
    try {
      const result = await api.post('/api/mail/open', {
        ...draft,
        user_ids: selectedEmployeeIds.join(','),
        client_ids: selectedClientIds.join(','),
      });
      setDraft({ ...defaultDraft, ...result.next_draft });
      setToast('Mail opened in your email app');
      if (result.mailto_url) window.location.href = result.mailto_url;
      await load();
    } finally {
      setSaving(false);
    }
  }

  const quickTemplateCards = useMemo(() => ([
    { title: 'Appreciation Mail', note: 'Employee appreciation or thank-you note', match: 'appreciation' },
    { title: 'Morning Mail', note: 'Morning plan, target or daily workflow push', match: 'morning' },
    { title: 'Low Performance Mail', note: 'Performance warning or attention note', match: 'low performance' },
    { title: 'Document Submission Mail', note: 'Document follow-up or completion reminder', match: 'document submission' },
    { title: 'Offer Letter Mail', note: 'Offer or joining communication draft', match: 'offer letter' },
  ].map((card) => ({
    ...card,
    template: data.templates.find((item) => String(item.title || '').toLowerCase().includes(card.match)),
  }))), [data.templates]);

  return (
    <Layout title="Mail Centre" subtitle="Separate mail section for employees and clients, with colorful quick cards, templates, logs and a cleaner compose flow.">
      <style>{`
        .mail-page{display:flex;flex-direction:column;gap:16px}
        .mail-top-cards{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:14px}
        .mail-top-card{border:none;border-radius:26px;padding:18px 18px 16px;color:#fff;text-align:left;cursor:pointer;box-shadow:0 20px 38px rgba(43,69,131,.14);transition:transform .18s ease, box-shadow .18s ease}
        .mail-top-card:hover,.mail-top-card.active{transform:translateY(-2px);box-shadow:0 24px 42px rgba(43,69,131,.18)}
        .mail-top-card strong{display:block;font-size:30px;line-height:1;font-weight:900}
        .mail-top-card span{display:block;margin-top:8px;font-size:14px;font-weight:800}
        .mail-top-card small{display:block;margin-top:8px;font-size:12px;line-height:1.45;opacity:.94}
        .mail-top-card.peach{background:linear-gradient(135deg,#ffb064,#fb7d97)}
        .mail-top-card.blue{background:linear-gradient(135deg,#64b0ff,#6079ff)}
        .mail-top-card.sky{background:linear-gradient(135deg,#7cd0ff,#7ee8ff);color:#103768}
        .mail-top-card.purple{background:linear-gradient(135deg,#7b8dff,#8d66ff)}
        .mail-top-card.mint{background:linear-gradient(135deg,#74d7c0,#6fb8ff)}
        .mail-top-card.gold{background:linear-gradient(135deg,#ffd585,#ffb764);color:#6d3400}
        .mail-template-cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px}
        .mail-template-card{border:none;border-radius:24px;padding:16px;background:linear-gradient(135deg,#fff8e8,#ffe1b8);box-shadow:0 14px 26px rgba(47,77,140,.08);text-align:left;cursor:pointer}
        .mail-template-card.blue{background:linear-gradient(135deg,#e8f2ff,#dfe8ff)}
        .mail-template-card.purple{background:linear-gradient(135deg,#efeaff,#e6ddff)}
        .mail-template-card.mint{background:linear-gradient(135deg,#ebfff6,#d6f7ef)}
        .mail-template-card.rose{background:linear-gradient(135deg,#fff0f4,#ffdbe6)}
        .mail-template-card strong{display:block;font-size:18px;color:#17346d}
        .mail-template-card span{display:block;margin-top:6px;font-size:12px;font-weight:800;color:#36539c}
        .mail-template-card small{display:block;margin-top:6px;font-size:12px;color:#61708f;line-height:1.45}
        .mail-shell{display:grid;grid-template-columns:320px minmax(0,1fr) 360px;gap:16px;align-items:start}
        .mail-panel{background:linear-gradient(180deg,rgba(255,255,255,.97),rgba(246,250,255,.95));border:1px solid rgba(102,132,212,.12);border-radius:28px;box-shadow:0 18px 44px rgba(44,71,132,.10);padding:18px}
        .mail-title{font-size:22px;font-weight:900;color:#16336f;margin-bottom:4px}
        .mail-sub{font-size:12px;color:#61708f;line-height:1.5}
        .mail-stack{display:flex;flex-direction:column;gap:12px}
        .mail-chip-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
        .mail-chip{border:none;border-radius:999px;padding:8px 12px;background:rgba(80,121,255,.08);font-size:12px;font-weight:800;color:#3655a0;cursor:pointer}.mail-chip.active{background:linear-gradient(135deg,#5079ff,#7b67ff);color:#fff}
        .mail-list{display:flex;flex-direction:column;gap:10px;margin-top:14px;max-height:520px;overflow:auto;padding-right:4px}
        .mail-card{border:1px solid rgba(101,127,204,.12);border-radius:20px;padding:12px;background:linear-gradient(135deg,#fff,#f7faff)}
        .mail-card strong{display:block;color:#17346d}.mail-card span{display:block;font-size:12px;color:#5d6c88;margin-top:4px;line-height:1.4}
        .mail-check{display:flex;align-items:center;gap:8px;font-size:13px;color:#274277;font-weight:700}
        .mail-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
        .mail-field{display:flex;flex-direction:column;gap:6px}.mail-field.full{grid-column:1/-1}
        .mail-field label{font-size:12px;font-weight:800;color:#54647f;text-transform:uppercase;letter-spacing:.06em}
        .mail-field input,.mail-field textarea,.mail-field select{width:100%;border:none;outline:none;border-radius:16px;padding:12px 14px;background:linear-gradient(180deg,#fff,#f5f8ff);box-shadow:inset 0 0 0 1px rgba(107,133,214,.18),0 8px 18px rgba(44,72,137,.08);color:#17346d}
        .mail-field textarea{min-height:140px;resize:vertical}
        .mail-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
        .mail-btn{border:none;border-radius:16px;padding:12px 16px;font-weight:800;cursor:pointer}.mail-btn.primary{background:linear-gradient(135deg,#4d78ff,#7d67ff);color:#fff;box-shadow:0 14px 24px rgba(62,96,194,.22)}.mail-btn.ghost{background:rgba(74,116,255,.08);color:#35539c}
        .mail-mini{font-size:12px;color:#5a6a88}
        .mail-highlight{padding:12px 14px;border-radius:18px;background:linear-gradient(135deg,rgba(80,121,255,.10),rgba(118,102,255,.10));margin-top:12px;color:#23417c;font-weight:700}
        .mail-side-toggle{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
        .mail-toggle{border:none;border-radius:14px;padding:9px 12px;font-weight:800;cursor:pointer;background:rgba(74,116,255,.08);color:#35539c}.mail-toggle.active{background:linear-gradient(135deg,#4d78ff,#7d67ff);color:#fff}
        .mail-log-table{width:100%;border-collapse:collapse;margin-top:12px}
        .mail-log-table th,.mail-log-table td{padding:10px 8px;text-align:left;border-bottom:1px solid rgba(111,138,212,.12);font-size:12px;color:#204078;vertical-align:top}
        @media (max-width:1280px){.mail-top-cards{grid-template-columns:repeat(3,minmax(0,1fr))}.mail-template-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.mail-shell{grid-template-columns:1fr}}
        @media (max-width:760px){.mail-top-cards,.mail-template-cards,.mail-grid{grid-template-columns:1fr}.mail-title{font-size:20px}}
      `}</style>

      <div className="mail-page">
        <div className="mail-top-cards">
          <button type="button" className={`mail-top-card peach ${activePanel === 'drafts' ? 'active' : ''}`} onClick={() => setActivePanel('drafts')}>
            <strong>{stats.activeDrafts}</strong>
            <span>Saved Drafts</span>
            <small>The draft remains available after sending for quick reuse when needed.</small>
          </button>
          <button type="button" className={`mail-top-card blue ${activePanel === 'templates' ? 'active' : ''}`} onClick={() => setActivePanel('templates')}>
            <strong>{stats.templates}</strong>
            <span>Templates</span>
            <small>Editable preset formats for appreciation, morning mail, low work and more.</small>
          </button>
          <button type="button" className={`mail-top-card purple ${activePanel === 'logs' ? 'active' : ''}`} onClick={() => setActivePanel('logs')}>
            <strong>{stats.sentToday}</strong>
            <span>Sent Today</span>
            <small>Quick daily check card for today’s mail activity.</small>
          </button>
          <button type="button" className={`mail-top-card mint ${activePanel === 'clients' ? 'active' : ''}`} onClick={() => setActivePanel('clients')}>
            <strong>{stats.visibleClients}</strong>
            <span>Visible Clients</span>
            <small>Client mail stays here, not all over the pipeline dashboard.</small>
          </button>
          <button type="button" className={`mail-top-card sky ${activePanel === 'employees' ? 'active' : ''}`} onClick={() => setActivePanel('employees')}>
            <strong>{stats.visibleEmployees}</strong>
            <span>Employees</span>
            <small>Ready for greeting-based employee mails and reminders.</small>
          </button>
          <button type="button" className={`mail-top-card gold ${activePanel === 'selected' ? 'active' : ''}`} onClick={() => setActivePanel('selected')}>
            <strong>{stats.selectedRecipients}</strong>
            <span>Selected Right Now</span>
            <small>Openable card showing current bulk selection count for CC or BCC.</small>
          </button>
        </div>

        <div className="mail-template-cards">
          {quickTemplateCards.map((card, index) => (
            <button
              key={card.title}
              type="button"
              className={`mail-template-card ${['blue', 'purple', 'mint', 'rose'][index % 4] || ''}`}
              onClick={() => card.template && loadTemplate(card.template)}
            >
              <strong>{card.title}</strong>
              <span>{card.template ? 'Ready to load' : 'Template missing in dataset'}</span>
              <small>{card.note}</small>
            </button>
          ))}
        </div>

        <div className="mail-shell">
          <div className="mail-panel">
            <div className="mail-title">Recipients</div>
            <div className="mail-sub">Select employees or clients. Bulk picks go to CC or BCC from here without turning the client dashboard into a mail board.</div>
            {toast ? <div className="mail-highlight">{toast}</div> : null}
            <div className="mail-chip-row">
              <button type="button" className={`mail-chip ${recipientMode === 'bcc' ? 'active' : ''}`} onClick={() => applyRecipients('bcc')}>Bulk to BCC</button>
              <button type="button" className={`mail-chip ${recipientMode === 'cc' ? 'active' : ''}`} onClick={() => applyRecipients('cc')}>Bulk to CC</button>
            </div>
            <div className="mail-list">
              <div className="mail-card">
                <strong>Employees</strong>
                <span>{data.recipients.length} visible employees</span>
                <div className="mail-stack" style={{ marginTop: 10 }}>
                  {data.recipients.map((item) => (
                    <label key={item.id} className="mail-check">
                      <input type="checkbox" checked={selectedEmployeeIds.includes(item.id)} onChange={() => toggleSelected(selectedEmployeeIds, setSelectedEmployeeIds, item.id)} />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="mail-card">
                <strong>Clients</strong>
                <span>{data.clients.length} visible to you</span>
                <div className="mail-stack" style={{ marginTop: 10 }}>
                  {data.clients.map((item) => (
                    <label key={item.id} className="mail-check">
                      <input type="checkbox" checked={selectedClientIds.includes(item.id)} onChange={() => toggleSelected(selectedClientIds, setSelectedClientIds, item.id)} />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mail-panel">
            <div className="mail-title">Compose</div>
            <div className="mail-sub">Template, greeting, CC/BCC, draft and open-mail flow in one place. The compose box should look like work, not punishment.</div>
            <div className="mail-grid" style={{ marginTop: 16 }}>
              <div className="mail-field"><label>Draft Title</label><input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></div>
              <div className="mail-field"><label>Template</label><select value={draft.template_id} onChange={(e) => {
                const template = data.templates.find((item) => item.template_id === e.target.value);
                setDraft({ ...draft, template_id: e.target.value });
                if (template) loadTemplate(template);
              }}><option value="">Select template</option>{data.templates.map((item) => <option key={item.template_id} value={item.template_id}>{item.title}</option>)}</select></div>
            </div>
            <div className="mail-field" style={{ marginTop: 12 }}><label>To</label><input value={draft.to_emails} onChange={(e) => setDraft({ ...draft, to_emails: e.target.value })} placeholder="Primary recipient" /></div>
            <div className="mail-grid" style={{ marginTop: 12 }}>
              <div className="mail-field"><label>CC</label><input value={draft.cc_emails} onChange={(e) => setDraft({ ...draft, cc_emails: e.target.value })} placeholder="CC emails" /></div>
              <div className="mail-field"><label>BCC</label><input value={draft.bcc_emails} onChange={(e) => setDraft({ ...draft, bcc_emails: e.target.value })} placeholder="BCC emails" /></div>
            </div>
            <div className="mail-field" style={{ marginTop: 12 }}><label>Subject</label><input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} placeholder="Subject line" /></div>
            <div className="mail-field" style={{ marginTop: 12 }}><label>Body</label><textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="Use {{name}}, {{client_name}}, {{recruiter_code}}, {{sender_name}}" /></div>
            <div className="mail-mini" style={{ marginTop: 10 }}>Dynamic placeholders: {'{{name}}'}, {'{{client_name}}'}, {'{{recruiter_code}}'}, {'{{sender_name}}'}.</div>
            <div className="mail-actions">
              <button type="button" className="mail-btn ghost" disabled={saving} onClick={() => applyRecipients(recipientMode)}>Apply selected recipients</button>
              <button type="button" className="mail-btn ghost" disabled={saving} onClick={saveDraft}>Save Draft</button>
              <button type="button" className="mail-btn primary" disabled={saving || (!draft.subject && !draft.body)} onClick={openMail}>{saving ? 'Working...' : 'Open Mail'}</button>
            </div>

            <div className="mail-title" style={{ marginTop: 28 }}>Template Editor</div>
            <div className="mail-grid" style={{ marginTop: 12 }}>
              <div className="mail-field"><label>Template Title</label><input value={templateForm.title} onChange={(e) => setTemplateForm({ ...templateForm, title: e.target.value })} /></div>
              <div className="mail-field"><label>Category</label><input value={templateForm.category} onChange={(e) => setTemplateForm({ ...templateForm, category: e.target.value })} /></div>
            </div>
            <div className="mail-field" style={{ marginTop: 12 }}><label>Subject</label><input value={templateForm.subject} onChange={(e) => setTemplateForm({ ...templateForm, subject: e.target.value })} /></div>
            <div className="mail-field" style={{ marginTop: 12 }}><label>Body</label><textarea value={templateForm.body} onChange={(e) => setTemplateForm({ ...templateForm, body: e.target.value })} /></div>
            <div className="mail-actions">
              <button type="button" className="mail-btn primary" disabled={saving} onClick={saveTemplate}>Save Template</button>
            </div>
          </div>

          <div className="mail-panel">
            <div className="mail-title">Templates & Logs</div>
            <div className="mail-sub">Important daily checks, quick template loading, send history and export all stay here instead of leaking all over the client page.</div>
            <div className="mail-side-toggle">
              <button type="button" className={`mail-toggle ${activePanel === 'templates' ? 'active' : ''}`} onClick={() => setActivePanel('templates')}>Templates</button>
              <button type="button" className={`mail-toggle ${activePanel === 'drafts' ? 'active' : ''}`} onClick={() => setActivePanel('drafts')}>Drafts</button>
              <button type="button" className={`mail-toggle ${activePanel === 'logs' ? 'active' : ''}`} onClick={() => setActivePanel('logs')}>Logs</button>
            </div>

            {activePanel !== 'logs' ? (
              <div className="mail-list">
                {(activePanel === 'drafts' ? data.drafts : data.templates).map((item) => (
                  <div key={item.draft_id || item.template_id} className="mail-card">
                    <strong>{item.title}</strong>
                    <span>{activePanel === 'drafts' ? `${item.subject || 'No subject'} • draft` : `${item.category} • ${item.subject}`}</span>
                    {activePanel === 'drafts' ? (
                      <button type="button" className="mail-btn ghost" onClick={() => { setDraft({ ...defaultDraft, ...item }); setToast(`Draft loaded: ${item.title}`); }}>Use Draft</button>
                    ) : (
                      <button type="button" className="mail-btn ghost" onClick={() => loadTemplate(item)}>Use Template</button>
                    )}
                  </div>
                ))}
                {!loading && !(activePanel === 'drafts' ? data.drafts.length : data.templates.length) ? <div className="mail-card"><strong>No items here</strong><span>Create a template or save a draft first.</span></div> : null}
              </div>
            ) : (
              <>
                <div className="mail-actions">
                  <button type="button" className="mail-btn ghost" onClick={() => window.open('/api/mail/export', '_blank')}>Export Logs</button>
                </div>
                <table className="mail-log-table">
                  <thead><tr><th>Title</th><th>Recipients</th><th>When</th></tr></thead>
                  <tbody>
                    {data.logs.slice(0, 12).map((row) => (
                      <tr key={row.log_id}>
                        <td>{row.title}<br /><span className="mail-mini">{row.subject}</span></td>
                        <td>{row.sent_to_count} total<br /><span className="mail-mini">{row.recipient_labels || row.to_emails}</span></td>
                        <td>{String(row.created_at || '').slice(0, 16).replace('T', ' ')}</td>
                      </tr>
                    ))}
                    {!loading && !data.logs.length ? <tr><td colSpan="3">No mail logs yet.</td></tr> : null}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
