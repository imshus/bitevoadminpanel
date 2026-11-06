// Road routes for the Live map, from an OSRM server (ROUTING_URL), the same as the delivery app's. The public
// demo server at router.project-osrm.org is fine for a small team; for a big fleet host OSRM or use a paid one.
// Each order's route is reused until the rider has moved REROUTE_M or it's REROUTE_MS old, so a map
// refreshing every 10 s asks for a few routes a minute at most. Any failure just means a straight line.
import { config } from '../config.js';

const TIMEOUT_MS = 5000;
const REROUTE_M = 80;
const REROUTE_MS = 90000;
const byOrder = new Map(); // orderId → { from, at, value }
let warnedAt = 0;

export function metres(a, b) {
  const rad = d => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

async function fetchRoute(from, to) {
  const url = `${config.routingUrl}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&alternatives=false&steps=false`;
  const res = await fetch(url, { headers: { 'User-Agent': 'BiteVo-Admin/1.0 (bitevo.in)' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const data = await res.json().catch(() => null);
  const r = data?.code === 'Ok' ? data.routes?.[0] : null;
  if (!r) throw new Error(`HTTP ${res.status} ${data?.code || ''} ${data?.message || ''}`.trim());
  return {
    distanceM: Math.round(r.distance),
    durationS: Math.round(r.duration),
    line: r.geometry.coordinates.map(([lng, lat]) => [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]),
  };
}

// { distanceM, durationS, line: [[lat, lng], …] } from the rider to the customer, or null.
export async function orderRoute(orderId, from, to) {
  if (!config.routingUrl) return null;
  const hit = byOrder.get(orderId);
  if (hit && Date.now() - hit.at < REROUTE_MS && metres(hit.from, from) < REROUTE_M && metres(hit.to, to) < 5) return hit.value;
  try {
    const value = await fetchRoute(from, to);
    byOrder.set(orderId, { from, to, at: Date.now(), value });
    if (byOrder.size > 300) byOrder.delete(byOrder.keys().next().value);
    return value;
  } catch (err) {
    if (Date.now() - warnedAt > 60000) {
      warnedAt = Date.now();
      console.warn(`Road route not available (${err.message}); the Live map draws a straight line.`);
    }
    return hit?.value ?? null; // an older route beats none
  }
}
