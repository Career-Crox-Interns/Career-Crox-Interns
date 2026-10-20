import React, { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { api, cachePrincipal } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { useAuth } from '../lib/auth';
import './ChatPageFinal.css';
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
    const markRead=() => { if(!document.hidden && document.hasFocus()) api.post('/api/chat/read',{thread_key:threadRef.current,last_read_id:latestMessageIdRef.current},{background:true,retries:0}).then(()=>{if(isCurrent())setInboxRows(rows=>rows.map(r=>r.thread_key===effectThread?{...r,unread_count:0}:r));}).catch(()=>{}); };
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

  useEffect(()=>{try{sessionStorage.setItem(`cc791:inbox:${cachePrincipal()}`,JSON.stringify(inboxRows));localStorage.setItem(`cc791:inbox:${cachePrincipal()}`,JSON.stringify(inboxRows));}catch{} window.dispatchEvent(new CustomEvent('cc790-chat-read',{detail:{unread:inboxRows.some(r=>Number(r.unread_count)>0)}}));},[inboxRows]);

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
    try { sessionStorage.setItem(storageKey, JSON.stringify(intent)); } catch {}
    nearBottomRef.current = true;
    setBusy(true); if (!retryMessage || bodyRef.current.trim() === clean) updateBody(''); setMessages((cur) => {
      const next = mergeMessages(cur, [optimistic]);
      writeThreadCache(sentThread, next, principal);
      return next;
    }); setError('');
    try {
      const response = await api.post('/api/chat/messages', { thread_key: sentThread, body: clean,client_message_key:intent.key }, { retries:0 });
      const saved = response?.item || null;
      if (!saved?.id) throw new Error('Message receipt was not received. Retry the same text.');
      sendIntentRef.current = null;
      try { sessionStorage.removeItem(storageKey); sessionStorage.removeItem(`cc_chat_send_intent:${principal}`); } catch {}
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
      if (confirmed) { sendIntentRef.current = null; try { sessionStorage.removeItem(storageKey); } catch {} }
    } finally { if (mountedRef.current) setBusy(false); }
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
                    <textarea className="chatInput" rows="3" value={editingBody} onChange={(e) => setEditingBody(e.target.value)} />
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
