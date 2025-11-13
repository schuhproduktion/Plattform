const { readJson, writeJson } = require('./dataStore');

const TRANSLATIONS_FILE = 'translations.json';
const DEFAULT_STORE = {
  locales: {},
  updated_at: null
};

async function loadStore() {
  const store = await readJson(TRANSLATIONS_FILE, DEFAULT_STORE);
  store.locales = store.locales || {};
  return store;
}

async function persistStore(store) {
  store.updated_at = new Date().toISOString();
  await writeJson(TRANSLATIONS_FILE, store);
  return store;
}

async function listLocales() {
  const store = await loadStore();
  return Object.keys(store.locales);
}

async function getLocaleEntries(locale) {
  const store = await loadStore();
  return {
    entries: { ...(store.locales?.[locale] || {}) },
    updated_at: store.updated_at
  };
}

function normalizeKey(key) {
  return key?.toString().trim();
}

async function upsertTranslation(locale, key, value) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) {
    throw new Error('Key erforderlich');
  }
  const store = await loadStore();
  if (!store.locales[locale]) {
    store.locales[locale] = {};
  }
  store.locales[locale][normalizedKey] = value?.toString() ?? '';
  await persistStore(store);
  return {
    locale,
    key: normalizedKey,
    value: store.locales[locale][normalizedKey]
  };
}

async function deleteTranslation(locale, key) {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) {
    throw new Error('Key erforderlich');
  }
  const store = await loadStore();
  if (!store.locales[locale] || !Object.prototype.hasOwnProperty.call(store.locales[locale], normalizedKey)) {
    return false;
  }
  delete store.locales[locale][normalizedKey];
  await persistStore(store);
  return true;
}

module.exports = {
  listLocales,
  getLocaleEntries,
  upsertTranslation,
  deleteTranslation
};
