import {createElement,useEffect,useState} from 'react';
// CC788: related modules consolidated; existing behavior preserved.
import { cachePrincipal, api } from './api';

// CC868: match the server without enforcing a fixed phone length or cropping digits.
export function normalizeCandidatePhoneInput(value) {
  let phone = String(value ?? '').normalize('NFKC').trim()
    .replace(/[\u0660-\u0669\u06F0-\u06F9\u0966-\u096F]/g, digit => {
      const code = digit.charCodeAt(0);
      return String(code - (code >= 0x0966 ? 0x0966 : code >= 0x06F0 ? 0x06F0 : 0x0660));
    })
    .replace(/[\s().\-\u2010-\u2015\u2212\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');
  if (/^\+91[0-9]+$/.test(phone)) phone = phone.slice(3);
  else if (/^91[0-9]{10}$/.test(phone)) phone = phone.slice(2);
  return phone;
}

// Stable IDs in displayed order: Shift-check adds an inclusive range, Shift-uncheck removes it.
export function updateRowSelection(currentIds, orderedIds, clickedId, options = {}) {
  const clean = (ids) => [...new Set((ids || []).map(id => String(id ?? '').trim()).filter(Boolean))];
  const current = clean(currentIds);
  const order = clean(orderedIds);
  const id = String(clickedId ?? '').trim();
  const targetIndex = order.indexOf(id);
  if (targetIndex < 0) return current;
  const anchorIndex = options.shiftKey ? order.indexOf(String(options.anchorId ?? '').trim()) : -1;
  const targets = anchorIndex < 0 ? [id] : order.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1);
  const selected = new Set(current);
  const checked = typeof options.checked === 'boolean' ? options.checked : !selected.has(id);
  for (const target of targets) {
    if (checked) selected.add(target);
    else selected.delete(target);
  }
  return [...selected];
}

// Preserved from lib/timeFormat.js
export const CRM_TIME_ZONE = 'Asia/Kolkata';

const CRM_LOCALE_GUARD_KEY = Symbol.for('career-crox.crm-ist-locale-guard');

export function installCrmIstLocaleGuard() {
  if (typeof Date === 'undefined' || Date.prototype[CRM_LOCALE_GUARD_KEY]) return;

  const patch = (methodName, forceTwelveHour) => {
    const original = Date.prototype[methodName];
    if (typeof original !== 'function') return;
    Object.defineProperty(Date.prototype, methodName, {
      configurable: true,
      writable: true,
      value: function careerCroxIstLocale(locale, options) {
        const safeLocale = locale == null || (Array.isArray(locale) && locale.length === 0) ? 'en-IN' : locale;
        const nextOptions = { ...(options || {}), timeZone: CRM_TIME_ZONE };
        if (forceTwelveHour) { delete nextOptions.hourCycle; nextOptions.hour12 = true; }
        return original.call(this, safeLocale, nextOptions);
      },
    });
  };

  patch('toLocaleString', true);
  patch('toLocaleTimeString', true);
  patch('toLocaleDateString', false);
  Object.defineProperty(Date.prototype, CRM_LOCALE_GUARD_KEY, { value: true, configurable: true });
  installLegacyIstControls();
}

const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: CRM_TIME_ZONE,
  day: '2-digit',
  month: 'long',
  year: 'numeric',
});

const TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: CRM_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: CRM_TIME_ZONE,
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

export function parseDateInput(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = String(value).trim();
  if (!text || text === '-' || text.toLowerCase() === 'n/a') return null;
  let normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text) ? text.replace(' ', 'T') : text;
  // CRM date-time values without an explicit offset are business-time values, so
  // interpret them as IST instead of the viewer/device timezone.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(normalized)) normalized += '+05:30';
  else if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized += 'T00:00:00+05:30';
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatCrmDate(value) {
  const date = parseDateInput(value);
  return date ? DATE_FORMATTER.format(date) : '-';
}

export function formatCrmTime(value) {
  const date = parseDateInput(value);
  return date ? TIME_FORMATTER.format(date).toUpperCase() : '-';
}

export function formatCrmDateTime(value) {
  const date = parseDateInput(value);
  if (!date) return '-';
  return `${DATE_FORMATTER.format(date)}, ${TIME_FORMATTER.format(date).toUpperCase()}`;
}

export default formatCrmDateTime;

export function crmDateParts(value = Date.now()) {
  const date = parseDateInput(value);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CRM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === '24' ? '00' : parts.hour,
    minute: parts.minute,
    second: parts.second,
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export function crmTodayYmd() {
  return crmDateParts(Date.now())?.ymd || '';
}

export function crmYmd(value) {
  return crmDateParts(value)?.ymd || '';
}

export function isSameCrmDay(value, base = Date.now()) {
  const valueKey = crmYmd(value);
  const baseKey = crmYmd(base);
  return Boolean(valueKey && baseKey && valueKey === baseKey);
}

export function isTodayCrmDay(value) {
  return isSameCrmDay(value, Date.now());
}

export function toCrmDateTimeLocalInput(value = Date.now()) {
  const parts = crmDateParts(value);
  if (!parts) return '';
  return `${parts.ymd}T${parts.hour}:${parts.minute}`;
}

export function crmDayBoundsUtcIso(ymd = crmTodayYmd()) {
  const match = String(ymd || '').match(/^(\\d{4})-(\\d{2})-(\\d{2})$/);
  if (!match) return { start: '', end: '' };
  const [, yy, mm, dd] = match;
  const startMs = Date.parse(`${yy}-${mm}-${dd}T00:00:00.000+05:30`);
  if (!Number.isFinite(startMs)) return { start: '', end: '' };
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(startMs + 24 * 60 * 60 * 1000).toISOString(),
  };
}

// Preserved from lib/viewState.js
function hasStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function readViewState(key, fallback) {
  if (!hasStorage()) return fallback;
  try {
    const raw = window.sessionStorage.getItem(`cc873-view:${cachePrincipal()}:${key}`);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) || {}) };
  } catch {
    return fallback;
  }
}

export function writeViewState(key, value) {
  if (!hasStorage()) return;
  try {
    window.sessionStorage.setItem(`cc873-view:${cachePrincipal()}:${key}`, JSON.stringify(value || {}));
  } catch {}
}

