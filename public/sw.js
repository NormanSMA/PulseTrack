const CACHE_PREFIX = "pulsetrack-shell-";
const CACHE_VERSION = `${CACHE_PREFIX}v1`;
const PRECACHE_ROUTES = [
  "/",
  "/gym",
  "/routes",
  "/nutrition",
  "/ai-engine",
  "/manifest.webmanifest",
  "/icon.svg",
];

function isCacheableStaticPath(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/workers/") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/icon.svg" ||
    pathname === "/apple-touch-icon.png"
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        Promise.allSettled(PRECACHE_ROUTES.map((route) => cache.add(route))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (isCacheableStaticPath(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)),
            );
          }
          return response;
        });
      }),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(
              caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)),
            );
            return response;
          }
          if (response.status >= 500) {
            return caches
              .match(request)
              .then((cached) => cached ?? caches.match("/"))
              .then((fallback) => fallback ?? response);
          }
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached ?? caches.match("/"))
            .then(
              (fallback) =>
                fallback ??
                new Response("PulseTrack sin conexion.", {
                  status: 503,
                  headers: { "Content-Type": "text/plain; charset=utf-8" },
                }),
            ),
        ),
    );
  }
});
