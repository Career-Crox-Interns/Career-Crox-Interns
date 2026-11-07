import React,{useEffect,useState} from 'react';
import {api} from '../lib/api';
export default function DuplicatePhoneNotice({phone,candidateId}){
 const [message,setMessage]=useState('');useEffect(()=>{let active=true;const digits=String(phone||'').replace(/\D/g,'');setMessage('');if(![10,11,12].includes(digits.length))return;const timer=setTimeout(()=>{const params=new URLSearchParams({phone:String(phone),except_id:candidateId==='new'?'':candidateId||''});api.get('/api/profile-safety/duplicate-phone?'+params,{cacheTtlMs:5000}).then(d=>{if(active)setMessage(d.message||'')}).catch(()=>{});},400);return()=>{active=false;clearTimeout(timer)}},[phone,candidateId]);
 return message?<div role="alert" style={{padding:'10px 14px',margin:'10px 0',background:'#fff0dd',border:'1px solid #e4a74c',borderRadius:12,color:'#743a09',fontSize:13,fontWeight:650}}>{message}</div>:null;
}
