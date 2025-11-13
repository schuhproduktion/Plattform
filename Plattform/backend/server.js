require('dotenv').config();

const path = require('path');
const fs = require('fs/promises');
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const cron = require('node-cron');
const { randomUUID } = require('crypto');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const multer = require('multer');
const axios = require('axios');

const { authenticate, requireAuth, requireBate } = require('./lib/auth');
const { upload, UPLOAD_ROOT } = require('./lib/files');
const { getWorkflowDefinition, normalizePortalOrder, updateOrderWorkflow, getStatusLabel } = require('./lib/workflows');
const { syncERPData } = require('./lib/sync');
const {
  createPurchaseOrder,
  updatePurchaseOrder,
  fetchPrintFormats,
  fetchLetterheads,
  downloadPrintPdf,
  isErpClientEnabled
} = require('./lib/erpClient');
const { readJson, writeJson, appendToArray } = require('./lib/dataStore');
const { listLocales: listTranslationLocales, getLocaleEntries, upsertTranslation, deleteTranslation } = require('./lib/translations');
const autosyncClient = require('./lib/autosyncClient');

const TECHPACK_VIEWS = [
  { key: 'front', label: 'Vorderansicht' },
  { key: 'rear', label: 'Rückansicht' },
  { key: 'side', label: 'Seitenansicht' },
  { key: 'inner', label: 'Innenansicht' },
  { key: 'top', label: 'Draufsicht' },
  { key: 'bottom', label: 'Unteransicht' },
  { key: 'sole', label: 'Sohle' },
  { key: 'tongue', label: 'Zunge' }
];
const TECHPACK_VIEWER_PRESETS = [
  { key: 'side', label: 'Seitenansicht', frame: '0001' },
  { key: 'front', label: 'Vorderansicht', frame: '0010' },
  { key: 'inner', label: 'Innenansicht', frame: '0019' },
  { key: 'rear', label: 'Rückansicht', frame: '0028' }
];
const TECHPACK_VIEW_KEYS = new Set(TECHPACK_VIEWS.map((view) => view.key));
const PLACEHOLDER_MEDIA_PREFIX = 'placeholder-';
const TECHPACK_PLACEHOLDER_IMAGES = {
  front: '/images/techpack-placeholders/front.png',
  rear: '/images/techpack-placeholders/rear.png',
  side: '/images/techpack-placeholders/side.png',
  inner: '/images/techpack-placeholders/inner.png',
  top: '/images/techpack-placeholders/top.png',
  bottom: '/images/techpack-placeholders/bottom.png',
  sole: '/images/techpack-placeholders/sole.png',
  tongue: '/images/techpack-placeholders/Zunge.png'
};
const TECHPACK_MEDIA_STATUSES = new Set(['OPEN', 'OK']);
const ACCESSORY_SLOTS = [
  { key: 'shoe_box', label: 'Schuhbox', description: 'Primäre Schuhbox mit Branding.' },
  { key: 'tissue_paper', label: 'Seidenpapier', description: 'Innenliegendes Papier für jedes Paar.' },
  { key: 'dust_bag', label: 'Stoffbeutel', description: 'Beutel oder Sleeves für Auslieferung.' }
];
const ACCESSORY_SLOT_MAP = ACCESSORY_SLOTS.reduce((acc, slot) => {
  acc[slot.key] = slot;
  return acc;
}, {});
const ACCESSORY_SLOT_KEYS = new Set(ACCESSORY_SLOTS.map((slot) => slot.key));
const WORKFLOW_META = getWorkflowDefinition();
const PORTAL_STATUS_SET = new Set(WORKFLOW_META.statuses);
const STATUS_ICON_MAP = {
  ORDER_EINGEREICHT: '🔵',
  ORDER_BESTAETIGT: '🟡',
  RUECKFRAGEN_OFFEN: '🟠',
  RUECKFRAGEN_GEKLAERT: '🟠',
  PRODUKTION_LAEUFT: '🟢',
  WARE_ABHOLBEREIT: '🟣',
  UEBERGEBEN_AN_SPEDITION: '⚪'
};
const ERP_STATUS_LABEL_MAP = {
  ORDER_EINGEREICHT: 'Eingereicht',
  ORDER_BESTAETIGT: 'Bestätigt',
  RUECKFRAGEN_OFFEN: 'Rückfragen',
  RUECKFRAGEN_GEKLAERT: 'Rückfragen',
  PRODUKTION_LAEUFT: 'Produktion',
  WARE_ABHOLBEREIT: 'Versandbereit',
  UEBERGEBEN_AN_SPEDITION: 'Abgeschlossen'
};
const SUPPLIER_DISCUSSION_STATUSES = new Set(['ORDER_BESTAETIGT', 'RUECKFRAGEN_OFFEN']);
const ORDER_TYPE_CHOICES = new Set(['MUSTER', 'SMS', 'PPS', 'BESTELLUNG']);
const ORDER_TYPE_LABELS = {
  MUSTER: 'Muster',
  SMS: 'SMS',
  PPS: 'PPS',
  BESTELLUNG: 'Bestellung'
};
const PACKAGING_TYPES = new Set(['carton', 'shoebox']);
const CM_TO_PT = 28.3464567;
const SHOEBOX_LABEL_SIZE = [CM_TO_PT * 8.5, CM_TO_PT * 6];
const COMPLETED_ORDER_STATUSES = new Set(['WARE_ABHOLBEREIT', 'UEBERGEBEN_AN_SPEDITION']);
const ERP_DEFAULT_SUPPLIER = process.env.ERP_SUPPLIER_ID || null;
const ERP_DEFAULT_SUPPLIER_NAME = process.env.ERP_SUPPLIER_NAME || ERP_DEFAULT_SUPPLIER;
const ERP_DEFAULT_COMPANY = process.env.ERP_COMPANY || 'BATE GmbH';
const ERP_DEFAULT_CURRENCY = process.env.ERP_CURRENCY || 'EUR';
const ERP_DEFAULT_PRICE_LIST = process.env.ERP_PRICE_LIST || 'Standard-Einkauf';
const ERP_DEFAULT_SERIES = process.env.ERP_PURCHASE_ORDER_SERIES || 'BT-B.YY.#####';
const ERP_DEFAULT_WAREHOUSE = process.env.ERP_DEFAULT_WAREHOUSE || null;
const ERP_DEFAULT_TAX_TEMPLATE = process.env.ERP_TAX_TEMPLATE || null;

const app = express();
const PORT = process.env.PORT || 8080;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_me';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SYNC_CRON = process.env.SYNC_INTERVAL_CRON || '*/10 * * * *';

const SUPPORTED_LOCALES = ['de', 'tr'];
const DEFAULT_LOCALE = 'de';
const LOCALE_LABELS = {
  de: 'Deutsch',
  tr: 'Türkçe'
};

const PROFORMA_STORE_FILE = 'proforma_invoices.json';
const PROFORMA_SEQUENCE_BASE = 34338;
const PROFORMA_UNIT_LABELS = {
  PAIR: 'Paar',
  LEFT_SHOE: 'Linker Schuh',
  RIGHT_SHOE: 'Rechter Schuh'
};
const PDF_TEXT_SANITIZER = /[\u0300-\u036f]/g;
const SEASON_DIGIT_MAP = {
  FS: '1',
  HW: '2'
};
const EAN_PARITY_TABLE = [
  ['L', 'L', 'L', 'L', 'L', 'L'],
  ['L', 'L', 'G', 'L', 'G', 'G'],
  ['L', 'L', 'G', 'G', 'L', 'G'],
  ['L', 'L', 'G', 'G', 'G', 'L'],
  ['L', 'G', 'L', 'L', 'G', 'G'],
  ['L', 'G', 'G', 'L', 'L', 'G'],
  ['L', 'G', 'G', 'G', 'L', 'L'],
  ['L', 'G', 'L', 'G', 'L', 'G'],
  ['L', 'G', 'L', 'G', 'G', 'L'],
  ['L', 'G', 'G', 'L', 'G', 'L']
];
const EAN_L_CODES = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_G_CODES = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN_R_CODES = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];

function sanitizePdfText(value) {
  if (value === null || value === undefined) return '';
  return value
    .toString()
    .replace(/\u0131/g, 'i')
    .replace(/\u0130/g, 'I')
    .normalize('NFD')
    .replace(PDF_TEXT_SANITIZER, '');
}

const translations = {
  de: {
    unauthorized: 'Nicht angemeldet',
    forbidden: 'Keine Berechtigung',
    invalidLocale: 'Ungültige Sprache'
  },
  tr: {
    unauthorized: 'Giriş yapılmadı',
    forbidden: 'İzniniz yok',
    invalidLocale: 'Geçersiz dil'
  }
};

function resolveLocale(value) {
  if (!value) return DEFAULT_LOCALE;
  const lowercase = value.toString().toLowerCase();
  return SUPPORTED_LOCALES.includes(lowercase) ? lowercase : DEFAULT_LOCALE;
}

function t(locale, key) {
  const resolved = resolveLocale(locale);
  return translations[resolved]?.[key] || translations[DEFAULT_LOCALE]?.[key] || key;
}

const cspDirectives = {
  ...helmet.contentSecurityPolicy.getDefaultDirectives(),
  'img-src': ["'self'", 'data:', 'https://360.schuhproduktion.com'],
  'script-src': ["'self'", 'blob:']
};

app.use(
  helmet({
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: {
      directives: cspDirectives
    }
  })
);
app.use(cors({
  origin: BASE_URL,
  credentials: true
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 60 * 60 * 1000
    }
  })
);

app.use((req, res, next) => {
  const locale = resolveLocale(req.session?.user?.locale || req.session?.locale || DEFAULT_LOCALE);
  req.locale = locale;
  req.t = (key) => t(locale, key);
  next();
});

const publicDir = path.join(__dirname, '..', 'frontend', 'public');
app.use('/uploads', express.static(UPLOAD_ROOT));
const ticketStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const dest = path.join(UPLOAD_ROOT, 'tickets', req.params.id || 'misc');
      await fs.mkdir(dest, { recursive: true });
      cb(null, dest);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname?.replace(/[^a-zA-Z0-9.\-_]/g, '_') || 'upload';
    const ext = path.extname(safeName);
    const base = path.basename(safeName, ext);
    cb(null, `${base}-${Date.now()}-${randomUUID()}${ext}`);
  }
});

const ticketUpload = multer({
  storage: ticketStorage,
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});
const accessoriesStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const customerId = req.params.id || 'misc';
      const dest = path.join(UPLOAD_ROOT, 'customers', customerId, 'accessories');
      await fs.mkdir(dest, { recursive: true });
      cb(null, dest);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname?.replace(/[^a-zA-Z0-9.\-_]/g, '_') || 'accessory';
    const ext = path.extname(safeName);
    const base = path.basename(safeName, ext);
    cb(null, `${base}-${Date.now()}-${randomUUID()}${ext}`);
  }
});

const accessoriesUpload = multer({
  storage: accessoriesStorage,
  limits: {
    fileSize: 15 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype?.startsWith('image/')) {
      return cb(new Error('Nur Bilddateien erlaubt'));
    }
    cb(null, true);
  }
});

app.get('/', (req, res) => {
  if (req.session?.user) {
    return res.redirect('/dashboard.html');
  }
  return res.redirect('/login.html');
});
app.use(express.static(publicDir));

async function ensureUploads() {
  await fs.mkdir(UPLOAD_ROOT, { recursive: true });
}
ensureUploads();

function respondError(res, statusCode, message) {
  return res.status(statusCode).json({ error: message });
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function extractErpErrorMessage(err) {
  const data = err?.response?.data;
  if (!data) return null;
  if (typeof data === 'string') return data;
  if (data.message) return data.message;
  if (data.exception) return data.exception;
  if (data._server_messages) {
    try {
      const parsed = JSON.parse(data._server_messages);
      if (Array.isArray(parsed) && parsed.length) {
        const cleaned = parsed
          .map((entry) => {
            if (!entry) return null;
            try {
              const inner = JSON.parse(entry);
              if (inner?.message) return inner.message;
              if (typeof inner === 'string') return inner;
            } catch {
              return entry;
            }
            return null;
          })
          .filter(Boolean);
        if (cleaned.length) {
          return cleaned.join(' ');
        }
      }
    } catch (parseErr) {
      return parseErr.message;
    }
  }
  return null;
}

function normalizeAutoSyncLog(entry = {}) {
  if (!entry || typeof entry !== 'object') {
    return {
      sku: null,
      timestamp: null,
      erp_ok: false,
      woo_ok: false,
      telegram_ok: false
    };
  }
  const timestamp = entry.timestamp || entry.time || entry.ts || null;
  return {
    ...entry,
    timestamp,
    sku: entry.sku || entry.article_number || entry.code || null,
    erp_ok: Boolean(entry.erp_ok),
    woo_ok: Boolean(entry.woo_ok),
    telegram_ok: entry.telegram_ok === undefined ? null : Boolean(entry.telegram_ok)
  };
}

function computeAutoSyncStats(rawLogs = []) {
  const logs = rawLogs.map((entry) => normalizeAutoSyncLog(entry));
  const total = logs.length;
  let success = 0;
  let telegramSuccess = 0;
  let erpFailures = 0;
  let wooFailures = 0;
  let lastSuccess = null;
  let lastFailure = null;
  const failures = [];

  for (const entry of logs) {
    const ok = entry.erp_ok && entry.woo_ok;
    if (ok) {
      success += 1;
      if (!lastSuccess) {
        lastSuccess = entry;
      }
    } else {
      if (!lastFailure) {
        lastFailure = entry;
      }
      failures.push(entry);
      if (!entry.erp_ok) erpFailures += 1;
      if (!entry.woo_ok) wooFailures += 1;
    }
    if (entry.telegram_ok) {
      telegramSuccess += 1;
    }
  }

  return {
    total,
    success,
    failures: Math.max(0, total - success),
    success_rate: total ? Math.round((success / total) * 100) : null,
    last_run: logs[0]?.timestamp || null,
    last_success: lastSuccess?.timestamp || null,
    last_failure: lastFailure?.timestamp || null,
    erp_failures: erpFailures,
    woo_failures: wooFailures,
    telegram_success: telegramSuccess,
    recent_errors: failures.slice(0, 5)
  };
}

async function getAutoSyncSnapshot({ limit = 25, sku = null } = {}) {
  if (!autosyncClient.isEnabled()) {
    return {
      enabled: false,
      online: false,
      message: 'AutoSync-Service nicht konfiguriert.',
      logs: [],
      stats: null
    };
  }

  const health = await autosyncClient.getHealth();
  let logsPayload = null;
  let logsError = null;
  try {
    logsPayload = sku
      ? await autosyncClient.fetchSkuLogs(sku, { limit })
      : await autosyncClient.fetchLatestLogs(limit);
  } catch (err) {
    logsPayload = { entries: [] };
    logsError = err.message;
  }

  const logsRaw = logsPayload?.entries || logsPayload?.logs || [];
  const logs = logsRaw.map((entry) => normalizeAutoSyncLog(entry));
  const stats = computeAutoSyncStats(logs);

  return {
    ...health,
    logs,
    stats,
    logs_error: logsError || logsPayload?.error || null,
    sku: sku || null
  };
}

function ensureAutoSyncConfigured(res) {
  if (!autosyncClient.isEnabled()) {
    respondError(res, 503, 'AutoSync-Service ist nicht konfiguriert.');
    return false;
  }
  return true;
}

async function loadOrders() {
  const orders = (await readJson('purchase_orders.json', [])) || [];
  return orders.map((order) => normalizePortalOrder(order));
}

async function loadItemsData() {
  return (await readJson('items.json', [])) || [];
}

async function loadSpecs() {
  return (await readJson('spec_sheets.json', [])) || [];
}

async function saveSpecs(specs) {
  return writeJson('spec_sheets.json', specs);
}

async function loadCustomersData() {
  return (await readJson('customers.json', [])) || [];
}

async function loadAddressesData() {
  return (await readJson('addresses.json', [])) || [];
}

async function loadContactsData() {
  return (await readJson('contacts.json', [])) || [];
}

async function loadCustomerAccessoriesData() {
  return (await readJson('customer_accessories.json', [])) || [];
}

async function saveCustomerAccessoriesData(entries) {
  return writeJson('customer_accessories.json', entries);
}

function findCustomerAccessoryEntry(store, customerId) {
  return store.find((entry) => entry.customer_id === customerId);
}

async function loadCustomerPackagingData() {
  return (await readJson('customer_packaging.json', [])) || [];
}

async function saveCustomerPackagingData(entries) {
  return writeJson('customer_packaging.json', entries);
}

function findCustomerPackagingEntry(store, customerId, type) {
  return store.find((entry) => entry.customer_id === customerId && entry.type === type);
}

async function appendOrderTimelineEntry(orderId, entry, logAction = null, actorId = null) {
  if (!orderId || !entry) return null;
  const orders = await loadOrders();
  const idx = orders.findIndex((order) => order.id === orderId);
  if (idx === -1) return null;
  const order = orders[idx];
  order.timeline = Array.isArray(order.timeline) ? order.timeline : [];
  order.timeline.push(entry);
  orders[idx] = order;
  await writeJson('purchase_orders.json', orders);
  if (logAction) {
    await appendToArray('status_logs.json', {
      id: `LOG-${randomUUID()}`,
      order_id: orderId,
      action: logAction,
      actor: actorId || 'system',
      ts: entry.created_at
    });
  }
  return order;
}

function buildPortalTimelineEntry(type, message, actor, label = null) {
  let statusLabel = label;
  if (!statusLabel) {
    if (type === 'ORDER_CREATED') {
      statusLabel = 'Portal: erstellt';
    } else if (type === 'ORDER_UPDATED') {
      statusLabel = 'Portal: aktualisiert';
    } else {
      statusLabel = 'Portal';
    }
  }
  return {
    id: `tl-${randomUUID()}`,
    type,
    status_label: statusLabel,
    message,
    actor: actor || 'system',
    created_at: new Date().toISOString()
  };
}

function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['1', 'true', 'yes', 'ja'].includes(normalized);
  }
  return false;
}

function normalizeOrderTypeInput(value) {
  if (!value) return 'BESTELLUNG';
  const normalized = value.toString().trim().toUpperCase();
  if (!normalized) return 'BESTELLUNG';
  if (ORDER_TYPE_CHOICES.has(normalized)) return normalized;
  if (normalized.includes('MUSTER')) return 'MUSTER';
  if (normalized.includes('SMS')) return 'SMS';
  if (normalized.includes('PPS')) return 'PPS';
  return 'BESTELLUNG';
}

function formatOrderTypeLabel(value) {
  const normalized = normalizeOrderTypeInput(value);
  return ORDER_TYPE_LABELS[normalized] || ORDER_TYPE_LABELS.BESTELLUNG;
}

function ensurePortalStatus(value) {
  const normalized = value ? value.toString().trim().toUpperCase() : '';
  if (normalized && PORTAL_STATUS_SET.has(normalized)) {
    return normalized;
  }
  return 'ORDER_EINGEREICHT';
}

function toErpDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  const str = value.toString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : null;
}

function sanitizeSizeBreakdown(map) {
  if (!map || typeof map !== 'object') return {};
  return Object.entries(map).reduce((acc, [size, raw]) => {
    const key = sanitizeText(size);
    if (!key) return acc;
    if (raw === '' || raw === null || raw === undefined) return acc;
    const amount = Number(raw);
    if (Number.isNaN(amount)) return acc;
    acc[key] = amount;
    return acc;
  }, {});
}

