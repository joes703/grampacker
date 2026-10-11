import { defineConfig } from 'vitest/config'

// API integration tests: the real Hono app on Node against a real SQLite
// database built by the real migrations (server/test/node-env.ts gives each
// test file its own in-memory database). Pure and mock-only server tests run
// under vitest.config.ts instead; the `.node.test.ts` suffix is the tier
// boundary (docs/testing-and-ci.md section 3).
export default defineConfig({
  test: {
    include: ['server/**/*.test.ts'],
    exclude: ['server/**/*.node.test.ts'],
  },
})
