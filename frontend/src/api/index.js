// The panel's only connection to the BiteVo backend (Node.js API in ../backend).
// In development Vite forwards /api and /uploads to the API (see vite.config.js). When the backend serves
// the built panel, both share one address and VITE_API_URL stays empty; for a separate static host, set it
// to the API's address, e.g. https://api.bitevo.in.
import { shrinkImage } from '../lib/image.js';

const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

// Called when the server says the session has ended (signed out elsewhere, expired, revoked).
let onUnauthorized = () => {};
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

async function request(method, path, body, { raw, contentType, quiet401 } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': raw ? contentType : 'application/json' },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Can’t reach the BiteVo server. Check that the backend is running.');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !quiet401) onUnauthorized();
    throw new ApiError(data?.error || `Request failed (${res.status}).`, res.status);
  }
  return data;
}

const get = (path, opts) => request('GET', path, undefined, opts);
const post = (path, body, opts) => request('POST', path, body ?? {}, opts);

function resource(path) {
  return {
    list: () => get(path),
    create: data => post(path, data),
    update: (id, changes) => request('PATCH', `${path}/${id}`, changes),
    remove: id => request('DELETE', `${path}/${id}`),
  };
}

export const products = resource('/products');
export const coupons = resource('/coupons');
export const agents = resource('/agents');

export const categories = {
  list: () => get('/categories'),
  create: (label, image = '') => post('/categories', { label, image }),
  // moveTo: key of the category that receives this category's products (needed when it has any).
  remove: (id, moveTo) => request('DELETE', `/categories/${id}${moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : ''}`),
};

// Photos are shrunk in the browser (~100 KB), then uploaded. Returns { url }.
export const uploads = {
  async image(file) {
    if (!file?.type?.startsWith('image/')) throw new ApiError('Choose an image file (JPG, PNG or WebP).');
    if (file.size > 10 * 1024 * 1024) throw new ApiError('That photo is over 10 MB. Choose a smaller one.');
    let dataUrl;
    try {
      dataUrl = await shrinkImage(file);
    } catch {
      throw new ApiError('Couldn’t read that photo. Try a JPG or PNG.');
    }
    const blob = await (await fetch(dataUrl)).blob();
    return request('POST', '/uploads', blob, { raw: true, contentType: 'image/jpeg' });
  },
};

export const orders = {
  list: ({ days = 1 } = {}) => get(`/orders?days=${days}`),
  get: id => get(`/orders/${id}`),
  advance: id => post(`/orders/${id}/advance`),
  assign: (id, agentId) => post(`/orders/${id}/assign`, { agentId }),
  cancel: (id, { reason, refundTo }) => post(`/orders/${id}/cancel`, { reason, refundTo }),
};

export const wallets = {
  overview: () => get('/wallets'),
  adjust: ({ customer, amount, note }) => post(`/wallets/${customer.customerId}/adjustments`, { amount, note }),
};

export const customers = {
  search: query => (query.trim() ? get(`/customers?search=${encodeURIComponent(query.trim())}`) : Promise.resolve([])),
};

// Refer & earn: the website records referrals and pays the rewards; the panel can void a pending one.
export const referrals = {
  list: () => get('/referrals'),
  void: (id, reason) => post(`/referrals/${id}/void`, { reason }),
};

export const sessions = {
  list: () => get('/sessions'),
  revoke: id => post(`/sessions/${id}/revoke`),
};

export const loginEvents = {
  list: () => get('/login-events'),
};

export const analytics = {
  get: days => get(`/analytics?days=${days}`),
};

// Lists stored in MongoDB: vehicleTypes, cancelReasons, walletReasons.
export const settings = {
  get: () => get('/settings'),
  update: changes => request('PATCH', '/settings', changes),
};

export const dashboard = {
  summary: () => get('/dashboard'),
};

export const auth = {
  login: (email, password) => post('/auth/login', { email, password }, { quiet401: true }),
  // The signed-in admin, or null.
  async me() {
    try {
      return await get('/auth/me', { quiet401: true });
    } catch (err) {
      if (err.status === 401) return null;
      throw err;
    }
  },
  heartbeat: () => post('/auth/heartbeat'),
  logout: () => post('/auth/logout', undefined, { quiet401: true }),
};