function serializeSizeBreakdown(sizeBreakdown = {}) {
  const entries = Object.entries(sizeBreakdown);
  if (!entries.length) return {};
  const jsonPayload = {};
  const displayParts = [];
  entries.forEach(([size, amount]) => {
    const sanitizedSize = size.toString().trim();
    if (!sanitizedSize) return;
    const numeric = Number(amount) || 0;
    const key = sanitizedSize.replace(/[^0-9A-Za-z]/g, '_') || sanitizedSize;
    jsonPayload[`amount_${key}`] = numeric;
    displayParts.push(`${sanitizedSize}: ${numeric}`);
  });
  if (!Object.keys(jsonPayload).length) return {};
  return {
    sizes: JSON.stringify(jsonPayload),
    sizes_display: displayParts.join(' | ')
  };
}

function compactObject(obj = {}) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== null)
  );
}

function formatCustomStatus(status) {
  const base = ERP_STATUS_LABEL_MAP[status] || getStatusLabel(status) || status;
  const icon = STATUS_ICON_MAP[status];
  return icon ? `${icon} ${base}` : base;
}

async function resolveSupplierMeta(explicitId, explicitName, existingOrders = null) {
  if (explicitId) {
    return {
      id: explicitId,
      name: explicitName || explicitId
    };
  }
  if (ERP_DEFAULT_SUPPLIER) {
    return {
      id: ERP_DEFAULT_SUPPLIER,
      name: ERP_DEFAULT_SUPPLIER_NAME || ERP_DEFAULT_SUPPLIER
    };
  }
  const source = existingOrders || (await loadOrders());
  const reference = source.find((entry) => entry.supplier_id);
  if (reference) {
    return {
      id: reference.supplier_id,
      name: reference.supplier_name || reference.supplier_id
    };
  }
  throw createHttpError(500, 'Kein Lieferant konfiguriert');
}

function sanitizePositions(rawPositions, requestedDelivery) {
  if (!Array.isArray(rawPositions)) return [];
  const sanitized = [];
  rawPositions.forEach((position) => {
    const itemCode = sanitizeText(position?.item_code);
    const quantity = Number(position?.quantity);
    if (!itemCode || !Number.isFinite(quantity) || quantity <= 0) {
      return;
    }
    const sanitizedPosition = {
      item_code: itemCode,
      description: sanitizeText(position?.description) || itemCode,
      color_code: sanitizeText(position?.color_code),
      quantity,
      rate: Number(position?.rate) || 0,
      amount:
        typeof position?.amount === 'number'
          ? position.amount
          : position?.amount
          ? Number(position.amount)
          : null,
      uom: sanitizeText(position?.uom),
      warehouse: sanitizeText(position?.warehouse),
      supplier_part_no: sanitizeText(position?.supplier_part_no),
      brand: sanitizeText(position?.brand),
      schedule_date: toErpDate(position?.schedule_date) || requestedDelivery,
      size_breakdown: sanitizeSizeBreakdown(position?.size_breakdown || {})
    };
    sanitized.push(sanitizedPosition);
  });
  return sanitized;
}

function buildErpItems(positions = [], requestedDelivery) {
  return positions.map((position, index) => {
    const qty = Number(position.quantity) || 0;
    const rate = Number(position.rate) || 0;
    const totalAmount = typeof position.amount === 'number' ? position.amount : qty * rate;
    const sizeFields = serializeSizeBreakdown(position.size_breakdown);
    return compactObject({
      doctype: 'Purchase Order Item',
      idx: index + 1,
      item_code: position.item_code,
      item_name: position.description || position.item_code,
      description: position.description || position.item_code,
      qty,
      uom: position.uom || undefined,
      stock_uom: position.uom || undefined,
      schedule_date: position.schedule_date || requestedDelivery,
      rate,
      amount: totalAmount,
      base_rate: rate,
      base_amount: totalAmount,
      warehouse: position.warehouse || undefined,
      brand: position.brand || undefined,
      zusammenstellung: position.color_code || undefined,
      color_code: position.color_code || undefined,
      supplier_part_no: position.supplier_part_no || undefined,
      ...sizeFields
    });
  });
}

async function buildErpPurchaseOrderDoc(payload, options = {}) {
  const requestedDelivery = toErpDate(payload.requested_delivery);
  if (!requestedDelivery) {
    throw createHttpError(400, 'Lieferdatum fehlt oder ist ungültig');
  }
  const [customers, addresses, contacts] = await Promise.all([
    loadCustomersData(),
    loadAddressesData(),
    loadContactsData()
  ]);
  const customer = customers.find((entry) => entry.id === payload.customer_id);
  if (!customer) {
    throw createHttpError(400, 'Kunde wurde nicht gefunden');
  }
  const billingAddress = addresses.find((entry) => entry.id === payload.billing_address_id);
  if (!billingAddress) {
    throw createHttpError(400, 'Rechnungsadresse wurde nicht gefunden');
  }
  const shippingAddress = addresses.find((entry) => entry.id === payload.shipping_address_id);
  if (!shippingAddress) {
    throw createHttpError(400, 'Lieferadresse wurde nicht gefunden');
  }
  const dispatchAddress = addresses.find((entry) => entry.id === payload.dispatch_address_id);
  if (!dispatchAddress) {
    throw createHttpError(400, 'Absenderadresse wurde nicht gefunden');
  }
  const contact = payload.contact_id ? contacts.find((entry) => entry.id === payload.contact_id) : null;
  const contactLinks = Array.isArray(contact?.links) ? contact.links : [];
  const contactBelongsToParty = contactLinks.some((link) => {
    if (!link?.link_doctype || !link?.link_name) return false;
    if (link.link_doctype === 'Company' && link.link_name === (payload.company || ERP_DEFAULT_COMPANY)) {
      return true;
    }
    if (link.link_doctype === 'Supplier' && link.link_name === supplierMeta.id) {
      return true;
    }
    return false;
  });
  const contactPersonId = contactBelongsToParty ? contact?.id : undefined;
  const supplierMeta = await resolveSupplierMeta(payload.supplier_id, payload.supplier_name, payload.existingOrders);
  const items = buildErpItems(payload.positions, requestedDelivery);
  if (!items.length) {
    throw createHttpError(400, 'Mindestens eine gültige Position wird benötigt');
  }
  const transactionDate = toErpDate(payload.transaction_date) || toErpDate(new Date());
  const orderTypeLabel = formatOrderTypeLabel(payload.order_type);
  const doc = compactObject({
    doctype: 'Purchase Order',
    name: payload.order_number || undefined,
    naming_series: payload.order_number ? undefined : payload.naming_series || ERP_DEFAULT_SERIES,
    company: payload.company || ERP_DEFAULT_COMPANY,
    supplier: supplierMeta.id,
    supplier_name: supplierMeta.name,
    transaction_date: transactionDate,
    schedule_date: requestedDelivery,
    order_type: orderTypeLabel,
    custom_c: orderTypeLabel,
    custom_bestellstatus: formatCustomStatus(payload.portal_status),
    portal_status: payload.portal_status,
    currency: payload.currency || ERP_DEFAULT_CURRENCY,
    price_list_currency: payload.currency || ERP_DEFAULT_CURRENCY,
    buying_price_list: ERP_DEFAULT_PRICE_LIST,
    conversion_rate: 1,
    plc_conversion_rate: 1,
    customer: customer.id,
    customer_name: customer.customer_name || customer.name || customer.id,
    custom_kunde: customer.id,
    custom_kunde_name: customer.customer_name || customer.name || customer.id,
    customer_number: payload.customer_number || undefined,
    billing_address: billingAddress.id,
    shipping_address: shippingAddress.id,
    dispatch_address: dispatchAddress.id,
    contact_person: contactPersonId,
    contact_display: contact?.full_name || contact?.name || payload.contact_name || undefined,
    contact_email: payload.contact_email || contact?.email || undefined,
    contact_phone: payload.contact_phone || contact?.phone || undefined,
    shipping_method: payload.shipping_method || 'Spedition',
    incoterm: payload.shipping_payer === 'KUNDE' ? 'EXW' : 'DAP',
    taxes_and_charges: payload.tax_template || undefined,
    set_warehouse: ERP_DEFAULT_WAREHOUSE || undefined,
    custom_versand_bezahlt_von: payload.shipping_payer || undefined,
    custom_transportart: payload.shipping_method || undefined,
    custom_verpackung: payload.shipping_packaging || undefined,
    docstatus: typeof options.docstatus === 'number' ? options.docstatus : undefined,
    items
  });
  doc.items = items;
  return doc;
}

function sanitizeOrderCreatePayload(raw = {}) {
  const requestedDelivery = toErpDate(raw.requested_delivery);
  const sanitized = {
    order_number: sanitizeText(raw.order_number) || null,
    order_type: normalizeOrderTypeInput(raw.order_type),
    requested_delivery: requestedDelivery,
    portal_status: ensurePortalStatus(raw.portal_status),
    customer_id: sanitizeText(raw.customer_id),
    customer_number: sanitizeText(raw.customer_number) || undefined,
    billing_address_id: sanitizeText(raw.billing_address_id),
    shipping_address_id: sanitizeText(raw.shipping_address_id),
    dispatch_address_id: sanitizeText(raw.dispatch_address_id),
    contact_id: sanitizeText(raw.contact_id) || undefined,
    contact_name: sanitizeText(raw.contact_name) || undefined,
    contact_email: sanitizeText(raw.contact_email) || undefined,
    contact_phone: sanitizeText(raw.contact_phone) || undefined,
    shipping_payer: sanitizeText(raw.shipping_payer) || 'BATE',
    shipping_method: sanitizeText(raw.shipping_method) || 'Spedition',
  shipping_packaging: sanitizeText(raw.shipping_packaging) || undefined,
  shipping_pickup: sanitizeBoolean(raw.shipping_pickup),
  supplier_id: sanitizeText(raw.supplier_id) || undefined,
  supplier_name: sanitizeText(raw.supplier_name) || undefined,
  naming_series: sanitizeText(raw.naming_series) || null,
  company: sanitizeText(raw.company) || ERP_DEFAULT_COMPANY,
  tax_template: sanitizeText(raw.tax_template) || ERP_DEFAULT_TAX_TEMPLATE,
  currency: sanitizeText(raw.currency) || ERP_DEFAULT_CURRENCY,
    transaction_date: toErpDate(raw.transaction_date),
    positions: sanitizePositions(raw.positions, requestedDelivery)
  };
  const missing = [];
  if (!sanitized.requested_delivery) missing.push('requested_delivery');
  if (!sanitized.customer_id) missing.push('customer_id');
  if (!sanitized.billing_address_id) missing.push('billing_address_id');
  if (!sanitized.shipping_address_id) missing.push('shipping_address_id');
  if (!sanitized.dispatch_address_id) missing.push('dispatch_address_id');
  if (!sanitized.positions.length) missing.push('positions');
  if (!sanitized.order_number && !sanitized.naming_series) missing.push('naming_series');
  if (!sanitized.company) missing.push('company');
  if (missing.length) {
    throw createHttpError(400, `Felder fehlen oder sind ungültig: ${missing.join(', ')}`);
  }
  return sanitized;
}

function supportsPdfImage(url) {
  if (!url) return false;
  const clean = url.split('?')[0].toLowerCase();
  return clean.endsWith('.png') || clean.endsWith('.jpg') || clean.endsWith('.jpeg');
}

