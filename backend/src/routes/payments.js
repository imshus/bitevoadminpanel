// Payments without an order: online payments (Razorpay) whose BiteVo order wasn't placed, because the order failed
// after the payment (e.g. the bill changed) or the customer closed the website or app before it was placed. The
// website never refunds them itself: it marks them 'held' (website lib/razorpay.js holdPayment), and an admin
// refunds them here, back to the customer's UPI / card through Razorpay or to their BiteVo wallet. Each payment
// once. Records in 'refunding' are refunds the website started before it stopped refunding by itself and never
// confirmed; they can be refunded here too, or marked refunded if Razorpay shows them done.
import { Router } from 'express';
import { store } from '../db/index.js';
import { badRequest, conflict, notFound, nowIso, DAY } from '../lib/http.js';
import { razorpayEnabled, refundPayment } from '../lib/razorpay.js';

export const router = Router();

const OPEN = ['held', 'refunding'];
const busy = new Set(); // payments being refunded, so a double click can't refund twice

const publicPayment = (p, customer) => ({
  _id: p._id, paymentId: p.paymentId || null, amount: p.amount, total: p.total ?? null, method: p.method || 'Online',
  status: p.status, reason: p.heldReason || p.refundReason || '',
  customerId: p.customerId, customerName: p.customerName || customer?.name || '', customerPhone: p.customerPhone || customer?.phone || customer?.deliveryPhone || '',
  createdAt: p.createdAt, heldAt: p.heldAt || null,
  refundedAt: p.refundedAt || null, refundedBy: p.refundedBy || null, refundTo: p.refundTo || (p.status === 'refunded' ? 'source' : null),
  refundId: p.refundId || null, refundNote: p.refundNote || '',
});

async function openPayment(id) {
  const p = await store.findById('payments', id);
  if (!p) throw notFound('This payment no longer exists.');
  if (p.orderId) throw conflict('This payment has an order. Refund it from the order instead.');
  if (p.status === 'refunded') throw conflict('This payment has already been refunded.');
  if (!OPEN.includes(p.status)) throw conflict('This payment isn’t waiting for a refund.');
  return p;
}

// Waiting for a refund, then the ones refunded in the last 30 days.
router.get('/held', async (req, res) => {
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const [open, done] = await Promise.all([
    store.find('payments', { status: { $in: OPEN } }, { sort: { createdAt: -1 }, limit: 300 }),
    store.find('payments', { status: 'refunded', refundedAt: { $gte: since } }, { sort: { refundedAt: -1 }, limit: 100 }),
  ]);
  const list = [...open, ...done].filter(p => !p.orderId);
  const customers = new Map();
  for (const p of list) {
    if (!p.customerName && p.customerId && !customers.has(p.customerId)) customers.set(p.customerId, await store.findById('customers', p.customerId));
  }
  res.json(list.map(p => publicPayment(p, customers.get(p.customerId))));
});

// Refund: { to: 'source' | 'wallet', note? }. The whole payment, once. Razorpay refuses → nothing changes.
router.post('/:id/refund', async (req, res) => {
  const p = await openPayment(req.params.id);
  const to = req.body?.to === 'wallet' ? 'wallet' : 'source';
  const note = String(req.body?.note || '').trim().slice(0, 300);
  if (to === 'source') {
    if (!razorpayEnabled()) {
      throw badRequest('Razorpay isn’t set up on the admin panel’s server (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET or ROZERPAY_API / ROZERPAY_SECRET), so the money can’t go back to UPI or card. Refund to the BiteVo wallet instead.');
    }
    if (!p.paymentId) throw badRequest('This record has no Razorpay payment ID. Check it in the Razorpay dashboard, or refund to the BiteVo wallet.');
  }
  if (busy.has(p._id)) throw conflict('This payment is already being refunded.');
  busy.add(p._id);
  try {
    const at = nowIso();
    const done = { status: 'refunded', refundTo: to, refundedAt: at, refundedBy: req.admin.name, refundNote: note, updatedAt: at };
    if (to === 'source') {
      const rzp = await refundPayment(p.paymentId, p.amount, { reason: (note || p.heldReason || 'Payment without an order').slice(0, 200) });
      Object.assign(done, { refundId: rzp.id, refundStatus: rzp.status || 'pending' });
    } else {
      const customer = p.customerId ? await store.findById('customers', p.customerId) : null;
      if (!customer) throw notFound('The customer for this payment no longer exists, so it can’t go to a wallet. Refund it to UPI / card.');
      await store.insert('walletTxns', {
        customerId: p.customerId, customerName: customer.name || p.customerName || '', customerPhone: customer.phone || p.customerPhone || '',
        type: 'refund', amount: p.amount, note: 'Refund of a payment without an order', at,
      });
    }
    res.json(publicPayment(await store.update('payments', p._id, done)));
  } finally {
    busy.delete(p._id);
  }
});

// Already refunded outside the panel (e.g. from the Razorpay dashboard): { note }.
router.post('/:id/mark-refunded', async (req, res) => {
  const p = await openPayment(req.params.id);
  const note = String(req.body?.note || '').trim().slice(0, 300);
  if (note.length < 3) throw badRequest('Say where it was refunded (e.g. “Razorpay dashboard, rfnd_…”).');
  const at = nowIso();
  res.json(publicPayment(await store.update('payments', p._id, {
    status: 'refunded', refundTo: 'source', refundedAt: at, refundedBy: req.admin.name, refundNote: note, refundedElsewhere: true, updatedAt: at,
  })));
});
