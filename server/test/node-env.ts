import { openSqlite } from '../db'
import { applyMigrations } from '../db/migrate'
import { DEFAULT_EMAIL_FROM, type AppEnv } from '../env'
import { createApp } from '../index'

// The API tests' environment: the real app against a real SQLite database
// built by the real migrations.
//
// One database per test FILE. Vitest runs every file in its own module
// graph, so this module - and the in-memory database it opens - is created
// fresh for each file and shared by the tests inside it
// (docs/testing-and-ci.md section 5). openSqlite sets the production pragmas,
// foreign keys included.
const sqlite = openSqlite(':memory:')
applyMigrations(sqlite)

// The origin every API test sends; also the test BETTER_AUTH_URL.
export const TEST_ORIGIN = 'http://localhost:5173'

export const env: AppEnv = {
  DB: sqlite,
  BETTER_AUTH_SECRET: 'test-only-secret-at-least-32-chars-long!',
  BETTER_AUTH_URL: TEST_ORIGIN,
  EMAIL_FROM: DEFAULT_EMAIL_FROM,
  // The real build output only exists after `vite build`; tests get a small
  // fixture so static serving (and the security headers in front of it) is
  // exercisable.
  STATIC_DIR: 'server/test/fixtures/assets',
}

// The app every API test calls, built once per file from `env`. A test that
// needs another configuration or connection builds its own with createApp.
// Tests read and write the database directly through better-sqlite3 on
// `env.DB` (several statements in one transaction: `env.DB.transaction`).
export const app = createApp(env)
