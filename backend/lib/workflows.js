const { randomUUID } = require('crypto');
const { readJson, writeJson, appendToArray } = require('./dataStore');
const { createNotification } = require('./notify');
const { updatePortalStatus } = require('./erpClient');

const STATUS_FLOW = [
  'ORDER_EINGEREICHT',
  'ORDER_BESTAETIGT',
  'RUECKFRAGEN_OFFEN',
  'RUECKFRAGEN_GEKLAERT',
  'PRODUKTION_LAEUFT',
  'WARE_ABHOLBEREIT',
  'UEBERGEBEN_AN_SPEDITION'
];

const STATUS_LABELS = {
  ORDER_EINGEREICHT: 'Bestellung eingereicht',
  ORDER_BESTAETIGT: 'Bestellung bestätigt',
  RUECKFRAGEN_OFFEN: 'Rückfragen offen',
  RUECKFRAGEN_GEKLAERT: 'Rückfragen geklärt',
  PRODUKTION_LAEUFT: 'Produktion läuft',
  WARE_ABHOLBEREIT: 'Ware abholbereit',
  UEBERGEBEN_AN_SPEDITION: 'Übergeben an Spedition'
};

const PHASE_MAPPING = {
  SMS: ['ORDER_EINGEREICHT', 'ORDER_BESTAETIGT', 'RUECKFRAGEN_OFFEN', 'RUECKFRAGEN_GEKLAERT'],
  PPS: ['PRODUKTION_LAEUFT'],
  BESTELLUNG: ['WARE_ABHOLBEREIT', 'UEBERGEBEN_AN_SPEDITION']
};

function getPhaseForStatus(status) {
  const entry = Object.entries(PHASE_MAPPING).find(([, statuses]) => statuses.includes(status));
  return entry ? entry[0] : 'SMS';
}

function getStatusLabel(status) {
  if (!status) return '';
  return STATUS_LABELS[status] || status.replace(/_/g, ' ');
}

function getWorkflowDefinition() {
  return {
    phases: PHASE_MAPPING,
    statuses: STATUS_FLOW,
    labels: STATUS_LABELS,
    transitions: STATUS_FLOW.reduce((acc, status, idx) => {
      acc[status] = STATUS_FLOW.slice(idx + 1);
      return acc;
    }, {})
  };
}

function normalizePortalOrder(order) {
  if (!order) return null;
  const phase = order.phase || getPhaseForStatus(order.portal_status);
  return {
    ...order,
    status_label: getStatusLabel(order.portal_status),
    phase,
    timeline: [...(order.timeline || [])]
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((entry) => (entry.status ? { ...entry, status_label: getStatusLabel(entry.status) } : entry)),
    positions: (order.positions || []).map((position) => ({
      ...position,
      portal_status: position.portal_status || order.portal_status,
      status_label: getStatusLabel(position.portal_status || order.portal_status),
      phase: position.phase || phase,
      timeline: [...(position.timeline || [])]
        .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
        .map((entry) => (entry.status ? { ...entry, status_label: getStatusLabel(entry.status) } : entry))
    }))
  };
}

async function updateOrderWorkflow({ orderId, nextStatus, actor, notifyUsers = [] }) {
  const orders = (await readJson('purchase_orders.json', [])) || [];
  const index = orders.findIndex((o) => o.id === orderId);
  if (index === -1) {
    throw new Error('Bestellung nicht gefunden');
  }
  const order = orders[index];
  const currentStatus = order.portal_status || STATUS_FLOW[0];
  if (!STATUS_FLOW.includes(nextStatus)) {
    throw new Error('Unbekannter Status');
  }
  if (nextStatus === currentStatus) {
    return normalizePortalOrder(order);
  }
  const now = new Date().toISOString();
  order.portal_status = nextStatus;
  order.phase = getPhaseForStatus(nextStatus);
  order.last_updated = now;
  order.timeline = order.timeline || [];
  order.timeline.push({
    id: `tl-${randomUUID()}`,
    type: 'STATUS',
    status: nextStatus,
    message: `Status auf ${getStatusLabel(nextStatus)} gesetzt`,
    actor: actor || 'system',
    created_at: now
  });
  orders[index] = order;
  await writeJson('purchase_orders.json', orders);

  await appendToArray('status_logs.json', {
    id: `LOG-${randomUUID()}`,
    order_id: orderId,
    action: 'STATUS_CHANGE',
    from: currentStatus,
    to: nextStatus,
    actor: actor || 'system',
    ts: now
  });

  await Promise.all(
    notifyUsers.map((userId) =>
      createNotification({
        type: 'ORDER_STATUS_CHANGED',
        orderId,
        userId,
        message: `Status von ${orderId} ist jetzt ${getStatusLabel(nextStatus)}`
      })
    )
  );

  try {
    await updatePortalStatus(orderId, nextStatus);
  } catch (err) {
    console.warn('ERP portal_status Update fehlgeschlagen', err.message);
  }

  return normalizePortalOrder(order);
}

module.exports = {
  getWorkflowDefinition,
  normalizePortalOrder,
  updateOrderWorkflow,
  getPhaseForStatus,
  getStatusLabel,
  STATUS_LABELS,
  STATUS_FLOW
};
