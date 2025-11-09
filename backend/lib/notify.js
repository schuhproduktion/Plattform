const { randomUUID } = require('crypto');
const { readJson, writeJson, appendToArray } = require('./dataStore');

async function createNotification({ type, orderId = null, userId, message }) {
  if (!userId) return null;
  const payload = {
    id: `NOT-${randomUUID()}`,
    type,
    order_id: orderId,
    user_id: userId,
    message,
    read: false,
    ts: new Date().toISOString()
  };
  await appendToArray('notifications.json', payload);
  // TODO: Payload zusätzlich via SMTP / Browser-Push versenden, sobald Infrastruktur steht.
  return payload;
}

async function listNotifications(userId, { unreadOnly = false } = {}) {
  const list = (await readJson('notifications.json', [])) || [];
  return list.filter((n) => n.user_id === userId && (!unreadOnly || !n.read));
}

async function markAsRead(notificationId, userId) {
  const list = (await readJson('notifications.json', [])) || [];
  const idx = list.findIndex((n) => n.id === notificationId && n.user_id === userId);
  if (idx === -1) return null;
  list[idx].read = true;
  await writeJson('notifications.json', list);
  return list[idx];
}

module.exports = {
  createNotification,
  listNotifications,
  markAsRead
};
