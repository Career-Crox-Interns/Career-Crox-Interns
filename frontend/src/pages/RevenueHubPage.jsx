import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { visiblePhone } from '../lib/candidateAccess';
import { usePolling } from '../lib/usePolling';

const cardConfig = [
  ['will_come_for_interview', 'Will Come', 'blue'],
  ['appeared_for_interview', 'Appeared', 'orange'],
  ['rejected', 'Rejected', 'red'],
  ['selected', 'Selected', 'teal'],
  ['pending_joining', 'Joining Pending', 'purple'],
  ['joined', 'Joined', 'green'],
  ['not_joined', 'Not Joined', 'pink'],
  ['completed_60_days', 'Completed 60 Days', 'violet'],
  ['payout_pending', 'Payout Pending', 'orange'],
  ['payout_received', 'Payout Received', 'mint'],
];
const statusOptions = [
  ['will_come_for_interview', 'Will Come for Interview'],
  ['appeared_for_interview', 'Appeared in Interview'],
  ['rejected', 'Rejected'],
  ['selected', 'Selected'],
  ['pending_joining', 'Pending Joining'],
  ['joined', 'Joined'],
  ['not_joined', 'Not Joined'],
  ['completed_60_days', 'Completed 60 Days'],
];
const payoutOptions = [
  ['none', 'No Payout Stage'],
  ['payout_pending', 'Payout Pending'],
  ['payout_received', 'Payout Received'],
];
function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function classForStage(item) {
  if (item.payout_status === 'payout_received') return 'green';
  if (item.payout_pending || item.joining_pending_due || item.status === 'appeared_for_interview' || item.status === 'pending_joining') return 'orange';
  if (item.missed || item.status === 'rejected' || item.status === 'not_joined') return 'red';
  if (item.status === 'selected' || item.status === 'joined' || item.completed_60_days) return 'mint';
  return 'blue';
}

function ReminderPill({ children, tone = 'blue' }) {
  return <span className={`revenue-status-pill ${tone}`}>{children}</span>;
}

