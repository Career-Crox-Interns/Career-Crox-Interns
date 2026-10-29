const {store}=require('./store');
const {createTimedCache}=require('./cache');
const cache=createTimedCache(300000,{tags:['schema']});
async function projection(tableName,alias,fields){
 if(!/^[a-z_]+$/.test(tableName)||!/^[a-z_]+$/.test(alias))throw Error('Invalid SQL projection');
 const columns=await cache.load(tableName,async()=>new Set((await store.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1",[tableName])).map(r=>r.column_name)));
 return fields.map(f=>{if(!/^[a-z_]+$/.test(f))throw Error('Invalid field');return columns.has(f)?`${alias}."${f}"`:`''::text as "${f}"`}).join(',');
}
module.exports={projection};
