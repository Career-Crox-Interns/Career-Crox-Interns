const secureLink = require('../controllers/secureLinkController');
const express = require('express');
const { requireAuth, requireLeadership, requireStrongAuth, requireExportAccess } = require('../middleware/auth');
const auth = require('../controllers/authController');
const ui = require('../controllers/uiController');
const candidates = require('../controllers/candidateController');
const tasks = require('../controllers/taskController');
const interviews = require('../controllers/interviewController');
const jds = require('../controllers/jdController');
const submissions = require('../controllers/submissionController');
const notifications = require('../controllers/notificationController');
const attendance = require('../controllers/attendanceController');
const reports = require('../controllers/reportController');
const admin = require('../controllers/adminController');
const chat = require('../controllers/chatController');
const search = require('../controllers/searchController');
const approvals = require('../controllers/approvalController');
const ops = require('../controllers/opsController');
const client = require('../controllers/clientController');
const mail = require('../controllers/mailController');
const revenueHub = require('../controllers/revenueHubController');
const learning = require('../controllers/learningController');
const aaria = require('../controllers/aariaController');
const semiHourly = require('../controllers/semiHourlyController');
const bdaHead = require('../controllers/bdaHeadController');
const goalPost = require('../controllers/goalPostController');
const timingInsights = require('../controllers/timingInsightsController');
const sync = require('../controllers/syncController');
const mobileDialer = require('../controllers/mobileDialerController');
const mobileCrm = require('../controllers/mobileCrmController');
const flowchart = require('../controllers/flowchartController');
const masterReport = require('../controllers/masterReportController');
const extractor = require('../controllers/extractorController');
const basicAdmin = require('../controllers/basicAdminController');
const { mode } = require('../lib/store');
const approvalLive = require('../lib/approvalLive');

const router = express.Router();
const BASIC_CRM_MODE = String(process.env.BASIC_CRM_MODE || 'true').toLowerCase() !== 'false';
function requireBasicAdminControl(req, res, next) {
  const role = String(req.user?.role || req.user?.designation || '').trim().toLowerCase();
  if (!['admin', 'manager'].includes(role)) return res.status(403).json({ message: 'Admin/Manager access required.' });
  return next();
}


// CC26_763: event-driven reminder invalidation. No timer and no Supabase polling.
// A successful reminder-relevant write emits one tiny signal over the already-open
// approval SSE connection. Manager gets all; TL gets only own team; recruiter gets self.
function reminderWriteIsRelevant(req) {
  const path = String(req.path || req.originalUrl || '').toLowerCase();
  if (/^\/(tasks|interviews|followups|submissions|approvals)(?:\/|$)/.test(path)) return true;
  if (!/^\/candidates(?:\/|$)/.test(path)) return false;
  if (/(\/submit|\/delete|\/restore|remove-interview-date|\/revive)(?:\/|$)/.test(path)) return true;
  if (/\/notes(?:\/|$)/.test(path) || /bulk-reassign|make-main-duplicate|reset-filled-details|\/open(?:\/|$)|\/call(?:\/|$)|whatsapp/.test(path)) return false;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const reminderFields = new Set(['follow_up_at','next_follow_up_at','followup_date','follow_up_date','callback_at','interview_date','interview_reschedule_date','scheduled_at','approval_status','all_details_sent','submission_date','submitted_at','status','due_date','due_at','reminder_at']);
  // CC26_765: candidate profile saves include _changed_fields. Use that delta when available
  // instead of scanning the full form payload, otherwise typing an unrelated field can look
  // reminder-relevant merely because the payload also contains an unchanged status field.
  const changed = Array.isArray(body._changed_fields) ? body._changed_fields.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean) : [];
  if (changed.length) return changed.some((key) => reminderFields.has(key));
  const raw = JSON.stringify(body).toLowerCase();
  return [...reminderFields].some((key) => raw.includes(`"${key}"`));
}
function reminderDirtySignal(req, res, next) {
  const originalJson = res.json.bind(res);
  let published = false;
  res.json = function careerCroxReminderDirtyJson(body) {
    if (!published && res.statusCode < 400 && reminderWriteIsRelevant(req)) {
      published = true;
      try { approvalLive.publishReminderDirty(req.user || {}, { source: req.path || req.originalUrl || '', at: Date.now() }); } catch (_) {}
    }
    return originalJson(body);
  };
  next();
}

