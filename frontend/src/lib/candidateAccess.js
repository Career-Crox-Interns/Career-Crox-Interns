function lower(value) {
  return String(value || '').trim().toLowerCase();
}

export function isInactiveProfile(row = {}) {
  const inactive = new Set(['not interested','not intrested','i am not interested','rejected','not responding','not response','no response','unresponsive','not looking','not looking for job','declined','cancelled','canceled']);
  return ['status','candidate_status','profile_status','approval_status','candidate_approval_status','interview_status'].some(key=>inactive.has(lower(row[key]).replace(/[^a-z0-9]+/g,' ').trim()));
}
if(typeof window!=='undefined')window.__CC882_PROFILE_INACTIVE__=isInactiveProfile;

export function normalizeIndianPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
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
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  try {
    const response=await fetch(path,{method:'POST',credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload||{}),signal:controller.signal});
    let data=null;try{data=await response.json();}catch(error){if(controller.signal.aborted)throw error;}
    if(!response.ok){const err=new Error(data?.message||data?.error||'Mobile app call failed');err.status=response.status;err.payload=data;throw err;}
    return data||{};
  } finally {clearTimeout(timeout);}
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
  const initialUser = localStorage.getItem('careerCroxCachedUser') || '';
  const clean = await resolveContactPhone(candidateId, phone, 'whatsapp');
  if (!clean || initialUser !== (localStorage.getItem('careerCroxCachedUser') || '')) return null;
  return window.CareerCroxWhatsApp.open(clean, text, {
    source: options.source || 'candidate_whatsapp',
    onLaunch: () => { if (candidateId) postKeepAlive(`/api/candidates/${encodeURIComponent(candidateId)}/whatsapp-log`, { text }); },
  });
}
