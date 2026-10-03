(function(){
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
  function hideNativeGateNow(){var b=nativeJoinBackdrop();if(b)b.style.display='none';}
  function restoreNativeGate(){hideNativeGateNow();} // Only the single DOM gate owns the join action.
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
    restoreDailyOfficeAfterInactivity();clearStale();suppressOldJoin();
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
    var pth=path();if(pth!=='/quick-add/candidate'&&pth!=='/candidate/new')return;var isFull=pth==='/candidate/new';var host=isFull?document.querySelector('.candidate-detail-full-panel'):document.querySelector('form.qa-candidate-shell,form.stack-form');if(!host)return;
    var existing=document.getElementById('cc451-resume-card');if(existing&&isFull)existing.remove();
    var oldBtn=document.getElementById('cc451-header-resume-upload');if(oldBtn)return;
    var card=document.createElement('div');card.id='cc451-resume-card';card.className='cc451-resume-card'+(isFull?' cc451-resume-card-inline':'');card.innerHTML='<input id="cc451-resume-input" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.doc,.docx,.docm,.dotx,.dotm,.rtf,.txt,.csv,.eml,.html,.htm,.odt,.md" hidden><label for="cc451-resume-input" id="cc451-header-resume-upload" class="cc451-resume-btn">Upload Resume</label>';
    card.querySelector('input').addEventListener('change',function(e){var f=e.target.files&&e.target.files[0];if(f)handleResume(f,card);e.target.value='';});
    if(isFull){var titleRow=host.querySelector('.cc655-title-row')||host.querySelector(':scope > .panel-heading-row > div')||host.querySelector(':scope > .panel-heading-row');if(titleRow)titleRow.appendChild(card);else host.insertBefore(card,host.firstChild);}else{if(document.getElementById('cc451-resume-card'))return;var first=host.children[0];if(first&&first.nextSibling)host.insertBefore(card,first.nextSibling);else host.insertBefore(card,host.firstChild);var tools=document.createElement('div');tools.className='cc451-import-tools';tools.innerHTML='<b>Moving old candidate data?</b><a href="/templates/CAREER_CROX_CANDIDATE_IMPORT_TEMPLATE.xlsx" download>Excel Template</a><a href="/templates/CAREER_CROX_CANDIDATE_IMPORT_TEMPLATE.csv" download>CSV Template</a><a href="/admin?open=bulk">Open Bulk Import</a>';card.after(tools);}
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
  #root .crm-modal-backdrop.cc724-office-overlay:has(.join-office-modal){display:none!important}/* CC725: one gate, one button, one POST owner */\
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
  document.addEventListener('visibilitychange',function(){if(!document.hidden)schedule();});window.addEventListener('storage',schedule);window.addEventListener('career-crox-office-joined',schedule);window.addEventListener('popstate',schedule);
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
