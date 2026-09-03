const ICONS: Record<string, React.ReactNode> = {
  chai: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z" />
      <path d="M17 9h1.5a2.5 2.5 0 0 1 0 5H17" />
      <path d="M8 3c-.6.8-.6 1.7 0 2.5M12 3c-.6.8-.6 1.7 0 2.5" />
    </svg>
  ),
  thali: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </svg>
  ),
  brush: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14c-2 0-4 1.5-4 4 0 1 .5 2 .5 2s2-.5 3-.5c2 0 3.5-1.5 3.5-3.5" />
      <path d="M14.5 4.5 20 10l-7.5 7-4-4L16 5.5" />
    </svg>
  ),
  leaf: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 20A7 7 0 0 1 4 13c0-4 3-8 15-9 1 12-3 15-8 16Z" />
      <path d="M6 18C10 14 13 11 18 8" />
    </svg>
  ),
};

const items = [
  { icon: "chai", title: "Tandoori Chai", text: "Smoked in a hot clay kulhad" },
  { icon: "thali", title: "Unlimited Thali", text: "Refilled till you're full" },
  { icon: "brush", title: "Warli Walls", text: "Hand-painted, floor to roof" },
  { icon: "leaf", title: "Garden Seating", text: "Open-air, under the pots" },
];

export default function Specialities() {
  return (
    <div className="specialities">
      {items.map((s) => (
        <div className="spec" key={s.title}>
          <span className="ico" aria-hidden="true">
            {ICONS[s.icon]}
          </span>
          <h3>{s.title}</h3>
          <p>{s.text}</p>
        </div>
      ))}
    </div>
  );
}
