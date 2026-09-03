import Swoosh from "./Swoosh";

export default function SectionHead({
  kicker,
  title,
  children,
  center = false,
}: {
  kicker: string;
  title: string;
  children?: React.ReactNode;
  center?: boolean;
}) {
  return (
    <div className={`section-head${center ? " center" : ""}`}>
      <p className="kicker">{kicker}</p>
      <h2>{title}</h2>
      <Swoosh />
      {children ? <p>{children}</p> : null}
    </div>
  );
}
