import { defineConfig } from 'vitest/config'

// The two test tiers, as Vitest projects. `npm run test:unit` and
// `npm run test:api` each run one; which tier a test belongs in, and why:
// docs/testing-and-ci.md.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          // `scripts/**` holds tests about the repo's own plumbing - constants
          // that SQL or shell has to copy out of TypeScript, and similar. They
          // read files with node:fs, which is why they cannot live in
          // `shared/`: that project compiles for the browser and server, and
          // has no node types.
          //
          // `server/**/*.node.test.ts` are the server tests that prove pure
          // functions or mocked repositories and need no database or full
          // app. The suffix is the boundary: the api project excludes exactly
          // this glob (docs/testing-and-ci.md section 2).
          include: [
            'scripts/**/*.test.ts',
            'shared/**/*.test.ts',
            'src/**/*.test.{ts,tsx}',
            'server/**/*.node.test.ts',
          ],
          // The default environment is `node`. Component tests opt into jsdom
          // per file with a leading `// @vitest-environment jsdom` comment.
          setupFiles: ['./vitest.setup.ts'],
        },
      },
      {
        test: {
          // The real Hono app on Node against a real SQLite database built by
          // the real migrations (server/test/node-env.ts gives each test file
          // its own in-memory database).
          name: 'api',
          include: ['server/**/*.test.ts'],
          exclude: ['server/**/*.node.test.ts'],
        },
      },
    ],
  },
})
