// An approximate point for addresses typed without a map pin (the website without a Google key), so the Live map
// still has the customer's home, a road route and an arrival time. OpenStreetMap's Nominatim search, free under its
// usage policy: an identifying User-Agent, at most one request a second for the whole server, answers cached.
// It finds the area or street (e.g. "Sector 45, Gurugram"), not the door, so the map marks it as approximate.
const SEARCH = 'https://nominatim.openstreetmap.org/search';
const KEEP_MS = 24 * 3600000;
const KEEP_MISS_MS = 10 * 60000;
const MAX_WAIT_MS = 3000; // busier than this: no point this time (the map asks again on its next refresh)
const cache = new Map(); // query → { at, value }
let nextAt = 0;
let warnedAt = 0;

const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

// The texts to try, most precise first: the street/area line with the pincode, then the area alone.
function queries(a) {
  const line2 = clean(a.line2);
  const area = clean(a.area);
  return [...new Set([
    [line2, clean(a.pincode)].filter(Boolean).join(', '),
    area && area !== line2 ? area : '',
  ].filter(q => q.length >= 3))];
}

async function search(q) {
  const hit = cache.get(q);
  if (hit && Date.now() - hit.at < (hit.value ? KEEP_MS : KEEP_MISS_MS)) return hit.value;
  const wait = Math.max(0, nextAt - Date.now());
  if (wait > MAX_WAIT_MS) return null;
  nextAt = Math.max(Date.now(), nextAt) + 1100;
  if (wait) await new Promise(resolve => { setTimeout(resolve, wait); });
  let value = null;
  try {
    const qs = new URLSearchParams({ q: `${q}, India`, format: 'jsonv2', limit: '1', countrycodes: 'in', 'accept-language': 'en' });
    const res = await fetch(`${SEARCH}?${qs}`, { headers: { 'User-Agent': 'BiteVo-Admin/1.0 (https://bitevo.in)' }, signal: AbortSignal.timeout(6000) });
    const best = res.ok ? (await res.json())?.[0] : null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (best) value = { lat: Math.round(Number(best.lat) * 1e6) / 1e6, lng: Math.round(Number(best.lon) * 1e6) / 1e6 };
  } catch (err) {
    if (Date.now() - warnedAt > 60000) {
      warnedAt = Date.now();
      console.warn(`Approximate address lookup failed (${err.message}); orders without a map pin stay off the map.`);
    }
    return null; // not cached: tried again next time
  }
  cache.set(q, { at: Date.now(), value });
  if (cache.size > 1000) cache.delete(cache.keys().next().value);
  return value;
}

// { lat, lng } near the typed address, or null.
export async function approxPoint(address) {
  if (!address || (Number.isFinite(address.lat) && Number.isFinite(address.lng))) return null;
  for (const q of queries(address)) {
    const found = await search(q);
    if (found) return found;
  }
  return null;
}
