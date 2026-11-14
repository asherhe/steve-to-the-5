import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const archiveProxy = {
  target: process.env.ARCHIVE_API_TARGET ?? "http://127.0.0.1:8000",
  proxyTimeout: 240_000,
};
const catalogTarget = process.env.CATALOG_API_TARGET ?? "http://127.0.0.1:8010";
const proxy = {
  "/api/resolve": catalogTarget,
  "/api/catalogs": catalogTarget,
  "/api/comparisons": archiveProxy,
};

export default defineConfig(({ command }) => ({
  plugins: [{
    name: "development-viewer-fixtures",
    enforce: "pre",
    resolveId(source, importer) {
      // Exclude even the synthetic PNG assets from the public build.
      if (command === "build" && source === "./fixtures" && importer?.endsWith("/harness/main.tsx")) {
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