function wrapRouteHandler(handler) {
  if (typeof handler !== 'function') return handler;
  return function careerCroxSafeRoute(req, res, next) {
    try {
      const result = handler(req, res, next);
      if (result && typeof result.then === 'function') result.catch(next);
      return result;
    } catch (error) {
      return next(error);
    }
  };
}

function disabledArchiveSection(sectionName) {
  return function disabledSectionHandler(req, res) {
    return res.status(200).json({
      ok: true,
      disabled: true,
      items: [],
      section: sectionName,
      message: `${sectionName} is archived. Backend and Supabase access are disabled.`,
    });
  };
}

for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
  const original = router[method].bind(router);
  router[method] = (path, ...handlers) => original(path, ...handlers.map(wrapRouteHandler));
}
router.get('/health', (req, res) => res.json({ ok: true, mode }));

router.post('/auth/login', auth.login);
router.post('/auth/self-register', auth.selfRegister);
router.post('/auth/password-reset-request', auth.requestPasswordReset);
router.post('/auth/logout', requireAuth, auth.logout);
router.get('/auth/me', requireAuth, auth.me);
router.post('/auth/activity', requireAuth, (req, res) => { if (!req.authDegraded) require('../lib/recentHumanActivity').markRecentHumanActivity(req.user); res.json({ ok: true }); });
router.post('/auth/export-access', requireAuth, requireStrongAuth, auth.exportAccess);
router.post('/theme', requireAuth, auth.theme);

router.get('/sync/state', requireAuth, sync.state);
router.get('/sync/changes', requireAuth, sync.changes);

router.post('/dialer/pair-code', requireAuth, mobileDialer.createPairCode);
router.post('/dialer/start-session', requireAuth, mobileDialer.startSession);
router.post('/dialer/sync-application', requireAuth, mobileDialer.syncApplication);
router.post('/dialer/stop-session', requireAuth, mobileDialer.stopSession);
router.post('/dialer/pause-session', requireAuth, mobileDialer.pauseSession);
router.post('/dialer/resume-session', requireAuth, mobileDialer.resumeSession);
router.post('/dialer/manual-call', requireAuth, mobileDialer.manualCall);
router.post('/dialer/queue-item-toggle', requireAuth, mobileDialer.queueItemToggle);
router.get('/dialer/live-status', requireAuth, mobileDialer.liveStatus);
router.get('/dialer/call-change', requireAuth, mobileDialer.callChangeStatus);
router.get('/dialer/reports', requireAuth, mobileDialer.liveReports);
router.get('/dialer/egress-guard', requireAuth, mobileDialer.egressGuardStatus);
router.post('/dialer/egress-guard', requireAuth, requireLeadership, mobileDialer.updateEgressGuard);
router.get('/dialer/usage-guard', requireAuth, mobileDialer.egressGuardStatus);
router.post('/dialer/usage-guard', requireAuth, requireLeadership, mobileDialer.updateEgressGuard);
router.get('/dialer/fraud-report', requireAuth, requireLeadership, mobileDialer.fraudReport);
router.get('/mobile-app/latest', requireAuth, mobileDialer.latestMobileApp);
router.get('/mobile-crm/config', requireAuth, mobileCrm.mobileCrmConfig);
router.post('/mobile-crm/native-call-start', requireAuth, mobileCrm.nativeCallStart);
router.post('/mobile-crm/native-call-end', requireAuth, mobileCrm.nativeCallEnd);
router.get('/dialer/candidates/:candidateId/call-history', requireAuth, mobileDialer.candidateCallHistory);
router.post('/mobile/pair-device', mobileDialer.pairDevice);
router.post('/mobile/logout-device', mobileDialer.logoutDevice);
router.post('/mobile/logout-all-devices', mobileDialer.logoutAllDevices);
router.get('/mobile/active-session', mobileDialer.activeSession);
router.get('/mobile/queue', mobileDialer.mobileQueue);
router.post('/mobile/queue-item-toggle', mobileDialer.mobileQueueItemToggle);
router.post('/mobile/manual-call', mobileDialer.mobileManualCall);
router.post('/mobile/prepare-call', mobileDialer.prepareCall);
router.post('/mobile/pause-session', mobileDialer.mobilePauseSession);
router.post('/mobile/stop-session', mobileDialer.mobileStopSession);
router.post('/mobile/call-start', mobileDialer.callStart);
router.post('/mobile/call-end', mobileDialer.callEnd);
router.post('/mobile/open-profile-request', mobileDialer.mobileOpenProfileRequest);
router.post('/mobile/recording-uploaded', requireAuth, (req,res)=>res.status(410).json({ok:false,message:'Call recording feature has been removed from Career Crox CRM.'}));
router.post('/mobile/recording-file', requireAuth, (req,res)=>res.status(410).json({ok:false,message:'Call recording uploads are disabled.'}));
router.post('/mobile/candidate-file', requireAuth, (req,res)=>res.status(410).json({ok:false,message:'Candidate file uploads are disabled.'}));
router.post('/mobile/resume-file', requireAuth, (req,res)=>res.status(410).json({ok:false,message:'Candidate file uploads are disabled.'}));
router.post('/mobile/location-ping', mobileDialer.mobileLocationPing);
router.post('/mobile/sync-pending', mobileDialer.syncPending);
router.get('/mobile/chat/messages', mobileDialer.mobileChatList);
router.post('/mobile/chat/send', mobileDialer.mobileChatSend);
router.get('/mobile/notifications', mobileDialer.mobileNotifications);
router.get('/mobile/work-items', mobileDialer.mobileWorkItems);
router.post('/mobile/tasks', mobileDialer.mobileTaskCreate);

