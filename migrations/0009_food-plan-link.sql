-- Adding food_plan_id + its composite (food_plan_id, user_id) FK to `lists`
-- needs a full table rebuild: SQLite cannot ALTER-ADD a table-level FK.
--
-- On D1 that rebuild is destructive in a way `PRAGMA foreign_keys=OFF` CANNOT
-- prevent. D1 applies migrations with foreign-key enforcement ON, and the
-- pragma is a no-op in that context (verified against D1: both foreign_keys=OFF
-- AND defer_foreign_keys still let the cascade fire - the latter defers the
-- CHECK, not the cascade ACTION). So `DROP TABLE lists` performs an implicit
-- DELETE of every list row, which fires `list_items -> lists ON DELETE CASCADE`
-- and would WIPE EVERY MEMBERSHIP ROW in production. The drizzle-kit output
-- (which just wraps the rebuild in foreign_keys=OFF) is therefore unsafe here.
--
-- Fix: snapshot list_items into a scratch table before the rebuild and restore
-- it afterward. list_items is the ONLY table that cascades from lists in this
-- slice (food_pack_state arrives in slice 4). The pragmas are kept for drizzle
-- convention but are NOT what protects the data - the backup is.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__backup_list_items` AS SELECT * FROM `list_items`;--> statement-breakpoint
CREATE TABLE `__new_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`slug` text NOT NULL,
	`food_plan_id` text,
	`is_shared` integer DEFAULT false NOT NULL,
	`group_worn` integer DEFAULT false NOT NULL,
	`ready_checks_enabled` integer DEFAULT false NOT NULL,
	`is_draft` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_plan_id`,`user_id`) REFERENCES `food_plans`(`id`,`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "lists_name_length" CHECK(length("__new_lists"."name") between 1 and 256),
	CONSTRAINT "lists_description_length" CHECK("__new_lists"."description" is null or length("__new_lists"."description") <= 2000),
	CONSTRAINT "lists_slug_shape" CHECK(length("__new_lists"."slug") = 6)
);
--> statement-breakpoint
-- food_plan_id is omitted from the copy: the OLD lists table has no such column
-- (this migration adds it), and every existing row starts with no plan, so it
-- defaults to NULL.
INSERT INTO `__new_lists`("id", "user_id", "name", "description", "slug", "is_shared", "group_worn", "ready_checks_enabled", "is_draft", "sort_order", "created_at", "updated_at") SELECT "id", "user_id", "name", "description", "slug", "is_shared", "group_worn", "ready_checks_enabled", "is_draft", "sort_order", "created_at", "updated_at" FROM `lists`;--> statement-breakpoint
DROP TABLE `lists`;--> statement-breakpoint
ALTER TABLE `__new_lists` RENAME TO `lists`;--> statement-breakpoint
-- Recreate the indexes BEFORE restoring list_items: the list_items -> lists
-- composite FK targets (id, user_id), so `lists_id_user_unique` must already
-- exist or the restore INSERT fails "foreign key mismatch" (the parent key is
-- not a unique key yet).
CREATE INDEX `lists_user_sort_idx` ON `lists` (`user_id`,`sort_order`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `lists_id_user_unique` ON `lists` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `lists_slug_unique` ON `lists` (`slug`);--> statement-breakpoint
-- Restore the membership rows the DROP cascade removed. lists now holds every
-- id/user_id again (with the unique index above), so the list_items -> lists
-- composite FK is satisfied; the list_items table (and its cap trigger) were
-- never dropped, only emptied. Columns are named explicitly so the restore
-- cannot silently depend on column order.
INSERT INTO `list_items`("id", "user_id", "list_id", "gear_item_id", "quantity", "is_worn", "is_consumable", "is_packed", "is_ready", "sort_order", "created_at", "updated_at") SELECT "id", "user_id", "list_id", "gear_item_id", "quantity", "is_worn", "is_consumable", "is_packed", "is_ready", "sort_order", "created_at", "updated_at" FROM `__backup_list_items`;--> statement-breakpoint
DROP TABLE `__backup_list_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
-- Recreate the per-user list cap trigger. The table rebuild above dropped it
-- along with the old `lists` table: triggers are not in the drizzle model, so
-- drizzle-kit cannot regenerate them (the same caveat migration 0004 documents
-- for exactly this reason). Identical to the 0004 definition; keep the WHEN
-- clause and RAISE message in lockstep with server/repos/lists.ts (isListCapError).
CREATE TRIGGER `lists_user_cap`
BEFORE INSERT ON `lists`
WHEN (SELECT count(*) FROM `lists` WHERE `user_id` = NEW.`user_id`) >= 100
BEGIN
  SELECT RAISE(ABORT, 'list cap exceeded (100 per user)');
END;