export function clearViewState(key) {
  if (!hasStorage()) return;
  try { window.sessionStorage.removeItem(`cc873-view:${cachePrincipal()}:${key}`); } catch {}
}

// Preserved from lib/notificationLink.js
export function parseMetadata(metadata) {
  if (!metadata) return {};
  if (typeof metadata === 'object') return metadata;
  try { return JSON.parse(metadata); } catch { return {}; }
}

function withTaskParam(path, taskId) {
  if (!taskId) return path;
  const joiner = String(path || '').includes('?') ? '&' : '?';
  return `${path}${joiner}task_id=${encodeURIComponent(taskId)}`;
}

export function notificationTarget(notification) {
  const meta = parseMetadata(notification?.metadata);
  if (meta.task_id && meta.open_path) return withTaskParam(meta.open_path, meta.task_id);
  if (meta.task_id) return `/tasks?task_id=${encodeURIComponent(meta.task_id)}`;
  if (meta.open_path) return meta.open_path;
  if (meta.candidate_id) return `/candidate/${meta.candidate_id}`;
  if (meta.thread_key) return `/chat?thread=${encodeURIComponent(meta.thread_key)}`;
  if (meta.interview_id) return '/interviews';
  if (meta.submission_id || meta.section === 'submissions') return '/submissions';
  const category = String(notification?.category || '').toLowerCase();
  if (category === 'task') return '/tasks';
  if (category === 'chat') return meta.thread_key ? `/chat?thread=${encodeURIComponent(meta.thread_key)}` : '/chat';
  if (category === 'interview') return '/interviews';
  if (category === 'submission' || category === 'approval') return '/submissions';
  return '/notifications';
}

// Preserved from lib/workspaceIntent.js
export async function workspaceIntentKey(kind,payload) {
  const bytes=new TextEncoder().encode(JSON.stringify(payload));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const signature=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  const storageKey=`cc787:intent:${cachePrincipal()}:${kind}`;
  let old;
  try{old=JSON.parse(localStorage.getItem(storageKey)||'null');}catch{}
  if(old?.signature===signature&&old?.key)return old.key;
  const key=crypto.randomUUID();
  try{localStorage.setItem(storageKey,JSON.stringify({signature,key}));}catch{}
  return key;
}