router.get('/ui/meta', requireAuth, ui.meta);
router.get('/ui/lookups', requireAuth, ui.lookups);
router.get('/tasks/assignees', requireAuth, tasks.assignees);
router.get('/distance/nearest', requireAuth, ui.distanceNearest);
router.get('/distance/route', requireAuth, ui.distanceRoute);

router.get('/flowchart/team', requireAuth, flowchart.team);
router.post('/flowchart/move-recruiter', requireAuth, requireLeadership, flowchart.moveRecruiter);
router.post('/flowchart/save-team-map', requireAuth, requireLeadership, flowchart.saveTeamMap);

router.get('/dashboard', requireAuth, (req, res) => res.status(410).json({ ok: false, disabled: true, message: 'Dashboard is archived to keep CRM stable.' }));
router.use('/extractor', disabledArchiveSection('Data Extractor'));
router.use('/quality-analyst', disabledArchiveSection('Quality Analyst'));
router.use('/hr/head', disabledArchiveSection('HR Head'));

router.get('/candidates', requireAuth, candidates.list);
router.get('/candidates/next-id', requireAuth, candidates.previewNextCandidateId);
router.post('/candidates/resume-autofill', requireAuth, extractor.parseResumeTransient);
router.get('/hot-leads', requireAuth, candidates.listHotLeads);
router.get('/candidates/duplicate-groups', requireAuth, candidates.listDuplicateReviewGroups);
router.get('/candidates/deleted-profiles', requireAuth, candidates.listDeletedProfiles);
router.get('/candidates/recovery-bucket', requireAuth, candidates.recoveryBucket);
router.get('/candidates/reassign-targets', requireAuth, candidates.reassignTargets);
router.post('/candidates', requireAuth, reminderDirtySignal, candidates.create);
router.post('/candidates/bulk-create', requireAuth, reminderDirtySignal, candidates.bulkCreate);
router.post('/candidates/bulk-update', requireAuth, reminderDirtySignal, candidates.bulkUpdate);
router.post('/candidates/bulk-reassign', requireAuth, reminderDirtySignal, candidates.bulkReassign);
router.post('/candidates/bulk-delete', requireAuth, candidates.bulkDeleteCandidates);
router.post('/candidates/:candidateId/make-main-duplicate', requireAuth, candidates.markDuplicateMain);
router.get('/candidates/:candidateId', requireAuth, candidates.getOne);
router.post('/candidates/:candidateId/open', requireAuth, candidates.logOpen);
router.put('/candidates/:candidateId', requireAuth, reminderDirtySignal, candidates.update);
router.post('/candidates/:candidateId/reset-filled-details', requireAuth, candidates.resetFilledDetails);
router.post('/candidates/:candidateId/files', requireAuth, (req,res)=>res.status(410).json({message:'Candidate Files feature has been removed.'}));
router.get('/candidates/:candidateId/files', requireAuth, (req,res)=>res.json({files:[],feature_removed:true}));
router.get('/candidates/:candidateId/contact-access', requireAuth, candidates.contactAccess);
router.get('/candidates/:candidateId/files/:fileId/download', requireAuth, (req,res)=>res.status(410).json({message:'Candidate Files feature has been removed.'}));
router.post('/candidates/:candidateId/submit', requireAuth, reminderDirtySignal, candidates.submitForApproval);
router.post('/candidates/:candidateId/notes', requireAuth, reminderDirtySignal, candidates.addNote);
router.post('/notes', requireAuth, candidates.addQuickNote);
router.post('/candidates/:candidateId/call', requireAuth, candidates.logCall);
router.get('/candidates/:candidateId/whatsapp', requireAuth, candidates.whatsapp);
router.post('/candidates/:candidateId/whatsapp-log', requireAuth, candidates.whatsappLog);
router.post('/candidates/:candidateId/request-remove-interview-date', requireAuth, candidates.requestInterviewDateRemoval);
router.post('/candidates/:candidateId/remove-interview-date', requireAuth, reminderDirtySignal, candidates.removeInterviewDate);
router.post('/candidates/:candidateId/revive', requireAuth, reminderDirtySignal, candidates.reviveLostLead);
router.post('/candidates/:candidateId/delete', requireAuth, reminderDirtySignal, candidates.deleteCandidate);
router.post('/candidates/:candidateId/restore', requireAuth, reminderDirtySignal, candidates.restoreCandidate);
router.get('/followups/upcoming', requireAuth, candidates.followupUpcoming);
router.get('/followups/reminders/next', requireAuth, candidates.followupNextReminder);
router.post('/followups/action', requireAuth, reminderDirtySignal, candidates.followupAction);

