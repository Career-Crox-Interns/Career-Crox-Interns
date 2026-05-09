const { store, table } = require('../lib/store');
const { nowIso, nextId } = require('../lib/helpers');
const { createTimedCache, clearAllCaches } = require('../lib/cache');

const hubCache = createTimedCache(2500);
const MAX_RESOURCE_BYTES = 1.5 * 1024 * 1024;

function lower(value) {
  return String(value || '').trim().toLowerCase();
}

function isManagerLike(user) {
  return ['admin', 'manager'].includes(lower(user?.role));
}

function escapeFilename(value) {
  return String(value || 'file.bin').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'file.bin';
}

function makeThumb(title, from = '7d8cff', to = '57d1ff') {
  const safe = String(title || 'Playlist')
    .slice(0, 72)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#${from}"/>
          <stop offset="100%" stop-color="#${to}"/>
        </linearGradient>
      </defs>
      <rect width="640" height="360" rx="26" fill="url(#g)"/>
      <circle cx="112" cy="104" r="40" fill="rgba(255,255,255,.18)"/>
      <polygon points="102,82 102,126 138,104" fill="#fff"/>
      <text x="34" y="176" font-size="28" font-weight="800" fill="#fff" font-family="Arial, Helvetica, sans-serif">${safe}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function parseYoutubeId(url) {
  const value = String(url || '').trim();
  if (!value) return '';
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{6,})/,
    /youtu\.be\/([a-zA-Z0-9_-]{6,})/,
    /shorts\/([a-zA-Z0-9_-]{6,})/,
    /embed\/([a-zA-Z0-9_-]{6,})/,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

function normalizeVideoLink(url, index = 0) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return null;
  const videoId = parseYoutubeId(trimmed);
  return {
    title: `Playlist Video ${index + 1}`,
    url: trimmed,
    thumbnail_url: videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : makeThumb(`Video ${index + 1}`),
  };
}

function parseLinksInput(value) {
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeVideoLink(item, index)).filter(Boolean);
  }
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => normalizeVideoLink(line, index))
    .filter(Boolean);
}

async function listProgress(req, res) {
  const rows = (await table('learning_progress')).filter((row) => String(row.user_id) === String(req.user.user_id));
  const suggestions = ['admin','manager','tl'].includes(req.user.role)
    ? (await table('suggested_videos')).sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))
    : [];
  return res.json({ items: rows, suggestions });
}

async function updateProgress(req, res) {
  const videoId = String(req.body?.video_id || '').trim();
  if (!videoId) return res.status(400).json({ message: 'video_id required' });
  const row = {
    progress_id: `${req.user.user_id}_${videoId}`,
    user_id: req.user.user_id,
    video_id: videoId,
    section_key: req.body?.section_key || '',
    title: req.body?.title || '',
    url: req.body?.url || '',
    completed: req.body?.completed ? '1' : '0',
    updated_at: nowIso(),
  };
  const item = await store.upsert('learning_progress', 'progress_id', row);
  clearAllCaches();
  return res.json({ item });
}

async function suggestVideo(req, res) {
  const url = String(req.body?.url || '').trim();
  const title = String(req.body?.title || '').trim();
  if (!url || !title) return res.status(400).json({ message: 'Title and URL required' });
  const suggestions = await table('suggested_videos');
  const item = {
    suggestion_id: nextId('LV', suggestions, 'suggestion_id'),
    suggested_by_user_id: req.user.user_id,
    suggested_by_name: req.user.full_name,
    category: req.body?.category || 'general',
    title,
    url,
    status: 'Pending',
    rejection_reason: '',
    created_at: nowIso(),
    approved_at: '',
    approved_by_name: '',
  };
  await store.insert('suggested_videos', item);
  const users = await table('users');
  const notifications = await table('notifications');
  for (const user of users.filter((u) => ['admin', 'manager', 'tl'].includes(String(u.role || '').toLowerCase()))) {
    await store.insert('notifications', {
      notification_id: nextId('N', notifications.concat([]), 'notification_id'),
      user_id: user.user_id,
      title: 'Learning video suggestion',
      message: `${req.user.full_name} suggested a new learning video: ${title}`,
      category: 'learning',
      status: 'Unread',
      metadata: JSON.stringify({ suggestion_id: item.suggestion_id }),
      created_at: nowIso(),
    });
  }
  clearAllCaches();
  return res.json({ item });
}

