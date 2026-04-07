const caches = new Set();

function createTimedCache(defaultTtlMs = 3000) {
  const map = new Map();
  caches.add(map);
  return {
    get(key, ttlMs = defaultTtlMs) {
      const hit = map.get(key);
      if (!hit) return null;
      if ((Date.now() - hit.at) > ttlMs) {
        map.delete(key);
        return null;
      }
      return hit.value;
    },
    set(key, value) {
      map.set(key, { at: Date.now(), value });
      return value;
    },
    clear() {
      map.clear();
    },
    delete(key) {
      map.delete(key);
    },
  };
}

function clearAllCaches() {
  caches.forEach((cache) => cache.clear());
}

module.exports = { createTimedCache, clearAllCaches };
