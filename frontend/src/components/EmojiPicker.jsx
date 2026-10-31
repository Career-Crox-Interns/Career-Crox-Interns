import React, { useEffect, useMemo, useRef, useState } from 'react';
import EmojiGlyph from './EmojiGlyph';
import { cachePrincipal } from '../lib/api';

const GROUPS = [
  { name: 'Smileys', icon: '😊', emojis: '😀 grin|😃 happy|😄 smile|😁 beam|😆 laugh|😅 sweat smile|😂 joy laugh|🤣 laugh rolling|🥹 tears grateful|😊 blush happy|😇 angel|🙂 smile|🙃 upside down|😉 wink|😍 love eyes|🥰 love|😘 kiss|😎 cool|🤩 star excited|🥳 party|😋 yummy|😜 playful|🤔 thinking|🤫 quiet|🫡 salute|🤝 handshake|😮 surprise|😴 sleepy|😔 sad|😭 cry|😤 frustrated|🫠 melting' },
  { name: 'Gestures', icon: '👍', emojis: '👍 yes like|👎 no dislike|👏 clap|🙌 celebrate|👐 open hands|🤲 hands|🙏 thanks please|🤟 love you|✌️ peace|🤞 fingers crossed|🤌 perfect|👌 okay|💪 strong|👋 hello wave|🫶 heart hands|🫰 finger heart|👀 eyes looking|🧠 brain smart' },
  { name: 'Hearts', icon: '💜', emojis: '❤️ heart love|🧡 orange heart|💛 yellow heart|💚 green heart|💙 blue heart|💜 purple heart|🩷 pink heart|🩵 light blue heart|🤍 white heart|🖤 black heart|💖 sparkling heart|💕 two hearts|💞 revolving hearts|💓 heartbeat|💝 gift heart|💯 hundred|✨ sparkle|🔥 fire|🌟 star|💫 dizzy|🧿 evil eye' },
  { name: 'Work & fun', icon: '🎉', emojis: '🎉 party celebrate|🎊 confetti|🏆 trophy success|🥇 medal first|🎯 target goal|🚀 rocket launch|💼 work office|📞 phone call|📱 mobile phone|✅ done check|📌 pin|📅 calendar|⏰ clock time|📝 note|💡 idea light|📊 report chart|🙋 question|🌈 rainbow|☀️ sun|🌸 flower|🍀 luck|☕ coffee|🎁 gift|🎂 birthday cake|🎵 music|💻 computer' },
].map(group => ({ ...group, items: group.emojis.split('|').map(item => { const [emoji, ...words] = item.split(' '); return { emoji, name: words.join(' ') }; }) }));
const ALL = GROUPS.flatMap(group => group.items);

export default function EmojiPicker({ onPick, onClose }) {
  const [category, setCategory] = useState('Smileys');
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState(() => { try { const saved = JSON.parse(localStorage.getItem(`cc785-emojis:${cachePrincipal()}`) || '[]'); return Array.isArray(saved) ? saved.filter(value => ALL.some(item => item.emoji === value)).slice(0, 24) : []; } catch { return []; } });
  const root = useRef(null);
  const search = useRef(null);
  const items = useMemo(() => query ? ALL.filter(item => item.name.includes(query.toLowerCase()) || item.emoji.includes(query)) : category === 'Recent' ? recent.map(emoji => ALL.find(item => item.emoji === emoji)).filter(Boolean) : GROUPS.find(group => group.name === category).items, [category, query, recent]);
  useEffect(() => {
    search.current?.focus({ preventScroll: true });
    const close = event => { if (!root.current?.contains(event.target) && !event.target.closest('.emojiToggle')) onClose(); };
    const escape = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } };
    document.addEventListener('pointerdown', close, true); document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', escape, true); };
  }, [onClose]);
  function pick(emoji) {
    const next = [emoji, ...recent.filter(value => value !== emoji)].slice(0, 24); setRecent(next);
    try { localStorage.setItem(`cc785-emojis:${cachePrincipal()}`, JSON.stringify(next)); } catch {}
    onPick(emoji);
  }
  return <div ref={root} className="cc785-emoji-picker" role="dialog" aria-label="Emoji picker">
    <div className="cc785-emoji-head"><strong>Make it expressive</strong><button type="button" onClick={onClose} aria-label="Close emoji picker">×</button></div>
    <input ref={search} className="cc785-emoji-search" aria-label="Search emojis" placeholder="Search smile, love, work…" value={query} onChange={event => setQuery(event.target.value)}/>
    <div className="cc785-emoji-tabs" aria-label="Emoji categories"><button type="button" title="Recent" aria-label="Recent emojis" aria-pressed={category === 'Recent'} onClick={() => { setCategory('Recent'); setQuery(''); }}>◷</button>{GROUPS.map(group => <button type="button" key={group.name} title={group.name} aria-label={group.name} aria-pressed={category === group.name} onClick={() => { setCategory(group.name); setQuery(''); }}><EmojiGlyph value={group.icon}/></button>)}</div>
    <div className="cc785-emoji-caption">{query ? 'Search results' : category}</div>
    <div className="cc785-emoji-grid">{items.map(item => <button type="button" key={item.emoji} title={item.name} aria-label={item.name} onClick={() => pick(item.emoji)}><EmojiGlyph value={item.emoji}/></button>)}</div>
    {!items.length && <p className="cc785-select-empty">{query ? 'No emoji found. Try another word.' : 'Your recently used emojis appear here.'}</p>}
  </div>;
}
