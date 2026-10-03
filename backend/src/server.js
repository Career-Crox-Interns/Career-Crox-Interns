const { PORT, HOST } = require('./config/env');
const BASIC_CRM_MODE = String(process.env.BASIC_CRM_MODE || 'true').toLowerCase() !== 'false';

let bootstrapState = {
  startedAt: new Date().toISOString(),
  status: 'starting',
  mode: 'loading',
  error: null,
};

global.__CAREER_CROX_BOOTSTRAP__ = bootstrapState;

function updateBootstrap(patch) {
  bootstrapState = { ...bootstrapState, ...patch };
  global.__CAREER_CROX_BOOTSTRAP__ = bootstrapState;
}

process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  setTimeout(() => process.exit(1), 50).unref?.();
});

let app;
try {
  app = require('./app');
} catch (error) {
  console.error('Main app load failed before listen. Starting emergency health server:', error);
  updateBootstrap({ status: 'app_load_error', error: error?.message || String(error) });
  const express = require('express');
  app = express();
  app.get(['/health', '/healthz', '/api/health'], (req, res) => res.status(503).json({ ok: false, service: 'career-crox', status: 'app-load-error', error: bootstrapState.error }));
  app.use((req, res) => res.status(503).json({ ok: false, message: 'App failed to load. Check Render logs.', error: bootstrapState.error }));
}

// CC26_620: ARIA 09:00–21:00 IST office shift only. No overnight timer wakeups,
// HTTP calls or database reads. Inactive/logged-out employees remain in their
// scheduled daytime report with real per-window metrics (including zeros).
const GRACE = 12000;
let started = false;
let timer = null;
let inFlight = null;
const ariaShift = () => require('./controllers/semiHourlyController');
const hasHuman = () => require('./lib/recentHumanActivity').hasRecentHumanActivity();
let savedShiftLoaded = false;
async function attempt(run = null, retryAllowed = true) {
  if (inFlight) return inFlight;
  // All employees offline: no settings, candidate, call, chat or report table reads.
  if (!hasHuman()) return { ok: true, aria: { skipped: true, reason: 'All CRM users offline; no database reads.' } };
  if (!savedShiftLoaded) { await ariaShift().loadPersistedAriaShift(); savedShiftLoaded = true; }
  const slot = ariaShift().ariaShiftSlot();
  if (!slot) return { ok: true, aria: { skipped: true, reason: 'ARIA outside 09:00–21:00 IST report slots.' } };
  const runner = run || ariaShift().runAutomaticManagerSnapshots;
  inFlight = Promise.resolve().then(() => runner()).then((result) => {
    if (result?.aria?.skipped) console.log('ARIA: outside office shift; skipped with zero DB reads.');
    else if (result?.aria?.ok) console.log(`ARIA 30-minute office report posted for ${result.aria.period_key}.`);
    else console.warn('ARIA office report pending retry:', result?.aria?.error || 'No confirmation.');
    return result;
  }).catch((error) => {
    console.error('ARIA report error:', error?.message || error);
    return { ok: false, error: error?.message || String(error) };
  }).then((result) => {
    // At most ONE retry, only for this eligible daytime window. Never retry
    // after the evening cutoff or start new night-time database requests.
    if (!result?.ok && retryAllowed) {
      const retry = setTimeout(() => {
        if (ariaShift().ariaShiftSlot()?.period === slot.period) void attempt(run, false);
      }, 10000);
      retry.unref?.();
    }
    return result;
  }).finally(() => { inFlight = null; });
  return inFlight;
}
function startAriaHalfHourlyScheduler({ now = () => Date.now(), setTimer = setTimeout, run = null } = {}) {
  if (started) return;
  started = true;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    // Schedule only the next allowed office slot; skip the whole night in ONE
    // local timer rather than waking every half hour to query or check status.
    timer = setTimer(async () => {
      schedule(); // anchored to IST clock, not to slow DB queries
      await attempt(run);
    }, ariaShift().ariaShiftNextDelay(now()));
    timer?.unref?.();
  };
  global.__CC622_RESCHEDULE_ARIA__ = schedule;
  schedule();
  // Cold starts can recover only a just-due office-shift report. No overnight
  // catch-up after a cold start and no report for an unfinished half-hour.
  const startup = setTimer(() => { if (ariaShift().ariaShiftSlot()) void attempt(run); }, GRACE);
  startup?.unref?.();
}

async function start() {
  const server = app.listen(PORT, HOST, () => {
    const address = server.address();
    console.log(`Career Crox Node backend listening on ${HOST}:${PORT}`);
    console.log('Listening address:', address);
    updateBootstrap({ status: 'listening', listeningAt: new Date().toISOString() });
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.requestTimeout = 30000;

  server.on('error', (err) => {
    console.error('Server listen error:', err);
    process.exit(1);
  });

  let storeModule = null;
  try {
    storeModule = require('./lib/store');
    updateBootstrap({ mode: storeModule.mode || 'unknown' });
    if (storeModule.store?.pool?.on) {
      storeModule.store.pool.on('error', (err) => {
        console.error('Postgres pool error:', err);
      });
    }
  } catch (error) {
    updateBootstrap({ status: 'store_load_error', error: error?.message || String(error) });
    console.error('Store load failed after port bind:', error);
    return;
  }

  // ARIA office shift 09:00–21:00 IST only. The final 20:30–21:00
  // report is scheduled at 21:00:12 IST. Render sleep can delay/skip a slot;
  // an always-on worker is required for strict 30-minute delivery.
  try {
    // Do not read Supabase settings merely because Render started.
    if (!BASIC_CRM_MODE) startAriaHalfHourlyScheduler();
  } catch (error) {
    console.error('ARIA scheduler init failed:', error?.message || error);
  }

  const shouldBootstrapOnStart = BASIC_CRM_MODE || String(process.env.BOOTSTRAP_ON_START || 'false').toLowerCase() === 'true';
  if (!shouldBootstrapOnStart) {
    updateBootstrap({ status: 'ready', readyAt: new Date().toISOString(), skipped: true, mode: storeModule.mode || 'unknown' });
    console.log('Bootstrap skipped: no database touch on cold start. Run SUPABASE SQL once; schema checks happen only when a logged-in user opens a feature.');
    return;
  }

  try {
    updateBootstrap({ status: 'bootstrapping', mode: storeModule.mode || 'unknown' });
    const { bootstrapIfNeeded } = require('./lib/bootstrap');
    await bootstrapIfNeeded();
    updateBootstrap({ status: 'ready', readyAt: new Date().toISOString(), mode: storeModule.mode || 'unknown' });
    console.log('Bootstrap completed successfully');
  } catch (err) {
    updateBootstrap({ status: 'error', error: err?.message || String(err), mode: storeModule.mode || 'unknown' });
    console.error('Bootstrap failed after port bind:', err);
  }
}

start().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
