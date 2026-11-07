import {useEffect} from 'react';
import {useAuth} from './auth';
import {api} from './api';
import {getPollingLeaderSnapshot,subscribePollingLeader} from './tabLeader';

// Durable Save / Submit intents. Server receipts and draft mappings own identity.
// Keep the legacy key readable so an upgrade never discards a pending submission.
const prefix = 'cc848-durable-candidate-submit:';
const storageKey = actor => `${prefix}${encodeURIComponent(String(actor || '').trim())}`;
const intentKey = (actor, draftId) => `${storageKey(actor)}:intent:${encodeURIComponent(String(draftId))}`;
const legacy = actor => {
  try { const rows = JSON.parse(localStorage.getItem(storageKey(actor)) || '{}');
    return rows && typeof rows === 'object' && !Array.isArray(rows) ? rows : {}; }
  catch { return {}; }
};
const read = actor => {
  const rows = legacy(actor), start = `${storageKey(actor)}:intent:`;
  // One key per draft: two tabs staging different profiles cannot overwrite
  // each other's whole queue through a localStorage read/modify/write race.
  try { for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(start)) continue;
    try { const row = JSON.parse(localStorage.getItem(key));
      if (row?.owner === String(actor) && row.payload?.draft_id && row.payload?.command_id)
        rows[String(row.payload.draft_id)] = row;
    } catch {}
  } } catch {}
  return rows;
};
const put = (actor, id, row) => {
  try { localStorage.setItem(intentKey(actor, id), JSON.stringify(row)); return true; }
  catch { return false; }
};
export function stageCandidateSubmit(actor, payload) {
  if (!actor || !payload?.draft_id || !payload?.command_id || !(payload.action === 'submit' || payload.action === 'save' && payload.persist_candidate === true)) return false;
  const id = String(payload.draft_id), old = read(actor)[id];
  return put(actor, id, { payload, owner: String(actor), staged_at: old?.staged_at || new Date().toISOString(), last_attempt_at:Date.now(),last_error: '', blocked: false });
}
export function completeCandidateSubmit(actor, draftId, commandId) {
  if (!actor || !draftId) return;
  const id = String(draftId), current = read(actor)[id];
  // A late acknowledgement for an older command must not remove a newer save.
  if (commandId && current?.payload?.command_id !== commandId) return;
  try {
    localStorage.removeItem(intentKey(actor, id));
    const old = legacy(actor);
    // The matching current command superseded any legacy queue entry for this
    // draft. Do not resurrect an older Submit after the newer Save confirms.
    if (old[id]) {
      delete old[id]; localStorage.setItem(storageKey(actor), JSON.stringify(old));
    }
  } catch {}
}
export function pendingCandidateSubmits(actor) { return Object.values(read(actor)); }
export function blockCandidateSubmit(actor, draftId, error, commandId) {
  const id = String(draftId), row = read(actor)[id];
  if (!row || commandId && row.payload?.command_id !== commandId) return;
  put(actor, id, { ...row, blocked: true, last_error: String(error || 'Server rejected the request').slice(0, 300) });
}
export async function retryCandidateSubmits(actor, apiClient, {verifyOnly=false,skipRecent=false}={}) {
  if (!actor || typeof navigator === 'undefined' || navigator.onLine === false) return [];
  const done = [], rows = read(actor);
  const retryable = row => !row.blocked || /versions differ|matching CC848|matching CC849|workflow version/i.test(String(row.last_error || ''));
  for (const row of Object.values(rows).filter(x => retryable(x) && x.owner === actor).slice(0, 5)) {
    try {
      const retryPayload = { ...row.payload, workflow_release: 'CC861', workflow_version: 'profile-commit-v2' };
      // No checks/replays for a newly staged in-flight manual command.
      if(skipRecent&&Date.now()-Number(row.last_attempt_at||Date.parse(row.staged_at))<60000)continue;
      const response = verifyOnly
        ? await apiClient.get('/api/candidates/commit-status/'+encodeURIComponent(row.payload.command_id),{timeoutMs:12000,retries:0,cacheTtlMs:0,allowStale:false,background:true})
        : await apiClient.post('/api/candidates/new/commit', retryPayload,
          { timeoutMs: 30000, retries: 0, background: false, detachedWrite: true });
      if(verifyOnly&&response?.committed!==true)continue;
      if (response?.ok === true && response.committed === true && response.candidate_id
          && response.command_id === row.payload.command_id && response.action === row.payload.action
          && (row.payload.action === 'save' || response.submission?.submission_id) && response.workflow_release === 'CC861') {
        completeCandidateSubmit(actor, row.payload.draft_id, row.payload.command_id);
        done.push(response.candidate_id);
      } else throw Object.assign(new Error('Save confirmation pending'), { status: 503 });
    } catch (error) {
      const status = Number(error?.status || 0);
      if(verifyOnly)break;
      put(actor,String(row.payload.draft_id),{...row,last_error:String(error?.message||'Confirmation pending').slice(0,300)});
      if (status >= 400 && status < 500 && status !== 408 && status !== 429)
        blockCandidateSubmit(actor, row.payload.draft_id, error.message, row.payload.command_id);
      if(!status||status>=500||status===429)break;
    }
  }
  return done;
}

// CC174: reconnect verifies receipts only. A timer must never replay pending
// writes while the original Save is still running. Drafts remain on the device.
export default function CandidateSubmitOutboxWorker(){
  const {user}=useAuth();
  const actor=String(user?.user_id||'').trim();
  useEffect(()=>{
    if(!actor)return undefined;
    let active=true,running=false;
    const retry=async()=>{if(!active||running||document.hidden||!getPollingLeaderSnapshot().isLeader)return;running=true;try{await retryCandidateSubmits(actor,api,{verifyOnly:true,skipRecent:true});}finally{running=false;}};
    const unlead=subscribePollingLeader(()=>{void retry();});
    void retry();
    const handleOnline=()=>{void retry();};
    window.addEventListener('online',handleOnline);
    return ()=>{active=false;unlead();window.removeEventListener('online',handleOnline)};
  },[actor]);
  return null;
}
