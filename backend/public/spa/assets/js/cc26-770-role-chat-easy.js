/* CC26_770 — manager-only reminder center + TL team popup guard + organized Team Chat. No polling/network reads. */
(function(){
  'use strict';
  if(window.__CC770_ROLE_CHAT_EASY__)return; window.__CC770_ROLE_CHAT_EASY__=true;
  var timer=0, chatCollapsed=false;
  function cachedUser(){try{return JSON.parse(localStorage.getItem('careerCroxCachedUser')||'{}')||{}}catch(_){return{}}}
  function role(){var u=cachedUser(),r=String(u.role||u.designation||u.user_role||'').trim().toLowerCase();if(r.indexOf('admin')!==-1)return'admin';if(r.indexOf('manager')!==-1)return'manager';if(r==='tl'||r.indexOf('team lead')!==-1||r.indexOf('teamlead')!==-1)return'tl';if(r.indexOf('recruiter')!==-1)return'recruiter';return r}
  function managerOnlyCenter(){
    if(role()==='manager'||role()==='admin')return;
    var center=document.getElementById('cc763-manager-reminder-center'); if(center)center.remove();
  }
  function identity(){var u=cachedUser();return String(u.user_id||u.recruiter_code||u.username||u.email||'anon').trim().toLowerCase()||'anon'}
  function state(){try{var raw=JSON.parse(localStorage.getItem('cc758_chat_unread:'+identity())||'{}')||{};return raw&&raw.buckets&&typeof raw.buckets==='object'?raw:{buckets:{}}}catch(_){return{buckets:{}}}}
  function norm(v){return String(v||'').replace(/\s*\(You\)\s*/gi,'').trim().toLowerCase()}
  function latestByPerson(){
    var out={},buckets=state().buckets||{};Object.keys(buckets).forEach(function(k){var b=buckets[k]||{};if(String(b.thread||'').indexOf('dm:')!==0)return;var name=norm(b.sender_name||b.sender_username);if(!name)return;var old=out[name];if(!old||Number(b.at||0)>Number(old.at||0))out[name]=b});return out;
  }
  function timeText(ms){var n=Number(ms||0);if(!n)return'';try{return new Date(n).toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit',hour12:true})}catch(_){return''}}
  function organizeChat(){
    if(!/^\/chat(?:\/|$)/.test(location.pathname||'')){document.body.classList.remove('cc770-chat-easy');chatCollapsed=false;return}
    document.body.classList.add('cc770-chat-easy');
    var shell=document.querySelector('.teamsShell');
    if(shell&&!shell.dataset.cc770Ready){shell.dataset.cc770Ready='1';setTimeout(function(){var close=document.querySelector('.rightPanel .infoClose');if(close&&!shell.classList.contains('infoClosed')){try{close.click()}catch(_){}}},0)}
    document.querySelectorAll('.teamsSectionTitle').forEach(function(h){var s=h.querySelector('span');if(s&&String(s.textContent||'').trim()==='People')s.textContent='Recent Chats'});
    var latest=latestByPerson();
    document.querySelectorAll('.teamsLeft .personBtn').forEach(function(btn){
      var title=btn.querySelector('.threadTitle'),name=norm(title&&title.textContent),row=latest[name];
      var main=btn.querySelector('.threadMain'); if(!main)return;
      var preview=main.querySelector('.cc770-chat-preview'); if(!preview){preview=document.createElement('div');preview.className='cc770-chat-preview';main.appendChild(preview)}
      preview.textContent=row&&row.text?String(row.text).slice(0,58):'Open chat';
      var when=btn.querySelector('.cc770-chat-time'); if(!when){when=document.createElement('span');when.className='cc770-chat-time';btn.appendChild(when)}
      when.textContent=row?timeText(row.at):'';
      btn.classList.toggle('cc770-has-recent',!!row);
    });
  }
  function run(){managerOnlyCenter();organizeChat()}
  function schedule(){if(timer)clearTimeout(timer);timer=setTimeout(function(){timer=0;run()},45)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run();
  var observer=new MutationObserver(schedule);observer.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('popstate',schedule);window.addEventListener('cc-route-change',schedule);window.addEventListener('storage',schedule);
  window.addEventListener('career-crox-react-ready',schedule);
})();
