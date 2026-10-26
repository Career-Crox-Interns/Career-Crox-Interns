'use strict';
const {AsyncLocalStorage} = require('node:async_hooks');
const crypto = require('node:crypto');
const corrections = new AsyncLocalStorage();
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
function normalizedName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}
function normalizedPhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}
function identityDelta(previous = {}, next = {}) {
  const name = normalizedName(previous.full_name);
  const phone = normalizedPhone(previous.phone);
  return {
    established: Boolean(name && phone),
    nameChanged: Boolean(name && own(next, 'full_name') && normalizedName(next.full_name) !== name),
    phoneChanged: Boolean(phone && own(next, 'phone') && normalizedPhone(next.phone) !== phone),
  };
}
function failure(status, code, message, fields = []) {
  const error = Object.assign(new Error(message), {status, code});
  error.payload = {ok: false, committed: false, code, message, conflict_fields: fields};
  return error;
}
function assertCandidateIdentityStable(previous = {}, next = {}) {
  if (previous.candidate_id && own(next, 'candidate_id') && String(next.candidate_id) !== String(previous.candidate_id)) {
    throw failure(409, 'CANDIDATE_ID_LOCKED', 'Candidate ID cannot change. No changes were saved.');
  }
  const delta = identityDelta(previous, next);
  if (!delta.established || (!delta.nameChanged && !delta.phoneChanged)) return;
  const permit = corrections.getStore();
  if (permit && permit.id === String(previous.candidate_id) &&
      normalizedName(next.full_name ?? previous.full_name) === permit.name &&
      normalizedPhone(next.phone ?? previous.phone) === permit.phone &&
      normalizedName(previous.full_name) === permit.oldName &&
      normalizedPhone(previous.phone) === permit.oldPhone) return;
  const fields = [delta.nameChanged ? 'full_name' : '', delta.phoneChanged ? 'phone' : ''].filter(Boolean);
  throw failure(409, 'CANDIDATE_IDENTITY_LOCKED',
    'Saved ' + fields.map(key => key === 'phone' ? 'phone number' : 'candidate name').join(' and ') +
    ' differs from this form. For ordinary updates keep the saved name/number. A manager can correct it using Save after reopening the latest profile. No changes were saved.', fields);
}
async function withManagerCorrection(req, previous, next, work) {
  const delta = identityDelta(previous, next);
  if (!delta.established || (!delta.nameChanged && !delta.phoneChanged)) return work();
  const {isAdminOrManager} = require('./accessRules');
  if (!isAdminOrManager(req.user) || req.user?.impersonator) {
    assertCandidateIdentityStable(previous, next);
  }
  const base = req.body?.fields?._client_base_values;
  const changed = [delta.nameChanged ? 'full_name' : '', delta.phoneChanged ? 'phone' : ''].filter(Boolean);
  if (!base || typeof base !== 'object' || Array.isArray(base) || changed.some(key =>
      !own(base, key) || (key === 'phone' ? normalizedPhone(base[key]) !== normalizedPhone(previous[key])
        : normalizedName(base[key]) !== normalizedName(previous[key])))) {
    throw failure(409, 'PROFILE_FIELD_CONFLICT',
      'The saved name/number changed or could not be verified. Reopen this profile, review it and Save again. Your draft is kept.', changed);
  }
  const name = String(next.full_name ?? '').trim();
  if (!name) throw failure(400, 'PROFILE_NAME_REQUIRED', 'Candidate name cannot be empty. No changes were saved.');
  const phone = require('./candidatePhoneGuard').validateInput(next.phone, {required: true});
  const {store, withTransaction, activeTransactionClient} = require('./store');
  return withTransaction(async () => {
    const client = activeTransactionClient();
    if (store.pool && !client) throw failure(503, 'PROFILE_NOT_COMMITTED', 'A safe correction transaction could not start. Retry Save.');
    await require('./candidatePhoneGuard').assertUnique(phone, previous.candidate_id, client);
    const reason = String(req.body?.identity_correction_reason ||
      'Manager profile correction through Save: ' + changed.join(', ')).trim().slice(0, 1000);
    let settings;
    if (store.pool) {
      [settings] = await store.query("select current_setting('career_crox.identity_correction',true) as correction, current_setting('career_crox.actor',true) as actor, current_setting('career_crox.reason',true) as reason");
      await store.query("select set_config('career_crox.identity_correction','on',true), set_config('career_crox.actor',$1,true), set_config('career_crox.reason',$2,true)",
        [String(req.user.user_id || req.user.username), reason]);
    }
    const permit = {id: String(previous.candidate_id), name: normalizedName(name), phone: normalizedPhone(phone),
      oldName: normalizedName(previous.full_name), oldPhone: normalizedPhone(previous.phone)};
    // The permit exists only inside this awaited, authenticated correction.
    // A failure rolls back the candidate, note, audit and receipt together.
    return corrections.run(permit, async () => {
      const result = await work();
      if (!store.pool) {
        const saved = await store.findById('candidates', 'candidate_id', previous.candidate_id);
        if (!saved || normalizedName(saved.full_name) !== permit.name || normalizedPhone(saved.phone) !== permit.phone) {
          throw failure(503, 'PROFILE_NOT_COMMITTED', 'The identity correction was not confirmed. No changes were saved.');
        }
        await store.insert('crm_candidate_audit', {
          audit_id: crypto.randomUUID(), candidate_id: previous.candidate_id,
          actor: String(req.user.user_id || req.user.username), reason,
          before_values: {full_name: previous.full_name, phone: previous.phone},
          after_values: {full_name: saved.full_name, phone: saved.phone}, created_at: new Date().toISOString(),
        });
      } else {
        // The existing database trigger records before/after values and actor.
        // On a thrown error, the enclosing transaction clears local settings.
        await store.query("select set_config('career_crox.identity_correction',$1,true), set_config('career_crox.actor',$2,true), set_config('career_crox.reason',$3,true)",
          [settings?.correction || '', settings?.actor || '', settings?.reason || '']);
      }
      return result;
    });
  });
}
module.exports = {normalizedName, normalizedPhone, identityDelta, assertCandidateIdentityStable, withManagerCorrection};
