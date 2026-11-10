// Live map: where the riders are right now (from the delivery app) and where the live orders are going, drawn
// like a delivery-tracking map: a calm base map, scooters that turn and glide to each new position, the road
// route to the customer with the arrival time, and a tracking card for the order or rider you pick.
// Riders' phones send their position every few seconds while online; this page reloads every 10 seconds.
// /live?order=<id> opens with that order picked.
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { live as api } from '../api/index.js';
import { useApi, usePageTitle } from '../lib/useApi.js';
import { num, timeAgo, dateTime, addressShort, mapsUrl, initials } from '../lib/format.js';
import { ORDER_STATUS, AGENT_STATUS } from '../lib/status.js';
import { PageHeader, Badge, Segmented, StatTile, Loading, ErrorState } from '../components/ui.jsx';
import { Refresh, Bike, Bag, Clock, MapPin, Activity, X, Phone } from '../components/Icons.jsx';

const REFRESH_MS = 10000;
const STALE_MS = 3 * 60000; // an older position is drawn faded: the phone has stopped sending
const GLIDE_MS = 1600;
const GURUGRAM = { lat: 28.4595, lng: 77.0266 };
const CLOSE_ZOOM = 16;
// OpenStreetMap's tiles (no key needed), toned down in styles.css so the riders and routes stand out, and
// turned dark with the panel's dark theme. A styled tile server (e.g. a MapTiler or Stadia key) can be set at
// build time with VITE_MAP_TILES (and VITE_MAP_TILES_DARK); those are shown as they are.
const CUSTOM_TILES = Boolean(import.meta.env.VITE_MAP_TILES);
const TILES = {
  light: import.meta.env.VITE_MAP_TILES || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  dark: import.meta.env.VITE_MAP_TILES_DARK || import.meta.env.VITE_MAP_TILES || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
};
const ATTRIBUTION = import.meta.env.VITE_MAP_ATTRIBUTION
  || '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

