// Live map: where the riders are right now (from the delivery app) and where the live orders are going.
// Riders' phones send their position every few seconds while they're online in the delivery app; this page
// reloads every 10 seconds while it's open and shows each position with how old it is.
// /live?order=<id> opens with that order picked.
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { live as api } from '../api/index.js';
import { useApi, usePageTitle } from '../lib/useApi.js';
import { num, timeAgo, dateTime, addressShort, mapsUrl } from '../lib/format.js';
import { ORDER_STATUS, AGENT_STATUS } from '../lib/status.js';
import { PageHeader, Badge, Segmented, StatTile, Loading, ErrorState } from '../components/ui.jsx';
import { Refresh, Bike, Bag, Clock, MapPin, Activity } from '../components/Icons.jsx';

const REFRESH_MS = 10000;
const STALE_MS = 3 * 60000; // an older position is drawn faded: the phone has stopped sending
const GURUGRAM = { lat: 28.4595, lng: 77.0266 };
const CLOSE_ZOOM = 16;
// Another tile server (with its own usage terms) can be set at build time, as in the delivery app.
const TILES = import.meta.env.VITE_MAP_TILES || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = import.meta.env.VITE_MAP_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

const hasPoint = p => Boolean(p) && Number.isFinite(p.lat) && Number.isFinite(p.lng);
const ll = p => [p.lat, p.lng];
const isFresh = p => Boolean(p?.at) && Date.now() - Date.parse(p.at) < STALE_MS;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const firstName = name => String(name || '').trim().split(/\s+/)[0] || 'Rider';
const shortNo = orderNo => String(orderNo || '').split('-').pop(); // "BV1105-069" → "069"
const telHref = phone => `tel:${String(phone || '').replace(/[^\d+]/g, '')}`;

const STATUS_RANK = { busy: 0, online: 1, offline: 2 };

// Where an order is on the map: with its rider once out for delivery, else at the customer's pin.
function riderPosition(order, ridersById) {
  if (hasPoint(order.riderLocation)) return order.riderLocation;
  const rider = ridersById.get(order.agentId);
  return rider && rider.status !== 'offline' && hasPoint(rider.location) ? rider.location : null;
}

// The order's rider step, in words. riderStatus comes from the assignment flow when it's in use.
function riderLine(o) {
  if (!o.agentId) return o.riderStatus === 'declined' ? 'Rider declined · waiting for another rider' : 'Waiting for a rider';
  if (o.status === 'out_for_delivery') return `${o.agentName} is on the way`;
  if (o.riderStatus === 'requested') return `Waiting for ${o.agentName} to accept`;
  if (o.riderStatus === 'accepted' || o.riderAcceptedAt) return `${o.agentName} accepted · going to the kitchen`;
  return `Assigned to ${o.agentName}`;
}

const dropTone = o => (!o.agentId ? 'waiting' : o.status === 'out_for_delivery' ? 'out' : 'assigned');

function riderSub(r) {
  const at = r.location?.at;
  if (r.status === 'offline') return at ? `Offline · last seen ${timeAgo(at)}` : 'Offline';
  const load = r.orderIds.length ? `${r.orderIds.length} order${r.orderIds.length > 1 ? 's' : ''}` : 'Free';
  if (!at) return `${load} · waiting for the phone’s location`;
  return `${load} · ${isFresh(r.location) ? `updated ${timeAgo(at)}` : `no update since ${timeAgo(at)}`}`;
}

// ---------- Map markers (Leaflet draws plain HTML) ----------
const BIKE_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>';
const KITCHEN_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9 4.5 4h15L21 9"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/></svg>';

