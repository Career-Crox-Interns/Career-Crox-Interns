import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const CITIES = ['Navi Mumbai','Greater Noida','New Delhi','Delhi NCR','Gurgaon','Gurugram','Noida','Pune','Mumbai','Bangalore','Bengaluru','Chennai','Hyderabad','Kolkata','Kanpur','Lucknow','Jaipur','Ahmedabad','Indore','Bhopal','Nagpur','Thane','Ghaziabad','Faridabad','Chandigarh','Mohali','Patna','Ranchi','Surat','Vadodara','Nashik','Meerut','Agra','Varanasi','Prayagraj','Allahabad','Gorakhpur','Dehradun','Kochi','Coimbatore','Mysore','Mysuru','Visakhapatnam','Vijayawada','Bhubaneswar','Raipur','Jabalpur','Gwalior','Bareilly','Aligarh','Moradabad','Jamshedpur','Guwahati'];
const LABELS = [
  ['ignore','preferred\\s*(?:job\\s*)?location|job\\s*location|qualification|experience|salary|ctc|age|gender|date\\s*of\\s*birth|dob|process|notice\\s*period|recruiter(?:\\s*name)?|father(?:s|\u2019s|\'s)?\\s*name'],
  ['full_name','candidate\\s*(?:full\\s*)?name|full\\s*name|name|नाम'],
  ['phone','(?:calling|contact|mobile|phone|whatsapp|telephone)(?:\\s*(?:phone|mobile))?(?:\\s*(?:number|no\\.?))?|number|मोबाइल|फोन'],
  ['location','current\\s*(?:city|location|address)|present\\s*(?:city|location|address)|residential\\s*address|location|city|address|शहर|स्थान|पता'],
  ['email','e[-\\s]?mail(?:\\s*(?:address|id))?|मेल'],
];
const LABEL_PATTERN = LABELS.map(([,pattern])=>`(?:${pattern})`).join('|');
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?<!\d)(?:(?:\+?91|0091|0)[\s().-]*)?[6-9](?:[\s().-]*\d){9}(?!\d)/g;
const clean = value => String(value || '').replace(/^[\s:：=|,;•–—-]+|[\s|,;•]+$/g,'').trim();
const nameValue = value => {
  const name=clean(value).replace(/^(?:mr|mrs|ms|miss|dr)\.?\s+/i,'').split(/\r?\n/)[0].trim();
  if(!name||name.length>90||name.includes('@')||/\d/.test(name)||!/^\p{L}[\p{L}\p{M}\s.'’\-]*$/u.test(name)||name.split(/\s+/).length>6)return '';
  return name;
};
const phoneValue = value => {
  const match=String(value||'').match(PHONE)?.[0];
  if(!match)return '';
  const number=match.replace(/\D/g,'').slice(-10);
  return /^[6-9]\d{9}$/.test(number)?number:'';
};

// Local, bounded extraction: no API call, candidate save, or clipboard read.
export function extractContactDetails(raw) {
  const text=String(raw||'').slice(0,20000).replace(/[०-९]/g,c=>String(c.charCodeAt(0)-0x0966)).replace(/[\u200b-\u200d\ufeff]/g,'').replace(/\u00a0/g,' ').replace(/[*`]/g,'');
  const labelled={};
  const pattern=new RegExp(`(?:^|[\\n|;,]|\\s)(${LABEL_PATTERN})\\s*(?::|：|=|[-–—](?=\\s))\\s*`,'gimu');
  const matches=[...text.matchAll(pattern)];
  for(let i=0;i<matches.length;i++){
    const match=matches[i],kind=LABELS.find(([,part])=>new RegExp(`^(?:${part})$`,'iu').test(match[1]))?.[0];
    if(!kind||kind==='ignore')continue;
    const value=clean(text.slice(match.index+match[0].length,matches[i+1]?.index??text.length).split(/\r?\n/)[0]);
    if(value&&!labelled[kind])labelled[kind]=value;
  }
  const lines=text.split(/\r?\n/).map(clean).filter(Boolean);
  for(let i=0;i<lines.length-1;i++)for(const [kind,part] of LABELS){
    if(kind!=='ignore'&&!labelled[kind]&&new RegExp(`^(?:${part})\\s*[:：=]?$`,'iu').test(lines[i]))labelled[kind]=lines[i+1];
  }
  const values={};
  const email=(labelled.email?.match(EMAIL)||text.match(EMAIL))?.[0];if(email)values.email=email;
  const phone=phoneValue(labelled.phone)||phoneValue(text);if(phone)values.phone=phone;
  let location=clean(labelled.location).slice(0,100);
  if(!location){
    const source=lines.filter(line=>!/^preferred\s*(?:job\s*)?location\b|^job\s*location\b/i.test(line)).join('\n');
    const city=CITIES.find(city=>new RegExp(`(?:^|[^a-z])${city.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?=$|[^a-z])`,'i').test(source));
    location=city||'';
  }
  if(location&&!EMAIL.test(location)&&!phoneValue(location))values.location=location;
  let name=nameValue(labelled.full_name);
  if(!name){
    const natural=text.match(/(?:my\s+name\s+is|मेरा\s+नाम)\s+([^\n,;|:]+)/iu);
    if(natural)name=nameValue(natural[1].replace(PHONE,'').replace(EMAIL,'').replace(/\s+(?:and|from|है)\b.*$/iu,''));
  }
  if(!name){
    const blocked=/\b(?:resume|curriculum|vitae|indeed|profile|candidate|contact|phone|mobile|email|location|address|qualification|graduate|experience|salary|support|executive|hiring|interested|looking|preferred|recruiter|university|college|bachelor|education)\b/i;
    for(const part of text.split(/[\r\n|;,\t]+/).slice(0,14)){
      let candidate=clean(part).replace(EMAIL,'').replace(PHONE,'').trim();
      if(values.location)candidate=candidate.replace(new RegExp(values.location.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'ig'),'').trim();
      if(!blocked.test(candidate)&&(name=nameValue(candidate)))break;
    }
  }
  if(name)values.full_name=name;
  return values;
}

export function freshCandidateUrl(){
  const token=globalThis.crypto?.randomUUID?.()||`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `/candidate/new?fresh=${encodeURIComponent(token)}`;
}

export default function ContactTextExtractor({onExtract,disabled=false}) {
  const [open,setOpen]=useState(false),[text,setText]=useState(''),[result,setResult]=useState('');
  const [position,setPosition]=useState({left:12,top:80,width:390});
  const wrap=useRef(null),popover=useRef(null),input=useRef(null),closeTimer=useRef(null);
  const place=()=>{
    const rect=wrap.current?.getBoundingClientRect();if(!rect)return;
    const width=Math.min(390,window.innerWidth-24);
    setPosition({width,left:Math.max(12,Math.min(window.innerWidth-width-12,rect.right-width)),top:Math.max(12,Math.min(rect.bottom,window.innerHeight-270))});
  };
  useEffect(()=>()=>clearTimeout(closeTimer.current),[]);
  useEffect(()=>{
    if(!open)return;
    const outside=e=>{if(!wrap.current?.contains(e.target)&&!popover.current?.contains(e.target))setOpen(false);};
    document.addEventListener('pointerdown',outside);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[open]);
  const fill=raw=>{
    const values=extractContactDetails(raw),count=Object.keys(values).length;
    if(count)onExtract(values);
    setResult(count?`${count} ${count===1?'field':'fields'} filled`:'No contact details found.');
  };
  const show=()=>{if(disabled)return;clearTimeout(closeTimer.current);place();setOpen(true);};
  const stay=()=>clearTimeout(closeTimer.current);
  const leave=()=>{closeTimer.current=setTimeout(()=>{if(!wrap.current?.contains(document.activeElement)&&!popover.current?.contains(document.activeElement))setOpen(false);},160);};
  async function paste(){
    try{const raw=await navigator.clipboard.readText();setText(raw.slice(0,20000));fill(raw);}
    catch{setResult('Paste text in the box.');input.current?.focus();}
  }
  return <div ref={wrap} className="cc844-extract-wrap" onFocusCapture={()=>clearTimeout(closeTimer.current)} onKeyDown={e=>{if(e.key==='Escape'){setOpen(false);e.stopPropagation();}}}>
    <button type="button" className="ghost-btn file-action-btn cc844-extract-trigger" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} onClick={show} aria-label="Extract candidate details" title="Extract candidate details"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/><path d="m19 3 .6 1.4L21 5l-1.4.6L19 7l-.6-1.4L17 5l1.4-.6Z"/></svg><span className="cc129-sr">Extract details</span></button>
    {open&&!disabled&&createPortal(<div ref={popover} className="cc844-extract-hover" style={{'--cc844-extract-left':`${position.left}px`,'--cc844-extract-top':`${position.top}px`,'--cc844-extract-width':`${position.width}px`}} onFocusCapture={stay}><section className="cc844-extract-popover" role="dialog" aria-label="Extract candidate contact details">
      <header><strong>Extract Details</strong><button type="button" aria-label="Close extraction" onClick={()=>setOpen(false)}>×</button></header>
      <textarea ref={input} rows="5" maxLength={20000} value={text} aria-label="Candidate text" placeholder="Paste candidate text: name, number, location, email…" onChange={e=>setText(e.target.value)} onPaste={e=>fill(e.clipboardData.getData('text'))}/>
      <div className="cc844-extract-actions"><button type="button" onClick={paste}>Paste</button><button type="button" disabled={!text.trim()} onClick={()=>fill(text)}>Extract &amp; fill</button><span role="status">{result}</span></div>
    </section></div>,document.body)}
  </div>;
}
