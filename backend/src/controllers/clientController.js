const { table, store } = require('../lib/store');
const { nowIso, nextId, buildCsv, normalizeIndianPhone } = require('../lib/helpers');
const { extractClientFields, fetchPublicUrlText } = require('../lib/extractors');

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function isManager(user) {
  return ['admin', 'manager'].includes(lower(user?.role));
}

function isTl(user) {
  return lower(user?.role) === 'tl';
}

function csvList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueCsv(value) {
  return [...new Set(csvList(value))].join(', ');
}

function canView(user, row) {
  if (isManager(user)) return true;
  if (!isTl(user)) return false;
  const ids = csvList(row?.visible_to_tl_user_ids).map(lower);
  const codes = csvList(row?.visible_to_tl_codes).map(lower);
  const names = csvList(row?.visible_to_tl_names).map(lower);
  return ids.includes(lower(user?.user_id)) || codes.includes(lower(user?.recruiter_code)) || names.includes(lower(user?.full_name));
}

function mapRow(row) {
  return {
    ...row,
    contact_email: row.contact_email || row.email || '',
    visible_to_tl_user_ids: row.visible_to_tl_user_ids || '',
    visible_to_tl_codes: row.visible_to_tl_codes || '',
    visible_to_tl_names: row.visible_to_tl_names || '',
  };
}

function parseRawChunk(chunk, sourceLabel = '') {
  const raw = String(chunk || '').trim();
  if (!raw) return null;
  return extractClientFields(raw, sourceLabel);
}

function parseRawData(raw, sourceLabel = '') {
  return String(raw || '')
    .split(/\n{2,}|;+|\r\n\r\n/)
    .map((item) => parseRawChunk(item, sourceLabel))
    .filter((item) => item && (item.client_name || item.contact_phone || item.contact_email));
}

async function list(req, res) {
  const rows = (await table('client_pipeline')).map(mapRow);
  if (isManager(req.user)) return res.json({ items: rows });
  if (isTl(req.user)) return res.json({ items: rows.filter((row) => canView(req.user, row)) });
  return res.status(403).json({ message: 'Client section is manager controlled.' });
}

