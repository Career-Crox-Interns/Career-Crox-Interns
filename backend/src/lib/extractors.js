const http = require('http');
const https = require('https');
const { normalizeIndianPhone } = require('./helpers');

const NAME_STOPWORDS = /(resume|curriculum|vitae|contact|profile|summary|career objective|objective|about me|linkedin|email|mobile|phone|address|identity|opensource|developer|engineer|consultant|qualification|experience|education|skills|company|client|opening|job|position|applying|application|document|page|source|personal details|details|professional summary|career summary|c v|cv)$/i;

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

function htmlToText(html) {
  return normalizeWhitespace(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
  );
}

function extractEmails(text) {
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
    const context = raw.slice(Math.max(0, index - 90), Math.min(raw.length, index + match[0].length + 60)).toLowerCase();
    let score = 20;
    if (/mobile|phone|contact|call|whatsapp|wa\b|mob\b/.test(context)) score += 35;
    if (/primary|main|candidate|resume|cv/.test(context)) score += 20;
    if (/secondary|alternate|alt|other|optional/.test(context)) score -= 3;
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

function extractPhones(text) {
  return phoneCandidates(text).map((item) => item.value);
}

function extractUrls(text) {
  return uniqueList(String(text || '').match(/https?:\/\/[^\s)\]"'>]+/gi) || []);
}

function looksLikeHumanName(value = '') {
  const clean = String(value || '').replace(/^[^A-Za-z]+|[^A-Za-z.' -]+$/g, '').trim();
  if (!clean || clean.length < 3 || clean.length > 60) return false;
  if (/\d/.test(clean)) return false;
  if (!/^[A-Za-z][A-Za-z.' -]+$/.test(clean)) return false;
  if (NAME_STOPWORDS.test(clean)) return false;
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length > 5) return false;
  if (words.length === 1) return words[0].length >= 4 && !NAME_STOPWORDS.test(words[0]);
  return true;
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
    .filter((part) => !/^(resume|cv|curriculum|vitae|candidate|profile|updated|update|latest|new|copy|draft|final|version|page|scan|doc|docx|pdf|txt|image|img|identity|opensource|source)$/i.test(part))
    .filter((part) => !/^\d+$/.test(part));
  if (!tokens.length) return '';
  const text = titleCase(tokens.slice(0, 4).join(' '));
  return looksLikeHumanName(text) ? text : '';
}

function nameFromEmailPrefix(prefix = '') {
  const pretty = titleCase(
    String(prefix || '')
      .replace(/[0-9]+/g, ' ')
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean)
      .filter((part) => !NAME_STOPWORDS.test(part))
      .slice(0, 4)
      .join(' ')
  );
  return looksLikeHumanName(pretty) ? pretty.slice(0, 80) : '';
}

function extractName(text, fallback = '') {
  const raw = normalizeWhitespace(text);
  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 28);
  const emails = extractEmails(raw);
  const emailPrefix = String(emails[0] || '').split('@')[0] || '';
  const fileNameName = filenameNameCandidate(fallback);
  const scored = [];

  lines.forEach((line, index) => {
    const clean = line.replace(/\s+/g, ' ').trim();
    if (!looksLikeHumanName(clean)) return;
    let score = 50 - index;
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length >= 2 && words.length <= 4) score += 34;
    if (index <= 4) score += 18;
    if (/^[A-Z\s.'-]+$/.test(clean)) score += 10;
    if (fileNameName && clean.toLowerCase() === fileNameName.toLowerCase()) score += 22;
    if (emailPrefix && clean.toLowerCase().replace(/\s+/g, '') === emailPrefix.toLowerCase().replace(/[0-9._-]+/g, '')) score += 15;
    scored.push({ name: titleCase(clean), score });
  });

  if (fileNameName) scored.push({ name: fileNameName, score: 72 });
  const emailName = nameFromEmailPrefix(emailPrefix);
  if (emailName) scored.push({ name: emailName, score: 64 });

  scored.sort((a, b) => b.score - a.score);
  const winner = scored.find((entry) => looksLikeHumanName(entry.name));
  return winner?.name ? winner.name.slice(0, 80) : '';
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

function parseExperienceMonths(text) {
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

function monthsLabel(months) {
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
  const hits = lines.filter((line) => /(pvt|private|limited|ltd|solutions|services|technologies|technology|bank|finance|consult|marketing|sales|telecom|healthcare|global|industries|corp|company|inc\b|bpo)/i.test(line));
  return uniqueList(hits).slice(0, 8);
}

function buildCandidateNotes(fields = {}, rawText = '') {
  const bits = [];
  if (fields.secondary_phone) bits.push(`Secondary Number: ${fields.secondary_phone}`);
  if (fields.email) bits.push(`Email: ${fields.email}`);
  if (fields.linkedin_url) bits.push(`LinkedIn: ${fields.linkedin_url}`);
  if (fields.dob) bits.push(`DOB: ${fields.dob}`);
  if (fields.gender) bits.push(`Gender: ${fields.gender}`);
  if (fields.companies) bits.push(`Companies: ${fields.companies}`);
  if (fields.source_filename) bits.push(`Imported From: ${fields.source_filename}`);
  const preview = normalizeWhitespace(rawText).slice(0, 420);
  if (preview) bits.push(`Resume Snapshot: ${preview}`);
  return bits.join('\n');
}

function extractCandidateFields(text, sourceFilename = '') {
  const raw = normalizeWhitespace(text);
  const phones = extractPhones(raw);
  const emails = extractEmails(raw);
  const urls = extractUrls(raw);
  const companies = extractCompanies(raw);
  const months = parseExperienceMonths(raw);
  const fields = {
    full_name: extractName(raw, sourceFilename),
    phone: phones[0] || '',
    secondary_phone: phones[1] || '',
    email: emails[0] || '',
    location: extractLocation(raw),
    qualification: extractQualification(raw),
    total_experience: monthsLabel(months),
    relevant_experience: monthsLabel(months),
    gender: extractGender(raw),
    dob: extractDob(raw),
    companies: companies.join(', '),
    linkedin_url: urls.find((item) => /linkedin\.com/i.test(item)) || '',
    source_filename: sourceFilename,
  };
  fields.notes = buildCandidateNotes(fields, raw);
  return fields;
}

function extractClientFields(text, sourceLabel = '') {
  const raw = normalizeWhitespace(text);
  const emails = extractEmails(raw);
  const phones = extractPhones(raw);
  const urls = extractUrls(raw);
  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const company = lines.find((line) => /(solutions|services|technologies|technology|bank|finance|consult|marketing|media|private|pvt|limited|ltd|company|agency|ventures|studio|global)/i.test(line)) || extractName(raw, sourceLabel) || 'Parsed Client';
  return {
    client_name: company.slice(0, 90),
    contact_person: extractName(raw, sourceLabel),
    contact_phone: phones[0] || '',
    contact_email: emails[0] || '',
    city: extractLocation(raw),
    industry: '',
    status: 'Active',
    priority: 'Medium',
    openings_count: '',
    notes: [
      sourceLabel ? `Source: ${sourceLabel}` : '',
      urls[0] ? `URL: ${urls[0]}` : '',
      phones[1] ? `Secondary Number: ${phones[1]}` : '',
      raw.slice(0, 420),
    ].filter(Boolean).join('\n'),
  };
}

function fetchPublicUrlText(url, limitBytes = 800000, depth = 0) {
  return new Promise((resolve, reject) => {
    const safe = String(url || '').trim();
    if (!/^https?:\/\//i.test(safe)) return reject(new Error('Enter a valid public URL starting with http or https.'));
    const client = safe.startsWith('https://') ? https : http;
    const req = client.get(safe, {
      headers: {
        'User-Agent': 'CareerCroxCRM/1.0',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
      timeout: 8000,
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
          req.destroy(new Error('The page is too large to parse in CRM.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const html = Buffer.concat(chunks).toString('utf8');
        resolve({
          url: safe,
          html,
          text: htmlToText(html),
          title: (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim(),
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Page request timed out.')));
    req.on('error', reject);
  });
}

module.exports = {
  normalizeWhitespace,
  uniqueList,
  htmlToText,
  extractEmails,
  extractPhones,
  extractUrls,
  extractName,
  extractLocation,
  extractQualification,
  extractGender,
  extractDob,
  parseExperienceMonths,
  monthsLabel,
  extractCompanies,
  buildCandidateNotes,
  extractCandidateFields,
  extractClientFields,
  fetchPublicUrlText,
};
