import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { useAuth } from '../lib/auth';

const CHAT_THEMES = [
  { key: 'green-bloom', label: 'Green', preview: 'green' },
  { key: 'pink-pop', label: 'Pink', preview: 'pink' },
  { key: 'purple-glow', label: 'Purple', preview: 'purple' },
  { key: 'sky-frost', label: 'Sky Blue', preview: 'sky' },
  { key: 'red-pulse', label: 'Red', preview: 'red' },
  { key: 'white-frost', label: 'White', preview: 'white' },
  { key: 'black-night', label: 'Black', preview: 'black' },
];

const EMOJI_STORAGE_KEY = 'careerCroxRecentEmojis';
const CHAT_SNAPSHOT_MESSAGE_LIMIT = 2600;
const CHAT_SNAPSHOT_SELECTED_LIMIT = 2200;
const CHAT_SNAPSHOT_RECENT_LIMIT = 500;
const CHAT_SNAPSHOT_ONLY_MAX_AGE_MS = 30 * 60 * 1000;
const chatSnapshotKey = (username) => `careerCroxChatSnapshot:${String(username || 'guest').toLowerCase()}`;

function readChatSnapshot(username) {
  try {
    const parsed = JSON.parse(localStorage.getItem(chatSnapshotKey(username)) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function trimSnapshotMessages(messages, selectedThread) {
  const all = Array.isArray(messages) ? messages : [];
  const selected = String(selectedThread || 'team');
  const recent = all.slice(-CHAT_SNAPSHOT_RECENT_LIMIT);
  const selectedRows = all.filter((item) => String(item?.thread_key || 'team') === selected).slice(-CHAT_SNAPSHOT_SELECTED_LIMIT);
  const merged = new Map();
  for (const item of [...recent, ...selectedRows]) {
    const key = String(item?.id || '');
    if (!key) continue;
    merged.set(key, item);
  }
  const next = [...merged.values()].sort((a, b) => {
    const timeDiff = String(a?.created_at || '').localeCompare(String(b?.created_at || ''));
    if (timeDiff !== 0) return timeDiff;
    return Number(a?.id || 0) - Number(b?.id || 0);
  });
  return next.slice(-CHAT_SNAPSHOT_MESSAGE_LIMIT);
}

function saveChatSnapshot(username, payload) {
  try {
    const safePayload = {
      groups: Array.isArray(payload?.groups) ? payload.groups : [],
      messages: trimSnapshotMessages(payload?.messages, payload?.selected),
      selected: String(payload?.selected || 'team'),
      saved_at: Number(payload?.saved_at || Date.now()),
    };
    localStorage.setItem(chatSnapshotKey(username), JSON.stringify(safePayload));
  } catch {
    // ignore local storage errors
  }
}

const EMOJI_CATEGORIES = [
  { key: 'smileys', icon: '😀', label: 'Smileys & People', items: ['😀','😃','😄','😁','😆','🥹','😂','🤣','😊','🙂','😉','😍','😘','😎','🤓','🤩','🥳','😴','🤔','😐','😶','🙄','😤','😭','😡','🥺','😇','🤗','🫠','😅','😋','😜','🤭','🫶','🙌','👏'] },
  { key: 'gestures', icon: '👍', label: 'Gestures', items: ['👍','👎','👌','✌️','🤞','🤟','🤘','👋','🙏','💪','🫡','🙋','🤝','👏','🙌','☝️','👇','👉','👈','🖐️','✋','🫶','🤌','👊'] },
  { key: 'hearts', icon: '❤️', label: 'Hearts', items: ['❤️','🩷','🧡','💛','💚','🩵','💙','💜','🖤','🤍','🤎','💖','💘','💝','💞','💕','💗','💓','💟','❣️','❤️‍🔥','❤️‍🩹'] },
  { key: 'work', icon: '💼', label: 'Work', items: ['📞','☎️','💼','📌','📝','📎','📅','⏰','✅','❌','⚠️','📢','📍','📈','📉','💡','🧠','🧾','📂','🗂️','📤','📥'] },
  { key: 'celebrate', icon: '🎉', label: 'Celebration', items: ['🎉','🎊','🔥','✨','🌟','⭐','💥','🎯','🏆','🥇','🎶','🎵','🍫','🍕','🍔','☕','🥤','⚡','🌈','🎈','🎁','🚀'] },
];

function readRecentEmojis() {
  try {
    const parsed = JSON.parse(localStorage.getItem(EMOJI_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function shortText(value, max = 60) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function decodeFlags(value) {
  return String(value || '')
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatTime(value) {
  if (!value) return '--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(11, 16) || '--:--';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString([], { day: '2-digit', month: 'short' });
}

function formatStamp(value) {
  const time = formatTime(value);
  const date = formatDate(value);
  return date ? `${date} • ${time}` : time;
}

function getThreadMeta(thread, messages, currentUser) {
  const id = thread.group_id || thread.thread_key || 'team';
  const threadMessages = messages.filter((item) => String(item.thread_key || 'team') === String(id));
  const last = threadMessages[threadMessages.length - 1] || null;
  return {
    count: threadMessages.length,
    last,
    preview: last
      ? `${last.sender_username === currentUser ? 'You' : last.sender_username}: ${shortText(last.body, 46)}`
      : 'No messages yet',
  };
}

function getMessageStatus(item) {
  const flags = decodeFlags(item.mention_usernames);
  const deleteMode = String(item.delete_mode || '').toLowerCase();
  const isAuditDeleted = String(item.audit_deleted || '0') === '1' || flags.includes('__audit_deleted__') || deleteMode === 'soft_manager_audit';
  const isDeleted = flags.includes('__deleted__') || deleteMode === 'hard';
  return {
    isDeleted,
    isEdited: flags.includes('__edited__'),
    isAuditDeleted,
    deletedBadge: item.deleted_badge || (isAuditDeleted ? 'Deleted for everyone' : 'Deleted'),
    deletedHint: item.deleted_hint || '',
  };
}

function buildReplySuggestions(sourceText) {
  const text = String(sourceText || '').trim().toLowerCase();
  if (!text) return ['On it ✅', 'Got it, moving now 🚀', 'Copy that. I will handle it. 💼', 'Received. Updating shortly. ✨'];
  if (text.includes('good morning')) return ['Good morning ☀️', 'Good morning, team. Let us win today. 🚀', 'Morning. Locked in and ready. 💼', 'Good morning ✨ Hope the day starts smooth.'];
  if (text.includes('good night')) return ['Good night 🌙', 'Good night. Logging off clean. ✨', 'Night. See you tomorrow. 🙌', 'Good night, team.'];
  if (text.includes('thank')) return ['Always happy to help ✨', 'You are welcome 🙌', 'Anytime. We are sorted. ✅', 'Glad that helped 💼'];
  if (text.includes('call')) return ['Calling now 📞', 'On it. I will update after the call. ✅', 'Taking this call next. ☎️', 'Noted. I am connecting now.'];
  if (text.includes('update')) return ['Update noted ✅', 'Sharing the latest status shortly ✨', 'Received. I will align the tracker. 📌', 'Got it. Updating now.'];
  if (text.includes('urgent') || text.includes('asap')) return ['On priority now 🚨', 'Taking this up right away. ✅', 'Understood. Fast-tracking this. ⚡', 'Received. Handling this first.'];
  if (text.includes('where') || text.includes('status')) return ['Checking and sending the status now 🔎', 'Sharing the exact update in a minute. ✅', 'Let me verify and revert. 💼', 'On it. I will send the current status.'];
  return ['Got it ✅', 'On it. Reverting shortly. ✨', 'Received. I will handle this. 💼', 'Noted. Working on it now. 🚀'];
}

export default function ChatPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const canManageGroups = ['admin', 'manager'].includes(String(user?.role || '').toLowerCase());
  const canHardDeleteMessages = ['admin', 'manager'].includes(String(user?.role || '').toLowerCase());
  const canDeleteOwnEverywhere = ['recruiter', 'tl', 'team lead', 'manager', 'admin'].includes(String(user?.role || '').toLowerCase());

  const [threads, setThreads] = useState([]);
  const [messages, setMessages] = useState([]);
  const [selected, setSelected] = useState(searchParams.get('thread') || 'team');
  const [body, setBody] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const storedChatTheme = localStorage.getItem('careerCroxChatTheme');
  const [chatTheme, setChatTheme] = useState(CHAT_THEMES.some((item) => item.key === storedChatTheme) ? storedChatTheme : 'green-bloom');
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeEmojiTab, setActiveEmojiTab] = useState('smileys');
  const [emojiSearch, setEmojiSearch] = useState('');
  const [recentEmojis, setRecentEmojis] = useState(() => readRecentEmojis());
  const [replyTo, setReplyTo] = useState(null);
  const [editingMessageId, setEditingMessageId] = useState('');
  const [composerBusy, setComposerBusy] = useState(false);
  const [editingMessageBody, setEditingMessageBody] = useState('');
  const [editingGroupId, setEditingGroupId] = useState('');
  const [editingGroupTitle, setEditingGroupTitle] = useState('');
  const [groupBusyId, setGroupBusyId] = useState('');
  const [messageBusyId, setMessageBusyId] = useState('');
  const [openGroupMenuId, setOpenGroupMenuId] = useState('');
  const [openMessageMenuId, setOpenMessageMenuId] = useState('');
  const [liveToast, setLiveToast] = useState(null);
  const [burst, setBurst] = useState('');

  const composerRef = useRef(null);
  const emojiWrapRef = useRef(null);
  const themeMenuRef = useRef(null);
  const endRef = useRef(null);
  const toastTimerRef = useRef(null);
  const lastSeenMessageIdRef = useRef(0);

  useEffect(() => {
    const snapshot = readChatSnapshot(user?.username);
    if (Array.isArray(snapshot.groups) && snapshot.groups.length) setThreads(snapshot.groups);
    if (Array.isArray(snapshot.messages) && snapshot.messages.length) setMessages(snapshot.messages);
    const snapshotThread = String(snapshot.selected || searchParams.get('thread') || 'team');
    if (snapshotThread) setSelected(snapshotThread);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.username]);

  function showToast(item) {
    setLiveToast(item);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setLiveToast(null), 1200);
  }

  async function loadThreads() {
    const requestedThread = String(searchParams.get('thread') || selected || 'team');
    try {
      const data = await api.get(`/api/chat?thread=${encodeURIComponent(requestedThread)}`, { cacheTtlMs: 0, cache: 'no-store', retries: 1 });
      const snapshot = readChatSnapshot(user?.username);
      const groups = data.groups?.length ? data.groups : (Array.isArray(snapshot.groups) && snapshot.groups.length ? snapshot.groups : [{ group_id: 'team', title: 'General Team', created_by_username: 'system' }]);
      const serverMessages = Array.isArray(data.messages) ? data.messages : [];
      const snapshotMessages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
      const now = Date.now();
      const serverMessageIds = new Set(serverMessages.map((item) => String(item?.id || '')).filter(Boolean));
      const snapshotThreadMessages = snapshotMessages.filter((item) => {
        if (String(item?.thread_key || 'team') !== String(requestedThread)) return false;
        const key = String(item?.id || '');
        if (!key || serverMessageIds.has(key)) return false;
        const stamp = Date.parse(item?.created_at || '');
        return Number.isNaN(stamp) || (now - stamp) <= CHAT_SNAPSHOT_ONLY_MAX_AGE_MS;
      });
      const mergedMap = new Map();
      for (const item of [...serverMessages, ...snapshotThreadMessages]) {
        const key = String(item?.id || '');
        if (!key || mergedMap.has(key)) continue;
        mergedMap.set(key, item);
      }
      const nextMessages = [...mergedMap.values()].sort((a, b) => {
        const timeDiff = String(a?.created_at || '').localeCompare(String(b?.created_at || ''));
        if (timeDiff !== 0) return timeDiff;
        return Number(a?.id || 0) - Number(b?.id || 0);
      });
      setThreads(groups);
      setMessages(nextMessages);

      const preferred = requestedThread || selected || 'team';
      const available = groups.find((item) => String(item.group_id || item.thread_key || 'team') === String(preferred));
      const fallback = groups[0]?.group_id || 'team';
      const finalThread = available ? preferred : fallback;

      if (finalThread !== selected) setSelected(finalThread);
      if (finalThread !== requestedThread) setSearchParams({ thread: finalThread }, { replace: true });
      saveChatSnapshot(user?.username, { groups, messages: nextMessages, selected: finalThread, saved_at: Date.now() });
    } catch (err) {
      const snapshot = readChatSnapshot(user?.username);
      if (Array.isArray(snapshot.groups) && snapshot.groups.length) setThreads(snapshot.groups);
      if (Array.isArray(snapshot.messages) && snapshot.messages.length) setMessages(snapshot.messages);
      showToast({ title: 'Chat sync issue', message: err.message || 'Chat could not refresh. Retrying…', thread_key: requestedThread || 'team' });
    }
  }

  useEffect(() => {
    loadThreads();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  usePolling(loadThreads, 1200, [selected, searchParams.toString(), user?.username]);

  useEffect(() => {
    localStorage.setItem('careerCroxChatTheme', chatTheme);
  }, [chatTheme]);

  useEffect(() => {
    try {
      localStorage.setItem(EMOJI_STORAGE_KEY, JSON.stringify(recentEmojis));
    } catch {
      // ignore localStorage write failures
    }
  }, [recentEmojis]);

  useEffect(() => {
    if (!user?.username) return;
    saveChatSnapshot(user.username, { groups: threads, messages, selected, saved_at: Date.now() });
  }, [messages, selected, threads, user?.username]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (emojiWrapRef.current && !emojiWrapRef.current.contains(event.target)) setShowEmojiPicker(false);
      if (themeMenuRef.current && !themeMenuRef.current.contains(event.target)) setShowThemeMenu(false);
      if (!event.target.closest('.cc-menu-wrap')) {
        setOpenGroupMenuId('');
        setOpenMessageMenuId('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  const threadMessages = useMemo(
    () => messages.filter((item) => String(item.thread_key || 'team') === String(selected)),
    [messages, selected],
  );

  const messageById = useMemo(
    () => Object.fromEntries(messages.map((item) => [String(item.id), item])),
    [messages],
  );

  const currentThread = useMemo(
    () => threads.find((item) => String(item.group_id || item.thread_key || 'team') === String(selected)),
    [threads, selected],
  );

  const threadMetaById = useMemo(() => {
    const result = {};
    for (const thread of threads) {
      const id = thread.group_id || thread.thread_key || 'team';
      result[id] = getThreadMeta(thread, messages, user?.username);
    }
    return result;
  }, [threads, messages, user?.username]);

  const replySource = replyTo ? messageById[String(replyTo.id)] || replyTo : null;

  const replySuggestions = useMemo(() => (replySource && !editingMessageId ? buildReplySuggestions(replySource.body) : []), [replySource, editingMessageId]);

  const emojiTabs = useMemo(() => {
    const recent = recentEmojis.length ? [{ key: 'recent', icon: '🕘', label: 'Recent', items: recentEmojis }] : [];
    return [...recent, ...EMOJI_CATEGORIES];
  }, [recentEmojis]);

  const activeEmojiCategory = emojiTabs.find((item) => item.key === activeEmojiTab) || emojiTabs[0];

  const visibleEmojis = useMemo(() => {
    const pool = activeEmojiCategory?.items || [];
    if (!emojiSearch.trim()) return pool;
    return pool.filter((emoji) => emoji.includes(emojiSearch.trim()));
  }, [activeEmojiCategory, emojiSearch]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [threadMessages.length, selected]);

  useEffect(() => {
    const latest = messages[messages.length - 1];
    if (!latest?.id) return;
    const latestId = Number(latest.id || 0);
    if (!lastSeenMessageIdRef.current) {
      lastSeenMessageIdRef.current = latestId;
      return;
    }
    if (latestId <= lastSeenMessageIdRef.current) return;
    lastSeenMessageIdRef.current = latestId;
    if (latest.sender_username !== user?.username) {
      const thread = threads.find((item) => String(item.group_id || item.thread_key || 'team') === String(latest.thread_key || 'team'));
      showToast({
        title: `New message in ${thread?.title || 'Team Chat'}`,
        message: `${latest.sender_username}: ${shortText(latest.body, 52)}`,
        thread_key: latest.thread_key || 'team',
      });
    }
  }, [messages, threads, user?.username]);

  useEffect(() => {
    const requestedThread = searchParams.get('thread');
    if (!requestedThread || requestedThread === selected) return;
    setSelected(requestedThread);
  }, [searchParams, selected]);

  function openThread(threadKey) {
    const next = String(threadKey || 'team');
    setSelected(next);
    setSearchParams({ thread: next }, { replace: true });
    setLiveToast(null);
    setOpenGroupMenuId('');
    setOpenMessageMenuId('');
    navigate(`/chat?thread=${encodeURIComponent(next)}`, { replace: true });
  }

  function focusComposer() {
    window.setTimeout(() => composerRef.current?.focus(), 30);
  }

  function resetComposer() {
    setBody('');
    setReplyTo(null);
    setEditingMessageId('');
    setEditingMessageBody('');
  }

  async function send() {
    if (!body.trim() || composerBusy) return;
    setComposerBusy(true);
    try {
      const payload = { thread_key: selected, body, reply_to_id: replySource?.id || '' };
      const data = await api.post('/api/chat/messages', payload);
      if (data?.item) {
        let nextThreads = [];
        let nextMessages = [];
        setMessages((current) => {
          nextMessages = [...current, data.item].sort((a, b) => {
            const timeDiff = String(a?.created_at || '').localeCompare(String(b?.created_at || ''));
            if (timeDiff !== 0) return timeDiff;
            return Number(a?.id || 0) - Number(b?.id || 0);
          });
          return nextMessages;
        });
        setThreads((current) => {
          nextThreads = current.length ? current : [{ group_id: selected || 'team', title: 'General Team', created_by_username: 'system' }];
          return nextThreads;
        });
        saveChatSnapshot(user?.username, {
          groups: nextThreads.length ? nextThreads : threads,
          messages: nextMessages.length ? nextMessages : [...messages, data.item],
          selected,
          saved_at: Date.now(),
        });
      }
      setBurst('✨');
      window.setTimeout(() => setBurst(''), 1000);
      showToast({ title: 'Message sent', message: shortText(body, 60), thread_key: selected });
      resetComposer();
      loadThreads();
    } catch (err) {
      showToast({ title: 'Send failed', message: err.message || 'Message could not be sent', thread_key: selected });
    } finally {
      setComposerBusy(false);
    }
  }

  async function saveEditedMessage() {
    if (!editingMessageId || !editingMessageBody.trim() || composerBusy) return;
    setComposerBusy(true);
    setMessageBusyId(editingMessageId);
    try {
      await api.put(`/api/chat/messages/${encodeURIComponent(editingMessageId)}`, { body: editingMessageBody.trim() });
      showToast({ title: 'Message updated', message: shortText(editingMessageBody, 60), thread_key: selected });
      resetComposer();
      await loadThreads();
    } finally {
      setMessageBusyId('');
      setComposerBusy(false);
    }
  }

  function onComposerSubmit() {
    if (editingMessageId) {
      saveEditedMessage();
      return;
    }
    send();
  }

  async function createGroup() {
    if (!canManageGroups || !groupTitle.trim()) return;
    setCreating(true);
    try {
      const data = await api.post('/api/chat/groups', { title: groupTitle.trim() });
      setGroupTitle('');
      openThread(data.item?.group_id || 'team');
      await loadThreads();
      showToast({ title: 'Group created', message: `${data.item?.title || 'New group'} is ready`, thread_key: data.item?.group_id || 'team' });
    } finally {
      setCreating(false);
    }
  }

  function beginGroupEdit(group) {
    const groupId = group.group_id || group.thread_key || 'team';
    setEditingGroupId(groupId);
    setEditingGroupTitle(group.title || '');
    setOpenGroupMenuId('');
  }

  async function saveGroupTitle(groupId) {
    if (!canManageGroups || !groupId || !editingGroupTitle.trim()) return;
    setGroupBusyId(groupId);
    try {
      await api.put(`/api/chat/groups/${encodeURIComponent(groupId)}`, { title: editingGroupTitle.trim() });
      showToast({ title: 'Group renamed', message: editingGroupTitle.trim(), thread_key: groupId });
      setEditingGroupId('');
      setEditingGroupTitle('');
      await loadThreads();
    } finally {
      setGroupBusyId('');
    }
  }

  async function deleteGroup(groupId, title) {
    if (!canManageGroups || !groupId || groupId === 'team') return;
    const ok = window.confirm(`Delete ${title || 'this group'}? All messages in this group will be removed.`);
    if (!ok) return;
    setGroupBusyId(groupId);
    try {
      await api.post(`/api/chat/groups/${encodeURIComponent(groupId)}/delete`, {});
      if (selected === groupId) openThread('team');
      await loadThreads();
      showToast({ title: 'Group deleted', message: `${title || 'Group'} removed`, thread_key: 'team' });
    } finally {
      setGroupBusyId('');
    }
  }

  function beginReply(message) {
    setReplyTo(message);
    setEditingMessageId('');
    setEditingMessageBody('');
    setOpenMessageMenuId('');
    focusComposer();
  }

  function beginMessageEdit(message) {
    const status = getMessageStatus(message);
    if (status.isDeleted) return;
    setEditingMessageId(String(message.id));
    setEditingMessageBody(message.body || '');
    setReplyTo(null);
    setOpenMessageMenuId('');
    focusComposer();
  }

  async function deleteMessage(message) {
    const status = getMessageStatus(message);
    if (status.isDeleted) return;
    const ok = window.confirm(canHardDeleteMessages ? 'Delete this message for everyone? Manager delete removes it for all users permanently.' : 'Delete this message for everyone? It will disappear for everyone except the manager audit view.');
    if (!ok) return;
    setMessageBusyId(String(message.id));
    try {
      await api.post(`/api/chat/messages/${encodeURIComponent(message.id)}/delete`, {});
      if (editingMessageId === String(message.id)) {
        resetComposer();
      }
      if (replyTo?.id === message.id) {
        setReplyTo(null);
      }
      showToast({ title: 'Message deleted', message: canHardDeleteMessages ? 'Deleted for everyone permanently' : 'Deleted for everyone. Manager audit copy stays visible.', thread_key: selected });
      setOpenMessageMenuId('');
      await loadThreads();
    } finally {
      setMessageBusyId('');
      setComposerBusy(false);
    }
  }

  async function copyMessage(message) {
    try {
      await navigator.clipboard.writeText(message.body || '');
      showToast({ title: 'Copied', message: shortText(message.body, 48), thread_key: selected });
    } catch {
      showToast({ title: 'Copy failed', message: 'Clipboard permission blocked', thread_key: selected });
    }
    setOpenMessageMenuId('');
  }

  function addEmoji(emoji) {
    if (editingMessageId) {
      setEditingMessageBody((current) => `${current}${emoji}`);
    } else {
      setBody((current) => `${current}${emoji}`);
    }
    setRecentEmojis((prev) => [emoji, ...prev.filter((item) => item !== emoji)].slice(0, 24));
  }

  const composerValue = editingMessageId ? editingMessageBody : body;

  return (
    <Layout title="Team Chat" subtitle="Structured team communication with grouped conversations and smarter message controls.">
      <style>{`
        .cc-chat-page{display:flex;flex-direction:column;gap:14px;}
        .cc-chat-grid{display:grid;grid-template-columns:minmax(320px,360px) minmax(0,1fr);gap:16px;align-items:start;}
        .cc-chat-sidebar,.cc-chat-main{border-radius:28px;overflow:hidden;border:1px solid rgba(99,132,255,.14);box-shadow:0 20px 48px rgba(30,55,120,.12);background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(245,249,255,.94));}
        .cc-chat-sidebar{padding:18px;position:relative;}
        .cc-chat-main{padding:18px;min-height:calc(100vh - 240px);display:flex;flex-direction:column;position:relative;}
        .cc-soft-label{font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#5a79c8;}
        .cc-title-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;}
        .cc-big-title{font-size:22px;font-weight:900;color:#163572;line-height:1.1;}
        .cc-subtitle{font-size:13px;line-height:1.5;color:#5a6885;margin-top:4px;}
        .cc-theme-btn,.cc-dot-btn{width:38px;height:38px;border:none;border-radius:14px;background:linear-gradient(135deg,#eff4ff,#dbe8ff);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 10px 20px rgba(61,91,173,.12);color:#3151a6;font-size:20px;font-weight:800;cursor:pointer;display:grid;place-items:center;}
        .cc-theme-menu-wrap,.cc-menu-wrap{position:relative;}
        .cc-theme-popover,.cc-menu-popover{position:absolute;top:46px;right:0;z-index:40;min-width:180px;padding:8px;border-radius:18px;background:rgba(255,255,255,.98);border:1px solid rgba(122,147,228,.24);box-shadow:0 20px 48px rgba(25,44,100,.18);backdrop-filter:blur(12px);}
        .cc-theme-popover-title{font-size:12px;font-weight:800;color:#526286;padding:4px 8px 8px;letter-spacing:.08em;text-transform:uppercase;}
        .cc-theme-popover-item,.cc-menu-item{width:100%;display:flex;align-items:center;gap:10px;border:none;background:transparent;padding:10px 12px;border-radius:14px;font-size:13px;font-weight:700;color:#2a3d6d;cursor:pointer;text-align:left;}
        .cc-theme-popover-item:hover,.cc-menu-item:hover{background:rgba(77,123,255,.09);}
        .cc-theme-popover-item.active{background:linear-gradient(135deg,rgba(77,123,255,.16),rgba(121,186,255,.16));}
        .cc-theme-dot{width:12px;height:12px;border-radius:999px;display:inline-block;}
        .cc-theme-dot.green{background:linear-gradient(135deg,#24c96b,#96f0b7);}
        .cc-theme-dot.pink{background:linear-gradient(135deg,#ff7dc2,#ffc0df);}
        .cc-theme-dot.purple{background:linear-gradient(135deg,#8b5dff,#d1b3ff);}
        .cc-theme-dot.sky{background:linear-gradient(135deg,#65c9ff,#b8edff);}
        .cc-theme-dot.red{background:linear-gradient(135deg,#ff6f7d,#ffb0b8);}
        .cc-theme-dot.white{background:linear-gradient(135deg,#ffffff,#dfeaff);}
        .cc-theme-dot.black{background:linear-gradient(135deg,#272b38,#0f1218);}
        .cc-create-row{display:grid;grid-template-columns:minmax(0,1fr) 100px;gap:10px;margin-top:16px;}
        .cc-create-input,.cc-composer-input,.cc-inline-input,.cc-search-emoji{width:100%;border:none;outline:none;border-radius:16px;padding:13px 14px;background:linear-gradient(180deg,#fff,#f4f8ff);box-shadow:inset 0 0 0 1px rgba(117,145,228,.22),0 8px 18px rgba(46,77,153,.08);font-size:14px;color:#18366d;}
        .cc-primary-btn,.cc-send-btn{border:none;border-radius:16px;background:linear-gradient(135deg,#3a73ff,#7d5dff);color:#fff;font-weight:800;cursor:pointer;box-shadow:0 14px 24px rgba(75,104,201,.22);padding:0 16px;}
        .cc-primary-btn:disabled,.cc-send-btn:disabled{opacity:.6;cursor:not-allowed;}
        .cc-thread-list{margin-top:16px;display:flex;flex-direction:column;gap:12px;max-height:calc(100vh - 320px);overflow:auto;padding-right:4px;}
        .cc-thread-card{width:100%;border:none;border-radius:24px;padding:14px;background:linear-gradient(135deg,#fdfefe,#eef5ff);box-shadow:0 14px 26px rgba(47,77,140,.08);cursor:pointer;text-align:left;position:relative;overflow:hidden;display:flex;gap:12px;align-items:flex-start;}
        .cc-thread-card::after{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(97,135,255,.05),rgba(90,227,255,.08));opacity:0;transition:.2s ease;}
        .cc-thread-card:hover::after,.cc-thread-card.active::after{opacity:1;}
        .cc-thread-card.active{box-shadow:0 18px 34px rgba(48,88,186,.16);transform:translateY(-1px);}
        .cc-thread-avatar{width:50px;height:50px;border-radius:18px;background:linear-gradient(135deg,#4f87ff,#79d3ff);display:grid;place-items:center;color:#fff;font-size:18px;font-weight:900;flex:0 0 auto;box-shadow:0 12px 22px rgba(48,96,198,.24);}
        .cc-thread-content{min-width:0;flex:1;position:relative;z-index:1;}
        .cc-thread-top{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;}
        .cc-thread-name{font-size:16px;font-weight:900;color:#102f68;line-height:1.2;}
        .cc-thread-meta{margin-top:2px;font-size:12px;color:#6c7a96;font-weight:700;}
        .cc-thread-preview{margin-top:8px;font-size:13px;line-height:1.45;color:#33496f;word-break:break-word;}
        .cc-count-pill{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:800;color:#4261af;background:rgba(80,126,255,.10);border:1px solid rgba(86,128,255,.14);padding:6px 10px;border-radius:999px;margin-top:10px;}
        .cc-thread-edit-box{margin-top:10px;display:flex;flex-direction:column;gap:10px;padding:12px;border-radius:18px;background:rgba(255,255,255,.76);box-shadow:inset 0 0 0 1px rgba(122,146,228,.18);}
        .cc-inline-actions{display:flex;gap:8px;flex-wrap:wrap;}
        .cc-ghost-btn{border:none;border-radius:14px;padding:10px 14px;font-size:13px;font-weight:800;cursor:pointer;background:rgba(74,115,255,.09);color:#35539c;}
        .cc-danger-btn{color:#c1354d;background:rgba(220,72,111,.1);}
        .cc-main-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:4px 4px 16px;}
        .cc-main-thread-name{font-size:28px;font-weight:900;line-height:1.05;color:#15336f;}
        .cc-main-thread-sub{margin-top:8px;font-size:13px;color:#61708f;line-height:1.5;max-width:680px;}
        .cc-head-badges{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;}
        .cc-badge{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:999px;background:linear-gradient(135deg,#eef4ff,#dde9ff);color:#315199;font-size:12px;font-weight:900;box-shadow:inset 0 0 0 1px rgba(104,133,214,.12);}
        .cc-chat-window{flex:1;min-height:440px;border-radius:26px;padding:20px;background:linear-gradient(180deg,rgba(241,247,255,.94),rgba(236,244,255,.82));border:1px solid rgba(106,140,230,.14);overflow:auto;display:flex;flex-direction:column;gap:12px;position:relative;}
        .chat-theme-whatsapp-clean .cc-chat-window{background:linear-gradient(180deg,rgba(241,248,255,.98),rgba(235,246,255,.9));}
        .chat-theme-blue-hearts .cc-chat-window{background:radial-gradient(circle at top left,rgba(125,170,255,.18),transparent 32%),linear-gradient(180deg,rgba(240,245,255,.98),rgba(232,239,255,.92));}
        .chat-theme-soft-sky .cc-chat-window{background:radial-gradient(circle at top right,rgba(93,219,255,.15),transparent 28%),linear-gradient(180deg,rgba(238,251,255,.98),rgba(231,246,255,.92));}
        .chat-theme-midnight-neon .cc-chat-window{background:radial-gradient(circle at top left,rgba(92,135,255,.22),transparent 22%),linear-gradient(180deg,#132040,#182a56);}
        .chat-theme-midnight-neon .cc-empty-state,.chat-theme-midnight-neon .cc-main-thread-name,.chat-theme-midnight-neon .cc-main-thread-sub,.chat-theme-midnight-neon .cc-thread-chip,.chat-theme-midnight-neon .cc-badge{color:#eef3ff;}
        .chat-theme-midnight-neon .cc-badge{background:rgba(255,255,255,.08);}
        .chat-theme-midnight-neon .cc-message-bubble.other{background:linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.06));color:#ecf2ff;border-color:rgba(255,255,255,.06);}
        .chat-theme-midnight-neon .cc-message-body,.chat-theme-midnight-neon .cc-message-name,.chat-theme-midnight-neon .cc-message-time,.chat-theme-midnight-neon .cc-reply-preview-card strong,.chat-theme-midnight-neon .cc-reply-preview-card span{color:#ecf2ff;}
        .chat-theme-midnight-neon .cc-reply-preview-card{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.08);}
        .chat-theme-green-bloom .cc-chat-window{background:linear-gradient(180deg,rgba(236,255,243,.98),rgba(226,250,236,.92));}
        .chat-theme-green-bloom .cc-message-bubble.mine{background:linear-gradient(135deg,#18a957,#2ecc71);color:#fff;}
        .chat-theme-green-bloom .cc-message-bubble.mine .cc-message-name,.chat-theme-green-bloom .cc-message-bubble.mine .cc-message-time,.chat-theme-green-bloom .cc-message-bubble.mine .cc-message-body{color:#fff;}
        .chat-theme-pink-pop .cc-chat-window{background:linear-gradient(180deg,rgba(255,241,247,.98),rgba(255,232,242,.92));}
        .chat-theme-pink-pop .cc-message-bubble.mine{background:linear-gradient(135deg,#ff4f92,#ff8bc2);color:#fff;}
        .chat-theme-pink-pop .cc-message-bubble.mine .cc-message-name,.chat-theme-pink-pop .cc-message-bubble.mine .cc-message-time,.chat-theme-pink-pop .cc-message-bubble.mine .cc-message-body{color:#fff;}
        .chat-theme-purple-glow .cc-chat-window{background:linear-gradient(180deg,rgba(245,239,255,.98),rgba(238,230,255,.92));}
        .chat-theme-purple-glow .cc-message-bubble.mine{background:linear-gradient(135deg,#6f43ff,#976dff);color:#fff;}
        .chat-theme-purple-glow .cc-message-bubble.mine .cc-message-name,.chat-theme-purple-glow .cc-message-bubble.mine .cc-message-time,.chat-theme-purple-glow .cc-message-bubble.mine .cc-message-body{color:#fff;}
        .chat-theme-sky-frost .cc-chat-window{background:linear-gradient(180deg,rgba(238,249,255,.98),rgba(229,244,255,.92));}
        .chat-theme-sky-frost .cc-message-bubble.mine{background:linear-gradient(135deg,#169dff,#5fc6ff);color:#fff;}
        .chat-theme-sky-frost .cc-message-bubble.mine .cc-message-name,.chat-theme-sky-frost .cc-message-bubble.mine .cc-message-time,.chat-theme-sky-frost .cc-message-bubble.mine .cc-message-body{color:#fff;}
        .chat-theme-red-pulse .cc-chat-window{background:linear-gradient(180deg,rgba(255,241,241,.98),rgba(255,231,231,.92));}
        .chat-theme-red-pulse .cc-message-bubble.mine{background:linear-gradient(135deg,#f04f60,#ff7b88);color:#fff;}
        .chat-theme-red-pulse .cc-message-bubble.mine .cc-message-name,.chat-theme-red-pulse .cc-message-bubble.mine .cc-message-time,.chat-theme-red-pulse .cc-message-bubble.mine .cc-message-body{color:#fff;}
        .chat-theme-white-frost .cc-chat-window{background:linear-gradient(180deg,rgba(255,255,255,.99),rgba(245,248,255,.96));}
        .chat-theme-white-frost .cc-message-bubble.mine{background:linear-gradient(135deg,#ffffff,#d9e6ff);color:#16345d;border-color:rgba(103,134,223,.18);}
        .chat-theme-white-frost .cc-message-bubble.mine .cc-message-name,.chat-theme-white-frost .cc-message-bubble.mine .cc-message-time,.chat-theme-white-frost .cc-message-bubble.mine .cc-message-body,.chat-theme-white-frost .cc-message-bubble.mine .cc-message-chip{color:#16345d;}
        .chat-theme-black-night .cc-chat-window{background:linear-gradient(180deg,#171b24,#0f1218);}
        .chat-theme-black-night .cc-main-thread-name,.chat-theme-black-night .cc-main-thread-sub,.chat-theme-black-night .cc-badge,.chat-theme-black-night .cc-empty-state,.chat-theme-black-night .cc-empty-state strong{color:#f3f6ff;}
        .chat-theme-black-night .cc-badge{background:rgba(255,255,255,.08);}
        .chat-theme-black-night .cc-message-bubble.other{background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.04));border-color:rgba(255,255,255,.06);}
        .chat-theme-black-night .cc-message-bubble.mine{background:linear-gradient(135deg,#2f6bff,#7e54ff);color:#fff;}
        .chat-theme-black-night .cc-message-bubble.mine .cc-message-name,.chat-theme-black-night .cc-message-bubble.mine .cc-message-time,.chat-theme-black-night .cc-message-bubble.mine .cc-message-body{color:#fff;}
        .chat-theme-black-night .cc-message-name,.chat-theme-black-night .cc-message-time,.chat-theme-black-night .cc-message-body,.chat-theme-black-night .cc-reply-preview-card strong,.chat-theme-black-night .cc-reply-preview-card span{color:#eff4ff;}
        .chat-theme-black-night .cc-reply-preview-card{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.08);}
        .cc-message-row{display:flex;flex-direction:column;align-items:flex-start;}
        .cc-message-row.mine{align-items:flex-end;}
        .cc-message-bubble{max-width:min(76%,680px);border-radius:28px;padding:14px 16px 12px;position:relative;box-shadow:0 20px 34px rgba(47,77,141,.10);border:1px solid rgba(111,144,233,.12);}
        .cc-message-bubble.other{background:linear-gradient(180deg,#fff,#f5f9ff);}
        .cc-message-bubble.mine{background:linear-gradient(135deg,#4e7fff,#7f62ff);color:#fff;}
        .cc-message-header{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:6px;}
        .cc-message-name{font-size:14px;font-weight:900;color:#17356e;letter-spacing:.02em;}
        .cc-message-bubble.mine .cc-message-name,.cc-message-bubble.mine .cc-message-time,.cc-message-bubble.mine .cc-message-chip{color:#fff;}
        .cc-message-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-height:22px;}
        .cc-message-time{font-size:11px;font-weight:900;color:#6d7b98;opacity:.88;}
        .cc-message-chip{font-size:9px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;display:inline-flex;padding:4px 7px;border-radius:999px;background:rgba(27,60,124,.08);color:#284b93;}
        .cc-message-bubble.mine .cc-message-chip{background:rgba(255,255,255,.18);}
        .cc-message-body{font-size:17px;line-height:1.68;color:#203a70;white-space:pre-wrap;word-break:break-word;font-weight:800;padding-right:20px;}
        .cc-message-deleted .cc-message-body{font-style:italic;opacity:.75;}
        .cc-message-audit{background:linear-gradient(180deg,#fff3f3,#ffe4e7)!important;border-color:rgba(220,72,111,.22)!important;box-shadow:0 18px 30px rgba(168,42,78,.12)!important;}
        .cc-message-audit .cc-message-name,.cc-message-audit .cc-message-body,.cc-message-audit .cc-message-time{color:#8e2040!important;}
        .cc-audit-note{margin-top:8px;font-size:12px;line-height:1.5;color:#9f3553;font-weight:700;}
        .cc-message-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin-top:6px;}
        .cc-message-bubble.other .cc-message-footer{justify-content:flex-start;}
        .cc-message-menu-btn{width:28px;height:28px;border:none;border-radius:12px;background:rgba(255,255,255,.82);box-shadow:0 8px 16px rgba(41,68,137,.10);font-size:14px;font-weight:900;color:#33539d;cursor:pointer;opacity:.42;transform:scale(.92);transition:.16s ease;display:grid;place-items:center;}
        .cc-message-bubble.mine .cc-message-menu-btn{background:rgba(255,255,255,.22);color:#fff;}
        .cc-message-bubble:hover .cc-message-menu-btn,.cc-menu-wrap.is-open .cc-message-menu-btn{opacity:1;transform:scale(1);}
        .cc-reply-preview-card{display:flex;flex-direction:column;gap:4px;margin-bottom:10px;padding:10px 12px;border-radius:16px;border:1px solid rgba(103,134,223,.14);background:rgba(89,130,255,.08);cursor:pointer;text-align:left;}
        .cc-message-bubble.mine .cc-reply-preview-card{background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.15);}
        .cc-reply-preview-card strong{font-size:12px;color:#224687;}
        .cc-reply-preview-card span{font-size:12px;color:#53647f;line-height:1.45;}
        .cc-message-bubble.mine .cc-reply-preview-card strong,.cc-message-bubble.mine .cc-reply-preview-card span{color:#fff;}
        .cc-empty-state{margin:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;color:#5270b4;padding:40px 18px;}
        .cc-empty-state strong{font-size:20px;color:#16336f;}
        .cc-inline-banner{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:12px 14px;border-radius:18px;margin-top:12px;background:linear-gradient(135deg,rgba(81,126,255,.10),rgba(130,112,255,.10));border:1px solid rgba(100,127,230,.14);}
        .cc-inline-banner strong{display:block;font-size:13px;color:#1d3d7d;}
        .cc-inline-banner span{display:block;font-size:12px;line-height:1.45;color:#4e628a;margin-top:4px;}
        .cc-suggestion-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;}
        .cc-suggestion-chip{border:none;border-radius:999px;padding:10px 14px;background:linear-gradient(135deg,#edf4ff,#e7f0ff);color:#224687;font-weight:800;cursor:pointer;box-shadow:0 10px 20px rgba(41,68,137,.08);}
        .cc-suggestion-chip:hover{transform:translateY(-1px);}
        .cc-composer-row{margin-top:14px;display:flex;align-items:center;gap:10px;position:relative;}
        .cc-composer-box{flex:1;display:flex;align-items:center;gap:10px;padding:12px;border-radius:24px;background:linear-gradient(180deg,#ffffff,#f4f8ff);box-shadow:0 16px 30px rgba(39,71,144,.10);border:1px solid rgba(112,143,226,.12);}
        .cc-emoji-btn{width:42px;height:42px;border:none;border-radius:16px;background:linear-gradient(135deg,#fff5ca,#ffe595);font-size:20px;cursor:pointer;box-shadow:0 12px 20px rgba(217,173,53,.12);}
        .cc-composer-input{flex:1;box-shadow:none;background:transparent;padding:0 4px;}
        .cc-send-btn{min-width:110px;height:46px;}
        .cc-emoji-picker{position:absolute;left:10px;bottom:72px;width:min(360px,calc(100vw - 80px));padding:12px;border-radius:22px;background:rgba(255,255,255,.98);border:1px solid rgba(117,142,220,.20);box-shadow:0 24px 48px rgba(34,56,122,.18);z-index:35;}
        .cc-emoji-tabs{display:flex;gap:8px;overflow:auto;padding-bottom:8px;}
        .cc-emoji-tab{width:40px;height:40px;border:none;border-radius:14px;background:#f2f6ff;cursor:pointer;font-size:18px;display:grid;place-items:center;}
        .cc-emoji-tab.active{background:linear-gradient(135deg,#4a78ff,#7b66ff);color:#fff;box-shadow:0 12px 22px rgba(60,95,188,.22);}
        .cc-search-emoji{margin:8px 0 10px;}
        .cc-emoji-title{font-size:12px;font-weight:900;color:#64739a;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px;}
        .cc-emoji-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;max-height:220px;overflow:auto;padding-right:4px;}
        .cc-emoji-item{border:none;background:#f6f8ff;border-radius:14px;height:42px;font-size:21px;cursor:pointer;display:grid;place-items:center;}
        .cc-emoji-item:hover{background:#e8efff;}
        .cc-menu-item.danger{color:#c2354f;background:rgba(220,72,111,.08);}
        .cc-menu-item.danger:hover{background:rgba(220,72,111,.14);}
        .cc-mini-toast{position:fixed;top:108px;right:22px;z-index:60;min-width:260px;max-width:360px;padding:14px 16px;border:none;border-radius:18px;background:linear-gradient(135deg,#416fff,#7d62ff);color:#fff;box-shadow:0 20px 38px rgba(38,62,138,.26);text-align:left;cursor:pointer;}
        .cc-mini-toast-title{font-weight:900;margin-bottom:4px;font-size:14px;}
        .cc-mini-toast-body{font-size:13px;line-height:1.45;opacity:.95;}
        .cc-burst{font-size:22px;animation:ccPop .8s ease forwards;}
        @keyframes ccPop{0%{transform:scale(.7);opacity:0;}30%{transform:scale(1.18);opacity:1;}100%{transform:scale(1);opacity:0;}}
        @media (max-width:1120px){.cc-chat-grid{grid-template-columns:1fr;}.cc-thread-list{max-height:none;}.cc-message-bubble{max-width:86%;}}
        @media (max-width:760px){.cc-chat-main,.cc-chat-sidebar{padding:14px;border-radius:22px;}.cc-main-thread-name{font-size:22px;}.cc-message-bubble{max-width:100%;}.cc-main-head{flex-direction:column;}.cc-head-badges{justify-content:flex-start;}.cc-create-row{grid-template-columns:1fr;}.cc-composer-row{flex-direction:column;align-items:stretch;}.cc-send-btn{width:100%;}.cc-emoji-picker{left:0;right:0;width:100%;bottom:76px;}.cc-mini-toast{left:12px;right:12px;min-width:auto;}}
      `}</style>

      {liveToast ? (
        <button type="button" className="cc-mini-toast" onClick={() => openThread(liveToast.thread_key)}>
          <div className="cc-mini-toast-title">{liveToast.title}</div>
          <div className="cc-mini-toast-body">{liveToast.message}</div>
        </button>
      ) : null}

      <div className="cc-chat-page">
        <div className="cc-chat-grid">
          <div className="cc-chat-sidebar">
            <div className="cc-title-row">
              <div>
                <div className="cc-soft-label">Groups</div>
                <div className="cc-big-title">Team Rooms</div>
                <div className="cc-subtitle">Group controls are now available inside a clean 3 dot menu for a neater CRM-style layout.</div>
              </div>
              <div className="cc-theme-menu-wrap" ref={themeMenuRef}>
                <button className="cc-theme-btn" type="button" onClick={() => setShowThemeMenu((prev) => !prev)} title="Chat themes">⋯</button>
                {showThemeMenu ? (
                  <div className="cc-theme-popover">
                    <div className="cc-theme-popover-title">Chat Theme</div>
                    {CHAT_THEMES.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className={`cc-theme-popover-item ${chatTheme === item.key ? 'active' : ''}`}
                        onClick={() => {
                          setChatTheme(item.key);
                          setShowThemeMenu(false);
                        }}
                      >
                        <span className={`cc-theme-dot ${item.preview}`} />
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            {canManageGroups ? (
              <div className="cc-create-row">
                <input
                  className="cc-create-input"
                  value={groupTitle}
                  onChange={(e) => setGroupTitle(e.target.value)}
                  placeholder="Create new group title"
                />
                <button className="cc-primary-btn" type="button" disabled={creating || !groupTitle.trim()} onClick={createGroup}>
                  {creating ? 'Saving...' : 'Create'}
                </button>
              </div>
            ) : null}

            <div className="cc-thread-list">
              {threads.map((group) => {
                const id = group.group_id || group.thread_key || 'team';
                const meta = threadMetaById[id] || { count: 0, preview: 'No messages yet' };
                const isEditing = editingGroupId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    className={`cc-thread-card ${selected === id ? 'active' : ''}`}
                    onClick={() => openThread(id)}
                  >
                    <div className="cc-thread-avatar">{String(group.title || 'G').slice(0, 1).toUpperCase()}</div>
                    <div className="cc-thread-content">
                      <div className="cc-thread-top">
                        <div>
                          <div className="cc-thread-name">{group.title || id}</div>
                          <div className="cc-thread-meta">Created by {group.created_by_username || 'system'}</div>
                        </div>
                        {canManageGroups ? (
                          <div className="cc-menu-wrap" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="cc-dot-btn"
                              title="Group options"
                              onClick={() => setOpenGroupMenuId((prev) => (prev === id ? '' : id))}
                            >
                              ⋯
                            </button>
                            {openGroupMenuId === id ? (
                              <div className="cc-menu-popover">
                                <button type="button" className="cc-menu-item" onClick={() => beginGroupEdit(group)}>Rename group</button>
                                {id !== 'team' ? (
                                  <button type="button" className="cc-menu-item danger" onClick={() => deleteGroup(id, group.title)}>Delete group</button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      {isEditing ? (
                        <div className="cc-thread-edit-box" onClick={(e) => e.stopPropagation()}>
                          <input
                            className="cc-inline-input"
                            value={editingGroupTitle}
                            onChange={(e) => setEditingGroupTitle(e.target.value)}
                            placeholder="Rename group"
                          />
                          <div className="cc-inline-actions">
                            <button
                              className="cc-primary-btn"
                              type="button"
                              disabled={groupBusyId === id || !editingGroupTitle.trim()}
                              onClick={() => saveGroupTitle(id)}
                            >
                              {groupBusyId === id ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              className="cc-ghost-btn"
                              type="button"
                              onClick={() => {
                                setEditingGroupId('');
                                setEditingGroupTitle('');
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="cc-thread-preview">{meta.preview}</div>
                          <div className="cc-count-pill">{meta.count} messages</div>
                        </>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={`cc-chat-main chat-theme-${chatTheme}`}>
            <div className="cc-main-head">
              <div>
                <div className="cc-soft-label">Conversation</div>
                <div className="cc-main-thread-name">{currentThread?.title || 'General Team'}</div>
                <div className="cc-main-thread-sub">Reply, edit, smart suggestions, and delete-for-everyone controls stay compact here without turning the chat into a button jungle.</div>
              </div>
              <div className="cc-head-badges">
                <div className="cc-badge">{threadMessages.length} messages</div>
                <div className="cc-badge">{currentThread?.created_by_username || 'system'}</div>
                {burst ? <div className="cc-burst">{burst}</div> : null}
              </div>
            </div>

            <div className="cc-chat-window">
              {threadMessages.map((message) => {
                const mine = message.sender_username === user?.username;
                const status = getMessageStatus(message);
                const replied = message.reference_type === 'message' ? messageById[String(message.reference_id)] : null;
                const canEdit = mine && !status.isDeleted;
                const canDelete = ((mine && canDeleteOwnEverywhere) || canHardDeleteMessages) && !(status.isDeleted && !status.isAuditDeleted);
                return (
                  <div key={message.id} className={`cc-message-row ${mine ? 'mine' : ''}`}>
                    <div className={`cc-message-bubble ${mine ? 'mine' : 'other'} ${status.isDeleted ? 'cc-message-deleted' : ''} ${status.isAuditDeleted ? 'cc-message-audit' : ''}`}>
                      <div className="cc-message-header">
                        <div className="cc-message-meta">
                          <div className="cc-message-name">{mine ? 'You' : message.sender_username}</div>
                        </div>
                        <div className={`cc-menu-wrap ${openMessageMenuId === String(message.id) ? 'is-open' : ''}`}>
                          <button
                            className="cc-message-menu-btn"
                            type="button"
                            title="Message options"
                            onClick={() => setOpenMessageMenuId((prev) => (prev === String(message.id) ? '' : String(message.id)))}
                          >
                            ⋯
                          </button>
                          {openMessageMenuId === String(message.id) ? (
                            <div className="cc-menu-popover">
                              {!status.isDeleted ? <button type="button" className="cc-menu-item" onClick={() => beginReply(message)}>Reply</button> : null}
                              {canEdit ? <button type="button" className="cc-menu-item" onClick={() => beginMessageEdit(message)}>Edit</button> : null}
                              <button type="button" className="cc-menu-item" onClick={() => copyMessage(message)}>Copy</button>
                              {canDelete ? <button type="button" className="cc-menu-item danger" onClick={() => deleteMessage(message)}>{messageBusyId === String(message.id) ? 'Deleting...' : (canHardDeleteMessages ? 'Delete for Everyone' : 'Delete for Everyone')}</button> : null}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {replied ? (
                        <button type="button" className="cc-reply-preview-card" onClick={() => beginReply(replied)}>
                          <strong>{replied.sender_username === user?.username ? 'You' : replied.sender_username}</strong>
                          <span>{shortText(replied.body, 90)}</span>
                        </button>
                      ) : null}

                      <div className="cc-message-body">{message.body}</div>
                      {status.isAuditDeleted ? <div className="cc-audit-note">{status.deletedHint || 'Manager-only audit view. This message was removed for everyone else.'}</div> : null}
                      <div className="cc-message-footer">
                        {status.isEdited ? <span className="cc-message-chip">Edited</span> : null}
                        {status.isDeleted && !status.isAuditDeleted ? <span className="cc-message-chip">Deleted</span> : null}
                        {status.isAuditDeleted ? <span className="cc-message-chip">{status.deletedBadge || 'Deleted for everyone'}</span> : null}
                        <div className="cc-message-time">{formatStamp(message.created_at)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {threadMessages.length === 0 ? (
                <div className="cc-empty-state">
                  <strong>No messages yet</strong>
                  <span>Start the conversation from here. New updates will appear in this thread instantly.</span>
                </div>
              ) : null}
              <div ref={endRef} />
            </div>

            {replySource ? (
              <div className="cc-inline-banner">
                <div>
                  <strong>Replying to {replySource.sender_username === user?.username ? 'You' : replySource.sender_username}</strong>
                  <span>{shortText(replySource.body, 120)}</span>
                </div>
                <button className="cc-ghost-btn" type="button" onClick={() => setReplyTo(null)}>Cancel</button>
              </div>
            ) : null}

            {replySuggestions.length ? (
              <div className="cc-suggestion-row">
                {replySuggestions.map((suggestion) => (
                  <button key={suggestion} type="button" className="cc-suggestion-chip" onClick={() => setBody(suggestion)}>{suggestion}</button>
                ))}
              </div>
            ) : null}

            {editingMessageId ? (
              <div className="cc-inline-banner">
                <div>
                  <strong>Editing your message</strong>
                  <span>This message is loaded in the composer. Saving will update the same bubble in place.</span>
                </div>
                <button className="cc-ghost-btn" type="button" onClick={resetComposer}>Cancel Edit</button>
              </div>
            ) : null}

            <div className="cc-composer-row" ref={emojiWrapRef}>
              <div className="cc-composer-box">
                <button className="cc-emoji-btn" type="button" onClick={() => setShowEmojiPicker((prev) => !prev)}>😊</button>
                <input
                  ref={composerRef}
                  className="cc-composer-input"
                  value={composerValue}
                  onChange={(e) => (editingMessageId ? setEditingMessageBody(e.target.value) : setBody(e.target.value))}
                  placeholder={editingMessageId ? 'Edit your message' : replySource ? 'Type your reply' : 'Type a message'}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      onComposerSubmit();
                    }
                  }}
                />
              </div>
              <button className="cc-send-btn" type="button" disabled={!composerValue.trim() || composerBusy} onClick={onComposerSubmit}>
                {composerBusy ? (editingMessageId ? 'Saving...' : 'Sending...') : (editingMessageId ? 'Save' : 'Send')}
              </button>

              {showEmojiPicker ? (
                <div className="cc-emoji-picker">
                  <div className="cc-emoji-tabs">
                    {emojiTabs.map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        className={`cc-emoji-tab ${activeEmojiTab === tab.key ? 'active' : ''}`}
                        onClick={() => setActiveEmojiTab(tab.key)}
                        title={tab.label}
                      >
                        {tab.icon}
                      </button>
                    ))}
                  </div>
                  <input
                    className="cc-search-emoji"
                    value={emojiSearch}
                    onChange={(e) => setEmojiSearch(e.target.value)}
                    placeholder="Search emoji"
                  />
                  <div className="cc-emoji-title">{activeEmojiCategory?.label || 'Emoji'}</div>
                  <div className="cc-emoji-grid">
                    {visibleEmojis.map((emoji) => (
                      <button key={`${activeEmojiCategory?.key}-${emoji}`} type="button" className="cc-emoji-item" onClick={() => addEmoji(emoji)}>
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
