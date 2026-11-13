// The bell in the top bar. It rings when a new order comes in (from the website or the app), on every page of the
// panel, and keeps a badge with the orders waiting to be accepted; clicking it lists them and opens one on the Orders
// page. New orders arrive over the live socket (lib/live.js) the moment they're placed; the list is also re-read on
// a timer in case the socket is down. While orders wait, it rings again every 30 seconds (can be turned off), and a
// desktop notification can be turned on for when the panel is in a background tab.
// In the Android app (mobile/, `window.BiteVoAdmin`) the page sleeps while the app is closed, so the app rings and
// shows new orders in the notification bar itself: the bell hands it these settings, and doesn't ring again for an
// order the app already rang for.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { orders as api } from '../api/index.js';
import { useAuth } from '../auth.jsx';
import { useLive, useDebounced } from '../lib/live.js';
import { money, timeAgo } from '../lib/format.js';
import { ringBell, unlockSound, soundReady, loadPrefs, savePrefs } from '../lib/orderAlerts.js';
import { useToast } from './Toast.jsx';
import { Switch, Segmented } from './ui.jsx';
import { Bell, BellOff } from './Icons.jsx';

const CHECK_MS = { up: 60000, down: 15000 }; // re-read the list: while the live socket is up / down
const REMIND_MS = 30000;
const SHOWN = 8;

const firstName = name => String(name || '').trim().split(/\s+/)[0] || 'Customer';
const itemCount = o => (o.items || []).reduce((s, it) => s + (it.qty || 1), 0);
const app = () => (typeof window !== 'undefined' ? window.BiteVoAdmin : undefined); // the Android app, if in it
const canNotify = () => typeof window !== 'undefined' && !app() && 'Notification' in window;
// Whether the app already rang for this order while it was closed.
const appRang = id => { try { return Boolean(app()?.announced?.(id)); } catch { return false; } };

