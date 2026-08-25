const CACHE_NAME = "night-repair-v13-cloud-ocr";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=20260825-4",
  "./push-config.js?v=20260825-4",
  "./app.js?v=20260825-4",
  "./supplements.json?v=20260825-4",
  "./manifest.webmanifest?v=20260825-4",
  "./assets/icon-192.png?v=20260825-4",
  "./assets/icon-512.png?v=20260825-4",
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

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { payload = { body: event.data?.text() || "你有一条夜后修复提醒。" }; }
  const title = payload.title || "夜后修复";
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || "这是你设置的轻提醒。",
    icon: "./assets/icon-192.png",
    badge: "./assets/icon-192.png",
    tag: payload.tag || `night-repair-${payload.reminderId || "reminder"}`,
    data: { url: payload.url || "./#today", reminderId: payload.reminderId || null },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "./#today", self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
    const existing = windows.find((client) => client.url.startsWith(new URL("./", self.location.href).href));
    if (existing) {
      if ("navigate" in existing) await existing.navigate(target);
      return existing.focus();
    }
    return clients.openWindow(target);
  }));
});