async function hub(req, res) {
  const cacheKey = `${req.user?.user_id || 'anon'}:${lower(req.user?.role)}:hub`;
  const cached = hubCache.get(cacheKey);
  if (cached) return res.json(cached);
  const [playlists, videos, resources] = await Promise.all([
    table('yt_hub_playlists'),
    table('yt_hub_videos'),
    table('important_resources'),
  ]);
  const playlistItems = playlists
    .filter((item) => String(item.status || 'active').toLowerCase() !== 'deleted')
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')))
    .map((playlist) => ({
      ...playlist,
      hub_type: String(playlist.hub_type || '').trim() || 'learning',
      category_key: String(playlist.category_key || playlist.category || '').trim(),
      content_type: String(playlist.content_type || '').trim() || 'videos',
      auto_update_enabled: String(playlist.auto_update_enabled || '1'),
      auto_daily_count: String(playlist.auto_daily_count || ''),
      videos: videos
        .filter((video) => String(video.playlist_id) === String(playlist.playlist_id) && String(video.status || 'active').toLowerCase() !== 'deleted')
        .sort((a, b) => Number(a.order_index || 0) - Number(b.order_index || 0)),
    }));

  const resourceItems = resources
    .filter((item) => String(item.status || 'active').toLowerCase() !== 'deleted')
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .map((item) => ({
      resource_id: item.resource_id,
      title: item.title,
      description: item.description,
      resource_type: item.resource_type,
      url: item.url,
      original_name: item.original_name,
      mime_type: item.mime_type,
      size_bytes: item.size_bytes,
      created_at: item.created_at,
      created_by_name: item.created_by_name,
    }));

  const payload = {
    playlists: playlistItems,
    resources: resourceItems,
    can_manage_hub: isManagerLike(req.user),
  };
  hubCache.set(cacheKey, payload);
  return res.json(payload);
}

async function createPlaylist(req, res) {
  if (!isManagerLike(req.user)) return res.status(403).json({ message: 'Manager access only' });
  const title = String(req.body?.title || '').trim();
  if (!title) return res.status(400).json({ message: 'Playlist title required' });
  const playlists = await table('yt_hub_playlists');
  const videos = await table('yt_hub_videos');
  const playlistId = nextId('PL', playlists, 'playlist_id');
  const createdAt = nowIso();
  const hubType = String(req.body?.hub_type || req.body?.hub || 'learning').trim() || 'learning';
  const categoryKey = String(req.body?.category_key || req.body?.category || 'convincing-tricks').trim() || 'convincing-tricks';
  const contentType = String(req.body?.content_type || 'videos').trim() || 'videos';
  const item = {
    playlist_id: playlistId,
    title,
    description: String(req.body?.description || '').trim(),
    hub_type: hubType,
    category_key: categoryKey,
    category: categoryKey,
    content_type: contentType,
    auto_update_enabled: String(req.body?.auto_update_enabled ?? '1'),
    auto_daily_count: String(req.body?.auto_daily_count || (contentType === 'shorts' ? '10' : '5')).trim(),
    accent: String(req.body?.accent || 'linear-gradient(135deg,#6ec9ff,#7d8cff)').trim(),
    template_key: String(req.body?.template_key || 'glass-blue').trim(),
    created_by_user_id: req.user.user_id,
    created_by_name: req.user.full_name || req.user.username || '',
    status: 'active',
    created_at: createdAt,
    updated_at: createdAt,
  };
  await store.insert('yt_hub_playlists', item);
  const parsedLinks = parseLinksInput(req.body?.links || req.body?.url_list || []);
  let order = 1;
  for (const video of parsedLinks) {
    await store.insert('yt_hub_videos', {
      video_id: nextId('YV', videos.concat([]), 'video_id'),
      playlist_id: playlistId,
      title: String(video.title || `Playlist Video ${order}`).trim(),
      url: video.url,
      thumbnail_url: video.thumbnail_url,
      order_index: String(order),
      created_by_user_id: req.user.user_id,
      created_by_name: req.user.full_name || req.user.username || '',
      status: 'active',
      created_at: createdAt,
      updated_at: createdAt,
    });
    order += 1;
  }
  clearAllCaches();
  return res.json({ item });
}

