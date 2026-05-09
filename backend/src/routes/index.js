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
const { mode } = require('../lib/store');

const router = express.Router();

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
router.post('/auth/export-access', requireAuth, requireStrongAuth, auth.exportAccess);
router.post('/theme', requireAuth, auth.theme);

router.get('/sync/state', requireAuth, sync.state);
router.get('/sync/changes', requireAuth, sync.changes);

router.post('/dialer/pair-code', requireAuth, mobileDialer.createPairCode);
router.post('/dialer/start-session', requireAuth, mobileDialer.startSession);
router.post('/dialer/stop-session', requireAuth, mobileDialer.stopSession);
router.post('/dialer/pause-session', requireAuth, mobileDialer.pauseSession);
router.post('/dialer/resume-session', requireAuth, mobileDialer.resumeSession);
router.post('/dialer/manual-call', requireAuth, mobileDialer.manualCall);
router.get('/dialer/live-status', requireAuth, mobileDialer.liveStatus);
router.get('/dialer/reports', requireAuth, mobileDialer.liveReports);
router.get('/dialer/candidates/:candidateId/call-history', requireAuth, mobileDialer.candidateCallHistory);
router.post('/mobile/pair-device', mobileDialer.pairDevice);
router.get('/mobile/active-session', mobileDialer.activeSession);
router.get('/mobile/queue', mobileDialer.mobileQueue);
router.post('/mobile/prepare-call', mobileDialer.prepareCall);
router.post('/mobile/pause-session', mobileDialer.mobilePauseSession);
router.post('/mobile/call-start', mobileDialer.callStart);
router.post('/mobile/call-end', mobileDialer.callEnd);
router.post('/mobile/recording-uploaded', mobileDialer.recordingUploaded);
router.post('/mobile/recording-file', mobileDialer.recordingUploadMiddleware, mobileDialer.uploadRecordingFile);
router.post('/mobile/candidate-file', mobileDialer.recordingUploadMiddleware, mobileDialer.uploadMobileCandidateFile);
router.post('/mobile/resume-file', mobileDialer.recordingUploadMiddleware, mobileDialer.uploadMobileCandidateFile);
router.post('/mobile/sync-pending', mobileDialer.syncPending);
router.get('/mobile/chat/messages', mobileDialer.mobileChatList);
router.post('/mobile/chat/send', mobileDialer.mobileChatSend);
router.get('/mobile/notifications', mobileDialer.mobileNotifications);
router.get('/mobile/work-items', mobileDialer.mobileWorkItems);

router.get('/ui/meta', requireAuth, ui.meta);
router.get('/ui/lookups', requireAuth, ui.lookups);
router.get('/dashboard', requireAuth, (req, res) => res.status(410).json({ ok: false, disabled: true, message: 'Dashboard is archived to keep CRM stable.' }));
router.use('/extractor', disabledArchiveSection('Data Extractor'));
router.use('/quality-analyst', disabledArchiveSection('Quality Analyst'));
router.use('/hr/head', disabledArchiveSection('HR Head'));

