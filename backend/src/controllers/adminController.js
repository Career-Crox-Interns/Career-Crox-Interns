const { table, store, TABLES, withTransaction, transactionalHandler, callController } = require('../lib/store');
const { authCookie, signUser } = require('../middleware/auth');
const { getSettingsMap, setSettingsMap } = require('../lib/settings');
const { nextId, nowIso, normalizeIndianPhone, calcExperienceRange, calcSalaryRange } = require('../lib/helpers');
const { clearAllCaches } = require('../lib/cache');
const crypto = require('crypto');
const { userRole, visibleCandidateForUser, isAdminOrManager, candidateNotDeletedSql, isDeletedCandidate } = require('../lib/accessRules');
const { RELEASE } = require('../lib/candidateCommand');

function uploadAssignees(users, actor = {}) {
  return users.filter(user => {
    if (!['recruiter','tl','manager','admin'].includes(userRole(user))
      || ['inactive','deleted','disabled','suspended'].includes(lower(user.status))
      || ['0','false','no'].includes(lower(user.is_active))) return false;
    return isAdminOrManager(actor) || (userRole(actor) === 'tl' &&
      [actor.user_id, ...(actor.__ccTeamUserIds || [])].map(String).includes(String(user.user_id)));
  });
}
function preparedUploadRows(input) {
  if (!Array.isArray(input) || !input.length || input.length > 5000)
    throw Object.assign(new Error('Choose a file with 1–5,000 candidate rows.'), {status:400});
  const rows = input.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row))
      throw Object.assign(new Error(`Upload row ${index + 1} is invalid.`), {status:400});
    const normalized = normalizeImportedCandidateRow(row);
    return {...normalized, candidate_id:'', _upload_row_id:String(row._upload_row_id || `UPLOAD-${index + 1}`),
      source_sr_no:firstValue(normalized, ['source_sr_no','serial_no','sr_no']) || String(index + 1)};
  });
  if (new Set(rows.map(row => row._upload_row_id)).size !== rows.length)
    throw Object.assign(new Error('Upload row IDs must be unique. Reload the file.'), {status:400});
  return rows;
}
function canonicalUpload(value) {
  if (Array.isArray(value)) return value.map(canonicalUpload);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalUpload(value[key])]));
  return value;
}
function uploadReviewToken(rows, matches) {
  const versions = matches.map(row => [String(row.candidate_id),String(row.updated_at || ''),String(row.recruiter_code || ''),String(row.recruiter_user_id || '')])
    .sort((a,b) => a[0].localeCompare(b[0]));
  return crypto.createHash('sha256').update(JSON.stringify(canonicalUpload({rows,versions}))).digest('hex');
}
function validateUploadDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return uploadStampLocal();
  const day = raw.slice(0,10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)) || new Date(day).toISOString().slice(0,10) !== day)
    throw Object.assign(new Error('Choose a valid data-upload date.'), {status:400});
  return raw;
}

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function nowLocalDateTime() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function uploadStampLocal() {
  const d = new Date();
  const day = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  return `${day} ${time}`;
}
function excelCalendar(value, withTime = false) {
  const raw = String(value ?? '').trim();
  if (!/^\d{5}(?:\.\d+)?$/.test(raw)) return raw;
  const serial = Number(raw);
  if (serial < 20000 || serial > 80000) return raw;
  const iso = new Date(Date.UTC(1899,11,30) + Math.round(serial*86400000)).toISOString();
  return withTime ? iso.slice(0,19)+'+05:30' : iso.slice(0,10);
}
function cleanImportDateTime(value) {
  const raw = excelCalendar(value, true);
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw)) return raw+'+05:30';
  return raw;
}
function importExperience(payload, kind) {
  const years = firstValue(payload,[kind+'_experience_years']);
  const months = firstValue(payload,[kind+'_experience_months']);
  if (years || months) {
    if (![years || '0',months || '0'].every(v=>/^\d+$/.test(v)) || Number(months || 0)>11)
      throw Object.assign(new Error('Experience needs non-negative whole years and 0–11 months.'),{status:400});
    return String(Number(years || 0)*12+Number(months || 0));
  }
  return firstValue(payload,[kind+'_experience',kind+'_exp',kind==='total'?'experience':'relevant_exp']) || '0';
}
function cleanDateOnly(value) {
  const raw = excelCalendar(value);
  if (!raw) return '';
  const direct = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
}


async function ensureBulkUploadHistoryTable() {
  if (!store.pool) return;
  await store.query(`create table if not exists bulk_upload_history (
    upload_id text primary key,
    upload_type text,
    file_name text,
    sheet_name text,
    uploaded_rows integer default 0,
    added_count integer default 0,
    updated_count integer default 0,
    duplicate_count integer default 0,
    replaced_count integer default 0,
    skipped_count integer default 0,
    data_notes_applied_count integer default 0,
    processed_count integer default 0,
    data_uploading_date text,
    data_notes text,
    assignee_user_id text,
    assignee_name text,
    recruiter_mapping text,
    uploaded_by_user_id text,
    uploaded_by_name text,
    uploaded_by_code text,
    created_at timestamptz default now()
  )`);
  try { await store.query(`alter table bulk_upload_history add column if not exists data_notes_applied_count integer default 0`); } catch {}
  await store.query(`alter table bulk_upload_history add column if not exists data_uploading_date text`);
  await store.query(`create index if not exists bulk_upload_history_created_at_idx on bulk_upload_history (created_at desc)`);
}

function safeInt(value) {
  return Math.max(0, Number(value || 0) || 0);
}

function bulkUploadUserLabel(user = {}) {
  return String(user.full_name || user.name || user.username || user.recruiter_code || user.user_id || '').trim();
}

async function listBulkUploadHistory() {
  try {
    await ensureBulkUploadHistoryTable();
    return (store.pool ? await store.query('select * from public.bulk_upload_history order by created_at desc nulls last limit 100') : await table('bulk_upload_history'))
      .slice()
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      .slice(0, 100)
      .map((row) => ({
        upload_id: String(row.upload_id || '').trim(),
        upload_type: String(row.upload_type || '').trim(),
        file_name: String(row.file_name || '').trim(),
        sheet_name: String(row.sheet_name || '').trim(),
        uploaded_rows: safeInt(row.uploaded_rows),
        added_count: safeInt(row.added_count),
        updated_count: safeInt(row.updated_count),
        duplicate_count: safeInt(row.duplicate_count),
        replaced_count: safeInt(row.replaced_count),
        skipped_count: safeInt(row.skipped_count),
        data_notes_applied_count: safeInt(row.data_notes_applied_count),
        processed_count: safeInt(row.processed_count),
        data_notes: String(row.data_notes || '').trim(),
        data_uploading_date: String(row.data_uploading_date || '').trim(),
        assignee_user_id: String(row.assignee_user_id || '').trim(),
        assignee_name: String(row.assignee_name || '').trim(),
        recruiter_mapping: String(row.recruiter_mapping || '').trim(),
        uploaded_by_user_id: String(row.uploaded_by_user_id || '').trim(),
        uploaded_by_name: String(row.uploaded_by_name || '').trim(),
        uploaded_by_code: String(row.uploaded_by_code || '').trim(),
        created_at: String(row.created_at || '').trim(),
      }));
  } catch (error) {
    console.warn('Bulk upload history load failed:', error.message || error);
    return [];
  }
}

