export function parseMetadata(metadata) {
  if (!metadata) return {};
  if (typeof metadata === 'object') return metadata;
  try { return JSON.parse(metadata); } catch { return {}; }
}

function withTaskParam(path, taskId) {
  if (!taskId) return path;
  const joiner = String(path || '').includes('?') ? '&' : '?';
  return `${path}${joiner}task_id=${encodeURIComponent(taskId)}`;
}

export function notificationTarget(notification) {
  const meta = parseMetadata(notification?.metadata);
  if (meta.task_id && meta.open_path) return withTaskParam(meta.open_path, meta.task_id);
  if (meta.task_id) return `/tasks?task_id=${encodeURIComponent(meta.task_id)}`;
  if (meta.open_path) return meta.open_path;
  if (meta.candidate_id) return `/candidate/${meta.candidate_id}`;
  if (meta.thread_key) return `/chat?thread=${encodeURIComponent(meta.thread_key)}`;
  if (meta.interview_id) return '/interviews';
  if (meta.submission_id || meta.section === 'submissions') return '/submissions';
  const category = String(notification?.category || '').toLowerCase();
  if (category === 'task') return '/tasks';
  if (category === 'chat') return meta.thread_key ? `/chat?thread=${encodeURIComponent(meta.thread_key)}` : '/chat';
  if (category === 'interview') return '/interviews';
  if (category === 'submission' || category === 'approval') return '/submissions';
  return '/notifications';
}
