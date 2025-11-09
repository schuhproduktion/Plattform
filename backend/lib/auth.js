const bcrypt = require('bcryptjs');
const { readJson } = require('./dataStore');

async function loadUsers() {
  return (await readJson('users.json', [])) || [];
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, ...safe } = user;
  return safe;
}

async function authenticate(email, password) {
  const users = await loadUsers();
  const user = users.find((u) => u.email === email);
  if (!user) return null;
  const matches = await bcrypt.compare(password, user.password_hash);
  if (!matches) return null;
  return sanitizeUser(user);
}

function requireAuth() {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: 'Nicht angemeldet' });
    }
    return next();
  };
}

function requireBate() {
  return (req, res, next) => {
    if (!req.session?.user) {
      return res.status(401).json({ error: 'Nicht angemeldet' });
    }
    if (req.session.user.role !== 'BATE') {
      return res.status(403).json({ error: 'BATE-Rechte erforderlich' });
    }
    return next();
  };
}

function requireSupplierOrOwner(ownerResolver = null) {
  return async (req, res, next) => {
    const user = req.session?.user;
    if (!user) {
      return res.status(401).json({ error: 'Nicht angemeldet' });
    }
    if (user.role === 'BATE') {
      return next();
    }
    if (typeof ownerResolver !== 'function') {
      return next();
    }
    try {
      const ownerInfo = await ownerResolver(req);
      if (!ownerInfo) {
        return res.status(403).json({ error: 'Keine Berechtigung' });
      }
      if (Array.isArray(ownerInfo)) {
        if (ownerInfo.includes(user.id)) return next();
      } else if (typeof ownerInfo === 'string') {
        if (ownerInfo === user.id) return next();
      } else if (ownerInfo?.supplierId) {
        if (ownerInfo.supplierId === user.supplier_id) return next();
      }
      return res.status(403).json({ error: 'Keine Berechtigung' });
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = {
  authenticate,
  sanitizeUser,
  loadUsers,
  requireAuth,
  requireBate,
  requireSupplierOrOwner
};
