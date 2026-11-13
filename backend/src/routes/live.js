// The Live map: riders with their latest position from the delivery app, and the live orders with where
// they're going and, once out for delivery, where their rider is. The delivery app writes all of it:
// agents.location { lat, lng, accuracy, heading, speed, at } while a rider is online, orders.riderLocation
// while an order is out for delivery, and riderTrack (one point per fix) for the route driven.
import { Router } from 'express';
import { store } from '../db/index.js';
import { config } from '../config.js';
import { notFound, DAY } from '../lib/http.js';
import { LIVE_STATUSES } from '../lib/rules.js';
import { orderRoute } from '../lib/routing.js';
import { approxPoint } from '../lib/geocode.js';

export const router = Router();

const LIVE_FOR_MS = DAY; // older orders still marked live (never accepted or finished) stay off the map
const MAX_ORDERS = 200;
const MAX_TRACK_POINTS = 400;
const IST_MS = 330 * 60000; // the delivery app keeps the day's distance per Indian date

const point = p => (p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
  ? { lat: p.lat, lng: p.lng, accuracy: p.accuracy ?? null, heading: p.heading ?? null, speed: p.speed ?? null, at: p.at || null }
  : null);
const dropPoint = a => (a && Number.isFinite(a.lat) && Number.isFinite(a.lng) ? { lat: a.lat, lng: a.lng } : null);

router.get('/', async (req, res) => {
  const since = new Date(Date.now() - LIVE_FOR_MS).toISOString();
  const [agents, orders] = await Promise.all([
    store.find('agents', { isActive: true }, { sort: { name: 1 } }),
    store.find('orders', { status: { $in: LIVE_STATUSES }, placedAt: { $gte: since } }, { sort: { placedAt: -1 }, limit: MAX_ORDERS }),
  ]);
  const today = new Date(Date.now() + IST_MS).toISOString().slice(0, 10);

  // The customer's home: the map pin, or for an address typed without one, an approximate point for its area.
  const drops = new Map(await Promise.all(orders.map(async o => {
    const exact = dropPoint(o.address);
    if (exact) return [o._id, exact];
    const near = await approxPoint(o.address).catch(() => null);
    return [o._id, near ? { ...near, approx: true } : null];
  })));

  // On the way: the road route from the rider to the customer's home, with distance and driving time.
  const agentsById = new Map(agents.map(a => [a._id, a]));
  const riderAt = o => point(o.riderLocation) || (agentsById.get(o.agentId)?.status !== 'offline' ? point(agentsById.get(o.agentId)?.location) : null);
  const routes = new Map(await Promise.all(orders
    .filter(o => o.status === 'out_for_delivery' && riderAt(o) && drops.get(o._id))
    .map(async o => [o._id, await orderRoute(o._id, riderAt(o), drops.get(o._id))])));

  res.json({
    kitchen: config.kitchen,
    riders: agents.map(a => ({
      _id: a._id,
      name: a.name,
      phone: a.phone,
      vehicleType: a.vehicleType,
      vehicleNumber: a.vehicleNumber || '',
      kycStatus: a.kycStatus,
      status: a.status || 'offline',
      onlineVia: a.onlineVia || null, // 'app' when the rider went online in the delivery app
      onlineAt: a.status !== 'offline' ? a.onlineAt || null : null,
      location: point(a.location),
      kmToday: a.odometer?.day === today ? Math.round(a.odometer.km * 10) / 10 : 0,
      orderIds: orders.filter(o => o.agentId === a._id).map(o => o._id),
    })),
    orders: orders.map(o => ({
      _id: o._id,
      orderNo: o.orderNo,
      status: o.status,
      placedAt: o.placedAt,
      dispatchedAt: o.dispatchedAt || null,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      address: o.address ? { label: o.address.label || '', line1: o.address.line1 || '', line2: o.address.line2 || '', landmark: o.address.landmark || '', area: o.address.area || '' } : null,
      drop: drops.get(o._id), // { lat, lng, approx? }: approx = from the typed address, not a pin
      agentId: o.agentId || null,
      agentName: o.agentName || null,
      // Set by the rider-assignment flow when it's in use ('requested' → 'accepted' / 'declined').
      riderStatus: o.riderStatus || null,
      riderAcceptedAt: o.riderAcceptedAt || null,
      riderLocation: o.status === 'out_for_delivery' ? point(o.riderLocation) : null,
      route: routes.get(o._id) || null, // { distanceM, durationS, line } while out for delivery
    })),
    at: new Date().toISOString(),
  });
});

// The orders waiting to be accepted (status 'placed'), newest first, in a few fields: what the Android app's
// background bell (mobile/, OrderWatchService) checks every few seconds while the app isn't on screen, so it's kept
// small. Older than a day: left out, as on the Live map.
router.get('/waiting', async (req, res) => {
  const since = new Date(Date.now() - LIVE_FOR_MS).toISOString();
  const orders = await store.find('orders', { status: 'placed', placedAt: { $gte: since } }, { sort: { placedAt: -1 }, limit: MAX_ORDERS });
  res.json({
    orders: orders.map(o => ({
      _id: o._id,
      orderNo: o.orderNo,
      customerName: o.customerName || '',
      items: (o.items || []).reduce((n, it) => n + (Number(it.qty) || 1), 0),
      total: o.total ?? 0,
      placedAt: o.placedAt,
    })),
    at: new Date().toISOString(),
  });
});

// The route driven so far for one order, thinned to at most MAX_TRACK_POINTS points: [[lat, lng], …].
router.get('/orders/:id/track', async (req, res) => {
  const order = await store.findById('orders', req.params.id);
  if (!order) throw notFound('This order no longer exists.');
  const points = await store.find('riderTrack', { orderId: order._id }, { sort: { at: 1 }, limit: 5000 });
  const every = Math.max(1, Math.ceil(points.length / MAX_TRACK_POINTS));
  res.json({ points: points.filter((p, i) => i % every === 0 || i === points.length - 1).map(p => [p.lat, p.lng]) });
});
