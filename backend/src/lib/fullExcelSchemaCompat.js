'use strict';
// CC151: full Excel transfer compatibility and read-only destination preflight.
// Preserve business identities; synthesize only missing auxiliary row IDs.
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

  const knownKey = key => Array.isArray(key) && key.length === 1
    && ['id','activity_id'].includes(key[0]);

  if (!knownKey(source.primary_key) || !knownKey(destination.primary_key)) {
    if (!sameKey(source.primary_key, destination.primary_key)) {
      throw fail('Unsupported activity_log primary key. No records were changed.');
    }
    return {payload, target: actual, additions: []};
  }

  const sourceFields = new Map(source.columns.map(c => [c.name, c]));
  const columns = destination.columns.map(c => ({...c})), additions = [];

  // Legacy activity_id-only databases also need id for the current timeline.
  // Plan this here; execute the ADD COLUMN only inside the confirmed restore.
  if (!columns.some(c => c.name === 'id')) {
    const rawType = sourceFields.get('id')?.type;
    const type = ['int2','int4'].includes(rawType) ? 'text' : rawType || 'text';
    if (!['text','int8'].includes(type)) {
      throw fail('Unsupported activity_log.id type. No records were changed.');
    }
    const column = {name: 'id', type};
    columns.push(column);
    additions.push({table: 'activity_log', ...column});
  }

  const fields = new Map(columns.map(c => [c.name,c]));
  for (const c of source.columns) {
    const target = fields.get(c.name);
    if (!target) {
      throw fail(
        'Destination is missing activity_log.' + c.name + '. Apply the same safe schema.'
      );
    }
  }

  if (fields.get('activity_id')?.type !== 'text'
      || !['text','int8'].includes(fields.get('id').type)) {
    throw fail('Unsupported activity_log identity types. No records were changed.');
  }

  const numeric = fields.get('id').type === 'int8';
  const rows = payload.tables.activity_log.map(r => ({...r}));
  const used = new Set();

  for (const row of rows) if (!blank(row.id)) {
    if ((numeric || sourceFields.get('id')?.type === 'int8') && !integerId(row.id)) {
      throw fail(
        'activity_log.id cannot be stored as bigint without changing an existing ID. No records were changed.'
      );
    }
    used.add(String(row.id));
  }

  for (const row of rows) {
    if (blank(row.activity_id)) {
      row.activity_id = blank(row.id) ? null : String(row.id);
    }
    if (blank(row.id)) {
      if (blank(row.activity_id)) {
        throw fail('An activity has no usable ID. No records were changed.');
      }
      if (!numeric) row.id = String(row.activity_id);
      else if (integerId(row.activity_id) && !used.has(String(row.activity_id))) {
        row.id = String(row.activity_id);
      } else {
        // This source had no id. Keep its activity_id unchanged and create only
        // the destination's internal numeric surrogate, deterministically.
        let salt = 0, candidate;
        do {
          const hash = crypto.createHash('sha256')
            .update('CC879/activity_log/' + String(row.activity_id) + '/' + salt++)
            .digest('hex').slice(0,16);
          candidate = String(BigInt('0x' + hash) % MAX + 1n);
        } while (used.has(candidate));
        row.id = candidate;
      }
      used.add(String(row.id));
    }
  }

  const target = {...actual, activity_log: {...destination, columns}};
  const importedColumns = source.columns.map(c => ({...c}));

  for (const c of columns) {
    if (!sourceFields.has(c.name) && ['id','activity_id'].includes(c.name)) {
      importedColumns.push({...c});
    }
  }

  const adapted = {
    ...payload,
    schema: {
      ...payload.schema,
      activity_log: {
        columns: importedColumns,
        primary_key: [...destination.primary_key]
      }
    },
    tables: {...payload.tables, activity_log: rows}
  };

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
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw Error('not a numeric value');
  }

  const m = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/
    .exec(String(value).trim());

  if (!m || !Number.isFinite(Number(m[5] || 0))
      || Math.abs(Number(m[5] || 0)) > 1000000) {
    throw Error('invalid numeric value');
  }

  const fraction = m[3] ?? m[4] ?? '';
  const raw = (m[2] || '') + fraction;
  let digits = raw.replace(/^0+/,'');
  let exponent = Number(m[5] || 0) - fraction.length;

  if (!digits) return '0';

  const trim = /0+$/.exec(digits)?.[0].length || 0;
  if (trim) {
    digits = digits.slice(0,-trim);
    exponent += trim;
  }

  return (m[1] === '-' ? '-' : '') + digits + 'e' + exponent;
}

function parseExactJson(text) {
  return JSON.parse(text, (_key,value,context) =>
    typeof value === 'number' ? {[numberToken]: context.source} : value
  );
}

function jsonSignature(value) {
  if (value === null) return 'null';
  if (value && typeof value === 'object' && numberToken in value) {
    return 'n:' + decimal(value[numberToken]);
  }
  if (typeof value === 'number') return 'n:' + decimal(value);
  if (typeof value === 'string') return 's:' + JSON.stringify(value);
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return '[' + value.map(jsonSignature).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map(k => JSON.stringify(k) + ':' + jsonSignature(value[k])).join(',') + '}';
  }
  throw Error('unsupported JSON value');
}

