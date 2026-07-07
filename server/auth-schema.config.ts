import { betterAuth } from 'better-auth'
import { authOptions } from './auth'

// CLI-only config for `npx @better-auth/cli generate`, which runs in Node
// with no Worker bindings. The fake Env carries only what authOptions reads
// during schema generation (adapter provider + plugins - it never touches
// the database or sends email). The unknown-cast is deliberate: the exact
// Env shape from `wrangler types` differs between machines with and without
// .dev.vars, so a plain `as Env` typechecks on one and fails on the other.
// Runtime uses createAuth(env) in server/auth.ts with the real Env.
const fakeEnv = {
  DB: {} as D1Database,
  BETTER_AUTH_SECRET: 'schema-generation-only',
  BETTER_AUTH_URL: 'http://localhost:5173',
} as unknown as Env

export const auth = betterAuth(authOptions(fakeEnv))
