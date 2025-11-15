const DIACRITIC_REGEX = /[\u0300-\u036f]/g;

function normalizeRole(role) {
  if (!role) return '';
  return role
    .toString()
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(DIACRITIC_REGEX, '');
}

const SUPPLIER_ROLES = new Set(['SUPPLIER', 'LIEFERANT']);
const INTERNAL_ROLES = new Set(['BATE', 'ADMINISTRATOR', 'HANDLER', 'HAENDLER']);

function isSupplierRole(role) {
  return SUPPLIER_ROLES.has(normalizeRole(role));
}

function isInternalRole(role) {
  return INTERNAL_ROLES.has(normalizeRole(role));
}

function getForcedLocaleForRole(role) {
  if (isSupplierRole(role)) return 'tr';
  if (isInternalRole(role)) return 'de';
  return null;
}

module.exports = {
  normalizeRole,
  isSupplierRole,
  isInternalRole,
  getForcedLocaleForRole
};
