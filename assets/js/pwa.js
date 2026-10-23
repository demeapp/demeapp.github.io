/* Deme: installable-app wiring. Loaded once from assets/js/common.js. */
(function () {
  var head = document.head;
  function add(tag, attrs) {
    var el = document.createElement(tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    head.appendChild(el);
  }
  if (!document.querySelector('link[rel="manifest"]'))
    add('link', { rel: 'manifest', href: '/manifest.webmanifest' });
  if (!document.querySelector('link[rel="apple-touch-icon"]'))
    add('link', { rel: 'apple-touch-icon', href: '/assets/icons/apple-touch-icon-2026.png' });
  if (!document.querySelector('meta[name="theme-color"]'))
    add('meta', { name: 'theme-color', content: '#0E2A47' });
  add('meta', { name: 'mobile-web-app-capable', content: 'yes' });
  add('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
  add('meta', { name: 'apple-mobile-web-app-title', content: 'Deme' });

  // Install hook. No visible prompt UI ships until its copy is approved.
  // Chrome/Android keeps its native install prompt. To build a custom prompt
  // later, set window.DEME_CUSTOM_INSTALL = true before this loads, then listen
  // for 'deme:installable' and call window.demeInstall().
  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    if (window.DEME_CUSTOM_INSTALL) e.preventDefault();
    deferred = e;
    document.dispatchEvent(new CustomEvent('deme:installable'));
  });
  window.addEventListener('appinstalled', function () {
    deferred = null;
    document.dispatchEvent(new CustomEvent('deme:installed'));
  });
  window.demeInstall = function () {
    if (!deferred || !window.DEME_CUSTOM_INSTALL) return Promise.resolve(false);
    deferred.prompt();
    return deferred.userChoice.then(function (c) { deferred = null; return c.outcome === 'accepted'; });
  };

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }
})();

/* Deme deep-link router (live mode). Inert on the website and in any build without
   the Capacitor App plugin. Appended to the site's assets/js/pwa.js as an overlay. */
(function () {
  var cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return;
  var App = cap.Plugins && cap.Plugins.App;
  if (!App) return;

  var HOST = 'demeapp.github.io';
  var KEY = 'deme.router.handled';
  var MAX_LEN = 2048;

  // Only https links on Deme's own host (no credentials, no port) to the home page or a
  // root-level .html page are accepted. ?query and #hash are kept (email-link tokens).
  function route(raw) {
    try {
      if (typeof raw !== 'string' || raw.length > MAX_LEN) return null;
      var u = new URL(raw);
      if (u.protocol !== 'https:' || u.hostname !== HOST) return null;
      if (u.port !== '' || u.username !== '' || u.password !== '') return null;
      if (/^\/\//.test(u.pathname)) return null;
      var p = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
      if (!/^[A-Za-z0-9_-]+\.html$/.test(p)) return null;
      return '/' + p + u.search + u.hash;
    } catch (e) {
      return null;
    }
  }

  // The launch URL stays the same for the whole app session, so remember (as a hash,
  // never the URL itself: it may carry tokens) that it has been handled.
  function fnv(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return 'h' + h.toString(16);
  }
  function handled(tag) {
    try { if (sessionStorage.getItem(KEY) === tag) return true; } catch (e) {}
    return window.name === KEY + ':' + tag;
  }
  function mark(tag) {
    try { sessionStorage.setItem(KEY, tag); } catch (e) {}
    if (!window.name || window.name.indexOf(KEY + ':') === 0) window.name = KEY + ':' + tag;
  }
  function go(target) {
    if (!target) return;
    if (target === location.pathname + location.search + location.hash) return;
    location.assign(target);
  }

  // Cold start: a link launched the app. Evaluated once per launch.
  if (typeof App.getLaunchUrl === 'function') {
    try {
      Promise.resolve(App.getLaunchUrl()).then(function (res) {
        var url = res && res.url;
        if (!url) return;
        var tag = fnv(url);
        if (handled(tag)) return;
        mark(tag); // also marks unroutable URLs, so they are judged once
        go(route(url));
      }).catch(function () {});
    } catch (e) {}
  }

  // Warm start: the app was already running. Every valid link routes; no guard.
  if (typeof App.addListener === 'function') {
    try {
      App.addListener('appUrlOpen', function (e) {
        var url = e && e.url;
        var target = route(url);
        if (!target) return;
        mark(fnv(url));
        go(target);
      });
    } catch (e) {}
  }
})();
