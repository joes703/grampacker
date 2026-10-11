import { defineConfig } from 'vite'

// Compiles the Node server (server/node.ts and everything it imports) to
// plain JavaScript in dist/server, for `node dist/server/node.js`. Production
// runs this output; tsx is for local development only.
//
// An SSR build, so packages in node_modules stay external and are loaded
// from node_modules at runtime - better-sqlite3's native binary included.
// Only the server's own TypeScript is compiled.
export default defineConfig({
  // public/ belongs to the SPA build, not the server bundle.
  publicDir: false,
  build: {
    ssr: 'server/node.ts',
    outDir: 'dist/server',
    target: 'node24',
    emptyOutDir: true,
    sourcemap: true,
  },
})