function checkedJson(text) {
  const exact = parseExactJson(text), parsed = JSON.parse(text);
  if (jsonSignature(exact) !== jsonSignature(parsed)) {
    throw Error('JSON number would lose precision');
  }
  return parsed;
}

function temporal(value,type) {
  if (typeof value !== 'string') throw Error('date/time must be a string');

  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)?)?$/
    .exec(value.trim());

  if (!m) throw Error('date/time must use an ISO date');

  const date = m[1]+'-'+m[2]+'-'+m[3];
  const calendar = new Date(date+'T00:00:00Z');

  if (!Number.isFinite(calendar.getTime())
      || calendar.toISOString().slice(0,10) !== date || m[1] === '0000') {
    throw Error('invalid calendar date');
  }

  if (type === 'date') {
    if (m[4] && (+m[4] || +m[5] || +m[6] || /[1-9]/.test(m[7] || ''))) {
      throw Error('date column would discard a time');
    }
    if (m[8]
        && !['Z','+00','+0000','+00:00','-00','-0000','-00:00'].includes(m[8])) {
      throw Error('date column would discard a time zone');
    }
    return date;
  }

  if (!m[4]) throw Error('timestamp needs an explicit time');
  if (+m[4] > 23 || +m[5] > 59 || +m[6] > 59) {
    throw Error('invalid clock time');
  }

  const fraction = (m[7] || '').padEnd(6,'0');
  if (/[1-9]/.test(fraction.slice(6))) {
    throw Error('timestamp would lose fractional precision');
  }

  let zone = m[8] || '';
  if (type === 'timestamptz' && !zone) {
    throw Error('timestamp needs an explicit time zone');
  }
  if (/^[+-]\d{2}$/.test(zone)) zone += ':00';
  if (/^[+-]\d{4}$/.test(zone)) zone = zone.slice(0,3)+':'+zone.slice(3);

  const millis = Date.parse(
    date+'T'+m[4]+':'+m[5]+':'+m[6]+'.'+fraction.slice(0,3)+(zone || 'Z')
  );
  if (!Number.isFinite(millis)) throw Error('invalid time zone');

  // Match the app/pg driver Asia/Kolkata timezone for naive timestamps; keep
  // explicit UTC instants for timestamptz. Keep
  // microseconds instead of passing through JavaScript millisecond rounding.
  const localMillis = type === 'timestamp' && zone ? millis + 330*60000 : millis;
  const normalized = new Date(localMillis).toISOString().slice(0,19)
    + '.' + fraction.slice(0,6);

  return normalized + (type === 'timestamptz' ? 'Z' : '');
}

const identityColumn = (spec,name) =>
  spec.primary_key.includes(name)
  || /^(?:id|username|phone|created_by|assigned_to|approved_by|reporting_to)$|_(?:id|code|key)$/
    .test(name);

function convert(value,sourceType,targetType,identity=false) {
  if (value == null) return null;

  if (['int2','int4','int8'].includes(sourceType) && !integerId(value)) {
    throw Error('declared integer value is unsafe or invalid');
  }
  if (identity && typeof value === 'number'
      && Number.isInteger(value) && !Number.isSafeInteger(value)) {
    throw Error('unsafe numeric identity');
  }

  if (textTypes.has(targetType)) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw Error('non-finite number');
      return String(value);
    }
    if (typeof value === 'boolean') return String(value);
    if (jsonTypes.has(sourceType) || sourceType.startsWith('_')) {
      return JSON.stringify(value);
    }
    throw Error('structured value is not a text value');
  }

  if (typeof value === 'string' && value.trim() === '' && !identity
      && textTypes.has(sourceType)
      && (numericTypes.has(targetType) || temporalTypes.has(targetType)
        || targetType === 'bool' || jsonTypes.has(targetType))) {
    return null;
  }

  if (numericTypes.has(targetType)) {
    const literal = String(value).trim();
    decimal(value);
    if (identity && String(value) !== literal) {
      throw Error('numeric identity would change');
    }
    if (identity && typeof value === 'number' && !Number.isSafeInteger(value)) {
      throw Error('unsafe numeric identity');
    }
    return literal;
  }

  if (targetType === 'bool') {
    if (typeof value === 'boolean') return value;
    const literal = String(value).trim().toLowerCase();
    if (['true','t','1','yes','on'].includes(literal)) return true;
    if (['false','f','0','no','off'].includes(literal)) return false;
    throw Error('not a boolean value');
  }

  if (jsonTypes.has(targetType)) {
    return textTypes.has(sourceType) ? checkedJson(String(value)) : value;
  }

  if (temporalTypes.has(targetType)) return temporal(String(value),targetType);

  if (targetType.startsWith('_')) {
    const input = typeof value === 'string' && textTypes.has(sourceType)
      ? checkedJson(value) : value;

    if (!Array.isArray(input)) throw Error('not an array');

    const sourceBase = sourceType.startsWith('_') ? sourceType.slice(1) : 'text';
    const walk = array => array.map(v =>
      Array.isArray(v) && !jsonTypes.has(targetType.slice(1))
        ? walk(v) : convert(v,sourceBase,targetType.slice(1),identity)
    );
    return walk(input);
  }

  if (typeof value === 'string' || typeof value === 'number'
      || typeof value === 'boolean') {
    return String(value);
  }

  throw Error('unsupported structured column type');
}

