import {api,accountPrincipal} from './api';
export const DEFAULT_NOTE_TEMPLATES = [
  'Candidate interested. Asked to share updated resume.',
  'Candidate not picking the call. Follow-up required.',
  'Candidate asked for callback after 30 minutes.',
  'Candidate interview aligned. Need confirmation on time slot.',
  'Documents pending. Asked candidate to share today.',
  'Candidate salary expectation discussed and noted.',
];

export const DEFAULT_WHATSAPP_TEMPLATES = [
  {
    title: 'Resume request',
    body: '📄 HI {{first_name}},\nPlease share your resume, so that we can share the relevant JD with you, as discussed.\n\n*{{recruiter_name}}*\n*Career Crox*',
  },
  {
    title: '1st Reminder if not replied',
    body: '⏳ {{first_name}},\nWe did not get any revert from your side.\nWe handle 150+ candidates every day, so it will be tough for us to follow up if you do not reply.\n\n*{{recruiter_name}}*\n*Career Crox*',
  },
  {
    title: '2nd Reminder if not replied',
    body: '📌 HI {{first_name}},\nAre you ignoring us or occupied with something?\nLet me know so that we can move ahead or drop accordingly!!\n\n*{{recruiter_name}}*\n*Career Crox*',
  },
  {
    title: 'Resume Mentioned Career Crox',
    body: '📄 {{first_name}},\nThis is a reminder: we have not received your resume mentioned with Career Crox. Please share it ASAP so that we can share it with the hiring manager.\n\n*{{recruiter_name}}*\n*Career Crox*',
  },
  {
    title: 'Interview Reminder',
    body: '✅ HI {{first_name}},\nAll the very very best for your interview tomorrow.\nI shared some documents and questions; do read them properly, it may help you.\nI am logging out. If you have any query, ping me before 7:00 PM sharp. You have to reach before 10:30 AM.\nCall me before moving out for the office.\n\n*ALL THE BEST Again*\n\n*{{recruiter_name}}*\n*Career Crox*',
  },
  {
    title: 'Resume Request - Updated Resume',
    body: '📄 Hi {{first_name}},\n\nAs discussed, please share your updated resume.\n\nRegards,\n{{recruiter_name}}',
  },
  {
    title: 'Quick Call Availability',
    body: '📞 Hi {{first_name}},\n\nYour profile looks suitable. Are you available for a quick call today?\n\nRegards,\n{{recruiter_name}}',
  },
  {
    title: 'Profile Details Confirmation',
    body: '✅ Hi {{first_name}},\n\nPlease confirm your current location, salary and notice period.\n\nRegards,\n{{recruiter_name}}',
  },
  {
    title: 'Interview Slot Availability',
    body: '🗓️ Hi {{first_name}},\n\nYour interview is being planned. Please share your available slots.\n\nRegards,\n{{recruiter_name}}',
  },
  {
    title: 'JD Confirmation',
    body: '💼 Hi {{first_name}},\n\nPlease check the JD and confirm if you want to proceed.\n\nRegards,\n{{recruiter_name}}',
  },
  {
    title: 'Documents Request',
    body: '📑 Hi {{first_name}},\n\nPlease send your documents today to move the profile ahead.\n\nRegards,\n{{recruiter_name}}',
  },
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

function firstLine(value = '') {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
}

function normalizeWhatsAppTemplate(item, index = 0) {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const body = String(item.body || item.message || item.text || '').trim();
    const title = String(item.title || item.heading || item.name || firstLine(body) || `WhatsApp Preset ${index + 1}`).trim();
    return body ? { title, body, ...(item.id?{id:item.id}:{}), ...(item.revision?{revision:item.revision}:{}) } : null;
  }
  const body = String(item || '').trim();
  if (!body) return null;
  const title = firstLine(body).replace(/^[^\w{]+/, '').slice(0, 42) || `WhatsApp Preset ${index + 1}`;
  return { title, body };
}

function mergeWhatsAppTemplates(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const raw of Array.isArray(list) ? list : []) {
      const tpl = normalizeWhatsAppTemplate(raw, out.length);
      if (!tpl) continue;
      const key = `${tpl.title}::${tpl.body}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(tpl);
    }
  }
  return out;
}

export function getNoteTemplates() {
  return read('career_crox_note_templates_v1', DEFAULT_NOTE_TEMPLATES);
}

const sharedKey=()=>'cc878:shared-wa:'+accountPrincipal();
const stableId=t=>{let h=2166136261;for(const c of String(t.title+'::'+t.body))h=Math.imul(h^c.charCodeAt(0),16777619);return 'wa-custom-'+(h>>>0).toString(36);};
export function getWhatsAppTemplates(){
 const defaults=DEFAULT_WHATSAPP_TEMPLATES.map((t,i)=>({...t,id:'wa-default-'+i}));
 const custom=read('career_crox_wa_templates_v1',[]).map(normalizeWhatsAppTemplate).filter(Boolean).filter(t=>!defaults.some(d=>d.title===t.title&&d.body===t.body)).map(t=>({...t,id:t.id||stableId(t)}));
 const shared=read(sharedKey(),[]),byId=new Map([...defaults,...custom].map(t=>[t.id,t]));
 for(const item of shared)if(item.id&&item.body)byId.set(item.id,item);
 let order=[];try{order=JSON.parse(localStorage.getItem(sharedKey()+':order')||'[]');}catch{}const rank=new Map(order.map((id,i)=>[id,i]));return [...byId.values()].sort((a,b)=>(rank.get(a.id)??10000)-(rank.get(b.id)??10000));
}
export async function loadSharedWhatsAppTemplates(force=false){
 const result=await api.get('/api/message-templates/whatsapp',{cacheTtlMs:force?0:600000,allowStale:false,retries:0});write(sharedKey(),result.items||[]);if(Array.isArray(result.order)){write(sharedKey()+':order',result.order);write(sharedKey()+':order-revision',[result.order_revision||'']);}window.dispatchEvent(new Event('cc878-wa-catalog-loaded'));return getWhatsAppTemplates();
}
export async function editSharedWhatsAppTemplate(template){
 const result=await api.post('/api/message-templates/whatsapp',{id:template.id,title:template.title,body:template.body,expected_revision:template.revision||''},{retries:0});
 write(sharedKey(),result.items||[]);if(Array.isArray(result.order)){write(sharedKey()+':order',result.order);write(sharedKey()+':order-revision',[result.order_revision||'']);}window.dispatchEvent(new Event('cc878-wa-catalog-loaded'));return getWhatsAppTemplates();
}

export function addNoteTemplate(value) {
  const text = String(value || '').trim();
  if (!text) return getNoteTemplates();
  const next = Array.from(new Set([text, ...getNoteTemplates()]));
  write('career_crox_note_templates_v1', next);
  return next;
}

export function addWhatsAppTemplate(value) {
  const template = normalizeWhatsAppTemplate(value);
  if (!template) return getWhatsAppTemplates();
  const next = mergeWhatsAppTemplates([template], read('career_crox_wa_templates_v1', []), DEFAULT_WHATSAPP_TEMPLATES);
  write('career_crox_wa_templates_v1', next);
  return getWhatsAppTemplates();
}

export async function reorderSharedWhatsAppTemplates(order){
 const result=await api.post('/api/message-templates/whatsapp',{order,expected_order_revision:read(sharedKey()+':order-revision',[])[0]||''},{retries:0});
 write(sharedKey()+':order',result.order);write(sharedKey()+':order-revision',[result.order_revision||'']);window.dispatchEvent(new Event('cc878-wa-catalog-loaded'));return getWhatsAppTemplates();
}
