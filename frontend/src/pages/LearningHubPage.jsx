import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { usePolling } from '../lib/usePolling';
import { getCuratedVideos } from '../lib/learningCatalog';

const PLAYLIST_PRESETS = [
  { key: 'glass-blue', label: 'Glass Blue', accent: 'linear-gradient(135deg,#6ec9ff,#7d8cff)' },
  { key: 'warm-coral', label: 'Warm Coral', accent: 'linear-gradient(135deg,#ffb36b,#ff7b8c)' },
  { key: 'emerald-glow', label: 'Emerald Glow', accent: 'linear-gradient(135deg,#67e8b1,#4ea8ff)' },
  { key: 'violet-premium', label: 'Violet Premium', accent: 'linear-gradient(135deg,#8d7dff,#dd8bff)' },
];

const HUB_GROUPS = [
  { key: 'learning', label: 'Learning Hub', tone: 'blue', help: 'Communication, convincing, recruitment confidence, and daily spoken English.' },
  { key: 'fun', label: 'Fun Hub', tone: 'coral', help: 'Funny videos, stand-up, office humour, and clean break-time content.' },
  { key: 'corporate', label: 'Corporate Hub', tone: 'green', help: 'LinkedIn-ready office content, official page ideas, hiring posts, and brand-safe shorts.' },
];

const HUB_ROWS_BY_HUB = {
  learning: [
    { key: 'convincing-tricks', label: 'Convincing Tricks', tone: 'blue', help: 'Pitch better, handle objections, and convert shaky conversations into progress.' },
    { key: 'dark-psychology', label: 'Dark Psychology', tone: 'violet', help: 'Use ethical influence, urgency, framing, and human triggers without sounding robotic.' },
    { key: 'advanced-english', label: 'Communication in Advanced English', tone: 'green', help: 'Polished office English, smoother replies, sharper interview and recruiter language.' },
    { key: 'phrasers', label: 'Phrasers', tone: 'gold', help: 'Sentence starters, softer replacements, and stronger phrasing for calls and chat.' },
    { key: 'daily-english', label: 'Daily Use English', tone: 'sky', help: 'Practical spoken English for daily office use, follow-ups, and candidate handling.' },
    { key: 'recruitment-mastery', label: 'Recruitment Mastery', tone: 'slate', help: 'Screening, job pitching, follow-up discipline, and recruiter control.' },
  ],
  fun: [
    { key: 'funny-videos', label: 'Funny Videos', tone: 'coral', help: 'Light funny content for quick reset without making the page look chaotic.' },
    { key: 'standup-comedy', label: 'Stand-up Comedy', tone: 'violet', help: 'Shortlisted comedy and clean laugh breaks. Haseeb Khan and similar vibe.' },
    { key: 'office-humor', label: 'Office Humor', tone: 'blue', help: 'Corporate jokes, employee-manager humour, and relatable office clips.' },
    { key: 'clean-break', label: 'Clean Break Time', tone: 'green', help: 'Low-noise fun clips for a short mental reset between tasks.' },
  ],
  corporate: [
    { key: 'linkedin-content', label: 'LinkedIn Official Page', tone: 'green', help: 'Official page ideas, corporate clips, and safer content for posting.' },
    { key: 'hiring-posts', label: 'Hiring & Recruitment Posts', tone: 'blue', help: 'Hiring post references, recruiter branding, and official recruitment content.' },
    { key: 'branding-shorts', label: 'Branding Shorts', tone: 'violet', help: 'Short-format office clips and company culture highlights.' },
    { key: 'copywriting', label: 'Corporate Copy & Captions', tone: 'gold', help: 'Captions, hooks, wording, and sharp copy for office and LinkedIn posts.' },
  ],
};

const FORMAT_META = {
  shorts: { label: 'Shorts', count: 5 },
  videos: { label: 'Videos', count: 5 },
};

const HUB_QUERY_MAP = {
  learning: {
    shorts: [
      'best {label} shorts',
      'quick {label} tricks shorts',
      '{label} reels for recruiters',
      '{label} speaking shorts',
      '{label} daily office shorts',
      '{label} one minute tips',
      '{label} persuasion shorts',
      '{label} communication shorts',
      'shorts on {label}',
      '{label} improvement shorts',
      '{label} confidence shorts',
      '{label} quick learning shorts',
    ],
    videos: [
      'complete {label} guide',
      'best {label} long video',
      '{label} training for recruiters',
      '{label} advanced tutorial',
      '{label} interview communication',
      '{label} office English full video',
      '{label} practical explanation',
      '{label} examples and practice',
    ],
  },
  fun: {
    shorts: [
      '{label} funny shorts',
      'office {label} shorts',
      'clean comedy {label} shorts',
      'haseeb khan style {label} shorts',
      '{label} laugh break shorts',
      '{label} employee manager shorts',
      '{label} meme shorts',
      '{label} quick comedy clips',
      '{label} relatable shorts',
      '{label} break time shorts',
      '{label} daily laugh shorts',
      '{label} clean humor shorts',
    ],
    videos: [
      'Haseeb Khan funny videos',
      'Asif Khan comedy videos',
      '{label} stand up comedy full video',
      '{label} office comedy compilation',
      '{label} clean funny videos',
      '{label} laugh break videos',
      '{label} employee humour videos',
      '{label} work stress funny videos',
    ],
  },
  corporate: {
    shorts: [
      '{label} linkedin shorts',
      '{label} office page shorts',
      '{label} branding shorts',
      '{label} hiring shorts',
      '{label} corporate page ideas shorts',
      '{label} office culture shorts',
      '{label} recruiter branding shorts',
      '{label} official page clip ideas',
      '{label} founder style shorts',
      '{label} bts office shorts',
      '{label} linkedin reel ideas',
      '{label} company page shorts',
    ],
    videos: [
      '{label} linkedin content ideas',
      '{label} office page video ideas',
      '{label} hiring content strategy',
      '{label} recruiter branding videos',
      '{label} official page content tutorial',
      '{label} company culture videos',
      '{label} caption and copywriting videos',
      '{label} corporate social media videos',
    ],
  },
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function escapeSvgText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapThumbText(value = '', lineLength = 24, maxLines = 3) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > lineLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length >= maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  return lines.slice(0, maxLines);
}

