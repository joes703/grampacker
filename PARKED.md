# Parked

Ideas deliberately deferred, each with the condition that would un-defer it.
Nothing here is rejected - an idea with no trigger does not belong on this
list, it belongs in the bin.

The original framing said these waited for "the rewrite to reach parity and
the Supabase version to die". That happened; the framing was replaced
2026-08-11 with the per-idea triggers below, which are the part that was
actually load-bearing. (It also pointed at DECISIONS/ADRs, which have never
existed.)

One line per idea, date it, say what would change your mind.

Format: `- YYYY-MM-DD <idea> - <why it waits>`

- 2026-07-07 Turnstile on signup - trigger: first observed signup abuse. Free and CF-native, but a third-party script + CSP change is not justified pre-abuse; rate limiting + required verification carry until then.
- 2026-07-07 Google social login - better-auth makes it a config-level add; wait for an actual reason.
- 2026-07-07 Apple social login - blocked by cost-zero (Apple Developer Program is $99/year).
- 2026-07-07 Cloudflare Email Service - re-adopt for auth email only if the account lands on Workers Paid anyway (free path covers verified destinations only; public signup needs arbitrary recipients). See REWRITE_PLAN.md decisions 13.1-13.2.
