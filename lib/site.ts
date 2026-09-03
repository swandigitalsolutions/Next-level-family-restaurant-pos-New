/* Central site configuration — name, contact, hours, navigation.
   Everything a launch needs to update lives here, not in components.
   Values marked PLACEHOLDER are safe to ship but should be confirmed. */

export const site = {
  name: "Next Level Family Restaurant",
  tagline: "",
  blurb:
    "A family-run restaurant serving home-style South & North Indian food, tandoor grills and fresh juice — with hand-painted folk-art walls and a garden to sit in.",
  phoneDisplay: "+91 90710 80138",
  phoneHref: "tel:+919071080138",
  whatsappHref: "https://wa.me/919071080138",
  email: "nextlevelfamilyrestaurant@gmail.com",
  domain: "nextlevelfamilyrestaurant.com",
  url: "https://nextlevelfamilyrestaurant.com",
  address: {
    line1: "Next Level Family Restaurant",
    line2: "Highway-side, near Bengaluru — full address on request",
    mapQuery: "Next Level Family Restaurant",
  },
  hours: [
    { day: "Monday – Friday", time: "11:00 AM – 10:30 PM" },
    { day: "Saturday – Sunday", time: "11:00 AM – 11:00 PM" },
  ],
  hoursNote: "Placeholder hours — the team will confirm final timings.",
  socials: [
    { label: "Instagram", short: "IG", href: "#" },
    { label: "Facebook", short: "FB", href: "#" },
    { label: "WhatsApp", short: "WA", href: "https://wa.me/919071080138" },
  ],
  credit: "Website by Swan Digital Solution",
} as const;

export const nav = [
  { label: "Home", href: "/" },
  { label: "Menu", href: "/menu" },
  { label: "Gallery", href: "/gallery" },
  { label: "Our Story", href: "/about" },
  { label: "Visit Us", href: "/contact" },
] as const;