function evaluateJdMatch(candidate={},jd={}) {
  candidate=candidate&&typeof candidate==='object'&&!Array.isArray(candidate)?candidate:{};
  jd=jd&&typeof jd==='object'&&!Array.isArray(jd)?jd:{};
  const text=v=>String(v??'').trim(), low=v=>text(v).toLowerCase(), norm=v=>low(v).replace(/[^a-z0-9]/g,''), split=v=>Array.isArray(v)?v.map(text).filter(Boolean):text(v).split(/[,;|/]|\s+(?:or|and|&)\s+/).map(text).filter(Boolean);
  const result=(eligible,reasons,score=0,parts={})=>({eligible,reasons,score:Math.max(0,Math.min(100,Math.round(score))),parts});
  if(['closed','inactive','disabled'].includes(low(jd.jd_status||jd.status))) return result(false,['Process closed'],0);
  if(low(candidate.looking_for_job)==='no') return result(false,['Not looking for a job'],0);
  const reasons=[], parts={}; let score=0, weight=0;
  const add=(name,points,max,label)=>{parts[name]={points,max};score+=points;weight+=max;if(label)reasons.push(label)};
  const city=v=>{const ss=low(v).replace(/gurugram/g,'gurgaon');for(const c of ['noida','gurgaon','mumbai','pune','bangalore','bengaluru','chennai','hyderabad','delhi','kolkata','kanpur'])if(ss.includes(c))return c==='bengaluru'?'bangalore':c;return ss.replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();};
  const targetLocations=split(jd.preferred_location_rule||jd.location).map(city).filter(Boolean);
  const preferred=split(candidate.preferred_location).map(city).filter(Boolean), available=preferred.length?preferred:[city(candidate.location)].filter(Boolean);
  if(targetLocations.length){ if(!available.some(v=>targetLocations.includes(v))) return result(false,['Preferred location mismatch'],0); add('location',22,22,'Location matched'); } else add('location',12,12,'Location flexible');

  const qRank=v=>{const q=low(v);if(!q)return -1;if(/phd|doctorate/.test(q))return 5;if(/post[\s-]*graduate|\bpg\b|master|mba|mca|m\.?(?:a|com|sc|tech)\b/.test(q))return 4;if(/non[\s-]*graduate|under[\s-]*graduate|\bug\b/.test(q))return -1;if(/graduate|bachelor|b\.?a\b|b\.?com|b\.?sc|b\.?tech|btech|bca|bba|llb/.test(q))return 3;if(/12th|class\s*12|twelfth|higher secondary|senior secondary|hsc|intermediate/.test(q))return 2;if(/10th|class\s*10|tenth|matric|ssc/.test(q))return 1;return -1;};
  const explicitQ=[candidate.course_name,candidate.qualification,candidate.qualification_level].map(qRank);
  const candidateQ=Math.max(...explicitQ);
  const qualRule=low(jd.qualification_rule||jd.qualification_required);
  const qualificationRanks=qualRule.split(/[,;|]|\s+or\s+|\s*\/\s*/).map(v=>/non[\s-]*graduate|under[\s-]*graduate|\bug\b/.test(v)?2:qRank(v)).filter(v=>v>=0);
  const requiredQ=qualificationRanks.length?Math.min(...qualificationRanks):-1;
  if(requiredQ>=0&&candidateQ>=0&&candidateQ<requiredQ)return result(false,['Qualification below minimum'],Math.round((score/Math.max(weight+18,1))*100),parts);
  const qualificationKnown=requiredQ<0||candidateQ>=requiredQ;
  add('qualification',qualificationKnown?18:0,18,qualificationKnown?'Qualification meets minimum':'Qualification needs confirmation');

  const commRank=v=>{const q=low(v);if(/below[\s-]*average|poor|basic|weak/.test(q))return 0;if(/excellent|fluent/.test(q))return 3;if(/good/.test(q))return 2;if(/average|normal/.test(q))return 1;return -1;};
  const wantedComm=split(jd.communication_rule).map(commRank).filter(v=>v>=0);
  const requiredComm=wantedComm.length?Math.min(...wantedComm):-1,actualComm=commRank(candidate.communication_skill);
  if(requiredComm>=0&&actualComm>=0&&actualComm<requiredComm)return result(false,['Communication below requirement'],Math.round(score/Math.max(weight+18,1)*100),parts);
  const communicationKnown=requiredComm<0||actualComm>=requiredComm;
  add('communication',communicationKnown?18:0,18,communicationKnown?(actualComm>requiredComm?'Communication above minimum':'Communication meets minimum'):'Communication needs confirmation');

  const months=v=>{const ss=low(v),numbers=(ss.match(/\d+(?:\.\d+)?/g)||[]).map(Number);if(/fresher/.test(ss)||!numbers.length)return 0;if(/year|\byr/.test(ss)){let n=numbers[0]*12;if(/month/.test(ss)&&numbers.length>1)n+=numbers[1];return n;}if(/month/.test(ss))return numbers[0];return numbers[0];};
  const expRule=low(jd.relevant_experience_rule||jd.experience);
  const relevant=months(candidate.relevant_experience),total=months(candidate.total_experience||candidate.experience);
  const actualExp=jd.relevant_experience_rule?relevant:Math.max(relevant,total);
  const nums=(expRule.match(/\d+(?:\.\d+)?/g)||[]).map(Number), factor=/month/.test(expRule)?1:12;
  let minExp=text(jd.exp_min)!==''?Number(jd.exp_min):0; let maxExp=text(jd.exp_max)!==''?Number(jd.exp_max):Infinity;
  if(!(minExp>0)&&nums.length&&!/fresher/.test(expRule)) minExp=nums[0]*factor;
  const strictMax=/^(?:1|true|yes)$/i.test(text(jd.strict_experience_max));
  if(!Number.isFinite(maxExp) && strictMax && nums.length>1) maxExp=nums[1]*factor;
  if(actualExp<minExp) return result(false,[`Experience requires ${minExp}+ months`],0);
  if(strictMax&&Number.isFinite(maxExp)&&actualExp>maxExp) return result(false,['Experience exceeds JD maximum'],0);
  const expCloseness=minExp<=0?1:Math.min(1,actualExp/Math.max(1,minExp)); add('experience',Math.round(17*expCloseness),17,minExp? 'Experience requirement met':'Fresher/experienced eligible');

  const amount=v=>{const ss=low(v).replace(/,/g,''),nums=(ss.match(/\d+(?:\.\d+)?/g)||[]).map(Number),n=Math.max(0,...nums);return /lpa|lakh|lac/.test(ss)?n*100000/12:/\bk\b|\d\s*k/.test(ss)?n*1000:n;};
  const jdPay=amount(jd.in_hand_max||jd.in_hand_min||jd.salary_max||jd.salary_min||jd.salary), expected=amount(candidate.in_hand_salary||candidate.ctc_monthly||candidate.relevant_in_hand_range);
  const tolerance=5000;
  if(jdPay&&expected>jdPay+tolerance)return result(false,[`Salary exceeds this JD by more than ₹${tolerance.toLocaleString('en-IN')}`],Math.round(score/Math.max(weight+15,1)*100),parts);
  const salaryKnown=text(candidate.in_hand_salary)!==''||text(candidate.ctc_monthly)!=='';
  let salaryPoints=jdPay&&salaryKnown?15:0;if(jdPay&&expected){const gap=Math.abs(expected-jdPay)/Math.max(jdPay,1);salaryPoints=Math.max(2,Math.round(15*(1-Math.min(.85,gap*.65))));}
  add('salary',salaryPoints,15,jdPay&&salaryKnown?(expected<=jdPay?'Salary aligned':'Salary expectation above JD; lower fit score'):'Salary needs confirmation');

  const exactRules=[['career_gap','career_gap_rule','Career gap'],['all_details_sent','all_details_sent_rule','Details sent'],['documents_availability','documents_rule','Documents']];
  let extras=0, extrasMax=0;
  for(const [field,rule,label] of exactRules){const wanted=split(jd[rule]);if(!wanted.length)continue;extrasMax+=3;const doc=v=>['yes','available'].includes(norm(v))?'yes':norm(v);const n=field==='documents_availability'?doc:norm;if(wanted.some(v=>n(v)===n(candidate[field]))){extras+=3;reasons.push(label+' matched');}else reasons.push(label+' needs review');}
  if(extrasMax){score+=extras;weight+=extrasMax;parts.extra={points:extras,max:extrasMax};}
  const process=norm(jd.process_name||jd.process), candidateProcess=norm(candidate.process); if(process&&candidateProcess&&process===candidateProcess){score+=5;weight+=5;parts.process={points:5,max:5};reasons.push('Process matched');}
  const percent=weight?score/weight*100:100;
  return result(true,reasons.length?reasons:['Open opportunity'],percent,parts);
}
function buildJdFitSummary(candidate,jds=[]) {
 const available=(Array.isArray(jds)?jds:[]).filter(jd=>jd&&typeof jd==='object'&&jd.jd_id);
  const suggestions=available.map(jd=>({jd,match:evaluateJdMatch(candidate,jd)})).filter(x=>x.match.eligible).map(({jd,match})=>({jd_id:jd.jd_id,job_title:jd.job_title||jd.title||'',company:jd.company||'',process_name:jd.process_name||jd.process||'',location:jd.location||'',salary:jd.salary||[jd.in_hand_min,jd.in_hand_max].filter(v=>String(v??'').trim()).join(' - '),in_hand_min:jd.in_hand_min,in_hand_max:jd.in_hand_max,qualification_required:jd.qualification_required||jd.qualification_rule||'',communication_rule:jd.communication_rule||'',experience:jd.experience||[jd.exp_min,jd.exp_max].filter(v=>String(v??'').trim()).join('–')+' months',interview_mode:jd.interview_mode||'',working_days:jd.working_days||'',shift:jd.shift||'',has_pdf:jd.has_pdf,score:match.score,reasons:match.reasons.slice(0,6)})).sort((a,b)=>b.score-a.score||a.company.localeCompare(b.company)).slice(0,8);
 return{score:suggestions[0]?.score||0,label:suggestions.length?'Matched':'No matching JD',best_match:suggestions[0]||null,suggestions};
}

export {evaluateJdMatch,buildJdFitSummary};

