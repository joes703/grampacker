import { defineConfig } from 'vitest/config'

// Standalone config so unit tests do not boot the Cloudflare plugin.
// API integration tests against workerd (vitest-pool-workers) get their own
// config when they land in phase 1.
export default defineConfig({
  test: {
    include: ['shared/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    // Default environment stays `node`. Component tests opt into jsdom
    // per-file with a leading `// @vitest-environment jsdom` comment
    // (ported convention from the old repo).
    setupFiles: ['./vitest.setup.ts'],
  },
})
