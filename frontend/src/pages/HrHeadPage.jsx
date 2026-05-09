
import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';

const tabs = [
  { key: 'overview', label: 'HR Dashboard' },
  { key: 'team', label: 'Team & Salary' },
  { key: 'attendance', label: 'Attendance & Work' },
  { key: 'documents', label: 'Letters & Slips' },
];

const employeeInitial = {
  employee_code: '',
  full_name: '',
  phone: '',
  email: '',
  designation: '',
  department: 'HR',
  employment_status: 'active',
  work_location: 'Office',
  shift_start: '10:00',
  shift_end: '19:00',
  weekly_off: 'Sunday',
  date_of_joining: '',
  offer_date: '',
  probation_period: '3 Months',
  reporting_manager: '',
  salary_monthly: '',
  salary_in_hand: '',
  incentives_default: '',
  bank_name: '',
  account_number: '',
  ifsc_code: '',
  pan_number: '',
  aadhar_number: '',
  birthday: '',
  address: '',
  emergency_contact: '',
  notes: '',
};

const attendanceInitial = {
  employee_id: '',
  work_date: new Date().toISOString().slice(0, 10),
  login_time: '',
  logout_time: '',
  work_minutes: '',
  late_minutes: '',
  break_minutes: '',
  half_day_flag: false,
  full_day_flag: false,
  attendance_status: 'present',
  remark: '',
};

const worklogInitial = {
  employee_id: '',
  work_date: new Date().toISOString().slice(0, 10),
  task_summary: '',
  target_units: '',
  completed_units: '',
  pending_units: '',
  qa_score: '',
  incentive_amount: '',
  note: '',
};

const leaveInitial = {
  employee_id: '',
  leave_date: new Date().toISOString().slice(0, 10),
  leave_type: 'casual',
  leave_days: 1,
  paid_flag: true,
  status: 'approved',
  reason: '',
};

const stageInitial = {
  employee_id: '',
  event_date: new Date().toISOString().slice(0, 10),
  stage_key: 'screening',
  stage_label: 'Screening',
  note: '',
};

const preferredDocFieldOrder = [
  'issue_date',
  'salary_month',
  'employee_name',
  'employee_code',
  'designation',
  'department',
  'date_of_joining',
  'last_working_date',
  'salary_monthly',
  'salary_in_hand',
  'basic_salary',
  'allowances',
  'incentives',
  'deductions',
  'net_salary',
  'working_days',
  'present_days',
  'half_days',
  'paid_leaves',
  'unpaid_leaves',
  'late_marks',
  'work_location',
  'shift_timing',
  'weekly_off',
  'probation_period',
  'reporting_manager',
  'bank_name',
  'account_number',
  'company_name',
  'company_address',
  'hr_signatory',
  'clearance_note',
];

const quickDocTypes = {
  offer_letter: 'Offer',
  joining_letter: 'Joining',
  salary_slip: 'Salary Slip',
  experience_letter: 'Experience',
  relieving_letter: 'Relieving',
};

function rupee(value) {
  const amount = Number(value || 0);
  return `₹${amount.toLocaleString('en-IN')}`;
}

