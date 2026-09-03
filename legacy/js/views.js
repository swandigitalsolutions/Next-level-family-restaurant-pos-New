/* =========================================================
   NEXT LEVEL FAMILY RESTAURANT — views.js
   Each view is a pure function returning an HTML string, plus
   an optional init(container) that wires up behavior after the
   router injects that HTML into the DOM. Content lives in JS on
   purpose: the whole site ships in one request, then every
   "page" is an instant, zero-network DOM swap.
   ========================================================= */
window.NL = window.NL || {};

(function () {
  'use strict';

  var SWOOSH = '<svg class="swoosh" viewBox="0 0 150 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2 8c20-10 40 10 60 0s40-10 60 0" stroke-width="4" stroke-linecap="round"/></svg>';
  var SWOOSH_CENTER = '<svg class="swoosh center" viewBox="0 0 150 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2 8c20-10 40 10 60 0s40-10 60 0" stroke-width="4" stroke-linecap="round"/></svg>';

  /* =======================================================
     HOME
     ======================================================= */
  function homeView() {
    return '' +
    '<section class="hero">' +
      '<div class="hero-inner">' +
        '<div>' +
          '<p class="hero-eyebrow"><img src="assets/logo.jpeg" alt="" width="30" height="30">A family kitchen, three generations deep</p>' +
          '<h1>Home cooking, <em>next level.</em></h1>' + SWOOSH +
          '<p class="lede">Real thalis, slow-cooked curries and tandoor smoke — served the way a family restaurant should feel: unhurried, generous, and genuinely warm. No stiff tablecloths, just really good food.</p>' +
          '<div class="hero-actions">' +
            '<a href="#/contact/reserve" class="btn btn-primary">Reserve a table</a>' +
            '<a href="#/menu" class="btn btn-ghost">Open the menu</a>' +
          '</div>' +
          '<div class="hero-stats">' +
            '<div><strong>25+</strong><span>years, three kitchens</span></div>' +
            '<div><strong>60+</strong><span>dishes made fresh daily</span></div>' +
            '<div><strong>4.6★</strong><span>from regulars, not critics</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="hero-art">' +
          '<img src="https://picsum.photos/seed/nlfr-hero/720/900" alt="A generous South Indian thali served at Next Level Family Restaurant" width="720" height="900" fetchpriority="high" decoding="async">' +
          '<div class="hero-badge"><span class="stars">★★★★★</span><p>"Feels like eating at my grandmother\'s table — just faster service."</p></div>' +
        '</div>' +
      '</div>' +
    '</section>' +

    '<section><div class="container">' +
      '<div class="section-head"><p class="kicker">What we\'re known for</p><h2>The dishes people drive across town for</h2>' + SWOOSH +
      '<p>A working menu of family favourites — this is a preview. The full, flip-through menu with prices lives on its own page.</p></div>' +
      '<div class="dish-grid">' +
        dish('big', 'nlfr-thali', 800, 800, 'Next Level special thali with rice, sambar, curries and papad', 'Chef\'s pick', 'Next Level Special Thali', 'Unlimited, changes daily') +
        dish('small', 'nlfr-dosa', 500, 580, 'Crisp masala dosa with chutneys', null, 'Butter Masala Dosa', 'South Indian') +
        dish('small', 'nlfr-tandoor', 500, 580, 'Tandoori chicken fresh off the grill', null, 'Tandoori Chicken', 'From the grill') +
        dish('wide', 'nlfr-biryani', 700, 525, 'Hyderabadi-style dum biryani', null, 'Dum Biryani', 'Veg & non-veg') +
        dish('wide', 'nlfr-paneer', 700, 525, 'Paneer butter masala in a copper handi', null, 'Paneer Butter Masala', 'North Indian') +
        dish('wide', 'nlfr-dessert', 700, 525, 'Gulab jamun and kesari as dessert', null, 'Gulab Jamun & Kesari', 'Desserts') +
      '</div>' +
    '</div></section>' +

    '<section style="background:var(--cream-dim)"><div class="container split">' +
      '<div><p class="kicker">Since day one</p><h2>Still run by the same family that opened the door</h2>' + SWOOSH +
      '<p>What started as a small kitchen table has grown into a full dining room — but the spice blends, the slow-cooked dals and the habit of feeding regulars a little extra haven\'t changed.</p>' +
      '<p class="pull-quote">"We cook the way we\'d feed our own kids. That\'s the whole recipe."</p>' +
      '<a href="#/about" class="btn btn-ghost">Read our story</a></div>' +
      '<div class="split-media"><img data-src="https://picsum.photos/seed/nlfr-family/700/840" alt="The family behind Next Level Family Restaurant in the kitchen" width="700" height="840" loading="lazy" decoding="async"></div>' +
    '</div></section>' +

    '<section class="band-dark"><div class="container menu-teaser">' +
      '<div class="book-peek"><div class="cover"><img src="assets/logo.jpeg" alt="" width="64" height="64"><h3>The Menu</h3><span>FLIP THROUGH IT LIKE THE REAL THING</span></div></div>' +
      '<div><p class="kicker" style="color:var(--sunflower)">Browse before you arrive</p><h2>A menu you can actually page through</h2>' + SWOOSH +
      '<p style="color:rgba(251,243,231,0.78)">Starters, tandoor, curries, biryani, Chinese and dessert — laid out like a printed menu, one spread at a time. Prices included, no PDF required.</p>' +
      '<a href="#/menu" class="btn btn-gold mt-lg">Open the full menu</a></div>' +
    '</div></section>' +

    '<section><div class="container">' +
      '<div class="section-head center"><p class="kicker">In our guests\' words</p><h2>What regulars keep coming back for</h2>' + SWOOSH_CENTER + '</div>' +
      '<div class="notes">' +
        note('★★★★★', 'Portions are generous and nothing tastes like it came out of a factory kitchen. The thali is unbeatable value.', 'Anjali R.', 'Regular, Sunday lunch') +
        note('★★★★★', 'Took my in-laws here for the first time and they\'ve asked to come back three times since. That says everything.', 'Praveen S.', 'Family of 6') +
        note('★★★★☆', 'Great for birthdays — they remembered our order from last time. Small touch, but it matters.', 'Deepa & Family', 'Celebrating here since 2021') +
      '</div>' +
    '</div></section>' +

    '<section class="band-red"><div class="container cta-band">' +
      '<h2>Bring the whole family. We\'ll save the table.</h2>' +
      '<p>Walk-ins are always welcome, but a quick call on weekends means no waiting at the door.</p>' +
      '<div class="cta-actions"><a href="#/contact/reserve" class="btn btn-gold">Reserve a table</a><a href="#/contact" class="btn btn-ghost" style="border-color:#fff;color:#fff">Get directions</a></div>' +
    '</div></section>';
  }

  function dish(size, seed, w, h, alt, tag, title, sub) {
    return '<div class="dish ' + size + '">' +
      '<img data-src="https://picsum.photos/seed/' + seed + '/' + w + '/' + h + '" alt="' + alt + '" width="' + w + '" height="' + h + '" loading="lazy" decoding="async">' +
      (tag ? '<span class="tag">' + tag + '</span>' : '') +
      '<div class="cap"><h3>' + title + '</h3><span>' + sub + '</span></div>' +
    '</div>';
  }
  function note(stars, text, who, sub) {
    return '<div class="note"><span class="stars">' + stars + '</span><p>' + text + '</p><div class="who">' + who + '<span>' + sub + '</span></div></div>';
  }

  /* =======================================================
     MENU (book-style flipbook)
     ======================================================= */
  function menuView() {
    function page(cat, items, numClass, num) {
      var rows = items.map(function (it) {
        return '<div class="menu-item"><div><div class="n">' + it[0] + '</div><div class="d">' + it[1] + '</div></div><div class="p">' + it[2] + '</div></div>';
      }).join('');
      return '<p class="menu-cat">' + cat + '</p>' + rows + '<p class="menu-page-num ' + numClass + '">' + num + '</p>';
    }
    var leaves = [
      { front: '<div class="fb-cover-face"><img src="assets/logo.jpeg" alt=""><h2>The Menu</h2><span>NEXT LEVEL FAMILY RESTAURANT</span></div>',
        back: page('Starters', [
          ['Veg Manchow Soup', 'Crisp fried noodles on top', '₹149'],
          ['Chicken Tandoori Wings', 'Half / full plate', '₹289'],
          ['Paneer 65', 'Curry-leaf tempered', '₹259'],
          ['Corn & Spinach Kebab', 'Pan-seared, mint chutney', '₹229'],
          ['Prawn Koliwada', 'Rava-crusted, fried', '₹339']
        ], 'r', '1') },
      { front: page('Soups & Salads', [
          ['Tomato Shorba', 'Roasted tomato, cumin', '₹119'],
          ['Sweet Corn Soup', 'Veg or chicken', '₹129'],
          ['Kachumber Salad', 'Cucumber, onion, tomato', '₹99'],
          ['Sprouts & Pomegranate', 'Lemon, chaat masala', '₹129']
        ], 'l', '2'),
        back: page('Tandoor & Grills', [
          ['Tandoori Chicken', 'Half / full', '₹399'],
          ['Malai Chicken Tikka', 'Cream & cheese marinade', '₹359'],
          ['Paneer Tikka', 'Bell pepper, onion', '₹289'],
          ['Seekh Kebab', 'Mutton or chicken', '₹359'],
          ['Tandoori Prawns', 'Ajwain marinade', '₹429']
        ], 'r', '3') },
      { front: page('South Indian Specials', [
          ['Next Level Special Thali', 'Unlimited, changes daily', '₹289'],
          ['Butter Masala Dosa', 'Sambar, 2 chutneys', '₹159'],
          ['Mysore Bonda Idli', 'Steamed, ghee roast', '₹129'],
          ['Bisi Bele Bath', 'Lentils, vegetables, ghee', '₹169']
        ], 'l', '4'),
        back: page('North Indian Curries', [
          ['Paneer Butter Masala', 'Tomato-cashew gravy', '₹269'],
          ['Dal Makhani', 'Slow-cooked overnight', '₹219'],
          ['Chicken Curry', 'Home-style masala', '₹319'],
          ['Mutton Rogan Josh', 'Kashmiri spice', '₹389'],
          ['Malai Kofta', 'Cashew gravy', '₹259']
        ], 'r', '5') },
      { front: page('Biryani & Rice', [
          ['Chicken Dum Biryani', 'Served with raita', '₹329'],
          ['Mutton Dum Biryani', 'Served with raita', '₹389'],
          ['Veg Dum Biryani', 'Mixed vegetable', '₹249'],
          ['Jeera Rice', 'Steamed basmati', '₹149']
        ], 'l', '6'),
        back: page('Chinese Corner', [
          ['Veg / Chicken Fried Rice', 'Wok-tossed', '₹219'],
          ['Gobi Manchurian', 'Dry or gravy', '₹229'],
          ['Chilli Chicken', 'Dry or gravy', '₹279'],
          ['Hakka Noodles', 'Veg or chicken', '₹219']
        ], 'r', '7') },
      { front: page('Breads', [
          ['Tandoori Roti', 'Plain or butter', '₹35'],
          ['Garlic Naan', 'Stone-baked', '₹69'],
          ['Laccha Paratha', 'Layered, ghee', '₹65'],
          ['Cheese Kulcha', 'Stuffed', '₹99']
        ], 'l', '8'),
        back: page('Desserts & Beverages', [
          ['Gulab Jamun (2 pcs)', 'Warm, served with rabri', '₹99'],
          ['Kesari Bath', 'Semolina, saffron', '₹89'],
          ['Masala Chaas', 'Spiced buttermilk', '₹59'],
          ['Filter Coffee', 'South Indian style', '₹49']
        ], 'r', '9') }
    ];

    var leavesHtml = leaves.map(function (l, i) {
      return '<div class="fb-page" style="z-index:' + (leaves.length - i) + '">' +
        '<div class="face front">' + l.front + '</div>' +
        '<div class="face back">' + l.back + '</div>' +
      '</div>';
    }).join('');

    return '' +
    '<section style="padding-bottom:0"><div class="container section-head center">' +
      '<p class="kicker">Take your time</p><h2>The full menu</h2>' + SWOOSH_CENTER +
      '<p>Click a page corner, use the arrows, or swipe on mobile. Placeholder pricing shown in ₹ — final menu and photos to be swapped in.</p>' +
    '</div></section>' +

    '<section><div class="flipbook-wrap"><div class="flipbook" id="flipbook">' +
      '<div class="fb-static">' +
        '<div class="side left" aria-hidden="true"><p class="menu-cat">Welcome</p><p style="font-size:0.85rem;color:var(--ink-soft)">Every dish here is cooked to order in small batches — expect a short wait on weekends, it\'s worth it. Ask your server about today\'s specials, they\'re not always on the page.</p><p class="menu-page-num l">i</p></div>' +
        '<div class="side right" aria-hidden="true"><p class="menu-cat">Thank you</p><p style="font-size:0.85rem;color:var(--ink-soft)">Prices are inclusive of taxes. Ask about our family combos and birthday specials. We hope to see you again soon.</p><p style="font-size:0.8rem;margin-top:1.2rem"><strong>Ready to visit?</strong></p><a href="#/contact/reserve" class="btn btn-primary" style="margin-top:0.6rem;padding:0.6rem 1.1rem;font-size:0.82rem">Book a table</a><p class="menu-page-num r">ii</p></div>' +
      '</div>' +
      leavesHtml +
    '</div>' +
      '<div class="flip-controls"><button class="flip-btn" data-flip-prev aria-label="Previous page">&#8592;</button><span class="flip-count" data-flip-count>0 / ' + leaves.length + '</span><button class="flip-btn" data-flip-next aria-label="Next page">&#8594;</button></div>' +
      '<p class="placeholder-flag">Sample menu &amp; pricing — will be replaced with the real menu</p>' +
    '</div></section>' +

    '<section class="band-red"><div class="container cta-band"><h2>Something here sound good?</h2><p>Call ahead on weekends, or just walk in — we\'ll find you a table.</p><div class="cta-actions"><a href="#/contact/reserve" class="btn btn-gold">Reserve a table</a></div></div></section>';
  }

  function initMenu(container) {
    var flipbook = container.querySelector('#flipbook');
    if (!flipbook) return;
    var pages = Array.prototype.slice.call(flipbook.querySelectorAll('.fb-page'));
    var nextBtn = container.querySelector('[data-flip-next]');
    var prevBtn = container.querySelector('[data-flip-prev]');
    var counter = container.querySelector('[data-flip-count]');
    var flipped = 0;

    var update = function () {
      pages.forEach(function (p, i) {
        p.classList.toggle('flipped', i < flipped);
        p.style.zIndex = i < flipped ? (i + 1) : (pages.length - i);
      });
      if (prevBtn) prevBtn.disabled = flipped === 0;
      if (nextBtn) nextBtn.disabled = flipped === pages.length;
      if (counter) counter.textContent = flipped + ' / ' + pages.length;
    };
    var goNext = function () { if (flipped < pages.length) { flipped++; update(); } };
    var goPrev = function () { if (flipped > 0) { flipped--; update(); } };

    if (nextBtn) nextBtn.addEventListener('click', goNext);
    if (prevBtn) prevBtn.addEventListener('click', goPrev);
    pages.forEach(function (p, i) {
      p.addEventListener('click', function () { if (!p.classList.contains('flipped') && i === flipped) goNext(); });
    });
    flipbook.querySelectorAll('.fb-static .side').forEach(function (side) {
      side.addEventListener('click', function () { side.classList.contains('right') ? goNext() : goPrev(); });
    });
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

  /* =======================================================
     GALLERY
     ======================================================= */
  function galleryView() {
    var photos = [
      ['nlfr-g1', 700, 900, 'Dining room at Next Level Family Restaurant', 'tall'],
      ['nlfr-g2', 900, 560, 'Family table set for a meal', 'wide'],
      ['nlfr-g3', 500, 500, 'Tandoor chicken plated', ''],
      ['nlfr-g4', 500, 500, 'Chef preparing dosa on the tawa', ''],
      ['nlfr-g5', 900, 560, 'Biryani handi being opened at the table', 'wide'],
      ['nlfr-g6', 700, 900, 'Family celebrating a birthday at the restaurant', 'tall'],
      ['nlfr-g7', 500, 500, 'Fresh spices and ingredients', ''],
      ['nlfr-g8', 500, 500, 'Dessert spread of gulab jamun and kesari', '']
    ];
    var grid = photos.map(function (p, i) {
      var full = 'https://picsum.photos/seed/' + p[0] + '/1200/1200';
      return '<button data-gallery-item data-full="' + full + '" aria-label="View full image ' + (i + 1) + '" class="' + p[4] + '">' +
        '<img data-src="https://picsum.photos/seed/' + p[0] + '/' + p[1] + '/' + p[2] + '" alt="' + p[3] + '" width="' + p[1] + '" height="' + p[2] + '" loading="lazy" decoding="async">' +
      '</button>';
    }).join('');

    return '' +
    '<section style="padding-bottom:1rem"><div class="container section-head center">' +
      '<p class="kicker">A look inside</p><h2>The dining room, the kitchen, the food</h2>' + SWOOSH_CENTER +
      '<p>Placeholder photography — swap in real shots of the space and dishes when ready.</p>' +
    '</div></section>' +
    '<section style="padding-top:0"><div class="container"><div class="gallery-grid">' + grid + '</div></div></section>' +
    '<section class="band-red"><div class="container cta-band"><h2>Come see it for yourself</h2><p>Photos only tell half the story — the rest is best enjoyed at the table.</p><div class="cta-actions"><a href="#/contact/reserve" class="btn btn-gold">Reserve a table</a></div></div></section>' +
    '<div class="lightbox"><button class="lightbox-close" aria-label="Close">&#10005;</button><button class="lightbox-nav prev" aria-label="Previous image">&#8249;</button><img src="" alt=""><button class="lightbox-nav next" aria-label="Next image">&#8250;</button></div>';
  }

  var galleryKeyHandler = null;

  function initGallery(container) {
    var buttons = container.querySelectorAll('[data-gallery-item]');
    var lightbox = container.querySelector('.lightbox');
    if (!buttons.length || !lightbox) return;
    // The router re-runs this every time the gallery route is opened.
    // Drop the previous document-level handler so they don't pile up.
    if (galleryKeyHandler) document.removeEventListener('keydown', galleryKeyHandler);
    var lbImg = lightbox.querySelector('img');
    var idx = 0;
    var items = Array.prototype.map.call(buttons, function (b) {
      return { full: b.getAttribute('data-full'), alt: b.querySelector('img').alt };
    });
    var show = function (i) { idx = (i + items.length) % items.length; lbImg.src = items[idx].full; lbImg.alt = items[idx].alt; };
    var open = function (i) { show(i); lightbox.classList.add('open'); document.body.style.overflow = 'hidden'; };
    var close = function () { lightbox.classList.remove('open'); document.body.style.overflow = ''; };
    buttons.forEach(function (btn, i) { btn.addEventListener('click', function () { open(i); }); });
    lightbox.querySelector('.lightbox-close').addEventListener('click', close);
    lightbox.querySelector('.lightbox-nav.prev').addEventListener('click', function () { show(idx - 1); });
    lightbox.querySelector('.lightbox-nav.next').addEventListener('click', function () { show(idx + 1); });
    lightbox.addEventListener('click', function (e) { if (e.target === lightbox) close(); });
    galleryKeyHandler = function (e) {
      if (!lightbox.classList.contains('open')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') show(idx + 1);
      if (e.key === 'ArrowLeft') show(idx - 1);
    };
    document.addEventListener('keydown', galleryKeyHandler);
  }

  /* =======================================================
     ABOUT
     ======================================================= */
  function aboutView() {
    return '' +
    '<section><div class="container split">' +
      '<div><p class="kicker">Our story</p><h1 style="font-size:clamp(2.2rem,4.5vw,3.2rem)">A family table that grew into a restaurant</h1>' + SWOOSH +
      '<p>Next Level Family Restaurant didn\'t start with a business plan — it started with a family that liked cooking too much food for too many people. Neighbours became regulars, regulars asked for a proper menu, and eventually a proper menu needed a proper kitchen.</p>' +
      '<p>What hasn\'t changed is who\'s doing the cooking: the same hands, the same spice blends ground fresh each week, and the same habit of sending a little extra to the table "just to try."</p></div>' +
      '<div class="split-media"><img data-src="https://picsum.photos/seed/nlfr-story1/700/840" alt="The kitchen team at Next Level Family Restaurant" width="700" height="840" loading="lazy" decoding="async"></div>' +
    '</div></section>' +

    '<section style="background:var(--cream-dim)"><div class="container split reverse">' +
      '<div><p class="kicker">What we believe</p><h2>Not a five-star restaurant. A better family one.</h2>' + SWOOSH +
      '<p>We\'re not chasing tasting menus or tweezer plating. The goal here is simpler: cook properly, serve generously, and make sure a table of eight — kids included — all find something they actually want to eat.</p>' +
      '<p class="pull-quote">"You should leave a little too full and already planning your next visit."</p></div>' +
      '<div class="split-media"><img data-src="https://picsum.photos/seed/nlfr-story2/700/840" alt="Family enjoying a meal together at the restaurant" width="700" height="840" loading="lazy" decoding="async"></div>' +
    '</div></section>' +

    '<section><div class="container">' +
      '<div class="section-head center"><p class="kicker">How we cook</p><h2>A few things we don\'t compromise on</h2>' + SWOOSH_CENTER + '</div>' +
      '<div class="dish-grid">' +
        dish('wide', 'nlfr-value1', 700, 525, 'Fresh vegetables and spices being prepared', null, 'Fresh, every morning', 'Nothing pre-made and frozen') +
        dish('wide', 'nlfr-value2', 700, 525, 'Spice blends being ground in-house', null, 'Ground spice blends', 'Not bottled masala') +
        dish('wide', 'nlfr-value3', 700, 525, 'Family dining together', null, 'Portions for sharing', 'Built for a full table') +
      '</div>' +
    '</div></section>' +

    '<section class="band-red"><div class="container cta-band">' +
      '<h2>Come meet the family behind the food</h2><p>We\'re usually around the dining room, not hiding in a back office.</p>' +
      '<div class="cta-actions"><a href="#/contact/reserve" class="btn btn-gold">Reserve a table</a><a href="#/contact" class="btn btn-ghost" style="border-color:#fff;color:#fff">Get directions</a></div>' +
    '</div></section>';
  }

  /* =======================================================
     CONTACT
     ======================================================= */
  function contactView() {
    return '' +
    '<section style="padding-bottom:1rem"><div class="container section-head center">' +
      '<p class="kicker">Come hungry</p><h1 style="font-size:clamp(2.2rem,4.5vw,3.2rem)">Find us, or book ahead</h1>' + SWOOSH_CENTER +
      '<p>Walk-ins welcome any time — a call ahead helps on weekends and holidays.</p>' +
    '</div></section>' +

    '<section style="padding-top:0"><div class="container loc-grid">' +
      '<div><h2 style="font-size:1.5rem">Hours</h2>' +
        '<table class="hours-table"><tr><td>Monday – Friday</td><td>11:00 AM – 10:30 PM</td></tr><tr><td>Saturday – Sunday</td><td>11:00 AM – 11:00 PM</td></tr></table>' +
        '<p class="placeholder-flag">Placeholder hours — confirm and update</p>' +
        '<h2 style="font-size:1.5rem;margin-top:2rem">Get in touch</h2>' +
        '<div class="info-line"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg><span>Address on request — placeholder, to be confirmed with the exact location</span></div>' +
        '<div class="info-line"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg><span>+91 00000 00000 — placeholder phone number</span></div>' +
        '<div class="info-line"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg><span>hello@nextlevelfamilyrestaurant.example — placeholder email</span></div>' +
        '<a href="tel:+910000000000" class="btn btn-primary mt-lg">Call the restaurant</a>' +
      '</div>' +
      '<div class="map-frame"><iframe src="https://www.google.com/maps?q=Next+Level+Family+Restaurant&output=embed" allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Map to Next Level Family Restaurant"></iframe></div>' +
    '</div></section>' +

    '<section id="reserve" style="background:var(--cream-dim)"><div class="container">' +
      '<div class="section-head center"><p class="kicker">Reserve a table</p><h2>We\'ll have it ready for you</h2>' + SWOOSH_CENTER +
      '<p>This form is a working demo — connect it to email, WhatsApp or a booking system when you\'re ready to go live.</p></div>' +
      '<form class="form-grid" style="max-width:760px;margin:0 auto" data-reserve-form>' +
        '<div><label for="name">Full name</label><input id="name" name="name" type="text" required placeholder="Your name"></div>' +
        '<div><label for="phone">Phone number</label><input id="phone" name="phone" type="tel" required placeholder="+91 00000 00000"></div>' +
        '<div><label for="date">Date</label><input id="date" name="date" type="date" required></div>' +
        '<div><label for="time">Time</label><input id="time" name="time" type="time" required></div>' +
        '<div><label for="guests">Guests</label><select id="guests" name="guests"><option>2</option><option>3</option><option>4</option><option>5</option><option>6</option><option>7+</option></select></div>' +
        '<div><label for="occasion">Occasion (optional)</label><select id="occasion" name="occasion"><option value="">None</option><option>Birthday</option><option>Anniversary</option><option>Family gathering</option></select></div>' +
        '<div class="full"><label for="notes">Special requests</label><textarea id="notes" name="notes" placeholder="Allergies, seating preference, anything else we should know"></textarea></div>' +
        '<div class="full tac"><button type="submit" class="btn btn-primary">Request a table</button><p class="form-note">We\'ll confirm by phone shortly after you submit.</p><div class="form-success">✓ Thanks! Your request has been noted — we\'ll call to confirm.</div></div>' +
      '</form>' +
    '</div></section>';
  }

  function initContact(container, anchor) {
    var form = container.querySelector('[data-reserve-form]');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var success = container.querySelector('.form-success');
        if (success) { success.classList.add('show'); success.setAttribute('role', 'status'); }
        form.reset();
      });
    }
    if (anchor) {
      var el = container.querySelector('#' + anchor);
      if (el) window.setTimeout(function () { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 80);
    }
  }

  /* ---------- Registry ---------- */
  NL.views = {
    '/': { title: 'Next Level Family Restaurant — Home-style dining, taken up a notch', render: homeView },
    '/menu': { title: 'Menu — Next Level Family Restaurant', render: menuView, init: initMenu },
    '/gallery': { title: 'Gallery — Next Level Family Restaurant', render: galleryView, init: initGallery },
    '/about': { title: 'Our Story — Next Level Family Restaurant', render: aboutView },
    '/contact': { title: 'Visit Us — Next Level Family Restaurant', render: contactView, init: initContact }
  };
})();
