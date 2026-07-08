import { defineConfig } from 'vitest/config'
import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers'

// API integration tests: the real Hono app against real workerd + D1.
// Migrations are applied by server/test/apply-migrations.ts before tests.
// (vitest 4 era: pool-workers 0.18 replaced defineWorkersConfig with the
// cloudflareTest() Vite plugin.)
export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations')
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            BETTER_AUTH_SECRET: 'test-only-secret-at-least-32-chars-long!',
            BETTER_AUTH_URL: 'http://localhost:5173',
          },
          // The real assets directory only exists after a build; tests
          // get a one-file fixture so the ASSETS binding (and the
          // security-header middleware in front of it) is exercisable.
          assets: {
            directory: './server/test/fixtures/assets',
            binding: 'ASSETS',
          },
        },
      }),
    ],
    test: {
      include: ['server/**/*.test.ts'],
      setupFiles: ['./server/test/apply-migrations.ts'],
    },
  }
})
