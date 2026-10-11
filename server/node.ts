import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { pathToFileURL } from 'node:url'
import { serve } from '@hono/node-server'
import app from './index'
import { openSqlite, type Sqlite } from './db'
import { applyMigrations, pendingMigrationCount } from './db/migrate'
import { ConfigError, loadConfig, type AppEnv } from './env'

// The Node process entry.
//
//   tsx server/node.ts           serve (the default)
//   tsx server/node.ts migrate   apply pending migrations, then exit
//
// Migrations are a separate, explicit step (docs/vps-migration-plan.md step
// 9): the deploy runs them with the candidate image while the app is stopped
// and a snapshot exists. The server itself only checks, and refuses to start
// on a database that is behind its code.

export type RunningServer = {
  port: number
  // Stops accepting connections and resolves once every in-flight request has
  // finished. Idle keep-alive connections are closed at once; busy ones are
  // given `graceMs` before they are cut.
  close(graceMs?: number): Promise<void>
}

// Listens and serves `app` with `env` on every request. Exported for tests,
// which start it on port 0 against their own database.
export function startServer(
  env: AppEnv,
  opts: { port: number; hostname: string },
): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const server = serve(
      {
        fetch: (request) => app.fetch(request, env),
        port: opts.port,
        hostname: opts.hostname,
      },
      (info: AddressInfo) => {
        resolve({
          port: info.port,
          close: (graceMs = 10_000) => closeServer(server as Server, graceMs),
        })
      },
    ) as Server
    server.once('error', reject)
  })
}

// server.close() closes the connections that are idle at that moment, but a
// keep-alive connection (Caddy keeps them) that finishes its request AFTER
// close() began would otherwise stay open until Node's keep-alive timeout.
// Sweeping idle connections until the server is closed lets shutdown finish
// as soon as the last request does.
function closeServer(server: Server, graceMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const sweep = setInterval(() => server.closeIdleConnections(), 50)
    const force = setTimeout(() => server.closeAllConnections(), graceMs)
    server.close((err) => {
      clearInterval(sweep)
      clearTimeout(force)
      if (err) reject(err)
      else resolve()
    })
  })
}

// SIGTERM (docker stop, Compose) and SIGINT (Ctrl-C): stop taking requests,
// let the in-flight ones finish, THEN close the database. Closing SQLite first
// would fail requests that are still running. A second signal exits at once.
export function shutdownOnSignals(
  running: RunningServer,
  sqlite: Sqlite,
  log: (message: string) => void = (m) => console.log(m),
): void {
  let stopping = false
  const stop = (signal: NodeJS.Signals) => {
    if (stopping) process.exit(1)
    stopping = true
    log(`${signal}: shutting down`)
    running
      .close()
      .catch((err: unknown) => log(`server close failed: ${String(err)}`))
      .finally(() => {
        sqlite.close()
        log('shutdown complete')
        process.exit(0)
      })
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
}

export async function main(argv: string[], source: NodeJS.ProcessEnv): Promise<number> {
  const command = argv[0] ?? 'serve'
  let config
  try {
    config = loadConfig(source)
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`configuration error: ${err.message}`)
      return 2
    }
    throw err
  }

  const sqlite = openSqlite(config.DATABASE_PATH)

  if (command === 'migrate') {
    const applied = applyMigrations(sqlite)
    console.log(`applied ${applied} migration(s) to ${config.DATABASE_PATH}`)
    sqlite.close()
    return 0
  }
  if (command !== 'serve') {
    console.error(`unknown command: ${command} (expected serve or migrate)`)
    sqlite.close()
    return 2
  }

  const behind = pendingMigrationCount(sqlite)
  if (behind > 0) {
    console.error(
      `${behind} migration(s) not applied to ${config.DATABASE_PATH}; run the migrate command first`,
    )
    sqlite.close()
    return 1
  }

  const env: AppEnv = {
    DB: sqlite,
    BETTER_AUTH_URL: config.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: config.BETTER_AUTH_SECRET,
    RESEND_API_KEY: config.RESEND_API_KEY,
    EMAIL_FROM: config.EMAIL_FROM,
    STATIC_DIR: config.STATIC_DIR,
  }
  const running = await startServer(env, { port: config.PORT, hostname: config.HOST })
  console.log(`listening on http://${config.HOST}:${running.port}`)
  shutdownOnSignals(running, sqlite)
  return 0
}

// Run only when executed directly, not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then(
    (code) => {
      if (code !== 0) process.exit(code)
    },
    (err: unknown) => {
      console.error(err)
      process.exit(1)
    },
  )
}
