// One inactivity policy for browser auth, attendance locks, relogin and paired phones.
const {canonicalRole}=require('./accessRules');
function inactivityMinutes(user={}){const role=canonicalRole(user.role,user.designation);return ['manager','admin'].includes(role)?60:role==='tl'?30:10;}
function inactivityMs(user={}){return inactivityMinutes(user)*60000;}
function activityAt(req,now=Date.now()){
 const ageRaw=req.get?.('x-career-crox-activity-age-ms')??req.headers?.['x-career-crox-activity-age-ms'];
 if(ageRaw!==undefined&&ageRaw!==null&&String(ageRaw).trim()!==''){const age=Number(ageRaw);if(Number.isFinite(age)&&age>=0&&age<=90000)return now-age;return 0;}
 const stamp=Number(req.get?.('x-career-crox-last-activity-at')||req.headers?.['x-career-crox-last-activity-at']||0);
 return Number.isFinite(stamp)&&stamp>0&&Math.abs(now-stamp)<=90000?Math.min(now,stamp):0;
}
module.exports={inactivityMinutes,inactivityMs,activityAt};
