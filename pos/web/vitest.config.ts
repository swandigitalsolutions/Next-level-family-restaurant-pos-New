import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    css: false,
    /* Screen tests drive the UI keystroke by keystroke in jsdom. On a busy or
       modest machine some take longer than Vitest's 5 s default, which failed
       a random handful of them per run with "Test timed out" and no assertion
       wrong. 20 s still catches a test that truly hangs. */
    testTimeout: 20_000,
  },
});
