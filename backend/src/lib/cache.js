const caches = new Set();
function createTimedCache(defaultTtlMs = 3000, options = {}) {
  const map=new Map(), pending=new Map();
  const maxEntries=Math.max(1,Number(options.maxEntries)||256);
  const cache={
    tags:new Set(options.tags||[]),
    get(key,ttlMs=defaultTtlMs){const hit=map.get(key);if(!hit)return null;if(Date.now()-hit.at>ttlMs){map.delete(key);return null;}map.delete(key);map.set(key,hit);return hit.value;},
    set(key,value){map.delete(key);map.set(key,{at:Date.now(),value});while(map.size>maxEntries)map.delete(map.keys().next().value);return value;},
    async load(key,loader,ttlMs=defaultTtlMs){const hit=cache.get(key,ttlMs);if(hit!==null)return hit;if(pending.has(key))return pending.get(key);const work=Promise.resolve().then(loader).then(value=>pending.get(key)===work?cache.set(key,value):value).finally(()=>{if(pending.get(key)===work)pending.delete(key);});pending.set(key,work);return work;},
    clear(){map.clear();pending.clear();},delete(key){map.delete(key);pending.delete(key);},get size(){return map.size;}
  };caches.add(cache);return cache;
}
function registerCache(cache){if(cache&&typeof cache.clear==='function')caches.add(cache);return cache;}
function clearAllCaches(tags){const wanted=tags?new Set(Array.isArray(tags)?tags:[tags]):null;for(const cache of caches){if(wanted&&cache.tags?.size&&![...cache.tags].some(tag=>wanted.has(tag)))continue;try{cache.clear();}catch{}}}
module.exports={createTimedCache,registerCache,clearAllCaches};

// Bounded, commit-aware delta snapshots. Never create database rows or polling loops.
function createDeltaReader(options={}){
 const map=new Map(),pending=new Map(),max=options.maxEntries||12,budget=options.maxBytes||16*1024*1024;
 const c={tags:new Set(['reset']),clear(){map.clear();pending.clear()},async load(key,read,idOf){
  if(pending.has(key))return pending.get(key);
  const old=map.get(key),started=Date.now();
  const work=Promise.resolve().then(()=>read(old?{since:new Date(old.at-120000).toISOString(),ids:[...old.rows.keys()]}:null)).then(rows=>{
   const merged=new Map(old?.rows||[]),sizes=new Map(old?.sizes||[]);let bytes=old?.bytes||0;for(const row of rows){const id=String(idOf(row)||'');if(id){bytes-=sizes.get(id)||0;const size=Buffer.byteLength(JSON.stringify(row));bytes+=size;sizes.set(id,size);merged.set(id,row)}}
   if(pending.get(key)===work&&merged.size<=50000&&bytes<=budget){map.delete(key);map.set(key,{at:started,rows:merged,sizes,bytes});while(map.size>max||[...map.values()].reduce((n,x)=>n+x.bytes,0)>budget)map.delete(map.keys().next().value)}
   return [...merged.values()];
  }).finally(()=>{if(pending.get(key)===work)pending.delete(key)});pending.set(key,work);return work;
 }};registerCache(c);return c;
}
module.exports.createDeltaReader=createDeltaReader;
