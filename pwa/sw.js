// sw.js — 물때빈자리 서비스워커
// 앱셸: 캐시 우선(빠르고 오프라인 동작) / data.json: 네트워크 우선(온라인이면 최신, 아니면 마지막 캐시)
const VERSION = "v2.2.1";
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;

const SHELL_ASSETS = [
  ".",
  "index.html",
  "app.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "img/bada.jpg",
  "img/chamdom.jpg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // data.json → 네트워크 우선, 실패 시 캐시
  if (url.pathname.endsWith("/data.json") || url.pathname.endsWith("data.json")) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(DATA).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 그 외 → 캐시 우선, 없으면 네트워크
  e.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res.ok && url.origin === location.origin) {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match("index.html")))
  );
});
