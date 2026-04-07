import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function splitSmartLine(line, delimiter) {
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      out.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  out.push(current);
  return out.map((item) => item.trim());
}



function uint16(view, offset) {
  return view.getUint16(offset, true);
}
function uint32(view, offset) {
  return view.getUint32(offset, true);
}
function cellRefToIndex(ref) {
  const clean = String(ref || '').replace(/\d+/g, '').toUpperCase();
  let value = 0;
  for (const ch of clean) value = value * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, value - 1);
}
async function inflateZipEntry(method, bytes) {
  if (method === 0) return bytes;
  if (method !== 8) throw new Error('Unsupported Excel compression method.');
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read .xlsx directly here. Use paste mode or CSV.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function unzipEntries(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  let eocd = -1;
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 66000); i -= 1) {
    if (uint32(view, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Invalid Excel file.');
  const cdSize = uint32(view, eocd + 12);
  const cdOffset = uint32(view, eocd + 16);
  const end = cdOffset + cdSize;
  const entries = new Map();
  let ptr = cdOffset;
  while (ptr < end) {
    if (uint32(view, ptr) !== 0x02014b50) break;
    const method = uint16(view, ptr + 10);
    const compressedSize = uint32(view, ptr + 20);
    const fileNameLength = uint16(view, ptr + 28);
    const extraLength = uint16(view, ptr + 30);
    const commentLength = uint16(view, ptr + 32);
    const localOffset = uint32(view, ptr + 42);
    const nameBytes = new Uint8Array(arrayBuffer, ptr + 46, fileNameLength);
    const name = new TextDecoder().decode(nameBytes);
    const localNameLength = uint16(view, localOffset + 26);
    const localExtraLength = uint16(view, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = new Uint8Array(arrayBuffer, dataStart, compressedSize);
    entries.set(name, { method, raw });
    ptr += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}
async function readZipText(entries, name) {
  const entry = entries.get(name);
  if (!entry) return '';
  const bytes = await inflateZipEntry(entry.method, entry.raw);
  return new TextDecoder().decode(bytes);
}
function xmlDoc(text) {
  return new DOMParser().parseFromString(text, 'application/xml');
}
function xmlText(node) {
  return Array.from(node?.childNodes || []).map((child) => child.textContent || '').join('');
}
async function parseXlsxRows(file) {
  const arrayBuffer = await file.arrayBuffer();
  const entries = await unzipEntries(arrayBuffer);
  const workbookXml = await readZipText(entries, 'xl/workbook.xml');
  const workbookRelsXml = await readZipText(entries, 'xl/_rels/workbook.xml.rels');
  if (!workbookXml || !workbookRelsXml) throw new Error('Workbook structure not found.');
  const workbook = xmlDoc(workbookXml);
  const rels = xmlDoc(workbookRelsXml);
  const firstSheet = workbook.querySelector('sheet');
  if (!firstSheet) return [];
  const relId = firstSheet.getAttribute('r:id') || firstSheet.getAttribute('id');
  const relNode = Array.from(rels.getElementsByTagName('Relationship')).find((item) => item.getAttribute('Id') === relId);
  const target = relNode?.getAttribute('Target');
  if (!target) throw new Error('Worksheet target not found.');
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  const sharedStringsXml = await readZipText(entries, 'xl/sharedStrings.xml');
  const sharedStrings = sharedStringsXml
    ? Array.from(xmlDoc(sharedStringsXml).getElementsByTagName('si')).map((si) => xmlText(si).trim())
    : [];
  const sheetXml = await readZipText(entries, sheetPath);
  const sheetDoc = xmlDoc(sheetXml);
  const rowNodes = Array.from(sheetDoc.getElementsByTagName('row'));
  const matrix = rowNodes.map((rowNode) => {
    const cells = [];
    Array.from(rowNode.getElementsByTagName('c')).forEach((cell) => {
      const ref = cell.getAttribute('r') || '';
      const idx = cellRefToIndex(ref);
      const type = cell.getAttribute('t') || '';
      const valueNode = cell.getElementsByTagName('v')[0];
      const inlineNode = cell.getElementsByTagName('is')[0];
      let value = '';
      if (type === 's') value = sharedStrings[Number(valueNode?.textContent || 0)] || '';
      else if (type === 'inlineStr') value = xmlText(inlineNode).trim();
      else value = valueNode?.textContent || xmlText(inlineNode).trim();
      cells[idx] = String(value || '').trim();
    });
    return cells;
  }).filter((row) => row.some((value) => String(value || '').trim()));
  if (matrix.length < 2) return [];
  const headers = matrix[0].map(normalizeHeader);
  return matrix.slice(1).map((values) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = values[index] || '';
    });
    return item;
  }).filter((row) => Object.values(row).some((value) => String(value || '').trim()));
}



function rowsToObjects(matrix = []) {
  if (matrix.length < 2) return [];
  const headers = matrix[0].map(normalizeHeader);
  return matrix.slice(1).map((values) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = values[index] || '';
    });
    return item;
  }).filter((row) => Object.values(row).some((value) => String(value || '').trim()));
}

