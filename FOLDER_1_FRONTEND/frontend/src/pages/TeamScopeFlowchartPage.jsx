import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const FALLBACK_USERS = [
  { user_id: 'MGR.ARYANS', username: 'MGR.ARYANS', full_name: 'Aryans Manager', role: 'manager', designation: 'Manager', recruiter_code: 'MGR-001', is_active: '1' },
  { user_id: 'TL.SAKSHI', username: 'TL.SAKSHI', full_name: 'Sakshi Soni', role: 'tl', designation: 'Team Lead', recruiter_code: 'TL-001', is_active: '1' },
  { user_id: 'TL.KHUSHI', username: 'TL.KHUSHI', full_name: 'Khushi Singh', role: 'tl', designation: 'Team Lead', recruiter_code: 'TL-002', is_active: '1' },
  { user_id: 'TL.SRISHTI', username: 'TL.SRISHTI', full_name: 'Srishti Seth', role: 'tl', designation: 'Team Lead', recruiter_code: 'TL-003', is_active: '1' },
  { user_id: 'REC.SAKSHI1', username: 'REC.SAKSHI1', full_name: 'Sakshi Recruiter 1', role: 'recruiter', designation: 'Recruiter', recruiter_code: 'REC-001', is_active: '1' },
  { user_id: 'REC.SAKSHI2', username: 'REC.SAKSHI2', full_name: 'Sakshi Recruiter 2', role: 'recruiter', designation: 'Recruiter', recruiter_code: 'REC-002', is_active: '1' },
  { user_id: 'REC.KHUSHI1', username: 'REC.KHUSHI1', full_name: 'Khushi Recruiter 1', role: 'recruiter', designation: 'Recruiter', recruiter_code: 'REC-003', is_active: '1' },
  { user_id: 'REC.KHUSHI2', username: 'REC.KHUSHI2', full_name: 'Khushi Recruiter 2', role: 'recruiter', designation: 'Recruiter', recruiter_code: 'REC-004', is_active: '1' },
  { user_id: 'REC.SRISHTI1', username: 'REC.SRISHTI1', full_name: 'Srishti Recruiter 1', role: 'recruiter', designation: 'Recruiter', recruiter_code: 'REC-005', is_active: '1' },
  { user_id: 'REC.SRISHTI2', username: 'REC.SRISHTI2', full_name: 'Srishti Recruiter 2', role: 'recruiter', designation: 'Recruiter', recruiter_code: 'REC-006', is_active: '1' },
];

const DEFAULT_ASSIGNMENTS = {
  'REC.SAKSHI1': 'TL.SAKSHI',
  'REC.SAKSHI2': 'TL.SAKSHI',
  'REC.KHUSHI1': 'TL.KHUSHI',
  'REC.KHUSHI2': 'TL.KHUSHI',
  'REC.SRISHTI1': 'TL.SRISHTI',
  'REC.SRISHTI2': 'TL.SRISHTI',
};

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeRole(value, fallback = '') {
  const raw = lower(value || fallback);
  if (!raw) return 'team';
  if (raw === 'admin' || raw.includes('admin')) return 'admin';
  if (raw.includes('manager')) return 'manager';
  if (raw === 'tl' || raw === 'teamlead' || raw === 'team leader' || raw === 'team lead' || raw.includes('team lead') || raw.includes('teamlead')) return 'tl';
  if (raw === 'rec' || raw === 'recruiter' || raw.includes('recruiter')) return 'recruiter';
  return raw;
}

function isActive(row) {
  const value = lower(row?.is_active ?? row?.active ?? '1');
  return !['0', 'false', 'no', 'inactive', 'disabled', 'deleted'].includes(value);
}

function userKey(row) {
  return String(row?.user_key || row?.user_id || row?.id || row?.username || row?.recruiter_code || row?.email || '').trim();
}

function userName(row) {
  return String(row?.display_name || row?.full_name || row?.name || row?.username || row?.user_id || 'Team Member').trim();
}

