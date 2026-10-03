const http = require('http');
const https = require('https');
const { normalizeIndianPhone } = require('./helpers');

const GENERIC_LABEL_WORDS = new Set([
  'manual', 'visible', 'capture', 'post', 'posts', 'raw', 'text', 'link', 'linkedin', 'google', 'whatsapp',
  'data', 'import', 'source', 'label', 'public', 'url', 'search', 'result', 'results', 'window', 'page', 'pages',
  'lead', 'leads', 'record', 'records', 'profile', 'profiles', 'export', 'copy', 'paste', 'parsed', 'parser', 'file',
]);

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function uniqueList(list = []) {
  return [...new Set(list.map((item) => String(item || '').trim()).filter(Boolean))];
}

function titleCase(value) {
  return String(value || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
    .trim();
}

function htmlToText(html = '') {
  return normalizeWhitespace(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h\d|tr|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
  );
}

function extractEmails(text = '') {
  return uniqueList(String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []);
}

function phoneCandidates(text = '') {
  const raw = String(text || '');
  const regex = /(?:\+?91[\s-]*)?[6-9](?:[\s-]*\d){9}/g;
  const candidates = [];
  for (const match of raw.matchAll(regex)) {
    const value = normalizeIndianPhone(match[0]);
    if (!value || value.length !== 10) continue;
    const index = Number(match.index || 0);
    const context = raw.slice(Math.max(0, index - 64), Math.min(raw.length, index + match[0].length + 36)).toLowerCase();
    let score = 20;
    if (/(mobile|phone|contact|call|whatsapp|wa\b|mob\b)/.test(context)) score += 35;
    if (/(primary|main|client|vendor|business)/.test(context)) score += 12;
    if (/(alternate|alt|other|secondary)/.test(context)) score -= 3;
    if (/(dob|birth|year|salary|ctc|pin|zipcode|postal|aadhaar|aadhar|pan|invoice|otp|date)/.test(context)) score -= 30;
    candidates.push({ value, index, score });
  }
  const seen = new Map();
  for (const item of candidates) {
    const previous = seen.get(item.value);
    if (!previous || item.score > previous.score || (item.score === previous.score && item.index < previous.index)) {
      seen.set(item.value, item);
    }
  }
  return [...seen.values()].sort((a, b) => (b.score - a.score) || (a.index - b.index));
}

function extractPhones(text = '') {
  return phoneCandidates(text).map((item) => item.value);
}

function extractUrls(text = '') {
  const urls = String(text || '').match(/https?:\/\/[^\s)\]"'>]+/gi) || [];
  return uniqueList(urls.map((item) => item.replace(/[),.;]+$/, '')));
}

