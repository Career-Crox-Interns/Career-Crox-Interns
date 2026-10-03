import { normalizeIndianPhone } from './candidateAccess';

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\r/g, '\n')
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

function decodePdfEscapes(value) {
  return String(value || '')
    .replace(/\\n/g, ' ')
    .replace(/\\r/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

function arrayBufferToLatin1(buffer) {
  const bytes = new Uint8Array(buffer);
  let text = '';
  for (let i = 0; i < bytes.length; i += 1) text += String.fromCharCode(bytes[i]);
  return text;
}

function extractReadableChunks(binaryText) {
  return uniqueList(String(binaryText || '').match(/[A-Za-z0-9@._%+\-/:,() ]{5,}/g) || []).join('\n');
}

function extractPdfTextFromBuffer(buffer) {
  const binary = arrayBufferToLatin1(buffer);
  const literalStrings = Array.from(binary.matchAll(/\(([^()]|\\\(|\\\))*\)/g)).map((match) => decodePdfEscapes(match[0].slice(1, -1)));
  const hexStrings = Array.from(binary.matchAll(/<([0-9A-Fa-f]{8,})>/g)).map((match) => {
    const hex = match[1];
    let out = '';
    for (let i = 0; i < hex.length; i += 2) {
      const code = parseInt(hex.slice(i, i + 2), 16);
      if (Number.isFinite(code) && code >= 32 && code <= 126) out += String.fromCharCode(code);
    }
    return out;
  });
  const raw = [...literalStrings, ...hexStrings, extractReadableChunks(binary)].join('\n');
  return normalizeWhitespace(raw);
}

function decodeXmlResumeText(xml) {
  return normalizeWhitespace(String(xml || '')
    .replace(/<w:tab\b[^>]*\/>/gi, ' ')
    .replace(/<w:br\b[^>]*\/>/gi, '\n')
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<text:tab\b[^>]*\/>/gi, ' ')
    .replace(/<text:line-break\b[^>]*\/>/gi, '\n')
    .replace(/<\/text:p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'"));
}

async function inflateZipBytes(bytes, method) {
  if (method === 0) return bytes;
  if (method !== 8 || typeof DecompressionStream === 'undefined') return new Uint8Array();
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return new Uint8Array();
  }
}

async function readZipTextEntries(buffer, wantedNames = []) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const decoder = new TextDecoder('utf-8');
  const wanted = new Set(wantedNames.map((name) => String(name).toLowerCase()));
  const texts = [];
  let offset = 0;
  while (offset + 46 <= bytes.length) {
    if (view.getUint32(offset, true) !== 0x02014b50) { offset += 1; continue; }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    if (nameEnd > bytes.length) break;
    const name = decoder.decode(bytes.slice(nameStart, nameEnd)).replace(/\\/g, '/').toLowerCase();
    if (wanted.has(name) && localOffset + 30 <= bytes.length && view.getUint32(localOffset, true) === 0x04034b50) {
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataStart >= 0 && dataEnd <= bytes.length) {
        const inflated = await inflateZipBytes(bytes.slice(dataStart, dataEnd), method);
        if (inflated.length) texts.push(decoder.decode(inflated));
      }
    }
    offset = nameEnd + extraLength + commentLength;
  }
  return texts.join('\n');
}

async function extractOfficeResumeText(buffer, name) {
  const lowerName = String(name || '').toLowerCase();
  if (/\.(docx|docm|dotx|dotm)$/i.test(lowerName)) {
    const xml = await readZipTextEntries(buffer, ['word/document.xml', 'word/header1.xml', 'word/footer1.xml']);
    return decodeXmlResumeText(xml);
  }
  if (/\.odt$/i.test(lowerName)) {
    const xml = await readZipTextEntries(buffer, ['content.xml']);
    return decodeXmlResumeText(xml);
  }
  return '';
}

function cleanRtfResumeText(text) {
  return normalizeWhitespace(String(text || '')
    .replace(/\\par[d]?\b/g, '\n')
    .replace(/\\tab\b/g, ' ')
    .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, ' ')
    .replace(/[{}]/g, ' '));
}

export async function readResumeFileText(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  if (!file) return '';
  if (type.startsWith('text/') || /\.(txt|csv|tsv|html|htm|json|md|eml|xml|yaml|yml|log|rtf)$/i.test(name)) {
    const text = await file.text();
    return /\.rtf$/i.test(name) || type.includes('rtf') ? cleanRtfResumeText(text) : normalizeWhitespace(text);
  }
  const buffer = await file.arrayBuffer();
  if (/\.(docx|docm|dotx|dotm|odt)$/i.test(name) || type.includes('officedocument.wordprocessingml') || type.includes('opendocument.text')) {
    const officeText = await extractOfficeResumeText(buffer, name);
    if (officeText) return officeText;
  }
  if (type.includes('pdf') || /\.pdf$/i.test(name)) {
    return extractPdfTextFromBuffer(buffer);
  }
  // All formats are accepted. Unknown/binary/image-only files use best-effort readable chunks;
  // no file bytes leave browser memory from this helper.
  return normalizeWhitespace(extractReadableChunks(arrayBufferToLatin1(buffer)));
}

