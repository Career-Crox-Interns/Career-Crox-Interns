import { readPersonalSettings } from './personalSettings';
export const SOUND_PRESETS = [
  { id: 'soft-hop', label: 'Soft Hop', notes: [659, 784, 988], wave: 'sine', spacing: 0.08, hold: 0.16, glide: 1.01 },
  { id: 'desk-bell', label: 'Desk Bell', notes: [523, 659, 784], wave: 'triangle', spacing: 0.11, hold: 0.22, accent: 1.18 },
  { id: 'mint-pop', label: 'Mint Pop', notes: [784, 932, 1175], wave: 'triangle' },
  { id: 'metro-chip', label: 'Metro Chip', notes: [587, 659, 880], wave: 'square', spacing: 0.045, hold: 0.1, detune_step: 6 },
  { id: 'peppy-ring', label: 'Peppy Ring', notes: [740, 988, 1244], wave: 'sine' },
  { id: 'comic-bloop', label: 'Comic Bloop', notes: [440, 659, 523, 784], wave: 'triangle', spacing: 0.07, hold: 0.14, glide: 1.03 },
  { id: 'glass-pop', label: 'Glass Pop', notes: [988, 1319, 1568], wave: 'sine' },
  { id: 'tiny-trumpet', label: 'Tiny Trumpet', notes: [392, 523, 659], wave: 'square', spacing: 0.09, hold: 0.2, accent: 1.2 },
  { id: 'happy-zing', label: 'Happy Zing', notes: [659, 831, 988, 1319], wave: 'triangle' },
  { id: 'office-fizz', label: 'Office Fizz', notes: [523, 698, 880, 988], wave: 'sine' },
  { id: 'spark-loop', label: 'Spark Loop', notes: [784, 698, 784, 1047], wave: 'triangle' },
  { id: 'smart-ping', label: 'Smart Ping', notes: [622, 831, 1244], wave: 'sine' },
  { id: 'lift-up', label: 'Lift Up', notes: [494, 587, 740, 988], wave: 'triangle' },
  { id: 'mini-marimba', label: 'Mini Marimba', notes: [523, 659, 523, 784], wave: 'sine' },
  { id: 'arcade-lite', label: 'Arcade Lite', notes: [784, 1047, 784, 1319], wave: 'square' },
  { id: 'paper-plane', label: 'Paper Plane', notes: [523, 587, 784, 1175], wave: 'triangle' },
  { id: 'quick-wink', label: 'Quick Wink', notes: [988, 880, 1175], wave: 'sine' },
  { id: 'bubble-step', label: 'Bubble Step', notes: [523, 784, 698, 1047], wave: 'triangle' },
  { id: 'ping-puff', label: 'Ping Puff', notes: [698, 880, 698, 988], wave: 'sine' },
  { id: 'sunny-tap', label: 'Sunny Tap', notes: [587, 784, 988, 1175], wave: 'triangle' },
  { id: 'chime-roll', label: 'Chime Roll', notes: [523, 659, 784, 988, 1319], wave: 'sine', spacing: 0.055, hold: 0.12, glide: 1.02, accent: 1.1 },
  { id: 'soft-robot', label: 'Soft Robot', notes: [440, 523, 659, 523], wave: 'square' },
  { id: 'cheer-dot', label: 'Cheer Dot', notes: [659, 880, 1109], wave: 'triangle' },
  { id: 'wink-bell', label: 'Soft Bell', notes: [784, 1175, 988], wave: 'sine' },
  { id: 'office-tone', label: 'Office Tone', notes: [523, 659, 831, 1047], wave: 'triangle' },
];

let audioContext;
let lastPlayed=0;
const announced = new Set();
function announcementKey(key) {
  if (!key) return '';
  let principal = 'signed-out';
  try { const user = JSON.parse(localStorage.getItem('careerCroxCachedUser') || '{}'); principal = user.user_id || user.username || principal; } catch {}
  const session = localStorage.getItem('careerCroxSessionLoginAt') || '';
  return `${principal}:${session}:${key}`;
}
export async function playNotificationSound(forcedId='',preview=false,eventKey='') {
  if(!preview && (window.__CC602_NETWORK_PAUSED__ || !localStorage.getItem('careerCroxCachedUser')))return false;
  const key = !preview ? announcementKey(eventKey) : '';
  if (key && announced.has(key)) return false;
  if (key) {
    try { if (localStorage.getItem(`cc56-sound:${key}`)) return false; } catch {}
  }
  const p=readPersonalSettings();
  if ((!preview && Date.now()-lastPlayed<650) || p.sound==='silent' || p.soundVolume===0) return false;
  const AudioCtx=window.AudioContext||window.webkitAudioContext;
  if (!AudioCtx) return false;
  const selected=SOUND_PRESETS.find(item=>item.id===(forcedId||p.sound))||SOUND_PRESETS[SOUND_PRESETS.length-1];
  try {
    audioContext ||= new AudioCtx();
    if(audioContext.state==='suspended') await audioContext.resume();
    if(audioContext.state!=='running') return false;
    if (key) { try { if (localStorage.getItem(`cc56-sound:${key}`)) return false; } catch {} }
    lastPlayed=Date.now();
    if (key) {
      announced.add(key);
      if (announced.size > 1000) announced.delete(announced.values().next().value);
      try { localStorage.setItem(`cc56-sound:${key}`, '1'); } catch {}
    }
    const ctx=audioContext,start=ctx.currentTime,spacing=selected.spacing||.075,hold=selected.hold||.17;
    selected.notes.forEach((freq,index)=>{
      const osc=ctx.createOscillator(),gain=ctx.createGain(),at=start+index*spacing;
      osc.type=selected.wave||'sine';osc.frequency.setValueAtTime(freq,at);
      gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(Math.max(.0002,.036*p.soundVolume/100),at+.02);gain.gain.exponentialRampToValueAtTime(.0001,at+hold);
      osc.connect(gain);gain.connect(ctx.destination);osc.start(at);osc.stop(at+hold+.02);
      osc.onended=()=>{osc.disconnect();gain.disconnect();};
    });
    return true;
  } catch { return false; }
}
window.__CC787_PLAY_SOUND__=(eventKey='')=>playNotificationSound('',false,eventKey);

function unlockAudio(event) {
  if(!event.isTrusted)return;
  try {const AudioCtx=window.AudioContext||window.webkitAudioContext;if(AudioCtx){audioContext ||= new AudioCtx();if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});}}catch{}
  window.removeEventListener('pointerdown',unlockAudio);window.removeEventListener('keydown',unlockAudio);
}
window.addEventListener('pointerdown',unlockAudio,{passive:true});window.addEventListener('keydown',unlockAudio);
