import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  test: {
    // Default environment is `node`. Per-file `// @vitest-environment jsdom`
    // directives opt individual test files into jsdom. This keeps the
    // pure-function suite (csv, grouping, optimistic, queries-bulk-reorder,
    // WeightTable) running on node — fast and minimal — while only the
    // tests that actually touch the DOM pay the jsdom load tax.
    setupFiles: ['./vitest.setup.ts'],
  },
  build: {
    // Source code already requires ES2024+ runtime methods (Map.groupBy,
    // Promise.withResolvers) which Safari shipped in 17.4 (Mar 2024). Setting
    // the syntax target to es2025 says "anything older than that is dead in
    // the water regardless of what esbuild emits, so don't bother transpiling
    // syntax down." Bundle stays byte-identical to es2024 for current code
    // (no ES2025-specific syntax in use yet) but new ES2025 syntax (import
    // attributes, regex duplicate named groups) ships through if it's ever
    // added. Bumps cleanly in lockstep with tsconfig.app.json's lib/target.
    target: 'es2025',
    rollupOptions: {
      output: {
        // Split heavy third-party deps out of the main bundle so a code-only
        // deploy (the common case) invalidates only the small app chunk,
        // not the ~500 kB of vendor JS. Browsers reuse the unchanged vendor
        // chunks from the HTTP cache across deploys. Keep this list small and
        // explicit: over-splitting fragments the cache and hurts cold load.
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('@supabase/supabase-js')) return 'supabase'
            if (id.includes('@dnd-kit/')) return 'dnd-kit'
            if (
              id.includes('/react-dom/') ||
              id.includes('/react-router/') ||
              /\/react\/(?!.*\/node_modules)/.test(id)
            ) {
              return 'react'
            }
          }
          return undefined
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
})
