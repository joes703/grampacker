// Secrets are not visible to `wrangler types` (they live in .dev.vars
// locally and `wrangler secret` in production), so they are declared here
// and merge into the generated Env interface.
interface Env {
  BETTER_AUTH_SECRET: string
  // Absent in local dev - createEmailSender falls back to the console
  // sender and prints verification/reset URLs to the dev log.
  RESEND_API_KEY?: string
}
