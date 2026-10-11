import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The SPA build and dev config for the Node server: the same plugins as
// vite.config.ts minus the Cloudflare plugin. server/dev.ts runs Vite with
// this config in middleware mode and sends /api/* to the Hono app itself.
export default defineConfig({
  plugins: [react(), tailwindcss()],
})
