/* SecureLink v600: bounded screen capture, no self-preview/recursive mirroring, recoverable direct-only media and consent.
   There is no image/video relay over Render. Only SDP/ICE metadata goes to CRM backend. */
(() => {
'use strict';
const el = id => document.getElementById(id);
const show = (id, yes=true) => el(id).classList.toggle('hidden', !yes);
const setText = (id, text) => { el(id).textContent = String(text); };
const state = {role:'',code:'',peer:null,channel:null,stream:null,partner:'',poll:null,since:0,signalBusy:false,revision:0,agentHeartbeat:null,connecting:false,agentToken:'',agentEnabled:false,ended:false,iceBuffer:[],live:false,remoteSeen:false,guide:null,inviteId:'',managerInviteId:'',inboxTimer:null,inviteStatusTimer:null,staffPeople:[],staffCacheAt:0,staffLoading:null,recoveryTimer:null,recoveryAttempts:0,recoveryBusy:false,healthTimer:null,accessMode:'view',remoteControlReady:false,fullscreenWanted:false,controlPromptShown:false,autoAssistAttempted:false,requestNonce:0};
const agentHost='http://127.0.0.1:47682';
function message(text){setText('toast',text);show('toast');clearTimeout(message.timer);message.timer=setTimeout(()=>show('toast',false),4200);}
async function request(method,path,body){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),23000);
 try {const response=await fetch('/api/securelink/'+path,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify(body||{}),signal:controller.signal});
 const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||(response.status===401?'Please sign in to CRM again.':'Connection failed.'));
 return data;
 } finally {clearTimeout(timer);}
}
function updateStage(text){setText('stage-hint',text);setText('session-status',text);}
// Genuine browser fullscreen requires a user gesture; CSS alone cannot hide Chrome's tabs.
function requestCleanFullscreen(){
 if(state.role!=='helper'||!state.fullscreenWanted)return;
 const panel=el('session');
 if(document.fullscreenElement===panel)return;
 try { const request=panel.requestFullscreen?.({navigationUI:'hide'});request?.catch?.(()=>{panel.classList.add('fullscreen-fallback');}); }
 catch(_){panel.classList.add('fullscreen-fallback');}
}
function revealViewerControls(){
 const panel=el('session');panel.classList.add('controls-revealed');
 clearTimeout(revealViewerControls.timer);
 revealViewerControls.timer=setTimeout(()=>{if(!panel.matches?.(':focus-within')&&!el('session-dock').matches?.(':hover'))panel.classList.remove('controls-revealed');},2400);
}
function setActualControl(ready){state.remoteControlReady=Boolean(ready)&&state.accessMode==='assist';if(el('dock-mode'))setText('dock-mode',state.remoteControlReady?'CONTROL READY':currentAccessMeta().label);if(state.remoteControlReady){message('Control ready. Click the screen to type.');}}

function normalizeAccessMode(mode){return String(mode||'').toLowerCase()==='assist'?'assist':'view';}
function currentAccessMeta(){return state.accessMode==='assist'?{label:'FULL ASSIST ACCESS',invite:'Requested access · Full Assist Access',permission:'Allow this person to share and request full assist access? Mouse and keyboard remain blocked until this laptop approves Windows control.',approve:'Allow full assist & choose screen',allowInvite:'Allow full assist & choose screen',waiting:'Waiting for the other person to allow full assist screen sharing.',live:'Screen sharing is live. Full assist mode was requested. SecureLink will try to enable Windows mouse and keyboard on this laptop automatically.'}:{label:'VIEW SCREEN ONLY',invite:'Requested access · View Screen Only',permission:'Allow this person to VIEW your chosen screen? You can stop sharing at any time.',approve:'Allow view-only & choose screen',allowInvite:'Allow view-only & choose screen',waiting:'Waiting for the other person to allow view-only screen sharing.',live:'Screen sharing is live in view-only mode.'};}
function setAccessMode(mode){state.accessMode=normalizeAccessMode(mode);const meta=currentAccessMeta();(document.querySelectorAll?.('[data-access-mode]')||[]).forEach(btn=>btn.classList.toggle('active',btn.dataset.accessMode===state.accessMode));if(el('invite-request-mode'))setText('invite-request-mode',meta.invite);if(el('permission-mode-note'))setText('permission-mode-note',meta.invite);if(el('permission-request-text'))setText('permission-request-text',meta.permission);if(el('approve'))el('approve').textContent=meta.approve;if(el('allow-invite'))el('allow-invite').textContent=meta.allowInvite;if(el('dock-mode'))setText('dock-mode',meta.label);}
async function autoEnableRequestedAssist(){if(state.accessMode!=='assist'||!state.stream||state.agentEnabled||state.ended)return;try{await agentPair();}catch(_){}}
// Full-screen apps can switch to 4K/high-FPS surfaces. The browser may ignore
// ideal capture dimensions, so constrain both the capture track AND RTP sender.
const captureOptions={video:{frameRate:{ideal:15,max:18},width:{ideal:1280},height:{ideal:720}},audio:false};
async function prepareCapture(stream){
 const track=stream?.getVideoTracks?.()[0];
 if(!track)throw new Error('No screen video was selected.');
 try{track.contentHint='detail';}catch{}
 if(track.applyConstraints){
  try{await track.applyConstraints({width:{ideal:1280,max:1280},height:{ideal:720,max:720},frameRate:{ideal:15,max:18}});}
  catch{try{await track.applyConstraints({frameRate:{ideal:15,max:18}});}catch{}}
 }
 return stream;
}
function noLocalPreview(){
 // A live preview of the same desktop inside the shared tab/screen creates an
 // infinite hall of mirrors and can freeze the browser/GPU on full-screen apps.
 el('local-video').pause?.();el('local-video').srcObject=null;
 el('stage').classList.add('show-local');show('empty-stage',true);
 setText('stage-hint','Screen sharing is active. Preview is hidden to keep both laptops responsive. Your colleague can see the chosen screen.');
}

