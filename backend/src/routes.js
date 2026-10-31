// CC_SPEED_20261029_V1
// API entry point. Existing routes, permissions and write handlers stay in routes/index.js.
const express = require('express');
const existingRoutes = require('./routes/index');
const { requireAuth } = require('./middleware/auth');
const { store, table } = require('./lib/store');
const { freshActivityMap, withFreshActivity, nowIso } = require('./lib/helpers');
const bucketPolicy = require('./lib/bucketPolicy');
const { visibleCandidateForUser } = require('./lib/accessRules');

const router = express.Router();
// Timing appears in the browser Network panel after the real response/commit.
router.use((req,res,next)=>{
 if(!/^\/revenue-hub(?:\/|$)/.test(req.path))return next();
 const started=process.hrtime.bigint(),writeHead=res.writeHead;
 res.writeHead=function(...args){
  if(!this.headersSent)this.setHeader('Server-Timing','crm;dur='+Number(process.hrtime.bigint()-started)/1000000);
  return writeHead.apply(this,args);
 };
 return next();
});

// The existing open endpoint suppresses repeated visits for 90 seconds. A real
// second visit must still move a Fresh profile to the end of this work cycle.
// Only its successful, authenticated response can reach this branch.
router.use((req, res, next) => {
  if (req.method !== 'POST' || !/^\/candidates\/[^/]+\/open\/?$/.test(req.path)) return next();
  const sendJson = res.json.bind(res);
  res.json = function freshOpenResponse(body) {
    if (res.statusCode >= 400 || body?.ok !== true || body?.skipped !== true || !req.user) return sendJson(body);
    return Promise.resolve().then(async () => {
      const id = String(req.params?.candidateId || '');
      const item = id ? await store.findById('candidates', 'candidate_id', id) : null;
      if (!item || bucketPolicy.isDeleted(item) || !bucketPolicy.meta(item).fresh || !visibleCandidateForUser(item, req.user)) return sendJson(body);
      const stamp = nowIso();
      await store.update('candidates', 'candidate_id', id, {
        last_viewed_at: stamp,
        last_viewed_by_name: req.user.full_name || req.user.username || '',
      });
      return sendJson({ ...body, skipped: false, recorded_current_view_at: stamp });
    }).catch(next);
  };
  return next();
});

router.use((req, res, next) => {
  const view = String(req.query?.bucket_view || '').trim().toLowerCase();
  const freshList = req.method === 'GET' && /^\/candidates\/?$/.test(req.path) && ['fresh', 'my_fresh'].includes(view);
  if (!freshList) return existingRoutes(req, res, next);

  // Order the entire filtered result before pagination, not just its first page.
  // Existing controllers still apply their normal ownership/project filters.
  return requireAuth(req, res, () => {
    Promise.resolve().then(async () => {
      req.query.sort_by = 'fresh_rotation';
      req.query._refresh = 'fresh-rotation-v1';
      res.setHeader('Cache-Control', 'private, no-store');
      if (store.pool) return existingRoutes(req, res, next);
      const [calls, manualCalls] = await Promise.all([table('call_logs'), table('manual_dialer_calls')]);
      return withFreshActivity(freshActivityMap(calls, manualCalls), () => existingRoutes(req, res, next));
    }).catch(next);
  });
});

module.exports = router;
