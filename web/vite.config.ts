import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The Python pipeline serves /api, /video and /ws on port 8100. Proxying them through the
// dev server keeps the frontend same origin, so the vision lane never has to add CORS
// middleware on our behalf.
const pipeline = process.env.VITE_PIPELINE_ORIGIN ?? "http://localhost:8100";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const contracts = fileURLToPath(new URL("../contracts", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // contracts/ is the shared interface and it lives above web/. The mock fixtures are
    // imported from there rather than copied in, so there is exactly one source of truth.
    alias: {
      "@contracts": contracts,
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [repoRoot],
    },
    proxy: {
      "/api": { target: pipeline, changeOrigin: true },
      "/video": { target: pipeline, changeOrigin: true },
      "/ws": { target: pipeline, changeOrigin: true, ws: true },
    },
  },
});
