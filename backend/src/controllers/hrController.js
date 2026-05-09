const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { store } = require('../lib/store');
const { nowIso, nextId, toNumber } = require('../lib/helpers');
const {
  DOCUMENT_TYPES,
  TEMPLATE_DIR,
  defaultTemplate,
  collectDocumentFields,
  mergeData,
  renderStandardHtml,
  buildStandardPdf,
  inspectTemplatePdf,
  applyPdfTemplate,
  saveOutputFiles,
} = require('../lib/hrDocuments');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

function normalizeText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function ymd(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

async function allRows(table) {
  try {
    return await store.all(table);
  } catch {
    return [];
  }
}

async function ensureTemplates() {
  const templates = await allRows('hr_document_templates');
  for (const docType of DOCUMENT_TYPES) {
    if (!templates.find((row) => row.document_type === docType.key && String(row.is_active || '1') === '1')) {
      const all = await allRows('hr_document_templates');
      const template_id = nextId('HRTPL', all, 'template_id');
      await store.insert('hr_document_templates', {
        template_id,
        ...defaultTemplate(docType.key),
        created_at: nowIso(),
        updated_at: nowIso(),
        field_map_json: {},
        extracted_fields_json: [],
      });
    }
  }
}

function serializeTemplate(row) {
  return {
    ...row,
    field_map_json: typeof row.field_map_json === 'string' ? safeParse(row.field_map_json, {}) : (row.field_map_json || {}),
    extracted_fields_json: typeof row.extracted_fields_json === 'string' ? safeParse(row.extracted_fields_json, []) : (row.extracted_fields_json || []),
    company_defaults_json: typeof row.company_defaults_json === 'string' ? safeParse(row.company_defaults_json, {}) : (row.company_defaults_json || {}),
  };
}

function safeParse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function standardEmployeePayload(body = {}) {
  return {
    employee_code: normalizeText(body.employee_code),
    full_name: normalizeText(body.full_name),
    phone: normalizeText(body.phone),
    email: normalizeText(body.email),
    designation: normalizeText(body.designation),
    department: normalizeText(body.department),
    employment_status: normalizeText(body.employment_status || 'active'),
    work_location: normalizeText(body.work_location || 'Office'),
    shift_start: normalizeText(body.shift_start || '10:00'),
    shift_end: normalizeText(body.shift_end || '19:00'),
    weekly_off: normalizeText(body.weekly_off || 'Sunday'),
    date_of_joining: normalizeText(body.date_of_joining),
    offer_date: normalizeText(body.offer_date),
    probation_period: normalizeText(body.probation_period || '3 Months'),
    reporting_manager: normalizeText(body.reporting_manager),
    salary_monthly: toNumber(body.salary_monthly),
    salary_in_hand: toNumber(body.salary_in_hand),
    incentives_default: toNumber(body.incentives_default),
    bank_name: normalizeText(body.bank_name),
    account_number: normalizeText(body.account_number),
    ifsc_code: normalizeText(body.ifsc_code),
    pan_number: normalizeText(body.pan_number),
    aadhar_number: normalizeText(body.aadhar_number),
    birthday: normalizeText(body.birthday),
    address: normalizeText(body.address),
    emergency_contact: normalizeText(body.emergency_contact),
    notes: normalizeText(body.notes),
  };
}

function standardAttendancePayload(body = {}) {
  const workMinutes = Number(body.work_minutes || 0);
  return {
    work_date: normalizeText(body.work_date || ymd()),
    login_time: normalizeText(body.login_time),
    logout_time: normalizeText(body.logout_time),
    work_minutes: workMinutes,
    half_day_flag: String(body.half_day_flag === true || String(body.half_day_flag) === '1' ? '1' : '0'),
    full_day_flag: String(body.full_day_flag === true || String(body.full_day_flag) === '1' ? '1' : (workMinutes >= 480 ? '1' : '0')),
    attendance_status: normalizeText(body.attendance_status || (workMinutes >= 240 ? 'present' : 'short-day')),
    late_minutes: Number(body.late_minutes || 0),
    break_minutes: Number(body.break_minutes || 0),
    remark: normalizeText(body.remark),
  };
}

function standardWorklogPayload(body = {}) {
  return {
    work_date: normalizeText(body.work_date || ymd()),
    task_summary: normalizeText(body.task_summary),
    target_units: Number(body.target_units || 0),
    completed_units: Number(body.completed_units || 0),
    pending_units: Number(body.pending_units || 0),
    qa_score: Number(body.qa_score || 0),
    incentive_amount: Number(body.incentive_amount || 0),
    note: normalizeText(body.note),
  };
}

function standardLeavePayload(body = {}) {
  return {
    leave_date: normalizeText(body.leave_date || ymd()),
    leave_type: normalizeText(body.leave_type || 'casual'),
    leave_days: Number(body.leave_days || 1),
    paid_flag: String(body.paid_flag === true || String(body.paid_flag) === '1' ? '1' : '0'),
    status: normalizeText(body.status || 'approved'),
    reason: normalizeText(body.reason),
  };
}

function standardStagePayload(body = {}) {
  return {
    event_date: normalizeText(body.event_date || ymd()),
    stage_key: normalizeText(body.stage_key || 'screening'),
    stage_label: normalizeText(body.stage_label || body.stage_key || 'Screening'),
    note: normalizeText(body.note),
  };
}

function monthKey(value = '') {
  return String(value || '').slice(0, 7);
}

function formatHours(minutes = 0) {
  const total = Number(minutes || 0);
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return `${hours}h ${String(mins).padStart(2, '0')}m`;
}

function upcomingBirthdays(employees = []) {
  const today = new Date();
  return employees
    .filter((row) => String(row.birthday || '').slice(5))
    .map((row) => {
      const mmdd = String(row.birthday || '').slice(5);
      const next = new Date(`${today.getFullYear()}-${mmdd}T00:00:00`);
      if (Number.isNaN(next.getTime())) return null;
      if (next < today) next.setFullYear(today.getFullYear() + 1);
      const diff = Math.ceil((next.getTime() - today.getTime()) / 86400000);
      return { ...row, birthday_countdown: diff };
    })
    .filter(Boolean)
    .sort((a, b) => a.birthday_countdown - b.birthday_countdown)
    .slice(0, 6);
}

function buildDocumentPayload(employee = {}, body = {}, template = {}) {
  return mergeData(template, {
    employee_name: employee.full_name || body.employee_name || '',
    employee_code: employee.employee_code || body.employee_code || '',
    designation: employee.designation || body.designation || '',
    department: employee.department || body.department || '',
    date_of_joining: employee.date_of_joining || body.date_of_joining || '',
    salary_monthly: body.salary_monthly || employee.salary_monthly || 0,
    salary_in_hand: body.salary_in_hand || employee.salary_in_hand || 0,
    incentives: body.incentives || employee.incentives_default || 0,
    work_location: body.work_location || employee.work_location || '',
    shift_timing: body.shift_timing || [employee.shift_start, employee.shift_end].filter(Boolean).join(' - '),
    weekly_off: body.weekly_off || employee.weekly_off || '',
    reporting_manager: body.reporting_manager || employee.reporting_manager || '',
    bank_name: body.bank_name || employee.bank_name || '',
    account_number: body.account_number || employee.account_number || '',
    issue_date: body.issue_date || ymd(),
    ...body,
  });
}

async function list(req, res) {
  await ensureTemplates();
  const [employees, attendance, worklogs, leaves, stages, templatesRaw, runs] = await Promise.all([
    allRows('hr_employees'),
    allRows('hr_attendance_logs'),
    allRows('hr_worklogs'),
    allRows('hr_leave_logs'),
    allRows('hr_stage_events'),
    allRows('hr_document_templates'),
    allRows('hr_document_runs'),
  ]);

  const templates = templatesRaw.map(serializeTemplate);
  const activeEmployees = employees.filter((row) => String(row.employment_status || 'active').toLowerCase() !== 'inactive');
  const today = ymd();
  const currentMonth = today.slice(0, 7);
  const todayAttendance = attendance.filter((row) => row.work_date === today);
  const monthAttendance = attendance.filter((row) => monthKey(row.work_date) === currentMonth);
  const monthWorklogs = worklogs.filter((row) => monthKey(row.work_date) === currentMonth);
  const monthLeaves = leaves.filter((row) => monthKey(row.leave_date) === currentMonth);

  const totalWorkMinutes = monthAttendance.reduce((sum, row) => sum + Number(row.work_minutes || 0), 0);
  const halfDays = monthAttendance.filter((row) => String(row.half_day_flag) === '1').length;
  const fullDays = monthAttendance.filter((row) => String(row.full_day_flag) === '1').length;
  const monthIncentive = monthWorklogs.reduce((sum, row) => sum + Number(row.incentive_amount || 0), 0);
  const totalCompletedUnits = monthWorklogs.reduce((sum, row) => sum + Number(row.completed_units || 0), 0);
  const totalPendingUnits = monthWorklogs.reduce((sum, row) => sum + Number(row.pending_units || 0), 0);
  const monthSalary = activeEmployees.reduce((sum, row) => sum + Number(row.salary_monthly || 0), 0);

  const employeeRows = activeEmployees.map((employee) => {
    const employeeAttendance = monthAttendance.filter((row) => row.employee_id === employee.employee_id);
    const employeeWorklogs = monthWorklogs.filter((row) => row.employee_id === employee.employee_id);
    const employeeLeaves = monthLeaves.filter((row) => row.employee_id === employee.employee_id);
    const employeeRuns = runs.filter((row) => row.employee_id === employee.employee_id);
    const presentDays = employeeAttendance.filter((row) => ['present','short-day'].includes(String(row.attendance_status || '').toLowerCase())).length;
    const hours = employeeAttendance.reduce((sum, row) => sum + Number(row.work_minutes || 0), 0);
    const incentive = employeeWorklogs.reduce((sum, row) => sum + Number(row.incentive_amount || 0), 0);
    const completed = employeeWorklogs.reduce((sum, row) => sum + Number(row.completed_units || 0), 0);
    const pending = employeeWorklogs.reduce((sum, row) => sum + Number(row.pending_units || 0), 0);
    const paidLeaves = employeeLeaves.filter((row) => String(row.paid_flag) === '1').reduce((sum, row) => sum + Number(row.leave_days || 0), 0);
    const unpaidLeaves = employeeLeaves.filter((row) => String(row.paid_flag) !== '1').reduce((sum, row) => sum + Number(row.leave_days || 0), 0);
    const salaryPerDay = Number(employee.salary_monthly || 0) / 30;
    const salaryEstimate = Math.max(0, Math.round((presentDays - (employeeAttendance.filter((row) => String(row.half_day_flag) === '1').length * 0.5) - unpaidLeaves) * salaryPerDay + incentive));
    return {
      ...employee,
      month_present_days: presentDays,
      month_work_minutes: hours,
      month_hours_label: formatHours(hours),
      month_completed_units: completed,
      month_pending_units: pending,
      month_incentive: incentive,
      month_paid_leaves: paidLeaves,
      month_unpaid_leaves: unpaidLeaves,
      month_generated_docs: employeeRuns.length,
      month_salary_estimate: salaryEstimate,
    };
  }).sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));

  const todayRows = activeEmployees.map((employee) => {
    const attendanceRow = todayAttendance.find((row) => row.employee_id === employee.employee_id) || null;
    const worklogRow = worklogs.find((row) => row.employee_id === employee.employee_id && row.work_date === today) || null;
    const leaveRow = leaves.find((row) => row.employee_id === employee.employee_id && row.leave_date === today) || null;
    return {
      employee_id: employee.employee_id,
      employee_name: employee.full_name,
      designation: employee.designation,
      login_time: attendanceRow?.login_time || '',
      logout_time: attendanceRow?.logout_time || '',
      work_minutes: Number(attendanceRow?.work_minutes || 0),
      work_hours: formatHours(attendanceRow?.work_minutes || 0),
      half_day: String(attendanceRow?.half_day_flag || '0') === '1',
      full_day: String(attendanceRow?.full_day_flag || '0') === '1',
      leave_type: leaveRow?.leave_type || '',
      leave_days: Number(leaveRow?.leave_days || 0),
      work_done: Number(worklogRow?.completed_units || 0),
      work_pending: Number(worklogRow?.pending_units || 0),
      incentive: Number(worklogRow?.incentive_amount || 0),
    };
  });

  return res.json({
    meta: {
      document_types: DOCUMENT_TYPES.map((row) => ({ key: row.key, label: row.label, fields: collectDocumentFields(row.key) })),
      current_month: currentMonth,
      today,
    },
    overview: {
      total_employees: activeEmployees.length,
      working_today: todayAttendance.length,
      total_work_hours: formatHours(totalWorkMinutes),
      total_work_minutes: totalWorkMinutes,
      half_days: halfDays,
      full_days: fullDays,
      total_completed_units: totalCompletedUnits,
      total_pending_units: totalPendingUnits,
      month_salary_commitment: monthSalary,
      month_incentive: monthIncentive,
      month_leave_entries: monthLeaves.length,
      birthdays_upcoming: upcomingBirthdays(activeEmployees),
    },
    employees: employeeRows,
    today_rows: todayRows,
    attendance: attendance.sort((a, b) => `${b.work_date}${b.login_time}`.localeCompare(`${a.work_date}${a.login_time}`)).slice(0, 300),
    worklogs: worklogs.sort((a, b) => `${b.work_date}${b.worklog_id || ''}`.localeCompare(`${a.work_date}${a.worklog_id || ''}`)).slice(0, 300),
    leaves: leaves.sort((a, b) => `${b.leave_date}${b.leave_id || ''}`.localeCompare(`${a.leave_date}${a.leave_id || ''}`)).slice(0, 300),
    stages: stages.sort((a, b) => `${b.event_date}${b.event_id || ''}`.localeCompare(`${a.event_date}${a.event_id || ''}`)).slice(0, 300),
    templates,
    document_runs: runs.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 200),
  });
}

