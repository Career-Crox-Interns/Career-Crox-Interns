import React, { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { api, cachePrincipal } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { useAuth } from '../lib/auth';
const cc911ChatCss=String.raw`/* CC26_474 — Native Team Chat UI. Scoped to /chat only; CRM sidebar/topbar stay untouched. */
body.cc474-chat .teamsShell,
body.cc474-chat .teamsShell *{box-sizing:border-box;font-family:"Plus Jakarta Sans","Segoe UI Variable Text","Segoe UI",Arial,sans-serif}

body.cc474-chat .page-scroll{overflow:hidden!important}
body.cc474-chat .teamsShell{
  width:100%;height:calc(100dvh - 146px);min-height:500px;margin:0;
  display:grid;grid-template-columns:252px minmax(0,1fr) 304px;gap:14px;align-items:stretch;
  color:#143252;letter-spacing:-.008em;overflow:hidden;
}
body.cc474-chat .teamsShell.infoClosed{grid-template-columns:252px minmax(0,1fr)}
body.cc474-chat .teamsPanel{
  min-width:0;min-height:0;height:100%;overflow:hidden;position:relative;
  border:1px solid #cfdced;border-radius:18px;background:#fff;
  box-shadow:0 12px 30px rgba(31,51,90,.075);
}
button,input,textarea{font:inherit}

/* LEFT */
body.cc474-chat .teamsLeft{
  display:flex;flex-direction:column;padding:14px;
  background:linear-gradient(180deg,#fff 0%,#f7f8ff 45%,#effbff 72%,#f7f3ff 100%);
}
body.cc474-chat .teamsTopActions{display:flex;align-items:center;gap:10px;min-height:40px;margin-bottom:10px}
body.cc474-chat .teamsPanelTitle{font-size:18px;font-weight:800;color:#102f53;line-height:1.15;margin-right:auto}
body.cc474-chat .teamsAddBtn{
  width:38px;height:38px;min-width:38px;border:1px solid #c9d7ec;border-radius:12px;cursor:pointer;
  background:linear-gradient(135deg,#e6efff 0%,#eee7ff 55%,#dcfbf5 100%);color:#574fe0;
  font-size:22px;line-height:1;font-weight:600;box-shadow:0 5px 14px rgba(79,79,211,.08);
}
body.cc474-chat .teamsSearch,
body.cc474-chat .chatInput{
  width:100%;border:1px solid #ccd9e9;border-radius:12px;background:#fff;color:#1b3a5a;outline:none;
  box-shadow:0 4px 12px rgba(40,67,111,.045);
}
body.cc474-chat .teamsSearch{height:44px;padding:0 13px;font-size:13.5px;font-weight:550}
body.cc474-chat .teamsSearch:focus,body.cc474-chat .chatInput:focus{border-color:#7f8cf4;box-shadow:0 0 0 3px rgba(91,95,238,.11)}
body.cc474-chat .teamsTabs{
  display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;margin:10px 0;padding:5px;
  border:1px solid #d8e1ef;border-radius:12px;background:linear-gradient(135deg,#edf3ff,#f4eeff 52%,#edfaff);
}
body.cc474-chat .teamsTabs button{
  min-width:0;height:34px;padding:0 4px;border:0;border-radius:9px;background:transparent;color:#566b86;
  font-size:11.5px;font-weight:700;white-space:nowrap;cursor:pointer;
}
body.cc474-chat .teamsTabs button.active{
  color:#fff;background:linear-gradient(135deg,#2f6df4 0%,#6848ed 58%,#a43fd4 100%);
  box-shadow:0 6px 14px rgba(90,72,220,.2);
}
body.cc474-chat .createPanel{padding:9px;margin-bottom:8px;border:1px solid #dbe3ef;border-radius:12px;background:rgba(255,255,255,.82)}
body.cc474-chat .createPanel .chatInput{height:38px;padding:0 10px;font-size:12px}
body.cc474-chat .fullBtn{width:100%;margin-top:7px}
body.cc474-chat .leftScroll{min-height:0;flex:1;overflow:auto;padding-right:2px}
body.cc474-chat .teamsSectionTitle{
  display:flex;align-items:center;justify-content:space-between;margin:9px 5px 7px;
  color:#657b96;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;
}
body.cc474-chat .threadBtn,body.cc474-chat .personBtn{
  width:100%;min-height:52px;margin:0 0 6px;padding:7px 9px;display:flex;align-items:center;gap:9px;
  border:1px solid transparent;border-radius:14px;background:rgba(255,255,255,.93);color:#123050;
  text-align:left;cursor:pointer;box-shadow:0 3px 10px rgba(39,61,102,.035);
}
body.cc474-chat .threadBtn:hover,body.cc474-chat .personBtn:hover{background:linear-gradient(135deg,#eff5ff,#f7f0ff)}
body.cc474-chat .threadBtn.active,body.cc474-chat .personBtn.active{
  border-color:#bfcdf7;background:linear-gradient(135deg,#e6efff 0%,#f0e8ff 55%,#e5fbff 100%);
  box-shadow:0 7px 16px rgba(87,76,208,.095);
}
body.cc474-chat .threadBtn:disabled,body.cc474-chat .personBtn:disabled{opacity:.48;cursor:not-allowed}
body.cc474-chat .listAvatar{
  width:38px;height:38px;min-width:38px;display:grid;place-items:center;border-radius:12px;color:#fff;
  font-size:12px;font-weight:800;box-shadow:0 6px 14px rgba(46,66,111,.13);
}
body.cc474-chat .channelAvatar{background:linear-gradient(135deg,#4668f4,#8243e7)}
body.cc474-chat .personAvatar{border-radius:50%;background:linear-gradient(135deg,#2388e9,#24b99f)}
body.cc474-chat .personBtn:nth-of-type(4n+2) .personAvatar{background:linear-gradient(135deg,#05a77e,#58d5a5)}
body.cc474-chat .personBtn:nth-of-type(4n+3) .personAvatar{background:linear-gradient(135deg,#f78b37,#ffc243)}
body.cc474-chat .personBtn:nth-of-type(4n) .personAvatar{background:linear-gradient(135deg,#8b4cf0,#dc55bd)}
body.cc474-chat .threadMain{min-width:0;flex:1}
body.cc474-chat .threadTitle{
  font-size:13.5px;line-height:1.25;font-weight:750;color:#123152;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
body.cc474-chat .rolePill{
  flex:0 0 auto;max-width:58px;padding:4px 6px;border-radius:999px;background:linear-gradient(135deg,#eef2ff,#f4eaff);
  color:#6458c8;font-size:8.5px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
body.cc474-chat .leftReviewList{display:grid;gap:6px}
body.cc474-chat .leftReviewItem{padding:10px;border:1px solid #eadff7;border-radius:12px;background:#fff;text-align:left;cursor:pointer}
body.cc474-chat .leftReviewItem strong{display:block;font-size:12px;color:#452d78}
body.cc474-chat .leftReviewItem span{display:block;margin-top:3px;font-size:10.5px;color:#728196;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* CENTER */
body.cc474-chat .chatMain{display:grid;grid-template-rows:auto auto minmax(0,1fr) auto;background:linear-gradient(180deg,#fff,#fafdff);overflow:hidden}
body.cc474-chat .teamsChatHeader{
  min-height:76px;padding:12px 17px;display:flex;align-items:center;gap:12px;
  border-bottom:1px solid #d7e1ef;background:linear-gradient(115deg,#eaf1ff 0%,#f2eaff 47%,#e5fbff 100%);
}
body.cc474-chat .chatTitleRow{min-width:0;flex:1;display:flex;align-items:center;gap:11px}
body.cc474-chat .roomHash{
  width:42px;height:42px;min-width:42px;display:grid;place-items:center;border-radius:13px;color:#fff;
  background:linear-gradient(135deg,#2f6df4,#6948ed 58%,#a43fd4);font-size:20px;font-weight:800;
  box-shadow:0 8px 18px rgba(92,72,220,.2);
}
body.cc474-chat .chatTitleText{min-width:0}
body.cc474-chat .chat-room-title{font-size:18px;line-height:1.2;font-weight:800;color:#102e51;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body.cc474-chat .chatHeadTools{display:flex;align-items:center;gap:7px;flex:0 0 auto}
body.cc474-chat .headAvatars{display:flex;align-items:center}
body.cc474-chat .headAvatar{
  width:31px;height:31px;margin-left:-6px;display:grid;place-items:center;border:2px solid #fff;border-radius:50%;cursor:pointer;
  color:#fff;font-size:8.5px;font-weight:800;background:linear-gradient(135deg,#2f76ef,#37b9e7);box-shadow:0 4px 10px rgba(37,56,100,.10);
}
body.cc474-chat .headAvatar:first-child{margin-left:0}
body.cc474-chat .headAvatar.a2{background:linear-gradient(135deg,#16a783,#50d39e)}
body.cc474-chat .headAvatar.a3{background:linear-gradient(135deg,#df4fbd,#894ceb)}
body.cc474-chat .headAvatar.more{background:linear-gradient(135deg,#ff9a36,#ff6653)}
body.cc474-chat .headToolBtn{
  width:34px;height:34px;border:1px solid #d2deed;border-radius:50%;background:#fff;color:#2f4c6a;cursor:pointer;
  display:grid;place-items:center;font-size:14px;font-weight:800;box-shadow:0 3px 9px rgba(34,55,93,.05);
}
body.cc474-chat .helperDanger{margin:0;padding:8px 14px;background:#fff6e9;color:#a34d05;font-size:11.5px;font-weight:650;border-bottom:1px solid #f5dfbf}
body.cc474-chat .chatFeed{
  min-height:0;overflow:auto;padding:18px 21px 14px;scrollbar-gutter:stable;
  background:radial-gradient(circle at 8% 10%,rgba(65,105,244,.075),transparent 25%),radial-gradient(circle at 92% 15%,rgba(30,193,163,.07),transparent 23%),radial-gradient(circle at 55% 90%,rgba(169,66,218,.045),transparent 24%),linear-gradient(180deg,#fff,#fbfdff);
}
body.cc474-chat .dateDivider{display:flex;align-items:center;justify-content:center;gap:9px;margin:2px 0 16px;color:#8192a8;font-size:11px;font-weight:650}
body.cc474-chat .dateDivider::before,body.cc474-chat .dateDivider::after{content:"";height:1px;width:62px;background:#dbe4ef}
body.cc474-chat .chatRow{display:flex;align-items:flex-end;gap:8px;margin-bottom:12px}
body.cc474-chat .chatRow.mine{justify-content:flex-end}
body.cc474-chat .chatAvatar{
  width:34px;height:34px;min-width:34px;display:grid;place-items:center;border-radius:50%;color:#fff;
  background:linear-gradient(135deg,#2782e8,#25b8a0);font-size:10.5px;font-weight:800;box-shadow:0 5px 12px rgba(34,58,100,.12);
}
body.cc474-chat .chatRow.mine .chatAvatar{order:2;background:linear-gradient(135deg,#3970f3,#7a43e8)}
body.cc474-chat .chatBubble{
  position:relative;max-width:min(76%,660px);padding:11px 14px;border:1px solid #dce5f0;border-radius:18px 18px 18px 7px;
  background:#fff;color:#173452;box-shadow:0 7px 18px rgba(31,49,82,.065);
}
body.cc474-chat .chatRow.mine .chatBubble{
  border-color:transparent;border-radius:18px 18px 7px 18px;
  background:linear-gradient(135deg,#1f61ef 0%,#4d58ee 46%,#853fe5 100%);
  box-shadow:0 11px 24px rgba(70,72,224,.24);
}
body.cc474-chat .chatMeta{display:flex;align-items:center;gap:6px;margin-bottom:5px;color:#78879b;font-size:10.5px;line-height:1.2}
body.cc474-chat .chatMeta strong{font-size:12.5px;font-weight:800;color:#183955}
body.cc474-chat .chatRow.mine .chatMeta,body.cc474-chat .chatRow.mine .chatMeta strong,body.cc474-chat .chatRow.mine .chatBody,body.cc474-chat .chatRow.mine .messageMenu summary{
  color:#fff!important;-webkit-text-fill-color:#fff!important;text-shadow:0 1px 2px rgba(0,0,0,.28)!important;
}
body.cc474-chat .chatRow.mine .chatMeta{opacity:.98}
body.cc474-chat .chatBody{font-size:14.5px;line-height:1.55;font-weight:560;color:#173452;white-space:pre-wrap;overflow-wrap:anywhere}
body.cc474-chat .reviewBadge{padding:2px 5px;border-radius:999px;background:#fff0c6;color:#8c5b00;font-size:8.5px;font-weight:800;text-shadow:none!important;-webkit-text-fill-color:#8c5b00!important}
body.cc474-chat .messageMenu{position:absolute;right:5px;top:5px}
body.cc474-chat .messageMenu summary{list-style:none;width:24px;height:24px;display:grid;place-items:center;border-radius:7px;color:#66788f;font-size:16px;cursor:pointer}
body.cc474-chat .messageMenu summary::-webkit-details-marker{display:none}
body.cc474-chat .messageMenuPopup{position:absolute;right:0;top:26px;z-index:20;display:flex;gap:5px;padding:6px;border:1px solid #dbe4ef;border-radius:10px;background:#fff;box-shadow:0 12px 24px rgba(24,37,60,.16)}
body.cc474-chat .rowActions{display:flex;align-items:center;gap:6px;margin-top:8px}
body.cc474-chat .tinyBtn,body.cc474-chat .miniBlue,body.cc474-chat .miniGood,body.cc474-chat .miniDanger{
  min-height:32px;padding:0 9px;border-radius:9px;font-size:10.5px;font-weight:700;cursor:pointer;
}
body.cc474-chat .tinyBtn{border:1px solid #d9e2ee;background:#fff;color:#31506f}
body.cc474-chat .tinyBtn.danger,body.cc474-chat .miniDanger{border:1px solid #f2c8cf;background:#fff2f4;color:#b4233a}
body.cc474-chat .miniBlue{border:0;background:linear-gradient(135deg,#4267f2,#7843e8);color:#fff}
body.cc474-chat .miniGood{border:1px solid #bce5d5;background:#ecfbf5;color:#08785d}
body.cc474-chat .compact{min-height:28px;padding:0 7px;font-size:9px}
body.cc474-chat .mutedBox{padding:12px;border:1px dashed #d6e0ec;border-radius:12px;background:rgba(248,251,255,.92);color:#6d7d91;font-size:12px;line-height:1.45}

/* COMPOSER */
body.cc474-chat .composer{position:relative;padding:11px 12px;border-top:1px solid #dce5f0;background:linear-gradient(180deg,#fff,#f6fbff)}
body.cc474-chat .emojiBar{display:none;position:absolute;left:48px;bottom:64px;z-index:30;max-width:330px;gap:5px;flex-wrap:wrap;padding:8px;border:1px solid #dbe4ef;border-radius:12px;background:#fff;box-shadow:0 12px 25px rgba(31,48,79,.15)}
body.cc474-chat .composer.emojiOpen .emojiBar{display:flex}
body.cc474-chat .emojiBtn{width:30px;height:30px;padding:0;border:1px solid #e0e7f0;border-radius:50%;background:#f8faff;font-size:14px;cursor:pointer}
body.cc474-chat .composeBox{display:flex;align-items:center;gap:8px;min-height:60px;padding:6px 7px 6px 9px;border:1px solid #ccdaea;border-radius:18px;background:linear-gradient(135deg,#fff,#fbf9ff);box-shadow:0 8px 20px rgba(41,67,111,.07)}
body.cc474-chat .emojiToggle{width:36px;height:36px;min-width:36px;border:1px solid #d5dff0;border-radius:50%;background:linear-gradient(135deg,#eaf2ff,#f1e9ff);color:#6152dc;font-size:15px;cursor:pointer}
body.cc474-chat .composeBox textarea{flex:1;min-height:40px;max-height:90px;padding:9px 4px;border:0;background:transparent;outline:none;resize:none;color:#203b5b;font-size:14.5px;line-height:1.5;font-weight:550}
body.cc474-chat .sendBtn{width:44px;height:44px;min-width:44px;border:0;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#2f66f3,#6b45ed 62%,#a83fd4);color:#fff;font-size:16px;cursor:pointer;box-shadow:0 9px 18px rgba(83,66,219,.22)}
body.cc474-chat .sendBtn:disabled{opacity:.42;cursor:not-allowed}

/* RIGHT */
body.cc474-chat .rightPanel{display:flex;flex-direction:column;padding:14px;background:linear-gradient(180deg,#fff 0%,#faf7ff 48%,#f0fbff 100%);overflow:auto}
body.cc474-chat .profileHero{min-height:38px;display:flex;align-items:center;padding-bottom:9px}
body.cc474-chat .profileHero .panel-title{font-size:16px;font-weight:800;color:#123252}
body.cc474-chat .infoClose{margin-left:auto;width:28px;height:28px;border:0;border-radius:50%;background:transparent;color:#75869b;font-size:17px;cursor:pointer}
body.cc474-chat .infoHero{display:grid;grid-template-columns:40px minmax(0,1fr);align-items:center;gap:10px;padding:11px 12px;border:1px solid #d2ddee;border-radius:14px;background:linear-gradient(135deg,#e7f0ff,#efe7ff 55%,#e6faff)}
body.cc474-chat .infoHash{width:40px;height:40px;display:grid;place-items:center;border-radius:12px;background:linear-gradient(135deg,#376bf3,#7547e9 65%,#a242d3);color:#fff;font-size:18px;font-weight:800}
body.cc474-chat .infoHero h3{min-width:0;margin:0;font-size:14.5px;font-weight:800;color:#173351;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body.cc474-chat .infoTabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;margin:10px 0;padding:5px;border:1px solid #d7e0ee;border-radius:12px;background:linear-gradient(135deg,#edf3ff,#f4efff 55%,#edfbff)}
body.cc474-chat .infoTabs button{min-width:0;height:34px;padding:0 3px;border:0;border-radius:8px;background:transparent;color:#596f89;font-size:10.5px;font-weight:700;white-space:nowrap;cursor:pointer}
body.cc474-chat .infoTabs button.active{background:linear-gradient(135deg,#3469f3,#6d47ed 58%,#a042d8);color:#fff;box-shadow:0 6px 13px rgba(84,67,214,.19)}
body.cc474-chat .infoPanel{display:block;min-height:0}
body.cc474-chat .infoCardGrid{display:grid;grid-template-columns:1fr 1fr;gap:9px}
body.cc474-chat .infoCard{min-height:68px;padding:11px;border:1px solid transparent;border-radius:14px;text-align:left;cursor:pointer;color:#173652}
body.cc474-chat .infoCard span{display:block;font-size:10.5px;font-weight:700}
body.cc474-chat .infoCard strong{display:block;margin-top:6px;font-size:18px;line-height:1.05;font-weight:850}
body.cc474-chat .infoCard.blue{background:linear-gradient(135deg,#dbeaff,#eef5ff);border-color:#c1daf8}
body.cc474-chat .infoCard.mint{background:linear-gradient(135deg,#d7f7ea,#edfff8);border-color:#bde7d7}
body.cc474-chat .infoCard.orange{background:linear-gradient(135deg,#ffe5d0,#fff2e6);border-color:#f2ccb1}
body.cc474-chat .infoCard.violet{background:linear-gradient(135deg,#e8d9ff,#f4eaff);border-color:#d7c1f1}
body.cc474-chat .memberList{display:grid;gap:7px}
body.cc474-chat .memberRow{display:flex;align-items:center;gap:9px;padding:9px 10px;border:1px solid #dce5ef;border-radius:12px;background:linear-gradient(135deg,#f8faff,#effbff)}
body.cc474-chat .memberAvatar{width:36px;height:36px;min-width:36px;display:grid;place-items:center;border-radius:50%;background:linear-gradient(135deg,#376bf3,#22ba9e);color:#fff;font-size:10.5px;font-weight:800}
body.cc474-chat .memberMeta{min-width:0;flex:1}
body.cc474-chat .memberMeta strong{display:block;font-size:12.5px;color:#173652;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body.cc474-chat .memberMeta span{display:block;margin-top:2px;font-size:9.5px;color:#718399;font-weight:700}
body.cc474-chat .emptyInfo{display:flex;flex-direction:column;gap:4px;padding:14px;border:1px dashed #d5e0ec;border-radius:13px;background:linear-gradient(135deg,#f9fbff,#f5f0ff)}
body.cc474-chat .emptyInfo strong{font-size:13px;color:#203c5b}
body.cc474-chat .emptyInfo span{font-size:11px;line-height:1.4;color:#738398}
body.cc474-chat .settingsPanel{display:grid;gap:10px}
body.cc474-chat .settingsBlock{padding:10px;border:1px solid #dce4ef;border-radius:13px;background:rgba(255,255,255,.9)}
body.cc474-chat .settingsTitle{margin-bottom:7px;font-size:12px;font-weight:800;color:#173652}
body.cc474-chat .settingsBlock .chatInput{min-height:38px;padding:8px 9px;font-size:11.5px;resize:vertical}
body.cc474-chat .settingsBlock button{margin-top:7px;margin-right:5px}
body.cc474-chat .reviewCard{margin-top:7px;padding:9px;border:1px solid #e0e6f0;border-radius:11px;background:#fff}
body.cc474-chat .reviewBody{font-size:12.5px}

@media(max-width:1320px){
  body.cc474-chat .teamsShell{grid-template-columns:238px minmax(0,1fr) 288px;gap:11px}
  body.cc474-chat .threadTitle{font-size:13px}
  body.cc474-chat .infoTabs button{font-size:10px}
}
@media(max-width:1180px){
  body.cc474-chat .teamsShell,body.cc474-chat .teamsShell.infoClosed{grid-template-columns:226px minmax(0,1fr)}
  body.cc474-chat .rightPanel{display:none}
}
@media(max-width:860px){
  body.cc474-chat .teamsShell,body.cc474-chat .teamsShell.infoClosed{grid-template-columns:1fr;height:calc(100dvh - 120px)}
  body.cc474-chat .teamsLeft{display:none}
  body.cc474-chat .chatBubble{max-width:88%}
}
@media(prefers-reduced-motion:reduce){body.cc474-chat .teamsShell *{transition:none!important;animation:none!important}}


/* CC26_477 — Team Chat only: Candidate-card colour language + balanced readable type + coloured composer. */
body.cc469-chat .teamsShell{
  grid-template-columns:268px minmax(0,1fr) 318px!important;
  gap:13px!important;
}
body.cc469-chat .teamsPanel{
  border:1px solid #d3e0f0!important;
  border-radius:18px!important;
  box-shadow:0 10px 26px rgba(38,63,109,.07)!important;
}

/* Left: readable, no chopped names; use the same vivid card palette as Candidates summary cards. */
body.cc469-chat .teamsLeft{
  padding:14px!important;
  background:linear-gradient(180deg,#fafdff 0%,#f2f7ff 46%,#eefbff 100%)!important;
}
body.cc469-chat .teamsTopActions::before{font-size:18px!important;font-weight:800!important;color:#14365d!important}
body.cc469-chat .teamsSearch{
  height:43px!important;
  padding:0 13px!important;
  font-size:13.5px!important;
  font-weight:600!important;
  background:#fff!important;
  border:1px solid #bfd3eb!important;
}
body.cc469-chat .teamsTabs{
  display:grid!important;
  grid-template-columns:repeat(4,minmax(0,1fr))!important;
  gap:4px!important;
  padding:5px!important;
  background:#eaf2ff!important;
  border-color:#cfdcf0!important;
}
body.cc469-chat .teamsTabs button{
  min-width:0!important;
  height:34px!important;
  padding:0 3px!important;
  font-size:11.5px!important;
  font-weight:700!important;
  white-space:nowrap!important;
  color:#315171!important;
}
body.cc469-chat .teamsTabs button.active{
  background:linear-gradient(135deg,#3776ff,#6357f6)!important;
  color:#fff!important;
  box-shadow:0 6px 14px rgba(65,93,226,.22)!important;
}
body.cc469-chat .teamsSectionTitle{font-size:10.5px!important;font-weight:800!important;color:#55708f!important}
body.cc469-chat .threadBtn,body.cc469-chat .personBtn{
  min-height:54px!important;
  padding:8px 10px!important;
  gap:10px!important;
  margin-bottom:7px!important;
  border-radius:13px!important;
  border:0!important;
  box-shadow:0 5px 13px rgba(30,61,110,.07)!important;
}
body.cc469-chat .threadBtn.active{
  background:linear-gradient(135deg,#3776ff 0%,#5b55f4 58%,#7a45ef 100%)!important;
}
body.cc469-chat .threadBtn.active .threadTitle,
body.cc469-chat .threadBtn.active .cc469-thread-sub{color:#fff!important;-webkit-text-fill-color:#fff!important}
body.cc469-chat .personBtn:nth-of-type(4n+1){background:linear-gradient(135deg,#4d8dff,#6bb6ff)!important}
body.cc469-chat .personBtn:nth-of-type(4n+2){background:linear-gradient(135deg,#1ab28d,#65d66b)!important}
body.cc469-chat .personBtn:nth-of-type(4n+3){background:linear-gradient(135deg,#00a7d8,#58d4ff)!important}
body.cc469-chat .personBtn:nth-of-type(4n){background:linear-gradient(135deg,#6a67ff,#8b67ff)!important}
body.cc469-chat .personBtn .threadTitle,
body.cc469-chat .personBtn .rolePill{color:#fff!important;-webkit-text-fill-color:#fff!important}
body.cc469-chat .personBtn .rolePill{
  flex:0 0 auto!important;
  max-width:58px!important;
  padding:4px 6px!important;
  font-size:8.5px!important;
  font-weight:800!important;
  overflow:hidden!important;
  text-overflow:ellipsis!important;
  white-space:nowrap!important;
  background:rgba(255,255,255,.20)!important;
  border:1px solid rgba(255,255,255,.28)!important;
}
body.cc469-chat .threadMain{min-width:0!important}
body.cc469-chat .threadTitle{
  font-size:14px!important;
  line-height:1.25!important;
  font-weight:800!important;
  white-space:normal!important;
  overflow:visible!important;
  text-overflow:clip!important;
  word-break:normal!important;
}
body.cc469-chat .personBtn .listAvatar,
body.cc469-chat .personBtn .cc469-list-avatar{
  width:38px!important;height:38px!important;min-width:38px!important;flex:0 0 38px!important;
  background:rgba(255,255,255,.22)!important;
  border:1px solid rgba(255,255,255,.32)!important;
  color:#fff!important;
  box-shadow:none!important;
}

/* Centre: colorful but readable, matching Candidate card saturation. */
body.cc469-chat .chatMain{background:#fff!important}
body.cc469-chat .teamsChatHeader{
  min-height:76px!important;
  padding:12px 17px!important;
  background:linear-gradient(120deg,#3d80ff 0%,#625cf6 50%,#9b4ee7 100%)!important;
  border-bottom:0!important;
}
body.cc469-chat .chatTitleRow::before{
  background:rgba(255,255,255,.19)!important;
  border:1px solid rgba(255,255,255,.30)!important;
  box-shadow:none!important;
}
body.cc469-chat .chatTitleRow .panel-title,
body.cc469-chat .chat-room-title{font-size:18px!important;font-weight:800!important;color:#fff!important;-webkit-text-fill-color:#fff!important}
body.cc469-chat .cc470-head-avatar,
body.cc469-chat .cc470-head-btn{
  background:rgba(255,255,255,.18)!important;
  border-color:rgba(255,255,255,.30)!important;
  color:#fff!important;
  -webkit-text-fill-color:#fff!important;
  box-shadow:none!important;
}
body.cc469-chat .chatFeed{
  padding:18px 22px 15px!important;
  background:radial-gradient(circle at 15% 10%,rgba(77,141,255,.10),transparent 24%),radial-gradient(circle at 90% 18%,rgba(26,178,141,.08),transparent 23%),linear-gradient(180deg,#ffffff 0%,#f7fbff 100%)!important;
}
body.cc469-chat .dateDivider{font-size:11.5px!important;font-weight:700!important;color:#607895!important}
body.cc469-chat .chatBubble{
  max-width:min(74%,680px)!important;
  padding:11px 14px!important;
  border:1px solid #dce6f2!important;
  background:#fff!important;
  box-shadow:0 7px 18px rgba(29,54,92,.075)!important;
}
body.cc469-chat .chatBody{font-size:15px!important;line-height:1.55!important;font-weight:600!important;color:#173553!important}
body.cc469-chat .chatMeta strong{font-size:12.5px!important;font-weight:800!important}
body.cc469-chat .chatMeta span{font-size:10.5px!important}
body.cc469-chat .chatRow.mine .chatBubble{
  background:linear-gradient(135deg,#3776ff 0%,#5c59f4 52%,#8248e8 100%)!important;
  border-color:transparent!important;
  box-shadow:0 10px 22px rgba(74,76,222,.22)!important;
}
body.cc469-chat .chatRow.mine .chatBody,
body.cc469-chat .chatRow.mine .chatMeta strong,
body.cc469-chat .chatRow.mine .chatMeta span,
body.cc469-chat .chatRow.mine .messageMenu summary{
  color:#fff!important;
  -webkit-text-fill-color:#fff!important;
  text-shadow:0 1px 2px rgba(0,0,0,.18)!important;
}

/* Typing box: intentionally coloured, not plain white. */
body.cc469-chat .composer{
  padding:12px 13px!important;
  background:linear-gradient(90deg,#eaf3ff 0%,#eef7ff 33%,#f2edff 68%,#eefcff 100%)!important;
  border-top:1px solid #cbdcf0!important;
}
body.cc469-chat .composeBox{
  min-height:62px!important;
  border:1px solid #8eb3f3!important;
  border-radius:18px!important;
  background:linear-gradient(135deg,#dcecff 0%,#e8f4ff 43%,#eee5ff 100%)!important;
  box-shadow:0 8px 20px rgba(64,92,158,.12)!important;
}
body.cc469-chat .composeBox textarea{
  font-size:15px!important;
  font-weight:650!important;
  color:#163d67!important;
  -webkit-text-fill-color:#163d67!important;
}
body.cc469-chat .composeBox textarea::placeholder{color:#456a91!important;opacity:.9!important}
body.cc469-chat .cc469-emoji-toggle{
  background:#fff!important;
  color:#4b65dd!important;
  border-color:#c8d7ed!important;
}
body.cc469-chat .sendBtn{
  width:46px!important;height:46px!important;min-width:46px!important;
  background:linear-gradient(135deg,#3776ff,#6855f1 58%,#a143dd)!important;
  box-shadow:0 8px 17px rgba(83,75,220,.24)!important;
}

/* Right info cards: exactly the Candidates-card visual language — vivid gradients + white readable text. */
body.cc469-chat .rightPanel{
  padding:14px!important;
  background:linear-gradient(180deg,#fafdff 0%,#f4f8ff 54%,#f3fbff 100%)!important;
}
body.cc469-chat .profileHero .panel-title{font-size:16px!important;font-weight:800!important;color:#15385e!important}
body.cc469-chat .cc469-info-hero{
  padding:13px!important;
  background:linear-gradient(135deg,#4d8dff,#6a67ff)!important;
  border:0!important;
  box-shadow:0 7px 18px rgba(70,90,218,.16)!important;
}
body.cc469-chat .cc469-info-hash{background:rgba(255,255,255,.20)!important;border:1px solid rgba(255,255,255,.28)!important}
body.cc469-chat .cc469-info-hero h3{font-size:15px!important;font-weight:800!important;color:#fff!important;-webkit-text-fill-color:#fff!important}
body.cc469-chat .cc469-info-tabs{
  gap:5px!important;
  padding:5px!important;
  background:#e8f0ff!important;
  border-color:#cad8ec!important;
}
body.cc469-chat .cc469-info-tabs button{height:35px!important;font-size:11.5px!important;font-weight:750!important;color:#34516f!important}
body.cc469-chat .cc469-info-tabs button.active,
body.cc469-chat .cc469-info-tabs button[aria-pressed="true"]{
  background:linear-gradient(135deg,#3776ff,#6758f2)!important;
  color:#fff!important;
}
body.cc469-chat .sideList{grid-template-columns:1fr 1fr!important;gap:9px!important}
body.cc469-chat .sideItem.cardish{
  min-height:76px!important;
  padding:11px!important;
  border:0!important;
  border-radius:14px!important;
  font-size:11.5px!important;
  font-weight:800!important;
  color:#fff!important;
  -webkit-text-fill-color:#fff!important;
  box-shadow:0 7px 17px rgba(30,59,104,.10)!important;
}
body.cc469-chat .sideItem.cardish span{color:#fff!important;-webkit-text-fill-color:#fff!important}
body.cc469-chat .sideItem.cardish span:last-child{font-size:19px!important;font-weight:850!important}
body.cc469-chat .sideItem.cardish:nth-child(1){background:linear-gradient(135deg,#4d8dff,#6bb6ff)!important}
body.cc469-chat .sideItem.cardish:nth-child(2){background:linear-gradient(135deg,#1ab28d,#65d66b)!important}
body.cc469-chat .sideItem.cardish:nth-child(3){background:linear-gradient(135deg,#ff8a4c,#ffb25e)!important}
body.cc469-chat .sideItem.cardish:nth-child(4){background:linear-gradient(135deg,#ff4b8b,#ff7f6f)!important}
body.cc469-chat .sideItem.cardish:nth-child(5){
  grid-column:1/-1!important;
  min-height:42px!important;
  flex-direction:row!important;
  align-items:center!important;
  justify-content:space-between!important;
  background:linear-gradient(135deg,#6a67ff,#9b61f4)!important;
}
body.cc469-chat .sideItem.cardish:nth-child(5) span:last-child{font-size:12px!important}
body.cc469-chat .cc470-member-row{background:#fff!important;border-color:#d7e2ef!important}
body.cc469-chat .cc470-member-meta strong{font-size:13.5px!important}
body.cc469-chat .cc470-member-meta span{font-size:10.5px!important}

/* Keep Team Chat usable on narrower desktop windows without shrinking text to unreadable sizes. */
@media(max-width:1320px){
  body.cc469-chat .teamsShell{grid-template-columns:250px minmax(0,1fr) 296px!important;gap:11px!important}
  body.cc469-chat .threadTitle{font-size:13.5px!important}
  body.cc469-chat .cc469-info-tabs button{font-size:10.8px!important}
}
@media(max-width:1180px){
  body.cc469-chat .teamsShell{grid-template-columns:236px minmax(0,1fr)!important}
  body.cc469-chat .rightPanel{display:none!important}
}


/* CC26_482 SOURCE PARITY — mirrors deployed Team Chat runtime palette. */
/* CC26_482 — TEAM CHAT PREMIUM PASTEL + DARK READABLE TEXT                    */
/* Scope: /chat only. No other CRM page is changed.                           */
/* ========================================================================== */
body.cc474-chat{
  --cc482-ink:#163a5d;
  --cc482-muted:#55708d;
  --cc482-blue:#e8f2ff;
  --cc482-mint:#e8faf3;
  --cc482-lilac:#f1ebff;
  --cc482-peach:#fff1e5;
  --cc482-cyan:#e8f9ff;
  --cc482-line:#d7e3f0;
}
body.cc474-chat .teamsPanel{background:linear-gradient(180deg,#ffffff,#f9fcff)!important;border-color:var(--cc482-line)!important;box-shadow:0 12px 28px rgba(41,66,105,.07)!important}
body.cc474-chat .teamsLeft{background:linear-gradient(180deg,#fbfdff 0%,#f4f9ff 100%)!important}
body.cc474-chat .teamsSearch{background:linear-gradient(135deg,#f3f8ff,#f7f4ff)!important;border-color:#cfdff0!important;color:var(--cc482-ink)!important}
body.cc474-chat .teamsTabs{background:linear-gradient(135deg,#eef5ff,#f5efff 52%,#eefbff)!important;border-color:#d8e4f0!important}
body.cc474-chat .teamsTabs button{background:transparent!important;color:#496781!important;-webkit-text-fill-color:#496781!important}
body.cc474-chat .teamsTabs button.active{background:linear-gradient(135deg,#d7e8ff,#e8ddff 56%,#dcf6ff)!important;color:#294f86!important;-webkit-text-fill-color:#294f86!important;box-shadow:0 5px 12px rgba(73,91,145,.10)!important}

/* Channel + person cards stay colorful, but never use white text on light cards. */
body.cc474-chat .threadBtn,
body.cc474-chat .personBtn{
  border:1px solid #dce7f2!important;
  background:linear-gradient(135deg,#f8fbff,#f3f8ff)!important;
  color:var(--cc482-ink)!important;
  box-shadow:0 5px 14px rgba(39,67,107,.055)!important;
  transition:transform .12s ease,box-shadow .12s ease,border-color .12s ease,background .12s ease!important;
}
body.cc474-chat .threadBtn:hover,
body.cc474-chat .personBtn:hover{transform:translateY(-1px)!important;border-color:#c4d8ed!important;box-shadow:0 8px 18px rgba(39,67,107,.08)!important}
body.cc474-chat .threadBtn:nth-of-type(4n+1),body.cc474-chat .personBtn:nth-of-type(4n+1){background:linear-gradient(135deg,#e8f3ff,#f4f9ff)!important}
body.cc474-chat .threadBtn:nth-of-type(4n+2),body.cc474-chat .personBtn:nth-of-type(4n+2){background:linear-gradient(135deg,#e9faf3,#f5fff9)!important}
body.cc474-chat .threadBtn:nth-of-type(4n+3),body.cc474-chat .personBtn:nth-of-type(4n+3){background:linear-gradient(135deg,#fff1e6,#fff9f2)!important}
body.cc474-chat .threadBtn:nth-of-type(4n),body.cc474-chat .personBtn:nth-of-type(4n){background:linear-gradient(135deg,#f0ebff,#faf6ff)!important}
body.cc474-chat .threadBtn.active,
body.cc474-chat .personBtn.active,
body.cc474-chat .threadBtn.cc482-instant-active,
body.cc474-chat .personBtn.cc482-instant-active{
  background:linear-gradient(135deg,#dcecff 0%,#ebe4ff 54%,#e2f8ff 100%)!important;
  border-color:#b8cfee!important;
  box-shadow:0 7px 18px rgba(70,89,145,.10)!important;
  transform:none!important;
}
body.cc474-chat .threadBtn .threadTitle,
body.cc474-chat .personBtn .threadTitle,
body.cc474-chat .threadBtn.active .threadTitle,
body.cc474-chat .personBtn.active .threadTitle,
body.cc474-chat .threadBtn.cc482-instant-active .threadTitle,
body.cc474-chat .personBtn.cc482-instant-active .threadTitle{
  color:#173a5d!important;
  -webkit-text-fill-color:#173a5d!important;
  text-shadow:none!important;
}
body.cc474-chat .threadBtn .cc469-thread-sub,
body.cc474-chat .personBtn .cc469-thread-sub{color:#617b96!important;-webkit-text-fill-color:#617b96!important;text-shadow:none!important}
body.cc474-chat .personBtn .rolePill,
body.cc474-chat .personBtn.active .rolePill,
body.cc474-chat .personBtn.cc482-instant-active .rolePill{
  background:rgba(255,255,255,.72)!important;
  border:1px solid #cad9ea!important;
  color:#53649c!important;
  -webkit-text-fill-color:#53649c!important;
}
body.cc474-chat .personBtn .listAvatar,body.cc474-chat .personBtn .cc469-list-avatar{color:#173a5d!important;-webkit-text-fill-color:#173a5d!important;border-color:rgba(255,255,255,.72)!important}
body.cc474-chat .personBtn:nth-of-type(4n+1) .listAvatar{background:linear-gradient(135deg,#b9dcff,#c7ecff)!important}
body.cc474-chat .personBtn:nth-of-type(4n+2) .listAvatar{background:linear-gradient(135deg,#bcebdc,#d0f3e7)!important}
body.cc474-chat .personBtn:nth-of-type(4n+3) .listAvatar{background:linear-gradient(135deg,#ffd8b7,#ffe8cc)!important}
body.cc474-chat .personBtn:nth-of-type(4n) .listAvatar{background:linear-gradient(135deg,#d6c8ff,#ead8ff)!important}

/* Header and controls: premium color without dense dark blocks. */
body.cc474-chat .teamsChatHeader{background:linear-gradient(110deg,#e8f2ff 0%,#f0eaff 48%,#e8f9ff 100%)!important;border-bottom:1px solid #dce6f1!important}
body.cc474-chat .chatTitleRow::before{background:linear-gradient(135deg,#bfd8ff,#d5c5ff)!important;color:#3e5d98!important;-webkit-text-fill-color:#3e5d98!important;border:1px solid #b9cae8!important}
body.cc474-chat .teamsChatHeader .chatTitleRow .panel-title,
body.cc474-chat .teamsChatHeader .chat-room-title{color:#173a5d!important;-webkit-text-fill-color:#173a5d!important;text-shadow:none!important}
body.cc474-chat .cc470-head-avatar{color:#173a5d!important;-webkit-text-fill-color:#173a5d!important;border-color:rgba(255,255,255,.85)!important}
body.cc474-chat .cc470-head-btn{background:linear-gradient(135deg,#f6f9ff,#f2f7ff)!important;color:#405f7e!important;-webkit-text-fill-color:#405f7e!important;border-color:#d6e2ef!important}

/* Message bubbles: light, colorful and high contrast. */
body.cc474-chat .chatBubble{background:linear-gradient(135deg,#ffffff,#f7fbff)!important;border-color:#dce7f2!important;color:#173a5d!important}
body.cc474-chat .chatRow.mine .chatBubble{background:linear-gradient(135deg,#deebff,#ebe5ff 56%,#e4f7ff)!important;border-color:#c6d8ee!important;color:#173a5d!important}
body.cc474-chat .chatRow.mine .chatBody,
body.cc474-chat .chatRow.mine .chatMeta,
body.cc474-chat .chatRow.mine .chatMeta strong,
body.cc474-chat .chatRow.mine .chatMeta span,
body.cc474-chat .chatRow.mine .messageMenu summary{color:#173a5d!important;-webkit-text-fill-color:#173a5d!important;text-shadow:none!important}
body.cc474-chat .messageMenuPopup{background:linear-gradient(135deg,#fbfdff,#f5f8ff)!important;border-color:#d7e3ef!important}
body.cc474-chat .tinyBtn{background:#eef5ff!important;color:#31597e!important;border-color:#ccddef!important}
body.cc474-chat .miniBlue{background:linear-gradient(135deg,#d9e9ff,#e5ddff)!important;color:#314f91!important;-webkit-text-fill-color:#314f91!important;border:1px solid #c7d5ed!important}

/* Composer: intentionally non-white and instantly readable. */
body.cc474-chat .composer{background:linear-gradient(90deg,#edf5ff,#f4efff 58%,#edfaff)!important;border-top-color:#d8e4ef!important}
body.cc474-chat .composeBox{background:linear-gradient(135deg,#e9f3ff,#f1ecff 58%,#eaf9ff)!important;border-color:#c8d9eb!important;box-shadow:0 6px 16px rgba(48,76,119,.06)!important}
body.cc474-chat .cc469-emoji-toggle{background:linear-gradient(135deg,#e6f1ff,#efe9ff)!important;color:#5261a6!important;border-color:#cbd9e9!important}
body.cc474-chat .sendBtn{background:linear-gradient(135deg,#b7d2ff,#d4c2ff)!important;box-shadow:0 6px 14px rgba(87,95,153,.13)!important}
body.cc474-chat .sendBtn::after{color:#344f89!important;-webkit-text-fill-color:#344f89!important}

/* Right panel: remove the remaining plain-white option cards. */
body.cc474-chat .rightPanel{background:linear-gradient(180deg,#fafdff,#f5f9ff 52%,#f1faff)!important}
body.cc474-chat .profileHero{background:linear-gradient(135deg,#eef5ff,#f6efff)!important;border-color:#d8e4f0!important}
body.cc474-chat .cc469-info-hero{background:linear-gradient(135deg,#e9f3ff,#f2ebff 55%,#eaf9ff)!important;border:1px solid #d4e0ed!important}
body.cc474-chat .cc469-info-hash{background:linear-gradient(135deg,#bfd8ff,#d7c8ff)!important;color:#35578d!important;-webkit-text-fill-color:#35578d!important;border-color:#bfcfe5!important}
body.cc474-chat .cc469-info-hero h3{color:#173a5d!important;-webkit-text-fill-color:#173a5d!important}
body.cc474-chat .cc469-info-tabs{background:linear-gradient(135deg,#eaf3ff,#f3edff 54%,#eafaff)!important;border-color:#d6e2ee!important}
body.cc474-chat .cc469-info-tabs button{color:#4f6984!important;-webkit-text-fill-color:#4f6984!important}
body.cc474-chat .cc469-info-tabs button.active,
body.cc474-chat .cc469-info-tabs button[aria-pressed="true"]{background:linear-gradient(135deg,#d6e8ff,#e6dcff 58%,#dcf6ff)!important;color:#2f5289!important;-webkit-text-fill-color:#2f5289!important;box-shadow:0 4px 10px rgba(69,88,143,.09)!important}
body.cc474-chat .sideItem.cardish{border:1px solid #d8e4ef!important;box-shadow:0 6px 15px rgba(42,69,105,.055)!important}
body.cc474-chat .cc470-member-row{background:linear-gradient(135deg,#eef5ff,#eefbf7)!important;border-color:#d6e5ef!important}
body.cc474-chat .cc470-empty-box,body.cc474-chat .mutedBox{background:linear-gradient(135deg,#f2f7ff,#f7f3ff)!important;border-color:#dce6f0!important;color:#526d88!important}
body.cc474-chat .rightPanel .chatInput{background:linear-gradient(135deg,#f2f7ff,#f7f3ff)!important;border-color:#d3e0ec!important;color:#244866!important}
body.cc474-chat .reviewCard{background:linear-gradient(135deg,#fff7ec,#fffaf5)!important;border-color:#efdfcb!important}

/* Never let selected light Team Chat controls inherit white text from old rules. */
body.cc474-chat .personBtn.active *,body.cc474-chat .threadBtn.active .threadTitle,
body.cc474-chat .cc482-instant-active *{text-shadow:none!important}


/* CC26_487 — native Team Chat owns the final UI. No delayed DOM repaint. */
body.cc474-chat .teamsShell{font-family:"Plus Jakarta Sans","Segoe UI",Arial,sans-serif!important}
body.cc474-chat .teamsPanel{background:linear-gradient(180deg,#fbfdff 0%,#f7fbff 100%)!important;border:1px solid #d7e5f2!important;box-shadow:0 10px 28px rgba(34,64,104,.06)!important}
body.cc474-chat .teamsLeft{background:linear-gradient(180deg,#fbfdff 0%,#f7fbff 52%,#f8fcfb 100%)!important}
body.cc474-chat .teamsPanelTitle{font-size:18px!important;color:#153a60!important}
body.cc474-chat .teamsSearch{font-size:13px!important;background:linear-gradient(135deg,#f7fbff,#fbf8ff)!important}
body.cc474-chat .teamsTabs button{font-size:12px!important;font-weight:750!important}
body.cc474-chat .teamsSectionTitle{font-size:11.5px!important;letter-spacing:.035em!important}
body.cc474-chat .threadBtn,body.cc474-chat .personBtn{min-height:48px!important;border-radius:13px!important}
body.cc474-chat .threadTitle{font-size:13.5px!important;font-weight:800!important;color:#173a5d!important;-webkit-text-fill-color:#173a5d!important}
body.cc474-chat .rolePill{font-size:9px!important;font-weight:800!important;color:#375a7b!important;-webkit-text-fill-color:#375a7b!important;background:rgba(255,255,255,.72)!important}
body.cc474-chat .threadBtn.active,body.cc474-chat .personBtn.active{background:linear-gradient(135deg,#dff0ff 0%,#e7f8f1 52%,#f2eaff 100%)!important;border-color:#bcd8ef!important;box-shadow:0 8px 18px rgba(57,94,137,.08)!important}
body.cc474-chat .threadBtn.active .threadTitle,body.cc474-chat .personBtn.active .threadTitle{color:#123c61!important;-webkit-text-fill-color:#123c61!important}

body.cc474-chat .teamsChatHeader{position:relative!important;overflow:visible!important;background:linear-gradient(110deg,#eaf4ff 0%,#f3edff 48%,#e9fbff 100%)!important;border-bottom:1px solid #d7e4ef!important;min-height:58px!important}
body.cc474-chat .chat-room-title{font-size:18px!important;font-weight:850!important;color:#173a5d!important;-webkit-text-fill-color:#173a5d!important}
body.cc474-chat .roomHash{background:linear-gradient(135deg,#8fa7ff,#a995ff)!important;color:#fff!important}
body.cc474-chat .headToolBtn{font-size:13px!important;color:#3f5d78!important;background:rgba(255,255,255,.76)!important;border-color:#d5e1ec!important}
body.cc474-chat .headToolBtn.active{background:linear-gradient(135deg,#dcecff,#ede4ff)!important;color:#234f7d!important}
body.cc474-chat .channelMenuWrap{position:relative;display:inline-flex;z-index:40}
body.cc474-chat .channelMenuPopover{position:absolute;right:0;top:42px;width:190px;padding:7px;border:1px solid #d6e3ef;border-radius:14px;background:rgba(255,255,255,.98);box-shadow:0 18px 42px rgba(34,58,94,.16);z-index:100}
body.cc474-chat .channelMenuItem{width:100%;min-height:39px;border:0;border-radius:10px;background:transparent;display:flex;align-items:center;gap:9px;padding:8px 10px;color:#264963;font-size:12.5px;text-align:left;cursor:pointer}
body.cc474-chat .channelMenuItem:hover{background:linear-gradient(135deg,#edf6ff,#f5efff)}
body.cc474-chat .channelMenuItem.rename{background:linear-gradient(135deg,#e8f7ef,#edf8ff)}
body.cc474-chat .channelMenuItem span{width:22px;height:22px;display:grid;place-items:center;border-radius:7px;background:#fff;border:1px solid #dce8f1}
body.cc474-chat .renamePopover{position:absolute;top:56px;right:10px;z-index:90;width:min(440px,calc(100% - 20px));padding:12px;border:1px solid #cae0ed;border-radius:15px;background:linear-gradient(135deg,#f8fcff,#f8f4ff);box-shadow:0 18px 42px rgba(34,58,94,.15)}
body.cc474-chat .renamePopoverLabel{font-size:12.5px;font-weight:850;color:#244967;margin-bottom:7px}
body.cc474-chat .renamePopoverRow{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:8px;align-items:center}
body.cc474-chat .renameQuickInput{height:39px!important;font-size:13px!important;background:#fff!important}
body.cc474-chat .renameSaveBtn,body.cc474-chat .renameCancelBtn{height:39px!important;padding:0 13px!important;font-size:11.5px!important;border-radius:10px!important}

body.cc474-chat .chatFeed{background:radial-gradient(circle at 14% 12%,rgba(112,159,233,.05),transparent 28%),radial-gradient(circle at 88% 18%,rgba(131,207,185,.05),transparent 28%),linear-gradient(180deg,#fff,#fbfdff)!important}
body.cc474-chat .chatBody{font-size:14.5px!important;line-height:1.5!important;color:#173a5d!important}
body.cc474-chat .chatMeta strong{font-size:12px!important}.chatMeta span{font-size:10px!important}
body.cc474-chat .composer{background:linear-gradient(90deg,#edf6ff 0%,#f5efff 55%,#edfaff 100%)!important}
body.cc474-chat .composeBox textarea{font-size:13.5px!important;color:#173a5d!important}

body.cc474-chat .rightPanel{background:linear-gradient(180deg,#fbfdff 0%,#f7fbff 55%,#f7fcfb 100%)!important}
body.cc474-chat .profileHero .panel-title{font-size:16px!important;font-weight:850!important;color:#173a5d!important}
body.cc474-chat .infoHero h3{font-size:14px!important;font-weight:850!important;color:#173a5d!important}
body.cc474-chat .infoTabs button{font-size:11.5px!important;font-weight:800!important;color:#45627d!important;min-height:34px!important}
body.cc474-chat .infoTabs button.active{background:linear-gradient(135deg,#dfeeff,#ede4ff)!important;color:#244f7b!important}
body.cc474-chat .infoCardGrid{display:grid!important;grid-template-columns:1fr 1fr!important;gap:9px!important}
body.cc474-chat .infoCard{min-height:68px!important;padding:10px!important;border-radius:13px!important;text-align:left!important;border:1px solid #d7e5ef!important;box-shadow:0 6px 16px rgba(37,63,96,.05)!important}
body.cc474-chat .infoCard.blue{background:linear-gradient(135deg,#e9f4ff,#f1f7ff)!important}
body.cc474-chat .infoCard.mint{background:linear-gradient(135deg,#e9faf3,#f2fff9)!important}
body.cc474-chat .infoCard.orange{background:linear-gradient(135deg,#fff2e8,#fff8f1)!important}
body.cc474-chat .infoCard.violet{background:linear-gradient(135deg,#f2edff,#faf6ff)!important}
body.cc474-chat .infoCard.gold{background:linear-gradient(135deg,#fff7dc,#fffaf0)!important}
body.cc474-chat .infoCard.wide{grid-column:1/-1!important;min-height:54px!important;display:flex!important;align-items:center!important;justify-content:space-between!important}
body.cc474-chat .infoCard span{font-size:11.5px!important;font-weight:800!important;color:#3b5872!important}
body.cc474-chat .infoCard strong{font-size:18px!important;font-weight:900!important;color:#173a5d!important;margin-top:5px!important}
body.cc474-chat .infoCard.wide strong{font-size:12px!important;margin-top:0!important}
body.cc474-chat .settingsTitle{font-size:13.5px!important;font-weight:850!important;color:#173a5d!important}
body.cc474-chat .settingsBlock .chatInput{font-size:12.5px!important;min-height:40px!important}
body.cc474-chat .settingsBlock button{font-size:11.5px!important}
body.cc474-chat .mutedBox,body.cc474-chat .emptyInfo span{font-size:11.5px!important;line-height:1.45!important}
body.cc474-chat .emptyInfo strong{font-size:13.5px!important}

@media(max-width:1180px){body.cc474-chat .rightPanel{display:none!important}}


/* CC26_489 — ARIA automatic 30-minute report bubble */
body.cc469-chat .chatRow.ariaReportRow .chatBubble{max-width:min(86%,760px);background:linear-gradient(135deg,#e8fbf2 0%,#eef7ff 50%,#f4efff 100%)!important;border:1px solid #cde6dc!important;box-shadow:0 10px 24px rgba(50,102,84,.10)!important}
body.cc469-chat .chatRow.ariaReportRow .chatBody.ariaReportBody{white-space:pre-line;font-size:14px!important;line-height:1.58!important;font-weight:650!important;color:#173a5d!important}
body.cc469-chat .ariaReportOpen{margin-top:9px;min-height:36px;border:1px solid #bad9ca;border-radius:11px;padding:7px 12px;background:linear-gradient(135deg,#c9f0dc,#dcecff 58%,#e8dcff);color:#1f5b45;font-size:12.5px;font-weight:900;cursor:pointer}
body.cc469-chat .ariaReportOpen:hover{transform:translateY(-1px);box-shadow:0 7px 16px rgba(62,110,92,.12)}

/* CC26_490 — requested Team Chat-only refinements: manager green card + readable ARIA report table. */
body.cc474-chat .personBtn.personBtnManager,
body.cc474-chat .personBtn.personBtnManager:hover,
body.cc474-chat .personBtn.personBtnManager.active,
body.cc474-chat .personBtn.personBtnManager.cc482-instant-active{
  background:linear-gradient(135deg,#dff8ea 0%,#c9f2df 48%,#e9f8d9 100%)!important;
  border-color:#addfc7!important;
  box-shadow:0 7px 18px rgba(42,122,86,.09)!important;
}
body.cc474-chat .personBtn.personBtnManager .listAvatar,
body.cc474-chat .personBtn.personBtnManager .personAvatar{
  background:linear-gradient(135deg,#9fe0be,#c9efad)!important;
  color:#155a3a!important;-webkit-text-fill-color:#155a3a!important;
}
body.cc474-chat .personBtn.personBtnManager .threadTitle{color:#174f39!important;-webkit-text-fill-color:#174f39!important}
body.cc474-chat .personBtn.personBtnManager .rolePill{
  background:rgba(255,255,255,.72)!important;border-color:#9fd8ba!important;
  color:#1b6948!important;-webkit-text-fill-color:#1b6948!important;
}
body.cc474-chat .chatRow.ariaReportRow .chatBody.ariaReportBody{white-space:normal!important}
body.cc474-chat .ariaSheet{overflow:hidden;border:1px solid #bdd8cf;border-radius:12px;background:#fff;box-shadow:0 6px 16px rgba(48,86,75,.07)}
body.cc474-chat .ariaSheetHead{padding:9px 11px;background:linear-gradient(135deg,#dff7eb,#e5f2ff 58%,#eee7ff);border-bottom:1px solid #c9dfd7}
body.cc474-chat .ariaSheetTitle{font-size:12.5px;font-weight:1000;color:#174b3a!important;-webkit-text-fill-color:#174b3a!important}
body.cc474-chat .ariaSheetMetrics{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:1px;background:#d8e5e0;border-bottom:1px solid #d1e0db}
body.cc474-chat .ariaSheetMetric{min-width:0;padding:7px 6px;background:#f7fbfa;text-align:center}
body.cc474-chat .ariaSheetMetric span{display:block;font-size:8.5px;font-weight:900;color:#617b75!important;-webkit-text-fill-color:#617b75!important;text-transform:uppercase;letter-spacing:.03em;white-space:nowrap}
body.cc474-chat .ariaSheetMetric strong{display:block;margin-top:2px;font-size:13px;font-weight:1000;color:#173a5d!important;-webkit-text-fill-color:#173a5d!important}
body.cc474-chat .ariaSheetTableWrap{max-height:330px;overflow:auto;background:#fff}
body.cc474-chat .ariaSheetTable{width:100%;min-width:760px;border-collapse:collapse;font-size:11.5px;color:#183d54}
body.cc474-chat .ariaSheetTable th{position:sticky;top:0;z-index:1;padding:7px 8px;border-right:1px solid #d8e4df;border-bottom:1px solid #c8d8d2;background:#eaf4f0;color:#355f52!important;-webkit-text-fill-color:#355f52!important;font-size:9px;font-weight:1000;text-transform:uppercase;letter-spacing:.02em;text-align:center}
body.cc474-chat .ariaSheetTable th:nth-child(2){text-align:left}
body.cc474-chat .ariaSheetTable td{padding:7px 8px;border-right:1px solid #e2ece8;border-bottom:1px solid #e1ebe7;text-align:center;background:#fff;color:#254a5f!important;-webkit-text-fill-color:#254a5f!important;font-weight:750}
body.cc474-chat .ariaSheetTable tr:nth-child(even) td{background:#f8fbfa}
body.cc474-chat .ariaSheetTable td.ariaSheetName{text-align:left;font-weight:900;color:#173a5d!important;-webkit-text-fill-color:#173a5d!important}
body.cc474-chat .ariaSheetEmpty{padding:12px;font-size:11.5px;font-weight:800;color:#607a72!important;-webkit-text-fill-color:#607a72!important}


/* CC26_495_SOURCE_CARD_MATCH */


/* ========================================================================== */
/* CC26_495 — Team Chat uses the SAME visual language as Hot Leads top cards  */
/* ========================================================================== */
body.cc469-chat .roomHash{display:none!important}
body.cc469-chat .chatTitleRow{gap:0!important}

/* Shared exact card formula from Hot Leads: strong gradient, white copy, 16px curve, soft card shadow. */
body.cc469-chat .teamsChatHeader,
body.cc469-chat .threadBtn.active,
body.cc469-chat .personBtn.cc492-role-manager,
body.cc469-chat .personBtn.cc492-role-tl,
body.cc469-chat .personBtn.cc492-role-recruiter,
body.cc469-chat .personBtn.cc492-role-assistant,
body.cc469-chat .cc490-aria-metric{
  opacity:1!important;
  filter:none!important;
  overflow:hidden!important;
  position:relative!important;
  border:0!important;
  border-radius:16px!important;
  box-shadow:0 10px 22px rgba(17,27,55,.12)!important;
}
body.cc469-chat .teamsChatHeader::before,
body.cc469-chat .threadBtn.active::before,
body.cc469-chat .personBtn.cc492-role-manager::before,
body.cc469-chat .personBtn.cc492-role-tl::before,
body.cc469-chat .personBtn.cc492-role-recruiter::before,
body.cc469-chat .personBtn.cc492-role-assistant::before,
body.cc469-chat .cc490-aria-metric::before{
  content:''!important;
  position:absolute!important;
  inset:auto -12% -46% auto!important;
  width:120px!important;
  height:58px!important;
  border-radius:999px!important;
  background:radial-gradient(circle at 50% 0,rgba(255,255,255,.42),rgba(255,255,255,.12) 46%,transparent 72%)!important;
  opacity:.78!important;
  pointer-events:none!important;
}
body.cc469-chat .personBtn.cc492-role-manager::after,
body.cc469-chat .personBtn.cc492-role-tl::after,
body.cc469-chat .personBtn.cc492-role-recruiter::after{display:none!important}

/* Room header = Hot Leads BLUE card. */
body.cc469-chat .teamsChatHeader{
  min-height:54px!important;
  padding:10px 14px!important;
  background:linear-gradient(135deg,#2563eb,#3b82f6,#8b5cf6)!important;
  border-radius:14px!important;
  box-shadow:0 12px 26px rgba(37,99,235,.20)!important;
}
body.cc469-chat .teamsChatHeader::after{display:none!important}
body.cc469-chat .teamsChatHeader .chat-room-title,
body.cc469-chat .teamsChatHeader .panel-title{
  color:#fff!important;-webkit-text-fill-color:#fff!important;
  font-weight:900!important;opacity:1!important;filter:none!important;text-shadow:0 1px 2px rgba(0,0,0,.18)!important;
}
body.cc469-chat .cc470-head-avatar,
body.cc469-chat .cc470-head-btn{
  border:1px solid rgba(255,255,255,.56)!important;
  color:#fff!important;-webkit-text-fill-color:#fff!important;
  box-shadow:0 6px 14px rgba(17,27,55,.16)!important;
  filter:none!important;opacity:1!important;
}
body.cc469-chat .cc470-head-avatar:nth-child(1){background:linear-gradient(135deg,#10b981,#22c55e,#84cc16)!important}
body.cc469-chat .cc470-head-avatar:nth-child(2){background:linear-gradient(135deg,#6366f1,#8b5cf6,#a855f7)!important}
body.cc469-chat .cc470-head-avatar:nth-child(3){background:linear-gradient(135deg,#0ea5e9,#22c7c7,#4ade80)!important}
body.cc469-chat .cc470-head-avatar.more{background:linear-gradient(135deg,#f97316,#fb923c,#ef4444)!important}
body.cc469-chat .cc470-head-btn{background:rgba(255,255,255,.18)!important}

/* Channel selected card = Hot Leads CYAN card. */
body.cc469-chat .threadBtn.active,
body.cc469-chat .threadBtn.active:hover{
  background:linear-gradient(135deg,#0ea5e9,#22c7c7,#4ade80)!important;
  box-shadow:0 12px 25px rgba(14,165,233,.22)!important;
}
body.cc469-chat .threadBtn.active .threadTitle,
body.cc469-chat .threadBtn.active *{
  color:#fff!important;-webkit-text-fill-color:#fff!important;opacity:1!important;text-shadow:0 1px 2px rgba(0,0,0,.16)!important;
}

/* PEOPLE hierarchy using the exact Hot Leads colors. */
/* Manager = blue/purple premium card */
body.cc469-chat .personBtn.cc492-role-manager,
body.cc469-chat .personBtn.cc492-role-manager:hover,
body.cc469-chat .personBtn.cc492-role-manager.active,
body.cc469-chat .personBtn.cc492-role-manager.cc482-instant-active{
  background:linear-gradient(135deg,#2563eb,#3b82f6,#8b5cf6)!important;
  box-shadow:0 12px 25px rgba(37,99,235,.22)!important;
}
/* TL = exact Hot Leads orange card */
body.cc469-chat .personBtn.cc492-role-tl,
body.cc469-chat .personBtn.cc492-role-tl:hover,
body.cc469-chat .personBtn.cc492-role-tl.active,
body.cc469-chat .personBtn.cc492-role-tl.cc482-instant-active{
  background:linear-gradient(135deg,#f97316,#fb923c,#ef4444)!important;
  box-shadow:0 12px 25px rgba(249,115,22,.22)!important;
}
/* Recruiter = exact Hot Leads pink card */
body.cc469-chat .personBtn.cc492-role-recruiter,
body.cc469-chat .personBtn.cc492-role-recruiter:hover,
body.cc469-chat .personBtn.cc492-role-recruiter.active,
body.cc469-chat .personBtn.cc492-role-recruiter.cc482-instant-active{
  background:linear-gradient(135deg,#ec4899,#f43f5e,#fb7185)!important;
  box-shadow:0 12px 25px rgba(236,72,153,.20)!important;
}
/* ARIA = exact Hot Leads green card */
body.cc469-chat .personBtn.cc492-role-assistant,
body.cc469-chat .personBtn.cc489-aria-contact{
  background:linear-gradient(135deg,#10b981,#22c55e,#84cc16)!important;
  box-shadow:0 12px 25px rgba(16,185,129,.20)!important;
}
body.cc469-chat .personBtn.cc492-role-manager .threadTitle,
body.cc469-chat .personBtn.cc492-role-tl .threadTitle,
body.cc469-chat .personBtn.cc492-role-recruiter .threadTitle,
body.cc469-chat .personBtn.cc492-role-assistant .threadTitle,
body.cc469-chat .personBtn.cc489-aria-contact .threadTitle{
  color:#fff!important;-webkit-text-fill-color:#fff!important;
  font-weight:900!important;opacity:1!important;filter:none!important;text-shadow:0 1px 2px rgba(0,0,0,.20)!important;
}
body.cc469-chat .personBtn.cc492-role-manager .listAvatar,
body.cc469-chat .personBtn.cc492-role-manager .cc469-list-avatar,
body.cc469-chat .personBtn.cc492-role-tl .listAvatar,
body.cc469-chat .personBtn.cc492-role-tl .cc469-list-avatar,
body.cc469-chat .personBtn.cc492-role-recruiter .listAvatar,
body.cc469-chat .personBtn.cc492-role-recruiter .cc469-list-avatar,
body.cc469-chat .personBtn.cc492-role-assistant .listAvatar,
body.cc469-chat .personBtn.cc492-role-assistant .cc469-list-avatar,
body.cc469-chat .personBtn.cc489-aria-contact .listAvatar,
body.cc469-chat .personBtn.cc489-aria-contact .cc469-list-avatar{
  background:rgba(255,255,255,.22)!important;
  border:1px solid rgba(255,255,255,.46)!important;
  color:#fff!important;-webkit-text-fill-color:#fff!important;
  box-shadow:none!important;
}
body.cc469-chat .personBtn.cc492-role-manager .rolePill,
body.cc469-chat .personBtn.cc492-role-tl .rolePill,
body.cc469-chat .personBtn.cc492-role-recruiter .rolePill,
body.cc469-chat .personBtn.cc492-role-assistant .rolePill,
body.cc469-chat .personBtn.cc489-aria-contact .rolePill{
  background:rgba(255,255,255,.92)!important;
  border:1px solid rgba(255,255,255,.96)!important;
  color:#27364e!important;-webkit-text-fill-color:#27364e!important;
  font-weight:900!important;box-shadow:none!important;text-shadow:none!important;
}

/* ARIA report: same card palette instead of pale/dull boxes. */
body.cc469-chat .chatRow.cc489-aria-row .chatBubble{
  background:#f8fbff!important;border:1px solid #dbe7f4!important;
  box-shadow:0 10px 22px rgba(17,27,55,.08)!important;border-radius:16px!important;
}
body.cc469-chat .cc490-aria-sheet{
  border:1px solid #d6e2f0!important;border-radius:16px!important;background:#fff!important;
  box-shadow:0 10px 22px rgba(17,27,55,.10)!important;
}
body.cc469-chat .cc490-aria-sheet-head{
  padding:9px 11px!important;
  background:linear-gradient(135deg,#2563eb,#3b82f6,#8b5cf6)!important;
  border-bottom:0!important;
}
body.cc469-chat .cc490-aria-sheet-title{
  color:#fff!important;-webkit-text-fill-color:#fff!important;font-weight:900!important;
  text-shadow:0 1px 2px rgba(0,0,0,.18)!important;
}
body.cc469-chat .cc490-aria-metrics{display:grid!important;grid-template-columns:repeat(7,minmax(82px,1fr))!important;gap:5px!important;padding:6px!important;background:#f2f6fb!important;border-bottom:1px solid #dce6f0!important;overflow-x:auto!important}
body.cc469-chat .cc490-aria-metric{min-width:82px!important;padding:7px 6px!important;color:#fff!important}
body.cc469-chat .cc490-aria-metric:nth-child(1){background:linear-gradient(135deg,#2563eb,#3b82f6,#8b5cf6)!important}
body.cc469-chat .cc490-aria-metric:nth-child(2){background:linear-gradient(135deg,#10b981,#22c55e,#84cc16)!important}
body.cc469-chat .cc490-aria-metric:nth-child(3){background:linear-gradient(135deg,#0ea5e9,#22c7c7,#4ade80)!important}
body.cc469-chat .cc490-aria-metric:nth-child(4){background:linear-gradient(135deg,#6366f1,#8b5cf6,#a855f7)!important}
body.cc469-chat .cc490-aria-metric:nth-child(5){background:linear-gradient(135deg,#ec4899,#f43f5e,#fb7185)!important}
body.cc469-chat .cc490-aria-metric:nth-child(6){background:linear-gradient(135deg,#f97316,#fb923c,#ef4444)!important}
body.cc469-chat .cc490-aria-metric:nth-child(7){background:linear-gradient(135deg,#2563eb,#3b82f6,#8b5cf6)!important}
body.cc469-chat .cc490-aria-metric span,
body.cc469-chat .cc490-aria-metric strong{
  color:#fff!important;-webkit-text-fill-color:#fff!important;opacity:1!important;filter:none!important;
  text-shadow:0 1px 2px rgba(0,0,0,.17)!important;position:relative!important;z-index:1!important;
}
body.cc469-chat .cc490-aria-metric span{font-weight:900!important}
body.cc469-chat .cc490-aria-metric strong{font-weight:900!important;font-size:13px!important}
body.cc469-chat .cc490-aria-table-wrap{background:#fff!important}
body.cc469-chat .cc490-aria-table{color:#163b5b!important;background:#fff!important}
body.cc469-chat .cc490-aria-table th{
  background:linear-gradient(135deg,#2563eb,#3b82f6,#8b5cf6)!important;
  color:#fff!important;-webkit-text-fill-color:#fff!important;
  border-color:rgba(255,255,255,.18)!important;font-weight:900!important;
  text-shadow:0 1px 2px rgba(0,0,0,.16)!important;
}
body.cc469-chat .cc490-aria-table td{
  background:#fff!important;color:#153b5e!important;-webkit-text-fill-color:#153b5e!important;
  font-weight:850!important;border-right:1px solid #e0e8f1!important;border-bottom:1px solid #e0e8f1!important;
}
body.cc469-chat .cc490-aria-table tr:nth-child(even) td{background:#f7faff!important}
body.cc469-chat .cc490-aria-table td.cc490-aria-name{color:#102f50!important;-webkit-text-fill-color:#102f50!important;font-weight:900!important}
body.cc469-chat .cc489-aria-open{
  background:linear-gradient(135deg,#10b981,#22c55e,#84cc16)!important;
  border:0!important;color:#fff!important;-webkit-text-fill-color:#fff!important;
  border-radius:14px!important;box-shadow:0 10px 22px rgba(16,185,129,.18)!important;font-weight:900!important;
}

/* CC26_504 header menu visibility */
body.cc474-chat .teamsChatHeader{overflow:visible!important}
body.cc474-chat .channelMenuWrap{z-index:250!important}
body.cc474-chat .channelMenuPopover{z-index:1000!important}

/* CC26_555 — Chat uses all available bottom space, soft playful premium styling. */
body.cc474-chat .page-scroll{display:flex!important;flex-direction:column!important;min-height:0!important;overflow:hidden!important;padding-bottom:2px!important;}
body.cc474-chat .page-scroll>.teamsShell{flex:1 1 auto!important;min-height:0!important;height:100%!important;max-height:100%!important;margin-bottom:0!important;}
body.cc474-chat .teamsPanel{min-height:0!important;border-radius:19px!important;border-color:#cadcf6!important;box-shadow:0 10px 30px rgba(42,85,153,.10),inset 0 1px rgba(255,255,255,.9)!important}
body.cc474-chat .teamsLeft{background:linear-gradient(160deg,#f3f8ff,#fbf0ff 55%,#edfcf8)!important}
body.cc474-chat .teamsChatHeader{background:linear-gradient(115deg,#b4e7ff,#d6c8ff 48%,#ffd8eb)!important;border-bottom-color:#c8d5f6!important}
body.cc474-chat .chatMain{background:linear-gradient(160deg,#fffdfd,#f9f4ff 55%,#f1fcff)!important}
body.cc474-chat .chatFeed{background:radial-gradient(circle at 14% 12%,rgba(109,151,255,.10),transparent 29%),radial-gradient(circle at 88% 85%,rgba(241,155,214,.10),transparent 31%),linear-gradient(160deg,#fffdfd,#fef8ff 48%,#f3fcff)!important}
body.cc474-chat .composer{background:linear-gradient(105deg,#f4efff,#ecfaff 52%,#fff0f8)!important;border-top:1px solid #d6dcf3!important;box-shadow:0 -6px 22px rgba(97,97,188,.07)!important}
body.cc474-chat .composeBox{border-radius:16px!important;background:#fff!important;border:1px solid #c6d5f7!important;box-shadow:inset 0 1px rgba(255,255,255,.95),0 5px 18px rgba(63,87,164,.09)!important}
body.cc474-chat .chatBubble,body.cc474-chat .bubble{border-radius:17px!important;box-shadow:0 4px 14px rgba(56,74,117,.08)!important}
body.cc474-chat .teamsTabs button.active{background:linear-gradient(130deg,#4686fa,#925aff)!important;color:#fff!important}
body.cc474-chat .teamsAddBtn,body.cc474-chat .headToolBtn{box-shadow:0 5px 14px rgba(94,109,200,.12)!important}
body.cc474-chat .rightPanel{background:linear-gradient(160deg,#f8fbff,#f6f0ff 48%,#effbf7)!important}



/* CC26_581 — modern emoji picker for team chat */
body.cc474-chat .composer{position:relative;}
body.cc474-chat .composer .emojiBar{
  display:none;
  position:absolute;
  left:10px;
  bottom:72px;
  z-index:60;
  width:min(380px,calc(100vw - 48px));
  max-height:430px;
  overflow:hidden;
  border:1px solid rgba(198,208,226,.9);
  border-radius:22px;
  background:linear-gradient(180deg,#ffffff 0%,#fdfdff 100%);
  box-shadow:0 22px 48px rgba(27,45,86,.20),0 4px 14px rgba(27,45,86,.08);
}
body.cc474-chat .composer.emojiOpen .emojiBar{display:block;}
body.cc474-chat .cc581EmojiPicker{display:flex;flex-direction:column;height:100%;}
body.cc474-chat .cc581EmojiTop{
  display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid rgba(225,232,243,.95);
  background:linear-gradient(135deg,#fbfdff 0%,#f4f8ff 55%,#fffdf8 100%);
}
body.cc474-chat .cc581EmojiCat{
  width:32px;height:32px;border-radius:10px;border:1px solid rgba(221,228,240,.96);background:#fff;color:#52627d;
  display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 4px 10px rgba(34,56,92,.06);
}
body.cc474-chat .cc581EmojiCat.active{background:linear-gradient(135deg,#edf4ff 0%,#efe8ff 100%);color:#4d52d5;border-color:#d9def9;}
body.cc474-chat .cc581EmojiSearchWrap{padding:10px 12px 4px;background:#fff;}
body.cc474-chat .cc581EmojiSearch{
  width:100%;height:40px;border-radius:999px;border:1px solid #d7dfeb;background:#fff;padding:0 14px 0 38px;
  font-size:14px;font-weight:700;color:#1f3552;outline:none;box-shadow:inset 0 1px 1px rgba(0,0,0,.03);
}
body.cc474-chat .cc581EmojiSearchWrap::before{
  content:'⌕';position:absolute;margin:10px 0 0 14px;color:#7a8aa4;font-size:16px;font-weight:700;
}
body.cc474-chat .cc581EmojiSearchWrap{position:relative;}
body.cc474-chat .cc581EmojiSections{padding:2px 12px 14px;overflow:auto;max-height:360px;background:#fff;}
body.cc474-chat .cc581EmojiSection{margin-top:8px;}
body.cc474-chat .cc581EmojiSectionTitle{font-size:13px;font-weight:900;color:#60728f;margin:8px 2px 10px;}
body.cc474-chat .cc581EmojiGrid{display:grid;grid-template-columns:repeat(10,minmax(0,1fr));gap:6px;}
body.cc474-chat .cc581EmojiBtn{
  width:100%;aspect-ratio:1/1;border:1px solid transparent;border-radius:12px;background:transparent;cursor:pointer;
  font-size:23px;line-height:1;display:flex;align-items:center;justify-content:center;transition:transform .12s ease, background .12s ease, box-shadow .12s ease;
}
body.cc474-chat .cc581EmojiBtn:hover{background:linear-gradient(135deg,#f1f6ff 0%,#f7f2ff 100%);transform:translateY(-1px) scale(1.04);box-shadow:0 8px 14px rgba(41,69,119,.10);}
body.cc474-chat .cc581EmojiBtn.hidden{display:none;}
body.cc474-chat .emojiToggle{
  width:40px;height:40px;min-width:40px;border:1px solid #d8dfef;border-radius:14px;background:linear-gradient(135deg,#ffffff 0%,#eef5ff 45%,#f6f0ff 100%);
  color:#4455d6;font-size:19px;box-shadow:0 10px 22px rgba(42,69,121,.12), inset 0 1px 0 rgba(255,255,255,.95);
}
body.cc474-chat .emojiToggle:hover{transform:translateY(-1px);filter:brightness(1.02);}
body.cc474-chat .cc581EmojiEmpty{font-size:13px;font-weight:800;color:#7b8ca8;padding:18px 6px 6px;display:none;}
body.cc474-chat .cc581EmojiEmpty.show{display:block;}
body.cc474-chat .emojiBtn{display:none !important;}
@media (max-width:640px){
  body.cc474-chat .composer .emojiBar{left:6px;right:6px;width:auto;bottom:68px;}
  body.cc474-chat .cc581EmojiGrid{grid-template-columns:repeat(8,minmax(0,1fr));}
}


/* CC26_754_SINGLE_PASS_PREMIUM_TEAM_CHAT
   One React-owned layout from first paint. No late DOM restyling. */
body.cc469-chat .teamsShell,body.cc474-chat .teamsShell{
  font-family:Roboto,"Segoe UI",Arial,sans-serif!important;
  grid-template-columns:276px minmax(0,1fr) 316px!important;
  gap:14px!important;
  height:calc(100dvh - 126px)!important;
  padding:2px!important;
}
body.cc469-chat .teamsPanel,body.cc474-chat .teamsPanel{
  border:1px solid rgba(190,208,231,.88)!important;
  border-radius:22px!important;
  background:rgba(255,255,255,.92)!important;
  box-shadow:0 18px 50px rgba(35,67,110,.10),inset 0 1px 0 rgba(255,255,255,.96)!important;
  backdrop-filter:blur(18px) saturate(1.15)!important;
  overflow:hidden!important;
}
body.cc469-chat .teamsLeft,body.cc474-chat .teamsLeft{
  padding:13px!important;
  background:
    radial-gradient(circle at 10% 0%,rgba(119,171,255,.20),transparent 32%),
    radial-gradient(circle at 100% 16%,rgba(180,130,255,.14),transparent 30%),
    linear-gradient(180deg,rgba(250,253,255,.98),rgba(242,247,255,.97))!important;
}
body.cc469-chat .teamsTopActions,body.cc474-chat .teamsTopActions{min-height:42px!important;margin-bottom:8px!important}
body.cc469-chat .teamsPanelTitle,body.cc474-chat .teamsPanelTitle{
  font-size:20px!important;line-height:1.1!important;font-weight:700!important;letter-spacing:-.35px!important;color:#17385f!important
}
body.cc469-chat .teamsAddBtn,body.cc474-chat .teamsAddBtn{
  width:36px!important;height:36px!important;border-radius:12px!important;border:1px solid rgba(126,151,228,.38)!important;
  background:linear-gradient(145deg,#ffffff,#edf3ff)!important;color:#4b60c8!important;
  box-shadow:0 9px 20px rgba(71,91,170,.13),inset 0 1px 0 #fff!important
}
body.cc469-chat .teamsSearch,body.cc474-chat .teamsSearch,
body.cc469-chat .cc754EmployeeSearch,body.cc474-chat .cc754EmployeeSearch{
  width:100%!important;box-sizing:border-box!important;height:42px!important;border-radius:14px!important;
  border:1px solid #cbd9ec!important;background:rgba(255,255,255,.94)!important;color:#173a5d!important;
  padding:0 13px!important;font:500 14px Roboto,"Segoe UI",Arial,sans-serif!important;
  box-shadow:inset 0 1px 0 #fff,0 7px 18px rgba(55,84,126,.07)!important;outline:none!important
}
body.cc469-chat .teamsSearch:focus,body.cc474-chat .teamsSearch:focus,
body.cc469-chat .cc754EmployeeSearch:focus,body.cc474-chat .cc754EmployeeSearch:focus{
  border-color:#7fa6ff!important;box-shadow:0 0 0 3px rgba(89,126,240,.12),0 8px 20px rgba(55,84,126,.08)!important
}
body.cc469-chat .teamsTabs,body.cc474-chat .teamsTabs{
  display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:5px!important;
  margin:9px 0 8px!important;padding:5px!important;border:1px solid #d6e1f0!important;border-radius:14px!important;
  background:linear-gradient(145deg,rgba(235,244,255,.94),rgba(244,239,255,.90))!important
}
body.cc469-chat .teamsTabs button,body.cc474-chat .teamsTabs button{
  height:32px!important;border:0!important;border-radius:10px!important;padding:0 5px!important;
  background:transparent!important;color:#5e718a!important;font-size:11px!important;font-weight:600!important;box-shadow:none!important
}
body.cc469-chat .teamsTabs button.active,body.cc474-chat .teamsTabs button.active{
  background:linear-gradient(135deg,#396ff2,#6659e8 60%,#9152d9)!important;color:#fff!important;
  box-shadow:0 7px 16px rgba(76,84,206,.24),inset 0 1px 0 rgba(255,255,255,.30)!important
}
body.cc469-chat .cc754EmployeeSearchWrap,body.cc474-chat .cc754EmployeeSearchWrap{
  margin:0 0 9px!important;padding:9px!important;border-radius:16px!important;border:1px solid rgba(205,220,239,.95)!important;
  background:linear-gradient(145deg,rgba(255,255,255,.82),rgba(242,247,255,.82))!important;
  box-shadow:0 8px 20px rgba(55,83,121,.06),inset 0 1px 0 #fff!important
}
body.cc469-chat .cc754EmployeeSearchLabel,body.cc474-chat .cc754EmployeeSearchLabel{
  display:flex!important;align-items:center!important;justify-content:space-between!important;margin:0 2px 6px!important;
  color:#56708f!important;font-size:10.5px!important;line-height:1!important;font-weight:600!important;letter-spacing:.055em!important;text-transform:uppercase!important
}
body.cc469-chat .cc754EmployeeSearchLabel span:last-child,body.cc474-chat .cc754EmployeeSearchLabel span:last-child{
  color:#7d72a8!important;text-transform:none!important;letter-spacing:0!important
}
body.cc469-chat .leftScroll,body.cc474-chat .leftScroll{padding-right:3px!important;scrollbar-width:thin!important;scrollbar-color:#bdcce2 transparent!important}
body.cc469-chat .teamsSectionTitle,body.cc474-chat .teamsSectionTitle{
  margin:8px 2px 6px!important;font-size:10.5px!important;font-weight:600!important;letter-spacing:.055em!important;color:#6d7f96!important;text-transform:uppercase!important
}
body.cc469-chat .threadBtn,body.cc474-chat .threadBtn,
body.cc469-chat .personBtn,body.cc474-chat .personBtn{
  position:relative!important;min-height:54px!important;margin:0 0 6px!important;padding:8px 9px!important;gap:9px!important;
  border:1px solid rgba(208,220,237,.84)!important;border-radius:15px!important;
  background:linear-gradient(145deg,rgba(255,255,255,.94),rgba(246,250,255,.91))!important;
  box-shadow:0 7px 18px rgba(43,72,111,.055),inset 0 1px 0 #fff!important;transform:none!important
}
body.cc469-chat .threadBtn:hover,body.cc474-chat .threadBtn:hover,
body.cc469-chat .personBtn:hover,body.cc474-chat .personBtn:hover{
  transform:translateY(-1px)!important;border-color:#b9cae5!important;background:linear-gradient(145deg,#fff,#eef5ff)!important
}
body.cc469-chat .threadBtn.active,body.cc474-chat .threadBtn.active,
body.cc469-chat .personBtn.active,body.cc474-chat .personBtn.active{
  border-color:rgba(102,111,224,.38)!important;background:linear-gradient(135deg,#eaf3ff,#f0edff 58%,#f9efff)!important;
  box-shadow:0 9px 22px rgba(75,83,186,.12),inset 3px 0 0 #5a6bea!important
}
body.cc469-chat .personBtnManager,body.cc474-chat .personBtnManager{
  border-color:rgba(66,177,137,.34)!important;background:linear-gradient(135deg,#ecfff6,#eefcff 52%,#f4f3ff)!important
}
body.cc469-chat .personBtnManager::after,body.cc474-chat .personBtnManager::after{
  content:"MANAGER"!important;position:absolute!important;right:8px!important;top:6px!important;font-size:8px!important;font-weight:700!important;letter-spacing:.04em!important;
  color:#136a50!important;background:linear-gradient(135deg,#dbffec,#c8f8e9)!important;border:1px solid #a9e8d0!important;border-radius:999px!important;padding:3px 6px!important
}
body.cc469-chat .listAvatar,body.cc474-chat .listAvatar{
  width:38px!important;height:38px!important;min-width:38px!important;border-radius:13px!important;
  background:linear-gradient(145deg,#edf4ff,#e9e7ff)!important;color:#405986!important;border:1px solid rgba(183,203,229,.84)!important;
  box-shadow:0 6px 14px rgba(61,83,127,.09),inset 0 1px 0 #fff!important;font-size:11px!important;font-weight:700!important
}
body.cc469-chat .personBtnManager .listAvatar,body.cc474-chat .personBtnManager .listAvatar{
  background:linear-gradient(135deg,#26a77e,#4cbca0 55%,#6b80e6)!important;color:#fff!important;border-color:rgba(255,255,255,.40)!important
}
body.cc469-chat .threadTitle,body.cc474-chat .threadTitle,
body.cc469-chat .personBtn .threadTitle,body.cc474-chat .personBtn .threadTitle{
  padding:0!important;border:0!important;background:none!important;box-shadow:none!important;
  color:#183a5d!important;-webkit-text-fill-color:#183a5d!important;font-size:14px!important;line-height:1.22!important;font-weight:600!important;
  white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important
}
body.cc469-chat .personBtnManager .threadTitle,body.cc474-chat .personBtnManager .threadTitle{padding-right:58px!important}
body.cc469-chat .rolePill,body.cc474-chat .rolePill{
  margin-left:auto!important;padding:4px 7px!important;border-radius:999px!important;border:1px solid #d4def0!important;
  background:linear-gradient(135deg,#f3f7ff,#eeeaff)!important;color:#5a6687!important;-webkit-text-fill-color:#5a6687!important;
  font-size:9.5px!important;font-weight:600!important;box-shadow:none!important
}
body.cc469-chat .personBtnManager .rolePill,body.cc474-chat .personBtnManager .rolePill{display:none!important}
body.cc469-chat .chatMain,body.cc474-chat .chatMain{background:linear-gradient(180deg,#fbfdff,#f6f9ff)!important}
body.cc469-chat .teamsChatHeader,body.cc474-chat .teamsChatHeader{
  min-height:74px!important;padding:12px 17px!important;border-bottom:1px solid rgba(190,206,229,.62)!important;
  background:linear-gradient(120deg,rgba(255,255,255,.96),rgba(239,246,255,.96) 46%,rgba(246,239,255,.95))!important;
  box-shadow:0 8px 24px rgba(52,79,118,.06)!important
}
body.cc469-chat .chat-room-title,body.cc474-chat .chat-room-title,
body.cc469-chat .chatTitleRow .panel-title,body.cc474-chat .chatTitleRow .panel-title{
  color:#16395e!important;-webkit-text-fill-color:#16395e!important;font-size:21px!important;font-weight:700!important;letter-spacing:-.35px!important
}
body.cc469-chat .chatFeed,body.cc474-chat .chatFeed{
  padding:19px 22px 16px!important;background:
    radial-gradient(circle at 12% 7%,rgba(79,137,255,.095),transparent 28%),
    radial-gradient(circle at 91% 18%,rgba(165,103,236,.075),transparent 27%),
    linear-gradient(180deg,#f9fcff 0%,#f6f9ff 52%,#fbf8ff 100%)!important
}
body.cc469-chat .chatBubble,body.cc474-chat .chatBubble{
  max-width:min(76%,720px)!important;padding:12px 15px!important;border:1px solid rgba(195,211,231,.86)!important;border-radius:18px 18px 18px 7px!important;
  background:linear-gradient(145deg,rgba(255,255,255,.98),rgba(244,249,255,.96))!important;
  color:#173957!important;box-shadow:0 10px 24px rgba(42,69,106,.075),inset 0 1px 0 #fff!important
}
body.cc469-chat .chatRow.mine .chatBubble,body.cc474-chat .chatRow.mine .chatBubble{
  border-radius:18px 18px 7px 18px!important;border-color:#c9c8ef!important;background:linear-gradient(145deg,#eef5ff,#f3efff)!important
}
body.cc469-chat .chatBody,body.cc474-chat .chatBody{font-size:16px!important;line-height:1.52!important;font-weight:500!important;color:#173957!important;-webkit-text-fill-color:#173957!important}
body.cc469-chat .chatMeta strong,body.cc474-chat .chatMeta strong{font-size:12.5px!important;font-weight:700!important;color:#315476!important;-webkit-text-fill-color:#315476!important}
body.cc469-chat .chatMeta span,body.cc474-chat .chatMeta span{
  min-height:auto!important;padding:0!important;border:0!important;background:transparent!important;box-shadow:none!important;
  font-size:10.5px!important;font-weight:500!important;color:#7b8da2!important;-webkit-text-fill-color:#7b8da2!important
}
body.cc469-chat .composeBox,body.cc474-chat .composeBox{
  padding:11px 13px!important;border-top:1px solid rgba(197,211,231,.75)!important;background:rgba(255,255,255,.91)!important;backdrop-filter:blur(16px)!important
}
body.cc469-chat .composeBox textarea,body.cc474-chat .composeBox textarea{
  min-height:58px!important;border:1px solid #c9d8eb!important;border-radius:16px!important;background:linear-gradient(180deg,#fff,#f8fbff)!important;
  color:#173957!important;-webkit-text-fill-color:#173957!important;font-size:15px!important;line-height:1.45!important;font-weight:500!important;
  box-shadow:inset 0 1px 0 #fff,0 7px 18px rgba(53,81,119,.065)!important
}
body.cc469-chat .rightPanel,body.cc474-chat .rightPanel{
  padding:14px!important;background:radial-gradient(circle at 80% 0%,rgba(165,113,239,.12),transparent 34%),linear-gradient(180deg,#fbfdff,#f4f7ff)!important
}
body.cc469-chat .infoTabs,body.cc474-chat .infoTabs{border-radius:14px!important;background:linear-gradient(145deg,#eef5ff,#f4efff)!important}
body.cc469-chat .infoTabs button.active,body.cc474-chat .infoTabs button.active{background:linear-gradient(135deg,#3f73ef,#675be4 60%,#9850d7)!important}
@media(max-width:1320px){body.cc469-chat .teamsShell,body.cc474-chat .teamsShell{grid-template-columns:250px minmax(0,1fr) 292px!important}}
@media(max-width:1180px){body.cc469-chat .teamsShell,body.cc474-chat .teamsShell,body.cc469-chat .teamsShell.infoClosed,body.cc474-chat .teamsShell.infoClosed{grid-template-columns:238px minmax(0,1fr)!important}.rightPanel{display:none!important}}
@media(max-width:860px){body.cc469-chat .teamsShell,body.cc474-chat .teamsShell,body.cc469-chat .teamsShell.infoClosed,body.cc474-chat .teamsShell.infoClosed{grid-template-columns:1fr!important;height:calc(100dvh - 118px)!important}body.cc469-chat .teamsLeft,body.cc474-chat .teamsLeft{display:none!important}body.cc469-chat .chatBubble,body.cc474-chat .chatBubble{max-width:90%!important}}

/* CC828: light multi-colour chat, compact people rows and clear report tables */
html#cc787-workspace[data-cc828] .personBtn,html#cc787-workspace[data-cc828] .threadBtn{min-height:49px!important;padding:9px 12px!important;border-radius:12px!important;font-weight:550!important;background:linear-gradient(120deg,#ffffffd9,#edf6f0)!important;color:#28413e!important}html#cc787-workspace[data-cc828] .personBtn.active,html#cc787-workspace[data-cc828] .threadBtn.active{background:linear-gradient(120deg,#ffdbac,#ffc3a0)!important;color:#532d1b!important}html#cc787-workspace[data-cc828] .threadTitle{font-size:13px!important;font-weight:600!important;line-height:1.2!important;color:inherit!important;-webkit-text-fill-color:inherit!important}.cc790-aria-table th{white-space:normal!important;font-size:11px!important;min-width:78px}.cc790-aria-table td{font-size:12px!important;padding:8px!important}

html#cc787-workspace[data-cc828] .ariaSheetTable th{font-size:11px!important;white-space:normal!important;min-width:68px;line-height:1.25!important;padding:8px!important;color:#304056!important;background:#ecf2fa!important}html#cc787-workspace[data-cc828] .ariaSheetTable td{font-size:12px!important;padding:8px!important;color:#23384f!important;background:#ffffffe6!important}html#cc787-workspace[data-cc828] .ariaSheetName{font-size:12px!important;font-weight:550!important}
`;
if(typeof document!=='undefined'&&!document.getElementById('cc911ChatCss')){const style=document.createElement('style');style.id='cc911ChatCss';style.textContent=cc911ChatCss;document.head.appendChild(style);}

const EmojiPicker = lazy(() => import('../components/EmojiPicker'));
import EmojiGlyph, { EmojiText } from '../components/EmojiGlyph';
import { crmYmd,mergeChatInboxRows } from '../lib/workspaceHelpers';


const DEFAULT_TEAM_GROUP = { group_id: 'team', title: 'Team Aaryansh', status: 'Active', visibility: 'all' };
const ARIA_REPORT_THREAD = 'aria-reports';
const ARIA_REPORT_GROUP = { group_id:ARIA_REPORT_THREAD,title:'ARIA Reports',status:'Active',visibility:'all' };
const CHAT_SHELL_CACHE_KEY = 'cc489_chat_shell';

function readShellCache() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(`${CHAT_SHELL_CACHE_KEY}:${cachePrincipal()}`) || localStorage.getItem(`${CHAT_SHELL_CACHE_KEY}:${cachePrincipal()}`) || '{}') || {};
    return {
      groups: Array.isArray(parsed.groups) && parsed.groups.length ? parsed.groups : [DEFAULT_TEAM_GROUP,ARIA_REPORT_GROUP],
      contacts: Array.isArray(parsed.contacts) ? parsed.contacts : [],
      members: Array.isArray(parsed.members) ? parsed.members : [],
      reviewItems: Array.isArray(parsed.reviewItems) ? parsed.reviewItems : [],
      permissions: parsed.permissions && typeof parsed.permissions === 'object' ? parsed.permissions : {},
    };
  } catch (_) {
    return { groups: [DEFAULT_TEAM_GROUP,ARIA_REPORT_GROUP], contacts: [], members: [], reviewItems: [], permissions: {} };
  }
}
function writeShellCache(payload = {}) {
  try {
    const current = readShellCache();
    const next = {
      groups: Array.isArray(payload.groups) ? payload.groups : current.groups,
      contacts: Array.isArray(payload.contacts) ? payload.contacts : current.contacts,
      members: Array.isArray(payload.members) ? payload.members : current.members,
      reviewItems: Array.isArray(payload.reviewItems) ? payload.reviewItems : current.reviewItems,
      permissions: payload.permissions && typeof payload.permissions === 'object' ? payload.permissions : current.permissions,
    };
    sessionStorage.setItem(`${CHAT_SHELL_CACHE_KEY}:${cachePrincipal()}`, JSON.stringify(next));
    localStorage.setItem(`${CHAT_SHELL_CACHE_KEY}:${cachePrincipal()}`, JSON.stringify({...next,savedAt:Date.now()}));
  } catch (_) {}
}

