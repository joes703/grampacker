CREATE TABLE `day_meals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`food_plan_id` text NOT NULL,
	`day_id` text NOT NULL,
	`meal_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_plan_id`,`user_id`) REFERENCES `food_plans`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`day_id`,`food_plan_id`) REFERENCES `food_plan_days`(`id`,`food_plan_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meal_id`,`food_plan_id`) REFERENCES `meals`(`id`,`food_plan_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `day_meals_plan_idx` ON `day_meals` (`food_plan_id`);--> statement-breakpoint
CREATE INDEX `day_meals_meal_idx` ON `day_meals` (`meal_id`,`food_plan_id`);--> statement-breakpoint
CREATE INDEX `day_meals_user_idx` ON `day_meals` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `day_meals_day_meal_unique` ON `day_meals` (`day_id`,`meal_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `day_meals_id_plan_unique` ON `day_meals` (`id`,`food_plan_id`);--> statement-breakpoint
CREATE TABLE `food_plan_days` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`food_plan_id` text NOT NULL,
	`day_type_override` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_plan_id`,`user_id`) REFERENCES `food_plans`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "food_plan_days_day_type_enum" CHECK("food_plan_days"."day_type_override" is null or "food_plan_days"."day_type_override" in ('full', 'partial'))
);
--> statement-breakpoint
CREATE INDEX `food_plan_days_plan_sort_idx` ON `food_plan_days` (`food_plan_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `food_plan_days_user_idx` ON `food_plan_days` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `food_plan_days_id_plan_unique` ON `food_plan_days` (`id`,`food_plan_id`);--> statement-breakpoint
CREATE TABLE `food_plan_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`food_plan_id` text NOT NULL,
	`day_meal_id` text,
	`is_extra` integer DEFAULT false NOT NULL,
	`food_item_id` text NOT NULL,
	`basis` text NOT NULL,
	`amount` real NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_plan_id`,`user_id`) REFERENCES `food_plans`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`day_meal_id`,`food_plan_id`) REFERENCES `day_meals`(`id`,`food_plan_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_item_id`,`user_id`) REFERENCES `food_items`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "food_plan_entries_basis_enum" CHECK("food_plan_entries"."basis" in ('servings', 'packages', 'weight')),
	CONSTRAINT "food_plan_entries_amount_positive" CHECK("food_plan_entries"."amount" > 0),
	CONSTRAINT "food_plan_entries_location_xor" CHECK(("food_plan_entries"."is_extra" and "food_plan_entries"."day_meal_id" is null) or (not "food_plan_entries"."is_extra" and "food_plan_entries"."day_meal_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `food_plan_entries_one_per_cell_idx` ON `food_plan_entries` (`day_meal_id`,`food_item_id`) WHERE "food_plan_entries"."day_meal_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `food_plan_entries_one_per_extras_idx` ON `food_plan_entries` (`food_plan_id`,`food_item_id`) WHERE "food_plan_entries"."is_extra";--> statement-breakpoint
CREATE INDEX `food_plan_entries_plan_sort_idx` ON `food_plan_entries` (`food_plan_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `food_plan_entries_food_idx` ON `food_plan_entries` (`food_item_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `food_plan_entries_user_idx` ON `food_plan_entries` (`user_id`);--> statement-breakpoint
CREATE TABLE `food_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "food_plans_name_length" CHECK(length("food_plans"."name") between 1 and 256)
);
--> statement-breakpoint
CREATE INDEX `food_plans_user_sort_idx` ON `food_plans` (`user_id`,`sort_order`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `food_plans_id_user_unique` ON `food_plans` (`id`,`user_id`);--> statement-breakpoint
CREATE TABLE `meals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`food_plan_id` text NOT NULL,
	`name` text NOT NULL,
	`anchor_role` text,
	`is_default` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_plan_id`,`user_id`) REFERENCES `food_plans`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "meals_name_length" CHECK(length("meals"."name") between 1 and 128),
	CONSTRAINT "meals_anchor_role_enum" CHECK("meals"."anchor_role" is null or "meals"."anchor_role" in ('breakfast', 'dinner'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meals_one_anchor_per_role_idx` ON `meals` (`food_plan_id`,`anchor_role`) WHERE "meals"."anchor_role" is not null;--> statement-breakpoint
CREATE INDEX `meals_plan_sort_idx` ON `meals` (`food_plan_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `meals_user_idx` ON `meals` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `meals_id_plan_unique` ON `meals` (`id`,`food_plan_id`);--> statement-breakpoint
-- Hand-added cap triggers (drizzle has no trigger DSL; the snapshot does not
-- track them - any future migration that rebuilds one of these tables must
-- recreate its trigger). Each is the SINGLE enforcement point for its cap;
-- server/repos/food-plans.ts maps each RAISE(ABORT) message to a friendly 422.
-- Keep every message in lockstep with the matcher there. Mirrors the
-- food_items_user_cap trigger (migration 0007).
CREATE TRIGGER `food_plans_user_cap`
BEFORE INSERT ON `food_plans`
WHEN (SELECT count(*) FROM `food_plans` WHERE `user_id` = NEW.`user_id`) >= 100
BEGIN
  SELECT RAISE(ABORT, 'food plan cap exceeded (100 per user)');
END;--> statement-breakpoint
CREATE TRIGGER `meals_plan_cap`
BEFORE INSERT ON `meals`
WHEN (SELECT count(*) FROM `meals` WHERE `food_plan_id` = NEW.`food_plan_id`) >= 20
BEGIN
  SELECT RAISE(ABORT, 'meal cap exceeded (20 per plan)');
END;--> statement-breakpoint
CREATE TRIGGER `food_plan_days_plan_cap`
BEFORE INSERT ON `food_plan_days`
WHEN (SELECT count(*) FROM `food_plan_days` WHERE `food_plan_id` = NEW.`food_plan_id`) >= 60
BEGIN
  SELECT RAISE(ABORT, 'food plan day cap exceeded (60 per plan)');
END;--> statement-breakpoint
CREATE TRIGGER `food_plan_entries_plan_cap`
BEFORE INSERT ON `food_plan_entries`
WHEN (SELECT count(*) FROM `food_plan_entries` WHERE `food_plan_id` = NEW.`food_plan_id`) >= 2000
BEGIN
  SELECT RAISE(ABORT, 'food plan entry cap exceeded (2000 per plan)');
END;