async function recordBulkUploadHistory(req, details = {}, required = false) {
  try {
    if (!required) await ensureBulkUploadHistoryTable();
    const uploadedRows = safeInt(details.uploaded_rows);
    const addedCount = safeInt(details.added_count);
    const updatedCount = safeInt(details.updated_count);
    const duplicateCount = safeInt(details.duplicate_count);
    const replacedCount = safeInt(details.replaced_count);
    const skippedCount = safeInt(details.skipped_count);
    const dataNotesAppliedCount = safeInt(details.data_notes_applied_count);
    const row = {
      upload_id: `UP-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      upload_type: String(details.upload_type || 'Candidate Bulk Upload').trim(),
      file_name: String(details.file_name || req.body?.file_name || '').trim(),
      sheet_name: String(details.sheet_name || req.body?.sheet_name || '').trim(),
      uploaded_rows: uploadedRows,
      added_count: addedCount,
      updated_count: updatedCount,
      duplicate_count: duplicateCount,
      replaced_count: replacedCount,
      skipped_count: skippedCount,
      data_notes_applied_count: dataNotesAppliedCount,
      processed_count: details.processed_count === undefined ? addedCount + updatedCount : safeInt(details.processed_count),
      data_notes: String(details.data_notes || req.body?.data_notes || '').trim(),
      data_uploading_date: String(details.data_uploading_date || req.body?.data_uploading_date || '').trim(),
      assignee_user_id: String(details.assignee_user_id || '').trim(),
      assignee_name: String(details.assignee_name || '').trim(),
      recruiter_mapping: String(details.recruiter_mapping || '').trim(),
      uploaded_by_user_id: String(req.user?.user_id || '').trim(),
      uploaded_by_name: bulkUploadUserLabel(req.user),
      uploaded_by_code: String(req.user?.recruiter_code || req.user?.employee_code || req.user?.username || '').trim(),
      created_at: nowIso(),
    };
    return await store.insert('bulk_upload_history', row);
  } catch (error) {
    if (required) throw error;
    console.warn('Bulk upload history save failed:', error.message || error);
    return null;
  }
}


const SERVER_IMPORT_ALIASES = {
  source_sr_no: ['source_sr_no','serial_no','serial number','serial_number','sr_no','sr no','s_no','s.no','sno','serial'],
  candidate_id: ['candidate_id', 'candidate id', 'profile_id', 'profile id'],
  full_name: ['full_name', 'full name', 'name', 'candidate_name', 'candidate name', 'candidate', 'applicant_name', 'applicant name'],
  phone: ['phone', 'number', 'mobile', 'mobile_no', 'mobile no', 'contact', 'contact_number', 'contact number', 'phone_number', 'phone number'],
  email: ['email', 'mail', 'email_id', 'email id', 'e_mail'],
  location: ['location', 'current_location', 'current location', 'city', 'current_city', 'current city'],
  preferred_location: ['preferred_location', 'preferred location', 'preferred_city', 'preferred city', 'preferred_loc'],
  process: ['process', 'jd', 'job_title', 'job title', 'project', 'campaign'],
  recruiter_code: ['recruiter_code', 'recruiter code', 'owner_code', 'owner code', 'employee_code', 'employee code', 'employee_no', 'employee no', 'employee_id', 'employee id'],
  employee_code: ['employee_code', 'employee code', 'employee_no', 'employee no', 'employee_id', 'employee id', 'recruiter_code', 'owner_code'],
  recruiter_name: ['recruiter_name', 'recruiter name', 'owner_name', 'owner name', 'recruiter', 'employee_name', 'employee name'],
  total_experience: ['total_experience', 'total experience', 'total_exp', 'total exp', 'experience', 'experience_months', 'experience months'],
  relevant_experience: ['relevant_experience', 'relevant experience', 'relevant_exp', 'relevant exp', 'relevant_experience_months', 'relevant experience months'],
  ctc_monthly: ['ctc_monthly', 'ctc monthly', 'monthly_ctc', 'monthly ctc', 'monthly_ctc_salary', 'monthly ctc salary', 'ctc'],
  in_hand_salary: ['in_hand_salary', 'in hand salary', 'inhand_salary', 'inhand salary', 'monthly_inhand_salary', 'monthly inhand salary', 'monthly_in_hand_salary', 'monthly in hand salary', 'in_hand_monthly_salary', 'in hand monthly salary', 'salary', 'take_home_salary', 'take home salary'],
  communication_skill: ['communication_skill', 'communication skill', 'communication', 'english', 'communication_level', 'communication level'],
  interview_date: ['interview_date', 'interview date', 'interview_reschedule_date', 'interview reschedule date'],
  data_notes: ['data_notes', 'data notes'],
  notes: ['notes','note','remarks','profile_note','profile note','master_notes','candidate_notes'],
  qualification_level: ['qualification_level','degree'],
  qualification: ['qualification','course_name','course'],
  client: ['client','client_name'],
};

function normalizeServerHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function enrichImportAliases(row = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(row || {})) {
    normalized[normalizeServerHeader(key)] = value;
  }
  const next = { ...row, ...normalized };
  for (const [target, aliases] of Object.entries(SERVER_IMPORT_ALIASES)) {
    if (String(next[target] ?? '').trim()) continue;
    for (const alias of aliases) {
      const key = normalizeServerHeader(alias);
      const value = normalized[key] ?? row?.[alias];
      if (String(value ?? '').trim()) {
        next[target] = String(value).trim();
        break;
      }
    }
  }
  return next;
}

function firstValue(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (String(value ?? '').trim()) return String(value).trim();
  }
  return '';
}

function cleanAmount(value) {
  return String(value ?? '').replace(/[^\d.]/g, '');
}

function hasAnyImportKey(row, keys = []) {
  const source = row || {};
  return keys.some((key) => Object.prototype.hasOwnProperty.call(source, key));
}

function firstValueFromAliases(row, aliases = []) {
  const source = row || {};
  for (const key of aliases) {
    const direct = firstValue(source, [key]);
    if (direct) return direct;
  }
  return '';
}

function looksLikeCandidateId(value) {
  return /^C\d{2,}$/i.test(String(value || '').trim());
}

function looksLikePhoneValue(value) {
  return /(?:\+?91[-\s]?)?\d{10}/.test(String(value || '').trim());
}

function looksLikeLocationValue(value) {
  return /(noida|delhi|gurgaon|gurugram|mumbai|pune|kanpur|lucknow|bangalore|bengaluru|hyderabad|jaipur|sector)/i.test(String(value || '').trim());
}

function looksLikeQualificationValue(value) {
  return /(graduate|undergraduate|bachelor|master|diploma|b\.?tech|m\.?tech|bca|mca|bba|ba|bsc|b\.?sc|bcom|b\.?com|12th|10th|mba)/i.test(String(value || '').trim());
}

function normalizeImportedCandidateRow(rawRow) {
  const row = enrichImportAliases({ ...(rawRow || {}) });
  const importedId = firstValue(row, ['candidate_id']);
  const importedName = firstValue(row, ['full_name', 'name', 'candidate_name']);
  const importedPhone = firstValue(row, ['phone', 'number', 'mobile', 'contact_number', 'phone_number']);
  const importedLocation = firstValue(row, ['location', 'current_location']);
  const importedQualification = firstValue(row, ['qualification', 'qualification_level', 'degree']);

  const legacyLeftShiftDetected = importedId
    && !looksLikeCandidateId(importedId)
    && (!importedName || looksLikePhoneValue(importedName))
    && (!importedPhone || looksLikeLocationValue(importedPhone) || looksLikeQualificationValue(importedPhone))
    && (!importedLocation || looksLikeQualificationValue(importedLocation));

  if (legacyLeftShiftDetected) {
    row.full_name = importedId;
    row.phone = importedName || '';
    row.location = importedPhone || '';
    row.qualification = importedLocation || importedQualification || '';
    row.candidate_id = '';
  }

  if (!looksLikeCandidateId(firstValue(row, ['candidate_id']))) row.candidate_id = '';
  return row;
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeSheetName(value, fallback = 'Sheet') {
  const clean = String(value || fallback).replace(/[\/:*?\[\]]/g, ' ').trim();
  return (clean || fallback).slice(0, 31);
}

function sanitizeUser(row) {
  if (!row) return row;
  const safe = { ...row };
  delete safe.password;delete safe.password_hash;delete safe.session_token;
  return safe;
}

function sanitizeExportRow(row = {}) {
  const safe = { ...(row || {}) };
  delete safe.password;
  delete safe.session_token;
  if (Object.prototype.hasOwnProperty.call(safe, 'content_base64')) {
    safe.content_base64 = safe.content_base64 ? '[removed-for-security]' : '';
  }
  return safe;
}

function sanitizeExportRows(rows = [], tableName = '') {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    if (tableName === 'users') return sanitizeUser(row);
    return sanitizeExportRow(row);
  });
}

function unionColumns(rows = [], fallback = []) {
  const ordered = [];
  const seen = new Set();
  for (const key of fallback) {
    if (!seen.has(key)) { seen.add(key); ordered.push(key); }
  }
  for (const row of rows) {
    for (const key of Object.keys(row || {})) {
      if (!seen.has(key)) { seen.add(key); ordered.push(key); }
    }
  }
  return ordered;
}

function buildWorkbookXml(sheets, fallbackSheetName = 'CRM Data') {
  const normalizedSheets = Array.isArray(sheets) ? sheets : [{ name: fallbackSheetName, rows: Array.isArray(sheets?.rows) ? sheets.rows : [] }];
  const worksheets = normalizedSheets.map((sheet, index) => {
    const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
    const columns = unionColumns(rows, sheet?.fallbackColumns || ['full_name', 'phone', 'location', 'process']);
    const headerRow = `<Row>${columns.map((col) => `<Cell ss:StyleID="sHeader"><Data ss:Type="String">${escapeXml(col)}</Data></Cell>`).join('')}</Row>`;
    const bodyRows = rows.map((row) => `<Row>${columns.map((col) => `<Cell><Data ss:Type="String">${escapeXml(row?.[col] ?? '')}</Data></Cell>`).join('')}</Row>`).join('');
    return `<Worksheet ss:Name="${escapeXml(sanitizeSheetName(sheet?.name || `${fallbackSheetName} ${index + 1}`))}"><Table>${headerRow}${bodyRows}</Table></Worksheet>`;
  }).join('');
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Bottom"/><Borders/><Font ss:FontName="Calibri" ss:Size="11"/><Interior/><NumberFormat/><Protection/></Style>
    <Style ss:ID="sHeader"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#2C4A9A" ss:Pattern="Solid"/></Style>
  </Styles>${worksheets}</Workbook>`;
}

function hasMeaningfulCandidateDetails(row) {
  if (!row) return false;
  const keys = ['location','qualification','preferred_location','process','communication_skill','relevant_experience','in_hand_salary','status','all_details_sent','notes'];
  const score = keys.reduce((count, key) => count + (String(row?.[key] || '').trim() ? 1 : 0), 0);
  return score >= 4;
}


function candidateDetailFields(row = {}) {
  const keys = [
    'location','qualification','preferred_location','process','communication_skill',
    'total_experience','relevant_experience','in_hand_salary','ctc_monthly',
    'status','approval_status','all_details_sent','notes','follow_up_note',
    'interview_date','submission_date','call_connected','data_notes'
  ];
  return keys.filter((key) => String(row?.[key] || '').trim());
}

function candidateDetailScore(row = {}) {
  return candidateDetailFields(row).length;
}

function fillBlankImportedFields(existing = {}, incoming = {}) {
  const out = { ...existing };
  for (const [key, value] of Object.entries(incoming || {})) {
    const incomingValue = String(value ?? '').trim();
    if (!incomingValue) continue;
    const existingValue = String(out[key] ?? '').trim();
    if (!existingValue) out[key] = value;
  }
  return out;
}

function uploadDuplicateDecision(existing = {}, incoming = {}) {
  const existingScore = candidateDetailScore(existing);
  const incomingScore = candidateDetailScore(incoming);
  const existingFilled = hasMeaningfulCandidateDetails(existing) || existingScore >= 4;
  const incomingFilled = hasMeaningfulCandidateDetails(incoming) || incomingScore >= 4;
  if (existingFilled) {
    return {
      action: 'review_filled_existing',
      severity: 'review',
      message: 'Existing profile already has filled details. Keep it safe and review duplicate before replacing anything.',
      existing_filled: true,
      incoming_filled: incomingFilled,
      existing_detail_score: existingScore,
      incoming_detail_score: incomingScore,
    };
  }
  return {
    action: 'replace_blank_existing',
    severity: 'safe',
    message: 'Existing profile is mostly blank. New upload can become the main profile and old blank row can move to Duplicate Profiles.',
    existing_filled: false,
    incoming_filled: incomingFilled,
    existing_detail_score: existingScore,
    incoming_detail_score: incomingScore,
  };
}

function duplicatePreviewRow(existing = {}, incoming = {}, uploadRow = {}, rowIndex = 0) {
  const decision = uploadDuplicateDecision(existing, incoming);
  return {
    upload_row_id: String(uploadRow?._upload_row_id || uploadRow?.upload_row_id || `UPLOAD-${rowIndex + 1}`).trim(),
    row_number: rowIndex + 1,
    action: decision.action,
    severity: decision.severity,
    message: decision.message,
    phone: incoming.phone || firstValue(uploadRow, ['phone', 'number', 'mobile']) || existing.phone || '',
    uploaded_name: incoming.full_name || firstValue(uploadRow, ['full_name', 'name', 'candidate_name']) || '',
    uploaded_candidate_id: incoming.candidate_id || '',
    uploaded_detail_score: decision.incoming_detail_score,
    existing_candidate_id: existing.candidate_id || '',
    existing_name: existing.full_name || existing.name || '',
    existing_phone: existing.phone || '',
    existing_recruiter: existing.recruiter_name || existing.employee_name || '',
    existing_status: existing.status || existing.all_details_sent || '',
    existing_detail_score: decision.existing_detail_score,
    existing_filled_fields: candidateDetailFields(existing).slice(0, 12),
    suggested_action: decision.action === 'review_filled_existing'
      ? 'Keep existing profile safe. Add uploaded row as duplicate for manual review.'
      : 'Move old blank row to Duplicate Profiles and keep new upload as main profile.',
  };
}

// Read only phones present in this upload. No full CRM-table download.
async function candidatesMatchingUpload(rows, lockRows = false) {
  const keys = [...new Set(rows.map(row => phoneMatchKey(firstValue(normalizeImportedCandidateRow(row), ['phone','number','mobile']))).filter(Boolean))];
  if (!keys.length) return [];
  if (store.pool) return store.query(
    `select c.* from public.candidates c where right(regexp_replace(coalesce(c.phone::text, ''), '[^0-9]', '', 'g'), 10) = any($1::text[])
     and ${candidateNotDeletedSql('c')}
     order by updated_at desc nulls last, candidate_id desc ${lockRows ? 'for update' : ''}`, [keys]);
  const wanted = new Set(keys);
  return (await table('candidates')).filter(row => wanted.has(phoneMatchKey(row.phone)) && !isDeletedCandidate(row));
}

function validateUploadRanges(ranges, users) {
  const normalized = (Array.isArray(ranges) ? ranges : []).map(range => ({
    from: Number(range.from), to: Number(range.to), user_id: String(range.user_id || '').trim(),
  }));
  for (const range of normalized) {
    if (!Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.to) || range.from < 1 || range.to < range.from)
      throw Object.assign(new Error('Assignment ranges need valid From / To serial numbers.'), { status: 400 });
    if (!users.some(user => String(user.user_id) === range.user_id))
      throw Object.assign(new Error('Choose an active recruiter for every assignment range.'), { status: 400 });
  }
  for (let i = 0; i < normalized.length; i++) for (let j = i + 1; j < normalized.length; j++) {
    if (normalized[i].from <= normalized[j].to && normalized[j].from <= normalized[i].to)
      throw Object.assign(new Error('Assignment ranges overlap. Give each serial number one recruiter.'), { status: 400 });
  }
  return normalized;
}

async function insertUploadBatch(rows) {
  if (!rows.length) return;
  if (!store.pool) { for (const row of rows) await insertCandidateSafe(row); return; }
  const dbColumns = await getCandidateDbColumns();
  const clean = rows.map(row => filterToDbColumns(row, dbColumns));
  const columns = [...new Set(clean.flatMap(row => Object.keys(row)))];
  for (let offset = 0; offset < clean.length; offset += 80) {
    const chunk = clean.slice(offset, offset + 80), values = [];
    const groups = chunk.map(row => '(' + columns.map(column => { values.push(row[column] ?? ''); return '$' + values.length; }).join(',') + ')');
    await store.query(`insert into public.candidates (${columns.map(column => '"' + column.replaceAll('"','""') + '"').join(',')}) values ${groups.join(',')}`, values);
  }
}

async function analyzeCandidateUpload(req, res) {
  const users = uploadAssignees(await table('users'), req.user);
  const rows = preparedUploadRows(req.body?.rows);
  const allRows = await candidatesMatchingUpload(rows);
  const assigneeUserId = String(req.body?.assignee_user_id || '').trim();
  const replaceRecruiterFromSheet = Boolean(req.body?.replace_recruiter_from_sheet);
  const assignedUser = assigneeUserId ? users.find((user) => String(user.user_id) === assigneeUserId) : null;
  const sharedDataNotes = String(req.body?.data_notes || '').trim();
  const sharedUploadingDate = validateUploadDate(req.body?.data_uploading_date);

  const review_rows = [];
  const safe_blank_rows = [];
  const exact_rows = [];
  const new_rows = [];
  const skipped = [];
  // CC26_519: duplicate review is grouped by normalized last-10 phone digits.
  // This lets one upload show 2/3/10 same-number rows together before anything is written.
  const uploadPhoneGroups = new Map();
  const existingByPhone = new Map();
  allRows.forEach((item) => {
    const key = phoneMatchKey(item?.phone || item?.number || item?.mobile || '');
    if (!key) return;
    if (!existingByPhone.has(key)) existingByPhone.set(key, []);
    existingByPhone.get(key).push(item);
  });

  rows.forEach((row, index) => {
    const uploadRowId = String(row?._upload_row_id || row?.upload_row_id || `UPLOAD-${index + 1}`).trim();
    const effectiveAssignedUser = replaceRecruiterFromSheet ? assignedUser : null;
    const mergedRow = {
      ...(row || {}),
      data_notes: mergeUploadDataNote(firstValue(row, ['data_notes']), sharedDataNotes),
      data_uploading_date: sharedUploadingDate || firstValue(row, ['data_uploading_date']) || uploadStampLocal(),
    };
    const nextItem = buildImportedCandidate(allRows, mergedRow, req.user, effectiveAssignedUser || assignedUser);
    const importedCandidateId = firstValue(normalizeImportedCandidateRow(mergedRow), ['candidate_id']);
    if (!nextItem.full_name || !/^\d+$/.test(nextItem.phone)) {
      skipped.push({ upload_row_id: uploadRowId, row_number: index + 1, name: nextItem.full_name || '', phone: nextItem.phone || '', reason: 'Name or Number missing' });
      return;
    }
    const incomingPhoneKey = phoneMatchKey(nextItem.phone || firstValue(mergedRow, ['phone', 'number', 'mobile']));
    if (incomingPhoneKey) {
      if (!uploadPhoneGroups.has(incomingPhoneKey)) {
        uploadPhoneGroups.set(incomingPhoneKey, { phone_key: incomingPhoneKey, phone: nextItem.phone || incomingPhoneKey, uploaded_rows: [] });
      }
      uploadPhoneGroups.get(incomingPhoneKey).uploaded_rows.push({
        upload_row_id: uploadRowId,
        row_number: index + 1,
        uploaded_name: nextItem.full_name || '',
        source_sr_no: nextItem.source_sr_no || String(index + 1),
        total_experience: nextItem.total_experience || '',
        in_hand_salary: nextItem.in_hand_salary || '',
        ctc_monthly: nextItem.ctc_monthly || '',
        communication_skill: nextItem.communication_skill || '',
        phone: nextItem.phone || '',
        location: nextItem.location || '',
        preferred_location: nextItem.preferred_location || '',
        qualification: nextItem.qualification || nextItem.qualification_level || '',
        recruiter_code: nextItem.recruiter_code || '',
        status: nextItem.status || '',
      });
    }
    const exactExisting = importedCandidateId
      ? allRows.find((item) => String(item.candidate_id || '') === String(importedCandidateId))
      : null;
    if (exactExisting) {
      const preview = duplicatePreviewRow(exactExisting, nextItem, mergedRow, index);
      preview.action = preview.existing_detail_score >= 4 ? 'review_exact_existing' : 'update_exact_existing';
      preview.suggested_action = preview.action === 'review_exact_existing'
        ? 'Same Candidate ID already exists with details. Review before updating.'
        : 'Same Candidate ID exists but has limited details. Updating is safe.';
      exact_rows.push(preview);
      if (preview.action === 'review_exact_existing') review_rows.push(preview);
      return;
    }
    const existing = allRows.find((item) => incomingPhoneKey && phoneMatchKey(item.phone || item.number || item.mobile) === incomingPhoneKey && String(item.is_duplicate || '0') !== '1');
    if (existing) {
      const preview = duplicatePreviewRow(existing, nextItem, mergedRow, index);
      if (preview.action === 'review_filled_existing') review_rows.push(preview);
      else safe_blank_rows.push(preview);
      return;
    }
    new_rows.push({ upload_row_id: uploadRowId, row_number: index + 1, uploaded_name: nextItem.full_name || '', phone: nextItem.phone || '', suggested_action: 'New profile will be added.' });
  });

  const duplicate_groups = [...uploadPhoneGroups.values()].map((group) => {
    const existingProfiles = (existingByPhone.get(group.phone_key) || []).map((item) => !visibleCandidateForUser(item, req.user)
      ? { candidate_id:item.candidate_id, restricted:true, existing_name:'Profile outside your team', phone:group.phone }
      : ({
      candidate_id: item.candidate_id || '',
      source_sr_no: item.source_sr_no || item.serial_no || item.sr_no || String(item.candidate_id || '').match(/\d+$/)?.[0] || '',
      existing_name: item.full_name || item.name || '',
      updated_at: item.updated_at || '',
      data_notes: item.data_notes || '',
      phone: item.phone || item.number || item.mobile || '',
      location: item.location || '',
      preferred_location: item.preferred_location || '',
      qualification: item.qualification || item.qualification_level || '',
      qualification_level: item.qualification_level || '',
      total_experience: item.total_experience || item.experience || '',
      relevant_experience: item.relevant_experience || '',
      ctc_monthly: item.ctc_monthly || '',
      in_hand_salary: item.in_hand_salary || '',
      process: item.process || '',
      communication_skill: item.communication_skill || '',
      recruiter_code: item.recruiter_code || '',
      recruiter_name: item.recruiter_name || '',
      status: item.status || '',
      approval_status: item.approval_status || '',
      all_details_sent: item.all_details_sent || '',
      is_duplicate: String(item.is_duplicate || '0'),
      existing_filled_fields: candidateDetailFields(item).slice(0, 18),
    }));
    return {
      group_key: group.phone_key,
      phone: group.phone,
      uploaded_rows: group.uploaded_rows,
      existing_profiles: existingProfiles,
      uploaded_count: group.uploaded_rows.length,
      existing_count: existingProfiles.length,
      total_compare_rows: group.uploaded_rows.length + existingProfiles.length,
    };
  }).filter((group) => group.uploaded_count > 1 || group.existing_count > 0)
    .sort((a, b) => (a.uploaded_rows[0]?.row_number || 0) - (b.uploaded_rows[0]?.row_number || 0));
  const groupedReviewRequired = duplicate_groups.length > 0;
  // Flatten phone groups for the existing review table while preserving set order.
  // Every uploaded row appears exactly once, so 10 same-number uploads show as one 10-row set.
  const grouped_review_rows = duplicate_groups.flatMap((group, groupIndex) => {
    const existingIds = group.existing_profiles.map((item) => item.candidate_id).filter(Boolean);
    const existingNames = group.existing_profiles.map((item) => item.existing_name).filter(Boolean);
    const filledFields = [...new Set(group.existing_profiles.flatMap((item) => item.existing_filled_fields || []))].slice(0, 18);
    return group.uploaded_rows.map((uploaded) => ({
      upload_row_id: uploaded.upload_row_id || '',
      row_number: uploaded.row_number,
      upload_row_number: uploaded.row_number,
      set_number: groupIndex + 1,
      phone: uploaded.phone || group.phone || '',
      uploaded_name: uploaded.uploaded_name || '',
      existing_candidate_id: existingIds.join(', '),
      existing_name: existingNames.join(', '),
      existing_filled_fields: filledFields,
      suggested_action: `${group.uploaded_count} uploaded row(s) and ${group.existing_count} existing CRM profile(s) share the same phone digits. Remove only the uploaded rows you do not want, then Continue Import Safely.`,
      group_key: group.group_key,
      group_uploaded_count: group.uploaded_count,
      group_existing_count: group.existing_count,
    }));
  });

  return res.json({
    ok: true,
    review_token: uploadReviewToken(rows, allRows),
    workflow_version:'candidate-upload-v1', workflow_release:RELEASE,
    requires_review: review_rows.length > 0 || groupedReviewRequired,
    summary: {
      uploaded_rows: rows.length,
      new_profiles: new_rows.length,
      blank_existing_matches: safe_blank_rows.length,
      filled_existing_matches: review_rows.filter((row) => row.action === 'review_filled_existing').length,
      exact_existing_matches: exact_rows.length,
      skipped: skipped.length,
      duplicate_sets: duplicate_groups.length,
      uploaded_duplicate_rows: duplicate_groups.reduce((sum, group) => sum + Number(group.uploaded_count || 0), 0),
      existing_phone_matches: duplicate_groups.reduce((sum, group) => sum + Number(group.existing_count || 0), 0),
    },
    duplicate_groups: duplicate_groups,
    review_rows: grouped_review_rows.slice(0, 1000),
    blank_existing_rows: safe_blank_rows.slice(0, 100),
    exact_rows: exact_rows.slice(0, 100),
    new_rows: new_rows.slice(0, 100),
    skipped: skipped.slice(0, 100),
    policy: {
      filled_existing: 'Existing filled profiles are never replaced automatically. Uploaded matching row is held as duplicate for manual review.',
      blank_existing: 'Old blank profile can move to Duplicate Profiles and uploaded row becomes the active profile.',
      delete_policy: 'Remove only excludes an uploaded row from this pending import. Existing CRM profiles are never physically deleted by upload review.',
    },
  });
}


function phoneMatchKey(value) {
  return require('../lib/candidateIdentityGuard').normalizedPhone(value);
}

function splitDataNotesValue(value) {
  return String(value || '')
    .split(/[,|;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function mergeUploadDataNote(existingValue = '', uploadValue = '') {
  const upload = String(uploadValue || '').trim();
  if (!upload) return String(existingValue || '').trim();
  const parts = [];
  const seen = new Set();
  for (const item of [...splitDataNotesValue(existingValue), upload]) {
    const key = lower(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    parts.push(item);
  }
  return parts.join(', ');
}

function dataNoteAlreadyApplied(existingValue = '', uploadValue = '') {
  const upload = lower(uploadValue);
  if (!upload) return true;
  return splitDataNotesValue(existingValue).some((item) => lower(item) === upload);
}

function attachDuplicateMeta(item, source, reason, status) {
  const prefix = `[Duplicate Rule] ${reason}`;
  item.duplicate_reason = prefix;
  item.follow_up_note = String(item.follow_up_note || '').trim() || status;
  item.manager_crm = source?.candidate_id ? `Ref:${source.candidate_id}` : (item.manager_crm || '');
  return item;
}

function sanitizeUser(user) {
  if (!user) return null;
  const safe = { ...user };
  delete safe.password;
  return safe;
}

const CANDIDATE_EXPORT_COLUMNS = [
  'sr_no',
  'candidate_id',
  'name',
  'number',
  'location',
  'preferred_location',
  'qualification',
  'recruiter_code',
  'recruiter_name',
  'process',
  'status',
  'approval_status',
  'all_details_sent',
  'call_connected',
  'communication_skill',
  'data_uploading_date',
  'data_notes',
  'submission_date',
  'follow_up_at',
  'interview_date',
];

const CANDIDATE_DATA_EXPORT_COLUMNS = [
  'SR No',
  'Candidate ID',
  'Name',
  'Number',
  'Location',
  'Preferred Location',
  'Qualification',
  'Recruiter Code',
  'Recruiter Name',
  'Process',
  'Status',
  'Approval Status',
  'Details Sent',
  'Call Connected',
  'Communication Skill',
  'Data Uploading Date',
  'Data Notes',
  'Submission Date',
  'Follow Up Date',
  'Interview Date',
];

const CANDIDATE_IMPORT_TEMPLATE_COLUMNS = [
  'Name',
  'Number',
  'Location',
  'Qualification',
  'Data Notes',
];

const HOT_LEADS_IMPORT_TEMPLATE_COLUMNS = [
  'employee_code',
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
  'employee_name',
  'employee_no',
  'employee_file_url',
  'employee_row_no',
  'last_updated_at',
];

const CANDIDATE_UPDATED_IMPORT_TEMPLATE_COLUMNS = [
  'Name',
  'Number',
  'Location',
  'Qualification',
  'Total Experience',
  'Relevant Experience',
  'Monthly CTC',
  'Monthly In-hand Salary',
  'Communication Skill',
  'Interview Date',
  'Process',
  'Data Notes',
];

const UPDATED_TEMPLATE_DETAIL_KEYS = [
  'total_experience',
  'total_exp',
  'experience',
  'experience_months',
  'relevant_experience',
  'relevant_exp',
  'relevant_experience_months',
  'ctc_monthly',
  'monthly_ctc',
  'monthly_ctc_salary',
  'monthly_ctc_inr',
  'in_hand_salary',
  'inhand_salary',
  'monthly_inhand_salary',
  'monthly_in_hand_salary',
  'in_hand_monthly_salary',
  'inhand_monthly_salary',
  'take_home_salary',
  'communication_skill',
  'communication',
  'english',
  'communication_level',
  'interview_date',
  'interview_reschedule_date',
];



function toCandidateDataSheetRows(rows = []) {
  return rows.map((row, index) => ({
    'SR No': String(index + 1),
    'Candidate ID': String(row?.candidate_id || '').trim(),
    'Name': String(row?.full_name || '').trim(),
    'Number': String(row?.phone || '').trim(),
    'Location': String(row?.location || '').trim(),
    'Preferred Location': String(row?.preferred_location || '').trim(),
    'Qualification': String(row?.qualification || row?.qualification_level || '').trim(),
    'Recruiter Code': String(row?.recruiter_code || '').trim(),
    'Recruiter Name': String(row?.recruiter_name || '').trim(),
    'Process': String(row?.process || '').trim(),
    'Status': String(row?.status || '').trim(),
    'Approval Status': String(row?.approval_status || '').trim(),
    'Details Sent': String(row?.all_details_sent || '').trim(),
    'Call Connected': String(row?.call_connected || '').trim(),
    'Communication Skill': String(row?.communication_skill || '').trim(),
    'Data Uploading Date': String(row?.data_uploading_date || '').trim(),
    'Data Notes': String(row?.data_notes || '').trim(),
    'Submission Date': String(row?.submission_date || '').trim(),
    'Follow Up Date': String(row?.follow_up_at || '').trim(),
    'Interview Date': String(row?.interview_reschedule_date || row?.interview_date || '').trim(),
  }));
}

function buildImportedCandidate(rows, rawPayload, reqUser, assignedUser) {
  const payload = normalizeImportedCandidateRow(rawPayload);
  const fullName = firstValue(payload, ['full_name', 'name', 'candidate_name']);
  const phone = require('../lib/candidatePhoneGuard').normalizeInput(firstValue(payload, ['phone', 'number', 'mobile', 'contact_number', 'phone_number']));
  const qualification = firstValue(payload, ['qualification', 'qualification_level', 'degree']);
  const location = firstValue(payload, ['location', 'current_location']);
  const preferredLocation = firstValue(payload, ['preferred_location', 'preferred_city', 'preferred_loc']);
  const totalExperience = importExperience(payload,'total');
  const relevantExperience = importExperience(payload,'relevant');
  if (Number(relevantExperience)>Number(totalExperience)) throw Object.assign(new Error('Relevant experience cannot exceed total experience.'),{status:400});
  const inHandSalary = cleanAmount(firstValueFromAliases(payload, ['in_hand_salary', 'inhand_salary', 'monthly_inhand_salary', 'monthly_in_hand_salary', 'in_hand_monthly_salary', 'inhand_monthly_salary', 'salary', 'take_home_salary'])) || '0';
  const ctcMonthly = cleanAmount(firstValueFromAliases(payload, ['ctc_monthly', 'monthly_ctc', 'monthly_ctc_salary', 'monthly_ctc_inr'])) || '0';
  const process = firstValue(payload, ['process', 'jd', 'job_title', 'project']);
  const communicationSkill = firstValueFromAliases(payload, ['communication_skill', 'communication', 'english', 'communication_level']);
  const notes = firstValue(payload, ['notes', 'note', 'remarks','profile_note','master_notes']);
  const interviewDate = cleanDateOnly(firstValueFromAliases(payload, ['interview_reschedule_date', 'interview_date']));
  const assignedAt = nowIso();

  const recruiterCode = assignedUser?.recruiter_code || firstValue(payload, ['recruiter_code', 'owner_code']) || '';
  const recruiterName = assignedUser?.full_name || firstValue(payload, ['recruiter_name', 'owner_name']) || '';
  const recruiterDesignation = assignedUser?.designation || firstValue(payload, ['recruiter_designation']) || '';

  return {
    candidate_id: nextId('C', rows, 'candidate_id'),
    jd_id: firstValue(payload, ['jd_id']) || '',
    interview_date: interviewDate,
    created_by_user_id: reqUser?.user_id || '',
    created_by_name: reqUser?.full_name || reqUser?.username || '',
    recruiter_user_id: assignedUser?.user_id || reqUser?.user_id || '',
    user_id: reqUser?.user_id || '',
    call_connected: firstValue(payload, ['call_connected']) || '',
    looking_for_job: firstValue(payload, ['looking_for_job']) || 'Yes',
    full_name: fullName,
    phone,
    email: firstValue(payload,['email']),
    course_name: firstValue(payload,['course_name','qualification']),
    client: firstValue(payload,['client']),
    last_working_date: cleanDateOnly(firstValue(payload,['last_working_date'])),
    qualification,
    location,
    preferred_location: preferredLocation || '',
    qualification_level: firstValue(payload, ['qualification_level']) || 'Graduate',
    total_experience: totalExperience,
    relevant_experience: relevantExperience,
    in_hand_salary: inHandSalary,
    ctc_monthly: ctcMonthly,
    career_gap: firstValue(payload, ['career_gap']) || 'Fresher',
    documents_availability: firstValue(payload, ['documents_availability', 'documents']) || 'Yes',
    communication_skill: communicationSkill || 'Good',
    relevant_experience_range: firstValue(payload,['relevant_experience_range']) || calcExperienceRange(relevantExperience),
    relevant_in_hand_range: firstValue(payload,['relevant_in_hand_range']) || calcSalaryRange(inHandSalary),
    submission_date: cleanDateOnly(firstValueFromAliases(payload, ['submission_date', 'submitted_at'])) || '',
    process,
    recruiter_code: recruiterCode,
    recruiter_name: recruiterName,
    recruiter_designation: recruiterDesignation,
    status: firstValue(payload, ['status', 'profile_status']) || 'Draft',
    all_details_sent: firstValue(payload, ['all_details_sent', 'details_sent']) || '',
    interview_availability: firstValue(payload, ['interview_availability']) || '',
    interview_reschedule_date: interviewDate,
    virtual_onsite: firstValue(payload, ['virtual_onsite', 'interview_mode', 'mode']) || 'Walkin',
    follow_up_at: cleanImportDateTime(firstValue(payload, ['follow_up_at'])),
    follow_up_note: firstValue(payload, ['follow_up_note']) || '',
    follow_up_status: firstValue(payload, ['follow_up_status']) || 'Open',
    approval_status: 'Draft',
    approval_requested_at: '',
    approved_at: '',
    approved_by_name: '',
    is_duplicate: firstValue(payload, ['is_duplicate']) || '0',
    data_uploading_date: firstValue(payload, ['data_uploading_date']) || uploadStampLocal(),
    data_notes: firstValue(payload, ['data_notes']) || '',
    duplicate_reason: firstValue(payload, ['duplicate_reason']) || '',
    source_sr_no: firstValue(payload, ['source_sr_no', 'serial_no', 'sr_no']) || '',
    profile_priority: firstValue(payload, ['profile_priority', 'priority']) || 'Medium',
    notes,
    reference_details: firstValue(payload, ['reference_details']) || '',
    resume_filename: firstValue(payload, ['resume_filename']) || '',
    recording_filename: firstValue(payload, ['recording_filename']) || '',
    created_at: assignedAt,
    updated_at: assignedAt,
    experience: totalExperience,
    bucket_assigned_at: assignedAt,
  };
}

let candidateDbColumnsCache = null;

async function getCandidateDbColumns() {
  if (!store.pool) return null;
  if (candidateDbColumnsCache) return candidateDbColumnsCache;
  const rows = await store.query(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'candidates'",
  );
  candidateDbColumnsCache = new Set((rows || []).map((row) => String(row.column_name || '').trim()).filter(Boolean));
  return candidateDbColumnsCache;
}

function filterToDbColumns(row = {}, dbColumns) {
  if (!dbColumns) return row;
  const out = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (dbColumns.has(key)) out[key] = value;
  }
  return out;
}


function buildImportedHotLead(rows, rawPayload, reqUser, assignedUser) {
  const payload = normalizeImportedCandidateRow(rawPayload);
  const jdName = firstValue(payload, ['jd_name', 'jd', 'process', 'job_title']);
  const profileStatus = firstValue(payload, ['profile_status']) || 'Hot Lead';
  const interviewDate = cleanDateOnly(firstValueFromAliases(payload, ['interview_date', 'interview_reschedule_date']));
  const sheetEmployeeCode = firstValue(payload, ['employee_code', 'employee_no', 'recruiter_code', 'owner_code', 'employee_id']);
  const finalEmployeeCode = assignedUser?.recruiter_code || sheetEmployeeCode || '';
  const finalEmployeeName = assignedUser?.full_name || firstValue(payload, ['employee_name', 'recruiter_name', 'owner_name']) || '';

  const item = buildImportedCandidate(rows, {
    ...payload,
    recruiter_code: finalEmployeeCode || firstValue(payload, ['recruiter_code']) || '',
    recruiter_name: finalEmployeeName || firstValue(payload, ['recruiter_name']) || '',
    process: jdName || firstValue(payload, ['process']) || '',
    notes: firstValue(payload, ['notes']) || '',
    data_notes: firstValue(payload, ['data_notes']) || firstValue(payload, ['notes']) || '',
    interview_reschedule_date: interviewDate,
    status: 'Draft',
    approval_status: 'Draft',
    all_details_sent: '',
    call_connected: 'Yes',
    looking_for_job: 'Yes',
  }, reqUser, assignedUser);

  return {
    ...item,
    recruiter_code: finalEmployeeCode || item.recruiter_code || '',
    recruiter_name: finalEmployeeName || item.recruiter_name || '',
    employee_code: finalEmployeeCode || firstValue(payload, ['employee_code']) || item.recruiter_code || '',
    employee_no: firstValue(payload, ['employee_no']) || finalEmployeeCode || '',
    employee_name: finalEmployeeName,
    lead_source: 'hot_lead',
    hot_lead_status: firstValue(payload, ['hot_lead_status']) || 'Open',
    call_connected: 'Yes',
    looking_for_job: 'Yes',
    relevant_experience_range: item.relevant_experience_range || (item.relevant_experience ? calcExperienceRange(item.relevant_experience) : 'Fresher'),
    relevant_in_hand_range: item.relevant_in_hand_range || (item.in_hand_salary ? calcSalaryRange(item.in_hand_salary) : '0'),
    profile_status: profileStatus,
    jd_name: jdName,
    jd_notes: firstValue(payload, ['jd_notes']),
    employee_file_url: firstValue(payload, ['employee_file_url']),
    employee_row_no: firstValue(payload, ['employee_row_no']),
    last_updated_at: firstValue(payload, ['last_updated_at']) || uploadStampLocal(),
    interview_reschedule_date: interviewDate || item.interview_reschedule_date || '',
  };
}

async function insertCandidateSafe(row) {
  const dbColumns = await getCandidateDbColumns();
  return store.insert('candidates', filterToDbColumns(row, dbColumns));
}

async function updateCandidateSafe(candidateId, payload) {
  const dbColumns = await getCandidateDbColumns();
  return store.update('candidates', 'candidate_id', candidateId, filterToDbColumns(payload, dbColumns));
}

async function noteCounts() {
  if (store.pool) return store.query(`select coalesce(nullif(username,''),'unknown') as username,
    count(*) filter (where lower(coalesce(note_type,''))<>'private')::integer as public_count,
    count(*) filter (where lower(coalesce(note_type,''))='private')::integer as private_count
    from public.notes group by coalesce(nullif(username,''),'unknown')`);
  const notes = await table('notes');
  const byUser = {};
  for (const note of notes) {
    const key = note.username || 'unknown';
    byUser[key] ||= { username: key, public_count: 0, private_count: 0 };
    if (String(note.note_type || '').toLowerCase() === 'private') byUser[key].private_count += 1;
    else byUser[key].public_count += 1;
  }
  return Object.values(byUser);
}

async function lockLogs() {
  const actions=['crm_locked','crm_unlocked','unlock_requested','break_started','break_ended','join_work'];
  const activity=store.pool?await store.query('select activity_id,user_id,username,action_type,created_at,metadata from public.activity_log where action_type=any($1::text[]) order by created_at desc limit 100',[actions]):(await table('activity_log')).filter(row=>actions.includes(lower(row.action_type))).sort((a,b)=>String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0,100);
  const unlocks=store.pool?await store.query('select * from public.unlock_requests order by requested_at desc limit 50'):(await table('unlock_requests')).sort((a,b)=>String(b.requested_at || '').localeCompare(String(a.requested_at || ''))).slice(0,50);
  return {activity,unlocks};
}

async function dashboard(req, res) {
  return res.json({
    users: (await table('users')).map(sanitizeUser),
    upload_assignees: uploadAssignees(await table('users'), req.user).map(sanitizeUser),
    notes_count: await noteCounts(),
    lock_settings: await getSettingsMap(),
    lock_logs: await lockLogs(),
    bulk_upload_history: await listBulkUploadHistory(),
    onboarding_requests: (await table('user_onboarding_requests')).slice().sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || ''))).slice(0, 100),
    password_reset_requests: (await table('password_reset_requests')).slice().sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || ''))).slice(0, 100),
  });
}