function userCode(row) {
  return String(row?.display_code || row?.recruiter_code || row?.employee_code || row?.user_id || row?.username || '').trim();
}

function roleFor(row, roleMap = {}) {
  const key = userKey(row);
  const code = userCode(row);
  return normalizeRole(roleMap[key] || roleMap[code] || row?.flowchart_role || row?.effective_role || row?.role, row?.designation || row?.user_role || row?.access_role);
}

function nameCode(row) {
  const name = userName(row);
  const code = userCode(row);
  if (!name && !code) return 'Team Member';
  if (name && code && lower(name) !== lower(code)) return `${name} (${code})`;
  return name || code;
}

function initials(name) {
  return String(name || 'CC')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'CC';
}

function roleLabel(role) {
  if (role === 'admin') return 'Admin';
  if (role === 'manager') return 'Manager';
  if (role === 'tl') return 'Team Lead';
  if (role === 'recruiter') return 'Recruiter';
  return 'Team Member';
}

function starterUsers(users = []) {
  const active = (users || []).filter(isActive);
  const keys = new Set(active.map((row) => userKey(row).toUpperCase()));
  const hasRequestedTlSet = ['TL.SAKSHI', 'TL.KHUSHI', 'TL.SRISHTI'].every((id) => keys.has(id));
  if (hasRequestedTlSet || active.length > 3) return active;
  return FALLBACK_USERS;
}

function splitUsers(users, roleMap = {}) {
  const active = starterUsers(users);
  const managers = [];
  const tls = [];
  const recruiters = [];
  const team = [];
  active.forEach((row) => {
    const role = roleFor(row, roleMap);
    const next = { ...row, effective_role: role, flowchart_role: role };
    if (role === 'admin' || role === 'manager') managers.push(next);
    else if (role === 'tl') tls.push(next);
    else if (role === 'recruiter') recruiters.push(next);
    else team.push(next);
  });
  const sorter = (a, b) => nameCode(a).localeCompare(nameCode(b));
  return { managers: managers.sort(sorter), tls: tls.sort(sorter), recruiters: recruiters.sort(sorter), team: team.sort(sorter), all: [...managers, ...tls, ...recruiters, ...team].sort(sorter) };
}

function assignmentFromMap(recruiter, teamMap, tls) {
  const key = userKey(recruiter);
  const code = userCode(recruiter);
  const mapped = teamMap?.[key] || teamMap?.[code] || null;
  const mappedTlUserId = String(mapped?.tl_user_id || recruiter?.assigned_tl_user_id || recruiter?.tl_user_id || recruiter?.team_lead_user_id || recruiter?.reporting_tl_user_id || DEFAULT_ASSIGNMENTS[key] || '').trim();
  const mappedTlCode = String(mapped?.tl_code || recruiter?.assigned_tl_code || recruiter?.tl_code || recruiter?.team_lead_code || recruiter?.reporting_tl_code || '').trim();
  const mappedTlName = String(mapped?.tl_name || recruiter?.assigned_tl_name || recruiter?.tl_name || recruiter?.team_lead_name || recruiter?.reporting_tl_name || '').trim();
  const match = (tls || []).find((tl) => {
    const tlKey = userKey(tl);
    const tlCode = userCode(tl);
    const tlName = userName(tl);
    return (mappedTlUserId && tlKey && mappedTlUserId === tlKey)
      || (mappedTlCode && tlCode && mappedTlCode.toLowerCase() === tlCode.toLowerCase())
      || (mappedTlName && tlName && mappedTlName.toLowerCase() === tlName.toLowerCase());
  });
  return match ? userKey(match) : '';
}

function buildAssignments(recruiters, tls, teamMap) {
  const result = {};
  (recruiters || []).forEach((row) => {
    result[userKey(row)] = assignmentFromMap(row, teamMap, tls);
  });
  return result;
}

