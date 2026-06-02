import { createClient } from '@supabase/supabase-js'

function requireEnv(name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY'): string {
  const value = import.meta.env[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Add it to your .env or .env.local and restart the dev server.`,
    )
  }
  return value
}

const supabaseUrl = requireEnv('VITE_SUPABASE_URL')
const supabaseAnonKey = requireEnv('VITE_SUPABASE_ANON_KEY')

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Opt in to the WebAuthn/passkey APIs (signInWithPasskey,
    // registerPasskey, auth.passkey.*). Without this flag auth-js throws a
    // descriptive error at call time. Passkeys are enabled in the Supabase
    // dashboard (Authentication -> Passkeys) with the Relying Party scoped
    // to the production domain; see src/lib/passkey.ts for the client flow.
    experimental: { passkey: true },
  },
})
