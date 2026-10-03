/* CC26_754 — manager approval popup only. Team Chat is React/CSS-owned. */
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
#cc497-unlock-approval>div{position:relative!important;overflow:hidden!important;border:1px solid rgba(255,255,255,.48)!important;border-radius:24px!important;padding:18px!important;background:linear-gradient(135deg,rgba(29,93,220,.96) 0%,rgba(69,70,211,.96) 54%,rgba(126,65,189,.96) 100%)!important;box-shadow:0 28px 70px rgba(29,50,105,.34),inset 0 1px 0 rgba(255,255,255,.34)!important;color:#fff!important;backdrop-filter:blur(18px)!important}
#cc497-unlock-approval>div:before{content:"";position:absolute;inset:-45% 30% 45% -35%;background:linear-gradient(115deg,transparent 20%,rgba(255,255,255,.34) 46%,transparent 70%);transform:rotate(-8deg);pointer-events:none;animation:cc585GlassShine 3.4s ease-in-out infinite}
@keyframes cc585GlassShine{0%,55%{transform:translateX(-36%) rotate(-8deg);opacity:0}68%{opacity:.8}100%{transform:translateX(220%) rotate(-8deg);opacity:0}}
#cc497-unlock-approval>div>div:not(:last-child){color:#fff!important;-webkit-text-fill-color:#fff!important;text-shadow:0 1px 3px rgba(10,24,62,.28)!important}
#cc497-unlock-approval>div>div:nth-child(1){font-size:19px!important;font-weight:900!important;letter-spacing:-.01em!important;margin-bottom:7px!important}
#cc497-unlock-approval>div>div:nth-child(2){font-size:17px!important;font-weight:800!important;margin-bottom:7px!important}
#cc497-unlock-approval>div>div:nth-child(3){font-size:11.5px!important;font-weight:800!important;color:#dbeafe!important;-webkit-text-fill-color:#dbeafe!important;letter-spacing:.08em!important}
#cc497-unlock-approval>div>div:nth-child(4){font-size:14px!important;line-height:1.5!important;font-weight:700!important;color:#f8fbff!important;-webkit-text-fill-color:#f8fbff!important;background:rgba(255,255,255,.10)!important;border:1px solid rgba(255,255,255,.16)!important;border-radius:14px!important;padding:10px 12px!important;max-height:88px!important}
#cc497-unlock-approval button{min-height:42px!important;border-radius:13px!important;padding:10px 14px!important;font-size:14px!important;font-weight:800!important;color:#fff!important;-webkit-text-fill-color:#fff!important;border:1px solid rgba(255,255,255,.28)!important;box-shadow:0 10px 22px rgba(13,33,81,.22),inset 0 1px 0 rgba(255,255,255,.32)!important;transition:transform .12s ease,filter .12s ease!important}
#cc497-unlock-approval button:hover{transform:translateY(-1px)!important;filter:brightness(1.05)!important}
#cc497-unlock-approval button:nth-child(1){background:linear-gradient(135deg,#19c978,#0ea968)!important}
#cc497-unlock-approval button:nth-child(2){background:linear-gradient(135deg,#ff6680,#e83f68)!important}
#cc497-unlock-approval button:nth-child(3){background:linear-gradient(135deg,rgba(255,255,255,.23),rgba(255,255,255,.11))!important}
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
    btn.disabled=true;btn.textContent='Rejecting…';
    try{
      const r=await fetch('/api/approvals/reject',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'unlock',id:id,reason:'Rejected by manager from approval popup.'})});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'Reject failed');
      clearDismissed();p.remove();approvalBtn()?.classList.remove('cc498-approval-urgent');
    }catch(e){btn.disabled=false;btn.textContent='Reject';alert(e.message||'Reject failed');}
  }

  document.addEventListener('click',function(ev){
    const p=currentPopup();
    if(!p)return;
    const t=ev.target instanceof Element?ev.target:null;
    if(t&&p.contains(t)){
      const b=t.closest('button');
      if(b&&/^reject$/i.test((b.textContent||'').trim())){ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();oneClickReject(b,p);return;}
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
