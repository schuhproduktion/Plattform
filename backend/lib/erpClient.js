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

const ERP_CLIENT_ENABLED = Boolean((process.env.ERP_URL || process.env.ERP_BASE_URL) && (ERP_KEY || ERP_SECRET || ERP_TOKEN));

// Hinweis: Das Feld "portal_status" muss in ERPNext als Select (Werte siehe workflows.js) am Purchase Order angelegt werden,
// damit Statusupdates später bidirektional möglich sind.

const RESOURCE_FILE_MAP = {
  customers: 'customers.json',
  addresses: 'addresses.json',
  contacts: 'contacts.json',
  items: 'items.json',
  orders: 'purchase_orders.json',
  sales_orders: 'sales_orders.json',
  item_prices: 'item_prices.json',
  suppliers: 'suppliers.json'
};

// ERPNext erwartet den DocType-Namen (z. B. "Item") statt unserer internen Schlüssel.
const RESOURCE_DOC_MAP = {
  customers: 'Customer',
  addresses: 'Address',
  contacts: 'Contact',
  items: 'Item',
  orders: 'Purchase Order',
  sales_orders: 'Sales Order',
  item_prices: 'Item Price',
  suppliers: 'Supplier'
};

const RESOURCE_FIELD_MAP = {
  customers: ['*'],
  addresses: ['*'],
  contacts: ['*'],
  item_prices: ['name', 'item_code', 'price_list', 'price_list_rate', 'currency', 'selling', 'buying']
};