async function fetchImageBuffer(url) {
  if (!url || !supportsPdfImage(url)) return null;
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
    return Buffer.from(response.data);
  } catch {
    return null;
  }
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toStringValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function sanitizeLines(value) {
  if (!value && value !== 0) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => toStringValue(entry)).filter(Boolean);
  }
  return toStringValue(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildStructuredAddressLines(street, postalCode, city, country) {
  const lines = [];
  const safeStreet = toStringValue(street);
  const safePostal = toStringValue(postalCode);
  const safeCity = toStringValue(city);
  const safeCountry = toStringValue(country);
  if (safeStreet) lines.push(safeStreet);
  const cityLine = [safePostal, safeCity].filter(Boolean).join(' ').trim();
  if (cityLine) lines.push(cityLine);
  if (safeCountry) lines.push(safeCountry);
  return sanitizeLines(lines);
}

function collectPartyLines(party, { sanitize = false } = {}) {
  if (!party) return [];
  const lines = [];
  const format = (value) => {
    if (sanitize) return sanitizePdfText(value);
    return toStringValue(value);
  };
  const pushLine = (value) => {
    const formatted = format(value);
    if (formatted) lines.push(formatted);
  };
  const addLabeledLine = (value, label) => {
    const safeValue = toStringValue(value);
    if (!safeValue) return;
    const lowerLabel = label.toLowerCase();
    if (safeValue.toLowerCase().includes(lowerLabel)) {
      pushLine(safeValue);
    } else {
      pushLine(`${label}: ${safeValue}`);
    }
  };
  pushLine(party.name);
  const streetValue = toStringValue(party.street);
  if (streetValue) pushLine(streetValue);
  const cityLine = [party.postalCode, party.city].filter(Boolean).join(' ').trim();
  if (cityLine) pushLine(cityLine);
  const countryValue = toStringValue(party.country);
  if (countryValue) pushLine(countryValue);
  addLabeledLine(party.email, 'E-Mail');
  addLabeledLine(party.website, 'Website');
  addLabeledLine(party.taxId, 'Steuernummer');
  addLabeledLine(party.court, 'Amtsgericht');
  addLabeledLine(party.ceo, 'Geschäftsführer');
  const structuredAddressProvided = Boolean(streetValue || cityLine || countryValue);
  if (!structuredAddressProvided && party.address) {
    sanitizeLines(party.address).forEach((line) => pushLine(line));
  }
  const hasExplicitContact = Boolean(toStringValue(party.email) || toStringValue(party.website));
  if (!hasExplicitContact && party.contact) {
    pushLine(party.contact);
  }
  return lines.filter(Boolean);
}

function formatCurrencyValue(amount, currency = 'EUR') {
  if (!Number.isFinite(amount)) return '-';
  try {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function formatDateLabel(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '-';
  try {
    return new Intl.DateTimeFormat('de-DE').format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function sanitizeDigits(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\D+/g, '');
}

function formatArticleDigits(value) {
  const digits = sanitizeDigits(value);
  if (!digits) return '0000000';
  return digits.slice(-7).padStart(7, '0');
}

function formatSizeDigits(value) {
  const digits = sanitizeDigits(value);
  if (!digits) return '00';
  return digits.slice(-2).padStart(2, '0');
}

function formatYearDigits(year) {
  const digits = sanitizeDigits(year);
  if (digits.length < 2) {
    throw new Error('Ungültiges Jahr für EAN');
  }
  return digits.slice(-2);
}

function buildShoeboxEanBase(entry) {
  const seasonDigit = SEASON_DIGIT_MAP[String(entry.season_code || '').toUpperCase()];
  if (!seasonDigit) {
    throw new Error('Ungültige Saison');
  }
  const yearDigits = formatYearDigits(entry.season_year);
  const articleDigits = formatArticleDigits(entry.article_number);
  const sizeDigits = formatSizeDigits(entry.size);
  const base = `${seasonDigit}${yearDigits}${articleDigits}${sizeDigits}`;
  if (base.length !== 12) {
    throw new Error('EAN-Basis hat eine unerwartete Länge');
  }
  return base;
}

function computeEan13(base12) {
  if (base12.length !== 12 || /\D/.test(base12)) {
    throw new Error('Ungültige EAN-Basis');
  }
  let sum = 0;
  for (let i = 0; i < base12.length; i += 1) {
    const digit = Number(base12[base12.length - 1 - i]);
    if (Number.isNaN(digit)) {
      throw new Error('Ungültige Ziffer in der EAN-Basis');
    }
    if ((i + 1) % 2 === 0) {
      sum += digit * 3;
    } else {
      sum += digit;
    }
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return `${base12}${checkDigit}`;
}

function buildShoeboxEan(entry) {
  const base = buildShoeboxEanBase(entry);
  return computeEan13(base);
}

function encodeEan13Pattern(code) {
  if (!code || code.length !== 13 || /\D/.test(code)) {
    throw new Error('EAN-Code ungültig');
  }
  const digits = code.split('').map((d) => Number(d));
  const parity = EAN_PARITY_TABLE[digits[0]] || EAN_PARITY_TABLE[0];
  let pattern = '101';
  for (let i = 1; i <= 6; i += 1) {
    const digit = digits[i];
    const encoding = parity[i - 1] === 'G' ? EAN_G_CODES[digit] : EAN_L_CODES[digit];
    pattern += encoding;
  }
  pattern += '01010';
  for (let i = 7; i <= 12; i += 1) {
    const digit = digits[i];
    pattern += EAN_R_CODES[digit];
  }
  pattern += '101';
  return pattern;
}

function drawEanBarcode(doc, code, x, y, options = {}) {
  if (!code) return;
  const { moduleWidth = 1.05, barHeight = 42, maxWidth = null, align = 'left' } = options;
  let pattern;
  try {
    pattern = encodeEan13Pattern(code);
  } catch {
    return;
  }
  let effectiveModule = moduleWidth;
  if (maxWidth) {
    effectiveModule = Math.min(moduleWidth, maxWidth / pattern.length);
  }
  const totalWidth = pattern.length * effectiveModule;
  let startX = x;
  if (align === 'center') {
    startX = x - totalWidth / 2;
  } else if (align === 'right') {
    startX = x - totalWidth;
  }
  doc.save();
  doc.fillColor('#000000');
  for (let i = 0; i < pattern.length; i += 1) {
    const bit = pattern[i];
    const isGuard = i < 3 || (i >= 45 && i < 50) || i >= 92;
    const height = isGuard ? barHeight + 6 : barHeight;
    if (bit === '1') {
      doc.rect(startX + i * effectiveModule, y, effectiveModule, height).fill();
    }
  }
  doc.restore();
  doc.font('Helvetica').fontSize(10).text(code, startX, y + barHeight + 12, {
    width: totalWidth,
    align: 'center'
  });
}

function formatProformaYearCode(year) {
  const safeYear = Number.isFinite(year) ? year : new Date().getFullYear();
  return String(safeYear).slice(-2).padStart(2, '0');
}

function generateProformaNumber(year, sequence = PROFORMA_SEQUENCE_BASE) {
  const prefix = `BT-M${formatProformaYearCode(year)}`;
  return `${prefix}${String(sequence).padStart(5, '0')}`;
}

function nextProformaSequence(entries, year) {
  const prefix = `BT-M${formatProformaYearCode(year)}`;
  const used = entries
    .map((entry) => {
      if (!entry?.number?.startsWith(prefix)) return 0;
      const suffix = entry.number.slice(prefix.length);
      const parsed = Number.parseInt(suffix, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    })
    .filter((value) => value > 0);
  if (!used.length) return PROFORMA_SEQUENCE_BASE;
  return Math.max(...used) + 1;
}

async function loadProformaEntries() {
  return (await readJson(PROFORMA_STORE_FILE, [])) || [];
}

async function writeProformaEntries(entries) {
  await writeJson(PROFORMA_STORE_FILE, entries);
  return entries;
}

async function persistProformaEntry(proforma, user, existingId = null) {
  const entries = await loadProformaEntries();
  const now = new Date();
  const nowIso = now.toISOString();
  const docDate = proforma.document?.date ? new Date(proforma.document.date) : now;
  const targetYear = Number.isNaN(docDate.getTime()) ? now.getFullYear() : docDate.getFullYear();
  if (existingId) {
    const index = entries.findIndex((entry) => entry.id === existingId);
    if (index !== -1) {
      const entry = entries[index];
      if (!proforma.document.invoiceNumber) {
        proforma.document.invoiceNumber = entry.number;
      }
      entry.payload = {
        ...proforma,
        meta: {
          id: entry.id,
          number: entry.number
        }
      };
      entry.updated_at = nowIso;
      entries[index] = entry;
      await writeProformaEntries(entries);
      return entry;
    }
  }
  const nextSequence = nextProformaSequence(entries, targetYear);
  const number = generateProformaNumber(targetYear, nextSequence);
  proforma.document.invoiceNumber = proforma.document.invoiceNumber || number;
  const entry = {
    id: randomUUID(),
    number,
    created_at: nowIso,
    updated_at: nowIso,
    created_by: user?.email || user?.id || 'system',
    payload: {
      ...proforma,
      meta: {
        id: null,
        number
      }
    }
  };
  entry.payload.meta.id = entry.id;
  entries.push(entry);
  await writeProformaEntries(entries);
  return entry;
}

function normalizePartyInput(partyInput = {}, options = {}) {
  const fallbackName = options.fallbackName || '';
  const name = toStringValue(partyInput.name) || fallbackName || '';
  const street = toStringValue(partyInput.street);
  const postalCode = toStringValue(partyInput.postalCode);
  const city = toStringValue(partyInput.city);
  const country = toStringValue(partyInput.country);
  const email = toStringValue(partyInput.email);
  const website = toStringValue(partyInput.website);
  let taxId = toStringValue(partyInput.taxId);
  let court = toStringValue(partyInput.court);
  let ceo = toStringValue(partyInput.ceo);
  if (taxId && taxId.includes('\n')) {
    const segments = taxId
      .split(/\r?\n/)
      .map((segment) => segment.trim())
      .filter(Boolean);
    let extractedTaxId = '';
    segments.forEach((segment) => {
      const lower = segment.toLowerCase();
      if (lower.includes('steuernummer') && !extractedTaxId) {
        const match = segment.match(/steuernummer[:\s-]*(.+)/i);
        extractedTaxId = match ? match[1].trim() : segment.replace(/steuernummer/i, '').trim();
      } else if (lower.includes('amtsgericht') && !court) {
        const match = segment.match(/amtsgericht[:\s-]*(.+)/i);
        court = match ? match[1].trim() : segment;
      } else if (lower.includes('geschäftsführer') && !ceo) {
        const match = segment.match(/geschäftsführer[:\s-]*(.+)/i);
        ceo = match ? match[1].trim() : segment;
      }
    });
    if (extractedTaxId) {
      taxId = extractedTaxId;
    }
  }
  const structuredLines = buildStructuredAddressLines(street, postalCode, city, country);
  const addressLines = structuredLines.length ? structuredLines : sanitizeLines(partyInput.address);
  const contactLine = [email, website].filter(Boolean).join(' – ') || toStringValue(partyInput.contact);
  return {
    name,
    street,
    postalCode,
    city,
    country,
    email,
    website,
    taxId,
    court,
    ceo,
    address: addressLines.join('\n'),
    addressLines,
    contact: contactLine
  };
}

function normalizeProformaPayload(rawBody) {
  const body = rawBody || {};
  const docInput = body.document || {};
  const sellerInput = body.seller || {};
  const buyerInput = body.buyer || {};
  const shippingInput = body.shipping || {};
  const rawItems = Array.isArray(body.items) ? body.items : [];

  const parsedDate = docInput.date ? new Date(docInput.date) : new Date();
  const safeDate = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
  const normalizedSeller = normalizePartyInput(sellerInput, { fallbackName: 'BATE GmbH' });
  const normalizedBuyer = normalizePartyInput(buyerInput, { fallbackName: '' });
  const sellerName = normalizedSeller.name || 'BATE GmbH';

  const normalizedDocument = {
    reference: toStringValue(docInput.reference),
    invoiceNumber: toStringValue(docInput.invoiceNumber),
    paymentTerms: toStringValue(docInput.paymentTerms),
    currency: (toStringValue(docInput.currency) || 'EUR').toUpperCase(),
    date: safeDate.toISOString().slice(0, 10)
  };

  const fallbackTransported = [shippingInput.transportedBy, shippingInput.carrier, shippingInput.carrierDocument]
    .map((value) => toStringValue(value))
    .filter(Boolean)
    .join(' ');
  const normalizedShipping = {
    transportedBy: fallbackTransported || '',
    shipmentInfo: toStringValue(shippingInput.shipmentInfo) || toStringValue(shippingInput.transportMode),
    place:
      toStringValue(shippingInput.place) ||
      normalizedSeller.city ||
      normalizedSeller.addressLines[normalizedSeller.addressLines.length - 1] ||
      ''
  };

  const items = rawItems
    .map((item, index) => {
      const quantity = toNumber(item.quantity, 0);
      const unitPrice = toNumber(item.unitPrice, 0);
      const vatRate = toNumber(item.vatRate, 0);
      const declaredValueInput = Number(item.declaredValue);
      const declaredValue = Number.isFinite(declaredValueInput) ? declaredValueInput : quantity * unitPrice;
      const materialUpper = toStringValue(item.materialUpper || item.materialsUpper);
      const materialLining = toStringValue(item.materialLining || item.materialsLining);
      const materialSole = toStringValue(item.materialSole || item.materialsSole);
      const materialLines = [
        materialUpper ? `Upper Material: ${materialUpper}` : null,
        materialLining ? `Lining Material: ${materialLining}` : null,
        materialSole ? `Sole: ${materialSole}` : null
      ]
        .filter(Boolean)
        .join('\n');
      return {
        position: index + 1,
        articleNumber: toStringValue(item.articleNumber),
        color: toStringValue(item.color),
        description: toStringValue(item.description),
        size: toStringValue(item.size),
        materialUpper,
        materialLining,
        materialSole,
        materials: materialLines,
        materialsLines: materialLines ? materialLines.split('\n') : [],
        customsCode: toStringValue(item.customsCode),
        producer: toStringValue(item.producer) || sellerName,
        quantity,
        unit: toStringValue(item.unit) || 'Paar',
        unitType: toStringValue(item.unitType) || 'PAIR',
        quantityLabel: toStringValue(item.quantityLabel),
        unitPrice,
        purchasePrice: toNumber(item.purchasePrice, 0),
        vatRate,
        declaredValue,
        imageData: toStringValue(item.imageData)
      };
    })
    .filter((item) => item.quantity > 0 && (item.articleNumber || item.description));

  if (!items.length) {
    throw createHttpError(400, 'Mindestens eine Position mit Menge > 0 wird benötigt.');
  }

  const totals = items.reduce(
    (acc, item) => {
      const lineNet = item.quantity * item.unitPrice;
      const lineTax = lineNet * item.vatRate;
      acc.net += lineNet;
      acc.tax += lineTax;
      acc.gross += lineNet + lineTax;
      acc.declared += Number.isFinite(item.declaredValue) ? item.declaredValue : lineNet + lineTax;
      return acc;
    },
    { net: 0, tax: 0, gross: 0, declared: 0 }
  );

  return {
    meta: {
      id: body.meta?.id || null
    },
    document: normalizedDocument,
    seller: normalizedSeller,
    buyer: normalizedBuyer,
    shipping: normalizedShipping,
    items,
    totals
  };
}

function buildProformaTableRows(items, currency) {
  return items.map((item) => {
    const articleParts = [item.articleNumber, item.color ? `Color: ${item.color}` : null]
      .filter(Boolean)
      .map(sanitizePdfText);
    const descriptionParts = [item.description, item.size ? `Size: ${item.size}` : null]
      .filter(Boolean)
      .map(sanitizePdfText);
    const unitLabel = PROFORMA_UNIT_LABELS[item.unitType] || item.unit || 'Paar';
    const quantityLabel = item.quantity ? `${item.quantity} ${unitLabel}` : unitLabel;
    return {
      article: articleParts.join('\n') || '-',
      description: descriptionParts.join('\n') || '-',
      materials: sanitizePdfText(item.materials) || '-',
      customs: sanitizePdfText(item.customsCode) || '-',
      producer: sanitizePdfText(item.producer) || '-',
      quantity: sanitizePdfText(quantityLabel) || '-',
      unitPrice: formatCurrencyValue(item.unitPrice, currency),
      declared: formatCurrencyValue(item.declaredValue, currency)
    };
  });
}

function drawProformaTable(doc, rows) {
  const columns = [
    { key: 'article', label: 'Artikel-Nr. /\nArticle No.', width: 80 },
    { key: 'description', label: 'Beschreibung /\nDescription', width: 118 },
    { key: 'materials', label: 'Materialien /\nMaterials', width: 134 },
    { key: 'customs', label: 'Zolltarifnummer /\nCustoms tariff code', width: 114 },
    { key: 'producer', label: 'Hersteller /\nProducer', width: 70 },
    { key: 'quantity', label: 'Menge /\nQuantity', width: 80 },
    { key: 'unitPrice', label: 'Einzelpreis /\nUnit Price', width: 70 },
    { key: 'declared', label: 'Warenwert /\nDeclared Value', width: 80 }
  ];
  const startX = doc.page.margins.left;
  const usableHeight = doc.page.height - doc.page.margins.bottom;
  let y = doc.y + 10;

  const drawHeader = () => {
    doc.font('Helvetica-Bold').fontSize(9);
    let x = startX;
    const headerHeight = 28;
    columns.forEach((column) => {
      doc.rect(x, y, column.width, headerHeight).stroke();
      const headerLines = column.label.split('\n');
      headerLines.forEach((line, index) => {
        doc.text(line, x + 4, y + 4 + index * 10, {
          width: column.width - 8,
          align: 'center',
          lineBreak: false
        });
      });
      x += column.width;
    });
    y += headerHeight;
    doc.font('Helvetica').fontSize(9);
  };

  const ensureSpace = (requiredHeight) => {
    if (y + requiredHeight <= usableHeight) return;
    doc.addPage({ size: 'A4', margin: 48, layout: 'landscape' });
    y = doc.page.margins.top;
    drawHeader();
  };

  drawHeader();
  rows.forEach((row) => {
    const rowHeight =
      columns.reduce((max, column) => {
        const text = row[column.key] || '';
        const height = doc.heightOfString(text, {
          width: column.width - 8,
          align: 'left',
          lineGap: 3
        });
        return Math.max(max, height + 14);
      }, 28);
    ensureSpace(rowHeight);
    let x = startX;
    columns.forEach((column) => {
      const text = row[column.key] || '';
      doc.rect(x, y, column.width, rowHeight).stroke();
      let align = 'left';
      if (column.key === 'unitPrice' || column.key === 'declared') {
        align = 'right';
      } else if (column.key === 'quantity') {
        align = 'center';
      }
      doc.text(text, x + 4, y + 6, {
        width: column.width - 8,
        align,
        lineGap: 3
      });
      x += column.width;
    });
    y += rowHeight;
  });
  doc.moveDown(1);
}

function measureInfoCell(doc, label, value, width) {
  const safeLabel = sanitizePdfText(label || '-');
  const safeValue = sanitizePdfText(value || '-');
  doc.font('Helvetica-Bold').fontSize(10);
  const labelHeight = doc.heightOfString(safeLabel, { width: width - 12 });
  doc.font('Helvetica').fontSize(10);
  const valueHeight = doc.heightOfString(safeValue, { width: width - 12 });
  return labelHeight + valueHeight + 12;
}

function drawInfoCell(doc, label, value, x, y, width, height) {
  doc.rect(x, y, width, height).stroke();
  doc.font('Helvetica-Bold').fontSize(10).text(sanitizePdfText(label || '-'), x + 6, y + 6, { width: width - 12 });
  doc.font('Helvetica').fontSize(10).text(sanitizePdfText(value || '-'), x + 6, y + 18, {
    width: width - 12,
    lineGap: 2
  });
}

function drawInfoTable(doc, rows) {
  const totalWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = totalWidth / 2;
  let y = doc.y;
  rows.forEach((row) => {
    const leftHeight = measureInfoCell(doc, row.leftLabel, row.leftValue, colWidth);
    const rightHeight = measureInfoCell(doc, row.rightLabel, row.rightValue, colWidth);
    const rowHeight = Math.max(32, leftHeight, rightHeight);
    drawInfoCell(doc, row.leftLabel, row.leftValue, doc.page.margins.left, y, colWidth, rowHeight);
    drawInfoCell(doc, row.rightLabel, row.rightValue, doc.page.margins.left + colWidth, y, colWidth, rowHeight);
    y += rowHeight;
  });
  doc.y = y;
  doc.moveDown(0.5);
}

function buildProformaPdf(doc, payload) {
  const { document, seller, buyer, shipping, items, totals } = payload;
  const documentDate = document.date ? new Date(document.date) : new Date();
  const currency = document.currency || 'EUR';
  doc.font('Helvetica-Bold').fontSize(16).text('PROFORMA INVOICE / PROFORMA-RECHNUNG', { align: 'center' });
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10).text('Nicht zum Verkauf bestimmt – Nur Musterware / Not for sale – Sample only', {
    align: 'center'
  });
  doc.moveDown(1);

  const columnWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right - 32) / 2;
  const leftX = doc.page.margins.left;
  const rightX = leftX + columnWidth + 32;
  const topY = doc.y;

  const exporterLines = collectPartyLines(seller, { sanitize: true });
  const importerLines = collectPartyLines(buyer, { sanitize: true });
  const exporterText = exporterLines.length ? exporterLines.join('\n') : '-';
  const importerText = importerLines.length ? importerLines.join('\n') : '-';

  doc.font('Helvetica-Bold').fontSize(10).text('Exporteur / Exporter:', leftX, topY);
  doc.font('Helvetica').text(exporterText, leftX, topY + 14, { width: columnWidth, align: 'left' });

  doc.font('Helvetica-Bold').text('Importeur / Importer:', rightX, topY);
  doc.font('Helvetica').text(importerText, rightX, topY + 14, { width: columnWidth, align: 'left' });

  const exporterHeight = doc.heightOfString(exporterText, { width: columnWidth });
  const importerHeight = doc.heightOfString(importerText, { width: columnWidth });
  const blockBottom = topY + 14 + Math.max(exporterHeight, importerHeight);
  doc.y = blockBottom;
  doc.moveDown(0.8);

  const infoRows = [
    {
      leftLabel: 'Transportiert durch / Carried by:',
      leftValue: shipping.transportedBy || '-',
      rightLabel: 'Rechnungsnummer / Invoice No.:',
      rightValue: document.invoiceNumber || '-'
    },
    {
      leftLabel: 'Versandart / Shipment:',
      leftValue: shipping.shipmentInfo || '-',
      rightLabel: 'Datum / Date:',
      rightValue: formatDateLabel(documentDate)
    }
  ];
  drawInfoTable(doc, infoRows);
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').text('Warenbeschreibung / Goods Description:', doc.page.margins.left, doc.y, {
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
    align: 'left'
  });
  doc.moveDown(0.6);

  const tableRows = buildProformaTableRows(items, currency);
  drawProformaTable(doc, tableRows);

  doc.addPage({ size: 'A4', margin: 72, layout: 'landscape' });
  doc.font('Helvetica-Bold').fontSize(12).text('Gesamtwert nur zu Zollzwecken / Total Value for Customs Purposes Only:', {
    continued: true
  });
  doc.text(` ${formatCurrencyValue(totals.declared, currency)}`);
  doc.moveDown(1);

  const noteText = [
    'Diese Sendung enthält ausschließlich Mustersendungen von Schuhen für unseren Showroom.',
    'Die Schuhe sind nicht für den Weiterverkauf bestimmt, sondern dienen ausschließlich als Ausstellungs- und Vorführmuster.',
    'Die angegebenen Werte dienen nur der zolltechnischen Deklaration.',
    '',
    'This shipment contains shoe samples for our showroom only.',
    'They are not intended for resale but solely for presentation and demonstration purposes.',
    'Declared values are for customs purposes only.'
  ].join('\n');

  doc.font('Helvetica-Bold').fontSize(11).text('Hinweis / Note:');
  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(11).text(noteText, { lineGap: 4 });
  doc.moveDown(1.2);

  doc.font('Helvetica-Bold').text('Ort / Place:', { continued: true });
  doc.font('Helvetica').text(` ${shipping.place || '-'}`);
  doc.font('Helvetica-Bold').text('Datum / Date:', { continued: true });
  doc.font('Helvetica').text(` ${formatDateLabel(documentDate)}`);
  doc.moveDown(2);
  doc.font('Helvetica-Bold').text('Unterschrift / Signature (Exporteur):');
  const lineY = doc.y + 12;
  doc.moveTo(doc.page.margins.left, lineY).lineTo(doc.page.width - doc.page.margins.right, lineY).stroke();
}


async function drawShoeboxLabel(doc, entry, imageCache) {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const height = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
  const leftColumnWidth = width * 0.62;
  const imageWidth = width - leftColumnWidth - 28;
  const leftX = doc.page.margins.left;
  const rightX = leftX + leftColumnWidth + 24;
  const topY = doc.page.margins.top;
  const valueColor = '#0a1426';
  const labelColor = '#6d7385';
  let cursorY = topY;

  const writeInfoLine = (label, value, valueSize = 30) => {
    doc.font('Helvetica').fontSize(14).fillColor(labelColor).text(label, leftX, cursorY, {
      width: leftColumnWidth,
      lineBreak: false
    });
    cursorY = doc.y + 4;
    doc
      .font('Helvetica-Bold')
      .fontSize(valueSize)
      .fillColor(valueColor)
      .text(value || '-', leftX, cursorY, {
        width: leftColumnWidth,
        lineBreak: false,
        ellipsis: true
      });
    cursorY = doc.y + 18;
  };

  doc
    .font('Helvetica-Bold')
    .fontSize(44)
    .fillColor(valueColor)
    .text((entry.name || 'ARTIKEL').toUpperCase(), leftX, cursorY, {
      width: leftColumnWidth,
      lineBreak: false,
      ellipsis: true
    });
  cursorY = doc.y + 32;
  writeInfoLine('Artikelnummer', entry.article_number || '-', 34);
  writeInfoLine('Farbcode', entry.color_code || '-', 34);

  let eanCode = null;
  try {
    eanCode = buildShoeboxEan(entry);
  } catch {
    eanCode = null;
  }

  const barcodeBottom = doc.page.margins.top + height - 20;
  const barcodeHeight = 58;
  const barcodeY = barcodeBottom - barcodeHeight - 34;
  doc
    .font('Helvetica')
    .fontSize(14)
    .fillColor(labelColor)
    .text('EAN', leftX, barcodeY - 18, { width: leftColumnWidth, lineBreak: false });
  if (eanCode) {
    drawEanBarcode(doc, eanCode, leftX + leftColumnWidth / 2, barcodeY, {
      maxWidth: leftColumnWidth - 20,
      barHeight: barcodeHeight,
      align: 'center'
    });
    doc
      .font('Helvetica')
      .fontSize(18)
      .fillColor(labelColor)
      .text(eanCode, leftX, barcodeBottom - 18, {
        width: leftColumnWidth,
        align: 'center',
        lineBreak: false
      });
  } else {
    doc
      .font('Helvetica')
      .fontSize(16)
      .fillColor(labelColor)
      .text('EAN nicht verfügbar', leftX, barcodeY + 20, { width: leftColumnWidth, align: 'center' });
  }

  const imageSize = Math.min(imageWidth, height - 60);
  const imageY = topY;
  const imageX = rightX;
  let buffer = null;
  if (entry.image_url) {
    if (imageCache.has(entry.image_url)) {
      buffer = imageCache.get(entry.image_url);
    } else {
      buffer = await fetchImageBuffer(entry.image_url);
      imageCache.set(entry.image_url, buffer);
    }
  }
  doc.save();
  if (buffer) {
    doc.image(buffer, imageX, imageY, { fit: [imageWidth, imageSize], align: 'center', valign: 'center' });
  } else {
    doc.rect(imageX, imageY, imageWidth, imageSize).fillAndStroke(valueColor, valueColor);
  }
  doc.restore();

  doc
    .font('Helvetica-Bold')
    .fontSize(88)
    .fillColor(valueColor)
    .text(String(entry.size || '-'), imageX, barcodeBottom - 96, {
      width: imageWidth,
      align: 'center',
      lineBreak: false
    });
}

function normalizeTicketViewKey(value) {
  const normalized = (value || '').toString().toLowerCase();
  return TECHPACK_VIEW_KEYS.has(normalized) ? normalized : null;
}

function buildTicketKey(ticket) {
  if (!ticket) return '';
  const segments = [
    ticket.id || '',
    ticket.order_id || '',
    ticket.position_id || '',
    ticket.created_at || '',
    ticket.title || ''
  ];
  return segments.join('::');
}

async function loadTicketsData() {
  return (await readJson('tickets.json', [])) || [];
}

async function syncOrderStatusWithTickets(orderId, actorEmail = 'system') {
  if (!orderId) return null;
  const [orders, tickets] = await Promise.all([loadOrders(), loadTicketsData()]);
  const order = orders.find((entry) => entry.id === orderId);
  if (!order) return null;
  const currentStatus = order.portal_status || 'ORDER_EINGEREICHT';
  if (!SUPPLIER_DISCUSSION_STATUSES.has(currentStatus)) {
    return order;
  }
  const hasOpenTickets = tickets.some((ticket) => ticket.order_id === orderId && ticket.status !== 'CLOSED');
  if (hasOpenTickets && currentStatus !== 'RUECKFRAGEN_OFFEN') {
    return updateOrderWorkflow({
      orderId,
      nextStatus: 'RUECKFRAGEN_OFFEN',
      actor: actorEmail || 'system'
    });
  }
  if (!hasOpenTickets && currentStatus === 'RUECKFRAGEN_OFFEN') {
    return updateOrderWorkflow({
      orderId,
      nextStatus: 'ORDER_BESTAETIGT',
      actor: actorEmail || 'system'
    });
  }
  return order;
}

function resolveTechpackViewKey(requested, existingMedias = []) {
  const normalized = (requested || '').toString().trim().toLowerCase();
  if (TECHPACK_VIEW_KEYS.has(normalized)) {
    return normalized;
  }
  const assigned = new Set(existingMedias.map((entry) => entry.view_key).filter(Boolean));
  const firstFree = TECHPACK_VIEWS.find((view) => !assigned.has(view.key));
  return firstFree?.key || TECHPACK_VIEWS[0].key;
}

function ensureSpecMediaAssignments(spec) {
  if (!spec?.flags?.medien?.length) return false;
  let changed = false;
  spec.flags.medien = spec.flags.medien.map((entry, idx) => {
    const normalized = { ...entry };
    if (!normalized.view_key || !TECHPACK_VIEW_KEYS.has(normalized.view_key)) {
      normalized.view_key = TECHPACK_VIEWS[idx % TECHPACK_VIEWS.length].key;
      changed = true;
    } else {
      normalized.view_key = normalized.view_key.toLowerCase();
    }
    const nextStatus = (normalized.status || '').toString().toUpperCase();
    if (!TECHPACK_MEDIA_STATUSES.has(nextStatus)) {
      normalized.status = 'OPEN';
      changed = true;
    } else {
      normalized.status = nextStatus;
    }
    if (!normalized.filename && normalized.label) {
      normalized.filename = normalized.label;
      changed = true;
    }
    return normalized;
  });
  return changed;
}

function reassignPlaceholderAnnotations(spec, viewKey, mediaId) {
  if (!spec || !viewKey || !mediaId) return;
  if (!Array.isArray(spec.annotations) || !spec.annotations.length) return;
  const placeholderId = `${PLACEHOLDER_MEDIA_PREFIX}${viewKey}`;
  spec.annotations.forEach((annotation) => {
    if (annotation.media_id === placeholderId) {
      annotation.media_id = mediaId;
    }
  });
}

function removePlaceholderMediaEntry(spec, viewKey) {
  if (!spec?.flags?.medien || !viewKey) return;
  const placeholderId = `${PLACEHOLDER_MEDIA_PREFIX}${viewKey}`;
  spec.flags.medien = spec.flags.medien.filter((entry) => {
    if (!entry) return false;
    if (entry.id === placeholderId) return false;
    if (entry.view_key === viewKey && entry.auto_generated) return false;
    return true;
  });
}

function isPlaceholderMediaId(mediaId) {
  return typeof mediaId === 'string' && mediaId.startsWith(PLACEHOLDER_MEDIA_PREFIX);
}

function buildPlaceholderMediaEntry(viewKey) {
  if (!TECHPACK_VIEW_KEYS.has(viewKey)) return null;
  const view = TECHPACK_VIEWS.find((entry) => entry.key === viewKey);
  if (!view) return null;
  return {
    id: `${PLACEHOLDER_MEDIA_PREFIX}${view.key}`,
    label: `${view.label} · Platzhalter`,
    filename: null,
    view_key: view.key,
    status: 'OPEN',
    url: TECHPACK_PLACEHOLDER_IMAGES[view.key] || '',
    is_placeholder: true
  };
}

function findOrderPosition(order, positionId) {
  if (!order || !Array.isArray(order.positions)) return null;
  return order.positions.find((pos) => pos.position_id === positionId || pos.id === positionId);
}

async function resolveViewerImageBase(orderId, positionId, existingOrder = null) {
  const order = existingOrder || (await loadOrders()).find((entry) => entry.id === orderId);
  if (!order) return null;
  const position = findOrderPosition(order, positionId);
  if (!position?.item_code) return null;
  const items = await loadItemsData();
  const item = items.find((entry) => entry.item_code === position.item_code || entry.id === position.item_code);
  const rawLink = item?.links?.viewer3d || item?.viewer3d;
  if (!rawLink) return null;
  const trimmed = rawLink.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\/+$/, '');
  return normalized.endsWith('/images') ? normalized : `${normalized}/images`;
}

async function ensureSpecViewerMedia(spec, orderId, positionId, existingOrder = null) {
  if (!spec?.flags) return false;
  spec.flags.medien = Array.isArray(spec.flags.medien) ? spec.flags.medien : [];
  // Wenn bereits manuelle Medien existieren, nur fehlende Slots füllen.
  const viewerBase = await resolveViewerImageBase(orderId, positionId, existingOrder);
  if (!viewerBase) return false;
  let changed = false;
  const currentMedia = spec.flags.medien;
  const viewIndex = new Map();
  currentMedia.forEach((entry, idx) => {
    if (entry?.view_key) {
      viewIndex.set(entry.view_key, { entry, idx });
    }
  });
  TECHPACK_VIEWER_PRESETS.forEach((preset) => {
    const autoEntry = {
      id: `viewer-${positionId || orderId}-${preset.key}`,
      label: `${preset.label} · ${preset.frame}.webp`,
      filename: `${preset.frame}.webp`,
      view_key: preset.key,
      status: 'OPEN',
      url: `${viewerBase}/${preset.frame}.webp`,
      auto_generated: true
    };
    const existing = viewIndex.get(preset.key);
    if (!existing) {
      currentMedia.push(autoEntry);
      viewIndex.set(preset.key, { entry: autoEntry, idx: currentMedia.length - 1 });
      changed = true;
      return;
    }
    if (existing.entry.is_placeholder) {
      reassignPlaceholderAnnotations(spec, preset.key, autoEntry.id);
      currentMedia[existing.idx] = autoEntry;
      viewIndex.set(preset.key, { entry: autoEntry, idx: existing.idx });
      changed = true;
      return;
    }
    if (existing.entry.auto_generated) {
      const nextEntry = {
        ...existing.entry,
        label: autoEntry.label,
        filename: autoEntry.filename,
        url: autoEntry.url,
        auto_generated: true
      };
      const needsUpdate =
        nextEntry.label !== existing.entry.label ||
        nextEntry.filename !== existing.entry.filename ||
        nextEntry.url !== existing.entry.url;
      if (needsUpdate) {
        currentMedia[existing.idx] = nextEntry;
        viewIndex.set(preset.key, { entry: nextEntry, idx: existing.idx });
        changed = true;
      }
    }
  });
  return changed;
}

function deriveOrderSizeTotals(order) {
  const totals = {};
  (order.positions || []).forEach((pos) => {
    Object.entries(pos.size_breakdown || {}).forEach(([size, quantity]) => {
      const key = size?.toString().trim();
      if (!key) return;
      const value = Number(quantity);
      totals[key] = (totals[key] || 0) + (Number.isFinite(value) ? value : 0);
    });
  });
  return totals;
}

function sanitizeSizeTable(sizeTable, order) {
  if (!Array.isArray(sizeTable) || !sizeTable.length) {
    const totals = deriveOrderSizeTotals(order);
    return Object.entries(totals).map(([size, quantity]) => ({
      size,
      quantity
    }));
  }
  return sizeTable
    .map((entry) => ({
      size: entry?.size?.toString().trim(),
      quantity:
        entry?.quantity === '' || entry?.quantity === null || entry?.quantity === undefined
          ? ''
          : Number(entry.quantity) || entry.quantity
    }))
    .filter((entry) => entry.size);
}

function buildLabelPayload({
  order,
  customer,
  profile,
  addressLines,
  cartonNumber,
  cartonTotal,
  sizeTable,
  overrides = {}
}) {
  const position = order.positions?.[0] || {};
  const defaults = profile.defaults || {};
  const meta = {
    variation: overrides.variation || position.variation || defaults.variation || position.item_code || order.order_number || '',
    article: overrides.article || position.item_code || '',
    leather: overrides.leather || position.material || defaults.leather || position.description || '',
    sole: overrides.sole || position.sole || defaults.sole || ''
  };
  const context = {
    warehouse_title: profile.warehouse_title || 'Versandadresse',
    warehouse_lines: profile.warehouse_lines || addressLines,
    supplier_title: profile.supplier_title || 'Lieferant',
    supplier_lines: profile.supplier_lines || [order.supplier_name, order.supplier_id].filter(Boolean),
    variation: meta.variation.toString(),
    article_number: meta.article,
    leather_label: profile.leather_label || 'Leder & Farbe',
    leather_value: meta.leather,
    sole_label: profile.sole_label || 'Sohle',
    sole_value: meta.sole,
    size_label: profile.size_label || 'Größengang',
    pairing_label: profile.pairing_label || 'Paarung',
    notes: profile.notes || ''
  };
  return {
    order_id: order.id,
    order_number: order.order_number,
    carton: {
      total: cartonTotal,
      number: cartonNumber
    },
    ...context,
    size_table: sizeTable,
    order_customer: {
      id: customer.id || order.customer_id,
      name: customer.name || order.customer_name,
      number: order.customer_id,
      address_lines: addressLines,
      tax_id: customer.tax_id || ''
    }
  };
}

async function buildLabelResponse({ order, cartonNumber, cartonTotal, sizeTableOverride, overrides = {} }) {
  const [customers, addresses] = await Promise.all([loadCustomersData(), loadAddressesData()]);
  const customer = customers.find((c) => c.id === order.customer_id) || {};
  const profile = customer.label_profile || {};
  const delivery = addresses.find(
    (addr) => addr.customer_id === order.customer_id && (addr.type || '').toLowerCase() === 'lieferung'
  );
  const addressLines = delivery
    ? [delivery.street, `${delivery.zip} ${delivery.city}`, delivery.country].filter(Boolean)
    : [];
  const sizeTable = sanitizeSizeTable(sizeTableOverride, order);
  return buildLabelPayload({
    order,
    customer,
    profile,
    addressLines,
    cartonNumber,
    cartonTotal,
    sizeTable,
    overrides
  });
}

function drawLabelPage(doc, label) {
  const { width } = doc.page;
  const { left, right, top } = doc.page.margins;
  const usableWidth = width - left - right;
  const startY = top;

  doc.fontSize(10).text(label.warehouse_title, left, startY);
  doc.fontSize(12).text(label.warehouse_lines.join('\n'), left, startY + 14);

  const rowY = startY + 80;
  const rowHeight = 160;
  const colAddressWidth = usableWidth * 0.55;
  const colInfoWidth = usableWidth * 0.45;

  doc.rect(left, rowY, colAddressWidth, rowHeight).stroke();
  doc.rect(left + colAddressWidth, rowY, colInfoWidth, rowHeight).stroke();

  doc.fontSize(11).text('Bestell-Nr.', left + colAddressWidth + 10, rowY + 10);
  doc.fontSize(18).text(label.order_number || '-', left + colAddressWidth + 10, rowY + 26);

  doc.fontSize(11).text('Karton gesamt', left + colAddressWidth + 10, rowY + 70);
  doc.fontSize(48).text(String(label.carton.total || ''), left + colAddressWidth + 10, rowY + 90);

  doc.fontSize(11).text('Karton-Nr.', left + colAddressWidth + colInfoWidth / 2, rowY + 70);
  doc.fontSize(48).text(String(label.carton.number || ''), left + colAddressWidth + colInfoWidth / 2, rowY + 90);

  doc.fontSize(11).text('Lieferant', left + colAddressWidth + 10, rowY + 130);
  doc.fontSize(10).text((label.supplier_lines || []).join('\n'), left + colAddressWidth + 10, rowY + 145, {
    width: colInfoWidth - 20
  });

  doc.fontSize(12).text(`Variation: ${label.variation || '-'}`, left, rowY + rowHeight + 10);
  doc.text(`Artikel-Nr.: ${label.article_number || '-'}`, left + usableWidth / 2, rowY + rowHeight + 10);
  doc.text(`Leder & Farbe: ${label.leather_value || '-'}`, left, rowY + rowHeight + 30);
  doc.text(`Sohle: ${label.sole_value || '-'}`, left + usableWidth / 2, rowY + rowHeight + 30);

  const tableY = rowY + rowHeight + 60;
  const rowSize = label.size_table || [];
  const colWidth = usableWidth / Math.max(rowSize.length, 1);
  doc.fontSize(10);
  rowSize.forEach((entry, idx) => {
    const cellX = left + colWidth * idx;
    doc.rect(cellX, tableY, colWidth, 30).stroke();
    doc.text(entry.size, cellX + 4, tableY + 4);
    doc.text(entry.quantity === '' ? '' : entry.quantity, cellX + 4, tableY + 18);
  });

  doc.text(`Paarung: ${label.pairing_label || ''}`, left, tableY + 40);
  doc.fontSize(10).text(`Kunde: ${(label.order_customer?.name || '-')}`, left, tableY + 60);
  doc.text((label.order_customer?.address_lines || []).join(', '), left, tableY + 74);
}

function buildOrderFilter(query, user) {
  return (order) => {
    if (query.status && order.portal_status !== query.status) {
      return false;
    }
    if (query.orderType && order.order_type !== query.orderType) {
      return false;
    }
    if (query.customer) {
      const term = query.customer.toLowerCase();
      const nameMatch = order.customer_name?.toLowerCase().includes(term);
      const idMatch = order.customer_id?.toLowerCase().includes(term);
      if (!nameMatch && !idMatch) {
        return false;
      }
    }
    if (query.orderNumber) {
      const orderTerm = query.orderNumber.toLowerCase();
      if (!order.order_number?.toLowerCase().includes(orderTerm)) {
        return false;
      }
    }
    if (query.supplier && order.supplier_id !== query.supplier) {
      return false;
    }
    if (query.search) {
      const term = query.search.toLowerCase();
      const matches =
        order.order_number?.toLowerCase().includes(term) ||
        order.customer_name?.toLowerCase().includes(term) ||
        order.supplier_name?.toLowerCase().includes(term);
      if (!matches) return false;
    }
    if (user?.role === 'SUPPLIER' && user.supplier_id && order.supplier_id && order.supplier_id !== user.supplier_id) {
      return false;
    }
    return true;
  };
}

function countBy(list = [], selector) {
  return list.reduce((acc, item) => {
    const raw = typeof selector === 'function' ? selector(item) : item?.[selector];
    const key = raw || 'UNBEKANNT';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function mapCounts(counts = {}, labelResolver = (key) => key) {
  return Object.entries(counts)
    .map(([key, count]) => ({
      key,
      label: labelResolver ? labelResolver(key) : key,
      count
    }))
    .sort((a, b) => b.count - a.count);
}

function minutesSince(isoDate) {
  if (!isoDate) return null;
  const ts = new Date(isoDate).getTime();
  if (Number.isNaN(ts)) return null;
  return (Date.now() - ts) / 60000;
}

function normalizeDate(value) {
  const ts = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(ts) ? null : ts;
}

async function translateText(text, source, target) {
  const trimmed = text?.toString().trim();
  if (!trimmed) {
    return {
      translation: '',
      provider: 'noop',
      fallback: true
    };
  }
  const langpair = `${source}|${target}`;
  const params = new URLSearchParams({
    q: trimmed,
    langpair
  });
  try {
    const { data } = await axios.get('https://api.mymemory.translated.net/get', {
      params,
      timeout: 5000
    });
    const translation = data?.responseData?.translatedText;
    if (translation) {
      return {
        translation,
        provider: 'mymemory',
        fallback: false
      };
    }
  } catch (err) {
    console.warn('Translation service failed', err.message);
  }
  return {
    translation: trimmed,
    provider: 'fallback',
    fallback: true
  };
}

async function collectDiagnostics(currentUserId) {
  const now = Date.now();
  const [orders, tickets, specs, lastSync, calendar, statusLogs, autosyncSnapshot] = await Promise.all([
    loadOrders(),
    readJson('tickets.json', []),
    loadSpecs(),
    readJson('last_sync.json', { last_run: null, source: null }),
    readJson('calendar.json', []),
    readJson('status_logs.json', []),
    getAutoSyncSnapshot({ limit: 10 })
  ]);

  const ordersByStatus = mapCounts(countBy(orders, (order) => order.portal_status || 'UNBEKANNT'), getStatusLabel);
  const ordersByPhase = mapCounts(countBy(orders, (order) => order.phase || 'UNBEKANNT'));
  const openOrders = orders.filter((order) => !COMPLETED_ORDER_STATUSES.has(order.portal_status));
  const overdueOrders = openOrders
    .filter((order) => normalizeDate(order.requested_delivery))
    .filter((order) => normalizeDate(order.requested_delivery) < now)
    .map((order) => {
      const requested = normalizeDate(order.requested_delivery);
      const daysOverdue = requested ? Math.max(1, Math.round((now - requested) / 86400000)) : null;
      return {
        id: order.id,
        order_number: order.order_number,
        customer_name: order.customer_name,
        supplier_name: order.supplier_name,
        portal_status: order.portal_status,
        requested_delivery: order.requested_delivery,
        days_overdue: daysOverdue
      };
    })
    .sort((a, b) => (b.days_overdue || 0) - (a.days_overdue || 0));
  const overdueHighlights = overdueOrders.slice(0, 8);

  const ticketsByStatus = mapCounts(countBy(tickets, (ticket) => (ticket.status || 'UNBEKANNT').toUpperCase()));
  const ticketsByPriority = mapCounts(countBy(tickets, (ticket) => (ticket.priority || 'UNBEKANNT').toUpperCase()));
  const escalatedTickets = tickets
    .filter((ticket) => (ticket.priority || '').toLowerCase() === 'hoch' && ticket.status !== 'CLOSED')
    .map((ticket) => {
      const lastCommentTs = ticket.comments?.slice(-1)[0]?.ts;
      return {
        id: ticket.id,
        order_id: ticket.order_id,
        position_id: ticket.position_id || null,
        title: ticket.title,
        status: ticket.status,
        priority: ticket.priority,
        updated_at: lastCommentTs || ticket.updated_at || ticket.created_at || null
      };
    })
    .sort((a, b) => (normalizeDate(b.updated_at) || 0) - (normalizeDate(a.updated_at) || 0))
    .slice(0, 6);

  const pendingSpecs = specs
    .filter((spec) => spec.flags?.rueckfragen > 0 || spec.flags?.fertig === false)
    .map((spec) => ({
      order_id: spec.order_id,
      position_id: spec.position_id,
      rueckfragen: spec.flags?.rueckfragen || 0,
      verstanden: spec.flags?.verstanden ?? null,
      fertig: spec.flags?.fertig ?? null,
      updated_at: spec.updated_at || null
    }))
    .sort((a, b) => (normalizeDate(b.updated_at) || 0) - (normalizeDate(a.updated_at) || 0))
    .slice(0, 6);

  const upcomingEvents = (calendar || [])
    .filter((event) => {
      const start = normalizeDate(event.start);
      return start && start >= now - 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => (normalizeDate(a.start) || 0) - (normalizeDate(b.start) || 0))
    .slice(0, 5);

  const recentLogs = (statusLogs || []).slice(-10).reverse();

  const syncAgeMinutes = minutesSince(lastSync?.last_run);
  const alerts = [];
  if (!lastSync?.last_run) {
    alerts.push({ level: 'danger', message: 'ERP Sync hat noch keinen erfolgreichen Lauf gemeldet.' });
  } else if (syncAgeMinutes !== null && syncAgeMinutes > 60) {
    alerts.push({ level: 'warning', message: `ERP Sync zuletzt vor ${Math.round(syncAgeMinutes)} Minuten.` });
  }
  if (overdueOrders.length) {
    alerts.push({ level: 'warning', message: `${overdueOrders.length} Bestellung(en) überfällig.`, context: 'orders' });
  }
  if (escalatedTickets.length) {
    alerts.push({ level: 'warning', message: `${escalatedTickets.length} Ticket(s) mit hoher Priorität offen.`, context: 'tickets' });
  }
  if (pendingSpecs.length) {
    alerts.push({ level: 'info', message: `${pendingSpecs.length} Spezifikation(en) warten auf Rückmeldung.` });
  }

  const memory = process.memoryUsage();
  const jobs = [
    {
      name: 'ERP Sync',
      schedule: SYNC_CRON,
      lastRun: lastSync?.last_run || null,
      ageMinutes: syncAgeMinutes,
      healthy: syncAgeMinutes !== null && syncAgeMinutes < 45
    }
  ];
  if (autosyncSnapshot?.enabled) {
    jobs.push({
      name: 'AutoSync',
      schedule: 'Webhook/Manuell',
      lastRun: autosyncSnapshot.stats?.last_run || null,
      ageMinutes: minutesSince(autosyncSnapshot.stats?.last_run),
      healthy: Boolean(autosyncSnapshot.online)
    });
  }

  return {
    generated_at: new Date(now).toISOString(),
    alerts,
    server: {
      port: PORT,
      base_url: BASE_URL,
      node_version: process.version,
      environment: process.env.NODE_ENV || 'development',
      uptime_seconds: Math.round(process.uptime()),
      memory: {
        rss: memory.rss,
        heap_total: memory.heapTotal,
        heap_used: memory.heapUsed,
        external: memory.external
      }
    },
    sync: {
      last_run: lastSync?.last_run || null,
      source: lastSync?.source || null,
      age_minutes: syncAgeMinutes,
      schedule: SYNC_CRON
    },
    autosync: autosyncSnapshot,
    jobs,
    orders: {
      total: orders.length,
      by_status: ordersByStatus,
      by_phase: ordersByPhase,
      overdue: overdueHighlights
    },
    tickets: {
      total: tickets.length,
      by_status: ticketsByStatus,
      by_priority: ticketsByPriority,
      escalated: escalatedTickets
    },
    specs: {
      total: specs.length,
      pending_review: pendingSpecs
    },
    calendar: {
      upcoming: upcomingEvents
    },
    logs: {
      recent: recentLogs
    }
  };
}

function orderMatchesSupplier(order, user) {
  if (user.role === 'BATE') return true;
  if (!user.supplier_id) return false;
  // TODO: Feature-Flag für feinere Supplier-Rechte pro Order implementieren.
  return order.supplier_id === user.supplier_id;
}

async function ensureOrderAccess(orderId, user) {
  const orders = await loadOrders();
  const order = orders.find((o) => o.id === orderId);
  if (!order) {
    const err = new Error('Order nicht gefunden');
    err.statusCode = 404;
    throw err;
  }
  if (!orderMatchesSupplier(order, user)) {
    const err = new Error('Keine Berechtigung');
    err.statusCode = 403;
    throw err;
  }
  return order;
}

// Auth routes
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return respondError(res, 400, 'E-Mail und Passwort erforderlich');
  }
  try {
    const user = await authenticate(email, password);
    if (!user) {
      return respondError(res, 401, 'Ungültige Anmeldedaten');
    }
    const enforcedLocale = user.role === 'SUPPLIER' ? 'tr' : resolveLocale(user.locale || DEFAULT_LOCALE);
    user.locale = enforcedLocale;
    req.session.user = user;
    req.session.locale = enforcedLocale;
    return res.json({ user });
  } catch (err) {
    return respondError(res, 500, err.message);
  }
});

app.post('/api/logout', (req, res) => {
  req.session?.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/session', (req, res) => {
  if (!req.session?.user) {
    return respondError(res, 401, req.t('unauthorized'));
  }
  return res.json({ user: req.session.user });
});

// ERP cache endpoints
app.get('/api/erp/customers', requireAuth(), async (req, res) => {
  const data = await readJson('customers.json', []);
  res.json(data);
});

app.get('/api/erp/addresses', requireAuth(), async (req, res) => {
  const data = await readJson('addresses.json', []);
  res.json(data);
});

app.get('/api/erp/contacts', requireAuth(), async (req, res) => {
  const data = await readJson('contacts.json', []);
  res.json(data);
});

app.get('/api/erp/items', requireAuth(), async (req, res) => {
  const data = await readJson('items.json', []);
  res.json(data);
});

app.get('/api/customers/:id/accessories', requireAuth(), async (req, res) => {
  const customerId = req.params.id;
  const customers = await loadCustomersData();
  const exists = customers.some((customer) => customer.id === customerId);
  if (!exists) {
    return respondError(res, 404, 'Kunde nicht gefunden');
  }
  const store = await loadCustomerAccessoriesData();
  const entry = findCustomerAccessoryEntry(store, customerId);
  res.json({
    customer_id: customerId,
    accessories: entry?.accessories || [],
    slots: ACCESSORY_SLOTS
  });
});

app.post('/api/customers/:id/accessories', requireAuth(), (req, res) => {
  accessoriesUpload.single('file')(req, res, async (err) => {
    if (err) {
      return respondError(res, 400, err.message);
    }
    const customerId = req.params.id;
    const slotKey = (req.body?.slot || '').toString().trim();
    if (!ACCESSORY_SLOT_KEYS.has(slotKey)) {
      return respondError(res, 400, 'Ungültiger Zubehörtyp');
    }
    const customers = await loadCustomersData();
    const exists = customers.some((customer) => customer.id === customerId);
    if (!exists) {
      return respondError(res, 404, 'Kunde nicht gefunden');
    }
    if (!req.file && !req.body?.image_url) {
      return respondError(res, 400, 'Bild erforderlich');
    }
    const store = await loadCustomerAccessoriesData();
    let entry = findCustomerAccessoryEntry(store, customerId);
    if (!entry) {
      entry = {
        customer_id: customerId,
        accessories: [],
        updated_at: null
      };
      store.push(entry);
    }
    const slotMeta = ACCESSORY_SLOT_MAP[slotKey] || {};
    const existingIdx = entry.accessories.findIndex((item) => item.slot === slotKey);
    const now = new Date().toISOString();
    const nextImage = req.file
      ? `/uploads/customers/${customerId}/accessories/${req.file.filename}`
      : (req.body?.image_url || '').toString().trim();
    const previousImage = existingIdx === -1 ? null : entry.accessories[existingIdx].image_url;
    const finalImage = nextImage || previousImage;
    if (!finalImage) {
      return respondError(res, 400, 'Bild erforderlich');
    }
    const previousFiles = existingIdx === -1 ? [] : entry.accessories[existingIdx].files || [];
    const payload = {
      id: existingIdx === -1 ? `acc-${randomUUID()}` : entry.accessories[existingIdx].id,
      slot: slotKey,
      title: (req.body?.title || '').trim() || slotMeta.label,
      description: (req.body?.description || '').trim() || slotMeta.description,
      image_url: finalImage,
      files: previousFiles,
      updated_at: now,
      updated_by: req.session.user?.email || req.session.user?.id || 'system'
    };
    if (existingIdx === -1) {
      entry.accessories.push(payload);
    } else {
      entry.accessories[existingIdx] = payload;
    }
    entry.updated_at = now;
    await saveCustomerAccessoriesData(store);
    res.json({ customer_id: customerId, accessories: entry.accessories, slot: slotKey });
  });
});

app.delete('/api/customers/:id/accessories/:slot', requireAuth(), async (req, res) => {
  const customerId = req.params.id;
  const slotKey = req.params.slot;
  if (!ACCESSORY_SLOT_KEYS.has(slotKey)) {
    return respondError(res, 400, 'Ungültiger Zubehörtyp');
  }
  const customers = await loadCustomersData();
  const exists = customers.some((customer) => customer.id === customerId);
  if (!exists) {
    return respondError(res, 404, 'Kunde nicht gefunden');
  }
  const store = await loadCustomerAccessoriesData();
  const entry = findCustomerAccessoryEntry(store, customerId);
  if (!entry) {
    return respondError(res, 404, 'Kein Zubehör hinterlegt');
  }
  const idx = entry.accessories.findIndex((item) => item.slot === slotKey);
  if (idx === -1) {
    return respondError(res, 404, 'Slot nicht belegt');
  }
  entry.accessories.splice(idx, 1);
  entry.updated_at = new Date().toISOString();
  if (!entry.accessories.length) {
    const entryIdx = store.findIndex((item) => item.customer_id === customerId);
    if (entryIdx !== -1) {
      store.splice(entryIdx, 1);
    }
  }
  await saveCustomerAccessoriesData(store);
  res.json({ customer_id: customerId, accessories: entry?.accessories || [] });
});

app.get('/api/customers/:id/packaging/:type', requireAuth(), async (req, res) => {
  const customerId = req.params.id;
  const type = (req.params.type || '').toLowerCase();
  if (!PACKAGING_TYPES.has(type)) {
    return respondError(res, 400, 'Ungültiger Packaging-Typ');
  }
  const customers = await loadCustomersData();
  const exists = customers.some((customer) => customer.id === customerId);
  if (!exists) {
    return respondError(res, 404, 'Kunde nicht gefunden');
  }
  const store = await loadCustomerPackagingData();
  const entry = findCustomerPackagingEntry(store, customerId, type);
  res.json({
    customer_id: customerId,
    type,
    cartons: entry?.cartons || [],
    sizes: entry?.sizes || [],
    defaults: entry?.defaults || null,
    updated_at: entry?.updated_at || null
  });
});

app.post('/api/customers/:id/packaging/:type', requireAuth(), async (req, res) => {
  const customerId = req.params.id;
  const type = (req.params.type || '').toLowerCase();
  if (!PACKAGING_TYPES.has(type)) {
    return respondError(res, 400, 'Ungültiger Packaging-Typ');
  }
  const customers = await loadCustomersData();
  const exists = customers.some((customer) => customer.id === customerId);
  if (!exists) {
    return respondError(res, 404, 'Kunde nicht gefunden');
  }
  const cartons = Array.isArray(req.body?.cartons) ? req.body.cartons : null;
  if (!cartons) {
    return respondError(res, 400, 'Carton-Daten erforderlich');
  }
  const payload = {
    cartons,
    sizes: Array.isArray(req.body?.sizes) ? req.body.sizes : [],
    defaults: req.body?.defaults || null
  };
  const store = await loadCustomerPackagingData();
  let entry = findCustomerPackagingEntry(store, customerId, type);
  if (!entry) {
    entry = {
      customer_id: customerId,
      type,
      cartons: [],
      sizes: [],
      defaults: null,
      updated_at: null,
      updated_by: null
    };
    store.push(entry);
  }
  entry.cartons = payload.cartons;
  entry.sizes = payload.sizes;
  entry.defaults = payload.defaults;
  entry.updated_at = new Date().toISOString();
  entry.updated_by = req.session.user?.email || req.session.user?.id || 'system';
  await saveCustomerPackagingData(store);
  res.json(entry);
});

app.post('/api/orders/:id/shoebox-labels/pdf', requireAuth(), async (req, res) => {
  const orderId = req.params.id;
  const labels = Array.isArray(req.body?.labels) ? req.body.labels : [];
  const seasonInput = (req.body?.season || '').toString().toUpperCase();
  const seasonYear = Number(req.body?.year);
  if (!SEASON_DIGIT_MAP[seasonInput]) {
    return respondError(res, 400, 'Ungültige Saison. Bitte FS oder HW wählen.');
  }
  if (!Number.isInteger(seasonYear) || seasonYear < 2000 || seasonYear > 2099) {
    return respondError(res, 400, 'Ungültiges Jahr für die EAN-Berechnung.');
  }
  if (!labels.length) {
    return respondError(res, 400, 'Keine Etiketten übermittelt');
  }
  const orders = await loadOrders();
  const order = orders.find((o) => o.id === orderId);
  if (!order) {
    return respondError(res, 404, 'Order nicht gefunden');
  }
  if (!orderMatchesSupplier(order, req.session.user)) {
    return respondError(res, 403, req.t('forbidden'));
  }
  const expanded = [];
  labels.forEach((label) => {
    const qty = Math.max(0, Math.floor(Number(label.quantity) || 0));
    for (let i = 0; i < qty; i += 1) {
      expanded.push({
        article_number: label.article_number || '',
        name: label.name || '',
        color_code: label.color_code || '',
        size: label.size || '',
        image_url: label.image_url || '',
        season_code: seasonInput,
        season_year: seasonYear
      });
    }
  });
  if (!expanded.length) {
    return respondError(res, 400, 'Keine Mengen hinterlegt');
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="schuhbox-${order.order_number || order.id}.pdf"`);
  const doc = new PDFDocument({ size: SHOEBOX_LABEL_SIZE, margin: 18 });
  doc.pipe(res);
  const imageCache = new Map();
  for (let i = 0; i < expanded.length; i += 1) {
    if (i > 0) doc.addPage({ size: SHOEBOX_LABEL_SIZE, margin: 18 });
    await drawShoeboxLabel(doc, expanded[i], imageCache);
  }
  doc.end();
});

app.get('/api/erp/orders', requireAuth(), async (req, res) => {
  const orders = await loadOrders();
  const filtered = orders.filter(buildOrderFilter(req.query, req.session.user));
  res.json(filtered);
});

app.get('/api/erp/orders/:id', requireAuth(), async (req, res) => {
  const orders = await loadOrders();
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) {
    return respondError(res, 404, 'Order nicht gefunden');
  }
  if (!orderMatchesSupplier(order, req.session.user)) {
    return respondError(res, 403, req.t('forbidden'));
  }
  res.json(order);
});

// Portal orders
app.get('/api/orders', requireAuth(), async (req, res) => {
  const orders = await loadOrders();
  const filtered = orders.filter(buildOrderFilter(req.query, req.session.user));
  res.json(filtered);
});

app.get('/api/orders/:id', requireAuth(), async (req, res) => {
  const [orders, specs, tickets, logs] = await Promise.all([
    loadOrders(),
    loadSpecs(),
    readJson('tickets.json', []),
    readJson('status_logs.json', [])
  ]);
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) {
    return respondError(res, 404, 'Order nicht gefunden');
  }
  if (!orderMatchesSupplier(order, req.session.user)) {
    return respondError(res, 403, req.t('forbidden'));
  }
  let specsUpdated = false;
  const orderSpecs = specs.filter((spec) => {
    if (spec.order_id === order.id) {
      if (ensureSpecMediaAssignments(spec)) {
        specsUpdated = true;
      }
      return true;
    }
    return false;
  });
  if (specsUpdated) {
    await saveSpecs(specs);
  }
  const orderTickets = tickets.filter((ticket) => ticket.order_id === order.id);
  const timelineLogs = logs.filter((log) => log.order_id === order.id);
  res.json({
    ...order,
    specs: orderSpecs,
    tickets: orderTickets,
    audit: timelineLogs
  });
});

app.get('/api/orders/:id/tickets', requireAuth(), async (req, res) => {
  try {
    const order = await ensureOrderAccess(req.params.id, req.session.user);
    const tickets = await loadTicketsData();
    const orderTickets = tickets.filter((ticket) => ticket.order_id === order.id);
    res.json(orderTickets);
  } catch (err) {
    respondError(res, err.statusCode || 500, err.message || 'Tickets konnten nicht geladen werden.');
  }
});

app.get('/api/orders/:id/print-options', requireAuth(), async (req, res) => {
  if (!isErpClientEnabled()) {
    return respondError(res, 503, 'ERP Print-Service ist nicht konfiguriert.');
  }
  try {
    const order = await ensureOrderAccess(req.params.id, req.session.user);
    const docType = 'Purchase Order';
    const [formats, letterheads] = await Promise.all([fetchPrintFormats(docType), fetchLetterheads()]);
    const languages = SUPPORTED_LOCALES.map((code) => ({
      code,
      label: LOCALE_LABELS[code] || code.toUpperCase()
    }));
    const defaultFormat = order.print_format;
    const defaultLetterhead = order.letter_head;
    const defaultLanguage = languages.some((entry) => entry.code === order.language)
      ? order.language
      : DEFAULT_LOCALE;
    res.json({
      order_id: order.id,
      doc_type: docType,
      formats,
      letterheads,
      languages,
      defaults: {
        format:
          (formats || []).find((entry) => entry.value === defaultFormat)?.value ||
          formats[0]?.value ||
          null,
        letterhead:
          (letterheads || []).find((entry) => entry.value === defaultLetterhead)?.value || null,
        language: defaultLanguage
      }
    });
  } catch (err) {
    respondError(res, err.statusCode || 500, err.message || 'Druckoptionen konnten nicht geladen werden.');
  }
});

app.post('/api/orders/:id/print/pdf', requireAuth(), async (req, res) => {
  if (!isErpClientEnabled()) {
    return respondError(res, 503, 'ERP Print-Service ist nicht konfiguriert.');
  }
  try {
    const order = await ensureOrderAccess(req.params.id, req.session.user);
    const { format, letterhead, language } = req.body || {};
    if (!format) {
      return respondError(res, 400, 'Druckformat erforderlich');
    }
    const buffer = await downloadPrintPdf('Purchase Order', order.id, {
      format,
      letterhead,
      language
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${order.id}.pdf"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    respondError(res, err.statusCode || 500, err.message || 'PDF konnte nicht erstellt werden');
  }
});

app.get('/api/orders/:id/label', requireAuth(), async (req, res) => {
  const orders = await loadOrders();
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) {
    return respondError(res, 404, 'Order nicht gefunden');
  }
  if (!orderMatchesSupplier(order, req.session.user)) {
    return respondError(res, 403, req.t('forbidden'));
  }
  const shippingCartons = Number(order.shipping?.cartons_total) || order.cartons?.length || 1;
  const requestedTotal = Number(req.query.cartonTotal);
  const cartonTotal = Number.isFinite(requestedTotal) && requestedTotal > 0 ? requestedTotal : shippingCartons;
  const requestedNumber = Number(req.query.cartonNumber);
  let cartonNumber = Number.isFinite(requestedNumber) && requestedNumber > 0 ? requestedNumber : 1;
  if (cartonNumber > cartonTotal) {
    cartonNumber = cartonTotal;
  }
  try {
    const payload = await buildLabelResponse({
      order,
      cartonNumber,
      cartonTotal
    });
    res.json(payload);
  } catch (err) {
    respondError(res, 500, err.message);
  }
});

app.post('/api/orders/:id/label', requireAuth(), async (req, res) => {
  const orders = await loadOrders();
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) {
    return respondError(res, 404, 'Order nicht gefunden');
  }
  if (!orderMatchesSupplier(order, req.session.user)) {
    return respondError(res, 403, req.t('forbidden'));
  }
  const { cartonNumber, cartonTotal, size_table, variation, article, leather, sole } = req.body || {};
  const total = Number(cartonTotal) || Number(order.shipping?.cartons_total) || order.cartons?.length || 1;
  const number = Number(cartonNumber) || 1;
  try {
    const payload = await buildLabelResponse({
      order,
      cartonNumber: number,
      cartonTotal: total,
      sizeTableOverride: size_table,
      overrides: { variation, article, leather, sole }
    });
    res.json(payload);
  } catch (err) {
    respondError(res, 500, err.message);
  }
});

app.post('/api/orders/:id/label/batch', requireAuth(), async (req, res) => {
  const orders = await loadOrders();
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) {
    return respondError(res, 404, 'Order nicht gefunden');
  }
  if (!orderMatchesSupplier(order, req.session.user)) {
    return respondError(res, 403, req.t('forbidden'));
  }
  const { cartons } = req.body || {};
  if (!Array.isArray(cartons) || !cartons.length) {
    return respondError(res, 400, 'cartons array erforderlich');
  }
  try {
    const payloads = await Promise.all(
      cartons.map((carton) =>
        buildLabelResponse({
          order,
          cartonNumber: Number(carton.cartonNumber) || 1,
          cartonTotal: Number(carton.cartonTotal) || Number(order.shipping?.cartons_total) || cartons.length,
          sizeTableOverride: carton.size_table,
          overrides: {
            variation: carton.variation,
            article: carton.article,
            leather: carton.leather,
            sole: carton.sole
          }
        })
      )
    );
    res.json(payloads);
  } catch (err) {
    respondError(res, 500, err.message);
  }
});

app.post('/api/orders/:id/label/batch/pdf', requireAuth(), async (req, res) => {
  const orders = await loadOrders();
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) {
    return respondError(res, 404, 'Order nicht gefunden');
  }
  if (!orderMatchesSupplier(order, req.session.user)) {
    return respondError(res, 403, req.t('forbidden'));
  }
  const { cartons } = req.body || {};
  if (!Array.isArray(cartons) || !cartons.length) {
    return respondError(res, 400, 'cartons array erforderlich');
  }
  try {
    const payloads = await Promise.all(
      cartons.map((carton) =>
        buildLabelResponse({
          order,
          cartonNumber: Number(carton.cartonNumber) || 1,
          cartonTotal: Number(carton.cartonTotal) || Number(order.shipping?.cartons_total) || cartons.length,
          sizeTableOverride: carton.size_table,
          overrides: {
            variation: carton.variation,
            article: carton.article,
            leather: carton.leather,
            sole: carton.sole
          }
        })
      )
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="labels-${order.id}.pdf"`);
    const doc = new PDFDocument({ margin: 40, autoFirstPage: false });
    doc.pipe(res);
    payloads.forEach((label) => {
      doc.addPage({ size: 'A4', margin: 40 });
      drawLabelPage(doc, label);
    });
    doc.end();
  } catch (err) {
    respondError(res, 500, err.message);
  }
});

app.post('/api/proforma/export', requireAuth(), async (req, res) => {
  try {
    let proforma = normalizeProformaPayload(req.body);
    const entry = await persistProformaEntry(proforma, req.session.user, proforma.meta?.id || null);
    proforma = entry.payload;
    const { document, seller, buyer, shipping, items, totals } = proforma;
    res.setHeader('X-Proforma-Id', entry.id);
    res.setHeader('X-Proforma-Number', entry.number);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'BATE Supplier Portal';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('Muster Proforma', {
      properties: { defaultColWidth: 18 }
    });
    sheet.columns = [
      { key: 'colA', width: 6 },
      { key: 'colB', width: 18 },
      { key: 'colC', width: 32 },
      { key: 'colD', width: 20 },
      { key: 'colE', width: 12 },
      { key: 'colF', width: 12 },
      { key: 'colG', width: 14 },
      { key: 'colH', width: 10 },
      { key: 'colI', width: 15 },
      { key: 'colJ', width: 15 },
      { key: 'colK', width: 15 }
    ];

    const bold = { bold: true };
    const wrap = { wrapText: true };
    let currentRow = 1;
    sheet.mergeCells(`A${currentRow}:J${currentRow}`);
    sheet.getCell(`A${currentRow}`).value = 'Muster Proforma / Proforma Invoice';
    sheet.getCell(`A${currentRow}`).font = { bold: true, size: 16 };
    sheet.getCell(`A${currentRow}`).alignment = { horizontal: 'center' };
    currentRow += 2;

    const docRows = [
      ['Referenz', document.reference || '-', 'Datum', document.date ? new Date(document.date) : null],
      ['Rechnungsnummer', document.invoiceNumber || '-', 'Währung', document.currency || 'EUR'],
      ['Zahlungsziel', document.paymentTerms || '-', 'Incoterm', shipping.incoterm || '-']
    ];
    docRows.forEach(([leftLabel, leftValue, rightLabel, rightValue]) => {
      sheet.getCell(`A${currentRow}`).value = leftLabel;
      sheet.getCell(`A${currentRow}`).font = bold;
      sheet.mergeCells(`B${currentRow}:C${currentRow}`);
      sheet.getCell(`B${currentRow}`).value = leftValue || '-';
      sheet.getCell(`D${currentRow}`).value = '';
      sheet.getCell(`E${currentRow}`).value = rightLabel;
      sheet.getCell(`E${currentRow}`).font = bold;
      sheet.mergeCells(`F${currentRow}:J${currentRow}`);
      if (rightValue instanceof Date) {
        sheet.getCell(`F${currentRow}`).value = rightValue;
        sheet.getCell(`F${currentRow}`).numFmt = 'dd.mm.yyyy';
      } else {
        sheet.getCell(`F${currentRow}`).value = rightValue || '-';
      }
      currentRow += 1;
    });
    currentRow += 1;

    const sellerLines = collectPartyLines(seller).map((line) => line.replace(/\r?\n/g, ' · '));
    const buyerLines = collectPartyLines(buyer).map((line) => line.replace(/\r?\n/g, ' · '));
    const infoRows = Math.max(sellerLines.length, buyerLines.length, 1);
    sheet.mergeCells(`A${currentRow}:C${currentRow}`);
    sheet.getCell(`A${currentRow}`).value = 'Verkäufer';
    sheet.getCell(`A${currentRow}`).font = bold;
    sheet.mergeCells(`E${currentRow}:J${currentRow}`);
    sheet.getCell(`E${currentRow}`).value = 'Kunde';
    sheet.getCell(`E${currentRow}`).font = bold;
    currentRow += 1;
    for (let rowIndex = 0; rowIndex < infoRows; rowIndex += 1) {
      const sellerValue = sellerLines[rowIndex] || '';
      const buyerValue = buyerLines[rowIndex] || '';
      sheet.mergeCells(`A${currentRow + rowIndex}:C${currentRow + rowIndex}`);
      sheet.getCell(`A${currentRow + rowIndex}`).value = sellerValue || '-';
      sheet.getCell(`A${currentRow + rowIndex}`).alignment = wrap;
      sheet.mergeCells(`E${currentRow + rowIndex}:J${currentRow + rowIndex}`);
      sheet.getCell(`E${currentRow + rowIndex}`).value = buyerValue || '-';
      sheet.getCell(`E${currentRow + rowIndex}`).alignment = wrap;
    }
    currentRow += infoRows + 1;

    const shippingRows = [
      ['Transportiert durch', shipping.transportedBy],
      ['Versandart / Shipment', shipping.shipmentInfo],
      ['Datum', document.date ? new Date(document.date) : null],
      ['Ort / Place', shipping.place]
    ];
    sheet.mergeCells(`A${currentRow}:C${currentRow}`);
    sheet.getCell(`A${currentRow}`).value = 'Versanddetails';
    sheet.getCell(`A${currentRow}`).font = bold;
    currentRow += 1;
    shippingRows.forEach(([label, value]) => {
      sheet.getCell(`A${currentRow}`).value = label;
      sheet.getCell(`A${currentRow}`).font = bold;
      sheet.mergeCells(`B${currentRow}:J${currentRow}`);
      if (value instanceof Date) {
        sheet.getCell(`B${currentRow}`).value = value;
        sheet.getCell(`B${currentRow}`).numFmt = 'dd.mm.yyyy';
      } else {
        sheet.getCell(`B${currentRow}`).value = value || '-';
      }
      sheet.getCell(`B${currentRow}`).alignment = wrap;
      currentRow += 1;
    });
    currentRow += 1;

    const headerRow = currentRow;
    const tableHeaders = [
      null,
      'Pos.',
      'Artikel',
      'Beschreibung',
      'Menge',
      'Einheit',
      'Einzelpreis',
      'MwSt',
      'Netto',
      'Steuer',
      'Brutto'
    ];
    sheet.getRow(headerRow).values = tableHeaders;
    sheet.getRow(headerRow).font = bold;
    sheet.getRow(headerRow).alignment = { horizontal: 'center' };

    const firstItemRow = headerRow + 1;
    items.forEach((item, index) => {
      const rowNumber = firstItemRow + index;
      const lineNet = item.quantity * item.unitPrice;
      const lineTax = lineNet * item.vatRate;
      const articleLabel = [item.articleNumber, item.color ? `Color: ${item.color}` : null].filter(Boolean).join('\n');
      const descriptionLabel = [item.description, item.size ? `Size: ${item.size}` : null, item.materials || null]
        .filter(Boolean)
        .join('\n');
      sheet.getRow(rowNumber).values = [
        null,
        item.position,
        articleLabel,
        descriptionLabel,
        item.quantity,
        item.unit,
        item.unitPrice,
        item.vatRate,
        { formula: `D${rowNumber}*F${rowNumber}`, result: lineNet },
        { formula: `H${rowNumber}*G${rowNumber}`, result: lineTax },
        { formula: `H${rowNumber}+I${rowNumber}`, result: lineNet + lineTax }
      ];
      sheet.getCell(`D${rowNumber}`).numFmt = '#,##0.00';
      sheet.getCell(`F${rowNumber}`).numFmt = '#,##0.00';
      sheet.getCell(`G${rowNumber}`).numFmt = '0%';
      [`H${rowNumber}`, `I${rowNumber}`, `J${rowNumber}`].forEach((cellRef) => {
        sheet.getCell(cellRef).numFmt = '#,##0.00';
      });
      sheet.getCell(`C${rowNumber}`).alignment = wrap;
      sheet.getCell(`D${rowNumber}`).alignment = wrap;
    });

    const lastItemRow = firstItemRow + items.length - 1;
    const summaryStart = lastItemRow + 2;
    const summaryLabels = [
      ['Zwischensumme', totals.net],
      ['Steuerbetrag', totals.tax],
      ['Gesamtbetrag', totals.gross],
      ['Deklarierter Wert', totals.declared]
    ];
    summaryLabels.forEach(([label, value], idx) => {
      const rowNumber = summaryStart + idx;
      sheet.mergeCells(`G${rowNumber}:I${rowNumber}`);
      sheet.getCell(`G${rowNumber}`).value = label;
      sheet.getCell(`G${rowNumber}`).font = bold;
      sheet.getCell(`G${rowNumber}`).alignment = { horizontal: 'right' };
      sheet.getCell(`J${rowNumber}`).value = value;
      sheet.getCell(`J${rowNumber}`).numFmt = '#,##0.00';
    });

    const safeReference = (document.reference || '')
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '')
      .slice(0, 32);
    const filename = safeReference ? `musterrechnung-${safeReference}.xlsx` : `musterrechnung-${Date.now()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    if (err?.statusCode) {
      return respondError(res, err.statusCode, err.message);
    }
    respondError(res, 500, err.message);
  }
});

app.post('/api/proforma/export/pdf', requireAuth(), async (req, res) => {
  try {
    let proforma = normalizeProformaPayload(req.body);
    const entry = await persistProformaEntry(proforma, req.session.user, proforma.meta?.id || null);
    proforma = entry.payload;
    const reference = (proforma.document.reference || 'musterrechnung')
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '')
      .slice(0, 32);
    const filename = reference ? `musterrechnung-${reference}.pdf` : `musterrechnung-${Date.now()}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Proforma-Id', entry.id);
    res.setHeader('X-Proforma-Number', entry.number);
    const doc = new PDFDocument({ size: 'A4', margin: 48, layout: 'landscape' });
    doc.pipe(res);
    buildProformaPdf(doc, proforma);
    doc.end();
  } catch (err) {
    if (err?.statusCode) {
      return respondError(res, err.statusCode, err.message);
    }
    respondError(res, 500, err.message);
  }
});

