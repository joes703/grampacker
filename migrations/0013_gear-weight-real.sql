-- gear_items.weight_grams: integer -> real, so gear can carry tenths of a
-- gram. SQLite cannot ALTER a column type, so this is a full table rebuild.
--
-- The drizzle-kit output for this rebuild is UNSAFE in three ways, all fixed
-- below. Same class of trap as 0009_food-plan-link.sql; see its header for the
-- D1 details (PRAGMA foreign_keys=OFF is a no-op there - the backup is what
-- protects the data, not the pragma).
--
--   1. `DROP TABLE gear_items` fires list_items -> gear_items ON DELETE
--      CASCADE and WIPES EVERY MEMBERSHIP ROW. list_items is the only table
--      that cascades from gear_items (food_pack_state hangs off lists and
--      food_items, not list_items), so one backup covers it.
--   2. drizzle-kit recreates the indexes AFTER the rebuild. The list_items ->
--      gear_items composite FK targets (id, user_id), so
--      `gear_items_id_user_unique` must exist BEFORE the restore or the
--      INSERT fails "foreign key mismatch".
--   3. drizzle has no trigger DSL and the snapshot does not track triggers, so
--      the generated SQL silently drops `gear_items_user_cap` - the SINGLE
--      enforcement point for the 500-item-per-user cap (see 0003_gear.sql).
--      Losing it is permanent and invisible. It is recreated below verbatim.
--
-- Note this migration is a no-op for stored VALUES: SQLite INTEGER affinity
-- already stores 12.4 as REAL. The point is to make the declared type state
-- the contract, so schema generation and any future STRICT table agree with
-- what the application actually writes.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__backup_list_items` AS SELECT * FROM `list_items`;--> statement-breakpoint
CREATE TABLE `__new_gear_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category_id` text,
	`name` text NOT NULL,
	`description` text,
	`weight_grams` real DEFAULT 0 NOT NULL,
	`cost_cents` integer,
	`purchase_date` text,
	`status` text DEFAULT 'active' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`,`user_id`) REFERENCES `categories`(`id`,`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "gear_items_name_length" CHECK(length("__new_gear_items"."name") between 1 and 256),
	CONSTRAINT "gear_items_description_length" CHECK("__new_gear_items"."description" is null or length("__new_gear_items"."description") <= 2000),
	CONSTRAINT "gear_items_weight_range" CHECK("__new_gear_items"."weight_grams" between 0 and 100000),
	CONSTRAINT "gear_items_cost_range" CHECK("__new_gear_items"."cost_cents" is null or ("__new_gear_items"."cost_cents" between 0 and 9999999999)),
	CONSTRAINT "gear_items_purchase_date_shape" CHECK("__new_gear_items"."purchase_date" is null or "__new_gear_items"."purchase_date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "gear_items_status_enum" CHECK("__new_gear_items"."status" in ('active', 'needs_repair', 'loaned_out', 'need_to_buy'))
);
--> statement-breakpoint
INSERT INTO `__new_gear_items`("id", "user_id", "category_id", "name", "description", "weight_grams", "cost_cents", "purchase_date", "status", "sort_order", "created_at", "updated_at") SELECT "id", "user_id", "category_id", "name", "description", "weight_grams", "cost_cents", "purchase_date", "status", "sort_order", "created_at", "updated_at" FROM `gear_items`;--> statement-breakpoint
DROP TABLE `gear_items`;--> statement-breakpoint
ALTER TABLE `__new_gear_items` RENAME TO `gear_items`;--> statement-breakpoint
-- Indexes BEFORE the list_items restore: the composite FK needs
-- gear_items_id_user_unique to already be a unique key on the parent.
CREATE INDEX `gear_items_user_sort_idx` ON `gear_items` (`user_id`,`sort_order`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `gear_items_id_user_unique` ON `gear_items` (`id`,`user_id`);--> statement-breakpoint
-- Recreated verbatim from 0003_gear.sql. drizzle cannot see this; keep the
-- message text in lockstep with isCapError() in server/repos/gear-items.ts.
CREATE TRIGGER `gear_items_user_cap`
BEFORE INSERT ON `gear_items`
WHEN (SELECT count(*) FROM `gear_items` WHERE `user_id` = NEW.`user_id`) >= 500
BEGIN
  SELECT RAISE(ABORT, 'gear item cap exceeded (500 per user)');
END;--> statement-breakpoint
-- Restore the membership rows the DROP cascade removed. Columns named
-- explicitly so the restore cannot silently depend on column order.
INSERT INTO `list_items`("id", "user_id", "list_id", "gear_item_id", "quantity", "is_worn", "is_consumable", "is_packed", "is_ready", "sort_order", "created_at", "updated_at") SELECT "id", "user_id", "list_id", "gear_item_id", "quantity", "is_worn", "is_consumable", "is_packed", "is_ready", "sort_order", "created_at", "updated_at" FROM `__backup_list_items`;--> statement-breakpoint
DROP TABLE `__backup_list_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
