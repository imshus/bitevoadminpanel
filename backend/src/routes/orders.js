import { Router } from 'express';
import { store } from '../db/index.js';
import { badRequest, notFound, nowIso, startOfToday, DAY } from '../lib/http.js';
import { LIVE_STATUSES, NEXT_STATUS } from '../lib/rules.js';
import { getSettings } from '../settings.js';
import { razorpayEnabled, refundPayment } from '../lib/razorpay.js';

export const router = Router();

const MIN = 60000;

async function findOrder(id) {
  const order = await store.findById('orders', id);
  if (!order) throw notFound('This order no longer exists.');
  return order;
}

// Applies changes and records who did what in the order's history.
const saveChange = (order, changes, event, admin) =>
  store.update('orders', order._id, { ...changes, updatedAt: nowIso() }, { push: { history: { ...event, at: nowIso(), by: admin.name } } });

const walletTxn = (order, type, amount, note) => store.insert('walletTxns', {
  customerId: order.customerId, customerName: order.customerName, customerPhone: order.customerPhone,
  orderId: order._id, type, amount, note, at: nowIso(),
});

// Orders placed in the last `days` days (1 = today), newest first.
router.get('/', async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 1, 1), 90);
  const since = new Date(startOfToday() - (days - 1) * DAY).toISOString();
  res.json(await store.find('orders', { placedAt: { $gte: since } }, { sort: { placedAt: -1 } }));
});

router.get('/:id', async (req, res) => {
  res.json(await findOrder(req.params.id));
});

// Moves an order to its next step: accept → out for delivery → delivered.
router.post('/:id/advance', async (req, res) => {
  const order = await findOrder(req.params.id);
  const status = NEXT_STATUS[order.status];
  if (!status) throw badRequest('This order is already finished.');
  if (status === 'out_for_delivery' && !order.agentId) throw badRequest('Assign a delivery agent before sending it out.');

  const changes = { status };
  if (status === 'out_for_delivery') {
    changes.dispatchedAt = nowIso();
    changes.dueAt = new Date(Date.now() + (12 + Math.round(Math.random() * 13)) * MIN).toISOString(); // for the demo simulator
  }
  if (status === 'delivered') {
    changes.deliveredAt = nowIso();
    changes.deliveryMins = Math.max(1, Math.round((Date.now() - Date.parse(order.placedAt)) / MIN));
  }
  const saved = await saveChange(order, changes, { status }, req.admin);
  if (status === 'delivered' && order.cashback > 0) await walletTxn(order, 'cashback', order.cashback, `${order.couponCode} on order ${order.orderNo}`);
  res.json(saved);
});

router.post('/:id/assign', async (req, res) => {
  const order = await findOrder(req.params.id);
  if (!LIVE_STATUSES.includes(order.status)) throw badRequest('Only live orders can be reassigned.');
  const agent = await store.findById('agents', String(req.body?.agentId || ''));
  if (!agent || !agent.isActive || agent.kycStatus !== 'verified') throw badRequest('Pick an active, verified agent.');
  res.json(await saveChange(order, { agentId: agent._id, agentName: agent.name }, { status: 'assigned', note: agent.name }, req.admin));
});

// refundTo: 'wallet' | 'source' | 'none'. Cash orders can only refund what was paid from the wallet.
// 'source' on an order paid online through Razorpay (order.payment) sends the online part back to the customer's
// UPI / card / bank through Razorpay first (if Razorpay refuses, nothing changes and the admin sees why); any
// part paid from the wallet goes back to the wallet.
const cancelling = new Set(); // order ids being cancelled, so a double click can't refund twice
router.post('/:id/cancel', async (req, res) => {
  const order = await findOrder(req.params.id);
  if (!LIVE_STATUSES.includes(order.status)) throw badRequest('Delivered or cancelled orders can’t be cancelled.');
  const reason = String(req.body?.reason || '');
  if (!(await getSettings()).cancelReasons.includes(reason)) throw badRequest('Pick a reason for cancelling.');
  const refundTo = ['wallet', 'source', 'none'].includes(req.body?.refundTo) ? req.body.refundTo : 'none';
  const key = String(order._id);
  if (cancelling.has(key)) throw badRequest('This order is already being cancelled.');
  cancelling.add(key);
  try {
    const cash = order.paymentMethod === 'Cash on delivery';
    const paid = cash ? order.walletUsed || 0 : order.total;
    const to = cash || order.paymentMethod === 'Wallet' ? 'wallet' : refundTo;
    const online = order.payment?.provider === 'razorpay' && order.payment.paymentId ? order.payment : null;

    let refund = paid > 0 && refundTo !== 'none' ? { amount: paid, to } : null;
    let toWallet = refund?.to === 'wallet' ? refund.amount : 0;
    if (refund?.to === 'source' && online) {
      if (!razorpayEnabled()) {
        throw badRequest('Razorpay isn’t set up on the admin panel’s server (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET, or ROZERPAY_API and ROZERPAY_SECRET, in backend/.env), so the payment can’t go back to the customer’s UPI or card. Refund to the BiteVo wallet instead.');
      }
      const rzp = await refundPayment(online.paymentId, online.amount, { reason: reason.slice(0, 200), order: order.orderNo });
      const wallet = Math.max(0, paid - online.amount); // the part paid from the wallet
      refund = { amount: paid, to: 'source', razorpayRefundId: rzp.id, refundStatus: rzp.status || 'pending', ...(wallet > 0 && { wallet }) };
      toWallet = wallet;
    }

    const changes = { status: 'cancelled', cancelReason: reason, cancelledAt: nowIso(), refund, deliveryMins: null, rating: null };
    const saved = await saveChange(order, changes, { status: 'cancelled', note: reason }, req.admin);
    if (toWallet > 0) await walletTxn(order, 'refund', toWallet, `Cancelled order ${order.orderNo}`);
    res.json(saved);
  } finally {
    cancelling.delete(key);
  }
});
