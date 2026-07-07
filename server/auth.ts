import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createDb } from './db'
import { createEmailSender } from './email'

// Shared between the runtime factory below and the CLI schema config
// (auth-schema.config.ts). Schema-affecting options (adapter provider,
// plugins) MUST live here so the generated tables cannot drift from runtime.
export function authOptions(env: Env) {
  const db = createDb(env.DB)
  const email = createEmailSender(env)

  return {
    database: drizzleAdapter(db, { provider: 'sqlite' as const }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    emailAndPassword: {
      enabled: true,
      // Public signup: unverified accounts must be inert (decision 13.2).
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
        await email.send({
          to: user.email,
          subject: 'Reset your grampacker password',
          html: `<p>Reset your grampacker password: <a href="${url}">${url}</a></p><p>If you did not request this, ignore this email.</p>`,
          text: `Reset your grampacker password: ${url}\n\nIf you did not request this, ignore this email.`,
        })
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
        await email.send({
          to: user.email,
          subject: 'Verify your grampacker email',
          html: `<p>Confirm your grampacker account: <a href="${url}">${url}</a></p>`,
          text: `Confirm your grampacker account: ${url}`,
        })
      },
    },
    session: {
      // Generous on purpose: no sensitive data (decision 13.2).
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // sliding: refresh the expiry at most daily
    },
    advanced: {
      defaultCookieAttributes: {
        sameSite: 'strict' as const,
      },
    },
  }
}

// Workers get fresh bindings per request, so the auth instance is built per
// request. This is config wiring only - no I/O happens until a handler runs.
export function createAuth(env: Env) {
  return betterAuth(authOptions(env))
}

export type Auth = ReturnType<typeof createAuth>
