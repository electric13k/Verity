// Verity service worker — app shell cached, API network-only.
//
// Contract (plan §3 / M4): the static app shell (HTML routes, JS/CSS bundles,
// icons) is cached so the PWA opens offline; anything under the gateway prefix
// is never cached — data must always be live. Reads only; no background sync.

const VERSION = "verity-v1";
const SHELL = `${VERSION}-shell`;

// The routes the static export emits, plus the PWA essentials. Kept small and
// explicit; bundles are cached on first fetch (stale-while-revalidate below).
const PRECACHE = [
  "/",
  "/flows",
  "/offices",
  "/compute",
  "/settings",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // addAll is atomic — one 404 fails the whole install. Add individually so
      // a single missing pre-render can't break registration.
      .then((cache) => Promise.allSettled(PRECACHE.map((u) => cache.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

// Is this a call to the gateway? Same-origin dev proxy is "/gw/*"; a deployed
// build points NEXT_PUBLIC_GATEWAY_URL at another origin. Either way: never cache.
function isApiRequest(url) {
  if (url.origin !== self.location.origin) return true; // cross-origin = gateway/CDN, stay live
  return url.pathname.startsWith("/gw/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // POST /chat, /flows, /upload — untouched

  const url = new URL(request.url);
  if (isApiRequest(url)) return; // network-only: let it hit the network directly

  // Navigations: network-first so a fresh shell wins, cache as offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match("/"))),
    );
    return;
  }

  // Static assets (bundles, fonts, icons): stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
