// 绿茵生涯 PWA 壳缓存：导航请求走网络优先，保证更新能及时生效；静态资源缓存优先
// BUILD 必须与 绿茵生涯.html 的 BUILD_ID 一致（tools/guard.js 发布前比对）
const BUILD = '2026.10.31.3';
const CACHE = 'lvyin-pwa-' + BUILD;
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); })
  );
});
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('./index.html');
        }).then(function (r) {
          return r || new Response('<!DOCTYPE html><html lang="zh-CN"><meta charset="utf-8"><body style="background:#080820;color:#eef1ff;font-family:sans-serif;padding:40px;text-align:center;"><h1>离线版本</h1><p>当前网络不可用，且尚未缓存游戏页面。联网后刷新即可进入。</p></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        });
      })
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        return res;
      });
    })
  );
});
