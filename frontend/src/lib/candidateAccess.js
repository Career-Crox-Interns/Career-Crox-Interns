function lower(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeIndianPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  while (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length > 10) digits = digits.slice(-10);
  return digits;
}

export function shouldMaskPhone(user) {
  return lower(user?.role) === 'recruiter';
}

export function maskPhone(phone) {
  const digits = normalizeIndianPhone(phone);
  if (!digits) return '';
  if (digits.length < 8) return digits;
  return `${digits.slice(0, 4)}###${digits.slice(7)}`;
}

export function visiblePhone(user, phone, fallback = '-') {
  const digits = normalizeIndianPhone(phone);
  if (!digits) return fallback;
  return shouldMaskPhone(user) ? maskPhone(digits) : digits;
}

function openTelLink(clean) {
  const link = document.createElement('a');
  link.href = `tel:${clean}`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function postKeepAlive(path, payload = {}) {
  try {
    fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

export function dialCandidateWithLog(candidateId, phone) {
  const clean = normalizeIndianPhone(phone);
  if (!clean) return;
  postKeepAlive(`/api/candidates/${candidateId}/call`, {});
  window.setTimeout(() => openTelLink(clean), 70);
}

export function openWhatsAppWithLog(candidateId, phone, text = '') {
  const clean = normalizeIndianPhone(phone);
  if (!clean) return;
  postKeepAlive(`/api/candidates/${candidateId}/whatsapp-log`, { text });
  const url = `https://wa.me/91${clean}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}
