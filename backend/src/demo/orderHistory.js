// Generates 180 days of realistic demo orders, used once to seed an empty database.
import { SEED_PRODUCTS, SEED_COUPONS, SEED_AGENTS, customerId, customerName, maskedPhone } from './catalog.js';
import { rng, hashString, between, intBetween, weighted, wobble } from '../lib/random.js';

export const HISTORY_DAYS = 180;
export const FREE_DELIVERY_ABOVE = 499;
export const DELIVERY_FEE = 30;
const PREP_MINS = 15;
const NEW_MINS = 3; // orders younger than this are still waiting to be accepted
const EXISTING_CUSTOMERS = 220; // customers who had already ordered before the history starts

export const HOURS = [[8, 2], [9, 3], [10, 3], [11, 5], [12, 10], [13, 12], [14, 9], [15, 4], [16, 3], [17, 4], [18, 6], [19, 10], [20, 13], [21, 12], [22, 7], [23, 3]];
export const ITEM_COUNTS = [[1, 55], [2, 32], [3, 13]];
export const PAYMENTS = [['UPI', 58], ['Card', 16], ['Cash on delivery', 26]];

const startOfDay = t => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d;
};
const dateKey = d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const hex = (n, len) => (n >>> 0).toString(16).padStart(len, '0').slice(-len);

const SEED_PRICE = new Map(SEED_PRODUCTS.map(p => [p._id, p.price]));

// What a coupon is worth on an order: `discount` comes off the bill, `cashback` goes to the wallet later.
// `priceOf` looks up the free product's price (defaults to the demo catalogue).
export function couponValue(coupon, subtotal, deliveryFee, priceOf = id => SEED_PRICE.get(id)) {
  const pct = cap => Math.min(Math.round((subtotal * coupon.discountValue) / 100), cap ?? Infinity);
  switch (coupon.discountType) {
    case 'percent': return { discount: pct(coupon.maxDiscount), cashback: 0 };
    case 'flat': return { discount: Math.min(coupon.discountValue, subtotal), cashback: 0 };
    case 'free_delivery': return { discount: deliveryFee, cashback: 0 };
    case 'free_item': return { discount: (priceOf(coupon.freeItem.productId) || 0) * coupon.freeItem.qty, cashback: 0 };
    case 'cashback': return { discount: 0, cashback: coupon.cashbackUnit === 'flat' ? coupon.discountValue : pct(coupon.maxDiscount) };
    default: return { discount: 0, cashback: 0 };
  }
}