const riderIcon = (r, selected) => L.divIcon({
  className: 'lm-icon',
  html: `<span class="lm-rider lm-rider--${r.status}${isFresh(r.location) ? '' : ' is-stale'}${selected ? ' is-selected' : ''}">${BIKE_SVG}</span><span class="lm-label">${esc(firstName(r.name))}</span>`,
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});
const dropIcon = (o, selected) => L.divIcon({
  className: 'lm-icon',
  html: `<span class="lm-drop lm-drop--${dropTone(o)}${selected ? ' is-selected' : ''}"><b>${esc(shortNo(o.orderNo))}</b></span>`,
  iconSize: [34, 34],
  iconAnchor: [17, 41],
});
const kitchenIcon = L.divIcon({ className: 'lm-icon', html: `<span class="lm-kitchen">${KITCHEN_SVG}</span>`, iconSize: [36, 36], iconAnchor: [18, 18] });

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
  const map = useRef(null);
  const layer = useRef(null);
  const select = useRef(onSelect);
  select.current = onSelect;
  const latest = useRef({ kitchen, riders, orders });
  latest.current = { kitchen, riders, orders };

  useEffect(() => {
    const m = L.map(box.current, { zoomControl: true }).setView(ll(kitchen || GURUGRAM), 13);
    L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(box.current);
    return () => { resize.disconnect(); m.remove(); map.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Redrawn on every refresh; there are only a few dozen markers.
  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    const css = getComputedStyle(document.documentElement);
    const color = name => css.getPropertyValue(name).trim();
    const ridersById = new Map(riders.map(r => [r._id, r]));
    const isSel = (kind, id) => selected?.kind === kind && selected.id === id;

    if (kitchen) {
      L.marker(ll(kitchen), { icon: kitchenIcon, keyboard: false, zIndexOffset: -100 })
        .bindTooltip(esc(kitchen.name), { direction: 'top', offset: [0, -18] }).addTo(g);
    }
    if (trail?.length > 1) L.polyline(trail, { color: color('--info'), weight: 4, opacity: 0.75 }).addTo(g);

    for (const o of orders) {
      const sel = isSel('order', o._id);
      const pos = o.status === 'out_for_delivery' ? riderPosition(o, ridersById) : null;
      if (pos && hasPoint(o.drop)) {
        L.polyline([ll(pos), ll(o.drop)], { color: color('--brand'), weight: sel ? 4 : 3, opacity: sel ? 0.9 : 0.55, dashArray: '6 8' }).addTo(g);
      }
      if (hasPoint(o.drop)) {
        L.marker(ll(o.drop), { icon: dropIcon(o, sel), zIndexOffset: sel ? 900 : 0, title: `${o.orderNo} · ${riderLine(o)}` })
          .on('click', () => select.current('order', o._id)).addTo(g);
      }
    }

    for (const r of riders) {
      if (r.status === 'offline' || !hasPoint(r.location)) continue;
      const sel = isSel('rider', r._id) || (selected?.kind === 'order' && orders.find(o => o._id === selected.id)?.agentId === r._id);
      if (sel && r.location.accuracy > 15 && r.location.accuracy < 1000) {
        L.circle(ll(r.location), { radius: r.location.accuracy, color: color('--info'), weight: 1, fillOpacity: 0.08 }).addTo(g);
      }
      L.marker(ll(r.location), { icon: riderIcon(r, sel), zIndexOffset: sel ? 1000 : 500, title: `${r.name} · ${AGENT_STATUS[r.status]?.label || r.status}` })
        .on('click', () => select.current('rider', r._id)).addTo(g);
    }
  }, [kitchen, riders, orders, selected, trail]);

  // Everything on the map: the kitchen, online riders and the drop points.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const { kitchen: k, riders: rs, orders: os } = latest.current;
    const points = [k, ...rs.filter(r => r.status !== 'offline').map(r => r.location), ...os.map(o => o.drop)].filter(hasPoint);
    if (points.length === 1) m.setView(ll(points[0]), CLOSE_ZOOM - 1);
    else if (points.length > 1) m.fitBounds(points.map(ll), { padding: [48, 48], maxZoom: CLOSE_ZOOM });
  }, [fitKey]);

  useEffect(() => {
    if (focus && map.current) map.current.setView(ll(focus), Math.max(map.current.getZoom(), CLOSE_ZOOM - 1), { animate: true });
  }, [focus?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={box} className="live-map" role="img" aria-label="Map of riders and live orders" />;
}

function RiderDetails({ rider, orders, onPick }) {
  const st = AGENT_STATUS[rider.status] || AGENT_STATUS.offline;
  const mine = orders.filter(o => o.agentId === rider._id);
  const at = rider.location?.at;
  return (
    <div className="lm-card">
      <div className="lm-card__head">
        <strong>{rider.name}</strong>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <p className="muted">{rider.vehicleType}{rider.vehicleNumber ? ` · ${rider.vehicleNumber}` : ''} · <a className="link-inline" href={telHref(rider.phone)}>{rider.phone}</a></p>
      <p>
        {!at ? (rider.status === 'offline' ? 'Offline, no location shared yet.' : 'Online, waiting for the phone’s location.')
          : rider.status === 'offline' ? `Offline · last seen ${timeAgo(at)}`
          : isFresh(rider.location) ? `Location updated ${timeAgo(at)}${rider.location.accuracy ? ` · within ${Math.round(rider.location.accuracy)} m` : ''}`
          : `No update since ${timeAgo(at)}: the app may be closed or the phone offline.`}
      </p>
      {rider.status !== 'offline' && rider.onlineAt && <p className="muted">Online since {dateTime(rider.onlineAt)}{rider.kmToday ? ` · ${rider.kmToday} km today` : ''}</p>}
      {mine.length > 0 && (
        <ul className="lm-card__orders">
          {mine.map(o => (
            <li key={o._id}>
              <button type="button" className="link-btn" onClick={() => onPick('order', o._id)}>{o.orderNo}</button>
              <span className="muted"> · {ORDER_STATUS[o.status]?.label}{o.address ? ` · ${o.address.area || o.address.line2}` : ''}</span>
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

function OrderDetails({ order, rider, onPick }) {
  const st = ORDER_STATUS[order.status];
  return (
    <div className="lm-card">
      <div className="lm-card__head">
        <strong className="mono">{order.orderNo}</strong>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <p>{order.customerName} · <a className="link-inline" href={telHref(order.customerPhone)}>{order.customerPhone}</a></p>
      <p className="muted">{order.address ? addressShort(order.address) : 'No address on this order'}{order.address?.landmark ? ` · near ${order.address.landmark}` : ''}</p>
      <p>
        {order.agentId && rider
          ? <><button type="button" className="link-btn" onClick={() => onPick('rider', rider._id)}>{riderLine(order)}</button></>
          : riderLine(order)}
      </p>
      <p className="muted">
        Placed {timeAgo(order.placedAt)}
        {order.dispatchedAt ? ` · picked up ${timeAgo(order.dispatchedAt)}` : ''}
        {order.status === 'out_for_delivery' && order.riderLocation?.at ? ` · rider seen ${timeAgo(order.riderLocation.at)}` : ''}
      </p>
      {!hasPoint(order.drop) && <p className="muted">The customer typed this address without a map pin, so it isn’t on the map.</p>}
      {hasPoint(order.drop) && (
        <a className="btn btn--ghost btn--sm" href={mapsUrl(order.drop)} target="_blank" rel="noreferrer"><MapPin size={14} /> Customer’s pin in Google Maps</a>
      )}
    </div>
  );
}

export default function LiveMap() {
  usePageTitle('Live map');
  const [params, setParams] = useSearchParams();
  const startOrder = params.get('order');
  const { data, loading, refreshing, error, reload } = useApi(() => api.get());
  const [tab, setTab] = useState(startOrder ? 'orders' : 'riders');
  const [selected, setSelected] = useState(startOrder ? { kind: 'order', id: startOrder } : null);
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
  const where = sel => {
    if (sel?.kind === 'rider') return ridersById.get(sel.id)?.location;
    const o = orders.find(x => x._id === sel?.id);
    if (!o) return null;
    return (o.status === 'out_for_delivery' && riderPosition(o, ridersById)) || o.drop;
  };

  const pick = (kind, id, move = true) => {
    const next = { kind, id };
    setSelected(next);
    setTab(kind === 'rider' ? 'riders' : 'orders');
    setParams(kind === 'order' ? { order: id } : {}, { replace: true });
    const p = where(next);
    if (move && hasPoint(p)) setFocus({ lat: p.lat, lng: p.lng, key: Date.now() });
  };

  // Opened with ?order=…: move to it once the data is in.
  const focusedStart = useRef(false);
  useEffect(() => {
    if (!data || focusedStart.current || !selected) return;
    focusedStart.current = true;
    const p = where(selected);
    if (hasPoint(p)) setFocus({ lat: p.lat, lng: p.lng, key: Date.now() });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // The route driven so far, for a picked order that's out for delivery (refreshed with the map).
  const selOrder = selected?.kind === 'order' ? orders.find(o => o._id === selected.id) : null;
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
  const sortedOrders = [...orders].sort((a, b) => Number(Boolean(a.agentId)) - Number(Boolean(b.agentId)) || b.placedAt.localeCompare(a.placedAt));
  const count = { online: riders.filter(r => r.status === 'online').length, busy: riders.filter(r => r.status === 'busy').length };
  const waiting = orders.filter(o => !o.agentId).length;
  const out = orders.filter(o => o.status === 'out_for_delivery').length;
  const unpinned = orders.filter(o => !hasPoint(o.drop)).length;
  const onMap = riders.some(r => r.status !== 'offline' && hasPoint(r.location)) || orders.some(o => hasPoint(o.drop));
  const selRider = selected?.kind === 'rider' ? ridersById.get(selected.id) : null;

  return (
    <>
      <PageHeader eyebrow="Delivery" title="Live map" subtitle="Where your riders are right now, from the delivery app, and where each live order is going. Updates every 10 seconds.">
        <button className="btn btn--outline" onClick={reload} disabled={refreshing}><Refresh size={18} />{refreshing ? 'Refreshing…' : 'Refresh'}</button>
      </PageHeader>

      <div className="stats">
        <StatTile icon={<Bike size={18} />} label="Riders free / online" value={num(count.online)} hint={`${riders.filter(r => r.status === 'online' && !r.orderIds.length).length} with no order`} />
        <StatTile icon={<Activity size={18} />} label="On a delivery" value={num(count.busy)} hint={`${out} order${out === 1 ? '' : 's'} on the way`} />
        <StatTile icon={<Clock size={18} />} label="Waiting for a rider" value={num(waiting)} hint="Live orders with no rider" />
        <StatTile icon={<Bag size={18} />} label="Live orders" value={num(orders.length)} hint="Placed in the last 24 hours" />
      </div>

      {error && <p className="notice notice--info live__stale" role="status">Couldn’t refresh ({error.message}). Showing the map from {timeAgo(data.at)}.</p>}

      <div className="live">
        <section className="card live__map-card">
          <FleetMap kitchen={data.kitchen} riders={riders} orders={orders} selected={selected} trail={trail}
            fitKey={fitKey} focus={focus} onSelect={(kind, id) => pick(kind, id, false)} />
          <div className="live__tools">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFitKey(k => k + 1)}>Show all</button>
          </div>
          {!onMap && <p className="live__empty">No riders online and no live orders with a map pin right now.</p>}
          <div className="live__legend">
            <span><i className="lm-dot lm-dot--online" /> Rider online</span>
            <span><i className="lm-dot lm-dot--busy" /> On a delivery</span>
            <span><i className="lm-swatch lm-swatch--waiting" /> Order waiting for a rider</span>
            <span><i className="lm-swatch lm-swatch--assigned" /> Rider assigned</span>
            <span><i className="lm-swatch lm-swatch--out" /> Out for delivery</span>
            {!data.kitchen && <span className="muted">Set KITCHEN_LAT and KITCHEN_LNG in backend/.env to show the kitchen.</span>}
            {unpinned > 0 && <span className="muted">{unpinned} order{unpinned > 1 ? 's have' : ' has'} no map pin, so {unpinned > 1 ? 'they’re' : 'it’s'} only in the list.</span>}
          </div>
        </section>

        <aside className="live__panel">
          {selRider && <RiderDetails rider={selRider} orders={orders} onPick={pick} />}
          {selOrder && <OrderDetails order={selOrder} rider={ridersById.get(selOrder.agentId)} onPick={pick} />}

          <section className="card lm-lists">
            <Segmented label="Show" value={tab} onChange={setTab} options={[
              { value: 'riders', label: 'Riders', count: riders.length },
              { value: 'orders', label: 'Orders', count: orders.length },
            ]} />
            {tab === 'riders' ? (
              sortedRiders.length === 0 ? <p className="muted lm-none">No active riders. Add them on the Delivery agents page.</p> : (
                <ul className="lm-list">
                  {sortedRiders.map(r => (
                    <li key={r._id}>
                      <button type="button" className={`lm-row${selected?.kind === 'rider' && selected.id === r._id ? ' is-active' : ''}`} onClick={() => pick('rider', r._id)}>
                        <i className={`lm-dot lm-dot--${r.status}${r.status !== 'offline' && !isFresh(r.location) ? ' is-stale' : ''}`} />
                        <span className="lm-row__main"><b>{r.name}</b><span className="muted">{riderSub(r)}</span></span>
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
                      <button type="button" className={`lm-row${selected?.kind === 'order' && selected.id === o._id ? ' is-active' : ''}`} onClick={() => pick('order', o._id)}>
                        <i className={`lm-swatch lm-swatch--${dropTone(o)}`} />
                        <span className="lm-row__main">
                          <b className="mono">{o.orderNo}</b>
                          <span className="muted">{riderLine(o)}{o.address ? ` · ${o.address.area || o.address.line2}` : ''}</span>
                        </span>
                        <Badge tone={ORDER_STATUS[o.status]?.tone}>{ORDER_STATUS[o.status]?.label}</Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