const crm2Columns = {
  call_logs: ['crm_row_id','app_event_id','report_note'],
  candidates: ['interview_time'],
  chat_groups: ['theme','name'],
  employee_daily_stats: ['crm_row_id','created_at'],
  manual_dialer_calls: ['crm_row_id'],
  messages: ['receiver_username','receiver_name','room_key','channel_key'],
  submissions: ['interview_date','interview_time'],
  revenue_hub_entries: [
    'client_destination_kind',
    'client_draft_prepared_at',
    'feedback_status',
    'feedback_note',
    'feedback_updated_at',
    'feedback_snoozed_until'
  ]
};

function columnSql(type) {
  const types = {
    text:'text',
    varchar:'character varying',
    bpchar:'character',
    int2:'smallint',
    int4:'integer',
    int8:'bigint',
    numeric:'numeric',
    float4:'real',
    float8:'double precision',
    bool:'boolean',
    json:'json',
    jsonb:'jsonb',
    date:'date',
    timestamp:'timestamp without time zone',
    timestamptz:'timestamp with time zone',
    uuid:'uuid'
  };

  if (type.startsWith('_') && types[type.slice(1)]) {
    return types[type.slice(1)]+'[]';
  }
  if (!types[type]) {
    throw fail('Unsupported new-column type '+type+'. No records were changed.');
  }
  return types[type];
}

// CC151: CRM branches can keep the same auxiliary ID under different
// PostgreSQL storage types. Never weaken NOT NULL or rewrite an existing ID.
// The generated ID is deterministic for a source primary key and table.
function auxiliaryRowIdentity(table,key,type,salt=0) {
  const h = crypto.createHash('sha256')
    .update('CC151/aux-row/v1\x00'+table+'\x00'+key+'\x00'+salt)
    .digest('hex');

  if (textTypes.has(type)) return h.slice(0,32);

  if (type === 'uuid') {
    return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)
      +'-a'+h.slice(17,20)+'-'+h.slice(20,32);
  }

  const max = {int2:32767n,int4:2147483647n,int8:MAX,numeric:MAX}[type];
  if (max) return String(BigInt('0x'+h.slice(0,16))%max+1n);

  throw fail(
    table+': unsupported auxiliary ID type '+type
    +'. Verify stopped; no records changed.'
  );
}

function fillRequiredAuxiliaryRowIds(table,rows,spec,sourceFields) {
  const generated = new Map();

  for (const name of ['crm_row_id','_crm_row_id']) {
    const col = spec.columns.find(c => c.name === name);
    if (!col || col.nullable !== false || !rows.length) continue;

    const blankRows = rows.map((r,i) => blank(r[name]) ? i : -1)
      .filter(i => i >= 0);

    if (!blankRows.length) continue;

    if (col.generated || spec.primary_key.includes(name)) {
      throw fail(
        table+'.'+name
        +': a required primary/generated identity is missing. No existing ID was rewritten.'
      );
    }

    const used = new Set(
      rows.filter(r => !blank(r[name])).map(r => String(r[name]))
    );
    const made = new Set();

    if (col.type === 'int2' && used.size + blankRows.length > 32767) {
      throw fail(table+'.'+name+': not enough smallint ID space.');
    }

    for (const i of blankRows) {
      if (spec.primary_key.some(k => blank(rows[i][k]))) {
        throw fail(table+': source primary key missing at row '+(i+1));
      }

      const key = JSON.stringify(
        spec.primary_key.map(k => [k,String(rows[i][k])])
      );
      let value;

      for (let salt = 0; salt < 100000; salt++) {
        const next = auxiliaryRowIdentity(table,key,col.type,salt);
        if (!used.has(next)) {
          value = next;
          break;
        }
      }

      if (value === undefined) {
        throw fail(table+'.'+name+': no unique auxiliary ID could be allocated.');
      }

      rows[i][name] = value;
      used.add(value);
      made.add(i);
    }

    if (!sourceFields.has(name)) sourceFields.set(name,{...col});
    generated.set(name,made);
  }

  return generated;
}

function requiredValues(table,rows,spec,columns) {
  const included = new Set(columns.map(c => c.name));

  for (const col of spec.columns) {
    if (col.nullable === false && !col.generated && included.has(col.name)) {
      const missing = rows.reduce(
        (n,row) => n + (row[col.name] == null ? 1 : 0), 0
      );

      if (missing) {
        throw fail(
          table+'.'+col.name+': '+missing
          +' NULL value(s) violate NOT NULL. Verify stopped before import.'
        );
      }
    }
  }
}

