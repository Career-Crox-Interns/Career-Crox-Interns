import React, { useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { candidatePayloadFromPreview, downloadCsv } from '../lib/importExtractors';

function fileToPayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name,
      mime_type: file.type || 'application/octet-stream',
      size_bytes: file.size || 0,
      content_base64: String(reader.result || ''),
    });
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function ReviewPills({ rows = [], target = 'candidate' }) {
  const selected = rows.filter((row) => row.include).length;
  const lowConfidence = rows.filter((row) => Number(row.confidence || 0) < 60).length;
  const missing = target === 'candidate'
    ? rows.filter((row) => (row.missing || []).length).length
    : rows.filter((row) => !row.client_name && !row.contact_phone && !row.contact_email).length;
  return (
    <div className="toolbar-actions compact-pills">
      <span className="top-pill active">Parsed {rows.length}</span>
      <span className="top-pill">Selected {selected}</span>
      <span className="top-pill">Need review {missing}</span>
      <span className="top-pill">Low confidence {lowConfidence}</span>
    </div>
  );
}

export default function DataExtractorPage() {
  const { user } = useAuth();
  const managerOnly = ['manager', 'admin'].includes(String(user?.role || '').toLowerCase());
  const [target, setTarget] = useState('candidate');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('');
  const [defaultProcess, setDefaultProcess] = useState('');
  const [rawText, setRawText] = useState('');
  const [publicUrl, setPublicUrl] = useState('');
  const [mode, setMode] = useState('files');
  const [saving, setSaving] = useState(false);

  const title = useMemo(() => target === 'candidate' ? 'Bulk Resume Import' : 'Client Data Extractor', [target]);

  async function parseFiles(fileList) {
    const files = Array.from(fileList || []).slice(0, 30);
    if (!files.length) return;
    setBusy(true);
    setMessage('');
    try {
      const payload = await Promise.all(files.map(fileToPayload));
      const result = await api.post('/api/extractor/parse-files', { target, files: payload }, { timeoutMs: 120000, retries: 1 });
      setRows(result.items || []);
      setMessage(`${result.count || 0} file${(result.count || 0) === 1 ? '' : 's'} parsed. Engine: ${result.engine || 'default'}. Review before database save.`);
    } catch (error) {
      setMessage(error.message || 'Could not parse files.');
    } finally {
      setBusy(false);
    }
  }

  async function parseRawText() {
    if (!rawText.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      if (target === 'client') {
        const result = await api.post('/api/client-pipeline/parse-raw', { raw_text: rawText, source_label: 'manager-raw-text' }, { timeoutMs: 30000 });
        setRows((result.items || []).map((item, index) => ({ ...item, include: true, row_key: `${Date.now()}-${index}`, confidence: 70 })));
      } else {
        const encoded = window.btoa(unescape(encodeURIComponent(rawText)));
        const result = await api.post('/api/extractor/parse-files', { target, files: [{ name: 'pasted-text.txt', mime_type: 'text/plain', content_base64: `data:text/plain;base64,${encoded}` }] }, { timeoutMs: 30000 });
        setRows(result.items || []);
      }
      setMessage('Raw text parsed. Review and save only the clean rows.');
    } catch (error) {
      setMessage(error.message || 'Raw text parse failed.');
    } finally {
      setBusy(false);
    }
  }

  async function parsePublicUrl() {
    if (!publicUrl.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await api.post('/api/client-pipeline/extract-url', { url: publicUrl.trim() }, { timeoutMs: 30000 });
      setRows((result.items || []).map((item, index) => ({ ...item, include: true, row_key: `${Date.now()}-${index}`, confidence: 72, _source: result.page?.title || publicUrl.trim() })));
      setMessage('Public page parsed. Review the rows before importing to client pipeline.');
    } catch (error) {
      setMessage(error.message || 'URL extraction failed.');
    } finally {
      setBusy(false);
    }
  }

  function patchRow(rowKey, patch) {
    setRows((current) => current.map((row) => (row.row_key === rowKey ? { ...row, ...patch } : row)));
  }

  function toggleRow(rowKey) {
    setRows((current) => current.map((row) => (row.row_key === rowKey ? { ...row, include: !row.include } : row)));
  }

  async function saveSelected() {
    const selected = rows.filter((row) => row.include);
    if (!selected.length) {
      setMessage('Select at least one row first.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      if (target === 'candidate') {
        const payload = selected.map((row) => candidatePayloadFromPreview({ ...row, process: row.process || defaultProcess }, defaultProcess));
        const result = await api.post('/api/candidates/bulk-create', { items: payload }, { timeoutMs: 60000, retries: 1 });
        setMessage(`${result.count || result.items?.length || 0} candidate profile${(result.count || result.items?.length || 0) === 1 ? '' : 's'} added to database.`);
      } else {
        const result = await api.post('/api/client-pipeline/import-parsed', { items: selected }, { timeoutMs: 45000, retries: 1 });
        setMessage(`${result.count || result.items?.length || 0} client row${(result.count || result.items?.length || 0) === 1 ? '' : 's'} added to pipeline.`);
      }
    } catch (error) {
      setMessage(error.message || 'Database save failed.');
    } finally {
      setSaving(false);
    }
  }

  if (!managerOnly) {
    return (
      <Layout title="Data Extractor" subtitle="Manager only control area for raw imports and resume parsing.">
        <div className="panel top-gap"><div className="panel-title">Restricted</div><div className="helper-text">Only manager or admin can use the data extractor slice.</div></div>
      </Layout>
    );
  }

  return (
    <Layout title="Data Extractor" subtitle="Upload resumes, raw documents, public URLs and clean imported data before it hits your CRM.">
      <style>{`
        .dx-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between}
        .dx-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px}
        .dx-card{border:1px solid rgba(95,124,210,.16);border-radius:24px;background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(245,249,255,.95));box-shadow:0 14px 32px rgba(37,62,117,.08);padding:16px}
        .dx-card h4{margin:0 0 8px;color:#18356f;font-size:16px}
        .dx-filebox{border:1px dashed rgba(94,123,210,.34);border-radius:24px;padding:18px;background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(245,249,255,.94))}
        .dx-hidden{display:none}
        .dx-mini-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
        .dx-mini-grid .field.full{grid-column:1 / -1}
        .dx-segment{display:flex;gap:8px;flex-wrap:wrap}
        .dx-segment button{border:none}
        .dx-source-meta{font-size:11px;color:#6b7ea4;line-height:1.55}
        .dx-confidence{font-size:12px;font-weight:800;color:#1f5a98}
        .dx-row-head{display:flex;gap:10px;justify-content:space-between;align-items:flex-start;margin-bottom:10px}
        @media (max-width:900px){.dx-mini-grid{grid-template-columns:1fr}}
      `}</style>

      <div className="table-panel top-gap-small glassy-card fade-up">
        <div className="table-toolbar dx-toolbar">
          <div>
            <div className="table-title">Manager Data Extractor</div>
            <div className="helper-text">Separate slice for the messy import work. Quick Add and Client Pipeline stay cleaner this way.</div>
          </div>
          <div className="toolbar-actions compact-pills">
            <button type="button" className={`top-pill bounceable ${target === 'candidate' ? 'active' : ''}`} onClick={() => { setTarget('candidate'); setRows([]); setMode('files'); setMessage(''); }}>Candidate Resumes</button>
            <button type="button" className={`top-pill bounceable ${target === 'client' ? 'active' : ''}`} onClick={() => { setTarget('client'); setRows([]); setMode('files'); setMessage(''); }}>Client / Lead Data</button>
          </div>
        </div>
      </div>

      <div className="panel top-gap">
        <div className="panel-title">{title}</div>
        <div className="dx-segment top-gap-small">
          <button type="button" className={`top-pill bounceable ${mode === 'files' ? 'active' : ''}`} onClick={() => setMode('files')}>Upload Files</button>
          <button type="button" className={`top-pill bounceable ${mode === 'raw' ? 'active' : ''}`} onClick={() => setMode('raw')}>Paste Raw Text</button>
          {target === 'client' ? <button type="button" className={`top-pill bounceable ${mode === 'url' ? 'active' : ''}`} onClick={() => setMode('url')}>Public URL</button> : null}
        </div>

        {target === 'candidate' ? <div className="helper-text top-gap-small">Upload up to 30 resumes at once. PDF, DOC, DOCX, TXT, HTML and image-like files are accepted in JS-only mode. The first clean phone becomes the main CRM number. Extra numbers and LinkedIn move to notes.</div> : <div className="helper-text top-gap-small">Drop client screenshots, posters, notes, PDFs, public page text or raw copied data. Review first, then add only the good rows to pipeline.</div>}

        {target === 'candidate' ? (
          <div className="field top-gap-small" style={{ maxWidth: 260 }}>
            <label>Default Process</label>
            <input value={defaultProcess} onChange={(e) => setDefaultProcess(e.target.value)} placeholder="Optional default process" />
          </div>
        ) : null}

        {mode === 'files' ? (
          <div className="dx-filebox top-gap-small">
            <strong>{target === 'candidate' ? 'Upload resumes or candidate files' : 'Upload files for client / lead extraction'}</strong>
            <div className="helper-text top-gap-small">Accepted: PDF, DOC, DOCX, TXT, HTML and image files. JS-only extractor will pull whatever readable text it finds, then you review before save.</div>
            <div className="toolbar-actions compact-pills top-gap-small">
              <label htmlFor="dx-files" className="add-profile-btn bounceable" style={{ cursor: 'pointer' }}>{busy ? 'Parsing...' : 'Choose Files'}</label>
              <input id="dx-files" className="dx-hidden" type="file" accept=".pdf,.doc,.docx,.txt,.csv,.html,.htm,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff" multiple onChange={(e) => { parseFiles(e.target.files); e.target.value = ''; }} />
              {rows.length ? <button type="button" className="top-pill bounceable" onClick={() => downloadCsv(`${target}-extractor-review-${new Date().toISOString().slice(0, 10)}.csv`, rows)}>Download Review CSV</button> : null}
            </div>
          </div>
        ) : null}

        {mode === 'raw' ? (
          <div className="field top-gap-small">
            <label>Paste raw text</label>
            <textarea rows="8" value={rawText} onChange={(e) => setRawText(e.target.value)} placeholder={target === 'candidate' ? 'Paste one resume or copied profile text here' : 'Paste messy client lead data, comments, contact blocks or copied public text here'} />
            <div className="row-actions top-gap-small"><button type="button" className="add-profile-btn bounceable" disabled={busy || !rawText.trim()} onClick={parseRawText}>{busy ? 'Parsing...' : 'Parse Raw Text'}</button></div>
          </div>
        ) : null}

        {mode === 'url' ? (
          <div className="field top-gap-small">
            <label>Public URL</label>
            <input value={publicUrl} onChange={(e) => setPublicUrl(e.target.value)} placeholder="https://public-page.example.com" />
            <div className="row-actions top-gap-small"><button type="button" className="add-profile-btn bounceable" disabled={busy || !publicUrl.trim()} onClick={parsePublicUrl}>{busy ? 'Extracting...' : 'Extract Public Page'}</button></div>
          </div>
        ) : null}

        {message ? <div className="helper-text top-gap-small">{message}</div> : null}
      </div>

      {rows.length ? (
        <div className="panel top-gap">
          <div className="table-toolbar dx-toolbar">
            <div className="panel-title">Review Extracted Rows</div>
            <ReviewPills rows={rows} target={target} />
          </div>
          <div className="row-actions top-gap-small"><button type="button" className="add-profile-btn bounceable" disabled={saving} onClick={saveSelected}>{saving ? 'Saving...' : target === 'candidate' ? 'Add Selected To Candidates' : 'Add Selected To Client Pipeline'}</button></div>
          <div className="dx-grid top-gap-small">
            {rows.map((row) => (
              <div className="dx-card" key={row.row_key}>
                <div className="dx-row-head">
                  <div>
                    <h4>{row.source_filename || row.client_name || row.full_name || 'Parsed Row'}</h4>
                    <div className="dx-source-meta">{target === 'candidate' ? 'Candidate import preview' : 'Client lead preview'}</div>
                  </div>
                  <label className="qa-include"><input type="checkbox" checked={!!row.include} onChange={() => toggleRow(row.row_key)} /> Include</label>
                </div>
                <div className="dx-confidence">Confidence: {row.confidence || 0}%</div>
                {target === 'candidate' && row.missing?.length ? <div className="toolbar-actions compact-pills top-gap-small">{row.missing.map((item) => <span key={item} className="top-pill">{item} missing</span>)}</div> : null}
                <div className="dx-mini-grid top-gap-small">
                  {target === 'candidate' ? (
                    <>
                      <div className="field"><label>Name</label><input value={row.full_name || ''} onChange={(e) => patchRow(row.row_key, { full_name: e.target.value, missing: (row.missing || []).filter((item) => item !== 'Name') })} /></div>
                      <div className="field"><label>Primary Number</label><input value={row.phone || ''} onChange={(e) => patchRow(row.row_key, { phone: e.target.value, missing: (row.missing || []).filter((item) => item !== 'Primary Number') })} /></div>
                      <div className="field"><label>Email</label><input value={row.email || ''} onChange={(e) => patchRow(row.row_key, { email: e.target.value, missing: (row.missing || []).filter((item) => item !== 'Email') })} /></div>
                      <div className="field"><label>Location</label><input value={row.location || ''} onChange={(e) => patchRow(row.row_key, { location: e.target.value })} /></div>
                      <div className="field"><label>Qualification</label><input value={row.qualification || ''} onChange={(e) => patchRow(row.row_key, { qualification: e.target.value })} /></div>
                      <div className="field"><label>Process</label><input value={row.process || ''} onChange={(e) => patchRow(row.row_key, { process: e.target.value })} /></div>
                      <div className="field"><label>Total Experience</label><input value={row.total_experience || ''} onChange={(e) => patchRow(row.row_key, { total_experience: e.target.value, relevant_experience: row.relevant_experience || e.target.value })} /></div>
                      <div className="field"><label>Relevant Experience</label><input value={row.relevant_experience || ''} onChange={(e) => patchRow(row.row_key, { relevant_experience: e.target.value })} /></div>
                      <div className="field full"><label>Notes</label><textarea rows="6" value={row.notes || ''} onChange={(e) => patchRow(row.row_key, { notes: e.target.value })} /></div>
                    </>
                  ) : (
                    <>
                      <div className="field"><label>Client Name</label><input value={row.client_name || ''} onChange={(e) => patchRow(row.row_key, { client_name: e.target.value })} /></div>
                      <div className="field"><label>Contact Person</label><input value={row.contact_person || ''} onChange={(e) => patchRow(row.row_key, { contact_person: e.target.value })} /></div>
                      <div className="field"><label>Phone</label><input value={row.contact_phone || ''} onChange={(e) => patchRow(row.row_key, { contact_phone: e.target.value })} /></div>
                      <div className="field"><label>Email</label><input value={row.contact_email || ''} onChange={(e) => patchRow(row.row_key, { contact_email: e.target.value })} /></div>
                      <div className="field"><label>City</label><input value={row.city || ''} onChange={(e) => patchRow(row.row_key, { city: e.target.value })} /></div>
                      <div className="field"><label>Priority</label><select value={row.priority || 'Medium'} onChange={(e) => patchRow(row.row_key, { priority: e.target.value })}><option>Low</option><option>Medium</option><option>High</option></select></div>
                      <div className="field full"><label>Notes</label><textarea rows="6" value={row.notes || ''} onChange={(e) => patchRow(row.row_key, { notes: e.target.value })} /></div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Layout>
  );
}
