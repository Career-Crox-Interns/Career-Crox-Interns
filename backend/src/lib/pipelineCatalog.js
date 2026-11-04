// CC871: defaults for NEW interview attempts. Existing financial rows stay intact.
const clean=value=>String(value||'').replace(/\s+/g,' ').trim();
const key=value=>clean(value).toLowerCase().replace(/[^a-z0-9]/g,'');
const CLIENTS=[
 {name:'1Point1',aliases:['1.1','1point1'],locations:['Gurgaon Sector 18','Mumbai','Turbhe, Navi Mumbai','Indore']},
 {name:'Globiva',locations:['Gurgaon Sector 18']},
 {name:'Vertex Group',aliases:['Vertex'],locations:['Gurgaon Sector 20']},
 {name:'Cogent',locations:['Gurgaon Sector 18','Noida Sector 127']},
 {name:'iEnergizer',aliases:['Ironizer','Ienergizer'],locations:['Noida Sector 60']},
 {name:'Eureka',locations:['Noida Sector 62']},
 {name:'Alturist',aliases:['Altruist'],locations:['Noida Sector 127','Noida Sector 6','Panchkula']},
];
function resolveClient(name){return CLIENTS.find(c=>[c.name,...(c.aliases||[])].some(n=>key(n)===key(name)));}
function terms(client,location='',process=''){
 const name=resolveClient(client)?.name||clean(client);
 const ninety=name==='Vertex Group'||name==='Alturist'&&!!clean(location)&&!key(location).includes('noidasector127');
 const amount=name==='Eureka'||key(process).includes('razorpay')||name==='1Point1'&&key(location)==='indore'?4000:5000;
 return {client_name:name,payout_amount:amount,payout_days:ninety?90:60,payout_duration_days:ninety?90:60,invoice_lead_days:1};
}
function catalog(config={}){
 const extras=config.client_catalog||[];
 return CLIENTS.map(c=>({...c,locations:[...new Set([...c.locations,...(extras.find(e=>key(e.name)===key(c.name))?.locations||[])])]})).concat(extras.filter(c=>!resolveClient(c.name)).map(c=>({name:clean(c.name),locations:(c.locations||[]).map(clean).filter(Boolean)})));
}
module.exports={CLIENTS,clean,key,resolveClient,terms,catalog};
