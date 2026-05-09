import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { useAuth } from '../lib/auth';

const emptyLead = {
  company_name: '',
  contact_name: '',
  phone: '',
  email: '',
  website: '',
  linkedin_url: '',
  source_channel: 'LinkedIn',
  source_label: 'LinkedIn visible post',
  source_url: '',
  search_string: '',
  result_window_from: '',
  result_window_to: '',
  city: '',
  industry: '',
  company_size: '',
  lead_type: 'Warm',
  intent_signal: '',
  stage: 'New',
  priority: 'Medium',
  status: 'Open',
  score: 0,
  tags: '',
  notes: '',
  next_follow_up_at: '',
  post_author_name: '',
  post_author_linkedin_url: '',
  post_date: '',
  post_text: '',
  raw_snapshot: '',
};

const sourceOptions = ['LinkedIn', 'Google', 'WhatsApp', 'Reference', 'Mass Mail', 'Website', 'Manual'];
const stageOptions = ['New', 'Qualified', 'Intro Sent', 'Call Booked', 'Requirement Shared', 'Proposal Sent', 'Negotiation', 'Won', 'Lost', 'Hold'];
const priorityOptions = ['High', 'Medium', 'Low'];
const leadTypeOptions = ['Hot', 'Warm', 'Cold'];
const activityOptions = ['Note', 'Call', 'Email', 'LinkedIn', 'WhatsApp', 'Meeting', 'Proposal'];

function ymdToday() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
}

function chipTone(score) {
  if (Number(score || 0) >= 80) return 'good';
  if (Number(score || 0) >= 60) return 'warm';
  return 'soft';
}

function patchRow(setter, previewKey, field, value) {
  setter((current) => current.map((row) => (row.preview_key === previewKey ? { ...row, [field]: value } : row)));
}

function getBooleanStrings(keywords, city, industry) {
  const keywordBits = String(keywords || '').split(',').map((item) => item.trim()).filter(Boolean);
  const cityBits = String(city || '').split(',').map((item) => item.trim()).filter(Boolean);
  const industryBits = String(industry || '').split(',').map((item) => item.trim()).filter(Boolean);
  const needBlock = `(${[...new Set([...keywordBits, 'vendor', 'staffing', 'recruitment support'])].map((item) => `"${item}"`).join(' OR ')})`;
  const cityBlock = cityBits.length ? `(${cityBits.map((item) => `"${item}"`).join(' OR ')})` : '("Noida" OR "Gurgaon" OR "Delhi")';
  const industryBlock = industryBits.length ? `(${industryBits.map((item) => `"${item}"`).join(' OR ')})` : '("BPO" OR "IT" OR "Sales")';
  return {
    linkedin: `${needBlock} AND ${cityBlock} AND ${industryBlock} AND ("contact number" OR email OR whatsapp)`,
    google: `site:linkedin.com/posts ${needBlock} ${cityBlock} ${industryBlock} ("contact number" OR email OR whatsapp)`,
    companySearch: `("we are hiring" OR vendor OR "recruitment support" OR "multiple openings") ${cityBlock} ${industryBlock} (contact OR careers OR hiring)`,
  };
}

function StatCard({ label, value, note, tone }) {
  return (
    <div className={`bda-stat-card ${tone || 'blue'}`}>
      <div className="bda-stat-label">{label}</div>
      <div className="bda-stat-value">{value}</div>
      <div className="bda-stat-note">{note}</div>
    </div>
  );
}

