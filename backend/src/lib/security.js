const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/env');

const rateBuckets = new Map();

function timingSafeTextEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
  } catch {
    return false;
  }
}

function decodeBase64Loose(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  try {
    return Buffer.from(padded, 'base64');
  } catch {
    return null;
  }
}

function verifyPbkdf2Password(storedPassword, inputPassword) {
  const stored = String(storedPassword || '').trim();
  const incoming = String(inputPassword || '');
  if (!stored) return false;
  let algorithm = 'sha256';
  let iterations = 0;
  let salt = '';
  let expected = '';

  if (/^pbkdf2:[^$]+\$/i.test(stored)) {
    const parts = stored.split('$');
    const methodBits = String(parts[0] || '').split(':');
    algorithm = String(methodBits[1] || 'sha256').toLowerCase();
    iterations = Number.parseInt(methodBits[2] || '0', 10);
    salt = String(parts[1] || '');
    expected = String(parts.slice(2).join('$') || '');
  } else if (/^pbkdf2_sha\d+\$/i.test(stored)) {
    const parts = stored.split('$');
    const match = String(parts[0] || '').match(/^pbkdf2_(sha\d+)$/i);
    algorithm = String(match?.[1] || 'sha256').toLowerCase();
    iterations = Number.parseInt(parts[1] || '0', 10);
    salt = String(parts[2] || '');
    expected = String(parts.slice(3).join('$') || '');
  } else if (/^pbkdf2\$/i.test(stored)) {
    const parts = stored.split('$');
    algorithm = 'sha256';
    iterations = Number.parseInt(parts[1] || '0', 10);
    salt = String(parts[2] || '');
    expected = String(parts.slice(3).join('$') || '');
  } else {
    return false;
  }

  if (!iterations || !salt || !expected) return false;
  const derivedLengths = [];
  if (/^[a-f0-9]+$/i.test(expected) && expected.length % 2 === 0) {
    derivedLengths.push(expected.length / 2);
  }
  const decoded = decodeBase64Loose(expected);
  if (decoded?.length) derivedLengths.push(decoded.length);
  for (const guess of [32, 64, 20]) {
    if (!derivedLengths.includes(guess)) derivedLengths.push(guess);
  }

  try {
    return derivedLengths.some((length) => {
      const derived = crypto.pbkdf2Sync(incoming, salt, iterations, length, algorithm);
      const hex = derived.toString('hex');
      const base64 = derived.toString('base64');
      const base64NoPad = base64.replace(/=+$/g, '');
      const base64Url = base64NoPad.replace(/\+/g, '-').replace(/\//g, '_');
      return [hex, base64, base64NoPad, base64Url].some((value) => timingSafeTextEqual(value, expected));
    });
  } catch {
    return false;
  }
}

function hashPassword(password) {
  const incoming = String(password || '');
  const salt = crypto.randomBytes(16).toString('base64url');
  const iterations = 150000;
  const algorithm = 'sha256';
  const derived = crypto.pbkdf2Sync(incoming, salt, iterations, 32, algorithm).toString('base64url');
  return `pbkdf2:${algorithm}:${iterations}$${salt}$${derived}`;
}

function verifyPassword(storedPassword, inputPassword) {
  const stored = String(storedPassword || '').trim();
  const incoming = String(inputPassword || '');
  if (!stored) return false;
  if (verifyPbkdf2Password(stored, incoming)) return true;
  return timingSafeTextEqual(stored, incoming);
}

function passwordNeedsUpgrade(storedPassword) {
  return !/^pbkdf2[:_$]/i.test(String(storedPassword || '').trim());
}

// CC166: expensive password work runs on the crypto worker pool, not Node's
// HTTP event loop. Existing stored hash formats and password values stay valid.
async function verifyPasswordAsync(storedPassword,inputPassword){
 const stored=String(storedPassword||'').trim(),input=String(inputPassword||'');
 if(!stored)return false;
 if(!/^pbkdf2[:_$]/i.test(stored))return timingSafeTextEqual(stored,input);
 let algorithm='sha256',iterations=0,salt='',expected='';const parts=stored.split('$');
 if(/^pbkdf2:[^$]+\$/i.test(stored)){const bits=parts[0].split(':');algorithm=String(bits[1]||'sha256').toLowerCase();iterations=Number.parseInt(bits[2],10);salt=parts[1]||'';expected=parts.slice(2).join('$');}
 else if(/^pbkdf2_sha\d+\$/i.test(stored)){algorithm=parts[0].slice(7).toLowerCase();iterations=Number.parseInt(parts[1],10);salt=parts[2]||'';expected=parts.slice(3).join('$');}
 else if(/^pbkdf2\$/i.test(stored)){iterations=Number.parseInt(parts[1],10);salt=parts[2]||'';expected=parts.slice(3).join('$');}
 if(!Number.isSafeInteger(iterations)||iterations<=0||!salt||!expected)return false;
 const bytes=/^[a-f0-9]+$/i.test(expected)&&expected.length%2===0?Buffer.from(expected,'hex'):decodeBase64Loose(expected);
 if(!bytes?.length)return false;
 try{const actual=await new Promise((resolve,reject)=>crypto.pbkdf2(input,salt,iterations,bytes.length,algorithm,(error,value)=>error?reject(error):resolve(value)));return actual.length===bytes.length&&crypto.timingSafeEqual(actual,bytes);}catch{return false;}
}
async function hashPasswordAsync(password){
 const salt=crypto.randomBytes(16).toString('base64url'),derived=await new Promise((resolve,reject)=>crypto.pbkdf2(String(password||''),salt,150000,32,'sha256',(error,value)=>error?reject(error):resolve(value)));
 return 'pbkdf2:sha256:150000$'+salt+'$'+derived.toString('base64url');
}

function bucketKey(scope, key) {
  return `${scope}::${String(key || '').trim().toLowerCase()}`;
}

function consumeRateLimit(scope, key, options = {}) {
  const now = Date.now();
  const limit = Number(options.limit || 5);
  const windowMs = Number(options.windowMs || 5 * 60 * 1000);
  const blockMs = Number(options.blockMs || 15 * 60 * 1000);
  const id = bucketKey(scope, key);
  const current = rateBuckets.get(id) || { count: 0, firstAt: now, blockedUntil: 0 };

  if (current.blockedUntil && current.blockedUntil > now) {
    return { allowed: false, retryAfterMs: current.blockedUntil - now, blocked: true };
  }
  if ((now - current.firstAt) > windowMs) {
    current.count = 0;
    current.firstAt = now;
    current.blockedUntil = 0;
  }
  current.count += 1;
  if (current.count > limit) {
    current.blockedUntil = now + blockMs;
    rateBuckets.set(id, current);
    return { allowed: false, retryAfterMs: blockMs, blocked: true };
  }
  rateBuckets.set(id, current);
  return { allowed: true, remaining: Math.max(0, limit - current.count) };
}

function clearRateLimit(scope, key) {
  rateBuckets.delete(bucketKey(scope, key));
}

function issueActionToken(payload = {}, ttlSeconds = 180) {
  return jwt.sign({ ...payload }, JWT_SECRET, { expiresIn: `${Math.max(30, Number(ttlSeconds || 180))}s` });
}

function verifyActionToken(token, expected = {}) {
  try {
    const decoded = jwt.verify(String(token || ''), JWT_SECRET);
    if (expected.purpose && decoded.purpose !== expected.purpose) return null;
    if (expected.username && String(decoded.username || '') !== String(expected.username || '')) return null;
    if (expected.routeKey && String(decoded.routeKey || '') !== String(expected.routeKey || '')) return null;
    return decoded;
  } catch {
    return null;
  }
}

module.exports = {
  timingSafeTextEqual,
  verifyPasswordAsync,
  hashPasswordAsync,
  hashPassword,
  verifyPassword,
  passwordNeedsUpgrade,
  consumeRateLimit,
  clearRateLimit,
  issueActionToken,
  verifyActionToken,
};
