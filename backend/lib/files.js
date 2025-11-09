const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');
const { randomUUID } = require('crypto');

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function sanitizeName(name) {
  return name
    .replace(/[^a-zA-Z0-9.\-_]/g, '_')
    .replace(/_{2,}/g, '_')
    .toLowerCase();
}

function resolveUploadPath(req) {
  const orderId = req.params?.id || req.params?.orderId || 'misc';
  const positionId = req.params?.positionId;
  if (!orderId) {
    return path.join(UPLOAD_ROOT, 'misc');
  }
  if (positionId) {
    return path.join(UPLOAD_ROOT, 'orders', orderId, 'positions', positionId);
  }
  return path.join(UPLOAD_ROOT, 'orders', orderId, 'order-level');
}

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const dest = resolveUploadPath(req);
      await ensureDir(dest);
      cb(null, dest);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const safeOriginal = sanitizeName(file.originalname || 'upload');
    const ext = path.extname(safeOriginal);
    const base = path.basename(safeOriginal, ext);
    cb(null, `${base}-${Date.now()}-${randomUUID()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

module.exports = {
  upload,
  resolveUploadPath,
  UPLOAD_ROOT
};