async function create(req, res) {
  if (!isManager(req.user)) return res.status(403).json({ message: 'Only manager can create clients.' });
  const rows = await table('client_pipeline');
  const item = {
    lead_id: nextId('LEAD', rows, 'lead_id'),
    client_name: String(req.body.client_name || '').trim(),
    contact_person: String(req.body.contact_person || '').trim(),
    contact_phone: normalizeIndianPhone(req.body.contact_phone || ''),
    contact_email: String(req.body.contact_email || '').trim(),
    city: String(req.body.city || '').trim(),
    industry: String(req.body.industry || '').trim(),
    status: String(req.body.status || 'Active').trim(),
    owner_username: String(req.body.owner_username || req.user.username || '').trim(),
    priority: String(req.body.priority || 'Medium').trim(),
    openings_count: String(req.body.openings_count || '').trim(),
    last_follow_up_at: String(req.body.last_follow_up_at || '').trim(),
    next_follow_up_at: String(req.body.next_follow_up_at || '').trim(),
    notes: String(req.body.notes || '').trim(),
    visible_to_tl_user_ids: uniqueCsv(req.body.visible_to_tl_user_ids),
    visible_to_tl_codes: uniqueCsv(req.body.visible_to_tl_codes),
    visible_to_tl_names: uniqueCsv(req.body.visible_to_tl_names),
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  if (!item.client_name) return res.status(400).json({ message: 'Client name required' });
  const saved = await store.insert('client_pipeline', item);
  return res.json({ item: saved });
}

async function update(req, res) {
  const leadId = String(req.params.leadId || '').trim();
  if (!leadId) return res.status(400).json({ message: 'Lead id required' });
  const existing = await store.findById('client_pipeline', 'lead_id', leadId);
  if (!existing) return res.status(404).json({ message: 'Client not found' });
  if (!isManager(req.user)) return res.status(403).json({ message: 'Only manager can update clients.' });
  const updates = {
    client_name: String(req.body.client_name ?? existing.client_name ?? '').trim(),
    contact_person: String(req.body.contact_person ?? existing.contact_person ?? '').trim(),
    contact_phone: req.body.contact_phone !== undefined ? normalizeIndianPhone(req.body.contact_phone || '') : (existing.contact_phone || ''),
    contact_email: req.body.contact_email !== undefined ? String(req.body.contact_email || '').trim() : (existing.contact_email || existing.email || ''),
    city: String(req.body.city ?? existing.city ?? '').trim(),
    industry: String(req.body.industry ?? existing.industry ?? '').trim(),
    status: String(req.body.status ?? existing.status ?? '').trim(),
    priority: String(req.body.priority ?? existing.priority ?? '').trim(),
    openings_count: String(req.body.openings_count ?? existing.openings_count ?? '').trim(),
    last_follow_up_at: String(req.body.last_follow_up_at ?? existing.last_follow_up_at ?? '').trim(),
    next_follow_up_at: String(req.body.next_follow_up_at ?? existing.next_follow_up_at ?? '').trim(),
    notes: String(req.body.notes ?? existing.notes ?? '').trim(),
    visible_to_tl_user_ids: req.body.visible_to_tl_user_ids !== undefined ? uniqueCsv(req.body.visible_to_tl_user_ids) : (existing.visible_to_tl_user_ids || ''),
    visible_to_tl_codes: req.body.visible_to_tl_codes !== undefined ? uniqueCsv(req.body.visible_to_tl_codes) : (existing.visible_to_tl_codes || ''),
    visible_to_tl_names: req.body.visible_to_tl_names !== undefined ? uniqueCsv(req.body.visible_to_tl_names) : (existing.visible_to_tl_names || ''),
    updated_at: nowIso(),
  };
  const saved = await store.update('client_pipeline', 'lead_id', leadId, updates);
  return res.json({ item: saved });
}

async function importParsed(req, res) {
  if (!isManager(req.user)) return res.status(403).json({ message: 'Only manager can import client data.' });
  const rows = await table('client_pipeline');
  const inputRows = Array.isArray(req.body.items) && req.body.items.length ? req.body.items : parseRawData(req.body.raw_text || '');
  const created = [];
  let counter = rows.length;
  for (const source of inputRows) {
    counter += 1;
    const item = {
      lead_id: `LEAD${String(counter).padStart(3, '0')}`,
      client_name: String(source.client_name || source.contact_person || `Parsed Client ${counter}`).trim(),
      contact_person: String(source.contact_person || source.client_name || '').trim(),
      contact_phone: normalizeIndianPhone(source.contact_phone || source.phone || ''),
      contact_email: String(source.contact_email || source.email || '').trim(),
      city: String(source.city || '').trim(),
      industry: String(source.industry || '').trim(),
      status: String(source.status || 'Active').trim(),
      owner_username: String(req.user.username || '').trim(),
      priority: String(source.priority || 'Medium').trim(),
      openings_count: String(source.openings_count || '').trim(),
      last_follow_up_at: '',
      next_follow_up_at: '',
      notes: String(source.notes || source.raw || '').trim(),
      visible_to_tl_user_ids: '',
      visible_to_tl_codes: '',
      visible_to_tl_names: '',
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    const saved = await store.insert('client_pipeline', item);
    created.push(saved);
  }
  return res.json({ items: created, count: created.length });
}

async function exportCsv(req, res) {
  if (!isManager(req.user)) return res.status(403).json({ message: 'Only manager can export clients.' });
  const rows = (await table('client_pipeline')).map(mapRow);
  const csv = buildCsv(rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="client-pipeline-${new Date().toISOString().slice(0, 10)}.csv"`);
  return res.send(csv);
}

async function parseRaw(req, res) {
  if (!isManager(req.user)) return res.status(403).json({ message: 'Only manager can parse raw client data.' });
  return res.json({ items: parseRawData(req.body.raw_text || '', req.body.source_label || 'raw-text') });
}

async function extractUrl(req, res) {
  if (!isManager(req.user)) return res.status(403).json({ message: 'Only manager can use data extractor.' });
  const url = String(req.body.url || '').trim();
  if (!url) return res.status(400).json({ message: 'Public URL required.' });
  const page = await fetchPublicUrlText(url);
  const items = parseRawData(page.text || '', page.title || page.url || url);
  if (!items.length) {
    const fallback = extractClientFields(page.text || '', page.title || page.url || url);
    if (fallback.client_name || fallback.contact_phone || fallback.contact_email) items.push(fallback);
  }
  return res.json({ items, page: { url: page.url, title: page.title } });
}

module.exports = {
  list,
  create,
  update,
  importParsed,
  exportCsv,
  parseRaw,
  extractUrl,
};