export function extractEmails(text) {
  return uniqueList(String(text || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []);
}

function phoneCandidates(text) {
  const raw = String(text || '');
  const regex = /(?:\+?91[\s-]*)?[6-9](?:[\s-]*\d){9}/g;
  const candidates = [];
  for (const match of raw.matchAll(regex)) {
    const value = normalizeIndianPhone(match[0]);
    if (!value || value.length !== 10) continue;
    const index = Number(match.index || 0);
    const context = raw.slice(Math.max(0, index - 64), Math.min(raw.length, index + match[0].length + 36)).toLowerCase();
    let score = 20;
    if (/mobile|phone|contact|call|whatsapp|wa\b|mob\b/.test(context)) score += 35;
    if (/primary|main|candidate/.test(context)) score += 20;
    if (/secondary|alternate|alt|other/.test(context)) score -= 3;
    if (/dob|birth|year|salary|ctc|pin|zipcode|postal|aadhaar|aadhar|pan|invoice|otp|date/.test(context)) score -= 30;
    if (/00000|11111|22222|33333|44444|55555|66666|77777|88888|99999/.test(value)) score -= 20;
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

export function extractPhones(text) {
  return phoneCandidates(text).map((item) => item.value);
}

export function extractUrls(text) {
  return uniqueList(String(text || '').match(/https?:\/\/[^\s)\]"'>]+/gi) || []);
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
    .filter((part) => !/^(resume|cv|curriculum|vitae|candidate|profile|updated|update|latest|new|copy|draft|final|version|page|scan|doc|docx|pdf|txt|image|img)$/i.test(part))
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
  if (/(resume|curriculum|vitae|contact|profile|summary|career objective|objective|about me|linkedin|email|mobile|phone|address|identity|opensource|developer|engineer|consultant|qualification|experience|education|skills|company|client|opening|job|position|applying|application|document|page)$/i.test(clean)) return false;
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length > 5) return false;
  if (words.length === 1) return words[0].length >= 5;
  return true;
}

function extractName(text, fallback = '') {
  const raw = normalizeWhitespace(text);
  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 22);
  const emails = extractEmails(raw);
  const emailPrefix = String(emails[0] || '').split('@')[0] || '';
  const fileNameName = filenameNameCandidate(fallback);
  const scored = [];
  lines.forEach((line, index) => {
    const clean = line.replace(/\s+/g, ' ').trim();
    if (!looksLikeHumanName(clean)) return;
    let score = 50 - index;
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length >= 2 && words.length <= 4) score += 28;
    if (/^[A-Z][A-Za-z.' -]+$/.test(clean) || /^[A-Z\s.'-]+$/.test(clean)) score += 10;
    if (index <= 3) score += 12;
    if (fileNameName && clean.toLowerCase() === fileNameName.toLowerCase()) score += 20;
    scored.push({ name: titleCase(clean), score });
  });
  scored.sort((a, b) => b.score - a.score);
  if (scored[0]?.name) return scored[0].name.slice(0, 80);
  if (fileNameName && looksLikeHumanName(fileNameName)) return fileNameName.slice(0, 80);
  if (emailPrefix) {
    const pretty = titleCase(
      emailPrefix
        .replace(/[0-9]+/g, ' ')
        .replace(/[._-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean)
        .slice(0, 4)
        .join(' ')
    );
    if (looksLikeHumanName(pretty)) return pretty.slice(0, 80);
  }
  return fileNameName || String(fallback || '').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 80);
}

function extractLocation(text) {
  const raw = normalizeWhitespace(text);
  const cityMatch = raw.match(/\b(Noida|Delhi|New Delhi|Gurgaon|Gurugram|Ghaziabad|Faridabad|Kanpur|Lucknow|Pune|Mumbai|Bengaluru|Bangalore|Hyderabad|Chennai|Jaipur|Ahmedabad|Kolkata|Mohali|Panchkula|Chandigarh)\b/i);
  if (cityMatch) return cityMatch[1];
  const addrLine = raw.split(/\n+/).find((line) => /(address|city|location|current location)/i.test(line));
  return String(addrLine || '').replace(/^(address|city|location|current location)\s*[:\-]?\s*/i, '').trim().slice(0, 80);
}

function extractQualification(text) {
  const raw = normalizeWhitespace(text);
  const match = raw.match(/\b(MBA|B\.Tech|BTech|M\.Tech|MTech|BCA|MCA|BBA|BA|BSc|B\.Sc|BCom|B\.Com|Diploma|Graduate|Undergraduate|12th|10th|Higher Secondary|Intermediate)\b/i);
  return match ? match[1] : '';
}

function extractGender(text) {
  const raw = normalizeWhitespace(text);
  if (/\bgender\s*[:\-]?\s*male\b/i.test(raw) || /\bmale\b/i.test(raw)) return 'Male';
  if (/\bgender\s*[:\-]?\s*female\b/i.test(raw) || /\bfemale\b/i.test(raw)) return 'Female';
  if (/\bgender\s*[:\-]?\s*(other|transgender|non-binary)\b/i.test(raw)) return 'Other';
  return '';
}

function extractDob(text) {
  const raw = normalizeWhitespace(text);
  const match = raw.match(/(?:dob|date of birth|birth date)\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i)
    || raw.match(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.](?:19|20)?\d{2})\b/);
  return match ? match[1] : '';
}

