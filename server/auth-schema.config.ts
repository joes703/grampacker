import { betterAuth } from 'better-auth'
import { authOptions } from './auth'

// CLI-only config for `npx @better-auth/cli generate`, which runs in Node
// with no Worker bindings. The fake Env satisfies authOptions; schema
// generation only inspects adapter provider + plugins, it never touches the
// database or sends email. Runtime uses createAuth(env) in server/auth.ts.
const fakeEnv = {
  DB: {} as D1Database,
  ASSETS: {} as Fetcher,
  BETTER_AUTH_SECRET: 'schema-generation-only',
  BETTER_AUTH_URL: 'http://localhost:5173',
} as Env

export const auth = betterAuth(authOptions(fakeEnv))
