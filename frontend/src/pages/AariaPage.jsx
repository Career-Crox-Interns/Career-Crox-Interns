import React, { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';

const QUICK = [
  'assign task callback followup to RC-101',
  'message RC-101: call me now',
  'mark all notifications read',
  'approve unlock UR001',
];

export default function AariaPage() {
  const [command, setCommand] = useState('');
  const [rows, setRows] = useState([]);
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await api.get('/api/aaria');
    setRows(data.items || []);
  }
  useEffect(() => { load(); }, []);

  async function run() {
    if (!command.trim()) return;
    setBusy(true);
    try {
      const data = await api.post('/api/aaria/execute', { command });
      setResult(data.result || 'Done');
      setCommand('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout title="Aaria" subtitle="Reference-inspired command center. This React port handles task assign, team message, notification cleanup, and unlock actions first.">
      <div className="small-grid two top-gap">
        <div className="panel fade-up">
          <div className="panel-title">Quick Aaria Commands</div>
          <div className="helper-text top-gap-small">Start with the safe useful stuff instead of summoning chaos.</div>
          <div className="activity-list top-gap-small">
            {QUICK.map((item) => <button key={item} type="button" className="activity-item aaria-quick-btn" onClick={() => setCommand(item)}><div className="activity-left"><div className="activity-name">{item}</div></div></button>)}
          </div>
        </div>
        <div className="panel fade-up">
          <div className="panel-title">Run Command</div>
          <div className="field top-gap-small"><label>Command</label><textarea rows="5" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="assign task callback to RC-101" /></div>
          <div className="row-actions top-gap"><button className="add-profile-btn bounceable" type="button" disabled={busy || !command.trim()} onClick={run}>{busy ? 'Running...' : 'Run Aaria'}</button></div>
          {result ? <div className="helper-text top-gap-small">{result}</div> : null}
        </div>
      </div>
      <div className="table-panel top-gap glassy-card fade-up">
        <div className="table-toolbar"><div className="table-title">Aaria History</div></div>
        <div className="crm-table-wrap dense-wrap">
          <table className="crm-table colorful-table dense-table">
            <thead><tr><th>When</th><th>Serial</th><th>Command</th><th>Status</th><th>Result</th></tr></thead>
            <tbody>
              {rows.map((row) => <tr key={row.task_id}><td>{String(row.created_at || '').replace('T', ' ').slice(0, 16)}</td><td>{row.serial_hint}</td><td>{row.command_text}</td><td>{row.status}</td><td>{row.result_text}</td></tr>)}
              {!rows.length && <tr><td colSpan="5" className="helper-text">No Aaria tasks yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