function makeThumb(title, from = '6ec9ff', to = '7d8cff') {
  const lines = wrapThumbText(String(title || 'Video').slice(0, 72));
  const textSvg = lines.map((line, index) => `<text x="34" y="${178 + (index * 34)}" font-size="28" font-weight="800" fill="#ffffff" font-family="Arial, Helvetica, sans-serif">${escapeSvgText(line)}</text>`).join('');
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#${from}"/>
          <stop offset="100%" stop-color="#${to}"/>
        </linearGradient>
      </defs>
      <rect width="640" height="360" rx="26" fill="url(#g)"/>
      <rect x="28" y="26" width="584" height="308" rx="22" fill="rgba(10,25,50,.12)" stroke="rgba(255,255,255,.18)"/>
      <circle cx="104" cy="108" r="44" fill="rgba(255,255,255,.18)"/>
      <polygon points="92,84 92,132 132,108" fill="#ffffff" opacity="0.96"/>
      <text x="168" y="104" font-size="20" font-weight="700" fill="rgba(255,255,255,.92)" font-family="Arial, Helvetica, sans-serif">Career Crox YT Hub</text>
      <text x="168" y="136" font-size="14" font-weight="700" fill="rgba(255,255,255,.78)" font-family="Arial, Helvetica, sans-serif">Daily video pick</text>
      ${textSvg}
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function resolveThumb(url, title = '', from = '6ec9ff', to = '7d8cff') {
  const value = String(url || '').trim();
  if (!value || value.includes('placehold.co')) return makeThumb(title, from, to);
  return value;
}

function readOffset() {
  try {
    const saved = JSON.parse(localStorage.getItem('careerCroxYtHubDailyOffset') || '{}');
    return saved?.day === todayKey() ? Number(saved.offset || 0) : 0;
  } catch {
    return 0;
  }
}

function saveOffset(offset) {
  localStorage.setItem('careerCroxYtHubDailyOffset', JSON.stringify({ day: todayKey(), offset }));
}

function hubRowsFor(hubType = 'learning') {
  return HUB_ROWS_BY_HUB[hubType] || HUB_ROWS_BY_HUB.learning;
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function inferHubType(playlist) {
  const explicit = normalizeText(playlist?.hub_type || playlist?.hub || '');
  if (explicit && HUB_GROUPS.find((item) => item.key === explicit)) return explicit;
  const text = `${playlist?.category_key || ''} ${playlist?.category || ''} ${playlist?.title || ''} ${playlist?.description || ''}`.toLowerCase();
  if (text.includes('linkedin') || text.includes('corporate') || text.includes('hiring post') || text.includes('brand')) return 'corporate';
  if (text.includes('funny') || text.includes('stand') || text.includes('haseeb') || text.includes('asif') || text.includes('comedy') || text.includes('humor')) return 'fun';
  return 'learning';
}

function inferHubRow(playlist, fallbackHub = 'learning') {
  const hubType = inferHubType(playlist) || fallbackHub;
  const explicit = normalizeText(playlist?.category_key || playlist?.category || '');
  const rows = hubRowsFor(hubType);
  if (explicit && rows.find((row) => row.key === explicit)) return explicit;
  const text = `${explicit} ${playlist?.title || ''} ${playlist?.description || ''}`.toLowerCase();
  for (const row of rows) {
    const simple = row.key.replace(/-/g, ' ');
    if (text.includes(row.key) || text.includes(simple) || text.includes(row.label.toLowerCase())) return row.key;
  }
  if (hubType === 'fun') {
    if (text.includes('stand') || text.includes('haseeb') || text.includes('asif')) return 'standup-comedy';
    if (text.includes('office')) return 'office-humor';
    if (text.includes('funny')) return 'funny-videos';
  }
  if (hubType === 'corporate') {
    if (text.includes('linkedin')) return 'linkedin-content';
    if (text.includes('hiring')) return 'hiring-posts';
    if (text.includes('caption') || text.includes('copy')) return 'copywriting';
    if (text.includes('short')) return 'branding-shorts';
  }
  if (hubType === 'learning') {
    if (text.includes('dark psych')) return 'dark-psychology';
    if (text.includes('advanced english') || text.includes('communication')) return 'advanced-english';
    if (text.includes('phrase')) return 'phrasers';
    if (text.includes('daily english') || text.includes('spoken english')) return 'daily-english';
    if (text.includes('recruitment') || text.includes('recruiter')) return 'recruitment-mastery';
  }
  return rows[0]?.key || 'convincing-tricks';
}

function inferContentType(playlist) {
  const explicit = normalizeText(playlist?.content_type || '');
  if (explicit === 'shorts' || explicit === 'videos') return explicit;
  const text = `${playlist?.title || ''} ${playlist?.description || ''}`.toLowerCase();
  if (text.includes('shorts') || text.includes('short') || text.includes('reel')) return 'shorts';
  return 'videos';
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('File could not be read'));
    reader.readAsDataURL(file);
  });
}

function bytesLabel(value) {
  const size = Number(value || 0);
  if (!size) return 'Link';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
  return `${Math.round(size / (1024 * 102.4)) / 10} MB`;
}

