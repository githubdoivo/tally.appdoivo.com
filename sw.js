// Offline support: the app shell is cached on install;
// a new version (VERSION bump) replaces the old cache. No data is ever cached
// here — the expenses live in IndexedDB.
const VERSION = "tally-v10";
const SHELL = ["/", "/index.html", "/app.css?v=11", "/js/app.js?v=8", "/js/frame.js", "/img/paper.webp", "/js/model.js", "/js/db.js", "/js/words.js", "/js/charts.js", "/js/excel.js", "/js/xlsx.js", "/privacy.html", "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
// Pages, styles and scripts: network first, so an update shows on the very next visit;
// the saved copy is used only when offline. Images and icons: cache first.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const fresh = e.request.mode === "navigate" || ["style", "script", "manifest"].includes(e.request.destination);
  const save = (res) => { if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); } return res; };
  const cached = () => caches.match(e.request, { ignoreSearch: url.pathname.startsWith("/js/") }).then((hit) => hit || (e.request.mode === "navigate" ? caches.match("/index.html") : Response.error()));
  e.respondWith(fresh
    ? fetch(e.request).then(save).catch(cached)
    : caches.match(e.request).then((hit) => hit || fetch(e.request).then(save).catch(() => Response.error())));
});
