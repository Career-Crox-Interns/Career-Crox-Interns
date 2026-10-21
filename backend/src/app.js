process.env.TZ = 'Asia/Kolkata';
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const apiRoutes = require('./routes');
const { SPA_DIR, GENERATED_DIR, DATABASE_URL, REQUIRE_POSTGRES } = require('./config/env');
const { requireAuth, requireStrongAuth } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();

function buildAllowedOrigins() {
  const values = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const renderUrl = String(process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '');
  const renderHost = String(process.env.RENDER_EXTERNAL_HOSTNAME || '').trim();
  if (renderUrl) values.push(renderUrl);
  if (renderHost) values.push(`https://${renderHost}`);
  // Exact production origin. Keep this explicit so same-origin POST/login always works
  // even if Render environment variables were not refreshed during a deploy.
  values.push('https://career-crox-interns.onrender.com');
  return new Set(values);
}

const allowedOrigins = buildAllowedOrigins();

function normalizedOrigin(value = '') {
  return String(value || '').trim().replace(/\/$/, '');
}

function isLoopbackOrigin(origin = '') {
  try {
    const url = new URL(normalizedOrigin(origin));
    const host = String(url.hostname || '').toLowerCase();
    return ['http:', 'https:'].includes(url.protocol) && (
      host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.startsWith('127.')
    );
  } catch (_) {
    return false;
  }
}

function isSameRequestOrigin(req, origin = '') {
  try {
    const url = new URL(normalizedOrigin(origin));
    const forwardedHost = String(req.get('x-forwarded-host') || '').split(',')[0].trim();
    const requestHost = forwardedHost || String(req.get('host') || '').trim();
    const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
    const requestProto = forwardedProto || String(req.protocol || '').trim().toLowerCase();
    return Boolean(requestHost) && url.host.toLowerCase() === requestHost.toLowerCase()
      && (!requestProto || url.protocol.toLowerCase() === `${requestProto}:`);
  } catch (_) {
    return false;
  }
}

function isAllowedOrigin(req, origin = '') {
  const value = normalizedOrigin(origin);
  if (!value) return true; // server-to-server/local proxy requests have no Origin header
  if (allowedOrigins.has(value)) return true;
  if (isLoopbackOrigin(value)) return true;
  if (isSameRequestOrigin(req, value)) return true;
  return false;
}

// Reject unknown browser origins before routes (CSRF-safe), while still allowing
// localhost/127.0.0.1 launchers and the exact Render origin. This replaces the old
// CORS callback that could throw a 500-style "Origin blocked by CORS" on login.
app.use((req, res, next) => {
  const origin = String(req.get('origin') || '').trim();
  if (origin && !isAllowedOrigin(req, origin)) {
    return res.status(403).json({ ok: false, error: 'Origin not allowed', code: 'CORS_ORIGIN_DENIED' });
  }
  return next();
});
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'X-Export-Token','X-CRM-Workbook-Hash','X-CRM-Preview-Token','X-CRM-Confirm-Restore','X-CC-Dashboard-User','X-Career-Crox-Background','X-Career-Crox-Last-Activity-At','X-Career-Crox-Activity-Age-Ms'],
  maxAge: 86400,
}));

