/**
 * Subscribe to a media query.
 *
 * Used where a layout difference is structural rather than cosmetic — the till
 * docks the bill beside the menu on a wide screen and puts it in a sheet on a
 * phone, and those are different component trees, not the same tree with
 * different padding. Doing that in CSS alone would mean rendering the bill
 * twice and keeping two sets of form fields in sync.
 */
import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof matchMedia === "function" ? matchMedia(query).matches : false,
  );

  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia(query);
    // Re-read on subscribe: the query may have changed between the initial
    // state and this effect (a rotated tablet, or a re-render with a new query).
    setMatches(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
