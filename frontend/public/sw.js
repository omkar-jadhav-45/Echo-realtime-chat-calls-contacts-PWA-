// SPDX-License-Identifier: Apache-2.0
// Copyright 2025 Echo contributors
/*
  Echo Service Worker
  - precache app shell built by Vite (injected at runtime via cache-first for navigations)
  - runtime cache for same-origin GET requests
  - offline fallback for navigations
*/
const CACHE_NAME = 'echo-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([
      OFFLINE_URL,
      '/icons/icon.svg',
      '/manifest.webmanifest'
    ])).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle same-origin GET
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) {
    return;
  }

  // For navigations, try network first, fallback to cache, then offline page
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const netRes = await fetch(req);
        // Optionally, update cache
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, netRes.clone());
        return netRes;
      } catch (err) {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(req);
        return cached || cache.match(OFFLINE_URL);
      }
    })());
    return;
  }

  // For other GET requests: cache-first, then network
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const netRes = await fetch(req);
      // Put a copy in cache if ok
      if (netRes && netRes.status === 200 && netRes.type === 'basic') {
        cache.put(req, netRes.clone());
      }
      return netRes;
    } catch (err) {
      return cached; // may be undefined
    }
  })());
});
