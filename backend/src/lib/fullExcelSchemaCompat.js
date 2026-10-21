'use strict';
// CC879: adapt only the two documented activity-log identities. Never discard
// source fields, rewrite a nonempty identity, or change an existing primary key.
const crypto = require('crypto');
const fail = message => Object.assign(new Error(message), {status: 409});
const blank = value => value == null || String(value).trim() === '';
const MAX = 9223372036854775807n, MIN = -9223372036854775808n;
function integerId(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return false;
  try {
    const text = String(value), n = BigInt(text);
    return n.toString() === text && n >= MIN && n <= MAX;
  } catch { return false; }
}
function sameKey(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length
    && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}
function adaptActivitySchema(payload, actual) {
  const source = payload.schema.activity_log, destination = actual.activity_log;
  if (!source || !destination) return {payload, target: actual, additions: []};
  const knownKey = key => Array.isArray(key) && key.length === 1 && ['id','activity_id'].includes(key[0]);
  if (!knownKey(source.primary_key) || !knownKey(destination.primary_key)) {
    if (!sameKey(source.primary_key, destination.primary_key)) throw fail('Unsupported activity_log primary key. No records were changed.');
    return {payload, target: actual, additions: []};
  }
  const sourceFields = new Map(source.columns.map(c => [c.name, c]));
  const columns = destination.columns.map(c => ({...c})), additions = [];
  // Legacy activity_id-only databases also need id for the current timeline.
  // Plan this here; execute the ADD COLUMN only inside the confirmed restore.
  if (!columns.some(c => c.name === 'id')) {
    const type = sourceFields.get('id')?.type || 'text';
    if (!['text','int8'].includes(type)) throw fail('Unsupported activity_log.id type. No records were changed.');
    const column = {name: 'id', type};
    columns.push(column); additions.push({table: 'activity_log', ...column});
  }
  const fields = new Map(columns.map(c => [c.name,c]));
  for (const c of source.columns) {
    const target = fields.get(c.name);
    if (!target) throw fail('Destination is missing activity_log.' + c.name + '. Apply the same safe schema.');
    if (c.type !== target.type && !(c.name === 'id' && ['text','int8'].includes(c.type) && ['text','int8'].includes(target.type)))
      throw fail('Column types differ for activity_log.' + c.name + '. No records were changed.');
  }
  for (const c of columns) if (!sourceFields.has(c.name) && !['id','activity_id'].includes(c.name))
    throw fail('Snapshot is missing activity_log.' + c.name + '. Export a complete CRM file.');
  if (fields.get('activity_id')?.type !== 'text' || !['text','int8'].includes(fields.get('id').type))
    throw fail('Unsupported activity_log identity types. No records were changed.');
  const numeric = fields.get('id').type === 'int8', rows = payload.tables.activity_log.map(r => ({...r}));
  const used = new Set();
  for (const row of rows) if (!blank(row.id)) {
    if ((numeric || sourceFields.get('id')?.type === 'int8') && !integerId(row.id)) throw fail('activity_log.id cannot be stored as bigint without changing an existing ID. No records were changed.');
    used.add(String(row.id));
  }
  for (const row of rows) {
    if (blank(row.activity_id)) row.activity_id = blank(row.id) ? null : String(row.id);
    if (blank(row.id)) {
      if (blank(row.activity_id)) throw fail('An activity has no usable ID. No records were changed.');
      if (!numeric) row.id = String(row.activity_id);
      else if (integerId(row.activity_id) && !used.has(String(row.activity_id))) row.id = String(row.activity_id);
      else {
        // This source had no id. Keep its activity_id unchanged and create only
        // the destination's internal numeric surrogate, deterministically.
        let salt = 0, candidate;
        do {
          const hash = crypto.createHash('sha256').update('CC879/activity_log/' + String(row.activity_id) + '/' + salt++).digest('hex').slice(0,16);
          candidate = String(BigInt('0x' + hash) % MAX + 1n);
        } while (used.has(candidate));
        row.id = candidate;
      }
      used.add(String(row.id));
    }
  }
  const target = {...actual, activity_log: {...destination, columns}};
  const adapted = {...payload, schema: {...payload.schema, activity_log: {columns, primary_key: [...destination.primary_key]}}, tables: {...payload.tables, activity_log: rows}};
  return {payload: adapted, target, additions};
}
module.exports = {adaptActivitySchema, integerId, sameKey};
