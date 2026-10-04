import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from "@crxjs/vite-plugin"
import manifest from "./manifest.json"

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest })
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 3000
  }
})