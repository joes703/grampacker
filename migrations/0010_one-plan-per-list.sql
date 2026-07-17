-- One plan per trip (design revision 2026-07-16, supersedes 12.1/12.9): a food
-- plan backs AT MOST ONE list. Reuse is duplication, never sharing.
--
-- Step 1 (hand-written): defensively detach all but one list per plan, in case
-- any plan already backs several. Deterministic winner: the most recently
-- updated list keeps the plan; ties break on the larger id. Runs BEFORE the
-- index so index creation cannot fail on pre-existing shared links. No
-- food_pack_state exists yet (slice 4 unbuilt), so there is nothing else to
-- clear. The winner rule is regression-tested by EXPECTED_CHANGES fixtures in
-- scripts/check-migration-safety.mjs.
UPDATE lists SET food_plan_id = NULL
 WHERE food_plan_id IS NOT NULL
   AND id NOT IN (
     SELECT id FROM (
       SELECT id, ROW_NUMBER() OVER (
         PARTITION BY food_plan_id
         ORDER BY updated_at DESC, id DESC
       ) AS rn
       FROM lists WHERE food_plan_id IS NOT NULL
     ) WHERE rn = 1
   );
--> statement-breakpoint
CREATE UNIQUE INDEX `lists_food_plan_id_unique` ON `lists` (`food_plan_id`) WHERE "lists"."food_plan_id" is not null;