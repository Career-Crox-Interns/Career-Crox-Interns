const crypto = require('crypto');
const fail = message => Object.assign(new Error(message), { status: 409 });
const norm = value => String(value ?? '').trim().toLowerCase();
const protectedUserField = key => /password|secret|token|session|auth|mfa|otp/i.test(key)
  || /^(user_id|username|full_name|role|designation|recruiter_code|is_active|team_id|tl_user_id|tl_code|tl_name|manager_user_id|manager_code|manager_name|reporting_to)$/.test(key);
const identityField = key => /(^user_id$|_user_id$|^user_ids$|^employee_no$|^tl_id$|^manager_id$|^recruiter_id$|^owner_id$|^assigned_to$|^approved_by$|^created_by$|^reporting_to$|^thread_key$|^thread_id$|^conversation_key$|^conversation_id$|^member_ids$|^member_user_ids$|^owner_ids$|^participant_ids$)/.test(key);
const jsonField = (table, key) => /(metadata|_json$|^payload$)/.test(key)
  || table === 'settings' && key === 'setting_value' || table === 'app_settings' && key === 'value';
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Reconcile people before any write. IDs alone cannot identify an employee after a roster migration.
function reconcileBackup(payload, roster, targetSchema) {
  if (!Array.isArray(payload?.tables?.users)) throw fail('This backup has no employee roster. Choose a complete Career Crox backup.');
  const existingByLogin = new Map(), existingById = new Map();
  for (const user of roster) {
    const login = norm(user.username), id = String(user.user_id || '');
    if (login && existingByLogin.has(login)) throw fail(`More than one current account uses ${login}. Resolve that identity before restoring.`);
    if (login) existingByLogin.set(login, user);
    existingById.set(id, user);
  }
  const used = new Set(existingById.keys()), sourceLogins = new Set(), sourceIds = new Set();
  const identities = new Map(), aliases = new Map(), codes = new Map(), logins = new Map(), byDestination = new Map();
  const users = [], existingMatches = []; let matched = 0, archived = 0;
  const add = (map, old, value) => {
    old = String(old ?? '').trim(); value = String(value ?? '');
    if (!old) return;
    if (map.has(old) && map.get(old) !== value) throw fail(`The backup has conflicting employee identity ${old}. No data was restored.`);
    map.set(old, value);
  };
  for (const source of payload.tables.users) {
    const oldId = String(source?.user_id || '').trim(), login = norm(source?.username);
    if (!oldId || !login) throw fail('A backup employee is missing its ID or username. No data was restored.');
    if (sourceIds.has(oldId) || sourceLogins.has(login)) throw fail(`The backup repeats employee ${login}. No data was restored.`);
    sourceIds.add(oldId); sourceLogins.add(login);
    const existing = existingByLogin.get(login);
    let destination;
    if (existing) {
      destination = existing; matched++;
    } else {
      let id = oldId;
      if (used.has(id)) {
        const stem = 'RESTORE-' + crypto.createHash('md5').update(login + '\x1f' + oldId).digest('hex').slice(0, 20);
        id = stem; let suffix = 0;
        while (used.has(id)) id = stem + '-' + (++suffix);
      }
      destination = { ...source, user_id: id, username: String(source.username).trim(), recruiter_code: id, is_active: '0' };
      used.add(id); archived++;
    }
    const row = { ...source };
    if (existing) {
      for (const key of Object.keys(row)) if (protectedUserField(key)) row[key] = existing[key] ?? null;
      row.user_id = existing.user_id; row.username = existing.username;
    } else Object.assign(row, { user_id: destination.user_id, username: destination.username, recruiter_code: destination.recruiter_code, is_active: '0' });
    users.push(row); existingMatches.push(Boolean(existing)); byDestination.set(String(destination.user_id), destination);
    add(identities, oldId, String(destination.user_id));
    add(aliases, oldId, String(destination.user_id));
    add(aliases, source.recruiter_code, String(destination.user_id));
    add(codes, source.recruiter_code || oldId, String(destination.recruiter_code || destination.user_id));
    add(codes, oldId, String(destination.recruiter_code || destination.user_id));
    add(logins, String(source.username), String(destination.username));
  }
  for (const u of roster) if (!byDestination.has(String(u.user_id))) byDestination.set(String(u.user_id), u);
  const keys = [...aliases.keys()].filter(k => /^[A-Za-z0-9_-]+$/.test(k)).sort((a,b) => b.length-a.length);
  const expression = keys.length ? new RegExp('(^|[^A-Za-z0-9-])(' + keys.map(escape).join('|') + ')(?=$|[^A-Za-z0-9-])', 'g') : null;
  function scalar(value) {
    if (typeof value !== 'string') return value;
    let result = aliases.has(value) ? aliases.get(value) : expression ? value.replace(expression, (all, prefix, id) => prefix + aliases.get(id)) : value;
    if (result.startsWith('dm:')) {
      const parts = result.slice(3).split('__');
      if (parts.length === 2) result = 'dm:' + parts.sort().join('__');
    }
    return result;
  }
  function json(value, depth = 0) {
    if (depth > 64) throw fail('Backup metadata is nested too deeply.');
    if (typeof value === 'string') return scalar(value);
    if (Array.isArray(value)) return value.map(v => json(v, depth + 1));
    if (value && typeof value === 'object') {
      const result = Object.create(null);
      for (const [key, val] of Object.entries(value)) {
        const mapped = scalar(key);
        if (Object.prototype.hasOwnProperty.call(result, mapped)) throw fail('Employee mapping would merge two metadata keys. No data was restored.');
        result[mapped] = json(val, depth + 1);
      }
      return result;
    }
    return value;
  }
  function row(table, source) {
    const result = { ...source };
    for (const [key, value] of Object.entries(result)) {
      if (typeof value === 'string' && /username$/.test(key)) result[key] = logins.get(value) || value;
      else if (typeof value === 'string' && /_code$/.test(key)) result[key] = codes.get(value) || scalar(value);
      else if (identityField(key)) result[key] = Array.isArray(value) || value && typeof value === 'object' ? json(value) : scalar(value);
      else if (jsonField(table, key)) {
        if (typeof value === 'string') { try { result[key] = JSON.stringify(json(JSON.parse(value))); } catch (e) { if (e.status) throw e; } }
        else if (value && typeof value === 'object') result[key] = json(value);
      } else if (table === 'settings' && key === 'setting_key' && String(value).startsWith('mobile_appearance_')) result[key] = scalar(value);
    }
    for (const prefix of ['recruiter','employee','tl','manager','owner']) {
      const owner = byDestination.get(String(result[prefix + '_user_id'] || ''));
      if (owner && Object.prototype.hasOwnProperty.call(result, prefix + '_name')) result[prefix + '_name'] = owner.full_name || owner.username;
    }
    return result;
  }
  const schema = { ...payload.schema }, tables = {};
  for (const [table, rows] of Object.entries(payload.tables)) {
    if (table === 'users') tables.users = rows.map((source, i) => {
      const result = row('users', source), identity = users[i];
      if (existingMatches[i]) {
        for (const key of Object.keys(identity)) if (protectedUserField(key)) result[key] = identity[key];
      } else Object.assign(result, { user_id: identity.user_id, username: identity.username, recruiter_code: identity.recruiter_code, is_active: '0' });
      return result;
    });
    else tables[table] = rows.map(item => row(table, item));
  }
  // New historical-only accounts are inactive even when an old backup did not declare this column.
  const columns = [...schema.users.columns];
  for (const key of ['username','recruiter_code','is_active']) if (users.some(u => Object.prototype.hasOwnProperty.call(u, key)) && !columns.some(c=>c.name===key)) {
    const spec = targetSchema.users.columns.find(c=>c.name===key); if (!spec) throw fail('Current user schema is incomplete.'); columns.push(spec);
  }
  schema.users = { ...schema.users, columns };
  // Appended security columns must be populated for every row in recordset inserts.
  // Otherwise an older backup that omitted is_active could null a matched account.
  for (const result of tables.users) {
    const current = byDestination.get(String(result.user_id));
    for (const column of columns) if (protectedUserField(column.name) && !(column.name in result)) {
      result[column.name] = current?.[column.name] ?? null;
    }
  }
  return { payload: { ...payload, schema, tables }, identity: { matched, historical_accounts: archived, mapped_ids: [...identities].filter(([a,b])=>a!==b).length }, identities };
}
module.exports = { reconcileBackup, protectedUserField };