export default function RevenueHubPage() {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [cards, setCards] = useState({});
  const [lookups, setLookups] = useState({ clients: [], processes: [], recruiters: [] });
  const [activeCard, setActiveCard] = useState('');
  const [filters, setFilters] = useState({
    client_name: '',
    process: '',
    recruiter_name: '',
    candidate_name: '',
    candidate_id: '',
    status: '',
    payout_status: '',
    interview_date_from: '',
    interview_date_to: '',
    selection_date_from: '',
    selection_date_to: '',
    joining_date_from: '',
    joining_date_to: '',
  });
  const [savingId, setSavingId] = useState('');
  const [message, setMessage] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [searchItems, setSearchItems] = useState([]);
  const [addForm, setAddForm] = useState({ candidate_id: '', interview_date: '', client_name: '', notes: '' });
  const [rowDrafts, setRowDrafts] = useState({});

  function buildQuery() {
    const params = new URLSearchParams();
    const merged = { ...filters };
    if (activeCard && activeCard !== 'payout_pending' && activeCard !== 'payout_received' && activeCard !== 'completed_60_days') merged.status = activeCard;
    if (activeCard === 'payout_pending') merged.payout_status = 'payout_pending';
    if (activeCard === 'payout_received') merged.payout_status = 'payout_received';
    Object.entries(merged).forEach(([key, value]) => {
      if (String(value || '').trim()) params.set(key, value);
    });
    const query = params.toString();
    return query ? `?${query}` : '';
  }

  async function load() {
    const data = await api.get(`/api/revenue-hub${buildQuery()}`);
    setItems(data.items || []);
    setCards(data.cards || {});
    setLookups(data.lookups || { clients: [], processes: [], recruiters: [] });
    setRowDrafts((current) => {
      const next = { ...current };
      (data.items || []).forEach((item) => {
        next[item.revenue_id] ||= {
          status: item.status || 'will_come_for_interview',
          payout_status: item.payout_status || 'none',
          interview_date: item.interview_date || '',
          selection_date: item.selection_date || '',
          joining_date: item.joining_date || '',
          joined_date: item.joined_date || '',
          notes: item.notes || '',
        };
      });
      return next;
    });
  }

  useEffect(() => { load(); }, [activeCard, JSON.stringify(filters)]);
  usePolling(load, 10000, [activeCard, JSON.stringify(filters)]);

  async function runSearch() {
    const data = await api.get(`/api/revenue-hub/candidate-search?q=${encodeURIComponent(search)}`);
    setSearchItems(data.items || []);
  }

  useEffect(() => {
    if (!showAdd) return;
    runSearch().catch(() => {});
  }, [showAdd]);

  function pickCandidate(item) {
    setAddForm((prev) => ({
      ...prev,
      candidate_id: item.candidate_id,
      interview_date: String(item.interview_date || item.interview_reschedule_date || '').slice(0, 10),
      client_name: item.client_name || item.process || '',
    }));
  }

  async function addCandidate() {
    if (!addForm.candidate_id) {
      setMessage('Select candidate first.');
      return;
    }
    try {
      await api.post('/api/revenue-hub/add-candidate', addForm);
      setShowAdd(false);
      setSearch('');
      setSearchItems([]);
      setAddForm({ candidate_id: '', interview_date: '', client_name: '', notes: '' });
      setMessage('Candidate added to Revenue Hub.');
      await load();
    } catch (error) {
      setMessage(error.message || 'Add candidate failed.');
    }
  }

  async function saveRow(item) {
    const draft = rowDrafts[item.revenue_id];
    if (!draft) return;
    setSavingId(item.revenue_id);
    try {
      await api.post(`/api/revenue-hub/${item.revenue_id}/status`, draft);
      setMessage('Revenue stage updated.');
      await load();
    } catch (error) {
      setMessage(error.message || 'Update failed.');
    } finally {
      setSavingId('');
    }
  }

  const filteredCards = useMemo(() => cardConfig.map(([key, label, tone]) => ({ key, label, tone, value: cards[key] || 0 })), [cards]);

  function downloadExport() {
    const query = buildQuery();
    window.open(`/api/revenue-hub/export${query}`, '_blank');
  }

  return (
    <Layout title="Revenue Hub" subtitle="Interview to joining to payout workflow.">
      <div className="revenue-hub-shell fade-up">
        <div className="revenue-hub-topbar glassy-card">
          <div>
            <div className="table-title">Revenue Hub</div>
            <div className="helper-text">Track interview outcome, joining movement and payout status without missing closure.</div>
          </div>
          <div className="revenue-hub-head-actions">
            <button type="button" className="add-profile-btn bounceable" onClick={() => setShowAdd(true)}>Add Candidate</button>
            {String(user?.role || '').toLowerCase() === 'manager' && <button type="button" className="ghost-btn bounceable" onClick={downloadExport}>Export Details</button>}
          </div>
        </div>

        {!!message && <div className="panel top-gap-small"><div className="helper-text">{message}</div></div>}

        <div className="revenue-card-grid top-gap-small">
          {filteredCards.map((card) => (
            <button
              key={card.key}
              type="button"
              className={`stat-card revenue-journey-card ${card.tone} ${activeCard === card.key ? 'active' : ''}`}
              onClick={() => setActiveCard((current) => current === card.key ? '' : card.key)}
            >
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <small>{card.key === 'payout_pending' ? 'Needs payout action' : card.key === 'payout_received' ? 'Closed payout' : 'Current count'}</small>
            </button>
          ))}
        </div>

        <div className="table-panel top-gap glassy-card">
          <div className="table-toolbar revenue-toolbar-stack">
            <div>
              <div className="table-title">Revenue Flow Tracker</div>
              <div className="helper-text">All stages stay in one controlled queue. No loose sheets, no missed candidates.</div>
            </div>
            <div className="toolbar-actions compact-pills candidate-toolbar-actions">
              <span className="mini-chip">{items.length} records</span>
              <button type="button" className="ghost-btn bounceable modern-filter-btn" onClick={() => { setFilters({ client_name: '', process: '', recruiter_name: '', candidate_name: '', candidate_id: '', status: '', payout_status: '', interview_date_from: '', interview_date_to: '', selection_date_from: '', selection_date_to: '', joining_date_from: '', joining_date_to: '' }); setActiveCard(''); }}>Reset Filters</button>
            </div>
          </div>

          <div className="revenue-filter-grid compact-filter-grid top-gap-small">
            <label className="bucket-filter-box"><span>Client</span><select className="bucket-modern-select" value={filters.client_name} onChange={(e) => setFilters((f) => ({ ...f, client_name: e.target.value }))}><option value="">All Clients</option>{(lookups.clients || []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label className="bucket-filter-box"><span>Process</span><select className="bucket-modern-select" value={filters.process} onChange={(e) => setFilters((f) => ({ ...f, process: e.target.value }))}><option value="">All Process</option>{(lookups.processes || []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label className="bucket-filter-box"><span>Recruiter</span><select className="bucket-modern-select" value={filters.recruiter_name} onChange={(e) => setFilters((f) => ({ ...f, recruiter_name: e.target.value }))}><option value="">All Recruiters</option>{(lookups.recruiters || []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
            <label className="bucket-filter-box"><span>Status</span><select className="bucket-modern-select" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}><option value="">All Status</option>{statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="bucket-filter-box"><span>Payout</span><select className="bucket-modern-select" value={filters.payout_status} onChange={(e) => setFilters((f) => ({ ...f, payout_status: e.target.value }))}><option value="">All Payout</option>{payoutOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="bucket-filter-box"><span>Candidate Name</span><input className="bucket-modern-select bucket-text-input" value={filters.candidate_name} onChange={(e) => setFilters((f) => ({ ...f, candidate_name: e.target.value }))} placeholder="Search name" /></label>
            <label className="bucket-filter-box"><span>Candidate Code</span><input className="bucket-modern-select bucket-text-input" value={filters.candidate_id} onChange={(e) => setFilters((f) => ({ ...f, candidate_id: e.target.value }))} placeholder="CI0101" /></label>
            <label className="bucket-filter-box"><span>Interview From</span><input type="date" className="bucket-modern-select bucket-text-input" value={filters.interview_date_from} onChange={(e) => setFilters((f) => ({ ...f, interview_date_from: e.target.value }))} /></label>
            <label className="bucket-filter-box"><span>Interview To</span><input type="date" className="bucket-modern-select bucket-text-input" value={filters.interview_date_to} onChange={(e) => setFilters((f) => ({ ...f, interview_date_to: e.target.value }))} /></label>
            <label className="bucket-filter-box"><span>Selection Date</span><input type="date" className="bucket-modern-select bucket-text-input" value={filters.selection_date_from} onChange={(e) => setFilters((f) => ({ ...f, selection_date_from: e.target.value }))} /></label>
            <label className="bucket-filter-box"><span>Joining Date</span><input type="date" className="bucket-modern-select bucket-text-input" value={filters.joining_date_from} onChange={(e) => setFilters((f) => ({ ...f, joining_date_from: e.target.value }))} /></label>
          </div>

          <div className="crm-table-wrap dense-wrap top-gap-small">
            <table className="crm-table colorful-table dense-table revenue-professional-table">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>Client / Process</th>
                  <th>Recruiter</th>
                  <th>Interview</th>
                  <th>Selection</th>
                  <th>Joining</th>
                  <th>Status</th>
                  <th>Payout</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const draft = rowDrafts[item.revenue_id] || {
                    status: item.status,
                    payout_status: item.payout_status || 'none',
                    interview_date: item.interview_date || '',
                    selection_date: item.selection_date || '',
                    joining_date: item.joining_date || '',
                    joined_date: item.joined_date || '',
                    notes: item.notes || '',
                  };
                  return (
                    <tr key={item.revenue_id}>
                      <td>
                        <strong>{item.full_name || '-'}</strong><br />
                        <span className="subtle">{item.candidate_id}</span><br />
                        <span className="subtle">{visiblePhone(user, item.phone)}</span>
                      </td>
                      <td>
                        <strong>{item.client_name || '-'}</strong><br />
                        <span className="subtle">{item.process || '-'}</span><br />
                        <span className="subtle">{item.location || '-'}</span>
                      </td>
                      <td>
                        <strong>{item.recruiter_name || '-'}</strong><br />
                        <span className="subtle">{item.recruiter_code || '-'}</span>
                      </td>
                      <td>
                        <input type="date" className="revenue-inline-input" value={draft.interview_date || ''} onChange={(e) => setRowDrafts((all) => ({ ...all, [item.revenue_id]: { ...draft, interview_date: e.target.value } }))} />
                        <div className="top-gap-small"><span className={`revenue-status-pill ${item.missed ? 'red' : item.overdue_interview ? 'orange' : 'blue'}`}>{item.missed ? 'Missed' : item.overdue_interview ? 'Update due' : 'Tracked'}</span></div>
                      </td>
                      <td>
                        <input type="date" className="revenue-inline-input" value={draft.selection_date || ''} onChange={(e) => setRowDrafts((all) => ({ ...all, [item.revenue_id]: { ...draft, selection_date: e.target.value } }))} />
                        <div className="top-gap-small"><span className="subtle">{formatDate(item.selection_date)}</span></div>
                      </td>
                      <td>
                        <input type="date" className="revenue-inline-input" value={draft.joining_date || ''} onChange={(e) => setRowDrafts((all) => ({ ...all, [item.revenue_id]: { ...draft, joining_date: e.target.value } }))} />
                        <div className="top-gap-small"><span className="subtle">Joined: {formatDate(item.joined_date)}</span></div>
                      </td>
                      <td>
                        <select className="revenue-inline-input" value={draft.status || 'will_come_for_interview'} onChange={(e) => setRowDrafts((all) => ({ ...all, [item.revenue_id]: { ...draft, status: e.target.value } }))}>
                          {statusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        <div className="top-gap-small"><ReminderPill tone={classForStage(item)}>{(draft.status || item.status || '').replaceAll('_', ' ')}</ReminderPill></div>
                      </td>
                      <td>
                        <select className="revenue-inline-input" value={draft.payout_status || 'none'} onChange={(e) => setRowDrafts((all) => ({ ...all, [item.revenue_id]: { ...draft, payout_status: e.target.value } }))}>
                          {payoutOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        <div className="top-gap-small"><ReminderPill tone={item.payout_status === 'payout_received' ? 'green' : item.payout_pending ? 'orange' : 'blue'}>{item.payout_status === 'payout_received' ? 'Payout received' : item.payout_pending ? 'Payout due' : 'No payout stage'}</ReminderPill></div>
                      </td>
                      <td className="revenue-action-col">
                        <button type="button" className="mini-btn view bounceable" onClick={() => window.open(`/candidate/${item.candidate_id}`, '_blank')}>Open</button>
                        <button type="button" className="mini-btn call bounceable" disabled={savingId === item.revenue_id} onClick={() => saveRow(item)}>{savingId === item.revenue_id ? 'Saving...' : 'Save'}</button>
                      </td>
                    </tr>
                  );
                })}
                {!items.length && <tr><td colSpan="9" className="helper-text">No Revenue Hub items matched the current filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showAdd && (
        <div className="crm-modal-backdrop" onClick={() => setShowAdd(false)}>
          <div className="crm-premium-modal revenue-add-modal" onClick={(e) => e.stopPropagation()}>
            <div className="panel-title">Add Candidate to Revenue Hub</div>
            <div className="helper-text top-gap-small">Select any already-filled candidate. Existing profile data auto-pulls here so interview movement stays consistent.</div>
            <div className="top-gap revenue-search-row">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search candidate code, name, number or process" />
              <button type="button" className="add-profile-btn bounceable" onClick={runSearch}>Search</button>
            </div>
            <div className="revenue-search-results top-gap-small">
              {searchItems.map((item) => (
                <button key={item.candidate_id} type="button" className={`revenue-search-item ${addForm.candidate_id === item.candidate_id ? 'active' : ''}`} onClick={() => pickCandidate(item)}>
                  <strong>{item.full_name}</strong>
                  <span>{item.candidate_id} • {visiblePhone(user, item.phone)}</span>
                  <span>{item.process || '-'} • {item.recruiter_code || '-'}</span>
                </button>
              ))}
              {!searchItems.length && <div className="helper-text">No candidate result. Search by code, number or process.</div>}
            </div>
            <div className="revenue-add-form-grid top-gap">
              <div className="field"><label>Candidate Code</label><input value={addForm.candidate_id} onChange={(e) => setAddForm((prev) => ({ ...prev, candidate_id: e.target.value }))} placeholder="CI0101" /></div>
              <div className="field"><label>Interview Date</label><input type="date" value={addForm.interview_date} onChange={(e) => setAddForm((prev) => ({ ...prev, interview_date: e.target.value }))} /></div>
              <div className="field"><label>Client</label><input value={addForm.client_name} onChange={(e) => setAddForm((prev) => ({ ...prev, client_name: e.target.value }))} placeholder="Client name" /></div>
              <div className="field"><label>Notes</label><input value={addForm.notes} onChange={(e) => setAddForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Optional note" /></div>
            </div>
            <div className="row-actions top-gap">
              <button type="button" className="add-profile-btn bounceable" onClick={addCandidate}>Add Candidate</button>
              <button type="button" className="ghost-btn bounceable" onClick={() => setShowAdd(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
