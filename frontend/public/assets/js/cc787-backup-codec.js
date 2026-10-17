(function (root) {
  'use strict';
  const MAX = 256 * 1024 * 1024;
  const bytes64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const hex = buffer => Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2,'0')).join('');
  async function decode(envelope,passphrase){
    if(envelope?.password_mode==='manager_login_v1'&&!String(passphrase||'').startsWith('CC828_MANAGER_BACKUP:'))passphrase='CC828_MANAGER_BACKUP:'+String(passphrase||'');
    if (!root.crypto?.subtle || !root.DecompressionStream) throw new Error('Open this file in a current Chrome or Edge browser.');
    if (envelope?.format!=='career-crox-backup' || envelope.version!==1 || envelope.cipher!=='AES-256-GCM' || envelope.kdf!=='PBKDF2-SHA256' || envelope.iterations!==210000 || String(envelope.ciphertext||'').length>90*1024*1024) throw new Error('Unsupported or oversized backup.');
    const cipher=bytes64(envelope.ciphertext), salt=bytes64(envelope.salt), iv=bytes64(envelope.iv);
    if (salt.length!==16 || iv.length!==12 || hex(await crypto.subtle.digest('SHA-256',cipher))!==envelope.sha256) throw new Error('Backup is damaged.');
    try {
      const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(passphrase),'PBKDF2',false,['deriveKey']);
      const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:210000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['decrypt']);
      const packed=await crypto.subtle.decrypt({name:'AES-GCM',iv},key,cipher);
      const reader=new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(), chunks=[]; let total=0;
      while(true){const part=await reader.read();if(part.done)break;total+=part.value.length;if(total>MAX){await reader.cancel();throw new Error('Uncompressed backup is too large.');}chunks.push(part.value);}
      const payload=JSON.parse(await new Blob(chunks).text());
      if(payload?.format!=='career-crox-data' || payload.version!==1 || !payload.schema || !payload.tables)throw new Error('Unsupported backup data.');
      return payload;
    } catch { throw new Error('Wrong backup password or damaged file.'); }
  }
  function save(blob, name) { const url=URL.createObjectURL(blob), link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1500); }
  const id = value => { if(!/^[a-z][a-z0-9_]*$/i.test(value))throw new Error('Invalid schema identifier.');return '"'+value+'"'; };
  const literal = value => "'"+JSON.stringify(value).replace(/'/g,"''")+"'::jsonb";
  const allowed = new Set('crm_command_receipts,chat_thread_read_state,chat_notification_jobs,generated_downloads,candidate_reset_archive,users,candidates,tasks,notifications,jd_master,jd_documents,notes,messages,interviews,submissions,active_sessions,presence,unlock_requests,activity_log,scheduled_reports,break_sessions,report_summaries,aaria_queue,client_pipeline,client_requirements,revenue_entries,chat_groups,chat_group_members,chat_user_state,settings,learning_progress,suggested_videos,interview_remove_requests,candidate_jd_feedback,revenue_hub_entries,mail_templates,mail_drafts,mail_logs,candidate_files,yt_hub_playlists,yt_hub_videos,important_resources,user_onboarding_requests,user_onboarding_documents,password_reset_requests,hot_leads,bda_leads,bda_activities,hr_employees,hr_attendance_logs,hr_worklogs,hr_leave_logs,hr_stage_events,hr_document_templates,hr_document_runs,goal_post_targets,employee_daily_stats,bulk_upload_history,mobile_devices,dialer_sessions,dialer_queue_items,manual_dialer_calls,call_logs,call_quality_events,recording_files,live_call_state,team_chat_messages,team_chat_threads,egress_budget_daily,employee_locations,candidate_file_contents,mobile_app_releases,crm_feature_flags,app_feature_flags,app_settings'.split(','));
  const runtime = new Set(['active_sessions','mobile_devices','live_call_state','generated_downloads','chat_notification_jobs']);
  function recoverySQL(payload) {
    if(payload?.format!=='career-crox-data'||payload.version!==1||!payload.schema||!payload.tables||!Array.isArray(payload.tables.users)||!Array.isArray(payload.tables.candidates))throw new Error('Choose a complete Career Crox backup.');
    let total=0;
    for(const [table,rows] of Object.entries(payload.tables)){
      if(!Array.isArray(rows)||!payload.schema[table])throw new Error('Missing table schema.');
      if(!allowed.has(table)){if(rows.length)throw new Error('This backup contains an unsupported table: '+table);continue;}
      const spec=payload.schema[table];
      if(!Array.isArray(spec.columns)||!spec.primary_key?.length)throw new Error('Missing table identity.');
      id(table);spec.columns.forEach(c=>id(c.name));spec.primary_key.forEach(id);
      if(runtime.has(table)&&rows.length)throw new Error('Active sessions and device pairing cannot be restored.');
      if(rows.length>100000||(total+=rows.length)>1000000)throw new Error('Backup row limit exceeded.');
      const keys=new Set(),columns=new Set(spec.columns.map(c=>c.name));
      for(const row of rows){
        if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!columns.has(k)))throw new Error('Invalid backup row.');
        const pk=spec.primary_key.map(k=>row[k]);if(pk.some(v=>v==null||String(v)===''))throw new Error('Missing backup identity.');
        const key=JSON.stringify(pk);if(keys.has(key))throw new Error('Duplicate backup identity.');keys.add(key);
      }
    }
    const data={schema:payload.schema,tables:Object.fromEntries(Object.entries(payload.tables).filter(([t])=>allowed.has(t)))};
    let tag='$cc838_restore$', serial=0;const raw=JSON.stringify(data);
    while(raw.includes(tag))tag='$cc838_restore_'+(++serial)+'$';
    return `-- CC838 offline recovery. Apply the current SAFE_UPGRADE_WITH_USERS.sql first.
-- Keeps current employee login/password/role/IDs. Historical-only employees are inactive.
-- Merges business rows by primary key; unrelated destination records remain.
-- PRIVATE: this SQL contains decrypted CRM data. Keep it secure.
BEGIN;
SET LOCAL standard_conforming_strings=on;
SET LOCAL lock_timeout='15s';
SET LOCAL statement_timeout='10min';
DO ${tag}
#variable_conflict use_variable
DECLARE
 p jsonb := ${literal(data)};
 src jsonb; dst jsonb; outrow jsonb; spec jsonb; rows jsonb; item record; tr record; col record;
 login text; oldid text; new_id text; stem text; suffix integer; oldkey text; newval text;
 t text; k text; cols text[]; keys text[]; actualkeys text[]; update_sql text; col_sql text; pk_sql text;
 results jsonb; matched boolean; field text; n bigint; seq text; configured boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('CC787-backup-restore'));
 LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM public.users GROUP BY lower(trim(username)) HAVING count(*)>1) THEN RAISE EXCEPTION 'Ambiguous current username. Nothing restored.'; END IF;
 CREATE TEMP TABLE cc838_people(old_id text PRIMARY KEY, login text UNIQUE, new_id text, current_row jsonb, planned_row jsonb) ON COMMIT DROP;
 CREATE TEMP TABLE cc838_alias(old_key text PRIMARY KEY, new_id text, new_code text) ON COMMIT DROP;
 CREATE TEMP TABLE cc838_triggers(table_name text, trigger_name text, enabled "char") ON COMMIT DROP;
 -- Plan the complete identity map before writing; never infer a person from a reused staff ID.
 FOR src IN SELECT value FROM jsonb_array_elements(p->'tables'->'users') LOOP
   oldid:=trim(src->>'user_id');login:=lower(trim(src->>'username'));
   IF coalesce(oldid,'')='' OR coalesce(login,'')='' THEN RAISE EXCEPTION 'A backup user has no ID or username.'; END IF;
   IF EXISTS(SELECT 1 FROM pg_temp.cc838_people u WHERE u.old_id=oldid OR u.login=login) THEN RAISE EXCEPTION 'Duplicate backup employee. Nothing restored.'; END IF;
   SELECT to_jsonb(u) INTO dst FROM public.users u WHERE lower(trim(u.username))=login;
   matched:=dst IS NOT NULL;
   IF matched THEN new_id:=dst->>'user_id';
   ELSE
     new_id:=oldid;
     IF EXISTS(SELECT 1 FROM public.users u WHERE u.user_id=new_id) OR EXISTS(SELECT 1 FROM pg_temp.cc838_people u WHERE u.new_id=new_id) THEN
       stem:='RESTORE-'||substr(md5(login||chr(31)||oldid),1,20);new_id:=stem;suffix:=0;
       WHILE EXISTS(SELECT 1 FROM public.users u WHERE u.user_id=new_id) OR EXISTS(SELECT 1 FROM pg_temp.cc838_people u WHERE u.new_id=new_id) LOOP suffix:=suffix+1;new_id:=stem||'-'||suffix; END LOOP;
     END IF;
   END IF;
   outrow:=CASE WHEN matched THEN dst ELSE src||jsonb_build_object('user_id',new_id,'username',trim(src->>'username'),'recruiter_code',new_id,'is_active','0') END;
   INSERT INTO pg_temp.cc838_people VALUES(oldid,login,new_id,dst,outrow);
   FOREACH oldkey IN ARRAY ARRAY[oldid,coalesce(nullif(trim(src->>'recruiter_code'),''),oldid)] LOOP
     IF EXISTS(SELECT 1 FROM pg_temp.cc838_alias a WHERE a.old_key=oldkey AND (a.new_id<>new_id OR a.new_code<>coalesce(nullif(outrow->>'recruiter_code',''),new_id))) THEN RAISE EXCEPTION 'Conflicting employee alias. Nothing restored.'; END IF;
     INSERT INTO pg_temp.cc838_alias VALUES(oldkey,new_id,coalesce(nullif(outrow->>'recruiter_code',''),new_id)) ON CONFLICT(old_key) DO NOTHING;
   END LOOP;
 END LOOP;
 -- A one-pass token replacement also handles swapped IDs without replacing its own output.
 EXECUTE $fn$CREATE OR REPLACE FUNCTION pg_temp.cc838_text(v text) RETURNS text LANGUAGE plpgsql AS $body$
 DECLARE r text; rest text; expr text; m text[]; pos integer; parts text[]; mapped text;
 BEGIN
   IF v IS NULL THEN RETURN v; END IF;
   SELECT a.new_id INTO mapped FROM pg_temp.cc838_alias a WHERE a.old_key=v;
   IF FOUND THEN r:=mapped;
   ELSE
     SELECT string_agg(a.old_key,'|' ORDER BY length(a.old_key) DESC,a.old_key) INTO expr FROM pg_temp.cc838_alias a WHERE a.old_key~'^[A-Za-z0-9_-]+$';
     r:='';rest:=v;
     IF expr IS NULL THEN RETURN v; END IF;
     LOOP
       m:=regexp_match(rest,'(^|[^A-Za-z0-9-])('||expr||')($|[^A-Za-z0-9-])');EXIT WHEN m IS NULL;
       pos:=strpos(rest,m[1]||m[2]||m[3]);
       SELECT a.new_id INTO mapped FROM pg_temp.cc838_alias a WHERE a.old_key=m[2];
       r:=r||substr(rest,1,pos-1)||m[1]||mapped;
       rest:=substr(rest,pos+length(m[1])+length(m[2]));
     END LOOP;
     r:=r||rest;
   END IF;
   IF left(r,3)='dm:' THEN parts:=string_to_array(substr(r,4),'__');IF cardinality(parts)=2 THEN SELECT array_agg(x ORDER BY x) INTO parts FROM unnest(parts) x;r:='dm:'||array_to_string(parts,'__'); END IF; END IF;
   RETURN r;
 END $body$$fn$;
 EXECUTE $fn$CREATE OR REPLACE FUNCTION pg_temp.cc838_json(v jsonb, depth integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql AS $body$
 DECLARE r jsonb; x record; key text;
 BEGIN
   IF depth>64 THEN RAISE EXCEPTION 'Backup metadata nesting is too deep.'; END IF;
   CASE jsonb_typeof(v)
     WHEN 'string' THEN RETURN to_jsonb(pg_temp.cc838_text(v#>>'{}'));
     WHEN 'array' THEN SELECT coalesce(jsonb_agg(pg_temp.cc838_json(a.value,depth+1) ORDER BY a.ordinality),'[]'::jsonb) INTO r FROM jsonb_array_elements(v) WITH ORDINALITY a;RETURN r;
     WHEN 'object' THEN
       r:='{}';FOR x IN SELECT * FROM jsonb_each(v) LOOP key:=pg_temp.cc838_text(x.key);IF r?key THEN RAISE EXCEPTION 'Employee mapping merges metadata keys.'; END IF;r:=r||jsonb_build_object(key,pg_temp.cc838_json(x.value,depth+1));END LOOP;RETURN r;
     ELSE RETURN v;
   END CASE;
 END $body$$fn$;
 EXECUTE $fn$CREATE OR REPLACE FUNCTION pg_temp.cc838_row(tab text, v jsonb) RETURNS jsonb LANGUAGE plpgsql AS $body$
 DECLARE r jsonb:=v; x record; parsed jsonb; mapped text; own jsonb; prefix text;
 BEGIN
   FOR x IN SELECT * FROM jsonb_each(v) LOOP
     IF x.key~'username$' AND jsonb_typeof(x.value)='string' THEN
       SELECT u.planned_row->>'username' INTO mapped FROM pg_temp.cc838_people u WHERE u.login=lower(trim(x.value#>>'{}'));IF FOUND THEN r:=r||jsonb_build_object(x.key,mapped);END IF;
     ELSIF x.key~'_code$' AND jsonb_typeof(x.value)='string' THEN
       SELECT a.new_code INTO mapped FROM pg_temp.cc838_alias a WHERE a.old_key=x.value#>>'{}';r:=r||jsonb_build_object(x.key,coalesce(mapped,pg_temp.cc838_text(x.value#>>'{}')));
     ELSIF x.key~'(^user_id$|_user_id$|^user_ids$|^employee_no$|^tl_id$|^manager_id$|^recruiter_id$|^owner_id$|^assigned_to$|^approved_by$|^created_by$|^reporting_to$|^thread_key$|^thread_id$|^conversation_key$|^conversation_id$|^member_ids$|^member_user_ids$|^owner_ids$|^participant_ids$)' THEN
       r:=r||jsonb_build_object(x.key,pg_temp.cc838_json(x.value));
     ELSIF x.key~'(metadata|_json$|^payload$)' OR tab='settings' AND x.key='setting_value' OR tab='app_settings' AND x.key='value' THEN
       IF jsonb_typeof(x.value)='string' THEN
         BEGIN parsed:=(x.value#>>'{}')::jsonb;EXCEPTION WHEN invalid_text_representation THEN parsed:=NULL;END;
         IF parsed IS NOT NULL THEN r:=r||jsonb_build_object(x.key,pg_temp.cc838_json(parsed)::text); END IF;
       ELSIF jsonb_typeof(x.value) IN('object','array') THEN r:=r||jsonb_build_object(x.key,pg_temp.cc838_json(x.value));END IF;
     ELSIF tab='settings' AND x.key='setting_key' AND left(x.value#>>'{}',18)='mobile_appearance_' THEN r:=r||jsonb_build_object(x.key,pg_temp.cc838_text(x.value#>>'{}'));
     END IF;
   END LOOP;
   FOREACH prefix IN ARRAY ARRAY['recruiter','employee','tl','manager','owner'] LOOP
     IF r?(prefix||'_name') THEN
       SELECT u.planned_row INTO own FROM pg_temp.cc838_people u WHERE u.new_id=r->>(prefix||'_user_id') LIMIT 1;
       IF own IS NULL THEN SELECT to_jsonb(u) INTO own FROM public.users u WHERE u.user_id=r->>(prefix||'_user_id'); END IF;
       IF own IS NOT NULL THEN r:=r||jsonb_build_object(prefix||'_name',coalesce(nullif(own->>'full_name',''),own->>'username'));END IF;
     END IF;
   END LOOP;
   RETURN r;
 END $body$$fn$;
 -- Validate the complete destination before inserting anything. Newer tables absent from
 -- an old backup remain untouched; unknown populated tables are rejected by the generator.
 FOR t IN SELECT key FROM jsonb_each(p->'tables') LOOP
   IF to_regclass('public.'||quote_ident(t)) IS NULL THEN RAISE EXCEPTION 'Missing destination table %. Apply the current safe schema first.',t; END IF;
   spec:=p->'schema'->t;
   SELECT array_agg(k.column_name::text ORDER BY k.ordinal_position) INTO actualkeys FROM information_schema.key_column_usage k JOIN information_schema.table_constraints c ON c.constraint_name=k.constraint_name AND c.table_schema=k.table_schema AND c.table_name=k.table_name WHERE k.table_schema='public' AND k.table_name=t AND c.constraint_type='PRIMARY KEY';
   SELECT array_agg(value ORDER BY ord) INTO keys FROM jsonb_array_elements_text(spec->'primary_key') WITH ORDINALITY a(value,ord);
   IF actualkeys IS DISTINCT FROM keys THEN RAISE EXCEPTION 'Primary key differs for %. Nothing restored.',t; END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(spec->'columns') a WHERE NOT EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=t AND c.column_name=a->>'name')) THEN RAISE EXCEPTION 'Missing destination columns for %. Apply the current safe schema first.',t; END IF;
   EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',t);
 END LOOP;
 INSERT INTO pg_temp.cc838_triggers SELECT c.relname,tgname,tgenabled FROM pg_trigger pt JOIN pg_class c ON c.oid=pt.tgrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='public' AND NOT pt.tgisinternal AND tgname IN('cc782_bucket_capacity','cc782_revenue_identity');
 FOR tr IN SELECT * FROM pg_temp.cc838_triggers LOOP EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I',tr.table_name,tr.trigger_name);END LOOP;
 -- Users first, then settings/candidates, then other business tables.
 FOR t IN SELECT key FROM jsonb_each(p->'tables') ORDER BY CASE key WHEN 'users' THEN 0 WHEN 'settings' THEN 1 WHEN 'candidates' THEN 2 ELSE 3 END,key LOOP
   IF t=ANY(ARRAY['active_sessions','mobile_devices','live_call_state','generated_downloads','chat_notification_jobs']) THEN CONTINUE;END IF;
   spec:=p->'schema'->t;
   SELECT array_agg(a->>'name' ORDER BY ord) INTO cols FROM jsonb_array_elements(spec->'columns') WITH ORDINALITY x(a,ord);
   SELECT array_agg(value ORDER BY ord) INTO keys FROM jsonb_array_elements_text(spec->'primary_key') WITH ORDINALITY a(value,ord);
   IF t='users' THEN FOREACH field IN ARRAY ARRAY['username','recruiter_code','is_active'] LOOP IF NOT field=ANY(cols) THEN cols:=array_append(cols,field);END IF;END LOOP;END IF;
   results:='[]';
   FOR src IN SELECT value FROM jsonb_array_elements(p->'tables'->t) LOOP
     outrow:=pg_temp.cc838_row(t,src);
     IF t='users' THEN
       SELECT current_row,planned_row INTO dst,rows FROM pg_temp.cc838_people u WHERE u.old_id=src->>'user_id';
       IF dst IS NOT NULL THEN
         FOREACH field IN ARRAY cols LOOP
           IF field~*'password|secret|token|session|auth|mfa|otp' OR field~'^(user_id|username|full_name|role|designation|recruiter_code|is_active|team_id|tl_user_id|tl_code|tl_name|manager_user_id|manager_code|manager_name|reporting_to)$' THEN outrow:=outrow||jsonb_build_object(field,dst->field);END IF;
         END LOOP;
       ELSE outrow:=outrow||jsonb_build_object('user_id',rows->'user_id','username',rows->'username','recruiter_code',rows->'recruiter_code','is_active','0');END IF;
     ELSIF t='presence' THEN outrow:=outrow||jsonb_build_object('is_on_break','0','locked','0','lock_reason','','break_started_at','','break_expected_end_at','','activity_credit_at',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
     ELSIF t='dialer_sessions' THEN outrow:=outrow||jsonb_build_object('status','Stopped','mobile_command','stop','command_type','stop');END IF;
     results:=results||jsonb_build_array(outrow);
     IF jsonb_array_length(results)=250 THEN
       SELECT string_agg(quote_ident(c),',') INTO col_sql FROM unnest(cols) c;SELECT string_agg(quote_ident(c),',') INTO pk_sql FROM unnest(keys) c;SELECT string_agg(format('%I=EXCLUDED.%I',c,c),',') INTO update_sql FROM unnest(cols) c WHERE NOT c=ANY(keys);
       EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_recordset(NULL::public.%I,$1) ON CONFLICT (%s) %s',t,col_sql,col_sql,t,pk_sql,CASE WHEN update_sql IS NULL THEN 'DO NOTHING' ELSE 'DO UPDATE SET '||update_sql END) USING results;results:='[]';
     END IF;
   END LOOP;
   IF jsonb_array_length(results)>0 THEN
     SELECT string_agg(quote_ident(c),',') INTO col_sql FROM unnest(cols) c;SELECT string_agg(quote_ident(c),',') INTO pk_sql FROM unnest(keys) c;SELECT string_agg(format('%I=EXCLUDED.%I',c,c),',') INTO update_sql FROM unnest(cols) c WHERE NOT c=ANY(keys);
     EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_recordset(NULL::public.%I,$1) ON CONFLICT (%s) %s',t,col_sql,col_sql,t,pk_sql,CASE WHEN update_sql IS NULL THEN 'DO NOTHING' ELSE 'DO UPDATE SET '||update_sql END) USING results;
   END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.candidates GROUP BY upper(trim(candidate_id)) HAVING count(*)>1) THEN RAISE EXCEPTION 'Candidate identity conflict';END IF;
 IF EXISTS(SELECT 1 FROM public.revenue_hub_entries WHERE lower(trim(coalesce(status,'')))<>'deleted' AND coalesce(trim(deleted_at),'')='' GROUP BY upper(trim(candidate_id)) HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate revenue';END IF;
 IF EXISTS(SELECT 1 FROM public.revenue_hub_entries r WHERE lower(trim(coalesce(status,'')))<>'deleted' AND coalesce(trim(deleted_at),'')='' AND NOT EXISTS(SELECT 1 FROM public.candidates c WHERE upper(trim(c.candidate_id))=upper(trim(r.candidate_id)))) THEN RAISE EXCEPTION 'Revenue references a missing candidate';END IF;
 FOREACH t IN ARRAY ARRAY['notes','submissions','interviews','candidate_jd_feedback'] LOOP EXECUTE format($query$SELECT EXISTS(SELECT 1 FROM public.%I r WHERE coalesce(trim(candidate_id),'')<>'' AND NOT EXISTS(SELECT 1 FROM public.candidates c WHERE c.candidate_id=r.candidate_id))$query$,t) INTO configured;IF configured THEN RAISE EXCEPTION '% references a missing candidate',t;END IF;END LOOP;
 FOR col IN SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND column_default LIKE 'nextval(%' LOOP seq:=pg_get_serial_sequence('public.'||quote_ident(col.table_name),col.column_name);IF seq IS NOT NULL THEN EXECUTE format('SELECT greatest(coalesce(max(%I),1),1) FROM public.%I',col.column_name,col.table_name) INTO n;PERFORM setval(seq::regclass,n,true);END IF;END LOOP;
 FOR tr IN SELECT * FROM pg_temp.cc838_triggers LOOP EXECUTE format('ALTER TABLE public.%I %s TRIGGER %I',tr.table_name,CASE tr.enabled WHEN 'D' THEN 'DISABLE' WHEN 'R' THEN 'ENABLE REPLICA' WHEN 'A' THEN 'ENABLE ALWAYS' ELSE 'ENABLE' END,tr.trigger_name);END LOOP;
 -- Pairing and live login state are not portable between backups/devices.
 DELETE FROM public.active_sessions;DELETE FROM public.mobile_devices;DELETE FROM public.live_call_state;DELETE FROM public.chat_notification_jobs;
 DROP FUNCTION pg_temp.cc838_row(text,jsonb);DROP FUNCTION pg_temp.cc838_json(jsonb,integer);DROP FUNCTION pg_temp.cc838_text(text);
END ${tag};
COMMIT;
`;
  }
  // Small dependency-free ZIP writer (stored entries); all work stays on this device.
  const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  const crc32=bytes=>{let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return(n^0xffffffff)>>>0;};
  function zip(entries){
    const locals=[],centrals=[];let offset=0;
    for(const [filename,data] of entries){
      const name=new TextEncoder().encode(filename), bytes=data instanceof Uint8Array?data:new TextEncoder().encode(data), crc=crc32(bytes);
      const header=new Uint8Array(30+name.length), v=new DataView(header.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,crc,true);v.setUint32(18,bytes.length,true);v.setUint32(22,bytes.length,true);v.setUint16(26,name.length,true);header.set(name,30);
      const central=new Uint8Array(46+name.length), c=new DataView(central.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint32(16,crc,true);c.setUint32(20,bytes.length,true);c.setUint32(24,bytes.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);central.set(name,46);
      locals.push(header,bytes);centrals.push(central);offset+=header.length+bytes.length;
    }
    const length=centrals.reduce((n,c)=>n+c.length,0), end=new Uint8Array(22), e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,length,true);e.setUint32(16,offset,true);
    return new Blob([...locals,...centrals,end],{type:'application/zip'});
  }
  async function recoveryZip(payload){
    const entries=[['RESTORE_CRM_DATA.sql',recoverySQL(payload)],['README.txt','1. Apply the current SAFE_UPGRADE_WITH_USERS.sql to create/update the schema without deleting business data.\n2. Run RESTORE_CRM_DATA.sql. Current usernames, passwords, roles and staff IDs stay; historical-only users are inactive. Business ownership and chat/settings references are remapped by username.\n3. Copy the included backend/public/generated files to the matching backend folder. Do not overwrite a different file with the same name.\n4. Restart the CRM, sign in with the current account and pair phones again. Old runtime logins/device state are excluded.\n5. This merges matching IDs and adds missing records; unrelated newer records stay. A schema conflict rolls back the SQL.\nThis ZIP contains decrypted private data; store it securely.\n']];
    let total=0;
    for(const f of payload.files||[]){if(!/^[a-zA-Z0-9._/-]+$/.test(f.path)||f.path.includes('..')||f.path.startsWith('/'))throw new Error('Invalid attachment path.');const bytes=bytes64(f.base64);if((total+=bytes.length)>32*1024*1024||hex(await crypto.subtle.digest('SHA-256',bytes))!==f.sha256)throw new Error('Damaged or oversized attachment.');entries.push(['backend/public/generated/'+f.path,bytes]);}
    return zip(entries);
  }
  const xml=value=>String(value??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  function excelSheets(sheets,extra=[]){
    const entries=[...extra],work=[],rels=[],types=[];
    for(let n=0;n<sheets.length;n++){const sheet=sheets[n],cols=sheet.columns||[...new Set(sheet.rows.flatMap(Object.keys))];const grid=[Object.fromEntries(cols.map(k=>[k,k])),...sheet.rows];const cellCol=i=>{let s='';for(i++;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;};const rows=grid.map((r,i)=>'<row r="'+(i+1)+'">'+cols.map((k,j)=>{let v=r[k];if(v&&typeof v==='object')v=JSON.stringify(v);if(typeof v==='number'&&Number.isFinite(v))return '<c r="'+cellCol(j)+(i+1)+'"><v>'+v+'</v></c>';return '<c r="'+cellCol(j)+(i+1)+'" t="inlineStr"><is><t xml:space="preserve">'+xml(String(v??'').slice(0,32767))+'</t></is></c>';}).join('')+'</row>').join('');
      entries.push(['xl/worksheets/sheet'+(n+1)+'.xml','<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>'+rows+'</sheetData></worksheet>']);
      work.push('<sheet name="'+xml(sheet.name.slice(0,31))+'" sheetId="'+(n+1)+'" r:id="rId'+(n+1)+'"/>');rels.push('<Relationship Id="rId'+(n+1)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+(n+1)+'.xml"/>');types.push('<Override PartName="/xl/worksheets/sheet'+(n+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
    }
    entries.push(['[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="json" ContentType="application/json"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+types.join('')+'</Types>']);
    entries.push(['_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>']);entries.push(['xl/workbook.xml','<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+work.join('')+'</sheets></workbook>']);entries.push(['xl/_rels/workbook.xml.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+rels.join('')+'</Relationships>']);
    return new Blob([zip(entries)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }
  function candidateWorkbook(payload){if(payload?.format!=='cc-candidate-workbook')throw Error('Invalid candidate backup.');const users=new Map((payload.users||[]).map(u=>[u.user_id,u.full_name||u.username]));const candidates=(payload.tables.candidates||[]).map(c=>({...c,recruiter_name:users.get(c.recruiter_user_id)||c.recruiter_name||''}));const sheets=[{name:'Candidates',columns:['candidate_id','full_name','phone','email','location','qualification','recruiter_name','status','approval_status','interview_date','submission_date','follow_up_at','data_notes',...Object.keys(candidates[0]||{}).filter(k=>!['candidate_id','full_name','phone','email','location','qualification','recruiter_name','status','approval_status','interview_date','submission_date','follow_up_at','data_notes'].includes(k))],rows:candidates},...Object.entries(payload.tables).filter(([k])=>k!=='candidates').map(([name,rows])=>({name,rows}))];return excelSheets(sheets,[['career-crox/candidate-backup.json',JSON.stringify(payload)]]);}
  root.CC787Backup={decode,save,recoverySQL,recoveryZip,candidateWorkbook,excelSheets};
})(globalThis);
