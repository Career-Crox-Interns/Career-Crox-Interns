import { crmTodayYmd } from '../lib/workspaceHelpers';
import { formatCrmClock } from '../lib/workspaceHelpers';
import { CrmDateTimeInput } from '../components/PremiumSelect';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { openManagerProtectedExport } from '../lib/workspaceHelpers';
import { updateRowSelection } from '../lib/workspaceHelpers';


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

function localToday() {return crmTodayYmd();}

function formatUploadTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true,timeZone:'Asia/Kolkata'}).format(date);
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
  }).filter(row=>['full_name','name','candidate_name','phone','number','mobile'].some(key=>String(row[key] ?? '').trim()));
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
  }).filter(row=>['full_name','name','candidate_name','phone','number','mobile'].some(key=>String(row[key] ?? '').trim()));
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
  const lines = [];
  let record = '', quoted = false;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (char === '"') {
      record += char;
      if (quoted && raw[index+1] === '"') { record += raw[++index]; continue; }
      quoted = !quoted;
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (record.trim()) lines.push(record);
      record = '';
      if (char === '\r' && raw[index+1] === '\n') index++;
    } else record += char;
  }
  if (quoted) throw new Error('A CSV quoted cell is incomplete. Correct the file and choose it again.');
  if (record.trim()) lines.push(record);
  if (lines.length < 2) return [];
  const delimiter = ['\t',',',';','|'].reduce((best, value) => splitSmartLine(lines[0],value).length > splitSmartLine(lines[0],best).length ? value : best, ',');
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
  source_sr_no: ['source_sr_no','serial_no','serial_number','sr_no','s_no','sno','serial'],
  full_name: ['full_name','name','candidate_name','candidate','applicant_name'],
  phone: ['phone','number','mobile','mobile_no','contact_number','phone_number','contact'],
  email: ['email','mail','email_id','e_mail'],
  location: ['location','current_location','city','current_city'],
  preferred_location: ['preferred_location','preferred_city','preferred_loc'],
  process: ['process','job_title','jd','project','campaign'],
  recruiter_code: ['recruiter_code','owner_code','recruiter id','employee_code','employee code','employee_no','employee no','employee_id','employee id'],
  employee_code: ['employee_code','employee code','employee_no','employee no','employee_id','employee id','recruiter_code','owner_code'],
  recruiter_name: ['recruiter_name','owner_name','recruiter'],
  total_experience: ['total_experience','total_exp','experience','experience_months'],
  relevant_experience: ['relevant_experience','relevant_exp','relevant_experience_months'],
  ctc_monthly: ['ctc_monthly','monthly_ctc','monthly_ctc_salary','monthly_ctc_inr','ctc'],
  in_hand_salary: ['in_hand_salary','inhand_salary','monthly_inhand_salary','monthly_in_hand_salary','in_hand_monthly_salary','inhand_monthly_salary','take_home_salary','salary'],
  data_notes: ['data_notes'],
  notes: ['notes','profile_note','master_notes','note','remarks'],
  qualification_level: ['qualification_level','degree'],
  qualification: ['qualification','course_name','course'],
  communication_skill: ['communication_skill','communication','english','communication_level'],
  interview_date: ['interview_date','interview_reschedule_date'],
};

