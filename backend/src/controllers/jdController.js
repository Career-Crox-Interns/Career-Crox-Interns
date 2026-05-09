const { store, table } = require('../lib/store');
const { nextId, nowIso } = require('../lib/helpers');

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function splitLines(value) {
  return String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function parseInstructionItems(value) {
  if (Array.isArray(value)) {
    return value.map((item, idx) => {
      if (typeof item === 'string') return { title: `Instruction ${idx + 1}`, content: item.trim() };
      return {
        title: String(item?.title || `Instruction ${idx + 1}`).trim(),
        content: String(item?.content || item?.message || '').trim(),
      };
    }).filter((item) => item.title || item.content);
  }
  try {
    const parsed = JSON.parse(String(value || '[]'));
    if (Array.isArray(parsed)) return parseInstructionItems(parsed);
  } catch {}
  return splitLines(value).map((item, idx) => ({ title: `Instruction ${idx + 1}`, content: item }));
}

function serializeInstructionItems(value) {
  return JSON.stringify(parseInstructionItems(value));
}

function parseSendItems(value) {
  if (Array.isArray(value)) {
    return value.map((item, idx) => ({
      order_no: Number(item?.order_no || idx + 1),
      label: String(item?.label || `Send Material ${idx + 1}`).trim(),
      message: String(item?.message || item?.content || '').trim(),
      link: String(item?.link || '').trim(),
      kind: 'text',
    })).filter((item) => item.label || item.message || item.link);
  }
  try {
    const parsed = JSON.parse(String(value || '[]'));
    if (Array.isArray(parsed)) return parseSendItems(parsed);
  } catch {}
  return splitLines(value).map((line, idx) => {
    const [label, message, link] = String(line || '').split('|').map((part) => String(part || '').trim());
    if (!label && !message && !link) return null;
    return { order_no: idx + 1, label: label || `Send Material ${idx + 1}`, message: message || '', link: link || '', kind: 'text' };
  }).filter(Boolean);
}

function serializeSendItems(value) {
  return JSON.stringify(parseSendItems(value));
}

function normalizeJd(body = {}, existing = {}) {
  const salaryMin = body.salary_min ?? existing.salary_min ?? '';
  const salaryMax = body.salary_max ?? existing.salary_max ?? '';
  const expMin = body.exp_min ?? existing.exp_min ?? '';
  const expMax = body.exp_max ?? existing.exp_max ?? '';
  return {
    ...existing,
    job_title: body.job_title ?? existing.job_title ?? '',
    company: body.company ?? existing.company ?? '',
    location: body.location ?? existing.location ?? '',
    preferred_location_rule: body.preferred_location_rule ?? existing.preferred_location_rule ?? '',
    qualification_rule: body.qualification_rule ?? existing.qualification_rule ?? '',
    communication_rule: body.communication_rule ?? existing.communication_rule ?? '',
    career_gap_rule: body.career_gap_rule ?? existing.career_gap_rule ?? '',
    documents_rule: body.documents_rule ?? existing.documents_rule ?? '',
    all_details_sent_rule: body.all_details_sent_rule ?? existing.all_details_sent_rule ?? '',
    relevant_experience_rule: body.relevant_experience_rule ?? existing.relevant_experience_rule ?? '',
    relevant_salary_rule: body.relevant_salary_rule ?? existing.relevant_salary_rule ?? '',
    process_name: body.process_name ?? existing.process_name ?? '',
    experience: body.experience ?? existing.experience ?? ([expMin, expMax].filter(Boolean).join('-')),
    salary: body.salary ?? existing.salary ?? ([salaryMin, salaryMax].filter(Boolean).join('-')),
    salary_min: salaryMin,
    salary_max: salaryMax,
    exp_min: expMin,
    exp_max: expMax,
    pdf_url: body.pdf_url ?? existing.pdf_url ?? '',
    jd_status: body.jd_status ?? existing.jd_status ?? 'Open',
    notes: body.notes ?? existing.notes ?? '',
    instruction_points: serializeInstructionItems(body.instruction_points ?? existing.instruction_points ?? []),
    message_template: body.message_template ?? existing.message_template ?? '',
    send_items: serializeSendItems(body.send_items ?? existing.send_items ?? []),
    updated_at: nowIso(),
  };
}

function decorate(row) {
  return {
    ...row,
    instruction_points_list: parseInstructionItems(row.instruction_points),
    send_items_list: parseSendItems(row.send_items),
  };
}

function assertManager(user) {
  const role = lower(user?.role);
  if (!['admin', 'manager'].includes(role)) {
    const err = new Error('Only manager can edit JD Centre');
    err.statusCode = 403;
    throw err;
  }
}

async function list(req, res) {
  const rows = (await table('jd_master')).map(decorate).sort((a, b) => String(a.job_title || '').localeCompare(String(b.job_title || '')));
  return res.json({ items: rows });
}

async function getOne(req, res) {
  const item = await store.findById('jd_master', 'jd_id', req.params.jdId);
  if (!item) return res.status(404).json({ message: 'JD not found' });
  const feedback = (await table('candidate_jd_feedback')).filter((row) => String(row.jd_id) === String(req.params.jdId)).sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))).slice(0, 100);
  return res.json({ item: decorate(item), feedback });
}

async function create(req, res) {
  assertManager(req.user);
  const rows = await table('jd_master');
  const item = normalizeJd(req.body, {
    jd_id: nextId('J', rows, 'jd_id'),
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  await store.insert('jd_master', item);
  return res.json({ item: decorate(item) });
}

async function update(req, res) {
  assertManager(req.user);
  const existing = await store.findById('jd_master', 'jd_id', req.params.jdId);
  if (!existing) return res.status(404).json({ message: 'JD not found' });
  const item = await store.update('jd_master', 'jd_id', req.params.jdId, normalizeJd(req.body, existing));
  return res.json({ item: decorate(item) });
}

async function feedback(req, res) {
  const jd = await store.findById('jd_master', 'jd_id', req.params.jdId);
  if (!jd) return res.status(404).json({ message: 'JD not found' });
  const candidateId = String(req.body.candidate_id || '').trim();
  if (!candidateId) return res.status(400).json({ message: 'candidate_id is required' });
  const rows = await table('candidate_jd_feedback');
  const existing = rows.find((row) => String(row.jd_id) === String(req.params.jdId) && String(row.candidate_id) === candidateId);
  const payload = {
    feedback_id: existing?.feedback_id || nextId('F', rows, 'feedback_id'),
    jd_id: req.params.jdId,
    candidate_id: candidateId,
    feedback_status: req.body.feedback_status || 'Pending',
    feedback_note: req.body.feedback_note || '',
    username: req.user?.username || '',
    user_id: req.user?.user_id || '',
    updated_at: nowIso(),
    created_at: existing?.created_at || nowIso(),
  };
  const item = existing
    ? await store.update('candidate_jd_feedback', 'feedback_id', existing.feedback_id, payload)
    : await store.insert('candidate_jd_feedback', payload);
  return res.json({ item });
}

module.exports = { list, getOne, create, update, feedback };
