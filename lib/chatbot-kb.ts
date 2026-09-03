/* On-page assistant — a small retrieval engine that answers from the
   site's OWN data: the menu in lib/menu.ts and the details in
   lib/site.ts, plus a set of curated facts about the dhaba. Fully
   client-side, no API key: it tokenises the question, scores it against
   intents and every menu item, and returns the best match.

   Add a fact: drop it in FACTS. Add a dish: it's already searchable
   the moment it's in lib/menu.ts. */

import { menu } from "./menu";
import { site } from "./site";

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
    text: `We're open ${hoursText}. (Placeholder hours — the team will confirm final timings.)`,
    action: { label: "See Visit Us", href: "/contact" },
  },
  {
    id: "location",
    triggers: ["where", "address", "location", "located", "directions", "map", "how to reach", "how do i get", "find you", "area", "bengaluru", "bangalore", "highway"],
    text: `We're a highway-side family dhaba near Bengaluru. ${site.address.line2}. Tap below for the map.`,
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
    text: "Our Tandoori Chai — smoked in a hot clay pot — is what people stop for. There's a Fresh Juice counter and South Indian filter coffee too.",
    action: { label: "See drinks on the menu", href: "/menu" },
  },
  {
    id: "delivery",
    triggers: ["delivery", "deliver", "takeaway", "take away", "parcel", "online order", "swiggy", "zomato", "home delivery"],
    text: "We're focused on dine-in and the dhaba experience. For takeaway, call us directly and we'll sort it out.",
    action: { label: "Call us", href: site.phoneHref },
  },
  {
    id: "kids",
    triggers: ["kid", "kids", "child", "children", "family friendly", "baby", "high chair", "toddler"],
    text: "Absolutely — we're a family restaurant through and through. High chairs and half portions for kids are available on request.",
  },
  {
    id: "veg",
    triggers: ["veg", "vegetarian", "pure veg", "vegan", "no meat", "veg options", "veg menu"],
    text: "Plenty of vegetarian: the Next Level Special Thali, Butter Masala Dosa, Veg Dum Biryani, Paneer Butter Masala, Malai Kofta, Paneer Tikka, Gobi Manchurian and more.",
    action: { label: "See full menu", href: "/menu" },
  },
  {
    id: "nonveg",
    triggers: ["non veg", "nonveg", "non-veg", "meat", "chicken", "mutton", "prawn", "prawns", "egg", "fish"],
    text: "Non-veg favourites: Tandoori Chicken, Chicken & Mutton Dum Biryani, Mutton Rogan Josh, Tandoori Prawns, Chilli Chicken and Seekh Kebab.",
    action: { label: "See full menu", href: "/menu" },
  },
  {
    id: "signature",
    triggers: ["recommend", "recommendation", "best", "signature", "special", "must try", "popular", "famous", "favourite", "favorite", "what should i order", "what is good"],
    text: "People come back for the Next Level Special Thali, Tandoori Chicken, Dum Biryani, Paneer Butter Masala — and the Tandoori Chai.",
    action: { label: "See full menu", href: "/menu" },
  },
  {
    id: "price-range",
    triggers: ["how expensive", "price range", "budget", "cost for two", "average cost", "how much for", "cheap", "costly", "expensive", "per person"],
    text: "Roughly: starters ₹99–₹430, mains ₹150–₹430, the Special Thali is ₹289 (unlimited). Sample pricing for now — full list on the Menu page.",
    action: { label: "See full menu", href: "/menu" },
  },
  {
    id: "about",
    triggers: ["story", "history", "who owns", "family owned", "warli", "mural", "murals", "painting", "paintings", "art", "about", "who runs", "how old"],
    text: "We started as a family cooking too much food for too many people. It grew into a dhaba with hand-painted Warli walls, folk murals and a garden. Same family, same recipes.",
    action: { label: "Read our story", href: "/about" },
  },
  {
    id: "menu",
    triggers: ["menu", "what do you serve", "what do you have", "food", "eat", "dishes", "cuisine", "what kind of food"],
    text: "The menu runs Starters, Tandoor & Grills, South Indian, North Indian Curries, Biryani & Rice, Chinese, Breads, and Fresh Juice / Chai / Desserts.",
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
  { label: "Price of biryani?", text: "How much is the chicken biryani?" },
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

/* Flatten the menu once for searching. */
const MENU_INDEX = menu.flatMap((section) =>
  section.items.map((it) => ({
    section: section.category,
    ...it,
    hay: `${it.name} ${it.desc} ${section.category}`.toLowerCase(),
  }))
);

function searchMenu(q: string) {
  const t = tokens(q);
  if (!t.length) return [];
  return MENU_INDEX.map((it) => {
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
export function answer(query: string): Answer {
  const q = query.trim();
  if (!q) return { text: FALLBACK };

  const priceIntent = /\b(price|cost|how much|rate|charge|rs|rupees|₹)\b/i.test(q);
  const hits = searchMenu(q);
  const fact = bestFact(q);

  // A dish was named — answer with the dish(es) and price(s).
  if (hits.length && (priceIntent || !fact)) {
    if (hits.length === 1) {
      const d = hits[0];
      return {
        text: `${d.name} — ${d.price}. ${d.desc}. (In our ${d.section} section.)`,
        action: { label: "See full menu", href: "/menu" },
      };
    }
    const list = hits.map((d) => `${d.name} (${d.price})`).join(", ");
    return {
      text: `A few that match: ${list}. Full details on the menu.`,
      action: { label: "Open the menu", href: "/menu" },
    };
  }

  if (fact) return { text: fact.text, action: fact.action };
  if (hits.length) {
    const list = hits.map((d) => `${d.name} (${d.price})`).join(", ");
    return {
      text: `We have: ${list}.`,
      action: { label: "Open the menu", href: "/menu" },
    };
  }
  return { text: FALLBACK };
}
