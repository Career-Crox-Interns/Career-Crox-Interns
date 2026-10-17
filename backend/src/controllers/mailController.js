const { table, store } = require('../lib/store');
const { nowIso, nextId, buildCsv } = require('../lib/helpers');


const DEFAULT_MAIL_TEMPLATES = [
  {
    "template_id": "MT-MORNING",
    "title": "Morning Mail",
    "category": "Daily Plan",
    "subject": "Career Crox | Morning plan - {{date}}",
    "body": "Hi {{name}},\n\nPlease start with pending follow-ups, then fresh calls and interview scheduling. Update every worked profile with accurate notes. Share your daily calling and submission targets with your TL, and flag support needed early.\n\nRegards,\n{{sender_name}}\nCareer Crox",
    "visibility_role": "all",
    "sort_order": "1",
    "is_default": "1"
  },
  {
    "template_id": "MT-PERFORMANCE",
    "title": "Low Performance Mail",
    "category": "Performance",
    "subject": "Career Crox | Performance review and action plan",
    "body": "Hi {{name}},\n\nWe need to review your recent calling, profile submissions and interview follow-ups. Please share your completed work, challenges and a practical improvement plan with your TL today. We will agree clear targets and review progress together.\n\nRegards,\n{{sender_name}}\nCareer Crox",
    "visibility_role": "all",
    "sort_order": "2",
    "is_default": "1"
  },
  {
    "template_id": "MT-DOCUMENTS",
    "title": "Document Submission Mail",
    "category": "Documents",
    "subject": "Career Crox | Documents required",
    "body": "Hi {{name}},\n\nPlease share your updated resume, qualification documents and Aadhaar through the agreed secure channel. If experienced, also keep your previous offer letter and relevant salary documents ready. Tell us if any document is unavailable.\n\nRegards,\n{{sender_name}}\nCareer Crox",
    "visibility_role": "all",
    "sort_order": "3",
    "is_default": "1"
  },
  {
    "template_id": "MT-OFFER",
    "title": "Offer Letter Mail",
    "category": "Joining",
    "subject": "Career Crox | Offer and joining confirmation",
    "body": "Hi {{name}},\n\nPlease review the offer and confirm your joining date, work location and acceptance. Share any questions before confirming. Attach the correct offer document in Gmail before sending this draft.\n\nRegards,\n{{sender_name}}\nCareer Crox",
    "visibility_role": "all",
    "sort_order": "4",
    "is_default": "1"
  },
  {
    "template_id": "MT-INTERVIEW",
    "title": "Interview Confirmation Mail",
    "category": "Interview",
    "subject": "Career Crox | Interview confirmation",
    "body": "Hi {{name}},\n\nYour interview is being coordinated by Career Crox. Please confirm your availability, review the shared JD and keep your resume and required documents ready. Your recruiter will confirm the date, time, venue or meeting link.\n\nRegards,\n{{sender_name}}\nCareer Crox",
    "visibility_role": "all",
    "sort_order": "5",
    "is_default": "1"
  },
  {
    "template_id": "MT-FOLLOWUP",
    "title": "Candidate Follow-up Mail",
    "category": "Follow-up",
    "subject": "Career Crox | Follow-up on your application",
    "body": "Hi {{name}},\n\nPlease confirm whether you are interested in the opportunity we discussed. Share your current availability and any questions about the role so we can coordinate the next step.\n\nRegards,\n{{sender_name}}\nCareer Crox",
    "visibility_role": "all",
    "sort_order": "6",
    "is_default": "1"
  }
];
function effectiveTemplates(rows=[]){const saved=rows.filter(row=>String(row.subject||'').trim()&&String(row.body||'').trim());return [...saved,...DEFAULT_MAIL_TEMPLATES.filter(d=>!saved.some(row=>row.template_id===d.template_id||lower(row.title)===lower(d.title)))];}
function validEmail(value){return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(value||'').trim());}
function buildGmailCompose({to='',cc='',bcc='',subject='',body=''}){const params=new URLSearchParams({view:'cm',fs:'1',to,cc,bcc,su:subject,body});return 'https://mail.google.com/mail/?'+params.toString();}

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function csvList(value) {
  return String(value || '')
    .split(/[,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isLeadership(user) {
  return ['admin', 'manager', 'tl', 'team lead'].includes(lower(user?.role));
}

function isManager(user) {
  return ['admin', 'manager'].includes(lower(user?.role));
}

function normalizeRecipients(value) {
  return [...new Set(csvList(value))].join(', ');
}

function fillTemplate(text, context = {}) {
  return String(text || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => String(context[key] ?? ''));
}

function buildMailto({ to = '', cc = '', bcc = '', subject = '', body = '' }) {
  const params = new URLSearchParams();
  if (cc) params.set('cc', cc);
  if (bcc) params.set('bcc', bcc);
  if (subject) params.set('subject', subject);
  if (body) params.set('body', body);
  const query = params.toString();
  return `mailto:${to}${query ? `?${query}` : ''}`;
}

function roleCanSeeClientRow(user, row) {
  if (isManager(user)) return true;
  if (lower(user?.role) !== 'tl') return false;
  const allowedIds = csvList(row?.visible_to_tl_user_ids).map((item) => item.toLowerCase());
  const allowedCodes = csvList(row?.visible_to_tl_codes).map((item) => item.toLowerCase());
  const allowedNames = csvList(row?.visible_to_tl_names).map((item) => item.toLowerCase());
  return allowedIds.includes(lower(user?.user_id)) || allowedCodes.includes(lower(user?.recruiter_code)) || allowedNames.includes(lower(user?.full_name));
}

function decorateRecipient(user) {
  return {
    kind: 'employee',
    id: user.user_id,
    label: user.recruiter_code ? `${user.full_name} • ${user.recruiter_code}` : (user.full_name || user.username || user.user_id),
    name: user.full_name || user.username || user.user_id,
    email: validEmail(user.email) ? user.email.trim() : validEmail(user.username) ? user.username.trim() : '',
    role: user.role || '',
    recruiter_code: user.recruiter_code || '',
  };
}

function decorateClientRecipient(row) {
  return {
    kind: 'client',
    id: row.lead_id,
    label: row.client_name ? `${row.client_name}${row.contact_person ? ` • ${row.contact_person}` : ''}` : row.lead_id,
    name: row.contact_person || row.client_name || row.lead_id,
    email: row.contact_email || row.email || '',
    phone: row.contact_phone || '',
    client_name: row.client_name || '',
    lead_id: row.lead_id,
  };
}

function buildContextFromDraft(draft, recipients, user) {
  const firstRecipient = recipients[0] || {};
  return {
    name: recipients.length>1 ? 'Team' : firstRecipient.name || draft?.placeholder_name || 'Recipient',
    client_name: firstRecipient.client_name || firstRecipient.name || '',
    recruiter_code: firstRecipient.recruiter_code || '',
    sender_name: user?.full_name || user?.username || '',
    sender_email: validEmail(user?.email) ? user.email : '',
    date: new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',dateStyle:'medium'}).format(new Date()),
  };
}

async function overview(req, res) {
  const [templates, drafts, logs, users, clients] = await Promise.all([
    table('mail_templates'),
    table('mail_drafts'),
    table('mail_logs'),
    table('users'),
    table('client_pipeline'),
  ]);

  const visibleClients = clients.filter((row) => roleCanSeeClientRow(req.user, row));
  const mailRecipients = users.filter((row) => String(row.is_active || '1') !== '0').map(decorateRecipient);
  const clientRecipients = visibleClients.map(decorateClientRecipient).filter((row) => row.email);
  const visibleTemplates = effectiveTemplates(templates)
    .filter((row) => !row.visibility_role || row.visibility_role === 'all' || isLeadership(req.user) || lower(req.user?.role) === lower(row.visibility_role))
    .sort((a, b) => String(a.sort_order || '').localeCompare(String(b.sort_order || '')) || String(a.title || '').localeCompare(String(b.title || '')));
  const visibleDrafts = drafts
    .filter((row) => String(row.created_by_user_id || '') === String(req.user.user_id || '') || isLeadership(req.user))
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))
    .slice(0, 80);
  const visibleLogs = logs
    .filter((row) => String(row.created_by_user_id || '') === String(req.user.user_id || '') || isLeadership(req.user))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, 150);

  return res.json({
    templates: visibleTemplates,
    drafts: visibleDrafts,
    logs: visibleLogs,
    recipients: mailRecipients,
    clients: clientRecipients,
  });
}

