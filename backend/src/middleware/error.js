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
  if (res.headersSent) return next(err);
  const duplicate=err?.code==='DUPLICATE_PHONE'||err?.code==='23505'&&/DUPLICATE_PHONE/.test(err.message||'');
  const status = err?.code==='CC874'?423:duplicate||['CC070','CC071','CC074'].includes(err?.code) ? 409 : err?.code==='CC072' ? 400 : Number(err?.status || err?.statusCode || 500);
  if(status>=500)try{console.error('CRM API error',{code:err?.code||'UNEXPECTED',path:req.path,method:req.method})}catch{}
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  return res.status(safeStatus).json({
    message: normalizeMessage(err),
    ...(/^[A-Z][A-Z0-9_]{2,60}$/.test(String(err?.code||''))?{code:err.code}:{}),
    ...(duplicate?{code:'DUPLICATE_PHONE'}:{}),
    ...(err?.code === 'CC070' ? { code: 'BUCKET_CAPACITY_REACHED' } : {}),
  });
}

module.exports = {
  notFound,
  errorHandler,
};
