/* =========================================================
   NEXT LEVEL FAMILY RESTAURANT — main.js
   Vanilla JS only: no framework, no build step, no runtime
   dependencies. Kept small on purpose for fast first paint.
   ========================================================= */
(function () {
  'use strict';

  /* ---------- Mobile nav ---------- */
  var toggle = document.querySelector('.nav-toggle');
  var links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      toggle.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    links.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        links.classList.remove('open');
        toggle.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      });
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

  /* ---------- Footer year ---------- */
  document.querySelectorAll('[data-year]').forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  /* ---------- Lazy-loaded images: swap data-src when near viewport ----------
     Belt-and-braces on top of native loading="lazy" for older browsers. */
  if ('IntersectionObserver' in window) {
    var lazyImgs = document.querySelectorAll('img[data-src]');
    if (lazyImgs.length) {
      var io = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            var img = entry.target;
            img.src = img.getAttribute('data-src');
            img.removeAttribute('data-src');
            obs.unobserve(img);
          }
        });
      }, { rootMargin: '200px 0px' });
      lazyImgs.forEach(function (img) { io.observe(img); });
    }
  } else {
    document.querySelectorAll('img[data-src]').forEach(function (img) {
      img.src = img.getAttribute('data-src');
    });
  }

  /* ---------- Gallery lightbox ---------- */
  var galleryButtons = document.querySelectorAll('[data-gallery-item]');
  var lightbox = document.querySelector('.lightbox');
  if (galleryButtons.length && lightbox) {
    var lbImg = lightbox.querySelector('img');
    var idx = 0;
    var items = Array.prototype.map.call(galleryButtons, function (b) {
      return { full: b.getAttribute('data-full'), alt: b.querySelector('img').alt };
    });

    var show = function (i) {
      idx = (i + items.length) % items.length;
      lbImg.src = items[idx].full;
      lbImg.alt = items[idx].alt;
    };
    var open = function (i) {
      show(i);
      lightbox.classList.add('open');
      document.body.style.overflow = 'hidden';
    };
    var close = function () {
      lightbox.classList.remove('open');
      document.body.style.overflow = '';
    };

    galleryButtons.forEach(function (btn, i) {
      btn.addEventListener('click', function () { open(i); });
    });
    lightbox.querySelector('.lightbox-close').addEventListener('click', close);
    lightbox.querySelector('.lightbox-nav.prev').addEventListener('click', function () { show(idx - 1); });
    lightbox.querySelector('.lightbox-nav.next').addEventListener('click', function () { show(idx + 1); });
    lightbox.addEventListener('click', function (e) { if (e.target === lightbox) close(); });
    document.addEventListener('keydown', function (e) {
      if (!lightbox.classList.contains('open')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') show(idx + 1);
      if (e.key === 'ArrowLeft') show(idx - 1);
    });
  }

  /* ---------- Book-style flipbook menu ----------
     Each .fb-page represents one leaf. Pages start unflipped
     (stacked on the right). Clicking next flips the front-most
     right-hand page onto the left; prev reverses it. */
  var flipbook = document.querySelector('.flipbook');
  if (flipbook) {
    var pages = Array.prototype.slice.call(flipbook.querySelectorAll('.fb-page'));
    var nextBtn = document.querySelector('[data-flip-next]');
    var prevBtn = document.querySelector('[data-flip-prev]');
    var counter = document.querySelector('[data-flip-count]');
    var flipped = 0; // number of pages currently turned to the left

    pages.forEach(function (p, i) { p.style.zIndex = pages.length - i; });

    var update = function () {
      pages.forEach(function (p, i) {
        p.classList.toggle('flipped', i < flipped);
        p.style.zIndex = i < flipped ? (i + 1) : (pages.length - i);
      });
      if (prevBtn) prevBtn.disabled = flipped === 0;
      if (nextBtn) nextBtn.disabled = flipped === pages.length;
      if (counter) counter.textContent = (flipped) + ' / ' + pages.length;
    };

    var goNext = function () { if (flipped < pages.length) { flipped++; update(); } };
    var goPrev = function () { if (flipped > 0) { flipped--; update(); } };

    if (nextBtn) nextBtn.addEventListener('click', goNext);
    if (prevBtn) prevBtn.addEventListener('click', goPrev);

    // Click a page edge to flip it too, like a real book.
    pages.forEach(function (p, i) {
      p.addEventListener('click', function () {
        if (!p.classList.contains('flipped') && i === flipped) goNext();
      });
    });
    flipbook.querySelectorAll('.fb-static .side').forEach(function (side) {
      side.addEventListener('click', function () {
        if (side.classList.contains('right')) goNext(); else goPrev();
      });
    });

    document.addEventListener('keydown', function (e) {
      if (!flipbook.getBoundingClientRect().top < window.innerHeight) return;
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'ArrowLeft') goPrev();
    });

    // Basic swipe support
    var startX = null;
    flipbook.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; }, { passive: true });
    flipbook.addEventListener('touchend', function (e) {
      if (startX === null) return;
      var dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 40) { dx < 0 ? goNext() : goPrev(); }
      startX = null;
    }, { passive: true });

    update();
  }

  /* ---------- Contact / reservation form (front-end only demo) ---------- */
  var form = document.querySelector('[data-reserve-form]');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var success = document.querySelector('.form-success');
      if (success) {
        success.classList.add('show');
        success.setAttribute('role', 'status');
      }
      form.reset();
    });
  }
})();
