(function(){
  'use strict';
  if(window.__CC593_FILES_REMOVED__) return; window.__CC593_FILES_REMOVED__=true;
  function removeByText(root, texts){
    const nodes=[...root.querySelectorAll('button,a,label,div,section')];
    for(const el of nodes){
      const t=String(el.textContent||'').trim().replace(/\s+/g,' ');
      if(texts.some(rx=>rx.test(t))){
        if(el.matches('button,a,label')) el.remove();
      }
    }
  }
  function clean(){
    document.querySelectorAll('.candidate-files-panel').forEach(el=>el.remove());
    // Remove Quick Jump "Files" only on candidate profile.
    if(/^\/candidate\//.test(location.pathname||'')){
      document.querySelectorAll('button,a').forEach(el=>{ if(/^Files$/i.test(String(el.textContent||'').trim())) el.remove(); });
    }
    // Revenue candidate asset upload UI: remove cards/rows that expose Resume or Call Recording uploads.
    if(/revenue/i.test(location.pathname||'')){
      document.querySelectorAll('input[type="file"]').forEach(input=>{
        const accept=String(input.getAttribute('accept')||'').toLowerCase();
        if(/mp3|wav|m4a|aac|ogg|amr|3gp|docx|pdf/.test(accept)){
          let box=input.closest('.file-upload-card,.candidate-file-row,.revenue-candidate-asset,.field,.panel,.card,section,div');
          if(box){ const tx=String(box.textContent||'').toLowerCase(); if(/resume|recording|candidate file|call recording/.test(tx)) box.remove(); }
        }
      });
    }
  }
  var cleanTimer=0;
  function routeRelevant(){var p=String(location.pathname||'');return /^\/candidate\//.test(p)||/revenue/i.test(p)}
  function scheduleClean(delay){if(!routeRelevant())return;if(cleanTimer)clearTimeout(cleanTimer);cleanTimer=setTimeout(function(){cleanTimer=0;clean()},Math.max(0,Number(delay||0)))}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){scheduleClean(0)},{once:true}); else scheduleClean(0);
  try{ new MutationObserver(function(records){
    if(!routeRelevant())return;
    var useful=records.some(function(r){return Array.prototype.some.call(r.addedNodes||[],function(node){return node&&node.nodeType===1&&((node.matches&&node.matches('.candidate-files-panel,button,a,input[type="file"]'))||(node.querySelector&&node.querySelector('.candidate-files-panel,button,a,input[type="file"]')))})});
    if(useful)scheduleClean(80);
  }).observe(document.documentElement,{childList:true,subtree:true}); }catch(_e){}
  window.addEventListener('popstate',function(){scheduleClean(40)});
  window.addEventListener('cc-route-change',function(){scheduleClean(40)});
})();