function formatHoursFromMinutes(minutes) {
  const total = Number(minutes || 0);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

function titleFromKey(value = '') {
  return String(value || '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function calculateMinutesFromTimes(loginTime, logoutTime) {
  if (!loginTime || !logoutTime) return 0;
  const [loginH = 0, loginM = 0] = String(loginTime).split(':').map((n) => Number(n || 0));
  const [logoutH = 0, logoutM = 0] = String(logoutTime).split(':').map((n) => Number(n || 0));
  const start = (loginH * 60) + loginM;
  const end = (logoutH * 60) + logoutM;
  if (end <= start) return 0;
  return end - start;
}

function buildDocDefaults(documentType, employee = {}, template = {}) {
  const now = new Date().toISOString().slice(0, 10);
  const shiftTiming = [employee.shift_start, employee.shift_end].filter(Boolean).join(' - ');
  const monthLabel = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const payload = {
    issue_date: now,
    salary_month: monthLabel,
    employee_name: employee.full_name || '',
    employee_code: employee.employee_code || '',
    designation: employee.designation || '',
    department: employee.department || '',
    date_of_joining: employee.date_of_joining || '',
    last_working_date: employee.last_working_date || '',
    salary_monthly: employee.salary_monthly || '',
    salary_in_hand: employee.salary_in_hand || '',
    basic_salary: employee.salary_monthly ? Math.round(Number(employee.salary_monthly) * 0.55) : '',
    allowances: employee.salary_monthly ? Math.round(Number(employee.salary_monthly) * 0.25) : '',
    incentives: employee.incentives_default || '',
    deductions: '',
    net_salary: employee.salary_in_hand || '',
    work_location: employee.work_location || '',
    shift_timing: shiftTiming || '',
    weekly_off: employee.weekly_off || '',
    probation_period: employee.probation_period || '3 Months',
    reporting_manager: employee.reporting_manager || '',
    hr_signatory: template.company_defaults_json?.hr_signatory || 'HR Head',
    company_name: template.company_defaults_json?.company_name || 'Career Crox',
    company_address: template.company_defaults_json?.company_address || 'Office Address',
    bank_name: employee.bank_name || '',
    account_number: employee.account_number || '',
    working_days: 30,
    present_days: '',
    half_days: '',
    paid_leaves: '',
    unpaid_leaves: '',
    late_marks: '',
    clearance_note: 'No dues pending',
  };
  if (documentType === 'offer_letter') payload.incentives = employee.incentives_default || 'As per company policy';
  return payload;
}

function metricTone(index) {
  const tones = [
    'linear-gradient(135deg,#6f77ff 0%,#61b2ff 100%)',
    'linear-gradient(135deg,#00b894 0%,#55efc4 100%)',
    'linear-gradient(135deg,#ff7b54 0%,#ffb26b 100%)',
    'linear-gradient(135deg,#9b5cff 0%,#e977ff 100%)',
    'linear-gradient(135deg,#ff4f81 0%,#ff9a8b 100%)',
    'linear-gradient(135deg,#0ea5e9 0%,#22d3ee 100%)',
  ];
  return tones[index % tones.length];
}

function buildAttendancePayload(form) {
  const calculated = Number(form.work_minutes || 0) || calculateMinutesFromTimes(form.login_time, form.logout_time);
  let status = String(form.attendance_status || 'present').toLowerCase();
  let halfDay = false;
  let fullDay = false;

  if (status === 'half_day') {
    status = 'present';
    halfDay = true;
  } else if (status === 'full_day') {
    status = 'present';
    fullDay = true;
  } else if (status === 'short_day') {
    status = 'short-day';
    halfDay = true;
  } else {
    halfDay = calculated >= 240 && calculated < 480;
    fullDay = calculated >= 480;
  }

  if (status === 'absent') {
    halfDay = false;
    fullDay = false;
  }

  return {
    ...form,
    work_minutes: calculated,
    attendance_status: status,
    half_day_flag: halfDay,
    full_day_flag: fullDay,
  };
}

function buildWorklogPayload(form) {
  const target = Number(form.target_units || 0);
  const completed = Number(form.completed_units || 0);
  const pending = form.pending_units === '' ? Math.max(0, target - completed) : Number(form.pending_units || 0);
  return {
    ...form,
    target_units: target,
    completed_units: completed,
    pending_units: pending,
    qa_score: Number(form.qa_score || 0),
    incentive_amount: Number(form.incentive_amount || 0),
  };
}

export default function HrHeadPage() {
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [data, setData] = useState({
    meta: { document_types: [] },
    overview: {},
    employees: [],
    today_rows: [],
    attendance: [],
    worklogs: [],
    leaves: [],
    stages: [],
    templates: [],
    document_runs: [],
  });
  const [employeeForm, setEmployeeForm] = useState(employeeInitial);
  const [editingEmployeeId, setEditingEmployeeId] = useState('');
  const [attendanceForm, setAttendanceForm] = useState(attendanceInitial);
  const [worklogForm, setWorklogForm] = useState(worklogInitial);
  const [leaveForm, setLeaveForm] = useState(leaveInitial);
  const [stageForm, setStageForm] = useState(stageInitial);
  const [docType, setDocType] = useState('offer_letter');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [docForm, setDocForm] = useState({});
  const [templateDraft, setTemplateDraft] = useState({ template_name: '', mode: 'standard', template_html: '', company_defaults_json: {}, field_map_json: {} });
  const [templateFile, setTemplateFile] = useState(null);
  const [busy, setBusy] = useState(false);

  async function loadData(silent = false) {
    if (!silent) setLoading(true);
    try {
      const next = await api.get('/api/hr/head', { cacheTtlMs: 0, retries: 1 });
      setData(next);
      const primaryType = next.meta.document_types?.[0]?.key || 'offer_letter';
      if (!docType) setDocType(primaryType);
      setError('');
    } catch (err) {
      setError(err.message || 'HR Head load failed');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const employees = data.employees || [];
  const overview = data.overview || {};
  const documentTypes = data.meta?.document_types || [];
  const selectedEmployee = useMemo(
    () => employees.find((row) => row.employee_id === selectedEmployeeId) || null,
    [employees, selectedEmployeeId],
  );

  const selectedTemplate = useMemo(() => {
    return (data.templates || []).find((row) => row.template_id === selectedTemplateId)
      || (data.templates || []).find((row) => row.document_type === docType && String(row.is_active || '1') === '1')
      || (data.templates || []).find((row) => row.document_type === docType)
      || null;
  }, [data.templates, selectedTemplateId, docType]);

  const selectedDocTypeMeta = useMemo(
    () => documentTypes.find((row) => row.key === docType) || documentTypes[0] || { fields: [] },
    [documentTypes, docType],
  );

  const orderedDocFields = useMemo(() => {
    const metaFields = selectedDocTypeMeta.fields || [];
    const preferred = preferredDocFieldOrder.filter((field) => metaFields.includes(field));
    const extras = metaFields.filter((field) => !preferred.includes(field));
    return [...preferred, ...extras];
  }, [selectedDocTypeMeta]);

  const basicDocFields = orderedDocFields.slice(0, 10);
  const advancedDocFields = orderedDocFields.slice(10);
  const monthlyRows = useMemo(
    () => [...employees].sort((a, b) => Number(b.month_salary_estimate || 0) - Number(a.month_salary_estimate || 0)),
    [employees],
  );

  useEffect(() => {
    if (!employees.length) return;
    if (!selectedEmployeeId) setSelectedEmployeeId(employees[0].employee_id);
  }, [employees, selectedEmployeeId]);

  useEffect(() => {
    if (!documentTypes.length) return;
    if (!docType) setDocType(documentTypes[0].key);
  }, [documentTypes, docType]);

  useEffect(() => {
    const active = (data.templates || []).find((row) => row.document_type === docType && String(row.is_active || '1') === '1')
      || (data.templates || []).find((row) => row.document_type === docType)
      || null;
    if (!active) return;
    setSelectedTemplateId(active.template_id);
    setTemplateDraft({
      template_name: active.template_name || '',
      mode: active.mode || 'standard',
      template_html: active.template_html || '',
      company_defaults_json: active.company_defaults_json || {},
      field_map_json: active.field_map_json || {},
    });
    setDocForm((current) => ({
      ...buildDocDefaults(docType, selectedEmployee || {}, active),
      ...current,
    }));
  }, [docType, data.templates]);

  useEffect(() => {
    if (!selectedEmployee) return;
    setAttendanceForm((current) => ({ ...current, employee_id: selectedEmployee.employee_id }));
    setWorklogForm((current) => ({ ...current, employee_id: selectedEmployee.employee_id }));
    setLeaveForm((current) => ({ ...current, employee_id: selectedEmployee.employee_id }));
    setStageForm((current) => ({ ...current, employee_id: selectedEmployee.employee_id }));
    setDocForm((current) => ({
      ...buildDocDefaults(docType, selectedEmployee, selectedTemplate || {}),
      ...current,
      employee_name: selectedEmployee.full_name || current.employee_name || '',
    }));
  }, [selectedEmployeeId, docType, selectedTemplate]);

  function pushMessage(text) {
    setMessage(text);
    setError('');
    window.setTimeout(() => setMessage(''), 3200);
  }

  function pushError(text) {
    setError(text);
    setMessage('');
  }

  async function saveEmployee(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (editingEmployeeId) {
        await api.put(`/api/hr/head/employees/${editingEmployeeId}`, employeeForm);
      } else {
        await api.post('/api/hr/head/employees', employeeForm);
      }
      setEmployeeForm(employeeInitial);
      setEditingEmployeeId('');
      pushMessage(editingEmployeeId ? 'Employee updated' : 'Employee added');
      await loadData(true);
    } catch (err) {
      pushError(err.message || 'Unable to save employee');
    } finally {
      setBusy(false);
    }
  }

  function editEmployee(row) {
    setEditingEmployeeId(row.employee_id);
    setSelectedEmployeeId(row.employee_id);
    setEmployeeForm({ ...employeeInitial, ...row });
    setTab('team');
  }

  async function saveSimple(endpoint, payload, resetFn, successText) {
    setBusy(true);
    try {
      await api.post(endpoint, payload);
      resetFn();
      pushMessage(successText);
      await loadData(true);
    } catch (err) {
      pushError(err.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function uploadTemplateFile() {
    if (!templateFile || !selectedTemplateId) return;
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append('template_id', selectedTemplateId);
      formData.append('template_file', templateFile);
      await api.upload('/api/hr/head/templates/upload', formData);
      setTemplateFile(null);
      pushMessage('Template uploaded');
      await loadData(true);
    } catch (err) {
      pushError(err.message || 'Template upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplateConfig() {
    if (!selectedTemplateId) return;
    setBusy(true);
    try {
      await api.post('/api/hr/head/templates/config', {
        template_id: selectedTemplateId,
        template_name: templateDraft.template_name,
        mode: templateDraft.mode,
        template_html: templateDraft.template_html,
        company_defaults_json: templateDraft.company_defaults_json,
        field_map_json: templateDraft.field_map_json,
      });
      pushMessage('Template rules saved');
      await loadData(true);
    } catch (err) {
      pushError(err.message || 'Template save failed');
    } finally {
      setBusy(false);
    }
  }

  async function generateDocument() {
    setBusy(true);
    try {
      const generated = await api.post('/api/hr/head/generate', {
        document_type: docType,
        template_id: selectedTemplateId,
        employee_id: selectedEmployeeId,
        form_data_json: docForm,
      });
      pushMessage('Document generated');
      await loadData(true);
      if (generated.file_url) {
        window.open(generated.file_url, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      pushError(err.message || 'Document generation failed');
    } finally {
      setBusy(false);
    }
  }

  function setTemplateCompanyField(key, value) {
    setTemplateDraft((current) => ({
      ...current,
      company_defaults_json: {
        ...(current.company_defaults_json || {}),
        [key]: value,
      },
    }));
  }

  function setFieldMap(key, patch) {
    setTemplateDraft((current) => ({
      ...current,
      field_map_json: {
        ...(current.field_map_json || {}),
        [key]: { ...(current.field_map_json?.[key] || {}), ...patch },
      },
    }));
  }

  function resetEmployeeForm() {
    setEditingEmployeeId('');
    setEmployeeForm(employeeInitial);
  }

  const heroCards = [
    {
      label: 'Total Employees',
      value: overview.total_employees || 0,
      note: `${overview.working_today || 0} working today`,
    },
    {
      label: 'Hours This Month',
      value: overview.total_work_hours || '0h 00m',
      note: `${overview.full_days || 0} full days`,
    },
    {
      label: 'Pending Work',
      value: Number(overview.total_pending_units || 0),
      note: `${overview.total_completed_units || 0} completed`,
    },
    {
      label: 'Salary Commitment',
      value: rupee(overview.month_salary_commitment || 0),
      note: `Incentive ${rupee(overview.month_incentive || 0)}`,
    },
  ];

  if (loading) {
    return (
      <Layout>
        <div className="table-panel top-gap-small glassy-card fade-up">
          <div className="table-title">HR Head</div>
          <div className="helper-text top-gap-small">Loading HR control centre...</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <style>{`
        .easy-hr-page{display:grid;gap:14px}
        .easy-hero{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
        .easy-hero-card{position:relative;overflow:hidden;border-radius:26px;padding:18px 18px 20px;color:#fff;box-shadow:0 18px 45px rgba(23,31,75,.16)}
        .easy-hero-card::after{content:"";position:absolute;right:-20px;top:-20px;width:100px;height:100px;border-radius:50%;background:rgba(255,255,255,.14)}
        .easy-hero-card .k{font-size:12px;text-transform:uppercase;font-weight:900;letter-spacing:.08em;opacity:.92}
        .easy-hero-card .v{font-size:28px;font-weight:900;margin-top:8px;line-height:1.15}
        .easy-hero-card .s{font-size:13px;opacity:.96;margin-top:8px}
        .easy-toolbar{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
        .easy-tabs{display:flex;gap:10px;flex-wrap:wrap}
        .easy-tab{border:none;border-radius:999px;padding:12px 18px;font-weight:900;font-size:13px;background:#edf3ff;color:#23406a;cursor:pointer}
        .easy-tab.active{background:linear-gradient(135deg,#1d4ed8 0%,#7c3aed 100%);color:#fff;box-shadow:0 12px 28px rgba(62,67,163,.22)}
        .easy-grid-2{display:grid;grid-template-columns:1.1fr .9fr;gap:16px}
        .easy-grid-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
        .easy-summary-card{border-radius:24px;padding:18px;background:linear-gradient(180deg,#fff,#f7fbff);border:1px solid rgba(101,125,189,.14);box-shadow:0 12px 28px rgba(23,31,75,.05)}
        .easy-summary-card h3,.easy-section h3,.easy-section h4{margin:0;color:#16305d}
        .easy-section{border-radius:28px;padding:18px;background:linear-gradient(180deg,#fff,#f8fbff);border:1px solid rgba(101,125,189,.14);box-shadow:0 14px 30px rgba(23,31,75,.06)}
        .easy-section-title{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap;margin-bottom:12px}
        .easy-help{font-size:13px;color:#677b9f;line-height:1.55}
        .easy-pills{display:flex;gap:10px;flex-wrap:wrap}
        .easy-pill{display:inline-flex;align-items:center;padding:9px 12px;border-radius:999px;background:#eef4ff;color:#25426c;font-size:12px;font-weight:900}
        .easy-list{display:grid;gap:10px}
        .easy-row{display:grid;grid-template-columns:1.4fr repeat(4,minmax(0,1fr));gap:12px;align-items:center;padding:14px 16px;border-radius:22px;border:1px solid rgba(101,125,189,.12);background:#fff}
        .easy-row.compact{grid-template-columns:1.4fr repeat(3,minmax(0,1fr)) auto}
        .easy-title{font-size:15px;font-weight:900;color:#173056}
        .easy-sub{font-size:12px;color:#7184a6;margin-top:3px}
        .easy-metric span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#8192ac;font-weight:900}
        .easy-metric strong{display:block;font-size:16px;color:#173056;margin-top:5px}
        .easy-action{border:none;border-radius:14px;padding:10px 14px;font-weight:900;background:#eef4ff;color:#21406a;cursor:pointer}
        .easy-action.primary{background:linear-gradient(135deg,#1d4ed8 0%,#7c3aed 100%);color:#fff}
        .easy-action.soft-green{background:#ebfff3;color:#0c6d45}
        .easy-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
        .easy-form-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
        .easy-form-grid .field.full{grid-column:1/-1}
        .easy-form-grid .field.wide{grid-column:span 2}
        .easy-form-grid .field label{display:block;font-size:12px;font-weight:900;color:#5d7298;margin-bottom:6px}
        .easy-form-grid .field input,.easy-form-grid .field select,.easy-form-grid .field textarea{width:100%;border-radius:16px;border:1px solid rgba(101,125,189,.18);padding:11px 12px;background:#fff;color:#18325c;outline:none}
        .easy-form-grid .field textarea{min-height:92px;resize:vertical}
        .easy-doc-switch{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}
        .easy-doc-card{border:none;border-radius:20px;padding:14px 12px;text-align:left;background:#eef4ff;color:#18325c;font-weight:900;cursor:pointer}
        .easy-doc-card.active{background:linear-gradient(135deg,#0f172a 0%,#2563eb 55%,#9333ea 100%);color:#fff;box-shadow:0 14px 32px rgba(23,31,75,.18)}
        .easy-doc-card small{display:block;font-size:11px;margin-top:6px;opacity:.85;font-weight:700}
        .easy-msg{padding:12px 14px;border-radius:16px;background:#ecfff0;border:1px solid rgba(28,159,72,.14);color:#186a38;font-weight:800}
        .easy-err{padding:12px 14px;border-radius:16px;background:#fff3f3;border:1px solid rgba(204,61,61,.14);color:#992929;font-weight:800}
        .easy-details{border:1px dashed rgba(101,125,189,.24);border-radius:18px;padding:12px 14px;background:#fbfdff}
        .easy-details summary{cursor:pointer;font-weight:900;color:#18325c}
        .easy-mini-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
        .easy-mini{padding:14px;border-radius:20px;background:#fff;border:1px solid rgba(101,125,189,.12)}
        .easy-mini b{display:block;color:#173056;font-size:18px;margin-top:6px}
        .easy-birthday{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:12px 14px;border-radius:18px;background:#fff;border:1px solid rgba(101,125,189,.1)}
        .easy-table-head{display:grid;grid-template-columns:1.4fr repeat(4,minmax(0,1fr));gap:12px;padding:0 8px 6px;color:#8192ac;font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.08em}
        .easy-split{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        .easy-note{padding:12px 14px;border-radius:18px;background:#f7faff;color:#5d7298;font-size:13px;line-height:1.55}
        @media (max-width:1280px){
          .easy-hero,.easy-grid-3,.easy-mini-grid,.easy-doc-switch,.easy-form-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
          .easy-grid-2,.easy-split{grid-template-columns:1fr}
          .easy-row,.easy-row.compact,.easy-table-head{grid-template-columns:1fr 1fr}
          .easy-row > :first-child,.easy-row.compact > :first-child{grid-column:1/-1}
        }
        @media (max-width:760px){
          .easy-hero,.easy-grid-3,.easy-mini-grid,.easy-doc-switch,.easy-form-grid,.easy-row,.easy-row.compact,.easy-table-head{grid-template-columns:1fr}
        }
      `}</style>

      <div className="easy-hr-page">
        <div className="table-panel top-gap-small glassy-card fade-up">
          <div className="easy-toolbar">
            <div>
              <div className="table-title">HR Head</div>
              <div className="helper-text">A clear workspace to manage people, attendance, salary, letters, and slips from one screen.</div>
            </div>
            <div className="easy-tabs">
              {tabs.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`easy-tab ${tab === item.key ? 'active' : ''}`}
                  onClick={() => setTab(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {!!message && <div className="easy-msg">{message}</div>}
        {!!error && <div className="easy-err">{error}</div>}

        <div className="easy-hero">
          {heroCards.map((card, index) => (
            <div key={card.label} className="easy-hero-card" style={{ background: metricTone(index) }}>
              <div className="k">{card.label}</div>
              <div className="v">{card.value}</div>
              <div className="s">{card.note}</div>
            </div>
          ))}
        </div>

        {tab === 'overview' && (
          <>
            <div className="easy-grid-2">
              <div className="easy-section">
                <div className="easy-section-title">
                  <div>
                    <h3>Today at a glance</h3>
                    <div className="easy-help">This is the only part most people need every morning. See who worked, who took leave, and what got done.</div>
                  </div>
                  <div className="easy-pills">
                    <span className="easy-pill">Half Days {overview.half_days || 0}</span>
                    <span className="easy-pill">Leave Entries {overview.month_leave_entries || 0}</span>
                    <span className="easy-pill">Working Today {overview.working_today || 0}</span>
                  </div>
                </div>

                <div className="easy-table-head">
                  <div>Employee</div>
                  <div>Hours</div>
                  <div>Work Done</div>
                  <div>Pending</div>
                  <div>Day Type</div>
                </div>

                <div className="easy-list">
                  {(data.today_rows || []).slice(0, 8).map((row) => (
                    <button
                      key={row.employee_id}
                      type="button"
                      className="easy-row"
                      style={{ cursor: 'pointer', border: selectedEmployeeId === row.employee_id ? '1px solid rgba(49,92,233,.45)' : undefined }}
                      onClick={() => setSelectedEmployeeId(row.employee_id)}
                    >
                      <div>
                        <div className="easy-title">{row.employee_name || '-'}</div>
                        <div className="easy-sub">{row.designation || '-'} {row.login_time ? `• Login ${row.login_time}` : ''}</div>
                      </div>
                      <div className="easy-metric"><span>Hours</span><strong>{row.work_hours || '0h 00m'}</strong></div>
                      <div className="easy-metric"><span>Done</span><strong>{row.work_done || 0}</strong></div>
                      <div className="easy-metric"><span>Pending</span><strong>{row.work_pending || 0}</strong></div>
                      <div className="easy-metric">
                        <span>Status</span>
                        <strong>
                          {row.leave_type ? `Leave: ${titleFromKey(row.leave_type)}` : row.full_day ? 'Full Day' : row.half_day ? 'Half Day' : 'Open'}
                        </strong>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="easy-section">
                <div className="easy-section-title">
                  <div>
                    <h3>Upcoming birthdays</h3>
                    <div className="easy-help">Because forgetting birthdays is how offices pretend they are efficient but somehow still awkward.</div>
                  </div>
                </div>
                <div className="easy-list">
                  {(overview.birthdays_upcoming || []).length ? (overview.birthdays_upcoming || []).map((row) => (
                    <div className="easy-birthday" key={row.employee_id}>
                      <div>
                        <div className="easy-title">{row.full_name}</div>
                        <div className="easy-sub">{row.designation || '-'} • {row.birthday || '-'}</div>
                      </div>
                      <div className="easy-pill">In {row.birthday_countdown} day(s)</div>
                    </div>
                  )) : <div className="easy-note">No upcoming birthdays found.</div>}
                </div>

                <div className="easy-mini-grid top-gap">
                  <div className="easy-mini">
                    <span className="easy-help">Completed This Month</span>
                    <b>{overview.total_completed_units || 0}</b>
                  </div>
                  <div className="easy-mini">
                    <span className="easy-help">Pending This Month</span>
                    <b>{overview.total_pending_units || 0}</b>
                  </div>
                  <div className="easy-mini">
                    <span className="easy-help">Month Incentive</span>
                    <b>{rupee(overview.month_incentive || 0)}</b>
                  </div>
                </div>
              </div>
            </div>

            <div className="easy-grid-3">
              <div className="easy-summary-card">
                <h4>What this page means</h4>
                <div className="easy-help top-gap-small">Full Day = 8 hours or marked full. Half Day = around 4 to under 8 hours. Salary estimate = monthly salary + incentive, adjusted from attendance and unpaid leave.</div>
              </div>
              <div className="easy-summary-card">
                <h4>Fast route</h4>
                <div className="easy-help top-gap-small">Add employee once, then select employee, save attendance, save worklog, and generate letter or salary slip from the same employee details.</div>
              </div>
              <div className="easy-summary-card">
                <h4>Best use</h4>
                <div className="easy-help top-gap-small">Use this like an HR command center, not like a punishment machine. Most advanced fields are hidden below when needed.</div>
              </div>
            </div>
          </>
        )}

        {tab === 'team' && (
          <div className="easy-grid-2">
            <div className="easy-section">
              <div className="easy-section-title">
                <div>
                  <h3>Employee list</h3>
                  <div className="easy-help">Click any employee to auto-fill attendance, worklog and document forms.</div>
                </div>
                <div className="easy-pills">
                  <span className="easy-pill">Salary Estimate</span>
                  <span className="easy-pill">Leaves</span>
                  <span className="easy-pill">Documents</span>
                </div>
              </div>

              <div className="easy-list">
                {monthlyRows.map((row) => (
                  <div
                    key={row.employee_id}
                    className="easy-row compact"
                    style={{ border: selectedEmployeeId === row.employee_id ? '1px solid rgba(49,92,233,.45)' : undefined }}
                  >
                    <div>
                      <div className="easy-title">{row.full_name}</div>
                      <div className="easy-sub">{row.employee_code} • {row.designation || '-'} • {row.department || '-'}</div>
                    </div>
                    <div className="easy-metric"><span>Hours</span><strong>{row.month_hours_label || '0h 00m'}</strong></div>
                    <div className="easy-metric"><span>Leaves</span><strong>{Number(row.month_paid_leaves || 0) + Number(row.month_unpaid_leaves || 0)}</strong></div>
                    <div className="easy-metric"><span>Salary</span><strong>{rupee(row.month_salary_estimate || 0)}</strong></div>
                    <div className="easy-actions">
                      <button type="button" className="easy-action" onClick={() => { setSelectedEmployeeId(row.employee_id); setTab('attendance'); }}>Use</button>
                      <button type="button" className="easy-action primary" onClick={() => editEmployee(row)}>Edit</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <form className="easy-section" onSubmit={saveEmployee}>
              <div className="easy-section-title">
                <div>
                  <h3>{editingEmployeeId ? 'Edit employee' : 'Add employee'}</h3>
                  <div className="easy-help">Only the important fields are shown first. Advanced payroll and KYC details are hidden below.</div>
                </div>
                {editingEmployeeId && (
                  <button type="button" className="easy-action" onClick={resetEmployeeForm}>Clear Edit</button>
                )}
              </div>

              <div className="easy-form-grid">
                <div className="field"><label>Employee Code</label><input value={employeeForm.employee_code} onChange={(e) => setEmployeeForm({ ...employeeForm, employee_code: e.target.value })} /></div>
                <div className="field"><label>Full Name</label><input value={employeeForm.full_name} onChange={(e) => setEmployeeForm({ ...employeeForm, full_name: e.target.value })} /></div>
                <div className="field"><label>Phone</label><input value={employeeForm.phone} onChange={(e) => setEmployeeForm({ ...employeeForm, phone: e.target.value })} /></div>
                <div className="field"><label>Email</label><input value={employeeForm.email} onChange={(e) => setEmployeeForm({ ...employeeForm, email: e.target.value })} /></div>
                <div className="field"><label>Designation</label><input value={employeeForm.designation} onChange={(e) => setEmployeeForm({ ...employeeForm, designation: e.target.value })} /></div>
                <div className="field"><label>Department</label><input value={employeeForm.department} onChange={(e) => setEmployeeForm({ ...employeeForm, department: e.target.value })} /></div>
                <div className="field"><label>Joining Date</label><input type="date" value={employeeForm.date_of_joining} onChange={(e) => setEmployeeForm({ ...employeeForm, date_of_joining: e.target.value })} /></div>
                <div className="field"><label>Work Location</label><input value={employeeForm.work_location} onChange={(e) => setEmployeeForm({ ...employeeForm, work_location: e.target.value })} /></div>
                <div className="field"><label>Monthly Salary</label><input value={employeeForm.salary_monthly} onChange={(e) => setEmployeeForm({ ...employeeForm, salary_monthly: e.target.value })} /></div>
                <div className="field"><label>In Hand Salary</label><input value={employeeForm.salary_in_hand} onChange={(e) => setEmployeeForm({ ...employeeForm, salary_in_hand: e.target.value })} /></div>
                <div className="field"><label>Default Incentive</label><input value={employeeForm.incentives_default} onChange={(e) => setEmployeeForm({ ...employeeForm, incentives_default: e.target.value })} /></div>
                <div className="field"><label>Reporting Manager</label><input value={employeeForm.reporting_manager} onChange={(e) => setEmployeeForm({ ...employeeForm, reporting_manager: e.target.value })} /></div>
                <div className="field"><label>Shift Start</label><input type="time" value={employeeForm.shift_start} onChange={(e) => setEmployeeForm({ ...employeeForm, shift_start: e.target.value })} /></div>
                <div className="field"><label>Shift End</label><input type="time" value={employeeForm.shift_end} onChange={(e) => setEmployeeForm({ ...employeeForm, shift_end: e.target.value })} /></div>
                <div className="field"><label>Weekly Off</label><input value={employeeForm.weekly_off} onChange={(e) => setEmployeeForm({ ...employeeForm, weekly_off: e.target.value })} /></div>
                <div className="field"><label>Birthday</label><input type="date" value={employeeForm.birthday} onChange={(e) => setEmployeeForm({ ...employeeForm, birthday: e.target.value })} /></div>
                <div className="field full"><label>Address / Notes</label><textarea value={employeeForm.address || employeeForm.notes ? `${employeeForm.address || ''}${employeeForm.address && employeeForm.notes ? '\n' : ''}${employeeForm.notes || ''}` : ''} onChange={(e) => {
                  const parts = String(e.target.value || '').split('\n');
                  setEmployeeForm({ ...employeeForm, address: parts[0] || '', notes: parts.slice(1).join('\n') });
                }} /></div>
              </div>

              <details className="easy-details top-gap">
                <summary>Advanced payroll / bank / document details</summary>
                <div className="easy-form-grid top-gap-small">
                  <div className="field"><label>Employment Status</label><select value={employeeForm.employment_status} onChange={(e) => setEmployeeForm({ ...employeeForm, employment_status: e.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
                  <div className="field"><label>Offer Date</label><input type="date" value={employeeForm.offer_date} onChange={(e) => setEmployeeForm({ ...employeeForm, offer_date: e.target.value })} /></div>
                  <div className="field"><label>Probation Period</label><input value={employeeForm.probation_period} onChange={(e) => setEmployeeForm({ ...employeeForm, probation_period: e.target.value })} /></div>
                  <div className="field"><label>Emergency Contact</label><input value={employeeForm.emergency_contact} onChange={(e) => setEmployeeForm({ ...employeeForm, emergency_contact: e.target.value })} /></div>
                  <div className="field"><label>Bank Name</label><input value={employeeForm.bank_name} onChange={(e) => setEmployeeForm({ ...employeeForm, bank_name: e.target.value })} /></div>
                  <div className="field"><label>Account Number</label><input value={employeeForm.account_number} onChange={(e) => setEmployeeForm({ ...employeeForm, account_number: e.target.value })} /></div>
                  <div className="field"><label>IFSC</label><input value={employeeForm.ifsc_code} onChange={(e) => setEmployeeForm({ ...employeeForm, ifsc_code: e.target.value })} /></div>
                  <div className="field"><label>PAN</label><input value={employeeForm.pan_number} onChange={(e) => setEmployeeForm({ ...employeeForm, pan_number: e.target.value })} /></div>
                  <div className="field"><label>Aadhar</label><input value={employeeForm.aadhar_number} onChange={(e) => setEmployeeForm({ ...employeeForm, aadhar_number: e.target.value })} /></div>
                  <div className="field full"><label>Extra Notes</label><textarea value={employeeForm.notes} onChange={(e) => setEmployeeForm({ ...employeeForm, notes: e.target.value })} /></div>
                </div>
              </details>

              <div className="easy-actions top-gap">
                <button type="submit" className="easy-action primary" disabled={busy}>{busy ? 'Saving...' : editingEmployeeId ? 'Update Employee' : 'Add Employee'}</button>
                <button type="button" className="easy-action" onClick={resetEmployeeForm}>Reset</button>
              </div>
            </form>
          </div>
        )}

        {tab === 'attendance' && (
          <>
            <div className="easy-grid-3">
              <div className="easy-section">
                <div className="easy-section-title">
                  <div>
                    <h3>1. Quick attendance</h3>
                    <div className="easy-help">Select employee, date, login, logout or just total worked minutes. Full day and half day are auto-understood.</div>
                  </div>
                </div>

                <div className="easy-form-grid">
                  <div className="field wide">
                    <label>Employee</label>
                    <select value={attendanceForm.employee_id} onChange={(e) => { setAttendanceForm({ ...attendanceForm, employee_id: e.target.value }); setSelectedEmployeeId(e.target.value); }}>
                      <option value="">Select employee</option>
                      {employees.map((row) => <option key={row.employee_id} value={row.employee_id}>{row.full_name} • {row.employee_code}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>Date</label><input type="date" value={attendanceForm.work_date} onChange={(e) => setAttendanceForm({ ...attendanceForm, work_date: e.target.value })} /></div>
                  <div className="field"><label>Day Status</label><select value={attendanceForm.attendance_status} onChange={(e) => setAttendanceForm({ ...attendanceForm, attendance_status: e.target.value })}><option value="present">Present / Full Day</option><option value="half_day">Half Day</option><option value="short_day">Short Day</option><option value="absent">Absent</option></select></div>
                  <div className="field"><label>Login</label><input type="time" value={attendanceForm.login_time} onChange={(e) => setAttendanceForm({ ...attendanceForm, login_time: e.target.value })} /></div>
                  <div className="field"><label>Logout</label><input type="time" value={attendanceForm.logout_time} onChange={(e) => setAttendanceForm({ ...attendanceForm, logout_time: e.target.value })} /></div>
                  <div className="field"><label>Worked Minutes</label><input value={attendanceForm.work_minutes} onChange={(e) => setAttendanceForm({ ...attendanceForm, work_minutes: e.target.value })} placeholder="Auto from login/logout if blank" /></div>
                  <div className="field"><label>Break Minutes</label><input value={attendanceForm.break_minutes} onChange={(e) => setAttendanceForm({ ...attendanceForm, break_minutes: e.target.value })} /></div>
                  <div className="field"><label>Late Minutes</label><input value={attendanceForm.late_minutes} onChange={(e) => setAttendanceForm({ ...attendanceForm, late_minutes: e.target.value })} /></div>
                  <div className="field full"><label>Remark</label><textarea value={attendanceForm.remark} onChange={(e) => setAttendanceForm({ ...attendanceForm, remark: e.target.value })} /></div>
                </div>

                <div className="easy-actions top-gap">
                  <button
                    type="button"
                    className="easy-action primary"
                    disabled={busy || !attendanceForm.employee_id}
                    onClick={() => saveSimple('/api/hr/head/attendance', buildAttendancePayload(attendanceForm), () => setAttendanceForm({ ...attendanceInitial, employee_id: selectedEmployeeId || '' }), 'Attendance saved')}
                  >
                    {busy ? 'Saving...' : 'Save Attendance'}
                  </button>
                </div>
              </div>

              <div className="easy-section">
                <div className="easy-section-title">
                  <div>
                    <h3>2. Quick work log</h3>
                    <div className="easy-help">Simple work numbers. Target, done, pending, incentive. Pending auto-calculates if left empty.</div>
                  </div>
                </div>

                <div className="easy-form-grid">
                  <div className="field wide">
                    <label>Employee</label>
                    <select value={worklogForm.employee_id} onChange={(e) => { setWorklogForm({ ...worklogForm, employee_id: e.target.value }); setSelectedEmployeeId(e.target.value); }}>
                      <option value="">Select employee</option>
                      {employees.map((row) => <option key={row.employee_id} value={row.employee_id}>{row.full_name} • {row.employee_code}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>Date</label><input type="date" value={worklogForm.work_date} onChange={(e) => setWorklogForm({ ...worklogForm, work_date: e.target.value })} /></div>
                  <div className="field"><label>Target Units</label><input value={worklogForm.target_units} onChange={(e) => setWorklogForm({ ...worklogForm, target_units: e.target.value })} /></div>
                  <div className="field"><label>Completed</label><input value={worklogForm.completed_units} onChange={(e) => setWorklogForm({ ...worklogForm, completed_units: e.target.value })} /></div>
                  <div className="field"><label>Pending</label><input value={worklogForm.pending_units} onChange={(e) => setWorklogForm({ ...worklogForm, pending_units: e.target.value })} placeholder="Auto if blank" /></div>
                  <div className="field"><label>QA Score</label><input value={worklogForm.qa_score} onChange={(e) => setWorklogForm({ ...worklogForm, qa_score: e.target.value })} /></div>
                  <div className="field"><label>Incentive</label><input value={worklogForm.incentive_amount} onChange={(e) => setWorklogForm({ ...worklogForm, incentive_amount: e.target.value })} /></div>
                  <div className="field full"><label>Work Summary</label><textarea value={worklogForm.task_summary} onChange={(e) => setWorklogForm({ ...worklogForm, task_summary: e.target.value })} /></div>
                  <div className="field full"><label>Note</label><textarea value={worklogForm.note} onChange={(e) => setWorklogForm({ ...worklogForm, note: e.target.value })} /></div>
                </div>

                <div className="easy-actions top-gap">
                  <button
                    type="button"
                    className="easy-action primary"
                    disabled={busy || !worklogForm.employee_id}
                    onClick={() => saveSimple('/api/hr/head/worklogs', buildWorklogPayload(worklogForm), () => setWorklogForm({ ...worklogInitial, employee_id: selectedEmployeeId || '' }), 'Work log saved')}
                  >
                    {busy ? 'Saving...' : 'Save Work Log'}
                  </button>
                </div>
              </div>

              <div className="easy-section">
                <div className="easy-section-title">
                  <div>
                    <h3>3. Leave + stage update</h3>
                    <div className="easy-help">Use leave for off days. Use stage to track screening, offer, joining, onboarding or exit.</div>
                  </div>
                </div>

                <div className="easy-form-grid">
                  <div className="field wide">
                    <label>Employee</label>
                    <select value={leaveForm.employee_id} onChange={(e) => { setLeaveForm({ ...leaveForm, employee_id: e.target.value }); setStageForm({ ...stageForm, employee_id: e.target.value }); setSelectedEmployeeId(e.target.value); }}>
                      <option value="">Select employee</option>
                      {employees.map((row) => <option key={row.employee_id} value={row.employee_id}>{row.full_name} • {row.employee_code}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>Leave Date</label><input type="date" value={leaveForm.leave_date} onChange={(e) => setLeaveForm({ ...leaveForm, leave_date: e.target.value })} /></div>
                  <div className="field"><label>Leave Type</label><select value={leaveForm.leave_type} onChange={(e) => setLeaveForm({ ...leaveForm, leave_type: e.target.value })}><option value="casual">Casual</option><option value="sick">Sick</option><option value="earned">Earned</option><option value="unpaid">Unpaid</option></select></div>
                  <div className="field"><label>Days</label><input value={leaveForm.leave_days} onChange={(e) => setLeaveForm({ ...leaveForm, leave_days: e.target.value })} /></div>
                  <div className="field"><label>Paid Leave</label><select value={leaveForm.paid_flag ? '1' : '0'} onChange={(e) => setLeaveForm({ ...leaveForm, paid_flag: e.target.value === '1' })}><option value="1">Yes</option><option value="0">No</option></select></div>
                  <div className="field full"><label>Leave Reason</label><textarea value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} /></div>
                </div>

                <div className="easy-actions top-gap">
                  <button
                    type="button"
                    className="easy-action soft-green"
                    disabled={busy || !leaveForm.employee_id}
                    onClick={() => saveSimple('/api/hr/head/leaves', leaveForm, () => setLeaveForm({ ...leaveInitial, employee_id: selectedEmployeeId || '' }), 'Leave saved')}
                  >
                    Save Leave
                  </button>
                </div>

                <div className="easy-note top-gap">Stage tracker is kept separate so you can track screening → offer → joining → onboarding → exit without mixing it into attendance.</div>

                <div className="easy-form-grid top-gap-small">
                  <div className="field"><label>Stage Date</label><input type="date" value={stageForm.event_date} onChange={(e) => setStageForm({ ...stageForm, event_date: e.target.value })} /></div>
                  <div className="field"><label>Stage Key</label><input value={stageForm.stage_key} onChange={(e) => setStageForm({ ...stageForm, stage_key: e.target.value })} /></div>
                  <div className="field"><label>Stage Label</label><input value={stageForm.stage_label} onChange={(e) => setStageForm({ ...stageForm, stage_label: e.target.value })} /></div>
                  <div className="field full"><label>Stage Note</label><textarea value={stageForm.note} onChange={(e) => setStageForm({ ...stageForm, note: e.target.value })} /></div>
                </div>

                <div className="easy-actions top-gap">
                  <button
                    type="button"
                    className="easy-action"
                    disabled={busy || !stageForm.employee_id}
                    onClick={() => saveSimple('/api/hr/head/stages', stageForm, () => setStageForm({ ...stageInitial, employee_id: selectedEmployeeId || '' }), 'Stage updated')}
                  >
                    Save Stage
                  </button>
                </div>
              </div>
            </div>

            <div className="easy-split">
              <div className="easy-section">
                <div className="easy-section-title">
                  <div>
                    <h3>Recent attendance</h3>
                    <div className="easy-help">Last saved records so you can confirm the system actually understood you.</div>
                  </div>
                </div>
                <div className="easy-list">
                  {(data.attendance || []).slice(0, 10).map((row) => {
                    const employee = employees.find((item) => item.employee_id === row.employee_id);
                    return (
                      <div key={row.entry_id} className="easy-row compact">
                        <div>
                          <div className="easy-title">{employee?.full_name || row.employee_id}</div>
                          <div className="easy-sub">{row.work_date} {row.login_time ? `• ${row.login_time}` : ''}</div>
                        </div>
                        <div className="easy-metric"><span>Hours</span><strong>{formatHoursFromMinutes(row.work_minutes || 0)}</strong></div>
                        <div className="easy-metric"><span>Status</span><strong>{titleFromKey(row.attendance_status || '-')}</strong></div>
                        <div className="easy-metric"><span>Break</span><strong>{row.break_minutes || 0}m</strong></div>
                        <div className="easy-metric"><span>Late</span><strong>{row.late_minutes || 0}m</strong></div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="easy-section">
                <div className="easy-section-title">
                  <div>
                    <h3>Recent work logs</h3>
                    <div className="easy-help">Done vs pending vs incentive. The boring math, but now less ugly.</div>
                  </div>
                </div>
                <div className="easy-list">
                  {(data.worklogs || []).slice(0, 10).map((row) => {
                    const employee = employees.find((item) => item.employee_id === row.employee_id);
                    return (
                      <div key={row.worklog_id} className="easy-row compact">
                        <div>
                          <div className="easy-title">{employee?.full_name || row.employee_id}</div>
                          <div className="easy-sub">{row.work_date} • {row.task_summary || '-'}</div>
                        </div>
                        <div className="easy-metric"><span>Done</span><strong>{row.completed_units || 0}</strong></div>
                        <div className="easy-metric"><span>Pending</span><strong>{row.pending_units || 0}</strong></div>
                        <div className="easy-metric"><span>Incentive</span><strong>{rupee(row.incentive_amount || 0)}</strong></div>
                        <div className="easy-metric"><span>QA</span><strong>{row.qa_score || 0}</strong></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}

        {tab === 'documents' && (
          <>
            <div className="easy-section">
              <div className="easy-section-title">
                <div>
                  <h3>Easy document generator</h3>
                  <div className="easy-help">Pick document type, upload or replace the PDF template, choose employee, fill only the changing details, then generate and download.</div>
                </div>
              </div>

              <div className="easy-doc-switch">
                {documentTypes.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`easy-doc-card ${docType === item.key ? 'active' : ''}`}
                    onClick={() => setDocType(item.key)}
                  >
                    {quickDocTypes[item.key] || item.label}
                    <small>{item.label}</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="easy-grid-2">
              <div className="easy-section">
                <div className="easy-section-title">
                  <div>
                    <h3>1. Template setup</h3>
                    <div className="easy-help">Upload the format once. Change it any time. Most users can ignore advanced mapping unless the PDF is not taking values correctly.</div>
                  </div>
                  <div className="easy-pills">
                    <span className="easy-pill">{selectedTemplate?.template_name || 'No template selected'}</span>
                    {selectedTemplate?.file_name && <span className="easy-pill">{selectedTemplate.file_name}</span>}
                  </div>
                </div>

                <div className="easy-form-grid">
                  <div className="field wide"><label>Template Name</label><input value={templateDraft.template_name || ''} onChange={(e) => setTemplateDraft({ ...templateDraft, template_name: e.target.value })} /></div>
                  <div className="field"><label>Template Mode</label><select value={templateDraft.mode || 'standard'} onChange={(e) => setTemplateDraft({ ...templateDraft, mode: e.target.value })}><option value="standard">Standard</option><option value="overlay">Overlay</option><option value="pdf-field">PDF Field</option></select></div>
                  <div className="field"><label>PDF Template</label><input type="file" accept=".pdf" onChange={(e) => setTemplateFile(e.target.files?.[0] || null)} /></div>
                  <div className="field"><label>Company Name</label><input value={templateDraft.company_defaults_json?.company_name || ''} onChange={(e) => setTemplateCompanyField('company_name', e.target.value)} /></div>
                  <div className="field"><label>HR Signatory</label><input value={templateDraft.company_defaults_json?.hr_signatory || ''} onChange={(e) => setTemplateCompanyField('hr_signatory', e.target.value)} /></div>
                  <div className="field"><label>Reporting Manager</label><input value={templateDraft.company_defaults_json?.reporting_manager || ''} onChange={(e) => setTemplateCompanyField('reporting_manager', e.target.value)} /></div>
                  <div className="field"><label>Shift Timing</label><input value={templateDraft.company_defaults_json?.shift_timing || ''} onChange={(e) => setTemplateCompanyField('shift_timing', e.target.value)} /></div>
                  <div className="field full"><label>Company Address</label><textarea value={templateDraft.company_defaults_json?.company_address || ''} onChange={(e) => setTemplateCompanyField('company_address', e.target.value)} /></div>
                  <div className="field full"><label>Standard Content (optional)</label><textarea value={templateDraft.template_html || ''} onChange={(e) => setTemplateDraft({ ...templateDraft, template_html: e.target.value })} placeholder="Paste your fixed content here. Use variables like {{employee_name}}, {{designation}}, {{salary_monthly}}" /></div>
                </div>

                <div className="easy-actions top-gap">
                  <button type="button" className="easy-action" disabled={busy || !templateFile || !selectedTemplateId} onClick={uploadTemplateFile}>{busy ? 'Uploading...' : 'Upload / Replace Template'}</button>
                  <button type="button" className="easy-action primary" disabled={busy || !selectedTemplateId} onClick={saveTemplateConfig}>{busy ? 'Saving...' : 'Save Template Rules'}</button>
                  {selectedTemplate?.file_url && <a className="easy-action" href={selectedTemplate.file_url} target="_blank" rel="noreferrer">Open Current Template</a>}
                </div>

                <details className="easy-details top-gap">
                  <summary>Advanced field mapping</summary>
                  <div className="easy-help top-gap-small">Use this only if the PDF needs precise field linking or overlay coordinates. If your format already works, ignore this part and enjoy life.</div>
                  <div className="easy-form-grid top-gap-small">
                    {(orderedDocFields || []).map((fieldKey) => {
                      const fieldMap = templateDraft.field_map_json?.[fieldKey] || {};
                      return (
                        <React.Fragment key={fieldKey}>
                          <div className="field">
                            <label>{titleFromKey(fieldKey)} • PDF Field</label>
                            <select value={fieldMap.pdfFieldName || ''} onChange={(e) => setFieldMap(fieldKey, { pdfFieldName: e.target.value, mode: e.target.value ? 'pdf-field' : (fieldMap.mode || templateDraft.mode) })}>
                              <option value="">Not linked</option>
                              {(selectedTemplate?.extracted_fields_json || []).map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
                            </select>
                          </div>
                          <div className="field"><label>Page</label><input value={fieldMap.page || ''} onChange={(e) => setFieldMap(fieldKey, { page: e.target.value, mode: 'overlay' })} /></div>
                          <div className="field"><label>X</label><input value={fieldMap.x || ''} onChange={(e) => setFieldMap(fieldKey, { x: e.target.value, mode: 'overlay' })} /></div>
                          <div className="field"><label>Y</label><input value={fieldMap.y || ''} onChange={(e) => setFieldMap(fieldKey, { y: e.target.value, mode: 'overlay' })} /></div>
                        </React.Fragment>
                      );
                    })}
                  </div>
                </details>
              </div>

              <div className="easy-section">
                <div className="easy-section-title">
                  <div>
                    <h3>2. Fill details and generate</h3>
                    <div className="easy-help">Choose employee and fill only the fields that can change. The rest stays from the uploaded format or saved company defaults.</div>
                  </div>
                </div>

                <div className="easy-form-grid">
                  <div className="field wide">
                    <label>Employee</label>
                    <select value={selectedEmployeeId} onChange={(e) => setSelectedEmployeeId(e.target.value)}>
                      <option value="">Select employee</option>
                      {employees.map((row) => <option key={row.employee_id} value={row.employee_id}>{row.full_name} • {row.employee_code}</option>)}
                    </select>
                  </div>
                  {basicDocFields.map((fieldKey) => (
                    <div key={fieldKey} className={`field ${['company_address', 'clearance_note'].includes(fieldKey) ? 'full' : ''}`}>
                      <label>{titleFromKey(fieldKey)}</label>
                      {['company_address', 'clearance_note'].includes(fieldKey)
                        ? <textarea value={docForm[fieldKey] || ''} onChange={(e) => setDocForm({ ...docForm, [fieldKey]: e.target.value })} />
                        : <input value={docForm[fieldKey] || ''} onChange={(e) => setDocForm({ ...docForm, [fieldKey]: e.target.value })} />}
                    </div>
                  ))}
                </div>

                {!!advancedDocFields.length && (
                  <details className="easy-details top-gap">
                    <summary>More changing fields</summary>
                    <div className="easy-form-grid top-gap-small">
                      {advancedDocFields.map((fieldKey) => (
                        <div key={fieldKey} className={`field ${['company_address', 'clearance_note'].includes(fieldKey) ? 'full' : ''}`}>
                          <label>{titleFromKey(fieldKey)}</label>
                          {['company_address', 'clearance_note'].includes(fieldKey)
                            ? <textarea value={docForm[fieldKey] || ''} onChange={(e) => setDocForm({ ...docForm, [fieldKey]: e.target.value })} />
                            : <input value={docForm[fieldKey] || ''} onChange={(e) => setDocForm({ ...docForm, [fieldKey]: e.target.value })} />}
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                <div className="easy-note top-gap">Simple rule: template stays same, only changing details are updated from here. That was the whole point, after all.</div>

                <div className="easy-actions top-gap">
                  <button type="button" className="easy-action primary" disabled={busy || !selectedTemplateId || !selectedEmployeeId} onClick={generateDocument}>{busy ? 'Generating...' : 'Generate + Download'}</button>
                </div>

                <div className="top-gap" />
                <div className="easy-section-title">
                  <div>
                    <h4>Recent generated files</h4>
                    <div className="easy-help">Latest files for this document type.</div>
                  </div>
                </div>

                <div className="easy-list">
                  {(data.document_runs || []).filter((row) => row.document_type === docType).slice(0, 10).map((row) => (
                    <div key={row.run_id} className="easy-row compact">
                      <div>
                        <div className="easy-title">{row.employee_name || row.employee_id || row.run_id}</div>
                        <div className="easy-sub">{titleFromKey(row.document_type)} • {row.created_at?.slice(0, 19).replace('T', ' ')}</div>
                      </div>
                      <div className="easy-metric"><span>File</span><strong>{row.file_name || '-'}</strong></div>
                      <div className="easy-metric"><span>Preview</span><strong>{row.preview_url ? 'Ready' : 'No'}</strong></div>
                      <div className="easy-actions">
                        <a className="easy-action" href={row.file_url} target="_blank" rel="noreferrer">PDF</a>
                        {row.preview_url && <a className="easy-action" href={row.preview_url} target="_blank" rel="noreferrer">Preview</a>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
