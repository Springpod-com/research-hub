import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// Replit assigns the public port through PORT and proxies the preview from
// another origin, so the dev server must accept any host. The private API stays
// on 127.0.0.1:3001 (see the "dev" script) and is reached through the proxy.
const port = Number(process.env.PORT || 5173);
const apiPort = Number(process.env.API_PORT || 3001);
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port,
    strictPort: true,
    allowedHosts: true,
    proxy: { "/api": `http://127.0.0.1:${apiPort}` },
  },
  build: { outDir: "dist" },
});
