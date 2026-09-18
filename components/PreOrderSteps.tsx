/* The pre-order journey, shown on the home page and the cart. Pure
   presentational — no state.

   This is DINE-IN pre-ordering, not delivery: guests order and pay a 50%
   advance from their phone before they leave, the order goes to the
   kitchen, and the food is ready when they walk in. The balance is paid
   after the meal. */

const STEPS = [
  { n: 1, ico: "🍽️", title: "Pick your dishes", sub: "Add to cart from the live menu" },
  { n: 2, ico: "💳", title: "Pay 50% advance", sub: "Secure online payment" },
  { n: 3, ico: "👨‍🍳", title: "Kitchen starts cooking", sub: "Your order goes straight to our kitchen" },
  { n: 4, ico: "🪑", title: "Walk in & eat", sub: "Food is ready — pay the rest after your meal" },
];

export default function PreOrderSteps({ compact = false }: { compact?: boolean }) {
  return (
    <ol className={`preorder-steps${compact ? " compact" : ""}`}>
      {STEPS.map((s) => (
        <li key={s.n}>
          <span className="preorder-step-n" aria-hidden="true">
            {s.ico}
          </span>
          <span className="preorder-step-txt">
            <small className="preorder-step-num">Step {s.n}</small>
            <strong>{s.title}</strong>
            <small>{s.sub}</small>
          </span>
        </li>
      ))}
    </ol>
  );
}
