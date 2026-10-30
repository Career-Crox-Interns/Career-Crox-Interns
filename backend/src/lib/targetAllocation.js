// Integer paise, deterministic sibling balancing and no negative allocations.
function role(user={}) { const v=String(user.role||user.designation||'').trim().toLowerCase();return v==='admin'?'manager':/team\s*lead|^tl$/.test(v)?'tl':v; }
function cents(value) { const n=Number(value);if(!Number.isFinite(n)||n<0||n>1e9)throw Object.assign(new Error('Enter an amount from 0 to 1,000,000,000.'),{status:400});const c=Math.round(n*100);if(Math.abs(n*100-c)>0.00001)throw Object.assign(new Error('Use at most two decimal places.'),{status:400});return c; }
function balance(values,total) {
  if(!Number.isSafeInteger(total)||total<0)throw Error('Invalid target total');
  const out=values.map(v=>Number.isSafeInteger(v)&&v>=0?v:0);if(!out.length)return out;
  let delta=total-out.reduce((s,v)=>s+v,0);
  if(delta>=0){const q=Math.floor(delta/out.length),r=delta%out.length;return out.map((v,i)=>v+q+(i<r?1:0));}
  let debt=-delta;
  while(debt>0){const active=out.map((v,i)=>v>0?i:-1).filter(i=>i>=0);if(!active.length)throw Error('Allocation underflow');const q=Math.floor(debt/active.length),r=debt%active.length;for(let k=0;k<active.length;k++){const i=active[k],cut=Math.min(out[i],q+(k<r?1:0));out[i]-=cut;debt-=cut;}}
  return out;
}
function buildFlow(roster,viewer,config,month,fallback=0,unit=100){
 const convert=unit===1?count:cents;
 const rootId=String(viewer.user_id),isManager=role(viewer)==='manager';
 const people=roster.filter(u=>String(u.user_id)===rootId||['tl','recruiter'].includes(role(u))).sort((a,b)=>String(a.user_id).localeCompare(String(b.user_id)));
 const byId=new Map(people.map(u=>[String(u.user_id),u]));if(!byId.has(rootId))byId.set(rootId,viewer);
 const nodes={};for(const [id,u] of byId)nodes[id]={id,name:u.full_name||u.username||'Team member',role:role(u),parent_id:null,children:[],amount_cents:0, fixed:false};
 for(const [id,u] of byId){if(id===rootId)continue;const parent=role(u)==='recruiter'&&nodes[String(u.tl_user_id)]?String(u.tl_user_id):rootId;if(!isManager&&parent!==rootId)continue;nodes[id].parent_id=parent;nodes[parent].children.push(id);}
 const saved=config.flow_budgets?.[month]||{},parents=config.flow_parents?.[month]||{},legacy=config.targets?.[month]||{};
 const hasBudget=id=>Number.isSafeInteger(saved[id])&&saved[id]>=0;
 for(const n of Object.values(nodes))n.fixed=Boolean(config.flow_fixed?.[month]?.[n.id]&&parents[n.id]===n.parent_id);
 const root=nodes[rootId];root.amount_cents=hasBudget(rootId)?saved[rootId]:convert(legacy[rootId]??fallback);
 const visit=n=>{const ids=n.children.sort();if(!ids.length)return;const same=ids.every(id=>parents[id]===n.id)&&Object.keys(parents).filter(id=>parents[id]===n.id).every(id=>ids.includes(id));const previous=ids.map(id=>hasBudget(id)?saved[id]:nodes[id].role==='tl'?convert(legacy[id]||0):0);const preserve=same||previous.reduce((sum,v)=>sum+v,0)===n.amount_cents;const fixed=ids.filter(id=>nodes[id].fixed),free=ids.filter(id=>!nodes[id].fixed),fixedSum=fixed.reduce((sum,id)=>sum+saved[id],0);if(fixedSum>n.amount_cents||(!free.length&&fixedSum!==n.amount_cents)){for(const id of ids)nodes[id].fixed=false;}const locked=ids.filter(id=>nodes[id].fixed),open=ids.filter(id=>!nodes[id].fixed),remaining=n.amount_cents-locked.reduce((sum,id)=>sum+saved[id],0),shares=balance(open.map(id=>preserve?previous[ids.indexOf(id)]:0),remaining);const amounts=ids.map(id=>nodes[id].fixed?saved[id]:shares[open.indexOf(id)]);ids.forEach((id,i)=>{nodes[id].amount_cents=amounts[i];visit(nodes[id]);});};
 visit(root);return {unit,month,root_id:rootId,revision:String(config.flow_revisions?.[month]||0),nodes:Object.values(nodes)};
}
function editFlow(flow,id,amount,{release=false}={}){
 const next=structuredClone(flow),map=new Map(next.nodes.map(n=>[n.id,n])),node=map.get(String(id));if(!node)throw Object.assign(new Error('Employee is outside this target flow.'),{status:403});
 if(release){node.fixed=false;return next;}
 const value=flow.unit===1?count(amount):cents(amount);
 const distribute=n=>{if(!n.children.length)return;const fixed=n.children.filter(k=>map.get(k).fixed),free=n.children.filter(k=>!map.get(k).fixed),held=fixed.reduce((v,k)=>v+map.get(k).amount_cents,0);if(held>n.amount_cents||(!free.length&&held!==n.amount_cents))throw Object.assign(new Error('Saved targets are fixed. Unlock a target or adjust the team total before redistributing the remaining amount.'),{status:409});const shares=balance(free.map(k=>map.get(k).amount_cents),n.amount_cents-held);free.forEach((k,i)=>map.get(k).amount_cents=shares[i]);for(const k of n.children)distribute(map.get(k));};
 node.amount_cents=value;if(node.parent_id){const parent=map.get(node.parent_id);if(value>parent.amount_cents)throw Object.assign(new Error('A member target cannot exceed the team total.'),{status:400});node.fixed=true;distribute(parent);}else distribute(node);
 assertBalanced(next);return next;
}
function assertBalanced(flow){const map=new Map(flow.nodes.map(n=>[n.id,n]));for(const n of flow.nodes){if(!Number.isSafeInteger(n.amount_cents)||n.amount_cents<0)throw Error('Invalid allocation');if(n.children.length&&n.children.reduce((s,id)=>s+map.get(id).amount_cents,0)!==n.amount_cents)throw Error('Target allocation mismatch');}return true;}
function saveFlow(config,flow){assertBalanced(flow);for(const key of ['flow_budgets','flow_parents','flow_revisions','flow_fixed','targets']){config[key]||={};if(key!=='flow_revisions')config[key][flow.month]||={};}for(const n of flow.nodes){config.flow_fixed[flow.month][n.id]=Boolean(n.fixed);config.flow_budgets[flow.month][n.id]=n.amount_cents;if(n.parent_id!==null||!config.flow_parents[flow.month][n.id])config.flow_parents[flow.month][n.id]=n.parent_id;if(n.role!=='recruiter')config.targets[flow.month][n.id]=n.amount_cents/(flow.unit||100);}config.flow_revisions[flow.month]=Number(flow.revision)+1;flow.revision=String(config.flow_revisions[flow.month]);return flow;}
function publicFlow(flow,entries=[]){const map=new Map(flow.nodes.map(n=>[n.id,n]));const month=flow.month;return {...flow,nodes:flow.nodes.map(n=>{const descendants=new Set([n.id]),walk=id=>{for(const child of map.get(id)?.children||[]){descendants.add(child);walk(child);}};walk(n.id);let earned=0,joined=0;for(const row of entries){if(!['joined','completed_60_days'].includes(String(row.status))||String(row.joined_date||'').slice(0,7)!==month)continue;if(n.id===flow.root_id&&n.role==='manager'||descendants.has(String(row.recruiter_user_id||''))){earned+=Math.round(Number(row.recognized_payout||0)*100);joined++;}}return {...n,amount:n.amount_cents/(flow.unit||100),earned:earned/100,joined,percent:n.amount_cents?Math.round(earned/n.amount_cents*1000)/10:0};})};}
module.exports={role,cents,balance,buildFlow,editFlow,assertBalanced,saveFlow,publicFlow};

