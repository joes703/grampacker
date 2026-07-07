import { defineConfig } from 'vitest/config'

// Standalone config so unit tests do not boot the Cloudflare plugin.
// API integration tests against workerd (vitest-pool-workers) get their own
// config when they land in phase 1.
export default defineConfig({
  test: {
    include: ['shared/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
  },
})
