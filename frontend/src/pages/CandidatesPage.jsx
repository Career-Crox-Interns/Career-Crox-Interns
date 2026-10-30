import {isInactiveProfile} from '../lib/candidateAccess';
import {AllocationLockedCard,compactCandidateCards} from '../components/WorkspaceUtilities';
import {LostProfilesCard} from '../components/WorkspaceAppearance';
import {useSliceSearch,useSliceState,sortCrmRows} from '../lib/workspaceHelpers';
import {useCandidateFilterCatalog} from '../lib/workspaceHelpers';
import { requestProfileDelete } from '../lib/workspaceHelpers';
import { ActionGlyph } from '../components/EmojiGlyph';
import PremiumSelect, {RecruiterMultiSelect} from '../components/PremiumSelect';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import {DashboardSwitcher} from '../lib/dashboardScope';
import { api,displayStaffName } from '../lib/api';
import { useDashboardAuth as useAuth } from '../lib/auth';
import { mergeRowsById, useSmartDeltaSync } from '../lib/smartSync';
import { addWhatsAppTemplate, getWhatsAppTemplates } from '../lib/templateStore';
import { dialCandidateWithLog, openWhatsAppWithLog, visiblePhone } from '../lib/candidateAccess';
import { openCandidateProfileInSameTab } from '../lib/candidateNav';
import { readPageCache, writePageCache } from '../lib/persistentPageCache';
import { onCandidateRealtime, emitCandidateUpsert, candidateVisibleLocally } from '../lib/realtimeProfileBridge';
import { updateRowSelection, makeDialerQueuePayload, storeDialerQueue, serveDialerQueue } from '../lib/workspaceHelpers';

function EyeIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M2.4 12s3.4-6 9.6-6 9.6 6 9.6 6-3.4 6-9.6 6-9.6-6-9.6-6Z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.9" /></svg>;
}
function PhoneIcon() { return <ActionGlyph kind="phone"/>; }
function WhatsAppIcon() { return <ActionGlyph kind="whatsapp"/>; }
function CheckIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5.2 12.7 9.4 17l9.4-9.4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function SelectAllIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M8.3 12.2 10.9 15l4.9-5.3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function DialerIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 4h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="1.8"/><circle cx="9" cy="8" r="1"/><circle cx="12" cy="8" r="1"/><circle cx="15" cy="8" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="16" r="1"/><circle cx="12" cy="16" r="1"/><circle cx="15" cy="16" r="1"/></svg>;
}
function FilterIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}
function PrevIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m14.5 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function NextIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function CloseIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>;
}
function BackIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m15 6-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function ArrowIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function TrashIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M9 4h6l1 2H8l1-2Z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/><path d="M7 7l.7 11.2A2 2 0 0 0 9.7 20h4.6a2 2 0 0 0 2-1.8L17 7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

const defaultFilters = {
  q: '',
  sr_from: '', sr_to: '',
  submission_from: '', submission_to: '',
  interview_from: '', interview_to: '',
  salary_from: '', salary_to: '',
  total_exp_from: '', total_exp_to: '',
  relevant_exp_from: '', relevant_exp_to: '',
  name: [], phone: [], location: [], qualification: [], course_name: [], recruiter_code: [], preferred_location: [], communication_skill: [], process: [], all_details_sent: [], status: [], approval_status: [], virtual_onsite: [], documents_availability: [], call_connected: [], manager_crm: [], submitted_by: [], career_gap: [], relevant_experience_range: [], relevant_in_hand_range: [], data_notes: [], data_uploading_from: '', data_uploading_to: '', bucket_view: 'all'
};

const FILTER_PRESET_STORAGE_KEY = 'careerCroxCandidateFilterPresets';
const DEGREE_FILTER_OPTIONS = ['NON - Graduate', 'Graduate'];
const DEFAULT_PREFERRED_LOCATION_OPTIONS = ['Noida', 'Gurgaon', 'Mumbai'];
const PREFERRED_LOCATION_STORAGE_KEY = 'careerCroxPreferredLocations_v3';
const FILTER_ALL_MARKER = '__ALL__';

const CC794_FILTER_REFERENCE_CSS = `
body.cc794-filter-open{overflow:hidden!important}
.cc794-filter-backdrop{
  position:fixed!important;inset:0!important;z-index:2147483647!important;
  display:flex!important;align-items:center!important;justify-content:center!important;
  padding:12px!important;background:rgba(12,27,49,.34)!important;
  backdrop-filter:blur(4px)!important;-webkit-backdrop-filter:blur(4px)!important;
  overflow:hidden!important;
}
.cc794-filter-modal{
  width:min(1180px,calc(100vw - 24px))!important;
  height:min(860px,calc(100vh - 24px))!important;
  max-width:none!important;max-height:none!important;margin:0!important;
  border-radius:24px!important;overflow:hidden!important;
  display:flex!important;flex-direction:column!important;
  background:linear-gradient(180deg,#fbfdff 0%,#edf5ff 100%)!important;
  border:1px solid rgba(80,126,216,.30)!important;
  box-shadow:0 30px 90px rgba(10,28,55,.30)!important;
}
.cc794-filter-modal .candidate-filter-modal-head{
  flex:0 0 auto!important;min-height:74px!important;padding:13px 18px!important;
  display:flex!important;align-items:center!important;justify-content:space-between!important;
  gap:16px!important;background:rgba(255,255,255,.98)!important;border-bottom:1px solid #d9e5f2!important;
}
.cc794-filter-modal .candidate-filter-modal-title{
  display:flex!important;align-items:center!important;gap:9px!important;
  font-size:27px!important;line-height:1.06!important;font-weight:1000!important;
  letter-spacing:-.02em!important;color:#173a66!important;-webkit-text-fill-color:#173a66!important;
  white-space:nowrap!important;
}
.cc794-filter-modal .candidate-filter-modal-head .helper-text{
  margin-top:4px!important;font-size:12px!important;line-height:1.25!important;
  font-weight:750!important;color:#58708c!important;-webkit-text-fill-color:#58708c!important;
}
.cc794-filter-modal .candidate-filter-head-actions{
  display:flex!important;align-items:center!important;justify-content:flex-end!important;
  gap:8px!important;flex-wrap:wrap!important;
}
.cc794-filter-modal .candidate-filter-head-actions .mini-chip{
  min-height:34px!important;display:inline-flex!important;align-items:center!important;
  padding:7px 11px!important;border-radius:999px!important;font-size:12px!important;font-weight:900!important;
}
.cc794-filter-modal .candidate-filter-head-actions button{
  min-height:36px!important;padding:7px 13px!important;font-size:13px!important;font-weight:900!important;
}
.cc794-filter-modal .candidate-filter-modal-body{
  flex:1 1 auto!important;min-height:0!important;display:grid!important;
  grid-template-columns:470px minmax(0,1fr)!important;gap:12px!important;
  padding:14px!important;overflow:hidden!important;
}
.cc794-filter-modal .candidate-filter-sidebar{
  min-height:0!important;display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;
  grid-template-rows:auto minmax(0,1fr)!important;gap:8px!important;padding:0!important;overflow:hidden!important;
}
.cc794-filter-modal .candidate-filter-save-card{
  min-width:0!important;min-height:78px!important;padding:8px 10px!important;
  border-radius:16px!important;border:1px solid rgba(83,130,255,.14)!important;
}
.cc794-filter-modal .candidate-filter-save-title{
  margin-bottom:5px!important;font-size:13px!important;line-height:1.05!important;font-weight:1000!important;
  color:#1d4068!important;-webkit-text-fill-color:#1d4068!important;
}
.cc794-filter-modal .candidate-filter-save-card .helper-text{
  font-size:10px!important;line-height:1.15!important;font-weight:750!important;
}
.cc794-filter-modal .candidate-filter-save-card .inline-input{
  min-height:31px!important;height:31px!important;font-size:11px!important;font-weight:800!important;
}
.cc794-filter-modal .candidate-filter-save-card .full-width-btn{
  min-height:29px!important;height:29px!important;margin-top:4px!important;font-size:11px!important;font-weight:900!important;
}
.cc794-filter-modal .candidate-preset-list{max-height:38px!important;overflow:auto!important}
.cc794-filter-modal .candidate-preset-apply{padding:9px 10px!important}
.cc794-filter-modal .candidate-preset-apply strong{font-size:12.5px!important;font-weight:900!important}
.cc794-filter-modal .candidate-preset-apply span{font-size:10.5px!important;font-weight:750!important}
.cc794-filter-modal .candidate-filter-nav{
  grid-column:1/-1!important;min-height:0!important;display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;
  grid-auto-rows:minmax(36px,auto)!important;align-content:start!important;gap:4px!important;margin-top:0!important;padding:0!important;
  overflow:hidden!important;
}
.cc794-filter-modal .candidate-filter-nav-item{
  min-width:0!important;min-height:36px!important;padding:5px 8px!important;
  border-radius:14px!important;display:flex!important;align-items:center!important;justify-content:space-between!important;
  transform:none!important;transition:border-color .14s ease,background .14s ease,box-shadow .14s ease!important;
}
.cc794-filter-modal .candidate-filter-nav-item:hover{
  transform:none!important;border-color:#77a8ec!important;box-shadow:0 8px 18px rgba(42,83,141,.12)!important;
}
.cc794-filter-modal .candidate-filter-nav-item strong{
  display:block!important;font-size:11.5px!important;line-height:1.05!important;font-weight:950!important;
  color:#173b64!important;-webkit-text-fill-color:#173b64!important;
}
.cc794-filter-modal .candidate-filter-nav-item span{
  display:block!important;margin-top:1px!important;font-size:9.5px!important;line-height:1.05!important;
  font-weight:800!important;color:#5b708b!important;-webkit-text-fill-color:#5b708b!important;
}
.cc794-filter-modal .candidate-filter-nav-item.active{
  border-color:#6d9fe9!important;background:linear-gradient(135deg,#fff,#edf5ff)!important;
  box-shadow:0 8px 18px rgba(45,86,145,.12)!important;
}
.cc794-filter-modal .candidate-filter-nav-item.selected,
.cc794-filter-modal .candidate-filter-nav-item.selected:hover{
  background:linear-gradient(135deg,#bdf1cc 0%,#d9f9e3 55%,#effff4 100%)!important;
  border-color:#4fc47a!important;box-shadow:0 8px 18px rgba(44,156,88,.13)!important;
}
.cc794-filter-modal .candidate-filter-nav-item.selected strong{color:#0c6333!important;-webkit-text-fill-color:#0c6333!important}
.cc794-filter-modal .candidate-filter-nav-item.selected span{color:#177744!important;-webkit-text-fill-color:#177744!important}
.cc794-filter-modal .candidate-filter-detail-panel{
  min-height:0!important;height:100%!important;overflow:auto!important;overscroll-behavior:contain!important;
  padding:15px!important;border-radius:18px!important;background:rgba(255,255,255,.97)!important;
  border:1px solid rgba(83,130,255,.12)!important;box-shadow:0 10px 24px rgba(31,42,68,.05)!important;
  scrollbar-gutter:stable!important;
}
.cc794-filter-modal .candidate-filter-detail-head{
  position:sticky!important;top:-15px!important;z-index:3!important;
  margin:-15px -15px 10px!important;padding:14px 15px 10px!important;
  background:rgba(255,255,255,.98)!important;border-bottom:1px solid #e2ebf5!important;
  display:flex!important;align-items:flex-start!important;justify-content:space-between!important;gap:12px!important;
}
.cc794-filter-modal .candidate-filter-detail-title{
  font-size:20px!important;line-height:1.08!important;font-weight:1000!important;
  color:#173b64!important;-webkit-text-fill-color:#173b64!important;
}
.cc794-filter-modal .candidate-filter-detail-sub{
  margin-top:3px!important;font-size:11.5px!important;line-height:1.2!important;font-weight:750!important;
  color:#60758e!important;-webkit-text-fill-color:#60758e!important;
}
.cc794-filter-modal .candidate-filter-detail-head .helper-text{font-size:10.5px!important;line-height:1.2!important}
.cc794-filter-modal .candidate-filter-detail-panel .inline-input{
  min-height:42px!important;height:42px!important;font-size:14px!important;font-weight:800!important;border-radius:11px!important;
}
.cc794-filter-modal .candidate-option-grid.roomy.two-col{
  display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;
  gap:9px!important;max-height:none!important;overflow:visible!important;padding:2px 2px 8px!important;
}
.cc794-filter-modal .candidate-option-card{
  min-height:48px!important;padding:10px 12px!important;border-radius:13px!important;
  font-size:13.5px!important;line-height:1.2!important;font-weight:850!important;
  color:#173b5e!important;-webkit-text-fill-color:#173b5e!important;transform:none!important;
}
.cc794-filter-modal .candidate-option-card:hover{
  transform:none!important;border-color:#77a8ec!important;box-shadow:0 8px 18px rgba(42,83,141,.11)!important;background:#f7fbff!important;
}
.cc794-filter-modal .candidate-option-card.checked,
.cc794-filter-modal .candidate-option-card.checked:hover{
  background:linear-gradient(135deg,#c6f3d3 0%,#e2fbea 100%)!important;
  border-color:#54c47d!important;color:#0e5f33!important;-webkit-text-fill-color:#0e5f33!important;
}
.cc794-filter-modal .candidate-option-card input{width:18px!important;height:18px!important;flex:0 0 18px!important;accent-color:#20a85a!important}
.cc794-filter-modal .candidate-range-row.wider{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:14px!important}
.cc794-filter-modal .candidate-range-row .field label{font-size:13px!important;font-weight:900!important}
@media(max-width:900px){
  .cc794-filter-backdrop{padding:0!important}
  .cc794-filter-modal{width:100vw!important;height:100vh!important;border-radius:0!important}
  .cc794-filter-modal .candidate-filter-modal-head{align-items:flex-start!important;flex-direction:column!important}
  .cc794-filter-modal .candidate-filter-modal-title{font-size:22px!important;white-space:normal!important}
  .cc794-filter-modal .candidate-filter-modal-body{grid-template-columns:1fr!important;overflow:auto!important}
  .cc794-filter-modal .candidate-filter-sidebar{max-height:46vh!important;display:flex!important;flex-direction:column!important;overflow:auto!important}
  .cc794-filter-modal .candidate-filter-nav{display:grid!important;grid-template-columns:1fr!important;overflow:visible!important}
  .cc794-filter-modal .candidate-option-grid.roomy.two-col,.cc794-filter-modal .candidate-range-row.wider{grid-template-columns:1fr!important}
}
`;

