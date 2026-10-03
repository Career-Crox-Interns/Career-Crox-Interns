import { api } from './api';

function normalizePath(path = '') {
  return String(path || '').trim();
}

function parseFilenameFromDisposition(value = '', fallback = 'career-crox-export.xls') {
  const raw = String(value || '');
  const utfMatch = raw.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) return decodeURIComponent(utfMatch[1]).replace(/[\/:*?"<>|]+/g, '-');
  const basicMatch = raw.match(/filename="?([^";]+)"?/i);
  if (basicMatch?.[1]) return basicMatch[1].replace(/[\/:*?"<>|]+/g, '-');
  return fallback;
}

function downloadBlob(blob, filename) {
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1500);
}

function xhrDownload(url, { timeoutMs = 120000, onProgress, fallbackName = 'career-crox-export.xls' } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.withCredentials = true;
    xhr.responseType = 'blob';
    xhr.timeout = timeoutMs;

    xhr.onprogress = (event) => {
      if (!onProgress) return;
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(99, Math.max(1, Math.round((event.loaded / event.total) * 99))), 'Downloading file...');
      } else {
        onProgress(55, 'Downloading file...');
      }
    };

    xhr.onload = async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const filename = parseFilenameFromDisposition(xhr.getResponseHeader('Content-Disposition'), fallbackName);
        if (onProgress) onProgress(100, 'Download completed.');
        downloadBlob(xhr.response, filename);
        resolve(true);
        return;
      }
      let message = 'Export failed.';
      try {
        const text = await xhr.response.text();
        const parsed = JSON.parse(text);
        if (parsed?.message) message = parsed.message;
      } catch {}
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('Network error. Please retry.'));
    xhr.ontimeout = () => reject(new Error('Download timed out. Please retry.'));
    xhr.send();
  });
}

export async function openManagerProtectedExport(path, routeKey, fallbackMessage = 'Export failed.', options = {}) {
  const exportPath = normalizePath(path);
  if (!exportPath) throw new Error('Export path missing.');
  const password = window.prompt('Manager password required for export.');
  if (password === null) return false;
  if (!String(password || '').trim()) throw new Error('Manager password required.');
  const data = await api.post('/api/auth/export-access', { password, route_key: routeKey }, { timeoutMs: 20000 });
  const separator = exportPath.includes('?') ? '&' : '?';
  const protectedUrl = `${exportPath}${separator}export_token=${encodeURIComponent(data.export_token || '')}`;
  if (!options?.onProgress) {
    window.open(protectedUrl, '_blank', 'noopener,noreferrer');
    return true;
  }
  await xhrDownload(protectedUrl, {
    onProgress: options.onProgress,
    fallbackName: options.fallbackName || 'career-crox-export.xls',
    timeoutMs: Number(options.timeoutMs || 120000),
  });
  return true;
}