async function updateLockSettings(req, res) {
  const next = await setSettingsMap(req.body || {});
  return res.json({ lock_settings: next });
}

async function importCandidates(req, res) {
  const rows = preparedUploadRows(req.body?.rows);
  const kind = String(req.body.upload_kind || 'draft');
  if (!['draft','hot_lead','external_completed'].includes(kind)) return res.status(400).json({message:'Choose a supported upload workflow.'});
  const external = kind === 'external_completed';
  if (external && rows.length>200) return res.status(400).json({message:'Import completed profiles in batches of up to 200, with recruiter assignment.'});
  const users = uploadAssignees(await table('users'), req.user);
  const ranges = validateUploadRanges(req.body?.assignment_ranges, users);
  const defaultUserId = String(req.body?.assignee_user_id || '').trim();
  const defaultUser = users.find(user => String(user.user_id) === defaultUserId);
  if (defaultUserId && !defaultUser) return res.status(400).json({message:'Choose an active assignee from your permitted team.'});
  if (ranges.length) {
    const serials = rows.map(row => Number(row.source_sr_no));
    if (serials.some(serial => !Number.isSafeInteger(serial) || serial < 1) || new Set(serials).size !== serials.length)
      return res.status(400).json({message:'Range assignment needs unique positive serial numbers in the file.'});
    if (ranges.some(range => !serials.some(serial => serial >= range.from && serial <= range.to)))
      return res.status(400).json({message:'An assignment range covers no rows in this file. Check its serial numbers.'});
  }
  const notes = String(req.body?.data_notes || '').trim();
  const uploadDate = validateUploadDate(req.body?.data_uploading_date);
  const choices = req.body?.upload_choices && typeof req.body.upload_choices === 'object' ? req.body.upload_choices : {};
  const commandKey = String(req.body?.command_id || '').trim();
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(commandKey)) return res.status(400).json({message:'A stable upload command ID is required. Reload the upload page.'});
  if (req.body.workflow_release && req.body.workflow_release !== RELEASE)
    return res.status(409).json({message:'Deploy the matching full frontend and backend before uploading.',code:'WORKFLOW_VERSION_MISMATCH'});
  const actor = String(req.user.user_id || req.user.username || '');
  const receiptId = `${actor}:upload:${commandKey}`;
  const signature = crypto.createHash('sha256').update(JSON.stringify(canonicalUpload(req.body))).digest('hex');
  if (store.pool) {
    await store.query('select pg_advisory_xact_lock(hashtext($1))', ['crm-candidate-create']);
    await store.query('select pg_advisory_xact_lock($1)', [2644001]);
  }
  const prior = await store.findById('crm_command_receipts','command_id',receiptId);
  if (prior) {
    if (prior.payload_hash !== signature) return res.status(409).json({message:'This upload retry has changed. Review the file again.',code:'UPLOAD_COMMAND_CHANGED'});
    const receipt = JSON.parse(prior.receipt_json);
    if (!receipt.committed) return res.status(409).json({message:'This older upload does not have a confirmed receipt. Reload and review.',code:'UPLOAD_REVIEW_CHANGED'});
    return res.json({...receipt,workflow_release:RELEASE,replayed:true});
  }
  const existingRows = await candidatesMatchingUpload(rows,true);
  if (String(req.body.review_token || '') !== uploadReviewToken(rows,existingRows))
    return res.status(409).json({message:'The file or matching CRM profiles changed. Review duplicates again; no rows were uploaded.',code:'UPLOAD_REVIEW_CHANGED'});
  const maxId = store.pool ? Number(await store.scalar(
    `select coalesce(max(coalesce(nullif(regexp_replace(candidate_id,'[^0-9]','','g'),''),'0')::numeric),0) as value from public.candidates`
  )) : Number(String(nextId('C',await table('candidates'),'candidate_id')).replace(/\D/g,'')) - 1;
  const idRows = [{candidate_id:`C${maxId}`}];
  const byPhone = new Map();
  for (const row of existingRows) {const key=phoneMatchKey(row.phone);if(!byPhone.has(key))byPhone.set(key,[]);byPhone.get(key).push(row);}
  const newChoicePhones = new Set();
  for (const row of rows) if (choices[row._upload_row_id]?.action === 'keep_new') {
    const phone = phoneMatchKey(row.phone);
    if (newChoicePhones.has(phone)) return res.status(400).json({message:'Choose only one Keep new row per phone. Use Keep both for additional rows.'});
    newChoicePhones.add(phone);
  }
  let pending = [];
  const removed = new Set(), skipped = [];
  let replacedCount = 0;
  for (const row of rows) {
    const decision = choices[row._upload_row_id] || {};
    const action = String(decision.action || 'keep_both');
    if (['skip','keep_old','remove'].includes(action)) {
      skipped.push({row_number:row.source_sr_no,reason:action === 'keep_old' ? 'Kept existing / earlier profile' : 'Excluded from upload'});continue;
    }
    if (!['keep_both','keep_new'].includes(action)) throw Object.assign(new Error('Unknown duplicate-review choice.'),{status:400});
    const serial = Number(row.source_sr_no), range = ranges.find(item => serial >= item.from && serial <= item.to);
    const sheetCode = lower(firstValue(row,['recruiter_code','employee_code']));
    const sheetName = lower(firstValue(row,['recruiter_name','employee_name']));
    const nameMatches = users.filter(user => sheetName && lower(user.full_name) === sheetName);
    const sheetOwner = users.find(user => sheetCode && [lower(user.recruiter_code),lower(user.user_id)].includes(sheetCode)) || (nameMatches.length===1?nameMatches[0]:null);
    if (!range && !req.body.replace_recruiter_from_sheet && (sheetCode || sheetName) && !sheetOwner)
      throw Object.assign(new Error(`Serial ${row.source_sr_no}: recruiter is ambiguous, inactive or outside your team. Choose an explicit default assignee.`),{status:400});
    let owner = range ? users.find(user => String(user.user_id) === range.user_id)
      : req.body.replace_recruiter_from_sheet ? defaultUser : sheetOwner || defaultUser;
    if (!owner) owner = users.find(user => String(user.user_id) === actor);
    if (!owner) throw Object.assign(new Error('Choose an active assignee for rows without sheet mapping.'),{status:400});
    const item = buildImportedCandidate(idRows,{...row,data_notes:mergeUploadDataNote(firstValue(row,['data_notes']),notes),data_uploading_date:validateUploadDate(cleanDateOnly(firstValue(row,['data_uploading_date'])) || uploadDate)},req.user,owner);
    item.bucket_state = external ? 'working' : 'fresh';
    item.bucket_assigned_at = external ? nowIso() : '';
    if (kind !== 'draft') {
      item.lead_source='hot_lead';item.hot_lead_status='Open';
      item.employee_code=owner.recruiter_code || '';item.employee_name=owner.full_name || '';
      item.jd_name=item.process;item.profile_status='Hot Lead';
    }
    if (external) {
      item.status='Draft';item.all_details_sent='Pending';
      item.submission_date=item.submission_date || new Date(Date.now()+19800000).toISOString().slice(0,10);
      const issues=require('./candidateController').validateImportedSubmission(item);
      if (!String(item.notes || '').trim()) issues.push('Add a profile note.');
      if (issues.length) throw Object.assign(new Error(`Serial ${row.source_sr_no}: ${issues.join(' • ')}`),{status:400});
    }
    if (!item.full_name || !/^\d+$/.test(item.phone)) {
      skipped.push({row_number:row.source_sr_no,reason:'Name or Number missing'});continue;
    }
    const phone = phoneMatchKey(item.phone);
    let matches = (byPhone.get(phone) || []).filter(old => !removed.has(String(old.candidate_id)));
    if (matches.length) throw Object.assign(new Error('This phone already has a CRM profile. Ask Manager to review ownership. No profile was replaced.'),{status:409,code:'DUPLICATE_PHONE'});
    if (store.pool) item.candidate_id=await require('./candidateController').allocateCandidateId();
    if (matches.length) {item.is_duplicate='1';attachDuplicateMeta(item,matches[0],'Both profiles kept by upload review.','duplicate_review_required');}
    else item.is_duplicate='0';
    idRows[0]={candidate_id:item.candidate_id};
    pending.push(item);
    if(!byPhone.has(phone))byPhone.set(phone,[]);
    byPhone.get(phone).push(item);
  }
  await insertUploadBatch(pending);
  let submittedCount=0;
  if (external) {
    // The reviewed upload and canonical approval workflow share one transaction.
    // Replaying the upload receipt cannot create a second submission.
    for (let index=0;index<pending.length;index++) {
      const item=pending[index];
      const result=await callController(require('./candidateController').submitForApproval,
        {...req,params:{candidateId:item.candidate_id},body:{}});
      pending[index]={...item,...result.item};submittedCount++;
    }
  }
  const duplicateCount = pending.filter(row => row.is_duplicate === '1').length;
  const assignedCounts = {};
  for (const item of pending) {const label=item.recruiter_name || 'Unassigned';assignedCounts[label]=(assignedCounts[label] || 0)+1;}
  const history = await recordBulkUploadHistory(req,{upload_type:external?'External completed profiles':kind==='hot_lead'?'Hot Leads Upload':'Candidate Bulk Upload',file_name:req.body.file_name || '',sheet_name:req.body.sheet_name || '',
    uploaded_rows:rows.length,added_count:pending.length,updated_count:0,duplicate_count:duplicateCount,replaced_count:replacedCount,skipped_count:skipped.length,
    processed_count:pending.length,data_notes_applied_count:notes ? pending.length : 0,data_notes:notes,assignee_user_id:defaultUserId,assignee_name:defaultUser?.full_name || '',
    recruiter_mapping:ranges.length ? 'Serial-number ranges' : req.body.replace_recruiter_from_sheet ? 'Default assignee' : 'Sheet / default mapping'},true);
  const result = {ok:true,committed:true,workflow_version:'candidate-upload-v1',workflow_release:RELEASE,command_id:commandKey,
    inserted_count:pending.length,submitted_count:submittedCount,upload_kind:kind,skipped_count:skipped.length,items:pending.slice(0,20),skipped:skipped.slice(0,50),assigned_counts:assignedCounts,
    summary:{inserted:pending.length-duplicateCount,duplicates:duplicateCount,replaced:replacedCount,updated:0,skipped:skipped.length,data_notes_applied:notes ? pending.length : 0},upload_history:history};
  await store.insert('crm_command_receipts',{command_id:receiptId,user_id:actor,candidate_id:'',payload_hash:signature,receipt_json:JSON.stringify(result),created_at:nowIso()});
  clearAllCaches();
  return res.json(result);
}