function role(role){
 if(state.code) void stop();
 state.role=role;state.ended=false;
 show('workspace');show('choices',false);show('owner-panel',role==='owner');show('helper-panel',role==='helper');show('session',false);show('permission',false);show('app-panel',false);
 setText('mode-label',role==='owner'?'MY LAPTOP NEEDS HELP':'I AM HELPING SOMEONE');
 setText('mode-title',role==='owner'?'Share my screen':'Connect to a laptop');
 setText('mode-description',role==='owner'?'Share your four-digit support reference or accept a manager invitation. Your screen stays private until you choose to share it.':'Select a colleague by name, or connect using their four-digit support reference. The colleague chooses whether to share.');
 setAccessMode(state.accessMode);
 if(role==='helper')revealEmployeePicker();
}
async function openCode(){
 el('generate').disabled=true;
 try{const data=await request('POST','open');state.code=data.code;state.since=0;state.revision=0;state.ended=false;setText('my-code',data.code);el('copy-code').disabled=false;setText('owner-wait','Waiting for someone to enter your code. Only you can approve their request.');show('owner-wait');beginPoll();}
 catch(error){message(error.message);} finally{el('generate').disabled=false;}
}
async function joinCode(){
 const code=el('input-code').value.replace(/\s+/g,'');
 if(!/^\d{4}$/.test(code)){message('Enter the four-digit reference shared by the employee.');return;}
 const requestNonce=++state.requestNonce;state.ended=false;state.fullscreenWanted=true;show('session');requestCleanFullscreen();el('connect').disabled=true;el('connect').textContent='Connecting…';
 try{await request('POST','join',{code,access_mode:state.accessMode});if(state.requestNonce!==requestNonce||state.ended)return;state.code=code;state.since=0;state.revision=0;state.ended=false;show('session');show('empty-stage');setText('live-indicator','WAITING FOR APPROVAL');updateStage(currentAccessMeta().waiting);beginPoll();}
 catch(error){if(state.requestNonce===requestNonce){show('session',false);if(document.fullscreenElement===el('session'))void document.exitFullscreen?.().catch?.(()=>{});message(error.message);}}
 finally{el('connect').disabled=false;el('connect').textContent='Connect now ↗';}
}
async function approve(preselectedStream){
 if(!state.code)return;
 // The browser prompts on every session. No screen capture or remote input happens before click.
 el('approve').disabled=true;
 try{
   const stream=await prepareCapture(preselectedStream || await navigator.mediaDevices.getDisplayMedia(captureOptions));
   state.stream=stream;stream.getVideoTracks().forEach(track=>track.addEventListener('ended',()=>stop()));
   await request('POST','approve',{code:state.code});
   show('permission',false);show('owner-wait',false);show('session');show('app-panel',state.accessMode==='assist');show('retry-control',false);
   noLocalPreview();
   updateStage(currentAccessMeta().live);
   setText('live-indicator','● YOUR SCREEN IS LIVE');setText('control-badge',state.accessMode==='assist'?'ASSIST REQUESTED':'VIEW ONLY');
   if(state.accessMode==='assist'&&!state.autoAssistAttempted){state.autoAssistAttempted=true;void autoEnableRequestedAssist();}
   await createOwnerPeer();
 } catch(error){if(state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null;}message(error.name==='NotAllowedError'?'You cancelled screen sharing. Nothing was shared.':error.message);}
 finally{el('approve').disabled=false;}
}
function clearRecovery(){
 clearTimeout(state.recoveryTimer);state.recoveryTimer=null;
}
function scheduleRecovery(peer,delay=8000){
 if(state.recoveryTimer || state.ended || state.peer!==peer)return;
 state.recoveryTimer=setTimeout(()=>{
  state.recoveryTimer=null;
  if(state.ended || state.peer!==peer || peer.connectionState==='connected')return;
  if(state.role==='owner')void recoverPeer(peer);
  else {updateStage('The direct link is interrupted. Waiting for the sharer to restore it; no Windows restart needed.');scheduleRecovery(peer,15000);}
 },delay);
}
async function recoverPeer(peer,{manual=false}={}){
 if(state.ended||state.peer!==peer||state.role!=='owner'||!state.stream||state.recoveryBusy)return;
 if(!manual && peer.connectionState==='connected')return;
 if(state.recoveryAttempts>=3 && !manual){
  updateStage('Video could not reconnect. End this session and start a new one; do not restart either laptop.');
  return;
 }
 if(peer.signalingState!=='stable'){scheduleRecovery(peer,9000);return;}
 state.recoveryBusy=true;
 state.recoveryAttempts++;
 try{
  peer.restartIce?.();
  const offer=await peer.createOffer({iceRestart:true});
  if(state.peer!==peer||state.ended)return;
  await peer.setLocalDescription(offer);
  await send('offer',{type:offer.type,sdp:offer.sdp});
  updateStage('Restoring the direct video link… attempt '+Math.min(state.recoveryAttempts,3)+'/3.');
  beginPoll();
 }catch(error){
  updateStage('Video recovery paused. You can use Refresh video or reconnect without restarting Windows.');
 }finally{
  state.recoveryBusy=false;
  if(!state.ended&&state.peer===peer&&peer.connectionState!=='connected')scheduleRecovery(peer,17000);
 }
}
function peerBase(){
 const peer=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}],bundlePolicy:'max-bundle',iceCandidatePoolSize:0});
 state.peer=peer;state.recoveryAttempts=0;clearRecovery();
 peer.onicecandidate=e=>{if(e.candidate)send('ice',e.candidate.toJSON()).catch(()=>{});};
 peer.onconnectionstatechange=()=>{
  if(state.peer!==peer || state.ended)return;
  if(peer.connectionState==='connected'){
   clearRecovery();state.recoveryAttempts=0;state.live=true;
   setText('live-indicator','● LIVE CONNECTED');
   updateStage(state.role==='owner'?'Screen sharing is live. Local preview is hidden for stability.':'Direct screen connection restored.');
   void verifyMediaRoute(peer);
  }else if(peer.connectionState==='disconnected'||peer.connectionState==='failed'){
   state.live=false;
   setText('live-indicator','RECONNECTING…');
   updateStage('Direct video temporarily interrupted. SecureLink will try to reconnect automatically.');
   scheduleRecovery(peer,peer.connectionState==='failed'?1000:8000);
   beginPoll();
  }
 };
 return peer;
}
// No TURN servers are configured. Inspect the browser-selected ICE pair too:
// a future config change must never silently start a paid video relay.
async function verifyMediaRoute(peer){
 if(peer!==state.peer||peer.connectionState!=='connected')return;
 try{
  const stats=await peer.getStats();
  let pair=null;
  for(const value of stats.values()){
   if(value.type==='transport' && value.selectedCandidatePairId){pair=stats.get(value.selectedCandidatePairId);break;}
  }
  if(!pair){for(const value of stats.values()){if(value.type==='candidate-pair'&&value.state==='succeeded'&&value.nominated){pair=value;break;}}}
  const local=pair && stats.get(pair.localCandidateId);
  const remote=pair && stats.get(pair.remoteCandidateId);
  if(local?.candidateType==='relay'||remote?.candidateType==='relay'){
   message('A relayed media route was detected. SecureLink stopped sharing to protect your data.');
   await stop();return;
  }
  const path=local?.candidateType&&remote?.candidateType?'DIRECT P2P VERIFIED':'DIRECT-ONLY WEBRTC';
  setText('session-help',path+' · Video does not use Supabase/Render. CRM authentication still uses small database requests.');
 }catch{
  setText('session-help','DIRECT-ONLY WEBRTC · No TURN/video relay configured. CRM authentication uses small requests.');
 }
}
async function send(type,payload){if(!state.code ||state.ended)return;return request('POST','signal',{code:state.code,type,payload});}
async function createOwnerPeer(){
 const peer=peerBase();
 state.stream.getTracks().forEach(track=>peer.addTrack(track,state.stream));
 const channel=peer.createDataChannel('cursor-and-consented-input',{ordered:false,maxRetransmits:0});attachChannel(channel);
 // Limit peer-to-peer bandwidth; media is never uploaded to Supabase or Render.
  const videoSender=peer.getSenders().find(sender=>sender.track?.kind==='video');
  if(videoSender){try{
   const settings=videoSender.track.getSettings?.()||{};
   const downscale=Math.max(1,(settings.width||1280)/1280,(settings.height||720)/720);
   const params=videoSender.getParameters();params.encodings=params.encodings?.length?params.encodings:[{}];
   params.encodings[0].maxBitrate=1500000;params.encodings[0].maxFramerate=15;
   params.encodings[0].scaleResolutionDownBy=downscale;
   await videoSender.setParameters(params);
  }catch(_){/* Unsupported browsers still use a direct media path and low-FPS capture. */}}
  const offer=await peer.createOffer();await peer.setLocalDescription(offer);await send('offer',{type:offer.type,sdp:offer.sdp});
}
async function makeHelperPeer(offer){
 const peer=state.peer||peerBase();
 if(!peer.ontrack)peer.ontrack=event=>{
  state.remoteSeen=true;el('remote-video').srcObject=event.streams[0]||new MediaStream([event.track]);
  el('remote-video').play?.().catch(()=>updateStage('Click the video once if browser playback is paused.'));
  show('empty-stage',false);setText('live-indicator','● LIVE CONNECTED');
  updateStage(state.accessMode==='assist'?'You are viewing the other laptop. Full assist was requested. Mouse and keyboard become available only after the employee laptop allows it.':'You are viewing the other laptop in view-only mode.');
 };
 peer.ondatachannel=event=>attachChannel(event.channel);
 if(peer.signalingState!=='stable')return;
 await peer.setRemoteDescription(new RTCSessionDescription(offer));
 const answer=await peer.createAnswer();await peer.setLocalDescription(answer);await send('answer',{type:answer.type,sdp:answer.sdp});
 await flushIce();
}
async function flushIce(){if(!state.peer?.remoteDescription)return;const items=state.iceBuffer.splice(0);for(const ice of items){try{await state.peer.addIceCandidate(new RTCIceCandidate(ice));}catch{}}}
function attachChannel(channel){
 state.channel=channel;
 channel.onmessage=event=>{
  let msg;try{msg=JSON.parse(event.data);}catch{return;}
  if(msg?.type==='end'){void stop(false);return;}
  if(msg?.type==='refresh' && state.role==='owner' && state.peer){void recoverPeer(state.peer,{manual:true});return;}
  if(state.role==='owner')onRemoteInput(msg);
  if(state.role==='helper'&&msg?.type==='control'){setActualControl(msg.enabled);setText('control-badge',state.remoteControlReady?'MOUSE + KEYBOARD ON':'GUIDE ONLY');if(state.accessMode==='assist'&&!state.remoteControlReady&&!state.controlPromptShown){state.controlPromptShown=true;message('Waiting for employee Windows permission. Their SecureLink.exe must be running.');}}
 };
 channel.onopen=()=>{if(state.role==='owner')channel.send(JSON.stringify({type:'control',enabled:state.accessMode==='assist'&&state.agentEnabled}));};
 channel.onclose=()=>{state.remoteControlReady=false;setText('control-badge','CONNECTION CLOSED');};
}
// Coalesce mouse movements into a bounded local-only queue. Never flood the
// Windows helper with parallel HTTP requests when a remote desktop goes full screen.
const agentQueue=[];
let agentSending=false;
async function drainAgentQueue(){
 if(agentSending)return;
 agentSending=true;
 try{
  while(agentQueue.length && state.agentEnabled && state.agentToken && !state.ended){
   const msg=agentQueue.shift();
   const response=await fetch(agentHost+'/input',{method:'POST',headers:{'Content-Type':'application/json','X-SecureLink-Token':state.agentToken},body:JSON.stringify(msg),mode:'cors',cache:'no-store',signal:AbortSignal.timeout(1700)});
   if(!response.ok)throw new Error('Windows helper unavailable');
  }
 }catch{
  state.agentEnabled=false;state.agentToken='';clearInterval(state.agentHeartbeat);
  setText('agent-status','Windows control paused. Screen sharing can continue in view-only mode.');broadcastControl(false);
 }finally{agentQueue.length=0;agentSending=false;}
}
function queueAgentInput(msg){
 if(msg.type==='move'){
  const last=agentQueue.length-1;
  if(last>=0 && agentQueue[last].type==='move')agentQueue[last]=msg;
  else if(agentQueue.length<12)agentQueue.push(msg);
 }else if(agentQueue.length<12)agentQueue.push(msg);
 void drainAgentQueue();
}
function onRemoteInput(msg){
 if(state.accessMode!=='assist'||!state.agentEnabled||!state.agentToken||!msg||!['move','click','key'].includes(msg.type))return;
 if(msg.type==='move'||msg.type==='click'){
  const x=Number(msg.x),y=Number(msg.y);
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1||y<0||y>1)return;
  const rect=el('stage').getBoundingClientRect();
  el('cursor-marker').style.left=x*rect.width+'px';el('cursor-marker').style.top=y*rect.height+'px';show('cursor-marker');
 }
 queueAgentInput(msg); // only after explicit Windows authorization
}
async function agentHeartbeat(){
 if(!state.agentEnabled||!state.agentToken)return;
 try{const response=await fetch(agentHost+'/heartbeat',{method:'POST',mode:'cors',cache:'no-store',headers:{'Content-Type':'application/json','X-SecureLink-Token':state.agentToken},body:'{}',signal:AbortSignal.timeout(1800)});
 if(!response.ok)throw new Error('Windows permission expired');}
 catch{state.agentEnabled=false;state.agentToken='';clearInterval(state.agentHeartbeat);setText('agent-status','Windows control stopped. Open app and approve again.');broadcastControl(false);}
}
function broadcastControl(enabled){if(state.channel?.readyState==='open')state.channel.send(JSON.stringify({type:'control',enabled:state.accessMode==='assist'&&!!enabled}));}
async function agentPair(){
 if(!state.stream){message('Start sharing your screen first.');return;}
 el('agent-pair').disabled=true;
 try{
  const r=await fetch(agentHost+'/pair',{method:'POST',mode:'cors',cache:'no-store',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(65000)});
  const d=await r.json();if(!r.ok||!d.token)throw new Error(d.message||'Incorrect app code.');
  state.agentToken=d.token;state.agentEnabled=true;show('retry-control',false);clearInterval(state.agentHeartbeat);state.agentHeartbeat=setInterval(agentHeartbeat,8000);setText('agent-status','PC CONTROL ON · Your helper can move the mouse and type until you end the session.');broadcastControl(true);message('Windows mouse + keyboard control enabled.');
  } catch(error){if(state.accessMode==='assist'&&state.role==='owner')show('retry-control');setText('agent-status','Full access is waiting. Open Career Crox SecureLink.exe on this employee laptop, then allow the Windows prompt. Screen viewing remains available.');message('Windows control was not enabled. Employee: run SecureLink.exe and allow Windows permission.');}
 finally{el('agent-pair').disabled=false;}
}
function videoPoint(event){
 const v=el('remote-video'),rect=v.getBoundingClientRect(),vw=v.videoWidth||rect.width,vh=v.videoHeight||rect.height;
 const ratio=Math.min(rect.width/vw,rect.height/vh),w=vw*ratio,h=vh*ratio,left=rect.left+(rect.width-w)/2,top=rect.top+(rect.height-h)/2;
 const x=(event.clientX-left)/w,y=(event.clientY-top)/h;
 if(x<0||x>1||y<0||y>1)return null;
 return{x:+x.toFixed(4),y:+y.toFixed(4)};
}
let lastMove=0;
el('remote-video').addEventListener('pointermove',event=>{
 if(state.role!=='helper'||!state.remoteControlReady||state.channel?.readyState!=='open'||state.channel.bufferedAmount>65536||Date.now()-lastMove<60)return;
 lastMove=Date.now();const p=videoPoint(event);if(p)state.channel.send(JSON.stringify({type:'move',...p}));
});
el('remote-video').addEventListener('click',event=>{
 if(state.role!=='helper'||state.channel?.readyState!=='open'||state.channel.bufferedAmount>65536)return;
 if(!state.remoteControlReady){if(state.accessMode==='assist')message('Waiting for employee Windows permission. Ask them to run SecureLink.exe and allow control.');return;}
 el('remote-video').focus?.({preventScroll:true});
 const p=videoPoint(event);if(p)state.channel.send(JSON.stringify({type:'click',...p,button:'left'}));
});
el('remote-video').addEventListener('contextmenu',event=>{
 if(state.role!=='helper'||!state.remoteControlReady||state.channel?.readyState!=='open')return;
 event.preventDefault();const p=videoPoint(event);if(p)state.channel.send(JSON.stringify({type:'click',...p,button:'right'}));
});
el('remote-video').tabIndex=0;
el('remote-video').addEventListener('keydown',event=>{
 if(state.role!=='helper'||!state.remoteControlReady||state.channel?.readyState!=='open'||event.metaKey||event.ctrlKey||event.altKey)return;
 if(event.key.length===1||['Backspace','Enter','Tab','Escape','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
   event.preventDefault();state.channel.send(JSON.stringify({type:'key',key:event.key}));
 }
});
async function poll(){
 if(!state.code||state.ended||state.signalBusy)return;
 state.signalBusy=true;
 try{
  const data=await request('GET','session?code='+encodeURIComponent(state.code)+'&since='+state.since+'&revision='+state.revision);
  if(state.ended)return;
  state.revision=Math.max(state.revision,Number(data.revision)||0);
  state.partner=data.partner||'';
  if(data.request_mode) setAccessMode(data.request_mode);
  if(state.role==='owner' && data.hasPartner&&!data.approved){setText('request-name',(data.partner||'Your colleague')+' is asking to view YOUR screen');show('permission');show('owner-wait',false);}
  if(state.role==='owner'&&!data.hasPartner){show('permission',false);if(!state.stream)show('owner-wait');}
  if(state.role==='helper'&&!data.approved)updateStage('Waiting for '+(data.partner||'the employee')+' to approve '+(state.accessMode==='assist'?'Full Assist Access':'View Screen Only')+'.');
  if(data.approved){setText('connected-person',state.role==='owner'?('Helping: '+data.partner):('Viewing: '+data.partner));if(state.role==='helper')show('session');}
  for(const item of data.messages||[]){
   state.since=Math.max(state.since,item.id);
   if(item.type==='offer' && state.role==='helper') await makeHelperPeer(item.payload);
   else if(item.type==='answer' && state.role==='owner' && state.peer?.signalingState==='have-local-offer') {await state.peer.setRemoteDescription(new RTCSessionDescription(item.payload));await flushIce();}
   else if(item.type==='ice') {if(state.peer?.remoteDescription) {try{await state.peer.addIceCandidate(new RTCIceCandidate(item.payload));}catch{}}else if(state.iceBuffer.length<80)state.iceBuffer.push(item.payload);}
   else if(item.type==='stop') await stop(false);
  }
 }catch(error){if(!state.ended){ if(/ended|expired|404/i.test(error.message))await stop(false);else setText('session-status','Trying to reconnect to SecureLink signaling…');}}
 // During active direct sharing, WebRTC carries the screen and control data.
 // Keep a rare auth/session heartbeat; do not hit Supabase every ~17 seconds.
 finally{state.signalBusy=false;if(state.code&&!state.ended&&!window.__CC602_NETWORK_PAUSED__)state.poll=setTimeout(poll,state.live && state.channel?.readyState==='open' ? 65000 : (document.hidden ? 5000 : 1500));}
}
function beginPoll(){clearTimeout(state.poll);void poll();}
async function stop(callServer=true){
 if(state.ended && !state.code)return;
 const code=state.code;state.requestNonce++;
 // Tell the other browser directly before closing our media channel.
 if(callServer && state.channel?.readyState==='open'){try{state.channel.send(JSON.stringify({type:'end'}));}catch{}}
 if(state.agentToken){const token=state.agentToken;fetch(agentHost+'/revoke',{method:'POST',mode:'cors',cache:'no-store',headers:{'Content-Type':'application/json','X-SecureLink-Token':token},body:'{}',keepalive:true}).catch(()=>{});}
 clearInterval(state.agentHeartbeat);state.agentHeartbeat=null;clearRecovery();state.recoveryAttempts=0;state.recoveryBusy=false;agentQueue.length=0;
 state.managerInviteId='';state.inviteId='';show('check-manager-status-live',false);clearTimeout(state.inviteStatusTimer);state.ended=true;state.remoteControlReady=false;state.controlPromptShown=false;state.autoAssistAttempted=false;state.fullscreenWanted=false;clearTimeout(revealViewerControls.timer);state.code='';state.since=0;state.revision=0;state.iceBuffer=[];state.remoteSeen=false;state.live=false;state.agentEnabled=false;state.agentToken='';
 clearTimeout(state.poll);state.poll=null;
 if(state.channel){try{state.channel.close();}catch{}state.channel=null;}
 if(state.peer){try{state.peer.close();}catch{}state.peer=null;}
 if(state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null;}
 el('remote-video').pause?.();el('remote-video').srcObject=null;el('local-video').pause?.();el('local-video').srcObject=null; el('stage').classList.remove('show-local');el('session').classList.remove('theatre-mode','fullscreen-fallback','controls-revealed');if(el('session').dataset)el('session').dataset.fullscreenFallback='0';if(document.fullscreenElement===el('session'))void document.exitFullscreen().catch(()=>{});setText('fullscreen','⛶ Full screen');
 show('session',false);show('app-panel',false);show('permission',false);show('cursor-marker',false);show('retry-control',false);
 setText('agent-status','Real PC control is OFF.');
 if(el('dock-mode'))setText('dock-mode',currentAccessMeta().label);
 if(callServer&&code){try{await request('POST','close',{code});}catch{}}
 if(state.role==='owner'){setText('my-code','••••');el('copy-code').disabled=true;show('owner-wait');setText('owner-wait','Session ended. Generate a new support code when you need help.');}
 else if(state.role==='helper')message('Support session ended.');
}
// SecureLink is a separate HTML page: honor the SAME 10-minute CRM lock.
// The browser guard closes the API session; close the direct WebRTC media and
// local Windows-agent heartbeat as well, even when no network poll was pending.
window.addEventListener('career-crox-idle-lock-begin',()=>{
 clearTimeout(state.inboxTimer);state.inboxTimer=null;
 clearTimeout(state.inviteStatusTimer);state.inviteStatusTimer=null;
 void stop(false);
});
// Internal manager workflow. The backend only provides signaling; screen pixels stay on direct WebRTC.
let inboxBusy=false,inviteStatusBusy=false;
// Employee picker is structural UI, never an API-dependent feature toggle.
// A failed or empty directory MUST NOT remove search, select, refresh or request controls.
function revealEmployeePicker(){
 show('staff-picker',true);show('manager-divider',true);
 el('connect-options').classList.remove('code-only');
 show('code-fallback',true);
}
async function loadStaff(force=false){
 const input=el('employee-search'),status=el('employee-load-status');
 revealEmployeePicker(); // synchronous UI: the picker is visible before any network work
 if(state.staffPeople.length){
   renderStaff(input.value||'');
   if(!force && Date.now()-state.staffCacheAt<10*60*1000){
     status.textContent=state.staffPeople.length+' teammates ready · search by name or choose from the list.';
     return;
   }
 }else{
   renderStaff(input.value||'');
   status.textContent='Loading teammates once… You can still enter a four-digit support code.';
 }
 if(state.staffLoading)return state.staffLoading;
 state.staffLoading=(async()=>{
   try{
     const d=await request('GET','directory');
     // Refuse unexpected payloads rather than making a working picker disappear.
     if(!Array.isArray(d.people))throw new Error('Employee directory returned an invalid response.');
     state.staffPeople=d.people;
     state.staffCacheAt=Date.now();
     renderStaff(input.value||'');
     status.textContent=d.people.length
       ? d.people.length+' teammates ready · search or select an employee.'
       : (d.empty_reason||'No employees available for this account. Use the four-digit code or retry.');
   }catch(error){
     renderStaff(input.value||''); // preserve the last successful, in-memory directory
     const denied=/Manager access required|403/i.test(String(error.message||''));
     status.textContent=denied
       ? 'Name-based requests require a Manager login. Sign in as Manager, or use a four-digit support code.'
       : state.staffPeople.length
         ? 'Saved teammate list available. Refresh names when the connection is working.'
         : 'Unable to load employee names: '+String(error.message||'Connection unavailable')+'. Use Refresh names to retry.';
   }finally{state.staffLoading=null;}
 })();
 return state.staffLoading;
}

function renderStaff(q){
 const select=el('employee-select'),old=select.value;
 const val=String(q||'').trim().toLowerCase();
 // A four-digit code is NOT an employee name. Keep the directory intact and
 // offer the direct code route rather than silently filtering every name out.
 const code=val.replace(/\s+/g,'');
 if(/^\d{4}$/.test(code)){
   el('input-code').value=code;
   el('code-fallback').classList.add('code-attention');
   setText('search-hint','Code detected. Use “Connect now” above to request a screen share.');
 } else {
   el('code-fallback').classList.remove('code-attention');
   setText('search-hint',val?'Choose a matching employee below.':'Search by employee name or username.');
 }
 select.replaceChildren(new Option(state.staffPeople.length?'Select an employee ('+state.staffPeople.length+')':'Waiting for employee names…',''));
 let visible=0;
 for(const p of state.staffPeople){
   const match=!val||/^\d{4}$/.test(code)||[p.name,p.username,p.role,p.user_id].some(x=>String(x||'').toLowerCase().includes(val));
   if(!match)continue;
   select.add(new Option(`${p.name} · ${p.role||'Employee'}`,p.user_id));visible++;
 }
 if(old && [...select.options].some(o=>o.value===old))select.value=old;
 else if(visible===1)select.selectedIndex=1; // One matching employee: select immediately, no extra click or request.
 select.disabled=visible===0;
 const count=el('employee-count');if(count)count.textContent=visible+' matching';
 el('request-employee').disabled=!select.value;
}
async function requestEmployee(){
 const employee_id=el('employee-select').value;
 if(!employee_id){message('Select an employee first.');return;}
 const requestNonce=++state.requestNonce;state.ended=false;
 // Preserve the existing real-fullscreen gesture for remote support while
 // keeping delivery status + manual status check visible INSIDE the viewer.
 state.fullscreenWanted=true;show('session');requestCleanFullscreen();
 show('check-manager-status-live',true);updateStage('Sending support request…');el('request-employee').disabled=true;
 try{
   const d=await request('POST','invite',{employee_id,access_mode:state.accessMode});
   if(state.requestNonce!==requestNonce||state.ended)return;
   state.managerInviteId=d.request_id;
   // A stored request is NOT proof that the employee has an active browser listener.
   // Show the delivery state, and an actionable manual fallback instead of misleading success.
   const accessLabel=state.accessMode==='assist'?'Full Assist Access':'View Screen Only';
   setText('manager-request-status',(d.delivery_live
     ? 'Request delivered to an active CRM/SecureLink window for '
     : 'Request saved for ')+d.employee+' · '+accessLabel+'. '+(d.delivery_live
       ? 'They can choose to allow your request. If the popup does not appear, ask them to open SecureLink → Check support requests.'
       : 'Their CRM is not currently connected for instant notifications. Ask them to open the SAME ONLINE CRM → SecureLink → Check support requests within 5 minutes. Both people must use the same online CRM server, not two separate LOCAL TEST servers.') );
   show('session',true);show('empty-stage',true);setText('live-indicator','WAITING FOR EMPLOYEE');
   updateStage(d.delivery_live?'Request sent to '+d.employee+'. They can approve the '+accessLabel+' request in SecureLink. If no popup appears, ask them to open SecureLink → Check support requests.':'Request saved for '+d.employee+', but they have NO ACTIVE popup connection. Ask them to open SecureLink → Check support requests on the SAME ONLINE CRM (not a separate LOCAL TEST server) within 5 minutes.');
   // Manager manually checks the pending invite rather than polling every ten seconds.
 }catch(e){if(state.requestNonce===requestNonce){show('check-manager-status-live',false);show('session',false);if(document.fullscreenElement===el('session'))void document.exitFullscreen?.().catch?.(()=>{});message(e.message);}}finally{el('request-employee').disabled=false;}
}
async function checkInviteStatus(){
 if(!state.managerInviteId||state.ended||inviteStatusBusy)return;
 inviteStatusBusy=true;
 try{
  const d=await request('GET','invite-status?request_id='+encodeURIComponent(state.managerInviteId));
  if(d.state==='accepted'&&d.session){
    await request('POST','join',{code:d.session});state.managerInviteId='';show('check-manager-status-live',false);
    state.code=d.session;state.since=0;state.revision=0;state.ended=false;
    state.fullscreenWanted=true;show('session',true);show('empty-stage',true);
    setText('live-indicator','WAITING FOR SCREEN');beginPoll();return;
  }
  if(d.state==='declined'){state.managerInviteId='';show('check-manager-status-live',false);message('Your colleague declined this request.');show('session',false);return;}
 }catch(e){message(e.message);updateStage('Unable to check request. Click Check Request Status to try again.');return;}
 finally{inviteStatusBusy=false;}
 // No automatic timer: Check Request Status manually after employee accepts.
}
async function checkInbox(){
 if(document.hidden || state.code || inboxBusy)return;
 inboxBusy=true;
 try{
  const d=await request('GET','inbox');
  const requests=Array.isArray(d.requests)?d.requests:[];
  // A repeated invitation may update View Only to Full Assist, so refresh the
  // employee consent label on receipt even when the same request is open.
  const invite=requests.find(x=>x.request_id===state.inviteId)||requests[0]||null;
  if(invite){
    state.inviteId=invite.request_id;
    setAccessMode(invite.access_mode||'view');
    state.role='owner';show('workspace');show('choices',false);show('owner-panel');show('helper-panel',false);
    show('employee-invite');el('owner-panel').classList.add('has-invite');show('owner-wait',false);show('permission',false);
    setText('employee-invite-title',invite.requester+' requested a SecureLink session');
    setText('mode-title','Support request');setText('mode-description','Your colleague cannot view your screen until you choose to share it.');
  }
  else if(state.inviteId){
    state.inviteId='';show('employee-invite',false);
    el('owner-panel').classList.remove('has-invite');
  }
 }catch(e){message('Support request check failed: '+e.message);}finally{inboxBusy=false;}
}
async function acceptEmployeeInvite(){
 if(!state.inviteId)return;
 const btn=el('allow-invite');btn.disabled=true;
 let stream;
 try{
   // Request native display selection inside the actual employee click gesture.
   const requestedMode=state.accessMode;
   stream=await navigator.mediaDevices.getDisplayMedia(captureOptions);
   // Never approve Full Assist on the basis of a stale View Only consent label.
   const d=await request('POST','accept-invite',{request_id:state.inviteId,request_mode:requestedMode});
   setAccessMode(d.access_mode);
   state.code=d.session;state.role='owner';state.since=0;state.revision=0;state.ended=false;
   state.inviteId='';el('owner-panel').classList.remove('has-invite');show('employee-invite',false);show('permission',false);
   await approve(stream);beginPoll();
 }catch(e){if(stream && !state.stream)stream.getTracks().forEach(t=>t.stop());if(/Access type changed/i.test(e.message)){void checkInbox();}message(e.name==='NotAllowedError'?'Screen sharing cancelled. Nothing was shared.':e.message);}
 finally{btn.disabled=false;}
}
async function declineEmployeeInvite(){
 const id=state.inviteId;state.inviteId='';el('owner-panel').classList.remove('has-invite');show('employee-invite',false);
 try{if(id)await request('POST','decline-invite',{request_id:id});}catch{};
 show('workspace',false);show('choices');message('Request declined. Nothing was shared.');
}
// Push updates only while this page is open. An explicit SecureLink navigation
// checks the tiny inbox ONCE to recover an invitation sent while the tab was closed
// or the push connection temporarily dropped; it never polls in the background.
let secureEvents=null;
let firstInboxChecked=false;
function checkInboxOnFirstOpen(){
 if(firstInboxChecked||document.hidden||window.__CC602_NETWORK_PAUSED__)return;
 firstInboxChecked=true;
 void checkInbox();
}
function startSecureEvents(){
 if(secureEvents||document.hidden||window.__CC602_NETWORK_PAUSED__||!window.EventSource)return;
 if(window.__CC621_NIGHT_QUIET__?.()&&!state.code&&!state.managerInviteId&&!state.inviteId)return;
 secureEvents=new EventSource('/api/securelink/events');
 secureEvents.onopen=()=>{ // Recover a lost notification on this foreground connection only.
   if(state.managerInviteId)void checkInviteStatus();
   checkInboxOnFirstOpen();
 };
 secureEvents.onerror=()=>{secureEvents?.close();secureEvents=null;};
 secureEvents.onmessage=e=>{try{const d=JSON.parse(e.data);
   if(d.kind==='invite')void checkInbox();
   if((d.kind==='invite-accepted'||d.kind==='invite-declined') && state.managerInviteId && d.request_id===state.managerInviteId)void checkInviteStatus();
   if(d.kind==='code-request' && state.code)void poll();
 }catch(_){}};
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){secureEvents?.close();secureEvents=null;}else{startSecureEvents();checkInboxOnFirstOpen();}});
window.addEventListener('pagehide',()=>secureEvents?.close(),{once:true});
window.addEventListener('cc:network-paused',()=>{secureEvents?.close();secureEvents=null;});
window.addEventListener('cc621:night-quiet',()=>{if(!state.code&&!state.managerInviteId&&!state.inviteId){secureEvents?.close();secureEvents=null;}});
startSecureEvents();
// A single small inbox GET when the employee opens SecureLink, regardless of whether
// an SSE notification was received. A lost push must not hide an existing invite.
checkInboxOnFirstOpen();
// No repeating background inbox checks: further checks are manual or actual push events.
setAccessMode(state.accessMode);
autoWire();
function autoWire(){
 el('check-invites').onclick=()=>void checkInbox();
 el('check-manager-status').onclick=()=>void checkInviteStatus();el('check-manager-status-live').onclick=()=>void checkInviteStatus();
 el('owner-choice').onclick=()=>{role('owner');void checkInbox();};el('helper-choice').onclick=()=>{role('helper');revealEmployeePicker();void loadStaff();};
 el('employee-search').oninput=e=>renderStaff(e.target.value);el('request-employee').onclick=requestEmployee;el('employee-select').onchange=()=>{el('request-employee').disabled=!el('employee-select').value;};el('employee-refresh').onclick=()=>void loadStaff(true);el('allow-invite').onclick=acceptEmployeeInvite;el('decline-invite').onclick=declineEmployeeInvite;
 el('change-role').onclick=()=>{state.inviteId='';state.managerInviteId='';clearTimeout(state.inviteStatusTimer);void stop();show('workspace',false);show('choices');state.role='';};
 document.querySelectorAll('[data-access-mode]').forEach(btn=>btn.onclick=()=>setAccessMode(btn.dataset.accessMode));
 el('generate').onclick=openCode;el('connect').onclick=joinCode;el('approve').onclick=()=>approve();
 el('reject').onclick=()=>{void stop();message('You rejected the request. No screen was shared.');};
 el('stop').onclick=()=>void stop();el('agent-pair').onclick=agentPair;el('retry-control').onclick=()=>void agentPair();el('quick-stop').onclick=()=>void stop();el('quick-fullscreen').onclick=()=>el('fullscreen').click();
 el('session').addEventListener('pointermove',event=>{if(state.role==='helper'&&event.clientX>innerWidth-115&&event.clientY<110)revealViewerControls();});
 el('session-dock').addEventListener('pointerenter',()=>{clearTimeout(revealViewerControls.timer);el('session').classList.add('controls-revealed');});
 el('session-dock').addEventListener('pointerleave',()=>{revealViewerControls.timer=setTimeout(()=>el('session').classList.remove('controls-revealed'),1700);});
 document.addEventListener('keydown',event=>{if(state.role==='helper'&&state.code&&event.ctrlKey&&event.shiftKey&&event.key.toLowerCase()==='e'){event.preventDefault();revealViewerControls();}});
 el('copy-code').onclick=async()=>{try{await navigator.clipboard.writeText(state.code);message('Your code copied. Send it to the helper.');}catch{message('Copy unavailable. Read the code aloud.');}};
 const screenPanel=el('session');
 const syncFullscreen=()=>{
   const native=document.fullscreenElement===screenPanel;
   screenPanel.classList.toggle('fullscreen-fallback',!native&&screenPanel.dataset.fullscreenFallback==='1');
   setText('fullscreen',native?'↙ Exit full screen':screenPanel.dataset.fullscreenFallback==='1'?'↙ Exit expanded view (native fullscreen unavailable)':'⛶ Full screen');
 };
 document.addEventListener('fullscreenchange',()=>{
   screenPanel.dataset.fullscreenFallback='0';
   syncFullscreen();
 });
 el('fullscreen').onclick=async()=>{
   if(state.role==='owner'){message('Your own preview remains hidden to prevent screen mirroring. Your helper can view the shared screen in full screen.');return;}
   if(document.fullscreenElement===screenPanel){try{await document.exitFullscreen();}catch{}syncFullscreen();return;}
   if(screenPanel.dataset.fullscreenFallback==='1'){screenPanel.dataset.fullscreenFallback='0';syncFullscreen();return;}
   try{
     if(!screenPanel.requestFullscreen)throw new Error('Native fullscreen is unavailable');
     await screenPanel.requestFullscreen({navigationUI:'hide'});
   }catch{
     // Embedded browsers sometimes deny native fullscreen; retain a full-viewport alternative.
     screenPanel.dataset.fullscreenFallback='1';
   }
   syncFullscreen();
 };
 document.addEventListener('keydown',event=>{
   if(event.key==='Escape'&&screenPanel.dataset.fullscreenFallback==='1'){
     screenPanel.dataset.fullscreenFallback='0';syncFullscreen();
   }
 });
 el('refresh-video').onclick=()=>{
  if(state.role==='helper' && state.channel?.readyState==='open'){
   state.channel.send(JSON.stringify({type:'refresh'}));
   updateStage('Requested a fresh direct video connection. Your colleague does not need to share the screen again.');
  }else if(state.role==='owner' && state.peer)void recoverPeer(state.peer,{manual:true});
  else message('Connect to a colleague first to refresh the video.');
 };
 el('input-code').oninput=event=>{event.target.value=event.target.value.replace(/\D/g,'').slice(0,4);};
 el('input-code').onkeydown=event=>{if(event.key==='Enter')joinCode();};
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.code)void poll();});
 window.addEventListener('pagehide',()=>{if(state.code)navigator.sendBeacon?.('/api/securelink/close',new Blob([JSON.stringify({code:state.code})],{type:'application/json'}));});
}
})();
