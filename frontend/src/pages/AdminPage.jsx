import React, { useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { openManagerProtectedExport } from '../lib/exportAuth';

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function formatAppearanceLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  return raw.split(/[-_]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
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
  const sheetNodes = Array.from(workbook.querySelectorAll('sheet'));
  const preferredSheet = sheetNodes.find((item) => /candidate\s*data/i.test(item.getAttribute('name') || '')) || sheetNodes[0];
  if (!preferredSheet) return [];
  const relId = preferredSheet.getAttribute('r:id') || preferredSheet.getAttribute('id');
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
  const worksheets = Array.from(doc.getElementsByTagName('Worksheet'));
  const preferred = worksheets.find((sheet) => /candidate\s*data/i.test(sheet.getAttribute('ss:Name') || sheet.getAttribute('Name') || '')) || worksheets[0];
  if (!preferred) return [];
  const table = preferred.getElementsByTagName('Table')[0] || preferred;
  const rowNodes = Array.from(table.getElementsByTagName('Row'));
  const matrix = rowNodes.map((rowNode) => {
    const cells = [];
    let cursor = 0;
    Array.from(rowNode.getElementsByTagName('Cell')).forEach((cell) => {
      const indexAttr = cell.getAttribute('ss:Index') || cell.getAttribute('Index');
      if (indexAttr) cursor = Math.max(0, Number(indexAttr) - 1);
      cells[cursor] = xmlText(cell).trim();
      cursor += 1;
    });
    return cells;
  }).filter((row) => row.some(Boolean));
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

const HOT_LEADS_IMPORT_TEMPLATE_COLUMNS = [
  'full_name',
  'number',
  'location',
  'qualification',
  'preferred_location',
  'qualification_level',
  'total_experience',
  'relevant_experience',
  'ctc_monthly',
  'in_hand_salary',
  'communication_skill',
  'interview_date',
  'notes',
  'jd_notes',
  'profile_status',
  'jd_name',
  'employee_code',
  'employee_no',
  'employee_name',
  'employee_file_url',
  'employee_row_no',
  'last_updated_at',
];

const IMPORT_ALIASES = {
  full_name: ['full_name','name','candidate_name','candidate','applicant_name'],
  phone: ['phone','number','mobile','mobile_no','contact_number','phone_number','contact'],
  email: ['email','mail','email_id','e_mail'],
  location: ['location','current_location','city','current_city'],
  preferred_location: ['preferred_location','preferred_city','preferred_loc'],
  qualification: ['qualification','degree','education'],
  process: ['process','job_title','jd','project','campaign'],
  recruiter_code: ['recruiter_code','owner_code','recruiter id','employee_code','employee code','employee_no','employee no','employee_id','employee id'],
  employee_code: ['employee_code','employee code','employee_no','employee no','employee_id','employee id','recruiter_code','owner_code'],
  recruiter_name: ['recruiter_name','owner_name','recruiter'],
  total_experience: ['total_experience','total_exp','experience','experience_months'],
  relevant_experience: ['relevant_experience','relevant_exp','relevant_experience_months'],
  ctc_monthly: ['ctc_monthly','monthly_ctc','monthly_ctc_salary','monthly_ctc_inr'],
  in_hand_salary: ['in_hand_salary','inhand_salary','monthly_inhand_salary','monthly_in_hand_salary','in_hand_monthly_salary','inhand_monthly_salary','take_home_salary'],
  communication_skill: ['communication_skill','communication','english','communication_level'],
  interview_date: ['interview_date','interview_reschedule_date'],
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

function looksLikeCandidateId(value) {
  return /^C\d{2,}$/i.test(String(value || '').trim());
}

function looksLikeQualification(value) {
  return /(graduate|undergraduate|bachelor|master|diploma|b\.?tech|m\.?tech|bca|mca|bba|ba|bsc|b\.?sc|bcom|b\.?com|12th|10th|mba)/i.test(String(value || '').trim());
}

function normalizeImportedRow(row) {
  const source = Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [normalizeHeader(key), String(value || '').trim()]));
  const next = { ...source };
  Object.entries(IMPORT_ALIASES).forEach(([field, aliases]) => {
    const direct = firstAlias(source, aliases);
    if (direct) next[field] = direct;
  });

  const importedId = firstAlias(source, ['candidate_id']);
  const importedName = firstAlias(source, ['full_name', 'name', 'candidate_name']);
  const importedPhone = firstAlias(source, ['phone', 'number', 'mobile', 'contact_number', 'phone_number']);
  const importedLocation = firstAlias(source, ['location', 'current_location']);
  const importedQualification = firstAlias(source, ['qualification', 'qualification_level', 'degree']);

  const legacyLeftShiftDetected = importedId
    && !looksLikeCandidateId(importedId)
    && (!importedName || looksLikePhone(importedName))
    && (!importedPhone || looksLikeLocation(importedPhone) || looksLikeQualification(importedPhone))
    && (!importedLocation || looksLikeQualification(importedLocation));

  if (legacyLeftShiftDetected) {
    next.full_name = importedId;
    next.phone = importedName || '';
    next.location = importedPhone || '';
    next.qualification = importedLocation || importedQualification || '';
    next.candidate_id = '';
  }

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
  if (!looksLikeCandidateId(next.candidate_id)) next.candidate_id = '';
  // Uploaded sheets should rely on Name/Number/Location/Qualification. Candidate ID remains optional and ignored when invalid.
  if (!next.preferred_location && next.location) next.preferred_location = next.location;
  return next;
}


function parseXhrJsonSafe(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return null; }
}