async function importHotLeads(req,res) {
  if (!req.body?.review_token || !req.body?.command_id)
    return res.status(409).json({message:'Review duplicates in Admin Control before importing Hot Leads.',code:'UPLOAD_REVIEW_REQUIRED'});
  req.body={...req.body,upload_kind:req.body.upload_kind==='external_completed'?'external_completed':'hot_lead'};
  return importCandidates(req,res);
}

async function exportCandidates(req, res) {
  const tableLabels = {
    candidates: 'Candidate Data',
    users: 'Users',
    submissions: 'Submissions',
    interviews: 'Interviews',
    tasks: 'Tasks',
    notifications: 'Notifications',
    activity_log: 'Activity Log',
    presence: 'Presence',
    unlock_requests: 'Unlock Requests',
  };
  const orderedTables = [
    'candidates','users','submissions','interviews','tasks','notifications','activity_log','presence','unlock_requests',
    ...[...TABLES].filter((name) => !['candidates','users','submissions','interviews','tasks','notifications','activity_log','presence','unlock_requests'].includes(name)),
  ];
  const sheets = [];
  for (const tableName of [...new Set(orderedTables)]) {
    try {
      let rows = await table(tableName);
      if (tableName === 'candidates') rows = rows.slice().sort((a, b) => String(a.candidate_id || '').localeCompare(String(b.candidate_id || '')));
      rows = sanitizeExportRows(rows, tableName);
      sheets.push({
        name: tableLabels[tableName] || tableName.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
        rows,
        fallbackColumns: tableName === 'candidates'
          ? CANDIDATE_EXPORT_COLUMNS
          : ['id'],
      });
    } catch {}
  }
  const workbook = buildWorkbookXml(sheets, 'CRM Data');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  res.setHeader('Content-Type', 'application/vnd.ms-excel');
  res.setHeader('Content-Disposition', `attachment; filename="career-crox-full-database-${stamp}.xls"`);
  return res.send(workbook);
}


