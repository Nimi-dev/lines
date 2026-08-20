const CACHE = "lines-v6-8-git";
const ASSETS = ["./", "index.html", "styles.css", "manifest.json", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "pieces/kl.svg", "pieces/kd.svg", "pieces/ql.svg", "pieces/qd.svg", "pieces/rl.svg", "pieces/rd.svg", "pieces/bl.svg", "pieces/bd.svg", "pieces/nl.svg", "pieces/nd.svg", "pieces/pl.svg", "pieces/pd.svg"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (req.mode === "navigate") {
    // network-first so redeploys land; cached shell when offline
    e.respondWith(fetch(req).then((r) => { caches.open(CACHE).then((c) => c.put("index.html", r.clone())); return r; }).catch(() => caches.match("index.html")));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r && (r.ok || r.type === "opaque")) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
    return r;
  }).catch(() => hit)));
});