function normalizeFilterValue(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function normalizeLocationFilterValue(value) {
  return normalizeFilterValue(value).replace(/\bgurugram\b/g, 'gurgaon');
}

function candidateFilterWorkStarted(row = {}) {
  const status = normalizeFilterValue(row?.status || '');
  const approval = normalizeFilterValue(row?.approval_status || '');
  if (status && status !== 'draft') return true;
  if (approval && approval !== 'draft') return true;
  if (String(row?.call_connected || '').trim()) return true;
  if (String(row?.process || '').trim()) return true;
  if (String(row?.follow_up_at || '').trim()) return true;
  if (String(row?.interview_reschedule_date || row?.interview_date || '').trim()) return true;
  if (String(row?.submission_id || row?.approval_requested_at || row?.submitted_at || '').trim()) return true;
  return ['total_experience','relevant_experience','ctc_monthly','in_hand_salary','relevant_experience_range','relevant_in_hand_range']
    .some((key) => {
      const value = String(row?.[key] ?? '').trim();
      return value !== '' && value !== '0' && normalizeFilterValue(value) !== 'fresher';
    });
}

function maskUntouchedFilterDefaults(row = {}) {
  if (candidateFilterWorkStarted(row)) return row;
  const next = { ...row };
  next.preferred_location = '';
  const legacyDefaults = {
    qualification_level: ['graduate'], career_gap: ['fresher'],
    communication_skill: ['average','good'], documents_availability: ['yes'], virtual_onsite: ['walkin'],
    all_details_sent: ['pending'], relevant_experience_range: ['fresher'], relevant_in_hand_range: ['0'],
  };
  Object.entries(legacyDefaults).forEach(([key, values]) => {
    if (values.includes(normalizeFilterValue(next[key] || ''))) next[key] = '';
  });
  // CC865: stored zero values stay visible.
  return next;
}
function mergeLocationOptions(primary = [], fallback = [], selected = []) {
  const seen = new Set();
  const out = [];
  [...primary, ...(primary.length ? [] : fallback), ...selected].forEach((raw) => {
    const value = String(raw || '').trim();
    if (!value || value === FILTER_ALL_MARKER) return;
    const key = normalizeLocationFilterValue(value);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(value);
  });
  return out.sort((a, b) => String(a).localeCompare(String(b)));
}

function readStoredPreferredLocationOptions() {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFERRED_LOCATION_STORAGE_KEY) || '[]');
    const list = Array.isArray(stored) ? stored : [];
    return [...new Set([...DEFAULT_PREFERRED_LOCATION_OPTIONS, ...list.map((item) => String(item || '').trim()).filter(Boolean)])]
      .sort((a, b) => String(a).localeCompare(String(b)));
  } catch {
    return [...DEFAULT_PREFERRED_LOCATION_OPTIONS];
  }
}


function splitValues(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function candidateDataNotesOptionText(row = {}) {
  return String(row.data_notes || '').trim();
}
function candidateDataNotesOptionValues(row = {}) {
  return candidateDataNotesOptionText(row).split(/[,|;]+/).map((item) => item.trim()).filter(Boolean);
}

function displayCandidateCode(index = 0, currentPage = 1, currentPageSize = 10) {
  const serial = ((Number(currentPage || 1) - 1) * Number(currentPageSize || 10)) + Number(index || 0) + 1;
  return `C${String(Math.max(1, serial)).padStart(3, '0')}`;
}

function safeCellText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map((item) => safeCellText(item)).filter(Boolean).join(', ');
  try {
    const text = JSON.stringify(value);
    return text === undefined ? fallback : text;
  } catch {
    return fallback;
  }
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeWhatsAppTemplateOption(raw, index = 0) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const body = safeCellText(raw.body || raw.message || raw.text || '').trim();
    const title = safeCellText(raw.title || raw.heading || raw.name || body.split(/\r?\n/).find(Boolean) || `WhatsApp Preset ${index + 1}`).trim();
    return body ? { title, body } : null;
  }
  const body = safeCellText(raw || '').trim();
  if (!body) return null;
  const title = body.split(/\r?\n/).map((line) => line.trim()).find(Boolean)?.replace(/^[^\w{]+/, '').slice(0, 42) || `WhatsApp Preset ${index + 1}`;
  return { title, body };
}

function encodeWhatsAppTemplateOption(raw, index = 0) {
  const tpl = normalizeWhatsAppTemplateOption(raw, index);
  if (!tpl) return '';
  try { return JSON.stringify(tpl); } catch { return tpl.body || ''; }
}

function decodeWhatsAppTemplateOption(value = '') {
  const raw = safeCellText(value).trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return normalizeWhatsAppTemplateOption(parsed);
  } catch {
    return normalizeWhatsAppTemplateOption(raw);
  }
}

function candidateFirstName(row = {}) {
  const raw = safeObject(row);
  const name = safeCellText(raw.full_name || raw.name || raw.candidate_name || '').trim();
  return name.split(/\s+/).filter(Boolean)[0] || 'Candidate';
}

function recruiterDisplayName(row = {}, currentUser = {}) {
  const raw = safeObject(row);
  const usr = safeObject(currentUser);
  return safeCellText(
    raw.recruiter_name
      || raw.employee_name
      || raw.assigned_recruiter_name
      || raw.submitted_by_name
      || raw.tl_name
      || usr.full_name
      || usr.name
      || usr.username
      || raw.recruiter_code
      || raw.employee_code
      || 'Career Crox'
  ).trim();
}

function renderWhatsAppTemplateBody(body = '', row = {}, currentUser = {}) {
  const first = candidateFirstName(row);
  const raw = safeObject(row);
  const candidateName = safeCellText(raw.full_name || raw.name || raw.candidate_name || first).trim();
  const recruiterName = recruiterDisplayName(raw, currentUser);
  return safeCellText(body)
    .replace(/\{\{first_name\}\}/g, first)
    .replace(/\{\{candidate_name\}\}/g, candidateName)
    .replace(/\{\{recruiter_name\}\}/g, recruiterName);
}

function buildInitialFilters(searchParams) {
  const next = { ...defaultFilters };
  Object.entries(defaultFilters).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      next[key] = searchParams.getAll(key).map((item) => String(item || '').trim()).filter(Boolean);
      return;
    }
    const found = searchParams.get(key);
    if (found !== null) next[key] = found;
  });
  return next;
}
function containsText(value, q) {
  return String(value || '').toLowerCase().includes(String(q || '').toLowerCase());
}
function normalizeId(value) {
  return String(value || '').trim();
}
function numericTail(value) {
  const match = String(value || '').match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}
function inRange(value, from, to) {
  const n = Number(value);
  if (!Number.isFinite(n)) return false;
  if (String(from).trim() !== '' && n < Number(from)) return false;
  if (String(to).trim() !== '' && n > Number(to)) return false;
  return true;
}
function uniqueOptions(rows, getter, split = false) {
  return Array.from(new Set(rows.flatMap((row) => {
    const value = getter(row);
    if (Array.isArray(value)) return value.filter(Boolean);
    return split ? splitValues(value) : [String(value || '').trim()].filter(Boolean);
  }))).sort((a, b) => String(a).localeCompare(String(b)));
}
function optionSummary(filters, key, rangeKeys = []) {
  if (rangeKeys.length) {
    const count = rangeKeys.filter((item) => String(filters[item] || '').trim()).length;
    return count ? `${count} set` : 'All';
  }
  const values = filters[key] || [];
  if (!values.length) return 'All';
  if (values.length === 1) return values[0];
  return `${values.length} selected`;
}
function toggleArrayValue(filters, key, value, allOptions = []) {
  const cleanOptions = (allOptions || []).filter((item) => String(item || '').trim() && item !== FILTER_ALL_MARKER);
  const rawCurrent = Array.isArray(filters[key]) ? filters[key] : [];
  const current = rawCurrent.includes(FILTER_ALL_MARKER) ? [...cleanOptions] : rawCurrent.filter((item) => item !== FILTER_ALL_MARKER);
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
  // Selecting every visible value remains a real filter. Blank/unfilled profiles must not be counted.
  return { ...filters, [key]: next };
}

function readSavedFilterPresets() {
  try {
    const parsed = JSON.parse(localStorage.getItem(FILTER_PRESET_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function countSelectedForSection(section, filters) {
  if (!section) return 0;
  if (section.type === 'options') {
    const values = Array.isArray(filters[section.key]) ? filters[section.key] : [];
    if (values.includes(FILTER_ALL_MARKER)) return Math.max(1, (section.options || []).length);
    return values.length;
  }
  return [filters[section.from], filters[section.to]].filter((item) => String(item || '').trim()).length;
}
function filtersHaveAnyValue(filters) {
  return Object.entries(filters || {}).some(([key, value]) => {
    if (key === 'bucket_view') return false;
    if (key === 'q') return String(value || '').trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return String(value || '').trim().length > 0;
  });
}

function buildCandidateQuery(filters, page = 1, pageSize = 10) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('page_size', String(pageSize));
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      // Select All now means exactly "all visible choices", NOT "remove this filter".
      // Old saved presets can still contain the historical marker, so skip only that marker.
      value.filter((item) => item && item !== FILTER_ALL_MARKER).forEach((item) => params.append(key, String(item)));
      return;
    }
    if (String(value ?? '').trim()) params.set(key, String(value));
  });
  return params.toString();
}

function formatBucketDate(value) {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}
function formatLastViewed(value) {
  if (!value) return 'Never';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatRelativeDays(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const diffDays = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 86400000));
  if (diffDays === 0) return 'Checked today';
  if (diffDays === 1) return '1 day ago';
  return `${diffDays} days ago`;
}

function formatDaysLeft(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  if (numeric <= 0) return 'Last day';
  if (numeric === 1) return '1 day left';
  return `${numeric} days left`;
}

function normalizeLastViewedMode(value) {
  return String(value || '').trim().toLowerCase();
}
function sanitizeLastViewedDays(value) {
  const digits = String(value || '').replace(/[^\d]/g, '').slice(0, 3);
  if (!digits) return '';
  const numeric = Math.max(1, Math.min(365, Number(digits) || 0));
  return numeric ? String(numeric) : '';
}
function lastViewedFilterSummary(filters) {
  const mode = normalizeLastViewedMode(filters?.last_viewed_mode);
  if (!mode) return 'All Last Viewed';
  if (mode === 'today') return 'Today';
  if (mode === 'lt1') return '< 1 Day';
  if (mode === 'lt2') return '< 2 Day';
  if (mode === 'lt5') return '< 5 Day';
  if (mode === 'custom') {
    const days = sanitizeLastViewedDays(filters?.last_viewed_days);
    return days ? `< ${days} Day` : 'Custom Days';
  }
  return 'All Last Viewed';
}
function toneForBucket(stage) {
  if (stage === 'last_day' || stage === 'bucket_out') return 'danger';
  if (stage === 'warning') return 'warn';
  if (stage === 'fresh') return 'info';
  if (stage === 'followup') return 'follow';
  return 'safe';
}
function priorityTone(priority) {
  const value = String(priority || '').toLowerCase();
  if (value === 'urgent' || value === 'expired') return 'priority-urgent';
  if (value === 'high') return 'priority-high';
  if (value === 'done') return 'priority-done';
  return 'priority-normal';
}

