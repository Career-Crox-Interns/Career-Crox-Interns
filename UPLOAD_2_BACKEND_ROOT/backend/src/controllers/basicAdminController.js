const { store } = require('../lib/store');
const { hashPassword } = require('../lib/security');
const { basicSchemaHealth, ensureBasicSchema, INTERN_DEFAULTS } = require('../lib/basicSchema');

function nowIso(){ return new Date().toISOString(); }
function clean(value, max=120){ return String(value ?? '').trim().slice(0,max); }
function truthyText(value){ return ['1','true','yes','active'].includes(String(value ?? '').trim().toLowerCase()) ? 'true' : 'false'; }
function sanitizeUser(row={}){ const out={...row}; delete out.password; delete out.password_hash; return out; }

async function listInterns(req,res){
  const rows = await store.query(`select * from public.users where user_id like 'INTERN-%' order by user_id`);
  return res.json({ items: rows.map(sanitizeUser), expected_count: INTERN_DEFAULTS.length });
}

async function updateIntern(req,res){
  const userId = clean(req.params.userId,64);
  if (!/^INTERN-\d{3}$/i.test(userId)) return res.status(400).json({message:'Invalid intern profile id.'});
  const existing = await store.findById('users','user_id',userId);
  if (!existing) return res.status(404).json({message:'Intern profile not found.'});
  const body=req.body||{};
  const patch={ updated_at: nowIso() };
  if (body.full_name !== undefined) patch.full_name=clean(body.full_name,100) || existing.full_name;
  if (body.username !== undefined) patch.username=clean(body.username,80).toLowerCase() || existing.username;
  if (body.recruiter_code !== undefined) patch.recruiter_code=clean(body.recruiter_code,32).toUpperCase() || existing.recruiter_code;
  if (body.is_active !== undefined) patch.is_active=truthyText(body.is_active);
  if (body.password) {
    const password=clean(body.password,128);
    if (password.length < 8) return res.status(400).json({message:'Password must be at least 8 characters.'});
    patch.password=hashPassword(password);
  }
  patch.designation='Intern';
  patch.role='recruiter';
  try {
    const saved=await store.update('users','user_id',userId,patch);
    try { await store.insert('activity_log',{ activity_id:`A${Date.now()}${Math.random().toString(36).slice(2,8)}`.toUpperCase(), user_id:req.user?.user_id||'', username:req.user?.username||'', action_type:'intern_profile_updated', candidate_id:'', metadata:JSON.stringify({target_user_id:userId, target_username:saved?.username||'', changed:Object.keys(patch).filter(k=>k!=='password')}), created_at:nowIso() }); } catch {}
    return res.json({ ok:true, item:sanitizeUser(saved) });
  } catch (error) {
    if (String(error?.code||'') === '23505') return res.status(409).json({message:'Username or recruiter code is already in use.'});
    throw error;
  }
}

async function health(req,res){
  const schema = await basicSchemaHealth();
  const [internCountRow,candidateCountRow,logCountRow] = await Promise.all([
    store.one(`select count(*)::int as count from public.users where user_id like 'INTERN-%'`),
    store.one(`select count(*)::int as count from public.candidates where lower(coalesce(status,'')) not in ('deleted','archived')`),
    store.one(`select count(*)::int as count from public.activity_log`),
  ]);
  return res.json({
    ok: schema.ok,
    schema,
    counts:{ interns:Number(internCountRow?.count||0), candidates:Number(candidateCountRow?.count||0), crm_logs:Number(logCountRow?.count||0) },
    basic_features:['Candidates','Submissions','Interviews','Follow-ups','Tasks','Call Assistant','Goal Post','Approvals','CRM Logs','Admin Control'],
    break_feature:false,
  });
}

async function repair(req,res){
  const result = await ensureBasicSchema();
  try { await store.insert('activity_log',{ activity_id:`A${Date.now()}${Math.random().toString(36).slice(2,8)}`.toUpperCase(), user_id:req.user?.user_id||'', username:req.user?.username||'', action_type:'basic_schema_repair', candidate_id:'', metadata:JSON.stringify({ok:result.ok,missing_tables:result.missing_tables||[],missing_columns:result.missing_columns||[]}), created_at:nowIso() }); } catch {}
  return res.json({ok:Boolean(result.ok),schema:result});
}

module.exports={ listInterns, updateIntern, health, repair };
