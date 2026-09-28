const VERSION = '0.31';
const CACHE = 'temple-reception-v031';
const LOCAL = [
  './',
  './index.html',
  './app.js',
  './temple-data.js',
  './roles-data.js',
  './manifest.webmanifest'
];
const XLSX = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
const JSPDF = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';

self.addEventListener('install', event => {
  // 新版を待機状態にせず、できるだけ早く有効化する。
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // ローカル資産は最新版を取りに行って保存する。
    for (const url of LOCAL) {
      try {
        const response = await fetch(url, { cache: 'reload' });
        if (response && response.ok) await cache.put(url, response.clone());
      } catch (_) {}
    }
    // 外部ライブラリはオフライン用に可能なら保存。
    for (const lib of [XLSX, JSPDF]) {
      try {
        const response = await fetch(lib, { mode: 'no-cors', cache: 'reload' });
        if (response) await cache.put(lib, response.clone());
      } catch (_) {}
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // temple-reception 系の旧世代キャッシュを削除する。
    for (const key of await caches.keys()) {
      if (key.startsWith('temple-reception-') && key !== CACHE) {
        await caches.delete(key);
      }
    }
    await self.clients.claim();
  })());
});

async function networkFirst(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && (response.ok || response.type === 'opaque')) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (_) {
    const cached = await caches.match(request);
    return cached || Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (_) {
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // GitHub Pages 上のアプリ本体は Network First。
  // オンライン時はGitHub上の最新版を優先し、失敗時だけキャッシュへ戻る。
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
    return;
  }

  // 外部ライブラリはオフライン性を優先して Cache First。
  event.respondWith(cacheFirst(request));
});
