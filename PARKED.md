# Parked

Ideas deliberately deferred until the rewrite reaches parity and the
Supabase version is dead (REWRITE_PLAN.md section 2: scope freeze). Nothing
here is rejected - rejected ideas are recorded in DECISIONS/ADRs instead.
One line per idea, date it, say why it waits.

Format: `- YYYY-MM-DD <idea> - <why it waits>`

- 2026-07-07 Turnstile on signup - trigger: first observed signup abuse. Free and CF-native, but a third-party script + CSP change is not justified pre-abuse; rate limiting + required verification carry until then.
- 2026-07-07 Google social login - better-auth makes it a config-level add; wait for an actual reason.
- 2026-07-07 Apple social login - blocked by cost-zero (Apple Developer Program is $99/year).
- 2026-07-07 Cloudflare Email Service - re-adopt for auth email only if the account lands on Workers Paid anyway (free path covers verified destinations only; public signup needs arbitrary recipients). See REWRITE_PLAN.md decisions 13.1-13.2.
