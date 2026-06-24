import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const buildId = process.env.GATELITE_BUILD_ID || new Date().toISOString();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __GATELITE_BUILD_ID__: JSON.stringify(buildId)
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001"
    }
  }
});
