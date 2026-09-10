import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Deterministic secrets for server-side helpers under test.
process.env.ORDER_TOKEN_SECRET ||= "test-order-token-secret";
process.env.POS_API_KEY ||= "test-pos-api-key";
process.env.POS_API_BASE_URL ||= "http://pos.test";

afterEach(() => {
  cleanup();
});

// jsdom has no matchMedia / IntersectionObserver — a few components touch them.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
