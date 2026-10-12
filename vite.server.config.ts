import { defineConfig } from 'vite'

// Compiles the Node server (server/node.ts and everything it imports) to
// plain JavaScript in dist/server, for `node dist/server/node.js`. Production
// runs this output; tsx is for local development only. The container's health
// check (server/healthcheck.ts) is a second entry: dist/server/healthcheck.js.
//
// An SSR build, so packages in node_modules stay external and are loaded
// from node_modules at runtime - better-sqlite3's native binary included.
// Only the server's own TypeScript is compiled.
export default defineConfig({
  // public/ belongs to the SPA build, not the server bundle.
  publicDir: false,
  build: {
    ssr: true,
    rolldownOptions: {
      input: { node: 'server/node.ts', healthcheck: 'server/healthcheck.ts' },
    },
    outDir: 'dist/server',
    target: 'node24',
    emptyOutDir: true,
    // No source maps: the output is not minified, so stack traces already
    // name the real functions, and Node ignores .map files unless started
    // with --enable-source-maps. The image ships none (Dockerfile).
    sourcemap: false,
  },
})
