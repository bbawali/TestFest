/* TestFest service worker
   - App files (same origin): network-first, so a new deployment is picked up at once;
     the cached copy is used only when the network is unavailable.
   - Versioned libraries (KaTeX, Firebase SDK modules): stale-while-revalidate.
   - Firestore / Auth / every other request is NOT touched, so live exam data is never cached. */
const VERSION = 'v2';
const SHELL_CACHE = 'testfest-shell-' + VERSION;
const CDN_CACHE = 'testfest-cdn-' + VERSION;
const SHELL_FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // add one by one so a missing file (e.g. icon not uploaded yet) cannot break the install
    await Promise.allSettled(SHELL_FILES.map(f => cache.add(f)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, CDN_CACHE];
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('testfest-') && !keep.includes(n)).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

function isCdnAsset(url) {
  if (url.hostname === 'cdn.jsdelivr.net') return true;
  if (url.hostname === 'www.gstatic.com' && url.pathname.indexOf('/firebasejs/') === 0) return true;
  return false;
}

async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const page = (await cache.match('./')) || (await cache.match('index.html'));
      if (page) return page;
    }
    throw err;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CDN_CACHE);
  const hit = await cache.match(req);
  const refresh = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (hit) return hit;
  const res = await refresh;
  if (res) return res;
  return Response.error();
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  } else if (isCdnAsset(url)) {
    event.respondWith(staleWhileRevalidate(req));
  }
});