function parseSpreadsheetXmlRows(text) {
  const doc = xmlDoc(text);
  const rowNodes = Array.from(doc.getElementsByTagName('Row'));
  const matrix = rowNodes.map((rowNode) => Array.from(rowNode.getElementsByTagName('Cell')).map((cell) => xmlText(cell).trim())).filter((row) => row.some(Boolean));
  return rowsToObjects(matrix);
}

function parseHtmlTableRows(text) {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return [];
  const matrix = Array.from(table.querySelectorAll('tr')).map((row) => Array.from(row.querySelectorAll('th,td')).map((cell) => String(cell.textContent || '').trim())).filter((row) => row.some(Boolean));
  return rowsToObjects(matrix);
}

function parseExcelLikeText(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  if (/<Workbook[\s>]/i.test(raw) && /urn:schemas-microsoft-com:office:spreadsheet/i.test(raw)) return parseSpreadsheetXmlRows(raw);
  if (/<table[\s>]/i.test(raw)) return parseHtmlTableRows(raw);
  return parseGridText(raw);
}

function extractResumeFields(text) {
  const raw = String(text || '').replace(/\r/g, '').trim();
  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const email = (raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [''])[0];
  const phoneMatch = raw.match(/(?:\+?91[-\s]?)?(\d{10})/);
  const phone = phoneMatch ? phoneMatch[1] : '';
  const companyLines = lines.filter((line) => /(pvt|ltd|limited|solutions|technologies|technology|services|private|corp|infotech|consult|bpo|bank|airtel|kotak|axis|samsung|razorpay)/i.test(line));
  const name = (lines.find((line) => /^[A-Za-z][A-Za-z\s.]{2,40}$/.test(line) && !/(resume|curriculum|vitae|profile|contact)/i.test(line)) || lines[0] || '').slice(0, 60);
  const address = (lines.find((line) => /(address|ghaziabad|noida|delhi|gurgaon|gurugram|kanpur|lucknow|uttar pradesh|mumbai|pune|bangalore|bengaluru)/i.test(line)) || '').slice(0, 100);
  return {
    name,
    number: phone,
    email,
    address,
    companies: companyLines.slice(0, 6).join(', '),
  };
}

function buildWhatsAppResumeMessage(fields, selectedKeys, processValue, tokenValue) {
  const lines = [];
  let sr = 1;
  if (selectedKeys.includes('name')) lines.push(`${sr++}. Name: ${fields.name || '-'}`);
  if (selectedKeys.includes('number')) lines.push(`${sr++}. Number: ${fields.number || '-'}`);
  lines.push(`${sr++}. Process: ${processValue || '-'}`);
  lines.push(`${sr++}. Token No: ${tokenValue || '-'}`);
  if (selectedKeys.includes('email')) lines.push(`${sr++}. Email: ${fields.email || '-'}`);
  if (selectedKeys.includes('address')) lines.push(`${sr++}. Address: ${fields.address || '-'}`);
  if (selectedKeys.includes('companies')) lines.push(`${sr++}. Companies: ${fields.companies || '-'}`);
  return lines.join('\n');
}

