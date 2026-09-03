/* =========================================================
   NEXT LEVEL FAMILY RESTAURANT — chatbot.js
   A lightweight, fully client-side assistant. No server and
   no API key required — it matches questions against a small
   restaurant knowledge base so it works the moment the site
   is hosted anywhere. Swap REPLACE_ME values with real data.

   Voice:
   - Mic button uses the browser's SpeechRecognition API to
     turn speech into text (Chrome/Edge/Safari; unsupported
     browsers get a disabled button with an explanation).
   - Replies are read aloud with SpeechSynthesis; the speaker
     icon in the header toggles this on/off.
   ========================================================= */
(function () {
  'use strict';

  /* ---------------- Knowledge base ----------------
     Keep this in sync with menu.html / contact.html.
     Replace placeholder values once real details are set. */
  var KB = {
    hours: "We're open 11:00 AM – 10:30 PM Monday to Friday, and 11:00 AM – 11:00 PM on weekends. (Placeholder hours — the team will confirm final timings.)",
    address: "Our exact address is being finalised — for now, please call ahead or check the map on the Visit Us page.",
    phone: "You can reach us at +91 00000 00000 (placeholder number — will be updated with the real one).",
    email: "You can email us at hello@nextlevelfamilyrestaurant.example (placeholder).",
    reserve: "I can take you to our reservation form — just tell me the date, time and number of guests there, or call us directly and we'll hold a table.",
    parking: "There's parking available near the restaurant — ask our team for the exact spot when you call, this will be confirmed once the location is finalised.",
    delivery: "Right now we're focused on dine-in. For takeaway, it's best to call the restaurant directly and we'll sort it out for you.",
    kids: "Absolutely — we're a family restaurant through and through. High chairs and half portions for kids are available on request.",
    veg: "Plenty of vegetarian options: the Next Level Special Thali, Butter Masala Dosa, Veg Dum Biryani, Paneer Butter Masala, Malai Kofta and more are all on the menu.",
    nonveg: "Our non-veg favourites include Tandoori Chicken, Chicken Dum Biryani, Mutton Rogan Josh, Tandoori Prawns and Chilli Chicken.",
    signature: "People come back for the Next Level Special Thali, Butter Masala Dosa, Tandoori Chicken, Dum Biryani and our Paneer Butter Masala.",
    price: "Starters run about ₹99–₹340, mains ₹150–₹430, and the Special Thali is ₹289 (unlimited). Full pricing is on the Menu page — it's currently sample pricing, so treat it as a rough guide.",
    about: "We started as a family cooking too much food for too many people — regulars kept asking for a proper menu, and here we are. Same recipes, same family in the kitchen. More on the Our Story page.",
    menu: "Our menu runs Starters, Tandoor & Grills, South Indian Specials, North Indian Curries, Biryani & Rice, Chinese, Breads, and Desserts & Beverages. Want me to open the full flip-through menu?",
    greeting: "Hi there! I'm the Next Level assistant. Ask me about our menu, hours, location, or help booking a table.",
    thanks: "You're welcome! Anything else I can help with?",
    fallback: "I don't have an exact answer for that yet — our team can help directly. Try asking about our hours, menu, location, or booking a table."
  };

  var INTENTS = [
    { id: 'greeting', keywords: ['hi', 'hello', 'hey', 'good morning', 'good evening'], reply: KB.greeting },
    { id: 'hours', keywords: ['hour', 'open', 'close', 'timing', 'time do you'], reply: KB.hours },
    { id: 'address', keywords: ['address', 'location', 'where are you', 'where is', 'direction', 'map', 'find you'], reply: KB.address, action: { label: 'Open map', href: '#/contact' } },
    { id: 'phone', keywords: ['phone', 'number', 'call you', 'contact number'], reply: KB.phone, action: { label: 'Call', href: 'tel:+910000000000' } },
    { id: 'email', keywords: ['email', 'mail id', 'e-mail'], reply: KB.email },
    { id: 'reserve', keywords: ['book', 'reserve', 'reservation', 'table for', 'booking'], reply: KB.reserve, action: { label: 'Open reservation form', href: '#/contact/reserve' } },
    { id: 'parking', keywords: ['parking', 'park my car', 'park the car'], reply: KB.parking },
    { id: 'delivery', keywords: ['delivery', 'takeaway', 'take away', 'parcel', 'online order', 'swiggy', 'zomato'], reply: KB.delivery },
    { id: 'kids', keywords: ['kid', 'child', 'children', 'family friendly', 'high chair'], reply: KB.kids },
    { id: 'veg', keywords: ['vegetarian', 'veg option', 'pure veg', 'vegan'], reply: KB.veg, action: { label: 'See full menu', href: '#/menu' } },
    { id: 'nonveg', keywords: ['non veg', 'nonveg', 'chicken', 'mutton', 'prawn', 'meat'], reply: KB.nonveg, action: { label: 'See full menu', href: '#/menu' } },
    { id: 'signature', keywords: ['recommend', 'best dish', 'signature', 'special', 'must try', 'popular', 'favourite', 'favorite'], reply: KB.signature, action: { label: 'See full menu', href: '#/menu' } },
    { id: 'price', keywords: ['price', 'cost', 'how much', 'budget', 'expensive', 'cheap'], reply: KB.price, action: { label: 'See full menu', href: '#/menu' } },
    { id: 'about', keywords: ['story', 'history', 'about you', 'who owns', 'family owned'], reply: KB.about, action: { label: 'Read our story', href: '#/about' } },
    { id: 'menu', keywords: ['menu', 'dish', 'food', 'eat', 'what do you serve', 'thali', 'biryani', 'dosa'], reply: KB.menu, action: { label: 'Open the menu', href: '#/menu' } },
    { id: 'thanks', keywords: ['thank', 'thanks', 'thank you', 'appreciate'], reply: KB.thanks }
  ];

  var SUGGESTIONS = [
    { label: 'Hours?', text: 'What are your hours?' },
    { label: "What's on the menu?", text: "What's on the menu?" },
    { label: 'Book a table', text: 'I want to book a table' },
    { label: 'Where are you?', text: 'Where are you located?' }
  ];

  function matchIntent(input) {
    var q = input.toLowerCase();
    var best = null, bestScore = 0;
    INTENTS.forEach(function (intent) {
      var score = 0;
      intent.keywords.forEach(function (kw) {
        if (q.indexOf(kw) !== -1) score += kw.split(' ').length; // longer phrase matches score higher
      });
      if (score > bestScore) { bestScore = score; best = intent; }
    });
    return best;
  }

  /* ---------------- Widget wiring ---------------- */
  var root = document.getElementById('nlChatbot');
  if (!root) return;

  var fab = document.getElementById('nlChatToggle');
  var panel = document.getElementById('nlChatPanel');
  var closeBtn = document.getElementById('nlChatClose');
  var messagesEl = document.getElementById('nlChatMessages');
  var suggestionsEl = document.getElementById('nlChatSuggestions');
  var form = document.getElementById('nlChatForm');
  var input = document.getElementById('nlChatInput');
  var micBtn = document.getElementById('nlMicBtn');
  var speakToggle = document.getElementById('nlSpeakToggle');

  var speechEnabled = true;
  var greeted = false;

  function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

  function addMessage(sender, text, action) {
    var wrap = document.createElement('div');
    wrap.className = 'nl-msg ' + sender;
    var bubble = document.createElement('div');
    bubble.className = 'bubble';
    var p = document.createElement('p');
    p.textContent = text;
    bubble.appendChild(p);
    if (action) {
      var a = document.createElement('a');
      a.className = 'nl-msg-action';
      a.href = action.href;
      a.textContent = action.label;
      bubble.appendChild(a);
    }
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  function speak(text) {
    if (!speechEnabled || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      var utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1;
      utter.pitch = 1;
      window.speechSynthesis.speak(utter);
    } catch (e) { /* silently ignore unsupported environments */ }
  }

  function botReply(input) {
    var typing = document.createElement('div');
    typing.className = 'nl-typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(typing);
    scrollToBottom();

    window.setTimeout(function () {
      typing.remove();
      var intent = matchIntent(input) || { reply: KB.fallback };
      addMessage('bot', intent.reply, intent.action);
      speak(intent.reply);
    }, 450 + Math.random() * 350);
  }

  function sendMessage(text) {
    text = (text || '').trim();
    if (!text) return;
    addMessage('user', text);
    input.value = '';
    botReply(text);
  }

  function renderSuggestions() {
    suggestionsEl.innerHTML = '';
    SUGGESTIONS.forEach(function (s) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'nl-chip';
      chip.textContent = s.label;
      chip.addEventListener('click', function () { sendMessage(s.text); });
      suggestionsEl.appendChild(chip);
    });
  }

  function openPanel() {
    root.classList.add('open');
    fab.setAttribute('aria-expanded', 'true');
    panel.hidden = false;
    if (!greeted) {
      greeted = true;
      addMessage('bot', KB.greeting);
      speak(KB.greeting);
    }
    window.setTimeout(function () { input.focus(); }, 150);
  }
  function closePanel() {
    root.classList.remove('open');
    fab.setAttribute('aria-expanded', 'false');
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  fab.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && root.classList.contains('open')) closePanel();
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    sendMessage(input.value);
  });

  renderSuggestions();

  /* ---------------- Voice input (browser speech-to-text) ---------------- */
  var SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognitionCtor && micBtn) {
    var recognition = new SpeechRecognitionCtor();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    var listening = false;
    micBtn.addEventListener('click', function () {
      if (listening) { recognition.stop(); return; }
      try {
        recognition.start();
        listening = true;
        micBtn.classList.add('listening');
      } catch (e) { /* already started */ }
    });
    recognition.addEventListener('result', function (e) {
      var transcript = e.results[0][0].transcript;
      input.value = transcript;
      sendMessage(transcript);
    });
    var stopListening = function () { listening = false; micBtn.classList.remove('listening'); };
    recognition.addEventListener('end', stopListening);
    recognition.addEventListener('error', stopListening);
  } else if (micBtn) {
    micBtn.disabled = true;
    micBtn.title = "Voice input isn't supported in this browser";
  }

  /* ---------------- Voice output toggle ---------------- */
  if ('speechSynthesis' in window) {
    speakToggle.addEventListener('click', function () {
      speechEnabled = !speechEnabled;
      speakToggle.setAttribute('aria-pressed', speechEnabled ? 'true' : 'false');
      speakToggle.textContent = speechEnabled ? '\uD83D\uDD0A' : '\uD83D\uDD07';
      if (!speechEnabled) window.speechSynthesis.cancel();
    });
  } else {
    speakToggle.disabled = true;
    speakToggle.title = "Spoken replies aren't supported in this browser";
  }
})();
