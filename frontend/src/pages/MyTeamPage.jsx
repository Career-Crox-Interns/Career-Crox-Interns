import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

export default function MyTeamPage() {
  const { user } = useAuth();
  const role = lower(user?.role);
  const isManager = ['admin', 'manager'].includes(role);
  const isTl = ['tl', 'team lead'].includes(role);
  const [data, setData] = useState(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedRecruiters, setSelectedRecruiters] = useState({});
  const [managerAssignments, setManagerAssignments] = useState({});

  async function load() {
    try {
      const next = await api.get('/api/team/my', { cacheTtlMs: 0 });
      setData(next);
      const tlSelection = {};
      (next.my_team_members || []).forEach((member) => { tlSelection[member.user_id] = true; });
      setSelectedRecruiters(tlSelection);
      const managerMap = {};
      (next.recruiters || []).forEach((member) => { managerMap[member.user_id] = member.assigned_tl_user_id || ''; });
      setManagerAssignments(managerMap);
    } catch (error) {
      setMessage(error.message || 'Team data could not be loaded.');
    }
  }

  useEffect(() => { load(); }, []);

  const availableRecruiters = useMemo(() => data?.available_recruiters || [], [data]);
  const myTeamMembers = useMemo(() => data?.my_team_members || [], [data]);
  const tlUsers = useMemo(() => data?.tl_users || [], [data]);
  const recruiters = useMemo(() => data?.recruiters || [], [data]);
  const teamSummary = useMemo(() => data?.team_summary || [], [data]);

  function toggleRecruiter(userId) {
    setSelectedRecruiters((prev) => ({ ...prev, [userId]: !prev[userId] }));
  }

  async function saveTlTeam() {
    setSaving(true);
    setMessage('');
    try {
      const recruiter_user_ids = Object.entries(selectedRecruiters).filter(([, value]) => Boolean(value)).map(([key]) => key);
      const next = await api.post('/api/team/my-assignments', { recruiter_user_ids });
      setData(next);
      setMessage('My Team saved. TL now sees only own data and this mapped recruiter list. Civilisation survives another minute.');
    } catch (error) {
      setMessage(error.message || 'Team save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function saveManagerTeams() {
    setSaving(true);
    setMessage('');
    try {
      const assignments = recruiters.map((member) => ({ user_id: member.user_id, assigned_tl_user_id: managerAssignments[member.user_id] || '' }));
      const next = await api.post('/api/team/my-assignments', { assignments });
      setData(next);
      setMessage('Team mapping saved. TL sees only own team, recruiters see only self, manager sees all. As intended.');
    } catch (error) {
      setMessage(error.message || 'Team save failed.');
    } finally {
      setSaving(false);
    }
  }

  if (!isManager && !isTl) {
    return (
      <Layout title="My Team" subtitle="Team access is limited to TL and manager roles.">
        <div className="panel top-gap"><div className="helper-text">Recruiters cannot open team control. They only see their own candidate, task, interview, submission, and follow-up records.</div></div>
      </Layout>
    );
  }

  return (
    <Layout title="My Team" subtitle="Confidential team mapping with strict role-based visibility.">
      {!!message && <div className="panel top-gap-small"><div className="helper-text">{message}</div></div>}

      <div className="panel top-gap my-team-hero-panel">
        <div className="table-toolbar my-team-toolbar-shell">
          <div>
            <div className="table-title">Visibility Rules</div>
            <div className="helper-text">Recruiter sees only own data. TL sees only own data plus own mapped team. Manager sees all teams. Other TL teams remain hidden from each TL.</div>
          </div>
          <div className="my-team-mini-badges">
            <span className="my-team-badge recruiter">Recruiter: Only Self</span>
            <span className="my-team-badge tl">TL: Self + Team</span>
            <span className="my-team-badge manager">Manager: Full View</span>
          </div>
        </div>
      </div>

      {isTl ? (
        <div className="small-grid two top-gap">
          <div className="table-panel my-team-panel vibrant-panel">
            <div className="table-toolbar">
              <div className="table-title">My Team</div>
              <button className="add-profile-btn bounceable my-team-save-btn tl-save" type="button" onClick={saveTlTeam} disabled={saving}>{saving ? 'Saving...' : 'Save My Team'}</button>
            </div>
            <div className="helper-text">Only unassigned recruiters or recruiters already inside your team are shown here. You cannot see or steal another TL's team.</div>
            <div className="crm-table-wrap top-gap-small">
              <table className="crm-table colorful-table my-team-table">
                <thead><tr><th>Select</th><th>Recruiter</th><th>Code</th><th>Status</th></tr></thead>
                <tbody>
                  {availableRecruiters.map((member) => {
                    const active = Boolean(selectedRecruiters[member.user_id]);
                    const alreadyMine = String(member.assigned_tl_user_id || '') === String(data?.scope_user?.user_id || '');
                    return (
                      <tr key={member.user_id}>
                        <td><input className="my-team-checkbox" type="checkbox" checked={active} onChange={() => toggleRecruiter(member.user_id)} /></td>
                        <td>{member.full_name}<br /><span className="subtle">{member.designation || member.role}</span></td>
                        <td>{member.recruiter_code || '-'}</td>
                        <td>{alreadyMine ? 'In My Team' : 'Available'}</td>
                      </tr>
                    );
                  })}
                  {!availableRecruiters.length && <tr><td colSpan="4" className="helper-text">No recruiters available for this TL right now.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="table-panel my-team-panel summary-panel">
            <div className="table-toolbar"><div className="table-title">Current Team Members</div></div>
            <div className="crm-table-wrap top-gap-small">
              <table className="crm-table colorful-table my-team-table">
                <thead><tr><th>Name</th><th>Code</th><th>Role</th></tr></thead>
                <tbody>
                  {myTeamMembers.map((member) => (
                    <tr key={member.user_id}>
                      <td>{member.full_name}</td>
                      <td>{member.recruiter_code || '-'}</td>
                      <td>{member.designation || member.role}</td>
                    </tr>
                  ))}
                  {!myTeamMembers.length && <tr><td colSpan="3" className="helper-text">No recruiters are mapped to this TL yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {isManager ? (
        <div className="small-grid two top-gap">
          <div className="table-panel my-team-panel manager-panel">
            <div className="table-toolbar">
              <div className="table-title">Manager Team Mapping</div>
              <button className="add-profile-btn bounceable my-team-save-btn manager-save" type="button" onClick={saveManagerTeams} disabled={saving}>{saving ? 'Saving...' : 'Save Team Mapping'}</button>
            </div>
            <div className="helper-text">Manager can map any recruiter to any TL. TLs themselves only see their own team roster.</div>
            <div className="crm-table-wrap top-gap-small">
              <table className="crm-table colorful-table my-team-table">
                <thead><tr><th>Recruiter</th><th>Code</th><th>Assigned TL</th></tr></thead>
                <tbody>
                  {recruiters.map((member) => (
                    <tr key={member.user_id}>
                      <td>{member.full_name}</td>
                      <td>{member.recruiter_code || '-'}</td>
                      <td>
                        <select className="my-team-select" value={managerAssignments[member.user_id] || ''} onChange={(e) => setManagerAssignments((prev) => ({ ...prev, [member.user_id]: e.target.value }))}>
                          <option value="">No TL</option>
                          {tlUsers.map((tl) => <option key={tl.user_id} value={tl.user_id}>{tl.full_name}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                  {!recruiters.length && <tr><td colSpan="3" className="helper-text">No recruiters found.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="table-panel my-team-panel summary-panel">
            <div className="table-toolbar"><div className="table-title">Team Summary</div></div>
            <div className="crm-table-wrap top-gap-small">
              <table className="crm-table colorful-table my-team-table">
                <thead><tr><th>TL</th><th>Code</th><th>Recruiters</th></tr></thead>
                <tbody>
                  {teamSummary.map((team) => (
                    <tr key={team.tl_user_id}>
                      <td>{team.tl_name}</td>
                      <td>{team.tl_code || '-'}</td>
                      <td>{(team.members || []).length ? team.members.map((member) => `${member.full_name} (${member.recruiter_code || '-'})`).join(', ') : 'No team members'}</td>
                    </tr>
                  ))}
                  {!teamSummary.length && <tr><td colSpan="3" className="helper-text">No TL summary available.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </Layout>
  );
}
