-- Categories were the one user-owned table with no cap: routes/categories.ts
-- returned 201 unconditionally, and unbounded growth is reachable (import
-- gear carrying new categories, bulk-delete the gear, repeat). 500 matches
-- the gear cap, and it is the most the reorder transport can express anyway -
-- the shared reorder payload schema tops out at 500 entries, so an ordering
-- of a 501st category could never be written.
--
-- Hand-added (drizzle has no trigger DSL; the snapshot does not track it -
-- any future migration that rebuilds categories must recreate it). The
-- trigger is the SINGLE enforcement point; server/repos/categories.ts maps
-- the message to a friendly 422. Keep the message text in lockstep with that
-- matcher and with CATEGORY_CAP in shared/gear.ts.
--
-- BEFORE INSERT only, on purpose: rows already past the cap (there are none
-- expected; the merge gate verifies with a count against remote D1) survive
-- untouched and everything but creating MORE categories keeps working.
CREATE TRIGGER `categories_user_cap`
BEFORE INSERT ON `categories`
WHEN (SELECT count(*) FROM `categories` WHERE `user_id` = NEW.`user_id`) >= 500
BEGIN
  SELECT RAISE(ABORT, 'category cap exceeded (500 per user)');
END;
