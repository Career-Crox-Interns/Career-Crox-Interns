const secureLink = require('../controllers/secureLinkController');
const express = require('express');
const {transactionalHandler}=require('../lib/store');
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
const hr = require('../controllers/hrController');
const workspaceTools = require('../controllers/workspaceToolsController');
const backup = require('../controllers/backupController');
const fullExcel = require('../controllers/fullExcelController');
const { mode, store } = require('../lib/store');
const approvalLive = require('../lib/approvalLive');

const router = express.Router();
const multipleCrm = require('../lib/multipleCrm');
router.use((req,res,next)=>Promise.resolve(multipleCrm.modeMiddleware(req,res,next)).catch(next));
// CC831: a direct URL cannot bypass hidden export controls. Sharing local files is a separate user gesture.
router.use((req,res,next)=>{if(/(?:^|\/)(?:export[^/]*|download)(?:\/|$)/i.test(req.path)||/^\/reports\/generate/.test(req.path)){return requireAuth(req,res,()=>{if(!['manager','admin'].includes(String(req.user.role).toLowerCase()))return res.status(403).json({message:'CRM downloads are available only to the manager.'});return next();});}return next();});

// CC26_763: event-driven reminder invalidation. No timer and no Supabase polling.
// A successful reminder-relevant write emits one tiny signal over the already-open
// approval SSE connection. Manager gets all; TL gets only own team; recruiter gets self.
function reminderWriteIsRelevant(req) {
  const path = String(req.path || req.originalUrl || '').toLowerCase();
  if (/^\/(tasks|interviews|followups|submissions|approvals|revenue-hub)(?:\/|$)/.test(path) || path==='/aria/bulk-update') return true;
  if (!/^\/candidates(?:\/|$)/.test(path)) return false;
  if (/(\/submit|\/delete|\/restore|remove-interview-date|\/revive)(?:\/|$)/.test(path)) return true;
  if (/\/notes(?:\/|$)/.test(path)) return true;
  if (/bulk-reassign|reset-filled-details|\/commit(?:\/|$)/.test(path)) return true;
  if (false || /bulk-reassign|make-main-duplicate|reset-filled-details|\/open(?:\/|$)|\/call(?:\/|$)|whatsapp/.test(path)) return false;
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
// Successful writes invalidate only affected read caches.
router.use((req,res,next)=>{
 if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
 const json=res.json.bind(res);res.json=function(body){
  if(res.statusCode<400&&body?.ok!==false&&(req.path!=='/aria/bulk-update'||Number(body?.success_count||0)>0)){
   const path=req.path||'',tags=[];
   if(/^\/(users|flowchart|collaboration)(?:\/|$)|^\/admin\/users(?:\/|$)/.test(path))tags.push('staff','access','candidates','reminders','revenue','reports');
   if((/^\/candidates/.test(path) && !/\/(?:open|call|whatsapp)(?:\/|$)/i.test(path)) || path==='/aria/bulk-update')tags.push('candidates','reminders','revenue','reports');
   if(/^\/(tasks|interviews|followups|submissions|approvals)/.test(path))tags.push('reminders','reports');
   if(/^\/revenue-hub/.test(path))tags.push('revenue','reminders','reports');
   if(/^\/attendance\/(join|start-break|end-break|self-unlock)/.test(path))tags.push('attendance','reminders','reports');
   if(tags.length)require('../lib/cache').clearAllCaches(tags);
  }return json(body);
 };next();
});
function reminderDirtySignal(req, res, next) {
  const originalJson = res.json.bind(res);
  let published = false;
  res.json = function careerCroxReminderDirtyJson(body) {
    if (!published && !req.__cc882ReminderPublished && res.statusCode < 400 && body?.ok!==false && (req.path!=='/aria/bulk-update'||Number(body?.success_count||0)>0) && reminderWriteIsRelevant(req)) {
      published = true;
      Promise.resolve().then(async () => {
        const rows = [...(body?.items?.length ? body.items : [body?.item || req.body?.fields || req.body || {}]),...(body?.affected_owners||[])];
        for (let row of rows) {
          let candidateId = row.candidate_id || req.params?.candidateId || req.body?.candidate_id;
          if (!candidateId && req.params?.revenueId) candidateId=(await store.findById('revenue_hub_entries','revenue_id',req.params.revenueId))?.candidate_id;
          if (!candidateId && req.body?.type==='interview_remove') candidateId=(await store.findById('interview_remove_requests','request_id',req.body.id))?.candidate_id;
          if (candidateId && !row.recruiter_code && !row.recruiter_user_id) row=await store.findById('candidates','candidate_id',candidateId) || row;
          approvalLive.publishReminderDirty(row,{source:req.path||req.originalUrl||'',resource_id:candidateId||row.task_id||'',at:Date.now(),meta:{submitted:Boolean(!body?.replayed && !body?.already_submitted && (body?.action==='submit'||/\/submit(?:\/|$)/.test(req.path||''))),submission:body?.submission?{submission_id:body.submission.submission_id,candidate_id:body.submission.candidate_id,submitted_at:body.submission.submitted_at,approval_requested_at:body.submission.approval_requested_at}:undefined}});
        }
      }).catch(error=>console.error('Reminder change signal pending:',error.code||error.message));
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
router.get('/health', (req, res) => {
  const workflow = require('../lib/candidateCommand');
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ ok: true, mode, release: 'CC876', workflow_release:workflow.RELEASE, workflow_version: workflow.WORKFLOW_VERSION });
});

router.post('/auth/login', auth.login);
router.post('/auth/self-register', auth.selfRegister);
router.post('/auth/password-reset-request', auth.requestPasswordReset);
router.post('/auth/logout', requireAuth, auth.logout);
router.get('/auth/me', requireAuth, auth.me);
router.post('/auth/activity', requireAuth, (req, res) => {
  const activityAt=require('../lib/sessionPolicy').activityAt(req);
  if(req.authDegraded || !activityAt || String(req.get('x-career-crox-background')||'')==='1')return res.json({ok:true});
  require('../lib/recentHumanActivity').markRecentHumanActivity(req.user,activityAt);
  req.body={compact:true,has_activity:'1',last_activity_at:new Date(activityAt).toISOString(),last_page:req.body?.last_page || '/candidates'};
  return attendance.ping(req,res);
});
router.post('/auth/export-access', requireAuth, requireStrongAuth, auth.exportAccess);
router.get('/auth/transfer-passcode',requireAuth,requireStrongAuth,auth.transferPasscode);
router.post('/auth/transfer-passcode',requireAuth,requireStrongAuth,auth.transferPasscode);
router.post('/theme', requireAuth, auth.theme);
// CC876 — real XLSX portable structured data. No media or extra Render secrets.
const excelBody = express.raw({type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',limit:'48mb'});
router.get('/data-backup/full-excel/reminder',requireAuth,requireStrongAuth,fullExcel.reminder);
router.post('/data-backup/full-excel/remind-later',requireAuth,requireStrongAuth,fullExcel.snooze);
router.post('/data-backup/full-excel/saved',requireAuth,requireStrongAuth,requireExportAccess('data-backup/download'),fullExcel.saved);
router.post('/data-backup/full-excel/download',requireAuth,requireStrongAuth,requireExportAccess('data-backup/download'),fullExcel.download);
router.post('/data-backup/full-excel/preview',requireAuth,requireStrongAuth,requireExportAccess('data-backup/restore'),excelBody,fullExcel.preview);
router.post('/data-backup/full-excel/restore',requireAuth,requireStrongAuth,requireExportAccess('data-backup/restore'),excelBody,fullExcel.restore);
router.post('/data-backup/candidate-excel',requireAuth,requireStrongAuth,requireExportAccess('data-backup/download'),backup.candidateExcel);
router.post('/data-backup/restore-candidates',requireAuth,requireStrongAuth,requireExportAccess('data-backup/restore'),backup.restoreCandidates);
router.post('/data-backup/download',requireAuth,requireStrongAuth,(req,res)=>res.status(409).json({code:'USE_FULL_EXCEL',message:'Open Admin > Full CRM Excel to download a complete structured-data backup.'}));

// Bounded, manager-authorized multi-instance recovery. No full-row polling.
const multipleJson=fn=>async(req,res)=>res.json(await fn(req));
router.use('/multiple-crm',(req,res,next)=>{res.setHeader('Cache-Control','private, no-store');next();});
// CC876: retired media-inclusive archive endpoints cannot be used to upload resumes or recordings.
router.use('/multiple-crm',(req,res,next)=>{if(/^\/(?:backup\/jobs|restore\/jobs|refresh\/jobs|assets\/)/.test(req.path))return res.status(410).json({code:'EXCEL_ONLY',message:'File-inclusive archives are retired. Use Manager Admin > Full CRM Excel; resume and recording uploads are prohibited.'});next();});
router.post('/multiple-crm/refresh/jobs/:id/prepare',requireAuth,requireStrongAuth,multipleJson(multipleCrm.prepareRefresh));
router.post('/multiple-crm/backup/jobs/:id/recover',requireAuth,requireStrongAuth,multipleJson(multipleCrm.recoverExport));
router.get('/multiple-crm/assets/:ref',requireAuth,requireStrongAuth,multipleCrm.privateAsset);
router.get('/multiple-crm/status',requireAuth,requireStrongAuth,multipleJson(multipleCrm.getStatus));
router.get('/multiple-crm/preflight',requireAuth,requireStrongAuth,multipleJson(multipleCrm.preflight));
router.post('/multiple-crm/setup',requireAuth,requireStrongAuth,multipleJson(multipleCrm.setup));
router.post('/multiple-crm/grant',requireAuth,requireStrongAuth,multipleJson(req=>multipleCrm.issueGrant(req,req.body?.operation,req.body?.job_id||'')));
router.post('/multiple-crm/backup/jobs',requireAuth,requireStrongAuth,multipleJson(multipleCrm.exportJob));
router.get('/multiple-crm/jobs/:id',requireAuth,requireStrongAuth,multipleJson(multipleCrm.jobStatus));
router.get('/multiple-crm/backup/jobs/:id/stream',requireAuth,requireStrongAuth,multipleCrm.download);
router.post('/multiple-crm/backup/jobs/:id/verify',requireAuth,requireStrongAuth,multipleJson(multipleCrm.verifyDownload));
router.post('/multiple-crm/restore/jobs',requireAuth,requireStrongAuth,multipleJson(multipleCrm.restoreJob));
router.put('/multiple-crm/restore/jobs/:id/chunks',requireAuth,requireStrongAuth,multipleJson(multipleCrm.uploadChunk));
router.post('/multiple-crm/restore/jobs/:id/preview',requireAuth,requireStrongAuth,multipleJson(multipleCrm.previewRestore));
router.post('/multiple-crm/restore/jobs/:id/commit',requireAuth,requireStrongAuth,multipleJson(multipleCrm.commitRestore));
router.post('/multiple-crm/restore/jobs/:id/verify',requireAuth,requireStrongAuth,multipleJson(multipleCrm.verifyRestore));
router.post('/multiple-crm/restore/jobs/:id/recover',requireAuth,requireStrongAuth,multipleJson(multipleCrm.recoverInterrupted));
router.post('/multiple-crm/restore/jobs/:id/rollback',requireAuth,requireStrongAuth,multipleJson(multipleCrm.rollbackRestore));
router.post('/multiple-crm/snooze',requireAuth,requireStrongAuth,multipleJson(multipleCrm.snooze));
router.post('/multiple-crm/mode',requireAuth,requireStrongAuth,multipleJson(multipleCrm.modeChange));

router.get('/data-backup/preflight',requireAuth,requireStrongAuth,backup.preflight);
router.post('/data-backup/restore',requireAuth,requireStrongAuth,(req,res)=>res.status(409).json({code:'USE_FULL_EXCEL',message:'Open Admin > Full CRM Excel, preview your workbook, then restore the snapshot.'}));

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
router.post('/dialer/sync-calls', requireAuth, mobileDialer.requestPhoneRecovery);
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
router.get('/dialer/unknown-calls', requireAuth, mobileDialer.unknownCalls);
router.post('/dialer/unknown-calls/:callId', requireAuth, mobileDialer.classifyUnknown);
router.get('/mobile/unknown-calls', mobileDialer.unknownCalls);
router.post('/mobile/unknown-calls', mobileDialer.classifyUnknown);
router.post('/mobile/logout-all-devices', mobileDialer.logoutAllDevices);
router.get('/mobile/events', mobileDialer.mobileEvents);
router.post('/mobile/command-ack', mobileDialer.commandAck);
router.get('/mobile/calls',mobileDialer.callHistoryPage);
router.get('/dialer/calls',requireAuth,mobileDialer.callHistoryPage);
router.post('/mobile/call-state', mobileDialer.callState);
router.get('/mobile/active-session', mobileDialer.activeSession);
router.get('/mobile/queue', mobileDialer.mobileQueue);
router.post('/mobile/queue-item-toggle', mobileDialer.mobileQueueItemToggle);
router.post('/mobile/manual-call', mobileDialer.mobileManualCall);
router.post('/mobile/prepare-call', mobileDialer.prepareCall);
router.post('/mobile/dial-permit', mobileDialer.dialPermit);
router.post('/mobile/pause-session', mobileDialer.mobilePauseSession);
router.post('/mobile/resume-session', mobileDialer.mobileResumeSession);
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
router.get('/flowchart/collaboration',requireAuth,require('../lib/collaborationAccess').getConfig);
router.post('/flowchart/collaboration',requireAuth,require('../lib/collaborationAccess').saveConfig);
router.post('/flowchart/project-profiles/preview', requireAuth, require('../lib/collaborationAccess').projectProfiles);
router.post('/flowchart/project-profiles/share', requireAuth, require('../lib/collaborationAccess').shareProjectProfiles);
router.get('/ui/form-layout',requireAuth,require('../lib/collaborationAccess').layout);
router.post('/ui/form-layout',requireAuth,require('../lib/collaborationAccess').saveLayout);
router.post('/flowchart/move-recruiter', requireAuth, requireLeadership, flowchart.moveRecruiter);
router.post('/flowchart/save-team-map', requireAuth, requireLeadership, flowchart.saveTeamMap);

router.get('/dashboard/choices',requireAuth,require('../lib/accessRules').dashboardChoices);
router.get('/message-templates/whatsapp',requireAuth,candidates.whatsappTemplates);
router.post('/message-templates/whatsapp',requireAuth,requireStrongAuth,candidates.whatsappTemplates);
router.get('/dashboard', requireAuth, (req, res) => res.status(410).json({ ok: false, disabled: true, message: 'Dashboard is archived to keep CRM stable.' }));
router.post('/extractor/import', requireAuth, workspaceTools.guard, workspaceTools.importCandidates);
router.post('/extractor/parse-files', requireAuth, workspaceTools.guard, extractor.parseFiles);
router.get('/quality-analyst', requireAuth, workspaceTools.guard, mobileDialer.fraudReport);
router.get('/hr/head', requireAuth, workspaceTools.guard, workspaceTools.hrWorkspace);
router.get('/hr/head/history', requireAuth, workspaceTools.guard, workspaceTools.history);
router.post('/hr/head/employees', requireAuth, workspaceTools.guard, workspaceTools.saveEmployee);
router.put('/hr/head/employees/:employeeId', requireAuth, workspaceTools.guard, workspaceTools.saveEmployee);
router.post('/hr/head/generate-document', requireAuth, workspaceTools.guard, hr.generateDocument);

router.get('/candidates', requireAuth, candidates.list);
router.get('/candidates/filter-options', requireAuth, candidates.filterCatalog);
router.get('/candidates/process-options', requireAuth, candidates.listProcessOptions);
router.post('/candidates/process-options', requireAuth, candidates.addProcessOption);
router.get('/candidates/next-id', requireAuth, candidates.previewNextCandidateId);
// CC846: diagnostic endpoint must precede the dynamic :candidateId route.
router.get('/candidates/manager-trace',requireAuth,candidates.managerMissingCandidateTrace);
router.get('/candidates/submit-failures', requireAuth, require('../lib/candidateCommand').listSubmitFailures);
router.post('/candidates/resume-autofill', requireAuth, extractor.parseResumeTransient);
router.get('/hot-leads', requireAuth, candidates.listHotLeads);
router.get('/candidates/duplicate-groups', requireAuth, candidates.listDuplicateReviewGroups);
router.get('/candidates/deleted-profiles', requireAuth, candidates.listDeletedProfiles);
router.get('/candidates/recovery-bucket', requireAuth, candidates.recoveryBucket);
router.get('/candidates/reassign-targets', requireAuth, candidates.reassignTargets);
router.post('/candidates', requireAuth, reminderDirtySignal, candidates.create);
const profileSafety=require('../controllers/profileSafetyController');
router.get('/profile-safety/drafts',requireAuth,profileSafety.drafts);
router.post('/profile-safety/drafts',requireAuth,profileSafety.saveEditDraft);
router.get('/profile-safety/drafts/:draftId',requireAuth,profileSafety.draft);
router.get('/profile-safety/duplicate-phone',requireAuth,profileSafety.duplicate);
router.get('/profile-safety/ownership',requireAuth,profileSafety.ownership);
router.post('/candidates/:candidateId/correct-identity',requireAuth,profileSafety.correct);
router.post('/candidates/bulk-create', requireAuth, reminderDirtySignal, transactionalHandler(candidates.bulkCreate));
router.post('/candidates/bulk-update', requireAuth, reminderDirtySignal, candidates.bulkUpdate);
router.post('/candidates/bulk-reassign', requireAuth, reminderDirtySignal, candidates.bulkReassign);
router.post('/candidates/bulk-delete', requireAuth, candidates.bulkDeleteCandidates);
router.post('/candidates/:candidateId/make-main-duplicate', requireAuth, candidates.markDuplicateMain);
router.get('/candidates/upload-filters',requireAuth,candidates.uploadFilterOptions);
router.get('/candidates/:candidateId/jd-fit', requireAuth, candidates.jdFit);
router.get('/candidates/:candidateId', requireAuth, candidates.getOne);
router.get('/candidates/:candidateId/notes', requireAuth, candidates.listNotesForCandidate);
router.get('/candidates/:candidateId/timeline', requireAuth, candidates.listTimelineForCandidate);
router.post('/candidates/:candidateId/open', requireAuth, candidates.logOpen);
router.post('/candidates/:candidateId/commit', requireAuth, reminderDirtySignal, require('../lib/candidateCommand').commit);
router.post('/candidates/:candidateId/quick-update', requireAuth, reminderDirtySignal, require('../controllers/quickUpdateController').update);
// CC910 ARIA scoped typeahead and independently committed bulk actions.
router.get('/aria/search',requireAuth,require('../controllers/ariaQuickController').search);
router.get('/aria/interviews/:candidateId',requireAuth,require('../controllers/ariaQuickController').interviews);
router.post('/aria/bulk-update',requireAuth,reminderDirtySignal,require('../controllers/ariaQuickController').bulkUpdate);
router.put('/candidates/:candidateId', requireAuth, reminderDirtySignal, candidates.update);
router.post('/candidates/:candidateId/reset-filled-details', requireAuth, candidates.resetFilledDetails);
router.post('/candidates/:candidateId/files', requireAuth, (req,res)=>res.status(410).json({ok:false,message:'Original resume storage is disabled. Use Upload Resume to read and autofill details temporarily.'}));
router.get('/candidates/:candidateId/files', requireAuth, candidates.listFilesForCandidate);
router.get('/candidates/:candidateId/contact-access', requireAuth, candidates.contactAccess);
router.get('/candidates/:candidateId/files/:fileId/download', requireAuth, candidates.downloadCandidateFile);
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
router.get('/jds/shared/:token/file.pdf',jds.sharedPdf);
router.get('/jds', requireAuth, jds.list);
router.post('/jds', requireAuth, jds.create);
router.get('/jds/:jdId', requireAuth, jds.getOne);
router.get('/jds/:jdId/pdf',requireAuth,(req,res,next)=>['admin','manager'].includes(req.user.role)?next():res.status(403).json({message:'Only the manager can download CRM files.'}),jds.pdf);
router.post('/jds/:jdId/pdf/upload',requireAuth,transactionalHandler(jds.uploadPdf));
router.post('/jds/:jdId/share',requireAuth,transactionalHandler(jds.prepareShare));
router.post('/jds/:jdId/pdf/revoke',requireAuth,transactionalHandler(jds.revokePdf));
router.put('/jds/:jdId', requireAuth, jds.update);
router.post('/jds/:jdId/feedback', requireAuth, transactionalHandler(jds.feedback));

router.get('/submissions', requireAuth, submissions.list);
router.post('/submissions/:submissionId/reminder', requireAuth, reminderDirtySignal, submissions.updateReminder);
router.post('/submissions/bulk-approve', requireAuth, requireLeadership, reminderDirtySignal, submissions.bulkApprove);

router.get('/notifications', requireAuth, notifications.list);
router.post('/notifications/mark-all-read', requireAuth, notifications.markAllRead);
router.post('/notifications/:notificationId/read', requireAuth, notifications.markRead);

router.get('/attendance', requireAuth, attendance.getOne);
router.get('/attendance/history', requireAuth, attendance.history);
router.post('/attendance/join', requireAuth, attendance.join);
router.post('/attendance/self-unlock',requireAuth,transactionalHandler(approvals.selfUnlock));
router.get('/attendance/on-break', requireAuth, attendance.onBreak);
router.post('/attendance/start-break', requireAuth, attendance.startBreak);
router.post('/attendance/end-break', requireAuth, attendance.endBreak);
router.post('/attendance/request-unlock', requireAuth, attendance.requestUnlock);
router.post('/attendance/ping', requireAuth, attendance.ping);
router.get('/attendance/logout-summary', requireAuth, attendance.logoutSummary);
router.post('/attendance/send-report', requireAuth, attendance.sendReport);

router.get('/reports/master', requireAuth, requireLeadership, masterReport.masterReport);
router.get('/reports/reminder-summary', requireAuth, reports.reminderSummary);
router.get('/reports/reminder-context', requireAuth, reports.reminderContext);
router.get('/reports/attendance', requireAuth, requireLeadership, reports.attendanceReports);
router.get('/reports/attendance/export', requireAuth, requireLeadership, reports.exportAttendanceReports);
router.get('/reports/tracking-hub', requireAuth, requireLeadership, reports.trackingHub);
router.get('/reports/tracking-details', requireAuth, requireLeadership, reports.trackingDetails);
router.get('/reports', requireAuth, requireLeadership, reports.list);
router.post('/reports/generate', requireAuth, requireLeadership, reports.generate);
router.post('/reports/generate-hold', requireAuth, requireLeadership, reports.generateHold);
router.get('/reports/semi-hourly', requireAuth, semiHourly.overview);
router.post('/reports/semi-hourly/message', requireAuth, semiHourly.sendMessage);
router.get('/reports/timing-insights', requireAuth, requireLeadership, timingInsights.overview);
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

router.get('/chat/inbox',requireAuth,chat.inbox);
router.get('/chat/delta',requireAuth,chat.delta);
router.post('/chat/read',requireAuth,chat.readThread);
router.post('/chat/reset',requireAuth,chat.resetHistory);
router.get('/chat/reset-employees',requireAuth,chat.resetEmployees);
router.get('/chat', requireAuth, chat.list);
router.get('/chat/directory',requireAuth,chat.directory);
router.get('/chat/stream', requireAuth, chat.stream);
router.post('/chat/groups', requireAuth, chat.createGroup);
router.put('/chat/groups/:groupId', requireAuth, chat.renameGroup);
router.post('/chat/groups/:groupId/members/add', requireAuth, chat.addMembers);
router.post('/chat/groups/:groupId/members/remove', requireAuth, chat.removeMember);
router.post('/chat/groups/:groupId/delete', requireAuth, chat.deleteGroup);
router.post('/chat/messages', requireAuth, chat.sendMessage);
router.post('/chat/broadcast',requireAuth,chat.broadcast);
router.put('/chat/messages/:messageId', requireAuth, chat.editMessage);
router.post('/chat/messages/:messageId/delete', requireAuth, chat.deleteMessage);
router.post('/chat/messages/:messageId/review', requireAuth, chat.reviewMessage);

router.get('/aaria', requireAuth, aaria.list);
router.post('/aaria/execute', requireAuth, aaria.execute);

router.get('/search', requireAuth, search.search);
router.get('/approvals/stream', requireAuth, approvals.stream);
router.get('/approvals/submission-review',requireAuth,requireLeadership,approvals.submissionReviewQueue);
router.get('/approvals/attendance-pending', requireAuth, requireLeadership, approvals.attendancePending);
router.get('/approvals', requireAuth, requireLeadership, approvals.list);
router.post('/approvals/approve', requireAuth, requireLeadership, reminderDirtySignal, transactionalHandler(approvals.approve));
router.post('/approvals/reject', requireAuth, requireLeadership, reminderDirtySignal, transactionalHandler(approvals.reject));
router.post('/approvals/approve-all', requireAuth, requireLeadership, reminderDirtySignal, approvals.approveAll);

router.get('/learning/progress', requireAuth, learning.requireHubAccess, learning.listProgress);
router.get('/learning/hub', requireAuth, learning.hub);
router.get('/learning/access',requireAuth,learning.access);
router.post('/learning/access/request',requireAuth,learning.requestAccess);

router.get('/mail/overview', requireAuth, mail.overview);
router.post('/mail/templates', requireAuth, mail.saveTemplate);
router.post('/mail/drafts', requireAuth, mail.saveDraft);
router.post('/mail/open', requireAuth, transactionalHandler(mail.openMail));
router.get('/mail/export', requireAuth, requireLeadership, requireStrongAuth, requireExportAccess('mail/export'), mail.exportLogs);
router.post('/learning/progress', requireAuth, learning.requireHubAccess, learning.updateProgress);
router.post('/learning/suggest', requireAuth, learning.requireHubAccess, learning.suggestVideo);
router.post('/learning/playlists', requireAuth, learning.createPlaylist);
router.post('/learning/playlists/:playlistId/videos', requireAuth, learning.addPlaylistVideos);
router.post('/learning/playlists/:playlistId/delete', requireAuth, learning.deletePlaylist);
router.post('/learning/videos/delete', requireAuth, learning.deleteVideos);
router.post('/learning/resources', requireAuth, learning.addResource);
router.get('/learning/resources/:resourceId/download', requireAuth, learning.requireHubAccess, learning.downloadResource);
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
router.get('/revenue-hub', requireAuth, revenueHub.list);
router.get('/revenue-hub/candidate-search', requireAuth, revenueHub.searchCandidates);
router.get('/revenue-hub/candidate-assets/:candidateId',requireAuth,revenueHub.listRevenueAssets);
router.post('/revenue-hub/candidate-assets/:candidateId',requireAuth,revenueHub.uploadRevenueAsset);
router.get('/revenue-hub/candidate-assets/:candidateId/:fileId',requireAuth,revenueHub.getRevenueAsset);
router.post('/revenue-hub/config', requireAuth, requireLeadership, revenueHub.updateConfig);
router.post('/revenue-hub/target', requireAuth, requireLeadership, revenueHub.updateTarget);
router.post('/revenue-hub/add-candidate', requireAuth, reminderDirtySignal, revenueHub.addCandidate);
router.post('/revenue-hub/:revenueId/status', requireAuth, reminderDirtySignal, revenueHub.updateStatus);
router.delete('/revenue-hub/:revenueId', requireAuth, requireLeadership, reminderDirtySignal, revenueHub.deleteEntry);
router.get('/revenue-hub/reminders', requireAuth, revenueHub.reminders);
router.get('/revenue-hub/logout-check', requireAuth, revenueHub.logoutCheck);
router.post('/revenue-hub/share-opened',requireAuth,revenueHub.shareOpened);
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
