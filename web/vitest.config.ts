import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Test config for the source inspector slice (task 3). Scoped to web/src/inspector.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/inspector/**/*.test.{ts,tsx}"],
  },
});
