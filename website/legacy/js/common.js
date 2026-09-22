/* =========================================================
   NEXT LEVEL FAMILY RESTAURANT — common.js
   Behaviors that live in the persistent app shell (run once)
   plus a couple of helpers the router calls after each render.
   ========================================================= */
window.NL = window.NL || {};

(function () {
  'use strict';

  /* ---------- Mobile nav ---------- */
  var toggle = document.getElementById('navToggle');
  var links = document.getElementById('navLinks');
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      toggle.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    links.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        links.classList.remove('open');
        toggle.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ---------- Sticky header shadow on scroll ---------- */
  var header = document.querySelector('.site-header');
  if (header) {
    var lastY = -1;
    var onScroll = function () {
      var y = window.scrollY;
      if (y === lastY) return;
      lastY = y;
      header.classList.toggle('scrolled', y > 8);
    };
    document.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Footer year (shell renders once) ---------- */
  document.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  /* ---------- Lazy image loader ----------
     Called by the router after every view render, since the
     router injects fresh <img data-src> nodes into the DOM. */
  NL.lazyLoadImages = function (scope) {
    scope = scope || document;
    var imgs = scope.querySelectorAll('img[data-src]');
    if (!imgs.length) return;
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var img = entry.target;
            img.src = img.getAttribute('data-src');
            img.removeAttribute('data-src');
            obs.unobserve(img);
          }
        });
      }, { rootMargin: '250px 0px' });
      imgs.forEach(function (img) { io.observe(img); });
    } else {
      imgs.forEach(function (img) { img.src = img.getAttribute('data-src'); });
    }
  };
})();
