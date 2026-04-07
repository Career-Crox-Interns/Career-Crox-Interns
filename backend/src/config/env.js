const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-now';
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || 'false') === 'true';
const DATABASE_URL = (
  process.env.DATABASE_URL ||
  process.env.SUPABASE_DB_URL ||
  process.env.POSTGRES_URL ||
  process.env.SUPABASE_DATABASE_URL ||
  ''
).trim();
const REQUIRE_POSTGRES = String(process.env.REQUIRE_POSTGRES || 'false') === 'true';
const ROOT_DIR = path.join(__dirname, '..', '..');
const SPA_DIR = path.join(ROOT_DIR, 'public', 'spa');
const GENERATED_DIR = path.join(ROOT_DIR, 'public', 'generated');
const SEED_FILE = path.join(ROOT_DIR, 'data', 'demo-seed.json');

if (!fs.existsSync(GENERATED_DIR)) fs.mkdirSync(GENERATED_DIR, { recursive: true });

module.exports = {
  PORT,
  HOST,
  JWT_SECRET,
  COOKIE_SECURE,
  DATABASE_URL,
  REQUIRE_POSTGRES,
  ROOT_DIR,
  SPA_DIR,
  GENERATED_DIR,
  SEED_FILE,
};
