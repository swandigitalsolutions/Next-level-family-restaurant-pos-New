import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

/* jsdom has no Web Audio; the alarm engine already degrades to silence when
   unlock() fails, which is the path these tests exercise. */