function parseGridText(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = splitSmartLine(lines[0], delimiter).map(normalizeHeader);
  return lines.slice(1).map((line) => {
    const values = splitSmartLine(line, delimiter);
    const item = {};
    headers.forEach((header, index) => {
      item[header] = values[index] || '';
    });
    return item;
  }).filter((row) => Object.values(row).some((value) => String(value || '').trim()));
}

const IMPORT_ALIASES = {
  full_name: ['full_name','name','candidate_name','candidate','applicant_name'],
  phone: ['phone','number','mobile','mobile_no','contact_number','phone_number','contact'],
  email: ['email','mail','email_id','e_mail'],
  location: ['location','current_location','city','current_city'],
  preferred_location: ['preferred_location','preferred_city','preferred_loc'],
  qualification: ['qualification','degree','education'],
  process: ['process','job_title','jd','project','campaign'],
  recruiter_code: ['recruiter_code','owner_code','recruiter id'],
  recruiter_name: ['recruiter_name','owner_name','recruiter'],
};

function firstAlias(row, aliases) {
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    const value = row?.[key];
    if (String(value || '').trim()) return String(value).trim();
  }
  return '';
}

function looksLikePhone(value) {
  return /(?:\+?91[-\s]?)?\d{10}/.test(String(value || ''));
}

function looksLikeEmail(value) {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(String(value || ''));
}

function looksLikeLocation(value) {
  return /(noida|delhi|gurgaon|gurugram|mumbai|pune|kanpur|lucknow|bangalore|bengaluru|hyderabad|jaipur|sector)/i.test(String(value || ''));
}

function normalizeImportedRow(row) {
  const source = Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [normalizeHeader(key), String(value || '').trim()]));
  const next = { ...source };
  Object.entries(IMPORT_ALIASES).forEach(([field, aliases]) => {
    const direct = firstAlias(source, aliases);
    if (direct) next[field] = direct;
  });
  if (!next.email) {
    const found = Object.values(source).find((value) => looksLikeEmail(value));
    if (found) next.email = found;
  }
  if (!next.phone) {
    const found = Object.values(source).find((value) => looksLikePhone(value));
    if (found) next.phone = found;
  }
  if (!next.location) {
    const found = Object.values(source).find((value) => looksLikeLocation(value));
    if (found) next.location = found;
  }
  if (!next.full_name) {
    const found = Object.values(source).find((value) => /^[A-Za-z][A-Za-z\s.]{2,40}$/.test(String(value || '')) && !looksLikeEmail(value) && !looksLikePhone(value) && !looksLikeLocation(value));
    if (found) next.full_name = found;
  }
  if (!next.preferred_location && next.location) next.preferred_location = next.location;
  return next;
}

