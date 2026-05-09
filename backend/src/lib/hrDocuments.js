const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { GENERATED_DIR } = require('../config/env');
const { nowIso } = require('./helpers');

const HR_ROOT = path.join(GENERATED_DIR, 'hr-head');
const TEMPLATE_DIR = path.join(HR_ROOT, 'templates');
const OUTPUT_DIR = path.join(HR_ROOT, 'outputs');
for (const dir of [HR_ROOT, TEMPLATE_DIR, OUTPUT_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const DOCUMENT_TYPES = [
  {
    key: 'offer_letter',
    label: 'Offer Letter',
    filenamePrefix: 'offer-letter',
    fields: [
      'issue_date','employee_name','employee_code','designation','department','date_of_joining','salary_monthly','salary_in_hand','incentives','work_location','shift_timing','weekly_off','probation_period','reporting_manager','hr_signatory','company_name','company_address'
    ],
    sections: [
      'We are pleased to offer you the position of {{designation}} in the {{department}} department at {{company_name}}.',
      'Your date of joining will be {{date_of_joining}} and your primary work location will be {{work_location}}. Your regular shift timing will be {{shift_timing}} with weekly off on {{weekly_off}}.',
      'Your monthly gross salary will be ₹{{salary_monthly}} and estimated in-hand salary will be ₹{{salary_in_hand}}. Performance incentive structure: {{incentives}}.',
      'This appointment will remain under an initial probation period of {{probation_period}} and you will report to {{reporting_manager}}.',
      'Please sign and return a copy of this offer letter as token of acceptance.'
    ],
  },
  {
    key: 'joining_letter',
    label: 'Joining Letter',
    filenamePrefix: 'joining-letter',
    fields: [
      'issue_date','employee_name','employee_code','designation','department','date_of_joining','reporting_manager','work_location','shift_timing','company_name','hr_signatory'
    ],
    sections: [
      'This is to confirm that {{employee_name}} has joined {{company_name}} on {{date_of_joining}} as {{designation}} in the {{department}} department.',
      'The employee will work from {{work_location}} with scheduled timing {{shift_timing}} and will report to {{reporting_manager}}.',
      'All onboarding documents have been received and the employee record is now active in the HR system.'
    ],
  },
  {
    key: 'salary_slip',
    label: 'Salary Slip',
    filenamePrefix: 'salary-slip',
    fields: [
      'salary_month','employee_name','employee_code','designation','department','working_days','present_days','half_days','paid_leaves','unpaid_leaves','late_marks','salary_monthly','basic_salary','allowances','incentives','deductions','net_salary','bank_name','account_number','company_name'
    ],
    sections: [
      'Salary slip for the month of {{salary_month}}.',
      'Working days: {{working_days}}, present days: {{present_days}}, half days: {{half_days}}, paid leaves: {{paid_leaves}}, unpaid leaves: {{unpaid_leaves}}, late marks: {{late_marks}}.',
      'Gross salary: ₹{{salary_monthly}}, basic salary: ₹{{basic_salary}}, allowances: ₹{{allowances}}, incentives: ₹{{incentives}}, deductions: ₹{{deductions}}, net payable: ₹{{net_salary}}.',
      'Salary has been processed to bank {{bank_name}} account ending {{account_number}}.'
    ],
  },
  {
    key: 'experience_letter',
    label: 'Experience Letter',
    filenamePrefix: 'experience-letter',
    fields: [
      'issue_date','employee_name','employee_code','designation','department','date_of_joining','last_working_date','company_name','hr_signatory'
    ],
    sections: [
      'This is to certify that {{employee_name}} was employed with {{company_name}} as {{designation}} in the {{department}} department.',
      'The employee worked with us from {{date_of_joining}} to {{last_working_date}}.',
      'During this period, the employee performed assigned duties responsibly and professionally. We wish them success in future endeavors.'
    ],
  },
  {
    key: 'relieving_letter',
    label: 'Relieving Letter',
    filenamePrefix: 'relieving-letter',
    fields: [
      'issue_date','employee_name','employee_code','designation','department','last_working_date','company_name','hr_signatory','clearance_note'
    ],
    sections: [
      'This is to confirm that {{employee_name}} has been relieved from the services of {{company_name}} with effect from {{last_working_date}}.',
      'The employee last held the role of {{designation}} in the {{department}} department.',
      'All exit formalities have been completed. Clearance remark: {{clearance_note}}.'
    ],
  }
];

const DEFAULT_COMPANY_DEFAULTS = {
  company_name: 'Career Crox',
  company_address: 'Office Address',
  hr_signatory: 'HR Head',
  reporting_manager: 'Reporting Manager',
  work_location: 'Office',
  shift_timing: '10:00 AM - 7:00 PM',
  weekly_off: 'Sunday',
  probation_period: '3 Months',
  incentives: 'As per company policy',
  clearance_note: 'No dues pending',
};

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'document';
}

function safeFilePart(value, fallback = 'file') {
  return slugify(value) || fallback;
}

function templateDefinition(documentType) {
  return DOCUMENT_TYPES.find((item) => item.key === documentType) || DOCUMENT_TYPES[0];
}

function defaultTemplate(documentType) {
  const def = templateDefinition(documentType);
  return {
    template_name: `${def.label} Master Template`,
    document_type: def.key,
    mode: 'standard',
    template_html: '',
    field_map_json: {},
    extracted_fields_json: [],
    company_defaults_json: { ...DEFAULT_COMPANY_DEFAULTS },
    is_active: '1',
  };
}

function replaceTokens(source, values) {
  return String(source || '').replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => String(values?.[key] ?? ''));
}

