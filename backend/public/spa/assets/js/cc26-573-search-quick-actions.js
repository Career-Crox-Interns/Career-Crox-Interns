(function(){
  const ACTION_KEY='careerCroxQuickSearchAction573';
  const SEARCH_CACHE_KEY='careerCroxSearchCache573';

  function qs(sel, root){ return (root||document).querySelector(sel); }
  function qsa(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }
  function sanitizePhone(v){
    let n=String(v||'').replace(/\D/g,'');
    while(n.length>10 && n.startsWith('91')) n=n.slice(2);
    if(n.length>10) n=n.slice(-10);
    return n;
  }
  function byText(els, pattern){ return (els||[]).find(el => pattern.test(String(el.textContent||'').trim())); }
  function pagePath(){ return String(location.pathname||''); }
  function isSearchRoute(){ return /^\/search(?:\/|$)/.test(pagePath()); }
  function isCandidateRoute(){ return /^\/candidate\//.test(pagePath()); }
  function markBody(){
    document.body.classList.toggle('cc573-search-route', isSearchRoute());
  }
  function iconSvg(kind){
    const map={
      call:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.62 10.79a15.46 15.46 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1-.24c1.12.37 2.33.56 3.59.56a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.3 21 3 13.7 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.26.19 2.47.56 3.59a1 1 0 0 1-.25 1.01l-2.19 2.19Z"/></svg>',
      whatsapp:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.52 3.48A11.76 11.76 0 0 0 12.06 0C5.58 0 .31 5.27.31 11.75c0 2.07.54 4.09 1.57 5.88L0 24l6.56-1.82a11.7 11.7 0 0 0 5.5 1.4h.01c6.47 0 11.75-5.27 11.75-11.75 0-3.14-1.23-6.09-3.3-8.35Zm-8.45 18.1h-.01a9.79 9.79 0 0 1-4.99-1.37l-.36-.21-3.89 1.08 1.04-3.79-.24-.39a9.77 9.77 0 0 1-1.5-5.15C2.12 6.35 6.66 1.8 12.06 1.8c2.61 0 5.07 1.02 6.92 2.88a9.7 9.7 0 0 1 2.86 6.93c0 5.4-4.37 9.97-9.77 9.97Zm5.36-7.38c-.29-.15-1.71-.84-1.97-.94-.27-.1-.46-.14-.66.14-.19.29-.76.94-.93 1.13-.17.2-.34.22-.63.07-.29-.15-1.21-.44-2.31-1.42-.86-.76-1.45-1.7-1.62-1.99-.17-.29-.02-.45.13-.6.14-.14.29-.34.44-.51.15-.17.19-.29.29-.49.1-.19.05-.36-.02-.51-.07-.15-.66-1.59-.9-2.17-.24-.57-.48-.49-.66-.49h-.56c-.19 0-.49.07-.75.36-.26.29-.99.97-.99 2.37s1.02 2.76 1.16 2.95c.15.19 2.01 3.07 4.87 4.3.68.29 1.22.47 1.63.6.69.22 1.31.19 1.8.11.55-.08 1.71-.7 1.95-1.38.24-.68.24-1.27.17-1.39-.08-.12-.27-.2-.56-.35Z"/></svg>',
      note:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h10a2 2 0 0 1 2 2v10.59a2 2 0 0 1-.59 1.41l-3.41 3.41A2 2 0 0 1 11.59 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 5v2h8V8H7Zm0 4v2h8v-2H7Zm0 4v2h5v-2H7Z"/></svg>',
      status:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 1 21h22L12 2Zm1 15h-2v2h2v-2Zm0-8h-2v6h2V9Z"/></svg>',
      interview:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h2v2h6V2h2v2h3a2 2 0 0 1 2 2v13a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2h3V2Zm13 8H4v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9Zm-4 3v2h2v-2h-2Zm-4 0v2h2v-2h-2Zm-4 0v2h2v-2H8Z"/></svg>'
    };
    return map[kind] || '';
  }
  function toast(msg){
    try{
      let el=qs('.cc573-toast');
      if(!el){
        el=document.createElement('div');
        el.className='cc573-toast';
        el.style.cssText='position:fixed;right:18px;bottom:18px;z-index:9999;background:linear-gradient(135deg,#123d6d,#2568ff);color:#fff;padding:12px 16px;border-radius:14px;font:800 13px/1.35 "Plus Jakarta Sans",Arial,sans-serif;box-shadow:0 18px 34px rgba(18,61,109,.28)';
        document.body.appendChild(el);
      }
      el.textContent=msg;
      el.hidden=false;
      clearTimeout(toast._t);
      toast._t=setTimeout(()=>{ if(el) el.hidden=true; },1800);
    }catch(_e){}
  }
  async function fetchSearchData(){
    const q=new URLSearchParams(location.search||'').get('q')||'';
    const cacheKey=`${SEARCH_CACHE_KEY}:${q}`;
    try{
      const cached=JSON.parse(sessionStorage.getItem(cacheKey)||'null');
      if(cached && Array.isArray(cached.candidates)) return cached;
    }catch(_e){}
    const res=await fetch(`/api/search?q=${encodeURIComponent(q)}`,{credentials:'include',cache:'no-store',headers:{Accept:'application/json'}});
    const data=await res.json().catch(()=>({candidates:[]}));
    try{ sessionStorage.setItem(cacheKey, JSON.stringify(data||{})); }catch(_e){}
    return data||{candidates:[]};
  }
  function storeAction(candidate, action){
    try{ localStorage.setItem(ACTION_KEY, JSON.stringify({candidate_id:String(candidate.candidate_id||''), action:String(action||''), at:Date.now()})); }catch(_e){}
  }
  async function manualCall(candidate){
    const phone=sanitizePhone(candidate.phone || candidate.phone_masked || '');
    if(!phone){ toast('Phone number missing'); return; }
    const payload={
      phone,
      candidate_id:candidate.candidate_id || '',
      candidate_name:candidate.full_name || candidate.name || '',
      process:candidate.process || '',
      location:candidate.location || candidate.preferred_location || '',
      source:'crm_search_result',
      note:'Manual app call from CRM search result',
      instant_start:'1',
      call_source:'crm_search_action_icon',
      source_mode:'crm_search_action_icon',
      command_source:'crm_search_action_icon'
    };
    try{
      await fetch('/api/dialer/manual-call',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload)});
      toast('Call started');
    }catch(_e){
      toast('Call request sent');
    }
  }
  function openWhatsapp(candidate){
    const phone=sanitizePhone(candidate.phone || candidate.phone_masked || '');
    if(!phone){ toast('Phone number missing'); return; }
    try{ fetch(`/api/candidates/${encodeURIComponent(candidate.candidate_id || '')}/whatsapp-log`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:''})}).catch(()=>{}); }catch(_e){}
    window.open(`https://wa.me/91${phone}`,'_blank','noopener,noreferrer');
  }
  function gotoCandidate(candidate, action){
    if(!candidate || !candidate.candidate_id) return;
    storeAction(candidate, action);
    location.href=`/candidate/${encodeURIComponent(candidate.candidate_id)}?ccqa=${encodeURIComponent(action)}`;
  }
  function createIconButton(cls, title, kind, onClick){
    const btn=document.createElement('button');
    btn.type='button';
    btn.className=`cc573-icon-btn ${cls}`;
    btn.title=title;
    btn.setAttribute('aria-label', title);
    btn.innerHTML=iconSvg(kind);
    btn.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); onClick(); });
    return btn;
  }
  async function enhanceSearchPage(){
    if(!isSearchRoute()) return;
    markBody();
    let data;
    try{ data=await fetchSearchData(); }catch(_e){ data={candidates:[]}; }
    const candidates=Array.isArray(data.candidates)?data.candidates:[];
    const panels=qsa('.small-grid.three > .panel');
    const candPanel=panels.find(panel=>/candidates/i.test(String(qs('.panel-title', panel)?.textContent||'')));
    if(!candPanel) return;
    const list=qs('.activity-list', candPanel);
    if(!list) return;
    const cards=qsa('button.activity-item', list);
    cards.forEach((card, idx)=>{
      const candidate=candidates[idx] || null;
      if(!candidate || card.dataset.cc573Enhanced==='1') return;
      card.dataset.cc573Enhanced='1';
      card.classList.add('cc573-search-card');
      const left=qs('.activity-left', card) || card.firstElementChild || card;
      if(candidate.candidate_id && !qs('.cc573-mini-id', left)){
        const nameNode=qs('.activity-name', left);
        const idPill=document.createElement('span');
        idPill.className='cc573-mini-id';
        idPill.textContent=String(candidate.candidate_id);
        if(nameNode) nameNode.insertAdjacentElement('afterend', idPill);
      }
      const actions=document.createElement('div');
      actions.className='cc573-search-actions';
      actions.appendChild(createIconButton('cc573-call','Call','call',()=>manualCall(candidate)));
      actions.appendChild(createIconButton('cc573-whatsapp','WhatsApp','whatsapp',()=>openWhatsapp(candidate)));
      actions.appendChild(createIconButton('cc573-note','Add Note','note',()=>gotoCandidate(candidate,'notes')));
      actions.appendChild(createIconButton('cc573-status','Change Status','status',()=>gotoCandidate(candidate,'status')));
      actions.appendChild(createIconButton('cc573-interview','Change Interview Date','interview',()=>gotoCandidate(candidate,'interview')));
      card.appendChild(actions);
    });
  }
  function findFieldByLabel(pattern){
    const labels=qsa('label, .compact-shell-label, .field-label-line label, .candidate-meta-card label');
    for(const label of labels){
      const text=String(label.textContent || '').replace(/\s+/g,' ').trim();
      if(pattern.test(text)){
        const field=label.closest('.field, .native-select-field, .candidate-meta-card, .compact-shell, .split-exp-card') || label.parentElement;
        if(field) return {label, field};
      }
    }
    return null;
  }
  function injectInHandSame(){
    if(!isCandidateRoute()) return;
    const source=findFieldByLabel(/^CTC Monthly$/i);
    const target=findFieldByLabel(/^In-hand Monthly Salary$/i);
    if(!source || !target) return;
    const sourceInput=qs('input, textarea, select', source.field);
    const targetInput=qs('input, textarea, select', target.field);
    if(!sourceInput || !targetInput) return;
    // CC26_648: the button belongs to the field's top-right corner, not below the input.
    // Keep React-owned label/input in place; only add a separate decoration button.
    const parent=target.field;
    if(parent.classList.contains('cc573-same-row')) parent.classList.remove('cc573-same-row');
    parent.classList.add('cc648-salary-same-field');
    if(qs('.cc573-inline-same-btn', parent)) return;
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='cc573-inline-same-btn';
    btn.textContent='SAME';
    btn.addEventListener('click', function(ev){
      ev.preventDefault();
      const value=sourceInput.value;
      const nativeSetter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
      if(nativeSetter && targetInput instanceof HTMLInputElement) nativeSetter.call(targetInput,value);
      else targetInput.value=value;
      targetInput.dispatchEvent(new Event('input',{bubbles:true}));
      targetInput.dispatchEvent(new Event('change',{bubbles:true}));
      toast('In-hand salary matched');
    });
    parent.appendChild(btn);
  }
  function consumeQuickAction(){
    if(!isCandidateRoute()) return;
    const fromQuery=new URLSearchParams(location.search||'').get('ccqa') || '';
    let pending=null;
    try{ pending=JSON.parse(localStorage.getItem(ACTION_KEY)||'null'); }catch(_e){}
    const routeId=decodeURIComponent(String(location.pathname||'').split('/').filter(Boolean).pop()||'');
    const action=fromQuery || (pending && pending.candidate_id===routeId ? pending.action : '');
    if(!action) return;
    const token=routeId+'|'+action;
    if(consumeQuickAction._token===token) return;
    consumeQuickAction._token=token;
    const apply=()=>{
      let target=null;
      if(/notes?/i.test(action)){
        target=byText(qsa('button, .mini-btn, .ghost-btn, .choice-chip, .bucket-quick-pill'), /^Notes$/i) || byText(qsa('button, .mini-btn, .ghost-btn, .choice-chip, .bucket-quick-pill'), /Open Notes Chat/i);
        if(target) target.click();
        const area=qsa('textarea').find(el => /note/i.test(String(el.placeholder||'')) || /notes?/i.test(String(el.name||''))) || qs('textarea');
        if(area){ area.scrollIntoView({behavior:'smooth', block:'center'}); try{ area.focus(); }catch(_e){} }
      }else if(/status/i.test(action)){
        target=byText(qsa('button, .choice-chip, .bucket-quick-pill'), /^Status$/i);
        if(target) target.click();
        const statusLabel=findFieldByLabel(/^Status$/i);
        if(statusLabel){ statusLabel.field.scrollIntoView({behavior:'smooth', block:'center'}); }
      }else if(/interview/i.test(action)){
        target=byText(qsa('button, .choice-chip, .bucket-quick-pill'), /^Interview$/i);
        if(target) target.click();
        const ivLabel=findFieldByLabel(/^Interview Date$/i) || findFieldByLabel(/^Interview$/i);
        if(ivLabel){
          ivLabel.field.scrollIntoView({behavior:'smooth', block:'center'});
          const input=qs('input, select, textarea', ivLabel.field);
          if(input){ try{ input.focus(); }catch(_e){} }
        }
      }
      try{
        if(pending && pending.candidate_id===routeId){ localStorage.removeItem(ACTION_KEY); }
      }catch(_e){}
    };
    setTimeout(apply, 700);
    setTimeout(apply, 1700);
  }
  function boot(){
    markBody();
    enhanceSearchPage().catch(()=>{});
    injectInHandSame();
    consumeQuickAction();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot, {once:true}); else boot();
  window.addEventListener('popstate', boot);
  window.addEventListener('career-crox-react-ready', function(){ setTimeout(boot, 180); setTimeout(boot, 850); }, {once:false});
  // CC26_745 responsiveness: the old observer called boot() for every DOM insertion.
  // Candidate/profile pages can create hundreds of nodes while mounting, so that caused
  // repeated full label scans and async search work. Watch only structural additions and
  // collapse a burst into one boot.
  let cc745BootTimer=null;
  function cc745ScheduleBoot(){ if(cc745BootTimer)return; cc745BootTimer=setTimeout(()=>{cc745BootTimer=null;boot();},140); }
  try{
    const host=document.getElementById('root')||document.body||document.documentElement;
    new MutationObserver((records)=>{
      const relevant=records.some((r)=>Array.from(r.addedNodes||[]).some((node)=>
        node&&node.nodeType===1&&((node.matches&&node.matches('.small-grid,.candidate-detail-full-panel,[data-field="recruiter_code"],[data-field="status"],.activity-list'))||
        (node.querySelector&&node.querySelector('.small-grid,.candidate-detail-full-panel,[data-field="recruiter_code"],[data-field="status"],.activity-list')))));
      if(relevant)cc745ScheduleBoot();
    }).observe(host,{childList:true,subtree:true});
  }catch(_e){}
})();
