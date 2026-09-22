"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/* Smooth cross-fade between routes so navigation feels like one app,
   not separate documents. Keeps the old content painted for a beat,
   fades the new content up. Respects reduced motion. */
export default function PageTransition({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [display, setDisplay] = useState(children);
  const [stage, setStage] = useState<"in" | "out">("in");
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (reduce) {
      setDisplay(children);
      window.scrollTo(0, 0);
      return;
    }
    setStage("out");
    const t = window.setTimeout(() => {
      setDisplay(children);
      window.scrollTo(0, 0);
      setStage("in");
    }, 180);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // keep display in sync when children change without a path change
  useEffect(() => {
    if (stage === "in") setDisplay(children);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children]);

  return (
    <div className={`page-tx ${stage === "out" ? "is-out" : "is-in"}`}>
      {display}
    </div>
  );
}
