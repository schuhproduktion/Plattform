const nodemailer = require('nodemailer');

let cachedTransporter = null;
let cachedConfigHash = null;

function buildConfig() {
  return {
    host: (process.env.SMTP_HOST || '').trim(),
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    user: (process.env.SMTP_USER || '').trim(),
    password: process.env.SMTP_PASSWORD || process.env.SMTP_PASS || '',
    from: (process.env.SMTP_FROM || '').trim(),
    disabled: String(process.env.SMTP_DISABLED || '').toLowerCase() === 'true'
  };
}

function isEmailConfigured() {
  const cfg = buildConfig();
  if (cfg.disabled) return false;
  return Boolean(cfg.host && cfg.port && cfg.from);
}

function hashConfig(cfg) {
  return JSON.stringify([cfg.host, cfg.port, cfg.secure, cfg.user, cfg.from, cfg.disabled]);
}

async function getTransporter() {
  if (!isEmailConfigured()) return null;
  const cfg = buildConfig();
  const cfgHash = hashConfig(cfg);
  if (!cachedTransporter || cachedConfigHash !== cfgHash) {
    cachedTransporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined
    });
    cachedConfigHash = cfgHash;
  }
  return cachedTransporter;
}

async function sendMail({ to, subject, text, html }) {
  if (!to) throw new Error('Empfängeradresse fehlt');
  const transporter = await getTransporter();
  if (!transporter) throw new Error('Mailversand nicht konfiguriert');
  const cfg = buildConfig();
  return transporter.sendMail({
    from: cfg.from,
    to,
    subject: subject || 'Benachrichtigung',
    text,
    html
  });
}

module.exports = {
  isEmailConfigured,
  sendMail
};
