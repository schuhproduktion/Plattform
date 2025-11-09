const axios = require('axios');
const { readJson } = require('./dataStore');

function resolveBaseUrl() {
  const raw =
    process.env.ERP_URL ||
    process.env.ERP_BASE_URL ||
    'https://example-erpnext/api';
  const trimmed = raw.replace(/\/+$/, '');
  if (trimmed.toLowerCase().endsWith('/api')) {
    return trimmed;
  }
  return `${trimmed}/api`;
}

const ERP_BASE_URL = resolveBaseUrl();
const ERP_KEY = process.env.ERP_API_KEY || process.env.ERP_KEY;
const ERP_SECRET = process.env.ERP_API_SECRET || process.env.ERP_SECRET;
const ERP_TOKEN = process.env.ERP_TOKEN;

function resolveAuthHeader() {
  if (ERP_KEY && ERP_SECRET) {
    return `token ${ERP_KEY}:${ERP_SECRET}`;
  }
  if (ERP_TOKEN) {
    return `token ${ERP_TOKEN}`;
  }
  return null;
}

const authHeader = resolveAuthHeader();

const client = axios.create({
  baseURL: ERP_BASE_URL,
  headers: authHeader ? { Authorization: authHeader } : {},
  timeout: 5000
});

// Hinweis: Das Feld "portal_status" muss in ERPNext als Select (Werte siehe workflows.js) am Purchase Order angelegt werden,
// damit Statusupdates später bidirektional möglich sind.

const RESOURCE_FILE_MAP = {
  customers: 'customers.json',
  addresses: 'addresses.json',
  contacts: 'contacts.json',
  items: 'items.json',
  orders: 'purchase_orders.json',
  item_prices: 'item_prices.json'
};

// ERPNext erwartet den DocType-Namen (z. B. "Item") statt unserer internen Schlüssel.
const RESOURCE_DOC_MAP = {
  customers: 'Customer',
  addresses: 'Address',
  contacts: 'Contact',
  items: 'Item',
  orders: 'Purchase Order',
  item_prices: 'Item Price'
};

const RESOURCE_FIELD_MAP = {
  customers: ['*'],
  addresses: ['*'],
  contacts: ['*'],
  item_prices: ['name', 'item_code', 'price_list', 'price_list_rate', 'currency', 'selling', 'buying']
};

const DETAIL_DOC_TYPES = new Set(['Item', 'Purchase Order', 'Address', 'Contact']);
const DETAIL_DOC_FIELDS = {
  Item: ['*'],
  'Purchase Order': ['*'],
  Address: ['*'],
  Contact: ['*']
};

async function fetchDocList(docType, fields = ['name']) {
  const params = {
    limit_page_length: 0,
    as_dict: 1
  };
  if (fields?.length) {
    params.fields = JSON.stringify(fields);
  }
  const { data } = await client.get(`/resource/${encodeURIComponent(docType)}`, {
    params
  });
  return data.data || data || [];
}

async function fetchDoc(docType, name) {
  const params = {
    fields: JSON.stringify(DETAIL_DOC_FIELDS[docType] || ['*']),
    expand: 1
  };
  const { data } = await client.get(`/resource/${encodeURIComponent(docType)}/${encodeURIComponent(name)}`, {
    params
  });
  return data.data || data;
}

async function fetchDocsIndividually(docType, names = [], chunkSize = 5) {
  const docs = [];
  for (let i = 0; i < names.length; i += chunkSize) {
    const chunk = names.slice(i, i + chunkSize);
    const chunkDocs = await Promise.all(chunk.map((name) => fetchDoc(docType, name)));
    docs.push(...chunkDocs);
  }
  return docs;
}

async function fetchResource(resource) {
  const docType = RESOURCE_DOC_MAP[resource] || resource;
  try {
    if (DETAIL_DOC_TYPES.has(docType)) {
      const list = await fetchDocList(docType, ['name']);
      const names = list.map((entry) => entry?.name).filter(Boolean);
      if (!names.length) return [];
      return await fetchDocsIndividually(docType, names);
    }
    const rows = await fetchDocList(docType, RESOURCE_FIELD_MAP[resource] || ['*']);
    return rows;
  } catch (err) {
    // Offline-Fallback liest lokale JSON-Daten
    const fallbackFile = RESOURCE_FILE_MAP[resource];
    if (!fallbackFile) throw err;
    return (await readJson(fallbackFile, [])) || [];
  }
}

async function fetchPurchaseOrders() {
  return fetchResource('orders');
}

async function updatePortalStatus(orderId, portalStatus) {
  if (!orderId) return false;
  try {
    await client.put(`/resource/Purchase Order/${encodeURIComponent(orderId)}`, {
      portal_status: portalStatus
    });
    return true;
  } catch (err) {
    err.message = `ERP Update für ${orderId} fehlgeschlagen: ${err.message}`;
    throw err;
  }
}

module.exports = {
  client,
  fetchResource,
  fetchPurchaseOrders,
  updatePortalStatus
};
