function nowIso() {
  return new Date().toISOString();
}

// Imported legacy rows may contain boolean, numeric or padded text flags.
function isActiveAccount(value) {
  return !['0','false','no','inactive','disabled','deleted'].includes(String(value ?? '1').trim().toLowerCase());
}
function normalizePresenceFlags(row) {
  if (!row) return row;
  const next={...row};
  for(const key of ['is_on_break','locked','meeting_joined'])if(Object.hasOwn(next,key))
    next[key]=['1','true','yes','on'].includes(String(next[key]??'').trim().toLowerCase())?'1':'0';
  return next;
}

function ymd() {
  return nowIso().slice(0, 10);
}

function clone(value) {
  if (value === null || value === undefined) return value;
  const seen = new WeakSet();
  try {
    return JSON.parse(JSON.stringify(value, (key, current) => {
      if (typeof current === 'bigint') return current.toString();
      if (Buffer.isBuffer(current)) return current.toString('base64');
      if (current && typeof current === 'object') {
        if (seen.has(current)) return undefined;
        seen.add(current);
      }
      return current;
    }));
  } catch {
    if (Array.isArray(value)) return value.map((item) => clone(item));
    if (typeof value === 'object') {
      const out = {};
      for (const [key, current] of Object.entries(value)) {
        if (current === value) continue;
        try { out[key] = clone(current); } catch { out[key] = String(current ?? ''); }
      }
      return out;
    }
    return value;
  }
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeIndianPhone(value) {
  let digits = digitsOnly(value);
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  return digits;
}

function phoneMatches(value, query) {
  const valueDigits = normalizeIndianPhone(value);
  const queryDigits = normalizeIndianPhone(query);
  if (!queryDigits || !valueDigits || queryDigits.length < 4 || valueDigits.length < 7) return false;
  return valueDigits.includes(queryDigits) || queryDigits.includes(valueDigits);
}

function normalizeLooseText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function candidateIdentityKey(row) {
  const phone = normalizeIndianPhone(row?.phone || '');
  const name = normalizeLooseText(row?.full_name || row?.name || '');
  const location = normalizeLooseText(row?.location || row?.preferred_location || '');
  const qualification = normalizeLooseText(row?.qualification_level || row?.qualification || '');
  if (phone && name) return `phone_name:${phone}|${name}`;
  if (phone) return `phone:${phone}`;
  if (name && location && qualification) return `name_loc_qual:${name}|${location}|${qualification}`;
  if (name && location) return `name_loc:${name}|${location}`;
  if (name) return `name:${name}`;
  return '';
}

function containsText(value, query) {
  const source = String(value || '').toLowerCase();
  const target = String(query || '').toLowerCase();
  if (source.includes(target)) return true;
  return phoneMatches(value, query);
}

// Notification keys must be unique across simultaneous users and server instances.
// Never allocate them by scanning a cached list (also avoids needless reads).
function nextId(prefix, rows, field) {
  if(field==='activity_id')return 'ACT-'+require('node:crypto').randomUUID();
  if (field === 'notification_id' || prefix === 'N') return 'N' + require('node:crypto').randomUUID().replaceAll('-', '');
  let max = 0;
  for (const row of rows) {
    const numeric = Number(String(row[field] || '').replace(/\D/g, ''));
    if (!Number.isNaN(numeric) && numeric > max) max = numeric;
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}


function splitCsvValues(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function recruiterCodeMatches(sourceValue, recruiterCode) {
  const target = String(recruiterCode || '').trim().toLowerCase();
  if (!target) return false;
  return splitCsvValues(sourceValue).some((item) => item.toLowerCase() === target);
}

function buildCsv(rows) {
  if (!rows.length) return 'no_data\n';
  const cols = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  return [cols.join(','), ...rows.map((row) => cols.map((col) => esc(row[col])).join(','))].join('\n');
}

function toNumber(value) {
  const n = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function calcExperienceRange(value) {
  const months = toNumber(value);
  if (!months) return 'Fresher';
  if (months <= 3) return '1 - 3 Month';
  if (months <= 6) return '4 - 6 Month';
  if (months <= 12) return '7 - 12 Month';
  if (months <= 18) return '1 - 1.5 Year';
  if (months <= 24) return '1.6 - 2 Year';
  if (months <= 30) return '2 - 2.5 Year';
  if (months <= 36) return '2.6 - 3 Year';
  if (months <= 42) return '3 - 3.5 Year';
  if (months <= 48) return '3.6 - 4 Year';
  if (months <= 54) return '4 - 4.5 Year';
  if (months <= 60) return '4.6 - 5 Year';
  return '5+ Year';
}

function calcSalaryRange(value) {
  const amount = toNumber(value);
  if (!amount) return '0';
  if (amount <= 15000) return '₹1K - ₹15K';
  if (amount <= 20000) return '₹16K - ₹20K';
  if (amount <= 25000) return '₹21K - ₹25K';
  if (amount <= 30000) return '₹26K - ₹30K';
  if (amount <= 35000) return '₹31K - ₹35K';
  if (amount <= 50000) return '₹35K - ₹50K';
  return '₹50K+';
}

module.exports = {
  isActiveAccount,
  normalizePresenceFlags,
  nowIso,
  ymd,
  clone,
  containsText,
  digitsOnly,
  normalizeIndianPhone,
  phoneMatches,
  normalizeLooseText,
  candidateIdentityKey,
  nextId,
  splitCsvValues,
  recruiterCodeMatches,
  buildCsv,
  toNumber,
  calcExperienceRange,
  calcSalaryRange,
};

function crmNumber(value,experience=false){
 const text=String(value??'').toLowerCase().replace(/,/g,'').trim();if(!text)return null;
 if(experience&&/fresher|no experience/.test(text))return 0;
 const match=text.match(/-?\d+(?:\.\d+)?/);if(!match)return null;
 const n=Number(match[0]);if(experience){const y=text.match(/(\d+(?:\.\d+)?)\s*(?:year|yr)/),m=text.match(/(\d+(?:\.\d+)?)\s*(?:month|mo)/);return y||m?Number(y?.[1]||0)+Number(m?.[1]||0)/12:n;}
 return n*(/\d\s*k\b/.test(text)?1000:1);
}
function crmComms(value){const text=String(value||'').trim().toLowerCase();return /excellent|fluent/.test(text)?5:/very good/.test(text)?4.5:/good/.test(text)?4:/average|fair/.test(text)?3:/basic|below/.test(text)?2:/poor|weak/.test(text)?1:null;}
const SORT_KEYS=new Set(['latest_submission','oldest_submission','salary_high','salary_low','comms_high','comms_low','experience_high','experience_low','name_asc','name_desc','created_newest','created_oldest','updated_newest','updated_oldest','interview_newest','interview_oldest']);
function crmSortValue(r,sort){
 if(sort.startsWith('salary_'))return crmNumber(r.in_hand_salary??r.salary);
 if(sort.startsWith('comms_'))return crmComms(r.submission_comms||r.communication_skill||r.comms);
 if(sort.startsWith('experience_'))return crmNumber(r.relevant_experience??r.total_experience,true);
 if(sort.startsWith('name_'))return String(r.full_name||r.candidate_name||'').trim().toLowerCase()||null;
 const raw=/submission/.test(sort)?r.submitted_at||r.submission_date||r.approval_requested_at||r.submission_origin_at||r.created_at:sort.startsWith('interview_')?r.interview_reschedule_date||r.interview_date:r[sort.split('_')[0]+'_at'];
 let text=String(raw||'');if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text))text+='+05:30';else if(/^\d{4}-\d{2}-\d{2}$/.test(text))text+='T00:00:00+05:30';const n=Date.parse(text);return Number.isFinite(n)?n:null;
}
function sortCrmRows(rows,sort){if(!SORT_KEYS.has(sort))return rows;const desc=/_high$|_newest$|_desc$|^latest_/.test(sort);return [...rows].sort((a,b)=>{const x=crmSortValue(a,sort),y=crmSortValue(b,sort);if(x==null&&y!=null)return 1;if(y==null&&x!=null)return -1;const n=x==null?0:typeof x==='string'?x.localeCompare(y,'en',{numeric:true}):x-y;return (desc?-n:n)||String(a.candidate_id||'').localeCompare(String(b.candidate_id||''),'en',{numeric:true});});}
function crmSortSql(columns,sort){
 if(!SORT_KEYS.has(sort))return '';
 const col=key=>columns.has(key)?`nullif(trim("${key}"),'')`:'null::text';
 const coalesce=keys=>`coalesce(${keys.map(col).join(',')},null::text)`;
 const salary=coalesce(['in_hand_salary']),experience=coalesce(['relevant_experience','total_experience']),comms=`lower(${coalesce(['communication_skill'])})`;
 const num=text=>`substring(replace(${text},',','') from '-?[0-9]+(?:\\.[0-9]+)?')::numeric`;
 let expr;
 if(sort.startsWith('salary_'))expr=`(${num(salary)} * case when lower(${salary}) ~ '[0-9]\\s*k\\y' then 1000 else 1 end)`;
 else if(sort.startsWith('experience_')){const t=`lower(${experience})`;expr=`case when ${t} ~ 'fresher|no experience' then 0 when ${t} ~ '[0-9]\\s*(year|yr|month|mo)' then coalesce(substring(${t} from '([0-9]+(?:\\.[0-9]+)?)\\s*(?:year|yr)')::numeric,0)+coalesce(substring(${t} from '([0-9]+(?:\\.[0-9]+)?)\\s*(?:month|mo)')::numeric,0)/12 else ${num(t)} end`;}
 else if(sort.startsWith('comms_'))expr=`case when ${comms} ~ 'excellent|fluent' then 5 when ${comms} ~ 'very good' then 4.5 when ${comms} ~ 'good' then 4 when ${comms} ~ 'average|fair' then 3 when ${comms} ~ 'basic|below' then 2 when ${comms} ~ 'poor|weak' then 1 else null end`;
 else if(sort.startsWith('name_'))expr=`lower(${col('full_name')})`;
 else {const raw=/submission/.test(sort)?coalesce(['submitted_at','submission_date','approval_requested_at','submission_origin_at','created_at']):sort.startsWith('interview_')?coalesce(['interview_reschedule_date','interview_date']):coalesce([sort.split('_')[0]+'_at']);expr=`public.crm_safe_instant(${raw})`;}
 return ` order by ${expr} ${/_high$|_newest$|_desc$|^latest_/.test(sort)?'desc':'asc'} nulls last,candidate_id asc`;
}
module.exports.sortCrmRows=sortCrmRows;module.exports.crmSortSql=crmSortSql;
// Normalize formatting, not identity: spaced letters and case variants compare alike.
function normalizeCandidateName(value){
 const groups=String(value??'').normalize('NFKC').trim().split(/\s{2,}/u);
 const words=groups.map(group=>{const parts=group.trim().split(/\s+/u);return parts.length>1&&parts.every(p=>/^\p{L}$/u.test(p))?parts.join(''):parts.join(' ');}).join(' ').replace(/\s+/gu,' ');
 return words.toLocaleLowerCase('en-IN').replace(/\p{L}[\p{L}\p{M}]*/gu,word=>word.charAt(0).toLocaleUpperCase('en-IN')+word.slice(1));
}
module.exports.normalizeCandidateName=normalizeCandidateName;
