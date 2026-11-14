import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const archiveProxy = {
  target: process.env.ARCHIVE_API_TARGET ?? "http://127.0.0.1:8000",
  proxyTimeout: 240_000,
};

export default defineConfig({
  resolve: { dedupe: ["react", "react-dom"] },
  server: {
    fs: { allow: [fileURLToPath(new URL("../../../", import.meta.url))] },
    proxy: {
      "/api/resolve": process.env.CATALOG_API_TARGET ?? "http://127.0.0.1:8010",
      "/api/catalogs": process.env.CATALOG_API_TARGET ?? "http://127.0.0.1:8010",
      "/api/comparisons": archiveProxy,
    },
  },
});
