// CC919: fixed IST night window. Expiry is computed from the last real activity,
// so changing to the daytime limit at 09:00 cannot revive an expired night session.
const {canonicalRole}=require('./accessRules');
const MINUTE=60000,DAY=86400000,IST=19800000;
function isNight(at=Date.now()){const h=new Date(at+IST).getUTCHours();return h>=21||h<9;}
function dayMinutes(user={}){const role=canonicalRole(user.role,user.designation);return ['manager','admin'].includes(role)?60:role==='tl'?30:10;}
function inactivityMinutes(user={},at=Date.now()){return isNight(at)?10:dayMinutes(user);}
function inactivityMs(user={},at=Date.now()){return inactivityMinutes(user,at)*MINUTE;}
function expiryInfo(last,user={}){
 const at=Number(last)||0;if(!at)return {dueAt:0,night:false};
 const shifted=new Date(at+IST),day=Date.UTC(shifted.getUTCFullYear(),shifted.getUTCMonth(),shifted.getUTCDate())-IST;
 const h=shifted.getUTCHours(),start=h<9?day-3*60*MINUTE:day+21*60*MINUTE,end=start+12*60*MINUTE;
 const normal=at+dayMinutes(user)*MINUTE,night=Math.max(start,at+10*MINUTE);
 return night<=end&&night<=normal?{dueAt:night,night:true}:{dueAt:normal,night:false};
}
const deadline=(last,user={})=>expiryInfo(last,user).dueAt;
const expired=(last,user={},now=Date.now())=>Boolean(last&&deadline(last,user)<=now);
function nextMorning(at=Date.now()){const d=new Date(at+IST),day=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())-IST;return day+9*60*MINUTE+(d.getUTCHours()>=9?DAY:0);}
function activityAt(req,now=Date.now()){
 const ageRaw=req.get?.('x-career-crox-activity-age-ms')??req.headers?.['x-career-crox-activity-age-ms'];
 if(ageRaw!==undefined&&ageRaw!==null&&String(ageRaw).trim()!==''){const age=Number(ageRaw);if(Number.isFinite(age)&&age>=0&&age<=90000)return now-age;return 0;}
 const stamp=Number(req.get?.('x-career-crox-last-activity-at')||req.headers?.['x-career-crox-last-activity-at']||0);
 return Number.isFinite(stamp)&&stamp>0&&Math.abs(now-stamp)<=90000?Math.min(now,stamp):0;
}
module.exports={isNight,dayMinutes,inactivityMinutes,inactivityMs,expiryInfo,deadline,expired,nextMorning,activityAt};