router.get('/tasks', requireAuth, tasks.list);
router.get('/tasks/reminders/next', requireAuth, tasks.nextReminder);
router.get('/tasks/alerts/upcoming', requireAuth, tasks.upcomingDesktopReminders);
router.get('/tasks/alerts/events', requireAuth, tasks.desktopEvents);
router.post('/tasks', requireAuth, reminderDirtySignal, tasks.create);
router.put('/tasks/:taskId', requireAuth, reminderDirtySignal, tasks.update);
router.get('/interviews', requireAuth, interviews.list);
router.post('/interviews/reschedule-next-day', requireAuth, reminderDirtySignal, interviews.rescheduleNextDaySameTime);
router.post('/interviews', requireAuth, reminderDirtySignal, interviews.create);
router.get('/jds', requireAuth, jds.list);
router.post('/jds', requireAuth, jds.create);
router.get('/jds/:jdId', requireAuth, jds.getOne);
router.put('/jds/:jdId', requireAuth, jds.update);
router.post('/jds/:jdId/feedback', requireAuth, jds.feedback);

router.get('/submissions', requireAuth, submissions.list);
router.post('/submissions/:submissionId/reminder', requireAuth, reminderDirtySignal, submissions.updateReminder);
router.post('/submissions/bulk-approve', requireAuth, requireLeadership, reminderDirtySignal, submissions.bulkApprove);

router.get('/notifications', requireAuth, notifications.list);
router.post('/notifications/mark-all-read', requireAuth, notifications.markAllRead);
router.post('/notifications/:notificationId/read', requireAuth, notifications.markRead);

