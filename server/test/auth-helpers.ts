import { env } from 'cloudflare:test'
import app from '../index'

const PASSWORD = 'a-long-test-password-123'
const ORIGIN = 'http://localhost:5173'

// Each helper-created user signs up from its own synthetic IP. Without
// this every sign-up in a test file shares the limiter's 'local' fallback
// bucket and the 11th user in a file trips the 10/day sign-up budget.
// (More realistic anyway: distinct users arrive from distinct clients.
// Tests that assert limiter behavior build their own raw requests and are
// unaffected.)
let nextClient = 0

// Sign up a user, mark them verified directly in D1 (the emailed-link step
// is covered by the live smoke flow; these tests need verified users), and
// sign in. Returns the session cookie.
export async function signUpVerifiedUser(
  email: string,
  name: string,
): Promise<{ cookie: string }> {
  nextClient += 1
  const clientIp = `10.99.${Math.floor(nextClient / 256)}.${nextClient % 256}`
  const signUp = await app.request(
    '/api/auth/sign-up/email',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        'cf-connecting-ip': clientIp,
      },
      body: JSON.stringify({ email, name, password: PASSWORD }),
    },
    env,
  )
  if (!signUp.ok) {
    throw new Error(`sign-up failed: HTTP ${signUp.status}`)
  }

  await env.DB.prepare('update user set email_verified = 1 where email = ?')
    .bind(email)
    .run()

  const signIn = await app.request(
    '/api/auth/sign-in/email',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        'cf-connecting-ip': clientIp,
      },
      body: JSON.stringify({ email, password: PASSWORD }),
    },
    env,
  )
  if (!signIn.ok) {
    throw new Error(`sign-in failed: HTTP ${signIn.status}`)
  }
  const setCookie = signIn.headers.get('set-cookie')
  const [cookie] = setCookie?.split(';') ?? []
  if (!cookie) {
    throw new Error('sign-in returned no session cookie')
  }
  return { cookie }
}
