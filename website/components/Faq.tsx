import { faqs } from "@/lib/content";

export default function Faq() {
  return (
    <div className="faq">
      {faqs.map((f, i) => (
        <details key={f.q} open={i === 0}>
          <summary>{f.q}</summary>
          <p>{f.a}</p>
        </details>
      ))}
    </div>
  );
}
