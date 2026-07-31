-- Food estimate: three additive tables. Nothing existing changes shape, so
-- there is no table rebuild here and none of the cascade danger migrations 0009
-- and 0016 hit (dropping a parent on D1 cascade-deletes children, and
-- PRAGMA foreign_keys=OFF is inert there - see 0016's header).
--
-- Reordered from drizzle-kit's output so parents precede the association table.
-- SQLite tolerates a forward FK reference, but a migration that reads in
-- dependency order is one fewer thing for the next person to verify.
--
-- The typeof() clauses in the day_number and quantity CHECKs are deliberate:
-- these are not STRICT tables, so an `integer` column stores 1.5 quite happily,
-- and a fractional quantity makes a 500 g item weigh 750 g. They have to be
-- here rather than added later, because adding a CHECK to an existing table
-- means a rebuild, and these tables have cascading children.

CREATE TABLE `list_food_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`list_id` text NOT NULL,
	`day_number` integer NOT NULL,
	`meal` text NOT NULL,
	`needed` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`,`user_id`) REFERENCES `lists`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "list_food_slots_meal_enum" CHECK("list_food_slots"."meal" in ('breakfast', 'lunch', 'dinner')),
	CONSTRAINT "list_food_slots_day_range" CHECK(typeof("list_food_slots"."day_number") = 'integer' and "list_food_slots"."day_number" between 1 and 30)
);--> statement-breakpoint
CREATE INDEX `list_food_slots_list_day_idx` ON `list_food_slots` (`list_id`,`day_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `list_food_slots_id_user_unique` ON `list_food_slots` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `list_food_slots_id_list_user_unique` ON `list_food_slots` (`id`,`list_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `list_food_slots_day_meal_unique` ON `list_food_slots` (`list_id`,`day_number`,`meal`);--> statement-breakpoint
CREATE TABLE `list_food_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`list_id` text NOT NULL,
	`name` text NOT NULL,
	`weight_grams` real NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`,`user_id`) REFERENCES `lists`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "list_food_items_name_length" CHECK(length("list_food_items"."name") between 1 and 128),
	CONSTRAINT "list_food_items_weight_range" CHECK("list_food_items"."weight_grams" between 0 and 100000),
	CONSTRAINT "list_food_items_quantity_range" CHECK(typeof("list_food_items"."quantity") = 'integer' and "list_food_items"."quantity" between 1 and 9999)
);--> statement-breakpoint
CREATE INDEX `list_food_items_list_sort_idx` ON `list_food_items` (`list_id`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `list_food_items_id_user_unique` ON `list_food_items` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `list_food_items_id_list_user_unique` ON `list_food_items` (`id`,`list_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `list_food_item_slots` (
	`food_item_id` text NOT NULL,
	`slot_id` text NOT NULL,
	`user_id` text NOT NULL,
	`list_id` text NOT NULL,
	PRIMARY KEY(`food_item_id`, `slot_id`),
	FOREIGN KEY (`food_item_id`,`list_id`,`user_id`) REFERENCES `list_food_items`(`id`,`list_id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`slot_id`,`list_id`,`user_id`) REFERENCES `list_food_slots`(`id`,`list_id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`,`user_id`) REFERENCES `lists`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
CREATE INDEX `list_food_item_slots_slot_idx` ON `list_food_item_slots` (`slot_id`);--> statement-breakpoint
CREATE INDEX `list_food_item_slots_list_idx` ON `list_food_item_slots` (`list_id`);--> statement-breakpoint
-- Carried food entries per list. drizzle has no trigger DSL, so this is the
-- single enforcement point; the food repo (checkpoint 2) must map its
-- RAISE(ABORT) text to a friendly 422. Keep in lockstep with FOOD_ITEM_CAP in
-- shared/food.ts.
--
-- There is deliberately NO equivalent cap on list_food_slots: that table holds
-- three rows per day, so a row-count trigger of 30 would silently cap the trip
-- at ten days. The day ceiling is the day_number CHECK instead.
CREATE TRIGGER `list_food_items_list_cap`
BEFORE INSERT ON `list_food_items`
WHEN (SELECT count(*) FROM `list_food_items` WHERE `list_id` = NEW.`list_id`) >= 200
BEGIN
  SELECT RAISE(ABORT, 'food item cap exceeded (200 per list)');
END;