// CC804: prepare once, then let the user choose a supported sharing action.
export async function openJdShareDialog(jd, initialCandidates = [], extraMessage = '') {
  if (!jd?.jd_id || jd.jd_id === 'NEW') throw new Error('Save this JD first.');
  document.getElementById('cc803-jd-share')?.remove();
  const root = document.createElement('div');
  root.id = 'cc803-jd-share'; root.className = 'cc803-share-backdrop';
  root.innerHTML = `<section class="cc803-share-panel" role="dialog" aria-modal="true" aria-labelledby="cc803-share-title"><header><div><small>CAREER CROX · JD SHARE</small><h2 id="cc803-share-title">Share JD with candidate</h2></div><button type="button" data-close aria-label="Close">×</button></header><p class="cc803-share-status" role="status">Preparing JD PDF and WhatsApp draft…</p><textarea class="cc803-share-message" rows="9" aria-label="JD message"></textarea><div class="cc803-share-actions"><button type="button" data-native disabled>Share PDF + text</button><a data-pdf hidden target="_blank" rel="noopener noreferrer">Open / download PDF</a><button type="button" data-copy disabled>Copy message</button></div><div class="cc803-share-hint">Search by candidate name, serial/Candidate ID or phone. Candidate chat opens directly with the JD message and PDF link ready; you only press Send.</div><label class="cc803-recipient-search">Recipients<input type="search" placeholder="Search name, Candidate ID / serial, or phone" aria-label="Search recipients"/></label><div class="cc803-share-recipients"></div><p class="cc803-share-error" role="alert"></p></section>`;
  document.body.append(root);
  const status = root.querySelector('[role="status"]'), error = root.querySelector('[role="alert"]');
  const message = root.querySelector('textarea'), native = root.querySelector('[data-native]');
  const pdfLink = root.querySelector('[data-pdf]'), copy = root.querySelector('[data-copy]');
  const recipientList = root.querySelector('.cc803-share-recipients'), search = root.querySelector('input');
  const selected = new Map(initialCandidates.filter(Boolean).map(c => [String(c.candidate_id || c.phone), c]));
  let prepared, file, closed = false, searchVersion = 0, searchTimer;
  const oldFocus = document.activeElement;
  function close() { closed = true; clearTimeout(searchTimer); document.removeEventListener('keydown', onKey); root.classList.add('cc819-closing');setTimeout(()=>root.remove(),140);oldFocus?.focus?.(); }
  function onKey(event) {
    if (event.key === 'Escape') close();
    if (event.key === 'Tab') {
      const items = [...root.querySelectorAll('button:not(:disabled),a:not([hidden]),input,textarea')];
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    }
  }
  document.addEventListener('keydown', onKey);
  root.querySelector('[data-close]').onclick = close;
  root.onclick = event => { if (event.target === root) close(); };
  root.querySelector('[data-close]').focus();
  const phone = c => { const digits = String(c?.phone || c?.number || '').replace(/\D/g, ''); return digits.length === 10 ? '91' + digits : digits; };
  function messageFor(c) {
    const greeting = c?.candidate_name || c?.full_name || c?.name;
    return [greeting ? `Hi ${greeting},` : '', message.value.trim(), prepared ? `JD PDF: ${new URL(prepared.pdf_url, window.location.origin).href}` : ''].filter(Boolean).join('\n\n');
  }
  function renderCandidates(results = []) {
    recipientList.replaceChildren();
    const all = new Map([...selected, ...results.map(c => [String(c.candidate_id || c.phone), c])]);
    for (const [key, candidate] of all) {
      const row = document.createElement('div'); row.className = 'cc803-share-recipient';
      const label = document.createElement('label'), tick = document.createElement('input'); tick.type = 'checkbox'; tick.checked = selected.has(key);
      const name = document.createElement('span'); name.textContent = [candidate.candidate_name || candidate.full_name || candidate.name || candidate.candidate_id, phone(candidate)].filter(Boolean).join(' · ');
      label.append(tick, name);
      tick.onchange = () => { if (tick.checked) selected.set(key, candidate); else selected.delete(key); row.classList.toggle('is-selected', tick.checked); action.hidden = !tick.checked; };
      row.classList.toggle('is-selected', tick.checked);
      const action = document.createElement('a'); action.textContent = 'Open candidate chat'; action.target = '_self'; action.className = 'cc803-wa-draft'; action.hidden = !tick.checked;
      function updateLink() { const number = phone(candidate); if (number.length < 10 || number.length > 15) { action.removeAttribute('href'); action.textContent = 'Phone unavailable'; } else action.href = window.CareerCroxWhatsApp.build(number,messageFor(candidate)); }
      updateLink(); action.onclick = () => { if (!prepared) return false; updateLink(); };
      row.append(label, action); recipientList.append(row);
    }
    if (!all.size) { const p = document.createElement('p'); p.textContent = 'Choose recipients to prepare their WhatsApp drafts.'; recipientList.append(p); }
  }
  search.oninput = () => {
    clearTimeout(searchTimer); const term = search.value.trim(), version = ++searchVersion;
    if (!term) { renderCandidates(); return; }
    searchTimer = setTimeout(async () => {
      try { const data = await api.get('/api/candidates?q=' + encodeURIComponent(term) + '&page_size=20', { cacheTtlMs: 0, retries: 0 }); if (!closed && version === searchVersion) renderCandidates(data.items || []); }
      catch (e) { if (!closed && version === searchVersion) error.textContent = e.message || 'Search failed. Try again.'; }
    }, 250);
  };
  renderCandidates();
  native.onclick = async () => {
    try { error.textContent = ''; await navigator.share({ title: jd.job_title || 'Career Crox JD', text: messageFor(selected.size === 1 ? [...selected.values()][0] : null), files: [file] }); }
    catch (e) { if (e.name !== 'AbortError') error.textContent = 'This browser could not share the file. Use the PDF link and WhatsApp draft below.'; }
  };
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(messageFor(null)); copy.textContent = 'Copied'; }
    catch { message.focus(); message.select(); error.textContent = 'Select and copy the message above.'; }
  };
  try {
    prepared = await api.post('/api/jds/' + encodeURIComponent(jd.jd_id) + '/share', {}, { timeoutMs: 20000, retries: 0 });
    if (!prepared?.ok || !prepared.pdf_url || !prepared.summary) throw new Error('PDF preparation failed.');
    if (closed) return;
    message.value = [prepared.summary,extraMessage].filter(Boolean).join('\n\n'); pdfLink.href = prepared.pdf_url; pdfLink.hidden = false; copy.disabled = false;
    status.textContent = 'Ready. Choose a candidate and open their WhatsApp chat.';
    renderCandidates();
    if (typeof navigator.canShare === 'function' && typeof navigator.share === 'function') {
      const url = new URL(prepared.pdf_url, location.origin);
      if (url.origin !== location.origin) throw new Error('The stored PDF must use this CRM server.');
      const response = await fetch(url.href, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('PDF could not be downloaded.');
      const blob = await response.blob(); if (blob.size > 6 * 1024 * 1024) throw new Error('PDF exceeds 6 MB.');
      file = new File([blob], prepared.filename || 'Career-Crox-JD.pdf', { type: 'application/pdf' });
      native.disabled = !navigator.canShare({ files: [file] });
    }
    if (native.disabled) native.textContent = 'File sharing unavailable in this browser';
  } catch (e) { if (!closed) { status.textContent = 'Could not prepare the PDF.'; error.textContent = e.message || 'Try again.'; } }
}


