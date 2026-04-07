const { table, store } = require('../lib/store');
const { authCookie, signUser } = require('../middleware/auth');
const { getSettingsMap, setSettingsMap } = require('../lib/settings');
const { nextId, nowIso, normalizeIndianPhone, calcExperienceRange, calcSalaryRange } = require('../lib/helpers');
const { clearAllCaches } = require('../lib/cache');

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function nowLocalDateTime() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function firstValue(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (String(value || '').trim()) return String(value).trim();
  }
  return '';
}

function cleanAmount(value) {
  return String(value || '').replace(/[^\d.]/g, '');
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildWorkbookXml(rows, sheetName = 'CRM Data') {
  const columns = rows.length ? Object.keys(rows[0]) : ['full_name', 'phone', 'location', 'process'];
  const headerRow = `<Row>${columns.map((col) => `<Cell ss:StyleID="sHeader"><Data ss:Type="String">${escapeXml(col)}</Data></Cell>`).join('')}</Row>`;
  const bodyRows = rows.map((row) => `<Row>${columns.map((col) => `<Cell><Data ss:Type="String">${escapeXml(row[col] ?? '')}</Data></Cell>`).join('')}</Row>`).join('');
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Bottom"/><Borders/><Font ss:FontName="Calibri" ss:Size="11"/><Interior/><NumberFormat/><Protection/></Style>
    <Style ss:ID="sHeader"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#2C4A9A" ss:Pattern="Solid"/></Style>
  </Styles>
  <Worksheet ss:Name="${escapeXml(sheetName)}">
    <Table>
      ${headerRow}
      ${bodyRows}
    </Table>
  </Worksheet>
</Workbook>`;
}

function hasMeaningfulCandidateDetails(row) {
  if (!row) return false;
  const keys = ['location','qualification','preferred_location','process','communication_skill','relevant_experience','in_hand_salary','status','all_details_sent','notes'];
  const score = keys.reduce((count, key) => count + (String(row?.[key] || '').trim() ? 1 : 0), 0);
  return score >= 4;
}

function attachDuplicateMeta(item, source, reason, status) {
  const prefix = `[Duplicate Rule] ${reason}`;
  const currentNotes = String(item.data_notes || item.notes || '').trim();
  item.data_notes = currentNotes ? `${prefix} | ${currentNotes}` : prefix;
  item.follow_up_note = String(item.follow_up_note || '').trim() || status;
  item.manager_crm = source?.candidate_id ? `Ref:${source.candidate_id}` : (item.manager_crm || '');
  return item;
}

function sanitizeUser(user) {
  if (!user) return null;
  const safe = { ...user };
  delete safe.password;
  return safe;
}


function canManageTeams(user) {
  const role = lower(user?.role);
  return ['admin', 'manager', 'tl'].includes(role);
}

function sanitizeTeamUser(user) {
  const safe = sanitizeUser(user) || {};
  return {
    user_id: safe.user_id || '',
    username: safe.username || '',
    full_name: safe.full_name || '',
    designation: safe.designation || '',
    role: safe.role || '',
    recruiter_code: safe.recruiter_code || '',
    assigned_tl_user_id: safe.assigned_tl_user_id || '',
    assigned_tl_name: safe.assigned_tl_name || '',
    theme_name: safe.theme_name || '',
  };
}

async function myTeamOverview(req, res) {
  if (!canManageTeams(req.user)) return res.status(403).json({ message: 'Team access only' });
  const role = lower(req.user?.role);
  const users = (await table('users')).map(sanitizeTeamUser);
  const tlUsers = users.filter((u) => ['tl', 'team lead'].includes(lower(u.role)));
  const recruiterUsers = users.filter((u) => lower(u.role) === 'recruiter');

  if (['admin', 'manager'].includes(role)) {
    return res.json({
      role: role,
      scope_user: sanitizeTeamUser(req.user),
      team_owner: null,
      tl_users: tlUsers,
      recruiters: recruiterUsers,
      available_recruiters: recruiterUsers,
      my_team_members: [],
      team_summary: tlUsers.map((tl) => ({
        tl_user_id: tl.user_id,
        tl_name: tl.full_name,
        tl_code: tl.recruiter_code || '',
        members: recruiterUsers.filter((r) => String(r.assigned_tl_user_id || '') == String(tl.user_id || '')),
      })),
    });
  }

  if (role !== 'tl' && role !== 'team lead') {
    return res.status(403).json({ message: 'Only TL or manager can access team setup.' });
  }

  const me = sanitizeTeamUser(users.find((u) => String(u.user_id || '') === String(req.user?.user_id || '')) || req.user);
  const myTeamMembers = recruiterUsers.filter((r) => String(r.assigned_tl_user_id || '') === String(req.user?.user_id || ''));
  const availableRecruiters = recruiterUsers.filter((r) => !String(r.assigned_tl_user_id || '').trim() || String(r.assigned_tl_user_id || '') === String(req.user?.user_id || ''));

  return res.json({
    role: role,
    scope_user: me,
    team_owner: me,
    tl_users: [me],
    recruiters: availableRecruiters,
    available_recruiters: availableRecruiters,
    my_team_members: myTeamMembers,
    team_summary: [{
      tl_user_id: me.user_id,
      tl_name: me.full_name,
      tl_code: me.recruiter_code || '',
      members: myTeamMembers,
    }],
  });
}

async function saveMyTeamAssignments(req, res) {
  if (!canManageTeams(req.user)) return res.status(403).json({ message: 'Team access only' });
  const users = await table('users');
  const role = lower(req.user?.role);

  if (['admin', 'manager'].includes(role)) {
    const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
    const tlMap = new Map(users.filter((u) => ['tl', 'team lead'].includes(lower(u.role))).map((u) => [String(u.user_id), u]));
    const allowedRecruiters = new Set(users.filter((u) => ['recruiter'].includes(lower(u.role))).map((u) => String(u.user_id)));
    for (const row of assignments) {
      const userId = String(row?.user_id || '').trim();
      if (!allowedRecruiters.has(userId)) continue;
      const tlId = String(row?.assigned_tl_user_id || '').trim();
      const tl = tlMap.get(tlId) || null;
      await store.update('users', 'user_id', userId, {
        assigned_tl_user_id: tl ? tl.user_id : '',
        assigned_tl_name: tl ? (tl.full_name || '') : '',
        updated_at: nowIso(),
      });
    }
    clearAllCaches();
    return myTeamOverview(req, res);
  }

  if (role !== 'tl' && role !== 'team lead') return res.status(403).json({ message: 'Only TL or manager can save team setup.' });

  const recruiterIds = new Set((Array.isArray(req.body?.recruiter_user_ids) ? req.body.recruiter_user_ids : []).map((item) => String(item || '').trim()).filter(Boolean));
  const recruiters = users.filter((u) => lower(u.role) === 'recruiter');
  const myId = String(req.user?.user_id || '');
  const me = users.find((u) => String(u.user_id || '') === myId);

  for (const recruiter of recruiters) {
    const recruiterId = String(recruiter.user_id || '');
    const assignedTlId = String(recruiter.assigned_tl_user_id || '');
    const isMine = assignedTlId === myId;
    const isUnassigned = !assignedTlId;
    const selectable = isMine || isUnassigned;
    if (!selectable) continue;

    if (recruiterIds.has(recruiterId)) {
      if (!isMine) {
        await store.update('users', 'user_id', recruiterId, {
          assigned_tl_user_id: myId,
          assigned_tl_name: me?.full_name || req.user?.full_name || '',
          updated_at: nowIso(),
        });
      }
    } else if (isMine) {
      await store.update('users', 'user_id', recruiterId, {
        assigned_tl_user_id: '',
        assigned_tl_name: '',
        updated_at: nowIso(),
      });
    }
  }

  clearAllCaches();
  return myTeamOverview(req, res);
}

async function saveTeamAssignments(req, res) {
  return saveMyTeamAssignments(req, res);
}


function buildImportedCandidate(rows, payload, reqUser, assignedUser) {
  const fullName = firstValue(payload, ['full_name', 'name', 'candidate_name']);
  const phone = normalizeIndianPhone(firstValue(payload, ['phone', 'number', 'mobile', 'contact_number', 'phone_number']));
  const qualification = firstValue(payload, ['qualification', 'qualification_level', 'degree']);
  const location = firstValue(payload, ['location', 'current_location']);
  const preferredLocation = firstValue(payload, ['preferred_location', 'preferred_city', 'preferred_loc']) || location || 'Noida';
  const totalExperience = firstValue(payload, ['total_experience', 'experience', 'experience_months']);
  const relevantExperience = firstValue(payload, ['relevant_experience', 'relevant_experience_months']) || totalExperience;
  const inHandSalary = cleanAmount(firstValue(payload, ['in_hand_salary', 'inhand_salary', 'salary', 'take_home_salary']));
  const ctcMonthly = cleanAmount(firstValue(payload, ['ctc_monthly', 'monthly_ctc'])) || inHandSalary;
  const process = firstValue(payload, ['process', 'jd', 'job_title', 'project']);
  const communicationSkill = firstValue(payload, ['communication_skill', 'communication', 'english', 'communication_level']) || 'Average';
  const status = firstValue(payload, ['status']) || 'In - Progress';
  const notes = firstValue(payload, ['notes', 'note', 'remarks']);
  const interviewDate = firstValue(payload, ['interview_reschedule_date', 'interview_date']);
  const assignedAt = nowIso();

  const recruiterCode = assignedUser?.recruiter_code || firstValue(payload, ['recruiter_code', 'owner_code']) || reqUser?.recruiter_code || '';
  const recruiterName = assignedUser?.full_name || firstValue(payload, ['recruiter_name', 'owner_name']) || reqUser?.full_name || '';
  const recruiterDesignation = assignedUser?.designation || firstValue(payload, ['recruiter_designation']) || reqUser?.designation || '';

  return {
    candidate_id: nextId('C', rows, 'candidate_id'),
    call_connected: firstValue(payload, ['call_connected']) || 'No',
    looking_for_job: firstValue(payload, ['looking_for_job']) || 'Yes',
    full_name: fullName,
    phone,
    qualification,
    location,
    preferred_location: preferredLocation,
    qualification_level: qualification || 'Graduate',
    total_experience: totalExperience,
    relevant_experience: relevantExperience,
    in_hand_salary: inHandSalary,
    ctc_monthly: ctcMonthly,
    career_gap: firstValue(payload, ['career_gap']) || 'Fresher',
    documents_availability: firstValue(payload, ['documents_availability', 'documents']) || 'Yes',
    communication_skill: communicationSkill,
    relevant_experience_range: calcExperienceRange(relevantExperience),
    relevant_in_hand_range: calcSalaryRange(inHandSalary),
    submission_date: firstValue(payload, ['submission_date']) || nowLocalDateTime(),
    process,
    recruiter_code: recruiterCode,
    recruiter_name: recruiterName,
    recruiter_designation: recruiterDesignation,
    status,
    all_details_sent: firstValue(payload, ['all_details_sent']) || 'Pending',
    interview_availability: firstValue(payload, ['interview_availability']) || '',
    interview_reschedule_date: interviewDate,
    virtual_onsite: firstValue(payload, ['virtual_onsite']) || 'Walkin',
    follow_up_at: firstValue(payload, ['follow_up_at']) || '',
    follow_up_note: firstValue(payload, ['follow_up_note']) || '',
    follow_up_status: firstValue(payload, ['follow_up_status']) || 'Open',
    approval_status: firstValue(payload, ['approval_status']) || 'Draft',
    approval_requested_at: '',
    approved_at: '',
    approved_by_name: '',
    is_duplicate: '0',
    notes,
    resume_filename: '',
    recording_filename: '',
    created_at: assignedAt,
    updated_at: assignedAt,
    experience: totalExperience,
    bucket_assigned_at: assignedAt,
  };
}

async function noteCounts() {
  const notes = await table('notes');
  const byUser = {};
  for (const note of notes) {
    const key = note.username || 'unknown';
    byUser[key] ||= { username: key, public_count: 0, private_count: 0 };
    if (String(note.note_type || '').toLowerCase() === 'private') byUser[key].private_count += 1;
    else byUser[key].public_count += 1;
  }
  return Object.values(byUser);
}

async function lockLogs() {
  const activity = (await table('activity_log'))
    .filter((row) => ['crm_locked','crm_unlocked','unlock_requested','break_started','break_ended','join_work'].includes(String(row.action_type || '').toLowerCase()))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, 100);
  const unlocks = (await table('unlock_requests')).sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || ''))).slice(0, 50);
  return { activity, unlocks };
}

async function dashboard(req, res) {
  return res.json({
    users: (await table('users')).map(sanitizeUser),
    notes_count: await noteCounts(),
    lock_settings: await getSettingsMap(),
    lock_logs: await lockLogs(),
    onboarding_requests: (await table('user_onboarding_requests')).slice().sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || ''))).slice(0, 100),
    password_reset_requests: (await table('password_reset_requests')).slice().sort((a, b) => String(b.requested_at || '').localeCompare(String(a.requested_at || ''))).slice(0, 100),
  });
}

async function updateLockSettings(req, res) {
  const next = await setSettingsMap(req.body || {});
  return res.json({ lock_settings: next });
}

async function importCandidates(req, res) {
  const users = await table('users');
  const allRows = await table('candidates');
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  const assigneeUserId = String(req.body?.assignee_user_id || '').trim();
  const replaceRecruiterFromSheet = Boolean(req.body?.replace_recruiter_from_sheet);
  const assignedUser = assigneeUserId ? users.find((user) => String(user.user_id) === assigneeUserId) : null;

  if (!rows.length) return res.status(400).json({ message: 'No rows supplied for import.' });

  const inserted = [];
  const duplicates = [];
  const replaced = [];
  for (const row of rows) {
    const effectiveAssignedUser = replaceRecruiterFromSheet ? assignedUser : null;
    const nextItem = buildImportedCandidate(allRows, row, req.user, effectiveAssignedUser || assignedUser);

    if (!nextItem.full_name || !nextItem.phone) continue;

    if (!replaceRecruiterFromSheet && !assignedUser) {
      const sheetCode = firstValue(row, ['recruiter_code', 'owner_code']);
      const sheetName = firstValue(row, ['recruiter_name', 'owner_name']);
      const sheetUser = users.find((user) => {
        if (sheetCode && lower(user.recruiter_code) === lower(sheetCode)) return true;
        if (sheetName && lower(user.full_name) === lower(sheetName)) return true;
        return false;
      });
      if (sheetUser) {
        nextItem.recruiter_code = sheetUser.recruiter_code || nextItem.recruiter_code;
        nextItem.recruiter_name = sheetUser.full_name || nextItem.recruiter_name;
        nextItem.recruiter_designation = sheetUser.designation || nextItem.recruiter_designation;
      }
    }

    const existing = allRows.find((item) => String(item.phone || '') === String(nextItem.phone || '') && String(item.is_duplicate || '0') !== '1');
    if (existing) {
      if (hasMeaningfulCandidateDetails(existing)) {
        nextItem.is_duplicate = '1';
        attachDuplicateMeta(nextItem, existing, `Kept filled profile ${existing.candidate_id}. New upload moved to Duplicate Profiles.`, 'duplicate_held');
        allRows.push(nextItem);
        duplicates.push(await store.insert('candidates', nextItem));
        continue;
      }

      const archivedOld = { ...existing, is_duplicate: '1', updated_at: nowIso() };
      attachDuplicateMeta(archivedOld, nextItem, `Older incomplete profile replaced by ${nextItem.candidate_id}.`, 'replaced_with_new');
      await store.update('candidates', 'candidate_id', existing.candidate_id, archivedOld);
      const idx = allRows.findIndex((item) => String(item.candidate_id) === String(existing.candidate_id));
      if (idx >= 0) allRows[idx] = archivedOld;

      nextItem.is_duplicate = '0';
      nextItem.source_sr_no = nextItem.source_sr_no || existing.candidate_id;
      allRows.push(nextItem);
      replaced.push(await store.insert('candidates', nextItem));
      continue;
    }

    allRows.push(nextItem);
    inserted.push(await store.insert('candidates', nextItem));
  }

  clearAllCaches();
  return res.json({ inserted_count: inserted.length + duplicates.length + replaced.length, items: [...inserted, ...duplicates, ...replaced].slice(0, 20), summary: { inserted: inserted.length, duplicates: duplicates.length, replaced: replaced.length } });
}


async function exportCandidates(req, res) {
  const rows = (await table('candidates'))
    .slice()
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
  const workbook = buildWorkbookXml(rows, 'Candidate Data');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  res.setHeader('Content-Type', 'application/vnd.ms-excel');
  res.setHeader('Content-Disposition', `attachment; filename="career-crox-candidate-data-${stamp}.xls"`);
  return res.send(workbook);
}

async function exportCandidateTemplate(req, res) {
  const workbook = buildWorkbookXml([
    {
      full_name: '',
      phone: '',
      location: '',
      preferred_location: '',
      qualification: '',
      total_experience: '',
      relevant_experience: '',
      in_hand_salary: '',
      ctc_monthly: '',
      communication_skill: '',
      process: '',
      recruiter_code: '',
      recruiter_name: '',
      status: 'In - Progress',
      notes: '',
      interview_reschedule_date: '',
    },
  ], 'Import Template');
  res.setHeader('Content-Type', 'application/vnd.ms-excel');
  res.setHeader('Content-Disposition', 'attachment; filename="career-crox-import-template.xls"');
  return res.send(workbook);
}

async function impersonate(req, res) {
  const target = (await table('users')).find((u) => u.username === req.body.username);
  if (!target) return res.status(404).json({ message: 'User not found' });
  res.cookie('career_crox_token', signUser(target, req.user.username, req.user.session_token || ''), authCookie());
  return res.json({ user: sanitizeUser(target) });
}

async function stopImpersonation(req, res) {
  if (!req.user.impersonator) return res.status(400).json({ message: 'Not impersonating' });
  const target = (await table('users')).find((u) => u.username === req.user.impersonator);
  if (!target) return res.status(404).json({ message: 'Original user not found' });
  res.cookie('career_crox_token', signUser(target, null, req.user.session_token || ''), authCookie());
  return res.json({ user: sanitizeUser(target) });
}

module.exports = {
  dashboard,
  updateLockSettings,
  myTeamOverview,
  saveMyTeamAssignments,
  saveTeamAssignments,
  importCandidates,
  exportCandidates,
  exportCandidateTemplate,
  impersonate,
  stopImpersonation,
};
