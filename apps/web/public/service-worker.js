const SHELL_CACHE = "trunk-shell-v1";
const SHELL_URLS = [
  "/",
  "/manifest.webmanifest",
  "/pwa-192x192.png",
  "/pwa-512x512.png",
  "/maskable-icon-512x512.png",
  "/apple-touch-icon.png",
];
const NETWORK_ONLY_PREFIXES = [
  "/.well-known/",
  "/api/",
  "/attachments/",
  "/gateway/",
  "/openai/",
  "/v1/",
  "/ws",
];
const STATIC_DESTINATIONS = new Set(["font", "image", "script", "style", "worker"]);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cachedShell = await caches.match("/");
        return (
          cachedShell ??
          new Response("Trunk is offline. Reconnect to continue.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        );
      }),
    );
    return;
  }

  if (NETWORK_ONLY_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return;
  }

  if (!url.pathname.startsWith("/assets/") && !STATIC_DESTINATIONS.has(request.destination)) {
    return;
  }

  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const refreshed = fetch(request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            void cache.put(request, response.clone());
          }
          return response;
        })
        .catch((error) => {
          if (cached) {
            return cached;
          }
          throw error;
        });

      return cached ?? refreshed;
    }),
  );
});
