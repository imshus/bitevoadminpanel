// Demo mode only: stands in for the customer and delivery apps so the panel feels live.
// Every minute it may place a new order (at a realistic rate for the time of day), marks orders
// delivered once their agent "arrives", and keeps online agents' app sessions active.
import { store } from '../db/index.js';
import { HOURS, ITEM_COUNTS, PAYMENTS, FREE_DELIVERY_ABOVE, DELIVERY_FEE, couponValue } from './orderHistory.js';
import { customerName, maskedPhone } from './catalog.js';
import { objectId } from '../lib/ids.js';
import { couponStatus } from '../lib/rules.js';
import { startOfToday } from '../lib/http.js';

const TICK_MS = 60000;
const SPEED_UP = 2; // twice the normal order rate, so there's something to do in a demo
const ORDERS_PER_DAY = 62;
const HOUR_WEIGHT_TOTAL = HOURS.reduce((s, h) => s + h[1], 0);

const random = () => Math.random();
function weighted(items, weightOf) {
  let roll = random() * items.reduce((s, x) => s + weightOf(x), 0);
  for (const item of items) if ((roll -= weightOf(item)) < 0) return item;
  return items[items.length - 1];
}

async function placeOrder(now) {
  const menu = await store.find('products', { isAvailable: true });
  if (!menu.length) return;

  const items = [];
  const count = weighted(ITEM_COUNTS, x => x[1])[0];
  while (items.length < Math.min(count, menu.length)) {
    const p = weighted(menu, x => (x.isBestseller ? 3 : 1));
    if (!items.some(it => it.productId === p._id)) items.push({ productId: p._id, name: p.name, category: p.category, price: p.price, qty: random() < 0.82 ? 1 : 2 });
  }
  const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
  const deliveryFee = subtotal >= FREE_DELIVERY_ABOVE ? 0 : DELIVERY_FEE;

  // Mostly returning customers; sometimes someone new.
  let customer;
  let isFirstOrder = false;
  if (random() < 0.8) {
    const all = await store.find('customers', {}, { projection: { name: 1, phone: 1 } });
    customer = all[Math.floor(random() * all.length)];
  }
  if (!customer) {
    const i = Math.floor(random() * 100000);
    customer = await store.insert('customers', { name: customerName(i), phone: maskedPhone(i), createdAt: new Date(now).toISOString() });
    isFirstOrder = true;
  }

  let couponCode = null;
  let discount = 0;
  let cashback = 0;
  if (random() < 0.3) {
    const live = (await store.find('coupons')).filter(c => couponStatus(c, now) === 'active' && subtotal >= c.minOrderValue);
    if (live.length) {
      const c = live[Math.floor(random() * live.length)];
      const prices = new Map(menu.map(p => [p._id, p.price]));
      couponCode = c.code;
      ({ discount, cashback } = couponValue(c, subtotal, deliveryFee, id => prices.get(id)));
    }
  }

  const today = new Date(now);
  const seq = (await store.count('orders', { placedAt: { $gte: new Date(startOfToday(now)).toISOString() } })) + 1;
  const mmdd = `${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  await store.insert('orders', {
    _id: objectId(today),
    orderNo: `BV${mmdd}-${String(seq).padStart(3, '0')}`,
    placedAt: today.toISOString(),
    customerId: customer._id, customerName: customer.name, customerPhone: customer.phone,
    items, subtotal, deliveryFee, discount, cashback, couponCode,
    total: subtotal + deliveryFee - discount,
    paymentMethod: weighted(PAYMENTS, x => x[1])[0],
    status: 'placed',
    agentId: null, agentName: null,
    deliveryMins: null, rating: null,
    isFirstOrder, walletUsed: 0, refund: null, history: [],
  });
}

// The delivery app marks orders delivered when the agent arrives.
async function deliverArrivals(now) {
  const due = await store.find('orders', { status: 'out_for_delivery', dueAt: { $lte: new Date(now).toISOString() } });
  for (const o of due) {
    const at = new Date(now).toISOString();
    await store.update('orders', o._id, {
      status: 'delivered', deliveredAt: at,
      deliveryMins: Math.max(1, Math.round((now - Date.parse(o.placedAt)) / 60000)),
      rating: random() < 0.5 ? 3 + Math.floor(random() * 3) : null,
    }, { push: { history: { status: 'delivered', note: 'Delivery app', at, by: o.agentName || 'Delivery agent' } } });
    if (o.cashback > 0) {
      await store.insert('walletTxns', {
        customerId: o.customerId, customerName: o.customerName, customerPhone: o.customerPhone, orderId: o._id,
        type: 'cashback', amount: o.cashback, note: `${o.couponCode} on order ${o.orderNo}`, at,
      });
    }
  }
}

// Online agents' delivery apps (and a few customers' apps) report that they're still active.
async function heartbeats(now) {
  const at = new Date(now).toISOString();
  const agents = await store.find('agents', { isActive: true, status: { $in: ['online', 'busy'] } });
  if (agents.length) await store.updateMany('sessions', { role: 'agent', userId: { $in: agents.map(a => a._id) }, revokedAt: null }, { lastActiveAt: at });
  const customers = await store.find('sessions', { role: 'customer', revokedAt: null });
  for (let i = 0; i < Math.min(3, customers.length); i++) {
    await store.update('sessions', customers[Math.floor(random() * customers.length)]._id, { lastActiveAt: at });
  }
}

export function startSimulator() {
  const tick = async () => {
    const now = Date.now();
    try {
      const hourWeight = HOURS.find(h => h[0] === new Date(now).getHours())?.[1] || 0;
      const perMinute = ((ORDERS_PER_DAY * hourWeight) / HOUR_WEIGHT_TOTAL / 60) * SPEED_UP;
      if (random() < perMinute) await placeOrder(now);
      await deliverArrivals(now);
      await heartbeats(now);
    } catch (err) {
      console.error(`Demo simulator: ${err.message}`);
    }
  };
  tick();
  const timer = setInterval(tick, TICK_MS);
  return () => clearInterval(timer);
}