app.post('/api/proforma', requireAuth(), async (req, res) => {
  try {
    let proforma = normalizeProformaPayload(req.body);
    const entry = await persistProformaEntry(proforma, req.session.user, proforma.meta?.id || null);
    res.json({
      id: entry.id,
      number: entry.number,
      reference: entry.payload?.document?.reference || '-',
      date: entry.payload?.document?.date || null,
      customer: entry.payload?.buyer?.name || '-',
      created_at: entry.created_at,
      updated_at: entry.updated_at,
      payload: entry.payload
    });
  } catch (err) {
    if (err?.statusCode) {
      return respondError(res, err.statusCode, err.message);
    }
    respondError(res, 500, err.message);
  }
});

app.get('/api/proforma', requireAuth(), async (req, res) => {
  try {
    const entries = await loadProformaEntries();
    const result = entries
      .slice()
      .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
      .map((entry) => ({
        id: entry.id,
        number: entry.number,
        reference: entry.payload?.document?.reference || '-',
        date: entry.payload?.document?.date || null,
        total_quantity: (entry.payload?.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
        customer: entry.payload?.buyer?.name || '-',
        created_at: entry.created_at,
        updated_at: entry.updated_at
      }));
    res.json(result);
  } catch (err) {
    respondError(res, 500, err.message);
  }
});

app.get('/api/proforma/:id', requireAuth(), async (req, res) => {
  try {
    const entries = await loadProformaEntries();
    const entry = entries.find((item) => item.id === req.params.id);
    if (!entry) {
      return respondError(res, 404, 'Muster Proforma nicht gefunden');
    }
    res.json({
      id: entry.id,
      number: entry.number,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
      payload: entry.payload
    });
  } catch (err) {
    respondError(res, 500, err.message);
  }
});

app.delete('/api/proforma/:id', requireAuth(), async (req, res) => {
  try {
    const entries = await loadProformaEntries();
    const index = entries.findIndex((entry) => entry.id === req.params.id);
    if (index === -1) {
      return respondError(res, 404, 'Muster Proforma nicht gefunden');
    }
    const [removed] = entries.splice(index, 1);
    await writeProformaEntries(entries);
    res.json({ id: removed.id, number: removed.number });
  } catch (err) {
    respondError(res, 500, err.message);
  }
});

app.post('/api/orders', requireBate(), async (req, res) => {
  try {
    const sanitizedPayload = sanitizeOrderCreatePayload(req.body || {});
    const existingOrders = await loadOrders();
    if (
      sanitizedPayload.order_number &&
      existingOrders.some((order) => order.id === sanitizedPayload.order_number)
    ) {
      return respondError(res, 409, 'Bestellnummer ist bereits vergeben');
    }
    const erpDoc = await buildErpPurchaseOrderDoc(
      {
        ...sanitizedPayload,
        existingOrders
      },
      { docstatus: 0 }
    );
    const erpResult = await createPurchaseOrder(erpDoc);
    const orderId = erpResult?.name || sanitizedPayload.order_number || null;
    let createdOrder = null;
    try {
      await syncERPData();
      const refreshedOrders = await loadOrders();
      if (orderId) {
        createdOrder = refreshedOrders.find((order) => order.id === orderId) || null;
      }
    } catch (syncErr) {
      console.warn('Sync nach Bestellung fehlgeschlagen', syncErr.message);
    }
    if (createdOrder) {
      const timelineEntry = buildPortalTimelineEntry(
        'ORDER_CREATED',
        'Bestellung im Portal angelegt',
        req.session.user?.email
      );
      const updatedOrder = await appendOrderTimelineEntry(orderId, timelineEntry, 'ORDER_CREATED', req.session.user?.id);
      return res.status(201).json(updatedOrder || createdOrder);
    }
    return res.status(201).json({
      id: orderId,
      order_number: orderId,
      portal_status: sanitizedPayload.portal_status,
      message: 'Bestellung wurde angelegt. Daten werden nach dem nächsten Sync aktualisiert.'
    });
  } catch (err) {
    const status = err.statusCode || err.response?.status || 400;
    const message = extractErpErrorMessage(err) || err.message || 'Bestellung konnte nicht angelegt werden';
    return respondError(res, status, message);
  }
});

app.patch('/api/orders/:id', requireAuth(), async (req, res, next) => {
  const { nextStatus, order_type, full_update } = req.body;
  if (!nextStatus && !order_type && !full_update) {
    return respondError(res, 400, 'Keine Änderungen angegeben');
  }
  try {
    const orders = await loadOrders();
    const order = orders.find((o) => o.id === req.params.id);
    if (!order) {
      return respondError(res, 404, 'Order nicht gefunden');
    }
    if (!orderMatchesSupplier(order, req.session.user)) {
      return respondError(res, 403, req.t('forbidden'));
    }
    if (req.session.user.role !== 'BATE' && order.supplier_id !== req.session.user.supplier_id) {
      return respondError(res, 403, req.t('forbidden'));
    }
    if (full_update) {
      if (req.session.user.role !== 'BATE') {
        return respondError(res, 403, req.t('forbidden'));
      }
      try {
        const sanitizedPayload = sanitizeOrderCreatePayload({
          ...full_update,
          order_number: order.id,
          naming_series: full_update.naming_series || order.naming_series || null
        });
        sanitizedPayload.order_number = order.id;
        sanitizedPayload.naming_series = order.naming_series || sanitizedPayload.naming_series;
        const erpDoc = await buildErpPurchaseOrderDoc(
          {
            ...sanitizedPayload,
            existingOrders: orders
          },
          { docstatus: order.docstatus ?? 0 }
        );
        await updatePurchaseOrder(order.id, erpDoc);
        await syncERPData();
        const refreshed = await loadOrders();
        const updatedOrder = refreshed.find((entry) => entry.id === order.id);
        const timelineEntry = buildPortalTimelineEntry(
          'ORDER_UPDATED',
          'Bestellung im Portal bearbeitet',
          req.session.user?.email
        );
        const orderWithTimeline = await appendOrderTimelineEntry(
          order.id,
          timelineEntry,
          'ORDER_UPDATED',
          req.session.user?.id
        );
        return res.json(orderWithTimeline || updatedOrder || normalizePortalOrder(order));
      } catch (err) {
        const status = err.statusCode || err.response?.status || 400;
        const message = extractErpErrorMessage(err) || err.message || 'Bestellung konnte nicht aktualisiert werden';
        return respondError(res, status, message);
      }
    }
    if (nextStatus) {
      const updated = await updateOrderWorkflow({
        orderId: order.id,
        nextStatus,
        actor: req.session.user.email
      });
      return res.json(updated);
    }
    order.order_type = order_type || order.order_type;
    await writeJson('purchase_orders.json', orders);
    res.json(normalizePortalOrder(order));
  } catch (err) {
    next(err);
  }
});

app.get('/api/orders/:id/workflow', requireAuth(), async (req, res) => {
  const orders = await loadOrders();
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) {
    return respondError(res, 404, 'Order nicht gefunden');
  }
  if (!orderMatchesSupplier(order, req.session.user)) {
    return respondError(res, 403, req.t('forbidden'));
  }
  res.json({
    definition: getWorkflowDefinition(),
    order
  });
});

