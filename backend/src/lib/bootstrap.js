const { store, mode } = require('./store');
const { ensureDefaultSettings } = require('./settings');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bootstrapIfNeeded() {
  if (mode !== 'postgres' || !store.pool) return;

  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await store.pool.query('select 1 as ok');
      await ensureDefaultSettings();
      return;
    } catch (error) {
      lastError = error;
      console.error(`Bootstrap attempt ${attempt} failed:`, error?.message || error);
      if (attempt < 4) await wait(1200 * attempt);
    }
  }

  throw lastError;
}

module.exports = { bootstrapIfNeeded };
