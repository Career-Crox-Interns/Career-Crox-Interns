const { table, store, TABLES } = require('../lib/store');
const { authCookie, signUser } = require('../middleware/auth');
const { getSettingsMap, setSettingsMap } = require('../lib/settings');
const { nextId, nowIso, normalizeIndianPhone, calcExperienceRange, calcSalaryRange } = require('../lib/helpers');
const { clearAllCaches } = require('../lib/cache');

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
function cleanDateOnly(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const direct = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
}

function firstValue(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (String(value || '').trim()) return String(value).trim();
  }
  return '';
}

function cleanAmount(value) {
  return String(value || '').replace(/[^\d.]/g, '');
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
  const row = { ...(rawRow || {}) };
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
  delete safe.password;
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
  const phone = normalizeIndianPhone(firstValue(payload, ['phone', 'number', 'mobile', 'contact_number', 'phone_number']));
  const qualification = firstValue(payload, ['qualification', 'qualification_level', 'degree']);
  const location = firstValue(payload, ['location', 'current_location']);
  const preferredLocation = firstValue(payload, ['preferred_location', 'preferred_city', 'preferred_loc']);
  const totalExperience = firstValueFromAliases(payload, ['total_experience', 'total_exp', 'experience', 'experience_months']);
  const relevantExperience = firstValueFromAliases(payload, ['relevant_experience', 'relevant_exp', 'relevant_experience_months']) || totalExperience;
  const inHandSalary = cleanAmount(firstValueFromAliases(payload, ['in_hand_salary', 'inhand_salary', 'monthly_inhand_salary', 'monthly_in_hand_salary', 'in_hand_monthly_salary', 'inhand_monthly_salary', 'salary', 'take_home_salary']));
  const ctcMonthly = cleanAmount(firstValueFromAliases(payload, ['ctc_monthly', 'monthly_ctc', 'monthly_ctc_salary', 'monthly_ctc_inr'])) || '';
  const process = firstValue(payload, ['process', 'jd', 'job_title', 'project']);
  const communicationSkill = firstValueFromAliases(payload, ['communication_skill', 'communication', 'english', 'communication_level']);
  const notes = firstValue(payload, ['notes', 'note', 'remarks']);
  const interviewDate = cleanDateOnly(firstValueFromAliases(payload, ['interview_reschedule_date', 'interview_date']));
  const assignedAt = nowIso();

  const recruiterCode = assignedUser?.recruiter_code || firstValue(payload, ['recruiter_code', 'owner_code']) || '';
  const recruiterName = assignedUser?.full_name || firstValue(payload, ['recruiter_name', 'owner_name']) || '';
  const recruiterDesignation = assignedUser?.designation || firstValue(payload, ['recruiter_designation']) || '';

  return {
    candidate_id: nextId('C', rows, 'candidate_id'),
    call_connected: firstValue(payload, ['call_connected']) || 'No',
    looking_for_job: firstValue(payload, ['looking_for_job']) || 'Yes',
    full_name: fullName,
    phone,
    qualification,
    location,
    preferred_location: preferredLocation || location || '',
    qualification_level: firstValue(payload, ['qualification_level']) || qualification || '',
    total_experience: totalExperience,
    relevant_experience: relevantExperience,
    in_hand_salary: inHandSalary,
    ctc_monthly: ctcMonthly,
    career_gap: firstValue(payload, ['career_gap']) || '',
    documents_availability: firstValue(payload, ['documents_availability', 'documents']) || '',
    communication_skill: communicationSkill || '',
    relevant_experience_range: relevantExperience ? calcExperienceRange(relevantExperience) : '',
    relevant_in_hand_range: inHandSalary ? calcSalaryRange(inHandSalary) : '',
    submission_date: firstValue(payload, ['submission_date']) || '',
    process,
    recruiter_code: recruiterCode,
    recruiter_name: recruiterName,
    recruiter_designation: recruiterDesignation,
    status: firstValue(payload, ['status']) || 'In - Progress',
    all_details_sent: firstValue(payload, ['all_details_sent']) || 'Pending',
    interview_availability: firstValue(payload, ['interview_availability']) || '',
    interview_reschedule_date: interviewDate,
    virtual_onsite: firstValue(payload, ['virtual_onsite']) || '',
    follow_up_at: firstValue(payload, ['follow_up_at']) || '',
    follow_up_note: firstValue(payload, ['follow_up_note']) || '',
    follow_up_status: firstValue(payload, ['follow_up_status']) || 'Open',
    approval_status: firstValue(payload, ['approval_status']) || 'Draft',
    approval_requested_at: firstValue(payload, ['approval_requested_at']) || '',
    approved_at: firstValue(payload, ['approved_at']) || '',
    approved_by_name: firstValue(payload, ['approved_by_name']) || '',
    is_duplicate: firstValue(payload, ['is_duplicate']) || '0',
    data_uploading_date: firstValue(payload, ['data_uploading_date']) || uploadStampLocal(),
    data_notes: firstValue(payload, ['data_notes']) || '',
    duplicate_reason: firstValue(payload, ['duplicate_reason']) || '',
    source_sr_no: firstValue(payload, ['source_sr_no']) || '',
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
    status: firstValue(payload, ['status']) || 'In - Progress',
    approval_status: firstValue(payload, ['approval_status']) || 'Draft',
    all_details_sent: firstValue(payload, ['all_details_sent']) || 'Pending',
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
  const activity = (await table('activity_log'))
    .filter((row) => ['crm_locked','crm_unlocked','unlock_requested','break_started','break_ended','join_work'].includes(String(row.action_type || '').toLowerCase()))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, 100);
  const unlocks = (await table('unlock_requests')).sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || ''))).slice(0, 50);
  return { activity, unlocks };
}

