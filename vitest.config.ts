import { defineConfig } from 'vitest/config'

// Unit tests. API integration tests have their own Node/SQLite config,
// vitest.api.config.ts. Which tier a test belongs in, and why:
// docs/testing-and-ci.md.
export default defineConfig({
  test: {
    // `scripts/**` holds tests about the repo's own plumbing - constants that
    // SQL or shell has to copy out of TypeScript, and similar. They read files
    // with node:fs, which is why they cannot live in `shared/`: that project
    // compiles for the browser and server, and has no node types.
    //
    // `server/**/*.node.test.ts` are the server tests that prove pure
    // functions or mocked repositories and need no database or full app.
    // The suffix is the boundary: the API config excludes exactly this glob
    // (docs/testing-and-ci.md section 2).
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
