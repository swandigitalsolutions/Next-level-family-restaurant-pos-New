const NOTES = [
  {
    stars: "★★★★★",
    text: "Portions are generous and nothing tastes like it came out of a factory kitchen. The thali is unbeatable value, and the tandoori chai is a reason on its own.",
    who: "Anjali R.",
    sub: "Regular, Sunday lunch",
  },
  {
    stars: "★★★★★",
    text: "Took my in-laws here for the first time and they've asked to come back three times since. The painted walls and the garden seating make it feel special.",
    who: "Praveen S.",
    sub: "Family of 6",
  },
  {
    stars: "★★★★☆",
    text: "Great for birthdays — they remembered our order from last time. Small touch, but it matters. Ask for a table in the verandah.",
    who: "Deepa & Family",
    sub: "Celebrating here since 2021",
  },
];

export default function Testimonials() {
  return (
    <div className="notes">
      {NOTES.map((n) => (
        <div className="note" key={n.who}>
          <span className="stars">{n.stars}</span>
          <p>{n.text}</p>
          <div className="who">
            {n.who}
            <span>{n.sub}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
