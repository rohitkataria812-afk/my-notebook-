const CACHE_NAME = "my-notebook-cache-v1";
const APP_SHELL = [
  "./index.html",
  "./css/style.css",
  "./js/firebase-config.js",
  "./js/db.js",
  "./js/utils.js",
  "./js/auth.js",
  "./js/sync.js",
  "./js/app.js",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Network-first for Firebase/API calls, cache-first for app shell
self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  if (url.includes("firestore.googleapis.com") || url.includes("googleapis.com") || url.includes("identitytoolkit")) {
    return; // let Firebase handle its own network/offline logic
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((resp) => {
        if (event.request.method === "GET" && resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
