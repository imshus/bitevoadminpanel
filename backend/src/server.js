// Starts the BiteVo admin API (and serves the built admin panel, if there is one).
import os from 'node:os';
import { config } from './config.js';
import { connectStore, store } from './db/index.js';
import { createApp } from './app.js';
import { storageLabel } from './lib/storage.js';
import { seedIfEmpty, addDemoCombos } from './demo/seed.js';
import { startSimulator } from './demo/simulator.js';
import { startLive } from './live.js';

try {
  await connectStore();
} catch (err) {
  console.error(`Could not open the database: ${err.message}`);
  process.exit(1);
}
console.log(`Data store: ${store.label}`);
console.log(`Photos: ${storageLabel}`);

let stopSimulator = () => {};
if (config.demoMode) {
  const seeded = await seedIfEmpty();
  if (seeded) console.log(`Empty database, so loaded demo data (${seeded.orders} orders, ${seeded.products} products).`);
  const combos = await addDemoCombos();
  if (combos) console.log(`Added ${combos} demo combos.`);
  stopSimulator = startSimulator();
  console.log('Demo mode: new demo orders will keep arriving. Set DEMO_MODE=false for real use.');
}

// IPv4 addresses of this computer on the local network, for opening the panel on a phone.
function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
    .map(a => a.address);
}

const onlyThisComputer = ['127.0.0.1', 'localhost', '::1'].includes(config.host);
const app = createApp();
const server = app.listen(config.port, config.host, () => {
  console.log(`BiteVo admin API listening on http://localhost:${config.port}`);
  if (app.locals.servesPanel) {
    console.log(`Admin panel: http://localhost:${config.port}`);
    if (onlyThisComputer) console.log('  Only this computer can open it. For phones on the same Wi-Fi, set HOST=0.0.0.0 in backend/.env.');
    else for (const ip of lanAddresses()) console.log(`  on a phone on the same Wi-Fi: http://${ip}:${config.port}`);
  } else {
    console.log('Admin panel not built yet: run "npm run build" in frontend/ and restart (or use "npm run dev" there).');
  }
});

// Order and rider changes pushed to the panel's open pages (WebSocket /api/ws).
const live = startLive(server);

async function shutdown() {
  stopSimulator();
  live?.close();
  server.close();
  await store.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