async function dashboard(req, res) {
  return res.json({
    users: (await table('users')).map(sanitizeUser),
    notes_count: await noteCounts(),
    lock_settings: await getSettingsMap(),
    lock_logs: await lockLogs(),
    onboarding_requests: (await table('user_onboarding_requests')).slice().sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || ''))).slice(0, 100),
    password_reset_requests: (await table('password_reset_requests')).slice().sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || ''))).slice(0, 100),
  });
}

async function updateLockSettings(req, res) {
  const next = await setSettingsMap(req.body || {});
  return res.json({ lock_settings: next });
}

async function importCandidates(req, res) {
  const users = await table('users');
  const allRows = await table('candidates');
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const assigneeUserId = String(req.body?.assignee_user_id || '').trim();
  const replaceRecruiterFromSheet = Boolean(req.body?.replace_recruiter_from_sheet);
  const assignedUser = assigneeUserId ? users.find((user) => String(user.user_id) === assigneeUserId) : null;
  const sharedDataNotes = String(req.body?.data_notes || '').trim();
  const sharedUploadingDate = String(req.body?.data_uploading_date || '').trim();

  if (!rows.length) return res.status(400).json({ message: 'No rows supplied for import.' });

  const inserted = [];
  const duplicates = [];
  const replaced = [];
  const updated = [];
  const skipped = [];
  for (const row of rows) {
    const effectiveAssignedUser = replaceRecruiterFromSheet ? assignedUser : null;
    const mergedRow = {
      ...(row || {}),
      data_notes: sharedDataNotes || firstValue(row, ['data_notes']) || '',
      data_uploading_date: sharedUploadingDate || firstValue(row, ['data_uploading_date']) || uploadStampLocal(),
    };
    const nextItem = buildImportedCandidate(allRows, mergedRow, req.user, effectiveAssignedUser || assignedUser);
    const importedCandidateId = firstValue(normalizeImportedCandidateRow(mergedRow), ['candidate_id']);

    if (!nextItem.full_name || !nextItem.phone) {
      skipped.push({ name: nextItem.full_name || '', phone: nextItem.phone || '', reason: 'Name or Number missing' });
      continue;
    }

    if (!replaceRecruiterFromSheet && !assignedUser) {
      const sheetCode = firstValue(mergedRow, ['recruiter_code', 'owner_code']);
      const sheetName = firstValue(mergedRow, ['recruiter_name', 'owner_name']);
      const sheetUser = users.find((user) => {
        if (sheetCode && lower(user.recruiter_code) === lower(sheetCode)) return true;
        if (sheetName && lower(user.full_name) === lower(sheetName)) return true;
        return false;
      });
      if (sheetUser) {
        nextItem.recruiter_code = sheetUser.recruiter_code || nextItem.recruiter_code;
        nextItem.recruiter_name = sheetUser.full_name || nextItem.recruiter_name;
        nextItem.recruiter_designation = sheetUser.designation || nextItem.recruiter_designation;
        nextItem.employee_code = sheetUser.recruiter_code || nextItem.employee_code || nextItem.recruiter_code;
        nextItem.employee_no = nextItem.employee_no || sheetUser.recruiter_code || nextItem.recruiter_code;
        nextItem.employee_name = sheetUser.full_name || nextItem.employee_name || nextItem.recruiter_name;
      }
    }

    const exactExisting = importedCandidateId
      ? allRows.find((item) => String(item.candidate_id || '') === String(importedCandidateId))
      : null;

    if (exactExisting) {
      const updatePayload = {
        ...exactExisting,
        ...nextItem,
        candidate_id: exactExisting.candidate_id,
        created_at: exactExisting.created_at || nextItem.created_at,
        updated_at: nowIso(),
        call_connected: firstValue(mergedRow, ['call_connected']) || exactExisting.call_connected || nextItem.call_connected || '',
        source_sr_no: nextItem.source_sr_no || exactExisting.source_sr_no || '',
        is_duplicate: firstValue(mergedRow, ['is_duplicate']) || exactExisting.is_duplicate || '0',
        data_uploading_date: firstValue(mergedRow, ['data_uploading_date']) || exactExisting.data_uploading_date || uploadStampLocal(),
        data_notes: firstValue(mergedRow, ['data_notes']) || exactExisting.data_notes || '',
        duplicate_reason: firstValue(mergedRow, ['duplicate_reason']) || exactExisting.duplicate_reason || '',
      };
      const saved = await updateCandidateSafe(exactExisting.candidate_id, updatePayload);
      const idx = allRows.findIndex((item) => String(item.candidate_id) === String(exactExisting.candidate_id));
      if (idx >= 0) allRows[idx] = saved || updatePayload;
      updated.push(saved || updatePayload);
      continue;
    }

    const existing = allRows.find((item) => String(item.phone || '') === String(nextItem.phone || '') && String(item.is_duplicate || '0') !== '1');
    if (existing) {
      const existingMeaningful = hasMeaningfulCandidateDetails(existing);
      const nextMeaningful = hasMeaningfulCandidateDetails(nextItem);
      if (existingMeaningful && !nextMeaningful) {
        nextItem.is_duplicate = '1';
        attachDuplicateMeta(nextItem, existing, `Kept filled profile ${existing.candidate_id}. New upload moved to Duplicate Profiles.`, 'duplicate_held');
        allRows.push(nextItem);
        duplicates.push(await insertCandidateSafe(nextItem));
        continue;
      }

      const archivedOld = { ...existing, is_duplicate: '1', updated_at: nowIso() };
      const replaceReason = (!existingMeaningful && !nextMeaningful)
        ? `Newest blank profile ${nextItem.candidate_id} kept in main Candidates. Older blank profile ${existing.candidate_id} moved to Duplicate Profiles.`
        : `Older incomplete profile replaced by ${nextItem.candidate_id}.`;
      attachDuplicateMeta(archivedOld, nextItem, replaceReason, 'replaced_with_new');
      await updateCandidateSafe(existing.candidate_id, archivedOld);
      const idx = allRows.findIndex((item) => String(item.candidate_id) === String(existing.candidate_id));
      if (idx >= 0) allRows[idx] = archivedOld;

      nextItem.is_duplicate = '0';
      nextItem.source_sr_no = nextItem.source_sr_no || existing.candidate_id;
      allRows.push(nextItem);
      replaced.push(await insertCandidateSafe(nextItem));
      continue;
    }

    allRows.push(nextItem);
    inserted.push(await insertCandidateSafe(nextItem));
  }

  clearAllCaches();
  return res.json({
    inserted_count: inserted.length + duplicates.length + replaced.length + updated.length,
    skipped_count: skipped.length,
    items: [...inserted, ...duplicates, ...replaced, ...updated].slice(0, 20),
    skipped: skipped.slice(0, 20),
    summary: { inserted: inserted.length, duplicates: duplicates.length, replaced: replaced.length, updated: updated.length, skipped: skipped.length },
  });
}



