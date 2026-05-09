import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { useAuth } from '../lib/auth';

const EMOJIS = ['👍','✅','🔥','🙏','😂','🎯','💯','🚀','✨','❤️','👏','🙌','😎','🫡','💬','⭐'];

function formatStamp(value) {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
}
function idOf(item) { return String(item?.id || item?.message_id || `m-${Math.random()}`); }
function titleOf(group) { return group?.title || group?.name || group?.group_id || 'Group'; }
function roleOf(user) { return String(user?.role || '').toLowerCase(); }
function normalizeGroupId(value) { return String(value || '').trim() || 'team'; }
function membersFor(members, groupId) { return (Array.isArray(members) ? members : []).filter((m) => String(m.group_id) === String(groupId)); }
function mergeMessages(current = [], incoming = []) {
  const map = new Map();
  [...current, ...incoming].forEach((item) => { map.set(idOf(item), item); });
  return Array.from(map.values()).sort((a, b) => (Number(a.id || 0) - Number(b.id || 0)) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
}

export default function ChatPage() {
  const { user } = useAuth();
  const [groups, setGroups] = useState([]);
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [reviewItems, setReviewItems] = useState([]);
  const [permissions, setPermissions] = useState({});
  const [currentThread, setCurrentThread] = useState(new URLSearchParams(window.location.search).get('thread') || 'team');
  const [body, setBody] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const [renameTitle, setRenameTitle] = useState('');
  const [memberInput, setMemberInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editingBody, setEditingBody] = useState('');
  const endRef = useRef(null);
  const latestMessageIdRef = useRef(0);
  const isManager = Boolean(permissions?.can_manage_groups) || ['admin', 'manager'].includes(roleOf(user));
  const canRename = Boolean(permissions?.can_rename_groups) || isManager || ['tl', 'team lead'].includes(roleOf(user));
  const canReview = Boolean(permissions?.can_review) || isManager || ['tl', 'team lead'].includes(roleOf(user));

  const selectedGroup = useMemo(() => groups.find((g) => String(g.group_id) === String(currentThread)) || groups[0] || { group_id: 'team', title: 'General Team' }, [groups, currentThread]);
  const selectedMembers = useMemo(() => membersFor(members, currentThread), [members, currentThread]);
  const chatRows = useMemo(() => messages.slice(-260), [messages]);

  const loadChat = useCallback(async (options = {}) => {
    try {
      const sinceId = options?.replace ? 0 : Number(latestMessageIdRef.current || 0);
      const params = new URLSearchParams({ thread_key: currentThread });
      if (sinceId > 0) params.set('since_id', String(sinceId));
      if (options?.replace) params.set('full', '1');
      if (options?.force) params.set('_', String(Date.now()));
      const data = await api.get(`/api/chat?${params.toString()}`, { cacheTtlMs: options?.replace ? 0 : 9000, timeoutMs: 14000, retries: 1, background: !options?.replace });
      const incoming = Array.isArray(data?.messages) ? data.messages : [];
      if (Array.isArray(data?.groups)) setGroups(data.groups);
      if (Array.isArray(data?.members)) setMembers(data.members);
      if (Array.isArray(data?.review_items)) setReviewItems(data.review_items);
      if (data?.permissions) setPermissions(data.permissions);
      if (Number(data?.latest_message_id || 0) > 0) latestMessageIdRef.current = Number(data.latest_message_id || 0);
      else if (incoming.length) latestMessageIdRef.current = Math.max(latestMessageIdRef.current || 0, ...incoming.map((item) => Number(item?.id || 0) || 0));
      setMessages((current) => mergeMessages(options?.replace ? [] : current, incoming));
      setError('');
    } catch (err) {
      if (String(err?.code || '') === 'BACKGROUND_ABORT') return;
      setError(err.message || 'Team chat could not load. Technology has again chosen violence.');
    }
  }, [currentThread]);

  useEffect(() => { latestMessageIdRef.current = 0; setMessages([]); loadChat({ force: true, replace: true }); }, [currentThread, loadChat]);
  usePolling(() => loadChat({ force: false }), 30000, [user?.user_id, currentThread, loadChat]);
  useEffect(() => { if (endRef.current) endRef.current.scrollIntoView({ block: 'end' }); }, [messages.length]);

  async function sendMessage() {
    const clean = String(body || '').trim();
    if (!clean || busy) return;
    const optimisticId = `optimistic-${Date.now()}`;
    const optimistic = { id: optimisticId, sender_username: user?.username || 'You', body: clean, created_at: new Date().toISOString(), thread_key: currentThread, optimistic: '1' };
    setBusy(true); setBody(''); setMessages((cur) => mergeMessages(cur, [optimistic])); setError('');
    try {
      const response = await api.post('/api/chat/messages', { thread_key: currentThread, body: clean });
      const saved = response?.item || null;
      if (saved) latestMessageIdRef.current = Math.max(Number(latestMessageIdRef.current || 0), Number(saved?.id || 0) || 0);
      setMessages((cur) => mergeMessages(cur.filter((m) => String(m.id) !== optimisticId), saved ? [saved] : []));
      if (response?.review_pending) setError('Message moved to review. TL or Manager can approve it.');
      await loadChat({ force: true });
    } catch (err) {
      setMessages((cur) => cur.filter((m) => String(m.id) !== optimisticId));
      setBody(clean); setError(err.message || 'Message could not be sent.');
    } finally { setBusy(false); }
  }

  async function createGroup() {
    const title = groupTitle.trim();
    if (!title) return;
    setBusy(true);
    try { const r = await api.post('/api/chat/groups', { title }); setGroupTitle(''); await loadChat({ force: true, replace: true }); if (r?.item?.group_id) setCurrentThread(r.item.group_id); }
    catch (err) { setError(err.message || 'Group create failed'); }
    finally { setBusy(false); }
  }

  async function renameGroup() {
    const title = renameTitle.trim();
    if (!title || !selectedGroup?.group_id) return;
    setBusy(true);
    try { await api.put(`/api/chat/groups/${encodeURIComponent(selectedGroup.group_id)}`, { title }); setRenameTitle(''); await loadChat({ force: true, replace: true }); }
    catch (err) { setError(err.message || 'Rename failed'); }
    finally { setBusy(false); }
  }

  async function deleteGroup() {
    if (!selectedGroup?.group_id || selectedGroup.group_id === 'team') return;
    if (!window.confirm(`Delete group ${titleOf(selectedGroup)}?`)) return;
    setBusy(true);
    try { await api.post(`/api/chat/groups/${encodeURIComponent(selectedGroup.group_id)}/delete`, {}); setCurrentThread('team'); await loadChat({ force: true, replace: true }); }
    catch (err) { setError(err.message || 'Delete group failed'); }
    finally { setBusy(false); }
  }

  async function addMembers() {
    if (!memberInput.trim()) return;
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

  return (
    <Layout title="Team Chat" subtitle="Manager-controlled groups, review moderation, and modern emoji actions.">
      <style>{`
        .chatV2{display:grid;grid-template-columns:260px 1fr 310px;gap:14px}.chatCard{border:1px solid rgba(126,163,255,.35);border-radius:24px;background:linear-gradient(135deg,#ffffff,#f5f9ff);box-shadow:0 18px 50px rgba(23,70,160,.10);padding:16px}.chatGroupBtn{width:100%;text-align:left;border:1px solid #dbeafe;background:#fff;border-radius:16px;padding:12px;margin-bottom:8px;font-weight:900;color:#13213c;cursor:pointer}.chatGroupBtn.active{background:linear-gradient(135deg,#eaf7ff,#fff7fd);border-color:#1687ff;box-shadow:0 10px 24px rgba(37,99,235,.12)}.chatFeed{height:520px;overflow:auto;padding:10px;border-radius:20px;background:#f8fbff;border:1px solid #e5edf8}.chatRow{display:flex;margin-bottom:10px}.chatRow.mine{justify-content:flex-end}.chatBubble{max-width:78%;border-radius:20px;background:white;border:1px solid #e5edf8;padding:12px 14px;box-shadow:0 8px 20px rgba(15,23,42,.06)}.chatRow.mine .chatBubble{background:linear-gradient(135deg,#e8f2ff,#f5edff)}.chatMeta{display:flex;gap:10px;align-items:center;font-size:12px;color:#64748b;font-weight:900;margin-bottom:6px}.chatBody{font-size:15px;font-weight:750;color:#14213d;white-space:pre-wrap}.reviewBadge{display:inline-flex;margin-left:6px;padding:3px 8px;border-radius:999px;background:#fff7ed;color:#c2410c;font-size:11px;font-weight:1000}.chatComposer textarea,.chatInput{width:100%;border:1px solid #cfe2ff;border-radius:18px;padding:12px 14px;background:#fff;color:#13213c;font-weight:750}.emojiBar{display:flex;gap:8px;flex-wrap:wrap}.emojiBtn{border:1px solid #dbeafe;background:linear-gradient(135deg,#ffffff,#eef7ff,#fff1fb);border-radius:999px;padding:9px 12px;cursor:pointer;font-size:20px;box-shadow:0 8px 18px rgba(37,99,235,.10);transition:.15s}.emojiBtn:hover{transform:translateY(-1px);box-shadow:0 12px 24px rgba(37,99,235,.16)}.miniDanger{border:1px solid #fecaca;background:#fff1f2;color:#be123c;border-radius:12px;padding:8px 10px;font-weight:900}.miniGood{border:1px solid #bbf7d0;background:#f0fdf4;color:#15803d;border-radius:12px;padding:8px 10px;font-weight:900}.miniBlue{border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:12px;padding:8px 10px;font-weight:900}@media(max-width:1100px){.chatV2{grid-template-columns:1fr}.chatFeed{height:440px}}`}</style>
      <div className="chatV2 top-gap">
        <div className="chatCard">
          <div className="panel-title">Groups</div>
          <div className="helper-text top-gap-small">Managers can create, add, remove, and delete groups. TL can rename only.</div>
          <div className="top-gap-small">
            {groups.map((g) => <button key={g.group_id} type="button" className={`chatGroupBtn ${String(currentThread) === String(g.group_id) ? 'active' : ''}`} onClick={() => setCurrentThread(g.group_id)}>{titleOf(g)}<br /><span className="helper-text">{g.group_id === 'team' ? 'Default team' : `${membersFor(members, g.group_id).length} members`}</span></button>)}
          </div>
          {isManager ? <div className="top-gap"><input className="chatInput" value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} placeholder="New group name" /><button className="add-profile-btn bounceable top-gap-small" disabled={busy || !groupTitle.trim()} onClick={createGroup}>Create Group</button></div> : null}
        </div>

        <div className="chatCard">
          <div className="simple-chat-head">
            <div><div className="panel-title">{titleOf(selectedGroup)}</div><div className="helper-text top-gap-small">{chatRows.length} messages • Review words: fraud, cheat, spam, abuse etc. go to TL/Manager review.</div></div>
            <span className="mini-chip live-chip">{selectedGroup?.group_id || 'team'}</span>
          </div>
          {error ? <div className="helper-text top-gap-small" style={{ color: '#b91c1c' }}>{error}</div> : null}
          <div className="chatFeed top-gap-small">
            {chatRows.map((item) => {
              const mine = String(item.sender_username || '').toLowerCase() === String(user?.username || '').toLowerCase();
              const editing = String(editingId) === String(item.id);
              const pending = String(item.moderation_status || '').toLowerCase() === 'review_pending';
              return <div key={idOf(item)} className={`chatRow ${mine ? 'mine' : ''}`}><div className="chatBubble"><div className="chatMeta"><strong>{item.sender_username || 'User'}</strong><span>{formatStamp(item.created_at)}</span>{pending ? <span className="reviewBadge">Review</span> : null}</div>{editing ? <><textarea rows="3" value={editingBody} onChange={(e) => setEditingBody(e.target.value)} /><div className="row-actions top-gap-small"><button className="ghost-btn bounceable" onClick={() => setEditingId('')}>Cancel</button><button className="add-profile-btn bounceable" onClick={() => saveEdit(item.id)} disabled={busy}>Save</button></div></> : <div className="chatBody">{item.body}</div>} {!editing ? <div className="row-actions top-gap-small"><button className="ghost-btn bounceable" onClick={() => { setEditingId(String(item.id)); setEditingBody(String(item.body || '')); }} disabled={busy || (!mine && !isManager)}>Edit</button><button className="ghost-btn bounceable" onClick={() => deleteMessage(item.id)} disabled={busy || (!mine && !isManager)}>Delete</button></div> : null}</div></div>;
            })}
            {!chatRows.length ? <div className="helper-text">No messages yet.</div> : null}
            <div ref={endRef} />
          </div>
          <div className="chatComposer top-gap">
            <div className="emojiBar bottom-gap-small">{EMOJIS.map((e) => <button key={e} className="emojiBtn" type="button" onClick={() => setBody((v) => `${v}${v ? ' ' : ''}${e}`)}>{e}</button>)}</div>
            <textarea rows="3" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write message" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} />
            <div className="row-actions top-gap-small" style={{ justifyContent: 'space-between', alignItems: 'center' }}><span className="helper-text">Enter sends. Shift + Enter line break.</span><button type="button" className="add-profile-btn bounceable" disabled={busy || !body.trim()} onClick={sendMessage}>{busy ? 'Sending...' : 'Send'}</button></div>
          </div>
        </div>

        <div className="chatCard">
          <div className="panel-title">Controls</div>
          {canRename ? <div className="top-gap-small"><input className="chatInput" value={renameTitle} onChange={(e) => setRenameTitle(e.target.value)} placeholder="Rename selected group" /><button className="miniBlue top-gap-small" disabled={busy || !renameTitle.trim()} onClick={renameGroup}>Rename</button></div> : null}
          {isManager ? <><div className="top-gap"><div className="panel-title">Members</div><textarea className="chatInput" rows="3" value={memberInput} onChange={(e) => setMemberInput(e.target.value)} placeholder="username / user_id, comma separated" /><button className="miniGood top-gap-small" disabled={busy || !memberInput.trim()} onClick={addMembers}>Add Members</button>{selectedMembers.map((m) => <div key={`${m.id || m.username}`} className="top-gap-small" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span className="helper-text">{m.full_name || m.username}</span><button className="miniDanger" onClick={() => removeMember(m)}>Remove</button></div>)}{selectedGroup?.group_id !== 'team' ? <button className="miniDanger top-gap" disabled={busy} onClick={deleteGroup}>Delete Group</button> : null}</div></> : <div className="helper-text top-gap">Only manager can add/remove/delete groups. TL can rename only.</div>}
          {canReview ? <div className="top-gap"><div className="panel-title">Review Queue</div>{reviewItems.length ? reviewItems.map((m) => <div key={idOf(m)} className="top-gap-small" style={{ padding: 10, border: '1px solid #fed7aa', borderRadius: 14, background: '#fff7ed' }}><div className="helper-text"><b>{m.sender_username}</b> • {formatStamp(m.created_at)}</div><div className="chatBody">{m.original_body || m.body}</div><div className="helper-text">{m.moderation_reason}</div><div className="row-actions top-gap-small"><button className="miniGood" onClick={() => reviewMessage(m.id, 'approve')}>Approve</button><button className="miniDanger" onClick={() => reviewMessage(m.id, 'reject')}>Reject</button></div></div>) : <div className="helper-text top-gap-small">No pending review.</div>}</div> : null}
        </div>
      </div>
    </Layout>
  );
}
