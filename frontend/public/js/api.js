import { state } from './state.js';
import { showToast } from './ui.js';

export async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const options = {
    method,
    credentials: 'include',
    headers: { ...headers }
  };
  if (body instanceof FormData) {
    options.body = body;
  } else if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const res = await fetch(path, options);
  const isJson = res.headers.get('content-type')?.includes('application/json');
  if (!res.ok) {
    const payload = isJson ? await res.json() : await res.text();
    if (res.status === 401) {
      window.location.href = '/login.html';
      throw new Error('Nicht angemeldet');
    }
    throw new Error(payload?.error || payload || 'Fehler');
  }
  if (res.status === 204) return null;
  return isJson ? res.json() : res.text();
}

export async function ensureFreshSnapshot(force = false) {
  if (!state.user) return { last_sync: { last_run: null } };
  try {
    const health = await request('/api/health');
    const lastSync = health.last_sync?.last_run ? new Date(health.last_sync.last_run) : null;
    const minutesSinceSync = lastSync ? (Date.now() - lastSync.getTime()) / 60000 : Infinity;
    const shouldSync = force || (state.user.role === 'BATE' && minutesSinceSync > 30);
    if (shouldSync) {
      showToast('ERP Sync wird ausgeführt …');
      await request('/api/sync', { method: 'POST' });
      showToast('Sync abgeschlossen');
      return await request('/api/health');
    }
    return health;
  } catch (err) {
    console.warn('Sync-Prüfung fehlgeschlagen', err.message);
    return { last_sync: { last_run: null } };
  }
}