function NodeCard({ row, tone = 'blue', compact = false, draggable = false, onDragStart, children }) {
  const role = normalizeRole(row?.effective_role || row?.flowchart_role || row?.role, row?.designation || row?.role_group);
  const label = nameCode(row);
  return (
    <div
      className={`flow-node flow-node-${tone} ${compact ? 'flow-node-compact' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
      title={label}
    >
      <div className="flow-avatar">{initials(userName(row))}</div>
      <div className="flow-node-copy">
        <div className="flow-node-name">{userName(row)}</div>
        <div className="flow-node-role">{roleLabel(role)}</div>
        <div className="flow-node-code">{userCode(row) || 'CareerCrox'}</div>
        {children}
      </div>
    </div>
  );
}

function EmptyCard({ label }) {
  return <div className="flow-empty-card">{label}</div>;
}

export default function TeamScopeFlowchartPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState(FALLBACK_USERS);
  const [teamMap, setTeamMap] = useState({});
  const [roleMap, setRoleMap] = useState({});
  const [assignments, setAssignments] = useState({});
  const [status, setStatus] = useState('Loading flowchart...');
  const [saving, setSaving] = useState(false);
  const [dragRecruiterKey, setDragRecruiterKey] = useState('');
  const [pendingMove, setPendingMove] = useState(null);
  const [canEdit, setCanEdit] = useState(false);

  async function load() {
    try {
      const data = await api.get('/api/flowchart/team', { cacheTtlMs: 0, allowStale: false, timeoutMs: 16000 });
      const liveUsers = Array.isArray(data?.users) ? data.users : [];
      const sourceUsers = starterUsers(liveUsers.length ? liveUsers : FALLBACK_USERS);
      const map = data?.team_map && typeof data.team_map === 'object' ? data.team_map : {};
      const roles = data?.role_map && typeof data.role_map === 'object' ? data.role_map : {};
      const grouped = splitUsers(sourceUsers, roles);
      setUsers(sourceUsers);
      setTeamMap(map);
      setRoleMap(roles);
      setAssignments(buildAssignments(grouped.recruiters, grouped.tls, map));
      setCanEdit(Boolean(data?.can_edit));
      setStatus('Flowchart loaded: 1 Manager, 3 TL lanes, 2 recruiters under each TL.');
    } catch (error) {
      const sourceUsers = FALLBACK_USERS;
      const grouped = splitUsers(sourceUsers, {});
      setUsers(sourceUsers);
      setTeamMap({});
      setRoleMap({});
      setAssignments(buildAssignments(grouped.recruiters, grouped.tls, {}));
      setCanEdit(['admin', 'manager'].includes(normalizeRole(user?.role, user?.designation)));
      setStatus('Default flowchart visible. Login as Manager to save team mapping.');
    }
  }

  useEffect(() => { load(); }, []);

  const groups = useMemo(() => splitUsers(users, roleMap), [users, roleMap]);
  const recruitersByTl = useMemo(() => {
    const map = Object.fromEntries(groups.tls.map((tl) => [userKey(tl), []]));
    const unassigned = [];
    groups.recruiters.forEach((recruiter) => {
      const tlKey = assignments[userKey(recruiter)] || '';
      if (tlKey && map[tlKey]) map[tlKey].push(recruiter);
      else unassigned.push(recruiter);
    });
    return { map, unassigned };
  }, [groups.tls, groups.recruiters, assignments]);

  const stats = useMemo(() => ({
    total: groups.managers.length + groups.tls.length + groups.recruiters.length,
    managers: groups.managers.length,
    tls: groups.tls.length,
    recruiters: groups.recruiters.length,
    unassigned: recruitersByTl.unassigned.length,
  }), [groups, recruitersByTl.unassigned.length]);

  function memberByKey(key) {
    return groups.all.find((row) => userKey(row) === key) || null;
  }

  function recruiterByKey(key) {
    return groups.recruiters.find((row) => userKey(row) === key) || null;
  }

  function tlByKey(key) {
    return groups.tls.find((row) => userKey(row) === key) || null;
  }

  function dropRecruiter(targetTlKey) {
    if (!dragRecruiterKey || !targetTlKey || !canEdit) return;
    const recruiter = recruiterByKey(dragRecruiterKey);
    const tl = tlByKey(targetTlKey);
    if (!recruiter || !tl) return;
    if ((assignments[dragRecruiterKey] || '') === targetTlKey) return;
    setPendingMove({ recruiter, tl });
  }

  async function saveMove(recruiter, tl) {
    if (!recruiter || !tl) return;
    setSaving(true);
    try {
      const data = await api.post('/api/flowchart/move-recruiter', {
        recruiter_user_id: userKey(recruiter),
        recruiter_code: userCode(recruiter),
        tl_user_id: userKey(tl),
        tl_code: userCode(tl),
      }, { timeoutMs: 18000 });
      const map = data?.team_map && typeof data.team_map === 'object' ? data.team_map : teamMap;
      const roles = data?.role_map && typeof data.role_map === 'object' ? data.role_map : roleMap;
      setTeamMap(map);
      setRoleMap(roles);
      setAssignments((prev) => ({ ...prev, [userKey(recruiter)]: userKey(tl) }));
      setStatus(`${nameCode(recruiter)} moved under ${nameCode(tl)}.`);
    } catch (error) {
      setStatus(error?.message || 'Flowchart move failed.');
    } finally {
      setSaving(false);
      setPendingMove(null);
      setDragRecruiterKey('');
    }
  }

  function changeMemberRole(member, role) {
    const key = userKey(member);
    setRoleMap((prev) => ({ ...prev, [key]: role }));
    if (role === 'tl' || role === 'manager') setAssignments((prev) => ({ ...prev, [key]: '' }));
  }

  function changeMemberTl(member, tlKey) {
    const key = userKey(member);
    setAssignments((prev) => ({ ...prev, [key]: tlKey }));
  }

  async function saveAllRows() {
    setSaving(true);
    try {
      const rows = groups.all
        .filter((member) => !['admin', 'manager'].includes(roleFor(member, roleMap)))
        .map((member) => ({
          user_id: userKey(member),
          user_key: userKey(member),
          recruiter_code: userCode(member),
          role: roleFor(member, roleMap),
          tl_user_id: roleFor(member, roleMap) === 'recruiter' ? (assignments[userKey(member)] || '') : '',
        }));
      const data = await api.post('/api/flowchart/save-team-map', { rows }, { timeoutMs: 18000 });
      const map = data?.team_map && typeof data.team_map === 'object' ? data.team_map : teamMap;
      const roles = data?.role_map && typeof data.role_map === 'object' ? data.role_map : roleMap;
      const grouped = splitUsers(users, roles);
      setTeamMap(map);
      setRoleMap(roles);
      setAssignments(buildAssignments(grouped.recruiters, grouped.tls, map));
      setStatus('Flowchart role/team mapping saved. Data visibility will follow saved hierarchy.');
    } catch (error) {
      setStatus(error?.message || 'Flowchart table save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Layout title="Flowchart" subtitle="">
      <style>{`
        .flow-page{display:flex;flex-direction:column;gap:16px;min-width:0}.flow-hero{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(270px,.85fr);gap:14px}.flow-panel{border:1px solid rgba(89,143,216,.24);border-radius:26px;background:linear-gradient(135deg,#fff,#edf7ff);box-shadow:0 18px 45px rgba(39,91,154,.1);padding:18px;min-width:0}.flow-title{font-size:28px;font-weight:1000;color:#102f55;letter-spacing:-.04em;margin:0 0 8px}.flow-small{font-size:12px;font-weight:900;color:#617693;line-height:1.5}.flow-status{margin-top:12px;display:inline-flex;align-items:center;gap:8px;border-radius:999px;background:#fff;border:1px solid rgba(76,139,220,.22);padding:8px 12px;color:#1f5793;font-size:12px;font-weight:1000}.flow-dot{width:8px;height:8px;border-radius:999px;background:#1ecb73;box-shadow:0 0 0 5px rgba(30,203,115,.14)}.flow-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px}.flow-stat{border-radius:18px;background:#fff;border:1px solid rgba(86,145,220,.2);padding:13px}.flow-stat-value{font-size:25px;font-weight:1000;color:#0f427d;line-height:1}.flow-stat-label{margin-top:6px;color:#6b7f9c;font-size:11px;font-weight:1000;text-transform:uppercase;letter-spacing:.04em}.flow-board{border-radius:28px;background:linear-gradient(180deg,#fff,#f2f8ff);border:1px solid rgba(91,149,220,.22);box-shadow:0 18px 48px rgba(37,89,152,.08);padding:17px;overflow:auto}.flow-board-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.flow-section-title{font-size:18px;font-weight:1000;color:#16375d}.flow-chip{border-radius:999px;background:#eaf4ff;border:1px solid rgba(67,133,220,.22);padding:8px 11px;color:#20588f;font-size:12px;font-weight:1000}.flow-manager-row{display:flex;justify-content:center;gap:12px;flex-wrap:wrap;padding-bottom:14px}.flow-connector{width:2px;height:20px;border-radius:999px;background:linear-gradient(#63a8ff,#9dcaff);margin:0 auto 8px}.flow-tl-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:13px;min-width:760px}.flow-lane{border-radius:24px;border:1px solid rgba(127,96,231,.22);background:linear-gradient(180deg,#fbf8ff,#fff);padding:12px;min-height:210px}.flow-lane-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.flow-lane-name{font-size:14px;font-weight:1000;color:#1a3760;line-height:1.2}.flow-count{border-radius:999px;background:#fff;border:1px solid rgba(107,132,177,.18);padding:5px 8px;font-size:11px;font-weight:1000;color:#587195}.flow-lane-list{display:flex;flex-direction:column;gap:9px}.flow-node{border:1px solid rgba(73,139,220,.24);border-radius:21px;background:linear-gradient(135deg,#fff,#edf6ff);box-shadow:0 12px 26px rgba(32,88,154,.09);padding:12px;display:flex;align-items:center;gap:11px;min-width:0}.flow-node[draggable=true]{cursor:grab}.flow-node-compact{min-height:82px}.flow-node-orange{background:linear-gradient(135deg,#fff7ed,#fff);border-color:rgba(242,146,41,.28)}.flow-node-green{background:linear-gradient(135deg,#effff8,#fff);border-color:rgba(25,181,116,.28)}.flow-avatar{width:44px;height:44px;flex:0 0 44px;border-radius:15px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:1000;background:linear-gradient(135deg,#3478f6,#59c9ff);box-shadow:0 10px 22px rgba(51,121,246,.18)}.flow-node-orange .flow-avatar{background:linear-gradient(135deg,#f28a2e,#ffc15c)}.flow-node-green .flow-avatar{background:linear-gradient(135deg,#17af73,#57ddb0)}.flow-node-copy{min-width:0;display:flex;flex-direction:column;gap:4px}.flow-node-name{font-size:14px;line-height:1.15;font-weight:1000;color:#133457;white-space:normal;overflow-wrap:anywhere}.flow-node-role{font-size:11px;font-weight:1000;color:#547092}.flow-node-code{width:max-content;max-width:100%;border-radius:999px;background:rgba(255,255,255,.8);border:1px solid rgba(83,137,210,.18);padding:4px 7px;font-size:10px;font-weight:1000;color:#285d96;white-space:normal;overflow-wrap:anywhere}.flow-empty-card{border:1px dashed rgba(107,132,177,.45);border-radius:18px;padding:14px;text-align:center;color:#75869d;font-size:12px;font-weight:1000;background:rgba(255,255,255,.68)}.flow-unassigned{margin-top:13px;border-radius:24px;border:1px dashed rgba(242,146,41,.38);background:#fffaf2;padding:12px}.flow-table-wrap{overflow:auto}.flow-table{width:100%;border-collapse:separate;border-spacing:0 9px;min-width:860px}.flow-table th{font-size:11px;color:#6a7f9b;text-transform:uppercase;letter-spacing:.05em;text-align:left;padding:0 12px}.flow-table td{background:#fff;border-top:1px solid rgba(83,145,220,.18);border-bottom:1px solid rgba(83,145,220,.18);padding:12px;font-size:13px;font-weight:900;color:#233d5b}.flow-table td:first-child{border-left:1px solid rgba(83,145,220,.18);border-radius:18px 0 0 18px}.flow-table td:last-child{border-right:1px solid rgba(83,145,220,.18);border-radius:0 18px 18px 0}.flow-select{width:100%;border:1px solid rgba(75,135,215,.28);border-radius:14px;padding:10px;background:#f8fbff;color:#17375d;font-weight:1000}.flow-btn{border:0;border-radius:15px;padding:10px 14px;font-weight:1000;cursor:pointer;background:#eaf2ff;color:#1e5793}.flow-btn.primary{background:linear-gradient(135deg,#2f74f5,#4fc3ff);color:#fff;box-shadow:0 12px 24px rgba(47,116,245,.18)}.flow-btn:disabled{opacity:.55;cursor:not-allowed}.flow-modal-backdrop{position:fixed;inset:0;background:rgba(9,25,48,.34);display:flex;align-items:center;justify-content:center;z-index:60;padding:18px}.flow-modal{width:min(460px,100%);border-radius:26px;background:#fff;border:1px solid rgba(94,143,212,.24);box-shadow:0 28px 80px rgba(0,0,0,.22);padding:20px}.flow-modal-title{font-size:18px;font-weight:1000;color:#112f55;margin-bottom:9px}.flow-modal-text{font-size:13px;font-weight:900;color:#586e8e;line-height:1.55}.flow-modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}@media(max-width:980px){.flow-hero{grid-template-columns:1fr}.flow-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.flow-tl-grid{min-width:680px}}
      `}</style>

      <div className="flow-page">
        <div className="flow-hero">
          <div className="flow-panel">
            <h2 className="flow-title">CareerCrox Team Flowchart</h2>
            <div className="flow-small">Manager stays fixed. TL and Recruiter roles can be updated from the row table. Drag a Recruiter card into any TL lane to update the team structure.</div>
            <div className="flow-status"><span className="flow-dot" />{status}</div>
          </div>
          <div className="flow-panel">
            <div className="flow-stats">
              <div className="flow-stat"><div className="flow-stat-value">{stats.managers}</div><div className="flow-stat-label">Manager</div></div>
              <div className="flow-stat"><div className="flow-stat-value">{stats.tls}</div><div className="flow-stat-label">TL</div></div>
              <div className="flow-stat"><div className="flow-stat-value">{stats.recruiters}</div><div className="flow-stat-label">Recruiter</div></div>
              <div className="flow-stat"><div className="flow-stat-value">{stats.unassigned}</div><div className="flow-stat-label">Unassigned</div></div>
            </div>
          </div>
        </div>

        <div className="flow-board">
          <div className="flow-board-head">
            <div className="flow-section-title">Drag & Drop Hierarchy</div>
            <div className="flow-chip">{canEdit ? 'Manager edit enabled' : 'View only'}</div>
          </div>
          <div className="flow-manager-row">
            {groups.managers.length ? groups.managers.map((manager) => <NodeCard key={userKey(manager)} row={manager} tone="orange" />) : <EmptyCard label="No Manager loaded" />}
          </div>
          <div className="flow-connector" />
          <div className="flow-tl-grid">
            {groups.tls.length ? groups.tls.map((tl) => {
              const key = userKey(tl);
              const list = recruitersByTl.map[key] || [];
              return (
                <div
                  className="flow-lane"
                  key={key}
                  onDragOver={(event) => { if (canEdit) event.preventDefault(); }}
                  onDrop={(event) => { event.preventDefault(); dropRecruiter(key); }}
                >
                  <div className="flow-lane-title">
                    <div className="flow-lane-name">{nameCode(tl)}</div>
                    <div className="flow-count">{list.length} Recruiters</div>
                  </div>
                  <div className="flow-lane-list">
                    {list.length ? list.map((recruiter) => (
                      <NodeCard
                        key={userKey(recruiter)}
                        row={recruiter}
                        tone="green"
                        compact
                        draggable={canEdit}
                        onDragStart={() => setDragRecruiterKey(userKey(recruiter))}
                      />
                    )) : <EmptyCard label="Drop recruiters here" />}
                  </div>
                </div>
              );
            }) : <EmptyCard label="No TL loaded" />}
          </div>
          <div className="flow-unassigned">
            <div className="flow-lane-title"><div className="flow-lane-name">Unassigned Recruiters</div><div className="flow-count">{stats.unassigned}</div></div>
            <div className="flow-lane-list">
              {recruitersByTl.unassigned.length ? recruitersByTl.unassigned.map((recruiter) => (
                <NodeCard
                  key={userKey(recruiter)}
                  row={recruiter}
                  tone="green"
                  compact
                  draggable={canEdit}
                  onDragStart={() => setDragRecruiterKey(userKey(recruiter))}
                />
              )) : <EmptyCard label="No unassigned recruiter" />}
            </div>
          </div>
        </div>

        <div className="flow-board">
          <div className="flow-board-head">
            <div className="flow-section-title">Row Based Role + Team Mapping</div>
            <button className="flow-btn primary" onClick={saveAllRows} disabled={!canEdit || saving}>{'Save Role & Team Mapping'}</button>
          </div>
          <div className="flow-table-wrap">
            <table className="flow-table">
              <thead><tr><th>Member</th><th>Code</th><th>Current Role</th><th>Change Role</th><th>Under TL</th></tr></thead>
              <tbody>
                {groups.all.filter((member) => !['admin', 'manager'].includes(roleFor(member, roleMap))).length ? groups.all.filter((member) => !['admin', 'manager'].includes(roleFor(member, roleMap))).map((member) => {
                  const key = userKey(member);
                  const role = roleFor(member, roleMap);
                  const selectedTl = role === 'recruiter' ? (assignments[key] || '') : '';
                  return (
                    <tr key={key}>
                      <td>{userName(member)}</td>
                      <td>{userCode(member)}</td>
                      <td>{roleLabel(role)}</td>
                      <td>
                        <select className="flow-select" value={role} disabled={!canEdit || saving} onChange={(event) => changeMemberRole(member, event.target.value)}>
                          <option value="tl">TL</option>
                          <option value="recruiter">Recruiter</option>
                        </select>
                      </td>
                      <td>
                        <select className="flow-select" value={selectedTl} disabled={!canEdit || saving || role !== 'recruiter'} onChange={(event) => changeMemberTl(member, event.target.value)}>
                          <option value="">Unassigned</option>
                          {groups.tls.filter((tlRow) => userKey(tlRow) !== key).map((tlRow) => <option key={userKey(tlRow)} value={userKey(tlRow)}>{nameCode(tlRow)}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                }) : <tr><td colSpan="5">No editable TL/recruiter loaded.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {pendingMove ? (
        <div className="flow-modal-backdrop">
          <div className="flow-modal">
            <div className="flow-modal-title">Confirm Recruiter Move</div>
            <div className="flow-modal-text">{nameCode(pendingMove.recruiter)} will move under {nameCode(pendingMove.tl)}. Confirm this team update?</div>
            <div className="flow-modal-actions">
              <button className="flow-btn" onClick={() => setPendingMove(null)} disabled={saving}>Cancel</button>
              <button className="flow-btn primary" onClick={() => saveMove(pendingMove.recruiter, pendingMove.tl)} disabled={saving}>{'Confirm Move'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </Layout>
  );
}
