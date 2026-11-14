import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone dev-server config for the source inspector harness (task 3).
// This is NOT the integrated app shell; the coordinator owns that entry point.
export default defineConfig({
  plugins: [react()],
  root: "src/inspector/harness",
  server: { port: 5173 },
});
