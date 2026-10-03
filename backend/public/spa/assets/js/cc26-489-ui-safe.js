(function(){
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
    link.href='/assets/chat-bento-489.css?v=CC26_760_LIVE_LOCK_CHAT_PUSH';
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
    try{
      var key='cc_chat_cache:'+thread,rows=JSON.parse(sessionStorage.getItem(key)||'[]'); if(!Array.isArray(rows))rows=[];
      var id=String(item&&item.id||''); rows=rows.filter(function(x){return String(x&&x.id||'')!==id}); rows.push(item);
      rows.sort(function(a,b){return (Number(a&&a.id||0)-Number(b&&b.id||0))||String(a&&a.created_at||'').localeCompare(String(b&&b.created_at||''));});
      sessionStorage.setItem(key,JSON.stringify(rows.slice(-80)));
    }catch(_){}
  }
  function formatChatTime(v){try{return new Date(v).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'numeric',minute:'2-digit',hour12:true})}catch(_){return''}}
  function appendInstantMessage(item){
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
    if(!document.body.classList.contains('cc469-chat')) return;
    fitChatShell(); ensureLeftPanel(); ensureChatHeader(); ensureMessageRows(); ensureComposer(); ensureRightPanel(); enhanceAriaReports();
  }

  var chatObserver = null;
  var observedShell = null;
  var chatApplyScheduled = false;

  function observeChatShell(){
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
  function bindInstantThreadFeedback(){
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
    var pill=document.querySelector('.top-pill[data-pill="team-chat"]');if(!pill)return;var total=cc758TotalUnread(st),badge=pill.querySelector('.cc758-chat-pill-badge');
    if(total>0){if(!badge){badge=document.createElement('span');badge.className='cc758-chat-pill-badge';pill.appendChild(badge)}badge.textContent=total>99?'99+':String(total);pill.title=total+' pending Team Chat message'+(total===1?'':'s')}
    else{if(badge)badge.remove();pill.title='CRM Team Chat'}
  }
  function cc758RenderPeopleOrder(st){
    if(!/^\/chat(?:\/|$)/.test(location.pathname||''))return;
    var buckets=cc758SortedBuckets(st,false).filter(function(b){return String(b.thread||'').indexOf('dm:')===0}),buttons=Array.prototype.slice.call(document.querySelectorAll('.teamsLeft .personBtn'));if(!buttons.length)return;
    var rank={};buckets.forEach(function(b,i){var k=cc758Norm(b.sender_name||b.sender_username);if(k&&!Object.prototype.hasOwnProperty.call(rank,k))rank[k]={i:i,count:Number(b.count||0),at:Number(b.at||0)}});
    buttons.forEach(function(btn,idx){var title=btn.querySelector('.threadTitle'),name=cc758Norm(title&&title.textContent),r=rank[name],badge=btn.querySelector('.cc758-unread-badge');btn.setAttribute('data-cc758-original-order',btn.getAttribute('data-cc758-original-order')||String(idx));btn.classList.toggle('cc758-chat-recent',!!r);if(r&&r.count>0){if(!badge){badge=document.createElement('span');badge.className='cc758-unread-badge';btn.appendChild(badge)}badge.textContent=r.count>99?'99+':String(r.count)}else if(badge)badge.remove()});
    var sorted=buttons.slice().sort(function(a,b){var an=cc758Norm((a.querySelector('.threadTitle')||{}).textContent),bn=cc758Norm((b.querySelector('.threadTitle')||{}).textContent),ar=rank[an],br=rank[bn];if(ar||br)return Number(br&&br.at||0)-Number(ar&&ar.at||0);return Number(a.getAttribute('data-cc758-original-order')||0)-Number(b.getAttribute('data-cc758-original-order')||0)}),after=buttons[buttons.length-1]&&buttons[buttons.length-1].nextSibling,parent=buttons[0]&&buttons[0].parentNode;if(parent)sorted.forEach(function(btn){parent.insertBefore(btn,after)});
  }
  function cc758RenderChannelBadge(st){
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
  function cc498RenderUnlock(item){
    if(!item||item.type!=='unlock')return cc497RemoveUnlockPopup();
    var btnTop=cc498ApprovalButton();if(btnTop){btnTop.classList.add('cc498-approval-urgent');var pc=btnTop.querySelector('.pill-count');if(pc&&Number(pc.textContent||0)<1)pc.textContent='1'}
    var old=document.getElementById('cc497-unlock-approval');
    if(old&&old.getAttribute('data-request-id')===String(item.id||'')){cc498PositionApprovalPopup();return}
    cc497RemoveUnlockPopup();if(btnTop)btnTop.classList.add('cc498-approval-urgent');
    var wrap=document.createElement('div');wrap.id='cc497-unlock-approval';wrap.setAttribute('data-request-id',String(item.id||''));wrap.style.cssText='position:fixed;z-index:100502;font-family:inherit';
    var card=document.createElement('div');card.style.cssText='border:1px solid #f0b46d;border-radius:19px;padding:14px;background:linear-gradient(145deg,#fffdf8 0%,#fff2df 100%);box-shadow:0 22px 54px rgba(119,72,25,.22);color:#243247';
    var title=document.createElement('div');title.textContent='Unlock Approval Required';title.style.cssText='font-size:16px;font-weight:1000;color:#7b3f00;margin-bottom:5px';
    var name=document.createElement('div');name.textContent=String(item.title||'Employee unlock request');name.style.cssText='font-size:14px;font-weight:1000;color:#1d3148;margin-bottom:5px';
    var role=document.createElement('div');role.textContent=item.requester_role?('Role: '+String(item.requester_role).toUpperCase()):'';role.style.cssText='font-size:10px;font-weight:1000;color:#9a5c1c;margin-bottom:4px;text-transform:uppercase';
    var reason=document.createElement('div');reason.textContent=String(item.process||'CRM locked because of inactivity.');reason.style.cssText='font-size:11.5px;font-weight:800;color:#4b5d70;line-height:1.4;margin-bottom:10px;max-height:62px;overflow:auto';
    var row=document.createElement('div');row.style.cssText='display:flex;gap:7px;flex-wrap:wrap';
    function mk(label,bg,color){var b=document.createElement('button');b.type='button';b.textContent=label;b.style.cssText='border:0;border-radius:11px;padding:8px 11px;font-weight:1000;cursor:pointer;background:'+bg+';color:'+color+';box-shadow:0 7px 16px rgba(55,72,95,.12)';return b}
    var approve=mk('Approve Unlock','linear-gradient(135deg,#17ad69,#49d486)','#fff');
    var reject=mk('Reject','linear-gradient(135deg,#ff725f,#ef4e68)','#fff');
    var center=mk('Open Approvals','#edf3ff','#244d7a');
    approve.onclick=function(){if(cc497UnlockBusy)return;cc497UnlockBusy=true;approve.disabled=true;cc497Post('/api/approvals/approve',{type:'unlock',id:item.id}).then(function(){cc497RemoveUnlockPopup();cc497UnlockCheckAt=0;setTimeout(function(){cc497CheckUnlockApproval(true)},350)}).catch(function(e){alert(e.message||'Approval failed')}).finally(function(){cc497UnlockBusy=false;approve.disabled=false})};
    reject.onclick=function(){if(cc497UnlockBusy)return;var why=prompt('Reject reason (required):','');if(!String(why||'').trim())return;cc497UnlockBusy=true;reject.disabled=true;cc497Post('/api/approvals/reject',{type:'unlock',id:item.id,reason:String(why).trim()}).then(function(){cc497RemoveUnlockPopup();cc497UnlockCheckAt=0;setTimeout(function(){cc497CheckUnlockApproval(true)},350)}).catch(function(e){alert(e.message||'Reject failed')}).finally(function(){cc497UnlockBusy=false;reject.disabled=false})};
    center.onclick=function(){try{history.pushState(null,'','/approvals');window.dispatchEvent(new PopStateEvent('popstate'));window.dispatchEvent(new Event('cc-route-change'))}catch(_){location.href='/approvals'}};
    row.appendChild(approve);row.appendChild(reject);row.appendChild(center);card.appendChild(title);card.appendChild(name);if(item.requester_role)card.appendChild(role);card.appendChild(reason);card.appendChild(row);wrap.appendChild(card);document.body.appendChild(wrap);cc498PositionApprovalPopup();
  }
  function cc497CheckUnlockApproval(force){
    // CC26_760: no timed approval polling. Only an explicit/event-driven recovery may read once.
    if(!force)return;
    if(window.__CC621_NIGHT_QUIET__?.()||window.__CC602_NETWORK_PAUSED__||!cc497Leadership())return;
    cc497UnlockCheckAt=Date.now();
    fetch('/api/approvals?scope=ops',{credentials:'include',headers:{'X-Career-Crox-Background':'1','Cache-Control':'no-cache'}}).then(function(r){if(!r.ok)throw new Error('approval');return r.json()}).then(function(d){var items=Array.isArray(d&&d.items)?d.items:[];var item=items.find(function(x){return x&&x.type==='unlock'});cc498RenderUnlock(item||null)}).catch(function(){/* live SSE remains primary */});
  }
  function cc498CloseApprovalStream(){if(cc498ApprovalStream){try{cc498ApprovalStream.close()}catch(_){}cc498ApprovalStream=null}}
  function cc498EnsureApprovalStream(){
    // CC26_760: manual-first means no polling; it must NOT disable the lightweight live approval stream.
    if(window.__CC621_NIGHT_QUIET__?.()||window.__CC602_NETWORK_PAUSED__||cc498IsLogin()||typeof EventSource==='undefined'){cc498CloseApprovalStream();return}
    if(cc498ApprovalStream||Date.now()<cc498ApprovalRetryAt)return;
    try{
      var es=new EventSource('/api/approvals/stream',{withCredentials:true});cc498ApprovalStream=es;
      es.addEventListener('ready',function(){cc498ApprovalRetryAt=0});
      es.addEventListener('unlock',function(ev){if(!cc497Leadership())return;try{cc498RenderUnlock(JSON.parse(ev.data||'{}'))}catch(_){}});
      es.addEventListener('reminder-dirty',function(ev){try{window.dispatchEvent(new CustomEvent('career-crox-manager-reminder-dirty',{detail:JSON.parse(ev.data||'{}')}))}catch(_){window.dispatchEvent(new Event('career-crox-manager-reminder-dirty'))}});
      es.addEventListener('self-locked',function(ev){if(!cc498IsTl())return;try{var d=JSON.parse(ev.data||'{}');cc498RenderTlLock({locked:'1',lock_reason:'idle',lock_message:String(d.process||'CRM inactivity lock. Manager approval required.')})}catch(_){}});
      es.addEventListener('unlock-resolved',function(ev){
        var d={};try{d=JSON.parse(ev.data||'{}')}catch(_){}
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
  function cc498ShowChatPeek(item,makeUnread){
    if(!item)return;
    if(String(item.reference_type||'')==='semi_hourly_report'&&String(item.sender_username||'').toLowerCase()==='aria')return;
    var me=cc498CachedUser(),mine=String(me.username||'').trim().toLowerCase(),sender=String(item.sender_username||'').trim().toLowerCase();if(mine&&sender&&mine===sender)return;
    var id=String(item.id||item.message_id||item.created_at||'');if(id&&id===cc498ChatLastId)return;if(makeUnread!==false&&!cc500ClaimToast(id))return;cc498ChatLastId=id;
    var unread=makeUnread!==false;if(unread)cc498ChatUnread+=1;
    // Always touch the bucket so the newest sender moves to the top. If the user
    // is already reading this exact thread, show the toast but do not leave an unread badge.
    var st=cc758TouchMessage(item,unread),total=cc758TotalUnread(st),rows=cc758SortedBuckets(st,true).slice(0,4);
    var root=document.getElementById('cc498-chat-peek');if(!root){root=document.createElement('div');root.id='cc498-chat-peek';root.innerHTML='<div class="cc498-peek-head"><span class="cc498-peek-dot"></span><span class="cc498-peek-title">CRM Team Chat</span><span class="cc498-peek-count">New message</span></div><div class="cc498-peek-body"><div class="cc758-peek-summary"></div><div class="cc758-peek-list"></div><div class="cc498-peek-text"></div></div>';document.body.appendChild(root)}
    root.classList.remove('cc500-toast-out');root.querySelector('.cc498-peek-count').textContent=unread?((total>99?'99+':String(total))+' pending'):'New message';root.querySelector('.cc758-peek-summary').textContent=unread?(total+' unread message'+(total===1?'':'s')+' • newest first'):'Live message • this chat is open';
    var list=root.querySelector('.cc758-peek-list');if(list){list.innerHTML='';rows.forEach(function(b){var r=document.createElement('div');r.className='cc758-peek-person';var nm=document.createElement('span');nm.textContent=String(b.sender_name||b.sender_username||'Team member');var ct=document.createElement('strong');ct.textContent=String(Math.max(1,Number(b.count||0)));r.appendChild(nm);r.appendChild(ct);list.appendChild(r)})}
    var body=String(item.body||item.message||item.message_text||item.content||'New message').replace(/\s+/g,' ').trim();root.querySelector('.cc498-peek-text').textContent=String(item.sender_name||item.sender_username||'Team member')+': '+body.slice(0,150);root.setAttribute('data-thread',String(item.thread_key||'team'));root.onclick=function(){cc498OpenChat(root.getAttribute('data-thread')||'team')};
    if(cc500ChatToastTimer)clearTimeout(cc500ChatToastTimer);cc500ChatToastTimer=null;if(!document.hidden){cc500ChatToastTimer=setTimeout(function(){var n=document.getElementById('cc498-chat-peek');if(!n)return;n.classList.add('cc500-toast-out');setTimeout(function(){if(n.parentNode)n.remove();cc498ChatUnread=0},230)},10000);}
  }
  function cc498EnsureGlobalChatStream(){
    var onChat=/^\/chat(?:\/|$)/.test(location.pathname||'');if(onChat){try{window.name='careerCroxTeamChat'}catch(_){} }
    // CC26_760: keep one push stream while the authenticated CRM session exists, even in a background tab.
    // The 10-minute inactivity/session guard remains the owner that closes all streams.
    if(window.__CC621_NIGHT_QUIET__?.()||(!window.__CC_CHAT_LIVE_PUSH__&&window.__CC_CHAT_MANUAL_ONLY__)||window.__CC602_NETWORK_PAUSED__||cc498IsLogin()||typeof EventSource==='undefined'){cc498CloseChatStream();return}
    if(cc498ChatStream||Date.now()<cc498ChatRetryAt)return;
    try{var es=new EventSource('/api/chat/stream?thread_key=all',{withCredentials:true});cc498ChatStream=es;es.addEventListener('open',function(){cc498ChatRetryAt=0});es.addEventListener('message',function(ev){try{var item=JSON.parse(ev.data||'{}').item;if(!item)return;var thread=String(item.thread_key||'team'),chatNow=/^\/chat(?:\/|$)/.test(location.pathname||'');if(chatNow&&thread===String(activeChatThread())){mergeCacheMessage(thread,item);appendInstantMessage(item);cc498ShowChatPeek(item,false);return}cc498ShowChatPeek(item,true)}catch(_){}});es.onerror=function(){if(es.readyState===2){cc498ChatStream=null;cc498ChatRetryAt=Date.now()+15000;setTimeout(cc498EnsureGlobalChatStream,15100)}}}catch(_){cc498ChatRetryAt=Date.now()+15000;setTimeout(cc498EnsureGlobalChatStream,15100)}
  }
  function cc498RemoveTlLock(){var old=document.getElementById('cc498-tl-lock');if(old)old.remove()}
  function cc498RenderTlLock(presence){
    if(!cc498IsTl()||!presence||String(presence.locked||'0')!=='1'||(String(presence.is_on_break||'0')==='1'&&String(presence.lock_reason||'')==='break'))return cc498RemoveTlLock();
    if(document.getElementById('cc498-tl-lock'))return;
    var wrap=document.createElement('div');wrap.id='cc498-tl-lock';var card=document.createElement('div');card.className='cc498-lock-card';var chip=document.createElement('div');chip.textContent='MANAGER APPROVAL REQUIRED';chip.style.cssText='font-size:10px;font-weight:1000;color:#b24d24;letter-spacing:.07em;margin-bottom:7px';var title=document.createElement('div');title.textContent='CRM Access Paused';title.style.cssText='font-size:21px;font-weight:1000;color:#24364b;margin-bottom:7px';var msg=document.createElement('div');msg.textContent=String(presence.lock_message||'Your CRM is locked. Only Manager can approve a TL unlock.');msg.style.cssText='font-size:12.5px;font-weight:800;color:#586879;line-height:1.45;margin-bottom:12px';var ta=document.createElement('textarea');ta.placeholder='Add unlock note for Manager';var btn=document.createElement('button');btn.type='button';btn.textContent='Send / Update Unlock Request';btn.style.marginTop='10px';btn.onclick=function(){var note=String(ta.value||'').trim();if(!note)return;btn.disabled=true;cc497Post('/api/attendance/request-unlock',{reason:note,note:note,employee_note:note}).then(function(){btn.textContent='Request Sent to Manager';setTimeout(function(){btn.textContent='Send / Update Unlock Request';btn.disabled=false},1200)}).catch(function(e){alert(e.message||'Request failed');btn.disabled=false})};card.appendChild(chip);card.appendChild(title);card.appendChild(msg);card.appendChild(ta);card.appendChild(btn);wrap.appendChild(card);document.body.appendChild(wrap)
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
  window.addEventListener('cc621:night-quiet',function(){closeInstantChatStream();cc498CloseChatStream();cc498CloseApprovalStream();});
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
    if(!panel) return;
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

  var busyMap={
    'saving...':'Saved','saving task...':'Task Saved','updating...':'Updated','uploading...':'Uploaded','submitting...':'Submitted','approving...':'Approved','rejecting...':'Rejected','creating...':'Created','working...':'Done','checking...':'Checked'
  };
  function stabilizeBusyLabels(){
    Array.prototype.forEach.call(document.querySelectorAll('button,.sync-chip,.live-chip,.master-status,.helper-text'),function(el){
      var t=lower(txt(el));
      if(busyMap[t] && txt(el)!==busyMap[t]) el.textContent=busyMap[t];
      var forced=el.getAttribute&&el.getAttribute('data-cc521-final-label');
      var until=Number(el.getAttribute&&el.getAttribute('data-cc521-final-until')||0);
      if(forced && Date.now()<until && !/failed|error/i.test(txt(document.querySelector('.sync-chip.error,.sync-message.is-error')||{})) && txt(el)!==forced) el.textContent=forced;
      else if(forced && Date.now()>=until){el.removeAttribute('data-cc521-final-label');el.removeAttribute('data-cc521-final-until')}
    });
  }

  function immediateFinalOnClick(ev){
    var btn=ev.target&&ev.target.closest?ev.target.closest('button'):null;if(!btn)return;
    var label=lower(txt(btn)), final='';
    if(label==='save'||label==='save changes'||label==='save status'||label==='save target') final='Saved';
    else if(label==='submit') final='Submitted';
    else if(label==='approve') final='Approved';
    else if(label==='confirm reject'||label==='reject') final='Rejected';
    else if(label==='assign task'||label==='create task') final='Task Saved';
    else if(label==='create candidate') final='Candidate Created';
    else if(label==='load into crm') final='Loaded';
    if(!final)return;
    btn.setAttribute('data-cc521-final-label',final);btn.setAttribute('data-cc521-final-until',String(Date.now()+4500));btn.textContent=final;
    setTimeout(stabilizeBusyLabels,0);
  }
  document.addEventListener('click',immediateFinalOnClick,true);


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
