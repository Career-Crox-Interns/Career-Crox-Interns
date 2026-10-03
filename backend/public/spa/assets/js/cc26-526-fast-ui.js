(() => {
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
    const panel=title&&title.closest('.panel');if(!panel)return;
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
    cc652EnsureStyle();
    document.querySelectorAll('.candidate-notes-chat-panel').forEach((panel)=>{
      const list=panel.querySelector('.candidate-notes-preview-list');
      if(list){list.classList.add('cc652-four-presets','cc654-four-presets');[...list.querySelectorAll('.candidate-note-template-preview')].slice(0,4).forEach((b,i)=>{
        b.classList.add('cc652-preset-note','cc654-preset-card',`cc652-tone-${(i%4)+1}`,`cc654-tone-${(i%4)+1}`);b.style.removeProperty('display');
        const tones=[['#ffb24d','#f07a27'],['#4fd48a','#149f5d'],['#a583ff','#6f4edb'],['#49c9d2','#178fa7']][i%4];
        b.style.setProperty('background',`linear-gradient(135deg,${tones[0]},${tones[1]})`,'important');
        b.style.setProperty('background-image',`linear-gradient(135deg,${tones[0]},${tones[1]})`,'important');
        b.style.setProperty('color','#fff','important');b.style.setProperty('-webkit-text-fill-color','#fff','important');
        b.style.setProperty('border','1px solid rgba(255,255,255,.82)','important');b.style.setProperty('box-shadow','inset 0 1px 0 rgba(255,255,255,.35),0 9px 20px rgba(27,59,94,.16)','important');
        const tx=b.querySelector('.candidate-note-template-preview-text');if(tx){tx.style.setProperty('color','#fff','important');tx.style.setProperty('-webkit-text-fill-color','#fff','important');tx.style.setProperty('font-weight','900','important')}
        const ix=b.querySelector('.candidate-note-template-preview-index');if(ix){ix.style.setProperty('background','rgba(255,255,255,.94)','important');ix.style.setProperty('color','#173a5c','important');ix.style.setProperty('-webkit-text-fill-color','#173a5c','important')}
      })}
      const select=panel.querySelector('select.note-template-select');
      if(select){select.style.setProperty('display','none','important');const tools=select.closest('.candidate-notes-head-tools');if(tools&&!tools.querySelector('.cc652-add-preset')){const add=textEl('button','+ Add Preset','cc652-add-preset bounceable');add.type='button';add.addEventListener('click',()=>{select.value='__add_new__';select.dispatchEvent(new Event('change',{bubbles:true}))});tools.insertBefore(add,tools.firstChild)}}
    });
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
    if(!cc654IsNewCandidate())return;
    cc654ClearStoredNewScroll();
    const page=document.querySelector('.page-scroll');
    if(page){page.style.setProperty('overflow-anchor','none','important');page.scrollTop=0;try{page.scrollTo({top:0,left:0,behavior:'auto'})}catch(_){}}
    const roots=[document.scrollingElement,document.documentElement,document.body].filter(Boolean);roots.forEach(x=>{try{x.scrollTop=0}catch(_){}});
    try{window.scrollTo({top:0,left:0,behavior:'auto'})}catch(_){try{window.scrollTo(0,0)}catch(__){}}
  }
  function cc654ScheduleNewCandidateTop(){
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
    cc654ScheduleNewCandidateTop();
    cc652PolishCandidateNotesAndActions();
    document.querySelectorAll('.candidate-notes-input-col').forEach((box)=>{
      const ta=box.querySelector('.candidate-notes-main-textarea,textarea');
      const btn=box.querySelector('button.add-profile-btn,button');
      if(ta&&ta.disabled)ta.disabled=false;
      if(btn){const txt=(btn.textContent||'').trim();if(/adding|saving|processing/i.test(txt))btn.textContent=box.querySelector('.candidate-note-reply-banner')?'Reply Note':'Add Note';if(ta&&ta.value.trim())btn.disabled=false}
    });
    document.querySelectorAll('.candidate-action-btn.candidate-save-btn').forEach((b)=>{if(/saving|syncing|processing|updating/i.test(b.textContent||''))b.textContent='Save'});
    document.querySelectorAll('.candidate-sync-text,.profile-sync-text,.sync-status-text,.sync-message').forEach((el)=>{const t=(el.textContent||'').trim();if(/^(saving|syncing|updating|processing)(\.|…|\.\.\.)?$/i.test(t))el.textContent='Saved';if(/saved on screen.*sync/i.test(t))el.textContent='Saved';if(/adding note|saving note|processing note/i.test(t))el.textContent='Note added.'});
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
    const path=cc655Path();
    document.querySelectorAll('.cc644-add-bar').forEach((bar)=>{
      if(path==='/candidates') bar.style.setProperty('display','none','important');
      else bar.style.removeProperty('display');
    });
    if(path!=='/candidate/new')return;
    const row=document.querySelector('.candidate-detail-full-panel .panel-heading-row');
    const left=row&&row.firstElementChild;
    if(!row||!left)return;
    let title=left.querySelector('.panel-title');
    if(!title)return;
    let titleRow=left.querySelector('.cc655-title-row');
    if(!titleRow){
      titleRow=document.createElement('div');
      titleRow.className='cc655-title-row';
      title.parentNode.insertBefore(titleRow,title);
      titleRow.appendChild(title);
    }
    let btn=titleRow.querySelector('.cc655-header-add-profile');
    if(!btn){
      btn=document.createElement('button');
      btn.type='button';
      btn.className='cc644-add-profile cc655-header-add-profile bounceable';
      btn.textContent='＋ Add New Profile';
      btn.setAttribute('data-cc-new-candidate','1');
      btn.addEventListener('click',()=>{
        try{sessionStorage.setItem('career-crox:fresh-new-candidate-top',String(Date.now()))}catch(_){ }
        try{window.scrollTo({top:0,left:0,behavior:'auto'})}catch(_){try{window.scrollTo(0,0)}catch(__){}}
        const target='/candidate/new?fresh='+Date.now();
        try{location.assign(target)}catch(_){location.href=target}
      });
      titleRow.appendChild(btn);
    }
  }
  function cc655RelayoutCandidateNotes(){
    document.querySelectorAll('.candidate-notes-chat-panel').forEach((panel)=>{
      panel.classList.add('cc655-notes-panel');
      const previewCol=panel.querySelector('.candidate-notes-preview-col');
      const list=panel.querySelector('.candidate-notes-preview-list');
      if(!previewCol||!list)return;
      let toolbar=previewCol.querySelector('.cc655-preset-toolbar');
      if(!toolbar){
        toolbar=document.createElement('div');
        toolbar.className='cc655-preset-toolbar';
        previewCol.insertBefore(toolbar,previewCol.firstChild||null);
      }
      const headTools=panel.querySelector('.candidate-notes-head-tools');
      if(headTools)headTools.style.setProperty('display','none','important');
      headTools?.querySelectorAll('.cc652-add-preset').forEach((x)=>x.style.setProperty('display','none','important'));
      const select=panel.querySelector('select.note-template-select');
      if(select){
        select.style.setProperty('display','block','important');
        select.style.removeProperty('visibility');
        if(select.parentElement!==toolbar)toolbar.appendChild(select);
      }
      const historyBtn=[...panel.querySelectorAll('button')].find((btn)=>/Open Notes History/i.test(btn.textContent||''));
      if(historyBtn){
        historyBtn.classList.add('cc655-history-btn');
        if(historyBtn.parentElement!==toolbar)toolbar.appendChild(historyBtn);
      }
      list.classList.add('cc655-preset-list');
      [...list.querySelectorAll('.candidate-note-template-preview')].forEach((card,index)=>{
        if(index<4){
          card.style.removeProperty('display');
          card.classList.add('cc655-preset-card',`cc655-tone-${(index%4)+1}`);
        }else card.style.setProperty('display','none','important');
      });
    });
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
    document.querySelectorAll('.candidate-notes-chat-panel').forEach((panel)=>{
      const all=cc656GetAllTemplates(panel); if(!all.length)return;
      panel.classList.add('cc656-inline-panel');
      const pins=cc656LoadPins(all);
      // CC26_718: user removed the six pinned preset cards; keep dropdown/history only.
      const obsolete=panel.querySelector('.cc656-inline-presets');
      if(obsolete) obsolete.remove();
      cc656BuildToolbar(panel,all,pins);
    });
  }


  // CC26_657: enforce requested Status dropdown options and remove custom add-new button.
  const CC657_STATUS_OPTIONS=['Draft','In - Progress','All set for Interview','Not Intrested','Rejected once, needs new Interview','Rejected','Appeared in Interview'];
  function cc657SyncStatusField(){
    document.querySelectorAll('[data-field="status"] .cc651-status-shell').forEach((shell)=>{
      const select=shell.querySelector('select');
      if(!select)return;
      const current=String(select.value||'').trim();
      const allowed=CC657_STATUS_OPTIONS.slice();
      const values=allowed.includes(current)||!current?allowed:[current,...allowed.filter(x=>x!==current)];
      const previous=String(select.value||'').trim();
      select.innerHTML='';
      values.forEach((value)=>{const opt=document.createElement('option');opt.value=value;opt.textContent=value;select.appendChild(opt);});
      select.value=values.includes(previous)?previous:(values[0]||'Draft');
      const addBtn=shell.querySelector('.cc565-add-status'); if(addBtn) addBtn.remove();
    });
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