const hasPoint = p => Boolean(p) && Number.isFinite(p.lat) && Number.isFinite(p.lng);
const ll = p => [p.lat, p.lng];
const isFresh = p => Boolean(p?.at) && Date.now() - Date.parse(p.at) < STALE_MS;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const firstName = name => String(name || '').trim().split(/\s+/)[0] || '';
const shortNo = orderNo => String(orderNo || '').split('-').pop(); // "BV1105-069" → "069"
const telHref = phone => `tel:${String(phone || '').replace(/[^\d+]/g, '')}`;
const etaMins = s => Math.max(1, Math.round(s / 60));
const distance = m => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`);
const themeNow = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

function metres(a, b) {
  const rad = d => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

// Compass bearing from a to b, 0° = north.
function bearing(a, b) {
  const rad = d => (d * Math.PI) / 180;
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const STATUS_RANK = { busy: 0, online: 1, offline: 2 };
const STEPS = [
  { key: 'placed', label: 'Placed' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'out_for_delivery', label: 'On the way' },
  { key: 'delivered', label: 'Delivered' },
];

// Where a rider is shown: the position on their order while out for delivery, else their own.
function riderSpot(rider, orders) {
  const out = orders.find(o => o.agentId === rider._id && o.status === 'out_for_delivery' && hasPoint(o.riderLocation));
  return out ? out.riderLocation : rider.location;
}

// The order's rider step, in words. riderStatus comes from the assignment flow when it's in use.
function riderLine(o) {
  if (!o.agentId) return o.riderStatus === 'declined' ? 'Rider declined · waiting for another rider' : 'Waiting for a rider';
  if (o.status === 'out_for_delivery') return `${o.agentName} is on the way`;
  if (o.riderStatus === 'requested') return `Waiting for ${o.agentName} to accept`;
  if (o.riderStatus === 'accepted' || o.riderAcceptedAt) return `${o.agentName} accepted · going to the kitchen`;
  return `Assigned to ${o.agentName}`;
}

const headline = o => (o.status === 'out_for_delivery'
  ? (o.route ? `Arriving in ${o.drop?.approx ? 'about ' : ''}${etaMins(o.route.durationS)} min` : 'On the way')
  : o.status === 'preparing' ? 'Being prepared' : 'New order');
const dropTone = o => (!o.agentId ? 'waiting' : o.status === 'out_for_delivery' ? 'out' : 'assigned');

function riderSub(r, orders) {
  const at = r.location?.at;
  if (r.status === 'offline') return at ? `Last seen ${timeAgo(at)}` : 'Offline';
  const out = orders.find(o => o.agentId === r._id && o.status === 'out_for_delivery');
  const load = out ? `Delivering ${out.orderNo}${out.route ? ` · ${etaMins(out.route.durationS)} min away` : ''}`
    : r.orderIds.length ? `${r.orderIds.length} order${r.orderIds.length > 1 ? 's' : ''} to pick up` : 'Free';
  if (!at) return `${load} · waiting for location`;
  return isFresh(r.location) ? load : `${load} · no update for ${timeAgo(at).replace(' ago', '')}`;
}

// ---------- Markers: Leaflet places this HTML on the map (styled in styles.css) ----------
// A scooter seen from above, pointing north; it's turned to the rider's heading.
const SCOOTER_SVG = '<svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">'
  + '<rect x="13" y="2" width="6" height="7" rx="2.6" fill="#232323"/><rect x="13" y="23" width="6" height="7" rx="2.6" fill="#232323"/>'
  + '<rect x="10.5" y="6.5" width="11" height="19.5" rx="5.5" fill="currentColor"/>'
  + '<rect x="6" y="8" width="20" height="2.8" rx="1.4" fill="#232323"/>'
  + '<rect x="11" y="18.5" width="10" height="8.5" rx="2" fill="#FFC83D" stroke="#232323" stroke-width="1.1"/>'
  + '<circle cx="16" cy="14.2" r="4.1" fill="#fff" stroke="#232323" stroke-width="1.3"/></svg>';
const HOME_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/></svg>';
const STORE_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h16l-1.5-5h-13z"/><path d="M5 9v11h14V9"/><path d="M9 20v-5h6v5"/></svg>';

const riderIcon = () => L.divIcon({
  className: 'lm-icon',
  html: `<div class="lm-rider"><span class="lm-rider__pulse"></span><span class="lm-rider__puck"><span class="lm-rider__dir">${SCOOTER_SVG}</span></span><span class="lm-rider__name"></span></div>`,
  iconSize: [46, 46],
  iconAnchor: [23, 23],
});
const homeIcon = (o, selected) => L.divIcon({
  className: 'lm-icon',
  html: `<div class="lm-home lm-home--${dropTone(o)}${o.drop?.approx ? ' is-approx' : ''}${selected ? ' is-selected' : ''}"><span class="lm-home__pin"><span>${HOME_SVG}</span></span><span class="lm-home__tag">${esc(shortNo(o.orderNo))}${o.customerName ? ` · ${esc(firstName(o.customerName))}` : ''}${o.drop?.approx ? ' · approx.' : ''}</span></div>`,
  iconSize: [34, 42],
  iconAnchor: [17, 41],
});
const storeIcon = name => L.divIcon({
  className: 'lm-icon',
  html: `<div class="lm-store"><span class="lm-store__badge">${STORE_SVG}</span><span class="lm-store__name">${esc(name)}</span></div>`,
  iconSize: [38, 38],
  iconAnchor: [19, 19],
});

// Moves a rider's marker smoothly to its new position instead of jumping.
function glide(m, to) {
  const from = m.marker.getLatLng();
  const start = performance.now();
  cancelAnimationFrame(m.raf);
  const step = now => {
    const t = Math.min(1, (now - start) / GLIDE_MS);
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    m.marker.setLatLng([from.lat + (to.lat - from.lat) * e, from.lng + (to.lng - from.lng) * e]);
    if (t < 1) m.raf = requestAnimationFrame(step);
  };
  m.raf = requestAnimationFrame(step);
}

/**
 * kitchen  { lat, lng, name } or null
 * riders, orders  from GET /api/live
 * selected { kind: 'rider' | 'order', id } or null
 * trail    [[lat, lng], …] driven so far for the selected order, or null
 * fitKey   fits everything on the map whenever it changes
 * focus    { lat, lng, key }: moves there whenever `key` changes
 */
function FleetMap({ kitchen, riders, orders, selected, trail, fitKey, focus, onSelect }) {
  const box = useRef(null);
  const st = useRef(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  const latest = useRef({ kitchen, riders, orders });
  latest.current = { kitchen, riders, orders };

  useEffect(() => {
    const map = L.map(box.current, { zoomControl: false }).setView(ll(kitchen || GURUGRAM), 13);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a>');
    const tileOptions = { maxZoom: 19, attribution: ATTRIBUTION };
    let theme = themeNow();
    let tiles = L.tileLayer(TILES[theme], tileOptions).addTo(map);
    // Light or dark map with the panel's theme (the OSM tiles are recoloured in CSS; custom ones are swapped).
    const themeWatch = new MutationObserver(() => {
      if (themeNow() === theme) return;
      theme = themeNow();
      if (TILES.dark === TILES.light) return;
      tiles.remove();
      tiles = L.tileLayer(TILES[theme], tileOptions).addTo(map);
      tiles.bringToBack();
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(box.current);
    st.current = { map, lines: L.layerGroup().addTo(map), riders: new Map(), homes: new Map(), store: null };
    return () => {
      for (const m of st.current.riders.values()) cancelAnimationFrame(m.raf);
      themeWatch.disconnect();
      resize.disconnect();
      map.remove();
      st.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const s = st.current;
    if (!s) return;
    const css = getComputedStyle(document.documentElement);
    const color = name => css.getPropertyValue(name).trim();
    const selOrder = selected?.kind === 'order' ? orders.find(o => o._id === selected.id) : null;

    // The kitchen.
    if (kitchen && !s.store) s.store = L.marker(ll(kitchen), { icon: storeIcon(kitchen.name), keyboard: false, zIndexOffset: -200 }).addTo(s.map);
    if (!kitchen && s.store) { s.store.remove(); s.store = null; }

    // Routes: the road to the customer for every order on the way (bold for the picked one), the route already
    // driven for the picked one, and a dotted straight line when there's no road route.
    s.lines.clearLayers();
    if (trail?.length > 1) L.polyline(trail, { color: color('--neutral'), weight: 5, opacity: 0.7, lineCap: 'round' }).addTo(s.lines);
    const ridersById = new Map(riders.map(r => [r._id, r]));
    for (const o of orders) {
      if (o.status !== 'out_for_delivery' || !hasPoint(o.drop)) continue;
      const sel = selOrder?._id === o._id;
      if (o.route?.line?.length > 1) {
        L.polyline(o.route.line, { color: color('--surface'), weight: sel ? 10 : 7, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }).addTo(s.lines);
        L.polyline(o.route.line, { color: sel ? color('--text') : color('--brand'), weight: sel ? 5 : 3.5, opacity: sel ? 0.95 : 0.65, lineCap: 'round', lineJoin: 'round' }).addTo(s.lines);
      } else {
        const r = ridersById.get(o.agentId);
        const from = hasPoint(o.riderLocation) ? o.riderLocation : r && hasPoint(r.location) ? r.location : null;
        if (from) L.polyline([ll(from), ll(o.drop)], { color: color('--text'), weight: 4, opacity: sel ? 0.8 : 0.45, dashArray: '1 9', lineCap: 'round' }).addTo(s.lines);
      }
    }

    // Customers' homes.
    const homesSeen = new Set();
    for (const o of orders) {
      if (!hasPoint(o.drop)) continue;
      homesSeen.add(o._id);
      const sel = selOrder?._id === o._id;
      const key = `${dropTone(o)}|${sel}|${o.orderNo}|${o.customerName}|${o.drop.approx ? 1 : 0}`;
      const h = s.homes.get(o._id);
      if (!h) {
        const marker = L.marker(ll(o.drop), { icon: homeIcon(o, sel), keyboard: false, title: `${o.orderNo} · ${riderLine(o)}` })
          .on('click', () => select.current('order', o._id)).addTo(s.map);
        s.homes.set(o._id, { marker, key });
      } else if (h.key !== key) {
        h.marker.setIcon(homeIcon(o, sel));
        h.key = key;
      }
      s.homes.get(o._id).marker.setZIndexOffset(sel ? 800 : 0);
    }
    for (const [id, h] of s.homes) if (!homesSeen.has(id)) { h.marker.remove(); s.homes.delete(id); }

    // Riders: one marker each, kept between refreshes so it can glide and turn.
    const ridersSeen = new Set();
    for (const r of riders) {
      const spot = r.status !== 'offline' ? riderSpot(r, orders) : null;
      if (!hasPoint(spot)) continue;
      ridersSeen.add(r._id);
      const sel = selected?.kind === 'rider' ? selected.id === r._id : selOrder?.agentId === r._id;
      let m = s.riders.get(r._id);
      if (!m) {
        const marker = L.marker(ll(spot), { icon: riderIcon(), keyboard: false, title: r.name })
          .on('click', () => select.current('rider', r._id)).addTo(s.map);
        m = { marker, pos: spot, heading: 0, rot: 0, raf: 0 };
        s.riders.set(r._id, m);
      }
      // Facing: the phone's heading while moving, else the way it moved, else along the road to the customer.
      const out = orders.find(o => o.agentId === r._id && o.status === 'out_for_delivery');
      const moved = metres(m.pos, spot);
      let heading = m.heading;
      if (spot.heading != null && (spot.speed ?? 1) > 0.7) heading = spot.heading;
      else if (moved > 8) heading = bearing(m.pos, spot);
      else if (out?.route?.line?.length > 1) heading = bearing(spot, { lat: out.route.line[1][0], lng: out.route.line[1][1] });
      if (moved > 1) glide(m, spot);
      m.pos = spot;
      m.rot += ((heading - (m.rot % 360) + 540) % 360) - 180; // turn the short way round
      m.heading = heading;

      const el = m.marker.getElement();
      const root = el?.querySelector('.lm-rider');
      if (root) {
        root.className = `lm-rider lm-rider--${r.status}${isFresh(spot) ? '' : ' is-stale'}${sel ? ' is-selected' : ''}`;
        root.querySelector('.lm-rider__dir').style.transform = `rotate(${m.rot}deg)`;
        root.querySelector('.lm-rider__name').textContent = firstName(r.name);
      }
      m.marker.setZIndexOffset(sel ? 1000 : 600);
      if (sel && spot.accuracy > 20 && spot.accuracy < 1000) {
        L.circle(ll(spot), { radius: spot.accuracy, color: color('--info'), weight: 1, opacity: 0.5, fillOpacity: 0.07 }).addTo(s.lines);
      }
    }
    for (const [id, m] of s.riders) if (!ridersSeen.has(id)) { cancelAnimationFrame(m.raf); m.marker.remove(); s.riders.delete(id); }
  }, [kitchen, riders, orders, selected, trail]);

  // Everything on the map: the kitchen, online riders and the customers' homes.
  useEffect(() => {
    const map = st.current?.map;
    if (!map) return;
    const { kitchen: k, riders: rs, orders: os } = latest.current;
    const points = [k, ...rs.filter(r => r.status !== 'offline').map(r => riderSpot(r, os)), ...os.map(o => o.drop)].filter(hasPoint);
    if (points.length === 1) map.setView(ll(points[0]), CLOSE_ZOOM - 1);
    else if (points.length > 1) map.fitBounds(points.map(ll), { padding: [60, 60], maxZoom: CLOSE_ZOOM });
  }, [fitKey]);

  // Picking an order or rider: show it, with its route if it has one.
  useEffect(() => {
    const map = st.current?.map;
    if (!focus || !map) return;
    // Keep the picked things clear of the tracking card over the map: beside it when there's room, else above it.
    // (The card is drawn on the next frame, after this pick.)
    requestAnimationFrame(() => {
      const size = map.getSize();
      const card = box.current?.parentElement?.querySelector('.lm-float');
      const c = card && getComputedStyle(card).position === 'absolute' ? card.getBoundingClientRect() : null;
      let topLeft = [60, 60];
      let bottomRight = [60, 60];
      if (c && size.x - c.width - 32 >= 280) topLeft = [c.width + 48, 60];
      else if (c) bottomRight = [40, Math.min(c.height + 40, size.y - 160)];
      if (focus.bounds?.length > 1) {
        map.fitBounds(focus.bounds, { paddingTopLeft: topLeft, paddingBottomRight: bottomRight, maxZoom: CLOSE_ZOOM, animate: true });
      } else {
        const zoom = Math.max(map.getZoom(), CLOSE_ZOOM - 1);
        // Centre the point in the part of the map the card leaves free.
        const shift = L.point((topLeft[0] - bottomRight[0]) / 2, (topLeft[1] - bottomRight[1]) / 2);
        map.setView(map.unproject(map.project(ll(focus), zoom).subtract(shift), zoom), zoom, { animate: true });
      }
    });
  }, [focus?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={box} className={`live-map${CUSTOM_TILES ? '' : ' live-map--osm'}`} role="img" aria-label="Map of riders and live orders" />;
}

function Person({ avatar, tone, name, sub, phone, onName }) {
  return (
    <div className="lm-person">
      <span className={`lm-ava lm-ava--${tone}`}>{avatar}</span>
      <span className="lm-person__text">
        {onName ? <button type="button" className="lm-person__name" onClick={onName}>{name}</button> : <b className="lm-person__name">{name}</b>}
        {sub && <span className="muted">{sub}</span>}
      </span>
      {phone && <a className="lm-call" href={telHref(phone)} aria-label={`Call ${name}`} title={phone}><Phone size={16} /></a>}
    </div>
  );
}

// The tracking card for a picked order, over the map.
function OrderCard({ order, rider, onPick, onClose }) {
  const now = STEPS.findIndex(s => s.key === order.status);
  const sub = [riderLine(order), order.route && `${distance(order.route.distanceM)} to go`].filter(Boolean).join(' · ');
  return (
    <div className="lm-float" role="region" aria-label={`Order ${order.orderNo}`}>
      <button type="button" className="lm-float__close" onClick={onClose} aria-label="Close"><X size={16} /></button>
      <p className="lm-float__eyebrow"><span className="mono">{order.orderNo}</span> · placed {timeAgo(order.placedAt)}</p>
      <h3 className="lm-float__title">{headline(order)}</h3>
      <p className="lm-float__sub">{sub}</p>
      <ol className="lm-steps" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s.key} className={i < now ? 'is-done' : i === now ? 'is-now' : ''}><i />{s.label}</li>
        ))}
      </ol>
      <div className="lm-float__people">
        {rider ? (
          <Person avatar={initials(rider.name)} tone={rider.status} name={rider.name} phone={rider.phone}
            sub={[rider.vehicleType, rider.vehicleNumber].filter(Boolean).join(' · ')} onName={() => onPick('rider', rider._id)} />
        ) : (
          <Person avatar={<Bike size={16} />} tone="none" name="No rider yet" sub="Assign one on the Orders page" />
        )}
        <Person avatar={<MapPin size={16} />} tone="home" name={order.customerName} phone={order.customerPhone}
          sub={order.address ? `${addressShort(order.address)}${order.address.landmark ? ` · near ${order.address.landmark}` : ''}` : 'No address on this order'} />
      </div>
      {order.drop?.approx && <p className="lm-float__note">The customer typed this address without a map pin, so the home, route and arrival time are approximate (for its area).</p>}
      {!hasPoint(order.drop) && <p className="lm-float__note">Typed without a map pin and the area couldn’t be found, so the home isn’t on the map.</p>}
      {order.status === 'out_for_delivery' && order.riderLocation?.at && !isFresh(order.riderLocation) && (
        <p className="lm-float__note">No update from the rider’s phone for {timeAgo(order.riderLocation.at).replace(' ago', '')}.</p>
      )}
    </div>
  );
}

// The card for a picked rider, over the map.
function RiderCard({ rider, orders, onPick, onClose }) {
  const st = AGENT_STATUS[rider.status] || AGENT_STATUS.offline;
  const mine = orders.filter(o => o.agentId === rider._id);
  const at = rider.location?.at;
  const where = !at ? (rider.status === 'offline' ? 'Offline, no location shared yet' : 'Online, waiting for the phone’s location')
    : rider.status === 'offline' ? `Offline · last seen ${timeAgo(at)}`
    : isFresh(rider.location) ? `Location updated ${timeAgo(at)}${rider.location.accuracy ? ` · within ${Math.round(rider.location.accuracy)} m` : ''}`
    : `No update for ${timeAgo(at).replace(' ago', '')}: the app may be closed`;
  return (
    <div className="lm-float" role="region" aria-label={rider.name}>
      <button type="button" className="lm-float__close" onClick={onClose} aria-label="Close"><X size={16} /></button>
      <Person avatar={initials(rider.name)} tone={rider.status} name={rider.name} phone={rider.phone}
        sub={[rider.vehicleType, rider.vehicleNumber].filter(Boolean).join(' · ')} />
      <p className="lm-float__sub"><Badge tone={st.tone}>{st.label}</Badge> <span>{where}</span></p>
      {rider.status !== 'offline' && (rider.onlineAt || rider.kmToday > 0) && (
        <p className="lm-float__note">{rider.onlineAt ? `Online since ${dateTime(rider.onlineAt)}` : ''}{rider.onlineAt && rider.kmToday ? ' · ' : ''}{rider.kmToday ? `${rider.kmToday} km today` : ''}</p>
      )}
      {mine.length > 0 && (
        <ul className="lm-float__orders">
          {mine.map(o => (
            <li key={o._id}>
              <button type="button" onClick={() => onPick('order', o._id)}>
                <span className="mono">{o.orderNo}</span>
                <span className="muted">{o.status === 'out_for_delivery' && o.route ? `${etaMins(o.route.durationS)} min away` : ORDER_STATUS[o.status]?.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {hasPoint(rider.location) && (
        <a className="btn btn--ghost btn--sm" href={mapsUrl(rider.location)} target="_blank" rel="noreferrer"><MapPin size={14} /> Open in Google Maps</a>
      )}
    </div>
  );
}

export default function LiveMap() {
  usePageTitle('Live map');
  const [params, setParams] = useSearchParams();
  // /live?order=<id> or /live?rider=<id> (links from the Orders and Delivery agents pages) open with it picked.
  const startOrder = params.get('order');
  const startRider = params.get('rider');
  const { data, loading, refreshing, error, reload } = useApi(() => api.get());
  const [tab, setTab] = useState(startOrder ? 'orders' : 'riders');
  const [selected, setSelected] = useState(startOrder ? { kind: 'order', id: startOrder } : startRider ? { kind: 'rider', id: startRider } : null);
  const [fitKey, setFitKey] = useState(0);
  const [focus, setFocus] = useState(null);
  const [trail, setTrail] = useState(null);

  // Reload every 10 s while the page is on screen, and straight away when it comes back.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') reload(); };
    const timer = setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [reload]);

  const riders = data?.riders || [];
  const orders = data?.orders || [];
  const ridersById = new Map(riders.map(r => [r._id, r]));

  // What to show when something is picked: a rider's spot, or an order's rider and home (and road between).
  const focusFor = sel => {
    if (sel?.kind === 'rider') {
      const r = ridersById.get(sel.id);
      const p = r && (r.status !== 'offline' ? riderSpot(r, orders) : r.location);
      return hasPoint(p) ? { lat: p.lat, lng: p.lng } : null;
    }
    const o = orders.find(x => x._id === sel?.id);
    if (!o) return null;
    const r = ridersById.get(o.agentId);
    const spot = r && r.status !== 'offline' ? riderSpot(r, orders) : null;
    const pts = [o.status === 'out_for_delivery' && spot, o.drop, ...(o.route?.line || []).map(([lat, lng]) => ({ lat, lng }))].filter(hasPoint);
    if (!pts.length) return null;
    return { lat: pts[0].lat, lng: pts[0].lng, bounds: pts.length > 1 ? pts.map(ll) : null };
  };

  const pick = (kind, id, move = true) => {
    const next = { kind, id };
    setSelected(next);
    setTab(kind === 'rider' ? 'riders' : 'orders');
    setParams(kind === 'order' ? { order: id } : { rider: id }, { replace: true });
    const f = focusFor(next);
    if (move && f) setFocus({ ...f, key: Date.now() });
  };
  const unpick = () => { setSelected(null); setParams({}, { replace: true }); };

  // Opened with ?order=…: show it once the data is in.
  const focusedStart = useRef(false);
  useEffect(() => {
    if (!data || focusedStart.current || !selected) return;
    focusedStart.current = true;
    const f = focusFor(selected);
    if (f) setFocus({ ...f, key: Date.now() });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // The route driven so far, for a picked order that's out for delivery (refreshed with the map).
  const selOrder = selected?.kind === 'order' ? orders.find(o => o._id === selected.id) : null;
  const selRider = selected?.kind === 'rider' ? ridersById.get(selected.id) : null;
  const trailFor = selOrder?.status === 'out_for_delivery' ? selOrder._id : null;
  useEffect(() => {
    if (!trailFor) { setTrail(null); return undefined; }
    let alive = true;
    api.track(trailFor).then(r => { if (alive) setTrail(r.points); }, () => { if (alive) setTrail(null); });
    return () => { alive = false; };
  }, [trailFor, data?.at]);

  if (loading) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;

  const sortedRiders = [...riders].sort((a, b) => (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3) || a.name.localeCompare(b.name));
  const rank = o => (!o.agentId ? 0 : o.status === 'out_for_delivery' ? 2 : 1);
  const sortedOrders = [...orders].sort((a, b) => rank(a) - rank(b) || b.placedAt.localeCompare(a.placedAt));
  const free = riders.filter(r => r.status === 'online' && !r.orderIds.length).length;
  const busy = riders.filter(r => r.status === 'busy').length;
  const waiting = orders.filter(o => !o.agentId).length;
  const out = orders.filter(o => o.status === 'out_for_delivery').length;
  const unpinned = orders.filter(o => !hasPoint(o.drop)).length;
  const approx = orders.filter(o => o.drop?.approx).length;
  const onMap = riders.some(r => r.status !== 'offline' && hasPoint(r.location)) || orders.some(o => hasPoint(o.drop));

  return (
    <>
      <PageHeader eyebrow="Delivery" title="Live map" subtitle="Your riders right now, from the delivery app, and where every live order is going.">
        <button className="btn btn--outline" onClick={reload} disabled={refreshing}><Refresh size={18} />{refreshing ? 'Refreshing…' : 'Refresh'}</button>
      </PageHeader>

      <div className="stats">
        <StatTile icon={<Bike size={18} />} label="Free riders" value={num(free)} hint={`${riders.filter(r => r.status !== 'offline').length} online in all`} />
        <StatTile icon={<Activity size={18} />} label="On a delivery" value={num(busy)} hint={`${out} order${out === 1 ? '' : 's'} on the way`} />
        <StatTile icon={<Clock size={18} />} label="Waiting for a rider" value={num(waiting)} hint="Live orders with no rider" />
        <StatTile icon={<Bag size={18} />} label="Live orders" value={num(orders.length)} hint="Placed in the last 24 hours" />
      </div>

      {error && <p className="notice notice--info live__stale" role="status">Couldn’t refresh ({error.message}). Showing the map from {timeAgo(data.at)}.</p>}

      <div className="live">
        <section className="card live__map-card">
          <div className="live__stage">
            <FleetMap kitchen={data.kitchen} riders={riders} orders={orders} selected={selected} trail={trail}
              fitKey={fitKey} focus={focus} onSelect={(kind, id) => pick(kind, id, false)} />
            <span className={`lm-live${error ? ' is-off' : ''}`}><i />{error ? 'Not updating' : 'Live'}</span>
            <button type="button" className="lm-fit" onClick={() => setFitKey(k => k + 1)}>Show all</button>
            {!onMap && <p className="live__empty">No riders online and no live orders with a map pin right now.</p>}
            {selOrder && <OrderCard order={selOrder} rider={ridersById.get(selOrder.agentId)} onPick={pick} onClose={unpick} />}
            {selRider && <RiderCard rider={selRider} orders={orders} onPick={pick} onClose={unpick} />}
          </div>
          <div className="live__legend">
            <span><i className="lm-key lm-key--online" /> Free rider</span>
            <span><i className="lm-key lm-key--busy" /> Delivering</span>
            <span><i className="lm-key lm-key--waiting" /> Needs a rider</span>
            <span><i className="lm-key lm-key--assigned" /> Rider assigned</span>
            <span><i className="lm-key lm-key--out" /> On the way</span>
            {!data.kitchen && <span className="muted">Set KITCHEN_LAT and KITCHEN_LNG in backend/.env to show the kitchen.</span>}
            {approx > 0 && <span className="muted"><i className="lm-key lm-key--approx" /> {approx === 1 ? 'Home' : `${approx} homes`} from a typed address (no map pin): approximate.</span>}
            {unpinned > 0 && <span className="muted">{unpinned} order{unpinned > 1 ? 's' : ''} without a location, so only in the list.</span>}
          </div>
        </section>

        <aside className="card lm-lists">
          <Segmented label="Show" value={tab} onChange={setTab} options={[
            { value: 'riders', label: 'Riders', count: riders.length },
            { value: 'orders', label: 'Orders', count: orders.length },
          ]} />
          {tab === 'riders' ? (
            sortedRiders.length === 0 ? <p className="muted lm-none">No active riders. Add them on the Delivery agents page.</p> : (
              <ul className="lm-list">
                {sortedRiders.map(r => (
                  <li key={r._id}>
                    <button type="button" className={`lm-row${selRider?._id === r._id ? ' is-active' : ''}`} onClick={() => pick('rider', r._id)}>
                      <span className={`lm-ava lm-ava--${r.status}${r.status !== 'offline' && !isFresh(r.location) ? ' is-stale' : ''}`}>{initials(r.name)}</span>
                      <span className="lm-row__main"><b>{r.name}</b><span className="muted">{riderSub(r, orders)}</span></span>
                      <Badge tone={AGENT_STATUS[r.status]?.tone}>{AGENT_STATUS[r.status]?.label || r.status}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            sortedOrders.length === 0 ? <p className="muted lm-none">No live orders in the last 24 hours.</p> : (
              <ul className="lm-list">
                {sortedOrders.map(o => (
                  <li key={o._id}>
                    <button type="button" className={`lm-row${selOrder?._id === o._id ? ' is-active' : ''}`} onClick={() => pick('order', o._id)}>
                      <span className={`lm-ava lm-ava--${dropTone(o)}`}>{shortNo(o.orderNo)}</span>
                      <span className="lm-row__main">
                        <b><span className="mono">{o.orderNo}</span> · {firstName(o.customerName) || 'Customer'}</b>
                        <span className="muted">{riderLine(o)}{o.address ? ` · ${o.address.area || o.address.line2}` : ''}</span>
                      </span>
                      {o.status === 'out_for_delivery' && o.route
                        ? <span className="lm-eta">{etaMins(o.route.durationS)} min</span>
                        : <Badge tone={ORDER_STATUS[o.status]?.tone}>{ORDER_STATUS[o.status]?.label}</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}
        </aside>
      </div>
    </>
  );
}
