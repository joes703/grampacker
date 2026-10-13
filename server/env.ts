import type { Sqlite } from './db'

// What every request handler can read from `c.env`. The Node entry
// (server/node.ts) builds ONE of these at startup from the process
// environment and passes it to every request; tests build their own
// (server/test/node-env.ts).
//
// DB is the process's single SQLite connection. Route handlers still never
// touch it: they receive user-scoped repositories from the session
// middleware (AGENTS.md "Invariants").
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

export class ConfigError extends Error {}

function required(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name]
  if (value === undefined || value === '') {
    throw new ConfigError(`${name} is not set`)
  }
  return value
}

// The non-database part of AppEnv, read from environment variables. Fails at
// startup, before the server listens, rather than on the first request that
// needs a missing value. Secret values are never included in the error text.
export function loadConfig(
  source: NodeJS.ProcessEnv,
): Omit<AppEnv, 'DB'> & { DATABASE_PATH: string; PORT: number; HOST: string } {
  const authUrl = required(source, 'BETTER_AUTH_URL')
  try {
    new URL(authUrl)
  } catch {
    throw new ConfigError('BETTER_AUTH_URL is not a valid URL')
  }
  const secret = required(source, 'BETTER_AUTH_SECRET')
  // better-auth warns below 32 characters; refuse instead, because a short
  // secret also weakens the rate limiter's email-bucket HMAC.
  if (secret.length < 32) {
    throw new ConfigError('BETTER_AUTH_SECRET must be at least 32 characters')
  }
  const port = Number(source.PORT ?? '3000')
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError('PORT is not a valid port number')
  }
  return {
    BETTER_AUTH_URL: authUrl,
    BETTER_AUTH_SECRET: secret,
    RESEND_API_KEY: source.RESEND_API_KEY || undefined,
    EMAIL_FROM: source.EMAIL_FROM || 'grampacker <no-reply@grampacker.app>',
    STATIC_DIR: source.STATIC_DIR || 'dist/client',
    DATABASE_PATH: source.DATABASE_PATH || '/data/grampacker.db',
    PORT: port,
    // Loopback by default. The container overrides this to 0.0.0.0 inside its
    // own network namespace; the host still publishes it on 127.0.0.1 only.
    HOST: source.HOST || '127.0.0.1',
  }
}