// Inbox counters change only for new incoming IDs; edits and own messages retain counts.
export function mergeChatInboxRows(rows,message,activeThread,viewer,focused,alreadyPushed=false){
 const key=String(message.thread_key||'team'),old=rows.find(row=>row.thread_key===key)||{thread_key:key};
 const own=String(message.sender_username||'')===String(viewer||'');
 const id=Number(message.id)||0,newMessage=!alreadyPushed&&id>Number(old.latest_message_id||0);
 const active=key===String(activeThread||'')&&focused;
 const unread=active?0:(Number(old.unread_count)||0)+(newMessage&&!own&&!message.deleted_at?1:0);
 const updated={...old,latest_message_id:Math.max(Number(old.latest_message_id)||0,id),last_read_id:active?Math.max(Number(old.last_read_id)||0,id):Number(old.last_read_id)||0,last_message_at:[old.last_message_at,message.created_at].filter(Boolean).sort().at(-1)||new Date().toISOString(),unread_count:unread};
 return [updated,...rows.filter(row=>row.thread_key!==key)].sort((a,b)=>String(b.last_message_at||'').localeCompare(String(a.last_message_at||'')));
}


function normalizePath(path = '') {
  return String(path || '').trim();
}

function parseFilenameFromDisposition(value = '', fallback = 'career-crox-export.xls') {
  const raw = String(value || '');
  const utfMatch = raw.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) return decodeURIComponent(utfMatch[1]).replace(/[\/:*?"<>|]+/g, '-');
  const basicMatch = raw.match(/filename="?([^";]+)"?/i);
  if (basicMatch?.[1]) return basicMatch[1].replace(/[\/:*?"<>|]+/g, '-');
  return fallback;
}

function downloadBlob(blob, filename) {
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1500);
}

function xhrDownload(url, { timeoutMs = 120000, onProgress, fallbackName = 'career-crox-export.xls' } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.withCredentials = true;
    xhr.responseType = 'blob';
    xhr.timeout = timeoutMs;

    xhr.onprogress = (event) => {
      if (!onProgress) return;
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(99, Math.max(1, Math.round((event.loaded / event.total) * 99))), 'Downloading file...');
      } else {
        onProgress(55, 'Downloading file...');
      }
    };

    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const filename = parseFilenameFromDisposition(xhr.getResponseHeader('Content-Disposition'), fallbackName);
        if (onProgress) onProgress(100, 'Download completed.');
        downloadBlob(xhr.response, filename);
        resolve(true);
        return;
      }
      let message = 'Export failed.';
      try {
        const text = await xhr.response.text();
        const parsed = JSON.parse(text);
        if (parsed?.message) message = parsed.message;
      } catch {}
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('Network error. Please retry.'));
    xhr.ontimeout = () => reject(new Error('Download timed out. Please retry.'));
    xhr.send();
  });
}

export async function openManagerProtectedExport(path, routeKey, fallbackMessage = 'Export failed.', options = {}) {
  const exportPath = normalizePath(path);
  if (!exportPath) throw new Error('Export path missing.');
  const password = window.prompt('Manager password required for export.');
  if (password === null) return false;
  if (!String(password || '').trim()) throw new Error('Manager password required.');
  const data = await api.post('/api/auth/export-access', { password, route_key: routeKey }, { timeoutMs: 20000 });
  const separator = exportPath.includes('?') ? '&' : '?';
  const protectedUrl = `${exportPath}${separator}export_token=${encodeURIComponent(data.export_token || '')}`;
  if (!options?.onProgress) {
    window.open(protectedUrl, '_blank', 'noopener,noreferrer');
    return true;
  }
  await xhrDownload(protectedUrl, {
    onProgress: options.onProgress,
    fallbackName: options.fallbackName || 'career-crox-export.xls',
    timeoutMs: Number(options.timeoutMs || 120000),
  });
  return true;
}

// CC59: Browser-only queue handoff. No backend request, no polling, no unrelated storage deletion.
// A compact snapshot avoids full CRM-row localStorage quota errors.
export const AUTO_DIALER_QUEUE_KEY = 'careerCroxAutoDialerQueue:v1';
export const AUTO_DIALER_QUEUE_CHANNEL = 'careerCroxAutoDialerQueueHandoff:v2';
const MAX_QUEUE_AGE_MS = 20 * 60 * 1000;
const MAX_ROWS = 200;
const asList = (value) => Array.isArray(value) ? value : [];
const clean = (value) => String(value ?? '').trim();
const phone = (value) => String(value ?? '').replace(/\D/g, '').slice(-10);
const compactText = (value, max = 600) => clean(value).slice(0, max);

export function compactDialerRow(source = {}, index = 0) {
  const id = clean(source.candidate_id || source.id);
  const number = phone(source.phone || source.number || source.mobile || source.candidate_phone);
  if (!id || !number) return null;
  return {
    candidate_id: id,
    phone: number,
    full_name: compactText(source.full_name || source.candidate_name || source.name || 'Candidate', 120),
    source_sr_no: compactText(source.source_sr_no || source.sr_no, 32),
    profile_number: compactText(source.profile_number || source.profile_no || source.source_sr_no, 40),
    imn_candidate_id: compactText(source.imn_candidate_id || source.imn_id, 50),
    process: compactText(source.process || source.jd_name || source.client_name, 150),
    last_note: compactText(source.last_note || source.notes || source.data_notes || source.follow_up_note, 400),
    interview_date: compactText(source.interview_date || source.interview_reschedule_date, 48),
    recruiter_name: compactText(source.recruiter_name, 100),
    call_enabled: source.call_enabled === '0' || source.call_enabled === false ? '0' : '1',
    queue_order: index + 1, dialer_sequence: index + 1, __dialer_order: index + 1,
  };
}

