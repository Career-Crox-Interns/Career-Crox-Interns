import { useCallback, useEffect, useMemo, useRef } from 'react';
import { api } from './api';
import { usePolling } from './usePolling';

const DEFAULT_SYNC_MS = 3 * 60 * 1000;
const MAX_CHANGED_ROWS = 50;

function toMs(value) {
  const stamp = new Date(value || 0).getTime();
  return Number.isFinite(stamp) && stamp > 0 ? stamp : 0;
}

export function pickRowVersion(row) {
  return row?.updated_at || row?.created_at || row?.submitted_at || row?.approval_requested_at || row?.scheduled_at || row?.interview_date || '';
}

export function maxRowVersion(rows = []) {
  let best = '';
  let bestMs = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const candidate = pickRowVersion(row);
    const ms = toMs(candidate);
    if (ms >= bestMs) {
      bestMs = ms;
      best = candidate || best;
    }
  }
  return best || '';
}

export function mergeRowsById(currentRows = [], changedRows = [], idKey = 'id') {
  const current = Array.isArray(currentRows) ? currentRows : [];
  const changed = Array.isArray(changedRows) ? changedRows : [];
  if (!changed.length) return current;
  const byId = new Map();
  for (const row of current) {
    const id = String(row?.[idKey] || '').trim();
    if (id) byId.set(id, row);
  }
  for (const row of changed) {
    const id = String(row?.[idKey] || '').trim();
    if (!id) continue;
    if (String(row?.__deleted || '').toLowerCase() === 'true') {
      byId.delete(id);
    } else {
      byId.set(id, { ...(byId.get(id) || {}), ...row });
    }
  }
  return Array.from(byId.values()).sort((a, b) => String(pickRowVersion(b) || '').localeCompare(String(pickRowVersion(a) || '')));
}

function storageKey(scope, keySuffix = '') {
  return `careerCroxSmartSync:${scope}:${keySuffix || 'default'}`;
}

function readStoredVersion(scope, keySuffix) {
  if (typeof window === 'undefined') return '';
  try {
    return window.sessionStorage.getItem(storageKey(scope, keySuffix)) || '';
  } catch {
    return '';
  }
}

function writeStoredVersion(scope, keySuffix, value) {
  if (typeof window === 'undefined' || !value) return;
  try {
    window.sessionStorage.setItem(storageKey(scope, keySuffix), value);
  } catch {}
}

export function useSmartDeltaSync({
  scope,
  enabled = true,
  intervalMs = DEFAULT_SYNC_MS,
  idKey = 'id',
  rows = [],
  query = '',
  keySuffix = '',
  onRows,
  onSnapshot,
  onError,
  maxRows = MAX_CHANGED_ROWS,
}) {
  const lastVersionRef = useRef('');
  const rowsVersion = useMemo(() => maxRowVersion(rows), [rows]);
  const scopeKey = String(scope || '').trim();
  const suffix = String(keySuffix || query || '').slice(0, 180);

  useEffect(() => {
    const stored = readStoredVersion(scopeKey, suffix);
    lastVersionRef.current = rowsVersion || stored || lastVersionRef.current || '';
    if (rowsVersion) writeStoredVersion(scopeKey, suffix, rowsVersion);
  }, [rowsVersion, scopeKey, suffix]);

  const syncOnce = useCallback(async () => {
    if (!enabled || !scopeKey) return;
    const after = lastVersionRef.current || readStoredVersion(scopeKey, suffix) || '';
    const params = new URLSearchParams();
    params.set('scope', scopeKey);
    if (after) params.set('after', after);
    if (query) params.set('query', query);
    const state = await api.get(`/api/sync/state?${params.toString()}`, {
      background: true,
      cacheTtlMs: 0,
      timeoutMs: 12000,
      retries: 0,
    });

    if (state?.snapshot && typeof onSnapshot === 'function') onSnapshot(state.snapshot);
    if (state?.version) {
      lastVersionRef.current = state.version;
      writeStoredVersion(scopeKey, suffix, state.version);
    }
    if (!state?.changed || !Number(state?.change_count || 0)) return;

    const changesParams = new URLSearchParams(params);
    changesParams.set('limit', String(Math.max(1, Math.min(Number(maxRows || MAX_CHANGED_ROWS), MAX_CHANGED_ROWS))));
    const delta = await api.get(`/api/sync/changes?${changesParams.toString()}`, {
      background: true,
      cacheTtlMs: 0,
      timeoutMs: 18000,
      retries: 0,
    });
    if (delta?.version) {
      lastVersionRef.current = delta.version;
      writeStoredVersion(scopeKey, suffix, delta.version);
    }
    const changedRows = Array.isArray(delta?.items) ? delta.items : [];
    if (changedRows.length && typeof onRows === 'function') {
      onRows(changedRows, delta);
    }
    if (delta?.snapshot && typeof onSnapshot === 'function') onSnapshot(delta.snapshot);
  }, [enabled, scopeKey, suffix, query, onRows, onSnapshot, maxRows]);

  usePolling(() => syncOnce().catch((error) => {
    if (typeof onError === 'function') onError(error);
  }), enabled ? Math.max(DEFAULT_SYNC_MS, Number(intervalMs || DEFAULT_SYNC_MS)) : 0, [enabled, scopeKey, suffix, query, syncOnce]);

  return { syncOnce };
}

