import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const PRESETS = [
  { key: '1h', label: '1 Hour', hours: 1 },
  { key: '6h', label: '6 Hours', hours: 6 },
  { key: '1d', label: '1 Day', days: 1 },
  { key: '3d', label: '3 Days', days: 3 },
  { key: '7d', label: '7 Days', days: 7 },
  { key: '1m', label: '1 Month+', days: 30 },
];

function toDateTimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTime(value) {
  if (!value) return 'Not generated yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function buildRangeFromPreset(preset) {
  const now = new Date();
  const from = new Date(now);
  if (preset.hours) from.setHours(from.getHours() - preset.hours);
  if (preset.days) from.setDate(from.getDate() - preset.days);
  return {
    from: toDateTimeLocal(from),
    to: toDateTimeLocal(now),
  };
}

function triggerDownload(url) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.setAttribute('download', '');
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function openReport(item) {
  if (!item?.open_url) return;
  if (String(item.report_type || '').toLowerCase() === 'semi-hourly') {
    window.open(item.open_url, '_blank', 'noopener,noreferrer');
    return;
  }
  triggerDownload(item.open_url);
}

export default function ReportsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ recruiters: [], categories: [], tables_ready: [], cards: {} });
  const [filters, setFilters] = useState({ recruiter_code: 'all', categories: [], from: '', to: '', preset: 'all' });
  const [latest, setLatest] = useState('');
  const [busy, setBusy] = useState(false);
  const isManager = String(user?.role || '').toLowerCase() === 'manager';

  async function load() {
    const data = await api.get('/api/reports');
    const nextMeta = data.meta || { recruiters: [], categories: [], tables_ready: [], cards: {} };
    setItems(data.items || []);
    setMeta(nextMeta);
    setFilters((prev) => ({
      ...prev,
      categories: prev.categories.length ? prev.categories : (nextMeta.categories || []).map((item) => item.key),
    }));
  }

  useEffect(() => {
    load();
  }, []);

  const selectedAll = filters.categories.length === (meta.categories || []).length;

  const selectedLabels = useMemo(() => {
    const selected = new Set(filters.categories);
    return (meta.categories || []).filter((item) => selected.has(item.key)).map((item) => item.label);
  }, [filters.categories, meta.categories]);

  async function generateReport(customCategories) {
    setBusy(true);
    try {
      const payload = {
        ...filters,
        categories: customCategories || filters.categories,
      };
      const data = await api.post('/api/reports/generate', payload);
      setLatest(data.download_url || '');
      if (data.download_url) triggerDownload(data.download_url);
      await load();
    } finally {
      setBusy(false);
    }
  }

  function toggleCategory(key) {
    setFilters((prev) => {
      const exists = prev.categories.includes(key);
      const categories = exists
        ? prev.categories.filter((item) => item !== key)
        : [...prev.categories, key];
      return { ...prev, categories: categories.length ? categories : [key] };
    });
  }

  function selectAllCategories() {
    setFilters((prev) => ({ ...prev, categories: (meta.categories || []).map((item) => item.key) }));
  }

  function applyPreset(preset) {
    const range = buildRangeFromPreset(preset);
    setFilters((prev) => ({ ...prev, from: range.from, to: range.to, preset: preset.label }));
  }

  const cards = [
    { className: 'orange', label: 'Last Report Made', value: meta.cards?.last_report_made ? formatDateTime(meta.cards.last_report_made) : 'Just Now' },
    { className: 'green', label: 'Reports Generated', value: String(meta.cards?.reports_generated || 0) },
    { className: 'blue', label: 'Recruiter Codes', value: String(meta.cards?.recruiter_codes || 0) },
    { className: 'purple', label: 'Tables Ready', value: String(meta.cards?.tables_ready || 0) },
  ];

  return (
    <Layout title="Reports" subtitle="Download local Excel reports without eating Supabase storage.">
      <style>{`
        .reports-shell{display:flex;flex-direction:column;gap:18px;}
        .reports-hero-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr)) auto;gap:14px;align-items:stretch;}
        .reports-download-top{min-width:190px;border:none;border-radius:20px;padding:16px 18px;font-weight:800;color:#fff;background:linear-gradient(135deg,#4b8dff,#26c2ff);box-shadow:0 16px 30px rgba(58,108,255,.2);cursor:pointer;}
        .reports-download-top:disabled{opacity:.65;cursor:wait;}
        .reports-filter-panel{padding:18px;border-radius:24px;border:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.93),rgba(247,251,255,.95));box-shadow:var(--shadow-soft);display:flex;flex-direction:column;gap:16px;}
        .reports-filter-grid{display:grid;grid-template-columns:1.1fr 1.25fr 1.8fr;gap:14px;align-items:start;}
        .reports-field{display:flex;flex-direction:column;gap:8px;}
        .reports-field label{font-size:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);}
        .reports-field select,.reports-field input{width:100%;min-height:44px;border-radius:16px;border:1px solid var(--line);padding:0 14px;font-weight:700;background:rgba(255,255,255,.92);color:var(--text-main);box-shadow:inset 0 1px 0 rgba(255,255,255,.85);}
        .reports-presets{display:flex;flex-wrap:wrap;gap:8px;}
        .reports-preset-btn,.reports-chip,.reports-select-all{border:none;border-radius:999px;padding:10px 16px;font-weight:800;cursor:pointer;box-shadow:0 10px 20px rgba(17,21,35,.07);}
        .reports-preset-btn{background:linear-gradient(135deg,#f8fbff,#eaf1ff);color:#4867db;}
        .reports-chip{background:linear-gradient(135deg,#fff,#eff5ff);color:var(--text-main);}
        .reports-chip.active{background:linear-gradient(135deg,#4e7eff,#6b63ff);color:#fff;box-shadow:0 16px 28px rgba(78,126,255,.22);}
        .reports-select-all{background:linear-gradient(135deg,#eaf8f1,#dff7e7);color:#14935d;}
        .reports-category-wrap{display:flex;flex-wrap:wrap;gap:10px;align-items:center;}
        .reports-datetime-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
        .reports-panels{display:grid;grid-template-columns:1fr 1fr;gap:18px;}
        .reports-panel{padding:18px;border-radius:24px;border:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.94),rgba(247,251,255,.94));box-shadow:var(--shadow-soft);}
        .reports-panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px;}
        .reports-panel-title{font-size:18px;font-weight:900;color:var(--text-main);}
        .reports-mini-note{color:var(--muted);font-size:12px;font-weight:700;}
        .reports-table{width:100%;border-collapse:collapse;overflow:hidden;border-radius:18px;}
        .reports-table th,.reports-table td{padding:12px 14px;border-bottom:1px solid rgba(214,225,240,.8);text-align:left;font-size:13px;vertical-align:top;}
        .reports-table th{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:#5a73a8;background:linear-gradient(90deg,rgba(109,183,255,.14),rgba(247,127,155,.08),rgba(115,217,200,.08));}
        .reports-row-download{border:none;border-radius:12px;padding:9px 14px;font-weight:800;color:#fff;background:linear-gradient(135deg,#35c18b,#16a06e);cursor:pointer;}
        .reports-row-open{border:none;border-radius:12px;padding:9px 14px;font-weight:800;color:#fff;background:linear-gradient(135deg,#4e7eff,#6b63ff);cursor:pointer;}
        .reports-latest{padding:12px 14px;border-radius:16px;background:linear-gradient(135deg,rgba(76,111,255,.1),rgba(38,212,255,.09));border:1px solid rgba(76,111,255,.18);font-weight:700;color:#3450b0;}
        .reports-selection-note{font-size:12px;color:var(--muted);font-weight:700;}
        @media (max-width: 1180px){
          .reports-hero-row{grid-template-columns:repeat(2,minmax(0,1fr));}
          .reports-filter-grid,.reports-panels{grid-template-columns:1fr;}
        }
        @media (max-width: 720px){
          .reports-hero-row{grid-template-columns:1fr;}
          .reports-datetime-row{grid-template-columns:1fr;}
        }
      `}</style>

      <div className="reports-shell">
        <div className="reports-hero-row">
          {cards.map((card) => (
            <div key={card.label} className={`stat-card ${card.className}`}>
              <div className="stat-label">{card.label}</div>
              <div className="stat-value">{card.value}</div>
            </div>
          ))}
          {isManager && <button className="reports-download-top" disabled={busy} onClick={() => generateReport()}>
            {busy ? 'Generating...' : 'Download Report'}
          </button>}
        </div>

        <div className="reports-filter-panel">
          <div className="reports-latest">Every 30 minutes report is now saved here automatically, so you can reopen it from the Recent Reports panel without waiting for the popup again.</div>
          <div className="reports-filter-grid">
            <div className="reports-field">
              <label>Recruiter</label>
              <select value={filters.recruiter_code} onChange={(e) => setFilters((prev) => ({ ...prev, recruiter_code: e.target.value }))}>
                <option value="all">All Recruiters</option>
                {(meta.recruiters || []).map((item) => (
                  <option key={item.user_id} value={item.recruiter_code}>{item.recruiter_code} · {item.full_name}</option>
                ))}
              </select>
            </div>

            <div className="reports-field">
              <label>Category</label>
              <div className="reports-category-wrap">
                <button className="reports-select-all" type="button" onClick={selectAllCategories}>Select All</button>
                <div className="reports-selection-note">{selectedAll ? 'All categories selected' : selectedLabels.join(', ') || 'Nothing selected'}</div>
              </div>
            </div>

            <div className="reports-field">
              <label>Duration</label>
              <div className="reports-presets">
                {PRESETS.map((preset) => (
                  <button key={preset.key} type="button" className="reports-preset-btn" onClick={() => applyPreset(preset)}>{preset.label}</button>
                ))}
              </div>
              <div className="reports-datetime-row">
                <input type="datetime-local" value={filters.from} onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value, preset: 'Custom' }))} />
                <input type="datetime-local" value={filters.to} onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value, preset: 'Custom' }))} />
              </div>
            </div>
          </div>

          <div className="reports-category-wrap">
            {(meta.categories || []).map((item) => (
              <button
                key={item.key}
                type="button"
                className={`reports-chip ${filters.categories.includes(item.key) ? 'active' : ''}`}
                onClick={() => toggleCategory(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {isManager && latest && <div className="reports-latest">Latest file ready: <a href={latest}>Open downloaded report</a></div>}
        </div>

        <div className="reports-panels">
          <div className="reports-panel">
            <div className="reports-panel-head">
              <div>
                <div className="reports-panel-title">Tables Ready to Download</div>
                <div className="reports-mini-note">Local Excel export only. Browser saves file to laptop.</div>
              </div>
            </div>
            <table className="reports-table colorful-table">
              <thead>
                <tr>
                  <th>Table Name</th>
                  <th>Source</th>
                  <th>Records</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {(meta.tables_ready || []).map((row) => (
                  <tr key={row.key}>
                    <td>{row.label}</td>
                    <td>{row.table_name}</td>
                    <td>{row.record_count}</td>
                    <td>{isManager ? <button className="reports-row-download" type="button" onClick={() => generateReport([row.key])}>Download</button> : <span className="helper-text">Manager only</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="reports-panel">
            <div className="reports-panel-head">
              <div>
                <div className="reports-panel-title">Recent Reports</div>
                <div className="reports-mini-note">Excel exports plus auto-saved 30 minutes reports.</div>
              </div>
            </div>
            <table className="reports-table colorful-table">
              <thead>
                <tr>
                  <th>Report Name</th>
                  <th>Format</th>
                  <th>Made By</th>
                  <th>Saved Time</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {items.length ? items.slice(0, 12).map((row) => (
                  <tr key={row.report_id}>
                    <td>{row.title}</td>
                    <td>{String(row.file_format || (String(row.report_type || '').toLowerCase() === 'semi-hourly' ? 'live' : 'xls')).toUpperCase()}</td>
                    <td>{row.user_id || 'manual'}</td>
                    <td>{formatDateTime(row.last_run_at || row.created_at)}</td>
                    <td>{row.open_url ? <button className="reports-row-open" type="button" onClick={() => openReport(row)}>{String(row.report_type || '').toLowerCase() === 'semi-hourly' ? 'Open' : 'Download'}</button> : <span className="helper-text">Unavailable</span>}</td>
                  </tr>
                )) : (
                  <tr><td colSpan="5">No reports generated yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}
