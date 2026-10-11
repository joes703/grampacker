import { mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname } from 'node:path'
import { getRequestListener } from '@hono/node-server'
import { createServer as createViteServer } from 'vite'
import app from './index'
import { openSqlite } from './db'
import { applyMigrations } from './db/migrate'
import type { AppEnv } from './env'

// Local development without Wrangler: `npm run dev:node`.
//
// One process on http://localhost:5173. /api/* goes to the real Hono app;
// everything else goes to Vite, which serves the React app with hot reload.
// tsx restarts this process when server code changes.
//
// The database is a local file (DEV_DATABASE_PATH, default .data/dev.db,
// git-ignored) and is migrated on every start, so a fresh checkout works at
// once. Delete the file to start over.
//
// Dev only. It binds 127.0.0.1, uses a fixed dev secret unless
// BETTER_AUTH_SECRET is set, and prints magic-link URLs to this terminal
// (no RESEND_API_KEY). Static files bypass the app here, so the security
// headers apply to /api/* only; the production server (server/node.ts) sends
// every response through the app.
const PORT = 5173
const ORIGIN = `http://localhost:${PORT}`
const databasePath = process.env.DEV_DATABASE_PATH || '.data/dev.db'

mkdirSync(dirname(databasePath), { recursive: true })
const sqlite = openSqlite(databasePath)
const applied = applyMigrations(sqlite)
console.log(`dev database ${databasePath}: applied ${applied} migration(s)`)

const env: AppEnv = {
  DB: sqlite,
  // Must stay a localhost URL: that is what selects the dev CSP and the
  // console email sender (isDevEnvironment).
  BETTER_AUTH_URL: ORIGIN,
  BETTER_AUTH_SECRET:
    process.env.BETTER_AUTH_SECRET || 'local-dev-only-secret-not-for-any-deployment',
  RESEND_API_KEY: process.env.RESEND_API_KEY || undefined,
  EMAIL_FROM: 'grampacker <no-reply@grampacker.app>',
  STATIC_DIR: 'dist/client',
}

const httpServer = createServer()
const vite = await createViteServer({
  configFile: 'vite.node.config.ts',
  appType: 'spa',
  server: { middlewareMode: true, hmr: { server: httpServer } },
})
const api = getRequestListener((request) => app.fetch(request, env))

httpServer.on('request', (req, res) => {
  const path = req.url ?? '/'
  if (path === '/api' || path.startsWith('/api/') || path.startsWith('/api?')) {
    void api(req, res)
  } else {
    vite.middlewares(req, res)
  }
})

httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`grampacker dev server on ${ORIGIN}`)
})

const stop = () => {
  httpServer.close()
  void vite.close().finally(() => {
    sqlite.close()
    process.exit(0)
  })
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
