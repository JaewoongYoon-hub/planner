const CACHE = "planner-v18";
const CORE = ["./", "index.html", "manifest.json", "icon.svg", "icon-192.png", "icon-512.png", "config.js", "sync.js", "lib/firebase-app.js", "lib/firebase-auth.js", "lib/firebase-firestore.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// same-site files: network first so updates arrive when online; libraries and fonts: cache first
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(fetch(req, {cache: "no-cache"}).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(req.mode === "navigate" ? "index.html" : req, c)); return r; })
      .catch(() => caches.match(req.mode === "navigate" ? "index.html" : req, {ignoreSearch: true})));
    return;
  }
  if (!/gstatic\.com|googleapis\.com/.test(url.host)) return; // Firebase data traffic goes straight to the network
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); return r; })));
});
