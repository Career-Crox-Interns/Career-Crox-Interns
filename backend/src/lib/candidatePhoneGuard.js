'use strict';
const {store,table}=require('./store');
const {normalizedPhone}=require('./candidateIdentityGuard');
const message='This number already belongs to a CRM profile. Ask Manager to review ownership.';
async function duplicate(phone,exceptId='',client=null){
 const key=normalizedPhone(phone);if(!key)return false;
 if(store.pool){const q=client||require('./store').activeTransactionClient()||store.pool;
  const result=await q.query('select candidate_id from public.candidates where public.crm_normalized_phone(phone)=$1 and candidate_id<>$2 limit 1',[key,exceptId]);
  return Boolean(result.rows?.length);
 }
 return (await table('candidates')).some(r=>String(r.candidate_id)!==String(exceptId)&&normalizedPhone(r.phone)===key);
}
async function assertUnique(phone,exceptId='',client=null){
 const key=normalizedPhone(phone);if(!key)return;
 if(store.pool&&client)await client.query('select pg_advisory_xact_lock(hashtext($1))',['cc861-phone:'+key]);
 if(await duplicate(phone,exceptId,client))throw Object.assign(new Error(message),{status:409,code:'DUPLICATE_PHONE'});
}
// CC868: normalize contact formatting without imposing a phone length limit.
function normalizePhoneInput(value) {
 let phone=String(value??'').normalize('NFKC').trim()
  .replace(/[\u0660-\u0669\u06F0-\u06F9\u0966-\u096F]/g,digit=>{
   const code=digit.charCodeAt(0);
   return String(code-(code>=0x0966?0x0966:code>=0x06F0?0x06F0:0x0660));
  })
  .replace(/[\s().\-\u2010-\u2015\u2212\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g,'');
 if(/^\+91[0-9]+$/.test(phone))phone=phone.slice(3);
 else if(/^91[0-9]{10}$/.test(phone))phone=phone.slice(2);
 return phone;
}
function validateInput(value,{required=false}={}){
 const digits=normalizePhoneInput(value);
 if(!digits&&!required)return '';
 if(!digits)throw Object.assign(new Error('Phone number is required.'),{status:400,code:'PHONE_REQUIRED'});
 if(!/^[0-9]+$/.test(digits))throw Object.assign(new Error('Phone number can contain digits only.'),{status:400,code:'INVALID_PHONE_FORMAT'});
 return digits;
}
module.exports={duplicate,assertUnique,message,validateInput,normalizeInput:normalizePhoneInput};