function count(value){const n=Number(value);if(!Number.isSafeInteger(n)||n<0||n>1000000)throw Object.assign(new Error('Joining targets must be whole numbers from 0 to 1,000,000.'),{status:400});return n;}
function joiningConfig(config){return {flow_budgets:config.joining_flow_budgets||{},flow_parents:config.joining_flow_parents||{},flow_revisions:config.joining_flow_revisions||{},flow_fixed:config.joining_flow_fixed||{},targets:config.joining_targets||{}};}
function buildJoiningFlow(roster,viewer,config,month){return buildFlow(roster,viewer,joiningConfig(config),month,0,1);}
function saveJoiningFlow(config,flow){const projected=joiningConfig(config);saveFlow(projected,flow);config.joining_flow_budgets=projected.flow_budgets;config.joining_flow_parents=projected.flow_parents;config.joining_flow_revisions=projected.flow_revisions;config.joining_flow_fixed=projected.flow_fixed;config.joining_targets=projected.targets;for(const n of flow.nodes)config.joining_targets[flow.month][n.id]=n.amount_cents;return flow;}
function publicJoiningFlow(flow,entries){const out=publicFlow(flow,entries);return {...out,nodes:out.nodes.map(n=>({...n,amount:n.amount_cents,earned:n.joined,remaining:Math.max(0,n.amount_cents-n.joined),percent:n.amount_cents?Math.round(n.joined/n.amount_cents*1000)/10:0}))};}
module.exports.buildJoiningFlow=buildJoiningFlow;module.exports.saveJoiningFlow=saveJoiningFlow;module.exports.publicJoiningFlow=publicJoiningFlow;module.exports.count=count;
