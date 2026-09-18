/* On-page assistant — a small retrieval engine that answers from the
   site's OWN data: the LIVE POS menu (fetched by the widget from
   /api/menu-brief) and the details in lib/site.ts, plus curated facts
   about the restaurant. No API key: it tokenises the question, scores it
   against intents and every menu item, and returns the best match.

   Dish names and prices are never hardcoded here — they come from the
   POS catalog, so the bot can't quote a stale price. */

import { site } from "./site";

/** One dish, as the widget receives it from /api/menu-brief. */
export type KbMenuItem = {
  name: string;
  desc: string;
  price: string;
  section: string;
  available: boolean;
};

export type Action = { label: string; href: string };
export type Answer = { text: string; action?: Action };

/* ---------- curated facts about the place ---------- */
const hoursText = site.hours.map((h) => `${h.day}: ${h.time}`).join("; ");

const FACTS: {
  id: string;
  triggers: string[];
  text: string;
  action?: Action;
}[] = [
  {
    id: "greeting",
    triggers: ["hi", "hello", "hey", "namaste", "good morning", "good evening", "good afternoon"],
    text: "Namaste! I'm the Next Level assistant. Ask me about the menu, prices, hours, the garden seating, or booking a table.",
  },
  {
    id: "hours",
    triggers: ["hour", "open", "opening", "close", "closing", "timing", "time", "when are you open", "what time"],
    text: `We are open ${hoursText}. Call ahead on weekends and we will keep a table for you.`,
    action: { label: "See Visit Us", href: "/contact" },
  },
  {
    id: "location",
    triggers: ["where", "address", "location", "located", "directions", "map", "how to reach", "how do i get", "find you", "area", "bengaluru", "bangalore", "highway"],
    text: `We're a highway-side family restaurant near Bengaluru. ${site.address.line2}. Tap below for the map.`,
    action: { label: "Open map", href: "/contact" },
  },
  {
    id: "phone",
    triggers: ["phone", "number", "call", "contact", "mobile", "whatsapp", "reach you"],
    text: `Call or WhatsApp us on ${site.phoneDisplay}.`,
    action: { label: "Call / WhatsApp", href: site.phoneHref },
  },
  {
    id: "email",
    triggers: ["email", "mail", "e-mail", "gmail"],
    text: `Email us at ${site.email}.`,
    action: { label: "Email", href: `mailto:${site.email}` },
  },
  {
    id: "reserve",
    triggers: ["book", "booking", "reserve", "reservation", "table", "seat", "reserve a table", "hold a table", "party of"],
    text: "You can request a table on our form — add your date, time and number of guests and we'll call to confirm, or send it to us on WhatsApp.",
    action: { label: "Open reservation form", href: "/contact#reserve" },
  },
  {
    id: "parking",
    triggers: ["parking", "park", "car park", "two wheeler", "bike", "scooter", "vehicle"],
    text: "There's open parking on the stone-paved forecourt right in front — plenty of room for cars and two-wheelers.",
  },
  {
    id: "garden",
    triggers: ["garden", "outdoor", "outside", "open air", "al fresco", "verandah", "veranda", "seating", "ambience", "ambiance", "atmosphere", "family seating", "kids play"],
    text: "Yes — there's a garden seating area with hanging flower pots, plus the painted Warli verandah. Ask for outdoor seating when you arrive.",
    action: { label: "See the space", href: "/gallery" },
  },
  {
    id: "chai",
    triggers: ["chai", "tea", "tandoori chai", "kulhad", "clay pot", "juice", "fresh juice", "beverage", "drink", "coffee", "filter coffee", "lassi"],
    text: "Our Tandoori Chai — smoked in a hot clay pot — is what people stop for. There's a Fresh Juice counter as well.",
    action: { label: "See drinks on the menu", href: "/menu" },
  },
  {
    id: "delivery",
    triggers: ["delivery", "deliver", "takeaway", "take away", "parcel", "online order", "swiggy", "zomato", "home delivery"],
    text: "We're dine-in: order ahead on the menu page, pay a 50% advance, and your food is ready when you walk in — you settle the balance after your meal. We're not on the delivery apps; for takeaway just call us.",
    action: { label: "Order ahead for dine-in", href: "/menu" },
  },
  {
    id: "kids",
    triggers: ["kid", "kids", "child", "children", "family friendly", "baby", "high chair", "toddler"],
    text: "Absolutely — we're a family restaurant through and through. High chairs and half portions for kids are available on request.",
  },
  {
    id: "veg",
    triggers: ["veg", "vegetarian", "pure veg", "vegan", "no meat", "veg options", "veg menu"],
    text: "Plenty of vegetarian — whole sections of the menu are veg, from starters and soups to curries, biryani and South Indian. Ask me about any dish by name for today's price.",
    action: { label: "See full menu", href: "/menu" },
  },
  {
    id: "nonveg",
    triggers: ["non veg", "nonveg", "non-veg", "meat", "chicken", "mutton", "prawn", "prawns", "egg", "fish"],
    text: "Lots of non-veg — tandoor grills, chicken and mutton gravies, biryani, seafood and egg dishes. Ask me about any dish by name for today's price.",
    action: { label: "See full menu", href: "/menu" },
  },
  {
    id: "signature",
    triggers: ["recommend", "recommendation", "best", "signature", "special", "must try", "popular", "famous", "favourite", "favorite", "what should i order", "what is good"],
    text: "Ask me about any dish by name and I'll give you today's price. The tandoor grills, biryanis, Naati-style home food and the clay-pot Tandoori Chai are what regulars come back for.",
    action: { label: "See full menu", href: "/menu" },
  },
  {
    id: "about",
    triggers: ["story", "history", "who owns", "family owned", "warli", "mural", "murals", "painting", "paintings", "art", "about", "who runs", "how old"],
    text: "We started as a family cooking too much food for too many people. It grew into a family restaurant with hand-painted Warli walls, folk murals and a garden. Same family, same recipes.",
    action: { label: "Read our story", href: "/about" },
  },
  {
    id: "menu",
    triggers: ["menu", "what do you serve", "what do you have", "food", "eat", "dishes", "cuisine", "what kind of food"],
    text: "The full menu — with today's live prices — is on the Menu page. You can order ahead there with a 50% advance so it's ready when you arrive. Ask me about any dish by name too.",
    action: { label: "Open the menu", href: "/menu" },
  },
  {
    id: "thanks",
    triggers: ["thank", "thanks", "thank you", "appreciate", "great", "perfect", "awesome"],
    text: "You're welcome! Anything else I can help with?",
  },
];

