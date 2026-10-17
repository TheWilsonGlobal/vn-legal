import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  cacheDir: "node_modules/.vite/admin",
  root: "apps/admin",
  base: "/admin/",
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "../../dist/admin",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "apps/admin/src"),
    },
  },
});