app.post('/api/orders/:id/comments', requireAuth(), async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return respondError(res, 400, 'Kommentar darf nicht leer sein');
  }
  const orders = await loadOrders();
  const idx = orders.findIndex((o) => o.id === req.params.id);
  if (idx === -1) {
    return respondError(res, 404, 'Order nicht gefunden');
  }
  const order = orders[idx];
  if (!orderMatchesSupplier(order, req.session.user)) {
    return respondError(res, 403, req.t('forbidden'));
  }
  const entry = {
    id: `tl-${randomUUID()}`,
    type: 'COMMENT',
    message,
    actor: req.session.user.email,
    created_at: new Date().toISOString()
  };
  order.timeline = order.timeline || [];
  order.timeline.push(entry);
  orders[idx] = order;
  await writeJson('purchase_orders.json', orders);
  await appendToArray('status_logs.json', {
    id: `LOG-${randomUUID()}`,
    order_id: order.id,
    action: 'COMMENT',
    actor: req.session.user.id,
    ts: entry.created_at
  });
  res.status(201).json(entry);
});

app.post('/api/orders/:id/upload', requireAuth(), upload.single('file'), async (req, res) => {
  const orders = await loadOrders();
  const idx = orders.findIndex((o) => o.id === req.params.id);
  if (idx === -1) {
    return respondError(res, 404, 'Order nicht gefunden');
  }
  if (!req.file) {
    return respondError(res, 400, 'Datei fehlt');
  }
  const order = orders[idx];
  if (!orderMatchesSupplier(order, req.session.user)) {
    return respondError(res, 403, req.t('forbidden'));
  }
  const fileEntry = {
    id: `file-${randomUUID()}`,
    type: 'FILE_UPLOAD',
    filename: req.file?.filename,
    path: req.file?.path.replace(process.cwd(), ''),
    actor: req.session.user.email,
    created_at: new Date().toISOString()
  };
  order.timeline = order.timeline || [];
  order.timeline.push(fileEntry);
  orders[idx] = order;
  await writeJson('purchase_orders.json', orders);
  await appendToArray('status_logs.json', {
    id: `LOG-${randomUUID()}`,
    order_id: order.id,
    action: 'FILE_UPLOAD',
    actor: req.session.user.id,
    ts: fileEntry.created_at
  });
  res.status(201).json(fileEntry);
});

