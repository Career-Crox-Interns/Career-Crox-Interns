export const DEFAULT_NOTE_TEMPLATES = [
  'Candidate interested. Asked to share updated resume.',
  'Candidate not picking the call. Follow-up required.',
  'Candidate asked for callback after 30 minutes.',
  'Candidate interview aligned. Need confirmation on time slot.',
  'Documents pending. Asked candidate to share today.',
  'Candidate salary expectation discussed and noted.',
];

export const DEFAULT_WHATSAPP_TEMPLATES = [
  'Hi, please share your updated resume here.',
  'Hi, your profile looks suitable. Are you available for a quick call today?',
  'Hi, please confirm your current location, salary and notice period.',
  'Hi, your interview is being planned. Please share your available slots.',
  'Hi, please check the JD and confirm if you want to proceed.',
  'Hi, please send your documents today to move the profile ahead.',
];

function read(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function write(key, items) {
  try { window.localStorage.setItem(key, JSON.stringify(items)); } catch {}
}

export function getNoteTemplates() {
  return read('career_crox_note_templates_v1', DEFAULT_NOTE_TEMPLATES);
}

export function getWhatsAppTemplates() {
  return read('career_crox_wa_templates_v1', DEFAULT_WHATSAPP_TEMPLATES);
}

export function addNoteTemplate(value) {
  const text = String(value || '').trim();
  if (!text) return getNoteTemplates();
  const next = Array.from(new Set([text, ...getNoteTemplates()]));
  write('career_crox_note_templates_v1', next);
  return next;
}

export function addWhatsAppTemplate(value) {
  const text = String(value || '').trim();
  if (!text) return getWhatsAppTemplates();
  const next = Array.from(new Set([text, ...getWhatsAppTemplates()]));
  write('career_crox_wa_templates_v1', next);
  return next;
}
