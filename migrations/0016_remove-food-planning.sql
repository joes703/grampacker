-- Remove food planning: drop its ten tables and the `lists.food_plan_id` link.
--
-- Dropping the column needs a full `lists` rebuild (SQLite cannot ALTER-DROP a
-- column carrying a table-level FK), and that rebuild is destructive on D1 in a
-- way `PRAGMA foreign_keys=OFF` CANNOT prevent - D1 applies migrations with
-- foreign-key enforcement ON and the pragma is a no-op there (verified when
-- migration 0009 hit exactly this). `DROP TABLE lists` performs an implicit
-- DELETE of every list row, firing every ON DELETE CASCADE that points at it.
--
-- Since 0009 that is no longer just `list_items`: 0014 added `packing_locations`,
-- which also cascades from `lists`. BOTH are snapshotted and restored here. The
-- drizzle-kit output (which only wraps the rebuild in foreign_keys=OFF) would
-- wipe every membership row AND every packing location in production.
--
-- The two tables reference each other (list_items.packing_location_id ->
-- packing_locations, packing_locations.container_list_item_id -> list_items), so
-- the restore lands in FK order: locations first with no container link, then
-- items, then the container links by UPDATE. Same dance the repo's list
-- duplication uses for the same cycle.
-- ORDER MATTERS, and it is the reverse of what reads naturally. The food
-- tables are dropped LAST, because `lists` references food_plans until the
-- rebuild below removes that column - and with enforcement on, dropping a
-- table that something still points at fails outright.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__backup_list_items` AS SELECT * FROM `list_items`;--> statement-breakpoint
CREATE TABLE `__backup_packing_locations` AS SELECT * FROM `packing_locations`;--> statement-breakpoint
CREATE TABLE `__new_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`slug` text NOT NULL,
	`is_shared` integer DEFAULT false NOT NULL,
	`group_worn` integer DEFAULT false NOT NULL,
	`ready_checks_enabled` integer DEFAULT false NOT NULL,
	`is_draft` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "lists_name_length" CHECK(length("__new_lists"."name") between 1 and 256),
	CONSTRAINT "lists_description_length" CHECK("__new_lists"."description" is null or length("__new_lists"."description") <= 2000),
	CONSTRAINT "lists_slug_shape" CHECK(length("__new_lists"."slug") = 6)
);
--> statement-breakpoint
-- food_plan_id is omitted from the copy: this migration removes it.
INSERT INTO `__new_lists`("id", "user_id", "name", "description", "slug", "is_shared", "group_worn", "ready_checks_enabled", "is_draft", "sort_order", "created_at", "updated_at") SELECT "id", "user_id", "name", "description", "slug", "is_shared", "group_worn", "ready_checks_enabled", "is_draft", "sort_order", "created_at", "updated_at" FROM `lists`;--> statement-breakpoint
DROP TABLE `lists`;--> statement-breakpoint
ALTER TABLE `__new_lists` RENAME TO `lists`;--> statement-breakpoint
-- Recreate the indexes BEFORE restoring the children: both child tables carry a
-- composite FK onto (id, user_id), so `lists_id_user_unique` must already exist
-- or the restore INSERTs fail "foreign key mismatch" - the parent key is not a
-- unique key until then.
CREATE INDEX `lists_user_sort_idx` ON `lists` (`user_id`,`sort_order`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `lists_id_user_unique` ON `lists` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `lists_slug_unique` ON `lists` (`slug`);--> statement-breakpoint
-- Locations first, with container_list_item_id forced NULL: the rows it points
-- at do not exist yet. The real values come back in the UPDATE below.
INSERT INTO `packing_locations`("id", "user_id", "list_id", "name", "container_list_item_id", "sort_order", "created_at", "updated_at") SELECT "id", "user_id", "list_id", "name", NULL, "sort_order", "created_at", "updated_at" FROM `__backup_packing_locations`;--> statement-breakpoint
INSERT INTO `list_items`("id", "user_id", "list_id", "gear_item_id", "quantity", "is_worn", "is_consumable", "is_packed", "is_ready", "packing_location_id", "sort_order", "created_at", "updated_at") SELECT "id", "user_id", "list_id", "gear_item_id", "quantity", "is_worn", "is_consumable", "is_packed", "is_ready", "packing_location_id", "sort_order", "created_at", "updated_at" FROM `__backup_list_items`;--> statement-breakpoint
-- Now that the items exist, restore the container links.
UPDATE `packing_locations` SET `container_list_item_id` = (SELECT `container_list_item_id` FROM `__backup_packing_locations` WHERE `__backup_packing_locations`.`id` = `packing_locations`.`id`);--> statement-breakpoint
DROP TABLE `__backup_list_items`;--> statement-breakpoint
DROP TABLE `__backup_packing_locations`;--> statement-breakpoint
-- Safe now: the rebuilt `lists` has no food_plan_id, so nothing outside the
-- food set references any of it. Children before parents within the set.
DROP TABLE `day_meals`;--> statement-breakpoint
DROP TABLE `food_pack_state`;--> statement-breakpoint
DROP TABLE `food_plan_daily_targets`;--> statement-breakpoint
DROP TABLE `meal_targets`;--> statement-breakpoint
DROP TABLE `food_plan_entries`;--> statement-breakpoint
DROP TABLE `food_plan_days`;--> statement-breakpoint
DROP TABLE `meals`;--> statement-breakpoint
DROP TABLE `food_plan_target_defaults`;--> statement-breakpoint
DROP TABLE `food_items`;--> statement-breakpoint
DROP TABLE `food_plans`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
-- Recreate the per-user list cap trigger. The rebuild dropped it with the old
-- `lists` table: triggers are not in the drizzle model, so drizzle-kit cannot
-- regenerate them (the caveat migrations 0004 and 0009 both document). Identical
-- to the 0009 definition; keep the WHEN clause and RAISE message in lockstep
-- with server/repos/lists.ts (isListCapError).
CREATE TRIGGER `lists_user_cap`
BEFORE INSERT ON `lists`
WHEN (SELECT count(*) FROM `lists` WHERE `user_id` = NEW.`user_id`) >= 100
BEGIN
  SELECT RAISE(ABORT, 'list cap exceeded (100 per user)');
END;
