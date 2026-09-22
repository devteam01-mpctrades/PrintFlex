/* PrintFlex scan mode service worker.
   Scripts, styles and images: cache-first (they are content-hashed or static).
   Scan pages: network-first, falling back to the last good copy, so a sheet
   opened once still opens with no signal. Nothing else is touched. */
const CACHE = "pf-scan-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

function isAsset(request, url) {
  return request.destination === "script" || request.destination === "style" || request.destination === "image" || request.destination === "font" ||
    url.pathname.startsWith("/assets/") || url.pathname.startsWith("/node_modules/") || url.pathname.startsWith("/app/") || url.pathname.startsWith("/@") || url.pathname.startsWith("/build/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const isScanPage = request.mode === "navigate" && url.pathname.startsWith("/scan");
  if (!isScanPage && !isAsset(request, url)) return;

  if (isScanPage) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE).then((c) => c.put(request, response.clone()));
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match("/scan").then((hub) => hub || new Response("Offline and this page was never opened on this device. Open it once while connected.", { status: 503, headers: { "Content-Type": "text/plain" } })))),
    );
    return;
  }
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok && (response.type === "basic" || response.type === "default")) caches.open(CACHE).then((c) => c.put(request, response.clone()));
          return response;
        }),
    ),
  );
});
