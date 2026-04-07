import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { visiblePhone } from '../lib/candidateAccess';

const DEGREE_OPTIONS = ['NON - Graduate', 'Graduate'];
const PREFERRED_LOCATIONS = ['Noida', 'Gurgaon', 'Mumbai'];
const COMMUNICATION_OPTIONS = ['Average', 'Good', 'Excellent'];
const CAREER_GAP_OPTIONS = ['Fresher', 'Currently Working', '1 - 3 Month', '4 - 6 Month', '7 - 12 Month', '1 - 1.5 Year', '1.6 - 2 Year'];
const EXPERIENCE_RANGE_OPTIONS = ['Fresher', 'Currently Working', '0-1 year', '1-2 years', '2-3 years', '3-5 years', '5+ years'];
const SALARY_RANGE_OPTIONS = ['0-20k', '20k-30k', '30k-40k', '40k+'];
const DETAILS_SENT_OPTIONS = ['Pending', 'Completed'];
const DOCUMENTS_OPTIONS = ['Yes', 'No', 'Partially', 'Available'];

const DEFAULT_INSTRUCTION_ITEMS = [
  { title: 'Instruction 1', content: 'Explain role, salary, and working days clearly.' },
  { title: 'Instruction 2', content: 'Confirm candidate location comfort and communication level.' },
  { title: 'Instruction 3', content: 'Check salary expectation and relevant experience quickly.' },
  { title: 'Instruction 4', content: 'Tell the next step in one clean line before ending the call.' },
];

const DEFAULT_MATERIAL_ITEMS = [
  { order_no: 1, label: 'Location', message: 'Share office location, nearest landmark, and reporting details here.', link: '' },
  { order_no: 2, label: 'JD Details', message: 'Share short JD details in WhatsApp-ready format here.', link: '' },
  { order_no: 3, label: 'Interview Info', message: 'Share interview steps, date rules, and document checklist here.', link: '' },
];

const EMPTY_FORM = {
  job_title: '',
  company: '',
  process_name: '',
  location: '',
  preferred_location_rule: '',
  qualification_rule: '',
  communication_rule: '',
  career_gap_rule: '',
  documents_rule: '',
  all_details_sent_rule: '',
  relevant_experience_rule: '',
  relevant_salary_rule: '',
  salary_min: '',
  salary_max: '',
  exp_min: '',
  exp_max: '',
  pdf_url: '',
  jd_status: 'Open',
  notes: '',
  salary: '',
  experience: '',
  message_template: 'Hi {candidate_name}, sharing the {jd_name} opportunity. Please review the attached details and confirm if you are interested.',
  instruction_points: JSON.stringify(DEFAULT_INSTRUCTION_ITEMS),
  send_items: JSON.stringify(DEFAULT_MATERIAL_ITEMS),
};

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function splitCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBand(value) {
  return lower(value).replace(/[^a-z0-9]+/g, '');
}

function sameish(a, b) {
  const first = normalizeBand(a);
  const second = normalizeBand(b);
  if (!first || !second) return false;
  return first === second || first.includes(second) || second.includes(first);
}

