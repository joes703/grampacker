import { betterAuth } from 'better-auth'
import { authOptions } from './auth'
import type { Sqlite } from './db'
import type { AppEnv } from './env'

// CLI-only config for `npx @better-auth/cli generate`. The fake env carries
// only what authOptions reads during schema generation (adapter provider +
// plugins - it never touches the database or sends email), so DB is an empty
// stand-in. Runtime constructs from authOptions in server/auth.ts
// (createAuth per /api/auth/* request, sessionAuth for the session gate)
// with the real env.
const fakeEnv: AppEnv = {
  DB: {} as Sqlite,
  BETTER_AUTH_SECRET: 'schema-generation-only',
  BETTER_AUTH_URL: 'http://localhost:5173',
  EMAIL_FROM: 'grampacker <no-reply@grampacker.app>',
  STATIC_DIR: 'dist/client',
}

export const auth = betterAuth(authOptions(fakeEnv))
