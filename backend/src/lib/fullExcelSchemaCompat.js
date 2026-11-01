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
    const rawType = sourceFields.get('id')?.type;
    const type = ['int2','int4'].includes(rawType) ? 'text' : rawType || 'text';
    if (!['text','int8'].includes(type)) throw fail('Unsupported activity_log.id type. No records were changed.');
    const column = {name: 'id', type};
    columns.push(column); additions.push({table: 'activity_log', ...column});
  }
  const fields = new Map(columns.map(c => [c.name,c]));
  for (const c of source.columns) {
    const target = fields.get(c.name);
    if (!target) throw fail('Destination is missing activity_log.' + c.name + '. Apply the same safe schema.');
  }
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
  const importedColumns = source.columns.map(c => ({...c}));
  for (const c of columns) if (!sourceFields.has(c.name) && ['id','activity_id'].includes(c.name)) importedColumns.push({...c});
  const adapted = {...payload, schema: {...payload.schema, activity_log: {columns: importedColumns, primary_key: [...destination.primary_key]}}, tables: {...payload.tables, activity_log: rows}};
  return {payload: adapted, target, additions};
}


// CC880: safe SQL deliberately keeps legacy column types. Adapt the snapshot,
// not the live column definitions, then prove PostgreSQL can store the values.
const numericTypes = new Set(['int2','int4','int8','numeric','float4','float8']);
const textTypes = new Set(['text','varchar','bpchar','citext','name']);
const temporalTypes = new Set(['date','timestamp','timestamptz']);
const jsonTypes = new Set(['json','jsonb']);
const numberToken = Symbol('exact JSON number');
function decimal(value) {
  if (typeof value !== 'string' && typeof value !== 'number') throw Error('not a numeric value');
  const m = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(String(value).trim());
  if (!m || !Number.isFinite(Number(m[5] || 0)) || Math.abs(Number(m[5] || 0)) > 1000000) throw Error('invalid numeric value');
  const fraction = m[3] ?? m[4] ?? '', raw = (m[2] || '') + fraction;
  let digits = raw.replace(/^0+/,''), exponent = Number(m[5] || 0) - fraction.length;
  if (!digits) return '0';
  const trim = /0+$/.exec(digits)?.[0].length || 0;
  if (trim) { digits = digits.slice(0,-trim); exponent += trim; }
  return (m[1] === '-' ? '-' : '') + digits + 'e' + exponent;
}
function parseExactJson(text) {
  return JSON.parse(text, (_key,value,context) => typeof value === 'number' ? {[numberToken]: context.source} : value);
}
function jsonSignature(value) {
  if (value === null) return 'null';
  if (value && typeof value === 'object' && numberToken in value) return 'n:' + decimal(value[numberToken]);
  if (typeof value === 'number') return 'n:' + decimal(value);
  if (typeof value === 'string') return 's:' + JSON.stringify(value);
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return '[' + value.map(jsonSignature).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + jsonSignature(value[k])).join(',') + '}';
  throw Error('unsupported JSON value');
}
function checkedJson(text) {
  const exact = parseExactJson(text), parsed = JSON.parse(text);
  if (jsonSignature(exact) !== jsonSignature(parsed)) throw Error('JSON number would lose precision');
  return parsed;
}
function temporal(value,type) {
  if (typeof value !== 'string') throw Error('date/time must be a string');
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/.exec(value.trim());
  if (!m) throw Error('date/time must use an ISO date');
  const date = m[1]+'-'+m[2]+'-'+m[3], calendar = new Date(date+'T00:00:00Z');
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0,10) !== date || m[1] === '0000') throw Error('invalid calendar date');
  if (type === 'date') {
    if (m[4] && (+m[4] || +m[5] || +m[6] || /[1-9]/.test(m[7] || ''))) throw Error('date column would discard a time');
    if (m[8] && !['Z','+00','+0000','+00:00','-00','-0000','-00:00'].includes(m[8])) throw Error('date column would discard a time zone');
    return date;
  }
  if (!m[4]) throw Error('timestamp needs an explicit time');
  if (+m[4] > 23 || +m[5] > 59 || +m[6] > 59) throw Error('invalid clock time');
  const fraction = (m[7] || '').padEnd(6,'0');
  if (/[1-9]/.test(fraction.slice(6))) throw Error('timestamp would lose fractional precision');
  let zone = m[8] || '';
  if (type === 'timestamptz' && !zone) throw Error('timestamp needs an explicit time zone');
  if (/^[+-]\d{2}$/.test(zone)) zone += ':00';
  if (/^[+-]\d{4}$/.test(zone)) zone = zone.slice(0,3)+':'+zone.slice(3);
  const millis = Date.parse(date+'T'+m[4]+':'+m[5]+':'+m[6]+'.'+fraction.slice(0,3)+(zone || 'Z'));
  if (!Number.isFinite(millis)) throw Error('invalid time zone');
  // Match the app/pg driver Asia/Kolkata timezone for naive timestamps; keep
  // explicit UTC instants for timestamptz. Keep
  // microseconds instead of passing through JavaScript millisecond rounding.
  const localMillis = type === 'timestamp' && zone ? millis + 330*60000 : millis;
  const normalized = new Date(localMillis).toISOString().slice(0,19)+'.'+fraction.slice(0,6);
  return normalized + (type === 'timestamptz' ? 'Z' : '');
}
const identityColumn = (spec,name) => spec.primary_key.includes(name) || /^(?:id|username|phone|created_by|assigned_to|approved_by|reporting_to)$|_(?:id|code|key)$/.test(name);
function convert(value,sourceType,targetType,identity=false) {
  if (value == null) return null;
  if (['int2','int4','int8'].includes(sourceType) && !integerId(value)) throw Error('declared integer value is unsafe or invalid');
  if (identity && typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) throw Error('unsafe numeric identity');
  if (textTypes.has(targetType)) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw Error('non-finite number'); return String(value); }
    if (typeof value === 'boolean') return String(value);
    if (jsonTypes.has(sourceType) || sourceType.startsWith('_')) return JSON.stringify(value);
    throw Error('structured value is not a text value');
  }
  if (typeof value === 'string' && value.trim() === '' && !identity && textTypes.has(sourceType)
      && (numericTypes.has(targetType) || temporalTypes.has(targetType) || targetType === 'bool' || jsonTypes.has(targetType))) return null;
  if (numericTypes.has(targetType)) {
    const literal = String(value).trim(); decimal(value);
    if (identity && String(value) !== literal) throw Error('numeric identity would change');
    if (identity && typeof value === 'number' && !Number.isSafeInteger(value)) throw Error('unsafe numeric identity');
    return literal;
  }
  if (targetType === 'bool') {
    if (typeof value === 'boolean') return value;
    const literal = String(value).trim().toLowerCase();
    if (['true','t','1','yes','on'].includes(literal)) return true;
    if (['false','f','0','no','off'].includes(literal)) return false;
    throw Error('not a boolean value');
  }
  if (jsonTypes.has(targetType)) return textTypes.has(sourceType) ? checkedJson(String(value)) : value;
  if (temporalTypes.has(targetType)) return temporal(String(value),targetType);
  if (targetType.startsWith('_')) {
    const input = typeof value === 'string' && textTypes.has(sourceType) ? checkedJson(value) : value;
    if (!Array.isArray(input)) throw Error('not an array');
    const sourceBase = sourceType.startsWith('_') ? sourceType.slice(1) : 'text';
    const walk = array => array.map(v => Array.isArray(v) && !jsonTypes.has(targetType.slice(1)) ? walk(v) : convert(v,sourceBase,targetType.slice(1),identity));
    return walk(input);
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw Error('unsupported structured column type');
}
const crm2Columns = {
  call_logs: ['crm_row_id','app_event_id','report_note'],
  candidates: ['interview_time'], chat_groups: ['theme','name'],
  employee_daily_stats: ['crm_row_id','created_at'], manual_dialer_calls: ['crm_row_id'],
  messages: ['receiver_username','receiver_name','room_key','channel_key'],
  submissions: ['interview_date','interview_time'],
  revenue_hub_entries: ['client_destination_kind','client_draft_prepared_at','feedback_status','feedback_note','feedback_updated_at','feedback_snoozed_until']
};
function columnSql(type) {
  const types={text:'text',varchar:'character varying',bpchar:'character',int2:'smallint',int4:'integer',int8:'bigint',numeric:'numeric',float4:'real',float8:'double precision',bool:'boolean',json:'json',jsonb:'jsonb',date:'date',timestamp:'timestamp without time zone',timestamptz:'timestamp with time zone',uuid:'uuid'};
  if(type.startsWith('_') && types[type.slice(1)])return types[type.slice(1)]+'[]';
  if(!types[type])throw fail('Unsupported new-column type '+type+'. No records were changed.');
  return types[type];
}
function adaptTransferSchema(payload,actual) {
  const receiver={...actual}, additions=[];
  // A nonempty source-only business field is preserved in a new nullable
  // destination column. Only static, allowlisted PostgreSQL types reach DDL.
  for(const [table,source]of Object.entries(payload.schema))if(actual[table] && payload.tables[table]?.length) {
    const columns=actual[table].columns.map(c=>({...c}));
    for(const field of source.columns)if(!columns.some(c=>c.name===field.name)) {
      const type=textTypes.has(field.type)?'text':field.type;columnSql(type);
      columns.push({name:field.name,type,nullable:true,has_default:false,generated:false,identity:false});
      additions.push({table,name:field.name,type});
    }
    receiver[table]={...actual[table],columns};
  }
  const seededSchema={...payload.schema},emptyTables=[];
  for(const [table,spec]of Object.entries(receiver))if(payload.schema[table] && Array.isArray(payload.tables[table]) && !payload.tables[table].length) {
    if(JSON.stringify(payload.schema[table])!==JSON.stringify(spec))emptyTables.push(table);
    seededSchema[table]={columns:spec.columns.map(c=>({...c})),primary_key:[...spec.primary_key]};
  }
  const activity=adaptActivitySchema({...payload,schema:seededSchema},receiver),target=activity.target;
  const schema={...activity.payload.schema},tables={...activity.payload.tables},defaultedColumns={};
  const bridges=[],issues=[];
  for(const [table,spec]of Object.entries(target)) {
    const source=schema[table],input=tables[table];if(!source||!Array.isArray(input))continue;
    const sourceFields=new Map(source.columns.map(c=>[c.name,c])),rows=input.map(row=>({...row})),columns=[];
    const omitted=[];
    for(const col of spec.columns) {
      const src=sourceFields.get(col.name);
      if(!src && input.length && !spec.primary_key.includes(col.name)) {
        if(col.has_default) {omitted.push(col.name);continue;}
        if(col.nullable) {columns.push({...col});for(const row of rows)row[col.name]=null;continue;}
      }
      if(!src) {issues.push(table+'.'+col.name+': required source value is missing');continue;}
      columns.push({...col});
      if(src.type!==col.type)bridges.push({table,column:col.name,from:src.type,to:col.type,records:rows.length});
      for(let i=0;i<rows.length;i++)try {rows[i][col.name]=convert(rows[i][col.name],src.type,col.type,identityColumn(spec,col.name));}
        catch(e){issues.push(table+'.'+col.name+' ('+src.type+' -> '+col.type+'): '+e.message);break;}
    }
    if(omitted.length)defaultedColumns[table]=omitted;
    schema[table]={...source,columns};tables[table]=rows;
  }
  if(issues.length)throw fail('CRM type/schema check: '+issues.slice(0,12).join('; ')+(issues.length>12?'; additional incompatible columns':'')+'. No records were changed.');
  return {...activity,additions:[...additions,...activity.additions],payload:{...activity.payload,schema,tables,defaulted_columns:defaultedColumns},bridges,emptyTables,defaultedColumns};
}
function storedNumber(value) {
  return value && typeof value === 'object' && numberToken in value ? value[numberToken] : String(value);
}
function matchesStored(type,want,got,identity=false,parsed=false) {
  if (want == null || got == null) return want == null && got == null;
  if (type.startsWith('_')) {
    const array = parsed ? got : parseExactJson(got);
    if (!Array.isArray(want) || !Array.isArray(array) || want.length !== array.length) return false;
    return want.every((value,i) => Array.isArray(value) && !jsonTypes.has(type.slice(1))
      ? matchesStored(type,value,array[i],identity,true) : matchesStored(type.slice(1),value,array[i],identity,true));
  }
  if (jsonTypes.has(type)) return jsonSignature(want) === jsonSignature(parsed ? got : parseExactJson(got));
  if (numericTypes.has(type)) return identity ? String(want) === storedNumber(got) : decimal(want) === decimal(storedNumber(got));
  if (type === 'bool') return want === (typeof got === 'boolean' ? got : got === 'true');
  if (temporalTypes.has(type)) return temporal(String(want),type) === temporal(String(got),type);
  return String(want) === String(got);
}
async function preflightTypes(payload,target,schemaBefore,q) {
  const quote = value => '"'+String(value).replace(/"/g,'""')+'"';
  for (const [table,rows] of Object.entries(payload.tables)) {
    if (!rows.length) continue;
    // Full text is unlimited; all native/bounded types are checked using the
    // actual row type so varchar limits, numeric scale and array casts apply.
    const spec=target[table], columns=spec.columns.filter(c => c.type !== 'text' && schemaBefore[table].columns.some(d => d.name === c.name));
    const added=spec.columns.filter(c => !schemaBefore[table].columns.some(d=>d.name===c.name));
    if (!columns.length && !added.length) continue;
    const projection=columns.map(c => (jsonTypes.has(c.type) || c.type.startsWith('_') ? 'to_jsonb(r.'+quote(c.name)+')::text' : 'r.'+quote(c.name)+'::text')+' as '+quote(c.name)).join(',');
    for (let i=0;i<rows.length;i+=100) {
      const batch=rows.slice(i,i+100);let stored;
      try { stored=columns.length?await q('select '+projection+' from jsonb_populate_recordset(null::public.'+quote(table)+',$1::jsonb) r',[JSON.stringify(batch)]):batch.map(()=>({})); }
      catch(e) { throw fail('Cannot store '+table+' using its existing column types ['+columns.map(c=>c.name+':'+c.type).join(', ')+'] ('+(e.code || 'cast check')+'). No records were changed.'); }
      if(!columns.length)stored=batch.map(()=>({}));
      if (stored.length !== batch.length) throw fail('Type verification returned an incomplete '+table+' batch. No records were changed.');
      if(added.length) {
        const projectionAdded=added.map(c=>(jsonTypes.has(c.type)||c.type.startsWith('_')?'to_jsonb(r.'+quote(c.name)+')::text':'r.'+quote(c.name)+'::text')+' as '+quote(c.name)).join(',');
        let typed;try {typed=await q('select '+projectionAdded+' from jsonb_to_recordset($1::jsonb) as r('+added.map(c=>quote(c.name)+' '+columnSql(c.type)).join(',')+')',[JSON.stringify(batch)]);}
        catch(e){throw fail('Cannot preserve new '+table+' columns ('+(e.code||'cast check')+'). No records were changed.');}
        for(let n=0;n<batch.length;n++)for(const c of added)if(!matchesStored(c.type,batch[n][c.name],typed[n][c.name],identityColumn(spec,c.name)))throw fail('New '+table+'.'+c.name+' would change during import. No records were changed.');
      }
      for(let n=0;n<batch.length;n++)for(const c of columns) {
        let equal=false;try { equal=matchesStored(c.type,batch[n][c.name],stored[n][c.name],identityColumn(spec,c.name)); }catch{}
        if(!equal)throw fail('Cannot import '+table+'.'+c.name+' as '+c.type+' without changing/truncating its value. No records were changed.');
      }
    }
  }
}
module.exports = {crm2Columns,columnSql,adaptActivitySchema, adaptTransferSchema, preflightTypes, integerId, sameKey, _test:{decimal,convert,temporal,matchesStored,checkedJson,jsonSignature}};
