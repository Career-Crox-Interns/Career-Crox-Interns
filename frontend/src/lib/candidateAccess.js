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
  return false;
}

export function maskPhone(phone) {
  const digits = normalizeIndianPhone(phone);
  return digits || String(phone || '').trim();
}

function isMaskedValue(value) {
  return String(value || '').includes('#');
}

export function visiblePhone(user, phone, fallback = '-') {
  const digits = normalizeIndianPhone(phone);
  return digits || String(phone || '').trim() || fallback;
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

async function postJson(path, payload = {}) {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  let data = null;
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const err = new Error(data?.message || data?.error || 'Mobile app call failed');
    err.status = response.status;
    err.payload = data;
    throw err;
  }
  return data || {};
}

async function resolveContactPhone(candidateId, phone, channel = 'view') {
  const clean = normalizeIndianPhone(phone);
  if (clean && !isMaskedValue(phone)) return clean;
  try {
    const response = await fetch(`/api/candidates/${candidateId}/contact-access?channel=${encodeURIComponent(channel)}`, {
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Accept': 'application/json' },
    });
    if (!response.ok) return '';
    const data = await response.json();
    return normalizeIndianPhone(data?.phone || '');
  } catch {
    return '';
  }
}

export async function dialCandidateWithLog(candidateId, phone, meta = {}) {
  const clean = await resolveContactPhone(candidateId, phone, 'call');
  if (!clean) throw new Error('Phone number missing');
  // CC26_79: Browser phone dialer is permanently blocked. Every call must go through paired Android app so logs/recording/status are counted.
  const payload = await postJson('/api/dialer/manual-call', {
    phone: clean,
    candidate_id: candidateId,
    candidate_name: meta?.candidate_name || meta?.name || '',
    process: meta?.process || 'Candidate Profile',
    client: meta?.client || meta?.client_name || meta?.company || '',
    role: meta?.role || meta?.job_role || meta?.position || '',
    location: meta?.location || meta?.preferred_location || '',
    source: meta?.source || meta?.lead_source || 'crm_call_icon',
    profile_number: meta?.profile_number || meta?.profile_no || meta?.sr_no || '',
    imn_candidate_id: meta?.imn_candidate_id || meta?.imn_id || '',
    jd_name: meta?.jd_name || meta?.jd || '',
    note: meta?.note || 'Manual app call from CRM profile',
    next_call_gap_seconds: 0,
    instant_start: '1',
    command_source: 'crm_profile_call_icon_always_synced_instant',
    call_source: 'crm_profile_call_icon',
    source_mode: 'crm_profile_call_icon',
  });
  try {
    window.dispatchEvent(new CustomEvent('career-crox-mobile-call-requested', { detail: { candidate_id: candidateId, phone: clean, payload } }));
  } catch {}
  // CC26.136: Do NOT hit /api/candidates/:id/call after /api/dialer/manual-call.
  // That old keepalive created a second browser-side call log and made Dialed/Outgoing counts double.
  // The Android app + /api/mobile/call-start + /api/mobile/call-end is the only counting source.
  return payload;
}

export async function openWhatsAppWithLog(candidateId, phone, text = '', options = {}) {
  const preparedWindow = options?.preparedWindow || null;
  const targetName = String(options?.targetName || 'career_crox_whatsapp').trim() || 'career_crox_whatsapp';
  const clean = await resolveContactPhone(candidateId, phone, 'whatsapp');
  if (!clean) {
    try { if (preparedWindow && !preparedWindow.closed) preparedWindow.close(); } catch {}
    return null;
  }
  postKeepAlive(`/api/candidates/${candidateId}/whatsapp-log`, { text });
  const url = `https://wa.me/91${clean}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  try {
    if (preparedWindow && !preparedWindow.closed) {
      try { preparedWindow.opener = null; } catch {}
      preparedWindow.location.replace(url);
      try { preparedWindow.focus(); } catch {}
      return { url, window: preparedWindow };
    }
  } catch {}
  // CC26_389: reuse one WhatsApp browser tab instead of creating tab spam on every candidate.
  const opened = window.open(url, targetName);
  try { if (opened) opened.opener = null; } catch {}
  return { url, window: opened || null };
}
