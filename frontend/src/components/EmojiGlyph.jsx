import React, { useId } from 'react';

// Small local vector emoji: colourful on every device, with no CDN or font
// dependency. The actual message still stores standard Unicode emoji.
const HEARTS = { '❤️':'#ef476f','🧡':'#ff9347','💛':'#f7cb3c','💚':'#4bbd7b','💙':'#4d9de0','💜':'#9b6be6','🩷':'#ff97bd','🩵':'#77d8ee','🤍':'#edf2fa','🖤':'#39435d' };
const heartPath = 'M12 21C10 19 2 13 2 7.5C2 2 9 1 12 6C15 1 22 2 22 7.5C22 13 14 19 12 21Z';
const colourSupport = new Map();
let emojiCanvas;
function hasColourGlyph(value) {
  if (colourSupport.has(value)) return colourSupport.get(value);
  let supported = false;
  try {
    emojiCanvas ||= document.createElement('canvas'); emojiCanvas.width = 40; emojiCanvas.height = 40;
    const context = emojiCanvas.getContext('2d', { willReadFrequently: true });
    context.font = '28px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    context.fillStyle = '#000'; context.fillText(value, 2, 30);
    const pixels = context.getImageData(0, 0, 40, 40).data;
    for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 3] > 80 && Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) - Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) > 35) { supported = true; break; }
  } catch {}
  colourSupport.set(value, supported); return supported;
}
const SYMBOLS = {
  '✅':<><rect x="2" y="2" width="20" height="20" rx="6" fill="#45bd86"/><path d="m6 12 4 4 8-8" fill="none" stroke="#fff" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round"/></>,
  '💯':<><rect x="1" y="3" width="22" height="18" rx="6" fill="#ffe1ec"/><text x="12" y="16" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="12" fontWeight="700" fill="#e94870">100</text><path d="m5 18 14-1" stroke="#e94870" strokeWidth="1.5"/></>,
  '🎯':<><circle cx="11" cy="13" r="10" fill="#ef607c"/><circle cx="11" cy="13" r="6.5" fill="#fff"/><circle cx="11" cy="13" r="3" fill="#ef607c"/><path d="m11 13 10-10m-1 0 2-1 1 4-4 1" stroke="#5273cc" strokeWidth="2" strokeLinecap="round"/></>,
  '📞':<path d="M5 2C2 2 1 6 4 11S13 22 18 22C20 22 23 18 22 17L17 13L14 16C11 15 8 12 7 9L10 6L6 2Z" fill="#50b990" stroke="#249b79" strokeWidth="1"/>,
  '💻':<><rect x="3" y="3" width="18" height="14" rx="2" fill="#648be4"/><rect x="5" y="5" width="14" height="10" rx="1" fill="#bbebff"/><path d="M1 18h22v3H1Z" fill="#919cb7"/></>,
  '📱':<><rect x="5" y="1" width="14" height="22" rx="3" fill="#647597"/><rect x="7" y="4" width="10" height="14" rx="1" fill="#8de8df"/><circle cx="12" cy="20" r="1" fill="#e6efff"/></>,
  '💼':<><path d="M8 6V3h8v3" stroke="#af714b" strokeWidth="2" fill="none"/><rect x="2" y="6" width="20" height="16" rx="3" fill="#cd956b"/><path d="M2 12h20" stroke="#945b3b"/><rect x="10" y="10" width="4" height="5" rx="1" fill="#ffd574"/></>,
  '📊':<><rect x="2" y="2" width="20" height="20" rx="4" fill="#e6f2ff"/><path d="M6 18v-5m6 5V8m6 10V5" strokeWidth="4" strokeLinecap="round" stroke="#629ce6"/><path d="M6 18v-5" stroke="#fba776" strokeWidth="4" strokeLinecap="round"/><path d="M18 18V5" stroke="#70c9a9" strokeWidth="4" strokeLinecap="round"/></>,
  '🎁':<><rect x="3" y="9" width="18" height="13" rx="2" fill="#ef719c"/><rect x="2" y="7" width="20" height="5" rx="2" fill="#ff96b5"/><path d="M12 7v15M12 7C5 7 4 2 8 2c3 0 4 5 4 5C19 7 20 2 16 2c-3 0-4 5-4 5Z" fill="none" stroke="#ffdd84" strokeWidth="2.6"/></>,
  '☕':<><path d="M4 9h13v10c0 5-13 5-13 0Z" fill="#e4eaf7"/><path d="M17 11h3c4 0 3 7-3 7" fill="none" stroke="#c4d0e7" strokeWidth="2"/><path d="M7 8v-5m5 5V2" stroke="#b0bfd5" strokeWidth="1.6" strokeLinecap="round"/><path d="M2 23h18" stroke="#aab8cc" strokeWidth="1.5"/></>,
  '💡':<><path d="M8 17C8 13 4 12 4 8a8 8 0 0 1 16 0c0 4-4 5-4 9Z" fill="#ffd366"/><path d="M9 18h6v5H9Z" fill="#a7b9d6"/><path d="m9 8 3 3 3-3m-3 3v6" stroke="#e7ac38" strokeWidth="1.5" fill="none"/></>,
  '⏰':<><circle cx="12" cy="13" r="9" fill="#f98494"/><circle cx="12" cy="13" r="6.5" fill="#fff5e9"/><path d="M12 8v5l3 2M3 4l3-2m12 0 3 2M6 21l-2 2m14-2 2 2" stroke="#7a7699" strokeWidth="2" strokeLinecap="round"/></>,
  '📅':<><rect x="2" y="3" width="20" height="19" rx="3" fill="#e6f0ff"/><path d="M2 7h20" stroke="#ef7895" strokeWidth="7"/><path d="M7 1v5m10-5v5" stroke="#7b88ad" strokeWidth="2" strokeLinecap="round"/><text x="12" y="18" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="10" fontWeight="700" fill="#5b74a1">12</text></>,
  '📌':<><path d="m8 2 12 4-4 5 3 5-10-3-5 1 5-5Z" fill="#f5788d"/><path d="m9 13-6 9" stroke="#96a5c5" strokeWidth="2"/></>,
  '🧿':<><circle cx="12" cy="12" r="11" fill="#5071d0"/><circle cx="12" cy="12" r="7" fill="#fff"/><circle cx="12" cy="12" r="4.5" fill="#73d4ef"/><circle cx="12" cy="12" r="2.3" fill="#2d4477"/></>,
};

