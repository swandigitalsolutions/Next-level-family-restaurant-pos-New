/**
 * Scroll reveal, with the failure mode pointed the safe way.
 *
 * The element starts VISIBLE (`.reveal`). Only once this hook has confirmed
 * IntersectionObserver exists and motion is wanted does it add `.reveal-armed`,
 * which is the class that actually hides the element. So on an old tablet
 * webview, or with reduced motion on, the content is simply there — the worst
 * case is no animation, never an invisible bill.
 */
import { useEffect, useRef } from "react";

type Options = {
  /** How far up the viewport an element must come before it reveals. */
  rootMargin?: string;
  /** Re-hide and replay when scrolled back past. Off by default: a till screen
   *  that re-animates every time the cashier scrolls up is a distraction. */
  repeat?: boolean;
};

export function useReveal<T extends HTMLElement = HTMLElement>({
  rootMargin = "0px 0px -8% 0px",
  repeat = false,
}: Options = {}) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") return;

    node.classList.add("reveal-armed");

    /* Anything already on screen at mount reveals on the next frame rather than
       animating — it was never scrolled to, so there is nothing to reveal. */
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            if (!repeat) io.unobserve(entry.target);
          } else if (repeat) {
            entry.target.classList.remove("is-in");
          }
        }
      },
      { rootMargin, threshold: 0.01 },
    );

    io.observe(node);
    return () => io.disconnect();
  }, [rootMargin, repeat]);

  return ref;
}

/**
 * The same thing for a container whose children should arrive one after
 * another — a bill list, a grid of dish tiles.
 */
export function useRevealGroup<T extends HTMLElement = HTMLElement>(options: Options = {}) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") return;

    const children = Array.from(node.children) as HTMLElement[];
    children.forEach((child, i) => {
      child.classList.add("reveal-armed");
      /* Capped so a long list finishes arriving promptly — see motion.css. */
      child.style.setProperty("--reveal-delay", `${Math.min(i, 9) * 26}ms`);
    });

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: options.rootMargin ?? "0px 0px -6% 0px", threshold: 0.01 },
    );

    children.forEach((child) => io.observe(child));
    return () => io.disconnect();
  });

  return ref;
}
