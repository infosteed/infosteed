// SPDX-License-Identifier: AGPL-3.0-only
import { resolve } from "node:path";
import { copyFile, readFile } from "node:fs/promises";
import { build as viteBuild, defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

function bundleClassicContentScript(): Plugin {
  return {
    name: "infosteed-classic-content-script",
    apply: "build",
    async closeBundle() {
      await viteBuild({
        configFile: false,
        build: {
          emptyOutDir: false,
          outDir: resolve(import.meta.dirname, "dist"),
          lib: {
            entry: resolve(import.meta.dirname, "src/contentScript.ts"),
            formats: ["iife"],
            name: "InfoSteedContentRecorder",
            fileName: () => "contentScript.js",
          },
        },
      });
      const output = await readFile(
        resolve(import.meta.dirname, "dist/contentScript.js"),
        "utf8",
      );
      if (/^\s*import\s/m.test(output)) {
        throw new Error(
          "contentScript.js must be a self-contained classic script",
        );
      }
      await copyFile(
        resolve(import.meta.dirname, "../../LICENSE"),
        resolve(import.meta.dirname, "dist/LICENSE"),
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), bundleClassicContentScript()],
  build: {
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, "src/popup.html"),
        setup: resolve(import.meta.dirname, "src/setup.html"),
        options: resolve(import.meta.dirname, "src/options.html"),
        offscreen: resolve(import.meta.dirname, "src/offscreen.html"),
        background: resolve(import.meta.dirname, "src/background.ts"),
        contentScript: resolve(import.meta.dirname, "src/contentScript.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