function buildDailyPicks({ hubType = 'learning', rowKey = '', format = 'shorts', offset = 0 }) {
  const row = hubRowsFor(hubType).find((item) => item.key === rowKey) || hubRowsFor(hubType)[0];
  const library = getCuratedVideos(hubType, row?.key || rowKey, format);
  if (!library.length) return [];
  const base = new Date(todayKey()).getDate() % library.length;
  const count = FORMAT_META[format]?.count || 5;
  return Array.from({ length: Math.min(count, library.length) }).map((_, index) => library[(base + offset + index) % library.length]);
}

function videoNeedsDirectLink(video) {
  const url = String(video?.url || '').trim();
  if (!url) return true;
  if (url.includes('/results?search_query=')) return true;
  return !(/youtu\.be\//.test(url) || /youtube\.com\/(watch\?v=|shorts\/|embed\/)/.test(url));
}

function playlistNeedsDirectReplacement(playlist) {
  const videos = Array.isArray(playlist?.videos) ? playlist.videos : [];
  return !videos.length || videos.some((video) => videoNeedsDirectLink(video));
}

function withCuratedPlaylistVideos(playlists = []) {
  return playlists.map((playlist) => {
    const curated = getCuratedVideos(inferHubType(playlist), inferHubRow(playlist), inferContentType(playlist));
    if (!curated.length) return playlist;
    if (playlistNeedsDirectReplacement(playlist)) {
      return {
        ...playlist,
        auto_update_enabled: '1',
        auto_daily_count: String(Math.min(5, curated.length)),
        videos: curated.map((video, index) => ({
          video_id: `${playlist.playlist_id || 'PL'}-CURATED-${index + 1}`,
          playlist_id: playlist.playlist_id,
          title: video.title,
          url: video.url,
          thumbnail_url: video.thumbnail,
          order_index: String(index + 1),
          status: 'active',
          created_at: todayKey(),
          updated_at: todayKey(),
        })),
      };
    }
    return playlist;
  });
}

export default function LearningHubPage() {
  const { user } = useAuth();
  const isManager = ['admin', 'manager'].includes(String(user?.role || '').toLowerCase());
  const [hub, setHub] = useState({ playlists: [], resources: [], can_manage_hub: false });
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('');
  const [selectedHub, setSelectedHub] = useState('learning');
  const [selectedFormat, setSelectedFormat] = useState('shorts');
  const [selectedHubRow, setSelectedHubRow] = useState(hubRowsFor('learning')[0]?.key || 'convincing-tricks');
  const [playlistForm, setPlaylistForm] = useState({
    title: '',
    description: '',
    links: '',
    template_key: PLAYLIST_PRESETS[0].key,
    accent: PLAYLIST_PRESETS[0].accent,
    hub_type: 'learning',
    category_key: hubRowsFor('learning')[0]?.key || 'convincing-tricks',
    category: hubRowsFor('learning')[0]?.key || 'convincing-tricks',
    content_type: 'shorts',
  });
  const [videoForm, setVideoForm] = useState({ links: '' });
  const [resourceForm, setResourceForm] = useState({ title: '', description: '', resource_type: 'link', url: '', file_name: '', content_base64: '', mime_type: '' });
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [selectedVideoIds, setSelectedVideoIds] = useState([]);
  const [dailyOffset, setDailyOffset] = useState(() => readOffset());
  const [hubView, setHubView] = useState('playlists');

  async function load() {
    try {
      const data = await api.get('/api/learning/hub', { cacheTtlMs: 1500 });
      const payload = data || { playlists: [], resources: [], can_manage_hub: false };
      const normalizedPayload = { ...payload, playlists: withCuratedPlaylistVideos(payload.playlists || []) };
      setHub(normalizedPayload);
      const firstVisible = (normalizedPayload.playlists || []).find((item) => inferHubType(item) === selectedHub && inferHubRow(item, selectedHub) === selectedHubRow && inferContentType(item) === selectedFormat)
        || (normalizedPayload.playlists || []).find((item) => inferHubType(item) === selectedHub && inferHubRow(item, selectedHub) === selectedHubRow)
        || normalizedPayload.playlists?.[0]
        || null;
      setSelectedPlaylistId((current) => current || firstVisible?.playlist_id || '');
    } catch (err) {
      setMessage(err.message || 'YT Hub could not load right now.');
    }
  }

  useEffect(() => { load(); }, []);
  usePolling(load, 5000, []);

  useEffect(() => {
    const rows = hubRowsFor(selectedHub);
    if (!rows.find((row) => row.key === selectedHubRow)) {
      setSelectedHubRow(rows[0]?.key || '');
    }
    setPlaylistForm((current) => ({
      ...current,
      hub_type: selectedHub,
      category_key: rows.find((row) => row.key === selectedHubRow)?.key || rows[0]?.key || current.category_key,
      category: rows.find((row) => row.key === selectedHubRow)?.key || rows[0]?.key || current.category,
      content_type: selectedFormat,
    }));
    setSelectedPlaylistId('');
  }, [selectedHub]);

  useEffect(() => {
    setPlaylistForm((current) => ({ ...current, category_key: selectedHubRow, category: selectedHubRow, hub_type: selectedHub }));
    setSelectedPlaylistId('');
  }, [selectedHubRow]);

  useEffect(() => {
    setPlaylistForm((current) => ({ ...current, content_type: selectedFormat, hub_type: selectedHub, category_key: selectedHubRow, category: selectedHubRow }));
    setSelectedPlaylistId('');
  }, [selectedFormat]);

  const dailyPicks = useMemo(() => buildDailyPicks({ hubType: selectedHub, rowKey: selectedHubRow, format: selectedFormat, offset: dailyOffset }), [dailyOffset, selectedHub, selectedHubRow, selectedFormat]);
  const currentRows = useMemo(() => hubRowsFor(selectedHub), [selectedHub]);
  const rowPlaylists = useMemo(() => (hub.playlists || []).filter((item) => inferHubType(item) === selectedHub && inferHubRow(item, selectedHub) === selectedHubRow && inferContentType(item) === selectedFormat), [hub.playlists, selectedHub, selectedHubRow, selectedFormat]);
  const hubRowMeta = useMemo(() => currentRows.find((item) => item.key === selectedHubRow) || currentRows[0], [currentRows, selectedHubRow]);
  const selectedHubMeta = useMemo(() => HUB_GROUPS.find((item) => item.key === selectedHub) || HUB_GROUPS[0], [selectedHub]);
  const selectedPlaylist = useMemo(
    () => rowPlaylists.find((item) => String(item.playlist_id) === String(selectedPlaylistId)) || rowPlaylists[0] || null,
    [rowPlaylists, selectedPlaylistId],
  );

  function rotateDailyPicks() {
    const next = dailyOffset + 5;
    setDailyOffset(next);
    saveOffset(next);
  }

  async function createPlaylist(e) {
    e.preventDefault();
    if (!playlistForm.title.trim()) return;
    setBusy('playlist');
    setMessage('');
    try {
      await api.post('/api/learning/playlists', playlistForm);
      setPlaylistForm({ title: '', description: '', links: '', template_key: PLAYLIST_PRESETS[0].key, accent: PLAYLIST_PRESETS[0].accent, hub_type: selectedHub, category_key: selectedHubRow, category: selectedHubRow, content_type: selectedFormat });
      await load();
      setMessage('Playlist created.');
    } catch (err) {
      setMessage(err.message || 'Playlist could not be created.');
    } finally {
      setBusy('');
    }
  }

  async function addVideos(e) {
    e.preventDefault();
    if (!selectedPlaylistId || !videoForm.links.trim()) return;
    setBusy('videos');
    setMessage('');
    try {
      await api.post(`/api/learning/playlists/${encodeURIComponent(selectedPlaylistId)}/videos`, videoForm);
      setVideoForm({ links: '' });
      await load();
      setMessage('Videos added to the playlist.');
    } catch (err) {
      setMessage(err.message || 'Videos could not be added.');
    } finally {
      setBusy('');
    }
  }

  async function deletePlaylist(playlistId) {
    if (!window.confirm('Delete this playlist and all its videos?')) return;
    setBusy('delete-playlist');
    setMessage('');
    try {
      await api.post(`/api/learning/playlists/${encodeURIComponent(playlistId)}/delete`, {});
      setSelectedPlaylistId('');
      setSelectedVideoIds([]);
      await load();
      setMessage('Playlist deleted.');
    } catch (err) {
      setMessage(err.message || 'Playlist could not be deleted.');
    } finally {
      setBusy('');
    }
  }

  async function deleteSelectedVideos() {
    if (!selectedVideoIds.length) return;
    if (!window.confirm('Delete selected videos from this playlist?')) return;
    setBusy('delete-videos');
    setMessage('');
    try {
      await api.post('/api/learning/videos/delete', { video_ids: selectedVideoIds });
      setSelectedVideoIds([]);
      await load();
      setMessage('Selected videos deleted.');
    } catch (err) {
      setMessage(err.message || 'Selected videos could not be deleted.');
    } finally {
      setBusy('');
    }
  }

  async function submitResource(e) {
    e.preventDefault();
    if (!resourceForm.title.trim()) return;
    setBusy('resource');
    setMessage('');
    try {
      await api.post('/api/learning/resources', resourceForm);
      setResourceForm({ title: '', description: '', resource_type: 'link', url: '', file_name: '', content_base64: '', mime_type: '' });
      await load();
      setMessage('Resource added.');
    } catch (err) {
      setMessage(err.message || 'Resource could not be added.');
    } finally {
      setBusy('');
    }
  }

  async function onResourceFileChange(file) {
    if (!file) return;
    const content = await readFileAsBase64(file);
    setResourceForm((current) => ({
      ...current,
      file_name: file.name,
      mime_type: file.type || 'application/octet-stream',
      content_base64: content,
      resource_type: 'file',
    }));
  }

  async function deleteResource(resourceId) {
    if (!window.confirm('Delete this resource?')) return;
    setBusy(`resource-${resourceId}`);
    setMessage('');
    try {
      await api.post(`/api/learning/resources/${encodeURIComponent(resourceId)}/delete`, {});
      await load();
      setMessage('Resource deleted.');
    } catch (err) {
      setMessage(err.message || 'Resource could not be deleted.');
    } finally {
      setBusy('');
    }
  }

  function toggleVideo(videoId) {
    setSelectedVideoIds((current) => current.includes(videoId) ? current.filter((item) => item !== videoId) : [...current, videoId]);
  }

  function toggleSelectAllVideos() {
    const playlistVideos = selectedPlaylist?.videos || [];
    if (!playlistVideos.length) return;
    if (selectedVideoIds.length === playlistVideos.length) setSelectedVideoIds([]);
    else setSelectedVideoIds(playlistVideos.map((item) => item.video_id));
  }

  return (
    <Layout title="YT Hub" subtitle="Learning, fun, and corporate video sections with daily rotating shorts, saved playlists, and a clean front page.">
      <style>{`
        .yt-shell{display:flex;flex-direction:column;gap:18px;}
        .yt-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:18px;align-items:start;}
        .yt-hub-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;}
        .yt-row-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;}
        .yt-row-card{border:none;text-align:left;border-radius:24px;padding:18px;cursor:pointer;color:#17356e;background:linear-gradient(180deg,#fff,#f6fbff);box-shadow:0 16px 30px rgba(34,56,122,.10);border:1px solid rgba(116,144,230,.16);min-height:128px;display:flex;flex-direction:column;justify-content:space-between;}
        .yt-row-card strong{font-size:18px;line-height:1.25;}
        .yt-row-card span{font-size:12px;line-height:1.5;color:#637497;margin-top:8px;}
        .yt-row-card.active{transform:translateY(-2px);box-shadow:0 20px 34px rgba(34,56,122,.14);border-color:rgba(71,115,236,.34);}
        .yt-row-card.blue{background:linear-gradient(180deg,#eff5ff,#f8fbff);}
        .yt-row-card.violet{background:linear-gradient(180deg,#f3efff,#fbfaff);}
        .yt-row-card.green{background:linear-gradient(180deg,#edf9f1,#f7fffb);}
        .yt-row-card.sky{background:linear-gradient(180deg,#edf9ff,#f7fbff);}
        .yt-row-card.gold{background:linear-gradient(180deg,#fff8e7,#fffdf5);}
        .yt-row-card.slate{background:linear-gradient(180deg,#f4f7fb,#fbfdff);}
        .yt-row-card.coral{background:linear-gradient(180deg,#fff2ec,#fff9f6);}
        .yt-panel{padding:18px;border-radius:26px;border:1px solid rgba(116,144,230,.18);background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(246,250,255,.95));box-shadow:0 20px 42px rgba(30,55,120,.10);}
        .yt-title{font-size:20px;font-weight:900;color:#163572;}
        .yt-sub{font-size:13px;line-height:1.55;color:#60708f;margin-top:6px;}
        .yt-playlist-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:14px;}
        .yt-playlist-card{border:none;border-radius:24px;padding:16px;text-align:left;cursor:pointer;color:#fff;box-shadow:0 16px 28px rgba(44,67,135,.16);min-height:152px;display:flex;flex-direction:column;justify-content:space-between;}
        .yt-playlist-card.active{outline:3px solid rgba(255,255,255,.65);transform:translateY(-1px);}
        .yt-playlist-card strong{font-size:18px;line-height:1.2;display:block;}
        .yt-playlist-card span{font-size:13px;line-height:1.45;opacity:.96;display:block;margin-top:8px;}
        .yt-chip-row,.yt-action-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;}
        .yt-chip{border:none;border-radius:999px;padding:9px 14px;background:linear-gradient(135deg,#eef4ff,#e2edff);color:#2c4c8d;font-weight:800;cursor:pointer;box-shadow:0 10px 18px rgba(34,56,122,.08);}
        .yt-chip.active{background:linear-gradient(135deg,#3f72ff,#7a61ff);color:#fff;}
        .yt-format-toggle .yt-chip{min-width:108px;justify-content:center;display:inline-flex;}
        .yt-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
        .yt-field{display:flex;flex-direction:column;gap:7px;}
        .yt-field label{font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#66769a;}
        .yt-field input,.yt-field textarea,.yt-field select{width:100%;border:none;outline:none;border-radius:16px;padding:13px 14px;background:linear-gradient(180deg,#fff,#f5f9ff);box-shadow:inset 0 0 0 1px rgba(117,145,228,.2),0 10px 20px rgba(46,77,153,.06);font-size:14px;color:#17356e;}
        .yt-field textarea{min-height:120px;resize:vertical;}
        .yt-primary,.yt-secondary,.yt-danger{border:none;border-radius:16px;padding:12px 16px;font-weight:900;cursor:pointer;box-shadow:0 14px 26px rgba(34,56,122,.12);}
        .yt-primary{background:linear-gradient(135deg,#3c74ff,#7d63ff);color:#fff;}
        .yt-secondary{background:linear-gradient(135deg,#edf6ff,#e6fff4);color:#15587c;}
        .yt-danger{background:linear-gradient(135deg,#ffe7ea,#ffd8df);color:#b3284c;}
        .yt-video-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:14px;}
        .yt-video-card{border-radius:22px;border:1px solid rgba(121,143,219,.16);overflow:hidden;background:linear-gradient(180deg,#fff,#f8fbff);box-shadow:0 16px 30px rgba(36,60,120,.08);}
        .yt-video-thumb{width:100%;height:160px;object-fit:cover;background:#eef4ff;display:block;}
        .yt-video-body{padding:14px;display:flex;flex-direction:column;gap:10px;}
        .yt-video-title{font-size:15px;font-weight:900;color:#17356e;line-height:1.45;}
        .yt-video-tip{font-size:12px;color:#6a7897;line-height:1.45;}
        .yt-resource-list{display:flex;flex-direction:column;gap:12px;margin-top:14px;}
        .yt-resource-card{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;padding:14px 16px;border-radius:20px;border:1px solid rgba(121,143,219,.16);background:linear-gradient(180deg,#fff,#f7fbff);box-shadow:0 12px 24px rgba(32,55,115,.06);}
        .yt-resource-name{font-size:15px;font-weight:900;color:#17356e;}
        .yt-resource-sub{font-size:12px;color:#687895;line-height:1.55;margin-top:4px;}
        .yt-short-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:14px;}
        .yt-short-card{border-radius:22px;overflow:hidden;background:linear-gradient(180deg,#fff,#f8fbff);border:1px solid rgba(121,143,219,.16);box-shadow:0 14px 24px rgba(32,55,115,.08);}
        .yt-short-card img{width:100%;height:120px;object-fit:cover;display:block;background:#edf4ff;}
        .yt-short-card div{padding:12px;}
        .yt-short-card strong{display:block;font-size:14px;line-height:1.35;color:#17356e;}
        .yt-short-card span{display:block;font-size:12px;line-height:1.45;color:#687895;margin-top:6px;}
        .yt-note{font-size:13px;font-weight:800;color:#2f5ab3;background:linear-gradient(135deg,rgba(79,125,255,.11),rgba(90,214,255,.12));border:1px solid rgba(94,123,225,.16);padding:12px 14px;border-radius:16px;}
        @media (max-width:1180px){.yt-grid{grid-template-columns:1fr;}.yt-hub-grid,.yt-short-grid,.yt-playlist-grid,.yt-video-grid,.yt-form-grid,.yt-row-grid{grid-template-columns:1fr;}}
      `}</style>

      <div className="yt-shell">
        {!!message && <div className="yt-note">{message}</div>}

        <div className="yt-panel">
          <div className="yt-title">YT Hub Sections</div>
          <div className="yt-sub">The front page stays clean. First choose the hub, then the section, then shorts or videos.</div>
          <div className="yt-hub-grid" style={{ marginTop: 14 }}>
            {HUB_GROUPS.map((group) => (
              <button key={group.key} type="button" className={`yt-row-card ${group.tone} ${selectedHub === group.key && hubView === 'playlists' ? 'active' : ''}`} onClick={() => { setHubView('playlists'); setSelectedHub(group.key); setSelectedHubRow(hubRowsFor(group.key)[0]?.key || ''); setSelectedFormat(group.key === 'corporate' ? 'videos' : 'shorts'); }}>
                <strong>{group.label}</strong>
                <span>{group.help}</span>
              </button>
            ))}
            <button type="button" className={`yt-row-card slate ${hubView === 'resources' ? 'active' : ''}`} onClick={() => setHubView('resources')}>
              <strong>Important Documents & Links</strong>
              <span>Open shared files and links from a separate section so the landing page remains clean.</span>
            </button>
            {isManager ? <button type="button" className={`yt-row-card coral ${hubView === 'manage' ? 'active' : ''}`} onClick={() => setHubView('manage')}><strong>Manage Hub</strong><span>Create playlists, add videos, and upload shared files from here only.</span></button> : null}
          </div>
        </div>

        {hubView === 'playlists' ? (
          <>
            <div className="yt-panel">
              <div className="yt-title">{selectedHubMeta.label}</div>
              <div className="yt-sub">Choose the section first. Then open daily rotating shorts or videos, plus saved playlists for the same section.</div>
              <div className="yt-row-grid" style={{ marginTop: 14 }}>
                {currentRows.map((row) => (
                  <button key={row.key} type="button" className={`yt-row-card ${row.tone} ${selectedHubRow === row.key ? 'active' : ''}`} onClick={() => { setSelectedHubRow(row.key); setSelectedPlaylistId(''); }}>
                    <strong>{row.label}</strong>
                    <span>{row.help}</span>
                  </button>
                ))}
              </div>
              <div className="yt-action-row yt-format-toggle" style={{ marginTop: 14 }}>
                {Object.entries(FORMAT_META).map(([key, meta]) => (
                  <button key={key} type="button" className={`yt-chip ${selectedFormat === key ? 'active' : ''}`} onClick={() => setSelectedFormat(key)}>{meta.label}</button>
                ))}
                <div className="yt-note" style={{ padding: '9px 12px' }}>Section: {hubRowMeta?.label || '-'}</div>
              </div>
            </div>

            <div className="yt-panel">
              <div className="yt-title">Daily {FORMAT_META[selectedFormat]?.label || 'Videos'} Queue</div>
              <div className="yt-sub">This queue rotates by day and can bring more results without stuffing the CRM database with junk. {selectedFormat === 'shorts' ? 'Ten fresh shorts surface for the selected section.' : 'Five longer video picks surface for the selected section.'}</div>
              <div className="yt-action-row" style={{ marginTop: 14 }}>
                <button type="button" className="yt-secondary" onClick={rotateDailyPicks}>Bring More</button>
                <div className="yt-note" style={{ padding: '9px 12px' }}>{selectedHubMeta.label} • {hubRowMeta?.label || '-'} • {FORMAT_META[selectedFormat]?.count || 0} daily picks</div>
              </div>
              <div className="yt-short-grid">
                {dailyPicks.map((item) => (
                  <div key={item.id} className="yt-short-card">
                    <img src={resolveThumb(item.thumbnail, item.title)} alt={item.title} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = makeThumb(item.title); }} />
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.tip}</span>
                      <div className="yt-action-row" style={{ marginTop: 10 }}>
                        <a className="yt-chip" href={item.url} target="_blank" rel="noreferrer">Open</a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="yt-grid">
              <div className="yt-panel">
                <div className="yt-title">Saved Playlists</div>
                <div className="yt-sub">Only playlists for the selected hub, section, and format appear here.</div>
                <div className="yt-playlist-grid">
                  {rowPlaylists.map((playlist) => (
                    <button
                      key={playlist.playlist_id}
                      type="button"
                      className={`yt-playlist-card ${selectedPlaylistId === playlist.playlist_id ? 'active' : ''}`}
                      style={{ background: playlist.accent || PLAYLIST_PRESETS[0].accent }}
                      onClick={() => { setSelectedPlaylistId(playlist.playlist_id); setSelectedVideoIds([]); }}
                    >
                      <div>
                        <strong>{playlist.title}</strong>
                        <span>{playlist.description || 'Playlist ready for this section.'}</span>
                      </div>
                      <div className="yt-chip-row">
                        <span className="yt-chip" style={{ background: 'rgba(255,255,255,.18)', color: '#fff' }}>{playlist.videos?.length || 0} items</span>
                        <span className="yt-chip" style={{ background: 'rgba(255,255,255,.18)', color: '#fff' }}>{inferContentType(playlist) === 'shorts' ? 'Shorts' : 'Videos'}</span>
                      </div>
                    </button>
                  ))}
                  {!rowPlaylists.length ? <div className="yt-note">No saved playlists in this section yet. The daily queue above still rotates automatically.</div> : null}
                </div>
              </div>
              <div className="yt-panel">
                <div className="yt-title">Playlist Preview</div>
                <div className="yt-sub">Open a saved playlist to see all its items. Daily picks and saved playlists stay available together for quick use.</div>
                {selectedPlaylist ? (
                  <>
                    <div className="yt-note" style={{ marginTop: 14, background: selectedPlaylist.accent || PLAYLIST_PRESETS[0].accent, color: '#fff' }}>{selectedPlaylist.title}</div>
                    <div className="yt-video-grid">
                      {(selectedPlaylist.videos || []).map((video) => (
                        <div key={video.video_id} className="yt-video-card">
                          <img className="yt-video-thumb" src={resolveThumb(video.thumbnail_url, video.title)} alt={video.title} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = makeThumb(video.title); }} />
                          <div className="yt-video-body">
                            <div className="yt-action-row" style={{ justifyContent: 'space-between' }}>
                              <span className="yt-chip">{selectedFormat === 'shorts' ? 'Short' : 'Video'}</span>
                              <a className="yt-chip" href={video.url} target="_blank" rel="noreferrer">Open</a>
                            </div>
                            <div className="yt-video-title">{video.title}</div>
                            <div className="yt-video-tip">{selectedHubMeta.label} • {hubRowMeta?.label || '-'} • saved playlist item.</div>
                          </div>
                        </div>
                      ))}
                      {!(selectedPlaylist.videos || []).length ? <div className="yt-note">This playlist is empty right now.</div> : null}
                    </div>
                  </>
                ) : <div className="yt-note" style={{ marginTop: 14 }}>Select a playlist card to preview its items here.</div>}
              </div>
            </div>
          </>
        ) : null}

        {hubView === 'resources' ? (
          <div className="yt-panel">
            <div className="yt-title">Important Documents & Links</div>
            <div className="yt-sub">This section stays separate so the front page remains clean. Open what you need from here.</div>
            {isManager ? (
              <form className="yt-form-grid" style={{ marginTop: 14 }} onSubmit={submitResource}>
                <div className="yt-field"><label>Title</label><input value={resourceForm.title} onChange={(e) => setResourceForm((c) => ({ ...c, title: e.target.value }))} placeholder="Axis Bank JD PDF" /></div>
                <div className="yt-field"><label>Type</label><select value={resourceForm.resource_type} onChange={(e) => setResourceForm((c) => ({ ...c, resource_type: e.target.value }))}><option value="link">Link</option><option value="file">PDF / File</option></select></div>
                <div className="yt-field" style={{ gridColumn: '1 / -1' }}><label>Description</label><input value={resourceForm.description} onChange={(e) => setResourceForm((c) => ({ ...c, description: e.target.value }))} placeholder="Shared reference for recruiters and leadership." /></div>
                {resourceForm.resource_type === 'link' ? (
                  <div className="yt-field" style={{ gridColumn: '1 / -1' }}><label>URL</label><input value={resourceForm.url} onChange={(e) => setResourceForm((c) => ({ ...c, url: e.target.value }))} placeholder="https://..." /></div>
                ) : (
                  <div className="yt-field" style={{ gridColumn: '1 / -1' }}><label>Upload File</label><input type="file" onChange={(e) => onResourceFileChange(e.target.files?.[0])} /></div>
                )}
                <div className="yt-action-row" style={{ gridColumn: '1 / -1' }}>
                  <button type="submit" className="yt-primary" disabled={busy === 'resource'}>{busy === 'resource' ? 'Saving...' : 'Add Resource'}</button>
                  {resourceForm.file_name ? <div className="yt-note" style={{ padding: '9px 12px' }}>{resourceForm.file_name}</div> : null}
                </div>
              </form>
            ) : null}
            <div className="yt-resource-list">
              {(hub.resources || []).map((resource) => (
                <div key={resource.resource_id} className="yt-resource-card">
                  <div>
                    <div className="yt-resource-name">{resource.title}</div>
                    <div className="yt-resource-sub">{resource.description || 'Shared CRM resource'} • {resource.resource_type === 'link' ? 'Link' : resource.original_name || 'File'} • {bytesLabel(resource.size_bytes)}</div>
                  </div>
                  <div className="yt-action-row">
                    <a className="yt-chip" href={resource.resource_type === 'link' ? resource.url : `/api/learning/resources/${resource.resource_id}/download`} target="_blank" rel="noreferrer">
                      {resource.resource_type === 'link' ? 'Open' : 'Download'}
                    </a>
                    {isManager ? <button type="button" className="yt-danger" onClick={() => deleteResource(resource.resource_id)}>{busy === `resource-${resource.resource_id}` ? 'Deleting...' : 'Delete'}</button> : null}
                  </div>
                </div>
              ))}
              {!(hub.resources || []).length ? <div className="yt-note">No shared resources added yet.</div> : null}
            </div>
          </div>
        ) : null}

        {isManager && hubView === 'manage' ? (
          <div className="yt-grid">
            <div className="yt-panel">
              <div className="yt-title">Create Playlist</div>
              <div className="yt-sub">Set the name, theme, look, and optional video links. One YouTube link per line is enough.</div>
              <form onSubmit={createPlaylist}>
                <div className="yt-form-grid" style={{ marginTop: 14 }}>
                  <div className="yt-field"><label>Playlist Name</label><input value={playlistForm.title} onChange={(e) => setPlaylistForm((c) => ({ ...c, title: e.target.value }))} placeholder="Convincing Tricks • Daily Shorts" /></div>
                  <div className="yt-field"><label>Hub</label><select value={playlistForm.hub_type} onChange={(e) => {
                    const nextHub = e.target.value;
                    const firstRow = hubRowsFor(nextHub)[0]?.key || '';
                    setPlaylistForm((c) => ({ ...c, hub_type: nextHub, category_key: firstRow, category: firstRow }));
                  }}>{HUB_GROUPS.map((group) => <option key={group.key} value={group.key}>{group.label}</option>)}</select></div>
                  <div className="yt-field"><label>Section</label><select value={playlistForm.category_key} onChange={(e) => setPlaylistForm((c) => ({ ...c, category_key: e.target.value, category: e.target.value }))}>{hubRowsFor(playlistForm.hub_type).map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}</select></div>
                  <div className="yt-field"><label>Format</label><select value={playlistForm.content_type} onChange={(e) => setPlaylistForm((c) => ({ ...c, content_type: e.target.value }))}><option value="shorts">Shorts</option><option value="videos">Videos</option></select></div>
                  <div className="yt-field"><label>Template</label><select value={playlistForm.template_key} onChange={(e) => {
                    const preset = PLAYLIST_PRESETS.find((item) => item.key === e.target.value) || PLAYLIST_PRESETS[0];
                    setPlaylistForm((c) => ({ ...c, template_key: preset.key, accent: preset.accent }));
                  }}>{PLAYLIST_PRESETS.map((preset) => <option key={preset.key} value={preset.key}>{preset.label}</option>)}</select></div>
                  <div className="yt-field" style={{ gridColumn: '1 / -1' }}><label>Description</label><input value={playlistForm.description} onChange={(e) => setPlaylistForm((c) => ({ ...c, description: e.target.value }))} placeholder="Use this for sharper communication, recruiter confidence, or clean office entertainment." /></div>
                  <div className="yt-field" style={{ gridColumn: '1 / -1' }}><label>YouTube Links</label><textarea value={playlistForm.links} onChange={(e) => setPlaylistForm((c) => ({ ...c, links: e.target.value }))} placeholder="Paste one YouTube link per line" /></div>
                </div>
                <div className="yt-chip-row" style={{ marginTop: 12 }}>
                  {PLAYLIST_PRESETS.map((preset) => (
                    <button key={preset.key} type="button" className={`yt-chip ${playlistForm.template_key === preset.key ? 'active' : ''}`} onClick={() => setPlaylistForm((c) => ({ ...c, template_key: preset.key, accent: preset.accent }))}>{preset.label}</button>
                  ))}
                </div>
                <div className="yt-action-row" style={{ marginTop: 14 }}>
                  <button type="submit" className="yt-primary" disabled={busy === 'playlist'}>{busy === 'playlist' ? 'Creating...' : 'Create Playlist'}</button>
                </div>
              </form>
            </div>

            <div className="yt-panel">
              <div className="yt-title">Selected Playlist</div>
              <div className="yt-sub">Add more videos, select all, or delete the chosen items without loading the whole page with every playlist at once.</div>
              {selectedPlaylist ? (
                <>
                  <div className="yt-action-row" style={{ marginTop: 14 }}>
                    <div className="yt-note" style={{ padding: '9px 12px', background: selectedPlaylist.accent || PLAYLIST_PRESETS[0].accent, color: '#fff' }}>{selectedPlaylist.title}</div>
                    <button type="button" className="yt-secondary" onClick={toggleSelectAllVideos}>{selectedVideoIds.length === (selectedPlaylist.videos || []).length && (selectedPlaylist.videos || []).length ? 'Unselect All' : 'Select All'}</button>
                    <button type="button" className="yt-danger" onClick={deleteSelectedVideos} disabled={!selectedVideoIds.length || busy === 'delete-videos'}>{busy === 'delete-videos' ? 'Deleting...' : 'Delete Selected'}</button>
                    <button type="button" className="yt-danger" onClick={() => deletePlaylist(selectedPlaylist.playlist_id)} disabled={busy === 'delete-playlist'}>{busy === 'delete-playlist' ? 'Deleting...' : 'Delete Playlist'}</button>
                  </div>
                  <form onSubmit={addVideos} style={{ marginTop: 14 }}>
                    <div className="yt-field"><label>Add Video Links</label><textarea value={videoForm.links} onChange={(e) => setVideoForm({ links: e.target.value })} placeholder="Paste one or more YouTube links here" /></div>
                    <div className="yt-action-row" style={{ marginTop: 12 }}><button type="submit" className="yt-primary" disabled={busy === 'videos'}>{busy === 'videos' ? 'Adding...' : 'Add Videos'}</button></div>
                  </form>
                  <div className="yt-video-grid">
                    {(selectedPlaylist.videos || []).map((video) => (
                      <div key={video.video_id} className="yt-video-card">
                        <img className="yt-video-thumb" src={resolveThumb(video.thumbnail_url, video.title)} alt={video.title} onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = makeThumb(video.title); }} />
                        <div className="yt-video-body">
                          <div className="yt-chip-row" style={{ justifyContent: 'space-between' }}>
                            <label className="yt-chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                              <input type="checkbox" checked={selectedVideoIds.includes(video.video_id)} onChange={() => toggleVideo(video.video_id)} />
                              Select
                            </label>
                            <a className="yt-chip" href={video.url} target="_blank" rel="noreferrer">Open</a>
                          </div>
                          <div className="yt-video-title">{video.title}</div>
                          <div className="yt-video-tip">Playlist item ready for content review or posting reference.</div>
                        </div>
                      </div>
                    ))}
                    {!(selectedPlaylist.videos || []).length ? <div className="yt-note">This playlist is empty right now.</div> : null}
                  </div>
                </>
              ) : <div className="yt-note" style={{ marginTop: 14 }}>Select a playlist card to open its videos here.</div>}
            </div>
          </div>
        ) : null}
      </div>
    </Layout>
  );
}
