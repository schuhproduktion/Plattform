const axios = require('axios');

const SERVICE_URL = (process.env.AUTOSYNC_SERVICE_URL || '').trim() || 'http://localhost:5050';
const SERVICE_TOKEN = (process.env.AUTOSYNC_SERVICE_TOKEN || '').trim() || null;
const TIMEOUT_MS = Number(process.env.AUTOSYNC_TIMEOUT_MS || 120000);

const client = SERVICE_URL ? axios.create({ baseURL: SERVICE_URL.replace(/\/$/, ''), timeout: TIMEOUT_MS }) : null;

function isEnabled() {
  return Boolean(client);
}

function authHeaders(extra = {}) {
  if (!SERVICE_TOKEN) return extra;
  return { ...extra, 'X-Autosync-Token': SERVICE_TOKEN };
}

function unwrapError(err) {
  if (err.response) {
    const payload = err.response.data;
    if (payload && typeof payload === 'object') {
      return payload.error || JSON.stringify(payload);
    }
    return payload || `HTTP ${err.response.status}`;
  }
  if (err.request) {
    return 'Keine Antwort vom AutoSync-Service';
  }
  return err.message || 'Unbekannter Fehler';
}

function ensureClient() {
  if (!client) {
    throw new Error('AutoSync-Service ist nicht konfiguriert (AUTOSYNC_SERVICE_URL fehlt).');
  }
}

async function getHealth() {
  if (!client) {
    return { enabled: false, online: false, message: 'AutoSync deaktiviert' };
  }
  try {
    const { data } = await client.get('/health', { headers: authHeaders() });
    return { enabled: true, online: true, data };
  } catch (err) {
    return { enabled: true, online: false, error: unwrapError(err) };
  }
}

async function runSkuSync({ sku, bereich, overridePrices } = {}) {
  ensureClient();
  try {
    const payload = { sku, bereich };
    if (overridePrices) {
      payload.overridePrices = overridePrices;
    }
    const { data } = await client.post('/api/sync/run', payload, { headers: authHeaders() });
    return data;
  } catch (err) {
    throw new Error(unwrapError(err));
  }
}

async function runManualSync(payload = {}) {
  ensureClient();
  try {
    const { data } = await client.post('/api/sync/manual', payload, { headers: authHeaders() });
    return data;
  } catch (err) {
    throw new Error(unwrapError(err));
  }
}

async function deleteWooProduct(sku) {
  ensureClient();
  try {
    const { data } = await client.post('/api/wc/delete', { sku }, { headers: authHeaders() });
    return data;
  } catch (err) {
    throw new Error(unwrapError(err));
  }
}

async function fetchSkuLogs(sku, { limit = 50 } = {}) {
  ensureClient();
  try {
    const { data } = await client.get(`/api/logs/${encodeURIComponent(sku)}`, {
      params: { limit },
      headers: authHeaders()
    });
    return data;
  } catch (err) {
    throw new Error(unwrapError(err));
  }
}

async function fetchLatestLogs(limit = 25) {
  ensureClient();
  try {
    const { data } = await client.get('/api/logs/latest', {
      params: { limit },
      headers: authHeaders()
    });
    return data;
  } catch (err) {
    throw new Error(unwrapError(err));
  }
}

module.exports = {
  isEnabled,
  getHealth,
  runSkuSync,
  runManualSync,
  deleteWooProduct,
  fetchSkuLogs,
  fetchLatestLogs
};
