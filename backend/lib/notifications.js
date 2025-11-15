const { randomUUID } = require('crypto');
const { readJson, writeJson } = require('./dataStore');
const { loadUsers } = require('./auth');
const { isEmailConfigured, sendMail } = require('./mailer');

const STORE_FILE = 'notifications.json';
const MAX_STORE_SIZE = 2000;
const PORTAL_URL = (process.env.NOTIFICATION_PORTAL_URL || process.env.BASE_URL || '').replace(/\/$/, '');
const EMAIL_SUBJECT_PREFIX = (process.env.NOTIFICATION_EMAIL_SUBJECT_PREFIX || 'BATE Portal').trim();
const EMAIL_OVERRIDE = (process.env.NOTIFICATION_EMAIL_OVERRIDE || '').trim();
const EMAIL_SIGNATURE_TEXT = `
Freundliche Grüße
Ihre Schuhproduktion des Vertrauens

BATE GmbH
Karlsruher Str. 71 | 75179 Pforzheim
Tel. +49 7231 374491-5 | Fax +49 7231 374491-9
o.yildiz@schuhproduktion.com | www.schuhproduktion.com
Geschäftsführer: Nihat Yildiz | HRB 749797 AG Mannheim
Rechtliche Hinweise © 2025 BATE GmbH – Alle Rechte vorbehalten.
Diese E-Mail enthält vertrauliche Informationen. Sind Sie nicht der richtige Adressat, informieren Sie bitte den Absender und löschen Sie die Nachricht.
`.trim();
const EMAIL_SIGNATURE_HTML = `
  <div style="margin-top:24px;font-family:Arial,Helvetica,sans-serif;font-size:12pt;color:#212121;">
    <p style="margin:0 0 12px;">Freundliche Grüße</p>
    <p style="margin:0 0 12px;">Ihre Schuhproduktion des Vertrauens</p>
    <p style="margin:0 0 18px;font-size:16px;font-weight:bold;">BATE GmbH</p>
    <p style="margin:0 0 8px;font-size:11pt;">
      Karlsruher Str. 71 | 75179 Pforzheim | Tel.
      <a href="tel:+4972313744915" style="color:#0078d7;text-decoration:none;">+49 7231 374491-5</a> |
      Fax <a href="tel:+4972313744919" style="color:#0078d7;text-decoration:none;">+49 7231 374491-9</a> |
      <a href="mailto:o.yildiz@schuhproduktion.com" style="color:#0078d7;text-decoration:none;">o.yildiz@schuhproduktion.com</a> |
      <a href="https://www.schuhproduktion.com/" style="color:#0078d7;text-decoration:none;" target="_blank" rel="noopener">www.schuhproduktion.com</a>
    </p>
    <div style="margin:20px 0;">
      <img src="https://onecdn.io/media/024343ab-11ca-421a-b956-fc0b184b917f/full" alt="BATE GmbH" width="151" height="40" style="border:none;" />
    </div>
    <p style="margin:0 0 6px;font-size:10pt;">Geschäftsführer: Nihat Yildiz | Handelsregister: HRB 749797 Amtsgericht Mannheim</p>
    <p style="margin:0 0 6px;font-size:10pt;">Rechtliche Hinweise © 2025 BATE GmbH – Alle Rechte vorbehalten.</p>
    <p style="margin:0;font-size:10pt;">Diese E-Mail enthält vertrauliche und/oder rechtlich geschützte Informationen. Wenn Sie nicht der richtige Adressat sind oder diese E-Mail irrtümlich erhalten haben, informieren Sie bitte sofort den Absender und vernichten Sie diese Mail. Das unerlaubte Kopieren sowie die unbefugte Weitergabe dieser Mail ist nicht gestattet.</p>
  </div>
`;

async function loadNotifications() {
  return (await readJson(STORE_FILE, [])) || [];
}

async function saveNotifications(entries) {
  return writeJson(STORE_FILE, entries);
}

function sanitizeNotification(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    type: entry.type || 'info',
    title: entry.title || '',
    message: entry.message || '',
    recipient_id: entry.recipient_id || null,
    order_id: entry.order_id || null,
    ticket_id: entry.ticket_id || null,
    position_id: entry.position_id || null,
    actor_id: entry.actor_id || null,
    actor_name: entry.actor_name || null,
    metadata: entry.metadata || {},
    created_at: entry.created_at,
    read_at: entry.read_at || null
  };
}

