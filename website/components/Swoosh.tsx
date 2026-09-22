/* A short, clean accent rule under a heading. */
export default function Swoosh({ className = "" }: { className?: string }) {
  return <span className={`rule ${className}`} aria-hidden="true" />;
}
