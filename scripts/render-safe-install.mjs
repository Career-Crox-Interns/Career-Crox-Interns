import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'node:zlib';

const target = process.argv[2] || 'backend';
const root = process.cwd();
const dir = path.join(root, target);
if (!['frontend','backend'].includes(target)) throw new Error('Invalid dependency target');
if (!fs.existsSync(dir)) { console.error(`Missing folder: ${target}`); process.exit(1); }


// CC912: normal profile updates and audited manager identity corrections.
const repairMarker = '// CC912_IDENTITY_SAVE_FIX';
const identityGuard = String.raw`'use strict';
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
`;

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before) || source.indexOf(before) !== source.lastIndexOf(before)) {
    throw new Error('CC912 cannot safely update ' + label + '. The backend version differs; keep the current files and provide its candidateCommand.js for a matching repair.');
  }
  return source.replace(before, after);
}
function repairCommand(source) {
  if (source.includes(repairMarker)) return source;
  source = replaceOnce(source,
    "const { assertCandidateIdentityStable } = require('./candidateIdentityGuard');",
    "const { assertCandidateIdentityStable, withManagerCorrection } = require('./candidateIdentityGuard');\n" + repairMarker,
    'identity import');
  source = replaceOnce(source,
    '  const fields = {};\n  for (const [key, value] of Object.entries(input)) {',
    '  const fields = {};\n  const edited = Array.isArray(input._changed_fields) ? new Set(input._changed_fields) : null;\n  for (const [key, value] of Object.entries(input)) {\n    if (edited && !edited.has(key)) continue;',
    'explicit field selection');
  const before = `        // CC847: validate the committed identity before any status, note or submission write.
        assertCandidateIdentityStable(current, { ...current, ...fields });
        if (String(current.bucket_state || '').toLowerCase() === 'fresh') {
          await store.update('candidates', 'candidate_id', id, {bucket_state:'working',bucket_assigned_at:new Date().toISOString()});
        }
        // Merge this button's field delta into the locked current row. Unrelated
        // edits survive; for the same field the latest explicit Save wins.
        if (Object.keys(fields).length) {
          base.body.last_updated_at = new Date().toISOString();
          base.body._changed_fields = Object.keys(base.body);
          await callController(controller.update, base);
        }`;
  const after = `        await withManagerCorrection(req, current, { ...current, ...fields }, async () => {
          assertCandidateIdentityStable(current, { ...current, ...fields });
          if (String(current.bucket_state || '').toLowerCase() === 'fresh') {
            await store.update('candidates', 'candidate_id', id, {bucket_state:'working',bucket_assigned_at:new Date().toISOString()});
          }
          if (Object.keys(fields).length) {
            base.body.last_updated_at = new Date().toISOString();
            base.body._changed_fields = [...Object.keys(fields), 'last_updated_at'];
            const meta = input.fields || {};
            if (typeof meta._client_updated_at === 'string') base.body._client_updated_at = meta._client_updated_at;
            if (plainObject(meta._client_base_values)) base.body._client_base_values = meta._client_base_values;
            await callController(controller.update, base);
          }
        });`;
  return replaceOnce(source, before, after, 'atomic profile Save');
}
function restoreBundledSource() {
  const backend = path.join(root, 'backend');
  const archive = path.join(backend, 'source.bundle.json.gz');
  if (!fs.existsSync(archive)) return;
  const data = JSON.parse(zlib.gunzipSync(fs.readFileSync(archive), {maxOutputLength: 40 * 1024 * 1024}).toString('utf8'));
  if (!data.files || typeof data.files !== 'object') throw new Error('Backend source archive is incomplete.');
  const pending = [];
  for (const [relative, item] of Object.entries(data.files)) {
    if (!relative.startsWith('src/') || relative.includes('\\') || relative.includes('\0') ||
        relative.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Invalid backend source path.');
    const file = path.resolve(backend, relative);
    if (!file.startsWith(backend + path.sep)) throw new Error('Invalid backend source location.');
    const bytes = Buffer.from(item.base64, 'base64');
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error('Backend source checksum failed: ' + relative);
    pending.push({file, bytes});
  }
  if (!pending.some(item => item.file === path.join(backend, 'src/server.js'))) throw new Error('Backend server source is missing.');
  for (const {file, bytes} of pending) writeChecked(file, bytes);
}
function writeChecked(file, bytes) {
  if (fs.existsSync(file) && fs.readFileSync(file).equals(bytes)) return;
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = file + '.cc912-' + process.pid;
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, file);
}
function applySaveRepair() {
  restoreBundledSource();
  const directory = path.join(root, 'backend/src/lib');
  const commandPath = path.join(directory, 'candidateCommand.js');
  const guardPath = path.join(directory, 'candidateIdentityGuard.js');
  if (!fs.existsSync(commandPath) || !fs.existsSync(guardPath)) {
    throw new Error('CC912: backend/src/lib candidate source is missing. No Save repair was applied.');
  }
  const repaired = repairCommand(fs.readFileSync(commandPath, 'utf8'));
  const currentGuard = fs.readFileSync(guardPath, 'utf8');
  if (!currentGuard.includes('assertCandidateIdentityStable') || !currentGuard.includes('normalizedPhone')) {
    throw new Error('CC912: incompatible identity guard. No Save repair was applied.');
  }
  // Check both complete modules before replacing either source file.
  for (const source of [identityGuard, repaired]) {
    execFileSync(process.execPath, ['--check', '--input-type=commonjs'], {input: source, stdio: ['pipe', 'pipe', 'pipe']});
  }
  writeChecked(guardPath, Buffer.from(identityGuard));
  writeChecked(commandPath, Buffer.from(repaired));
  console.log('CC912 Save repair ready: normal details/notes and audited manager corrections.');
}

applySaveRepair();

const pkgPath = path.join(dir, 'package.json');
const lockPath = fs.existsSync(path.join(dir, 'package-lock.json')) ? path.join(dir, 'package-lock.json') : '';
const nodeModules = path.join(dir, 'node_modules');
const marker = path.join(nodeModules, '.career-crox-deps.sha256');
const hash = crypto.createHash('sha256')
  .update(fs.readFileSync(pkgPath))
  .update(lockPath ? fs.readFileSync(lockPath) : Buffer.from('no-lock'))
  .digest('hex');

function depsReady() {
  try {
    if (!fs.existsSync(marker) || fs.readFileSync(marker, 'utf8').trim() !== hash) return false;
    const req = createRequire(pkgPath);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const deps = Object.keys(pkg.dependencies || {});
    if (target === 'frontend') deps.push(...Object.keys(pkg.devDependencies || {}));
    for (const dep of deps) req.resolve(dep);
    return true;
  } catch { return false; }
}

if (depsReady()) {
  console.log(`${target} dependencies unchanged and cached. Skipping npm install.`);
  process.exit(0);
}

if (!lockPath) throw new Error(`Missing ${target}/package-lock.json`);
const args = ['ci','--prefix',target,target==='frontend'?'--include=dev':'--omit=dev','--prefer-offline','--no-audit','--no-fund','--progress=false'];
if (target==='backend') args.push('--ignore-scripts');
console.log(`Installing locked ${target} dependencies.`);
execFileSync(process.platform==='win32'?'npm.cmd':'npm',args,{ stdio:'inherit',env:{...process.env,NPM_CONFIG_AUDIT:'false',NPM_CONFIG_FUND:'false',NPM_CONFIG_PROGRESS:'false'} });
fs.mkdirSync(nodeModules, { recursive: true });
fs.writeFileSync(marker, hash + '\n');
console.log('Dependency cache marker updated. Future unchanged deploys can skip install.');