function adaptTransferSchema(payload,actual) {
  const receiver = {...actual}, additions = [];

  // A nonempty source-only business field is preserved in a new nullable
  // destination column. Only static, allowlisted PostgreSQL types reach DDL.
  for (const [table,source] of Object.entries(payload.schema)) {
    if (actual[table] && payload.tables[table]?.length) {
      const columns = actual[table].columns.map(c => ({...c}));

      for (const field of source.columns) {
        if (!columns.some(c => c.name === field.name)) {
          const type = textTypes.has(field.type) ? 'text' : field.type;
          columnSql(type);
          columns.push({
            name:field.name,
            type,
            nullable:true,
            has_default:false,
            generated:false,
            identity:false
          });
          additions.push({table,name:field.name,type});
        }
      }

      receiver[table] = {...actual[table],columns};
    }
  }

  const seededSchema = {...payload.schema}, emptyTables = [];

  for (const [table,spec] of Object.entries(receiver)) {
    if (payload.schema[table] && Array.isArray(payload.tables[table])
        && !payload.tables[table].length) {
      if (JSON.stringify(payload.schema[table]) !== JSON.stringify(spec)) {
        emptyTables.push(table);
      }
      seededSchema[table] = {
        columns:spec.columns.map(c => ({...c})),
        primary_key:[...spec.primary_key]
      };
    }
  }

  const activity = adaptActivitySchema({...payload,schema:seededSchema},receiver);
  const target = activity.target;
  const schema = {...activity.payload.schema};
  const tables = {...activity.payload.tables};
  const defaultedColumns = {};
  const bridges = [], issues = [];
  const legacyRowIds = {
    call_logs:0,
    employee_daily_stats:0,
    manual_dialer_calls:0
  };

  for (const [table,spec] of Object.entries(target)) {
    const source = schema[table], input = tables[table];
    if (!source || !Array.isArray(input)) continue;

    const sourceFields = new Map(source.columns.map(c => [c.name,c]));
    const rows = input.map(row => ({...row})), columns = [];
    const omitted = [];

    // CC151: source and destination may differ in auxiliary ID type. Prepare
    // required auxiliary IDs in the import snapshot, never in CRM1's data.
    // Preserve every nonempty existing value and the true primary keys.
    const generatedIds = fillRequiredAuxiliaryRowIds(
      table,rows,spec,sourceFields
    );

    if (Object.hasOwn(legacyRowIds,table)) {
      legacyRowIds[table] += [...generatedIds.values()]
        .reduce((n,ids) => n + ids.size, 0);
    }

    for (const col of spec.columns) {
      const src = sourceFields.get(col.name);

      if (!src && input.length && !spec.primary_key.includes(col.name)) {
        if (col.has_default) {
          omitted.push(col.name);
          continue;
        }
        if (col.nullable) {
          columns.push({...col});
          for (const row of rows) row[col.name] = null;
          continue;
        }
      }

      if (!src) {
        issues.push(table+'.'+col.name+': required source value is missing');
        continue;
      }

      columns.push({...col});

      if (src.type !== col.type) {
        bridges.push({
          table,
          column:col.name,
          from:src.type,
          to:col.type,
          records:rows.length
        });
      }

      for (let i = 0; i < rows.length; i++) try {
        // A newly synthesized value was created for the destination type;
        // the older workbook's source type does not describe that value.
        const fromType = generatedIds.get(col.name)?.has(i)
          ? col.type : src.type;

        rows[i][col.name] = convert(
          rows[i][col.name],fromType,col.type,identityColumn(spec,col.name)
        );
      } catch (e) {
        issues.push(
          table+'.'+col.name+' ('+src.type+' -> '+col.type+'): '+e.message
        );
        break;
      }
    }

    requiredValues(table,rows,spec,columns);
    if (omitted.length) defaultedColumns[table] = omitted;

    schema[table] = {...source,columns};
    tables[table] = rows;
  }

  if (issues.length) {
    throw fail(
      'CRM type/schema check: '+issues.slice(0,12).join('; ')
      +(issues.length > 12 ? '; additional incompatible columns' : '')
      +'. No records were changed.'
    );
  }

  return {
    ...activity,
    additions:[...additions,...activity.additions],
    payload:{
      ...activity.payload,
      schema,
      tables,
      defaulted_columns:defaultedColumns
    },
    bridges,
    emptyTables,
    defaultedColumns,
    legacyRowIds
  };
}

function storedNumber(value) {
  return value && typeof value === 'object' && numberToken in value
    ? value[numberToken] : String(value);
}

function matchesStored(type,want,got,identity=false,parsed=false) {
  if (want == null || got == null) return want == null && got == null;

  if (type.startsWith('_')) {
    const array = parsed ? got : parseExactJson(got);
    if (!Array.isArray(want) || !Array.isArray(array)
        || want.length !== array.length) {
      return false;
    }

    return want.every((value,i) =>
      Array.isArray(value) && !jsonTypes.has(type.slice(1))
        ? matchesStored(type,value,array[i],identity,true)
        : matchesStored(type.slice(1),value,array[i],identity,true)
    );
  }

  if (jsonTypes.has(type)) {
    return jsonSignature(want)
      === jsonSignature(parsed ? got : parseExactJson(got));
  }

  if (numericTypes.has(type)) {
    return identity
      ? String(want) === storedNumber(got)
      : decimal(want) === decimal(storedNumber(got));
  }

  if (type === 'bool') {
    return want === (typeof got === 'boolean' ? got : got === 'true');
  }

  if (temporalTypes.has(type)) {
    return temporal(String(want),type) === temporal(String(got),type);
  }

  return String(want) === String(got);
}

