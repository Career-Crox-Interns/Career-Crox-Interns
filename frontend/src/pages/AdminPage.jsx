import React, { useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { openManagerProtectedExport } from '../lib/exportAuth';

const PENDING_DUPLICATE_PREVIEW_KEY = 'careerCroxPendingDuplicateUploadPreview_v520';

function RemoveUploadRowIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 7h14M9 7V5h6v2M8 10v8M12 10v8M16 10v8M7 7l1 13h8l1-13" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function ExistingDuplicateDetails({ row = {} }) {
  const values = [
    ['Serial No', row.source_sr_no || row.sr_no || row.serial_no || (String(row.candidate_id || row.existing_candidate_id || '').match(/\d+$/)?.[0] || '')],
    ['Candidate ID', row.candidate_id || row.existing_candidate_id],
    ['Name', row.existing_name || row.full_name || row.name],
    ['Number', row.phone || row.number],
    ['Qualification', row.qualification],
    ['Location', row.location],
    ['Preferred Location', row.preferred_location],
    ['Total Exp', row.total_experience],
    ['Relevant Exp', row.relevant_experience],
    ['CTC', row.ctc_monthly],
    ['In-hand', row.in_hand_salary],
    ['Process', row.process],
    ['Communication', row.communication_skill],
    ['Recruiter', row.recruiter_code || row.recruiter_name],
    ['Status', row.status],
    ['Approval', row.approval_status],
    ['Details Sent', row.all_details_sent],
  ].filter(([, value]) => String(value ?? '').trim());

  if (!values.length && Array.isArray(row.existing_filled_fields) && row.existing_filled_fields.length) {
    return <span className="helper-text">{row.existing_filled_fields.join(' • ')}</span>;
  }
  if (!values.length) return <span className="helper-text">Existing CRM profile found.</span>;

  return (
    <div className="cc525-old-profile-details">
      {values.map(([label, value]) => (
        <span key={`${label}-${String(value)}`} className="cc525-detail-item">
          <strong>{label}:</strong> {String(value)}
        </span>
      ))}
    </div>
  );
}

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
function xmlElements(root, localName) {
  if (!root) return [];
  try {
    if (typeof root.getElementsByTagNameNS === 'function') {
      const namespaced = Array.from(root.getElementsByTagNameNS('*', localName));
      if (namespaced.length) return namespaced;
    }
  } catch {}
  try {
    return Array.from(root.getElementsByTagName(localName) || []).filter((node) => !node.localName || node.localName === localName);
  } catch {
    return [];
  }
}
async function parseXlsxRows(file) {
  const arrayBuffer = await file.arrayBuffer();
  const entries = await unzipEntries(arrayBuffer);
  const workbookXml = await readZipText(entries, 'xl/workbook.xml');
  const workbookRelsXml = await readZipText(entries, 'xl/_rels/workbook.xml.rels');
  if (!workbookXml || !workbookRelsXml) throw new Error('Workbook structure not found.');
  const workbook = xmlDoc(workbookXml);
  const rels = xmlDoc(workbookRelsXml);
  const sheetNodes = xmlElements(workbook, 'sheet');
  const preferredSheet = sheetNodes.find((item) => /candidate\s*data/i.test(item.getAttribute('name') || '')) || sheetNodes[0];
  if (!preferredSheet) return [];
  const relId = preferredSheet.getAttribute('r:id') || preferredSheet.getAttribute('id');
  const relNode = xmlElements(rels, 'Relationship').find((item) => item.getAttribute('Id') === relId);
  const target = relNode?.getAttribute('Target');
  if (!target) throw new Error('Worksheet target not found.');
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  const sharedStringsXml = await readZipText(entries, 'xl/sharedStrings.xml');
  const sharedStrings = sharedStringsXml
    ? xmlElements(xmlDoc(sharedStringsXml), 'si').map((si) => xmlText(si).trim())
    : [];
  const sheetXml = await readZipText(entries, sheetPath);
  const sheetDoc = xmlDoc(sheetXml);
  const rowNodes = xmlElements(sheetDoc, 'row');
  const matrix = rowNodes.map((rowNode) => {
    const cells = [];
    xmlElements(rowNode, 'c').forEach((cell) => {
      const ref = cell.getAttribute('r') || '';
      const idx = cellRefToIndex(ref);
      const type = cell.getAttribute('t') || '';
      const valueNode = xmlElements(cell, 'v')[0];
      const inlineNode = xmlElements(cell, 'is')[0];
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

async function postJsonWithProgress(path, payload, { timeoutMs = 120000, onProgress } = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (onProgress) onProgress(8, 'Starting CRM import...');
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      body: JSON.stringify(payload ?? {}),
      signal: controller.signal,
    });
    if (onProgress) onProgress(92, 'Finalising CRM import...');
    const raw = await response.text();
    const payloadOut = parseXhrJsonSafe(raw) || null;
    if (!response.ok) {
      const error = new Error(String(payloadOut?.message || `Request failed (${response.status})`).trim() || 'Request failed');
      if (payloadOut?.duplicate_analysis) error.duplicate_analysis = payloadOut.duplicate_analysis;
      throw error;
    }
    if (onProgress) onProgress(100, 'CRM import completed.');
    return payloadOut;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Request timed out. Please retry.');
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

function renderTransferBar(transferState) {
  if (!transferState?.active && !transferState?.progress) return null;
  const percent = Math.max(0, Math.min(100, Math.round(Number(transferState?.progress || 0))));
  if (transferState.kind === 'upload' && transferState.active) {
    return (
      <div className="top-gap-small" style={{ border: '1px solid rgba(34,197,94,.24)', borderRadius: 16, padding: 12, background: 'linear-gradient(135deg,#f0fdf4,#eff6ff)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', fontSize: 13, fontWeight: 800, color: '#166534' }}>
          <span>{transferState.label || 'CRM request'}</span><span>Accepted ✓</span>
        </div>
        <div className="helper-text top-gap-small">Request accepted. You can continue working; CRM finishes the safe server work in the background.</div>
      </div>
    );
  }
  return (
    <div className="top-gap-small" style={{ border: '1px solid rgba(65,105,225,.18)', borderRadius: 16, padding: 12, background: 'linear-gradient(180deg, rgba(255,255,255,.98), rgba(245,248,255,.96))' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', fontSize: 13, fontWeight: 700, color: '#21407c' }}>
        <span>{transferState.label || (transferState.kind === 'download' ? 'Download' : 'Upload')}</span>
        <span>{percent}%</span>
      </div>
      <div style={{ marginTop: 8, height: 10, borderRadius: 999, background: 'rgba(33,64,124,.1)', overflow: 'hidden' }}>
        <div style={{ width: `${percent}%`, height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, #3b82f6, #22c55e)', transition: 'width 160ms ease' }} />
      </div>
      <div className="helper-text top-gap-small">{transferState.detail || (transferState.kind === 'download' ? 'Download in progress...' : 'Completed.')}</div>
    </div>
  );
}

export default function AdminPage() {
  const [users, setUsers] = useState([]);
  const [notesCount, setNotesCount] = useState([]);
  const [lockSettings, setLockSettings] = useState({});
  const [lockLogs, setLockLogs] = useState({ activity: [], unlocks: [] });
  const [bulkUploadHistory, setBulkUploadHistory] = useState([]);
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
  const [duplicateAnalysis, setDuplicateAnalysis] = useState(null);
  const [duplicateReviewConfirmed, setDuplicateReviewConfirmed] = useState(false);
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
  const [activeAdminSlice, setActiveAdminSlice] = useState('apk');

  useEffect(() => {
    const open = String(new URLSearchParams(window.location.search).get('open') || '').trim().toLowerCase();
    if (open === 'bulk' || open === 'import' || open === 'candidate-import') setActiveAdminSlice('bulk');
  }, []);

  async function load() {
    const data = await api.get('/api/admin');
    setUsers(data.users || []);
    setNotesCount(data.notes_count || []);
    setLockSettings(data.lock_settings || {});
    setLockLogs(data.lock_logs || { activity: [], unlocks: [] });
    setBulkUploadHistory(Array.isArray(data.bulk_upload_history) ? data.bulk_upload_history : []);
  }

  useEffect(() => { load(); }, []);

  const assignableUsers = useMemo(
    () => users.filter((user) => ['recruiter', 'tl', 'manager', 'admin'].includes(String(user.role || '').toLowerCase())),
    [users],
  );

  const adminSlices = useMemo(() => [
    { key: 'apk', label: 'APK Download' },
    { key: 'locks', label: 'Lock & Attendance' },
    { key: 'bulk', label: 'Bulk Candidate Load' },
    { key: 'hot-leads', label: 'Hot Leads Upload' },
    { key: 'resume-team', label: 'Resume & Team' },
    { key: 'audit', label: 'Audit Logs' },
  ], []);

  async function saveLockSettings() {
    const today = new Date().toISOString().slice(0, 10);
    const payload = {
      ...lockSettings,
      attendance_rules_effective_from: lockSettings.attendance_rules_effective_from || today,
    };
    const data = await api.post('/api/admin/lock-settings', payload);
    setLockSettings(data.lock_settings || {});
    setMessage('Attendance parameters and CRM lock timings updated. New attendance rules apply from the configured effective date.');
  }

  function buildPreview(textValue = importText) {
    const parsed = parseGridText(textValue).map(normalizeImportedRow);
    setImportRows(parsed);
    setDuplicateAnalysis(null);
    setDuplicateReviewConfirmed(false);
    if (!parsed.length) setMessage('Valid rows were not detected in the pasted sheet.');
    else setMessage(`${parsed.length} candidate rows detected. Click Analyze Duplicates before loading into CRM.`);
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
      setDuplicateAnalysis(null);
      setDuplicateReviewConfirmed(false);
      setTransferState({ active: false, kind: 'upload', label: file.name || 'Selected sheet', progress: 100, detail: parsed.length ? `${parsed.length} rows ready for duplicate analysis.` : 'Sheet loaded but no usable rows were detected.' });
      setMessage(parsed.length ? `${parsed.length} candidate rows loaded from ${file.name}. Duplicate analysis will run now.` : 'No usable candidate rows were detected. Use the Candidate Data sheet and keep the first-row headers unchanged.');
      if (parsed.length) await analyzeImportDuplicates(parsed);
    } catch (error) {
      setImportRows([]);
      setDuplicateAnalysis(null);
      setDuplicateReviewConfirmed(false);
      setTransferState({ active: false, kind: 'upload', label: file.name || 'Selected sheet', progress: 0, detail: error.message || 'File read failed.' });
      setMessage(error.message || 'File read failed.');
    } finally {
      event.target.value = '';
    }
  }


  async function analyzeImportDuplicates(rowsForAnalysis = importRows, { preserveBusy = false } = {}) {
    if (!rowsForAnalysis.length) {
      setMessage('Paste or load candidate rows first.');
      return null;
    }
    setImportBusy(true);
    setDuplicateReviewConfirmed(false);
    setTransferState({ active: true, kind: 'upload', label: importFileName || 'Duplicate analysis', progress: 20, detail: 'Checking existing CRM profiles before import...' });
    try {
      const data = await api.post('/api/admin/analyze-candidate-upload', {
        rows: rowsForAnalysis,
        assignee_user_id: assigneeUserId,
        replace_recruiter_from_sheet: replaceRecruiterFromSheet,
        data_notes: importDataNotes,
        file_name: importFileName || '',
        sheet_name: importFileName ? 'Uploaded Sheet' : '',
      }, { cacheTtlMs: 0, timeoutMs: 15000, retries: 0, background: true });
      setDuplicateAnalysis(data || null);
      const summary = data?.summary || {};
      setTransferState({ active: false, kind: 'upload', label: importFileName || 'Duplicate analysis', progress: 100, detail: 'Duplicate analysis completed.' });
      setMessage(`Duplicate analysis ready. New: ${summary.new_profiles || 0}, Blank matches: ${summary.blank_existing_matches || 0}, Filled existing: ${summary.filled_existing_matches || 0}, Skipped: ${summary.skipped || 0}.`);
      window.setTimeout(() => document.getElementById('candidate-duplicate-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
      return data;
    } catch (err) {
      setTransferState({ active: false, kind: 'upload', label: importFileName || 'Duplicate analysis', progress: 0, detail: err.message || 'Duplicate analysis failed.' });
      setMessage(err.message || 'Duplicate analysis failed.');
      return null;
    } finally {
      if (!preserveBusy) setImportBusy(false);
    }
  }

  async function removePendingImportRow(rowNumber) {
    const target = Number(rowNumber || 0) - 1;
    if (target < 0 || target >= importRows.length || importBusy) return;
    const removed = importRows[target] || {};
    const nextRows = importRows.filter((_, index) => index !== target);
    setImportRows(nextRows);
    setDuplicateAnalysis(null);
    setDuplicateReviewConfirmed(false);
    setMessage(`Removed ${removed.full_name || removed.name || removed.number || `row ${rowNumber}`} from this pending import only. Existing CRM data was not touched.`);
    if (nextRows.length) await analyzeImportDuplicates(nextRows);
    else setMessage('All pending upload rows were removed. Existing CRM data was not touched.');
  }

  async function runImport(forceDuplicateReview = false) {
    if (!importRows.length) {
      const msg = 'Paste or load candidate rows first.';
      setMessage(msg);
      window.alert(msg);
      return;
    }
    setImportBusy(true);
    setMessage('');
    setTransferState({ active: true, kind: 'upload', label: importFileName || 'Candidate sheet upload', progress: 5, detail: 'Checking sheet before CRM import...' });
    try {
      // Bulk Candidate Load is create-safe: never trust/import an uploaded Candidate ID.
      // This prevents a spreadsheet from overwriting an existing filled profile by ID.
      const safeRows = importRows.map((row) => ({ ...(row || {}), candidate_id: '' }));
      let analysis = duplicateAnalysis;
      if (!analysis) analysis = await analyzeImportDuplicates(safeRows, { preserveBusy: true });
      if (!analysis) throw new Error('Duplicate analysis could not complete. Please retry once.');

      setDuplicateAnalysis(analysis);
      if (analysis?.requires_review && !forceDuplicateReview) {
        setTransferState({ active: false, kind: 'upload', label: importFileName || 'Candidate sheet upload', progress: 100, detail: 'Duplicate phone sets found. Review the sets below, remove any uploaded rows you do not want, then continue safely.' });
        setMessage('Duplicate phone sets found. Review every set below. The red trash icon removes only that uploaded row from this pending import; existing CRM profiles remain untouched.');
        window.setTimeout(() => document.getElementById('candidate-duplicate-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
        return;
      }
      setTransferState({ active: true, kind: 'upload', label: importFileName || 'Candidate sheet upload', progress: 45, detail: analysis?.requires_review ? 'Reviewed duplicate sets accepted. Importing remaining rows safely...' : 'No unsafe overwrite found. Loading rows into CRM...' });

      // Use the same API client as every other CRM write. It carries the current session,
      // write-state handling and consistent error/session behaviour.
      const data = await api.post('/api/admin/import-candidates', {
        rows: safeRows,
        duplicate_review_confirmed: true,
        assignee_user_id: assigneeUserId,
        replace_recruiter_from_sheet: replaceRecruiterFromSheet,
        data_notes: importDataNotes,
        file_name: importFileName || '',
        sheet_name: importFileName ? 'Uploaded Sheet' : '',
      }, { cacheTtlMs: 0, timeoutMs: 120000 });

      const summary = data?.summary || {};
      const processed = Number(data?.inserted_count || 0);
      setTransferState({ active: false, kind: 'upload', label: importFileName || 'Candidate sheet upload', progress: 100, detail: 'CRM import completed successfully.' });
      const doneMessage = `${processed} rows processed. Added: ${summary.inserted || 0}, Updated: ${summary.updated || 0}, Replaced: ${summary.replaced || 0}, Duplicates: ${summary.duplicates || 0}, Skipped: ${summary.skipped || 0}.`;
      setMessage(`${doneMessage} Upload history saved in Admin > Audit Logs.`);
      window.alert(`Import completed. ${doneMessage}`);
      setImportText('');
      setImportRows([]);
      setImportDataNotes('');
      setImportFileName('');
      setDuplicateAnalysis(null);
      setDuplicateReviewConfirmed(false);
      try { localStorage.removeItem(PENDING_DUPLICATE_PREVIEW_KEY); } catch {}
      await load();
    } catch (err) {
      if (err?.duplicate_analysis) setDuplicateAnalysis(err.duplicate_analysis);
      setDuplicateReviewConfirmed(false);
      setTransferState({ active: false, kind: 'upload', label: importFileName || 'Candidate sheet upload', progress: 0, detail: err.message || 'Import failed.' });
      const failMessage = err?.message || 'Import failed. Please retry.';
      setMessage(failMessage);
      window.alert(`Import failed: ${failMessage}`);
    } finally {
      setImportBusy(false);
    }
  }


  function openDuplicateProfilesWithPreview() {
    if (!duplicateAnalysis) return;
    try {
      localStorage.setItem(PENDING_DUPLICATE_PREVIEW_KEY, JSON.stringify({
        saved_at: Date.now(),
        expires_at: Date.now() + (30 * 60 * 1000),
        file_name: importFileName || 'Candidate upload',
        analysis: duplicateAnalysis,
      }));
    } catch {}
    window.open('/duplicate-profiles?upload_preview=1', '_blank');
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

  function downloadCareerCroxApk() {
    try {
      const link = document.createElement('a');
      link.href = `/download/android-apk?_ts=${Date.now()}`;
      link.download = 'Career Crox.apk';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTransferState({ active: false, kind: 'download', label: 'Career Crox APK', progress: 100, detail: 'Career Crox APK download requested.' });
      setMessage('Career Crox APK download requested from Admin Control.');
    } catch (error) {
      setTransferState({ active: false, kind: 'download', label: 'Career Crox APK', progress: 0, detail: error.message || 'APK download failed.' });
      setMessage(error.message || 'APK download failed.');
    }
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
        throw new Error('Upload an .xlsx, .xls, or CSV file.');
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
        file_name: hotLeadFileName || '',
        sheet_name: hotLeadFileName ? 'Hot Leads Sheet' : '',
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
    <Layout title="Admin Control" subtitle="">
      {!!message && <div className="panel top-gap-small"><div className="helper-text">{message}</div></div>}

      <div className="panel top-gap">
        <div className="table-toolbar no-border">
          <div>
            <div className="table-title">Admin Control Sub Slices</div>
            <div className="helper-text"></div>
          </div>
        </div>
        <div className="toolbar-actions compact-pills top-gap-small" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
          {adminSlices.map((slice) => (
            <button
              key={slice.key}
              type="button"
              className={`choice-chip bounceable ${activeAdminSlice === slice.key ? 'active' : ''}`}
              onClick={() => setActiveAdminSlice(slice.key)}
            >
              {slice.label}
            </button>
          ))}
        </div>
      </div>

      {activeAdminSlice === 'apk' && (
      <div className="panel top-gap">
        <div className="table-toolbar no-border">
          <div>
            <div className="table-title">Career Crox Android App</div>
            <div className="helper-text">Get the latest Career Crox Android build here.</div>
          </div>
          <div className="toolbar-actions compact-pills">
            <button type="button" className="choice-chip bounceable active" onClick={downloadCareerCroxApk}>Download APK</button>
          </div>
        </div>
        {renderTransferBar(transferState)}
      </div>
      )}

      {activeAdminSlice === 'locks' && (
        <div className="small-grid two top-gap">
        <div className="panel">
          <div className="panel-title">CRM Lock Settings</div>
          <div className="candidate-form-grid candidate-compact-grid">
            <div className="field"><label>Idle Lock Minutes</label><input value={lockSettings.crm_lock_idle_minutes || ''} onChange={(e) => setLockSettings({ ...lockSettings, crm_lock_idle_minutes: e.target.value })} /></div>
            <div className="field"><label>No-Call Lock Minutes</label><input value={lockSettings.crm_lock_no_call_minutes || ''} onChange={(e) => setLockSettings({ ...lockSettings, crm_lock_no_call_minutes: e.target.value })} /></div>
            <div className="field"><label>Break Limit Minutes</label><input value={lockSettings.crm_lock_break_limit_minutes || ''} onChange={(e) => setLockSettings({ ...lockSettings, crm_lock_break_limit_minutes: e.target.value })} /></div>
            <div className="field"><label>Over-Break Alert Repeat</label><input value={lockSettings.crm_lock_break_warning_minutes || ''} onChange={(e) => setLockSettings({ ...lockSettings, crm_lock_break_warning_minutes: e.target.value })} /></div>
            <div className="field"><label>Break Exceed Lock Grace Seconds</label><input value={lockSettings.attendance_break_overrun_lock_grace_seconds || ''} onChange={(e) => setLockSettings({ ...lockSettings, attendance_break_overrun_lock_grace_seconds: e.target.value })} placeholder="180" /></div>
            <div className="field"><label>Lock Reminder Minutes</label><input value={lockSettings.crm_lock_reminder_minutes || ''} onChange={(e) => setLockSettings({ ...lockSettings, crm_lock_reminder_minutes: e.target.value })} /></div>
            <div className="field"><label>Logout Nudge Time</label><input value={lockSettings.logout_nudge_time || ''} onChange={(e) => setLockSettings({ ...lockSettings, logout_nudge_time: e.target.value })} placeholder="18:30" /></div>
            <div className="field"><label>Live Refresh Seconds</label><input value={lockSettings.live_refresh_seconds || ''} onChange={(e) => setLockSettings({ ...lockSettings, live_refresh_seconds: e.target.value })} /></div>

            <div className="field"><label>Idle Warning Minutes</label><input value={lockSettings.crm_monitor_idle_warning_minutes || ''} onChange={(e) => setLockSettings({ ...lockSettings, crm_monitor_idle_warning_minutes: e.target.value })} placeholder="5" /></div>
            <div className="field"><label>No-Call Warning Minutes</label><input value={lockSettings.crm_monitor_no_call_warning_minutes || ''} onChange={(e) => setLockSettings({ ...lockSettings, crm_monitor_no_call_warning_minutes: e.target.value })} placeholder="15" /></div>
            <div className="field"><label>Low Call Window Minutes</label><input value={lockSettings.crm_monitor_low_call_window_minutes || ''} onChange={(e) => setLockSettings({ ...lockSettings, crm_monitor_low_call_window_minutes: e.target.value })} placeholder="60" /></div>
            <div className="field"><label>Low Call Min Calls</label><input value={lockSettings.crm_monitor_low_call_min_calls || ''} onChange={(e) => setLockSettings({ ...lockSettings, crm_monitor_low_call_min_calls: e.target.value })} placeholder="5" /></div>
            <div className="field"><label>Manager Alert Repeat Minutes</label><input value={lockSettings.crm_monitor_alert_repeat_minutes || ''} onChange={(e) => setLockSettings({ ...lockSettings, crm_monitor_alert_repeat_minutes: e.target.value })} placeholder="15" /></div>
            <div className="field"><label>Activity Credit Window Minutes</label><input value={lockSettings.crm_activity_window_minutes || ''} onChange={(e) => setLockSettings({ ...lockSettings, crm_activity_window_minutes: e.target.value })} placeholder="2" /></div>
          </div>
          <div className="row-actions top-gap"><button className="add-profile-btn bounceable" type="button" onClick={saveLockSettings}>Save Settings</button><span className="helper-text">Leadership controls warning thresholds and CRM lock timing from here.</span></div>
        </div>
        <div className="panel">
          <div className="panel-title">Attendance Parameters</div>
          <div className="helper-text">Set policy thresholds here. New rules apply from the selected effective date onward.</div>
          <div className="candidate-form-grid candidate-compact-grid top-gap-small">
            <div className="field"><label>Effective From</label><input type="date" value={lockSettings.attendance_rules_effective_from || ''} onChange={(e) => setLockSettings({ ...lockSettings, attendance_rules_effective_from: e.target.value })} /></div>
            <div className="field"><label>Daily Salary Amount</label><input value={lockSettings.attendance_daily_salary_amount || ''} onChange={(e) => setLockSettings({ ...lockSettings, attendance_daily_salary_amount: e.target.value })} placeholder="0" /></div>
            <div className="field"><label>Login Time</label><input type="time" value={lockSettings.attendance_shift_login_time || ''} onChange={(e) => setLockSettings({ ...lockSettings, attendance_shift_login_time: e.target.value })} /></div>
            <div className="field"><label>Logout Time</label><input type="time" value={lockSettings.attendance_shift_logout_time || ''} onChange={(e) => setLockSettings({ ...lockSettings, attendance_shift_logout_time: e.target.value })} /></div>
            <div className="field"><label>Full Day Work Minutes</label><input value={lockSettings.attendance_full_day_work_minutes || ''} onChange={(e) => setLockSettings({ ...lockSettings, attendance_full_day_work_minutes: e.target.value })} /></div>
            <div className="field"><label>Half Day Work Minutes</label><input value={lockSettings.attendance_half_day_work_minutes || ''} onChange={(e) => setLockSettings({ ...lockSettings, attendance_half_day_work_minutes: e.target.value })} /></div>
            <div className="field"><label>Break Limit Minutes</label><input value={lockSettings.attendance_break_limit_minutes || ''} onChange={(e) => setLockSettings({ ...lockSettings, attendance_break_limit_minutes: e.target.value })} /></div>
            <div className="field"><label>Late Grace Minutes</label><input value={lockSettings.attendance_late_grace_minutes || ''} onChange={(e) => setLockSettings({ ...lockSettings, attendance_late_grace_minutes: e.target.value })} /></div>
            <div className="field"><label>Continuous Late Half Day After</label><input value={lockSettings.attendance_late_half_day_after_count || ''} onChange={(e) => setLockSettings({ ...lockSettings, attendance_late_half_day_after_count: e.target.value })} placeholder="3" /></div>
            <div className="field"><label>Minimum Talktime Minutes</label><input value={lockSettings.attendance_min_talktime_minutes || ''} onChange={(e) => setLockSettings({ ...lockSettings, attendance_min_talktime_minutes: e.target.value })} /></div>
            <div className="field"><label>Minimum Calling Count</label><input value={lockSettings.attendance_min_calling_count || ''} onChange={(e) => setLockSettings({ ...lockSettings, attendance_min_calling_count: e.target.value })} /></div>
            <div className="field"><label>Minimum Outgoing Calls</label><input value={lockSettings.attendance_min_outgoing_calls || ''} onChange={(e) => setLockSettings({ ...lockSettings, attendance_min_outgoing_calls: e.target.value })} /></div>
            <div className="field"><label>Minimum Incoming Calls</label><input value={lockSettings.attendance_min_incoming_calls || ''} onChange={(e) => setLockSettings({ ...lockSettings, attendance_min_incoming_calls: e.target.value })} /></div>
            <div className="field"><label>Minimum Submissions</label><input value={lockSettings.attendance_min_submissions || ''} onChange={(e) => setLockSettings({ ...lockSettings, attendance_min_submissions: e.target.value })} /></div>
            <div className="field"><label>Minimum Selections</label><input value={lockSettings.attendance_min_selections || ''} onChange={(e) => setLockSettings({ ...lockSettings, attendance_min_selections: e.target.value })} /></div>
            <div className="field"><label>Minimum Interviews</label><input value={lockSettings.attendance_min_interviews || ''} onChange={(e) => setLockSettings({ ...lockSettings, attendance_min_interviews: e.target.value })} /></div>
            <div className="field"><label>Minimum Joinings</label><input value={lockSettings.attendance_min_joinings || ''} onChange={(e) => setLockSettings({ ...lockSettings, attendance_min_joinings: e.target.value })} /></div>
          </div>
          <div className="row-actions top-gap"><button className="add-profile-btn bounceable" type="button" onClick={saveLockSettings}>Save Attendance Parameters</button><span className="helper-text">0 disables that rule.</span></div>
        </div>
        </div>
      )}

      {activeAdminSlice === 'bulk' && (
        <div className="top-gap">
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
                <div className="field" style={{ gridColumn: '1 / -1' }}><label>Data Notes For This Upload</label><textarea rows="3" value={importDataNotes} onChange={(e) => setImportDataNotes(e.target.value)} placeholder="Applied to every imported row." /></div>
              </div>
              <div className="helper-text top-gap-small">Upload XLSX, XLS, or CSV with Name, Number, Location, Qualification, and Data Notes. Candidate ID and upload date are generated automatically.</div>
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
            {duplicateAnalysis ? (
              <div id="candidate-duplicate-review" className="panel top-gap-small" style={{ border: duplicateAnalysis.requires_review ? '1px solid rgba(239,68,68,.32)' : '1px solid rgba(34,197,94,.28)', background: duplicateAnalysis.requires_review ? 'linear-gradient(135deg,#fff7ed,#fff1f2)' : 'linear-gradient(135deg,#f0fdf4,#eff6ff)', boxShadow: '0 18px 44px rgba(15,23,42,.08)' }}>
                <div className="table-toolbar no-border">
                  <div>
                    <div className="table-title">Upload Duplicate Analysis</div>
                    <div className="helper-text">Existing profiles stay protected. Review matches before choosing what to keep.</div>
                  </div>
                  <div className="toolbar-actions compact-pills">
                    <span className={`mini-chip ${duplicateAnalysis.requires_review ? 'sync-chip error' : 'sync-chip saved'}`}>{duplicateAnalysis.requires_review ? 'Review Required' : 'Safe To Import'}</span>
                  </div>
                </div>
                <div className="compact-chip-row compact-chip-wrap top-gap-small">
                  <span className="mini-chip">New: {duplicateAnalysis.summary?.new_profiles || 0}</span>
                  <span className="mini-chip">Blank matches: {duplicateAnalysis.summary?.blank_existing_matches || 0}</span>
                  <span className="mini-chip">Filled existing: {duplicateAnalysis.summary?.filled_existing_matches || 0}</span>
                  <span className="mini-chip">Skipped: {duplicateAnalysis.summary?.skipped || 0}</span>
                </div>
                {duplicateAnalysis.duplicate_groups?.length ? (
                  <div className="top-gap-small cc525-duplicate-rowwise">
                    {duplicateAnalysis.duplicate_groups.map((group, groupIndex) => (
                      <div key={`phone-set-${group.group_key || groupIndex}`} className="cc525-duplicate-set">
                        <div className="cc525-duplicate-set-head">
                          <strong style={{ fontSize: 15, color: '#173b67' }}>Set {groupIndex + 1} • Same phone digits: {group.phone || group.group_key}</strong>
                          <span className="mini-chip">{group.uploaded_count || 0} uploaded + {group.existing_count || 0} existing</span>
                        </div>
                        <div className="cc525-duplicate-set-body">
                          {(group.uploaded_rows || []).map((uploadRow, uploadIndex) => (
                            <div key={`pair-${group.group_key}-${uploadRow.row_number || uploadIndex}`} className="cc525-duplicate-pair">
                              <div className="cc525-compare-row cc525-new-upload-row">
                                <span className="mini-chip">New Upload • Row {uploadRow.row_number || uploadIndex + 1}</span>
                                <span className="cc525-new-upload-blank">Blank row — compare with the existing CRM row below</span>
                                <button type="button" className="mini-btn bounceable" disabled={importBusy} onClick={() => removePendingImportRow(uploadRow.row_number)} title="Remove only this new uploaded row; existing CRM data is never deleted" style={{ color: '#b91c1c', borderColor: 'rgba(239,68,68,.35)', background: '#fff1f2' }}><RemoveUploadRowIcon /></button>
                              </div>
                              {(group.existing_profiles || []).length ? (group.existing_profiles || []).map((existingRow, existingIndex) => (
                                <div key={`old-${group.group_key}-${existingRow.candidate_id || existingIndex}`} className="cc525-compare-row cc525-old-crm-row">
                                  <span className="mini-chip sync-chip saved">Old CRM Row</span>
                                  <ExistingDuplicateDetails row={existingRow} />
                                  <span title="Existing CRM profile is protected" style={{ textAlign: 'center' }}>🔒</span>
                                </div>
                              )) : (
                                <div style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr) 54px', alignItems: 'start', padding: '9px 10px', gap: 10, background: '#f8fbff' }}>
                                  <span className="mini-chip sync-chip saved">Same Upload Match</span>
                                  <span className="helper-text">Duplicate is inside this upload; there is no old CRM row for this set.</span>
                                  <span aria-hidden="true">—</span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : duplicateAnalysis.review_rows?.length ? (
                  <div className="top-gap-small" style={{ display: 'grid', gap: 10 }}>
                    {duplicateAnalysis.review_rows.map((row, index) => (
                      <div key={`dup-${row.row_number}-${row.existing_candidate_id || index}`} style={{ border: '1px solid rgba(59,130,246,.18)', borderRadius: 14, overflow: 'hidden', background: '#fbfdff' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr)', minHeight: 46, alignItems: 'center', padding: '8px 10px', gap: 10, borderBottom: '1px dashed rgba(59,130,246,.18)' }}><span className="mini-chip">New Upload • Row {row.row_number || index + 1}</span><span className="cc525-new-upload-blank">Blank row — compare with the existing CRM row below</span></div>
                        <div style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr)', alignItems: 'start', padding: '9px 10px', gap: 10, background: '#f8fbff' }}><span className="mini-chip sync-chip saved">Old CRM Row</span><ExistingDuplicateDetails row={{ ...row, candidate_id: row.existing_candidate_id, existing_name: row.existing_name }} /></div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {duplicateAnalysis.requires_review ? <div className="row-actions top-gap-small"><button className="mini-btn view bounceable" type="button" onClick={openDuplicateProfilesWithPreview}>Open Duplicate Profiles</button><button className="add-profile-btn bounceable" type="button" disabled={importBusy || !importRows.length} onClick={() => { setDuplicateReviewConfirmed(true); setMessage('Reviewed rows accepted. Importing only the rows still present in this upload.'); runImport(true); }}>Continue Import Safely</button></div> : null}
              </div>
            ) : null}
            <div className="row-actions top-gap-small"><button className="mini-btn view bounceable" type="button" disabled={!importRows.length || importBusy} onClick={() => analyzeImportDuplicates()}>{'Analyze Duplicates'}</button><button className="add-profile-btn bounceable" type="button" disabled={!importRows.length || importBusy} onClick={() => runImport(false)}>{'Load into CRM'}</button></div>{message ? <div className="helper-text top-gap-small" aria-live="polite">{message}</div> : null}
          </div>
        </div>
        </div>
      )}

      {activeAdminSlice === 'hot-leads' && (
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
          <div className="row-actions top-gap-small"><button className="add-profile-btn bounceable" type="button" disabled={!hotLeadRows.length || hotLeadBusy} onClick={runHotLeadImport}>{'Load Hot Leads into CRM'}</button></div>
        </div>
      </div>
      )}

      {activeAdminSlice === 'resume-team' && (
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
      )}

      {activeAdminSlice === 'audit' && (
        <>
      <div className="table-panel top-gap cc-bulk-upload-history-panel">
        <div className="table-toolbar"><div><div className="table-title">Bulk Upload History</div><div className="helper-text">Import Audit Trail</div></div></div>
        <div className="crm-table-wrap dense-wrap"><table className="crm-table colorful-table dense-table"><thead><tr><th>Time</th><th>Type</th><th>Uploaded Rows</th><th>Added</th><th>Updated</th><th>Duplicate</th><th>Skipped</th><th>Data Notes Applied</th><th>Data Notes</th><th>Uploaded By</th><th>File</th></tr></thead><tbody>{(bulkUploadHistory || []).map((row) => <tr key={row.upload_id || `${row.created_at}-${row.file_name}`}><td>{row.created_at || '-'}</td><td>{row.upload_type || 'Bulk Upload'}</td><td>{row.uploaded_rows || 0}</td><td>{row.added_count || 0}</td><td>{row.updated_count || 0}</td><td>{row.duplicate_count || 0}</td><td>{row.skipped_count || 0}</td><td>{row.data_notes_applied_count || 0}</td><td>{row.data_notes || '-'}</td><td>{row.uploaded_by_name || row.uploaded_by_code || '-'}</td><td>{row.file_name || '-'}</td></tr>)}{!(bulkUploadHistory || []).length && <tr><td colSpan="11" className="helper-text">Import history will appear here.</td></tr>}</tbody></table></div>
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
        </>
      )}
    </Layout>
  );
}