const FALLBACK =
  "I don't have an exact answer for that yet — our team can help directly on " +
  site.phoneDisplay +
  ". Try asking about hours, a dish, prices, the garden, or booking a table.";

export const GREETING = FACTS[0].text;

export const SUGGESTIONS = [
  { label: "Hours?", text: "What are your hours?" },
  { label: "Price of biryani?", text: "How much is the biryani?" },
  { label: "Veg options", text: "What are the veg options?" },
  { label: "Garden seating?", text: "Do you have garden seating?" },
  { label: "Book a table", text: "I want to book a table" },
];

/* ---------- tiny NLP helpers ---------- */
const STOP = new Set([
  "the", "a", "an", "is", "are", "do", "does", "you", "your", "i", "we",
  "to", "of", "for", "and", "or", "on", "at", "in", "me", "my", "can",
  "have", "has", "any", "some", "there", "it", "what", "whats", "how",
  "much", "many", "please", "tell", "about", "with", "get",
]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
}

function searchMenu(q: string, items: KbMenuItem[]) {
  const t = tokens(q);
  if (!t.length || !items.length) return [];
  return items
    .map((it) => ({ ...it, hay: `${it.name} ${it.desc} ${it.section}`.toLowerCase() }))
    .map((it) => {
    let score = 0;
    for (const w of t) {
      if (it.name.toLowerCase().includes(w)) score += 3;
      else if (it.hay.includes(w)) score += 1;
    }
      return { it, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((r) => r.it);
}

/* ---------- veg / non-veg, worked out from the live catalog ----------
   The bot must never name a dish that isn't on the menu card, so the
   examples in a diet answer are read off the POS catalog the widget
   fetched, not written down here. Classification is deliberately
   conservative: an explicitly veg section wins, then any non-veg marker,
   then a veg marker; anything else is left out of the examples. */
const EXPLICIT_VEG_SECTION = /\bveg\b|vegetarian/i;
const NONVEG =
  /non[\s-]?veg|chicken|mutton|prawn|fish|seafood|crab|squid|\begg\b|keema|lamb|beef|kebab|tangdi|liver/i;
const VEG_MARKER =
  /\bveg\b|vegetarian|paneer|gobi|mushroom|aloo|potato|\bdal\b|chana|soya|babycorn|\bcorn\b|tofu|palak|bhindi|dosa|idli|vada|uttapam|uthappam|salad|kofta/i;

function dietOf(it: KbMenuItem): "veg" | "nonveg" | "unknown" {
  const section = it.section ?? "";
  if (EXPLICIT_VEG_SECTION.test(section) && !/non[\s-]?veg/i.test(section)) {
    return "veg";
  }
  const hay = `${section} ${it.name}`;
  if (NONVEG.test(hay)) return "nonveg";
  if (VEG_MARKER.test(hay)) return "veg";
  return "unknown";
}

/** Up to five available dishes for a diet, spread across sections. */
export function dietExamples(
  items: KbMenuItem[],
  want: "veg" | "nonveg",
): string[] {
  const picked: string[] = [];
  const usedSections = new Set<string>();
  for (const it of items) {
    if (it.available === false || dietOf(it) !== want) continue;
    if (usedSections.has(it.section)) continue;
    usedSections.add(it.section);
    picked.push(it.name);
    if (picked.length === 5) break;
  }
  return picked;
}

function bestFact(q: string) {
  const t = tokens(q);
  const raw = q.toLowerCase();
  let best: (typeof FACTS)[number] | null = null;
  let bestScore = 0;
  for (const f of FACTS) {
    let score = 0;
    for (const trig of f.triggers) {
      if (raw.includes(trig)) score += trig.split(" ").length * 2;
      else if (t.includes(trig)) score += 2;
    }
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best && bestScore > 0 ? best : null;
}

/* ---------- the one entry point the UI calls ---------- */
/* `items` is the live POS catalog the widget fetched. Pass [] before it
   has loaded — dish questions then point at the menu page rather than
   guessing a price. */
export function answer(query: string, items: KbMenuItem[] = []): Answer {
  const q = query.trim();
  if (!q) return { text: FALLBACK };

  /* Word boundaries per-word, not around the whole group — "₹" is not a
     word character, so a trailing \b would never match after it. */
  const priceIntent =
    /\bprice\b|\bcost\b|how much|\brate\b|\bcharge\b|\brs\b|\brupees\b|₹/i.test(q);
  const hits = searchMenu(q, items);
  const fact = bestFact(q);

  // A dish was named — answer with the dish(es) and today's price(s).
  if (hits.length && (priceIntent || !fact)) {
    if (hits.length === 1) {
      const d = hits[0];
      const soldOut = d.available ? "" : " (sold out right now)";
      const desc = d.desc ? ` ${d.desc}.` : "";
      return {
        text: `${d.name} — ${d.price}${soldOut}.${desc} You'll find it under ${d.section}.`,
        action: { label: "Order it", href: "/menu" },
      };
    }
    const list = hits.map((d) => `${d.name} (${d.price})`).join(", ");
    return {
      text: `A few that match: ${list}.`,
      action: { label: "Open the menu", href: "/menu" },
    };
  }

  // Diet questions name real dishes only if the live catalog backs them.
  if (fact && (fact.id === "veg" || fact.id === "nonveg") && items.length) {
    const examples = dietExamples(items, fact.id === "veg" ? "veg" : "nonveg");
    if (examples.length) {
      return {
        text: `${fact.text} On the menu right now: ${examples.join(", ")}.`,
        action: fact.action,
      };
    }
  }

  if (fact) return { text: fact.text, action: fact.action };

  if (hits.length) {
    const list = hits.map((d) => `${d.name} (${d.price})`).join(", ");
    return {
      text: `We have: ${list}.`,
      action: { label: "Open the menu", href: "/menu" },
    };
  }

  // Sounds like a dish question but the catalog isn't loaded / has no match.
  if (priceIntent) {
    return {
      text: "Today's dishes and prices are all on the menu page — they come straight from the kitchen's system, so they're always current.",
      action: { label: "Open the menu", href: "/menu" },
    };
  }

  return { text: FALLBACK };
}
