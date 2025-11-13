import { state, SUPPORTED_LOCALES, NAV_LINKS } from './state.js';
import { escapeHtml } from './utils.js';

export function showToast(message) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  setTimeout(() => toast.remove(), 3000);
}

export function renderTopNav() {
  const container = document.querySelector('[data-component="top-nav"]');
  if (!container) return;
  const rawBreadcrumb = document.body?.dataset?.breadcrumb || (document.title || '').split('|')?.[0]?.trim() || '';
  container.innerHTML = `
    <div class="brand">
      <strong>BATE Supplier Portal</strong>
      <span id="breadcrumb">${escapeHtml(rawBreadcrumb)}</span>
    </div>
    <div class="nav-actions">
      <img
        src="https://erp.schuhproduktion.com/files/ERPNEXTLogo.png"
        alt="ERPNext Logo"
        class="top-nav-logo"
        loading="lazy"
        decoding="async"
      />
      <button class="ghost" id="notificationBell"><span id="notificationCount">0</span></button>
      <span id="userLabel">-</span>
      <button id="logoutBtn">Logout</button>
      <div class="language-switcher">
        <label for="languageSelect" class="sr-only">Sprache wählen</label>
        <select id="languageSelect">
          ${SUPPORTED_LOCALES.map((locale) => `<option value="${locale.code}">${locale.label}</option>`).join('')}
        </select>
      </div>
    </div>
  `;
}

export function renderSidebar(activePage) {
  const container = document.querySelector('[data-component="sidebar"]');
  if (!container) return;
  const links = NAV_LINKS.map((link) => {
    const classes = [];
    if (link.className) classes.push(link.className);
    if (link.page === activePage) classes.push('active');
    const classAttr = classes.length ? ` class="${classes.join(' ')}"` : '';
    return `<a href="${link.href}"${classAttr}>${escapeHtml(link.label)}</a>`;
  }).join('');
  container.innerHTML = `<nav>${links}</nav>`;
}

export function renderSharedLayout(pageId) {
  renderTopNav();
  renderSidebar(pageId);
}

export function applyRoleVisibility() {
  const isBate = state.user?.role === 'BATE';
  document.querySelectorAll('.bate-only').forEach((element) => {
    const preferredDisplay = element.dataset.display || 'block';
    element.style.display = isBate ? preferredDisplay : 'none';
  });
}

export function setBreadcrumbLabel(label) {
  const breadcrumb = document.getElementById('breadcrumb');
  if (breadcrumb) breadcrumb.textContent = label;
}