function basicAttendancePayload(req) {
  const now = new Date().toISOString();
  return { ok: true, basic_mode: true, today_stats: { joined_today: true, manual_join_confirmed: '1', joined_at: now, login_at: now, total_work_minutes: '0', total_break_minutes: '0', productive_work_minutes: '0', remaining_work_minutes: '0', day_status: 'Basic CRM' }, presence: { user_id: req.user?.user_id || '', username: req.user?.username || '', locked: '0', is_on_break: '0', break_started_at: '', break_expected_end_at: '', lock_reason: '', lock_message: '', joined_at: now, last_activity_at: now, updated_at: now } };
}
router.get('/attendance', requireAuth, BASIC_CRM_MODE ? ((req,res)=>res.json(basicAttendancePayload(req))) : attendance.getOne);
router.get('/attendance/history', requireAuth, BASIC_CRM_MODE ? ((req,res)=>res.json({items:[],basic_mode:true})) : attendance.history);
router.post('/attendance/join', requireAuth, BASIC_CRM_MODE ? ((req,res)=>res.json(basicAttendancePayload(req))) : attendance.join);
router.post('/attendance/start-break', requireAuth, BASIC_CRM_MODE ? ((req,res)=>res.status(410).json({message:'Break feature is removed in Intern Basic CRM.'})) : attendance.startBreak);
router.post('/attendance/end-break', requireAuth, BASIC_CRM_MODE ? ((req,res)=>res.status(410).json({message:'Break feature is removed in Intern Basic CRM.'})) : attendance.endBreak);
router.post('/attendance/request-unlock', requireAuth, BASIC_CRM_MODE ? ((req,res)=>res.status(410).json({message:'Attendance lock is disabled in Intern Basic CRM.'})) : attendance.requestUnlock);
router.post('/attendance/ping', requireAuth, BASIC_CRM_MODE ? ((req,res)=>res.json(basicAttendancePayload(req))) : attendance.ping);
router.get('/attendance/logout-summary', requireAuth, BASIC_CRM_MODE ? ((req,res)=>res.status(410).json({message:'Attendance logout report is disabled in Intern Basic CRM.'})) : attendance.logoutSummary);
router.post('/attendance/send-report', requireAuth, BASIC_CRM_MODE ? ((req,res)=>res.status(410).json({message:'Attendance report is disabled in Intern Basic CRM.'})) : attendance.sendReport);

router.get('/reports/master', requireAuth, requireLeadership, masterReport.masterReport);
router.get('/reports/reminder-summary', requireAuth, reports.reminderSummary);
router.get('/reports/attendance', requireAuth, requireLeadership, reports.attendanceReports);
router.get('/reports/attendance/export', requireAuth, requireLeadership, reports.exportAttendanceReports);
router.get('/reports/tracking-hub', requireAuth, requireLeadership, reports.trackingHub);
router.get('/reports/tracking-details', requireAuth, requireLeadership, reports.trackingDetails);
router.get('/reports', requireAuth, requireLeadership, reports.list);
router.post('/reports/generate', requireAuth, requireLeadership, reports.generate);
router.post('/reports/generate-hold', requireAuth, requireLeadership, reports.generateHold);
router.get('/reports/semi-hourly', requireAuth, BASIC_CRM_MODE ? ((req,res)=>res.json({saved_report_id:'',summary:null,basic_mode:true,disabled:true})) : semiHourly.overview);
router.post('/reports/semi-hourly/message', requireAuth, semiHourly.sendMessage);
router.get('/reports/timing-insights', requireAuth, requireLeadership, timingInsights.overview);
router.get('/basic/admin/health', requireAuth, requireBasicAdminControl, basicAdmin.health);
router.get('/basic/admin/interns', requireAuth, requireBasicAdminControl, basicAdmin.listInterns);
router.put('/basic/admin/interns/:userId', requireAuth, requireBasicAdminControl, basicAdmin.updateIntern);
router.get('/basic/admin/users', requireAuth, requireBasicAdminControl, basicAdmin.listUsers);
router.put('/basic/admin/users/:userId', requireAuth, requireBasicAdminControl, basicAdmin.updateUser);
router.post('/basic/admin/repair', requireAuth, requireBasicAdminControl, basicAdmin.repair);

