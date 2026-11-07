const crypto = require('crypto');
const { isDeepStrictEqual } = require('util');
const fail = message => Object.assign(new Error(message), { status: 409 });
const norm = value => String(value ?? '').trim().toLowerCase();
const protectedUserField = key => /password|secret|token|session|auth|mfa|otp/i.test(key)
  || /^(user_id|username|full_name|role|designation|recruiter_code|is_active|team_id|tl_user_id|tl_code|tl_name|manager_user_id|manager_code|manager_name|reporting_to)$/.test(key);
const identityField = key => /(^user_id$|_user_id$|^user_ids$|^employee_no$|^tl_id$|^manager_id$|^recruiter_id$|^owner_id$|^assigned_to$|^approved_by$|^created_by$|^reporting_to$|^thread_key$|^thread_id$|^conversation_key$|^conversation_id$|^member_ids$|^member_user_ids$|^owner_ids$|^participant_ids$)/.test(key);
const jsonField = (table, key) => /(metadata|_json$|^payload$)/.test(key)
  || table === 'settings' && key === 'setting_value' || table === 'app_settings' && key === 'value';
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Reconcile people before any write. IDs alone cannot identify an employee after a roster migration.
function reconcileBackup(payload, roster, targetSchema, options={}) {
  if (!Array.isArray(payload?.tables?.users)) throw fail('This backup has no employee roster. Choose a complete Career Crox backup.');
  const report={issues:[],issue_count:0,warnings:[],appearance_conflicts:[],appearance_archive_bytes:0,repaired_draft_keys:0};
  const issueGroups=new Map();
  function capture(table,index,error){
    if(!options.collectIssues||!error.status)throw error;
    report.issue_count++;
    const message=String(error.message),key=table+'\0'+message;
    let item=issueGroups.get(key);
    if(!item&&report.issues.length<100){item={code:'IDENTITY_CONFLICT',table,message,count:0,rows:[]};issueGroups.set(key,item);report.issues.push(item);}
    if(item){item.count++;if(item.rows.length<5)item.rows.push(index+1);}
  }
  const existingByLogin = new Map(), existingById = new Map();
  for (const user of roster) {
    const login = norm(user.username), id = String(user.user_id || '');
    if (login && existingByLogin.has(login)) throw fail(`More than one current account uses ${login}. Resolve that identity before restoring.`);
    if (login) existingByLogin.set(login, user);
    existingById.set(id, user);
  }
  const used = new Set(existingById.keys()), sourceLogins = new Set(), sourceIds = new Set();
  const identities = new Map(), aliases = new Map(), codes = new Map(), logins = new Map(), byDestination = new Map();
  const draftKeys = { crm_candidate_drafts: new Set(), crm_draft_deletions: new Set() };
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
      destination = options.transfer ? {...source,user_id:existing.user_id} : existing; matched++;
    } else {
      let id = oldId;
      if (used.has(id)) {
        const stem = 'RESTORE-' + crypto.createHash('md5').update(login + '\x1f' + oldId).digest('hex').slice(0, 20);
        id = stem; let suffix = 0;
        while (used.has(id)) id = stem + '-' + (++suffix);
      }
      destination = { ...source, user_id: id, username: String(source.username).trim(), recruiter_code: options.transfer ? source.recruiter_code||id : id, is_active: options.transfer ? source.is_active??'1' : '0' };
      used.add(id); archived++;
    }
    const row = { ...source };
    if (existing && !options.transfer) {
      for (const key of Object.keys(row)) if (protectedUserField(key)) row[key] = existing[key] ?? null;
      row.user_id = existing.user_id; row.username = existing.username;
    } else Object.assign(row, { user_id: destination.user_id, username: destination.username, recruiter_code: destination.recruiter_code, is_active: options.transfer ? source.is_active??'1' : '0' });
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
    // CC187: older restores remapped user_id but left the previous employee ID
    // in draft_id. The roster-backed row owner is authoritative; the old key
    // prefix must never select another employee. Preserve the UUID/edit suffix,
    // draft fields, notes and submitted candidate mapping without dropping rows.
    if(['crm_candidate_drafts','crm_draft_deletions'].includes(table)){
      const before=String(source.user_id||''),key=String(source.draft_id||'');
      const owner=identities.get(before);
      if(!owner||!key)throw fail('A draft owner or key is missing from the backup employee roster in '+table+'. No records were restored.');
      let suffix;
      if(key.startsWith(before+':')&&key.length>before.length+1)suffix=key.slice(before.length+1);
      else{
        // Only known legacy UUID/edit keys can be repaired. This also accepts
        // an unscoped UUID, while keeping unknown or damaged keys fail-closed.
        const legacy=/^(?:[^:\x00-\x1f]+:)?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|edit:[^:\x00-\x1f]+)$/.exec(key);
        if(!legacy)throw fail('Unrecognized legacy draft key in '+table+'. No records were restored.');
        suffix=legacy[1];
        if(table==='crm_candidate_drafts'&&suffix.startsWith('edit:')&&String(source.candidate_id||'')!==suffix.slice(5))
          throw fail('Legacy edit draft and candidate do not match. No records were restored.');
        report.repaired_draft_keys++;
      }
      result.user_id=owner;
      result.draft_id=owner+':'+suffix;
      if(draftKeys[table].has(result.draft_id))throw fail('Two draft records resolve to the same owner/key in '+table+'. No records were restored. Review the source drafts before importing.');
      draftKeys[table].add(result.draft_id);
    }
    if(table==='candidates'&&typeof source.details_review_by==='string')result.details_review_by=scalar(source.details_review_by);
    for (const prefix of ['recruiter','employee','tl','manager','owner']) {
      const owner = byDestination.get(String(result[prefix + '_user_id'] || ''));
      if (owner && Object.prototype.hasOwnProperty.call(result, prefix + '_name')) result[prefix + '_name'] = owner.full_name || owner.username;
    }
    return result;
  }
  const mobileAppearancePrefix = 'mobile_appearance_';
  const appearanceSourceOwners = new Map();
  for (const source of payload.tables.users) {
    const sourceId = String(source?.user_id ?? '').trim();
    const recruiterCode = String(source?.recruiter_code ?? '').trim();
    for (const alias of new Set([sourceId, recruiterCode].filter(Boolean))) {
      if (appearanceSourceOwners.has(alias) && appearanceSourceOwners.get(alias)?.sourceId !== sourceId) {
        appearanceSourceOwners.set(alias, null);
      } else if (!appearanceSourceOwners.has(alias)) {
        appearanceSourceOwners.set(alias, { sourceId, recruiterCode });
      }
    }
  }
  function sameSettingPayload(left, right) {
    const leftCopy = { ...left }, rightCopy = { ...right };
    delete leftCopy.setting_key;
    delete rightCopy.setting_key;
    return isDeepStrictEqual(leftCopy, rightCopy);
  }
  function mapSettings(rows) {
    const mappedRows = [], firstByMappedKey = new Map();
    for (const [index,source] of rows.entries()) {
     try{
      const mapped = row('settings', source);
      const originalKey = String(source?.setting_key ?? '');
      if (!originalKey.startsWith(mobileAppearancePrefix)) {
        mappedRows.push(mapped);
        continue;
      }
      const sourceSuffix = originalKey.slice(mobileAppearancePrefix.length);
      const owner = appearanceSourceOwners.get(sourceSuffix) || null;
      const previous = firstByMappedKey.get(mapped.setting_key);
      if (!previous) {
        firstByMappedKey.set(mapped.setting_key, { index: mappedRows.length, sourceSuffix, owner, row: mapped });
        mappedRows.push(mapped);
        continue;
      }
      const sameEmployee = Boolean(owner && previous.owner && owner.sourceId === previous.owner.sourceId);
      const expectedAliases = owner && previous.owner
        && owner.sourceId === previous.owner.sourceId
        && owner.recruiterCode === previous.owner.recruiterCode
        && owner.sourceId !== owner.recruiterCode;
      const suffixes = new Set([sourceSuffix, previous.sourceSuffix]);
      const isIdAndCodePair = Boolean(expectedAliases && suffixes.size === 2
        && suffixes.has(owner.sourceId) && suffixes.has(owner.recruiterCode));
      if (!sameEmployee || !isIdAndCodePair) {
        throw fail('Mobile appearance settings map to the same employee key but are not a matching ID/code pair with identical contents. No data was restored. Review the source settings first.');
      }
      if(!sameSettingPayload(previous.row,mapped)){
        if(options.appearancePolicy!=='source-user-id')throw fail('Mobile appearance settings map to the same employee key but are not a matching ID/code pair with identical contents. No data was restored. Review the source settings first.');
        // These are display preferences for the SAME proven employee, never
        // credentials or business records. The app reads the user-ID key.
        // Keep both cleaned alternatives in the confirmed import's local log.
        const chosen=sourceSuffix===owner.sourceId?originalKey:mobileAppearancePrefix+previous.sourceSuffix;
        const conflict={employee_id:owner.sourceId,destination_key:mapped.setting_key,chosen_source_key:chosen,alternatives:[previous.row,mapped],source_keys:[mobileAppearancePrefix+previous.sourceSuffix,originalKey]};
        const bytes=Buffer.byteLength(JSON.stringify(conflict));
        if(report.appearance_archive_bytes+bytes>128*1024)throw fail('Conflicting display preferences exceed the 128 KB preservation limit. Review the source appearance settings before importing.');
        report.appearance_archive_bytes+=bytes;report.appearance_conflicts.push(conflict);
        report.warnings.push({code:'APPEARANCE_ALIAS_REPAIRED',table:'settings',message:'Two display-preference copies for the same employee will use the source user-ID copy. Both alternatives are retained in the import record.',employee_id:owner.sourceId});
      }
      // Keep the canonical source-user-ID row when the old ID and recruiter-code keys converge.
      if (sourceSuffix === owner.sourceId && previous.sourceSuffix !== owner.sourceId) {
        mappedRows[previous.index] = mapped;
        firstByMappedKey.set(mapped.setting_key, { ...previous, sourceSuffix, owner, row: mapped });
      }
     }catch(error){capture('settings',index,error);}
    }
    return mappedRows;
  }
  const schema = { ...payload.schema }, tables = {};
  for (const [table, rows] of Object.entries(payload.tables)) {
    if (table === 'users') tables.users = rows.map((source, i) => {
      const result = row('users', source), identity = users[i];
      if (existingMatches[i] && !options.transfer) {
        for (const key of Object.keys(identity)) if (protectedUserField(key)) result[key] = identity[key];
      } else Object.assign(result, { user_id: identity.user_id, username: identity.username, recruiter_code: identity.recruiter_code, is_active: options.transfer ? source.is_active??'1' : '0' });
      return result;
    });
    else if (table === 'settings') tables[table] = mapSettings(rows);
    else tables[table] = rows.map((item,index) => {try{return row(table,item);}catch(error){capture(table,index,error);return {...item};}});
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
  return { payload: { ...payload, schema, tables }, identity: { matched, historical_accounts: archived, mapped_ids: [...identities].filter(([a,b])=>a!==b).length }, identities, report };
}
module.exports = { reconcileBackup, protectedUserField };