async function saveTemplate(req, res) {
  const rows = await table('mail_templates');
  const templateId = String(req.body.template_id || '').trim() || nextId('MT', rows, 'template_id');
  const item = {
    template_id: templateId,
    title: String(req.body.title || '').trim(),
    category: String(req.body.category || 'General').trim(),
    subject: String(req.body.subject || '').trim(),
    body: String(req.body.body || '').trim(),
    visibility_role: String(req.body.visibility_role || 'all').trim(),
    sort_order: String(req.body.sort_order || '').trim(),
    updated_at: nowIso(),
    created_at: String(req.body.created_at || '').trim() || nowIso(),
    created_by_user_id: String(req.body.created_by_user_id || req.user.user_id || '').trim(),
    created_by_name: String(req.body.created_by_name || req.user.full_name || '').trim(),
  };
  if (!item.title) return res.status(400).json({ message: 'Template title required' });
  if (!item.subject) return res.status(400).json({ message: 'Template subject required' });
  if (!item.body) return res.status(400).json({ message: 'Template body required' });
  const saved = await store.upsert('mail_templates', 'template_id', item);
  return res.json({ item: saved });
}

async function saveDraft(req, res) {
  const rows = await table('mail_drafts');
  const draftId = String(req.body.draft_id || '').trim() || nextId('MD', rows, 'draft_id');
  const existing=rows.find(row=>String(row.draft_id)===draftId);
  if(existing && String(existing.created_by_user_id)!==String(req.user.user_id) && !isManager(req.user))return res.status(403).json({message:'This draft belongs to another user.'});
  const item = {
    draft_id: draftId,
    title: String(req.body.title || 'Working Draft').trim(),
    template_id: String(req.body.template_id || '').trim(),
    to_emails: normalizeRecipients(req.body.to_emails),
    cc_emails: normalizeRecipients(req.body.cc_emails),
    bcc_emails: normalizeRecipients(req.body.bcc_emails),
    subject: String(req.body.subject || '').trim(),
    body: String(req.body.body || '').trim(),
    target_kind: String(req.body.target_kind || 'mixed').trim(),
    placeholder_name: String(req.body.placeholder_name || '').trim(),
    created_by_user_id: String(req.user.user_id || '').trim(),
    created_by_name: String(req.user.full_name || '').trim(),
    created_at: String(req.body.created_at || '').trim() || nowIso(),
    updated_at: nowIso(),
    is_auto_generated: String(req.body.is_auto_generated || '0'),
  };
  if (!item.subject && !item.body) return res.status(400).json({ message: 'Draft subject or body required' });
  const saved = await store.upsert('mail_drafts', 'draft_id', item);
  return res.json({ item: saved });
}

