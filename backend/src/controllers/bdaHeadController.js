const { table, store } = require('../lib/store');
const { nowIso, buildCsv, normalizeIndianPhone } = require('../lib/helpers');
const { extractBdaLeadFields, fetchPublicUrlText, parseRawData } = require('../lib/bdaLeadExtractors');

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function isLeadership(user) {
  return Boolean(user?.user_id || user?.username);
}

function isManager(user) {
  return ['admin', 'manager'].includes(lower(user?.role));
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

function normalizeStage(value) {
  const stage = String(value || '').trim();
  return stage || 'New';
}

function inferSerial(row) {
  const explicit = Number(row?.sr_no || 0);
  if (explicit > 0) return explicit;
  const numeric = Number(String(row?.lead_id || '').replace(/\D/g, ''));
  return Number.isFinite(numeric) ? numeric : 0;
}

function nextSerial(rows = []) {
  let max = 0;
  for (const row of rows) {
    const candidate = inferSerial(row);
    if (candidate > max) max = candidate;
  }
  return max + 1;
}

function leadCode(srNo) {
  return `BDA-${String(Number(srNo || 0)).padStart(4, '0')}`;
}

function mapLead(row) {
  return {
    ...row,
    sr_no: inferSerial(row),
    lead_id: String(row.lead_id || leadCode(inferSerial(row))),
    company_name: row.company_name || row.client_name || '',
    contact_name: row.contact_name || row.contact_person || '',
    score: Number(row.score || 0),
    tags: row.tags || '',
    post_author_name: row.post_author_name || '',
    post_author_linkedin_url: row.post_author_linkedin_url || '',
    post_date: row.post_date || '',
    post_text: row.post_text || row.raw_snapshot || '',
    search_string: row.search_string || '',
    result_window_from: row.result_window_from || '',
    result_window_to: row.result_window_to || '',
  };
}

function canViewLead(user, row) {
  if (isManager(user)) return true;
  if (lower(row.owner_username) === lower(user?.username)) return true;
  if (csvList(row.shared_with || '').map(lower).includes(lower(user?.username))) return true;
  return false;
}

function parseMeta(body = {}) {
  return {
    search_string: String(body.search_string || '').trim(),
    result_window_from: String(body.result_window_from || '').trim(),
    result_window_to: String(body.result_window_to || '').trim(),
    source_url: String(body.source_url || body.url || '').trim(),
  };
}

function enrichPreviewRows(rows = [], startingSerial = 1) {
  return rows.map((item, index) => ({
    include: item.include !== false,
    preview_key: item.preview_key || `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    preview_serial_no: Number(startingSerial || 1) + index,
    ...item,
  }));
}

async function list(req, res) {
  if (!isLeadership(req.user)) return res.status(403).json({ message: 'BDA is available for logged-in users.' });
  const rows = (await table('bda_leads')).map(mapLead);
  const visible = rows.filter((row) => canViewLead(req.user, row));
  const dueCount = visible.filter((row) => String(row.next_follow_up_at || '').slice(0, 10) && String(row.next_follow_up_at || '').slice(0, 10) <= new Date().toISOString().slice(0, 10)).length;
  const hotCount = visible.filter((row) => lower(row.lead_type) === 'hot').length;
  const pendingCount = visible.filter((row) => !['won', 'lost'].includes(lower(row.status))).length;
  return res.json({
    items: visible.sort((a, b) => Number(b.sr_no || 0) - Number(a.sr_no || 0)),
    stats: {
      total: visible.length,
      due: dueCount,
      hot: hotCount,
      pending: pendingCount,
      max_serial: visible.reduce((max, row) => Math.max(max, Number(row.sr_no || 0)), 0),
    },
  });
}

async function meta(req, res) {
  if (!isLeadership(req.user)) return res.status(403).json({ message: 'BDA is available for logged-in users.' });
  const playbooks = [
    {
      key: 'linkedin',
      title: 'LinkedIn visible-post capture',
      lines: [
        'Run your Boolean string, scroll results manually, then copy the visible post blocks.',
        'Paste those visible chunks here. The parser fills author, post date, post text, phone, email and URL where visible.',
        'Use search string and result window fields so you remember exactly what list created the lead.'
      ]
    },
    {
      key: 'google',
      title: 'Google + public pages',
      lines: [
        'Target company careers pages, hiring pages, staffing vendor needs, HR pages and contact pages.',
        'Paste search snippets or a public page URL.',
        'Public sites usually give cleaner company, email, phone and website extraction.'
      ]
    },
    {
      key: 'whatsapp',
      title: 'WhatsApp / raw references',
      lines: [
        'Paste copied group messages or referral blocks.',
        'One block per lead works best.',
        'Review rows, untick noise, then press Add to Database.'
      ]
    },
    {
      key: 'retention',
      title: 'Warm + retain logic',
      lines: [
        'Store source, stage, next follow-up and activity in one place.',
        'Use the activity log after Gmail, WhatsApp or LinkedIn app actions.',
        'This keeps old leads warm instead of letting them die in random chats.'
      ]
    }
  ];

  const handoff = [
    'Visible LinkedIn post text copied from search results',
    'Public URL of company page, hiring page or public profile',
    'WhatsApp raw chat export text or copied message batch',
    'Google search snippets pasted in one block',
    'Referral list with company, contact name, number and context',
    'Mail thread dump or sent-recipient list with subject line'
  ];

  const autoFillFields = [
    'Serial Number on save',
    'Lead ID',
    'Source Channel',
    'Source Label',
    'Search String',
    'Result Window From',
    'Result Window To',
    'Post Author Name',
    'Post Author LinkedIn URL',
    'Post Date',
    'Post Text',
    'Company Name',
    'Contact Name',
    'Phone',
    'Email',
    'LinkedIn URL',
    'Source URL',
    'City',
    'Industry',
    'Lead Type',
    'Priority',
    'Stage',
    'Notes',
    'Raw Snapshot',
    'Score'
  ];

  return res.json({
    playbooks,
    handoff,
    autoFillFields,
    booleans: {
      linkedin: '(vendor OR staffing OR "recruitment support" OR BPO) AND (Noida OR Gurgaon OR Delhi) AND ("contact number" OR email OR mail OR whatsapp)',
      google: 'site:linkedin.com/posts (vendor OR staffing OR "recruitment support") (Noida OR Gurgaon OR Delhi) ("contact number" OR email)',
      companySearch: '("we are hiring" OR "multiple openings" OR "staffing partner" OR "recruitment support") (Noida OR Gurgaon OR Delhi) (contact OR careers OR hiring)'
    }
  });
}

async function create(req, res) {
  if (!isLeadership(req.user)) return res.status(403).json({ message: 'Only logged-in users can create BDA leads.' });
  const rows = await table('bda_leads');
  const srNo = nextSerial(rows);
  const item = {
    sr_no: srNo,
    lead_id: leadCode(srNo),
    company_name: String(req.body.company_name || '').trim(),
    contact_name: String(req.body.contact_name || '').trim(),
    phone: normalizeIndianPhone(req.body.phone || ''),
    email: String(req.body.email || '').trim(),
    website: String(req.body.website || '').trim(),
    linkedin_url: String(req.body.linkedin_url || '').trim(),
    source_channel: String(req.body.source_channel || 'Manual').trim(),
    source_label: String(req.body.source_label || req.body.source_channel || 'Manual').trim(),
    source_url: String(req.body.source_url || '').trim(),
    search_string: String(req.body.search_string || '').trim(),
    result_window_from: String(req.body.result_window_from || '').trim(),
    result_window_to: String(req.body.result_window_to || '').trim(),
    city: String(req.body.city || '').trim(),
    industry: String(req.body.industry || '').trim(),
    company_size: String(req.body.company_size || '').trim(),
    lead_type: String(req.body.lead_type || 'Warm').trim(),
    intent_signal: String(req.body.intent_signal || '').trim(),
    stage: normalizeStage(req.body.stage),
    priority: String(req.body.priority || 'Medium').trim(),
    status: String(req.body.status || 'Open').trim(),
    score: Number(req.body.score || 0),
    owner_username: String(req.body.owner_username || req.user.username || '').trim(),
    assigned_to: String(req.body.assigned_to || '').trim(),
    shared_with: uniqueCsv(req.body.shared_with),
    last_contact_at: String(req.body.last_contact_at || '').trim(),
    next_follow_up_at: String(req.body.next_follow_up_at || '').trim(),
    tags: String(req.body.tags || '').trim(),
    notes: String(req.body.notes || '').trim(),
    raw_snapshot: String(req.body.raw_snapshot || '').trim().slice(0, 1600),
    post_author_name: String(req.body.post_author_name || '').trim(),
    post_author_linkedin_url: String(req.body.post_author_linkedin_url || '').trim(),
    post_date: String(req.body.post_date || '').trim(),
    post_text: String(req.body.post_text || '').trim().slice(0, 900),
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  if (!item.company_name && !item.phone && !item.email) return res.status(400).json({ message: 'At least company, phone or email is required.' });
  const saved = await store.insert('bda_leads', item);
  return res.json({ item: mapLead(saved) });
}

async function update(req, res) {
  if (!isLeadership(req.user)) return res.status(403).json({ message: 'Only logged-in users can update BDA leads.' });
  const leadId = String(req.params.leadId || '').trim();
  if (!leadId) return res.status(400).json({ message: 'Lead id required.' });
  const existing = await store.findById('bda_leads', 'lead_id', leadId);
  if (!existing) return res.status(404).json({ message: 'Lead not found.' });

  const updates = {
    company_name: String(req.body.company_name ?? existing.company_name ?? '').trim(),
    contact_name: String(req.body.contact_name ?? existing.contact_name ?? '').trim(),
    phone: req.body.phone !== undefined ? normalizeIndianPhone(req.body.phone || '') : (existing.phone || ''),
    email: req.body.email !== undefined ? String(req.body.email || '').trim() : (existing.email || ''),
    website: req.body.website !== undefined ? String(req.body.website || '').trim() : (existing.website || ''),
    linkedin_url: req.body.linkedin_url !== undefined ? String(req.body.linkedin_url || '').trim() : (existing.linkedin_url || ''),
    source_channel: req.body.source_channel !== undefined ? String(req.body.source_channel || '').trim() : (existing.source_channel || ''),
    source_label: req.body.source_label !== undefined ? String(req.body.source_label || '').trim() : (existing.source_label || ''),
    source_url: req.body.source_url !== undefined ? String(req.body.source_url || '').trim() : (existing.source_url || ''),
    search_string: req.body.search_string !== undefined ? String(req.body.search_string || '').trim() : (existing.search_string || ''),
    result_window_from: req.body.result_window_from !== undefined ? String(req.body.result_window_from || '').trim() : (existing.result_window_from || ''),
    result_window_to: req.body.result_window_to !== undefined ? String(req.body.result_window_to || '').trim() : (existing.result_window_to || ''),
    city: req.body.city !== undefined ? String(req.body.city || '').trim() : (existing.city || ''),
    industry: req.body.industry !== undefined ? String(req.body.industry || '').trim() : (existing.industry || ''),
    company_size: req.body.company_size !== undefined ? String(req.body.company_size || '').trim() : (existing.company_size || ''),
    lead_type: req.body.lead_type !== undefined ? String(req.body.lead_type || '').trim() : (existing.lead_type || ''),
    intent_signal: req.body.intent_signal !== undefined ? String(req.body.intent_signal || '').trim() : (existing.intent_signal || ''),
    stage: req.body.stage !== undefined ? normalizeStage(req.body.stage) : (existing.stage || 'New'),
    priority: req.body.priority !== undefined ? String(req.body.priority || '').trim() : (existing.priority || ''),
    status: req.body.status !== undefined ? String(req.body.status || '').trim() : (existing.status || ''),
    score: req.body.score !== undefined ? Number(req.body.score || 0) : Number(existing.score || 0),
    owner_username: req.body.owner_username !== undefined ? String(req.body.owner_username || '').trim() : (existing.owner_username || ''),
    assigned_to: req.body.assigned_to !== undefined ? String(req.body.assigned_to || '').trim() : (existing.assigned_to || ''),
    shared_with: req.body.shared_with !== undefined ? uniqueCsv(req.body.shared_with) : (existing.shared_with || ''),
    last_contact_at: req.body.last_contact_at !== undefined ? String(req.body.last_contact_at || '').trim() : (existing.last_contact_at || ''),
    next_follow_up_at: req.body.next_follow_up_at !== undefined ? String(req.body.next_follow_up_at || '').trim() : (existing.next_follow_up_at || ''),
    tags: req.body.tags !== undefined ? String(req.body.tags || '').trim() : (existing.tags || ''),
    notes: req.body.notes !== undefined ? String(req.body.notes || '').trim() : (existing.notes || ''),
    raw_snapshot: req.body.raw_snapshot !== undefined ? String(req.body.raw_snapshot || '').trim().slice(0, 1600) : (existing.raw_snapshot || ''),
    post_author_name: req.body.post_author_name !== undefined ? String(req.body.post_author_name || '').trim() : (existing.post_author_name || ''),
    post_author_linkedin_url: req.body.post_author_linkedin_url !== undefined ? String(req.body.post_author_linkedin_url || '').trim() : (existing.post_author_linkedin_url || ''),
    post_date: req.body.post_date !== undefined ? String(req.body.post_date || '').trim() : (existing.post_date || ''),
    post_text: req.body.post_text !== undefined ? String(req.body.post_text || '').trim().slice(0, 900) : (existing.post_text || ''),
    updated_at: nowIso(),
  };

  const saved = await store.update('bda_leads', 'lead_id', leadId, updates);
  return res.json({ item: mapLead(saved) });
}

async function logActivity(req, res) {
  if (!isLeadership(req.user)) return res.status(403).json({ message: 'Only logged-in users can log activity.' });
  const leadId = String(req.params.leadId || '').trim();
  const lead = await store.findById('bda_leads', 'lead_id', leadId);
  if (!lead) return res.status(404).json({ message: 'Lead not found.' });
  const rows = await table('bda_activities');
  const next = rows.reduce((max, row) => Math.max(max, Number(String(row.activity_id || '').replace(/\D/g, '')) || 0), 0) + 1;
  const item = {
    activity_id: `BDAACT-${String(next).padStart(4, '0')}`,
    lead_id: leadId,
    activity_type: String(req.body.activity_type || 'Note').trim(),
    summary: String(req.body.summary || '').trim(),
    outcome: String(req.body.outcome || '').trim(),
    created_by: String(req.user.username || '').trim(),
    created_at: nowIso(),
  };
  if (!item.summary) return res.status(400).json({ message: 'Activity summary required.' });
  const saved = await store.insert('bda_activities', item);
  return res.json({ item: saved });
}

async function activities(req, res) {
  if (!isLeadership(req.user)) return res.status(403).json({ message: 'Only logged-in users can view activity.' });
  const leadId = String(req.params.leadId || '').trim();
  const rows = (await table('bda_activities')).filter((row) => String(row.lead_id || '') === leadId);
  return res.json({ items: rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))) });
}

async function parseRaw(req, res) {
  if (!isLeadership(req.user)) return res.status(403).json({ message: 'Only logged-in users can parse raw BDA data.' });
  const sourceLabel = String(req.body.source_label || 'raw-text').trim();
  const currentRows = await table('bda_leads');
  const startSerial = nextSerial(currentRows);
  const meta = parseMeta(req.body || {});
  const items = enrichPreviewRows(
    parseRawData(req.body.raw_text || '', sourceLabel, meta)
      .map((item) => ({ ...item, score: Number(item.score || 0) }))
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0)),
    startSerial,
  );
  return res.json({ items, next_serial: startSerial });
}

async function extractUrl(req, res) {
  if (!isLeadership(req.user)) return res.status(403).json({ message: 'Only logged-in users can use URL extraction.' });
  const url = String(req.body.url || '').trim();
  if (!url) return res.status(400).json({ message: 'Public URL required.' });
  const page = await fetchPublicUrlText(url);
  const currentRows = await table('bda_leads');
  const startSerial = nextSerial(currentRows);
  const meta = { ...parseMeta(req.body || {}), source_url: page.url || url };
  let items = parseRawData(page.text || '', page.title || page.url || url, meta);
  if (!items.length) {
    items = [extractBdaLeadFields(page.text || '', page.title || page.url || url, meta)];
  }
  return res.json({
    page: { url: page.url, title: page.title },
    next_serial: startSerial,
    items: enrichPreviewRows(items.filter((item) => item.company_name || item.phone || item.email || item.website || item.post_text), startSerial),
  });
}

async function importParsed(req, res) {
  if (!isLeadership(req.user)) return res.status(403).json({ message: 'Only logged-in users can import parsed leads.' });
  const rows = await table('bda_leads');
  const inputRows = Array.isArray(req.body.items) ? req.body.items.filter((item) => item && item.include !== false) : [];
  const created = [];
  let serial = nextSerial(rows) - 1;
  for (const rawItem of inputRows) {
    serial += 1;
    const item = {
      sr_no: serial,
      lead_id: leadCode(serial),
      company_name: String(rawItem.company_name || rawItem.client_name || rawItem.post_author_name || `Lead ${serial}`).trim(),
      contact_name: String(rawItem.contact_name || rawItem.contact_person || rawItem.post_author_name || '').trim(),
      phone: normalizeIndianPhone(rawItem.phone || rawItem.contact_phone || ''),
      email: String(rawItem.email || rawItem.contact_email || '').trim(),
      website: String(rawItem.website || '').trim(),
      linkedin_url: String(rawItem.linkedin_url || rawItem.post_author_linkedin_url || '').trim(),
      source_channel: String(rawItem.source_channel || 'Manual').trim(),
      source_label: String(rawItem.source_label || rawItem.source_channel || 'Manual').trim(),
      source_url: String(rawItem.source_url || '').trim(),
      search_string: String(rawItem.search_string || '').trim(),
      result_window_from: String(rawItem.result_window_from || '').trim(),
      result_window_to: String(rawItem.result_window_to || '').trim(),
      city: String(rawItem.city || '').trim(),
      industry: String(rawItem.industry || '').trim(),
      company_size: String(rawItem.company_size || '').trim(),
      lead_type: String(rawItem.lead_type || 'Warm').trim(),
      intent_signal: String(rawItem.intent_signal || '').trim(),
      stage: normalizeStage(rawItem.stage || 'New'),
      priority: String(rawItem.priority || 'Medium').trim(),
      status: String(rawItem.status || 'Open').trim(),
      score: Number(rawItem.score || 0),
      owner_username: String(req.user.username || '').trim(),
      assigned_to: '',
      shared_with: '',
      last_contact_at: '',
      next_follow_up_at: '',
      tags: String(rawItem.tags || '').trim(),
      notes: String(rawItem.notes || '').trim(),
      raw_snapshot: String(rawItem.raw_snapshot || rawItem.post_text || '').trim().slice(0, 1600),
      post_author_name: String(rawItem.post_author_name || rawItem.contact_name || '').trim(),
      post_author_linkedin_url: String(rawItem.post_author_linkedin_url || rawItem.linkedin_url || '').trim(),
      post_date: String(rawItem.post_date || '').trim(),
      post_text: String(rawItem.post_text || rawItem.raw_snapshot || '').trim().slice(0, 900),
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    const saved = await store.insert('bda_leads', item);
    created.push(mapLead(saved));
  }
  return res.json({ items: created, count: created.length, last_serial: serial });
}

async function exportCsv(req, res) {
  if (!isLeadership(req.user)) return res.status(403).json({ message: 'Only logged-in users can export BDA leads.' });
  const rows = (await table('bda_leads')).map(mapLead);
  const csv = buildCsv(rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="bda-head-${new Date().toISOString().slice(0, 10)}.csv"`);
  return res.send(csv);
}

module.exports = {
  list,
  meta,
  create,
  update,
  logActivity,
  activities,
  parseRaw,
  extractUrl,
  importParsed,
  exportCsv,
};
