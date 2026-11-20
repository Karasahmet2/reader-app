// sw.js — makes the app open instantly and work fully offline.
//
// How it works:
//  • On install, every app file is saved in a cache named after VERSION.
//  • The app always opens from that cache — no waiting for the network, so it's
//    instant on the metro even with a weak signal.
//  • Chrome checks this file for changes whenever you open the app online. If it
//    changed, the new version is downloaded in the background and used the NEXT
//    time you open the app.
//
// ► After changing ANY file, bump VERSION (reader-v16, reader-v17, …) so phones update.

const VERSION = 'reader-v25';
const APP_FILES = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/parser.js',
  './js/settings.js',
  './js/ui.js',
  './js/notes.js',
  './js/backup.js',
  './js/find.js',
  './js/sounds.js',
  './js/dictionary.js',
  './js/codex.js',
  './js/codex-guide.js',
  './js/trash.js',
  './js/words.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];
const FONT_CACHE = 'reader-fonts';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // cache: 'reload' skips the browser's normal HTTP cache, so we store the newest files.
    await cache.addAll(APP_FILES.map(url => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION && k !== FONT_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Google Fonts: saved the first time they load, then always from the phone.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith((async () => {
      const cache = await caches.open(FONT_CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;
      const res = await fetch(request);
      if (res.ok || res.type === 'opaque') cache.put(request, res.clone());
      return res;
    })());
    return;
  }

  // App files: from the saved copy first; the network only for anything not saved.
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(request, { ignoreSearch: true });
      if (hit) return hit;
      if (request.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return fetch(request);
    })());
  }
});
