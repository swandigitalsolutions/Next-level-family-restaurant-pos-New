/* Every image the site shows, in one place.

   Each entry points at a file in /public/images. The venue photos
   (venue-*, mural-*, garden-*, juice-*) are currently TEMPORARY
   stand-ins — replace the files in /public/images with the real
   restaurant photos (keep the same filename) and the whole site
   updates. See /public/images/README.md for the shot list and the
   recommended crop for each slot.

   Aspect ratios below match how the slot is displayed, so a
   correctly-cropped photo drops in with no layout shift. */

export type Img = { src: string; alt: string; w: number; h: number };

export const img = {
  // ---- The venue (real photos of the restaurant) ----
  venueHero: {
    src: "/images/venue-hero.jpg",
    alt: "The Next Level Family Restaurant building with its red roof and painted mural wall",
    w: 1600,
    h: 1200,
  },
  venueFacade: {
    src: "/images/venue-facade.jpg",
    alt: "Brick front of the restaurant with the Indian tricolour painted pillars and red tin roof",
    w: 1200,
    h: 1400,
  },
  venueGate: {
    src: "/images/venue-gate.jpg",
    alt: "Entrance archway with the bilingual Next Level Family Restaurant sign",
    w: 1600,
    h: 1000,
  },
  venueInterior: {
    src: "/images/venue-interior.jpg",
    alt: "Dining hall with a hand-painted temple-and-forest mural and wood-panelled ceiling",
    w: 1600,
    h: 1000,
  },
  muralWarliWoman: {
    src: "/images/mural-warli-woman.jpg",
    alt: "Folk-art mural of a woman carrying a pot, painted on the restaurant wall",
    w: 1200,
    h: 1400,
  },
  muralWarliWall: {
    src: "/images/mural-warli-wall.jpg",
    alt: "Warli tribal art painted in white on the deep-red outer wall",
    w: 1600,
    h: 1000,
  },
  gardenPergola: {
    src: "/images/garden-pergola.jpg",
    alt: "Garden seating area with hanging flower pots on rope-wrapped pergola frames",
    w: 1600,
    h: 1000,
  },
  juiceStall: {
    src: "/images/juice-stall.jpg",
    alt: "The painted Fresh Juice and Tandoori Chai counter",
    w: 1200,
    h: 1400,
  },

  // ---- Food (still need real dish photos — temporary stand-ins) ----
  foodThali: { src: "/images/food-thali.jpg", alt: "A spread of rice, curries and sides on the table", w: 1000, h: 1000 },
  foodDosa: { src: "/images/food-dosa.jpg", alt: "Crisp masala dosa with chutneys", w: 900, h: 1040 },
  foodTandoori: { src: "/images/food-tandoori.jpg", alt: "Tandoori chicken fresh off the grill", w: 900, h: 1040 },
  foodBiryani: { src: "/images/food-biryani.jpg", alt: "Hyderabadi-style dum biryani served with raita", w: 1100, h: 830 },
  foodPaneer: { src: "/images/food-paneer.jpg", alt: "A paneer curry served in a copper handi", w: 1100, h: 830 },
  foodDessert: { src: "/images/food-dessert.jpg", alt: "A warm Indian dessert", w: 1100, h: 830 },
} satisfies Record<string, Img>;

/* The gallery grid — ordered. `span` controls the grid footprint. */
export const galleryImages: (Img & { span: "" | "tall" | "wide" })[] = [
  { ...img.venueGate, span: "wide" },
  { ...img.muralWarliWoman, span: "tall" },
  { ...img.gardenPergola, span: "" },
  { ...img.juiceStall, span: "" },
  { ...img.muralWarliWall, span: "wide" },
  { ...img.venueInterior, span: "" },
  { ...img.venueFacade, span: "tall" },
  { ...img.venueHero, span: "" },
];
