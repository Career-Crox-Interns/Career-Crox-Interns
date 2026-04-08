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
  console.error(err);
  return res.status(500).json({
    message: normalizeMessage(err),
  });
}

module.exports = {
  notFound,
  errorHandler,
};
