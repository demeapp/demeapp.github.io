/* Deme native-app bridge. Bundled in the iOS/Android app ONLY; the website
   keeps the PWA version of this file. No service worker in the app. */
(function () {
  var cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== 'function' || !cap.isNativePlatform()) return;

  var HOST = 'demeapp.github.io';

  // Map an incoming https link to a bundled page. Only root-level .html pages
  // on Deme's own host are accepted; anything else is ignored.
  function route(raw) {
    try {
      var u = new URL(raw);
      if (u.protocol !== 'https:' || u.hostname !== HOST) return null;
      var path = u.pathname.replace(/^\/+/, '');
      if (path === '') path = 'index.html';
      if (!/^[A-Za-z0-9_-]+\.html$/.test(path)) return null;
      return path + u.search + u.hash; // hash kept so email-link sign-in tokens survive
    } catch (e) {
      return null;
    }
  }

  var App = cap.Plugins && cap.Plugins.App;
  if (App && typeof App.addListener === 'function') {
    App.addListener('appUrlOpen', function (e) {
      var target = route(e && e.url);
      if (target) window.location.href = target;
    });
  }
})();
