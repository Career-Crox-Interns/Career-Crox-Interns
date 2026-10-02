process.env.TZ = 'Asia/Kolkata';
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const apiRoutes = require('./routes');
const { SPA_DIR, GENERATED_DIR, DATABASE_URL, REQUIRE_POSTGRES } = require('./config/env');
const { requireAuth, requireStrongAuth } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();

function buildAllowedOrigins() {
  const values = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const renderUrl = String(process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '');
  const renderHost = String(process.env.RENDER_EXTERNAL_HOSTNAME || '').trim();
  if (renderUrl) values.push(renderUrl);
  if (renderHost) values.push(`https://${renderHost}`);
  // Exact production origin. Keep this explicit so same-origin POST/login always works
  // even if Render environment variables were not refreshed during a deploy.
  values.push('https://career-crox.onrender.com');
  return new Set(values);
}

const allowedOrigins = buildAllowedOrigins();

function normalizedOrigin(value = '') {
  return String(value || '').trim().replace(/\/$/, '');
}

function isLoopbackOrigin(origin = '') {
  try {
    const url = new URL(normalizedOrigin(origin));
    const host = String(url.hostname || '').toLowerCase();
    return ['http:', 'https:'].includes(url.protocol) && (
      host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.startsWith('127.')
    );
  } catch (_) {
    return false;
  }
}

function isSameRequestOrigin(req, origin = '') {
  try {
    const url = new URL(normalizedOrigin(origin));
    const forwardedHost = String(req.get('x-forwarded-host') || '').split(',')[0].trim();
    const requestHost = forwardedHost || String(req.get('host') || '').trim();
    const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
    const requestProto = forwardedProto || String(req.protocol || '').trim().toLowerCase();
    return Boolean(requestHost) && url.host.toLowerCase() === requestHost.toLowerCase()
      && (!requestProto || url.protocol.toLowerCase() === `${requestProto}:`);
  } catch (_) {
    return false;
  }
}

function isAllowedOrigin(req, origin = '') {
  const value = normalizedOrigin(origin);
  if (!value) return true; // server-to-server/local proxy requests have no Origin header
  if (allowedOrigins.has(value)) return true;
  if (isLoopbackOrigin(value)) return true;
  if (isSameRequestOrigin(req, value)) return true;
  return false;
}

// Reject unknown browser origins before routes (CSRF-safe), while still allowing
// localhost/127.0.0.1 launchers and the exact Render origin. This replaces the old
// CORS callback that could throw a 500-style "Origin blocked by CORS" on login.
app.use((req, res, next) => {
  const origin = String(req.get('origin') || '').trim();
  if (origin && !isAllowedOrigin(req, origin)) {
    return res.status(403).json({ ok: false, error: 'Origin not allowed', code: 'CORS_ORIGIN_DENIED' });
  }
  return next();
});
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  maxAge: 86400,
}));

