import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const archiveProxy = {
  target: process.env.ARCHIVE_API_TARGET ?? "http://127.0.0.1:8000",
  proxyTimeout: 240_000,
};
const catalogTarget = process.env.CATALOG_API_TARGET ?? "http://127.0.0.1:8010";
// Findings backend is opt-in (`npm run dev:findings`); requests fail fast while it is down.
const findingsTarget = process.env.FINDINGS_API_TARGET ?? "http://127.0.0.1:8014";
// WISE time-lapse backend (`npm run dev:wise`). The timeout sits above its 360 s build deadline.
const wiseProxy = {
  target: process.env.WISE_API_TARGET ?? "http://127.0.0.1:8020",
  proxyTimeout: 420_000,
};
const proxy = {
  "/api/resolve": catalogTarget,
  "/api/catalogs": catalogTarget,
  "/api/comparisons": archiveProxy,
  "/api/findings": findingsTarget,
  "/api/wise": wiseProxy,
};

export default defineConfig(({ command }) => ({
  plugins: [{
    name: "development-viewer-fixtures",
    enforce: "pre",
    resolveId(source, importer) {
      // Exclude even the synthetic PNG assets from the public build.
      if (command === "build" && source === "./harness/main" && importer?.endsWith("/viewer/main.tsx")) {
        return "\0viewer-fixtures-disabled";
      }
    },
    load(id) {
      if (id === "\0viewer-fixtures-disabled") return "export {};";
    },
  }],
  resolve: { dedupe: ["react", "react-dom"] },
  server: {
    port: Number(process.env.VIEWER_PORT ?? 5173),
    fs: { allow: [fileURLToPath(new URL("../../../", import.meta.url))] },
    proxy,
  },
  preview: { proxy },
}));
