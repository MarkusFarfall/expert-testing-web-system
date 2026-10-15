/* Сервис-воркер PWA «Экспертиза КТПП».
   Обновляется автоматически: строка версии подставляется скриптом деплоя (см. scripts/deploy-pages.sh).
   Правила:
   - запросы к API (другой домен) не перехватываем вообще — данные всегда свежие;
   - файлы сайта (шрифты, скрипты, стили, иконки) кэшируем — приложение открывается мгновенно и работает без сети;
   - страницы: сначала сеть, при отсутствии — копия из кэша, затем страница «Нет соединения». */
const VERSION = "__BUILD__";
const STATIC_CACHE = `ktpp-static-${VERSION}`;
const PAGE_CACHE = `ktpp-pages-${VERSION}`;

const OFFLINE_URL = new URL("offline.html", self.registration.scope).toString();
const SAME_ORIGIN = self.location.origin;
const isStatic = (pathname) =>
  pathname.includes("/_next/static/") || pathname.includes("/fonts/") || pathname.includes("/icons/") ||
  pathname.endsWith(".svg") || pathname.endsWith(".png") || pathname.endsWith(".webmanifest") || pathname.endsWith(".ttf");

const cacheable = (response) => response && response.ok && response.type === "basic";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    try { await (await caches.open(STATIC_CACHE)).add(new Request(OFFLINE_URL, { cache: "reload" })); } catch { /* офлайн-страница не критична */ }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("ktpp-") && !key.endsWith(VERSION)).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

// Тихонько обновляем копию в кэше, чтобы подхватывались свежие версии файлов.
function revalidate(cache, request) {
  fetch(request)
    .then((response) => { if (cacheable(response)) cache.put(request, response.clone()); })
    .catch(() => undefined);
}

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) { revalidate(cache, request); return hit; }
  const response = await fetch(request);
  if (cacheable(response)) cache.put(request, response.clone());
  return response;
}

async function networkFirst(cacheName, request, fallbackToOffline) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (cacheable(response)) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    if (fallbackToOffline) {
      const offline = await caches.match(OFFLINE_URL);
      if (offline) return offline;
    }
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;                 // ничего, что меняет данные, не перехватываем
  // API credentials mark private responses even with a same-origin reverse proxy.
  if (request.headers.has("x-visitor-id") || request.headers.has("x-admin-token")) return;
  const url = new URL(request.url);
  if (/\/(?:api|portal|test-api)(?:\/|$)/.test(url.pathname)) return;
  if (url.origin !== SAME_ORIGIN) return;               // API и сторонние ресурсы — напрямую в сеть
  if (request.headers.has("range")) return;
  if (request.mode === "navigate") { event.respondWith(networkFirst(PAGE_CACHE, request, true)); return; }
  if (isStatic(url.pathname)) { event.respondWith(cacheFirst(STATIC_CACHE, request)); return; }
  event.respondWith(networkFirst(PAGE_CACHE, request, false));
});