function staticCacheControl(req, res, next) {
  const rawUrl = String(req.url || '');
  const pathname = rawUrl.split('?')[0];
  const fileName = path.basename(pathname);
  const isViteHashedAsset = /-[A-Za-z0-9_-]{8,}\.(?:js|css)$/i.test(fileName) && !/CC26_/i.test(fileName);
  const isCareerCroxReleaseAsset = /^(?:app|runtime)-cc26-\d+-[a-f0-9]{8,}\.(?:js|css)$/i.test(fileName);
  const isReleaseVersionedAsset = /[?&]v=CC26_\d+(?:_[A-Za-z0-9_-]+)?(?:[&#]|$)/i.test(rawUrl) && /\.(?:js|css)$/i.test(pathname);
  const isImageOrFont = /\.(?:png|jpg|jpeg|webp|svg|ico|mp3|woff2?)$/i.test(pathname);
  const isScriptOrStyle = /\.(?:js|css)$/i.test(pathname);

  // Current release assets are immutable by URL. Next release changes the v= value,
  // so browsers get speed without stale-code risk or repeated egress.
  if (isViteHashedAsset || isCareerCroxReleaseAsset || isReleaseVersionedAsset || isImageOrFont) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (isScriptOrStyle) {
    res.setHeader('Cache-Control', 'no-cache, max-age=0, must-revalidate');
  } else if (/index\.html$/i.test(pathname) || pathname === '/' || !pathname.includes('.')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
}
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.json({ limit: process.env.JSON_LIMIT || '15mb' }));
app.use(cookieParser());

function readSpaRuntimeState() {
  const spaIndex = path.join(SPA_DIR, 'index.html');
  if (!fs.existsSync(spaIndex)) return { spaReady: false, build: 'unknown', mainAsset: null };
  try {
    const html = fs.readFileSync(spaIndex, 'utf8');
    const build = (html.match(/<meta\s+name=[\"']cc-build[\"']\s+content=[\"']([^\"']+)[\"']/i) || [])[1] || 'unknown';
    const mainAsset = (html.match(/<meta\s+name=[\"']cc-main-asset[\"']\s+content=[\"']([^\"']+)[\"']/i) || [])[1] || null;
    const mainAssetPath = mainAsset ? path.join(SPA_DIR, String(mainAsset).replace(/^\//, '')) : null;
    return { spaReady: Boolean(mainAssetPath && fs.existsSync(mainAssetPath)), build, mainAsset };
  } catch (error) {
    return { spaReady: false, build: 'unknown', mainAsset: null };
  }
}

// Render /health is a process-liveness check. The build step already validates the
// complete prebuilt SPA, so health must never be tied to a hard-coded old asset name.
// This keeps cold-start deploys fast and prevents an otherwise healthy service from
// being stuck in "In progress" after a new CC26 release.
app.get('/health', (req, res) => {
  const state = readSpaRuntimeState();
  res.status(200).json({
    ok: true,
    service: 'career-crox',
    status: 'alive',
    build: state.build,
    spa: state.spaReady,
    main_asset: state.mainAsset,
  });
});

// Optional strict readiness endpoint for diagnostics. Render does not use this.
app.get('/ready', async (req, res) => {
  const state = readSpaRuntimeState();
  let dbReady = !REQUIRE_POSTGRES;
  let dbError = '';
  if (DATABASE_URL) {
    try {
      const { store } = require('./lib/store');
      const probe = await store.query('select 1 as ok');
      dbReady = Number(probe?.[0]?.ok || 0) === 1;
    } catch (error) { dbReady = false; dbError = String(error?.message || error || 'database probe failed'); }
  }
  const ok = Boolean(state.spaReady && dbReady);
  res.status(ok ? 200 : 503).json({
    ok, service: 'career-crox', status: ok ? 'ready' : (!state.spaReady ? 'spa_incomplete' : 'database_unavailable'),
    build: state.build, spa: state.spaReady, database: dbReady, database_error: dbError || undefined, main_asset: state.mainAsset,
  });
});
app.get('/download/android-apk', (req, res) => {
  const apkFile = path.join(__dirname, '..', 'public', 'apk', 'CAREER_CROX.apk');
  const downloadName = 'Career Crox.apk';
  if (!fs.existsSync(apkFile)) {
    return res.status(404).json({ ok: false, message: 'APK file not found on server. Place Career Crox APK at backend/public/apk/CAREER_CROX.apk.' });
  }
  const apkHash = crypto.createHash('sha256').update(fs.readFileSync(apkFile)).digest('hex');
  if (apkHash === '0d13a8f71a6daef3cd71d7e267a085df88ce2066a849d2308e84a2f87335fe88') {
    return res.status(409).json({ ok: false, message: 'Old APK is still placed on server. Replace backend/public/apk/CAREER_CROX.apk with the latest Career Crox APK before download.' });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  return res.download(apkFile, downloadName);
});
// CC26_661: explicit SecureLink Windows helper download. No Supabase/database query.
// Fresh source build: no packer, no service/persistence, localhost-only bridge.
// Windows mouse/keyboard control still requires visible employee consent.
const SECURELINK_HELPER_SHA256 = 'ff3ad078212a0393ef6e83bf486ad3116a7a23e4826b2a57a2141351ec537ee9';
function secureLinkHelperPath() { return path.join(__dirname, '..', 'public', 'securelink', 'Career Crox SecureLink.exe'); }
app.get('/securelink/build-info', requireAuth, requireStrongAuth, (req,res) => {
  const exe = secureLinkHelperPath();
  const present = fs.existsSync(exe);
  res.set('Cache-Control', 'no-store');
  return res.json({ securelink: 'CC26_661', app_download_ready: present, download_url: present ? '/download/securelink-helper?v=CC26_661' : null, sha256: present ? SECURELINK_HELPER_SHA256 : null, signed: false, background_download: false });
});
app.get('/download/securelink-helper', requireAuth, requireStrongAuth, (req, res) => {
  const exe = secureLinkHelperPath();
  if (!fs.existsSync(exe)) return res.status(404).json({ ok:false, message:'SecureLink Windows app is missing from this deployment.' });
  const actual = crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
  if (actual !== SECURELINK_HELPER_SHA256) return res.status(409).json({ ok:false, message:'SecureLink Windows app checksum mismatch. Redeploy the complete verified package.' });
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/vnd.microsoft.portable-executable');
  res.setHeader('X-SecureLink-Build', 'CC26_661');
  res.setHeader('X-Content-SHA256', actual);
  return res.download(exe, 'Career Crox SecureLink.exe');
});

app.use('/generated', requireAuth, express.static(GENERATED_DIR));

// CC26_459: compress the large immutable CRM JS/CSS assets without adding a package
// dependency or extra .br/.gz files. This cuts first-load egress and lets the UI boot
// much faster on Render. Compressed buffers are cached in process memory by mtime.
const compressedAssetCache = new Map();
function compressionKind(req = {}) {
  const value = String(req.headers?.['accept-encoding'] || '').toLowerCase();
  if (value.includes('br')) return 'br';
  if (value.includes('gzip')) return 'gzip';
  return '';
}
function mimeForAsset(filePath = '') {
  const ext = path.extname(filePath).toLowerCase();
  return ({ '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' })[ext] || 'application/octet-stream';
}
function compressedSpaAsset(req, res, next) {
  const pathname = String(req.path || '').replace(/^\/+/, '');
  if (!/\.(?:js|css|json|svg)$/i.test(pathname)) return next();
  const encoding = compressionKind(req);
  if (!encoding) return next();
  const filePath = path.resolve(SPA_DIR, pathname);
  const spaRoot = path.resolve(SPA_DIR);
  if (!(filePath === spaRoot || filePath.startsWith(`${spaRoot}${path.sep}`))) return next();
  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) return next();
    const cacheKey = `${filePath}:${stat.mtimeMs}:${stat.size}:${encoding}`;
    const cached = compressedAssetCache.get(cacheKey);
    const send = (buffer) => {
      staticCacheControl(req, res, () => {});
      res.setHeader('Content-Type', mimeForAsset(filePath));
      res.setHeader('Content-Encoding', encoding);
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Content-Length', String(buffer.length));
      res.status(200).end(buffer);
    };
    if (cached) return send(cached);
    fs.readFile(filePath, (readError, input) => {
      if (readError) return next();
      const done = (error, output) => {
        if (error || !output) return next();
        compressedAssetCache.set(cacheKey, output);
        // Keep memory bounded across deploys / file changes.
        if (compressedAssetCache.size > 32) {
          const first = compressedAssetCache.keys().next().value;
          if (first) compressedAssetCache.delete(first);
        }
        return send(output);
      };
      if (encoding === 'br') {
        return zlib.brotliCompress(input, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }, done);
      }
      return zlib.gzip(input, { level: 6 }, done);
    });
  });
}
// SecureLink has its own lightweight page so existing CRM SPA assets remain unchanged.
app.get(['/securelink', '/securelink/', '/securelink/index.html'], requireAuth, requireStrongAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-SecureLink-Build', 'CC26_642');
  return res.sendFile(path.join(SPA_DIR, 'securelink', 'index.html'));
});

if (fs.existsSync(SPA_DIR)) app.use(compressedSpaAsset, staticCacheControl, express.static(SPA_DIR));
// Never return index.html for a missing JS/CSS/image asset. That MIME mismatch used to
// leave browsers sitting forever on the boot placeholder.
app.use('/assets', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(404).type('text/plain').send('CRM asset not found. Deploy the complete current Career Crox package.');
});

app.use('/api', apiRoutes);

app.get('*', (req, res, next) => {
  const indexFile = path.join(SPA_DIR, 'index.html');
  if (fs.existsSync(indexFile)) { res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate'); res.setHeader('Pragma', 'no-cache'); res.setHeader('Expires', '0'); return res.sendFile(indexFile); }
  return res.send('Backend ready. Build frontend to /public/spa for full app.');
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