export default function AdminPage() {
  const [users, setUsers] = useState([]);
  const [notesCount, setNotesCount] = useState([]);
  const [lockSettings, setLockSettings] = useState({});
  const [lockLogs, setLockLogs] = useState({ activity: [], unlocks: [] });
  const [message, setMessage] = useState('');
  const [importMode, setImportMode] = useState('paste');
  const [importText, setImportText] = useState('');
  const [importRows, setImportRows] = useState([]);
  const [importBusy, setImportBusy] = useState(false);
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [replaceRecruiterFromSheet, setReplaceRecruiterFromSheet] = useState(false);
  const [resumeText, setResumeText] = useState('');
  const [resumeFields, setResumeFields] = useState({ name: '', number: '', email: '', address: '', companies: '' });
  const [resumeSelected, setResumeSelected] = useState(['name', 'number']);
  const [resumeProcess, setResumeProcess] = useState('');
  const [resumeToken, setResumeToken] = useState('');
  const [teamAssignments, setTeamAssignments] = useState({});

  async function load() {
    const data = await api.get('/api/admin');
    setUsers(data.users || []);
    setNotesCount(data.notes_count || []);
    setLockSettings(data.lock_settings || {});
    setLockLogs(data.lock_logs || { activity: [], unlocks: [] });
    const nextAssignments = {};
    (data.users || []).forEach((u) => { if (String(u.role || '').toLowerCase() === 'recruiter') nextAssignments[u.user_id] = u.assigned_tl_user_id || ''; });
    setTeamAssignments(nextAssignments);
  }

  useEffect(() => { load(); }, []);

  const assignableUsers = useMemo(() => users.filter((user) => ['recruiter', 'tl', 'manager', 'admin'].includes(String(user.role || '').toLowerCase())), [users]);
  const tlUsers = useMemo(() => users.filter((user) => ['tl', 'team lead'].includes(String(user.role || '').toLowerCase())), [users]);
  const recruiterUsers = useMemo(() => users.filter((user) => String(user.role || '').toLowerCase() === 'recruiter'), [users]);

  async function saveLockSettings() {
    const data = await api.post('/api/admin/lock-settings', lockSettings);
    setLockSettings(data.lock_settings || {});
    setMessage('CRM lock timings updated.');
  }

  async function saveTeamAssignments() {
    const assignments = recruiterUsers.map((user) => ({ user_id: user.user_id, assigned_tl_user_id: teamAssignments[user.user_id] || '' }));
    const data = await api.post('/api/admin/team-assignments', { assignments });
    setUsers(data.users || []);
    setMessage('TL team assignments saved. Now the CRM stops casually leaking data like a broken tap.');
  }

  function buildPreview(textValue = importText) {
    const parsed = parseGridText(textValue).map(normalizeImportedRow);
    setImportRows(parsed);
    if (!parsed.length) setMessage('Valid rows were not detected in the pasted sheet.');
    else setMessage(`${parsed.length} candidate rows detected for import with smart column mapping.`);
  }

  async function onFilePicked(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setImportMode('file');
      const lowerName = String(file.name || '').toLowerCase();
      let parsed = [];
      if (lowerName.endsWith('.xlsx')) {
        parsed = (await parseXlsxRows(file)).map(normalizeImportedRow);
        setImportText('');
      } else if (lowerName.endsWith('.xls') || lowerName.endsWith('.csv') || lowerName.endsWith('.txt')) {
        const textValue = await file.text();
        setImportText(textValue);
        parsed = parseExcelLikeText(textValue).map(normalizeImportedRow);
      } else {
        throw new Error('Upload .xlsx, .xls, or CSV file.');
      }
      setImportRows(parsed);
      setMessage(parsed.length ? `${parsed.length} candidate rows loaded from file.` : 'No usable rows were detected in the selected file.');
    } catch (error) {
      setImportRows([]);
      setMessage(error.message || 'File read failed.');
    } finally {
      event.target.value = '';
    }
  }

  async function runImport() {
    if (!importRows.length) {
      setMessage('Paste or load candidate rows first.');
      return;
    }
    setImportBusy(true);
    setMessage('');
    try {
      const data = await api.post('/api/admin/import-candidates', {
        rows: importRows,
        assignee_user_id: assigneeUserId,
        replace_recruiter_from_sheet: replaceRecruiterFromSheet,
      });
      setMessage(`${data.inserted_count || 0} rows added successfully.`);
      setImportText('');
      setImportRows([]);
      await load();
    } catch (err) {
      setMessage(err.message || 'Import failed.');
    } finally {
      setImportBusy(false);
    }
  }


  async function downloadCurrentData() {
    window.open('/api/admin/export-candidates', '_blank');
  }

  async function downloadImportTemplate() {
    window.open('/api/admin/export-template', '_blank');
  }

  async function readResumeFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const textValue = await file.text();
      setResumeText(textValue);
      setResumeFields(extractResumeFields(textValue));
      setMessage('Resume text loaded. Review extracted fields before sending.');
    } catch (error) {
      setMessage(error.message || 'Resume read failed.');
    } finally {
      event.target.value = '';
    }
  }

  function runResumeExtract() {
    const fields = extractResumeFields(resumeText);
    setResumeFields(fields);
    setMessage('Resume fields extracted.');
  }

  function toggleResumeField(key) {
    setResumeSelected((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }

  function openResumeWhatsApp() {
    const msg = buildWhatsAppResumeMessage(resumeFields, resumeSelected, resumeProcess, resumeToken);
    window.open(`https://wa.me/917836095291?text=${encodeURIComponent(msg)}`, '_blank');
  }

  return (
    <Layout title="Admin Control" subtitle="System settings, recruiter controls, and structured data loading.">
      {!!message && <div className="panel top-gap-small"><div className="helper-text">{message}</div></div>}

      <div className="small-grid two top-gap">
        <div className="panel">
          <div className="panel-title">CRM Lock Settings</div>
          <div className="candidate-form-grid candidate-compact-grid">
            <div className="field"><label>Idle Lock Minutes</label><input value={lockSettings.crm_lock_idle_minutes || ''} onChange={(e) => setLockSettings({ ...lockSettings, crm_lock_idle_minutes: e.target.value })} /></div>
            <div className="field"><label>No-Call Lock Minutes</label><input value={lockSettings.crm_lock_no_call_minutes || ''} onChange={(e) => setLockSettings({ ...lockSettings, crm_lock_no_call_minutes: e.target.value })} /></div>
            <div className="field"><label>Break Limit Minutes</label><input value={lockSettings.crm_lock_break_limit_minutes || ''} onChange={(e) => setLockSettings({ ...lockSettings, crm_lock_break_limit_minutes: e.target.value })} /></div>
            <div className="field"><label>Over-Break Alert Repeat</label><input value={lockSettings.crm_lock_break_warning_minutes || ''} onChange={(e) => setLockSettings({ ...lockSettings, crm_lock_break_warning_minutes: e.target.value })} /></div>
            <div className="field"><label>Lock Reminder Minutes</label><input value={lockSettings.crm_lock_reminder_minutes || ''} onChange={(e) => setLockSettings({ ...lockSettings, crm_lock_reminder_minutes: e.target.value })} /></div>
            <div className="field"><label>Logout Nudge Time</label><input value={lockSettings.logout_nudge_time || ''} onChange={(e) => setLockSettings({ ...lockSettings, logout_nudge_time: e.target.value })} placeholder="18:30" /></div>
            <div className="field"><label>Live Refresh Seconds</label><input value={lockSettings.live_refresh_seconds || ''} onChange={(e) => setLockSettings({ ...lockSettings, live_refresh_seconds: e.target.value })} /></div>
          </div>
          <div className="row-actions top-gap"><button className="add-profile-btn bounceable" type="button" onClick={saveLockSettings}>Save Lock Settings</button><span className="helper-text">Only leadership roles can change these values.</span></div>
        </div>

        <div className="panel admin-import-panel">
          <div className="table-toolbar no-border">
            <div>
              <div className="table-title">Bulk Candidate Load</div>
              <div className="helper-text">Paste rows directly from Excel or upload an Excel .xlsx / .xls / CSV file. New rows will be inserted into Supabase through the CRM.</div>
            </div>
            <div className="toolbar-actions compact-pills">
              <button type="button" className={`choice-chip bounceable ${importMode === 'paste' ? 'active' : ''}`} onClick={() => setImportMode('paste')}>Paste Sheet</button>
              <button type="button" className={`choice-chip bounceable ${importMode === 'file' ? 'active' : ''}`} onClick={() => setImportMode('file')}>Upload Sheet</button>
              <button type="button" className="choice-chip bounceable" onClick={downloadCurrentData}>Download Data</button>
              <button type="button" className="choice-chip bounceable" onClick={downloadImportTemplate}>Blank Template</button>
            </div>
          </div>

          <div className="admin-import-grid top-gap-small">
            <label className="compact-select-shell shell-indigo">
              <span className="compact-shell-label">Default Assignee</span>
              <select className="inline-input compact-inline-input" value={assigneeUserId} onChange={(e) => setAssigneeUserId(e.target.value)}>
                <option value="">Use sheet mapping</option>
                {assignableUsers.map((user) => (
                  <option key={user.user_id} value={user.user_id}>{user.full_name} • {user.recruiter_code || user.role}</option>
                ))}
              </select>
            </label>
            <label className="compact-select-shell shell-green admin-toggle-shell">
              <span className="compact-shell-label">Recruiter Mapping</span>
              <select className="inline-input compact-inline-input" value={replaceRecruiterFromSheet ? 'force' : 'sheet'} onChange={(e) => setReplaceRecruiterFromSheet(e.target.value === 'force')}>
                <option value="sheet">Use sheet values first</option>
                <option value="force">Force selected assignee</option>
              </select>
            </label>
          </div>

          {importMode === 'paste' ? (
            <div className="top-gap-small">
              <textarea className="admin-import-textarea" rows="10" placeholder="Paste Excel rows here with headers, for example: Name, Number, Location, Process, Recruiter Code" value={importText} onChange={(e) => setImportText(e.target.value)} />
              <div className="row-actions top-gap-small"><button className="ghost-btn bounceable" type="button" onClick={() => buildPreview()}>Preview Rows</button></div>
            </div>
          ) : (
            <div className="top-gap-small admin-file-box">
              <input type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel" onChange={onFilePicked} />
              <div className="helper-text top-gap-small">Upload Sheet .xlsx or CSV. For older .xls files, save once as .xlsx and then upload.</div>
            </div>
          )}

          <div className="top-gap-small admin-preview-box">
            <div className="helper-text"><strong>{importRows.length}</strong> rows ready for import.</div>
            {importRows.length ? (
              <div className="crm-table-wrap dense-wrap top-gap-small">
                <table className="crm-table colorful-table dense-table">
                  <thead><tr>{Object.keys(importRows[0]).slice(0, 6).map((key) => <th key={key}>{key.replaceAll('_', ' ')}</th>)}</tr></thead>
                  <tbody>{importRows.slice(0, 5).map((row, index) => <tr key={`preview-${index}`}>{Object.keys(importRows[0]).slice(0, 6).map((key) => <td key={key}>{row[key] || '-'}</td>)}</tr>)}</tbody>
                </table>
              </div>
            ) : null}
            <div className="row-actions top-gap-small"><button className="add-profile-btn bounceable" type="button" disabled={!importRows.length || importBusy} onClick={runImport}>{importBusy ? 'Loading...' : 'Load into CRM'}</button></div>
          </div>
        </div>
      </div>

      <div className="small-grid two top-gap">
        <div className="panel admin-import-panel">
          <div className="table-toolbar no-border">
            <div>
              <div className="table-title">Resume Extractor & WhatsApp Convert</div>
              <div className="helper-text">Paste resume text or upload a text-readable file. Extracted details can be sent in the required serial format to 7836095291.</div>
            </div>
          </div>
          <textarea className="admin-import-textarea top-gap-small" rows="10" placeholder="Paste resume text here" value={resumeText} onChange={(e) => setResumeText(e.target.value)} />
          <div className="row-actions top-gap-small">
            <input type="file" onChange={readResumeFile} />
            <button className="ghost-btn bounceable" type="button" onClick={runResumeExtract}>Extract Details</button>
          </div>
          <div className="candidate-form-grid candidate-compact-grid top-gap-small">
            <div className="field"><label>Name</label><input value={resumeFields.name} onChange={(e) => setResumeFields({ ...resumeFields, name: e.target.value })} /></div>
            <div className="field"><label>Number</label><input value={resumeFields.number} onChange={(e) => setResumeFields({ ...resumeFields, number: e.target.value })} /></div>
            <div className="field"><label>Email</label><input value={resumeFields.email} onChange={(e) => setResumeFields({ ...resumeFields, email: e.target.value })} /></div>
            <div className="field"><label>Address</label><input value={resumeFields.address} onChange={(e) => setResumeFields({ ...resumeFields, address: e.target.value })} /></div>
            <div className="field" style={{ gridColumn: '1 / -1' }}><label>Companies</label><input value={resumeFields.companies} onChange={(e) => setResumeFields({ ...resumeFields, companies: e.target.value })} /></div>
            <div className="field"><label>Process</label><input value={resumeProcess} onChange={(e) => setResumeProcess(e.target.value)} placeholder="Process" /></div>
            <div className="field"><label>Token No</label><input value={resumeToken} onChange={(e) => setResumeToken(e.target.value)} placeholder="Token No" /></div>
          </div>
          <div className="row-actions top-gap-small" style={{ flexWrap: 'wrap' }}>
            {['name', 'number', 'email', 'address', 'companies'].map((key) => (
              <button key={key} type="button" className={`choice-chip bounceable ${resumeSelected.includes(key) ? 'active' : ''}`} onClick={() => toggleResumeField(key)}>{key}</button>
            ))}
          </div>
          <div className="row-actions top-gap-small"><button className="add-profile-btn bounceable" type="button" onClick={openResumeWhatsApp}>Convert Msg & Open WhatsApp</button></div>
        </div>

        <div className="table-panel">
          <div className="table-toolbar"><div className="table-title">TL Team Control</div><button className="add-profile-btn bounceable" type="button" onClick={saveTeamAssignments}>Save TL Teams</button></div>
          <div className="helper-text">Assign each recruiter to a TL. Recruiters only see their own data. TLs only see their mapped team. Managers see everything, because hierarchy remains humanity's favorite hobby.</div>
          <div className="crm-table-wrap top-gap-small"><table className="crm-table colorful-table"><thead><tr><th>Recruiter</th><th>Code</th><th>Assigned TL</th></tr></thead><tbody>{recruiterUsers.map((u) => <tr key={u.user_id}><td>{u.full_name}</td><td>{u.recruiter_code || '-'}</td><td><select value={teamAssignments[u.user_id] || ''} onChange={(e) => setTeamAssignments((prev) => ({ ...prev, [u.user_id]: e.target.value }))}><option value="">No TL</option>{tlUsers.map((tl) => <option key={tl.user_id} value={tl.user_id}>{tl.full_name}</option>)}</select></td></tr>)}{!recruiterUsers.length && <tr><td colSpan="3" className="helper-text">No recruiters found.</td></tr>}</tbody></table></div>
          <div className="crm-table-wrap top-gap"><table className="crm-table colorful-table"><thead><tr><th>Name</th><th>Role</th><th>Code</th><th>Assigned TL</th><th>Theme</th></tr></thead><tbody>{users.map((u) => <tr key={u.user_id}><td>{u.full_name}<br/><span className="subtle">{u.designation}</span></td><td>{u.role}</td><td>{u.recruiter_code}</td><td>{u.assigned_tl_name || '-'}</td><td>{u.theme_name}</td></tr>)}</tbody></table></div>
        </div>
      </div>

      <div className="small-grid two top-gap">
        <div className="table-panel">
          <div className="table-toolbar"><div className="table-title">Notes Audit</div></div>
          <div className="crm-table-wrap"><table className="crm-table colorful-table"><thead><tr><th>User</th><th>Public Notes</th><th>Private Notes</th></tr></thead><tbody>{notesCount.map((n) => <tr key={n.username}><td>{n.username}</td><td>{n.public_count}</td><td>{n.private_count}</td></tr>)}</tbody></table></div>
        </div>
        <div className="table-panel"><div className="table-toolbar"><div className="table-title">CRM Lock Activity Logs</div></div><div className="crm-table-wrap dense-wrap"><table className="crm-table colorful-table dense-table"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Meta</th></tr></thead><tbody>{(lockLogs.activity || []).map((row) => <tr key={row.activity_id}><td>{row.created_at}</td><td>{row.username}</td><td>{row.action_type}</td><td>{row.metadata}</td></tr>)}{!(lockLogs.activity || []).length && <tr><td colSpan="4" className="helper-text">No CRM lock logs yet.</td></tr>}</tbody></table></div></div>
      </div>

      <div className="small-grid two top-gap">
        <div className="table-panel"><div className="table-toolbar"><div className="table-title">Unlock Requests</div></div><div className="crm-table-wrap dense-wrap"><table className="crm-table colorful-table dense-table"><thead><tr><th>Requested At</th><th>User</th><th>Status</th><th>Reason</th></tr></thead><tbody>{(lockLogs.unlocks || []).map((row) => <tr key={row.request_id}><td>{row.requested_at}</td><td>{row.user_id}</td><td>{row.status}</td><td>{row.reason}</td></tr>)}{!(lockLogs.unlocks || []).length && <tr><td colSpan="4" className="helper-text">No unlock requests yet.</td></tr>}</tbody></table></div></div>
      </div>
    </Layout>
  );
}
