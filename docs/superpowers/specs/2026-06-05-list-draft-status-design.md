# List draft status - design

Date: 2026-06-05
Status: Proposed (pending review)

## Problem

grampacker lets a user build a trip packing list and share it read-only via a
`/r/:slug` link. A common reason to share is a "shakedown": you post the list to
a forum or hand it to a more experienced friend and ask them to critique your
gear choices.

Today the share link gives the reviewer no signal about whether the list is
finished being built. That creates two concrete problems:

1. **Reviewer can't calibrate.** A half-built list (missing items, blank
   weights, placeholder rows) looks the same as a polished, finalized one. The
   reviewer wastes effort flagging gaps the owner already knows about ("you
   forgot a sleeping pad" - "yes, still adding it").

2. **Owner has no triage signal.** A user with several lists has no way to tell
   at a glance which are still being built and which are settled. The `/lists`
   page treats every list identically.

We want a lightweight way for a list to signal **"still being built, may be
incomplete."**

## The signal means completeness, not feedback-readiness

This is the central framing decision, so it comes first.

The status is strictly about **whether the list is done being built** (complete
vs draft). It is NOT a "do/don't review this yet" signal.

This distinction matters because the primary workflow - a shakedown - shares an
*incomplete* list precisely *to collect feedback*. A "hold off judging" signal
would therefore point exactly the wrong way: the shared draft is the case where
the owner most wants eyes on the list. So the draft banner must say "expect
gaps," never "don't review."

"Whether feedback is wanted" is contextual to wherever the owner posted the link
(a forum thread, a DM); the list itself should not try to encode it. The list
only states a fact about itself: it is or isn't finished being built. A draft
that is shared is an open invitation to comment on what exists, with the
understanding that pieces are missing.

## Non-goals

- **Not a lock.** The status never prevents editing. See decision 2.
- **Not a feedback gate.** It does not say "review" or "don't review." See the
  framing section above.
- **Not a packing-progress signal.** "Done building the list" is distinct from
  "done packing for the trip" (which is what pack mode / `ready_checks_enabled`
  already covers). This is why the completion action is worded "Mark list
  complete," not a bare "complete" that could be read as "packed." See decisions
  1 and 7.
- **Not a public directory or feed.** Sharing stays per-link; there is no browse
  surface where strangers discover lists. The signal is expectation-setting on a
  link the owner deliberately shared, not trust ranking.

## What we considered and rejected up front

- **`is_shared` as a proxy for "done."** The shakedown workflow shares a list
  *while it is still a draft*, so "shared" and "done building" must be
  independent. Rejected as a proxy. (See decision 6.)
- **`ready_checks_enabled` / pack mode.** Tracks packing progress, a different
  axis. Overloading it would conflate "list is finished" with "I have physically
  packed." Rejected.

Neither existing field answers "is the owner done building this list," so a new
signal is justified.

## Design

### Decision 1: A single boolean `is_draft`, not a status enum

A list is either a draft or it isn't. Two states map to a boolean, matching the
existing `lists` column convention (`is_shared`, `group_worn`,
`ready_checks_enabled`).

We considered a 3-state enum (Draft / Ready / Final) like `gear_status`.
Rejected: the third "Final/locked" state implies the list can no longer change,
which contradicts decision 2, and "done building" needs no finer gradation than
on/off. Adding states later is cheap; starting with the enum is speculative
complexity (YAGNI).

**Reason:** simplest model that solves the problem; consistent with existing
schema; avoids a "locked" state we explicitly do not want.

### Decision 2: It is a label, never a mode - editing is always allowed

The status communicates a fact. It does not gate behavior. A complete list is
fully editable, and so is a draft.

A status that gates editing is a *mode* (unlock-to-edit, re-lock, "why can't I
change this" failure cases). A status that only communicates is a *label*. The
shakedown workflow needs you to keep editing *after* you act on critique, so
locking would actively fight the workflow.

**Reason:** locking adds friction and failure modes for zero benefit, and
contradicts the iterate-during-review workflow this feature exists to support.

### Decision 3: Default to draft for new lists; existing lists default to complete

New lists are created as drafts (`DEFAULT true`). A brand-new list genuinely is
being built, and defaulting to draft gives the `/lists` triage view something
useful from day one.

Existing lists (created before this feature) are backfilled to *not* draft
(false). Many are already shared and finished; retroactively stamping them
"work in progress" would be wrong.

Implementation: `ADD COLUMN is_draft boolean NOT NULL DEFAULT false`, then
`ALTER COLUMN is_draft SET DEFAULT true`. Adding the column with default false
sets every existing row to false in place (no bulk UPDATE); flipping the default
afterward makes future inserts draft.

**Reason:** correct default for each population - new lists are drafts, legacy
lists are not retroactively mislabeled - without a data-migration UPDATE pass.

### Decision 4: The draft state is prominent on every owner surface

The owner sees the draft state everywhere they encounter the list. It is not
buried in a settings panel. Concretely, the "Draft" pill appears on:

- `/lists` cards (`ListsPage`).
- the `/lists/:id` detail header.
- the desktop list-switcher rail rendered inside `/lists/:id`
  (`DesktopListsPanel`). Without this, other draft lists in that rail would be
  indistinguishable from complete ones, contradicting this decision.

The residual rot risk (owner forgets they left a finished list as draft) is
mitigated by prominence: an always-visible badge keeps the agency, and the
reminder, with the owner. We accept a small habituation risk as not worth
further design.

**Reason:** visibility is what keeps a manual status honest; a flag the owner
cannot see is a flag the owner cannot maintain.

### Decision 5: Header control - asymmetric, defined per state

The header pill is both indicator and control, but only in the draft state.
Complete lists stay quiet (no persistent badge), per the same instinct as
decision 5b below. The full surface x state matrix:

| Surface                         | Draft state                                   | Complete state                |
|---------------------------------|-----------------------------------------------|-------------------------------|
| `/lists` card                   | "Draft" pill (indicator only)                 | nothing                       |
| `/lists/:id` header             | "Draft" pill, clickable -> "Mark list complete" | nothing                     |
| `DesktopListsPanel` rail row    | "Draft" pill (indicator only)                 | nothing                       |
| `ListSettingsPanel`             | toggle, currently Draft -> sets complete      | toggle, currently Complete -> back to draft |
| `SharePage` (`/r/:slug`)        | banner (see 5b)                               | nothing                       |

Reverting a complete list to draft happens through the `ListSettingsPanel`
toggle, which is the canonical bidirectional control. The header pill is a
forward-only shortcut (draft -> complete) that exists only while it is needed.

**Reason:** loud where it matters (a draft you want to finish), quiet when
settled; the rare revert lives in settings rather than adding permanent header
chrome to every complete list. The settings toggle plus the header pill are one
operation surfaced twice (like a draft/publish control in an editor), not two
independent workflows.

### Decision 5b: Reviewer sees a banner only in the draft state

On the public `/r/:slug` view:

- `is_draft` true -> a banner at the top of the list:

  > **Work in progress**
  > This list is still being built and may be incomplete.

- `is_draft` false -> no banner; the list renders clean.

The absence of the warning is itself the "this is finished" signal. We rejected
a positive "Complete" badge on finished lists: it clutters the common case and
the only information-bearing state is the draft warning.

**Reason:** the banner only needs to fire when it changes reviewer behavior
(expect gaps); a finished list needs no decoration.

### Decision 6: Independent of `is_shared`

You can share a draft. Sharing and draft-status are orthogonal: share early to
collect shakedown feedback while still building, or keep a finished list private.
The public banner reads `is_draft`; the public fetch still gates on
`is_shared = true`.

**Reason:** the shakedown workflow is "share a draft for feedback," so coupling
the two would break the primary use case.

### Decision 7: Wording

- **Owner pill:** "Draft". Short, conventional, audience-neutral, pairs with an
  implicit "complete." Rejected: "WIP" (jargon, long), "Unfinished" (negative).
- **Completion action:** "Mark list complete" (and the settings toggle reverts).
  The word "list" is load-bearing: it distinguishes *list construction* from
  *packing completion* (pack mode). A bare "Mark complete" or "Mark ready" could
  be misread as "I'm packed." Rejected: "Mark as final" (implies the lock we
  rejected), "Publish" (collides with `is_shared`), "Done" (reads as trip done).
- **Reviewer banner:** the two-line block in decision 5b - a heading plus an
  "expect gaps" sentence, never "hold off judging."

**Reason:** a terse label serves the owner's glance; the verb explicitly scopes
completion to the list, not the trip; the banner states incompleteness without
discouraging the feedback a shakedown is for.

### Decision 8: Duplication always produces a draft

A duplicate is a new working list you are about to edit, so it starts as a draft
- consistent with every other new-list path (decision 3).

This needs **no change to the `duplicate_list` RPC**. The RPC enumerates the
columns it copies and already *omits* `is_shared` (so duplicates reset to
private). `is_draft` follows the same rule: "status fields reset, shape fields
inherit." Because the insert omits `is_draft`, the new row takes the table
default (`true` = draft) automatically. We document this explicitly and pin it
with a source-level regression test (asserting no `duplicate_list` definition
references `is_draft`), since the table-default behavior itself is server-side
and is not exercised by the Supabase-mocking unit suite.

**Reason:** matches the established `is_shared`-on-duplicate behavior and the
new-list default; a fork you are about to modify should not inherit a stale
"complete" marker.

## Surfaces and changes

### Data model

- Migration `*_add_list_is_draft.sql`: `ADD COLUMN is_draft boolean NOT NULL
  DEFAULT false` then `ALTER COLUMN is_draft SET DEFAULT true` (decision 3).
  `duplicate_list` is intentionally left untouched (decision 8).
- `src/lib/types.ts`:
  - add `is_draft: boolean` to `List`.
  - add `'is_draft'` to the `PublicList` Pick (currently
    `Pick<List, 'id' | 'name' | 'description' | 'group_worn'>`). Without this,
    `SharePage` cannot read the field even though the query selects it. Exposing
    `is_draft` publicly is a deliberate, reviewed widening of the public surface
    (unlike `status` / `cost` / `user_id`, which the Pick omits).
- `src/lib/queries/lists.ts`:
  - `updateList`: add `'is_draft'` to the `Pick<...>` whitelist (currently
    `name | description | is_shared | group_worn | ready_checks_enabled`).
  - `fetchSharedList`: add `is_draft` to the select string (currently
    `'id, name, description, group_worn'`).
- `src/lib/optimistic-list-placeholder.ts`: add `is_draft: true` to the
  constructed `List` (it sets every field today; a new required field breaks the
  build until added).

### Owner UI

- `ListsPage` cards: "Draft" pill on draft lists; nothing on complete.
- `/lists/:id` detail header: clickable "Draft" pill -> "Mark list complete"
  (draft state); nothing (complete state). Per decision 5 matrix.
- `DesktopListsPanel` rail rows: "Draft" pill on draft lists (indicator only).
  The row component is fed each `list`; surface `is_draft` to it.
- `ListSettingsPanel`: a bidirectional toggle between Draft and Complete next to
  Sharing / Group worn - the canonical control, and the only way to revert a
  complete list to draft.

### Reviewer UI

- `SharePage` (`src/lists/SharePage.tsx`): render the two-line banner when
  `is_draft` is true (decision 5b).

### Data flow / caching

`is_draft` is a list-only field; it does not touch the `list_items.gear_item`
join. The mutation does an optimistic update on the `['lists']` cache only, with
**no `['list-items']` invalidation** (per the CLAUDE.md rule: do not widen
invalidation past the actual data flow).

## Verification

- Build with `npm run build` (the project's stricter project-reference check;
  `tsc --noEmit` is not equivalent, per CLAUDE.md). This also catches the
  `optimisticListPlaceholder` and `PublicList` type changes.
- Tests:
  - `src/lib/queries/shared-projections.test.ts`
    (`describe('fetchSharedList ...')`): update the pinned select string from
    `'id, name, description, group_worn'` to include `is_draft`, and update the
    pinned `PublicList` key set from `['description', 'group_worn', 'id',
    'name']` to include `'is_draft'`. These assertions exist to lock the public
    projection; the change must go through them deliberately.
  - `updateList` round-trips `is_draft`.
  - `SharePage` renders the banner when `is_draft` is true and omits it when
    false (integration test mocking the public queries).
  - Duplicate-default guard: a source-level regression test asserts no
    `duplicate_list` definition threads `is_draft`, so duplicates keep inheriting
    the table default (`true` = draft). The end-to-end server behavior is checked
    manually (duplicate a complete list, confirm the copy is a draft), since the
    unit suite mocks Supabase and cannot exercise the real default.

## Open questions

None blocking. Possible future extensions (explicitly out of scope now): a
filter/sort on `/lists` by draft state; a "mark list complete" nudge when first
sharing a draft.
