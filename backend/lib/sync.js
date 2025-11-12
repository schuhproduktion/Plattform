const { fetchResource, fetchPurchaseOrders } = require('./erpClient');
const { writeJson, readJson } = require('./dataStore');
const { getPhaseForStatus } = require('./workflows');

const GALLERY_FIELDS = [
  'image',
  'website_image',
  'thumbnail',
  'custom_anmerkungen',
  'custom_anmerkung_2',
  'custom_anmerkung_3',
  'custom_anmerkung_4',
  'custom_anmerkung_5',
  'custom_anmerkung_6',
  'custom_anmerkung_7',
  'custom_anmerkung_8',
  'custom_anmerkung_9',
  'custom_anmerkung_10'
];

const VIEWER_FALLBACK_FRAMES = ['0005', '0010', '0019', '0028'];

const CUSTOM_PORTAL_STATUS_MAP = {
  '🔵 EINGEREICHT': 'ORDER_EINGEREICHT',
  'EINGEREICHT': 'ORDER_EINGEREICHT',
  '🟡 BESTÄTIGT': 'ORDER_BESTAETIGT',
  'BESTÄTIGT': 'ORDER_BESTAETIGT',
  '🟠 RÜCKFRAGEN': 'RUECKFRAGEN_OFFEN',
  'RÜCKFRAGEN': 'RUECKFRAGEN_OFFEN',
  '🟢 PRODUKTION': 'PRODUKTION_LAEUFT',
  'PRODUKTION': 'PRODUKTION_LAEUFT',
  '🟣 VERSANDBEREIT': 'WARE_ABHOLBEREIT',
  'VERSANDBEREIT': 'WARE_ABHOLBEREIT',
  '⚪ ABGESCHLOSSEN': 'UEBERGEBEN_AN_SPEDITION',
  'ABGESCHLOSSEN': 'UEBERGEBEN_AN_SPEDITION'
};

const ERP_STATUS_PORTAL_MAP = {
  COMPLETED: 'UEBERGEBEN_AN_SPEDITION',
  ABGESCHLOSSEN: 'UEBERGEBEN_AN_SPEDITION'
};

function stripHtml(value = '') {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeCustomPortalStatus(value) {
  if (!value || typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  if (!upper) return null;
  const direct = CUSTOM_PORTAL_STATUS_MAP[upper];
  if (direct) return direct;
  const stripped = upper.replace(/[^A-ZÄÖÜß ]/g, '').replace(/\s+/g, ' ').trim();
  return CUSTOM_PORTAL_STATUS_MAP[stripped] || null;
}

function normalizeErpStatus(value) {
  if (!value || typeof value !== 'string') return null;
  const upper = value.trim().toUpperCase();
  if (!upper) return null;
  return ERP_STATUS_PORTAL_MAP[upper] || null;
}

function uniqueNonEmpty(values = []) {
  return [...new Set(values.filter((val) => typeof val === 'string' && val.trim().length))];
}

function buildViewerFallbackShots(item, safeId) {
  const base = (item?.custom_3d_produktlink || item?.custom_3d_link || item?.viewer3d || '').trim();
  if (!base) return [];
  const normalized = base.replace(/\/+$/, '');
  const imageBase = normalized.endsWith('/images') ? normalized : `${normalized}/images`;
  return VIEWER_FALLBACK_FRAMES.map((frame, idx) => ({
    id: `${safeId}-viewer-${frame}-${idx}`,
    url: `${imageBase}/${frame}.webp`
  }));
}

function isTruthyFlag(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'ja'].includes(value.trim().toLowerCase());
  }
  return false;
}

function formatExternalPriceType(row) {
  if (isTruthyFlag(row.selling)) {
    return 'Verkauf';
  }
  if (isTruthyFlag(row.buying)) {
    return 'Einkauf';
  }
  return row.price_list || row.price_type || 'Preis';
}

