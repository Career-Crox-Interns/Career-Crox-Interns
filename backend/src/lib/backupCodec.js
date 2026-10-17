const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const derive = promisify(crypto.pbkdf2), gzip = promisify(zlib.gzip), gunzip = promisify(zlib.gunzip);
const FORMAT = 'career-crox-backup', ITERATIONS = 210000, MAX_PLAIN = 256 * 1024 * 1024;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function secret(value) {
  const s = String(value || '');
  if (s.length < 12 || s.length > 256) throw Object.assign(new Error('Use a backup passphrase of 12–256 characters.'), { status: 400 });
  return s;
}
async function seal(payload, passphrase) {
  secret(passphrase);
  const plain = Buffer.from(JSON.stringify(payload));
  if (plain.length > MAX_PLAIN) throw Object.assign(new Error('Backup exceeds the 256 MB uncompressed limit.'), { status: 413 });
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = await derive(passphrase, salt, ITERATIONS, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(await gzip(plain)), cipher.final(), cipher.getAuthTag()]);
  key.fill(0);
  return { format: FORMAT, version: 1, build: 'CC787', created_at: payload.created_at, cipher: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: salt.toString('base64'), iv: iv.toString('base64'), ciphertext: encrypted.toString('base64'), sha256: sha(encrypted) };
}
async function open(envelope, passphrase) {
  secret(passphrase);
  if (envelope?.format !== FORMAT || envelope.version !== 1 || envelope.cipher !== 'AES-256-GCM' || envelope.kdf !== 'PBKDF2-SHA256' || envelope.iterations !== ITERATIONS) throw Object.assign(new Error('Unsupported backup file.'), { status: 400 });
  const encrypted = Buffer.from(String(envelope.ciphertext || ''), 'base64'), salt = Buffer.from(String(envelope.salt || ''), 'base64'), iv = Buffer.from(String(envelope.iv || ''), 'base64');
  if (salt.length !== 16 || iv.length !== 12 || encrypted.length < 17 || encrypted.length > 64 * 1024 * 1024 || sha(encrypted) !== envelope.sha256) throw Object.assign(new Error('Backup file is damaged or too large.'), { status: 400 });
  const key = await derive(passphrase, salt, ITERATIONS, 32, 'sha256');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(encrypted.subarray(-16));
    const packed = Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]);
    return JSON.parse((await gunzip(packed, { maxOutputLength: MAX_PLAIN })).toString('utf8'));
  } catch { throw Object.assign(new Error('Wrong passphrase or damaged backup.'), { status: 400 }); }
  finally { key.fill(0); }
}
module.exports = { seal, open, sha };
