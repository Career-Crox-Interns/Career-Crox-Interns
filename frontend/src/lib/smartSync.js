import { useCallback, useEffect, useMemo, useRef } from 'react';
import { api, cachePrincipal, invalidateGetResource } from './api';
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

function rowMergeId(row, idKey = 'id') {
  const direct = String(row?.[idKey] || '').trim();
  if (direct) return direct;
  return String(row?._nav_row_key || row?.nav_row_key || row?.submission_id || row?.interview_id || row?.task_id || row?.lead_id || row?.revenue_id || row?.candidate_id || row?.id || '').trim();
}

export function mergeRowsById(currentRows = [], changedRows = [], idKey = 'id') {
  const current = Array.isArray(currentRows) ? currentRows : [];
  const changed = Array.isArray(changedRows) ? changedRows : [];
  if (!changed.length) return current;
  const byId = new Map();
  const order = [];
  for (const row of current) {
    const id = rowMergeId(row, idKey);
    if (!id) continue;
    if (!byId.has(id)) order.push(id);
    byId.set(id, row);
  }
  for (const row of changed) {
    const id = rowMergeId(row, idKey);
    if (!id) continue;
    if (String(row?.__deleted || '').toLowerCase() === 'true') {
      byId.delete(id);
      continue;
    }
    if (!byId.has(id)) order.push(id);
    const existing=byId.get(id);
    if(existing && toMs(pickRowVersion(existing)) > toMs(pickRowVersion(row)) && toMs(pickRowVersion(row))) continue;
    byId.set(id, { ...(byId.get(id) || {}), ...row });
  }
  return order.filter((id) => byId.has(id)).map((id) => byId.get(id));
}

function storageKey(scope, keySuffix = '') {
  return `careerCroxSmartSync:${cachePrincipal()}:${scope}:${keySuffix || 'default'}`;
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
  onInvalidate,
  onError,
  maxRows = MAX_CHANGED_ROWS,
}) {
  const lastVersionRef = useRef('');
  const lastCursorIdRef=useRef('');
  const syncingRef=useRef(false);
  const rowsVersion = useMemo(() => maxRowVersion(rows), [rows]);
  const scopeKey = String(scope || '').trim();
  const suffix = String(keySuffix || query || '').slice(0, 180);
  const callbacksRef=useRef({onRows,onSnapshot,onInvalidate});
  callbacksRef.current={onRows,onSnapshot,onInvalidate};
  useEffect(()=>{
    if(!enabled)return;
    const principal=cachePrincipal();
    let refreshTimer;
    const receive=event=>{
      if(cachePrincipal()!==principal)return;
      const data=event.detail||{},source=String(data.source||'').replace(/^\/api/,'');
      const resource=source.split('/').filter(Boolean)[0];
      const dependencies={candidates:['submissions','interviews','followups'],flowchart:['candidates','submissions','interviews','followups','tasks']};
      const dependent=(dependencies[resource]||[]).includes(scopeKey);
      if(resource!==scopeKey&&!dependent)return;
      invalidateGetResource('/api/'+scopeKey);
      if(resource===scopeKey&&data.item?.[idKey]){
        const item={...data.item};if(item.deleted_at||['deleted','__deleted__','archived'].includes(String(item.status||'').toLowerCase()))item.__deleted=true;
        callbacksRef.current.onRows?.([item],{live:true,version:item.updated_at});
      }
      if(dependent&&callbacksRef.current.onInvalidate){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>callbacksRef.current.onInvalidate?.(),300);}
    };
    window.addEventListener('career-crox-workspace-change',receive);
    return()=>{clearTimeout(refreshTimer);window.removeEventListener('career-crox-workspace-change',receive);};
  },[enabled,scopeKey,idKey]);

  useEffect(() => {
    const stored = readStoredVersion(scopeKey, suffix);
    lastVersionRef.current = rowsVersion || stored || lastVersionRef.current || '';
    if (rowsVersion) writeStoredVersion(scopeKey, suffix, rowsVersion);
  }, [rowsVersion, scopeKey, suffix]);

  const syncOnce = useCallback(async () => {
    if (!enabled || !scopeKey || syncingRef.current) return;
    syncingRef.current=true;
    try {
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

    if(state?.degraded)return;
    if (state?.snapshot && typeof onSnapshot === 'function') onSnapshot(state.snapshot);
    if (!state?.changed || !Number(state?.change_count || 0)) {
      if(state?.version){lastVersionRef.current=state.version;writeStoredVersion(scopeKey,suffix,state.version);}
      return;
    }
    // A catch-up burst is explicit/reconnect work, not a periodic full refresh.
    for(let page=0;page<40;page++) {
      const changesParams=new URLSearchParams(params);
      changesParams.set('after',lastVersionRef.current||after);
      if(lastCursorIdRef.current)changesParams.set('after_id',lastCursorIdRef.current);
      changesParams.set('limit',String(Math.max(1,Math.min(Number(maxRows||MAX_CHANGED_ROWS),MAX_CHANGED_ROWS))));
      const delta=await api.get(`/api/sync/changes?${changesParams}`,{background:true,cacheTtlMs:0,timeoutMs:15000,retries:0});
      if(delta?.degraded)throw new Error('Live catch-up could not be confirmed. The previous cursor is kept.');
      const changedRows=Array.isArray(delta?.items)?delta.items:[];
      if(changedRows.length&&typeof onRows==='function')onRows(changedRows,delta);
      if(delta?.snapshot&&typeof onSnapshot==='function')onSnapshot(delta.snapshot);
      if(delta?.version){lastVersionRef.current=delta.version;lastCursorIdRef.current=delta.cursor_id||'';writeStoredVersion(scopeKey,suffix,delta.version);}
      if(!delta?.has_more)break;
    }

    } finally {syncingRef.current=false;}
  }, [enabled, scopeKey, suffix, query, onRows, onSnapshot, maxRows]);

  usePolling(() => syncOnce().catch((error) => {
    if (typeof onError === 'function') onError(error);
  }), enabled ? Math.max(DEFAULT_SYNC_MS, Number(intervalMs || DEFAULT_SYNC_MS)) : 0, [enabled, scopeKey, suffix, query, syncOnce]);

  useEffect(()=>{
    const wake=()=>{
      if(!enabled||document.hidden)return;
      const refresh=callbacksRef.current.onInvalidate;
      if(refresh)Promise.resolve(refresh()).catch(onError||(()=>{}));
      else syncOnce().catch(onError||(()=>{}));
    };
    window.addEventListener('career-crox-tab-resumed',wake);
    return()=>window.removeEventListener('career-crox-tab-resumed',wake);
  },[enabled,syncOnce,onError]);
  return { syncOnce };
}