async function preflightTypes(payload,target,schemaBefore,q) {
  for (const [table,rows] of Object.entries(payload.tables)) {
    requiredValues(table,rows,target[table],payload.schema[table].columns);
  }

  const quote = value => '"'+String(value).replace(/"/g,'""')+'"';

  for (const [table,rows] of Object.entries(payload.tables)) {
    if (!rows.length) continue;

    // Full text is unlimited; all native/bounded types are checked using the
    // actual row type so varchar limits, numeric scale and array casts apply.
    const spec = target[table];
    const columns = spec.columns.filter(c =>
      c.type !== 'text'
      && schemaBefore[table].columns.some(d => d.name === c.name)
    );
    const added = spec.columns.filter(c =>
      !schemaBefore[table].columns.some(d => d.name === c.name)
    );

    if (!columns.length && !added.length) continue;

    const projection = columns.map(c =>
      (jsonTypes.has(c.type) || c.type.startsWith('_')
        ? 'to_jsonb(r.'+quote(c.name)+')::text'
        : 'r.'+quote(c.name)+'::text')+' as '+quote(c.name)
    ).join(',');

    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i,i+100);
      let stored;

      try {
        stored = columns.length
          ? await q(
            'select '+projection
            +' from jsonb_populate_recordset(null::public.'+quote(table)
            +',$1::jsonb) r',
            [JSON.stringify(batch)]
          )
          : batch.map(() => ({}));
      } catch (e) {
        throw fail(
          'Cannot store '+table+' using its existing column types ['
          +columns.map(c => c.name+':'+c.type).join(', ')
          +'] ('+(e.code || 'cast check')+'). No records were changed.'
        );
      }

      if (!columns.length) stored = batch.map(() => ({}));

      if (stored.length !== batch.length) {
        throw fail(
          'Type verification returned an incomplete '+table
          +' batch. No records were changed.'
        );
      }

      if (added.length) {
        const projectionAdded = added.map(c =>
          (jsonTypes.has(c.type) || c.type.startsWith('_')
            ? 'to_jsonb(r.'+quote(c.name)+')::text'
            : 'r.'+quote(c.name)+'::text')+' as '+quote(c.name)
        ).join(',');

        let typed;

        try {
          typed = await q(
            'select '+projectionAdded
            +' from jsonb_to_recordset($1::jsonb) as r('
            +added.map(c => quote(c.name)+' '+columnSql(c.type)).join(',')
            +')',
            [JSON.stringify(batch)]
          );
        } catch (e) {
          throw fail(
            'Cannot preserve new '+table+' columns ('
            +(e.code || 'cast check')+'). No records were changed.'
          );
        }

        for (let n = 0; n < batch.length; n++) {
          for (const c of added) {
            if (!matchesStored(
              c.type,batch[n][c.name],typed[n][c.name],
              identityColumn(spec,c.name)
            )) {
              throw fail(
                'New '+table+'.'+c.name
                +' would change during import. No records were changed.'
              );
            }
          }
        }
      }

      for (let n = 0; n < batch.length; n++) {
        for (const c of columns) {
          let equal = false;
          try {
            equal = matchesStored(
              c.type,batch[n][c.name],stored[n][c.name],
              identityColumn(spec,c.name)
            );
          } catch {}

          if (!equal) {
            throw fail(
              'Cannot import '+table+'.'+c.name+' as '+c.type
              +' without changing/truncating its value. No records were changed.'
            );
          }
        }
      }
    }
  }

  await preflightConstraints(payload,target,schemaBefore,q);
}