async function addNotifications(batch = []) {
  if (!Array.isArray(batch) || !batch.length) return [];
  const notifications = await loadNotifications();
  const nowIso = new Date().toISOString();
  const prepared = batch
    .filter((entry) => entry && entry.recipient_id)
    .map((entry) => ({
      id: entry.id || `NTF-${randomUUID()}`,
      type: entry.type || 'info',
      title: entry.title || '',
      message: entry.message || '',
      recipient_id: entry.recipient_id,
      order_id: entry.order_id || null,
      ticket_id: entry.ticket_id || null,
      position_id: entry.position_id || null,
      actor_id: entry.actor_id || null,
      actor_name: entry.actor_name || null,
      metadata: entry.metadata || {},
      created_at: entry.created_at || nowIso,
      read_at: entry.read_at || null
    }));
  if (!prepared.length) return [];
  notifications.push(...prepared);
  const excess = Math.max(0, notifications.length - MAX_STORE_SIZE);
  if (excess > 0) {
    notifications.splice(0, excess);
  }
  await saveNotifications(notifications);
  try {
    await sendNotificationEmails(prepared);
  } catch (err) {
    console.warn('Benachrichtigungs-E-Mail fehlgeschlagen:', err.message);
  }
  return prepared;
}

async function markNotificationRead(notificationId, userId) {
  if (!notificationId || !userId) return null;
  const notifications = await loadNotifications();
  const entry = notifications.find((n) => n.id === notificationId && n.recipient_id === userId);
  if (!entry) return null;
  if (!entry.read_at) {
    entry.read_at = new Date().toISOString();
    await saveNotifications(notifications);
  }
  return sanitizeNotification(entry);
}

async function markNotificationUnread(notificationId, userId) {
  if (!notificationId || !userId) return null;
  const notifications = await loadNotifications();
  const entry = notifications.find((n) => n.id === notificationId && n.recipient_id === userId);
  if (!entry) return null;
  if (entry.read_at) {
    entry.read_at = null;
    await saveNotifications(notifications);
  }
  return sanitizeNotification(entry);
}

async function markAllNotificationsRead(userId) {
  if (!userId) return [];
  const notifications = await loadNotifications();
  let changed = false;
  const nowIso = new Date().toISOString();
  notifications.forEach((entry) => {
    if (entry.recipient_id === userId && !entry.read_at) {
      entry.read_at = nowIso;
      changed = true;
    }
  });
  if (changed) {
    await saveNotifications(notifications);
  }
  return notifications
    .filter((entry) => entry.recipient_id === userId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map((entry) => sanitizeNotification(entry));
}

async function getNotificationsForUser(userId, { unreadOnly = false, limit = 50 } = {}) {
  if (!userId) return [];
  const notifications = await loadNotifications();
  return notifications
    .filter((entry) => {
      if (entry.recipient_id !== userId) return false;
      if (unreadOnly && entry.read_at) return false;
      return true;
    })
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit > 0 ? limit : undefined)
    .map((entry) => sanitizeNotification(entry));
}

async function markTicketNotificationsRead(ticketId, userId) {
  if (!ticketId || !userId) return [];
  const notifications = await loadNotifications();
  const nowIso = new Date().toISOString();
  let changed = false;
  const updated = [];
  notifications.forEach((entry) => {
    if (entry.ticket_id === ticketId && entry.recipient_id === userId && !entry.read_at) {
      entry.read_at = nowIso;
      updated.push(sanitizeNotification(entry));
      changed = true;
    }
  });
  if (changed) {
    await saveNotifications(notifications);
  }
  return updated;
}

module.exports = {
  loadNotifications,
  getNotificationsForUser,
  addNotifications,
  markNotificationRead,
  markNotificationUnread,
  markAllNotificationsRead,
  markTicketNotificationsRead
};