function postJsonWithProgress(path, payload, { timeoutMs = 120000, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path, true);
    xhr.withCredentials = true;
    xhr.timeout = timeoutMs;
    xhr.responseType = 'json';
    xhr.setRequestHeader('Content-Type', 'application/json');

    xhr.upload.onprogress = (event) => {
      if (!onProgress) return;
      if (event.lengthComputable && event.total > 0) {
        const uploadPercent = Math.min(92, Math.max(1, Math.round((event.loaded / event.total) * 92)));
        onProgress(uploadPercent, 'Uploading sheet to CRM...');
      } else {
        onProgress(45, 'Uploading sheet to CRM...');
      }
    };

    xhr.onprogress = (event) => {
      if (!onProgress) return;
      if (event.lengthComputable && event.total > 0) {
        const responsePercent = Math.min(99, 92 + Math.round((event.loaded / event.total) * 7));
        onProgress(responsePercent, 'Finalising CRM import...');
      } else {
        onProgress(96, 'Finalising CRM import...');
      }
    };

    xhr.onload = () => {
      const payloadOut = parseXhrJsonSafe(xhr.response) || parseXhrJsonSafe(xhr.responseText) || null;
      if (xhr.status >= 200 && xhr.status < 300) {
        if (onProgress) onProgress(100, 'CRM import completed.');
        resolve(payloadOut);
        return;
      }
      const message = String(payloadOut?.message || xhr.statusText || 'Request failed').trim() || 'Request failed';
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('Network error. Please retry.'));
    xhr.ontimeout = () => reject(new Error('Request timed out. Please retry.'));
    xhr.send(JSON.stringify(payload ?? {}));
  });
}