function asNumber(value) {
  const cleaned = String(value || '').replace(/,/g, '');
  const match = cleaned.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function amountFromText(value) {
  const raw = lower(value).replace(/,/g, '');
  const num = asNumber(raw);
  if (!num) return 0;
  if (raw.includes('lpa') || raw.includes('lac') || raw.includes('lakh')) return Math.round((num * 100000) / 12);
  if (raw.includes('k') && num < 1000) return num * 1000;
  return num;
}

function monthsFromText(value) {
  const raw = lower(value);
  const num = asNumber(raw);
  if (!num) return 0;
  if (raw.includes('month')) return Math.round(num);
  if (raw.includes('year') || raw.includes('yr')) return Math.round(num * 12);
  return Math.round(num * 12);
}

function deriveNumericRange(rawValue, minValue, maxValue, mode = 'amount') {
  let min = Number(minValue || 0) || 0;
  let max = Number(maxValue || 0) || 0;
  if (min || max) return { min, max };
  const numbers = String(rawValue || '').match(/\d+(?:\.\d+)?/g) || [];
  if (!numbers.length) return { min: 0, max: 0 };
  const parsed = numbers.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  if (!parsed.length) return { min: 0, max: 0 };
  if (mode === 'months') {
    const raw = lower(rawValue);
    min = parsed[0] || 0;
    max = parsed[1] || parsed[0] || 0;
    if (!raw.includes('month')) {
      min *= 12;
      max *= 12;
    }
    return { min, max };
  }
  min = parsed[0] || 0;
  max = parsed[1] || parsed[0] || 0;
  return { min, max };
}

function parseInstructionItems(value) {
  if (Array.isArray(value)) {
    return value.map((item, idx) => {
      if (typeof item === 'string') return { title: `Instruction ${idx + 1}`, content: item.trim() };
      return {
        title: String(item?.title || `Instruction ${idx + 1}`).trim(),
        content: String(item?.content || item?.message || '').trim(),
      };
    }).filter((item) => item.title || item.content);
  }
  try {
    const parsed = JSON.parse(String(value || '[]'));
    if (Array.isArray(parsed)) return parseInstructionItems(parsed);
  } catch {}
  return String(value || '')
    .split(/\r?\n/)
    .map((item, idx) => ({ title: `Instruction ${idx + 1}`, content: String(item || '').trim() }))
    .filter((item) => item.content);
}

function serializeInstructionItems(items) {
  const clean = parseInstructionItems(items).map((item, idx) => ({
    title: String(item?.title || `Instruction ${idx + 1}`).trim(),
    content: String(item?.content || '').trim(),
  })).filter((item) => item.title || item.content);
  return JSON.stringify(clean);
}

function parseSendItems(value) {
  if (Array.isArray(value)) {
    return value.map((item, idx) => ({
      order_no: Number(item?.order_no || idx + 1),
      label: String(item?.label || `Send Material ${idx + 1}`).trim(),
      message: String(item?.message || item?.content || '').trim(),
      link: String(item?.link || '').trim(),
    })).filter((item) => item.label || item.message || item.link);
  }
  try {
    const parsed = JSON.parse(String(value || '[]'));
    if (Array.isArray(parsed)) return parseSendItems(parsed);
  } catch {}
  return String(value || '')
    .split(/\r?\n/)
    .map((line, idx) => {
      const [label, message, link] = String(line || '').split('|').map((part) => String(part || '').trim());
      if (!label && !message && !link) return null;
      return { order_no: idx + 1, label: label || `Send Material ${idx + 1}`, message: message || '', link: link || '' };
    })
    .filter(Boolean);
}

function serializeSendItems(items) {
  const clean = parseSendItems(items).map((item, idx) => ({
    order_no: idx + 1,
    label: String(item?.label || `Send Material ${idx + 1}`).trim(),
    message: String(item?.message || '').trim(),
    link: String(item?.link || '').trim(),
  })).filter((item) => item.label || item.message || item.link);
  return JSON.stringify(clean);
}

function normalizeCandidateDocs(value) {
  const raw = normalizeBand(value);
  if (raw === 'yes' || raw === 'available') return 'available';
  if (raw === 'partially' || raw === 'partial') return 'partially';
  if (raw === 'no') return 'no';
  return raw;
}

function candidateMatchesMultiRule(candidateValue, ruleValue, mode = 'contains') {
  const candidateValues = Array.isArray(candidateValue) ? candidateValue : [candidateValue];
  const rules = splitCsv(ruleValue);
  if (!rules.length) return true;
  return rules.some((rule) => candidateValues.some((item) => {
    if (!String(item || '').trim()) return false;
    if (mode === 'exact') return sameish(item, rule);
    return sameish(item, rule) || lower(item).includes(lower(rule)) || lower(rule).includes(lower(item));
  }));
}

function qualifies(candidate, jd) {
  if (!candidate || !jd) return { eligible: false, reasons: [] };
  if (['closed', 'inactive'].includes(lower(jd.jd_status))) return { eligible: false, reasons: ['Process closed'] };
  const reasons = [];

  const candidateLocations = [candidate.location, ...splitCsv(candidate.preferred_location)].filter(Boolean);
  if (!candidateMatchesMultiRule(candidateLocations, jd.preferred_location_rule || jd.location, 'contains')) return { eligible: false, reasons: ['Preferred location mismatch'] };
  if (splitCsv(jd.preferred_location_rule || jd.location).length) reasons.push('Location fit');

  const qualificationText = candidate.qualification_level || candidate.qualification || '';
  if (!candidateMatchesMultiRule(qualificationText, jd.qualification_rule, 'contains')) return { eligible: false, reasons: ['Qualification mismatch'] };
  if (splitCsv(jd.qualification_rule).length) reasons.push('Qualification fit');

  const communicationText = candidate.communication_skill || '';
  if (!candidateMatchesMultiRule(communicationText, jd.communication_rule, 'contains')) return { eligible: false, reasons: ['Communication mismatch'] };
  if (splitCsv(jd.communication_rule).length) reasons.push('Communication fit');

  const careerGapText = candidate.career_gap || '';
  if (!candidateMatchesMultiRule(careerGapText, jd.career_gap_rule, 'exact')) return { eligible: false, reasons: ['Career gap mismatch'] };
  if (splitCsv(jd.career_gap_rule).length) reasons.push('Career gap fit');

  const docRules = splitCsv(jd.documents_rule);
  if (docRules.length) {
    const docOk = docRules.some((rule) => normalizeCandidateDocs(candidate.documents_availability) === normalizeCandidateDocs(rule));
    if (!docOk) return { eligible: false, reasons: ['Documents mismatch'] };
    reasons.push('Documents fit');
  }

  if (!candidateMatchesMultiRule(candidate.all_details_sent || '', jd.all_details_sent_rule, 'exact')) return { eligible: false, reasons: ['Details sent mismatch'] };
  if (splitCsv(jd.all_details_sent_rule).length) reasons.push('Details fit');

  const experienceRules = splitCsv(jd.relevant_experience_rule);
  if (experienceRules.length) {
    const candidateRange = candidate.relevant_experience_range || candidate.relevant_experience || candidate.total_experience || '';
    const expOk = experienceRules.some((rule) => sameish(candidateRange, rule));
    if (!expOk) return { eligible: false, reasons: ['Experience range mismatch'] };
    reasons.push('Experience band fit');
  }

  const salaryRules = splitCsv(jd.relevant_salary_rule);
  if (salaryRules.length) {
    const candidateRange = candidate.relevant_in_hand_range || candidate.in_hand_salary || candidate.ctc_monthly || '';
    const salaryOk = salaryRules.some((rule) => sameish(candidateRange, rule));
    if (!salaryOk) return { eligible: false, reasons: ['Salary range mismatch'] };
    reasons.push('Salary band fit');
  }

  const salaryAmount = amountFromText(candidate.in_hand_salary || candidate.ctc_monthly || '');
  const salaryRange = deriveNumericRange(jd.salary || '', jd.salary_min, jd.salary_max, 'amount');
  if ((salaryRange.min || salaryRange.max) && salaryAmount) {
    if (salaryRange.min && salaryAmount < salaryRange.min) return { eligible: false, reasons: ['Salary below JD rule'] };
    if (salaryRange.max && salaryAmount > salaryRange.max) return { eligible: false, reasons: ['Salary above JD rule'] };
    reasons.push('Salary value fit');
  }

  const experienceMonths = monthsFromText(candidate.relevant_experience || candidate.total_experience || candidate.experience || '');
  const expRange = deriveNumericRange(jd.experience || '', jd.exp_min, jd.exp_max, 'months');
  if ((expRange.min || expRange.max) && experienceMonths) {
    if (expRange.min && experienceMonths < expRange.min) return { eligible: false, reasons: ['Experience below JD rule'] };
    if (expRange.max && experienceMonths > expRange.max) return { eligible: false, reasons: ['Experience above JD rule'] };
    reasons.push('Experience value fit');
  }

  if (jd.process_name || jd.job_title) reasons.push('Process mapped');
  return { eligible: true, reasons };
}

function interpolate(template, candidate, jd) {
  return String(template || '')
    .replaceAll('{candidate_name}', candidate?.full_name || 'Candidate')
    .replaceAll('{candidate_number}', candidate?.phone || '')
    .replaceAll('{jd_name}', jd?.job_title || 'JD')
    .replaceAll('{company}', jd?.company || '')
    .replaceAll('{process}', jd?.process_name || jd?.job_title || '');
}

function openWhatsApp(candidate, body) {
  const phone = String(candidate?.phone || '').replace(/\D/g, '').slice(-10);
  const url = phone ? `https://wa.me/91${phone}?text=${encodeURIComponent(body)}` : `https://wa.me/?text=${encodeURIComponent(body)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function ruleCount(jd) {
  return [
    ...splitCsv(jd.preferred_location_rule),
    ...splitCsv(jd.qualification_rule),
    ...splitCsv(jd.communication_rule),
    ...splitCsv(jd.career_gap_rule),
    ...splitCsv(jd.documents_rule),
    ...splitCsv(jd.all_details_sent_rule),
    ...splitCsv(jd.relevant_experience_rule),
    ...splitCsv(jd.relevant_salary_rule),
    jd.salary_min,
    jd.salary_max,
    jd.exp_min,
    jd.exp_max,
  ].filter(Boolean).length;
}

function formatRuleSummary(value) {
  const list = splitCsv(value);
  if (!list.length) return 'Not set';
  if (list.length === 1) return list[0];
  return `${list.length} selected`;
}

function toggleCsvValue(current, value) {
  const list = splitCsv(current);
  if (list.includes(value)) return list.filter((item) => item !== value).join(', ');
  return [...list, value].join(', ');
}

function ensureOption(options, value) {
  const clean = options.map((item) => String(item || '').trim()).filter(Boolean);
  const current = String(value || '').trim();
  if (current && !clean.includes(current)) clean.push(current);
  return clean;
}

function RuleGroup({ label, value, options, onChange, hint }) {
  const mergedOptions = ensureOption(options, value);
  const selected = splitCsv(value);
  return (
    <div className="jd-rule-card">
      <div className="jd-rule-top">
        <div>
          <div className="jd-rule-title">{label}</div>
          <div className="helper-text">{hint || 'Select one or more options.'}</div>
        </div>
        <span className="metric-mini-chip filters tiny-chip">{selected.length || 0}</span>
      </div>
      <div className="choice-chip-row compact-row top-gap-small">
        {mergedOptions.map((option) => (
          <button
            key={option}
            type="button"
            className={`choice-chip bounceable ${selected.includes(option) ? 'active' : ''}`}
            onClick={() => onChange(toggleCsvValue(value, option))}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="jd-rule-foot top-gap-small">
        <select
          className="choice-more-select selected"
          value=""
          onChange={(e) => {
            if (e.target.value === '__add_new__') {
              const custom = window.prompt(`Add new ${label}`, '');
              if (custom && custom.trim()) onChange(toggleCsvValue(value, custom.trim()));
            } else if (e.target.value) {
              onChange(toggleCsvValue(value, e.target.value));
            }
          }}
        >
          <option value="">More options</option>
          {mergedOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          <option value="__add_new__">Add New...</option>
        </select>
        <div className="helper-text">{formatRuleSummary(value)}</div>
      </div>
    </div>
  );
}

function MetricCard({ tone, label, value, subtext }) {
  return (
    <div className={`metric-card colorful-card jd-tone-card ${tone}`}>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <small>{subtext}</small>
    </div>
  );
}

function WhatsAppIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M19.1 4.8A9.7 9.7 0 0 0 3.8 16.7L2.7 21.3l4.8-1.1a9.7 9.7 0 0 0 4.5 1.1h.1a9.7 9.7 0 0 0 7-16.5Zm-7 14.8h-.1a7.9 7.9 0 0 1-4-1.1l-.3-.2-2.8.7.7-2.7-.2-.3a7.9 7.9 0 1 1 6.7 3.6Z" fill="currentColor" /><path d="M16.5 13.8c-.2-.1-1.3-.7-1.5-.7-.2-.1-.3-.1-.5.1l-.4.5c-.1.2-.3.2-.5.1-.2-.1-.8-.3-1.5-1a5.5 5.5 0 0 1-1-1.2c-.1-.2 0-.3.1-.4l.3-.4.2-.4c.1-.1 0-.3 0-.4l-.7-1.6c-.2-.4-.3-.3-.5-.3h-.4c-.2 0-.4.1-.6.3-.2.2-.8.8-.8 1.9 0 1 .8 2.1.9 2.3.1.1 1.7 2.6 4 3.6 2.4 1 2.4.7 2.8.7.4-.1 1.3-.5 1.5-1 .2-.4.2-.9.2-1 0-.1-.2-.2-.4-.3Z" fill="currentColor" /></svg>;
}

export default function JDsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const candidateId = searchParams.get('candidateId') || '';
  const focusId = searchParams.get('focus') || '';
  const standalone = searchParams.get('standalone') === '1';
  const manager = ['admin', 'manager'].includes(lower(user?.role));
  const [rows, setRows] = useState([]);
  const [candidate, setCandidate] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('Pending');
  const [feedbackNote, setFeedbackNote] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState('');

  const instructionItems = useMemo(() => parseInstructionItems(form.instruction_points), [form.instruction_points]);
  const materialItems = useMemo(() => parseSendItems(form.send_items), [form.send_items]);

  async function load() {
    const data = await api.get('/api/jds');
    const items = data.items || [];
    setRows(items);
    const preferredId = focusId || selectedId || items[0]?.jd_id || '';
    setSelectedId((current) => {
      if (editingId === 'NEW') return current;
      if (current && items.some((item) => String(item.jd_id) === String(current))) return current;
      return preferredId;
    });
    if (candidateId) {
      const candidateData = await api.get(`/api/candidates/${candidateId}`);
      setCandidate(candidateData.item || null);
    } else {
      setCandidate(null);
    }
  }

  useEffect(() => {
    load().catch((err) => setMessage(err.message || 'JD Centre load failed'));
  }, [candidateId]);

  useEffect(() => {
    if (focusId) setSelectedId(focusId);
  }, [focusId]);

  const decorated = useMemo(() => rows.map((row) => ({
    ...row,
    instruction_points_list: parseInstructionItems(row.instruction_points_list || row.instruction_points),
    send_items_list: parseSendItems(row.send_items_list || row.send_items),
    match: qualifies(candidate, row),
    active_rule_count: ruleCount(row),
  })), [rows, candidate]);

  const visibleRows = useMemo(() => candidate ? decorated.filter((row) => row.match.eligible) : decorated, [decorated, candidate]);
  const selected = useMemo(() => decorated.find((row) => String(row.jd_id) === String(selectedId)) || visibleRows[0] || decorated[0] || null, [decorated, visibleRows, selectedId]);

  useEffect(() => {
    if (!selected || editingId === 'NEW' || editingId === selected.jd_id) return;
    setForm({
      job_title: selected.job_title || '',
      company: selected.company || '',
      process_name: selected.process_name || '',
      location: selected.location || '',
      preferred_location_rule: selected.preferred_location_rule || '',
      qualification_rule: selected.qualification_rule || '',
      communication_rule: selected.communication_rule || '',
      career_gap_rule: selected.career_gap_rule || '',
      documents_rule: selected.documents_rule || '',
      all_details_sent_rule: selected.all_details_sent_rule || '',
      relevant_experience_rule: selected.relevant_experience_rule || '',
      relevant_salary_rule: selected.relevant_salary_rule || '',
      salary_min: selected.salary_min || '',
      salary_max: selected.salary_max || '',
      exp_min: selected.exp_min || '',
      exp_max: selected.exp_max || '',
      pdf_url: selected.pdf_url || '',
      jd_status: selected.jd_status || 'Open',
      notes: selected.notes || '',
      salary: selected.salary || '',
      experience: selected.experience || '',
      message_template: selected.message_template || EMPTY_FORM.message_template,
      instruction_points: serializeInstructionItems(selected.instruction_points_list || []),
      send_items: serializeSendItems(selected.send_items_list || []),
    });
  }, [selected, editingId]);

  const displayJd = useMemo(() => {
    if (editingId === 'NEW') {
      return {
        ...form,
        jd_id: 'NEW',
        instruction_points_list: instructionItems,
        send_items_list: materialItems,
        active_rule_count: ruleCount(form),
      };
    }
    return selected;
  }, [editingId, form, instructionItems, materialItems, selected]);

  const summary = useMemo(() => {
    const openCount = decorated.filter((row) => !['closed', 'inactive'].includes(lower(row.jd_status))).length;
    return {
      total: decorated.length,
      open: openCount,
      matched: candidate ? visibleRows.length : decorated.length,
      instructions: displayJd?.instruction_points_list?.length || instructionItems.length || 0,
      materials: displayJd?.send_items_list?.length || materialItems.length || 0,
    };
  }, [decorated, visibleRows, candidate, displayJd, instructionItems.length, materialItems.length]);

  async function saveJd() {
    setSaving(true);
    setMessage('');
    try {
      const payload = {
        ...form,
        salary: form.salary || ([form.salary_min, form.salary_max].filter(Boolean).join('-')),
        experience: form.experience || ([form.exp_min, form.exp_max].filter(Boolean).join('-')),
        instruction_points: parseInstructionItems(form.instruction_points),
        send_items: parseSendItems(form.send_items),
      };
      const data = editingId && editingId !== 'NEW'
        ? await api.put(`/api/jds/${editingId}`, payload)
        : await api.post('/api/jds', payload);
      setEditingId('');
      setSelectedId(data.item?.jd_id || selectedId);
      setMessage(editingId && editingId !== 'NEW' ? 'JD updated.' : 'JD created.');
      await load();
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (data.item?.jd_id) next.set('focus', data.item.jd_id);
        return next;
      });
    } catch (err) {
      setMessage(err.message || 'JD save failed');
    } finally {
      setSaving(false);
    }
  }

  async function sendFeedback(nextStatus) {
    if (!candidate || !selected) return;
    setFeedbackStatus(nextStatus);
    try {
      await api.post(`/api/jds/${selected.jd_id}/feedback`, {
        candidate_id: candidate.candidate_id,
        feedback_status: nextStatus,
        feedback_note: feedbackNote,
      });
      const noteBody = [`JD Response: ${selected.job_title || 'JD'}`, `Status: ${nextStatus}`, feedbackNote ? `Note: ${feedbackNote}` : ''].filter(Boolean).join(' | ');
      await api.post(`/api/candidates/${candidate.candidate_id}/notes`, { body: noteBody, note_type: 'public' }).catch(() => {});
      setMessage(`Candidate marked as ${nextStatus}. Note saved.`);
    } catch (err) {
      setMessage(err.message || 'Feedback save failed');
    }
  }

  function updateInstructionItems(items) {
    setForm((prev) => ({ ...prev, instruction_points: serializeInstructionItems(items) }));
  }

  function updateMaterialItems(items) {
    setForm((prev) => ({ ...prev, send_items: serializeSendItems(items) }));
  }

  function openSearchInDb(jd) {
    const params = new URLSearchParams();
    splitCsv(jd.location).forEach((item) => params.append('location', item));
    splitCsv(jd.preferred_location_rule).forEach((item) => params.append('preferred_location', item));
    splitCsv(jd.qualification_rule).forEach((item) => params.append('qualification', item));
    splitCsv(jd.communication_rule).forEach((item) => params.append('communication_skill', item));
    splitCsv(jd.career_gap_rule).forEach((item) => params.append('career_gap', item));
    splitCsv(jd.documents_rule).forEach((item) => params.append('documents_availability', item));
    splitCsv(jd.all_details_sent_rule).forEach((item) => params.append('all_details_sent', item));
    splitCsv(jd.relevant_experience_rule).forEach((item) => params.append('relevant_experience_range', item));
    splitCsv(jd.relevant_salary_rule).forEach((item) => params.append('relevant_in_hand_range', item));
    if (jd.process_name) params.append('process', jd.process_name);
    const salaryRange = deriveNumericRange(jd.salary || '', jd.salary_min, jd.salary_max, 'amount');
    if (salaryRange.min) params.set('salary_from', String(salaryRange.min));
    if (salaryRange.max) params.set('salary_to', String(salaryRange.max));
    const expRange = deriveNumericRange(jd.experience || '', jd.exp_min, jd.exp_max, 'months');
    if (expRange.min) params.set('relevant_exp_from', String(expRange.min));
    if (expRange.max) params.set('relevant_exp_to', String(expRange.max));
    window.open(`/candidates?${params.toString()}`, '_blank', 'noopener,noreferrer');
  }

  function startNewJd() {
    setEditingId('NEW');
    setSelectedId('');
    setForm(EMPTY_FORM);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('focus');
      return next;
    });
  }


  if (standalone) {
    return (
      <Layout title={displayJd?.job_title || 'JD Detail'} subtitle="Only the selected JD is open here, with full instructions and send material. The candidate page stays untouched for once.">
        <div className="jd-centre-page-v2 fade-up">
          {message ? <div className="flash info">{message}</div> : null}
          <div className="panel glassy-card jd-detail-shell">
            {displayJd ? (
              <div className="jd-view-shell">
                <div className="jd-detail-topbar">
                  <div>
                    <div className="panel-title">{displayJd.job_title || 'JD Detail'}</div>
                    <div className="helper-text top-gap-small">{displayJd.company || '-'} • {displayJd.location || '-'} • {displayJd.process_name || displayJd.job_title || '-'}</div>
                  </div>
                  <div className="jd-head-actions">
                    {displayJd.pdf_url ? <a className="add-profile-btn bounceable" href={displayJd.pdf_url} target="_blank" rel="noreferrer">Open PDF</a> : null}
                  </div>
                </div>

                <div className="jd-rule-grid top-gap-small">
                  <div className="jd-rule-card"><div className="jd-rule-title">Preferred Location</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.preferred_location_rule || displayJd.location)}</div></div>
                  <div className="jd-rule-card"><div className="jd-rule-title">Qualification</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.qualification_rule)}</div></div>
                  <div className="jd-rule-card"><div className="jd-rule-title">Experience Range</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.relevant_experience_rule) || '-'}</div></div>
                  <div className="jd-rule-card"><div className="jd-rule-title">Salary Range</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.relevant_salary_rule) || '-'}</div></div>
                  <div className="jd-rule-card"><div className="jd-rule-title">Communication</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.communication_rule)}</div></div>
                  <div className="jd-rule-card"><div className="jd-rule-title">Career Gap</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.career_gap_rule)}</div></div>
                  <div className="jd-rule-card"><div className="jd-rule-title">Documents</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.documents_rule)}</div></div>
                  <div className="jd-rule-card"><div className="jd-rule-title">All Details Sent</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.all_details_sent_rule)}</div></div>
                </div>

                <div className="jd-view-two-col top-gap-small">
                  <div className="jd-section-box">
                    <div className="panel-title">Instruction Points</div>
                    <div className="jd-display-stack top-gap-small">
                      {(displayJd.instruction_points_list || []).map((item, idx) => (
                        <div key={`standalone-instruction-${idx}`} className="jd-display-card">
                          <div className="jd-display-card-top">
                            <span className="metric-mini-chip records tiny-chip">Instruction {idx + 1}</span>
                            <strong>{item.title || `Instruction ${idx + 1}`}</strong>
                          </div>
                          <div className="jd-display-copy">{item.content || '-'}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="jd-section-box">
                    <div className="panel-title">Send Material</div>
                    <div className="jd-display-stack top-gap-small">
                      {(displayJd.send_items_list || []).map((item, idx) => (
                        <div key={`standalone-material-${idx}`} className="jd-display-card">
                          <div className="jd-display-card-top spread">
                            <div>
                              <span className="metric-mini-chip filters tiny-chip">Material {idx + 1}</span>
                              <strong>{item.label || `Send Material ${idx + 1}`}</strong>
                            </div>
                            {candidate ? (
                              <button
                                type="button"
                                className="mini-btn call bounceable jd-wa-btn"
                                onClick={() => openWhatsApp(candidate, `${interpolate(displayJd.message_template, candidate, displayJd)}

${item.label || `Send Material ${idx + 1}`}:
${item.message || ''}${item.link ? `
${item.link}` : ''}${displayJd.pdf_url ? `
PDF: ${displayJd.pdf_url}` : ''}`)}
                                title="Send on WhatsApp"
                              >
                                <WhatsAppIcon />
                                <span>WhatsApp</span>
                              </button>
                            ) : null}
                          </div>
                          <div className="jd-display-copy">{item.message || '-'}</div>
                          {item.link ? <div className="helper-text top-gap-small">{item.link}</div> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="jd-section-box top-gap-small">
                  <div className="panel-title">WhatsApp Script</div>
                  <div className="jd-display-copy top-gap-small">{displayJd.message_template || '-'}</div>
                </div>

                {displayJd.notes ? (
                  <div className="jd-section-box top-gap-small">
                    <div className="panel-title">Notes</div>
                    <div className="jd-display-copy top-gap-small">{displayJd.notes}</div>
                  </div>
                ) : null}

                {candidate ? (
                  <div className="jd-feedback-shell top-gap-small">
                    <div>
                      <div className="panel-title">Candidate Interest Marking</div>
                      <div className="helper-text">Mark the response on the same call and save the note against the candidate. Miracles are rare, so the system should remember things.</div>
                    </div>
                    <div className="choice-chip-row compact-row">
                      {['Interested', 'Pending', 'Not Interested'].map((option) => (
                        <button key={option} type="button" className={`choice-chip bounceable ${feedbackStatus === option ? 'active' : ''}`} onClick={() => sendFeedback(option)}>{option}</button>
                      ))}
                    </div>
                    <textarea rows="3" className="inline-textarea" value={feedbackNote} onChange={(e) => setFeedbackNote(e.target.value)} placeholder="Add on-call note. This will be saved in candidate notes too." />
                    <div className="row-actions">
                      <button type="button" className="ghost-btn bounceable" onClick={() => openWhatsApp(candidate, `${interpolate(displayJd.message_template, candidate, displayJd)}${displayJd.pdf_url ? `
PDF: ${displayJd.pdf_url}` : ''}`)}>Send JD on WhatsApp</button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : <div className="helper-text">Selected JD could not be loaded.</div>}
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="JD Centre" subtitle="Manager-controlled JD rules, colorful call scripts, send material, and live candidate matching.">
      <div className="jd-centre-page-v2 fade-up">
        {message ? <div className="flash info">{message}</div> : null}

        <div className="jd-summary-grid">
          <MetricCard tone="tone-blue" label="Total JDs" value={summary.total} subtext="All visible JD cards" />
          <MetricCard tone="tone-green" label="Open JDs" value={summary.open} subtext="Ready for calling" />
          <MetricCard tone="tone-orange" label={candidate ? 'Matched JDs' : 'Visible Cards'} value={summary.matched} subtext={candidate ? 'Live rules matched' : 'JD selector count'} />
          <MetricCard tone="tone-indigo" label="Instruction Points" value={summary.instructions} subtext="Per selected JD" />
          <MetricCard tone="tone-sky" label="Send Material" value={summary.materials} subtext="WhatsApp-ready blocks" />
        </div>

        <div className="table-panel glassy-card top-gap jd-selector-shell">
          <div className="table-toolbar jd-toolbar-stack">
            <div>
              <div className="table-title">JD Card Selector</div>
              <div className="helper-text">This section has been tightened for a cleaner layout and better readability.</div>
            </div>
            <div className="toolbar-actions compact-pills jd-toolbar-actions">
              {candidate ? (
                <>
                  <span className="metric-mini-chip records">Candidate: {candidate.full_name}</span>
                  <span className="metric-mini-chip filters">Phone: {visiblePhone(user, candidate.phone)}</span>
                </>
              ) : null}
              {manager ? <button type="button" className="add-profile-btn bounceable" onClick={startNewJd}>Add JD</button> : null}
            </div>
          </div>
          <div className="jd-selector-grid">
            {(visibleRows.length ? visibleRows : decorated).map((row) => (
              <button
                key={row.jd_id}
                type="button"
                className={`jd-selector-card ${String(displayJd?.jd_id) === String(row.jd_id) && editingId !== 'NEW' ? 'active' : ''}`}
                onClick={() => {
                  setSelectedId(row.jd_id);
                  setEditingId('');
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    next.set('focus', row.jd_id);
                    return next;
                  });
                }}
              >
                <div className="jd-selector-card-top">
                  <span className={`status-pill ${lower(row.jd_status || 'open')}`}>{row.jd_status || 'Open'}</span>
                  <span className="metric-mini-chip records tiny-chip">{row.active_rule_count} rules</span>
                </div>
                <div className="jd-selector-title">{row.job_title}</div>
                <div className="helper-text">{row.company || '-'} • {row.location || '-'}</div>
                <div className="jd-selector-meta">{row.process_name || row.job_title || '-'}</div>
                {candidate ? (
                  <div className="jd-reason-wrap">
                    {row.match.reasons.map((reason) => <span key={reason} className="sky-chip tiny">{reason}</span>)}
                  </div>
                ) : null}
              </button>
            ))}
            {!(visibleRows.length ? visibleRows : decorated).length ? <div className="helper-text">No JD available.</div> : null}
          </div>
        </div>

        <div className="panel glassy-card top-gap jd-detail-shell">
          {displayJd ? (
            <>
              <div className="jd-detail-topbar">
                <div>
                  <div className="panel-title">{editingId === 'NEW' ? 'Create New JD' : (displayJd.job_title || 'JD Detail')}</div>
                  <div className="helper-text top-gap-small">{displayJd.company || '-'} • {displayJd.location || '-'} • {displayJd.process_name || displayJd.job_title || '-'}</div>
                </div>
                <div className="jd-head-actions">
                  {editingId !== 'NEW' ? <button type="button" className="ghost-btn bounceable" onClick={() => openSearchInDb(displayJd)}>Search Candidates in Database</button> : null}
                  {manager && editingId !== 'NEW' ? <button type="button" className="add-profile-btn bounceable" onClick={() => setEditingId(displayJd.jd_id)}>Edit JD</button> : null}
                </div>
              </div>

              {editingId === 'NEW' || editingId === displayJd.jd_id ? (
                <div className="jd-editor-shell top-gap-small">
                  <div className="jd-basic-grid">
                    <label className="field compact-field"><span>Job Title</span><input value={form.job_title} onChange={(e) => setForm((prev) => ({ ...prev, job_title: e.target.value }))} placeholder="Back Office Executive" /></label>
                    <label className="field compact-field"><span>Company</span><input value={form.company} onChange={(e) => setForm((prev) => ({ ...prev, company: e.target.value }))} placeholder="Razorpay" /></label>
                    <label className="field compact-field"><span>Process Name</span><input value={form.process_name} onChange={(e) => setForm((prev) => ({ ...prev, process_name: e.target.value }))} placeholder="Back office process" /></label>
                    <label className="field compact-field"><span>Base Location</span><input value={form.location} onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))} placeholder="Noida" /></label>
                    <label className="field compact-field"><span>JD Status</span><select value={form.jd_status} onChange={(e) => setForm((prev) => ({ ...prev, jd_status: e.target.value }))}><option>Open</option><option>Active</option><option>Pending</option><option>Closed</option></select></label>
                    <label className="field compact-field"><span>PDF URL</span><input value={form.pdf_url} onChange={(e) => setForm((prev) => ({ ...prev, pdf_url: e.target.value }))} placeholder="https://..." /></label>
                    <label className="field compact-field"><span>Min Salary</span><input value={form.salary_min} onChange={(e) => setForm((prev) => ({ ...prev, salary_min: e.target.value }))} placeholder="16000" /></label>
                    <label className="field compact-field"><span>Max Salary</span><input value={form.salary_max} onChange={(e) => setForm((prev) => ({ ...prev, salary_max: e.target.value }))} placeholder="22000" /></label>
                    <label className="field compact-field"><span>Min Relevant Exp (months)</span><input value={form.exp_min} onChange={(e) => setForm((prev) => ({ ...prev, exp_min: e.target.value }))} placeholder="0" /></label>
                    <label className="field compact-field"><span>Max Relevant Exp (months)</span><input value={form.exp_max} onChange={(e) => setForm((prev) => ({ ...prev, exp_max: e.target.value }))} placeholder="24" /></label>
                  </div>

                  <div className="jd-rule-grid top-gap-small">
                    <RuleGroup label="Preferred Location" value={form.preferred_location_rule} options={PREFERRED_LOCATIONS} onChange={(value) => setForm((prev) => ({ ...prev, preferred_location_rule: value }))} hint="Multiple location options allowed." />
                    <RuleGroup label="Qualification" value={form.qualification_rule} options={DEGREE_OPTIONS} onChange={(value) => setForm((prev) => ({ ...prev, qualification_rule: value }))} hint="Graduate or under-graduate type rules." />
                    <RuleGroup label="Relevant Experience Range" value={form.relevant_experience_rule} options={EXPERIENCE_RANGE_OPTIONS} onChange={(value) => setForm((prev) => ({ ...prev, relevant_experience_rule: value }))} hint="Chip-based range rules like the candidate card UI." />
                    <RuleGroup label="Relevant In-hand Salary" value={form.relevant_salary_rule} options={SALARY_RANGE_OPTIONS} onChange={(value) => setForm((prev) => ({ ...prev, relevant_salary_rule: value }))} hint="Multiple salary bands can stay active." />
                    <RuleGroup label="Communication" value={form.communication_rule} options={COMMUNICATION_OPTIONS} onChange={(value) => setForm((prev) => ({ ...prev, communication_rule: value }))} hint="Match by communication level." />
                    <RuleGroup label="Career Gap" value={form.career_gap_rule} options={CAREER_GAP_OPTIONS} onChange={(value) => setForm((prev) => ({ ...prev, career_gap_rule: value }))} hint="Pick one or many gap buckets." />
                    <RuleGroup label="All Documents Availability" value={form.documents_rule} options={DOCUMENTS_OPTIONS} onChange={(value) => setForm((prev) => ({ ...prev, documents_rule: value }))} hint="Useful when recruiter wants clean docs first." />
                    <RuleGroup label="All Details Sent" value={form.all_details_sent_rule} options={DETAILS_SENT_OPTIONS} onChange={(value) => setForm((prev) => ({ ...prev, all_details_sent_rule: value }))} hint="Pending or completed detail-sharing state." />
                  </div>

                  <div className="jd-editor-two-col top-gap-small">
                    <div className="jd-section-box tall-box">
                      <div className="jd-section-head">
                        <div>
                          <div className="panel-title">Instruction Points</div>
                          <div className="helper-text">No more one giant dead textarea. Each instruction gets its own title and content block.</div>
                        </div>
                        <button type="button" className="ghost-btn bounceable" onClick={() => updateInstructionItems([...instructionItems, { title: `Instruction ${instructionItems.length + 1}`, content: '' }])}>Add Point</button>
                      </div>
                      <div className="jd-editor-list top-gap-small">
                        {instructionItems.map((item, idx) => (
                          <div key={`instruction-${idx}`} className="jd-editor-item-card">
                            <div className="jd-editor-item-head">
                              <span className="metric-mini-chip records tiny-chip">{idx + 1}</span>
                              <button type="button" className="ghost-btn danger-ghost" onClick={() => updateInstructionItems(instructionItems.filter((_, index) => index !== idx))}>Remove</button>
                            </div>
                            <input className="inline-input" value={item.title} onChange={(e) => updateInstructionItems(instructionItems.map((entry, index) => index === idx ? { ...entry, title: e.target.value } : entry))} placeholder={`Instruction ${idx + 1}`} />
                            <textarea className="inline-textarea top-gap-small" rows="4" value={item.content} onChange={(e) => updateInstructionItems(instructionItems.map((entry, index) => index === idx ? { ...entry, content: e.target.value } : entry))} placeholder="Write what the recruiter should explain on call." />
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="jd-section-box tall-box">
                      <div className="jd-section-head">
                        <div>
                          <div className="panel-title">Send Material</div>
                          <div className="helper-text">Every point can have a label, long message, optional link, and its own WhatsApp action.</div>
                        </div>
                        <button type="button" className="ghost-btn bounceable" onClick={() => updateMaterialItems([...materialItems, { order_no: materialItems.length + 1, label: `Send Material ${materialItems.length + 1}`, message: '', link: '' }])}>Add Material</button>
                      </div>
                      <div className="jd-editor-list top-gap-small">
                        {materialItems.map((item, idx) => (
                          <div key={`material-${idx}`} className="jd-editor-item-card">
                            <div className="jd-editor-item-head">
                              <span className="metric-mini-chip filters tiny-chip">Material {idx + 1}</span>
                              <button type="button" className="ghost-btn danger-ghost" onClick={() => updateMaterialItems(materialItems.filter((_, index) => index !== idx))}>Remove</button>
                            </div>
                            <input className="inline-input" value={item.label} onChange={(e) => updateMaterialItems(materialItems.map((entry, index) => index === idx ? { ...entry, label: e.target.value } : entry))} placeholder="Location / JD / Interview Info" />
                            <textarea className="inline-textarea top-gap-small" rows="4" value={item.message} onChange={(e) => updateMaterialItems(materialItems.map((entry, index) => index === idx ? { ...entry, message: e.target.value } : entry))} placeholder="Paste long WhatsApp-ready content here." />
                            <input className="inline-input top-gap-small" value={item.link} onChange={(e) => updateMaterialItems(materialItems.map((entry, index) => index === idx ? { ...entry, link: e.target.value } : entry))} placeholder="Optional link" />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="jd-editor-two-col top-gap-small">
                    <label className="field"><span>WhatsApp Template</span><textarea rows="4" value={form.message_template} onChange={(e) => setForm((prev) => ({ ...prev, message_template: e.target.value }))} placeholder="Hi {candidate_name}, ..." /></label>
                    <label className="field"><span>Notes</span><textarea rows="4" value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Manager notes / recruiter guidance" /></label>
                  </div>

                  <div className="row-actions top-gap-small">
                    <button type="button" className="add-profile-btn bounceable" disabled={saving} onClick={saveJd}>{saving ? 'Saving...' : (editingId && editingId !== 'NEW' ? 'Update JD' : 'Create JD')}</button>
                    {editingId ? <button type="button" className="ghost-btn bounceable" onClick={() => setEditingId('')}>Cancel Edit</button> : null}
                  </div>
                </div>
              ) : (
                <div className="jd-view-shell top-gap-small">
                  <div className="jd-rule-grid top-gap-small">
                    <div className="jd-rule-card"><div className="jd-rule-title">Preferred Location</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.preferred_location_rule || displayJd.location)}</div></div>
                    <div className="jd-rule-card"><div className="jd-rule-title">Qualification</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.qualification_rule)}</div></div>
                    <div className="jd-rule-card"><div className="jd-rule-title">Experience Range</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.relevant_experience_rule) || '-'}</div></div>
                    <div className="jd-rule-card"><div className="jd-rule-title">Salary Range</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.relevant_salary_rule) || '-'}</div></div>
                    <div className="jd-rule-card"><div className="jd-rule-title">Communication</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.communication_rule)}</div></div>
                    <div className="jd-rule-card"><div className="jd-rule-title">Career Gap</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.career_gap_rule)}</div></div>
                    <div className="jd-rule-card"><div className="jd-rule-title">Documents</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.documents_rule)}</div></div>
                    <div className="jd-rule-card"><div className="jd-rule-title">All Details Sent</div><div className="helper-text top-gap-small">{formatRuleSummary(displayJd.all_details_sent_rule)}</div></div>
                  </div>

                  <div className="jd-view-two-col top-gap-small">
                    <div className="jd-section-box">
                      <div className="panel-title">Instruction Points</div>
                      <div className="jd-display-stack top-gap-small">
                        {(displayJd.instruction_points_list || []).map((item, idx) => (
                          <div key={`view-instruction-${idx}`} className="jd-display-card">
                            <div className="jd-display-card-top">
                              <span className="metric-mini-chip records tiny-chip">Instruction {idx + 1}</span>
                              <strong>{item.title || `Instruction ${idx + 1}`}</strong>
                            </div>
                            <div className="jd-display-copy">{item.content || '-'}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="jd-section-box">
                      <div className="panel-title">Send Material</div>
                      <div className="jd-display-stack top-gap-small">
                        {(displayJd.send_items_list || []).map((item, idx) => (
                          <div key={`view-material-${idx}`} className="jd-display-card">
                            <div className="jd-display-card-top spread">
                              <div>
                                <span className="metric-mini-chip filters tiny-chip">Material {idx + 1}</span>
                                <strong>{item.label || `Send Material ${idx + 1}`}</strong>
                              </div>
                              {candidate ? (
                                <button
                                  type="button"
                                  className="mini-btn call bounceable jd-wa-btn"
                                  onClick={() => openWhatsApp(candidate, `${interpolate(displayJd.message_template, candidate, displayJd)}\n\n${item.label || `Send Material ${idx + 1}`}:\n${item.message || ''}${item.link ? `\n${item.link}` : ''}${displayJd.pdf_url ? `\nPDF: ${displayJd.pdf_url}` : ''}`)}
                                  title="Send on WhatsApp"
                                >
                                  <WhatsAppIcon />
                                  <span>WhatsApp</span>
                                </button>
                              ) : null}
                            </div>
                            <div className="jd-display-copy">{item.message || '-'}</div>
                            {item.link ? <div className="helper-text top-gap-small">{item.link}</div> : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {candidate ? (
                    <div className="jd-feedback-shell top-gap-small">
                      <div>
                        <div className="panel-title">Candidate Interest Marking</div>
                        <div className="helper-text">Record the response during the same call so the note is saved directly against the candidate profile.</div>
                      </div>
                      <div className="choice-chip-row compact-row">
                        {['Interested', 'Pending', 'Not Interested'].map((option) => (
                          <button key={option} type="button" className={`choice-chip bounceable ${feedbackStatus === option ? 'active' : ''}`} onClick={() => sendFeedback(option)}>{option}</button>
                        ))}
                      </div>
                      <textarea rows="3" className="inline-textarea" value={feedbackNote} onChange={(e) => setFeedbackNote(e.target.value)} placeholder="Add on-call note. This will be saved in candidate notes too." />
                      <div className="row-actions">
                        <button type="button" className="ghost-btn bounceable" onClick={() => openWhatsApp(candidate, `${interpolate(displayJd.message_template, candidate, displayJd)}${displayJd.pdf_url ? `\nPDF: ${displayJd.pdf_url}` : ''}`)}>Send JD on WhatsApp</button>
                        {displayJd.pdf_url ? <a className="add-profile-btn bounceable" href={displayJd.pdf_url} target="_blank" rel="noreferrer">Open PDF</a> : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </>
          ) : <div className="helper-text">Select a JD to continue.</div>}
        </div>
      </div>
    </Layout>
  );
}
