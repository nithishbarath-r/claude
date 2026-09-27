import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Built into ../app, which CAP serves at / — one process, one port, works offline.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: { outDir: '../app', emptyOutDir: true },
  server: { port: 5173, proxy: { '/odata': 'http://localhost:4004' } }
})
