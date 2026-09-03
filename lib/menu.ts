/* Menu content. Placeholder dishes and sample pricing in ₹ —
   swap for the real menu before launch. Prices are strings so
   "half / full" style entries work too. */

export type MenuItem = { name: string; desc: string; price: string };
export type MenuSection = { category: string; items: MenuItem[] };

export const menu: MenuSection[] = [
  {
    category: "Starters",
    items: [
      { name: "Veg Manchow Soup", desc: "Crisp fried noodles on top", price: "₹149" },
      { name: "Chicken Tandoori Wings", desc: "Half / full plate", price: "₹289" },
      { name: "Paneer 65", desc: "Curry-leaf tempered", price: "₹259" },
      { name: "Corn & Spinach Kebab", desc: "Pan-seared, mint chutney", price: "₹229" },
      { name: "Prawn Koliwada", desc: "Rava-crusted, fried", price: "₹339" },
    ],
  },
  {
    category: "Tandoor & Grills",
    items: [
      { name: "Tandoori Chicken", desc: "Half / full", price: "₹399" },
      { name: "Malai Chicken Tikka", desc: "Cream & cheese marinade", price: "₹359" },
      { name: "Paneer Tikka", desc: "Bell pepper, onion", price: "₹289" },
      { name: "Seekh Kebab", desc: "Mutton or chicken", price: "₹359" },
      { name: "Tandoori Prawns", desc: "Ajwain marinade", price: "₹429" },
    ],
  },
  {
    category: "South Indian Specials",
    items: [
      { name: "Next Level Special Thali", desc: "Unlimited, changes daily", price: "₹289" },
      { name: "Butter Masala Dosa", desc: "Sambar, 2 chutneys", price: "₹159" },
      { name: "Mysore Bonda Idli", desc: "Steamed, ghee roast", price: "₹129" },
      { name: "Bisi Bele Bath", desc: "Lentils, vegetables, ghee", price: "₹169" },
    ],
  },
  {
    category: "North Indian Curries",
    items: [
      { name: "Paneer Butter Masala", desc: "Tomato-cashew gravy", price: "₹269" },
      { name: "Dal Makhani", desc: "Slow-cooked overnight", price: "₹219" },
      { name: "Chicken Curry", desc: "Home-style masala", price: "₹319" },
      { name: "Mutton Rogan Josh", desc: "Kashmiri spice", price: "₹389" },
      { name: "Malai Kofta", desc: "Cashew gravy", price: "₹259" },
    ],
  },
  {
    category: "Biryani & Rice",
    items: [
      { name: "Chicken Dum Biryani", desc: "Served with raita", price: "₹329" },
      { name: "Mutton Dum Biryani", desc: "Served with raita", price: "₹389" },
      { name: "Veg Dum Biryani", desc: "Mixed vegetable", price: "₹249" },
      { name: "Jeera Rice", desc: "Steamed basmati", price: "₹149" },
    ],
  },
  {
    category: "Chinese Corner",
    items: [
      { name: "Veg / Chicken Fried Rice", desc: "Wok-tossed", price: "₹219" },
      { name: "Gobi Manchurian", desc: "Dry or gravy", price: "₹229" },
      { name: "Chilli Chicken", desc: "Dry or gravy", price: "₹279" },
      { name: "Hakka Noodles", desc: "Veg or chicken", price: "₹219" },
    ],
  },
  {
    category: "Breads",
    items: [
      { name: "Tandoori Roti", desc: "Plain or butter", price: "₹35" },
      { name: "Garlic Naan", desc: "Stone-baked", price: "₹69" },
      { name: "Laccha Paratha", desc: "Layered, ghee", price: "₹65" },
      { name: "Cheese Kulcha", desc: "Stuffed", price: "₹99" },
    ],
  },
  {
    category: "Fresh Juice, Chai & Desserts",
    items: [
      { name: "Tandoori Chai", desc: "Clay-pot smoked, our specialty", price: "₹59" },
      { name: "Fresh Seasonal Juice", desc: "Ask for today's fruit", price: "₹89" },
      { name: "Gulab Jamun (2 pcs)", desc: "Warm, with rabri", price: "₹99" },
      { name: "Filter Coffee", desc: "South Indian style", price: "₹49" },
    ],
  },
];
