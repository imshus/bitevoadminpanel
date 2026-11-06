// The Express app: security headers, CORS for the admin frontend, cookie sessions, the /api routes,
// and the built admin panel itself when frontend/dist exists.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import { store } from './db/index.js';
import { requireAdmin, clearSessionCookie } from './auth.js';
import { errorHandler, forbidden } from './lib/http.js';
import { router as authRoutes } from './routes/auth.js';
import { products, categories, uploads } from './routes/products.js';
import { router as couponRoutes } from './routes/coupons.js';
import { router as agentRoutes } from './routes/agents.js';
import { router as orderRoutes } from './routes/orders.js';
import { router as liveRoutes } from './routes/live.js';
import { wallets, customers } from './routes/wallets.js';
import { router as referralRoutes } from './routes/referrals.js';
import { sessions, loginEvents } from './routes/activity.js';
import { analytics, dashboard } from './routes/reports.js';
import { resetDemoData } from './demo/seed.js';
import { router as settingsRoutes } from './settings.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  // gzip: a month of orders is ~1 MB of JSON but ~80 KB compressed.
  app.use(compression());

  app.use(helmet({
    // Photos are shown by the frontend, which may live on another domain.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      directives: {
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
        // Product photos can be links to other sites; previews use data: and blob: URLs.
        'img-src': ["'self'", 'data:', 'blob:', 'https:', 'http:'],
        // Uploads shrink a photo to a data: URL and fetch() it back into a file.
        'connect-src': ["'self'", 'data:'],
        // Only on HTTPS; over plain http (localhost, the local network) it would break every request.
        'upgrade-insecure-requests': config.cookie.secure ? [] : null,
      },
    },
  }));
  app.use(cors({ origin: config.clientOrigins, credentials: true }));
  app.use(cookieParser());
  app.use('/uploads', express.static(config.uploadDir, { maxAge: '30d', immutable: true }));
  app.use('/uploads', (req, res) => res.status(404).end());
  app.use('/api', express.json({ limit: '200kb' }));

  app.get('/api/health', (req, res) => res.json({ ok: true, store: store.kind, demoMode: config.demoMode }));
  app.use('/api/auth', authRoutes);

  // Everything below needs a signed-in admin.
  app.use('/api', requireAdmin);
  app.use('/api/products', products);
  app.use('/api/categories', categories);
  app.use('/api/uploads', uploads);
  app.use('/api/coupons', couponRoutes);
  app.use('/api/agents', agentRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/live', liveRoutes);
  app.use('/api/wallets', wallets);
  app.use('/api/customers', customers);
  app.use('/api/referrals', referralRoutes);
  app.use('/api/sessions', sessions);
  app.use('/api/login-events', loginEvents);
  app.use('/api/analytics', analytics);
  app.use('/api/dashboard', dashboard);
  app.use('/api/settings', settingsRoutes);

  // Demo only: wipe the admin panel's collections and load fresh demo data.
  app.post('/api/demo/reset', async (req, res) => {
    if (!config.demoMode) throw forbidden('Demo data can only be reset in demo mode.');
    await resetDemoData();
    clearSessionCookie(res);
    res.status(204).end();
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  const panelIndex = path.join(config.clientDir, 'index.html');
  app.locals.servesPanel = fs.existsSync(panelIndex);
  if (app.locals.servesPanel) {
    app.use(express.static(config.clientDir, {
      index: false,
      // Built JS/CSS files have a content hash in their name, so they never change.
      setHeaders: (res, file) => {
        if (/[\\/]assets[\\/][^\\/]+-[\w-]{8}\.(js|css)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }));
    // Every other address (/, /orders, /products…) loads the panel, which then shows that page.
    app.get('/{*page}', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(panelIndex);
    });
  }

  app.use(errorHandler);
  return app;
}
