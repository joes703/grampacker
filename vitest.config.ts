import { defineConfig } from 'vitest/config'

// Standalone config so unit tests do not boot the Cloudflare plugin.
// API integration tests against workerd (vitest-pool-workers) get their own
// config when they land in phase 1.
export default defineConfig({
  test: {
    // `scripts/**` holds tests about the repo's own plumbing - constants that
    // SQL or shell has to copy out of TypeScript, and similar. They read files
    // with node:fs, which is why they cannot live in `shared/`: that project
    // compiles for the browser and for workerd, and has no node types.
    include: ['scripts/**/*.test.ts', 'shared/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    // Default environment stays `node`. Component tests opt into jsdom
    // per-file with a leading `// @vitest-environment jsdom` comment
    // (ported convention from the old repo).
    setupFiles: ['./vitest.setup.ts'],
  },
})