function firstAlias(row, aliases) {
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    const value = row?.[key];
    if (String(value ?? '').trim()) return String(value).trim();
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
  const source = Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [normalizeHeader(key), String(value ?? '').trim()]));
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
  return (
    <div className="top-gap-small" style={{ border: '1px solid rgba(65,105,225,.18)', borderRadius: 16, padding: 12, background: 'linear-gradient(180deg, rgba(255,255,255,.98), rgba(245,248,255,.96))' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', fontSize: 13, fontWeight: 700, color: '#21407c' }}>
        <span>{transferState.label || (transferState.kind === 'download' ? 'Download' : 'Upload')}</span>
        <span>{transferState.active ? 'In progress' : `${percent}%`}</span>
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
  const [uploadAssignees, setUploadAssignees] = useState([]);
  const [notesCount, setNotesCount] = useState([]);
  const [lockSettings, setLockSettings] = useState({});
  const [lockLogs, setLockLogs] = useState({ activity: [], unlocks: [] });
  const [bulkUploadHistory, setBulkUploadHistory] = useState([]);
  const [message, setMessage] = useState('');
  const [importMode, setImportMode] = useState('file');
  const [importText, setImportText] = useState('');
  const [importRows, setImportRows] = useState([]);
  const [uploadKind,setUploadKind]=useState('draft');
  const [importBusy, setImportBusy] = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const [transferState, setTransferState] = useState({ active: false, kind: '', label: '', progress: 0, detail: '' });
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [replaceRecruiterFromSheet, setReplaceRecruiterFromSheet] = useState(false);
  const [importDataNotes, setImportDataNotes] = useState('');
  const [importUploadingDate, setImportUploadingDate] = useState(() => localToday());
  const [lastImportDuplicateCount, setLastImportDuplicateCount] = useState(0);
  const [assignmentRanges, setAssignmentRanges] = useState([]);
  const [reviewAnalysis, setReviewAnalysis] = useState(null);
  const [reviewChoices, setReviewChoices] = useState({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewSearch, setReviewSearch] = useState('');
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewSelectedIds,setReviewSelectedIds] = useState([]);
  const [reviewBulkAction, setReviewBulkAction] = useState('');
  const reviewSelectionAnchorRef = useRef(null);
  const previewSelectionAnchorRef = useRef(null);
  const [ariaTiming,setAriaTiming] = useState({start:'09:00',end:'21:00'});
  const [ariaBusy,setAriaBusy] = useState(false);
  const [previewPage, setPreviewPage] = useState(1);
  const [reviewExpanded, setReviewExpanded] = useState({});
  const [reviewBusy, setReviewBusy] = useState(false);
  const importCommandRef = useRef(null);
  const importLockRef = useRef(false);
  const reviewLockRef = useRef(false);
  const importProgressRef = useRef(null);
  const prepareUploadRows = rows => rows.map((row, index) => ({ ...(row || {}), candidate_id: '',
    _upload_row_id: `UPLOAD-${index + 1}`, source_sr_no: row.source_sr_no || row.serial_no || row.sr_no || String(index + 1) }));
  function resetUploadReview() { setReviewAnalysis(null); setReviewChoices({}); setReviewOpen(false); setReviewSearch(''); setReviewSelectedIds([]); setReviewBulkAction(''); reviewSelectionAnchorRef.current = null; previewSelectionAnchorRef.current = null; setReviewPage(1); setPreviewPage(1); setReviewExpanded({}); importCommandRef.current = null; }
  useEffect(() => () => window.clearInterval(importProgressRef.current), []);
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
    setAriaTiming({start:data.lock_settings?.aria_report_start_time || '09:00',end:data.lock_settings?.aria_report_end_time || '21:00'});
    setLockLogs(data.lock_logs || { activity: [], unlocks: [] });
    setBulkUploadHistory(Array.isArray(data.bulk_upload_history) ? data.bulk_upload_history : []);
    setUploadAssignees(Array.isArray(data.upload_assignees) ? data.upload_assignees : []);
  }

  useEffect(() => { load(); }, []);

  const assignableUsers = useMemo(
    () => uploadAssignees,
    [uploadAssignees],
  );
  const filteredReviewGroups = useMemo(() => (reviewAnalysis?.duplicate_groups || []).filter(group => {
    const text = [group.phone,...(group.uploaded_rows || []).map(row => `${row.uploaded_name} ${row.source_sr_no}`),
      ...(group.existing_profiles || []).map(row => `${row.existing_name} ${row.candidate_id}`)].join(' ').toLowerCase();
    return text.includes(reviewSearch.trim().toLowerCase());
  }), [reviewAnalysis,reviewSearch]);
  const reviewEntries = useMemo(()=>filteredReviewGroups.flatMap(group=>(group.uploaded_rows || []).map(uploaded=>({group,uploaded}))),[filteredReviewGroups]);
  const reviewPages = Math.max(1,Math.ceil(reviewEntries.length / 50));
  const allReviewMatchesSelected = reviewEntries.length>0 && reviewEntries.every(({uploaded})=>reviewSelectedIds.includes(uploaded.upload_row_id));
  const selectedOutsideTeam = reviewEntries.some(({group,uploaded})=>reviewSelectedIds.includes(uploaded.upload_row_id) && (group.existing_profiles || []).some(row=>row.restricted));
  const previewPages = Math.max(1,Math.ceil(importRows.length / 50));
  function selectReviewRow(rowId, event) {
    if (importBusy || reviewBusy) return;
    const order = reviewEntries.map(({ uploaded }) => uploaded.upload_row_id);
    const shiftKey = Boolean(event?.shiftKey || event?.nativeEvent?.shiftKey);
    const checked = event?.target?.checked;
    const anchorId = reviewSelectionAnchorRef.current;
    setReviewSelectedIds(current => updateRowSelection(current, order, rowId, { checked, shiftKey, anchorId }));
    if (!shiftKey || !order.includes(anchorId)) reviewSelectionAnchorRef.current = rowId;
    setReviewBulkAction('');
  }
  function selectReviewMatches(checked = true) {
    reviewSelectionAnchorRef.current = null;
    setReviewBulkAction('');
    const ids = reviewEntries.map(({ uploaded }) => uploaded.upload_row_id);
    setReviewSelectedIds(current => checked ? [...new Set([...current, ...ids])] : current.filter(id => !ids.includes(id)));
  }
  function clearReviewSelection() {
    reviewSelectionAnchorRef.current = null;
    setReviewSelectedIds([]);
    setReviewBulkAction('');
  }
  function selectPreviewRow(rowId, event) {
    if (importBusy || reviewBusy) return;
    const order = importRows.map(row => row._upload_row_id);
    const shiftKey = Boolean(event?.shiftKey || event?.nativeEvent?.shiftKey);
    const checked = event?.target?.checked;
    const anchorId = previewSelectionAnchorRef.current;
    setReviewChoices(current => {
      const included = order.filter(id => !['skip', 'keep_old', 'remove'].includes(current[id]?.action));
      const selected = new Set(updateRowSelection(included, order, rowId, { checked, shiftKey, anchorId }));
      const previouslyIncluded = new Set(included);
      const next = { ...current };
      for (const id of order) if (selected.has(id) !== previouslyIncluded.has(id)) next[id] = { action: selected.has(id) ? 'keep_both' : 'skip' };
      return next;
    });
    if (!shiftKey || !order.includes(anchorId)) previewSelectionAnchorRef.current = rowId;
    setReviewBulkAction('');
  }
  function previewOwner(row) {
    const range = assignmentRanges.find(item => Number(row.source_sr_no) >= Number(item.from) && Number(row.source_sr_no) <= Number(item.to));
    const sheetUser = assignableUsers.find(item => String(item.recruiter_code || '').toLowerCase() === String(row.recruiter_code || row.employee_code || '').toLowerCase());
    const id = range?.user_id || (!replaceRecruiterFromSheet ? sheetUser?.user_id : '') || assigneeUserId;
    return assignableUsers.find(item => String(item.user_id) === String(id))?.full_name || 'You / sheet mapping';
  }
  const assignmentPreview = useMemo(() => {
    const counts = {};
    for (const row of importRows) if (!['skip','keep_old','remove'].includes(reviewChoices[row._upload_row_id]?.action)) {
      const name = previewOwner(row); counts[name]=(counts[name] || 0)+1;
    }
    return counts;
  }, [importRows,assignmentRanges,assigneeUserId,replaceRecruiterFromSheet,assignableUsers,reviewChoices]);
  function chooseReviewAction(group, row, action) {
    setReviewBulkAction('');
    setReviewChoices(current => {
      const next = {...current,[row.upload_row_id]:{action}};
      if(action==='keep_old' && !group.existing_count) {
        for(const other of group.uploaded_rows || []) next[other.upload_row_id]={action:other.upload_row_id===group.uploaded_rows[0]?.upload_row_id ? 'keep_both' : 'skip'};
      }
      if (action === 'keep_new') for (const other of group.uploaded_rows || []) {
        if (other.upload_row_id !== row.upload_row_id) next[other.upload_row_id]={action:'skip'};
      }
      return next;
    });
  }
  function keepExistingOrFirst() {
    setReviewBulkAction('keep_existing');
    setReviewChoices(current => {
      const next = {...current};
      for (const group of reviewAnalysis?.duplicate_groups || []) (group.uploaded_rows || []).forEach((row,index) => {
        next[row.upload_row_id]={action:group.existing_count ? 'keep_old' : index ? 'skip' : 'keep_both'};
      });
      return next;
    });
  }

  function applyBulkReview(action) {
    const selected = new Set(reviewSelectedIds);
    if (!selected.size) return;
    setReviewBulkAction(action);
    setReviewChoices(current => {
      const next={...current};
      for (const group of reviewAnalysis?.duplicate_groups || []) {
        const chosen=(group.uploaded_rows || []).filter(row=>selected.has(row.upload_row_id));
        if(!chosen.length)continue;
        if(action==='keep_new') {
          if((group.existing_profiles || []).some(row=>row.restricted))continue;
          for(const row of group.uploaded_rows || [])next[row.upload_row_id]={action:row.upload_row_id===chosen[0].upload_row_id ? 'keep_new' : 'skip'};
        } else if(action==='keep_old' && !group.existing_count) {
          for(const row of group.uploaded_rows || [])next[row.upload_row_id]={action:row.upload_row_id===group.uploaded_rows[0].upload_row_id ? 'keep_both' : 'skip'};
        } else for(const row of chosen)next[row.upload_row_id]={action};
      }
      return next;
    });
  }
  async function saveAriaTiming() {
    const minute=value=>{if(!/^\d{2}:(00|30)$/.test(value))return NaN;const [hour,min]=value.split(':').map(Number);return hour<24 ? hour*60+min : NaN;};
    if(!Number.isFinite(minute(ariaTiming.start)) || !Number.isFinite(minute(ariaTiming.end)) || minute(ariaTiming.end)-minute(ariaTiming.start)<30) {setMessage('Choose half-hour times with end at least 30 minutes after start.');return;}
    setAriaBusy(true);
    try {const data=await api.post('/api/admin/lock-settings',{aria_report_start_time:ariaTiming.start,aria_report_end_time:ariaTiming.end});setLockSettings(data.lock_settings || lockSettings);setMessage('ARIA schedule saved.');}
    catch(error){setMessage(error.message || 'Schedule could not be saved.');}
    finally{setAriaBusy(false);}
  }

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
    const parsed = prepareUploadRows(parseGridText(textValue).map(normalizeImportedRow));
    resetUploadReview();
    setImportRows(parsed);
      setAssignmentRanges([]);
    setLastImportDuplicateCount(0);
    if (!parsed.length) setMessage('Valid rows were not detected in the pasted sheet.');
    else setMessage(`${parsed.length} candidate rows detected. Ready to load into CRM. Review duplicate phones and choose which rows to import.`);
  }

  async function onFilePicked(event) {
    const file = event.target.files?.[0];
    if (!file || importBusy || reviewBusy) return;
    try {
      setImportMode('file');
      setImportFileName(file.name || 'Selected sheet');
      setTransferState({ active: true, kind: 'upload', label: file.name || 'Selected sheet', progress: 8, detail: 'Reading sheet file...' });
      const lowerName = String(file.name || '').toLowerCase();
      let parsed = [];
      if (lowerName.endsWith('.xlsx')) {
        const entries=await unzipEntries(await file.arrayBuffer());const backupBytes=entries.get?.('career-crox/candidate-backup.json')||entries['career-crox/candidate-backup.json'];
        if(backupBytes){const workbook=JSON.parse(await readZipText(entries,'career-crox/candidate-backup.json'));const password=window.prompt('Enter your manager login password to restore this candidate backup.');if(!password)throw Error('Restore cancelled.');const grant=await api.post('/api/auth/export-access',{password,route_key:'data-backup/restore'},{retries:0});const result=await api.post('/api/data-backup/restore-candidates',{workbook},{headers:{'X-Export-Token':grant.export_token},retries:0,timeoutMs:120000,allowStale:false});setMessage('Restored '+(result.counts?.candidates||0)+' candidates with interviews, approvals, notes and submissions.');setTransferState({active:false});event.target.value='';return;}
        parsed = (await parseXlsxRows(file)).map(normalizeImportedRow);
        setImportText('');
      } else if (lowerName.endsWith('.xls') || lowerName.endsWith('.csv') || lowerName.endsWith('.txt')) {
        if (lowerName.endsWith('.xls')) {
          const signature = new Uint8Array(await file.slice(0,8).arrayBuffer());
          if (signature[0] === 0xd0 && signature[1] === 0xcf)
            throw new Error('This is a legacy binary XLS file. Save it as XLSX or CSV in Excel, then choose that file.');
        }
        const textValue = await file.text();
        setImportText(textValue);
        parsed = parseExcelLikeText(textValue).map(normalizeImportedRow);
      } else {
        throw new Error('Upload .xlsx, .xls, or CSV file.');
      }
      parsed = prepareUploadRows(parsed);
      setUploadKind(parsed.some(row=>row.upload_mode==='external_completed' || String(row.submit_for_approval).toLowerCase()==='yes')?'external_completed':'draft');
      if (parsed.length > 5000) throw new Error('Choose up to 5,000 rows per upload.');
      resetUploadReview();
      setImportRows(parsed);
      setAssignmentRanges([]);
          setLastImportDuplicateCount(0);
      setTransferState({ active: false, kind: 'upload', label: file.name || 'Selected sheet', progress: 100, detail: parsed.length ? `${parsed.length} rows ready for CRM upload.` : 'Sheet loaded but no usable rows were detected.' });
      setMessage(parsed.length ? `${parsed.length} candidate rows loaded from ${file.name}. Review duplicates, assign serial-number ranges, then upload.` : 'No usable candidate rows were detected. Use the Candidate Data sheet and keep the first-row headers unchanged.');
    } catch (error) {
      setImportRows([]);
          setTransferState({ active: false, kind: 'upload', label: file.name || 'Selected sheet', progress: 0, detail: error.message || 'File read failed.' });
      setMessage(error.message || 'File read failed.');
    } finally {
      event.target.value = '';
    }
  }



  async function reviewUpload(open = true) {
    if (!importRows.length || reviewBusy || reviewLockRef.current) return null;
    if (reviewAnalysis) { if (open) setReviewOpen(true); return reviewAnalysis; }
    reviewLockRef.current = true;
    setReviewBusy(true);
    try {
      const result = await api.post('/api/admin/analyze-candidate-upload', { rows: importRows,
        assignee_user_id: assigneeUserId, data_notes: importDataNotes,
        data_uploading_date: importUploadingDate || localToday() }, { timeoutMs: 30000, retries: 0 });
      if (!result?.review_token || result?.workflow_version !== 'candidate-upload-v1' || result?.workflow_release !== 'CC804')
        throw new Error('Deploy the matching CC804 backend before reviewing this upload. Your file is kept.');
      setReviewAnalysis(result);
      const defaults = {};
      for (const group of result.duplicate_groups || []) for (const row of group.uploaded_rows || []) defaults[row.upload_row_id] = { action: 'keep_both' };
      setReviewChoices(current => ({...defaults,...current}));
      if (open) setReviewOpen(true);
      return result;
    } catch (error) { setMessage(error.message || 'Duplicate review failed. Retry review.'); return null; }
    finally { reviewLockRef.current = false; setReviewBusy(false); }
  }

  async function runImport(reviewConfirmed = false) {
    if (importLockRef.current) return;
    importLockRef.current = true;
    try { return await commitCandidateImport(reviewConfirmed); }
    finally { importLockRef.current = false; }
  }

  async function commitCandidateImport(reviewConfirmed = false) {
    if (!importRows.length) {
      const msg = 'Paste or load candidate rows first.';
      setMessage(msg);
      window.alert(msg);
      return;
    }

    if (importBusy || reviewBusy) return;
    let analysis = reviewAnalysis;
    if (!analysis) {
      analysis = await reviewUpload(false);
      if (!analysis) return;
    }
    if ((analysis.duplicate_groups || []).length && reviewConfirmed !== true) { setReviewOpen(true); return; }
    for (const range of assignmentRanges) {
      if (!range.user_id || !Number.isInteger(Number(range.from)) || !Number.isInteger(Number(range.to)) || Number(range.from) < 1 || Number(range.to) < Number(range.from)) {
        setMessage('Choose a recruiter and valid From / To serial numbers for every range.'); return;
      }
    }
    for (let i = 0; i < assignmentRanges.length; i++) for (let j = i + 1; j < assignmentRanges.length; j++) {
      if (Number(assignmentRanges[i].from) <= Number(assignmentRanges[j].to) && Number(assignmentRanges[j].from) <= Number(assignmentRanges[i].to)) {
        setMessage('Assignment ranges overlap. Each serial number needs one recruiter.'); return;
      }
    }
    setReviewOpen(false);
    setImportBusy(true);
    setMessage('');
    setLastImportDuplicateCount(0);
    setTransferState({
      active: true,
      kind: 'upload',
      label: importFileName || 'Candidate sheet upload',
      progress: 8,
      detail: 'Saving reviewed rows and recruiter ranges…',
    });

    try {
      const uploadChoices = { ...reviewChoices };
      for (const group of analysis.duplicate_groups || []) {
        for (const row of group.uploaded_rows || []) {
          const choice = uploadChoices[row.upload_row_id] || { action: 'keep_both' };
          uploadChoices[row.upload_row_id] = { ...choice,
            replace_ids: choice.action === 'keep_new' ? (group.existing_profiles || []).map(item => item.candidate_id) : [],
            versions: Object.fromEntries((group.existing_profiles || []).map(item => [item.candidate_id, item.updated_at || ''])) };
        }
      }
      const body = { rows: importRows, upload_kind:uploadKind, assignee_user_id: assigneeUserId,
        replace_recruiter_from_sheet: replaceRecruiterFromSheet, assignment_ranges: assignmentRanges,
        upload_choices: uploadChoices, data_notes: importDataNotes,
        data_uploading_date: importUploadingDate || localToday(), file_name: importFileName || '',
        sheet_name: importFileName ? 'Uploaded Sheet' : '', review_token:analysis.review_token, workflow_release:'CC804' };
      const signature = JSON.stringify(body);
      if (importCommandRef.current?.signature !== signature) importCommandRef.current = { signature, id: crypto.randomUUID() };
      importProgressRef.current = window.setInterval(() => setTransferState(current => current.active
        ? { ...current, progress: Math.min(90, current.progress + Math.max(1, (90 - current.progress) / 8)) } : current), 600);
      const data = await api.post('/api/admin/import-candidates', { ...body, command_id: importCommandRef.current.id },
        { cacheTtlMs: 0, timeoutMs: 120000, retries: 0 });
      window.clearInterval(importProgressRef.current);
      if (data?.ok !== true || data?.committed !== true || data?.workflow_version !== 'candidate-upload-v1'
        || data?.workflow_release !== 'CC804' || data?.command_id !== importCommandRef.current.id)
        throw new Error('Upload was not confirmed by the matching server. Your file and choices are kept; retry the same upload.');

      const summary = data?.summary || {};
      const processed = Number(data?.inserted_count || 0);
      const duplicateCount = Number(summary.duplicates || 0) + Number(summary.replaced || 0);
      setLastImportDuplicateCount(duplicateCount);
      setTransferState({
        active: false,
        kind: 'upload',
        label: importFileName || 'Candidate sheet upload',
        progress: 100,
        detail: duplicateCount
          ? `Upload completed. ${duplicateCount} duplicate/replaced profile(s) are ready in Duplicate Profiles.`
          : 'CRM import completed successfully.',
      });

      const doneMessage = `${processed} rows processed. Pending approval: ${data.submitted_count || 0}. Added: ${summary.inserted || 0}, Updated: ${summary.updated || 0}, Duplicate Review: ${summary.duplicates || 0}, Replaced/Review: ${summary.replaced || 0}, Skipped: ${summary.skipped || 0}.`;
      setMessage(duplicateCount
        ? `${doneMessage} Open Duplicate Review: keep both, remove the unwanted profile, or choose Main.`
        : `${doneMessage} No duplicate review is pending from this upload.`);
      setMessage(`${doneMessage} ${Object.entries(data.assigned_counts || {}).map(([name, count]) => `${name}: ${count}`).join(' · ')}`);

      setImportText('');
      setImportRows([]);
      setImportDataNotes('');
      setImportUploadingDate(localToday());
      setImportFileName('');
      setAssignmentRanges([]);
      resetUploadReview();
      if (data.upload_history) setBulkUploadHistory(current => [data.upload_history, ...current]);
    } catch (err) {
      setTransferState({ active: false, kind: 'upload', label: importFileName || 'Candidate sheet upload', progress: 0, detail: err?.message || 'Import failed.' });
      const failMessage = err?.message || 'Import failed. Please retry.';
      setMessage(failMessage);
      if (err?.code === 'UPLOAD_REVIEW_CHANGED') { resetUploadReview(); setReviewBusy(false); }
    } finally {
      window.clearInterval(importProgressRef.current);
      setImportBusy(false);
    }
  }

  function openDuplicateReview() {
    window.open('/duplicate-profiles?from_upload=1', '_blank', 'noopener,noreferrer');
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
        const entries=await unzipEntries(await file.arrayBuffer());const backupBytes=entries.get?.('career-crox/candidate-backup.json')||entries['career-crox/candidate-backup.json'];
        if(backupBytes){const workbook=JSON.parse(await readZipText(entries,'career-crox/candidate-backup.json'));const password=window.prompt('Enter your manager login password to restore this candidate backup.');if(!password)throw Error('Restore cancelled.');const grant=await api.post('/api/auth/export-access',{password,route_key:'data-backup/restore'},{retries:0});const result=await api.post('/api/data-backup/restore-candidates',{workbook},{headers:{'X-Export-Token':grant.export_token},retries:0,timeoutMs:120000,allowStale:false});setMessage('Restored '+(result.counts?.candidates||0)+' candidates with interviews, approvals, notes and submissions.');setTransferState({active:false});event.target.value='';return;}
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
    if (!hotLeadRows.length) {setMessage('Choose a Hot Leads sheet first.');return;}
    resetUploadReview();
    setImportRows(prepareUploadRows(hotLeadRows.map(normalizeImportedRow)));
    setImportFileName(hotLeadFileName);
    setUploadKind(hotLeadRows.some(row=>row.upload_mode==='external_completed' || String(row.submit_for_approval).toLowerCase()==='yes')?'external_completed':'hot_lead');
    setAssignmentRanges([]);setActiveAdminSlice('bulk');
    setMessage('Hot Leads are ready. Assign a recruiter, review duplicates, then upload.');
  }


  return (
    <Layout title="Admin Control" subtitle="">
      <div className="cc801-admin-workspace" data-cc804-controls="admin"><div className="cc814-toolbar"><Link className="add-profile-btn" to="/data-backup">↓ Candidate Excel backup</Link><Link className="ghost-btn" to="/data-backup">↓ Complete database backup</Link></div>
      <details className="cc801-aria-schedule">
        <summary><span className="cc801-aria-mark">A</span><strong>ARIA schedule</strong><span>{formatCrmClock(ariaTiming.start)} – {formatCrmClock(ariaTiming.end)} IST</span><span className="cc801-aria-edit">Edit schedule</span></summary>
        <div className="cc801-aria-controls"><label>Start · IST<CrmDateTimeInput type="time" step="1800" value={ariaTiming.start} disabled={ariaBusy} onChange={event=>setAriaTiming(current=>({...current,start:event.target.value}))} /></label>
          <label>End · IST<CrmDateTimeInput type="time" step="1800" value={ariaTiming.end} disabled={ariaBusy} onChange={event=>setAriaTiming(current=>({...current,end:event.target.value}))} /></label>
          <button type="button" className="add-profile-btn" disabled={ariaBusy} onClick={saveAriaTiming}>{ariaBusy ? 'Saving…' : 'Save schedule'}</button><span className="helper-text">Reports every 30 minutes.</span></div>
      </details>
      {!!message && <div className="panel top-gap-small"><div className="helper-text">{message}</div></div>}

      <div className="panel top-gap">
        <div className="table-toolbar no-border">
          <div>
            <div className="table-title">Admin workspace</div>
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
            <div className="table-title">Career Crox · Earlier signed APK</div>
            <div className="helper-text">Download the existing signed app. The CC806 update must be built from the included Android source.</div>
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
            <div className="field"><label>Login Time</label><CrmDateTimeInput type="time" value={lockSettings.attendance_shift_login_time || ''} onChange={(e) => setLockSettings({ ...lockSettings, attendance_shift_login_time: e.target.value })} /></div>
            <div className="field"><label>Logout Time</label><CrmDateTimeInput type="time" value={lockSettings.attendance_shift_logout_time || ''} onChange={(e) => setLockSettings({ ...lockSettings, attendance_shift_logout_time: e.target.value })} /></div>
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
        <div className="panel admin-import-panel cc60-import-panel">
          <div className="table-toolbar no-border">
            <div>
              <div className="table-title">Bulk Candidate Load</div>
              <div className="helper-text">1. Choose a file → 2. Assign rows and review duplicates → 3. Upload. Profiles are saved as drafts; Save & Submit starts approval separately.</div>
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
              <select className="inline-input compact-inline-input" value={assigneeUserId} disabled={importBusy || reviewBusy} onChange={(e) => setAssigneeUserId(e.target.value)}>
                <option value="">Sheet mapping / your account</option>
                {assignableUsers.map((user) => (
                  <option key={user.user_id} value={user.user_id}>{user.full_name} • {user.recruiter_code || user.role}</option>
                ))}
              </select>
            </label>
            <label className="compact-select-shell shell-green admin-toggle-shell">
              <span className="compact-shell-label">Recruiter Mapping</span>
              <select className="inline-input compact-inline-input" value={replaceRecruiterFromSheet ? 'force' : 'sheet'} disabled={importBusy || reviewBusy} onChange={(e) => setReplaceRecruiterFromSheet(e.target.value === 'force')}>
                <option value="sheet">Use sheet values first</option>
                <option value="force">Force selected assignee</option>
              </select>
            </label>
          </div>

          <section className="cc56-assignment-box top-gap-small">
            <div className="table-toolbar no-border"><div><strong>Assign by serial-number range</strong><div className="helper-text">Uncovered rows use the default assignee or sheet mapping.</div></div>
              <button type="button" className="mini-btn view" disabled={importBusy || reviewBusy} onClick={() => setAssignmentRanges(current => [...current, { from: current.length ? Number(current[current.length - 1].to || 0) + 1 : 1, to: '', user_id: '' }])}>+ Add range</button></div>
            {assignmentRanges.map((range, index) => <div key={index} className="cc56-range-assignee">
              <label>From serial<input type="number" min="1" value={range.from} disabled={importBusy || reviewBusy} onChange={event => setAssignmentRanges(current => current.map((item, i) => i === index ? { ...item, from: event.target.value } : item))} /></label>
              <label>To serial<input type="number" min={range.from || 1} value={range.to} disabled={importBusy || reviewBusy} onChange={event => setAssignmentRanges(current => current.map((item, i) => i === index ? { ...item, to: event.target.value } : item))} /></label>
              <label>Recruiter<select value={range.user_id} disabled={importBusy || reviewBusy} onChange={event => setAssignmentRanges(current => current.map((item, i) => i === index ? { ...item, user_id: event.target.value } : item))}><option value="">Choose recruiter</option>{assignableUsers.map(user => <option key={user.user_id} value={user.user_id}>{user.full_name}</option>)}</select></label>
              <button type="button" className="ghost-btn" disabled={importBusy || reviewBusy} onClick={() => setAssignmentRanges(current => current.filter((_, i) => i !== index))}>Remove</button>
            </div>)}
          </section>

          <div className="top-gap-small admin-file-box">
              <input ref={fileInputRef} id="admin-sheet-upload" type="file" disabled={importBusy || reviewBusy} hidden accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel" onChange={onFilePicked} />
              <div className="row-actions" style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <label htmlFor="admin-sheet-upload" className="ghost-btn bounceable" style={{ cursor: 'pointer' }}>Choose Sheet</label>
                <div className="helper-text" style={{ minWidth: 220 }}>{importFileName || 'No file chosen yet.'}</div>
              </div>
              {renderTransferBar(transferState)}
              <div className="candidate-form-grid candidate-compact-grid top-gap-small">
                <div className="field"><label>Data Uploading Date</label><input type="date" value={importUploadingDate} disabled={importBusy || reviewBusy} onChange={(e) => setImportUploadingDate(e.target.value || localToday())} /></div>
                <div className="field"><label>Data Notes</label><input value={importDataNotes} disabled={importBusy || reviewBusy} onChange={(e) => setImportDataNotes(e.target.value)} placeholder="Optional note for all uploaded profiles" /></div>
              </div>
              <label className="field top-gap-small"><span>Upload workflow</span><select aria-label="Upload workflow" value={uploadKind} disabled={importBusy || reviewBusy} onChange={event=>{setUploadKind(event.target.value);importCommandRef.current=null;}}><option value="draft">Draft profiles</option><option value="hot_lead">Hot Leads · draft</option><option value="external_completed">Completed Excel · Hot Leads + pending approval</option></select></label>
              <div className="helper-text top-gap-small">Upload XLSX, XLS, or CSV. Data Uploading Date is today by default. Duplicate review opens before matching rows are imported.</div>
            </div>

          <div className="top-gap-small admin-preview-box cc60-upload-preview">
            <div className="cc60-preview-head"><strong>{importRows.length} rows ready</strong><span>{Object.entries(assignmentPreview).map(([name,count]) => `${name}: ${count}`).join(' · ')}</span></div>
            {importRows.length ? <>
              <div className="crm-table-wrap dense-wrap top-gap-small"><table className="crm-table colorful-table dense-table">
                <thead><tr><th>Use</th><th>Serial</th><th>Name</th><th>Number</th><th>Location</th><th>Assigned to</th><th>Data notes</th></tr></thead>
                <tbody>{importRows.slice((Math.min(previewPage,previewPages)-1)*50,Math.min(previewPage,previewPages)*50).map(row => {
                  const excluded=['skip','keep_old','remove'].includes(reviewChoices[row._upload_row_id]?.action);
                  return <tr key={row._upload_row_id} className={excluded ? 'cc60-row-excluded' : 'cc60-row-selected'}>
                    <td><input type="checkbox" aria-label={`Include serial ${row.source_sr_no}`} title="Shift-click another checkbox to include or exclude a range" checked={!excluded} disabled={importBusy || reviewBusy} onChange={event => selectPreviewRow(row._upload_row_id, event)} /></td>
                    <td>{row.source_sr_no}</td><td>{row.full_name || '-'}</td><td>{row.phone || '-'}</td><td>{row.location || '-'}</td><td>{previewOwner(row)}</td><td>{[row.data_notes,importDataNotes].filter(Boolean).join(' · ') || '-'}</td>
                  </tr>;
                })}</tbody>
              </table></div>
              <div className="cc60-review-page top-gap-small"><button type="button" className="ghost-btn" disabled={previewPage <= 1} onClick={() => setPreviewPage(page => page-1)}>Previous</button><span>{Math.min(previewPage,previewPages)} / {previewPages}</span><button type="button" className="ghost-btn" disabled={previewPage >= previewPages} onClick={() => setPreviewPage(page => page+1)}>Next</button></div>
            </> : null}
            <div className="row-actions top-gap-small">
              <button className="add-profile-btn bounceable" type="button" disabled={!importRows.length || importBusy || reviewBusy} onClick={() => runImport(false)}>{importBusy ? 'Uploading…' : 'Upload reviewed rows'}</button>
              <button className="mini-btn view bounceable" type="button" disabled={!importRows.length || importBusy || reviewBusy} onClick={() => reviewUpload(true)}>{reviewBusy ? 'Checking…' : 'Review duplicates'}</button>
              <button className="mini-btn view bounceable" type="button" disabled={importBusy || reviewBusy} onClick={openDuplicateReview}>Duplicate profiles{lastImportDuplicateCount ? ` (${lastImportDuplicateCount})` : ''}</button>
            </div>
            {message ? <div className="helper-text top-gap-small" role="status">{message}</div> : null}
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
            <select className="inline-input compact-inline-input" value={assigneeUserId} disabled={importBusy || reviewBusy} onChange={(e) => setAssigneeUserId(e.target.value)}>
              <option value="">Keep unassigned / sheet mapping</option>
              {assignableUsers.map((user) => (
                <option key={user.user_id} value={user.user_id}>{user.full_name} • {user.recruiter_code || user.role}</option>
              ))}
            </select>
          </label>
          <label className="compact-select-shell shell-green admin-toggle-shell">
            <span className="compact-shell-label">Recruiter Mapping</span>
            <select className="inline-input compact-inline-input" value={replaceRecruiterFromSheet ? 'force' : 'sheet'} disabled={importBusy || reviewBusy} onChange={(e) => setReplaceRecruiterFromSheet(e.target.value === 'force')}>
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
        <div className="crm-table-wrap dense-wrap"><table className="crm-table colorful-table dense-table"><thead><tr><th>Uploaded at</th><th>Data date</th><th>Type</th><th>Uploaded Rows</th><th>Added</th><th>Updated</th><th>Duplicate</th><th>Skipped</th><th>Data Notes Applied</th><th>Data Notes</th><th>Uploaded By</th><th>File</th></tr></thead><tbody>{(bulkUploadHistory || []).map((row) => <tr key={row.upload_id || `${row.created_at}-${row.file_name}`}><td>{formatUploadTime(row.created_at)}</td><td>{row.data_uploading_date || '-'}</td><td>{row.upload_type || 'Bulk Upload'}</td><td>{row.uploaded_rows || 0}</td><td>{row.added_count || 0}</td><td>{row.updated_count || 0}</td><td>{row.duplicate_count || 0}</td><td>{row.skipped_count || 0}</td><td>{row.data_notes_applied_count || 0}</td><td>{row.data_notes || '-'}</td><td>{row.uploaded_by_name || row.uploaded_by_code || '-'}</td><td>{row.file_name || '-'}</td></tr>)}{!(bulkUploadHistory || []).length && <tr><td colSpan="12" className="helper-text">Import history will appear here.</td></tr>}</tbody></table></div>
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
      {reviewOpen && reviewAnalysis && typeof document !== 'undefined' ? createPortal(
        <div className="crm-modal-backdrop cc56-upload-review-backdrop cc60-review-backdrop" onClick={()=>!importBusy && setReviewOpen(false)}>
          <section className="panel cc56-upload-review cc60-upload-review cc801-review-table-dialog" data-cc804-controls="duplicate-review" role="dialog" aria-modal="true" aria-label="Review uploaded candidates" onClick={event=>event.stopPropagation()}>
            <div className="cc56-review-head"><div><div className="panel-title">Duplicate review</div><div className="helper-text">{importRows.length} file rows · {reviewAnalysis.duplicate_groups?.length || 0} duplicate sets · {reviewAnalysis.summary?.skipped || 0} invalid</div></div><button type="button" className="ghost-btn cc801-action-neutral" disabled={importBusy || reviewBusy} onClick={()=>setReviewOpen(false)}>Close</button></div>
            <div className="cc60-review-tools cc801-review-tools">
              <input className="inline-input" autoFocus aria-label="Search duplicate review" placeholder="Search name, phone, serial or CRM ID" value={reviewSearch} onChange={event=>{setReviewSearch(event.target.value);setReviewPage(1);reviewSelectionAnchorRef.current=null;setReviewBulkAction('');}} />
              <label className="cc801-select-all"><input type="checkbox" checked={allReviewMatchesSelected} disabled={importBusy || reviewBusy || !reviewEntries.length} ref={node=>{if(node)node.indeterminate=!allReviewMatchesSelected && reviewEntries.some(({uploaded})=>reviewSelectedIds.includes(uploaded.upload_row_id));}} onChange={event=>selectReviewMatches(event.target.checked)} /> Select all matches</label>
              <button type="button" className="cc801-action-both" disabled={!reviewEntries.length || importBusy || reviewBusy} onClick={()=>selectReviewMatches()}>Select All</button><span className="cc805-selection-count" aria-live="polite">{reviewSelectedIds.length} selected</span><button type="button" className="cc801-action-neutral" disabled={!reviewSelectedIds.length || importBusy || reviewBusy} onClick={clearReviewSelection}>Clear selection</button>
            </div>
            <div className="cc801-review-bulk" role="group" aria-label="Actions on selected rows">
              <span>Selected rows</span><button type="button" className={`cc801-action-old ${reviewBulkAction==='keep_old' ? 'is-active' : ''}`} aria-pressed={reviewBulkAction==='keep_old'} title="Apply to selected rows; highlighted when last applied" disabled={!reviewSelectedIds.length || importBusy || reviewBusy} onClick={()=>applyBulkReview('keep_old')}>Keep old / first</button>
              <button type="button" className={`cc801-action-new ${reviewBulkAction==='keep_new' ? 'is-active' : ''}`} aria-pressed={reviewBulkAction==='keep_new'} title="Keep the first selected new row for each phone" disabled={!reviewSelectedIds.length || selectedOutsideTeam || importBusy || reviewBusy} onClick={()=>applyBulkReview('keep_new')}>Keep first new per phone</button>
              <button type="button" className={`cc801-action-both ${reviewBulkAction==='keep_both' ? 'is-active' : ''}`} aria-pressed={reviewBulkAction==='keep_both'} disabled={!reviewSelectedIds.length || importBusy || reviewBusy} onClick={()=>applyBulkReview('keep_both')}>Keep both</button>
              <button type="button" className={`cc801-action-skip ${reviewBulkAction==='skip' ? 'is-active' : ''}`} aria-pressed={reviewBulkAction==='skip'} disabled={!reviewSelectedIds.length || importBusy || reviewBusy} onClick={()=>applyBulkReview('skip')}>Skip selected</button>
              <button type="button" className={`cc801-action-old ${reviewBulkAction==='keep_existing' ? 'is-active' : ''}`} aria-pressed={reviewBulkAction==='keep_existing'} disabled={importBusy || reviewBusy} onClick={keepExistingOrFirst}>Keep CRM / first file row</button>
            </div>
            <div className="cc56-review-body cc801-review-table-wrap">
              <table className="cc801-review-table"><thead><tr><th><input type="checkbox" aria-label="Select all duplicate review rows" checked={allReviewMatchesSelected} disabled={importBusy || reviewBusy || !reviewEntries.length} ref={node=>{if(node)node.indeterminate=!allReviewMatchesSelected && reviewEntries.some(({uploaded})=>reviewSelectedIds.includes(uploaded.upload_row_id));}} onChange={event=>selectReviewMatches(event.target.checked)} /></th><th>Serial · Phone</th><th>Existing CRM</th><th>Uploaded file</th><th>Old</th><th>New</th><th>Both</th><th>Skip</th></tr></thead><tbody>
                {reviewEntries.slice((Math.min(reviewPage,reviewPages)-1)*50,Math.min(reviewPage,reviewPages)*50).map(({group,uploaded})=>{
                  const action=reviewChoices[uploaded.upload_row_id]?.action || 'keep_both';const selected=reviewSelectedIds.includes(uploaded.upload_row_id);const existing=group.existing_profiles || [];
                  return <tr key={uploaded.upload_row_id} aria-selected={selected} data-review-action={action} className={`choice-${action} ${selected ? 'cc801-selected-row' : ''}`}>
                    <td><input type="checkbox" aria-label={`Select serial ${uploaded.source_sr_no || uploaded.row_number}`} title="Shift-click another checkbox to select or clear the rows between" checked={selected} disabled={importBusy || reviewBusy} onChange={event=>selectReviewRow(uploaded.upload_row_id,event)} /></td>
                    <td><strong>#{uploaded.source_sr_no || uploaded.row_number}</strong><span>{group.phone}</span></td>
                    <td>{existing.length ? existing.map(row=><div key={row.candidate_id}><strong>{row.candidate_id} · {row.existing_name}</strong><span title={[row.location,row.recruiter_name,row.process,row.data_notes].filter(Boolean).join(' · ')}>{[row.location,row.recruiter_name,row.process].filter(Boolean).join(' · ')}</span></div>) : <span>File duplicate</span>}</td>
                    <td><strong>{uploaded.uploaded_name}</strong><span title={[uploaded.location,uploaded.qualification,uploaded.communication_skill].filter(Boolean).join(' · ')}>{[uploaded.location,uploaded.qualification].filter(Boolean).join(' · ')}</span></td>
                    {[['keep_old','old','Old'],['keep_new','new','New'],['keep_both','both','Both'],['skip','skip','Skip']].map(([value,tone,label])=><td key={value}><button type="button" className={`cc801-choice cc801-action-${tone} ${action===value ? 'is-active' : ''}`} aria-label={`${label} serial ${uploaded.source_sr_no || uploaded.row_number}`} aria-pressed={action===value} disabled={importBusy || reviewBusy || (value==='keep_new' && existing.some(row=>row.restricted))} onClick={()=>chooseReviewAction(group,uploaded,value)}>{label}</button></td>)}
                  </tr>;
                })}
              </tbody></table>
              {!reviewEntries.length ? <div className="cc56-review-clear">{reviewSearch ? 'No duplicates match this search.' : 'No duplicates found. Ready to upload.'}</div> : null}
              {(reviewAnalysis.skipped || []).length ? <details className="cc60-invalid-rows"><summary>{reviewAnalysis.skipped.length} invalid rows will be skipped</summary>{reviewAnalysis.skipped.map(row=><div key={row.upload_row_id}>#{row.row_number} · {row.name || 'Missing name'} · {row.reason}</div>)}</details> : null}
            </div>
            <div className="cc56-review-footer"><div className="cc60-review-page"><button type="button" className="cc801-action-prev" disabled={reviewPage<=1 || importBusy} onClick={()=>setReviewPage(page=>page-1)}>Previous</button><span>{Math.min(reviewPage,reviewPages)} / {reviewPages} · 50 per page · {reviewEntries.length} rows</span><button type="button" className="cc801-action-next" disabled={reviewPage>=reviewPages || importBusy} onClick={()=>setReviewPage(page=>page+1)}>Next</button></div>
              <span>{Object.values(reviewChoices).filter(choice=>['skip','keep_old','remove'].includes(choice.action)).length} excluded</span>
              <button type="button" className="add-profile-btn cc801-confirm-upload" disabled={importBusy || reviewBusy} onClick={()=>runImport(true)}>{importBusy ? 'Uploading…' : 'Confirm & upload'}</button></div>
          </section>
        </div>,document.body) : null}

      </div>
    </Layout>
  );
}
