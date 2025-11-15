import {
  state,
  SUPPORTED_LOCALES,
  STATUS_LABELS,
  STATUS_FLOW,
  STATUS_CHOICES,
  ORDER_TYPE_BADGE_META,
  ACCESSORY_SLOTS,
  EYE_ICON_SVG,
  TRASH_ICON_SVG,
  SIZE_COLUMNS,
  TECHPACK_VIEWS,
  TECHPACK_MEDIA_STATUS,
  TRANSLATABLE_ATTRIBUTES,
  VAT_RATE,
  isInternalRole,
  isSupplierRole,
  getForcedLocaleForRole
} from './js/state.js';
import { request, ensureFreshSnapshot } from './js/api.js';
import { showToast, renderSharedLayout, applyRoleVisibility, setBreadcrumbLabel } from './js/ui.js';

const TECHPACK_PLACEHOLDER_IMAGES = {
  side: '/images/techpack-placeholders/side.png',
  front: '/images/techpack-placeholders/front.png',
  inner: '/images/techpack-placeholders/inner.png',
  rear: '/images/techpack-placeholders/rear.png',
  top: '/images/techpack-placeholders/top.png',
  bottom: '/images/techpack-placeholders/bottom.png',
  sole: '/images/techpack-placeholders/sole.png',
  tongue: '/images/techpack-placeholders/Zunge.png'
};
const PLACEHOLDER_MEDIA_PREFIX = 'placeholder-';
const VIEWER_GALLERY_FRAMES = ['0001', '0010', '0019', '0028'];
const ORDER_TICKET_KEY_SEPARATOR = '::';

const ORDER_SERIES_OPTIONS = ['BT-B.YY.#####', 'PZ-B.YY.#####'];
const CUSTOMER_ORDER_PROFILE_TYPES = ['SMS', 'PPS'];
const FAVICON_URL = 'https://360.schuhproduktion.com/Unterlagen/Favicon-Schuhproduktion.png';
const COMPANY_CONFIG = [
  {
    value: 'BATE GmbH',
    label: 'BATE GmbH',
    supplierId: 'BATE AYAKKABI İMALAT İTHALAT İHRACAT SANAYİ VE TİCARET LİMİTED ŞİRKETİ',
    supplierName: 'BATE AYAKKABI İMALAT İTHALAT İHRACAT SANAYİ VE TİCARET LİMİTED ŞİRKETİ',
    dispatchAddressId: 'BATE GmbH'
  }
];
const COMPANY_OPTIONS = COMPANY_CONFIG.map((entry) => entry.value);

const ORDER_DRAFT_STORAGE_KEY = 'portal_order_draft_v1';

const PROFORMA_UNIT_CHOICES = [
  { value: 'PAIR', label: 'Paar' },
  { value: 'LEFT_SHOE', label: 'Linker Schuh' },
  { value: 'RIGHT_SHOE', label: 'Rechter Schuh' }
];

const SHOEBOX_SEASON_CHOICES = ['FS', 'HW'];

const PROFORMA_DESCRIPTION_CHOICES = [
  'Sneaker',
  'Stiefel',
  'Pumps',
  'Loafers',
  'Pantoletten',
  'Sandalen',
  'Ankle Boots',
  'Ballerinas',
  'Espadrilles'
];

const PROFORMA_MATERIAL_CHOICES = ['Rindsleder', 'Schafleder', 'Ziegenleder', 'Büffelleder', 'Pferdeleder', 'Kamelleder', 'Exotenleder'];

const PROFORMA_SOLE_CHOICES = [
  'Ledersohle',
  'Gummisohle',
  'Kautschuksohle',
  'EVA-Sohle',
  'PU-Sohle',
  'TPU-Sohle',
  'Microlight-Sohle',
  'Thermolight-Sohle',
  'TR-Sohle',
  'PVC-Sohle',
  'Crepe-Sohle',
  'Vibram-Sohle',
  'Keilsohle',
  'Plateausohle',
  'Holzsohle'
];

function buildPartyTemplate(overrides = {}) {
  return {
    name: '',
    street: '',
    postalCode: '',
    city: '',
    country: '',
    email: '',
    website: '',
    taxId: '',
    court: '',
    ceo: '',
    address: '',
    contact: '',
    ...overrides
  };
}

function composePartyAddress(party = {}) {
  const lines = [];
  const street = (party.street || '').trim();
  const postal = (party.postalCode || '').trim();
  const city = (party.city || '').trim();
  const country = (party.country || '').trim();
  if (street) lines.push(street);
  const cityLine = [postal, city].filter(Boolean).join(' ').trim();
  if (cityLine) lines.push(cityLine);
  if (country) lines.push(country);
  return lines.join('\n').trim();
}

function composePartyContact(party = {}) {
  const email = (party.email || '').trim();
  const website = (party.website || '').trim();
  return [email, website].filter(Boolean).join(' – ').trim();
}

function hydratePartyDraft(party = {}, fallback = {}) {
  const hydrated = buildPartyTemplate();
  Object.assign(hydrated, fallback || {});
  Object.assign(hydrated, party || {});
  if (!hydrated.street && hydrated.address) {
    const lines = hydrated.address
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length) {
      hydrated.street = hydrated.street || lines[0];
      if (lines[1]) {
        const postalMatch = lines[1].match(/^(\S+)\s+(.+)$/);
        if (postalMatch) {
          if (!hydrated.postalCode) hydrated.postalCode = postalMatch[1];
          if (!hydrated.city) hydrated.city = postalMatch[2];
        } else if (!hydrated.city) {
          hydrated.city = lines[1];
        }
      }
      if (lines[2] && !hydrated.country) {
        hydrated.country = lines[2];
      }
    }
  }
  if ((!hydrated.email || !hydrated.website) && hydrated.contact) {
    hydrated.contact
      .split(/(?:\r?\n| — | – | - )/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => {
        if (!hydrated.email && entry.includes('@')) {
          hydrated.email = entry;
        } else if (!hydrated.website) {
          hydrated.website = entry;
        }
      });
  }
  if (hydrated.taxId && hydrated.taxId.includes('\n')) {
    const segments = hydrated.taxId
      .split(/\r?\n/)
      .map((segment) => segment.trim())
      .filter(Boolean);
    let extractedTaxId = '';
    segments.forEach((segment) => {
      const lower = segment.toLowerCase();
      if (lower.includes('steuernummer') && !extractedTaxId) {
        const match = segment.match(/steuernummer[:\s-]*(.+)/i);
        extractedTaxId = match ? match[1].trim() : segment.replace(/steuernummer/i, '').trim();
      } else if (lower.includes('amtsgericht') && !hydrated.court) {
        const match = segment.match(/amtsgericht[:\s-]*(.+)/i);
        hydrated.court = match ? match[1].trim() : segment;
      } else if (lower.includes('geschäftsführer') && !hydrated.ceo) {
        const match = segment.match(/geschäftsführer[:\s-]*(.+)/i);
        hydrated.ceo = match ? match[1].trim() : segment;
      }
    });
    if (extractedTaxId) {
      hydrated.taxId = extractedTaxId;
    }
  }
  return hydrated;
}

const DEFAULT_SELLER_DETAILS = buildPartyTemplate({
  name: 'BATE AYAKKABI İMALAT İTHALAT İHRACAT SAN. VE TİC. LTD. ŞTİ.',
  street: 'Sanayi Mah. Sancak Sokak No:40',
  postalCode: '34165',
  city: 'ISTANBUL GÜNGÖREN',
  country: 'TURKEY'
});

const DEFAULT_BUYER_DETAILS = buildPartyTemplate({
  name: 'BATE GmbH',
  street: 'Karlsruher Str. 71',
  postalCode: '75179',
  city: 'Pforzheim',
  country: 'GERMANY',
  email: 'info@schuhproduktion.com',
  website: 'www.schuhproduktion.com',
  taxId: 'DE365947317',
  court: 'Amtsgericht Mannheim',
  ceo: 'Nihat Yildiz'
});

const PROFORMA_ADDRESS_PRESETS = {
  seller: [
    {
      id: 'bate-tr',
      label: 'BATE Ayakkabı',
      data: {
        ...DEFAULT_SELLER_DETAILS,
        address: composePartyAddress(DEFAULT_SELLER_DETAILS),
        contact: composePartyContact(DEFAULT_SELLER_DETAILS)
      }
    }
  ],
  buyer: [
    {
      id: 'bate-de',
      label: 'BATE GmbH',
      data: {
        ...DEFAULT_BUYER_DETAILS,
        address: composePartyAddress(DEFAULT_BUYER_DETAILS),
        contact: composePartyContact(DEFAULT_BUYER_DETAILS)
      }
    }
  ]
};

const titleTranslationCache = new Map();

const App = (() => {
  function resolveOrderTypeMeta(orderType) {
    if (!orderType) {
      return { label: '-', badgeClass: 'order-type-neutral' };
    }
    return ORDER_TYPE_BADGE_META[orderType] || { label: String(orderType).toUpperCase(), badgeClass: 'order-type-neutral' };
  }

  function getOrderTypeBadgeHtml(orderType) {
    const meta = resolveOrderTypeMeta(orderType);
    return `<span class="badge order-type-badge ${meta.badgeClass}">${meta.label}</span>`;
  }

  function getTechpackViewLabel(viewKey) {
    return TECHPACK_VIEWS.find((view) => view.key === viewKey)?.label || 'Ansicht';
  }

  function getTechpackViewMeta(viewKey) {
    if (!viewKey) return null;
    return TECHPACK_VIEWS.find((view) => view.key === viewKey) || null;
  }

  function buildOrderTicketKey(ticket) {
    const segments = [
      ticket.id || '',
      ticket.order_id || '',
      ticket.position_id || '',
      ticket.created_at || '',
      ticket.title || ''
    ];
    return segments.join(ORDER_TICKET_KEY_SEPARATOR);
  }

  function ticketMatchesContext(ticket, ticketId, context = {}) {
    if (!ticket || ticket.id !== ticketId) return false;
    if (context.ticketKey) {
      const key = buildOrderTicketKey(ticket);
      if (key !== context.ticketKey) return false;
    }
    if (context.orderId && ticket.order_id !== context.orderId) return false;
    if (Object.prototype.hasOwnProperty.call(context, 'positionId')) {
      const desired = context.positionId ?? null;
      const current = ticket.position_id ?? null;
      if (desired !== current) return false;
    }
    return true;
  }

  function buildSvgDataUri(svgMarkup) {
    if (!svgMarkup) return '';
    return `data:image/svg+xml,${encodeURIComponent(svgMarkup)
      .replace(/%0A/g, '')
      .replace(/%20/g, ' ')}`;
  }

  function getAutoTechpackPlaceholderDataUri(view) {
    if (!view) return '';
    const position = view.position || '?';
    const label = (view.label || 'Ansicht').toUpperCase();
    const shortLabel = label.length > 18 ? `${label.slice(0, 17)}…` : label;
    const hue = ((position || 1) * 57) % 360;
    const background = `hsl(${hue}, 65%, 93%)`;
    const stroke = `hsl(${hue}, 55%, 70%)`;
    const accent = `hsl(${hue}, 60%, 55%)`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="72" viewBox="0 0 96 72">
  <rect x="1.5" y="1.5" width="93" height="69" rx="10" fill="${background}" stroke="${stroke}" stroke-width="3" />
  <path d="M12 48 Q 30 30 48 36 T 84 30" fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.45" />
  <circle cx="28" cy="26" r="8" fill="${accent}" opacity="0.18" />
  <circle cx="70" cy="20" r="10" fill="${accent}" opacity="0.12" />
  <text x="48" y="40" text-anchor="middle" font-size="16" font-weight="700" font-family="Inter,Arial,sans-serif" fill="#1f2937">POS ${position}</text>
  <text x="48" y="56" text-anchor="middle" font-size="9" font-weight="500" font-family="Inter,Arial,sans-serif" fill="#374151">${shortLabel}</text>
</svg>`;
    return buildSvgDataUri(svg);
  }

  function getTechpackPlaceholderSources(view) {
    const meta = view || TECHPACK_VIEWS[0];
    if (!meta) {
      return { baseSrc: '', customSrc: '' };
    }
    const baseSrc = getAutoTechpackPlaceholderDataUri(meta);
    const customSrc = meta.key ? TECHPACK_PLACEHOLDER_IMAGES[meta.key] || '' : '';
    return { baseSrc, customSrc };
  }

  function buildPlaceholderMedia(viewKey) {
    if (!viewKey) return null;
    const meta = getTechpackViewMeta(viewKey);
    if (!meta) return null;
    const { baseSrc, customSrc } = getTechpackPlaceholderSources(meta);
    const src = customSrc || baseSrc;
    if (!src) return null;
    return {
      id: `${PLACEHOLDER_MEDIA_PREFIX}${meta.key}`,
      label: `${meta.label} · Platzhalter`,
      view_key: meta.key,
      status: 'OPEN',
      url: src,
      isPlaceholder: true,
      is_placeholder: true,
      placeholderSrc: baseSrc,
      placeholderSrcset: customSrc ? `${customSrc} 1x` : ''
    };
  }

  function isPlaceholderMediaId(mediaId) {
    return typeof mediaId === 'string' && mediaId.startsWith(PLACEHOLDER_MEDIA_PREFIX);
  }

  function extractViewKeyFromMediaId(mediaId) {
    if (!mediaId) return null;
    if (isPlaceholderMediaId(mediaId)) {
      return mediaId.slice(PLACEHOLDER_MEDIA_PREFIX.length);
    }
    const media = state.techpackSpec?.flags?.medien?.find((entry) => entry.id === mediaId);
    return media?.view_key || null;
  }

function getTechpackPreviewPlaceholder(view) {
  const meta = view || TECHPACK_VIEWS[0];
  if (!meta) return '<span class="techpack-preview placeholder">–</span>';
  const { baseSrc, customSrc } = getTechpackPlaceholderSources(meta);
  const label = meta?.label ? `Platzhalter für ${meta.label}` : 'Platzhalter';
    if (!baseSrc) return '<span class="techpack-preview placeholder">–</span>';
    const srcsetAttr = customSrc ? ` srcset="${customSrc} 1x"` : '';
  return baseSrc
    ? `<img src="${baseSrc}"${srcsetAttr} alt="${escapeHtml(label)}" class="techpack-preview techpack-preview-placeholder" loading="lazy" />`
    : '<span class="techpack-preview placeholder">–</span>';
}

function normalizeViewerGalleryBase(raw) {
  if (!raw) return null;
  const trimmed = raw.toString().trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\/+$/, '');
  if (normalized.endsWith('/images')) return normalized;
  return `${normalized}/images`;
}

function resolveViewerGalleryBase(item, heroImage) {
  const viewerLink = normalizeViewerGalleryBase(item?.links?.viewer3d || item?.viewer3d);
  if (viewerLink) return viewerLink;
  if (typeof heroImage === 'string') {
    const match = heroImage.match(/^(.*\/images)\//);
    if (match) return match[1];
  }
  return null;
}

function buildViewerGallery(item, heroImage) {
  const base = resolveViewerGalleryBase(item, heroImage);
  if (!base) return [];
  return VIEWER_GALLERY_FRAMES.map((frame, idx) => ({
    id: `${item?.item_code || 'viewer'}-${frame}-${idx}`,
    url: `${base}/${frame}.webp`
  }));
}

function ensureTechpackActiveMedia(spec) {
  const media = spec?.flags?.medien || [];
  const requested = state.techpackRequestedView?.toLowerCase();
  const previousView = extractViewKeyFromMediaId(state.techpackActiveMedia);
    const defaultView = media[0]?.view_key || TECHPACK_VIEWS[0]?.key || null;
    const nextView = requested || previousView || defaultView;
    if (!nextView) {
      state.techpackActiveMedia = null;
      state.techpackRequestedView = null;
      return;
    }
    const match = media.find((entry) => entry.view_key === nextView);
    if (match) {
      state.techpackActiveMedia = match.id;
    } else {
      state.techpackActiveMedia = `${PLACEHOLDER_MEDIA_PREFIX}${nextView}`;
    }
    state.techpackRequestedView = null;
  }

  function getTechpackMediaById(mediaId) {
    if (!mediaId) return null;
    const media = state.techpackSpec?.flags?.medien?.find((entry) => entry.id === mediaId);
    if (media) {
      if (media.is_placeholder && !media.isPlaceholder) {
        return { ...media, isPlaceholder: true };
      }
      return media;
    }
    if (isPlaceholderMediaId(mediaId)) {
      return buildPlaceholderMedia(mediaId.slice(PLACEHOLDER_MEDIA_PREFIX.length));
    }
    return null;
  }

  function getActiveTechpackMedia() {
    if (!state.techpackActiveMedia) return null;
    return getTechpackMediaById(state.techpackActiveMedia);
  }

  function resolveActiveViewKey() {
    const activeMedia = getActiveTechpackMedia();
    if (activeMedia?.view_key) return activeMedia.view_key;
    if (state.techpackRequestedView) return state.techpackRequestedView;
    return TECHPACK_VIEWS[0]?.key || null;
  }

  function getOpenTicketCount(orderId, positionId, viewKey) {
    return (state.tickets || []).filter(
      (ticket) =>
        ticket.order_id === orderId &&
        ticket.position_id === positionId &&
        ticket.status !== 'CLOSED' &&
        ticketMatchesView(ticket, viewKey)
    ).length;
  }

  function hasOpenTickets(orderId, positionId, viewKey) {
    return getOpenTicketCount(orderId, positionId, viewKey) > 0;
  }

  function updateTechpackStatusDisplay(media) {
    const badge = document.getElementById('techpackStatusBadge');
    const button = document.getElementById('techpackStatusToggle');
    if (!badge || !button) return;
    if (!media) {
      badge.textContent = 'Keine Ansicht';
      badge.className = 'badge ghost';
      button.disabled = true;
      button.textContent = 'Status ändern';
      button.title = '';
      updateTechpackActionDisplay(null);
      return;
    }
    const meta = TECHPACK_MEDIA_STATUS[media.status] || TECHPACK_MEDIA_STATUS.OPEN;
    badge.textContent = meta.label;
    badge.className = `badge ${meta.badgeClass}`;
    button.disabled = false;
    button.textContent = meta.toggleLabel;
    updateTechpackActionDisplay(media);
    const statusButton = document.getElementById('techpackStatusToggle');
    if (statusButton && state.techpackContext) {
      const viewKey = media.view_key || resolveActiveViewKey();
      const openTickets = hasOpenTickets(state.techpackContext.orderId, state.techpackContext.positionId, viewKey);
      const attemptsSetOk = media.status !== 'OK';
      statusButton.disabled = openTickets && attemptsSetOk;
      statusButton.title =
        statusButton.disabled && attemptsSetOk
          ? translateTemplate('Offene Rückfragen müssen zuerst geschlossen werden.')
          : '';
    }
  }

  function updateTechpackActionDisplay(media) {
    const uploadBtn = document.getElementById('uploadTechpackBtn');
    const replaceBtn = document.getElementById('replaceTechpackBtn');
    const deleteBtn = document.getElementById('deleteTechpackBtn');
    const hasMedia = Boolean(media && !(media.isPlaceholder || media.is_placeholder));
    if (uploadBtn) uploadBtn.classList.toggle('hidden', hasMedia);
    if (replaceBtn) replaceBtn.classList.toggle('hidden', !hasMedia);
    if (deleteBtn) deleteBtn.classList.toggle('hidden', !hasMedia);
  }

  function formatStatus(status) {
    return STATUS_LABELS[status] || status?.replace(/_/g, ' ') || '-';
  }

  function formatDate(value) {
    if (!value) return '-';
    try {
      return new Date(value).toLocaleDateString('de-DE');
    } catch {
      return value;
    }
  }

  function formatMoney(amount, currency = 'EUR') {
    if (typeof amount !== 'number' || Number.isNaN(amount)) return '-';
    try {
      return new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency
      }).format(amount);
    } catch {
      return `${amount} ${currency}`;
    }
  }

  function ensureFavicon() {
    if (typeof document === 'undefined') return;
    const targets = ['icon', 'shortcut icon'];
    targets.forEach((rel) => {
      let link = document.querySelector(`link[rel="${rel}"]`);
      if (!link) {
        link = document.createElement('link');
        link.rel = rel;
        link.type = 'image/png';
        document.head?.appendChild(link);
      }
      link.href = FAVICON_URL;
    });
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, (char) => {
      switch (char) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        case "'":
          return '&#39;';
        default:
          return char;
      }
    });
  }

  function formatRelativeTime(value) {
    if (!value) return '–';
    const ts = new Date(value).getTime();
    if (Number.isNaN(ts)) return '–';
    const diffMinutes = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (diffMinutes < 1) return 'gerade eben';
    if (diffMinutes < 60) return `vor ${diffMinutes} Min`;
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) return `vor ${diffHours} Std`;
    const diffDays = Math.round(diffHours / 24);
    if (diffDays < 7) return `vor ${diffDays} Tg`;
    return new Date(ts).toLocaleString('de-DE');
  }

  function buildNotificationLink(entry) {
    if (!entry) return null;
    if (entry.ticket_id) {
      const params = new URLSearchParams();
      const ticketMeta = resolveTicketMeta(entry.ticket_id);
      const orderId = entry.order_id || ticketMeta?.order_id;
      const positionId = entry.position_id || ticketMeta?.position_id;
      const viewKey = entry.metadata?.view_key || ticketMeta?.view_key || null;
      if (orderId) params.set('order', orderId);
      params.set('ticket', entry.ticket_id);
      if (orderId && positionId) {
        params.set('position', positionId);
        if (viewKey) params.set('view', viewKey);
        return `/techpack.html?${params.toString()}`;
      }
      return `/bestellung.html?${params.toString()}`;
    }
    if (entry.order_id) {
      return `/bestellung.html?order=${encodeURIComponent(entry.order_id)}`;
    }
    return null;
  }

  function resolveTicketMeta(ticketId) {
    if (!ticketId) return null;
    const sources = [
      state.orderTickets || [],
      state.tickets || [],
      state.selectedOrder?.tickets || []
    ];
    for (const source of sources) {
      if (!Array.isArray(source)) continue;
      const match = source.find((ticket) => ticket.id === ticketId);
      if (match) return match;
    }
    return null;
  }

  function renderNotificationItem(entry) {
    const classes = ['notification-item'];
    if (!entry.read_at) classes.push('unread');
    const subtitleParts = [];
    if (entry.metadata?.order_number || entry.order_id) {
      subtitleParts.push(entry.metadata?.order_number || entry.order_id);
    }
    subtitleParts.push(formatRelativeTime(entry.created_at));
    const subtitle = subtitleParts.filter(Boolean).join(' · ');
    return `
      <li class="${classes.join(' ')}">
        <button type="button" class="notification-link" data-notification-id="${entry.id}">
          <span class="notification-item-dot" aria-hidden="true"></span>
          <div>
            <strong>${escapeHtml(entry.title || 'Hinweis')}</strong>
            <p>${escapeHtml(entry.message || '')}</p>
            <small>${escapeHtml(subtitle)}</small>
          </div>
        </button>
        <button
          type="button"
          class="notification-check"
          data-notification-check="${entry.id}"
          aria-pressed="${entry.read_at ? 'true' : 'false'}"
          aria-label="${entry.read_at ? 'Als ungelesen markieren' : 'Benachrichtigung als gelesen markieren'}"
        >
          ✓
        </button>
      </li>
    `;
  }

  function updateNotificationUi() {
    const notifications = state.notifications || [];
    const badge = document.getElementById('notificationBadge');
    const list = document.getElementById('notificationList');
    const emptyState = document.getElementById('notificationEmptyState');
    const unreadCount = notifications.filter((entry) => !entry.read_at).length;
    const visibleNotifications = notifications.filter((entry) => !entry.read_at && !entry.metadata?.closed);
    if (badge) {
      badge.textContent = String(unreadCount);
      if (unreadCount > 0) {
        badge.removeAttribute('hidden');
      } else {
        badge.setAttribute('hidden', 'hidden');
      }
    }
    if (list) {
      if (!visibleNotifications.length) {
        list.innerHTML = '';
        if (emptyState) emptyState.removeAttribute('hidden');
      } else {
        if (emptyState) emptyState.setAttribute('hidden', 'hidden');
        list.innerHTML = visibleNotifications.map((entry) => renderNotificationItem(entry)).join('');
      }
    }
    renderNotificationArchive();
  }

  function renderNotificationArchive() {
    const notifications = state.notifications || [];
    const list = document.getElementById('notificationArchiveList');
    const emptyState = document.getElementById('notificationArchiveEmpty');
    const countLabel = document.getElementById('notificationArchiveCount');
    const unreadCount = notifications.filter((entry) => !entry.read_at).length;
    const readCount = notifications.length - unreadCount;
    if (countLabel) {
      countLabel.textContent = `${unreadCount} offen · ${readCount} abgeschlossen`;
    }
    updateNotificationArchiveTabs();
    if (!list) return;
    const activeTab = state.notificationArchiveTab || 'open';
    const filtered =
      activeTab === 'open'
        ? notifications.filter((entry) => !entry.read_at)
        : notifications.filter((entry) => entry.read_at);
    const emptyMessage =
      activeTab === 'open' ? 'Keine offenen Benachrichtigungen.' : 'Keine abgeschlossenen Benachrichtigungen.';
    if (emptyState) {
      emptyState.textContent = emptyMessage;
    }
    if (!filtered.length) {
      list.innerHTML = '';
      if (emptyState) emptyState.removeAttribute('hidden');
      return;
    }
    if (emptyState) emptyState.setAttribute('hidden', 'hidden');
    list.innerHTML = filtered.map((entry) => renderNotificationItem(entry)).join('');
  }

  function updateNotificationArchiveTabs() {
    const activeTab = state.notificationArchiveTab || 'open';
    document.querySelectorAll('[data-archive-tab]').forEach((button) => {
      const isActive = button.dataset.archiveTab === activeTab;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      button.tabIndex = isActive ? 0 : -1;
    });
  }

  function setNotificationArchiveTab(tab) {
    const normalized = tab === 'closed' ? 'closed' : 'open';
    if (state.notificationArchiveTab === normalized) {
      updateNotificationArchiveTabs();
      return;
    }
    state.notificationArchiveTab = normalized;
    renderNotificationArchive();
  }

  function toggleNotificationPanel(forceOpen = null) {
    const center = document.getElementById('notificationCenter');
    const panel = document.getElementById('notificationPanel');
    if (!center || !panel) return;
    const shouldOpen = forceOpen === null ? !state.notificationPanelOpen : Boolean(forceOpen);
    state.notificationPanelOpen = shouldOpen;
    center.classList.toggle('open', shouldOpen);
    panel.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
    if (shouldOpen) {
      refreshNotifications();
    }
  }

  async function handleNotificationClick(notification) {
    if (!notification) return;
    updateNotificationUi();
    toggleNotificationPanel(false);
    const href = buildNotificationLink(notification);
    if (href) {
      window.location.href = href;
    }
  }

  async function handleNotificationCheck(notificationId) {
    if (!notificationId) return;
    const notification = state.notifications.find((entry) => entry.id === notificationId);
    if (!notification) return;
    const isCurrentlyRead = Boolean(notification.read_at);
    const endpoint = isCurrentlyRead ? 'unread' : 'read';
    try {
      const updated = await request(`/api/notifications/${encodeURIComponent(notification.id)}/${endpoint}`, {
        method: 'POST'
      });
      notification.read_at = updated.read_at || null;
      updateNotificationUi();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function markAllNotificationsRead() {
    try {
      const data = await request('/api/notifications/read-all', { method: 'POST' });
      state.notifications = data.notifications || [];
      updateNotificationUi();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function refreshNotifications(options = {}) {
    const config = typeof options === 'boolean' ? { showErrors: options } : options || {};
    const { showErrors = false, limit, unreadOnly = false } = config;
    if (Number.isFinite(limit)) {
      state.notificationFetchLimit = limit;
    }
    const effectiveLimit = Number.isFinite(limit)
      ? limit
      : Number.isFinite(state.notificationFetchLimit)
        ? state.notificationFetchLimit
        : 25;
    if (!state.user) return;
    try {
      const params = new URLSearchParams();
      if (Number.isFinite(effectiveLimit)) {
        params.set('limit', String(effectiveLimit));
      }
      if (unreadOnly) {
        params.set('unread', 'true');
      }
      const query = params.toString();
      const endpoint = query ? `/api/notifications?${query}` : '/api/notifications';
      const data = await request(endpoint);
      state.notifications = data.notifications || [];
      updateNotificationUi();
    } catch (err) {
      if (showErrors) {
        showToast('Benachrichtigungen konnten nicht geladen werden.');
      }
      console.warn('Benachrichtigungen konnten nicht geladen werden', err.message);
    }
  }

  function scheduleNotificationPolling() {
    if (state.notificationPollInterval) {
      clearInterval(state.notificationPollInterval);
    }
    state.notificationPollInterval = window.setInterval(() => {
      refreshNotifications();
    }, 60000);
  }

  function bindNotificationUi() {
    if (state.notificationHandlersBound) return;
    const center = document.getElementById('notificationCenter');
    const toggle = document.getElementById('notificationToggle');
    const list = document.getElementById('notificationList');
    if (!center || !toggle) return;
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleNotificationPanel();
    });
    if (list) {
      list.addEventListener('click', (event) => {
        const checkTarget = event.target.closest('[data-notification-check]');
        if (checkTarget) {
          event.preventDefault();
          event.stopPropagation();
          handleNotificationCheck(checkTarget.dataset.notificationCheck);
          return;
        }
        const viewTarget = event.target.closest('[data-notification-id]');
        if (!viewTarget) return;
        event.preventDefault();
        const notification = state.notifications.find((entry) => entry.id === viewTarget.dataset.notificationId);
        handleNotificationClick(notification);
      });
    }
    document.addEventListener('click', (event) => {
      if (!state.notificationPanelOpen) return;
      if (center.contains(event.target)) return;
      toggleNotificationPanel(false);
    });
    state.notificationHandlersBound = true;
  }

  async function initNotificationsPage() {
    const list = document.getElementById('notificationArchiveList');
    if (list) {
      list.addEventListener('click', (event) => {
        const checkTarget = event.target.closest('[data-notification-check]');
        if (checkTarget) {
          event.preventDefault();
          event.stopPropagation();
          handleNotificationCheck(checkTarget.dataset.notificationCheck);
          return;
        }
        const viewTarget = event.target.closest('[data-notification-id]');
        if (!viewTarget) return;
        event.preventDefault();
        event.stopPropagation();
        const notification = state.notifications.find((entry) => entry.id === viewTarget.dataset.notificationId);
        handleNotificationClick(notification);
      });
    }
    const refreshBtn = document.getElementById('notificationArchiveRefresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        await refreshNotifications({ showErrors: true, limit: 200 });
      });
    }
    const markAllBtn = document.getElementById('notificationArchiveMarkAll');
    if (markAllBtn) {
      markAllBtn.addEventListener('click', async () => {
        await markAllNotificationsRead();
      });
    }
    document.querySelectorAll('[data-archive-tab]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        const targetTab = event.currentTarget?.dataset?.archiveTab;
        setNotificationArchiveTab(targetTab);
      });
    });
    renderNotificationArchive();
    await refreshNotifications({ showErrors: true, limit: 200 });
  }

  function formatDurationSeconds(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '–';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    if (days > 0) {
      return `${days} Tg ${hours} Std`;
    }
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours} Std ${minutes} Min`;
  }

  function formatDurationMs(milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return '';
    if (milliseconds < 1000) {
      return `${Math.round(milliseconds)} ms`;
    }
    if (milliseconds < 60000) {
      return `${(milliseconds / 1000).toFixed(1)} s`;
    }
    return `${(milliseconds / 60000).toFixed(1)} min`;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '–';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function parseNumberInput(value) {
    if (value === undefined || value === null || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function resolveStoredLocale() {
    const stored = localStorage.getItem('preferredLocale');
    if (SUPPORTED_LOCALES.some((entry) => entry.code === stored)) {
      return stored;
    }
    const browser = navigator.language?.toLowerCase() || 'de';
    if (browser.startsWith('tr')) return 'tr';
    return 'de';
  }

  function isDefaultLocale(locale = state.locale) {
    return !locale || locale === 'de';
  }

  async function loadLocaleData(locale) {
    if (isDefaultLocale(locale) || state.translations[locale]) {
      return state.translations[locale];
    }
    const response = await fetch(`/api/public/locales/${locale}`);
    if (!response.ok) {
      throw new Error(`Locale-Datei für ${locale} fehlt`);
    }
    const payload = await response.json();
    const entries = payload?.entries || {};
    state.translations[locale] = entries;
    return entries;
  }

  function getTranslationMap() {
    if (isDefaultLocale()) return null;
    return state.translations[state.locale] || null;
  }

  function logMissingTranslation(text) {
    if (!text || isDefaultLocale()) return;
    if (!state.missingTranslations.has(text)) {
      state.missingTranslations.add(text);
      console.warn(`[i18n] Fehlende Übersetzung für "${text}" (${state.locale}).`);
    }
  }

  function translateLiteral(text) {
    if (isDefaultLocale() || !text) return text;
    const trimmed = text.trim();
    if (!trimmed) return text;
    const map = getTranslationMap();
    if (!map) return text;
    const translation = map[trimmed];
    if (!translation) {
      logMissingTranslation(trimmed);
      return text;
    }
    return text.replace(trimmed, translation);
  }

  function translateTemplate(template, replacements = {}) {
    if (!template) return '';
    const base = isDefaultLocale() ? template : getTranslationMap()?.[template] || template;
    return base.replace(/{{\s*([^}\s]+)\s*}}/g, (_, key) => {
      return replacements[key] ?? '';
    });
  }

  function applyKeyedTranslations(root = document.body) {
    const base = root instanceof Element ? root : document.body;
    const elements = base.querySelectorAll('[data-i18n-key]');
    elements.forEach((element) => {
      const key = element.dataset.i18nKey;
      if (!key) return;
      const attr = element.dataset.i18nAttr;
      const target = element.dataset.i18nTarget || 'text';
      const translation = translateTemplate(key);
      if (attr) {
        element.setAttribute(attr, translation);
      } else if (target === 'html') {
        element.innerHTML = translation;
      } else {
        element.textContent = translation;
      }
      element.dataset.i18nApplied = state.locale || 'default';
    });
  }

  function translateTextNode(node) {
    if (isDefaultLocale() || node.__i18nApplied === state.locale) return;
    const content = node.textContent;
    if (!content) return;
    const trimmed = content.trim();
    if (!trimmed) return;
    const map = getTranslationMap();
    if (!map) return;
    const translation = map[trimmed];
    if (!translation) {
      logMissingTranslation(trimmed);
      return;
    }
    const start = content.indexOf(trimmed);
    const end = start + trimmed.length;
    node.textContent = `${content.slice(0, start)}${translation}${content.slice(end)}`;
    node.__i18nApplied = state.locale;
  }

  function translateAttributes(root) {
    if (isDefaultLocale()) return;
    const elements = root instanceof Element ? [root, ...root.querySelectorAll('*')] : document.querySelectorAll('*');
    TRANSLATABLE_ATTRIBUTES.forEach((attr) => {
      elements.forEach((element) => {
        if (element.dataset?.i18nAttr === attr) return;
        const value = element.getAttribute(attr);
        if (!value) return;
        const translated = translateLiteral(value);
        if (translated !== value) {
          element.setAttribute(attr, translated);
        }
      });
    });
  }

  function applyTranslations(root = document.body) {
    const base = root instanceof Element ? root : document.body;
    applyKeyedTranslations(base);
    if (isDefaultLocale()) return;
    translateAttributes(base);
    const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node?.textContent?.trim()) return NodeFilter.FILTER_REJECT;
        if (!node.parentElement) return NodeFilter.FILTER_REJECT;
        const tag = node.parentElement.tagName;
        if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(tag)) return NodeFilter.FILTER_REJECT;
        if (node.parentElement.dataset?.i18nKey && !node.parentElement.dataset.i18nAttr)
          return NodeFilter.FILTER_REJECT;
        if (node.parentElement.dataset?.i18nIgnore === 'true') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) {
      translateTextNode(walker.currentNode);
    }
  }

  function setupTranslationObserver() {
    if (isDefaultLocale() || state.translationObserver) return;
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            translateTextNode(node);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            applyTranslations(node);
          }
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    state.translationObserver = observer;
  }

  async function changeLocale(locale, { syncServer = true } = {}) {
    if (!SUPPORTED_LOCALES.some((entry) => entry.code === locale) || state.locale === locale) {
      return;
    }
    localStorage.setItem('preferredLocale', locale);
    state.locale = locale;
    if (syncServer && state.user) {
      try {
        await request('/api/locale', {
          method: 'POST',
          body: { locale }
        });
      } catch (err) {
        console.warn('Locale-Update fehlgeschlagen', err);
      }
    }
    window.location.reload();
  }

  function bindLanguageSwitcher() {
    const select = document.getElementById('languageSelect');
    if (!select) return;
    select.innerHTML = SUPPORTED_LOCALES.map((entry) => `<option value="${entry.code}">${entry.label}</option>`).join('');
    select.value = state.locale;
    select.addEventListener('change', (event) => {
      changeLocale(event.target.value);
    });
    updateLanguageSwitcherState();
  }

  async function initLocalization() {
    state.locale = resolveStoredLocale();
    bindLanguageSwitcher();
    if (!isDefaultLocale()) {
      await loadLocaleData(state.locale).catch((err) => console.warn('Locale konnte nicht geladen werden', err));
      applyTranslations();
      setupTranslationObserver();
    }
  }

  function updateLanguageSwitcherState() {
    const select = document.getElementById('languageSelect');
    if (!select) return;
    const forcedLocale = getForcedLocaleForRole(state.user?.role);
    if (forcedLocale) {
      select.value = forcedLocale;
      select.disabled = true;
      return;
    }
    select.disabled = false;
  }

  function buildTicketLink(ticket) {
    if (ticket.position_id) {
      const params = new URLSearchParams({
        order: ticket.order_id,
        position: ticket.position_id
      });
      if (ticket.view_key) params.append('view', ticket.view_key);
      return `/techpack.html?${params.toString()}`;
    }
    return `/bestellung.html?order=${encodeURIComponent(ticket.order_id)}`;
  }

  function renderMetricTable(targetId, entries = [], emptyLabel = 'Keine Daten') {
    const container = document.getElementById(targetId);
    if (!container) return;
    if (!entries.length) {
      container.innerHTML = `<p class="muted">${escapeHtml(emptyLabel)}</p>`;
      return;
    }
    container.innerHTML = `
      <table class="status-table">
        <tbody>
          ${entries
            .map(
              (entry) => `
                <tr>
                  <td>${escapeHtml(entry.label || entry.key || '-')}</td>
                  <td>${entry.count ?? 0}</td>
                </tr>`
            )
            .join('')}
        </tbody>
      </table>
    `;
  }

  function renderDiagnosticsSummary(data) {
    const container = document.getElementById('diagnosticsSummary');
    if (!container) return;
    const completed = data.orders?.by_status?.find((entry) => entry.key === 'UEBERGEBEN_AN_SPEDITION')?.count || 0;
    const shipped = data.orders?.by_status?.find((entry) => entry.key === 'WARE_ABHOLBEREIT')?.count || 0;
    const openOrders = Math.max(0, (data.orders?.total || 0) - completed - shipped);
    const closedTickets = data.tickets?.by_status?.find((entry) => entry.key === 'CLOSED')?.count || 0;
    const openTickets = Math.max(0, (data.tickets?.total || 0) - closedTickets);
    const cards = [
      {
        title: 'Letzter Sync',
        value: data.sync?.last_run ? formatRelativeTime(data.sync.last_run) : 'kein Lauf',
        detail: data.sync?.source ? `Quelle: ${data.sync.source}` : ''
      },
      {
        title: 'Offene Bestellungen',
        value: openOrders,
        detail: `${data.orders?.total || 0} gesamt`
      },
      {
        title: 'Offene Tickets',
        value: openTickets,
        detail: `${data.tickets?.total || 0} gesamt`
      },
      {
        title: 'System-Uptime',
        value: formatDurationSeconds(data.server?.uptime_seconds),
        detail: data.server?.node_version ? `Node ${data.server.node_version}` : ''
      }
    ];
    container.innerHTML = cards
      .map(
        (card) => `
          <article class="card">
            <h3>${escapeHtml(card.title)}</h3>
            <p class="value">${escapeHtml(card.value?.toString() || '-')}</p>
            ${card.detail ? `<p class="muted">${escapeHtml(card.detail)}</p>` : ''}
          </article>
        `
      )
      .join('');
  }

  function renderDiagnosticsAlerts(alerts = []) {
    const list = document.getElementById('diagnosticsAlerts');
    if (!list) return;
    if (!alerts.length) {
      list.innerHTML = '<li class="info">Alles im grünen Bereich.</li>';
      return;
    }
    list.innerHTML = alerts
      .map((alert) => `<li class="${alert.level || 'info'}">${escapeHtml(alert.message)}</li>`)
      .join('');
  }

  function renderDiagnosticsJobs(data) {
    const jobs = data.jobs || [];
    const list = document.getElementById('diagnosticsJobs');
    if (list) {
      if (!jobs.length) {
        list.innerHTML = '<p class="muted">Keine Dienste registriert.</p>';
      } else {
        list.innerHTML = jobs
          .map((job) => {
            const pillClass = job.healthy ? 'ok' : job.ageMinutes && job.ageMinutes > 90 ? 'danger' : 'warn';
            const pillLabel = job.healthy ? 'OK' : 'Check';
            const lastRun = job.lastRun ? formatRelativeTime(job.lastRun) : 'nie';
            return `
              <div class="status-row">
                <div>
                  <strong>${escapeHtml(job.name)}</strong>
                  <div class="muted">Plan: ${escapeHtml(job.schedule || '-')}</div>
                </div>
                <div>
                  <div class="status-pill ${pillClass}">${pillLabel}</div>
                  <div class="muted">Letzter Lauf: ${escapeHtml(lastRun)}</div>
                </div>
              </div>
            `;
          })
          .join('');
      }
    }
    const serverMeta = document.getElementById('diagnosticsServerMeta');
    if (serverMeta) {
      const memory = data.server?.memory || {};
      serverMeta.innerHTML = [
        `<div><strong>RSS</strong><br />${escapeHtml(formatBytes(memory.rss))}</div>`,
        `<div><strong>Heap benutzt</strong><br />${escapeHtml(formatBytes(memory.heap_used))}</div>`,
        `<div><strong>Env</strong><br />${escapeHtml(data.server?.environment || '-')}</div>`
      ].join('');
    }
  }

  function renderDiagnosticsOverdue(rows = []) {
    const body = document.getElementById('diagnosticsOverdue');
    if (!body) return;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="4" class="muted">Keine Verzögerungen.</td></tr>';
      return;
    }
    body.innerHTML = rows
      .map((row) => {
        const label = row.order_number || row.id;
        const link = label ? `/bestellung.html?order=${encodeURIComponent(row.id)}` : null;
        const statusLabel = STATUS_LABELS[row.portal_status] || row.portal_status || '-';
        return `
          <tr>
            <td>${link ? `<a href="${link}">${escapeHtml(label)}</a>` : escapeHtml(label || '-')}</td>
            <td>${escapeHtml(row.customer_name || '-')}</td>
            <td>${escapeHtml(statusLabel)}</td>
            <td>${row.days_overdue ?? '?'} Tg</td>
          </tr>
        `;
      })
      .join('');
  }

  function renderDiagnosticsLogs(logs = []) {
    const list = document.getElementById('diagnosticsLogs');
    if (!list) return;
    if (!logs.length) {
      list.innerHTML = '<li class="muted">Keine Einträge.</li>';
      return;
    }
    list.innerHTML = logs
      .map((log) => {
        const orderLabel = log.order_id ? `Order ${log.order_id}` : 'Global';
        return `
          <li>
            <strong>${escapeHtml(log.action || 'Log')}</strong>
            <div class="muted">${escapeHtml(orderLabel)} · ${escapeHtml(formatRelativeTime(log.ts))}</div>
          </li>
        `;
      })
      .join('');
  }

  function renderDiagnosticsEvents(events = []) {
    const list = document.getElementById('diagnosticsEvents');
    if (!list) return;
    if (!events.length) {
      list.innerHTML = '<li class="muted">Keine Termine in den nächsten Tagen.</li>';
      return;
    }
    list.innerHTML = events
      .map((event) => {
        const date = event.start ? new Date(event.start).toLocaleString('de-DE') : '-';
        const badge = event.type === 'manual' ? 'Manuell' : 'Auto';
        return `
          <li>
            <strong>${escapeHtml(event.title || 'Event')}</strong>
            <div class="muted">${escapeHtml(date)} · ${escapeHtml(badge)}</div>
          </li>
        `;
      })
      .join('');
  }

  function renderDiagnosticsTests(tests = {}) {
    const summaryEl = document.getElementById('diagnosticsTestsSummary');
    if (summaryEl) {
      const summary = tests.summary;
      if (!summary) {
        summaryEl.innerHTML = '<span class="muted">Keine Tests definiert.</span>';
      } else {
        summaryEl.innerHTML = `
          <span>Gesamt: ${summary.total || 0}</span>
          <span class="status-pill ok">OK: ${summary.ok || 0}</span>
          <span class="status-pill warn">Warnungen: ${summary.warn || 0}</span>
          <span class="status-pill danger">Fehler: ${summary.error || 0}</span>
          <span class="status-pill muted">Übersprungen: ${summary.skipped || 0}</span>
        `;
      }
    }
    const list = document.getElementById('diagnosticsTests');
    if (!list) return;
    const results = Array.isArray(tests.results) ? tests.results : [];
    if (!results.length) {
      list.innerHTML = '<li class="muted">Keine Tests hinterlegt.</li>';
      return;
    }
    list.innerHTML = results
      .map((entry) => {
        const status = entry.status || 'ok';
        let pillClass = 'ok';
        let pillLabel = 'OK';
        if (status === 'warn') {
          pillClass = 'warn';
          pillLabel = 'Warnung';
        } else if (status === 'error') {
          pillClass = 'danger';
          pillLabel = 'Fehler';
        } else if (status === 'skipped') {
          pillClass = 'muted';
          pillLabel = 'Übersprungen';
        }
        const durationLabel = formatDurationMs(entry.duration_ms);
        return `
          <li>
            <div class="test-head">
              <strong>${escapeHtml(entry.label || entry.id || 'Test')}</strong>
              <span class="status-pill ${pillClass}">${pillLabel}</span>
            </div>
            ${entry.detail ? `<div class="muted">${escapeHtml(entry.detail)}</div>` : ''}
            ${durationLabel ? `<div class="muted">Dauer: ${escapeHtml(durationLabel)}</div>` : ''}
          </li>
        `;
      })
      .join('');
  }

  function renderDiagnosticsEscalated(list = []) {
    const container = document.getElementById('diagnosticsEscalated');
    if (!container) return;
    if (!list.length) {
      container.innerHTML = '<p class="muted">Keine dringenden Tickets.</p>';
      return;
    }
    container.innerHTML = `
      <h4>Priorität Hoch</h4>
      <ul class="log-list">
        ${list
          .map(
            (ticket) => `
              <li>
                <strong><a href="${buildTicketLink(ticket)}">${escapeHtml(resolveTicketTitle(ticket))}</a></strong>
                <div class="muted">${escapeHtml(ticket.order_id || '')} · ${escapeHtml(formatRelativeTime(ticket.updated_at))}</div>
              </li>
            `
          )
          .join('')}
      </ul>
    `;
  }

  function renderDiagnosticsSpecs(list = []) {
    const container = document.getElementById('diagnosticsSpecs');
    if (!container) return;
    if (!list.length) {
      container.innerHTML = '<p class="muted">Keine offenen Spezifikationen.</p>';
      return;
    }
    container.innerHTML = `
      <h4>Offene Spezifikationen</h4>
      <ul class="log-list">
        ${list
          .map(
            (spec) => `
              <li>
                <strong>${escapeHtml(spec.order_id)} · ${escapeHtml(spec.position_id)}</strong>
                <div class="muted">${escapeHtml(translateTemplate('Rückfragen'))}: ${spec.rueckfragen || 0} · ${escapeHtml(
                  formatRelativeTime(spec.updated_at)
                )}</div>
              </li>
            `
          )
          .join('')}
      </ul>
    `;
  }

  function renderDiagnostics(data) {
    renderDiagnosticsSummary(data);
    renderDiagnosticsAlerts(data.alerts || []);
    renderDiagnosticsJobs(data);
    renderMetricTable('diagnosticsOrdersStatus', data.orders?.by_status || [], 'Keine Bestellungen.');
    renderMetricTable('diagnosticsOrdersPhase', data.orders?.by_phase || [], 'Keine Phasen.');
    renderMetricTable('diagnosticsTicketsStatus', data.tickets?.by_status || [], 'Keine Tickets.');
    renderMetricTable('diagnosticsTicketsPriority', data.tickets?.by_priority || [], 'Keine Prioritäten.');
    renderDiagnosticsEscalated(data.tickets?.escalated || []);
    renderDiagnosticsSpecs(data.specs?.pending_review || []);
    renderDiagnosticsTests(data.tests || {});
    renderDiagnosticsOverdue(data.orders?.overdue || []);
    renderDiagnosticsLogs(data.logs?.recent || []);
    renderDiagnosticsEvents(data.calendar?.upcoming || []);
  }

  async function loadDiagnostics() {
    try {
      const data = await request('/api/diagnostics');
      state.diagnostics = data;
      renderDiagnostics(data);
    } catch (err) {
      showToast(err.message);
      const list = document.getElementById('diagnosticsAlerts');
      if (list) {
        list.innerHTML = `<li class="danger">${escapeHtml(err.message)}</li>`;
      }
    }
  }

  function renderTranslationManager() {
    const select = document.getElementById('translationLocaleSelect');
    if (select) {
      select.innerHTML = state.translationManager.locales
        .map((locale) => `<option value="${locale}">${locale.toUpperCase()}</option>`)
        .join('');
      select.value = state.translationManager.locale;
    }
    const summary = document.getElementById('translationSummary');
    const entries = state.translationManager.entries || {};
    const filter = state.translationManager.filter?.toLowerCase() || '';
    const rows = Object.entries(entries)
      .filter(([key, value]) => {
        if (!filter) return true;
        return key.toLowerCase().includes(filter) || (value || '').toLowerCase().includes(filter);
      })
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB, 'de', { sensitivity: 'base' }));
    if (summary) {
      summary.textContent = `${rows.length} / ${Object.keys(entries).length} Einträge`;
    }
    const tableBody = document.getElementById('translationTableBody');
    if (!tableBody) return;
    if (!rows.length) {
      tableBody.innerHTML = '<tr><td colspan="3" class="muted">Keine Einträge.</td></tr>';
      return;
    }
    tableBody.innerHTML = rows
      .map(
        ([key, value]) => `
          <tr>
            <td>${escapeHtml(key)}</td>
            <td>${escapeHtml(value)}</td>
            <td class="table-actions">
              <button type="button" class="ghost small" data-action="edit-translation" data-key="${escapeHtml(key)}">Bearbeiten</button>
              <button type="button" class="ghost small danger" data-action="delete-translation" data-key="${escapeHtml(key)}">Löschen</button>
            </td>
          </tr>
        `
      )
      .join('');
  }

  async function fetchTranslationsForManager(locale) {
    try {
      const data = await request(`/api/translations?locale=${encodeURIComponent(locale)}`);
      state.translationManager.locale = data.locale || locale;
      state.translationManager.locales = data.locales?.length ? data.locales : [state.translationManager.locale];
      state.translationManager.entries = data.entries || {};
      renderTranslationManager();
    } catch (err) {
      showToast(err.message);
      const tableBody = document.getElementById('translationTableBody');
      if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="3" class="muted">${escapeHtml(err.message)}</td></tr>`;
      }
    }
  }

  async function initTranslationsPage() {
    if (!isInternalRole(state.user?.role)) {
      showToast('Keine Berechtigung');
      const tableBody = document.getElementById('translationTableBody');
      if (tableBody) {
        tableBody.innerHTML = '<tr><td colspan="3" class="muted">Keine Berechtigung.</td></tr>';
      }
      return;
    }
    await fetchTranslationsForManager(state.translationManager.locale);
    const select = document.getElementById('translationLocaleSelect');
    if (select) {
      select.addEventListener('change', async (event) => {
        state.translationManager.locale = event.target.value;
        await fetchTranslationsForManager(state.translationManager.locale);
      });
    }
    const searchInput = document.getElementById('translationSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (event) => {
        state.translationManager.filter = event.target.value;
        renderTranslationManager();
      });
    }
    const form = document.getElementById('translationForm');
    if (form) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(form);
        const key = formData.get('key')?.toString().trim();
        const value = formData.get('value')?.toString().trim();
        if (!key || !value) {
          showToast('Key und Wert erforderlich.');
          return;
        }
        await request('/api/translations', {
          method: 'POST',
          body: {
            locale: state.translationManager.locale,
            key,
            value
          }
        });
        form.reset();
        showToast('Übersetzung gespeichert.');
        await fetchTranslationsForManager(state.translationManager.locale);
      });
    }
    const table = document.getElementById('translationTable');
    if (table) {
      table.addEventListener('click', async (event) => {
        const target = event.target instanceof HTMLElement ? event.target.closest('button[data-action]') : null;
        if (!target) return;
        const key = target.dataset.key;
        if (!key) return;
        if (target.dataset.action === 'edit-translation') {
          const keyField = document.querySelector('#translationForm input[name="key"]');
          const valueField = document.querySelector('#translationForm textarea[name="value"]');
          if (keyField) keyField.value = key;
          if (valueField) valueField.value = state.translationManager.entries[key] || '';
          valueField?.focus();
        } else if (target.dataset.action === 'delete-translation') {
          const confirmDelete = window.confirm('Eintrag löschen?');
          if (!confirmDelete) return;
          await request(`/api/translations/${encodeURIComponent(state.translationManager.locale)}?key=${encodeURIComponent(key)}`, {
            method: 'DELETE'
          });
          showToast('Eintrag entfernt.');
          await fetchTranslationsForManager(state.translationManager.locale);
        }
      });
    }
  }

  function isImageUrl(url) {
    if (!url) return false;
    const clean = url.split('?')[0].toLowerCase();
    return /(\.png|\.jpe?g|\.webp|\.gif|\.svg)$/.test(clean);
  }

  function getTicketPreviewImage(ticket) {
    if (ticket.preview_url && isImageUrl(ticket.preview_url)) {
      return ticket.preview_url;
    }
    const commentWithAttachment = (ticket.comments || []).find((comment) => isImageUrl(comment.attachment?.url));
    if (commentWithAttachment) {
      return commentWithAttachment.attachment.url;
    }
    return null;
  }

  function renderOpenTicketList(target, items, emptyMessage = 'Keine offenen Tickets') {
    if (!target) return;
    if (!items.length) {
      target.innerHTML = `<li class="muted">${escapeHtml(emptyMessage)}</li>`;
      return;
    }
    const orderLabel = translateTemplate('Bestellnummer');
    const typeMetaLabel = translateTemplate('Art');
    const openLabel = translateTemplate('Öffnen');
    target.innerHTML = items
      .map((ticket) => {
        const link = buildTicketLink(ticket);
        const typeLabel = translateTemplate(ticket.position_id ? 'Artikelticket' : 'Bestellticket');
        const previewUrl = getTicketPreviewImage(ticket);
        const previewAlt = translateTemplate('Ticket Vorschaubild');
        const preview = previewUrl
          ? `<div class="ticket-preview"><img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(previewAlt)}" loading="lazy" /></div>`
          : '';
        return `<li>
          ${preview}
          <div class="ticket-list-body">
            <p class="ticket-list-title">${escapeHtml(resolveTicketTitle(ticket))}</p>
            <p class="ticket-list-meta">${ticket.id}</p>
            <p class="ticket-list-meta">${escapeHtml(orderLabel)}: ${escapeHtml(ticket.order_id)}${
              ticket.position_id ? ` · ${escapeHtml(ticket.position_id)}` : ''
            }</p>
            <p class="ticket-list-meta">${escapeHtml(typeMetaLabel)}: ${escapeHtml(typeLabel)}</p>
            <div class="ticket-row-actions">
              <a class="ghost small" href="${link}" ${ticket.position_id ? 'target="_blank" rel="noopener"' : ''}>${escapeHtml(
                openLabel
              )}</a>
            </div>
          </div>
        </li>`;
      })
      .join('');
  }

  function formatLines(lines) {
    return (lines || []).map((line) => escapeHtml(line)).join('<br />');
  }

function deriveSizeList(order) {
  const sizes = new Map();
  (order.positions || []).forEach((pos) => {
    Object.entries(pos.size_breakdown || {}).forEach(([size, quantity]) => {
      if (!size && size !== 0) return;
      const key = size.toString();
      const value = Number(quantity) || 0;
      sizes.set(key, (sizes.get(key) || 0) + value);
    });
  });
  if (!sizes.size) {
    SIZE_COLUMNS.forEach((size) => sizes.set(size, 0));
  }
  const filtered = Array.from(sizes.entries())
    .filter(([, total]) => total > 0)
    .map(([size]) => size);
  if (!filtered.length) {
    return Array.from(sizes.keys()).sort((a, b) => a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' }));
  }
  return filtered.sort((a, b) => a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' }));
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

  function buildCartonValues(source = {}, sizes = state.sizeList) {
    return sizes.reduce((acc, size) => {
      acc[size] = source[size] ?? '';
      return acc;
    }, {});
  }

  function ensureCartonMeta(carton) {
    const defaults = state.cartonDefaults || {};
    carton.meta = carton.meta || {};
    carton.meta.variation = carton.meta.variation ?? defaults.variation ?? '';
    carton.meta.article = carton.meta.article ?? defaults.article ?? '';
    carton.meta.leather = carton.meta.leather ?? defaults.leather ?? '';
    carton.meta.sole = carton.meta.sole ?? defaults.sole ?? '';
    return carton.meta;
  }

  function createEmptyCarton(number = 1, overrides = {}) {
    const defaults = state.cartonDefaults || {};
    return {
      id: `carton-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      number,
      values: buildCartonValues({}, state.sizeList),
      meta: {
        variation: overrides.variation ?? defaults.variation ?? '',
        article: overrides.article ?? defaults.article ?? '',
        leather: overrides.leather ?? defaults.leather ?? '',
        sole: overrides.sole ?? defaults.sole ?? ''
      }
    };
  }

  function initializeCartonState(order) {
    state.sizeList = deriveSizeList(order);
    const basePosition = order.positions?.[0] || {};
    state.cartonDefaults = {
      variation: basePosition.variation || basePosition.item_code || order.order_number || '',
      article: basePosition.item_code || '',
      leather: basePosition.material || basePosition.description || '',
      sole: basePosition.sole || ''
    };
    const sourceCartons = order.cartons || [];
    if (sourceCartons.length) {
      state.labelCartons = sourceCartons.map((carton, idx) => {
        const instance = createEmptyCarton(carton.number || idx + 1, {
          variation: carton.variation,
          article: carton.article,
          leather: carton.leather,
          sole: carton.sole
        });
        instance.id = carton.id || `carton-${idx + 1}`;
        instance.values = buildCartonValues(carton.sizes || carton.size_breakdown || {}, state.sizeList);
        return instance;
      });
    } else {
      const totals = deriveOrderSizeTotals(order);
      const first = createEmptyCarton(1);
      first.id = 'carton-1';
      first.values = buildCartonValues(totals, state.sizeList);
      state.labelCartons = [first];
    }
    state.activeCartonIndex = 0;
    renderCartonEditor();
  }

  function renderCartonEditor() {
    renderSizeMatrix();
  }

  function renderSizeMatrix() {
    const container = document.getElementById('sizeEditorMatrix');
    if (!container) return;
    if (!state.sizeList.length) {
      container.innerHTML = `<p class="muted">${escapeHtml(translateTemplate('Keine Größen für diese Bestellung vorhanden.'))}</p>`;
      return;
    }
    if (!state.labelCartons.length) {
      state.labelCartons.push(createEmptyCarton(1));
    }
    const rows = state.labelCartons
      .map((carton, index) => {
        const isActive = index === state.activeCartonIndex;
        const meta = ensureCartonMeta(carton);
        const sizeInputs = state.sizeList
          .map((size) => {
            const value = carton.values[size] ?? '';
            return `
              <div class="size-row">
                <span>${size}</span>
                <input type="number" min="0" step="1" data-carton="${index}" data-size="${size}" value="${value}" />
              </div>`;
          })
          .join('');
        const cartonLabel = translateTemplate('Karton {{number}}', { number: carton.number });
        const removeLabel = translateTemplate('Karton entfernen');
        const variationLabel = translateTemplate('Variation-Nr.');
        const articleLabel = translateTemplate('Artikel-Nr.');
        const leatherLabel = translateTemplate('Leder & Farbe');
        const soleLabel = translateTemplate('Sohle');
        return `
          <div class="carton-row ${isActive ? 'active' : ''}" data-index="${index}">
            <div class="carton-row-head">
              <label class="selector">
                <input type="radio" name="cartonSelection" ${isActive ? 'checked' : ''} data-carton-select="${index}" />
                ${escapeHtml(cartonLabel)}
              </label>
              <input type="number" min="1" step="1" value="${carton.number}" data-carton-number="${index}" />
              <button type="button" class="ghost carton-remove" data-remove-carton="${index}" aria-label="${escapeHtml(removeLabel)}">×</button>
            </div>
            <div class="carton-meta-grid">
              <label>${escapeHtml(variationLabel)}
                <input type="text" data-carton-meta="variation" data-carton="${index}" value="${escapeHtml(meta.variation || '')}" />
              </label>
              <label>${escapeHtml(articleLabel)}
                <input type="text" data-carton-meta="article" data-carton="${index}" value="${escapeHtml(meta.article || '')}" />
              </label>
              <label>${escapeHtml(leatherLabel)}
                <input type="text" data-carton-meta="leather" data-carton="${index}" value="${escapeHtml(meta.leather || '')}" />
              </label>
              <label>${escapeHtml(soleLabel)}
                <input type="text" data-carton-meta="sole" data-carton="${index}" value="${escapeHtml(meta.sole || '')}" />
              </label>
            </div>
            <div class="carton-size-grid">
              ${sizeInputs}
            </div>
          </div>`;
      })
      .join('');
    container.innerHTML = rows || `<p class="muted">${escapeHtml(translateTemplate('Keine Kartons konfiguriert.'))}</p>`;
    container.querySelectorAll('input[data-carton][data-size]').forEach((input) => {
      input.addEventListener('input', (event) => {
        const idx = Number(event.target.dataset.carton);
        const size = event.target.dataset.size;
        if (Number.isNaN(idx) || !size) return;
        if (!state.labelCartons[idx]) return;
        state.labelCartons[idx].values[size] = event.target.value;
      });
    });
    container.querySelectorAll('input[data-carton-select]').forEach((input) => {
      input.addEventListener('change', (event) => {
        const idx = Number(event.target.dataset.cartonSelect);
        if (Number.isNaN(idx)) return;
        state.activeCartonIndex = idx;
        renderCartonEditor();
      });
    });
    container.querySelectorAll('button[data-remove-carton]').forEach((button) => {
      button.addEventListener('click', (event) => {
        const idx = Number(event.currentTarget.dataset.removeCarton);
        removeCartonColumn(idx);
      });
    });
    container.querySelectorAll('input[data-carton-number]').forEach((input) => {
      input.addEventListener('input', (event) => {
        const idx = Number(event.target.dataset.cartonNumber);
        if (Number.isNaN(idx)) return;
        const value = Number(event.target.value);
        if (!Number.isFinite(value) || value < 1) return;
        if (state.labelCartons[idx]) {
          state.labelCartons[idx].number = value;
          renderCartonEditor();
        }
      });
    });
    container.querySelectorAll('input[data-carton-meta]').forEach((input) => {
      input.addEventListener('input', (event) => {
        const idx = Number(event.target.dataset.carton);
        const field = event.target.dataset.cartonMeta;
        if (Number.isNaN(idx) || !field || !state.labelCartons[idx]) return;
        const meta = ensureCartonMeta(state.labelCartons[idx]);
        meta[field] = event.target.value;
      });
    });
  }

  function getNextCartonNumber() {
    if (!state.labelCartons.length) return 1;
    return Math.max(...state.labelCartons.map((carton) => Number(carton.number) || 0)) + 1;
  }

  function addCartonColumn() {
    const nextNumber = getNextCartonNumber();
    state.labelCartons.push(createEmptyCarton(nextNumber));
    state.activeCartonIndex = state.labelCartons.length - 1;
    updateCartonTotalInput();
    renderCartonEditor();
  }

  function removeCartonColumn(index) {
    state.labelCartons.splice(index, 1);
    if (!state.labelCartons.length) {
      state.labelCartons.push(createEmptyCarton(1));
    }
    if (state.activeCartonIndex >= state.labelCartons.length) {
      state.activeCartonIndex = state.labelCartons.length - 1;
    }
    updateCartonTotalInput();
    renderCartonEditor();
  }
  function ensureCartonCount(desiredCount) {
    const target = Math.max(1, Math.floor(desiredCount || 1));
    if (state.labelCartons.length === target) return;
    while (state.labelCartons.length < target) {
      state.labelCartons.push(createEmptyCarton(getNextCartonNumber()));
    }
    while (state.labelCartons.length > target) {
      state.labelCartons.pop();
    }
    if (state.activeCartonIndex >= state.labelCartons.length) {
      state.activeCartonIndex = state.labelCartons.length - 1;
    }
    updateCartonTotalInput();
    renderCartonEditor();
  }

  function syncCartonCountWithInput() {
    const totalInput = document.getElementById('cartonTotal');
    if (!totalInput) return;
    const desired = Number(totalInput.value) || state.labelCartons.length || 1;
    ensureCartonCount(desired);
  }

  function resetCartonsFromOrder(order = state.selectedOrder) {
    if (!order) return;
    const totals = deriveOrderSizeTotals(order);
    state.labelCartons = state.labelCartons.map((carton, index) => {
      const meta = ensureCartonMeta(carton);
      return {
        ...carton,
        values: index === 0 ? buildCartonValues(totals, state.sizeList) : buildCartonValues({}, state.sizeList),
        meta: {
          variation: meta.variation || state.cartonDefaults?.variation || '',
          article: meta.article || state.cartonDefaults?.article || '',
          leather: meta.leather || state.cartonDefaults?.leather || '',
          sole: meta.sole || state.cartonDefaults?.sole || ''
        }
      };
    });
    state.activeCartonIndex = 0;
    syncCartonCountWithInput();
  }

  function updateCartonTotalInput() {
    const totalInput = document.getElementById('cartonTotal');
    if (totalInput) totalInput.value = state.labelCartons.length;
  }

  function bindSizeEditorControls() {
    if (state.sizeEditorBound) return;
    document.getElementById('addSizeColumnBtn')?.addEventListener('click', addCartonColumn);
    document.getElementById('resetSizeEditor')?.addEventListener('click', () => resetCartonsFromOrder());
    state.sizeEditorBound = true;
  }

  function getActiveCarton() {
    return state.labelCartons[state.activeCartonIndex];
  }

  function cartonToSizeTable(carton) {
    return state.sizeList.map((size) => ({
      size,
      quantity:
        carton?.values?.[size] === '' || carton?.values?.[size] === undefined
          ? ''
          : Number(carton.values[size]) || 0
    }));
  }

  function getCartonPayload(carton, total) {
    const meta = ensureCartonMeta(carton);
    return {
      cartonNumber: carton.number,
      cartonTotal: total,
      size_table: cartonToSizeTable(carton),
      variation: meta.variation,
      article: meta.article,
      leather: meta.leather,
      sole: meta.sole
    };
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function getDeliveryAddress(customerId, order) {
    const customer = state.customers.find((c) => c.id === customerId) || {};
    const addresses = Array.isArray(state.addresses) ? state.addresses : [];
    const delivery = addresses.find(
      (addr) => addr.customer_id === customerId && (addr.type || '').toLowerCase() === 'lieferung'
    );
    const fallback = addresses.find((addr) => addr.customer_id === customerId);
    const addr = delivery || fallback || {};
    return {
      company: customer.name || order?.customer_name || '-',
      street: addr.street || '',
      city: addr.zip && addr.city ? `${addr.zip} ${addr.city}` : addr.city || '',
      country: addr.country || ''
    };
  }

  function getCustomerAddress(customerId, role = 'rechnung') {
    const addresses = Array.isArray(state.addresses) ? state.addresses : [];
    const normalized = role ? role.toLowerCase() : null;
    const match = addresses.find((addr) => addr.customer_id === customerId && (!normalized || (addr.type || '').toLowerCase() === normalized));
    if (!match) return null;
    return {
      street: match.street || '',
      city: match.zip && match.city ? `${match.zip} ${match.city}` : match.city || '',
      country: match.country || ''
    };
  }

  function getAddressById(addressId) {
    if (!addressId) return null;
    const addresses = Array.isArray(state.addresses) ? state.addresses : [];
    return addresses.find((addr) => addr.id === addressId || addr.name === addressId) || null;
  }

  function normalizeSnapshotAddress(address) {
    if (!address) return null;
    const street = address.street || address.address_line1 || '';
    const zip = address.zip || address.pincode || '';
    const cityName = address.city || '';
    const city = zip && cityName ? `${zip} ${cityName}` : cityName || zip || '';
    return {
      street,
      city,
      country: address.country || ''
    };
  }

  function normalizeAddressDisplay(display) {
    if (!display) return null;
    const text = display
      .replace(/<br\s*\/?>(\r?\n)?/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\u00a0/g, ' ')
      .trim();
    if (!text) return null;
    const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return null;
    const [street = '', cityLine = '', country = ''] = lines;
    return {
      street,
      city: cityLine,
      country
    };
  }

  async function loadSession() {
    const data = await request('/api/session');
    state.user = data.user;
    const label = document.getElementById('userLabelName');
    if (label) {
      const displayName = state.user.username || state.user.email || '-';
      label.textContent = displayName;
    }
    if (state.user?.locale && state.user.locale !== state.locale) {
      await changeLocale(state.user.locale, { syncServer: false });
      return;
    }
    applyRoleVisibility();
    updateLanguageSwitcherState();
    bindNotificationUi();
    await refreshNotifications(true);
    scheduleNotificationPolling();
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await request('/api/logout', { method: 'POST' });
        window.location.href = '/login.html';
      });
    }
  }

  function renderAccessoriesPlaceholder(message, containerId = 'accessoriesContent') {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = `<p class="muted">${escapeHtml(message)}</p>`;
  }

  function setAccessoriesSubtitle(customerId, accessories = [], subtitleId = 'accessoriesSubtitle') {
    const subtitle = document.getElementById(subtitleId);
    if (!subtitle) return;
    if (!customerId) {
      subtitle.textContent = translateTemplate('Kundenspezifisches Verpackungsset');
      return;
    }
    const customer = state.customers.find((entry) => entry.id === customerId);
    const label = customer?.name || customerId;
    if (!accessories.length) {
      subtitle.textContent = translateTemplate('{{label}} · noch kein Zubehör hinterlegt', { label });
      return;
    }
    const latest = accessories.reduce((latestDate, entry) => {
      if (!entry.updated_at) return latestDate;
      const ts = new Date(entry.updated_at).getTime();
      if (!latestDate) return ts;
      return ts > latestDate ? ts : latestDate;
    }, null);
    const formatted = latest ? new Date(latest).toLocaleDateString('de-DE') : translateTemplate('aktuell');
    subtitle.textContent = translateTemplate('{{label}} · Stand {{date}}', { label, date: formatted });
  }

  function buildAccessoryCard(slot, entry) {
    const hasEntry = Boolean(entry?.image_url);
    const title = entry?.title || slot.label;
    const description = entry?.description || slot.description || '';
    const statusBadge = hasEntry ? '<span class="badge success">Hinterlegt</span>' : '<span class="badge warning">Fehlt</span>';
    const media = hasEntry
      ? `<img src="${escapeHtml(entry.image_url)}" alt="${escapeHtml(title)}" loading="lazy" />`
      : `<div class="accessory-placeholder" aria-hidden="true"><span>${escapeHtml(slot.label.charAt(0))}</span></div>`;
    const uploadTitle = hasEntry ? 'Bild aktualisieren' : 'Bild hochladen';
    const uploadButton = `<button type="button" class="ghost small icon-btn" data-action="trigger-accessory-upload" data-slot="${slot.key}" aria-label="${uploadTitle}" title="${uploadTitle}">⟳</button>`;
    const linkButton = hasEntry
      ? `<a class="ghost small icon-btn" href="${escapeHtml(entry.image_url)}" target="_blank" rel="noopener" aria-label="Bild anzeigen" title="Bild anzeigen">${EYE_ICON_SVG}</a>`
      : '';
    const removeButton = hasEntry
      ? `<button type="button" class="ghost small icon-btn danger" data-action="remove-accessory" data-slot="${slot.key}" aria-label="Bild entfernen" title="Bild entfernen">${TRASH_ICON_SVG}</button>`
      : '';
    return `
      <div class="accessory-item ${hasEntry ? '' : 'accessory-empty'}" data-slot="${slot.key}">
        ${media}
        <div class="accessory-body">
          <div class="accessory-meta">
            <p class="label">${escapeHtml(slot.label)}</p>
            ${statusBadge}
          </div>
          <h5 class="accessory-title">${escapeHtml(title)}</h5>
          <p class="muted">${escapeHtml(description)}</p>
          <div class="accessory-actions">
            ${uploadButton}
            ${linkButton}
            ${removeButton}
          </div>
        </div>
        <input type="file" accept="image/*" class="accessory-file-input" data-slot="${slot.key}" hidden />
      </div>`;
  }

  function bindAccessoryUploadControls(customerId, containerId = 'accessoriesContent', subtitleId = 'accessoriesSubtitle') {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('button[data-action="trigger-accessory-upload"]').forEach((button) => {
      button.addEventListener('click', () => {
        const slot = button.dataset.slot;
        const input = container.querySelector(`input.accessory-file-input[data-slot="${slot}"]`);
        if (input) input.click();
      });
    });
    container.querySelectorAll('input.accessory-file-input').forEach((input) => {
      input.addEventListener('change', (event) => {
        const slot = event.target.dataset.slot;
        const file = event.target.files?.[0];
        if (file) {
          handleAccessoryUpload(customerId, slot, file, { containerId, subtitleId });
        }
        event.target.value = '';
      });
    });
    container.querySelectorAll('button[data-action="remove-accessory"]').forEach((button) => {
      button.addEventListener('click', () => {
        const slot = button.dataset.slot;
        if (!slot) return;
        const confirmDelete = window.confirm('Bild wirklich entfernen?');
        if (!confirmDelete) return;
        deleteAccessory(customerId, slot, { containerId, subtitleId });
      });
    });
  }

  function renderAccessorySection(customerId, accessories = [], options = {}) {
    const { containerId = 'accessoriesContent', subtitleId = 'accessoriesSubtitle' } = options;
    const container = document.getElementById(containerId);
    if (!container) return;
    const rows = ACCESSORY_SLOTS.map((slot) => {
      const entry = accessories.find((item) => item.slot === slot.key);
      return buildAccessoryCard(slot, entry);
    }).join('');
    container.innerHTML = `<div class="accessories-grid">${rows}</div>`;
    setAccessoriesSubtitle(customerId, accessories, subtitleId);
    bindAccessoryUploadControls(customerId, containerId, subtitleId);
  }

  function setAccessoryUploadState(slotKey, isUploading, containerId = 'accessoriesContent') {
    const container = document.getElementById(containerId);
    if (!container) return;
    const card = container.querySelector(`.accessory-item[data-slot="${slotKey}"]`);
    if (!card) return;
    card.classList.toggle('accessory-uploading', isUploading);
    const button = card.querySelector('button[data-action="trigger-accessory-upload"]');
    if (button) {
      if (isUploading) {
        if (!button.dataset.originalLabel) {
          button.dataset.originalLabel = button.textContent;
        }
        button.textContent = 'Upload läuft ...';
      } else if (button.dataset.originalLabel) {
        button.textContent = button.dataset.originalLabel;
        delete button.dataset.originalLabel;
      }
      button.disabled = isUploading;
    }
  }

  async function handleAccessoryUpload(customerId, slotKey, file, { containerId = 'accessoriesContent', subtitleId = 'accessoriesSubtitle' } = {}) {
    if (!customerId || !slotKey || !file) return;
    setAccessoryUploadState(slotKey, true, containerId);
    try {
      const form = new FormData();
      form.append('slot', slotKey);
      form.append('file', file);
      const response = await request(`/api/customers/${encodeURIComponent(customerId)}/accessories`, {
        method: 'POST',
        body: form
      });
      const accessories = response?.accessories || [];
      state.customerAccessories[customerId] = accessories;
      renderAccessorySection(customerId, accessories, { containerId, subtitleId });
      showToast('Zubehör aktualisiert.');
    } catch (err) {
      showToast(err.message);
    } finally {
      setAccessoryUploadState(slotKey, false, containerId);
    }
  }

  async function deleteAccessory(customerId, slotKey, { containerId = 'accessoriesContent', subtitleId = 'accessoriesSubtitle' } = {}) {
    if (!customerId || !slotKey) return;
    try {
      const response = await request(`/api/customers/${encodeURIComponent(customerId)}/accessories/${encodeURIComponent(slotKey)}`, {
        method: 'DELETE'
      });
      const accessories = response?.accessories || [];
      state.customerAccessories[customerId] = accessories;
      renderAccessorySection(customerId, accessories, { containerId, subtitleId });
      showToast('Zubehör entfernt.');
    } catch (err) {
      showToast(err.message);
    }
  }

  async function refreshCustomerAccessories(customerId, { force = false, containerId = 'accessoriesContent', subtitleId = 'accessoriesSubtitle' } = {}) {
    if (!customerId) {
      renderAccessoriesPlaceholder('Keine Kundennummer hinterlegt.', containerId);
      setAccessoriesSubtitle(null, [], subtitleId);
      return [];
    }
    if (state.customerAccessories[customerId] && !force) {
      renderAccessorySection(customerId, state.customerAccessories[customerId], { containerId, subtitleId });
      return state.customerAccessories[customerId];
    }
    renderAccessoriesPlaceholder('Zubehör wird geladen ...', containerId);
    try {
      const payload = await request(`/api/customers/${encodeURIComponent(customerId)}/accessories`);
      const accessories = payload?.accessories || [];
      state.customerAccessories[customerId] = accessories;
      renderAccessorySection(customerId, accessories, { containerId, subtitleId });
      return accessories;
    } catch (err) {
      renderAccessoriesPlaceholder(err.message || 'Zubehör konnte nicht geladen werden.', containerId);
      setAccessoriesSubtitle(customerId, [], subtitleId);
      throw err;
    }
  }

  function ensureCustomerOrderProfileDrafts(customerId) {
    if (!customerId) return {};
    if (!state.customerOrderProfileDrafts[customerId]) {
      state.customerOrderProfileDrafts[customerId] = {};
    }
    CUSTOMER_ORDER_PROFILE_TYPES.forEach((type) => {
      if (!Array.isArray(state.customerOrderProfileDrafts[customerId][type])) {
        state.customerOrderProfileDrafts[customerId][type] = [];
      }
    });
    if (!state.customerOrderProfiles[customerId]) {
      state.customerOrderProfiles[customerId] = {};
    }
    if (typeof state.customerOrderProfileEditing[customerId] !== 'boolean') {
      state.customerOrderProfileEditing[customerId] = false;
    }
    return state.customerOrderProfileDrafts[customerId];
  }

  function resetCustomerOrderProfileDrafts(customerId, types = null) {
    if (!customerId) return;
    const profileMap = state.customerOrderProfiles?.[customerId] || {};
    const targetTypes = Array.isArray(types) && types.length ? types : CUSTOMER_ORDER_PROFILE_TYPES;
    ensureCustomerOrderProfileDrafts(customerId);
    targetTypes.forEach((type) => {
      const rows = Array.isArray(profileMap?.[type]?.sizes) ? profileMap[type].sizes : [];
      state.customerOrderProfileDrafts[customerId][type] = cloneOrderProfileRows(rows, type);
    });
  }

  function isCustomerOrderProfileEditing(customerId) {
    return Boolean(state.customerOrderProfileEditing?.[customerId]);
  }

  function setCustomerOrderProfileEditing(customerId, value) {
    if (!customerId) return;
    state.customerOrderProfileEditing[customerId] = Boolean(value);
  }

  function cloneOrderProfileRows(rows = [], orderType = 'SMS') {
    const timestamp = Date.now().toString(36);
    return rows.map((row, idx) => ({
      id: row.id || `${orderType}-${idx}-${timestamp}-${Math.random().toString(16).slice(2, 6)}`,
      size: row.size || '',
      quantity: Math.max(0, Math.floor(Number(row.quantity) || 0))
    }));
  }

  function sumOrderProfileRows(rows = []) {
    return rows.reduce((acc, row) => acc + Math.max(0, Math.floor(Number(row?.quantity) || 0)), 0);
  }

  function generateOrderProfileRowId(orderType) {
    return `${orderType}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
  }

  function toggleCustomerOrderProfileEditing(customerId) {
    if (!customerId) return;
    ensureCustomerOrderProfileDrafts(customerId);
    const currentlyEditing = isCustomerOrderProfileEditing(customerId);
    if (currentlyEditing) {
      resetCustomerOrderProfileDrafts(customerId);
    }
    setCustomerOrderProfileEditing(customerId, !currentlyEditing);
    renderCustomerOrderProfiles(customerId);
  }

  async function refreshCustomerOrderProfiles(customerId) {
    if (!customerId) return null;
    const container = document.getElementById('customerOrderProfiles');
    if (!container) return null;
    container.innerHTML = `<p class="muted">${escapeHtml(translateTemplate('Lade Daten …'))}</p>`;
    try {
      const payload = await request(`/api/customers/${encodeURIComponent(customerId)}/order-profiles`);
      const profiles = payload?.profiles || {};
      state.customerOrderProfiles[customerId] = profiles;
      ensureCustomerOrderProfileDrafts(customerId);
      resetCustomerOrderProfileDrafts(customerId);
      setCustomerOrderProfileEditing(customerId, false);
      renderCustomerOrderProfiles(customerId);
      return profiles;
    } catch (err) {
      console.warn('Order profile fetch failed', err);
      container.innerHTML = `<p class="error">${escapeHtml(err.message || translateTemplate('Daten konnten nicht geladen werden.'))}</p>`;
      showToast(err.message);
      throw err;
    }
  }

  function renderCustomerOrderProfiles(customerId) {
    const container = document.getElementById('customerOrderProfiles');
    if (!container || !customerId) return;
    const drafts = state.customerOrderProfileDrafts?.[customerId];
    const t = (key, replacements) => translateTemplate(key, replacements);
    const editing = isCustomerOrderProfileEditing(customerId);
    const toggleBtn = document.querySelector('[data-action="toggle-order-profile-edit"]');
    if (toggleBtn) {
      toggleBtn.dataset.customerId = customerId;
      const label = editing ? t('Bearbeitung beenden') : t('Bearbeiten');
      toggleBtn.textContent = label;
      toggleBtn.disabled = !state.customerOrderProfiles[customerId];
      if (toggleBtn.dataset.bound !== '1') {
        toggleBtn.addEventListener('click', () => {
          const targetCustomerId = toggleBtn.dataset.customerId;
          toggleCustomerOrderProfileEditing(targetCustomerId);
        });
        toggleBtn.dataset.bound = '1';
      }
    }
    if (!drafts) {
      container.innerHTML = `<p class="muted">${escapeHtml(t('Keine Daten geladen.'))}</p>`;
      return;
    }
    const profileTypes = CUSTOMER_ORDER_PROFILE_TYPES;
    container.innerHTML = profileTypes
      .map((type) => buildCustomerOrderProfileCard(customerId, type, drafts[type] || [], t, editing))
      .join('');
    if (editing) {
      profileTypes.forEach((type) => bindCustomerOrderProfileCard(customerId, type));
    }
  }

  function buildCustomerOrderProfileCard(customerId, orderType, rows = [], t = (key) => key, isEditing = false) {
    const total = sumOrderProfileRows(rows);
    const sizePlaceholder = t('Größe');
    const qtyPlaceholder = t('Menge');
    const addLabel = t('Zeile hinzufügen');
    const saveLabel = t('Speichern');
    const removeLabel = t('Größe entfernen');
    const emptyColumns = isEditing ? 3 : 2;
    const noData = `<tr><td colspan="${emptyColumns}" class="muted">${escapeHtml(t('Keine Größen hinterlegt.'))}</td></tr>`;
    const rowsHtml = rows.length
      ? rows
          .map((row) => {
            const sizeValue = escapeHtml(row.size || '');
            const quantityRaw = row.quantity;
            const quantityInputValue =
              quantityRaw === null || quantityRaw === undefined ? '' : Number.isFinite(quantityRaw) ? quantityRaw : quantityRaw;
            const quantityDisplay =
              quantityRaw === null || quantityRaw === undefined || quantityRaw === '' ? 0 : quantityRaw;
            if (!isEditing) {
              return `<tr data-row-id="${row.id}">
                <td>${sizeValue || '-'}</td>
                <td>${escapeHtml(quantityDisplay.toString())}</td>
              </tr>`;
            }
            return `
        <tr data-row-id="${row.id}">
          <td>
            <input
              type="text"
              class="order-profile-size-input"
              data-row-id="${row.id}"
              value="${escapeHtml(row.size || '')}"
              list="customerOrderProfileSizeOptions"
              placeholder="${escapeHtml(sizePlaceholder)}"
            />
          </td>
          <td>
            <input
              type="number"
              min="0"
              class="order-profile-quantity-input"
              data-row-id="${row.id}"
              value="${escapeHtml(quantityInputValue.toString())}"
              placeholder="${escapeHtml(qtyPlaceholder)}"
            />
          </td>
          <td class="order-profile-remove-cell">
            <button
              type="button"
              class="ghost icon-only order-profile-remove"
              data-remove-row="${row.id}"
              aria-label="${escapeHtml(removeLabel)}"
              title="${escapeHtml(removeLabel)}"
            >
              ${TRASH_ICON_SVG}
            </button>
          </td>
        </tr>`;
          })
          .join('')
      : noData;
    const totalLabel = t('Summe: {{count}} Paar', { count: total });
    const actionColumnHeader = isEditing ? '<th></th>' : '';
    const actionFooter = isEditing
      ? `<div class="order-profile-actions">
          <button type="button" class="ghost small" data-action="add-order-profile-row">${escapeHtml(addLabel)}</button>
          <span class="order-profile-total" data-profile-total>${escapeHtml(totalLabel)}</span>
          <button type="button" class="primary small" data-action="save-order-profile">${escapeHtml(saveLabel)}</button>
        </div>`
      : `<div class="order-profile-footer">
          <span class="order-profile-total">${escapeHtml(totalLabel)}</span>
        </div>`;
    const cardModeClass = isEditing ? 'editing' : 'readonly';
    return `
      <article class="order-profile-card ${cardModeClass}" data-order-type="${orderType}">
        <header class="order-profile-card-head">
          <div>
            <p class="muted">${escapeHtml(orderType)}</p>
            <h5>${escapeHtml(t('Standardgrößen {{type}}', { type: orderType }))}</h5>
          </div>
        </header>
        <table class="order-profile-table">
          <thead>
            <tr>
              <th>${escapeHtml(sizePlaceholder)}</th>
              <th>${escapeHtml(qtyPlaceholder)}</th>
              ${actionColumnHeader}
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
        ${actionFooter}
      </article>
    `;
  }

  function bindCustomerOrderProfileCard(customerId, orderType) {
    const card = document.querySelector(`.order-profile-card[data-order-type="${orderType}"]`);
    if (!card) return;
    const addBtn = card.querySelector('[data-action="add-order-profile-row"]');
    if (addBtn) {
      addBtn.addEventListener('click', () => addOrderProfileRow(customerId, orderType));
    }
    const saveBtn = card.querySelector('[data-action="save-order-profile"]');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => saveCustomerOrderProfile(customerId, orderType));
    }
    card.querySelectorAll('.order-profile-size-input').forEach((input) => {
      input.addEventListener('input', (event) =>
        handleOrderProfileInputChange(customerId, orderType, input.dataset.rowId, 'size', event.target.value)
      );
    });
    card.querySelectorAll('.order-profile-quantity-input').forEach((input) => {
      input.addEventListener('input', (event) =>
        handleOrderProfileInputChange(customerId, orderType, input.dataset.rowId, 'quantity', event.target.value)
      );
      input.addEventListener('blur', (event) =>
        normalizeOrderProfileQuantityInput(customerId, orderType, input.dataset.rowId, event.target)
      );
    });
    card.querySelectorAll('[data-remove-row]').forEach((button) => {
      button.addEventListener('click', () => removeOrderProfileRow(customerId, orderType, button.dataset.removeRow));
    });
  }

  function handleOrderProfileInputChange(customerId, orderType, rowId, field, value) {
    const drafts = state.customerOrderProfileDrafts?.[customerId];
    if (!drafts || !drafts[orderType]) return;
    const row = drafts[orderType].find((entry) => entry.id === rowId);
    if (!row) return;
    if (field === 'size') {
      row.size = value?.toString().trim();
    } else if (field === 'quantity') {
      const numeric = Math.max(0, Math.floor(Number(value) || 0));
      row.quantity = numeric;
      updateOrderProfileTotalBadge(customerId, orderType);
    }
  }

  function normalizeOrderProfileQuantityInput(customerId, orderType, rowId, inputEl) {
    if (!inputEl) return;
    const drafts = state.customerOrderProfileDrafts?.[customerId];
    if (!drafts || !drafts[orderType]) return;
    const row = drafts[orderType].find((entry) => entry.id === rowId);
    if (!row) return;
    inputEl.value = row.quantity ? String(row.quantity) : '';
  }

  function updateOrderProfileTotalBadge(customerId, orderType) {
    const card = document.querySelector(`.order-profile-card[data-order-type="${orderType}"]`);
    if (!card) return;
    const rows = state.customerOrderProfileDrafts?.[customerId]?.[orderType] || [];
    const total = sumOrderProfileRows(rows);
    const label = translateTemplate('Summe: {{count}} Paar', { count: total });
    const target = card.querySelector('[data-profile-total]');
    if (target) {
      target.textContent = label;
    }
  }

  function addOrderProfileRow(customerId, orderType) {
    ensureCustomerOrderProfileDrafts(customerId);
    state.customerOrderProfileDrafts[customerId][orderType].push({
      id: generateOrderProfileRowId(orderType),
      size: '',
      quantity: 0
    });
    renderCustomerOrderProfiles(customerId);
  }

  function removeOrderProfileRow(customerId, orderType, rowId) {
    if (!rowId) return;
    ensureCustomerOrderProfileDrafts(customerId);
    const rows = state.customerOrderProfileDrafts[customerId][orderType];
    const idx = rows.findIndex((row) => row.id === rowId);
    if (idx === -1) return;
    rows.splice(idx, 1);
    renderCustomerOrderProfiles(customerId);
  }

  async function saveCustomerOrderProfile(customerId, orderType) {
    if (!customerId || !orderType) return;
    ensureCustomerOrderProfileDrafts(customerId);
    const rows = state.customerOrderProfileDrafts[customerId][orderType];
    const payload = rows
      .map((row) => ({
        size: row.size?.toString().trim(),
        quantity: Math.max(0, Math.floor(Number(row.quantity) || 0))
      }))
      .filter((row) => row.size);
    try {
      const encodedType = encodeURIComponent(orderType);
      const response = await request(
        `/api/customers/${encodeURIComponent(customerId)}/order-profiles/${encodedType}`,
        {
          method: 'POST',
          body: { sizes: payload }
        }
      );
      state.customerOrderProfiles[customerId] = state.customerOrderProfiles[customerId] || {};
      state.customerOrderProfiles[customerId][orderType] = response;
      state.customerOrderProfileDrafts[customerId][orderType] = cloneOrderProfileRows(response?.sizes || [], orderType);
      renderCustomerOrderProfiles(customerId);
      showToast(translateTemplate('Profil gespeichert'));
    } catch (err) {
      showToast(err.message);
    }
  }

  async function initDashboard() {
    const refreshBtn = document.querySelector('[data-action="refresh-orders"]');

    async function loadDashboard(forceSync = false) {
      const setKpiValue = (id, value) => {
        const target = document.getElementById(id);
        if (target) target.textContent = value;
      };
      const [, orders, tickets] = await Promise.all([
        ensureFreshSnapshot(forceSync),
        request('/api/orders'),
        request('/api/tickets')
      ]);
      state.orders = orders;
      state.tickets = tickets;
      await localizeTicketTitlesForSupplier(tickets);

      const productionTable = document.getElementById('productionTable');
      const pendingOrders = orders.filter((order) => order.portal_status === 'ORDER_EINGEREICHT');
      setKpiValue('kpiNewOrders', pendingOrders.length);
      const sortedPending = [...pendingOrders].sort(
        (a, b) => new Date(b.creation || b.modified || b.requested_delivery || b.transaction_date || 0) -
          new Date(a.creation || a.modified || a.requested_delivery || a.transaction_date || 0)
      );
      const limitedOrders = sortedPending.slice(0, 5);
      productionTable.innerHTML = limitedOrders.length
        ? limitedOrders
            .map(
              (order) => `
            <tr data-order-id="${order.id}">
              <td>${order.order_number}</td>
              <td><span class="badge">${formatStatus(order.portal_status)}</span></td>
              <td>${order.customer_name || order.customer_id}</td>
              <td>${getOrderTypeBadgeHtml(order.order_type)}</td>
              <td>${formatDate(order.requested_delivery)}</td>
            </tr>`
            )
            .join('')
        : '<tr><td colspan="5" class="muted">Keine eingereichten Bestellungen.</td></tr>';
      productionTable.querySelectorAll('tr').forEach((row) => {
        const orderId = row.dataset.orderId;
        if (!orderId) return;
        row.addEventListener('click', () => {
          window.location.href = `/bestellung.html?order=${encodeURIComponent(orderId)}`;
        });
      });

      const dashboardOrderTickets = document.getElementById('dashboardOrderTickets');
      const dashboardTechpackTickets = document.getElementById('dashboardTechpackTickets');
      const openTickets = tickets.filter((ticket) => ticket.status !== 'CLOSED');
      const orderTickets = openTickets.filter((ticket) => !ticket.position_id);
      const techpackTickets = openTickets.filter((ticket) => ticket.position_id);
      setKpiValue('kpiOrderTickets', orderTickets.length);
      setKpiValue('kpiTechpackTickets', techpackTickets.length);
      renderOpenTicketList(dashboardOrderTickets, orderTickets, 'Keine offenen Bestelltickets');
      renderOpenTicketList(dashboardTechpackTickets, techpackTickets, 'Keine offenen Techpack-Tickets');

      const specList = document.getElementById('specList');
      if (specList) {
        specList.innerHTML = orders
          .flatMap((order) =>
            order.positions.map(
              (pos) => `
              <li>
                <strong>${pos.position_id}</strong> · ${order.order_number}<br />
                <small>Status: ${formatStatus(pos.portal_status)}</small>
              </li>`
            )
          )
          .slice(0, 5)
          .join('');
        if (!specList.innerHTML) {
          specList.innerHTML = '<li>Keine Positionen</li>';
        }
      }
    }

    await loadDashboard(false);

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => loadDashboard(true));
    }
  }

  async function initBestellungen() {
    const filters = document.getElementById('orderFilters');
    if (!filters) return;
    const table = document.getElementById('orderTable');
    let filterDebounce;
    const COMPLETED_STATUS = 'UEBERGEBEN_AN_SPEDITION';

    const loadOrders = async () => {
      const data = new FormData(filters);
      const params = new URLSearchParams();
      const statusFilter = data.get('status') || '';
      for (const [key, value] of data.entries()) {
        if (value) params.append(key, value);
      }
      const query = params.toString();
      const orders = await request(`/api/erp/orders${query ? `?${query}` : ''}`);
      const filteredOrders = statusFilter
        ? orders
        : orders.filter((order) => order.portal_status !== COMPLETED_STATUS);
      renderOrderTable(filteredOrders);
    };

    const scheduleFilterReload = () => {
      clearTimeout(filterDebounce);
      filterDebounce = setTimeout(loadOrders, 250);
    };

    const renderOrderTable = (orders) => {
      const sorted = [...orders].sort((a, b) => {
        const dateA =
          new Date(a.creation || a.modified || a.transaction_date || a.requested_delivery || 0).getTime() || 0;
        const dateB =
          new Date(b.creation || b.modified || b.transaction_date || b.requested_delivery || 0).getTime() || 0;
        return dateB - dateA;
      });
      table.innerHTML = sorted
        .map(
          (order) => {
            const totalQuantity = deriveOrderQuantity(order);
            return `
        <tr data-order-id="${order.id}">
          <td>${order.order_number}</td>
          <td><span class="badge">${formatStatus(order.portal_status)}</span></td>
          <td>${order.customer_name || order.customer_id}</td>
          <td>${getOrderTypeBadgeHtml(order.order_type)}</td>
          <td>${formatDate(order.requested_delivery)}</td>
          <td>${totalQuantity}</td>
        </tr>`;
          }
        )
        .join('');
      table.querySelectorAll('tr').forEach((row) => {
        row.addEventListener('click', () => {
          window.location.href = `/bestellung.html?order=${encodeURIComponent(row.dataset.orderId)}`;
        });
      });
    };

    filters.addEventListener('submit', (event) => {
      event.preventDefault();
      loadOrders();
    });
    filters.querySelectorAll('input, select').forEach((element) => {
      element.addEventListener('input', scheduleFilterReload);
      element.addEventListener('change', scheduleFilterReload);
    });
    const refreshButton = document.querySelector('[data-action="poll-orders"]');
    if (refreshButton) {
      refreshButton.addEventListener('click', loadOrders);
    }
    await loadOrders();
  }

  function deriveOrderTotal(order) {
    if (typeof order?.total_amount === 'number') return order.total_amount;
    if (typeof order?.total === 'number') return order.total;
    if (Array.isArray(order?.positions)) {
      let sum = order.positions.reduce((acc, pos) => {
        const line = Number(pos.amount || pos.total || 0);
        if (line) return acc + line;
        return acc;
      }, 0);
      if (!sum && Array.isArray(state.erpItems)) {
        sum = order.positions.reduce((acc, pos) => {
          const item = state.erpItems.find((entry) => entry.item_code === pos.item_code);
          const unit = item?.prices?.[0]?.amount || 0;
          return acc + unit * (pos.quantity || 0);
        }, 0);
      }
      return sum || null;
    }
    return null;
  }

  function deriveOrderQuantity(order) {
    if (!order) return 0;
    if (typeof order.total_qty === 'number' && Number.isFinite(order.total_qty)) {
      return order.total_qty;
    }
    if (Array.isArray(order.positions)) {
      return order.positions.reduce((sum, pos) => {
        const qty = Number(pos.quantity);
        return sum + (Number.isFinite(qty) ? qty : 0);
      }, 0);
    }
    return 0;
  }

  function buildEmptyOrderDraft() {
    return {
      order_number: '',
      order_type: '',
      requested_delivery: '',
      portal_status: 'ORDER_EINGEREICHT',
      customer_id: '',
      customer_number: '',
      billing_address_id: '',
      shipping_address_id: '',
      dispatch_address_id: '',
      supplier_id: '',
      supplier_name: '',
      naming_series: ORDER_SERIES_OPTIONS[0] || '',
      company: COMPANY_OPTIONS[0] || '',
      contact_id: '',
      contact_name: '',
      contact_email: '',
      contact_phone: '',
      shipping_payer: 'BATE',
      shipping_method: 'Spedition',
      shipping_packaging: '',
      shipping_pickup: false,
      shipping_notes: '',
      tax_template: '',
      currency: 'EUR',
      positions: []
    };
  }

function isEditingExistingOrder() {
  return Boolean(state.orderDraftEditingId);
}

function ensureOrderDraft() {
  if (!state.orderDraft) {
    state.orderDraft = buildEmptyOrderDraft();
  }
  return state.orderDraft;
  }

  function loadOrderDraftFromStorage() {
    try {
      const raw = localStorage.getItem(ORDER_DRAFT_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return {
        ...buildEmptyOrderDraft(),
        ...parsed,
        positions: Array.isArray(parsed.positions) ? parsed.positions : []
      };
    } catch (err) {
      console.warn('Draft konnte nicht geladen werden', err);
      return null;
    }
  }

function scheduleDraftPersist() {
  if (isEditingExistingOrder()) return;
  clearTimeout(state.orderDraftSaveTimeout);
  state.orderDraftSaveTimeout = setTimeout(() => {
    try {
      const payload = JSON.stringify(state.orderDraft || buildEmptyOrderDraft());
      localStorage.setItem(ORDER_DRAFT_STORAGE_KEY, payload);
      } catch (err) {
        console.warn('Draft konnte nicht gespeichert werden', err);
      }
    }, 150);
}

function persistDraftImmediately() {
  if (isEditingExistingOrder()) return;
  clearTimeout(state.orderDraftSaveTimeout);
  try {
    const payload = JSON.stringify(state.orderDraft || buildEmptyOrderDraft());
    localStorage.setItem(ORDER_DRAFT_STORAGE_KEY, payload);
  } catch (err) {
      console.warn('Draft konnte nicht gespeichert werden', err);
    }
  }

  function clearOrderDraftStorage() {
    clearTimeout(state.orderDraftSaveTimeout);
    try {
      localStorage.removeItem(ORDER_DRAFT_STORAGE_KEY);
    } catch (err) {
      console.warn('Draft konnte nicht entfernt werden', err);
    }
    state.orderDraft = buildEmptyOrderDraft();
  }

  function calculateDraftTotals(positions = []) {
    const net = positions.reduce((acc, pos) => {
      const quantity = Number(pos.quantity) || 0;
      const rate = Number(pos.rate) || 0;
      if (typeof pos.amount === 'number') {
        return acc + (Number(pos.amount) || 0);
      }
      return acc + quantity * rate;
    }, 0);
    const tax = net * VAT_RATE;
    const gross = net + tax;
    return { net, tax, gross };
  }

  function updateDraftTotalsOutputs(currency = 'EUR') {
    const draft = ensureOrderDraft();
    const totals = calculateDraftTotals(draft.positions);
    const orderTotalOutput = document.getElementById('orderTotalOutput');
    if (orderTotalOutput) orderTotalOutput.textContent = formatMoney(totals.net, currency);
    const netOutput = document.getElementById('netAmountOutput');
    if (netOutput) netOutput.textContent = formatMoney(totals.net, currency);
    const taxOutput = document.getElementById('taxAmountOutput');
    if (taxOutput) taxOutput.textContent = formatMoney(totals.tax, currency);
    const grossOutput = document.getElementById('grossAmountOutput');
    if (grossOutput) grossOutput.textContent = formatMoney(totals.gross, currency);
  }

  function updateOrderTypeBadgeDisplay(orderType) {
    const badge = document.getElementById('orderTypeBadge');
    if (!badge) return;
    const meta = resolveOrderTypeMeta(orderType);
    badge.textContent = meta.label;
    badge.className = `badge order-type-badge ${meta.badgeClass}`;
  }

  function setInputValue(id, value) {
    const node = document.getElementById(id);
    if (!node) return;
    if (node.type === 'checkbox') {
      node.checked = Boolean(value);
      return;
    }
    node.value = value ?? '';
  }

  function formatAddressLabel(address) {
    if (!address) return '-';
    const title = address.address_title || address.company || address.customer_name || address.customer_id || '';
    const street = address.street || address.address_line1 || '';
    const city = address.zip && address.city ? `${address.zip} ${address.city}` : address.city || address.zip || '';
    const country = address.country || '';
    return [title, street, city, country].filter(Boolean).join(' · ');
  }

  function populateSelectOptions(select, options = [], placeholder = 'Bitte wählen', selectedValue = undefined) {
    if (!select) return;
    const current = select.value;
    select.innerHTML = '';
    if (placeholder) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = placeholder;
      select.appendChild(option);
    }
    options.forEach((entry) => {
      const option = document.createElement('option');
      option.value = entry.value;
      option.textContent = entry.label;
      select.appendChild(option);
    });
    const targetValue = selectedValue !== undefined ? selectedValue : current;
    const hasMatch = options.some((entry) => entry.value === targetValue);
    select.value = hasMatch ? targetValue : '';
  }

  function renderAddressPreview(prefix, address) {
    setText(`${prefix}StreetPreview`, address?.street || '-');
    setText(`${prefix}CityPreview`, address?.city || '-');
    setText(`${prefix}CountryPreview`, address?.country || '');
  }

  function getCustomerNumber(customer) {
    if (!customer) return '';
    return (
      customer.customer_number ||
      customer.customer_code ||
      customer.tax_id ||
      customer.id ||
      ''
    );
  }

  function getCustomerPrimaryContact(customerId) {
    const contacts = getContactsForCustomer(customerId);
    if (!contacts.length) return null;
    const preferred = contacts.find((contact) => contact.is_primary_contact);
    return preferred || contacts[0];
  }

  function resolveDefaultCustomerRelations(customerId) {
    const addresses = getAddressesForCustomer(customerId);
    const normalize = (value) => (value || '').toLowerCase();
    const billing =
      addresses.find((addr) => normalize(addr.type) === 'rechnung') ||
      addresses.find((addr) => addr.is_primary_address) ||
      addresses[0] ||
      null;
    const shipping =
      addresses.find((addr) => normalize(addr.type) === 'lieferung') ||
      addresses.find((addr) => addr.is_shipping_address) ||
      addresses.find((addr) => normalize(addr.type) === 'rechnung') ||
      addresses[1] ||
      billing ||
      null;
    const contact = getCustomerPrimaryContact(customerId);
    return {
      billingAddressId: billing?.id || billing?.name || null,
      shippingAddressId: shipping?.id || shipping?.name || null,
      contactId: contact?.id || contact?.name || null
    };
  }

  function listDispatchAddresses() {
    const addresses = Array.isArray(state.addresses) ? state.addresses : [];
    return addresses.filter((address) => {
      if (!address) return false;
      if (address.is_your_company_address) return true;
      if (address.is_dispatch) return true;
      if (!address.customer_id) return true;
      return false;
    });
  }

  function getSupplierMetaFromAddress(address) {
    if (!address) {
      return { id: '', name: '' };
    }
    const id = address.customer_id || address.address_title || address.name || '';
    const name = address.address_title || address.company || id;
    return { id, name };
  }

  function getErpItemByCode(code) {
    if (!code) return null;
    const normalized = code.toString().trim().toLowerCase();
    return (state.erpItems || []).find((item) => {
      const candidates = [item.item_code, item.name, item.item_name].filter(Boolean);
      return candidates.some((value) => value.toString().trim().toLowerCase() === normalized);
    });
  }

  function resolveItemImage(item) {
    if (!item) return null;
    if (item.media?.hero) return item.media.hero;
    if (item.image) return item.image;
    const viewer =
      item.links?.viewer3d ||
      item.custom_3d_produktlink ||
      item.custom_3d_link ||
      item.viewer3d ||
      '';
    if (viewer) {
      const trimmed = viewer.replace(/\/+$/, '');
      return `${trimmed}/images/0001.webp`;
    }
    if (item.gallery?.length) {
      return item.gallery[0];
    }
    return null;
  }

  function ensureItemCodeSuggestions() {
    let datalist = document.getElementById('itemCodeSuggestions');
    if (!datalist) {
      datalist = document.createElement('datalist');
      datalist.id = 'itemCodeSuggestions';
      document.body.appendChild(datalist);
    }
    const options = (state.erpItems || [])
      .map((item) => {
        const value = item.item_code || item.name;
        if (!value) return '';
        const label = [value, item.item_name || item.description || '']
          .filter(Boolean)
          .join(' · ');
        return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
      })
      .join('');
    datalist.innerHTML = options;
  }

  function resolvePositionPreviewImage(position) {
    if (position?.preview_image) return position.preview_image;
    if (!position?.item_code) return null;
    const item = getErpItemByCode(position.item_code);
    return resolveItemImage(item);
  }

function applyItemAutoFill(position, itemCode) {
  const item = getErpItemByCode(itemCode);
  if (!item) return false;
  let changed = false;
  const description = item.item_name || item.description || position.description;
  if (description && description !== position.description) {
    position.description = description;
    changed = true;
  }
  const priceEntry = Array.isArray(item.prices) ? item.prices[0] : null;
  const priceAmount =
    Number(priceEntry?.amount || priceEntry?.price_list_rate || item.standard_rate || 0) || null;
  if (priceAmount !== null && priceAmount !== position.rate) {
    position.rate = priceAmount;
    changed = true;
  }
  if (item.stock_uom && item.stock_uom !== position.uom) {
    position.uom = item.stock_uom;
    changed = true;
  }
  const resolvedColor =
    item.color_code ||
    item.zusammenstellung ||
    item.custom_farbcodes ||
    item.custom_farbnr ||
    null;
  if (resolvedColor && resolvedColor !== position.color_code) {
    position.color_code = resolvedColor;
    changed = true;
  }
  const viewerImage = resolveItemImage(item);
  if (viewerImage && position.preview_image !== viewerImage) {
    position.preview_image = viewerImage;
    changed = true;
  }
  const itemSizes = item.__parsed_sizes || null;
  let normalizedItemSizes = null;
  if (itemSizes) {
    normalizedItemSizes = Object.keys(itemSizes);
  } else if (Array.isArray(item.sizes) && item.sizes.length) {
    normalizedItemSizes = item.sizes.map((entry) => entry.toString());
  }
  if (normalizedItemSizes && normalizedItemSizes.length) {
    const sortedSizes = sortSizeKeys(normalizedItemSizes);
    const nextBreakdown = {};
    sortedSizes.forEach((size) => {
      nextBreakdown[size] = position.size_breakdown?.[size] ?? '';
    });
    const existingKeys = Object.keys(position.size_breakdown || {});
    const hasSizeChange =
      existingKeys.length !== Object.keys(nextBreakdown).length ||
      existingKeys.some((key) => !(key in nextBreakdown));
    if (hasSizeChange) {
      position.size_breakdown = nextBreakdown;
      syncQuantityFromSizes(position);
      changed = true;
    }
  }
  position.item_name = item.item_name || position.item_name;
  return changed;
}

  function collectSizesFromPosition(position) {
    const sizes = new Set();
    Object.keys(position?.size_breakdown || {}).forEach((size) => {
      const key = size?.toString().trim();
      if (key) sizes.add(key);
    });
    if (sizes.size === 0 && position?.item_code) {
      const item = getErpItemByCode(position.item_code);
      if (item?.__parsed_sizes) {
        Object.keys(item.__parsed_sizes).forEach((size) => sizes.add(size));
      }
    }
    return sizes;
  }

  function getDraftSizeColumns(positions = []) {
    const collected = new Set();
    positions.forEach((pos) => {
      collectSizesFromPosition(pos).forEach((size) => collected.add(size));
    });
    if (!collected.size) {
      SIZE_COLUMNS.forEach((size) => collected.add(size));
    }
    return sortSizeKeys(Array.from(collected));
  }

  function sortSizeKeys(sizeList = []) {
    const cleaned = Array.from(new Set(sizeList.filter(Boolean).map((size) => size.toString().trim())));
    cleaned.sort((a, b) => {
      const numA = Number(a);
      const numB = Number(b);
      if (!Number.isNaN(numA) && !Number.isNaN(numB)) {
        return numA - numB;
      }
      return a.localeCompare(b);
    });
    return cleaned;
  }

  function sumSizeQuantity(breakdown = {}) {
    return Object.values(breakdown).reduce((acc, value) => {
      if (value === '' || value === null || value === undefined) return acc;
      const numeric = Number(value);
      if (Number.isNaN(numeric)) return acc;
      return acc + numeric;
    }, 0);
  }

  function syncQuantityFromSizes(position, card) {
    const total = sumSizeQuantity(position.size_breakdown);
    position.quantity = total;
    if (card) {
      const qtyInput = card.querySelector('input[data-field="quantity"]');
      if (qtyInput) qtyInput.value = total || '';
    }
    return total;
  }

  async function initBestellung() {
    const backButton = document.getElementById('backToList');
    const [orders, customers, addresses, contacts, erpItems, suppliers] = await Promise.all([
      request('/api/orders'),
      request('/api/erp/customers'),
      request('/api/erp/addresses'),
      request('/api/erp/contacts'),
      request('/api/erp/items'),
      request('/api/erp/suppliers')
    ]);
    state.orders = orders;
    state.customers = customers;
    state.addresses = addresses;
    updateSupplierDirectory(addresses, suppliers);
    state.contacts = contacts;
    state.erpItems = erpItems;
    const params = new URLSearchParams(window.location.search);
    state.ticketFocusId = params.get('ticket') || null;
    const requestedOrder = params.get('order');
    const initialOrder = orders.find((order) => order.id === requestedOrder)?.id || orders[0]?.id || '';
    if (initialOrder) {
      loadOrderDetail(initialOrder);
    }
    if (backButton) {
      backButton.addEventListener('click', () => {
        window.location.href = '/bestellungen.html';
      });
    }
  }

function getCustomerById(customerId) {
  if (!customerId) return null;
  return (state.customers || []).find((customer) => customer.id === customerId) || null;
}

function getCompanyConfig(companyValue) {
  if (!COMPANY_CONFIG.length) return null;
  if (!companyValue) return COMPANY_CONFIG[0];
  return COMPANY_CONFIG.find((entry) => entry.value === companyValue) || COMPANY_CONFIG[0];
}

function getContactsForCustomer(customerId) {
  if (!customerId) return [];
  return (state.contacts || []).filter((contact) => contact.customer_id === customerId);
}

function getAddressesForCustomer(customerId) {
  if (!customerId) return [];
  return (state.addresses || []).filter((address) => address.customer_id === customerId);
}

function resolveSupplierLinkFromAddress(address) {
  if (!address) return null;
  if (address.supplier_id) {
    return {
      id: address.supplier_id,
      name: address.supplier_name || address.address_title || address.supplier_id
    };
  }
  if (Array.isArray(address.links)) {
    const supplierLink = address.links.find(
      (link) => (link?.link_doctype || '').toLowerCase() === 'supplier'
    );
    if (supplierLink?.link_name) {
      return {
        id: supplierLink.link_name,
        name: supplierLink.link_title || supplierLink.link_name
      };
    }
  }
  return null;
}

function buildSupplierDirectory(addresses = []) {
  const directory = new Map();
  addresses.forEach((address) => {
    const link = resolveSupplierLinkFromAddress(address);
    if (!link?.id) return;
    const existing = directory.get(link.id) || {
      id: link.id,
      name: link.name || link.id,
      addresses: []
    };
    const cityLine =
      address.zip && address.city ? `${address.zip} ${address.city}` : address.city || address.zip || '';
    const normalizedAddress = {
      id: address.id,
      street: address.street || address.address_line1 || '',
      city: address.city || '',
      zip: address.zip || '',
      country: address.country || '',
      display: address.display || '',
      cityLine
    };
    existing.addresses.push(normalizedAddress);
    const isBetterPrimary =
      !existing.primary ||
      address.is_primary_address ||
      address.is_shipping_address ||
      existing.primary.country === '';
    if (isBetterPrimary) {
      existing.primary = normalizedAddress;
      existing.phone = address.phone || existing.phone || '';
    }
    directory.set(link.id, existing);
  });
  return Array.from(directory.values())
    .map((entry) => ({
      ...entry,
      street: entry.primary?.street || '',
      cityLine: entry.primary?.cityLine || '',
      country: entry.primary?.country || '',
      display: entry.primary?.display || '',
      phone: entry.phone || ''
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
}

function mapApiSuppliersToDirectory(records = []) {
  return records
    .map((supplier) => {
      if (!supplier) return null;
      const id = supplier.id || supplier.name || supplier.supplier_name;
      if (!id) return null;
      const name = supplier.name || supplier.supplier_name || id;
      const street = supplier.street || supplier.address_line1 || '';
      const cityLine =
        supplier.city_line ||
        (supplier.zip && supplier.city ? `${supplier.zip} ${supplier.city}` : supplier.city || supplier.zip || '');
      return {
        id,
        name,
        street,
        cityLine,
        country: supplier.country || '',
        display: supplier.address_display || '',
        phone: supplier.phone || supplier.mobile_no || ''
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
}

function updateSupplierDirectory(addresses = state.addresses, supplierRecords = null) {
  if (Array.isArray(supplierRecords) && supplierRecords.length) {
    state.suppliers = mapApiSuppliersToDirectory(supplierRecords);
    state.supplierSource = 'api';
    return;
  }
  if (state.supplierSource === 'api' && Array.isArray(state.suppliers) && state.suppliers.length) {
    return;
  }
  state.suppliers = buildSupplierDirectory(Array.isArray(addresses) ? addresses : []);
  state.supplierSource = 'addresses';
}

function getSupplierById(supplierId) {
  if (!supplierId) return null;
  const suppliers = Array.isArray(state.suppliers) ? state.suppliers : [];
  return suppliers.find((entry) => entry.id === supplierId) || null;
}

function formatSupplierCityLine(supplier) {
  if (!supplier) return '';
  if (supplier.cityLine) return supplier.cityLine;
  const address = supplier.primary || supplier.addresses?.[0] || null;
  if (!address) return '';
  return address.cityLine || (address.zip && address.city ? `${address.zip} ${address.city}` : address.city || address.zip || '');
}

function formatSupplierOptionLabel(supplier) {
  if (!supplier) return '';
  const parts = [supplier.name, supplier.street, formatSupplierCityLine(supplier), supplier.country].filter(Boolean);
  return parts.join(' · ');
}

  function renderSupplierPreview(supplier) {
    setText('supplierNamePreview', supplier?.name || '-');
    setText('supplierStreetPreview', supplier?.street || '-');
    setText('supplierCityPreview', formatSupplierCityLine(supplier) || '-');
    setText('supplierCountryPreview', supplier?.country || '');
  }

function populateSupplierSelect(draft) {
  const select = document.getElementById('supplierSelect');
  if (!select) return;
  const suppliers = Array.isArray(state.suppliers) ? state.suppliers : [];
  const options = suppliers.map((supplier) => ({
    value: supplier.id,
    label: formatSupplierOptionLabel(supplier)
  }));
  populateSelectOptions(select, options, 'Lieferant auswählen', draft.supplier_id || '');
  select.disabled = !options.length;
}

function buildDraftFromOrder(order) {
  const draft = buildEmptyOrderDraft();
  if (!order) return draft;
  draft.order_number = order.order_number || order.id || '';
  draft.order_type = order.order_type || draft.order_type;
  draft.requested_delivery = order.requested_delivery || '';
  draft.portal_status = order.portal_status || draft.portal_status;
  draft.naming_series = order.naming_series || draft.naming_series;
  draft.company = order.company || draft.company;
  draft.customer_id = order.customer_id || '';
  draft.customer_number =
    order.customer_snapshot?.id || order.customer_id || draft.customer_number;
  draft.billing_address_id = order.billing_address_id || '';
  draft.shipping_address_id = order.shipping_address_id || '';
  draft.dispatch_address_id = order.dispatch_address_id || '';
  draft.supplier_id = order.supplier_id || draft.supplier_id;
  draft.supplier_name = order.supplier_name || draft.supplier_name;
  draft.contact_id = order.contact_id || '';
  draft.contact_name = order.contact?.name || order.contact_name || '';
  draft.contact_email = order.contact?.email || order.contact_email || '';
  draft.contact_phone = order.contact?.phone || order.contact_phone || '';
  const shipping = order.shipping || {};
  draft.shipping_payer = shipping.payer === 'KUNDE' ? 'KUNDE' : 'BATE';
  draft.shipping_method = shipping.method || 'Spedition';
  draft.shipping_packaging = shipping.packaging || '';
  draft.shipping_pickup = Boolean(shipping.pickup);
  draft.tax_template = order.taxes_and_charges || order.tax_template || draft.tax_template;
  draft.currency = order.currency || draft.currency;
  draft.positions = (order.positions || []).map((pos) => ({
    item_code: pos.item_code || '',
    description: pos.description || '',
    color_code: pos.color_code || '',
    quantity: pos.quantity ?? '',
    rate: pos.rate ?? '',
    amount: typeof pos.amount === 'number' ? pos.amount : null,
    size_breakdown: { ...(pos.size_breakdown || {}) },
    schedule_date: pos.schedule_date || order.requested_delivery || ''
  }));
  return draft;
}

function toPreviewAddress(record) {
  if (!record) return null;
  const street = record.street || record.address_line1 || '';
  const zip = record.zip || record.pincode || '';
  const cityName = record.city || '';
    const city = zip && cityName ? `${zip} ${cityName}` : cityName || zip || '';
    return {
      street,
      city,
      country: record.country || ''
    };
  }

function populateOrderCreateSelects(draft) {
    populateSelectOptions(
      document.getElementById('customerSelect'),
      (state.customers || []).map((customer) => ({
        value: customer.id,
        label: customer.name || customer.customer_name || customer.id
      })),
      'Kunde auswählen',
      draft.customer_id || ''
    );
    populateSelectOptions(
      document.getElementById('orderSeriesSelect'),
      ORDER_SERIES_OPTIONS.map((series) => ({ value: series, label: series })),
      'Nummernkreis wählen',
      draft.naming_series || ORDER_SERIES_OPTIONS[0] || ''
    );
    populateSelectOptions(
      document.getElementById('orderCompanySelect'),
      COMPANY_OPTIONS.map((company) => ({ value: company, label: company })),
      'Unternehmen wählen',
      draft.company || COMPANY_OPTIONS[0] || ''
    );
  }

  function populateCustomerDependentSelects(customerId, draft, { autoSelect = false } = {}) {
    const addresses = getAddressesForCustomer(customerId);
    const options = addresses.map((address) => ({
      value: address.id || address.name,
      label: formatAddressLabel(address)
    }));
    populateSelectOptions(
      document.getElementById('billingAddressSelect'),
      options,
      'Rechnungsadresse auswählen',
      draft.billing_address_id || ''
    );
    populateSelectOptions(
      document.getElementById('shippingAddressSelect'),
      options,
      'Lieferadresse auswählen',
      draft.shipping_address_id || ''
    );
    if (autoSelect) {
      if (!draft.billing_address_id && options.length) {
        draft.billing_address_id = options[0].value;
      }
      if (!draft.shipping_address_id && options.length) {
        draft.shipping_address_id = options[0].value;
        renderAddressPreview('delivery', toPreviewAddress(getAddressById(draft.shipping_address_id)));
      }
    }
    populateSelectOptions(
      document.getElementById('contactSelect'),
      getContactsForCustomer(customerId).map((contact) => ({
        value: contact.id || contact.name,
        label: contact.full_name || contact.name || contact.email || 'Kontakt'
      })),
      'Ansprechpartner (optional)',
      draft.contact_id || ''
    );
    let contact = getContactsForCustomer(customerId).find((entry) => entry.id === draft.contact_id);
    if (!contact && autoSelect) {
      contact = getCustomerPrimaryContact(customerId);
      if (contact) {
        draft.contact_id = contact.id || contact.name;
      }
    }
    if (contact) {
      setInputValue('contactNameInput', contact.full_name || contact.name || '');
      setInputValue('contactEmailInput', contact.email || '');
      setInputValue('contactPhoneInput', contact.phone || '');
      draft.contact_name = contact.full_name || contact.name || '';
      draft.contact_email = contact.email || '';
      draft.contact_phone = contact.phone || '';
    }
  }

  function mergeCustomerDetailIntoState(detail) {
    if (!detail) return;
    const { customer, addresses = [], contact = null } = detail;
    if (customer?.id) {
      state.customers = Array.isArray(state.customers) ? state.customers : [];
      const idx = state.customers.findIndex((entry) => entry.id === customer.id);
      if (idx === -1) {
        state.customers.push(customer);
      } else {
        state.customers[idx] = { ...state.customers[idx], ...customer };
      }
    }
    if (Array.isArray(addresses) && addresses.length) {
      state.addresses = Array.isArray(state.addresses) ? state.addresses : [];
      addresses.forEach((address) => {
        if (!address?.id) return;
        const idx = state.addresses.findIndex((entry) => entry.id === address.id);
        if (idx === -1) {
          state.addresses.push(address);
        } else {
          state.addresses[idx] = { ...state.addresses[idx], ...address };
        }
      });
    }
    if (contact?.id) {
      state.contacts = Array.isArray(state.contacts) ? state.contacts : [];
      const idx = state.contacts.findIndex((entry) => entry.id === contact.id);
      if (idx === -1) {
        state.contacts.push(contact);
      } else {
        state.contacts[idx] = { ...state.contacts[idx], ...contact };
      }
    }
  }

  function applyCompanyDefaults(draft, { ensureDispatch = true, force = false } = {}) {
    const config = getCompanyConfig(draft.company);
    if (config) {
      draft.company = config.value;
      if ((force || !draft.supplier_id) && config.supplierId) {
        draft.supplier_id = config.supplierId;
      }
      if ((force || !draft.supplier_name) && config.supplierName) {
        draft.supplier_name = config.supplierName;
      }
      if (ensureDispatch && (force || !draft.dispatch_address_id) && config.dispatchAddressId) {
        draft.dispatch_address_id = config.dispatchAddressId;
      }
      return config;
    }
    return null;
  }

  function ensureDispatchDefaults(draft) {
    if (draft.dispatch_address_id) {
      const existing = getAddressById(draft.dispatch_address_id);
      if (existing) return existing;
    }
    const config = applyCompanyDefaults(draft, { ensureDispatch: true });
    if (config?.dispatchAddressId) {
      const address = getAddressById(config.dispatchAddressId);
      if (address) return address;
    }
    const dispatchAddresses = listDispatchAddresses();
    if (dispatchAddresses.length) {
      const address = dispatchAddresses[0];
      draft.dispatch_address_id = address.id || address.name;
      if (!draft.supplier_id) {
        const supplierMeta = getSupplierMetaFromAddress(address);
        draft.supplier_id = supplierMeta.id;
        draft.supplier_name = supplierMeta.name;
      }
      return address;
    }
    return null;
  }

  function hydrateOrderCreateForm() {
    const draft = ensureOrderDraft();
    const isEditing = isEditingExistingOrder();
    if (!draft.supplier_id && Array.isArray(state.suppliers) && state.suppliers.length) {
      draft.supplier_id = state.suppliers[0].id;
      draft.supplier_name = state.suppliers[0].name;
    }
    populateSupplierSelect(draft);
    populateOrderCreateSelects(draft);
    populateCustomerDependentSelects(draft.customer_id, draft, {
      autoSelect: !draft.billing_address_id || !draft.shipping_address_id
    });
    const customer = getCustomerById(draft.customer_id);
    setInputValue('orderNumberInput', draft.order_number || '');
    setInputValue('orderDeliveryInput', draft.requested_delivery || '');
    setInputValue('orderTypeInput', draft.order_type || '');
    updateOrderTypeBadgeDisplay(draft.order_type || '');
    setInputValue('orderStatusInput', draft.portal_status || 'ORDER_EINGEREICHT');
    setInputValue('orderSeriesSelect', draft.naming_series || ORDER_SERIES_OPTIONS[0] || '');
    setInputValue('orderCompanySelect', draft.company || COMPANY_OPTIONS[0] || '');
    setInputValue('orderSupplierIdInput', draft.supplier_id || '');
    const supplierEntry = getSupplierById(draft.supplier_id);
    if (supplierEntry && !draft.supplier_name) {
      draft.supplier_name = supplierEntry.name;
    }
    setInputValue('orderSupplierNameInput', draft.supplier_name || '');
    renderSupplierPreview(supplierEntry);
    const inferredCustomerNumber = draft.customer_number || getCustomerNumber(customer);
    draft.customer_number = inferredCustomerNumber || '';
    setInputValue('customerNumberInput', inferredCustomerNumber || '');
    setInputValue('contactNameInput', draft.contact_name || '');
    setInputValue('contactEmailInput', draft.contact_email || '');
    setInputValue('contactPhoneInput', draft.contact_phone || '');
    setInputValue('shippingPayerSelect', draft.shipping_payer || 'BATE');
    setInputValue('shippingMethodInput', draft.shipping_method || 'Spedition');
    setInputValue('shippingPackagingInput', draft.shipping_packaging || '');
    setInputValue('shippingPickupInput', Boolean(draft.shipping_pickup));
    setText('customerTaxPreview', customer?.tax_id || draft.customer_tax_id || '-');
    ensureDispatchDefaults(draft);
    const orderNumberInput = document.getElementById('orderNumberInput');
    if (orderNumberInput) {
      orderNumberInput.disabled = isEditing;
    }
    const seriesSelect = document.getElementById('orderSeriesSelect');
    if (seriesSelect) {
      seriesSelect.disabled = isEditing;
    }
    const submitButton = document.getElementById('submitOrderCreate');
    if (submitButton) {
      submitButton.textContent = isEditing ? 'Änderungen speichern' : 'Bestellung speichern';
    }
    renderAddressPreview(
      'delivery',
      toPreviewAddress(getAddressById(draft.shipping_address_id)) || { street: '-', city: '-', country: '' }
    );
  }

  function bindOrderCreateFormEvents() {
    const draft = ensureOrderDraft();
    document.getElementById('orderNumberInput')?.addEventListener('input', (event) => {
      draft.order_number = event.target.value.trim();
      scheduleDraftPersist();
    });
    document.getElementById('orderTypeInput')?.addEventListener('change', (event) => {
      draft.order_type = event.target.value;
      updateOrderTypeBadgeDisplay(event.target.value);
      scheduleDraftPersist();
    });
    document.getElementById('orderSeriesSelect')?.addEventListener('change', (event) => {
      draft.naming_series = event.target.value;
      scheduleDraftPersist();
    });
    document.getElementById('orderCompanySelect')?.addEventListener('change', (event) => {
      draft.company = event.target.value;
      applyCompanyDefaults(draft, { ensureDispatch: true, force: true });
      scheduleDraftPersist();
    });
    document.getElementById('orderDeliveryInput')?.addEventListener('change', (event) => {
      draft.requested_delivery = event.target.value;
      scheduleDraftPersist();
    });
    document.getElementById('orderStatusInput')?.addEventListener('change', (event) => {
      draft.portal_status = event.target.value;
      scheduleDraftPersist();
    });
    document.getElementById('customerNumberInput')?.addEventListener('input', (event) => {
      draft.customer_number = event.target.value;
      scheduleDraftPersist();
    });
    document.getElementById('supplierSelect')?.addEventListener('change', (event) => {
      const supplier = getSupplierById(event.target.value);
      draft.supplier_id = supplier?.id || '';
      draft.supplier_name = supplier?.name || '';
      setInputValue('orderSupplierIdInput', draft.supplier_id || '');
      setInputValue('orderSupplierNameInput', draft.supplier_name || '');
      renderSupplierPreview(supplier);
      scheduleDraftPersist();
    });
    document.getElementById('customerSelect')?.addEventListener('change', (event) => {
      draft.customer_id = event.target.value;
      const customer = getCustomerById(event.target.value);
      const taxId = customer?.tax_id || '-';
      const customerNumber = getCustomerNumber(customer);
      draft.customer_number = customerNumber;
      setInputValue('customerNumberInput', customerNumber);
      setText('customerTaxPreview', taxId);
      populateCustomerDependentSelects(event.target.value, draft, { autoSelect: true });
      scheduleDraftPersist();
    });
    document.getElementById('billingAddressSelect')?.addEventListener('change', (event) => {
      draft.billing_address_id = event.target.value;
      scheduleDraftPersist();
    });
    document.getElementById('shippingAddressSelect')?.addEventListener('change', (event) => {
      draft.shipping_address_id = event.target.value;
      renderAddressPreview('delivery', toPreviewAddress(getAddressById(event.target.value)));
      scheduleDraftPersist();
    });
    document.getElementById('contactSelect')?.addEventListener('change', (event) => {
      draft.contact_id = event.target.value;
      const contact = (state.contacts || []).find((entry) => entry.id === event.target.value);
      if (contact) {
        setInputValue('contactNameInput', contact.full_name || contact.name || '');
        setInputValue('contactEmailInput', contact.email || '');
        setInputValue('contactPhoneInput', contact.phone || '');
        draft.contact_name = contact.full_name || contact.name || '';
        draft.contact_email = contact.email || '';
        draft.contact_phone = contact.phone || '';
      } else if (!event.target.value) {
        draft.contact_name = '';
        draft.contact_email = '';
        draft.contact_phone = '';
        setInputValue('contactNameInput', '');
        setInputValue('contactEmailInput', '');
        setInputValue('contactPhoneInput', '');
      }
      scheduleDraftPersist();
    });
    ['contactNameInput', 'contactEmailInput', 'contactPhoneInput'].forEach((id) => {
      document.getElementById(id)?.addEventListener('input', (event) => {
        draft[event.target.name] = event.target.value;
        scheduleDraftPersist();
      });
    });
    document.getElementById('shippingPayerSelect')?.addEventListener('change', (event) => {
      draft.shipping_payer = event.target.value;
      scheduleDraftPersist();
    });
    document.getElementById('shippingMethodInput')?.addEventListener('input', (event) => {
      draft.shipping_method = event.target.value;
      scheduleDraftPersist();
    });
    document.getElementById('shippingPackagingInput')?.addEventListener('input', (event) => {
      draft.shipping_packaging = event.target.value;
      scheduleDraftPersist();
    });
    document.getElementById('shippingPickupInput')?.addEventListener('change', (event) => {
      draft.shipping_pickup = event.target.checked;
      scheduleDraftPersist();
    });
    document.getElementById('addPositionBtn')?.addEventListener('click', () => {
      const newPosition = {
        position_id: `POS-${(draft.positions?.length || 0) + 1}`,
        item_code: '',
        description: '',
        color_code: '',
        quantity: '',
        rate: '',
        amount: null,
        size_breakdown: {}
      };
      draft.positions = [...(draft.positions || []), newPosition];
      renderPositionsEditor();
      updateDraftTotalsOutputs(draft.currency);
      scheduleDraftPersist();
    });
    document.getElementById('importPositionsBtn')?.addEventListener('click', () => {
      showToast(translateTemplate('Positionsimport wird später ergänzt.'));
    });
    const isEditing = isEditingExistingOrder();
    const cancelButton = document.getElementById('cancelCreateOrder');
    if (cancelButton && !cancelButton.dataset.bound) {
      cancelButton.addEventListener('click', () => {
        if (isEditingExistingOrder() && state.orderDraftEditingId) {
          window.location.href = `/bestellung.html?order=${encodeURIComponent(state.orderDraftEditingId)}`;
        } else {
          window.location.href = '/bestellungen.html';
        }
      });
      cancelButton.dataset.bound = 'true';
    }
    const discardButton = document.getElementById('discardOrderDraft');
    if (discardButton) {
      discardButton.textContent = translateTemplate(isEditing ? 'Änderungen verwerfen' : 'Entwurf verwerfen');
      if (!discardButton.dataset.bound) {
        discardButton.addEventListener('click', () => {
          if (isEditingExistingOrder() && state.orderDraftEditingId) {
            window.location.href = `/bestellung.html?order=${encodeURIComponent(state.orderDraftEditingId)}`;
          } else {
            clearOrderDraftStorage();
            state.orderDraft = buildEmptyOrderDraft();
            hydrateOrderCreateForm();
            renderPositionsEditor();
            updateDraftTotalsOutputs();
            showToast(translateTemplate('Entwurf wurde verworfen.'));
          }
        });
        discardButton.dataset.bound = 'true';
      }
    }
    const saveDraftButton = document.getElementById('saveDraftOrder');
    if (saveDraftButton) {
      if (isEditing) {
        saveDraftButton.classList.add('hidden');
      } else {
        saveDraftButton.classList.remove('hidden');
        if (!saveDraftButton.dataset.bound) {
          saveDraftButton.addEventListener('click', () => {
            persistDraftImmediately();
            showToast(translateTemplate('Entwurf gespeichert.'));
          });
          saveDraftButton.dataset.bound = 'true';
        }
      }
    }
    const submitButton = document.getElementById('submitOrderCreate');
    if (submitButton) {
      submitButton.addEventListener('click', async () => {
        if (submitButton.dataset.loading === 'true') return;
        const payload = buildOrderCreatePayloadForSubmit();
        const errors = validateOrderCreatePayload(payload);
        if (errors.length) {
          showToast(errors[0]);
          return;
        }
        const initialLabel = submitButton.textContent;
        submitButton.dataset.loading = 'true';
        submitButton.disabled = true;
        submitButton.textContent = translateTemplate('Speichern …');
        try {
          if (isEditingExistingOrder() && state.orderDraftEditingId) {
            const targetId = state.orderDraftEditingId;
            const result = await request(`/api/orders/${encodeURIComponent(targetId)}`, {
              method: 'PATCH',
              body: { full_update: payload }
            });
            showToast(translateTemplate('Bestellung aktualisiert'));
            state.orderDraftEditingId = null;
            window.location.href = `/bestellung.html?order=${encodeURIComponent(result?.id || targetId)}`;
            return;
          }
          const result = await request('/api/orders', { method: 'POST', body: payload });
          clearOrderDraftStorage();
          showToast(translateTemplate('Bestellung angelegt'));
          if (result?.id) {
            window.location.href = `/bestellung.html?order=${encodeURIComponent(result.id)}`;
          } else {
            window.location.href = '/bestellungen.html';
          }
        } catch (err) {
          showToast(err.message);
        } finally {
          submitButton.dataset.loading = 'false';
          submitButton.disabled = false;
          submitButton.textContent = initialLabel;
        }
      });
    }
    initCustomerQuickCreatePanel();
  }

  let customerQuickCreateLastTrigger = null;
  let customerQuickCreateKeyListenerBound = false;

  function toggleCustomerQuickCreate(open) {
    const drawer = document.getElementById('customerQuickCreate');
    if (!drawer) return;
    const isOpen = drawer.classList.contains('open');
    const nextState = typeof open === 'boolean' ? open : !isOpen;
    if (nextState === isOpen) return;
    if (nextState) {
      drawer.hidden = false;
      drawer.classList.add('open');
      drawer.setAttribute('aria-hidden', 'false');
      customerQuickCreateLastTrigger = document.activeElement;
      document.body.classList.add('modal-open');
      const focusable = drawer.querySelector(
        'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)'
      );
      if (focusable) {
        focusable.focus();
      }
    } else {
      drawer.classList.remove('open');
      drawer.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('modal-open');
      drawer.hidden = true;
      const target = customerQuickCreateLastTrigger || document.getElementById('openCustomerQuickCreate');
      if (target && typeof target.focus === 'function') {
        target.focus();
      }
    }
  }

  function ensureCustomerPlaceholderRecords(customerId, payload = {}) {
    if (!customerId) return;
    state.customers = Array.isArray(state.customers) ? state.customers : [];
    state.addresses = Array.isArray(state.addresses) ? state.addresses : [];
    state.contacts = Array.isArray(state.contacts) ? state.contacts : [];
    const fallbackCustomer = {
      id: customerId,
      name: payload.customerName || customerId,
      customer_name: payload.customerName || customerId,
      customer_number: payload.customerNumber || customerId,
      tax_id: payload.taxId || ''
    };
    const customerIdx = state.customers.findIndex((entry) => entry.id === customerId);
    if (customerIdx === -1) {
      state.customers.push(fallbackCustomer);
    } else {
      state.customers[customerIdx] = { ...state.customers[customerIdx], ...fallbackCustomer };
    }
    const addressCandidates = [];
    const billingAddress = buildAddressFromPayload(customerId, payload, 'rechnung');
    if (billingAddress) addressCandidates.push(billingAddress);
    const shippingAddress = buildAddressFromPayload(customerId, payload, 'lieferung');
    if (shippingAddress) addressCandidates.push(shippingAddress);
    addressCandidates.forEach((address) => {
      const idx = state.addresses.findIndex((entry) => entry.id === address.id);
      if (idx === -1) {
        state.addresses.push(address);
      } else {
        state.addresses[idx] = { ...state.addresses[idx], ...address };
      }
    });
    const contact = buildContactFromPayload(customerId, payload);
    if (contact) {
      const idx = state.contacts.findIndex((entry) => entry.id === contact.id);
      if (idx === -1) {
        state.contacts.push(contact);
      } else {
        state.contacts[idx] = { ...state.contacts[idx], ...contact };
      }
    }
  }

  function handleCustomerQuickCreateSuccess(result, payload = {}) {
    const detail = result?.customer ? result : null;
    const fallbackId = payload.customerNumber || payload.customerId || null;
    const customerId = detail?.customer?.id || result?.id || fallbackId;
    if (!customerId) {
      showToast(translateTemplate('Neuer Kunde konnte nicht übernommen werden.'));
      return;
    }
    if (detail) {
      mergeCustomerDetailIntoState(detail);
    } else {
      ensureCustomerPlaceholderRecords(customerId, payload);
    }
    const draft = ensureOrderDraft();
    draft.customer_id = customerId;
    draft.customer_number =
      detail?.customer?.customer_number || payload.customerNumber || draft.customer_number || customerId;
    const relations = resolveDefaultCustomerRelations(customerId);
    if (relations.billingAddressId) {
      draft.billing_address_id = relations.billingAddressId;
    }
    if (relations.shippingAddressId) {
      draft.shipping_address_id = relations.shippingAddressId;
    }
    if (relations.contactId) {
      draft.contact_id = relations.contactId;
    }
    populateOrderCreateSelects(draft);
    populateCustomerDependentSelects(customerId, draft, { autoSelect: true });
    const select = document.getElementById('customerSelect');
    if (select) {
      select.value = customerId;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    toggleCustomerQuickCreate(false);
    scheduleDraftPersist();
  }

  function initCustomerQuickCreatePanel() {
    const drawer = document.getElementById('customerQuickCreate');
    const trigger = document.getElementById('openCustomerQuickCreate');
    if (!drawer || !trigger) return;
    const allowed = isInternalRole(state.user?.role);
    trigger.hidden = !allowed;
    if (!allowed) {
      drawer.setAttribute('aria-hidden', 'true');
      drawer.hidden = true;
      return;
    }
    trigger.removeAttribute('hidden');
    if (!trigger.dataset.bound) {
      trigger.addEventListener('click', () => toggleCustomerQuickCreate(true));
      trigger.dataset.bound = 'true';
    }
    drawer.querySelectorAll('[data-action="close-customer-quick-create"]').forEach((node) => {
      if (node.dataset.bound) return;
      node.addEventListener('click', () => toggleCustomerQuickCreate(false));
      node.dataset.bound = 'true';
    });
    if (!drawer.dataset.backdropBound) {
      drawer.addEventListener('click', (event) => {
        if (event.target === drawer) {
          toggleCustomerQuickCreate(false);
        }
      });
      drawer.dataset.backdropBound = 'true';
    }
    if (!customerQuickCreateKeyListenerBound) {
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && drawer.classList.contains('open')) {
          toggleCustomerQuickCreate(false);
        }
      });
      customerQuickCreateKeyListenerBound = true;
    }
    initCustomerCreateForm({
      formId: 'customerQuickCreateForm',
      mode: 'create',
      onSuccess: (result, payload) => handleCustomerQuickCreateSuccess(result, payload || {})
    });
  }

  function renderPositionsEditor() {
    const container = document.getElementById('positionsEditor');
    if (!container) return;
    const draft = ensureOrderDraft();
    const positions = draft.positions || [];
    if (!positions.length) {
      container.innerHTML = `<p class="muted">${escapeHtml(translateTemplate('Noch keine Positionen angelegt.'))}</p>`;
      return;
    }
    const fallbackSizes = getDraftSizeColumns(positions);
    const cards = positions
      .map((pos, index) => {
        const previewImage = resolvePositionPreviewImage(pos);
        const ownSizes = sortSizeKeys(Array.from(collectSizesFromPosition(pos)));
        const sizeColumns = ownSizes.length ? ownSizes : fallbackSizes;
        const sizeInputs = sizeColumns
          .map(
            (size) => `
              <label class="size-input" data-size="${size}">
                <span>${size}</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  data-size="${size}"
                  placeholder="0"
                  value="${pos.size_breakdown?.[size] ?? ''}"
                />
              </label>`
          )
          .join('');
        const amount =
          typeof pos.amount === 'number'
            ? pos.amount
            : (Number(pos.quantity) || 0) * (Number(pos.rate) || 0);
        return `
          <article class="position-edit-card" data-index="${index}">
            <header class="position-edit-card-head">
              <div>
                <span class="muted">Position</span>
                <strong>${index + 1}</strong>
              </div>
              <button type="button" class="ghost remove-position-btn" data-action="remove-position" aria-label="Position entfernen">
                ${TRASH_ICON_SVG}
              </button>
            </header>
            <div class="position-edit-body">
              <div class="position-edit-fields">
                <label>
                  Artikelnummer
                  <input type="text" data-field="item_code" list="itemCodeSuggestions" placeholder="Artikelnummer" value="${pos.item_code || ''}" />
                </label>
                <label>
                  Farbcode
                  <input type="text" data-field="color_code" placeholder="Farbcode" value="${pos.color_code || ''}" />
                </label>
                <label>
                  Menge
                  <input type="number" min="0" step="1" data-field="quantity" placeholder="0" value="${pos.quantity ?? ''}" />
                </label>
                <label>
                  Einzelpreis (netto)
                  <input type="number" min="0" step="0.01" data-field="rate" placeholder="0,00" value="${pos.rate ?? ''}" />
                </label>
                <label>
                  Gesamt
                  <output data-role="position-total">${amount ? formatMoney(amount, draft.currency) : '-'}</output>
                </label>
              </div>
              <div class="position-edit-image">
                ${
                  previewImage
                    ? `<img src="${previewImage}" alt="${escapeHtml(pos.item_code || 'Artikel')}" loading="lazy" />`
                    : '<span class="muted">Kein Bild</span>'
                }
              </div>
            </div>
            <div class="position-edit-sizes">
              ${sizeInputs}
            </div>
          </article>`;
      })
      .join('');
    container.innerHTML = `<div class="position-card-list">${cards}</div>`;
    bindPositionsEditorEvents();
  }

  function bindPositionsEditorEvents() {
    const container = document.getElementById('positionsEditor');
    if (!container || container.dataset.bound) return;
    container.dataset.bound = 'true';
    container.addEventListener('input', handlePositionEditorInput);
    container.addEventListener('click', handlePositionEditorClick);
  }

  function handlePositionEditorInput(event) {
    const card = event.target.closest('[data-index]');
    if (!card) return;
    const index = Number(card.dataset.index);
    const draft = ensureOrderDraft();
    const position = draft.positions[index];
    if (!position) return;
    const field = event.target.dataset.field;
    if (field) {
      if (field === 'quantity' || field === 'rate') {
        const value = event.target.value === '' ? '' : Number(event.target.value);
        position[field] = value;
      } else if (field === 'item_code') {
        position[field] = event.target.value;
        const applied = applyItemAutoFill(position, event.target.value);
        if (applied) {
          const qtyAuto = Number(position.quantity) || 0;
          const rateAuto = Number(position.rate) || 0;
          position.amount = qtyAuto && rateAuto ? qtyAuto * rateAuto : null;
          renderPositionsEditor();
          updateDraftTotalsOutputs(draft.currency);
          scheduleDraftPersist();
          return;
        }
      } else {
        position[field] = event.target.value;
      }
    }
    const sizeKey = event.target.dataset.size;
    if (sizeKey) {
      position.size_breakdown = position.size_breakdown || {};
      position.size_breakdown[sizeKey] = event.target.value === '' ? '' : Number(event.target.value);
      syncQuantityFromSizes(position, card);
    }
    const qty = Number(position.quantity) || 0;
    const rate = Number(position.rate) || 0;
    position.amount = qty && rate ? qty * rate : null;
    const totalCell = card.querySelector('[data-role="position-total"]');
    if (totalCell) {
      totalCell.textContent = position.amount ? formatMoney(position.amount, draft.currency) : '-';
    }
    scheduleDraftPersist();
    updateDraftTotalsOutputs(draft.currency);
  }

  function handlePositionEditorClick(event) {
    const trigger = event.target.closest('[data-action]');
    if (!trigger) return;
    const action = trigger.dataset.action;
    const card = trigger.closest('[data-index]');
    if (!card) return;
    const index = Number(card.dataset.index);
    const draft = ensureOrderDraft();
    if (action === 'remove-position') {
      draft.positions.splice(index, 1);
      renderPositionsEditor();
      updateDraftTotalsOutputs(draft.currency);
      scheduleDraftPersist();
    }
  }

  function buildOrderCreatePayloadForSubmit() {
    const draft = ensureOrderDraft();
    ensureDispatchDefaults(draft);
    const supplierEntry = getSupplierById(draft.supplier_id);
    if (supplierEntry) {
      draft.supplier_name = supplierEntry.name;
    }
    const payload = {
      order_number: draft.order_number || undefined,
      order_type: draft.order_type || 'BESTELLUNG',
      requested_delivery: draft.requested_delivery || '',
      portal_status: draft.portal_status || 'ORDER_EINGEREICHT',
      naming_series: draft.naming_series || ORDER_SERIES_OPTIONS[0] || '',
      company: draft.company || COMPANY_OPTIONS[0] || '',
      customer_id: draft.customer_id || '',
      customer_number: draft.customer_number || '',
      billing_address_id: draft.billing_address_id || '',
      shipping_address_id: draft.shipping_address_id || '',
      dispatch_address_id: draft.dispatch_address_id || '',
      supplier_id: draft.supplier_id || '',
      supplier_name: draft.supplier_name || '',
      contact_id: draft.contact_id || '',
      contact_name: draft.contact_name || '',
      contact_email: draft.contact_email || '',
      contact_phone: draft.contact_phone || '',
      shipping_payer: draft.shipping_payer || 'BATE',
      shipping_method: draft.shipping_method || 'Spedition',
      shipping_packaging: draft.shipping_packaging || '',
      shipping_pickup: Boolean(draft.shipping_pickup),
      tax_template: draft.tax_template || '',
      currency: draft.currency || 'EUR',
      positions: []
    };
    payload.positions = (draft.positions || [])
      .map((position) => {
        const sizeBreakdown = {};
        Object.entries(position.size_breakdown || {}).forEach(([size, value]) => {
          if (value === '' || value === null || value === undefined) return;
          const numeric = Number(value);
          if (Number.isNaN(numeric)) return;
          sizeBreakdown[size] = numeric;
        });
        const quantity = Number(position.quantity) || 0;
        const rate = Number(position.rate) || 0;
        const computedAmount = typeof position.amount === 'number' ? position.amount : quantity * rate;
        const amount = Number.isFinite(computedAmount) ? computedAmount : null;
        return {
          item_code: position.item_code?.trim() || '',
          description: position.description || '',
          color_code: position.color_code || '',
          quantity,
          rate,
          amount,
          size_breakdown: sizeBreakdown,
          schedule_date: position.schedule_date || draft.requested_delivery || '',
          uom: position.uom || '',
          warehouse: position.warehouse || '',
          supplier_part_no: position.supplier_part_no || ''
        };
      })
      .filter((pos) => pos.item_code && pos.quantity > 0);
    return payload;
  }

  function validateOrderCreatePayload(payload) {
    const t = (key) => translateTemplate(key);
    const errors = [];
    if (!payload.order_type) {
      errors.push(t('Bitte eine Bestellart wählen.'));
    }
    if (!payload.requested_delivery) {
      errors.push(t('Bitte ein Lieferdatum festlegen.'));
    }
    if (!payload.customer_id) {
      errors.push(t('Bitte einen Kunden wählen.'));
    }
    if (!payload.billing_address_id) {
      errors.push(t('Bitte eine Rechnungsadresse wählen.'));
    }
    if (!payload.shipping_address_id) {
      errors.push(t('Bitte eine Lieferadresse wählen.'));
    }
    if (!payload.dispatch_address_id) {
      errors.push(t('Bitte einen Absender wählen.'));
    }
    if (!payload.shipping_method) {
      errors.push(t('Bitte eine Transportart angeben.'));
    }
    if (!payload.portal_status) {
      errors.push(t('Bitte einen Status setzen.'));
    }
    if (!payload.naming_series) {
      errors.push(t('Bitte einen Nummernkreis wählen.'));
    }
    if (!payload.company) {
      errors.push(t('Bitte ein Unternehmen auswählen.'));
    }
    if (!payload.positions.length) {
      errors.push(t('Mindestens eine Position mit Artikelnummer und Menge ist erforderlich.'));
    }
    return errors;
  }

  async function initBestellungNeu() {
    const params = new URLSearchParams(window.location.search);
    const editingOrderId = params.get('order');
    state.orderDraftEditingId = editingOrderId || null;
    const isEditing = Boolean(editingOrderId);
    setBreadcrumbLabel(isEditing ? translateTemplate('Bestellung bearbeiten') : translateTemplate('Bestellung anlegen'));
    const backButton = document.getElementById('backToList');
    if (backButton) {
      backButton.addEventListener('click', () => {
        if (isEditing && state.orderDraftEditingId) {
          window.location.href = `/bestellung.html?order=${encodeURIComponent(state.orderDraftEditingId)}`;
        } else {
          window.location.href = '/bestellungen.html';
        }
      });
    }
    const isDraftMode = params.get('draft') === '1';
    const forceFresh = params.get('fresh') === '1' || (!isDraftMode && !isEditing);

    try {
      const [customers, addresses, contacts, items, suppliers] = await Promise.all([
        request('/api/erp/customers'),
        request('/api/erp/addresses'),
        request('/api/erp/contacts'),
        request('/api/erp/items'),
        request('/api/erp/suppliers')
      ]);
      state.customers = customers;
      state.addresses = addresses;
      updateSupplierDirectory(addresses, suppliers);
      state.contacts = contacts;
      state.erpItems = items;
      ensureItemCodeSuggestions();
    } catch (err) {
      showToast(err.message || translateTemplate('Stammdaten konnten nicht geladen werden.'));
      return;
    }
    if (isEditing) {
      try {
        const existingOrder = await request(`/api/orders/${editingOrderId}`);
        state.orderDraft = buildDraftFromOrder(existingOrder);
      } catch (err) {
        showToast(err.message || translateTemplate('Bestellung konnte nicht geladen werden.'));
        state.orderDraftEditingId = null;
        state.orderDraft = buildEmptyOrderDraft();
      }
    } else if (forceFresh) {
      clearOrderDraftStorage();
      state.orderDraft = buildEmptyOrderDraft();
    } else {
      state.orderDraft = loadOrderDraftFromStorage() || buildEmptyOrderDraft();
    }
    hydrateOrderCreateForm();
    bindOrderCreateFormEvents();
    renderPositionsEditor();
    updateDraftTotalsOutputs(state.orderDraft.currency);
  }

  async function initEtikettenPage() {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('order');
    if (!orderId) {
      showToast(translateTemplate('Keine Bestellung ausgewählt'));
      return;
    }
    try {
      const [order, customers, addresses, erpItems, suppliers] = await Promise.all([
        request(`/api/orders/${orderId}`),
        request('/api/erp/customers'),
        request('/api/erp/addresses'),
        request('/api/erp/items'),
        request('/api/erp/suppliers')
      ]);
      state.selectedOrder = order;
      state.customers = customers;
      state.addresses = addresses;
      updateSupplierDirectory(addresses, suppliers);
      state.erpItems = erpItems;
      const title = document.getElementById('etikettOrderNumber');
      if (title) title.textContent = order.order_number || order.id;
      const backButton = document.getElementById('backToBestellung');
      if (backButton) {
        backButton.addEventListener('click', () => {
          window.location.href = `/bestellung.html?order=${encodeURIComponent(order.id)}`;
        });
      }
      await prepareLabelModule(order);
    } catch (err) {
      showToast(err.message);
    }
  }

  async function initSchuhboxPage() {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('order');
    if (!orderId) {
      showToast(translateTemplate('Keine Bestellung ausgewählt'));
      return;
    }
    try {
      const [order, erpItems] = await Promise.all([request(`/api/orders/${orderId}`), request('/api/erp/items')]);
      state.selectedOrder = order;
      state.erpItems = erpItems;
      const inferredYear = order.requested_delivery ? new Date(order.requested_delivery).getFullYear() : null;
      if (Number.isFinite(inferredYear)) {
        state.shoeboxYear = inferredYear;
      } else if (!Number.isFinite(state.shoeboxYear)) {
        state.shoeboxYear = new Date().getFullYear();
      }
      if (!state.shoeboxSeason || !SHOEBOX_SEASON_CHOICES.includes(state.shoeboxSeason)) {
        state.shoeboxSeason = 'FS';
      }
      const badge = document.getElementById('shoeboxOrderNumber');
      if (badge) badge.textContent = order.order_number || order.id;
      const backButton = document.getElementById('backToBestellung');
      if (backButton) {
        backButton.addEventListener('click', () => {
          window.location.href = `/bestellung.html?order=${encodeURIComponent(order.id)}`;
        });
      }
      const printButton = document.getElementById('printShoeboxLabels');
      if (printButton) {
        printButton.addEventListener('click', () => printShoeboxLabels());
      }
      renderShoeboxLabels(order);
      await applyShoeboxPreset(order.customer_id);
    } catch (err) {
      showToast(err.message);
    }
  }

  function buildEmptyProformaItem() {
    return {
      articleNumber: '',
      color: '',
      description: '',
      size: '',
      materialUpper: '',
      materialLining: '',
      materialSole: '',
      customsCode: '',
      producer: COMPANY_CONFIG[0]?.label || 'BATE GmbH',
      quantity: 0,
      unitType: 'PAIR',
      unitPrice: 0,
      purchasePrice: 0,
      declaredValue: 0,
      vatRate: 0,
      imageData: ''
    };
  }

  function buildDefaultProformaDraft() {
    return {
      meta: {
        id: null,
        number: null
      },
      document: {
        reference: '',
        invoiceNumber: '',
        date: new Date().toISOString().slice(0, 10),
        currency: 'EUR',
        paymentTerms: 'Vorkasse'
      },
      seller: {
        ...DEFAULT_SELLER_DETAILS,
        address: composePartyAddress(DEFAULT_SELLER_DETAILS),
        contact: composePartyContact(DEFAULT_SELLER_DETAILS)
      },
      buyer: {
        ...DEFAULT_BUYER_DETAILS,
        address: composePartyAddress(DEFAULT_BUYER_DETAILS),
        contact: composePartyContact(DEFAULT_BUYER_DETAILS)
      },
      shipping: {
        transportedBy: '',
        shipmentInfo: '',
        place: 'ISTANBUL GÜNGÖREN'
      },
      items: [buildEmptyProformaItem()]
    };
  }

  function ensureProformaDraft() {
    if (!state.proformaDraft) {
      state.proformaDraft = buildDefaultProformaDraft();
    }
    if (!Array.isArray(state.proformaDraft.items) || !state.proformaDraft.items.length) {
      state.proformaDraft.items = [buildEmptyProformaItem()];
    }
    if (!state.proformaDraft.meta) {
      state.proformaDraft.meta = { id: null, number: null };
    }
    state.proformaDraft.seller = hydratePartyDraft(state.proformaDraft.seller, DEFAULT_SELLER_DETAILS);
    state.proformaDraft.buyer = hydratePartyDraft(state.proformaDraft.buyer, DEFAULT_BUYER_DETAILS);
    state.proformaDraft.shipping = {
      ...buildDefaultProformaDraft().shipping,
      ...(state.proformaDraft.shipping || {})
    };
    state.proformaDraft.items = state.proformaDraft.items.map((item) => ({
      ...buildEmptyProformaItem(),
      ...item
    }));
  }

  function getProformaDraftValue(path) {
    if (!path || !state.proformaDraft) return '';
    return path.split('.').reduce((acc, key) => {
      if (acc && Object.prototype.hasOwnProperty.call(acc, key)) {
        return acc[key];
      }
      return '';
    }, state.proformaDraft);
  }

  function setProformaDraftValue(path, value) {
    if (!path) return;
    ensureProformaDraft();
    const keys = path.split('.');
    let cursor = state.proformaDraft;
    for (let i = 0; i < keys.length - 1; i += 1) {
      const key = keys[i];
      if (!cursor[key] || typeof cursor[key] !== 'object') {
        cursor[key] = {};
      }
      cursor = cursor[key];
    }
    cursor[keys[keys.length - 1]] = value;
  }

  function hydrateProformaForm() {
    const form = document.getElementById('proformaForm');
    if (!form) return;
    ensureProformaDraft();
    form.querySelectorAll('[data-bind]').forEach((element) => {
      const value = getProformaDraftValue(element.dataset.bind);
      element.value = value || '';
    });
    renderProformaItems();
    updateProformaTotals();
    updateProformaMetaUi();
    updateProformaActionState();
    bindPresetButtons();
    applyFormMode();
  }

  function bindProformaFormEvents() {
    const form = document.getElementById('proformaForm');
    if (!form || form.dataset.bound === '1') return;
    form.dataset.bound = '1';
    form.addEventListener('input', (event) => {
      const target = event.target;
      if (!target || !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
        return;
      }
      const bindPath = target.dataset.bind;
      if (bindPath) {
        setProformaDraftValue(bindPath, target.value);
        if (bindPath === 'document.currency') {
          updateProformaTotals();
        }
        return;
      }
      const field = target.dataset.itemField;
      if (!field) return;
      const index = Number(target.dataset.itemIndex);
      const valueType = target.dataset.valueType || 'text';
      updateProformaItemField(index, field, target.value, valueType);
      updateProformaTotals();
    });
    form.addEventListener('click', (event) => {
      const addTrigger = event.target.closest('[data-action="add-item"]');
      if (addTrigger) {
        event.preventDefault();
        addProformaItem();
        return;
      }
      const removeTrigger = event.target.closest('[data-remove-item]');
      if (removeTrigger) {
        event.preventDefault();
        const index = Number(removeTrigger.dataset.removeItem);
        removeProformaItem(index);
        return;
      }
      const duplicateTrigger = event.target.closest('[data-duplicate-item]');
      if (duplicateTrigger) {
        event.preventDefault();
        duplicateProformaItem(Number(duplicateTrigger.dataset.duplicateItem));
      }
    });
    form.addEventListener('change', (event) => {
      const target = event.target;
      if (!target) return;
      const imageIndexAttr = target.dataset.imageInput;
      if (imageIndexAttr !== undefined) {
        const index = Number(imageIndexAttr);
        const file = target.files && target.files[0];
        if (!file) {
          updateProformaImage(index, '');
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          updateProformaImage(index, reader.result);
        };
        reader.readAsDataURL(file);
      }
    });
    form.addEventListener('click', (event) => {
      const imageTrigger = event.target.closest('[data-image-trigger]');
      if (imageTrigger) {
        event.preventDefault();
        const index = Number(imageTrigger.dataset.imageTrigger);
        const input = form.querySelector(`[data-image-input="${index}"]`);
        if (input) input.click();
        return;
      }
      const removeImageBtn = event.target.closest('[data-remove-image]');
      if (removeImageBtn) {
        event.preventDefault();
        const index = Number(removeImageBtn.dataset.removeImage);
        updateProformaImage(index, '');
      }
    });
    const pdfButton = document.getElementById('proformaPdfBtn');
    if (pdfButton) {
      pdfButton.addEventListener('click', async (event) => {
        event.preventDefault();
        if (!state.proformaDraft?.meta?.id) {
          showToast('Bitte zuerst speichern.');
          return;
        }
        await exportProformaPdf();
      });
    }
    const saveButton = document.getElementById('proformaSave');
    if (saveButton && saveButton.dataset.bound !== '1') {
      saveButton.dataset.bound = '1';
      saveButton.addEventListener('click', async (event) => {
        event.preventDefault();
        await saveProformaDraft();
      });
    }
    const deleteButton = document.getElementById('proformaDelete');
    if (deleteButton && deleteButton.dataset.bound !== '1') {
      deleteButton.dataset.bound = '1';
      deleteButton.addEventListener('click', async (event) => {
        event.preventDefault();
        if (!state.proformaDraft?.meta?.id) return;
        const confirmed = window.confirm('Muster Proforma wirklich löschen?');
        if (!confirmed) return;
        await deleteProforma(state.proformaDraft.meta.id, true);
      });
    }
    const toggleBtn = document.getElementById('toggleEdit');
    if (toggleBtn && toggleBtn.dataset.bound !== '1') {
      toggleBtn.dataset.bound = '1';
      toggleBtn.addEventListener('click', () => {
        state.proformaReadOnly = !state.proformaReadOnly;
        applyFormMode();
      });
    }
  }

  function renderProformaItems() {
    const body = document.getElementById('proformaItemsBody');
    if (!body) return;
    ensureProformaDraft();
    body.innerHTML = state.proformaDraft.items
      .map((item, index) => {
        const quantityValue = Number(item.quantity);
        const unitPriceValue = Number(item.unitPrice);
        const purchasePriceValue = Number(item.purchasePrice);
        const declaredValue = Number(item.declaredValue);
        const quantity = Number.isFinite(quantityValue) ? quantityValue : '';
        const unitPrice = Number.isFinite(unitPriceValue) ? unitPriceValue : '';
        const purchasePrice = Number.isFinite(purchasePriceValue) ? purchasePriceValue : '';
        const declared = Number.isFinite(declaredValue) ? declaredValue : '';
        const unitOptions = PROFORMA_UNIT_CHOICES.map((choice) => {
          const selected = (item.unitType || 'PAIR') === choice.value ? 'selected' : '';
          return `<option value="${choice.value}" ${selected}>${choice.label}</option>`;
        }).join('');
        const imageSrc = item.imageData ? escapeHtml(item.imageData) : '';
        const imagePreview = imageSrc
          ? `<img src="${imageSrc}" alt="Positionsbild" class="proforma-image-preview" />`
          : '<span class="muted">Kein Bild</span>';
        const buildSelectOptions = (choices, value) => {
          const options = ['<option value="">-</option>'];
          const normalizedValue = (value || '').trim().toLowerCase();
          let hasMatch = false;
          choices.forEach((label) => {
            const isSelected = normalizedValue && normalizedValue === label.toLowerCase();
            if (isSelected) hasMatch = true;
            options.push(
              `<option value="${escapeHtml(label)}" ${isSelected ? 'selected' : ''}>${escapeHtml(label)}</option>`
            );
          });
          if (!hasMatch && value) {
            options.push(`<option value="${escapeHtml(value)}" selected>${escapeHtml(value)}</option>`);
          }
          return options.join('');
        };
        const descriptionOptions = buildSelectOptions(PROFORMA_DESCRIPTION_CHOICES, item.description);
        const materialUpperOptions = buildSelectOptions(PROFORMA_MATERIAL_CHOICES, item.materialUpper);
        const materialLiningOptions = buildSelectOptions(PROFORMA_MATERIAL_CHOICES, item.materialLining);
        const materialSoleOptions = buildSelectOptions(PROFORMA_SOLE_CHOICES, item.materialSole);
        return `<article class="proforma-item-card" data-index="${index}">
          <header>
            <strong>Position ${index + 1}</strong>
            <div class="item-card-actions">
              <button type="button" class="ghost small" data-duplicate-item="${index}">Duplizieren</button>
              <button type="button" class="ghost small danger" data-remove-item="${index}">Entfernen</button>
            </div>
          </header>
          <div class="proforma-item-layout">
            <div class="proforma-item-media">
              <div class="proforma-image-control">
                ${imagePreview}
                <input type="file" accept="image/*" data-image-input="${index}" hidden />
                <div class="image-buttons">
                  <button type="button" class="ghost small" data-image-trigger="${index}">Bild wählen</button>
                  ${item.imageData ? `<button type="button" class="ghost small" data-remove-image="${index}">Entfernen</button>` : ''}
                </div>
              </div>
            </div>
            <div class="proforma-item-content">
              <div class="proforma-item-row">
                <div class="proforma-item-cell">
                  <label class="proforma-field">
                    <span>Artikelnummer</span>
                    <input type="text" data-item-index="${index}" data-item-field="articleNumber" value="${escapeHtml(item.articleNumber || '')}" placeholder="Artikel / SKU" />
                  </label>
                </div>
                <div class="proforma-item-cell">
                  <label class="proforma-field">
                    <span>Farbe / Variante</span>
                    <input type="text" data-item-index="${index}" data-item-field="color" value="${escapeHtml(item.color || '')}" placeholder="Color" />
                  </label>
                </div>
                <div class="proforma-item-cell">
                <label class="proforma-field">
                  <span>Beschreibung</span>
                  <select data-item-index="${index}" data-item-field="description">
                    ${descriptionOptions}
                  </select>
                </label>
              </div>
              </div>
              <div class="proforma-item-row">
                <div class="proforma-item-cell">
                  <label class="proforma-field">
                    <span>Außenmaterial</span>
                    <select data-item-index="${index}" data-item-field="materialUpper">
                      ${materialUpperOptions}
                    </select>
                  </label>
                </div>
                <div class="proforma-item-cell">
                  <label class="proforma-field">
                    <span>Innenmaterial</span>
                    <select data-item-index="${index}" data-item-field="materialLining">
                      ${materialLiningOptions}
                    </select>
                  </label>
                </div>
                <div class="proforma-item-cell">
                  <label class="proforma-field">
                    <span>Sohle</span>
                    <select data-item-index="${index}" data-item-field="materialSole">
                      ${materialSoleOptions}
                    </select>
                  </label>
                </div>
              </div>
              <div class="proforma-item-row">
                <div class="proforma-item-cell">
                  <label class="proforma-field">
                    <span>Hersteller</span>
                    <input type="text" data-item-index="${index}" data-item-field="producer" value="${escapeHtml(item.producer || '')}" />
                  </label>
                </div>
                <div class="proforma-item-cell">
                  <label class="proforma-field">
                    <span>Zolltarifnr.</span>
                    <input type="text" data-item-index="${index}" data-item-field="customsCode" value="${escapeHtml(item.customsCode || '')}" placeholder="HS-Code" />
                  </label>
                </div>
              </div>
              <div class="proforma-item-row">
                <div class="proforma-item-cell">
                  <label class="proforma-field">
                    <span>Menge</span>
                    <input type="number" min="0" step="0.01" data-item-index="${index}" data-item-field="quantity" data-value-type="number" value="${quantity}" />
                  </label>
                </div>
                <div class="proforma-item-cell">
                  <label class="proforma-field">
                    <span>Sample-Größe</span>
                    <select data-item-index="${index}" data-item-field="size">
                      <option value="" ${item.size ? '' : 'selected'}>-</option>
                      ${Array.from({ length: 10 }, (_, i) => 36 + i)
                        .map((sizeValue) => {
                          const selected = String(item.size || '') === String(sizeValue) ? 'selected' : '';
                          return `<option value="${sizeValue}" ${selected}>${sizeValue}</option>`;
                        })
                        .join('')}
                    </select>
                  </label>
                </div>
                <div class="proforma-item-cell">
                  <label class="proforma-field">
                    <span>Einheit</span>
                    <select data-item-index="${index}" data-item-field="unitType">${unitOptions}</select>
                  </label>
                </div>
              </div>
              <div class="proforma-item-row">
                <div class="proforma-item-cell">
                  <label class="proforma-field">
                    <span>Einzelpreis</span>
                    <input type="number" min="0" step="0.01" data-item-index="${index}" data-item-field="unitPrice" data-value-type="number" value="${unitPrice}" />
                  </label>
                </div>
                <div class="proforma-item-cell">
                  <label class="proforma-field">
                    <span>Einkaufspreis</span>
                    <input type="number" min="0" step="0.01" data-item-index="${index}" data-item-field="purchasePrice" data-value-type="number" value="${purchasePrice}" />
                  </label>
                </div>
                <div class="proforma-item-cell">
                  <label class="proforma-field">
                    <span>Deklarierter Wert</span>
                    <input type="number" min="0" step="0.01" data-item-index="${index}" data-item-field="declaredValue" data-value-type="number" value="${declared}" />
                  </label>
                </div>
              </div>
            </div>
          </div>
        </article>`;
      })
      .join('');
  }

  function updateProformaItemField(index, field, rawValue, valueType = 'text') {
    ensureProformaDraft();
    if (!state.proformaDraft.items[index]) return;
    let value = rawValue;
    if (valueType === 'number') {
      value = Number(rawValue);
      if (!Number.isFinite(value)) value = 0;
    } else if (valueType === 'percent') {
      const percent = Number(rawValue);
      value = Number.isFinite(percent) ? percent / 100 : 0;
    } else if (typeof rawValue === 'string') {
      value = rawValue;
    }
    state.proformaDraft.items[index][field] = valueType === 'text' ? value : Number(value) || 0;
  }

  function updateProformaImage(index, dataUrl) {
    ensureProformaDraft();
    if (!state.proformaDraft.items[index]) return;
    state.proformaDraft.items[index].imageData = dataUrl || '';
    renderProformaItems();
  }

  function getProformaItemTotals(item) {
    const quantity = Number(item?.quantity) || 0;
    const unitPrice = Number(item?.unitPrice) || 0;
    const vatRate = Number(item?.vatRate) || 0;
    const net = quantity * unitPrice;
    const tax = net * vatRate;
    const declaredInput = Number(item?.declaredValue);
    const declared = Number.isFinite(declaredInput) ? declaredInput : net + tax;
    return {
      net,
      tax,
      gross: net + tax,
      declared
    };
  }

  function updateProformaTotals() {
    ensureProformaDraft();
    const currency = state.proformaDraft.document?.currency || 'EUR';
    const totals = (state.proformaDraft.items || []).reduce(
      (acc, item) => {
        const rowTotals = getProformaItemTotals(item);
        acc.net += rowTotals.net;
        acc.tax += rowTotals.tax;
        acc.gross += rowTotals.gross;
        acc.declared += rowTotals.declared;
        return acc;
      },
      { net: 0, tax: 0, gross: 0, declared: 0 }
    );
    setText('proformaNet', formatMoney(totals.net, currency));
    setText('proformaTax', formatMoney(totals.tax, currency));
    setText('proformaGross', formatMoney(totals.gross, currency));
    setText('proformaDeclared', formatMoney(totals.declared, currency));
  }

  function addProformaItem() {
    ensureProformaDraft();
    state.proformaDraft.items.push(buildEmptyProformaItem());
    renderProformaItems();
    updateProformaTotals();
  }

  function removeProformaItem(index) {
    ensureProformaDraft();
    if (state.proformaDraft.items.length <= 1) {
      state.proformaDraft.items = [buildEmptyProformaItem()];
    } else {
      state.proformaDraft.items.splice(index, 1);
    }
    renderProformaItems();
    updateProformaTotals();
  }

  function duplicateProformaItem(index) {
    ensureProformaDraft();
    const source = state.proformaDraft.items[index];
    if (!source) return;
    const clone = JSON.parse(JSON.stringify(source));
    state.proformaDraft.items.splice(index + 1, 0, clone);
    renderProformaItems();
    updateProformaTotals();
  }

  async function loadProformaArchive() {
    try {
      const archive = await request('/api/proforma');
      state.proformaArchive = archive;
      renderProformaArchive();
    } catch (err) {
      console.warn(err);
    }
  }

  function renderProformaArchive() {
    const body = document.getElementById('proformaArchiveBody');
    if (!body) return;
    const entries = Array.isArray(state.proformaArchive) ? state.proformaArchive : [];
    if (!entries.length) {
      body.innerHTML = '<tr><td colspan="4" class="muted">Noch keine Muster Proformas gespeichert.</td></tr>';
      return;
    }
    body.innerHTML = entries
      .map((entry) => {
        const number = escapeHtml(entry.number || '-');
        const date = entry.date ? formatDate(entry.date) : '-';
        const quantity = Number(entry.total_quantity) || 0;
        return `<tr>
          <td>${number}</td>
          <td>${escapeHtml(date)}</td>
          <td>${quantity}</td>
          <td class="proforma-archive-actions">
            <a class="ghost small" href="/musterrechnung-detail.html?id=${encodeURIComponent(entry.id)}">Öffnen</a>
            <button type="button" class="ghost small danger" data-delete-proforma="${escapeHtml(entry.id)}">Löschen</button>
          </td>
        </tr>`;
      })
      .join('');
  }

  function bindProformaArchiveEvents() {
    const table = document.getElementById('proformaArchive');
    if (!table || table.dataset.bound === '1') return;
    table.dataset.bound = '1';
    table.addEventListener('click', async (event) => {
      const deleteBtn = event.target.closest('[data-delete-proforma]');
      if (deleteBtn) {
        event.preventDefault();
        const id = deleteBtn.dataset.deleteProforma;
        if (!id) return;
        const confirmed = window.confirm('Muster Proforma wirklich löschen?');
        if (!confirmed) return;
        await deleteProforma(id, false);
      }
    });
  }

  async function loadSavedProforma(id, opts = {}) {
    try {
      const entry = await request(`/api/proforma/${id}`);
      const payload = entry.payload || buildDefaultProformaDraft();
      state.proformaDraft = {
        ...payload,
        meta: {
          id: entry.id,
          number: entry.number
        }
      };
      hydrateProformaForm();
      if (!opts.silent) showToast('Muster Proforma geladen.');
    } catch (err) {
      showToast(err.message || 'Muster Proforma konnte nicht geladen werden.');
    }
  }

  function startNewProforma() {
    state.proformaDraft = buildDefaultProformaDraft();
    state.proformaReadOnly = false;
    hydrateProformaForm();
    showToast('Neue Muster Proforma gestartet.');
  }

  function bindPresetButtons() {
    document.querySelectorAll('[data-apply-preset]').forEach((button) => {
      if (button.dataset.bound === '1') return;
      button.dataset.bound = '1';
      button.addEventListener('click', () => {
        const [type, presetId] = (button.dataset.applyPreset || '').split(':');
        if (!type || !presetId) return;
        applyProformaPreset(type, presetId);
      });
    });
  }

  function applyProformaPreset(type, presetId) {
    const presets = PROFORMA_ADDRESS_PRESETS[type];
    if (!presets) return;
    const preset = presets.find((entry) => entry.id === presetId);
    if (!preset) return;
    ensureProformaDraft();
    state.proformaDraft[type] = {
      ...state.proformaDraft[type],
      ...preset.data
    };
    hydrateProformaForm();
    showToast(`${preset.label} übernommen.`);
  }

  function updateProformaMetaUi() {
    const badge = document.getElementById('proformaNumberBadge');
    if (!badge) return;
    const number = state.proformaDraft?.meta?.number;
    badge.textContent = number || 'Neu';
  }

  function updateProformaActionState() {
    const saved = Boolean(state.proformaDraft?.meta?.id);
    const pdfBtn = document.getElementById('proformaPdfBtn');
    const deleteBtn = document.getElementById('proformaDelete');
    const saveBtn = document.getElementById('proformaSave');
    if (pdfBtn) pdfBtn.disabled = !saved;
    if (deleteBtn) deleteBtn.disabled = !saved;
    const readOnly = Boolean(state.proformaReadOnly);
    if (saveBtn) saveBtn.disabled = readOnly;
  }

  function applyFormMode() {
    const form = document.getElementById('proformaForm');
    if (!form) return;
    const readOnly = Boolean(state.proformaReadOnly);
    form.classList.toggle('readonly-mode', readOnly);
    form.querySelectorAll('input, textarea, select, button').forEach((element) => {
      if (element.id === 'toggleEdit') return;
      if (element.closest('.proforma-submit')) return;
      element.disabled = readOnly;
    });
    const toggleBtn = document.getElementById('toggleEdit');
    if (toggleBtn) {
      toggleBtn.textContent = readOnly ? 'Bearbeiten' : 'Bearbeitung sperren';
      toggleBtn.setAttribute('aria-pressed', String(!readOnly));
    }
    updateProformaActionState();
  }

  function collectProformaPayload() {
    ensureProformaDraft();
    const draft = state.proformaDraft;
    const trimValue = (value) => (value ? value.toString().trim() : '');
    const blockValue = (value) => (value ? value.toString().trim() : '');
    const todayIso = new Date().toISOString().slice(0, 10);
    const items = (draft.items || [])
      .map((item, index) => {
        const quantity = Number(item.quantity) || 0;
        const unitPrice = Number(item.unitPrice) || 0;
        const purchasePrice = Number(item.purchasePrice);
        const declaredValue = Number(item.declaredValue);
        const entry = {
          position: index + 1,
          articleNumber: trimValue(item.articleNumber),
          color: trimValue(item.color),
          description: trimValue(item.description),
          size: trimValue(item.size),
          materialUpper: trimValue(item.materialUpper),
          materialLining: trimValue(item.materialLining),
          materialSole: trimValue(item.materialSole),
          customsCode: trimValue(item.customsCode),
          producer: trimValue(item.producer),
          quantity,
          unitType: item.unitType || 'PAIR',
          unitPrice,
          vatRate: 0,
          imageData: item.imageData || ''
        };
        if (Number.isFinite(purchasePrice)) {
          entry.purchasePrice = purchasePrice;
        }
        if (Number.isFinite(declaredValue)) {
          entry.declaredValue = declaredValue;
        }
        return entry;
      })
      .filter((item) => item.quantity > 0 && (item.description || item.articleNumber));
    if (!items.length) {
      showToast('Bitte mindestens eine Position mit Menge hinterlegen.');
      return null;
    }
    const buildPartyPayload = (partyDraft = {}) => {
      const base = {
        name: trimValue(partyDraft.name),
        street: trimValue(partyDraft.street),
        postalCode: trimValue(partyDraft.postalCode),
        city: trimValue(partyDraft.city),
        country: trimValue(partyDraft.country),
        email: trimValue(partyDraft.email),
        website: trimValue(partyDraft.website),
        taxId: trimValue(partyDraft.taxId),
        court: trimValue(partyDraft.court),
        ceo: trimValue(partyDraft.ceo)
      };
      const addressBlock = composePartyAddress({ ...partyDraft, ...base });
      const contactLine = composePartyContact({ ...partyDraft, ...base });
      return {
        ...base,
        address: addressBlock || blockValue(partyDraft.address),
        contact: contactLine || trimValue(partyDraft.contact)
      };
    };
    return {
      meta: {
        id: state.proformaDraft?.meta?.id || null
      },
      document: {
        reference: trimValue(draft.document.reference),
        invoiceNumber: trimValue(draft.document.invoiceNumber),
        date: draft.document.date || todayIso,
        currency: draft.document.currency || 'EUR',
        paymentTerms: trimValue(draft.document.paymentTerms)
      },
      seller: buildPartyPayload(draft.seller),
      buyer: buildPartyPayload(draft.buyer),
      shipping: {
        transportedBy: trimValue(draft.shipping.transportedBy),
        shipmentInfo: trimValue(draft.shipping.shipmentInfo),
        place: trimValue(draft.shipping.place)
      },
      items
    };
  }

  async function exportProformaPdf() {
    const payload = collectProformaPayload();
    if (!payload) return;
    const pdfBtn = document.getElementById('proformaPdfBtn');
    if (pdfBtn) pdfBtn.disabled = true;
    try {
      const response = await fetch('/api/proforma/export/pdf', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error || 'PDF Export fehlgeschlagen');
      }
      const blob = await response.blob();
      const savedId = response.headers.get('x-proforma-id');
      const savedNumber = response.headers.get('x-proforma-number');
      if (savedId) {
        state.proformaDraft.meta = state.proformaDraft.meta || {};
        state.proformaDraft.meta.id = savedId;
        if (savedNumber) {
          state.proformaDraft.meta.number = savedNumber;
          if (!state.proformaDraft.document.invoiceNumber) {
            state.proformaDraft.document.invoiceNumber = savedNumber;
            hydrateProformaForm();
          }
        }
        await loadProformaArchive();
      }
      const url = URL.createObjectURL(blob);
      const reference = payload.document.reference || 'musterrechnung';
      const datePart = payload.document.date || new Date().toISOString().slice(0, 10);
      const safeName = reference.toLowerCase().replace(/[^a-z0-9-_]/g, '_') || 'musterrechnung';
      const link = document.createElement('a');
      link.href = url;
      link.download = `${safeName}-${datePart}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast(translateTemplate('PDF erstellt'));
    } catch (err) {
      showToast(err.message || 'PDF Export fehlgeschlagen');
    } finally {
      if (pdfBtn) pdfBtn.disabled = false;
    }
  }

  async function saveProformaDraft() {
    const payload = collectProformaPayload();
    if (!payload) return null;
    const saveBtn = document.getElementById('proformaSave');
    if (saveBtn) saveBtn.disabled = true;
    try {
      const response = await fetch('/api/proforma', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error || 'Speichern fehlgeschlagen');
      }
      const entry = await response.json();
      state.proformaDraft = entry.payload || state.proformaDraft;
      state.proformaDraft.meta = {
        id: entry.id,
        number: entry.number
      };
      if (!state.proformaDraft.document.invoiceNumber) {
        state.proformaDraft.document.invoiceNumber = entry.number;
      }
      hydrateProformaForm();
      await loadProformaArchive();
      showToast('Muster Proforma gespeichert.');
      return entry;
    } catch (err) {
      showToast(err.message || 'Speichern fehlgeschlagen');
      return null;
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async function deleteProforma(id, redirectToList = false) {
    if (!id) return;
    try {
      const response = await fetch(`/api/proforma/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include'
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error || 'Löschen fehlgeschlagen');
      }
      await loadProformaArchive();
      showToast('Muster Proforma gelöscht.');
      if (redirectToList) {
        window.location.href = '/musterrechnung.html';
      }
    } catch (err) {
      showToast(err.message || 'Löschen fehlgeschlagen');
    }
  }

  async function initMusterProformaPage() {
    setBreadcrumbLabel('Muster Proforma');
    await loadProformaArchive();
    renderProformaArchive();
    bindProformaArchiveEvents();
  }

  async function initMusterProformaDetailPage() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    setBreadcrumbLabel(id ? 'Muster Proforma bearbeiten' : 'Muster Proforma anlegen');
    if (id) {
      state.proformaReadOnly = true;
      await loadSavedProforma(id, { silent: true });
    } else {
      state.proformaReadOnly = false;
      startNewProforma();
    }
    bindProformaFormEvents();
    bindPresetButtons();
    applyFormMode();
  }

  async function initDiagnosticsPage() {
    setBreadcrumbLabel('Systemstatus');
    await loadDiagnostics();
    const refreshBtn = document.getElementById('diagnosticsRefresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => loadDiagnostics());
    }
    const runTestsBtn = document.getElementById('diagnosticsRunTests');
    if (runTestsBtn) {
      runTestsBtn.addEventListener('click', async () => {
        const previousLabel = runTestsBtn.textContent;
        runTestsBtn.disabled = true;
        runTestsBtn.textContent = 'Tests laufen …';
        try {
          await loadDiagnostics();
        } finally {
          runTestsBtn.disabled = false;
          runTestsBtn.textContent = previousLabel;
        }
      });
    }
    if (!state.diagnosticsInterval) {
      state.diagnosticsInterval = setInterval(loadDiagnostics, 60000);
    }
  }

  async function printShoeboxLabels() {
    const orderId = state.selectedOrder?.id;
    if (!orderId) {
      showToast(translateTemplate('Keine Bestellung gewählt'));
      return;
    }
    const season = (state.shoeboxSeason || 'FS').toUpperCase();
    if (!SHOEBOX_SEASON_CHOICES.includes(season)) {
      showToast(translateTemplate('Bitte Saison auswählen.'));
      return;
    }
    const year = Number(state.shoeboxYear);
    if (!Number.isFinite(year) || year < 2000 || year > 2099) {
      showToast(translateTemplate('Bitte gültiges Jahr angeben (z. B. 2025).'));
      return;
    }
    const rows = (state.shoeboxRows || []).filter((row) => Number(row.quantity) > 0);
    if (!rows.length) {
      showToast(translateTemplate('Bitte mindestens eine Menge hinterlegen.'));
      return;
    }
    const payload = {
      season,
      year,
      labels: rows.map((row) => ({
        article_number: row.articleNumber,
        name: row.name,
        color_code: row.colorCode,
        size: row.size,
        image_url: row.imageUrl || row.defaultImageUrl || '',
        quantity: Number(row.quantity)
      }))
    };
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/shoebox-labels/pdf`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error || translateTemplate('PDF konnte nicht erstellt werden'));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `schuhbox-${state.selectedOrder?.order_number || 'etiketten'}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err.message);
    }
  }

  async function initTechpackPage() {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('order');
    const positionId = params.get('position');
    if (!orderId || !positionId) {
      showToast('Bestellung oder Position fehlt');
      return;
    }
    state.ticketFocusId = params.get('ticket') || null;
    state.techpackRequestedView = params.get('view')?.toLowerCase() || null;
    try {
      const [order, spec, tickets] = await Promise.all([
        request(`/api/orders/${orderId}`),
        request(`/api/specs/${orderId}/${positionId}`),
        request('/api/tickets')
      ]);
      state.selectedOrder = order;
      state.techpackSpec = spec;
      state.tickets = tickets;
      await localizeTicketTitlesForSupplier(tickets);
      state.techpackContext = { orderId, positionId };
      state.techpackActiveMedia = null;
      ensureTechpackActiveMedia(spec);
      const position = (order.positions || []).find((pos) => pos.position_id === positionId);
      if (!position) {
        showToast('Position nicht gefunden');
        return;
      }
      const backButton = document.getElementById('backToBestellung');
      if (backButton) {
        backButton.addEventListener('click', () => {
          const query = new URLSearchParams({
            order: order.id,
            position: position.position_id
          });
          window.location.href = `/techpack-list.html?${query.toString()}`;
        });
      }
      setText('techpackOrderNumber', order.order_number || order.id);
      setText('techpackPosition', position.position_id);
      const viewKey = resolveActiveViewKey();
      renderTechpackMedia(position, spec);
      bindTechpackAnnotationStage(order.id, positionId);
      bindTechpackUpload(order.id, positionId);
      bindTechpackReplace(order.id, positionId);
      bindTechpackDelete(order.id, positionId);
      bindTechpackStatusControl(order.id, positionId);
      renderTechpackTickets(order.id, positionId, viewKey);
      bindTechpackTicketForm(order.id, positionId);
    } catch (err) {
      showToast(err.message);
    }
  }

  async function initTechpackListPage() {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('order');
    const positionId = params.get('position');
    if (!orderId || !positionId) {
      showToast('Bestellung oder Position fehlt');
      return;
    }
    try {
      const order = await request(`/api/orders/${orderId}`);
      state.selectedOrder = order;
      const [spec, erpItems, tickets] = await Promise.all([
        request(`/api/specs/${orderId}/${positionId}`).catch(() => null),
        request('/api/erp/items'),
        request('/api/tickets')
      ]);
      state.techpackSpec = spec;
      state.erpItems = erpItems;
      state.tickets = tickets;
      await localizeTicketTitlesForSupplier(tickets);
      const orderLabel = document.getElementById('techpackListOrder');
      if (orderLabel) orderLabel.textContent = order.order_number || order.id;
      const posLabel = document.getElementById('techpackListPosition');
      if (posLabel) posLabel.textContent = positionId;
      const backButton = document.getElementById('backToBestellung');
      if (backButton) {
        backButton.addEventListener('click', () => {
          window.location.href = `/bestellung.html?order=${encodeURIComponent(order.id)}`;
        });
      }
      renderTechpackArticleCard(order, positionId);
      renderTechpackListTable(order, positionId, spec);
    } catch (err) {
      showToast(err.message);
    }
  }

  async function loadOrderDetail(orderId) {
    if (!orderId) return;
    try {
      const data = await request(`/api/orders/${orderId}`);
      state.selectedOrder = data;
      await localizeTicketTitlesForSupplier(data.tickets);
      applyOrderTickets(data.id, data.tickets || []);
      setText('orderNumber', data.order_number || '-');
      setText('orderDelivery', formatDate(data.requested_delivery));
      const totalQuantity = deriveOrderQuantity(data);
      setText('orderQuantity', `${totalQuantity}`);
      renderStatusControl(data);
      const shipping = data.shipping || {};
      const shippingPayerText =
        shipping.payer === 'KUNDE' ? translateTemplate('Kunde') : shipping.payer || '-';
      setText('shippingPayer', shippingPayerText);
      setText('shippingMethod', shipping.method || '-');
      setText('shippingPackaging', shipping.packaging || '-');
      const pickupKey = shipping.pickup
        ? 'Kunde holt Ware ab'
        : shipping.payer === 'KUNDE'
        ? 'Kunde beauftragt Versand'
        : 'BATE organisiert Versand';
      setText('shippingPickup', translateTemplate(pickupKey));
      const customer = state.customers.find((c) => c.id === data.customer_id);
      const deliveryAddress = getDeliveryAddress(data.customer_id, data);
      const billingAddress = getCustomerAddress(data.customer_id, 'rechnung') || getCustomerAddress(data.customer_id);
      const erpShippingAddress = getAddressById(data.shipping_address_id);
      const erpShippingDisplay = normalizeAddressDisplay(data.shipping_address_display);
      const dispatchAddressRecord = getAddressById(data.dispatch_address_id);
      const dispatchDisplay = normalizeSnapshotAddress(dispatchAddressRecord) || normalizeAddressDisplay(data.dispatch_address_display);
      const customerSnapshot = data.customer_snapshot || null;
      const snapshotShipping = normalizeSnapshotAddress(customerSnapshot?.shipping_address);
      const snapshotBilling = normalizeSnapshotAddress(customerSnapshot?.billing_address);
      const customerDisplayName =
        customerSnapshot?.name || data.customer_name || customer?.name || translateTemplate('Kunde');
      const deliveryDisplay = normalizeSnapshotAddress(erpShippingAddress) || erpShippingDisplay || snapshotShipping || deliveryAddress;
      const billingDisplay = snapshotBilling || billingAddress;
      const deliveryCompanyLabel =
        erpShippingAddress?.address_title ||
        customerSnapshot?.name ||
        deliveryAddress?.company ||
        data.customer_name ||
        '-';
      const dispatchAddress = dispatchDisplay || {
        street: dispatchAddressRecord?.street || 'Karlsruher Straße 71',
        city:
          dispatchAddressRecord && dispatchAddressRecord.zip && dispatchAddressRecord.city
            ? `${dispatchAddressRecord.zip} ${dispatchAddressRecord.city}`
            : dispatchAddressRecord?.city || dispatchAddressRecord?.zip || '75179 Pforzheim',
        country: dispatchAddressRecord?.country || 'Deutschland'
      };
      const senderNameValue =
        dispatchAddressRecord?.address_title ||
        data.supplier_name ||
        data.supplier_id ||
        'BATE GmbH';

      setText('deliveryCompany', deliveryCompanyLabel);
      setText('deliveryStreet', deliveryDisplay?.street || '-');
      setText('deliveryCity', deliveryDisplay?.city || '-');
      setText('deliveryCountry', deliveryDisplay?.country || '');
      const supplierEntry = getSupplierById(data.supplier_id);
      const supplierAddressRecord = getAddressById(data.supplier_address);
      const supplierDisplay =
        toPreviewAddress(supplierAddressRecord) ||
        normalizeAddressDisplay(data.supplier_address_display) ||
        (supplierEntry
          ? {
              street: supplierEntry.street,
              city: formatSupplierCityLine(supplierEntry),
              country: supplierEntry.country
            }
          : null);
      setText('supplierNameValue', supplierEntry?.name || data.supplier_name || data.supplier_id || '-');
      setText('supplierIdValue', data.supplier_id || '-');
      setText('supplierStreetValue', supplierDisplay?.street || '-');
      setText('supplierCityValue', supplierDisplay?.city || '-');
      setText('supplierCountryValue', supplierDisplay?.country || '');
      setText('customerNameValue', customerDisplayName);
      setText('customerStreet', billingDisplay?.street || '-');
      setText('customerCity', billingDisplay?.city || '-');
      setText('customerCountry', billingDisplay?.country || '');
      const taxValue = customerSnapshot?.tax_id || customer?.tax_id || translateTemplate('nicht hinterlegt');
      setText('customerTax', translateTemplate('Steuernummer: {{value}}', { value: taxValue }));
      setText('customerNumber', customerSnapshot?.id || data.customer_id || '-');
      setText('senderName', senderNameValue);
      setText('senderStreet', dispatchAddress?.street || '-');
      setText('senderCity', dispatchAddress?.city || '-');
      setText('senderCountry', dispatchAddress?.country || '');
      const contact = Array.isArray(state.contacts)
        ? state.contacts.find((c) => c.customer_id === data.customer_id)
        : null;
      setText('contactName', contact?.name || contact?.role || '-');
      setText('contactEmail', contact?.email || '-');
      setText('contactPhone', contact?.phone || '-');
      renderPositionsDetail(data);
      renderTotals(data);
      renderOrderTickets(data);
      bindOrderTicketForm(data.id);
      const labelButton = document.getElementById('openLabelManager');
      if (labelButton) {
        labelButton.onclick = () => {
          window.location.href = `/etiketten.html?order=${encodeURIComponent(data.id)}`;
        };
      }
      const shoeboxButton = document.getElementById('openShoeboxManager');
      if (shoeboxButton) {
        shoeboxButton.onclick = () => {
          window.location.href = `/schuhbox.html?order=${encodeURIComponent(data.id)}`;
        };
      }
      state.orderPrintOptions = null;
      bindPrintOptionEvents(data.id);
      loadOrderPrintOptions(data.id);
      const editButton = document.getElementById('editOrderBtn');
      if (editButton) {
        if (isInternalRole(state.user?.role)) {
          editButton.onclick = () => {
            window.location.href = `/bestellung-neu.html?order=${encodeURIComponent(data.id)}`;
          };
        } else {
          editButton.remove();
        }
      }
      const deleteButton = document.getElementById('deleteOrderBtn');
      if (deleteButton) {
        if (isInternalRole(state.user?.role)) {
          deleteButton.onclick = async () => {
            if (!window.confirm('Bestellung wirklich löschen?')) return;
            deleteButton.disabled = true;
            try {
              await request(`/api/orders/${encodeURIComponent(data.id)}`, { method: 'DELETE' });
              showToast('Bestellung gelöscht');
              window.location.href = '/bestellungen.html';
            } catch (err) {
              showToast(err.message);
              deleteButton.disabled = false;
            }
          };
        } else {
          deleteButton.remove();
        }
      }
      const ticketsBadge = document.getElementById('orderTicketsSummary');
      if (ticketsBadge) {
        ticketsBadge.style.cursor = 'pointer';
        ticketsBadge.onclick = () => {
          const target = document.getElementById('orderTicketsList');
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        };
      }
      state.timelineExpanded = false;
      renderTimeline(data.timeline || []);
      try {
        await refreshCustomerAccessories(data.customer_id, { force: true });
      } catch (accessoryError) {
        console.warn('Accessory data could not be loaded', accessoryError);
      }
    } catch (err) {
      showToast(err.message);
    }
  }

  function renderPositionsDetail(order) {
    const container = document.getElementById('positionsList');
    if (!container) return;
    if (!order.positions?.length) {
      container.innerHTML = '<p class="muted">Keine Positionen vorhanden.</p>';
      return;
    }
    const sizeColumns = deriveSizeList(order);
    const rows = order.positions
      .map((pos, index) => {
        const item = state.erpItems?.find((entry) => entry.item_code === pos.item_code);
        const viewerBase = item?.links?.viewer3d?.replace(/\/$/, '');
        const viewerImage = viewerBase ? `${viewerBase}/images/0001.webp` : null;
        const heroUrl = viewerImage || item?.media?.hero;
        const hero = heroUrl
          ? `<img src="${heroUrl}" alt="${item?.item_name || pos.item_code}" loading="lazy" />`
          : '<span class="muted">–</span>';
        const description = pos.description || item?.item_name || '';
        const codeMatch = description.match(/([A-Za-z]\d{3,})$/i);
        const baseNameRaw = codeMatch ? description.replace(new RegExp(`\\s*${codeMatch[1]}$`, 'i'), '').trim() : description;
        const displayName = baseNameRaw ? baseNameRaw.toUpperCase() : description || '-';
        const colorCode = resolvePositionColorCode(order, pos, item);
        const priceEntry = item?.prices?.[0];
        const unitPrice = priceEntry?.amount || 0;
        const singlePrice = formatMoney(unitPrice, priceEntry?.currency || order.currency);
        const totalPrice = formatMoney(unitPrice * (pos.quantity || 0), priceEntry?.currency || order.currency);
        const sizeCells = sizeColumns.map((size) => {
          const count = pos.size_breakdown?.[size] ?? '';
          return `<td>${count || ''}</td>`;
        }).join('');
        const specLink = `/techpack-list.html?order=${encodeURIComponent(order.id)}&position=${encodeURIComponent(
          pos.position_id
        )}`;
        const artikelLink = `/artikel.html?item=${encodeURIComponent(pos.item_code)}`;
        return `
        <tr>
          <td>${index + 1}</td>
          <td>
            <p>${pos.item_code || '-'}</p>
            <p>Farbcode: ${colorCode || '-'}</p>
            <p>${displayName || '-'}</p>
          </td>
          <td class="position-image">${hero}</td>
          ${sizeCells}
          <td>${pos.quantity}</td>
          <td>${singlePrice}</td>
          <td>${totalPrice}</td>
          <td class="spec-link-cell"><a class="ghost" href="${specLink}" target="_blank" rel="noopener">Artikelspezifikation</a></td>
          <td class="spec-link-cell"><a class="ghost" href="${artikelLink}" target="_blank" rel="noopener">Artikel öffnen</a></td>
        </tr>`;
      })
      .join('');
    container.innerHTML = `
      <table class="position-grid">
        <thead>
          <tr>
            <th rowspan="2">Pos.</th>
            <th rowspan="2">Artikeldetails</th>
            <th rowspan="2">Artikelbild</th>
            <th colspan="${sizeColumns.length}">Größen</th>
            <th rowspan="2">Menge</th>
            <th rowspan="2">Einzelpreis</th>
            <th rowspan="2">Gesamtpreis</th>
            <th rowspan="2">Tech Pack</th>
            <th rowspan="2">Artikel</th>
          </tr>
          <tr class="size-header">
          ${sizeColumns.map((size) => `<th>${size}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>`;
  }

  function renderTotals(order) {
    const net = deriveOrderTotal(order) || 0;
    const tax = net * VAT_RATE;
    const gross = net + tax;
    document.getElementById('netAmount').textContent = formatMoney(net, order.currency);
    document.getElementById('taxAmount').textContent = formatMoney(tax, order.currency);
    document.getElementById('grossAmount').textContent = formatMoney(gross, order.currency);
  }

  function renderTimeline(entries = []) {
    const container = document.getElementById('timeline');
    if (!container) return;
    state.timelineEntries = entries;
    if (!entries.length) {
      container.innerHTML = '<p class="muted">Keine Timeline-Einträge</p>';
      return;
    }
    const visibleEntries = state.timelineExpanded || entries.length === 1 ? entries : [entries[entries.length - 1]];
    const listHtml = visibleEntries.map(buildTimelineEntry).join('');
    const toggleNeeded = entries.length > 1;
    const toggleHtml = toggleNeeded
      ? `<button type="button" class="ghost" id="timelineToggle">${state.timelineExpanded ? 'Weniger anzeigen' : 'Mehr anzeigen'}</button>`
      : '';
    container.innerHTML = listHtml + toggleHtml;
    if (toggleNeeded) {
      const toggle = document.getElementById('timelineToggle');
      if (toggle) {
        toggle.addEventListener('click', () => {
          state.timelineExpanded = !state.timelineExpanded;
          renderTimeline(state.timelineEntries);
        });
      }
    }
  }

  function buildTimelineEntry(entry) {
    return `<div><strong>${entry.status_label || entry.status || entry.type}</strong><br /><small>${new Date(
      entry.created_at
    ).toLocaleString('de-DE')}</small><p>${entry.message || ''}</p></div>`;
  }

  function renderTechpackMedia(position, spec) {
    const media = spec.flags?.medien || [];
    ensureTechpackActiveMedia(spec);
    const stageImg = document.getElementById('techpackMainImage');
    const hint = document.querySelector('.techpack-overlay-hint');
    const stage = document.getElementById('techpackMediaStage');
    if (!stageImg) return;
    const activeEntry = getActiveTechpackMedia();
    updateTechpackStatusDisplay(activeEntry);
    renderTechpackStage(media, activeEntry, stageImg, hint, stage);
    renderTechpackAnnotations();
  }

  function renderTechpackStage(media, activeMedia, stageImg, hint, stage) {
    if (!activeMedia) {
      if (stage) stage.classList.add('techpack-stage-empty');
      stageImg.src = '';
      stageImg.srcset = '';
      stageImg.alt = 'Bitte Ansicht wählen';
      if (hint) hint.textContent = 'Bitte eine Ansicht auswählen.';
      return;
    }
    const isPlaceholder = Boolean(activeMedia.isPlaceholder || activeMedia.is_placeholder);
    if (stage) stage.classList.remove('techpack-stage-empty');
    if (isPlaceholder) {
      stageImg.src = activeMedia.url || activeMedia.placeholderSrc || '';
      stageImg.srcset = activeMedia.placeholderSrcset || '';
      stageImg.alt = activeMedia.label || 'Platzhalter';
      if (hint) hint.textContent = 'Klicke ins Bild, um einen Pin zu setzen';
      return;
    }
    stageImg.src = activeMedia.url || '';
    stageImg.srcset = '';
    stageImg.alt = activeMedia.label || activeMedia.id || 'Artikelspezifikation';
    if (hint) hint.textContent = 'Klicke ins Bild, um einen Pin zu setzen';
  }

  function renderTechpackAnnotations() {
    const layer = document.getElementById('techpackAnnotationLayer');
    const list = document.getElementById('techpackAnnotationList');
    if (!layer || !list) return;
    if (!state.techpackActiveMedia) {
      layer.innerHTML = '';
      list.innerHTML = '<li class="muted">Bitte Ansicht auswählen und Bild hochladen.</li>';
      return;
    }
    const annotations = (state.techpackSpec?.annotations || []).filter(
      (ann) => ann.media_id === state.techpackActiveMedia
    );
    layer.innerHTML = annotations
      .map(
        (ann, idx) =>
          `<button type="button" data-index="${idx}" style="left:${ann.x * 100}%;top:${ann.y * 100}%" title="${escapeHtml(
            ann.note
          )}">${idx + 1}</button>`
      )
      .join('');
    list.innerHTML =
      annotations
        .map(
          (ann, idx) =>
            `<li data-pin="${idx + 1}">
              <span class="annotation-pin">${idx + 1}</span>
              <div class="annotation-body">
                <p>${escapeHtml(ann.note)}</p>
                <small>${escapeHtml(ann.author)} · ${new Date(ann.ts).toLocaleString('de-DE')}</small>
              </div>
              <button type="button" class="ghost small danger" data-delete-annotation="${ann.id}">Entfernen</button>
            </li>`
        )
        .join('') || '<li class="muted">Keine Annotationen</li>';
    list.querySelectorAll('button[data-delete-annotation]').forEach((button) => {
      button.addEventListener('click', async () => {
        const annotationId = button.dataset.deleteAnnotation;
        if (!annotationId) return;
        const confirmDelete = window.confirm('Annotation wirklich löschen?');
        if (!confirmDelete) return;
        try {
          await deleteTechpackAnnotation(annotationId);
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  }

  function renderTechpackListTable(order, positionId, spec) {
    const body = document.getElementById('techpackListBody');
    if (!body) return;
    const mediaList = spec?.flags?.medien || [];
    const rows = TECHPACK_VIEWS.map((view) => {
      const media = mediaList.find((entry) => entry.view_key === view.key);
      const questionCount = getOpenTicketCount(order.id, positionId, view.key);
      const hasQuestions = questionCount > 0;
      const statusMeta =
        media && !hasQuestions ? TECHPACK_MEDIA_STATUS[media.status] || TECHPACK_MEDIA_STATUS.OPEN : TECHPACK_MEDIA_STATUS.OPEN;
      const statusBadge = `<span class="badge ${statusMeta.badgeClass}">${statusMeta.label}</span>`;
      const preview = media
        ? `<img src="${media.url}" alt="${escapeHtml(media.label || view.label)}" class="techpack-preview" />`
        : getTechpackPreviewPlaceholder(view);
      const questionBadge = hasQuestions
        ? `<span class="question-badge question-open"><span class="dot">?</span><span class="count">${questionCount}</span></span>`
        : '<span class="question-badge question-closed"><span class="dot">✓</span><span class="count">0</span></span>';
      const detailUrl = `/techpack.html?order=${encodeURIComponent(order.id)}&position=${encodeURIComponent(
        positionId
      )}&view=${encodeURIComponent(view.key)}`;
      return `
        <tr>
          <td>${view.position}</td>
          <td>${statusBadge}</td>
          <td>${escapeHtml(view.label)}</td>
          <td class="techpack-preview-cell">${preview}</td>
          <td>${questionBadge}</td>
          <td><a class="ghost" href="${detailUrl}">Öffnen</a></td>
        </tr>`;
    }).join('');
    body.innerHTML = rows;
  }

  function ticketMatchesView(ticket, viewKey) {
    if (!viewKey) return !ticket.view_key;
    if (!ticket.view_key) return false;
    return ticket.view_key === viewKey;
  }

  function renderTechpackTickets(orderId, positionId, viewKey = resolveActiveViewKey()) {
    const list = document.getElementById('techpackTickets');
    const badge = document.getElementById('ticketsCountBadge');
    if (!list) return;
    const effectiveView = viewKey || resolveActiveViewKey();
    const hasViewFilter = Boolean(effectiveView);
    const tickets = (state.tickets || []).filter(
      (ticket) =>
        ticket.order_id === orderId &&
        ticket.position_id === positionId &&
        (!hasViewFilter || ticketMatchesView(ticket, effectiveView))
    );
    const dateLocale = state.locale === 'tr' ? 'tr-TR' : 'de-DE';
    if (badge) badge.textContent = tickets.length.toString();
    if (!tickets.length) {
      list.innerHTML = `<p class="muted">${escapeHtml(translateTemplate('Noch keine Tickets.'))}</p>`;
      return;
    }
    list.innerHTML = tickets
      .map((ticket) => {
        const ticketKey = buildOrderTicketKey(ticket);
        const isOpen = ticket.status !== 'CLOSED';
        const statusLabel = translateTemplate(isOpen ? 'Offen' : 'OK');
        const statusBadge = `<span class="badge ${isOpen ? 'warning' : 'success'}">${escapeHtml(statusLabel)}</span>`;
    const viewLabel = ticket.view_key ? getTechpackViewLabel(ticket.view_key) : translateTemplate('Allgemein');
    const viewBadge = `<span class="badge ghost">${escapeHtml(viewLabel)}</span>`;
        const comments = renderTicketCommentsHtml(ticket);
        const priorityLabel = formatTicketPriority(ticket.priority);
        const created = ticket.created_at ? new Date(ticket.created_at).toLocaleDateString(dateLocale) : '';
        const closeLabel = translateTemplate('Als geklärt markieren');
        const reopenLabel = translateTemplate('Wieder öffnen');
        const deleteLabel = translateTemplate('Löschen');
        return `
          <article class="ticket-card collapsed" data-ticket="${ticket.id}" data-ticket-created="${ticket.created_at || ''}" data-ticket-key="${ticketKey}">
            <div class="ticket-header" data-ticket-toggle="${ticket.id}" data-ticket-created="${ticket.created_at || ''}" data-ticket-key="${ticketKey}">
              <div class="ticket-header-info">
                <strong>${escapeHtml(resolveTicketTitle(ticket))}</strong>
                <small>${escapeHtml(ticket.id)} · ${escapeHtml(priorityLabel)}${created ? ` · ${escapeHtml(created)}` : ''}</small>
              </div>
              <div class="ticket-header-meta">
                <div class="ticket-meta-badges">
                  ${viewBadge}
                  ${statusBadge}
                </div>
                <div class="ticket-header-actions">
                  <button type="button" class="ghost small" data-ticket-action="${isOpen ? 'close' : 'reopen'}" data-ticket-id="${ticket.id}" data-ticket-created="${ticket.created_at || ''}" data-ticket-key="${ticketKey}">
                    ${escapeHtml(isOpen ? closeLabel : reopenLabel)}
                  </button>
                  <button type="button" class="ghost small danger" data-ticket-delete="${ticket.id}" data-ticket-created="${ticket.created_at || ''}" data-ticket-key="${ticketKey}">${escapeHtml(deleteLabel)}</button>
                </div>
                <span class="chevron">⌄</span>
              </div>
            </div>
            <div class="ticket-body">
              <div class="ticket-meta">
                <div class="tickets-container ticket-comments">
                  ${comments}
                </div>
                <form class="ticket-comment-form" data-ticket-id="${ticket.id}" data-ticket-created="${ticket.created_at || ''}" data-ticket-key="${ticketKey}">
                  ${buildCommentFormFields()}
                  <div class="ticket-comment-actions">
                    ${buildAutoTranslateButton()}
                    <label class="file-input small">
                      <span class="file-label">${escapeHtml(translateTemplate('Datei'))}</span>
                      <span class="file-name" data-file-name>${escapeHtml(translateTemplate('Keine Datei ausgewählt'))}</span>
                      <input type="file" name="files" accept="image/*,application/pdf,.zip,.doc,.docx" multiple data-file-input />
                    </label>
                    <button type="submit" class="small">${escapeHtml(translateTemplate('Antwort senden'))}</button>
                  </div>
                  <div class="comment-file-list" data-file-list hidden></div>
                </form>
              </div>
            </div>
          </article>`;
      })
      .join('');
    list.querySelectorAll('button[data-ticket-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const { ticketId, ticketAction, ticketCreated, ticketKey } = button.dataset;
        if (!ticketId || !ticketAction) return;
        const nextStatus = ticketAction === 'close' ? 'CLOSED' : 'OPEN';
        await updateTicketStatus(ticketId, nextStatus, {
          type: 'techpack',
          orderId,
          positionId,
          viewKey: effectiveView,
          createdAt: ticketCreated,
          ticketKey
        });
      });
    });
    list.querySelectorAll('button[data-ticket-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        const ticketId = button.dataset.ticketDelete;
        const ticketCreated = button.dataset.ticketCreated;
        const ticketKey = button.dataset.ticketKey;
        if (!ticketId) return;
        if (!window.confirm(translateTemplate('Ticket wirklich löschen?'))) return;
        try {
          await deleteTicket(ticketId, { orderId, positionId, createdAt: ticketCreated, ticketKey });
          renderTechpackTickets(orderId, positionId, effectiveView);
          updateTechpackStatusDisplay(getActiveTechpackMedia());
        } catch (err) {
          showToast(err.message);
        }
      });
    });
    list.querySelectorAll('button[data-comment-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        const commentId = button.dataset.commentDelete;
        const ticketId = button.dataset.ticket;
        const ticketCreated = button.dataset.ticketCreated;
        const ticketKey = button.dataset.ticketKey;
        if (!commentId || !ticketId) return;
        if (!window.confirm(translateTemplate('Kommentar wirklich löschen?'))) return;
        try {
          await deleteTicketComment(ticketId, commentId, { orderId, positionId, createdAt: ticketCreated, ticketKey });
          renderTechpackTickets(orderId, positionId, effectiveView);
        } catch (err) {
          showToast(err.message);
        }
      });
    });
    list.querySelectorAll('[data-ticket-toggle]').forEach((header) => {
      header.addEventListener('click', (event) => {
        const card = header.closest('.ticket-card');
        if (!card) return;
        if (event.target.closest('button')) return;
        card.classList.toggle('collapsed');
      });
    });
    bindTicketCommentForms(orderId, positionId, effectiveView);
    focusTechpackTicketIfNeeded();
  }

  function resolveTicketCommentText(comment) {
    if (!comment) return '';
    const preferred = isInternalRole(state.user?.role) ? 'de' : 'tr';
    if (preferred === 'de') {
      return comment.message_de || comment.message || comment.message_tr || '';
    }
    return comment.message_tr || comment.message || comment.message_de || '';
  }

  function renderCommentTextBlocks(comment) {
    const isSupplier = isSupplierRole(state.user?.role);
    const textDe = comment?.message_de || comment?.message || '';
    const textTr = comment?.message_tr || '';
    if (isSupplier) {
      const text = textTr || textDe;
      return text ? `<p>${escapeHtml(text)}</p>` : '';
    }
    const blocks = [];
    if (textDe) {
      blocks.push(`<p class="comment-lang-line"><span class="comment-lang-tag">DE</span>${escapeHtml(textDe)}</p>`);
    }
    if (textTr) {
      blocks.push(`<p class="comment-lang-line"><span class="comment-lang-tag">TR</span>${escapeHtml(textTr)}</p>`);
    }
    if (!blocks.length) {
      blocks.push(`<p>${escapeHtml(textDe || textTr || '')}</p>`);
    }
    return blocks.join('');
  }

  function getFormPendingFiles(form) {
    if (!form) return [];
    if (!Array.isArray(form._pendingFiles)) {
      form._pendingFiles = [];
    }
    return form._pendingFiles;
  }

  function renderPendingFiles(form) {
    const list = form?.querySelector('[data-file-list]');
    if (!form || !list) return;
    const pending = getFormPendingFiles(form);
    if (!pending.length) {
      list.innerHTML = '';
      list.hidden = true;
      const fileNameDisplay = form.querySelector('[data-file-name]');
      if (fileNameDisplay) {
        fileNameDisplay.textContent = translateTemplate('Keine Datei ausgewählt');
      }
      return;
    }
    list.hidden = false;
    list.innerHTML = pending
      .map(
        (file, index) => `
      <span class="comment-file-chip">
        ${escapeHtml(file.name)}
        <button type="button" class="comment-file-remove" data-file-remove="${index}" aria-label="Datei entfernen">×</button>
      </span>`
      )
      .join('');
    list.querySelectorAll('[data-file-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        const idx = Number(button.dataset.fileRemove);
        const files = getFormPendingFiles(form);
        if (Number.isInteger(idx)) {
          files.splice(idx, 1);
          renderPendingFiles(form);
        }
      });
    });
    const fileNameDisplay = form.querySelector('[data-file-name]');
    if (fileNameDisplay) {
      fileNameDisplay.textContent = translateTemplate('{{count}} Datei(en) ausgewählt', { count: pending.length });
    }
  }

  function bindCommentFileInput(form) {
    if (!form) return;
    const fileInput = form.querySelector('[data-file-input]');
    if (!fileInput || fileInput.dataset.bound === 'true') return;
    fileInput.dataset.bound = 'true';
    fileInput.addEventListener('change', () => {
      const files = Array.from(fileInput.files || []);
      if (!files.length) return;
      const pending = getFormPendingFiles(form);
      pending.push(...files);
      fileInput.value = '';
      renderPendingFiles(form);
    });
    renderPendingFiles(form);
  }

  function buildCommentFormFields() {
    const placeholderDe = translateTemplate('Text (Deutsch)');
    const placeholderTr = translateTemplate('Text (Türkisch)');
    const isSupplier = isSupplierRole(state.user?.role);
    const trField = `
        <label class="translation-field">
          <span class="lang-label">TR</span>
          <textarea name="message_tr" rows="2" placeholder="${escapeHtml(placeholderTr)}"></textarea>
        </label>`;
    if (isSupplier) {
      return `
      <div class="comment-fields translation-single">
        ${trField}
        <input type="hidden" name="message_de" />
      </div>`;
    }
    return `
      <div class="comment-fields translation-pair">
        <label class="translation-field">
          <span class="lang-label">DE</span>
          <textarea name="message_de" rows="2" placeholder="${escapeHtml(placeholderDe)}"></textarea>
        </label>
        ${trField}
      </div>`;
  }

  function buildAutoTranslateButton() {
    if (isSupplierRole(state.user?.role)) return '';
    return `<button type="button" class="ghost small auto-translate-btn">${escapeHtml(translateTemplate('Automatisch übersetzen'))}</button>`;
  }

  async function localizeTicketTitlesForSupplier(tickets) {
    if (!isSupplierRole(state.user?.role)) return;
    if (!Array.isArray(tickets) || !tickets.length) return;
    const jobs = [];
    tickets.forEach((ticket) => {
      if (!ticket || ticket.title_tr || !ticket.title) return;
      const cacheKey = ticket.id || ticket.title;
      if (titleTranslationCache.has(cacheKey)) {
        ticket.title_tr = titleTranslationCache.get(cacheKey);
        return;
      }
      const text = ticket.title;
      jobs.push(
        request('/api/translate', {
          method: 'POST',
          body: {
            text,
            source: 'de',
            target: 'tr'
          }
        })
          .then((response) => {
            const translation = response?.translation || response?.text || text;
            titleTranslationCache.set(cacheKey, translation);
            ticket.title_tr = translation;
          })
          .catch(() => {
            ticket.title_tr = text;
          })
      );
    });
    if (jobs.length) {
      await Promise.allSettled(jobs);
    }
  }

  async function ensureSupplierAutoTranslation(payload) {
    if (!payload || !isSupplierRole(state.user?.role)) return payload;
    const sourceText = payload.message_tr?.trim();
    if (!sourceText || payload.message_de) return payload;
    try {
      const response = await request('/api/translate', {
        method: 'POST',
        body: {
          text: sourceText,
          source: 'tr',
          target: 'de'
        }
      });
      payload.message_de = response?.translation || response?.text || '';
    } catch (err) {
      console.warn('Automatische Übersetzung fehlgeschlagen', err.message);
    }
    return payload;
  }

  function formatTicketTimestamp(locale, value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function renderTicketCommentsHtml(ticket) {
    const dateLocale = state.locale === 'tr' ? 'tr-TR' : 'de-DE';
    const attachmentLinkLabel = translateTemplate('Anhang anzeigen');
    const attachmentAlt = translateTemplate('Anhang');
    const unknownAuthor = translateTemplate('Unbekannt');
    const noComments = translateTemplate('Noch keine Antworten.');
    const comments = (ticket.comments || [])
      .map((comment) => {
        const attachments = Array.isArray(comment.attachments)
          ? comment.attachments
          : comment.attachment
          ? [comment.attachment]
          : [];
        const isMine = comment.author === state.user?.email;
        const timestamp = formatTicketTimestamp(dateLocale, comment.ts);
        const body = renderCommentTextBlocks(comment);
        const author = comment.author_name || comment.author || unknownAuthor;
        const bubbleClass = `ticket-bubble ${isMine ? 'mine' : 'other'}`;
        const attachmentMarkup = attachments
          .map((file) => {
            const isImage = /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(file?.filename || file?.url || '');
            const preview = isImage
              ? `<img src="${escapeHtml(file.url)}" alt="${escapeHtml(attachmentAlt)}" class="ticket-attachment-preview" />`
              : '';
            return `
              <div class="ticket-attachment">
                ${preview}
                <div class="attachment-link">
                  <a href="${escapeHtml(file.url)}" target="_blank" rel="noopener">${escapeHtml(attachmentLinkLabel)}</a>
                </div>
              </div>`;
          })
          .join('');
        return `<div class="ticket-message-row ${isMine ? 'outgoing' : 'incoming'}">
          <div class="${bubbleClass}">
            <div class="comment-content">
              <p><strong>${escapeHtml(author)}</strong>${timestamp ? ` · ${timestamp}` : ''}</p>
              ${body}
              ${attachmentMarkup}
            </div>
            <button type="button" class="ghost small danger" data-comment-delete="${comment.id}" data-ticket="${ticket.id}" data-ticket-created="${comment.created_at || comment.ts || ''}" data-ticket-key="${buildOrderTicketKey(ticket)}">${escapeHtml(
              translateTemplate('Löschen')
            )}</button>
          </div>
        </div>`;
      })
      .join('');
    return comments || `<div class="muted">${escapeHtml(noComments)}</div>`;
  }

  function resolveTicketTitle(ticket) {
    if (!ticket) return '';
    if (isSupplierRole(state.user?.role)) {
      return ticket.title_tr || ticket.title || '';
    }
    return ticket.title || '';
  }

  function applyOrderTickets(orderId, tickets = []) {
    if (!orderId) return [];
    const orderSpecific = (tickets || []).filter((ticket) => ticket.order_id === orderId);
    const otherTickets = (state.tickets || []).filter((ticket) => ticket.order_id !== orderId);
    state.tickets = [...otherTickets, ...orderSpecific];
    state.orderTickets = orderSpecific.filter((ticket) => !ticket.position_id);
    return orderSpecific;
  }

  async function refreshOrderTickets(orderId) {
    if (!orderId) return [];
    const tickets = await request(`/api/orders/${encodeURIComponent(orderId)}/tickets`);
    await localizeTicketTitlesForSupplier(tickets);
    applyOrderTickets(orderId, tickets);
    return tickets;
  }

  function renderOrderTicketSummary(order = state.selectedOrder) {
    const badge = document.getElementById('orderTicketsSummary');
    if (!badge || !order) return;
    const openCount = (state.orderTickets || []).filter(
      (ticket) => ticket.order_id === order.id && ticket.status !== 'CLOSED'
    ).length;
    const hasOpen = openCount > 0;
    badge.className = `question-badge ${hasOpen ? 'question-open' : 'question-closed'}`;
    badge.innerHTML = `<span class="dot">${hasOpen ? '?' : '✓'}</span><span class="count">${openCount}</span>`;
    badge.title = hasOpen
      ? translateTemplate('{{count}} offene Tickets', { count: openCount })
      : translateTemplate('Keine offenen Tickets');
  }

  function getTicketContextLabel(ticket) {
    const baseLabel = ticket.position_id ? ticket.position_id : translateTemplate('Bestellung');
    if (ticket.view_key) {
      return `${baseLabel} · ${getTechpackViewLabel(ticket.view_key)}`;
    }
    return baseLabel;
  }

  function formatTicketPriority(priority) {
    const normalized = (priority || '').toLowerCase();
    if (normalized === 'hoch') return translateTemplate('Hoch');
    if (normalized === 'niedrig') return translateTemplate('Niedrig');
    return translateTemplate('Mittel');
  }

  function getOrderComposerElements() {
    return {
      form: document.getElementById('orderTicketForm'),
      toggle: document.getElementById('toggleOrderComposer')
    };
  }

  function setOrderComposerVisibility(visible) {
    const { form, toggle } = getOrderComposerElements();
    if (!form) return;
    form.classList.toggle('is-hidden', !visible);
    if (toggle) {
      toggle.classList.toggle('active', visible);
      toggle.setAttribute('aria-expanded', visible ? 'true' : 'false');
    }
  }

  function setOrderComposerEnabled(enabled) {
    const { toggle } = getOrderComposerElements();
    if (!toggle) return;
    toggle.disabled = !enabled;
    toggle.classList.toggle('disabled', !enabled);
    if (!enabled) {
      setOrderComposerVisibility(false);
    }
  }

  function renderOrderTickets(order = state.selectedOrder) {
    const list = document.getElementById('orderTicketsList');
    const badge = document.getElementById('orderTicketsCount');
    if (!list || !order) return;
    const tickets = (state.orderTickets || []).filter((ticket) => ticket.order_id === order.id);
    const dateLocale = state.locale === 'tr' ? 'tr-TR' : 'de-DE';
    if (badge) badge.textContent = tickets.length.toString();
    if (!tickets.length) {
      list.innerHTML = `<p class="muted">${escapeHtml(translateTemplate('Noch keine Tickets.'))}</p>`;
      return;
    }
    list.innerHTML = tickets
      .map((ticket) => {
        const ticketKey = buildOrderTicketKey(ticket);
        const isOpen = ticket.status !== 'CLOSED';
        const statusLabel = translateTemplate(isOpen ? 'Offen' : 'OK');
        const statusBadge = `<span class="badge ${isOpen ? 'warning' : 'success'}">${escapeHtml(statusLabel)}</span>`;
        const contextBadge = `<span class="badge ghost">${escapeHtml(getTicketContextLabel(ticket))}</span>`;
        const comments = renderTicketCommentsHtml(ticket);
        const priorityLabel = formatTicketPriority(ticket.priority);
        const created = ticket.created_at ? new Date(ticket.created_at).toLocaleDateString(dateLocale) : '';
        const closeLabel = translateTemplate('Als geklärt markieren');
        const reopenLabel = translateTemplate('Wieder öffnen');
        const deleteLabel = translateTemplate('Löschen');
        return `
          <article class="ticket-card collapsed" data-ticket="${ticket.id}" data-ticket-created="${ticket.created_at || ''}" data-ticket-key="${ticketKey}">
            <div class="ticket-header" data-ticket-toggle="${ticket.id}" data-ticket-created="${ticket.created_at || ''}" data-ticket-key="${ticketKey}">
              <div class="ticket-header-info">
                <strong>${escapeHtml(resolveTicketTitle(ticket))}</strong>
                <small>${escapeHtml(ticket.id)} · ${escapeHtml(priorityLabel)}${created ? ` · ${escapeHtml(created)}` : ''}</small>
              </div>
          <div class="ticket-header-meta">
            <div class="ticket-meta-badges">
              ${contextBadge}
              ${statusBadge}
            </div>
            <div class="ticket-header-actions">
              <button type="button" class="ghost small" data-ticket-action="${isOpen ? 'close' : 'reopen'}" data-ticket-id="${ticket.id}" data-ticket-created="${ticket.created_at || ''}" data-ticket-key="${ticketKey}">
                ${escapeHtml(isOpen ? closeLabel : reopenLabel)}
              </button>
              <button type="button" class="ghost small danger" data-ticket-delete="${ticket.id}" data-ticket-created="${ticket.created_at || ''}" data-ticket-key="${ticketKey}">${escapeHtml(deleteLabel)}</button>
            </div>
            <span class="chevron">⌄</span>
          </div>
        </div>
        <div class="ticket-body">
              <div class="ticket-meta">
                <div class="tickets-container ticket-comments">
                  ${comments}
                </div>
                <form class="ticket-comment-form" data-ticket-id="${ticket.id}" data-ticket-created="${ticket.created_at || ''}" data-ticket-key="${ticketKey}">
                  ${buildCommentFormFields()}
                  <div class="ticket-comment-actions">
                    ${buildAutoTranslateButton()}
                    <label class="file-input small">
                      <span class="file-label">${escapeHtml(translateTemplate('Datei'))}</span>
                      <span class="file-name" data-file-name>${escapeHtml(translateTemplate('Keine Datei ausgewählt'))}</span>
                      <input type="file" name="files" accept="image/*,application/pdf,.zip,.doc,.docx" multiple data-file-input />
                    </label>
                    <button type="submit" class="small">${escapeHtml(translateTemplate('Antwort senden'))}</button>
                  </div>
                  <div class="comment-file-list" data-file-list hidden></div>
                </form>
              </div>
            </div>
          </article>`;
      })
      .join('');
    list.querySelectorAll('button[data-ticket-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const { ticketId, ticketAction, ticketCreated, ticketKey } = button.dataset;
        if (!ticketId || !ticketAction) return;
        const nextStatus = ticketAction === 'close' ? 'CLOSED' : 'OPEN';
        await updateTicketStatus(ticketId, nextStatus, { type: 'order', orderId: order.id, positionId: null, createdAt: ticketCreated, ticketKey });
      });
    });
    list.querySelectorAll('button[data-ticket-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        const ticketId = button.dataset.ticketDelete;
        const ticketCreated = button.dataset.ticketCreated;
        const ticketKey = button.dataset.ticketKey;
        if (!ticketId) return;
        if (!window.confirm(translateTemplate('Ticket wirklich löschen?'))) return;
        try {
          await deleteTicket(ticketId, { orderId: order.id, positionId: null, createdAt: ticketCreated, ticketKey });
          renderOrderTickets(order);
        } catch (err) {
          showToast(err.message);
        }
      });
    });
    list.querySelectorAll('button[data-comment-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        const commentId = button.dataset.commentDelete;
        const ticketId = button.dataset.ticket;
        const ticketCreated = button.dataset.ticketCreated;
        const ticketKey = button.dataset.ticketKey;
        if (!commentId || !ticketId) return;
        if (!window.confirm(translateTemplate('Kommentar wirklich löschen?'))) return;
        try {
          await deleteTicketComment(ticketId, commentId, { orderId: order.id, positionId: null, createdAt: ticketCreated, ticketKey });
          renderOrderTickets(order);
        } catch (err) {
          showToast(err.message);
        }
      });
    });
    list.querySelectorAll('[data-ticket-toggle]').forEach((header) => {
      header.addEventListener('click', (event) => {
        const card = header.closest('.ticket-card');
        if (!card) return;
        if (event.target.closest('button')) return;
        card.classList.toggle('collapsed');
        const hasOpen = Boolean(list.querySelector('.ticket-card:not(.collapsed)'));
        setOrderComposerEnabled(!hasOpen);
      });
    });
    bindOrderTicketCommentForms(order.id);
    renderOrderTicketSummary(order);
    const hasOpen = Boolean(list.querySelector('.ticket-card:not(.collapsed)'));
    setOrderComposerEnabled(!hasOpen);
    focusOrderTicketIfNeeded();
  }

  function focusOrderTicketIfNeeded() {
    const targetTicketId = state.ticketFocusId;
    if (!targetTicketId) return;
    const list = document.getElementById('orderTicketsList');
    const section = document.querySelector('.order-tickets-card');
    if (!list && !section) {
      state.ticketFocusId = null;
      return;
    }
    const selector = buildTicketDataSelector(targetTicketId);
    const targetCard = selector && list ? list.querySelector(selector) : null;
    const scrollTarget = targetCard || section;
    if (targetCard) {
      targetCard.classList.remove('collapsed');
      targetCard.classList.add('ticket-focus');
      setOrderComposerEnabled(false);
      window.setTimeout(() => {
        targetCard.classList.remove('ticket-focus');
      }, 3500);
    }
    if (scrollTarget) {
      const scheduleScroll =
        typeof window.requestAnimationFrame === 'function'
          ? window.requestAnimationFrame.bind(window)
          : (callback) => window.setTimeout(callback, 0);
      scheduleScroll(() => {
        scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    state.ticketFocusId = null;
  }

  function buildTicketDataSelector(ticketId) {
    if (!ticketId) return null;
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return `[data-ticket="${CSS.escape(ticketId)}"]`;
    }
    return `[data-ticket="${String(ticketId).replace(/["\\]/g, '\\$&')}"]`;
  }

  function focusTechpackTicketIfNeeded() {
    const targetTicketId = state.ticketFocusId;
    if (!targetTicketId) return;
    const list = document.getElementById('techpackTickets');
    const section = document.querySelector('#techpack .tickets-card') || document.querySelector('.tickets-card');
    if (!list && !section) {
      state.ticketFocusId = null;
      return;
    }
    const selector = buildTicketDataSelector(targetTicketId);
    const targetCard = selector && list ? list.querySelector(selector) : null;
    const scrollTarget = targetCard || section;
    if (targetCard) {
      targetCard.classList.remove('collapsed');
      targetCard.classList.add('ticket-focus');
      window.setTimeout(() => {
        targetCard.classList.remove('ticket-focus');
      }, 3500);
    }
    if (scrollTarget) {
      const scheduleScroll =
        typeof window.requestAnimationFrame === 'function'
          ? window.requestAnimationFrame.bind(window)
          : (callback) => window.setTimeout(callback, 0);
      scheduleScroll(() => {
        scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    state.ticketFocusId = null;
  }

  function bindOrderTicketCommentForms(orderId) {
    document.querySelectorAll('#orderTicketsList .ticket-comment-form').forEach((form) => {
      if (form.dataset.bound === 'true') return;
      form.dataset.bound = 'true';
      bindCommentFileInput(form);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const ticketId = form.dataset.ticketId;
        const ticketCreated = form.dataset.ticketCreated;
        const ticketKey = form.dataset.ticketKey;
        if (!ticketId) return;
        const payload = collectCommentPayload(form);
        if (!payload) return;
        await ensureSupplierAutoTranslation(payload);
        try {
          await submitTicketComment(ticketId, payload, { orderId, positionId: null, createdAt: ticketCreated, ticketKey });
          form.reset();
          form._pendingFiles = [];
          renderPendingFiles(form);
          renderOrderTickets(state.selectedOrder || { id: orderId });
          showToast('Antwort gespeichert');
        } catch (err) {
          showToast(err.message);
        }
      });
      const autoBtn = form.querySelector('.auto-translate-btn');
      if (autoBtn && autoBtn.dataset.bound !== 'true') {
        autoBtn.dataset.bound = 'true';
        autoBtn.addEventListener('click', async () => {
          await handleAutoTranslate(form, autoBtn);
        });
      }
    });
  }

  function bindOrderTicketForm(orderId) {
    const form = document.getElementById('orderTicketForm');
    if (!form) return;
    form.dataset.orderId = orderId;
    if (form.dataset.bound === 'true') return;
    bindCommentFileInput(form);

    const initialCommentContainer = document.getElementById('orderTicketInitialComment');
    if (initialCommentContainer && initialCommentContainer.dataset.hydrated !== 'true') {
      initialCommentContainer.innerHTML = `
        <div class="ticket-comment-form initial">
          ${buildCommentFormFields()}
        </div>`;
      initialCommentContainer.dataset.hydrated = 'true';
    }

    const initialTranslateBtn = initialCommentContainer?.querySelector('.auto-translate-btn');
    const composerTranslateBtn = form.querySelector('.composer-auto');
    [initialTranslateBtn, composerTranslateBtn]
      .filter(Boolean)
      .forEach((btn) => {
        if (btn.dataset.bound === 'true') return;
        btn.dataset.bound = 'true';
        btn.addEventListener('click', async () => {
          await handleAutoTranslate(form, btn);
        });
      });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const currentOrderId = form.dataset.orderId || state.selectedOrder?.id;
      if (!currentOrderId) return;
      const prioritySelect = form.querySelector('select[name="priority"]');
      const priority = prioritySelect?.value || 'mittel';
      const initialCommentPayload = collectCommentPayload(form);
      if (!initialCommentPayload) return;
      await ensureSupplierAutoTranslation(initialCommentPayload);
      const rawTitle = initialCommentPayload.message_de || initialCommentPayload.message_tr || '';
      const fallbackTitle = translateTemplate('Neue Rückfrage');
      const title = rawTitle
        ? rawTitle.length > 120
          ? `${rawTitle.slice(0, 117)}...`
          : rawTitle
        : fallbackTitle;
      let initialCommentFailed = false;
      try {
        const ticket = await request('/api/tickets', {
          method: 'POST',
          body: {
            order_id: currentOrderId,
            title,
            priority
          }
        });
        const ticketKey = buildOrderTicketKey(ticket);
        if (initialCommentPayload) {
        try {
          await submitTicketComment(ticket.id, initialCommentPayload, {
            orderId: currentOrderId,
            positionId: null,
            createdAt: ticket.created_at,
            ticketKey
          });
        } catch (commentErr) {
          console.warn('Initial ticket comment konnte nicht gespeichert werden', commentErr);
          showToast(translateTemplate('Ticket erstellt, initialer Kommentar fehlgeschlagen.'));
          initialCommentFailed = true;
        }
      }
      try {
        await refreshOrderTickets(currentOrderId);
      } catch (refreshErr) {
        console.warn('Ticket refresh failed', refreshErr);
      }
      form.reset();
      form._pendingFiles = [];
      renderPendingFiles(form);
      renderOrderTickets(state.selectedOrder || { id: currentOrderId });
      if (!initialCommentFailed) {
        showToast(translateTemplate('Rückfrage gespeichert'));
      }
      } catch (err) {
        showToast(err.message);
      }
    });
    form.dataset.bound = 'true';

    const { toggle } = getOrderComposerElements();
    if (toggle && toggle.dataset.bound !== 'true') {
      toggle.dataset.bound = 'true';
      toggle.addEventListener('click', () => {
        if (toggle.disabled) return;
        const isVisible = !form.classList.contains('is-hidden');
        setOrderComposerVisibility(!isVisible);
      });
    }

  }

  function bindTechpackTicketForm(orderId, positionId) {
    const form = document.getElementById('techpackTicketForm');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const title = data.get('title')?.toString().trim();
      if (!title) {
        showToast(translateTemplate('Bitte eine Rückfrage eingeben.'));
        return;
      }
      const priority = data.get('priority') || 'mittel';
      const viewKey = resolveActiveViewKey();
      if (!viewKey) {
        showToast(translateTemplate('Bitte zuerst eine Ansicht laden.'));
        return;
      }
      try {
        const ticket = await request('/api/tickets', {
          method: 'POST',
          body: {
            order_id: orderId,
            position_id: positionId,
            title,
            priority,
            view_key: viewKey
          }
        });
        state.tickets = [...(state.tickets || []), ticket];
        form.reset();
        renderTechpackTickets(orderId, positionId, viewKey);
        updateTechpackStatusDisplay(getActiveTechpackMedia());
        showToast(translateTemplate('Rückfrage gespeichert'));
      } catch (err) {
        showToast(err.message);
      }
    });
  }

  function bindTicketCommentForms(orderId, positionId, viewKey = resolveActiveViewKey()) {
    document.querySelectorAll('.ticket-comment-form').forEach((form) => {
      if (form.dataset.bound === 'true') return;
      form.dataset.bound = 'true';
      bindCommentFileInput(form);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const ticketId = form.dataset.ticketId;
        const ticketCreated = form.dataset.ticketCreated;
        const ticketKey = form.dataset.ticketKey;
        if (!ticketId) return;
        const payload = collectCommentPayload(form);
        if (!payload) return;
        await ensureSupplierAutoTranslation(payload);
        try {
          await submitTicketComment(ticketId, payload, { orderId, positionId, createdAt: ticketCreated, ticketKey });
          form.reset();
          form._pendingFiles = [];
          renderPendingFiles(form);
          renderTechpackTickets(orderId, positionId, viewKey);
          showToast('Antwort gespeichert');
        } catch (err) {
          showToast(err.message);
        }
      });
      const autoBtn = form.querySelector('.auto-translate-btn');
      if (autoBtn && autoBtn.dataset.bound !== 'true') {
        autoBtn.dataset.bound = 'true';
        autoBtn.addEventListener('click', async () => {
          await handleAutoTranslate(form, autoBtn);
        });
      }
    });
  }

  function collectCommentPayload(form, options = {}) {
    const { allowEmpty = false } = options;
    const messageDe = form.querySelector('[name="message_de"]')?.value.trim() || '';
    const messageTr = form.querySelector('[name="message_tr"]')?.value.trim() || '';
    const pendingFiles = [...getFormPendingFiles(form)];
    const hasContent = Boolean(messageDe || messageTr || pendingFiles.length);
    if (!hasContent) {
      if (allowEmpty) return null;
      showToast('Kommentar oder Datei erforderlich.');
      return null;
    }
    return {
      message_de: messageDe,
      message_tr: messageTr,
      files: pendingFiles
    };
  }

  async function handleAutoTranslate(form, button) {
    const wrapper =
      button.closest('.ticket-comment-form') ||
      button.closest('.ticket-comment-initial') ||
      form;
    const fieldContainer = wrapper?.querySelector('.comment-fields');
    if (!fieldContainer) {
      showToast('Kein Textfeld gefunden.');
      return;
    }
    const deField = fieldContainer.querySelector('textarea[name="message_de"]');
    const trField = fieldContainer.querySelector('textarea[name="message_tr"]');
    if (!deField || !trField) {
      showToast('Automatische Übersetzung nicht verfügbar.');
      return;
    }
    const sourceLang = deField.value.trim() ? 'de' : trField.value.trim() ? 'tr' : null;
    if (!sourceLang) {
      showToast('Bitte zuerst Text eingeben.');
      return;
    }
    const targetLang = sourceLang === 'de' ? 'tr' : 'de';
    const sourceField = sourceLang === 'de' ? deField : trField;
    const targetField = targetLang === 'de' ? deField : trField;
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Übersetze...';
    try {
      const response = await request('/api/translate', {
        method: 'POST',
        body: {
          text: sourceField.value.trim(),
          source: sourceLang,
          target: targetLang
        }
      });
      const translatedText = response?.translation || response?.text || '';
      targetField.value = translatedText;
      showToast(`Text in ${targetLang === 'de' ? 'Deutsch' : 'Türkisch'} übersetzt`);
    } catch (err) {
      showToast(err.message);
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }

  function renderTechpackArticleCard(order, positionId) {
    const card = document.getElementById('techpackArticleCard');
    if (!card) return;
    const position = order.positions?.find((pos) => pos.position_id === positionId);
    if (!position) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');
    const positionIndex = (order.positions || []).findIndex((pos) => pos.position_id === positionId);
    setText('articlePositionLabel', positionIndex >= 0 ? `${positionIndex + 1}` : position.position_id);
    setText('articleItemCode', position.item_code || '-');
    const item = state.erpItems?.find((entry) => entry.item_code === position.item_code);
    setText('articleItemName', item?.item_name || position.description || '-');
    setText('articleColorCode', position.color_code || resolvePositionColorCode(order, position, item) || '-');
    const quantity = Number(position.quantity) || 0;
    setText('articleQuantity', quantity.toString());
    const sizeGrid = document.getElementById('articleSizeGrid');
    if (sizeGrid) {
      const sizes = Object.keys(position.size_breakdown || {});
      const list = sizes.length ? sizes : SIZE_COLUMNS;
      sizeGrid.innerHTML = list
        .map((size) => {
          const value = position.size_breakdown?.[size] ?? 0;
          return `<span><small>${size}</small><strong>${value}</strong></span>`;
        })
        .join('');
    }
  }

  function bindTechpackAnnotationStage(orderId, positionId) {
    if (state.techpackAnnotationStageBound) return;
    const stage = document.getElementById('techpackMediaStage');
    if (!stage) return;
    stage.addEventListener('click', async (event) => {
      const activeMedia = getActiveTechpackMedia();
      if (!activeMedia) {
        showToast('Bitte zuerst eine Ansicht wählen.');
        return;
      }
      if (event.target.closest('.techpack-annotation-layer button')) return;
      const rect = stage.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      if (x < 0 || y < 0 || x > 1 || y > 1) return;
      const note = prompt('Kommentar für diesen Punkt:');
      if (!note) return;
      try {
        await addTechpackAnnotation(orderId, positionId, activeMedia.id, x, y, note);
      } catch (err) {
        showToast(err.message);
      }
    });
    state.techpackAnnotationStageBound = true;
  }

  function bindTechpackUpload(orderId, positionId) {
    const button = document.getElementById('uploadTechpackBtn');
    const input = document.getElementById('techpackUploadInput');
    if (!button || !input) return;
    button.onclick = () => {
      const viewKey = resolveActiveViewKey();
      if (!viewKey) {
        showToast('Keine Ansicht verfügbar.');
        return;
      }
      input.click();
    };
    input.onchange = () => {
      const file = input.files?.[0];
      const viewKey = resolveActiveViewKey();
      if (!file) return;
      if (!viewKey) {
        showToast('Keine Ansicht verfügbar.');
        input.value = '';
        return;
      }
      uploadTechpackImage(orderId, positionId, file, viewKey);
      input.value = '';
    };
  }

  function bindTechpackStatusControl(orderId, positionId) {
    const button = document.getElementById('techpackStatusToggle');
    if (!button) return;
    button.addEventListener('click', async () => {
      const activeMedia = getActiveTechpackMedia();
      if (!activeMedia) {
        showToast('Bitte zuerst eine Ansicht wählen.');
        return;
      }
      const nextStatus = activeMedia.status === 'OK' ? 'OPEN' : 'OK';
      try {
        await updateTechpackMediaStatus(orderId, positionId, activeMedia.id, nextStatus);
      } catch (err) {
        showToast(err.message);
      }
    });
  }

  function bindTechpackReplace(orderId, positionId) {
    const button = document.getElementById('replaceTechpackBtn');
    const input = document.getElementById('techpackReplaceInput');
    if (!button || !input) return;
    button.addEventListener('click', () => {
      const activeMedia = getActiveTechpackMedia();
      if (!activeMedia) {
        showToast('Bitte zuerst eine Ansicht auswählen.');
        return;
      }
      input.click();
    });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      const activeMedia = getActiveTechpackMedia();
      if (!file || !activeMedia || activeMedia.isPlaceholder || activeMedia.is_placeholder) {
        input.value = '';
        if (!activeMedia || activeMedia.isPlaceholder || activeMedia.is_placeholder) {
          showToast('Bitte zuerst ein Bild hochladen.');
        }
        return;
      }
      replaceTechpackImage(orderId, positionId, activeMedia.id, activeMedia.view_key, file);
      input.value = '';
    });
  }

  function bindTechpackDelete(orderId, positionId) {
    const button = document.getElementById('deleteTechpackBtn');
    if (!button) return;
    button.addEventListener('click', async () => {
      const activeMedia = getActiveTechpackMedia();
      if (!activeMedia || activeMedia.isPlaceholder || activeMedia.is_placeholder) {
        showToast('Bitte zuerst eine Ansicht auswählen.');
        return;
      }
      const confirmed = window.confirm('Bild wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.');
      if (!confirmed) return;
      try {
        await deleteTechpackImage(orderId, positionId, activeMedia.id);
      } catch (err) {
        showToast(err.message);
      }
    });
  }

  async function uploadTechpackImage(orderId, positionId, file, viewKey) {
    if (!viewKey) {
      showToast('Ansicht fehlt.');
      return;
    }
    const form = new FormData();
    form.append('file', file);
    form.append('view_key', viewKey);
    form.append('view_label', getTechpackViewLabel(viewKey));
    try {
      await request(`/api/specs/${orderId}/${positionId}/upload`, {
        method: 'POST',
        body: form
      });
      await refreshTechpackSpec(orderId, positionId);
      showToast('Bild hochgeladen');
    } catch (err) {
      showToast(err.message);
    }
  }

  async function replaceTechpackImage(orderId, positionId, mediaId, viewKey, file) {
    const form = new FormData();
    form.append('file', file);
    form.append('view_label', getTechpackViewLabel(viewKey));
    try {
      await request(`/api/specs/${orderId}/${positionId}/media/${mediaId}/replace`, {
        method: 'POST',
        body: form
      });
      await refreshTechpackSpec(orderId, positionId);
      showToast('Bild ersetzt');
    } catch (err) {
      showToast(err.message);
    }
  }

  async function deleteTechpackImage(orderId, positionId, mediaId) {
    await request(`/api/specs/${orderId}/${positionId}/media/${mediaId}`, {
      method: 'DELETE'
    });
    await refreshTechpackSpec(orderId, positionId);
    showToast('Bild gelöscht');
  }

  async function updateTicketStatus(ticketId, status, context = {}) {
    const resolvedContext = { ...context };
    if (!resolvedContext.orderId && state.selectedOrder?.id) {
      resolvedContext.orderId = state.selectedOrder.id;
    }
    const payload = { status };
    if (resolvedContext.orderId) payload.order_id = resolvedContext.orderId;
    if (Object.prototype.hasOwnProperty.call(resolvedContext, 'positionId')) {
      payload.position_id = resolvedContext.positionId ?? null;
    }
    if (resolvedContext.createdAt) payload.created_at = resolvedContext.createdAt;
    if (resolvedContext.ticketKey) payload.ticket_key = resolvedContext.ticketKey;
    const updatedTicket = await request(`/api/tickets/${ticketId}`, {
      method: 'PATCH',
      body: payload
    });
    const matches = (ticket) => ticketMatchesContext(ticket, ticketId, resolvedContext);
    state.tickets = (state.tickets || []).map((ticket) => (matches(ticket) ? { ...ticket, status, ...updatedTicket } : ticket));
    state.orderTickets = (state.orderTickets || []).map((ticket) =>
      matches(ticket) ? { ...ticket, status, ...updatedTicket } : ticket
    );
    if (context.type === 'techpack' && resolvedContext.orderId && context.positionId) {
      const nextView = context.viewKey || resolveActiveViewKey();
      renderTechpackTickets(resolvedContext.orderId, context.positionId, nextView);
      updateTechpackStatusDisplay(getActiveTechpackMedia());
    } else if (context.type === 'order') {
      try {
        if (resolvedContext.orderId) {
          await refreshOrderTickets(resolvedContext.orderId);
        }
      } catch (refreshErr) {
        console.warn('Ticket refresh failed', refreshErr);
      }
      renderOrderTickets(state.selectedOrder || (resolvedContext.orderId ? { id: resolvedContext.orderId } : undefined));
    }
  }

  async function loadOrderPrintOptions(orderId) {
    const statusLabel = document.getElementById('printOptionsStatus');
    if (!statusLabel || !orderId) return null;
    statusLabel.textContent = translateTemplate('Optionen werden geladen …');
    try {
      const options = await request(`/api/orders/${encodeURIComponent(orderId)}/print-options`);
      state.orderPrintOptions = options;
      populatePrintOptionSelects(options);
      statusLabel.textContent = '';
      return options;
    } catch (err) {
      state.orderPrintOptions = null;
      populatePrintOptionSelects({});
      statusLabel.textContent = translateTemplate('Druckoptionen konnten nicht geladen werden.');
      console.warn('Print options error', err);
      return null;
    }
  }

  function populatePrintOptionSelects(options = {}) {
    const { formats = [], languages = [], letterheads = [], defaults = {} } = options;
    const formatSelect = document.getElementById('printFormatSelect');
    if (formatSelect) {
      if (formats.length) {
        formatSelect.innerHTML = formats
          .map((entry) => `<option value="${escapeHtml(entry.value || entry.name)}">${escapeHtml(entry.label || entry.name || entry.value)}</option>`)
          .join('');
        const preferred = defaults.format;
        const hasPreferred = formats.some((entry) => (entry.value || entry.name) === preferred);
        formatSelect.value = hasPreferred ? preferred : formats[0].value || formats[0].name;
        formatSelect.disabled = false;
      } else {
        formatSelect.innerHTML = `<option value="">${escapeHtml(translateTemplate('Keine Daten geladen.'))}</option>`;
        formatSelect.disabled = true;
      }
    }
    const languageSelect = document.getElementById('printLanguageSelect');
    if (languageSelect) {
      if (languages.length) {
        languageSelect.innerHTML = languages
          .map((entry) => `<option value="${escapeHtml(entry.code)}">${escapeHtml(entry.label || entry.code)}</option>`)
          .join('');
        const preferredLanguage = defaults.language;
        const hasPreferredLanguage = languages.some((entry) => entry.code === preferredLanguage);
        languageSelect.value = hasPreferredLanguage ? preferredLanguage : languages[0].code;
        languageSelect.disabled = false;
      } else {
        languageSelect.innerHTML = `<option value="">${escapeHtml(translateTemplate('Keine Daten geladen.'))}</option>`;
        languageSelect.disabled = true;
      }
    }
    const letterheadSelect = document.getElementById('printLetterheadSelect');
    if (letterheadSelect) {
      const fallbackOption = `<option value="">${escapeHtml(translateTemplate('Kein Briefkopf'))}</option>`;
      if (letterheads.length) {
        const optionsHtml = letterheads
          .map((entry) => `<option value="${escapeHtml(entry.value || entry.name)}">${escapeHtml(entry.label || entry.name || entry.value)}</option>`)
          .join('');
        letterheadSelect.innerHTML = `${fallbackOption}${optionsHtml}`;
        const preferredLetterhead = defaults.letterhead;
        const hasPreferredLetterhead = letterheads.some((entry) => (entry.value || entry.name) === preferredLetterhead);
        letterheadSelect.value = hasPreferredLetterhead ? preferredLetterhead : '';
        letterheadSelect.disabled = false;
      } else {
        letterheadSelect.innerHTML = fallbackOption;
        letterheadSelect.disabled = false;
        letterheadSelect.value = '';
      }
    }
  }

  function bindPrintOptionEvents(orderId) {
    const refreshBtn = document.getElementById('refreshPrintOptions');
    if (refreshBtn) {
      refreshBtn.dataset.orderId = orderId || '';
      if (refreshBtn.dataset.bound !== 'true') {
        refreshBtn.dataset.bound = 'true';
        refreshBtn.addEventListener('click', () => {
          const targetOrderId = refreshBtn.dataset.orderId || state.selectedOrder?.id;
          if (targetOrderId) {
            loadOrderPrintOptions(targetOrderId);
          }
        });
      }
    }
    const printBtn = document.getElementById('printOrderPdfBtn');
    if (printBtn) {
      printBtn.dataset.orderId = orderId || '';
      if (printBtn.dataset.bound !== 'true') {
        printBtn.dataset.bound = 'true';
        printBtn.addEventListener('click', () => {
          const targetOrderId = printBtn.dataset.orderId || state.selectedOrder?.id;
          if (targetOrderId) {
            handleOrderPrint(targetOrderId);
          }
        });
      }
    }
  }

  function setPrintButtonLoading(isLoading) {
    const button = document.getElementById('printOrderPdfBtn');
    if (!button) return;
    if (isLoading) {
      button.dataset.originalLabel = button.dataset.originalLabel || button.textContent;
      button.textContent = translateTemplate('PDF wird erstellt …');
      button.disabled = true;
    } else {
      if (button.dataset.originalLabel) {
        button.textContent = button.dataset.originalLabel;
      }
      button.disabled = false;
    }
  }

  async function handleOrderPrint(orderId) {
    const formatSelect = document.getElementById('printFormatSelect');
    const languageSelect = document.getElementById('printLanguageSelect');
    const letterheadSelect = document.getElementById('printLetterheadSelect');
    const format = formatSelect?.value;
    if (!format) {
      showToast(translateTemplate('Druckoptionen konnten nicht geladen werden.'));
      return;
    }
    const language = languageSelect?.value || '';
    const letterhead = letterheadSelect?.value || '';
    setPrintButtonLoading(true);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/print/pdf`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, language, letterhead })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || translateTemplate('PDF konnte nicht erstellt werden'));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      showToast(translateTemplate('PDF erstellt'));
    } catch (err) {
      showToast(err.message || translateTemplate('PDF konnte nicht erstellt werden'));
    } finally {
      setPrintButtonLoading(false);
    }
  }

  async function submitTicketComment(ticketId, payload, context = {}) {
    const resolvedContext = { ...context };
    if (!resolvedContext.orderId && state.selectedOrder?.id) {
      resolvedContext.orderId = state.selectedOrder.id;
    }
    const data = new FormData();
    if (payload.message_de) data.append('message_de', payload.message_de);
    if (payload.message_tr) data.append('message_tr', payload.message_tr);
    if (Array.isArray(payload.files)) {
      payload.files.forEach((file) => {
        data.append('files', file);
      });
    }
    if (resolvedContext.orderId) data.append('order_id', resolvedContext.orderId);
    if (Object.prototype.hasOwnProperty.call(resolvedContext, 'positionId')) {
      data.append('position_id', resolvedContext.positionId ?? '');
    }
    const comment = await request(`/api/tickets/${ticketId}/comment`, {
      method: 'POST',
      body: data
    });
    const matches = (ticket) => ticketMatchesContext(ticket, ticketId, resolvedContext);
    state.tickets = (state.tickets || []).map((ticket) =>
      matches(ticket) ? { ...ticket, comments: [...(ticket.comments || []), comment] } : ticket
    );
    state.orderTickets = (state.orderTickets || []).map((ticket) =>
      matches(ticket) ? { ...ticket, comments: [...(ticket.comments || []), comment] } : ticket
    );
  }

  async function deleteTechpackAnnotation(annotationId) {
    const context = state.techpackContext;
    if (!context) {
      showToast('Kontext fehlt');
      return;
    }
    await request(`/api/specs/${context.orderId}/${context.positionId}/annotations/${annotationId}`, {
      method: 'DELETE'
    });
    await refreshTechpackSpec(context.orderId, context.positionId);
    showToast('Annotation entfernt');
  }

  async function deleteTicket(ticketId, context = {}) {
    const resolvedContext = { ...context };
    if (!resolvedContext.orderId && state.selectedOrder?.id) {
      resolvedContext.orderId = state.selectedOrder.id;
    }
    const existing = (state.tickets || []).find((ticket) => ticketMatchesContext(ticket, ticketId, resolvedContext));
    const orderId = resolvedContext.orderId || existing?.order_id || null;
    const hasPositionContext = Object.prototype.hasOwnProperty.call(resolvedContext, 'positionId');
    const positionId =
      hasPositionContext ? resolvedContext.positionId : existing && Object.prototype.hasOwnProperty.call(existing, 'position_id')
        ? existing.position_id
        : undefined;
    const params = new URLSearchParams();
    if (orderId) params.set('order_id', orderId);
    if (hasPositionContext || positionId !== undefined) {
      params.set('position_id', positionId ?? '');
    }
    const query = params.toString();
    await request(`/api/tickets/${ticketId}${query ? `?${query}` : ''}`, { method: 'DELETE' });
    const matches = (ticket) => ticketMatchesContext(ticket, ticketId, resolvedContext);
    state.tickets = (state.tickets || []).filter((ticket) => !matches(ticket));
    state.orderTickets = (state.orderTickets || []).filter((ticket) => !matches(ticket));
    const targetOrderId = orderId;
    if (targetOrderId) {
      try {
        await refreshOrderTickets(targetOrderId);
      } catch (err) {
        console.warn('Ticket refresh failed', err);
      }
    }
    showToast(translateTemplate('Ticket gelöscht'));
  }

  async function deleteTicketComment(ticketId, commentId, context = {}) {
    const resolvedContext = { ...context };
    if (!resolvedContext.orderId && state.selectedOrder?.id) {
      resolvedContext.orderId = state.selectedOrder.id;
    }
    const params = new URLSearchParams();
    if (resolvedContext.orderId) params.set('order_id', resolvedContext.orderId);
    if (Object.prototype.hasOwnProperty.call(resolvedContext, 'positionId')) {
      params.set('position_id', resolvedContext.positionId ?? '');
    }
    const query = params.toString();
    await request(`/api/tickets/${ticketId}/comment/${commentId}${query ? `?${query}` : ''}`, { method: 'DELETE' });
    const matches = (ticket) => ticketMatchesContext(ticket, ticketId, resolvedContext);
    state.tickets = (state.tickets || []).map((ticket) =>
      matches(ticket) ? { ...ticket, comments: (ticket.comments || []).filter((comment) => comment.id !== commentId) } : ticket
    );
    state.orderTickets = (state.orderTickets || []).map((ticket) =>
      matches(ticket) ? { ...ticket, comments: (ticket.comments || []).filter((comment) => comment.id !== commentId) } : ticket
    );
    showToast('Kommentar gelöscht');
  }

  async function updateTechpackMediaStatus(orderId, positionId, mediaId, status) {
    await request(`/api/specs/${orderId}/${positionId}/media/${mediaId}/status`, {
      method: 'PATCH',
      body: { status }
    });
    await refreshTechpackSpec(orderId, positionId);
    showToast('Status aktualisiert');
  }

  async function addTechpackAnnotation(orderId, positionId, mediaId, x, y, note) {
    await request(`/api/specs/${orderId}/${positionId}/annotations`, {
      method: 'POST',
      body: { mediaId, x, y, note }
    });
    await refreshTechpackSpec(orderId, positionId);
  }

  async function refreshTechpackSpec(orderId, positionId) {
    const spec = await request(`/api/specs/${orderId}/${positionId}`);
    state.techpackSpec = spec;
    if (state.techpackContext) {
      const position = (state.selectedOrder?.positions || []).find((pos) => pos.position_id === state.techpackContext.positionId);
      if (position) {
        ensureTechpackActiveMedia(spec);
        renderTechpackMedia(position, spec);
      }
    } else {
      renderTechpackAnnotations();
    }
  }

  function getPackagingType() {
    return document.body?.dataset?.page === 'schuhbox' ? 'shoebox' : 'carton';
  }

  function serializeCarton(carton) {
    return {
      number: carton.number,
      meta: {
        variation: carton.meta?.variation || '',
        article: carton.meta?.article || '',
        leather: carton.meta?.leather || '',
        sole: carton.meta?.sole || ''
      },
      values: { ...carton.values }
    };
  }

  async function loadCustomerPackaging(customerId, type) {
    if (!customerId) return null;
    try {
      return await request(`/api/customers/${encodeURIComponent(customerId)}/packaging/${encodeURIComponent(type)}`);
    } catch (err) {
      console.warn('Packaging preset konnte nicht geladen werden', err);
      return null;
    }
  }

  async function applyCustomerPackaging(customerId, type) {
    const preset = await loadCustomerPackaging(customerId, type);
    if (!preset || !Array.isArray(preset.cartons) || !preset.cartons.length) {
      return null;
    }
    if (Array.isArray(preset.sizes) && preset.sizes.length) {
      state.sizeList = preset.sizes;
    }
    if (preset.defaults) {
      state.cartonDefaults = {
        ...state.cartonDefaults,
        ...preset.defaults
      };
    }
    state.labelCartons = preset.cartons.map((carton, idx) => {
      const instance = createEmptyCarton(carton.number || idx + 1, carton.meta || {});
      instance.id = carton.id || `carton-${idx + 1}`;
      instance.values = buildCartonValues(carton.values || {}, state.sizeList);
      return instance;
    });
    state.activeCartonIndex = 0;
    renderCartonEditor();
    return preset;
  }

  async function saveCustomerPackaging(customerId, type) {
    if (!customerId) {
      showToast('Kein Kunde verknüpft');
      return;
    }
    const encodedType = encodeURIComponent(type);
    if (type === 'shoebox') {
      if (!state.shoeboxRows?.length) {
        showToast('Keine Schuhbox-Daten vorhanden.');
        return;
      }
      try {
        const payload = {
          cartons: (state.shoeboxRows || []).map((row) => ({
            id: row.id,
            article_number: row.articleNumber,
            name: row.name,
            color_code: row.colorCode,
            size: row.size,
            image_url: row.imageUrl,
            quantity: row.quantity
          })),
          sizes: [],
          defaults: null
        };
        await request(`/api/customers/${encodeURIComponent(customerId)}/packaging/${encodedType}`, {
          method: 'POST',
          body: payload
        });
        showToast('Kundenlayout gespeichert');
      } catch (err) {
        showToast(err.message);
      }
      return;
    }
    try {
      const payload = {
        sizes: state.sizeList,
        defaults: state.cartonDefaults,
        cartons: state.labelCartons.map((carton) => serializeCarton(carton))
      };
      await request(`/api/customers/${encodeURIComponent(customerId)}/packaging/${encodedType}`, {
        method: 'POST',
        body: payload
      });
      showToast('Kundenlayout gespeichert');
    } catch (err) {
      showToast(err.message);
    }
  }

  async function applyShoeboxPreset(customerId) {
    if (!customerId) return false;
    try {
      const preset = await loadCustomerPackaging(customerId, 'shoebox');
      if (!preset || !Array.isArray(preset.cartons) || !preset.cartons.length) {
        return false;
      }
      state.shoeboxRows = preset.cartons.map((row, idx) => ({
        id: row.id || `preset-${idx}`,
        articleNumber: row.article_number || '-',
        name: (row.name || 'Artikel').toString().toUpperCase(),
        colorCode: row.color_code || '-',
        imageUrl: row.image_url || '',
        defaultImageUrl: row.image_url || '',
        size: row.size || '-',
        quantity: Math.max(0, Math.floor(Number(row.quantity) || 0))
      }));
      renderShoeboxTable();
      return true;
    } catch (err) {
      console.warn('Shoebox preset konnte nicht geladen werden', err);
      return false;
    }
  }

  async function prepareLabelModule(order) {
    const totalInput = document.getElementById('cartonTotal');
    const hint = document.getElementById('labelCustomerHint');
    const printBtn = document.getElementById('printLabelBtn');
    const saveBtn = document.getElementById('savePackagingBtn');
    const packagingType = getPackagingType();
    bindSizeEditorControls();
    initializeCartonState(order);
    await applyCustomerPackaging(order.customer_id, packagingType);
    state.cartonTotalBound = false;
    state.labelHandlersBound = false;
    state.currentLabel = null;
    state.currentLabelHtml = '';
    if (hint) {
      hint.textContent = order.customer_name
        ? translateTemplate('Etikettvorlage für {{customer}}', { customer: order.customer_name })
        : translateTemplate('Kundenspezifisches Layout');
    }
    if (totalInput) {
      const fallbackTotal = state.labelCartons.length || 1;
      totalInput.value = fallbackTotal;
      totalInput.min = 1;
      if (!state.cartonTotalBound) {
        totalInput.addEventListener('change', () => syncCartonCountWithInput());
        totalInput.addEventListener('blur', () => syncCartonCountWithInput());
        state.cartonTotalBound = true;
      }
    }
    if (printBtn) {
      printBtn.disabled = true;
    }
    if (saveBtn) {
      saveBtn.disabled = !order.customer_id;
      if (!saveBtn.dataset.bound) {
        saveBtn.addEventListener('click', () => saveCustomerPackaging(order.customer_id, packagingType));
        saveBtn.dataset.bound = 'true';
      }
    }
    syncCartonCountWithInput();
    if (!state.labelHandlersBound) {
      document.getElementById('printLabelBtn')?.addEventListener('click', () => printCartonLabel());
      document.getElementById('printAllLabelsBtn')?.addEventListener('click', () => printAllCartonLabels(order.id));
      state.labelHandlersBound = true;
    }
    generateCartonLabel(order.id);
  }

  function renderOrderTypeBadge(orderType) {
    const badge = document.getElementById('orderTypeBadge');
    if (!badge) return;
    const meta = resolveOrderTypeMeta(orderType);
    badge.textContent = meta.label;
    badge.className = `badge order-type-badge ${meta.badgeClass}`;
  }

  function syncOrderTypeControlState(isDisabled) {
    const control = document.getElementById('orderTypeControl');
    if (!control) return;
    control.dataset.disabled = isDisabled ? 'true' : 'false';
  }

  function renderStatusControl(order) {
    const select = document.getElementById('orderStatusSelect');
    if (!select) return;
    const previouslySelected = select.value;
    select.innerHTML = STATUS_CHOICES.map((entry) => `<option value="${entry.code}">${entry.label}</option>`).join('');
    select.value = order.portal_status || previouslySelected;
    select.disabled = !isInternalRole(state.user?.role);
    if (!select.dataset.bound) {
      select.addEventListener('change', (event) => {
        const nextStatus = event.target.value;
        if (!nextStatus || !state.selectedOrder) return;
        if (nextStatus === state.selectedOrder.portal_status) return;
        updateOrderStatus(nextStatus);
      });
      select.dataset.bound = 'true';
    }
    const confirmBtn = document.getElementById('orderConfirmBtn');
    if (confirmBtn) {
      if (!confirmBtn.dataset.defaultLabel) {
        confirmBtn.dataset.defaultLabel = confirmBtn.textContent.trim();
      }
      const shouldShowConfirm = order.portal_status === 'ORDER_EINGEREICHT' && !isInternalRole(state.user?.role);
      confirmBtn.classList.toggle('hidden', !shouldShowConfirm);
      confirmBtn.disabled = !shouldShowConfirm || state.orderStatusBusy;
      if (!confirmBtn.dataset.bound) {
        confirmBtn.addEventListener('click', handleSupplierConfirmation);
        confirmBtn.dataset.bound = 'true';
      }
      if (!state.orderStatusBusy && confirmBtn.dataset.defaultLabel) {
        confirmBtn.textContent = confirmBtn.dataset.defaultLabel;
      }
    }
    const typeSelect = document.getElementById('orderTypeSelect');
    if (typeSelect) {
      const nextValue = order.order_type || '';
      typeSelect.value = nextValue;
      typeSelect.disabled = !isInternalRole(state.user?.role);
      syncOrderTypeControlState(typeSelect.disabled);
      renderOrderTypeBadge(nextValue);
      if (!typeSelect.dataset.bound) {
        typeSelect.addEventListener('change', (event) => {
          const nextType = event.target.value;
          if (!nextType || !state.selectedOrder) return;
          if (nextType === state.selectedOrder.order_type) return;
          renderOrderTypeBadge(nextType);
          updateOrderType(nextType);
        });
        typeSelect.dataset.bound = 'true';
      }
    } else {
      renderOrderTypeBadge(order.order_type);
    }
  }

  async function handleSupplierConfirmation() {
    if (!state.selectedOrder || state.orderStatusBusy) return;
    const button = document.getElementById('orderConfirmBtn');
    const defaultLabel = button?.dataset.defaultLabel || 'Bestätigung senden';
    state.orderStatusBusy = true;
    if (button) {
      button.disabled = true;
      button.textContent = 'Wird bestätigt...';
    }
    try {
      await updateOrderStatus('ORDER_BESTAETIGT');
    } finally {
      state.orderStatusBusy = false;
      if (button) {
        button.disabled = false;
        button.textContent = defaultLabel;
      }
      renderStatusControl(state.selectedOrder || {});
    }
  }

  async function updateOrderStatus(nextStatus) {
    if (!state.selectedOrder) return;
    try {
      await request(`/api/orders/${state.selectedOrder.id}`, { method: 'PATCH', body: { nextStatus } });
      showToast('Status aktualisiert');
      await loadOrderDetail(state.selectedOrder.id);
    } catch (err) {
      showToast(err.message);
      const select = document.getElementById('orderStatusSelect');
      if (select) select.value = state.selectedOrder.portal_status;
    }
  }

  async function updateOrderType(orderType) {
    if (!state.selectedOrder) return;
    try {
      await request(`/api/orders/${state.selectedOrder.id}`, { method: 'PATCH', body: { order_type: orderType } });
      showToast('Bestellart aktualisiert');
      await loadOrderDetail(state.selectedOrder.id);
    } catch (err) {
      showToast(err.message);
      const select = document.getElementById('orderTypeSelect');
      const fallbackValue = state.selectedOrder.order_type || '';
      if (select) select.value = fallbackValue;
      renderOrderTypeBadge(fallbackValue);
    }
  }

  async function generateCartonLabel(orderId = state.selectedOrder?.id) {
    if (!orderId) return;
    const activeCarton = getActiveCarton();
    if (!activeCarton) {
      showToast(translateTemplate('Kein Karton ausgewählt'));
      return;
    }
    const totalInput = document.getElementById('cartonTotal');
    const total = Math.max(1, Number(totalInput?.value) || state.labelCartons.length || 1);
    ensureCartonCount(total);
    if (totalInput) totalInput.value = total;
    try {
      const payload = await request(`/api/orders/${orderId}/label`, {
        method: 'POST',
        body: getCartonPayload(activeCarton, total)
      });
      state.currentLabel = payload;
      renderCartonLabel(payload);
    } catch (err) {
      showToast(err.message);
    }
  }

  function buildCartonLabelHtml(data) {
    const sizeHeaders = (data.size_table || [])
      .map((entry) => `<th>${escapeHtml(entry.size)}</th>`)
      .join('');
    const sizeValues = (data.size_table || [])
      .map((entry) => `<td>${escapeHtml(entry.quantity ?? '')}</td>`)
      .join('');
    const noSizesText = translateTemplate('Keine Größeninformationen hinterlegt.');
    const sizeSection =
      data.size_table && data.size_table.length
        ? `<table class="label-size-table">
            <thead>
              <tr>
                <th>${escapeHtml(data.size_label)}</th>
                ${sizeHeaders}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>${escapeHtml(data.pairing_label)}</th>
                ${sizeValues}
              </tr>
            </tbody>
          </table>`
        : `<p class="muted">${escapeHtml(noSizesText)}</p>`;
    const taxLine = data.order_customer?.tax_id
      ? translateTemplate('Steuernummer: {{value}}', { value: data.order_customer.tax_id })
      : null;
    const customerLines = [
      data.order_customer?.name,
      ...(data.order_customer?.address_lines || []),
      taxLine
    ]
      .filter(Boolean)
      .map((line) => escapeHtml(line));
    const orderLabel = translateTemplate('Bestell-Nr.');
    const cartonTotalLabel = translateTemplate('Karton gesamt');
    const cartonNumberLabel = translateTemplate('Karton-Nr.');
    const variationLabel = translateTemplate('Variation-Nr.:');
    const articleLabel = translateTemplate('Artikel-Nr.:');
    const leatherLabel = data.leather_label || translateTemplate('Leder & Farbe');
    const soleLabel = data.sole_label || translateTemplate('Sohle');
    const customerLabel = translateTemplate('Kunde');
    return `
      <div class="carton-label">
        <div class="label-row top">
          <div>
            <p class="label-heading">${escapeHtml(data.warehouse_title || '')}</p>
            <p>${formatLines(data.warehouse_lines)}</p>
          </div>
          <div>
            <p class="label-heading">${escapeHtml(orderLabel)}</p>
            <p class="order-number-value">${escapeHtml(data.order_number || '')}</p>
            <div class="supplier-block">
              <p class="label-heading">${escapeHtml(data.supplier_title || '')}</p>
              <p>${formatLines(data.supplier_lines)}</p>
            </div>
          </div>
          <div class="carton-total">
            <p>${escapeHtml(cartonTotalLabel)}</p>
            <span>${escapeHtml(data.carton?.total ?? '')}</span>
          </div>
          <div class="carton-number">
            <p>${escapeHtml(cartonNumberLabel)}</p>
            <span>${escapeHtml(data.carton?.number ?? '')}</span>
          </div>
        </div>
        <div class="label-row meta">
          <div><strong>${escapeHtml(variationLabel)}</strong> ${escapeHtml(data.variation || '-')}</div>
          <div><strong>${escapeHtml(articleLabel)}</strong> ${escapeHtml(data.article_number || '-')}</div>
        </div>
        <div class="label-row meta">
          <div><strong>${escapeHtml(leatherLabel)}</strong> ${escapeHtml(data.leather_value || '-')}</div>
          <div><strong>${escapeHtml(soleLabel)}</strong> ${escapeHtml(data.sole_value || '-')}</div>
        </div>
        ${sizeSection}
        <div class="label-footer">
          <div class="label-customer">
            <strong>${escapeHtml(customerLabel)}</strong>
            <div>${customerLines.join('<br />') || '-'}</div>
          </div>
          <div class="label-version">${escapeHtml(data.notes || '')}</div>
        </div>
      </div>`;
  }

  function renderCartonLabel(data) {
    state.currentLabel = data;
    state.currentLabelHtml = buildCartonLabelHtml(data);
    const printBtn = document.getElementById('printLabelBtn');
    if (printBtn) {
      printBtn.disabled = false;
    }
  }

  async function printCartonLabel() {
    if (!state.currentLabelHtml && state.selectedOrder?.id) {
      await generateCartonLabel(state.selectedOrder.id);
      if (!state.currentLabelHtml) {
        showToast(translateTemplate('Etikett konnte nicht erzeugt werden.'));
        return;
      }
    }
    const popup = window.open('', '_blank');
    if (!popup) {
      showToast(translateTemplate('Popup blockiert – bitte Popup-Blocker deaktivieren.'));
      return;
    }
    const labelTitle = translateTemplate('Kartonetikett {{order}}', {
      order: state.selectedOrder?.order_number || ''
    });
    popup.document.write(
      `<html><head><title>${escapeHtml(
        labelTitle
      )}</title><link rel="stylesheet" href="/styles.css" /></head><body class="label-print">${state.currentLabelHtml}</body></html>`
    );
    popup.document.close();
    popup.focus();
    popup.print();
  }

  async function printAllCartonLabels(orderId = state.selectedOrder?.id) {
    if (!orderId) return;
    if (!state.labelCartons.length) {
      showToast(translateTemplate('Keine Kartons konfiguriert.'));
      return;
    }
    const totalInput = document.getElementById('cartonTotal');
    const total = Math.max(1, Number(totalInput?.value) || state.labelCartons.length);
    ensureCartonCount(total);
    const body = {
      cartons: state.labelCartons.map((carton) => getCartonPayload(carton, total))
    };
    try {
      const response = await fetch(`/api/orders/${orderId}/label/batch/pdf`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error || translateTemplate('PDF konnte nicht erstellt werden'));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `etiketten-${state.selectedOrder?.order_number || 'labels'}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err.message);
    }
  }

  function showArtikelDetailView() {
    const listView = document.getElementById('artikelListView');
    const detailView = document.getElementById('artikelDetailView');
    if (listView) listView.classList.add('hidden');
    if (detailView) detailView.classList.remove('hidden');
  }

  function showArtikelListView() {
    const listView = document.getElementById('artikelListView');
    const detailView = document.getElementById('artikelDetailView');
    if (detailView) detailView.classList.add('hidden');
    if (listView) listView.classList.remove('hidden');
    setBreadcrumbLabel(translateTemplate('Artikel'));
  }

  function updateArtikelUrlParam(itemCode) {
    const params = new URLSearchParams(window.location.search);
    if (itemCode) {
      params.set('item', itemCode);
    } else {
      params.delete('item');
    }
    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState({}, '', nextUrl);
  }

  function showCustomerDetailView() {
    const listView = document.getElementById('customerListView');
    const detailView = document.getElementById('customerDetailView');
    if (listView) listView.classList.add('hidden');
    if (detailView) detailView.classList.remove('hidden');
  }

  function showCustomerListView() {
    const listView = document.getElementById('customerListView');
    const detailView = document.getElementById('customerDetailView');
    if (detailView) detailView.classList.add('hidden');
    if (listView) listView.classList.remove('hidden');
    setBreadcrumbLabel(translateTemplate('Kunden'));
  }

  function updateCustomerUrlParam(customerId) {
    const params = new URLSearchParams(window.location.search);
    if (customerId) {
      params.set('customer', customerId);
    } else {
      params.delete('customer');
    }
    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState({}, '', nextUrl);
  }

  function highlightArtikelRow(row, table) {
    if (!row || !table) return;
    table.querySelectorAll('tr').forEach((tr) => tr.classList.remove('active'));
    row.classList.add('active');
  }

  async function initArtikel() {
    const table = document.getElementById('artikelTable');
    if (!table) return;
    const searchInput = document.getElementById('artikelSearch');
    const groupSelect = document.getElementById('artikelGroupFilter');
    const filtersForm = document.getElementById('artikelFilters');
    const resetButton = document.querySelector('[data-action="reset-artikel"]');
    const backButton = document.getElementById('backToArtikelList');
    if (backButton) {
      backButton.addEventListener('click', () => {
        showArtikelListView();
        updateArtikelUrlParam(null);
      });
    }
    showArtikelListView();
    renderArtikelDetail(null);
    try {
      const erpItems = await request('/api/erp/items');
      state.erpItems = erpItems;
      let filteredItems = erpItems.slice();

      if (groupSelect) {
        const groups = Array.from(new Set(erpItems.map((item) => item.item_group).filter(Boolean))).sort();
        groupSelect.innerHTML = ['<option value="">Alle Artikelgruppen</option>', ...groups.map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`)].join('');
      }

      const renderRows = (items) => {
        if (!items.length) {
          table.innerHTML = `<tr><td colspan="4" class="muted">${escapeHtml(
            translateTemplate('Keine Artikel gefunden.')
          )}</td></tr>`;
          return;
        }
        table.innerHTML = items
          .map((item) => {
            const galleryImages = Array.isArray(item.media?.gallery) ? item.media.gallery : [];
            const fallbackThumb = item.media?.hero || galleryImages[0]?.url || null;
            const viewerGallery = buildViewerGallery(item, fallbackThumb);
            const thumbnail = viewerGallery?.[0]?.url || fallbackThumb;
            const fallbackInitial = (item.item_name || item.item_code || '?').toString().slice(0, 2).toUpperCase();
            const thumbMarkup = thumbnail
              ? `<div class="artikel-thumb"><img src="${escapeHtml(thumbnail)}" alt="${escapeHtml(item.item_name || 'Artikelbild')}" loading="lazy" referrerpolicy="no-referrer" /></div>`
              : `<div class="artikel-thumb placeholder"><span>${escapeHtml(fallbackInitial)}</span></div>`;
            return `
            <tr data-item-code="${item.item_code}">
              <td>${escapeHtml(item.item_code || '-')}</td>
              <td>${thumbMarkup}</td>
              <td>${escapeHtml(item.item_name || '-')}</td>
              <td>${escapeHtml(getItemColorCode(item))}</td>
            </tr>`;
          })
          .join('');
        const dataRows = Array.from(table.querySelectorAll('tr[data-item-code]'));
        dataRows.forEach((row) => {
          row.addEventListener('click', () => {
            highlightArtikelRow(row, table);
            openArtikelDetail(row.dataset.itemCode);
          });
        });
        if (state.activeArtikelCode) {
          const activeRow = table.querySelector(`tr[data-item-code="${state.activeArtikelCode}"]`);
          if (activeRow) activeRow.classList.add('active');
        }
      };

      const applyArtikelFilters = () => {
        const term = (searchInput?.value || '').toLowerCase();
        const groupFilter = groupSelect?.value || '';
        filteredItems = erpItems.filter((item) => {
          const matchesText = term
            ? (item.item_name || '').toLowerCase().includes(term) ||
              (item.item_code || '').toLowerCase().includes(term) ||
              getItemColorCode(item).toLowerCase().includes(term)
            : true;
          const matchesGroup = groupFilter ? item.item_group === groupFilter : true;
          return matchesText && matchesGroup;
        });
        renderRows(filteredItems);
      };

      if (searchInput) {
        searchInput.addEventListener('input', applyArtikelFilters);
      }
      if (groupSelect) {
        groupSelect.addEventListener('change', applyArtikelFilters);
      }
      if (filtersForm) {
        filtersForm.addEventListener('submit', (event) => {
          event.preventDefault();
          applyArtikelFilters();
        });
      }
      if (resetButton) {
        resetButton.addEventListener('click', () => {
          if (searchInput) searchInput.value = '';
          if (groupSelect) groupSelect.value = '';
          applyArtikelFilters();
        });
      }

      renderRows(filteredItems);
      const params = new URLSearchParams(window.location.search);
      const requestedCode = params.get('item');
      if (requestedCode) {
        const exists = erpItems.some((item) => item.item_code === requestedCode);
        if (exists) {
          openArtikelDetail(requestedCode);
          const requestedRow = table.querySelector(`tr[data-item-code="${requestedCode}"]`);
          if (requestedRow) {
            highlightArtikelRow(requestedRow, table);
            requestedRow.scrollIntoView({ block: 'nearest' });
          }
        } else {
          updateArtikelUrlParam(null);
        }
      }
    } catch (err) {
      const message = err?.message || translateTemplate('Artikel konnten nicht geladen werden.');
      table.innerHTML = `<tr><td colspan="3" class="muted">${escapeHtml(message)}</td></tr>`;
      showToast(message);
    }
  }

  function openArtikelDetail(itemCode) {
    if (!itemCode) return;
    const item = state.erpItems?.find((entry) => entry.item_code === itemCode);
    if (!item) {
      showToast(translateTemplate('Artikel nicht gefunden'));
      return;
    }
    state.activeArtikelCode = itemCode;
    renderArtikelDetail(item);
    showArtikelDetailView();
    updateArtikelUrlParam(itemCode);
  }

  function openCustomerDetail(customerId) {
    if (!customerId) return;
    const customer = state.customers?.find((entry) => entry.id === customerId);
    if (!customer) {
      showToast(translateTemplate('Kunde nicht gefunden'));
      return;
    }
    state.activeCustomerId = customerId;
    renderCustomerDetail(customer);
    showCustomerDetailView();
    updateCustomerUrlParam(customerId);
  }

  function renderCustomerDetail(customer) {
    const container = document.getElementById('customerDetail');
    if (!container) return;
    const t = (key, replacements) => translateTemplate(key, replacements);
    if (!customer) {
      container.innerHTML = `<p class="muted">${escapeHtml(t('Bitte einen Kunden auswählen.'))}</p>`;
      setBreadcrumbLabel(t('Kunden'));
      return;
    }
    const statusMeta = getCustomerStatusMeta(customer);
    const addresses = (state.addresses || []).filter((addr) => addr.customer_id === customer.id);
    const billingAddress = addresses.find((addr) => (addr.type || '').toLowerCase().includes('rechnung'));
    const primaryShipping = addresses.find((addr) => (addr.type || '').toLowerCase().includes('liefer'));
    const shippingAddress = primaryShipping || billingAddress || addresses[0] || null;
    const otherAddresses = addresses.filter((addr) => addr !== billingAddress && addr !== shippingAddress);
    const contact = (state.contacts || []).find((entry) => entry.customer_id === customer.id);
    const infoRowOne = [
      { label: t('Kundennummer'), value: customer.id },
      { label: t('Kundenname'), value: customer.name },
      { label: t('Steuernummer'), value: customer.tax_id },
      { label: t('Account Manager'), value: customer.account_manager }
    ];
    const infoRowTwo = [
      { label: t('WooCommerce Benutzer'), value: customer.woocommerce_user || '-' },
      { label: t('WooCommerce Passwort'), value: customer.woocommerce_password_hint || '–' },
      { label: t('Priorität'), value: customer.priority || '-' },
      { label: t('Status'), value: customer.status || '-' }
    ];
    const addressCards = [];
    addressCards.push(buildCustomerAddressCard(t('Rechnungsadresse'), billingAddress));
    addressCards.push(buildCustomerAddressCard(t('Lieferadresse'), shippingAddress));
    otherAddresses.forEach((addr, idx) => {
      const typeLabel = addr?.type ? t(addr.type) : t('Adresse');
      addressCards.push(buildCustomerAddressCard(`${typeLabel} ${idx + 1}`, addr));
    });
    const sizeOptions = SIZE_COLUMNS.map((size) => `<option value="${escapeHtml(size)}"></option>`).join('');
    setBreadcrumbLabel(t('Kunden · {{name}}', { name: customer.name }));
    const editButton = isInternalRole(state.user?.role)
      ? `<div class="customer-detail-actions"><a class="ghost" href="/kunden-neu.html?customer=${encodeURIComponent(
          customer.id
        )}">${escapeHtml(t('Bearbeiten'))}</a></div>`
      : '';
    container.innerHTML = `
      <div class="customer-profile-head">
        <div class="customer-status-meta">
          <p class="muted">${escapeHtml(t('Kunde'))}</p>
          <h2>${escapeHtml(customer.name)}</h2>
          <span class="status-pill ${statusMeta.className}">${statusMeta.label}</span>
        </div>
        <div class="customer-avatar">${escapeHtml(getCustomerInitials(customer.name))}</div>
      </div>
      ${editButton}
      <div class="customer-detail-rows">
        <div class="customer-detail-row row-four">
          ${infoRowOne.map((field) => detailField(field.label, field.value)).join('')}
        </div>
        <div class="customer-detail-row row-four">
          ${infoRowTwo.map((field) => detailField(field.label, field.value)).join('')}
        </div>
      </div>
      <section class="customer-address-grid">
        ${addressCards.join('')}
      </section>
      <section class="customer-contact-row">
        ${detailField(t('Ansprechpartner'), contact?.name || '-')}
        ${detailField(t('E-Mail'), contact?.email || '-')}
        ${detailField(t('Telefon'), contact?.phone || '-')}
      </section>
      <section class="customer-accessories">
        <div class="customer-accessories-head">
          <h4>${escapeHtml(t('Zubehör'))}</h4>
          <p class="muted" id="customerAccessoriesSubtitle">${escapeHtml(t('Kundenspezifisches Verpackungsset'))}</p>
        </div>
        <div id="customerAccessories" class="accessories-placeholder">
          <p class="muted">${escapeHtml(t('Keine Daten geladen.'))}</p>
        </div>
      </section>
      <section class="customer-order-profiles customer-accessories">
        <div class="customer-accessories-head customer-order-profiles-head">
          <div>
            <h4>${escapeHtml(t('Bestellprofile'))}</h4>
            <p class="muted">${escapeHtml(t('Standardgrößen für SMS und PPS'))}</p>
          </div>
          <button type="button" class="ghost" data-action="toggle-order-profile-edit" data-customer-id="${escapeHtml(customer.id)}">
            ${escapeHtml(t('Bearbeiten'))}
          </button>
        </div>
        <div class="order-profiles-panel">
          <div id="customerOrderProfiles" class="order-profiles-grid" data-customer-id="${escapeHtml(customer.id)}">
            <p class="muted">${escapeHtml(t('Keine Daten geladen.'))}</p>
          </div>
        </div>
        <datalist id="customerOrderProfileSizeOptions">
          ${sizeOptions}
        </datalist>
      </section>
    `;
    const orderProfileToggle = container.querySelector('[data-action="toggle-order-profile-edit"]');
    if (orderProfileToggle) {
      orderProfileToggle.disabled = true;
    }
    refreshCustomerAccessories(customer.id, {
      force: true,
      containerId: 'customerAccessories',
      subtitleId: 'customerAccessoriesSubtitle'
    }).catch((err) => console.warn('Accessory load failed for customer', err));
    refreshCustomerOrderProfiles(customer.id).catch((err) => console.warn('Order profile load failed', err));
  }

  function updateShippingFieldState(form) {
    if (!form) return;
    const fieldset = form.querySelector('[data-shipping-fields]');
    const checkbox =
      form.querySelector('[data-customer-shipping-toggle]') || form.querySelector('#customerShippingSame');
    if (!fieldset || !checkbox) return;
    const disabled = checkbox.checked;
    fieldset.classList.toggle('disabled', disabled);
    fieldset.querySelectorAll('input').forEach((input) => {
      input.disabled = disabled;
    });
  }

  function serializeCustomerCreateForm(form) {
    const formData = new FormData(form);
    const getValue = (name) => {
      const raw = formData.get(name);
      if (raw === null || raw === undefined) return '';
      return raw.toString().trim();
    };
    const language = getValue('customerLanguage') || 'de';
    const payload = {
      customerId: getValue('customerId'),
      customerName: getValue('customerName'),
      customerNumber: getValue('customerNumber'),
      customerType: getValue('customerType') || 'Company',
      status: getValue('status') || 'aktiv',
      language,
      accountManager: getValue('accountManager'),
      priority: getValue('priority'),
      taxId: getValue('taxId'),
      email: getValue('customerEmail'),
      phone: getValue('customerPhone'),
      woocommerceUser: getValue('woocommerceUser'),
      woocommercePasswordHint: getValue('woocommercePassword'),
      billingStreet: getValue('billingStreet'),
      billingStreet2: getValue('billingStreet2'),
      billingZip: getValue('billingZip'),
      billingCity: getValue('billingCity'),
      billingCountry: getValue('billingCountry') || 'Deutschland',
      billingState: getValue('billingState'),
      billingPhone: getValue('billingPhone'),
      billingAddressId: getValue('billingAddressId'),
      shippingStreet: getValue('shippingStreet'),
      shippingStreet2: getValue('shippingStreet2'),
      shippingZip: getValue('shippingZip'),
      shippingCity: getValue('shippingCity'),
      shippingCountry: getValue('shippingCountry'),
      shippingState: getValue('shippingState'),
      shippingPhone: getValue('shippingPhone'),
      shippingAddressId: getValue('shippingAddressId'),
      contactName: getValue('contactName'),
      contactEmail: getValue('contactEmail'),
      contactPhone: getValue('contactPhone'),
      contactId: getValue('contactId')
    };
    payload.shippingSameAsBilling = formData.get('shippingSame') === 'on';
    payload.customerLanguage = payload.language;
    Object.keys(payload).forEach((key) => {
      if (typeof payload[key] === 'string') {
        payload[key] = payload[key].trim();
        if (!payload[key]) {
          delete payload[key];
        }
      }
    });
    if (payload.customerId) {
      payload.customer_id = payload.customerId;
      delete payload.customerId;
    }
    if (payload.billingAddressId) {
      payload.billing_address_id = payload.billingAddressId;
      delete payload.billingAddressId;
    }
    if (payload.shippingAddressId) {
      payload.shipping_address_id = payload.shippingAddressId;
      delete payload.shippingAddressId;
    }
    if (payload.contactId) {
      payload.contact_id = payload.contactId;
      delete payload.contactId;
    }
    return payload;
  }

  function buildAddressFromPayload(customerId, payload = {}, type = 'rechnung') {
    if (!customerId) return null;
    const prefix = type === 'lieferung' ? 'shipping' : 'billing';
    const street = payload[`${prefix}Street`] || '';
    const city = payload[`${prefix}City`] || '';
    const zip = payload[`${prefix}Zip`] || '';
    const country =
      payload[`${prefix}Country`] || (type === 'rechnung' ? payload.billingCountry || 'Deutschland' : '');
    if (!street && !city && !zip) return null;
    const existingId = payload[`${prefix}AddressId`];
    const id = existingId || `${customerId}-${type}-${Date.now()}`;
    return {
      id,
      name: id,
      customer_id: customerId,
      type,
      address_title: payload.customerName || customerId,
      street,
      address_line1: street,
      city,
      zip,
      country,
      is_primary_address: type === 'rechnung' ? 1 : 0,
      is_shipping_address: type === 'lieferung' ? 1 : 0
    };
  }

  function buildContactFromPayload(customerId, payload = {}) {
    if (!customerId) return null;
    const hasData = payload.contactName || payload.contactEmail || payload.contactPhone;
    if (!hasData) return null;
    const id = payload.contactId || `${customerId}-contact-${Date.now()}`;
    return {
      id,
      name: payload.contactName || payload.contactEmail || id,
      full_name: payload.contactName || '',
      email: payload.contactEmail || '',
      phone: payload.contactPhone || '',
      customer_id: customerId,
      is_primary_contact: 1
    };
  }

  async function fetchCustomerDetailForForm(customerId) {
    if (!customerId) {
      throw new Error(translateTemplate('Kunde nicht gefunden'));
    }
    const [customers, addresses, contacts] = await Promise.all([
      request('/api/erp/customers'),
      request('/api/erp/addresses'),
      request('/api/erp/contacts')
    ]);
    const customer = customers.find((entry) => entry.id === customerId);
    if (!customer) {
      throw new Error(translateTemplate('Kunde nicht gefunden'));
    }
    return {
      customer,
      addresses: addresses.filter((entry) => entry.customer_id === customerId),
      contact: contacts.find((entry) => entry.customer_id === customerId) || null
    };
  }

  function populateCustomerForm(form, detail) {
    if (!form || !detail?.customer) return;
    const { customer, addresses, contact } = detail;
    const setValue = (name, value) => {
      const field = form.querySelector(`[name="${name}"]`);
      if (!field) return;
      field.value = value ?? '';
    };
    setValue('customerId', customer.id || '');
    const numberInput = form.querySelector('[name="customerNumber"]');
    if (numberInput) {
      numberInput.value = customer.id || customer.customer_number || '';
      numberInput.readOnly = true;
      numberInput.classList.add('input-readonly');
    }
    setValue('customerName', customer.customer_name || customer.name || '');
    const typeValue = (customer.customer_type || 'Company').toUpperCase() === 'INDIVIDUAL' ? 'Individual' : 'Company';
    setValue('customerType', typeValue);
    const statusValue = (customer.status || '').toLowerCase() === 'gesperrt' ? 'gesperrt' : 'aktiv';
    setValue('status', statusValue);
    setValue('customerLanguage', (customer.language || 'de').toLowerCase());
    setValue('accountManager', customer.account_manager || '');
    setValue('priority', customer.priority || '');
    setValue('taxId', customer.tax_id || '');
    setValue('customerEmail', customer.email_id || customer.contact_email || '');
    setValue('customerPhone', customer.phone || customer.contact_phone || '');
    setValue('woocommerceUser', customer.woocommerce_user || '');
    setValue('woocommercePassword', customer.woocommerce_password_hint || '');

    const findAddress = (keyword) =>
      addresses.find((addr) => (addr.type || '').toLowerCase().includes(keyword)) || null;
    const billingAddress = findAddress('rechnung') || addresses[0] || null;
    const shippingAddress = findAddress('liefer');

    const fillAddressFields = (prefix, address) => {
      setValue(`${prefix}Street`, address?.street || address?.address_line1 || '');
      setValue(`${prefix}Street2`, address?.street2 || address?.address_line2 || '');
      setValue(`${prefix}Zip`, address?.zip || address?.pincode || '');
      setValue(`${prefix}City`, address?.city || '');
      setValue(`${prefix}Country`, address?.country || '');
      setValue(`${prefix}State`, address?.state || '');
      setValue(`${prefix}Phone`, address?.phone || '');
      setValue(`${prefix}AddressId`, address?.id || '');
    };

    if (billingAddress) {
      fillAddressFields('billing', billingAddress);
    } else {
      setValue('billingAddressId', '');
    }
    if (shippingAddress) {
      fillAddressFields('shipping', shippingAddress);
      const shippingCheckbox = form.querySelector('#customerShippingSame');
      if (shippingCheckbox) {
        shippingCheckbox.checked = false;
      }
    } else {
      setValue('shippingAddressId', '');
    }

    setValue('contactName', contact?.name || contact?.full_name || '');
    setValue('contactEmail', contact?.email || contact?.email_id || '');
    setValue('contactPhone', contact?.phone || contact?.mobile_no || '');
    setValue('contactId', contact?.id || '');
    updateShippingFieldState(form);
  }

  function serializeArtikelForm(form) {
    const formData = new FormData(form);
    const getValue = (name) => {
      const raw = formData.get(name);
      if (raw === null || raw === undefined) return '';
      return raw.toString().trim();
    };
    const payload = {
      item_code: getValue('itemCode'),
      item_name: getValue('itemName'),
      item_group: getValue('itemGroup'),
      stock_uom: getValue('stockUom'),
      brand: getValue('brand'),
      status: getValue('status') || 'active',
      collection: getValue('collection'),
      customer_link: getValue('customerLink'),
      customer_item_code: getValue('customerItemCode'),
      color_code: getValue('colorCode'),
      description: getValue('description'),
      materials: {
        outer: getValue('outerMaterial'),
        inner: getValue('innerMaterial'),
        sole: getValue('soleMaterial')
      },
      links: {
        b2b: getValue('b2bLink'),
        viewer3d: getValue('viewerLink')
      }
    };
    Object.keys(payload).forEach((key) => {
      if (typeof payload[key] === 'string') {
        if (!payload[key]) {
          delete payload[key];
        }
      }
    });
    if (payload.materials && !Object.values(payload.materials).some((value) => value)) {
      delete payload.materials;
    }
    if (payload.links && !Object.values(payload.links).some((value) => value)) {
      delete payload.links;
    }
    return payload;
  }

  function setArtikelFormLoading(form, isLoading) {
    if (!form) return;
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = isLoading;
      submitButton.textContent = isLoading
        ? translateTemplate('Speichern …')
        : form.dataset.submitLabel || translateTemplate('Artikel speichern');
    }
    form.querySelectorAll('input, select, textarea').forEach((element) => {
      if (element === submitButton) return;
      element.disabled = isLoading;
    });
  }

  async function fetchItemDetailForForm(itemCode) {
    if (!itemCode) {
      throw new Error(translateTemplate('Artikel nicht gefunden'));
    }
    const items = await request('/api/erp/items');
    const normalizedCode = itemCode.toString().toLowerCase();
    const item = items.find(
      (entry) => (entry.item_code || '').toLowerCase() === normalizedCode || entry.id.toLowerCase() === normalizedCode
    );
    if (!item) {
      throw new Error(translateTemplate('Artikel nicht gefunden'));
    }
    return item;
  }

  function populateArtikelForm(form, item) {
    if (!form || !item) return;
    const setValue = (name, value) => {
      const field = form.querySelector(`[name="${name}"]`);
      if (!field) return;
      field.value = value ?? '';
    };
    setValue('itemCode', item.item_code || item.id || '');
    const codeInput = form.querySelector('[name="itemCode"]');
    if (codeInput) {
      codeInput.readOnly = true;
      codeInput.classList.add('input-readonly');
    }
    setValue('itemName', item.item_name || '');
    setValue('itemGroup', item.item_group || '');
    setValue('stockUom', item.stock_uom || '');
    setValue('brand', item.brand || '');
    setValue('status', item.status === 'inactive' ? 'inactive' : 'active');
    setValue('collection', item.collection || '');
    setValue('customerLink', item.customer_link || '');
    setValue('customerItemCode', item.customer_item_code || '');
    setValue('colorCode', item.color_code || '');
    setValue('description', item.description || '');
    setValue('outerMaterial', item.materials?.outer || '');
    setValue('innerMaterial', item.materials?.inner || '');
    setValue('soleMaterial', item.materials?.sole || '');
    setValue('b2bLink', item.links?.b2b || '');
    setValue('viewerLink', item.links?.viewer3d || '');
  }

  function setCustomerCreateLoading(form, isLoading) {
    if (!form) return;
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = isLoading;
      submitButton.textContent = isLoading
        ? translateTemplate('Speichern …')
        : form.dataset.submitLabel || translateTemplate('Kunde anlegen');
    }
    form.querySelectorAll('input, select, textarea').forEach((element) => {
      if (element === submitButton) return;
      element.disabled = isLoading;
    });
    if (!isLoading) {
      updateShippingFieldState(form);
    }
  }

  function initCustomerCreateForm(options = {}) {
    const { mode = 'create', customerId = null, onSuccess, formId = 'customerCreateForm' } = options;
    const form = document.getElementById(formId);
    if (!form) return;
    if (!isInternalRole(state.user?.role)) {
      return;
    }
    const submitLabel = mode === 'edit' ? translateTemplate('Änderungen speichern') : translateTemplate('Kunde anlegen');
    form.dataset.submitLabel = submitLabel;
    form.customerCreateOptions = { mode, customerId, onSuccess };
    updateShippingFieldState(form);
    const shippingToggle =
      form.querySelector('[data-customer-shipping-toggle]') || form.querySelector('#customerShippingSame');
    if (shippingToggle && !shippingToggle.dataset.bound) {
      shippingToggle.addEventListener('change', () => updateShippingFieldState(form));
      shippingToggle.dataset.bound = 'true';
    }
    if (form.dataset.customerFormBound === 'true') {
      return;
    }
    form.dataset.customerFormBound = 'true';
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = serializeCustomerCreateForm(form);
      if (!payload.customerName) {
        showToast(translateTemplate('Kundenname ist erforderlich.'));
        return;
      }
      const feedback =
        form.querySelector('[data-customer-feedback]') || document.getElementById('customerCreateFeedback');
      if (feedback) {
        feedback.textContent = '';
        feedback.classList.remove('error');
      }
      setCustomerCreateLoading(form, true);
      try {
        const currentOptions = form.customerCreateOptions || {};
        const currentMode = currentOptions.mode || 'create';
        const currentCustomerId = currentOptions.customerId || null;
        const endpoint =
          currentMode === 'edit' && currentCustomerId
            ? `/api/erp/customers/${encodeURIComponent(currentCustomerId)}`
            : '/api/erp/customers';
        const result = await request(endpoint, {
          method: currentMode === 'edit' && currentCustomerId ? 'PUT' : 'POST',
          body: payload
        });
        showToast(
          currentMode === 'edit' ? translateTemplate('Kunde aktualisiert.') : translateTemplate('Kunde angelegt.')
        );
        if (currentMode === 'create') {
          form.reset();
          updateShippingFieldState(form);
        }
        if (typeof currentOptions.onSuccess === 'function') {
          currentOptions.onSuccess(result, payload);
        }
      } catch (err) {
        if (feedback) {
          feedback.textContent = err.message || translateTemplate('Kunde konnte nicht angelegt werden.');
          feedback.classList.add('error');
        }
      } finally {
        setCustomerCreateLoading(form, false);
      }
    });
  }

  async function initKundenNeu() {
    const form = document.getElementById('customerCreateForm');
    if (!form) return;
    if (!isInternalRole(state.user?.role)) {
      window.location.href = '/kunden.html';
      return;
    }
    const backButton = document.getElementById('backToCustomers');
    if (backButton) {
      backButton.addEventListener('click', () => {
        window.location.href = '/kunden.html';
      });
    }
    const params = new URLSearchParams(window.location.search);
    const editingId = params.get('customer');
    const isEditing = Boolean(editingId);
    if (isEditing) {
      setBreadcrumbLabel(translateTemplate('Kunden · Bearbeiten'));
      setCustomerCreateLoading(form, true);
      try {
        const detail = await fetchCustomerDetailForForm(editingId);
        populateCustomerForm(form, detail);
        const headerTitle = document.querySelector('.customer-create-head h2');
        if (headerTitle) {
          headerTitle.textContent = translateTemplate('Kunde bearbeiten');
        }
        initCustomerCreateForm({
          mode: 'edit',
          customerId: editingId,
          onSuccess: () => {
            const target = `/kunden.html?customer=${encodeURIComponent(editingId)}`;
            window.location.href = target;
          }
        });
      } catch (err) {
        const message = err.message || translateTemplate('Kunde konnte nicht geladen werden.');
        const feedback = document.getElementById('customerCreateFeedback');
        if (feedback) {
          feedback.textContent = message;
          feedback.classList.add('error');
        }
        showToast(message);
        setCustomerCreateLoading(form, false);
        return;
      }
      setCustomerCreateLoading(form, false);
      return;
    }
    initCustomerCreateForm({
      mode: 'create',
      onSuccess: (result) => {
        const customerId = result?.customer?.id || result?.id || null;
        const target = customerId ? `/kunden.html?customer=${encodeURIComponent(customerId)}` : '/kunden.html';
        window.location.href = target;
      }
    });
    setBreadcrumbLabel(translateTemplate('Kunden · Neu'));
  }

  function initArtikelForm(options = {}) {
    const { mode = 'create', itemCode = null, onSuccess } = options;
    const form = document.getElementById('artikelCreateForm');
    if (!form) return;
    if (!isInternalRole(state.user?.role)) {
      return;
    }
    const submitLabel = mode === 'edit' ? translateTemplate('Änderungen speichern') : translateTemplate('Artikel speichern');
    form.dataset.submitLabel = submitLabel;
    const feedback = document.getElementById('artikelCreateFeedback');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const payload = serializeArtikelForm(form);
      if (!payload.item_code) {
        showToast(translateTemplate('Artikelnummer ist erforderlich.'));
        return;
      }
      if (!payload.item_name) {
        showToast(translateTemplate('Artikelname ist erforderlich.'));
        return;
      }
      if (feedback) {
        feedback.textContent = '';
        feedback.classList.remove('error');
      }
      setArtikelFormLoading(form, true);
      try {
        const endpoint =
          mode === 'edit' && itemCode ? `/api/erp/items/${encodeURIComponent(itemCode)}` : '/api/erp/items';
        const result = await request(endpoint, {
          method: mode === 'edit' && itemCode ? 'PUT' : 'POST',
          body: payload
        });
        showToast(mode === 'edit' ? translateTemplate('Artikel aktualisiert.') : translateTemplate('Artikel angelegt.'));
        if (mode === 'create') {
          form.reset();
        }
        if (typeof onSuccess === 'function') {
          onSuccess(result);
        }
      } catch (err) {
        if (feedback) {
          feedback.textContent = err.message || translateTemplate('Artikel konnte nicht gespeichert werden.');
          feedback.classList.add('error');
        }
      } finally {
        setArtikelFormLoading(form, false);
      }
    });
  }

  async function initArtikelNeu() {
    const form = document.getElementById('artikelCreateForm');
    if (!form) return;
    if (!isInternalRole(state.user?.role)) {
      window.location.href = '/artikel.html';
      return;
    }
    const backButton = document.getElementById('backToArticles');
    if (backButton) {
      backButton.addEventListener('click', () => {
        window.location.href = '/artikel.html';
      });
    }
    const params = new URLSearchParams(window.location.search);
    const editingCode = params.get('item');
    const isEditing = Boolean(editingCode);
    if (isEditing) {
      setBreadcrumbLabel(translateTemplate('Artikel · Bearbeiten'));
      setArtikelFormLoading(form, true);
      try {
        const detail = await fetchItemDetailForForm(editingCode);
        populateArtikelForm(form, detail);
        const headerTitle = document.querySelector('.customer-create-head h2');
        if (headerTitle) {
          headerTitle.textContent = translateTemplate('Artikel bearbeiten');
        }
        initArtikelForm({
          mode: 'edit',
          itemCode: editingCode,
          onSuccess: () => {
            const target = `/artikel.html?item=${encodeURIComponent(editingCode)}`;
            window.location.href = target;
          }
        });
      } catch (err) {
        const message = err.message || translateTemplate('Artikel konnte nicht geladen werden.');
        const feedback = document.getElementById('artikelCreateFeedback');
        if (feedback) {
          feedback.textContent = message;
          feedback.classList.add('error');
        }
        showToast(message);
        setArtikelFormLoading(form, false);
        return;
      }
      setArtikelFormLoading(form, false);
      return;
    }
    initArtikelForm({
      mode: 'create',
      onSuccess: (item) => {
        const targetCode = item?.item_code || item?.id || null;
        const target = targetCode ? `/artikel.html?item=${encodeURIComponent(targetCode)}` : '/artikel.html';
        window.location.href = target;
      }
    });
    setBreadcrumbLabel(translateTemplate('Artikel · Neu'));
  }

  function resolvePositionHeroImage(position, item) {
    const viewerBase = item?.links?.viewer3d?.replace(/\/$/, '');
    if (viewerBase) {
      return `${viewerBase}/images/0001.webp`;
    }
    return item?.media?.hero || '';
  }

  function findCartonColorCode(order, position, size = null) {
    if (!order?.cartons?.length) return null;
    const article = position?.item_code;
    const candidates = order.cartons.filter((carton) => !article || carton.article === article);
    if (!candidates.length) return null;
    if (size) {
      const sizeMatch = candidates.find((carton) => Number(carton.sizes?.[size]) > 0);
      if (sizeMatch) return sizeMatch.variation || sizeMatch.leather || sizeMatch.article || null;
    }
    const first = candidates[0];
    return first.variation || first.leather || first.article || null;
  }

  function resolvePositionColorCode(order, position, item, size = null) {
    const candidates = [];
    if (position?.color_code) candidates.push(position.color_code);
    if (position?.color) candidates.push(position.color);
    const description = position?.description || '';
    const match = description.match(/([A-Za-z]+-?\\d+)/);
    if (match) candidates.push(match[1]);
    if (item) {
      const code = getItemColorCode(item);
      if (code && code !== '-') candidates.push(code);
      if (item.customer_item_code) candidates.push(item.customer_item_code);
      const itemMatch = (item.description || '').match(/([A-Za-z]+-?\\d+)/);
      if (itemMatch) candidates.push(itemMatch[1]);
    }
    const cartonCode = findCartonColorCode(order, position, size);
    if (cartonCode) candidates.push(cartonCode);
    const result = candidates.find((value) => value && value !== '-');
    return result ? result.toString().toUpperCase() : '-';
  }

  function buildShoeboxLabelEntries(order) {
    const entries = [];
    (order.positions || []).forEach((pos, posIndex) => {
      const item = state.erpItems?.find((entry) => entry.item_code === pos.item_code);
      const imageUrl = resolvePositionHeroImage(pos, item);
      const name = (item?.item_name || pos.description || pos.item_code || 'Artikel').toUpperCase();
      const articleNumber = pos.item_code || item?.item_code || '-';
      const breakdown =
        pos.size_breakdown && Object.keys(pos.size_breakdown).length ? pos.size_breakdown : { '-': pos.quantity || 0 };
      Object.entries(breakdown).forEach(([size, amount]) => {
        const qty = Math.max(0, Math.floor(Number(amount) || 0));
        entries.push({
          id: `${pos.position_id || `pos-${posIndex}`}-${size}`,
          name,
          articleNumber,
          colorCode: resolvePositionColorCode(order, pos, item, size),
          imageUrl,
          defaultImageUrl: imageUrl,
          size,
          quantity: qty
        });
      });
    });
    return entries;
  }

  function renderShoeboxLabels(order) {
    state.shoeboxRows = buildShoeboxLabelEntries(order);
    renderShoeboxTable();
    renderShoeboxMetaControls();
    bindShoeboxMetaControls();
  }

  function renderShoeboxMetaControls() {
    const seasonSelect = document.getElementById('shoeboxSeasonSelect');
    const yearInput = document.getElementById('shoeboxYearInput');
    if (seasonSelect) {
      const current = (state.shoeboxSeason || 'FS').toUpperCase();
      if (!SHOEBOX_SEASON_CHOICES.includes(current)) {
        state.shoeboxSeason = 'FS';
      }
      seasonSelect.value = state.shoeboxSeason || 'FS';
    }
    if (yearInput) {
      yearInput.value = state.shoeboxYear || new Date().getFullYear();
    }
  }

  function bindShoeboxMetaControls() {
    const seasonSelect = document.getElementById('shoeboxSeasonSelect');
    if (seasonSelect && seasonSelect.dataset.bound !== '1') {
      seasonSelect.dataset.bound = '1';
      seasonSelect.addEventListener('change', (event) => {
        const value = (event.target.value || 'FS').toUpperCase();
        state.shoeboxSeason = SHOEBOX_SEASON_CHOICES.includes(value) ? value : 'FS';
      });
    }
    const yearInput = document.getElementById('shoeboxYearInput');
    if (yearInput && yearInput.dataset.bound !== '1') {
      yearInput.dataset.bound = '1';
      yearInput.addEventListener('input', (event) => {
        const numeric = Number(event.target.value);
        if (Number.isFinite(numeric)) {
          state.shoeboxYear = numeric;
        }
      });
    }
  }

  function renderShoeboxTable() {
    const table = document.getElementById('shoeboxTable');
    if (!table) return;
    const entries = state.shoeboxRows || [];
    if (!entries.length) {
      table.innerHTML = `<tr><td colspan="6" class="muted">${escapeHtml(
        translateTemplate('Keine Schuhbox-Etiketten vorhanden.')
      )}</td></tr>`;
      return;
    }
    const replaceLabel = translateTemplate('Bild ersetzen');
    const resetLabel = translateTemplate('Standard');
    table.innerHTML = entries
      .map((entry) => {
        const imageCell = entry.imageUrl
          ? `<img src="${escapeHtml(entry.imageUrl)}" alt="${escapeHtml(entry.name)}" loading="lazy" />`
          : `<span class="muted">${escapeHtml(translateTemplate('Kein Bild'))}</span>`;
        const imageBlock = `<div class="shoebox-image-cell">
          ${imageCell}
          <div class="shoebox-image-actions">
            <button type="button" class="ghost small" data-image-edit="${entry.id}">${escapeHtml(replaceLabel)}</button>
            ${
              entry.imageUrl !== entry.defaultImageUrl
                ? `<button type="button" class="ghost small" data-image-reset="${entry.id}">${escapeHtml(resetLabel)}</button>`
                : ''
            }
          </div>
        </div>`;
        return `<tr data-row-id="${entry.id}">
          <td>${escapeHtml(entry.articleNumber)}</td>
          <td>${imageBlock}</td>
          <td>${escapeHtml(entry.name)}</td>
          <td>${escapeHtml(entry.colorCode || '-')}</td>
          <td>${escapeHtml(entry.size)}</td>
          <td>
            <input type="number" class="shoebox-quantity-input" min="0" value="${entry.quantity}" data-row-id="${entry.id}" />
          </td>
        </tr>`;
      })
      .join('');
    table.querySelectorAll('.shoebox-quantity-input').forEach((input) => {
      input.addEventListener('input', (event) => {
        updateShoeboxQuantity(event.target.dataset.rowId, event.target.value);
      });
    });
    table.querySelectorAll('[data-image-edit]').forEach((button) => {
      button.addEventListener('click', () => openShoeboxImagePrompt(button.dataset.imageEdit));
    });
    table.querySelectorAll('[data-image-reset]').forEach((button) => {
      button.addEventListener('click', () => resetShoeboxImage(button.dataset.imageReset));
    });
  }

  function updateShoeboxQuantity(rowId, value) {
    const row = state.shoeboxRows.find((entry) => entry.id === rowId);
    if (!row) return;
    const next = Math.max(0, Math.floor(Number(value) || 0));
    row.quantity = next;
    const input = document.querySelector(`.shoebox-quantity-input[data-row-id="${rowId}"]`);
    if (input) input.value = String(next);
  }

  function openShoeboxImagePrompt(rowId) {
    const row = state.shoeboxRows.find((entry) => entry.id === rowId);
    if (!row) return;
    const current = row.imageUrl || '';
    const promptText = translateTemplate('Bild-URL für dieses Etikett eingeben:');
    const next = window.prompt(promptText, current);
    if (next === null) return;
    row.imageUrl = next.trim();
    renderShoeboxTable();
  }

  function resetShoeboxImage(rowId) {
    const row = state.shoeboxRows.find((entry) => entry.id === rowId);
    if (!row) return;
    row.imageUrl = row.defaultImageUrl || '';
    renderShoeboxTable();
  }

  function renderArtikelDetail(item) {
    const container = document.getElementById('artikelDetail');
    if (!container) return;
    const t = (key, replacements) => translateTemplate(key, replacements);
    if (!item) {
      container.innerHTML = `<p class="muted">${escapeHtml(t('Bitte einen Artikel auswählen.'))}</p>`;
      setBreadcrumbLabel(t('Artikel'));
      setArtikelHeaderLinks(null);
      return;
    }
    const colorCode = getItemColorCode(item);
    const statusMeta = getItemStatusMeta(item);
    const editButton = isInternalRole(state.user?.role)
      ? `<div class="artikel-detail-actions"><a class="ghost" href="/artikel-neu.html?item=${encodeURIComponent(
          item.item_code
        )}">${escapeHtml(t('Bearbeiten'))}</a></div>`
      : '';
    const heroFields = [
      { label: t('Artikelnummer'), value: item.item_code },
      { label: t('Artikelname'), value: item.item_name }
    ];
    const detailFields = [
      { label: t('Status'), value: statusMeta.label },
      { label: t('Farbcode'), value: colorCode },
      { label: t('Artikelgruppe'), value: item.item_group },
      { label: t('Kollektion'), value: item.collection },
      { label: t('Verknüpfung zum Kunden'), value: item.customer_link },
      { label: t('Kunden-Artikelcode'), value: item.customer_item_code }
    ];
    const priceRows =
      (item.prices || []).length > 0
        ? item.prices
            .map(
              (price) => `
              <tr>
                <td>${escapeHtml(price.label || '-')}</td>
                <td>${escapeHtml(price.type || '-')}</td>
                <td class="align-right">${price.amount ? `${price.amount.toFixed(2)} ${price.currency || 'EUR'}` : '-'}</td>
              </tr>`
            )
            .join('')
        : `<tr><td colspan="3" class="muted">${escapeHtml(t('Keine Preisdaten gepflegt.'))}</td></tr>`;
    const sizesMarkup =
      (item.sizes || []).length > 0
        ? item.sizes.map((size) => `<span class="size-pill">${escapeHtml(size)}</span>`).join('')
        : `<span class="muted">${escapeHtml(t('Keine Größen'))}</span>`;
    const materialList = [
      { label: t('Außenmaterial'), value: item.materials?.outer },
      { label: t('Innenmaterial'), value: item.materials?.inner },
      { label: t('Sohle'), value: item.materials?.sole }
    ]
      .map(
        (entry) => `<div class="detail-field">
        <p class="detail-field-label">${escapeHtml(entry.label)}</p>
        <p class="detail-field-value">${escapeHtml(entry.value || '-')}</p>
      </div>`
      )
      .join('');
    const galleryImages = Array.isArray(item.media?.gallery) ? item.media.gallery : [];
    const heroImage = item.media?.hero || galleryImages[0]?.url || null;
    const viewerGallery = buildViewerGallery(item, heroImage);
    const gallerySelection = viewerGallery?.length
      ? viewerGallery
      : galleryImages.filter((media) => media.url !== heroImage).slice(0, 4);
    const galleryThumbs = `<section class="artikel-gallery">
        <h4>${escapeHtml(t('Bilder'))}</h4>
        <div class="item-gallery item-gallery-fixed">
          ${
            gallerySelection.length
              ? gallerySelection
                  .map((media) => `<img src="${media.url}" alt="" loading="lazy" referrerpolicy="no-referrer" />`)
                  .join('')
              : `<div class="artikel-gallery-placeholder">${escapeHtml(t('Keine weiteren Bilder'))}</div>`
          }
        </div>
      </section>`;
    const hasLinks = Boolean(item.links?.b2b || item.links?.viewer3d);
    setArtikelHeaderLinks(hasLinks ? item : null);
    setBreadcrumbLabel(t('Artikel · {{name}}', { name: item.item_name || item.item_code || t('Artikel') }));
    const heroMediaMarkup = heroImage
      ? `<img src="${heroImage}" alt="${escapeHtml(item.item_name || item.item_code || '')}" loading="lazy" referrerpolicy="no-referrer" />`
      : `<div class="artikel-hero-placeholder">${escapeHtml(t('Kein Bild'))}</div>`;
    const sizeCount = (item.sizes || []).length || 0;
    const sizeMetaText = t('{{count}} verfügbare Größen', { count: sizeCount });
    container.innerHTML = `
      ${editButton}
      <div class="artikel-hero-grid">
        <div class="artikel-hero-fields">
          <div class="artikel-detail-primary">
            ${heroFields.map((field) => detailField(field.label, field.value)).join('')}
            ${detailFields.map((field) => detailField(field.label, field.value)).join('')}
          </div>
        </div>
        <div class="artikel-hero-media">
          ${heroMediaMarkup}
        </div>
      </div>
      <section class="artikel-prices">
        <h4>${escapeHtml(t('Preisübersicht'))}</h4>
        <table>
          <thead>
            <tr>
              <th>${escapeHtml(t('Liste'))}</th>
              <th>${escapeHtml(t('Typ'))}</th>
              <th class="align-right">${escapeHtml(t('Betrag'))}</th>
            </tr>
          </thead>
          <tbody>${priceRows}</tbody>
        </table>
      </section>
      <section class="artikel-variants">
        <div class="size-card">
          <div class="size-card-head">
            <h4>${escapeHtml(t('Größen'))}</h4>
            <span class="size-meta">${escapeHtml(sizeMetaText)}</span>
          </div>
          <div class="size-grid">${sizesMarkup}</div>
        </div>
      </section>
      <section class="artikel-materials">
        <h4>${escapeHtml(t('Materialien'))}</h4>
        <div class="detail-field-grid">${materialList}</div>
      </section>
      ${galleryThumbs}
    `;
  }

  function setArtikelHeaderLinks(item) {
    const holder = document.getElementById('artikelHeaderLinks');
    if (!holder) return;
    if (!item) {
      holder.innerHTML = '';
      holder.classList.add('hidden');
      return;
    }
    const viewLabel = translateTemplate('3D Ansicht');
    const articleLabel = translateTemplate('Zum Artikel');
    const links = [];
    if (item.links?.b2b) {
      links.push(
        `<a class="artikel-head-link" href="${item.links.b2b}" target="_blank" rel="noopener">${escapeHtml(articleLabel)}</a>`
      );
    }
    if (item.links?.viewer3d) {
      links.push(
        `<a class="artikel-head-link" href="${item.links.viewer3d}" target="_blank" rel="noopener">${escapeHtml(viewLabel)}</a>`
      );
    }
    if (!links.length) {
      holder.innerHTML = '';
      holder.classList.add('hidden');
    } else {
      holder.innerHTML = links.join('');
      holder.classList.remove('hidden');
    }
  }

  function detailField(label, value) {
    return `<div class="detail-field">
      <p class="detail-field-label">${escapeHtml(label)}</p>
      <p class="detail-field-value">${escapeHtml(value || '-')}</p>
    </div>`;
  }

  function getCustomerStatusMeta(customer) {
    const raw = (customer?.status || '').trim();
    const normalized = raw.toLowerCase();
    let className = 'warning';
    let labelKey = raw || 'Unbekannt';
    if (normalized === 'aktiv') {
      className = 'success';
      labelKey = 'Aktiv';
    } else if (normalized === 'gesperrt') {
      className = 'warning';
      labelKey = 'Gesperrt';
    } else if (!raw) {
      labelKey = 'Unbekannt';
    }
    return { label: translateTemplate(labelKey), className };
  }

  function getCustomerInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }

  function formatCustomerAddress(address) {
    const empty = `<span class="muted">${escapeHtml(translateTemplate('Keine Adresse hinterlegt'))}</span>`;
    if (!address) return empty;
    const cityLine = [address.zip, address.city].filter(Boolean).join(' ');
    const lines = [address.street, cityLine, address.country].filter(Boolean).map((line) => escapeHtml(line));
    return lines.length ? lines.join('<br />') : empty;
  }

  function buildCustomerAddressCard(title, address, customHtml = null) {
    const content = customHtml || formatCustomerAddress(address);
    return `
      <div class="customer-address-card">
        <h5>${escapeHtml(title)}</h5>
        <p>${content}</p>
      </div>`;
  }

  function getItemColorCode(item) {
    if (item?.color_code) return item.color_code;
    if (item?.collection) return item.collection;
    const match = item?.description?.match(/([A-Za-z]+-?\d{2,}|[A-Za-z]\d{2,})/);
    if (match) return match[0].toUpperCase();
    return '-';
  }

  function getItemStatusMeta(item) {
    const isActive = item?.status ? item.status.toLowerCase() === 'active' : !item?.disabled;
    return isActive
      ? { label: translateTemplate('Aktiviert'), className: 'success' }
      : { label: translateTemplate('Deaktiviert'), className: 'warning' };
  }

  async function initKunden() {
    const tableBody = document.getElementById('customerTable');
    if (!tableBody) return;
    const searchInput = document.getElementById('customerSearch');
    const numberInput = document.getElementById('customerNumberSearch');
    const filtersForm = document.getElementById('customerFilters');
    const resetButton = document.querySelector('[data-action="reset-customers"]');
    const backButton = document.getElementById('backToCustomerList');
    if (backButton) {
      backButton.addEventListener('click', () => {
        showCustomerListView();
        updateCustomerUrlParam(null);
      });
    }
    showCustomerListView();
    renderCustomerDetail(null);
    try {
      const [customers, addresses, contacts] = await Promise.all([
        request('/api/erp/customers'),
        request('/api/erp/addresses'),
        request('/api/erp/contacts')
      ]);
      state.customers = customers;
      state.addresses = addresses;
      updateSupplierDirectory(addresses);
      state.contacts = contacts;
      let filteredCustomers = state.customers.slice();

      const highlightRow = (customerId) => {
        tableBody.querySelectorAll('tr').forEach((tr) => tr.classList.remove('active'));
        if (!customerId) return;
        const activeRow = tableBody.querySelector(`tr[data-customer-id="${customerId}"]`);
        if (activeRow) activeRow.classList.add('active');
      };

      const renderTable = (items) => {
        if (!items.length) {
          tableBody.innerHTML = `<tr><td colspan="3" class="muted">${escapeHtml(
            translateTemplate('Keine Kunden gefunden.')
          )}</td></tr>`;
          return;
        }
        tableBody.innerHTML = items
          .map(
            (customer) => {
              const billing = state.addresses?.find(
                (addr) => addr.customer_id === customer.id && (addr.type || '').toLowerCase().includes('rechnung')
              );
              const cityLabel = billing?.city ? billing.city : '-';
              return `
            <tr data-customer-id="${customer.id}">
              <td>${escapeHtml(customer.id)}</td>
              <td>${escapeHtml(customer.name)}</td>
              <td>${escapeHtml(cityLabel)}</td>
            </tr>`;
            }
          )
          .join('');
        tableBody.querySelectorAll('tr[data-customer-id]').forEach((row) => {
          row.addEventListener('click', () => {
            state.activeCustomerId = row.dataset.customerId;
            highlightRow(state.activeCustomerId);
            openCustomerDetail(state.activeCustomerId);
          });
        });
        highlightRow(state.activeCustomerId);
      };

      const applyCustomerFilters = () => {
        const nameTerm = (searchInput?.value || '').toLowerCase();
        const numberTerm = (numberInput?.value || '').toLowerCase();
        filteredCustomers = state.customers.filter((customer) => {
          const matchesName = nameTerm ? customer.name.toLowerCase().includes(nameTerm) : true;
          const matchesId = numberTerm ? customer.id.toLowerCase().includes(numberTerm) : true;
          return matchesName && matchesId;
        });
        renderTable(filteredCustomers);
      };

      if (searchInput) {
        searchInput.addEventListener('input', applyCustomerFilters);
      }
      if (numberInput) {
        numberInput.addEventListener('input', applyCustomerFilters);
      }
      if (filtersForm) {
        filtersForm.addEventListener('submit', (event) => {
          event.preventDefault();
          applyCustomerFilters();
        });
      }
      if (resetButton) {
        resetButton.addEventListener('click', () => {
          if (searchInput) searchInput.value = '';
          if (numberInput) numberInput.value = '';
          applyCustomerFilters();
        });
      }

      renderTable(filteredCustomers);
      const params = new URLSearchParams(window.location.search);
      const requestedId = params.get('customer');
      if (requestedId) {
        const exists = state.customers.some((customer) => customer.id === requestedId);
        if (exists) {
          state.activeCustomerId = requestedId;
          highlightRow(requestedId);
          openCustomerDetail(requestedId);
          const row = tableBody.querySelector(`tr[data-customer-id="${requestedId}"]`);
          if (row) row.scrollIntoView({ block: 'nearest' });
        } else {
          updateCustomerUrlParam(null);
        }
      }
    } catch (err) {
      tableBody.innerHTML = `<tr><td colspan="4" class="muted">${escapeHtml(err.message)}</td></tr>`;
      showToast(err.message);
    }
  }

  async function initTickets() {
    const orderOpenList = document.getElementById('orderOpenTickets');
    const techpackOpenList = document.getElementById('techpackOpenTickets');
    if (!orderOpenList || !techpackOpenList) return;

    async function loadTickets() {
      const tickets = await request('/api/tickets');
      state.tickets = tickets;
      const openTickets = tickets.filter((ticket) => ticket.status !== 'CLOSED');
      const orderTickets = openTickets.filter((ticket) => !ticket.position_id);
      const techpackTickets = openTickets.filter((ticket) => ticket.position_id);
      renderOpenTicketList(orderOpenList, orderTickets);
      renderOpenTicketList(techpackOpenList, techpackTickets);
    }
    await loadTickets();
  }

  async function initKalender() {
    const list = document.getElementById('calendarList');
    const subtitle = document.getElementById('calendarSubtitle');
    const rangeSelect = document.getElementById('calendarRange');
    if (!list) return;

    const [calendarEvents, orders] = await Promise.all([request('/api/calendar'), request('/api/orders')]);
    const buildOrderEvents = (orderList) =>
      orderList
        .filter((order) => order.requested_delivery)
        .map((order) => ({
          id: `order-${order.id}`,
          title: `Lieferung ${order.order_number}`,
          start: order.requested_delivery,
          end: order.requested_delivery,
          type: 'ORDER',
          order_id: order.id
        }));

    state.orderDeliveryEvents = buildOrderEvents(orders);
    state.manualCalendarEvents = calendarEvents;
    state.calendarRange = rangeSelect?.value || 'month';

    const btn = document.getElementById('newEventBtn');
    const dialog = document.getElementById('eventDialog');
    if (btn && dialog) {
      if (!isInternalRole(state.user?.role)) {
        btn.disabled = true;
      } else {
        btn.addEventListener('click', () => dialog.showModal());
        dialog.addEventListener('close', async () => {
          if (dialog.returnValue === 'default') {
            const data = Object.fromEntries(new FormData(document.getElementById('eventForm')).entries());
            await request('/api/calendar', { method: 'POST', body: data });
            dialog.querySelector('form').reset();
            state.manualCalendarEvents = await request('/api/calendar');
            renderEventList();
          }
        });
      }
    }

    if (rangeSelect) {
      rangeSelect.addEventListener('change', () => {
        state.calendarRange = rangeSelect.value;
        renderEventList();
      });
    }

    function getAllEvents() {
      return [...state.orderDeliveryEvents, ...state.manualCalendarEvents];
    }

    function filterEventsByRange(range) {
      const today = new Date();
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      let end = null;
      switch (range) {
        case 'week': {
          end = new Date(start);
          end.setDate(end.getDate() + 7);
          break;
        }
        case 'month': {
          end = new Date(start);
          end.setMonth(end.getMonth() + 1);
          break;
        }
        case 'quarter': {
          end = new Date(start);
          end.setMonth(end.getMonth() + 3);
          break;
        }
        case 'all':
        default:
          break;
      }
      return getAllEvents()
        .map((event) => ({ ...event, parsedDate: new Date(event.start) }))
        .filter((event) => !Number.isNaN(event.parsedDate.getTime()))
        .filter((event) => {
          if (event.parsedDate < start) return false;
          if (end && event.parsedDate > end) return false;
          return true;
        })
        .sort((a, b) => a.parsedDate - b.parsedDate);
    }

    function renderEventList() {
      const range = rangeSelect?.value || state.calendarRange || 'month';
      const filtered = filterEventsByRange(range);
      const orderCount = filtered.filter((event) => event.type === 'ORDER').length;
      if (subtitle) {
        if (!filtered.length) {
          subtitle.textContent = 'Keine Termine im gewählten Zeitraum';
        } else {
          subtitle.textContent = `${orderCount} Liefertermine · ${Math.max(
            filtered.length - orderCount,
            0
          )} weitere Ereignisse`;
        }
      }
      if (!filtered.length) {
        list.innerHTML = '<li class="muted">Keine Termine im gewählten Zeitraum.</li>';
        return;
      }
      list.innerHTML = filtered
        .map((event) => {
          const date = event.parsedDate;
          return `<li>
            <strong>${escapeHtml(event.title)}</strong>
            <span class="meta">${date.toLocaleDateString('de-DE')} · ${date.toLocaleTimeString('de-DE', {
              hour: '2-digit',
              minute: '2-digit'
            })}</span>
            <span class="meta">${event.type === 'ORDER' ? 'Liefertermin' : event.type || 'Termin'}</span>
          </li>`;
        })
        .join('');
    }

    renderEventList();
  }

  async function initProzessstatus() {
    const container = document.getElementById('processGrid');
    const statusFilter = document.getElementById('processStatusFilter');
    if (!container) return;
    let allOrders = [];
    const COMPLETED_STATUS = 'UEBERGEBEN_AN_SPEDITION';
    const dateLocale = state.locale === 'tr' ? 'tr-TR' : 'de-DE';

    function renderProcessGrid(orders = []) {
      if (!orders.length) {
        container.innerHTML = `<p class="muted">${escapeHtml(translateTemplate('Keine Bestellungen für diesen Filter.'))}</p>`;
        return;
      }
      container.innerHTML = orders.map((order) => buildProcessCard(order)).join('');
    }

    function applyProcessFilters() {
      if (!container) return;
      const filterValue = statusFilter?.value || 'active';
      let filtered = allOrders.slice();
      if (filterValue === 'active') {
        filtered = filtered.filter((order) => order.portal_status !== COMPLETED_STATUS);
      } else if (filterValue === 'completed') {
        filtered = filtered.filter((order) => order.portal_status === COMPLETED_STATUS);
      }
      renderProcessGrid(filtered);
    }

    try {
      if (!state.orders || !state.orders.length) {
        state.orders = await request('/api/orders');
      }
      allOrders = state.orders || [];
      applyProcessFilters();
    } catch (err) {
      container.innerHTML = `<p class="muted">${escapeHtml(
        err.message || translateTemplate('Prozessdaten konnten nicht geladen werden.')
      )}</p>`;
    }

    if (statusFilter) {
      statusFilter.addEventListener('change', applyProcessFilters);
    }

    function formatLocalDate(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleDateString(dateLocale);
    }

    function buildProcessCard(order) {
      const currentIndex = STATUS_FLOW.indexOf(order.portal_status);
      const timelineMap = {};
      (order.timeline || []).forEach((entry) => {
        if (entry.status) {
          timelineMap[entry.status] = entry.created_at;
        }
      });
      const steps = STATUS_FLOW.map((status, index) => {
        const stepState = index < currentIndex ? 'completed' : index === currentIndex ? 'current' : 'upcoming';
        let dateValue = timelineMap[status] ? new Date(timelineMap[status]) : null;
        if (!dateValue && status === 'ORDER_EINGEREICHT' && order.created_at) {
          dateValue = new Date(order.created_at);
        }
        const actualLabel = dateValue ? formatLocalDate(dateValue) : '';
        const planLabel =
          status === 'WARE_ABHOLBEREIT' && order.requested_delivery
            ? formatLocalDate(order.requested_delivery)
            : '';
        const statusLabel = translateTemplate(STATUS_LABELS[status]);
        return `<div class="process-step ${stepState}">
          <div class="process-dot"></div>
          <div class="process-step-meta">
            ${
              planLabel
                ? `<small class="process-plan-label">${escapeHtml(
                    translateTemplate('Soll-Datum: {{date}}', { date: planLabel })
                  )}</small><p>${escapeHtml(statusLabel)}</p>`
                : `<p>${escapeHtml(statusLabel)}</p>`
            }
            ${actualLabel ? `<span>${actualLabel}</span>` : ''}
          </div>
        </div>`;
      }).join('');
      const orderLink = `/bestellung.html?order=${encodeURIComponent(order.id)}`;
      const customerLink = order.customer_id ? `/kunden.html?customer=${encodeURIComponent(order.customer_id)}` : null;
      const totalQuantity = deriveOrderQuantity(order);
      const quantityLabel = translateTemplate('Gesamtmenge');
      return `<article class="process-card">
        <div class="process-card-head">
          <div>
            <p class="muted">${escapeHtml(translateTemplate('Bestellnummer'))}</p>
            <h3><a href="${orderLink}">${escapeHtml(order.order_number || order.id)}</a></h3>
            <p class="process-quantity">${escapeHtml(quantityLabel)}: <strong>${totalQuantity}</strong></p>
          </div>
          <div class="process-card-meta">
            ${
              customerLink
                ? `<a class="badge ghost" href="${customerLink}">${escapeHtml(
                    order.customer_name || order.customer_id || translateTemplate('Kunde')
                  )}</a>`
                : `<span class="badge ghost">${escapeHtml(
                    order.customer_name || order.customer_id || translateTemplate('Kunde')
                  )}</span>`
            }
            ${getOrderTypeBadgeHtml(order.order_type)}
          </div>
        </div>
        <div class="process-timeline">
          ${steps}
        </div>
      </article>`;
    }
  }

  async function initPage(pageId) {
    try {
      await loadSession();
    } catch (err) {
      console.warn(err);
      return;
    }
    switch (pageId) {
      case 'dashboard':
        await initDashboard();
        break;
      case 'bestellungen':
        await initBestellungen();
        break;
      case 'bestellung':
        await initBestellung();
        break;
      case 'bestellung-neu':
        await initBestellungNeu();
        break;
      case 'artikel':
        await initArtikel();
        break;
      case 'artikel-neu':
        await initArtikelNeu();
        break;
      case 'kunden':
        await initKunden();
        break;
      case 'kunden-neu':
        await initKundenNeu();
        break;
      case 'tickets':
        await initTickets();
        break;
      case 'prozessstatus':
        await initProzessstatus();
        break;
      case 'kalender':
        await initKalender();
        break;
      case 'etiketten':
        await initEtikettenPage();
        break;
      case 'schuhbox':
        await initSchuhboxPage();
        break;
      case 'musterrechnung':
        await initMusterProformaPage();
        break;
      case 'musterrechnung-detail':
        await initMusterProformaDetailPage();
        break;
      case 'diagnostics':
        await initDiagnosticsPage();
        break;
      case 'translations':
        await initTranslationsPage();
        break;
      case 'notifications':
        await initNotificationsPage();
        break;
      case 'techpack-list':
        await initTechpackListPage();
        break;
      case 'techpack':
        await initTechpackPage();
        break;
      default:
        break;
    }
  }

  function initLogin() {
    const form = document.getElementById('loginForm');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      try {
        await request('/api/login', { method: 'POST', body: data });
        window.location.href = '/dashboard.html';
      } catch (err) {
        showToast(err.message);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const page = document.body?.dataset?.page;
    if (!page) return;
    ensureFavicon();
    renderSharedLayout(page);
    await initLocalization();
    if (page === 'login') {
      initLogin();
      applyTranslations();
    } else {
      await initPage(page);
      applyTranslations();
      setupTranslationObserver();
    }
  });

  return {
    initLogin,
    initPage,
    request,
    translate: translateTemplate
  };
})();

window.App = App;
      const moreOrdersBtn = document.getElementById('dashboardOrdersMore');
      if (moreOrdersBtn) {
        moreOrdersBtn.onclick = () => {
          window.location.href = '/bestellungen.html';
        };
      }
