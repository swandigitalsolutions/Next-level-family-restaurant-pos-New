/* The four-step pre-order flow, shown on the home + menu pages. Pure
   presentational — no state. */

const STEPS = [
  { n: 1, title: "Browse the menu", sub: "Live prices from the kitchen" },
  { n: 2, title: "Add to cart", sub: "Pick your dishes & quantities" },
  { n: 3, title: "Pay 50% advance", sub: "Securely, online" },
  { n: 4, title: "Order confirmed", sub: "We start prepping for your slot" },
];

export default function PreOrderSteps({ compact = false }: { compact?: boolean }) {
  return (
    <ol className={`preorder-steps${compact ? " compact" : ""}`}>
      {STEPS.map((s) => (
        <li key={s.n}>
          <span className="preorder-step-n">{s.n}</span>
          <span className="preorder-step-txt">
            <strong>{s.title}</strong>
            <small>{s.sub}</small>
          </span>
        </li>
      ))}
    </ol>
  );
}
