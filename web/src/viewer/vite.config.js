import { defineConfig } from "vite";

export default defineConfig({
  resolve: { dedupe: ["react", "react-dom"] },
  server: {
    proxy: {
      "/api/resolve": process.env.CATALOG_API_TARGET ?? "http://127.0.0.1:8010",
      "/api/catalogs": process.env.CATALOG_API_TARGET ?? "http://127.0.0.1:8010",
    },
  },
});