export function makeDialerQueuePayload(items, options = {}) {
  const seen = new Set();
  const rows = asList(items).slice(0, MAX_ROWS).map(compactDialerRow).filter((row) => {
    if (!row) return false;
    const key = `${row.candidate_id}:${row.phone}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((row, index) => ({...row, queue_order: index + 1, dialer_sequence: index + 1, __dialer_order: index + 1}));
  const firstId = clean(options.start_candidate_id || rows[0]?.candidate_id);
  return {
    version: 2,
    transfer_id: `DQ-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    source: compactText(options.source || 'Candidates', 60),
    owner_user_id: clean(options.owner_user_id),
    items: rows,
    start_candidate_id: rows.some(row => row.candidate_id === firstId) ? firstId : (rows[0]?.candidate_id || ''),
    created_at: new Date().toISOString(),
  };
}

export function validDialerQueue(payload, transferId = '', ownerUserId = '') {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.items) || !payload.items.length) return false;
  const stamp = Date.parse(payload.created_at || '');
  if (Number.isFinite(stamp) && (Date.now() - stamp > MAX_QUEUE_AGE_MS || stamp > Date.now() + 60000)) return false;
  if (transferId && clean(payload.transfer_id) !== clean(transferId)) return false;
  if (ownerUserId && payload.owner_user_id && clean(payload.owner_user_id) !== clean(ownerUserId)) return false;
  return true;
}

export function storeDialerQueue(payload) {
  const data = JSON.stringify(payload);
  let local = false;
  let session = false;
  try { window.localStorage.setItem(AUTO_DIALER_QUEUE_KEY, data); local = window.localStorage.getItem(AUTO_DIALER_QUEUE_KEY) === data; } catch {}
  try { window.sessionStorage.setItem(AUTO_DIALER_QUEUE_KEY, data); session = window.sessionStorage.getItem(AUTO_DIALER_QUEUE_KEY) === data; } catch {}
  return { local, session };
}

export function readDialerQueue(transferId = '', ownerUserId = '') {
  const candidates = [];
  for (const storage of ['localStorage', 'sessionStorage']) {
    try {
      const value = window[storage]?.getItem(AUTO_DIALER_QUEUE_KEY);
      if (value) {
        const candidate = JSON.parse(value);
        if (validDialerQueue(candidate, transferId, ownerUserId)) candidates.push(candidate);
      }
    } catch {}
  }
  candidates.sort((a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || ''));
  return candidates[0] || null;
}

// Source tab answers one handoff request from the newly opened tab.
export function serveDialerQueue(payload, lifetimeMs = 20000) {
  if (typeof BroadcastChannel === 'undefined') return null;
  let channel;
  try { channel = new BroadcastChannel(AUTO_DIALER_QUEUE_CHANNEL); } catch { return null; }
  let closed = false;
  const stop = () => {
    if (closed) return;
    closed = true;
    try { channel.close(); } catch {}
    window.clearTimeout(timer);
  };
  channel.onmessage = (event) => {
    const message = event?.data || {};
    if (message.type === 'REQUEST_QUEUE' && message.transfer_id === payload.transfer_id) {
      channel.postMessage({type: 'DELIVER_QUEUE', transfer_id: payload.transfer_id, payload});
    }
  };
  const timer = window.setTimeout(stop, lifetimeMs);
  return stop;
}

export function waitForDialerQueue(transferId, ownerUserId, onReceived) {
  if (!transferId || typeof BroadcastChannel === 'undefined') return () => {};
  let channel;
  try { channel = new BroadcastChannel(AUTO_DIALER_QUEUE_CHANNEL); } catch { return () => {}; }
  let closed = false;
  const stop = () => {
    if (closed) return;
    closed = true;
    try { channel.close(); } catch {}
    retryTimers.forEach((timer) => window.clearTimeout(timer));
  };
  channel.onmessage = (event) => {
    const message = event?.data || {};
    if (message.type !== 'DELIVER_QUEUE' || message.transfer_id !== transferId) return;
    if (!validDialerQueue(message.payload, transferId, ownerUserId)) return;
    storeDialerQueue(message.payload);
    onReceived(message.payload);
    stop();
  };
  const request = () => { if (!closed) channel.postMessage({type: 'REQUEST_QUEUE', transfer_id: transferId}); };
  const retryTimers = [window.setTimeout(request, 300), window.setTimeout(request, 900), window.setTimeout(request, 1800)];
  request();
  return stop;
}

// Only legacy, non-React time controls remain as native inputs. Keep the original
// input/value/events for their existing handlers, and add explicit AM/PM controls.
function installLegacyIstControls() {
  if (typeof document==='undefined'||window.__CC839_IST_CONTROLS__)return;
  window.__CC839_IST_CONTROLS__=true;
  const enhance=input=>{
    if(input.dataset.cc839Time||input.closest('[data-cc839-time]'))return;
    input.dataset.cc839Time='1';input.hidden=true;
    const group=document.createElement('span');group.className='cc839-time-input';group.dataset.cc839Time='legacy';
    const datetime=input.type==='datetime-local';
    const select=(label,values)=>{const node=document.createElement('select');node.setAttribute('aria-label',label+' · IST');for(const [value,text] of values){const option=document.createElement('option');option.value=value;option.textContent=text;node.append(option);}group.append(node);return node;};
    const date=datetime?document.createElement('input'):null;
    if(date){date.type='date';date.setAttribute('aria-label','Date · IST');group.append(date);}
    const hours=select('Hour',[['','Hour'],...Array.from({length:12},(_,i)=>[String(i+1),String(i+1).padStart(2,'0')])]);
    const minutes=select('Minute',Array.from({length:60},(_,i)=>[String(i).padStart(2,'0'),String(i).padStart(2,'0')]));
    const period=select('AM or PM',[['AM','AM'],['PM','PM']]);
    const zone=document.createElement('small');zone.textContent='IST';group.append(zone);
    const sync=()=>{const wall=datetime?(input.value?toCrmDateTimeLocalInput(input.value):''):input.value;const clock=datetime?wall.split('T')[1]:wall;const [h,m]=(clock||'').split(':');if(date)date.value=wall.slice(0,10);hours.value=h===undefined?'':String(Number(h)%12||12);minutes.value=m||'00';period.value=Number(h)>=12?'PM':'AM';for(const control of [date,hours,minutes,period].filter(Boolean))control.disabled=input.disabled;};
    const update=()=>{const clock=hours.value?String(Number(hours.value)%12+(period.value==='PM'?12:0)).padStart(2,'0')+':'+minutes.value:'';input.value=datetime?(date.value&&clock?date.value+'T'+clock:''):clock;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));};
    group.addEventListener('change',update);input.addEventListener('change',sync);
    input.after(group);sync();
  };
  const scan=node=>{if(node.nodeType!==1)return;if(node.matches('input[type="datetime-local"],input[type="time"]'))enhance(node);for(const input of node.querySelectorAll('input[type="datetime-local"],input[type="time"]'))enhance(input);};
  scan(document.body);
  const observer=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)scan(node);});
  observer.observe(document.body,{childList:true,subtree:true});
}