const DETAIL_DOC_TYPES = new Set(['Item', 'Purchase Order', 'Sales Order', 'Address', 'Contact', 'Supplier']);
const DETAIL_DOC_FIELDS = {
  Item: ['*'],
  'Purchase Order': ['*'],
  'Sales Order': ['*'],
  Address: ['*'],
  Contact: ['*'],
  Supplier: ['*']
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

async function fetchSalesOrders() {
  return fetchResource('sales_orders');
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

async function updateSalesPortalStatus(orderId, portalStatus) {
  if (!orderId) return false;
  try {
    await client.put(`/resource/Sales Order/${encodeURIComponent(orderId)}`, {
      portal_status: portalStatus
    });
    return true;
  } catch (err) {
    err.message = `ERP Sales Order Update für ${orderId} fehlgeschlagen: ${err.message}`;
    throw err;
  }
}

async function createPurchaseOrder(doc) {
  if (!doc || typeof doc !== 'object') {
    throw new Error('Purchase Order Payload fehlt');
  }
  const { data } = await client.post('/resource/Purchase Order', doc);
  return data.data || data;
}

async function createCustomer(doc) {
  if (!doc || typeof doc !== 'object') {
    throw new Error('Customer Payload fehlt');
  }
  const { data } = await client.post('/resource/Customer', doc);
  return data.data || data;
}

async function createAddress(doc) {
  if (!doc || typeof doc !== 'object') {
    throw new Error('Address Payload fehlt');
  }
  const { data } = await client.post('/resource/Address', doc);
  return data.data || data;
}

async function createContact(doc) {
  if (!doc || typeof doc !== 'object') {
    throw new Error('Contact Payload fehlt');
  }
  const { data } = await client.post('/resource/Contact', doc);
  return data.data || data;
}

async function createItem(doc) {
  if (!doc || typeof doc !== 'object') {
    throw new Error('Item Payload fehlt');
  }
  const { data } = await client.post('/resource/Item', doc);
  return data.data || data;
}

async function updateCustomer(name, doc) {
  if (!name) throw new Error('Customer ID fehlt');
  if (!doc || typeof doc !== 'object') {
    throw new Error('Customer Payload fehlt');
  }
  const { data } = await client.put(`/resource/Customer/${encodeURIComponent(name)}`, doc);
  return data.data || data;
}

async function updateAddress(name, doc) {
  if (!name) throw new Error('Address ID fehlt');
  if (!doc || typeof doc !== 'object') {
    throw new Error('Address Payload fehlt');
  }
  const { data } = await client.put(`/resource/Address/${encodeURIComponent(name)}`, doc);
  return data.data || data;
}

async function updateContact(name, doc) {
  if (!name) throw new Error('Contact ID fehlt');
  if (!doc || typeof doc !== 'object') {
    throw new Error('Contact Payload fehlt');
  }
  const { data } = await client.put(`/resource/Contact/${encodeURIComponent(name)}`, doc);
  return data.data || data;
}

async function updateItem(name, doc) {
  if (!name) throw new Error('Item ID fehlt');
  if (!doc || typeof doc !== 'object') {
    throw new Error('Item Payload fehlt');
  }
  const { data } = await client.put(`/resource/Item/${encodeURIComponent(name)}`, doc);
  return data.data || data;
}

async function updatePurchaseOrder(name, doc) {
  if (!name) throw new Error('Purchase Order ID fehlt');
  if (!doc || typeof doc !== 'object') throw new Error('Purchase Order Payload fehlt');
  const { data } = await client.put(`/resource/Purchase Order/${encodeURIComponent(name)}`, doc);
  return data.data || data;
}

async function createSalesOrder(doc) {
  if (!doc || typeof doc !== 'object') {
    throw new Error('Sales Order Payload fehlt');
  }
  const { data } = await client.post('/resource/Sales Order', doc);
  return data.data || data;
}

async function updateSalesOrder(name, doc) {
  if (!name) throw new Error('Sales Order ID fehlt');
  if (!doc || typeof doc !== 'object') throw new Error('Sales Order Payload fehlt');
  const { data } = await client.put(`/resource/Sales Order/${encodeURIComponent(name)}`, doc);
  return data.data || data;
}

async function fetchPrintFormats(docType = 'Purchase Order') {
  if (!ERP_CLIENT_ENABLED) {
    throw new Error('ERP Print-Service ist nicht konfiguriert.');
  }
  const params = {
    limit_page_length: 0,
    fields: JSON.stringify(['name', 'doc_type', 'disabled', 'print_format_type']),
    filters: JSON.stringify([
      ['doc_type', '=', docType],
      ['disabled', '=', 0]
    ])
  };
  const { data } = await client.get('/resource/Print Format', { params });
  return (data.data || data || [])
    .filter((entry) => entry.doc_type === docType && entry.disabled !== 1)
    .map((entry) => ({
      value: entry.name,
      label: entry.name,
      print_format_type: entry.print_format_type || null
    }));
}

async function fetchLetterheads() {
  if (!ERP_CLIENT_ENABLED) {
    throw new Error('ERP Print-Service ist nicht konfiguriert.');
  }
  const params = {
    limit_page_length: 0,
    fields: JSON.stringify(['name', 'disabled']),
    filters: JSON.stringify([['disabled', '=', 0]])
  };
  const { data } = await client.get('/resource/Letter Head', { params });
  return (data.data || data || [])
    .filter((entry) => entry.disabled !== 1)
    .map((entry) => ({
      value: entry.name,
      label: entry.name
    }));
}

async function downloadPrintPdf(docType, docName, { format, letterhead, language } = {}) {
  if (!ERP_CLIENT_ENABLED) {
    throw new Error('ERP Print-Service ist nicht konfiguriert.');
  }
  const params = new URLSearchParams();
  params.set('doctype', docType);
  params.set('name', docName);
  if (format) {
    params.set('format', format);
  }
  if (language) {
    params.set('_lang', language);
  }
  if (letterhead) {
    params.set('letterhead', letterhead);
  } else {
    params.set('no_letterhead', '1');
  }
  params.set('settings', JSON.stringify({}));
  const response = await client.get('/method/frappe.utils.print_format.download_pdf', {
    params,
    responseType: 'arraybuffer'
  });
  return response.data;
}

function isErpClientEnabled() {
  return ERP_CLIENT_ENABLED;
}

module.exports = {
  client,
  fetchResource,
  fetchPurchaseOrders,
  fetchSalesOrders,
  updatePortalStatus,
  updateSalesPortalStatus,
  createPurchaseOrder,
  createCustomer,
  createAddress,
  createContact,
  createItem,
  updateCustomer,
  updateAddress,
  updateContact,
  updateItem,
  createSalesOrder,
  updatePurchaseOrder,
  updateSalesOrder,
  fetchPrintFormats,
  fetchLetterheads,
  downloadPrintPdf,
  isErpClientEnabled
};
