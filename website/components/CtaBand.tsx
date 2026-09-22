import Link from "next/link";

export default function CtaBand({
  title,
  children,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  actions: { label: string; href: string; variant: "gold" | "ghost" }[];
}) {
  return (
    <section className="band-red">
      <div className="container cta-band">
        <h2>{title}</h2>
        <p>{children}</p>
        <div className="cta-actions">
          {actions.map((a) => (
            <Link key={a.label} href={a.href} className={`btn btn-${a.variant}`}>
              {a.label}
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
