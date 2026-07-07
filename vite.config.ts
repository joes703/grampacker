import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

// The cloudflare plugin reads wrangler.jsonc and runs the Worker (server/)
// inside the Vite dev server via workerd, so `npm run dev` serves the SPA
// with HMR and the /api/* routes from one process. No Docker, no second
// terminal.
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
})
