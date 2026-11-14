import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Test config for the standalone frontend slices: source inspector (task 3) and
// findings UI (task 5). The integrated viewer app is tested from the repo root.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/inspector/**/*.test.{ts,tsx}", "src/findings/**/*.test.{ts,tsx}"],
  },
});