router.get('/candidates', requireAuth, candidates.list);
router.get('/hot-leads', requireAuth, candidates.listHotLeads);
router.get('/candidates/duplicate-groups', requireAuth, candidates.listDuplicateReviewGroups);
router.get('/candidates/deleted-profiles', requireAuth, candidates.listDeletedProfiles);
router.get('/candidates/recovery-bucket', requireAuth, candidates.recoveryBucket);
router.get('/candidates/reassign-targets', requireAuth, candidates.reassignTargets);
router.post('/candidates', requireAuth, candidates.create);
router.post('/candidates/bulk-create', requireAuth, candidates.bulkCreate);
router.post('/candidates/bulk-update', requireAuth, candidates.bulkUpdate);
router.post('/candidates/bulk-reassign', requireAuth, candidates.bulkReassign);
router.post('/candidates/bulk-delete', requireAuth, candidates.bulkDeleteCandidates);
router.post('/candidates/:candidateId/make-main-duplicate', requireAuth, candidates.markDuplicateMain);
router.get('/candidates/:candidateId', requireAuth, candidates.getOne);
router.post('/candidates/:candidateId/open', requireAuth, candidates.logOpen);
router.put('/candidates/:candidateId', requireAuth, candidates.update);
router.post('/candidates/:candidateId/files', requireAuth, candidates.uploadCandidateFile);
router.get('/candidates/:candidateId/files', requireAuth, candidates.listFilesForCandidate);
router.get('/candidates/:candidateId/contact-access', requireAuth, candidates.contactAccess);
router.get('/candidates/:candidateId/files/:fileId/download', requireAuth, candidates.downloadCandidateFile);
router.post('/candidates/:candidateId/submit', requireAuth, candidates.submitForApproval);
router.post('/candidates/:candidateId/notes', requireAuth, candidates.addNote);
router.post('/notes', requireAuth, candidates.addQuickNote);
router.post('/candidates/:candidateId/call', requireAuth, candidates.logCall);
router.get('/candidates/:candidateId/whatsapp', requireAuth, candidates.whatsapp);
router.post('/candidates/:candidateId/whatsapp-log', requireAuth, candidates.whatsappLog);
router.post('/candidates/:candidateId/request-remove-interview-date', requireAuth, candidates.requestInterviewDateRemoval);
router.post('/candidates/:candidateId/remove-interview-date', requireAuth, candidates.removeInterviewDate);
router.post('/candidates/:candidateId/revive', requireAuth, candidates.reviveLostLead);
router.post('/candidates/:candidateId/delete', requireAuth, candidates.deleteCandidate);
router.post('/candidates/:candidateId/restore', requireAuth, candidates.restoreCandidate);
router.get('/followups/upcoming', requireAuth, candidates.followupUpcoming);
router.get('/followups/reminders/next', requireAuth, candidates.followupNextReminder);
router.post('/followups/action', requireAuth, candidates.followupAction);

router.get('/tasks', requireAuth, tasks.list);
router.get('/tasks/reminders/next', requireAuth, tasks.nextReminder);
router.post('/tasks', requireAuth, tasks.create);
router.put('/tasks/:taskId', requireAuth, tasks.update);
router.get('/interviews', requireAuth, interviews.list);
router.post('/interviews', requireAuth, interviews.create);
router.get('/jds', requireAuth, jds.list);
router.post('/jds', requireAuth, jds.create);
router.get('/jds/:jdId', requireAuth, jds.getOne);
router.put('/jds/:jdId', requireAuth, jds.update);
router.post('/jds/:jdId/feedback', requireAuth, jds.feedback);

router.get('/submissions', requireAuth, submissions.list);
router.post('/submissions/:submissionId/reminder', requireAuth, submissions.updateReminder);
router.post('/submissions/bulk-approve', requireAuth, requireLeadership, submissions.bulkApprove);

router.get('/notifications', requireAuth, notifications.list);
router.post('/notifications/mark-all-read', requireAuth, notifications.markAllRead);
router.post('/notifications/:notificationId/read', requireAuth, notifications.markRead);

router.get('/attendance', requireAuth, attendance.getOne);
router.post('/attendance/join', requireAuth, attendance.join);
router.post('/attendance/start-break', requireAuth, attendance.startBreak);
router.post('/attendance/end-break', requireAuth, attendance.endBreak);
router.post('/attendance/request-unlock', requireAuth, attendance.requestUnlock);
router.post('/attendance/ping', requireAuth, attendance.ping);
router.get('/attendance/logout-summary', requireAuth, attendance.logoutSummary);
router.post('/attendance/send-report', requireAuth, attendance.sendReport);

router.get('/reports', requireAuth, requireLeadership, reports.list);
router.post('/reports/generate', requireAuth, requireLeadership, reports.generate);
router.post('/reports/generate-hold', requireAuth, requireLeadership, reports.generateHold);
router.get('/reports/semi-hourly', requireAuth, requireLeadership, semiHourly.overview);
router.get('/reports/timing-insights', requireAuth, requireLeadership, timingInsights.overview);
router.get('/admin', requireAuth, requireLeadership, admin.dashboard);
router.post('/admin/lock-settings', requireAuth, requireLeadership, admin.updateLockSettings);
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
router.get('/approvals', requireAuth, requireLeadership, approvals.list);
router.post('/approvals/approve', requireAuth, requireLeadership, approvals.approve);
router.post('/approvals/reject', requireAuth, requireLeadership, approvals.reject);
router.post('/approvals/approve-all', requireAuth, requireLeadership, approvals.approveAll);

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

router.get('/recent-activity', requireAuth, requireLeadership, ops.recentActivity);
router.get('/recent-activity/export', requireAuth, requireLeadership, requireStrongAuth, requireExportAccess('recent-activity/export'), ops.exportRecentActivity);
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

module.exports = router;
