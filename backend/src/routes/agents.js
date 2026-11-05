import { Router } from 'express';
import { store } from '../db/index.js';
import { agentStats } from '../analytics.js';
import { badRequest, conflict, notFound, pick, nowIso, DAY } from '../lib/http.js';
import { getSettings } from '../settings.js';

export const router = Router();

const FIELDS = ['name', 'phone', 'email', 'vehicleType', 'vehicleNumber', 'kycStatus', 'isActive', 'status'];
const digits = phone => String(phone || '').replace(/\D/g, '').slice(-10);

function normalize(body) {
  const a = pick(body, FIELDS);
  for (const f of ['name', 'phone', 'email', 'vehicleNumber']) if (f in a) a[f] = String(a[f] || '').trim().slice(0, 80);
  if ('vehicleNumber' in a) a.vehicleNumber = a.vehicleNumber.toUpperCase();
  if ('isActive' in a) a.isActive = Boolean(a.isActive);
  return a;
}

async function validate(a, id) {
  if (!a.name) throw badRequest('Name is required.');
  if (digits(a.phone).length !== 10) throw badRequest('Enter a valid 10-digit phone number.');
  if (a.email && !/^\S+@\S+\.\S+$/.test(a.email)) throw badRequest('Enter a valid email, or leave it empty.');
  const { vehicleTypes } = await getSettings();
  if (!vehicleTypes.includes(a.vehicleType)) throw badRequest('Pick a vehicle type.');
  if (!['verified', 'pending', 'rejected'].includes(a.kycStatus)) throw badRequest('Pick an ID check status.');
  if (!['online', 'busy', 'offline'].includes(a.status)) throw badRequest('Unknown agent status.');
  const all = await store.find('agents', {}, { projection: { phone: 1 } });
  if (all.some(x => x._id !== id && digits(x.phone) === digits(a.phone))) throw conflict('Another agent already uses this phone number.');
}

// Signs a user out of every device (when an agent is suspended or removed).
const revokeSessionsOf = userId => store.updateMany('sessions', { userId, revokedAt: null }, { revokedAt: nowIso() });

router.get('/', async (req, res) => {
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const [list, recent] = await Promise.all([
    store.find('agents', {}, { sort: { createdAt: 1 } }),
    store.find('orders', { placedAt: { $gte: since }, status: 'delivered' }),
  ]);
  const stats = new Map(agentStats(recent).map(s => [s.agentId, s]));
  res.json(list.map(a => ({ ...a, stats: stats.get(a._id) || null })));
});

router.post('/', async (req, res) => {
  const doc = { email: '', vehicleNumber: '', kycStatus: 'pending', isActive: true, ...normalize(req.body), status: 'offline' };
  await validate(doc, null);
  const now = nowIso();
  res.status(201).json(await store.insert('agents', { ...doc, createdAt: now, updatedAt: now }));
});

router.patch('/:id', async (req, res) => {
  const current = await store.findById('agents', req.params.id);
  if (!current) throw notFound();
  const changes = normalize(req.body);
  const next = { ...current, ...changes };
  if (!next.isActive) changes.status = 'offline';
  await validate({ ...next, ...changes }, current._id);
  const saved = await store.update('agents', current._id, { ...changes, updatedAt: nowIso() });
  if (!saved.isActive) await revokeSessionsOf(saved._id);
  res.json(saved);
});

router.delete('/:id', async (req, res) => {
  if (!(await store.remove('agents', req.params.id))) throw notFound();
  await revokeSessionsOf(req.params.id);
  res.status(204).end();
});