function mergeData(template, payload = {}) {
  return {
    ...DEFAULT_COMPANY_DEFAULTS,
    ...(template?.company_defaults_json || {}),
    ...payload,
  };
}

function collectDocumentFields(documentType) {
  const def = templateDefinition(documentType);
  return Array.from(new Set(def.fields.concat(Object.keys(DEFAULT_COMPANY_DEFAULTS))));
}

function renderStandardHtml(template, payload) {
  const def = templateDefinition(template.document_type);
  const values = mergeData(template, payload);
  const bodyHtml = String(template?.template_html || '').trim();
  const sections = bodyHtml
    ? bodyHtml.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean)
    : def.sections.map((item) => replaceTokens(item, values));
  const metaRows = collectDocumentFields(template.document_type)
    .filter((key) => values[key] !== undefined && values[key] !== null && String(values[key]).trim())
    .slice(0, 14)
    .map((key) => `<div class="meta-item"><span>${key.replaceAll('_', ' ')}</span><strong>${String(values[key])}</strong></div>`)
    .join('');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${def.label}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;background:#f4f7fb;padding:24px;color:#173056}
  .page{max-width:840px;margin:0 auto;background:#fff;border:1px solid #dbe5f2;border-radius:24px;padding:42px 48px;box-shadow:0 18px 46px rgba(17,45,96,.08)}
  .top{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border-bottom:2px solid #eef3fb;padding-bottom:18px;margin-bottom:22px}
  .brand{font-size:28px;font-weight:800;color:#16305d}
  .doc{font-size:14px;color:#5b7196;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
  .meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px;margin:20px 0 24px}
  .meta-item{padding:10px 12px;border:1px solid #e4ebf6;border-radius:14px;background:#f9fbff}
  .meta-item span{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#7a8cab;margin-bottom:4px}
  .meta-item strong{font-size:14px;color:#173056}
  p{font-size:15px;line-height:1.72;color:#243c66;margin:0 0 14px}
  .sign{margin-top:34px;padding-top:18px;border-top:1px dashed #d8e2f0}
  .sign strong{display:block;font-size:16px;margin-top:4px}
</style>
</head>
<body>
<div class="page">
  <div class="top">
    <div>
      <div class="brand">${values.company_name || DEFAULT_COMPANY_DEFAULTS.company_name}</div>
      <div style="font-size:13px;color:#6b7f9f">${values.company_address || DEFAULT_COMPANY_DEFAULTS.company_address}</div>
    </div>
    <div style="text-align:right">
      <div class="doc">${def.label}</div>
      <div style="font-size:13px;color:#6b7f9f">Issue Date: ${values.issue_date || nowIso().slice(0, 10)}</div>
    </div>
  </div>
  <div style="font-size:15px;font-weight:700;color:#173056">To,</div>
  <div style="margin-top:6px;font-size:16px;font-weight:800;color:#18345d">${values.employee_name || 'Employee Name'}</div>
  <div style="font-size:14px;color:#6b7f9f">${values.designation || ''}</div>
  ${metaRows ? `<div class="meta">${metaRows}</div>` : ''}
  ${sections.map((item) => `<p>${replaceTokens(item, values)}</p>`).join('')}
  <div class="sign">
    <div style="font-size:13px;color:#6b7f9f">For ${values.company_name || DEFAULT_COMPANY_DEFAULTS.company_name}</div>
    <strong>${values.hr_signatory || DEFAULT_COMPANY_DEFAULTS.hr_signatory}</strong>
    <div style="font-size:13px;color:#6b7f9f">Authorised Signatory</div>
  </div>
</div>
</body>
</html>`;
}


function pdfSafeText(value) {
  return String(value ?? '').replaceAll('₹', 'Rs. ');
}

function wrapText(text, maxChars = 95) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function buildStandardPdf(template, payload) {
  const def = templateDefinition(template.document_type);
  const values = mergeData(template, payload);
  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage([595.28, 841.89]);
  const normal = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const brandColor = rgb(0.09, 0.19, 0.37);
  const textColor = rgb(0.16, 0.23, 0.39);
  let cursorY = 790;

  function newPageIfNeeded(minY = 100) {
    if (cursorY >= minY) return;
    page = pdfDoc.addPage([595.28, 841.89]);
    cursorY = 790;
  }

  page.drawText(pdfSafeText(values.company_name || DEFAULT_COMPANY_DEFAULTS.company_name), { x: 42, y: cursorY, size: 21, font: bold, color: brandColor });
  cursorY -= 18;
  page.drawText(pdfSafeText(values.company_address || DEFAULT_COMPANY_DEFAULTS.company_address), { x: 42, y: cursorY, size: 10.5, font: normal, color: textColor });
  page.drawText(pdfSafeText(def.label.toUpperCase()), { x: 390, y: 790, size: 12, font: bold, color: brandColor });
  page.drawText(pdfSafeText(`Issue Date: ${values.issue_date || nowIso().slice(0, 10)}`), { x: 390, y: 773, size: 10.5, font: normal, color: textColor });
  cursorY -= 32;
  page.drawLine({ start: { x: 42, y: cursorY }, end: { x: 553, y: cursorY }, thickness: 1, color: rgb(0.87, 0.91, 0.96) });
  cursorY -= 28;
  page.drawText(pdfSafeText('To,'), { x: 42, y: cursorY, size: 12, font: bold, color: brandColor });
  cursorY -= 18;
  page.drawText(pdfSafeText(values.employee_name || 'Employee Name'), { x: 42, y: cursorY, size: 15, font: bold, color: textColor });
  cursorY -= 16;
  if (values.designation) {
    page.drawText(pdfSafeText(values.designation), { x: 42, y: cursorY, size: 11, font: normal, color: textColor });
    cursorY -= 18;
  }
  cursorY -= 8;

  const linesToRender = (template?.template_html ? String(template.template_html).split(/\n{2,}/).map((item) => item.trim()).filter(Boolean) : def.sections).map((item) => replaceTokens(item, values));

  for (const paragraph of linesToRender) {
    const lines = wrapText(paragraph, 95);
    for (const line of lines) {
      newPageIfNeeded();
      page.drawText(pdfSafeText(line), { x: 42, y: cursorY, size: 11.2, font: normal, color: textColor });
      cursorY -= 16;
    }
    cursorY -= 8;
  }

  newPageIfNeeded(130);
  cursorY -= 12;
  page.drawText(pdfSafeText(`For ${values.company_name || DEFAULT_COMPANY_DEFAULTS.company_name}`), { x: 42, y: cursorY, size: 11, font: normal, color: textColor });
  cursorY -= 42;
  page.drawText(pdfSafeText(values.hr_signatory || DEFAULT_COMPANY_DEFAULTS.hr_signatory), { x: 42, y: cursorY, size: 12.5, font: bold, color: brandColor });
  cursorY -= 16;
  page.drawText(pdfSafeText('Authorised Signatory'), { x: 42, y: cursorY, size: 10.5, font: normal, color: textColor });

  return pdfDoc.save();
}

async function inspectTemplatePdf(buffer) {
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  const fields = form.getFields().map((field) => ({
    name: field.getName(),
    type: field.constructor.name,
  }));
  return {
    pages: pdfDoc.getPages().length,
    fields,
  };
}

async function applyPdfTemplate(template, payload) {
  const values = mergeData(template, payload);
  const templatePath = template.file_path ? path.join(path.dirname(GENERATED_DIR), template.file_path.replace(/^generated\//, 'generated/')) : '';
  const absolutePath = template.absolute_file_path || templatePath;
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    return buildStandardPdf(template, payload);
  }
  const buffer = fs.readFileSync(absolutePath);
  const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const form = pdfDoc.getForm();
  const fields = form.getFields();
  const fieldMap = template.field_map_json || {};
  const hasPdfFields = fields.length > 0;

  if (hasPdfFields) {
    for (const [dataKey, mapping] of Object.entries(fieldMap)) {
      const fieldName = mapping?.pdfFieldName || mapping?.field_name || '';
      const value = values[dataKey];
      if (!fieldName || value === undefined || value === null) continue;
      try {
        const field = form.getField(fieldName);
        if (field?.setText) field.setText(String(value));
      } catch {}
    }
    try { form.flatten(); } catch {}
  }

  const overlayRows = Object.entries(fieldMap)
    .filter(([, mapping]) => mapping && (mapping.mode === 'overlay' || (!hasPdfFields && mapping.x !== undefined && mapping.y !== undefined)));

  if (overlayRows.length) {
    const normal = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const pages = pdfDoc.getPages();
    for (const [dataKey, mapping] of overlayRows) {
      const value = values[dataKey];
      if (value === undefined || value === null || value === '') continue;
      const pageIndex = Math.max(0, Number(mapping.page || 1) - 1);
      const page = pages[pageIndex] || pages[0];
      if (!page) continue;
      const pageHeight = page.getHeight();
      const fontSize = Number(mapping.fontSize || 11);
      const x = Number(mapping.x || 42);
      const yFromTop = Number(mapping.y || 42);
      const y = pageHeight - yFromTop - fontSize;
      const maxWidth = Number(mapping.maxWidth || 460);
      const text = pdfSafeText(String(value));
      const chosenFont = mapping.bold ? bold : normal;
      const lines = wrapText(text, Math.max(12, Math.floor(maxWidth / (fontSize * 0.48))));
      lines.forEach((line, idx) => {
        page.drawText(line, {
          x,
          y: y - idx * (fontSize + 2),
          size: fontSize,
          font: chosenFont,
          color: rgb(0.1, 0.16, 0.28),
        });
      });
    }
  }

  return pdfDoc.save();
}

function makeOutputNames(documentType, employeeName) {
  const def = templateDefinition(documentType);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const nonce = crypto.randomBytes(6).toString('hex');
  const base = `${def.filenamePrefix}-${safeFilePart(employeeName, 'employee')}-${stamp}-${nonce}`;
  return {
    pdfFileName: `${base}.pdf`,
    htmlFileName: `${base}.html`,
  };
}

function saveOutputFiles(documentType, employeeName, html, pdfBytes) {
  const names = makeOutputNames(documentType, employeeName);
  const htmlPath = path.join(OUTPUT_DIR, names.htmlFileName);
  const pdfPath = path.join(OUTPUT_DIR, names.pdfFileName);
  fs.writeFileSync(htmlPath, html, 'utf8');
  fs.writeFileSync(pdfPath, pdfBytes);
  return {
    html_path: htmlPath,
    pdf_path: pdfPath,
    html_url: `/generated/hr-head/outputs/${names.htmlFileName}`,
    pdf_url: `/generated/hr-head/outputs/${names.pdfFileName}`,
    file_name: names.pdfFileName,
  };
}

module.exports = {
  DOCUMENT_TYPES,
  DEFAULT_COMPANY_DEFAULTS,
  TEMPLATE_DIR,
  OUTPUT_DIR,
  templateDefinition,
  defaultTemplate,
  collectDocumentFields,
  mergeData,
  replaceTokens,
  renderStandardHtml,
  buildStandardPdf,
  inspectTemplatePdf,
  applyPdfTemplate,
  saveOutputFiles,
};