function instantOwnerRole(row) {
  const designation = String(row?.recruiter_designation || row?.role || '').trim().toLowerCase();
  if (designation.includes('admin')) return 'admin';
  if (designation === 'tl' || designation.includes('team lead') || designation.includes('teamlead')) return 'tl';
  if (designation.includes('manager')) return 'manager';
  if (designation.includes('recruit')) return 'recruiter';
  const code = String(row?.recruiter_code || '').trim().toUpperCase();
  if (code.startsWith('ADM')) return 'admin';
  if (code.startsWith('MGR')) return 'manager';
  if (code.startsWith('TL')) return 'tl';
  if (code.startsWith('CC') || code.startsWith('REC')) return 'recruiter';
  return '';
}
function instantIsAllocated(row) {
  const code = String(row?.recruiter_code || '').trim();
  const name = String(row?.recruiter_name || '').trim();
  if (!code && !name) return false;
  const role = instantOwnerRole(row);
  return role !== 'manager' && role !== 'admin';
}
function instantStableOrder(row) {
  const sr = Number(String(row?.source_sr_no || '').replace(/[^\d]/g, ''));
  if (Number.isFinite(sr) && sr > 0) return sr;
  const match = String(row?.candidate_id || '').match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}
// CC74: use the same prioritized current-owner identity as the backend.
// A TL's team visibility must not turn every team candidate into "My" profiles.
function instantBelongsToCurrentUser(row = {}, user = {}) {
  const tiers = [
    ['code', ['recruiter_code', 'assigned_to_code', 'owner_code']],
    ['id', ['recruiter_user_id', 'assigned_to_user_id', 'owner_user_id']],
    ['name', ['recruiter_name', 'assigned_to_name', 'owner_name']],
    ['code', ['employee_no', 'employee_code', 'submitted_by_recruiter_code']],
    ['id', ['user_id', 'submitted_by_user_id', 'created_by_user_id']],
    ['name', ['employee_name', 'submitted_by', 'submitted_by_name', 'created_by_name']],
  ];
  for (const [kind, fields] of tiers) for (const field of fields) {
    const value = String(row?.[field] || '').trim().toLowerCase();
    if (!value) continue;
    if (kind === 'code') return value.split(',').some((part) => part.trim() === String(user?.recruiter_code || '').trim().toLowerCase() && Boolean(user?.recruiter_code));
    if (kind === 'id') return value === String(user?.user_id || '').trim().toLowerCase() && Boolean(user?.user_id);
    return [user?.full_name, user?.username, user?.name].some((name) => name && String(name).trim().toLowerCase() === value);
  }
  return false;
}
function instantBucketMatches(row, view, user = null) {
  const key = String(view || 'all').toLowerCase();
  if (!key || key === 'all') return true;
  if (key === 'my_fresh') return Boolean(user && instantBelongsToCurrentUser(row, user) && row?.bucket_is_fresh && !row?.bucket_is_bucket_out);
  if (key === 'my_working') return Boolean(user && instantBelongsToCurrentUser(row, user) && row?.bucket_is_active && !row?.bucket_is_fresh && !row?.bucket_is_followup_due && !row?.bucket_is_bucket_out && !row?.bucket_is_terminal);
  if (key === 'fresh') return Boolean(row?.bucket_is_fresh) && !row?.bucket_is_bucket_out;
  if (key === 'followup') return Boolean(row?.bucket_is_active) && Boolean(row?.bucket_is_followup) && !row?.bucket_is_bucket_out;
  if (key === 'followup_due') return Boolean(row?.bucket_is_active) && Boolean(row?.bucket_is_followup_due) && !row?.bucket_is_bucket_out;
  if (key === 'allocated') return Boolean(row?.bucket_is_active);
  if (key === 'inactive') return isInactiveProfile(row);
  if (key === 'other' || key === 'unallocated') return !row?.bucket_is_active;
  if (key === 'warning') return row?.bucket_stage === 'warning';
  if (key === 'last_day') return row?.bucket_stage === 'last_day';
  if (key === 'days_1') return Boolean(row?.bucket_is_active) && Number(row?.bucket_days_left) === 1 && !row?.bucket_is_bucket_out;
  if (key === 'days_2') return Boolean(row?.bucket_is_active) && Number(row?.bucket_days_left) === 2 && !row?.bucket_is_bucket_out;
  if (key === 'days_3') return Boolean(row?.bucket_is_active) && Number(row?.bucket_days_left) === 3 && !row?.bucket_is_bucket_out;
  if (key === 'days_4_plus') return Boolean(row?.bucket_is_active) && Number(row?.bucket_days_left) >= 4 && !row?.bucket_is_bucket_out && !row?.bucket_is_terminal && !row?.bucket_is_fresh;
  return true;
}
function instantBucketSort(rows, view) {
  const key = String(view || 'all').toLowerCase();
  return [...rows].sort((a, b) => {
    const stable = () => (instantStableOrder(b) - instantStableOrder(a)) || String(b?.created_at || b?.updated_at || '').localeCompare(String(a?.created_at || a?.updated_at || '')) || String(b?.candidate_id || '').localeCompare(String(a?.candidate_id || ''));
    if (key === 'all') return stable();
    if (key === 'fresh') {
      const aTouched = String(a?.last_dialed_at || '').trim() ? 1 : 0;
      const bTouched = String(b?.last_dialed_at || '').trim() ? 1 : 0;
      if (aTouched !== bTouched) return aTouched - bTouched;
      if (!aTouched) return stable();
      const aDial = new Date(a?.last_dialed_at || 0).getTime() || 0;
      const bDial = new Date(b?.last_dialed_at || 0).getTime() || 0;
      if (aDial !== bDial) return aDial - bDial;
      return stable();
    }
    if (key === 'followup') {
      const aDate = new Date(a?.follow_up_at || 0).getTime() || Number.MAX_SAFE_INTEGER;
      const bDate = new Date(b?.follow_up_at || 0).getTime() || Number.MAX_SAFE_INTEGER;
      if (aDate !== bDate) return aDate - bDate;
      return stable();
    }
    const aLeft = Number.isFinite(Number(a?.bucket_days_left)) ? Number(a.bucket_days_left) : Number.MAX_SAFE_INTEGER;
    const bLeft = Number.isFinite(Number(b?.bucket_days_left)) ? Number(b.bucket_days_left) : Number.MAX_SAFE_INTEGER;
    if (aLeft !== bLeft) return aLeft - bLeft;
    return stable();
  });
}
function instantBucketSummaryCount(summary, view) {
  const key = String(view || 'all').toLowerCase();
  if (key === 'fresh') return Number(summary?.fresh_profiles || 0);
  if (key === 'allocated') return Number(summary?.allocated_profiles || 0);
  if (key === 'inactive') return Number(summary?.inactive_profiles || 0);
  if (key === 'other') return Number(summary?.other_profiles || 0);
  if (key === 'followup' || key === 'followup_due') return Number(key === 'followup_due' ? summary?.pending_followups : summary?.followup_profiles || 0);
  if (key === 'warning') return Number(summary?.warning_profiles || 0);
  if (key === 'last_day') return Number(summary?.last_day_profiles || 0);
  if (key === 'days_1') return Number(summary?.last_day_profiles || 0);
  return Number(summary?.total_visible || 0);
}

function readLatestDurableCandidatePatch() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('careerCroxRealtimeCandidatePatch:v2');
    if (!raw) return null;
    const payload = JSON.parse(raw);
    const item = payload?.item || {};
    const at = Number(item?.__cc_durable_frontend_at || payload?.at || 0);
    if (!item?.candidate_id || !item?.__cc_durable_frontend_pending || !at) return null;
    if (Date.now() - at >= 24 * 60 * 60 * 1000) return null;
    return item;
  } catch {
    return null;
  }
}