export function formatCrmClock(value) {
  const clock=String(value||'').match(/^(\d{1,2}):(\d{2})/);
  return clock?formatCrmTime('2000-01-01T'+clock[1].padStart(2,'0')+':'+clock[2]):'';
}
// CC865: collect the reason before any delete request. This dialog lives outside
// route/card renders, so background list updates cannot dismiss an unfinished note.
export function requestProfileDelete({candidateIds=[],name=''}={}) {
 if(!candidateIds.length)return Promise.resolve(null);
 if(document.getElementById('cc865-delete-overlay'))return Promise.resolve(null);
 return new Promise(resolve=>{
  const previous=document.activeElement,overlay=document.createElement('div');
  overlay.id='cc865-delete-overlay';overlay.innerHTML=`<style>
  #cc865-delete-overlay#cc865-delete-overlay#cc865-delete-overlay{position:fixed!important;inset:0!important;display:grid!important;place-items:center!important;padding:18px!important;background:#251b326b!important;backdrop-filter:blur(7px);z-index:2147483600!important}
  #cc865-delete-overlay#cc865-delete-overlay#cc865-delete-overlay .cc865-delete-dialog{width:min(460px,100%)!important;padding:23px!important;border:1px solid #ffffffd9!important;border-radius:21px!important;background:linear-gradient(135deg,#fffaf2,#fff0ed)!important;box-shadow:0 24px 80px #26193244!important;color:#402c32!important;font-family:system-ui,sans-serif!important}
  #cc865-delete-overlay#cc865-delete-overlay#cc865-delete-overlay h2{font-size:20px!important;line-height:1.3!important;color:#57333c!important;margin:0 0 10px!important}
  #cc865-delete-overlay#cc865-delete-overlay#cc865-delete-overlay p,#cc865-delete-overlay#cc865-delete-overlay#cc865-delete-overlay label{font-size:13px!important;line-height:1.5!important;color:#74565c!important;margin:0 0 13px!important;display:block!important}
  #cc865-delete-overlay#cc865-delete-overlay#cc865-delete-overlay textarea{display:block!important;width:100%!important;box-sizing:border-box!important;min-height:100px!important;padding:11px!important;border:1px solid #d9b7b4!important;border-radius:11px!important;background:#fffdf9!important;font:14px/1.5 system-ui!important;color:#412e32!important;-webkit-text-fill-color:#412e32!important;resize:vertical!important}
  #cc865-delete-overlay#cc865-delete-overlay#cc865-delete-overlay .cc865-delete-buttons{display:flex!important;justify-content:flex-end!important;gap:9px!important;margin-top:16px!important}
  #cc865-delete-overlay#cc865-delete-overlay#cc865-delete-overlay button{min-height:40px!important;padding:10px 15px!important;border:1px solid #dcbfb4!important;border-radius:10px!important;background:#fffaf1!important;color:#684638!important;-webkit-text-fill-color:#684638!important;font:650 13px system-ui!important;cursor:pointer!important;box-shadow:none!important}
  #cc865-delete-overlay#cc865-delete-overlay#cc865-delete-overlay button[data-confirm]{background:linear-gradient(120deg,#9c3750,#be574b)!important;color:white!important;-webkit-text-fill-color:white!important;border-color:#9c3750!important}
  #cc865-delete-overlay#cc865-delete-overlay#cc865-delete-overlay button:disabled{opacity:.45!important;cursor:not-allowed!important}
  #cc865-delete-overlay#cc865-delete-overlay#cc865-delete-overlay textarea:focus-visible{outline:2px solid #bb765b!important;outline-offset:2px!important}
  </style><section class="cc865-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="cc865-delete-title"><h2 id="cc865-delete-title">Move to Deleted Profiles?</h2><p data-candidate></p><p>The profile and history stay in the recycle bin. You can restore them later.</p><label for="cc865-delete-reason">Reason for deletion<textarea id="cc865-delete-reason" placeholder="Enter a reason (3–1,000 characters)" minlength="3" maxlength="1000"></textarea></label><div class="cc865-delete-buttons"><button type="button" data-cancel>Cancel</button><button type="button" data-confirm disabled>Move to recycle bin</button></div></section>`;
  overlay.querySelector('[data-candidate]').textContent=candidateIds.length===1?String(name||candidateIds[0])+' · '+candidateIds[0]:candidateIds.length+' selected profiles';
  const input=overlay.querySelector('textarea'),confirm=overlay.querySelector('[data-confirm]');
  let settled=false;
  const finish=value=>{if(settled)return;settled=true;document.removeEventListener('keydown',keys,true);window.removeEventListener('popstate',cancel);window.removeEventListener('career-crox-account-changed',cancel);window.removeEventListener('career-crox-access-changed',cancel);overlay.remove();previous?.focus?.({preventScroll:true});resolve(value);};
  const cancel=()=>finish(null);
  const keys=event=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancel();}else if(event.key==='Tab'){const controls=[...overlay.querySelectorAll('textarea,button:not(:disabled)')],index=controls.indexOf(document.activeElement);if(event.shiftKey&&index===0){event.preventDefault();controls.at(-1).focus();}else if(!event.shiftKey&&index===controls.length-1){event.preventDefault();controls[0].focus();}}};
  input.addEventListener('input',()=>{confirm.disabled=input.value.trim().length<3;});
  overlay.querySelector('[data-cancel]').onclick=cancel;
  confirm.onclick=()=>{const reason=input.value.trim();if(reason.length>=3&&reason.length<=1000)finish(reason);};
  document.addEventListener('keydown',keys,true);window.addEventListener('popstate',cancel);window.addEventListener('career-crox-account-changed',cancel);window.addEventListener('career-crox-access-changed',cancel);
  document.body.appendChild(overlay);requestAnimationFrame(()=>input.focus({preventScroll:true}));
 });
}


