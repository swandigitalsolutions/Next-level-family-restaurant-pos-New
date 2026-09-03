import Swoosh from "./Swoosh";

/* Standard header for a top-level page — same rhythm everywhere so
   the pages feel like one designed system, not separate documents. */
export default function PageIntro({
  kicker,
  title,
  children,
  flag,
}: {
  kicker: string;
  title: string;
  children?: React.ReactNode;
  flag?: string;
}) {
  return (
    <section className="page-intro">
      <div className="container">
        <div className="section-head center">
          <p className="kicker">{kicker}</p>
          <h1>{title}</h1>
          <Swoosh className="center" />
          {children ? <p>{children}</p> : null}
          {flag ? <p className="placeholder-flag">{flag}</p> : null}
        </div>
      </div>
    </section>
  );
}