// Specs
async function findOrCreateSpec(orderId, positionId, options = {}) {
  const specs = await loadSpecs();
  let spec = specs.find((s) => s.order_id === orderId && s.position_id === positionId);
  const isNewSpec = !spec;
  if (!spec) {
    spec = {
      order_id: orderId,
      position_id: positionId,
      flags: {
        verstanden: false,
        fertig: false,
        rueckfragen: 0,
        kommentare: [],
        medien: []
      },
      files: [],
      last_actor: null,
      updated_at: new Date().toISOString()
    };
    specs.push(spec);
  }
  let updated = isNewSpec;
  if (ensureSpecMediaAssignments(spec)) {
    updated = true;
  }
  if (await ensureSpecViewerMedia(spec, orderId, positionId, options.order)) {
    updated = true;
  }
  if (updated) {
    await saveSpecs(specs);
  }
  return { spec, specs };
}

app.get('/api/specs/:orderId/:positionId', requireAuth(), async (req, res) => {
  const { orderId, positionId } = req.params;
  let order;
  try {
    order = await ensureOrderAccess(orderId, req.session.user);
  } catch (err) {
    return respondError(res, err.statusCode || 500, err.message);
  }
  try {
    const { spec } = await findOrCreateSpec(orderId, positionId, { order });
    res.json(spec);
  } catch (err) {
    respondError(res, err.statusCode || 500, err.message);
  }
});

