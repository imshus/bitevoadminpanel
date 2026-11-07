// Rider applications from the customer website's "Become a delivery partner" page (bitevomainwebsite
// backend/src/routes/riderApplications.js saves them in `riderApplications`). The team calls the applicant,
// then approves the application, which adds them as a delivery agent with the ID check still to do, or turns
// it down. Status: new → contacted → approved or rejected.
import { Router } from 'express';
import { store } from '../db/index.js';
import { conflict, notFound, nowIso } from '../lib/http.js';
import { getSettings } from '../settings.js';

export const router = Router();

const OPEN = ['new', 'contacted'];
const digits = phone => String(phone || '').replace(/\D/g, '').slice(-10);

// The newest first, with the agent an approved application became.
router.get('/', async (req, res) => {
  res.json(await store.find('riderApplications', {}, { sort: { createdAt: -1 }, limit: 500 }));
});

async function openApplication(id) {
  const a = await store.findById('riderApplications', id);
  if (!a) throw notFound('This application no longer exists.');
  if (!OPEN.includes(a.status)) throw conflict(`This application was already ${a.status === 'approved' ? 'approved' : 'turned down'}.`);
  return a;
}

// Called the applicant; the decision comes later.
router.post('/:id/contacted', async (req, res) => {
  const a = await openApplication(req.params.id);
  res.json(await store.update('riderApplications', a._id, { status: 'contacted', contactedAt: nowIso(), contactedBy: req.admin.name }));
});

// Adds the applicant as a delivery agent: account active, ID check pending, offline until they sign in to the
// rider app with this number. Verify their ID on the Delivery agents page before they can take orders.
router.post('/:id/approve', async (req, res) => {
  const a = await openApplication(req.params.id);
  const agents = await store.find('agents', {}, { projection: { phone: 1 } });
  if (agents.some(x => digits(x.phone) === digits(a.phone))) throw conflict('An agent already uses this mobile number.');
  const { vehicleTypes } = await getSettings();
  const now = nowIso();
  const agent = await store.insert('agents', {
    name: a.name, phone: a.phone, email: a.email || '',
    vehicleType: vehicleTypes.includes(a.vehicleType) ? a.vehicleType : vehicleTypes[0],
    vehicleNumber: a.vehicleNumber || '',
    kycStatus: 'pending', isActive: true, status: 'offline',
    fromApplication: a._id, createdAt: now, updatedAt: now,
  });
  const application = await store.update('riderApplications', a._id, { status: 'approved', agentId: agent._id, decidedAt: now, decidedBy: req.admin.name });
  res.json({ application, agent });
});

router.post('/:id/reject', async (req, res) => {
  const a = await openApplication(req.params.id);
  const reason = String(req.body?.reason || '').trim().slice(0, 200);
  res.json(await store.update('riderApplications', a._id, { status: 'rejected', rejectReason: reason, decidedAt: nowIso(), decidedBy: req.admin.name }));
});
