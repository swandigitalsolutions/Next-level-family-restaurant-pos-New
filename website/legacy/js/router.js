/* =========================================================
   NEXT LEVEL FAMILY RESTAURANT — router.js
   Hash-based client-side router. Chosen over server-side
   routing on purpose: it works on any static host with zero
   server config (no rewrite rules needed), so refreshing on
   "next-level.com/#/menu" never 404s. Navigation never reloads
   the page — only <main id="view"> is re-rendered, so the
   header, footer and chatbot stay mounted and instant.
   ========================================================= */
(function () {
  'use strict';

  var view = document.getElementById('view');
  var navLinks = document.querySelectorAll('.nav-links a[href^="#/"]');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var firstRender = true;

  function parseHash() {
    var raw = (location.hash || '').replace(/^#/, '');
    var parts = raw.split('/').filter(Boolean);
    var path = parts.length ? '/' + parts[0] : '/';
    var anchor = parts.length > 1 ? parts[1] : null;
    return { path: path, anchor: anchor };
  }

  function setActiveNav(path) {
    navLinks.forEach(function (a) {
      var target = a.getAttribute('href').replace(/^#/, '').split('/').filter(Boolean);
      var targetPath = target.length ? '/' + target[0] : '/';
      if (targetPath === path) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function renderRoute(route, opts) {
    var entry = window.NL.views[route.path] || window.NL.views['/'];
    document.title = entry.title;
    setActiveNav(route.path);

    var doRender = function () {
      view.innerHTML = entry.render();
      NL.lazyLoadImages(view);
      if (entry.init) entry.init(view, route.anchor);
      if (!route.anchor) {
        if (!opts || !opts.skipScroll) window.scrollTo({ top: 0, behavior: 'auto' });
      }
      view.classList.remove('view-fade');
    };

    // The first paint has nothing to cross-fade from — skip the
    // transition so the landing view renders without an extra
    // full-page snapshot on load.
    if (firstRender) {
      firstRender = false;
      doRender();
      return;
    }

    // Use the native View Transitions API when available for a smooth
    // cross-fade; fall back to a manual CSS fade for other browsers.
    if (!reduceMotion && document.startViewTransition) {
      document.startViewTransition(doRender);
    } else if (!reduceMotion) {
      view.classList.add('view-fade');
      window.setTimeout(doRender, 120);
    } else {
      doRender();
    }
  }

  function handleNavigation(opts) {
    renderRoute(parseHash(), opts);
  }

  window.addEventListener('hashchange', function () { handleNavigation(); });
  window.addEventListener('DOMContentLoaded', function () {
    if (!location.hash) location.hash = '#/';
    handleNavigation({ skipScroll: false });
  });
})();