app.post('/api/specs/:orderId/:positionId/comment', requireAuth(), async (req, res) => {
  const { message } = req.body;
  if (!message) return respondError(res, 400, 'Kommentar fehlt');
  const { orderId, positionId } = req.params;
  let order;
  try {
    order = await ensureOrderAccess(orderId, req.session.user);
  } catch (err) {
    return respondError(res, err.statusCode || 500, err.message);
  }
  const { spec, specs } = await findOrCreateSpec(orderId, positionId, { order });
  const comment = {
    id: `sc-${randomUUID()}`,
    author: req.session.user.email,
    message,
    ts: new Date().toISOString()
  };
  spec.flags.kommentare = spec.flags.kommentare || [];
  spec.flags.kommentare.push(comment);
  spec.last_actor = req.session.user.email;
  spec.updated_at = comment.ts;
  await saveSpecs(specs);
  await appendToArray('status_logs.json', {
    id: `LOG-${randomUUID()}`,
    order_id: orderId,
    position_id: positionId,
    action: 'SPEC_COMMENT',
    actor: req.session.user.id,
    ts: comment.ts
  });
  res.status(201).json(comment);
});

app.post('/api/specs/:orderId/:positionId/upload', requireAuth(), upload.single('file'), async (req, res) => {
  if (!req.file) return respondError(res, 400, 'Datei fehlt');
  const { orderId, positionId } = req.params;
  let order;
  try {
    order = await ensureOrderAccess(orderId, req.session.user);
  } catch (err) {
    return respondError(res, err.statusCode || 500, err.message);
  }
  const { spec, specs } = await findOrCreateSpec(orderId, positionId, { order });
  const fileEntry = {
    id: `file-${randomUUID()}`,
    filename: req.file.filename,
    version: (spec.files?.length || 0) + 1,
    uploaded_by: req.session.user.email,
    ts: new Date().toISOString()
  };
  spec.files = spec.files || [];
  spec.files.push(fileEntry);
  spec.flags.medien = spec.flags.medien || [];
  const viewKey = resolveTechpackViewKey(req.body?.view_key, spec.flags.medien);
  const viewMeta = TECHPACK_VIEWS.find((view) => view.key === viewKey);
  const mediaLabel = req.body?.view_label || viewMeta?.label || req.file.originalname;
  removePlaceholderMediaEntry(spec, viewKey);
  const mediaEntry = {
    id: fileEntry.id,
    label: mediaLabel,
    filename: req.file.originalname,
    view_key: viewKey,
    status: 'OPEN',
    url: `/uploads/orders/${orderId}/positions/${positionId}/${req.file.filename}`
  };
  spec.flags.medien.push(mediaEntry);
  reassignPlaceholderAnnotations(spec, viewKey, mediaEntry.id);
  spec.last_actor = req.session.user.email;
  spec.updated_at = fileEntry.ts;
  await saveSpecs(specs);
  await appendToArray('status_logs.json', {
    id: `LOG-${randomUUID()}`,
    order_id: orderId,
    position_id: positionId,
    action: 'SPEC_UPLOAD',
    actor: req.session.user.id,
    ts: fileEntry.ts
  });
  res.status(201).json(fileEntry);
});

app.post('/api/specs/:orderId/:positionId/media/:mediaId/replace', requireAuth(), upload.single('file'), async (req, res) => {
  if (!req.file) return respondError(res, 400, 'Datei fehlt');
  const { orderId, positionId, mediaId } = req.params;
  let order;
  try {
    order = await ensureOrderAccess(orderId, req.session.user);
  } catch (err) {
    return respondError(res, err.statusCode || 500, err.message);
  }
  const { spec, specs } = await findOrCreateSpec(orderId, positionId, { order });
  const mediaEntry = spec.flags.medien?.find((entry) => entry.id === mediaId);
  if (!mediaEntry) {
    return respondError(res, 404, 'Media nicht gefunden');
  }
  const timestamp = new Date().toISOString();
  const fileEntry = {
    id: `file-${randomUUID()}`,
    filename: req.file.filename,
    version: (spec.files?.length || 0) + 1,
    uploaded_by: req.session.user.email,
    ts: timestamp
  };
  spec.files = spec.files || [];
  spec.files.push(fileEntry);
  const oldUrl = mediaEntry.url;
  mediaEntry.filename = req.file.originalname;
  mediaEntry.label = req.body?.view_label || mediaEntry.label || req.file.originalname;
  mediaEntry.url = `/uploads/orders/${orderId}/positions/${positionId}/${req.file.filename}`;
  mediaEntry.status = 'OPEN';
  spec.last_actor = req.session.user.email;
  spec.updated_at = timestamp;
  await saveSpecs(specs);
  await appendToArray('status_logs.json', {
    id: `LOG-${randomUUID()}`,
    order_id: orderId,
    position_id: positionId,
    action: 'SPEC_MEDIA_REPLACED',
    actor: req.session.user.id,
    ts: timestamp,
    data: {
      media_id: mediaId
    }
  });
  if (oldUrl?.startsWith('/uploads')) {
    const relative = oldUrl.replace('/uploads', '');
    const absolutePath = path.join(UPLOAD_ROOT, relative);
    await fs.unlink(absolutePath).catch(() => null);
  }
  res.json({
    id: mediaEntry.id,
    label: mediaEntry.label,
    url: mediaEntry.url,
    status: mediaEntry.status
  });
});

app.delete('/api/specs/:orderId/:positionId/media/:mediaId', requireAuth(), async (req, res) => {
  const { orderId, positionId, mediaId } = req.params;
  let order;
  try {
    order = await ensureOrderAccess(orderId, req.session.user);
  } catch (err) {
    return respondError(res, err.statusCode || 500, err.message);
  }
  const { spec, specs } = await findOrCreateSpec(orderId, positionId, { order });
  const mediaEntry = spec.flags.medien?.find((entry) => entry.id === mediaId);
  if (!mediaEntry) {
    return respondError(res, 404, 'Media nicht gefunden');
  }
  spec.flags.medien = spec.flags.medien.filter((entry) => entry.id !== mediaId);
  spec.annotations = (spec.annotations || []).filter((ann) => ann.media_id !== mediaId);
  spec.last_actor = req.session.user.email;
  spec.updated_at = new Date().toISOString();
  await saveSpecs(specs);
  await appendToArray('status_logs.json', {
    id: `LOG-${randomUUID()}`,
    order_id: orderId,
    position_id: positionId,
    action: 'SPEC_MEDIA_DELETE',
    actor: req.session.user.id,
    ts: spec.updated_at,
    data: { media_id: mediaId }
  });
  if (mediaEntry.url?.startsWith('/uploads')) {
    const relative = mediaEntry.url.replace('/uploads', '');
    const absolutePath = path.join(UPLOAD_ROOT, relative);
    await fs.unlink(absolutePath).catch(() => null);
  }
  res.status(204).end();
});

app.patch('/api/specs/:orderId/:positionId/flags', requireAuth(), async (req, res) => {
  const { orderId, positionId } = req.params;
  const { verstanden, fertig, rueckfragenIncrement = 0 } = req.body;
  let order;
  try {
    order = await ensureOrderAccess(orderId, req.session.user);
  } catch (err) {
    return respondError(res, err.statusCode || 500, err.message);
  }
  const { spec, specs } = await findOrCreateSpec(orderId, positionId, { order });
  if (typeof verstanden === 'boolean') spec.flags.verstanden = verstanden;
  if (typeof fertig === 'boolean') spec.flags.fertig = fertig;
  if (typeof rueckfragenIncrement === 'number') spec.flags.rueckfragen = (spec.flags.rueckfragen || 0) + rueckfragenIncrement;
  spec.last_actor = req.session.user.email;
  spec.updated_at = new Date().toISOString();
  await saveSpecs(specs);
  await appendToArray('status_logs.json', {
    id: `LOG-${randomUUID()}`,
    order_id: orderId,
    position_id: positionId,
    action: 'SPEC_FLAGS',
    actor: req.session.user.id,
    ts: spec.updated_at
  });
  res.json(spec);
});

app.post('/api/specs/:orderId/:positionId/annotations', requireAuth(), async (req, res) => {
  const { orderId, positionId } = req.params;
  const { mediaId, x, y, note } = req.body || {};
  if (!mediaId || typeof x !== 'number' || typeof y !== 'number' || !note) {
    return respondError(res, 400, 'mediaId, x, y und note sind Pflichtfelder');
  }
  if (x < 0 || x > 1 || y < 0 || y > 1) {
    return respondError(res, 400, 'Koordinaten müssen zwischen 0 und 1 liegen');
  }
  let order;
  try {
    order = await ensureOrderAccess(orderId, req.session.user);
  } catch (err) {
    return respondError(res, err.statusCode || 500, err.message);
  }
  const { spec, specs } = await findOrCreateSpec(orderId, positionId, { order });
  spec.annotations = spec.annotations || [];
  const entry = {
    id: `ann-${randomUUID()}`,
    media_id: mediaId,
    x,
    y,
    note,
    author: req.session.user.email,
    ts: new Date().toISOString()
  };
  spec.annotations.push(entry);
  spec.last_actor = req.session.user.email;
  spec.updated_at = entry.ts;
  await saveSpecs(specs);
  await appendToArray('status_logs.json', {
    id: `LOG-${randomUUID()}`,
    order_id: orderId,
    position_id: positionId,
    action: 'SPEC_ANNOTATION',
    actor: req.session.user.id,
    ts: entry.ts
  });
  res.status(201).json(entry);
});

app.delete('/api/specs/:orderId/:positionId/annotations/:annotationId', requireAuth(), async (req, res) => {
  const { orderId, positionId, annotationId } = req.params;
  let order;
  try {
    order = await ensureOrderAccess(orderId, req.session.user);
  } catch (err) {
    return respondError(res, err.statusCode || 500, err.message);
  }
  const { spec, specs } = await findOrCreateSpec(orderId, positionId, { order });
  const annotations = spec.annotations || [];
  const idx = annotations.findIndex((ann) => ann.id === annotationId);
  if (idx === -1) {
    return respondError(res, 404, 'Annotation nicht gefunden');
  }
  annotations.splice(idx, 1);
  spec.annotations = annotations;
  spec.last_actor = req.session.user.email;
  spec.updated_at = new Date().toISOString();
  await saveSpecs(specs);
  await appendToArray('status_logs.json', {
    id: `LOG-${randomUUID()}`,
    order_id: orderId,
    position_id: positionId,
    action: 'SPEC_ANNOTATION_DELETE',
    actor: req.session.user.id,
    ts: spec.updated_at,
    data: { annotation_id: annotationId }
  });
  res.json({ ok: true });
});

app.patch('/api/specs/:orderId/:positionId/media/:mediaId/status', requireAuth(), async (req, res) => {
  const { orderId, positionId, mediaId } = req.params;
  const status = (req.body?.status || '').toString().toUpperCase();
  if (!TECHPACK_MEDIA_STATUSES.has(status)) {
    return respondError(res, 400, 'Ungültiger Status');
  }
  let order;
  try {
    order = await ensureOrderAccess(orderId, req.session.user);
  } catch (err) {
    return respondError(res, err.statusCode || 500, err.message);
  }
  const { spec, specs } = await findOrCreateSpec(orderId, positionId, { order });
  spec.flags.medien = spec.flags.medien || [];
  let mediaEntry = spec.flags.medien.find((media) => media.id === mediaId);
  if (!mediaEntry && isPlaceholderMediaId(mediaId)) {
    const viewKey = mediaId.slice(PLACEHOLDER_MEDIA_PREFIX.length);
    const placeholderEntry = buildPlaceholderMediaEntry(viewKey);
    if (placeholderEntry) {
      spec.flags.medien.push(placeholderEntry);
      mediaEntry = placeholderEntry;
    }
  }
  if (!mediaEntry) {
    return respondError(res, 404, 'Media nicht gefunden');
  }
  const viewKey = mediaEntry.view_key;
  if (status === 'OK') {
    const tickets = await loadTicketsData();
    const hasOpenTickets = tickets.some((ticket) => {
      if (ticket.order_id !== orderId || ticket.position_id !== positionId) return false;
      if (ticket.status === 'CLOSED') return false;
      if (!ticket.view_key) return false;
      return ticket.view_key === viewKey;
    });
    if (hasOpenTickets) {
      return respondError(res, 400, 'Offene Rückfragen müssen zuerst geschlossen werden.');
    }
  }
  mediaEntry.status = status;
  spec.last_actor = req.session.user.email;
  spec.updated_at = new Date().toISOString();
  await saveSpecs(specs);
  await appendToArray('status_logs.json', {
    id: `LOG-${randomUUID()}`,
    order_id: orderId,
    position_id: positionId,
    action: 'SPEC_MEDIA_STATUS',
    actor: req.session.user.id,
    ts: spec.updated_at,
    data: {
      media_id: mediaId,
      status
    }
  });
  res.json({ id: mediaId, status });
});

// Tickets
function userCanAccessTicket(ticket, user) {
  if (user.role === 'BATE') return true;
  return ticket.owner === user.id || ticket.watchers?.includes(user.id);
}

async function ensureTicketAccess(ticket, user) {
  if (userCanAccessTicket(ticket, user)) {
    return true;
  }
  if (!ticket.order_id) return false;
  const orders = await loadOrders();
  const orderMap = new Map(orders.map((order) => [order.id, order]));
  const amendedLookup = new Map();
  orders.forEach((order) => {
    if (order.amended_from) {
      amendedLookup.set(order.amended_from, order);
    }
  });
  const matchedOrder = orderMap.get(ticket.order_id) || amendedLookup.get(ticket.order_id);
  if (!matchedOrder) return false;
  return orderMatchesSupplier(matchedOrder, user);
}

const TICKET_START_SEEDS = {
  order: 21345,
  techpack: 76412
};

function generateTicketId(existingTickets = [], type = 'order') {
  const year = new Date().getFullYear();
  const basePrefix = type === 'techpack' ? 'TIC-TE-' : 'TIC-BE-';
  const prefix = `${basePrefix}${year}`;
  const yearNumbers = existingTickets
    .map((ticket) => ticket.id)
    .filter((id) => typeof id === 'string' && id.startsWith(prefix))
    .map((id) => Number(id.slice(prefix.length)))
    .filter((value) => Number.isFinite(value));
  const seed = TICKET_START_SEEDS[type] ?? 10000000;
  const nextNumber = yearNumbers.length ? Math.max(...yearNumbers) + 1 : seed;
  const suffix = String(nextNumber).padStart(5, '0').slice(-5);
  return `${prefix}${suffix}`;
}

function normalizeContextValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const str = value.toString().trim();
  return str.length ? str : null;
}

