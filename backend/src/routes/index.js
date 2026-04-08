const express = require('express');
const { requireAuth, requireLeadership } = require('../middleware/auth');
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
const extractor = require('../controllers/extractorController');
const { mode } = require('../lib/store');

const router = express.Router();
router.get('/health', (req, res) => res.json({ ok: true, mode }));

router.post('/auth/login', auth.login);
router.post('/auth/self-register', auth.selfRegister);
router.post('/auth/password-reset-request', auth.requestPasswordReset);
router.post('/auth/logout', requireAuth, auth.logout);
router.get('/auth/me', requireAuth, auth.me);
router.post('/theme', requireAuth, auth.theme);

router.get('/ui/meta', requireAuth, ui.meta);
router.get('/ui/lookups', requireAuth, ui.lookups);
router.get('/dashboard', requireAuth, ui.dashboard);

router.get('/candidates', requireAuth, candidates.list);
router.post('/candidates', requireAuth, candidates.create);
router.post('/candidates/bulk-create', requireAuth, candidates.bulkCreate);
router.get('/candidates/:candidateId', requireAuth, candidates.getOne);
router.post('/candidates/:candidateId/open', requireAuth, candidates.logOpen);
router.put('/candidates/:candidateId', requireAuth, candidates.update);
router.post('/candidates/:candidateId/files', requireAuth, candidates.uploadCandidateFile);
router.get('/candidates/:candidateId/files/:fileId/download', requireAuth, candidates.downloadCandidateFile);
router.post('/candidates/:candidateId/submit', requireAuth, candidates.submitForApproval);
router.post('/candidates/:candidateId/notes', requireAuth, candidates.addNote);
router.post('/notes', requireAuth, candidates.addQuickNote);
router.post('/candidates/:candidateId/call', requireAuth, candidates.logCall);
router.get('/candidates/:candidateId/whatsapp', requireAuth, candidates.whatsapp);
router.post('/candidates/:candidateId/whatsapp-log', requireAuth, candidates.whatsappLog);
router.get('/candidates/recovery-bucket', requireAuth, candidates.recoveryBucket);
router.post('/candidates/bulk-update', requireAuth, candidates.bulkUpdate);
router.post('/candidates/:candidateId/request-remove-interview-date', requireAuth, candidates.requestInterviewDateRemoval);
router.post('/candidates/:candidateId/remove-interview-date', requireAuth, candidates.removeInterviewDate);
router.post('/candidates/:candidateId/revive', requireAuth, candidates.reviveLostLead);
router.get('/candidates/reassign-targets', requireAuth, candidates.reassignTargets);
router.post('/candidates/bulk-reassign', requireAuth, candidates.bulkReassign);
router.get('/followups/upcoming', requireAuth, candidates.followupUpcoming);
router.post('/followups/action', requireAuth, candidates.followupAction);

router.get('/tasks', requireAuth, tasks.list);
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
router.get('/reports/semi-hourly', requireAuth, requireLeadership, semiHourly.overview);
router.get('/admin', requireAuth, requireLeadership, admin.dashboard);
router.post('/admin/lock-settings', requireAuth, requireLeadership, admin.updateLockSettings);
router.post('/admin/team-assignments', requireAuth, requireLeadership, admin.saveTeamAssignments);
router.get('/team/my', requireAuth, requireLeadership, admin.myTeamOverview);
router.post('/team/my-assignments', requireAuth, requireLeadership, admin.saveMyTeamAssignments);
router.post('/admin/import-candidates', requireAuth, requireLeadership, admin.importCandidates);
router.get('/admin/export-candidates', requireAuth, requireLeadership, admin.exportCandidates);
router.get('/admin/export-template', requireAuth, requireLeadership, admin.exportCandidateTemplate);
router.post('/admin/impersonate', requireAuth, requireLeadership, admin.impersonate);
router.post('/admin/stop-impersonation', requireAuth, admin.stopImpersonation);

router.get('/chat', requireAuth, chat.list);
router.post('/chat/groups', requireAuth, chat.createGroup);
router.put('/chat/groups/:groupId', requireAuth, chat.renameGroup);
router.post('/chat/groups/:groupId/delete', requireAuth, chat.deleteGroup);
router.post('/chat/messages', requireAuth, chat.sendMessage);
router.put('/chat/messages/:messageId', requireAuth, chat.editMessage);
router.post('/chat/messages/:messageId/delete', requireAuth, chat.deleteMessage);

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
router.get('/mail/export', requireAuth, mail.exportLogs);
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
router.get('/recent-activity/export', requireAuth, requireLeadership, ops.exportRecentActivity);
router.get('/client-pipeline', requireAuth, client.list);
router.post('/client-pipeline', requireAuth, client.create);
router.put('/client-pipeline/:leadId', requireAuth, client.update);
router.post('/client-pipeline/parse-raw', requireAuth, client.parseRaw);
router.post('/client-pipeline/extract-url', requireAuth, client.extractUrl);
router.post('/client-pipeline/import-parsed', requireAuth, client.importParsed);
router.get('/client-pipeline/export', requireAuth, client.exportCsv);
router.get('/revenue-hub', requireAuth, requireLeadership, revenueHub.list);
router.get('/revenue-hub/candidate-search', requireAuth, requireLeadership, revenueHub.searchCandidates);
router.post('/revenue-hub/add-candidate', requireAuth, requireLeadership, revenueHub.addCandidate);
router.post('/revenue-hub/:revenueId/status', requireAuth, requireLeadership, revenueHub.updateStatus);
router.get('/revenue-hub/reminders', requireAuth, revenueHub.reminders);
router.get('/revenue-hub/logout-check', requireAuth, revenueHub.logoutCheck);
router.get('/revenue-hub/export', requireAuth, requireLeadership, revenueHub.exportCsv);
router.get('/performance-centre', requireAuth, requireLeadership, ops.performanceCentre);
router.post('/extractor/parse-files', requireAuth, requireLeadership, extractor.parseFiles);

module.exports = router;
