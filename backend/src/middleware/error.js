function notFound(req, res) {
  return res.status(404).json({ message: 'Route not found' });
}

function normalizeMessage(err) {
  const raw = String(err?.message || 'Internal server error');
  if (raw.includes('relation') && raw.includes('does not exist')) {
    return 'Database tables are missing. Run the included SQL once or restart so auto-bootstrap can create them.';
  }
  if (raw.includes('password authentication failed')) {
    return 'Database password is wrong in DATABASE_URL.';
  }
  return raw;
}

function errorHandler(err, req, res, next) {
  try { console.error('Career Crox API safety guard:', err); } catch {}
  if (res.headersSent) return next(err);
  const status = ['CC070','CC071','CC074'].includes(err?.code) ? 409 : err?.code==='CC072' ? 400 : Number(err?.status || err?.statusCode || 500);
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  return res.status(safeStatus).json({
    message: normalizeMessage(err),
    ...(err?.code === 'CC070' ? { code: 'BUCKET_CAPACITY_REACHED' } : {}),
  });
}

module.exports = {
  notFound,
  errorHandler,
};