async function exportCandidateDataOnly(req, res) {
  const rows = toCandidateDataSheetRows(sanitizeExportRows((await table('candidates')).slice().sort((a, b) => String(a.candidate_id || '').localeCompare(String(b.candidate_id || ''))), 'candidates'));
  const workbook = buildWorkbookXml([
    {
      name: 'Candidate Data',
      rows,
      fallbackColumns: CANDIDATE_DATA_EXPORT_COLUMNS,
    },
  ], 'Candidate Data');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  res.setHeader('Content-Type', 'application/vnd.ms-excel');
  res.setHeader('Content-Disposition', `attachment; filename="career-crox-candidate-data-${stamp}.xls"`);
  return res.send(workbook);
}

async function exportCandidateTemplate(req, res) {
  const workbook = buildWorkbookXml([
    {
      name: 'Candidate Data',
      rows: [
        {
          'Name': '',
          'Number': '',
          'Location': '',
          'Qualification': '',
          'Data Notes': '',
        },
      ],
      fallbackColumns: CANDIDATE_IMPORT_TEMPLATE_COLUMNS,
    },
  ], 'Candidate Data');
  res.setHeader('Content-Type', 'application/vnd.ms-excel');
  res.setHeader('Content-Disposition', 'attachment; filename="career-crox-blank-template.xls"');
  return res.send(workbook);
}