function filenameNameCandidate(fallback = '') {
  const base = String(fallback || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return '';
  const tokens = base
    .split(/\s+/)
    .filter(Boolean)
    .filter((part) => !GENERIC_LABEL_WORDS.has(String(part || '').toLowerCase()))
    .filter((part) => !/^(resume|cv|candidate|updated|latest|new|draft|final|version|scan)$/i.test(part))
    .filter((part) => !/^\d+$/.test(part));
  if (!tokens.length) return '';
  const text = titleCase(tokens.slice(0, 4).join(' '));
  return text.length >= 3 ? text : '';
}

function looksLikeHumanName(value = '') {
  const clean = String(value || '').replace(/^[^A-Za-z]+|[^A-Za-z.' -]+$/g, '').trim();
  if (!clean || clean.length < 3 || clean.length > 60) return false;
  if (/\d/.test(clean)) return false;
  if (!/^[A-Za-z][A-Za-z.' -]+$/.test(clean)) return false;
  if (/(linkedin|hiring|recruitment|vendor|staffing|support|manager|founder|post|comment|page|group|results?|search|contact|email|mobile|phone|address|location|city|industry|agency|solutions|services|company|projects|exposure|learn|corporate|certificate|different|makes|live|learn|work|get|earn|build|join|looking)$/i.test(clean)) return false;
  if (/[:?]/.test(clean)) return false;
  const words = clean.split(/\s+/).filter(Boolean);
  const firstWord = String(words[0] || '').toLowerCase();
  if (['learn','work','get','earn','build','join','looking','what','why','how'].includes(firstWord)) return false;
  if (words.length > 5) return false;
  if (words.length === 1) return words[0].length >= 5;
  return true;
}

function extractName(text, fallback = '') {
  const raw = normalizeWhitespace(text);
  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 18);
  const fileNameName = filenameNameCandidate(fallback);
  const scored = [];
  lines.forEach((line, index) => {
    const clean = line.replace(/\s+/g, ' ').trim();
    if (!looksLikeHumanName(clean)) return;
    let score = 50 - index;
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length >= 2 && words.length <= 4) score += 20;
    if (index <= 3) score += 12;
    if (fileNameName && clean.toLowerCase() === fileNameName.toLowerCase()) score += 18;
    if (/(mr|mrs|ms|dr)\.?\s/i.test(clean)) score += 5;
    scored.push({ name: titleCase(clean), score });
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.name || fileNameName || '';
}

function extractLocation(text = '') {
  const raw = normalizeWhitespace(text);
  const cityMatch = raw.match(/\b(Noida|Delhi|New Delhi|Gurgaon|Gurugram|Ghaziabad|Faridabad|Kanpur|Lucknow|Pune|Mumbai|Bengaluru|Bangalore|Hyderabad|Chennai|Jaipur|Ahmedabad|Kolkata|Mohali|Panchkula|Chandigarh|Indore|Bhopal)\b/i);
  if (cityMatch) return cityMatch[1];
  const addrLine = raw.split(/\n+/).find((line) => /(address|city|location|current location|based in)/i.test(line));
  return String(addrLine || '').replace(/^(address|city|location|current location|based in)\s*[:\-]?\s*/i, '').trim().slice(0, 80);
}

function looksLikeCompanyLine(line = '') {
  const clean = String(line || '').trim();
  if (!clean || clean.length < 3 || clean.length > 100) return false;
  if (/^(industry|city|location|email|phone|contact|call|whatsapp)\s*:/i.test(clean)) return false;
  if (/(call|whatsapp|contact|phone|email|mail|http|www\.|linkedin\.com)/i.test(clean)) return false;
  if (looksLikeHumanName(clean)) return false;
  return /(solutions|services|technologies|technology|bank|finance|consult|marketing|media|private|pvt|limited|ltd|company|agency|ventures|studio|global|outsourcing|bpo|process|group|infotech|systems|labs|software|digital|hr|talent|staffing)/i.test(clean);
}

function companyFromDomain(value = '') {
  const domain = String(value || '').trim();
  if (!domain) return '';
  const stem = domain.replace(/^www\./i, '').replace(/\.(com|in|co|org|net|ai|io)$/i, '').replace(/[.-]+/g, ' ').trim();
  const pretty = titleCase(stem);
  if (!pretty) return '';
  if (GENERIC_LABEL_WORDS.has(pretty.toLowerCase())) return '';
  return pretty.slice(0, 100);
}

function extractCompanyName(text = '') {
  const raw = normalizeWhitespace(text);
  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 20);
  const companyLine = lines.find((line) => looksLikeCompanyLine(line));
  if (companyLine) return companyLine.slice(0, 100);
  const mailDomain = extractEmails(raw)[0]?.split('@')[1] || '';
  const emailCompany = companyFromDomain(mailDomain);
  if (emailCompany) return emailCompany;
  const url = extractUrls(raw).find((item) => !/linkedin\.com|wa\.me|whatsapp\.com|mailto:/i.test(item));
  if (url) {
    try {
      return companyFromDomain(new URL(url).hostname);
    } catch {}
  }
  return '';
}

function guessSourceChannel(raw = '', sourceLabel = '', urls = []) {
  const text = `${String(raw || '')} ${String(sourceLabel || '')} ${urls.join(' ')}`.toLowerCase();
  if (/(linkedin\.com|linkedin|boolean|talent acquisition|hiring manager)/.test(text)) return 'LinkedIn';
  if (/(whatsapp|wa\.me|group)/.test(text)) return 'WhatsApp';
  if (/(google|site:|search)/.test(text)) return 'Google';
  if (/(referral|reference|referred by)/.test(text)) return 'Reference';
  if (/(mail|email|campaign|bcc)/.test(text)) return 'Mass Mail';
  if (/(website|careers|contact us|public url)/.test(text)) return 'Website';
  return 'Manual';
}

function guessIndustry(text = '') {
  const raw = String(text || '').toLowerCase();
  if (/(it|software|saas|tech|developer|engineering)/.test(raw)) return 'IT / Software';
  if (/(bpo|customer support|call center|telecalling|voice process)/.test(raw)) return 'BPO / Support';
  if (/(bank|finance|insurance|nbfc)/.test(raw)) return 'BFSI';
  if (/(hospital|clinic|healthcare|medical|pharma)/.test(raw)) return 'Healthcare';
  if (/(sales|marketing|digital marketing|brand|performance marketing)/.test(raw)) return 'Sales / Marketing';
  if (/(manufacturing|factory|plant|production)/.test(raw)) return 'Manufacturing';
  return '';
}

function extractIntentSignal(text = '') {
  const raw = String(text || '').toLowerCase();
  const hits = [];
  if (/(urgent|immediate|asap)/.test(raw)) hits.push('Urgent hiring');
  if (/(vendor|empanelment|panel|partner)/.test(raw)) hits.push('Vendor-ready');
  if (/(bulk hiring|multiple openings|20 positions|50 positions|mass hiring)/.test(raw)) hits.push('Bulk hiring');
  if (/(outsourcing|outsource|rpo|staffing support|recruitment support)/.test(raw)) hits.push('External support need');
  if (/(contact number|call me|mail me|email me|whatsapp)/.test(raw)) hits.push('Response signal present');
  return hits.join(', ');
}

function extractPostDate(text = '') {
  const raw = normalizeWhitespace(text);
  const match = raw.match(/\b(?:today|yesterday|\d+\s*(?:m|min|mins|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|month|months)\s*ago|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{2,4})\b/i);
  return match ? match[0] : '';
}

function extractPostAuthorName(text = '') {
  const raw = normalizeWhitespace(text);
  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 10);
  const explicit = lines.find((line) => looksLikeHumanName(line));
  if (explicit) return titleCase(explicit).slice(0, 80);
  return extractName(raw).slice(0, 80);
}

function extractPrimaryLinkedIn(urls = []) {
  return urls.find((item) => /linkedin\.com/i.test(item)) || '';
}

function calculateLeadScore(fields) {
  let score = 16;
  if (fields.company_name) score += 14;
  if (fields.contact_name) score += 10;
  if (fields.post_author_name) score += 6;
  if (fields.phone) score += 20;
  if (fields.email) score += 16;
  if (fields.website) score += 8;
  if (fields.linkedin_url || fields.post_author_linkedin_url) score += 8;
  if (fields.city) score += 5;
  if (fields.intent_signal) score += 10;
  if (fields.lead_type === 'Hot') score += 6;
  if (fields.source_channel === 'Reference') score += 6;
  return Math.max(0, Math.min(100, score));
}

function buildLeadNotes({ sourceLabel = '', urls = [], phones = [], raw = '' }) {
  const notes = [];
  if (sourceLabel) notes.push(`Source Label: ${sourceLabel}`);
  if (urls[0]) notes.push(`Primary URL: ${urls[0]}`);
  if (phones[1]) notes.push(`Secondary Number: ${phones[1]}`);
  const preview = normalizeWhitespace(raw).slice(0, 420);
  if (preview) notes.push(`Raw Snapshot: ${preview}`);
  return notes.join('\n');
}

function sanitizeFieldSet(fields = {}) {
  const next = { ...fields };
  const genericBad = /^(manual|visible|capture|visible capture|post capture|linkedin|linkedin post|raw text|public url|parsed lead)$/i;
  if (genericBad.test(String(next.contact_name || '').trim())) next.contact_name = '';
  if (genericBad.test(String(next.post_author_name || '').trim())) next.post_author_name = '';
  if (genericBad.test(String(next.company_name || '').trim())) next.company_name = '';
  if (!next.contact_name && next.post_author_name) next.contact_name = next.post_author_name;
  if (next.company_name && next.contact_name && String(next.company_name).toLowerCase() === String(next.contact_name).toLowerCase()) next.company_name = '';
  if (next.company_name && next.post_author_name && String(next.company_name).toLowerCase() === String(next.post_author_name).toLowerCase()) next.company_name = '';
  if (!next.post_author_name && next.contact_name) next.post_author_name = next.contact_name;
  next.post_text = normalizeWhitespace(next.post_text || '').slice(0, 900);
  next.raw_snapshot = normalizeWhitespace(next.raw_snapshot || next.post_text || '').slice(0, 1600);
  next.notes = normalizeWhitespace(next.notes || '').slice(0, 1200);
  return next;
}

function extractBdaLeadFields(text, sourceLabel = '', meta = {}) {
  const raw = normalizeWhitespace(text);
  const urls = extractUrls(raw);
  const phones = extractPhones(raw);
  const emails = extractEmails(raw);
  const website = urls.find((item) => !/linkedin\.com|wa\.me|whatsapp\.com|mailto:/i.test(item)) || '';
  const linkedin = extractPrimaryLinkedIn(urls);
  const source_channel = guessSourceChannel(raw, sourceLabel, urls);
  const postAuthor = extractPostAuthorName(raw);
  const company = extractCompanyName(raw);
  const lead_type = /(urgent|immediate|vendor|bulk hiring|multiple openings|outsourcing)/i.test(raw) ? 'Hot' : (emails[0] || phones[0] ? 'Warm' : 'Cold');

  const fields = sanitizeFieldSet({
    company_name: company,
    contact_name: extractName(raw) || postAuthor,
    phone: phones[0] || '',
    email: emails[0] || '',
    website,
    linkedin_url: linkedin,
    source_channel,
    source_label: sourceLabel || source_channel,
    source_url: urls[0] || String(meta.source_url || '').trim(),
    search_string: String(meta.search_string || '').trim(),
    result_window_from: String(meta.result_window_from || '').trim(),
    result_window_to: String(meta.result_window_to || '').trim(),
    city: extractLocation(raw),
    industry: guessIndustry(raw),
    company_size: '',
    lead_type,
    stage: 'New',
    priority: lead_type === 'Hot' ? 'High' : (lead_type === 'Warm' ? 'Medium' : 'Low'),
    status: 'Open',
    intent_signal: extractIntentSignal(raw),
    tags: '',
    notes: buildLeadNotes({ sourceLabel, urls, phones, raw }),
    raw_snapshot: raw,
    post_author_name: postAuthor,
    post_author_linkedin_url: linkedin,
    post_date: extractPostDate(raw),
    post_text: raw,
  });
  fields.score = calculateLeadScore(fields);
  return fields;
}

function splitRawBlocks(raw = '') {
  const source = String(raw || '').replace(/\r/g, '\n').trim();
  if (!source) return [];
  const marked = source
    .replace(/\n{4,}/g, '\n<<BDA_SPLIT>>\n')
    .replace(/\n(?:---+|===+|___+)\n/g, '\n<<BDA_SPLIT>>\n')
    ;
  const parts = marked
    .split('<<BDA_SPLIT>>')
    .map((item) => normalizeWhitespace(item))
    .filter(Boolean);
  return parts.length ? parts : [normalizeWhitespace(source)];
}

function hasMeaningfulLeadSignal(item = {}) {
  return Boolean(
    item.phone || item.email || item.linkedin_url || item.website || item.company_name || item.contact_name || item.post_author_name || String(item.post_text || '').length >= 60,
  );
}

function shouldMergeIntoPrevious(item = {}, chunk = '') {
  return !item.phone && !item.email && !item.linkedin_url && !item.website && !item.company_name && !item.contact_name && String(chunk || '').length < 260;
}

function dedupeLeadItems(items = []) {
  const seen = new Map();
  for (const item of items) {
    const key = [item.phone, item.email, item.linkedin_url, item.contact_name, item.company_name].filter(Boolean).join('|').toLowerCase() || String(item.post_text || '').slice(0, 140).toLowerCase();
    const prev = seen.get(key);
    if (!prev || Number(item.score || 0) > Number(prev.score || 0)) seen.set(key, item);
  }
  return [...seen.values()].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

function parseRawData(raw, sourceLabel = '', meta = {}) {
  const chunks = splitRawBlocks(raw);
  if (!chunks.length) return [];
  const merged = [];
  for (const chunk of chunks) {
    const current = extractBdaLeadFields(chunk, sourceLabel, meta);
    if (!hasMeaningfulLeadSignal(current)) continue;
    if (merged.length && shouldMergeIntoPrevious(current, chunk)) {
      const previous = merged.pop();
      merged.push(extractBdaLeadFields(`${previous.raw_snapshot || previous.post_text || ''}\n${chunk}`, sourceLabel, meta));
      continue;
    }
    merged.push(current);
  }
  const finalItems = dedupeLeadItems(merged).filter((item) => hasMeaningfulLeadSignal(item));
  if (finalItems.length) return finalItems;
  return [extractBdaLeadFields(raw, sourceLabel, meta)].filter((item) => hasMeaningfulLeadSignal(item));
}

function fetchPublicUrlText(url, limitBytes = 900000, depth = 0) {
  return new Promise((resolve, reject) => {
    const safe = String(url || '').trim();
    if (!/^https?:\/\//i.test(safe)) return reject(new Error('Enter a valid public URL starting with http or https.'));
    const client = safe.startsWith('https://') ? https : http;
    const req = client.get(safe, {
      headers: {
        'User-Agent': 'CareerCrox-BDA-Head/1.0',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
      timeout: 10000,
    }, (res) => {
      const status = Number(res.statusCode || 0);
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location && depth < 2) {
        const nextUrl = new URL(res.headers.location, safe).toString();
        res.resume();
        return resolve(fetchPublicUrlText(nextUrl, limitBytes, depth + 1));
      }
      if (status >= 400) {
        res.resume();
        return reject(new Error(`Unable to fetch page (${status}).`));
      }
      let size = 0;
      const chunks = [];
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > limitBytes) {
          req.destroy(new Error('This page is too large to parse in the CRM.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const html = Buffer.concat(chunks).toString('utf8');
        const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim();
        resolve({
          url: safe,
          title,
          text: htmlToText(html),
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error('The public URL request timed out.')));
    req.on('error', reject);
  });
}

module.exports = {
  normalizeWhitespace,
  extractEmails,
  extractPhones,
  extractUrls,
  extractBdaLeadFields,
  fetchPublicUrlText,
  parseRawData,
};
