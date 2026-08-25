const CACHE_NAME = "night-repair-v11-safety-attribution";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=20260825-2",
  "./app.js?v=20260825-2",
  "./supplements.json?v=20260825-2",
  "./manifest.webmanifest?v=20260825-2",
  "./assets/icon-192.png?v=20260825-2",
  "./assets/icon-512.png?v=20260825-2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(fetch(event.request).then((response) => {
    const clone = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html"))));
});