export default function EmojiGlyph({ value, className = '' }) {
  const id = useId().replace(/:/g, '');
  const heart = HEARTS[value] || (/[💖💕💞💓💝🫶🫰🤟]/u.test(value) ? '#f68fae' : null);
  const star = /[✨🌟💫🥇🏆🍀🌸]/u.test(value);
  const celebrate = /[🎉🎊🎵🎂🚀🌈☀️]/u.test(value);
  const hand = /[👍👎👏🙌👐🤲🙏✌️🤞🤌👌💪👋🤝🙋]/u.test(value);
  const eyesClosed = /[😆😅😂🤣😊😇😴😔😭😋]/u.test(value);
  const love = /[😍🥰😘🤩]/u.test(value);
  const sad = /[😔😭😤]/u.test(value);
  const shocked = /[😮🤫]/u.test(value);
  const sunglass = value === '😎';
  const contents = SYMBOLS[value] || (heart ? <><path d={heartPath} fill={heart} stroke="#00000015" strokeWidth=".7"/><path d="M5 8c0-4 4-4 5-2" fill="none" stroke="#ffffff90" strokeWidth="1.8" strokeLinecap="round"/></> : star ? <><path d="m12 1 3.3 6.7L23 9l-5.5 5.5L19 22l-7-3.5L5 22l1.5-7.5L1 9l7.7-1.3Z" fill="#ffd064" stroke="#f4b941" strokeWidth=".8"/><path d="m12 4 1 4" stroke="#fff4b9" strokeWidth="2" strokeLinecap="round"/></> : celebrate ? <><path d="m3 22 4-15 12 11Z" fill="#f9b15d"/><path d="m7 8 11 10" stroke="#f885a4" strokeWidth="3"/><path d="m12 3 1 5m6-5-2 6m6 1-5 3" stroke="#a18ae9" strokeWidth="2" strokeLinecap="round"/><circle cx="5" cy="3" r="1.5" fill="#81cce5"/><circle cx="22" cy="16" r="1.5" fill="#f38ba7"/></> : hand ? <><path d="M9 20V10l3-8c3-1 4 2 3 5l-1 3h6c4 0 1 11-2 11H9Z" fill="#ffc76b" stroke="#edab4f" strokeWidth=".8"/><rect x="3" y="11" width="5" height="11" rx="2" fill="#79acef"/><path d="M12 13h6" stroke="#ffdf9e" strokeWidth="1.5" strokeLinecap="round"/></> : <>
    <circle cx="12" cy="12" r="11" fill={`url(#${id})`} stroke="#edb43e" strokeWidth=".6"/>
    <path d="M5 8c2-5 9-6 13-2" fill="none" stroke="#fff2a5" strokeWidth="1.7" strokeLinecap="round" opacity=".8"/>
    {sunglass ? <><path d="M3.5 8h7v4h-6ZM13.5 8h7l-1 4h-6Z" fill="#414b72"/><path d="M10 9h4" stroke="#414b72" strokeWidth="1.3"/></> : love ? <><path d="M5 8c-2-3 4-4 3 0-1 2-2 2-3 0Zm11 0c-2-3 4-4 3 0-1 2-2 2-3 0Z" fill="#e87593"/></> : eyesClosed ? <><path d="m5 10 2-2 2 2m6 0 2-2 2 2" stroke="#735027" strokeWidth="1.5" fill="none" strokeLinecap="round"/></> : <><ellipse cx="7.5" cy="10" rx="1.15" ry="1.6" fill="#735027"/><ellipse cx="16.5" cy="10" rx="1.15" ry="1.6" fill="#735027"/></>}
    {sad ? <path d="M7 18q5-6 10 0" stroke="#735027" strokeWidth="1.5" fill="none" strokeLinecap="round"/> : shocked ? <ellipse cx="12" cy="17" rx="2" ry="3" fill="#855427"/> : <><path d="M6.5 14h11c-1 7-10 7-11 0Z" fill="#855427"/><path d="M8 15h8" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/><path d="M10 18h4" stroke="#f98b86" strokeWidth="1.4" strokeLinecap="round"/></>}
    {/[😂🤣😭🥹]/u.test(value) && <><path d="M3 10c-3 5 3 5 2 1" fill="#70c7f0"/><path d="M21 10c3 5-3 5-2 1" fill="#70c7f0"/></>}
    {value === '😇' && <ellipse cx="12" cy="2.5" rx="8" ry="2" stroke="#81cde9" strokeWidth="1.7" fill="none"/>}
    {value === '🥳' && <path d="M15 6 18 1l5 6Z" fill="#ed80b1"/>}
  </>);
  return hasColourGlyph(value) ? <span className="cc785-native-emoji" aria-hidden="true">{value}</span> : <svg className={`cc785-emoji-glyph ${className}`} aria-hidden="true" viewBox="0 0 24 24"><defs><linearGradient id={id} x2="0" y2="1"><stop stopColor="#ffe67c"/><stop offset="1" stopColor="#ffc24a"/></linearGradient></defs>{contents}</svg>;
}

