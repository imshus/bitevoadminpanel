// Refund requests from customers on the website and app (an order's "Request a refund", e.g. a complaint about the
// food), and the ones the website makes when a customer cancels a paid order (reason 'cancelled').
// The website only records them; nothing is refunded until an admin approves one here, choosing the amount and
// where it goes (BiteVo wallet, or back to the customer's UPI / card for orders paid online). Rejecting needs a
// note, which the customer sees. Refunds go through lib/refunds.js; the website emails the customer the outcome.
import { Router } from 'express';
import { store } from '../db/index.js';
import { badRequest, conflict, notFound, nowIso } from '../lib/http.js';
import { refundOrder, paidFor, cantRefund } from '../lib/refunds.js';

export const router = Router();

async function findRequest(id) {
  const r = await store.findById('refundRequests', id);
  if (!r) throw notFound('This refund request no longer exists.');
  return r;
}

// Newest first, with the order's payment, so the panel can show what was paid and how.
router.get('/', async (req, res) => {
  const requests = await store.find('refundRequests', {}, { sort: { createdAt: -1 }, limit: 300 });
  const out = [];
  for (const r of requests) {
    const order = await store.findById('orders', r.orderId);
    out.push({
      ...r,
      order: order && {
        _id: order._id, orderNo: order.orderNo, status: order.status, total: order.total, paymentMethod: order.paymentMethod,
        paid: paidFor(order), refund: order.refund || null, deliveredAt: order.deliveredAt || null, cancelledAt: order.cancelledAt || null,
      },
    });
  }
  res.json(out);
});

// Approve: { amount, to: 'wallet' | 'source', note? }. Refunds first; if that fails, the request stays open.
router.post('/:id/approve', async (req, res) => {
  const r = await findRequest(req.params.id);
  if (r.status !== 'pending') throw conflict('This request has already been decided.');
  const order = await store.findById('orders', r.orderId);
  if (!order) throw notFound('The order for this request no longer exists.');
  const why = cantRefund(order);
  if (why) throw conflict(why);
  const note = String(req.body?.note || '').trim().slice(0, 300);
  const amount = Number(req.body?.amount ?? r.amount);
  const to = req.body?.to || r.to;
  await refundOrder(order, { amount, to, reason: `Refund request: ${r.reasonLabel || r.reason}`, admin: req.admin, requestId: r._id });
  const updated = await store.findById('orders', order._id);
  res.json(await store.update('refundRequests', r._id, {
    status: 'approved', decidedAt: nowIso(), decidedBy: req.admin.name, note,
    decision: { amount: updated.refund.amount, to: updated.refund.to, razorpayRefundId: updated.refund.razorpayRefundId || null, wallet: updated.refund.wallet || 0 },
  }));
});

// Reject: { note } (required: the customer sees why).
router.post('/:id/reject', async (req, res) => {
  const r = await findRequest(req.params.id);
  if (r.status !== 'pending') throw conflict('This request has already been decided.');
  const note = String(req.body?.note || '').trim().slice(0, 300);
  if (note.length < 5) throw badRequest('Tell the customer why (they see this note).');
  res.json(await store.update('refundRequests', r._id, { status: 'rejected', decidedAt: nowIso(), decidedBy: req.admin.name, note }));
});
