import { z } from 'zod'
import type { Auth } from './auth'
import type { Db, Sqlite } from './db'

// The configuration and database connection the app is built from. The
// Node entry (server/node.ts) builds one at startup from the process
// environment; tests build their own (server/test/node-env.ts).
//
// DB is the process's single SQLite connection. Route handlers never touch
// it: they receive user-scoped repositories from the session middleware
// (AGENTS.md "Invariants").
export type AppEnv = {
  DB: Sqlite
  // The one canonical origin. better-auth's baseURL, the passkey origin and
  // RP ID, the CSRF origin check, and dev/prod detection all derive from it.
  BETTER_AUTH_URL: string
  BETTER_AUTH_SECRET: string
  // Absent in local dev - createEmailSender falls back to the console sender
  // and prints magic-link URLs to the dev log. Absent anywhere else, magic-link
  // sends fail closed (server/email/index.ts).
  RESEND_API_KEY?: string
  EMAIL_FROM: string
  // Directory holding the built SPA (index.html and assets/).
  STATIC_DIR: string
}

// What every request reads from `c.env`: the configuration plus what
// createApp (server/index.ts) builds from it once, at startup. Route
// handlers still never touch `db`: they receive user-scoped repositories
// from the session middleware.
export type AppDeps = AppEnv & {
  db: Db
  auth: Auth
  // A localhost BETTER_AUTH_URL selects the dev header set and email sender.
  dev: boolean
  // The origin the CSRF check accepts.
  origin: string
}

export class ConfigError extends Error {}

export const DEFAULT_EMAIL_FROM = 'grampacker <no-reply@grampacker.app>'

// An empty string (a blank line in an env file) means "not set".
const unset = (value: unknown) => (value === '' ? undefined : value)
const optional = (fallback: string) => z.preprocess(unset, z.string().default(fallback))
const required = (name: string) => z.preprocess(unset, z.string({ error: `${name} is not set` }))
const BAD_PORT = { error: 'PORT is not a valid port number' }

// Every message is fixed text: no secret value can appear in an error.
const configSchema = z.object({
  BETTER_AUTH_URL: required('BETTER_AUTH_URL').pipe(
    z.url({ error: 'BETTER_AUTH_URL is not a valid URL' }),
  ),
  // better-auth warns below 32 characters; refuse instead, because a short
  // secret also weakens the rate limiter's email-bucket HMAC.
  BETTER_AUTH_SECRET: required('BETTER_AUTH_SECRET').pipe(
    z.string().min(32, { error: 'BETTER_AUTH_SECRET must be at least 32 characters' }),
  ),
  RESEND_API_KEY: z.preprocess(unset, z.string().optional()),
  EMAIL_FROM: optional(DEFAULT_EMAIL_FROM),
  STATIC_DIR: optional('dist/client'),
  DATABASE_PATH: optional('/data/grampacker.db'),
  PORT: z.coerce.number(BAD_PORT).int(BAD_PORT).min(0, BAD_PORT).max(65535, BAD_PORT).default(3000),
  // Loopback by default. The container overrides this to 0.0.0.0 inside its
  // own network namespace; the host still publishes it on 127.0.0.1 only.
  HOST: optional('127.0.0.1'),
})

// The non-database part of AppEnv, read from environment variables. Fails at
// startup, before the server listens, rather than on the first request that
// needs a missing value.
export function loadConfig(
  source: NodeJS.ProcessEnv,
): Omit<AppEnv, 'DB'> & { DATABASE_PATH: string; PORT: number; HOST: string } {
  const result = configSchema.safeParse(source)
  if (!result.success) throw new ConfigError(result.error.issues[0]?.message ?? 'invalid configuration')
  return result.data
}
