import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The public website runs on 2000; the admin panel sits next to it on 2001.
// API calls and uploaded photos are forwarded to the backend: the local one on 4000, or the one in
// API_PROXY_TARGET (in .env), e.g. API_PROXY_TARGET=https://adminapi.bitevo.in to use the live API.
// Besides localhost, Vite only answers on these addresses (so no other domain can be pointed at it).
const ALLOWED_HOSTS = ['admin.bitevo.in'];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), '');
  const target = (env.API_PROXY_TARGET || 'http://localhost:4000').replace(/\/+$/, '');
  // changeOrigin: an API behind nginx only answers requests that carry its own host name. `ws` passes on the live
  // updates (/api/ws, a WebSocket).
  const proxy = { '/api': { target, changeOrigin: true, ws: true }, '/uploads': { target, changeOrigin: true } };
  return {
    plugins: [react()],
    server: { port: 2001, strictPort: true, allowedHosts: ALLOWED_HOSTS, proxy },
    preview: { port: 2001, strictPort: true, allowedHosts: ALLOWED_HOSTS, proxy },
  };
});
