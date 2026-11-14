import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone dev-server config for the findings UI fixture harness (task 5).
// This is NOT the integrated app shell; the viewer at the repo root owns that.
export default defineConfig({
  plugins: [react()],
  root: "src/findings/harness",
  server: { port: 5174 },
});