export default function OrderBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [waiting, setWaiting] = useState([]);
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [ready, setReady] = useState(soundReady);
  const box = useRef(null);
  const known = useRef(null); // ids of today's orders already seen; null until the first load (which never rings)
  const latest = useRef({});
  latest.current = { prefs, toast, navigate };

  const setPref = changes => setPrefs(p => {
    const next = { ...p, ...changes };
    savePrefs(next);
    return next;
  });

  const openOrder = id => {
    setOpen(false);
    navigate(`/orders?order=${id}`);
  };

  // A new order: ring, say so, and if the tab is in the background, a desktop notification and the tab title.
  const announce = all => {
    const fresh = all.filter(o => !appRang(o._id));
    if (!fresh.length) return; // the app rang for them and showed them while it was closed
    const { prefs: p, toast: say, navigate: go } = latest.current;
    const first = fresh[0];
    const title = fresh.length > 1 ? `${fresh.length} new orders` : `New order ${first.orderNo}`;
    const detail = fresh.length > 1 ? fresh.map(o => o.orderNo).join(', ') : `${firstName(first.customerName)} · ${itemCount(first)} item${itemCount(first) > 1 ? 's' : ''} · ${money(first.total)}`;
    say(`${title} · ${detail}`);
    if (p.sound) ringBell('new', p.style);
    if (document.hidden) {
      if (!document.title.startsWith('🔔')) document.title = `🔔 ${title} · ${document.title}`;
      if (p.desktop && canNotify() && Notification.permission === 'granted') {
        try {
          const n = new Notification(title, { body: detail, icon: '/assets/icon-192.png', tag: 'bitevo-new-order' });
          n.onclick = () => { window.focus(); go(`/orders?order=${first._id}`); n.close(); };
        } catch {
          // some browsers only allow notifications from a service worker; the bell and the title still work
        }
      }
    }
  };

  const load = async () => {
    let list;
    try {
      list = await api.list({ days: 1 });
    } catch {
      return; // offline or signed out: try again next time
    }
    const placed = list.filter(o => o.status === 'placed').sort((a, b) => b.placedAt.localeCompare(a.placedAt));
    if (known.current) {
      const fresh = placed.filter(o => !known.current.has(o._id));
      if (fresh.length) announce(fresh);
    }
    known.current = new Set(list.map(o => o._id));
    setWaiting(placed);
  };
  const loadRef = useRef(load);
  loadRef.current = load;

  // At once when an order is placed or changes (the socket), and on a timer as a safety net.
  const reloadSoon = useDebounced(() => loadRef.current(), 500);
  const live = useLive(m => { if (m.type === 'order' || m.type === 'resync') reloadSoon(); }, user?._id);
  useEffect(() => { loadRef.current(); }, []);
  useEffect(() => {
    const timer = setInterval(() => loadRef.current(), live ? CHECK_MS.up : CHECK_MS.down);
    return () => clearInterval(timer);
  }, [live]);

  // While orders wait to be accepted, ring again every 30 s.
  const anyWaiting = waiting.length > 0;
  useEffect(() => {
    if (!anyWaiting || !prefs.sound || !prefs.remind) return undefined;
    const timer = setInterval(() => ringBell('remind', prefs.style), REMIND_MS);
    return () => clearInterval(timer);
  }, [anyWaiting, prefs.sound, prefs.remind, prefs.style]);

  // In the app: it rings with these settings while it's closed (and starts watching: someone is signed in). The app
  // also lets the page play sound without a tap first.
  useEffect(() => {
    if (!app()) return;
    try {
      app().bell(JSON.stringify({ sound: prefs.sound, style: prefs.style, remind: prefs.remind }));
    } catch {
      // an older app without the bell: it just won't ring while closed
    }
    unlockSound();
    setReady(true);
  }, [prefs.sound, prefs.style, prefs.remind]);

  // Browsers allow sound only after a click or key press on the page: the first one unlocks the bell.
  useEffect(() => {
    if (ready) return undefined;
    const unlock = () => { unlockSound(); setReady(true); };
    document.addEventListener('pointerdown', unlock, { once: true, capture: true });
    document.addEventListener('keydown', unlock, { once: true, capture: true });
    return () => {
      document.removeEventListener('pointerdown', unlock, { capture: true });
      document.removeEventListener('keydown', unlock, { capture: true });
    };
  }, [ready]);

  // Back on the tab: the 🔔 comes off its title.
  useEffect(() => {
    const restore = () => { if (!document.hidden && document.title.startsWith('🔔')) document.title = document.title.replace(/^🔔 .*? · /, ''); };
    document.addEventListener('visibilitychange', restore);
    return () => document.removeEventListener('visibilitychange', restore);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const close = e => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const toggleDesktop = async on => {
    if (!on) return setPref({ desktop: false });
    if (Notification.permission === 'denied') return toast('Notifications are blocked for this site. Allow them in the browser’s site settings.', 'critical');
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission().catch(() => 'denied');
    setPref({ desktop: permission === 'granted' });
    if (permission !== 'granted') toast('Notifications weren’t allowed, so the bell will only ring.', 'critical');
  };

  const count = waiting.length;
  const label = count ? `New orders: ${count} waiting to be accepted` : 'New orders: none waiting';

  return (
    <div className="bell" ref={box}>
      <button type="button" className={`icon-btn bell__btn${count ? ' is-ringing' : ''}`} onClick={() => setOpen(o => !o)}
        aria-label={label} title={label} aria-expanded={open} aria-haspopup="dialog">
        {prefs.sound ? <Bell /> : <BellOff />}
        {count > 0 && <span className="bell__count" aria-hidden="true">{count > 9 ? '9+' : count}</span>}
      </button>
      {open && (
        <div className="bell__pop" role="dialog" aria-label="New orders">
          <div className="bell__head">
            <strong>New orders</strong>
            <span className="muted">{count ? `${count} waiting to be accepted` : 'None waiting'}</span>
          </div>
          {count ? (
            <ul className="bell__list">
              {waiting.slice(0, SHOWN).map(o => (
                <li key={o._id}>
                  <button type="button" onClick={() => openOrder(o._id)}>
                    <span className="bell__row">
                      <b className="mono">{o.orderNo}</b>
                      <span className="muted">{firstName(o.customerName)} · {itemCount(o)} item{itemCount(o) > 1 ? 's' : ''} · {money(o.total)}</span>
                    </span>
                    <span className="bell__ago">{timeAgo(o.placedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="bell__empty">No new orders right now. The bell rings as soon as one comes in.</p>
          )}
          {count > SHOWN && <button type="button" className="bell__all" onClick={() => { setOpen(false); navigate('/orders'); }}>See all {count} on the Orders page</button>}
          <div className="bell__prefs">
            <Switch checked={prefs.sound} onChange={v => setPref({ sound: v })} label="Ring for new orders" hideLabel={false} />
            {prefs.sound && (
              <Segmented label="Sound" value={prefs.style} onChange={style => { setPref({ style }); unlockSound(); setReady(true); ringBell('test', style); }}
                options={[{ value: 'loud', label: 'Loud ring' }, { value: 'soft', label: 'Soft bell' }]} />
            )}
            <Switch checked={prefs.sound && prefs.remind} onChange={v => setPref({ remind: v })} label="Ring again every 30 s until accepted" hideLabel={false} disabled={!prefs.sound} />
            {canNotify() && (
              <Switch checked={prefs.desktop && Notification.permission === 'granted'} onChange={toggleDesktop} label="Desktop notification when this tab is in the background" hideLabel={false} />
            )}
            {app() && <p className="bell__note">With the app closed or the screen off, new orders still ring and show in the phone’s notification bar.</p>}
          </div>
          <div className="bell__foot">
            {prefs.sound && !ready && <span className="bell__hint">Click anywhere on the page once so the browser lets the bell ring.</span>}
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => { unlockSound(); setReady(true); ringBell('test', prefs.style); }}>Test bell</button>
          </div>
        </div>
      )}
    </div>
  );
}
