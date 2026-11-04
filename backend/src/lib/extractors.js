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
  return phoneCandidates(text).filter((item) => item.score >= 12).map((item) => item.value);
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
    .filter((part) => !/^(resume|cv|curriculum|vitae|candidate|profile|updated|update|latest|new|copy|draft|final|version|page|scan|doc|docx|pdf|txt|image|img|identity|opensource|source|career|crox|careercrox|career-crox)$/i.test(part))
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

function cleanNameCandidate(value = '') {
  return String(value || '')
    .replace(/^(?:candidate\s+)?(?:full\s+)?name\s*[:\-–]?\s*/i, '')
    .replace(/[|•_]/g, ' ')
    .replace(/\s+(?:mobile|phone|contact|email|location|address|dob|date of birth)\b.*$/i, '')
    .replace(/\b(?:\+?91[\s-]*)?[6-9](?:[\s-]*\d){9}\b.*$/i, '')
    .replace(/[0-9@]/g, ' ')
    .replace(/[^A-Za-z.' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function plausibleHumanName(value = '') {
  const clean = cleanNameCandidate(value);
  if (!looksLikeHumanName(clean) || clean.length < 4) return false;
  const letters = clean.replace(/[^A-Za-z]/g, '');
  if (letters.length < 4) return false;
  // OCR garbage such as TWQQR should never overwrite a person's name.
  if (!/[AEIOUYaeiouy]/.test(letters)) return false;
  if (/(.)\1\1/i.test(letters)) return false;
  if (/^[A-Z]{4,8}$/.test(clean) && /[QXZ]{2,}/.test(clean)) return false;
  return true;
}

function genericResumeName(value = '') {
  const x = String(value || '').replace(/[^A-Za-z ]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return !x || /^(career(?:\s+)?crox|career|crox|curriculum vitae|resume|cv|candidate|profile|personal details|personal information|contact details|contact information|professional summary|career objective|objective|anonymous|unspecified|untitled|opensource|reportlab pdf library)$/.test(x);
}

function extractName(text, fallback = '') {
  const raw = normalizeWhitespace(text);
  const emails = extractEmails(raw);
  const emailPrefix = String(emails[0] || '').split('@')[0] || '';
  const fileNameName = filenameNameCandidate(fallback);
  const candidates = [];
  const push = (value, score, source = '') => {
    const clean = cleanNameCandidate(value);
    if (!plausibleHumanName(clean) || genericResumeName(clean)) return;
    candidates.push({ name: titleCase(clean).slice(0, 80), score, source });
  };
  for (const pattern of [
    /(?:^|\n)\s*(?:candidate\s+)?(?:full\s+)?name\s*[:\-–]\s*([^\n]{2,90})/im,
    /(?:^|\n)\s*(?:candidate\s+)?(?:full\s+)?name\s*\n\s*([^\n]{2,90})/im,
  ]) {
    const match = raw.match(pattern);
    if (match?.[1]) push(match[1], 190, 'label');
  }
  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 55);
  lines.forEach((line, index) => {
    if (/\b(?:address|location|city|objective|summary|experience|education|academic|skills|profile|resume|curriculum|email|gmail|mobile|phone|contact|linkedin|qualification|course|university|college|school|board|institution|career objective|personal details)\b/i.test(line)) return;
    const clean = cleanNameCandidate(line);
    if (!plausibleHumanName(clean) || genericResumeName(clean)) return;
    const words = clean.split(/\s+/).filter(Boolean);
    let score = 118 - Math.min(index, 45);
    if (index <= 3) score += 48;
    else if (index <= 8) score += 24;
    if (words.length >= 2 && words.length <= 4) score += 22;
    if (words.length === 1 && clean.length >= 5 && index <= 8) score += 18;
    if (/^[A-Z][A-Z\s.'-]+$/.test(line) && index <= 8) score += 14;
    push(clean, score, 'header-line');
  });
  const emailName = nameFromEmailPrefix(emailPrefix);
  if (emailName) push(emailName, 104, 'email');
  if (fileNameName && !genericResumeName(fileNameName)) push(fileNameName, 58, 'filename');
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.name || '';
}

function cleanLocationCandidate(value = '') {
  let x = String(value || '')
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/^[\s📍📌🗺️🏠]+/u, '')
    .replace(/^(?:current\s+|present\s+|residential\s+|permanent\s+)?(?:location|city|address|residence|based\s+in)\s*[:\-–]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  const cutters = [
    /[📞☎️📱✉️📧]/u,
    /\b(?:mobile|phone|contact|email|e-mail|mail|whatsapp|linkedin)\b\s*[:\-–]?/i,
    /(?:\+?91[\s-]*)?[6-9](?:[\s-]*\d){9}\b/,
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    /https?:\/\//i,
    /www\./i,
  ];
  let cut=x.length;
  for (const rx of cutters) { const m=x.match(rx); if (m && Number.isFinite(m.index)) cut=Math.min(cut,m.index); }
  x=x.slice(0,cut).replace(/[|•]+/g,', ').replace(/\s*[,;]+\s*/g,', ').replace(/^[,;:\-–\s]+|[,;:\-–\s]+$/g,'').trim();
  if (!x || x.length>80 || /@/.test(x) || /\b\d{7,}\b/.test(x)) return '';
  return x;
}

function extractLocation(text) {
  const raw = normalizeWhitespace(text);
  const labelled = [
    /(?:current\s+location|present\s+location|location|city|address|residence|based\s+in)\s*[:\-–]\s*([^\n]{2,120})/i,
  ];
  for (const pattern of labelled) {
    const match = raw.match(pattern);
    const candidate = cleanLocationCandidate(match?.[1] || '');
    if (candidate && candidate.length >= 2 && !/^(india|location|address)$/i.test(candidate)) {
      const city = candidate.match(/\b(Greater\s+Noida|Navi\s+Mumbai|New\s+Delhi|Hanumangarh|Noida|Delhi|Gurgaon|Gurugram|Ghaziabad|Faridabad|Kanpur|Lucknow|Pune|Mumbai|Thane|Bengaluru|Bangalore|Hyderabad|Chennai|Jaipur|Ahmedabad|Kolkata|Mohali|Chandigarh|Indore|Bhopal|Patna|Ranchi|Dehradun|Ludhiana|Amritsar|Udaipur|Jodhpur|Kota|Ajmer)\b/i)?.[1];
      if (city) return city.replace(/\s+/g,' ').trim();
      if (!/[+@]/.test(candidate)) return candidate;
    }
  }
  const city = raw.match(/\b(Greater\s+Noida|Navi\s+Mumbai|New\s+Delhi|Hanumangarh|Noida|Delhi|Gurgaon|Gurugram|Ghaziabad|Faridabad|Kanpur|Lucknow|Pune|Mumbai|Thane|Bengaluru|Bangalore|Hyderabad|Chennai|Jaipur|Ahmedabad|Kolkata|Mohali|Chandigarh|Indore|Bhopal|Patna|Ranchi|Dehradun|Ludhiana|Amritsar|Udaipur|Jodhpur|Kota|Ajmer)\b/i)?.[1];
  return city ? city.replace(/\s+/g,' ').trim() : '';
}

function normalizeCourseName(value = '') {
  const s = String(value || '').replace(/[|•_]/g, ' ').replace(/\s+/g, ' ').trim();
  const map = [
    [/\bM\.?\s*Pharm(?:acy)?\b/i, 'M.Pharm'], [/\bM\.?\s*Tech\b/i, 'M.Tech'], [/\bMCA\b/i, 'MCA'], [/\bMBA\b/i, 'MBA'], [/\bM\.?\s*Com\b/i, 'M.Com'], [/\bM\.?\s*S[cce]\b/i, 'M.Sc'], [/\bMA\b/i, 'MA'], [/\bPGDM\b/i, 'PGDM'],
    [/\bB\.?\s*Pharm(?:acy)?\b/i, 'B.Pharm'], [/\bBachelor(?:'s)?\s+of\s+Pharmacy\b/i, 'B.Pharm'], [/\bB\.?\s*Tech\b/i, 'B.Tech'], [/\bB\.?\s*E\.?\b/i, 'B.E.'], [/\bBCA\b/i, 'BCA'], [/\bBBA\b/i, 'BBA'], [/\bB\.?\s*Com\b/i, 'B.Com'], [/\bB\.?\s*S[cce]\b/i, 'B.Sc'], [/\bBachelor(?:'s)?\s+of\s+Science\b/i, 'B.Sc'], [/\bBA\b/i, 'BA'],
    [/\bD\.?\s*Pharm(?:acy)?\b/i, 'D.Pharm'], [/\bDiploma\s+(?:in|of)\s+Pharmacy\b/i, 'D.Pharm'], [/\bDiploma\b/i, 'Diploma'], [/\bPolytechnic\b/i, 'Diploma'], [/\b12(?:th)?\b|Higher Secondary|Intermediate/i, '12th'], [/\b10(?:th)?\b|High School/i, '10th'],
  ];
  for (const [rx, label] of map) if (rx.test(s)) return label;
  return '';
}

function extractQualification(text) {
  const raw = normalizeWhitespace(text);
  const rx = /\b(M\.?\s*Pharm(?:acy)?|M\.?\s*Tech|MCA|MBA|M\.?\s*Com|M\.?\s*S[cce]|MA|PGDM|B\.?\s*Pharm(?:acy)?|Bachelor(?:'s)?\s+of\s+Pharmacy|B\.?\s*Tech|B\.?\s*E\.?|BCA|BBA|B\.?\s*Com|B\.?\s*S[cce]|Bachelor(?:'s)?\s+of\s+Science|BA|D\.?\s*Pharm(?:acy)?|Diploma\s+(?:in|of)\s+Pharmacy|Diploma|Polytechnic|12(?:th)?|10(?:th)?|Higher Secondary|Intermediate|High School)\b/gi;
  const rank = { 'M.Pharm': 104, 'M.Tech': 102, MCA: 100, MBA: 98, 'M.Com': 96, 'M.Sc': 96, MA: 94, PGDM: 93, 'B.Pharm': 86, 'B.Tech': 84, 'B.E.': 84, BCA: 82, BBA: 80, 'B.Com': 79, 'B.Sc': 79, BA: 77, 'D.Pharm': 68, Diploma: 60, '12th': 30, '10th': 20 };
  const hits = [];
  for (const match of raw.matchAll(rx)) {
    const course = normalizeCourseName(match[0]);
    if (!course) continue;
    const index = Number(match.index || 0);
    const context = raw.slice(Math.max(0, index - 140), Math.min(raw.length, index + match[0].length + 180));
    const years = [...context.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((m) => Number(m[1])).filter((y) => y >= 1980 && y <= new Date().getFullYear() + 2);
    hits.push({ course, index, year: years.length ? Math.max(...years) : 0, rank: rank[course] || 0 });
  }
  if (!hits.length) return '';
  const explicitSchool = /(?:highest\s+qualification|course(?:\s+name)?|qualification)\s*[:\-–]\s*(?:10th|12th|higher secondary|intermediate|high school)/i.test(raw);
  const higher = hits.filter((x) => !['10th','12th'].includes(x.course));
  if (higher.length) hits.splice(0, hits.length, ...higher);
  else if (!explicitSchool) return '';
  const withYear = hits.filter((x) => x.year > 0);
  if (withYear.length) {
    withYear.sort((a, b) => (b.year - a.year) || (b.rank - a.rank) || (b.index - a.index));
    return withYear[0].course;
  }
  hits.sort((a, b) => (b.rank - a.rank) || (b.index - a.index));
  return hits[0].course;
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
