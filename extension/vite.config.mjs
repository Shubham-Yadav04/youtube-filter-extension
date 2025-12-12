import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import {crx} from "@crxjs/vite-plugin"
import manifest from "./manifest.json"
// https://vite.dev/config/
export default defineConfig({
  plugins: [react() ,crx({ manifest })],
  // build: {
  //   rollupOptions: {
  //     input: {
  //       injectScript: "./content.js", // Define your entry point
  //     },
  //     output: {
  //       entryFileNames: 'assets/content.js', // Use a predictable name, e.g., 'injectScript.js'
  //     },
  //   },
  // },

})