function staticCacheControl(req, res, next) {
  const rawUrl = String(req.url || '');
  const pathname = rawUrl.split('?')[0];
  const fileName = path.basename(pathname);
  const isViteHashedAsset = /-[A-Za-z0-9_-]{8,}\.(?:js|css)$/i.test(fileName) && !/CC26_/i.test(fileName);
  const isCareerCroxReleaseAsset = /^(?:app|runtime)-cc26-\d+-[a-f0-9]{8,}\.(?:js|css)$/i.test(fileName);
  const isReleaseVersionedAsset = /[?&]v=CC(?:26_)?\d+(?:_[A-Za-z0-9_-]+)?(?:[&#]|$)/i.test(rawUrl) && /\.(?:js|css)$/i.test(pathname);
  const isImageOrFont = /\.(?:png|jpg|jpeg|webp|svg|ico|mp3|woff2?)$/i.test(pathname);
  const isScriptOrStyle = /\.(?:js|css)$/i.test(pathname);

  // Current release assets are immutable by URL. Next release changes the v= value,
  // so browsers get speed without stale-code risk or repeated egress.
  if (isViteHashedAsset || isCareerCroxReleaseAsset || isReleaseVersionedAsset || isImageOrFont) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (isScriptOrStyle) {
    res.setHeader('Cache-Control', 'no-cache, max-age=0, must-revalidate');
  } else if (/index\.html$/i.test(pathname) || pathname === '/' || !pathname.includes('.')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
}
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use('/api/data-backup',cookieParser(),requireAuth,requireStrongAuth,(req,res,next)=>['manager','admin'].includes(String(req.user?.role||'').toLowerCase())?next():res.status(403).json({message:'Manager backup access only.'}),express.json({limit:'90mb'}));
app.use(express.json({ limit: process.env.JSON_LIMIT || '15mb' }));
app.use('/jd-samples',express.static(path.join(__dirname,'../public/jd-samples'),{index:false,dotfiles:'deny'}));
app.use(cookieParser());

function readSpaRuntimeState() {
  const spaIndex = path.join(SPA_DIR, 'index.html');
  if (!fs.existsSync(spaIndex)) return { spaReady: false, build: 'unknown', mainAsset: null };
  try {
    const html = fs.readFileSync(spaIndex, 'utf8');
    const build = (html.match(/<meta\s+name=[\"']cc-build[\"']\s+content=[\"']([^\"']+)[\"']/i) || [])[1] || 'unknown';
    const mainAsset = (html.match(/<meta\s+name=[\"']cc-main-asset[\"']\s+content=[\"']([^\"']+)[\"']/i) || [])[1]
      || (html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i) || [])[1] || null;
    const mainAssetPath = mainAsset ? path.join(SPA_DIR, String(mainAsset).replace(/^\//, '')) : null;
    return { spaReady: Boolean(mainAssetPath && fs.existsSync(mainAssetPath)), build, mainAsset };
  } catch (error) {
    return { spaReady: false, build: 'unknown', mainAsset: null };
  }
}

// Render /health is a process-liveness check. The build step already validates the
// complete source-built SPA, so health is not tied to a hard-coded asset name.
// This keeps cold-start deploys fast and prevents an otherwise healthy service from
// being stuck in "In progress" after a new CC26 release.
app.get('/health', (req, res) => {
  const state = readSpaRuntimeState();
  res.status(200).json({
    ok: true,
    service: 'career-crox',
    status: 'alive',
    build: state.build,
    spa: state.spaReady,
    main_asset: state.mainAsset,
    deployment: 'CRM 2',
    receiver_release: 'CC881',
    release: require('./lib/candidateCommand').RELEASE,
    workflow_version: require('./lib/candidateCommand').WORKFLOW_VERSION,
  });
});

// Readiness includes database/schema capabilities; Render uses this before routing traffic.
app.get('/ready', async (req, res) => {
  const state = readSpaRuntimeState();
  let dbReady = !REQUIRE_POSTGRES;
  let dbError = '';
  if (DATABASE_URL) {
    try {
      const { store } = require('./lib/store');
      const probe = await store.query('select 1 as ok');
      dbReady = Number(probe?.[0]?.ok || 0) === 1;
      const capabilities = {
        candidates: ['candidate_id','project_id','full_name','phone','location','qualification','course_name','preferred_location','qualification_level','total_experience','relevant_experience','in_hand_salary','ctc_monthly','recruiter_code','recruiter_name','process','career_gap','documents_availability','communication_skill','interview_reschedule_date','submission_date','virtual_onsite','looking_for_job','call_connected','status','all_details_sent','approval_status','approval_requested_at','approved_at','created_at','updated_at','deleted_at','data_notes','bucket_assigned_at','bucket_state','recruiter_designation','recruiter_user_id'],
        jd_master: ['jd_id', 'job_title', 'company', 'process_name', 'location', 'sector', 'pincode', 'qualification_required', 'in_hand_min', 'in_hand_max', 'interview_mode', 'working_days', 'shift_timing', 'rotational_shift', 'women_shift', 'cab', 'travel_allowance', 'meal', 'incentive', 'process_type', 'role_responsibilities', 'sample_label'],
        mail_templates:['template_id','title','subject','body'],
        jd_documents:['document_id','jd_id','public_token','filename','size_bytes','content_base64','sha256','deleted_at'],
        mail_logs:['log_id','delivery_status'],
        users: ['user_id','username','full_name','recruiter_code','role','designation','is_active'],
        active_sessions: ['username','session_token','updated_at'],
        submissions: ['submission_id','candidate_id','approval_status','submitted_at','reminder_due_at','approval_reminder_at'],
        notes: ['id','candidate_id','body','created_at'],
        crm_command_receipts: ['command_id','user_id','candidate_id','payload_hash','receipt_json','created_at'],
        crm_candidate_drafts:['draft_id','user_id','candidate_id','fields_json','note_json','updated_at'],
        crm_candidate_id_registry:['candidate_id','allocated_at'],
        crm_candidate_phone_claims:['phone','candidate_id','claimed_at'],
        crm_candidate_audit:['audit_id','candidate_id','actor','reason','before_values','after_values','created_at'],
        bulk_upload_history: ['upload_id', 'upload_type', 'file_name', 'sheet_name', 'uploaded_rows', 'added_count', 'updated_count', 'duplicate_count', 'replaced_count', 'skipped_count', 'data_notes_applied_count', 'processed_count', 'data_notes', 'data_uploading_date', 'assignee_user_id', 'assignee_name', 'recruiter_mapping', 'uploaded_by_user_id', 'uploaded_by_name', 'uploaded_by_code', 'created_at'],
        chat_thread_read_state: ['state_id','user_id','thread_key','last_read_id','updated_at'],
        chat_notification_jobs: ['job_id','message_id','payload_json','status','attempts','updated_at'],
        messages: ['id','thread_key','sender_username','body','client_message_key','updated_at','deleted_at'],
        activity_log: ['id','activity_id','user_id','created_at'],
        presence:['user_id','work_started_at','total_work_minutes','total_break_minutes','activity_credit_at','is_on_break','break_started_at','break_expected_end_at'],
        call_logs:['call_log_id','employee_user_id','crm_tracked_number','stats_counted','call_started_at','call_ended_at','talktime_seconds'],
        employee_daily_stats:['stat_id','calls_count','outgoing_talktime_seconds','incoming_talktime_seconds','manual_calls_count','auto_dialer_calls_count'],
        revenue_hub_entries:['revenue_id','candidate_id','payout_amount','payout_received_at','interview_mode'],
        generated_downloads: ['file_path','user_id','expires_at'],
      };
      const caps = await store.query(`select table_name,column_name from information_schema.columns where table_schema='public' and table_name=any($1::text[])`, [Object.keys(capabilities)]);
      const required = Object.entries(capabilities).flatMap(([table,columns])=>columns.map(column=>`${table}:${column}`));
      const have = new Set(caps.map(c => `${c.table_name}:${c.column_name}`));
      const due = await store.query(`select to_regprocedure('public.crm_due_instant(text)') is not null and to_regprocedure('public.crm_bucket_expired(jsonb,timestamp with time zone)') is not null and exists(select 1 from pg_trigger where tgrelid='public.candidates'::regclass and tgname='cc782_bucket_capacity' and tgenabled in ('O','A')) and exists(select 1 from pg_trigger where tgrelid='public.revenue_hub_entries'::regclass and tgname='cc782_revenue_identity' and tgenabled in ('O','A')) and to_regclass('public.crm_candidate_drafts') is not null and to_regclass('public.crm_candidate_audit') is not null and to_regclass('public.crm_candidate_phone_claims') is not null and to_regclass('public.crm_candidate_id_seq') is not null and (select count(*) from pg_trigger where tgrelid='public.candidates'::regclass and tgname=any(array['cc847_candidate_identity_lock','cc848_registry_after_insert','cc861_candidate_phone','cc861_candidate_audit','cc861_candidate_no_delete','cc861_candidate_no_truncate']) and tgenabled in ('O','A'))=6 and (select count(*) from pg_trigger where tgrelid='public.crm_candidate_audit'::regclass and tgname=any(array['cc861_audit_immutable','cc861_audit_no_truncate']) and tgenabled in ('O','A'))=2 and (select count(*) from pg_trigger where tgrelid='public.crm_candidate_id_registry'::regclass and tgname=any(array['cc848_registry_no_update_delete','cc861_registry_no_truncate']) and tgenabled in ('O','A'))=2 and exists(select 1 from pg_trigger where tgrelid='public.candidates'::regclass and tgname='cc863_candidate_id_guard' and tgenabled in ('O','A')) and to_regprocedure('public.crm_reconcile_candidate_sequence(bigint)') is not null as ready`);
      dbReady = dbReady && required.every(c => have.has(c)) && due?.[0]?.ready === true;
    } catch (error) { dbReady = false; dbError = String(error?.message || error || 'database probe failed'); }
  }
  const ok = Boolean(state.spaReady && dbReady);
  res.status(ok ? 200 : 503).json({
    ok, service: 'career-crox', status: ok ? 'ready' : (!state.spaReady ? 'spa_incomplete' : 'database_unavailable'),
    build: state.build, spa: state.spaReady, database: dbReady, database_error: dbError ? 'DATABASE_UNAVAILABLE' : undefined, main_asset: state.mainAsset,
  });
});
app.get('/download/android-apk', (req,res)=>{const apk=require('./lib/apkRelease').currentApk();if(!apk)return res.status(409).json({ok:false,code:'APK_BUILD_REQUIRED',message:'CC863 Android source is ready. Build the APK with Android Studio or the included GitHub workflow; an old APK is not supplied as this release.'});res.setHeader('Cache-Control','no-store');return res.download(apk.file,'Career_Crox_CC863.apk');});
// CC26_661: explicit SecureLink Windows helper download. No Supabase/database query.
// Fresh source build: no packer, no service/persistence, localhost-only bridge.
// Windows mouse/keyboard control still requires visible employee consent.
const SECURELINK_HELPER_SHA256 = 'ff3ad078212a0393ef6e83bf486ad3116a7a23e4826b2a57a2141351ec537ee9';
function secureLinkHelperPath() { return path.join(require('./config/env').ROOT_DIR, 'public', 'securelink', 'Career Crox SecureLink.exe'); }
app.get('/securelink/build-info', requireAuth, requireStrongAuth, (req,res) => {
  const exe = secureLinkHelperPath();
  const present = fs.existsSync(exe);
  res.set('Cache-Control', 'no-store');
  const packagePath=path.join(path.dirname(exe),'Career_Crox_SecureLink_Windows.zip');
  const packageReady=present&&fs.existsSync(packagePath);
  return res.json({ securelink: 'CC26_661', distribution:'CC839', app_download_ready: packageReady, download_url: packageReady ? '/download/securelink-package?v=CC839' : null, sha256: present ? SECURELINK_HELPER_SHA256 : null, signed: false, background_download: false, architecture:'windows-x64', publisher_status:'Unsigned; browser reputation warnings may appear.' });
});
app.get('/download/securelink-package', requireAuth, requireStrongAuth, (req,res)=>{
  const file=path.join(path.dirname(secureLinkHelperPath()),'Career_Crox_SecureLink_Windows.zip');
  if(!fs.existsSync(file))return res.status(404).json({message:'The Windows install package is missing. Redeploy the complete backend folder.'});
  const actual=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if(actual!=='041c6934ad3f57575707ffffcb7a31d7413ecd18bb9a5a5833695146c4277d2b')return res.status(409).json({message:'Windows package integrity check failed. Redeploy the verified package.'});
  res.set({'Cache-Control':'private, no-store','Content-Type':'application/zip','X-SecureLink-Build':'CC839','X-Content-SHA256':actual,'X-Content-Type-Options':'nosniff'});
  return res.download(file,'Career_Crox_SecureLink_Windows.zip');
});
app.get('/download/securelink-helper', requireAuth, requireStrongAuth, (req, res) => {
  const exe = secureLinkHelperPath();
  if (!fs.existsSync(exe)) return res.status(404).json({ ok:false, message:'SecureLink Windows app is missing from this deployment.' });
  const actual = crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
  if (actual !== SECURELINK_HELPER_SHA256) return res.status(409).json({ ok:false, message:'SecureLink Windows app checksum mismatch. Redeploy the complete verified package.' });
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/vnd.microsoft.portable-executable');
  res.setHeader('X-SecureLink-Build', 'CC26_661');
  res.setHeader('X-Content-SHA256', actual);
  return res.download(exe, 'Career Crox SecureLink.exe');
});

app.use('/generated',requireAuth,(req,res,next)=>['manager','admin'].includes(req.user.role)?next():res.status(403).json({message:'Only the manager can download CRM files.'}),express.static(GENERATED_DIR));

// CC26_459: compress the large immutable CRM JS/CSS assets without adding a package
// dependency or extra .br/.gz files. This cuts first-load egress and lets the UI boot
// much faster on Render. Compressed buffers are cached in process memory by mtime.
const compressedAssetCache = new Map();
function compressionKind(req = {}) {
  const value = String(req.headers?.['accept-encoding'] || '').toLowerCase();
  if (value.includes('br')) return 'br';
  if (value.includes('gzip')) return 'gzip';
  return '';
}
function mimeForAsset(filePath = '') {
  const ext = path.extname(filePath).toLowerCase();
  return ({ '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' })[ext] || 'application/octet-stream';
}
function compressedSpaAsset(req, res, next) {
  const pathname = String(req.path || '').replace(/^\/+/, '');
  if (!/\.(?:js|css|json|svg)$/i.test(pathname)) return next();
  const encoding = compressionKind(req);
  if (!encoding) return next();
  const filePath = path.resolve(SPA_DIR, pathname);
  const spaRoot = path.resolve(SPA_DIR);
  if (!(filePath === spaRoot || filePath.startsWith(`${spaRoot}${path.sep}`))) return next();
  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) return next();
    const cacheKey = `${filePath}:${stat.mtimeMs}:${stat.size}:${encoding}`;
    const cached = compressedAssetCache.get(cacheKey);
    const send = (buffer) => {
      staticCacheControl(req, res, () => {});
      res.setHeader('Content-Type', mimeForAsset(filePath));
      res.setHeader('Content-Encoding', encoding);
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Content-Length', String(buffer.length));
      res.status(200).end(buffer);
    };
    if (cached) return send(cached);
    fs.readFile(filePath, (readError, input) => {
      if (readError) return next();
      const done = (error, output) => {
        if (error || !output) return next();
        compressedAssetCache.set(cacheKey, output);
        // Keep memory bounded across deploys / file changes.
        if (compressedAssetCache.size > 32) {
          const first = compressedAssetCache.keys().next().value;
          if (first) compressedAssetCache.delete(first);
        }
        return send(output);
      };
      if (encoding === 'br') {
        return zlib.brotliCompress(input, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }, done);
      }
      return zlib.gzip(input, { level: 6 }, done);
    });
  });
}
// SecureLink has its own lightweight page so existing CRM SPA assets remain unchanged.
app.get(['/securelink', '/securelink/', '/securelink/index.html'], requireAuth, requireStrongAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-SecureLink-Build', 'CC26_642');
  return res.sendFile(path.join(SPA_DIR, 'securelink', 'index.html'));
});

if (fs.existsSync(SPA_DIR)) app.use(compressedSpaAsset, staticCacheControl, express.static(SPA_DIR));
// Never return index.html for a missing JS/CSS/image asset. That MIME mismatch used to
// leave browsers sitting forever on the boot placeholder.
app.use('/assets', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(404).type('text/plain').send('CRM asset not found. Deploy the complete current Career Crox package.');
});

app.use('/api', apiRoutes);

app.get('*', (req, res, next) => {
  const indexFile = path.join(SPA_DIR, 'index.html');
  if (fs.existsSync(indexFile)) { res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate'); res.setHeader('Pragma', 'no-cache'); res.setHeader('Expires', '0'); return res.sendFile(indexFile); }
  return res.send('Backend ready. Build frontend to /public/spa for full app.');
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
