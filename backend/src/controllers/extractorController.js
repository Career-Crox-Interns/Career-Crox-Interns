const fs = require('fs');
const os = require('os');
const path = require('path');
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
  return normalizeWhitespace([...literalStrings, ...hexStrings, extractReadableChunks(binary)].join('\n'));
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

async function ocrImageFile(inputPath) {
  const text = await safeExecFile('tesseract', [inputPath, 'stdout', '-l', 'eng', '--psm', '6']);
  return normalizeWhitespace(text);
}

async function nativePdfText(inputPath, tempDir) {
  let text = await safeExecFile('pdftotext', ['-layout', '-nopgbrk', inputPath, '-']);
  text = normalizeWhitespace(text);
  if (text.length >= 40) return text;

  await safeExecFile('pdftoppm', ['-png', '-f', '1', '-l', '2', inputPath, path.join(tempDir, 'pdfpage')]);
  const images = (await fs.promises.readdir(tempDir).catch(() => [])).filter((name) => name.startsWith('pdfpage-') && name.endsWith('.png')).slice(0, 2);
  const ocrParts = [];
  for (const image of images) {
    const part = await ocrImageFile(path.join(tempDir, image));
    if (part) ocrParts.push(part);
  }
  return normalizeWhitespace(ocrParts.join('\n\n'));
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
    return native || extractPdfTextFromBuffer(buffer);
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
      status: 'In - Progress',
      all_details_sent: 'Pending',
      ...fields,
    };
  });

  return res.json({ items: parsed, count: parsed.length, engine: 'javascript + native cli extraction' });
}

module.exports = { parseFiles };
