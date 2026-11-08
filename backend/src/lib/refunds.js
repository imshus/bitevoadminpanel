// Refunds the admin panel gives after an order is over: approving a customer's refund request from the website
// (routes/refundRequests.js, e.g. a complaint about the food) or refunding a delivered or cancelled order from its
// page (routes/orders.js). Cancelling a live order has its own refund (routes/orders.js /cancel).
// Where the money goes:
//   'wallet'  the customer's BiteVo wallet, straight away.
//   'source'  back to how they paid: the part paid online goes to their UPI / card through Razorpay; any part
//             paid from the wallet or in cash goes to the wallet (cash can't be sent back electronically).
// One refund per order (order.refund); the refund is recorded on the order, in its history and in the wallet.
import { store } from '../db/index.js';
import { badRequest, conflict, nowIso } from './http.js';
import { razorpayEnabled, refundPayment } from './razorpay.js';

// What the customer paid for this order, by how: { online, wallet, cash, total }.
export function paidFor(order) {
  const online = order.payment?.provider === 'razorpay' && order.payment.paymentId ? order.payment.amount || 0 : 0;
  const wallet = order.walletUsed || 0;
  // Cash on delivery is only paid once the order is delivered.
  const cash = order.paymentMethod === 'Cash on delivery' && order.status === 'delivered' ? Math.max(0, (order.total || 0) - wallet) : 0;
  return { online, wallet, cash, total: online + wallet + cash };
}

// Why this order can't be refunded now, or null.
export function cantRefund(order) {
  if (['placed', 'preparing', 'out_for_delivery'].includes(order.status)) return 'This order is still live. Cancel it to refund it.';
  if (order.refund) return 'This order has already been refunded.';
  if (paidFor(order).total <= 0) return 'Nothing was paid for this order, so there’s nothing to refund.';
  return null;
}

const busy = new Set(); // orders being refunded, so a double click can't refund twice

/**
 * Refunds `amount` rupees of `order` to 'wallet' or 'source'. `reason` goes in the order's history and the
 * customer's wallet note. Returns the updated order. Razorpay refuses → nothing changes, the error says why.
 */
export async function refundOrder(order, { amount, to, reason, admin, requestId = null }) {
  const why = cantRefund(order);
  if (why) throw conflict(why);
  const paid = paidFor(order);
  amount = Math.round(Number(amount) * 100) / 100;
  if (!(amount > 0)) throw badRequest('Enter the amount to refund.');
  if (amount > paid.total) throw badRequest(`At most ₹${paid.total} was paid for this order.`);
  if (!['wallet', 'source'].includes(to)) throw badRequest('Choose where the refund goes.');
  if (to === 'source' && paid.online <= 0) throw badRequest('This order wasn’t paid online (cash or wallet), so the refund can only go to the BiteVo wallet.');

  const key = String(order._id);
  if (busy.has(key)) throw conflict('This order is already being refunded.');
  busy.add(key);
  try {
    let refund;
    let toWallet = amount;
    if (to === 'source') {
      if (!razorpayEnabled()) {
        throw badRequest('Razorpay isn’t set up on the admin panel’s server (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET or ROZERPAY_API / ROZERPAY_SECRET), so the money can’t go back to UPI or card. Refund to the BiteVo wallet instead.');
      }
      const online = Math.min(amount, paid.online);
      const rzp = await refundPayment(order.payment.paymentId, online, { reason: String(reason || '').slice(0, 200), order: order.orderNo });
      toWallet = Math.round((amount - online) * 100) / 100;
      refund = { amount, to: 'source', razorpayRefundId: rzp.id, refundStatus: rzp.status || 'pending', ...(toWallet > 0 && { wallet: toWallet }) };
    } else {
      refund = { amount, to: 'wallet' };
    }
    const at = nowIso();
    Object.assign(refund, { reason: String(reason || '').slice(0, 200), at, by: admin.name, ...(requestId && { requestId }) });
    const saved = await store.update('orders', order._id, { refund, updatedAt: at },
      { push: { history: { status: 'refunded', note: `₹${amount} to ${to === 'wallet' ? 'BiteVo wallet' : 'original payment'}${reason ? `: ${reason}` : ''}`, at, by: admin.name } } });
    if (toWallet > 0) {
      await store.insert('walletTxns', {
        customerId: order.customerId, customerName: order.customerName, customerPhone: order.customerPhone,
        orderId: order._id, type: 'refund', amount: toWallet, note: `Refund for order ${order.orderNo}`, at,
      });
    }
    return saved;
  } finally {
    busy.delete(key);
  }
}
