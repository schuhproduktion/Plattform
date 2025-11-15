import { state, SUPPORTED_LOCALES, TRANSLATABLE_ATTRIBUTES, getForcedLocaleForRole } from './state.js';
import { request } from './api.js';

const DEFAULT_LOCALE = 'de';

export function resolveStoredLocale() {
  const stored = localStorage.getItem('preferredLocale');
  if (SUPPORTED_LOCALES.some((entry) => entry.code === stored)) {
    return stored;
  }
  const browser = navigator.language?.toLowerCase() || DEFAULT_LOCALE;
  if (browser.startsWith('tr')) return 'tr';
  return DEFAULT_LOCALE;
}

export function isDefaultLocale(locale = state.locale) {
  return !locale || locale === DEFAULT_LOCALE;
}

export async function loadLocaleData(locale) {
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

export function translateLiteral(text) {
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

export function translateTemplate(template, replacements = {}) {
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

export function applyTranslations(root = document.body) {
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

export function setupTranslationObserver() {
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

export function updateLanguageSwitcherState() {
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

export async function changeLocale(locale, { syncServer = true } = {}) {
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

export async function initLocalization() {
  state.locale = resolveStoredLocale();
  bindLanguageSwitcher();
  if (!isDefaultLocale()) {
    await loadLocaleData(state.locale).catch((err) => console.warn('Locale konnte nicht geladen werden', err));
    applyTranslations();
    setupTranslationObserver();
  }
}
