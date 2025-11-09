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
const multer = require('multer');
const axios = require('axios');

const { authenticate, sanitizeUser, requireAuth, requireBate, requireSupplierOrOwner, loadUsers } = require('./lib/auth');
const { upload, UPLOAD_ROOT } = require('./lib/files');
const { listNotifications, markAsRead, createNotification } = require('./lib/notify');
const { getWorkflowDefinition, normalizePortalOrder, updateOrderWorkflow, getStatusLabel } = require('./lib/workflows');
const { syncERPData } = require('./lib/sync');
const { readJson, writeJson, appendToArray } = require('./lib/dataStore');
const { listLocales: listTranslationLocales, getLocaleEntries, upsertTranslation, deleteTranslation } = require('./lib/translations');

const TECHPACK_VIEWS = [
  { key: 'front', label: 'Vorderansicht' },
  { key: 'rear', label: 'Rückansicht' },
  { key: 'side', label: 'Seitenansicht' },
  { key: 'inner', label: 'Innenansicht' },
  { key: 'top', label: 'Draufsicht' },
  { key: 'bottom', label: 'Unteransicht' },
  { key: 'sole', label: 'Sohle' }
];
const TECHPACK_VIEW_KEYS = new Set(TECHPACK_VIEWS.map((view) => view.key));
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
const PACKAGING_TYPES = new Set(['carton', 'shoebox']);
const CM_TO_PT = 28.3464567;
const SHOEBOX_LABEL_SIZE = [CM_TO_PT * 8.5, CM_TO_PT * 6];
const COMPLETED_ORDER_STATUSES = new Set(['WARE_ABHOLBEREIT', 'UEBERGEBEN_AN_SPEDITION']);

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

app.use(helmet({
  crossOriginResourcePolicy: false
}));
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

const accessoryFileStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const customerId = req.params.id || 'misc';
      const slot = req.params.slot || 'generic';
      const dest = path.join(UPLOAD_ROOT, 'customers', customerId, 'accessories', slot);
      await fs.mkdir(dest, { recursive: true });
      cb(null, dest);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname?.replace(/[^a-zA-Z0-9.\-_]/g, '_') || 'attachment';
    const ext = path.extname(safeName);
    const base = path.basename(safeName, ext);
    cb(null, `${base}-${Date.now()}-${randomUUID()}${ext}`);
  }
});

