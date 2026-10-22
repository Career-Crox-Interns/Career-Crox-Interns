'use strict';
const {store}=require('./store');
const {registerCache}=require('./cache');
const states=new Map(),pending=new Map();let bytes=0;
registerCache({tags:new Set(['reset','access','schema','staff']),clear(){states.clear();pending.clear();bytes=0;}});

// Compare actual selected values, including joins and filter membership. Old
// timestamps and physical removal cannot hide changes. Only differences transfer.
async function versionedList({key,select,from,where,params=[],id='candidate_id',idExpr='c.candidate_id',version=''}){
  if(!/^[a-z_]+$/.test(id))throw Error('Invalid row identity');
  const cacheKey=JSON.stringify([key,select,from,where,params,id,idExpr,version]);
  if(pending.has(cacheKey))return pending.get(cacheKey).then(value=>structuredClone(value));
  const work=Promise.resolve().then(async()=>{
    const old=states.get(cacheKey),rows=new Map(old?.rows||[]),hashes=new Map(old?.hashes||[]);
    const known=JSON.stringify(Object.fromEntries(hashes));let cursor='';
    for(;;){
      const p=[...params,known,cursor,250],n=params.length;
      const page=await store.query(!old ? `
        with source as (select ${select} from ${from} where (${where}) and $${n+1}::jsonb is not null and ${idExpr}>$${n+2} order by ${idExpr} limit $${n+3})
        select s."${id}"::text as row_id,md5(to_jsonb(s)::text) as row_hash,to_jsonb(s) as item,false as removed from source s` : `
        with source as materialized (select ${select} from ${from} where (${where})),
        current_rows as materialized (
          select s."${id}"::text as row_id,md5(to_jsonb(s)::text) as row_hash,to_jsonb(s) as item from source s
        ), known as materialized (select key as row_id,value as row_hash from jsonb_each_text($${n+1}::jsonb)),
        changes as (
          select c.row_id,c.row_hash,c.item,false as removed from current_rows c left join known k using(row_id)
          where c.row_hash is distinct from k.row_hash
          union all
          select k.row_id,null::text,null::jsonb,true from known k where not exists(select 1 from current_rows c where c.row_id=k.row_id)
        )
        select row_id,row_hash,item,removed from changes where row_id>$${n+2} order by row_id limit $${n+3}`,p);
      for(const row of page){
        const rowId=String(row.row_id);
        if(row.removed){rows.delete(rowId);hashes.delete(rowId);}
        else{rows.set(rowId,row.item);hashes.set(rowId,row.row_hash);}
      }
      if(page.length<250)break;cursor=String(page.at(-1).row_id);
    }
    const value=[...rows.values()],size=Buffer.byteLength(JSON.stringify(value))+Buffer.byteLength(JSON.stringify(Object.fromEntries(hashes)));
    if(pending.get(cacheKey)===work){
      bytes-=states.get(cacheKey)?.bytes||0;states.delete(cacheKey);
      if(size<32*1024*1024){states.set(cacheKey,{rows,hashes,bytes:size});bytes+=size;}
      while(states.size>48||bytes>32*1024*1024){const first=states.keys().next().value;bytes-=states.get(first).bytes;states.delete(first);}
    }
    return value;
  }).finally(()=>{if(pending.get(cacheKey)===work)pending.delete(cacheKey);});
  pending.set(cacheKey,work);return work.then(value=>structuredClone(value));
}
async function canonicalList(key,sql,params,version){
  const cut=sql.lastIndexOf('\n    where '),order=sql.lastIndexOf('\n    order by '),from=sql.indexOf('\n    from ');
  if(cut<0||from<0||order<cut)throw Error('Canonical query shape changed');
  return versionedList({key,select:sql.slice(sql.indexOf('select')+6,from),from:sql.slice(from+10,cut),where:sql.slice(cut+11,order),params,version});
}
module.exports={versionedList,canonicalList};

// Preserve SQL order while validating a page with only changed rows returned.
async function snapshotPage(sql,params,orderSql,key){
 const rows=await versionedList({key,select:'p.*',from:`(select q.*,row_number() over(${orderSql.trim()})::int as __cc_page_order from (${sql}) q) p`,where:'true',params,id:'candidate_id',idExpr:'p.candidate_id'});
 return rows.sort((a,b)=>a.__cc_page_order-b.__cc_page_order).map(({__cc_page_order,...row})=>row);
}
module.exports.snapshotPage=snapshotPage;