async function addPlaylistVideos(req, res) {
  if (!isManagerLike(req.user)) return res.status(403).json({ message: 'Manager access only' });
  const playlistId = String(req.params.playlistId || '').trim();
  const playlist = await store.findById('yt_hub_playlists', 'playlist_id', playlistId);
  if (!playlist) return res.status(404).json({ message: 'Playlist not found' });
  const videos = await table('yt_hub_videos');
  const existing = videos.filter((video) => String(video.playlist_id) === playlistId);
  let order = existing.length + 1;
  const parsedLinks = parseLinksInput(req.body?.links || req.body?.url_list || []);
  if (!parsedLinks.length) return res.status(400).json({ message: 'At least one video link is required' });
  for (const video of parsedLinks) {
    await store.insert('yt_hub_videos', {
      video_id: nextId('YV', videos.concat([]), 'video_id'),
      playlist_id: playlistId,
      title: String(video.title || `Playlist Video ${order}`).trim(),
      url: video.url,
      thumbnail_url: video.thumbnail_url,
      order_index: String(order),
      created_by_user_id: req.user.user_id,
      created_by_name: req.user.full_name || req.user.username || '',
      status: 'active',
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    order += 1;
  }
  await store.update('yt_hub_playlists', 'playlist_id', playlistId, { updated_at: nowIso() });
  clearAllCaches();
  return res.json({ ok: true });
}

async function deletePlaylist(req, res) {
  if (!isManagerLike(req.user)) return res.status(403).json({ message: 'Manager access only' });
  const playlistId = String(req.params.playlistId || '').trim();
  const playlist = await store.findById('yt_hub_playlists', 'playlist_id', playlistId);
  if (!playlist) return res.status(404).json({ message: 'Playlist not found' });
  await store.update('yt_hub_playlists', 'playlist_id', playlistId, { status: 'deleted', updated_at: nowIso() });
  const videos = await table('yt_hub_videos');
  for (const video of videos.filter((item) => String(item.playlist_id) === playlistId)) {
    await store.update('yt_hub_videos', 'video_id', video.video_id, { status: 'deleted', updated_at: nowIso() });
  }
  clearAllCaches();
  return res.json({ ok: true });
}

async function deleteVideos(req, res) {
  if (!isManagerLike(req.user)) return res.status(403).json({ message: 'Manager access only' });
  const ids = Array.isArray(req.body?.video_ids) ? req.body.video_ids.map((item) => String(item)) : [];
  if (!ids.length) return res.status(400).json({ message: 'Select at least one video' });
  for (const id of ids) {
    const existing = await store.findById('yt_hub_videos', 'video_id', id);
    if (!existing) continue;
    await store.update('yt_hub_videos', 'video_id', id, { status: 'deleted', updated_at: nowIso() });
  }
  clearAllCaches();
  return res.json({ ok: true, deleted_count: ids.length });
}

async function addResource(req, res) {
  if (!isManagerLike(req.user)) return res.status(403).json({ message: 'Manager access only' });
  const resourceType = String(req.body?.resource_type || '').trim().toLowerCase();
  const title = String(req.body?.title || '').trim();
  if (!title) return res.status(400).json({ message: 'Title required' });
  const resources = await table('important_resources');
  const createdAt = nowIso();
  const item = {
    resource_id: nextId('IR', resources, 'resource_id'),
    title,
    description: String(req.body?.description || '').trim(),
    resource_type: resourceType || 'link',
    url: String(req.body?.url || '').trim(),
    original_name: '',
    mime_type: '',
    size_bytes: '0',
    content_base64: '',
    created_by_user_id: req.user.user_id,
    created_by_name: req.user.full_name || req.user.username || '',
    status: 'active',
    created_at: createdAt,
    updated_at: createdAt,
  };

  if (item.resource_type !== 'link') {
    const originalName = escapeFilename(req.body?.file_name || 'document.pdf');
    const rawBase64 = String(req.body?.content_base64 || '').replace(/^data:[^;]+;base64,/, '').trim();
    if (!rawBase64) return res.status(400).json({ message: 'File content missing' });
    let buffer = null;
    try {
      buffer = Buffer.from(rawBase64, 'base64');
    } catch {
      return res.status(400).json({ message: 'Invalid file content' });
    }
    if (!buffer?.length) return res.status(400).json({ message: 'File content missing' });
    if (buffer.length > MAX_RESOURCE_BYTES) return res.status(400).json({ message: 'File is too large. Keep it under 1.5 MB.' });
    item.original_name = originalName;
    item.mime_type = String(req.body?.mime_type || 'application/octet-stream');
    item.size_bytes = String(buffer.length);
    item.content_base64 = buffer.toString('base64');
  }

  await store.insert('important_resources', item);
  clearAllCaches();
  return res.json({ item });
}

async function downloadResource(req, res) {
  const resourceId = String(req.params.resourceId || '').trim();
  let item = null;
  if (store.pool) item = await store.one(`select * from public.important_resources where resource_id = $1 limit 1`, [resourceId]);
  else item = (await table('important_resources')).find((row) => String(row.resource_id) === resourceId) || null;
  if (!item || String(item.status || 'active').toLowerCase() === 'deleted') return res.status(404).json({ message: 'Resource not found' });
  if (lower(item.resource_type) === 'link') return res.redirect(item.url);
  const buffer = Buffer.from(String(item.content_base64 || ''), 'base64');
  res.setHeader('Content-Type', item.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${escapeFilename(item.original_name || 'resource.bin')}"`);
  return res.send(buffer);
}

async function deleteResource(req, res) {
  if (!isManagerLike(req.user)) return res.status(403).json({ message: 'Manager access only' });
  const resourceId = String(req.params.resourceId || '').trim();
  const item = await store.findById('important_resources', 'resource_id', resourceId);
  if (!item) return res.status(404).json({ message: 'Resource not found' });
  await store.update('important_resources', 'resource_id', resourceId, { status: 'deleted', updated_at: nowIso() });
  clearAllCaches();
  return res.json({ ok: true });
}

module.exports = {
  listProgress,
  updateProgress,
  suggestVideo,
  hub,
  createPlaylist,
  addPlaylistVideos,
  deletePlaylist,
  deleteVideos,
  addResource,
  downloadResource,
  deleteResource,
};
