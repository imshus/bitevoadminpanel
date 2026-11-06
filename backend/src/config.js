// All backend settings come from environment variables, usually backend/.env (see .env.example).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, '..');
dotenv.config({ path: path.join(backendDir, '.env'), quiet: true });

// Accepts MONGODB_URI, or the MONGO_DB_URL / MONGO_DB_USER / MONGO_DB_PASSWORD trio.
function mongoUri() {
  const raw = (process.env.MONGODB_URI || process.env.MONGO_DB_URL || '').trim();
  if (!raw) return '';
  const user = process.env.MONGO_DB_USER;
  const pass = process.env.MONGO_DB_PASSWORD;
  const hasCredentials = /^mongodb(\+srv)?:\/\/[^/]*@/.test(raw);
  if (hasCredentials || !user || !pass) return raw;
  return raw.replace(/^(mongodb(\+srv)?:\/\/)/, `$1${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`);
}

const list = value => (value || '').split(',').map(s => s.trim()).filter(Boolean);

// The kitchen's position on the Live map: the same KITCHEN_LAT / KITCHEN_LNG as the delivery app. Optional.
function kitchen() {
  const lat = Number(process.env.KITCHEN_LAT);
  const lng = Number(process.env.KITCHEN_LNG);
  if (!process.env.KITCHEN_LAT || !process.env.KITCHEN_LNG || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng, name: process.env.KITCHEN_NAME || 'BiteVo kitchen' };
}

// `--port 4000` on the command line wins over PORT (the dev script pins the API to 4000).
const argPort = Number(process.argv[process.argv.indexOf('--port') + 1] || 0) || 0;

export const config = {
  port: (process.argv.includes('--port') && argPort) || Number(process.env.PORT) || 4000,
  // Network address to listen on. 127.0.0.1 = only this computer; 0.0.0.0 = also phones and other
  // devices on the same Wi-Fi (and anyone else on it, so set a strong admin password first).
  host: process.env.HOST || '127.0.0.1',
  mongoUri: mongoUri(),
  mongoDbName: process.env.MONGO_DB_NAME || 'bitevo',
  // Without MongoDB the API stores data in this JSON file instead (handy for offline work).
  dataFile: process.env.DATA_FILE || path.join(backendDir, 'data', 'db.json'),
  // Uploaded photos go to a public Supabase Storage bucket when SUPABASE_URL and SUPABASE_SECRET_KEY are set,
  // so their links work on every BiteVo site; otherwise they are saved in uploadDir.
  supabase: {
    url: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    key: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    bucket: process.env.SUPABASE_BUCKET || 'bitevo-images',
  },
  uploadDir: process.env.UPLOAD_DIR || path.join(backendDir, 'uploads'),
  // The built admin panel (`npm run build` in frontend/). When it exists, the API serves it too,
  // so the whole panel runs from one address, e.g. http://localhost:4000.
  clientDir: path.resolve(backendDir, process.env.CLIENT_DIR || '../frontend/dist'),
  // Where uploaded photos are served from, e.g. https://api.bitevo.in. Empty = same origin as the panel.
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  // Origins of the admin frontend allowed to call the API with cookies.
  clientOrigins: list(process.env.CLIENT_ORIGIN || 'http://localhost:2001'),
  kitchen: kitchen(),
  // Road routes and arrival times on the Live map (an OSRM server, like the delivery app's). Empty = straight lines.
  routingUrl: (process.env.ROUTING_URL ?? 'https://router.project-osrm.org').trim().replace(/\/+$/, ''),
  // Demo mode seeds an empty database with dummy data, simulates new orders arriving and allows "reset demo data".
  // On by default only with the local JSON file: on MongoDB (the real, shared database) it needs DEMO_MODE=true,
  // so a server that's missing the setting can't fill the live database with fake orders or reset it.
  demoMode: process.env.DEMO_MODE ? process.env.DEMO_MODE === 'true' : !mongoUri(),
  cookie: {
    name: 'bitevo_admin_session',
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: process.env.COOKIE_SAMESITE || 'lax', // use "none" (with COOKIE_SECURE=true) when the panel is on another domain
  },
  sessionDays: Number(process.env.SESSION_DAYS) || 7,
  trustProxy: process.env.TRUST_PROXY === 'true',
};
