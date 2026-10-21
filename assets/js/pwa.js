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
    add('link', { rel: 'apple-touch-icon', href: '/assets/icons/apple-touch-icon.png' });
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
