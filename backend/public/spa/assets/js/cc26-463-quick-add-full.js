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
