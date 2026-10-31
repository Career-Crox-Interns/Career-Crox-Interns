import { cachePrincipal } from './api';
const MAX_CACHE_AGE_MS = 12 * 60 * 60 * 1000;
// CC132: ephemeral in-tab LRU. Account + dashboard scope remain in every key.
const parsedMemory = new Map();
const MAX_MEMORY_ENTRIES=48;
function remember(key,value){
  parsedMemory.delete(key);parsedMemory.set(key,value);
  while(parsedMemory.size>MAX_MEMORY_ENTRIES)parsedMemory.delete(parsedMemory.keys().next().value);
  return value;
}


function now() {
  return Date.now();
}

function parseStored(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, 'data')) {
      const age = now() - Number(parsed.cachedAt || 0);
      if (Number.isFinite(age) && age >= 0 && age <= MAX_CACHE_AGE_MS) return parsed.data;
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function matchesFallbackShape(value, fallback) {
  if (Array.isArray(fallback)) return Array.isArray(value);
  if (fallback && typeof fallback === 'object') return value && typeof value === 'object' && !Array.isArray(value);
  return true;
}

export function readPageCache(key, fallback = null) {
  if (!key || typeof window === 'undefined') return fallback;
  key = `${cachePrincipal()}:${key}`;
  if(parsedMemory.has(key)){
    const saved=parsedMemory.get(key);
    if(matchesFallbackShape(saved.data,fallback) && now()-saved.at<=MAX_CACHE_AGE_MS) return saved.data;
    parsedMemory.delete(key);
  }
  const storages = [window.sessionStorage, window.localStorage].filter(Boolean);
  for (const storage of storages) {
    try {
      const value = parseStored(storage.getItem(key));
      if (value !== null && value !== undefined && matchesFallbackShape(value, fallback)) return remember(key,{data:value,at:now()}).data;
    } catch {}
  }
  return fallback;
}

export function writePageCache(key, data) {
  if (!key || typeof window === 'undefined') return;
  key = `${cachePrincipal()}:${key}`;
  remember(key,{data,at:now()});
  try {
    const payload = JSON.stringify({ cachedAt: now(), data });
    try { window.sessionStorage.setItem(key, payload); } catch {}
  } catch {}
}

window.addEventListener('storage',event=>{if(event.key===null||event.key?.startsWith(cachePrincipal()+':'))parsedMemory.clear();});
window.addEventListener('career-crox-access-changed',()=>{parsedMemory.clear();const prefix=cachePrincipal()+':';for(const storage of [window.sessionStorage,window.localStorage])for(const key of Object.keys(storage))if(key.startsWith(prefix))try{storage.removeItem(key);}catch{}});
