// Live updates for the admin panel: a WebSocket at /api/live. A signed-in admin's pages open it and hear
//   { type: 'order', id, status } when any order changes: placed on the website, accepted, assigned or cancelled
//     here, accepted, picked up or delivered in the rider app;
//   { type: 'agent', id, status } when a rider goes online or offline, or starts or finishes a delivery;
// and reload what they show through the API as before, so the socket carries no order or customer details.
// The changes come from MongoDB change streams on `orders` and `agents`, so writes by the website's and the rider
// app's APIs count as much as this API's own. Riders' positions alone (every few seconds) aren't sent. Without
// MongoDB (the JSON demo store) there's no stream: pages refresh on their timers, as they also do whenever the
// socket is down. Behind nginx, /api/live needs the WebSocket upgrade passed on (see README).
import { WebSocketServer } from 'ws';
import { store } from './db/index.js';
import { config } from './config.js';
import { findSession } from './auth.js';

const PATH = '/api/live';
const PING_MS = 25000; // keeps proxies from closing a quiet connection, and finds dead ones
const COALESCE_MS = 1000;
const RESTART_MS = 5000;
// Writes that don't change what the panel shows: the rider app's position updates.
const QUIET_FIELDS = new Set(['riderLocation', 'location', 'odometer', 'updatedAt', 'onlineVia', 'lastSeenAt']);

// "a=1; b=2" → { a: '1', b: '2' }
function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    const key = i > 0 ? part.slice(0, i).trim() : '';
    if (!key || key in out) continue;
    const value = part.slice(i + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

// The panel's own address (CLIENT_ORIGIN), and any localhost page while developing (no secure cookies).
const devOrigin = origin => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
const originAllowed = origin => !origin || config.clientOrigins.includes(origin) || (!config.cookie.secure && devOrigin(origin));

function refuse(socket, status, text) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

// Only position updates: nothing for the panel.
const quiet = change => change.operationType === 'update'
  && Object.keys(change.updateDescription?.updatedFields || {}).every(f => QUIET_FIELDS.has(f.split('.')[0]))
  && !(change.updateDescription?.removedFields || []).length;

export function startLive(server) {
  if (typeof store.watch !== 'function') {
    console.log('Live updates: off without MongoDB (pages refresh on a timer).');
    return null;
  }
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const sockets = new Set();

  server.on('upgrade', async (req, socket, head) => {
    let path = '';
    try {
      path = new URL(req.url, 'http://localhost').pathname;
    } catch {
      // not a URL: refused below
    }
    if (path !== PATH) return refuse(socket, 404, 'Not Found');
    if (!originAllowed(req.headers.origin)) return refuse(socket, 403, 'Forbidden');
    const found = await findSession({ cookies: parseCookies(req.headers.cookie) }).catch(() => null);
    if (!found) return refuse(socket, 401, 'Unauthorized');
    wss.handleUpgrade(req, socket, head, ws => {
      sockets.add(ws);
      ws.alive = true;
      ws.on('pong', () => { ws.alive = true; });
      ws.on('error', () => ws.terminate());
      ws.on('close', () => sockets.delete(ws));
      ws.send(JSON.stringify({ type: 'hello' }));
    });
  });

  const ping = setInterval(() => {
    for (const ws of sockets) {
      if (!ws.alive) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
  }, PING_MS);
  ping.unref();

  // The latest state of each changed order or rider, sent once per COALESCE_MS.
  const pending = new Map(); // `${type}:${id}` → message
  let flushTimer = null;
  const flush = () => {
    flushTimer = null;
    for (const message of pending.values()) {
      const text = JSON.stringify(message);
      for (const ws of sockets) if (ws.readyState === ws.OPEN) ws.send(text);
    }
    pending.clear();
  };
  const queue = message => {
    if (!sockets.size) return;
    pending.set(`${message.type}:${message.id}`, message);
    flushTimer ??= setTimeout(flush, COALESCE_MS);
  };

  const streams = [];
  const watch = (collection, type) => {
    const stream = store.watch(collection, [{ $match: { operationType: { $in: ['insert', 'update', 'replace', 'delete'] } } }], { fullDocument: 'updateLookup' });
    streams.push(stream);
    stream.on('change', change => {
      if (quiet(change)) return;
      const doc = change.fullDocument;
      const id = String(doc?._id ?? change.documentKey?._id);
      queue({ type, id, status: change.operationType === 'delete' ? 'deleted' : doc?.status ?? null });
    });
    stream.once('error', err => {
      console.error(`Live updates: the ${collection} change stream stopped (${err.message}); retrying in ${RESTART_MS / 1000} s.`);
      streams.splice(streams.indexOf(stream), 1);
      stream.close().catch(() => {});
      setTimeout(() => watch(collection, type), RESTART_MS).unref();
    });
  };
  watch('orders', 'order');
  watch('agents', 'agent');
  console.log(`Live updates: ${PATH} (WebSocket)`);

  return {
    close() {
      clearInterval(ping);
      for (const stream of streams) stream.close().catch(() => {});
      for (const ws of sockets) ws.terminate();
      wss.close();
    },
  };
}
