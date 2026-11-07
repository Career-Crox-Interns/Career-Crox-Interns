'use strict';
// A completed details checklist can advance a candidate to interview-ready.
// It must never downgrade someone who has appeared, been selected, joined,
// backed out, or been rejected. Approval remains a separate workflow.
const readyStates = new Set(['','draft','in - progress','in-progress','approved','all set for interview']);
const clean = value => String(value || '').trim().toLowerCase();
function statusAfterDetailsCompletion(before, nextDetails, requestedStatus) {
  if (clean(nextDetails)!=='completed' || clean(before?.all_details_sent)==='completed') return null;
  if (!readyStates.has(clean(before?.status))) return null;
  if (!readyStates.has(clean(requestedStatus ?? before?.status))) return null;
  return 'All set for Interview';
}
module.exports = { statusAfterDetailsCompletion };


function completionPatch(before,user,input,timeAllowed){
 const role=clean(user?.role),stamp=new Date().toISOString();
 if(['manager','admin'].includes(role))return{details_review_status:'approved',details_review_note:'',details_review_by:String(user.user_id||''),details_review_at:stamp};
 if(role==='tl'){
  const note=String(input?.completion_note||input?._completion_note||'').trim();
  if(note.length<5)throw Object.assign(new Error('Add a completion reason (5+ characters) for Manager review.'),{status:400,code:'COMPLETION_NOTE_REQUIRED'});
  return{details_review_status:'pending',details_review_note:note.slice(0,2000),details_review_by:String(user.user_id||''),details_review_at:stamp};
 }
 if(!timeAllowed)throw Object.assign(new Error('All Details Sent can be marked completed only 10 minutes after submission.'),{status:400});
 return{};
}
module.exports.completionPatch=completionPatch;

