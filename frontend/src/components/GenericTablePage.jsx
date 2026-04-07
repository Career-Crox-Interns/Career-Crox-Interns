import React, { useEffect, useMemo, useState } from 'react';
import Layout from './Layout';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';

export default function GenericTablePage({ title, subtitle, endpoint, columns, actions, createConfig, rowHref, pollMs = 6000 }) {
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(createConfig ? createConfig.initial : null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const data = await api.get(endpoint);
      setRows(data.items || []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [endpoint]);
  usePolling(load, pollMs, [endpoint]);

  async function submitCreate(e) {
    e.preventDefault();
    if (!createConfig) return;
    await api.post(createConfig.endpoint, form);
    setForm(createConfig.initial);
    load();
  }

  const renderedActions = useMemo(() => (typeof actions === 'function' ? actions({ reload: load, rows }) : actions), [actions, rows]);

  return (
    <Layout title={title} subtitle={subtitle}>
      <div className="table-panel top-gap-small glassy-card fade-up"><div className="table-toolbar"><div className="table-title">{title}</div><div className="toolbar-actions compact-pills">{renderedActions}{rows.length ? <span className="mini-chip">{rows.length} records</span> : null}<span className="mini-chip live-chip">Live refresh</span></div></div></div>
      {createConfig && <div className="panel top-gap"><div className="panel-title">Quick Create</div><form className="inline-form" onSubmit={submitCreate}>{createConfig.fields.map((field) => <input key={field.key} className="inline-input" placeholder={field.label} value={form[field.key] || ''} onChange={(e) => setForm({ ...form, [field.key]: e.target.value })} />)}<button className="add-profile-btn bounceable" type="submit">Add</button></form></div>}
      <div className="table-panel top-gap glassy-card fade-up"><div className="crm-table-wrap dense-wrap"><table className="crm-table colorful-table dense-table"><thead><tr>{columns.map((col) => <th key={col.key}>{col.label}</th>)}</tr></thead><tbody>{rows.map((row, idx) => { const href = typeof rowHref === 'function' ? rowHref(row) : null; return <tr key={row.id || row.notification_id || row.task_id || row.interview_id || row.jd_id || row.submission_id || row.lead_id || row.rev_id || row.request_id || idx} className={href ? 'clickable-row' : ''} onClick={href ? () => window.location.assign(href) : undefined}>{columns.map((col) => <td key={col.key}>{col.render ? col.render(row, { reload: load }) : (row[col.key] || '-')}</td>)}</tr>; })}{!loading && rows.length === 0 ? <tr><td colSpan={columns.length} className="helper-text">No records found.</td></tr> : null}</tbody></table></div></div>
    </Layout>
  );
}