function extractPrices(item, externalPrices = []) {
  const sources = [
    ...(Array.isArray(item.item_prices) ? item.item_prices : []),
    ...(Array.isArray(item.prices) ? item.prices : []),
    ...(Array.isArray(item.price_list_data) ? item.price_list_data : []),
    ...(Array.isArray(externalPrices) ? externalPrices : [])
  ];

  const prices = sources
    .map((row, idx) => ({
      label: row.price_list || row.label || `Preis ${idx + 1}`,
      type: formatExternalPriceType(row),
      currency: row.currency || row.currency_symbol || 'EUR',
      amount: typeof row.price_list_rate === 'number'
        ? row.price_list_rate
        : typeof row.rate === 'number'
        ? row.rate
        : typeof row.amount === 'number'
        ? row.amount
        : typeof row.price === 'number'
        ? row.price
        : Number(row.price_list_rate) || Number(row.rate) || Number(row.amount) || null
    }))
    .filter((entry) => entry.amount !== null);

  if (!prices.length && typeof item.standard_rate === 'number') {
    prices.push({
      label: 'Standardpreis',
      type: 'Verkauf',
      currency: item.currency || 'EUR',
      amount: item.standard_rate
    });
  }
  if (!prices.length && typeof item.valuation_rate === 'number') {
    prices.push({
      label: 'Bewertungspreis',
      type: 'Einkauf',
      currency: item.currency || 'EUR',
      amount: item.valuation_rate
    });
  }

  return prices;
}

function groupItemPrices(priceDocs = []) {
  if (!Array.isArray(priceDocs)) return {};
  return priceDocs.reduce((acc, price) => {
    const code = price?.item_code;
    if (!code) return acc;
    if (!acc[code]) acc[code] = [];
    acc[code].push(price);
    return acc;
  }, {});
}

function normalizeItems(rawItems = [], itemPriceMap = {}) {
  if (!Array.isArray(rawItems)) return [];
  return rawItems.map((item, idx) => {
    if (item?.__normalized) {
      return item;
    }
    const safeId = item?.name || item?.item_code || `item-${idx}`;
    const galleryValues = uniqueNonEmpty(
      GALLERY_FIELDS.map((field) => item?.[field])
    );
    let gallery = galleryValues.map((url, galleryIndex) => ({
      id: `${safeId}-media-${galleryIndex}`,
      url
    }));
    const viewerShots = buildViewerFallbackShots(item, safeId);
    if (!gallery.length && viewerShots.length) {
      gallery = viewerShots;
    } else if (gallery.length === 1 && /\/0001\.webp$/i.test(gallery[0].url) && viewerShots.length) {
      gallery = viewerShots;
    }
    let hero = gallery[0]?.url || item?.image || null;
    if ((!hero || /\/0001\.webp$/i.test(hero)) && viewerShots.length) {
      hero = viewerShots[0].url;
    }

    const sizes = Array.isArray(item?.groessen)
      ? item.groessen.map((row) => row?.size).filter(Boolean)
      : [];
    const assemblies = Array.isArray(item?.zusammenstellungen)
      ? item.zusammenstellungen.map((row) => row?.zusammenstellung).filter(Boolean)
      : [];
    const colorCode = assemblies[0] || item?.custom_farbcode || null;

    const externalPrices = itemPriceMap[item?.item_code] || [];

    return {
      __normalized: true,
      id: safeId,
      item_code: item?.item_code || safeId,
      item_name: item?.item_name || item?.item_code || 'Unbenannter Artikel',
      description: stripHtml(item?.description || ''),
      status: item?.disabled ? 'inactive' : 'active',
      stock_uom: item?.stock_uom || null,
      item_group: item?.item_group || null,
      brand: item?.brand || null,
      collection: item?.custom_kollektion || null,
      customer_item_code: item?.custom_kundenartikelcode || null,
      customer_link: item?.custom_verknüpfung_zum_kunden || null,
      materials: {
        outer: item?.custom_außenmaterial || item?.custom_aussenmaterial || null,
        inner: item?.custom_innenmaterial || null,
        sole: item?.custom_sohle || null
      },
      color_code: colorCode,
      links: {
        b2b: item?.custom_produktlink_b2b || null,
        viewer3d: item?.custom_3d_produktlink || null
      },
      sizes,
      assemblies,
      prices: extractPrices(item, externalPrices),
      uoms: Array.isArray(item?.uoms)
        ? item.uoms.map((row) => ({
            uom: row?.uom,
            conversion_factor: row?.conversion_factor
          }))
        : [],
      media: {
        hero,
        gallery
      },
      metadata: {
        created: item?.creation || null,
        modified: item?.modified || null
      }
    };
  });
}