// Read-only checks against the receiver's real constraints; never trial DELETE,
// INSERT, nextval(), trigger execution, or weakening a production constraint.
async function preflightConstraints(payload,target,schemaBefore,q) {
  const quote = s => '"'+String(s).replace(/"/g,'""')+'"';
  const literal = s => "'"+String(s).replace(/'/g,"''")+"'";
  const names = Object.keys(payload.tables);
  const active = names.filter(t => payload.tables[t].length);
  const merge = new Set(['settings','app_settings','crm_candidate_id_registry']);

  const tables = await q(`
    select c.relname as name,c.oid::text as oid,
      (r.rolsuper or pg_has_role(c.relowner,'USAGE')) as owns,
      has_table_privilege(c.oid,'SELECT')
      and has_table_privilege(c.oid,'INSERT')
      and has_table_privilege(c.oid,'UPDATE')
      and has_table_privilege(c.oid,'DELETE') as writable,
      row_security_active(c.oid) as filtered,c.relkind
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    cross join pg_roles r
    where n.nspname='public'
      and c.relname=any($1::text[])
      and r.rolname=current_user
  `,[names]);

  if (tables.length !== names.length) {
    throw fail('Receiver tables changed or are missing. Run Verify again.');
  }

  for (const t of tables) {
    if (!t.owns || !t.writable || t.filtered || t.relkind !== 'r') {
      throw fail(
        'Receiver '+t.name
        +': the database role cannot safely perform the complete restore '
        +'(owner/permissions/RLS/table layout). No records changed.'
      );
    }
  }

  const columns = await q(`
    select c.relname as table_name,a.attname as name,
      pg_get_expr(d.adbin,d.adrelid) as expression,
      d.oid::text as default_oid,
      a.attgenerated<>'' as generated,
      a.attidentity<>'' as identity,
      pg_get_serial_sequence(
        format('%I.%I',n.nspname,c.relname),a.attname
      ) as sequence
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a
      on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    left join pg_attrdef d
      on d.adrelid=c.oid and d.adnum=a.attnum
    where n.nspname='public' and c.relname=any($1::text[])
  `,[names]);

  const constraints = await q(`
    select x.oid::text as oid,x.conname as name,x.contype as kind,
      c.relname as child,p.relname as parent,pn.nspname as parent_schema,
      pg_get_expr(x.conbin,x.conrelid) as expression,
      x.confmatchtype as match,
      x.condeferrable as deferrable,x.condeferred as deferred,
      array(
        select a.attname::text
        from unnest(x.conkey) with ordinality k(v,o)
        join pg_attribute a
          on a.attrelid=x.conrelid and a.attnum=k.v
        order by k.o
      ) as child_columns,
      array(
        select a.attname::text
        from unnest(x.confkey) with ordinality k(v,o)
        join pg_attribute a
          on a.attrelid=x.confrelid and a.attnum=k.v
        order by k.o
      ) as parent_columns
    from pg_constraint x
    join pg_class c on c.oid=x.conrelid
    join pg_namespace n on n.oid=c.relnamespace
    left join pg_class p on p.oid=x.confrelid
    left join pg_namespace pn on pn.oid=p.relnamespace
    where n.nspname='public'
      and (
        c.relname=any($1::text[])
        or (pn.nspname='public' and p.relname=any($1::text[]))
      )
  `,[names]);

  const indexes = await q(`
    select i.indexrelid::text as oid,c.relname as table_name,
      z.relname as name,
      i.indisprimary as primary,i.indisvalid as valid,
      i.indisexclusion as exclusion,
      coalesce(
        (to_jsonb(i)->>'indnullsnotdistinct')::boolean,false
      ) as nulls_equal,
      pg_get_expr(i.indpred,i.indrelid) as predicate,
      array(
        select pg_get_indexdef(i.indexrelid,g,true)
        from generate_series(1,i.indnkeyatts) g
      ) as expressions,
      not exists(
        select 1
        from unnest(i.indclass) with ordinality a(v,o)
        join pg_opclass op on op.oid=a.v
        where a.o<=i.indnkeyatts and not op.opcdefault
      ) as standard
    from pg_index i
    join pg_class c on c.oid=i.indrelid
    join pg_namespace n on n.oid=c.relnamespace
    join pg_class z on z.oid=i.indexrelid
    where n.nspname='public'
      and c.relname=any($1::text[])
      and (i.indisunique or i.indisexclusion)
      and i.indisready and i.indislive
  `,[names]);

  // Reject custom/volatile SQL rather than execute unknown side effects
  // during Verify.
  const objects = [
    ...columns.filter(c => active.includes(c.table_name) && c.default_oid)
      .map(c => ['pg_attrdef',c.default_oid]),
    ...constraints.filter(c => active.includes(c.child))
      .map(c => ['pg_constraint',c.oid]),
    ...indexes.filter(i => active.includes(i.table_name))
      .map(i => ['pg_class',i.oid])
  ];

  if (objects.length) {
    const deps = await q(`
      select d.classid::regclass::text as class,d.objid::text as oid,
        n.nspname as namespace,p.proname as name,
        p.provolatile as volatility
      from pg_depend d
      join pg_proc p
        on d.refclassid='pg_proc'::regclass and p.oid=d.refobjid
      join pg_namespace n on n.oid=p.pronamespace
      where exists(
        select 1
        from jsonb_to_recordset($1::jsonb) x(class text,id oid)
        where d.classid=x.class::regclass and d.objid=x.id
      )
    `,[
      JSON.stringify(
        objects.map(([kind,id]) => ({class:kind,id}))
      )
    ]);

    for (const fn of deps) {
      const safeDefault = fn.class === 'pg_attrdef'
        && ['nextval','gen_random_uuid','uuid_generate_v4'].includes(fn.name)
        && ['pg_catalog','public','extensions'].includes(fn.namespace);

      if (!safeDefault
          && (fn.namespace !== 'pg_catalog' || fn.volatility === 'v')) {
        throw fail(
          'Custom/volatile '+fn.namespace+'.'+fn.name
          +' cannot be safely preverified. '
          +'A schema-specific review is required before import.'
        );
      }
    }
  }

  const defaults = new Map();

  for (const c of columns) {
    if (c.sequence) {
      const allowed = await q(
        "select has_sequence_privilege($1,'SELECT') "
        +"and has_sequence_privilege($1,'UPDATE') as ok",
        [c.sequence]
      );

      if (!allowed[0]?.ok) {
        throw fail(
          c.table_name+'.'+c.name
          +': receiver sequence permissions are incomplete.'
        );
      }
    }
  }

  for (const t of names) {
    const omitted = new Set(payload.defaulted_columns?.[t] || []);
    const parts = [];

    for (const c of columns.filter(x =>
      x.table_name === t && omitted.has(x.name)
    )) {
      let expression = c.expression;

      if (c.identity || /\bnextval\s*\(/i.test(expression || '')) {
        if (!c.sequence
            || expression && !/^nextval\('[^']+'::regclass\)$/.test(expression)) {
          throw fail(t+'.'+c.name+': unsupported sequence default; Verify stopped.');
        }

        const sequence = c.sequence.split('.').map(quote).join('.');
        const state = (await q(
          'select last_value::text as value,is_called from '+sequence
        ))[0];

        const spec = (await q(
          'select seqincrement::text as step,seqmin::text as min,'
          +'seqmax::text as max,seqcycle as cycle '
          +'from pg_sequence where seqrelid=$1::regclass',
          [c.sequence]
        ))[0];

        const step = BigInt(spec.step);
        const start = BigInt(state.value) + (state.is_called ? step : 0n);
        const end = start + step * BigInt(
          Math.max(0,payload.tables[t].length-1)
        );

        if (spec.cycle || start < BigInt(spec.min) || start > BigInt(spec.max)
            || end < BigInt(spec.min) || end > BigInt(spec.max)) {
          throw fail(
            t+'.'+c.name+': sequence cannot safely supply this import.'
          );
        }

        expression = '('+start+'::numeric+(j.pos-1)*('+step+'::numeric))';
      }

      if (!expression) {
        throw fail(t+'.'+c.name+': declared default is missing.');
      }

      parts.push(literal(c.name),expression);
    }

    defaults.set(
      t,
      parts.length ? 'j.doc||jsonb_build_object('+parts.join(',')+')' : 'j.doc'
    );
  }

  const input = (t,n) =>
    'select r.* from jsonb_array_elements($'+n+'::jsonb) '
    +'with ordinality j(doc,pos) '
    +'cross join lateral jsonb_populate_record(null::public.'
    +quote(t)+','+defaults.get(t)+') r';

  const view = (t,n,keep=true) => {
    const sql = input(t,n);
    if (!keep || !merge.has(t)) return sql;

    const equality = target[t].primary_key.map(k =>
      'i.'+quote(k)+' is not distinct from d.'+quote(k)
    ).join(' and ');

    return 'with incoming as ('+sql+') select * from incoming '
      +'union all select d.* from public.'+quote(t)+' d '
      +'where not exists(select 1 from incoming i where '+equality+')';
  };

  const bytes = t => JSON.stringify(payload.tables[t]);

  const exists = async (sql,args,label) => {
    try {
      return (await q(sql,args)).length > 0;
    } catch (e) {
      throw fail(
        'Verify '+label+' failed ('+(e.code || 'database check')
        +'). No CRM records changed.'
      );
    }
  };

  for (const t of active) {
    const data = view(t,1), args = [bytes(t)], spec = schemaBefore[t];

    const required = spec.columns.filter(c =>
      c.nullable === false && !c.generated
    ).map(c => quote(c.name)+' is null');

    if (required.length && await exists(
      'select 1 from ('+data+') d where '+required.join(' or ')+' limit 1',
      args,t+' required fields'
    )) {
      throw fail(t+': required/defaulted column would be NULL. Verify stopped.');
    }

    for (const c of columns.filter(c =>
      c.table_name === t && c.generated
    )) {
      if (!c.expression || await exists(
        'select 1 from ('+data+') d where '+quote(c.name)
        +' is distinct from ('+c.expression+') limit 1',
        args,t+'.'+c.name
      )) {
        throw fail(t+'.'+c.name+': generated value differs from the source.');
      }
    }

    for (const c of constraints.filter(c =>
      c.child === t && c.kind === 'c'
    )) {
      if (await exists(
        'select 1 from ('+data+') '+quote(t)
        +' where ('+c.expression+') is false limit 1',
        args,t+'.'+c.name
      )) {
        throw fail(t+': CHECK constraint '+c.name+' would fail.');
      }
    }

    for (const ix of indexes.filter(i => i.table_name === t)) {
      if (!ix.valid || ix.exclusion || !ix.standard) {
        throw fail(
          t+': index '+ix.name+' needs a schema-specific restore review.'
        );
      }

      const keys = ix.expressions.map((expr,i) =>
        expr+' as '+quote('k'+i)
      ).join(',');

      const aliases = ix.expressions.map((_,i) => quote('k'+i));
      const where = ix.nulls_equal
        ? 'true' : aliases.map(k => k+' is not null').join(' and ');
      const predicate = ix.predicate || 'true';

      if (await exists(
        'select 1 from (select '+keys+' from ('+data+') '+quote(t)
        +' where ('+predicate+') is true) k where '+where
        +' group by '+aliases.join(',')+' having count(*)>1 limit 1',
        args,t+'.'+ix.name
      )) {
        throw fail(t+': duplicate values violate '+ix.name+'.');
      }

      if (merge.has(t) && !ix.primary) {
        const pk = target[t].primary_key.map((k,i) =>
          quote(k)+' as '+quote('p'+i)
        ).join(',');

        const same = target[t].primary_key.map((_,i) =>
          'a.'+quote('p'+i)+' is not distinct from b.'+quote('p'+i)
        ).join(' and ');

        const join = aliases.map(k =>
          'a.'+k+' is not distinct from b.'+k
        ).join(' and ');

        if (await exists(
          'with a as(select '+keys+','+pk+' from ('
          +view(t,1,false)+') '+quote(t)
          +' where ('+predicate+') is true),'
          +'b as(select '+keys+','+pk+' from public.'+quote(t)
          +' where ('+predicate+') is true) '
          +'select 1 from a join b on '+join+' where not ('+same+')'
          +(ix.nulls_equal ? '' : ' and '+aliases.map(k =>
            'a.'+k+' is not null'
          ).join(' and '))
          +' limit 1',
          args,t+' retained unique values'
        )) {
          throw fail(
            t+': existing retained rows conflict with '+ix.name+'.'
          );
        }
      }
    }
  }

  const edges = constraints.filter(c =>
    c.kind === 'f'
    && names.includes(c.child)
    && c.parent_schema === 'public'
    && names.includes(c.parent)
    && c.parent !== c.child
  );

  const visited = new Set(), stack = new Set();

  function visit(t) {
    if (stack.has(t)) {
      throw fail(
        'Circular table foreign keys require a compatible restore migration. '
        +'Verify stopped.'
      );
    }
    if (visited.has(t)) return;

    stack.add(t);
    for (const e of edges.filter(e => e.child === t)) visit(e.parent);
    stack.delete(t);
    visited.add(t);
  }

  names.forEach(visit);

  for (const fk of constraints.filter(c => c.kind === 'f')) {
    if (!names.includes(fk.child)) {
      if (fk.parent_schema === 'public'
          && names.includes(fk.parent)
          && !merge.has(fk.parent)) {
        const any = fk.child_columns.map(k =>
          quote(k)+' is not null'
        ).join(' and ');

        if (await exists(
          'select 1 from public.'+quote(fk.child)
          +' where '+any+' limit 1',
          [],fk.child+' retained references'
        )) {
          throw fail(
            'Retained '+fk.child+' references '+fk.parent
            +'. Verify stopped to protect excluded/session/media records; '
            +'a schema-specific migration is required.'
          );
        }
      }
      continue;
    }

    if (!payload.tables[fk.child].length) continue;

    const args = [bytes(fk.child)];
    const child = view(fk.child,1);
    const all = fk.child_columns.map(k =>
      'c.'+quote(k)+' is not null'
    ).join(' and ');
    const any = fk.child_columns.map(k =>
      'c.'+quote(k)+' is not null'
    ).join(' or ');

    if (fk.match === 'f' && await exists(
      'select 1 from ('+child+') c where ('+any+') and not ('
      +all+') limit 1',
      args,fk.name+' MATCH FULL'
    )) {
      throw fail(
        fk.child+': partially NULL key violates '+fk.name+'.'
      );
    }

    let parent;
    if (fk.parent_schema === 'public' && names.includes(fk.parent)) {
      args.push(bytes(fk.parent));
      parent = '('+view(fk.parent,2)+')';
    } else {
      parent = quote(fk.parent_schema)+'.'+quote(fk.parent);
    }

    const join = fk.child_columns.map((k,i) =>
      'c.'+quote(k)+'=p.'+quote(fk.parent_columns[i])
    ).join(' and ');

    if (await exists(
      'select 1 from ('+child+') c where '+all
      +' and not exists(select 1 from '+parent+' p where '+join+') limit 1',
      args,fk.name+' foreign key'
    )) {
      throw fail(
        fk.child+': missing parent record for '+fk.name+'.'
      );
    }
  }

  // Parent-first ordering for self-references prevents failures
  // at the 100-row boundary.
  for (const t of active) {
    const fks = constraints.filter(c =>
      c.kind === 'f'
      && c.child === t
      && c.parent === t
      && c.parent_schema === 'public'
      && !(c.deferrable && c.deferred)
    );

    if (!fks.length) continue;

    const rows = payload.tables[t];
    const links = rows.map(() => new Set());
    const next = rows.map(() => []);

    for (const fk of fks) {
      const key = (r,cols) => JSON.stringify(
        cols.map(k => r[k] == null ? null : String(r[k]))
      );

      const parents = new Map(
        rows.map((r,i) => [key(r,fk.parent_columns),i])
      );

      rows.forEach((r,i) => {
        if (fk.child_columns.some(k => r[k] == null)) return;

        const parent = parents.get(key(r,fk.child_columns));
        if (parent !== undefined && parent !== i) links[i].add(parent);
      });
    }

    links.forEach((parents,i) =>
      parents.forEach(parent => next[parent].push(i))
    );

    const degrees = links.map(x => x.size);
    const ready = degrees.map((n,i) => n === 0 ? i : -1)
      .filter(i => i >= 0);
    const ordered = [];

    for (let at = 0; at < ready.length; at++) {
      const i = ready[at];
      ordered.push(i);
      for (const child of next[i]) {
        if (--degrees[child] === 0) ready.push(child);
      }
    }

    if (ordered.length !== rows.length) {
      if (links.some((parents,i) =>
        [...parents].some(j => Math.floor(j/100) > Math.floor(i/100))
      )) {
        throw fail(
          t+': cyclic self-reference crosses an import batch. Verify stopped.'
        );
      }
    } else {
      payload.tables[t] = ordered.map(i => rows[i]);
    }
  }
}

module.exports = {
  crm2Columns,
  columnSql,
  adaptActivitySchema,
  adaptTransferSchema,
  preflightTypes,
  integerId,
  sameKey,
  _test:{
    decimal,
    convert,
    temporal,
    matchesStored,
    checkedJson,
    jsonSignature,
    auxiliaryRowIdentity
  }
};