function ResultCard({ row, index, onToggle, onPatch }) {
  return (
    <div className="bda-result-card">
      <div className="bda-result-top">
        <div>
          <div className="bda-card-kicker">Will save as #{row.preview_serial_no}</div>
          <div className="bda-result-title">{row.contact_name || row.post_author_name || row.company_name || `Lead ${index + 1}`}</div>
          <div className="bda-chip-row">
            <span className={`bda-chip ${chipTone(row.score)}`}>Score {Number(row.score || 0)}</span>
            <span className="bda-chip soft">{row.source_channel || 'Manual'}</span>
            <span className="bda-chip soft">{row.stage || 'New'}</span>
          </div>
        </div>
        <label className="bda-include-toggle">
          <input type="checkbox" checked={row.include !== false} onChange={() => onToggle(row.preview_key)} />
          <span>Include</span>
        </label>
      </div>

      <div className="bda-summary-grid">
        <label><span>Contact</span><input value={row.contact_name || ''} onChange={(e) => onPatch(row.preview_key, 'contact_name', e.target.value)} /></label>
        <label><span>Company</span><input value={row.company_name || ''} onChange={(e) => onPatch(row.preview_key, 'company_name', e.target.value)} /></label>
        <label><span>Phone</span><input value={row.phone || ''} onChange={(e) => onPatch(row.preview_key, 'phone', e.target.value)} /></label>
        <label><span>Email</span><input value={row.email || ''} onChange={(e) => onPatch(row.preview_key, 'email', e.target.value)} /></label>
        <label><span>City</span><input value={row.city || ''} onChange={(e) => onPatch(row.preview_key, 'city', e.target.value)} /></label>
        <label><span>Industry</span><input value={row.industry || ''} onChange={(e) => onPatch(row.preview_key, 'industry', e.target.value)} /></label>
        <label><span>Lead Type</span>
          <select value={row.lead_type || 'Warm'} onChange={(e) => onPatch(row.preview_key, 'lead_type', e.target.value)}>
            {leadTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label><span>Priority</span>
          <select value={row.priority || 'Medium'} onChange={(e) => onPatch(row.preview_key, 'priority', e.target.value)}>
            {priorityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      </div>

      <div className="bda-wide-grid">
        <label className="bda-wide-field"><span>Post text</span><textarea rows={5} value={row.post_text || ''} onChange={(e) => onPatch(row.preview_key, 'post_text', e.target.value)} /></label>
        <label className="bda-wide-field"><span>Notes</span><textarea rows={5} value={row.notes || ''} onChange={(e) => onPatch(row.preview_key, 'notes', e.target.value)} /></label>
      </div>

      <details className="bda-advanced-box">
        <summary>Open more options</summary>
        <div className="bda-summary-grid advanced">
          <label><span>Post author</span><input value={row.post_author_name || ''} onChange={(e) => onPatch(row.preview_key, 'post_author_name', e.target.value)} /></label>
          <label><span>Post date</span><input value={row.post_date || ''} onChange={(e) => onPatch(row.preview_key, 'post_date', e.target.value)} /></label>
          <label><span>LinkedIn URL</span><input value={row.linkedin_url || ''} onChange={(e) => onPatch(row.preview_key, 'linkedin_url', e.target.value)} /></label>
          <label><span>Source URL</span><input value={row.source_url || ''} onChange={(e) => onPatch(row.preview_key, 'source_url', e.target.value)} /></label>
          <label><span>Search string</span><input value={row.search_string || ''} onChange={(e) => onPatch(row.preview_key, 'search_string', e.target.value)} /></label>
          <label><span>Window from</span><input value={row.result_window_from || ''} onChange={(e) => onPatch(row.preview_key, 'result_window_from', e.target.value)} /></label>
          <label><span>Window to</span><input value={row.result_window_to || ''} onChange={(e) => onPatch(row.preview_key, 'result_window_to', e.target.value)} /></label>
          <label><span>Stage</span>
            <select value={row.stage || 'New'} onChange={(e) => onPatch(row.preview_key, 'stage', e.target.value)}>
              {stageOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        </div>
      </details>
    </div>
  );
}

export default function BDAHeadPage() {
  const { user } = useAuth();
  const role = String(user?.role || '').toLowerCase();
  const canUse = Boolean(user?.user_id);

  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({ total: 0, due: 0, hot: 0, pending: 0, max_serial: 0 });
  const [meta, setMeta] = useState({ playbooks: [], handoff: [], booleans: {}, autoFillFields: [] });
  const [form, setForm] = useState(emptyLead);
  const [rawText, setRawText] = useState('');
  const [captureMode, setCaptureMode] = useState('raw');
  const [sourceChannel, setSourceChannel] = useState('LinkedIn');
  const [sourceLabel, setSourceLabel] = useState('LinkedIn visible post');
  const [extractorUrl, setExtractorUrl] = useState('');
  const [searchString, setSearchString] = useState('');
  const [resultWindowFrom, setResultWindowFrom] = useState('');
  const [resultWindowTo, setResultWindowTo] = useState('');
  const [parsedRows, setParsedRows] = useState([]);
  const [activityLeadId, setActivityLeadId] = useState('');
  const [activityForm, setActivityForm] = useState({ activity_type: 'Note', summary: '', outcome: '' });
  const [activityRows, setActivityRows] = useState([]);
  const [builder, setBuilder] = useState({ keywords: 'vendor,recruitment support,bpo,staffing', city: 'Noida,Gurgaon,Delhi', industry: 'BPO,IT,Sales' });
  const [quickFilter, setQuickFilter] = useState('all');
  const [section, setSection] = useState('capture');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  async function load() {
    if (!canUse) return;
    setLoading(true);
    try {
      const [leadData, metaData] = await Promise.all([
        api.get('/api/bda-head'),
        api.get('/api/bda-head/meta'),
      ]);
      setRows(leadData.items || []);
      setStats(leadData.stats || { total: 0, due: 0, hot: 0, pending: 0, max_serial: 0 });
      setMeta(metaData || { playbooks: [], handoff: [], booleans: {}, autoFillFields: [] });
    } catch (error) {
      setNotice(error.message || 'Unable to load BDA.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [canUse]);
  usePolling(load, 180000, [canUse]);

  useEffect(() => {
    if (rows.length && !activityLeadId) setActivityLeadId(rows[0].lead_id);
  }, [rows, activityLeadId]);

  useEffect(() => {
    if (!activityLeadId) return;
    loadActivities(activityLeadId).catch(() => {});
  }, [activityLeadId]);

  async function createLead(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/bda-head', form);
      setForm(emptyLead);
      setNotice('Lead added. Clean and simple, unlike half the internet.');
      await load();
    } catch (error) {
      setNotice(error.message || 'Could not save lead.');
    } finally {
      setBusy(false);
    }
  }

  async function parseRaw() {
    if (!rawText.trim()) return;
    setBusy(true);
    try {
      const result = await api.post('/api/bda-head/parse-raw', {
        raw_text: rawText,
        source_label: sourceLabel.trim() || 'LinkedIn visible post',
        source_channel: sourceChannel,
        search_string: searchString.trim(),
        result_window_from: resultWindowFrom,
        result_window_to: resultWindowTo,
      });
      const items = (result.items || []).map((item) => ({ ...item, source_channel: item.source_channel || sourceChannel, source_label: item.source_label || sourceLabel }));
      setParsedRows(items);
      setSection('capture');
      setNotice(`Parsed ${items.length || 0} row(s). Review only the good ones, then Add to Database.`);
    } catch (error) {
      setNotice(error.message || 'Could not parse raw data.');
    } finally {
      setBusy(false);
    }
  }

  async function parseUrl() {
    if (!extractorUrl.trim()) return;
    setBusy(true);
    try {
      const result = await api.post('/api/bda-head/extract-url', {
        url: extractorUrl.trim(),
        source_label: sourceLabel.trim() || 'Public URL capture',
        source_channel: sourceChannel,
        search_string: searchString.trim(),
        result_window_from: resultWindowFrom,
        result_window_to: resultWindowTo,
      }, { timeoutMs: 16000 });
      const items = (result.items || []).map((item) => ({ ...item, source_channel: item.source_channel || sourceChannel, source_label: item.source_label || sourceLabel }));
      setParsedRows(items);
      setSection('capture');
      setNotice(`Parsed ${items.length || 0} row(s) from public URL.`);
    } catch (error) {
      setNotice(error.message || 'Could not extract from URL.');
    } finally {
      setBusy(false);
    }
  }

  function toggleParsedRow(previewKey) {
    setParsedRows((current) => current.map((row) => (row.preview_key === previewKey ? { ...row, include: row.include === false ? true : false } : row)));
  }

  async function importParsed() {
    const selected = parsedRows.filter((row) => row.include !== false);
    if (!selected.length) {
      setNotice('Select at least one parsed row first.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.post('/api/bda-head/import-parsed', { items: selected });
      setParsedRows([]);
      setRawText('');
      setExtractorUrl('');
      setNotice(`${result.count || 0} row(s) added to database with new serial numbers.`);
      await load();
      setSection('database');
    } catch (error) {
      setNotice(error.message || 'Could not add parsed rows to database.');
    } finally {
      setBusy(false);
    }
  }

  async function updateLead(leadId, patch) {
    setBusy(true);
    try {
      await api.put(`/api/bda-head/${encodeURIComponent(leadId)}`, patch);
      await load();
      if (activityLeadId === leadId) await loadActivities(leadId);
      setNotice('Lead updated.');
    } catch (error) {
      setNotice(error.message || 'Could not update lead.');
    } finally {
      setBusy(false);
    }
  }

  async function loadActivities(leadId) {
    if (!leadId) {
      setActivityRows([]);
      return;
    }
    const result = await api.get(`/api/bda-head/${encodeURIComponent(leadId)}/activities`, { cacheTtlMs: 0 });
    setActivityRows(result.items || []);
  }

  async function saveActivity(e) {
    e.preventDefault();
    if (!activityLeadId || !activityForm.summary.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/bda-head/${encodeURIComponent(activityLeadId)}/activities`, activityForm);
      setActivityForm({ activity_type: 'Note', summary: '', outcome: '' });
      await loadActivities(activityLeadId);
      setNotice('Activity added.');
    } catch (error) {
      setNotice(error.message || 'Could not save activity.');
    } finally {
      setBusy(false);
    }
  }

  const todayKey = ymdToday();
  const selectedParsedCount = parsedRows.filter((row) => row.include !== false).length;
  const booleanStrings = useMemo(() => getBooleanStrings(builder.keywords, builder.city, builder.industry), [builder]);

  const filteredRows = useMemo(() => {
    switch (quickFilter) {
      case 'hot':
        return rows.filter((row) => String(row.lead_type || '').toLowerCase() === 'hot');
      case 'due':
        return rows.filter((row) => String(row.next_follow_up_at || '').slice(0, 10) && String(row.next_follow_up_at || '').slice(0, 10) <= todayKey);
      case 'qualified':
        return rows.filter((row) => ['qualified', 'intro sent', 'call booked', 'requirement shared', 'proposal sent', 'negotiation'].includes(String(row.stage || '').toLowerCase()));
      case 'won':
        return rows.filter((row) => String(row.stage || '').toLowerCase() === 'won' || String(row.status || '').toLowerCase() === 'won');
      default:
        return rows;
    }
  }, [rows, quickFilter, todayKey]);

  const autoFillPreview = useMemo(() => {
    const base = meta.autoFillFields?.length ? meta.autoFillFields : [
      'Contact Name', 'Company Name', 'Phone', 'Email', 'LinkedIn URL', 'Post Text', 'Search String', 'Date Window', 'Source', 'Notes', 'Stage', 'Priority',
    ];
    return base.slice(0, 12);
  }, [meta]);

  if (!canUse) {
    return (
      <Layout title="BDA" subtitle="BDA slice for lead capture, review, database and follow-up.">
        <div className="bda-guard-box">Unable to open BDA right now. Please log in again.</div>
      </Layout>
    );
  }

  return (
    <Layout title="BDA" subtitle="Clean BDA slice for lead capture, review, database and follow-up.">
      <style>{`
        .bda-page{display:flex;flex-direction:column;gap:18px;padding-bottom:24px}
        .bda-hero-grid,.bda-stat-grid,.bda-panels,.bda-summary-grid,.bda-wide-grid,.bda-db-grid,.bda-search-grid{display:grid;gap:16px}
        .bda-hero-grid{grid-template-columns:2fr 1.2fr}
        .bda-stat-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
        .bda-panels{grid-template-columns:1.2fr .8fr}
        .bda-summary-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
        .bda-summary-grid.advanced{grid-template-columns:repeat(3,minmax(0,1fr))}
        .bda-wide-grid{grid-template-columns:1fr 1fr}
        .bda-db-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
        .bda-search-grid{grid-template-columns:1fr 1fr 1fr}
        .bda-box,.bda-result-card,.bda-db-card,.bda-activity-card,.bda-guard-box{background:#fff;border:1px solid rgba(55,85,140,.12);border-radius:22px;padding:18px;box-shadow:0 12px 30px rgba(49,76,132,.08)}
        .bda-hero-box{background:linear-gradient(135deg,#f7fbff 0%,#eef4ff 100%);border:1px solid rgba(74,118,255,.12);border-radius:26px;padding:20px;box-shadow:0 16px 36px rgba(67,104,205,.12)}
        .bda-helper-box{background:linear-gradient(135deg,#fff8ef 0%,#fffdf7 100%);border:1px solid rgba(244,166,79,.2);border-radius:26px;padding:20px;box-shadow:0 16px 36px rgba(221,159,73,.12)}
        .bda-title-row{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap}
        .bda-title-lg{font-size:28px;font-weight:800;color:#183153;margin:0}
        .bda-sub{margin-top:6px;color:#5b6b88;line-height:1.5}
        .bda-chip-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
        .bda-chip{display:inline-flex;align-items:center;padding:8px 13px;border-radius:999px;font-size:13px;font-weight:800;background:#edf3ff;color:#1f4ea3}
        .bda-chip.good{background:#e7fbef;color:#157347}
        .bda-chip.warm{background:#fff5df;color:#a66900}
        .bda-chip.soft{background:#f3f6fb;color:#60708c}
        .bda-stat-card{border-radius:22px;padding:18px;color:#16365f;min-height:128px;box-shadow:0 16px 30px rgba(41,74,136,.1)}
        .bda-stat-card.blue{background:linear-gradient(135deg,#eef5ff 0%,#dde9ff 100%)}
        .bda-stat-card.orange{background:linear-gradient(135deg,#fff5ea 0%,#ffe7cb 100%)}
        .bda-stat-card.green{background:linear-gradient(135deg,#effcf3 0%,#daf4e3 100%)}
        .bda-stat-card.pink{background:linear-gradient(135deg,#fff1f7 0%,#ffddea 100%)}
        .bda-stat-label{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;opacity:.8}
        .bda-stat-value{margin-top:10px;font-size:32px;font-weight:800}
        .bda-stat-note{margin-top:8px;font-size:13px;line-height:1.45;opacity:.82}
        .bda-section-row{display:flex;gap:12px;flex-wrap:wrap}
        .bda-section-btn{border:1px solid rgba(67,104,205,.15);background:#fff;border-radius:18px;padding:12px 16px;min-width:155px;min-height:74px;text-align:left;cursor:pointer;box-shadow:0 10px 24px rgba(52,84,146,.06)}
        .bda-section-btn.active{background:linear-gradient(135deg,#265fd6 0%,#4784ff 100%);color:#fff;border-color:transparent}
        .bda-section-btn strong{display:block;font-size:15px;line-height:1.2;color:#1a355f}
        .bda-section-btn small{display:block;margin-top:4px;opacity:1;line-height:1.35;font-size:12.5px;color:#5c6f8c}
        .bda-box h3,.bda-result-title{margin:0;color:#183153}
        .bda-card-kicker{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#6f84aa;margin-bottom:6px}
        .bda-form-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
        .bda-form-grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}
        .bda-box label,.bda-result-card label,.bda-db-card label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#2a4c82}
        .bda-box input,.bda-box select,.bda-box textarea,.bda-result-card input,.bda-result-card select,.bda-result-card textarea,.bda-db-card input,.bda-db-card select,.bda-db-card textarea{width:100%;border:1px solid rgba(74,104,166,.18);border-radius:14px;padding:12px 13px;font-size:14px;background:#fdfefe;color:#1f2f49;outline:none}
        .bda-box textarea,.bda-result-card textarea,.bda-db-card textarea{resize:vertical;min-height:110px}
        .bda-input-tabs{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
        .bda-tab{border:1px solid rgba(67,104,205,.14);background:#f8fbff;color:#234a8f;border-radius:14px;padding:10px 14px;font-weight:700;cursor:pointer}
        .bda-tab.active{background:#245fd9;color:#fff;border-color:#245fd9}
        .bda-box-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:14px}
        .bda-box-head p{margin:6px 0 0;color:#66789a;line-height:1.45}
        .bda-actions{display:flex;gap:10px;flex-wrap:wrap}
        .bda-btn{border:none;border-radius:14px;padding:12px 16px;font-weight:800;cursor:pointer;background:linear-gradient(135deg,#245fd9 0%,#4a88ff 100%);color:#fff;box-shadow:0 14px 24px rgba(39,97,219,.18)}
        .bda-btn.alt{background:#fff;color:#245fd9;border:1px solid rgba(67,104,205,.18);box-shadow:none}
        .bda-btn.wide{min-width:220px}
        .bda-inline-note{font-size:13px;color:#66789a;line-height:1.5}
        .bda-result-stack,.bda-activity-stack,.bda-list-stack{display:flex;flex-direction:column;gap:16px}
        .bda-result-top,.bda-db-top{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap}
        .bda-include-toggle{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:800;color:#1f4ea3}
        .bda-advanced-box{margin-top:14px;border-top:1px solid rgba(70,92,138,.12);padding-top:14px}
        .bda-advanced-box summary{cursor:pointer;font-weight:800;color:#2350a4}
        .bda-pill-row{display:flex;gap:8px;flex-wrap:wrap}
        .bda-pill{border:none;background:#eef3fb;color:#274a82;padding:9px 12px;border-radius:999px;font-weight:800;cursor:pointer}
        .bda-pill.active{background:#274a82;color:#fff}
        .bda-db-card{background:linear-gradient(180deg,#ffffff 0%,#fbfcff 100%)}
        .bda-db-card h4,.bda-activity-card h4{margin:0 0 6px;color:#183153}
        .bda-db-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}
        .bda-meta-line{font-size:13px;color:#5f7395}
        .bda-notice{padding:14px 16px;border-radius:16px;background:#eef5ff;border:1px solid rgba(67,104,205,.14);color:#20478a;font-weight:700}
        .bda-empty{padding:22px;border-radius:18px;background:#f7f9fc;border:1px dashed rgba(79,104,148,.25);color:#5f7395;line-height:1.6}
        .bda-manual-box details{margin-top:10px}
        .bda-playbook{padding:14px;border-radius:18px;background:#f7fbff;border:1px solid rgba(74,104,166,.12)}
        .bda-playbook ul{margin:8px 0 0 18px;padding:0;color:#5c7090;line-height:1.6}
        .bda-copy-box{padding:14px;border-radius:16px;background:#f8fbff;border:1px solid rgba(74,104,166,.12);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#183153;line-height:1.6;word-break:break-word}
        .bda-helper-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
        .bda-helper-list span{background:#fff7e4;border:1px solid rgba(222,176,103,.38);border-radius:999px;padding:9px 13px;font-size:13px;color:#7b4a00;font-weight:800}
        .bda-activity-card{background:#fff8ef;border-color:rgba(232,173,89,.18)}
        .bda-activity-line{padding:12px 14px;border-radius:16px;background:#fff;border:1px solid rgba(224,186,112,.18);display:flex;flex-direction:column;gap:6px}
        .bda-footer-bar{position:sticky;bottom:0;background:rgba(255,255,255,.9);backdrop-filter:blur(8px);padding:14px 0 0;display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap}
        @media (max-width:1180px){.bda-hero-grid,.bda-panels,.bda-stat-grid,.bda-summary-grid,.bda-wide-grid,.bda-db-grid,.bda-search-grid,.bda-form-grid,.bda-form-grid.two,.bda-summary-grid.advanced{grid-template-columns:1fr}}
      `}</style>

      <div className="bda-page">
        {notice ? <div className="bda-notice">{notice}</div> : null}

        <div className="bda-hero-grid">
          <div className="bda-hero-box">
            <div className="bda-title-row">
              <div>
                <h2 className="bda-title-lg">BDA lead capture, but readable this time</h2>
                <div className="bda-sub">Paste a visible post, review only the important fields, open more options only when needed, then add clean records to the BDA database.</div>
              </div>
              <div className="bda-chip-row">
                <span className="bda-chip">Separate BDA Slice</span>
                <span className="bda-chip soft">Easy Review</span>
                <span className="bda-chip soft">Serial Auto Save</span>
              </div>
            </div>
            <div className="bda-helper-list">
              {autoFillPreview.map((item) => <span key={item}>{item}</span>)}
            </div>
          </div>
          <div className="bda-helper-box">
            <div className="bda-card-kicker">How it fills</div>
            <h3>Auto-fill works best on visible data</h3>
            <p className="bda-sub">Best results come from pasted visible post text, public page text, company pages, or clean raw dumps. The parser fills contact, company, phone, email, LinkedIn URL, post text, notes, stage, priority and score.</p>
            <div className="bda-chip-row">
              <span className="bda-chip warm">Paste visible post</span>
              <span className="bda-chip warm">Review card</span>
              <span className="bda-chip warm">Add to Database</span>
            </div>
          </div>
        </div>

        <div className="bda-stat-grid">
          <StatCard label="Total Leads" value={stats.total || 0} note="Everything already inside the BDA database." tone="blue" />
          <StatCard label="Follow-up Due" value={stats.due || 0} note="These need a touch before they go cold." tone="orange" />
          <StatCard label="Hot Leads" value={stats.hot || 0} note="Best vendor-ready or response-signal leads." tone="green" />
          <StatCard label="Last Serial" value={stats.max_serial || 0} note="New records continue from this number." tone="pink" />
        </div>

        <div className="bda-section-row">
          {[
            ['capture', 'Lead Capture', 'Paste post, review, save'],
            ['database', 'Lead Database', 'See leads and quick updates'],
            ['activity', 'Activity & Follow-up', 'Notes, calls and follow-up log'],
            ['playbooks', 'Playbooks & Search', 'Boolean strings and process'],
          ].map(([key, title, note]) => (
            <button key={key} className={`bda-section-btn ${section === key ? 'active' : ''}`} onClick={() => setSection(key)}>
              <strong>{title}</strong>
              <small>{note}</small>
            </button>
          ))}
        </div>

        {section === 'capture' ? (
          <>
            <div className="bda-panels">
              <div className="bda-box">
                <div className="bda-box-head">
                  <div>
                    <div className="bda-card-kicker">Step 1</div>
                    <h3>Paste raw visible data</h3>
                    <p>Use one pasted post or one clean raw block for the best results. Large mixed dumps can reduce extraction quality.</p>
                  </div>
                  <div className="bda-input-tabs">
                    <button className={`bda-tab ${captureMode === 'raw' ? 'active' : ''}`} onClick={() => setCaptureMode('raw')}>Paste text</button>
                    <button className={`bda-tab ${captureMode === 'url' ? 'active' : ''}`} onClick={() => setCaptureMode('url')}>Public URL</button>
                  </div>
                </div>

                <div className="bda-form-grid">
                  <label><span>Source channel</span>
                    <select value={sourceChannel} onChange={(e) => {
                      const value = e.target.value;
                      setSourceChannel(value);
                      if (value === 'LinkedIn' && !sourceLabel.trim()) setSourceLabel('LinkedIn visible post');
                    }}>
                      {sourceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                  <label><span>Source label</span><input value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} placeholder="Example: LinkedIn visible post" /></label>
                  <label><span>Window from</span><input value={resultWindowFrom} onChange={(e) => setResultWindowFrom(e.target.value)} placeholder="Apr 2026" /></label>
                  <label><span>Window to</span><input value={resultWindowTo} onChange={(e) => setResultWindowTo(e.target.value)} placeholder="Apr 2026" /></label>
                </div>

                <div className="bda-form-grid two" style={{ marginTop: 14 }}>
                  <label className="bda-wide-field"><span>Search string</span><input value={searchString} onChange={(e) => setSearchString(e.target.value)} placeholder='Example: Noida AND vendors AND BPO AND contact number' /></label>
                  {captureMode === 'url'
                    ? <label className="bda-wide-field"><span>Public URL</span><input value={extractorUrl} onChange={(e) => setExtractorUrl(e.target.value)} placeholder="https://example.com/public-page" /></label>
                    : <label className="bda-wide-field"><span>Visible raw text</span><textarea rows={10} value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder="Paste visible post text, copied search results, WhatsApp raw text, or public page text here" /></label>}
                </div>

                <div className="bda-actions" style={{ marginTop: 14 }}>
                  <button className="bda-btn" onClick={captureMode === 'url' ? parseUrl : parseRaw} disabled={busy}>{busy ? 'Working...' : captureMode === 'url' ? 'Extract from URL' : 'Parse visible data'}</button>
                  <button className="bda-btn alt" onClick={() => { setRawText(''); setExtractorUrl(''); setParsedRows([]); }}>Clear</button>
                </div>
              </div>

              <div className="bda-box">
                <div className="bda-card-kicker">Step 2</div>
                <h3>What will fill automatically</h3>
                <p className="bda-inline-note">Main fields are shown first. More options stay hidden inside each card so the page stops looking like an accident.</p>
                <div className="bda-helper-list">
                  {autoFillPreview.map((item) => <span key={item}>{item}</span>)}
                </div>
                <div className="bda-empty" style={{ marginTop: 14 }}>
                  Best flow: paste one visible post, check the preview card, fix only the wrong fields, then click <strong>Add to Database</strong>. New serial and BDA ID are created automatically.
                </div>
              </div>
            </div>

            <div className="bda-box">
              <div className="bda-box-head">
                <div>
                  <div className="bda-card-kicker">Step 3</div>
                  <h3>Preview cards before save</h3>
                  <p>{parsedRows.length ? `${selectedParsedCount} selected out of ${parsedRows.length} parsed row(s).` : 'Nothing parsed yet. Once you parse, clean preview cards will appear here.'}</p>
                </div>
                {parsedRows.length ? (
                  <div className="bda-actions">
                    <button className="bda-btn alt" onClick={() => setParsedRows((current) => current.map((row, index) => ({ ...row, include: index < 3 })))}>Keep top 3 only</button>
                    <button className="bda-btn alt" onClick={() => setParsedRows((current) => current.map((row) => ({ ...row, include: true })))}>Include all</button>
                  </div>
                ) : null}
              </div>

              {parsedRows.length ? (
                <div className="bda-result-stack">
                  {parsedRows.map((row, index) => (
                    <ResultCard
                      key={row.preview_key}
                      row={row}
                      index={index}
                      onToggle={toggleParsedRow}
                      onPatch={(previewKey, field, value) => patchRow(setParsedRows, previewKey, field, value)}
                    />
                  ))}
                </div>
              ) : <div className="bda-empty">No preview yet. Parse a visible post or a public page first.</div>}

              {parsedRows.length ? (
                <div className="bda-footer-bar">
                  <div className="bda-inline-note">Selected rows will save with new serial numbers and BDA IDs.</div>
                  <button className="bda-btn wide" onClick={importParsed} disabled={busy}>{busy ? 'Saving...' : `Add ${selectedParsedCount} row(s) to Database`}</button>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {section === 'database' ? (
          <>
            <div className="bda-box">
              <div className="bda-box-head">
                <div>
                  <div className="bda-card-kicker">Database</div>
                  <h3>Clean lead cards</h3>
                  <p>Quick filter, update stage, set follow-up, keep moving. Less clutter, less headache.</p>
                </div>
                <div className="bda-pill-row">
                  {[
                    ['all', 'All'],
                    ['hot', 'Hot'],
                    ['due', 'Due'],
                    ['qualified', 'Qualified'],
                    ['won', 'Won'],
                  ].map(([key, label]) => (
                    <button key={key} className={`bda-pill ${quickFilter === key ? 'active' : ''}`} onClick={() => setQuickFilter(key)}>{label}</button>
                  ))}
                </div>
              </div>

              {filteredRows.length ? (
                <div className="bda-db-grid">
                  {filteredRows.slice(0, 12).map((row) => (
                    <div key={row.lead_id} className="bda-db-card">
                      <div className="bda-db-top">
                        <div>
                          <div className="bda-card-kicker">{row.lead_id}</div>
                          <h4>{row.contact_name || row.post_author_name || row.company_name || 'Unnamed lead'}</h4>
                          <div className="bda-chip-row">
                            <span className={`bda-chip ${chipTone(row.score)}`}>Score {Number(row.score || 0)}</span>
                            <span className="bda-chip soft">{row.stage || 'New'}</span>
                            <span className="bda-chip soft">{row.priority || 'Medium'}</span>
                          </div>
                        </div>
                        <button className="bda-btn alt" onClick={() => setActivityLeadId(row.lead_id)}>Open Activity</button>
                      </div>

                      <div className="bda-db-meta">
                        <div className="bda-meta-line"><strong>Company:</strong> {row.company_name || '-'}</div>
                        <div className="bda-meta-line"><strong>Source:</strong> {row.source_label || row.source_channel || '-'}</div>
                        <div className="bda-meta-line"><strong>Phone:</strong> {row.phone || '-'}</div>
                        <div className="bda-meta-line"><strong>Email:</strong> {row.email || '-'}</div>
                        <div className="bda-meta-line"><strong>City:</strong> {row.city || '-'}</div>
                        <div className="bda-meta-line"><strong>Next follow-up:</strong> {row.next_follow_up_at ? formatDate(row.next_follow_up_at) : '-'}</div>
                      </div>

                      <div className="bda-summary-grid" style={{ marginTop: 14 }}>
                        <label><span>Stage</span>
                          <select value={row.stage || 'New'} onChange={(e) => setRows((current) => current.map((item) => item.lead_id === row.lead_id ? { ...item, stage: e.target.value } : item))}>
                            {stageOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </label>
                        <label><span>Priority</span>
                          <select value={row.priority || 'Medium'} onChange={(e) => setRows((current) => current.map((item) => item.lead_id === row.lead_id ? { ...item, priority: e.target.value } : item))}>
                            {priorityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </label>
                        <label><span>Lead type</span>
                          <select value={row.lead_type || 'Warm'} onChange={(e) => setRows((current) => current.map((item) => item.lead_id === row.lead_id ? { ...item, lead_type: e.target.value } : item))}>
                            {leadTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </label>
                        <label><span>Next follow-up</span>
                          <input type="date" value={String(row.next_follow_up_at || '').slice(0, 10)} onChange={(e) => setRows((current) => current.map((item) => item.lead_id === row.lead_id ? { ...item, next_follow_up_at: e.target.value } : item))} />
                        </label>
                      </div>

                      <label style={{ marginTop: 14 }}><span>Notes</span><textarea rows={4} value={row.notes || ''} onChange={(e) => setRows((current) => current.map((item) => item.lead_id === row.lead_id ? { ...item, notes: e.target.value } : item))} /></label>
                      <div className="bda-actions" style={{ marginTop: 12 }}>
                        <button className="bda-btn" onClick={() => updateLead(row.lead_id, { stage: row.stage, priority: row.priority, lead_type: row.lead_type, next_follow_up_at: row.next_follow_up_at, notes: row.notes })} disabled={busy}>Save Update</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <div className="bda-empty">No leads inside the BDA database yet.</div>}
            </div>

            <div className="bda-box bda-manual-box">
              <div className="bda-card-kicker">Optional</div>
              <h3>Manual add lead</h3>
              <details>
                <summary>Open manual form</summary>
                <form onSubmit={createLead} className="bda-list-stack" style={{ marginTop: 14 }}>
                  <div className="bda-form-grid">
                    <label><span>Contact</span><input value={form.contact_name} onChange={(e) => setForm((current) => ({ ...current, contact_name: e.target.value }))} /></label>
                    <label><span>Company</span><input value={form.company_name} onChange={(e) => setForm((current) => ({ ...current, company_name: e.target.value }))} /></label>
                    <label><span>Phone</span><input value={form.phone} onChange={(e) => setForm((current) => ({ ...current, phone: e.target.value }))} /></label>
                    <label><span>Email</span><input value={form.email} onChange={(e) => setForm((current) => ({ ...current, email: e.target.value }))} /></label>
                  </div>
                  <div className="bda-form-grid two">
                    <label><span>Source Label</span><input value={form.source_label} onChange={(e) => setForm((current) => ({ ...current, source_label: e.target.value }))} /></label>
                    <label><span>Notes</span><textarea rows={4} value={form.notes} onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))} /></label>
                  </div>
                  <div className="bda-actions"><button className="bda-btn" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Add Manual Lead'}</button></div>
                </form>
              </details>
            </div>
          </>
        ) : null}

        {section === 'activity' ? (
          <div className="bda-panels">
            <div className="bda-box">
              <div className="bda-card-kicker">Follow-up</div>
              <h3>Log activity</h3>
              <form onSubmit={saveActivity} className="bda-list-stack" style={{ marginTop: 14 }}>
                <div className="bda-form-grid">
                  <label><span>Lead</span>
                    <select value={activityLeadId} onChange={(e) => setActivityLeadId(e.target.value)}>
                      <option value="">Select lead</option>
                      {rows.slice(0, 80).map((row) => <option key={row.lead_id} value={row.lead_id}>{row.lead_id} - {row.contact_name || row.company_name || 'Lead'}</option>)}
                    </select>
                  </label>
                  <label><span>Activity type</span>
                    <select value={activityForm.activity_type} onChange={(e) => setActivityForm((current) => ({ ...current, activity_type: e.target.value }))}>
                      {activityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                  <label><span>Summary</span><input value={activityForm.summary} onChange={(e) => setActivityForm((current) => ({ ...current, summary: e.target.value }))} placeholder="Example: Intro mail sent" /></label>
                  <label><span>Outcome</span><input value={activityForm.outcome} onChange={(e) => setActivityForm((current) => ({ ...current, outcome: e.target.value }))} placeholder="Example: Waiting for reply" /></label>
                </div>
                <div className="bda-actions"><button className="bda-btn" type="submit" disabled={busy}>Save Activity</button></div>
              </form>
            </div>
            <div className="bda-activity-card">
              <div className="bda-card-kicker">Log</div>
              <h4>Recent activity</h4>
              <div className="bda-activity-stack" style={{ marginTop: 14 }}>
                {activityRows.length ? activityRows.map((item) => (
                  <div key={item.activity_id} className="bda-activity-line">
                    <strong>{item.activity_type}</strong>
                    <span>{item.summary}</span>
                    <span className="bda-inline-note">{item.outcome || 'No outcome added'} · {formatDate(item.created_at)}</span>
                  </div>
                )) : <div className="bda-empty">No activity yet for this lead.</div>}
              </div>
            </div>
          </div>
        ) : null}

        {section === 'playbooks' ? (
          <div className="bda-list-stack">
            <div className="bda-box">
              <div className="bda-card-kicker">Search Builder</div>
              <h3>Boolean strings</h3>
              <div className="bda-search-grid" style={{ marginTop: 14 }}>
                <label><span>Keywords</span><input value={builder.keywords} onChange={(e) => setBuilder((current) => ({ ...current, keywords: e.target.value }))} /></label>
                <label><span>City</span><input value={builder.city} onChange={(e) => setBuilder((current) => ({ ...current, city: e.target.value }))} /></label>
                <label><span>Industry</span><input value={builder.industry} onChange={(e) => setBuilder((current) => ({ ...current, industry: e.target.value }))} /></label>
              </div>
              <div className="bda-search-grid" style={{ marginTop: 16 }}>
                <div className="bda-copy-box">{booleanStrings.linkedin}</div>
                <div className="bda-copy-box">{booleanStrings.google}</div>
                <div className="bda-copy-box">{booleanStrings.companySearch}</div>
              </div>
            </div>

            <div className="bda-db-grid">
              {(meta.playbooks || []).map((playbook) => (
                <div key={playbook.key || playbook.title} className="bda-playbook">
                  <div className="bda-card-kicker">Playbook</div>
                  <h3>{playbook.title}</h3>
                  <ul>
                    {(playbook.lines || []).map((line) => <li key={line}>{line}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {loading ? <div className="bda-empty">Loading BDA...</div> : null}
      </div>
    </Layout>
  );
}
