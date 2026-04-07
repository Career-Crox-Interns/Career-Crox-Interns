const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const apiRoutes = require('./routes');
const { SPA_DIR, GENERATED_DIR } = require('./config/env');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: process.env.JSON_LIMIT || '15mb' }));
app.use(cookieParser());

app.get('/health', (req, res) => {
  res.status(200).send('ok');
});
app.use('/generated', express.static(GENERATED_DIR));
if (fs.existsSync(SPA_DIR)) app.use(express.static(SPA_DIR));

app.use('/api', apiRoutes);

app.get('*', (req, res, next) => {
  const indexFile = path.join(SPA_DIR, 'index.html');
  if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
  return res.send('Backend ready. Build frontend to /public/spa for full app.');
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