function normalizeLabelBase(value) {
  if (!value) return '';
  return value
    .toString()
    .normalize('NFKD')
    .replace(/[^\w\s&]/g, ' ')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();
}

function squeezeLabel(value) {
  if (!value) return '';
  return value.replace(/\s+/g, '');
}

function stripCompanySuffixes(label) {
  if (!label) return '';
  return label
    .replace(/\b(gmbh|mbh|ag|kg|co|sarl|spa|srl|llc|inc|ltd|limited|company|co kg|co\.kg|bv|nv|oy|ab|plc|gbr|ug)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildLabelTokens(value) {
  const base = normalizeLabelBase(value);
  if (!base) return [];
  const squeezed = squeezeLabel(base);
  const stripped = squeezeLabel(stripCompanySuffixes(base));
  return uniqueNonEmpty([squeezed, stripped]);
}

function buildLabelLookup(entries = [], getLabels = () => [], getId = () => null) {
  const lookup = new Map();
  entries.forEach((entry) => {
    const id = getId(entry);
    if (!id) return;
    const labels = getLabels(entry) || [];
    labels.forEach((label) => {
      buildLabelTokens(label).forEach((token) => {
        if (token && !lookup.has(token)) {
          lookup.set(token, id);
        }
      });
    });
  });
  return lookup;
}

function normalizeCustomers(rawCustomers = []) {
  return rawCustomers.map((customer, idx) => {
    if (customer?.__normalized_customer) {
      return customer;
    }
    const erpId = customer?.erp_name || customer?.name || customer?.id || `customer-${idx}`;
    const displayName = customer?.customer_name || customer?.name || `Kunde ${idx + 1}`;
    return {
      ...customer,
      __normalized_customer: true,
      erp_name: erpId,
      id: erpId,
      name: displayName,
      display_name: displayName,
      status: customer?.disabled ? 'gesperrt' : 'aktiv',
      priority: customer?.priority || customer?.market_segment || customer?.industry || null,
      account_manager: customer?.account_manager || null,
      tax_id: customer?.tax_id || null,
      woocommerce_user: customer?.custom_woocommerce_benutzer || customer?.woocommerce_user || null,
      woocommerce_password_hint:
        customer?.custom_woocommerce_passwort || customer?.woocommerce_password_hint || null,
      contact_email: customer?.email_id || customer?.custom_primary_email || null,
      contact_phone: customer?.mobile_no || customer?.phone || customer?.custom_primary_number || null
    };
  });
}

function resolveCustomerIdFromLinks(links, customerLabelLookup = new Map()) {
  if (Array.isArray(links)) {
    const direct = links.find((link) => (link?.link_doctype || '').toLowerCase() === 'customer');
    if (direct?.link_name) {
      return direct.link_name;
    }
  }
  const label = Array.isArray(links)
    ? links.map((link) => link?.link_title || link?.link_name).find(Boolean)
    : null;
  if (label) {
    const tokens = buildLabelTokens(label);
    for (const token of tokens) {
      if (customerLabelLookup.has(token)) {
        return customerLabelLookup.get(token);
      }
    }
  }
  return null;
}

function normalizeAddressType(addressType) {
  const value = (addressType || '').toString().toLowerCase();
  if (!value) return 'rechnung';
  if (value.includes('liefer') || value.includes('ship')) return 'lieferung';
  if (value.includes('rechnung') || value.includes('bill')) return 'rechnung';
  return value;
}

function formatStreet(address) {
  return uniqueNonEmpty([address?.address_line1, address?.address_line2]).join(', ');
}

function normalizeAddresses(rawAddresses = [], customerLabelLookup = new Map()) {
  return rawAddresses.map((address, idx) => {
    if (address?.__normalized_address) {
      return address;
    }
    const id = address?.name || address?.id || `address-${idx}`;
    const linkedCustomer =
      address?.customer_id ||
      resolveCustomerIdFromLinks(address?.links, customerLabelLookup) ||
      (() => {
        const tokens = buildLabelTokens(address?.address_title || address?.address_line1);
        for (const token of tokens) {
          if (customerLabelLookup.has(token)) {
            return customerLabelLookup.get(token);
          }
        }
        return null;
      })();
    return {
      ...address,
      __normalized_address: true,
      id,
      customer_id: linkedCustomer,
      type: normalizeAddressType(address?.address_type),
      street: formatStreet(address),
      zip: (address?.pincode || '').trim(),
      city: (address?.city || '').trim(),
      country: address?.country || '',
      display: stripHtml(address?.address_display || address?.primary_address || ''),
      lat: address?.custom_latitude || address?.latitude || null,
      lng: address?.custom_longitude || address?.longitude || null
    };
  });
}

function groupAddressesByCustomer(addresses = []) {
  const map = new Map();
  addresses.forEach((address) => {
    const customerId = address?.customer_id;
    if (!customerId) return;
    if (!map.has(customerId)) {
      map.set(customerId, {
        all: []
      });
    }
    const bucket = map.get(customerId);
    bucket.all.push(address);
    const type = (address?.type || '').toLowerCase();
    if (type && !bucket[type]) {
      bucket[type] = address;
    }
    if (!bucket.primary) {
      bucket.primary = address;
    }
  });
  return map;
}

function normalizeContacts(rawContacts = [], customerLabelLookup = new Map(), addressMap = new Map()) {
  return rawContacts.map((contact, idx) => {
    if (contact?.__normalized_contact) {
      return contact;
    }
    const id = contact?.name || contact?.id || `contact-${idx}`;
    const linkedCustomer =
      contact?.customer_id ||
      resolveCustomerIdFromLinks(contact?.links, customerLabelLookup) ||
      (() => {
        const address = addressMap.get(contact?.address);
        if (address?.customer_id) {
          return address.customer_id;
        }
        const tokens = buildLabelTokens(contact?.company_name || contact?.custom_organization);
        for (const token of tokens) {
          if (customerLabelLookup.has(token)) {
            return customerLabelLookup.get(token);
          }
        }
        return null;
      })();
    const fullName = uniqueNonEmpty([contact?.first_name, contact?.middle_name, contact?.last_name]).join(' ');
    return {
      ...contact,
      __normalized_contact: true,
      id,
      customer_id: linkedCustomer,
      name: contact?.full_name || fullName || contact?.company_name || 'Kontakt',
      email: contact?.email_id || contact?.custom_primary_email || '',
      phone: contact?.phone || contact?.mobile_no || contact?.custom_primary_number || '',
      role: contact?.designation || contact?.custom_einschätzung_der_kontaktperson || '',
      status: contact?.status || 'Aktiv'
    };
  });
}

function parseSizeBreakdown(item = {}) {
  if (item.__parsed_sizes) return item.__parsed_sizes;
  let parsed = {};
  if (typeof item.sizes === 'string') {
    try {
      const raw = JSON.parse(item.sizes);
      Object.entries(raw || {}).forEach(([key, value]) => {
        const match = key.match(/amount_(\d{1,2})/);
        if (match) {
          parsed[match[1]] = Number(value) || 0;
        }
      });
    } catch {
      parsed = {};
    }
  }
  if (!Object.keys(parsed).length && typeof item.sizes_display === 'string') {
    item.sizes_display.split('|').forEach((chunk) => {
      const [size, amount] = chunk.split(':').map((value) => value.trim());
      if (size) {
        parsed[size] = Number(amount) || 0;
      }
    });
  }
  item.__parsed_sizes = parsed;
  return parsed;
}

function normalizeOrderPositions(items = [], orderDoc = {}) {
  return items.map((item, idx) => {
    if (item?.__normalized_position) {
      return item;
    }
    const positionId = item?.position_id || item?.name || `${orderDoc?.name || 'order'}-POS-${idx + 1}`;
    const description = stripHtml(item?.description || item?.item_name || '');
    const assemblyCode = item?.zusammenstellung || item?.assembly || null;
    return {
      position_id: positionId,
      item_code: item?.item_code || null,
      description,
      brand: item?.brand || null,
      color: item?.item_group || null,
      color_code: assemblyCode || item?.color || null,
      quantity: Number(item?.qty) || 0,
      uom: item?.uom || item?.stock_uom || orderDoc?.stock_uom || null,
      rate: typeof item?.rate === 'number' ? item.rate : Number(item?.rate) || null,
      amount: typeof item?.amount === 'number' ? item.amount : Number(item?.amount) || null,
      total: typeof item?.amount === 'number' ? item.amount : Number(item?.net_amount) || null,
      supplier_part_no: item?.supplier_part_no || null,
      schedule_date: item?.schedule_date || orderDoc?.schedule_date || null,
      size_breakdown: parseSizeBreakdown(item)
    };
  });
}

function deriveShippingMeta(order) {
  const incoterm = (order?.incoterm || '').toUpperCase();
  let payer = 'BATE';
  let pickup = false;
  if (incoterm === 'EXW') {
    payer = 'KUNDE';
    pickup = true;
  }
  return {
    payer,
    method: order?.shipping_rule || order?.shipping_method || 'Spedition',
    packaging: order?.taxes_and_charges || 'Standard',
    pickup,
    incoterm,
    address: stripHtml(order?.shipping_address_display || ''),
    cartons_total: order?.cartons_total || null
  };
}

function collectBrandHints(orderDoc = {}, positions = []) {
  const values = [];
  positions.forEach((position) => {
    if (position.brand) values.push(position.brand);
    const match = position.description?.match(/[A-Z][A-Z0-9\s&/-]{3,}/);
    if (match) values.push(match[0]);
  });
  if (orderDoc?.customer_name) values.push(orderDoc.customer_name);
  if (orderDoc?.title) values.push(orderDoc.title);
  return uniqueNonEmpty(values);
}

function resolveCustomerForOrder(orderDoc, positions, context = {}) {
  if (orderDoc?.customer_id) return orderDoc.customer_id;
  if (orderDoc?.custom_kunde) return orderDoc.custom_kunde;
  const addressLookup = context.addressMap instanceof Map ? context.addressMap : new Map();
  const customerLabelLookup = context.customerLabelLookup instanceof Map ? context.customerLabelLookup : new Map();
  const shippingAddress = addressLookup.get(orderDoc?.shipping_address);
  if (shippingAddress?.customer_id) return shippingAddress.customer_id;
  const billingAddress = addressLookup.get(orderDoc?.billing_address);
  if (billingAddress?.customer_id) return billingAddress.customer_id;
  const brandHints = collectBrandHints(orderDoc, positions);
  for (const hint of brandHints) {
    const tokens = buildLabelTokens(hint);
    for (const token of tokens) {
      if (customerLabelLookup.has(token)) {
        return customerLabelLookup.get(token);
      }
    }
  }
  return null;
}

function normalizeOrders(rawOrders = [], context = {}) {
  return rawOrders
    .map((order, idx) => {
      if (order?.__normalized_order) {
        const normalizedDocStatus =
          typeof order?.docstatus === 'number' ? order.docstatus : Number(order?.docstatus);
        return normalizedDocStatus === 2 ? null : order;
      }
      const rawDocStatus = typeof order?.docstatus === 'number' ? order.docstatus : Number(order?.docstatus);
      if (rawDocStatus === 2) {
        return null;
      }
    const id = order?.name || order?.id || `order-${idx}`;
    const positions = normalizeOrderPositions(order?.items || [], order);
    const customerId = resolveCustomerForOrder(order, positions, context);
    const customer = customerId ? context.customersById?.get(customerId) : null;
    const erpStatusOverride = normalizeErpStatus(order?.status);
    const portalStatus =
      erpStatusOverride ||
      normalizeCustomPortalStatus(order?.custom_bestellstatus) ||
      order?.portal_status ||
      'ORDER_EINGEREICHT';
    const orderType = normalizeOrderType(order?.custom_c || order?.custom_bestellart || order?.order_type_portal || order?.order_type);
    const customCustomerId = order?.custom_kunde || null;
    const customCustomerName = order?.custom_kunde_name || order?.custom_kunde_title || null;
    const displayCustomerName = customCustomerName || customer?.name || order?.customer_name || order?.custom_kunde || null;
    const addressBucket = customerId ? context.addressesByCustomer?.get(customerId) : null;
    const billingAddress = addressBucket?.rechnung || addressBucket?.billing || addressBucket?.primary || addressBucket?.all?.[0] || null;
    const shippingAddress = addressBucket?.lieferung || addressBucket?.shipping || addressBucket?.primary || addressBucket?.all?.[0] || null;
    const customerSnapshot = customerId
      ? {
          id: customCustomerId || customerId,
          name: displayCustomerName || customerId,
          tax_id: customer?.tax_id || null,
          billing_address: billingAddress,
          shipping_address: shippingAddress
        }
      : customCustomerId
      ? {
          id: customCustomerId,
          name: displayCustomerName || customCustomerId
        }
      : null;
      return {
        ...order,
        __normalized_order: true,
        docstatus: Number.isFinite(rawDocStatus) ? rawDocStatus : order?.docstatus ?? null,
        id,
        order_number: order?.name || order?.order_number || id,
        customer_id: customerId,
        customer_name: displayCustomerName,
        customer_custom_id: customCustomerId,
        customer_custom_name: customCustomerName,
        supplier_id: order?.supplier || order?.supplier_id || null,
        supplier_name: order?.supplier_name || order?.supplier || null,
        order_type: orderType,
        requested_delivery: order?.schedule_date || order?.transaction_date || null,
        currency: order?.currency || 'EUR',
        total: typeof order?.total === 'number' ? order.total : null,
        total_amount: typeof order?.grand_total === 'number' ? order.grand_total : order?.total || null,
        net_total: typeof order?.net_total === 'number' ? order.net_total : null,
        tax_amount: typeof order?.total_taxes_and_charges === 'number' ? order.total_taxes_and_charges : null,
        positions,
        shipping: deriveShippingMeta(order),
        billing_address_id: order?.billing_address || null,
        shipping_address_id: order?.shipping_address || null,
        dispatch_address_id: order?.dispatch_address || null,
        dispatch_address_display: order?.dispatch_address_display || null,
        cartons: order?.cartons || [],
        portal_status: portalStatus,
        phase: getPhaseForStatus(portalStatus),
        customer_snapshot: customerSnapshot,
        created_at: order?.creation ? new Date(order.creation).toISOString() : null,
        last_updated: order?.modified ? new Date(order.modified).toISOString() : null,
        timeline: Array.isArray(order?.timeline) ? order.timeline : []
      };
    })
    .filter(Boolean);
}

function normalizeOrderType(value) {
  const normalized = (value || '').toString().trim().toUpperCase();
  if (!normalized) return 'BESTELLUNG';
  const allowed = new Set(['MUSTER', 'SMS', 'PPS', 'BESTELLUNG']);
  if (allowed.has(normalized)) return normalized;
  if (normalized.includes('MUSTER')) return 'MUSTER';
  if (normalized.includes('SMS')) return 'SMS';
  if (normalized.includes('PPS')) return 'PPS';
  return 'BESTELLUNG';
}

function mergeOrderState(fresh, previous) {
  if (!previous) return fresh;
  const portalStatus = fresh.portal_status || previous.portal_status || 'ORDER_EINGEREICHT';
  const mergedTimeline = Array.isArray(previous.timeline) && previous.timeline.length ? previous.timeline : fresh.timeline || [];
  return {
    ...fresh,
    order_type: fresh.order_type || previous.order_type,
    portal_status: portalStatus,
    phase: getPhaseForStatus(portalStatus),
    timeline: mergedTimeline,
    cartons: Array.isArray(previous.cartons) && previous.cartons.length ? previous.cartons : fresh.cartons,
    shipping: {
      ...fresh.shipping,
      ...(previous.shipping || {})
    }
  };
}

function shiftDate(dateStr, days) {
  const date = dateStr ? new Date(dateStr) : new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function generateAutoCalendarEntries(orders) {
  return orders.flatMap((order) => {
    const delivery = order.requested_delivery;
    return [
      {
        id: `CAL-${order.id}-prod`,
        title: `${order.id} Produktion`,
        type: 'auto',
        order_id: order.id,
        start: shiftDate(delivery, -14),
        end: shiftDate(delivery, -13)
      },
      {
        id: `CAL-${order.id}-ship`,
        title: `${order.id} Versand`,
        type: 'auto',
        order_id: order.id,
        start: shiftDate(delivery, -3),
        end: shiftDate(delivery, -2)
      },
      {
        id: `CAL-${order.id}-pickup`,
        title: `${order.id} Abholung`,
        type: 'auto',
        order_id: order.id,
        start: shiftDate(delivery, 0),
        end: shiftDate(delivery, 0)
      }
    ];
  });
}

async function syncERPData() {
  const [rawCustomers, rawAddresses, rawContacts, rawItems, rawItemPrices, rawOrders] = await Promise.all([
    fetchResource('customers'),
    fetchResource('addresses'),
    fetchResource('contacts'),
    fetchResource('items'),
    fetchResource('item_prices'),
    fetchPurchaseOrders()
  ]);

  const customers = normalizeCustomers(rawCustomers);
  const customerLabelLookup = buildLabelLookup(
    customers,
    (customer) => uniqueNonEmpty([customer?.name, customer?.customer_name, customer?.display_name, customer?.erp_name]),
    (customer) => customer.id
  );
  const addresses = normalizeAddresses(rawAddresses, customerLabelLookup);
  const addressMap = new Map(addresses.map((address) => [address.id, address]));
  const addressesByCustomer = groupAddressesByCustomer(addresses);
  const contacts = normalizeContacts(rawContacts, customerLabelLookup, addressMap);

  const itemPriceMap = groupItemPrices(rawItemPrices);
  const items = normalizeItems(rawItems, itemPriceMap);

  const customersById = new Map(customers.map((customer) => [customer.id, customer]));
  const previousOrders = (await readJson('purchase_orders.json', [])) || [];
  const previousOrderMap = new Map(previousOrders.map((order) => [(order?.id || order?.name), order]));
  const normalizedOrders = normalizeOrders(rawOrders, {
    addressMap,
    addressesByCustomer,
    customerLabelLookup,
    customersById
  }).map((order) => mergeOrderState(order, previousOrderMap.get(order.id)));

  await Promise.all([
    writeJson('customers.json', customers),
    writeJson('addresses.json', addresses),
    writeJson('contacts.json', contacts),
    writeJson('items.json', items),
    writeJson('item_prices.json', rawItemPrices),
    writeJson('purchase_orders.json', normalizedOrders)
  ]);

  const existingCalendar = (await readJson('calendar.json', [])) || [];
  const manualEvents = existingCalendar.filter((event) => event.type === 'manual');
  const calendar = [...manualEvents, ...generateAutoCalendarEntries(normalizedOrders)];
  await writeJson('calendar.json', calendar);

  const lastSync = {
    last_run: new Date().toISOString(),
    source: 'erp'
  };
  await writeJson('last_sync.json', lastSync);

  return {
    customers: customers.length,
    orders: normalizedOrders.length,
    items: items.length,
    item_prices: rawItemPrices.length,
    lastSync
  };
}

module.exports = {
  syncERPData
};
