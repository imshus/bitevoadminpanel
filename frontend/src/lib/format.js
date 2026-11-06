// Formatting helpers. Prices are in Indian Rupees, numbers use Indian grouping (1,00,000).

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inrCompact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });

export const money = n => inr.format(Math.round(n || 0));
export const moneyCompact = n => (Math.abs(n) < 1000 ? money(n) : inrCompact.format(n));
export const num = n => plain.format(Math.round(n || 0));
export const numCompact = n => (Math.abs(n) < 10000 ? num(n) : compact.format(n));
export const pct = (n, digits = 0) => `${((n || 0) * 100).toFixed(digits)}%`;
export const mins = n => `${Math.round(n || 0)} min`;

export function timeAgo(value, now = Date.now()) {
  if (!value) return '—';
  const s = Math.round((now - new Date(value).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  return dateOnly(value);
}

export const dateTime = v =>
  new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export const dateOnly = v =>
  new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export const dayLabel = v => new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

// Long day name for tooltips and tables; today's figures are still coming in.
export const longDayLabel = v => {
  const d = new Date(v);
  const label = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return d.toDateString() === new Date().toDateString() ? `${label} (today so far)` : label;
};

export const hourLabel = h => {
  const suffix = h < 12 ? 'am' : 'pm';
  const n = h % 12 === 0 ? 12 : h % 12;
  return `${n} ${suffix}`;
};

// <input type="date"> works with local YYYY-MM-DD strings
export function toInputDate(value) {
  if (!value) return '';
  const d = new Date(value);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromInputDate(str, endOfDay = false) {
  if (!str) return null;
  const [y, m, d] = str.split('-').map(Number);
  const date = endOfDay ? new Date(y, m - 1, d, 23, 59, 59) : new Date(y, m - 1, d);
  return date.toISOString();
}

// An order's delivery address (saved on the order by the website) as one line: flat, street/area, landmark, pincode.
export const addressLine = a =>
  !a ? '' : [a.line1, a.line2, a.landmark && `Near ${a.landmark}`, a.pincode].filter(Boolean).join(', ') || a.mapAddress || '';

// The short form for tables: the area first (or the street line when there's no map pin), then flat/house.
export const addressShort = a => (!a ? '' : [a.area || a.line2, a.line1].filter(Boolean).join(' · '));

export const hasPin = a => Number.isFinite(a?.lat) && Number.isFinite(a?.lng);

// Google Maps at the customer's map pin, or a search for the typed address when they didn't pin it.
export const mapsUrl = a =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hasPin(a) ? `${a.lat},${a.lng}` : addressLine(a))}`;

export const initials = name =>
  (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
