import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  test: {
    // Default environment is `node`. Per-file `// @vitest-environment jsdom`
    // directives opt individual test files into jsdom. This keeps the
    // pure-function suite (csv, grouping, optimistic, queries-bulk-reorder,
    // WeightTable) running on node — fast and minimal — while only the
    // tests that actually touch the DOM pay the jsdom load tax.
    setupFiles: ['./vitest.setup.ts'],
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Auto-update: SW silently swaps in a new build on next page load.
      // injectRegister: 'auto' makes the plugin write the registration
      // script into index.html — no manual `registerSW()` call needed in
      // src/. If we ever want a "new version available, refresh" prompt
      // UI, switch to 'prompt' and import virtual:pwa-register in main.tsx.
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // Wipe outdated precache entries on activation, and skip the
      // "waiting" phase so a fresh build takes effect on the next reload
      // rather than two reloads later.
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // Cache is URL-keyed, not auth-keyed. Assumes single-user-per-
        // browser. If grampacker ever supports multiple users on shared
        // devices, either implement cacheKeyWillBeUsed to mix the auth
        // subject into the key, or clear caches on logout. Solo-user
        // today; revisit when assumption changes.
        runtimeCaching: [
          {
            // Supabase REST GETs (PostgREST reads). Match host-agnostically
            // on /rest/v1/ — the app only ever talks to one Supabase project,
            // and matching by path keeps the regex independent of which
            // env var the build was given. Method GET only — POST/PATCH/
            // DELETE (mutations) and POST /rpc/ (bulk_update_sort_order
            // and similar) fall through to network-only.
            urlPattern: /\/rest\/v1\/(?!rpc\/).*/i,
            method: 'GET',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'supabase-rest',
              expiration: {
                // Each list visit produces ~3-5 unique URLs (lists, list_items
                // for that listId, gear_items, categories). 300 entries covers
                // ~75 lists comfortably, vs. the previous 50 cap which could
                // evict the very list a user prepped before going offline. JSON
                // payloads are small; storage cost is a few MB at the cap.
                maxEntries: 300,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
              // Treat opaque/cors responses as cacheable. Supabase responds
              // 200 with cors headers; this is just defense against the
              // default of 0-and-200-only.
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // /auth/v1/ — login, signup, token refresh, magic link verify.
            // Explicit NetworkOnly to make the intent obvious in code review;
            // without an entry these would fall through to NetworkOnly
            // anyway, but a stale auth response on disk would be the worst
            // possible cache miss.
            urlPattern: /\/auth\/v1\//i,
            handler: 'NetworkOnly',
          },
        ],
      },
      manifest: {
        name: 'grampacker',
        short_name: 'grampacker',
        description: 'Backpacking gear and packing list manager',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#059669',
        icons: [
          {
            src: '/web-app-manifest-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/web-app-manifest-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
    }),
  ],
})
