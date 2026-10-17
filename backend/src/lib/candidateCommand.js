const crypto = require('crypto');
const { store, withTransaction, callController } = require('./store');
const { visibleCandidateForUser } = require('./accessRules');

const WORKFLOW_VERSION = 'profile-commit-v2';
const RELEASE = 'CC804';
const PROTECTED_FIELDS = new Set([
  'candidate_id', 'created_at', 'updated_at', 'approval_status',
  'approval_requested_at', 'approved_at', 'approved_by_name', 'submitted_by',
  'created_by_user_id', 'created_by_name', 'user_id', 'recruiter_user_id',
  'last_viewed_at', 'last_viewed_by_name', 'previous_last_viewed_at',
  'previous_last_viewed_by_name', 'notes', 'last_updated_at',
  'bucket_state',
]);
function fail(status, message, code) {
  throw Object.assign(new Error(message), { status, code });
}
function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (plainObject(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function profileFields(input, allowed) {
  const fields = {};
  for (const [key, value] of Object.entries(input)) {
    if (key.startsWith('_') || PROTECTED_FIELDS.has(key) || !allowed.has(key)) continue;
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
      fail(400, `Invalid value for ${key}.`, 'INVALID_PROFILE_FIELDS');
    }
    fields[key] = value === null ? '' : String(value);
  }
  return fields;
}

// Profile, note, submission and receipt commit together. Cached presentation
// defaults never become write guards. Both workflow buttons use this command.
async function commit(req, res) {
  try {
    const controller = require('../controllers/candidateController');
    const input = req.body || {};
    if (input.workflow_release && input.workflow_release !== RELEASE) {
      fail(409, 'Profile app and server versions differ. Refresh after deploying the full CC804 GitHub folder. Your draft is kept.', 'WORKFLOW_VERSION_MISMATCH');
    }
    if (input.workflow_version && input.workflow_version !== WORKFLOW_VERSION) {
      fail(409, 'This profile workflow needs the matching frontend and backend. Your draft is kept.', 'WORKFLOW_VERSION_MISMATCH');
    }
    const requestedAction = String(input.action || '').trim();
    if (!['save', 'submit', 'save_submit', 'save_and_submit'].includes(requestedAction)) {
      fail(400, 'Choose Save or Save & Submit.', 'INVALID_PROFILE_ACTION');
    }
    if(req.body?.resume)delete req.body.resume;
  const action = requestedAction === 'save' ? 'save' : 'submit';
    if (!plainObject(input.fields || {})) fail(400, 'Profile fields are invalid.', 'INVALID_PROFILE_FIELDS');
    const key = String(input.command_id || '').trim();
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key)) fail(400, 'A stable command ID is required.', 'INVALID_COMMAND_ID');
    const actor = String(req.user?.user_id || req.user?.username || '').trim();
    if (!actor) fail(401, 'Sign in before saving.', 'NOT_AUTHENTICATED');
    const requestedId = String(req.params?.candidateId || 'new').trim();
    const fields = profileFields(input.fields || {}, new Set(controller.PERSISTED_CANDIDATE_FIELDS));
    const note = input.note == null ? null : input.note;
    if (note && (!plainObject(note) || typeof note.body !== 'string')) fail(400, 'Note text is invalid.', 'INVALID_NOTE');
    const resume = null; // Original files never persist through a profile commit.
    if (resume && !plainObject(resume)) fail(400,'Resume payload is invalid.','INVALID_RESUME');
    const receiptId = `${actor}:${key}`;
    const signature = crypto.createHash('sha256').update(JSON.stringify(canonical({ action, requestedId, fields, note, ...(resume ? {resume} : {}) }))).digest('hex');

    const result = await withTransaction(async () => {
      if (store.pool) await store.query('select pg_advisory_xact_lock(hashtext($1))', [receiptId]);
      const previous = await store.findById('crm_command_receipts', 'command_id', receiptId);
      if (previous) {
        if (previous.payload_hash !== signature) fail(409, 'This retry contains different details. Press the button again for a new save.', 'COMMAND_CHANGED');
        const receipt = JSON.parse(previous.receipt_json);
        const current = await store.findById('candidates', 'candidate_id', receipt.candidate_id || receipt.item?.candidate_id);
        if (!current || !visibleCandidateForUser(current, req.user)) fail(403, 'Profile access changed.', 'PROFILE_ACCESS_CHANGED');
        let submission = null;
        if (action === 'submit') {
          if (!await controller.submissionNoteForCandidate(current)) fail(400,'Add a profile note before Save & Submit. Save can keep a draft without notes.','NOTE_REQUIRED');
          submission = await store.findById('submissions', 'submission_id', receipt.submission?.submission_id);
          if (!submission) fail(409, 'The earlier submission was removed or reset. Submit the profile again.', 'COMMAND_NO_LONGER_CURRENT');
        }
        const workflow = submission || await controller.findSubmissionCompat(current.candidate_id, ['pending','approved','rejected']);
        return { ...receipt, workflow_release: RELEASE, item: controller.candidateEditResponse(current, req.user, {
          ...current, submission_id: workflow?.submission_id || '', submission_exists: workflow ? '1' : '0', workflow_incomplete: false,
        }), submission, replayed: true };
      }

      let id = requestedId;
      const base = { ...req, query: {}, params: { ...req.params }, body: { ...fields } };
      if (requestedId === 'new') {
        if (store.pool) await store.query('select pg_advisory_xact_lock(hashtext($1))', ['crm-candidate-create']);
        const created = await callController(controller.create, base);
        id = created.item?.candidate_id;
        if (!id) fail(503, 'Database did not create the profile. Retry Save.', 'PROFILE_NOT_COMMITTED');
      } else {
        if (store.pool) await store.query('select candidate_id from candidates where candidate_id = $1 for update', [id]);
        const current = await store.findById('candidates', 'candidate_id', id);
        if (!current) fail(404, 'Candidate not found.', 'PROFILE_NOT_FOUND');
        if (!visibleCandidateForUser(current, req.user)) fail(403, 'Not allowed to edit this profile.', 'PROFILE_ACCESS_CHANGED');
        if (String(current.bucket_state || '').toLowerCase() === 'fresh') {
          await store.update('candidates', 'candidate_id', id, {bucket_state:'working',bucket_assigned_at:new Date().toISOString()});
        }
        // Merge this button's field delta into the locked current row. Unrelated
        // edits survive; for the same field the latest explicit Save wins.
        if (Object.keys(fields).length) {
          base.body.last_updated_at = new Date().toISOString();
          base.body._changed_fields = Object.keys(base.body);
          await callController(controller.update, base);
        }
      }

      const savedNote = note?.body?.trim()
        ? (await callController(controller.addNote, { ...base, params: { candidateId: id }, body: { ...note, client_note_key: key } })).item
        : null;
      const savedResume = resume ? await callController(controller.uploadCandidateFile, {
        ...base, params:{candidateId:id}, body:{...resume,file_kind:'resume'},
      }) : null;
      let submission = null;
      let alreadySubmitted = false;
      if (action === 'submit') {
        const submitted = await callController(controller.submitForApproval, {
          ...base, params: { candidateId: id }, body: { submission_date: fields.submission_date || '' },
        });
        submission = submitted.submission;
        alreadySubmitted = Boolean(submitted.already_submitted);
        if (!submission?.submission_id) fail(503, 'Database did not confirm the submission. Retry Save & Submit.', 'PROFILE_NOT_COMMITTED');
      }
      const row = await store.findById('candidates', 'candidate_id', id);
      if (!row) fail(503, 'Database did not confirm the profile.', 'PROFILE_NOT_COMMITTED');
      const workflow = submission || await controller.findSubmissionCompat(id, ['pending','approved','rejected']);
      const receipt = {
        ok: true, committed: true, workflow_version: WORKFLOW_VERSION, workflow_release: RELEASE,
        command_id: key, action, candidate_id: id,
        item: controller.candidateEditResponse(row, req.user, { ...row,
          submission_id: workflow?.submission_id || '', submission_exists: workflow ? '1' : '0', workflow_incomplete: false,
        }),
        note: savedNote, submission, already_submitted: alreadySubmitted,
        ...(savedResume ? {resume:savedResume.item,files:savedResume.files} : {}),
        reminder_due_at: submission?.reminder_due_at || null,
      };
      await store.insert('crm_command_receipts', {
        command_id: receiptId, user_id: actor, candidate_id: id, payload_hash: signature,
        receipt_json: JSON.stringify(receipt), created_at: new Date().toISOString(),
      });
      return receipt;
    });
    // Resolves only after COMMIT succeeded. Never return optimistic success.
    return res.json(result);
  } catch (error) {
    if (error.code === 'CC081') return res.status(400).json({message:error.message,code:'NOTE_REQUIRED'});
    if (error.code === 'CC070') return res.status(409).json({ message: error.message, code: 'BUCKET_CAPACITY_REACHED' });
    if (['42P01', '42703'].includes(error.code)) return res.status(503).json({ message: 'Run 02_STRUCTURE_ONLY.sql in Supabase, then restart the matching backend. Your draft is kept.', code: 'SCHEMA_MISSING' });
    if (['25P02', 'TRANSACTION_NOT_COMMITTED'].includes(error.code)) return res.status(503).json({ message: 'Database could not commit this profile. Your draft is kept; retry the same button.', code: 'PROFILE_NOT_COMMITTED' });
    if (error.status) return res.status(error.status).json(error.payload || { message: error.message, code: error.code });
    throw error;
  }
}
module.exports = { commit, WORKFLOW_VERSION, RELEASE };
