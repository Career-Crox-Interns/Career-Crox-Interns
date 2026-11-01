// CC848: local durable submit intents; never use a displayed Candidate ID.
// Background worker retries safely while the correct employee is logged in.
// The PostgreSQL draft mapping and command receipt (not this queue) decide identity.
const prefix = 'cc848-durable-candidate-submit:'; // Retain pending CC848 queue across CC849 upgrade
const storageKey = actor => `${prefix}${encodeURIComponent(String(actor || '').trim())}`;
const read = actor => {
  try { const rows = JSON.parse(localStorage.getItem(storageKey(actor)) || '{}');
    return rows && typeof rows === 'object' && !Array.isArray(rows) ? rows : {}; }
  catch { return {}; }
};
const write = (actor, rows) => { try { localStorage.setItem(storageKey(actor), JSON.stringify(rows)); return true; } catch { return false; } };
export function stageCandidateSubmit(actor, payload) {
  if (!actor || !payload?.draft_id || !payload?.command_id || payload?.action !== 'submit') return false;
  const rows = read(actor);
  const id = String(payload.draft_id);
  rows[id] = { payload, owner:String(actor), staged_at:rows[id]?.staged_at || new Date().toISOString(), last_error:'', blocked:false };
  return write(actor, rows);
}
export function completeCandidateSubmit(actor, draftId) {
  if (!actor || !draftId) return;
  const rows = read(actor);
  delete rows[String(draftId)];
  write(actor, rows);
}
export function pendingCandidateSubmits(actor) {return Object.values(read(actor));}
export function blockCandidateSubmit(actor, draftId, error) {
  const rows=read(actor), row=rows[String(draftId)];if(!row)return;
  rows[String(draftId)]={...row,blocked:true,last_error:String(error||'Server rejected the request').slice(0,300)};
  write(actor,rows);
}
export async function retryCandidateSubmits(actor, apiClient) {
  if (!actor || typeof navigator === 'undefined' || navigator.onLine === false) return [];
  const done=[];
  const rows = read(actor);
  // Recover prior release-mismatch blocks automatically after installing CC849.
  // Real validation or identity-conflict blocks remain protected for review.
  const retryable = row => !row.blocked || /versions differ|matching CC848|matching CC849|workflow version/i.test(String(row.last_error || ''));
  for (const row of Object.values(rows).filter(x=>retryable(x) && x.owner===actor).slice(0,5)) {
    try {
      // Upgrade pending CC848 intent to CC849 without changing UUID, command ID
      // or profile fields. The backend uses those stable keys for exactly-once.
      const retryPayload = { ...row.payload, workflow_release: 'CC861', workflow_version:'profile-commit-v2' };
      const response = await apiClient.post('/api/candidates/new/commit',retryPayload,
        {timeoutMs:30000,retries:0,background:true,detachedWrite:true});
      if (response?.ok === true && response?.committed === true && response?.candidate_id
          && response?.submission?.submission_id && response?.workflow_release === 'CC861') {
        completeCandidateSubmit(actor,row.payload.draft_id);
        done.push(response.candidate_id);
      } else throw Object.assign(new Error('Unconfirmed submit receipt'),{status:503});
    } catch (error) {
      const status=Number(error?.status||0);
      // Validation/identity errors require manager review, never endless retries.
      if (status>=400 && status<500 && status!==408 && status!==429) {
        blockCandidateSubmit(actor,row.payload.draft_id,error.message);
      }
    }
  }
  return done;
}
