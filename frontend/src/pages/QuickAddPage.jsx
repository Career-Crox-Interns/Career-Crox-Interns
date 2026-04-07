import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { candidatePayloadFromPreview, downloadCsv, extractCandidateFields, readResumeFileText } from '../lib/importExtractors';

const sections = [
  { key: 'candidate', label: 'Add Candidate' },
  { key: 'task', label: 'Add Task' },
  { key: 'note', label: 'Add Note' },
  { key: 'interview', label: 'Add Interview' },
  { key: 'jd', label: 'Add JD' },
];

const candidateInitial = { full_name: '', phone: '', location: '', qualification: '', process: '', status: 'In - Progress', notes: '' };
const taskInitial = { title: '', description: '', assigned_to_user_id: '', priority: 'Normal', due_date: '' };
const noteInitial = { candidate_id: '', body: '', note_type: 'public' };
const interviewInitial = { candidate_id: '', jd_id: '', stage: 'Screening', scheduled_at: '' };
const jdInitial = { job_title: '', company: '', location: '', experience: '', salary: '' };

function MissingList({ items = [] }) {
  if (!items.length) return <span className="helper-text">Ready to import</span>;
  return <div className="toolbar-actions compact-pills">{items.map((item) => <span key={item} className="top-pill">{item} missing</span>)}</div>;
}

