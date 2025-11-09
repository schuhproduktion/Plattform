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
  VAT_RATE
} from './js/state.js';
import { request, ensureFreshSnapshot } from './js/api.js';
import { escapeHtml } from './js/utils.js';
import { showToast, renderSharedLayout, applyRoleVisibility, setBreadcrumbLabel } from './js/ui.js';

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

  function ensureTechpackActiveMedia(spec) {
    const media = spec?.flags?.medien || [];
    if (!media.length) {
      state.techpackActiveMedia = null;
      return;
    }
    const requested = state.techpackRequestedView?.toLowerCase();
    if (requested) {
      const match = media.find((entry) => entry.view_key === requested);
      if (match) {
        state.techpackActiveMedia = match.id;
        state.techpackRequestedView = null;
        return;
      }
      state.techpackActiveMedia = null;
      return;
    }
    if (state.techpackActiveMedia && media.some((entry) => entry.id === state.techpackActiveMedia)) {
      return;
    }
    state.techpackActiveMedia = media[0].id;
  }

  function getTechpackMediaById(mediaId) {
    return state.techpackSpec?.flags?.medien?.find((entry) => entry.id === mediaId);
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
      statusButton.title = statusButton.disabled ? 'Offene Rückfragen müssen zuerst geschlossen werden.' : '';
    }
  }

  function updateTechpackActionDisplay(media) {
    const uploadBtn = document.getElementById('uploadTechpackBtn');
    const replaceBtn = document.getElementById('replaceTechpackBtn');
    const deleteBtn = document.getElementById('deleteTechpackBtn');
    const hasMedia = Boolean(media);
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
    } catch (err) {
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
    } catch (err) {
      return `${amount} ${currency}`;
    }
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

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '–';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
    if (isDefaultLocale()) return;
    translateAttributes(root instanceof Element ? root : document.body);
    const base = root instanceof Element ? root : document.body;
    const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node?.textContent?.trim()) return NodeFilter.FILTER_REJECT;
        if (!node.parentElement) return NodeFilter.FILTER_REJECT;
        const tag = node.parentElement.tagName;
        if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(tag)) return NodeFilter.FILTER_REJECT;
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
    if (state.user?.role === 'SUPPLIER') {
      select.value = 'tr';
      select.disabled = true;
    } else {
      select.disabled = false;
    }
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
                <strong><a href="${buildTicketLink(ticket)}">${escapeHtml(ticket.title)}</a></strong>
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
                <div class="muted">Rückfragen: ${spec.rueckfragen || 0} · ${escapeHtml(formatRelativeTime(spec.updated_at))}</div>
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
    if (state.user.role !== 'BATE') {
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
    target.innerHTML = items
      .map((ticket) => {
        const link = buildTicketLink(ticket);
        const typeLabel = ticket.position_id ? 'Artikelticket' : 'Bestellticket';
        const previewUrl = getTicketPreviewImage(ticket);
        const preview = previewUrl
          ? `<div class="ticket-preview"><img src="${escapeHtml(previewUrl)}" alt="Ticket Vorschaubild" loading="lazy" /></div>`
          : '';
        return `<li>
          ${preview}
          <div class="ticket-list-body">
            <p class="ticket-list-title">${escapeHtml(ticket.title)}</p>
            <p class="ticket-list-meta">${ticket.id}</p>
            <p class="ticket-list-meta">Bestellnummer: ${ticket.order_id}${ticket.position_id ? ` · ${ticket.position_id}` : ''}</p>
            <p class="ticket-list-meta">Art: ${typeLabel}</p>
            <div class="ticket-row-actions">
              <a class="ghost small" href="${link}" ${ticket.position_id ? 'target="_blank" rel="noopener"' : ''}>Öffnen</a>
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
      container.innerHTML = '<p class="muted">Keine Größen für diese Bestellung vorhanden.</p>';
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
        return `
          <div class="carton-row ${isActive ? 'active' : ''}" data-index="${index}">
            <div class="carton-row-head">
              <label class="selector">
                <input type="radio" name="cartonSelection" ${isActive ? 'checked' : ''} data-carton-select="${index}" />
                Karton ${carton.number}
              </label>
              <input type="number" min="1" step="1" value="${carton.number}" data-carton-number="${index}" />
              <button type="button" class="ghost carton-remove" data-remove-carton="${index}" aria-label="Karton entfernen">×</button>
            </div>
            <div class="carton-meta-grid">
              <label>Variation-Nr.
                <input type="text" data-carton-meta="variation" data-carton="${index}" value="${escapeHtml(meta.variation || '')}" />
              </label>
              <label>Artikel-Nr.
                <input type="text" data-carton-meta="article" data-carton="${index}" value="${escapeHtml(meta.article || '')}" />
              </label>
              <label>Leder &amp; Farbe
                <input type="text" data-carton-meta="leather" data-carton="${index}" value="${escapeHtml(meta.leather || '')}" />
              </label>
              <label>Sohle
                <input type="text" data-carton-meta="sole" data-carton="${index}" value="${escapeHtml(meta.sole || '')}" />
              </label>
            </div>
            <div class="carton-size-grid">
              ${sizeInputs}
            </div>
          </div>`;
      })
      .join('');
    container.innerHTML = rows || '<p class="muted">Keine Kartons konfiguriert.</p>';
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

  function getStatusChoice(code) {
    return STATUS_CHOICES.find((entry) => entry.code === code);
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
    if (state.user?.locale && state.user.locale !== state.locale) {
      await changeLocale(state.user.locale, { syncServer: false });
      return;
    }
    const label = document.getElementById('userLabel');
    if (label) label.textContent = `${state.user.email} (${state.user.role})`;
    applyRoleVisibility();
    updateLanguageSwitcherState();
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await request('/api/logout', { method: 'POST' });
        window.location.href = '/login.html';
      });
    }
    const bell = document.getElementById('notificationBell');
    if (bell) {
      bell.addEventListener('click', async () => {
        await markNotificationsAsRead();
      });
    }
  }

  async function markNotificationsAsRead() {
    await refreshNotifications();
    await Promise.all(
      state.notifications.map((n) => request(`/api/notifications/${n.id}/read`, { method: 'PATCH' }).catch(() => {}))
    );
    await refreshNotifications();
  }

  async function refreshNotifications() {
    if (!state.user) return;
    const notifications = await request('/api/notifications?unread=true');
    state.notifications = notifications;
    const badge = document.getElementById('notificationCount');
    if (badge) badge.textContent = notifications.length;
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
      subtitle.textContent = 'Kundenspezifisches Verpackungsset';
      return;
    }
    const customer = state.customers.find((entry) => entry.id === customerId);
    const label = customer?.name || customerId;
    if (!accessories.length) {
      subtitle.textContent = `${label} · noch kein Zubehör hinterlegt`;
      return;
    }
    const latest = accessories.reduce((latestDate, entry) => {
      if (!entry.updated_at) return latestDate;
      const ts = new Date(entry.updated_at).getTime();
      if (!latestDate) return ts;
      return ts > latestDate ? ts : latestDate;
    }, null);
    const formatted = latest ? new Date(latest).toLocaleDateString('de-DE') : 'aktuell';
    subtitle.textContent = `${label} · Stand ${formatted}`;
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

  function bindTabs() {
    document.querySelectorAll('.tabs button').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('.tabs button').forEach((btn) => btn.classList.remove('active'));
        button.classList.add('active');
        document.querySelectorAll('.tab-content').forEach((content) => content.classList.add('hidden'));
        const tabId = button.dataset.tab;
        const target = document.getElementById(`${tabId}Tab`);
        if (target) target.classList.remove('hidden');
      });
    });
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

      const productionTable = document.getElementById('productionTable');
      const pendingOrders = orders.filter((order) => order.portal_status === 'ORDER_EINGEREICHT');
      setKpiValue('kpiNewOrders', pendingOrders.length);
      productionTable.innerHTML = pendingOrders.length
        ? pendingOrders
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

    const loadOrders = async () => {
      const data = new FormData(filters);
      const params = new URLSearchParams();
      for (const [key, value] of data.entries()) {
        if (value) params.append(key, value);
      }
      const query = params.toString();
      const orders = await request(`/api/erp/orders${query ? `?${query}` : ''}`);
      renderOrderTable(orders);
    };

    const scheduleFilterReload = () => {
      clearTimeout(filterDebounce);
      filterDebounce = setTimeout(loadOrders, 250);
    };

    const renderOrderTable = (orders) => {
      table.innerHTML = orders
        .map(
          (order) => `
        <tr data-order-id="${order.id}">
          <td>${order.order_number}</td>
          <td><span class="badge">${formatStatus(order.portal_status)}</span></td>
          <td>${order.customer_name || order.customer_id}</td>
          <td>${getOrderTypeBadgeHtml(order.order_type)}</td>
          <td>${formatDate(order.requested_delivery)}</td>
          <td>${formatMoney(deriveOrderTotal(order), order.currency)}</td>
        </tr>`
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

  async function initBestellung() {
    const backButton = document.getElementById('backToList');
    const [orders, customers, addresses, contacts, erpItems] = await Promise.all([
      request('/api/orders'),
      request('/api/erp/customers'),
      request('/api/erp/addresses'),
      request('/api/erp/contacts'),
      request('/api/erp/items')
    ]);
    state.orders = orders;
    state.customers = customers;
    state.addresses = addresses;
    state.contacts = contacts;
    state.erpItems = erpItems;
    const params = new URLSearchParams(window.location.search);
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

  async function initEtikettenPage() {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get('order');
    if (!orderId) {
      showToast('Keine Bestellung ausgewählt');
      return;
    }
    try {
      const [order, customers, addresses, erpItems] = await Promise.all([
        request(`/api/orders/${orderId}`),
        request('/api/erp/customers'),
        request('/api/erp/addresses'),
        request('/api/erp/items')
      ]);
      state.selectedOrder = order;
      state.customers = customers;
      state.addresses = addresses;
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
      showToast('Keine Bestellung ausgewählt');
      return;
    }
    try {
      const [order, erpItems] = await Promise.all([request(`/api/orders/${orderId}`), request('/api/erp/items')]);
      state.selectedOrder = order;
      state.erpItems = erpItems;
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

  async function initDiagnosticsPage() {
    setBreadcrumbLabel('Systemstatus');
    await loadDiagnostics();
    const refreshBtn = document.getElementById('diagnosticsRefresh');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => loadDiagnostics());
    }
    if (!state.diagnosticsInterval) {
      state.diagnosticsInterval = setInterval(loadDiagnostics, 60000);
    }
  }

  async function printShoeboxLabels() {
    const orderId = state.selectedOrder?.id;
    if (!orderId) {
      showToast('Keine Bestellung gewählt');
      return;
    }
    const rows = (state.shoeboxRows || []).filter((row) => Number(row.quantity) > 0);
    if (!rows.length) {
      showToast('Bitte mindestens eine Menge hinterlegen.');
      return;
    }
    const payload = {
      labels: rows.map((row) => ({
        article_number: row.articleNumber,
        name: row.name,
        color_code: row.colorCode,
        size: row.size,
        image_url: row.imageUrl,
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
        throw new Error(error?.error || 'PDF konnte nicht erstellt werden');
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
      state.orderTickets = Array.isArray(data.tickets) ? data.tickets.filter((ticket) => !ticket.position_id) : [];
      setText('orderNumber', data.order_number || '-');
      setText('orderDelivery', formatDate(data.requested_delivery));
      setText('orderTotal', formatMoney(deriveOrderTotal(data), data.currency));
      renderStatusControl(data);
      const shipping = data.shipping || {};
      setText('shippingPayer', shipping.payer === 'KUNDE' ? 'Kunde' : shipping.payer || '-');
      setText('shippingMethod', shipping.method || '-');
      setText('shippingPackaging', shipping.packaging || '-');
      const pickupText = shipping.pickup
        ? 'Kunde holt Ware ab'
        : shipping.payer === 'KUNDE'
        ? 'Kunde beauftragt Versand'
        : 'BATE organisiert Versand';
      setText('shippingPickup', pickupText);
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
      const customerDisplayName = customerSnapshot?.name || data.customer_name || customer?.name || 'Kunde';
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
      setText('customerNameValue', customerDisplayName);
      setText('customerStreet', billingDisplay?.street || '-');
      setText('customerCity', billingDisplay?.city || '-');
      setText('customerCountry', billingDisplay?.country || '');
      setText('customerTax', `Steuernummer: ${customerSnapshot?.tax_id || customer?.tax_id || 'nicht hinterlegt'}`);
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
        const baseNameRaw = codeMatch ? description.replace(new RegExp(`\s*${codeMatch[1]}$`, 'i'), '').trim() : description;
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
    const activeEntry = media.find((entry) => entry.id === state.techpackActiveMedia) || null;
    updateTechpackStatusDisplay(activeEntry);
    renderTechpackStage(media, stageImg, hint, stage);
    renderTechpackAnnotations();
  }

  function renderTechpackStage(media, stageImg, hint, stage) {
    if (!media.length) {
      if (stage) stage.classList.add('techpack-stage-empty');
      stageImg.src = '';
      stageImg.alt = 'Keine Medien vorhanden';
      if (hint) hint.textContent = 'Bitte zuerst ein Bild hochladen.';
      state.techpackActiveMedia = null;
      return;
    }
    if (!state.techpackActiveMedia) {
      if (stage) stage.classList.remove('techpack-stage-empty');
      stageImg.src = '';
      stageImg.alt = 'Bitte Ansicht wählen';
      if (hint) {
        hint.textContent = state.techpackRequestedView ? 'Bitte zuerst ein Bild hochladen.' : 'Bitte zuerst eine Ansicht wählen.';
      }
      return;
    }
    if (stage) stage.classList.remove('techpack-stage-empty');
    const active = media.find((entry) => entry.id === state.techpackActiveMedia);
    if (!active) {
      state.techpackActiveMedia = null;
      renderTechpackStage(media, stageImg, hint, stage);
      return;
    }
    stageImg.src = active.url || '';
    stageImg.alt = active.label || active.id || 'Artikelspezifikation';
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
          `<button type=\"button\" data-index=\"${idx}\" style=\"left:${ann.x * 100}%;top:${ann.y * 100}%\" title=\"${escapeHtml(
            ann.note
          )}\">${idx + 1}</button>`
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
        : '<span class="muted">–</span>';
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
    const tickets = (state.tickets || []).filter(
      (ticket) =>
        ticket.order_id === orderId &&
        ticket.position_id === positionId &&
        ticketMatchesView(ticket, effectiveView)
    );
    if (badge) badge.textContent = tickets.length.toString();
    if (!tickets.length) {
      list.innerHTML = '<p class="muted">Noch keine Tickets.</p>';
      return;
    }
    list.innerHTML = tickets
      .map((ticket) => {
        const isOpen = ticket.status !== 'CLOSED';
        const statusBadge = `<span class="badge ${isOpen ? 'warning' : 'success'}">${isOpen ? 'Offen' : 'OK'}</span>`;
        const viewLabel = ticket.view_key ? getTechpackViewLabel(ticket.view_key) : 'Allgemein';
        const viewBadge = `<span class="badge ghost">${escapeHtml(viewLabel)}</span>`;
        const comments = renderTicketCommentsHtml(ticket);
        return `
          <article class="ticket-card collapsed" data-ticket="${ticket.id}">
            <div class="ticket-header" data-ticket-toggle="${ticket.id}">
              <div class="ticket-header-info">
                <strong>${escapeHtml(ticket.title)}</strong>
                <small>${ticket.id} · ${ticket.priority || 'mittel'} · ${new Date(ticket.created_at).toLocaleDateString('de-DE')}</small>
              </div>
              <div class="ticket-header-meta">
                ${viewBadge}
                ${statusBadge}
                <span class="chevron">⌄</span>
              </div>
            </div>
            <div class="ticket-body">
              <div class="ticket-meta">
                <ul class="ticket-comments">${comments}</ul>
                <form class="ticket-comment-form" data-ticket-id="${ticket.id}">
                  ${buildCommentFormFields()}
                  <div class="ticket-comment-actions">
                    ${buildAutoTranslateButton()}
                    <input type="file" name="file" accept="image/*,application/pdf,.zip,.doc,.docx" />
                    <button type="submit" class="small">Antwort senden</button>
                  </div>
                </form>
              </div>
              <div class="ticket-status">
                ${statusBadge}
                <button type="button" class="ghost small" data-ticket-action="${isOpen ? 'close' : 'reopen'}" data-ticket-id="${ticket.id}">
                  ${isOpen ? 'Als geklärt markieren' : 'Wieder öffnen'}
                </button>
                <button type="button" class="ghost small danger" data-ticket-delete="${ticket.id}">Löschen</button>
              </div>
            </div>
          </article>`;
      })
      .join('');
    list.querySelectorAll('button[data-ticket-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const ticketId = button.dataset.ticketId;
        const action = button.dataset.ticketAction;
        if (!ticketId || !action) return;
        const nextStatus = action === 'close' ? 'CLOSED' : 'OPEN';
        await updateTicketStatus(ticketId, nextStatus, {
          type: 'techpack',
          orderId,
          positionId,
          viewKey: effectiveView
        });
      });
    });
    list.querySelectorAll('button[data-ticket-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        const ticketId = button.dataset.ticketDelete;
        if (!ticketId) return;
        if (!window.confirm('Ticket wirklich löschen?')) return;
        try {
          await deleteTicket(ticketId);
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
        if (!commentId || !ticketId) return;
        if (!window.confirm('Kommentar wirklich löschen?')) return;
        try {
          await deleteTicketComment(ticketId, commentId);
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
  }

  function resolveTicketCommentText(comment) {
    if (!comment) return '';
    const preferred = state.user?.role === 'BATE' ? 'de' : 'tr';
    if (preferred === 'de') {
      return comment.message_de || comment.message || comment.message_tr || '';
    }
    return comment.message_tr || comment.message || comment.message_de || '';
  }

  function buildCommentFormFields() {
    const isBate = state.user?.role === 'BATE';
    if (isBate) {
      return `
        <div class="comment-fields bilingual">
          <textarea name="message_de" rows="2" placeholder="Antwort (Deutsch)"></textarea>
          <textarea name="message_tr" rows="2" placeholder="Antwort (Türkisch)"></textarea>
        </div>`;
    }
    return `
      <div class="comment-fields">
        <textarea name="message_tr" rows="2" placeholder="Antwort hinzufügen"></textarea>
      </div>`;
  }

  function buildAutoTranslateButton() {
    if (state.user?.role !== 'BATE') return '';
    return '<button type="button" class="ghost small auto-translate-btn">Automatisch übersetzen</button>';
  }

  function renderTicketCommentsHtml(ticket) {
    const dateLocale = state.locale === 'tr' ? 'tr-TR' : 'de-DE';
    const comments = (ticket.comments || [])
      .map((comment) => {
        const attachment = comment.attachment
          ? `<a href="${escapeHtml(comment.attachment.url)}" target="_blank" rel="noopener">Anhang anzeigen</a>`
          : '';
        const isMine = comment.author === state.user?.email;
        const commentClass = isMine ? 'comment-mine' : 'comment-other';
        const preview = comment.attachment
          ? `<img src="${escapeHtml(comment.attachment.url)}" alt="Anhang" class="ticket-attachment-preview" />`
          : '';
        const timestamp = comment.ts ? new Date(comment.ts).toLocaleString(dateLocale) : '';
        const body = resolveTicketCommentText(comment);
        return `<li class="${commentClass}">
          <div class="comment-content">
            <p><strong>${escapeHtml(comment.author || 'Unbekannt')}</strong>${timestamp ? ` · ${timestamp}` : ''}</p>
            <p>${escapeHtml(body)}</p>
            ${preview}${attachment ? `<div class="attachment-link">${attachment}</div>` : ''}
          </div>
          <button type="button" class="ghost small danger" data-comment-delete="${comment.id}" data-ticket="${ticket.id}">Löschen</button>
        </li>`;
      })
      .join('');
    return comments || '<li class="muted">Noch keine Antworten.</li>';
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
    badge.title = hasOpen ? `${openCount} offene Tickets` : 'Keine offenen Tickets';
  }

  function getTicketContextLabel(ticket) {
    const baseLabel = ticket.position_id ? ticket.position_id : 'Bestellung';
    if (ticket.view_key) {
      return `${baseLabel} · ${getTechpackViewLabel(ticket.view_key)}`;
    }
    return baseLabel;
  }

  function renderOrderTickets(order = state.selectedOrder) {
    const list = document.getElementById('orderTicketsList');
    const badge = document.getElementById('orderTicketsCount');
    if (!list || !order) return;
    const tickets = (state.orderTickets || []).filter((ticket) => ticket.order_id === order.id);
    if (badge) badge.textContent = tickets.length.toString();
    if (!tickets.length) {
      list.innerHTML = '<p class="muted">Noch keine Tickets.</p>';
      return;
    }
    list.innerHTML = tickets
      .map((ticket) => {
        const isOpen = ticket.status !== 'CLOSED';
        const statusBadge = `<span class="badge ${isOpen ? 'warning' : 'success'}">${isOpen ? 'Offen' : 'OK'}</span>`;
        const contextBadge = `<span class="badge ghost">${escapeHtml(getTicketContextLabel(ticket))}</span>`;
        const comments = renderTicketCommentsHtml(ticket);
        return `
          <article class="ticket-card collapsed" data-ticket="${ticket.id}">
            <div class="ticket-header" data-ticket-toggle="${ticket.id}">
              <div class="ticket-header-info">
                <strong>${escapeHtml(ticket.title)}</strong>
                <small>${ticket.id} · ${ticket.priority || 'mittel'} · ${new Date(ticket.created_at).toLocaleDateString('de-DE')}</small>
              </div>
              <div class="ticket-header-meta">
                ${contextBadge}
                ${statusBadge}
                <span class="chevron">⌄</span>
              </div>
            </div>
            <div class="ticket-body">
              <div class="ticket-meta">
                <ul class="ticket-comments">${comments}</ul>
                <form class="ticket-comment-form" data-ticket-id="${ticket.id}">
                  ${buildCommentFormFields()}
                  <div class="ticket-comment-actions">
                    ${buildAutoTranslateButton()}
                    <input type="file" name="file" accept="image/*,application/pdf,.zip,.doc,.docx" />
                    <button type="submit" class="small">Antwort senden</button>
                  </div>
                </form>
              </div>
              <div class="ticket-status">
                ${statusBadge}
                <button type="button" class="ghost small" data-ticket-action="${isOpen ? 'close' : 'reopen'}" data-ticket-id="${ticket.id}">
                  ${isOpen ? 'Als geklärt markieren' : 'Wieder öffnen'}
                </button>
                <button type="button" class="ghost small danger" data-ticket-delete="${ticket.id}">Löschen</button>
              </div>
            </div>
          </article>`;
      })
      .join('');
    list.querySelectorAll('button[data-ticket-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        const { ticketId, ticketAction } = button.dataset;
        if (!ticketId || !ticketAction) return;
        const nextStatus = ticketAction === 'close' ? 'CLOSED' : 'OPEN';
        await updateTicketStatus(ticketId, nextStatus, { type: 'order', orderId: order.id });
      });
    });
    list.querySelectorAll('button[data-ticket-delete]').forEach((button) => {
      button.addEventListener('click', async () => {
        const ticketId = button.dataset.ticketDelete;
        if (!ticketId) return;
        if (!window.confirm('Ticket wirklich löschen?')) return;
        try {
          await deleteTicket(ticketId);
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
        if (!commentId || !ticketId) return;
        if (!window.confirm('Kommentar wirklich löschen?')) return;
        try {
          await deleteTicketComment(ticketId, commentId);
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
      });
    });
    bindOrderTicketCommentForms(order.id);
    renderOrderTicketSummary(order);
  }

  function bindOrderTicketCommentForms(orderId) {
    document.querySelectorAll('#orderTicketsList .ticket-comment-form').forEach((form) => {
      if (form.dataset.bound === 'true') return;
      form.dataset.bound = 'true';
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const ticketId = form.dataset.ticketId;
        if (!ticketId) return;
        const payload = collectCommentPayload(form);
        if (!payload) return;
        try {
          await submitTicketComment(ticketId, payload);
          form.reset();
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
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const currentOrderId = form.dataset.orderId || state.selectedOrder?.id;
      if (!currentOrderId) return;
      const data = new FormData(form);
      const title = data.get('title')?.toString().trim();
      if (!title) {
        showToast('Bitte eine Rückfrage eingeben.');
        return;
      }
      const priority = data.get('priority') || 'mittel';
      try {
        const ticket = await request('/api/tickets', {
          method: 'POST',
          body: {
            order_id: currentOrderId,
            title,
            priority
          }
        });
        state.orderTickets = [...(state.orderTickets || []), ticket];
        form.reset();
        renderOrderTickets(state.selectedOrder);
        showToast('Rückfrage gespeichert');
      } catch (err) {
        showToast(err.message);
      }
    });
    form.dataset.bound = 'true';
  }

  function bindTechpackTicketForm(orderId, positionId) {
    const form = document.getElementById('techpackTicketForm');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const title = data.get('title')?.toString().trim();
      if (!title) {
        showToast('Bitte eine Rückfrage eingeben.');
        return;
      }
      const priority = data.get('priority') || 'mittel';
      const viewKey = resolveActiveViewKey();
      if (!viewKey) {
        showToast('Bitte zuerst eine Ansicht laden.');
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
        showToast('Rückfrage gespeichert');
      } catch (err) {
        showToast(err.message);
      }
    });
  }

  function bindTicketCommentForms(orderId, positionId, viewKey = resolveActiveViewKey()) {
    document.querySelectorAll('.ticket-comment-form').forEach((form) => {
      if (form.dataset.bound === 'true') return;
      form.dataset.bound = 'true';
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const ticketId = form.dataset.ticketId;
        if (!ticketId) return;
        const payload = collectCommentPayload(form);
        if (!payload) return;
        try {
          await submitTicketComment(ticketId, payload);
          form.reset();
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

  function collectCommentPayload(form) {
    const messageDe = form.querySelector('textarea[name="message_de"]')?.value.trim() || '';
    const messageTr = form.querySelector('textarea[name="message_tr"]')?.value.trim() || '';
    const fileInput = form.querySelector('input[name="file"]');
    const file = fileInput?.files?.[0];
    const isBate = state.user?.role === 'BATE';
    if (!messageDe && !messageTr && !file) {
      showToast('Kommentar oder Datei erforderlich.');
      return null;
    }
    if (isBate && !file && (!messageDe || !messageTr)) {
      showToast('Bitte Deutsch und Türkisch ausfüllen.');
      return null;
    }
    if (!isBate && !file && !messageTr) {
      showToast('Bitte türkische Antwort eingeben.');
      return null;
    }
    return {
      message_de: messageDe,
      message_tr: messageTr,
      file: file || null
    };
  }

  async function handleAutoTranslate(form, button) {
    const messageDeField = form.querySelector('textarea[name="message_de"]');
    const messageTrField = form.querySelector('textarea[name="message_tr"]');
    if (!messageDeField || !messageTrField) {
      showToast('Automatische Übersetzung nur für BATE verfügbar.');
      return;
    }
    const sourceText = messageDeField.value.trim() || messageTrField.value.trim();
    if (!sourceText) {
      showToast('Bitte zuerst Text eingeben.');
      return;
    }
    const sourceLang = messageDeField.value.trim() ? 'de' : 'tr';
    const targetLang = sourceLang === 'de' ? 'tr' : 'de';
    const targetField = sourceLang === 'de' ? messageTrField : messageDeField;
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Übersetze...';
    try {
      const response = await request('/api/translate', {
        method: 'POST',
        body: {
          text: sourceText,
          source: sourceLang,
          target: targetLang
        }
      });
      targetField.value = response?.translation || '';
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
      if (!state.techpackActiveMedia) {
        showToast('Bitte zuerst ein Bild hochladen.');
        return;
      }
      if (event.target.closest('.techpack-annotation-layer button')) return;
      if (!state.techpackActiveMedia) return;
      const rect = stage.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      if (x < 0 || y < 0 || x > 1 || y > 1) return;
      const note = prompt('Kommentar für diesen Punkt:');
      if (!note) return;
      try {
        await addTechpackAnnotation(orderId, positionId, state.techpackActiveMedia, x, y, note);
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
      if (!file || !activeMedia) {
        input.value = '';
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
      if (!activeMedia) {
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
    await request(`/api/tickets/${ticketId}`, {
      method: 'PATCH',
      body: { status }
    });
    state.tickets = (state.tickets || []).map((ticket) =>
      ticket.id === ticketId ? { ...ticket, status } : ticket
    );
    state.orderTickets = (state.orderTickets || []).map((ticket) =>
      ticket.id === ticketId ? { ...ticket, status } : ticket
    );
    if (context.type === 'techpack' && context.orderId && context.positionId) {
      const nextView = context.viewKey || resolveActiveViewKey();
      renderTechpackTickets(context.orderId, context.positionId, nextView);
      updateTechpackStatusDisplay(getActiveTechpackMedia());
    } else if (context.type === 'order') {
      renderOrderTickets(state.selectedOrder || { id: context.orderId });
    }
  }

  async function submitTicketComment(ticketId, payload) {
    const data = new FormData();
    if (payload.message_de) data.append('message_de', payload.message_de);
    if (payload.message_tr) data.append('message_tr', payload.message_tr);
    if (payload.file) data.append('file', payload.file);
    const comment = await request(`/api/tickets/${ticketId}/comment`, {
      method: 'POST',
      body: data
    });
    state.tickets = (state.tickets || []).map((ticket) =>
      ticket.id === ticketId
        ? { ...ticket, comments: [...(ticket.comments || []), comment] }
        : ticket
    );
    state.orderTickets = (state.orderTickets || []).map((ticket) =>
      ticket.id === ticketId
        ? { ...ticket, comments: [...(ticket.comments || []), comment] }
        : ticket
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

  async function deleteTicket(ticketId) {
    await request(`/api/tickets/${ticketId}`, { method: 'DELETE' });
    state.tickets = (state.tickets || []).filter((ticket) => ticket.id !== ticketId);
    state.orderTickets = (state.orderTickets || []).filter((ticket) => ticket.id !== ticketId);
    showToast('Ticket gelöscht');
  }

  async function deleteTicketComment(ticketId, commentId) {
    await request(`/api/tickets/${ticketId}/comment/${commentId}`, { method: 'DELETE' });
    state.tickets = (state.tickets || []).map((ticket) =>
      ticket.id === ticketId
        ? { ...ticket, comments: (ticket.comments || []).filter((comment) => comment.id !== commentId) }
        : ticket
    );
    state.orderTickets = (state.orderTickets || []).map((ticket) =>
      ticket.id === ticketId
        ? { ...ticket, comments: (ticket.comments || []).filter((comment) => comment.id !== commentId) }
        : ticket
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
    try {
      const payload = {
        sizes: state.sizeList,
        defaults: state.cartonDefaults,
        cartons: state.labelCartons.map((carton) => serializeCarton(carton))
      };
      await request(`/api/customers/${encodeURIComponent(customerId)}/packaging/${encodeURIComponent(type)}`, {
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

  async function saveShoeboxPackaging(customerId) {
    if (!customerId) {
      showToast('Kein Kunde verknüpft');
      return;
    }
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
        }))
      };
      await request(`/api/customers/${encodeURIComponent(customerId)}/packaging/shoebox`, {
        method: 'POST',
        body: payload
      });
      showToast('Kundenlayout gespeichert');
    } catch (err) {
      showToast(err.message);
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
      hint.textContent = order.customer_name ? `Etikettvorlage für ${order.customer_name}` : 'Kundenspezifisches Layout';
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
    select.disabled = state.user?.role !== 'BATE';
    if (!select.dataset.bound) {
      select.addEventListener('change', (event) => {
        const nextStatus = event.target.value;
        if (!nextStatus || !state.selectedOrder) return;
        if (nextStatus === state.selectedOrder.portal_status) return;
        updateOrderStatus(nextStatus);
      });
      select.dataset.bound = 'true';
    }
    const typeSelect = document.getElementById('orderTypeSelect');
    if (typeSelect) {
      const nextValue = order.order_type || '';
      typeSelect.value = nextValue;
      typeSelect.disabled = state.user?.role !== 'BATE';
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
      showToast('Kein Karton ausgewählt');
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
        : '<p class="muted">Keine Größeninformationen hinterlegt.</p>';
    const customerLines = [
      data.order_customer?.name,
      ...(data.order_customer?.address_lines || []),
      data.order_customer?.tax_id ? `Steuernummer: ${data.order_customer.tax_id}` : null
    ]
      .filter(Boolean)
      .map((line) => escapeHtml(line));
    container.innerHTML = `
      <div class="carton-label">
        <div class="label-row top">
          <div>
            <p class="label-heading">${escapeHtml(data.warehouse_title || '')}</p>
            <p>${formatLines(data.warehouse_lines)}</p>
          </div>
          <div>
            <p class="label-heading">Bestell-Nr.</p>
            <p class="order-number-value">${escapeHtml(data.order_number || '')}</p>
            <div class="supplier-block">
              <p class="label-heading">${escapeHtml(data.supplier_title || '')}</p>
              <p>${formatLines(data.supplier_lines)}</p>
            </div>
          </div>
          <div class="carton-total">
            <p>Karton gesamt</p>
            <span>${escapeHtml(data.carton?.total ?? '')}</span>
          </div>
          <div class="carton-number">
            <p>Karton-Nr.</p>
            <span>${escapeHtml(data.carton?.number ?? '')}</span>
          </div>
        </div>
        <div class="label-row meta">
          <div><strong>Variation-Nr.:</strong> ${escapeHtml(data.variation || '-')}</div>
          <div><strong>Artikel-Nr.:</strong> ${escapeHtml(data.article_number || '-')}</div>
        </div>
        <div class="label-row meta">
          <div><strong>${escapeHtml(data.leather_label)}</strong> ${escapeHtml(data.leather_value || '-')}</div>
          <div><strong>${escapeHtml(data.sole_label)}</strong> ${escapeHtml(data.sole_value || '-')}</div>
        </div>
        ${sizeSection}
        <div class="label-footer">
          <div class="label-customer">
            <strong>Kunde</strong>
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
        showToast('Etikett konnte nicht erzeugt werden.');
        return;
      }
    }
    const popup = window.open('', '_blank');
    if (!popup) {
      showToast('Popup blockiert – bitte Popup-Blocker deaktivieren.');
      return;
    }
    popup.document.write(
      `<html><head><title>Kartonetikett ${escapeHtml(
        state.selectedOrder?.order_number || ''
      )}</title><link rel="stylesheet" href="/styles.css" /></head><body class="label-print">${state.currentLabelHtml}</body></html>`
    );
    popup.document.close();
    popup.focus();
    popup.print();
  }

  async function printAllCartonLabels(orderId = state.selectedOrder?.id) {
    if (!orderId) return;
    if (!state.labelCartons.length) {
      showToast('Keine Kartons konfiguriert.');
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
        throw new Error(error?.error || 'PDF konnte nicht erstellt werden');
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
    setBreadcrumbLabel('Artikel');
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
    setBreadcrumbLabel('Kunden');
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
      const groupSelect = document.getElementById('artikelGroupFilter');
      let filteredItems = erpItems.slice();

      if (groupSelect) {
        const groups = Array.from(new Set(erpItems.map((item) => item.item_group).filter(Boolean))).sort();
        groupSelect.innerHTML = ['<option value="">Alle Artikelgruppen</option>', ...groups.map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`)].join('');
      }

      const renderRows = (items) => {
        if (!items.length) {
          table.innerHTML = '<tr><td colspan="4" class="muted">Keine Artikel gefunden.</td></tr>';
          return;
        }
        table.innerHTML = items
          .map((item) => {
            const thumbnail = item.media?.hero || item.media?.gallery?.[0]?.url || null;
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
      const message = err?.message || 'Artikel konnten nicht geladen werden.';
      table.innerHTML = `<tr><td colspan="3" class="muted">${escapeHtml(message)}</td></tr>`;
      showToast(message);
    }
  }

  function openArtikelDetail(itemCode) {
    if (!itemCode) return;
    const item = state.erpItems?.find((entry) => entry.item_code === itemCode);
    if (!item) {
      showToast('Artikel nicht gefunden');
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
      showToast('Kunde nicht gefunden');
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
    if (!customer) {
      container.innerHTML = '<p class="muted">Bitte einen Kunden auswählen.</p>';
      setBreadcrumbLabel('Kunden');
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
      { label: 'Kundennummer', value: customer.id },
      { label: 'Kundenname', value: customer.name },
      { label: 'Steuernummer', value: customer.tax_id },
      { label: 'Account Manager', value: customer.account_manager }
    ];
    const infoRowTwo = [
      { label: 'WooCommerce Benutzer', value: customer.woocommerce_user || '-' },
      { label: 'WooCommerce Passwort', value: customer.woocommerce_password_hint || '–' },
      { label: 'Priorität', value: customer.priority || '-' },
      { label: 'Status', value: customer.status || '-' }
    ];
    const addressCards = [];
    addressCards.push(buildCustomerAddressCard('Rechnungsadresse', billingAddress));
    addressCards.push(buildCustomerAddressCard('Lieferadresse', shippingAddress));
    otherAddresses.forEach((addr, idx) => {
      addressCards.push(buildCustomerAddressCard(`${addr.type || 'Adresse'} ${idx + 1}`, addr));
    });
    setBreadcrumbLabel(`Kunden · ${customer.name}`);
    container.innerHTML = `
      <div class="customer-profile-head">
        <div class="customer-status-meta">
          <p class="muted">Kunde</p>
          <h2>${escapeHtml(customer.name)}</h2>
          <span class="status-pill ${statusMeta.className}">${statusMeta.label}</span>
        </div>
        <div class="customer-avatar">${escapeHtml(getCustomerInitials(customer.name))}</div>
      </div>
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
        ${detailField('Ansprechpartner', contact?.name || '-')}
        ${detailField('E-Mail', contact?.email || '-')}
        ${detailField('Telefon', contact?.phone || '-')}
      </section>
      <section class="customer-accessories">
        <div class="customer-accessories-head">
          <h4>Zubehör</h4>
          <p class="muted" id="customerAccessoriesSubtitle">Kundenspezifisches Verpackungsset</p>
        </div>
        <div id="customerAccessories" class="accessories-placeholder">
          <p class="muted">Keine Daten geladen.</p>
        </div>
      </section>
    `;
    refreshCustomerAccessories(customer.id, {
      force: true,
      containerId: 'customerAccessories',
      subtitleId: 'customerAccessoriesSubtitle'
    }).catch((err) => console.warn('Accessory load failed for customer', err));
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
  }

  function renderShoeboxTable() {
    const table = document.getElementById('shoeboxTable');
    if (!table) return;
    const entries = state.shoeboxRows || [];
    if (!entries.length) {
      table.innerHTML = '<tr><td colspan="6" class="muted">Keine Schuhbox-Etiketten vorhanden.</td></tr>';
      return;
    }
    table.innerHTML = entries
      .map((entry) => {
        const imageCell = entry.imageUrl
          ? `<img src="${escapeHtml(entry.imageUrl)}" alt="${escapeHtml(entry.name)}" loading="lazy" />`
          : '<span class="muted">Kein Bild</span>';
        return `<tr data-row-id="${entry.id}">
          <td>${escapeHtml(entry.articleNumber)}</td>
          <td>${imageCell}</td>
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
  }

  function updateShoeboxQuantity(rowId, value) {
    const row = state.shoeboxRows.find((entry) => entry.id === rowId);
    if (!row) return;
    const next = Math.max(0, Math.floor(Number(value) || 0));
    row.quantity = next;
    const input = document.querySelector(`.shoebox-quantity-input[data-row-id="${rowId}"]`);
    if (input) input.value = String(next);
  }

  function renderArtikelDetail(item) {
    const container = document.getElementById('artikelDetail');
    if (!container) return;
    if (!item) {
      container.innerHTML = '<p class="muted">Bitte einen Artikel auswählen.</p>';
      setBreadcrumbLabel('Artikel');
      setArtikelHeaderLinks(null);
      return;
    }
    const statusMeta = getItemStatusMeta(item);
    const colorCode = getItemColorCode(item);
    const heroFields = [
      { label: 'Artikelnummer', value: item.item_code },
      { label: 'Artikelname', value: item.item_name }
    ];
    const detailFields = [
      { label: 'Farbcode', value: colorCode },
      { label: 'Artikelgruppe', value: item.item_group },
      { label: 'Kollektion', value: item.collection },
      { label: 'Verknüpfung zum Kunden', value: item.customer_link },
      { label: 'Kunden-Artikelcode', value: item.customer_item_code }
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
        : '<tr><td colspan="3" class="muted">Keine Preisdaten gepflegt.</td></tr>';
    const sizesMarkup =
      (item.sizes || []).length > 0
        ? item.sizes.map((size) => `<span class="size-pill">${escapeHtml(size)}</span>`).join('')
        : '<span class="muted">Keine Größen</span>';
    const materialList = [
      { label: 'Außenmaterial', value: item.materials?.outer },
      { label: 'Innenmaterial', value: item.materials?.inner },
      { label: 'Sohle', value: item.materials?.sole }
    ]
      .map(
        (entry) => `<div class="detail-field">
        <p class="detail-field-label">${entry.label}</p>
        <p class="detail-field-value">${escapeHtml(entry.value || '-')}</p>
      </div>`
      )
      .join('');
    const galleryImages = Array.isArray(item.media?.gallery) ? item.media.gallery : [];
    const heroImage = item.media?.hero || galleryImages[0]?.url || null;
    const gallerySelection = galleryImages
      .filter((media) => media.url !== heroImage)
      .slice(0, 4);
    const galleryThumbs = `<section class="artikel-gallery">
        <h4>Bilder</h4>
        <div class="item-gallery item-gallery-fixed">
          ${
            gallerySelection.length
              ? gallerySelection
                  .map((media) => `<img src="${media.url}" alt="" loading="lazy" referrerpolicy="no-referrer" />`)
                  .join('')
              : '<div class="artikel-gallery-placeholder">Keine weiteren Bilder</div>'
          }
        </div>
      </section>`;
    const hasLinks = Boolean(item.links?.b2b || item.links?.viewer3d);
    setArtikelHeaderLinks(hasLinks ? item : null);
    setBreadcrumbLabel(`Artikel · ${item.item_name || item.item_code || 'Details'}`);
    container.innerHTML = `
      <div class="artikel-hero-grid">
        <div class="artikel-hero-fields">
          <div class="artikel-detail-primary">
            ${heroFields.map((field) => detailField(field.label, field.value)).join('')}
            ${detailFields.map((field) => detailField(field.label, field.value)).join('')}
          </div>
        </div>
        <div class="artikel-hero-media">
          ${
            heroImage
              ? `<img src="${heroImage}" alt="${escapeHtml(item.item_name || item.item_code || '')}" loading="lazy" referrerpolicy="no-referrer" />`
              : '<div class="artikel-hero-placeholder">Kein Bild</div>'
          }
        </div>
      </div>
      <section class="artikel-prices">
        <h4>Preisübersicht</h4>
        <table>
          <thead>
            <tr>
              <th>Liste</th>
              <th>Typ</th>
              <th class="align-right">Betrag</th>
            </tr>
          </thead>
          <tbody>${priceRows}</tbody>
        </table>
      </section>
      <section class="artikel-variants">
        <div class="size-card">
          <div class="size-card-head">
            <h4>Größen</h4>
            <span class="size-meta">${(item.sizes || []).length || 0} verfügbare Größen</span>
          </div>
          <div class="size-grid">${sizesMarkup}</div>
        </div>
      </section>
      <section class="artikel-materials">
        <h4>Materialien</h4>
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
    const links = [];
    if (item.links?.b2b) {
      links.push(`<a class="artikel-head-link" href="${item.links.b2b}" target="_blank" rel="noopener">Zum Artikel</a>`);
    }
    if (item.links?.viewer3d) {
      links.push(`<a class="artikel-head-link" href="${item.links.viewer3d}" target="_blank" rel="noopener">3D Ansicht</a>`);
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
    const status = (customer?.status || '').toLowerCase();
    if (status === 'aktiv') return { label: 'Aktiv', className: 'success' };
    if (status === 'gesperrt') return { label: 'Gesperrt', className: 'warning' };
    return { label: customer?.status || 'Unbekannt', className: 'warning' };
  }

  function getCustomerInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }

  function formatCustomerAddress(address) {
    if (!address) return '<span class="muted">Keine Adresse hinterlegt</span>';
    const cityLine = [address.zip, address.city].filter(Boolean).join(' ');
    const lines = [address.street, cityLine, address.country].filter(Boolean).map((line) => escapeHtml(line));
    return lines.length ? lines.join('<br />') : '<span class="muted">Keine Adresse hinterlegt</span>';
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
    return isActive ? { label: 'Aktiviert', className: 'success' } : { label: 'Deaktiviert', className: 'warning' };
  }

  async function initKunden() {
    const tableBody = document.getElementById('customerTable');
    if (!tableBody) return;
    const searchInput = document.getElementById('customerSearch');
    const numberInput = document.getElementById('customerNumberSearch');
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
      state.contacts = contacts;
      let filteredCustomers = customers.slice();

      const highlightRow = (customerId) => {
        tableBody.querySelectorAll('tr').forEach((tr) => tr.classList.remove('active'));
        if (!customerId) return;
        const activeRow = tableBody.querySelector(`tr[data-customer-id="${customerId}"]`);
        if (activeRow) activeRow.classList.add('active');
      };

      const renderTable = (items) => {
        if (!items.length) {
          tableBody.innerHTML = '<tr><td colspan="3" class="muted">Keine Kunden gefunden.</td></tr>';
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
        filteredCustomers = customers.filter((customer) => {
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

      renderTable(filteredCustomers);
      const params = new URLSearchParams(window.location.search);
      const requestedId = params.get('customer');
      if (requestedId) {
        const exists = customers.some((customer) => customer.id === requestedId);
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
    const grid = document.getElementById('calendarGrid');
    const list = document.getElementById('calendarList');
    const monthLabel = document.getElementById('calendarMonthLabel');
    const subtitle = document.getElementById('calendarSubtitle');
    const prevBtn = document.getElementById('prevMonthBtn');
    const nextBtn = document.getElementById('nextMonthBtn');
    if (!grid || !list) return;

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
    state.calendarMonth = new Date().getMonth();
    state.calendarYear = new Date().getFullYear();

    const btn = document.getElementById('newEventBtn');
    const dialog = document.getElementById('eventDialog');
    if (btn && dialog) {
      if (state.user.role !== 'BATE') {
        btn.disabled = true;
      } else {
        btn.addEventListener('click', () => dialog.showModal());
        dialog.addEventListener('close', async () => {
          if (dialog.returnValue === 'default') {
            const data = Object.fromEntries(new FormData(document.getElementById('eventForm')).entries());
            await request('/api/calendar', { method: 'POST', body: data });
            dialog.querySelector('form').reset();
            state.manualCalendarEvents = await request('/api/calendar');
            renderCalendar();
          }
        });
      }
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        const date = new Date(state.calendarYear, state.calendarMonth - 1, 1);
        state.calendarMonth = date.getMonth();
        state.calendarYear = date.getFullYear();
        renderCalendar();
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        const date = new Date(state.calendarYear, state.calendarMonth + 1, 1);
        state.calendarMonth = date.getMonth();
        state.calendarYear = date.getFullYear();
        renderCalendar();
      });
    }

    function formatDateKey(dateInput) {
      const date = new Date(dateInput);
      if (Number.isNaN(date.getTime())) return null;
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    function getAllEvents() {
      return [...state.orderDeliveryEvents, ...state.manualCalendarEvents];
    }

    function renderCalendar() {
      const month = state.calendarMonth;
      const year = state.calendarYear;
      const current = new Date();
      if (monthLabel) {
        monthLabel.textContent = new Date(year, month, 1).toLocaleDateString('de-DE', {
          month: 'long',
          year: 'numeric'
        });
      }

      const events = getAllEvents();
      const buckets = events.reduce((acc, event) => {
        if (!event?.start) return acc;
        const key = formatDateKey(event.start);
        if (!key) return acc;
        if (!acc[key]) acc[key] = [];
        acc[key].push(event);
        return acc;
      }, {});

      const eventsThisMonth = events.filter((event) => {
        const date = new Date(event.start);
        return date.getFullYear() === year && date.getMonth() === month;
      });
      const orderCount = state.orderDeliveryEvents.filter((event) => {
        const date = new Date(event.start);
        return date.getFullYear() === year && date.getMonth() === month;
      }).length;
      if (subtitle) {
        subtitle.textContent = `${orderCount} Liefertermine · ${Math.max(
          eventsThisMonth.length - orderCount,
          0
        )} weitere Ereignisse`;
      }

      const firstDay = new Date(year, month, 1);
      const startOffset = (firstDay.getDay() + 6) % 7; // Monday as first day
      const daysInMonth = new Date(year, month + 1, 0).getDate();

      const weekdayHeader = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
        .map((day) => `<div class="weekday">${day}</div>`)
        .join('');

      let cells = '';
      for (let i = 0; i < startOffset; i += 1) {
        cells += '<div class="calendar-day muted"></div>';
      }
      for (let day = 1; day <= daysInMonth; day += 1) {
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayEvents = buckets[dateKey] || [];
        const isToday =
          day === current.getDate() && month === current.getMonth() && year === current.getFullYear();
        cells += `<div class="calendar-day ${isToday ? 'today' : ''}">
          <div class="calendar-day-number">${day}</div>
          <div class="calendar-day-events">
            ${dayEvents
              .map(
                (event) =>
                  `<span class="calendar-event-badge ${event.type === 'ORDER' ? 'order' : ''}">${escapeHtml(
                    event.title
                  )}</span>`
              )
              .join('')}
          </div>
        </div>`;
      }
      grid.innerHTML = weekdayHeader + cells;
      renderEventsList(eventsThisMonth);
    }

    function renderEventsList(events) {
      if (!events.length) {
        list.innerHTML = '<li class="muted">Keine Termine für diesen Monat.</li>';
        return;
      }
      const sorted = [...events].sort(
        (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
      );
      list.innerHTML = sorted
        .map((event) => {
          const date = new Date(event.start);
          return `<li>
            <strong>${escapeHtml(event.title)}</strong>
            <span class="meta">${date.toLocaleDateString('de-DE')} · ${date
            .toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
            <span class="meta">${event.type === 'ORDER' ? 'Liefertermin' : event.type}</span>
          </li>`;
        })
        .join('');
    }

    renderCalendar();
  }

  async function initProzessstatus() {
    const container = document.getElementById('processGrid');
    if (!container) return;
    try {
      if (!state.orders || !state.orders.length) {
        state.orders = await request('/api/orders');
      }
      const orders = state.orders;
      renderProcessGrid(orders);
    } catch (err) {
      container.innerHTML = `<p class="muted">${escapeHtml(err.message || 'Prozessdaten konnten nicht geladen werden.')}</p>`;
    }

    function renderProcessGrid(orders = []) {
      if (!orders.length) {
        container.innerHTML = '<p class="muted">Keine Bestellungen vorhanden.</p>';
        return;
      }
      container.innerHTML = orders.map((order) => buildProcessCard(order)).join('');
    }

    function formatLocalDate(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return date.toLocaleDateString('de-DE');
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
        if (!dateValue && status === 'WARE_ABHOLBEREIT' && order.requested_delivery) {
          dateValue = new Date(order.requested_delivery);
        }
        const actualLabel = dateValue ? formatLocalDate(dateValue) : '';
        const planLabel =
          status === 'WARE_ABHOLBEREIT' && order.requested_delivery
            ? formatLocalDate(order.requested_delivery)
            : '';
        return `<div class="process-step ${stepState}">
          <div class="process-dot"></div>
          <div class="process-step-meta">
            ${
              planLabel
                ? `<small class="process-plan-label">Soll-Datum: ${planLabel}</small><p>${escapeHtml(
                    STATUS_LABELS[status]
                  )}</p>`
                : `<p>${escapeHtml(STATUS_LABELS[status])}</p>`
            }
            ${actualLabel ? `<span>${actualLabel}</span>` : ''}
          </div>
        </div>`;
      }).join('');
      const orderLink = `/bestellung.html?order=${encodeURIComponent(order.id)}`;
      const customerLink = order.customer_id ? `/kunden.html?customer=${encodeURIComponent(order.customer_id)}` : null;
      return `<article class="process-card">
        <div class="process-card-head">
          <div>
            <p class="muted">Bestellnummer</p>
            <h3><a href="${orderLink}">${escapeHtml(order.order_number || order.id)}</a></h3>
          </div>
          <div class="process-card-meta">
            ${
              customerLink
                ? `<a class="badge ghost" href="${customerLink}">${escapeHtml(order.customer_name || order.customer_id || 'Kunde')}</a>`
                : `<span class="badge ghost">${escapeHtml(order.customer_name || order.customer_id || 'Kunde')}</span>`
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

  async function initLieferant() {
    const [orders, calendar, tickets] = await Promise.all([
      request('/api/orders'),
      request('/api/calendar'),
      request('/api/tickets')
    ]);
    const myOrders = state.user.role === 'SUPPLIER' ? orders.filter((o) => o.supplier_id === state.user.supplier_id) : orders;
    document.getElementById('supplierOrders').innerHTML = myOrders
      .map((order) => `<li><strong>${order.order_number}</strong><br />Status: ${formatStatus(order.portal_status)}</li>`)
      .join('');
    document.getElementById('supplierApprovals').innerHTML = myOrders
      .filter((order) => order.portal_status === 'ORDER_BESTAETIGT')
      .map((order) => `<li>${order.order_number} – Freigabe offen</li>`)
      .join('');
    const relevantOrders = new Set(myOrders.map((order) => order.id));
    document.getElementById('supplierEvents').innerHTML = calendar
      .filter((event) => state.user.role === 'BATE' || !event.order_id || relevantOrders.has(event.order_id))
      .map((event) => `<li>${event.title} – ${new Date(event.start).toLocaleDateString('de-DE')}</li>`)
      .join('');
    document.getElementById('supplierTickets').innerHTML = tickets
      .filter((ticket) => ticket.owner === state.user.id || ticket.watchers?.includes(state.user.id))
      .map((ticket) => `<li>${ticket.title} (${ticket.status})</li>`)
      .join('');
  }

  async function initPage(pageId) {
    try {
      await loadSession();
      await refreshNotifications();
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
      case 'artikel':
        await initArtikel();
        break;
      case 'kunden':
        await initKunden();
        break;
      case 'tickets':
        await initTickets();
        break;
      case 'kalender':
        await initKalender();
        break;
      case 'prozessstatus':
        await initProzessstatus();
        break;
      case 'lieferant':
        await initLieferant();
        break;
      case 'etiketten':
        await initEtikettenPage();
        break;
      case 'schuhbox':
        await initSchuhboxPage();
        break;
      case 'diagnostics':
        await initDiagnosticsPage();
        break;
      case 'translations':
        await initTranslationsPage();
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
