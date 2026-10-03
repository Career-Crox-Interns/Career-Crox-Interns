const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { extractCandidateFields, extractClientFields, normalizeWhitespace, htmlToText } = require('../lib/extractors');

const execFileAsync = promisify(execFile);

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function isManager(user) {
  return ['admin', 'manager'].includes(lower(user?.role));
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
  return Buffer.from(buffer).toString('latin1');
}

function extractReadableChunks(binaryText) {
  return (String(binaryText || '').match(/[A-Za-z0-9@._%+\-/,:() ]{5,}/g) || []).join('\n');
}

function decodePdfLiteral(value = '') {
  return String(value || '')
    .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b').replace(/\\f/g, '\f')
    .replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\');
}

function utf16beHexToText(hex = '') {
  const clean = String(hex || '').replace(/\s+/g, '');
  if (!clean || clean.length % 2) return '';
  const bytes = Buffer.from(clean, 'hex');
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    return out;
  }
  let printable = '';
  for (const b of bytes) if (b >= 32 && b <= 126) printable += String.fromCharCode(b);
  return printable;
}

function ascii85DecodeBuffer(input) {
  let s = Buffer.from(input).toString('latin1').replace(/\s+/g, '').replace(/^<~/, '').replace(/~>.*$/, '');
  const out=[]; let group='';
  function emit(g, count) {
    let value=0;
    for (let i=0;i<5;i++) value = value*85 + (g.charCodeAt(i)-33);
    const bytes=[(value>>>24)&255,(value>>>16)&255,(value>>>8)&255,value&255];
    for (let i=0;i<count;i++) out.push(bytes[i]);
  }
  for (let i=0;i<s.length;i++) {
    const ch=s[i];
    if (ch==='z' && !group) { out.push(0,0,0,0); continue; }
    if (ch<'!' || ch>'u') continue;
    group+=ch;
    if (group.length===5) { emit(group,4); group=''; }
  }
  if (group.length>1) { const n=group.length; group=group.padEnd(5,'u'); emit(group,n-1); }
  return Buffer.from(out);
}

function asciiHexDecodeBuffer(input) {
  let s=Buffer.from(input).toString('latin1').replace(/\s+/g,'').replace(/>.*/, '');
  if (s.length%2) s+='0';
  try { return Buffer.from(s,'hex'); } catch { return Buffer.from(input); }
}

function extractPdfStreams(buffer) {
  const latin = Buffer.from(buffer).toString('latin1');
  const streams = [];
  const re = /stream\r?\n/g;
  let match;
  while ((match = re.exec(latin))) {
    const start = match.index + match[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) break;
    const dictStart = Math.max(latin.lastIndexOf('<<', match.index), match.index - 1800);
    const dictEnd = latin.lastIndexOf('>>', match.index);
    const dict = dictEnd >= dictStart ? latin.slice(dictStart, dictEnd + 2) : '';
    let data = Buffer.from(buffer).subarray(start, end);
    if (/\/ASCII85Decode\b/.test(dict)) data = ascii85DecodeBuffer(data);
    if (/\/ASCIIHexDecode\b/.test(dict)) data = asciiHexDecodeBuffer(data);
    if (/\/FlateDecode\b/.test(dict)) {
      try { data = zlib.inflateSync(data); }
      catch { try { data = zlib.inflateRawSync(data); } catch {} }
    }
    streams.push(data.toString('latin1'));
    re.lastIndex = end + 9;
  }
  return streams;
}