router.get('/admin', requireAuth, requireLeadership, admin.dashboard);
// A tiny, in-memory, explicit manual schedule check: does not read admin tables or Supabase.
router.get('/admin/aria-schedule', requireAuth, requireLeadership, (req,res) => { const t=semiHourly.ariaShiftSettings(); return res.json({lock_settings:{aria_report_start_time:t.start,aria_report_end_time:t.end}}); });
router.post('/admin/lock-settings', requireAuth, requireLeadership, admin.updateLockSettings);
router.post('/admin/analyze-candidate-upload', requireAuth, requireLeadership, admin.analyzeCandidateUpload);
router.post('/admin/import-candidates', requireAuth, requireLeadership, admin.importCandidates);
router.post('/admin/import-hot-leads', requireAuth, requireLeadership, admin.importHotLeads);
router.get('/admin/export-candidates', requireAuth, requireLeadership, requireStrongAuth, requireExportAccess('admin/export-candidates'), admin.exportCandidates);
router.get('/admin/export-candidate-data-only', requireAuth, requireLeadership, requireStrongAuth, requireExportAccess('admin/export-candidate-data-only'), admin.exportCandidateDataOnly);
router.get('/admin/export-template', requireAuth, requireLeadership, requireStrongAuth, requireExportAccess('admin/export-template'), admin.exportCandidateTemplate);
router.get('/admin/export-template-updated', requireAuth, requireLeadership, requireStrongAuth, requireExportAccess('admin/export-template-updated'), admin.exportCandidateUpdatedTemplate);
router.get('/admin/export-hot-leads-template', requireAuth, requireLeadership, requireStrongAuth, requireExportAccess('admin/export-hot-leads-template'), admin.exportHotLeadsTemplate);
router.post('/admin/impersonate', requireAuth, requireLeadership, requireStrongAuth, admin.impersonate);
router.post('/admin/stop-impersonation', requireAuth, admin.stopImpersonation);

router.get('/chat', requireAuth, chat.list);
router.get('/chat/stream', requireAuth, chat.stream);
router.post('/chat/groups', requireAuth, chat.createGroup);
router.put('/chat/groups/:groupId', requireAuth, chat.renameGroup);
router.post('/chat/groups/:groupId/members/add', requireAuth, chat.addMembers);
router.post('/chat/groups/:groupId/members/remove', requireAuth, chat.removeMember);
router.post('/chat/groups/:groupId/delete', requireAuth, chat.deleteGroup);
router.post('/chat/messages', requireAuth, chat.sendMessage);
router.put('/chat/messages/:messageId', requireAuth, chat.editMessage);
router.post('/chat/messages/:messageId/delete', requireAuth, chat.deleteMessage);
router.post('/chat/messages/:messageId/review', requireAuth, chat.reviewMessage);

router.get('/aaria', requireAuth, aaria.list);
router.post('/aaria/execute', requireAuth, aaria.execute);

router.get('/search', requireAuth, search.search);
router.get('/approvals/stream', requireAuth, approvals.stream);
router.get('/approvals/attendance-pending', requireAuth, requireLeadership, BASIC_CRM_MODE ? ((req,res)=>res.json({items:[],basic_mode:true})) : approvals.attendancePending);
router.get('/approvals', requireAuth, requireLeadership, approvals.list);
router.post('/approvals/approve', requireAuth, requireLeadership, reminderDirtySignal, approvals.approve);
router.post('/approvals/reject', requireAuth, requireLeadership, reminderDirtySignal, approvals.reject);
router.post('/approvals/approve-all', requireAuth, requireLeadership, reminderDirtySignal, approvals.approveAll);

router.get('/learning/progress', requireAuth, learning.listProgress);
router.get('/learning/hub', requireAuth, learning.hub);

router.get('/mail/overview', requireAuth, mail.overview);
router.post('/mail/templates', requireAuth, mail.saveTemplate);
router.post('/mail/drafts', requireAuth, mail.saveDraft);
router.post('/mail/open', requireAuth, mail.openMail);
router.get('/mail/export', requireAuth, requireLeadership, requireStrongAuth, requireExportAccess('mail/export'), mail.exportLogs);
router.post('/learning/progress', requireAuth, learning.updateProgress);
router.post('/learning/suggest', requireAuth, learning.suggestVideo);
router.post('/learning/playlists', requireAuth, learning.createPlaylist);
router.post('/learning/playlists/:playlistId/videos', requireAuth, learning.addPlaylistVideos);
router.post('/learning/playlists/:playlistId/delete', requireAuth, learning.deletePlaylist);
router.post('/learning/videos/delete', requireAuth, learning.deleteVideos);
router.post('/learning/resources', requireAuth, learning.addResource);
router.get('/learning/resources/:resourceId/download', requireAuth, learning.downloadResource);
router.post('/learning/resources/:resourceId/delete', requireAuth, learning.deleteResource);