function renderTransferBar(transferState) {
  if (!transferState?.active && !transferState?.progress) return null;
  const percent = Math.max(0, Math.min(100, Math.round(Number(transferState?.progress || 0))));
  return (
    <div className="top-gap-small" style={{ border: '1px solid rgba(65,105,225,.18)', borderRadius: 16, padding: 12, background: 'linear-gradient(180deg, rgba(255,255,255,.98), rgba(245,248,255,.96))' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', fontSize: 13, fontWeight: 700, color: '#21407c' }}>
        <span>{transferState.label || (transferState.kind === 'download' ? 'Download' : 'Upload')}</span>
        <span>{percent}%</span>
      </div>
      <div style={{ marginTop: 8, height: 10, borderRadius: 999, background: 'rgba(33,64,124,.1)', overflow: 'hidden' }}>
        <div style={{ width: `${percent}%`, height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, #3b82f6, #22c55e)', transition: 'width 160ms ease' }} />
      </div>
      <div className="helper-text top-gap-small">{transferState.detail || (transferState.kind === 'download' ? 'Download in progress...' : 'Upload in progress...')}</div>
    </div>
  );
}

export default function AdminPage() {
  const [users, setUsers] = useState([]);
  const [notesCount, setNotesCount] = useState([]);
  const [lockSettings, setLockSettings] = useState({});
  const [lockLogs, setLockLogs] = useState({ activity: [], unlocks: [] });
  const [message, setMessage] = useState('');
  const [importMode, setImportMode] = useState('file');
  const [importText, setImportText] = useState('');
  const [importRows, setImportRows] = useState([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const [transferState, setTransferState] = useState({ active: false, kind: '', label: '', progress: 0, detail: '' });
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [replaceRecruiterFromSheet, setReplaceRecruiterFromSheet] = useState(false);
  const [importDataNotes, setImportDataNotes] = useState('');
  const [resumeText, setResumeText] = useState('');
  const [resumeFields, setResumeFields] = useState({ name: '', number: '', email: '', address: '', companies: '' });
  const [resumeSelected, setResumeSelected] = useState(['name', 'number']);
  const [resumeProcess, setResumeProcess] = useState('');
  const [resumeToken, setResumeToken] = useState('');
  const fileInputRef = useRef(null);
  const hotLeadFileInputRef = useRef(null);
  const [hotLeadRows, setHotLeadRows] = useState([]);
  const [hotLeadFileName, setHotLeadFileName] = useState('');
  const [hotLeadBusy, setHotLeadBusy] = useState(false);

  async function load() {
    const data = await api.get('/api/admin');
    setUsers(data.users || []);
    setNotesCount(data.notes_count || []);
    setLockSettings(data.lock_settings || {});
    setLockLogs(data.lock_logs || { activity: [], unlocks: [] });
  }

  useEffect(() => { load(); }, []);

  const assignableUsers = useMemo(
    () => users.filter((user) => ['recruiter', 'tl', 'manager', 'admin'].includes(String(user.role || '').toLowerCase())),
    [users],
  );

  async function saveLockSettings() {
    const data = await api.post('/api/admin/lock-settings', lockSettings);
    setLockSettings(data.lock_settings || {});
    setMessage('CRM lock timings updated.');
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
      setImportFileName(file.name || 'Selected sheet');
      setTransferState({ active: true, kind: 'upload', label: file.name || 'Selected sheet', progress: 8, detail: 'Reading sheet file...' });
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
      setTransferState({ active: false, kind: 'upload', label: file.name || 'Selected sheet', progress: 100, detail: parsed.length ? `${parsed.length} rows ready for CRM import.` : 'Sheet loaded but no usable rows were detected.' });
      setMessage(parsed.length ? `${parsed.length} candidate rows loaded from file.` : 'No usable rows were detected in the selected file.');
    } catch (error) {
      setImportRows([]);
      setTransferState({ active: false, kind: 'upload', label: file.name || 'Selected sheet', progress: 0, detail: error.message || 'File read failed.' });
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
    setTransferState({ active: true, kind: 'upload', label: importFileName || 'Candidate sheet upload', progress: 2, detail: 'Preparing sheet for CRM import...' });
    try {
      const data = await postJsonWithProgress('/api/admin/import-candidates', {
        rows: importRows,
        assignee_user_id: assigneeUserId,
        replace_recruiter_from_sheet: replaceRecruiterFromSheet,
        data_notes: importDataNotes,
      }, {
        onProgress: (progress, detail) => setTransferState({ active: progress < 100, kind: 'upload', label: importFileName || 'Candidate sheet upload', progress, detail }),
      });
      const summary = data?.summary || {};
      setTransferState({ active: false, kind: 'upload', label: importFileName || 'Candidate sheet upload', progress: 100, detail: 'CRM import completed successfully.' });
      setMessage(`${data?.inserted_count || 0} rows processed. Added: ${summary.inserted || 0}, Updated: ${summary.updated || 0}, Replaced: ${summary.replaced || 0}, Duplicates: ${summary.duplicates || 0}, Skipped: ${summary.skipped || 0}.`);
      setImportText('');
      setImportRows([]);
      setImportDataNotes('');
      setImportFileName('');
      await load();
    } catch (err) {
      setTransferState({ active: false, kind: 'upload', label: importFileName || 'Candidate sheet upload', progress: 0, detail: err.message || 'Import failed.' });
      setMessage(err.message || 'Import failed.');
    } finally {
      setImportBusy(false);
    }
  }


  async function startDownload(path, routeKey, label) {
    try {
      setTransferState({ active: true, kind: 'download', label, progress: 2, detail: 'Starting secure download...' });
      await openManagerProtectedExport(path, routeKey, 'Export failed.', {
        onProgress: (progress, detail) => setTransferState({ active: progress < 100, kind: 'download', label, progress, detail }),
      });
      setTransferState((current) => ({ ...current, active: false, progress: 100, detail: 'Download completed.' }));
    } catch (error) {
      setTransferState({ active: false, kind: 'download', label, progress: 0, detail: error.message || 'Export failed.' });
      setMessage(error.message || 'Export failed.');
    }
  }

  async function downloadCurrentData() {
    await startDownload('/api/admin/export-candidates', 'admin/export-candidates', 'Full CRM workbook');
  }

  async function downloadCandidatesOnly() {
    await startDownload('/api/admin/export-candidate-data-only', 'admin/export-candidate-data-only', 'Candidate Data workbook');
  }

  async function downloadImportTemplate() {
    await startDownload('/api/admin/export-template', 'admin/export-template', 'Blank import template');
  }

  async function downloadUpdatedImportTemplate() {
    await startDownload('/api/admin/export-template-updated', 'admin/export-template-updated', 'Blank Template Updated');
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



  async function downloadHotLeadsTemplate() {
    await startDownload('/api/admin/export-hot-leads-template', 'admin/export-hot-leads-template', 'Hot Leads Format');
  }

  function normalizeHotLeadRow(row) {
    const normalized = normalizeImportedRow(row);
    return {
      ...(row || {}),
      ...normalized,
      full_name: normalized.full_name || row.full_name || row.name || '',
      number: row.number || row.phone || normalized.phone || '',
      phone: normalized.phone || row.phone || row.number || '',
      location: normalized.location || row.location || '',
      qualification: normalized.qualification || row.qualification || '',
      preferred_location: row.preferred_location || normalized.preferred_location || '',
      qualification_level: row.qualification_level || normalized.qualification_level || '',
      total_experience: row.total_experience || normalized.total_experience || '',
      relevant_experience: row.relevant_experience || normalized.relevant_experience || '',
      ctc_monthly: row.ctc_monthly || normalized.ctc_monthly || '',
      in_hand_salary: row.in_hand_salary || normalized.in_hand_salary || '',
      communication_skill: row.communication_skill || normalized.communication_skill || '',
      interview_date: row.interview_date || row.interview_reschedule_date || normalized.interview_date || '',
      notes: row.notes || normalized.notes || '',
      jd_notes: row.jd_notes || '',
      profile_status: row.profile_status || '',
      jd_name: row.jd_name || row.process || normalized.process || '',
      employee_code: row.employee_code || normalized.employee_code || normalized.recruiter_code || row.employee_no || '',
      employee_no: row.employee_no || row.employee_code || normalized.employee_code || normalized.recruiter_code || '',
      employee_name: row.employee_name || '',
      employee_file_url: row.employee_file_url || '',
      employee_row_no: row.employee_row_no || '',
      last_updated_at: row.last_updated_at || '',
    };
  }

  async function onHotLeadFilePicked(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setHotLeadFileName(file.name || 'Hot Leads sheet');
      setTransferState({ active: true, kind: 'upload', label: file.name || 'Hot Leads sheet', progress: 8, detail: 'Reading Hot Leads sheet...' });
      const lowerName = String(file.name || '').toLowerCase();
      let parsed = [];
      if (lowerName.endsWith('.xlsx')) {
        parsed = (await parseXlsxRows(file)).map(normalizeHotLeadRow);
      } else if (lowerName.endsWith('.xls') || lowerName.endsWith('.csv') || lowerName.endsWith('.txt')) {
        const textValue = await file.text();
        parsed = parseExcelLikeText(textValue).map(normalizeHotLeadRow);
      } else {
        throw new Error('Upload .xlsx, .xls, or CSV file. Humanity survives on boring formats.');
      }
      setHotLeadRows(parsed);
      setTransferState({ active: false, kind: 'upload', label: file.name || 'Hot Leads sheet', progress: 100, detail: parsed.length ? `${parsed.length} Hot Lead rows ready.` : 'No usable Hot Lead rows were detected.' });
      setMessage(parsed.length ? `${parsed.length} Hot Lead rows loaded.` : 'No usable Hot Lead rows were detected.');
    } catch (error) {
      setHotLeadRows([]);
      setTransferState({ active: false, kind: 'upload', label: file.name || 'Hot Leads sheet', progress: 0, detail: error.message || 'Hot Leads file read failed.' });
      setMessage(error.message || 'Hot Leads file read failed.');
    } finally {
      event.target.value = '';
    }
  }

  async function runHotLeadImport() {
    if (!hotLeadRows.length) {
      setMessage('Choose Hot Lead sheet first. Empty sheets remain philosophically empty.');
      return;
    }
    setHotLeadBusy(true);
    setTransferState({ active: true, kind: 'upload', label: hotLeadFileName || 'Hot Leads upload', progress: 2, detail: 'Preparing Hot Leads import...' });
    try {
      const data = await postJsonWithProgress('/api/admin/import-hot-leads', {
        rows: hotLeadRows,
        assignee_user_id: assigneeUserId,
        replace_recruiter_from_sheet: replaceRecruiterFromSheet,
      }, {
        onProgress: (progress, detail) => setTransferState({ active: progress < 100, kind: 'upload', label: hotLeadFileName || 'Hot Leads upload', progress, detail }),
      });
      const summary = data?.summary || {};
      setTransferState({ active: false, kind: 'upload', label: hotLeadFileName || 'Hot Leads upload', progress: 100, detail: 'Hot Leads import completed.' });
      setMessage(`Hot Leads processed. Added: ${summary.inserted || 0}, Updated: ${summary.updated || 0}, Skipped: ${summary.skipped || 0}.`);
      setHotLeadRows([]);
      setHotLeadFileName('');
      await load();
    } catch (err) {
      setTransferState({ active: false, kind: 'upload', label: hotLeadFileName || 'Hot Leads upload', progress: 0, detail: err.message || 'Hot Leads import failed.' });
      setMessage(err.message || 'Hot Leads import failed.');
    } finally {
      setHotLeadBusy(false);
    }
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
              <div className="helper-text">Download the full CRM workbook, Candidate Data, or templates. Blank Template accepts only Name, Number, Location, Qualification, and Data Notes. Blank Template Updated also accepts optional employee-detail fields like experience, salary, communication, interview date, and process. Missing cells are allowed; uploaded rows stay in Pending until the team fills the rest.</div>
            </div>
            <div className="toolbar-actions compact-pills">
              <button type="button" className={`choice-chip bounceable ${importMode === 'file' ? 'active' : ''}`} onClick={() => { setImportMode('file'); fileInputRef.current?.click(); }}>Upload Sheet</button>
              <button type="button" className="choice-chip bounceable" onClick={downloadCurrentData}>Download Data</button>
              <button type="button" className="choice-chip bounceable" onClick={downloadCandidatesOnly}>Candidates Data</button>
              <button type="button" className="choice-chip bounceable" onClick={downloadImportTemplate}>Blank Template</button>
              <button type="button" className="choice-chip bounceable" onClick={downloadUpdatedImportTemplate}>Blank Template Updated</button>
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

          <div className="top-gap-small admin-file-box">
              <input ref={fileInputRef} id="admin-sheet-upload" type="file" hidden accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel" onChange={onFilePicked} />
              <div className="row-actions" style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <label htmlFor="admin-sheet-upload" className="ghost-btn bounceable" style={{ cursor: 'pointer' }}>Choose Sheet</label>
                <div className="helper-text" style={{ minWidth: 220 }}>{importFileName || 'No file chosen yet.'}</div>
              </div>
              {renderTransferBar(transferState)}
              <div className="candidate-form-grid candidate-compact-grid top-gap-small">
                <div className="field" style={{ gridColumn: '1 / -1' }}><label>Data Notes For This Upload</label><textarea rows="3" value={importDataNotes} onChange={(e) => setImportDataNotes(e.target.value)} placeholder="This note will be saved on every uploaded row." /></div>
              </div>
              <div className="helper-text top-gap-small">Upload .xlsx, .xls, or .csv. Required format: Name, Number, Location, Qualification, Data Notes. After choosing the file, click Load into CRM. Candidate ID and Data Uploading Date will be filled automatically.</div>
            </div>

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

      <div className="panel admin-import-panel hot-leads-admin-card top-gap">
        <div className="table-toolbar no-border">
          <div>
            <div className="table-title">Hot Leads Upload</div>
            <div className="helper-text">Download Hot Leads format, paste employee Google Sheet data, then upload. Missing details are allowed and will show red inside the Hot Leads slice.</div>
          </div>
          <div className="toolbar-actions compact-pills">
            <button type="button" className="choice-chip bounceable" onClick={downloadHotLeadsTemplate}>Download Hot Leads Format</button>
            <button type="button" className="choice-chip bounceable" onClick={() => hotLeadFileInputRef.current?.click()}>Upload Hot Lead Data</button>
          </div>
        </div>
        <input ref={hotLeadFileInputRef} type="file" hidden accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel" onChange={onHotLeadFilePicked} />
        <div className="admin-import-grid top-gap-small">
          <label className="compact-select-shell shell-indigo">
            <span className="compact-shell-label">Default Assignee</span>
            <select className="inline-input compact-inline-input" value={assigneeUserId} onChange={(e) => setAssigneeUserId(e.target.value)}>
              <option value="">Keep unassigned / sheet mapping</option>
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
        <div className="top-gap-small admin-file-box">
          <div className="row-actions" style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button type="button" className="ghost-btn bounceable" onClick={() => hotLeadFileInputRef.current?.click()}>Choose Hot Lead Sheet</button>
            <div className="helper-text" style={{ minWidth: 220 }}>{hotLeadFileName || 'No hot lead file chosen yet.'}</div>
          </div>
          <div className="helper-text top-gap-small">Accepted headers: employee_code, full_name, number, location, qualification, preferred_location, qualification_level, total_experience, relevant_experience, ctc_monthly, in_hand_salary, communication_skill, interview_date, notes, jd_notes, profile_status, jd_name, employee_name, employee_no, employee_file_url, employee_row_no, last_updated_at.</div>
        </div>
        <div className="top-gap-small admin-preview-box">
          <div className="helper-text"><strong>{hotLeadRows.length}</strong> Hot Lead rows ready.</div>
          {hotLeadRows.length ? (
            <div className="crm-table-wrap dense-wrap top-gap-small">
              <table className="crm-table colorful-table dense-table">
                <thead><tr>{HOT_LEADS_IMPORT_TEMPLATE_COLUMNS.slice(0, 8).map((key) => <th key={key}>{key}</th>)}</tr></thead>
                <tbody>{hotLeadRows.slice(0, 5).map((row, index) => <tr key={`hot-preview-${index}`}>{HOT_LEADS_IMPORT_TEMPLATE_COLUMNS.slice(0, 8).map((key) => <td key={key}>{row[key] || (key === 'number' ? row.phone : '') || '-'}</td>)}</tr>)}</tbody>
              </table>
            </div>
          ) : null}
          <div className="row-actions top-gap-small"><button className="add-profile-btn bounceable" type="button" disabled={!hotLeadRows.length || hotLeadBusy} onClick={runHotLeadImport}>{hotLeadBusy ? 'Uploading...' : 'Load Hot Leads into CRM'}</button></div>
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
          <div className="table-toolbar"><div className="table-title">Team Members</div></div>
          <div className="crm-table-wrap"><table className="crm-table colorful-table"><thead><tr><th>Name</th><th>Role</th><th>Code</th><th>Display Profile</th></tr></thead><tbody>{users.map((u) => <tr key={u.user_id}><td>{u.full_name}<br/><span className="subtle">{u.designation}</span></td><td>{u.role}</td><td>{u.recruiter_code}</td><td>{formatAppearanceLabel(u.theme_name)}</td></tr>)}</tbody></table></div>
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