async function createEmployee(req, res) {
  const rows = await allRows('hr_employees');
  const employee_id = nextId('HREMP', rows, 'employee_id');
  const payload = standardEmployeePayload(req.body);
  const item = await store.insert('hr_employees', {
    employee_id,
    ...payload,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  return res.json({ ok: true, item });
}

async function updateEmployee(req, res) {
  const payload = standardEmployeePayload(req.body);
  const item = await store.update('hr_employees', 'employee_id', req.params.employeeId, {
    ...payload,
    updated_at: nowIso(),
  });
  if (!item) return res.status(404).json({ message: 'Employee not found' });
  return res.json({ ok: true, item });
}

async function addAttendance(req, res) {
  const rows = await allRows('hr_attendance_logs');
  const item = await store.insert('hr_attendance_logs', {
    entry_id: nextId('HRAT', rows, 'entry_id'),
    employee_id: normalizeText(req.body.employee_id),
    ...standardAttendancePayload(req.body),
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  return res.json({ ok: true, item });
}

async function addWorklog(req, res) {
  const rows = await allRows('hr_worklogs');
  const item = await store.insert('hr_worklogs', {
    worklog_id: nextId('HRWL', rows, 'worklog_id'),
    employee_id: normalizeText(req.body.employee_id),
    ...standardWorklogPayload(req.body),
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  return res.json({ ok: true, item });
}

async function addLeave(req, res) {
  const rows = await allRows('hr_leave_logs');
  const item = await store.insert('hr_leave_logs', {
    leave_id: nextId('HRLV', rows, 'leave_id'),
    employee_id: normalizeText(req.body.employee_id),
    ...standardLeavePayload(req.body),
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  return res.json({ ok: true, item });
}

async function addStage(req, res) {
  const rows = await allRows('hr_stage_events');
  const item = await store.insert('hr_stage_events', {
    event_id: nextId('HRST', rows, 'event_id'),
    employee_id: normalizeText(req.body.employee_id),
    ...standardStagePayload(req.body),
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  return res.json({ ok: true, item });
}

async function uploadTemplate(req, res) {
  await ensureTemplates();
  const templateId = normalizeText(req.body.template_id);
  const templateRaw = await store.findById('hr_document_templates', 'template_id', templateId);
  if (!templateRaw) return res.status(404).json({ message: 'Template not found' });
  if (!req.file) return res.status(400).json({ message: 'Please choose a PDF template file' });
  const ext = path.extname(req.file.originalname || '').toLowerCase();
  if (ext !== '.pdf') return res.status(400).json({ message: 'Only PDF template upload is allowed' });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetName = `${templateId}-${stamp}.pdf`;
  const targetPath = path.join(TEMPLATE_DIR, targetName);
  fs.writeFileSync(targetPath, req.file.buffer);
  const inspection = await inspectTemplatePdf(req.file.buffer).catch(() => ({ pages: 1, fields: [] }));
  const fieldMap = inspection.fields.reduce((acc, field, idx) => {
    acc[`custom_field_${idx + 1}`] = { pdfFieldName: field.name, label: field.name, mode: 'pdf-field' };
    return acc;
  }, {});
  const updated = await store.update('hr_document_templates', 'template_id', templateId, {
    file_name: req.file.originalname,
    file_path: `generated/hr-head/templates/${targetName}`,
    file_url: `/generated/hr-head/templates/${targetName}`,
    extracted_fields_json: inspection.fields,
    field_map_json: inspection.fields.length ? fieldMap : (serializeTemplate(templateRaw).field_map_json || {}),
    mode: inspection.fields.length ? 'fillable_pdf' : 'overlay_pdf',
    updated_at: nowIso(),
  });
  return res.json({ ok: true, item: serializeTemplate(updated), inspection });
}

async function saveTemplateConfig(req, res) {
  await ensureTemplates();
  const templateId = normalizeText(req.body.template_id);
  const currentRaw = await store.findById('hr_document_templates', 'template_id', templateId);
  if (!currentRaw) return res.status(404).json({ message: 'Template not found' });
  const current = serializeTemplate(currentRaw);
  const nextDefaults = {
    ...(current.company_defaults_json || {}),
    ...(req.body.company_defaults_json || {}),
  };
  const item = await store.update('hr_document_templates', 'template_id', templateId, {
    template_name: normalizeText(req.body.template_name || current.template_name || 'Template'),
    mode: normalizeText(req.body.mode || current.mode || 'standard'),
    template_html: req.body.template_html ?? current.template_html ?? '',
    field_map_json: req.body.field_map_json ?? current.field_map_json ?? {},
    company_defaults_json: nextDefaults,
    is_active: String(req.body.is_active ?? current.is_active ?? '1'),
    updated_at: nowIso(),
  });
  return res.json({ ok: true, item: serializeTemplate(item) });
}

async function generateDocument(req, res) {
  await ensureTemplates();
  const documentType = normalizeText(req.body.document_type || 'offer_letter');
  const templateId = normalizeText(req.body.template_id);
  const employeeId = normalizeText(req.body.employee_id);
  const [employees, templatesRaw, runs] = await Promise.all([
    allRows('hr_employees'),
    allRows('hr_document_templates'),
    allRows('hr_document_runs'),
  ]);
  const employee = employees.find((row) => row.employee_id === employeeId) || {};
  const template = serializeTemplate(
    (templateId ? templatesRaw.find((row) => row.template_id === templateId) : null)
    || templatesRaw.find((row) => row.document_type === documentType && String(row.is_active || '1') === '1')
    || defaultTemplate(documentType)
  );
  const payload = buildDocumentPayload(employee, req.body.form_data_json || {}, template);
  const html = renderStandardHtml(template, payload);
  const pdfBytes = template.file_path ? await applyPdfTemplate(template, payload) : await buildStandardPdf(template, payload);
  const files = saveOutputFiles(documentType, payload.employee_name || employee.full_name || 'employee', html, pdfBytes);
  const run = await store.insert('hr_document_runs', {
    run_id: nextId('HRDOC', runs, 'run_id'),
    template_id: template.template_id || '',
    document_type: documentType,
    employee_id: employee.employee_id || employeeId || '',
    employee_name: payload.employee_name || '',
    file_name: files.file_name,
    file_url: files.pdf_url,
    preview_url: files.html_url,
    form_data_json: payload,
    created_at: nowIso(),
  });
  return res.json({ ok: true, item: run, file_url: files.pdf_url, preview_url: files.html_url });
}

module.exports = {
  uploadMiddleware: upload.single('template_file'),
  list,
  createEmployee,
  updateEmployee,
  addAttendance,
  addWorklog,
  addLeave,
  addStage,
  uploadTemplate,
  saveTemplateConfig,
  generateDocument,
};
