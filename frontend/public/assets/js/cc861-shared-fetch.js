(function(){
 'use strict';if(window.__cc861SharedFetch)return;window.__cc861SharedFetch=true;
 const native=window.fetch.bind(window),prefix='cc861-shared-read:',epochKey='cc861-shared-epoch';
 const safeRead=key=>{try{return localStorage.getItem(key)||''}catch{return ''}};
 const epoch=()=>safeRead(epochKey)||'0';
 function principal(){try{const u=JSON.parse(safeRead('careerCroxCachedUser')||'{}');if(!u.user_id)return '';return JSON.stringify([u.user_id,u.role,u.team_id,u.recruiter_code,safeRead('careerCroxSessionLoginAt'),epoch(),window.__CC875_DASHBOARD_KEY__?.()||'overview',window.__CC875_POPUP_SETTINGS__?.().managerTeamPopups!==false])}catch{return ''}}
 function clear(){try{localStorage.setItem(epochKey,Date.now()+':'+Math.random());for(const key of Object.keys(localStorage))if(key.startsWith(prefix))localStorage.removeItem(key)}catch{}}
 ['career-crox-access-changed','career-crox-team-changed','career-crox-auth-changed','cc875-dashboard-changed'].forEach(e=>window.addEventListener(e,clear));
 window.fetch=async function(input,init={}){
  let url;try{url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href)}catch{return native(input,init)}
  const method=String(init.method||input?.method||'GET').toUpperCase();
  if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return native(input,init);
  if(!['GET','HEAD','OPTIONS'].includes(method)){const response=await native(input,init);if(response.ok)clear();return response}
  const id=principal();if(init.cache==='reload')return native(input,init);if(method!=='GET'||!id||!navigator.locks||!/^\/api\/(?:reports\/reminder-summary|submissions(?:\/review-summary)?|approvals\/(?:pending|summary|submission-review))$/.test(url.pathname))return native(input,init);
  [...url.searchParams.keys()].filter(k=>/^(fresh|_cc\d+|_refresh|_ts|ts|cacheBust)$/.test(k)).forEach(k=>url.searchParams.delete(k));url.searchParams.sort();
  const key=prefix+id+':'+url.pathname+url.search,stamp=epoch();
  const fromCache=()=>{try{const c=JSON.parse(safeRead(key)||'null');if(c&&c.principal===id&&Date.now()-c.at<2500)return new Response(c.body,{status:200,headers:{'Content-Type':'application/json','X-CC861-Shared':'1'}})}catch{}return null};
  return navigator.locks.request(key,{mode:'exclusive',signal:init.signal},async()=>{
   const hit=fromCache();if(hit)return hit;
   const response=await native(input,init);if(response.ok&&epoch()===stamp&&principal()===id){const body=await response.clone().text();if(body.length<160000){try{const keys=Object.keys(localStorage).filter(k=>k.startsWith(prefix));while(keys.length>=8)localStorage.removeItem(keys.shift());localStorage.setItem(key,JSON.stringify({body,at:Date.now(),principal:id}))}catch{}}}return response;
  });
 };
})();