function extractTicketContext(source = {}) {
  const context = {};
  if (Object.prototype.hasOwnProperty.call(source, 'order_id') || Object.prototype.hasOwnProperty.call(source, 'orderId')) {
    const raw = source.order_id ?? source.orderId;
    const normalized = normalizeContextValue(raw);
    if (normalized) {
      context.orderId = normalized;
    }
  }
  if (Object.prototype.hasOwnProperty.call(source, 'position_id') || Object.prototype.hasOwnProperty.call(source, 'positionId')) {
    const raw = source.position_id ?? source.positionId;
    context.positionId = raw === undefined ? undefined : normalizeContextValue(raw);
  }
  if (Object.prototype.hasOwnProperty.call(source, 'created_at') || Object.prototype.hasOwnProperty.call(source, 'createdAt')) {
    const raw = source.created_at ?? source.createdAt;
    const normalized = normalizeContextValue(raw);
    if (normalized) context.createdAt = normalized;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'ticket_key') || Object.prototype.hasOwnProperty.call(source, 'ticketKey')) {
    const raw = source.ticket_key ?? source.ticketKey;
    const normalized = normalizeContextValue(raw);
    if (normalized) context.ticketKey = normalized;
  }
  return context;
}

function findTicketEntry(tickets, ticketId, context = {}) {
  if (!ticketId) return null;
  const hasOrderFilter = Object.prototype.hasOwnProperty.call(context, 'orderId');
  const hasPositionFilter = Object.prototype.hasOwnProperty.call(context, 'positionId');
  const hasCreatedFilter = Object.prototype.hasOwnProperty.call(context, 'createdAt');
  const contextKey = context.ticketKey || null;
  const match =
    tickets.find((ticket) => {
      if (ticket.id !== ticketId) return false;
      if (contextKey && buildTicketKey(ticket) !== contextKey) return false;
      if (hasOrderFilter && (ticket.order_id || null) !== (context.orderId || null)) return false;
      if (hasPositionFilter && (ticket.position_id ?? null) !== (context.positionId ?? null)) return false;
      if (hasCreatedFilter) {
        const ticketDate = ticket.created_at ? new Date(ticket.created_at) : null;
        const ticketIso =
          ticketDate && !Number.isNaN(ticketDate.getTime()) ? ticketDate.toISOString() : (ticket.created_at || null);
        const targetDate = context.createdAt ? new Date(context.createdAt) : null;
        const targetIso =
          targetDate && !Number.isNaN(targetDate.getTime()) ? targetDate.toISOString() : (context.createdAt || null);
        if ((ticketIso || null) !== (targetIso || null)) return false;
      }
      return true;
    }) || tickets.find((ticket) => ticket.id === ticketId);
  return match || null;
}

function normalizeCommentInput(body = {}, user = {}) {
  const pick = (value) => {
    if (value === undefined || value === null) return '';
    return value.toString();
  };
  let messageDe = pick(body.message_de || '').trim();
  let messageTr = pick(body.message_tr || '').trim();
  let legacy = pick(body.comment || body.message || '').trim();
  if (!messageDe && !messageTr && legacy) {
    if (user.role === 'BATE') {
      messageDe = legacy;
    } else {
      messageTr = legacy;
    }
  }
  const fallback = messageDe || messageTr || legacy || '';
  const hasContent = Boolean(messageDe || messageTr || legacy);
  return {
    hasContent,
    message_de: messageDe || null,
    message_tr: messageTr || null,
    fallback: fallback || null
  };
}

app.get('/api/tickets', requireAuth(), async (req, res) => {
  const tickets = await loadTicketsData();
  const orders = await loadOrders();
  const orderMap = new Map(orders.map((order) => [order.id, order]));
  const amendedLookup = new Map();
  orders.forEach((order) => {
    if (order.amended_from) {
      amendedLookup.set(order.amended_from, order);
    }
  });
  const filtered = tickets.filter((ticket) => {
    if (userCanAccessTicket(ticket, req.session.user)) {
      return true;
    }
    const order = orderMap.get(ticket.order_id) || amendedLookup.get(ticket.order_id);
    return order ? orderMatchesSupplier(order, req.session.user) : false;
  });
  res.json(filtered);
});

app.post('/api/tickets', requireAuth(), async (req, res) => {
  const { order_id, position_id, title, priority = 'mittel', view_key } = req.body;
  if (!order_id || !title) return respondError(res, 400, 'order_id und title sind Pflichtfelder');
  const tickets = await loadTicketsData();
  const watchers =
    Array.isArray(req.body.watchers) && req.body.watchers.length
      ? req.body.watchers
      : req.body.watchers
      ? [req.body.watchers]
      : [];
  const normalizedViewKey = normalizeTicketViewKey(view_key);
  const ticket = {
    id: generateTicketId(tickets, position_id ? 'techpack' : 'order'),
    order_id,
    position_id: position_id || null,
    title,
    status: 'OPEN',
    priority,
    owner: req.session.user.id,
    watchers,
    view_key: normalizedViewKey,
    comments: [],
    created_at: new Date().toISOString()
  };
  tickets.push(ticket);
  await writeJson('tickets.json', tickets);
  if (order_id) {
    await syncOrderStatusWithTickets(order_id, req.session.user?.email);
  }
  res.status(201).json(ticket);
});

app.patch('/api/tickets/:id', requireAuth(), async (req, res) => {
  const tickets = await loadTicketsData();
  const context = extractTicketContext(req.body || {});
  const ticket = findTicketEntry(tickets, req.params.id, context);
  if (!ticket) return respondError(res, 404, 'Ticket nicht gefunden');
  if (!(await ensureTicketAccess(ticket, req.session.user))) return respondError(res, 403, req.t('forbidden'));
  ticket.status = req.body.status || ticket.status;
  const commentPayload = normalizeCommentInput(req.body, req.session.user);
  if (commentPayload.hasContent) {
    ticket.comments = ticket.comments || [];
    ticket.comments.push({
      id: `tc-${randomUUID()}`,
      author: req.session.user.email,
      message: commentPayload.fallback,
      message_de: commentPayload.message_de,
      message_tr: commentPayload.message_tr,
      ts: new Date().toISOString()
    });
  }
  if (req.body.watchers) {
    ticket.watchers = Array.isArray(req.body.watchers) ? req.body.watchers : [req.body.watchers];
  }
  const idx = tickets.findIndex((entry) => entry === ticket);
  tickets[idx] = ticket;
  await writeJson('tickets.json', tickets);
  if (ticket.order_id) {
    await syncOrderStatusWithTickets(ticket.order_id, req.session.user?.email);
  }
  res.json(ticket);
});

app.delete('/api/tickets/:id', requireAuth(), async (req, res) => {
  const tickets = await loadTicketsData();
  const context = extractTicketContext(req.query || {});
  const ticket = findTicketEntry(tickets, req.params.id, context);
  if (!ticket) return respondError(res, 404, 'Ticket nicht gefunden');
  if (!(await ensureTicketAccess(ticket, req.session.user))) {
    return respondError(res, 403, req.t('forbidden'));
  }
  const idx = tickets.findIndex((entry) => entry === ticket);
  tickets.splice(idx, 1);
  await writeJson('tickets.json', tickets);
  if (ticket.order_id) {
    await syncOrderStatusWithTickets(ticket.order_id, req.session.user?.email);
  }
  res.json({ ok: true });
});

app.post('/api/tickets/:id/comment', requireAuth(), ticketUpload.single('file'), async (req, res) => {
  const tickets = await loadTicketsData();
  const context = extractTicketContext(req.body || {});
  const ticket = findTicketEntry(tickets, req.params.id, context);
  if (!ticket) return respondError(res, 404, 'Ticket nicht gefunden');
  if (!(await ensureTicketAccess(ticket, req.session.user))) return respondError(res, 403, req.t('forbidden'));
  const commentPayload = normalizeCommentInput(req.body, req.session.user);
  if (!commentPayload.hasContent && !req.file) return respondError(res, 400, 'Kommentar oder Datei erforderlich');
  ticket.comments = ticket.comments || [];
  const comment = {
    id: `tc-${randomUUID()}`,
    author: req.session.user.email,
    message: commentPayload.fallback,
    message_de: commentPayload.message_de,
    message_tr: commentPayload.message_tr,
    ts: new Date().toISOString()
  };
  if (req.file) {
    comment.attachment = {
      filename: req.file.originalname,
      url: `/uploads/tickets/${ticket.id}/${req.file.filename}`
    };
  }
  ticket.comments.push(comment);
  const idx = tickets.findIndex((entry) => entry === ticket);
  tickets[idx] = ticket;
  await writeJson('tickets.json', tickets);
  res.status(201).json(comment);
});

app.delete('/api/tickets/:id/comment/:commentId', requireAuth(), async (req, res) => {
  const tickets = await loadTicketsData();
  const context = extractTicketContext(req.query || {});
  const ticket = findTicketEntry(tickets, req.params.id, context);
  if (!ticket) return respondError(res, 404, 'Ticket nicht gefunden');
  if (!(await ensureTicketAccess(ticket, req.session.user))) return respondError(res, 403, req.t('forbidden'));
  ticket.comments = ticket.comments || [];
  const commentIdx = ticket.comments.findIndex((comment) => comment.id === req.params.commentId);
  if (commentIdx === -1) return respondError(res, 404, 'Kommentar nicht gefunden');
  const [removed] = ticket.comments.splice(commentIdx, 1);
  const idx = tickets.findIndex((entry) => entry === ticket);
  tickets[idx] = ticket;
  await writeJson('tickets.json', tickets);
  if (removed?.attachment?.url?.startsWith('/uploads')) {
    const relative = removed.attachment.url.replace('/uploads', '');
    const absolutePath = path.join(UPLOAD_ROOT, relative);
    await fs.unlink(absolutePath).catch(() => null);
  }
  res.json({ ok: true });
});

// Calendar
app.get('/api/calendar', requireAuth(), async (req, res) => {
  const events = (await readJson('calendar.json', [])) || [];
  res.json(events);
});

app.post('/api/calendar', requireBate(), async (req, res) => {
  const { title, start, end, order_id } = req.body;
  if (!title || !start || !end) return respondError(res, 400, 'title, start, end erforderlich');
  const events = (await readJson('calendar.json', [])) || [];
  const event = {
    id: `CAL-${randomUUID()}`,
    title,
    start,
    end,
    order_id: order_id || null,
    type: 'manual'
  };
  events.push(event);
  await writeJson('calendar.json', events);
  res.status(201).json(event);
});

app.patch('/api/calendar/:id', requireBate(), async (req, res) => {
  const events = (await readJson('calendar.json', [])) || [];
  const idx = events.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return respondError(res, 404, 'Event nicht gefunden');
  if (events[idx].type !== 'manual') return respondError(res, 400, 'Automatische Events können nicht bearbeitet werden');
  events[idx] = { ...events[idx], ...req.body };
  await writeJson('calendar.json', events);
  res.json(events[idx]);
});

app.delete('/api/calendar/:id', requireBate(), async (req, res) => {
  const events = (await readJson('calendar.json', [])) || [];
  const idx = events.findIndex((e) => e.id === req.params.id);
  if (idx === -1) return respondError(res, 404, 'Event nicht gefunden');
  if (events[idx].type !== 'manual') return respondError(res, 400, 'Automatische Events können nicht gelöscht werden');
  events.splice(idx, 1);
  await writeJson('calendar.json', events);
  res.json({ ok: true });
});

// Notifications
// Audit
app.get('/api/audit', requireBate(), async (req, res) => {
  const logs = (await readJson('status_logs.json', [])) || [];
  res.json(logs);
});

app.get('/api/locales', requireAuth(), (req, res) => {
  const locales = SUPPORTED_LOCALES.map((code) => ({
    code,
    label: LOCALE_LABELS[code] || code,
    active: code === req.locale
  }));
  res.json({ locales, active: req.locale });
});

app.post('/api/locale', requireAuth(), (req, res) => {
  const requested = (req.body?.locale || '').toString().toLowerCase();
  if (!SUPPORTED_LOCALES.includes(requested)) {
    return respondError(res, 400, req.t('invalidLocale'));
  }
  if (req.session?.user?.role === 'SUPPLIER' && requested !== 'tr') {
    return respondError(res, 400, req.t('invalidLocale'));
  }
  if (req.session?.user) {
    req.session.user.locale = requested;
  }
  req.session.locale = requested;
  res.json({ locale: requested });
});

app.get('/api/public/locales/:locale', async (req, res) => {
  const locale = resolveLocale(req.params.locale || DEFAULT_LOCALE);
  const data = await getLocaleEntries(locale);
  res.json({
    locale,
    entries: data.entries,
    updated_at: data.updated_at
  });
});

app.get('/api/translations', requireBate(), async (req, res) => {
  const requested = req.query.locale ? resolveLocale(req.query.locale) : null;
  const storedLocales = await listTranslationLocales();
  const localeList = Array.from(new Set([...SUPPORTED_LOCALES, ...storedLocales]));
  if (requested) {
    const data = await getLocaleEntries(requested);
    return res.json({
      locales: localeList,
      locale: requested,
      entries: data.entries,
      updated_at: data.updated_at
    });
  }
  const payload = {};
  await Promise.all(
    localeList.map(async (locale) => {
      const data = await getLocaleEntries(locale);
      payload[locale] = data.entries;
    })
  );
  res.json({ locales: localeList, translations: payload });
});

app.post('/api/translate', requireAuth(), async (req, res) => {
  const { text, source, target } = req.body || {};
  const sourceLocale = resolveLocale(source || req.locale || DEFAULT_LOCALE);
  const targetLocale = resolveLocale(target || (req.session?.user?.role === 'BATE' ? 'tr' : 'de'));
  if (sourceLocale === targetLocale) {
    return res.json({ translation: text || '', provider: 'noop', fallback: true });
  }
  try {
    const result = await translateText(text, sourceLocale, targetLocale);
    res.json(result);
  } catch (err) {
    respondError(res, 500, err.message);
  }
});

app.post('/api/translations', requireBate(), async (req, res) => {
  const locale = resolveLocale(req.body?.locale);
  const key = req.body?.key;
  const value = req.body?.value;
  if (!key) {
    return respondError(res, 400, 'Key fehlt');
  }
  try {
    const entry = await upsertTranslation(locale, key, value);
    res.status(201).json(entry);
  } catch (err) {
    respondError(res, 400, err.message);
  }
});

app.delete('/api/translations/:locale', requireBate(), async (req, res) => {
  const locale = resolveLocale(req.params.locale);
  const key = req.query.key;
  if (!key) {
    return respondError(res, 400, 'Key fehlt');
  }
  try {
    const removed = await deleteTranslation(locale, key);
    if (!removed) {
      return respondError(res, 404, 'Eintrag nicht gefunden');
    }
    res.json({ ok: true });
  } catch (err) {
    respondError(res, 400, err.message);
  }
});

app.get('/api/diagnostics', requireBate(), async (req, res) => {
  try {
    const payload = await collectDiagnostics(req.session.user?.id);
    res.json(payload);
  } catch (err) {
    respondError(res, 500, err.message);
  }
});

// AutoSync Service Bridge
app.get('/api/autosync/status', requireBate(), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 200);
  try {
    const snapshot = await getAutoSyncSnapshot({ limit });
    res.json(snapshot);
  } catch (err) {
    respondError(res, 500, err.message);
  }
});

app.get('/api/autosync/dashboard', requireBate(), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const sku = req.query.sku?.toString().trim() || null;
  try {
    const snapshot = await getAutoSyncSnapshot({ limit, sku });
    res.json(snapshot);
  } catch (err) {
    respondError(res, 500, err.message);
  }
});

app.post('/api/autosync/run', requireBate(), async (req, res) => {
  if (!ensureAutoSyncConfigured(res)) return;
  const sku = req.body?.sku?.toString().trim();
  if (!sku) {
    return respondError(res, 400, 'SKU fehlt');
  }
  const bereich = req.body?.bereich?.toString().trim();
  const overridePrices = {};
  const buy = req.body?.einkauf;
  const sell = req.body?.verkauf;
  if (buy !== undefined && buy !== null && buy !== '') {
    overridePrices.einkauf = Number(buy);
  }
  if (sell !== undefined && sell !== null && sell !== '') {
    overridePrices.verkauf = Number(sell);
  }
  try {
    const result = await autosyncClient.runSkuSync({
      sku,
      bereich,
      overridePrices: Object.keys(overridePrices).length ? overridePrices : undefined
    });
    res.json(result);
  } catch (err) {
    respondError(res, 400, err.message);
  }
});

app.post('/api/autosync/manual', requireBate(), async (req, res) => {
  if (!ensureAutoSyncConfigured(res)) return;
  const payload = req.body || {};
  const required = ['sku', 'name', 'gruppe', 'viewer', 'sizes', 'einkauf', 'verkauf'];
  const missing = required.filter((field) => !String(payload[field] ?? '').trim());
  if (missing.length) {
    return respondError(res, 400, `Felder fehlen: ${missing.join(', ')}`);
  }
  payload.sku = payload.sku.toString().trim();
  payload.name = payload.name.toString().trim();
  payload.gruppe = payload.gruppe.toString().trim();
  payload.viewer = payload.viewer.toString().trim();
  payload.sizes = payload.sizes.toString().trim();
  payload.bereich = payload.bereich?.toString().trim() || 'BATE';
  payload.einkauf = Number(payload.einkauf);
  payload.verkauf = Number(payload.verkauf);
  ['kollektion', 'aussenmaterial', 'innenmaterial', 'sohle', 'farbcode'].forEach((field) => {
    if (payload[field] === undefined || payload[field] === null) return;
    payload[field] = payload[field].toString().trim();
  });
  try {
    const result = await autosyncClient.runManualSync(payload);
    res.json(result);
  } catch (err) {
    respondError(res, 400, err.message);
  }
});

app.post('/api/autosync/delete', requireBate(), async (req, res) => {
  if (!ensureAutoSyncConfigured(res)) return;
  const sku = req.body?.sku?.toString().trim();
  if (!sku) {
    return respondError(res, 400, 'SKU fehlt');
  }
  try {
    const result = await autosyncClient.deleteWooProduct(sku);
    res.json(result);
  } catch (err) {
    respondError(res, 400, err.message);
  }
});

app.get('/api/autosync/logs', requireBate(), async (req, res) => {
  if (!autosyncClient.isEnabled()) {
    return res.json({ enabled: false, entries: [] });
  }
  const limit = Math.min(Number(req.query.limit) || 25, 200);
  const sku = req.query.sku?.toString().trim();
  try {
    if (sku) {
      const data = await autosyncClient.fetchSkuLogs(sku, { limit });
      return res.json(data);
    }
    const data = await autosyncClient.fetchLatestLogs(limit);
    return res.json(data);
  } catch (err) {
    respondError(res, 400, err.message);
  }
});

// Sync + health
app.post('/api/sync', requireBate(), async (req, res, next) => {
  try {
    const result = await syncERPData();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.get('/api/health', async (req, res) => {
  const [lastSync, orders, tickets] = await Promise.all([
    readJson('last_sync.json', { last_run: null }),
    readJson('purchase_orders.json', []),
    readJson('tickets.json', [])
  ]);
  res.json({
    ok: true,
    last_sync: lastSync,
    counts: {
      orders: orders.length,
      tickets: tickets.length
    }
  });
});

// Frontdoor fallback
app.use((req, res, next) => {
  if (req.path === '/frontdoor') {
    return res.redirect('/');
  }
  return next();
});

app.use((err, req, res, _next) => {
  void _next;
  console.error(err);
  res.status(500).json({ error: err.message || 'Unbekannter Fehler' });
});

async function boot() {
  try {
    await syncERPData();
  } catch (err) {
    console.warn('Initialer Sync fehlgeschlagen, benutze lokale Daten', err.message);
  }
  cron.schedule(SYNC_CRON, async () => {
    try {
      await syncERPData();
      console.log('Sync abgeschlossen');
    } catch (err) {
      console.error('Sync fehlgeschlagen', err.message);
    }
  });

  app.listen(PORT, () => {
    console.log(`BATE Supplier Portal läuft auf ${BASE_URL}`);
  });
}

boot();