function buildPdfCMap(streams = []) {
  const map = new Map();
  for (const s of streams) {
    const bf = s.match(/beginbfchar([\s\S]*?)endbfchar/g) || [];
    for (const block of bf) for (const m of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.set(m[1].toUpperCase(), utf16beHexToText(m[2]));
    const br = s.match(/beginbfrange([\s\S]*?)endbfrange/g) || [];
    for (const block of br) for (const m of block.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const a=parseInt(m[1],16), b=parseInt(m[2],16), c=parseInt(m[3],16), width=m[1].length;
      if (!Number.isFinite(a)||!Number.isFinite(b)||!Number.isFinite(c)||b-a>512) continue;
      for (let code=a; code<=b; code++) map.set(code.toString(16).toUpperCase().padStart(width,'0'), utf16beHexToText((c+(code-a)).toString(16).padStart(m[3].length,'0')));
    }
  }
  return map;
}

function decodePdfHexWithMap(hex = '', cmap = new Map()) {
  const clean=String(hex||'').replace(/\s+/g,'').toUpperCase();
  if (!clean) return '';
  for (const width of [4,2,6]) {
    if (clean.length % width) continue;
    let out='', hit=0;
    for (let i=0;i<clean.length;i+=width) { const key=clean.slice(i,i+width); const v=cmap.get(key); if(v){out+=v;hit++;} else { const f=utf16beHexToText(key); if(f) out+=f; } }
    if (hit) return out;
  }
  return utf16beHexToText(clean);
}

function extractPdfTextOperators(stream = '', cmap = new Map()) {
  const pieces=[];
  const blocks = stream.match(/BT[\s\S]*?ET/g) || [stream];
  for (const block of blocks) {
    const tokenRe = /(\((?:\\.|[^\\)])*\)|<([0-9A-Fa-f\s]+)>)/g;
    let m; let line='';
    while ((m=tokenRe.exec(block))) {
      const token=m[1]; let text='';
      if (token.startsWith('(')) text=decodePdfLiteral(token.slice(1,-1));
      else if (token.startsWith('<') && !token.startsWith('<<')) text=decodePdfHexWithMap(m[2]||'',cmap);
      text=normalizeWhitespace(text); if (!text) continue;
      line += (line ? ' ' : '') + text;
      const tail=block.slice(m.index+m[0].length, m.index+m[0].length+24);
      if (/(?:T\*|\sTd\b|\sTD\b|\sTm\b|\s'|\s")/.test(tail)) { pieces.push(line); line=''; }
    }
    if (line) pieces.push(line);
  }
  return normalizeWhitespace(pieces.join('\n'));
}

function extractPdfTextFromBuffer(buffer) {
  const binary = arrayBufferToLatin1(buffer);
  const streams = extractPdfStreams(buffer);
  const cmap = buildPdfCMap(streams);
  const streamText = streams.map((s) => extractPdfTextOperators(s, cmap)).filter(Boolean).join('\n');
  if (textSignalScore(streamText) >= 70) return normalizeWhitespace(streamText);
  const literalStrings = Array.from(binary.matchAll(/\(([^()]|\\\(|\\\))*\)/g)).map((match) => decodePdfEscapes(match[0].slice(1, -1)));
  const hexStrings = Array.from(binary.matchAll(/<([0-9A-Fa-f]{8,})>/g)).map((match) => decodePdfHexWithMap(match[1], cmap));
  const readableStreams = streams.map((s) => extractReadableChunks(s)).filter(Boolean).join('\n');
  return normalizeWhitespace([streamText, ...literalStrings, ...hexStrings, readableStreams, extractReadableChunks(binary)].join('\n'));
}

function decodeBase64Payload(contentBase64 = '') {
  const raw = String(contentBase64 || '').replace(/^data:[^;]+;base64,/, '').trim();
  if (!raw) return Buffer.alloc(0);
  return Buffer.from(raw, 'base64');
}

async function withTempFile(buffer, name, callback) {
  const safeExt = path.extname(String(name || '')).slice(0, 12) || '';
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ccx-extract-'));
  const inputPath = path.join(tempDir, `input${safeExt}`);
  await fs.promises.writeFile(inputPath, buffer);
  try {
    return await callback({ tempDir, inputPath });
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}

async function safeExecFile(bin, args, options = {}) {
  try {
    const result = await execFileAsync(bin, args, { maxBuffer: 20 * 1024 * 1024, timeout: 40000, ...options });
    return String(result.stdout || '');
  } catch {
    return '';
  }
}

function sanitizeResumeText(text = '') {
  let out = String(text || '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ');
  const lower = out.toLowerCase();
  const markers = ['jumdcbor', 'c2pa.hash.data', 'c2pa.claim.v2', 'c2pa.signature', 'ssl.com c2pa', 'openai media service', '%pdf-', 'reportlab generated pdf document'];
  let cut = -1;
  for (const marker of markers) {
    const i = lower.indexOf(marker);
    if (i >= 80 && (cut < 0 || i < cut)) cut = i;
  }
  if (cut > 0) out = out.slice(0, cut);
  return normalizeWhitespace(out);
}

function textSignalScore(text = '') {
  const raw = normalizeWhitespace(text);
  if (!raw) return 0;
  let score = Math.min(raw.length, 2500) / 20;
  if (/(?:name|full name|candidate name)\s*[:\-]/i.test(raw)) score += 35;
  if (/(?:location|current location|city|address)\s*[:\-]/i.test(raw)) score += 30;
  if (/(?:mobile|phone|contact)\s*[:\-]/i.test(raw)) score += 25;
  if (/[6-9](?:\s*\d){9}/.test(raw)) score += 20;
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(raw)) score += 15;
  return score;
}

async function ocrImageFile(inputPath) {
  const attempts = [];
  for (const psm of ['6', '11', '4']) {
    const text = normalizeWhitespace(await safeExecFile('tesseract', [inputPath, 'stdout', '-l', 'eng', '--oem', '1', '--psm', psm, '-c', 'preserve_interword_spaces=1']));
    if (text) attempts.push(text);
  }

  const dir = path.dirname(inputPath);
  const enhancedPath = path.join(dir, `ocr-enhanced-${Date.now()}.png`);
  let enhanced = false;
  const enhanceArgs = [inputPath, '-auto-orient', '-resize', '220%', '-colorspace', 'Gray', '-contrast-stretch', '1%x1%', '-sharpen', '0x1', enhancedPath];
  await safeExecFile('magick', enhanceArgs);
  enhanced = fs.existsSync(enhancedPath);
  if (!enhanced) {
    await safeExecFile('convert', enhanceArgs);
    enhanced = fs.existsSync(enhancedPath);
  }
  if (enhanced) {
    for (const psm of ['6', '11']) {
      const text = normalizeWhitespace(await safeExecFile('tesseract', [enhancedPath, 'stdout', '-l', 'eng', '--oem', '1', '--psm', psm, '-c', 'preserve_interword_spaces=1']));
      if (text) attempts.push(text);
    }
    await fs.promises.unlink(enhancedPath).catch(() => {});
  }

  attempts.sort((a, b) => textSignalScore(b) - textSignalScore(a));
  return attempts[0] || '';
}

async function nativePdfText(inputPath, tempDir) {
  let text = await safeExecFile('pdftotext', ['-layout', '-nopgbrk', inputPath, '-']);
  text = normalizeWhitespace(text);
  if (textSignalScore(text) >= 85) return text;

  await safeExecFile('pdftoppm', ['-r', '220', '-png', '-f', '1', '-l', '3', inputPath, path.join(tempDir, 'pdfpage')]);
  const images = (await fs.promises.readdir(tempDir).catch(() => []))
    .filter((name) => name.startsWith('pdfpage-') && name.endsWith('.png'))
    .sort()
    .slice(0, 3);
  const ocrParts = [];
  for (const image of images) {
    const part = await ocrImageFile(path.join(tempDir, image));
    if (part) ocrParts.push(part);
  }
  const ocrText = normalizeWhitespace(ocrParts.join('\n\n'));
  if (textSignalScore(ocrText) > textSignalScore(text)) return ocrText;
  return text;
}

async function nativeDocText(inputPath) {
  return normalizeWhitespace(await safeExecFile('antiword', [inputPath]));
}

function xmlToText(xml) {
  return normalizeWhitespace(String(xml || '')
    .replace(/<w:tab\/?\s*>/gi, ' ')
    .replace(/<w:br\/?\s*>/gi, '\n')
    .replace(/<w:p[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '));
}

async function nativeDocxText(inputPath) {
  let text = await safeExecFile('unzip', ['-p', inputPath, 'word/document.xml']);
  text = xmlToText(text);
  if (text.length >= 30) return text;
  return '';
}

async function nativeImageText(buffer, name) {
  return withTempFile(buffer, name, async ({ inputPath }) => ocrImageFile(inputPath));
}

async function extractFileText(file = {}) {
  const name = String(file.name || '').toLowerCase();
  const mime = String(file.mime_type || '').toLowerCase();
  const buffer = decodeBase64Payload(file.content_base64 || '');
  if (!buffer.length) return '';

  if (mime.startsWith('text/') || /\.(txt|csv|json|md)$/i.test(name)) return normalizeWhitespace(buffer.toString('utf8'));
  if (mime.includes('html') || /\.(html|htm)$/i.test(name)) return htmlToText(buffer.toString('utf8'));

  if (mime.includes('pdf') || /\.pdf$/i.test(name)) {
    const native = await withTempFile(buffer, name, async ({ inputPath, tempDir }) => nativePdfText(inputPath, tempDir));
    const portable = extractPdfTextFromBuffer(buffer);
    return sanitizeResumeText(textSignalScore(portable) >= textSignalScore(native) ? portable : normalizeWhitespace([native, portable].filter(Boolean).join('\n')));
  }

  if (mime.includes('officedocument.wordprocessingml') || /\.docx$/i.test(name)) {
    const native = await withTempFile(buffer, name, async ({ inputPath }) => nativeDocxText(inputPath));
    return native || normalizeWhitespace(extractReadableChunks(buffer.toString('latin1')));
  }

  if (mime.includes('msword') || /\.doc$/i.test(name)) {
    const native = await withTempFile(buffer, name, async ({ inputPath }) => nativeDocText(inputPath));
    return native || normalizeWhitespace(extractReadableChunks(buffer.toString('latin1')));
  }

  if (mime.startsWith('image/') || /\.(png|jpg|jpeg|webp|bmp|tif|tiff)$/i.test(name)) {
    const native = await nativeImageText(buffer, name);
    return native || '';
  }

  return normalizeWhitespace(extractReadableChunks(buffer.toString('latin1')));
}

function cleanCandidateFields(fields = {}) {
  return {
    ...fields,
    notes: String(fields.notes || '').trim(),
  };
}

function detectMissingCandidate(fields = {}) {
  const missing = [];
  if (!String(fields.full_name || '').trim()) missing.push('Name');
  if (!String(fields.phone || '').trim()) missing.push('Primary Number');
  if (!String(fields.email || '').trim()) missing.push('Email');
  return missing;
}

function candidateConfidence(fields = {}) {
  let score = 0;
  if (fields.full_name) score += 35;
  if (fields.phone) score += 30;
  if (fields.email) score += 15;
  if (fields.location) score += 10;
  if (fields.qualification) score += 10;
  return Math.min(100, score);
}

function clientConfidence(fields = {}) {
  let score = 0;
  if (fields.client_name) score += 35;
  if (fields.contact_person) score += 20;
  if (fields.contact_phone) score += 20;
  if (fields.contact_email) score += 15;
  if (fields.city) score += 10;
  return Math.min(100, score);
}


async function parseResumeTransient(req, res) {
  const file = req.body || {};
  const name = String(file.name || 'resume').slice(0, 140);
  const mime_type = String(file.mime_type || '').slice(0, 120);
  if (!String(file.content_base64 || '').trim()) return res.status(400).json({ ok: false, message: 'Resume file is required.' });
  const text = sanitizeResumeText(await extractFileText({ name, mime_type, content_base64: file.content_base64 }));
  const fields = cleanCandidateFields(extractCandidateFields(text || '', name));
  return res.json({ ok: true, engine: 'transient-resume-autofill', text: String(text || '').slice(0, 5000), fields, missing: detectMissingCandidate(fields), confidence: candidateConfidence(fields) });
}

async function parseFiles(req, res) {
  if (!isManager(req.user)) return res.status(403).json({ message: 'Only manager can use data extractor.' });
  const target = lower(req.body?.target || 'candidate');
  const files = Array.isArray(req.body?.files) ? req.body.files.slice(0, 30) : [];
  if (!files.length) return res.status(400).json({ message: 'At least one file is required.' });

  const items = await Promise.all(files.map(async (file, index) => ({
    name: file?.name || `file-${index + 1}`,
    mime_type: file?.mime_type || '',
    text: await extractFileText(file),
  })));

  const parsed = items.map((item, index) => {
    if (target === 'client') {
      const fields = extractClientFields(item.text || '', item.name);
      return {
        row_key: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
        include: true,
        source_filename: item.name,
        confidence: clientConfidence(fields),
        raw_text: String(item.text || '').slice(0, 2000),
        ...fields,
      };
    }
    const fields = cleanCandidateFields(extractCandidateFields(item.text || '', item.name));
    return {
      row_key: `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
      include: true,
      source_filename: item.name,
      confidence: candidateConfidence(fields),
      missing: detectMissingCandidate(fields),
      raw_text: String(item.text || '').slice(0, 2000),
      process: '',
      status: 'Draft',
      all_details_sent: '',
      approval_status: 'Draft',
      submission_date: '',
      ...fields,
      status: 'Draft',
      all_details_sent: '',
      approval_status: 'Draft',
      submission_date: '',
    };
  });

  return res.json({ items: parsed, count: parsed.length, engine: 'javascript + native cli extraction' });
}

module.exports = { parseFiles, parseResumeTransient };