function formatStamp(value) {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function idOf(item) { return String(item?.id || item?.message_id || `m-${Math.random()}`); }
function titleOf(group) { return group?.title || group?.name || group?.group_id || 'Team Aaryansh'; }
function roleOf(user) { return String(user?.role || '').toLowerCase(); }
function membersFor(members, groupId) { return (Array.isArray(members) ? members : []).filter((m) => String(m.group_id) === String(groupId)); }
function initials(name) {
  const parts = String(name || 'U').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((x) => x[0]).join('').toUpperCase() || 'U';
}
function directKeyFor(user, contact) {
  const a = String(user?.user_id || user?.username || '').trim();
  const b = String(contact?.user_id || contact?.username || '').trim();
  return [a, b].filter(Boolean).sort((x, y) => x.localeCompare(y)).join('__');
}
function directThreadFor(user, contact) { return `dm:${directKeyFor(user, contact)}`; }
function isDirectThread(key) { return String(key || '').startsWith('dm:'); }
function readThreadCache(threadKey, principal = cachePrincipal()) {
  try {
    const cached = JSON.parse(sessionStorage.getItem(`cc_chat_cache:${principal}:${threadKey}`) || localStorage.getItem(`cc_chat_cache:${principal}:${threadKey}`) || '[]');
    return Array.isArray(cached) ? cached.filter(item => !item.thread_key || String(item.thread_key) === String(threadKey)) : [];
  } catch (_) { return []; }
}
function writeThreadCache(threadKey, rows, principal = cachePrincipal()) {
  try {
    const key = `cc_chat_cache:${principal}:${threadKey}`;
    const value = JSON.stringify(rows.slice(-100));
    sessionStorage.setItem(key,value); localStorage.setItem(key,value);
    // Bound durable conversation caching to the last sixteen visited threads.
    const indexKey = `cc791:chat-cache-index:${principal}`;
    const keys = [key,...JSON.parse(localStorage.getItem(indexKey) || '[]').filter(k => k !== key)];
    keys.slice(16).forEach(k => localStorage.removeItem(k));
    localStorage.setItem(indexKey,JSON.stringify(keys.slice(0,16)));
  } catch {}
}
function readChatDraft(threadKey) {
  try { return sessionStorage.getItem(`cc_chat_draft:${cachePrincipal()}:${threadKey}`) || ''; } catch { return ''; }
}
function writeChatDraft(threadKey, text, principal = cachePrincipal()) {
  try { sessionStorage.setItem(`cc_chat_draft:${principal}:${threadKey}`, text); } catch {}
}
function mergeMessages(current = [], incoming = []) {
  const map = new Map();
  [...current, ...incoming].forEach((item) => { if (item) map.set(idOf(item), item); });
  const rows = Array.from(map.values());
  const receiptKey = item => `${item.thread_key || 'team'}:${item.sender_username || ''}:${item.client_message_key || ''}`;
  const confirmed = new Set(rows.filter(item => !item.optimistic && item.client_message_key).map(receiptKey));
  return rows.filter(item => !item.deleted && !(item.optimistic && item.client_message_key && confirmed.has(receiptKey(item)))).sort((a, b) => (Number(a.id || 0) - Number(b.id || 0)) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
}


function parseAriaReportText(raw = '') {
  const clean = String(raw || '').replace(/(?:^|\n)Chart:\s*\/semi-hourly-report\?reportId=[^\s]+/i, '').trim();
  const lines = clean.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const title = lines[0] || '30-Minute Team Performance';
  const metricLine = lines[1] || '';
  const metric = (label, withMinutes = false) => {
    const match = metricLine.match(new RegExp(`${label}\\s+(\\d+)${withMinutes ? '\\s*m?' : ''}`, 'i'));
    if (!match) return withMinutes ? '0m' : '0';
    return withMinutes ? `${match[1]}m` : match[1];
  };
  const rows = lines.slice(2).map((line) => {
    const head = line.match(/^(\d+)\.\s*(.*?)\s*[—-]\s*(.*)$/i);
    if (!head) return null;
    const tail = head[3] || '';
    const token = (label, withMinutes = false) => {
      const found = tail.match(new RegExp(`(?:^|•)\\s*${label}\\s*(\\d+)\\s*(m)?`, 'i'));
      if (!found) return withMinutes ? '0m' : '0';
      return withMinutes ? `${found[1]}m` : found[1];
    };
    return {
      rank: head[1], name: head[2].trim(), dialed: token('D'), connected: token('C'), incoming: token('I'),
      talk: token('T', true), submissions: token('S'), breakTime: token('B', true), idle: token('Idle', true),
    };
  }).filter(Boolean);
  return {
    title,
    summary: {
      dialed: metric('Dialed'), connected: metric('Connected'), incoming: metric('Incoming'),
      talk: metric('Talk', true), submissions: metric('Submissions'), breakTime: metric('Break', true), idle: metric('Idle', true),
    },
    rows,
  };
}

function AriaReportTable({ body }) {
  const report = parseAriaReportText(body);
  return <div className="ariaSheet">
    <div className="ariaSheetHead"><div className="ariaSheetTitle">{report.title}</div></div>
    {report.rows.length ? <div className="ariaSheetTableWrap"><table className="ariaSheetTable"><thead><tr><th>#</th><th>Team Member</th><th>Dialed</th><th>Connected</th><th>Incoming</th><th>Talk minutes</th><th>Submissions</th><th>Break minutes</th><th>Idle minutes</th></tr></thead><tbody>{report.rows.map((row) => <tr key={`${row.rank}-${row.name}`}><td>{row.rank}</td><td className="ariaSheetName">{row.name}</td><td>{row.dialed}</td><td>{row.connected}</td><td>{row.incoming}</td><td>{row.talk}</td><td>{row.submissions}</td><td>{row.breakTime}</td><td>{row.idle}</td></tr>)}</tbody></table></div> : <div className="ariaSheetEmpty">No team activity recorded in this window.</div>}
  </div>;
}

export default function ChatPage() {
  const { user } = useAuth();
  const initialShell = useMemo(() => readShellCache(), []);
  const [groups, setGroups] = useState(initialShell.groups);
  const [contacts, setContacts] = useState(initialShell.contacts);
  const [members, setMembers] = useState(initialShell.members);
  const [messages, setMessages] = useState(() => readThreadCache(new URLSearchParams(window.location.search).get('thread') || 'team'));
  const [reviewItems, setReviewItems] = useState(initialShell.reviewItems);
  const [permissions, setPermissions] = useState(initialShell.permissions);
  const [selectedContext, setSelectedContext] = useState(null);
  const [currentThread, setCurrentThread] = useState(new URLSearchParams(window.location.search).get('thread') || 'team');
  const [activeTab, setActiveTab] = useState('all');
  const [infoTab, setInfoTab] = useState('overview');
  const [infoOpen, setInfoOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [peopleQuery, setPeopleQuery] = useState('');
  const [body, setBody] = useState(() => readChatDraft(currentThread));
  const [groupTitle, setGroupTitle] = useState('');
  const [selectedRecipients,setSelectedRecipients]=useState([]);
  const [broadcastOpen,setBroadcastOpen]=useState(false);
  const [broadcastBody,setBroadcastBody]=useState('');
  const broadcastIntentRef=useRef(null);
  const [chatNotice,setChatNotice]=useState('');
  const [renameTitle, setRenameTitle] = useState('');
  const [memberInput, setMemberInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetEmployee,setResetEmployee]=useState('');
  const [resetEmployees,setResetEmployees]=useState([]);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editingBody, setEditingBody] = useState('');
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const closeEmojiPicker = useCallback(() => setEmojiOpen(false), []);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [renamePopoverOpen, setRenamePopoverOpen] = useState(false);
  const [renameSaving, setRenameSaving] = useState(false);
  const endRef = useRef(null);
  const latestMessageIdRef = useRef(0);
  const sendIntentRef = useRef(null);
  const sendQueueRef = useRef(Promise.resolve());
  const sendingKeysRef = useRef(new Set());
  const threadRef = useRef(currentThread);
  threadRef.current = currentThread;
  const bodyRef = useRef(body);
  const mountedRef = useRef(true);
  const threadEpochRef = useRef(0);
  const loadSequenceRef = useRef(0);
  const pushedAtRef = useRef(new Map());
  const nearBottomRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  function updateBody(value) {
    const next = typeof value === 'function' ? value(bodyRef.current) : String(value || '');
    bodyRef.current = next;
    setBody(next);
    writeChatDraft(threadRef.current, next);
  }

  useLayoutEffect(() => {
    document.body.classList.add('cc474-chat');
    return () => document.body.classList.remove('cc474-chat');
  }, []);

  const directoryEpoch=useRef(0);
  async function loadDirectory(fresh=false){const epoch=++directoryEpoch.current;try{const d=await api.get('/api/chat/directory'+(fresh?'?fresh=1':''),{cacheTtlMs:fresh?0:30000,allowStale:false,retries:0,timeoutMs:8000});if(!mountedRef.current||epoch!==directoryEpoch.current)return;setContacts(d.contacts||[]);setGroups(d.groups||[]);writeShellCache({contacts:d.contacts||[],groups:d.groups||[]});}catch(e){if(mountedRef.current)setError(e.message||'People could not load. Refresh to retry.');}}
  useEffect(()=>{loadDirectory(true);const changed=e=>{if(/users|flowchart/.test(e.detail?.path||e.detail?.source||''))loadDirectory(true);};window.addEventListener('career-crox-data-written',changed);window.addEventListener('career-crox-workspace-change',changed);return()=>{directoryEpoch.current++;window.removeEventListener('career-crox-data-written',changed);window.removeEventListener('career-crox-workspace-change',changed);};},[user?.user_id]);
  const isManager = Boolean(permissions?.can_manage_groups) || ['admin', 'manager'].includes(roleOf(user));
  const canResetHistory = roleOf(user) === 'manager';
  useEffect(()=>{
    if(!canResetHistory||!infoOpen||infoTab!=='settings')return;
    let alive=true;
    api.get('/api/chat/reset-employees',{cacheTtlMs:30000}).then(data=>{if(alive)setResetEmployees(data.items||[]);}).catch(e=>{if(alive)setError(e.message||'Employee list could not load.');});
    return()=>{alive=false;};
  },[canResetHistory,infoOpen,infoTab]);
  const isLeadership = Boolean(permissions?.can_direct_all) || isManager || ['tl', 'team lead'].includes(roleOf(user));
  const canRename = Boolean(permissions?.can_rename_groups) || isLeadership;
  const canReview = Boolean(permissions?.can_review) || isLeadership;
  const recruiterMode = Boolean(permissions?.recruiter_mode);
  const selectedGroup = useMemo(() => {
    if (selectedContext) return selectedContext;
    return groups.find((g) => String(g.group_id) === String(currentThread)) || groups[0] || DEFAULT_TEAM_GROUP;
  }, [groups, currentThread, selectedContext]);
  const selectedMembers = useMemo(() => membersFor(members, currentThread), [members, currentThread]);
  const chatRows = useMemo(() => messages.slice(-260), [messages]);
  const activeIsDirect = isDirectThread(currentThread);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups.filter((g) => !q || titleOf(g).toLowerCase().includes(q) || String(g.group_id || '').toLowerCase().includes(q));
  }, [groups, query]);

  const filteredContacts = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pq = peopleQuery.trim().toLowerCase();
    return contacts.filter((c) => {
      const haystack = `${String(c.full_name || '')} ${String(c.username || '')} ${String(c.role || '')}`.toLowerCase();
      return (!q || haystack.includes(q)) && (!pq || haystack.includes(pq));
    }).slice().sort((a, b) => String(a.full_name || a.username || '').localeCompare(String(b.full_name || b.username || '')));
  }, [contacts, query, peopleQuery]);

  const visibleMembers = useMemo(() => {
    if (selectedMembers.length) return selectedMembers;
    if (currentThread === 'team') return contacts;
    if (currentThread === ARIA_REPORT_THREAD) return contacts;
    if (activeIsDirect) {
      const directPeople = contacts.filter((c) => directThreadFor(user, c) === currentThread);
      return directPeople.length ? directPeople : contacts.filter((c) => c.is_self);
    }
    return [];
  }, [selectedMembers, contacts, currentThread, activeIsDirect, user]);

  const loadChat = useCallback(async (options = {}) => {
    const requestedThread = currentThread;
    if (threadRef.current !== requestedThread) return;
    const epoch = threadEpochRef.current;
    const sequence = ++loadSequenceRef.current;
    const startedAt = Date.now();
    const isCurrent = () => mountedRef.current && threadRef.current === requestedThread && threadEpochRef.current === epoch && loadSequenceRef.current === sequence;
    try {
      const sinceId = options?.replace ? 0 : Number(latestMessageIdRef.current || 0);
      const params = new URLSearchParams({ thread_key: currentThread });
      if (sinceId > 0) params.set('since_id', String(sinceId));
      if (options?.replace) params.set('full', '1');
      if (options?.force) params.set('_', String(Date.now()));
      if (sinceId > 0 && !options?.replace) params.set('tiny', '1');
      const data = await api.get(`/api/chat?${params.toString()}`, {
        cacheTtlMs: options?.replace ? 15000 : 30000,
        // Render's sleeping backend may take longer than 8 seconds to answer.
        // Preserve the visible cached chat instead of aborting a valid initial load.
        timeoutMs: 24000,
        retries: 0,
        background: false,
      });
      if (!isCurrent()) return;
      const incoming = Array.isArray(data?.messages) ? data.messages.filter(message => !message.thread_key || String(message.thread_key) === requestedThread) : [];
      if (Array.isArray(data?.groups)) setGroups(data.groups);
      if (Array.isArray(data?.members)) setMembers(data.members);
      if (Array.isArray(data?.contacts)) setContacts(data.contacts);
      if (Array.isArray(data?.review_items)) setReviewItems(data.review_items);
      if (data?.permissions) setPermissions(data.permissions);
      if (Array.isArray(data?.groups) || Array.isArray(data?.members) || Array.isArray(data?.contacts) || Array.isArray(data?.review_items) || data?.permissions) {
        writeShellCache({
          groups: Array.isArray(data?.groups) ? data.groups : undefined,
          members: Array.isArray(data?.members) ? data.members : undefined,
          contacts: Array.isArray(data?.contacts) ? data.contacts : undefined,
          reviewItems: Array.isArray(data?.review_items) ? data.review_items : undefined,
          permissions: data?.permissions,
        });
      }
      if (data?.selected_context) setSelectedContext(data.selected_context);
      if (Number(data?.latest_message_id || 0) > 0) latestMessageIdRef.current = Number(data.latest_message_id || 0);
      else if (incoming.length) latestMessageIdRef.current = Math.max(latestMessageIdRef.current || 0, ...incoming.map((item) => Number(item?.id || 0) || 0));
      setMessages((current) => {
        if (!isCurrent()) return current;
        const pushedDuringLoad = current.filter(message => message.optimistic || (pushedAtRef.current.get(idOf(message)) || 0) >= startedAt);
        const next = mergeMessages(mergeMessages(options?.replace ? [] : current, incoming), pushedDuringLoad);
        writeThreadCache(requestedThread, next);
        return next;
      });
      setError(data?.__stale ? 'Chat is showing saved messages while the server reconnects.' : '');
    } catch (err) {
      if (!isCurrent()) return;
      if (String(err?.code || '') === 'BACKGROUND_ABORT') return;
      // Keep previously loaded messages and unsent draft. Explain connectivity honestly.
      const loginNeeded = Number(err?.status || 0) === 401;
      setError(loginNeeded
        ? 'Chat session expired. Sign in again to reconnect.'
        : 'Chat server is not responding yet. Your already loaded messages are still visible.');
    }
  }, [currentThread]);

  async function resetChat(employeeId=''){
    if(!canResetHistory||busy)return;
    if(sendingKeysRef.current.size){setError('Wait for queued messages to finish before clearing chat history.');return;}
    const person=resetEmployees.find(c=>String(c.user_id)===String(employeeId))||contacts.find(c=>String(c.user_id)===String(employeeId));
    if(!window.confirm(employeeId?`Clear ${person?.full_name||'this employee'}'s sent messages and direct-chat history?`:'Clear this entire conversation for everyone?'))return;
    setBusy(true);setError('');
    try{
      const data=await api.post('/api/chat/reset',{confirm:'RESET',...(employeeId?{user_id:employeeId}:{thread_key:currentThread})});
      setMessages([]);latestMessageIdRef.current=0;writeThreadCache(currentThread,[]);
      setChatNotice(`${data.reset_count||0} messages cleared`);await loadChat({replace:true,force:true});
    }catch(err){setError(err.message||'Chat reset failed.');}finally{setBusy(false);}
  }
  useEffect(()=>{
    const wake=()=>{if(!document.hidden)loadChat({replace:true,force:true});};
    const reset=event=>{if(!event.detail?.reset||!String(event.detail.source||'').includes('/chat'))return;setMessages([]);latestMessageIdRef.current=0;writeThreadCache(currentThread,[]);wake();};
    window.addEventListener('career-crox-tab-resumed',wake);
    window.addEventListener('career-crox-workspace-change',reset);
    return()=>{window.removeEventListener('career-crox-tab-resumed',wake);window.removeEventListener('career-crox-workspace-change',reset);};
  },[currentThread,loadChat]);

  useEffect(() => {
    const cached = readThreadCache(currentThread);
    setMessages(cached);
    latestMessageIdRef.current = cached.reduce((max, item) => Math.max(max, Number(item?.id || 0) || 0), 0);
    if (isDirectThread(currentThread)) {
      const directContact = contacts.find((c) => directThreadFor(user, c) === currentThread);
      if (directContact) {
        setSelectedContext({
          group_id: currentThread,
          title: directContact.is_self ? `${directContact.full_name || directContact.username || 'You'} (You)` : (directContact.full_name || directContact.username || 'Direct Chat'),
          thread_type: 'direct',
          visibility: 'direct',
          other: directContact,
        });
      }
    } else {
      const group = groups.find((g) => String(g.group_id) === String(currentThread));
      if (group) setSelectedContext(group);
    }
    loadChat({ force: false, replace: cached.length === 0 });
  }, [currentThread, loadChat]);

  // CC26_758: current Team Chat thread receives only pushed message events; there is no polling/read loop.
  // The prebuilt production bridge owns the live SSE today. Keep the source flag false so a future source build
  // does not accidentally open a second socket beside that bridge.
  useEffect(() => { window.__CC_CHAT_NATIVE_SSE = false; window.__CC_CHAT_LIVE_PUSH__ = true; window.__CC_CHAT_REACT_OWNER__=true; }, []);
  const [inboxRows,setInboxRows]=useState(() => {
    try { return JSON.parse(sessionStorage.getItem(`cc791:inbox:${cachePrincipal()}`) || localStorage.getItem(`cc791:inbox:${cachePrincipal()}`) || '[]'); } catch { return []; }
  });
  const inboxLoadedRef=useRef(false);
  useEffect(() => {
    let active=true;
    const effectThread = currentThread;
    const effectEpoch = threadEpochRef.current;
    const isCurrent = () => active && threadRef.current === effectThread && threadEpochRef.current === effectEpoch;
    const updateInbox=() => {
      if(inboxLoadedRef.current) return;
      inboxLoadedRef.current=true;
      const principal=cachePrincipal();
      api.get('/api/chat/inbox',{cacheTtlMs:30000,timeoutMs:12000,background:true}).then(d=>{if(mountedRef.current && principal===cachePrincipal())setInboxRows(d.items||[]);}).catch(()=>{inboxLoadedRef.current=false;});
    };
    const markRead=() => { return; /* CC930 rendered-message effect owns receipts. */ if(!document.hidden && document.hasFocus()) api.post('/api/chat/read',{thread_key:threadRef.current,last_read_id:latestMessageIdRef.current},{background:true,retries:0}).then(()=>{if(isCurrent())setInboxRows(rows=>rows.map(r=>r.thread_key===effectThread?{...r,unread_count:0}:r));}).catch(()=>{}); };
    const receive=event => { const message=event.detail;if(!message)return;const pushKey=String(message.thread_key||'team')+':'+idOf(message);const alreadyPushed=pushedAtRef.current.has(pushKey);pushedAtRef.current.set(pushKey,Date.now());if(pushedAtRef.current.size>500)pushedAtRef.current.delete(pushedAtRef.current.keys().next().value);
      // Merge the pushed inbox timestamp/unread count locally; do not download
      // the whole inbox after each message.
      setInboxRows(current=>mergeChatInboxRows(current,message,effectThread,user?.username,!document.hidden&&document.hasFocus(),alreadyPushed));
      if(isCurrent() && String(message.thread_key||'team')===String(effectThread)) {
        pushedAtRef.current.set(idOf(message), Date.now());
        if (pushedAtRef.current.size > 500) pushedAtRef.current.delete(pushedAtRef.current.keys().next().value);
        latestMessageIdRef.current=Math.max(Number(latestMessageIdRef.current)||0,Number(message.id)||0);
        setMessages(current=>{if(!isCurrent())return current;const next=mergeMessages(current,[message]);writeThreadCache(effectThread,next);return next;});markRead();
      }
    };
    let catchupRunning=false,lastCatchup=Date.now();
    const catchup=() => {if(catchupRunning||Date.now()-lastCatchup<2000)return;catchupRunning=true;lastCatchup=Date.now();api.get(`/api/chat/delta?thread_key=${encodeURIComponent(effectThread)}`,{cacheTtlMs:0,timeoutMs:12000,background:true}).then(d=>{if(!isCurrent())return;const incoming=(d.messages||[]).filter(m=>!m.thread_key||String(m.thread_key)===effectThread);latestMessageIdRef.current=Math.max(Number(latestMessageIdRef.current)||0,...incoming.map(m=>Number(m.id)||0));setMessages(current=>{if(!isCurrent())return current;const next=mergeMessages(current,incoming);writeThreadCache(effectThread,next);return next;});markRead();}).catch(()=>{}).finally(()=>{catchupRunning=false;});};
    const focus=()=>{if(!document.hidden&&Date.now()-lastCatchup>15000)catchup();};
    window.addEventListener('career-crox-chat-message',receive);window.addEventListener('career-crox-chat-ready',catchup);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
    updateInbox(); markRead();
    return()=>{active=false;window.removeEventListener('career-crox-chat-message',receive);window.removeEventListener('career-crox-chat-ready',catchup);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
  },[currentThread]);

  useEffect(()=>{try{sessionStorage.setItem(`cc791:inbox:${cachePrincipal()}`,JSON.stringify(inboxRows));localStorage.setItem(`cc791:inbox:${cachePrincipal()}`,JSON.stringify(inboxRows));}catch{} window.dispatchEvent(new CustomEvent('cc790-chat-read',{detail:{unread:inboxRows.some(r=>Number(r.unread_count)>0),items:inboxRows}}));},[inboxRows]);

  const confirmedReadRef=useRef(new Map());
  useEffect(()=>{const key=currentThread,id=messages.reduce((n,m)=>m.optimistic?n:Math.max(n,Number(m.id)||0),0);if(!id)return;let stopped=false;
    const read=()=>{if(stopped||document.hidden||!document.hasFocus()||Number(confirmedReadRef.current.get(key)||0)>=id)return;confirmedReadRef.current.set(key,id);api.post('/api/chat/read',{thread_key:key,last_read_id:id},{background:true,retries:0}).then(d=>{if(stopped)return;setInboxRows(rows=>rows.map(r=>r.thread_key===key&&Number(r.latest_message_id)<=id?{...r,unread_count:0,last_read_id:id}:r));}).catch(()=>{if(confirmedReadRef.current.get(key)===id)confirmedReadRef.current.delete(key);});};
    read();window.addEventListener('focus',read);document.addEventListener('visibilitychange',read);const receipt=e=>{if(e.detail?.thread_key===key)setInboxRows(rows=>rows.map(r=>r.thread_key===key&&Number(r.latest_message_id)<=Number(e.detail.last_read_id)?{...r,unread_count:0}:r));};window.addEventListener('career-crox-chat-read',receipt);
    return()=>{stopped=true;window.removeEventListener('focus',read);document.removeEventListener('visibilitychange',read);window.removeEventListener('career-crox-chat-read',receipt);};
  },[currentThread,messages]);
  useLayoutEffect(() => { const feed = endRef.current?.parentElement; if (feed && nearBottomRef.current) feed.scrollTop = feed.scrollHeight; }, [currentThread, messages.length]);

  function openThread(threadKey, tab = null) {
    if (String(threadKey) === String(threadRef.current)) { if (tab) setActiveTab(tab); return; }
    writeChatDraft(threadRef.current, bodyRef.current);
    threadRef.current = threadKey;
    threadEpochRef.current += 1;
    loadSequenceRef.current += 1;
    nearBottomRef.current = true;
    pushedAtRef.current.clear();
    bodyRef.current = readChatDraft(threadKey);
    setBody(bodyRef.current);
    setError(''); setEditingId(''); setEditingBody(''); setEmojiOpen(false);
    setHeaderMenuOpen(false); setRenamePopoverOpen(false);
    const cached = readThreadCache(threadKey);
    setMessages(cached);
    latestMessageIdRef.current = cached.reduce((max, item) => Math.max(max, Number(item?.id || 0) || 0), 0);
    if (isDirectThread(threadKey)) {
      const directContact = contacts.find((c) => directThreadFor(user, c) === threadKey);
      setSelectedContext(directContact ? {
        group_id: threadKey,
        title: directContact.is_self ? `${directContact.full_name || directContact.username || 'You'} (You)` : (directContact.full_name || directContact.username || 'Direct Chat'),
        thread_type: 'direct',
        visibility: 'direct',
        other: directContact,
      } : { group_id: threadKey, title: 'Direct Chat', thread_type: 'direct', visibility: 'direct' });
    } else {
      setSelectedContext(groups.find((g) => String(g.group_id) === String(threadKey)) || null);
    }
    setCurrentThread(threadKey);
    if (tab) setActiveTab(tab);
    setInfoTab('overview');
    const url = new URL(window.location.href);
    url.searchParams.set('thread', threadKey);
    window.history.replaceState(null, '', url.toString());
  }

  function openInfo(tab) {
    setInfoOpen(true);
    setInfoTab(tab);
  }

  async function sendMessage(retryMessage = null) {
    const clean = String(retryMessage?.body || bodyRef.current || '').trim();
    if (!clean || busy) return;
    const sentThread = threadRef.current;
    const principal = cachePrincipal();
    const activeSend = () => mountedRef.current && threadRef.current === sentThread && cachePrincipal() === principal;
    const storageKey = `cc_chat_send_intent:${principal}:${sentThread}`;
    let intent = null;
    try { intent = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch {}
    if (retryMessage?.client_message_key) intent = { thread:sentThread,body:clean,key:retryMessage.client_message_key };
    if (!intent || intent.thread !== sentThread || intent.body !== clean) {
      // Reuse an old release's unconfirmed receipt only when its room/text match.
      try { const legacy = JSON.parse(sessionStorage.getItem(`cc_chat_send_intent:${principal}`) || 'null'); if (legacy?.thread === sentThread && legacy.body === clean) intent = legacy; } catch {}
    }
    if (!intent || intent.thread !== sentThread || intent.body !== clean) intent = { thread:sentThread,body:clean,key:crypto.randomUUID() };
    const failed = retryMessage || messages.find(message => message.delivery_failed && message.body === clean && message.thread_key === sentThread);
    if (failed?.client_message_key) intent.key = failed.client_message_key;
    if (sendingKeysRef.current.has(intent.key)) {
      if (retryMessage) return;
      intent = {thread:sentThread,body:clean,key:crypto.randomUUID()};
    }
    sendingKeysRef.current.add(intent.key);
    const messageStorageKey = `${storageKey}:${intent.key}`;
    const clearIntent = () => {
      try {
        sessionStorage.removeItem(messageStorageKey);
        for (const key of [storageKey,`cc_chat_send_intent:${principal}`]) {
          const pending=JSON.parse(sessionStorage.getItem(key)||'null');
          if(pending?.key===intent.key)sessionStorage.removeItem(key);
        }
      } catch {}
      if(sendIntentRef.current?.key===intent.key)sendIntentRef.current=null;
    };
    const optimisticId = failed?.id || `optimistic-${crypto.randomUUID()}`;
    const optimistic = {
      id: optimisticId,
      sender_username: user?.username || 'You',
      sender_name: user?.full_name || user?.username || 'You',
      body: clean,
      created_at: new Date().toISOString(),
      thread_key: sentThread,
      optimistic: '1',
      client_message_key: intent.key,
      delivery_failed: false,
    };
    sendIntentRef.current = intent;
    try { sessionStorage.setItem(storageKey, JSON.stringify(intent));sessionStorage.setItem(messageStorageKey,JSON.stringify(intent)); } catch {}
    nearBottomRef.current = true;
    if (!retryMessage || bodyRef.current.trim() === clean) updateBody(''); setMessages((cur) => {
      const next = mergeMessages(cur, [optimistic]);
      writeThreadCache(sentThread, next, principal);
      return next;
    }); setError('');
    try {
      // The composer stays usable while accepted messages send in order.
      // Only one request runs at a time; a failure cannot block the next message.
      const pending=sendQueueRef.current.then(()=>{
        if(cachePrincipal()!==principal||window.__CC602_NETWORK_PAUSED__){
          throw new Error('Session changed. Sign in and retry this message.');
        }
        return api.post('/api/chat/messages', { thread_key: sentThread, body: clean,client_message_key:intent.key }, { retries:0,detachedWrite:true });
      });
      sendQueueRef.current=pending.catch(()=>{});
      const response = await pending;
      const saved = response?.item || null;
      if (!saved?.id) throw new Error('Message receipt was not received. Retry the same text.');
      clearIntent();
      const confirm = (cur) => {
        const next = mergeMessages(cur.filter((m) => String(m.id) !== optimisticId), saved ? [saved] : []);
        writeThreadCache(sentThread, next, principal);
        return next;
      };
      confirm(readThreadCache(sentThread, principal));
      if (activeSend()) {
        latestMessageIdRef.current = Math.max(Number(latestMessageIdRef.current || 0), Number(saved.id) || 0);
        setMessages(cur => activeSend() ? confirm(cur) : cur);
        if (response?.review_pending) setError('Message moved to review queue for approval.');
      }
    } catch (err) {
      const failedMessage = { ...optimistic, delivery_failed: true };
      const cached = readThreadCache(sentThread, principal);
      const confirmed = cached.find(message => !message.optimistic && message.client_message_key === intent.key && message.sender_username === optimistic.sender_username);
      writeThreadCache(sentThread, mergeMessages(cached, [failedMessage]), principal);
      if (activeSend()) {
        setMessages(cur => activeSend() ? mergeMessages(cur, [confirmed || failedMessage]) : cur);
        if (!confirmed && !bodyRef.current) updateBody(clean);
        setError(confirmed ? '' : (err.message || 'Delivery was not confirmed. Retry the message below.'));
      }
      if (confirmed) clearIntent();
    } finally { sendingKeysRef.current.delete(intent.key); }
  }

  async function createGroup() {
    const title = groupTitle.trim();
    if (!title) return;
    setBusy(true);
    try {
      const r = await api.post('/api/chat/groups', { title,members:selectedRecipients });
      setGroupTitle('');setSelectedRecipients([]);
      setShowCreatePanel(false);
      if (r?.item) {
        setGroups((current) => {
          const next = [...current.filter((g) => String(g.group_id) !== String(r.item.group_id)), r.item];
          writeShellCache({ groups: next });
          return next;
        });
      }
      if (r?.item?.group_id) openThread(r.item.group_id, 'channels');
      loadChat({ force: false, replace: false });
    } catch (err) { setError(err.message || 'Channel create failed'); }
    finally { setBusy(false); }
  }

  const recipientOptions=contacts.filter(c=>c.can_chat&&!c.is_self&&!c.is_bot);
  function toggleRecipient(name){setSelectedRecipients(rows=>rows.includes(name)?rows.filter(x=>x!==name):[...rows,name]);}
  function recipientPicker(){return <div className="cc790-recipient-picker"><label className={`cc790-select-all ${recipientOptions.length&&recipientOptions.every(c=>selectedRecipients.includes(c.username))?'selected':''}`}><input type="checkbox" checked={recipientOptions.length>0&&recipientOptions.every(c=>selectedRecipients.includes(c.username))} onChange={e=>setSelectedRecipients(e.target.checked?recipientOptions.map(c=>c.username):[])} />Select all <strong>{selectedRecipients.length} selected</strong></label><div className="cc790-recipient-list">{recipientOptions.map(c=><label key={c.username} className={selectedRecipients.includes(c.username)?'selected':''}><input type="checkbox" checked={selectedRecipients.includes(c.username)} onChange={()=>toggleRecipient(c.username)} /><span>{c.full_name||c.username}</span><small>{c.role==='tl'?'TL':c.role}</small></label>)}</div></div>;}
  async function sendBroadcast(){
    if(busy||!broadcastBody.trim()||!selectedRecipients.length)return;
    const recipients=[...selectedRecipients].sort(),text=broadcastBody.trim(),signature=JSON.stringify({recipients,body:text});
    if(broadcastIntentRef.current?.signature!==signature)broadcastIntentRef.current={signature,id:crypto.randomUUID()};
    setBusy(true);setError('');
    try{const d=await api.post('/api/chat/broadcast',{recipients,body:text,command_id:broadcastIntentRef.current.id},{timeoutMs:45000,retries:0});setChatNotice(`Message sent to ${d.sent_count} coworkers.`);setBroadcastOpen(false);setSelectedRecipients([]);setBroadcastBody('');broadcastIntentRef.current=null;}
    catch(e){setError(e.message||'Delivery was not confirmed. Retry with the same recipients.');}
    finally{setBusy(false);}
  }

  async function renameGroup(overrideTitle = '') {
    const title = String(overrideTitle || renameTitle || '').trim();
    const groupId = String(selectedGroup?.group_id || '').trim();
    if (!title || !groupId || isDirectThread(groupId)) return;

    const previousGroups = groups;
    const previousContext = selectedContext;
    const optimisticItem = { ...(selectedGroup || {}), group_id: groupId, title, updated_at: new Date().toISOString() };

    setRenameSaving(true);
    setHeaderMenuOpen(false);
    setRenamePopoverOpen(false);
    setRenameTitle('');
    setGroups((current) => {
      const next = current.some((g) => String(g.group_id) === groupId)
        ? current.map((g) => String(g.group_id) === groupId ? { ...g, title } : g)
        : [optimisticItem, ...current];
      writeShellCache({ groups: next });
      return next;
    });
    setSelectedContext((current) => current && String(current.group_id) === groupId ? { ...current, title } : optimisticItem);
    setError('');

    try {
      const response = await api.put(`/api/chat/groups/${encodeURIComponent(groupId)}`, { title }, {
        timeoutMs: 8000,
        retries: 0,
        background: true,
      });
      const saved = response?.item || optimisticItem;
      setGroups((current) => {
        const next = current.map((g) => String(g.group_id) === groupId ? { ...g, ...saved, title: saved.title || title } : g);
        writeShellCache({ groups: next });
        return next;
      });
      setSelectedContext((current) => current && String(current.group_id) === groupId ? { ...current, ...saved, title: saved.title || title } : current);
    } catch (err) {
      setGroups(previousGroups);
      setSelectedContext(previousContext);
      writeShellCache({ groups: previousGroups });
      setError(err.message || 'Rename failed. Previous name restored.');
    } finally {
      setRenameSaving(false);
    }
  }

  function beginRename() {
    if (!canRename || activeIsDirect) return;
    setRenameTitle(titleOf(selectedGroup));
    setHeaderMenuOpen(false);
    setRenamePopoverOpen(true);
  }

  async function deleteGroup() {
    if (!selectedGroup?.group_id || selectedGroup.group_id === 'team' || isDirectThread(selectedGroup.group_id)) return;
    if (!window.confirm(`Delete channel ${titleOf(selectedGroup)}?`)) return;
    setBusy(true);
    try { await api.post(`/api/chat/groups/${encodeURIComponent(selectedGroup.group_id)}/delete`, {}); openThread('team', 'channels'); await loadChat({ force: true, replace: true }); }
    catch (err) { setError(err.message || 'Delete channel failed'); }
    finally { setBusy(false); }
  }

  async function addMembers() {
    if (!memberInput.trim() || isDirectThread(currentThread)) return;
    setBusy(true);
    try { await api.post(`/api/chat/groups/${encodeURIComponent(currentThread)}/members/add`, { members: memberInput }); setMemberInput(''); await loadChat({ force: true, replace: true }); }
    catch (err) { setError(err.message || 'Add member failed'); }
    finally { setBusy(false); }
  }

  async function removeMember(member) {
    setBusy(true);
    try { await api.post(`/api/chat/groups/${encodeURIComponent(currentThread)}/members/remove`, { username: member.username || member.user_id || member.id }); await loadChat({ force: true, replace: true }); }
    catch (err) { setError(err.message || 'Remove member failed'); }
    finally { setBusy(false); }
  }

  async function saveEdit(messageId) {
    const clean = String(editingBody || '').trim(); if (!clean) return;
    setBusy(true);
    try { await api.put(`/api/chat/messages/${messageId}`, { body: clean }); setEditingId(''); setEditingBody(''); await loadChat({ force: true, replace: true }); }
    catch (err) { setError(err.message || 'Message update failed'); }
    finally { setBusy(false); }
  }

  async function deleteMessage(messageId) {
    if (!window.confirm('Delete this message?')) return;
    setBusy(true);
    try { await api.post(`/api/chat/messages/${messageId}/delete`, {}); await loadChat({ force: true, replace: true }); }
    catch (err) { setError(err.message || 'Message delete failed'); }
    finally { setBusy(false); }
  }

  async function reviewMessage(messageId, decision) {
    setBusy(true);
    try { await api.post(`/api/chat/messages/${messageId}/review`, { decision }); await loadChat({ force: true, replace: true }); }
    catch (err) { setError(err.message || 'Review action failed'); }
    finally { setBusy(false); }
  }

  const showChannels = activeTab === 'all' || activeTab === 'channels';
  const showPeople = activeTab === 'all' || activeTab === 'people';
  const showReview = activeTab === 'review';
  const headMembers = visibleMembers.slice(0, 3);
  const threads=[...(showChannels?filteredGroups.filter(g=>String(g.group_id)!==ARIA_REPORT_THREAD).map(g=>({key:String(g.group_id),title:titleOf(g),group:g})):[]),...(showPeople?filteredContacts.filter(c=>!c.is_bot).map(c=>({key:directThreadFor(user,c),title:(c.full_name||c.username)+(c.is_self?' (You)':''),contact:c})):[])].map(t=>({...t,inbox:inboxRows.find(row=>row.thread_key===t.key)||{}})).sort((a,b)=>String(b.inbox.last_message_at||'').localeCompare(String(a.inbox.last_message_at||''))||a.title.localeCompare(b.title));

  const ariaGroup = groups.find(g => String(g.group_id) === ARIA_REPORT_THREAD);
  const ariaInbox = inboxRows.find(r => r.thread_key === ARIA_REPORT_THREAD) || {};

  return (
    <Layout title="Team Chat" subtitle="">
      {chatNotice?<div className="cc790-chat-notice" role="status">{chatNotice}<button onClick={()=>setChatNotice('')} aria-label="Dismiss">×</button></div>:null}
      {broadcastOpen?<div className="crm-modal-backdrop" onClick={()=>!busy&&setBroadcastOpen(false)}><section className="crm-premium-modal cc790-broadcast-modal" onClick={e=>e.stopPropagation()}><div className="cc791-dialog-hero"><span className="cc791-dialog-symbol" aria-hidden="true">↗</span><div><small>TEAM COMMUNICATION</small><h2 className="panel-title">Broadcast a message</h2></div></div><p className="helper-text">Each selected coworker receives a direct message.</p>{recipientPicker()}<label className="field">Message<textarea value={broadcastBody} onChange={e=>setBroadcastBody(e.target.value)} maxLength={4000} placeholder="Write your message…" /></label>{error?<p role="alert" className="sync-message is-error">{error}</p>:null}<div className="row-actions"><button className="add-profile-btn" disabled={busy||!selectedRecipients.length||!broadcastBody.trim()} onClick={sendBroadcast}>{busy?'Sending…':`Send to ${selectedRecipients.length}`}</button><button className="ghost-btn" disabled={busy} onClick={()=>setBroadcastOpen(false)}>Cancel</button></div></section></div>:null}
      <div className={`teamsShell ${infoOpen ? '' : 'infoClosed'}`}>
        <aside className="teamsPanel teamsLeft">
          <div className="teamsTopActions">
            <div className="teamsPanelTitle">Chats</div>
            <button type="button" className="cc790-broadcast-open" title="Send to selected coworkers" onClick={()=>{setBroadcastOpen(true);setShowCreatePanel(false);setSelectedRecipients([]);}}>Broadcast</button>
            {isManager ? <button type="button" className="teamsAddBtn" title="Create group" onClick={() => { setBroadcastOpen(false);setSelectedRecipients([]);setActiveTab('channels'); setShowCreatePanel((v) => !v); }}>+</button> : null}
          </div>
          <input className="teamsSearch" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats and people…" aria-label="Search chats and people" />
          <div className="teamsTabs">
            <button type="button" className={activeTab === 'all' ? 'active' : ''} onClick={() => setActiveTab('all')}>All</button>
            <button type="button" className={activeTab === 'channels' ? 'active' : ''} onClick={() => setActiveTab('channels')}>Groups</button>
            <button type="button" className={activeTab === 'people' ? 'active' : ''} onClick={() => setActiveTab('people')}>People</button>
            {canReview ? <button type="button" className={activeTab === 'review' ? 'active' : ''} onClick={() => setActiveTab('review')}>Review{reviewItems.length ? ` ${reviewItems.length}` : ''}</button> : null}
          </div>

          {activeTab === 'people' ? <div className="cc754EmployeeSearchWrap"><input className="cc754EmployeeSearch" type="search" value={peopleQuery} onChange={(e) => setPeopleQuery(e.target.value)} placeholder="Filter name or role…" aria-label="Search employees" /></div> : null}

          {showCreatePanel && isManager ? <div className="createPanel">
            <div className="cc791-create-title">New group<span>Bring your team together</span></div><input aria-label="New group name" className="chatInput" value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} placeholder="New channel name" />
            {recipientPicker()}<button className="miniBlue fullBtn" disabled={busy || !groupTitle.trim()} onClick={createGroup}>Create Group</button>
          </div> : null}

          {ariaGroup ? <button type="button" data-thread={ARIA_REPORT_THREAD} className={`cc791-aria-pinned ${currentThread===ARIA_REPORT_THREAD?'active':''}`} onClick={()=>openThread(ARIA_REPORT_THREAD)}><span className="cc791-aria-symbol" aria-hidden="true">A</span><span>ARIA Reports<small>Team activity</small></span>{Number(ariaInbox.unread_count)>0?<span className="cc790-unread-count">{Math.min(99,Number(ariaInbox.unread_count))}</span>:<span aria-hidden="true">↗</span>}</button>:null}
          <div className="leftScroll">
            {!showReview ? <><div className="teamsSectionTitle"><span>{activeTab==='all'?'Recent conversations':activeTab==='people'?'People':'Groups'}</span><span>{threads.length}</span></div>{threads.map(t=><button key={t.key} type="button" data-thread={t.key} className={`${t.contact?'personBtn':'threadBtn'} ${String(currentThread)===t.key?'active':''} ${Number(t.inbox.unread_count)>0?'cc790-unread-thread':''}`} disabled={t.contact&&!t.contact.can_chat} onClick={()=>openThread(t.key)}><span className={`listAvatar ${t.contact?'personAvatar':'channelAvatar'}`} aria-hidden="true">{t.contact?initials(t.title):'#'}</span><div className="threadMain"><div className="threadTitle" title={t.title}>{t.title}</div><small className="cc790-thread-caption">{t.contact?(t.contact.role==='tl'?'Team leader':t.contact.role):'Group'}</small></div>{Number(t.inbox.unread_count)>0?<span className="cc790-unread-count">{Number(t.inbox.unread_count)>99?'99+':t.inbox.unread_count}</span>:null}</button>)}</>:null}

            {showReview ? <div className="leftReviewList">
              {reviewItems.length ? reviewItems.map((m) => <button type="button" className="leftReviewItem" key={idOf(m)} onClick={() => openInfo('settings')}>
                <strong>{m.sender_username || 'User'}</strong><span>{String(m.original_body || m.body || '').slice(0, 80)}</span>
              </button>) : <div className="mutedBox">No pending review.</div>}
            </div> : null}
          </div>
        </aside>

        <main className="teamsPanel chatMain">
          <div className="teamsChatHeader">
            <div className="chatTitleRow"><span className="cc783-room-avatar" aria-hidden="true">{activeIsDirect ? initials(titleOf(selectedGroup)) : '#'}</span>
              <div className="chatTitleText"><div className="panel-title chat-room-title">{titleOf(selectedGroup)}</div><div className="cc783-chat-subtitle">{activeIsDirect ? 'Direct conversation' : `${visibleMembers.length} members · Team conversation`}</div></div>
            </div>
            <button type="button" className="ghost-btn bounceable cc603-chat-refresh" disabled={busy} onClick={() => {loadDirectory(true);loadChat({force:true,replace:false});}} title="Refresh messages" aria-label="Refresh messages">↻</button>
            <div className="chatHeadTools">
              <div className="headAvatars">
                {headMembers.map((m, idx) => <button type="button" key={`${m.user_id || m.username || idx}`} className={`headAvatar a${idx + 1}`} title={m.full_name || m.username || 'Member'} onClick={() => openInfo('members')}>{initials(m.full_name || m.username)}</button>)}
                {visibleMembers.length > 3 ? <button type="button" className="headAvatar more" title="View members" onClick={() => openInfo('members')}>+{visibleMembers.length - 3}</button> : null}
              </div>
              <button type="button" className="headToolBtn" title="Overview" aria-label="Overview" onClick={() => openInfo('overview')}>i</button>
              <div className="channelMenuWrap">
                <button type="button" className={`headToolBtn ${headerMenuOpen ? 'active' : ''}`} title="Channel menu" aria-label="Channel menu" aria-expanded={headerMenuOpen} onClick={() => setHeaderMenuOpen((v) => !v)}>•••</button>
                {headerMenuOpen ? <div className="channelMenuPopover">
                  {canRename && !activeIsDirect ? <button type="button" className="channelMenuItem rename" onClick={beginRename}><span>✎</span><b>Rename Group</b></button> : null}
                  <button type="button" className="channelMenuItem" onClick={() => { setHeaderMenuOpen(false); openInfo('members'); }}><span>◉</span><b>Members</b></button>
                  <button type="button" className="channelMenuItem" onClick={() => { setHeaderMenuOpen(false); openInfo('settings'); }}><span>⚙</span><b>Channel Settings</b></button>
                </div> : null}
              </div>
            </div>
            {renamePopoverOpen ? <div className="renamePopover">
              <div className="renamePopoverLabel">Rename Group</div>
              <div className="renamePopoverRow">
                <input autoFocus className="chatInput renameQuickInput" value={renameTitle} onChange={(e) => setRenameTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') renameGroup(); if (e.key === 'Escape') setRenamePopoverOpen(false); }} />
                <button type="button" className="miniGood renameSaveBtn" disabled={renameSaving || !renameTitle.trim()} onClick={() => renameGroup()}>{'Save'}</button>
                <button type="button" className="tinyBtn renameCancelBtn" onClick={() => setRenamePopoverOpen(false)}>Cancel</button>
              </div>
            </div> : null}
          </div>

          {error ? <div className="cc578-chat-status" role="status">
            <span>{error}</span>
            <button type="button" className="cc578-chat-retry" onClick={() => loadChat({ force: true, replace: true })}>Retry chat</button>
          </div> : null}

          <div className="chatFeed" onScroll={(event) => { const feed = event.currentTarget; nearBottomRef.current = feed.scrollHeight - feed.clientHeight - feed.scrollTop < 96; }}>
            {chatRows.map((item, index) => {
              const mine = String(item.sender_username || '').toLowerCase() === String(user?.username || '').toLowerCase();
              const editing = String(editingId) === String(item.id);
              const pending = String(item.moderation_status || '').toLowerCase() === 'review_pending';
              const sender = item.sender_name || item.sender_username || 'User';
              const ariaReport = String(item.sender_username || '').toLowerCase() === 'aria' && String(item.reference_type || '') === 'semi_hourly_report';
              const reportPath = ariaReport && item.reference_id ? `/semi-hourly-report?reportId=${encodeURIComponent(item.reference_id)}` : '';
              const reportBody = ariaReport ? String(item.body || '').replace(/(?:^|\n)Chart:\s*\/semi-hourly-report\?reportId=[^\s]+/i, '').trim() : String(item.body || '');
              const messageDay = item.created_at ? crmYmd(item.created_at) : '';
              const previousDay = chatRows[index - 1]?.created_at ? crmYmd(chatRows[index - 1].created_at) : '';
              const dayLabel = messageDay && !Number.isNaN(new Date(messageDay).getTime()) ? new Date(`${messageDay}T12:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }) : '';
              return <React.Fragment key={idOf(item)}>{messageDay !== previousDay && dayLabel ? <div className="dateDivider">{dayLabel}</div> : null}<div className={`chatRow ${mine ? 'mine' : ''} ${ariaReport ? 'ariaReportRow' : ''}`}>
                <span className="chatAvatar" aria-hidden="true">{initials(mine ? (user?.full_name || 'You') : sender)}</span>
                <div className="chatBubble">
                  <div className="chatMeta"><strong>{mine ? 'You' : sender}</strong><span>{formatStamp(item.created_at)}</span>{pending ? <span className="reviewBadge">Review</span> : null}{item.audit_deleted ? <span className="reviewBadge">Audit</span> : null}</div>
                  {editing ? <>
                    <textarea data-voice-context="message" className="chatInput" rows="3" value={editingBody} onChange={(e) => setEditingBody(e.target.value)} />
                    <div className="rowActions"><button className="tinyBtn" onClick={() => setEditingId('')}>Cancel</button><button className="miniBlue" onClick={() => saveEdit(item.id)} disabled={busy}>Save</button></div>
                  </> : <><div className={`chatBody ${ariaReport ? 'ariaReportBody' : ''}`}>{ariaReport ? <AriaReportTable body={reportBody} /> : <EmojiText text={item.body}/>}</div>{ariaReport && reportPath ? <button type="button" className="ariaReportOpen" onClick={() => { window.history.pushState(null, '', reportPath); window.dispatchEvent(new PopStateEvent('popstate')); }}>Open Performance Chart</button> : null}</>}
                  {item.delivery_failed ? <button type="button" className="cc784-message-retry" disabled={busy} onClick={() => sendMessage(item)}>Delivery unconfirmed · Retry</button> : item.optimistic ? <span className="cc784-message-pending">Sending…</span> : null}
                  {!editing && !item.optimistic ? <details className="messageMenu"><summary aria-label="Message actions">⋯</summary><div className="messageMenuPopup"><button className="tinyBtn" onClick={() => { setEditingId(String(item.id)); setEditingBody(String(item.body || '')); }}>Edit</button><button className="tinyBtn danger" onClick={() => deleteMessage(item.id)}>Delete</button></div></details> : null}
                </div>
              </div></React.Fragment>;
            })}
            {!chatRows.length ? <div className="mutedBox">No messages yet.</div> : null}
            <div ref={endRef} />
          </div>

          {currentThread === ARIA_REPORT_THREAD ? <div className="composer ariaReportComposerNote"><div className="mutedBox">ARIA automatic report feed • New 30-minute reports will appear here.</div></div> : <div className={`composer ${emojiOpen ? 'emojiOpen' : ''}`}>
            {emojiOpen && <Suspense fallback={<div className="helper-text" role="status">Opening emoji picker…</div>}><EmojiPicker onClose={closeEmojiPicker} onPick={emoji => updateBody(value => `${value}${emoji}`)}/></Suspense>}
            <div className="composeBox">
              <button type="button" className="emojiToggle" aria-label="Emoji" aria-expanded={emojiOpen} onClick={() => setEmojiOpen((v) => !v)}><EmojiGlyph value="😊"/></button>
              <textarea rows="2" value={body} onChange={(e) => updateBody(e.target.value)} placeholder="Type a message…" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} />
              <button type="button" className="sendBtn" disabled={busy || !body.trim()} onClick={() => sendMessage()} aria-label="Send message">{busy ? '…' : '➤'}</button>
            </div>
          </div>}
        </main>

        {infoOpen ? <aside className="teamsPanel rightPanel">
          <div className="profileHero"><div className="panel-title">Channel Info</div><button type="button" className="infoClose" aria-label="Close channel info" onClick={() => setInfoOpen(false)}>×</button></div>
          <div className="infoHero"><span className="infoHash">#</span><h3>{titleOf(selectedGroup)}</h3></div>
          <div className="infoTabs">
            {['overview', 'members', 'files', 'settings'].map((tab) => <button key={tab} type="button" className={infoTab === tab ? 'active' : ''} onClick={() => setInfoTab(tab)}>{tab[0].toUpperCase() + tab.slice(1)}</button>)}
          </div>

          {infoTab === 'overview' ? <div className="infoPanel active">
            <div className="infoCardGrid">
              <button type="button" className="infoCard blue overviewCard" onClick={() => setInfoTab('members')}><span>Overview</span><strong>›</strong></button>
              <button type="button" className="infoCard mint" onClick={() => setInfoTab('members')}><span>Visible Members</span><strong>{visibleMembers.length}</strong></button>
              <button type="button" className="infoCard orange" onClick={() => setInfoTab('files')}><span>Pinned Messages</span><strong>0</strong></button>
              <button type="button" className="infoCard violet" onClick={() => setInfoTab('settings')}><span>Review Queue</span><strong>{reviewItems.length}</strong></button>
              <button type="button" className="infoCard gold wide" onClick={() => setInfoTab('settings')}><span>Access Rule</span><strong>{recruiterMode ? 'Restricted' : 'Full'}</strong></button>
            </div>
          </div> : null}

          {infoTab === 'members' ? <div className="infoPanel active memberList">
            {visibleMembers.length ? visibleMembers.map((m, idx) => <div className="memberRow" key={`${m.id || m.user_id || m.username || idx}`}>
              <span className="memberAvatar">{initials(m.full_name || m.username)}</span>
              <div className="memberMeta"><strong>{m.full_name || m.username || 'Member'}</strong><span>{String(m.role || 'user').toUpperCase()}</span></div>
              {isManager && !activeIsDirect && selectedGroup?.group_id !== 'team' ? <button type="button" className="miniDanger compact" disabled={busy} onClick={() => removeMember(m)}>Remove</button> : null}
            </div>) : <div className="mutedBox">No visible members.</div>}
          </div> : null}

          {infoTab === 'files' ? <div className="infoPanel active"><div className="emptyInfo"><strong>No shared files</strong><span>File sharing is not enabled in the current chat backend.</span></div></div> : null}

          {infoTab === 'settings' ? <div className="infoPanel active settingsPanel">
            {canResetHistory?<section className="settingsBlock cc820-chat-reset"><div className="settingsTitle">Employee chat reset</div><p className="helper-text">Remove their messages, direct conversations and related alerts. Candidate records are kept.</p><button type="button" className="miniDanger" disabled={busy} onClick={()=>resetChat()}>Clear this conversation</button><select className="chatInput" aria-label="Employee chat history" value={resetEmployee} onChange={e=>setResetEmployee(e.target.value)}><option value="">Choose employee</option>{resetEmployees.filter(c=>c.user_id).map(c=><option key={c.user_id} value={c.user_id}>{c.full_name}{String(c.is_active)==='0'?' · Inactive':''}</option>)}</select><button type="button" className="miniDanger" disabled={busy||!resetEmployee} onClick={()=>resetChat(resetEmployee)}>Clear employee history</button></section>:null}
            {canRename && !activeIsDirect && currentThread !== ARIA_REPORT_THREAD ? <section className="settingsBlock"><div className="settingsTitle">Channel Controls</div><input className="chatInput" value={renameTitle} onFocus={() => { if (!renameTitle) setRenameTitle(titleOf(selectedGroup)); }} onChange={(e) => setRenameTitle(e.target.value)} placeholder="Rename selected channel" /><button className="miniBlue renameSettingsBtn" disabled={renameSaving || !renameTitle.trim()} onClick={() => renameGroup()}>{'Rename'}</button></section> : null}
            {isManager && !activeIsDirect && currentThread !== ARIA_REPORT_THREAD ? <section className="settingsBlock"><div className="settingsTitle">Add Members</div><textarea className="chatInput" rows="2" value={memberInput} onChange={(e) => setMemberInput(e.target.value)} placeholder="username / user_id, comma separated" /><button className="miniGood" disabled={busy || !memberInput.trim()} onClick={addMembers}>Add Members</button>{selectedGroup?.group_id !== 'team' ? <button className="miniDanger" disabled={busy} onClick={deleteGroup}>Delete Channel</button> : null}</section> : null}
            {canReview ? <section className="settingsBlock"><div className="settingsTitle">Review Queue</div>{reviewItems.length ? reviewItems.map((m) => <div key={idOf(m)} className="reviewCard"><div className="helper-text"><b>{m.sender_username}</b> • {formatStamp(m.created_at)}</div><div className="chatBody reviewBody">{m.original_body || m.body}</div><div className="rowActions"><button className="miniGood" onClick={() => reviewMessage(m.id, 'approve')}>Approve</button><button className="miniDanger" onClick={() => reviewMessage(m.id, 'reject')}>Reject</button></div></div>) : <div className="mutedBox">No pending review.</div>}</section> : null}
            {!canRename && !isManager && !canReview ? <div className="emptyInfo"><strong>No controls available</strong><span>Your role does not have channel management access.</span></div> : null}
          </div> : null}
        </aside> : null}
      </div>
    </Layout>
  );
}
