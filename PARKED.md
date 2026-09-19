# Parked

**Reference, not policy.** The list of deferred ideas and what would un-defer
them.

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
- 2026-09-06 Real production liveness: stamp the commit SHA into the Worker at build time and report it from `/api/health`, so the deploy watchdog compares main against what Cloudflare is actually serving instead of GitHub's record of the last deploy job - trigger: a second occasion where a deployment record disagrees with production, or any deploy that changes production without recording itself. Deferred because it makes a commit id public.
- 2026-09-19 Extend `shared/deep-strict.test.ts` to cover the walker branches its fixtures cannot reach today - optional/nullable OBJECT fixtures and a response-union fixture - and narrow the comment at `shared/deep-strict.ts:10-15`, which reads as a blanket accessor-compatibility guarantee but only holds for the schemas currently exported. The suite enumerates nesting paths by hand and covers all 12 current `*ResponseSchema`s; nullable PRIMITIVES cannot demonstrate recursive strictness, so the optional/nullable-object and union branches could stop working without a test noticing. Trigger: the first response schema that composes an optional/nullable object or a union - at that point the branch becomes load-bearing for the public share DTO and the fixture is no longer hypothetical. Found by adversarial review of the PR #245 dependency bump (zod 4.5.4 to 4.6.2); the throwing-path guard `assertNoContainerChecks` IS covered and was not the gap.