async function exportCandidateUpdatedTemplate(req,res) {
  const path=require('path'),fs=require('fs'),env=require('../config/env');
  const name='assets/import/CAREER_CROX_CANDIDATE_IMPORT_TEMPLATE.xlsx';
  const file=[path.join(env.SPA_DIR,name),path.resolve(env.ROOT_DIR,'../frontend/public',name)].find(p=>fs.existsSync(p));
  if (!file) return res.status(503).json({message:'Deploy the matching frontend template.'});
  return res.download(file,'CAREER_CROX_EXTERNAL_CANDIDATES.xlsx');
}
async function exportHotLeadsTemplate(req,res) { return exportCandidateUpdatedTemplate(req,res); }

async function impersonate(req, res) {
  return res.status(403).json({ message: 'Impersonation is disabled for security.' });
}

async function stopImpersonation(req, res) {
  if (!req.user.impersonator) return res.status(400).json({ message: 'Not impersonating' });
  const target = (await table('users')).find((u) => u.username === req.user.impersonator);
  if (!target) return res.status(404).json({ message: 'Original user not found' });
  res.cookie('career_crox_token', signUser(target, null, req.user.session_token || ''), authCookie());
  return res.json({ user: sanitizeUser(target) });
}


// CC26_697: operational reset is permanent; never recreate example candidates/tasks.
async function addTwoSampleCandidatesAndTasks(req, res) {
  return res.status(410).json({ ok: false, message: 'Sample-data creation was disabled for the fresh-start CRM.' });
}

module.exports = {
  addTwoSampleCandidatesAndTasks,
  dashboard,
  updateLockSettings,
  analyzeCandidateUpload,
  importCandidates,
  importHotLeads,
  exportCandidates,
  exportCandidateDataOnly,
  exportCandidateTemplate,
  exportCandidateUpdatedTemplate,
  exportHotLeadsTemplate,
  impersonate,
  stopImpersonation,
};

const commitCandidateUpload = transactionalHandler(importCandidates);
module.exports.importCandidates = async (req,res) => {
  try { return await commitCandidateUpload(req,res); }
  catch (error) {
    if (['42P01','42703'].includes(error.code)) return res.status(503).json({message:'Run both structure SQL parts from this ZIP in Supabase, in order, then restart the backend. Your file is kept.',code:'SCHEMA_MISSING'});
    throw error;
  }
};

module.exports.importHotLeads = transactionalHandler(importHotLeads);