async function openMail(req, res) {
  const templates = await table('mail_templates');
  const drafts = await table('mail_drafts');
  const logs = await table('mail_logs');
  const users = await table('users');
  const clients = await table('client_pipeline');

  const selectedRecipients = [
    ...users.filter((row) => csvList(req.body.user_ids).includes(String(row.user_id))),
    ...clients.filter((row) => csvList(req.body.client_ids).includes(String(row.lead_id)) && roleCanSeeClientRow(req.user, row)),
  ].map((row) => row.user_id ? decorateRecipient(row) : decorateClientRecipient(row));

  const template = effectiveTemplates(templates).find((row) => String(row.template_id) === String(req.body.template_id || '')) || null;
  const existingDraft = drafts.find((row) => String(row.draft_id) === String(req.body.draft_id || '')) || null;
  if(existingDraft && String(existingDraft.created_by_user_id)!==String(req.user.user_id) && !isManager(req.user))return res.status(403).json({message:'This mail draft belongs to another user.'});
  const customTitle = String(req.body.title || '').trim();
  const fallbackContext = buildContextFromDraft(existingDraft, selectedRecipients, req.user);
  const subjectSource = String(req.body.subject || existingDraft?.subject || template?.subject || '').trim();
  const bodySource = String(req.body.body || existingDraft?.body || template?.body || '').trim();
  const subject = fillTemplate(subjectSource, fallbackContext);
  const body = fillTemplate(bodySource, fallbackContext);
  const to_emails = normalizeRecipients(req.body.to_emails || selectedRecipients.filter((item) => item.kind === 'employee').map((item) => item.email).join(','));
  const cc_emails = normalizeRecipients(req.body.cc_emails);
  const bcc_emails = normalizeRecipients(req.body.bcc_emails || selectedRecipients.filter((item) => item.kind === 'client').map((item) => item.email).join(','));
  if (!to_emails && !cc_emails && !bcc_emails) return res.status(400).json({ message: 'At least one recipient email is required' });

  const invalidEmails=[...csvList(to_emails),...csvList(cc_emails),...csvList(bcc_emails)].filter(email=>!validEmail(email));
  if(invalidEmails.length)return res.status(400).json({message:'Enter valid recipient email addresses: '+invalidEmails.join(', ')});
  if(!subject || !body)return res.status(400).json({message:'Subject and message body are required before opening a mail draft.'});
  const logItem = {
    delivery_status:'Draft prepared',
    log_id: nextId('ML', logs, 'log_id'),
    draft_id: existingDraft?.draft_id || '',
    template_id: template?.template_id || '',
    title: customTitle || existingDraft?.title || template?.title || 'Mail',
    to_emails,
    cc_emails,
    bcc_emails,
    subject,
    body,
    sent_to_count: String([...csvList(to_emails), ...csvList(cc_emails), ...csvList(bcc_emails)].length),
    recipient_labels: selectedRecipients.map((item) => item.label).join(' | '),
    created_by_user_id: String(req.user.user_id || ''),
    created_by_name: String(req.user.full_name || ''),
    created_at: nowIso(),
  };
  await store.insert('mail_logs', logItem);

  const nextDraftItem = {
    draft_id: nextId('MD', drafts, 'draft_id'),
    title: `${logItem.title} Draft`,
    template_id: template?.template_id || existingDraft?.template_id || '',
    to_emails,
    cc_emails,
    bcc_emails,
    subject,
    body,
    target_kind: String(req.body.target_kind || existingDraft?.target_kind || 'mixed'),
    placeholder_name: fallbackContext.name || '',
    created_by_user_id: String(req.user.user_id || ''),
    created_by_name: String(req.user.full_name || ''),
    created_at: nowIso(),
    updated_at: nowIso(),
    is_auto_generated: '1',
  };
  await store.insert('mail_drafts', nextDraftItem);

  return res.json({
    ok: true,
    item: logItem,
    next_draft: nextDraftItem,
    delivery_status:'Draft prepared',
    sent:false,
    gmail_url:buildGmailCompose({to:to_emails,cc:cc_emails,bcc:bcc_emails,subject,body}),
    mailto_url: buildMailto({ to: to_emails, cc: cc_emails, bcc: bcc_emails, subject, body }),
  });
}

async function exportLogs(req, res) {
  const logs = (await table('mail_logs'))
    .filter((row) => String(row.created_by_user_id || '') === String(req.user.user_id || '') || isLeadership(req.user))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const csv = buildCsv(logs.map((row) => ({
    log_id: row.log_id,
    title: row.title,
    to_emails: row.to_emails,
    cc_emails: row.cc_emails,
    bcc_emails: row.bcc_emails,
    subject: row.subject,
    sent_to_count: row.sent_to_count,
    recipient_labels: row.recipient_labels,
    created_by_name: row.created_by_name,
    created_at: row.created_at,
  })));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="mail-logs-${new Date().toISOString().slice(0, 10)}.csv"`);
  return res.send(csv);
}

module.exports = {
  overview,
  saveTemplate,
  saveDraft,
  openMail,
  exportLogs, DEFAULT_MAIL_TEMPLATES,effectiveTemplates,validEmail,buildGmailCompose,
};
