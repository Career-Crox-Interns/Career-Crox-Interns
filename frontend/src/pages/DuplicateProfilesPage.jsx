import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { usePolling } from '../lib/usePolling';
import { useAuth } from '../lib/auth';
import { readPageCache, writePageCache } from '../lib/persistentPageCache';

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function formatStamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  return raw.replace('T', ' ').replace('.000Z', '').replace('Z', '').slice(0, 16);
}

function scoreTone(score) {
  if (Number(score || 0) >= 30) return 'success';
  if (Number(score || 0) >= 18) return 'active';
  return 'warning';
}

function yes(value) {
  const v = lower(value);
  return v === '1' || v === 'yes' || v === 'true' || v === 'completed' || v === 'complete' || v === 'done';
}

export default function DuplicateProfilesPage() {
  const { user } = useAuth();
  const duplicateCachePrefix = `careerCroxDuplicateProfiles:${user?.user_id || user?.username || 'anon'}:${user?.role || ''}:${user?.recruiter_code || ''}`;
  const [rows, setRows] = useState(() => readPageCache(`${duplicateCachePrefix}:rows:duplicates`, []));
  const [groups, setGroups] = useState(() => readPageCache(`${duplicateCachePrefix}:groups:duplicates`, []));
  const [serverSummary, setServerSummary] = useState(() => readPageCache(`${duplicateCachePrefix}:summary:duplicates`, null));
  const [loading, setLoading] = useState(() => !readPageCache(`${duplicateCachePrefix}:rows:duplicates`, []).length);
  const [message, setMessage] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [busyIds, setBusyIds] = useState([]);
  const [deleteProgress, setDeleteProgress] = useState(null);
  const [viewMode, setViewMode] = useState('duplicates');
  const viewingDeleted = viewMode === 'deleted';
  const canDelete = ['admin', 'manager'].includes(lower(user?.role)) || lower(user?.designation) === 'manager';

  async function load(options = {}) {
    const cacheKey = viewingDeleted ? 'deleted' : 'duplicates';
    if (!rows.length && !options.background) setLoading(true);
    try {
      const endpoint = viewingDeleted ? '/api/candidates/deleted-profiles' : '/api/candidates/duplicate-groups';
      const data = await api.get(endpoint, { cacheTtlMs: 30000, timeoutMs: 25000, retries: 1, background: Boolean(options.background) });
      const nextRows = Array.isArray(data.items) ? data.items : [];
      const nextGroups = viewingDeleted ? [] : (Array.isArray(data.groups) ? data.groups : []);
      const nextSummary = data.summary || null;
      setRows(nextRows);
      setGroups(nextGroups);
      setServerSummary(nextSummary);
      writePageCache(`${duplicateCachePrefix}:rows:${cacheKey}`, nextRows);
      writePageCache(`${duplicateCachePrefix}:groups:${cacheKey}`, nextGroups);
      writePageCache(`${duplicateCachePrefix}:summary:${cacheKey}`, nextSummary);
      setSelectedIds((current) => current.filter((id) => nextRows.some((row) => String(row.candidate_id) === String(id))));
      setMessage('');
    } catch (error) {
      setMessage(error.message || (viewingDeleted ? 'Deleted profiles could not load.' : 'Duplicate profiles could not load.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const cacheKey = viewingDeleted ? 'deleted' : 'duplicates';
    const cachedRows = readPageCache(`${duplicateCachePrefix}:rows:${cacheKey}`, []);
    const cachedGroups = readPageCache(`${duplicateCachePrefix}:groups:${cacheKey}`, []);
    const cachedSummary = readPageCache(`${duplicateCachePrefix}:summary:${cacheKey}`, null);
    setRows(cachedRows);
    setGroups(cachedGroups);
    setServerSummary(cachedSummary);
    setLoading(!cachedRows.length);
    load({ background: Boolean(cachedRows.length) });
  }, [viewMode]);
  usePolling(() => load({ background: true }), deleteProgress ? 0 : 180000, [Boolean(deleteProgress), viewMode]);

  const selectedSet = useMemo(() => new Set(selectedIds.map((id) => String(id))), [selectedIds]);
  const allIds = useMemo(() => rows.map((row) => String(row.candidate_id)), [rows]);

  function removeDeletedRows(deletedIds = []) {
    const deletedSet = new Set((Array.isArray(deletedIds) ? deletedIds : []).map((id) => String(id)).filter(Boolean));
    if (!deletedSet.size) return;
    setRows((current) => current.filter((row) => !deletedSet.has(String(row.candidate_id || ''))));
    setGroups((current) => current
      .map((group) => {
        const groupRowsLeft = rows.filter((row) => String(row.duplicate_group_key || '') === String(group.group_key || '') && !deletedSet.has(String(row.candidate_id || ''))).length;
        return { ...group, total_profiles: groupRowsLeft };
      })
      .filter((group) => Number(group.total_profiles || 0) >= 2));
    setSelectedIds((current) => current.filter((id) => !deletedSet.has(String(id))));
  }

  const summary = useMemo(() => {
    const autoIds = rows.filter((row) => String(row.auto_select_unfilled_duplicate || '0') === '1').map((row) => String(row.candidate_id));
    return {
      totalGroups: Number(serverSummary?.totalGroups ?? (viewingDeleted ? 0 : groups.length)),
      totalRows: Number(serverSummary?.totalRows ?? rows.length),
      autoRows: Number(serverSummary?.autoRows ?? (viewingDeleted ? 0 : autoIds.length)),
      keepRows: Number(serverSummary?.keepRows ?? (viewingDeleted ? 0 : rows.filter((row) => String(row.duplicate_is_main || row.duplicate_recommended_keep || '0') === '1').length)),
      autoIds,
    };
  }, [groups, rows, serverSummary, viewingDeleted]);

  function toggleOne(candidateId) {
    const id = String(candidateId);
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function selectAll() { setSelectedIds(allIds); }
  function clearSelection() { setSelectedIds([]); }
  function selectUnfilledDuplicates() { setSelectedIds(summary.autoIds); }

  async function deleteOne(candidateId) {
    const id = String(candidateId || '').trim();
    if (!id) return;
    const ok = window.confirm(`Delete profile ${id}? It will move to Deleted Profiles and can be restored later.`);
    if (!ok) return;
    setBusyIds((current) => [...current, id]);
    setDeleteProgress({ total: 1, done: 0, deleted: 0, failed: 0, currentId: id, mode: 'single' });
    try {
      const result = await api.post(`/api/candidates/${encodeURIComponent(id)}/delete`, {}, { timeoutMs: 45000 });
      const doneIds = [...(Array.isArray(result?.deleted_ids) ? result.deleted_ids : []), ...(Array.isArray(result?.soft_hidden_ids) ? result.soft_hidden_ids : [])].map((value) => String(value));
      if (!doneIds.includes(String(id))) throw new Error('Delete safety check failed for selected profile.');
      const failedCount = Array.isArray(result?.failed) ? result.failed.length : 0;
      removeDeletedRows([id]);
      setDeleteProgress({ total: 1, done: 1, deleted: 1, failed: failedCount, currentId: '', mode: 'single' });
      setMessage(failedCount ? `1 moved to Deleted Profiles, ${failedCount} failed.` : `Moved ${id} to Deleted Profiles. Restore option is available in Check Deleted Profiles.`);
      await load();
    } catch (error) {
      setDeleteProgress({ total: 1, done: 1, deleted: 0, failed: 1, currentId: '', mode: 'single' });
      setMessage(error.message || `Delete failed for ${id}.`);
    } finally {
      setBusyIds((current) => current.filter((item) => item !== id));
      window.setTimeout(() => setDeleteProgress(null), 1200);
    }
  }

  async function deleteSelected() {
    if (!selectedIds.length) {
      setMessage('Select profiles first.');
      return;
    }
    const ok = window.confirm(`Delete ${selectedIds.length} selected duplicate profiles? They will move to Deleted Profiles and can be restored later.`);
    if (!ok) return;
    const ids = [...selectedIds];
    let deletedCount = 0;
    let failedCount = 0;
    const failedIds = [];
    setBusyIds(ids);
    setDeleteProgress({ total: ids.length, done: 0, deleted: 0, failed: 0, currentId: ids[0] || '', mode: 'bulk' });
    try {
      for (let index = 0; index < ids.length; index += 1) {
        const id = ids[index];
        setDeleteProgress({ total: ids.length, done: index, deleted: deletedCount, failed: failedCount, currentId: id, mode: 'bulk' });
        try {
          const result = await api.post(`/api/candidates/${encodeURIComponent(id)}/delete`, {}, { timeoutMs: 45000 });
          const doneIds = [...(Array.isArray(result?.deleted_ids) ? result.deleted_ids : []), ...(Array.isArray(result?.soft_hidden_ids) ? result.soft_hidden_ids : [])].map((value) => String(value));
          if (!doneIds.includes(String(id))) throw new Error('Delete safety check failed for selected profile.');
          deletedCount += 1;
          removeDeletedRows([id]);
        } catch {
          failedCount += 1;
          failedIds.push(id);
        }
        setDeleteProgress({ total: ids.length, done: index + 1, deleted: deletedCount, failed: failedCount, currentId: ids[index + 1] || '', mode: 'bulk' });
      }
      setSelectedIds(failedIds);
      setMessage(failedCount ? `${deletedCount} moved to Deleted Profiles, ${failedCount} failed.` : `${deletedCount} selected profiles moved to Deleted Profiles.`);
      await load();
    } catch (error) {
      setMessage(error.message || 'Delete selected failed.');
    } finally {
      setBusyIds([]);
      window.setTimeout(() => setDeleteProgress(null), 1800);
    }
  }

  async function restoreOne(candidateId) {
    const id = String(candidateId || '').trim();
    if (!id) return;
    const ok = window.confirm(`Restore profile ${id} back to CRM?`);
    if (!ok) return;
    setBusyIds((current) => [...current, id]);
    try {
      await api.post(`/api/candidates/${encodeURIComponent(id)}/restore`, {}, { timeoutMs: 45000 });
      removeDeletedRows([id]);
      setMessage(`Restored ${id} back to CRM.`);
      await load();
    } catch (error) {
      setMessage(error.message || `Restore failed for ${id}.`);
    } finally {
      setBusyIds((current) => current.filter((item) => item !== id));
    }
  }

  async function restoreSelected() {
    if (!selectedIds.length) {
      setMessage('Select deleted profiles first.');
      return;
    }
    const ok = window.confirm(`Restore ${selectedIds.length} selected deleted profiles?`);
    if (!ok) return;
    const ids = [...selectedIds];
    let restoredCount = 0;
    let failedCount = 0;
    const failedIds = [];
    setBusyIds(ids);
    try {
      for (const id of ids) {
        try {
          await api.post(`/api/candidates/${encodeURIComponent(id)}/restore`, {}, { timeoutMs: 45000 });
          restoredCount += 1;
          removeDeletedRows([id]);
        } catch {
          failedCount += 1;
          failedIds.push(id);
        }
      }
      setSelectedIds(failedIds);
      setMessage(failedCount ? `${restoredCount} restored, ${failedCount} failed.` : `${restoredCount} selected profiles restored.`);
      await load();
    } catch (error) {
      setMessage(error.message || 'Restore selected failed.');
    } finally {
      setBusyIds([]);
    }
  }

  async function makeMain(candidateId) {
    const id = String(candidateId || '').trim();
    if (!id) return;
    setBusyIds((current) => [...current, id]);
    try {
      await api.post(`/api/candidates/${encodeURIComponent(id)}/make-main-duplicate`, {}, { timeoutMs: 45000 });
      setMessage(`Main profile updated to ${id}.`);
      await load();
    } catch (error) {
      setMessage(error.message || `Main profile update failed for ${id}.`);
    } finally {
      setBusyIds((current) => current.filter((item) => item !== id));
    }
  }

  function switchView(nextMode) {
    setViewMode(nextMode);
    setSelectedIds([]);
    setMessage('');
  }

  return (
    <Layout
      title="Duplicate Profiles"
      subtitle="Potential duplicate cases stay grouped here. Deleted profiles are kept in a recycle-bin view so manager/admin can restore them when needed."
    >
      <style>{`
        .duplicate-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}
        .duplicate-toolbar-left,.duplicate-toolbar-right{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
        .duplicate-action-btn{border:none;border-radius:12px;padding:10px 14px;font-weight:700;cursor:pointer;background:var(--brand-button);color:#fff;box-shadow:0 10px 20px rgba(79,125,255,.18)}
        .duplicate-action-btn.ghost{background:rgba(79,125,255,.12);color:#244069;box-shadow:none}
        .duplicate-action-btn.warn{background:#ff8d5c;color:#fff}
        .duplicate-action-btn.restore{background:#23a867;color:#fff}
        .duplicate-action-btn:disabled{opacity:.55;cursor:not-allowed;box-shadow:none}
        .duplicate-chip-row{display:flex;flex-wrap:wrap;gap:8px}
        .duplicate-chip{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:rgba(79,125,255,.12);font-weight:700;color:#28456c}
        .duplicate-summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-top:14px}
        .duplicate-summary-card{padding:16px;border-radius:20px;background:linear-gradient(135deg,rgba(255,255,255,.78),rgba(234,242,255,.88));border:1px solid rgba(123,166,255,.24)}
        .duplicate-summary-card strong{display:block;font-size:26px;line-height:1.1;color:#183055}
        .duplicate-summary-card span{display:block;margin-top:6px;color:#476182;font-weight:700}
        .duplicate-table-wrap{overflow:auto;padding-bottom:8px}
        .duplicate-table{min-width:2900px;width:max-content;border-collapse:separate;border-spacing:0}
        .duplicate-table td,.duplicate-table th{white-space:nowrap;vertical-align:top;padding:14px 14px;font-size:15px;line-height:1.35;min-width:110px;text-align:left}
        .duplicate-table th{font-size:15px;font-weight:800}
        .duplicate-table .col-select{min-width:60px;width:60px}
        .duplicate-table .col-delete{min-width:92px;width:92px}
        .duplicate-table .col-score{min-width:110px;width:110px}
        .duplicate-table .col-profile{min-width:250px;width:250px}
        .duplicate-table .col-id{min-width:110px;width:110px}
        .duplicate-table .col-phone{min-width:150px;width:150px}
        .duplicate-table .col-date{min-width:165px;width:165px}
        .duplicate-table .col-short{min-width:120px;width:120px}
        .duplicate-table .col-medium{min-width:150px;width:150px}
        .duplicate-table .col-long{min-width:180px;width:180px}
        .duplicate-table .col-xl{min-width:220px;width:220px;white-space:normal}
        .duplicate-row-main td{background:linear-gradient(90deg, rgba(204,255,220,.18), rgba(245,255,248,.12))}
        .duplicate-row-main td:first-child{border-left:3px solid rgba(58,165,89,.55)}
        .deleted-profile-row td{background:linear-gradient(90deg, rgba(255,236,220,.22), rgba(255,249,244,.12))}
        .profile-link,.profile-box{display:flex;flex-direction:column;gap:6px;text-decoration:none;color:#183055}
        .profile-link:hover{text-decoration:underline}
        .profile-name{font-weight:800;font-size:16px;color:#173b67}
        .profile-sub{font-size:13px;color:#5c7391;font-weight:700}
        .mini-stack{display:flex;flex-direction:column;gap:6px}
        .status-pill{display:inline-flex;align-items:center;justify-content:center;min-height:30px;padding:5px 10px;border-radius:999px;font-size:12px;font-weight:800;background:rgba(79,125,255,.10);color:#234366}
        .status-pill.main{background:rgba(63,184,120,.18);color:#17653f}
        .status-pill.extra{background:rgba(255,145,92,.16);color:#9c4d16}
        .duplicate-delete-btn{min-width:44px;height:36px;border-radius:10px;border:none;cursor:pointer;background:rgba(255,113,113,.14);color:#8f1e1e;font-size:14px;font-weight:900;padding:0 10px}
        .duplicate-restore-btn{min-width:78px;height:36px;border-radius:10px;border:none;cursor:pointer;background:rgba(35,168,103,.16);color:#13663b;font-size:13px;font-weight:900;padding:0 10px}
        .duplicate-main-btn{border:none;border-radius:10px;padding:8px 12px;font-size:13px;font-weight:800;cursor:pointer;background:rgba(63,184,120,.14);color:#1f7a4b}
        .duplicate-main-btn.active{background:linear-gradient(135deg, rgba(65,184,120,.24), rgba(176,255,205,.34));color:#155333}
        .duplicate-delete-btn:disabled,.duplicate-restore-btn:disabled,.duplicate-main-btn:disabled{opacity:.45;cursor:not-allowed}
        .duplicate-empty{padding:20px;color:#536d8e;font-weight:700}
      `}</style>

      <div className="table-panel top-gap-small glassy-card fade-up">
        <div className="table-toolbar duplicate-toolbar">
          <div className="duplicate-toolbar-left">
            <div className="table-title">{viewingDeleted ? 'Deleted Profiles / Recycle Bin' : 'Duplicate Profiles Review'}</div>
            <div className="duplicate-chip-row">
              {viewingDeleted ? (
                <>
                  <span className="duplicate-chip">{summary.totalRows} deleted profiles</span>
                  <span className="duplicate-chip">{selectedIds.length} selected</span>
                </>
              ) : (
                <>
                  <span className="duplicate-chip">{summary.totalGroups} duplicate sets</span>
                  <span className="duplicate-chip">{summary.totalRows} profiles</span>
                  <span className="duplicate-chip">{summary.autoRows} auto-select extras</span>
                </>
              )}
            </div>
          </div>
          <div className="duplicate-toolbar-right">
            <button type="button" className="duplicate-action-btn ghost" onClick={() => switchView(viewingDeleted ? 'duplicates' : 'deleted')} disabled={Boolean(deleteProgress)}>{viewingDeleted ? 'Back to Duplicate Profiles' : 'Check Deleted Profiles'}</button>
            <button type="button" className="duplicate-action-btn ghost" onClick={selectAll} disabled={Boolean(deleteProgress)}>Select All</button>
            {!viewingDeleted ? <button type="button" className="duplicate-action-btn ghost" onClick={selectUnfilledDuplicates} disabled={Boolean(deleteProgress)}>Select Unfilled Duplicate Profiles</button> : null}
            <button type="button" className="duplicate-action-btn ghost" onClick={clearSelection} disabled={Boolean(deleteProgress)}>Clear</button>
            {canDelete && viewingDeleted ? <button type="button" className="duplicate-action-btn restore" onClick={restoreSelected} disabled={Boolean(deleteProgress)}>Restore Selected</button> : null}
            {canDelete && !viewingDeleted ? <button type="button" className="duplicate-action-btn warn" onClick={deleteSelected} disabled={Boolean(deleteProgress)}>{deleteProgress ? `Deleting ${deleteProgress.deleted}/${deleteProgress.total}` : 'Delete Selected'}</button> : null}
          </div>
        </div>
        <div className="duplicate-summary-grid">
          <div className="duplicate-summary-card"><strong>{viewingDeleted ? summary.totalRows : summary.totalGroups}</strong><span>{viewingDeleted ? 'profiles in recycle bin' : 'possible duplicate sets'}</span></div>
          <div className="duplicate-summary-card"><strong>{summary.totalRows}</strong><span>{viewingDeleted ? 'deleted profiles' : 'profiles under review'}</span></div>
          <div className="duplicate-summary-card"><strong>{viewingDeleted ? selectedIds.length : summary.keepRows}</strong><span>{viewingDeleted ? 'selected to restore' : 'current main rows on top'}</span></div>
          <div className="duplicate-summary-card"><strong>{selectedIds.length}</strong><span>selected for manual action</span></div>
        </div>
        {deleteProgress ? (
          <div className="helper-text top-gap" style={{ fontWeight: 800 }}>
            Delete progress: {deleteProgress.deleted} moved to Deleted Profiles • {Math.max((deleteProgress.total || 0) - (deleteProgress.done || 0), 0)} left • {deleteProgress.failed} failed{deleteProgress.currentId ? ` • Current: ${deleteProgress.currentId}` : ''}
          </div>
        ) : null}
        {message ? <div className="helper-text top-gap">{message}</div> : null}
      </div>

      <div className="table-panel top-gap glassy-card fade-up">
        <div className="duplicate-table-wrap crm-table-wrap dense-wrap">
          <table className="crm-table colorful-table dense-table duplicate-table">
            <thead>
              <tr>
                <th className="col-select">Select</th>
                {canDelete ? <th className="col-delete">{viewingDeleted ? 'Restore' : 'Delete'}</th> : null}
                <th className="col-score">Score</th>
                <th className="col-profile">Profile</th>
                <th className="col-id">Candidate ID</th>
                <th className="col-phone">Number</th>
                <th className="col-date">{viewingDeleted ? 'Deleted At' : 'Upload Date'}</th>
                <th className="col-medium">{viewingDeleted ? 'Deleted By' : 'Duplicate Set'}</th>
                <th className="col-medium">{viewingDeleted ? 'Restore Status' : 'Main Choice'}</th>
                <th className="col-short">Inhand Salary</th>
                <th className="col-short">Relevant Exp</th>
                <th className="col-short">Total Exp</th>
                <th className="col-medium">Recruiter Code</th>
                <th className="col-medium">Location</th>
                <th className="col-medium">Preferred Location</th>
                <th className="col-medium">Qualification</th>
                <th className="col-medium">Process</th>
                <th className="col-medium">Status</th>
                <th className="col-medium">All Details Sent</th>
                <th className="col-xl">{viewingDeleted ? 'Delete Note' : 'Duplicate Reason'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const candidateId = String(row.candidate_id || '');
                const selected = selectedSet.has(candidateId);
                const busy = busyIds.includes(candidateId);
                const isMain = !viewingDeleted && String(row.duplicate_is_main || row.duplicate_recommended_keep || '0') === '1';
                return (
                  <tr key={candidateId} className={viewingDeleted ? 'deleted-profile-row' : (isMain ? 'duplicate-row-main' : '')}>
                    <td className="col-select"><input type="checkbox" checked={selected} onChange={() => toggleOne(candidateId)} /></td>
                    {canDelete ? <td className="col-delete">{viewingDeleted ? <button type="button" className="duplicate-restore-btn" title="Restore this profile" disabled={busy} onClick={() => restoreOne(candidateId)}>Restore</button> : <button type="button" className="duplicate-delete-btn" title="Move this profile to Deleted Profiles" disabled={busy} onClick={() => deleteOne(candidateId)}>🗑</button>}</td> : null}
                    <td className="col-score">
                      <div className="mini-stack">
                        <span className={`status-chip ${scoreTone(row.detail_score)}`}>{row.detail_score || 0}</span>
                        <span className={`status-pill ${isMain ? 'main' : 'extra'}`}>{viewingDeleted ? 'Deleted' : (isMain ? 'Main row' : 'Extra row')}</span>
                      </div>
                    </td>
                    <td className="col-profile">
                      {viewingDeleted ? (
                        <div className="profile-box">
                          <span className="profile-name">{row.full_name || '-'}</span>
                          <span className="profile-sub">Restore first to open profile</span>
                          <span className="profile-sub">Deleted profile</span>
                        </div>
                      ) : (
                        <Link className="profile-link" to={`/candidate/${candidateId}`} target="_blank" rel="noopener noreferrer">
                          <span className="profile-name">{row.full_name || '-'}</span>
                          <span className="profile-sub">Click to open profile</span>
                          <span className="profile-sub">Set #{row.duplicate_group_key || '-'} • Rank {row.duplicate_rank || 1}</span>
                        </Link>
                      )}
                    </td>
                    <td className="col-id">{candidateId || '-'}</td>
                    <td className="col-phone">{row.phone || '-'}</td>
                    <td className="col-date">{formatStamp(viewingDeleted ? row.deleted_at : (row.data_uploading_date || row.updated_at || row.created_at))}</td>
                    <td className="col-medium">
                      {viewingDeleted ? (
                        <div className="mini-stack">
                          <span>{row.deleted_by || '-'}</span>
                          <span className="profile-sub">Recycle bin</span>
                        </div>
                      ) : (
                        <div className="mini-stack">
                          <span>{row.duplicate_group_name || row.full_name || '-'}</span>
                          <span className="profile-sub">{row.duplicate_group_phone || row.phone || '-'}</span>
                          <span className="profile-sub">{row.duplicate_group_size || 1} profiles</span>
                        </div>
                      )}
                    </td>
                    <td className="col-medium">
                      {viewingDeleted ? (
                        <span className="status-pill extra">Can restore</span>
                      ) : canDelete ? (
                        <button type="button" className={`duplicate-main-btn ${isMain ? 'active' : ''}`} disabled={busy} onClick={() => makeMain(candidateId)}>
                          {isMain ? 'Main' : 'Make Main'}
                        </button>
                      ) : <span className={`status-pill ${isMain ? 'main' : 'extra'}`}>{isMain ? 'Main' : 'Extra'}</span>}
                    </td>
                    <td className="col-short">{row.in_hand_salary || '-'}</td>
                    <td className="col-short">{row.relevant_experience || '-'}</td>
                    <td className="col-short">{row.total_experience || row.experience || '-'}</td>
                    <td className="col-medium">{row.recruiter_code || '-'}</td>
                    <td className="col-medium">{row.location || '-'}</td>
                    <td className="col-medium">{row.preferred_location || '-'}</td>
                    <td className="col-medium">{row.qualification || row.qualification_level || '-'}</td>
                    <td className="col-medium">{row.process || '-'}</td>
                    <td className="col-medium">{row.status || '-'}</td>
                    <td className="col-medium"><span className={`status-pill ${yes(row.all_details_sent) ? 'main' : 'extra'}`}>{row.all_details_sent || '-'}</span></td>
                    <td className="col-xl">{row.duplicate_reason || row.data_notes || row.follow_up_note || '-'}</td>
                  </tr>
                );
              })}
              {!loading && !rows.length ? <tr><td className="duplicate-empty" colSpan={canDelete ? 20 : 19}>{viewingDeleted ? 'No deleted profiles found.' : 'No potential duplicate groups found.'}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
