import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The SPA build and dev config for the Node server: the same plugins as
// vite.config.ts minus the Cloudflare plugin. server/dev.ts runs Vite with
// this config in middleware mode and sends /api/* to the Hono app itself.
// `npm run build:client` writes the SPA to dist/client, the server's default
// STATIC_DIR (server/env.ts).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist/client', emptyOutDir: true },
})