export function useCandidateFilterCatalog(user,project='') {
 const [data,setData]=useState({rows:[],users:[],total:0,complete:false,error:''});
 const load=(force=false)=>api.get('/api/candidates/filter-options?project_id='+encodeURIComponent(project)+(force?'&refresh=1':''),{cacheTtlMs:force?0:60000,allowStale:false}).then(d=>setData({...d,error:''})).catch(e=>setData(d=>({...d,error:e.message})));
 useEffect(()=>{let active=true;const fetchData=(force=false)=>api.get('/api/candidates/filter-options?project_id='+encodeURIComponent(project)+(force?'&refresh=1':''),{cacheTtlMs:force?0:60000,allowStale:false}).then(d=>{if(active)setData({...d,error:''})}).catch(e=>{if(active)setData(d=>({...d,error:e.message}))});
  setData({rows:[],users:[],total:0,complete:false,error:''});fetchData();let timer;
  const changed=()=>{clearTimeout(timer);timer=setTimeout(()=>fetchData(true),350)};
  window.addEventListener('career-crox-team-changed',changed);window.addEventListener('career-crox-workspace-change',changed);
  return()=>{active=false;clearTimeout(timer);window.removeEventListener('career-crox-team-changed',changed);window.removeEventListener('career-crox-workspace-change',changed)};
 },[user?.user_id,user?.__ccAccessRevision,project]);
 return {...data,refresh:()=>load(true)};
}

// Navigation state belongs to this signed-in principal and browser tab.
export function useSliceState(key, initial, reset=false) {
  const [value,setValue]=useState(()=>{const fallback=typeof initial==='function'?initial():initial;return reset?fallback:readViewState(key,{value:fallback}).value;});
  const update=next=>setValue(current=>{const resolved=typeof next==='function'?next(current):next;writeViewState(key,{value:resolved});return resolved;});
  return [value,update];
}
export const CRM_SORT_OPTIONS=[['default','Default order'],['latest_submission','Submission · newest first'],['oldest_submission','Submission · oldest first'],['salary_high','Salary · high to low'],['salary_low','Salary · low to high'],['comms_high','Communication · high to low'],['comms_low','Communication · low to high'],['experience_high','Experience · high to low'],['experience_low','Experience · low to high'],['name_asc','Name · A to Z'],['name_desc','Name · Z to A'],['created_newest','Created · newest first'],['created_oldest','Created · oldest first'],['updated_newest','Updated · newest first'],['updated_oldest','Updated · oldest first'],['interview_newest','Interview · newest first'],['interview_oldest','Interview · oldest first']];
export function CrmSortSelect({value='default',onChange}) {
 return createElement('label',{className:'cc873-sort'},createElement('span',null,'Sort by'),createElement('select',{'aria-label':'Sort by',value,onChange:e=>onChange(e.target.value)},CRM_SORT_OPTIONS.map(([key,label])=>createElement('option',{key,value:key},label))));
}
export function crmNumber(value,experience=false){
 const text=String(value??'').toLowerCase().replace(/,/g,'').trim();if(!text)return null;
 if(experience&&/fresher|no experience/.test(text))return 0;
 const match=text.match(/-?\d+(?:\.\d+)?/);if(!match)return null;
 const n=Number(match[0]);if(experience){const y=text.match(/(\d+(?:\.\d+)?)\s*(?:year|yr)/),m=text.match(/(\d+(?:\.\d+)?)\s*(?:month|mo)/);return y||m?Number(y?.[1]||0)+Number(m?.[1]||0)/12:n;}
 return n*(/\d\s*k\b/.test(text)?1000:1);
}
export function crmComms(value){const text=String(value||'').trim().toLowerCase();return /excellent|fluent/.test(text)?5:/very good/.test(text)?4.5:/good/.test(text)?4:/average|fair/.test(text)?3:/basic|below/.test(text)?2:/poor|weak/.test(text)?1:null;}
export function sortCrmRows(rows,sort='default'){
 if(sort==='default'||!CRM_SORT_OPTIONS.some(([key])=>key===sort))return rows;
 const field=/submission/.test(sort)?'submission':/salary/.test(sort)?'salary':/comms/.test(sort)?'comms':/experience/.test(sort)?'experience':sort.split('_')[0];
 const desc=/_high$|_newest$|_desc$|^latest_/.test(sort),get=r=>{if(field==='salary')return crmNumber(r.in_hand_salary??r.salary);if(field==='experience')return crmNumber(r.relevant_experience??r.total_experience,true);if(field==='comms')return crmComms(r.submission_comms||r.communication_skill||r.comms);if(field==='name')return String(r.full_name||r.candidate_name||'').trim().toLowerCase()||null;const raw=field==='submission'?(r.submitted_at||r.submission_date||r.approval_requested_at||r.submission_origin_at||r.created_at):field==='interview'?(r.interview_date_effective||r.interview_reschedule_date||r.interview_date):r[field+'_at'];const date=parseDateInput(raw);return date?date.getTime():null;};
 return [...rows].sort((a,b)=>{const x=get(a),y=get(b);if(x==null&&y!=null)return 1;if(y==null&&x!=null)return -1;const n=x==null?0:typeof x==='string'?x.localeCompare(y,'en',{numeric:true}):x-y;return (desc?-n:n)||String(a.submission_id||a.revenue_id||a.candidate_id||a.task_id||a.id||'').localeCompare(String(b.submission_id||b.revenue_id||b.candidate_id||b.task_id||b.id||''),'en',{numeric:true});});
}