// Standard Unicode remains in the message/draft. Only the displayed glyph is
// substituted on devices without a colour emoji font; no remote assets needed.
export function EmojiText({ text }) {
  const value=String(text||'');
  if(!/\p{Extended_Pictographic}/u.test(value)||typeof Intl.Segmenter!=='function')return value;
  const segments=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(value)];
  return segments.map(({segment,index})=>/\p{Extended_Pictographic}/u.test(segment)?<span className="cc787-emoji-inline" key={index} role="img" aria-label={segment}><EmojiGlyph value={segment}/></span>:segment);
}

// Shared, crisp action glyphs. Inline vectors make no image/CDN requests.
export function ActionGlyph({kind='phone',size=19}) {
  return <svg className="cc791-action-glyph" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind==='whatsapp' ? <><path d="M20.6 11.8a8.6 8.6 0 0 1-12.8 7.5l-4.2 1.2 1.2-4.1A8.6 8.6 0 1 1 20.6 11.8Z"/><path d="m9 8 .9 2-1 .9c.8 1.8 2.2 3.2 4 4l.9-1 2 .9c.1 1.4-1.3 2.1-2.4 1.7-3.1-1-5.5-3.4-6.4-6.4-.3-1.2.5-2.3 2-2.1Z"/></> : kind==='chat' ? <><path d="M20 11.5a8.2 8.2 0 0 1-12.5 7.1L3 20l1.4-4.5A8.2 8.2 0 1 1 20 11.5Z"/><path d="M8 10h8m-8 4h5"/></> : <><path d="M6.3 3.5h2.4l1.7 4.1-2.1 1.8a14.6 14.6 0 0 0 6.3 6.3l1.8-2.1 4.1 1.7v2.4a2.2 2.2 0 0 1-2.3 2.2A16.1 16.1 0 0 1 4.1 5.8a2.2 2.2 0 0 1 2.2-2.3Z"/><path d="M15 4a6.8 6.8 0 0 1 5 5M15 7a3.8 3.8 0 0 1 2 2"/></>}
  </svg>;
}
