/**
 * Service worker for ludovic.toinel.com.
 *
 * Two jobs:
 *  1. Web Push receiver — show a notification when a push arrives from msg.php
 *     (payload JSON: { title, body }), even with no tab open. Registered both
 *     globally (Layout.astro) and by the `msg --subscribe` flow (root/bin/msg.md).
 *  2. Cache the externalised shell data (/shell-fs.json, /shell-commands.json)
 *     so it is fetched once and shared across page navigations.
 */

// Bump this on deploy when the shell data changes to evict the old cache.
const CACHE = 'ltsh-v2';
const SHELL_DATA = ['/shell-fs.json', '/shell-commands.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL_DATA))
      .catch(() => {}) // a failed precache must not block install
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Intercept ONLY the shell-data files; everything else passes straight through.
// Stale-while-revalidate: serve the cached copy instantly, refresh in background.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !SHELL_DATA.includes(url.pathname)) return;
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(event.request).then((cached) => {
        const fresh = fetch(event.request)
          .then((res) => {
            if (res.ok) cache.put(event.request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || fresh;
      }),
    ),
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'ludovic.toinel.com';
  const options = {
    body: data.body || '',
    icon: '/favicon-192.png',
    badge: '/favicon-192.png',
    tag: 'ltsh-msg',
    timestamp: Date.now(),
    data,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('/');
    }),
  );
});
