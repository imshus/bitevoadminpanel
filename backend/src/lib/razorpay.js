// Refunds through Razorpay for orders the customer paid online on the website or in the app (order.payment:
// { provider: 'razorpay', paymentId, amount, method }). Needs the Razorpay keys in .env: RAZORPAY_KEY_ID /
// RAZORPAY_KEY_SECRET, or ROZERPAY_API / ROZERPAY_SECRET (the same keys as the website API's).
import { config } from '../config.js';
import { HttpError } from './http.js';

const API = 'https://api.razorpay.com/v1';
export const razorpayEnabled = () => Boolean(config.razorpay.keyId && config.razorpay.keySecret);

// Sends `rupees` back to the customer's UPI / card / bank (Razorpay: 5–7 working days). Returns Razorpay's refund.
export async function refundPayment(paymentId, rupees, notes = {}) {
  const auth = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64');
  let res, data;
  try {
    res = await fetch(`${API}/payments/${encodeURIComponent(paymentId)}/refund`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: Math.round(rupees * 100), notes }),
      signal: AbortSignal.timeout(15000),
    });
    data = await res.json().catch(() => null);
  } catch (err) {
    console.error(`[razorpay] refund of ${paymentId} failed: ${err.message}`);
    throw new HttpError(502, 'Couldn’t reach Razorpay to refund the payment. The order was not cancelled; try again, or refund to the BiteVo wallet.');
  }
  if (!res.ok) {
    const why = data?.error?.description || `HTTP ${res.status}`;
    console.error(`[razorpay] refund of ${paymentId}: ${why}`);
    throw new HttpError(502, `Razorpay didn’t accept the refund (${why}). The order was not cancelled; refund to the BiteVo wallet instead, or check the payment in the Razorpay dashboard.`);
  }
  return data;
}
