import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { useAuth } from '../lib/auth';
import './ChatPageFinal.css';

const EMOJIS = ['🧿', '😂', '🥰', '🎉', '🥳', '✨', '😇', '😘', '😔', '😍', '😏', '🙂'];

const DEFAULT_TEAM_GROUP = { group_id: 'team', title: 'Team Aaryansh', status: 'Active', visibility: 'all' };
const ARIA_REPORT_THREAD = 'aria-reports';
const CHAT_SHELL_CACHE_KEY = 'cc489_chat_shell';

function readShellCache() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(CHAT_SHELL_CACHE_KEY) || '{}') || {};
    return {
      groups: Array.isArray(parsed.groups) && parsed.groups.length ? parsed.groups : [DEFAULT_TEAM_GROUP],
      contacts: Array.isArray(parsed.contacts) ? parsed.contacts : [],
      members: Array.isArray(parsed.members) ? parsed.members : [],
      reviewItems: Array.isArray(parsed.reviewItems) ? parsed.reviewItems : [],
      permissions: parsed.permissions && typeof parsed.permissions === 'object' ? parsed.permissions : {},
    };
  } catch (_) {
    return { groups: [DEFAULT_TEAM_GROUP], contacts: [], members: [], reviewItems: [], permissions: {} };
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
    sessionStorage.setItem(CHAT_SHELL_CACHE_KEY, JSON.stringify(next));
  } catch (_) {}
}