export default function CandidatesPage() {
  const projectScope=new URLSearchParams(window.location.search).get('project')||'';
  const inProject=row=>!projectScope||String(row.project_id||'')===(projectScope==='__solo__'?'':projectScope);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialSearchFilters = buildInitialFilters(searchParams);
  const explicitCriteria=Object.keys(defaultFilters).some(key=>searchParams.has(key));
  const { user } = useAuth();
  const leadership = ['admin', 'manager', 'tl'].includes(String(user?.role || '').toLowerCase());
  const isManager = ['admin', 'manager'].includes(String(user?.role || '').toLowerCase());
  const candidatesCacheKey = `careerCroxCandidatesFastCache:v837:${user?.user_id || user?.username || 'anon'}:${user?.role || ''}:${user?.recruiter_code || ''}`;
  const [allRows, setAllRows] = useState(() => readPageCache(candidatesCacheKey, []).filter(row=>candidateVisibleLocally(row,user)&&inProject(row)));
  const [filterRows, setFilterRows] = useState(() => readPageCache(`${candidatesCacheKey}:filter-options:v517`, []));
  const [selectableRows, setSelectableRows] = useState(() => readPageCache(`${candidatesCacheKey}:selectable`, []).filter(row=>candidateVisibleLocally(row,user)&&inProject(row)));
  const [totalRows, setTotalRows] = useState(() => Number(readPageCache(`${candidatesCacheKey}:metadata`, {})?.total || 0));
  const catalog=useCandidateFilterCatalog(user,projectScope);
  const roster=catalog.users||[];

  const [summary, setSummary] = useState(() => readPageCache(`${candidatesCacheKey}:metadata`, {})?.summary || {});
  const [bucketRefreshAt,setBucketRefreshAt]=useState('');
  const [draftCount,setDraftCount]=useState(0);
  useEffect(()=>{api.get('/api/profile-safety/drafts?count_only=1',{cacheTtlMs:60000}).then(d=>setDraftCount(d.total||0)).catch(()=>{});},[user?.user_id,user?.role,user?.__ccAccessRevision]);
  const [page, setPage] = useSliceState('candidates:'+projectScope+':page',1,explicitCriteria);
  const [pageJumpValue, setPageJumpValue] = useState('1');
  const pageSize = 10;
  const [filters, setFilters] = useSliceState('candidates:'+projectScope+':filters',()=>initialSearchFilters,explicitCriteria);
  useSliceSearch(filters.q||'',value=>setFilters(current=>({...current,q:value})));
  const sortBy = 'default'; // Fixed natural order: Candidate Tracker no longer exposes a sort control.
  const [message, setMessage] = useState('');
  const [deleteBusyId,setDeleteBusyId]=useState('');
  const [sliceLoading,setSliceLoading]=useState(false);
  const [waTemplates, setWaTemplates] = useState(getWhatsAppTemplates());
  const [selectedIds, setSelectedIds] = useState([]);
  const selectionAnchorRef = useRef(null);
  const [dialerOpen, setDialerOpen] = useState(false);
  const [dialerIndex, setDialerIndex] = useState(0);
  const [autoNextCountdown, setAutoNextCountdown] = useState(0);
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);
  const [filterSectionSearch, setFilterSectionSearch] = useState('');
  const [optionSearches, setOptionSearches] = useState({});
  const [activeFilterKey, setActiveFilterKey] = useState('location');
  const [uploadFilterOptions,setUploadFilterOptions]=useState({data_notes:[],upload_dates:[]});
  useEffect(()=>{if(!showFilterDrawer)return;let active=true;api.get('/api/candidates/upload-filters',{cacheTtlMs:30000,background:true,timeoutMs:10000}).then(d=>{if(active)setUploadFilterOptions({data_notes:d.data_notes||[],upload_dates:d.upload_dates||[]});}).catch(()=>{});return()=>{active=false;};},[showFilterDrawer,user?.user_id]);
  const [savedFilters, setSavedFilters] = useState(() => readSavedFilterPresets());
  const [presetName, setPresetName] = useState('');
  const [preferredLocationCatalog, setPreferredLocationCatalog] = useState(() => [...DEFAULT_PREFERRED_LOCATION_OPTIONS]);

  const loadSeqRef = useRef(0);
  const previewCountSeqRef = useRef(0);
  const [filterPreview,setFilterPreview] = useState({key:'',status:'idle',total:null});
  const autoBucketRecruiterRef = useRef(false);

  useEffect(() => {
    if (!showFilterDrawer) return undefined;
    document.body.classList.add('cc794-filter-open');
    return () => document.body.classList.remove('cc794-filter-open');
  }, [showFilterDrawer]);

  useEffect(() => {
    if (!showFilterDrawer) return undefined;
    let cancelled = false;
    api.get('/api/candidates/process-options', { cacheTtlMs: 300000, timeoutMs: 12000, retries: 0, background: false })
      .then((data) => {
        if (cancelled) return;
        const shared = Array.isArray(data?.preferred_location_options)
          ? data.preferred_location_options.map((item) => String(item || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
          : [];
        const next = shared.length ? mergeLocationOptions(shared, DEFAULT_PREFERRED_LOCATION_OPTIONS, []) : readStoredPreferredLocationOptions();
        setPreferredLocationCatalog(next);
        try {
          const custom = next.filter((item) => !DEFAULT_PREFERRED_LOCATION_OPTIONS.some((base) => normalizeLocationFilterValue(base) === normalizeLocationFilterValue(item)));
          localStorage.setItem(PREFERRED_LOCATION_STORAGE_KEY, JSON.stringify(custom));
        } catch {}
      })
      .catch(() => {
        // Fail closed: current/candidate location values must never leak into this filter.
        if (!cancelled) setPreferredLocationCatalog([...DEFAULT_PREFERRED_LOCATION_OPTIONS]);
      });
    return () => { cancelled = true; };
  }, [showFilterDrawer]);

  useEffect(()=>{const team=()=>load(1,filters,true).catch(()=>{});window.addEventListener('career-crox-team-changed',team);return()=>window.removeEventListener('career-crox-team-changed',team);},[filters]);
  async function load(targetPage=page,nextFilters=filters,force=false) {
    const loadSeq = ++loadSeqRef.current;setSliceLoading(true);
    try {
    const qs = buildCandidateQuery({...nextFilters,sort_by:sortBy},targetPage,pageSize)+(projectScope?'&project_id='+encodeURIComponent(projectScope):'');
    const exactSliceCacheKey = `${candidatesCacheKey}:slice:${qs}`;
    const exactCached = force ? null : readPageCache(exactSliceCacheKey,null);
    if (exactCached && Array.isArray(exactCached.items)) {
      const safe=exactCached.items.filter(row=>candidateVisibleLocally(row,user)&&inProject(row));
      setAllRows(safe);setSelectableRows(safe);
      if (Number.isFinite(Number(exactCached.total))) setTotalRows(Number(exactCached.total));
    }
    // Frontend-first: exact cached rows render immediately; backend verification continues behind them.
    const data = await api.get(`/api/candidates?${qs}${force ? '&_refresh='+Date.now() : ''}`, { cacheTtlMs: force?0:60000, timeoutMs: 12000, retries: 0, allowStale: false, background: false });
    if (loadSeq !== loadSeqRef.current) return;
    const serverItems = (Array.isArray(data?.items)?data.items:[]).filter(row=>candidateVisibleLocally(row,user)&&inProject(row));
    setBucketRefreshAt(data?.bucket_refresh_at || '');
    const serverFilterSource = Array.isArray(data?.filter_source_rows) ? data.filter_source_rows : [];
    // CC26_680: a successful Create/Submit is durable. If a just-committed row is already in the
    // local fast cache but the live list endpoint is briefly stale/older, never erase it from the
    // screen. Only locally marked durable rows are retained; normal stale/deleted rows are not.
    const canRetainDurable = !force && Number(targetPage || 1) === 1
      && !filtersHaveAnyValue(nextFilters)
      && String(nextFilters?.bucket_view || 'all') === 'all';
    const serverIds = new Set(serverItems.map((row) => String(row?.candidate_id || '').trim()).filter(Boolean));
    const cachedDurable = canRetainDurable
      ? (Array.isArray(readPageCache(candidatesCacheKey, [])) ? readPageCache(candidatesCacheKey, []) : [])
      : [];
    const latestDurable = canRetainDurable ? readLatestDurableCandidatePatch() : null;
    const durableMap = new Map();
    [...cachedDurable, ...(latestDurable ? [latestDurable] : [])]
      .filter(row=>candidateVisibleLocally(row,user)&&inProject(row))
      .filter((row) => row?.__cc_durable_frontend_pending)
      .filter((row) => Date.now() - Number(row?.__cc_durable_frontend_at || Date.now()) < 24 * 60 * 60 * 1000)
      .forEach((row) => {
        const id = String(row?.candidate_id || '').trim();
        if (id && !serverIds.has(id)) durableMap.set(id, row);
      });
    const durablePendingRows = canRetainDurable ? Array.from(durableMap.values()) : [];
    const items = canRetainDurable ? [...durablePendingRows, ...serverItems].slice(0, pageSize) : serverItems;
    const filterSource = durablePendingRows.length
      ? [...durablePendingRows, ...serverFilterSource.filter((row) => !durablePendingRows.some((pending) => String(pending?.candidate_id || '') === String(row?.candidate_id || '')))]
      : serverFilterSource;
    // CC26_100: Auto Dialer must load exactly the visible CRM table rows.
    // Hidden dialer_items/filter_source_rows caused app queue mismatch and wrong-profile calls.
    const selectable = items;
    setAllRows(items);
    setFilterRows((current) => {
      const hasActiveFilters = filtersHaveAnyValue(nextFilters);
      const defaultBucket = String(nextFilters?.bucket_view || 'all') === 'all';
      const canRefreshBaseFilterSource = (!hasActiveFilters && defaultBucket) || !current.length;
      const stableOptions = canRefreshBaseFilterSource ? filterSource : current;
      if (canRefreshBaseFilterSource) {
        writePageCache(`${candidatesCacheKey}:filter-options:v517`, stableOptions.slice(0, 5000));
      }
      return stableOptions;
    });
    setSelectableRows(selectable);
    writePageCache(candidatesCacheKey, items);
    writePageCache(`${candidatesCacheKey}:selectable`, selectable.slice(0, 1500));
    const serverTotal = Number(data?.total || 0);
    setTotalRows(serverTotal);
    const resolvedSummary=data?.summary||{};
    setSummary(resolvedSummary);
    if (!filtersHaveAnyValue(nextFilters)) writePageCache(`${candidatesCacheKey}:metadata`,{total:serverTotal,summary:resolvedSummary});
    writePageCache(exactSliceCacheKey, { items, total: serverTotal, summary: resolvedSummary });
    setPage(Number(data?.page || targetPage || 1));
    }catch(error){if(['DASHBOARD_CHANGED','BACKGROUND_ABORT','ACCOUNT_CHANGED'].includes(error?.code)||error?.name==='AbortError')return;if(loadSeq===loadSeqRef.current)setMessage(error.message||'This view could not refresh. Try again.');throw error;}finally{if(loadSeq===loadSeqRef.current)setSliceLoading(false);}
  }

  useEffect(()=>{
    let timer;
    const changed=event=>{const d=event.detail||{};if(event.type!=='career-crox-team-changed'&&!d.item?.candidate_id&&!/\/(candidates|bucket|flowchart|admin\/(?:upload|import))/.test(String(d.source||'')))return;clearTimeout(timer);timer=setTimeout(()=>load(page,filters,true).catch(()=>{}),350);};
    window.addEventListener('career-crox-workspace-change',changed);
    window.addEventListener('career-crox-team-changed',changed);
    return()=>{clearTimeout(timer);window.removeEventListener('career-crox-workspace-change',changed);window.removeEventListener('career-crox-team-changed',changed);};
  },[page,JSON.stringify(filters)]);
  useEffect(() => { load(page, filters).catch(() => {}); }, []);
  useEffect(() => { setPageJumpValue(String(page || 1)); }, [page]);
  useEffect(() => onCandidateRealtime(({ item }) => {
    const candidateId = String(item?.candidate_id || '').trim();
    if (!candidateId) return;
    if(!candidateVisibleLocally(item,user)||!inProject(item)) {
      setAllRows(rows=>rows.filter(row=>String(row.candidate_id)!==candidateId));
      setSelectableRows(rows=>rows.filter(row=>String(row.candidate_id)!==candidateId));
      return;
    }
    // On the default All Candidates first page, show the committed profile instantly.
    // Filtered pages keep their filter contract and the next manual/page load verifies backend state.
    if (page !== 1 || filtersHaveAnyValue(filters) || String(filters.bucket_view || 'all') !== 'all') return;
    setAllRows((current) => {
      const base = Array.isArray(current) ? current : [];
      const next = [item, ...base.filter((row) => String(row?.candidate_id || '') !== candidateId)].slice(0, pageSize);
      writePageCache(candidatesCacheKey, next);
      return next;
    });
    setFilterRows((current) => {
      const base = Array.isArray(current) ? current : [];
      const next = [item, ...base.filter((row) => String(row?.candidate_id || '') !== candidateId)].slice(0, 5000);
      writePageCache(`${candidatesCacheKey}:filter-options:v517`, next);
      return next;
    });
    setSelectableRows((current) => [item, ...(Array.isArray(current) ? current : []).filter((row) => String(row?.candidate_id || '') !== candidateId)].slice(0, pageSize));
    setTotalRows((current) => Math.max(Number(current || 0), 1));
  }), [candidatesCacheKey, page, JSON.stringify(filters)]);
  useSmartDeltaSync({
    scope: 'candidates',
    idKey: 'candidate_id',
    rows: allRows,
    query: buildCandidateQuery({...filters,sort_by:sortBy}, page, pageSize),
    keySuffix: `${page}:${sortBy}:${JSON.stringify(filters)}`,
    onRows: (changedRows) => {
      setAllRows((current) => mergeRowsById(current,changedRows,'candidate_id').filter(row=>candidateVisibleLocally(row,user)&&inProject(row)).slice(0, pageSize));
      setFilterRows((current) => mergeRowsById(current,changedRows,'candidate_id').filter(row=>candidateVisibleLocally(row,user)&&inProject(row)).slice(0, 5000));
    },
    onSnapshot: (snapshot) => {
      const durableRows = (Array.isArray(allRows) ? allRows : []).filter((row) => row?.__cc_durable_frontend_pending);
      if (snapshot?.summary) {
        setSummary((current) => {
          const next = { ...current, ...snapshot.summary };
          if (!durableRows.length) return next;
          return { ...next, total_visible: Math.max(Number(next.total_visible || 0), allRows.length) };
        });
      }
      if (Number.isFinite(Number(snapshot?.total))) {
        setTotalRows(durableRows.length ? Math.max(Number(snapshot.total || 0), allRows.length) : Number(snapshot.total || 0));
      }
    },
  });

  useEffect(()=>{
    const expired=()=>{
      setAllRows(rows=>rows.filter(row=>candidateVisibleLocally(row,user)&&inProject(row)));
      setSelectableRows(rows=>rows.filter(row=>candidateVisibleLocally(row,user)&&inProject(row)));
      load(page,filters,true).catch(error=>setMessage(error.message||'Bucket refresh failed.'));
    };
    const deadline=Date.parse(bucketRefreshAt);
    const delay=deadline-Date.now();
    const timer=Number.isFinite(deadline)?setTimeout(expired,Math.min(Math.max(0,delay)+100,2147483647)):null;
    const onFocus=()=>{if(!document.hidden&&Number.isFinite(deadline)&&Date.now()>=deadline)expired()};
    const onResume=()=>{if(!document.hidden)load(page,filters,true).catch(error=>setMessage(error.message||'Refresh failed.'));};
    window.addEventListener('focus',onFocus);
    document.addEventListener('visibilitychange',onFocus);
    window.addEventListener('career-crox-tab-resumed',onResume);
    return()=>{if(timer)clearTimeout(timer);window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onFocus);window.removeEventListener('career-crox-tab-resumed',onResume)};
  },[bucketRefreshAt,page,JSON.stringify(filters),user?.user_id,user?.__ccAccessRevision]);

  const optionSourceRows = useMemo(() => (filterRows.length ? filterRows : allRows), [filterRows, allRows]);
  const filterOptionSourceRows = useMemo(() => catalog.rows||[], [catalog.rows]);


  function openCandidateProfile(row) {
    if (!row?.candidate_id) return;
    const navRows = filteredRows.length ? filteredRows : (optionSourceRows.length ? optionSourceRows : allRows);
    openCandidateProfileInSameTab(row, navRows, {
      sourcePath: `${window.location.pathname}${window.location.search || ''}`,
      sourceApi: `/api/candidates?${buildCandidateQuery(filters, page, pageSize)}`,
      sourceKind: 'candidates',jump:searchParams.get('add-note')==='1'?'notes':searchParams.get('add-interview')==='1'?'interview':'',
      page,
      pageSize,
      totalRows,
      hasMore: page * pageSize < Number(totalRows || 0),
    });
  }
  const recruiterChoices=useMemo(()=>roster.map(u=>({value:u.recruiter_code||u.user_id,label:u.full_name||u.username||u.recruiter_code,role:u.role})).filter(u=>u.value).sort((a,b)=>a.label.localeCompare(b.label)),[roster]);
  const recruiterOptions=useMemo(()=>recruiterChoices.map(o=>o.value),[recruiterChoices]);
  const preferredLocationFilterOptions = useMemo(() => {
    // IMPORTANT: never build this list from candidate rows. Old candidate data can
    // contain current addresses/pincodes. Only the configured Preferred Location
    // catalog is allowed here.
    return mergeLocationOptions(preferredLocationCatalog, DEFAULT_PREFERRED_LOCATION_OPTIONS, uniqueOptions(catalog.rows||[],row=>row.preferred_location,true));
  }, [preferredLocationCatalog,catalog.rows]);

  useEffect(() => {
    const allowed = new Set(preferredLocationFilterOptions.map((item) => normalizeLocationFilterValue(item)));
    setFilters((prev) => {
      const current = Array.isArray(prev.preferred_location) ? prev.preferred_location : [];
      const cleaned = current.filter((item) => item === FILTER_ALL_MARKER || allowed.has(normalizeLocationFilterValue(item)));
      if (cleaned.length === current.length && cleaned.every((item, index) => item === current[index])) return prev;
      return { ...prev, preferred_location: cleaned };
    });
  }, [preferredLocationFilterOptions.join('|')]);


  async function deleteCandidate(candidateId, fullName) {
    if (!isManager || deleteBusyId) return;
    const reason=await requestProfileDelete({candidateIds:[candidateId],name:fullName});
    if(reason===null)return;
    try {
      setDeleteBusyId(candidateId);
      const receipt=await api.post(`/api/candidates/${encodeURIComponent(candidateId)}/delete`, {reason}, {retries:0});
      if(![...(receipt.deleted_ids||[]),...(receipt.soft_hidden_ids||[])].includes(candidateId))throw new Error('Database did not confirm removal');
      emitCandidateUpsert({candidate_id:candidateId,status:'__deleted__',deleted_at:new Date().toISOString()},{removed:true});
      setAllRows(rows=>rows.filter(row=>row.candidate_id!==candidateId));
      setSelectableRows(rows=>rows.filter(row=>row.candidate_id!==candidateId));
      setMessage(`${fullName || candidateId} deleted.`);
      setSelectedIds((prev) => prev.filter((item) => item !== normalizeId(candidateId)));
      await load(page, filters);
    } catch (error) {
      setMessage(error.message || 'Delete failed');
    } finally {setDeleteBusyId('');}
  }

  const filterSections = useMemo(() => {
    const sections = [
      // CC26_518: filter order follows the user's numbered priority. Decimal numbers
      // mean "between" positions (2.5 after 2, 3.5 after 3).
      { key: 'recruiter_code', label: 'Recruiter', type: 'options', options: recruiterOptions },
      { key: 'status', label: 'Status', type: 'options', options: uniqueOptions(filterOptionSourceRows, (row) => row.status) },
      { key: 'submission_date', label: 'Submission Date', type: 'date-range', from: 'submission_from', to: 'submission_to' },
      { key: 'preferred_location', label: 'Preferred Location', type: 'options', options: preferredLocationFilterOptions },
      { key: 'interview_date', label: 'Interview date', type: 'date-range', from: 'interview_from', to: 'interview_to' },
      { key: 'qualification', label: 'Degree / Qualification', type: 'options', options: DEGREE_FILTER_OPTIONS },
      { key: 'course_name', label: 'Course Name', type: 'options', options: uniqueOptions(filterOptionSourceRows, (row) => row.course_name) },
      { key: 'relevant_experience_range', label: 'Relevant Exp Range', type: 'options', options: uniqueOptions(filterOptionSourceRows, (row) => row.relevant_experience_range) },
      { key: 'relevant_in_hand_range', label: 'Relevant In-hand Range', type: 'options', options: uniqueOptions(filterOptionSourceRows, (row) => row.relevant_in_hand_range) },
      { key: 'communication_skill', label: 'Communication Skill', type: 'options', options: uniqueOptions(filterOptionSourceRows, (row) => row.communication_skill) },
      { key: 'career_gap', label: 'Career Gap', type: 'options', options: uniqueOptions(filterOptionSourceRows, (row) => row.career_gap) },
      { key: 'documents_availability', label: 'All Documents Availability', type: 'options', options: uniqueOptions(filterOptionSourceRows, (row) => row.documents_availability) },

      // Unnumbered filters stay available after the requested sequence, preserving
      // their prior relative order so no feature disappears.
      { key: 'sr', label: 'Sr. No.', type: 'range', from: 'sr_from', to: 'sr_to' },
      { key: 'location', label: 'Candidate location', type: 'options', options: uniqueOptions(filterOptionSourceRows, (row) => row.location, true) },
      { key: 'salary', label: 'In-Hand Salary', type: 'range', from: 'salary_from', to: 'salary_to' },
      { key: 'relevant_exp', label: 'Relevant Experience', type: 'range', from: 'relevant_exp_from', to: 'relevant_exp_to' },
      { key: 'total_exp', label: 'Total Experience', type: 'range', from: 'total_exp_from', to: 'total_exp_to' },
      { key: 'process', label: 'Process', type: 'options', options: uniqueOptions(filterOptionSourceRows, (row) => row.process, true) },
      { key: 'data_notes', label: 'Data Notes', type: 'options', options: [...new Set([...uploadFilterOptions.data_notes,...uniqueOptions(filterOptionSourceRows, (row) => candidateDataNotesOptionValues(row))])].sort() },
      { key: 'data_uploading_date', label: 'Data Upload Date', type: 'date-range', from: 'data_uploading_from', to: 'data_uploading_to' },
      { key: 'virtual_onsite', label: 'Virtual / Onsite', type: 'options', options: uniqueOptions(filterOptionSourceRows, (row) => row.virtual_onsite) },
      { key: 'all_details_sent', label: 'ALL Details sent', type: 'options', options: uniqueOptions(filterOptionSourceRows, (row) => row.all_details_sent) },
      { key: 'call_connected', label: 'Call Connected', type: 'options', options: uniqueOptions(filterOptionSourceRows, (row) => row.call_connected) },
      { key: 'submitted_by', label: 'Submitted By', type: 'options', options: uniqueOptions(filterOptionSourceRows, (row) => row.submitted_by) },
      { key: 'approval_status', label: 'Approved by Manager', type: 'options', options: uniqueOptions(filterOptionSourceRows, (row) => row.approval_status) },
    ];
    return sections.map((section,index)=>({...section,number:index+1}));
  }, [filterOptionSourceRows, preferredLocationFilterOptions, uploadFilterOptions,recruiterOptions]);

  const activeFilterSection = useMemo(() => filterSections.find((section) => section.key === activeFilterKey) || filterSections[0] || null, [filterSections, activeFilterKey]);
  const activeOptionSearch = optionSearches[activeFilterSection?.key] || '';
  const activeVisibleOptions = useMemo(() => {
    if (!activeFilterSection || activeFilterSection.type !== 'options') return [];
    return (activeFilterSection.options || []).filter((item) => containsText(activeFilterSection.key==='recruiter_code'?(recruiterChoices.find(o=>o.value===item)?.label||item):item, activeOptionSearch));
  }, [activeFilterSection, activeOptionSearch,recruiterChoices]);
  const mostUsedPresets = useMemo(() => {
    return [...savedFilters]
      .sort((a, b) => (b.use_count || 0) - (a.use_count || 0) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
      .slice(0, 5);
  }, [savedFilters]);

  useEffect(() => {
    try { localStorage.setItem(FILTER_PRESET_STORAGE_KEY, JSON.stringify(savedFilters)); } catch {}
  }, [savedFilters]);

  useEffect(() => {
    if (!activeFilterSection && filterSections[0]) setActiveFilterKey(filterSections[0].key);
  }, [activeFilterSection, filterSections]);

  const filterLoadMountedRef = useRef(false);
  useEffect(() => {
    // CC26_694: the initial page already loads above. Do not schedule the same query again
    // 220ms later; this removes duplicate React work while the API dedupe remains a safety net.
    if (!filterLoadMountedRef.current) {
      filterLoadMountedRef.current = true;
      return undefined;
    }
    if (showFilterDrawer) return undefined;
    const timer = window.setTimeout(() => {
      load(1, filters).catch(() => {});
    }, 220);
    return () => window.clearTimeout(timer);
  }, [JSON.stringify(filters), sortBy, showFilterDrawer]);

  const previewFilterKey = buildCandidateQuery(filters,1,1)+(projectScope?'&project_id='+encodeURIComponent(projectScope):'');
  useEffect(() => {
    if (!showFilterDrawer) return undefined;
    const sequence = ++previewCountSeqRef.current;
    let cancelled = false;
    setFilterPreview({key:previewFilterKey,status:'loading',total:null});
    const timer = window.setTimeout(() => {
      api.get(`/api/candidates?${previewFilterKey}&count_only=1&include_distribution=1`,{cacheTtlMs:0,timeoutMs:12000,retries:0,allowStale:false,background:false})
        .then(data => {if(cancelled || sequence!==previewCountSeqRef.current)return;
          if(data?.count_only!==true || !Number.isFinite(Number(data.total)))throw Error('Count not confirmed');
          setFilterPreview({key:previewFilterKey,status:'ready',total:Number(data.total),locations:data.location_counts||[]});
        }).catch(() => {if(!cancelled && sequence===previewCountSeqRef.current)setFilterPreview({key:previewFilterKey,status:'error',total:null});});
    },140);
    return () => {cancelled=true;window.clearTimeout(timer);};
  },[showFilterDrawer,previewFilterKey]);

  const filteredRows = allRows;
  const visibleRowIds = useMemo(() => Array.from(new Set(filteredRows.map((row) => normalizeId(row.candidate_id)).filter(Boolean))), [filteredRows]);
  // CC26_100: selection is locked to the currently loaded/visible page only.
  // This prevents CRM from sending hidden filtered rows to the mobile APK.
  const selectableRowIds = visibleRowIds;

  const selectedRows = useMemo(() => {
    const rowById = new Map(filteredRows.map((row) => [normalizeId(row.candidate_id), row]));
    return selectedIds.map(normalizeId).map((id) => rowById.get(id)).filter(Boolean);
  }, [filteredRows, selectedIds]);
  const currentDialerTarget = selectedRows[dialerIndex] || selectedRows[0] || null;
  const allSelected = selectableRowIds.length > 0 && selectableRowIds.every((id) => selectedIds.includes(id));
  const activeFilterCount = useMemo(() => {
    const sectionCount = filterSections.reduce((count, section) => count + (countSelectedForSection(section, filters) ? 1 : 0), 0);
    return sectionCount + (String(filters.q || '').trim() ? 1 : 0);
  }, [filters, filterSections]);
  const matchingProfileCount = filterPreview.key===previewFilterKey && filterPreview.status==='ready' ? filterPreview.total : null;
  const matchingProfileLabel = matchingProfileCount===null ? (filterPreview.status==='error' ? 'Count unavailable' : 'Checking matches…') : `${matchingProfileCount} matching profiles`;

  const totalPages = useMemo(() => Math.max(1, Math.ceil((Number(totalRows || 0) || 0) / pageSize)), [totalRows]);
  const pageButtons = useMemo(() => {
    if (totalPages <= 1) return [1];
    const set = new Set([1, totalPages, page, page - 1, page + 1]);
    if (page <= 3) [2, 3, 4].forEach((item) => set.add(item));
    if (page >= totalPages - 2) [totalPages - 1, totalPages - 2, totalPages - 3].forEach((item) => set.add(item));
    return [...set].filter((item) => item >= 1 && item <= totalPages).sort((a, b) => a - b);
  }, [page, totalPages]);

  const bucketCards = useMemo(() => (leadership ? [
    { key: 'all', label: 'Total Profiles', value: summary.total_visible || 0, note: `${summary.allocated_profiles || 0} allocated live`, tone: 'blue' },
    { key: 'fresh', label: 'Fresh Profile', value: summary.fresh_profiles || 0, note: 'Not worked yet', tone: 'green' },
    { key: 'allocated', label: 'Allocated', value: summary.allocated_profiles || 0, note: 'Active buckets', tone: 'teal' },
    { key: 'other', label: 'Unallocated', value: summary.other_profiles ?? Math.max(0, Number(summary.total_visible || 0) - Number(summary.allocated_profiles || 0)), note: 'Closed, expired or outside bucket', tone: 'purple' },
    { key: 'followup_due', label: 'Follow Up Due', value: summary.pending_followups || 0, note: `${summary.followup_profiles || 0} total follow ups`, tone: 'purple' },
    { key: 'warning', label: 'Warning', value: summary.warning_profiles || 0, note: '2-5 days left', tone: 'orange' },
    { key: 'last_day', label: 'Last Day', value: summary.last_day_profiles || 0, note: 'Call first', tone: 'red' },
    { key: 'inactive', label: 'Not Interested / Rejected', value: summary.inactive_profiles || 0, note: 'Includes Not Responding', tone: 'red' },
  ] : [
    { key: 'all', label: 'Total Profiles', value: summary.total_visible || 0, note: 'Profiles in this dashboard', tone: 'blue' },
    { key: 'allocated', label: 'Active Bucket', value: String(summary.active_bucket || 0)+'/70', note: 'Active allocated', tone: 'teal' },
    { key: 'other', label: 'Unallocated', value: summary.other_profiles ?? Math.max(0,Number(summary.total_visible||0)-Number(summary.active_bucket||0)), note: 'Closed, expired or outside bucket', tone: 'pink' },
    { key: 'my_working', label: 'Working', value: summary.my_working_profiles || 0, note: 'Work in progress', tone: 'purple' },
    { key: 'fresh', label: 'Fresh Profile', value: summary.fresh_profiles || 0, note: 'Not worked yet', tone: 'green' },
    { key: 'followup', label: 'Follow Up', value: summary.followup_profiles || 0, note: 'Need callback', tone: 'purple' },
    { key: 'warning', label: 'Warning', value: summary.warning_profiles || 0, note: '2-5 days left', tone: 'orange' },
    { key: 'last_day', label: 'Last Day', value: summary.last_day_profiles || 0, note: 'Call first', tone: 'red' },
    { key: 'inactive', label: 'Not Interested / Rejected', value: summary.inactive_profiles || 0, note: 'Includes Not Responding', tone: 'red' },
  ]), [summary, leadership, user?.full_name]);

  const quickFilters = useMemo(() => (leadership ? [
    ['all', 'All Profiles'],
    ['fresh', 'Fresh Profile'],
    ['allocated', 'Allocated'],
    ['followup_due', 'Follow Up Due'],
    ['warning', 'Warning'],
    ['last_day', 'Last Day'],
  ] : [
    ['all', 'All Profiles'],
    ['fresh', 'Fresh Profile'],
    ['followup', 'Follow Up'],
    ['days_1', '1 Day Left'],
    ['days_2', '2 Days Left'],
    ['days_3', '3 Days Left'],
    ['days_4_plus', '4+ Days'],
    ['warning', 'Warning'],
    ['last_day', 'Last Day'],
  ]), [leadership]);

  useEffect(() => {
    setSelectedIds((prev) => prev.map(normalizeId).filter((id) => selectableRowIds.includes(id)));
  }, [selectableRowIds]);

  useEffect(() => {
    if (!selectedRows.length) {
      setDialerOpen(false);
      setDialerIndex(0);
      return;
    }
    if (dialerIndex >= selectedRows.length) setDialerIndex(0);
  }, [selectedRows.length, dialerIndex]);

  async function dialCandidate(candidateId, phone) {
    dialCandidateWithLog(candidateId, phone);
  }

  function openWhatsApp(candidateId, phone, template = '') {
    openWhatsAppWithLog(candidateId, phone, template);
  }

  function onTemplatePick(row, value) {
    if (!value) return;
    if (value === '__add_new__') {
      const fresh = window.prompt('Type new WhatsApp template');
      if (fresh) setWaTemplates(addWhatsAppTemplate(fresh));
      return;
    }
    const template = decodeWhatsAppTemplateOption(value);
    if (!template?.body) return;
    openWhatsApp(row.candidate_id, row.phone, renderWhatsAppTemplateBody(template.body, row, user));
  }

  function onDialerTemplatePick(value) {
    if (!currentDialerTarget || !value) return;
    if (value === '__add_new__') {
      const fresh = window.prompt('Type new WhatsApp template');
      if (fresh) setWaTemplates(addWhatsAppTemplate(fresh));
      return;
    }
    const template = decodeWhatsAppTemplateOption(value);
    if (!template?.body) return;
    openWhatsApp(currentDialerTarget.candidate_id, currentDialerTarget.phone, renderWhatsAppTemplateBody(template.body, currentDialerTarget, user));
  }

  function toggleSelection(candidateId, event) {
    const id = normalizeId(candidateId);
    const shiftKey = Boolean(event?.shiftKey || event?.nativeEvent?.shiftKey);
    const anchorId = selectionAnchorRef.current;
    setSelectedIds(current => updateRowSelection(current, selectableRowIds, id, { shiftKey, anchorId }));
    if (!shiftKey || !selectableRowIds.includes(anchorId)) selectionAnchorRef.current = id;
  }

  function toggleSelectAll() {
    selectionAnchorRef.current = null;
    setSelectedIds((prev) => allSelected ? prev.filter((id) => !selectableRowIds.includes(id)) : Array.from(new Set([...prev, ...selectableRowIds])));
  }

  function clearSelection() {
    selectionAnchorRef.current = null;
    setSelectedIds([]);
    setDialerOpen(false);
    setDialerIndex(0);
    setAutoNextCountdown(0);
  }

  async function loadSelectedToAutoDialer() {
    if (!selectedRows.length) return;
    const startRow = currentDialerTarget || selectedRows[0];
    const startId = normalizeId(startRow?.candidate_id);
    const startIndex = selectedRows.findIndex((row) => normalizeId(row.candidate_id) === startId);
    const orderedItems = startIndex > 0 ? [...selectedRows.slice(startIndex), ...selectedRows.slice(0, startIndex)] : selectedRows;
    // CC59: transfer only needed profile fields; don't silently open an empty dialer on storage-quota errors.
    const payload = makeDialerQueuePayload(orderedItems, { source: 'Candidates', start_candidate_id: startId, owner_user_id: user?.user_id || '' });
    if (!payload.items.length) {
      window.alert('Selected profiles have no valid candidate ID + phone number. Check candidate details first.');
      return;
    }
    const saved = storeDialerQueue(payload);
    // Same-origin BroadcastChannel handshake also works when localStorage is already full.
    const stopServing = serveDialerQueue(payload);
    if (!saved.local && !stopServing) {
      // No cross-tab transfer is possible. Never open a misleading blank new tab.
      window.alert('Browser storage is full/blocked. Enable site storage for this CRM and retry. Your candidate selection is safe.');
      return;
    }
    const target = `/auto-dialer?queue_id=${encodeURIComponent(payload.transfer_id)}`;
    window.open(target, '_blank', 'noopener,noreferrer');
  }


  function markCallDoneAndAutoNext() {
    if (!selectedRows.length) return;
    setAutoNextCountdown(7);
  }

  function nextSelected() {
    if (!selectedRows.length) return;
    setDialerIndex((prev) => (prev + 1) % selectedRows.length);
  }

  function prevSelected() {
    if (!selectedRows.length) return;
    setDialerIndex((prev) => (prev - 1 + selectedRows.length) % selectedRows.length);
  }

  useEffect(() => {
    if (!autoNextCountdown) return undefined;
    const timer = window.setTimeout(() => {
      setAutoNextCountdown((current) => {
        if (current <= 1) {
          window.setTimeout(() => nextSelected(), 0);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [autoNextCountdown, selectedRows.length]);

  function goToPage(targetPage) {
    const nextPage = Math.min(totalPages, Math.max(1, Number(targetPage || 1) || 1));
    setPageJumpValue(String(nextPage));
    load(nextPage, filters).catch(() => {});
  }

  function submitPageJump() {
    goToPage(pageJumpValue);
  }

  function resetFilters() {
      setPage(1);
    setFilters((current) => ({ ...defaultFilters, q: current.q, bucket_view: 'all' }));
    setOptionSearches({});
  }

  function clearCurrentSection(section) {
    if (!section) return resetFilters();
    if (section.type === 'options') setFilters((prev) => ({ ...prev, [section.key]: [] }));
    else setFilters((prev) => ({ ...prev, [section.from]: '', [section.to]: '' }));
    setOptionSearches((prev) => ({ ...prev, [section.key]: '' }));
  }

  function saveCurrentPreset() {
    if (!filtersHaveAnyValue(filters)) {
      setMessage('Select at least one filter before saving.');
      return;
    }
    const name = String(presetName || '').trim() || `Filter ${savedFilters.length + 1}`;
    const existing = savedFilters.find((item) => String(item.name || '').toLowerCase() === name.toLowerCase());
    const nextItem = {
      id: existing?.id || `flt_${Date.now()}`,
      name,
      filters,
      use_count: existing?.use_count || 0,
      updated_at: new Date().toISOString(),
    };
    const next = existing
      ? savedFilters.map((item) => item.id === existing.id ? nextItem : item)
      : [nextItem, ...savedFilters].slice(0, 20);
    setSavedFilters(next);
    setPresetName('');
    setMessage(`Filter "${name}" saved successfully.`);
  }

  function applyPreset(preset) {
    if (!preset?.filters) return;
    setFilters({ ...defaultFilters, ...preset.filters });
    const next = savedFilters.map((item) => item.id === preset.id ? { ...item, use_count: Number(item.use_count || 0) + 1, updated_at: new Date().toISOString() } : item);
    setSavedFilters(next);
    const firstUsedSection = filterSections.find((section) => countSelectedForSection(section, { ...defaultFilters, ...preset.filters }) > 0) || filterSections[0];
    if (firstUsedSection) setActiveFilterKey(firstUsedSection.key);
    setMessage(`Filter "${preset.name}" applied successfully.`);
  }

  function deletePreset(presetId) {
    setSavedFilters((prev) => prev.filter((item) => item.id !== presetId));
  }

  function showInstantBucketPreview(nextFilters, requestedView) {
    const qs = buildCandidateQuery(nextFilters, 1, pageSize);
    const exact = readPageCache(`${candidatesCacheKey}:slice:${qs}`, null);
    if (exact && Array.isArray(exact.items)) {
      setAllRows(exact.items);
      setSelectableRows(exact.items);
      if (Number.isFinite(Number(exact.total))) setTotalRows(Number(exact.total));
      return true;
    }
    const source = readPageCache(`${candidatesCacheKey}:filter-options:v517`, filterRows);
    const completeSource = Array.isArray(source) && source.length > 0 && Number(summary?.total_visible || 0) <= source.length;
    const unsupported = Object.entries(nextFilters || {}).some(([key, value]) => {
      if (['bucket_view', 'recruiter_code'].includes(key)) return false;
      if (key === 'q') return Boolean(String(value || '').trim());
      return Array.isArray(value) ? value.length > 0 : Boolean(String(value || '').trim());
    });
    if (!completeSource || unsupported) return false;
    const recruiterCode = String((nextFilters?.recruiter_code || [])[0] || '').trim().toLowerCase();
    const effectiveView = requestedView;
    // This is only used when source contains the COMPLETE visible result set.
    // Count from the exact same filtered rows as the preview; never invent a
    // "days_1" or "My Fresh" number from another card's cached summary.
    const matchingRows = source.filter((row) => {
      if (recruiterCode && String(row?.recruiter_code || '').trim().toLowerCase() !== recruiterCode) return false;
      return instantBucketMatches(row, effectiveView, user);
    });
    const preview = sortCrmRows(instantBucketSort(matchingRows, effectiveView),sortBy).slice(0, pageSize);
    setAllRows(preview);
    setSelectableRows(preview);
    setTotalRows(matchingRows.length);
    return true;
  }

  function setBucketView(bucketView) {
    setPage(1);
    setFilters((prev) => {
      // CC74: My Fresh/Working are server-side OWNED slice filters. Do not
      // approximate them as recruiter_code+fresh/allocated: legacy rows may
      // belong by user id/name and allocated includes somebody else's team.
      const next = { ...prev, bucket_view: bucketView, recruiter_code: autoBucketRecruiterRef.current ? [] : prev.recruiter_code };
      autoBucketRecruiterRef.current = false;
      if(!showInstantBucketPreview(next,bucketView)){setSliceLoading(true);setAllRows([]);setSelectableRows([]);}
      setSelectedIds([]);
      return next;
    });
  }

  return (
    <Layout title="Candidates" subtitle="">
      {searchParams.get('add-note')==='1'||searchParams.get('add-interview')==='1'?<div className="panel cc790-action-banner">Choose a candidate to {searchParams.get('add-note')==='1'?'add a note':'schedule an interview'}.</div>:null}
      {!!message && <div className="panel top-gap-small"><div className="helper-text">{message}</div></div>}

      <div ref={node=>compactCandidateCards(node,bucketCards.length+3)} className="bucket-card-grid cc863-candidate-stats cc878-candidate-stats top-gap-small fade-up">
        {bucketCards.map((card) => {
          const active = filters.bucket_view === card.key || (card.key === 'all' && !filters.bucket_view);
          return (
            <button key={card.key} type="button" className={`stat-card bucket-click-card ${card.tone} ${active ? 'active' : ''}`} onClick={() => setBucketView(card.key)}>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <small>{card.note}</small>
            </button>
          );
        })}
        <button type="button" className="stat-card bucket-click-card purple" onClick={()=>navigate('/candidate-drafts')}><strong>{draftCount}</strong><span>{leadership?'Drafts':'My Drafts'}</span><small>{isManager?'All employee drafts':leadership?'Your team drafts':'Your unfinished profiles'}</small></button>
        <LostProfilesCard/><AllocationLockedCard/>
      </div>

      <p className="cc878-card-equation">Total <b>{summary.total_visible||0}</b> = Allocated <b>{summary.active_bucket||0}</b> + Unallocated <b>{summary.other_profiles??Math.max(0,Number(summary.total_visible||0)-Number(summary.active_bucket||0))}</b><span>Drafts are separate. Follow-ups and warning cards can overlap.</span></p>
      <div className="table-panel top-gap-small glassy-card fade-up bucket-toolbar-panel">
        <div className="table-toolbar no-wrap-toolbar bucket-toolbar-stack cc876-candidate-tracker-head">
          <div>
            <div className="table-title">{leadership ? 'Candidate Tracker' : `${user?.full_name||'My'} · Profiles`}</div>
            {isManager&&<a className="ghost-btn" href="/profile-safety" target="_blank" rel="noopener noreferrer">Profile Safety</a>}<a className="ghost-btn" href="/candidate-drafts" target="_blank" rel="noopener noreferrer">My Drafts</a><div className="helper-text">{leadership ? `Total CRM profiles: ${summary.total_visible || 0} • Fresh: ${summary.fresh_profiles || 0} • Allocated: ${summary.allocated_profiles || 0}` : `Bucket used: ${summary.active_bucket || 0}/70 • Expired profiles remain in Unallocated.`}</div>
          </div>
          
          <div data-cc929-tools="true" className="toolbar-actions compact-pills candidate-toolbar-actions bucket-head-actions">
            <span className="metric-mini-chip records">{totalRows} records</span>
            {activeFilterCount ? <span className="metric-mini-chip filters">{activeFilterCount} filters</span> : null}
            {leadership ? (
              <label className="compact-select-shell shell-sky candidate-recruiter-shell">
                <span className="compact-shell-label">Recruiter</span>
                <RecruiterMultiSelect options={recruiterChoices} value={filters.recruiter_code||[]} onChange={values=>{autoBucketRecruiterRef.current=false;setFilters(prev=>({...prev,recruiter_code:values}));}}/>
              </label>
            ) : null}
            <button type="button" className="ghost-btn bounceable modern-filter-btn gradient-action-btn gradient-slate" onClick={() => { setShowFilterDrawer(true); }}><FilterIcon /> Filters</button>
          </div>
        </div>

        <div className="cc783-candidate-tools"><div className="bucket-quick-filter-row">
          <label className="compact-select-shell shell-sky candidate-recruiter-shell">
            <span className="compact-shell-label">Last Viewed</span>
            <PremiumSelect
              className="inline-input compact-inline-input bucket-target-select"
              value={filters.last_viewed_mode || ''}
              onChange={(e) => {
                const nextMode = String(e.target.value || '');
                setPage(1);
                setFilters((prev) => ({
                  ...prev,
                  last_viewed_mode: nextMode,
                  last_viewed_days: nextMode === 'custom' ? prev.last_viewed_days : '',
                }));
              }}
            >
              <option value="">All Last Viewed</option>
              <option value="today">Today</option>
              <option value="lt1">&lt; 1 Day</option>
              <option value="lt2">&lt; 2 Day</option>
              <option value="lt5">&lt; 5 Day</option>
              <option value="custom">Custom Days</option>
            </PremiumSelect>
          </label>
          {filters.last_viewed_mode === 'custom' ? (
            <label className="compact-select-shell shell-sky candidate-recruiter-shell">
              <span className="compact-shell-label">Days</span>
              <input
                className="inline-input compact-inline-input bucket-target-select"
                type="number"
                min="1"
                max="365"
                value={filters.last_viewed_days || ''}
                onChange={(e) => {
                  const nextDays = sanitizeLastViewedDays(e.target.value);
                  setPage(1);
                  setFilters((prev) => ({ ...prev, last_viewed_days: nextDays }));
                }}
                placeholder="10"
              />
            </label>
          ) : null}
          {filters.last_viewed_mode ? (
            <button type="button" className="bucket-quick-pill bounceable active" onClick={() => { setPage(1); setFilters((prev) => ({ ...prev, last_viewed_mode: '', last_viewed_days: '' })); }}>
              {lastViewedFilterSummary(filters)}
            </button>
          ) : null}
        </div>

        <div className="candidate-master-row">
          <button type="button" className={`selection-master-pill bounceable ${allSelected ? 'active' : ''}`} onClick={toggleSelectAll}>
            <span className="selection-master-icon"><SelectAllIcon /></span>
            {allSelected ? 'Clear All' : `Select All ${selectableRowIds.length || ''}`} 
          </button>
          <span className="selection-count-chip">{selectedIds.length} selected</span>
          <button type="button" className={`open-dialer-pill bounceable ${selectedRows.length >= 2 ? 'active' : ''}`} onClick={() => setDialerOpen((prev) => selectedRows.length >= 2 ? !prev : false)} disabled={selectedRows.length < 2}>
            <DialerIcon /> Dialer
          </button>
          <button type="button" className="add-profile-btn bounceable" onClick={loadSelectedToAutoDialer} disabled={selectedRows.length < 1}>Load to Auto Dialer</button>
          {selectedRows.length ? <button type="button" className="ghost-btn bounceable" onClick={clearSelection}>Clear Selection</button> : null}
        </div>

        </div>
        {dialerOpen && currentDialerTarget ? (
          <div className="floating-dialer show top-gap-small">
            <div className="dialer-head">
              <div>
                <h3 className="dialer-title">Dialer</h3>
                <div className="helper-text">{selectedRows.length} selected • {dialerIndex + 1} / {selectedRows.length}</div>
              </div>
              <button type="button" className="mini-btn ghost bounceable" onClick={() => setDialerOpen(false)} title="Close Dialer"><CloseIcon /></button>
            </div>

            <div className="dialer-now">
              <div className="helper-text">Current target</div>
              {currentDialerTarget.full_name} • {visiblePhone(user, currentDialerTarget.phone || '')}
            </div>

            <div className="dialer-actions-row row-actions nowrap-actions">
              <button type="button" className="mini-btn ghost bounceable modern-nav-btn" onClick={prevSelected} title="Previous"><PrevIcon /></button>
              <button type="button" className="mini-btn view bounceable modern-icon-btn modern-call-btn" onClick={() => dialCandidate(currentDialerTarget.candidate_id, currentDialerTarget.phone)} title="Dial now"><PhoneIcon /></button>
              <button type="button" className="mini-btn edit bounceable modern-icon-btn modern-wa-btn" onClick={() => openWhatsApp(currentDialerTarget.candidate_id, currentDialerTarget.phone, '')} title="Open WhatsApp"><WhatsAppIcon /></button>
              <PremiumSelect className="wa-template-select dialer-template-select" defaultValue="" onChange={(e) => { onDialerTemplatePick(e.target.value); e.target.value = ''; }}>
                <option value="">WA Template</option>
                {(Array.isArray(waTemplates) ? waTemplates : []).slice(0, 80).map((tpl, index) => {
                  const option = normalizeWhatsAppTemplateOption(tpl, index);
                  return option ? <option key={`${option.title}-${index}`} value={encodeWhatsAppTemplateOption(option, index)}>{option.title}</option> : null;
                })}
                <option value="__add_new__">Add New...</option>
              </PremiumSelect>
              <button type="button" className="mini-btn ghost bounceable modern-nav-btn" onClick={nextSelected} title="Next"><NextIcon /></button>
              <button type="button" className="open-profile-chip bounceable" onClick={markCallDoneAndAutoNext}>{autoNextCountdown ? `Next in ${autoNextCountdown}s` : 'Call Done'}</button>
              <button type="button" className="open-profile-chip bounceable" onClick={() => openCandidateProfile(currentDialerTarget)}>Open Profile</button>
            </div>
          </div>
        ) : null}

        <div className="crm-table-wrap dense-wrap top-gap-small candidates-scroll-wrap">
          <table className="crm-table colorful-table dense-table candidates-overview-table">
            <thead>
              <tr>
                <th style={{ width: 84 }}>
                  <button type="button" className={`table-master-check ${allSelected ? 'active' : ''}`} role="checkbox" aria-checked={allSelected ? true : selectableRowIds.some(id=>selectedIds.includes(id)) ? 'mixed' : false} aria-label={allSelected ? 'Clear all candidate selections' : 'Select all candidates'} onClick={toggleSelectAll} title={allSelected ? 'Clear All' : `Select All ${selectableRowIds.length || ''}`} >
                    {!allSelected&&selectableRowIds.some(id=>selectedIds.includes(id))?<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12" strokeLinecap="round"/></svg>:<CheckIcon />}
                  </button>
                </th>
                <th className="candidate-id-col">ID</th>
                <th className="candidate-name-col">Name</th>
                <th className="candidate-number-col">Number</th>
                <th className="candidate-location-col">Location</th>
                <th className="candidate-qualification-col">Degree</th>
                <th className="bucket-highlight-col candidate-date-col">Bucket / Due</th>
                <th className="bucket-highlight-col candidate-status-col">Status</th>
                <th>In-hand Salary</th><th>Process</th><th className="cc839-note-col">Latest Note</th>
                <th className="bucket-highlight-col candidate-last-viewed-col">Last Viewed</th>
                <th className="bucket-highlight-col candidate-priority-col">Priority</th>
                <th className="sticky-action-col candidate-actions-col cc837-action-head">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, rowIndex) => {
                const selected = selectedIds.includes(normalizeId(row.candidate_id));
                const freshView = row.bucket_is_fresh || filters.bucket_view === 'fresh';
                const statusText = row.status || ''; 
                const statusTone = String(statusText || '').trim().toLowerCase() === 'draft' ? 'draft' : toneForBucket(row.bucket_stage);
                const priorityText = freshView ? (row.profile_priority || 'Not set') : (row.bucket_priority_label || '-');
                const lastViewedText = formatLastViewed(row.last_viewed_at);
                const cc716CreatedAt = row.created_at || '';
                const daysLeftText = formatDaysLeft(row.bucket_days_left);
                const dateText = freshView
                  ? (cc716CreatedAt ? formatBucketDate(cc716CreatedAt) : '-')
                  : (filters.bucket_view === 'followup' && row.follow_up_at
                    ? formatBucketDate(row.follow_up_at)
                    : `${row.bucket_days_left || 0} Day${Number(row.bucket_days_left || 0) === 1 ? '' : 's'}`);
                return (
                  <tr key={row.candidate_id} aria-selected={selected} className={`clickable-row ${selected ? 'selected-row' : ''}`} onClick={() => openCandidateProfile(row)}>
                    <td className="candidate-select-cell">
                      <button type="button" className={`row-check-btn bounceable ${selected ? 'active' : ''}`} role="checkbox" aria-checked={selected} aria-label={`Select candidate ${row.candidate_id}`} onClick={(e) => { e.stopPropagation(); toggleSelection(row.candidate_id, e); }} title="Click to toggle; Shift-click another row to select or clear a range">
                        <CheckIcon />
                      </button>
                    </td>
                    <td className="candidate-id-cell"><strong title={`Candidate ID: ${safeCellText(row.candidate_id, '-')}`}>{safeCellText(row.candidate_id, '-')}</strong></td>
                    <td className="candidate-name-cell" title={row.data_notes ? `Data Notes: ${safeCellText(row.data_notes)}` : undefined}><strong title={safeCellText(row.full_name, '-')}>{safeCellText(row.full_name, '-')}</strong>{row.__cc_durable_frontend_pending ? <div title="This row is a recent local cache copy; it has not appeared in this server list. Verify by Candidate ID before treating it as a persisted record." style={{fontSize:10,color:'#9c5420',fontWeight:700}}>Cached recent row · verify in DB</div> : null}<br /><span className="subtle">{safeCellText(displayStaffName(row.recruiter_user_id||row.recruiter_code,row.recruiter_name||row.process),'-')}</span></td>
                    <td className="candidate-number-cell">{visiblePhone(user, row.phone)}</td>
                    <td className="candidate-location-cell"><span className="cc803-cell-ellipsis" title={safeCellText(row.location || row.preferred_location, '-')}>{safeCellText(row.location || row.preferred_location, '-')}</span></td>
                    <td className="candidate-qualification-cell" title={safeCellText(row.qualification_level, '')}>{safeCellText(row.qualification_level, '')}</td>
                    <td className="bucket-highlight-cell"><div className={`cc783-bucket-date ${toneForBucket(row.bucket_stage)}`}><strong title={dateText}>{dateText}</strong><span title={row.bucket_assigned_at || undefined}>{freshView ? (daysLeftText || (cc716CreatedAt ? 'Created on' : 'Date unavailable')) : `Assigned ${formatBucketDate(row.bucket_assigned_at)}`}</span></div></td>
                    <td className="bucket-highlight-cell"><span className={`bucket-status-chip ${statusTone}`}>{statusText}</span></td>
                    <td>{String(row.in_hand_salary??'').trim()!==''&&Number.isFinite(Number(row.in_hand_salary))?`₹${Number(row.in_hand_salary).toLocaleString('en-IN')}`:''}</td><td>{safeCellText(row.process,'')}</td><td className="cc839-note-col" title={safeCellText(row.notes,'')}>{safeCellText(row.notes,'')}</td>
                    <td className="bucket-highlight-cell"><div className="last-viewed-stack"><span className={`bucket-status-chip ${row.last_viewed_at ? 'safe' : 'info'}`} title={`${lastViewedText}${row.last_viewed_by_name ? ` / ${row.last_viewed_by_name}` : ''}`}>{lastViewedText}{row.last_viewed_by_name ? <span className="cc783-viewer"> / {safeCellText(row.last_viewed_by_name)}</span> : null}</span></div></td>
                    <td className="bucket-highlight-cell"><span className={`bucket-priority-chip ${priorityTone(priorityText)}`}>{priorityText}</span></td>
                    <td className="sticky-actions-cell">
                      <div className="row-actions nowrap-actions compact-row-actions cc837-candidate-actions">
                        <button type="button" className="mini-btn call bounceable modern-icon-btn modern-eye-btn" onClick={(e) => { e.stopPropagation(); openCandidateProfile(row); }} title="Open Profile"><EyeIcon /></button>
                        <button className="mini-btn view bounceable modern-icon-btn modern-call-btn" type="button" title="Dial Call" onClick={(e) => { e.stopPropagation(); dialCandidate(row.candidate_id, row.phone); }}><PhoneIcon /></button>
                        <button className="mini-btn edit bounceable modern-icon-btn modern-wa-btn" type="button" title="Open WhatsApp" onClick={(e) => { e.stopPropagation(); openWhatsApp(row.candidate_id, row.phone, ''); }}><WhatsAppIcon /></button>
                        {isManager&&<button type="button" className="mini-btn modern-icon-btn cc837-delete" title="Delete candidate" aria-label={'Delete '+(row.full_name||row.candidate_id)} disabled={Boolean(deleteBusyId)} onClick={e=>{e.stopPropagation();deleteCandidate(row.candidate_id,row.full_name);}}><TrashIcon/></button>}
                        <PremiumSelect className="wa-template-select mini-wa-template-select" aria-label="WhatsApp template" title="WhatsApp templates" defaultValue="" onClick={(e) => e.stopPropagation()} onChange={(e) => { onTemplatePick(row, e.target.value); e.target.value = ''; }}>
                          <option value="">Text</option>
                          {(Array.isArray(waTemplates) ? waTemplates : []).slice(0, 80).map((tpl, index) => {
                  const option = normalizeWhatsAppTemplateOption(tpl, index);
                  return option ? <option key={`${option.title}-${index}`} value={encodeWhatsAppTemplateOption(option, index)}>{option.title}</option> : null;
                })}
                          <option value="__add_new__">Add New...</option>
                        </PremiumSelect>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredRows.length === 0 && <tr><td colSpan="11" className="helper-text">{sliceLoading?'Updating selected view…':'No candidates found.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="row-actions top-gap-small candidate-pager-row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div className="helper-text">Page {page} of {totalPages} • Showing {filteredRows.length} of {totalRows}</div>
          <div className="row-actions candidate-page-jump-wrap" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="ghost-btn bounceable" disabled={page <= 1} onClick={() => goToPage(page - 1)}>Previous 10</button>
            <div className="row-actions candidate-page-number-row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {pageButtons.map((value, index) => {
                const prevValue = pageButtons[index - 1];
                const showGap = index > 0 && value - prevValue > 1;
                return (
                  <React.Fragment key={value}>
                    {showGap ? <span className="helper-text">...</span> : null}
                    <button type="button" className={`bucket-quick-pill bounceable ${page === value ? 'active' : ''}`} onClick={() => goToPage(value)}>{value}</button>
                  </React.Fragment>
                );
              })}
            </div>
            <div className="row-actions" style={{ gap: 8, alignItems: 'center' }}>
              <input
                className="inline-input candidate-page-jump-input"
                type="number"
                min="1"
                max={totalPages}
                value={pageJumpValue}
                onChange={(e) => setPageJumpValue(e.target.value.replace(/[^\d]/g, '').slice(0, 4) || '')}
                onKeyDown={(e) => { if (e.key === 'Enter') submitPageJump(); }}
                placeholder="Page"
              />
              <button type="button" className="selection-master-pill bounceable" onClick={submitPageJump}>Go</button>
            </div>
            <button type="button" className="add-profile-btn bounceable" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>Next 10</button>
          </div>
        </div>

      </div>

      <style>{CC794_FILTER_REFERENCE_CSS}</style>

      {showFilterDrawer && typeof document !== 'undefined' ? createPortal(
        <div className="crm-modal-backdrop candidate-drawer-backdrop wide cc794-filter-backdrop" onClick={() => setShowFilterDrawer(false)}>
          <div className="candidate-filter-modal candidate-filter-matrix-modal cc794-filter-modal cc800-filter-modal cc878-filter-modal" role="dialog" aria-modal="true" aria-label="Candidate filters" onClick={(e) => e.stopPropagation()}>
            <div className="candidate-filter-modal-head">
              <div>
                <div className="candidate-filter-modal-title"><FilterIcon /> Candidate filters</div>
                <div className="helper-text">Choose values, check the matching count, then apply.</div>
              </div>
              <div className="candidate-filter-head-actions">
                <span className="mini-chip live-chip">{matchingProfileLabel}</span>
                {activeFilterCount ? <span className="mini-chip live-chip">{activeFilterCount} active</span> : <span className="mini-chip">No active filters</span>}
                <button type="button" className="ghost-btn bounceable" onClick={resetFilters}>Clear All</button>
                <button type="button" className="add-profile-btn bounceable" onClick={() => setShowFilterDrawer(false)}>Apply filters</button>
              </div>
            </div>
            <div className="cc872-drawer-summary">{filterSections.filter(section=>countSelectedForSection(section,filters)).map(section=><span key={section.key}>{section.number}. {section.label}: {section.type==='options'?(filters[section.key]||[]).map(value=>section.key==='recruiter_code'?(recruiterChoices.find(r=>r.value===value)?.label||value):value).join(', '):[filters[section.from],filters[section.to]].join(' – ')}</span>)}{filterPreview.locations?.length>0&&<strong className="cc937-location-caption">Candidate locations</strong>}{filterPreview.locations?.map(row=><span key={row.location}>{row.location}: {row.count}</span>)}</div><div className="candidate-filter-modal-body">
              <aside className="candidate-filter-sidebar">
                <div className="candidate-filter-save-card gradient-card blue">
                  <div className="candidate-filter-save-title">Most Used Filters</div>
                  <div className="candidate-preset-list">
                    {mostUsedPresets.length ? mostUsedPresets.map((preset) => (
                      <div key={preset.id} className="candidate-preset-item">
                        <button type="button" className="candidate-preset-apply" onClick={() => applyPreset(preset)}>
                          <strong>{preset.name}</strong>
                          <span>{preset.use_count || 0} uses</span>
                        </button>
                        <button type="button" className="candidate-preset-delete" onClick={() => deletePreset(preset.id)} title="Delete saved filter"><CloseIcon /></button>
                      </div>
                    )) : <div className="helper-text">No saved filters yet.</div>}
                  </div>
                </div>

                <div className="candidate-filter-save-card gradient-card violet top-gap-small">
                  <div className="candidate-filter-save-title">Save Current Filter</div>
                  <div className="field no-label-field">
                    <input className="inline-input" value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Filter name, like Noida Freshers" />
                  </div>
                  <button type="button" className="add-profile-btn bounceable full-width-btn" onClick={saveCurrentPreset}>Save Filter</button>
                </div>

                <div className="candidate-filter-nav top-gap-small">
                  <input className="cc56-filter-find" aria-label="Find a filter" placeholder="Find a filter: salary, location, recruiter…" value={filterSectionSearch} onChange={event => setFilterSectionSearch(event.target.value)} />
                  {filterSections.filter(section => `${section.number} ${section.label}`.toLowerCase().includes(filterSectionSearch.trim().toLowerCase())).map((section) => {
                    const selectedCount = countSelectedForSection(section, filters);
                    const isActive = activeFilterSection?.key === section.key;
                    return (
                      <button
                        key={section.key}
                        type="button"
                        className={`candidate-filter-nav-item ${isActive ? 'active' : ''} ${selectedCount ? 'selected' : ''}`}
                        title={section.label}
                        aria-pressed={isActive}
                        onClick={() => setActiveFilterKey(section.key)}
                      >
                        <div>
                          <strong>{section.number}. {section.label}</strong>
                          <span>{selectedCount ? `${selectedCount} selected` : 'All'}</span>
                        </div>
                        <ArrowIcon />
                      </button>
                    );
                  })}
                </div>
              </aside>

              <section className="candidate-filter-detail-panel">
                {activeFilterSection ? (
                  <>
                    <div className="candidate-filter-detail-head">
                      <div>
                        <div className="candidate-filter-detail-title">{activeFilterSection.number}. {activeFilterSection.label}</div>
                        <div className="candidate-filter-detail-sub">Choose one or more values.</div>
                        <div className="helper-text top-gap-small">{matchingProfileLabel}</div>
                      </div>
                      <div className="row-actions" style={{ gap: 8, flexWrap: 'wrap' }}>
                        {activeFilterSection.type === 'options' ? (
                          <button
                            type="button"
                            className="ghost-btn bounceable"
                            onClick={() => setFilters((prev) => {
                              const current = Array.isArray(prev[activeFilterSection.key]) ? prev[activeFilterSection.key].filter((item) => item !== FILTER_ALL_MARKER) : [];
                              const options = (activeFilterSection.options || []).filter((item) => String(item || '').trim());
                              const allSelected = options.length > 0 && options.every((item) => current.includes(item));
                              return { ...prev, [activeFilterSection.key]: allSelected ? [] : [...options] };
                            })}
                          >
                            {(() => { const current = (filters[activeFilterSection.key] || []).filter((item) => item !== FILTER_ALL_MARKER); const options = activeFilterSection.options || []; return options.length > 0 && options.every((item) => current.includes(item)) ? 'Clear All Options' : 'Select All'; })()}
                          </button>
                        ) : null}
                        <button type="button" className="ghost-btn bounceable candidate-inline-clear" onClick={() => clearCurrentSection(activeFilterSection)}>Clear</button>
                      </div>
                    </div>

                    {activeFilterSection.type === 'options' ? (
                      <>
                        <div className="field no-label-field">
                          <input
                            className="inline-input"
                            value={activeOptionSearch}
                            onChange={(e) => setOptionSearches((prev) => ({ ...prev, [activeFilterSection.key]: e.target.value }))}
                            placeholder={`Search ${activeFilterSection.label}`}
                          />
                        </div>
                        <div className="candidate-option-grid roomy two-col top-gap-small">
                          {activeVisibleOptions.map((item) => {
                            const selectedValues = filters[activeFilterSection.key] || [];
                            const checked = selectedValues.includes(item);
                            return (
                              <label key={item} className={`candidate-option-card ${checked ? 'checked' : ''}`}>
                                <input type="checkbox" checked={checked} onChange={() => setFilters((prev) => toggleArrayValue(prev, activeFilterSection.key, item, activeFilterSection.options || []))} />
                                <span>{activeFilterSection.key==='recruiter_code'?(recruiterChoices.find(o=>o.value===item)?.label||item):item}</span>
                              </label>
                            );
                          })}
                          {!activeVisibleOptions.length && <div className="helper-text">No options found.</div>}
                        </div>
                      </>
                    ) : (
                      <div className="candidate-range-row wider top-gap-small">
                        <div className="field">
                          <label>{activeFilterSection.type === 'date-range' ? 'From Date' : 'From'}</label>
                          <input className="inline-input" type={activeFilterSection.type === 'date-range' ? 'date' : 'number'} value={filters[activeFilterSection.from]} onChange={(e) => setFilters((prev) => ({ ...prev, [activeFilterSection.from]: e.target.value }))} />
                        </div>
                        <div className="field">
                          <label>{activeFilterSection.type === 'date-range' ? 'To Date' : 'To'}</label>
                          <input className="inline-input" type={activeFilterSection.type === 'date-range' ? 'date' : 'number'} value={filters[activeFilterSection.to]} onChange={(e) => setFilters((prev) => ({ ...prev, [activeFilterSection.to]: e.target.value }))} />
                        </div>
                      </div>
                    )}
                  </>
                ) : null}
              </section>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </Layout>
  );
}
