import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "./",

  plugins: [
    react(),
    crx({ manifest }),
  ],

  build: {
    target: "es2022",
    chunkSizeWarningLimit: 3000,

    rollupOptions: {
      input: {
        index: resolve(rootDir, "index.html"),
        offscreen: resolve(rootDir, "offscreen.html"),
      },
    },
  },
});