export default function QuickAddPage() {
  const { kind = 'candidate' } = useParams();
  const navigate = useNavigate();
  const [lookups, setLookups] = useState({ users: [], candidates: [], jds: [], process_options: [] });
  const [candidateForm, setCandidateForm] = useState(candidateInitial);
  const [candidateMode, setCandidateMode] = useState('single');
  const [bulkRows, setBulkRows] = useState([]);
  const [bulkProcess, setBulkProcess] = useState('');
  const [parsing, setParsing] = useState(false);
  const [bulkCreating, setBulkCreating] = useState(false);
  const [taskForm, setTaskForm] = useState(taskInitial);
  const [noteForm, setNoteForm] = useState(noteInitial);
  const [interviewForm, setInterviewForm] = useState(interviewInitial);
  const [jdForm, setJdForm] = useState(jdInitial);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.get('/api/ui/lookups').then(setLookups).catch(() => {}); }, []);
  const current = useMemo(() => sections.find((s) => s.key === kind) || sections[0], [kind]);

  async function submitCandidate(e) {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const data = await api.post('/api/candidates', candidateForm);
      setCandidateForm(candidateInitial);
      setMessage(`Candidate created: ${data.item.candidate_id}`);
      navigate(`/candidate/${data.item.candidate_id}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleResumeFiles(fileList) {
    const files = Array.from(fileList || []).slice(0, 30);
    if (!files.length) return;
    setParsing(true);
    setMessage('');
    try {
      const nextRows = [];
      for (const file of files) {
        const text = await readResumeFileText(file);
        const extracted = extractCandidateFields(text, file.name);
        nextRows.push({ ...extracted, process: bulkProcess || extracted.process || '', row_key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}` });
      }
      setBulkRows(nextRows);
      setCandidateMode('bulk-files');
      setMessage(`${nextRows.length} resume${nextRows.length > 1 ? 's' : ''} parsed. Review missing fields, then add to database.`);
    } catch (error) {
      setMessage(error.message || 'Unable to read resume files.');
    } finally {
      setParsing(false);
    }
  }

  function patchBulkRow(rowKey, patch) {
    setBulkRows((currentRows) => currentRows.map((row) => (row.row_key === rowKey ? { ...row, ...patch } : row)));
  }

  function toggleBulkRow(rowKey) {
    setBulkRows((currentRows) => currentRows.map((row) => (row.row_key === rowKey ? { ...row, include: !row.include } : row)));
  }

  async function createBulkCandidates() {
    const selected = bulkRows.filter((row) => row.include);
    if (!selected.length) {
      setMessage('Select at least one parsed row to create candidate profiles.');
      return;
    }
    setBulkCreating(true);
    setMessage('');
    try {
      const payload = selected.map((row) => candidatePayloadFromPreview({ ...row, process: row.process || bulkProcess }, bulkProcess));
      const data = await api.post('/api/candidates/bulk-create', { items: payload }, { timeoutMs: 45000, retries: 1 });
      setMessage(`${data.count || data.items?.length || 0} candidate profiles created from resumes.`);
      if (data.items?.[0]?.candidate_id) navigate(`/candidate/${data.items[0].candidate_id}`);
    } catch (error) {
      setMessage(error.message || 'Bulk create failed.');
    } finally {
      setBulkCreating(false);
    }
  }

  async function submitTask(e) {
    e.preventDefault();
    setSaving(true); setMessage('');
    try {
      const data = await api.post('/api/tasks', taskForm);
      setTaskForm(taskInitial);
      setMessage(`Task created: ${data.item.task_id}`);
      navigate('/tasks');
    } finally { setSaving(false); }
  }
  async function submitNote(e) {
    e.preventDefault();
    setSaving(true); setMessage('');
    try {
      const data = await api.post('/api/notes', noteForm);
      setNoteForm(noteInitial);
      setMessage('Note added successfully.');
      navigate(`/candidate/${data.item.candidate_id}`);
    } finally { setSaving(false); }
  }
  async function submitInterview(e) {
    e.preventDefault();
    setSaving(true); setMessage('');
    try {
      await api.post('/api/interviews', interviewForm);
      setInterviewForm(interviewInitial);
      setMessage('Interview created successfully.');
      navigate('/interviews');
    } finally { setSaving(false); }
  }
  async function submitJd(e) {
    e.preventDefault();
    setSaving(true); setMessage('');
    try {
      await api.post('/api/jds', jdForm);
      setJdForm(jdInitial);
      setMessage('JD created successfully.');
      navigate('/jds');
    } finally { setSaving(false); }
  }

  const userOptions = lookups.users || [];
  const candidateOptions = lookups.candidates || [];
  const jdOptions = lookups.jds || [];
  const processOptions = lookups.process_options || [];
  const bulkMissingCount = bulkRows.filter((row) => row.include && row.missing?.length).length;

  return (
    <Layout title={`Quick Add • ${current.label}`} subtitle="Open key actions from anywhere and save directly into the workflow.">
      <style>{`
        .qa-mode-row{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0 10px}
        .qa-note{font-size:12px;color:#637395;line-height:1.6}
        .qa-dropzone{border:1px dashed rgba(91,122,208,.34);border-radius:24px;padding:18px;background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(244,248,255,.96));display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap}
        .qa-dropzone strong{display:block;color:#18356f;font-size:18px}
        .qa-dropzone small{display:block;margin-top:6px;color:#607091;line-height:1.5}
        .qa-hidden-input{display:none}
        .qa-file-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-top:18px}
        .qa-file-card{border:1px solid rgba(98,131,218,.16);border-radius:24px;background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(246,250,255,.94));box-shadow:0 12px 26px rgba(44,72,137,.08);padding:16px}
        .qa-file-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:12px}
        .qa-file-name{font-size:15px;font-weight:900;color:#18356f}
        .qa-include{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:800;color:#35539c}
        .qa-mini-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
        .qa-mini-grid .field textarea{min-height:84px}
        .qa-mini-grid .field.full{grid-column:1/-1}
        .qa-bulk-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:16px}
        .qa-summary{display:flex;gap:10px;flex-wrap:wrap}
        .qa-summary .top-pill{cursor:default}
      `}</style>

      <div className="table-panel top-gap-small glassy-card fade-up">
        <div className="table-toolbar">
          <div className="table-title">Quick Add Hub</div>
          <div className="toolbar-actions compact-pills">
            {sections.map((section) => (
              <button key={section.key} type="button" className={`top-pill bounceable ${section.key === kind ? 'active' : ''}`} onClick={() => navigate(`/quick-add/${section.key}`)}>{section.label}</button>
            ))}
          </div>
        </div>
      </div>
      {kind === 'candidate' && (
        <div className="panel top-gap">
          <div className="panel-title">Quick Add Candidate</div>
          <div className="qa-mode-row">
            <button type="button" className={`top-pill bounceable ${candidateMode === 'single' ? 'active' : ''}`} onClick={() => setCandidateMode('single')}>Single Candidate</button>
          </div>

          {candidateMode === 'single' && (
            <form className="stack-form" onSubmit={submitCandidate}>
              <div className="candidate-form-grid candidate-compact-grid">
                <div className="field"><label>Full Name</label><input value={candidateForm.full_name} onChange={(e) => setCandidateForm({ ...candidateForm, full_name: e.target.value })} required /></div>
                <div className="field"><label>Phone</label><input value={candidateForm.phone} onChange={(e) => setCandidateForm({ ...candidateForm, phone: e.target.value })} required /></div>
                <div className="field"><label>Location</label><input value={candidateForm.location} onChange={(e) => setCandidateForm({ ...candidateForm, location: e.target.value })} required /></div>
                <div className="field"><label>Qualification</label><input value={candidateForm.qualification} onChange={(e) => setCandidateForm({ ...candidateForm, qualification: e.target.value })} required /></div>
                <div className="field"><label>Process</label><input list="quick-process-list" value={candidateForm.process} onChange={(e) => setCandidateForm({ ...candidateForm, process: e.target.value })} /><datalist id="quick-process-list">{processOptions.map((option) => <option key={option} value={option} />)}</datalist></div>
                <div className="field"><label>Status</label><select value={candidateForm.status} onChange={(e) => setCandidateForm({ ...candidateForm, status: e.target.value })}><option>In - Progress</option><option>Follow Up</option><option>Submitted</option><option>Needs Update</option></select></div>
              </div>
              <div className="field"><label>Starter Note</label><textarea rows="4" value={candidateForm.notes} onChange={(e) => setCandidateForm({ ...candidateForm, notes: e.target.value })} /></div>
              <div className="row-actions top-gap"><button className="add-profile-btn bounceable" disabled={saving} type="submit">Create Candidate</button></div>
            </form>
          )}

          <div className="helper-text top-gap-small">Bulk resume parsing now lives in the separate <strong>Data Extractor</strong> slice for manager control and cleaner review.</div>
        </div>
      )}
      {kind === 'task' && (
        <div className="panel top-gap"><div className="panel-title">Quick Add Task</div><form className="stack-form" onSubmit={submitTask}><div className="candidate-form-grid candidate-compact-grid"><div className="field"><label>Task Title</label><input value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} required /></div><div className="field"><label>Assign To</label><select value={taskForm.assigned_to_user_id} onChange={(e) => setTaskForm({ ...taskForm, assigned_to_user_id: e.target.value })} required><option value="">Select team member</option>{userOptions.map((user) => <option key={user.user_id} value={user.user_id}>{user.full_name} • {user.designation}</option>)}</select></div><div className="field"><label>Priority</label><select value={taskForm.priority} onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}><option>Low</option><option>Normal</option><option>High</option><option>Critical</option></select></div><div className="field"><label>Due Date</label><input type="date" value={taskForm.due_date} onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })} /></div></div><div className="field"><label>Description</label><textarea rows="4" value={taskForm.description} onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })} /></div><div className="row-actions top-gap"><button className="add-profile-btn bounceable" disabled={saving} type="submit">Create Task</button></div></form></div>
      )}
      {kind === 'note' && (
        <div className="panel top-gap"><div className="panel-title">Quick Add Note</div><form className="stack-form" onSubmit={submitNote}><div className="candidate-form-grid candidate-compact-grid"><div className="field"><label>Candidate</label><select value={noteForm.candidate_id} onChange={(e) => setNoteForm({ ...noteForm, candidate_id: e.target.value })} required><option value="">Select candidate</option>{candidateOptions.map((candidate) => <option key={candidate.candidate_id} value={candidate.candidate_id}>{candidate.full_name} • {candidate.candidate_id}</option>)}</select></div><div className="field"><label>Note Type</label><select value={noteForm.note_type} onChange={(e) => setNoteForm({ ...noteForm, note_type: e.target.value })}><option value="public">Public</option><option value="internal">Internal</option><option value="follow_up">Follow Up</option></select></div></div><div className="field"><label>Note</label><textarea rows="5" value={noteForm.body} onChange={(e) => setNoteForm({ ...noteForm, body: e.target.value })} required /></div><div className="row-actions top-gap"><button className="add-profile-btn bounceable" disabled={saving} type="submit">Add Note</button></div></form></div>
      )}
      {kind === 'interview' && (
        <div className="panel top-gap"><div className="panel-title">Quick Add Interview</div><form className="stack-form" onSubmit={submitInterview}><div className="candidate-form-grid candidate-compact-grid"><div className="field"><label>Candidate</label><select value={interviewForm.candidate_id} onChange={(e) => setInterviewForm({ ...interviewForm, candidate_id: e.target.value })} required><option value="">Select candidate</option>{candidateOptions.map((candidate) => <option key={candidate.candidate_id} value={candidate.candidate_id}>{candidate.full_name} • {candidate.candidate_id}</option>)}</select></div><div className="field"><label>JD</label><select value={interviewForm.jd_id} onChange={(e) => setInterviewForm({ ...interviewForm, jd_id: e.target.value })}><option value="">Select JD</option>{jdOptions.map((jd) => <option key={jd.jd_id} value={jd.jd_id}>{jd.job_title} • {jd.company}</option>)}</select></div><div className="field"><label>Stage</label><select value={interviewForm.stage} onChange={(e) => setInterviewForm({ ...interviewForm, stage: e.target.value })}><option>Screening</option><option>HR</option><option>Ops</option><option>Final</option></select></div><div className="field"><label>Scheduled At</label><input type="datetime-local" value={interviewForm.scheduled_at} onChange={(e) => setInterviewForm({ ...interviewForm, scheduled_at: e.target.value })} required /></div></div><div className="row-actions top-gap"><button className="add-profile-btn bounceable" disabled={saving} type="submit">Create Interview</button></div></form></div>
      )}
      {kind === 'jd' && (
        <div className="panel top-gap"><div className="panel-title">Quick Add JD</div><form className="stack-form" onSubmit={submitJd}><div className="candidate-form-grid candidate-compact-grid"><div className="field"><label>Job Title</label><input value={jdForm.job_title} onChange={(e) => setJdForm({ ...jdForm, job_title: e.target.value })} required /></div><div className="field"><label>Company</label><input value={jdForm.company} onChange={(e) => setJdForm({ ...jdForm, company: e.target.value })} required /></div><div className="field"><label>Location</label><input value={jdForm.location} onChange={(e) => setJdForm({ ...jdForm, location: e.target.value })} /></div><div className="field"><label>Experience</label><input value={jdForm.experience} onChange={(e) => setJdForm({ ...jdForm, experience: e.target.value })} /></div><div className="field"><label>Salary</label><input value={jdForm.salary} onChange={(e) => setJdForm({ ...jdForm, salary: e.target.value })} /></div></div><div className="row-actions top-gap"><button className="add-profile-btn bounceable" disabled={saving} type="submit">Create JD</button></div></form></div>
      )}
      {!!message && <div className="panel top-gap"><div className="helper-text">{message}</div></div>}
    </Layout>
  );
}
