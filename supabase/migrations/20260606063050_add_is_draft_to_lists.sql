-- Phase: per-list draft/complete status.
--
-- Adds public.lists.is_draft. A list is a "draft" (still being built) or not.
-- This is a completeness LABEL only: it never locks editing, and it is
-- independent of is_shared (you can share a draft for a "shakedown" review).
-- The public /r/<slug> share view renders a "work in progress" banner when
-- is_draft is true; the owner sees a "Draft" pill on every list surface.
--
-- Default flip (the important part): NEW lists must default to draft (true),
-- but EXISTING lists are already built/shared and must NOT be retroactively
-- labeled "work in progress". So we add the column with DEFAULT false - which
-- sets every existing row to false in place, no bulk UPDATE - and THEN flip the
-- default to true so future inserts are drafts.
--
-- Append-only column add: RLS policies, FK constraints, and existing query
-- results are unaffected.
alter table public.lists
  add column is_draft boolean not null default false;

alter table public.lists
  alter column is_draft set default true;

-- duplicate_list is intentionally NOT modified. It enumerates the columns it
-- copies and already omits is_shared, so duplicates reset to private. is_draft
-- follows the same "status resets, shape inherits" rule: by omitting it, a
-- duplicated row takes the table default (true), so every duplicate starts as a
-- draft - consistent with new-list creation. See the design spec, decision 8.