const accessoryFileUpload = multer({
  storage: accessoryFileStorage,
  limits: {
    fileSize: 25 * 1024 * 1024
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

async function deleteUploadedFile(url) {
  if (!url || !url.startsWith('/uploads')) return;
  const relative = url.replace('/uploads', '');
  const absolutePath = path.join(UPLOAD_ROOT, relative);
  await fs.unlink(absolutePath).catch(() => null);
}

function respondError(res, statusCode, message) {
  return res.status(statusCode).json({ error: message });
}

async function loadOrders() {
  const orders = (await readJson('purchase_orders.json', [])) || [];
  return orders.map((order) => normalizePortalOrder(order));
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
  } catch (err) {
    return null;
  }
}

async function drawShoeboxLabel(doc, entry, imageCache) {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const height = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
  const textWidth = width * 0.55;
  const imageWidth = width - textWidth - 12;
  let cursorY = doc.page.margins.top;

  doc.font('Helvetica-Bold').fontSize(18).text(entry.name || 'ARTIKEL', doc.page.margins.left, cursorY, {
    width: textWidth
  });
  cursorY = doc.y + 6;
  doc.font('Helvetica').fontSize(10).text('Artikelnummer', doc.page.margins.left, cursorY, { width: textWidth });
  cursorY = doc.y + 2;
  doc.font('Helvetica-Bold').fontSize(18).text(entry.article_number || '-', doc.page.margins.left, cursorY, {
    width: textWidth
  });
  cursorY = doc.y + 6;
  doc.font('Helvetica').fontSize(10).text('Farbcode', doc.page.margins.left, cursorY, { width: textWidth });
  cursorY = doc.y + 2;
  doc.font('Helvetica-Bold').fontSize(18).text(entry.color_code || '-', doc.page.margins.left, cursorY, {
    width: textWidth
  });

  const imageX = doc.page.margins.left + textWidth + 12;
  const imageY = doc.page.margins.top;
  const imageHeight = height - 50;
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
    doc.image(buffer, imageX, imageY, { fit: [imageWidth, imageHeight], align: 'center', valign: 'center' });
  } else {
    doc.rect(imageX, imageY, imageWidth, imageHeight).strokeColor('#d1d5db').stroke();
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#6b7280')
      .text('Kein Bild', imageX, imageY + imageHeight / 2 - 5, { width: imageWidth, align: 'center' });
  }
  doc.fillColor('#000');
  doc.restore();

  doc
    .font('Helvetica-Bold')
    .fontSize(42)
    .text(String(entry.size || '-'), doc.page.margins.left, doc.page.height - doc.page.margins.bottom - 52, {
      width,
      align: 'right'
    });
}

function normalizeTicketViewKey(value) {
  const normalized = (value || '').toString().toLowerCase();
  return TECHPACK_VIEW_KEYS.has(normalized) ? normalized : null;
}

async function loadTicketsData() {
  return (await readJson('tickets.json', [])) || [];
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
  const [orders, tickets, specs, notifications, lastSync, calendar, statusLogs] = await Promise.all([
    loadOrders(),
    readJson('tickets.json', []),
    loadSpecs(),
    readJson('notifications.json', []),
    readJson('last_sync.json', { last_run: null, source: null }),
    readJson('calendar.json', []),
    readJson('status_logs.json', [])
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

  const unreadNotifications = notifications.filter((notification) => !notification.read && (!currentUserId || notification.user_id === currentUserId));

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
    notifications: {
      total: notifications.length,
      unread_for_user: unreadNotifications.length
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

async function resolveOrderStakeholders(order, actorId) {
  const users = await loadUsers();
  return users
    .filter((user) => user.id !== actorId)
    .filter((user) => user.role === 'BATE' || (order.supplier_id && user.supplier_id === order.supplier_id))
    .map((user) => user.id);
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
        image_url: label.image_url || ''
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
  const [orders, specs, tickets, notifications, logs] = await Promise.all([
    loadOrders(),
    loadSpecs(),
    readJson('tickets.json', []),
    readJson('notifications.json', []),
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
  const orderNotifications = notifications.filter((n) => n.order_id === order.id && n.user_id === req.session.user.id);
  res.json({
    ...order,
    specs: orderSpecs,
    tickets: orderTickets,
    audit: timelineLogs,
    notifications: orderNotifications
  });
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

app.post('/api/orders', requireBate(), async (req, res) => {
  const { order_number, supplier_id, supplier_name, customer_id, customer_name, requested_delivery } = req.body;
  if (!order_number || !supplier_id || !customer_id) {
    return respondError(res, 400, 'order_number, supplier_id und customer_id sind Pflichtfelder');
  }
  const orders = await loadOrders();
  if (orders.find((o) => o.order_number === order_number)) {
    return respondError(res, 409, 'Order Nummer bereits vorhanden');
  }
  const now = new Date().toISOString();
  const newOrder = normalizePortalOrder({
    id: order_number,
    order_number,
    supplier_id,
    supplier_name,
    customer_id,
    customer_name,
    requested_delivery,
    portal_status: 'ORDER_EINGEREICHT',
    phase: 'SMS',
    created_at: now,
    timeline: [
      {
        id: `tl-${randomUUID()}`,
        type: 'STATUS',
        status: 'ORDER_EINGEREICHT',
        message: 'Bestellung angelegt',
        actor: req.session.user.email,
        created_at: now
      }
    ],
    positions: Array.isArray(req.body.positions) ? req.body.positions : []
  });
  orders.push(newOrder);
  await writeJson('purchase_orders.json', orders);
  res.status(201).json(newOrder);
});

app.patch('/api/orders/:id', requireAuth(), async (req, res, next) => {
  const { nextStatus, order_type } = req.body;
  if (!nextStatus && !order_type) {
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
    if (nextStatus) {
      const stakeholders = await resolveOrderStakeholders(order, req.session.user.id);
      const updated = await updateOrderWorkflow({
        orderId: order.id,
        nextStatus,
        actor: req.session.user.email,
        notifyUsers: stakeholders
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
  const stakeholders = await resolveOrderStakeholders(order, req.session.user.id);
  await Promise.all(
    stakeholders.map((userId) =>
      createNotification({
        type: 'ORDER_STATUS_CHANGED',
        orderId: order.id,
        userId,
        message: `Neuer Kommentar zu ${order.id}`
      })
    )
  );
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
  const stakeholders = await resolveOrderStakeholders(order, req.session.user.id);
  await Promise.all(
    stakeholders.map((userId) =>
      createNotification({
        type: 'ORDER_STATUS_CHANGED',
        orderId: order.id,
        userId,
        message: `Neue Datei für ${order.id}`
      })
    )
  );
  res.status(201).json(fileEntry);
});

// Specs
async function findOrCreateSpec(orderId, positionId) {
  const specs = await loadSpecs();
  let spec = specs.find((s) => s.order_id === orderId && s.position_id === positionId);
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
    await saveSpecs(specs);
  }
  if (ensureSpecMediaAssignments(spec)) {
    await saveSpecs(specs);
  }
  return { spec, specs };
}

app.get('/api/specs/:orderId/:positionId', requireAuth(), async (req, res) => {
  const { orderId, positionId } = req.params;
  try {
    await ensureOrderAccess(orderId, req.session.user);
  } catch (err) {
    return respondError(res, err.statusCode || 500, err.message);
  }
  try {
    const { spec, specs } = await findOrCreateSpec(orderId, positionId);
    if (ensureSpecMediaAssignments(spec)) {
      await saveSpecs(specs);
    }
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
  const { spec, specs } = await findOrCreateSpec(orderId, positionId);
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
  const stakeholders = await resolveOrderStakeholders(order, req.session.user.id);
  await Promise.all(
    stakeholders.map((userId) =>
      createNotification({
        type: 'SPEC_COMMENT',
        orderId,
        userId,
        message: `Neuer Kommentar zu ${positionId}`
      })
    )
  );
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
  const { spec, specs } = await findOrCreateSpec(orderId, positionId);
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
  spec.flags.medien.push({
    id: fileEntry.id,
    label: mediaLabel,
    filename: req.file.originalname,
    view_key: viewKey,
    status: 'OPEN',
    url: `/uploads/orders/${orderId}/positions/${positionId}/${req.file.filename}`
  });
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
  const stakeholders = await resolveOrderStakeholders(order, req.session.user.id);
  await Promise.all(
    stakeholders.map((userId) =>
      createNotification({
        type: 'SPEC_UPLOAD',
        orderId,
        userId,
        message: `Neue Datei zu ${positionId}`
      })
    )
  );
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
  const { spec, specs } = await findOrCreateSpec(orderId, positionId);
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
  const stakeholders = await resolveOrderStakeholders(order, req.session.user.id);
  await Promise.all(
    stakeholders.map((userId) =>
      createNotification({
        type: 'SPEC_UPLOAD',
        orderId,
        userId,
        message: `Bild ersetzt für ${positionId}`
      })
    )
  );
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
  const { spec, specs } = await findOrCreateSpec(orderId, positionId);
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
  const stakeholders = await resolveOrderStakeholders(order, req.session.user.id);
  await Promise.all(
    stakeholders.map((userId) =>
      createNotification({
        type: 'SPEC_COMMENT',
        orderId,
        userId,
        message: `Bild entfernt für ${positionId}`
      })
    )
  );
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
  const { spec, specs } = await findOrCreateSpec(orderId, positionId);
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
  const stakeholders = await resolveOrderStakeholders(order, req.session.user.id);
  await Promise.all(
    stakeholders.map((userId) =>
      createNotification({
        type: 'SPEC_COMMENT',
        orderId,
        userId,
        message: `Flags aktualisiert für ${positionId}`
      })
    )
  );
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
  const { spec, specs } = await findOrCreateSpec(orderId, positionId);
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
  const stakeholders = await resolveOrderStakeholders(order, req.session.user.id);
  await Promise.all(
    stakeholders.map((userId) =>
      createNotification({
        type: 'SPEC_COMMENT',
        orderId,
        userId,
        message: `Neue Annotation zu ${positionId}`
      })
    )
  );
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
  const { spec, specs } = await findOrCreateSpec(orderId, positionId);
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
  const stakeholders = await resolveOrderStakeholders(order, req.session.user.id);
  await Promise.all(
    stakeholders.map((userId) =>
      createNotification({
        type: 'SPEC_COMMENT',
        orderId,
        userId,
        message: `Annotation entfernt für ${positionId}`
      })
    )
  );
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
  const { spec, specs } = await findOrCreateSpec(orderId, positionId);
  const mediaEntry = spec.flags.medien?.find((media) => media.id === mediaId);
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
  const stakeholders = await resolveOrderStakeholders(order, req.session.user.id);
  await Promise.all(
    stakeholders.map((userId) =>
      createNotification({
        type: 'SPEC_COMMENT',
        orderId,
        userId,
        message: `Status aktualisiert für ${positionId}`
      })
    )
  );
  res.json({ id: mediaId, status });
});

// Tickets
function userCanAccessTicket(ticket, user) {
  if (user.role === 'BATE') return true;
  return ticket.owner === user.id || ticket.watchers?.includes(user.id);
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
  const filtered = tickets.filter((ticket) => userCanAccessTicket(ticket, req.session.user));
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
  await createNotification({
    type: 'TICKET_CREATED',
    orderId: order_id,
    userId: req.session.user.role === 'BATE' ? 'u-supp-1' : 'u-bate-1',
    message: `Ticket ${ticket.id} erstellt`
  });
  res.status(201).json(ticket);
});

app.patch('/api/tickets/:id', requireAuth(), async (req, res) => {
  const tickets = await loadTicketsData();
  const idx = tickets.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return respondError(res, 404, 'Ticket nicht gefunden');
  const ticket = tickets[idx];
  if (!userCanAccessTicket(ticket, req.session.user)) return respondError(res, 403, req.t('forbidden'));
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
  tickets[idx] = ticket;
  await writeJson('tickets.json', tickets);
  await createNotification({
    type: 'TICKET_UPDATED',
    orderId: ticket.order_id,
    userId: req.session.user.role === 'BATE' ? 'u-supp-1' : 'u-bate-1',
    message: `Ticket ${ticket.id} aktualisiert`
  });
  res.json(ticket);
});

app.delete('/api/tickets/:id', requireAuth(), async (req, res) => {
  const tickets = await loadTicketsData();
  const idx = tickets.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return respondError(res, 404, 'Ticket nicht gefunden');
  const ticket = tickets[idx];
  if (!userCanAccessTicket(ticket, req.session.user)) {
    return respondError(res, 403, req.t('forbidden'));
  }
  tickets.splice(idx, 1);
  await writeJson('tickets.json', tickets);
  res.json({ ok: true });
});

app.post('/api/tickets/:id/comment', requireAuth(), ticketUpload.single('file'), async (req, res) => {
  const tickets = await loadTicketsData();
  const idx = tickets.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return respondError(res, 404, 'Ticket nicht gefunden');
  const ticket = tickets[idx];
  if (!userCanAccessTicket(ticket, req.session.user)) return respondError(res, 403, req.t('forbidden'));
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
  tickets[idx] = ticket;
  await writeJson('tickets.json', tickets);
  res.status(201).json(comment);
});

app.delete('/api/tickets/:id/comment/:commentId', requireAuth(), async (req, res) => {
  const tickets = await loadTicketsData();
  const idx = tickets.findIndex((t) => t.id === req.params.id);
  if (idx === -1) return respondError(res, 404, 'Ticket nicht gefunden');
  const ticket = tickets[idx];
  if (!userCanAccessTicket(ticket, req.session.user)) return respondError(res, 403, req.t('forbidden'));
  ticket.comments = ticket.comments || [];
  const commentIdx = ticket.comments.findIndex((comment) => comment.id === req.params.commentId);
  if (commentIdx === -1) return respondError(res, 404, 'Kommentar nicht gefunden');
  const [removed] = ticket.comments.splice(commentIdx, 1);
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
app.get('/api/notifications', requireAuth(), async (req, res) => {
  const unreadOnly = req.query.unread === 'true';
  const data = await listNotifications(req.session.user.id, { unreadOnly });
  res.json(data);
});

app.patch('/api/notifications/:id/read', requireAuth(), async (req, res) => {
  const notification = await markAsRead(req.params.id, req.session.user.id);
  if (!notification) return respondError(res, 404, 'Notification nicht gefunden');
  res.json(notification);
});

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

app.use((err, req, res, next) => {
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