async function sendNotificationEmails(notifications = []) {
  if (!notifications.length) return;
  if (!isEmailConfigured()) return;
  const users = await loadUsers();
  const userLookup = new Map();
  users.forEach((user) => {
    if (!user?.id) return;
    const email = user.email ? user.email.toString().trim() : '';
    if (email) {
      userLookup.set(user.id, { email, name: user.username || user.email || user.id });
    }
  });
  const portalLink = PORTAL_URL ? `${PORTAL_URL}/benachrichtigungen.html` : '';
  await Promise.all(
    notifications.map(async (notification) => {
      const recipient = userLookup.get(notification.recipient_id);
      if (!recipient) return;
      const subjectParts = [];
      let messageLines = [];
      let portalLineMode = 'default';
      let customPortalLine = null;
      if (notification.type === 'order.created') {
        const orderNumber = notification.metadata?.order_number || notification.order_id || '';
        const orderType = notification.metadata?.order_type || notification.metadata?.phase || '';
        const delivery = formatDateLabel(notification.metadata?.requested_delivery);
        const quantity = notification.metadata?.total_qty || notification.metadata?.total_quantity || '';
        const recipientName = recipient.name || 'iş ortağımız';
        const orderLink =
          notification.order_id && PORTAL_URL
            ? `${PORTAL_URL}/bestellung.html?order=${encodeURIComponent(notification.order_id)}`
            : null;
        if (EMAIL_SUBJECT_PREFIX) subjectParts.push(EMAIL_SUBJECT_PREFIX);
        subjectParts.push(`Yeni Sipariş Oluşturuldu – Sipariş No: ${orderNumber || ''}`);
        messageLines = [
          `Merhaba ${recipientName},`,
          '',
          'Senin için yeni bir sipariş oluşturuldu.',
          '',
          `Sipariş Numarası: ${orderNumber || '-'}`,
          `Sipariş Türü: ${orderType || '-'}`,
          `Teslimat Tarihi: ${delivery || '-'}`,
          `Toplam Adet: ${quantity ? `${quantity} çift` : '-'}`,
          orderLink ? `Siparişi Görüntüle: ${orderLink}` : '',
          '',
          'Lütfen alındığını kısaca onayla veya soruların olursa geri dönüş yap.',
          '',
          'Selamlar,'
        ];
        portalLineMode = 'none';
      } else {
        if (EMAIL_SUBJECT_PREFIX) subjectParts.push(EMAIL_SUBJECT_PREFIX);
        if (notification.title) subjectParts.push(notification.title);
        if (!subjectParts.length) subjectParts.push('Neue Benachrichtigung');
        if (notification.message) {
          messageLines.push(notification.message);
        } else {
          messageLines.push('Im Portal liegt eine neue Benachrichtigung für dich vor.');
        }
        if (notification.order_id) messageLines.push(`Bestellung: ${notification.order_id}`);
        if (notification.ticket_id) messageLines.push(`Ticket: ${notification.ticket_id}`);
        if (notification.position_id) messageLines.push(`Position: ${notification.position_id}`);
        if (notification.actor_name) messageLines.push(`Von: ${notification.actor_name}`);
      }
      if (EMAIL_OVERRIDE && EMAIL_OVERRIDE !== recipient.email) {
        messageLines.push('');
        messageLines.push(`(Testmodus – ursprünglicher Empfänger: ${recipient.email})`);
      }
      const textLines = [...messageLines];
      if (portalLineMode === 'default' && portalLink) {
        textLines.push('');
        textLines.push(`Portal öffnen: ${portalLink}`);
      } else if (portalLineMode === 'custom' && customPortalLine) {
        textLines.push('');
        textLines.push(customPortalLine);
      }
      const text = [...textLines, '', EMAIL_SIGNATURE_TEXT].filter(Boolean).join('\n');
      const htmlSections = messageLines.map((line) => {
        if (!line) {
          return '<p style="margin:0 0 12px;">&nbsp;</p>';
        }
        if (line.startsWith('Siparişi Görüntüle: ') && line.includes('http')) {
          const link = line.replace('Siparişi Görüntüle: ', '').trim();
          return `<p style="margin:0 0 12px;">Siparişi Görüntüle: <a href="${link}" style="color:#0078d7;text-decoration:none;">${escapeHtml(
            link
          )}</a></p>`;
        }
        return `<p style="margin:0 0 12px;">${escapeHtml(line)}</p>`;
      });
      if (portalLineMode === 'default' && portalLink) {
        htmlSections.push(
          `<p style="margin:0 0 12px;">Portal öffnen: <a href="${portalLink}" style="color:#0078d7;text-decoration:none;">${escapeHtml(
            portalLink
          )}</a></p>`
        );
      } else if (portalLineMode === 'custom' && customPortalLine) {
        htmlSections.push(`<p style="margin:0 0 12px;">${escapeHtml(customPortalLine)}</p>`);
      }
      htmlSections.push(EMAIL_SIGNATURE_HTML);
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12pt;color:#212121;">${htmlSections.join(
        '\n'
      )}</div>`;
      const subject = subjectParts.join(' – ').replace(/–\s*–/g, '–').trim() || 'Neue Benachrichtigung';
      try {
        await sendMail({
          to: EMAIL_OVERRIDE || recipient.email,
          subject,
          text,
          html
        });
      } catch (err) {
        console.warn(`E-Mail an ${recipient.email} konnte nicht gesendet werden:`, err.message);
      }
    })
  );
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return value
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateLabel(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  try {
    return date.toLocaleDateString('tr-TR', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return date.toISOString().split('T')[0];
  }
}