export function parseExperienceMonths(text) {
  const raw = normalizeWhitespace(text).toLowerCase();
  if (/\bfresher\b/.test(raw)) return 0;
  let months = 0;
  const yearMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:years?|yrs?)/);
  const monthMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:months?|mos?)/);
  if (yearMatch) months += Math.round(Number(yearMatch[1]) * 12);
  if (monthMatch) months += Math.round(Number(monthMatch[1]));
  if (!months) {
    const totalMatch = raw.match(/(?:total\s+experience|experience)\s*[:\-]?\s*(\d+(?:\.\d+)?)/);
    if (totalMatch) {
      const value = Number(totalMatch[1]);
      months = value > 20 ? Math.round(value) : Math.round(value * 12);
    }
  }
  return Number.isFinite(months) ? months : 0;
}

export function monthsLabel(months) {
  const total = Number(months || 0);
  if (!total) return '0';
  const years = Math.floor(total / 12);
  const rem = total % 12;
  if (years && rem) return `${years}.${rem}`;
  if (years) return String(years);
  return String(rem);
}

function extractCompanies(text) {
  const lines = normalizeWhitespace(text).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const hits = lines.filter((line) => /(pvt|private|limited|ltd|solutions|services|technologies|technology|bank|finance|consult|bpo|marketing|sales|telecom|healthcare|global|industries|corp|company|inc\b)/i.test(line));
  return uniqueList(hits).slice(0, 8);
}

export function extractCandidateFields(text, sourceFilename = '') {
  const raw = normalizeWhitespace(text);
  const phones = extractPhones(raw);
  const emails = extractEmails(raw);
  const urls = extractUrls(raw);
  const months = parseExperienceMonths(raw);
  const companies = extractCompanies(raw);
  const fields = {
    full_name: extractName(raw, sourceFilename),
    phone: phones[0] || '',
    secondary_phone: phones[1] || '',
    email: emails[0] || '',
    location: extractLocation(raw),
    qualification: extractQualification(raw),
    total_experience: monthsLabel(months),
    relevant_experience: monthsLabel(months),
    notes: '',
    gender: extractGender(raw),
    dob: extractDob(raw),
    linkedin_url: urls.find((item) => /linkedin\.com/i.test(item)) || '',
    companies: companies.join(', '),
    source_filename: sourceFilename,
  };
  fields.notes = [
    fields.secondary_phone ? `Secondary Number: ${fields.secondary_phone}` : '',
    fields.email ? `Email: ${fields.email}` : '',
    fields.linkedin_url ? `LinkedIn: ${fields.linkedin_url}` : '',
    fields.dob ? `DOB: ${fields.dob}` : '',
    fields.gender ? `Gender: ${fields.gender}` : '',
    fields.companies ? `Companies: ${fields.companies}` : '',
    fields.source_filename ? `Imported From: ${fields.source_filename}` : '',
    raw.slice(0, 420) ? `Resume Snapshot: ${raw.slice(0, 420)}` : '',
  ].filter(Boolean).join('\n');
  return fields;
}

export function candidatePayloadFromPreview(row = {}, defaultProcess = '') {
  return {
    full_name: row.full_name || '',
    phone: row.phone || '',
    location: row.location || '',
    qualification: row.qualification || '',
    process: row.process || defaultProcess || '',
    status: row.status || 'In - Progress',
    all_details_sent: row.all_details_sent || 'Pending',
    total_experience: row.total_experience || '',
    relevant_experience: row.relevant_experience || row.total_experience || '',
    notes: row.notes || '',
    secondary_phone: row.secondary_phone || '',
    email: row.email || '',
    gender: row.gender || '',
    dob: row.dob || '',
    linkedin_url: row.linkedin_url || '',
    companies: row.companies || '',
    source_filename: row.source_filename || '',
  };
}

export function extractClientFields(text, sourceLabel = '') {
  const raw = normalizeWhitespace(text);
  const emails = extractEmails(raw);
  const phones = extractPhones(raw);
  const urls = extractUrls(raw);
  const name = extractName(raw, sourceLabel) || 'Parsed Client';
  return {
    client_name: name,
    contact_person: name,
    contact_phone: phones[0] || '',
    contact_email: emails[0] || '',
    city: extractLocation(raw),
    industry: '',
    status: 'Active',
    priority: 'Medium',
    openings_count: '',
    notes: [
      sourceLabel ? `Source: ${sourceLabel}` : '',
      urls.find(Boolean) ? `URL: ${urls.find(Boolean)}` : '',
      phones[1] ? `Secondary Number: ${phones[1]}` : '',
      raw.slice(0, 420),
    ].filter(Boolean).join('\n'),
  };
}

export function downloadCsv(filename, rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row || {}).forEach((key) => set.add(key));
    return set;
  }, new Set()));
  const esc = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [headers.join(','), ...rows.map((row) => headers.map((key) => esc(row?.[key])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
