import { env } from 'cloudflare:test'
import app from '../index'

const PASSWORD = 'a-long-test-password-123'
const ORIGIN = 'http://localhost:5173'

// Sign up a user, mark them verified directly in D1 (the emailed-link step
// is covered by the live smoke flow; these tests need verified users), and
// sign in. Returns the session cookie.
export async function signUpVerifiedUser(
  email: string,
  name: string,
): Promise<{ cookie: string }> {
  const signUp = await app.request(
    '/api/auth/sign-up/email',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
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
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
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
