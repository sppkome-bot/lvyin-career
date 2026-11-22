// 绿茵生涯 PWA 壳缓存：导航请求走网络优先，保证更新能及时生效；静态资源缓存优先
// BUILD 必须与 绿茵生涯.html 的 BUILD_ID 一致（tools/guard.js 发布前比对）
const BUILD = '2026.11.13.226';
const CACHE = 'lvyin-pwa-' + BUILD;
// 缓存白名单：只缓存游戏壳本身。backup/、tools/out/ 等目录永远不会进来。
// ./ 已覆盖站点根，不再重复缓存 ./index.html（同一份 7MB 页面存两遍没有意义）。
const ASSETS = ['./', './manifest.webmanifest', './icon.svg'];
const ROOT = new URL('./', self.location.href);
const ALLOW = ASSETS.map(function (a) { return new URL(a, self.location.href).href; });
function cacheable(url) { return ALLOW.indexOf(url.href) >= 0; }
// 只有站点根与根下的 index.html 算「游戏壳页面」，backup/、tools/out/ 下的 html 不算
function shellPage(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.indexOf(ROOT.pathname) !== 0) return false;
  var rel = url.pathname.slice(ROOT.pathname.length);
  return rel === '' || rel === 'index.html';
}

// 预缓存：cache:'reload' 强制绕过 HTTP 缓存，避免把上一版 HTML 装进新版本的缓存
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(ASSETS.map(function (a) {
        return fetch(new Request(a, { cache: 'reload' })).then(function (r) {
          if (!r || !r.ok) throw new Error('precache failed: ' + a + ' ' + (r && r.status));
          return c.put(a, r);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      // 只保留当前 BUILD 的缓存，旧版本整包删除，不随版本累积
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
      .then(function () { return self.clients.matchAll({ type: 'window' }); })
      .then(function (list) {
        // 告诉已打开的页面「现在接管你的是哪个 BUILD」，页面据此判断要不要提示更新
        list.forEach(function (c) { try { c.postMessage({ type: 'SW_BUILD', build: BUILD }); } catch (err) {} });
      })
  );
});
self.addEventListener('message', function (e) {
  var d = e.data || {};
  if (d.type === 'GET_BUILD' && e.source) {
    try { e.source.postMessage({ type: 'SW_BUILD', build: BUILD }); } catch (err) {}
  }
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(
      // no-cache：跳过 HTTP 缓存的「新鲜副本」，向服务器确认一次，首刷就能拿到新页面
      fetch(req, { cache: 'no-cache' }).then(function (res) {
        // 统一存到站点根，/ 与 /index.html 共用一份，避免同一页面缓存两遍
        if (res && res.ok && shellPage(url)) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(ROOT.href, copy); }).catch(function () {});
        }
        return res;
      }).catch(function () {
        return caches.match(ROOT.href).then(function (r) {
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
        if (res && res.ok && cacheable(url)) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        }
        return res;
      });
    })
  );
});