function generateDay(dayStart, daysAgo) {
  const key = dateKey(dayStart);
  const r = rng(hashString(`bitevo-orders-${key}`));
  const dow = dayStart.getDay();
  const growth = 0.6 + 0.4 * (1 - daysAgo / HISTORY_DAYS);
  const weekday = dow === 0 || dow === 6 ? 1.3 : dow === 5 ? 1.12 : 1;
  const count = Math.round(62 * growth * weekday * between(r, 0.85, 1.15));
  const customerPool = Math.floor(EXISTING_CUSTOMERS + 980 * (1 - daysAgo / HISTORY_DAYS));

  const agents = SEED_AGENTS.filter(a => a.kycStatus === 'verified' && a.joined > daysAgo && (a.isActive || daysAgo > 10));
  const coupons = SEED_COUPONS.filter(c => c.share > 0 && c.from <= -daysAgo && -daysAgo <= c.to);

  const orders = [];
  for (let i = 0; i < count; i++) {
    const hour = weighted(r, HOURS, h => h[1])[0];
    const placedAt = new Date(dayStart.getTime() + hour * 3600000 + intBetween(r, 0, 3599) * 1000);

    const itemCount = weighted(r, ITEM_COUNTS, x => x[1])[0];
    const items = [];
    while (items.length < itemCount) {
      const p = weighted(r, SEED_PRODUCTS, x => x.popularity);
      if (items.some(it => it.productId === p._id)) continue;
      items.push({ productId: p._id, name: p.name, category: p.category, price: p.price, qty: r() < 0.82 ? 1 : 2 });
    }
    const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
    const deliveryFee = subtotal >= FREE_DELIVERY_ABOVE ? 0 : DELIVERY_FEE;

    let couponCode = null;
    let discount = 0;
    let cashback = 0;
    if (coupons.length && r() < 0.34) {
      const c = weighted(r, coupons, x => x.share);
      if (subtotal >= c.minOrderValue) {
        couponCode = c.code;
        ({ discount, cashback } = couponValue(c, subtotal, deliveryFee));
      }
    }

    const agent = agents[Math.floor(r() * agents.length)];
    const cancelled = r() < 0.065;
    const rush = hour >= 19 && hour <= 21 ? 4 : 0;
    const deliveryMins = Math.max(14, Math.round(agent.speed + rush + wobble(r) * 9));
    const rated = r() < 0.55;
    const rating = Math.min(5, Math.max(1, Math.round(4.7 - (agent.speed - 25) / 10 + wobble(r) * 1.3)));
    const c = Math.floor(Math.pow(r(), 1.5) * customerPool);

    orders.push({
      placedAt: placedAt.toISOString(),
      customerId: customerId(c),
      customerName: customerName(c),
      customerIndex: c,
      customerPhone: maskedPhone(c),
      items,
      subtotal,
      deliveryFee,
      discount,
      cashback,
      couponCode,
      total: subtotal + deliveryFee - discount,
      paymentMethod: weighted(r, PAYMENTS, x => x[1])[0],
      status: cancelled ? 'cancelled' : 'delivered',
      agentId: cancelled ? null : agent._id,
      agentName: cancelled ? null : agent.name,
      deliveryMins: cancelled ? null : deliveryMins,
      rating: !cancelled && rated ? rating : null,
    });
  }

  orders.sort((a, b) => a.placedAt.localeCompare(b.placedAt));
  const mmdd = `${String(dayStart.getMonth() + 1).padStart(2, '0')}${String(dayStart.getDate()).padStart(2, '0')}`;
  orders.forEach((o, i) => {
    o._id = hex(Date.parse(o.placedAt) / 1000, 8) + hex(hashString(key), 8) + hex(i, 8);
    o.orderNo = `BV${mmdd}-${String(i + 1).padStart(3, '0')}`;
  });
  return orders;
}

function buildHistory(today) {
  const all = [];
  for (let d = HISTORY_DAYS - 1; d >= 0; d--) {
    const dayStart = new Date(today);
    dayStart.setDate(today.getDate() - d);
    all.push(...generateDay(dayStart, d));
  }
  // Flag each customer's first (non-cancelled) order so analytics can count new customers.
  const seen = new Set();
  for (const o of all) {
    o.isFirstOrder = false;
    if (o.status === 'cancelled' || o.customerIndex < EXISTING_CUSTOMERS || seen.has(o.customerId)) continue;
    seen.add(o.customerId);
    o.isFirstOrder = true;
  }

  // Wallet: cashback and refunds top it up; some later orders are paid (partly) from it.
  const balance = new Map();
  for (const o of all) {
    const h = hashString(o._id);
    let b = balance.get(o.customerId) || 0;
    o.walletUsed = 0;
    o.refund = null;
    if (o.status === 'cancelled') {
      if (o.paymentMethod !== 'Cash on delivery') {
        o.refund = { amount: o.total, to: h % 2 ? 'source' : 'wallet' };
        if (o.refund.to === 'wallet') b += o.total;
      }
    } else {
      if (b >= 25 && h % 3 === 0) {
        o.walletUsed = Math.min(b, o.total);
        b -= o.walletUsed;
        if (o.walletUsed === o.total) o.paymentMethod = 'Wallet';
      }
      b += o.cashback;
    }
    balance.set(o.customerId, b);
  }
  return all;
}

// All orders placed up to `now`, oldest first. Today's most recent orders are still in progress
// and keep their planned delivery time as `etaMins`.
export function generateOrders(now = Date.now()) {
  const all = buildHistory(startOfDay(now));
  const result = [];
  for (const o of all) {
    const t = Date.parse(o.placedAt);
    if (t > now) break;
    const age = (now - t) / 60000;
    if (o.status === 'delivered' && age < o.deliveryMins) {
      const status = age < NEW_MINS ? 'placed' : age < PREP_MINS ? 'preparing' : 'out_for_delivery';
      result.push({ ...o, status, etaMins: o.deliveryMins, deliveryMins: null, rating: null });
    } else {
      result.push(o);
    }
  }
  return result;
}