async function importHotLeads(req, res) {
  const users = await table('users');
  const allRows = await table('candidates');
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const assigneeUserId = String(req.body?.assignee_user_id || '').trim();
  const replaceRecruiterFromSheet = Boolean(req.body?.replace_recruiter_from_sheet);
  const assignedUser = assigneeUserId ? users.find((user) => String(user.user_id) === assigneeUserId) : null;

  if (!rows.length) return res.status(400).json({ message: 'No Hot Lead rows supplied.' });

  const inserted = [];
  const updated = [];
  const skipped = [];
  for (const row of rows) {
    const normalizedRow = normalizeImportedCandidateRow(row);
    const sheetEmployeeCode = firstValue(normalizedRow, ['employee_code', 'employee_no', 'recruiter_code', 'owner_code', 'employee_id']);
    const sheetEmployeeName = firstValue(normalizedRow, ['employee_name', 'recruiter_name', 'owner_name']);
    const sheetUser = users.find((user) => {
      if (sheetEmployeeCode && (
        lower(user.recruiter_code) === lower(sheetEmployeeCode)
        || lower(user.employee_code) === lower(sheetEmployeeCode)
        || lower(user.user_id) === lower(sheetEmployeeCode)
      )) return true;
      if (sheetEmployeeName && lower(user.full_name) === lower(sheetEmployeeName)) return true;
      return false;
    });
    const effectiveAssignedUser = (replaceRecruiterFromSheet && assignedUser) ? assignedUser : (sheetUser || assignedUser || null);
    const nextItem = buildImportedHotLead(allRows, normalizedRow, req.user, effectiveAssignedUser);
    if (!nextItem.full_name && !nextItem.phone) {
      skipped.push({ name: nextItem.full_name || '', phone: nextItem.phone || '', reason: 'Name and Number both missing' });
      continue;
    }

    if (!replaceRecruiterFromSheet && !assignedUser) {
      const sheetCode = firstValue(normalizedRow || row, ['employee_code', 'employee_no', 'recruiter_code', 'owner_code', 'employee_id']);
      const sheetName = firstValue(normalizedRow || row, ['employee_name', 'recruiter_name', 'owner_name']);
      const sheetUser = users.find((user) => {
        if (sheetCode && lower(user.recruiter_code) === lower(sheetCode)) return true;
        if (sheetName && lower(user.full_name) === lower(sheetName)) return true;
        return false;
      });
      if (sheetUser) {
        nextItem.recruiter_code = sheetUser.recruiter_code || nextItem.recruiter_code;
        nextItem.recruiter_name = sheetUser.full_name || nextItem.recruiter_name;
        nextItem.recruiter_designation = sheetUser.designation || nextItem.recruiter_designation;
        nextItem.employee_code = sheetUser.recruiter_code || nextItem.employee_code || nextItem.recruiter_code;
        nextItem.employee_no = nextItem.employee_no || sheetUser.recruiter_code || nextItem.recruiter_code;
        nextItem.employee_name = sheetUser.full_name || nextItem.employee_name || nextItem.recruiter_name;
      }
    }

    const existing = nextItem.phone ? allRows.find((item) => String(item.phone || '') === String(nextItem.phone || '') && String(item.is_duplicate || '0') !== '1') : null;
    if (existing) {
      const payload = {
        ...existing,
        ...nextItem,
        candidate_id: existing.candidate_id,
        created_at: existing.created_at || nextItem.created_at,
        updated_at: nowIso(),
        lead_source: 'hot_lead',
        data_uploading_date: existing.data_uploading_date || nextItem.data_uploading_date || uploadStampLocal(),
      };
      const saved = await updateCandidateSafe(existing.candidate_id, payload);
      const idx = allRows.findIndex((item) => String(item.candidate_id) === String(existing.candidate_id));
      if (idx >= 0) allRows[idx] = saved || payload;
      updated.push(saved || payload);
      continue;
    }

    allRows.push(nextItem);
    inserted.push(await insertCandidateSafe(nextItem));
  }

  clearAllCaches();
  return res.json({
    inserted_count: inserted.length + updated.length,
    skipped_count: skipped.length,
    items: [...inserted, ...updated].slice(0, 20),
    skipped: skipped.slice(0, 20),
    summary: { inserted: inserted.length, updated: updated.length, skipped: skipped.length },
  });
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
        name: tableLabels[tableName] || tableName.replace(/_/g, ' ').replace(/\w/g, (m) => m.toUpperCase()),
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

async function exportCandidateUpdatedTemplate(req, res) {
  const workbook = buildWorkbookXml([
    {
      name: 'Candidate Data',
      rows: [
        {
          'Name': '',
          'Number': '',
          'Location': '',
          'Qualification': '',
          'Total Experience': '',
          'Relevant Experience': '',
          'Monthly CTC': '',
          'Monthly In-hand Salary': '',
          'Communication Skill': '',
          'Interview Date': '',
          'Process': '',
          'Data Notes': '',
        },
      ],
      fallbackColumns: CANDIDATE_UPDATED_IMPORT_TEMPLATE_COLUMNS,
    },
  ], 'Candidate Data');
  res.setHeader('Content-Type', 'application/vnd.ms-excel');
  res.setHeader('Content-Disposition', 'attachment; filename="career-crox-blank-template-updated.xls"');
  return res.send(workbook);
}


async function exportHotLeadsTemplate(req, res) {
  const emptyRow = Object.fromEntries(HOT_LEADS_IMPORT_TEMPLATE_COLUMNS.map((column) => [column, '']));
  const workbook = buildWorkbookXml([
    {
      name: 'Hot Leads',
      rows: [emptyRow],
      fallbackColumns: HOT_LEADS_IMPORT_TEMPLATE_COLUMNS,
    },
  ], 'Hot Leads');
  res.setHeader('Content-Type', 'application/vnd.ms-excel');
  res.setHeader('Content-Disposition', 'attachment; filename="career-crox-hot-leads-format.xls"');
  return res.send(workbook);
}

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

module.exports = {
  dashboard,
  updateLockSettings,
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
