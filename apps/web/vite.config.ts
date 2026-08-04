// SPDX-License-Identifier: AGPL-3.0-only
import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    {
      name: "infosteed-legal-bundle",
      apply: "build",
      async closeBundle() {
        await copyFile(
          resolve(import.meta.dirname, "../../LICENSE"),
          resolve(import.meta.dirname, "dist/LICENSE"),
        );
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3777",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
});
