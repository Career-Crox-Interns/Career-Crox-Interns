const app = require('./app');
const { PORT, HOST } = require('./config/env');
const { mode, store } = require('./lib/store');
const { bootstrapIfNeeded } = require('./lib/bootstrap');

let bootstrapState = {
  startedAt: new Date().toISOString(),
  status: 'starting',
  mode,
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
});

if (store?.pool?.on) {
  store.pool.on('error', (err) => {
    console.error('Postgres pool error:', err);
  });
}

async function start() {
  const server = app.listen(PORT, HOST, () => {
    const address = server.address();
    console.log(`Career Crox Node backend running on ${HOST}:${PORT} in ${mode} mode`);
    console.log('Listening address:', address);
  });

  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.requestTimeout = 30000;

  server.on('error', (err) => {
    console.error('Server listen error:', err);
    process.exit(1);
  });

  try {
    updateBootstrap({ status: 'bootstrapping' });
    await bootstrapIfNeeded();
    updateBootstrap({ status: 'ready', readyAt: new Date().toISOString() });
    console.log('Bootstrap completed successfully');
  } catch (err) {
    updateBootstrap({ status: 'error', error: err?.message || String(err) });
    console.error('Bootstrap failed after port bind:', err);
  }
}

start().catch((err) => {
  console.error('Startup failed:', err);
  process.exit(1);
});
