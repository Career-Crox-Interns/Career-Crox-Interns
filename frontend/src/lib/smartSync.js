import { useCallback, useEffect, useMemo, useRef } from 'react';
import { api, cachePrincipal, invalidateGetResource } from './api';
import { usePolling } from './usePolling';

const DEFAULT_SYNC_MS = 3 * 60 * 1000;
const MAX_CHANGED_ROWS = 50;

// Event-driven reconciliation for an exact paginated snapshot. Hidden/offline
// tabs defer work. Bursts share one flight, errors back off, and an unchanged
// wake-up returns only the server's small snapshot acknowledgement.
export function useQuietCandidateRefresh(refresh, viewKey, accept, { refreshOnViewChange = true } = {}) {
  const callback=useRef(refresh);callback.current=refresh;
  const accepts=useRef(accept);accepts.current=accept;
  const verifiedAt=useRef(Date.now()),previousView=useRef(viewKey);
  useEffect(()=>{
    let alive=true,timer=null,running=false,pending=refreshOnViewChange&&previousView.current!==viewKey,lastStart=0,failures=0,blocked=false;
    previousView.current=viewKey;
    const seen=new Set();
    const available=()=>!blocked&&!document.hidden&&navigator.onLine!==false&&!window.__CC602_NETWORK_PAUSED__;
    const run=async()=>{
      timer=null;
      if(!alive||running||!pending||!available())return;
      pending=false;running=true;lastStart=Date.now();
      try{const result=await callback.current();if(result?.deferred)pending=true;else{failures=0;verifiedAt.current=Date.now();}}
      catch(error){
        if(!['ACCOUNT_CHANGED','DASHBOARD_CHANGED','ACCESS_CHANGED'].includes(error?.code)&&![401,403].includes(error?.status)){
          failures=Math.min(failures+1,5);
          // At most two recovery attempts per failed burst; never a retry loop.
          if(failures<3)pending=true;
        }else{blocked=true;pending=false;}
      }finally{running=false;if(alive&&pending)schedule();}
    };
    const schedule=()=>{
      if(!alive||running||timer||!pending||!available())return;
      const gap=failures?Math.min(120000,15000*2**(failures-1)):5000;
      timer=setTimeout(run,Math.max(900,lastStart+gap-Date.now()));
    };
    const changed=event=>{
      const d=event.detail||{},source=String(d.source||d.path||'');
      if(accepts.current&&!accepts.current(event))return;
      if(event.type==='career-crox-access-changed')blocked=false;
      if(event.type==='career-crox-workspace-change'||event.type==='career-crox-data-written'){
        if(!d.item?.candidate_id&&!d.candidate_id&&!/^\/(?:api\/)?(?:candidates|bucket|flowchart|users|admin\/(?:upload|import))\b/.test(source))return;
        const token=JSON.stringify([source,d.item?.candidate_id,d.item?.updated_at,d.at,d.meta?.command_id]);
        if(d.item?.updated_at||d.at||d.meta?.command_id){if(seen.has(token))return;seen.add(token);if(seen.size>100)seen.delete(seen.values().next().value);}
      }
      pending=true;schedule();
    };
    const wake=()=>{
      if(!available())return;
      // Repeated focus/ready signals are not evidence that data changed.
      if(failures||Date.now()-verifiedAt.current>60000)pending=true;
      schedule();
    };
    const names=['career-crox-workspace-change','career-crox-data-written','career-crox-team-changed','career-crox-access-changed','career-crox-candidate-upserted','career-crox-drafts-deleted'];
    for(const name of names)window.addEventListener(name,changed);
    for(const name of ['career-crox-tab-resumed','career-crox-reminder-ready','career-crox-candidates-stale','online','focus'])window.addEventListener(name,wake);
    document.addEventListener('visibilitychange',wake);
    if(pending)schedule();
    return()=>{alive=false;clearTimeout(timer);for(const name of names)window.removeEventListener(name,changed);for(const name of ['career-crox-tab-resumed','career-crox-reminder-ready','career-crox-candidates-stale','online','focus'])window.removeEventListener(name,wake);document.removeEventListener('visibilitychange',wake);};
  },[viewKey]);
}

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
      // Interview rows are already patched by onCandidateRealtime. A full
      // profile event must not additionally re-download the interview list.
      if(dependent&&scopeKey==='interviews'&&data.item?.candidate_id&&(data.item.full_name||data.item.deleted_at))return;
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
      // Manual-refresh builds must not run a second catch-up from this hook
      // alongside each page's own resume handler.
      if(String(import.meta.env?.VITE_DISABLE_BACKGROUND_POLLING||'true').toLowerCase()!=='false')return;
      const refresh=callbacksRef.current.onInvalidate;
      if(refresh)Promise.resolve(refresh()).catch(onError||(()=>{}));
      else syncOnce().catch(onError||(()=>{}));
    };
    window.addEventListener('career-crox-tab-resumed',wake);
    return()=>window.removeEventListener('career-crox-tab-resumed',wake);
  },[enabled,syncOnce,onError]);
  return { syncOnce };
}
