const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const apiRoutes = require('./routes');
const { SPA_DIR, GENERATED_DIR } = require('./config/env');
const { requireAuth, requireStrongAuth } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();

function buildAllowedOrigins() {
  return new Set(
    String(process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

const allowedOrigins = buildAllowedOrigins();

function isAllowedOrigin(origin = '') {
  const value = String(origin || '').trim();
  if (!value) return true;
  if (allowedOrigins.has(value)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(value)) return true;
  if (/^https?:\/\/[a-z0-9-]+\.onrender\.com$/i.test(value)) return true;
  return false;
}

app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error('Origin blocked by CORS'));
  },
  credentials: true,
}));

function staticCacheControl(req, res, next) {
  const url = String(req.url || '');
  if (/\.(?:js|css|png|jpg|jpeg|webp|svg|ico|mp3|woff2?)$/i.test(url)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (/index\.html$/i.test(url) || url === '/' || !url.includes('.')) {
    res.setHeader('Cache-Control', 'no-cache');
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

app.get('/health', (req, res) => {
  res.status(200).send('ok');
});
app.use('/generated', requireAuth, express.static(GENERATED_DIR));
if (fs.existsSync(SPA_DIR)) app.use(staticCacheControl, express.static(SPA_DIR));

app.use('/api', apiRoutes);

app.get('*', (req, res, next) => {
  const indexFile = path.join(SPA_DIR, 'index.html');
  if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
  return res.send('Backend ready. Build frontend to /public/spa for full app.');
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
