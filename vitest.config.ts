import { defineConfig } from 'vitest/config'

// Standalone config so unit tests do not boot the Cloudflare plugin.
// API integration tests against workerd (@cloudflare/vitest-plugin) have their own
// config, vitest.workers.config.ts. Which tier a test belongs in, and why:
// docs/testing-and-ci.md.
export default defineConfig({
  test: {
    // `scripts/**` holds tests about the repo's own plumbing - constants that
    // SQL or shell has to copy out of TypeScript, and similar. They read files
    // with node:fs, which is why they cannot live in `shared/`: that project
    // compiles for the browser and for workerd, and has no node types.
    //
    // `server/**/*.node.test.ts` are the server tests that prove pure
    // functions or mocked repositories and need no binding, no app, and no
    // D1. The suffix is the boundary: the workers config excludes exactly
    // this glob (docs/testing-and-ci.md section 3).
    include: [
      'scripts/**/*.test.ts',
      'shared/**/*.test.ts',
      'src/**/*.test.{ts,tsx}',
      'server/**/*.node.test.ts',
    ],
    // Default environment stays `node`. Component tests opt into jsdom
    // per-file with a leading `// @vitest-environment jsdom` comment
    // (ported convention from the old repo).
    setupFiles: ['./vitest.setup.ts'],
  },
})
