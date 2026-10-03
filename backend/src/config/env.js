const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  if (Number.isFinite(value) && value > 0) return value;
  return fallback;
}

const PORT = numberEnv('PORT', 8787);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT_DIR = path.join(__dirname, '..', '..');
const DATABASE_URL = (
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.POSTGRES_URL ||
  process.env.SUPABASE_DATABASE_URL ||
  ''
).trim();
const IS_PRODUCTION = String(process.env.NODE_ENV || '').toLowerCase() === 'production' || Boolean(process.env.RENDER);
const explicitJwtSecret = String(process.env.JWT_SECRET || '').trim();
const fallbackSecretSeed = `${DATABASE_URL || 'career-crox-local'}|career-crox-local-only-secret`;
// CC26_685: missing Render env must never blank the frontend. In production a
// cryptographically-random process secret is safer than a fixed fallback; sessions
// simply expire after a restart until Render's persistent JWT_SECRET is configured.
const JWT_SECRET = explicitJwtSecret || (IS_PRODUCTION
  ? crypto.randomBytes(48).toString('hex')
  : crypto.createHash('sha256').update(fallbackSecretSeed).digest('hex'));
if (IS_PRODUCTION && !explicitJwtSecret) console.warn('JWT_SECRET is not set; using a secure temporary process secret. Configure JWT_SECRET on Render to keep sessions across restarts.');
const COOKIE_SECURE = String(process.env.COOKIE_SECURE ?? (IS_PRODUCTION ? 'true' : 'false')).toLowerCase() === 'true';
const REQUIRE_POSTGRES = String(process.env.REQUIRE_POSTGRES ?? (IS_PRODUCTION ? 'true' : 'false')).toLowerCase() === 'true';
// CC26_685: production never falls back to demo JSON. If the database URL is
// temporarily missing, the server still boots the static CRM/login UI; API data
// calls fail closed with 503 until the real database connection is restored.
const SPA_DIR = path.join(ROOT_DIR, 'public', 'spa');
const GENERATED_DIR = path.join(ROOT_DIR, 'public', 'generated');
// CC26_697: new offline sessions start empty; never auto-load legacy sample/demo seeds.
const SEED_FILE = path.join(ROOT_DIR, 'data', 'local-initial-state.json');

try {
  if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });
} catch (error) {
  console.error('Generated dir create failed:', error);
}

module.exports = {
  PORT,
  HOST,
  JWT_SECRET,
  COOKIE_SECURE,
  DATABASE_URL,
  REQUIRE_POSTGRES,
  IS_PRODUCTION,
  ROOT_DIR,
  SPA_DIR,
  GENERATED_DIR,
  SEED_FILE,
};