function formatStamp(value) {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('en-IN', {
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
function readThreadCache(threadKey) {
  try {
    const cached = JSON.parse(sessionStorage.getItem(`cc_chat_cache:${threadKey}`) || '[]');
    return Array.isArray(cached) ? cached : [];
  } catch (_) { return []; }
}
function mergeMessages(current = [], incoming = []) {
  const map = new Map();
  [...current, ...incoming].forEach((item) => { if (item) map.set(idOf(item), item); });
  return Array.from(map.values()).sort((a, b) => (Number(a.id || 0) - Number(b.id || 0)) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
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
    {report.rows.length ? <div className="ariaSheetTableWrap"><table className="ariaSheetTable"><thead><tr><th>#</th><th>Team Member</th><th>Dialed</th><th>Connected</th><th>Incoming</th><th>Talk</th><th>Subm.</th><th>Break</th><th>Idle</th></tr></thead><tbody>{report.rows.map((row) => <tr key={`${row.rank}-${row.name}`}><td>{row.rank}</td><td className="ariaSheetName">{row.name}</td><td>{row.dialed}</td><td>{row.connected}</td><td>{row.incoming}</td><td>{row.talk}</td><td>{row.submissions}</td><td>{row.breakTime}</td><td>{row.idle}</td></tr>)}</tbody></table></div> : <div className="ariaSheetEmpty">No team activity recorded in this window.</div>}
  </div>;
}

export default function ChatPage() {
  const { user } = useAuth();
  const initialShell = useMemo(() => readShellCache(), []);
  const [groups, setGroups] = useState(initialShell.groups);
  const [contacts, setContacts] = useState(initialShell.contacts);
  const [members, setMembers] = useState(initialShell.members);
  const [messages, setMessages] = useState([]);
  const [reviewItems, setReviewItems] = useState(initialShell.reviewItems);
  const [permissions, setPermissions] = useState(initialShell.permissions);
  const [selectedContext, setSelectedContext] = useState(null);
  const [currentThread, setCurrentThread] = useState(new URLSearchParams(window.location.search).get('thread') || 'team');
  const [activeTab, setActiveTab] = useState('all');
  const [infoTab, setInfoTab] = useState('overview');
  const [infoOpen, setInfoOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [peopleQuery, setPeopleQuery] = useState('');
  const [body, setBody] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const [renameTitle, setRenameTitle] = useState('');
  const [memberInput, setMemberInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editingBody, setEditingBody] = useState('');
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [renamePopoverOpen, setRenamePopoverOpen] = useState(false);
  const [renameSaving, setRenameSaving] = useState(false);
  const endRef = useRef(null);
  const latestMessageIdRef = useRef(0);

  useLayoutEffect(() => {
    document.body.classList.add('cc474-chat');
    return () => document.body.classList.remove('cc474-chat');
  }, []);

  const isManager = Boolean(permissions?.can_manage_groups) || ['admin', 'manager'].includes(roleOf(user));
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
      const incoming = Array.isArray(data?.messages) ? data.messages : [];
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
        const next = mergeMessages(options?.replace ? [] : current, incoming);
        try { sessionStorage.setItem(`cc_chat_cache:${currentThread}`, JSON.stringify(next.slice(-80))); } catch (_) {}
        return next;
      });
      setError(data?.__stale ? 'Chat is showing saved messages while the server reconnects.' : '');
    } catch (err) {
      if (String(err?.code || '') === 'BACKGROUND_ABORT') return;
      // Keep previously loaded messages and unsent draft. Explain connectivity honestly.
      const loginNeeded = Number(err?.status || 0) === 401;
      setError(loginNeeded
        ? 'Chat session expired. Sign in again to reconnect.'
        : 'Chat server is not responding yet. Your already loaded messages are still visible.');
    }
  }, [currentThread]);

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
  useEffect(() => { window.__CC_CHAT_NATIVE_SSE = false; window.__CC_CHAT_LIVE_PUSH__ = true; }, []);
  useEffect(() => { const feed = endRef.current?.parentElement; if (feed) feed.scrollTop = feed.scrollHeight; }, [messages.length]);

  function openThread(threadKey, tab = null) {
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

  async function sendMessage() {
    const clean = String(body || '').trim();
    if (!clean || busy) return;
    const optimisticId = `optimistic-${Date.now()}`;
    const optimistic = {
      id: optimisticId,
      sender_username: user?.username || 'You',
      sender_name: user?.full_name || user?.username || 'You',
      body: clean,
      created_at: new Date().toISOString(),
      thread_key: currentThread,
      optimistic: '1',
    };
    setBusy(true); setBody(''); setMessages((cur) => {
      const next = mergeMessages(cur, [optimistic]);
      try { sessionStorage.setItem(`cc_chat_cache:${currentThread}`, JSON.stringify(next.slice(-80))); } catch (_) {}
      return next;
    }); setError('');
    try {
      const response = await api.post('/api/chat/messages', { thread_key: currentThread, body: clean });
      const saved = response?.item || null;
      if (saved) latestMessageIdRef.current = Math.max(Number(latestMessageIdRef.current || 0), Number(saved?.id || 0) || 0);
      setMessages((cur) => {
        const next = mergeMessages(cur.filter((m) => String(m.id) !== optimisticId), saved ? [saved] : []);
        try { sessionStorage.setItem(`cc_chat_cache:${currentThread}`, JSON.stringify(next.slice(-80))); } catch (_) {}
        return next;
      });
      if (response?.review_pending) setError('Message moved to review queue for approval.');
    } catch (err) {
      setMessages((cur) => cur.filter((m) => String(m.id) !== optimisticId));
      setBody(clean); setError(err.message || 'Message could not be sent.');
    } finally { setBusy(false); }
  }

  async function createGroup() {
    const title = groupTitle.trim();
    if (!title) return;
    setBusy(true);
    try {
      const r = await api.post('/api/chat/groups', { title });
      setGroupTitle('');
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

  return (
    <Layout title="CRM Team Chat" subtitle="">
      <div className={`teamsShell ${infoOpen ? '' : 'infoClosed'}`}>
        <aside className="teamsPanel teamsLeft">
          <div className="teamsTopActions">
            <div className="teamsPanelTitle">Team Spaces</div>
            {isManager ? <button type="button" className="teamsAddBtn" title="New Channel" onClick={() => { setActiveTab('channels'); setShowCreatePanel((v) => !v); }}>+</button> : null}
          </div>
          <input className="teamsSearch" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats or channels…" />
          <div className="teamsTabs">
            <button type="button" className={activeTab === 'all' ? 'active' : ''} onClick={() => setActiveTab('all')}>All</button>
            <button type="button" className={activeTab === 'channels' ? 'active' : ''} onClick={() => setActiveTab('channels')}>Channels</button>
            <button type="button" className={activeTab === 'people' ? 'active' : ''} onClick={() => setActiveTab('people')}>People</button>
            {canReview ? <button type="button" className={activeTab === 'review' ? 'active' : ''} onClick={() => setActiveTab('review')}>Review{reviewItems.length ? ` ${reviewItems.length}` : ''}</button> : null}
          </div>

          <div className="cc754EmployeeSearchWrap">
            <div className="cc754EmployeeSearchLabel"><span>Employee Search</span><span>{filteredContacts.length} visible</span></div>
            <input className="cc754EmployeeSearch" type="search" value={peopleQuery} onChange={(e) => setPeopleQuery(e.target.value)} placeholder="Search employee name or role…" aria-label="Search employees" />
          </div>

          {showCreatePanel && isManager ? <div className="createPanel">
            <input className="chatInput" value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} placeholder="New channel name" />
            <button className="miniBlue fullBtn" disabled={busy || !groupTitle.trim()} onClick={createGroup}>Create Channel</button>
          </div> : null}

          <div className="leftScroll">
            {showChannels ? <>
              <div className="teamsSectionTitle"><span>Channels</span><span>{filteredGroups.length}</span></div>
              {filteredGroups.map((g) => (
                <button key={g.group_id} type="button" className={`threadBtn ${String(currentThread) === String(g.group_id) ? 'active' : ''}`} onClick={() => openThread(g.group_id, 'channels')}>
                  <span className="listAvatar channelAvatar" aria-hidden="true">#</span>
                  <div className="threadMain"><div className="threadTitle">{titleOf(g)}</div></div>
                </button>
              ))}
            </> : null}

            {showPeople ? <>
              <div className="teamsSectionTitle"><span>Recent Chats</span><span>{filteredContacts.length}</span></div>
              {filteredContacts.map((c) => {
                const ariaContact = Boolean(c.is_bot) || String(c.username || '').toLowerCase() === 'aria';
                const threadKey = ariaContact ? ARIA_REPORT_THREAD : directThreadFor(user, c);
                const role = String(c.role || '').toLowerCase();
                return <button key={`${c.user_id}-${c.username}`} type="button" className={`personBtn ${role === 'manager' ? 'personBtnManager' : ''} ${ariaContact ? 'ariaContactBtn' : ''} ${String(currentThread) === threadKey ? 'active' : ''}`} disabled={!ariaContact && !c.can_chat} onClick={() => (ariaContact || c.can_chat) && openThread(threadKey, 'people')}>
                  <span className="listAvatar personAvatar" aria-hidden="true">{initials(c.full_name || c.username)}</span>
                  <div className="threadMain"><div className="threadTitle" title={c.full_name || c.username}>{c.full_name}{c.is_self ? ' (You)' : ''}</div></div>
                  <span className="rolePill" title={role || 'user'}>{role === 'tl' ? 'TL' : role || 'user'}</span>
                </button>;
              })}
            </> : null}

            {showReview ? <div className="leftReviewList">
              {reviewItems.length ? reviewItems.map((m) => <button type="button" className="leftReviewItem" key={idOf(m)} onClick={() => openInfo('settings')}>
                <strong>{m.sender_username || 'User'}</strong><span>{String(m.original_body || m.body || '').slice(0, 80)}</span>
              </button>) : <div className="mutedBox">No pending review.</div>}
            </div> : null}
          </div>
        </aside>

        <main className="teamsPanel chatMain">
          <div className="teamsChatHeader">
            <div className="chatTitleRow">
              <div className="chatTitleText"><div className="panel-title chat-room-title">{titleOf(selectedGroup)}</div></div>
            </div>
            <button type="button" className="ghost-btn bounceable cc603-chat-refresh" disabled={busy} onClick={() => loadChat({ force: true, replace: false })} title="Fetch only new chat messages when you want">↻ Refresh Messages</button>
            <div className="chatHeadTools">
              <div className="headAvatars">
                {headMembers.map((m, idx) => <button type="button" key={`${m.user_id || m.username || idx}`} className={`headAvatar a${idx + 1}`} title={m.full_name || m.username || 'Member'} onClick={() => openInfo('members')}>{initials(m.full_name || m.username)}</button>)}
                {visibleMembers.length > 3 ? <button type="button" className="headAvatar more" title="View members" onClick={() => openInfo('members')}>+{visibleMembers.length - 3}</button> : null}
              </div>
              <button type="button" className="headToolBtn" title="Overview" onClick={() => openInfo('overview')}>i</button>
              <div className="channelMenuWrap">
                <button type="button" className={`headToolBtn ${headerMenuOpen ? 'active' : ''}`} title="Channel menu" aria-expanded={headerMenuOpen} onClick={() => setHeaderMenuOpen((v) => !v)}>•••</button>
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

          <div className="chatFeed">
            <div className="dateDivider">Today</div>
            {chatRows.map((item) => {
              const mine = String(item.sender_username || '').toLowerCase() === String(user?.username || '').toLowerCase();
              const editing = String(editingId) === String(item.id);
              const pending = String(item.moderation_status || '').toLowerCase() === 'review_pending';
              const sender = item.sender_name || item.sender_username || 'User';
              const ariaReport = String(item.sender_username || '').toLowerCase() === 'aria' && String(item.reference_type || '') === 'semi_hourly_report';
              const reportPath = ariaReport && item.reference_id ? `/semi-hourly-report?reportId=${encodeURIComponent(item.reference_id)}` : '';
              const reportBody = ariaReport ? String(item.body || '').replace(/(?:^|\n)Chart:\s*\/semi-hourly-report\?reportId=[^\s]+/i, '').trim() : String(item.body || '');
              return <div key={idOf(item)} className={`chatRow ${mine ? 'mine' : ''} ${ariaReport ? 'ariaReportRow' : ''}`}>
                <span className="chatAvatar" aria-hidden="true">{initials(mine ? (user?.full_name || 'You') : sender)}</span>
                <div className="chatBubble">
                  <div className="chatMeta"><strong>{mine ? 'You' : sender}</strong><span>{formatStamp(item.created_at)}</span>{pending ? <span className="reviewBadge">Review</span> : null}{item.audit_deleted ? <span className="reviewBadge">Audit</span> : null}</div>
                  {editing ? <>
                    <textarea className="chatInput" rows="3" value={editingBody} onChange={(e) => setEditingBody(e.target.value)} />
                    <div className="rowActions"><button className="tinyBtn" onClick={() => setEditingId('')}>Cancel</button><button className="miniBlue" onClick={() => saveEdit(item.id)} disabled={busy}>Save</button></div>
                  </> : <><div className={`chatBody ${ariaReport ? 'ariaReportBody' : ''}`}>{ariaReport ? <AriaReportTable body={reportBody} /> : item.body}</div>{ariaReport && reportPath ? <button type="button" className="ariaReportOpen" onClick={() => { window.history.pushState(null, '', reportPath); window.dispatchEvent(new PopStateEvent('popstate')); }}>Open Performance Chart</button> : null}</>}
                  {!editing ? <details className="messageMenu"><summary aria-label="Message actions">⋯</summary><div className="messageMenuPopup"><button className="tinyBtn" onClick={() => { setEditingId(String(item.id)); setEditingBody(String(item.body || '')); }}>Edit</button><button className="tinyBtn danger" onClick={() => deleteMessage(item.id)}>Delete</button></div></details> : null}
                </div>
              </div>;
            })}
            {!chatRows.length ? <div className="mutedBox">No messages yet.</div> : null}
            <div ref={endRef} />
          </div>

          {currentThread === ARIA_REPORT_THREAD ? <div className="composer ariaReportComposerNote"><div className="mutedBox">ARIA automatic report feed • New 30-minute reports will appear here.</div></div> : <div className={`composer ${emojiOpen ? 'emojiOpen' : ''}`}>
            <div className="emojiBar">{EMOJIS.map((e) => <button key={e} className="emojiBtn" type="button" onClick={() => setBody((v) => `${v}${v ? ' ' : ''}${e}`)}>{e}</button>)}</div>
            <div className="composeBox">
              <button type="button" className="emojiToggle" aria-label="Emoji" onClick={() => setEmojiOpen((v) => !v)}>☺</button>
              <textarea rows="2" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Type a message…" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} />
              <button type="button" className="sendBtn" disabled={busy || !body.trim()} onClick={sendMessage} aria-label="Send message">{busy ? '…' : '➤'}</button>
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
