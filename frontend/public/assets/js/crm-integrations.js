/* CC930: the shared session broker owns chat leader election and tab mirroring. */



;(() => {
  'use strict';
  const CUSTOM_VARS=['--grad-1-a','--grad-1-b','--grad-2-a','--grad-2-b','--brand-primary','--brand-secondary','--brand-accent','--brand-button','--panel-tint-a','--panel-tint-b','--panel-tint-c','--surface-bg-base','--app-bg-start','--app-bg-mid','--app-bg-end','--custom-hue-rotate','--surface-strength','--surface-mix-a','--surface-mix-b','--surface-mix-c','--surface-line','--surface-soft-a','--surface-soft-b'];
  const CUSTOM_KEY='careerCroxCustomTheme';
  function clearStaleCustomThemeVars(){
    try{localStorage.removeItem(CUSTOM_KEY)}catch{}
    CUSTOM_VARS.forEach((k)=>document.documentElement.style.removeProperty(k));
  }
  function restoreRealThemeChooser(){
    document.querySelectorAll('.cc523-theme-look-list,.cc524-theme-look-list').forEach((x)=>x.remove());
    document.querySelectorAll('.theme-choice-grid').forEach((x)=>x.style.removeProperty('display'));
  }
  document.addEventListener('click',(event)=>{
    if(event.target&&event.target.closest&&event.target.closest('.theme-choice-card,.theme-look-option')) clearStaleCustomThemeVars();
  },true);

  function phoneKey(value){const d=String(value||'').replace(/\D/g,'');return d.length>10?d.slice(-10):d}
  function first(row,keys){for(const k of keys){const v=row&&row[k];if(String(v??'').trim())return String(v).trim()}return ''}
  function profileDetails(row){
    const cid=first(row,['candidate_id','existing_candidate_id']);
    const serial=first(row,['source_sr_no','sr_no','serial_no'])||(cid.match(/\d+$/)||[])[0]||'';
    return {
      candidate_id:cid,source_sr_no:serial,existing_name:first(row,['full_name','name','existing_name']),phone:first(row,['phone','number']),
      location:first(row,['location']),preferred_location:first(row,['preferred_location']),qualification:first(row,['qualification','qualification_level']),qualification_level:first(row,['qualification_level']),
      total_experience:first(row,['total_experience','experience']),relevant_experience:first(row,['relevant_experience']),ctc_monthly:first(row,['ctc_monthly']),in_hand_salary:first(row,['in_hand_salary']),
      process:first(row,['process']),communication_skill:first(row,['communication_skill']),recruiter_code:first(row,['recruiter_code']),recruiter_name:first(row,['recruiter_name']),status:first(row,['status']),
      approval_status:first(row,['approval_status']),all_details_sent:first(row,['all_details_sent']),is_duplicate:String(row&&row.is_duplicate||'0')
    };
  }
  async function fastDuplicateAnalysis(payload,nativeFetch,signal){
    const rows=Array.isArray(payload&&payload.rows)?payload.rows:[];
    const groups=new Map();
    rows.forEach((row,index)=>{
      const key=phoneKey(first(row,['phone','number','mobile']));if(!key)return;
      if(!groups.has(key))groups.set(key,{group_key:key,phone:first(row,['phone','number','mobile'])||key,uploaded_rows:[],existing_profiles:[]});
      groups.get(key).uploaded_rows.push({row_number:index+1,uploaded_name:first(row,['full_name','name','candidate_name']),phone:first(row,['phone','number','mobile']),location:first(row,['location']),preferred_location:first(row,['preferred_location']),qualification:first(row,['qualification','qualification_level']),recruiter_code:first(row,['recruiter_code']),status:first(row,['status'])});
    });
    const keys=[...groups.keys()];
    for(let i=0;i<keys.length;i+=24){
      const batch=keys.slice(i,i+24);
      const url='/api/candidates?phone='+encodeURIComponent(batch.join(','))+'&page=1&page_size=100';
      const res=await nativeFetch(url,{method:'GET',credentials:'include',headers:{'X-Career-Crox-Background':'1'},signal});
      if(!res.ok)throw new Error('Candidate duplicate lookup failed');
      const data=await res.json();
      const found=Array.isArray(data&&data.filter_source_rows)?data.filter_source_rows:(Array.isArray(data&&data.items)?data.items:[]);
      found.forEach((row)=>{const key=phoneKey(row&&row.phone);if(key&&groups.has(key))groups.get(key).existing_profiles.push(profileDetails(row))});
    }
    const duplicate_groups=[...groups.values()].filter((g)=>g.uploaded_rows.length>1||g.existing_profiles.length>0).map((g)=>({...g,uploaded_count:g.uploaded_rows.length,existing_count:g.existing_profiles.length,total_compare_rows:g.uploaded_rows.length+g.existing_profiles.length}));
    const duplicateKeys=new Set(duplicate_groups.map((g)=>g.group_key));
    const review_rows=duplicate_groups.flatMap((g,gi)=>g.uploaded_rows.map((u)=>{
      const details=g.existing_profiles.flatMap((x)=>[
        x.source_sr_no&&`Serial No: ${x.source_sr_no}`,x.candidate_id&&`Candidate ID: ${x.candidate_id}`,x.existing_name&&`Name: ${x.existing_name}`,x.phone&&`Number: ${x.phone}`,
        x.qualification&&`Qualification: ${x.qualification}`,x.location&&`Location: ${x.location}`,x.preferred_location&&`Preferred Location: ${x.preferred_location}`,
        x.total_experience&&`Total Exp: ${x.total_experience}`,x.relevant_experience&&`Relevant Exp: ${x.relevant_experience}`,x.ctc_monthly&&`CTC: ${x.ctc_monthly}`,x.in_hand_salary&&`In-hand: ${x.in_hand_salary}`,
        x.process&&`Process: ${x.process}`,x.communication_skill&&`Communication: ${x.communication_skill}`,x.recruiter_code&&`Recruiter: ${x.recruiter_code}`,x.status&&`Status: ${x.status}`,x.approval_status&&`Approval: ${x.approval_status}`
      ].filter(Boolean));
      return {row_number:u.row_number,upload_row_number:u.row_number,set_number:gi+1,phone:u.phone||g.phone||'',uploaded_name:u.uploaded_name||'',existing_candidate_id:g.existing_profiles.map((x)=>x.candidate_id).filter(Boolean).join(', '),existing_name:g.existing_profiles.map((x)=>x.existing_name).filter(Boolean).join(', '),existing_filled_fields:details,group_key:g.group_key,group_uploaded_count:g.uploaded_rows.length,group_existing_count:g.existing_profiles.length,suggested_action:'Review the old CRM row below. Existing CRM data stays protected.'};
    }));
    const new_rows=[];rows.forEach((row,index)=>{const key=phoneKey(first(row,['phone','number','mobile']));if(key&&!duplicateKeys.has(key))new_rows.push({row_number:index+1,uploaded_name:first(row,['full_name','name']),phone:first(row,['phone','number']),suggested_action:'New profile will be added.'})});
    return {ok:true,requires_review:duplicate_groups.length>0,summary:{uploaded_rows:rows.length,new_profiles:new_rows.length,blank_existing_matches:0,filled_existing_matches:duplicate_groups.reduce((n,g)=>n+g.existing_profiles.length,0),exact_existing_matches:0,skipped:0,duplicate_sets:duplicate_groups.length,uploaded_duplicate_rows:duplicate_groups.reduce((n,g)=>n+g.uploaded_rows.length,0),existing_phone_matches:duplicate_groups.reduce((n,g)=>n+g.existing_profiles.length,0)},duplicate_groups,review_rows,blank_existing_rows:[],exact_rows:[],new_rows,skipped:[],policy:{filled_existing:'Existing filled profiles are never replaced automatically.',blank_existing:'Existing CRM profiles stay protected during review.',delete_policy:'Review never deletes an existing CRM profile.'},cc524_fast_compare:true};
  }



  // CC26_677: candidate-profile crash shield. Zero polling / zero extra network.
  // Candidate detail payloads and local profile caches are normalized before React sees them,
  // so one malformed legacy/imported value cannot block the full profile page.
  function cc677Scalar(value,fallback=''){
    if(value===null||value===undefined)return fallback;
    if(typeof value==='string')return value;
    if(typeof value==='number'||typeof value==='boolean'||typeof value==='bigint')return String(value);
    if(value instanceof Date){try{return Number.isNaN(value.getTime())?fallback:value.toISOString()}catch(_){return fallback}}
    try{const out=JSON.stringify(value);return out===undefined?fallback:out}catch(_){return fallback}
  }
  function cc677Row(value){
    if(!value||typeof value!=='object'||Array.isArray(value))return {};
    const out={};
    Object.entries(value).forEach(([key,val])=>{
      if(val===null||val===undefined)out[key]='';
      else if(Array.isArray(val))out[key]=val.map((x)=>cc677Scalar(x)).filter(Boolean).join(', ');
      else out[key]=cc677Scalar(val);
    });
    return out;
  }
  function cc677RowList(value,limit){return (Array.isArray(value)?value:[]).slice(0,limit||500).map(cc677Row)}
  function cc677CandidateApiPayload(data,url=''){
    if(!data||typeof data!=='object'||Array.isArray(data))return data;
    const path=String(url||'');
    if(!/\/api\/candidates\//i.test(path))return data;
    const out={...data};
    ['item','candidate','candidate_updates','submission'].forEach((key)=>{if(out[key]&&typeof out[key]==='object'&&!Array.isArray(out[key]))out[key]=cc677Row(out[key])});
    if(Array.isArray(out.notes))out.notes=cc677RowList(out.notes,80);
    if(Array.isArray(out.timeline))out.timeline=cc677RowList(out.timeline,100);
    if(Array.isArray(out.nav_items))out.nav_items=cc677RowList(out.nav_items,500);
    if(Array.isArray(out.files))out.files=cc677RowList(out.files,30);
    if(Array.isArray(out.recruiter_options))out.recruiter_options=cc677RowList(out.recruiter_options,150);
    if(Array.isArray(out.items))out.items=cc677RowList(out.items,500);
    if(Array.isArray(out.process_options))out.process_options=out.process_options.map((x)=>cc677Scalar(x)).filter(Boolean).slice(0,150);
    return out;
  }
  function cc677RepairProfileCaches(){
    const prefixes=['careerCroxInstantCandidateProfile:','careerCroxCandidateDurableDraft_v6_finaldraft:'];
    for(const storage of [window.sessionStorage,window.localStorage]){
      if(!storage)continue;
      try{
        const keys=[];for(let i=0;i<storage.length;i+=1)keys.push(storage.key(i));
        keys.filter(Boolean).forEach((key)=>{
          const name=String(key||'');
          if(name.startsWith('careerCroxCandidateNav:')){
            try{const parsed=JSON.parse(storage.getItem(name)||'null');if(parsed&&typeof parsed==='object'){if(Array.isArray(parsed.nav_items))parsed.nav_items=cc677RowList(parsed.nav_items,500);storage.setItem(name,JSON.stringify(parsed))}}catch(_){}
            return;
          }
          if(!prefixes.some((prefix)=>name.startsWith(prefix)))return;
          try{const parsed=JSON.parse(storage.getItem(name)||'null');if(parsed&&typeof parsed==='object'&&parsed.item&&typeof parsed.item==='object'){parsed.item=cc677Row(parsed.item);storage.setItem(name,JSON.stringify(parsed))}}catch(_){}
        });
      }catch(_){}
    }
  }
  try{cc677RepairProfileCaches()}catch(_){}
  try{
    const nativeResponseJson=Response.prototype.json;
    if(false&&!Response.prototype.__cc677CandidateSafeJson){
      Object.defineProperty(Response.prototype,'__cc677CandidateSafeJson',{value:true,configurable:false,enumerable:false});
      Response.prototype.json=async function(){
        const data=await nativeResponseJson.call(this);
        try{return cc677CandidateApiPayload(data,this.url||'')}catch(_){return data}
      };
    }
  }catch(_){}

  const nativeFetch=window.fetch.bind(window);
  let lastDuplicateAnalysis=null;
  function rememberDuplicateAnalysis(data){
    if(data&&typeof data==='object'){lastDuplicateAnalysis=data;window.__CC524_LAST_DUPLICATE_ANALYSIS=data;schedule();}
    return data;
  }
  window.fetch=async function(input,init){
    const url=typeof input==='string'?input:(input&&input.url)||'';
    const method=String((init&&init.method)||(input&&input.method)||'GET').toUpperCase();
    // CC26_526: never replace the authoritative backend duplicate analyzer with a
    // candidate-list shortcut. The backend knows legacy phone/number columns and
    // returns the complete old CRM rows needed for row-wise comparison.
    const response=await nativeFetch(input,init);
    if(method==='POST'&&url.includes('/api/admin/analyze-candidate-upload')){
      try{rememberDuplicateAnalysis(await response.clone().json())}catch{}
    }
    return response;
  };
  window.__CC524_DUPLICATE_FAST_ANALYZE=(payload)=>fastDuplicateAnalysis(payload,nativeFetch,undefined);

  function textEl(tag,text,className){const el=document.createElement(tag);if(className)el.className=className;el.textContent=String(text??'');return el}
  function detailLine(profile){
    const wrap=document.createElement('div');wrap.className='cc524-old-profile-details';
    const pairs=[['Serial No',profile.source_sr_no],['Candidate ID',profile.candidate_id],['Name',profile.existing_name],['Number',profile.phone],['Qualification',profile.qualification],['Location',profile.location],['Preferred Location',profile.preferred_location],['Total Exp',profile.total_experience],['Relevant Exp',profile.relevant_experience],['CTC',profile.ctc_monthly],['In-hand',profile.in_hand_salary],['Process',profile.process],['Communication',profile.communication_skill],['Recruiter',profile.recruiter_code||profile.recruiter_name],['Status',profile.status],['Approval',profile.approval_status],['Details Sent',profile.all_details_sent]];
    let count=0;
    pairs.forEach(([label,value])=>{if(!String(value??'').trim())return;count++;const item=document.createElement('span');item.className='cc524-detail-item';const b=textEl('strong',label+': ');item.appendChild(b);item.appendChild(document.createTextNode(String(value)));wrap.appendChild(item)});
    if(!count)wrap.appendChild(textEl('span','Existing CRM profile found.','cc524-detail-item'));
    return wrap;
  }
  function renderRowWiseDuplicateCompare(){
    const data=lastDuplicateAnalysis;if(!data||!Array.isArray(data.duplicate_groups)||!data.duplicate_groups.length)return;
    const title=[...document.querySelectorAll('.table-title')].find((el)=>(el.textContent||'').trim()==='Upload Duplicate Analysis');
    const panel=title&&title.closest('.panel');if(!panel||panel.closest('[data-cc804-controls],.cc801-admin-workspace'))return;
    panel.id='candidate-duplicate-review';panel.classList.add('cc524-duplicate-review-panel');
    if(panel.querySelector('.cc524-duplicate-rowwise'))return;
    const legacy=panel.querySelector('.crm-table-wrap');
    const legacyRows=legacy?[...legacy.querySelectorAll('tbody tr')]:[];
    if(legacy){legacy.classList.add('cc524-legacy-duplicate-table');legacy.style.display='none'}
    const box=document.createElement('div');box.className='cc524-duplicate-rowwise top-gap-small';
    data.duplicate_groups.forEach((group,groupIndex)=>{
      const set=document.createElement('section');set.className='cc524-duplicate-set';
      const head=document.createElement('div');head.className='cc524-duplicate-set-head';
      head.appendChild(textEl('strong',`Set ${groupIndex+1} • Same phone digits: ${group.phone||group.group_key||'-'}`));
      head.appendChild(textEl('span',`${group.uploaded_count||0} uploaded + ${group.existing_count||0} existing`,'mini-chip'));
      set.appendChild(head);
      (group.uploaded_rows||[]).forEach((uploadRow,uploadIndex)=>{
        const pair=document.createElement('div');pair.className='cc524-duplicate-pair';
        const blank=document.createElement('div');blank.className='cc524-compare-row cc524-new-upload-row';
        blank.appendChild(textEl('span',`New Upload • Row ${uploadRow.row_number||uploadIndex+1}`,'mini-chip'));
        blank.appendChild(textEl('span','—','cc524-new-upload-blank'));
        const remove=document.createElement('button');remove.type='button';remove.className='mini-btn bounceable cc524-remove-upload';remove.title='Remove only this pending uploaded row. Existing CRM profile is never deleted.';remove.textContent='🗑';
        remove.addEventListener('click',()=>{
          const targetRow=Number(uploadRow.row_number||0);
          let legacyIndex=-1;
          if(Array.isArray(data.review_rows))legacyIndex=data.review_rows.findIndex((r)=>Number(r.row_number||r.upload_row_number||0)===targetRow);
          const btn=(legacyIndex>=0&&legacyRows[legacyIndex])?legacyRows[legacyIndex].querySelector('button'):null;
          if(btn)btn.click();
        });
        blank.appendChild(remove);pair.appendChild(blank);
        if((group.existing_profiles||[]).length){
          group.existing_profiles.forEach((profile)=>{const old=document.createElement('div');old.className='cc524-compare-row cc524-old-crm-row';old.appendChild(textEl('span','Old CRM Row','mini-chip sync-chip saved'));old.appendChild(detailLine(profile));old.appendChild(textEl('span','🔒','cc524-lock'));pair.appendChild(old)});
        }else{
          const old=document.createElement('div');old.className='cc524-compare-row cc524-old-crm-row';old.appendChild(textEl('span','Same Upload Match','mini-chip sync-chip saved'));old.appendChild(textEl('span','Duplicate is inside this upload; there is no old CRM row for this set.','cc524-old-profile-details'));old.appendChild(textEl('span','—','cc524-lock'));pair.appendChild(old);
        }
        set.appendChild(pair);
      });
      box.appendChild(set);
    });
    if(legacy)legacy.insertAdjacentElement('beforebegin',box);else panel.appendChild(box);
  }


  // CC26_544: the React theme picker + cc26-535-theme-controller own all theme state.
  // Legacy CC529 theme click/DOM rewriting is removed: it read options by index,
  // fought the manager-only list and triggered a perpetual mutation -> RAF loop.
  function polishThemeChooser() { /* handled by React + theme controller */ }
  function cleanAppearancePanel(){
    document.querySelectorAll('.theme-panel-body .row-actions.top-gap-small').forEach((row)=>{if(row.querySelector('.bucket-quick-pill'))row.classList.add('cc526-hide-tune-cloud')});
    document.querySelectorAll('.custom-theme-title').forEach((el)=>{if(/Background and Theme Controls/i.test(el.textContent||''))el.textContent='Glass Theme Controls'});
  }

  // CC26_652: candidate notes presets + action colors are local UI only (zero network / zero egress).
  const CC652_PRESET_TONES=[
    ['#ffb14f','#f07a2a','#7a3510'],
    ['#5bd58b','#1ea965','#0f5132'],
    ['#a78bfa','#7457dc','#34206f'],
    ['#45c7c7','#1694a5','#0d5260']
  ];
  function cc652EnsureStyle(){
    if(document.getElementById('cc652-notes-actions-style'))return;
    const s=document.createElement('style');s.id='cc652-notes-actions-style';s.textContent=`
      body:not(.login-body) .candidate-detail-full-panel .candidate-notes-preview-list.cc652-four-presets{max-height:none!important;overflow:visible!important;display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px!important;align-content:start!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-note-template-preview.cc652-preset-note{min-height:64px!important;border-radius:15px!important;padding:10px 12px!important;display:grid!important;grid-template-columns:34px minmax(0,1fr)!important;gap:10px!important;align-items:center!important;text-align:left!important;color:#fff!important;-webkit-text-fill-color:#fff!important;border:1px solid rgba(255,255,255,.72)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.34),0 8px 18px rgba(30,60,95,.13)!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-note-template-preview.cc652-preset-note .candidate-note-template-preview-index{width:34px!important;height:34px!important;min-width:34px!important;border-radius:50%!important;display:grid!important;place-items:center!important;background:rgba(255,255,255,.92)!important;color:#17395b!important;-webkit-text-fill-color:#17395b!important;font-weight:950!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-note-template-preview.cc652-preset-note .candidate-note-template-preview-text{color:#fff!important;-webkit-text-fill-color:#fff!important;font-weight:900!important;font-size:14.5px!important;line-height:1.28!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-note-template-preview.cc652-tone-1{background:linear-gradient(135deg,#ffb14f,#f07a2a)!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-note-template-preview.cc652-tone-2{background:linear-gradient(135deg,#5bd58b,#1ea965)!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-note-template-preview.cc652-tone-3{background:linear-gradient(135deg,#a78bfa,#7457dc)!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-note-template-preview.cc652-tone-4{background:linear-gradient(135deg,#45c7c7,#1694a5)!important}
      body:not(.login-body) .candidate-detail-full-panel .cc652-add-preset{min-height:38px!important;border-radius:12px!important;border:1px solid #f1a4bd!important;background:linear-gradient(135deg,#ffe4ee,#ffd0df)!important;color:#8b3158!important;-webkit-text-fill-color:#8b3158!important;font-weight:900!important;padding:8px 12px!important;cursor:pointer!important}
      .cc652-note-popup-backdrop{position:fixed!important;inset:0!important;z-index:2147483000!important;background:rgba(12,28,48,.34)!important;backdrop-filter:blur(4px)!important;display:grid!important;place-items:center!important;padding:20px!important}
      .cc652-note-popup{width:min(520px,calc(100vw - 32px))!important;border-radius:22px!important;border:1px solid rgba(255,255,255,.86)!important;background:linear-gradient(145deg,#ffffff,#f7fbff)!important;box-shadow:0 28px 70px rgba(17,42,76,.28)!important;padding:20px!important;color:#173858!important}
      .cc652-note-popup-kicker{font-size:12px!important;font-weight:950!important;letter-spacing:.08em!important;text-transform:uppercase!important;opacity:.72!important}
      .cc652-note-popup-title{font-size:20px!important;font-weight:950!important;margin-top:5px!important}
      .cc652-note-popup-text{margin-top:12px!important;padding:14px!important;border-radius:15px!important;background:#f2f7ff!important;border:1px solid #dce9fb!important;font-size:16px!important;font-weight:800!important;line-height:1.45!important}
      .cc652-note-popup-actions{display:flex!important;justify-content:flex-end!important;gap:10px!important;margin-top:16px!important}
      .cc652-note-popup-actions button{min-height:42px!important;border-radius:12px!important;padding:9px 16px!important;font-weight:950!important;cursor:pointer!important}
      .cc652-note-popup-cancel{background:#fff!important;color:#3d5570!important;border:1px solid #c9d8e8!important}
      .cc652-note-popup-use{background:linear-gradient(135deg,#22b573,#0f9f5d)!important;color:#fff!important;border:0!important;box-shadow:0 8px 18px rgba(15,159,93,.20)!important}
      @media(max-width:760px){body:not(.login-body) .candidate-detail-full-panel .candidate-notes-preview-list.cc652-four-presets{grid-template-columns:1fr!important}}
    `;document.head.appendChild(s);
  }
  function cc652ReactSetTextarea(textarea,value){
    if(!textarea)return;
    try{const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value')?.set;setter?setter.call(textarea,value):(textarea.value=value)}catch{textarea.value=value}
    textarea.dispatchEvent(new Event('input',{bubbles:true}));
    textarea.dispatchEvent(new Event('change',{bubbles:true}));
    try{textarea.focus({preventScroll:true})}catch{textarea.focus()}
    const add=textarea.closest('.candidate-notes-input-col')?.querySelector('button.add-profile-btn,button');if(add)add.disabled=!String(value||'').trim();
  }
  function cc652ClosePopup(){document.querySelectorAll('.cc652-note-popup-backdrop').forEach(x=>x.remove())}
  function cc652OpenPresetPopup(button){
    const panel=button?.closest('.candidate-notes-chat-panel');const text=(button?.getAttribute('title')||button?.querySelector('.candidate-note-template-preview-text')?.textContent||'').trim();if(!panel||!text)return;
    cc652ClosePopup();
    const backdrop=document.createElement('div');backdrop.className='cc652-note-popup-backdrop';
    const card=document.createElement('div');card.className='cc652-note-popup';card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');
    card.appendChild(textEl('div','Preset Note','cc652-note-popup-kicker'));
    card.appendChild(textEl('div','Use this note?','cc652-note-popup-title'));
    card.appendChild(textEl('div',text,'cc652-note-popup-text'));
    const actions=document.createElement('div');actions.className='cc652-note-popup-actions';
    const cancel=textEl('button','Cancel','cc652-note-popup-cancel');cancel.type='button';
    const use=textEl('button','Use Note','cc652-note-popup-use');use.type='button';
    cancel.addEventListener('click',cc652ClosePopup);
    use.addEventListener('click',()=>{cc652ReactSetTextarea(panel.querySelector('.candidate-notes-main-textarea,textarea'),text);cc652ClosePopup()});
    actions.append(cancel,use);card.appendChild(actions);backdrop.appendChild(card);document.body.appendChild(backdrop);
    backdrop.addEventListener('click',(e)=>{if(e.target===backdrop)cc652ClosePopup()});
  }
  document.addEventListener('click',(event)=>{
    const preset=event.target?.closest?.('.candidate-note-template-preview');
    if(!preset||!preset.closest('.candidate-notes-chat-panel'))return;
    event.preventDefault();event.stopPropagation();
    cc652OpenPresetPopup(preset);
  },true);
  function cc652PaintAction(button,background,color,border,shadow){
    if(!button)return;button.style.setProperty('background',background,'important');button.style.setProperty('background-image',background,'important');button.style.setProperty('color',color,'important');button.style.setProperty('-webkit-text-fill-color',color,'important');button.style.setProperty('border',border,'important');button.style.setProperty('box-shadow',shadow,'important');button.style.setProperty('opacity',button.disabled?'.64':'1','important');
  }
  function cc652PolishCandidateNotesAndActions(){
    // CC26_774: React owns every candidate-note child. The older runtime moved
    // the preset select/history button between React containers and inserted an
    // Add Preset button. On Submit, React then tried insertBefore against a node
    // that had been moved, producing the Profile recovery crash seen in the video.
    // Keep only harmless button paint; never add/remove/reparent candidate children.
    cc652EnsureStyle();
    document.querySelectorAll('.candidate-action-btn.candidate-reset-btn').forEach(b=>cc652PaintAction(b,'linear-gradient(135deg,#ff625d,#d93232)','#ffffff','1px solid #d93232','0 9px 20px rgba(217,50,50,.24)'));
    document.querySelectorAll('.candidate-action-btn.candidate-check-jd-btn').forEach(b=>cc652PaintAction(b,'linear-gradient(135deg,#ffffff,#dcecff)','#174a7a','1px solid #9fc6eb','0 8px 18px rgba(84,139,194,.16)'));
    document.querySelectorAll('.candidate-action-btn.candidate-submit-btn').forEach(b=>cc652PaintAction(b,'linear-gradient(135deg,#37cc78,#109e56)','#ffffff','1px solid #109e56','0 9px 20px rgba(16,158,86,.24)'));
    document.querySelectorAll('.candidate-action-btn.candidate-save-btn').forEach(b=>cc652PaintAction(b,'linear-gradient(135deg,#ffb34c,#ed7a20)','#ffffff','1px solid #ed7a20','0 9px 20px rgba(237,122,32,.25)'));
  }


  // CC26_654: Chrome can keep Notes Chat as its scroll anchor while the long new-candidate form expands.
  // For a fresh /candidate/new route, temporarily disable scroll anchoring and repeatedly pin every possible scroller to 0.
  let cc654TopTimers=[];
  function cc654IsNewCandidate(){return String(location.pathname||'').replace(/\/+$/,'')==='/candidate/new'}
  function cc654ClearStoredNewScroll(){try{for(let i=sessionStorage.length-1;i>=0;i--){const k=sessionStorage.key(i)||'';if(k.indexOf('career-crox:page-scroll:/candidate/new')===0)sessionStorage.removeItem(k)}}catch(_){}}
  function cc654ForceNewCandidateTop(){
    if(window.__CC_PAGE_SCROLL_REACT_OWNER__)return;
    if(!cc654IsNewCandidate())return;
    cc654ClearStoredNewScroll();
    const page=document.querySelector('.page-scroll');
    if(page){page.style.setProperty('overflow-anchor','none','important');page.scrollTop=0;try{page.scrollTo({top:0,left:0,behavior:'auto'})}catch(_){}}
    const roots=[document.scrollingElement,document.documentElement,document.body].filter(Boolean);roots.forEach(x=>{try{x.scrollTop=0}catch(_){}});
    try{window.scrollTo({top:0,left:0,behavior:'auto'})}catch(_){try{window.scrollTo(0,0)}catch(__){}}
  }
  function cc654ScheduleNewCandidateTop(){
    if(window.__CC_PAGE_SCROLL_REACT_OWNER__)return;
    if(!cc654IsNewCandidate())return;
    cc654TopTimers.forEach(t=>clearTimeout(t));cc654TopTimers=[];
    cc654ForceNewCandidateTop();
    try{requestAnimationFrame(()=>{cc654ForceNewCandidateTop();requestAnimationFrame(cc654ForceNewCandidateTop)})}catch(_){ }
    [35,90,180,360,650,1000,1500,2200].forEach(ms=>cc654TopTimers.push(setTimeout(cc654ForceNewCandidateTop,ms)));
  }
  document.addEventListener('click',(event)=>{
    const add=event.target?.closest?.('.cc644-add-profile,a[href="/candidate/new"],button[data-cc-new-candidate]');
    if(!add)return;
    try{sessionStorage.setItem('career-crox:fresh-new-candidate-top',String(Date.now()))}catch(_){}
    [0,30,80,180,400,850,1500,2200].forEach(ms=>setTimeout(cc654ScheduleNewCandidateTop,ms));
  },true);
  window.addEventListener('popstate',()=>setTimeout(cc654ScheduleNewCandidateTop,0));
  window.addEventListener('pageshow',()=>setTimeout(cc654ScheduleNewCandidateTop,0));

  function stabilizeCandidateUi(){
    // CC26_774: candidate controls are fully React-owned. Only safe visual paint
    // and new-profile scroll positioning remain; no React child text/tree writes.
    cc654ScheduleNewCandidateTop();
    cc652PolishCandidateNotesAndActions();
  }



  // CC26_655: restore original right-side preset notes layout and move the Add New Profile button into the new-candidate header.
  function cc655Path(){return String(location.pathname||'').replace(/\/+$/,'')||'/';}
  function cc655EnsureStyle(){
    if(document.getElementById('cc655-notes-layout-style'))return;
    const s=document.createElement('style');
    s.id='cc655-notes-layout-style';
    s.textContent=`
      body:not(.login-body) .candidate-detail-full-panel .cc655-title-row{display:flex!important;align-items:flex-start!important;justify-content:space-between!important;gap:14px!important;flex-wrap:wrap!important}
      body:not(.login-body) .candidate-detail-full-panel .cc655-header-add-profile{min-height:40px!important;padding:9px 18px!important;border-radius:13px!important;font-size:14px!important;line-height:1!important;white-space:nowrap!important;align-self:flex-start!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-notes-chat-panel.cc655-notes-panel .candidate-notes-composer-grid{display:grid!important;grid-template-columns:minmax(0,1fr)!important;gap:16px!important;align-items:start!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-notes-chat-panel.cc655-notes-panel .candidate-notes-preview-col{display:none!important;flex-direction:column!important;gap:12px!important;align-self:stretch!important;min-width:0!important;max-width:none!important;padding:8px 0 0!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-notes-chat-panel.cc655-notes-panel .cc655-preset-toolbar{display:flex!important;gap:10px!important;align-items:center!important;flex-wrap:nowrap!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-notes-chat-panel.cc655-notes-panel .cc655-preset-toolbar .note-template-select{display:block!important;flex:1 1 auto!important;min-width:0!important;height:54px!important;border-radius:16px!important;font-weight:900!important;font-size:15px!important;padding:0 46px 0 16px!important;background:#fff!important;border:1px solid #bed4ee!important;color:#17385b!important;-webkit-text-fill-color:#17385b!important;box-shadow:0 6px 18px rgba(42,92,146,.08)!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-notes-chat-panel.cc655-notes-panel .cc655-history-btn{flex:0 0 auto!important;min-height:54px!important;border-radius:16px!important;padding:0 18px!important;font-size:15px!important;font-weight:900!important;white-space:nowrap!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-notes-chat-panel.cc655-notes-panel .candidate-notes-preview-list.cc655-preset-list{display:none!important;flex-direction:column!important;gap:12px!important;max-height:338px!important;overflow:auto!important;padding-right:4px!important;grid-template-columns:none!important;align-content:unset!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-notes-chat-panel.cc655-notes-panel .candidate-note-template-preview.cc655-preset-card{min-height:92px!important;border-radius:18px!important;padding:14px 14px!important;display:grid!important;grid-template-columns:40px minmax(0,1fr)!important;gap:12px!important;align-items:flex-start!important;text-align:left!important;color:#fff!important;-webkit-text-fill-color:#fff!important;border:1px solid rgba(255,255,255,.80)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.36),0 10px 20px rgba(28,55,92,.14)!important;cursor:pointer!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-notes-chat-panel.cc655-notes-panel .candidate-note-template-preview.cc655-preset-card .candidate-note-template-preview-index{width:40px!important;height:40px!important;min-width:40px!important;border-radius:999px!important;display:grid!important;place-items:center!important;background:rgba(255,255,255,.95)!important;color:#17395b!important;-webkit-text-fill-color:#17395b!important;font-size:18px!important;font-weight:950!important;box-shadow:0 6px 14px rgba(17,48,84,.12)!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-notes-chat-panel.cc655-notes-panel .candidate-note-template-preview.cc655-preset-card .candidate-note-template-preview-text{display:block!important;color:#fff!important;-webkit-text-fill-color:#fff!important;font-weight:900!important;font-size:15px!important;line-height:1.38!important;white-space:normal!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-notes-chat-panel.cc655-notes-panel .candidate-note-template-preview.cc655-tone-1{background:linear-gradient(135deg,#ffb24d,#f07a27)!important;background-image:linear-gradient(135deg,#ffb24d,#f07a27)!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-notes-chat-panel.cc655-notes-panel .candidate-note-template-preview.cc655-tone-2{background:linear-gradient(135deg,#52d488,#159f5f)!important;background-image:linear-gradient(135deg,#52d488,#159f5f)!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-notes-chat-panel.cc655-notes-panel .candidate-note-template-preview.cc655-tone-3{background:linear-gradient(135deg,#a583ff,#6f4edb)!important;background-image:linear-gradient(135deg,#a583ff,#6f4edb)!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-notes-chat-panel.cc655-notes-panel .candidate-note-template-preview.cc655-tone-4{background:linear-gradient(135deg,#49c9d2,#178fa7)!important;background-image:linear-gradient(135deg,#49c9d2,#178fa7)!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-notes-chat-panel.cc655-notes-panel .candidate-notes-head-tools .cc652-add-preset{display:none!important}
      @media (max-width:980px){body:not(.login-body) .candidate-detail-full-panel .candidate-notes-chat-panel.cc655-notes-panel .candidate-notes-composer-grid{grid-template-columns:1fr!important}body:not(.login-body) .candidate-detail-full-panel .candidate-notes-chat-panel.cc655-notes-panel .candidate-notes-preview-col{order:-1!important}body:not(.login-body) .candidate-detail-full-panel .candidate-notes-chat-panel.cc655-notes-panel .cc655-preset-toolbar{flex-wrap:wrap!important}body:not(.login-body) .candidate-detail-full-panel .candidate-notes-chat-panel.cc655-notes-panel .cc655-history-btn{width:100%!important}}
    `;
    document.head.appendChild(s);
  }
  function cc655MoveAddProfileButton(){
    // CC26_774: native React UI already provides this feature; no external DOM mutation.
    return;
  }
  function cc655RelayoutCandidateNotes(){
    // CC26_774: native React UI already provides this feature; no external DOM mutation.
    return;
  }
  const cc655BaseStabilizeCandidateUi=stabilizeCandidateUi;
  stabilizeCandidateUi=function(){
    cc655BaseStabilizeCandidateUi();
    cc655EnsureStyle();
    cc655MoveAddProfileButton();
    cc655RelayoutCandidateNotes();
  };



  // CC26_656: show six glossy preset cards inside the blank notes area, and let the user pin more from a dropdown.
  const CC656_PIN_KEY='career-crox:notes-pinned-presets:v1';
  function cc656EnsureStyle(){
    if(document.getElementById('cc656-inline-presets-style'))return;
    const s=document.createElement('style');
    s.id='cc656-inline-presets-style';
    s.textContent=`
      body:not(.login-body) .candidate-detail-full-panel .candidate-notes-chat-panel.cc656-inline-panel .candidate-notes-composer-grid{grid-template-columns:1fr!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-notes-chat-panel.cc656-inline-panel .candidate-notes-preview-col{display:none!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-notes-chat-panel.cc656-inline-panel .candidate-notes-head-tools{display:none!important}
      body:not(.login-body) .candidate-detail-full-panel .candidate-notes-chat-panel.cc656-inline-panel .candidate-notes-input-col{max-width:none!important}
      body:not(.login-body) .candidate-detail-full-panel .cc656-toolbar{display:flex!important;align-items:center!important;gap:10px!important;flex-wrap:wrap!important;justify-content:flex-end!important}
      body:not(.login-body) .candidate-detail-full-panel .cc656-toolbar-select{min-width:250px!important;max-width:360px!important;height:42px!important;border-radius:13px!important;padding:0 14px!important;border:1px solid #bcd2ea!important;background:linear-gradient(180deg,#ffffff,#f5fbff)!important;color:#17385b!important;font-weight:900!important;box-shadow:0 6px 16px rgba(46,92,146,.10)!important}
      body:not(.login-body) .candidate-detail-full-panel .cc656-toolbar-btn{min-height:42px!important;border-radius:13px!important;padding:0 14px!important;font-weight:950!important;border:1px solid transparent!important;cursor:pointer!important;white-space:nowrap!important}
      body:not(.login-body) .candidate-detail-full-panel .cc656-pin-btn{background:linear-gradient(135deg,#ffb14f,#f1782a)!important;color:#fff!important;border-color:#ee8a32!important;box-shadow:0 10px 22px rgba(241,120,42,.20)!important}
      body:not(.login-body) .candidate-detail-full-panel .cc656-history-btn{background:linear-gradient(180deg,#ffffff,#eff6ff)!important;color:#264b73!important;border-color:#bdd0ea!important;box-shadow:0 8px 18px rgba(63,109,166,.12)!important}
      body:not(.login-body) .candidate-detail-full-panel .cc656-inline-presets{margin-top:12px!important;padding:14px!important;border-radius:20px!important;border:1px solid #c7daf0!important;background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(241,248,255,.98))!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.92),0 16px 34px rgba(30,74,126,.14)!important}
      body:not(.login-body) .candidate-detail-full-panel .cc656-inline-presets-head{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;margin-bottom:12px!important}
      body:not(.login-body) .candidate-detail-full-panel .cc656-inline-presets-title{font-size:15px!important;font-weight:950!important;color:#143759!important;letter-spacing:.01em!important}
      body:not(.login-body) .candidate-detail-full-panel .cc656-inline-presets-sub{font-size:11px!important;font-weight:800!important;color:#6882a0!important}
      body:not(.login-body) .candidate-detail-full-panel .cc656-inline-grid{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:12px!important}
      body:not(.login-body) .candidate-detail-full-panel .cc656-preset-card{min-height:92px!important;border:none!important;border-radius:18px!important;padding:12px 14px!important;display:grid!important;grid-template-columns:34px minmax(0,1fr)!important;gap:10px!important;align-items:flex-start!important;text-align:left!important;color:#fff!important;-webkit-text-fill-color:#fff!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.48),0 18px 32px rgba(18,49,89,.22)!important, 0 0 0 1px rgba(255,255,255,.08)!important;cursor:pointer!important;position:relative!important;overflow:hidden!important}
      body:not(.login-body) .candidate-detail-full-panel .cc656-preset-card::after{content:''!important;position:absolute!important;inset:0!important;background:linear-gradient(180deg,rgba(255,255,255,.28),rgba(255,255,255,0) 45%,rgba(255,255,255,.08))!important;pointer-events:none!important}
      body:not(.login-body) .candidate-detail-full-panel .cc656-preset-card .cc656-num{width:34px!important;height:34px!important;min-width:34px!important;border-radius:999px!important;display:grid!important;place-items:center!important;background:rgba(255,255,255,.94)!important;color:#17395b!important;-webkit-text-fill-color:#17395b!important;font-size:15px!important;font-weight:950!important;box-shadow:0 6px 14px rgba(18,48,84,.15)!important;position:relative!important;z-index:1!important}
      body:not(.login-body) .candidate-detail-full-panel .cc656-preset-card .cc656-text{font-size:14px!important;line-height:1.34!important;font-weight:950!important;letter-spacing:.01em!important;text-shadow:0 1px 2px rgba(8,28,55,.16)!important;position:relative!important;z-index:1!important;display:block!important;color:#fff!important;-webkit-text-fill-color:#fff!important;white-space:normal!important;word-break:break-word!important}
      body:not(.login-body) .candidate-detail-full-panel .cc656-tone-1{background:linear-gradient(135deg,#ffc34d 0%,#ff9328 45%,#ef5b00 100%)!important}
      body:not(.login-body) .candidate-detail-full-panel .cc656-tone-2{background:linear-gradient(135deg,#6cf29c 0%,#20c977 45%,#0f8f58 100%)!important}
      body:not(.login-body) .candidate-detail-full-panel .cc656-tone-3{background:linear-gradient(135deg,#6ed0ff 0%,#3e91ff 45%,#1b59ff 100%)!important}
      body:not(.login-body) .candidate-detail-full-panel .cc656-tone-4{background:linear-gradient(135deg,#bf8cff 0%,#8f5cff 45%,#6436df 100%)!important}
      body:not(.login-body) .candidate-detail-full-panel .cc656-tone-5{background:linear-gradient(135deg,#68ecf5 0%,#2ac9d6 45%,#11839d 100%)!important}
      body:not(.login-body) .candidate-detail-full-panel .cc656-tone-6{background:linear-gradient(135deg,#ff9ab3 0%,#ff5d8d 45%,#eb2e67 100%)!important}
      body:not(.login-body) .candidate-detail-full-panel .cc656-empty-hint{font-size:13px!important;font-weight:800!important;color:#6d85a0!important;padding:10px 4px!important}
      @media (max-width:1100px){body:not(.login-body) .candidate-detail-full-panel .cc656-inline-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
      @media (max-width:760px){body:not(.login-body) .candidate-detail-full-panel .cc656-inline-grid{grid-template-columns:1fr!important}body:not(.login-body) .candidate-detail-full-panel .cc656-toolbar{justify-content:stretch!important}body:not(.login-body) .candidate-detail-full-panel .cc656-toolbar-select,body:not(.login-body) .candidate-detail-full-panel .cc656-toolbar-btn{width:100%!important;max-width:none!important}}
    `;
    document.head.appendChild(s);
  }
  function cc656Unique(list){return Array.from(new Set((list||[]).map(x=>String(x||'').trim()).filter(Boolean)))}
  function cc656GetAllTemplates(panel){
    const select=panel.querySelector('select.note-template-select');
    return cc656Unique([...(select?select.options:[])].map(o=>String(o.value||'').trim()).filter(v=>v&&v!=='__add_new__'));
  }
  function cc656LoadPins(all){
    let pins=[];
    try{pins=JSON.parse(localStorage.getItem(CC656_PIN_KEY)||'[]')}catch(_){pins=[]}
    pins=cc656Unique(pins).filter(x=>all.includes(x));
    if(!pins.length)pins=all.slice(0,6);
    return pins.slice(0,6);
  }
  function cc656SavePins(pins){try{localStorage.setItem(CC656_PIN_KEY,JSON.stringify(cc656Unique(pins).slice(0,6)))}catch(_){}}
  function cc656ApplyPreset(panel,text){
    const textarea=panel.querySelector('.candidate-notes-main-textarea,textarea');
    if(textarea)cc652ReactSetTextarea(textarea,text);
  }
  function cc656RenderPinned(panel,all,pins){
    const inputCol=panel.querySelector('.candidate-notes-input-col');
    if(!inputCol)return;
    let host=inputCol.querySelector('.cc656-inline-presets');
    if(!host){host=document.createElement('div');host.className='cc656-inline-presets';const row=inputCol.querySelector('.row-actions'); if(row&&row.nextSibling) inputCol.insertBefore(host,row.nextSibling); else inputCol.appendChild(host)}
    host.innerHTML='';
    const head=document.createElement('div');head.className='cc656-inline-presets-head';
    const copy=document.createElement('div');
    copy.innerHTML='<div class="cc656-inline-presets-title">Pinned Preset Values</div><div class="cc656-inline-presets-sub">Only 6 show here. Use dropdown + Pin for more.</div>';
    head.appendChild(copy);host.appendChild(head);
    const grid=document.createElement('div');grid.className='cc656-inline-grid';
    if(!pins.length){const empty=document.createElement('div');empty.className='cc656-empty-hint';empty.textContent='No preset pinned yet.';grid.appendChild(empty)}
    pins.forEach((text,index)=>{
      const btn=document.createElement('button');btn.type='button';btn.className=`cc656-preset-card bounceable cc656-tone-${(index%6)+1}`;btn.title=text;
      btn.innerHTML=`<span class="cc656-num">${index+1}</span><span class="cc656-text"></span>`;
      btn.querySelector('.cc656-text').textContent=text;
      btn.addEventListener('click',()=>cc656ApplyPreset(panel,text));
      grid.appendChild(btn);
    });
    host.appendChild(grid);
  }
  function cc656BuildToolbar(panel,all,pins){
    const head=panel.querySelector('.panel-heading-row');
    if(!head)return;
    let tools=head.querySelector('.cc656-toolbar');
    if(!tools){tools=document.createElement('div');tools.className='cc656-toolbar';head.appendChild(tools)}
    tools.innerHTML='';
    const select=document.createElement('select');select.className='cc656-toolbar-select';
    select.innerHTML='<option value="">Choose preset value</option>';
    all.forEach((tpl)=>{const o=document.createElement('option');o.value=tpl;o.textContent=tpl.length>90?tpl.slice(0,90):tpl;select.appendChild(o)});
    const addNew=document.createElement('option');addNew.value='__add_new__';addNew.textContent='+ Add New Template';select.appendChild(addNew);
    const pin=document.createElement('button');pin.type='button';pin.className='cc656-toolbar-btn cc656-pin-btn bounceable';pin.textContent='Pin';
    const history=document.createElement('button');history.type='button';history.className='cc656-toolbar-btn cc656-history-btn bounceable';history.textContent='Open Notes History';
    const sourceHistory=[...panel.querySelectorAll('button')].find(btn=>/Open Notes History/i.test(btn.textContent||'') && !btn.classList.contains('cc656-history-btn'));
    history.disabled=!!(sourceHistory&&sourceHistory.disabled);
    history.addEventListener('click',()=>sourceHistory&&sourceHistory.click());
    select.addEventListener('change',()=>{
      const value=select.value;
      if(!value)return;
      if(value==='__add_new__'){
        const hidden=[...panel.querySelectorAll('select.note-template-select')].find(s=>s!==select);
        if(hidden){hidden.value='__add_new__';hidden.dispatchEvent(new Event('change',{bubbles:true}))}
        return;
      }
      cc656ApplyPreset(panel,value);
    });
    pin.addEventListener('click',()=>{
      const value=String(select.value||'').trim();
      if(!value)return;
      if(value==='__add_new__'){
        const hidden=[...panel.querySelectorAll('select.note-template-select')].find(s=>s!==select);
        if(hidden){hidden.value='__add_new__';hidden.dispatchEvent(new Event('change',{bubbles:true}))}
        return;
      }
      const next=[value,...pins.filter(x=>x!==value)];
      pins.splice(0,pins.length,...next.slice(0,6));
      cc656SavePins(pins);
      // CC26_718: user removed the six pinned preset cards; keep dropdown/history only.
      const obsolete=panel.querySelector('.cc656-inline-presets');
      if(obsolete) obsolete.remove();
      cc656BuildToolbar(panel,all,pins);
    });
    tools.appendChild(select);tools.appendChild(history);
  }
  function cc656InlinePinnedPresets(){
    // CC26_774: native React UI already provides this feature; no external DOM mutation.
    return;
  }


  // CC26_657: enforce requested Status dropdown options and remove custom add-new button.
  const CC657_STATUS_OPTIONS=['Draft','In - Progress','All set for Interview','Not Intrested','Rejected once, needs new Interview','Rejected','Appeared in Interview'];
  function cc657SyncStatusField(){
    // CC26_774: native React UI already provides this feature; no external DOM mutation.
    return;
  }
  const cc656BaseStabilizeCandidateUi=stabilizeCandidateUi;
  stabilizeCandidateUi=function(){
    cc656BaseStabilizeCandidateUi();
    cc656EnsureStyle();
    cc656InlinePinnedPresets();
    cc657SyncStatusField();
  };

  // CC26_544: never watch every childList mutation and then write textContent.
  // That repeatedly triggered its own observer and froze the real CRM after a theme click.
  let scheduled=false;
  function boot(){scheduled=false;restoreRealThemeChooser();cleanAppearancePanel();stabilizeCandidateUi();renderRowWiseDuplicateCompare()}
  function schedule(){if(scheduled)return;scheduled=true;requestAnimationFrame(boot)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  // Refresh only when a NEW candidate review/notes panel is inserted by React.
  // Ignore our own text updates and generated .cc524-duplicate-rowwise rows.
  const mo=new MutationObserver(records=>{
    const relevant='.candidate-notes-input-col,.cc524-duplicate-review-panel,.table-title';
    const fresh=records.some(r=>Array.from(r.addedNodes).some(node=>
      node.nodeType===1 && ((node.matches && node.matches(relevant)) ||
      (node.querySelector && node.querySelector(relevant)))));
    if(fresh)schedule();
  });
  const start=()=>{if(document.body)mo.observe(document.body,{subtree:true,childList:true})};
  if(document.body)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
})();


;(() => {
  'use strict';

  // CC26_537: soft-shell 10-theme system with login isolation and safe CC26_526 original-theme reset. Layout/card/button sizes are intentionally untouched.
  const THEMES = [
    ['orange','Orange',{page:'linear-gradient(130deg,#fff8f2,#fee9da)',side:'linear-gradient(150deg,#ffb14f,#f37321)',top:'linear-gradient(112deg,#fff9f5,#ffe5d3)',swatch:'linear-gradient(145deg,#ffb14f,#f37321)',glow:'linear-gradient(112deg,transparent,rgba(255,255,255,.2) 45%,transparent 70%)',shadow:'rgba(31,51,81,.10)'}],
    ['blue','Blue',{page:'linear-gradient(130deg,#f4f9ff,#e5f0ff)',side:'linear-gradient(150deg,#55b0ff,#1f73ff)',top:'linear-gradient(112deg,#f8fbff,#dbeaff)',swatch:'linear-gradient(145deg,#55b0ff,#1f73ff)',glow:'linear-gradient(112deg,transparent,rgba(255,255,255,.2) 45%,transparent 70%)',shadow:'rgba(31,51,81,.10)'}],
    ['green','Green',{page:'linear-gradient(130deg,#f4fdf8,#e2f8ec)',side:'linear-gradient(150deg,#45d987,#0fa95b)',top:'linear-gradient(112deg,#f8fdf9,#ddf7ea)',swatch:'linear-gradient(145deg,#45d987,#0fa95b)',glow:'linear-gradient(112deg,transparent,rgba(255,255,255,.2) 45%,transparent 70%)',shadow:'rgba(31,51,81,.10)'}],
    ['pink','Rose',{page:'linear-gradient(130deg,#fff8f9,#ffe4ec)',side:'linear-gradient(150deg,#f58aa7,#da4e75)',top:'linear-gradient(112deg,#fffcfd,#ffe8ee)',swatch:'linear-gradient(145deg,#f58aa7,#da4e75)',glow:'linear-gradient(112deg,transparent,rgba(255,255,255,.2) 45%,transparent 70%)',shadow:'rgba(31,51,81,.10)'}],
    ['purple','Purple',{page:'linear-gradient(130deg,#faf8ff,#f0eaff)',side:'linear-gradient(150deg,#b07bff,#7440e6)',top:'linear-gradient(112deg,#fdfbff,#ebe2ff)',swatch:'linear-gradient(145deg,#b07bff,#7440e6)',glow:'linear-gradient(112deg,transparent,rgba(255,255,255,.2) 45%,transparent 70%)',shadow:'rgba(31,51,81,.10)'}],
    ['gold','Gold',{page:'linear-gradient(130deg,#fffcf6,#fff2d8)',side:'linear-gradient(150deg,#f7ca53,#d39a1d)',top:'linear-gradient(112deg,#fffdf8,#fff1cf)',swatch:'linear-gradient(145deg,#f7ca53,#d39a1d)',glow:'linear-gradient(112deg,transparent,rgba(255,255,255,.2) 45%,transparent 70%)',shadow:'rgba(31,51,81,.10)'}],
    ['rose','Pink',{page:'linear-gradient(130deg,#fff9fc,#ffe8f4)',side:'linear-gradient(150deg,#fff3f9,#ffbedb)',top:'linear-gradient(112deg,#fffafd,#ffe6f1)',swatch:'linear-gradient(145deg,#fff3f9,#ffbedb)',glow:'linear-gradient(112deg,transparent,rgba(255,255,255,.2) 45%,transparent 70%)',shadow:'rgba(31,51,81,.10)'}],
    ['burgundy','Managers Only',{page:'linear-gradient(130deg,#fff8fb,#f3e7ec)',side:'linear-gradient(150deg,#9a4b66,#67203c)',top:'linear-gradient(112deg,#fffafd,#f0dce5)',swatch:'linear-gradient(145deg,#9a4b66,#67203c)',glow:'linear-gradient(112deg,transparent,rgba(255,255,255,.2) 45%,transparent 70%)',shadow:'rgba(31,51,81,.10)'}],
    ['dark-navy','Dark Navy',{page:'linear-gradient(130deg,#eef4fb,#dceafa)',side:'linear-gradient(150deg,#184685,#0f2853)',top:'linear-gradient(112deg,#edf5ff,#d8e6fb)',swatch:'linear-gradient(145deg,#184685,#0f2853)',glow:'linear-gradient(112deg,transparent,rgba(255,255,255,.2) 45%,transparent 70%)',shadow:'rgba(31,51,81,.10)'}],
    ['midnight','Midnight',{page:'linear-gradient(130deg,#101d31,#22344b)',side:'linear-gradient(150deg,#1b2b45,#0e1727)',top:'linear-gradient(112deg,#223854,#17273e)',swatch:'linear-gradient(145deg,#1b2b45,#0e1727)',glow:'linear-gradient(112deg,transparent,rgba(255,255,255,.2) 45%,transparent 70%)',shadow:'rgba(31,51,81,.10)'}],
    ['dark-midnight','Dark Sapphire',{page:'linear-gradient(135deg,#182b4a,#101e34)',side:'linear-gradient(160deg,#192a4a,#09172d)',top:'linear-gradient(112deg,#192a4a,#09172d)',swatch:'linear-gradient(145deg,#192a4a,#09172d)',glow:'none',shadow:'rgba(13,19,38,.28)'}],
    ['crimson-noir','Crimson Noir',{page:'linear-gradient(135deg,#32121f,#15131e)',side:'linear-gradient(160deg,#6a152c,#090d18)',top:'linear-gradient(112deg,#6a152c,#090d18)',swatch:'linear-gradient(145deg,#6a152c,#090d18)',glow:'none',shadow:'rgba(13,19,38,.28)'}],
    ['cosmic-berry','Cosmic Berry',{page:'linear-gradient(135deg,#321d4b,#152e5a)',side:'linear-gradient(160deg,#703047,#173f7f)',top:'linear-gradient(112deg,#703047,#173f7f)',swatch:'linear-gradient(145deg,#703047,#173f7f)',glow:'none',shadow:'rgba(13,19,38,.28)'}],
    ['magenta-pop','Magenta Pop',{page:'linear-gradient(130deg,#fff1fa,#fce0fb)',side:'linear-gradient(150deg,#fa62d0,#b72cc7)',top:'linear-gradient(112deg,#fff8fe,#f5d6fb)',swatch:'linear-gradient(145deg,#ef8ddb,#b72cc7)',glow:'none',shadow:'rgba(80,65,155,.12)'}],
    ['neon-ink','Neon Ink',{page:'linear-gradient(130deg,#111427,#192647)',side:'linear-gradient(150deg,#1b1d38,#071422)',top:'linear-gradient(112deg,#1b1328,#14152a)',swatch:'linear-gradient(145deg,#f642bb,#071422)',glow:'none',shadow:'rgba(14,13,35,.24)'}],
    ['berry-chrome','Berry Chrome',{page:'linear-gradient(130deg,#2d132b,#241539)',side:'linear-gradient(150deg,#69234f,#201333)',top:'linear-gradient(112deg,#431c37,#311b43)',swatch:'linear-gradient(145deg,#e96cd1,#201333)',glow:'none',shadow:'rgba(14,13,35,.24)'}],
    ['ice-lilac','Ice Lilac',{page:'linear-gradient(130deg,#f2f6ff,#f2e5ff)',side:'linear-gradient(150deg,#cfc1ff,#8f9dfa)',top:'linear-gradient(112deg,#f9fcff,#e4defc)',swatch:'linear-gradient(145deg,#acb9ff,#8f9dfa)',glow:'none',shadow:'rgba(80,65,155,.12)'}],
  ];

  THEMES.sort((a,b) => (a[0]==='crimson-noir' ? -1 : b[0]==='crimson-noir' ? 1 : a[0]==='burgundy' ? -1 : b[0]==='burgundy' ? 1 : 0));
  const KEYS = THEMES.map(x => x[0]);
  const MAP = Object.fromEntries(THEMES.map(x => [x[0], x]));
  const SAVED_KEY = 'careerCroxApprovedV12Theme';
  const ORIGINAL_THEME = 'peach-sky';
  function managerThemeAllowed(){
    try { const u=JSON.parse(localStorage.getItem('careerCroxCachedUser')||'null');
      return [u?.role,u?.designation].some(v=>String(v||'').trim().toLowerCase()==='manager');
    }catch(_){return false;}
  }
  function syncManagerFlag(){
    document.documentElement.dataset.ccBurgundyAllowed=managerThemeAllowed()?'1':'0';
  }
  function allowedTheme(t){return (t!=='burgundy'&&t!=='crimson-noir')||managerThemeAllowed();}

  let applying = false;

  function ensurePolishCss(){
    if(document.getElementById('cc26-535-theme-polish')) return;
    const style = document.createElement('style');
    style.id = 'cc26-535-theme-polish';
    style.textContent = `
      .sidebar,.topbar{transition:background-color .18s ease,border-color .18s ease!important}
      body::before{content:"";position:fixed;inset:-18%;pointer-events:none;z-index:0;background:var(--cc535-glow,none);opacity:.75;transform:rotate(-2deg)}
      #root,.app-shell,.main-wrap,.page-scroll{position:relative;z-index:1}
      .sidebar,.topbar{backdrop-filter:blur(16px) saturate(1.14)!important;-webkit-backdrop-filter:blur(16px) saturate(1.14)!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.58),0 10px 28px var(--cc535-shadow,rgba(20,50,90,.12))!important}
      .sidebar{border-right-color:rgba(255,255,255,.45)!important}
      .topbar{border-color:rgba(255,255,255,.48)!important}
      [data-theme="dark-navy"] .sidebar,[data-theme="dark-navy"] .topbar,[data-theme="midnight"] .sidebar,[data-theme="midnight"] .topbar{color:#f7fbff!important}
      [data-theme="dark-navy"] .sidebar a,[data-theme="dark-navy"] .sidebar button,[data-theme="dark-navy"] .sidebar span,[data-theme="dark-navy"] .sidebar strong,[data-theme="midnight"] .sidebar a,[data-theme="midnight"] .sidebar button,[data-theme="midnight"] .sidebar span,[data-theme="midnight"] .sidebar strong{color:#f7fbff!important;-webkit-text-fill-color:#f7fbff!important}
      [data-theme="dark-navy"] .sidebar .prominent-theme-box,[data-theme="midnight"] .sidebar .prominent-theme-box,[data-theme="dark-navy"] .sidebar .prominent-theme-box :is(.theme-heading,.theme-look-copy,.theme-choice-copy,.theme-look-copy strong,.theme-choice-copy strong,.theme-look-copy small,.theme-choice-copy small,.theme-look-action,.theme-choice-status,.helper-text,.selection-count-chip,.theme-select-shell,.theme-select-shell span,.custom-theme-box),[data-theme="midnight"] .sidebar .prominent-theme-box :is(.theme-heading,.theme-look-copy,.theme-choice-copy,.theme-look-copy strong,.theme-choice-copy strong,.theme-look-copy small,.theme-choice-copy small,.theme-look-action,.theme-choice-status,.helper-text,.selection-count-chip,.theme-select-shell,.theme-select-shell span,.custom-theme-box){color:#173052!important;-webkit-text-fill-color:#173052!important;opacity:1!important}
      [data-theme="dark-navy"] .sidebar .prominent-theme-box :is(.theme-look-option,.theme-choice-card,.custom-theme-box,.theme-select-shell,.selection-count-chip),[data-theme="midnight"] .sidebar .prominent-theme-box :is(.theme-look-option,.theme-choice-card,.custom-theme-box,.theme-select-shell,.selection-count-chip){background:linear-gradient(145deg,rgba(255,255,255,.98),rgba(235,243,252,.95))!important;color:#173052!important;-webkit-text-fill-color:#173052!important;border-color:#c4d4e7!important}
      [data-theme="dark-navy"] .sidebar .prominent-theme-box .theme-heading-row>.ghost-btn,[data-theme="midnight"] .sidebar .prominent-theme-box .theme-heading-row>.ghost-btn,[data-theme="dark-navy"] .sidebar .prominent-theme-box .custom-theme-box .ghost-btn:not(.custom-theme-reset),[data-theme="midnight"] .sidebar .prominent-theme-box .custom-theme-box .ghost-btn:not(.custom-theme-reset){background:linear-gradient(145deg,#fff,#eaf2fb)!important;color:#173052!important;-webkit-text-fill-color:#173052!important;border-color:#bfd0e6!important;opacity:1!important;text-shadow:none!important}
      [data-theme="dark-navy"] .sidebar .prominent-theme-box select,[data-theme="midnight"] .sidebar .prominent-theme-box select{background:#fff!important;color:#173052!important;-webkit-text-fill-color:#173052!important;border-color:#bfd0e6!important;opacity:1!important}
      [data-theme="dark-navy"] .sidebar .prominent-theme-box :is(.theme-look-number,.theme-choice-number,.custom-theme-reset),[data-theme="midnight"] .sidebar .prominent-theme-box :is(.theme-look-number,.theme-choice-number,.custom-theme-reset){color:#fff!important;-webkit-text-fill-color:#fff!important;opacity:1!important}
    `;
    document.head.appendChild(style);
  }

  function savedTheme(){
    try{
      const saved = String(localStorage.getItem(SAVED_KEY) || '').toLowerCase();
      if(KEYS.includes(saved) && allowedTheme(saved)) return saved;
      const legacy = String(localStorage.getItem('careerCroxTheme') || '').toLowerCase();
      if(legacy === ORIGINAL_THEME) return '__original__';
      return KEYS.includes(legacy) && allowedTheme(legacy) ? legacy : 'orange';
    }catch(_){ return 'orange'; }
  }

  function importantBackground(el, value){
    if(!el) return;
    el.style.setProperty('background', value, 'important');
    el.style.setProperty('background-image', value, 'important');
    el.style.setProperty('background-attachment', 'fixed', 'important');
  }

  function isLoginSurface(){
    try{
      const path = String(window.location && window.location.pathname || '').toLowerCase();
      const body = document.body;
      return path === '/login' || path.startsWith('/login/') || !!(body && (body.classList.contains('login-body') || body.classList.contains('cc-style15-login-body'))) || !!document.querySelector('.cc-style15-login');
    }catch(_){ return false; }
  }

  function clearInlineSurfaceBackgrounds(){
    [document.body,...document.querySelectorAll('.app-shell,.main-wrap,.page-scroll,.sidebar,.topbar')].filter(Boolean).forEach((el)=>{
      el.style.removeProperty('background');
      el.style.removeProperty('background-image');
      el.style.removeProperty('background-attachment');
    });
  }

  function applySurface(theme){
    ensurePolishCss();
    const spec = MAP[theme] || MAP.orange;
    // CC26_537: never paint saturated theme gradients directly onto the CRM.
    // The stylesheet's data-theme rules own the shell: stronger sidebar, soft topbar,
    // very light page tint, while cards/tables/forms keep their original surfaces.
    clearInlineSurfaceBackgrounds();
    if(isLoginSurface()){
      document.documentElement.style.removeProperty('--cc535-glow');
      document.documentElement.style.removeProperty('--cc535-shadow');
      return;
    }
    document.documentElement.style.setProperty('--cc535-glow', spec[2].glow);
    document.documentElement.style.setProperty('--cc535-shadow', spec[2].shadow);
  }

  function allThemeOptions(){
    const look = [...document.querySelectorAll('.theme-look-list .theme-look-option')];
    if(look.length) return look;
    return [...document.querySelectorAll('.theme-choice-grid .theme-choice-card')];
  }

  function syncOptions(theme){
    const cards = allThemeOptions();
    cards.forEach((card,index) => {
      const t = THEMES.find(x=>card.classList.contains('theme-'+x[0])); if(!t) return;
      const restricted = (t[0]==='burgundy'||t[0]==='crimson-noir') && !managerThemeAllowed();
      if(card.hidden) card.hidden=false;
      if(restricted){
        card.setAttribute('aria-disabled','true');card.setAttribute('title','Managers Only');
        card.dataset.managerOnly='1';
      }else{
        card.removeAttribute('aria-disabled');card.removeAttribute('data-manager-only');
        card.setAttribute('title',t[1]+' theme');
      }
      card.dataset.cc531Theme = t[0];
      card.classList.toggle('active-theme', t[0] === theme);
      card.setAttribute('aria-label', restricted ? 'Managers Only — available to managers' : t[1] + ' theme');
      const strong = card.querySelector('.theme-look-copy strong,.theme-choice-copy strong');
      const small = card.querySelector('.theme-look-copy small,.theme-choice-copy small');
      const status = card.querySelector('.theme-look-action,.theme-choice-status');
      const number = card.querySelector('.theme-look-number,.theme-choice-number');
      if(strong && strong.textContent !== t[1]) strong.textContent = t[1];
      if(small){const exclusive=t[0]==='burgundy'||t[0]==='crimson-noir';const label=exclusive?'Managers Only':t[0]===theme?'Active':'Tap to apply';if(small.textContent!==label)small.textContent=label;}
      if(status){const label=restricted?'Locked':t[0]===theme?'Active':'Choose';if(status.textContent!==label)status.textContent=label;}
      if(number){
        const label=t[0]===theme?'✓':String(index+1);
        if(number.textContent!==label)number.textContent=label;
        number.style.setProperty('background', t[2].swatch, 'important');
        number.style.setProperty('box-shadow', 'inset 0 1px 0 rgba(255,255,255,.62),0 5px 14px '+t[2].shadow, 'important');
        number.style.setProperty('color', '#fff', 'important');
        number.style.setProperty('-webkit-text-fill-color', '#fff', 'important');
      }
    });
  }


  function styleResetButton(el){
    if(!el) return;
    try{
      el.disabled = false;
      el.removeAttribute('disabled');
      el.removeAttribute('aria-disabled');
      el.textContent = 'Reset Original Theme';
      el.title = 'Restore the exact original CC26_526 CRM theme';
      const st = el.style;
      st.setProperty('background','linear-gradient(135deg,#ff7a18 0%,#ff5b3d 46%,#e92f61 100%)','important');
      st.setProperty('color','#ffffff','important');
      st.setProperty('-webkit-text-fill-color','#ffffff','important');
      st.setProperty('border','1px solid rgba(255,255,255,.88)','important');
      st.setProperty('box-shadow','inset 0 1px 0 rgba(255,255,255,.55),0 10px 24px rgba(210,54,64,.28)','important');
      st.setProperty('text-shadow','0 1px 2px rgba(83,18,28,.52)','important');
      st.setProperty('opacity','1','important');
      st.setProperty('filter','none','important');
      st.setProperty('visibility','visible','important');
      st.setProperty('font-size','13px','important');
      st.setProperty('font-weight','1000','important');
      st.setProperty('line-height','1.24','important');
      st.setProperty('cursor','pointer','important');
    }catch(_){ }
  }

  function removeOldColourTools(){
    document.querySelectorAll('.theme-labels').forEach(el => el.remove());
    document.querySelectorAll('.custom-theme-box').forEach(box => {
      box.querySelectorAll('.custom-theme-title').forEach(el => el.remove());
      box.querySelectorAll('.theme-slider-row,.custom-theme-grid').forEach(el => el.remove());
      box.querySelectorAll('.theme-select-row').forEach(el => {
        if(/Background Colour/i.test(el.textContent || '')) el.remove();
      });
      box.querySelectorAll('.custom-theme-save').forEach(el => el.remove());
      box.querySelectorAll('.custom-theme-reset').forEach(el => {
        styleResetButton(el);
      });
    });
  }

  function clearSurfaceOverrides(){
    ['--cc535-glow','--cc535-shadow'].forEach((key)=>document.documentElement.style.removeProperty(key));
    [document.body,...document.querySelectorAll('.app-shell,.main-wrap,.page-scroll,.sidebar,.topbar')].filter(Boolean).forEach((el)=>{
      el.style.removeProperty('background');
      el.style.removeProperty('background-image');
      el.style.removeProperty('background-attachment');
    });
  }

  function persistThemeName(name){
    try{
      fetch('/api/theme',{
        method:'POST',credentials:'include',
        headers:{'Content-Type':'application/json','X-Career-Crox-Background':'1'},
        body:JSON.stringify({theme_name:name,custom_theme_json:''})
      }).catch(()=>{});
    }catch(_){ }
  }

  function resetOriginalTheme(remember=true){
    if(applying) return;
    applying = true;
    try{
      clearStaleCustomThemeVars?.();
    }catch(_){ }
    try{
      localStorage.removeItem(SAVED_KEY);
      localStorage.removeItem('careerCroxCustomTheme');
      localStorage.setItem('careerCroxTheme', ORIGINAL_THEME);
    }catch(_){ }
    clearSurfaceOverrides();
    document.documentElement.setAttribute('data-theme', ORIGINAL_THEME);
    syncOptions('__original__');
    removeOldColourTools();
    document.querySelectorAll('.custom-theme-reset').forEach((b)=>{
      styleResetButton(b);
    });
    if(remember) persistThemeName(ORIGINAL_THEME);
    applying = false;
  }

  function applyTheme(theme, remember=true){
    if(!KEYS.includes(theme) || !allowedTheme(theme)) theme = 'orange';
    if(applying) return;
    applying = true;
    try{
      try{
        localStorage.removeItem('careerCroxCustomTheme');
        localStorage.setItem('careerCroxTheme', theme);
        if(remember) localStorage.setItem(SAVED_KEY, theme);
      }catch(_){ }
      document.documentElement.setAttribute('data-theme', theme);
      applySurface(theme);
      syncOptions(theme);
      removeOldColourTools();
      document.querySelectorAll('.custom-theme-reset').forEach((b)=>{styleResetButton(b)});
      if(remember) persistThemeName(theme);
    } finally { applying = false; }
  }

  // CC26_544: React owns allowed clicks; never intercept them in capture phase.
  // Otherwise its theme state stays stale and next render reverts active selections.
  // Only block direct attempts to select manager-only Burgundy.
  document.addEventListener('click', (event) => {
    const card=event.target && event.target.closest && event.target.closest('.theme-look-option.theme-burgundy,.theme-choice-card.theme-burgundy,.theme-look-option.theme-crimson-noir,.theme-choice-card.theme-crimson-noir');
    if(card && !managerThemeAllowed()){
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
    }
  },true);
  const attrObserver = new MutationObserver(() => {
    if(applying) return;
    syncManagerFlag();
    let chosen=String(document.documentElement.getAttribute('data-theme')||'orange').toLowerCase();
    if((chosen==='burgundy'||chosen==='crimson-noir') && !managerThemeAllowed()){
      chosen='orange';document.documentElement.setAttribute('data-theme',chosen);
      try{localStorage.setItem('careerCroxTheme',chosen)}catch(_){}
    }
    // React has committed this theme, so mirror it; do not overwrite React from
    // a stale approved-key and do not write the DOM attribute again.
    try{if(chosen===ORIGINAL_THEME)localStorage.removeItem(SAVED_KEY);
        else if(KEYS.includes(chosen))localStorage.setItem(SAVED_KEY,chosen)}catch(_){}
    syncOptions(chosen===ORIGINAL_THEME?'__original__':chosen);
  });
  attrObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});

  // CC26_543: React may remount Appearance. Observe only NEW relevant elements.
  // Updating textContent inside the options/reset button creates childList records.
  // Never schedule another refresh for those records (the old code ran on EVERY
  // mutation and created an endless requestAnimationFrame -> mutation loop).
  let scheduled = false;
  const domObserver = new MutationObserver((changes) => {
    if(scheduled || applying) return;
    const isThemeElement = (node) => node && node.nodeType === 1 && (
      (node.matches && node.matches('.prominent-theme-box,.theme-panel-body,.theme-look-list,.theme-choice-grid,.theme-look-option,.theme-choice-card')) ||
      (node.querySelector && node.querySelector('.prominent-theme-box,.theme-panel-body,.theme-look-list,.theme-choice-grid,.theme-look-option,.theme-choice-card'))
    );
    if(!changes.some(record => Array.from(record.addedNodes).some(isThemeElement))) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if(applying) return;
      const t = savedTheme();
      // The observer watches only React insertions, NOT our own updates.
      syncManagerFlag();
      if(t === '__original__') syncOptions('__original__');
      else syncOptions(t);
      removeOldColourTools();
    });
  });
  function boot(){
    syncManagerFlag();
    // CC921: React owns palettes. Legacy boot only decorates the theme controls.
    if(window.__CC921_REACT_THEME_OWNER__){
      const chosen=document.documentElement.dataset.theme||savedTheme();
      syncOptions(chosen===ORIGINAL_THEME?'__original__':chosen);
      removeOldColourTools();
    }else{
      const initial=savedTheme(); if(initial==='__original__') resetOriginalTheme(false); else applyTheme(initial, false);
    }
    if(document.body) domObserver.observe(document.body,{childList:true,subtree:true});
  }
  window.addEventListener('storage', e=>{if(e.key==='careerCroxCachedUser'){syncManagerFlag();const t=window.__CC921_REACT_THEME_OWNER__?document.documentElement.dataset.theme:savedTheme();if(!window.__CC921_REACT_THEME_OWNER__&&t!=='__original__')applyTheme(t,false);syncOptions(t);}});
  window.__CC532_APPLY_THEME = (theme)=>applyTheme(theme,true);
  window.__CC532_RESET_THEME = ()=>resetOriginalTheme(true);

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true}); else boot();
})();


;(function(){
  'use strict';
  window.__CC_CHAT_MANUAL_ONLY__=true;
  window.__CC_CHAT_LIVE_PUSH__=true;
  if (window.__CC26_489_UI_SAFE__) return;
  window.__CC26_489_UI_SAFE__ = true;

  var TRACK_KEY = 'cc456_session_activity_state';
  var FULL_DAY_MS = 9 * 60 * 60 * 1000;
  var lastState = null;
  var timerRecoveryBusy = false;
  var timerRecoveryAt = 0;
  var timerRecoveryStatus = '';
  var timerRecoveryMarker = '';

  function readState(){
    try { return JSON.parse(localStorage.getItem(TRACK_KEY) || '{}') || {}; }
    catch (_) { return {}; }
  }
  function minsLabelFromMs(ms, roundUp){
    var raw = Math.max(0, Number(ms || 0) || 0) / 60000;
    var mins = roundUp ? Math.ceil(raw) : Math.floor(raw);
    var h = Math.floor(mins / 60), m = mins % 60;
    return h + 'h ' + m + 'm';
  }
  function hms(ms){
    var sec = Math.max(0, Math.floor((Number(ms || 0) || 0) / 1000));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
  }
  function stateNow(extra){
    var x = Object.assign({}, lastState || {}, readState(), extra || {});
    lastState = x;
    return x;
  }
  function activeMs(x){ return Math.max(0, Number(x.active_elapsed_ms != null ? x.active_elapsed_ms : x.active_ms) || 0); }
  function idleMs(x){ return Math.max(0, Number(x.idle_ms || 0) || 0); }
  function breakMs(x){ return Math.max(0, Number(x.break_ms || 0) || 0); }
  function remainingMs(x){ return Math.max(0, FULL_DAY_MS - activeMs(x)); }
  function timerIdentity(){
    try {
      var u=JSON.parse(localStorage.getItem('careerCroxCachedUser')||'{}')||{};
      return String(u.user_id||u.recruiter_code||u.username||u.email||'').trim();
    } catch (_) { return ''; }
  }
  function timerLoginMarker(){ try { return String(localStorage.getItem('careerCroxSessionLoginAt')||'').trim(); } catch (_) { return ''; } }
  function timerJoinState(){
    try {
      var j=JSON.parse(localStorage.getItem('careerCroxOfficeJoinedSession')||'null');
      var id=timerIdentity(), mk=timerLoginMarker();
      if(j&&id&&mk&&String(j.identity||'')===id&&j.joined_at&&j.manual_confirmed_at){var today=new Date(Date.now()+19800000).toISOString().slice(0,10),day=new Date(new Date(j.joined_at).getTime()+19800000).toISOString().slice(0,10);if(day===today)return j;}
    } catch (_) {}
    return null;
  }
  function timerStateValid(){
    var id=timerIdentity(), mk=timerLoginMarker(), st=readState();
    if(!id||!mk)return false;
    // Only current Join Office state may create a running timer. Old local totals
    // alone must not spawn a second pill that the canonical timer immediately removes.
    return !!timerJoinState();
  }
  function ensureCanonicalTimerPill(){
    if(/\/login(?:\/|$)/i.test(location.pathname||''))return null;
    if(!timerIdentity()||window.__CC602_NETWORK_PAUSED__)return null; // Visible before Join Office; never claim active time before verified join.
    var top=document.querySelector('.topbar-right'); if(!top)return null;
    var pill=top.querySelector('.cc456-work-timer-pill');
    if(!pill){
      pill=document.createElement('div');
      pill.className='cc456-work-timer-pill cc490-timer-restored';
      pill.title='Working Time = real active work only. Break, idle and lock are excluded.';
      pill.innerHTML='<span class="cc456-dot"></span><span class="cc490-timer-copy"><div class="cc456-label">Working Time</div><div class="cc456-value">00:00:00</div><div class="cc456-sub">Active work</div></span><div class="cc456-progress"><span></span></div>';
      top.insertBefore(pill,top.firstChild);
    }
    return pill;
  }

  function recoverTimerSession(force){
    if(/\/login(?:\/|$)/i.test(location.pathname||''))return;
    var id=timerIdentity(), mk=timerLoginMarker();
    if(!id||!mk||timerStateValid())return;
    var now=Date.now();
    if(timerRecoveryMarker!==mk){timerRecoveryMarker=mk;timerRecoveryAt=0;timerRecoveryStatus='';}
    if(timerRecoveryBusy)return;
    if(!force&&timerRecoveryAt)return; // One-shot only per login; no recurring attendance GET.
    timerRecoveryBusy=true;timerRecoveryAt=now;timerRecoveryStatus='restoring';
    canonicalTimer({});
    fetch('/api/attendance?compact=1',{credentials:'include',headers:{'X-Career-Crox-Background':'1','Cache-Control':'no-cache'}})
      .then(function(r){if(!r.ok)throw new Error('attendance');return r.json()})
      .then(function(d){
        var stats=d&&d.today_stats||{}, presence=d&&d.presence||{};
        if(stats&&stats.joined_today&&stats.manual_join_confirmed==='1'&&window.__CC723_OFFICE_RESTORE__?.(d)){
          timerRecoveryStatus='restored';
          setTimeout(function(){canonicalTimer({locked:String(presence.locked||'0')==='1',on_break:String(presence.is_on_break||'0')==='1'});},30);
        }else{
          if(!stats.joined_today)window.__CC722_OFFICE_SERVER_UNJOINED__?.();
          timerRecoveryStatus='not_joined';
          canonicalTimer({});
        }
      })
      .catch(function(){timerRecoveryStatus='retry';canonicalTimer({})})
      .finally(function(){timerRecoveryBusy=false});
  }

  function injectStyle(){
    if (document.getElementById('cc26-464-office-chat-style')) return;
    var style = document.createElement('style');
    style.id = 'cc26-464-office-chat-style';
    style.textContent = `
      /* CC26_464: exactly one topbar Working Time owner. */
      .topbar-right .cc379-work-timer-pill,
      .topbar-right .cc376-work-timer-pill,
      .topbar-right .cc378-work-timer-pill,
      .topbar-right .cc399-session-work-pill,
      .topbar-right .cc408-work-timer-pill,
      .topbar-right .cc445-work-timer-pill,
      .topbar-right .cc455-work-timer-pill,
      .topbar-right .cc456-work-pill{display:none!important;visibility:hidden!important;pointer-events:none!important;width:0!important;min-width:0!important;max-width:0!important;padding:0!important;margin:0!important;border:0!important;overflow:hidden!important;}
      .topbar-right .cc456-work-timer-pill.cc630-await-join{display:flex!important;visibility:visible!important}
      .topbar-right .cc456-work-timer-pill{display:flex!important;visibility:visible!important;pointer-events:auto!important;position:relative!important;height:50px!important;min-height:50px!important;width:160px!important;min-width:160px!important;max-width:160px!important;flex:0 0 160px!important;padding:6px 12px 11px!important;border-radius:16px!important;background:linear-gradient(135deg,#ffffff 0%,#eff8ff 52%,#f2fff7 100%)!important;border:1px solid rgba(80,157,233,.42)!important;box-shadow:0 10px 24px rgba(37,99,235,.12)!important;align-items:center!important;gap:10px!important;color:#10233f!important;-webkit-text-fill-color:#10233f!important;overflow:hidden!important;margin:0!important;}
      .topbar-right .cc456-work-timer-pill .cc456-dot{width:9px!important;height:9px!important;border-radius:999px!important;background:#22c55e!important;box-shadow:0 0 0 4px rgba(34,197,94,.13)!important;flex:0 0 9px!important;}
      .topbar-right .cc456-work-timer-pill.idle .cc456-dot{background:#f59e0b!important;box-shadow:0 0 0 4px rgba(245,158,11,.15)!important;}
      .topbar-right .cc456-work-timer-pill.break .cc456-dot{background:#f97316!important;}
      .topbar-right .cc456-work-timer-pill.locked .cc456-dot{background:#ef4444!important;}
      .topbar-right .cc456-work-timer-pill .cc456-label{font-size:8px!important;font-weight:1000!important;text-transform:uppercase!important;letter-spacing:.08em!important;color:#64748b!important;-webkit-text-fill-color:#64748b!important;line-height:1!important;}
      .topbar-right .cc456-work-timer-pill .cc456-value{font:1000 16px/1.05 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace!important;font-variant-numeric:tabular-nums!important;color:#10233f!important;-webkit-text-fill-color:#10233f!important;margin-top:2px!important;}
      .topbar-right .cc456-work-timer-pill .cc456-sub{font-size:8px!important;font-weight:900!important;color:#64748b!important;-webkit-text-fill-color:#64748b!important;line-height:1!important;margin-top:3px!important;white-space:nowrap!important;}
      .topbar-right .cc456-work-timer-pill .cc456-progress{position:absolute!important;left:10px!important;right:10px!important;bottom:4px!important;height:6px!important;border-radius:999px!important;background:linear-gradient(90deg,rgba(239,68,68,.16),rgba(245,158,11,.13),rgba(34,197,94,.14))!important;overflow:hidden!important;box-shadow:inset 0 1px 3px rgba(15,23,42,.12)!important;}
      .topbar-right .cc456-work-timer-pill .cc456-progress span{display:block!important;height:100%!important;width:0;border-radius:999px!important;background:#ef4444;transition:width .4s ease,background .4s ease!important;}
      @media(max-width:1320px){.topbar-right .cc456-work-timer-pill{width:152px!important;min-width:152px!important;max-width:152px!important;flex-basis:152px!important;padding-left:10px!important;padding-right:10px!important}.topbar-right .cc456-work-timer-pill .cc456-value{font-size:15px!important}.topbar-right .cc456-work-timer-pill .cc456-sub{font-size:7.5px!important}}

      /* CC26_640: Work-time digits must never fade, pulse, or shift width. */
      .topbar-right .cc456-work-timer-pill,
      .topbar-right .cc456-work-timer-pill .cc456-value,
      .topbar-right .cc456-work-timer-pill .cc456-label,
      .topbar-right .cc456-work-timer-pill .cc456-sub{
        animation:none!important;transition:none!important;opacity:1!important;visibility:visible!important;
      }
      .topbar-right .cc456-work-timer-pill .cc456-value{
        display:block!important;min-width:8ch!important;white-space:nowrap!important;
        font-variant-numeric:tabular-nums!important;font-feature-settings:"tnum" 1!important;
      }

      /* Attendance: separate dashboard colours, same metrics everywhere. */
      body.cc464-attendance .attendance-card-grid:first-of-type .attendance-metric-card:nth-child(1){background:linear-gradient(135deg,#3157f4 0%,#6c47d9 58%,#a83ba9 100%)!important;}
      body.cc464-attendance .attendance-card-grid:first-of-type .attendance-metric-card:nth-child(2){background:linear-gradient(135deg,#ff5c45 0%,#ff7b39 55%,#ffb13b 100%)!important;}
      body.cc464-attendance .attendance-card-grid:first-of-type .attendance-metric-card:nth-child(3){background:linear-gradient(135deg,#3d73f1 0%,#37aaf2 55%,#42c9ea 100%)!important;}
      body.cc464-attendance .attendance-card-grid:first-of-type .attendance-metric-card:nth-child(4){background:linear-gradient(135deg,#159f67 0%,#42c958 56%,#a8d938 100%)!important;}
      body.cc464-attendance .attendance-card-grid:first-of-type .attendance-metric-card:nth-child(5){background:linear-gradient(135deg,#ff4a7d 0%,#ef4d79 55%,#ff8b70 100%)!important;}
      body.cc464-attendance .attendance-card-grid:first-of-type .attendance-metric-card,
      body.cc464-attendance .attendance-card-grid:first-of-type .attendance-metric-card *{color:#fff!important;-webkit-text-fill-color:#fff!important;}
      body.cc464-attendance .attendance-progress-bar{height:10px!important;border-radius:999px!important;background:linear-gradient(90deg,#fee2e2 0%,#fef3c7 50%,#dcfce7 100%)!important;box-shadow:inset 0 1px 3px rgba(15,23,42,.12)!important;overflow:hidden!important;}
      body.cc464-attendance .attendance-progress-bar>span{height:100%!important;border-radius:999px!important;background:linear-gradient(90deg,#ef4444,#f59e0b 55%,#22c55e)!important;transition:width .45s ease!important;}

      /* Team Chat: Hike/Instagram-inspired web messaging UI — light, fast, modern. */
      body.cc464-chat .page-scroll{overflow:hidden!important;padding:10px 12px 12px!important;background:linear-gradient(180deg,#f6f8fc 0%,#f2f6fb 100%)!important;}
      body.cc464-chat .teamsShell{height:calc(100vh - 92px)!important;min-height:0!important;margin:0!important;grid-template-columns:minmax(245px,285px) minmax(500px,1fr) minmax(225px,265px)!important;gap:10px!important;overflow:hidden!important;font-family:Inter,"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,sans-serif!important;}
      body.cc464-chat .teamsPanel{border:1px solid rgba(148,163,184,.20)!important;border-radius:22px!important;background:#fff!important;box-shadow:0 16px 42px rgba(15,23,42,.08)!important;overflow:hidden!important;}
      body.cc464-chat .teamsPanel::before{height:3px!important;background:linear-gradient(90deg,#4f7cff,#23b5d3,#35c779,#f59e0b)!important;}

      body.cc464-chat .teamsLeft{padding:12px!important;background:linear-gradient(180deg,#ffffff 0%,#f7fbff 48%,#f8fbfa 100%)!important;}
      body.cc464-chat .teamsTopActions{gap:7px!important;margin-bottom:9px!important;}
      body.cc464-chat .teamsAction{border-radius:13px!important;padding:9px 10px!important;font-size:12px!important;box-shadow:none!important;}
      body.cc464-chat .teamsAction.primary{background:linear-gradient(135deg,#4f7cff,#3a8cf0 55%,#22b8a7)!important;}
      body.cc464-chat .teamsSearch{height:40px!important;border-radius:13px!important;background:#f4f7fb!important;border:1px solid #dbe4ef!important;font-size:12.5px!important;}
      body.cc464-chat .teamsTabs button{border-radius:12px!important;padding:8px 5px!important;background:#f7f9fc!important;border-color:#e3e8f0!important;font-size:11px!important;}
      body.cc464-chat .teamsTabs button.active{background:linear-gradient(135deg,#eaf1ff,#e8fbf5)!important;color:#3157c8!important;border-color:#b9cdfc!important;}
      body.cc464-chat .threadBtn,body.cc464-chat .personBtn{min-height:50px!important;border-radius:15px!important;border:1px solid transparent!important;background:#fff!important;padding:9px 10px!important;margin-bottom:5px!important;box-shadow:none!important;}
      body.cc464-chat .threadBtn:hover,body.cc464-chat .personBtn:hover{background:#f4f7fb!important;transform:none!important;}
      body.cc464-chat .threadBtn.active,body.cc464-chat .personBtn.active{background:linear-gradient(135deg,#edf3ff,#ecfbf7)!important;border-color:#c7d8ff!important;box-shadow:inset 3px 0 0 #5577f5!important;}
      body.cc464-chat .threadTitle{font-size:13.5px!important;font-weight:850!important;color:#17233c!important;}
      body.cc464-chat .rolePill{background:#eef3ff!important;color:#4c63c7!important;font-size:9px!important;}
      body.cc464-chat .cc464-list-avatar{width:34px;height:34px;flex:0 0 34px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:10px;font-weight:900;background:linear-gradient(135deg,#5b7cfa,#22b8a7);box-shadow:0 4px 10px rgba(15,23,42,.08)!important;}
      body.cc464-chat .threadBtn .cc464-list-avatar{background:linear-gradient(135deg,#f59e0b,#f97316)!important;}

      body.cc464-chat .chatMain{height:100%!important;min-height:0!important;display:flex!important;flex-direction:column!important;position:relative!important;background:#f6f8fc!important;overflow:hidden!important;}
      body.cc464-chat .chatMain::after{display:none!important;}
      body.cc464-chat .teamsChatHeader{flex:0 0 auto!important;min-height:58px!important;padding:10px 14px!important;border-bottom:1px solid #e7ebf1!important;background:rgba(255,255,255,.98)!important;box-shadow:0 4px 14px rgba(15,23,42,.035)!important;}
      body.cc464-chat .chat-room-title{font-size:17px!important;font-weight:900!important;letter-spacing:-.02em!important;color:#18233b!important;}
      body.cc464-chat .chat-room-sub{font-size:10.5px!important;font-weight:700!important;color:#8390a3!important;}
      body.cc464-chat .callBtn{border:0!important;background:#eef3ff!important;color:#4e63c7!important;border-radius:999px!important;padding:8px 11px!important;font-size:11px!important;}

      body.cc464-chat .chatFeed{position:relative!important;z-index:1!important;flex:1 1 auto!important;min-height:0!important;overflow-y:auto!important;overflow-x:hidden!important;padding:18px 18px 12px!important;background:radial-gradient(circle at 12% 10%,rgba(79,124,255,.055),transparent 24%),radial-gradient(circle at 90% 20%,rgba(34,184,167,.05),transparent 24%),#f6f8fc!important;scrollbar-gutter:stable!important;}
      body.cc464-chat .dateDivider{font-size:10px!important;color:#93a0b2!important;margin:2px 0 15px!important;}
      body.cc464-chat .chatRow{display:flex!important;align-items:flex-end!important;gap:8px!important;margin-bottom:10px!important;}
      body.cc464-chat .chatRow.mine{justify-content:flex-end!important;}
      body.cc464-chat .cc464-chat-avatar{width:30px;height:30px;flex:0 0 30px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:10.5px;font-weight:900;letter-spacing:.02em;box-shadow:0 4px 10px rgba(15,23,42,.10);background:linear-gradient(135deg,#4f7cff,#22b8a7);}
      body.cc464-chat .chatRow.mine .cc464-chat-avatar{order:2;background:linear-gradient(135deg,#526fff,#6b5df4);}
      body.cc464-chat .chatBubble{max-width:min(72%,620px)!important;border-radius:19px 19px 19px 7px!important;background:#fff!important;border:1px solid #e4e9f0!important;padding:9px 12px!important;box-shadow:0 5px 14px rgba(15,23,42,.055)!important;transform:none!important;}
      body.cc464-chat .chatBubble::before{display:none!important;}
      body.cc464-chat .chatRow.mine .chatBubble{border-radius:19px 19px 7px 19px!important;background:linear-gradient(135deg,#5579f7 0%,#6366e9 100%)!important;border-color:transparent!important;box-shadow:0 8px 18px rgba(80,97,220,.18)!important;}
      body.cc464-chat .chatRow.mine .chatBubble *{color:#fff!important;-webkit-text-fill-color:#fff!important;}
      body.cc464-chat .chatMeta{gap:6px!important;font-size:9.5px!important;font-weight:750!important;color:#93a0b2!important;margin-bottom:4px!important;}
      body.cc464-chat .chatMeta strong{font-weight:850!important;color:#657386!important;}
      body.cc464-chat .chatBody{font-size:14.5px!important;font-weight:600!important;line-height:1.42!important;letter-spacing:0!important;color:#1d293d!important;}
      body.cc464-chat .messageMenu summary{color:#8b96a6!important;}
      body.cc464-chat .messageMenuPopup{border-radius:11px!important;border-color:#e3e8f0!important;box-shadow:0 12px 30px rgba(15,23,42,.12)!important;}

      body.cc464-chat .composer{position:relative!important;bottom:auto!important;flex:0 0 auto!important;z-index:5!important;margin:0!important;padding:8px 12px 11px!important;border-top:1px solid #e5eaf0!important;background:rgba(255,255,255,.985)!important;box-shadow:0 -8px 24px rgba(15,23,42,.045)!important;}
      body.cc464-chat .composerHint{display:none!important;}
      body.cc464-chat .emojiBar{margin-bottom:7px!important;gap:4px!important;padding:0 2px 1px!important;}
      body.cc464-chat .emojiBtn{width:30px;height:30px;padding:0!important;display:grid!important;place-items:center!important;border-radius:50%!important;background:#f5f7fb!important;border:1px solid #e1e7ef!important;font-size:14px!important;box-shadow:none!important;}
      body.cc464-chat .composeBox{display:flex!important;align-items:flex-end!important;gap:8px!important;padding:5px 5px 5px 12px!important;border:1px solid #dfe5ed!important;border-radius:24px!important;background:#f7f9fc!important;box-shadow:inset 0 1px 2px rgba(15,23,42,.025)!important;}
      body.cc464-chat .composeBox textarea,body.cc464-chat .chatInput{min-height:38px!important;max-height:72px!important;padding:9px 6px!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;font-size:14px!important;font-weight:600!important;color:#202b3d!important;}
      body.cc464-chat .composeBox textarea:focus{border:0!important;box-shadow:none!important;outline:none!important;}
      body.cc464-chat .sendBtn{width:42px!important;min-width:42px!important;height:42px!important;min-height:42px!important;padding:0!important;border-radius:50%!important;background:linear-gradient(135deg,#5579f7,#6366e9)!important;box-shadow:0 8px 16px rgba(82,105,229,.20)!important;font-size:0!important;position:relative!important;}
      body.cc464-chat .sendBtn::after{content:'➤';font-size:17px;color:#fff;position:absolute;inset:0;display:grid;place-items:center;transform:translateX(1px);}

      body.cc464-chat .rightPanel{padding:12px!important;background:linear-gradient(180deg,#ffffff,#f8fbff 54%,#f7fbf9)!important;}
      body.cc464-chat .profileHero{padding:4px 0 12px!important;border-bottom:1px solid #e8edf3!important;}
      body.cc464-chat .sideList{gap:6px!important;}
      body.cc464-chat .sideItem.cardish{min-height:42px!important;padding:9px 10px!important;border-radius:13px!important;border:1px solid #e1e8f0!important;background:#fff!important;color:#314056!important;}
      body.cc464-chat .sideItem.cardish:nth-child(4n+1){box-shadow:inset 3px 0 0 #5579f7!important;}
      body.cc464-chat .sideItem.cardish:nth-child(4n+2){box-shadow:inset 3px 0 0 #22b8a7!important;}
      body.cc464-chat .sideItem.cardish:nth-child(4n+3){box-shadow:inset 3px 0 0 #f59e0b!important;}
      body.cc464-chat .sideItem.cardish:nth-child(4n){box-shadow:inset 3px 0 0 #ef6b6b!important;}
      body.cc464-chat .mutedBox{background:#f7f9fc!important;border:1px dashed #d7dfe9!important;border-radius:14px!important;color:#64748b!important;}

      @media(max-width:1180px){body.cc464-chat .teamsShell{grid-template-columns:minmax(230px,270px) 1fr!important;}body.cc464-chat .rightPanel{display:none!important;}}
      @media(max-width:820px){body.cc464-chat .page-scroll{overflow:auto!important;}body.cc464-chat .teamsShell{height:calc(100vh - 84px)!important;grid-template-columns:1fr!important;}body.cc464-chat .teamsLeft{display:none!important;}body.cc464-chat .chatMain{height:100%!important;}.chatBubble{max-width:84%!important;}}
    `;
    document.head.appendChild(style);
  }

  function ensureChatStylesheet(){
    if (!document.body.classList.contains('cc469-chat')) return;
    if (document.getElementById('cc26-480-chat-css')) return;
    var link=document.createElement('link');
    link.id='cc26-480-chat-css';
    link.rel='stylesheet';
    link.href='/assets/css/crm.css?v=CC780';
    document.head.appendChild(link);
  }



  /* CC26_483 instant Team Chat boot: cover legacy/prebuilt transitions with one stable light shell. */
  function chatBootMarkup(){
    return '<div class="cc480BootApp" aria-hidden="true">'+
      '<aside class="cc480BootSide"><div class="cc480BootLogo">CAREER<br>CROX</div>'+
      '<i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></aside>'+
      '<main class="cc480BootMain"><header class="cc480BootTop"><b>Team Aaryansh</b><span class="cc480BootSearch"></span><span class="cc480BootTimer"></span><span class="cc480BootPill"></span><span class="cc480BootPill"></span><span class="cc480BootPill"></span></header>'+
      '<section class="cc480BootChat"><aside class="cc480BootPanel cc480BootLeft"><b>Team Spaces</b><span class="cc480BootInput"></span><span class="cc480BootTabs"></span><span class="cc480BootLine wide"></span><span class="cc480BootLine"></span><span class="cc480BootLine"></span><span class="cc480BootLine"></span></aside>'+
      '<div class="cc480BootPanel cc480BootCenter"><div class="cc480BootRoom"><span class="cc480BootHash">#</span><b>Team Aaryansh</b></div><div class="cc480BootFeed"></div><div class="cc480BootComposer"></div></div>'+
      '<aside class="cc480BootPanel cc480BootRight"><b>Channel Info</b><span class="cc480BootHero"></span><span class="cc480BootTabs"></span><div class="cc480BootCards"><i></i><i></i><i></i><i></i></div></aside></section></main></div>';
  }
  function ensureChatBoot(){
    document.body.classList.remove('cc480-chat-booting');
    var boot=document.getElementById('cc480-chat-boot');
    if(boot) boot.remove();
  }
  function releaseChatBoot(){
    document.body.classList.remove('cc480-chat-booting');
    document.body.classList.add('cc480-chat-ready');
    var boot=document.getElementById('cc480-chat-boot');
    if(boot) boot.remove();
  }

  function routeClasses(){
    var p = location.pathname || '';
    var isChat = /\/chat(?:\/|$)/.test(p);
    document.body.classList.remove('cc464-chat');
    document.body.classList.toggle('cc469-chat', isChat);
    document.body.classList.toggle('cc474-chat', isChat);
    document.body.classList.toggle('cc464-attendance', /\/attendance(?:\/|$)/.test(p));
    document.body.classList.toggle('cc489-tasks', /\/tasks(?:\/|$)/.test(p));
    document.body.classList.toggle('cc489-semi-report', /\/semi-hourly-report(?:\/|$)/.test(p));
    if(isChat) ensureChatBoot(); else releaseChatBoot();
  }

  function canonicalTimer(x){
    // CC26_640: The bundled CC456 runtime is the sole live timer owner.
    // A second writer here previously re-painted stale values on every tick.
    if(window.__CC456_SESSION_ATTENDANCE__)return;
    // Native CC456 adopts the same pill, including the pre-join waiting state.
    document.querySelectorAll('.topbar-right .cc379-work-timer-pill,.topbar-right .cc376-work-timer-pill,.topbar-right .cc378-work-timer-pill,.topbar-right .cc399-session-work-pill,.topbar-right .cc408-work-timer-pill,.topbar-right .cc445-work-timer-pill,.topbar-right .cc455-work-timer-pill,.topbar-right .cc456-work-pill').forEach(function(node){ try{node.remove();}catch(_){node.style.display='none';} });
    var live = document.querySelectorAll('.topbar-right .cc456-work-timer-pill');
    for (var i=1;i<live.length;i++){ try{live[i].remove();}catch(_){live[i].style.display='none';} }
    var pill = live[0] || ensureCanonicalTimerPill();
    if(!timerStateValid()){
      if(!pill)return;
      pill.classList.add('cc630-await-join');pill.style.removeProperty('display');
      var waitingValue=pill.querySelector('.cc456-value'), waitingSub=pill.querySelector('.cc456-sub');
      if(waitingValue)waitingValue.textContent='00:00:00';
      if(waitingSub)waitingSub.textContent='Join Office to start';
      var waitingFill=pill.querySelector('.cc456-progress span');if(waitingFill)waitingFill.style.width='0%';
      return;
    }
    if(pill){pill.classList.remove('cc630-await-join');pill.style.removeProperty('display');}
    if (!pill) return;
    var state = stateNow(x), active = activeMs(state), pct = Math.max(0, Math.min(100, active / FULL_DAY_MS * 100));
    var val = pill.querySelector('.cc456-value');
    var sub = pill.querySelector('.cc456-sub');
    var fill = pill.querySelector('.cc456-progress span');
    var valid=timerStateValid();
    if (val) val.textContent = hms(valid?active:0);
    if (sub) sub.textContent = !valid ? (timerRecoveryStatus==='not_joined'?'Join Office to start':timerRecoveryStatus==='retry'?'Work timer reconnecting…':'Restoring work timer…') : state.on_break ? 'Break • active timer paused' : state.locked ? 'CRM locked • active timer paused' : state.idle ? 'Idle • active timer paused' : Math.round(pct) + '% of 9h active';
    if (fill){ fill.style.width=pct.toFixed(2)+'%'; fill.style.background='hsl('+Math.round(120*pct/100)+' 82% 45%)'; }
    pill.title='Working Time = real active work only. Break, idle and lock are excluded.';
  }

  function attendance(x){
    if (!document.body.classList.contains('cc464-attendance')) return;
    var state = stateNow(x), active = activeMs(state), idle = idleMs(state), brk = breakMs(state), remaining = remainingMs(state);
    var grid = document.querySelector('.attendance-card-grid');
    if (!grid) return;
    var cards = grid.querySelectorAll('.attendance-metric-card');
    if (cards[0]){
      var value0=cards[0].querySelector('strong'), helper0=cards[0].querySelector('small');
      if(value0)value0.textContent=minsLabelFromMs(remaining,true);
      if(helper0)helper0.textContent='9h active target • '+minsLabelFromMs(active,false)+' active completed';
    }
    if (cards[1]){
      var value1=cards[1].querySelector('strong'), helper1=cards[1].querySelector('small');
      if(value1)value1.textContent=minsLabelFromMs(active,false);
      if(helper1)helper1.textContent='Real active work • break + idle excluded';
    }
    if (cards[2]){
      var value2=cards[2].querySelector('strong'), helper2=cards[2].querySelector('small');
      if(value2)value2.textContent=minsLabelFromMs(idle,false);
      if(helper2)helper2.textContent='No meaningful CRM work after grace';
    }
    if (cards[3]){
      var value3=cards[3].querySelector('strong'), helper3=cards[3].querySelector('small');
      if(value3)value3.textContent=minsLabelFromMs(brk,false);
      if(helper3)helper3.textContent='Actual break time taken';
    }
    if (cards[4]){
      var helper4=cards[4].querySelector('small');
      if(helper4)helper4.textContent='Connected incoming + outgoing • same call metrics everywhere';
    }
    var pageTitle = Array.from(document.querySelectorAll('.table-title')).find(function(n){return /Current Login Session|Today Performance/i.test(n.textContent||'');});
    if(pageTitle && pageTitle.nextElementSibling) pageTitle.nextElementSibling.textContent='Office Duration starts at 9h and reduces only by Active Work • Idle and Break stay separate • Talk Time uses the same connected-call source everywhere';
    var progress = document.querySelector('.attendance-progress-bar > span');
    if(progress) progress.style.width=Math.max(0,Math.min(100,active/FULL_DAY_MS*100)).toFixed(2)+'%';
    var progressCard=document.querySelector('.attendance-progress-card');
    var progressTitle=progressCard ? Array.from(progressCard.querySelectorAll('.panel-title')).find(function(n){return /Work Progress/i.test(n.textContent||'');}) : null;
    if(progressTitle)progressTitle.textContent='9 Hour Active Work Progress';
    if(progressCard){
      var detail=progressCard.querySelector('.helper-text.top-gap-small,.helper-text');
      var talk=cards[4]&&cards[4].querySelector('strong')?cards[4].querySelector('strong').textContent:'0h 0m';
      if(detail)detail.textContent='Remaining: '+minsLabelFromMs(remaining,true)+' • Active: '+minsLabelFromMs(active,false)+' • Idle: '+minsLabelFromMs(idle,false)+' • Break: '+minsLabelFromMs(brk,false)+' • Talk Time: '+talk;
    }
  }

  function initials(name){
    return String(name||'U').trim().split(/\s+/).filter(Boolean).slice(0,2).map(function(x){return x.charAt(0).toUpperCase();}).join('') || 'U';
  }
  function text(el){ return el ? String(el.textContent||'').trim() : ''; }
  function byText(nodes, rx){ return Array.prototype.find.call(nodes||[], function(n){ return rx.test(text(n)); }); }
  function fitChatShell(){
    if(window.__CC_CHAT_REACT_OWNER__) return;
    var shell=document.querySelector('.teamsShell');
    if(!shell||!document.body.classList.contains('cc469-chat'))return;
    var top=Math.max(0,Math.round(shell.getBoundingClientRect().top||0));
    var room=Math.max(480,Math.floor((window.innerHeight||document.documentElement.clientHeight||720)-top-10));
    var next=room+'px';
    if(shell.style.height!==next)shell.style.height=next;
  }
  function ensureCreatePanel(left){
    if(!left)return;
    var primary=left.querySelector('.teamsTopActions .teamsAction.primary');
    var candidates=Array.from(left.children).filter(function(n){return n.matches&&n.matches('div')&&n.querySelector&&n.querySelector('input[placeholder="New channel name"]')&&n.querySelector('.teamsAction.primary');});
    var panel=candidates[0];
    if(panel){panel.classList.add('cc469-create-panel');if(!panel.hasAttribute('data-cc469-ready')){panel.setAttribute('data-cc469-ready','1');}}
    if(primary&&!primary.hasAttribute('data-cc469-create-hook')){
      primary.setAttribute('data-cc469-create-hook','1');
      primary.addEventListener('click',function(){setTimeout(function(){var p=left.querySelector('.cc469-create-panel');if(p)p.classList.toggle('is-open');},0);});
    }
  }
  function ensureLeftPanel(){
    var left=document.querySelector('.teamsLeft'); if(!left)return;
    var search=left.querySelector('.teamsSearch'); if(search)search.placeholder='Search channels…';
    ensureCreatePanel(left);
    left.querySelectorAll('.threadBtn').forEach(function(btn){
      if(!btn.querySelector('.listAvatar,.cc469-list-avatar')){var a=document.createElement('span');a.className='cc469-list-avatar';a.textContent='#';a.setAttribute('aria-hidden','true');btn.insertBefore(a,btn.firstChild);}
      var main=btn.querySelector('.threadMain');
      var sub=main?main.querySelector('.cc469-thread-sub'):null;
      if(sub) sub.remove();
    });
    left.querySelectorAll('.personBtn').forEach(function(btn){
      var title=btn.querySelector('.threadTitle');
      var cleanName=text(title).replace('(You)','').trim();
      var roleEl=btn.querySelector('.rolePill');
      var role=text(roleEl).toLowerCase();
      if(!btn.querySelector('.listAvatar,.cc469-list-avatar')){var a=document.createElement('span');a.className='cc469-list-avatar';a.textContent=initials(cleanName);a.setAttribute('aria-hidden','true');btn.insertBefore(a,btn.firstChild);}
      btn.classList.remove('cc492-role-manager','cc492-role-tl','cc492-role-recruiter','cc492-role-assistant','cc492-role-user','cc492-self');
      if(role.indexOf('manager')!==-1){ btn.classList.add('cc492-role-manager'); }
      else if(role==='tl' || role.indexOf('team lead')!==-1 || role.indexOf('teamlead')!==-1){ btn.classList.add('cc492-role-tl'); }
      else if(role.indexOf('recruiter')!==-1){ btn.classList.add('cc492-role-recruiter'); }
      else if(role.indexOf('assistant')!==-1){ btn.classList.add('cc492-role-assistant'); }
      else { btn.classList.add('cc492-role-user'); }
      if(/\(You\)/i.test(text(title))){ btn.classList.add('cc492-self'); }
      if(/^ARIA(?:\s|$)/i.test(text(title))){ btn.classList.add('cc489-aria-contact','cc492-role-assistant'); btn.setAttribute('aria-label','ARIA Reports — automatic 30-minute report feed'); btn.disabled=false; if(!btn.hasAttribute('data-cc500-aria-hook')){btn.setAttribute('data-cc500-aria-hook','1');btn.addEventListener('click',function(ev){ev.preventDefault();ev.stopImmediatePropagation();cc500NavigateCurrentChat('aria-reports')},true);} }
    });
    var add=left.querySelector('.teamsAddBtn'); if(add){ add.classList.add('cc489-add-channel'); add.title='Create Channel'; add.setAttribute('aria-label','Create Channel'); }
  }
  function selectedRoomName(){var t=document.querySelector('.teamsChatHeader .panel-title, .teamsChatHeader .chat-room-title');return text(t)||'Team Aaryansh';}
  function memberItems(){
    return Array.from(document.querySelectorAll('.teamsLeft .personBtn')).map(function(btn){
      return {name:text(btn.querySelector('.threadTitle')).replace(/\s*\(You\)\s*/g,'').trim()||'User',role:text(btn.querySelector('.rolePill'))||'User'};
    }).filter(function(x){return x.name;});
  }
  function setInfoTab(tab){
    var right=document.querySelector('.rightPanel'); if(!right)return;
    right.setAttribute('data-cc470-tab',tab);
    right.querySelectorAll('.cc469-info-tabs button').forEach(function(btn){
      var hit = btn.getAttribute('data-tab')===tab;
      btn.classList.toggle('active', hit);
      btn.setAttribute('aria-pressed', hit ? 'true' : 'false');
    });
    right.querySelectorAll('.cc470-tab-panel').forEach(function(panel){
      panel.classList.toggle('active', panel.getAttribute('data-panel')===tab);
    });
  }
  function ensureChatHeader(){
    var head=document.querySelector('.teamsChatHeader'); if(!head)return;
    var row=head.querySelector('.chatTitleRow');
    if(row){
      var title=row.querySelector('.panel-title,.chat-room-title'); if(title)title.classList.add('chat-room-title');
      row.querySelectorAll('.cc469-chat-sub,.chat-room-sub').forEach(function(el){ el.remove(); });
    }
    var tools=head.querySelector('.cc469-head-tools');
    if(!tools){ tools=document.createElement('div'); tools.className='cc469-head-tools'; head.appendChild(tools); }
    var members=memberItems();
    var toolSig=members.map(function(x){return x.name+'|'+x.role;}).join('||');
    if(tools.getAttribute('data-cc474-sig')===toolSig && tools.querySelector('.cc470-head-stack')) return;
    tools.setAttribute('data-cc474-sig',toolSig);
    tools.innerHTML='';
    var stack=document.createElement('div'); stack.className='cc470-head-stack';
    var show=members.slice(0,3);
    show.forEach(function(item){
      var b=document.createElement('button'); b.type='button'; b.className='cc470-head-avatar'; b.textContent=initials(item.name); b.title=item.name; b.addEventListener('click', function(){ setInfoTab('members'); }); stack.appendChild(b);
    });
    if(members.length>3){ var more=document.createElement('button'); more.type='button'; more.className='cc470-head-avatar more'; more.textContent='+'+(members.length-3); more.title='View members'; more.addEventListener('click', function(){ setInfoTab('members'); }); stack.appendChild(more); }
    function closeFloatingHeaderMenus(){
      document.querySelectorAll('.cc504-floating-menu').forEach(function(x){ try{x.remove();}catch(_){ } });
    }
    function showFloatingHeaderMenu(anchor,items,kind){
      closeFloatingHeaderMenus();
      var menu=document.createElement('div');
      menu.className='cc487-channel-menu cc504-floating-menu '+(kind||'');
      items.forEach(function(item){
        if(item.hidden)return;
        var btn=document.createElement('button');
        btn.type='button'; btn.className='cc487-channel-menu-item'+(item.rename?' rename':'');
        btn.innerHTML='<span>'+item.icon+'</span><b>'+item.label+'</b>';
        btn.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();closeFloatingHeaderMenus();item.action();});
        menu.appendChild(btn);
      });
      menu.addEventListener('click',function(ev){ev.stopPropagation();});
      document.body.appendChild(menu);
      var r=anchor.getBoundingClientRect();
      var width=kind==='cc504-info-menu'?176:206;
      var left=Math.min(Math.max(8,r.right-width),Math.max(8,window.innerWidth-width-8));
      var top=Math.min(r.bottom+8,Math.max(8,window.innerHeight-menu.offsetHeight-8));
      menu.style.left=Math.round(left)+'px';
      menu.style.top=Math.round(top)+'px';
      menu.style.width=width+'px';
      return menu;
    }
    function startRenameFlow(){
      setInfoTab('settings');
      setTimeout(function(){
        var input=document.querySelector('.rightPanel input[placeholder="Rename selected channel"]');
        if(!input)return;
        try{
          var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
          setter.call(input,selectedRoomName());
          input.dispatchEvent(new Event('input',{bubbles:true}));
          input.dispatchEvent(new Event('change',{bubbles:true}));
        }catch(_){input.value=selectedRoomName();}
        input.focus();if(input.select)input.select();
      },0);
    }
    var overview=document.createElement('button'); overview.type='button'; overview.className='cc470-head-btn cc504-info-btn'; overview.textContent='i'; overview.title='Channel information';
    overview.addEventListener('click',function(ev){
      ev.preventDefault();ev.stopPropagation();
      showFloatingHeaderMenu(overview,[
        {icon:'⌂',label:'Overview',action:function(){setInfoTab('overview');}},
        {icon:'◉',label:'Members',action:function(){setInfoTab('members');}},
        {icon:'▣',label:'Files',action:function(){setInfoTab('files');}},
        {icon:'⚙',label:'Settings',action:function(){setInfoTab('settings');}}
      ],'cc504-info-menu');
    });
    var menuWrap=document.createElement('div'); menuWrap.className='cc487-head-menu-wrap';
    var settings=document.createElement('button'); settings.type='button'; settings.className='cc470-head-btn cc504-more-btn'; settings.textContent='⋯'; settings.title='Channel menu';
    var thread=(new URL(location.href)).searchParams.get('thread')||'team';
    settings.addEventListener('click',function(ev){
      ev.preventDefault();ev.stopPropagation();
      showFloatingHeaderMenu(settings,[
        {icon:'✎',label:'Rename Group',rename:true,hidden:String(thread).indexOf('dm:')===0||String(thread)==='aria-reports',action:startRenameFlow},
        {icon:'◉',label:'Members',action:function(){setInfoTab('members');}},
        {icon:'⚙',label:'Channel Settings',action:function(){setInfoTab('settings');}}
      ],'cc504-more-menu');
    });
    menuWrap.appendChild(settings);
    tools.appendChild(stack); tools.appendChild(overview); tools.appendChild(menuWrap);
    if(!document.documentElement.hasAttribute('data-cc504-menu-close')){
      document.documentElement.setAttribute('data-cc504-menu-close','1');
      document.addEventListener('click',closeFloatingHeaderMenus);
      window.addEventListener('resize',closeFloatingHeaderMenus,{passive:true});
      window.addEventListener('scroll',closeFloatingHeaderMenus,true);
    }
  }
  function ensureMessageRows(){
    document.querySelectorAll('.chatRow').forEach(function(row){
      if(!row.querySelector('.chatAvatar,.cc469-chat-avatar')){var meta=row.querySelector('.chatMeta strong');var a=document.createElement('span');a.className='cc469-chat-avatar';a.textContent=initials(text(meta)||'U');a.setAttribute('aria-hidden','true');row.insertBefore(a,row.firstChild);}
      var bubble=row.querySelector('.chatBubble'); if(!bubble)return;
      if(bubble.querySelector('.messageMenu'))return;
      var actions=Array.from(bubble.children).find(function(n){return n.classList&&n.classList.contains('rowActions')&&/Edit/i.test(text(n))&&/Delete/i.test(text(n));});
      var divider=document.querySelector('.dateDivider'); if(divider) divider.textContent='Today'; if(actions){actions.classList.add('cc469-hidden-actions');var d=document.createElement('details');d.className='messageMenu';var sum=document.createElement('summary');sum.setAttribute('aria-label','Message actions');sum.textContent='⋯';var pop=document.createElement('div');pop.className='messageMenuPopup';Array.from(actions.children).forEach(function(b){pop.appendChild(b);});d.appendChild(sum);d.appendChild(pop);bubble.appendChild(d);}
    });
  }
  function ensureComposer(){
    var composer=document.querySelector('.composer'); if(!composer)return;
    var box=composer.querySelector('.composeBox'); if(!box)return;
    var ta=box.querySelector('textarea');if(ta)ta.placeholder='Type a message…';
    if(!box.querySelector('.cc469-emoji-toggle')){var b=document.createElement('button');b.type='button';b.className='cc469-emoji-toggle';b.setAttribute('aria-label','Emoji');b.textContent='＋';b.addEventListener('click',function(){composer.classList.toggle('cc469-emoji-open');});box.insertBefore(b,box.firstChild);}
  }
  function wrapControl(section,label){
    return section;
  }
  function ensureRightPanel(){
    var right=document.querySelector('.rightPanel'); if(!right)return;
    var room=selectedRoomName();
    var hero=right.querySelector('.profileHero');
    if(hero){
      var pt=hero.querySelector('.panel-title'); if(pt)pt.textContent='Channel Info';
      if(!hero.querySelector('.cc469-info-close')){var x=document.createElement('span');x.className='cc469-info-close';x.textContent='×';x.setAttribute('aria-hidden','true');hero.appendChild(x);}
    }
    var info=right.querySelector('.cc469-info-hero');
    if(!info){
      info=document.createElement('div');
      info.className='cc469-info-hero';
      info.innerHTML='<div class="cc469-info-hash">#</div><h3></h3>';
      hero?hero.insertAdjacentElement('afterend',info):right.insertBefore(info,right.firstChild);
    }
    var h3=info.querySelector('h3'); if(h3)h3.textContent=room;
    info.querySelectorAll('p').forEach(function(el){ el.remove(); });

    var tabs=right.querySelector('.cc469-info-tabs');
    if(!tabs){
      tabs=document.createElement('div');
      tabs.className='cc469-info-tabs';
      tabs.innerHTML='<button type="button" data-tab="overview">Overview</button><button type="button" data-tab="members">Members</button><button type="button" data-tab="files">Files</button><button type="button" data-tab="settings">Settings</button>';
      info.insertAdjacentElement('afterend',tabs);
    } else {
      var labels=['Overview','Members','Files','Settings'];
      Array.from(tabs.querySelectorAll('button')).forEach(function(btn,i){ btn.setAttribute('data-tab', labels[i].toLowerCase()); btn.textContent=labels[i]; });
    }
    tabs.querySelectorAll('button').forEach(function(btn){
      if(btn.hasAttribute('data-cc470-bound')) return;
      btn.setAttribute('data-cc470-bound','1');
      btn.addEventListener('click', function(){ setInfoTab(btn.getAttribute('data-tab')||'overview'); });
    });

    var desc=right.querySelector('.cc469-description'); if(desc) desc.remove();

    var host=right.querySelector('.cc470-tab-host');
    if(!host){ host=document.createElement('div'); host.className='cc470-tab-host'; tabs.insertAdjacentElement('afterend', host); }
    function panel(name){
      var p=host.querySelector('.cc470-tab-panel[data-panel="'+name+'"]');
      if(!p){ p=document.createElement('div'); p.className='cc470-tab-panel'; p.setAttribute('data-panel', name); host.appendChild(p); }
      return p;
    }
    var overviewPanel=panel('overview'), membersPanel=panel('members'), filesPanel=panel('files'), settingsPanel=panel('settings');

    var side=right.querySelector('.sideList');
    if(side && side.parentNode!==overviewPanel) overviewPanel.appendChild(side);
    if(side){
      var targets=['overview','members','files','settings','settings'];
      side.querySelectorAll('.sideItem.cardish').forEach(function(item,idx){
        item.setAttribute('data-cc470-target', targets[idx] || 'overview');
        if(item.hasAttribute('data-cc470-bound')) return;
        item.setAttribute('data-cc470-bound','1');
        item.addEventListener('click', function(){ setInfoTab(item.getAttribute('data-cc470-target')||'overview'); });
      });
    }

    Array.from(right.children).forEach(function(sec){
      if(sec===hero||sec===info||sec===tabs||sec===host) return;
      if(sec.classList&&sec.classList.contains('cc470-tab-host')) return;
      var t='';
      var titleEl=sec.querySelector && (sec.querySelector(':scope > .panel-title') || sec.querySelector('summary'));
      if(titleEl) t=text(titleEl);
      if(/member/i.test(t)) { if(sec.parentNode!==membersPanel) membersPanel.appendChild(sec); }
      else if(/review queue|channel controls|channel actions|rename|delete|setting/i.test(t)) { if(sec.parentNode!==settingsPanel) settingsPanel.appendChild(sec); }
      else if(sec!==side) { if(sec.parentNode!==settingsPanel) settingsPanel.appendChild(sec); }
    });

    var people = memberItems();
    var memberSig=people.map(function(x){return x.name+'|'+x.role;}).join('||');
    var list=membersPanel.querySelector('.cc470-member-list');
    if(!list || list.getAttribute('data-cc474-sig')!==memberSig){
      if(list) list.remove();
      list=document.createElement('div'); list.className='cc470-member-list'; list.setAttribute('data-cc474-sig',memberSig);
      if(!people.length){ list.innerHTML='<div class="mutedBox">No visible members.</div>'; }
      else {
        people.forEach(function(item){
          var row=document.createElement('div'); row.className='cc470-member-row';
          row.innerHTML='<span class="cc470-member-avatar">'+initials(item.name)+'</span><div class="cc470-member-meta"><strong>'+item.name+'</strong><span>'+item.role+'</span></div>';
          list.appendChild(row);
        });
      }
      membersPanel.insertBefore(list, membersPanel.firstChild);
    }

    if(!filesPanel.hasChildNodes()){
      var empty=document.createElement('div'); empty.className='cc470-empty-box';
      empty.innerHTML='<strong>No files yet</strong><span>Shared files will appear here.</span>';
      filesPanel.appendChild(empty);
    }
    if(!settingsPanel.hasChildNodes()){
      var empty2=document.createElement('div'); empty2.className='cc470-empty-box';
      empty2.innerHTML='<strong>No extra settings</strong><span>Only available actions for your role will show here.</span>';
      settingsPanel.appendChild(empty2);
    }
    setInfoTab(right.getAttribute('data-cc470-tab') || 'overview');
  }
  function inject489Style(){
    if(document.getElementById('cc26-489-premium-style')) return;
    var style=document.createElement('style');
    style.id='cc26-489-premium-style';
    style.textContent=`
      /* CC26_489 Team Chat create button + ARIA */
      body.cc469-chat .teamsAddBtn,body.cc469-chat .cc489-add-channel{width:34px!important;height:34px!important;min-width:34px!important;border:1px solid #c8d8ee!important;border-radius:11px!important;background:linear-gradient(135deg,#dbeaff,#e9e1ff 56%,#dcf8ef)!important;color:#315681!important;-webkit-text-fill-color:#315681!important;font-size:21px!important;font-weight:700!important;line-height:1!important;box-shadow:0 6px 14px rgba(69,91,137,.10)!important}
      body.cc469-chat .teamsAddBtn:hover{transform:translateY(-1px)!important;background:linear-gradient(135deg,#cfe4ff,#e3d7ff 56%,#d3f4e7)!important}
      body.cc469-chat .createPanel,body.cc469-chat .cc469-create-panel{display:grid!important;gap:8px!important;margin:9px 0 10px!important;padding:10px!important;border:1px solid #d5e2ef!important;border-radius:14px!important;background:linear-gradient(135deg,#eef6ff,#f7f0ff 58%,#eefcf7)!important;box-shadow:0 8px 18px rgba(44,70,111,.07)!important}
      body.cc469-chat .createPanel .chatInput{background:#fff!important;border:1px solid #cfdded!important;color:#173a5d!important;font-size:13px!important}
      body.cc469-chat .createPanel .miniBlue{background:linear-gradient(135deg,#b9d7ff,#d6c6ff)!important;color:#284d7d!important;-webkit-text-fill-color:#284d7d!important;font-weight:850!important}
      body.cc469-chat .personBtn.cc489-aria-contact{opacity:1!important;cursor:default!important;background:linear-gradient(135deg,#e5f9ef,#edf5ff 50%,#f1ecff)!important;border:1px solid #cbe6db!important;box-shadow:0 5px 13px rgba(61,112,93,.07)!important}
      body.cc469-chat .personBtn.cc489-aria-contact .listAvatar,body.cc469-chat .personBtn.cc489-aria-contact .cc469-list-avatar{background:linear-gradient(135deg,#8bd9b4,#8bbff3 52%,#b59cec)!important;color:#173a5d!important;-webkit-text-fill-color:#173a5d!important}
      body.cc469-chat .personBtn.cc489-aria-contact .threadTitle{color:#174b3a!important;-webkit-text-fill-color:#174b3a!important;font-weight:900!important}
      body.cc469-chat .personBtn.cc489-aria-contact .rolePill{background:#dcf6e9!important;color:#25634d!important;-webkit-text-fill-color:#25634d!important;font-size:9.5px!important}
      body.cc469-chat .chatRow.cc489-aria-row .chatBubble{max-width:min(86%,760px)!important;background:linear-gradient(135deg,#e8fbf2 0%,#eef7ff 50%,#f4efff 100%)!important;border:1px solid #cde6dc!important;box-shadow:0 10px 24px rgba(50,102,84,.10)!important}
      body.cc469-chat .chatRow.cc489-aria-row .cc469-chat-avatar,body.cc469-chat .chatRow.cc489-aria-row .chatAvatar{background:linear-gradient(135deg,#78cfaa,#78b9ee 55%,#a48ce8)!important;color:#143a34!important;-webkit-text-fill-color:#143a34!important}
      body.cc469-chat .cc489-aria-badge{display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border-radius:999px;background:#dff7eb;color:#23614a!important;-webkit-text-fill-color:#23614a!important;font-size:10px;font-weight:900;margin-left:6px}
      body.cc469-chat .cc489-aria-report-body{white-space:normal!important;font-size:14px!important;line-height:1.45!important;font-weight:650!important;color:#173a5d!important;-webkit-text-fill-color:#173a5d!important}
      body.cc469-chat .cc490-aria-sheet{overflow:hidden;border:1px solid #bdd8cf;border-radius:12px;background:#fff;box-shadow:0 6px 16px rgba(48,86,75,.07)}
      body.cc469-chat .cc490-aria-sheet-head{padding:9px 11px;background:linear-gradient(135deg,#dff7eb,#e5f2ff 58%,#eee7ff);border-bottom:1px solid #c9dfd7}
      body.cc469-chat .cc490-aria-sheet-title{font-size:12.5px;font-weight:1000;color:#174b3a!important;-webkit-text-fill-color:#174b3a!important}
      body.cc469-chat .cc490-aria-metrics{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:1px;background:#d8e5e0;border-bottom:1px solid #d1e0db}
      body.cc469-chat .cc490-aria-metric{min-width:0;padding:7px 6px;background:#f7fbfa;text-align:center}
      body.cc469-chat .cc490-aria-metric span{display:block;font-size:8.5px;font-weight:900;color:#617b75!important;-webkit-text-fill-color:#617b75!important;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap}
      body.cc469-chat .cc490-aria-metric strong{display:block;margin-top:2px;font-size:13px;font-weight:1000;color:#173a5d!important;-webkit-text-fill-color:#173a5d!important}
      body.cc469-chat .cc490-aria-table-wrap{max-height:330px;overflow:auto;background:#fff}
      body.cc469-chat .cc490-aria-table{width:100%;min-width:760px;border-collapse:collapse;font-size:11.5px;color:#183d54}
      body.cc469-chat .cc490-aria-table th{position:sticky;top:0;z-index:1;padding:7px 8px;border-right:1px solid #d8e4df;border-bottom:1px solid #c8d8d2;background:#eaf4f0;color:#355f52!important;-webkit-text-fill-color:#355f52!important;font-size:9px;font-weight:1000;text-transform:uppercase;letter-spacing:.02em;text-align:center}
      body.cc469-chat .cc490-aria-table th:nth-child(2){text-align:left}
      body.cc469-chat .cc490-aria-table td{padding:7px 8px;border-right:1px solid #e2ece8;border-bottom:1px solid #e1ebe7;text-align:center;background:#fff;color:#254a5f!important;-webkit-text-fill-color:#254a5f!important;font-weight:750}
      body.cc469-chat .cc490-aria-table tr:nth-child(even) td{background:#f8fbfa}
      body.cc469-chat .cc490-aria-table td.cc490-aria-name{text-align:left;font-weight:900;color:#173a5d!important;-webkit-text-fill-color:#173a5d!important}
      body.cc469-chat .cc490-aria-empty{padding:12px;font-size:11.5px;font-weight:800;color:#607a72!important;-webkit-text-fill-color:#607a72!important}
      body.cc469-chat .cc489-aria-open{margin-top:9px!important;min-height:36px!important;border:1px solid #bad9ca!important;border-radius:11px!important;padding:7px 12px!important;background:linear-gradient(135deg,#c9f0dc,#dcecff 58%,#e8dcff)!important;color:#1f5b45!important;-webkit-text-fill-color:#1f5b45!important;font-size:12.5px!important;font-weight:900!important;cursor:pointer!important}
      /* CC26_489 Tasks: light premium, larger readable controls */
      body.cc489-tasks .page-scroll{background:linear-gradient(180deg,#f6faff 0%,#fbfdff 56%,#f7fbfa 100%)!important}
      body.cc489-tasks .table-panel{border:1px solid #d7e4f0!important;border-radius:19px!important;background:linear-gradient(135deg,rgba(255,255,255,.98),rgba(247,251,255,.98))!important;box-shadow:0 10px 26px rgba(40,67,104,.065)!important}
      body.cc489-tasks .table-title{font-size:18px!important;font-weight:900!important;color:#153a5d!important}
      body.cc489-tasks .task-filter-grid{gap:11px!important}
      body.cc489-tasks .task-filter-grid .field label{font-size:12.5px!important;font-weight:850!important;color:#3b5875!important}
      body.cc489-tasks .task-filter-grid .inline-input{min-height:42px!important;border-radius:12px!important;border-color:#cbdced!important;background:linear-gradient(135deg,#f4f8ff,#fbf8ff)!important;color:#183d60!important;font-size:13px!important;font-weight:700!important}
      body.cc489-tasks .task-summary-grid{gap:12px!important}
      body.cc489-tasks .task-summary-button{min-height:112px!important;border-radius:18px!important;border:1px solid rgba(159,181,212,.42)!important;box-shadow:0 9px 22px rgba(37,63,102,.075)!important;padding:16px!important;text-align:left!important}
      body.cc489-tasks .task-summary-button:nth-child(1){background:linear-gradient(135deg,#e3efff,#edf5ff)!important}
      body.cc489-tasks .task-summary-button:nth-child(2){background:linear-gradient(135deg,#eee8ff,#f7f2ff)!important}
      body.cc489-tasks .task-summary-button:nth-child(3){background:linear-gradient(135deg,#e2f8ed,#effcf5)!important}
      body.cc489-tasks .task-summary-button:nth-child(4){background:linear-gradient(135deg,#fff0df,#fff8ed)!important}
      body.cc489-tasks .task-summary-button:nth-child(5){background:linear-gradient(135deg,#ffe9ed,#fff4f6)!important}
      body.cc489-tasks .task-summary-button span{font-size:13px!important;font-weight:900!important;color:#385673!important;-webkit-text-fill-color:#385673!important}
      body.cc489-tasks .task-summary-button strong{font-size:30px!important;line-height:1!important;color:#173b5d!important;-webkit-text-fill-color:#173b5d!important}
      body.cc489-tasks .task-summary-button small{font-size:11.5px!important;line-height:1.35!important;color:#617a92!important;-webkit-text-fill-color:#617a92!important}
      body.cc489-tasks .task-summary-button.metric-card-active{outline:2px solid #8eb6e8!important;box-shadow:0 11px 26px rgba(73,108,159,.14)!important}
      body.cc489-tasks .crm-table{font-size:13px!important}
      body.cc489-tasks .crm-table th{font-size:11.5px!important;font-weight:900!important;color:#365676!important;background:linear-gradient(135deg,#e9f2ff,#f3efff)!important}
      body.cc489-tasks .crm-table td{padding-top:11px!important;padding-bottom:11px!important;color:#203f5e!important}
      body.cc489-tasks .crm-table tbody tr:nth-child(even){background:#fbfdff!important}
      body.cc489-tasks .crm-table tbody tr:hover{background:linear-gradient(90deg,#edf6ff,#f7f2ff 56%,#eefbf6)!important}
      body.cc489-tasks .task-priority-pill,body.cc489-tasks .task-state-pill{font-size:11px!important;font-weight:850!important;padding:6px 9px!important;border-radius:999px!important}
      body.cc489-tasks .crm-premium-modal{border-radius:20px!important;border:1px solid #d5e4ef!important;background:linear-gradient(145deg,#ffffff,#f5faff 60%,#faf7ff)!important;box-shadow:0 22px 70px rgba(22,50,85,.20)!important}
      body.cc489-tasks .crm-premium-modal .panel-title{font-size:20px!important;font-weight:900!important;color:#173a5d!important}
      body.cc489-tasks .crm-premium-modal .field label{font-size:12.5px!important;font-weight:850!important;color:#385675!important}
      body.cc489-tasks .crm-premium-modal .inline-input,body.cc489-tasks .crm-premium-modal textarea{font-size:13.5px!important;border-radius:12px!important;border-color:#cbddeb!important;background:#fbfdff!important;color:#183c5e!important}
    `;
    document.head.appendChild(style);
  }

  var cc489Stream=null,cc489StreamThread='',cc489StreamReady=false,cc489StreamBackoffUntil=0;
  function cachedUser(){try{return JSON.parse(localStorage.getItem('careerCroxCachedUser')||'{}')||{}}catch(_){return{}}}
  function activeChatThread(){try{return (new URL(location.href)).searchParams.get('thread')||'team'}catch(_){return'team'}}
  function mergeCacheMessage(thread,item){
    if(window.__CC_CHAT_REACT_OWNER__) return;
    try{
      var key='cc_chat_cache:'+thread,rows=JSON.parse(sessionStorage.getItem(key)||'[]'); if(!Array.isArray(rows))rows=[];
      var id=String(item&&item.id||''); rows=rows.filter(function(x){return String(x&&x.id||'')!==id}); rows.push(item);
      rows.sort(function(a,b){return (Number(a&&a.id||0)-Number(b&&b.id||0))||String(a&&a.created_at||'').localeCompare(String(b&&b.created_at||''));});
      sessionStorage.setItem(key,JSON.stringify(rows.slice(-80)));
    }catch(_){}
  }
  function formatChatTime(v){try{return new Date(v).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'numeric',minute:'2-digit',hour12:true})}catch(_){return''}}
  function appendInstantMessage(item){
    if(window.__CC_CHAT_REACT_OWNER__){if(item)window.dispatchEvent(new CustomEvent('career-crox-chat-message',{detail:item}));return;}
    if(!item||String(item.thread_key||'team')!==activeChatThread())return;
    var user=cachedUser(); if(String(item.sender_username||'').toLowerCase()===String(user.username||'').toLowerCase())return;
    cc758TouchMessage(item,false);cc758MarkThreadRead(String(item.thread_key||'team'));
    var feed=document.querySelector('.chatFeed'); if(!feed)return;
    var id=String(item.id||''); if(id&&feed.querySelector('[data-cc489-message-id="'+CSS.escape(id)+'"]'))return;
    var row=document.createElement('div'); row.className='chatRow'; row.setAttribute('data-cc489-message-id',id);
    var sender=String(item.sender_name||item.sender_username||'User');
    var avatar=document.createElement('span'); avatar.className='cc469-chat-avatar'; avatar.textContent=initials(sender); avatar.setAttribute('aria-hidden','true');
    var bubble=document.createElement('div'); bubble.className='chatBubble';
    var meta=document.createElement('div'); meta.className='chatMeta'; meta.innerHTML='<strong></strong><span></span>'; meta.querySelector('strong').textContent=sender; meta.querySelector('span').textContent=formatChatTime(item.created_at);
    var body=document.createElement('div'); body.className='chatBody'; body.textContent=String(item.body||'');
    bubble.appendChild(meta); bubble.appendChild(body); row.appendChild(avatar); row.appendChild(bubble);
    var end=feed.lastElementChild; if(end)feed.insertBefore(row,end); else feed.appendChild(row);
    enhanceAriaReports(); try{feed.scrollTop=feed.scrollHeight}catch(_){}
  }
  function closeInstantChatStream(){if(cc489Stream){try{cc489Stream.close()}catch(_){}cc489Stream=null}cc489StreamThread='';cc489StreamReady=false}
  function ensureInstantChatStream(){
    if(window.__CC_CHAT_LIVE_PUSH__){closeInstantChatStream();return;}
    if(window.__CC621_NIGHT_QUIET__?.()||(!window.__CC_CHAT_LIVE_PUSH__&&window.__CC_CHAT_MANUAL_ONLY__)||window.__CC602_NETWORK_PAUSED__||window.__CC_CHAT_NATIVE_SSE){closeInstantChatStream();return}
    if(!document.body.classList.contains('cc469-chat')||typeof EventSource==='undefined'){closeInstantChatStream();return}
    if(Date.now()<cc489StreamBackoffUntil)return;
    var thread=activeChatThread();
    // CC26_758: team + direct messages use the single global stream so other senders can
    // become unread/recent while Team Chat is open. Restricted/custom groups keep their
    // exact-thread stream, because the backend intentionally excludes them from wildcard SSE.
    if(thread==='team'||String(thread).indexOf('dm:')===0){closeInstantChatStream();return}
    if(cc489Stream&&cc489StreamThread===thread)return; closeInstantChatStream(); cc489StreamThread=thread;
    try{
      var es=new EventSource('/api/chat/stream?thread_key='+encodeURIComponent(thread),{withCredentials:true}); cc489Stream=es; cc489StreamReady=false;
      es.addEventListener('ready',function(){cc489StreamReady=true});
      es.addEventListener('message',function(ev){try{var data=JSON.parse(ev.data||'{}'),item=data.item;if(!item)return;mergeCacheMessage(thread,item);appendInstantMessage(item)}catch(_){}});
      es.addEventListener('error',function(){if(!cc489StreamReady){cc489StreamBackoffUntil=Date.now()+60000;closeInstantChatStream()}});
      setTimeout(function(){if(cc489Stream===es&&!cc489StreamReady){cc489StreamBackoffUntil=Date.now()+60000;closeInstantChatStream()}},8000);
    }catch(_){cc489StreamBackoffUntil=Date.now()+60000;closeInstantChatStream()}
  }
  function ariaReportModel(raw){
    var clean=String(raw||'').trim();
    var lines=clean.split(/\n+/).map(function(x){return x.trim();}).filter(Boolean);
    if(lines.length<2){
      var compact=clean.replace(/\s+(?=\d+\.\s)/g,'\n');
      lines=compact.split(/\n+/).map(function(x){return x.trim();}).filter(Boolean);
    }
    var title=lines[0]||'30-Minute Team Performance';
    var summaryLine=lines[1]||'';
    function metric(label){var m=summaryLine.match(new RegExp(label+'\\s+(\\d+)(m)?','i'));return m?m[1]+(m[2]?'m':''):'0';}
    var rows=[];
    lines.slice(2).forEach(function(line){
      var m=line.match(/^\s*(\d+)\.\s*(.*?)\s*[—-]\s*(.*)$/i); if(!m)return;
      var tail=m[3]||'';
      function token(label,mins){var x=tail.match(new RegExp('(?:^|•)\\s*'+label+'\\s*(\\d+)\\s*(m)?','i'));return x?(x[1]+(mins?'m':'')):(mins?'0m':'0');}
      rows.push({rank:m[1],name:m[2].trim(),dialed:token('D'),connected:token('C'),incoming:token('I'),talk:token('T',true),submissions:token('S'),breakTime:token('B',true),idle:token('Idle',true)});
    });
    return {title:title,summary:{dialed:metric('Dialed'),connected:metric('Connected'),incoming:metric('Incoming'),talk:metric('Talk'),submissions:metric('Submissions'),breakTime:metric('Break'),idle:metric('Idle')},rows:rows,noActivity:/No activity recorded/i.test(clean)};
  }
  function renderAriaReportTable(body,raw){
    var model=ariaReportModel(raw);
    body.textContent=''; body.classList.add('cc489-aria-report-body','cc490-aria-table-body');
    var card=document.createElement('div'); card.className='cc490-aria-sheet';
    var head=document.createElement('div'); head.className='cc490-aria-sheet-head';
    var title=document.createElement('div'); title.className='cc490-aria-sheet-title'; title.textContent=model.title; head.appendChild(title);
    card.appendChild(head);
    if(model.rows.length){
      var wrap=document.createElement('div'); wrap.className='cc490-aria-table-wrap';
      var table=document.createElement('table'); table.className='cc490-aria-table';
      table.innerHTML='<thead><tr><th>#</th><th>Team Member</th><th>Dialed</th><th>Connected</th><th>Incoming</th><th>Talk</th><th>Subm.</th><th>Break</th><th>Idle</th></tr></thead><tbody></tbody>';
      var tb=table.querySelector('tbody');
      model.rows.forEach(function(r){var tr=document.createElement('tr');[r.rank,r.name,r.dialed,r.connected,r.incoming,r.talk,r.submissions,r.breakTime,r.idle].forEach(function(v,idx){var td=document.createElement('td');td.textContent=v;if(idx===1)td.className='cc490-aria-name';tr.appendChild(td)});tb.appendChild(tr)});
      wrap.appendChild(table); card.appendChild(wrap);
    } else {
      var empty=document.createElement('div'); empty.className='cc490-aria-empty'; empty.textContent=model.noActivity?'No activity recorded in this window.':'No team rows available for this report.'; card.appendChild(empty);
    }
    body.appendChild(card);
  }
  function enhanceAriaReports(){
    document.querySelectorAll('.chatRow').forEach(function(row){
      var strong=row.querySelector('.chatMeta strong'),body=row.querySelector('.chatBody'); if(!body)return;
      var raw=text(body),isReport=/^30-Minute Team Performance/i.test(raw),isAria=/^ARIA$/i.test(text(strong))&&isReport; if(!isAria&&!row.classList.contains('ariaReportRow'))return;
      row.classList.add('cc489-aria-row');
      var meta=row.querySelector('.chatMeta'); if(meta&&!meta.querySelector('.cc489-aria-badge')){var badge=document.createElement('span');badge.className='cc489-aria-badge';badge.textContent='AUTO REPORT';meta.appendChild(badge)}
      // React can repaint the same message row after an SSE/cache update. Only skip when
      // the actual table still exists; a stale data attribute must never make the table disappear.
      if(body.querySelector&&body.querySelector('.ariaSheet,.cc490-aria-sheet')){row.setAttribute('data-cc489-aria-ready','1');return;}
      row.removeAttribute('data-cc489-aria-ready');
      var match=raw.match(/(?:^|\n)Chart:\s*(\/semi-hourly-report\?reportId=[^\s]+)/i),path=match&&match[1]?match[1]:'';
      var clean=raw.replace(/(?:^|\n)Chart:\s*\/semi-hourly-report\?reportId=[^\s]+/i,'').trim(); renderAriaReportTable(body,clean); row.setAttribute('data-cc489-aria-ready','1');
      if(path&&!row.querySelector('.ariaReportOpen,.cc489-aria-open')){var btn=document.createElement('button');btn.type='button';btn.className='cc489-aria-open';btn.textContent='Open Performance Chart';btn.addEventListener('click',function(){history.pushState(null,'',path);window.dispatchEvent(new Event('popstate'))});body.insertAdjacentElement('afterend',btn)}
    });
  }

  var cc489ReportLoaded='';
  function decorateSemiHourlyReport(){
    if(!document.body.classList.contains('cc489-semi-report'))return;
    var reportId='';try{reportId=(new URL(location.href)).searchParams.get('reportId')||(new URL(location.href)).searchParams.get('report_id')||''}catch(_){}
    if(!reportId||cc489ReportLoaded===reportId)return; cc489ReportLoaded=reportId;
    fetch('/api/reports/semi-hourly?reportId='+encodeURIComponent(reportId),{credentials:'include',headers:{'X-Career-Crox-Background':'1'}}).then(function(r){if(!r.ok)throw new Error('report');return r.json()}).then(function(data){
      var grid=document.querySelector('.shr-grid'); if(grid&&!grid.querySelector('.cc489-incoming-stat')){var card=document.createElement('div');card.className='stat-card blue cc489-incoming-stat';card.innerHTML='<div class="stat-label">Incoming</div><div class="stat-value">'+Number(data&&data.summary&&data.summary.incoming_calls||0)+'</div>';grid.insertBefore(card,grid.children[4]||null)}
      var table=document.querySelector('.shr-table'); if(!table)return; var head=table.querySelector('thead tr'); if(head&&!head.querySelector('.cc489-incoming-th')){var th=document.createElement('th');th.className='shr-thin cc489-incoming-th';th.textContent='Incoming';var anchors=head.querySelectorAll('th');var conn=Array.from(anchors).find(function(x){return text(x)==='Conn'});if(conn)conn.insertAdjacentElement('afterend',th)}
      var rows=Array.isArray(data&&data.rows)?data.rows:[]; table.querySelectorAll('tbody tr').forEach(function(tr,idx){if(!rows[idx]||tr.querySelector('.cc489-incoming-td'))return;var cells=tr.querySelectorAll('td');var connCell=cells[7];if(!connCell)return;var td=document.createElement('td');td.className='shr-thin cc489-incoming-td';td.textContent=Number(rows[idx].metrics&&rows[idx].metrics.incoming_calls||0);connCell.insertAdjacentElement('afterend',td)});
    }).catch(function(){cc489ReportLoaded=''});
  }

  function decorateChat(){
    if(window.__CC_CHAT_REACT_OWNER__) return; // CC783: never replace React header, messages or composer DOM.
    if(!document.body.classList.contains('cc469-chat')) return;
    fitChatShell(); ensureLeftPanel(); ensureChatHeader(); ensureMessageRows(); ensureComposer(); ensureRightPanel(); enhanceAriaReports();
  }

  var chatObserver = null;
  var observedShell = null;
  var chatApplyScheduled = false;

  function observeChatShell(){
    if(window.__CC_CHAT_REACT_OWNER__) return;
    var shell = document.querySelector('.teamsShell');
    var active = document.body.classList.contains('cc469-chat') && !!shell;
    if (!active){
      if (chatObserver) chatObserver.disconnect();
      chatObserver = null;
      observedShell = null;
      return;
    }
    if (chatObserver && observedShell === shell) return;
    if (chatObserver) chatObserver.disconnect();
    observedShell = shell;
    chatObserver = new MutationObserver(function(){
      if (chatApplyScheduled) return;
      chatApplyScheduled = true;
      requestAnimationFrame(function(){
        chatApplyScheduled = false;
        if (!chatObserver || !observedShell || !document.body.contains(observedShell)) return;
        chatObserver.disconnect();
        try { decorateChat(); }
        finally {
          if (chatObserver && observedShell && document.body.contains(observedShell)) {
            chatObserver.observe(observedShell, { childList:true, subtree:true });
          }
        }
      });
    });
    chatObserver.observe(shell, { childList:true, subtree:true });
  }



  // CC26_482: instant visual selection. React remains source of truth; this only
  // removes perceived click latency while the thread request runs in background.
  function bindInstantThreadFeedback(){if(window.__CC_CHAT_REACT_OWNER__) return;
    if(window.__CC26_487_FAST_THREAD_FEEDBACK__) return;
    window.__CC26_487_FAST_THREAD_FEEDBACK__=true;
    document.addEventListener('pointerdown',function(ev){
      if(!document.body.classList.contains('cc469-chat')) return;
      var btn=ev.target&&ev.target.closest?ev.target.closest('.teamsLeft .personBtn,.teamsLeft .threadBtn'):null;
      if(!btn) return;
      document.querySelectorAll('.teamsLeft .cc482-instant-active').forEach(function(n){n.classList.remove('cc482-instant-active');});
      btn.classList.add('cc482-instant-active');
      var title=btn.querySelector('.threadTitle');
      var label=text(title).replace(/\s*\(You\)\s*/g,'').trim();
      if(label){
        var h=document.querySelector('.teamsChatHeader .panel-title,.teamsChatHeader .chat-room-title');
        if(h) h.textContent=label;
        var rh=document.querySelector('.cc469-info-hero h3');
        if(rh) rh.textContent=label;
      }
    },true);
  }



  /* CC26_498: role-aware instant unlock approvals + global instant Team Chat preview. */
  var cc497UnlockCheckAt=0;
  var cc497UnlockBusy=false;
  var cc498ApprovalStream=null;
  var cc498ApprovalRetryAt=0;
  var cc498ChatStream=null;
  var cc498ChatRetryAt=0;
  var cc498ChatLastId='';
  var cc498ChatUnread=0;
  var cc500ChatToastTimer=null;
  var cc498SelfLockCheckAt=0;

  function cc497RoleText(){
    try{
      var u=JSON.parse(localStorage.getItem('careerCroxCachedUser')||'{}')||{};
      return String(u.role||u.designation||u.user_role||'').trim().toLowerCase();
    }catch(_){ return String((document.querySelector('.user-role')||{}).textContent||'').trim().toLowerCase(); }
  }
  function cc498CachedUser(){
    try{return JSON.parse(localStorage.getItem('careerCroxCachedUser')||'{}')||{}}catch(_){return{}}
  }
  /* CC26_758: local-only WhatsApp-style unread/recent state. No polling and no Supabase read loop. */
  function cc758ChatIdentity(){var u=cc498CachedUser();return String(u.user_id||u.recruiter_code||u.username||u.email||'anon').trim().toLowerCase()||'anon'}
  function cc758ChatStateKey(){return 'cc758_chat_unread:'+cc758ChatIdentity()}
  function cc758LoadChatState(){
    var out={buckets:{},updated_at:0};try{var raw=JSON.parse(localStorage.getItem(cc758ChatStateKey())||'{}')||{};if(raw.buckets&&typeof raw.buckets==='object')out.buckets=raw.buckets;out.updated_at=Number(raw.updated_at||0)||0}catch(_){}
    return out;
  }
  function cc758SaveChatState(st){
    try{
      var now=Date.now(),rows=Object.keys(st.buckets||{}).map(function(k){return [k,st.buckets[k]]}).filter(function(x){return x[1]&&Number(x[1].at||0)>now-14*86400000}).sort(function(a,b){return Number(b[1].at||0)-Number(a[1].at||0)}).slice(0,40),b={};rows.forEach(function(x){b[x[0]]=x[1]});st.buckets=b;st.updated_at=now;localStorage.setItem(cc758ChatStateKey(),JSON.stringify(st));
    }catch(_){}
  }
  function cc758Norm(v){return String(v||'').replace(/\s*\(You\)\s*/gi,'').trim().toLowerCase()}
  function cc758ThreadOf(item){return String(item&&item.thread_key||'team').trim()||'team'}
  function cc758SenderOf(item){return String(item&&item.sender_username||item&&item.sender_name||'member').trim().toLowerCase()||'member'}
  function cc758BucketKey(item){return cc758ThreadOf(item)+'|'+cc758SenderOf(item)}
  function cc758IsMine(item){var me=cc498CachedUser(),mine=String(me.username||me.user_id||'').trim().toLowerCase(),sender=String(item&&item.sender_username||'').trim().toLowerCase();return !!(mine&&sender&&mine===sender)}
  function cc758TouchMessage(item,makeUnread){
    if(!item||cc758IsMine(item))return cc758LoadChatState();
    var st=cc758LoadChatState(),key=cc758BucketKey(item),old=st.buckets[key]||{},body=String(item.body||item.message||item.message_text||item.content||'New message').replace(/\s+/g,' ').trim();
    st.buckets[key]={thread:cc758ThreadOf(item),sender_username:String(item.sender_username||''),sender_name:String(item.sender_name||item.sender_username||'Team member'),count:makeUnread?Math.max(0,Number(old.count||0))+1:Math.max(0,Number(old.count||0)),at:Date.now(),last_id:String(item.id||item.message_id||''),text:body.slice(0,180)};
    cc758SaveChatState(st);cc758RenderUnreadUI(st);return st;
  }
  function cc758TotalUnread(st){return Object.keys((st||{}).buckets||{}).reduce(function(n,k){return n+Math.max(0,Number(st.buckets[k]&&st.buckets[k].count||0))},0)}
  function cc758ThreadUnread(thread,st){return Object.keys((st||{}).buckets||{}).reduce(function(n,k){var b=st.buckets[k]||{};return n+(String(b.thread||'')===String(thread||'team')?Math.max(0,Number(b.count||0)):0)},0)}
  function cc758MarkThreadRead(thread){
    var st=cc758LoadChatState(),changed=false;Object.keys(st.buckets||{}).forEach(function(k){var b=st.buckets[k];if(b&&String(b.thread||'')===String(thread||'team')&&Number(b.count||0)>0){b.count=0;changed=true}});if(changed)cc758SaveChatState(st);cc758RenderUnreadUI(st);return st;
  }
  function cc758SortedBuckets(st,onlyUnread){return Object.keys((st||{}).buckets||{}).map(function(k){return st.buckets[k]}).filter(function(b){return b&&(!onlyUnread||Number(b.count||0)>0)}).sort(function(a,b){return Number(b.at||0)-Number(a.at||0)})}
  function cc758RenderTopPill(st){
    if(window.__CC930_CHAT_BADGE_OWNER__)return;var pill=document.querySelector('.top-pill[data-pill="team-chat"]');if(!pill)return;var total=cc758TotalUnread(st);pill.classList.toggle('cc790-unread-nav',total>0);document.querySelectorAll('.sidebar a[href="/chat"]').forEach(function(a){a.classList.toggle('cc790-unread-nav',total>0)});var ignored=0,badge=pill.querySelector('.cc758-chat-pill-badge');
    if(total>0){if(!badge){badge=document.createElement('span');badge.className='cc758-chat-pill-badge';pill.appendChild(badge)}badge.textContent=total>99?'99+':String(total);pill.title=total+' pending Team Chat message'+(total===1?'':'s')}
    else{if(badge)badge.remove();pill.title='CRM Team Chat'}
  }
  function cc758RenderPeopleOrder(st){if(window.__CC_CHAT_REACT_OWNER__) return;
    if(!/^\/chat(?:\/|$)/.test(location.pathname||''))return;
    var buckets=cc758SortedBuckets(st,false).filter(function(b){return String(b.thread||'').indexOf('dm:')===0}),buttons=Array.prototype.slice.call(document.querySelectorAll('.teamsLeft .personBtn'));if(!buttons.length)return;
    var rank={};buckets.forEach(function(b,i){var k=cc758Norm(b.sender_name||b.sender_username);if(k&&!Object.prototype.hasOwnProperty.call(rank,k))rank[k]={i:i,count:Number(b.count||0),at:Number(b.at||0)}});
    buttons.forEach(function(btn,idx){var title=btn.querySelector('.threadTitle'),name=cc758Norm(title&&title.textContent),r=rank[name],badge=btn.querySelector('.cc758-unread-badge');btn.setAttribute('data-cc758-original-order',btn.getAttribute('data-cc758-original-order')||String(idx));btn.classList.toggle('cc758-chat-recent',!!r);if(r&&r.count>0){if(!badge){badge=document.createElement('span');badge.className='cc758-unread-badge';btn.appendChild(badge)}badge.textContent=r.count>99?'99+':String(r.count)}else if(badge)badge.remove()});
    var sorted=buttons.slice().sort(function(a,b){var an=cc758Norm((a.querySelector('.threadTitle')||{}).textContent),bn=cc758Norm((b.querySelector('.threadTitle')||{}).textContent),ar=rank[an],br=rank[bn];if(ar||br)return Number(br&&br.at||0)-Number(ar&&ar.at||0);return Number(a.getAttribute('data-cc758-original-order')||0)-Number(b.getAttribute('data-cc758-original-order')||0)}),after=buttons[buttons.length-1]&&buttons[buttons.length-1].nextSibling,parent=buttons[0]&&buttons[0].parentNode;if(parent)sorted.forEach(function(btn){parent.insertBefore(btn,after)});
  }
  function cc758RenderChannelBadge(st){if(window.__CC_CHAT_REACT_OWNER__) return;
    if(!/^\/chat(?:\/|$)/.test(location.pathname||''))return;var buttons=Array.prototype.slice.call(document.querySelectorAll('.teamsLeft .threadBtn'));if(!buttons.length)return;var teamCount=cc758ThreadUnread('team',st),teamBtn=buttons[0],badge=teamBtn&&teamBtn.querySelector('.cc758-unread-badge');if(teamBtn){teamBtn.classList.toggle('cc758-chat-recent',teamCount>0);if(teamCount>0){if(!badge){badge=document.createElement('span');badge.className='cc758-unread-badge';teamBtn.appendChild(badge)}badge.textContent=teamCount>99?'99+':String(teamCount)}else if(badge)badge.remove()}
  }
  function cc758RenderUnreadUI(st){st=st||cc758LoadChatState();cc758RenderTopPill(st);cc758RenderPeopleOrder(st);cc758RenderChannelBadge(st)}
  function cc758MarkCurrentThreadRead(){if(!/^\/chat(?:\/|$)/.test(location.pathname||'')||document.hidden)return;var feed=document.querySelector('.chatFeed');if(!feed)return;cc758MarkThreadRead(activeChatThread())}
  function cc497Leadership(){
    var r=cc497RoleText();
    return r==='tl'||r.indexOf('team lead')!==-1||r.indexOf('teamlead')!==-1||r.indexOf('manager')!==-1||r.indexOf('admin')!==-1;
  }
  function cc498IsTl(){var r=cc497RoleText();return r==='tl'||r.indexOf('team lead')!==-1||r.indexOf('teamlead')!==-1}
  function cc498IsLogin(){return /^\/login(?:\/|$)/.test(location.pathname||'')}
  function cc498InstallStyle(){
    if(document.getElementById('cc498-live-style'))return;
    var st=document.createElement('style');st.id='cc498-live-style';st.textContent='\
@keyframes cc498ApprovalBounce{0%,100%{transform:translateY(0) scale(1)}35%{transform:translateY(-4px) scale(1.055)}60%{transform:translateY(0) scale(1.02)}}\
@keyframes cc498ApprovalGlow{0%,100%{box-shadow:0 0 0 0 rgba(255,151,44,.16),0 8px 20px rgba(226,115,25,.18)}50%{box-shadow:0 0 0 8px rgba(255,151,44,.12),0 12px 28px rgba(226,115,25,.28)}}\
body:not(.login-body) .top-pill[data-pill="approvals"].cc498-approval-urgent{animation:cc498ApprovalBounce .9s ease-in-out infinite,cc498ApprovalGlow 1.4s ease-in-out infinite!important;background:linear-gradient(135deg,#ffb33f,#ff7b32)!important;color:#fff!important;-webkit-text-fill-color:#fff!important;border-color:#ff9a39!important;position:relative!important;z-index:100503!important}\
#cc497-unlock-approval{filter:drop-shadow(0 18px 35px rgba(40,66,94,.18))}\
@keyframes cc500ChatToastIn{0%{opacity:0;transform:translate(-50%,-26px) scale(.96)}65%{opacity:1;transform:translate(-50%,4px) scale(1.01)}100%{opacity:1;transform:translate(-50%,0) scale(1)}}\
@keyframes cc500ChatToastOut{to{opacity:0;transform:translate(-50%,-20px) scale(.97)}}\
#cc498-chat-peek{position:fixed;left:50%;top:16px;bottom:auto;width:min(430px,calc(100vw - 28px));min-height:72px;height:auto;z-index:100900;border:1px solid rgba(90,133,216,.34);border-radius:20px;background:linear-gradient(135deg,rgba(255,255,255,.98) 0%,rgba(239,247,255,.98) 52%,rgba(245,239,255,.98) 100%);box-shadow:0 22px 55px rgba(27,55,101,.24);overflow:hidden;cursor:pointer;font-family:inherit;color:#102d4a;animation:cc500ChatToastIn .38s cubic-bezier(.2,.9,.25,1.15) both;backdrop-filter:blur(12px)}\
#cc498-chat-peek.cc500-toast-out{animation:cc500ChatToastOut .22s ease forwards}\
#cc498-chat-peek:before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:linear-gradient(180deg,#3b82f6,#7c3aed,#22c55e)}\
#cc498-chat-peek .cc498-peek-head{min-height:30px;display:flex;align-items:center;gap:8px;padding:9px 14px 2px 17px;font-size:11px;font-weight:1000;white-space:nowrap;color:#45617e}\
#cc498-chat-peek .cc498-peek-dot{width:10px;height:10px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 4px rgba(34,197,94,.13);flex:0 0 10px}\
#cc498-chat-peek .cc498-peek-count{margin-left:auto;min-width:22px;height:22px;padding:0 7px;border-radius:999px;background:linear-gradient(135deg,#3978ff,#7258f5);color:#fff;display:grid;place-items:center;font-size:10px;font-weight:1000}\
#cc498-chat-peek .cc498-peek-body{padding:2px 16px 12px 17px;font-size:12.5px;font-weight:800;line-height:1.35;color:#294967;opacity:1;transform:none}\
#cc498-chat-peek .cc498-peek-sender{font-size:13.5px;font-weight:1000;color:#112f4c;margin-bottom:3px}\
#cc498-chat-peek .cc498-peek-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#35536f}\
#cc498-chat-peek .cc758-peek-summary{font-size:11px;font-weight:900;color:#607895;margin:1px 0 7px}\
#cc498-chat-peek .cc758-peek-list{display:grid;gap:5px;margin-bottom:7px}\
#cc498-chat-peek .cc758-peek-person{display:flex;align-items:center;gap:8px;min-height:28px;padding:5px 8px;border:1px solid rgba(150,176,214,.28);border-radius:10px;background:rgba(255,255,255,.68)}\
#cc498-chat-peek .cc758-peek-person span{min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;font-weight:950;color:#173a5d}\
#cc498-chat-peek .cc758-peek-person strong{min-width:23px;height:20px;padding:0 6px;border-radius:999px;display:grid;place-items:center;background:#edf3ff;color:#395faa;font-size:10px;font-weight:1000}\
body:not(.login-body) .top-pill[data-pill="team-chat"]{position:relative!important}\
body:not(.login-body) .top-pill[data-pill="team-chat"] .cc758-chat-pill-badge{position:absolute;right:-7px;top:-8px;min-width:22px;height:22px;padding:0 6px;border:2px solid #fff;border-radius:999px;display:grid;place-items:center;background:linear-gradient(135deg,#ef4444,#f97316);color:#fff!important;-webkit-text-fill-color:#fff!important;font-size:10px!important;font-weight:1000!important;line-height:1!important;box-shadow:0 5px 14px rgba(220,60,48,.28)}\
body.cc469-chat .personBtn.cc758-chat-recent,body.cc469-chat .threadBtn.cc758-chat-recent{background:linear-gradient(135deg,#f4f8ff,#faf7ff)!important;border-color:#cbdcff!important}\
body.cc469-chat .cc758-unread-badge{margin-left:auto;min-width:22px;height:22px;padding:0 6px;border-radius:999px;display:grid;place-items:center;background:linear-gradient(135deg,#2f80ed,#6d5dfc);color:#fff!important;-webkit-text-fill-color:#fff!important;font-size:10px!important;font-weight:1000!important;box-shadow:0 5px 12px rgba(58,92,210,.18)}\
#cc498-tl-lock{position:fixed;inset:0;z-index:100700;background:rgba(18,35,57,.34);backdrop-filter:blur(5px);display:grid;place-items:center;padding:18px}\
#cc498-tl-lock .cc498-lock-card{width:min(470px,94vw);border:1px solid #e2b2a0;border-radius:24px;padding:20px;background:linear-gradient(145deg,#fff 0%,#fff4ef 100%);box-shadow:0 28px 72px rgba(83,41,26,.24);color:#28333f}\
#cc498-tl-lock textarea{width:100%;box-sizing:border-box;min-height:92px;border:1px solid #d7dee9;border-radius:14px;padding:11px;font:inherit;color:#18324d;background:#fff;outline:none}\
#cc498-tl-lock button{border:0;border-radius:13px;padding:10px 14px;background:linear-gradient(135deg,#ff8b3d,#ff5f4d);color:#fff;font-weight:1000;cursor:pointer;box-shadow:0 9px 20px rgba(220,84,44,.18)}\
body.cc498-unlocked-now .crm-lock-backdrop{display:none!important}\
@media(max-width:760px){#cc498-chat-peek{top:10px;width:calc(100vw - 20px);border-radius:17px}}';document.head.appendChild(st);
  }
  function cc498ApprovalButton(){return document.querySelector('.top-pill[data-pill="approvals"]')}
  const cc898ResolvedUnlocks=new Map();
  function cc898RememberResolved(id,review){
    if(!id)return;cc898ResolvedUnlocks.set(String(id)+(review?':review':':unlock'),Date.now());
    if(cc898ResolvedUnlocks.size>200)cc898ResolvedUnlocks.delete(cc898ResolvedUnlocks.keys().next().value);
  }
  function cc497RemoveUnlockPopup(){
    var old=document.getElementById('cc497-unlock-approval');if(old)old.remove();
    var b=cc498ApprovalButton();if(b)b.classList.remove('cc498-approval-urgent');
  }
  function cc498PositionApprovalPopup(){
    var wrap=document.getElementById('cc497-unlock-approval'),btn=cc498ApprovalButton();if(!wrap||!btn)return;
    var r=btn.getBoundingClientRect(),w=Math.min(380,Math.max(300,window.innerWidth-24));
    var left=Math.min(window.innerWidth-w-12,Math.max(12,r.right-w));
    wrap.style.left=left+'px';wrap.style.top=Math.min(window.innerHeight-180,r.bottom+9)+'px';wrap.style.width=w+'px';wrap.style.right='auto';wrap.style.bottom='auto';
  }
  function cc497Post(path,payload){
    return fetch(path,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-Career-Crox-Background':'1'},body:JSON.stringify(payload||{})}).then(function(r){return r.json().catch(function(){return {}}).then(function(d){if(!r.ok)throw new Error(d.message||'Request failed');return d})});
  }
  function cc930UnlockFacts(card,item){
    if(!document.getElementById('cc930-unlock-style')){var style=document.createElement('style');style.id='cc930-unlock-style';style.textContent=`
#cc497-unlock-approval{max-height:calc(100dvh - 110px);overflow:auto;filter:drop-shadow(0 20px 40px #63418826)!important}
#cc497-unlock-approval>div{background:linear-gradient(125deg,#fffaf2 0%,#fff 45%,#f5edff 100%)!important;border:1px solid #e5cceb!important;border-radius:24px!important;color:#2e2546!important;padding:18px!important;box-shadow:inset 0 1px 0 #fff,0 22px 55px #533d7d24!important}
#cc497-unlock-approval>div:before{display:none!important}
#cc497-unlock-approval .cc930-unlock-note{background:linear-gradient(120deg,#fff1bc,#fff9e7)!important;border:1px solid #e9bd59!important;border-left:5px solid #d89518!important;border-radius:13px!important;padding:12px!important;margin:10px 0!important;font-size:14px!important;line-height:1.5!important;font-weight:750!important;color:#654105!important;-webkit-text-fill-color:#654105!important;max-height:140px!important;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
#cc497-unlock-approval .cc930-unlock-facts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px}
#cc497-unlock-approval .cc930-unlock-fact{padding:9px;border:1px solid #dcd6ee;border-radius:12px;background:#f1eaff;color:#503383;font-size:12px;font-weight:750;overflow-wrap:anywhere}
#cc497-unlock-approval .cc930-unlock-fact:nth-child(2){background:#e9fbf2;border-color:#b1dfca;color:#226347}
#cc497-unlock-approval .cc930-unlock-fact:nth-child(3){background:#fff0e6;border-color:#edc5ab;color:#9d4013}
#cc497-unlock-approval .cc930-unlock-fact:nth-child(4){background:#fceaf4;border-color:#eec0d9;color:#8b2862}
#cc497-unlock-approval .cc930-unlock-fact small{display:block;font-size:10px;font-weight:650;margin-bottom:4px}
#cc497-unlock-approval button{min-height:40px;border-radius:12px!important;padding:9px 11px!important;font-size:12px;font-weight:800}
`;document.head.appendChild(style);}
    if(item.type!=='unlock')return;
    function stamp(value){if(!value)return 'Not recorded';var d=new Date(value);return isNaN(d)?'Not recorded':d.toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});}
    var grid=document.createElement('div');grid.className='cc930-unlock-facts';
    [['Break started',stamp(item.break_started_at)],['Break ended',item.break_active?'Still running':stamp(item.break_ended_at)],['Late by',String(item.late_minutes||0)+' min'],["Today's unlock",item.unlock_number_today?'#'+item.unlock_number_today:'Not recorded']].forEach(function(pair){var box=document.createElement('div');box.className='cc930-unlock-fact';var label=document.createElement('small');label.textContent=pair[0];box.appendChild(label);box.appendChild(document.createTextNode(pair[1]));grid.appendChild(box);});card.appendChild(grid);
  }
  function cc498RenderUnlock(item){
    if(!item||!['unlock','youtube'].includes(item.type))return cc497RemoveUnlockPopup();
    if(cc497UnlockBusy)return;
    if(cc898ResolvedUnlocks.has(String(item.id)+(item.manager_review?':review':':unlock')))return;

    var btnTop=cc498ApprovalButton();if(btnTop){btnTop.classList.add('cc498-approval-urgent');}
    var old=document.getElementById('cc497-unlock-approval');
    if(old&&old.getAttribute('data-request-id')===String(item.id||'')&&old.getAttribute('data-manager-review')===String(Boolean(item.manager_review))){cc498PositionApprovalPopup();return}
    cc497RemoveUnlockPopup();if(btnTop)btnTop.classList.add('cc498-approval-urgent');
    var wrap=document.createElement('div');wrap.id='cc497-unlock-approval';wrap.setAttribute('data-request-id',String(item.id||''));wrap.setAttribute('data-manager-review',String(Boolean(item.manager_review)));wrap.style.cssText='position:fixed;z-index:100502;font-family:inherit';
    var card=document.createElement('div');card.style.cssText='border:1px solid #f0b46d;border-radius:19px;padding:14px;background:linear-gradient(145deg,#fffdf8 0%,#fff2df 100%);box-shadow:0 22px 54px rgba(119,72,25,.22);color:#243247';
    var title=document.createElement('div');title.textContent=item.manager_review?'TL resumed · review pending':item.type==='youtube'?'YouTube Access Approval':'Unlock Approval Required';title.style.cssText='font-size:16px;font-weight:1000;color:#7b3f00;margin-bottom:5px';
    var name=document.createElement('div');name.textContent=String(item.title||'Employee unlock request');name.style.cssText='font-size:14px;font-weight:1000;color:#1d3148;margin-bottom:5px';
    var role=document.createElement('div');role.textContent=item.requester_role?('Role: '+String(item.requester_role).toUpperCase()):'';role.style.cssText='font-size:10px;font-weight:1000;color:#9a5c1c;margin-bottom:4px;text-transform:uppercase';
    var reason=document.createElement('div');reason.className='cc930-unlock-note';reason.textContent='Employee note: '+String(item.employee_note||item.process||'No note recorded');reason.style.cssText='font-size:11.5px;font-weight:800;color:#4b5d70;line-height:1.4;margin-bottom:10px;max-height:62px;overflow:auto';
    var row=document.createElement('div');row.style.cssText='display:flex;gap:7px;flex-wrap:wrap';
    function mk(label,bg,color){var b=document.createElement('button');b.type='button';b.textContent=label;b.style.cssText='border:0;border-radius:11px;padding:8px 11px;font-weight:1000;cursor:pointer;background:'+bg+';color:'+color+';box-shadow:0 7px 16px rgba(55,72,95,.12)';return b}
    var approve=mk(item.manager_review?'Confirm review':item.type==='youtube'?'Approve YouTube':'Approve Unlock','linear-gradient(135deg,#17ad69,#49d486)','#fff');
    var reject=mk(item.manager_review?'Flag issue':'Reject','linear-gradient(135deg,#ff725f,#ef4e68)','#fff');
    var center=mk('Open Approvals','#edf3ff','#244d7a');
    approve.onclick=function(){if(cc497UnlockBusy)return;cc497UnlockBusy=true;approve.disabled=true;cc497RemoveUnlockPopup();cc497Post('/api/approvals/approve',{type:item.type,id:item.id}).then(function(){cc898RememberResolved(item.id,item.manager_review);cc497RemoveUnlockPopup();cc497UnlockCheckAt=0;setTimeout(function(){cc497CheckUnlockApproval(true)},350)}).catch(function(e){cc497UnlockBusy=false;cc498RenderUnlock(item);alert(e.message||'Approval failed')}).finally(function(){cc497UnlockBusy=false;approve.disabled=false})};
    reject.onclick=function(){if(cc497UnlockBusy)return;var why=prompt('Reject reason (required):','');if(!String(why||'').trim())return;cc497UnlockBusy=true;reject.disabled=true;cc497RemoveUnlockPopup();cc497Post('/api/approvals/reject',{type:item.type,id:item.id,reason:String(why).trim(),flag_session:Boolean(item.manager_review)}).then(function(){cc898RememberResolved(item.id,item.manager_review);cc497RemoveUnlockPopup();cc497UnlockCheckAt=0;setTimeout(function(){cc497CheckUnlockApproval(true)},350)}).catch(function(e){cc497UnlockBusy=false;cc498RenderUnlock(item);alert(e.message||'Reject failed')}).finally(function(){cc497UnlockBusy=false;reject.disabled=false})};
    center.onclick=function(){window.open('/approvals','_blank','noopener,noreferrer')};
    row.appendChild(approve);row.appendChild(reject);row.appendChild(center);card.appendChild(title);card.appendChild(name);if(item.requester_role)card.appendChild(role);card.appendChild(reason);cc930UnlockFacts(card,item);card.appendChild(row);wrap.appendChild(card);document.body.appendChild(wrap);cc498PositionApprovalPopup();
  }
  window.addEventListener('cc609:show-note',function(e){cc498RenderUnlock(e.detail)});
  function cc497CheckUnlockApproval(force){
    // CC26_760: no timed approval polling. Only an explicit/event-driven recovery may read once.
    if(!force)return;
    if(window.__CC602_NETWORK_PAUSED__||!cc497Leadership())return;
    cc497UnlockCheckAt=Date.now();
    fetch('/api/approvals?scope=ops',{credentials:'include',headers:{'X-Career-Crox-Background':'1','Cache-Control':'no-cache'}}).then(function(r){if(!r.ok)throw new Error('approval');return r.json()}).then(function(d){var items=Array.isArray(d&&d.items)?d.items:[];var item=items.find(function(x){return x&&x.type==='unlock'});window.dispatchEvent(new CustomEvent('career-crox-approval-counts',{detail:d.counts}));cc498RenderUnlock(item||null)}).catch(function(){/* live SSE remains primary */});
  }
  function cc498CloseApprovalStream(){if(cc498ApprovalStream){try{cc498ApprovalStream.close()}catch(_){}cc498ApprovalStream=null}}
  function cc498EnsureApprovalStream(){
    // CC26_772: reminder/approval SSE stays live 24x7 while logged in; no DB polling is added.
    if(window.__CC602_NETWORK_PAUSED__||cc498IsLogin()||typeof EventSource==='undefined'){cc498CloseApprovalStream();return}
    if(cc498ApprovalStream||Date.now()<cc498ApprovalRetryAt)return;
    try{
      var es=window.__CC819_WORKSPACE_SOURCE__('/api/approvals/stream');cc498ApprovalStream=es;
      es.addEventListener('ready',function(){cc498ApprovalRetryAt=0;window.dispatchEvent(new Event('career-crox-reminder-ready'));});
      es.addEventListener('task-changed',function(ev){try{var d=JSON.parse(ev.data||'{}');window.dispatchEvent(new CustomEvent('career-crox-task-changed',{detail:d}));if(d.task&&d.task.task_id)window.dispatchEvent(new CustomEvent('career-crox-workspace-change',{detail:{source:'/api/tasks/'+d.task.task_id,item:d.task,at:d.at,meta:{kind:d.kind}}}));}catch(_){}});
      es.addEventListener('notification',function(ev){try{window.dispatchEvent(new CustomEvent('career-crox-notification',{detail:JSON.parse(ev.data||'{}').item}))}catch(_){}});
      es.addEventListener('break-status',function(ev){try{window.dispatchEvent(new CustomEvent('career-crox-break-status',{detail:JSON.parse(ev.data||'{}')}));}catch(_){}});
      es.addEventListener('form-layout',function(ev){try{window.dispatchEvent(new CustomEvent('career-crox-form-layout',{detail:JSON.parse(ev.data||'{}')}))}catch(_){}});
      es.addEventListener('workspace-change',function(ev){try{window.dispatchEvent(new CustomEvent('career-crox-workspace-change',{detail:JSON.parse(ev.data||'{}')}))}catch(_){}});
      es.addEventListener('message-templates-changed',function(){window.dispatchEvent(new Event('cc878-wa-templates-changed'));});
      es.addEventListener('access-changed',function(ev){try{window.dispatchEvent(new CustomEvent('career-crox-access-changed',{detail:JSON.parse(ev.data||'{}')}))}catch(_){}});
      es.addEventListener('submission-review',function(ev){try{window.dispatchEvent(new CustomEvent('career-crox-submission-review',{detail:JSON.parse(ev.data||'{}')}))}catch(_){}});
      es.addEventListener('unlock',function(ev){if(!cc497Leadership())return;try{var d=JSON.parse(ev.data||'{}');cc498RenderUnlock(d);window.dispatchEvent(new CustomEvent('career-crox-approval-changed',{detail:d}));}catch(_){}});
      es.addEventListener('approval-changed',function(ev){try{window.dispatchEvent(new CustomEvent('career-crox-approval-changed',{detail:JSON.parse(ev.data||'{}')}))}catch(_){}});
      es.addEventListener('chat-read',function(ev){try{window.dispatchEvent(new CustomEvent('career-crox-chat-read',{detail:JSON.parse(ev.data||'{}')}))}catch(_){}});
      es.addEventListener('reminder-dirty',function(ev){try{var patch=JSON.parse(ev.data||'{}');window.dispatchEvent(new CustomEvent('career-crox-workspace-change',{detail:patch}));window.dispatchEvent(new CustomEvent('career-crox-manager-reminder-dirty',{detail:JSON.parse(ev.data||'{}')}))}catch(_){window.dispatchEvent(new Event('career-crox-manager-reminder-dirty'))}});
      es.addEventListener('self-locked',function(ev){if(!cc498IsTl())return;try{var d=JSON.parse(ev.data||'{}');cc498RenderTlLock({locked:'1',lock_reason:'idle',lock_message:String(d.process||'CRM inactivity lock. Manager approval required.')})}catch(_){}});
      es.addEventListener('youtube-access',function(ev){window.dispatchEvent(new CustomEvent('cc790-youtube-access',{detail:JSON.parse(ev.data||'{}')}));});
      es.addEventListener('dialer-live',function(ev){try{var payload=JSON.parse(ev.data||'{}');window.__CC_DIALER_SNAPSHOT__=payload;window.dispatchEvent(new CustomEvent('career-crox-dialer-live',{detail:payload}));}catch(_){}});
      es.addEventListener('unlock-resolved',function(ev){
        var d={};try{d=JSON.parse(ev.data||'{}')}catch(_){}
        cc898RememberResolved(d.id,d.review_only);
        window.dispatchEvent(new CustomEvent('career-crox-approval-changed',{detail:d}));
        window.dispatchEvent(new CustomEvent('career-crox-unlock-resolved',{detail:d}));
        var cur=document.getElementById('cc497-unlock-approval');if(cur&&(!d.id||cur.getAttribute('data-request-id')===String(d.id)))cc497RemoveUnlockPopup();
        if(String(d.status||'').toLowerCase()==='approved'){
          document.body.classList.add('cc498-unlocked-now');var tl=document.getElementById('cc498-tl-lock');if(tl)tl.remove();
          setTimeout(function(){document.body.classList.remove('cc498-unlocked-now')},130000);
        }
        if(cc497Leadership()){cc497UnlockCheckAt=0;setTimeout(function(){cc497CheckUnlockApproval(true)},250)}
      });
      es.onerror=function(){if(es.readyState===2){cc498ApprovalStream=null;cc498ApprovalRetryAt=Date.now()+15000;setTimeout(cc498EnsureApprovalStream,15100)}};
    }catch(_){cc498ApprovalRetryAt=Date.now()+15000}
  }
  function cc498CloseChatStream(){if(cc498ChatStream){try{cc498ChatStream.close()}catch(_){}cc498ChatStream=null}}
  function cc498RemoveChatPeek(){if(cc500ChatToastTimer){clearTimeout(cc500ChatToastTimer);cc500ChatToastTimer=null}var n=document.getElementById('cc498-chat-peek');if(n)n.remove();cc498ChatUnread=0}
  function cc500NavigateCurrentChat(thread){var path='/chat?thread='+encodeURIComponent(String(thread||'team'));try{history.pushState(null,'',path);window.dispatchEvent(new PopStateEvent('popstate'));window.dispatchEvent(new Event('cc-route-change'))}catch(_){location.href=path}}
  function cc498OpenChat(thread){var path='/chat?thread='+encodeURIComponent(String(thread||'team'));cc758MarkThreadRead(thread);cc498RemoveChatPeek();try{var win=window.open(path,'careerCroxTeamChat');if(win&&typeof win.focus==='function')win.focus();else location.href=path}catch(_){location.href=path}}
  function cc500ClaimToast(id){if(!id)return true;try{var key='cc500ChatToast:'+id,now=Date.now(),last=Number(localStorage.getItem(key)||0);if(last&&now-last<30000)return false;localStorage.setItem(key,String(now));return true}catch(_){return true}}
  function cc498ShowChatPeek(item){
    if(!item||window.__CC814_CHAT_TOAST_OWNER__)return;
    if(window.__CC787_PLAY_SOUND__)window.__CC787_PLAY_SOUND__();
    var cc758OnChat=/^\/chat(?:\/|$)/.test(location.pathname||'');

    if(String(item.reference_type||'')==='semi_hourly_report'&&String(item.sender_username||'').toLowerCase()==='aria')return;
    var me=cc498CachedUser(),mine=String(me.username||'').trim().toLowerCase(),sender=String(item.sender_username||'').trim().toLowerCase();if(mine&&sender&&mine===sender)return;
    var id=String(item.id||item.message_id||item.created_at||'');if(id&&id===cc498ChatLastId)return;if(!cc500ClaimToast(id))return;cc498ChatLastId=id;cc498ChatUnread+=1;
    var st=cc758TouchMessage(item,true),total=cc758TotalUnread(st),rows=cc758SortedBuckets(st,true).slice(0,4);
    var root=document.getElementById('cc498-chat-peek');if(!root){root=document.createElement('div');root.id='cc498-chat-peek';root.innerHTML='<div class="cc498-peek-head"><span class="cc498-peek-dot"></span><span class="cc498-peek-title">CRM Team Chat</span><span class="cc498-peek-count">1 pending</span></div><div class="cc498-peek-body"><div class="cc758-peek-summary"></div><div class="cc758-peek-list"></div><div class="cc498-peek-text"></div></div>';document.body.appendChild(root)}
    root.classList.remove('cc500-toast-out');root.querySelector('.cc498-peek-count').textContent=(total>99?'99+':String(total))+' pending';root.querySelector('.cc758-peek-summary').textContent=total+' unread message'+(total===1?'':'s')+' • newest first';
    var list=root.querySelector('.cc758-peek-list');if(list){list.innerHTML='';rows.forEach(function(b){var r=document.createElement('div');r.className='cc758-peek-person';var nm=document.createElement('span');nm.textContent=String(b.sender_name||b.sender_username||'Team member');var ct=document.createElement('strong');ct.textContent=String(Math.max(1,Number(b.count||0)));r.appendChild(nm);r.appendChild(ct);list.appendChild(r)})}
    var body=String(item.body||item.message||item.message_text||item.content||'New message').replace(/\s+/g,' ').trim();root.querySelector('.cc498-peek-text').textContent=String(item.sender_name||item.sender_username||'Team member')+': '+body.slice(0,150);root.setAttribute('data-thread',String(item.thread_key||'team'));root.onclick=function(){cc498OpenChat(root.getAttribute('data-thread')||'team')};
    if(cc500ChatToastTimer)clearTimeout(cc500ChatToastTimer);cc500ChatToastTimer=null;if(!document.hidden){cc500ChatToastTimer=setTimeout(function(){var n=document.getElementById('cc498-chat-peek');if(!n)return;n.classList.add('cc500-toast-out');setTimeout(function(){if(n.parentNode)n.remove();cc498ChatUnread=0},230)},10000);}
  }
  window.__CC780_CHAT_MIRROR__=function(item){window.dispatchEvent(new CustomEvent('career-crox-chat-message',{detail:item}));cc498ShowChatPeek(item);};
  function cc498EnsureGlobalChatStream(){
    var onChat=/^\/chat(?:\/|$)/.test(location.pathname||'');if(onChat){try{window.name='careerCroxTeamChat'}catch(_){} }
    // CC26_760: keep one push stream while the authenticated CRM session exists, even in a background tab.
    // The 10-minute inactivity/session guard remains the owner that closes all streams.
    if((window.__CC621_NIGHT_QUIET__?.()&&window.__CC602_NETWORK_PAUSED__)||(!window.__CC_CHAT_LIVE_PUSH__&&window.__CC_CHAT_MANUAL_ONLY__)||window.__CC602_NETWORK_PAUSED__||cc498IsLogin()||typeof EventSource==='undefined'){cc498CloseChatStream();return}
    if(cc498ChatStream||Date.now()<cc498ChatRetryAt)return;
    try{var es=new EventSource('/api/chat/stream?thread_key=all',{withCredentials:true});cc498ChatStream=es;es.addEventListener('open',function(){cc498ChatRetryAt=0;window.dispatchEvent(new Event('career-crox-chat-ready'));});es.addEventListener('message',function(ev){try{var item=JSON.parse(ev.data||'{}').item;if(!item)return;if(window.__CC780_CHAT_FORWARD__)window.__CC780_CHAT_FORWARD__(item);var thread=String(item.thread_key||'team');window.dispatchEvent(new CustomEvent('career-crox-chat-message',{detail:item}));if(/^\/chat(?:\/|$)/.test(location.pathname||'')&&thread===String(activeChatThread())){mergeCacheMessage(thread,item);}cc498ShowChatPeek(item)}catch(_){}});es.onerror=function(){if(es.readyState===2){cc498ChatStream=null;cc498ChatRetryAt=Date.now()+15000;setTimeout(cc498EnsureGlobalChatStream,15100)}}}catch(_){cc498ChatRetryAt=Date.now()+15000;setTimeout(cc498EnsureGlobalChatStream,15100)}
  }
  function cc498RemoveTlLock(){var old=document.getElementById('cc498-tl-lock');if(old)old.remove()}
  function cc498RenderTlLock(presence){
    // React owns the one lock dialog (including TL self-resume). Never mount
    // the historical manager-only TL overlay on top of that dialog.
    cc498RemoveTlLock();
    if(cc498IsTl()&&presence&&String(presence.locked||'0')==='1')window.dispatchEvent(new Event('career-crox-attendance-refresh'));
  }
  function cc498CheckSelfLock(force){
    if((window.__CC621_NIGHT_QUIET__?.()||window.__CC_CHAT_MANUAL_ONLY__)&&!force)return;
    if(window.__CC602_NETWORK_PAUSED__||!cc498IsTl()||document.hidden||cc498IsLogin()){cc498RemoveTlLock();return}
    var now=Date.now();var active=document.getElementById('cc498-tl-lock');var wait=active?120000:300000;if(!force&&now-cc498SelfLockCheckAt<wait)return;cc498SelfLockCheckAt=now;
    fetch('/api/attendance?compact=1',{credentials:'include',headers:{'X-Career-Crox-Background':'1','Cache-Control':'no-cache'}}).then(function(r){if(!r.ok)throw new Error('attendance');return r.json()}).then(function(d){cc498RenderTlLock(d&&d.presence)}).catch(function(){})
  }

  function cc500TuneAriaReportThread(){
    if(!/^\/chat(?:\/|$)/.test(location.pathname||''))return;var params=new URLSearchParams(location.search||''),thread=params.get('thread')||'team',aria=thread==='aria-reports';
    try{if(!sessionStorage.getItem('cc500AriaSplitDone')){sessionStorage.removeItem('cc_chat_cache:team');sessionStorage.setItem('cc500AriaSplitDone','1')}}catch(_){}
    var composer=document.querySelector('.chatMain .composer');if(aria&&composer){composer.style.display='none'}else if(composer&&composer.style.display==='none'){composer.style.display=''}
    document.querySelectorAll('.chatRow.ariaReportRow,.chatRow.cc489-aria-row').forEach(function(row){row.style.display=(thread==='team')?'none':''});
  }
  function tick(extra){
    if(window.__CC602_NETWORK_PAUSED__)return;
    injectStyle();
    inject489Style();
    routeClasses();
    ensureChatStylesheet();
    canonicalTimer(extra);
    attendance(extra);
    decorateSemiHourlyReport();
    decorateChat();
    bindInstantThreadFeedback();
    observeChatShell();
    ensureInstantChatStream();
    releaseChatBoot();
    cc498InstallStyle();
    cc500TuneAriaReportThread();
    cc498EnsureApprovalStream();
    cc498EnsureGlobalChatStream();
    cc758RenderUnreadUI();
    cc758MarkCurrentThreadRead();
    cc498PositionApprovalPopup();
    cc498CheckSelfLock(false);
    cc497CheckUnlockApproval(false);
  }

  window.addEventListener('career-crox-idle-lock-begin', function(){closeInstantChatStream();cc498CloseChatStream();cc498CloseApprovalStream();});
  window.addEventListener('cc621:night-quiet',function(){if(window.__CC602_NETWORK_PAUSED__){closeInstantChatStream();cc498CloseChatStream();}/* CC26_772: reminders/approvals stay live 24x7 while logged in */});
  window.addEventListener('career-crox-work-session-tick', function(e){ if(!window.__CC602_NETWORK_PAUSED__)tick(e && e.detail || {}); });
  window.addEventListener('popstate', function(){ setTimeout(tick,0); });
  window.addEventListener('cc-route-change', function(){ setTimeout(tick,0); setTimeout(tick,100); });
  window.addEventListener('career-crox-react-ready', function(e){
    tick(e && e.detail || {});
    // A new login must explicitly Join Office; do not silently restore an
    // older day's attendance or add extra network reads from this timer.
  }, { once:true });
  window.addEventListener('resize', function(){ if (document.body.classList.contains('cc469-chat')) requestAnimationFrame(fitChatShell); cc498PositionApprovalPopup(); }, { passive:true });
  document.addEventListener('visibilitychange', function(){
    // CC26_760: backgrounding the tab no longer kills push. This avoids refresh-to-see-message/approval.
    if(!document.hidden){tick();var peek=document.getElementById('cc498-chat-peek');if(peek&&!cc500ChatToastTimer){cc500ChatToastTimer=setTimeout(function(){var n=document.getElementById('cc498-chat-peek');if(!n)return;n.classList.add('cc500-toast-out');setTimeout(function(){if(n.parentNode)n.remove();cc498ChatUnread=0},230)},10000)}}
  });
  window.addEventListener('storage',function(ev){try{if(ev&&ev.key===cc758ChatStateKey())cc758RenderUnreadUI()}catch(_){}});
  window.addEventListener('career-crox-office-joined', function(){ timerRecoveryStatus='restored'; setTimeout(function(){ injectStyle(); canonicalTimer({}); },20); setTimeout(function(){ canonicalTimer({}); },500); });
  var cc603Timer=setInterval(function(){
    // Stop the fallback timer once the proper runtime has claimed ownership.
    if(window.__CC456_SESSION_ATTENDANCE__){clearInterval(cc603Timer);return;}
    if(!window.__CC602_NETWORK_PAUSED__&&!document.hidden && timerIdentity() && timerStateValid())canonicalTimer({});
  },1000);
  window.addEventListener('career-crox-idle-lock-begin',function(){clearInterval(cc603Timer)},{once:true});
  /* CC26_758: Team Chat uses one event-driven SSE stream while the CRM tab is visible. No chat polling loop. */

  if(!window.__CC26_487_HISTORY_HOOK__){
    window.__CC26_487_HISTORY_HOOK__=true;
    ['pushState','replaceState'].forEach(function(k){
      var old=history[k];
      if(typeof old!=='function')return;
      history[k]=function(){
        var r=old.apply(this,arguments);
        try{routeClasses();window.dispatchEvent(new Event('cc-route-change'));}catch(_){}
        return r;
      };
    });
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){tick();},{once:true});
  else tick();
})();

/* CC26_517 — safe pending duplicate-preview bridge for prebuilt SPA. */
(function(){
  'use strict';
  var KEY='careerCroxPendingDuplicateUploadPreview_v517';
  function txt(el){return el?String(el.textContent||'').trim():''}
  function captureFromAdmin(button){
    var panel=button&&button.closest?button.closest('#candidate-duplicate-review'):null;
    if(!panel)return null;
    var rows=[];
    panel.querySelectorAll('tbody tr').forEach(function(tr){
      var cells=tr.querySelectorAll('td');
      if(cells.length<5)return;
      var existingParts=txt(cells[2]).split(/\s+/);
      rows.push({
        row_number:txt(cells[0]),
        uploaded_name:txt(cells[1]).replace(/\s*\d{10}\s*$/,''),
        phone:(txt(cells[1]).match(/\b\d{10}\b/)||[''])[0],
        existing_candidate_id:existingParts[0]||'',
        existing_name:txt(cells[2]).replace(existingParts[0]||'','').trim(),
        existing_filled_fields:txt(cells[3]).split(',').map(function(x){return x.trim()}).filter(Boolean),
        suggested_action:txt(cells[4])
      });
    });
    var summaryText=Array.prototype.map.call(panel.querySelectorAll('.compact-chip-row .mini-chip'),txt).join(' • ');
    return {saved_at:Date.now(),expires_at:Date.now()+30*60*1000,file_name:'Current candidate upload',summary_text:summaryText,analysis:{review_rows:rows}};
  }
  document.addEventListener('click',function(ev){
    var btn=ev.target&&ev.target.closest?ev.target.closest('button'):null;
    if(!btn||txt(btn)!=='Open Duplicate Profiles')return;
    var payload=captureFromAdmin(btn); if(!payload)return;
    try{localStorage.setItem(KEY,JSON.stringify(payload))}catch(_e){}
    ev.preventDefault(); ev.stopPropagation(); if(ev.stopImmediatePropagation)ev.stopImmediatePropagation();
    window.open('/duplicate-profiles?upload_preview=1','_blank');
  },true);
  function readPreview(){
    try{var p=JSON.parse(localStorage.getItem(KEY)||'null');if(!p)return null;if(Number(p.expires_at||0)&&Date.now()>Number(p.expires_at||0)){localStorage.removeItem(KEY);return null}return p}catch(_e){return null}
  }
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(ch){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]})}
  function renderPreview(){
    if(location.pathname!=='/duplicate-profiles'||!new URLSearchParams(location.search).get('upload_preview'))return;
    if(document.querySelector('.upload-preview-panel,.cc517-upload-preview-runtime'))return;
    var p=readPreview(), rows=p&&p.analysis&&Array.isArray(p.analysis.review_rows)?p.analysis.review_rows:[];
    if(!p||!rows.length)return;
    var first=document.querySelector('.table-panel'); if(!first)return;
    var box=document.createElement('div');box.className='table-panel top-gap-small glassy-card fade-up cc517-upload-preview-runtime';
    box.style.cssText='border:1px solid rgba(245,158,11,.30);background:linear-gradient(135deg,#fffaf0,#fff7ed 58%,#f7fbff);box-shadow:0 14px 36px rgba(100,75,20,.08);padding:16px;border-radius:18px;margin-bottom:12px;';
    var body=rows.map(function(r){return '<tr><td>'+esc(r.row_number)+'</td><td><b>'+esc(r.uploaded_name||'-')+'</b><br><small>'+esc(r.phone||'-')+'</small></td><td><b>'+esc(r.existing_candidate_id||'-')+'</b><br><small>'+esc(r.existing_name||'-')+'</small></td><td>'+esc((r.existing_filled_fields||[]).join(', ')||'-')+'</td><td><b style="color:#166534">Existing profile stays safe</b><br><small>'+esc(r.suggested_action||'-')+'</small></td></tr>'}).join('');
    box.innerHTML='<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"><div><div style="font-size:20px;font-weight:900;color:#173b67">Pending Upload Duplicate Preview</div><div style="font-size:13px;font-weight:700;color:#5e718a;margin-top:4px">Preview only — nothing is deleted or overwritten here.</div></div><span style="padding:7px 12px;border-radius:999px;background:#fff0c2;color:#7a4a00;font-weight:900">'+rows.length+' filled matches</span></div><div style="overflow:auto;margin-top:12px"><table class="crm-table colorful-table dense-table" style="min-width:1100px"><thead><tr><th>Upload Row</th><th>Uploaded Candidate</th><th>Existing Candidate</th><th>Existing Filled Fields</th><th>Safe Action</th></tr></thead><tbody>'+body+'</tbody></table></div>';
    first.parentNode.insertBefore(box,first);
  }
  var previewTimer=0;
  function previewRoute(){return location.pathname==='/duplicate-profiles'&&new URLSearchParams(location.search).get('upload_preview')}
  function schedulePreview(delay){if(!previewRoute())return;if(previewTimer)clearTimeout(previewTimer);previewTimer=setTimeout(function(){previewTimer=0;renderPreview()},Math.max(0,Number(delay||0)))}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){schedulePreview(0)},{once:true});else schedulePreview(0);
  try{new MutationObserver(function(records){
    if(!previewRoute())return;
    var useful=records.some(function(r){return Array.prototype.some.call(r.addedNodes||[],function(node){return node&&node.nodeType===1&&((node.matches&&node.matches('.table-panel'))||(node.querySelector&&node.querySelector('.table-panel')))})});
    if(useful)schedulePreview(80);
  }).observe(document.documentElement,{childList:true,subtree:true})}catch(_e){}
  window.addEventListener('popstate',function(){schedulePreview(40)});
  window.addEventListener('cc-route-change',function(){schedulePreview(40)});
})();

/* CC26_521 — instant action UX + candidate typography lock + safe row-wise duplicate review. */
(function(){
  'use strict';
  if(window.__CC521_INSTANT_UI__) return;
  window.__CC521_INSTANT_UI__=true;

  var style=document.createElement('style');
  style.id='cc521-instant-ui-style';
  style.textContent=`
    body:not(.login-body) .candidate-detail-full-panel .candidate-form-grid .field > label,
    body:not(.login-body) .candidate-detail-full-panel .candidate-form-grid .field label,
    body:not(.login-body) .candidate-detail-full-panel .candidate-form-grid .native-select-field > label,
    body:not(.login-body) .candidate-detail-full-panel .candidate-form-grid .field-label-line > label,
    body:not(.login-body) .candidate-detail-full-panel .candidate-form-grid .compact-shell-label,
    body:not(.login-body) .candidate-detail-full-panel .candidate-meta-card label{
      font-size:14px!important;line-height:1.35!important;font-weight:900!important;letter-spacing:0!important;
    }
    body:not(.login-body) .candidate-detail-full-panel .candidate-form-grid input,
    body:not(.login-body) .candidate-detail-full-panel .candidate-form-grid select,
    body:not(.login-body) .candidate-detail-full-panel .candidate-form-grid textarea,
    body:not(.login-body) .candidate-detail-full-panel .candidate-form-grid .inline-input,
    body:not(.login-body) .candidate-detail-full-panel .candidate-form-grid .native-select-field select,
    body:not(.login-body) .candidate-detail-full-panel .candidate-meta-card input,
    body:not(.login-body) .candidate-detail-full-panel .candidate-meta-card select,
    body:not(.login-body) .candidate-detail-full-panel .compact-id-input,
    body:not(.login-body) .candidate-detail-full-panel .choice-chip{
      font-size:15px!important;line-height:1.35!important;font-weight:800!important;
    }
    body:not(.login-body) .candidate-detail-full-panel input,
    body:not(.login-body) .candidate-detail-full-panel select,
    body:not(.login-body) .candidate-detail-full-panel textarea,
    body:not(.login-body) .candidate-detail-full-panel .choice-chip{font-size:15px!important;}
    #candidate-duplicate-review .cc521-rowwise-duplicate{display:grid;gap:10px;margin-top:10px}
    #candidate-duplicate-review .cc521-dup-card{border:1px solid rgba(59,130,246,.18);border-radius:14px;overflow:hidden;background:#fbfdff;box-shadow:0 8px 22px rgba(37,63,122,.05)}
    #candidate-duplicate-review .cc521-dup-row{display:grid;grid-template-columns:150px minmax(0,1fr) 54px;align-items:start;gap:10px;padding:9px 10px}
    #candidate-duplicate-review .cc521-dup-row.cc521-new{min-height:48px;align-items:center;border-bottom:1px dashed rgba(59,130,246,.18);background:#fff}
    #candidate-duplicate-review .cc521-dup-row.cc521-old{background:#f8fbff}
    #candidate-duplicate-review .cc521-dup-details{display:flex;flex-wrap:wrap;gap:7px 14px;align-items:center;color:#25456f;font-size:13px;font-weight:700;line-height:1.35}
    #candidate-duplicate-review .cc521-dup-details strong{color:#173b67;font-weight:900}
    #candidate-duplicate-review .cc521-blank{opacity:.62;font-weight:800}
    @media(max-width:760px){#candidate-duplicate-review .cc521-dup-row{grid-template-columns:1fr}.cc521-dup-lock{display:none}}
  `;
  (document.head||document.documentElement).appendChild(style);

  function txt(el){return String((el&&el.textContent)||'').replace(/\s+/g,' ').trim()}
  function lower(v){return String(v||'').trim().toLowerCase()}
  function escapeHtml(v){return String(v==null?'':v).replace(/[&<>"']/g,function(ch){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]})}

  // Capture duplicate-analysis data without changing the app request or adding any extra API call.
  try{
    var originalFetch=window.fetch;
    if(typeof originalFetch==='function'){
      window.fetch=function(){
        var args=arguments;
        var requestUrl='';
        try{requestUrl=typeof args[0]==='string'?args[0]:(args[0]&&args[0].url)||''}catch(_e){}
        return originalFetch.apply(this,args).then(function(response){
          if(String(requestUrl).indexOf('/api/admin/analyze-candidate-upload')>=0 && response && response.ok){
            try{response.clone().json().then(function(data){window.__CC521_LAST_DUPLICATE_ANALYSIS__=data||null;try{sessionStorage.setItem('cc521_last_duplicate_analysis',JSON.stringify(data||null))}catch(_e){};schedule()}).catch(function(){})}catch(_e){}
          }
          return response;
        });
      };
    }
  }catch(_e){}

  function getDuplicateData(){
    if(window.__CC521_LAST_DUPLICATE_ANALYSIS__) return window.__CC521_LAST_DUPLICATE_ANALYSIS__;
    try{return JSON.parse(sessionStorage.getItem('cc521_last_duplicate_analysis')||'null')}catch(_e){return null}
  }

  function detailPairs(row){
    row=row||{};
    var pairs=[
      ['Serial No',row.source_sr_no||row.sr_no||row.serial_no],
      ['Candidate ID',row.candidate_id||row.existing_candidate_id],
      ['Name',row.existing_name||row.full_name||row.name],
      ['Number',row.phone||row.number],
      ['Qualification',row.qualification||row.qualification_level],
      ['Location',row.location],
      ['Preferred Location',row.preferred_location],
      ['Total Exp',row.total_experience||row.experience],
      ['Relevant Exp',row.relevant_experience],
      ['CTC',row.ctc_monthly],
      ['In-hand',row.in_hand_salary],
      ['Process',row.process],
      ['Communication',row.communication_skill],
      ['Recruiter',row.recruiter_code||row.recruiter_name],
      ['Status',row.status],
      ['Approval',row.approval_status],
      ['Details Sent',row.all_details_sent]
    ];
    var html=pairs.filter(function(p){return String(p[1]==null?'':p[1]).trim()}).map(function(p){return '<span><strong>'+escapeHtml(p[0])+':</strong> '+escapeHtml(p[1])+'</span>'}).join('');
    if(!html && Array.isArray(row.existing_filled_fields) && row.existing_filled_fields.length) html='<span>'+escapeHtml(row.existing_filled_fields.join(' • '))+'</span>';
    return html||'<span>Existing CRM profile found.</span>';
  }

  function renderRowwiseDuplicates(){
    var panel=document.getElementById('candidate-duplicate-review');
    if(!panel || panel.closest('[data-cc804-controls],.cc801-admin-workspace')) return;
    var data=getDuplicateData();
    if(!data) return;
    var old=panel.querySelector('.cc521-rowwise-duplicate');
    if(old) return;
    var groups=Array.isArray(data.duplicate_groups)?data.duplicate_groups:[];
    var review=Array.isArray(data.review_rows)?data.review_rows:[];
    if(!groups.length && !review.length) return;

    var wrap=document.createElement('div');wrap.className='cc521-rowwise-duplicate';
    var cards=[];
    if(groups.length){
      groups.forEach(function(group,gi){
        var uploads=Array.isArray(group.uploaded_rows)?group.uploaded_rows:[];
        var existing=Array.isArray(group.existing_profiles)?group.existing_profiles:[];
        uploads.forEach(function(up,ui){
          var oldRows='';
          if(existing.length){
            existing.forEach(function(ex,ei){oldRows+='<div class="cc521-dup-row cc521-old"><span class="mini-chip sync-chip saved">Old CRM Row</span><div class="cc521-dup-details">'+detailPairs(ex)+'</div><span class="cc521-dup-lock" title="Existing CRM profile is protected">🔒</span></div>'});
          }else{
            oldRows='<div class="cc521-dup-row cc521-old"><span class="mini-chip sync-chip saved">Same Upload Match</span><div class="cc521-dup-details">Duplicate is inside this upload; there is no old CRM row for this set.</div><span class="cc521-dup-lock">—</span></div>';
          }
          cards.push('<div class="cc521-dup-card"><div class="cc521-dup-row cc521-new"><span class="mini-chip">New Upload • Row '+escapeHtml(up.row_number||ui+1)+'</span><span class="cc521-blank">—</span><span></span></div>'+oldRows+'</div>');
        });
      });
    }else{
      review.forEach(function(r,i){
        cards.push('<div class="cc521-dup-card"><div class="cc521-dup-row cc521-new"><span class="mini-chip">New Upload • Row '+escapeHtml(r.row_number||i+1)+'</span><span class="cc521-blank">—</span><span></span></div><div class="cc521-dup-row cc521-old"><span class="mini-chip sync-chip saved">Old CRM Row</span><div class="cc521-dup-details">'+detailPairs(r)+'</div><span class="cc521-dup-lock">🔒</span></div></div>');
      });
    }
    wrap.innerHTML=cards.join('');
    var firstTable=panel.querySelector('.crm-table-wrap');
    if(firstTable && firstTable.parentNode) firstTable.parentNode.insertBefore(wrap,firstTable);
    else panel.appendChild(wrap);
    Array.prototype.forEach.call(panel.querySelectorAll('.crm-table-wrap'),function(el){el.style.display='none'});
  }

  function sanitizeCandidateOptions(){
    var root=document.querySelector('.candidate-detail-full-panel');
    if(!root) return;
    var whitelists={
      profile_priority:{High:1,Medium:1,Low:1},
      documents_availability:{Yes:1,No:1,Partially:1}
    };
    Object.keys(whitelists).forEach(function(key){
      var box=root.querySelector('[data-field="'+key+'"]'); if(!box)return;
      Array.prototype.forEach.call(box.querySelectorAll('.choice-chip'),function(btn){if(!whitelists[key][txt(btn)])btn.style.display='none';else btn.style.display=''});
    });
    var processBox=root.querySelector('[data-field="process"]');
    if(processBox){Array.prototype.forEach.call(processBox.querySelectorAll('.choice-chip'),function(btn){if(lower(txt(btn))==='technical support executive')btn.style.display='none'})}
  }

  // CC829: React/controller acknowledgements own status labels. Never replace
  // Saving/Approving with a fabricated success while a write is still pending.
  function stabilizeBusyLabels(){}

  function stabilizeTransferPanels(){
    var patterns=['checking existing crm profiles before import','checking sheet before crm import','loading rows into crm','importing remaining rows safely','upload in progress','duplicate analysis'];
    Array.prototype.forEach.call(document.querySelectorAll('.helper-text'),function(el){
      var t=lower(txt(el));
      if(!patterns.some(function(p){return t.indexOf(p)>=0}))return;
      el.textContent='Request accepted. You can continue working; CRM finishes the safe server work in the background.';
      var box=el.parentElement;if(!box)return;
      Array.prototype.forEach.call(box.querySelectorAll('span'),function(sp){if(/\d+%$/.test(txt(sp)))sp.textContent='Accepted ✓'});
    });
  }
  // CC26_745 responsiveness: never rescan the whole CRM for every text/timer tick.
  // React changes many text nodes (working timer, counters, status labels). The old
  // characterData observer could continuously schedule full-page DOM scans and make
  // Chromium show "Page unresponsive / Wait or Exit". Only structural changes are
  // relevant here, and bursts are collapsed into one small pass.
  var scheduled=false, cc745MutationTimer=null;
  function run(){scheduled=false;sanitizeCandidateOptions();renderRowwiseDuplicates();stabilizeBusyLabels();stabilizeTransferPanels()}
  function schedule(){if(scheduled)return;scheduled=true;(window.requestAnimationFrame||function(cb){setTimeout(cb,16)})(run)}
  function scheduleFromMutation(){
    if(cc745MutationTimer)return;
    cc745MutationTimer=setTimeout(function(){cc745MutationTimer=null;schedule();},120);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
  try{new MutationObserver(function(records){
    var useful=records.some(function(r){return r.type==='childList'&&(r.addedNodes.length||r.removedNodes.length);});
    if(useful)scheduleFromMutation();
  }).observe(document.documentElement,{subtree:true,childList:true})}catch(_e){}
  window.addEventListener('popstate',schedule);
  window.addEventListener('cc-route-change',schedule);
})();

;(()=>{
'use strict';


  /* CC26_765 — client-facing copy + instant interaction polish. No API calls. */
  function cc765ClientCopyPolish(root){
    var scope=root||document;
    var replacements={
      'Premium Break Timer':'Break Timer',
      'Premium glass theme saved for this user.':'Theme preference saved for this user.',
      'ACTION REQUIRED ✦':'ACTION REQUIRED',
      'QUICK JUMP ✦':'QUICK NAVIGATION',
      '📌 FollowUp Reminder':'Follow-up Reminder',
      'Just You Two 😎':'Direct Conversation',
      'Squad Hangout 🔥':'Team Conversation',
      'Today • what’s the scene? 👀':'Today • Team Updates',
      '⚠ Employee cut':'Employee Access Restricted',
      'Performance Pulse':'Performance Summary',
      'Daily Flow':'Daily Workflow',
      'Showing instant profile. Notes are loading with main profile; files stay lazy.':'Profile opened from a local snapshot. Notes sync in the background; files open on demand.',
      'Saving task. Please wait...':'Task save started. You can continue working.'
    };
    try{
      var walker=document.createTreeWalker(scope,NodeFilter.SHOW_TEXT);
      var node;
      while((node=walker.nextNode())){
        if(!node.parentElement||/^(SCRIPT|STYLE|TEXTAREA|OPTION)$/i.test(node.parentElement.tagName))continue;
        var raw=String(node.nodeValue||'');var clean=raw;
        Object.keys(replacements).forEach(function(key){if(clean.indexOf(key)!==-1)clean=clean.split(key).join(replacements[key])});
        if(clean!==raw)node.nodeValue=clean;
      }
    }catch(_e){}
  }
  function cc765InstantClickFeedback(event){
    var el=event&&event.target&&event.target.closest?event.target.closest('a[href],button,.nav-item,.sidebar-item,.top-pill,.threadBtn,.personBtn,[role="button"]'):null;
    if(!el||el.disabled)return;
    if(el.closest('.crm-modal-backdrop')&&/close|cancel/i.test(String(el.textContent||'')))return;
    el.classList.add('cc765-instant-tap');
    requestAnimationFrame(function(){requestAnimationFrame(function(){el.classList.remove('cc765-instant-tap')})});
  }
  document.addEventListener('pointerdown',cc765InstantClickFeedback,{capture:true,passive:true});
  var cc765CopyTimer=0,cc765CopyQueue=[];
  function cc765ScheduleCopy(root){if(root)cc765CopyQueue.push(root);if(cc765CopyTimer)return;cc765CopyTimer=requestAnimationFrame(function(){cc765CopyTimer=0;var rows=cc765CopyQueue.splice(0,cc765CopyQueue.length);rows.forEach(function(node){if(node&&node.nodeType===1)cc765ClientCopyPolish(node)})})}
  var cc765CopyObserver=new MutationObserver(function(records){
    records.forEach(function(r){Array.prototype.forEach.call(r.addedNodes||[],function(node){if(node&&node.nodeType===1)cc765ScheduleCopy(node)})});
  });
  function cc765CopyStart(){cc765ClientCopyPolish(document.body);cc765CopyObserver.observe(document.body,{childList:true,subtree:true})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',cc765CopyStart,{once:true});else cc765CopyStart();

})();


;(function(){
  'use strict';
  var BUILD='CC26_727_VERIFIED_JOIN_GATE';
  var JOIN_KEY='careerCroxOfficeJoinedSession';
  var DAILY_JOIN_BACKUP='cc729_daily_office_join_backup', DAILY_TIMER_BACKUP='cc729_daily_timer_backup', PRESERVE_FLAG='cc729_restore_after_inactivity';
  var originalFetch=window.fetch.bind(window);
  var scheduled=false, joinBusy=false, joinRequest=null, attendanceGetInFlight=null, lastPath='', joinConfirmedAt=0, gateTimer=null;
  function path(){return String(location.pathname||'');}
  function loginMarker(){try{return String(localStorage.getItem('careerCroxSessionLoginAt')||'').trim();}catch(_){return '';}}
  function cachedUser(){try{return JSON.parse(localStorage.getItem('careerCroxCachedUser')||'null')||{};}catch(_){return {};}}
  function identity(){var u=cachedUser();return String(u.user_id||u.recruiter_code||u.username||'').trim();}
  // Fixed-offset IST day key (Asia/Kolkata has no DST). Never rely on browser timezone.
  function istDay(value){var t=value==null?Date.now():new Date(value).getTime();return Number.isFinite(t)?new Date(t+19800000).toISOString().slice(0,10):'';}
  function joinedState(){try{return JSON.parse(localStorage.getItem(JOIN_KEY)||'null');}catch(_){return null;}}
  function joined(){var x=joinedState();return !!(x&&identity()&&x.identity===identity()&&x.joined_at&&x.manual_confirmed_at&&Number.isFinite(new Date(x.joined_at).getTime())&&istDay(x.joined_at)===istDay()&&istDay(x.manual_confirmed_at)===istDay());}
  function rememberJoin(at,response,explicitClick){
    var stamp=String(at||'').trim(),stats=response&&response.today_stats||{};
    var confirmedAt=String(stats.manual_confirmed_at||'').trim();
    if(stats.manual_join_confirmed!=='1'||!confirmedAt||istDay(confirmedAt)!==istDay()||
      !Number.isFinite(new Date(confirmedAt).getTime())||!stamp||!Number.isFinite(new Date(stamp).getTime())||istDay(stamp)!==istDay()||!identity())return false;
    try{var prev=joinedState(),start=stamp; // Server-confirmed first join time is authoritative.
      var restored=!!(prev&&prev.identity===identity()&&prev.joined_at&&istDay(prev.joined_at)===istDay()&&new Date(prev.joined_at).getTime()===new Date(start).getTime());
      var savedJoin={identity:identity(),login_marker:loginMarker(),joined_at:start,manual_confirmed_at:confirmedAt,day_key:istDay(start),join_version:729};
      localStorage.setItem(JOIN_KEY,JSON.stringify(savedJoin));localStorage.setItem(DAILY_JOIN_BACKUP,JSON.stringify(savedJoin));
      joinConfirmedAt=Date.now();
      window.__CC787_ATTENDANCE_BASE__={identity:identity(),presence:response?.presence||{},at:Date.now()};
      var detail=Object.assign({},response||{},{restored:restored,explicit_join:!!explicitClick&&!restored});
      window.dispatchEvent(new CustomEvent('career-crox-office-joined',{detail:detail}));return true;
    }catch(_){return false;}
  }
  window.__CC723_OFFICE_JOINED__=joined;
  window.__CC722_OFFICE_JOINED__=joined;
  window.__CC721_OFFICE_JOINED__=joined; // compatibility with existing bundles
  window.__CC718_OFFICE_JOINED__=joined;
  window.__CC722_JOIN_PENDING__=function(){return !!joinBusy||!!window.__CC722_JOIN_REQUEST_PENDING__;};
  window.__CC723_OFFICE_RESTORE__=function(response,explicitClick){
    var st=response&&response.today_stats||{},p=response&&response.presence||{};
    // A status flag without a genuine same-day timestamp NEVER closes the gate.
    if(st.joined_today!==true||st.manual_join_confirmed!=='1')return false;
    var stamp=String(st.joined_at||p.work_started_at||'').trim();
    if(!stamp||!Number.isFinite(new Date(stamp).getTime())||istDay(stamp)!==istDay())return false;
    return rememberJoin(stamp,response,explicitClick)===true&&joined();
  };
  window.__CC722_OFFICE_RESTORE__=window.__CC723_OFFICE_RESTORE__;
  window.__CC721_OFFICE_RESTORE__=window.__CC723_OFFICE_RESTORE__;
  function forgetJoin(){try{var x=joinedState();if(x&&x.identity===identity())localStorage.removeItem(JOIN_KEY);}catch(_){}}
  window.__CC722_OFFICE_SERVER_UNJOINED__=function(){
    // An older GET must not undo a just-confirmed JOIN.
    if(joinBusy||window.__CC722_JOIN_REQUEST_PENDING__||Date.now()-joinConfirmedAt<30000)return false;
    forgetJoin();restoreNativeGate();ensureGate();
    window.dispatchEvent(new Event('career-crox-office-not-joined'));
    return true;
  };
  function clearStale(){var x=joinedState(),i=identity();if(x&&(!i||x.identity!==i||!x.joined_at||!x.manual_confirmed_at||istDay(x.joined_at)!==istDay()||istDay(x.manual_confirmed_at)!==istDay())){try{localStorage.removeItem(JOIN_KEY);}catch(_){}}}
  function restoreDailyOfficeAfterInactivity(){
    try{
      if(localStorage.getItem(PRESERVE_FLAG)!=='1')return false;
      var id=identity(),mk=loginMarker(),b=JSON.parse(localStorage.getItem(DAILY_JOIN_BACKUP)||'null');
      if(!id||!mk||!b||String(b.identity||'')!==id||!b.joined_at||!b.manual_confirmed_at||istDay(b.joined_at)!==istDay()||istDay(b.manual_confirmed_at)!==istDay())return false;
      var restored=Object.assign({},b,{login_marker:mk,join_version:729});
      localStorage.setItem(JOIN_KEY,JSON.stringify(restored));
      var tb=JSON.parse(localStorage.getItem(DAILY_TIMER_BACKUP)||'null');
      if(tb&&String(tb.identity||'')===id){tb.login_marker=mk;tb._last_write_at=0;localStorage.setItem('cc456_session_activity_state',JSON.stringify(tb));}
      localStorage.removeItem('cc434_work_activity_at');
      localStorage.removeItem(PRESERVE_FLAG);
      return true;
    }catch(_){return false;}
  }
  // The login marker is browser-local and can be absent after a cache reset.
  // Real authentication is checked by the API cookie, not this volatile marker.
  function authenticated(){return !!identity()&&path()!=='/login';}
  function esc(s){return String(s||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

  // CC26_482: the native React Join Office modal is the one the user selected.
  // Never cover it with a second compatibility gate.
  function suppressOldJoin(){document.querySelectorAll('[data-cc451-old-join]').forEach(function(b){b.removeAttribute('data-cc451-old-join');b.style.display='';});}
  function hideInterruptions(){document.querySelectorAll('.cc391-reminder-deck,.global-submission-reminder-wrap,.cc-global-source-wrap,.task-reminder-popup,.revenue-reminder-popup,.approval-popup-panel').forEach(function(el){if(!el.dataset.cc726JoinHidden){el.dataset.cc726JoinHidden='1';el.dataset.cc726PrevDisplay=el.style.display||'';}el.style.setProperty('display','none','important');});}
  function restoreInterruptions(){document.querySelectorAll('[data-cc726-join-hidden="1"]').forEach(function(el){var prev=el.dataset.cc726PrevDisplay||'';el.style.removeProperty('display');if(prev)el.style.display=prev;delete el.dataset.cc726JoinHidden;delete el.dataset.cc726PrevDisplay;});}
  function removeGate(){var g=document.getElementById('cc451-office-gate');if(g)g.remove();document.body.classList.remove('cc451-await-join');restoreInterruptions();}
  function nativeJoinBackdrop(){var m=document.querySelector('.crm-modal-backdrop:not(#cc451-office-gate) .join-office-modal');return m&&m.closest('.crm-modal-backdrop');}
  function hideNativeGateNow(){if(window.__CC828_REACT_OFFICE_OWNER__)return;var b=nativeJoinBackdrop();if(b)b.style.display='none';}
  function restoreNativeGate(){if(window.__CC828_REACT_OFFICE_OWNER__){var b=nativeJoinBackdrop();if(b)b.style.removeProperty('display');return;}hideNativeGateNow();} // Only the single DOM gate owns the join action.
  function refreshAttendanceAfterJoin(){
    setTimeout(function(){
      if(path()==='/attendance'){
        var buttons=[].slice.call(document.querySelectorAll('button'));
        var b=buttons.find(function(x){return /update details|refresh/i.test(String(x.textContent||''));});
        if(b&&!b.disabled)try{b.click();}catch(_){}
      }
    },250);
  }
  async function restoreJoinFromResponse(response,explicitClick){
    if(window.__CC723_OFFICE_RESTORE__(response,explicitClick))return true;
    var todayStats=response&&response.today_stats||{},presence=response&&response.presence||{};
    var receipt=String(todayStats.joined_at||presence.work_started_at||'').trim();
    var receiptConfirmed=String(todayStats.manual_confirmed_at||receipt).trim();
    // Backward-compatible receipt: an OLD deployed backend may not yet return the
    // manual confirmation fields. Accept that response ONLY after this trusted
    // button click, never from a background refresh. The same-day server timestamp
    // is still mandatory, so an unjoined/legacy stale session cannot auto-start.
    var explicitlyVerified=!!(response&&((response.attendance_verified===true)||String(response.office_join_receipt||'').toLowerCase()==='confirmed'));
    var legacyExplicitReceipt=!!(explicitClick&&todayStats.joined_today===true&&receipt&&istDay(receipt)===istDay());
    if((explicitlyVerified||legacyExplicitReceipt)&&receipt&&istDay(receipt)===istDay()){
      var synthetic={presence:Object.assign({},presence,{work_started_at:String(presence.work_started_at||receipt)}),today_stats:Object.assign({},todayStats,{joined_today:true,joined_at:receipt,manual_join_confirmed:'1',manual_confirmed_at:receiptConfirmed||receipt})};
      if(window.__CC723_OFFICE_RESTORE__(synthetic,explicitClick))return true;
    }
    try{
      var check=await originalFetch('/api/attendance?compact=1',{credentials:'include',cache:'no-store',headers:{'Accept':'application/json'}});
      if(check.ok){
        var snap=await check.json();
        if(window.__CC723_OFFICE_RESTORE__(snap,explicitClick))return true;
      }
    }catch(_){}
    return false;
  }

  function doJoin(){
    if(joinBusy||joined())return joinRequest;
    if(!authenticated())return Promise.reject(new Error('Please sign in to join your office.'));
    if(window.__CC602_NETWORK_PAUSED__)return Promise.reject(new Error('Your session expired. Sign in again to join.'));
    joinBusy=true;
    var controller=typeof AbortController!=="undefined"?new AbortController():null;
    var timer=controller?setTimeout(function(){try{controller.abort();}catch(_){}},24000):null;
    joinRequest=originalFetch('/api/attendance/join',{
      method:'POST',credentials:'include',cache:'no-store',headers:{'Content-Type':'application/json','Accept':'application/json','X-Career-Crox-Last-Activity-At':String(Date.now())},
      body:JSON.stringify({last_page:path()||'/candidates',compact:true,session_login_at:loginMarker(),manual_confirmed:true,join_source:'user_button'}),signal:controller?controller.signal:undefined
    }).then(function(r){
      return r.clone().json().catch(function(){return {};}).then(async function(d){
        if(!r.ok||!(d&&d.today_stats&&d.today_stats.joined_today)){
          var reason=String(d&&d.message||'Office could not be joined right now. Please try again.').trim();
          if(r.status===401)reason='Your login has expired. Please sign in again.';
          else if(r.status===423)reason='Your CRM is locked. Manager approval is required before joining.';
          throw new Error(reason);
        }
        if(!await restoreJoinFromResponse(d,true))throw new Error('Join Office could not be confirmed. Please try again.');
        hideNativeGateNow();removeGate();
        refreshAttendanceAfterJoin();return r;
      });
    }).catch(async function(err){
      // A timed-out POST may have COMMITTED on the server. Reconcile ONCE
      // before allowing another click, without any automatic JOIN request.
      if(err&&(err.name==='AbortError'||err instanceof TypeError)){
        try{
          var check=await originalFetch('/api/attendance?compact=1',{credentials:'include',cache:'no-store',headers:{'Accept':'application/json'}});
          if(check.ok){var snap=await check.json();if(window.__CC723_OFFICE_RESTORE__(snap,true)){
            hideNativeGateNow();removeGate();refreshAttendanceAfterJoin();return check;
          }}
        }catch(_){}
      }
      if(!joined())forgetJoin();restoreNativeGate();ensureGate();
      var msg=document.querySelector('#cc451-office-gate .cc451-join-msg');
      if(msg){msg.dataset.state='error';msg.textContent=err&&err.name==='AbortError'?
        'The connection timed out. Your Join Office confirmation was not completed. Please try again.':
        String(err&&err.message||'Join Office could not be completed. Please try again.');}
      throw err;
    }).finally(function(){if(timer)clearTimeout(timer);joinBusy=false;joinRequest=null;});
    // Explicit person-initiated attempt. Never join in a background process.
    joinRequest.catch(function(){});
    return joinRequest;
  }
  function ensureGate(){
    if(window.__CC828_REACT_OFFICE_OWNER__){removeGate();restoreNativeGate();return;}
    restoreDailyOfficeAfterInactivity();clearStale();suppressOldJoin();
    var state=window.__CC787_ATTENDANCE_BASE__,known=state&&state.identity===identity();
    // Wait for the existing compact login read; a paused CRM uses Request for Access.
    if((known&&String(state.presence&&state.presence.locked||'0')==='1')||document.querySelector('.premium-crm-lock-request-modal')||(authenticated()&&!joined()&&!known)){
      removeGate();hideNativeGateNow();return;
    }
    if(!authenticated()||joined()){
      removeGate();if(joined())hideNativeGateNow();return;
    }
    document.body.classList.add('cc451-await-join');hideInterruptions();
    var native=nativeJoinBackdrop();
    // The old React panel can have a silent error handler. Hide it and
    // show exactly one accessible native-DOM button with visible feedback.
    if(native)hideNativeGateNow();
    // React can momentarily render no gate or a stale state can remove it.
    // A local DOM-only safety gate ensures an unjoined user can ALWAYS click.
    if(!document.querySelector('#root .app-shell'))return;
    if(document.getElementById('cc451-office-gate'))return;
    var overlay=document.createElement('div');overlay.id='cc451-office-gate';
    overlay.className='crm-modal-backdrop cc724-office-overlay';
    overlay.style.zIndex='100005';
    overlay.innerHTML='<section class="crm-premium-modal join-office-modal cc724-office-panel" role="dialog" aria-modal="true" aria-labelledby="cc724-join-title" aria-describedby="cc724-join-description">'
      +'<div class="cc724-office-brand"><span class="cc724-office-mark"><img src="/assets/img/career-crox-brand-icon.png" alt=""></span><span><strong class="cc724-brand-title">CAREER CROX</strong><small class="cc724-brand-sub">Employee workspace</small></span></div>'
      +'<span class="cc724-join-kicker">Daily attendance</span>'
      +'<h1 id="cc724-join-title" class="cc724-office-title">Join <span>Office</span></h1>'
      +'<p id="cc724-join-description" class="cc724-office-description">Begin your shift with one click. Your attendance and work time will be recorded from the moment you join.</p>'
      +'<div class="cc724-office-detail"><span class="cc724-office-detail-icon" aria-hidden="true">&#10003;</span><span>Refresh will not restart your confirmed office session.</span></div>'
      +'<button class="cc724-join-button" type="button">Join Office <span class="cc724-office-arrow" aria-hidden="true">&#8594;</span></button>'
      +'<p class="cc451-join-msg" role="status" aria-live="polite"></p></section>';
    overlay.querySelector('button').addEventListener('click',function(event){
      // No programmatic clicking and no automatic attempt: only a person joins.
      if(!event||!event.isTrusted)return;
      var button=this;if(joinBusy||joined())return;
      button.disabled=true;button.textContent='Joining Office…';
      var msg=overlay.querySelector('.cc451-join-msg');
      if(msg){msg.dataset.state='working';msg.textContent='Confirming your office session…';}
      Promise.resolve(doJoin()).catch(function(err){
        if(msg&&msg.isConnected){msg.dataset.state='error';msg.textContent=String(err&&err.message||'Unable to join. Please retry.');}
      }).finally(function(){
        if(button.isConnected){button.disabled=false;button.innerHTML='Join Office <span class="cc724-office-arrow" aria-hidden="true">&#8594;</span>';}
        if(msg&&msg.isConnected&&msg.dataset.state==='working'){msg.dataset.state='error';msg.textContent='Join Office was not confirmed. Please try again.';}
      });
    });
    document.body.appendChild(overlay);hideInterruptions();
  }

  // Only confirm joining after the server acknowledges it. A failed response must never start the timer.
  window.fetch=function(input,init){
    var url=typeof input==='string'?input:(input&&input.url)||'';
    var method=String((init&&init.method)||'GET').toUpperCase();
    if(/\/api\/attendance\/join(?:\?|$)/.test(url)&&method==='POST'&&typeof input==='string'){
      if(joinBusy&&joinRequest)return joinRequest.then(function(r){return r.clone()});
      window.__CC722_JOIN_REQUEST_PENDING__=true;
      var next=Object.assign({},init||{});
      try{var body=next.body?JSON.parse(next.body):{};
        body.session_login_at=body.session_login_at||loginMarker();body.last_page=body.last_page||path()||'/candidates';body.compact=true;
        // NEVER inject manual_confirmed into a legacy/background request.
        // Server rejects implicit calls even if an old script is still cached.
        next.body=JSON.stringify(body);
      }catch(_){}
      return originalFetch(input,next).then(function(r){
        return r.clone().json().catch(function(){return {}}).then(function(d){
          if(r.ok&&window.__CC722_OFFICE_RESTORE__(d,true)){
            hideNativeGateNow();removeGate();refreshAttendanceAfterJoin();
          }else{if(!joined())forgetJoin();restoreNativeGate();ensureGate();}
          return r;
        });
      }).catch(function(err){if(!joined())forgetJoin();restoreNativeGate();ensureGate();throw err;})
        .finally(function(){window.__CC722_JOIN_REQUEST_PENDING__=false;});
    }
    if(method==='GET'&&/\/api\/attendance\?compact=1(?:&|$)/.test(url)){
      if(attendanceGetInFlight)return attendanceGetInFlight.then(function(r){return r.clone()});
      var pending=originalFetch(input,init);
      attendanceGetInFlight=pending;
      pending.finally(function(){if(attendanceGetInFlight===pending)attendanceGetInFlight=null;}).catch(function(){});
      return pending.then(function(r){return r.clone()});
    }
    return originalFetch(input,init);
  };
  function normalizeWhitespace(v){return String(v||'').replace(/\r/g,'\n').replace(/\u00a0/g,' ').replace(/[ ]{2,}/g,' ').replace(/\n{3,}/g,'\n\n').trim();}
  function titleCase(v){return String(v||'').toLowerCase().split(/\s+/).filter(Boolean).map(function(x){return x.charAt(0).toUpperCase()+x.slice(1);}).join(' ');}
  function latin1(buf){var a=new Uint8Array(buf),s='',chunk=8192;for(var i=0;i<a.length;i+=chunk){var p=a.subarray(i,Math.min(a.length,i+chunk));s+=String.fromCharCode.apply(null,p);}return s;}
  function readable(s){return Array.from(new Set(String(s||'').match(/[A-Za-z0-9@._%+\-/:,() ]{5,}/g)||[])).join('\n');}
  function pdfText(buf){var bin=latin1(buf);var lit=[];try{Array.from(bin.matchAll(/\(([^()]|\\\(|\\\))*\)/g)).forEach(function(m){lit.push(m[0].slice(1,-1).replace(/\\n|\\r|\\t/g,' ').replace(/\\\(/g,'(').replace(/\\\)/g,')').replace(/\\\\/g,'\\'));});}catch(_){}return normalizeWhitespace(lit.join('\n')+'\n'+readable(bin));}
  function rtfText(t){return normalizeWhitespace(String(t||'').replace(/\\par[d]?\b/g,'\n').replace(/\\tab\b/g,' ').replace(/\\'[0-9a-fA-F]{2}/g,' ').replace(/\\[a-zA-Z]+-?\d* ?/g,' ').replace(/[{}]/g,' '));}
  async function inflate(bytes,method){if(method===0)return bytes;if(method!==8||typeof DecompressionStream==='undefined')return new Uint8Array();try{return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());}catch(_){return new Uint8Array();}}
  async function zipXml(buf,wanted){var bytes=new Uint8Array(buf),view=new DataView(buf),dec=new TextDecoder('utf-8'),out=[],want=new Set(wanted),o=0;while(o+46<=bytes.length){if(view.getUint32(o,true)!==0x02014b50){o++;continue;}var method=view.getUint16(o+10,true),size=view.getUint32(o+20,true),nl=view.getUint16(o+28,true),el=view.getUint16(o+30,true),cl=view.getUint16(o+32,true),lo=view.getUint32(o+42,true),ns=o+46,ne=ns+nl;if(ne>bytes.length)break;var name=dec.decode(bytes.slice(ns,ne)).replace(/\\/g,'/').toLowerCase();if(want.has(name)&&lo+30<=bytes.length&&view.getUint32(lo,true)===0x04034b50){var lnl=view.getUint16(lo+26,true),lel=view.getUint16(lo+28,true),ds=lo+30+lnl+lel,de=ds+size;if(de<=bytes.length){var inf=await inflate(bytes.slice(ds,de),method);if(inf.length)out.push(dec.decode(inf));}}o=ne+el+cl;}return out.join('\n');}
  function xmlText(x){return normalizeWhitespace(String(x||'').replace(/<w:tab\b[^>]*\/>/gi,' ').replace(/<w:br\b[^>]*\/>/gi,'\n').replace(/<\/w:p>/gi,'\n').replace(/<text:tab\b[^>]*\/>/gi,' ').replace(/<text:line-break\b[^>]*\/>/gi,'\n').replace(/<\/text:p>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'"));}
    async function readResume(file){var n=String(file.name||'').toLowerCase(),t=String(file.type||'').toLowerCase();if(t.indexOf('text/')===0||/\.(txt|csv|tsv|html|htm|json|md|eml|xml|yaml|yml|log|rtf)$/i.test(n)){var tx=await file.text();return /\.rtf$/i.test(n)||t.indexOf('rtf')>=0?rtfText(tx):normalizeWhitespace(tx);}var buf=await file.arrayBuffer();if(/\.(docx|docm|dotx|dotm)$/i.test(n)||t.indexOf('officedocument.wordprocessingml')>=0){var x=await zipXml(buf,new Set(['word/document.xml','word/header1.xml','word/footer1.xml']));if(x)return xmlText(x);}if(/\.odt$/i.test(n)){var o=await zipXml(buf,new Set(['content.xml']));if(o)return xmlText(o);}if(t.indexOf('pdf')>=0||/\.pdf$/i.test(n))return pdfText(buf);return normalizeWhitespace(readable(latin1(buf)));}
  function fileToBase64(file){return new Promise(function(resolve,reject){try{var reader=new FileReader();reader.onload=function(){var out=String(reader.result||'').replace(/^data:[^;]+;base64,/,'');resolve(out)};reader.onerror=function(){reject(new Error('Could not read selected file.'))};reader.readAsDataURL(file);}catch(err){reject(err);}});}
  async function parseResumeServer(file){var payload={name:String(file&&file.name||'resume'),mime_type:String(file&&file.type||''),content_base64:await fileToBase64(file)};var response=await originalFetch('/api/candidates/resume-autofill',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload)});var data=await response.json().catch(function(){return {};});if(!response.ok||!data||data.ok===false)throw new Error(data&&data.message||'Could not parse resume right now.');return data;}
  function loadResumeScript(id,src){return new Promise(function(resolve,reject){var old=document.getElementById(id);if(old){if(old.dataset.ready==='1'||(id==='cc668-tesseract'&&window.Tesseract)||(id==='cc668-pdfjs'&&window.pdfjsLib))return resolve();old.addEventListener('load',resolve,{once:true});old.addEventListener('error',reject,{once:true});return;}var s=document.createElement('script');s.id=id;s.src=src;s.async=true;s.onload=function(){s.dataset.ready='1';resolve()};s.onerror=function(){reject(new Error('Resume OCR engine could not load.'))};document.head.appendChild(s);});}
  async function ensureTesseract(){if(window.Tesseract)return window.Tesseract;await loadResumeScript('cc668-tesseract','https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');if(!window.Tesseract)throw new Error('OCR engine unavailable.');return window.Tesseract;}
  async function ensurePdfJs(){if(window.pdfjsLib)return window.pdfjsLib;await loadResumeScript('cc668-pdfjs','https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js');if(!window.pdfjsLib)throw new Error('PDF reader unavailable.');window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';return window.pdfjsLib;}
  async function browserPdfText(file){try{var pdfjs=await ensurePdfJs(),buf=await file.arrayBuffer(),doc=await pdfjs.getDocument({data:new Uint8Array(buf)}).promise,pages=[],count=Math.min(Number(doc.numPages||1),6);for(var p=1;p<=count;p++){var page=await doc.getPage(p),content=await page.getTextContent(),items=content&&content.items||[],lines=[],line='',lastY=null;for(var i=0;i<items.length;i++){var it=items[i]||{},s=String(it.str||'').trim();if(!s)continue;var y=it.transform&&Number(it.transform[5]);var breakLine=lastY!==null&&Number.isFinite(y)&&Math.abs(y-lastY)>3.5;if(breakLine&&line){lines.push(line);line='';}line+=(line?' ':'')+s;if(it.hasEOL&&line){lines.push(line);line='';}if(Number.isFinite(y))lastY=y;}if(line)lines.push(line);pages.push(lines.join('\n'));}return normalizeWhitespace(pages.join('\n\n'));}catch(_){return '';}}
  async function enhancedImageCanvas(file){var bmp=await createImageBitmap(file);var maxW=2600,target=Math.min(maxW,Math.max(1500,bmp.width*2)),scale=target/bmp.width;var c=document.createElement('canvas');c.width=Math.round(bmp.width*scale);c.height=Math.round(bmp.height*scale);var x=c.getContext('2d',{willReadFrequently:true});x.drawImage(bmp,0,0,c.width,c.height);var im=x.getImageData(0,0,c.width,c.height),d=im.data;for(var i=0;i<d.length;i+=4){var g=Math.round(.299*d[i]+.587*d[i+1]+.114*d[i+2]);g=Math.max(0,Math.min(255,(g-128)*1.45+128));d[i]=d[i+1]=d[i+2]=g;}x.putImageData(im,0,0);try{bmp.close()}catch(_){}return c;}
  async function pdfCanvases(file){var pdfjs=await ensurePdfJs(),buf=await file.arrayBuffer(),doc=await pdfjs.getDocument({data:new Uint8Array(buf)}).promise,out=[],count=Math.min(Number(doc.numPages||1),3);for(var i=1;i<=count;i++){var page=await doc.getPage(i),vp=page.getViewport({scale:2.25}),c=document.createElement('canvas');c.width=Math.ceil(vp.width);c.height=Math.ceil(vp.height);await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;out.push(c);}return out;}
  function cropCanvasTop(source,ratio){try{ratio=Number(ratio||.42);var h=Math.max(1,Math.round(source.height*ratio)),c=document.createElement('canvas');c.width=source.width;c.height=h;c.getContext('2d').drawImage(source,0,0,source.width,h,0,0,c.width,c.height);return c;}catch(_){return null;}}
  async function browserOcrFile(file,status){var type=String(file.type||'').toLowerCase(),name=String(file.name||'').toLowerCase(),isImg=/^image\//.test(type)||/\.(png|jpe?g|webp|bmp|tiff?)$/.test(name),isPdf=type.indexOf('pdf')>=0||/\.pdf$/.test(name);if(!isImg&&!isPdf)return '';try{var T=await ensureTesseract(),sources=[];if(isImg){try{var enhanced=await enhancedImageCanvas(file),top=cropCanvasTop(enhanced,.46);if(top)sources.push({src:top,psm:'6'});sources.push({src:enhanced,psm:'6'});sources.push({src:file,psm:'11'});}catch(_){sources.push({src:file,psm:'6'});}}else{var canvases=await pdfCanvases(file);if(canvases[0]){var topPdf=cropCanvasTop(canvases[0],.46);if(topPdf)sources.push({src:topPdf,psm:'6'});}canvases.forEach(function(c){sources.push({src:c,psm:'6'});});}var worker=await T.createWorker('eng');try{var texts=[];for(var i=0;i<sources.length;i++){try{await worker.setParameters({preserve_interword_spaces:'1',tessedit_pageseg_mode:sources[i].psm||'6'});}catch(_){}var r=await worker.recognize(sources[i].src);var tx=normalizeWhitespace(r&&r.data&&r.data.text||'');if(tx)texts.push(tx);}return normalizeWhitespace(texts.join('\n\n'));}finally{try{await worker.terminate()}catch(_){}}}catch(_){return '';}}
  function safeAutoLocation(value){var x=String(value||'').replace(/[\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').trim();x=x.replace(/^(?:current\s+|present\s+|permanent\s+|residential\s+)?(?:location|city|address|residence|based\s+in)\s*[:\-–]?\s*/i,'').trim();x=x.replace(/\b(?:mobile|phone|email)\s*[:\-–].*$/i,'').trim();x=x.replace(/\s*[,;|]\s*/g,', ').replace(/(?:,\s*){2,}/g,', ').replace(/^[,\-–\s]+|[,\-–\s]+$/g,'').trim();if(x.length<2||x.length>140||!/[A-Za-z]/.test(x))return '';if(/(?:is not defined|referenceerror|typeerror|syntaxerror|undefined|ocr engine|pdf reader|could not|failed|error)/i.test(x))return '';if(/^(?:india|address|location|city|resume|cv)$/i.test(x))return '';return x;}
  function fileNameHumanName(file){var x=String(file||'').replace(/\.[^.]+$/,'').replace(/[_-]+/g,' ').replace(/\b(resume|cv|updated|latest|final|copy|profile|candidate|document|scan|image|img|pdf|docx?|career|crox|careercrox)\b/gi,' ').replace(/\d+/g,' ').replace(/\s+/g,' ').trim();return safeAutoName(x);}
  function phone(t){var m=String(t||'').match(/(?:\+?91[\s-]*)?[6-9](?:[\s-]*\d){9}/g)||[];for(var i=0;i<m.length;i++){var d=m[i].replace(/\D/g,'');if(d.length>10)d=d.slice(-10);if(d.length===10)return d;}return '';}
  function nameFrom(t,file){var raw=normalizeWhitespace(t),fileName=fileNameHumanName(file),email=(raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)||[])[0]||'',emailName=email?String(email.split('@')[0]).replace(/[0-9._-]+/g,' '):'',c=[];function push(v,s){v=safeAutoName(v);if(v)c.push({v:v,s:s});}var m=raw.match(/(?:^|\n)\s*(?:candidate\s+)?(?:full\s+)?name\s*[:\-–]\s*([^\n]{2,90})/im)||raw.match(/(?:^|\n)\s*(?:candidate\s+)?(?:full\s+)?name\s*\n\s*([^\n]{2,90})/im);if(m&&m[1])push(m[1],190);var lines=raw.split(/\n+/).map(function(x){return x.trim()}).filter(Boolean).slice(0,55);lines.forEach(function(line,i){if(/\b(address|location|city|objective|summary|experience|education|academic|skills|profile|resume|curriculum|email|gmail|mobile|phone|contact|linkedin|qualification|course|university|college|school|board|institution|career objective|personal details)\b/i.test(line))return;var x=line.replace(/[^A-Za-z.' -]/g,' ').replace(/\s+/g,' ').trim(),w=x.split(/\s+/).filter(Boolean);if(!safeAutoName(x))return;var s=118-Math.min(i,45)+(i<=3?48:(i<=8?24:0))+(w.length>=2&&w.length<=4?22:0)+(w.length===1&&x.length>=5&&i<=8?18:0)+(/^[A-Z][A-Z\s.'-]+$/.test(line)&&i<=8?14:0);push(x,s);});if(emailName)push(emailName,104);if(fileName)push(fileName,58);c.sort(function(a,b){return b.s-a.s});return c.length?c[0].v:'';}
  function locationFrom(t){var raw=normalizeWhitespace(t),m=raw.match(/(?:^|\n)\s*(?:current\s+|present\s+|permanent\s+|residential\s+)?(?:location|city|address|residence|based\s+in)\s*[:\-–]\s*([^\n]{2,190})/im)||raw.match(/(?:^|\n)\s*(?:current\s+|present\s+|permanent\s+)?(?:location|city|address)\s*\n\s*([^\n]{2,190})/im);if(m&&m[1]){var q=safeAutoLocation(m[1]);if(q&&!/^(india|address|location)$/i.test(q))return q;}var cities='Greater Noida|Navi Mumbai|New Delhi|Hanumangarh|Sri Ganganagar|Ganganagar|Bhatinda|Bathinda|Noida|Delhi|Gurgaon|Gurugram|Ghaziabad|Faridabad|Kanpur|Lucknow|Prayagraj|Allahabad|Varanasi|Agra|Meerut|Bareilly|Mathura|Aligarh|Moradabad|Saharanpur|Gorakhpur|Jhansi|Ayodhya|Pune|Mumbai|Thane|Bengaluru|Bangalore|Hyderabad|Secunderabad|Chennai|Jaipur|Ahmedabad|Surat|Vadodara|Kolkata|Mohali|Panchkula|Chandigarh|Indore|Bhopal|Patna|Ranchi|Bhubaneswar|Kochi|Cochin|Coimbatore|Nagpur|Nashik|Dehradun|Haridwar|Roorkee|Jalandhar|Ludhiana|Amritsar|Sonipat|Panipat|Rohtak|Manesar|Rewari|Karnal|Ambala|Raipur|Jabalpur|Gwalior|Udaipur|Jodhpur|Kota|Ajmer|Rajkot|Vapi|Mysuru|Mysore|Mangaluru|Mangalore|Vijayawada|Visakhapatnam|Vizag|Madurai|Salem|Trichy';var cm=raw.match(new RegExp('\\b('+cities+')\\b','i'));if(cm){var city=cm[1],lines=raw.split(/\n+/).map(function(x){return x.trim()}).filter(Boolean),rx=new RegExp('\\b'+city.replace(/\s+/g,'\\s+')+'\\b','i'),line=lines.find(function(x){return rx.test(x)&&x.length<=170&&!/(experience|education|academic|company|project|skill|objective)/i.test(x)});return safeAutoLocation(line||city)||city;}var sm=raw.split(/\n+/).find(function(x){return /\b(uttar pradesh|haryana|delhi ncr|maharashtra|karnataka|telangana|tamil nadu|rajasthan|gujarat|west bengal|punjab|madhya pradesh|bihar|jharkhand|odisha|uttarakhand|chhattisgarh|kerala|andhra pradesh)\b/i.test(x)&&x.length<=170});return safeAutoLocation(sm||'');}
  function qualificationFrom(t){var raw=normalizeWhitespace(t),rx=/\b(M\.?\s*Pharm(?:acy)?|M\.?\s*Tech|MCA|MBA|M\.?\s*Com|M\.?\s*S[cce]|MA|PGDM|B\.?\s*Pharm(?:acy)?|Bachelor(?:'s)?\s+of\s+Pharmacy|B\.?\s*Tech|B\.?\s*E\.?|BCA|BBA|B\.?\s*Com|B\.?\s*S[cce]|Bachelor(?:'s)?\s+of\s+Science|BA|D\.?\s*Pharm(?:acy)?|Diploma\s+(?:in|of)\s+Pharmacy|Diploma|Polytechnic|12(?:th)?|10(?:th)?|Higher Secondary|Intermediate|High School)\b/gi,rank={'M.Pharm':104,'M.Tech':102,MCA:100,MBA:98,'M.Com':96,'M.Sc':96,MA:94,PGDM:93,'B.Pharm':86,'B.Tech':84,'B.E.':84,BCA:82,BBA:80,'B.Com':79,'B.Sc':79,BA:77,'D.Pharm':68,Diploma:60,'12th':30,'10th':20},hits=[],m;function norm(v){v=String(v||'');if(/M\.?\s*Pharm/i.test(v))return'M.Pharm';if(/M\.?\s*Tech/i.test(v))return'M.Tech';if(/\bMCA\b/i.test(v))return'MCA';if(/\bMBA\b/i.test(v))return'MBA';if(/M\.?\s*Com/i.test(v))return'M.Com';if(/M\.?\s*S[cce]/i.test(v))return'M.Sc';if(/^MA$/i.test(v))return'MA';if(/PGDM/i.test(v))return'PGDM';if(/B\.?\s*Pharm|Bachelor(?:'s)?\s+of\s+Pharmacy/i.test(v))return'B.Pharm';if(/B\.?\s*Tech/i.test(v))return'B.Tech';if(/B\.?\s*E\.?/i.test(v))return'B.E.';if(/BCA/i.test(v))return'BCA';if(/BBA/i.test(v))return'BBA';if(/B\.?\s*Com/i.test(v))return'B.Com';if(/B\.?\s*S[cce]|Bachelor(?:'s)?\s+of\s+Science/i.test(v))return'B.Sc';if(/^BA$/i.test(v))return'BA';if(/D\.?\s*Pharm|Diploma\s+(?:in|of)\s+Pharmacy/i.test(v))return'D.Pharm';if(/Diploma|Polytechnic/i.test(v))return'Diploma';if(/12|Higher Secondary|Intermediate/i.test(v))return'12th';if(/10|High School/i.test(v))return'10th';return'';}while((m=rx.exec(raw))){var c=norm(m[0]);if(!c)continue;var ctx=raw.slice(Math.max(0,m.index-140),Math.min(raw.length,m.index+m[0].length+180)),ys=[].slice.call(ctx.matchAll(/\b(19\d{2}|20\d{2})\b/g)).map(function(x){return Number(x[1])}).filter(function(y){return y>=1980&&y<=new Date().getFullYear()+2});hits.push({c:c,y:ys.length?Math.max.apply(Math,ys):0,r:rank[c]||0,i:m.index});}if(!hits.length)return'';var wy=hits.filter(function(x){return x.y>0});(wy.length?wy:hits).sort(function(a,b){return wy.length?((b.y-a.y)||(b.r-a.r)||(b.i-a.i)):((b.r-a.r)||(b.i-a.i))});return(wy.length?wy:hits)[0].c;}
  function expMonths(t){var x=String(t||'').toLowerCase();if(/\bfresher\b/.test(x))return 0;var y=x.match(/(\d+(?:\.\d+)?)\s*(?:years?|yrs?)/),m=x.match(/(\d+(?:\.\d+)?)\s*(?:months?|mos?)/),n=0;if(y)n+=Math.round(Number(y[1])*12);if(m)n+=Math.round(Number(m[1]));return n;}
  function inputSetter(el,val){if(!el||val===undefined||val===null||val==='')return;var proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;var d=Object.getOwnPropertyDescriptor(proto,'value');if(d&&d.set)d.set.call(el,String(val));else el.value=String(val);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
  function fieldByLabel(text){var labels=[].slice.call(document.querySelectorAll('.qa-candidate-shell label,.stack-form label,.candidate-detail-full-panel label'));var l=labels.find(function(x){return String(x.textContent||'').trim().toLowerCase()===String(text).toLowerCase();});return l&&l.parentElement?l.parentElement.querySelector('input,textarea,select'):null;}
  function experiencePair(label,months){var labels=[].slice.call(document.querySelectorAll('.qa-candidate-shell label,.stack-form label,.candidate-detail-full-panel label'));var l=labels.find(function(x){return String(x.textContent||'').trim().toLowerCase()===label.toLowerCase();});if(!l)return;var box=l.parentElement;var ins=box?box.querySelectorAll('input'):[];if(ins.length>=2){inputSetter(ins[0],Math.floor(months/12));inputSetter(ins[1],months%12);}}
  function clickChoice(labelText,value){var labels=[].slice.call(document.querySelectorAll('.candidate-detail-full-panel label'));var l=labels.find(function(x){return String(x.textContent||'').trim().toLowerCase()===String(labelText||'').toLowerCase();});if(!l)return;var box=l.closest('[data-field]')||l.parentElement;if(!box)return;var wanted=String(value||'').trim().toLowerCase();var b=[].slice.call(box.querySelectorAll('button')).find(function(x){return String(x.textContent||'').trim().toLowerCase()===wanted;});if(b&&!b.disabled&&!b.classList.contains('active'))try{b.click()}catch(_){}}
  function preferredLocationChoice(value){var loc=String(value||'').trim().toLowerCase();if(!loc)return;var box=document.querySelector('.candidate-detail-full-panel [data-field="preferred_location"]');if(!box)return;var b=[].slice.call(box.querySelectorAll('button.choice-chip')).find(function(x){var s=String(x.textContent||'').trim().toLowerCase();return s===loc||s.indexOf(loc)>=0||loc.indexOf(s)>=0;});if(b&&!b.disabled&&!b.classList.contains('active'))try{b.click()}catch(_){}}
  function courseDegree(q){var s=String(q||'').toLowerCase();return /(?:10th|12th|higher secondary|intermediate|diploma|undergraduate)/i.test(s)?'NON - Graduate':'Graduate';}
  function setResumeField(primary,secondary,value){if(!value)return;inputSetter(fieldByLabel(primary)||fieldByLabel(secondary),value);}
  function safeAutoName(value){var x=String(value||'').replace(/[^A-Za-z.' -]/g,' ').replace(/\s+/g,' ').trim();if(x.length<4||x.length>70||/^(resume|cv|profile|candidate|name|curriculum|vitae|career crox|career|crox|personal details|contact details|career objective|objective)$/i.test(x))return '';var letters=x.replace(/[^A-Za-z]/g,'');if(letters.length<4||!/[aeiouy]/i.test(letters)||/(.)\1\1/i.test(letters))return'';if(/^[A-Z]{4,8}$/.test(x)&&/[QXZ]{2,}/.test(x))return'';var w=x.split(/\s+/).filter(Boolean);if(!w.length||w.length>5)return '';return titleCase(x);}
    function applyResumeParse(parsed,card,fileName){var fields=parsed&&parsed.fields?parsed.fields:{};var rawText=String(parsed&&parsed.text||'');var n=safeAutoName(fields.full_name||fields.name)||safeAutoName(nameFrom(rawText,fileName));var ph=String(fields.phone||'').trim()||phone(rawText);var loc=safeAutoLocation(fields.location)||safeAutoLocation(locationFrom(rawText));var q=String(fields.qualification||'').trim()||qualificationFrom(rawText);var total=String(fields.total_experience||'').trim();var relevant=String(fields.relevant_experience||'').trim();var mo=Math.max(expMonths(rawText),/^\d+(?:\.\d+)?$/.test(total)?Math.round(Number(total)*12):0);setResumeField('Full Name','Name',n);setResumeField('Phone','Number',ph);setResumeField('Location','Location',loc);setResumeField('Qualification','Course Name',q);if(String(fields.email||'').trim())setResumeField('Email','Email',String(fields.email||'').trim());if(loc)preferredLocationChoice(loc);if(q)clickChoice('Degree',courseDegree(q));if(/\bfresher\b/i.test(rawText)||String(total).trim()==='0'||String(relevant).trim()==='0')clickChoice('Career Gap','Fresher');if(mo>0){experiencePair('Total Experience',mo);experiencePair('Relevant Experience',mo);}var status=card.querySelector('.cc451-resume-status');if(status){status.textContent='';status.dataset.state='done';}}
  async function handleResume(file,card){var status=card.querySelector('.cc451-resume-status'),btn=card.querySelector('.cc451-resume-btn'),ok=false;if(btn){btn.classList.add('busy');btn.textContent='Reading…';}if(status){status.textContent='';status.dataset.state='busy';}try{var parsed=null;try{parsed=await parseResumeServer(file);}catch(serverErr){parsed={fields:{},text:''};}var fields=parsed&&parsed.fields?parsed.fields:{},baseText=String(parsed&&parsed.text||''),type=String(file.type||'').toLowerCase(),fname=String(file.name||'').toLowerCase(),isPdf=type.indexOf('pdf')>=0||/\.pdf$/.test(fname),isImg=/^image\//.test(type)||/\.(png|jpe?g|webp|bmp|tiff?)$/.test(fname),pdfText=isPdf?await browserPdfText(file):'',digitalText=normalizeWhitespace([pdfText,baseText].filter(Boolean).join('\n\n')),digitalName=safeAutoName(nameFrom(digitalText,file.name)),digitalPhone=phone(digitalText),digitalLoc=safeAutoLocation(locationFrom(digitalText)),digitalCourse=qualificationFrom(digitalText),serverName=safeAutoName(fields.full_name||fields.name),serverLoc=safeAutoLocation(fields.location),serverCourse=String(fields.qualification||'').trim(),needDeep=(isImg||isPdf)&&(!digitalName||!digitalPhone||!digitalLoc||!digitalCourse),ocrText='';if(needDeep)ocrText=await browserOcrFile(file,status);var ocrName=safeAutoName(nameFrom(ocrText,file.name)),ocrPhone=phone(ocrText),ocrLoc=safeAutoLocation(locationFrom(ocrText)),ocrCourse=qualificationFrom(ocrText),text=normalizeWhitespace([digitalText,ocrText].filter(Boolean).join('\n\n')),n=isPdf?(digitalName||serverName||ocrName||fileNameHumanName(file.name)):(ocrName||serverName||digitalName||fileNameHumanName(file.name)),ph=digitalPhone||String(fields.phone||'').trim()||ocrPhone,loc=digitalLoc||serverLoc||ocrLoc,q=digitalCourse||serverCourse||ocrCourse,total=String(fields.total_experience||'').trim(),relevant=String(fields.relevant_experience||'').trim(),mo=Math.max(expMonths(text),/^\d+(?:\.\d+)?$/.test(total)?Math.round(Number(total)*12):0);var finalParsed={fields:Object.assign({},fields,{full_name:n,phone:ph,location:loc,qualification:q}),text:text};applyResumeParse(finalParsed,card,file.name);ok=true;}catch(e){try{console.error('Resume auto-fill blocked safely:',e)}catch(_){}if(status){status.textContent='';status.dataset.state='error';}}finally{if(btn){btn.classList.remove('busy');if(ok){btn.textContent='Filled ✓';setTimeout(function(){if(btn)btn.textContent='Upload Resume';},850);}else{btn.textContent='Upload Resume';}}}}
  function ensureResumeCard(){
    var pth=path();if(pth!=='/quick-add/candidate')return;var isFull=pth==='/candidate/new';var host=isFull?document.querySelector('.candidate-detail-full-panel'):document.querySelector('form.qa-candidate-shell,form.stack-form');if(!host)return;
    var existing=document.getElementById('cc451-resume-card');if(existing&&isFull)existing.remove();
    var oldBtn=document.getElementById('cc451-header-resume-upload');if(oldBtn)return;
    var card=document.createElement('div');card.id='cc451-resume-card';card.className='cc451-resume-card'+(isFull?' cc451-resume-card-inline':'');card.innerHTML='<input id="cc451-resume-input" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.doc,.docx,.docm,.dotx,.dotm,.rtf,.txt,.csv,.eml,.html,.htm,.odt,.md" hidden><label for="cc451-resume-input" id="cc451-header-resume-upload" class="cc451-resume-btn">Upload Resume</label>';
    card.querySelector('input').addEventListener('change',function(e){var f=e.target.files&&e.target.files[0];if(f)handleResume(f,card);e.target.value='';});
    if(isFull){var actionRow=host.querySelector('.detail-header-actions');if(actionRow)actionRow.insertBefore(card,actionRow.firstChild);else{var titleRow=host.querySelector('.cc655-title-row')||host.querySelector(':scope > .panel-heading-row > div')||host.querySelector(':scope > .panel-heading-row');if(titleRow)titleRow.appendChild(card);else host.insertBefore(card,host.firstChild);}}else{if(document.getElementById('cc451-resume-card'))return;var first=host.children[0];if(first&&first.nextSibling)host.insertBefore(card,first.nextSibling);else host.insertBefore(card,host.firstChild);var tools=document.createElement('div');tools.className='cc451-import-tools';tools.innerHTML='<b>Moving old candidate data?</b><a href="/assets/import/CAREER_CROX_CANDIDATE_IMPORT_TEMPLATE.xlsx" download>Excel Template</a><a href="/assets/import/CAREER_CROX_CANDIDATE_IMPORT_TEMPLATE.csv" download>CSV Template</a><a href="/admin?open=bulk">Open Bulk Import</a>';card.after(tools);}
  }
  function openBulkFromQuery(){if(path()!=='/admin')return;var q=new URLSearchParams(location.search);if(!/^(bulk|import|candidate-import)$/i.test(q.get('open')||''))return;if(document.body.dataset.cc451BulkOpened==='1')return;var b=[].slice.call(document.querySelectorAll('button')).find(function(x){return /bulk candidate load/i.test(String(x.textContent||''));});if(b){document.body.dataset.cc451BulkOpened='1';try{b.click();}catch(_){}}}
  function enhanceAttendance(){
    if(path()!=='/attendance')return;var panel=[].slice.call(document.querySelectorAll('.panel,.table-panel')).find(function(x){return /break control/i.test(String(x.textContent||''));});if(panel)panel.classList.add('cc451-break-control');
    // If the page rendered before Join Office response, refresh the page state once after the gate closes.
    if(joined()&&document.body.dataset.cc451AttendanceReady!=='1'){document.body.dataset.cc451AttendanceReady='1';var b=[].slice.call(document.querySelectorAll('button')).find(function(x){return /update details/i.test(String(x.textContent||''));});if(b&&!b.disabled)setTimeout(function(){try{b.click();}catch(_){}},80);}
  }
  function cleanupCopy(){
    document.querySelectorAll('.candidate-filter-modal-subtitle,.candidate-filter-main-subtitle,.cc-global-source-subtitle').forEach(function(el){el.style.display='none';});
    var decorative=new Set([
      'Capture signal. Review fast. Ship clean leads.',
      'Paste source text and the parser surfaces the strongest contact, company, stage, priority, and score signals.',
      'Select employees or clients. Bulk picks go to CC or BCC from here without turning the client dashboard into a mail board.',
      'Template, greeting, CC/BCC, draft and open-mail flow in one place. The compose box should look like work, not punishment.',
      'Important daily checks, quick template loading, send history and export all stay here instead of leaking all over the client page.',
      'Shows today interview count and opens this page in today mode.',
      'Opens two tabs: All Details Pending and Latest Attempt Complete.',
      'Pending rows stay here until status becomes All set for Interview. No answer button snoozes the reminder by 15 minutes.',
      'Prime Time scores calls, connects, details, and submissions into one signal.',
      'See where each recruiter peaks across the day.',
      'Cards and reports stay aligned to the same call snapshot.',
      'Approve here or jump to the Approval Center.',
      'Your scheduled interview and follow-up queue is ready.',
      'Action ready.',
      'Office Duration = 9h active-work target me kitna time baki • Active Work = real work • Idle = no work • Break = taken break • Talk Time = incoming + outgoing same call source'
    ]);
    document.querySelectorAll('.helper-text,.activity-sub,.bda-sub,.mail-sub,.pti-mini-note').forEach(function(el){
      var t=String(el.textContent||'').replace(/\s+/g,' ').trim();
      if(decorative.has(t))el.style.display='none';
    });
  }
  function fixPreferredLocationOptions(){try{localStorage.removeItem('careerCroxPreferredLocations_v3')}catch(_){}var panel=document.querySelector('.candidate-detail-full-panel'),box=panel&&panel.querySelector('[data-field="preferred_location"]');if(!box)return;var seen={};box.querySelectorAll('button.choice-chip').forEach(function(b){var x=String(b.textContent||'').trim();if(!x)return;if(seen[x]){b.remove();return;}seen[x]=1;});var addBtn=[].slice.call(box.querySelectorAll('button.mini-inline-action')).find(function(b){return /add new/i.test(String(b.textContent||''));});if(addBtn){addBtn.style.display='inline-flex';addBtn.style.visibility='visible';addBtn.disabled=!1;}if(panel&&panel.dataset.cc668PrefObserver!=='1'){panel.dataset.cc668PrefObserver='1';var busy=!1;new MutationObserver(function(){if(busy)return;busy=!0;requestAnimationFrame(function(){busy=!1;var b=panel.querySelector('[data-field="preferred_location"]');if(!b)return;var localSeen={};b.querySelectorAll('button.choice-chip').forEach(function(x){var label=String(x.textContent||'').trim();if(!label)return;if(localSeen[label])x.remove();else localSeen[label]=1;});var add=[].slice.call(b.querySelectorAll('button.mini-inline-action')).find(function(x){return /add new/i.test(String(x.textContent||''));});if(add){add.style.display='inline-flex';add.style.visibility='visible';add.disabled=!1;}});}).observe(panel,{childList:!0,subtree:!0});}}
  // A failed note write after creating a candidate must not discard the typed draft
  // when /candidate/new switches to the existing-profile renderer.
  function restorePendingNote(){
    var m=path().match(/^\/candidate\/([^/?#]+)\/?$/i);
    if(!m||String(m[1]).toLowerCase()==='new')return;
    var key='cc718_pending_note_'+decodeURIComponent(m[1]),note='';
    try{note=String(sessionStorage.getItem(key)||'')}catch(_){}
    if(!note)return;
    var textarea=document.querySelector('.candidate-notes-chat-panel textarea.candidate-notes-main-textarea');
    if(!textarea||String(textarea.value||'').trim())return;
    try{var setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
      setter.call(textarea,note);textarea.dispatchEvent(new Event('input',{bubbles:true}));
      if(textarea.value===note)sessionStorage.removeItem(key);
    }catch(_){}
  }
  function update(){scheduled=false;clearStale();suppressOldJoin();ensureGate();restorePendingNote();ensureResumeCard();fixPreferredLocationOptions();openBulkFromQuery();enhanceAttendance();cleanupCopy();if(path()==="/candidate/new"){document.body.classList.add("cc665-new-candidate");document.querySelectorAll(".candidate-detail-full-panel .helper-text").forEach(function(el){var x=String(el.textContent||"").replace(/\s+/g," ").trim();if(x==="One profile. Every signal. Ready for action."||/^Status: Draft • Details Sent: Pending •/.test(x))el.style.display="none";});document.querySelectorAll(".candidate-recent-note-strip-shell").forEach(function(shell){if(!shell.querySelector(".candidate-note-highlight-card"))shell.style.display="none";});}else document.body.classList.remove("cc665-new-candidate");lastPath=path();}
  function schedule(){if(scheduled)return;scheduled=true;setTimeout(update,35);}

  var css=document.createElement('style');css.id='cc451-workflow-style';css.textContent='\
  /* CC828: React owns the single Join Office gate. */\
  .candidate-detail-full-panel .candidate-notes-preview-col,.candidate-detail-full-panel .cc656-inline-presets{display:none!important}\
  .candidate-detail-full-panel .candidate-notes-composer-grid{grid-template-columns:minmax(0,1fr)!important}\
  .candidate-detail-full-panel .candidate-notes-main-textarea{min-height:130px!important;resize:vertical!important;font-size:16px!important;line-height:1.5!important}\
  .candidate-filter-modal-subtitle,.candidate-filter-main-subtitle,.cc-global-source-subtitle{display:none!important}\
  body.cc451-await-join .global-submission-reminder-wrap,body.cc451-await-join .cc-global-source-wrap,body.cc451-await-join .cc391-reminder-deck,body.cc451-await-join .task-reminder-popup,body.cc451-await-join .revenue-reminder-popup,body.cc451-await-join .approval-popup-panel{display:none!important;visibility:hidden!important;pointer-events:none!important}\
  .candidate-detail-full-panel .choice-chip.active,body:not(.login-body) .candidate-detail-full-panel .choice-chip.active{background:linear-gradient(135deg,#ffd54f 0%,#ffb300 52%,#ff8f00 100%)!important;color:#5a2b00!important;border:1px solid rgba(255,255,255,.72)!important;box-shadow:0 12px 28px rgba(255,179,0,.30),inset 0 1px 0 rgba(255,255,255,.62)!important;text-shadow:none!important}\
  .candidate-detail-full-panel .choice-chip:hover:not(:disabled),body:not(.login-body) .candidate-detail-full-panel .choice-chip:hover:not(:disabled){border-color:rgba(255,179,0,.46)!important;box-shadow:0 8px 18px rgba(255,193,7,.18)!important}\
  .candidate-detail-full-panel [data-field="preferred_location"] .mini-inline-action{display:inline-flex!important;align-items:center!important;justify-content:center!important;padding:7px 12px!important;border-radius:999px!important;background:linear-gradient(135deg,#ff8a3d 0%,#ffb347 52%,#ffd86b 100%)!important;color:#6a2d00!important;border:1px solid rgba(255,255,255,.72)!important;font-weight:900!important;box-shadow:0 10px 24px rgba(255,152,0,.22),inset 0 1px 0 rgba(255,255,255,.54)!important}\
  .candidate-detail-full-panel [data-field="preferred_location"] .mini-inline-action:disabled{opacity:.72!important}\
  #cc451-resume-card{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-left:10px}#cc451-resume-card.cc451-resume-card-inline{padding:0!important;border:0!important;background:transparent!important;box-shadow:none!important;margin:0 0 0 10px!important}#cc451-resume-card .cc451-resume-status{display:none!important}#cc451-resume-card .cc451-resume-status[data-state="busy"]{color:#17456c;background:linear-gradient(135deg,#e0f2fe,#ecfeff)}#cc451-resume-card .cc451-resume-status[data-state="done"]{color:#0f5132;background:linear-gradient(135deg,#ecfdf5,#dcfce7)}#cc451-resume-card .cc451-resume-status[data-state="error"]{color:#8a1f34;background:linear-gradient(135deg,#fff1f2,#ffe4e6)}.cc451-resume-btn{display:inline-flex;align-items:center;justify-content:center;min-height:38px;padding:0 18px;border-radius:14px;background:linear-gradient(135deg,#10b981 0%,#06b6d4 55%,#6366f1 100%);color:#fff;font-weight:1000;cursor:pointer;white-space:nowrap;box-shadow:0 10px 28px rgba(61,129,196,.18),inset 0 1px 0 rgba(255,255,255,.34);border:1px solid rgba(255,255,255,.34)}.cc451-resume-btn.busy{opacity:.72}.cc451-import-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 10px;margin-bottom:10px;font-size:11px}.cc451-import-tools a{padding:6px 9px;border-radius:10px;background:#fff;border:1px solid #cbd5e1;color:#1d4ed8;font-weight:900;text-decoration:none}body.cc665-new-candidate .cc655-title-row{display:flex!important;align-items:center!important;flex-wrap:wrap!important;gap:10px!important}body.cc665-new-candidate .candidate-detail-full-panel>.approval-action-banner{padding:6px 10px!important;margin:5px 0 9px!important;border-radius:14px!important;min-height:0!important;gap:8px!important}\
  body.cc665-new-candidate .candidate-detail-full-panel>.approval-action-banner .profile-state-chip{min-height:30px!important;padding:5px 10px!important}\
  body.cc665-new-candidate .candidate-detail-full-panel>.approval-action-banner .last-viewed-highlight{padding:5px 10px!important;min-height:0!important}\
  body.cc665-new-candidate .candidate-detail-full-panel>.approval-action-banner .approval-banner-left{gap:7px!important}\
  .candidate-phone-input-shell{display:grid!important;grid-template-columns:auto minmax(0,1fr)!important;align-items:center!important;min-height:46px!important;border-radius:14px!important;border:1px solid rgba(100,121,179,.18)!important;background:#f8fbff!important;overflow:hidden!important}\
  .candidate-phone-input-shell:focus-within{border-color:rgba(66,149,98,.32)!important;box-shadow:0 0 0 3px rgba(86,167,115,.10)!important}\
  .candidate-phone-prefix{display:grid!important;place-items:center!important;align-self:stretch!important;padding:0 10px 0 12px!important;border-right:1px solid rgba(100,121,179,.14)!important;color:#17304d!important;font-size:16px!important;font-weight:900!important;background:linear-gradient(180deg,#eef6ff,#e7f1ff)!important;white-space:nowrap!important}\
  .candidate-phone-input-shell input{border:0!important;box-shadow:none!important;background:transparent!important;border-radius:0!important;min-width:0!important}\
      body .cc451-break-control button:not(:disabled),body .cc451-break-control select:not(:disabled){cursor:pointer!important}\
  @media(max-width:720px){.cc451-office-points{grid-template-columns:1fr}#cc451-resume-card{align-items:flex-start}#cc451-resume-card .cc451-resume-status{white-space:normal}}';document.head.appendChild(css);
  window.addEventListener('career-crox-idle-lock-begin',function(){try{var j=joinedState();if(j&&j.identity===identity()&&j.joined_at&&istDay(j.joined_at)===istDay())localStorage.setItem(DAILY_JOIN_BACKUP,JSON.stringify(j));var t=JSON.parse(localStorage.getItem('cc456_session_activity_state')||'null');if(t&&String(t.identity||'')===identity())localStorage.setItem(DAILY_TIMER_BACKUP,JSON.stringify(t));localStorage.setItem(PRESERVE_FLAG,'1');}catch(_){}});
  document.addEventListener('visibilitychange',function(){if(!document.hidden)schedule();});window.addEventListener('storage',schedule);window.addEventListener('career-crox-office-joined',schedule);window.addEventListener('career-crox-attendance-live',schedule);window.addEventListener('popstate',schedule);
  var push=history.pushState,replace=history.replaceState;history.pushState=function(){var r=push.apply(this,arguments);schedule();setTimeout(schedule,180);setTimeout(schedule,700);return r;};history.replaceState=function(){var r=replace.apply(this,arguments);schedule();setTimeout(schedule,180);setTimeout(schedule,700);return r;};
  // One-time local cleanup of invalid CC722 auto-joined state; no Supabase write.
  try{if(localStorage.getItem('cc723_manual_join_migrated')!=='1'){
    var old=joinedState();if(old&&!old.manual_confirmed_at){localStorage.removeItem(JOIN_KEY);
      localStorage.removeItem('cc456_session_activity_state');localStorage.removeItem('cc434_work_activity_at');}
    localStorage.setItem('cc723_manual_join_migrated','1');
  }}catch(_){}
  window.__CC451_WORKFLOW_BUILD__=BUILD;
  var root=document.getElementById('root');
  if(root&&typeof MutationObserver!=='undefined')new MutationObserver(function(records){
    var gateChanged=records.some(function(record){
      return Array.prototype.some.call(record.addedNodes,function(n){return n.nodeType===1&&(n.matches?.('.app-shell,.crm-modal-backdrop,.join-office-modal')||n.querySelector?.('.join-office-modal'));})||
        Array.prototype.some.call(record.removedNodes,function(n){return n.nodeType===1&&(n.matches?.('.app-shell,.crm-modal-backdrop,.join-office-modal')||n.querySelector?.('.join-office-modal'));});
    });
    if(!gateChanged)return;
    if(gateTimer)clearTimeout(gateTimer);gateTimer=setTimeout(function(){gateTimer=null;ensureGate();},85);
  }).observe(root,{childList:true,subtree:true});
  setTimeout(update,0);setTimeout(schedule,900);
})();

/* CC26_745 - strict manual Join Office guard; event-only, zero polling. */
(function(){
  'use strict';
  if(window.__CC745_STRICT_MANUAL_JOIN__)return;
  window.__CC745_STRICT_MANUAL_JOIN__=true;
  var KEY='careerCroxOfficeJoinedSession', TIMER='cc456_session_activity_state';
  function day(v){var t=v==null?Date.now():new Date(v).getTime();return Number.isFinite(t)?new Date(t+19800000).toISOString().slice(0,10):'';}
  function marker(){try{return String(localStorage.getItem('careerCroxSessionLoginAt')||'').trim();}catch(_){return '';}}
  function identity(){try{var u=JSON.parse(localStorage.getItem('careerCroxCachedUser')||'null')||{};return String(u.user_id||u.recruiter_code||u.username||'').trim();}catch(_){return '';}}
  function state(){try{return JSON.parse(localStorage.getItem(KEY)||'null');}catch(_){return null;}}
  function valid(){var s=state(),id=identity(),mk=marker();return !!(s&&id&&mk&&String(s.identity||'')===id&&String(s.login_marker||'')===mk&&s.joined_at&&s.manual_confirmed_at&&day(s.joined_at)===day()&&day(s.manual_confirmed_at)===day());}
  function clearStale(){var s=state();if(!s||valid())return;try{localStorage.removeItem(KEY);localStorage.removeItem(TIMER);localStorage.removeItem('cc434_work_activity_at');}catch(_){}}
  clearStale();
  var base=window.__CC723_OFFICE_RESTORE__||window.__CC722_OFFICE_RESTORE__||window.__CC721_OFFICE_RESTORE__;
  function strictRestore(response,explicitClick){
    // Background attendance may verify an already-clicked session, but may never create one.
    if(!explicitClick&&!valid())return false;
    if(typeof base!=='function')return valid();
    var ok=base(response,!!explicitClick)===true;
    return ok&&valid();
  }
  window.__CC723_OFFICE_RESTORE__=strictRestore;
  window.__CC722_OFFICE_RESTORE__=strictRestore;
  window.__CC721_OFFICE_RESTORE__=strictRestore;
  window.__CC723_OFFICE_JOINED__=valid;
  window.__CC722_OFFICE_JOINED__=valid;
  window.__CC721_OFFICE_JOINED__=valid;
  window.__CC718_OFFICE_JOINED__=valid;
  window.addEventListener('pageshow',clearStale,{once:true});
  window.addEventListener('career-crox-react-ready',clearStale,{once:true});
})();


;(function(){
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
    window.CareerCroxWhatsApp.open(phone,'',{source:'legacy_candidate_action',onLaunch:()=>{
      try{ fetch(`/api/candidates/${encodeURIComponent(candidate.candidate_id || '')}/whatsapp-log`,{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:''})}).catch(()=>{}); }catch(_e){}
    }});
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


;/* CC26_584: premium WhatsApp/iOS-like native emoji picker.
   Uses OS/native color emoji glyphs, light tray styling, search, tabs, and no backend calls. */
(function () {
  'use strict';
  if (window.__cc584PickerReady) return;
  window.__cc584PickerReady = true;

  const KEY = 'cc584_chat_recent_emoji';
  const CATEGORY_DATA = [
    { id: 'recent', label: 'Recent', icon: '🕘', items: '😂 😍 ❤️ 👍 🙏 🔥 😭 😎 😁 😘 🎉 🥳 🤣 🫶 👏 ☺️ 😢 😡 😴 🥺 😍 💯' },
    { id: 'smileys', label: 'Smileys & People', icon: '😊', items: '😀 😃 😄 😁 😆 😅 😂 🤣 🥲 🥹 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😮‍💨 😤 😠 😡 🤬 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫣 🤭 🤫 😶 😐 😑 😬 🙄 😯 😮 😲 🥱 😴 🤤 😪 🫠 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 😈 👿 💩 👻 💀 ☠️ 👽 🤖 🎃 👋 🤚 ✋ 🖐️ 🫱 🫲 👌 🤌 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 🫵 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 💪 🫦 💋 👄 👀 👁️ 👅 👂 👃 🧠 ❤️ 🩷 🧡 💛 💚 🩵 💙 💜 🤎 🖤 🤍 💔 ❤️‍🔥 ❤️‍🩹 💕 💞 💓 💗 💖 💘 💝 💯' },
    { id: 'animals', label: 'Animals & Nature', icon: '🐻', items: '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🕷️ 🦂 🐢 🐍 🦎 🦖 🐙 🦑 🦀 🦐 🐠 🐟 🐡 🦈 🐬 🐳 🐋 🐊 🐅 🐆 🦓 🦍 🦧 🐘 🦛 🦏 🐪 🦒 🦘 🦬 🐃 🐂 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🐩 🐈 🐇 🦝 🦨 🦦 🦥 🐁 🐀 🐿️ 🦔 🌵 🎄 🌲 🌳 🌴 🌱 🌿 ☘️ 🍀 🍃 🍂 🍁 🌹 🌺 🌸 🌼 🌻 🌞 🌝 🌛 🌜 🌚 🌕 🌙 ⭐ 🌟 ✨ ⚡ ☄️ 💥 🔥 🌈 ☀️ ⛅ 🌧️ ⛈️ ❄️ ☃️ 💧 💦 🌊' },
    { id: 'food', label: 'Food & Drink', icon: '🍔', items: '🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶️ 🫑 🌽 🥕 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🥙 🌮 🌯 🥗 🥘 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍙 🍚 🍥 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🥛 🍼 ☕ 🍵 🧃 🥤 🧋 🧊 🥢 🍽️ 🍴 🥄' },
    { id: 'travel', label: 'Travel & Places', icon: '🚗', items: '🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🛵 🏍️ 🛺 🚲 🛴 🚦 🚧 ⚓ ⛵ 🚤 🛳️ 🚢 ✈️ 🛫 🛬 🚀 🛸 🚁 🚡 🚠 🚆 🚄 🚅 🚇 🚈 🚉 🚊 🚝 🚋 🏙️ 🌆 🌇 🌃 🌉 🌌 🎆 🎇 🌄 🌅 🏞️ 🏝️ 🏖️ 🏜️ 🌋 ⛰️ 🏔️ 🏕️ ⛺ 🛖 🏠 🏡 🏢 🏣 🏤 🏥 🏦 🏨 🏪 🏫 🏬 🏭 🏯 🏰 🗼 🗽 ⛪ 🕌 🛕 ⛲ 🌁 🌍 🌎 🌏 🌐' },
    { id: 'objects', label: 'Objects', icon: '💡', items: '⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 📷 📸 📹 🎥 📞 ☎️ 📺 📻 🎙️ 🎤 🎧 🎵 🎶 🎹 🥁 🎸 🎻 🎺 🎷 🎮 🎯 🎨 🧩 🧸 🎁 🎈 🎀 🎊 🎉 ✉️ 📩 📨 📧 💌 📦 📋 📌 📍 📎 📏 📐 ✂️ 📂 📁 📚 📖 📝 ✏️ 🖊️ 🖍️ 🔍 🔎 🔒 🔓 🔑 🔨 🔧 🛠️ ⚙️ 💡 🔦 🕯️ 🛒 🛍️ 🏆 🥇 🥈 🥉 🏅 🎖️ 💎 💍 💰 💵 💶 💷 💸 💳 🧾' },
    { id: 'symbols', label: 'Symbols', icon: '❤️', items: '❤️ 🧡 💛 💚 🩵 💙 💜 🤎 🖤 🤍 🩷 💔 ❤️‍🔥 ❤️‍🩹 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉️ ✡️ ☯️ ⚛️ ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ ⚠️ ⛔ 🚫 ❌ ⭕ 💢 ❗ ❕ ❓ ❔ ‼️ ⁉️ 💯 ✅ ☑️ ✔️ ❎ ➕ ➖ ➗ ✖️ ™️ ©️ ®️ 🔰 ⚜️ 🔱 🔆 🔅 ⭐ 🔥 ⚡ 💤 🎵 💬 💭 🗯️ 🔔 🔕 🔊 🔉 🔈 🔇' },
    { id: 'flags', label: 'Flags', icon: '🏳️', items: '🏁 🚩 🎌 🏳️ 🏴 🏳️‍🌈 🇮🇳 🇺🇸 🇬🇧 🇦🇺 🇨🇦 🇩🇪 🇫🇷 🇯🇵 🇰🇷 🇨🇳 🇧🇷 🇮🇹 🇪🇸 🇸🇬 🇦🇪 🇿🇦 🇳🇵 🇧🇩 🇱🇰 🇵🇰 🇹🇭 🇲🇾 🇮🇩 🇵🇭 🇻🇳 🇷🇺 🇺🇦 🇪🇺' }
  ];
  const SEARCH_WORDS = {
    '😂':'laugh tears joy funny', '🤣':'rofl laughing rolling', '😍':'heart eyes love', '🥰':'love smiling hearts', '😘':'kiss love', '❤️':'red heart love', '🔥':'fire hot lit', '👍':'thumbs up ok yes like', '🙏':'pray thanks please', '😭':'cry sad tears', '😊':'smile happy', '😎':'cool glasses swag', '😁':'grin happy', '💯':'hundred perfect', '💋':'kiss lips', '💄':'lipstick makeup beauty', '💍':'ring engagement diamond', '💅':'nails manicure beauty', '🤝':'handshake deal', '👏':'clap applause', '🥳':'party birthday celebration', '🎉':'party popper celebration', '☕':'tea coffee', '🍕':'pizza', '🍔':'burger', '🚀':'rocket', '🎯':'target', '👀':'eyes देखना', '💪':'strong gym', '🤔':'thinking', '😡':'angry', '😴':'sleep', '😘':'kiss', '🫶':'heart hands', '🤍':'white heart', '🩷':'pink heart', '🩵':'light blue heart', '📞':'call', '📱':'phone mobile'
  };

  let overlay = null, search = null, results = null, category = 'recent', focusInput = null, trigger = null, lastRecent = null;
  let recent = readRecent();
  function isChat(){ return !window.__CC_CHAT_REACT_OWNER__ && /^\/chat(?:\/|$)/.test(location.pathname || ''); }
  function readRecent(){try{const rows=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(rows)&&rows.length?rows.slice(0,28):(lastRecent||CATEGORY_DATA[0].items.split(' '));}catch(_){return lastRecent||CATEGORY_DATA[0].items.split(' ');}}
  function recordRecent(emoji){recent=[emoji,...recent.filter(x=>x!==emoji)].slice(0,28);lastRecent=recent;try{localStorage.setItem(KEY,JSON.stringify(recent));}catch(_){} }
  function itemsFor(id){return (id==='recent'?recent:CATEGORY_DATA.find(x=>x.id===id)?.items.split(' ')||[]).filter(Boolean);}
  function createEl(tag,cls,txt){const el=document.createElement(tag);if(cls)el.className=cls;if(txt!==undefined)el.textContent=txt;return el;}
  function ensureStyles(){
    if(document.getElementById('cc584-emoji-style')) return;
    const s=createEl('style'); s.id='cc584-emoji-style'; s.textContent=`
body.cc469-chat .composer .emojiBar,body.cc474-chat .composer .emojiBar,body.cc469-chat .composer.cc469-emoji-open .emojiBar,body.cc474-chat .composer.emojiOpen .emojiBar{display:none!important}
#cc584-picker{position:fixed!important;z-index:2147483600!important;width:min(520px,calc(100vw - 18px))!important;height:min(560px,calc(100dvh - 90px))!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;background:#eceff3!important;border:1px solid #d8dde6!important;border-radius:26px!important;box-shadow:0 30px 80px rgba(20,43,84,.22),0 8px 22px rgba(36,65,104,.10),inset 0 1px 0 rgba(255,255,255,.96)!important;font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji','Segoe UI',Arial,sans-serif!important;color:#27394e!important;text-align:left!important;pointer-events:auto!important;isolation:isolate!important}
#cc584-picker *{box-sizing:border-box!important}
#cc584-picker .cc584-tabs{height:56px!important;min-height:56px!important;display:flex!important;align-items:center!important;justify-content:space-between!important;gap:6px!important;border-bottom:1px solid #dde2ea!important;padding:6px 12px!important;background:linear-gradient(180deg,#f5f6f8,#eceff3)!important}
#cc584-picker button.cc584-tab{flex:1 1 0!important;max-width:48px!important;height:40px!important;padding:0!important;display:flex!important;align-items:center!important;justify-content:center!important;border:0!important;border-radius:12px!important;background:transparent!important;color:#4c6077!important;font-size:23px!important;line-height:1!important;cursor:pointer!important;opacity:1!important;box-shadow:none!important}
#cc584-picker button.cc584-tab.is-active{background:#fff!important;color:#213047!important;box-shadow:0 4px 14px rgba(80,104,141,.14)!important;transform:none!important}
#cc584-picker .cc584-searchwrap{position:relative!important;flex:none!important;padding:10px 12px 8px!important;background:#eceff3!important}
#cc584-picker .cc584-magnify{position:absolute!important;left:26px!important;top:19px!important;color:#7a8594!important;font-size:18px!important;pointer-events:none!important;font-family:'Segoe UI Symbol','Segoe UI',sans-serif!important}
#cc584-picker input.cc584-search{width:100%!important;height:44px!important;border:1px solid #d5dbe4!important;border-radius:22px!important;background:#fff!important;color:#243950!important;-webkit-text-fill-color:#243950!important;padding:0 14px 0 42px!important;font:600 14px 'Segoe UI',Arial,sans-serif!important;outline:none!important;box-shadow:0 2px 10px rgba(61,82,112,.06)!important;letter-spacing:0!important}
#cc584-picker input.cc584-search:focus{border-color:#6a92f7!important;box-shadow:0 0 0 3px rgba(93,137,226,.12)!important}
#cc584-picker input.cc584-search::placeholder{color:#7a8594!important;opacity:1!important}
#cc584-picker .cc584-scroll{flex:1 1 auto!important;min-height:0!important;overflow-y:auto!important;overflow-x:hidden!important;scrollbar-width:thin!important;scrollbar-color:#c2cad8 transparent!important;padding:2px 10px 16px!important;background:#eceff3!important}
#cc584-picker .cc584-title{font:700 13px 'Segoe UI',Arial,sans-serif!important;color:#667285!important;margin:10px 4px 8px!important;letter-spacing:.01em!important}
#cc584-picker .cc584-grid{display:grid!important;grid-template-columns:repeat(9,minmax(0,1fr))!important;gap:3px!important;justify-items:stretch!important}
#cc584-picker button.cc584-item{border:0!important;background:transparent!important;border-radius:12px!important;width:100%!important;min-width:0!important;height:48px!important;padding:0!important;display:flex!important;align-items:center!important;justify-content:center!important;font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif!important;font-size:31px!important;font-weight:400!important;line-height:1!important;box-shadow:none!important;cursor:pointer!important;opacity:1!important;transform:none!important;color:initial!important;-webkit-text-fill-color:initial!important}
#cc584-picker button.cc584-item:hover,#cc584-picker button.cc584-item:focus-visible{background:rgba(255,255,255,.92)!important;box-shadow:0 6px 16px rgba(75,113,188,.14)!important;transform:scale(1.05)!important;outline:none!important}
#cc584-picker .cc584-empty{padding:28px 10px!important;color:#536680!important;font:600 13px 'Segoe UI',Arial,sans-serif!important}
body.cc469-chat .cc469-emoji-toggle.cc584-trigger,body.cc474-chat .emojiToggle.cc584-trigger{color:#24426f!important;-webkit-text-fill-color:#24426f!important;background:linear-gradient(135deg,#ffffff,#eef4ff 65%,#f4f0ff)!important;font-size:21px!important;border:1px solid #c9d8f0!important;border-radius:14px!important;box-shadow:0 10px 22px rgba(52,81,139,.14),inset 0 1px 0 #fff!important}
@media(max-width:550px){#cc584-picker{width:min(480px,calc(100vw - 14px))!important;height:min(520px,calc(100dvh - 66px))!important}#cc584-picker .cc584-grid{grid-template-columns:repeat(8,minmax(0,1fr))!important}#cc584-picker button.cc584-item{height:45px!important;font-size:29px!important}}
@media(prefers-reduced-motion:reduce){#cc584-picker *{transition:none!important;animation:none!important}}
`;
    document.head.appendChild(s);
  }
  function position(){if(!overlay||!trigger)return;const r=trigger.getBoundingClientRect();const w=Math.min(520,innerWidth-18),h=Math.min(560,innerHeight-90);overlay.style.left=Math.max(7,Math.min(r.left-6,innerWidth-w-7))+'px';overlay.style.top=Math.max(8,Math.min(r.top-h-10,innerHeight-h-8))+'px';}
  function makeButton(emoji){const btn=createEl('button','cc584-item',emoji);btn.type='button';btn.setAttribute('aria-label',SEARCH_WORDS[emoji]?.split(' ').slice(0,4).join(' ')||emoji);btn.title=SEARCH_WORDS[emoji]||emoji;btn.addEventListener('click',()=>selectEmoji(emoji));return btn;}
  function appendSection(label,arr){if(!arr.length)return;const h=createEl('div','cc584-title',label);const grid=createEl('div','cc584-grid');arr.forEach(e=>grid.appendChild(makeButton(e)));results.append(h,grid);}
  function render(){ if(!results||!search)return; results.replaceChildren(); const q=search.value.trim().toLowerCase(); const match=e=>!q||e.toLowerCase().includes(q)||String(SEARCH_WORDS[e]||'').toLowerCase().includes(q); if(q){ let found=0; CATEGORY_DATA.slice(1).forEach(cat=>{ const arr=itemsFor(cat.id).filter(match); if(arr.length){ found+=arr.length; appendSection(cat.label,arr); }}); if(!found)results.appendChild(createEl('div','cc584-empty','No matching emoji found.')); } else if(category==='recent'){ appendSection('Recent',recent); appendSection('Smileys & People',itemsFor('smileys')); } else { const cat=CATEGORY_DATA.find(c=>c.id===category); appendSection(cat?.label||'Emoji',itemsFor(category)); } }
  function ensureOverlay(){ if(overlay) return; ensureStyles(); overlay=createEl('section'); overlay.id='cc584-picker'; overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-label','Emoji picker'); const tabs=createEl('div','cc584-tabs'); CATEGORY_DATA.forEach(cat=>{ const b=createEl('button','cc584-tab',cat.icon); b.type='button'; b.title=cat.label; b.setAttribute('aria-label',cat.label); b.dataset.cat=cat.id; b.addEventListener('click',()=>{ category=cat.id; search.value=''; tabs.querySelectorAll('button').forEach(x=>x.classList.toggle('is-active',x===b)); render(); }); tabs.appendChild(b); }); tabs.querySelector('button').classList.add('is-active'); const sw=createEl('div','cc584-searchwrap'); sw.appendChild(createEl('span','cc584-magnify','⌕')); search=createEl('input','cc584-search'); search.type='search'; search.placeholder='Search emoji'; search.setAttribute('aria-label','Search emoji'); search.addEventListener('input',render); sw.appendChild(search); results=createEl('div','cc584-scroll'); overlay.append(tabs,sw,results); }
  function activeTextarea(btn){ return btn?.closest('.composer')?.querySelector('.composeBox textarea') || document.querySelector('.chatMain .composer textarea'); }
  function selectEmoji(emoji){ const ta=focusInput?.isConnected?focusInput:activeTextarea(trigger); if(!ta){close(); return;} const old=ta.value||''; const start=typeof ta.selectionStart==='number'?ta.selectionStart:old.length; const end=typeof ta.selectionEnd==='number'?ta.selectionEnd:old.length; const next=old.slice(0,start)+emoji+old.slice(end); const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set; if(setter) setter.call(ta,next); else ta.value=next; try{ ta.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:emoji})); }catch(_){ ta.dispatchEvent(new Event('input',{bubbles:true})); } try{ ta.focus({preventScroll:true}); const pos=start+emoji.length; ta.setSelectionRange(pos,pos);}catch(_){} recordRecent(emoji); close(); }
  function close(){ if(overlay?.parentNode) overlay.remove(); if(trigger) trigger.setAttribute('aria-expanded','false'); overlay=null; search=null; results=null; focusInput=null; trigger=null; }
  function open(btn){ if(!isChat()) return; if(overlay){ close(); return; } trigger=btn; focusInput=activeTextarea(btn); category='recent'; recent=readRecent(); btn.setAttribute('aria-expanded','true'); ensureOverlay(); document.body.appendChild(overlay); position(); render(); try{ search.focus({preventScroll:true}); }catch(_){} }
  document.addEventListener('click',function(event){ const target=event.target instanceof Element?event.target:null; if(!target) return; const btn=target.closest('.cc469-emoji-toggle,.emojiToggle'); if(btn&&isChat()&&btn.closest('.composer')){ event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); btn.classList.add('cc584-trigger'); open(btn); return; } if(overlay&&!overlay.contains(target)){ close(); } },true);
  document.addEventListener('keydown',function(event){ if(event.key==='Escape'&&overlay){ close(); event.preventDefault(); } },true);
  window.addEventListener('resize',()=>{ if(overlay) position(); },{passive:true});
  window.addEventListener('popstate',()=>{ if(!isChat()) close(); });
  window.addEventListener('scroll',()=>{ if(overlay) position(); },true);
})();


;/* removed superseded runtime */

;(() => {
  const VERSION = 'CC26_384_GITHUB_BACKEND_UPLOAD_SAFE_SPLIT_FIX';
  if (window.__CC379_CONSOLIDATED_RUNTIME__ === VERSION) return;
  window.__CC379_CONSOLIDATED_RUNTIME__ = VERSION;

  const originalFetch = window.fetch.bind(window);
  const STYLE_ID = 'cc379-runtime-style';
  const BACKLOG_KEY = 'cc379_due_reminder_backlog';
  const LEGACY_BACKLOG_KEY = 'cc377_due_reminder_backlog';
  const DISMISSED_KEY = 'cc379_dismissed_reminder_keys';
  const SNOOZE_KEY = 'cc379_snoozed_reminder_map';
  const TIMER_KEY = 'cc379_stable_timer_state';
  const LEGACY_TIMER_KEY = 'cc376_attendance_timer_state';
  const REMINDER_CHECK_MS = 15 * 60 * 1000; // Local reminder clock continues without repeated database reads.
  const ATTENDANCE_CHECK_MS = 15 * 60 * 1000; // CC26_399: duplicate legacy attendance refresh reduced; React attendance tracking remains active
  const MAX_BACKLOG_AGE_MS = 14 * 24 * 60 * 60 * 1000;
  const DISMISSED_TTL_MS = 20 * 60 * 1000;
  let lastReminderCheckAt = 0;
  let reminderInFlight = null;
  let refreshAfterFlight = false;
  let reminderWriteTimer = null;
  let lastReminderRenderKey = "";
  let lastAttendanceCheckAt = 0;
  let reminderFetchStatus = 'No manual refresh in this session.';

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .cc361-reminder-panel,.cc362-reminder-dock,.cc364-reminder-stack,.cc365-reminder-stack,.cc366-reminder-stack,.cc367-reminder-rail,.cc376-reminder-rail,.cc377-reminder-rail,.cc378-reminder-deck{display:none!important}
      .cc379-reminder-deck{position:fixed;right:18px;bottom:18px;z-index:101300;width:min(342px,calc(100vw - 34px));font-family:Inter,system-ui,Segoe UI,Arial,sans-serif;pointer-events:none}
      .cc379-reminder-card{position:relative;overflow:hidden;border-radius:24px;padding:14px;color:#fff;border:1px solid rgba(255,255,255,.42);box-shadow:0 24px 65px rgba(15,23,42,.30);pointer-events:auto!important;min-height:158px}
      .cc379-reminder-card::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 88% 12%,rgba(255,255,255,.34),transparent 31%),linear-gradient(135deg,rgba(255,255,255,.14),rgba(255,255,255,0));pointer-events:none}
      .cc379-reminder-card.submission{background:linear-gradient(135deg,#7c3aed,#3b82f6)}
      .cc379-reminder-card.interview{background:linear-gradient(135deg,#fb923c,#ec4899)}
      .cc379-reminder-card.task{background:linear-gradient(135deg,#14b8a6,#22c55e)}
      .cc379-reminder-card.followups{background:linear-gradient(135deg,#f59e0b,#f97316)}
      .cc379-reminder-card.break{background:linear-gradient(135deg,#f97316,#ef4444)}
      .cc379-reminder-card.idle{background:linear-gradient(135deg,#6366f1,#a855f7)}
      .cc379-reminder-card.report{background:linear-gradient(135deg,#06b6d4,#2563eb)}
      .cc379-reminder-card.notification{background:linear-gradient(135deg,#ef4444,#db2777)}
      .cc379-reminder-card.generic{background:linear-gradient(135deg,#64748b,#334155)}
      .cc379-reminder-top{position:relative;display:flex;align-items:center;justify-content:space-between;gap:10px}.cc379-reminder-label{display:inline-flex;padding:6px 9px;border-radius:999px;background:rgba(255,255,255,.22);font-size:9px;font-weight:1000;text-transform:uppercase;letter-spacing:.06em}.cc379-reminder-count{display:inline-flex;padding:6px 9px;border-radius:999px;background:rgba(255,255,255,.92);color:#17345d;font-size:10px;font-weight:1000}
      .cc379-reminder-title{position:relative;margin-top:10px;font-size:16px;line-height:1.15;font-weight:1000;color:#fff;max-height:40px;overflow:hidden}.cc379-reminder-notes{position:relative;margin-top:10px;padding:10px;border-radius:15px;background:rgba(255,255,255,.92);color:#17233b;font-size:11px;line-height:1.38;font-weight:850;min-height:46px;max-height:72px;overflow:auto}.cc379-reminder-bottom{position:relative;display:flex;align-items:center;gap:8px;margin-top:10px}.cc379-reminder-time{flex:1;height:30px;border-radius:999px;background:rgba(255,255,255,.88);color:#17345d;font-size:10px;font-weight:1000;display:flex;align-items:center;justify-content:center;padding:0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cc379-reminder-open,.cc379-reminder-snooze,.cc379-reminder-close{height:32px;border:0;border-radius:12px;padding:0 11px;background:rgba(255,255,255,.94);color:#17345d;font-size:10.5px;font-weight:1000;cursor:pointer}.cc379-reminder-snooze{background:rgba(255,255,255,.24);color:#fff}.cc379-reminder-close{width:32px;padding:0;background:rgba(255,255,255,.20);color:#fff}
      .cc379-work-timer-pill{height:44px;min-width:188px;padding:0 15px;border-radius:18px;background:linear-gradient(135deg,#ffffff,#eff6ff 50%,#fff7ed);border:1px solid rgba(96,165,250,.38);box-shadow:0 14px 34px rgba(37,99,235,.15);display:flex!important;align-items:center;gap:11px;color:#10233f;position:relative;overflow:hidden}
      .cc379-work-timer-pill::after{content:"";position:absolute;right:-18px;bottom:-28px;width:86px;height:86px;border-radius:999px;background:rgba(59,130,246,.11)}
      .cc379-work-timer-dot{width:10px;height:10px;border-radius:999px;background:#22c55e;box-shadow:0 0 0 5px rgba(34,197,94,.13);position:relative;z-index:1}.cc379-work-timer-pill.break .cc379-work-timer-dot{background:#f97316;box-shadow:0 0 0 5px rgba(249,115,22,.13)}
      .cc379-work-timer-text{position:relative;z-index:1}.cc379-work-timer-label{font-size:9px;font-weight:1000;text-transform:uppercase;letter-spacing:.09em;color:#64748b;line-height:1}.cc379-work-timer-value{font-size:18px;font-weight:1000;letter-spacing:.02em;color:#10233f;line-height:1.08;margin-top:2px}.cc379-work-timer-sub{font-size:9.5px;font-weight:900;color:#64748b;line-height:1;margin-top:2px}
      .cc376-work-timer-pill,.cc378-work-timer-pill{display:none!important}
      .premium-minute-chip[data-cc379-five]{background:linear-gradient(135deg,#16a34a,#22c55e)!important;color:#fff!important}
      @media(max-width:760px){.cc379-reminder-deck{right:10px;bottom:12px;width:calc(100vw - 20px)}.cc379-work-timer-pill{min-width:150px;height:42px}.cc379-work-timer-value{font-size:16px}}
      /* CC26_611: Reminders is a local list, not a blind network refresh button. */
      #cc611-reminders-dialog[hidden]{display:none!important}
      #cc611-reminders-dialog{position:fixed;inset:0;z-index:110200;display:grid;place-items:center;padding:16px;font-family:'Plus Jakarta Sans',system-ui,'Segoe UI',sans-serif}
      .cc611-r-backdrop{position:absolute;inset:0;background:rgba(18,28,51,.45);backdrop-filter:blur(8px)}
      .cc611-r-modal{position:relative;display:flex;flex-direction:column;max-height:min(82vh,740px);width:min(660px,100%);overflow:hidden;border-radius:26px;background:linear-gradient(145deg,#fff,#f7f9ff 65%,#effdf5);box-shadow:0 26px 95px rgba(20,34,75,.34);border:1px solid rgba(255,255,255,.95);color:#14213e}
      .cc611-r-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:22px 22px 15px;border-bottom:1px solid #e8eef8}
      .cc611-r-kicker{font-size:11px;color:#208a65;font-weight:900;letter-spacing:.12em;text-transform:uppercase}
      .cc611-r-title{margin:5px 0 6px;font-size:27px;line-height:1.15;font-weight:900;color:#172849}
      .cc611-r-desc{margin:0;color:#526585;font-size:13px;line-height:1.5;font-weight:600}
      .cc611-r-close{border:1px solid #dce7f4;background:#fff;color:#22385b;cursor:pointer;border-radius:13px;min-width:42px;height:42px;font-size:24px;font-weight:700}
      .cc611-r-controls{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:14px 22px}
      .cc611-r-count{font-size:13px;font-weight:850;color:#2d4569}
      .cc611-r-refresh{border:1px solid #9cdabe;background:linear-gradient(135deg,#ddfbe9,#e8f9ff);color:#176347;cursor:pointer;border-radius:13px;min-height:39px;padding:8px 16px;font-size:13px;font-weight:900}
      .cc611-r-refresh:hover{background:linear-gradient(135deg,#a4f1c8,#cff9dc)}
      .cc611-r-refresh:disabled{opacity:.6;cursor:wait}
      .cc611-r-status{margin:0;padding:0 22px 10px;font-size:12px;min-height:27px;color:#647592}
      .cc611-r-list{overflow:auto;min-height:110px;padding:2px 18px 18px;overscroll-behavior:contain}
      .cc611-r-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;padding:35px 16px;border:1px dashed #c5d9ed;border-radius:18px;background:rgba(255,255,255,.8);color:#526585}
      .cc611-r-empty strong{font-size:18px;color:#172849}
      .cc611-r-card{background:#fff;border:1px solid #e4edf8;border-radius:17px;padding:15px;margin:8px 0;box-shadow:0 8px 19px rgba(30,64,125,.05)}
      .cc611-r-card-top{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px}
      .cc611-r-type{display:inline-flex;border-radius:100px;padding:5px 10px;background:linear-gradient(135deg,#e5f7ff,#e9e9ff);font-size:10px;font-weight:900;letter-spacing:.04em;color:#284d87}
      .cc611-r-type.task{background:#dcfce7;color:#166534}.cc611-r-type.interview{background:#ffedd5;color:#9a3412}.cc611-r-type.followups{background:#fef9c3;color:#854d0e}.cc611-r-type.submission{background:#f3e8ff;color:#6b21a8}
      .cc611-r-when{font-size:11px;font-weight:800;color:#657894}
      .cc611-r-card-title{font-size:16px;line-height:1.4;font-weight:900;color:#172849;margin-bottom:5px;overflow-wrap:anywhere}
      .cc611-r-card-note{font-size:12px;line-height:1.5;color:#435677;white-space:pre-wrap;overflow-wrap:anywhere;max-height:110px;overflow:auto}
      .cc611-r-card-actions{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:13px}
      .cc611-r-action{border:none;border-radius:10px;min-height:34px;padding:7px 12px;font-size:12px;font-weight:850;cursor:pointer;background:#e8effa;color:#2b4675}
      .cc611-r-action.open{background:linear-gradient(135deg,#d1fae5,#abedcb);color:#11603c}
      .cc611-r-action.snooze{background:#fff0d6;color:#805008}
      .cc611-r-footer{padding:10px 22px 17px;border-top:1px solid #ebeff9;color:#69809e;font-size:11px;font-weight:700}
      @media(max-width:560px){.cc611-r-modal{max-height:90vh;border-radius:19px}.cc611-r-head{padding:17px}.cc611-r-title{font-size:23px}.cc611-r-controls{padding:12px 17px}.cc611-r-list{padding:2px 12px 12px}}

    `;
    document.head.appendChild(style);
  }

  function nowMs() { return Date.now(); }
  function parseMs(value) { const t = Date.parse(String(value || '')); return Number.isFinite(t) ? t : 0; }
  function pad(n) { return String(Math.max(0, Math.floor(n))).padStart(2, '0'); }
  function fmt(seconds) { const s = Math.max(0, Math.floor(seconds || 0)); return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`; }
  function safeText(value) { return String(value || '').replace(/[<>&]/g, '').replace(/\s+/g, ' ').trim(); }
  function reminderStateKey(key){if(!/reminder|backlog/.test(key))return key;let user={};try{user=JSON.parse(localStorage.getItem('careerCroxCachedUser')||'{}');}catch{}return key+':cc875:'+String(user.user_id||'signed-out')+':'+(window.__CC875_DASHBOARD_KEY__?.()||'overview')+':'+(window.__CC875_POPUP_SETTINGS__?.().managerTeamPopups===false?'own':'team');}
  function readJson(key, fallback) { try { const value = JSON.parse(localStorage.getItem(reminderStateKey(key)) || ''); return value ?? fallback; } catch { return fallback; } }
  function writeJson(key, value) { try { localStorage.setItem(reminderStateKey(key), JSON.stringify(value)); } catch {} }
  function readBacklog() {
    const latest = readJson(BACKLOG_KEY, []);
    return Array.isArray(latest) ? latest : [];
  }
  function saveBacklog(rows) {
    writeJson(BACKLOG_KEY, rows);
    if (typeof renderReminderDialog === 'function') renderReminderDialog();
    // Compact reminder UI can consume the same local snapshot without a second request.
    try { window.dispatchEvent(new Event('career-crox-reminder-backlog-updated')); } catch {}
  }

  // CC26_611: List opens from local cache without a database/API read.
  // Refresh Now is the only network operation initiated by this dialog.
  function ensureReminderDialog() {
    let dialog = document.getElementById('cc611-reminders-dialog');
    if (dialog) return dialog;
    dialog = document.createElement('div');
    dialog.id = 'cc611-reminders-dialog';
    dialog.hidden = true;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'cc611-reminders-title');
    dialog.innerHTML = `<div class="cc611-r-backdrop" data-reminder-close></div>
      <section class="cc611-r-modal" aria-label="Reminders list">
        <header class="cc611-r-head"><div><div class="cc611-r-kicker">Your reminder workspace</div>
          <h2 class="cc611-r-title" id="cc611-reminders-title">Reminders</h2>
          <p class="cc611-r-desc">Choose a category to review what needs your attention.</p></div>
          <button type="button" class="cc611-r-close" data-reminder-close aria-label="Close reminders">×</button></header>
        <div class="cc611-r-controls"><span id="cc611-reminder-count" class="cc611-r-count">Saved reminders</span>
          <button type="button" class="cc611-r-refresh" id="cc611-refresh-now">↻ Refresh Now</button></div>
        <div id="cc875-reminder-categories" class="cc875-reminder-categories" role="group" aria-label="Reminder categories"></div><label class="cc875-reminder-search"><span>Search reminders</span><input id="cc875-reminder-search" type="search" placeholder="Candidate, task or note…"/></label><p id="cc611-reminder-status" class="cc611-r-status" role="status">Choose a category to get started.</p>
        <div class="cc611-r-list" id="cc611-reminder-list"></div>
        <footer class="cc611-r-footer">Closing a popup keeps the reminder here. Open it, snooze it or dismiss it when finished.</footer>
      </section>`;
    dialog.addEventListener('click', (event) => {
      if (event.target.closest('[data-reminder-close]')) closeReminderDialog();
    });
    document.body.appendChild(dialog);
    dialog.querySelector('#cc875-reminder-search').addEventListener('input',renderReminderDialog);
    dialog.querySelector('#cc611-refresh-now').addEventListener('click', async () => {
      if (window.__CC602_NETWORK_PAUSED__ || location.pathname.includes('/login')) return;
      const refresh = dialog.querySelector('#cc611-refresh-now');
      if (refresh.disabled) return;
      refresh.disabled = true;
      const status = dialog.querySelector('#cc611-reminder-status');
      status.textContent = 'Checking for updated reminders…';
      try {
        // Reuse the existing in-flight promise: never queue a second expensive table summary.
        if (reminderInFlight) await reminderInFlight;
        else await refreshReminders(true);
        status.textContent = reminderFetchStatus || 'Check finished. Saved reminders are shown below.';
      } finally {
        refresh.disabled = false;
        renderReminderDialog();
      }
    });
    return dialog;
  }
  window.addEventListener('cc875-dashboard-changed',()=>{activeReminderCategory='all';renderReminderDialog();});
  function closeReminderDialog() {
    const dialog = document.getElementById('cc611-reminders-dialog');
    if (dialog) dialog.hidden = true;
    const btn = document.getElementById('cc603-reminders-refresh');
    if (btn) {btn.setAttribute('aria-expanded', 'false');try{btn.focus({preventScroll:true});}catch{}}
  }
  function reminderSafePath(path) {
    const val = String(path || '/tasks').trim();
    return val.startsWith('/') && !val.startsWith('//') && !val.includes('\\') ? val : '/tasks';
  }
  let activeReminderCategory='all';
  function reminderCategory(item){const t=typeFor(item);return /follow/.test(t)?'followups':/interview|feedback/.test(t)?'interview':/submission|approval|details/.test(t)?'submission':t;}
  function renderReminderDialog() {
    const dialog = document.getElementById('cc611-reminders-dialog');
    if (!dialog || dialog.hidden) return;
    const list = dialog.querySelector('#cc611-reminder-list');
    const dismissed = readDismissedMap(), snoozed = readSnoozedMap();
    const all = readBacklog().filter((item) => item && !dismissed[keyOf(item)]);
    all.sort((a,b)=>dueMs(a)-dueMs(b));
    const pending = all.filter(item => !(Number(snoozed[keyOf(item)] || 0) > nowMs()));
    const paused = all.length - pending.length;
    dialog.querySelector('#cc611-reminder-count').textContent = `${pending.length} reminders${paused ? ` · ${paused} snoozed` : ''}`;
    const categories=[['all','All'],['followups','Follow-ups'],['interview','Interviews & feedback'],['submission','Submissions & approvals'],['task','Tasks'],['report','Reports'],['notification','Updates'],['other','Other']];
    const known=new Set(categories.map(c=>c[0]));const categoryFor=item=>known.has(reminderCategory(item))?reminderCategory(item):'other';
    const nav=dialog.querySelector('#cc875-reminder-categories');nav.replaceChildren();for(const [id,label]of categories){const count=id==='all'?all.length:all.filter(x=>categoryFor(x)===id).length;const btn=document.createElement('button');btn.type='button';btn.className='cc875-category '+id;btn.setAttribute('aria-pressed',String(activeReminderCategory===id));btn.textContent=label+' · '+count;btn.onclick=()=>{activeReminderCategory=id;renderReminderDialog();};nav.appendChild(btn);}
    const term=String(dialog.querySelector('#cc875-reminder-search').value||'').trim().toLowerCase();const filtered=all.filter(x=>(activeReminderCategory==='all'||categoryFor(x)===activeReminderCategory)&&(!term||[x.title,x.message,x.owner_label,x.recruiter_name].join(' ').toLowerCase().includes(term)));
    dialog.querySelector('#cc611-reminder-count').textContent=filtered.length+' shown · '+all.length+' saved'+(paused?' · '+paused+' snoozed':'');
    list.replaceChildren();
    if (!filtered.length) {
      const box = document.createElement('div');box.className='cc611-r-empty';
      const title=document.createElement('strong');title.textContent=all.length?'No reminders match this category':'No saved reminders';
      const text=document.createElement('span');text.textContent='Select Refresh Now to check for new reminders.';
      box.append(title,text);list.appendChild(box);return;
    }
    for (const item of filtered) {
      const key = keyOf(item), type = typeFor(item);
      const snoozeUntil=Number(snoozed[key] || 0), isSnoozed=snoozeUntil > nowMs();
      const card = document.createElement('article'); card.className='cc611-r-card';
      const top=document.createElement('div');top.className='cc611-r-card-top';
      const badge=document.createElement('span');badge.className='cc611-r-type '+type;badge.textContent=labelFor(type);
      const when=document.createElement('span');when.className='cc611-r-when';when.textContent = isSnoozed ? 'Snoozed until '+new Date(snoozeUntil).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : (dueMs(item) <= nowMs() ? 'Due · ' : 'Upcoming · ')+formatDue(item);
      top.append(badge,when);
      const title=document.createElement('div');title.className='cc611-r-card-title';title.textContent=item.title||labelFor(type);
      const notes=document.createElement('div');notes.className='cc611-r-card-note';notes.textContent=item.message||'No additional notes.';
      const actions=document.createElement('div');actions.className='cc611-r-card-actions';
      const open=document.createElement('button');open.type='button';open.className='cc611-r-action open';open.textContent='Open';
      open.onclick=()=>{const path=reminderSafePath(/follow/i.test(item.type||'')&&item.candidate_id?'/candidate/'+encodeURIComponent(String(item.candidate_id)):item.open_path);closeReminderDialog();window.location.assign(path);};
      const snoozeButton=document.createElement('button');snoozeButton.type='button';snoozeButton.className='cc611-r-action snooze';snoozeButton.textContent=isSnoozed?'Snoozed':'Snooze 5m';snoozeButton.disabled=isSnoozed;
      snoozeButton.onclick=()=>{snooze(key);renderReminderDialog();};
      const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='cc611-r-action';dismiss.textContent='Dismiss';
      dismiss.onclick=()=>{softDismiss(key);renderReminderDialog();};
      actions.append(open,snoozeButton,dismiss);card.append(top,title,notes,actions);list.appendChild(card);
    }

  }
  function openReminderDialog() {
    if (window.__CC602_NETWORK_PAUSED__ || location.pathname.includes('/login')) return;
    const dialog = ensureReminderDialog();dialog.hidden=false;
    document.getElementById('cc603-reminders-refresh')?.setAttribute('aria-expanded','true');
    dialog.querySelector('#cc611-reminder-status').textContent='Choose a category or search your reminders.';
    renderReminderDialog();
    try { dialog.querySelector('#cc611-refresh-now').focus({preventScroll:true}); }catch{}
  }
  document.addEventListener('keydown', (event) => {if(event.key==='Escape' && !document.getElementById('cc611-reminders-dialog')?.hidden)closeReminderDialog();});

  function readDismissedMap() { const obj = readJson(DISMISSED_KEY, {}); return obj && typeof obj === 'object' ? obj : {}; }
  function saveDismissedMap(obj) { writeJson(DISMISSED_KEY, obj); }
  function readSnoozedMap() { const obj = readJson(SNOOZE_KEY, {}); return obj && typeof obj === 'object' ? obj : {}; }
  function saveSnoozedMap(obj) { writeJson(SNOOZE_KEY, obj); }
  function keyOf(item = {}) {
    return safeText(item.key || `${item.type || 'reminder'}:${item.candidate_id || item.task_id || item.notification_id || item.submission_id || item.interview_id || item.title || ''}`);
  }
  function dueMs(item = {}) { return parseMs(item.due_at || item.created_at || item.updated_at) || nowMs(); }
  function cleanDismissed() {
    const obj = readDismissedMap();
    const next = {};
    Object.entries(obj).forEach(([key, at]) => { if (nowMs() - Number(at || 0) < DISMISSED_TTL_MS) next[key] = at; });
    saveDismissedMap(next);
    return next;
  }
  function isDue(item = {}) {
    const key = keyOf(item);
    const snoozeUntil = Number(readSnoozedMap()[key] || 0);
    return dueMs(item) <= nowMs() && (!snoozeUntil || snoozeUntil <= nowMs());
  }
  function typeFor(item = {}) {
    const text = `${item.type || ''} ${item.key || ''} ${item.title || ''} ${item.message || ''}`.toLowerCase();
    if (text.includes('submission')) return 'submission';
    if (text.includes('interview')) return 'interview';
    if (text.includes('task')) return 'task';
    if (text.includes('follow')) return 'followups';
    if (text.includes('break')) return 'break';
    if (text.includes('idle') || text.includes('activity')) return 'idle';
    if (text.includes('notification')) return 'notification';
    if (text.includes('30') || text.includes('semi') || text.includes('report')) return 'report';
    return 'generic';
  }
  function labelFor(type) {
    return ({submission:'Submission Reminder', interview:'Interview Reminder', task:'Task Reminder', followups:'Follow-up Reminder', break:'Break Reminder', idle:'Activity Reminder', report:'30-Min Report', notification:'Notification', generic:'CRM Reminder'})[type] || 'CRM Reminder';
  }
  function mergeBacklog(actions = []) {
    const map = new Map();
    (Array.isArray(actions) ? actions : []).forEach((item) => {
      const key = keyOf(item);
      if (!key) return;
      map.set(key, { ...item, key });
    });
    const rows = Array.from(map.values()).sort((a, b) => dueMs(a) - dueMs(b));
    saveBacklog(rows);
    return rows;
  }
  function dueRows() {
    const dismissed = cleanDismissed();
    return readBacklog()
      .filter((item) => !dismissed[keyOf(item)])
      .filter(isDue)
      .sort((a, b) => dueMs(a) - dueMs(b));
  }
  function formatDue(item = {}) {
    try { return new Date(dueMs(item)).toLocaleString([], { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }); } catch { return 'Due now'; }
  }
  function ensureDeck() {
    installStyle();
    document.querySelectorAll('.cc377-reminder-rail,.cc376-reminder-rail,.cc378-reminder-deck,.cc361-reminder-panel,.cc362-reminder-dock').forEach((el) => el.remove());
    let deck = document.querySelector('.cc379-reminder-deck');
    if (!deck) {
      deck = document.createElement('div');
      deck.className = 'cc379-reminder-deck';
      document.body.appendChild(deck);
    }
    return deck;
  }
  function renderSingleReminder() {
    if (window.__CC730_DIRECT_REMINDER_OWNER__) { const old=document.querySelector('.cc379-reminder-deck'); if(old) old.innerHTML=''; return; }
    if (location.pathname.includes('/login')) return;
    const deck = ensureDeck();
    const rows = dueRows();
    if (!rows.length) { deck.innerHTML = ''; return; }
    const item = rows[0];
    const type = typeFor(item);
    const key = keyOf(item);
    const title = safeText(String(item.title || labelFor(type)).replace(/^Submission Reminder:\s*/i, ''));
    const msg = safeText(item.message || 'Reminder needs action.');
    const open = safeText(item.open_path || '/reports');
    deck.innerHTML = `<div class="cc379-reminder-card ${type}" data-key="${key}">
      <div class="cc379-reminder-top"><div class="cc379-reminder-label">${labelFor(type)}</div><div class="cc379-reminder-count">1 of ${rows.length} • ${rows.length} pending</div></div>
      <div class="cc379-reminder-title">${title}</div>
      <div class="cc379-reminder-notes"><b>LAST NOTES</b><br>${msg}</div>
      <div class="cc379-reminder-bottom"><div class="cc379-reminder-time">Due ${formatDue(item)}</div><button type="button" class="cc379-reminder-open" data-open="${open}">Open</button><button type="button" class="cc379-reminder-snooze">Snooze</button><button type="button" class="cc379-reminder-close">×</button></div>
    </div>`;
  }
  function softDismiss(key) {
    const dismissed = cleanDismissed();
    dismissed[key] = nowMs();
    saveDismissedMap(dismissed);
    saveBacklog(readBacklog().filter((item) => keyOf(item) !== key));
    renderSingleReminder();
  }
  function snooze(key) {
    const obj = readSnoozedMap();
    obj[key] = nowMs() + 5 * 60 * 1000;
    saveSnoozedMap(obj);
    renderSingleReminder();
  }

  document.addEventListener('click', (event) => {
    const card = event.target.closest && event.target.closest('.cc379-reminder-card');
    if (!card) return;
    const key = card.getAttribute('data-key') || '';
    if (event.target.closest('.cc379-reminder-open')) {
      event.preventDefault();
      event.stopPropagation();
      const open = event.target.closest('.cc379-reminder-open').getAttribute('data-open') || '/reports';
      window.open(open, '_blank', 'noopener,noreferrer');
      softDismiss(key);
      return;
    }
    if (event.target.closest('.cc379-reminder-snooze')) {
      event.preventDefault();
      event.stopPropagation();
      snooze(key);
      return;
    }
    if (event.target.closest('.cc379-reminder-close')) {
      event.preventDefault();
      event.stopPropagation();
      softDismiss(key);
    }
  }, true);

  async function refreshReminders(force = false) {
    if (window.__CC730_DIRECT_REMINDER_OWNER__) { if (typeof window.__CC730_REFRESH_REMINDERS__ === 'function') return window.__CC730_REFRESH_REMINDERS__(force); return; }
    if (location.pathname.includes('/login')) return;
    // One flight for simultaneous writes and refreshes; browser popup clock is fully local.
    if (reminderInFlight) {
      if (force) refreshAfterFlight = true; // Save happened while a snapshot was loading.
      return reminderInFlight;
    }
    if (!force && lastReminderCheckAt && nowMs() - lastReminderCheckAt < REMINDER_CHECK_MS - 1000) {
      renderSingleReminder();
      return;
    }
    lastReminderCheckAt = nowMs();
    reminderInFlight = (async () => {
      try {
        const res = await originalFetch('/api/reports/reminder-summary', { credentials:'include', cache:'no-store', headers:{Accept:'application/json','X-Career-Crox-Background':'1'} });
        if (res.ok) {
          const payload = await res.json().catch(() => null);
          if (payload?.ok) { mergeBacklog(Array.isArray(payload.actions) ? payload.actions : []);reminderFetchStatus='Updated just now.'; }
          else reminderFetchStatus='Could not update. Showing last saved reminders.';
        } else if (res.status === 401 || res.status === 403) {
          // A previous employee's reminder list must never show after logout/account switch.
          saveBacklog([]);
          reminderFetchStatus='Sign in again to check reminders.';
        } else reminderFetchStatus='Could not refresh right now. Saved reminders are still visible.';
      } catch {reminderFetchStatus='Connection unavailable. Showing last saved reminders.';} // Keep the last known reminders visible when offline.
      finally {
        reminderInFlight = null;
        renderSingleReminder();
        if (refreshAfterFlight) {
          refreshAfterFlight = false;
          setTimeout(() => refreshReminders(true), 0);
        }
      }
    })();
    return reminderInFlight;
  }

  function readTimer() { return { ...readJson(LEGACY_TIMER_KEY, {}), ...readJson(TIMER_KEY, {}) }; }
  function writeTimer(patch) { writeJson(TIMER_KEY, { ...readTimer(), ...patch, updated_at: nowMs() }); }
  function timerState() {
    const s = readTimer();
    const start = parseMs(s.work_started_at || s.joined_at);
    if (!start) {
      const fallbackStart = s.local_work_started_at || new Date().toISOString();
      writeTimer({ local_work_started_at: fallbackStart, work_started_at: fallbackStart, total_break_seconds: Number(s.total_break_seconds || 0) || 0, is_on_break: s.is_on_break || '0' });
      return readTimer();
    }
    return s;
  }
  function timerSeconds(s = timerState()) {
    const start = parseMs(s.work_started_at || s.local_work_started_at || s.joined_at);
    if (!start) return 0;
    const totalBreak = Math.max(0, Number(s.total_break_seconds || 0) || 0);
    if (String(s.is_on_break || '0') === '1') return Math.max(0, Number(s.frozen_work_seconds || 0) || 0);
    return Math.max(0, Math.floor((nowMs() - start) / 1000) - totalBreak);
  }
  function updateFromPresence(p = {}, stats = {}) {
    if (!p || typeof p !== 'object') return;
    const current = timerState();
    const serverStart = p.work_started_at || p.joined_at || current.work_started_at || current.local_work_started_at;
    const onBreak = String(p.is_on_break || '0') === '1';
    const serverBreakSeconds = Math.max(0, Number(p.total_break_seconds || 0) || 0);
    const serverBreakMinutes = Math.max(0, Number(p.total_break_minutes || stats.total_break_minutes || 0) || 0) * 60;
    const totalBreak = Math.max(Number(current.total_break_seconds || 0) || 0, serverBreakSeconds, serverBreakMinutes);
    const next = { ...current, work_started_at: serverStart, is_on_break: onBreak ? '1' : '0', total_break_seconds: totalBreak };
    if (onBreak) {
      if (!next.break_started_at) next.break_started_at = p.break_started_at || new Date().toISOString();
      if (!next.frozen_work_seconds) next.frozen_work_seconds = timerSeconds({ ...next, is_on_break:'0' });
    } else {
      next.break_started_at = '';
      next.frozen_work_seconds = 0;
    }
    writeTimer(next);
  }
  async function refreshAttendance(force = false) { return; }
  function ensureTimerPill() {
    // CC26_462: legacy CC379 timer is permanently retired. CC456 owns the single topbar timer.
    document.querySelectorAll('.cc379-work-timer-pill,.cc376-work-timer-pill,.cc378-work-timer-pill').forEach((el) => { try { el.remove(); } catch {} });
    return null;
  }
  function addFiveMinutePreset() {
    // React renders its own real 5m button. Only remove old DOM clones; never make a fake button.
    const row = document.querySelector('.premium-minute-row');
    if (!row) return;
    row.querySelectorAll('[data-cc379-five]').forEach((duplicate) => duplicate.remove());
  }

  document.addEventListener('click', (event) => {
    const btn = event.target && event.target.closest ? event.target.closest('button') : null;
    if (!btn) return;
    const text = (btn.textContent || '').trim();
    if (/^Start Break$/i.test(text)) {
      const current = timerState();
      const frozen = timerSeconds({ ...current, is_on_break:'0' });
      const now = new Date().toISOString();
      writeTimer({ ...current, is_on_break:'1', break_started_at: now, frozen_work_seconds: frozen });
      setTimeout(ensureTimerPill, 20);
    }
    if (/^End Break$/i.test(text)) {
      const current = timerState();
      const started = parseMs(current.break_started_at);
      const used = started ? Math.max(0, Math.floor((nowMs() - started) / 1000)) : 0;
      writeTimer({ ...current, is_on_break:'0', break_started_at:'', frozen_work_seconds:0, total_break_seconds: Math.max(0, Number(current.total_break_seconds || 0) || 0) + used });
      setTimeout(ensureTimerPill, 20);
    }
  }, true);

  function cc765ReminderWriteRelevant(url, method, input, options = {}) {
    if (['GET','HEAD','OPTIONS'].includes(String(method || '').toUpperCase())) return false;
    const path = String(url || '');
    if (/\/api\/(submissions|interviews|followups|tasks|approvals)(?:\/|\?|$)/i.test(path)) return true;
    if (/\/api\/reports\/semi-hourly(?:\/|\?|$)/i.test(path)) return true;
    if (!/\/api\/candidates(?:\/|\?|$)/i.test(path)) return false;
    if (/\/(submit|delete|restore|revive|remove-interview-date)(?:\/|\?|$)/i.test(path)) return true;
    let body = options && options.body;
    if (!body && input && typeof input === 'object') body = input.body;
    if (typeof body !== 'string') return false;
    let payload = null;
    try { payload = JSON.parse(body); } catch { return false; }
    if (!payload || typeof payload !== 'object') return false;
    const reminderKey = (key) => /^(follow_up_at|next_follow_up_at|followup_date|follow_up_date|callback_at|interview_date|interview_reschedule_date|scheduled_at|approval_status|all_details_sent|submission_date|submitted_at|due_date|due_at|reminder_at|status)$/.test(String(key || '').toLowerCase());
    const changed = Array.isArray(payload._changed_fields) ? payload._changed_fields.map((key) => String(key || '').toLowerCase()).filter(Boolean) : [];
    if (changed.length) return changed.some(reminderKey);
    const keys = Object.keys(payload).map((key) => String(key).toLowerCase()).filter((key) => key !== '_changed_fields');
    return keys.some(reminderKey);
  }

  window.fetch = async function cc379Fetch(input, options = {}) {
    const scopeAtStart=window.__CC875_DASHBOARD_KEY__?.()||'overview',epochAtStart=window.__CC875_SCOPE_EPOCH__?.()||0;
    const res = await originalFetch(input, options);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.includes('/api/reports/reminder-summary')) {
        res.clone().json().then((payload) => {
          if (payload?.ok && epochAtStart===(window.__CC875_SCOPE_EPOCH__?.()||0) && scopeAtStart===(window.__CC875_DASHBOARD_KEY__?.()||'overview')) {
            mergeBacklog(Array.isArray(payload.actions) ? payload.actions : []);
            renderSingleReminder();
          }
        }).catch(() => {});
      }
      // CC26_765: read-only page loads never trigger reminder reads. A successful
      // reminder-relevant write emits one local signal; CC730 then performs one
      // consolidated refresh. This fixes same-user submit -> +5m reminder without polling.
      const method = String(options?.method || (input && input.method) || 'GET').toUpperCase();
      if (res.ok && cc765ReminderWriteRelevant(url, method, input, options)) {
        try { window.dispatchEvent(new CustomEvent('career-crox-data-written', { detail:{ path:String(url || ''), method, at:Date.now() } })); } catch {}
        if (!window.__CC730_DIRECT_REMINDER_OWNER__) {
          if (reminderWriteTimer) clearTimeout(reminderWriteTimer);
          reminderWriteTimer = setTimeout(() => { reminderWriteTimer = null; refreshReminders(true); }, 900);
        }
      }
    } catch {}
    return res;
  };

  installStyle();
  try { localStorage.removeItem(LEGACY_BACKLOG_KEY); } catch {}
  window.addEventListener('career-crox-work-timer-reset', () => { try { localStorage.removeItem(TIMER_KEY); localStorage.removeItem(LEGACY_TIMER_KEY); } catch {} setTimeout(ensureTimerPill, 20); });
  // CC26_603: data snapshots are fetched once at login, after the relevant user WRITE,
  // or when the user explicitly clicks Refresh Reminders. No unattended 15-minute fetch.
  const manualReminderButton = () => {
    if (window.__CC602_NETWORK_PAUSED__ || location.pathname.includes('/login')) return;
    const host = document.querySelector('.topbar-right');
    if (!host || host.querySelector('#cc603-reminders-refresh')) return;
    const button = document.createElement('button');button.id='cc603-reminders-refresh';button.type='button';
    button.className='ghost-btn bounceable';button.textContent='Reminders';
    button.style.cssText='font-size:12px;white-space:nowrap;flex:0 0 auto;padding:9px 12px;font-weight:850';
    button.title='Open your saved reminders instantly (Refresh Now is inside)';
    button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-controls','cc611-reminders-dialog');button.setAttribute('aria-expanded','false');
    button.addEventListener('click', openReminderDialog);
    host.appendChild(button);
  };
  setTimeout(() => { ensureTimerPill(); addFiveMinutePreset();manualReminderButton(); if(!window.__CC730_DIRECT_REMINDER_OWNER__) refreshReminders(true); }, 1200);
  const pillTimer=setInterval(() => {ensureTimerPill();manualReminderButton();}, 2500);
  // Cached reminders remain displayed by a local clock, with zero network reads.
  const localReminderTimer=setInterval(renderSingleReminder, 15 * 1000);
  window.addEventListener('focus', renderSingleReminder);
  window.addEventListener('career-crox-idle-lock-begin',()=>{clearInterval(pillTimer);clearInterval(localReminderTimer);if(reminderWriteTimer)clearTimeout(reminderWriteTimer);closeReminderDialog();document.getElementById('cc611-reminders-dialog')?.remove();document.getElementById('cc603-reminders-refresh')?.remove();},{once:true});
})();



/* CC26_388 compact smart reminder runtime: source parity with frontend/src/lib/compactReminderRuntime.js */
;(() => {
const VERSION = 'CC26_388_COMPACT_SMART_REMINDER_FINAL';
const STYLE_ID = 'cc388-compact-reminder-style';
const BACKLOG_KEY = 'cc388_due_reminder_backlog';
const SNOOZE_KEY = 'cc388_snoozed_reminder_map';
const REFRESH_MS = 15 * 60 * 1000;

function readJson(key, fallback) {
  try { const value = JSON.parse(localStorage.getItem(key) || ''); return value ?? fallback; } catch { return fallback; }
}
function writeJson(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }
function cleanText(value) { return String(value || '').replace(/[<>&]/g, '').replace(/\s+/g, ' ').trim(); }
function keyOf(item = {}) { return cleanText(item.key || `${item.type || 'reminder'}:${item.candidate_id || item.task_id || item.notification_id || item.submission_id || item.interview_id || item.title || ''}`); }
function parseMs(value) { const t = Date.parse(String(value || '')); return Number.isFinite(t) ? t : 0; }
function typeFor(item = {}) {
  const text = `${item.type || ''} ${item.key || ''} ${item.title || ''}`.toLowerCase();
  if (text.includes('submission')) return 'submission';
  if (text.includes('interview')) return 'interview';
  if (text.includes('follow')) return 'followups';
  if (text.includes('task')) return 'task';
  if (text.includes('break')) return 'break';
  if (text.includes('report') || text.includes('semi')) return 'report';
  if (text.includes('notification')) return 'notification';
  if (text.includes('idle') || text.includes('activity')) return 'idle';
  return 'generic';
}
function labelFor(type) {
  return ({ submission: 'Submission Reminder', interview: 'Interview Reminder', followups: 'Follow-up Reminder', task: 'Task Reminder', break: 'Break Reminder', report: 'Report Reminder', notification: 'Notification', idle: 'Activity Reminder', generic: 'CRM Reminder' })[type] || 'CRM Reminder';
}
function repeatMinutes(item = {}) { const type = typeFor(item); return Number(item.repeat_minutes || (type === 'submission' ? 10 : type === 'interview' ? 10 : 20)); }
function istDateKey(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const get = (type) => parts.find((part) => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch { return new Date(date.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10); }
}

function installStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .cc383-reminder-deck,.cc379-reminder-deck,.cc378-reminder-deck,.cc377-reminder-rail,.global-submission-reminder-wrap{display:none!important;visibility:hidden!important;pointer-events:none!important}
    .cc388-reminder-deck{position:fixed;right:14px;bottom:14px;z-index:102500;width:min(292px,calc(100vw - 24px));font-family:Roboto,"Segoe UI",Arial,sans-serif;pointer-events:none}
    .cc388-card{position:relative;pointer-events:auto;border-radius:19px;padding:10px;color:#fff;border:1px solid rgba(255,255,255,.58);box-shadow:0 20px 44px rgba(15,23,42,.28),inset 0 1px 0 rgba(255,255,255,.25);overflow:hidden;cursor:pointer;backdrop-filter:blur(14px);transition:transform .16s ease,box-shadow .16s ease;font-family:Roboto,"Segoe UI",Arial,sans-serif}.cc388-card:hover{transform:translateY(-2px);box-shadow:0 28px 58px rgba(15,23,42,.34),inset 0 1px 0 rgba(255,255,255,.3)}
    .cc388-card.interview{background:linear-gradient(135deg,#ff8a3d,#ff5f76 58%,#e9328b)}
    .cc388-card.submission{background:linear-gradient(135deg,#6657e8,#357ded 55%,#12abc5)}
    .cc388-card.task{background:linear-gradient(135deg,#10a978,#16a89d,#367eea)}
    .cc388-card.followups{background:linear-gradient(135deg,#e99a16,#f66c1d,#e64242)}
    .cc388-card.break{background:linear-gradient(135deg,#ef7c21,#e94444,#b91c4b)}
    .cc388-card.report{background:linear-gradient(135deg,#07a7c3,#2563cf,#7244d7)}
    .cc388-card.notification{background:linear-gradient(135deg,#e74444,#ce2e79,#7342ca)}
    .cc388-card.idle,.cc388-card.generic{background:linear-gradient(135deg,#5361d9,#844fd3,#cc3e91)}
    .cc388-head{display:flex;align-items:center;justify-content:space-between;gap:6px}.cc388-label{display:inline-flex;align-items:center;justify-content:center;min-width:132px;font-size:13.5px;font-weight:1000;text-transform:uppercase;letter-spacing:.04em;padding:6px 10px;border-radius:999px;background:linear-gradient(135deg,rgba(255,255,255,.46),rgba(255,255,255,.20));border:1px solid rgba(255,255,255,.40);box-shadow:inset 0 1px 0 rgba(255,255,255,.40),0 6px 14px rgba(15,23,42,.13);text-shadow:0 1px 2px rgba(0,0,0,.24);font-family:Roboto,"Segoe UI",Arial,sans-serif}
    .cc388-head-actions{display:flex;align-items:center;gap:5px}.cc388-count{font-size:11.5px;font-weight:1000;color:#15345e;background:linear-gradient(135deg,#fff,#e9f3ff);padding:5px 7px;border-radius:999px;box-shadow:0 5px 12px rgba(12,39,84,.12);font-family:Roboto,"Segoe UI",Arial,sans-serif}.cc388-x{width:28px;height:28px;border:0;border-radius:10px;background:linear-gradient(135deg,#ffb348,#ff5a65 55%,#7c5cff);color:#fff;font-size:19px;line-height:1;font-weight:1000;cursor:pointer;box-shadow:0 7px 16px rgba(65,32,95,.23),inset 0 1px 0 rgba(255,255,255,.35);animation:cc388ClosePulse 1.45s ease-in-out infinite;font-family:Roboto,"Segoe UI",Arial,sans-serif}@keyframes cc388ClosePulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
    .cc388-title{margin-top:6px;font-size:22px;line-height:1.14;font-weight:1000;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 3px rgba(0,0,0,.2);font-family:Roboto,"Segoe UI",Arial,sans-serif}.cc388-note{margin-top:7px;background:linear-gradient(180deg,#ffffff 0%,#f7fbff 100%);color:#0e2d52;border-radius:14px;padding:9px 10px;font-size:16px;line-height:1.35;font-weight:800;min-height:68px;max-height:82px;overflow:auto;border:1px solid rgba(210,225,248,.95);box-shadow:inset 0 1px 0 #fff,0 8px 18px rgba(21,55,109,.11);font-family:Roboto,"Segoe UI",Arial,sans-serif}.cc388-note b{display:block;font-size:13px;letter-spacing:.04em;margin-bottom:5px;color:#234c7d;font-family:Roboto,"Segoe UI",Arial,sans-serif}.cc388-note span{font-size:16px;color:#102f55;font-weight:900;font-family:Roboto,"Segoe UI",Arial,sans-serif}
    .cc388-time{margin-top:6px;font-size:14.5px;font-weight:1000;color:#14375f;background:linear-gradient(135deg,#fff,#edf5ff);border-radius:11px;padding:7px 8px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:inset 0 1px 0 #fff,0 5px 12px rgba(20,54,108,.10);font-family:Roboto,"Segoe UI",Arial,sans-serif}
    .cc388-actions{display:flex;gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap}.cc388-next-day{height:32px;border:1px solid rgba(255,255,255,.30);border-radius:10px;padding:0 10px;font-size:12.5px;font-weight:1000;cursor:pointer;background:rgba(255,255,255,.24);color:#fff;box-shadow:inset 0 1px 0 rgba(255,255,255,.28);font-family:Roboto,"Segoe UI",Arial,sans-serif}
    .cc388-preset-label{margin-top:6px;font-size:12px;font-weight:1000;letter-spacing:.045em;text-transform:uppercase;color:rgba(255,255,255,.96);font-family:Roboto,"Segoe UI",Arial,sans-serif}.cc388-presets{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-top:4px}.cc388-preset{height:32px;border:1px solid rgba(255,255,255,.92);border-radius:10px;background:linear-gradient(180deg,#ffffff,#eef5ff);color:#143c66;font-size:15px;font-weight:1000;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.96),0 5px 12px rgba(15,23,42,.11);font-family:Roboto,"Segoe UI",Arial,sans-serif}.cc388-preset:hover,.cc388-next-day:hover{background:linear-gradient(180deg,#fff,#e8f2ff)}
    @media(max-width:700px){.cc388-reminder-deck{right:8px;bottom:8px;width:min(292px,calc(100vw - 16px))}.cc388-title{font-size:22px}.cc388-note{font-size:16px;min-height:68px;max-height:82px}.cc388-presets{gap:5px}}@media(prefers-reduced-motion:reduce){.cc388-x{animation:none!important}.cc388-card{transition:none!important}}
  `;
  document.head.appendChild(style);
}

function installCompactReminderRuntime() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__CC388_COMPACT_REMINDER_RUNTIME__ === VERSION) return;
  window.__CC388_COMPACT_REMINDER_RUNTIME__ = VERSION;
  installStyle();
  // CC26_736: retain the exact CC660 reference popup CSS, but the direct scoped reminder owner
  // in cc26-730-client-fixes.js handles data/timing so local/live backends both work reliably.
  return;

  let latestActions = [];
  let refreshTimer = null;
  let tickTimer = null;

  function readSnooze() { const value = readJson(SNOOZE_KEY, {}); return value && typeof value === 'object' ? value : {}; }
  function writeSnooze(value) { writeJson(SNOOZE_KEY, value); }
  function saveActions(actions = []) { latestActions = Array.isArray(actions) ? actions : []; writeJson(BACKLOG_KEY, latestActions); }
  function loadActions() { if (latestActions.length) return latestActions; const stored = readJson(BACKLOG_KEY, []); latestActions = Array.isArray(stored) ? stored : []; return latestActions; }
  function isLogin() { return location.pathname.includes('/login'); }
  function ensureDeck() { let deck = document.querySelector('.cc388-reminder-deck'); if (!deck) { deck = document.createElement('div'); deck.className = 'cc388-reminder-deck'; document.body.appendChild(deck); } return deck; }
  function dueAt(item) { return parseMs(item.due_at || item.created_at || item.updated_at) || Date.now(); }
  function validInterview(item) { return typeFor(item) !== 'interview' || (item.scheduled_at && istDateKey(item.scheduled_at) === istDateKey(Date.now())); }
  function dueRows() {
    const snooze = readSnooze();
    return loadActions().filter(validInterview).filter((item) => dueAt(item) <= Date.now()).filter((item) => Number(snooze[keyOf(item)] || 0) <= Date.now()).sort((a, b) => dueAt(a) - dueAt(b));
  }
  function formatTime(item) {
    const type = typeFor(item);
    const stamp = type === 'interview' ? item.scheduled_at : item.due_at;
    try { return new Date(stamp || Date.now()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return 'Now'; }
  }
  function render() {
    installStyle();
    document.querySelectorAll('.cc383-reminder-deck,.cc379-reminder-deck').forEach((el) => { el.style.display = 'none'; });
    if (isLogin()) { document.querySelectorAll('.cc388-reminder-deck').forEach((el) => el.remove()); return; }
    const deck = ensureDeck();
    const rows = dueRows();
    if (!rows.length) { deck.innerHTML = ''; return; }
    const item = rows[0]; const type = typeFor(item); const key = keyOf(item);
    const sameTypeCount = rows.filter((row) => typeFor(row) === type).length;
    const countText = type === 'interview' ? `Today ${sameTypeCount}` : type === 'submission' ? `Pending ${sameTypeCount}` : `${sameTypeCount} due`;
    const title = cleanText(item.full_name || item.candidate_name || item.employee_name || item.recruiter_name || item.user_name || item.username || String(item.title || labelFor(type)).replace(/^Submission Reminder:\s*/i, '').replace(/^Interview Reminder:\s*/i, '').replace(/^Activity Reminder:?\s*/i, '')) || labelFor(type);
    const note = cleanText(item.message || 'Reminder needs action.');
    const openPath = item.candidate_id ? `/candidate/${encodeURIComponent(String(item.candidate_id))}` : cleanText(item.open_path || '/reports');
    const nextDay = type === 'interview' && item.allow_next_day_same_time ? '<button class="cc388-next-day" type="button">Next day · same time</button>' : '';
    deck.innerHTML = `<div class="cc388-card ${type}" data-key="${key}" data-type="${type}" data-open="${openPath}" data-candidate="${cleanText(item.candidate_id || '')}" data-interview="${cleanText(item.interview_id || '')}" title="Open profile"><div class="cc388-head"><span class="cc388-label">${labelFor(type)}</span><span class="cc388-head-actions"><button class="cc878-deck-minimize" type="button" aria-label="Minimize all popups for 5 seconds">−</button><span class="cc388-count">${countText}</span><button class="cc388-x" type="button" aria-label="Close">×</button></span></div><div class="cc388-title">${title}</div><div class="cc388-note"><b>NOTE</b><span>${note}</span></div><div class="cc388-time">${type === 'interview' ? 'Interview' : 'Due'}: ${formatTime(item)}</div>${nextDay ? `<div class="cc388-actions">${nextDay}</div>` : ''}<div class="cc388-preset-label">Snooze</div><div class="cc388-presets"><button class="cc388-preset" data-min="5">5m</button><button class="cc388-preset" data-min="30">30m</button><button class="cc388-preset" data-min="60">1h</button><button class="cc388-preset" data-min="180">3h</button></div></div>`;
  }
  function suppress(key, minutes) { const map = readSnooze(); map[key] = Date.now() + Math.max(1, Number(minutes || 1)) * 60000; writeSnooze(map); render(); }
  async function refresh() {
    if (isLogin()) return;
    try {
      const response = await fetch(`/api/reports/reminder-summary?cc388=${Date.now()}`, { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json', 'X-Career-Crox-Background': '1' } });
      if (response.ok) { const payload = await response.json(); if (payload?.ok) saveActions(payload.actions || []); }
    } catch {}
    render();
  }
  async function rescheduleNextDay(card) {
    const key = card.getAttribute('data-key') || '';
    try {
      const response = await fetch('/api/interviews/reschedule-next-day', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidate_id: card.getAttribute('data-candidate') || '', interview_id: card.getAttribute('data-interview') || '' }) });
      if (!response.ok) throw new Error('Could not reschedule');
      saveActions(loadActions().filter((item) => keyOf(item) !== key));
      render();
      setTimeout(refresh, 500);
    } catch { suppress(key, 5); }
  }

  document.addEventListener('click', (event) => {
    const card = event.target.closest?.('.cc388-card'); if (!card) return;
    const key = card.getAttribute('data-key') || ''; const type = card.getAttribute('data-type') || '';
    if (event.target.closest('.cc388-preset')) { event.preventDefault(); suppress(key, Number(event.target.closest('.cc388-preset').getAttribute('data-min') || 5)); return; }
    if (event.target.closest('.cc388-next-day')) { event.preventDefault(); rescheduleNextDay(card); return; }
    
    if (event.target.closest('.cc388-x')) { event.preventDefault(); event.stopPropagation(); suppress(key, type === 'submission' ? 10 : type === 'interview' ? 10 : 20); return; }
    event.preventDefault(); const open = card.getAttribute('data-open') || '/candidates'; window.open(open, '_blank', 'noopener,noreferrer'); suppress(key, type === 'submission' ? 5 : type === 'interview' ? 10 : repeatMinutes({ type })); return;
  }, true);

  // In a normal source build there is no legacy CC379 runtime, so this runtime owns the low-egress 5-minute refresh.
  if (!window.__CC379_CONSOLIDATED_RUNTIME__) {
    refreshTimer = window.setInterval(refresh, REFRESH_MS);
    setTimeout(refresh, 700);
  } else {
    // Legacy prebuilt runtime owns the network refresh; read its active backlog locally.
    const legacyKeys = ['cc379_due_reminder_backlog'];
    const pullLegacy = () => {
      const map = new Map();
      legacyKeys.forEach((storageKey) => { const rows = readJson(storageKey, []); if (Array.isArray(rows)) rows.forEach((item) => { const key = keyOf(item); if (key) map.set(key, item); }); });
      saveActions(Array.from(map.values())); render();
    };
    setTimeout(pullLegacy, 1600);
    window.addEventListener('career-crox-reminder-backlog-updated', pullLegacy);
    refreshTimer = window.setInterval(pullLegacy, 30000);
  }
  tickTimer = window.setInterval(render, 1000); // local-only reminder clock
  const onDataWritten = (event) => {
    const path = String(event?.detail?.path || '');
    if (/\/api\/(candidates|submissions|interviews)/.test(path) && !window.__CC379_CONSOLIDATED_RUNTIME__) setTimeout(refresh, 500);
  };
  window.addEventListener('career-crox-data-written', onDataWritten);
  window.addEventListener('beforeunload', () => { if (refreshTimer) clearInterval(refreshTimer); if (tickTimer) clearInterval(tickTimer); window.removeEventListener('career-crox-data-written', onDataWritten); }, { once: true });
}

installCompactReminderRuntime();
})();

/* CC26_455 legacy timer removed in CC26_462: CC456 is the only timer owner. */

/* CC26_456 CURRENT-SESSION ATTENDANCE INTEGRITY FINAL */
;(() => {
  'use strict';
  if (window.__CC456_SESSION_ATTENDANCE__) return;
  window.__CC456_SESSION_ATTENDANCE__ = 'CC26_456_SESSION_ATTENDANCE_FINAL';
  const KEY='cc456_session_activity_state', ACT='cc434_work_activity_at', JOIN='careerCroxOfficeJoinedSession', LOGIN='careerCroxSessionLoginAt';
  const GRACE=2*60*1000, FULL=9*60*60*1000, WRITE=5000;
  let lastIdentity='', lastMarker='', freshBoot=true;
  const now=()=>Date.now();
  function json(k){try{const x=JSON.parse(localStorage.getItem(k)||'null');return x&&typeof x==='object'?x:null}catch{return null}}
  function user(){try{return JSON.parse(localStorage.getItem('careerCroxCachedUser')||'{}')||{}}catch{return{}}}
  function identity(){const u=user();return String(u.user_id||u.recruiter_code||u.username||u.email||'').trim()}
  function marker(){try{return String(localStorage.getItem(LOGIN)||'').trim()}catch{return''}}
  function rawJoin(){return json(JOIN)}
  function session(){
    const id=identity(), mk=marker(); if(!id||!mk)return null;
    const login=Number(mk||0)||0, j=rawJoin();
    if(!j||j.identity!==id||!j.joined_at||!j.manual_confirmed_at)return null;
    const joined=new Date(j.joined_at).getTime();
    if(!Number.isFinite(joined)||joined<=0)return null;
    // Daily join is canonical. Never replace it with the later refresh/login time.
    const today=new Date(now()+19800000).toISOString().slice(0,10);
    const day=new Date(joined+19800000).toISOString().slice(0,10);
    if(day!==today||joined>now()+300000)return null;
    return {id,mk,login:login||joined,joined,office:joined};
  }
  function fmt(ms){let x=Math.max(0,Math.floor(Number(ms||0)/1000)),h=Math.floor(x/3600),m=Math.floor((x%3600)/60),sec=x%60;return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0')}
  function hm(ms){const mins=Math.max(0,Math.floor(Number(ms||0)/60000)),h=Math.floor(mins/60),m=mins%60;return h+'h '+m+'m'}
  function clock(ms){if(!ms)return '-';try{return new Date(ms).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:true})}catch{return'-'}}
  function read(){return json(KEY)}
  function write(st,force){try{const t=now();if(!force&&st._last_write_at&&t-st._last_write_at<WRITE)return;st._last_write_at=t;localStorage.setItem(KEY,JSON.stringify(st));localStorage.setItem('cc729_daily_timer_backup',JSON.stringify(st))}catch{}}
  function act(){try{return Math.max(0,Number(localStorage.getItem(ACT)||0)||0)}catch{return 0}}
  function mark(event){if(event?.isTrusted===false||window.__CC602_NETWORK_PAUSED__)return;const ss=session();if(!ss)return;const t=now();if(t<ss.office)return;const prior=account(ss);write(prior.st,true);try{localStorage.setItem(ACT,String(t))}catch{}}
  function onBreak(){const receipt=window.__CC836_ATTENDANCE__?.();const server=receipt?{identity:identity(),presence:receipt.presence}:window.__CC787_ATTENDANCE_BASE__;if(server?.identity===identity()&&String(server.presence?.is_on_break||'0')==='1')return true;const chips=document.querySelectorAll('.lock-premium-chip');for(const x of chips){if(/break mode|break exceeded/i.test(String(x.textContent||'')))return true}const old=document.querySelector('.cc455-work-timer-pill,.cc408-work-timer-pill');return !!(old&&old.classList.contains('break'))}
  function locked(){const server=window.__CC787_ATTENDANCE_BASE__;return (server?.identity===identity()&&String(server.presence?.locked||'0')==='1')||!!document.querySelector('.crm-lock-backdrop,.crm-lock-modal,.break-overdue-modal')}
  function clear(){try{localStorage.removeItem(KEY);localStorage.removeItem(ACT)}catch{}document.querySelectorAll('.cc456-work-timer-pill').forEach(x=>x.remove())}
  function stateFor(ss,t){let st=read(),sameDay=st&&st.identity===ss.id&&Number(st.version||0)===456&&
      Number.isFinite(Number(st.office_started_at))&&new Date(Number(st.office_started_at)+19800000).toISOString().slice(0,10)===new Date(ss.office+19800000).toISOString().slice(0,10);
    if(!sameDay){
      try{localStorage.removeItem(ACT)}catch{}
      const base=window.__CC787_ATTENDANCE_BASE__,p=base?.identity===ss.id&&Date.parse(base.presence?.work_started_at||'')===ss.office?base.presence:{};
      st={version:456,clock_version:787,identity:ss.id,login_marker:ss.mk,started_at:ss.login,office_started_at:ss.office,last_tick_at:t,active_ms:Math.max(0,Number(p.total_work_minutes)||0)*60000,idle_ms:0,break_ms:Math.max(0,Number(p.total_break_minutes)||0)*60000,grace_ms:0,last_activity_at:0,_last_write_at:0};
      st.idle_ms=Math.max(0,t-ss.office-st.active_ms-st.break_ms);write(st,true);freshBoot=false;return st;
    }
    // A refresh or a new login marker must NOT throw away today's active/break/idle counters.
    if(String(st.login_marker||'')!==ss.mk){
      try{localStorage.removeItem(ACT)}catch{}
      st.idle_ms=Math.max(0,Number(st.idle_ms||0)||0)+Math.max(0,t-Math.max(ss.office,Number(st.last_tick_at||t)||t));
      st.login_marker=ss.mk;st.last_tick_at=t;st.last_activity_at=0;st._last_write_at=0;
    }
    const server=window.__CC787_ATTENDANCE_BASE__,p=server?.identity===ss.id&&Date.parse(server.presence?.work_started_at||'')===ss.office?server.presence:null;
    if(p&&Object.prototype.hasOwnProperty.call(p,'total_work_minutes')){
      const saved=Math.max(0,Number(p.total_work_minutes)||0)*60000;
      if(st.clock_version!==787 || saved>Number(st.active_ms||0)){
        st.active_ms=saved;st.break_ms=Math.max(0,Number(p.total_break_minutes)||0)*60000;st.grace_ms=0;
        st.idle_ms=Math.max(0,t-ss.office-st.active_ms-st.break_ms);st.last_tick_at=t;st.clock_version=787;
      }
    }
    st.started_at=ss.login;st.office_started_at=ss.office;st.active_ms=Math.max(0,Number(st.active_ms||0)||0);st.idle_ms=Math.max(0,Number(st.idle_ms||0)||0);st.break_ms=Math.max(0,Number(st.break_ms||0)||0);st.grace_ms=Math.max(0,Number(st.grace_ms||0)||0);st.last_activity_at=Math.max(0,Number(st.last_activity_at||0)||0);st.last_tick_at=Math.max(ss.office,Math.min(t,Number(st.last_tick_at||t)||t));return st}
  function account(ss){const t=now();let st=stateFor(ss,t),dt=Math.max(0,t-st.last_tick_at),b=onBreak(),l=locked(),a=act();if(a>=ss.office)st.last_activity_at=Math.max(st.last_activity_at,a);const priorClockMode=st.clock_mode;const recent=!!(st.last_activity_at&&t-st.last_activity_at<GRACE),officeElapsed=Math.max(0,t-ss.office);
    if(window.__CC787_CLOCK_STEP__)st=window.__CC787_CLOCK_STEP__(st,t,st.last_activity_at,b?'break':l?'locked':'work',GRACE);else{if(dt>0){if(b)st.break_ms+=dt;else if(l)st.idle_ms+=dt;else if(recent)st.active_ms+=dt;else st.idle_ms+=dt}st.last_tick_at=t;}
    // Clamp buckets to current session duration so impossible values can never leak into UI.
    st.break_ms=Math.min(st.break_ms,officeElapsed);let left=Math.max(0,officeElapsed-st.break_ms);st.active_ms=Math.min(st.active_ms,left);left-=st.active_ms;st.grace_ms=Math.min(st.grace_ms,left);left-=st.grace_ms;st.idle_ms=Math.min(st.idle_ms,left);left-=st.idle_ms;if(left>0)st.idle_ms+=left;
    write(st,priorClockMode!==st.clock_mode);return {st,t,b,l,recent,officeElapsed,loginElapsed:Math.max(0,t-ss.login),idle:!b&&!l&&!recent&&officeElapsed>GRACE}}
  function style(){if(document.getElementById('cc456-session-style'))return;const e=document.createElement('style');e.id='cc456-session-style';e.textContent=`
    .cc455-work-timer-pill,.cc445-work-timer-pill,.cc408-work-timer-pill,.cc379-work-timer-pill,.cc376-work-timer-pill,.cc378-work-timer-pill{display:none!important}
    .cc456-work-timer-pill{position:relative;height:54px;min-width:202px;padding:6px 14px 12px;border-radius:18px;background:linear-gradient(135deg,#fff,#eff8ff 52%,#fff8ee);border:1px solid rgba(96,165,250,.42);box-shadow:0 12px 30px rgba(37,99,235,.14);display:flex;align-items:center;gap:11px;color:#10233f;overflow:hidden}
    .cc456-dot{width:10px;height:10px;border-radius:999px;background:#22c55e;box-shadow:0 0 0 5px rgba(34,197,94,.13);flex:0 0 10px}.cc456-work-timer-pill.idle .cc456-dot{background:#f59e0b;box-shadow:0 0 0 5px rgba(245,158,11,.15)}.cc456-work-timer-pill.break .cc456-dot{background:#f97316}.cc456-work-timer-pill.locked .cc456-dot{background:#ef4444}
    .cc456-label{font-size:8.5px;font-weight:1000;text-transform:uppercase;letter-spacing:.09em;color:#64748b;line-height:1}.cc456-value{font:1000 17px/1.05 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;color:#10233f;margin-top:2px}.cc456-sub{font-size:8.5px;font-weight:900;color:#64748b;line-height:1;margin-top:3px;white-space:nowrap}
    .cc456-progress{position:absolute;left:11px;right:11px;bottom:5px;height:7px;border-radius:999px;background:linear-gradient(90deg,rgba(239,68,68,.16),rgba(245,158,11,.13),rgba(34,197,94,.14));overflow:hidden;box-shadow:inset 0 1px 3px rgba(15,23,42,.13)}.cc456-progress span{display:block;height:100%;width:0;border-radius:999px;background:#ef4444;transition:width .4s ease,background .4s ease}
    body[data-cc456-attendance='1'] .attendance-progress-bar{height:10px!important;border-radius:999px!important;background:linear-gradient(90deg,#fee2e2,#fef3c7 52%,#dcfce7)!important;box-shadow:inset 0 1px 3px rgba(15,23,42,.12)!important}body[data-cc456-attendance='1'] .attendance-progress-bar>span{border-radius:999px!important;transition:width .45s ease!important}
  `;document.head.appendChild(e)}
  function pill(){style();let p=document.querySelector('.cc456-work-timer-pill');if(p)return p;const top=document.querySelector('.topbar-right');if(!top)return null;p=document.createElement('div');p.className='cc456-work-timer-pill';p.title='Active work for this login. Break, idle and lock are excluded.';p.innerHTML='<span class="cc456-dot"></span><span><div class="cc456-label">Working Time</div><div class="cc456-value">00:00:00</div><div class="cc456-sub">Active work</div></span><div class="cc456-progress"><span></span></div>';top.insertBefore(p,top.firstChild);return p}
  function renderPill(ss,x){document.querySelectorAll('.cc455-work-timer-pill,.cc445-work-timer-pill,.cc408-work-timer-pill,.cc379-work-timer-pill,.cc376-work-timer-pill,.cc378-work-timer-pill,.cc456-work-pill').forEach(e=>{try{e.remove()}catch(_){e.style.display='none'}});const all=document.querySelectorAll('.cc456-work-timer-pill');for(let i=1;i<all.length;i++){try{all[i].remove()}catch(_){all[i].style.display='none'}}const p=pill();if(!p)return;p.classList.remove('cc641-await-join');p.classList.toggle('break',x.b);p.classList.toggle('locked',x.l);p.classList.toggle('idle',x.idle);const val=p.querySelector('.cc456-value'),sub=p.querySelector('.cc456-sub'),fill=p.querySelector('.cc456-progress span'),active=Math.max(0,Number(x.st.active_ms||0)||0);if(val)val.textContent=fmt(active);const pct=Math.max(0,Math.min(100,active/FULL*100)),h=Math.round(120*pct/100);if(sub)sub.textContent=x.b?'Break • active timer paused':x.l?'CRM locked • active timer paused':x.idle?'Idle • active timer paused':Math.round(pct)+'% of 9h active';if(fill){fill.style.width=pct.toFixed(2)+'%';fill.style.background='hsl('+h+' 82% 45%)'}}
  function tick(){
    style();
    // Always keep ONE header clock mounted for an authenticated, active browser session.
    // CC26_640 removed the only fallback before Join Office and thereby hid the clock.
    // Do not invent active seconds or start attendance before a verified Join Office.
    if(/\/login(?:\/|$)/i.test(location.pathname||'') ||
       !identity() || !marker() || window.__CC602_NETWORK_PAUSED__){document.querySelectorAll('.cc456-work-timer-pill').forEach(x=>x.remove());return}
    const ss=session();
    if(!ss){
      const p=pill(); if(!p)return;
      p.classList.add('cc641-await-join');
      p.classList.remove('idle','break','locked');
      const value=p.querySelector('.cc456-value'),sub=p.querySelector('.cc456-sub'),fill=p.querySelector('.cc456-progress span');
      if(value && value.textContent!=='00:00:00')value.textContent='00:00:00';
      if(sub && sub.textContent!=='Join Office to start')sub.textContent='Join Office to start';
      if(fill && fill.style.width!=='0%')fill.style.width='0%';
      return;
    }
    const key=ss.id+'|'+ss.mk;if(lastIdentity+'|'+lastMarker!==key){lastIdentity=ss.id;lastMarker=ss.mk}const x=account(ss);renderPill(ss,x);try{window.dispatchEvent(new CustomEvent('career-crox-work-session-tick',{detail:{...x.st,elapsed_ms:Math.max(0,Number(x.st.active_ms||0)||0),active_elapsed_ms:Math.max(0,Number(x.st.active_ms||0)||0),office_elapsed_ms:x.officeElapsed,on_break:x.b,locked:x.l,idle:x.idle}}))}catch{}}
  // Real human interactions only. Pointer movement does not count as productive activity.
  ['mousedown','keydown','touchstart','click','wheel','scroll'].forEach(ev=>window.addEventListener(ev,mark,{passive:true,capture:true}));
  // CC907: real input in the browser floating window is employee activity too.
  window.documentPictureInPicture?.addEventListener('enter',e=>{['mousedown','keydown','touchstart','click','wheel','scroll'].forEach(ev=>e.window.addEventListener(ev,mark,{passive:true,capture:true}));});
  window.addEventListener('career-crox-office-joined',e=>{if(!e?.detail?.restored){try{localStorage.removeItem(KEY);localStorage.removeItem(ACT)}catch{}}if(e?.detail?.explicit_join){tick();mark();setTimeout(tick,20)}else setTimeout(tick,20)});
  window.addEventListener('career-crox-work-timer-reset',clear);window.addEventListener('storage',e=>{if(e&&e.key==='careerCroxCachedUser'&&!e.newValue)clear()});
  // Render immediately when React mounts the header; no 1-second blank gap.
  window.addEventListener('career-crox-attendance-live',event=>{
    const p=event.detail?.presence;if(!p || window.__CC602_NETWORK_PAUSED__ || String(p.user_id||'')!==identity())return;
    const resetAt=Date.parse(p.timer_reset_at||''),resetKey='cc820_timer_reset:'+identity();
    if(Number.isFinite(resetAt)){
      let previous=0;try{previous=Number(localStorage.getItem(resetKey)||0);}catch{}
      if(resetAt>previous){
        clear();try{localStorage.removeItem('cc729_daily_timer_backup');localStorage.removeItem(JOIN);localStorage.setItem(resetKey,String(resetAt));}catch{}
        window.dispatchEvent(new CustomEvent('career-crox-work-timer-reset'));
      }
    }
    window.__CC787_ATTENDANCE_BASE__={identity:identity(),presence:p,at:Date.now()};tick();
  });
  window.addEventListener('career-crox-react-ready',tick,{once:true});
  setInterval(tick,1000);setTimeout(tick,80);
})();

/* CC26_556: one lightweight display-only clock handler for the existing React break gate.
   A manager/admin never receives a manager warning modal and is never auto-locked by this script.
   No API polling. The existing React end-break request is the only expiry write. */
;(() => {
  'use strict';
  function currentRole(){
    try {
      const user=JSON.parse(localStorage.getItem('careerCroxCachedUser')||'null')||{};
      const role=String(user.role||user.designation||user.user_role||'').trim().toLowerCase();
      return role.includes('manager')||role.includes('admin')?'manager':role;
    } catch {return '';}
  }
  const two = n => String(Math.floor(n)).padStart(2,'0');
  function tick(){
    document.querySelectorAll('.cc555-manager-warning').forEach(node=>node.remove());
    if(currentRole()==='manager'||/^\/login(?:\/|$)/.test(location.pathname))return;
    const modal=document.querySelector('.crm-lock-backdrop .crm-lock-modal');
    if(!modal)return;
    const overlay=modal.closest('.crm-lock-backdrop');
    if(!overlay)return;
    const clock=modal.querySelector('.cc556-negative-clock[data-break-expiry]');
    if(clock){
      const end=Number(clock.dataset.breakExpiry);
      if(Number.isFinite(end)&&end>0){
        // The allotted break never increases after expiry. Any overrun is handled by the required-reason approval modal.
        if(clock.textContent!=='00:00:00') clock.textContent='00:00:00';
      }
      return;
    }
    const timer=modal.querySelector('.lock-overlay-timer');
    if(!timer)return;
    const text=String(timer.textContent||'').replace(/[^0-9:]/g,'');
    const pieces=text.split(':').map(Number);
    const remaining=pieces.length===3 ? pieces[0]*3600+pieces[1]*60+pieces[2] : pieces.length===2 ? pieces[0]*60+pieces[1] : 3600;
    const expired=timer.textContent.trim().startsWith('-')||modal.querySelector('.panel-title')?.textContent?.includes('Exceeded');
    overlay.classList.toggle('cc556-near-end',remaining<=60&&!expired);
    overlay.classList.toggle('cc556-time-up',Boolean(expired));
    // NEVER auto-click an access request. Employee must enter the reason and
    // explicitly submit; React renders the expiry form and verifies backend save.
  }
  setInterval(tick,1000);
  window.addEventListener('focus',tick);
})();


;/* Career Crox CC26_602: trusted employee activity, 10-minute idle logout, zero idle chat subscriptions. */
(function(){
  'use strict';
  var U='careerCroxCachedUser',H='careerCroxHumanActivityAt',L='careerCroxLastActivityAt',G='careerCroxSessionLoginAt',M='careerCroxSessionExpiredMessage',EV='careerCroxLogoutEventAt';
  function idleLimit(){return window.__CC835_IDLE_TIMEOUT_MS__?.()||600000;}
  var stopped=false, writing=0, lastPulse=0, timer=null,tailPulseTimer=null;
  var nativeFetch=window.fetch.bind(window);
  // CC26_621: IST 09:00–21:00; device timezone never changes this office window.
  var IST_OFFSET=330*60000, officeTimer=null, officeNow=null;
  function officeHours(at){var d=new Date((at===undefined?Date.now():at)+IST_OFFSET),m=d.getUTCHours()*60+d.getUTCMinutes();return m>=540&&m<1260;}
  window.__CC621_IS_OFFICE_HOURS__=officeHours;
  // Office report hours do not restrict a person actively using the CRM.
  window.__CC621_NIGHT_QUIET__=function(){return !officeHours()&&(!user()||isExpired()||window.__CC602_NETWORK_PAUSED__);};
  function isAutoGet(options){var hdr=options&&options.headers||{},value='';if(typeof Headers!=='undefined'&&hdr instanceof Headers){value=hdr.get('X-Career-Crox-Background')||'';}else if(Array.isArray(hdr)){for(var i=0;i<hdr.length;i++){if(String(hdr[i][0]).toLowerCase()==='x-career-crox-background')value=hdr[i][1];}}else{for(var k in hdr){if(k.toLowerCase()==='x-career-crox-background')value=hdr[k];}}return String(value).toLowerCase()==='1'&&String(options&&options.method||'GET').toUpperCase()==='GET';}
  function manualRoute(url){
    // Compact attendance restores the login lock. Other passive reads remain quiet.
    var p='',target;try{target=new URL(url&&url.url||url||'',location.href);p=target.pathname;}catch(_){}
    return p==='/api/auth/me'||(p==='/api/attendance'&&target.searchParams.get('compact')==='1');
  }
  function officeBoundary(){var current=officeHours();if(officeNow!==null&&current!==officeNow){try{window.dispatchEvent(new CustomEvent(current?'cc621:office-open':'cc621:night-quiet'))}catch(_){}}officeNow=current;if(officeTimer)clearTimeout(officeTimer);var now=Date.now(),shifted=new Date(now+IST_OFFSET),at=shifted.getUTCHours()*60+shifted.getUTCMinutes(),minutes=current?1260-at:(at<540?540-at:1980-at);officeTimer=setTimeout(officeBoundary,Math.max(1000,minutes*60000-shifted.getUTCSeconds()*1000-shifted.getUTCMilliseconds()+250));}
  officeBoundary();document.addEventListener('visibilitychange',officeBoundary);window.addEventListener('pageshow',officeBoundary);

  function n(v){var x=Number(v||0);return isFinite(x)?x:0}
  function read(k){try{return n(localStorage.getItem(k))}catch(e){return 0}}
  function user(){try{return !!localStorage.getItem(U)}catch(e){return false}}
  function last(){return Math.max(read(H),read(L),read(G))||Date.now()}
  function deadline(){return window.__CC919_SESSION_DEADLINE__?.(null,last())||last()+idleLimit()}
  function isExpired(){return user()&&Date.now()>=deadline()}
  function networkAllowed(url){var path=String(url&&url.url||url||'');try{var target=new URL(path,location.href);if(target.origin!==location.origin)return false;path=target.pathname}catch(e){}return path==='/api/auth/logout'||path==='/api/auth/login'}
  // Old scripts may still have pending timers. One centralized gate prevents new idle Supabase work.
  window.fetch=function(url,options){
    var path=String(url&&url.url||url||'');try{path=new URL(path,location.href).pathname}catch(e){}
    if(isExpired()&&!stopped) logout();
    if(document.hidden&&!officeHours()&&isAutoGet(options)&&!manualRoute(url))return Promise.reject(new Error('Hidden tab refresh paused. Open the tab for current data.'));
    if(window.__CC602_NETWORK_PAUSED__&&!networkAllowed(url))return Promise.reject(new Error('CRM logged out; sign in to reconnect.'));
    return nativeFetch(url,options).then(function(response){if(path==='/api/auth/login'&&response.ok){
      stopped=false;window.__CC602_NETWORK_PAUSED__=false;window.__CC602_IDLE_LOGOUT_RUNNING__=false;writing=0;lastPulse=Date.now();
      try{localStorage.setItem(H,String(Date.now()));localStorage.setItem(L,String(Date.now()))}catch(e){} schedule();
    }return response});
  };
  function localLogout(reason){try{sessionStorage.setItem(M,reason)}catch(e){}try{localStorage.removeItem(U);localStorage.removeItem(G);localStorage.removeItem(H);localStorage.removeItem(L);localStorage.setItem(EV,JSON.stringify({at:Date.now(),reason:reason}))}catch(e){}}
  function logout(){if(stopped||!user())return;stopped=true;window.__CC602_NETWORK_PAUSED__=true;window.__CC602_IDLE_LOGOUT_RUNNING__=true;var minutes=window.__CC919_EXPIRY_MINUTES__?.(null,last())||idleLimit()/60000;var reason='CRM locked and logged out after '+minutes+' minutes of inactivity.';
    try{window.dispatchEvent(new CustomEvent('career-crox-idle-lock-begin'))}catch(e){}
    try{var box=document.createElement('div');box.id='cc602-idle-lock';box.style.cssText='position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:rgba(12,28,48,.78);font-family:inherit';box.innerHTML='<div style="max-width:420px;padding:28px;border-radius:20px;background:#fff;color:#17324f;text-align:center;box-shadow:0 20px 70px #0004"><h2>CRM Locked</h2><p>'+idleLimit()/60000+' minutes inactive. Please log in again to resume.</p></div>';document.body.appendChild(box)}catch(e){}
    // A single best-effort keepalive logout, never a repeating approval/check loop.
    try{nativeFetch('/api/auth/logout',{method:'POST',credentials:'include',keepalive:true,headers:{'Content-Type':'application/json','X-Career-Crox-Background':'1'},body:JSON.stringify({logout_reason:'auto_inactivity',reason:reason,notify_leadership:'1'})}).catch(function(){})}catch(e){}
    localLogout(reason);window.dispatchEvent(new CustomEvent('career-crox-local-logout',{detail:{message:reason}}));if(timer)clearTimeout(timer);setTimeout(function(){if(location.pathname!='/login')location.replace('/login');else location.reload()},3200);
  }
  // Local logout from another CRM tab: close connections without another database POST.
  window.addEventListener('storage',function(e){if(e.key===EV&&e.newValue&&!stopped){try{if(Number(JSON.parse(e.newValue).at)<read(G))return;}catch(_){}stopped=true;window.__CC602_NETWORK_PAUSED__=true;if(timer)clearTimeout(timer);try{window.dispatchEvent(new CustomEvent('career-crox-idle-lock-begin'))}catch(_){}location.replace('/login');}});
  function schedule(){if(timer)clearTimeout(timer);if(stopped)return;
    if(!user()){timer=setTimeout(schedule,30000);return}
    if(isExpired()){logout();return}timer=setTimeout(schedule,Math.max(500,Math.min(30000,deadline()-Date.now()+30)));
  }
  function pulse(tail){
    if(stopped||(document.hidden&&!window.documentPictureInPicture?.window?.document.hasFocus())||!user()||window.__CC602_NETWORK_PAUSED__||isExpired())return;
    var now=Date.now(),activity=last();if(now-activity>90000||activity<=read('cc835_last_sent_activity_at'))return;
    var elapsed=now-Math.max(lastPulse,read('cc602_last_human_activity_pulse'));if(elapsed<(tail?30000:110000))return;
    lastPulse=now;var login=read(G),account=localStorage.getItem(U);
    // Shared lease suppresses duplicate tabs; acknowledge the activity only after
    // success. A failed pulse must not mark unsaved work as already sent.
    try{localStorage.setItem('cc602_last_human_activity_pulse',String(now))}catch(_e){}
    nativeFetch('/api/auth/activity',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json','X-Career-Crox-Last-Activity-At':String(activity),'X-Career-Crox-Activity-Age-Ms':String(Math.max(0,Date.now()-activity))},body:'{}'})
      .then(function(r){if(!r.ok)throw Error('Activity not saved');return r.json();})
      .then(function(data){if(login!==read(G)||account!==localStorage.getItem(U)||window.__CC602_NETWORK_PAUSED__)return;
        try{localStorage.setItem('cc835_last_sent_activity_at',String(Math.max(activity,read('cc835_last_sent_activity_at'))))}catch(_){}
        if(data?.presence)window.dispatchEvent(new CustomEvent('career-crox-attendance-live',{detail:data}));
      }).catch(function(){if(login!==read(G)||account!==localStorage.getItem(U)||stopped)return;
        if(tailPulseTimer)clearTimeout(tailPulseTimer);tailPulseTimer=setTimeout(function(){pulse(true)},30000);
      });
  }
  function human(e){if(e.isTrusted===false||stopped||!user())return;if(isExpired()){logout();return}
    var now=Date.now();if(now-writing<15000)return;writing=now;
    try{localStorage.setItem(H,String(now));localStorage.setItem(L,String(now))}catch(err){}
    pulse();if(tailPulseTimer)clearTimeout(tailPulseTimer);tailPulseTimer=setTimeout(function(){pulse(true)},45000);schedule();
  }
  ['click','keydown','keyup','beforeinput','input','change','paste','compositionend','wheel','touchstart','pointerdown','pointermove'].forEach(function(event){window.addEventListener(event,human,{passive:true,capture:true})});
  window.documentPictureInPicture?.addEventListener('enter',function(e){['click','keydown','keyup','beforeinput','input','change','paste','compositionend','wheel','touchstart','pointerdown','pointermove'].forEach(function(name){e.window.addEventListener(name,human,{passive:true,capture:true})});});
  window.addEventListener('pageshow',schedule);document.addEventListener('visibilitychange',schedule);
  window.addEventListener('career-crox-approved-work-resumed',function(){writing=0;schedule()});
  window.addEventListener('storage',function(e){if(e.key===H||e.key===L||e.key===G)schedule()});
  // Initialize H from the existing historical timestamp, never from a background API result.
  if(user()&&!read(H)){try{localStorage.setItem(H,String(read(L)||read(G)||Date.now()))}catch(e){}}
  schedule();
})();

/* CC26_624: manual-first Admin ARIA schedule + Daily Tasks / opt-in Recurring Work.
   Uses the existing deployed JS asset (no new script request or extra GitHub file).
   Reads already-cached CRM rows first; GETs ONLY on explicit user action. */
(function(){
'use strict';
if(window.__CC622_UI_INSTALLED__)return;window.__CC622_UI_INSTALLED__=true;
var tPanel=null,aPanel=null,lastTasks='',manualTaskRows=null,ariaTimes=null,uiScheduled=false,lastTaskPaint=0,lastTaskDay='';
var safe = function(v){return String(v==null?'':v);};
function cc630CurrentUserId(){try{return safe((JSON.parse(localStorage.getItem('careerCroxCachedUser')||'null')||{}).user_id);}catch(_){return '';}}
var make=function(tag,cls,txt){var el=document.createElement(tag);if(cls)el.className=cls;if(txt!==undefined)el.textContent=safe(txt);return el;};
var IST=330*60000;
var today=function(){return new Date(Date.now()+IST).toISOString().slice(0,10);};
var statusText=function(msg){var el=document.getElementById('cc622-task-status');if(el)el.textContent=safe(msg);};

// CC26_631: One employee directory for Tasks + Recurring Work, no user manual refresh.
// Reuse a user-scoped cached list immediately; network runs only on first need,
// one explicit modal-open retry after an earlier failure, or browser reconnect.
var cc631EmployeesPromise=null,cc631LastLookup=0,cc631Failed=false;
function cc631DirectoryKey(){return 'careerCroxTasksUsers:v2:'+cc630CurrentUserId();}
function cc631CachedEmployees(){
 var rows=readCached(cc631DirectoryKey());
 return Array.isArray(rows)?rows.filter(function(u){return u&&String(u.user_id||'').trim();}):[];
}
function cc631EmitEmployees(rows){
 if(!Array.isArray(rows)||!rows.length)return;
 writeCached(cc631DirectoryKey(),rows);
 window.dispatchEvent(new CustomEvent('cc630-task-assignees-loaded',{detail:{users:rows}}));
}
function cc631FetchEmployees(force){
 if(!cc630CurrentUserId()||window.__CC602_NETWORK_PAUSED__||/\/login(?:\/|$)/.test(location.pathname))return Promise.resolve([]);
 var cached=cc631CachedEmployees();
 if(cached.length&&!force)return Promise.resolve(cached);
 if(cc631EmployeesPromise)return cc631EmployeesPromise;
 if(!force&&cc631LastLookup&&Date.now()-cc631LastLookup<25000)return Promise.resolve(cached);
 cc631LastLookup=Date.now();
 cc631EmployeesPromise=apiJson('/api/tasks/assignees')
 .then(function(result){var rows=Array.isArray(result.users)?result.users.filter(function(u){return u&&u.user_id;}):[];
   if(rows.length){cc631Failed=false;cc631EmitEmployees(rows);}
   else cc631Failed=true;
   return rows;
 }).catch(function(){cc631Failed=true;return cached;}).finally(function(){cc631EmployeesPromise=null;});
 return cc631EmployeesPromise;
}
window.addEventListener('online',function(){if(location.pathname==='/tasks'&&cc631Failed&&!window.__CC602_NETWORK_PAUSED__)cc631FetchEmployees(true);});

var style=document.createElement('style');style.id='cc622-manual-ui';style.textContent=`
#cc622-task-panel,#cc622-aria-panel{box-sizing:border-box;color:#24344f;border:1px solid #c2d9f2;border-radius:25px;padding:22px;background:linear-gradient(120deg,#fffdfb,#eff6ff 48%,#e9fff3);box-shadow:0 15px 39px #334e7519,inset 0 2px #fff;isolation:isolate;margin:14px 0}
#cc622-task-panel *,#cc622-aria-panel *{box-sizing:border-box}
.cc622-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
.cc622-title{font-size:22px;font-weight:950;color:#1b335b;line-height:1.2}
.cc622-sub{font-size:13px;font-weight:670;color:#42607b;line-height:1.5;margin:5px 0 14px}
.cc622-badge{border-radius:999px;padding:8px 13px;background:linear-gradient(112deg,#d7ffed,#e0f3ff);font-weight:850;color:#0f7756;font-size:12px}
.cc622-actions{display:flex;flex-wrap:wrap;gap:9px;align-items:center}
.cc622-btn{appearance:none;cursor:pointer;padding:11px 16px;border-radius:14px;border:1px solid #b5cceb;color:#223a63;font-weight:850;font-size:13px;background:linear-gradient(110deg,#fff,#eaf1ff);box-shadow:0 6px 16px #5774a91b;transition:transform .15s,box-shadow .15s}
.cc622-btn:hover{transform:translateY(-1px);background:linear-gradient(115deg,#d6ffea,#c8f2d8);color:#075437;box-shadow:0 10px 25px #23a66b30}
.cc622-btn:disabled{opacity:.55;cursor:wait;transform:none}
.cc622-btn.primary{background:linear-gradient(110deg,#16b48c,#336ce8);border:0;color:#fff}
.cc622-btn.primary:hover{background:linear-gradient(110deg,#0ba772,#6dd2a1);color:#073d34}
.cc622-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.cc622-card{border:1px solid #d7e4f2;padding:15px;border-radius:18px;background:linear-gradient(130deg,#fff,#f7fcff);box-shadow:0 7px 18px #4158830b}
.cc622-card strong{font-size:16px;color:#243657;font-weight:900;display:block;overflow-wrap:anywhere}
.cc622-card small{font-size:12px;color:#62738d;display:block;margin:6px 0 10px;font-weight:650}
.cc622-card p{color:#405572;font-size:13px;line-height:1.45;white-space:pre-wrap;overflow-wrap:anywhere}
.cc622-form[hidden]{display:none!important}
.cc622-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:16px 0 7px;padding:18px;border:1px solid #c9e4ed;border-radius:20px;background:#ffffffbe}
.cc622-form label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:#476079;font-weight:850}
.cc622-form input,.cc622-form textarea,.cc622-form select{width:100%;min-height:41px;border-radius:12px;border:1px solid #bfcee6;padding:10px 12px;background:#fff;color:#203350;font:inherit;font-size:14px}
.cc622-form textarea{min-height:78px;resize:vertical}
.cc622-form .cc622-wide{grid-column:1/-1}
.cc622-assignees{max-height:148px;overflow:auto;padding:8px 10px;border:1px solid #d1dff0;border-radius:14px;background:#f8fcff}
.cc622-assignees label{flex-direction:row;align-items:center;gap:8px;font-size:13px;padding:4px}
.cc622-assignees input{min-height:0;width:auto;accent-color:#08a776}
#cc622-task-panel .cc622-status,#cc622-aria-panel .cc622-status{min-height:18px;font-size:12px;color:#365176;font-weight:750;margin-top:9px}
body.cc622-task-clean .task-filter-grid{display:none!important}
body.cc622-task-clean.cc622-show-filters .task-filter-grid{display:grid!important}
body.cc622-task-clean .task-summary-grid small,body.cc622-task-clean .task-recurring-strip small{display:none!important}
body.cc622-task-clean .task-summary-grid .metric-card{min-height:88px!important}
.task-premium-form:not(.cc622-advanced) .task-modal-grid>.field:nth-child(2),
.task-premium-form:not(.cc622-advanced) .task-modal-grid>.field:nth-child(3),
.task-premium-form:not(.cc622-advanced) .task-modal-grid>.field:nth-child(5),
.task-premium-form:not(.cc622-advanced) .task-modal-grid>.field:nth-child(6),
.task-premium-form:not(.cc622-advanced) .task-modal-grid>.field:nth-child(7),
.task-premium-form .task-quick-minute-row{display:flex!important}

/* CC26_624: everyday task is the default, recurring assignments are on demand. */
#cc622-task-panel{background:linear-gradient(125deg,#fffefa 0%,#f1f8ff 53%,#effff6 100%);border-color:#cfe5fc;padding:20px 22px;box-shadow:0 18px 44px #476d9d1e,inset 0 2px 0 #fff}
#cc622-task-panel .cc624-daily-hero{display:flex;gap:20px;justify-content:space-between;align-items:center;flex-wrap:wrap;border:1px solid #bfe3e7;border-radius:22px;padding:22px 24px;margin-bottom:16px;background:linear-gradient(112deg,#f5ffff,#f1f4ff 57%,#fff3f8);box-shadow:0 9px 26px #6392b31c,inset 0 2px 0 #fff}
#cc622-task-panel .cc624-daily-copy{flex:1 1 280px;min-width:0}
#cc622-task-panel .cc624-eyebrow{font-weight:900;font-size:13px;letter-spacing:.12em;color:#277764}
#cc622-task-panel .cc624-daily-title{font-size:clamp(22px,2.2vw,30px);color:#173456;font-weight:950;margin:7px 0;line-height:1.2}
#cc622-task-panel .cc624-daily-copy p{font-size:15px;line-height:1.5;color:#415a74;font-weight:650;margin:5px 0}
#cc622-task-panel .cc624-daily-create{border:1px solid #a5d8d4;cursor:pointer;border-radius:18px;min-height:58px;padding:14px 28px;font-size:17px;font-weight:900;color:#123b39;background:linear-gradient(110deg,#d3fff0,#bfeeff 48%,#e5d5ff);box-shadow:0 12px 30px #329b932a,inset 0 2px 0 #fff;transition:transform .16s,box-shadow .16s,background .16s}
#cc622-task-panel .cc624-daily-create:hover,#cc622-task-panel .cc624-daily-create:focus-visible{transform:translateY(-2px);color:#104633;background:linear-gradient(110deg,#aaf7d3,#a5ecf4,#d1d0ff);box-shadow:0 14px 32px #2aa98634}
#cc622-task-panel .cc624-recurring-toggle{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:16px 18px;border-radius:19px;border:1px solid #dae5fb;background:linear-gradient(115deg,#ffffff,#f4f8ff,#f1fff7)}
#cc622-task-panel .cc624-recurring-toggle strong{display:block;font-size:19px;color:#243f68;font-weight:900}
#cc622-task-panel .cc624-recurring-toggle small{display:block;margin-top:5px;font-size:14px;color:#45617a;font-weight:650}
#cc622-task-panel .cc624-recurring-details{margin-top:15px;padding:15px;border-radius:20px;border:1px solid #d9e9fa;background:linear-gradient(115deg,#fbfdff,#f5fbff,#f7fff9)}
#cc622-task-panel .cc624-recurring-details[hidden]{display:none!important}
#cc622-task-panel .cc622-title{font-size:23px;color:#1b3c67}#cc622-task-panel .cc622-sub{font-size:15px}
#cc622-task-panel .cc622-btn{font-size:15px;min-height:46px;padding:12px 19px;background:linear-gradient(115deg,#ffffff,#eff7ff,#ebfff7);color:#214365;border-color:#b9d9eb;font-weight:850}
#cc622-task-panel .cc622-btn.primary{background:linear-gradient(112deg,#d6fff1,#c7eaff,#e4dfff);color:#123d41;border:1px solid #a9d4db}
#cc622-task-panel .cc622-btn:hover{background:linear-gradient(112deg,#c8fbe2,#b9f1e6,#d9e6ff);color:#104733}
#cc622-task-panel .cc622-form label,#cc622-task-panel .cc622-assignees label{font-size:15px;color:#254363}
#cc622-task-panel .cc622-form input,#cc622-task-panel .cc622-form textarea,#cc622-task-panel .cc622-form select{min-height:48px;font-size:16px;color:#1c3854;background:#fff;border:1px solid #bcd7e7}
#cc622-task-panel .cc622-form textarea{min-height:94px}
#cc622-task-panel .cc622-assignees{max-height:210px}
#cc622-task-panel .cc622-assignees input{min-height:0}
#cc622-task-panel .cc622-card{background:linear-gradient(125deg,#fff,#f1f9ff,#f5fff7);border-color:#cbdff0}
#cc622-task-panel .cc622-card strong{font-size:18px}#cc622-task-panel .cc622-card p{font-size:15px}#cc622-task-panel .cc622-card small{font-size:14px}
body.cc622-task-clean .table-panel .table-toolbar .add-profile-btn,body.cc622-task-clean .table-panel .table-toolbar .ghost-btn{background:linear-gradient(115deg,#e5fff2,#d4eeff,#f0e5ff)!important;color:#224469!important;border:1px solid #bdd6e9!important;min-height:43px!important;font-size:15px!important;font-weight:850!important}
body.cc622-task-clean .table-panel .table-title{font-size:21px!important;color:#1d3b63!important}
body.cc622-task-clean .table-panel label{font-size:15px!important;color:#234567!important}
body.cc622-task-clean .table-panel select,body.cc622-task-clean .table-panel input{min-height:44px!important;font-size:15px!important;color:#213b5a!important;background:#fff!important}
body.cc622-task-clean .task-summary-grid .metric-card{min-height:101px!important;background:linear-gradient(120deg,#fff,#eff7ff,#effef5)!important;color:#1e4166!important;border:1px solid #c9dff1!important;box-shadow:0 8px 22px #5279a719!important}
body.cc622-task-clean .task-summary-grid .metric-card span{font-size:16px!important;color:#234669!important;font-weight:850!important}
body.cc622-task-clean .task-summary-grid .metric-card strong{font-size:29px!important;color:#173a61!important}
body.cc622-task-clean .task-premium-form label{font-size:16px!important;color:#244566!important;font-weight:850!important}
body.cc622-task-clean .task-premium-form input,body.cc622-task-clean .task-premium-form select,body.cc622-task-clean .task-premium-form textarea{font-size:16px!important;min-height:48px!important;background:#fff!important;color:#183a5b!important;border-color:#bfd5ea!important}
body.cc622-task-clean .task-premium-form textarea{min-height:115px!important}
body.cc622-task-clean .task-premium-modal .add-profile-btn,body.cc622-task-clean .task-premium-modal .ghost-btn{font-size:16px!important;min-height:47px!important;background:linear-gradient(120deg,#c8f9e7,#cbeafe,#e6ddff)!important;color:#123e59!important;border:1px solid #b4d8ec!important}
body.cc622-task-clean .task-premium-modal .panel-title{font-size:25px!important;color:#163a64!important}
body.cc622-task-clean .task-list-table td,body.cc622-task-clean .task-list-table th{font-size:15px!important;color:#243f61!important}
@media(max-width:720px){#cc622-task-panel .cc624-daily-hero{padding:18px}#cc622-task-panel .cc624-daily-create{width:100%}}



/* CC26_626: premium Gen-Z readability polish for Tasks / Recurring Work / Task modal controls. */
#cc622-task-panel .cc624-daily-hero{
  background:linear-gradient(135deg,#fff8ff 0%,#f1f7ff 44%,#eefdf8 100%)!important;
  border:1px solid #cfe2ff!important;
  box-shadow:0 18px 40px rgba(79,113,175,.18),inset 0 1px 0 rgba(255,255,255,.98)!important;
}
#cc622-task-panel .cc624-eyebrow{
  color:#16796a!important;
  text-shadow:none!important;
}
#cc622-task-panel .cc624-daily-title{
  color:#17355b!important;
  letter-spacing:-.03em!important;
}
#cc622-task-panel .cc624-daily-copy p,
#cc622-task-panel .cc624-recurring-toggle small,
#cc622-task-panel .cc622-sub,
#cc622-task-panel .cc622-card p,
#cc622-task-panel .cc622-card small{
  color:#4a6383!important;
  opacity:1!important;
}
#cc622-task-panel .cc624-daily-create,
body.cc622-task-clean .table-panel .table-toolbar .add-profile-btn,
body.cc622-task-clean .task-premium-modal .add-profile-btn{
  background:linear-gradient(135deg,#ff8d56 0%,#ff5f88 38%,#7158ff 100%)!important;
  border:1px solid rgba(255,255,255,.72)!important;
  color:#ffffff!important;
  -webkit-text-fill-color:#ffffff!important;
  text-shadow:0 1px 1px rgba(20,30,80,.22)!important;
  box-shadow:0 16px 34px rgba(114,88,255,.24),inset 0 1px 0 rgba(255,255,255,.36)!important;
}
#cc622-task-panel .cc624-daily-create:hover,
#cc622-task-panel .cc624-daily-create:focus-visible,
body.cc622-task-clean .table-panel .table-toolbar .add-profile-btn:hover,
body.cc622-task-clean .task-premium-modal .add-profile-btn:hover{
  transform:translateY(-2px)!important;
  filter:saturate(1.06) brightness(1.02)!important;
}
#cc622-task-panel .cc624-recurring-toggle,
#cc622-task-panel .cc624-recurring-details,
#cc622-task-panel .cc622-card{
  background:linear-gradient(135deg,rgba(255,255,255,.98),rgba(241,248,255,.96) 54%,rgba(245,255,249,.96) 100%)!important;
  border-color:#d7e4fb!important;
  box-shadow:0 12px 28px rgba(75,103,160,.12),inset 0 1px 0 rgba(255,255,255,.9)!important;
}
#cc622-task-panel .cc624-recurring-toggle strong,
#cc622-task-panel .cc622-title,
body.cc622-task-clean .table-panel .table-title,
body.cc622-task-clean .task-premium-modal .panel-title,
body.cc622-task-clean .task-premium-form label{
  color:#17395f!important;
}
#cc622-task-panel .cc622-badge{
  background:linear-gradient(135deg,#ecfff5,#e8f2ff)!important;
  color:#0f6f58!important;
  border:1px solid #cae6d8!important;
}
#cc622-task-panel .cc622-btn,
body.cc622-task-clean .table-panel .table-toolbar .ghost-btn,
body.cc622-task-clean .task-premium-modal .ghost-btn{
  background:linear-gradient(135deg,#ffffff 0%,#eef5ff 54%,#f4fff7 100%)!important;
  border:1px solid #c8daf3!important;
  color:#1d426c!important;
  -webkit-text-fill-color:#1d426c!important;
  box-shadow:0 10px 22px rgba(77,102,153,.13),inset 0 1px 0 rgba(255,255,255,.95)!important;
}
#cc622-task-panel .cc622-btn.primary{
  background:linear-gradient(135deg,#22c38f 0%,#1f9dc7 42%,#6a5cff 100%)!important;
  border:1px solid rgba(255,255,255,.68)!important;
  color:#ffffff!important;
  -webkit-text-fill-color:#ffffff!important;
}
#cc622-task-panel .cc622-btn:hover,
body.cc622-task-clean .table-panel .table-toolbar .ghost-btn:hover,
body.cc622-task-clean .task-premium-modal .ghost-btn:hover{
  transform:translateY(-1px)!important;
}
#cc622-task-panel .cc622-form,
body.cc622-task-clean .task-premium-form .field{
  background:linear-gradient(135deg,rgba(255,255,255,.96),rgba(243,248,255,.92) 50%,rgba(248,255,252,.92) 100%)!important;
  border-color:#d4e1f8!important;
  box-shadow:0 12px 28px rgba(80,109,161,.10),inset 0 1px 0 rgba(255,255,255,.95)!important;
}
#cc622-task-panel .cc622-form label,
#cc622-task-panel .cc622-assignees label,
body.cc622-task-clean .table-panel label,
body.cc622-task-clean .task-premium-form label,
body.cc622-task-clean .task-premium-form .field > label{
  color:#27486f!important;
  font-weight:850!important;
}
#cc622-task-panel .cc622-form input,
#cc622-task-panel .cc622-form textarea,
#cc622-task-panel .cc622-form select,
body.cc622-task-clean .table-panel select,
body.cc622-task-clean .table-panel input,
body.cc622-task-clean .task-premium-form input,
body.cc622-task-clean .task-premium-form select,
body.cc622-task-clean .task-premium-form textarea,
body.cc622-task-clean .task-premium-form .inline-input{
  background:#ffffff!important;
  border:1px solid #b8cff0!important;
  color:#173a5c!important;
  -webkit-text-fill-color:#173a5c!important;
  box-shadow:inset 0 1px 2px rgba(36,63,116,.05)!important;
}
#cc622-task-panel .cc622-form input::placeholder,
#cc622-task-panel .cc622-form textarea::placeholder,
body.cc622-task-clean .task-premium-form input::placeholder,
body.cc622-task-clean .task-premium-form textarea::placeholder,
body.cc622-task-clean .task-premium-form .inline-input::placeholder{
  color:#6d82a2!important;
  opacity:1!important;
}
body.cc622-task-clean .task-summary-grid .metric-card{
  background:linear-gradient(135deg,#1f64ff 0%,#5574ff 45%,#8b5cff 100%)!important;
  color:#ffffff!important;
  border:1px solid rgba(255,255,255,.22)!important;
  box-shadow:0 16px 30px rgba(67,92,177,.22)!important;
}
body.cc622-task-clean .task-summary-grid .metric-card.tone-green{background:linear-gradient(135deg,#06a76e 0%,#0ec98b 100%)!important}
body.cc622-task-clean .task-summary-grid .metric-card.tone-orange{background:linear-gradient(135deg,#ff8a3d 0%,#ffb347 100%)!important}
body.cc622-task-clean .task-summary-grid .metric-card.tone-red{background:linear-gradient(135deg,#ff4f72 0%,#ff7b8f 100%)!important}
body.cc622-task-clean .task-summary-grid .metric-card span,
body.cc622-task-clean .task-summary-grid .metric-card strong,
body.cc622-task-clean .task-summary-grid .metric-card small{
  color:#ffffff!important;
  -webkit-text-fill-color:#ffffff!important;
}
body.cc622-task-clean .task-premium-modal .task-assignee-option{
  background:linear-gradient(135deg,#f8fbff,#f4fffa)!important;
  color:#1d456f!important;
}
body.cc622-task-clean .task-premium-modal .task-assignee-option span{
  color:#607695!important;
}



/* CC26_627: green-gloss Task editor + animated custom dropdowns. */
#cc622-task-panel .cc624-daily-hero,
#cc622-task-panel .cc624-recurring-toggle,
#cc622-task-panel .cc624-recurring-details,
#cc622-task-panel .cc622-card{
  background:linear-gradient(135deg,#fbfffc 0%,#effff6 48%,#e9fff5 100%)!important;
  border-color:#bdebd2!important;
  box-shadow:0 16px 38px rgba(7,124,83,.12),inset 0 1px 0 #fff!important;
}
#cc622-task-panel .cc624-daily-create,
#cc622-task-panel .cc622-btn.primary,
body.cc622-task-clean .table-panel .table-toolbar .add-profile-btn,
body.cc622-task-clean .task-premium-modal .add-profile-btn{
  background:linear-gradient(118deg,#057a55 0%,#08b67c 38%,#2ad29b 67%,#0b8f6a 100%)!important;
  background-size:220% 220%!important;
  animation:cc627GreenShine 4.8s ease infinite!important;
  color:#fff!important;-webkit-text-fill-color:#fff!important;
  border:1px solid rgba(255,255,255,.62)!important;
  text-shadow:0 1px 1px rgba(0,62,42,.3)!important;
  box-shadow:0 13px 30px rgba(0,133,90,.26),inset 0 1px 0 rgba(255,255,255,.42)!important;
}
#cc622-task-panel .cc624-daily-create:hover,
#cc622-task-panel .cc622-btn.primary:hover,
body.cc622-task-clean .table-panel .table-toolbar .add-profile-btn:hover,
body.cc622-task-clean .task-premium-modal .add-profile-btn:hover{
  transform:translateY(-2px) scale(1.035)!important;
  box-shadow:0 18px 38px rgba(0,138,93,.34),0 0 0 4px rgba(44,213,155,.10)!important;
}
#cc622-task-panel .cc622-btn,
body.cc622-task-clean .table-panel .table-toolbar .ghost-btn,
body.cc622-task-clean .task-premium-modal .ghost-btn{
  background:linear-gradient(135deg,#ffffff,#effff6 55%,#e8fff2)!important;
  border-color:#bfe8d2!important;
  color:#176047!important;-webkit-text-fill-color:#176047!important;
}
body.cc622-task-clean .task-summary-grid .metric-card,
body.cc622-task-clean .task-summary-grid .metric-card.tone-purple,
body.cc622-task-clean .task-summary-grid .metric-card.tone-green,
body.cc622-task-clean .task-summary-grid .metric-card.tone-orange,
body.cc622-task-clean .task-summary-grid .metric-card.tone-red{
  background:linear-gradient(125deg,#087955 0%,#0caf78 44%,#31d39e 76%,#0b8e68 100%)!important;
  background-size:220% 220%!important;
  animation:cc627GreenShine 5.5s ease infinite!important;
  border-color:rgba(255,255,255,.45)!important;
  box-shadow:0 14px 30px rgba(0,119,79,.20),inset 0 1px 0 rgba(255,255,255,.38)!important;
}
body.cc622-task-clean .task-summary-grid .metric-card:nth-child(2){animation-delay:-1.1s!important}
body.cc622-task-clean .task-summary-grid .metric-card:nth-child(3){animation-delay:-2.0s!important}
body.cc622-task-clean .task-summary-grid .metric-card:nth-child(4){animation-delay:-3.0s!important}
body.cc622-task-clean .task-summary-grid .metric-card:nth-child(5){animation-delay:-4.0s!important}
@keyframes cc627GreenShine{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}

/* Browser-native <option> hover cannot animate reliably. CC26_627 renders a lightweight custom menu only inside the Task modal. */
.task-premium-form .cc627-select{position:relative!important;width:100%!important;z-index:1!important}
.task-premium-form .cc627-select.open{z-index:500!important}
.task-premium-form select.cc627-native-select{
  position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important;
}
.task-premium-form .cc627-select-trigger{
  width:100%!important;min-height:49px!important;display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;
  border:1px solid #a9dfc3!important;border-radius:13px!important;padding:10px 13px!important;cursor:pointer!important;
  background:linear-gradient(135deg,#ffffff 0%,#f0fff7 55%,#e8fff2 100%)!important;
  color:#174c3b!important;-webkit-text-fill-color:#174c3b!important;font:850 15px/1.2 "Plus Jakarta Sans","Segoe UI",sans-serif!important;
  box-shadow:0 7px 18px rgba(7,123,81,.10),inset 0 1px 0 #fff!important;transition:.18s ease!important;text-align:left!important;
}
.task-premium-form .cc627-select-trigger:hover,.task-premium-form .cc627-select.open .cc627-select-trigger{
  transform:translateY(-1px)!important;border-color:#37c990!important;
  background:linear-gradient(120deg,#eafff4,#d8ffeb,#edfff6)!important;
  box-shadow:0 12px 26px rgba(6,145,94,.18),0 0 0 3px rgba(45,207,151,.10)!important;
}
.task-premium-form .cc627-select-arrow{font-size:15px!important;color:#0a8c61!important;transition:transform .18s ease!important}
.task-premium-form .cc627-select.open .cc627-select-arrow{transform:rotate(180deg)!important}
.task-premium-form .cc627-select-menu{
  position:absolute!important;left:0!important;right:0!important;top:calc(100% + 7px)!important;z-index:2147483000!important;
  max-height:248px!important;overflow:auto!important;padding:8px!important;border:1px solid #b8e6ce!important;border-radius:16px!important;
  background:linear-gradient(145deg,rgba(255,255,255,.99),rgba(237,255,246,.99))!important;
  box-shadow:0 24px 50px rgba(6,92,64,.22),inset 0 1px 0 #fff!important;backdrop-filter:blur(12px)!important;
}
.task-premium-form .cc627-select-menu[hidden]{display:none!important}
.task-premium-form .cc627-select-option{
  width:100%!important;display:flex!important;align-items:center!important;justify-content:space-between!important;text-align:left!important;
  min-height:42px!important;margin:3px 0!important;padding:9px 11px!important;border:1px solid transparent!important;border-radius:11px!important;
  background:transparent!important;color:#1f4c3d!important;-webkit-text-fill-color:#1f4c3d!important;
  font:800 14px/1.25 "Plus Jakarta Sans","Segoe UI",sans-serif!important;cursor:pointer!important;
  transform-origin:left center!important;transition:transform .14s ease,box-shadow .14s ease,background .14s ease,color .14s ease!important;
}
.task-premium-form .cc627-select-option:hover,
.task-premium-form .cc627-select-option:focus-visible{
  transform:translateX(5px) scale(1.045)!important;
  background:linear-gradient(118deg,#057a55 0%,#08b67c 48%,#32d49f 100%)!important;
  color:#fff!important;-webkit-text-fill-color:#fff!important;border-color:rgba(255,255,255,.55)!important;
  box-shadow:0 10px 22px rgba(0,126,84,.24),inset 0 1px 0 rgba(255,255,255,.35)!important;outline:none!important;
}
.task-premium-form .cc627-select-option.is-selected{
  background:linear-gradient(135deg,#dffff0,#caffdf)!important;color:#075d3e!important;-webkit-text-fill-color:#075d3e!important;border-color:#96dbb8!important;
}
.task-premium-form .cc627-select-option.is-selected::after{content:"✓";font-weight:1000!important;color:#07875c!important}

@media(max-width:650px){#cc622-task-panel,#cc622-aria-panel{padding:14px}.cc622-grid{grid-template-columns:1fr}}
`;document.head.append(style);
function readCached(key){try{var r=sessionStorage.getItem(key)||localStorage.getItem(key),j=JSON.parse(r||'null');return j&&Object.prototype.hasOwnProperty.call(j,'data')?j.data:j;}catch(_){return null;}}
function writeCached(key,data){try{sessionStorage.setItem(key,JSON.stringify({cachedAt:Date.now(),data:data}));}catch(_){}}
function projected(row){
 if(!row||row.recurring_parent_task_id!=='CC_PERMANENT_V1'||['stopped','cancelled','canceled','deleted','archived'].includes(safe(row.status).toLowerCase()))return row;
 var start=safe(row.permanent_start_date||row.due_date).slice(0,10),end=safe(row.permanent_end_date||(safe(row.recurring_interval_minutes).match(/^UNTIL:(\d{4}-\d{2}-\d{2})$/)||[])[1]),day=today();
 var delta=Math.round((Date.parse(day+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000),weekly=safe(row.recurring_type).toLowerCase()==='weekly',active=delta>=0&&(!end||day<=end)&&(!weekly||delta%7===0);
 var done=active&&['completed','closed','done'].includes(safe(row.status).toLowerCase())&&new Date(row.closed_at||0).getTime()>0&&new Date(new Date(row.closed_at).getTime()+IST).toISOString().slice(0,10)===day;
 return Object.assign({},row,{permanent_start_date:start,permanent_end_date:end,permanent_today:active,status:active?(done?'Completed':'Open'):(end&&day>end?'Expired':'Scheduled'),due_date:active?day+safe(row.due_date).slice(10):row.due_date});
}
function getTaskRows(){var cached=readCached('careerCroxTasksRows:v2');return (Array.isArray(manualTaskRows)?manualTaskRows:(Array.isArray(cached)?cached:[])).map(projected);}
async function apiJson(path,options){var response=await fetch(path,Object.assign({credentials:'same-origin',cache:'no-store'},options||{}));var data=await response.json().catch(function(){return {};});if(!response.ok)throw Error(data.message||'Could not connect to CRM.');return data;}
function permanentRows(){return getTaskRows().filter(function(x){return x&&x.recurring_parent_task_id==='CC_PERMANENT_V1';});}
function renderTasks(force){
 if(!tPanel||!tPanel.isConnected)return;
 var currentDay=today();
 if(!force && currentDay===lastTaskDay && Date.now()-lastTaskPaint<1200)return;
 lastTaskDay=currentDay;lastTaskPaint=Date.now();
 var rows=permanentRows(),signature=JSON.stringify(rows.map(function(x){return [x.task_id,x.title,x.assigned_to_name,x.status,x.closed_at,x.due_date,x.permanent_end_date,x.updated_at];}));
 if(!force&&signature===lastTasks)return;lastTasks=signature;
 var host=tPanel.querySelector('#cc622-task-cards');if(!host)return;host.replaceChildren();
 var count=tPanel.querySelector('#cc622-permanent-count');if(count)count.textContent=rows.length+' saved assignments';
 if(!rows.length){host.append(make('p','cc622-sub','No permanent tasks yet. Assign one once; it will be shown every scheduled day without a nightly database job.'));return;}
 rows.forEach(function(raw){var row=projected(raw),card=make('article','cc622-card');
  card.append(make('strong','',row.title||'Untitled task'));
  card.append(make('small','',safe(row.assigned_to_name||'Team member')+' • '+(row.recurring_type==='weekly'?'Every week':'Every day')+' • '+(row.permanent_end_date?'Until '+row.permanent_end_date:'No end date')));
  card.append(make('span','cc622-badge',row.permanent_today?(safe(row.status).toLowerCase()==='open'?'TODAY · OPEN':'TODAY · COMPLETE'):(row.status==='Expired'?'FINISHED':row.status==='Stopped'?'STOPPED':'NEXT SCHEDULED')));
  var details=make('p','',row.description||''),actions=make('div','cc622-actions');details.hidden=true;
  var view=make('button','cc622-btn','Details');view.type='button';view.onclick=function(){details.hidden=!details.hidden;view.textContent=details.hidden?'Details':'Hide details';};actions.append(view);
  if(row.permanent_today && !['completed','closed','done'].includes(safe(row.status).toLowerCase())){
    var complete=make('button','cc622-btn primary','Mark done today');complete.type='button';complete.onclick=async function(){complete.disabled=true;complete.textContent='Saving…';try{var result=await apiJson('/api/tasks/'+encodeURIComponent(row.task_id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'Completed'})});var updated=result.item||Object.assign({},row,{status:'Completed',closed_at:new Date().toISOString()});var all=getTaskRows().map(function(v){return safe(v.task_id)===safe(row.task_id)?Object.assign({},v,updated):v;});manualTaskRows=all;writeCached('careerCroxTasksRows:v2',all);statusText('Today’s completion saved. The same task will reappear on its next scheduled day.');renderTasks(true);}catch(error){statusText(error.message);complete.disabled=false;complete.textContent='Mark done today';}};actions.append(complete);
  }
  if(!['Stopped','Expired'].includes(row.status)){var stop=make('button','cc622-btn','Stop repeating');stop.type='button';stop.onclick=async function(){stop.disabled=true;try{var d=await apiJson('/api/tasks/'+encodeURIComponent(row.task_id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'stop_repeating'})});manualTaskRows=getTaskRows().map(function(v){return safe(v.task_id)===safe(row.task_id)?Object.assign({},v,d.item):v;});writeCached('careerCroxTasksRows:v2',manualTaskRows);renderTasks(true);}catch(e){statusText(e.message);stop.disabled=false;}};actions.append(stop);}card.append(details,actions);host.append(card);
 });
}
function mountTasks(){
 if(document.querySelector('.cc918-tasks')){document.querySelectorAll('.cc630-permanent-task-panel').forEach(n=>n.remove());return;}

 if(tPanel&&tPanel.isConnected){renderTasks(false);return;}
 var container=document.querySelector('.task-summary-grid');if(!container)return;
 tPanel=make('section','');tPanel.id='cc622-task-panel';
 tPanel.innerHTML='<div class="cc624-daily-hero"><div class="cc624-daily-copy"><span class="cc624-eyebrow">TASKS · YOUR WORKSPACE</span><div class="cc624-daily-title">Create a task for today</div><p>Make an everyday, one-time task in seconds. Repeat only when you choose Recurring Work below.</p></div><button type="button" id="cc624-create-daily" class="cc624-daily-create">＋ Create Task</button></div><div class="cc624-recurring-toggle"><div><strong>↻ Recurring Work</strong><small>Choose a time, recipients and an optional end date. Repeat until you stop.</small></div><div class="cc622-actions"><span class="cc622-badge" id="cc624-recurring-badge">Optional</span><button type="button" id="cc624-toggle-recurring" class="cc622-btn" aria-expanded="false" aria-controls="cc624-recurring-content">＋ Set Up Recurring Work</button></div></div><div id="cc624-recurring-content" class="cc624-recurring-details" hidden><div class="cc622-head"><div><div class="cc622-title">✦ Permanent Tasks</div><p class="cc622-sub">Assign once. Everyone sees today’s work whenever they open Tasks. No nightly task creation or auto-refresh.</p></div><div class="cc622-actions"><span class="cc622-badge" id="cc622-permanent-count">0 saved assignments</span><button type="button" id="cc622-add-task" class="cc622-btn primary">+ New permanent task</button><button type="button" id="cc622-refresh-task" class="cc622-btn">↻ Refresh now</button><button type="button" id="cc622-filter-task" class="cc622-btn">Filters</button></div></div><form class="cc622-form" id="cc622-form" hidden><label>Task title<input name="title" maxlength="160" required placeholder="Daily follow-up calls"></label><label>Repeat<select name="recurring_type"><option value="daily">Every day</option><option value="weekly">Every week</option></select></label><label class="cc622-wide">Instructions<textarea name="description" maxlength="5000" required placeholder="What should be completed?"></textarea></label><label>Starts on (IST)<input type="date" name="start" required></label><label>Time (IST)<input type="time" name="time" value="11:00" required></label><label>Repeat until<select name="end_mode"><option value="forever">Until I stop</option><option value="date">Choose an end date</option></select><input type="date" name="end" hidden></label><label>Delivery<select name="auto_schedule"><option value="0">Assign now</option><option value="1">Auto schedule</option></select></label><label>Deliver at (IST)<input type="datetime-local" name="deliver_at"></label><label class="cc622-wide"><button type="button" id="cc917-select-all" class="cc622-btn">Select All / Clear</button></label><label class="cc622-wide">Assign to employees<div class="cc622-assignees" id="cc622-assignees">Choose New permanent task to load names.</div></label><div class="cc622-actions cc622-wide"><button type="submit" class="cc622-btn primary" id="cc622-save-task">Assign permanent task</button><button type="button" class="cc622-btn" id="cc622-close-form">Cancel</button></div></form><div class="cc622-status" id="cc622-task-status" role="status"></div><div id="cc622-task-cards" class="cc622-grid"></div></div>';
 container.parentNode.insertBefore(tPanel,container);
 try{var me=JSON.parse(localStorage.getItem('careerCroxCachedUser')||'null')||{},role=safe(me.role||me.designation).toLowerCase();if(!['admin','manager','tl','team lead','teamlead'].includes(role))tPanel.querySelector('#cc622-add-task').hidden=true;}catch(_){}
 document.body.classList.add('cc622-task-clean');
 var form=tPanel.querySelector('#cc622-form');form.elements.start.value=today();
 form.elements.end_mode.onchange=function(){form.elements.end.hidden=this.value!=='date';form.elements.end.required=this.value==='date';if(this.value!=='date')form.elements.end.value='';};
 tPanel.querySelector('#cc917-select-all').onclick=function(){var boxes=[...tPanel.querySelectorAll('#cc622-assignees input[type=checkbox]')],all=boxes.every(c=>c.checked);boxes.forEach(c=>c.checked=!all);};
 var toggle=tPanel.querySelector('#cc624-toggle-recurring'),recurringBody=tPanel.querySelector('#cc624-recurring-content');
 toggle.onclick=function(){var expanded=toggle.getAttribute('aria-expanded')==='true';toggle.setAttribute('aria-expanded',String(!expanded));recurringBody.hidden=expanded;document.body.classList.toggle('cc624-recurring-open',!expanded);toggle.textContent=expanded?'＋ Set Up Recurring Work':'− Hide Recurring Work';if(!expanded){renderTasks(true);}};

 // CC26_630: SAMPLE test data is never a CRM UI action. No auto-seed on deploy or login.
 tPanel.querySelector('#cc624-create-daily').onclick=function(){var btn=document.querySelector('.table-panel .table-toolbar .add-profile-btn');if(!btn){statusText('Task editor is still opening. Please try again.');return;}btn.click();};
 tPanel.querySelector('#cc622-filter-task').onclick=function(){document.body.classList.toggle('cc622-show-filters');};
 tPanel.querySelector('#cc622-close-form').onclick=function(){form.hidden=true;};
 tPanel.querySelector('#cc622-add-task').onclick=async function(){
  form.hidden=false;form.elements.title.focus();var host=tPanel.querySelector('#cc622-assignees');
  var users=cc631CachedEmployees();
  if(!users.length){host.textContent='Getting employee names automatically…';users=await cc631FetchEmployees(true);}
  if(!users.length){host.textContent='Employee directory is unavailable. Reopen this form after connection returns.';return;}
  host.replaceChildren();users.filter(function(u){return u&&u.user_id&&!['0','false','disabled','deleted'].includes(safe(u.is_active).toLowerCase());}).forEach(function(u){var label=make('label'),check=make('input');check.type='checkbox';check.value=u.user_id;label.append(check,document.createTextNode(' '+safe(u.full_name||u.username||u.user_id)));host.append(label);});
 };
 tPanel.querySelector('#cc622-refresh-task').onclick=async function(e){e.currentTarget.disabled=true;statusText('Refreshing only on your request…');try{var data=await apiJson('/api/tasks?_refresh='+Date.now());manualTaskRows=Array.isArray(data.items)?data.items:[];writeCached('careerCroxTasksRows:v2',manualTaskRows);renderTasks(true);statusText('Tasks updated manually.');}catch(error){statusText(error.message);}finally{e.currentTarget.disabled=false;}};
 form.onsubmit=async function(event){event.preventDefault();var btn=tPanel.querySelector('#cc622-save-task');var title=form.elements.title.value.trim(),description=form.elements.description.value.trim(),start=form.elements.start.value,end=form.elements.end.value,type=form.elements.recurring_type.value,ids=[...tPanel.querySelectorAll('#cc622-assignees input:checked')].map(function(e){return e.value;});
  if(!ids.length){statusText('Please select at least one employee.');return;}if(end&&end<start){statusText('End date must be on or after start date.');return;}btn.disabled=true;btn.textContent='Assigning…';statusText('Saving your task…');
  try{var body={title:title,description:description,assigned_to_user_id:ids[0],assigned_to_user_ids:ids,priority:'Normal',status:'Open',due_date:start+'T'+form.elements.time.value,auto_schedule:form.elements.auto_schedule.value,deliver_at:form.elements.deliver_at.value||start+'T'+form.elements.time.value,recurring_type:type,permanent_task:'1',permanent_end_date:end,client_request_id:'permanent-'+Date.now()+'-'+Math.random().toString(36).slice(2)};
    var d=await apiJson('/api/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});var items=Array.isArray(d.items)?d.items:[d.item].filter(Boolean);var rows=getTaskRows().concat(items);manualTaskRows=rows;writeCached('careerCroxTasksRows:v2',rows);form.hidden=true;form.reset();form.elements.start.value=today();renderTasks(true);statusText(items.length+' permanent assignment(s) saved. Each scheduled day appears from this one task record.');
  }catch(error){statusText(error.message);}finally{btn.disabled=false;btn.textContent='Assign permanent task';}
 };
 lastTasks='';renderTasks(true);
}

function enhanceTaskDropdowns627(form){if(window.__CC_PREMIUM_SELECT_REACT_OWNER__)return;
 if(!form||form.dataset.cc627Dropdowns==='1')return;form.dataset.cc627Dropdowns='1';
 if(!window.__CC627_DROPDOWN_DOC__){window.__CC627_DROPDOWN_DOC__=true;document.addEventListener('click',function(e){document.querySelectorAll('.cc627-select.open').forEach(function(w){if(w.contains(e.target))return;w.classList.remove('open');var m=w.querySelector('.cc627-select-menu');if(m)m.hidden=true;});},true);}
 Array.from(form.querySelectorAll('select')).forEach(function(sel){
  if(sel.dataset.cc627Enhanced)return;sel.dataset.cc627Enhanced='1';sel.classList.add('cc627-native-select');sel.tabIndex=-1;
  var wrap=make('div','cc627-select'),trigger=make('button','cc627-select-trigger'),label=make('span','cc627-select-label'),arrow=make('span','cc627-select-arrow','⌄'),menu=make('div','cc627-select-menu');
  trigger.type='button';menu.hidden=true;trigger.append(label,arrow);sel.parentNode.insertBefore(wrap,sel.nextSibling);wrap.append(trigger,menu);
  function currentText(){var opt=sel.options&&sel.selectedIndex>=0?sel.options[sel.selectedIndex]:null;return opt?safe(opt.textContent||opt.label||opt.value):'Choose option';}
  function syncLabel(){label.textContent=currentText();}
  function choose(value){
    try{var setter=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value')?.set;if(setter)setter.call(sel,value);else sel.value=value;}catch(_){sel.value=value;}
    sel.dispatchEvent(new Event('input',{bubbles:true}));sel.dispatchEvent(new Event('change',{bubbles:true}));syncLabel();wrap.classList.remove('open');menu.hidden=true;
  }
  function rebuild(){menu.replaceChildren();Array.from(sel.options||[]).forEach(function(opt){var b=make('button','cc627-select-option',safe(opt.textContent||opt.label||opt.value));b.type='button';b.dataset.value=safe(opt.value);if(String(opt.value)===String(sel.value))b.classList.add('is-selected');b.onclick=function(ev){ev.preventDefault();ev.stopPropagation();choose(opt.value);};menu.append(b);});
  if(sel.options.length<=1 && /assignee|assign to/i.test(String(sel.parentNode?.querySelector('label')?.textContent||''))){
    var loading=make('div','cc627-select-empty',cc631EmployeesPromise?'Loading employee names…':'Connecting to employee directory…');
    menu.append(loading);
    // The existing React select is populated by a small per-user event, not a manual button.
    cc631FetchEmployees(false).then(function(rows){
      if(!wrap.isConnected||!wrap.classList.contains('open'))return;
      if(rows.length){loading.textContent='Employee names available';setTimeout(function(){if(wrap.isConnected&&wrap.classList.contains('open')&&sel.options.length>1)rebuild();},120);}
      else loading.textContent='Employees unavailable — will retry when connection returns';
    });
  }
 }
  trigger.onclick=function(ev){ev.preventDefault();ev.stopPropagation();document.querySelectorAll('.cc627-select.open').forEach(function(other){if(other===wrap)return;other.classList.remove('open');var om=other.querySelector('.cc627-select-menu');if(om)om.hidden=true;});var opening=!wrap.classList.contains('open');if(opening){rebuild();wrap.classList.add('open');menu.hidden=false;}else{wrap.classList.remove('open');menu.hidden=true;}};
  trigger.onkeydown=function(ev){if(ev.key==='ArrowDown'||ev.key==='Enter'||ev.key===' '){ev.preventDefault();if(!wrap.classList.contains('open'))trigger.click();setTimeout(function(){menu.querySelector('.is-selected,.cc627-select-option')?.focus();},0);}else if(ev.key==='Escape'){wrap.classList.remove('open');menu.hidden=true;}};
  sel.addEventListener('change',function(){syncLabel();});syncLabel();
 });
}

function enhanceLegacyTaskForm(){if(location.pathname!=='/tasks')return;var taskHeader=document.querySelector('.table-panel .table-toolbar .add-profile-btn');if(taskHeader&&taskHeader.textContent.trim()==='Task Saved'&&!document.querySelector('.task-premium-form'))taskHeader.textContent='＋ Create Task';var form=document.querySelector('.task-premium-form');if(!form)return;enhanceTaskDropdowns627(form);if(!form.dataset.cc631EmployeeBoot){form.dataset.cc631EmployeeBoot='1';cc631FetchEmployees(!cc631CachedEmployees().length);}if(form.dataset.cc622Clean)return;form.dataset.cc622Clean='1';var button=make('button','cc622-btn','More options · Repeat / Second assignee / Status');button.type='button';button.style.margin='6px 0';button.onclick=function(){var advanced=form.classList.toggle('cc622-advanced');button.textContent=advanced?'Fewer options':'More options · Repeat / Second assignee / Status';};var grid=form.querySelector('.task-modal-grid');if(grid)form.insertBefore(button,grid);}
function mountAdmin(){
 if(document.querySelector('.cc801-admin-workspace')){if(aPanel&&aPanel.isConnected)aPanel.remove();aPanel=null;return;}
 if(aPanel&&aPanel.isConnected)return;
 var toolbar=document.querySelector('.admin-import-panel,.panel .panel-title');var root=document.querySelector('.main-wrap');if(!root)return;
 var panelTarget=document.querySelector('.admin-import-panel')?.parentNode||root.querySelector('.top-gap')||root;
 aPanel=make('section');aPanel.id='cc622-aria-panel';aPanel.innerHTML='<div class="cc622-head"><div><div class="cc622-title">◈ ARIA reporting schedule</div><p class="cc622-sub">India time (IST). ARIA reports each 30 minutes within these hours, including zero-work employees. Other night-time auto refresh stays OFF.</p></div><span class="cc622-badge">Manager controls</span></div><div class="cc622-form"><label>Start time · IST<input type="time" id="cc622-aria-start" step="1800" value="09:00"></label><label>End time · IST<input type="time" id="cc622-aria-end" step="1800" value="21:00"></label><div class="cc622-actions cc622-wide"><button type="button" id="cc622-aria-save" class="cc622-btn primary">Save ARIA timing</button><button type="button" id="cc622-aria-load" class="cc622-btn">↻ Load saved timing</button></div></div><div class="cc622-status" id="cc622-aria-status" role="status">Default: 09:00–21:00 IST; last report is published around the end time.</div>';
 panelTarget.parentNode.insertBefore(aPanel,panelTarget);
 var last=readCached('cc622_aria_times');if(last&&last.start&&last.end){aPanel.querySelector('#cc622-aria-start').value=last.start;aPanel.querySelector('#cc622-aria-end').value=last.end;}
 function applyTime(data){var settings=data?.lock_settings;if(!settings)return;var st=settings.aria_report_start_time,en=settings.aria_report_end_time;if(!st||!en)return;aPanel.querySelector('#cc622-aria-start').value=st;aPanel.querySelector('#cc622-aria-end').value=en;ariaTimes={start:st,end:en};writeCached('cc622_aria_times',ariaTimes);}
 if(ariaTimes)applyTime({lock_settings:{aria_report_start_time:ariaTimes.start,aria_report_end_time:ariaTimes.end}});
 window.addEventListener('cc622:admin-settings',function(e){if(aPanel?.isConnected)applyTime(e.detail||{});});
 aPanel.querySelector('#cc622-aria-save').onclick=async function(event){var btn=event.currentTarget,st=aPanel.querySelector('#cc622-aria-start').value,en=aPanel.querySelector('#cc622-aria-end').value,status=aPanel.querySelector('#cc622-aria-status');var v=function(s){if(!/^\d\d:(00|30)$/.test(s))return NaN;var t=s.split(':').map(Number);return t[0]*60+t[1];};if(!Number.isFinite(v(st))||!Number.isFinite(v(en))||v(st)>=v(en)||v(en)-v(st)<30){status.textContent='Choose valid half-hour steps with end at least 30 minutes after start.';return;}btn.disabled=true;status.textContent='Saving ARIA schedule…';try{var d=await apiJson('/api/admin/lock-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({aria_report_start_time:st,aria_report_end_time:en})});applyTime(d);status.textContent='Saved. ARIA now reports from '+st+' to '+en+' IST; other overnight auto-updates remain disabled.';}catch(err){status.textContent=err.message;}finally{btn.disabled=false;}};
 aPanel.querySelector('#cc622-aria-load').onclick=async function(event){var btn=event.currentTarget;btn.disabled=true;try{var d=await apiJson('/api/admin/aria-schedule');applyTime(d);aPanel.querySelector('#cc622-aria-status').textContent='Current ARIA time loaded manually (no database read).';}catch(err){aPanel.querySelector('#cc622-aria-status').textContent=err.message;}finally{btn.disabled=false;}};
}
// Observe only DOM composition; NEVER fetch on a timer or MutationObserver.
// Capture existing Admin response without an extra Supabase/Render request.
var priorFetch=window.fetch.bind(window);
window.fetch=function(url,options){var pathname='';try{pathname=new URL(url?.url||url,location.href).pathname;}catch(_){}return priorFetch(url,options).then(function(res){if(pathname==='/api/admin'&&res.ok){res.clone().json().then(function(d){if(d?.lock_settings){ariaTimes={start:d.lock_settings.aria_report_start_time||'09:00',end:d.lock_settings.aria_report_end_time||'21:00'};window.dispatchEvent(new CustomEvent('cc622:admin-settings',{detail:d}));}}).catch(function(){});}return res;});};
function tick(){uiScheduled=false;if(window.__CC602_NETWORK_PAUSED__)return;var page=location.pathname;
 if(page!=='/tasks'&&tPanel){tPanel.remove();tPanel=null;lastTasks='';}if(page!=='/admin'&&aPanel){aPanel.remove();aPanel=null;}
 if(page==='/tasks'){mountTasks();enhanceLegacyTaskForm();}
 else if(page==='/admin'){mountAdmin();document.body.classList.remove('cc622-task-clean','cc622-show-filters');}
 else{document.body.classList.remove('cc622-task-clean','cc622-show-filters');}
}
function schedule(){if(uiScheduled)return;var page=location.pathname;if(page!=='/tasks'&&page!=='/admin'&&!tPanel&&!aPanel)return;
 if(page==='/tasks'&&tPanel?.isConnected&&!document.querySelector('.task-premium-form')){if(!document.querySelector('.task-summary-grid'))return;}
 uiScheduled=true;(window.requestAnimationFrame||setTimeout)(tick,0);
}
var observer=new MutationObserver(schedule);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){observer.observe(document.querySelector('#root')||document.body,{childList:true,subtree:true});schedule();},{once:true});else{observer.observe(document.querySelector('#root')||document.body,{childList:true,subtree:true});schedule();}
window.addEventListener('popstate',schedule);
window.addEventListener('career-crox-idle-lock-begin',function(){observer.disconnect();});
})();


;/* CC26_754: retired late Team Chat DOM polisher.
   Employee search and premium Team Chat styling are React/CSS-owned now.
   Kept as a tiny compatibility file so old cached HTML never 404s. */
(function(){
  'use strict';
  window.__cc584ChatPatchReady=true;
  window.__CC754_CHAT_REACT_OWNED__=true;
})();


;/* CC26_754 — manager approval popup only. Team Chat is React/CSS-owned. */
(function(){
  'use strict';
  if(window.__cc585PatchReady)return;
  window.__cc585PatchReady=true;
  const DISMISS_KEY='cc585_dismissed_unlock_request';

  function approvalBtn(){return document.querySelector('.top-pill[data-pill="approvals"]');}
  function currentPopup(){return document.getElementById('cc497-unlock-approval');}
  function requestId(p){return String((p||currentPopup())?.getAttribute('data-request-id')||'');}
  function dismissedId(){try{return sessionStorage.getItem(DISMISS_KEY)||''}catch(_){return''}}
  function markDismissed(p){const id=requestId(p);if(id)try{sessionStorage.setItem(DISMISS_KEY,id)}catch(_){} }
  function clearDismissed(){try{sessionStorage.removeItem(DISMISS_KEY)}catch(_){} }
  function hidePopup(p){p=p||currentPopup();if(!p)return;markDismissed(p);p.remove();}

  function injectStyle(){
    if(document.getElementById('cc585-premium-style'))return;
    const s=document.createElement('style');s.id='cc585-premium-style';s.textContent=`
#cc497-unlock-approval{filter:drop-shadow(0 24px 52px rgba(26,45,92,.30))!important}
@keyframes cc585GlassShine{0%,55%{transform:translateX(-36%) rotate(-8deg);opacity:0}68%{opacity:.8}100%{transform:translateX(220%) rotate(-8deg);opacity:0}}
`;
    document.head.appendChild(s);
  }

  function beautifyPopup(){
    const p=currentPopup();if(!p)return;
    const id=requestId(p);
    if(id&&id===dismissedId()){p.remove();return;}
    p.setAttribute('data-cc585','1');
  }

  async function oneClickReject(btn,p){
    const id=requestId(p);if(!id)return;
    btn.disabled=true;btn.textContent='Rejecting…';p.remove();
    try{
      const r=await fetch('/api/approvals/reject',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'unlock',id:id,reason:'Rejected by manager from approval popup.'})});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'Reject failed');
      clearDismissed();p.remove();approvalBtn()?.classList.remove('cc498-approval-urgent');
    }catch(e){btn.disabled=false;btn.textContent='Reject';if(!currentPopup()){document.body.appendChild(p);beautifyPopup();}alert(e.message||'Reject failed');}
  }

  document.addEventListener('click',function(ev){
    const p=currentPopup();
    if(!p)return;
    const t=ev.target instanceof Element?ev.target:null;
    if(t&&p.contains(t)){
      const b=t.closest('button');
      if(false&&b&&/^reject$/i.test((b.textContent||'').trim())){ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();oneClickReject(b,p);return;}
      if(b&&/open approvals/i.test(b.textContent||'')){markDismissed(p);setTimeout(()=>{if(p.isConnected)p.remove();},0);return;}
    }else if(t){hidePopup(p);}
  },true);

  injectStyle();
  beautifyPopup();
  const obs=new MutationObserver(function(records){
    for(const record of records){
      for(const node of record.addedNodes||[]){
        if(!(node instanceof Element))continue;
        if(node.id==='cc497-unlock-approval'||node.querySelector?.('#cc497-unlock-approval')){beautifyPopup();return;}
      }
    }
  });
  const start=()=>{if(document.body)obs.observe(document.body,{childList:true,subtree:true});};
  if(document.body)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
})();


/* CC804: Resume panels are owned by React. The obsolete file-removal observer is retired. */

;(function(){
  if(window.__CC730_CLIENT_FIXES__) return;
  window.__CC730_CLIENT_FIXES__ = true;
  window.__CC730_DIRECT_REMINDER_OWNER__ = true;
  // CC869: retire a fallback installed before this script finished loading.
  window.dispatchEvent(new CustomEvent('career-crox-reminder-owner-changed', {detail:{owner:'sidebar'}}));
  document.querySelectorAll('.cc391-reminder-deck').forEach(function(el){el.remove();});

  const IST_OFFSET_MS = 330 * 60 * 1000;
  let SUBMISSION_REMINDER_OFFSET_MS = 5 * 60 * 1000;
  const LOCAL_REMINDER_HEARTBEAT_MS = 5 * 1000;
  const PRE_DUE_BUFFER_MS = 20000;
  const LOGO_FALLBACKS = [
    '/assets/img/career-crox-brand.png',
    '/assets/img/career-crox-sidebar-brand.png',
    '/assets/img/career-crox-logo.svg',
    '/assets/img/career-crox-brand-icon.png'
  ];
  const TERMINAL_INTERVIEW_STATUSES = new Set(['joined','joining','selected','rejected','cancelled','declined','closed']);
  const SNOOZE_OPTIONS = [
    { label: '5m', minutes: 5 },
    { label: '30m', minutes: 30 },
    { label: '1h', minutes: 60 },
    { label: '3h', minutes: 180 }
  ];

  let popupHideTimer=null;const autoHidden=new Map();
  function popupPrefs(){const p=window.__CC875_POPUP_SETTINGS__?.()||{managerTeamPopups:true,popupAutoHide:true,popupSeconds:10};return ['manager','admin'].includes(currentRole())?p:{...p,managerTeamPopups:true,popupAutoHide:false};}
  function popupOccurrence(config){return config.key+':'+String(config.localKey||config.dueAt||'');}
  function popupWasHidden(config){return ['manager','admin'].includes(currentRole())&&Number(autoHidden.get(popupOccurrence(config))||0)>Date.now();}
  let popupEl = null;
  let popupKey = '';
  let pollTimer = null;
  let localReminderClockTimer=null;
  let reminderSyncChannel=null;
  let dueTimer = null;
  let recruiterCache = null;
  let recruiterRequest = null;
  let domObserver = null;
  let domRefreshTimer = null;
  const RECRUITER_CACHE_KEY = 'cc745_recruiter_meta_cache_v1';
  const RECRUITER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
  let loginHandled = false;
  let forceFreshReminder = true;
  let dataWriteRefreshTimer = 0;
  let lastLocalReminderWritePath = '';
  let lastLocalReminderWriteAt = 0;
  let reminderSnapshotConfigs = [];
  let lastReminderFetchAt = 0;
  let managerCenterEl = null;
  let managerCenterExpanded = false;
  let managerExpandedReminderKey = '';
  let managerLastDueCount = 0;
  let liveReminderDirtyTimer = null;
  let provisionalSubmissionConfigs = [];

  function lower(v){ return String(v || '').trim().toLowerCase(); }
  function safe(v){ return String(v == null ? '' : v).trim(); }
  function uniqueParts(parts){ return Array.from(new Set((Array.isArray(parts) ? parts : []).map(safe).filter(Boolean))); }
  function onLoginRoute(){ return /^\/login(?:\/|$)/.test(location.pathname || ''); }
  function hasUser(){ try { return !!localStorage.getItem('careerCroxCachedUser'); } catch(_e){ return false; } }
  function currentUser(){ try { return window.__CC875_EFFECTIVE_USER__?.()||JSON.parse(localStorage.getItem('careerCroxCachedUser') || 'null') || {}; } catch(_e){ return {}; } }
  function currentRole(){
    const raw=lower(currentUser().role || currentUser().designation || '');
    if(raw.includes('admin')) return 'admin';
    if(raw.includes('manager')) return 'manager';
    if(raw === 'tl' || raw.includes('team lead') || raw.includes('teamlead')) return 'tl';
    if(raw.includes('recruiter')) return 'recruiter';
    return raw;
  }
  function managerReminderMode(){ return ['manager','admin'].includes(currentRole()); }
  function navigatePath(path){
    const target=safe(path || '/');
    try {
      history.pushState(null,'',target);
      window.dispatchEvent(new PopStateEvent('popstate'));
      window.dispatchEvent(new Event('cc-route-change'));
    } catch(_e){ location.href=target; }
  }
  function openFullPath(path, fallbackAction){
    const target=safe(path);
    if(target){
      // Reminder/profile actions must never replace the employee's current work tab.
      // This runs directly from a user click, so normal browsers allow the new tab.
      try {
        const win=window.open(target,'_blank','noopener,noreferrer');
        if(win){ try{win.focus();}catch(_e){} return true; }
      } catch(_e){}
      return false;
    }
    try { if(typeof fallbackAction === 'function') fallbackAction(); } catch(_e){}
    return false;
  }
  function todayKey(){ return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10); }
  function joinedOffice(){
    try {
      if (localStorage.getItem('careerCroxOfficeJoinedSession') || sessionStorage.getItem('careerCroxOfficeJoinedSession')) return true;
      if (localStorage.getItem('cc729_daily_office_join_backup')) return true;
    } catch(_e){}
    return false;
  }
  function canPoll(){ return location.pathname!=='/data-backup' && !onLoginRoute() && hasUser() && !window.__CC602_NETWORK_PAUSED__; }
  function isTasksRoute(){ return /^\/tasks(?:\/|$)/.test(location.pathname || ''); }
  function reminderSnoozeKey(type, key){ return `cc736_popup_snooze_${type}_${key}:cc875:${currentUser().user_id}:${window.__CC875_DASHBOARD_KEY__?.()||'overview'}`; }
  function readSnooze(type, key){
    if(!type || !key) return 0;
    try { return Number(localStorage.getItem(reminderSnoozeKey(type, key)) || 0); } catch(_e){ return 0; }
  }
  function snoozeUntil(type, key, minutes){
    if(!type || !key) return;
    try { localStorage.setItem(reminderSnoozeKey(type, key), String(Date.now() + Number(minutes || 0) * 60 * 1000)); } catch(_e){}
  }
  function isSnoozed(type, key){ return readSnooze(type, key) > Date.now(); }
  function closePopup(){clearTimeout(popupHideTimer);popupHideTimer=null; if(popupEl){ popupEl.remove(); popupEl = null; popupKey = ''; } const orphan=document.querySelector('.cc388-reminder-deck.cc730-direct-reminder-deck'); if(orphan){orphan.remove();} }

  function formatDateTime(value){
    if(!value) return '-';
    const parsed = new Date(value);
    if(Number.isNaN(parsed.getTime())) return safe(value);
    try { return parsed.toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'numeric', minute:'2-digit', hour12:true }); } catch(_e){ return parsed.toLocaleString(); }
  }
  function formatDateShort(value){
    if(!value) return '-';
    const parsed = new Date(value);
    if(Number.isNaN(parsed.getTime())) return safe(value).slice(0,10);
    try { return parsed.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }); } catch(_e){ return parsed.toLocaleDateString(); }
  }
  function fetchJson(url){
    return fetch(url, { credentials:'same-origin', cache:String(url).includes('fresh=1')?'reload':'no-store' }).then(function(response){
      if(!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    });
  }

  function submissionKey(row){ return safe(row && (row.submission_id || row.candidate_id)); }
  function submissionSnoozed(row){ const key = submissionKey(row); return key ? isSnoozed('submission', key) || isSnoozed('submission-global', key) : false; }
  function isSubmissionPending(row){
    const approval = lower(row && row.approval_status);
    const details = lower(row && row.all_details_sent);
    const status = lower(row && (row.status || row.candidate_status || row.profile_status));
    if(['deleted','__deleted__','archived','rejected','draft'].includes(status)) return false;
    if(['deleted','__deleted__','archived','rejected','draft',''].includes(approval)) return false;
    return approval === 'pending' || (approval === 'approved' && details === 'pending');
  }
  function reminderStamp(row){
    const snoozed = safe(row && row.reminder_snoozed_until);
    if(snoozed) return snoozed;
    const committed=safe(row&&(row.reminder_due_at||row.approval_reminder_at));if(committed)return committed;
    const base = safe(row && (row.approval_requested_at || row.submitted_at || row.effective_submission_at || row.submission_origin_at || row.updated_at || row.created_at || row.submission_date));
    const baseMs = new Date(base || 0).getTime();
    if(!baseMs) return '';
    return new Date(baseMs + SUBMISSION_REMINDER_OFFSET_MS).toISOString();
  }
  function pickSubmissionReminder(rows){
    return (Array.isArray(rows) ? rows : [])
      .filter(function(row){ return row && isSubmissionPending(row) && !submissionSnoozed(row); })
      .sort(function(a,b){ return new Date(reminderStamp(a) || 0).getTime() - new Date(reminderStamp(b) || 0).getTime(); })[0] || null;
  }

  function reminderColour(config){
    const text=[config.type,config.category,config.title].filter(Boolean).join(' ').toLowerCase();
    if(/feedback|result/.test(text))return 'feedback';
    if(/invoice|payout|payment|revenue/.test(text))return 'revenue';
    if(/joining|joined/.test(text))return 'joining';
    if(/interview/.test(text))return 'interview';
    if(/follow.?up|callback/.test(text))return 'followup';
    if(/approv|unlock/.test(text))return 'approval';
    if(/submission/.test(text))return 'submission';
    if(/task/.test(text))return 'task';
    if(/report|goal/.test(text))return 'report';
    if(/break|attendance|activity|idle|office/.test(text))return 'attendance';
    return 'general';
  }
  function reminderVisualLabel(type){
    const value = lower(type);
    if(value === 'submission') return 'SUBMISSION REMINDER';
    if(value === 'interview') return 'INTERVIEW REMINDER';
    if(value === 'task') return 'TASK REMINDER';
    if(value === 'followup') return 'FOLLOW-UP REMINDER';
    if(value === 'feedback') return 'INTERVIEW FEEDBACK';
    if(value === 'report') return 'REPORT REMINDER';
    if(value === 'break') return 'BREAK REMINDER';
    if(value === 'idle') return 'ACTIVITY REMINDER';
    if(value === 'notification') return 'NOTIFICATION';
    return 'CRM REMINDER';
  }
  function reminderOpenTarget(config){
    const actions = Array.isArray(config && config.actions) ? config.actions : [];
    const first = actions[0];
    return first && typeof first.onClick === 'function' ? first.onClick : function(){};
  }
  const reminderContextMemory=new Map();
  function reminderCandidatePath(row,type){
    const cid=safe(row.candidate_id||row.candidateId);
    const jump=type==='submission'?'submission':['interview','feedback'].includes(type)?'interview':['followup','followups'].includes(type)?'followup':'';
    return cid&&jump?'/candidate/'+encodeURIComponent(cid)+'?jump='+jump:safe(row.open_path||row.openPath)||'/reports';
  }
  function mountReminderContext(config,container){
    const cid=safe(config.candidateId);if(!cid||!container)return;
    let box=container.querySelector('.cc898-reminder-context');
    if(!box){box=document.createElement('div');box.className='cc898-reminder-context';box.innerHTML='<div><b>Last activity</b><span data-activity>Loading…</span></div><div><b>Last seen by owner</b><span data-seen>Loading…</span></div>';container.appendChild(box);}
    const principal=safe(currentUser().user_id)+'|'+safe(window.__CC875_DASHBOARD_KEY__?.());
    const key=principal+'|'+cid,previous=reminderContextMemory.get(key);
    const load=previous&&previous.until>Date.now()?previous.promise:fetchJson('/api/reports/reminder-context?candidate_id='+encodeURIComponent(cid)).then(function(d){if(!d?.ok||!d.item)throw Error('Context unavailable');return d.item;});
    reminderContextMemory.set(key,{until:Date.now()+60000,promise:load});
    load.then(function(data){
      if(!container.isConnected||principal!==safe(currentUser().user_id)+'|'+safe(window.__CC875_DASHBOARD_KEY__?.()))return;
      const activity=[safe(data.last_activity_label||data.last_activity_action),data.last_activity_actor?'by '+safe(data.last_activity_actor):'',data.last_activity_at?formatDateTime(data.last_activity_at):''].filter(Boolean).join(' · ');
      box.querySelector('[data-activity]').textContent=activity||'No recorded activity';
      box.querySelector('[data-seen]').textContent=data.owner_last_seen_at?formatDateTime(data.owner_last_seen_at):'Not recorded';
      box.querySelector('[data-seen]').title=data.owner_name?'Profile owner: '+data.owner_name:'Profile owner';
      const note=container.querySelector('.cc388-note span,.cc763-manager-reminder-note');if(note&&data.note_body)note.textContent=data.note_body;
    }).catch(function(){reminderContextMemory.delete(key);if(container.isConnected){box.querySelector('[data-activity]').textContent='Unavailable · use Refresh';box.querySelector('[data-seen]').textContent='Unavailable';}});
  }
  function showReminderPopup(config){
    if(popupEl&&!popupEl.isConnected){popupEl=null;popupKey='';}
    if(document.querySelector('.cc803-review-popup')){closePopup();return;}
    if(!config || !config.key||popupWasHidden(config)) return;
    if(popupEl && popupKey === config.key) return;
    closePopup();
    popupKey = config.key;
    let deck = document.querySelector('.cc388-reminder-deck.cc730-direct-reminder-deck');
    if(!deck){
      deck = document.createElement('div');
      deck.className = 'cc388-reminder-deck cc730-direct-reminder-deck';
      document.body.appendChild(deck);
    }
    const typeMap = { followup:'followups' };
    const type = typeMap[lower(config.type)] || lower(config.type || 'generic');
    const label = reminderVisualLabel(config.type).replace('FOLLOW-UP','FOLLOWUP');
    const title = safe(config.name || config.title || label);
    const note = safe(config.note || 'Reminder needs action.');
    const countText = safe(config.countText || '1 due');
    const timeLabel = type === 'interview' ? 'Interview' : 'Due';
    const timeText = safe(String(config.timeText || '').replace(/^Reminder time:\s*/i,'').replace(/^Due:\s*/i,'').replace(/^Interview:\s*/i,''));
    deck.innerHTML = `<div class="cc388-card ${type}" title="Open profile"><div class="cc388-head"><span class="cc388-label">${label}</span><span class="cc388-head-actions"><button class="cc878-deck-minimize" type="button" aria-label="Minimize all popups for 5 seconds">−</button><span class="cc388-count">${countText}</span><button class="cc388-x" type="button" aria-label="Close">×</button></span></div><div class="cc388-title"></div><div class="cc882-reminder-owner"></div><div class="cc388-note"><b>NOTE</b><span></span></div><div class="cc388-time"><b></b><span></span></div><div class="cc388-preset-label">Snooze</div><div class="cc388-presets"></div></div>`;
    for(const[k,v]of Object.entries({left:'auto',right:'12px',bottom:'12px',width:'min(324px, calc(100vw - 24px))','max-width':'324px','max-height':'calc(100dvh - 88px)'}))deck.style.setProperty(k,v,'important');
    const card = deck.querySelector('.cc388-card');
    for(const[k,v]of Object.entries({'max-height':'calc(100dvh - 88px)',height:'auto','overflow-y':'auto'}))card.style.setProperty(k,v,'important');
    deck.querySelector('.cc878-deck-minimize')?.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();document.querySelector('.cc878-minimize-popups')?.click();});
    card.dataset.key=safe(config.key);
    card.dataset.reminderKind=reminderColour(config);
    card.setAttribute('role','button');card.tabIndex=0;
    card.querySelector('.cc388-time b').textContent=timeLabel+' · IST';
    card.querySelector('.cc388-time span').textContent=timeText||'Due now';
    card.querySelector('.cc388-title').textContent = title;
    card.querySelector('.cc388-title').title = title;
    const owner=card.querySelector('.cc882-reminder-owner');
    const ownerRole=({tl:'TL',manager:'Manager',admin:'Admin'})[config.ownerRole]||'Recruiter';
    for(const text of [config.ownerName?ownerRole+': '+config.ownerName:config.ownerLabel,config.tlName?'TL: '+config.tlName:'TL: Not assigned'])if(text){const part=document.createElement('span');part.textContent=text;part.title=text;owner.appendChild(part);}
    card.querySelector('.cc388-note span').textContent = note;
    card.querySelector('.cc388-note').title = note;
    // CC787: fit the personal popup into the requested sidebar dock. Full
    // reminder type/count stay available to assistive technology and hover.
    const labelEl = card.querySelector('.cc388-label');
    labelEl.textContent = label.replace(/\s+REMINDER$/i, '');
    labelEl.title = label;
    labelEl.setAttribute('aria-label', label);
    const countEl = card.querySelector('.cc388-count');
    const queueCount = countText.match(/\bof\s+(\d+)/i);
    countEl.textContent = queueCount ? `1/${queueCount[1]}` : '1';
    countEl.title = countText;
    countEl.setAttribute('aria-label', countText);
    card.querySelector('.cc388-time').title = `${timeLabel}: ${timeText}`;
    const openReminder = reminderOpenTarget(config);
    card.addEventListener('keydown',function(event){if(event.target===card&&(event.key==='Enter'||event.key===' ')){event.preventDefault();card.click();}});
    card.addEventListener('click', function(event){
      if(event.target.closest('button,a,input,select,textarea')||Date.now()<Number(window.__CC878_POPUPS_MINIMIZED_UNTIL__||0))return;
      try { openReminder(); } catch(_e){}
      // CC26_764: opening a still-unresolved reminder is a local 5-minute acknowledgement,
      // not permanent removal from the snapshot. It returns automatically if no write resolves it.
      snoozeUntil(config.type || 'generic', config.localKey || config.key, Number(config.repeatMinutes || 5));
      closePopup();
      setTimeout(function(){ renderReminderConfigs(reminderSnapshotConfigs); }, 60);
    });
    card.querySelector('.cc388-x').addEventListener('click', function(event){
      event.preventDefault(); event.stopPropagation();
      // Keep the row in the local snapshot so the 5-minute close/snooze can actually expire.
      snoozeUntil(config.type || 'generic', config.localKey || config.key, Number(config.repeatMinutes || 5));
      closePopup();
      setTimeout(function(){ renderReminderConfigs(reminderSnapshotConfigs); }, 60);
    });
    const presets = card.querySelector('.cc388-presets');
    presets.style.setProperty('--cc787-snooze-count', String(Math.min(5, (Array.isArray(config.snoozes) ? config.snoozes : SNOOZE_OPTIONS).length || 4)));
    (Array.isArray(config.snoozes) ? config.snoozes : SNOOZE_OPTIONS).forEach(function(option){
      const btn=document.createElement('button');
      btn.type='button'; btn.className='cc388-preset'; btn.textContent=safe(option.label);
      btn.addEventListener('click', function(event){
        event.preventDefault(); event.stopPropagation();
        // CC26_764: snooze is local-only and preserves the reminder in memory;
        // no network read is needed when the snooze expires.
        snoozeUntil(config.type || 'generic', config.localKey || config.key, Number(option.minutes || 0));
        closePopup();
        setTimeout(function(){ renderReminderConfigs(reminderSnapshotConfigs); }, 60);
      });
      presets.appendChild(btn);
    });
    const custom=document.createElement('button');custom.type='button';custom.className='cc388-preset';custom.textContent='+';custom.setAttribute('aria-label','Custom reminder pause');custom.title='Pause until a date, with a required note';
    custom.addEventListener('click',function(event){event.preventDefault();event.stopPropagation();window.__CC922_OPEN_REMINDER_PAUSE__?.(config,function(){closePopup();renderReminderConfigs(reminderSnapshotConfigs);});});presets.appendChild(custom);presets.style.setProperty('--cc787-snooze-count',String(Math.min(6,presets.children.length)));
    mountReminderContext(config,card);
    popupEl = deck;const prefs=popupPrefs();if(prefs.popupAutoHide!==false&&!window.__CC927_POPUP_CUSTOM__?.(config.type))popupHideTimer=setTimeout(function hideAfterPause(){if(window.__CC927_POPUP_CUSTOM__?.(config.type))return;if(window.__CC922_PAUSE_DIALOG_OPEN__){popupHideTimer=setTimeout(hideAfterPause,1000);return;}const remain=Number(window.__CC878_POPUPS_MINIMIZED_UNTIL__||0)-Date.now();if(remain>0){popupHideTimer=setTimeout(hideAfterPause,remain+1000);return;}const now=Date.now();for(const item of reminderSnapshotConfigs)if(Number(item.dueAt||0)<=now)autoHidden.set(popupOccurrence(item),now+Math.max(1,Number(item.repeatMinutes)||5)*60000);closePopup();},Math.max(1,Math.min(300,Number(prefs.popupSeconds)||10))*1000);
    try { window.__CC787_PLAY_SOUND__?.('reminder:' + config.key + ':' + String(config.timeText || '')); } catch (_) {}
  }

  function removeManagerReminderCenter(){
    if(managerCenterEl){ managerCenterEl.remove(); managerCenterEl=null; }
    managerCenterExpanded=false; managerExpandedReminderKey=''; managerLastDueCount=0;
  }
  function managerReminderTypeLabel(type){
    const t=lower(type);
    if(t==='followup') return 'FOLLOW-UP';
    return reminderVisualLabel(t).replace(' REMINDER','').replace('CRM ','').trim() || 'REMINDER';
  }
  document.addEventListener('click',function(event){if(event.target.closest('#cc603-reminders-refresh,.cc611-reminders-trigger,.cc379-reminders-trigger,[data-action="reminders"],.cc767-reminder-top-btn')){try{sessionStorage.removeItem('cc803-reminder-hidden:'+safe(currentUser().user_id));}catch(_){}renderReminderConfigs(reminderSnapshotConfigs);}});
  function ensureManagerReminderCenter(){
    let center=document.getElementById('cc763-manager-reminder-center');
    if(center){ managerCenterEl=center; return center; }
    center=document.createElement('section');
    center.id='cc763-manager-reminder-center';
    center.className='cc763-manager-center is-minimized';
    center.setAttribute('aria-label','Manager Reminder Center');
    center.innerHTML=`<button type="button" class="cc763-manager-center-head" aria-expanded="false"><span class="cc763-manager-center-icon">R</span><span class="cc763-manager-center-copy"><b>Reminder Center</b><small>Manager queue • click to review</small></span><strong class="cc763-manager-center-count">0</strong><span class="cc763-manager-center-chevron">⌃</span></button><div class="cc763-manager-center-panel"><div class="cc763-manager-center-toolbar"><span class="cc763-manager-center-status">Pending sequence</span><div><button type="button" class="cc763-manager-refresh">Refresh</button><button type="button" class="cc763-manager-minimize">Minimize</button><button type="button" class="cc803-manager-hide">Hide</button></div></div><div class="cc763-manager-center-list"></div></div>`;
    document.body.appendChild(center);
    const head=center.querySelector('.cc763-manager-center-head');
    const minimize=center.querySelector('.cc763-manager-minimize');
    const refresh=center.querySelector('.cc763-manager-refresh');
    center.querySelector('.cc803-manager-hide').addEventListener('click',function(){try{sessionStorage.setItem('cc803-reminder-hidden:'+safe(currentUser().user_id),'1');}catch(_){}removeManagerReminderCenter();});
    head.addEventListener('click',function(){
      managerCenterExpanded=!managerCenterExpanded;
      center.classList.toggle('is-open',managerCenterExpanded);
      center.classList.toggle('is-minimized',!managerCenterExpanded);
      head.setAttribute('aria-expanded',managerCenterExpanded?'true':'false');
    });
    minimize.addEventListener('click',function(){
      managerCenterExpanded=false; managerExpandedReminderKey='';
      center.classList.remove('is-open'); center.classList.add('is-minimized');
      head.setAttribute('aria-expanded','false');
    });
    refresh.addEventListener('click',function(){
      refresh.disabled=true; refresh.textContent='Refreshing…';
      Promise.resolve(window.__CC730_REFRESH_REMINDERS__ ? window.__CC730_REFRESH_REMINDERS__(true) : loadAllReminders()).finally(function(){refresh.disabled=false;refresh.textContent='Refresh';});
    });
    managerCenterEl=center;
    return center;
  }
  function renderManagerReminderCenter(dueRows){
    try{if(sessionStorage.getItem('cc803-reminder-hidden:'+safe(currentUser().user_id))==='1'){removeManagerReminderCenter();return;}}catch(_){}
    if(!managerReminderMode()){ removeManagerReminderCenter(); return; }
    closePopup();
    const rows=(Array.isArray(dueRows)?dueRows:[]).filter(function(item){return item && !isSnoozed(item.type,item.localKey);});
    if(!rows.length){ removeManagerReminderCenter(); return; }
    const center=ensureManagerReminderCenter();
    const count=center.querySelector('.cc763-manager-center-count');
    const status=center.querySelector('.cc763-manager-center-status');
    const list=center.querySelector('.cc763-manager-center-list');
    count.textContent=String(rows.length);
    status.textContent=`${rows.length} pending reminder${rows.length===1?'':'s'} • oldest first`;
    if(rows.length>managerLastDueCount && !managerCenterExpanded){
      rows.forEach(function(config){ try { window.__CC787_PLAY_SOUND__?.('reminder:' + config.key + ':' + String(config.timeText || '')); } catch (_) {} });
      center.classList.remove('cc763-manager-new'); void center.offsetWidth; center.classList.add('cc763-manager-new');
      setTimeout(function(){ if(center) center.classList.remove('cc763-manager-new'); },900);
    }
    managerLastDueCount=rows.length;
    list.innerHTML='';
    rows.forEach(function(config,index){
      const item=document.createElement('article');
      const expanded=managerExpandedReminderKey===config.key;
      item.className='cc763-manager-reminder-item'+(expanded?' is-expanded':'');
      item.setAttribute('data-reminder-key',safe(config.key));
      item.dataset.reminderKind=reminderColour(config);
      const top=document.createElement('button'); top.type='button'; top.className='cc763-manager-reminder-summary';
      const owner=safe(config.ownerLabel || config.subtitle || '');
      top.innerHTML=`<span class="cc763-manager-seq">${index+1}</span><span class="cc763-manager-item-copy"><b></b><small></small></span><span class="cc763-manager-type">${managerReminderTypeLabel(config.type)}</span><span class="cc763-manager-item-chevron">${expanded?'−':'+'}</span>`;
      top.querySelector('b').textContent=safe(config.name || config.title || 'Reminder');
      top.querySelector('small').textContent=owner || safe(config.timeText || 'Pending');
      const details=document.createElement('div'); details.className='cc763-manager-reminder-details';
      const note=document.createElement('div'); note.className='cc763-manager-reminder-note'; note.textContent=safe(config.note || 'Reminder needs action.');
      if(expanded)mountReminderContext(config,details);
      const due=document.createElement('div'); due.className='cc763-manager-reminder-due'; due.textContent=safe(config.timeText || 'Due now');
      const extend=document.createElement('div'); extend.className='cc763-manager-reminder-extend';
      const extendLabel=document.createElement('span'); extendLabel.textContent='Extend'; extend.appendChild(extendLabel);
      (Array.isArray(config.snoozes)?config.snoozes:SNOOZE_OPTIONS).forEach(function(option){
        const btn=document.createElement('button');btn.type='button';btn.textContent=safe(option.label);btn.addEventListener('click',function(event){event.stopPropagation();snoozeUntil(config.type||'generic',config.localKey||config.key,Number(option.minutes||0));managerExpandedReminderKey='';renderReminderConfigs(reminderSnapshotConfigs);});extend.appendChild(btn);
      });
      const custom=document.createElement('button');custom.type='button';custom.textContent='+';custom.setAttribute('aria-label','Custom reminder pause');custom.onclick=function(event){event.stopPropagation();window.__CC922_OPEN_REMINDER_PAUSE__?.(config,()=>renderReminderConfigs(reminderSnapshotConfigs));};extend.appendChild(custom);
      const open=document.createElement('button'); open.type='button'; open.className='cc763-manager-open-full'; open.textContent='Open Full'; open.addEventListener('click',function(event){event.stopPropagation();openFullPath(config.openPath,reminderOpenTarget(config));});
      details.appendChild(note); details.appendChild(due); details.appendChild(extend); details.appendChild(open);
      top.addEventListener('click',function(){
        managerExpandedReminderKey=managerExpandedReminderKey===config.key?'':config.key;
        managerCenterExpanded=true;
        renderManagerReminderCenter(rows);
      });
      item.appendChild(top); item.appendChild(details); list.appendChild(item);
    });
    center.classList.toggle('is-open',managerCenterExpanded);
    center.classList.toggle('is-minimized',!managerCenterExpanded);
    center.querySelector('.cc763-manager-center-head').setAttribute('aria-expanded',managerCenterExpanded?'true':'false');
  }

  async function loadSubmissionReminder(){
    if(!canPoll()) return null;
    try {
      const data = await fetchJson('/api/submissions?view=all_pending&_cc730=' + Date.now());
      const next = pickSubmissionReminder(Array.isArray(data && data.items) ? data.items : []);
      if(!next) return null;
      const key = submissionKey(next);
      if(!key || isSnoozed('submission', key) || isSnoozed('submission-global', key)) return null;
      const dueAt = new Date(reminderStamp(next) || 0).getTime();
      if(!dueAt) return null;
      return {
        dueAt,
        key: 'submission:' + key,
        localKey: key,
        type: 'submission',
        priority: 1,
        title: 'Submission Reminder',
        subtitle: uniqueParts([next.candidate_id, next.recruiter_name || next.recruiter_code]).join(' • '),
        name: safe(next.full_name) || 'Pending submission',
        note: safe(next.submission_note || next.submission_notes || next.reminder_note || next.last_note || next.last_notes || next.notes || next.note) || 'No submission note saved yet.',
        timeText: 'Reminder time: ' + formatDateTime(reminderStamp(next)),
        actions: [
          { label: 'Open Profile', onClick: function(){ openProfile(next); } },
          { label: 'Open Queue', kind:'secondary', onClick: function(){ openSubmissionQueue(next); } }
        ]
      };
    } catch(_e){ return null; }
  }

  async function loadTaskReminder(){
    if(!canPoll()) return null;
    try {
      const data = await fetchJson('/api/tasks/reminders/next?_cc730=' + Date.now());
      const next = data && data.item || null;
      if(!next || !next.task_id) return null;
      const key = safe(next.task_id);
      if(isSnoozed('task', key)) return null;
      const dueAt = Number(next.dueAt || 0) || new Date(next.due_date || 0).getTime() || 0;
      if(!dueAt) return null;
      return {
        dueAt,
        key: 'task:' + key,
        localKey: key,
        type: 'task',
        priority: 3,
        title: 'Task Reminder',
        subtitle: uniqueParts([next.assigned_to_name, next.assigned_to_code]).join(' • '),
        name: safe(next.title) || 'Task due',
        note: safe(next.task_note || next.description || next.notes) || 'No task note saved yet.',
        timeText: 'Due: ' + formatDateTime(next.due_date || dueAt),
        actions: [
          { label: 'Open Task', onClick: function(){ openTask(next); } },
          { label: 'Open Tasks', kind:'secondary', onClick: function(){ openPath('/tasks'); } }
        ]
      };
    } catch(_e){ return null; }
  }

  async function loadFollowupReminder(){
    if(!canPoll()) return null;
    try {
      const data = await fetchJson('/api/followups/reminders/next?_cc730=' + Date.now());
      const next = data && data.item || null;
      if(!next || !next.candidate_id) return null;
      const key = safe(next.candidate_id);
      if(isSnoozed('followup', key)) return null;
      const dueAt = Number(next.dueAt || 0) || new Date(next.follow_up_at || 0).getTime() || 0;
      if(!dueAt) return null;
      return {
        dueAt,
        key: 'followup:' + key,
        localKey: key,
        type: 'followup',
        priority: 2,
        title: 'Follow-up Reminder',
        subtitle: uniqueParts([next.candidate_id, next.recruiter_name || next.recruiter_code]).join(' • '),
        name: safe(next.full_name) || 'Follow-up due',
        note: safe(next.follow_up_note || next.followup_note || next.callback_note) || 'No follow-up note saved yet.',
        timeText: 'Due: ' + formatDateTime(next.follow_up_at || dueAt),
        actions: [
          { label: 'Open Profile', onClick: function(){ openProfile(next); } },
          { label: 'Open FollowUps', kind:'secondary', onClick: function(){ openPath('/followups'); } }
        ]
      };
    } catch(_e){ return null; }
  }

  function interviewDateValue(row){ return safe(row && (row.interview_reschedule_date || row.interview_date_effective || row.interview_date || row.scheduled_at || row.created_at)); }
  function interviewDueMs(row){
    const value = interviewDateValue(row);
    if(!value) return 0;
    const parsed = new Date(value).getTime();
    if(Number.isFinite(parsed) && parsed > 0) return parsed;
    if(/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(value + 'T09:00:00').getTime();
    return 0;
  }
  function interviewStatusText(row){ return lower(row && (row.status || row.interview_status)); }
  function isInterviewRelevant(row){
    const status = interviewStatusText(row);
    if(TERMINAL_INTERVIEW_STATUSES.has(status)) return false;
    const dueAt = interviewDueMs(row);
    if(!dueAt) return false;
    const dateKey = interviewDateValue(row).slice(0,10);
    return dateKey <= todayKey() || dueAt <= Date.now() + PRE_DUE_BUFFER_MS;
  }
  async function loadSummaryExtraReminder(){
    if(!canPoll()) return null;
    try {
      const data = await fetchJson('/api/reports/reminder-summary?fresh=1&_cc736=' + Date.now());
      const actions = (Array.isArray(data && data.actions) ? data.actions : []).filter(function(x){return String(x.type||'').toLowerCase()!=='task';});
      const allowed = new Set(['report','notification','break','idle']);
      const rows = actions.filter(function(row){ return row && allowed.has(lower(row.type)); })
        .map(function(row){ return { row:row, dueAt:new Date(row.due_at || row.created_at || row.updated_at || 0).getTime() || Date.now() }; })
        .filter(function(entry){ return !isSnoozed(lower(entry.row.type), safe(entry.row.key || entry.row.notification_id || entry.row.type)); })
        .sort(function(a,b){ return a.dueAt-b.dueAt; });
      if(!rows.length) return null;
      const selected=rows[0]; const row=selected.row; const type=lower(row.type || 'generic'); const key=safe(row.key || row.notification_id || type);
      return {
        dueAt:selected.dueAt,
        key:type + ':' + key,
        localKey:key,
        type:type,
        priority:5,
        title:safe(row.title) || reminderVisualLabel(type),
        name:safe(row.title) || reminderVisualLabel(type),
        note:safe(row.message) || 'Reminder needs action.',
        timeText:'Due: ' + formatDateTime(row.due_at || selected.dueAt),
        actions:[{ label:'Open', onClick:function(){ openPath(safe(row.open_path) || '/reports'); } }]
      };
    } catch(_e){ return null; }
  }

  async function loadInterviewReminder(){
    if(!canPoll()) return null;
    try {
      const data = await fetchJson('/api/interviews?_cc730=' + Date.now());
      const rows = Array.isArray(data && data.items) ? data.items : [];
      const next = rows.filter(isInterviewRelevant).sort(function(a,b){ return interviewDueMs(a) - interviewDueMs(b); })[0] || null;
      if(!next) return null;
      const key = safe(next.interview_id || next.candidate_id || interviewDateValue(next));
      if(!key || isSnoozed('interview', key)) return null;
      const interviewAt = interviewDueMs(next);
      const dueAt = Math.max(1, interviewAt);
      const overdue = safe(interviewDateValue(next)).slice(0,10) < todayKey() || dueAt < Date.now();
      return {
        key: 'interview:' + key,
        localKey: key,
        dueAt,
        type: 'interview',
        priority: 4,
        title: overdue ? 'Interview Follow-up' : 'Interview Reminder',
        subtitle: uniqueParts([next.candidate_id, next.recruiter_name || next.recruiter_code, next.virtual_onsite]).join(' • '),
        name: safe(next.full_name) || 'Interview candidate',
        note: safe(next.interview_note || next.interview_notes || next.interview_feedback) || 'No interview note saved yet.',
        timeText: 'Interview: ' + (safe(interviewDateValue(next)).slice(0,10) === todayKey() ? formatDateShort(interviewDateValue(next)) + ' (Today)' : formatDateShort(interviewDateValue(next))),
        actions: [
          { label: 'Open Profile', onClick: function(){ openInterview(next); } },
          { label: 'Open Interviews', kind:'secondary', onClick: function(){ openPath('/interviews'); } }
        ]
      };
    } catch(_e){ return null; }
  }


  function reminderLocalKey(row, type){
    const normalized = lower(type || row && row.type || 'generic');
    if(normalized === 'submission') return safe(row && (row.submission_id || row.candidate_id || row.key));
    if(normalized === 'interview') return safe(row && (row.interview_id || row.candidate_id || row.key));
    if(normalized === 'task') return safe(row && (row.task_id || row.key));
    if(normalized === 'followup' || normalized === 'followups') return safe(row && (row.candidate_id || row.key));
    if(normalized === 'notification') return safe(row && (row.notification_id || row.key));
    return safe(row && (row.key || normalized));
  }
  function reminderPriority(type){
    const value = lower(type);
    if(value === 'submission') return 1;
    if(value === 'followup' || value === 'followups') return 2;
    if(value === 'task') return 3;
    if(value === 'interview') return 4;
    if(value === 'feedback') return 4;
    if(value === 'report') return 5;
    if(value === 'notification') return 6;
    if(value === 'break') return 7;
    if(value === 'idle') return 8;
    return 9;
  }
  function isPersonalRecruiterReminder(item){
    const type = lower(item && item.type);
    return Boolean(item && item.personalOwner && ['submission','followup','followups','interview','task','feedback'].includes(type));
  }
  function reminderDisplayTitle(row, type){
    const raw = safe(row && row.title) || reminderVisualLabel(type);
    if(lower(type) === 'report') return raw;
    const candidateName=safe(row.full_name||row.candidate_name||row.name);
    if(candidateName)return candidateName;
    return raw.replace(/^(submission reminder|approval reminder|details reminder|interview reminder|task reminder|follow[- ]?up reminder)\s*:\s*/i, '').trim() || raw;
  }
  function actionToReminderConfig(row, index){
    if(String(row?.type||'').toLowerCase()==='idle')return null;
    if(!row || typeof row !== 'object') return null;
    const rawType = lower(row.type || 'generic');
    const type = rawType === 'followups' ? 'followup' : rawType;
    const dueAt = new Date(row.due_at || row.created_at || row.updated_at || 0).getTime() || Date.now();
    const baseLocalKey = reminderLocalKey(row, type) || String(index || 0);
    // A resubmit/reschedule is a NEW reminder occurrence. Include its due stamp in
    // the local snooze key so an old snooze can never hide a newly scheduled reminder.
    const localKey = `${baseLocalKey}@${Math.floor(dueAt/1000)}`;
    if(isSnoozed(type, localKey)) return null;
    const snoozePresets=(Array.isArray(row.snooze_presets)?row.snooze_presets:[]).map(function(minutes){
      const value=Number(minutes||0); if(!value)return null; return {label:value<60?`${value}m`:`${Math.round(value/60)}h`,minutes:value};
    }).filter(Boolean);
    return {
      dueAt,
      key: safe(row.key) || `${type}:${baseLocalKey}`,
      localKey,
      type,
      priority: reminderPriority(type),
      title: safe(row.title) || reminderVisualLabel(type),
      name: reminderDisplayTitle(row, type),
      note: safe(row.message) || 'Reminder needs action.',
      timeText: `${type === 'interview' && row.scheduled_at ? 'Interview' : 'Due'}: ${formatDateTime(type === 'interview' && row.scheduled_at ? row.scheduled_at : (row.due_at || dueAt))}`,
      ownerLabel: safe(row.owner_label || row.recruiter_name || row.assigned_to_name || row.owner_name || ''),
      ownerName:safe(row.owner_name||row.recruiter_name||row.assigned_to_name),ownerRole:lower(row.owner_role),tlName:safe(row.tl_name),
      personalOwner: Boolean(row.personal_owner),
      openPath: reminderCandidatePath(row,type),
      repeatMinutes: Math.max(1,Number(row.repeat_minutes||5)),
      snoozes: snoozePresets.length?snoozePresets:undefined,
      candidateId: safe(row.candidate_id || ''),
      task_id:safe(row.task_id||''),notification_id:safe(row.notification_id||''),reminder_pause:row.reminder_pause,
      submissionId: safe(row.submission_id || ''),
      provisional: false,
      actions: [{ label:'Open', onClick:function(){ openFullPath(reminderCandidatePath(row,type)); } }]
    };
  }
  let reminderNextPage=1,reminderMoreBusy=false;
  function setReminderMore(data){
    const hasMore=Object.values(data.has_more||{}).some(Boolean);
    reminderNextPage=Number(data.next_page)||1;
    let button=document.getElementById('cc780-more-reminders');
    if(!hasMore){if(button)button.remove();return;}
    if(!button){
      button=document.createElement('button');button.id='cc780-more-reminders';button.type='button';
      button.textContent='Load more reminders';button.style.cssText='position:fixed;right:20px;bottom:12px;z-index:8200;padding:8px 12px;border:1px solid #b6cced;border-radius:10px;background:#edf5ff;color:#153f75;font:600 13px system-ui;box-shadow:0 3px 12px #143c7018';
      button.addEventListener('click',async function(){
        if(reminderMoreBusy)return;reminderMoreBusy=true;button.disabled=true;button.textContent='Loading…';
        try{
          const page=await fetchJson('/api/reports/reminder-summary?fresh=1&page='+reminderNextPage);
          const extra=(page.actions||[]).map(actionToReminderConfig).filter(Boolean);
          reminderSnapshotConfigs=Array.from(new Map(reminderSnapshotConfigs.concat(extra).map(item=>[item.key,item])).values());
          setReminderMore(page);renderReminderConfigs(reminderSnapshotConfigs);
        }catch(error){button.textContent='Retry more reminders';}
        finally{reminderMoreBusy=false;button.disabled=false;if(button.textContent==='Loading…')button.textContent='Load more reminders';}
      });document.body.appendChild(button);
    }
    if(hasMore&&reminderNextPage<1000)setTimeout(()=>{if(button.isConnected&&!button.disabled)button.click();},0);
  }
  const cc917ReminderReads=new Map();
  function loadConsolidatedReminderConfigs(){
    const key=String(window.__CC875_DASHBOARD_KEY__?.()||'overview')+':'+String(window.__CC875_SCOPE_EPOCH__?.()||0);
    if(cc917ReminderReads.has(key))return cc917ReminderReads.get(key);
    const work=computeConsolidatedReminderConfigs().finally(function(){if(cc917ReminderReads.get(key)===work)cc917ReminderReads.delete(key);});
    cc917ReminderReads.set(key,work);return work;
  }
  async function computeConsolidatedReminderConfigs(){
    if(!canPoll()) return [];
    try {
      const now = Date.now();
      if(!forceFreshReminder && reminderSnapshotConfigs.length && now - lastReminderFetchAt < 45000){
        return reminderSnapshotConfigs;
      }
      const fresh = forceFreshReminder ? '1' : '0';
      forceFreshReminder = false;
      const data = await fetchJson(`/api/reports/reminder-summary?fresh=${fresh}&_cc739=${Math.floor(now/1000)}`);
      window.__CC922_ACCEPT_REMINDER_PAUSES__?.(data.reminder_pauses||[]);
      const actions = (Array.isArray(data && data.actions) ? data.actions : []).filter(function(x){return String(x.type||'').toLowerCase()!=='task';});
      lastReminderFetchAt = Date.now();
      if(Number(data.approval_delay_minutes)>=1&&Number(data.approval_delay_minutes)<=1440)SUBMISSION_REMINDER_OFFSET_MS=Number(data.approval_delay_minutes)*60000;
      setReminderMore(data);
      const serverConfigs = actions.map(actionToReminderConfig).filter(Boolean);
      const serverCandidateIds = new Set(serverConfigs.filter(function(item){return item && item.type==='submission' && item.candidateId;}).map(function(item){return item.candidateId;}));
      const liveNow=Date.now();
      provisionalSubmissionConfigs = provisionalSubmissionConfigs.filter(function(item){
        return item && Number(item.expiresAt||0)>liveNow && (!item.candidateId || !serverCandidateIds.has(item.candidateId));
      });
      reminderSnapshotConfigs = data.degraded ? Array.from(new Map(reminderSnapshotConfigs.concat(serverConfigs).map(function(item){return [item.key,item];})).values()) : serverConfigs.concat(provisionalSubmissionConfigs);
      if(data.degraded) window.dispatchEvent(new CustomEvent('career-crox-global-error',{detail:{message:'Some reminder sources are unavailable. Showing last saved reminders.'}}));
      return reminderSnapshotConfigs;
    } catch(_e){window.__CC875_REMINDER_ERROR__=String(_e.stack||_e); return reminderSnapshotConfigs; }
  }

  function clearDueTimer(){ if(dueTimer){ clearTimeout(dueTimer); dueTimer=null; } }
  function scheduleDueReload(at){
    clearDueTimer();
    const due = Number(at || 0);
    if(!due || !Number.isFinite(due) || due <= Date.now()) return;
    dueTimer=setTimeout(function(){ dueTimer=null; renderReminderConfigs(reminderSnapshotConfigs); }, Math.max(50, Math.min(due-Date.now()+80, 2147480000)));
  }
  function nextLocalSnoozeWake(rows, now){
    const current=Number(now||Date.now());
    let next=0;
    (Array.isArray(rows)?rows:[]).forEach(function(item){
      if(!item) return;
      const wake=readSnooze(item.type,item.localKey);
      if(wake>current && (!next || wake<next)) next=wake;
    });
    return next;
  }
  function updateReminderTopBadge(count){
    const total=Math.max(0,Number(count||0));
    const btn=document.getElementById('cc603-reminders-refresh');
    if(!btn)return;
    let badge=btn.querySelector('.cc767-reminder-top-count');
    if(!total){ if(badge)badge.remove(); btn.classList.remove('cc767-reminders-has-due'); return; }
    if(!badge){ badge=document.createElement('span'); badge.className='cc767-reminder-top-count'; btn.appendChild(badge); }
    badge.textContent=total>99?'99+':String(total);
    btn.classList.add('cc767-reminders-has-due');
  }
  function renderReminderConfigs(available){
    if(!canPoll()){closePopup();removeManagerReminderCenter();clearDueTimer();return;}
    const rows=(Array.isArray(available)?available:[]).map(item=>({...item,dueAt:Math.max(Number(item.dueAt)||0,window.__CC922_REMINDER_PAUSE_UNTIL__?.(item)||0)}));
    const now=Date.now();
    const dueNow=rows.filter(function(item){return item && !isSnoozed(item.type,item.localKey) && Number(item.dueAt||0) <= now;})
      .sort(function(a,b){ const da=Number(a.dueAt||0), db=Number(b.dueAt||0); if(da!==db) return da-db; return Number(a.priority||999)-Number(b.priority||999); });
    const snoozeWake=nextLocalSnoozeWake(rows,now);
    updateReminderTopBadge(dueNow.length);
    if(dueNow.length){
      clearDueTimer();
      // Exact local wake for a snoozed reminder; no API/Supabase read.
      if(snoozeWake) scheduleDueReload(snoozeWake);
      if(managerReminderMode()){
        removeManagerReminderCenter();const allowed=popupPrefs().managerTeamPopups===false?dueNow.filter(isPersonalRecruiterReminder):dueNow;
        const chosen=allowed.find(item=>!popupWasHidden(item));if(chosen){chosen.countText='1 of '+allowed.length+' pending';showReminderPopup(chosen);}else closePopup();return;
      }
      removeManagerReminderCenter();
      const visiblePopups=dueNow.filter(item=>!popupWasHidden(item));const chosen=currentRole()==='tl' ? (visiblePopups.find(isPersonalRecruiterReminder) || visiblePopups[0]) : visiblePopups[0];if(!chosen){closePopup();return;}
      chosen.countText = dueNow.length > 1 ? `1 of ${dueNow.length} • ${dueNow.length} pending` : '1 due';
      showReminderPopup(chosen);
      return;
    }
    closePopup();
    removeManagerReminderCenter();
    const future=rows.filter(function(item){return item && !isSnoozed(item.type,item.localKey) && Number(item.dueAt||0) > now;}).sort(function(a,b){return Number(a.dueAt||0)-Number(b.dueAt||0);});
    const nextFuture=future.length?Number(future[0].dueAt||0):0;
    const nextWake=[nextFuture,snoozeWake].filter(function(v){return Number(v)>now;}).sort(function(a,b){return a-b;})[0]||0;
    if(nextWake) scheduleDueReload(nextWake); else clearDueTimer();
  }
  async function loadAllReminders(){
    if(!canPoll()) { closePopup(); removeManagerReminderCenter(); clearDueTimer(); return; }
    try {
      const available = await loadConsolidatedReminderConfigs();
      renderReminderConfigs(available);
    } catch(_e){window.__CC875_REMINDER_ERROR__=String(_e.stack||_e);}
  }
  window.addEventListener('cc922-reminder-pauses-changed',()=>renderReminderConfigs(reminderSnapshotConfigs));
  function resetDashboardReminders(){reminderContextMemory.clear();closePopup();removeManagerReminderCenter();clearDueTimer();autoHidden.clear();reminderSnapshotConfigs=[];provisionalSubmissionConfigs=[];lastReminderFetchAt=0;forceFreshReminder=true;updateReminderTopBadge(0);if(canPoll())loadAllReminders();}
  window.addEventListener('cc875-dashboard-changed',resetDashboardReminders);
  let lastManagerTeamPopup=popupPrefs().managerTeamPopups;window.addEventListener('cc787-settings-changed',function(){const current=popupPrefs().managerTeamPopups;if(current!==lastManagerTeamPopup){lastManagerTeamPopup=current;resetDashboardReminders();return;}closePopup();renderReminderConfigs(reminderSnapshotConfigs);});
  function scheduleReminderClock(){ if(pollTimer) clearInterval(pollTimer); pollTimer=null; /* CC872: SSE, writes, focus and manual refresh drive network reads. */ loadAllReminders(); if(localReminderClockTimer) clearInterval(localReminderClockTimer); localReminderClockTimer=setInterval(function(){ renderReminderConfigs(reminderSnapshotConfigs); }, LOCAL_REMINDER_HEARTBEAT_MS); }

  window.__CC875_REMINDER_STATUS__=()=>({canPoll:canPoll(),role:currentRole(),total:reminderSnapshotConfigs.length,due:reminderSnapshotConfigs.filter(x=>Number(x.dueAt||0)<=Date.now()).length,prefs:popupPrefs()});
  window.__CC730_REFRESH_REMINDERS__ = function(force){
    if(force !== false) forceFreshReminder = true;
    return loadAllReminders();
  };
  window.addEventListener('career-crox-manager-reminder-dirty', function(event){
    if(!canPoll()) return;
    const changed=event?.detail?.item;
    if(changed?.candidate_id&&window.__CC882_PROFILE_INACTIVE__?.(changed)){
      const cid=String(changed.candidate_id);
      reminderSnapshotConfigs=reminderSnapshotConfigs.filter(x=>String(x.candidateId)!==cid);
      provisionalSubmissionConfigs=provisionalSubmissionConfigs.filter(x=>String(x.candidateId)!==cid);
      renderReminderConfigs(reminderSnapshotConfigs);
    }

    const source=String(event && event.detail && event.detail.source || '');
    if(/^\/(?:api\/)?tasks(?:\/|$)/.test(source))return;
    // Same-browser writes already emitted career-crox-data-written. Ignore the matching
    // SSE echo briefly so the actor gets reliability across devices without two DB reads here.
    if(source && lastLocalReminderWritePath && Date.now()-lastLocalReminderWriteAt < 1800 &&
       (lastLocalReminderWritePath.indexOf(source)!==-1 || source.indexOf(lastLocalReminderWritePath)!==-1)) return;
    if(liveReminderDirtyTimer) clearTimeout(liveReminderDirtyTimer);
    liveReminderDirtyTimer=setTimeout(function(){
      liveReminderDirtyTimer=null;
      forceFreshReminder=true;
      loadAllReminders();
    }, 260);
  });
  try {
    if(typeof BroadcastChannel === 'function'){
      reminderSyncChannel = new BroadcastChannel('career-crox-reminder-sync-v1');
      reminderSyncChannel.onmessage = function(event){
        const path = String(event && event.data && event.data.path || '');
        if(/^\/api\/tasks(?:\/|$)/.test(path)||event?.detail?.reminder_relevant===false)return;
        if(/\/api\/(candidates|submissions|interviews|tasks|followups|approvals|revenue-hub)/.test(path)){
          forceFreshReminder = true;
          setTimeout(loadAllReminders, 120);
        }
      };
    }
  } catch(_e){}

  function applyLogoFallbacks(root){
    const scope = root || document;
    const imgs = scope.querySelectorAll('img.sidebar-brand-full-logo, img.topbar-logo, img[alt="Career Crox"], .sidebar-brand-shell img, .app-sidebar img, .topbar-left img, .brand-logo img');
    imgs.forEach(function(img){
      if(img.dataset.cc730LogoBound === '1') return;
      img.dataset.cc730LogoBound = '1';
      let index = 0;
      function nextLogo(){
        while(index < LOGO_FALLBACKS.length){
          const candidate = LOGO_FALLBACKS[index++];
          if(candidate && img.getAttribute('src') !== candidate){ img.src = candidate; return; }
        }
      }
      img.addEventListener('error', nextLogo);
      setTimeout(function(){
        try {
          const broken = !img.complete || !img.naturalWidth || img.naturalWidth < 10 || /undefined|null|\/assets\/img\/\s*$/i.test(String(img.getAttribute('src') || ''));
          if(broken) nextLogo();
        } catch(_e){}
      }, 500);
      setTimeout(function(){ try { if(!img.naturalWidth) nextLogo(); } catch(_e){} }, 1600);
    });
  }

  async function getRecruiters(){
    if(Array.isArray(recruiterCache)) return recruiterCache;
    try {
      const cached=JSON.parse(sessionStorage.getItem(RECRUITER_CACHE_KEY)||'null');
      if(cached&&Array.isArray(cached.rows)&&Date.now()-Number(cached.at||0)<RECRUITER_CACHE_TTL_MS){
        recruiterCache=cached.rows;return recruiterCache;
      }
    } catch(_e){}
    // CC26_745: many React DOM mutations used to start many /api/users/list calls
    // before the first request finished. Keep exactly one in-flight request.
    if(recruiterRequest) return recruiterRequest;
    recruiterRequest=fetchJson('/api/users/list').then(function(data){
      recruiterCache=Array.isArray(data&&(data.users||data.items||data.rows))?(data.users||data.items||data.rows):[];
      try{sessionStorage.setItem(RECRUITER_CACHE_KEY,JSON.stringify({at:Date.now(),rows:recruiterCache}));}catch(_e){}
      return recruiterCache;
    }).catch(function(){recruiterCache=[];return recruiterCache;}).finally(function(){recruiterRequest=null;});
    return recruiterRequest;
  }

  async function applyRecruiterMeta(){
    const holder = document.querySelector('[data-field="recruiter_code"]');
    if(!holder) return;
    let meta = holder.querySelector('.cc730-recruiter-meta');
    // React owns candidate DOM structure. Never append children into a controlled field.
    if(!meta) return;
    const select = holder.querySelector('select');
    const input = holder.querySelector('input');
    async function render(rawValue, labelText){
      const raw = safe(rawValue);
      if(!raw && !labelText){ meta.textContent = ''; return; }
      const list = await getRecruiters();
      const matched = list.find(function(row){
        return [row && row.user_id, row && row.recruiter_code, row && row.user_code, row && row.username, row && row.employee_code, row && row.full_name]
          .map(lower).includes(lower(raw)) || lower(safe(row && row.full_name)) === lower(labelText);
      });
      if(matched){
        const personName=safe(matched.full_name||matched.name||labelText||raw);
        const personCode=safe(matched.employee_code||matched.recruiter_code||matched.user_code||matched.username||raw);
        meta.textContent = uniqueParts([personName, personCode,
          matched.recruiter_code && lower(matched.recruiter_code) !== lower(matched.employee_code) ? matched.recruiter_code : ''
        ]).join(' • ');
        // Keep the visible dropdown useful even when an older candidate payload only
        // supplied the code. This changes UI text only; no data is written.
        if(select){
          const option=select.options[select.selectedIndex];
          if(option&&personName&&personCode&&lower(personName)!==lower(personCode)){
            const pretty=personName+' - '+personCode;
            if(safe(option.textContent)!==pretty)option.textContent=pretty;
          }
        }
      } else {
        meta.textContent = uniqueParts([labelText || raw]).join(' • ');
      }
    }
    if(select){
      const update = function(){
        const option = select.options[select.selectedIndex];
        render(select.value, option ? safe(option.textContent) : safe(select.value));
      };
      if(select.dataset.cc730Bound !== '1'){
        select.dataset.cc730Bound = '1';
        select.addEventListener('change', update);
      }
      update();
      return;
    }
    if(input){ render(input.value, input.value); }
  }

  function applyTaskPageCompaction(){
    if(!isTasksRoute()) return;
    const summary = document.querySelector('.task-summary-grid');
    const controlPanel = Array.from(document.querySelectorAll('.table-title')).find(function(node){ return /task control/i.test(node.textContent || ''); });
    const controlPanelWrap = controlPanel ? controlPanel.closest('.table-panel') : null;
    if(summary && controlPanelWrap && controlPanelWrap.parentElement && summary.previousElementSibling !== controlPanelWrap){
      controlPanelWrap.parentElement.insertBefore(summary, controlPanelWrap);
      summary.dataset.cc730Moved = '1';
    }
    document.querySelectorAll('.crm-modal-backdrop').forEach(function(backdrop){ if(backdrop) backdrop.dataset.cc730Skip = '1'; });
    const blocks = Array.from(document.querySelectorAll('section, .panel, .table-panel, .glassy-card, .fade-up, .premium-card')).filter(function(el){
      if(!el || el.dataset.cc730Skip === '1' || el.matches('.page-scroll,.cc785-route-content,#cc622-task-panel') || el.contains(document.querySelector('#cc622-task-panel'))) return false;
      if(el.closest('.crm-modal-backdrop')) return false;
      const text = lower((el.textContent || '').slice(0, 260));
      return /create a task for today/.test(text) || /set up recurring work/.test(text) || /recurring work/.test(text) && /optional/.test(text);
    });
    blocks.forEach(function(el){
      if(el.dataset.cc730TaskHidden === '1') return;
      el.dataset.cc730TaskHidden = '1';
      el.style.setProperty('display', 'none', 'important');
    });
    const toolbar = controlPanelWrap ? controlPanelWrap.querySelector('.toolbar-actions') : null;
    if(toolbar){
      const createBtn = Array.from(toolbar.querySelectorAll('button')).find(function(btn){ return /create task/i.test(btn.textContent || ''); });
      if(createBtn){
        createBtn.classList.add('cc730-toolbar-create-btn');
        if(!toolbar.querySelector('.cc730-recurring-quick-btn') && !Array.from(toolbar.querySelectorAll('button')).some(function(btn){return /recurring task/i.test(btn.textContent||'');})){
          const recurring = document.createElement('button');
          recurring.type = 'button';
          recurring.className = 'ghost-btn bounceable cc730-recurring-quick-btn';
          recurring.textContent = 'Recurring Task';
          recurring.addEventListener('click', function(){
            try { createBtn.click(); } catch(_e){}
            setTimeout(function(){
              const modal = document.querySelector('.task-premium-modal');
              if(!modal) return;
              const select = Array.from(modal.querySelectorAll('select')).find(function(el){
                const label = el.closest('.field') && el.closest('.field').querySelector('label');
                return /recurring/i.test(String(label && label.textContent || ''));
              });
              if(select){
                select.value = 'daily';
                select.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }, 180);
          });
          createBtn.insertAdjacentElement('afterend', recurring);
        }
      }
      const refreshChip = Array.from(toolbar.querySelectorAll('.mini-chip, span')).find(function(node){ return /manual refresh/i.test(node.textContent || ''); });
      if(refreshChip) refreshChip.classList.add('cc730-manual-refresh-chip');
    }
  }

  function handleIdleRestoreLogin(){
    if(!onLoginRoute() || loginHandled) return;
    let message = '';
    try { message = safe(sessionStorage.getItem('careerCroxSessionExpiredMessage')); } catch(_e){}
    if(!message) return;
    const form = document.querySelector('form');
    if(!form || form.dataset.cc730IdleRestore === '1') return;
    form.dataset.cc730IdleRestore = '1';
    form.addEventListener('submit', function(){
      try { sessionStorage.setItem('cc730_idle_login_restore', '1'); } catch(_e){}
    }, { once: true });
    loginHandled = true;
  }

  function queueDomRefresh(delay){
    if(domRefreshTimer) return;
    domRefreshTimer=setTimeout(function(){
      domRefreshTimer=null;
      applyRecruiterMeta();
      applyTaskPageCompaction();
      handleIdleRestoreLogin();
    }, Number(delay||120));
  }
  function observeDom(){
    applyLogoFallbacks(document);
    queueDomRefresh(0);
    if(domObserver) return;
    domObserver = new MutationObserver(function(records){
      let relevant=false;
      records.forEach(function(record){
        Array.prototype.forEach.call(record.addedNodes || [], function(node){
          if(!node || node.nodeType !== 1) return;
          applyLogoFallbacks(node);
          if((node.matches&&node.matches('[data-field="recruiter_code"],.task-summary-grid,.table-title,form,.candidate-detail-full-panel'))||
             (node.querySelector&&node.querySelector('[data-field="recruiter_code"],.task-summary-grid,.table-title,form,.candidate-detail-full-panel'))) relevant=true;
        });
      });
      if(relevant)queueDomRefresh(120);
    });
    domObserver.observe(document.getElementById('root') || document.body || document.documentElement, { childList:true, subtree:true });
  }

  // CC26_745: focus/visibility and every route click must not cause extra database reads.
  // They only refresh local UI. The consolidated reminder fetch is low-frequency below
  // and user data writes can request one targeted refresh.
  document.addEventListener('visibilitychange', function(){ if(!document.hidden){ applyTaskPageCompaction(); queueDomRefresh(0); renderReminderConfigs(reminderSnapshotConfigs); } });
  window.addEventListener('focus', function(){ applyTaskPageCompaction(); queueDomRefresh(0); renderReminderConfigs(reminderSnapshotConfigs);if(canPoll()&&Date.now()-lastReminderFetchAt>60000){forceFreshReminder=true;loadAllReminders();} }, {passive:true});
  window.addEventListener('online',function(){if(canPoll()){forceFreshReminder=true;loadAllReminders();}});
  window.addEventListener('popstate', function(){ setTimeout(function(){ applyTaskPageCompaction(); queueDomRefresh(0); renderReminderConfigs(reminderSnapshotConfigs); }, 180); });
  ['pushState','replaceState'].forEach(function(method){
    const orig = history[method];
    if(typeof orig !== 'function') return;
    history[method] = function(){ const res = orig.apply(this, arguments); setTimeout(function(){ applyTaskPageCompaction(); queueDomRefresh(0); renderReminderConfigs(reminderSnapshotConfigs); }, 120); return res; };
  });
  window.addEventListener('career-crox-data-written', function(event){
    const path=String(event && event.detail && event.detail.path || '');
    if(/^\/api\/tasks(?:\/|$)/.test(path)||event?.detail?.reminder_relevant===false)return;
    if(/\/api\/approvals(?:[/?#]|$)/i.test(path)) provisionalSubmissionConfigs=[];
    if(/\/api\/(candidates|submissions|interviews|tasks|followups|approvals|revenue-hub)/.test(path)){
      try{ reminderSyncChannel&&reminderSyncChannel.postMessage({type:'write',path:path,at:Date.now()}); }catch(_e){}
      lastLocalReminderWritePath=path;
      lastLocalReminderWriteAt=Date.now();
      forceFreshReminder=true;
      if(dataWriteRefreshTimer)clearTimeout(dataWriteRefreshTimer);
      dataWriteRefreshTimer=setTimeout(function(){dataWriteRefreshTimer=0;loadAllReminders();},300);
    }
  });

  window.addEventListener('career-crox-idle-lock-begin',function(){
    clearDueTimer(); closePopup(); removeManagerReminderCenter(); updateReminderTopBadge(0);
    if(localReminderClockTimer)clearInterval(localReminderClockTimer);localReminderClockTimer=null;
    if(pollTimer)clearInterval(pollTimer);pollTimer=null;
    if(liveReminderDirtyTimer)clearTimeout(liveReminderDirtyTimer);
    if(dataWriteRefreshTimer)clearTimeout(dataWriteRefreshTimer);
    reminderSnapshotConfigs=[];provisionalSubmissionConfigs=[];lastReminderFetchAt=0;
    document.getElementById('cc780-more-reminders')?.remove();
    if(reminderSyncChannel){reminderSyncChannel.close();reminderSyncChannel=null;}
  });
  window.addEventListener('career-crox-session-active',function(){if(canPoll()){forceFreshReminder=true;scheduleReminderClock();}});
  window.__CC736_REFERENCE_LOOK_DIRECT_REMINDER_OWNER__ = true;
  setTimeout(function(){ document.querySelectorAll('.cc730-submission-reminder').forEach(function(el){ try{el.remove();}catch(_e){} }); observeDom(); scheduleReminderClock(); }, 900);
})();
(function(){
  'use strict';
  if(window.__CC780_ATOMIC_PROFILE__ || window.__CC753_SUBMIT_DRAFT_GUARD__) return;
  window.__CC753_SUBMIT_DRAFT_GUARD__=true;

  var NOTE_FLAG='cc753_note_required';
  var autoSaveTimer=0;
  var enhanceRaf=0;
  var internalStatusChange=false;
  var saveRetry=0;

  function isCandidatePage(){ return /^\/candidate\/(?:new|[^/?#]+)(?:\/|$)/i.test(String(location.pathname||'')); }
  function isNewCandidate(){ return /^\/candidate\/new(?:\/|$)/i.test(String(location.pathname||'')); }
  function panel(){ return document.querySelector('.candidate-detail-full-panel'); }
  function notesPanel(){ return document.querySelector('.candidate-notes-chat-panel'); }
  function noteInput(){ return notesPanel()?.querySelector('textarea.candidate-notes-main-textarea, textarea'); }
  function submitButton(){ return document.querySelector('.candidate-submit-btn'); }
  function saveButton(){ return document.querySelector('.candidate-save-btn'); }
  function hasSavedNote(){ return !!document.querySelector('.candidate-notes-thread-list .candidate-note-thread, .candidate-notes-thread-list .candidate-note-bubble'); }
  function hasTypedNote(){ return !!String(noteInput()?.value||'').trim(); }

  function setNativeSelect(select,value){
    if(!select) return;
    var desc=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value');
    try{ desc&&desc.set ? desc.set.call(select,value) : (select.value=value); }catch(_e){ select.value=value; }
    select.dispatchEvent(new Event('change',{bubbles:true}));
  }

  function markInProgress(){
    if(internalStatusChange) return false;
    var wrap=document.querySelector('[data-field="status"]');
    var select=wrap&&wrap.querySelector('select');
    if(select && String(select.value||'').trim().toLowerCase()==='draft'){
      internalStatusChange=true;
      setNativeSelect(select,'In - Progress');
      internalStatusChange=false;
      return true;
    }
    return false;
  }

  function showNoteRequired(){
    try{ sessionStorage.setItem(NOTE_FLAG,'1'); }catch(_e){}
    var np=notesPanel(); if(!np) return;
    np.classList.add('note-required-error');
    // CandidateDetailPage renders its own React note-required message.
    // Do not insert/prepend DOM nodes here: external child mutation can make React
    // throw insertBefore/removeChild reconciliation errors during Submit.
    try{ np.scrollIntoView({behavior:'smooth',block:'center'}); }catch(_e){ try{np.scrollIntoView();}catch(__e){} }
    setTimeout(function(){ try{ noteInput()?.focus({preventScroll:true}); }catch(_e){ try{noteInput()?.focus();}catch(__e){} } },30);
  }

  function clearNoteRequired(){
    try{ sessionStorage.removeItem(NOTE_FLAG); }catch(_e){}
    var np=notesPanel();
    if(np){ np.classList.remove('note-required-error'); np.querySelector('.cc753-note-required-banner')?.remove(); }
  }

  function persistDomSafetySnapshot(){
    if(!isCandidatePage()) return;
    var root=panel(); if(!root) return;
    var fields={};
    root.querySelectorAll('[data-field]').forEach(function(w){
      var key=w.getAttribute('data-field'); if(!key||key==='master_notes') return;
      var ctl=w.querySelector('input:not([type="hidden"]),select,textarea');
      if(ctl) fields[key]=String(ctl.value||'');
      else {
        var active=w.querySelector('button.choice-chip.active');
        if(active) fields[key]=String(active.textContent||'').trim();
      }
    });
    try{ localStorage.setItem('careerCroxCC753DomSafetyDraft',JSON.stringify({at:Date.now(),path:location.pathname,fields:fields})); }catch(_e){}
  }

  function clickSaveForProtection(){ if(window.__CC780_ATOMIC_PROFILE__) return false;
    persistDomSafetySnapshot();
    var statusChanged=markInProgress();
    var btn=saveButton();
    if(btn && !btn.disabled){
      saveRetry=0;
      if(statusChanged){ setTimeout(function(){ var latest=saveButton(); if(latest&&!latest.disabled) latest.click(); },0); }
      else btn.click();
      return true;
    }
    if(saveRetry<2){ saveRetry+=1; setTimeout(clickSaveForProtection,700); }
    return false;
  }

  function scheduleNewCandidateSave(){ if(window.__CC780_ATOMIC_PROFILE__) return;
    if(!isNewCandidate()) return;
    persistDomSafetySnapshot();
    if(autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer=setTimeout(function(){
      autoSaveTimer=0;
      if(!isNewCandidate()) return;
      clickSaveForProtection();
    },1100);
  }

  function enhanceStatus(){
    // Status chips are already rendered by React's ChoiceField. Legacy DOM injection
    // is intentionally disabled so profile re-renders cannot crash on Submit.
    return;
  }

  function enhance(){
    enhanceRaf=0;
    if(!isCandidatePage()) return;
    enhanceStatus();
    var flagged=false; try{ flagged=sessionStorage.getItem(NOTE_FLAG)==='1'; }catch(_e){}
    if(flagged && !hasTypedNote() && !hasSavedNote()) showNoteRequired();
    else if(flagged && (hasTypedNote()||hasSavedNote())) clearNoteRequired();
  }
  function queueEnhance(){ if(enhanceRaf) return; enhanceRaf=requestAnimationFrame(enhance); }

  document.addEventListener('input',function(e){
    if(!isCandidatePage()||!panel()?.contains(e.target)) return;
    if(e.target===noteInput()){
      if(String(e.target.value||'').trim()) clearNoteRequired();
      return;
    }
    var field=e.target.closest&&e.target.closest('[data-field]');
    if(!field||field.getAttribute('data-field')==='master_notes') return;
    // React owns field state/status/autosave. Never mutate another controlled field
    // before React receives this input event; doing so can swallow the first digit.
    setTimeout(persistDomSafetySnapshot,0);
  },false);

  document.addEventListener('change',function(e){
    if(!isCandidatePage()||!panel()?.contains(e.target)||internalStatusChange) return;
    var field=e.target.closest&&e.target.closest('[data-field]');
    if(!field||field.getAttribute('data-field')==='master_notes') return;
    setTimeout(persistDomSafetySnapshot,0);
  },false);

  document.addEventListener('click',function(e){
    var submit=e.target&&e.target.closest&&e.target.closest('.candidate-submit-btn');
    // React owns Submit. Do not intercept it in capture phase or trigger a second
    // Save request; duplicate DOM/state writers caused refresh/recovery behavior.
    if(submit && isCandidatePage()) return;
    var add=e.target&&e.target.closest&&e.target.closest('.candidate-notes-chat-panel .add-profile-btn');
    if(add && hasTypedNote()) clearNoteRequired();
  },true);

  var observer=new MutationObserver(queueEnhance);
  function start(){ var root=document.getElementById('root')||document.body; if(root) observer.observe(root,{childList:true,subtree:true}); queueEnhance(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true}); else start();
  window.addEventListener('popstate',queueEnhance);
  window.addEventListener('career-crox-react-ready',queueEnhance);
})();


/* CC26_779: final low-egress brand/runtime repair. */
(function(){'use strict';
  if(window.__CC779_FINAL_RUNTIME__) return; window.__CC779_FINAL_RUNTIME__=true;
  const FULL_LOGO='/assets/img/career-crox-logo.svg?v=CC821_VECTOR_BRAND';
  let brandRaf=0;
  function forceFullBrand(){
    brandRaf=0;
    try{
      document.querySelectorAll('.sidebar .brand-box img').forEach(function(img){
        if(img.getAttribute('src')!==FULL_LOGO) img.setAttribute('src',FULL_LOGO);
        img.setAttribute('data-cc779-full-brand','1');
        img.setAttribute('alt','Career Crox');
      });
      document.querySelectorAll('.style15-logo img,.success-card img').forEach(function(img){
        if(img.getAttribute('src')!==FULL_LOGO) img.setAttribute('src',FULL_LOGO);
      });
    }catch(_e){}
  }
  function queueBrand(){ if(brandRaf)return; brandRaf=requestAnimationFrame(forceFullBrand); }
  const obs=new MutationObserver(queueBrand);
  function start(){ const root=document.getElementById('root')||document.body; if(root)obs.observe(root,{childList:true,subtree:true}); queueBrand(); }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
  window.addEventListener('popstate',queueBrand);
  window.addEventListener('cc-route-change',queueBrand);
  window.addEventListener('career-crox-react-ready',queueBrand);

  // SSE is the primary reminder transport. On returning to a stale tab, do one small
  // summary reconciliation instead of continuous polling, preserving the low-egress design.
  let lastFocusRefresh=0;
  function reconcileReminderOnReturn(){
    if(document.hidden) return;
    if(Date.now()-lastFocusRefresh<120000) return;
    lastFocusRefresh=Date.now();
    try{ if(typeof window.__CC730_REFRESH_REMINDERS__==='function') window.__CC730_REFRESH_REMINDERS__(true); }catch(_e){}
  }
  document.addEventListener('visibilitychange',reconcileReminderOnReturn);
  window.addEventListener('online',reconcileReminderOnReturn);
})();



;(function(){
  let timer=0,lastRefresh=0;
  function catchup(){
    if(document.hidden || /^\/login/.test(location.pathname) || Date.now()-lastRefresh<5000)return;
    clearTimeout(timer);timer=setTimeout(function(){
      lastRefresh=Date.now();
      if(typeof window.__CC730_REFRESH_REMINDERS__==='function') window.__CC730_REFRESH_REMINDERS__(true);
    },350);
  }
  ['career-crox-chat-ready','career-crox-reminder-ready','online','focus','pageshow'].forEach(function(event){window.addEventListener(event,catchup)});
  document.addEventListener('visibilitychange',catchup);
})();
;/* Consolidated integration: cc26-448-live-sync.js */
// CC26_448 production bridge: tiny call revision watcher + live tracking reports + readability/chat polish.
// /api/dialer/call-change is process-memory only; report data is fetched only on a real revision change or user refresh.
(function(){
  'use strict';
  if (window.__CC448_BRIDGE__) return;
  window.__CC448_BRIDGE__ = true;

  var lastRevision = '';
  var busy = false;
  var timer = null;
  var reportState = { mounted:false, loading:false, from:'', to:'', recruiter:'all', data:null };

  function route(){ return String(location.pathname || '').replace(/\/+$/,'') || '/'; }
  function visible(){ return !document.hidden; }
  function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]);}); }
  function istDateKey(date){
    var d=date||new Date(), parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
    function p(t){var x=parts.find(function(z){return z.type===t;});return x?x.value:'';}
    return p('year')+'-'+p('month')+'-'+p('day');
  }
  function rangePreset(preset){
    var today=istDateKey();
    if(preset==='month') return {from:today.slice(0,8)+'01',to:today};
    if(preset==='7d'){
      var end=new Date(today+'T12:00:00+05:30');
      return {from:istDateKey(new Date(end.getTime()-6*86400000)),to:today};
    }
    return {from:today,to:today};
  }
  function toIso(key,end){ if(!key)return ''; return new Date(key+'T'+(end?'23:59:59.999':'00:00:00.000')+'+05:30').toISOString(); }
  function fmtSec(v){ var s=Math.max(0,Number(v||0)),h=Math.floor(s/3600),m=Math.floor((s%3600)/60),q=Math.floor(s%60); return h?h+'h '+m+'m':m?m+'m '+q+'s':q+'s'; }
  function fmtMin(v){ var n=Math.max(0,Number(v||0)),h=Math.floor(n/60),m=Math.round(n%60); return h?h+'h '+m+'m':m+'m'; }
  function fmtIst(v){ if(!v)return '-'; var d=new Date(v); if(isNaN(d.getTime()))return String(v); return new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'2-digit',hour:'numeric',minute:'2-digit',hour12:true}).format(d); }
  function clickBySelector(selector){ var el=document.querySelector(selector); if(el&&!el.disabled){try{el.click();return true;}catch(e){}} return false; }

  function authFetch(url,options){
    var opts=options||{}; opts.credentials='include'; opts.cache='no-store';
    opts.headers=Object.assign({'Accept':'application/json','X-Career-Crox-Background':'1'},opts.headers||{});
    return fetch(url,opts).then(async function(r){
      var text=await r.text(); var data={}; try{data=text?JSON.parse(text):{};}catch(e){data={message:text||('HTTP '+r.status)};}
      if(!r.ok) throw new Error(data.message||data.error||('HTTP '+r.status)); return data;
    });
  }

  function metric(label,value,sub,key,warn){
    return '<button type="button" class="cc448-metric'+(warn?' warn':'')+'"'+(key?' data-metric="'+esc(key)+'"':' disabled')+'><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong>'+(sub?'<small>'+esc(sub)+'</small>':'')+'</button>';
  }
  function renderTrackingReport(data){
    var root=document.getElementById('cc448-tracking-reports'); if(!root)return;
    var s=(data&&data.summary)||{}, calls=s.calls||{}, perf=s.performance||{}, work=s.work||{}, pending=s.pending||{};
    var recruiters=(data&&data.recruiters)||[], opts=(data&&data.recruiter_options)||[];
    var sel=root.querySelector('#cc448-recruiter');
    if(sel){
      var current=reportState.recruiter||'all';
      sel.innerHTML='<option value="all">All Recruiters</option>'+opts.map(function(x){var val=x.recruiter_code||'';return '<option value="'+esc(val)+'">'+esc((x.full_name||x.recruiter_name||val)+(val?' · '+val:''))+'</option>';}).join('');
      sel.value=current;
    }
    var cards=root.querySelector('#cc448-report-cards');
    if(cards) cards.innerHTML=''
      +'<section class="cc448-card"><div class="cc448-cardhead"><strong>Call Report</strong><span>CRM profiles only</span></div><div class="cc448-metrics">'
      +metric('Total Calls',calls.total||0,'','call_total')+metric('Outgoing',calls.outgoing||0,fmtSec(calls.outgoing_talk_seconds),'call_outgoing')+metric('Incoming',calls.incoming||0,fmtSec(calls.incoming_talk_seconds),'call_incoming')
      +metric('Unique Candidates',calls.unique||0,'','call_unique')+metric('First-Time Calls',calls.first_time||0,'','call_first_time')+metric('Total Talk Time',fmtSec(calls.talk_seconds),'Incoming + outgoing','')+'</div></section>'
      +'<section class="cc448-card blue"><div class="cc448-cardhead"><strong>Performance</strong><span>Period / All time</span></div><div class="cc448-metrics">'
      +metric('Submissions',perf.submissions||0,'All '+(perf.submissions_all_time||0),'performance_submissions')+metric('Interviews',perf.interviews||0,'All '+(perf.interviews_all_time||0),'performance_interviews')+metric('Selections',perf.selections||0,'All '+(perf.selections_all_time||0),'performance_selections')
      +metric('Joinings',perf.joinings||0,'All '+(perf.joinings_all_time||0),'performance_joinings')+metric('Incomplete Subs',perf.incomplete_submissions||0,'','pending_incomplete_submissions',true)+metric('Overdue Interviews',perf.overdue_interviews||0,'','pending_overdue_interviews',true)+'</div></section>'
      +'<section class="cc448-card green"><div class="cc448-cardhead"><strong>Work & Break</strong><span>Active work only</span></div><div class="cc448-metrics">'
      +metric('Active Work',fmtMin(work.active_minutes),'','work_sessions')+metric('Break Time',fmtMin(work.break_minutes),'','work_breaks')+metric('Idle Time',fmtMin(work.idle_minutes),'','work_sessions')+metric('Work Remaining',fmtMin(work.remaining_minutes),'','work_sessions')+metric('CRM Locks',work.lock_count||0,'','work_locks',Number(work.lock_count||0)>0)+metric('Unlock Requests',work.unlock_requests||0,'','work_locks')+'</div></section>'
      +'<section class="cc448-card red"><div class="cc448-cardhead"><strong>Pending Queue</strong><span>Needs action</span></div><div class="cc448-metrics">'
      +metric('Incomplete Subs',pending.incomplete_submissions||0,'','pending_incomplete_submissions',true)+metric('Overdue Interviews',pending.overdue_interviews||0,'','pending_overdue_interviews',true)+metric('Pending Interviews',pending.pending_interviews||0,'','pending_interviews')+metric('Interview Not Called',pending.interview_not_called||0,'','pending_interview_not_called',true)+metric('Pending Follow-Ups',pending.pending_followups||0,'','pending_followups',true)+'</div></section>';
    var tbody=root.querySelector('#cc448-recruiter-body');
    if(tbody){
      tbody.innerHTML=recruiters.length?recruiters.map(function(r){return '<tr data-recruiter="'+esc(r.recruiter_code||'')+'"><td><strong>'+esc(r.recruiter_name||r.recruiter_code||'-')+'</strong><br><small>'+esc(r.recruiter_code||'')+'</small></td><td>'+esc(r.calls||0)+'</td><td>'+esc(fmtSec(r.talk_seconds))+'</td><td>'+esc(r.submissions||0)+'</td><td>'+esc(r.interviews||0)+'</td><td>'+esc(r.selections||0)+'</td><td>'+esc(r.joinings||0)+'</td><td>'+esc(fmtMin(r.active_minutes))+'</td><td>'+esc(fmtMin(r.break_minutes))+'</td><td>'+esc(fmtMin(r.idle_minutes))+'</td><td>'+esc(r.lock_count||0)+'</td><td>'+esc(fmtIst(r.login_at))+'</td><td>'+esc(fmtIst(r.logout_at))+'</td></tr>';}).join(''):'<tr><td colspan="13" class="cc448-empty">No recruiter activity found for this range.</td></tr>';
    }
    var status=root.querySelector('#cc448-report-status'); if(status){status.className='cc448-status';status.textContent='Live calculation source • CRM candidate calls only • Last refresh: '+fmtIst((data&&data.generated_at)||new Date().toISOString());}
    reportState.data=data;
  }
  async function loadTrackingReport(silent){
    if(route()!=='/reports'||reportState.loading)return false;
    var root=document.getElementById('cc448-tracking-reports'); if(!root)return false;
    reportState.loading=true;
    var btn=root.querySelector('#cc448-refresh'); if(btn&&!silent){btn.disabled=true;btn.textContent='Refreshing…';}
    var status=root.querySelector('#cc448-report-status'); if(status&&!silent){status.className='cc448-status';status.textContent='Loading central tracking report…';}
    try{
      var q=new URLSearchParams({from:toIso(reportState.from,false),to:toIso(reportState.to,true),recruiter_code:reportState.recruiter||'all',_ts:String(Date.now())});
      var data=await authFetch('/api/reports/tracking-hub?'+q.toString()); renderTrackingReport(data); return true;
    }catch(e){ if(status){status.className='cc448-status error';status.textContent=e.message||'Tracking report could not load.';} return false; }
    finally{reportState.loading=false;if(btn){btn.disabled=false;btn.textContent='Refresh Report';}}
  }
  async function openMetric(metricKey){
    if(!metricKey)return;
    var root=document.getElementById('cc448-tracking-reports'); if(!root)return;
    var modal=root.querySelector('#cc448-modal'); if(!modal)return;
    modal.style.display='grid'; modal.innerHTML='<div class="cc448-modalbox"><div class="cc448-modalhead"><strong>Loading details…</strong><button type="button" data-close="1">×</button></div><div class="cc448-modalbody cc448-empty">Please wait…</div></div>';
    try{
      var q=new URLSearchParams({from:toIso(reportState.from,false),to:toIso(reportState.to,true),recruiter_code:reportState.recruiter||'all',metric:metricKey,_ts:String(Date.now())});
      var d=await authFetch('/api/reports/tracking-details?'+q.toString()); var items=d.items||[]; var cols=items.length?Object.keys(items[0]):[];
      var body=items.length?'<div class="cc448-tablewrap"><table class="cc448-table"><thead><tr>'+cols.map(function(c){return '<th>'+esc(c.replace(/_/g,' '))+'</th>';}).join('')+'</tr></thead><tbody>'+items.map(function(it){return '<tr>'+cols.map(function(c){return '<td>'+esc(it[c]==null?'-':it[c])+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table></div>':'<div class="cc448-empty">No matching records.</div>';
      modal.innerHTML='<div class="cc448-modalbox"><div class="cc448-modalhead"><strong>'+esc(metricKey.replace(/_/g,' '))+'</strong><button type="button" data-close="1">×</button></div><div class="cc448-modalbody">'+body+'</div></div>';
    }catch(e){modal.innerHTML='<div class="cc448-modalbox"><div class="cc448-modalhead"><strong>Details</strong><button type="button" data-close="1">×</button></div><div class="cc448-modalbody cc448-empty">'+esc(e.message||'Details could not load.')+'</div></div>';}
  }
  function mountTrackingReports(){document.querySelectorAll('#cc448-report-root,#cc448-report-modal').forEach(function(el){el.remove()});}

  function refreshCurrentCallView(){
    var p=route();
    if(p==='/live-dialing') return clickBySelector('.assistant-update-btn');
    if(p==='/reports') return false;
    return false;
  }
  async function tick(){
    if(busy||!visible())return;
    var p=route(); if(p!=='/live-dialing'&&p!=='/reports')return;
    if(p==='/reports') mountTrackingReports();
    busy=true;
    try{
      var d=await authFetch('/api/dialer/call-change?_='+Date.now()); var rev=String((d&&d.revision)||''); if(!rev)return;
      if(!lastRevision){lastRevision=rev;return;}
      if(rev!==lastRevision){ if(refreshCurrentCallView()) lastRevision=rev; }
    }catch(e){}finally{busy=false;}
  }
  function start(){ if(timer)clearInterval(timer);timer=null; /* Manual report/phone refresh: no repeating Render checks. */ }

  var style=document.createElement('style'); style.id='cc448-production-polish';
  style.textContent=[
    'body:not(.login-body) .main-wrap{font-size:15px!important}',
    'body:not(.login-body) .main-wrap button,body:not(.login-body) .main-wrap input,body:not(.login-body) .main-wrap select,body:not(.login-body) .main-wrap textarea{font-size:13.5px!important}',
    'body:not(.login-body) .main-wrap .crm-table tbody td,body:not(.login-body) .main-wrap .reports-table td{font-size:13.5px!important}',
    'body:not(.login-body) .main-wrap .helper-text,body:not(.login-body) .main-wrap .subtle,body:not(.login-body) .main-wrap small{font-size:11px!important}',
    'body:not(.login-body) .main-wrap .panel-title,body:not(.login-body) .main-wrap .table-title{font-size:16px!important}',
    'body:not(.login-body) .teamsShell .emojiBtn{font-size:18px!important;min-width:36px!important;min-height:34px!important}',
    'body:not(.login-body) .teamsShell .composeBox textarea{font-size:14px!important;font-weight:750!important}',
    'body:not(.login-body) .teamsShell .chatBubble:hover{transform:translateY(-1px)!important;box-shadow:0 10px 23px rgba(41,77,122,.09)!important}',
    'body:not(.login-body) .teamsShell .callBtn{border-radius:999px!important;font-size:11.5px!important}',
    '.cc448-wrap{--ink:#173a67;--muted:#6a7f99;--line:#d9e7f5;display:grid;gap:16px;color:var(--ink)}',
    '.cc448-hero{border:1px solid var(--line);border-radius:24px;padding:20px;background:linear-gradient(135deg,#fff,#f5faff 58%,#fff7ed);box-shadow:0 16px 38px rgba(31,73,125,.09)}',
    '.cc448-title{font-size:26px;font-weight:1000;letter-spacing:-.035em;color:#12345e}.cc448-sub{margin-top:5px;font-size:13px;font-weight:750;color:var(--muted)}',
    '.cc448-filter{margin-top:16px;display:flex;gap:9px;align-items:end;flex-wrap:wrap}.cc448-filter label{display:grid;gap:5px;font-size:11px;font-weight:900;color:#5f7691}.cc448-filter input,.cc448-filter select,.cc448-filter button{height:40px;border:1px solid #cfe0f2;border-radius:13px;background:#fff;padding:0 12px;color:#173a67;font-weight:900}.cc448-filter button{cursor:pointer}.cc448-filter button.active{background:#fff0df;border-color:#ffc785;color:#c76011}.cc448-filter .primary{border:0;background:linear-gradient(135deg,#ff7a18,#ffad42);color:#fff}',
    '.cc448-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.cc448-card{border:1px solid var(--line);border-radius:22px;background:#fff;padding:16px;box-shadow:0 12px 28px rgba(38,78,122,.07);border-top:3px solid #ff8d2f}.cc448-card.blue{border-top-color:#2f80ed}.cc448-card.green{border-top-color:#21a179}.cc448-card.red{border-top-color:#f25f5c}.cc448-cardhead{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.cc448-cardhead strong{font-size:17px}.cc448-cardhead span{padding:6px 9px;border-radius:999px;background:#f4f9ff;color:#55708f;font-size:10px;font-weight:1000}',
    '.cc448-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.cc448-metric{min-height:92px;text-align:left;border:1px solid #dce9f6;border-radius:16px;background:linear-gradient(145deg,#fff,#f8fbff);padding:11px;cursor:pointer;color:#173a67}.cc448-metric:disabled{cursor:default}.cc448-metric span{display:block;font-size:10.5px;font-weight:900;color:#71859c;text-transform:uppercase}.cc448-metric strong{display:block;margin-top:6px;font-size:22px;font-weight:1000}.cc448-metric small{display:block;margin-top:4px;font-size:10.5px;font-weight:800;color:#7890a8}.cc448-metric.warn{background:#fff8f1;border-color:#ffd9b6}',
    '.cc448-tablecard{border:1px solid var(--line);border-radius:22px;background:#fff;overflow:hidden;box-shadow:0 12px 28px rgba(38,78,122,.06)}.cc448-tablehead{padding:15px 16px;border-bottom:1px solid #e4eef8;display:flex;justify-content:space-between}.cc448-tablewrap{overflow:auto;max-height:440px}.cc448-table{width:100%;border-collapse:collapse;min-width:980px}.cc448-table th{position:sticky;top:0;background:#f5f9ff;color:#5b728e;font-size:10.5px;padding:10px 12px;text-align:left}.cc448-table td{padding:11px 12px;border-bottom:1px solid #edf3f9;font-size:12px;font-weight:750}.cc448-table tbody tr[data-recruiter]{cursor:pointer}.cc448-table tbody tr[data-recruiter]:hover td{background:#fbfdff}',
    '.cc448-status{padding:10px 12px;border-radius:14px;background:#f7fbff;border:1px solid #d7e6f7;font-size:12px;font-weight:800;color:#617995}.cc448-status.error{background:#fff3f0;border-color:#ffc8bf;color:#aa3a2d}.cc448-empty{padding:28px;text-align:center;color:#70859b;font-weight:850}',
    '.cc448-modal{position:fixed;inset:0;background:rgba(16,42,73,.28);backdrop-filter:blur(4px);z-index:100000;place-items:center;padding:18px}.cc448-modalbox{width:min(1180px,96vw);max-height:88vh;display:flex;flex-direction:column;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 30px 80px rgba(22,54,92,.25)}.cc448-modalhead{display:flex;justify-content:space-between;align-items:center;padding:15px 18px;background:linear-gradient(135deg,#f7fbff,#fff8ef)}.cc448-modalhead button{width:34px;height:34px;border-radius:11px;border:1px solid #d7e6f7;background:#fff;font-size:20px}.cc448-modalbody{overflow:auto;min-height:180px}',
    '@media(max-width:1150px){.cc448-grid{grid-template-columns:1fr}.cc448-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:680px){.cc448-metrics{grid-template-columns:1fr 1fr}.cc448-title{font-size:22px}}'
  ].join('\n');
  document.head.appendChild(style);
  setTimeout(function(){try{if(document.body&&style.parentNode!==document.body)document.body.appendChild(style);}catch(e){}},1800);

  var chatMap={'People':'People','Channels':'Channels','All':'All','Team Channel':'Team Channel','Private Chat':'Direct Message','Today':'Today'};
  function casualizeChat(){ return; }

  function onRoute(){lastRevision='';if(route()==='/reports')setTimeout(mountTrackingReports,80);setTimeout(casualizeChat,80);}
  document.addEventListener('visibilitychange',function(){if(!document.hidden){tick();casualizeChat();}});
  window.addEventListener('popstate',onRoute);
  var oldPush=history.pushState,oldReplace=history.replaceState;
  history.pushState=function(){var r=oldPush.apply(this,arguments);onRoute();return r;};
  history.replaceState=function(){var r=oldReplace.apply(this,arguments);onRoute();return r;};
  start(); onRoute(); casualizeChat();
})();


;/* Consolidated integration: cc26-463-quick-add-full.js */
(function(){
  'use strict';
  var BUILD='CC26_452';
  var extraState={
    client:'', jd_id:'', recruiter_code:'', lead_source:'Manual',
    interview_availability:'Yes', follow_up_status:'Open', follow_up_note:'',
    reference_details:'', data_notes:''
  };
  var lookupCache=null;
  var originalFetch=window.fetch;
  var installTimer=null;

  function isQuickCandidate(){ return location.pathname.replace(/\/+$/,'')==='/quick-add/candidate'; }
  function text(el){ return String(el&&el.textContent||'').trim(); }
  function esc(v){ return String(v==null?'':v).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function safeJson(response){ try{return response.clone().json().catch(function(){return null;});}catch(e){return Promise.resolve(null);} }
  function normalizeUrl(input){ try{return typeof input==='string'?input:(input&&input.url)||'';}catch(e){return '';} }
  function methodOf(input,init){ return String((init&&init.method)||(input&&input.method)||'GET').toUpperCase(); }

  // Reuse the application's own lookups response; do not add polling or repeated backend reads.
  window.fetch=function(input,init){
    var url=normalizeUrl(input), method=methodOf(input,init);
    var nextInit=init;
    if(method==='POST' && /\/api\/candidates(?:\?.*)?$/.test(url) && !/\/bulk-/.test(url)){
      try{
        var body=nextInit&&nextInit.body;
        if(typeof body==='string' && body.trim().charAt(0)==='{'){
          var parsed=JSON.parse(body);
          Object.keys(extraState).forEach(function(k){
            var v=extraState[k];
            if(v!==undefined && v!==null && String(v).trim()!=='') parsed[k]=v;
          });
          if(parsed.jd_id && lookupCache && Array.isArray(lookupCache.jds)){
            var jd=lookupCache.jds.find(function(x){return String(x&&x.jd_id||'')===String(parsed.jd_id);});
            if(jd){
              if(!parsed.jd_name) parsed.jd_name=jd.job_title||jd.process_name||'';
              if(!parsed.client) parsed.client=jd.company||'';
            }
          }
          nextInit=Object.assign({},nextInit,{body:JSON.stringify(parsed)});
        }
      }catch(e){}
    }
    var promise=originalFetch.call(this,input,nextInit);
    if(method==='POST' && /\/api\/candidates(?:\?.*)?$/.test(url) && !/\/bulk-/.test(url)){
      return promise.then(function(resp){
        if(resp && resp.ok){
          Object.assign(extraState,{client:'',jd_id:'',recruiter_code:'',lead_source:'Manual',interview_availability:'Yes',follow_up_status:'Open',follow_up_note:'',reference_details:'',data_notes:''});
        }
        return resp;
      });
    }
    if(method==='GET' && /\/api\/ui\/lookups(?:\?.*)?$/.test(url)){
      promise.then(function(resp){return safeJson(resp);}).then(function(data){
        if(data && typeof data==='object'){
          lookupCache=data;
          window.__CC452_LOOKUPS=data;
          setTimeout(install,0);
        }
      }).catch(function(){});
    }
    return promise;
  };

  function controlFor(labelText){
    var form=document.querySelector('.qa-candidate-shell'); if(!form)return null;
    var fields=form.querySelectorAll('.field');
    for(var i=0;i<fields.length;i++){
      var lab=fields[i].querySelector('label');
      if(lab && text(lab).toLowerCase()===String(labelText).toLowerCase()) return fields[i].querySelector('input,select,textarea');
    }
    return null;
  }
  function ensureInterviewMode(){
    var sel=controlFor('Interview Mode');
    if(sel && sel.tagName==='SELECT' && !Array.from(sel.options).some(function(o){return o.value==='Onsite';})){
      var op=document.createElement('option'); op.value='Onsite'; op.textContent='Onsite'; sel.appendChild(op);
    }
  }
  function opts(items, valueKey, labelFn){
    return (Array.isArray(items)?items:[]).map(function(item){
      var val=typeof item==='string'?item:String(item&&item[valueKey]||'');
      if(!val)return '';
      var label=typeof item==='string'?item:labelFn(item);
      return '<option value="'+esc(val)+'">'+esc(label||val)+'</option>';
    }).join('');
  }
  function field(name,label,html){
    return '<div class="field cc452-extra-field" data-field="'+esc(name)+'"><label>'+esc(label)+'</label>'+html+'</div>';
  }
  function selectedAttr(value,current){return String(value)===String(current)?' selected':'';}
  function selectHtml(name, values, current, first){
    var out='<select data-cc452-name="'+esc(name)+'">';
    if(first)out+='<option value="">'+esc(first)+'</option>';
    values.forEach(function(v){var value=typeof v==='string'?v:v.value,label=typeof v==='string'?v:v.label;out+='<option value="'+esc(value)+'"'+selectedAttr(value,current)+'>'+esc(label)+'</option>';});
    return out+'</select>';
  }
  function install(){
    if(!isQuickCandidate())return;
    var form=document.querySelector('.qa-candidate-shell'); if(!form)return;
    ensureInterviewMode();
    var existing=form.querySelector('.cc452-full-details');
    if(existing){ refreshDynamicOptions(existing); return; }

    var anchor=null;
    Array.from(form.querySelectorAll('.qa-section-title')).some(function(el){if(text(el)==='Submission Control'){anchor=el;return true;}return false;});
    if(!anchor)return;

    var jds=(lookupCache&&Array.isArray(lookupCache.jds))?lookupCache.jds:[];
    var users=(lookupCache&&Array.isArray(lookupCache.users))?lookupCache.users:[];
    var jdOptions=jds.map(function(j){return {value:j.jd_id,label:(j.job_title||j.process_name||j.jd_id)+(j.company?' • '+j.company:'')};});
    var userOptions=users.filter(function(u){return u&&u.recruiter_code;}).map(function(u){return {value:u.recruiter_code,label:(u.full_name||u.username||u.recruiter_code)+' • '+u.recruiter_code};});

    var wrap=document.createElement('div');
    wrap.className='cc452-full-details';
    wrap.innerHTML=`
      <div class="qa-section-title cc452-title">Client, JD & Ownership</div>
      <div class="candidate-form-grid candidate-compact-grid cc452-grid">
        ${field('client','Client / Company','<input data-cc452-name="client" value="'+esc(extraState.client)+'" placeholder="Client / Company" />')}
        ${field('jd_id','JD',selectHtml('jd_id',jdOptions,extraState.jd_id,'Select JD (optional)'))}
        ${field('recruiter_code','Recruiter',selectHtml('recruiter_code',userOptions,extraState.recruiter_code,'Auto assign current recruiter'))}
        ${field('lead_source','Lead Source',selectHtml('lead_source',['Manual','Referral','Indeed','Naukri','Job Hai','LinkedIn','WhatsApp','Other'],extraState.lead_source,''))}
      </div>
      <div class="qa-section-title cc452-title">Interview & Follow-up Details</div>
      <div class="candidate-form-grid candidate-compact-grid cc452-grid">
        ${field('interview_availability','Interview Availability',selectHtml('interview_availability',['Yes','No','Pending'],extraState.interview_availability,''))}
        ${field('follow_up_status','Follow-up Status',selectHtml('follow_up_status',['Open','Pending','Done','Closed'],extraState.follow_up_status,''))}
        ${field('follow_up_note','Follow-up Note','<textarea rows="3" data-cc452-name="follow_up_note" placeholder="Next call / follow-up context">'+esc(extraState.follow_up_note)+'</textarea>')}
        ${field('reference_details','Reference Details','<textarea rows="3" data-cc452-name="reference_details" placeholder="Reference / source details">'+esc(extraState.reference_details)+'</textarea>')}
        ${field('data_notes','Data Notes','<textarea rows="3" data-cc452-name="data_notes" placeholder="Internal data/upload note">'+esc(extraState.data_notes)+'</textarea>')}
      </div>
      <div class="cc452-complete-note">All recruiter-entry details are now available on this page. Existing candidate save, resume auto-fill and profile opening remain unchanged.</div>
    `;
    anchor.parentNode.insertBefore(wrap,anchor);
    wrap.addEventListener('input',captureExtra,true);
    wrap.addEventListener('change',captureExtra,true);
    refreshDynamicOptions(wrap);
  }
  function captureExtra(e){
    var el=e.target; var key=el&&el.getAttribute&&el.getAttribute('data-cc452-name'); if(!key)return;
    extraState[key]=el.value||'';
  }
  function refreshSelect(sel, options, firstLabel){
    if(!sel)return;
    var old=sel.value;
    var html=firstLabel?'<option value="">'+esc(firstLabel)+'</option>':'';
    html+=options.map(function(o){return '<option value="'+esc(o.value)+'">'+esc(o.label)+'</option>';}).join('');
    if(sel.dataset.cc452Sig===html)return;
    sel.innerHTML=html; sel.dataset.cc452Sig=html;
    sel.value=old||extraState[sel.dataset.cc452Name]||'';
  }
  function refreshDynamicOptions(wrap){
    if(!lookupCache)return;
    var jdSel=wrap.querySelector('[data-cc452-name="jd_id"]');
    var userSel=wrap.querySelector('[data-cc452-name="recruiter_code"]');
    refreshSelect(jdSel,(lookupCache.jds||[]).filter(Boolean).map(function(j){return {value:String(j.jd_id||''),label:(j.job_title||j.process_name||j.jd_id)+(j.company?' • '+j.company:'')};}).filter(function(x){return x.value;}),'Select JD (optional)');
    refreshSelect(userSel,(lookupCache.users||[]).filter(function(u){return u&&u.recruiter_code;}).map(function(u){return {value:String(u.recruiter_code),label:(u.full_name||u.username||u.recruiter_code)+' • '+u.recruiter_code};}),'Auto assign current recruiter');
  }

  var style=document.createElement('style');
  style.id='cc452-quick-add-full-style';
  style.textContent=`
    .cc452-full-details{display:grid;gap:14px}
    .cc452-title{margin-top:2px!important}
    .cc452-grid .field{min-width:0}
    .cc452-grid .field input,.cc452-grid .field select,.cc452-grid .field textarea{width:100%;box-sizing:border-box;background:linear-gradient(180deg,#f8fbff 0%,#eaf3ff 100%)!important;color:#173252!important;-webkit-text-fill-color:#173252!important;border:1px solid rgba(92,132,204,.24)!important;border-radius:14px!important}
    .cc452-grid textarea{resize:vertical;min-height:82px}
    .cc452-complete-note{padding:11px 14px;border-radius:16px;border:1px solid rgba(80,150,220,.18);background:linear-gradient(135deg,#eef8ff,#f7fbff);color:#335b84;font-size:12px;font-weight:800;line-height:1.55}
  `;
  document.head.appendChild(style);

  function schedule(){if(installTimer)return;installTimer=setTimeout(function(){installTimer=null;install();},45);}
  ['pushState','replaceState'].forEach(function(name){var old=history[name];history[name]=function(){var r=old.apply(this,arguments);schedule();setTimeout(schedule,180);setTimeout(schedule,700);return r;};});
  window.addEventListener('popstate',schedule);
  window.addEventListener('DOMContentLoaded',schedule);
  schedule();
  window.__CC452_QUICK_ADD_FULL={build:BUILD,state:extraState,install:install};
})();


/* CC26_453 REMINDER DATA INTEGRITY: zero-polling startup purge */
(function(){
  'use strict';
  if(window.__CC453_REMINDER_DATA_INTEGRITY__) return;
  window.__CC453_REMINDER_DATA_INTEGRITY__='CC26_453';
  var keys=['cc377_due_reminder_backlog','cc379_due_reminder_backlog','cc388_due_reminder_backlog','cc389_due_reminder_backlog','cc390_due_reminder_backlog','cc391_due_reminder_backlog'];
  try{keys.forEach(function(k){localStorage.removeItem(k);});}catch(e){}
  try{document.querySelectorAll('.cc379-reminder-deck,.cc388-reminder-deck,.cc389-reminder-deck,.cc390-reminder-deck,.cc391-reminder-deck').forEach(function(el){el.innerHTML='';});}catch(e){}
})();


/* CC26_454 Quick Add -> Candidate Profile direct bridge */
(function(){
  'use strict';
  // CC870: React owns ID-less drafts and the atomic Save/Submit command.
  // The legacy bridge treats a command envelope as a flat create payload,
  // loses fields.phone and incorrectly creates a candidate before Submit.
  if (window.__CC780_ATOMIC_PROFILE__) return;
  if (window.__CC454_QUICK_ADD_PROFILE_BRIDGE__) return;
  window.__CC454_QUICK_ADD_PROFILE_BRIDGE__ = 'CC26_454';

  var nativeFetch = window.fetch.bind(window);
  var realCandidateId = ''; // CC26_752: internal bridge only; React Router owns the saved candidate route.
  var createPromise = null;
  var pendingNotes = [];
  var pendingFiles = [];
  var lookupsPromise = null;

  function cleanPath(input){
    try {
      var raw = typeof input === 'string' ? input : (input && input.url) || '';
      return new URL(raw, location.origin).pathname + new URL(raw, location.origin).search;
    } catch(e) { return String(input || ''); }
  }
  function methodOf(input, init){
    return String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
  }
  function jsonBody(init){
    try { return typeof (init && init.body) === 'string' ? JSON.parse(init.body || '{}') : {}; }
    catch(e) { return {}; }
  }
  function responseJson(payload, status){
    return new Response(JSON.stringify(payload || {}), {status: status || 200, headers: {'Content-Type':'application/json'}});
  }
  function isNewPath(path){ return /\/api\/candidates\/new(?:[/?]|$)/.test(path); }
  function replaceNewId(path, id){ return path.replace('/api/candidates/new', '/api/candidates/' + encodeURIComponent(id)); }
  function stripCreatePayload(source){
    var payload = Object.assign({}, source || {});
    ['candidate_id','created_at','updated_at','last_viewed_at','last_viewed_by_name','_crm_row_id','_client_updated_at','_changed_fields','_client_base_values','jd_fit_summary','notes_list','timeline','nav_items','process_options'].forEach(function(k){ delete payload[k]; });
    if (String(payload.status || '').toLowerCase() === 'pending approval') payload.status = 'In - Progress';
    if (!payload.status) payload.status = 'Draft';
    if (!payload.approval_status) payload.approval_status = 'Draft';
    return payload;
  }
  function createInitFrom(init, payload){
    var headers = Object.assign({}, (init && init.headers) || {}, {'Content-Type':'application/json'});
    return Object.assign({}, init || {}, {method:'POST', credentials:'include', headers:headers, body:JSON.stringify(payload || {})});
  }
  function safeCloneJson(resp){
    try { return resp.clone().json().catch(function(){ return null; }); }
    catch(e) { return Promise.resolve(null); }
  }
  function getLookups(init){
    if (lookupsPromise) return lookupsPromise;
    var headers = Object.assign({}, (init && init.headers) || {});
    lookupsPromise = nativeFetch('/api/ui/lookups', {method:'GET', credentials:'include', headers:headers})
      .then(function(resp){ return resp.ok ? resp.json() : {}; })
      .catch(function(){ return {}; });
    return lookupsPromise;
  }
  function syntheticCandidate(lookups){
    var users = Array.isArray(lookups && lookups.users) ? lookups.users : [];
    var cachedUser = {};
    try { cachedUser = JSON.parse(localStorage.getItem('careerCroxCachedUser') || '{}') || {}; } catch(e) {}
    return {
      item: {
        candidate_id:'new', full_name:'', phone:'', location:'', qualification:'', preferred_location:'Noida', qualification_level:'Graduate',
        total_experience:'', relevant_experience:'', relevant_experience_range:'', ctc_monthly:'', in_hand_salary:'', relevant_in_hand_range:'',
        career_gap:'Fresher', documents_availability:'Yes', communication_skill:'', client:'', process:'', jd_id:'', interview_availability:'',
        interview_reschedule_date:'', virtual_onsite:'Walkin', follow_up_at:'', follow_up_status:'Open', follow_up_note:'', status:'Draft',
        profile_priority:'Medium', all_details_sent:'Pending', submission_date:new Date().toISOString().slice(0,16), approval_status:'Draft',
        call_connected:'', looking_for_job:'Yes', notes:'', data_notes:'', recruiter_code:cachedUser.recruiter_code || '',
        recruiter_name:cachedUser.full_name || cachedUser.username || '', recruiter_designation:cachedUser.designation || ''
      },
      notes: pendingNotes.map(function(n, i){ return {id:'new-note-'+i, candidate_id:'new', username:cachedUser.full_name || cachedUser.username || 'You', body:n.body || '', note_type:n.note_type || 'public', created_at:new Date().toISOString()}; }),
      timeline:[],
      process_options:Array.isArray(lookups && lookups.process_options) ? lookups.process_options : [],
      recruiter_options:users,
      nav_items:[],
      files:[]
    };
  }
  function flushPending(id, init){
    var jobs = [];
    pendingNotes.splice(0).forEach(function(note){
      jobs.push(nativeFetch('/api/candidates/'+encodeURIComponent(id)+'/notes', createInitFrom(init, note)).catch(function(){}));
    });
    pendingFiles.splice(0).forEach(function(file){
      jobs.push(nativeFetch('/api/candidates/'+encodeURIComponent(id)+'/files', createInitFrom(init, file)).catch(function(){}));
    });
    return Promise.all(jobs);
  }
  function routeToRealCandidate(id){
    if (!id) return;
    try {
      realCandidateId = String(id);
      window.__CC746_PERSISTED_CANDIDATE_ID__ = String(id);
      sessionStorage.setItem('cc750_adopted_candidate_id', String(id));
      // CC26_750: never touch browser history here. The React profile must stay
      // mounted after Save/Submit/Note. Refresh recovery is handled before boot.
    } catch(e) {}
  }
  function ensureCreated(payload, init){
    if (realCandidateId) return Promise.resolve({candidate_id:realCandidateId});
    if (createPromise) return createPromise;
    createPromise = nativeFetch('/api/candidates', createInitFrom(init, stripCreatePayload(payload)))
      .then(function(resp){
        if (!resp.ok) return safeCloneJson(resp).then(function(data){ throw new Error((data && data.message) || 'Candidate create failed'); });
        return resp.json();
      })
      .then(function(data){
        var item = (data && data.item) || {};
        var id = String(item.candidate_id || '').trim();
        if (!id) throw new Error('Candidate ID was not generated');
        realCandidateId = id;
        return flushPending(id, init).then(function(){ routeToRealCandidate(id); return item; });
      })
      .catch(function(err){ createPromise = null; throw err; });
    return createPromise;
  }

  window.fetch = function(input, init){
    var path = cleanPath(input);
    var method = methodOf(input, init);
    // Keep atomic commands untouched even if React ownership is enabled later.
    if (/^\/api\/candidates\/new\/commit(?:\?|$)/.test(path)) return nativeFetch(input, init);
    if (!isNewPath(path)) return nativeFetch(input, init);

    if (realCandidateId) return nativeFetch(replaceNewId(path, realCandidateId), init);

    if (method === 'GET' && /^\/api\/candidates\/new(?:\?|$)/.test(path)) {
      return getLookups(init).then(function(lookups){ return responseJson(syntheticCandidate(lookups)); });
    }
    if (method === 'POST' && /\/api\/candidates\/new\/open(?:\?|$)/.test(path)) {
      return Promise.resolve(responseJson({ok:true,last_viewed_at:new Date().toISOString()}));
    }
    if (method === 'POST' && /\/api\/candidates\/new\/notes(?:\?|$)/.test(path)) {
      var note = jsonBody(init); pendingNotes.push(note);
      return Promise.resolve(responseJson({ok:true,item:Object.assign({id:'new-note-'+pendingNotes.length,candidate_id:'new',created_at:new Date().toISOString()}, note)}));
    }
    if (method === 'POST' && /\/api\/candidates\/new\/files(?:\?|$)/.test(path)) {
      pendingFiles.push(jsonBody(init));
      return Promise.resolve(responseJson({ok:true,file:{file_id:'pending-'+pendingFiles.length,candidate_id:'new'}}));
    }
    if (method === 'PUT' && /^\/api\/candidates\/new(?:\?|$)/.test(path)) {
      var putPayload = jsonBody(init);
      return ensureCreated(putPayload, init).then(function(created){
        var target = replaceNewId(path, realCandidateId || created.candidate_id);
        return nativeFetch(target, Object.assign({}, init, {body:JSON.stringify(Object.assign({}, putPayload, {candidate_id:realCandidateId || created.candidate_id}))}));
      });
    }
    if (method === 'POST' && /\/api\/candidates\/new\/submit(?:\?|$)/.test(path)) {
      var submitPayload = jsonBody(init);
      return ensureCreated(submitPayload, init).then(function(created){
        var id = realCandidateId || created.candidate_id;
        return nativeFetch('/api/candidates/'+encodeURIComponent(id)+'/submit', Object.assign({}, init, {body:JSON.stringify(Object.assign({}, submitPayload, {candidate_id:id}))}));
      });
    }
    return ensureCreated(jsonBody(init), init).then(function(created){
      return nativeFetch(replaceNewId(path, realCandidateId || created.candidate_id), init);
    });
  };

  // CC26_646: the real Candidate Profile is available at /candidate/new.
  // NEVER rewrite it into Quick Add Hub: that replaces the user's chosen original UI.
  function normalizeCandidateNewRoute(){ /* deliberately no-op */ }
  function polishNewProfile(){
    if (location.pathname !== '/quick-add/candidate') return;
    var inputs = document.querySelectorAll('input');
    inputs.forEach(function(el){ if (String(el.value || '').trim().toLowerCase() === 'new') el.value = ''; });
    var fields = document.querySelectorAll('.field');
    fields.forEach(function(field){
      var label = field.querySelector('label');
      var sel = field.querySelector('select');
      if (label && sel && String(label.textContent || '').trim() === 'Interview Mode' && !Array.from(sel.options).some(function(o){return o.value==='Onsite';})) {
        var op = document.createElement('option'); op.value='Onsite'; op.textContent='Onsite'; sel.appendChild(op);
      }
    });
    var title = document.querySelector('.panel-title');
    if (title && String(title.textContent || '').trim() === 'Candidate Profile') title.textContent = 'Add Candidate • Full Profile';
  }
  window.addEventListener('popstate', function(){ setTimeout(polishNewProfile, 0); setTimeout(polishNewProfile,180); setTimeout(polishNewProfile,700); });
  window.addEventListener('DOMContentLoaded', function(){ normalizeCandidateNewRoute(); setTimeout(polishNewProfile, 0); setTimeout(polishNewProfile,180); setTimeout(polishNewProfile,700); });
  normalizeCandidateNewRoute();
})();

/* CC26_463: duplicate attendance/timer runtime removed. Quick Add bridge ends here. */


;/* Consolidated integration: cc26-486-distance-tracker.js */
(function(){
  'use strict';
  if (window.__CC_DISTANCE_TRACKER_486) return;
  window.__CC_DISTANCE_TRACKER_486 = true;

  var STORE_KEY='careerCroxDistancePresets:v1';
  var ROUTE_CACHE_KEY='careerCroxDistanceRouteCache:v2';
  var NEAREST_CACHE_KEY='careerCroxDistanceNearestCache:v2';
  var BUILTINS=[
    {id:'eos62',name:'EOS Globe - Sector 62',pin:'201309',address:'2nd Floor, Trapezoid IT Park, C-56, C Block, Phase 2, Industrial Area, Sector 62, Noida, Uttar Pradesh 201309, India',builtin:true},
    {id:'altruist-cogent127',name:'Altruist / Cogent - Sector 127',pin:'201304',address:'Tower C, Plot No. 6, Tech Boulevard, Sector 127, Noida, Uttar Pradesh 201304, India',builtin:true},
    {id:'altruist-tvs58',name:'Altruist - TVS - Sector 58',pin:'201309',address:'C-69, Ground Floor, Sector 58, Noida, Uttar Pradesh 201309, India',builtin:true},
    {id:'ienergizer60',name:'iEnergizer - Sector 60',pin:'201301',address:'A-37, Block A, Sector 60, Noida, Uttar Pradesh 201301, India',builtin:true},
    {id:'globiva18',name:'Globiva - Sector 18',pin:'122015',address:'2nd Floor, AIHP Signature, 418-419, Phase IV, Udyog Vihar, Sector 18, Gurugram, Haryana 122015, India',builtin:true},
    {id:'1point1-18',name:'1Point1 - Sector 18',pin:'122015',address:'Plot No. 17, Industrial Estate, Sector 18, Gurugram, Haryana 122015, India',builtin:true}
  ];

  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]})}
  function digits(v){return String(v||'').replace(/\D+/g,'').slice(0,6)}
  function validPin(v){return /^[1-9][0-9]{5}$/.test(String(v||''))}
  function readJson(key,fallback){try{var v=JSON.parse(localStorage.getItem(key)||'null');return v==null?fallback:v}catch(e){return fallback}}
  function writeJson(key,v){try{localStorage.setItem(key,JSON.stringify(v));return true}catch(e){return false}}
  function customs(){var rows=readJson(STORE_KEY,[]);return Array.isArray(rows)?rows.filter(function(x){return x&&validPin(x.pin)&&String(x.name||'').trim()}).slice(0,12):[]}
  function allSites(){var out=[],seen={};BUILTINS.concat(customs()).forEach(function(s){var p=digits(s.pin),id=String(s.id||('site-'+p+'-'+String(s.name||''))).trim(),key=id.toLowerCase();if(validPin(p)&&!seen[key]){seen[key]=1;out.push({id:id,name:String(s.name||('PIN '+p)).trim().slice(0,52),pin:p,address:String(s.address||'').trim().slice(0,220),builtin:!!s.builtin})}});return out.slice(0,15)}
  function fmtMin(n){n=Math.max(0,Number(n)||0);var h=Math.floor(n/60),m=Math.round(n%60);return h? h+'h '+m+'m' : m+' min'}
  function fmtKm(n){var x=Number(n)||0;return x<10?x.toFixed(1)+' km':Math.round(x)+' km'}
  function cacheGet(key,sub,ttl){var c=readJson(key,{}),h=c&&c[sub];if(h&&h.at&&Date.now()-h.at<ttl&&h.data)return h.data;return null}
  function cacheSet(key,sub,data,limit){var c=readJson(key,{});c[sub]={at:Date.now(),data:data};var keys=Object.keys(c).sort(function(a,b){return (c[b].at||0)-(c[a].at||0)}).slice(0,limit||20),next={};keys.forEach(function(k){next[k]=c[k]});writeJson(key,next)}
  function routeCacheKey(a,b){return a+'>'+b}
  function nearestCacheKey(pin,sites){return pin+'|'+sites.map(function(s){return s.id+':'+s.pin+':'+s.name+':'+(s.address||'')}).join('|')}

  var css=document.createElement('style');
  css.id='cc26-486-distance-style';
  css.textContent='\
.cc-distance-top-btn{height:38px;min-height:38px;padding:0 11px;border:1px solid rgba(91,99,240,.20);border-radius:12px;background:linear-gradient(135deg,#edf5ff 0%,#f1edff 48%,#e8fbf6 100%);color:#203963!important;-webkit-text-fill-color:#203963!important;font-size:10px;font-weight:1000;letter-spacing:-.15px;box-shadow:0 7px 18px rgba(69,91,184,.12);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;flex:0 0 auto}\
.cc-distance-top-btn:hover{transform:translateY(-1px);box-shadow:0 10px 22px rgba(69,91,184,.17)}.cc-distance-top-btn svg{width:15px;height:15px;flex:0 0 15px;color:#5b5ff0}\
.topbar-right .top-action-wrap>.add-profile-btn{width:78px!important;min-width:78px!important;max-width:78px!important;flex:0 0 78px!important}\
.professional-add-menu .cc-distance-menu-item,.add-menu .cc-distance-menu-item{display:block;width:100%;padding:12px 14px;border:0;border-radius:14px;margin:6px 0;background:linear-gradient(90deg,rgba(109,183,255,.10),rgba(72,214,177,.12));color:#183a63!important;-webkit-text-fill-color:#183a63!important;font:800 13px/1.2 inherit;text-align:left;cursor:pointer}\
.professional-add-menu .cc-distance-menu-item:hover,.add-menu .cc-distance-menu-item:hover{background:linear-gradient(90deg,rgba(109,183,255,.20),rgba(72,214,177,.22));transform:translateX(2px)}\
\
.cc502-quick-menu{position:fixed;z-index:220000;min-width:242px;max-width:292px;max-height:min(540px,calc(100vh - 20px));overflow:auto;padding:9px;border:1px solid rgba(86,116,173,.18);border-radius:20px;background:linear-gradient(155deg,rgba(255,255,255,.99),rgba(244,249,255,.99));box-shadow:0 24px 70px rgba(31,51,91,.24);backdrop-filter:blur(16px) saturate(1.18);transform-origin:top right;animation:cc502QuickIn .16s ease-out}.cc502-quick-head{padding:7px 9px 9px;color:#17365f;font-size:11px;font-weight:1000;letter-spacing:.08em;text-transform:uppercase}.cc502-quick-item{display:block;width:100%;min-height:41px;margin:4px 0;padding:0 12px;border:1px solid rgba(100,126,178,.10);border-radius:13px;background:linear-gradient(135deg,#f5f9ff,#f8f6ff);color:#17365f!important;-webkit-text-fill-color:#17365f!important;font:900 12.5px/1.2 Inter,system-ui,sans-serif;text-align:left;cursor:pointer;box-shadow:0 5px 13px rgba(56,78,118,.055);transition:transform .12s ease,box-shadow .12s ease,filter .12s ease}.cc502-quick-item:hover{transform:translateX(2px);box-shadow:0 8px 18px rgba(56,78,118,.10);filter:saturate(1.08)}.cc502-quick-item.cc502-distance-green{background:linear-gradient(135deg,#0d9b5d 0%,#20c66b 52%,#86d93c 100%)!important;border-color:#26b86b!important;color:#fff!important;-webkit-text-fill-color:#fff!important;box-shadow:0 10px 22px rgba(25,165,90,.24),inset 0 1px 0 rgba(255,255,255,.25)!important}.cc502-quick-item.cc502-distance-green:hover{background:linear-gradient(135deg,#078a51 0%,#18b960 50%,#75cf31 100%)!important;box-shadow:0 13px 27px rgba(25,165,90,.31),inset 0 1px 0 rgba(255,255,255,.3)!important}@keyframes cc502QuickIn{from{opacity:0;transform:translateY(-5px) scale(.98)}to{opacity:1;transform:none}}\
.cc-dist-backdrop{position:fixed;inset:0;background:rgba(20,34,63,.30);backdrop-filter:blur(7px);z-index:120000;display:grid;place-items:center;padding:18px}.cc-dist-modal{width:min(780px,96vw);max-height:92vh;overflow:auto;border:1px solid rgba(102,121,190,.17);border-radius:25px;background:linear-gradient(145deg,#fbfdff 0%,#f8f6ff 47%,#f5fffb 100%);box-shadow:0 28px 90px rgba(35,52,95,.27);padding:22px;color:#152b4e}.cc-dist-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.cc-dist-kicker{font-size:12px;font-weight:1000;letter-spacing:.9px;color:#6a66e8;text-transform:uppercase}.cc-dist-title{font-size:28px;font-weight:1000;letter-spacing:-.8px;margin-top:3px;color:#102a4f}.cc-dist-sub{font-size:14px;font-weight:760;color:#61708c;margin-top:4px;max-width:560px}.cc-dist-close{border:0;width:38px;height:38px;border-radius:12px;background:#edf2ff;color:#29456e;font-size:20px;font-weight:900;cursor:pointer}\
.cc-dist-tabs{display:flex;gap:7px;margin-top:16px;padding:4px;border-radius:14px;background:#edf2fb}.cc-dist-tab{flex:1;height:42px;border:0;border-radius:10px;background:transparent;color:#62728a;font-size:13px;font-weight:1000;cursor:pointer}.cc-dist-tab.active{background:linear-gradient(135deg,#e2edff,#ece8ff,#e2f8f2);color:#213d67;box-shadow:0 5px 13px rgba(71,92,148,.12)}.cc-dist-panel{display:none}.cc-dist-panel.active{display:block}\
.cc-dist-nearbox{margin-top:14px;padding:16px;border:1px solid rgba(84,106,164,.12);border-radius:18px;background:linear-gradient(135deg,#edf6ff,#f4f0ff 55%,#edfbf6)}.cc-dist-field label{display:block;font-size:12px;font-weight:1000;color:#556681;margin:0 0 6px 3px;text-transform:uppercase;letter-spacing:.55px}.cc-dist-field input{width:100%;box-sizing:border-box;height:47px;border:1px solid rgba(76,100,157,.20);border-radius:14px;background:#fff;color:#17365f!important;-webkit-text-fill-color:#17365f!important;padding:0 15px;font-size:20px;font-weight:1000;outline:none}.cc-dist-field input:focus{border-color:#787cf5;box-shadow:0 0 0 4px rgba(120,124,245,.10)}.cc-dist-near-row{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:end}.cc-dist-find{height:49px;border:0;border-radius:14px;padding:0 18px;background:linear-gradient(135deg,#5367ed,#826be9 56%,#36bfa7);color:#fff!important;-webkit-text-fill-color:#fff!important;font-size:14px;font-weight:1000;cursor:pointer;box-shadow:0 10px 22px rgba(83,103,237,.20)}.cc-dist-find[disabled]{opacity:.55;cursor:wait}.cc-dist-note{font-size:12px;font-weight:760;color:#72809a;margin-top:8px}.cc-dist-presets{display:flex;gap:7px;flex-wrap:wrap;margin-top:13px}.cc-dist-chip{border:1px solid rgba(92,105,188,.14);border-radius:999px;padding:7px 10px;background:linear-gradient(135deg,#eef5ff,#f3efff);color:#294163;font-size:12px;font-weight:950}.cc-dist-chip.custom{background:linear-gradient(135deg,#e9fbf5,#ecf7ff)}\
.cc-dist-top2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}.cc-dist-rank-card{border:1px solid rgba(80,105,165,.13);border-radius:18px;padding:14px;box-shadow:0 10px 24px rgba(62,83,137,.08);position:relative;overflow:hidden}.cc-dist-rank-card.one{background:linear-gradient(135deg,#d9ffe8 0%,#eafff2 50%,#d8f8e8 100%);border-color:rgba(30,180,105,.28);box-shadow:0 12px 28px rgba(32,176,107,.14)}.cc-dist-rank-card.two{background:linear-gradient(135deg,#eef3ff,#f5efff 52%,#fff2f7)}.cc-dist-rank-card.one .cc-dist-rank{background:linear-gradient(135deg,#1fbf75,#45d797);color:#fff}.cc-dist-rank-card.one .cc-dist-site-name,.cc-dist-rank-card.one .cc-dist-metric b{color:#11623f}.cc-dist-rank-card.one .cc-dist-track-one{background:linear-gradient(135deg,#e9fff3,#dff8eb);color:#17734d;border-color:rgba(31,189,118,.24)}.cc-dist-rank{display:inline-flex;align-items:center;height:26px;padding:0 10px;border-radius:999px;background:#ffffffba;color:#35556b;font-size:11px;font-weight:1000;text-transform:uppercase}.cc-dist-site-name{font-size:20px;font-weight:1000;color:#16365e;margin-top:8px}.cc-dist-site-pin{font-size:12px;font-weight:850;color:#687894;margin-top:2px}.cc-dist-site-metrics{display:flex;gap:12px;flex-wrap:wrap;margin-top:10px}.cc-dist-metric b{display:block;font-size:18px;color:#193c67}.cc-dist-metric span{font-size:11px;font-weight:850;color:#77849a}.cc-dist-track-one{margin-top:10px;height:30px;padding:0 10px;border:1px solid rgba(74,93,169,.14);border-radius:10px;background:#ffffffbd;color:#4254bc;font-size:12px;font-weight:1000;cursor:pointer}\
.cc-dist-list{margin-top:12px;border-radius:16px;overflow:hidden;border:1px solid rgba(81,104,160,.12);background:#fff}.cc-dist-list-head,.cc-dist-list-row{display:grid;grid-template-columns:42px minmax(150px,1.6fr) .8fr 1fr;gap:8px;align-items:center;padding:9px 11px}.cc-dist-list-head{background:#f0f4fb;color:#62728a;font-size:10.5px;font-weight:1000;text-transform:uppercase}.cc-dist-list-row{border-top:1px solid #edf0f6;color:#29415f;font-size:12.5px;font-weight:850}.cc-dist-list-row:nth-child(odd){background:#fbfdff}.cc-dist-list-row .rank{width:26px;height:26px;border-radius:9px;background:#edf2ff;display:grid;place-items:center;color:#5966c9;font-weight:1000}.cc-dist-list-row strong{display:block;color:#1b385f;font-size:13.5px}.cc-dist-list-row small{display:block;color:#6f7d92;font-size:11px;margin-top:1px}.cc-dist-list-empty{padding:16px;color:#6e7d93;font-size:13px;font-weight:850}\
.cc-dist-actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:13px}.cc-dist-add{height:39px;border:1px solid rgba(69,105,167,.17);border-radius:12px;padding:0 13px;background:#eef6ff;color:#264568;font-size:12.5px;font-weight:1000;cursor:pointer}.cc-dist-addbox{display:none;margin-top:10px;padding:11px;border-radius:15px;background:linear-gradient(135deg,#f1f8ff,#f7f3ff);border:1px solid rgba(83,101,163,.11)}.cc-dist-addbox.show{display:grid;grid-template-columns:1.5fr 1fr auto;gap:8px}.cc-dist-addbox input{height:39px;border:1px solid rgba(76,100,157,.19);border-radius:11px;background:#fff;color:#17365f;padding:0 11px;font-weight:850;outline:none}.cc-dist-save{border:0;border-radius:11px;padding:0 13px;background:#2ebf8f;color:#fff;font-weight:1000;cursor:pointer}\
.cc-dist-status{display:none;margin-top:12px;border-radius:14px;padding:12px;font-size:12.5px;font-weight:850}.cc-dist-status.show{display:block}.cc-dist-status.error{background:#fff0f0;color:#9b2c36;border:1px solid #ffd1d6}.cc-dist-status.loading{background:#eef5ff;color:#315583;border:1px solid #d6e5ff}\
.cc-dist-grid{display:grid;grid-template-columns:1fr 46px 1fr;gap:10px;align-items:end;margin-top:14px}.cc-dist-swap{height:42px;width:42px;border:0;border-radius:14px;background:linear-gradient(135deg,#6269ee,#8e72f2);color:#fff;font-size:20px;font-weight:1000;cursor:pointer}.cc-dist-check{height:43px;border:0;border-radius:13px;padding:0 18px;background:linear-gradient(135deg,#5367ed,#8a64e8 58%,#3fc9b1);color:#fff!important;-webkit-text-fill-color:#fff!important;font-size:12px;font-weight:1000;cursor:pointer}.cc-dist-check[disabled]{opacity:.55;cursor:wait}.cc-dist-result{display:none;margin-top:14px}.cc-dist-result.show{display:block}.cc-dist-route-label{font-size:13px;font-weight:900;color:#5b6c86;margin-bottom:9px}.cc-dist-cards{display:grid;grid-template-columns:1fr 1fr;gap:10px}.cc-dist-card{border-radius:18px;padding:14px;border:1px solid rgba(78,101,156,.12)}.cc-dist-card.distance{background:linear-gradient(135deg,#eaf4ff,#e9fbff)}.cc-dist-card.time{background:linear-gradient(135deg,#f2edff,#fff0f6)}.cc-dist-card .lbl{font-size:10px;font-weight:1000;color:#5d6e89;text-transform:uppercase}.cc-dist-card .big{font-size:22px;font-weight:1000;color:#16365e;margin-top:4px}.cc-dist-card .range{font-size:11px;font-weight:850;color:#60718c;margin-top:3px}.cc-dist-foot{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-top:10px;padding:10px 12px;border-radius:13px;background:#ffffffa8;color:#6a778d;font-size:10.5px;font-weight:800}.cc-dist-map{color:#4d5edb;font-weight:1000;text-decoration:none}\
@media(max-width:900px){.cc-distance-top-btn{width:40px;min-width:40px;padding:0}.cc-distance-top-btn span{display:none}.cc-dist-near-row,.cc-dist-grid{grid-template-columns:1fr}.cc-dist-swap{justify-self:center;transform:rotate(90deg)}.cc-dist-top2,.cc-dist-cards{grid-template-columns:1fr}.cc-dist-addbox.show{grid-template-columns:1fr}.cc-dist-list-head,.cc-dist-list-row{grid-template-columns:34px 1.4fr .8fr 1fr}.cc-dist-modal{padding:15px}}';
  document.head.appendChild(css);

  function modalHtml(){
    return '<div class="cc-dist-backdrop" id="cc-distance-backdrop"><div class="cc-dist-modal" role="dialog" aria-modal="true" aria-label="Distance Tracker">'+
      '<div class="cc-dist-head"><div><div class="cc-dist-kicker">On-call location check</div><div class="cc-dist-title">Distance Tracker</div><div class="cc-dist-sub">Enter only the candidate PIN. CRM compares every saved site and shows the nearest two first.</div></div><button class="cc-dist-close" type="button" aria-label="Close">×</button></div>'+
      '<div class="cc-dist-tabs"><button class="cc-dist-tab active" data-tab="nearest" type="button">Nearest Site</button><button class="cc-dist-tab" data-tab="route" type="button">Specific Route</button></div>'+
      '<div class="cc-dist-panel active" data-panel="nearest">'+
        '<div class="cc-dist-nearbox"><div class="cc-dist-near-row"><div class="cc-dist-field"><label>Candidate PIN</label><input id="cc-dist-candidate" inputmode="numeric" maxlength="6" placeholder="Ask candidate 6 digit PIN" autofocus></div><button class="cc-dist-find" type="button">Find Nearest Sites</button></div><div class="cc-dist-note">One click compares all saved sites • no background polling</div></div>'+
        '<div class="cc-dist-presets" id="cc-dist-presets"></div>'+
        '<div class="cc-dist-actions"><button class="cc-dist-add" type="button">+ Add Default Site</button><span class="cc-dist-note" id="cc-dist-site-count"></span></div>'+
        '<div class="cc-dist-addbox"><input id="cc-dist-site-name" placeholder="Site name"><input id="cc-dist-site-pin" inputmode="numeric" maxlength="6" placeholder="PIN code"><button class="cc-dist-save" type="button">Save</button></div>'+
        '<div class="cc-dist-status" id="cc-dist-near-status"></div><div id="cc-dist-near-result"></div>'+
      '</div>'+
      '<div class="cc-dist-panel" data-panel="route">'+
        '<div class="cc-dist-grid"><div class="cc-dist-field"><label>Site PIN</label><input id="cc-dist-from" inputmode="numeric" maxlength="6" value="122015" placeholder="6 digit PIN"></div><button class="cc-dist-swap" type="button" title="Swap PIN codes">⇄</button><div class="cc-dist-field"><label>Candidate PIN</label><input id="cc-dist-to" inputmode="numeric" maxlength="6" placeholder="Candidate PIN"></div></div>'+
        '<div class="cc-dist-actions"><button class="cc-dist-check" type="button">Check Specific Route</button><span class="cc-dist-note">Detailed min/max route estimate</span></div><div class="cc-dist-status" id="cc-dist-route-status"></div><div class="cc-dist-result" id="cc-dist-result"></div>'+
      '</div>'+
    '</div></div>';
  }

  function renderPresets(root){
    var sites=allSites(),box=root.querySelector('#cc-dist-presets'),count=root.querySelector('#cc-dist-site-count');
    if(box)box.innerHTML=sites.map(function(s){return '<span class="cc-dist-chip '+(s.builtin?'':'custom')+'">'+esc(s.name)+' · '+esc(s.pin)+'</span>'}).join('');
    if(count)count.textContent=sites.length+' saved site'+(sites.length===1?'':'s')+' compared';
  }
  function statusEl(root,kind){return root.querySelector(kind==='near'?'#cc-dist-near-status':'#cc-dist-route-status')}
  function showStatus(root,text,type,kind){var el=statusEl(root,kind||'near');if(!el)return;el.className='cc-dist-status show '+(type||'');el.textContent=text||''}
  function clearStatus(root,kind){var el=statusEl(root,kind||'near');if(el){el.className='cc-dist-status';el.textContent=''}}
  function switchTab(root,name){root.querySelectorAll('.cc-dist-tab').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-tab')===name)});root.querySelectorAll('.cc-dist-panel').forEach(function(p){p.classList.toggle('active',p.getAttribute('data-panel')===name)})}

  function renderRouteResult(root,d){
    var r=root.querySelector('#cc-dist-result');
    var dmin=Number(d.min_distance_km||d.distance_km||0),dmax=Number(d.max_distance_km||d.distance_km||0),tmin=Number(d.min_minutes||0),tmax=Number(d.max_minutes||tmin||0);
    var route=(d.from_label||d.from_pin)+' → '+(d.to_label||d.to_pin);
    var map='https://www.google.com/maps/dir/?api=1&origin='+encodeURIComponent(d.from_pin+', India')+'&destination='+encodeURIComponent(d.to_pin+', India')+'&travelmode=driving';
    r.innerHTML='<div class="cc-dist-route-label">'+esc(route)+'</div><div class="cc-dist-cards"><div class="cc-dist-card distance"><div class="lbl">Road Distance</div><div class="big">'+fmtKm(d.distance_km||dmin)+'</div><div class="range">Min '+fmtKm(dmin)+' · Max '+fmtKm(dmax)+'</div></div><div class="cc-dist-card time"><div class="lbl">Travel Time</div><div class="big">'+fmtMin(tmin)+' – '+fmtMin(tmax)+'</div><div class="range">Fastest to practical upper estimate</div></div></div><div class="cc-dist-foot"><span>Route estimate; live traffic can change actual time.</span><a class="cc-dist-map" target="_blank" rel="noopener" href="'+esc(map)+'">Open Route ↗</a></div>';
    r.className='cc-dist-result show';
  }

  function topCard(item,rank){
    return '<div class="cc-dist-rank-card '+(rank===1?'one':'two')+'"><span class="cc-dist-rank">'+(rank===1?'#1 Nearest':'#2 Second Nearest')+'</span><div class="cc-dist-site-name">'+esc(item.name)+'</div><div class="cc-dist-site-pin">PIN '+esc(item.pin)+(item.label?' · '+esc(item.label):'')+'</div><div class="cc-dist-site-metrics"><div class="cc-dist-metric"><b>'+fmtKm(item.distance_km)+'</b><span>Road distance</span></div><div class="cc-dist-metric"><b>'+fmtMin(item.min_minutes)+' – '+fmtMin(item.max_minutes)+'</b><span>Estimated drive time</span></div></div><button class="cc-dist-track-one" type="button" data-track-pin="'+esc(item.pin)+'">Open detailed route</button></div>';
  }
  function renderNearest(root,d){
    var box=root.querySelector('#cc-dist-near-result'),rows=Array.isArray(d.sites)?d.sites:[];
    if(!rows.length){box.innerHTML='<div class="cc-dist-list"><div class="cc-dist-list-empty">No route result found.</div></div>';return}
    var topRows=rows.slice(0,2),remaining=rows.slice(2);
    var top=topRows.map(function(x,i){return topCard(x,i+1)}).join('');
    var list='';
    if(remaining.length){list='<div class="cc-dist-list"><div class="cc-dist-list-head"><span>Rank</span><span>Site</span><span>Distance</span><span>Travel time</span></div>'+remaining.map(function(x,i){return '<div class="cc-dist-list-row"><span class="rank">'+(i+3)+'</span><span><strong>'+esc(x.name)+'</strong><small>PIN '+esc(x.pin)+'</small></span><span>'+fmtKm(x.distance_km)+'</span><span>'+fmtMin(x.min_minutes)+' – '+fmtMin(x.max_minutes)+'</span></div>'}).join('')+'</div>';}
    box.innerHTML='<div class="cc-dist-route-label" style="margin-top:14px">Candidate: '+esc(d.candidate_label||('PIN '+d.candidate_pin))+'</div><div class="cc-dist-top2">'+top+'</div>'+list+'<div class="cc-dist-foot"><span>Sorted by road distance. ETA is traffic-free route time with a practical upper buffer.</span></div>';
    box.querySelectorAll('[data-track-pin]').forEach(function(btn){btn.addEventListener('click',function(){var p=btn.getAttribute('data-track-pin');root.querySelector('#cc-dist-from').value=p;root.querySelector('#cc-dist-to').value=d.candidate_pin||'';switchTab(root,'route');setTimeout(function(){checkRoute(root)},20)})});
  }

  async function findNearest(root){
    var pin=digits(root.querySelector('#cc-dist-candidate').value),sites=allSites(),btn=root.querySelector('.cc-dist-find');root.querySelector('#cc-dist-candidate').value=pin;
    if(!validPin(pin)){showStatus(root,'Enter a valid 6 digit candidate PIN.','error','near');return}
    if(!sites.length){showStatus(root,'Add at least one default site first.','error','near');return}
    var key=nearestCacheKey(pin,sites),cached=cacheGet(NEAREST_CACHE_KEY,key,21600000);if(cached){clearStatus(root,'near');renderNearest(root,cached);return}
    btn.disabled=true;btn.textContent='Comparing...';showStatus(root,'Comparing '+sites.length+' saved sites in one route check...','loading','near');root.querySelector('#cc-dist-near-result').innerHTML='';
    try{
      var ac=new AbortController(),timer=setTimeout(function(){ac.abort()},15000);
      var q=encodeURIComponent(JSON.stringify(sites.map(function(s){return{id:s.id,name:s.name,pin:s.pin,address:s.address||''}})));
      var res=await fetch('/api/distance/nearest?candidate='+encodeURIComponent(pin)+'&sites='+q,{credentials:'include',cache:'no-store',signal:ac.signal});
      clearTimeout(timer);var d=await res.json().catch(function(){return{}});
      if(!res.ok||!d||d.ok===false)throw new Error(d.message||d.error||'Nearest site could not be calculated.');
      cacheSet(NEAREST_CACHE_KEY,key,d,12);clearStatus(root,'near');renderNearest(root,d);
    }catch(e){showStatus(root,(e&&e.name==='AbortError')?'Nearest-site check timed out. Try once again.':(e.message||'Nearest-site check failed.'),'error','near')}
    finally{btn.disabled=false;btn.textContent='Find Nearest Sites'}
  }

  async function checkRoute(root){
    var a=digits(root.querySelector('#cc-dist-from').value),b=digits(root.querySelector('#cc-dist-to').value),btn=root.querySelector('.cc-dist-check');root.querySelector('#cc-dist-from').value=a;root.querySelector('#cc-dist-to').value=b;
    if(!validPin(a)||!validPin(b)){showStatus(root,'Enter valid 6 digit Indian PIN codes.','error','route');return}
    var key=routeCacheKey(a,b),cached=cacheGet(ROUTE_CACHE_KEY,key,21600000);if(cached){clearStatus(root,'route');renderRouteResult(root,cached);return}
    btn.disabled=true;btn.textContent='Checking...';showStatus(root,'Finding detailed road route...','loading','route');root.querySelector('#cc-dist-result').className='cc-dist-result';
    try{
      var ac=new AbortController(),timer=setTimeout(function(){ac.abort()},12000);
      var res=await fetch('/api/distance/route?from='+encodeURIComponent(a)+'&to='+encodeURIComponent(b),{credentials:'include',cache:'no-store',signal:ac.signal});clearTimeout(timer);var d=await res.json().catch(function(){return{}});
      if(!res.ok||!d||d.ok===false)throw new Error(d.message||d.error||'Route could not be calculated.');cacheSet(ROUTE_CACHE_KEY,key,d,20);clearStatus(root,'route');renderRouteResult(root,d);
    }catch(e){showStatus(root,(e&&e.name==='AbortError')?'Distance check timed out. Try once again.':(e.message||'Distance check failed.'),'error','route')}
    finally{btn.disabled=false;btn.textContent='Check Specific Route'}
  }

  function openModal(){
    var old=document.getElementById('cc-distance-backdrop');if(old)old.remove();var wrap=document.createElement('div');wrap.innerHTML=modalHtml();var root=wrap.firstChild;document.body.appendChild(root);renderPresets(root);
    function pinInput(e){e.target.value=digits(e.target.value)}
    ['#cc-dist-candidate','#cc-dist-from','#cc-dist-to','#cc-dist-site-pin'].forEach(function(sel){var el=root.querySelector(sel);if(el)el.addEventListener('input',pinInput)});
    root.querySelector('.cc-dist-close').addEventListener('click',function(){root.remove()});root.addEventListener('click',function(e){if(e.target===root){e.preventDefault();e.stopPropagation();}});
    root.querySelectorAll('.cc-dist-tab').forEach(function(b){b.addEventListener('click',function(){switchTab(root,b.getAttribute('data-tab'))})});
    root.querySelector('.cc-dist-find').addEventListener('click',function(){findNearest(root)});root.querySelector('#cc-dist-candidate').addEventListener('keydown',function(e){if(e.key==='Enter')findNearest(root)});
    var from=root.querySelector('#cc-dist-from'),to=root.querySelector('#cc-dist-to');root.querySelector('.cc-dist-swap').addEventListener('click',function(){var x=from.value;from.value=to.value;to.value=x});root.querySelector('.cc-dist-check').addEventListener('click',function(){checkRoute(root)});to.addEventListener('keydown',function(e){if(e.key==='Enter')checkRoute(root)});from.addEventListener('keydown',function(e){if(e.key==='Enter')to.focus()});
    root.querySelector('.cc-dist-add').addEventListener('click',function(){root.querySelector('.cc-dist-addbox').classList.toggle('show')});
    root.querySelector('.cc-dist-save').addEventListener('click',function(){var n=String(root.querySelector('#cc-dist-site-name').value||'').trim().slice(0,36),p=digits(root.querySelector('#cc-dist-site-pin').value);if(!n||!validPin(p)){showStatus(root,'Add a site name and valid 6 digit PIN.','error','near');return}var rows=customs().filter(function(x){return x.pin!==p&&String(x.name||'').toLowerCase()!==n.toLowerCase()});rows.unshift({id:'custom-'+Date.now(),name:n,pin:p});writeJson(STORE_KEY,rows.slice(0,12));renderPresets(root);root.querySelector('#cc-dist-site-name').value='';root.querySelector('#cc-dist-site-pin').value='';root.querySelector('.cc-dist-addbox').classList.remove('show');clearStatus(root,'near')});
    setTimeout(function(){try{root.querySelector('#cc-dist-candidate').focus()}catch(e){}},40);
  }

  function removeLegacyTopButton(){document.querySelectorAll('.cc-distance-top-btn').forEach(function(el){el.remove()})}

  /* CC26_502: Quick Action uses a body-level fixed menu so topbar/React repaint cannot hide the options. */
  var QUICK_MENU_ID='cc502-quick-action-menu';
  var quickTrigger=null;
  function userRole(){
    var el=document.querySelector('.topbar .user-role,.user-chip .user-role');
    return String(el&&el.textContent||'').trim().toLowerCase();
  }
  function quickNavigate(path){
    closeQuickMenu();
    var state={};
    if(String(path).split('?')[0]==='/candidate/new'){
      var fresh=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
      path='/candidate/new?fresh='+encodeURIComponent(fresh);state.key=fresh;
    }
    try{history.pushState(state,'',path);window.dispatchEvent(new PopStateEvent('popstate'));}
    catch(_e){location.assign(path)}
  }
  function closeQuickMenu(){
    var menu=document.getElementById(QUICK_MENU_ID);if(menu)menu.remove();
    if(quickTrigger){quickTrigger.setAttribute('aria-expanded','false')}
  }
  function quickItems(){
    var role=userRole(),manager=/admin|manager/.test(role),tl=role==='tl'||role.indexOf('team lead')>=0||role.indexOf('teamlead')>=0;
    var items=[
      {label:'Add Candidate',path:'/candidate/new'},
      {label:'Distance Tracker',distance:true,green:true},
      {label:'Add Task',path:'/tasks?create=1'},
      {label:'Add Note',path:'/candidates?add-note=1'}
    ];
    if(manager)items.push({label:'Add JD',path:'/jds?create=1'});
    items.push({label:'Add Interview',path:'/interviews?create=1'});
    items.push({label:'Open Submissions',path:'/submissions'});
    if(manager||tl||role.indexOf('recruiter')>=0)items.push({label:'Attendance & Break Time',path:'/attendance'});
    if(manager)items.push({label:'Open BDA',path:'/bda'});
    if(manager||tl)items.push({label:'YT Hub',path:'/learning-hub'});
    return items;
  }
  function positionQuickMenu(menu,trigger){
    if(!menu||!trigger)return;
    var r=trigger.getBoundingClientRect(),w=Math.min(292,Math.max(242,menu.offsetWidth||268));
    var left=Math.max(8,Math.min((window.innerWidth||document.documentElement.clientWidth)-w-8,r.right-w));
    var top=Math.min((window.innerHeight||document.documentElement.clientHeight)-12,r.bottom+8);
    menu.style.left=Math.round(left)+'px';menu.style.top=Math.round(top)+'px';menu.style.width=Math.round(w)+'px';
    requestAnimationFrame(function(){
      if(!menu.isConnected)return;
      var mr=menu.getBoundingClientRect(),vh=window.innerHeight||document.documentElement.clientHeight;
      if(mr.bottom>vh-8){var above=r.top-mr.height-8;menu.style.top=Math.max(8,Math.round(above))+'px'}
    });
  }
  function openQuickMenu(trigger){
    var existing=document.getElementById(QUICK_MENU_ID);
    if(existing){closeQuickMenu();return}
    quickTrigger=trigger;trigger.setAttribute('aria-expanded','true');
    var menu=document.createElement('div');menu.id=QUICK_MENU_ID;menu.className='cc502-quick-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Quick Action');
    var head=document.createElement('div');head.className='cc502-quick-head';head.textContent='Quick Action';menu.appendChild(head);
    quickItems().forEach(function(item){
      var btn=document.createElement('button');btn.type='button';btn.className='cc502-quick-item'+(item.green?' cc502-distance-green':'');btn.setAttribute('role','menuitem');btn.textContent=item.label;
      btn.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();if(item.distance){closeQuickMenu();openModal()}else quickNavigate(item.path)});
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);positionQuickMenu(menu,trigger);
  }
  function bindQuickTrigger(trigger){
    if(!trigger||trigger.getAttribute('data-cc502-bound')==='1')return;
    trigger.setAttribute('data-cc502-bound','1');trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-expanded','false');
    trigger.addEventListener('click',function(ev){
      ev.preventDefault();ev.stopPropagation();
      openQuickMenu(trigger);
    },true);
  }
  function ensureQuickAction(){
    removeLegacyTopButton();
    var wrap=document.querySelector('.top-action-wrap');
    if(!wrap)return false;
    var trigger=wrap.querySelector('button.add-profile-btn');
    if(trigger){
      if(String(trigger.textContent||'').trim()!=='Quick Action')trigger.textContent='Quick Action';
      trigger.setAttribute('aria-label','Quick Action');trigger.title='Quick Action';bindQuickTrigger(trigger);
    }
    return !!trigger;
  }
  document.addEventListener('pointerdown',function(ev){var menu=document.getElementById(QUICK_MENU_ID);if(!menu)return;if(menu.contains(ev.target)||(quickTrigger&&quickTrigger.contains(ev.target)))return;closeQuickMenu()},true);
  document.addEventListener('keydown',function(ev){if(ev.key==='Escape')closeQuickMenu()},true);
  window.addEventListener('resize',function(){var m=document.getElementById(QUICK_MENU_ID);if(m&&quickTrigger)positionQuickMenu(m,quickTrigger)},{passive:true});
  window.addEventListener('scroll',function(){var m=document.getElementById(QUICK_MENU_ID);if(m&&quickTrigger)positionQuickMenu(m,quickTrigger)},{passive:true,capture:true});
  window.__CC_OPEN_DISTANCE_TRACKER=openModal;
  window.addEventListener('career-crox-open-distance-tracker',openModal);
  if(window.__CC_DISTANCE_PENDING){window.__CC_DISTANCE_PENDING=false;setTimeout(openModal,0)}
  var tries=0,quickRaf=0;
  function scheduleQuick(){if(quickRaf)return;quickRaf=requestAnimationFrame(function(){quickRaf=0;ensureQuickAction()})}
  function boot(){if(ensureQuickAction())return;if(++tries<20)setTimeout(boot,Math.min(400,80+tries*15))}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.addEventListener('career-crox-react-ready',function(){tries=0;boot()});
  window.addEventListener('popstate',function(){closeQuickMenu();tries=0;setTimeout(boot,30)});
  window.addEventListener('cc-route-change',function(){closeQuickMenu();tries=0;setTimeout(boot,30)});
  try{new MutationObserver(function(records){
    var useful=records.some(function(r){return Array.prototype.some.call(r.addedNodes||[],function(node){return node&&node.nodeType===1&&((node.matches&&node.matches('.top-action-wrap,.add-profile-btn'))||(node.querySelector&&node.querySelector('.top-action-wrap,.add-profile-btn')))})});
    if(useful)scheduleQuick();
  }).observe(document.documentElement,{childList:true,subtree:true})}catch(_e){}
})();
