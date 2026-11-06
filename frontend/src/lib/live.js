// Live updates from the admin API's WebSocket (/api/ws, backend/src/live.js):
//   { type: 'order', id, status } when any order changes (website, this panel, the rider app);
//   { type: 'agent', id, status } when a rider goes online/offline or starts/finishes a delivery;
//   { type: 'resync' } after the socket was down (something may have changed meanwhile).
// Pages reload what they show at once instead of at their next refresh. One socket for the whole panel, open while
// something listens; it reconnects by itself, and while it's down the pages keep refreshing on their timers.
import { useEffect, useRef, useState } from 'react';

const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const socketUrl = () => `${(BASE || window.location.origin).replace(/^http/, 'ws')}/api/ws`;

const listeners = new Set();
const upListeners = new Set();
let socket = null;
let up = false;
let wasUp = false;
let retries = 0;
let retryTimer = null;

function setUp(value) {
  if (up === value) return;
  up = value;
  upListeners.forEach(l => l(value));
}

function schedule() {
  if (!listeners.size || retryTimer) return;
  const wait = Math.min(30000, 1000 * 2 ** retries++);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    open();
  }, wait);
}

function open() {
  if (socket || !listeners.size || typeof WebSocket === 'undefined') return;
  let ws;
  try {
    ws = new WebSocket(socketUrl());
  } catch {
    schedule();
    return;
  }
  socket = ws;
  ws.onopen = () => {
    retries = 0;
    setUp(true);
    if (wasUp) listeners.forEach(l => l({ type: 'resync' }));
    wasUp = true;
  };
  ws.onmessage = e => {
    let message;
    try {
      message = JSON.parse(e.data);
    } catch {
      return;
    }
    if (message?.type === 'order' || message?.type === 'agent') listeners.forEach(l => l(message));
  };
  ws.onclose = () => {
    if (socket === ws) socket = null;
    setUp(false);
    schedule();
  };
}

function close() {
  clearTimeout(retryTimer);
  retryTimer = null;
  retries = 0;
  wasUp = false;
  const ws = socket;
  socket = null;
  ws?.close();
  setUp(false);
}

// Calls onMessage(message) for each live update while `who` is set (the signed-in admin's id: another admin opens
// a new socket). Returns whether the socket is up, so pages can refresh less often meanwhile.
export function useLive(onMessage, who) {
  const handler = useRef(onMessage);
  handler.current = onMessage;
  const [isUp, setIsUp] = useState(up);
  useEffect(() => {
    if (!who) return undefined;
    const listener = message => handler.current(message);
    listeners.add(listener);
    upListeners.add(setIsUp);
    setIsUp(up);
    open();
    return () => {
      listeners.delete(listener);
      upListeners.delete(setIsUp);
      if (!listeners.size) close();
    };
  }, [who]);
  return isUp;
}

// Calls fn at most once per `ms` (the last call wins), for pages that reload a whole list on each update.
export function useDebounced(fn, ms = 800) {
  const latest = useRef(fn);
  latest.current = fn;
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  return useRef(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => latest.current(), ms);
  }).current;
}