router.get('/recent-activity', requireAuth, requireBasicAdminControl, ops.recentActivity);
router.get('/recent-activity/export', requireAuth, requireBasicAdminControl, requireStrongAuth, requireExportAccess('recent-activity/export'), ops.exportRecentActivity);
router.get('/client-pipeline', requireAuth, client.list);
router.post('/client-pipeline', requireAuth, client.create);
router.put('/client-pipeline/:leadId', requireAuth, client.update);
router.post('/client-pipeline/parse-raw', requireAuth, client.parseRaw);
router.post('/client-pipeline/extract-url', requireAuth, client.extractUrl);
router.post('/client-pipeline/import-parsed', requireAuth, client.importParsed);
router.get('/client-pipeline/export', requireAuth, requireLeadership, requireStrongAuth, requireExportAccess('client-pipeline/export'), client.exportCsv);
router.get('/revenue-hub', requireAuth, requireLeadership, revenueHub.list);
router.get('/revenue-hub/candidate-search', requireAuth, requireLeadership, revenueHub.searchCandidates);
router.post('/revenue-hub/target', requireAuth, requireLeadership, revenueHub.updateTarget);
router.post('/revenue-hub/add-candidate', requireAuth, requireLeadership, revenueHub.addCandidate);
router.post('/revenue-hub/:revenueId/status', requireAuth, requireLeadership, revenueHub.updateStatus);
router.delete('/revenue-hub/:revenueId', requireAuth, requireLeadership, revenueHub.deleteEntry);
router.get('/revenue-hub/reminders', requireAuth, revenueHub.reminders);
router.get('/revenue-hub/logout-check', requireAuth, revenueHub.logoutCheck);
router.get('/revenue-hub/export', requireAuth, requireLeadership, requireStrongAuth, requireExportAccess('revenue-hub/export'), revenueHub.exportCsv);
router.get('/performance-centre', requireAuth, requireLeadership, ops.performanceCentre);

router.get('/bda-head', requireAuth, bdaHead.list);
router.get('/bda-head/meta', requireAuth, bdaHead.meta);
router.post('/bda-head', requireAuth, bdaHead.create);
router.put('/bda-head/:leadId', requireAuth, bdaHead.update);
router.get('/bda-head/:leadId/activities', requireAuth, bdaHead.activities);
router.post('/bda-head/:leadId/activities', requireAuth, bdaHead.logActivity);
router.post('/bda-head/parse-raw', requireAuth, bdaHead.parseRaw);
router.post('/bda-head/extract-url', requireAuth, bdaHead.extractUrl);
router.post('/bda-head/import-parsed', requireAuth, bdaHead.importParsed);
router.get('/bda-head/export', requireAuth, requireLeadership, requireStrongAuth, requireExportAccess('bda-head/export'), bdaHead.exportCsv);

router.get('/goal-post', requireAuth, goalPost.list);
router.post('/goal-post', requireAuth, goalPost.save);
router.get('/goal-post/reminders', requireAuth, goalPost.reminders);
router.get('/goal-post/logout-check', requireAuth, goalPost.logoutCheck);

// SecureLink messages are connection metadata only. Screen media uses encrypted WebRTC.
router.post('/securelink/open', requireAuth, secureLink.guard, secureLink.csrf, secureLink.open);
router.post('/securelink/join', requireAuth, secureLink.guard, secureLink.csrf, secureLink.join);
router.get('/securelink/session', requireAuth, secureLink.guard, secureLink.current);
router.post('/securelink/approve', requireAuth, secureLink.guard, secureLink.csrf, secureLink.approve);
router.post('/securelink/signal', requireAuth, secureLink.guard, secureLink.csrf, secureLink.signal);
router.post('/securelink/close', requireAuth, secureLink.guard, secureLink.csrf, secureLink.close);
router.get('/securelink/directory', requireAuth, secureLink.guard, secureLink.directory);
router.post('/securelink/invite', requireAuth, secureLink.guard, secureLink.csrf, secureLink.invite);
router.get('/securelink/inbox', requireAuth, secureLink.guard, secureLink.inbox);
router.get('/securelink/events', requireAuth, secureLink.guard, secureLink.events);
router.post('/securelink/accept-invite', requireAuth, secureLink.guard, secureLink.csrf, secureLink.acceptInvite);
router.post('/securelink/decline-invite', requireAuth, secureLink.guard, secureLink.csrf, secureLink.declineInvite);
router.get('/securelink/invite-status', requireAuth, secureLink.guard, secureLink.inviteStatus);
module.exports = router;
