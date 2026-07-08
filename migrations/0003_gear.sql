CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "categories_name_length" CHECK(length("categories"."name") between 1 and 128)
);
--> statement-breakpoint
CREATE INDEX `categories_user_sort_idx` ON `categories` (`user_id`,`sort_order`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `categories_id_user_unique` ON `categories` (`id`,`user_id`);--> statement-breakpoint
CREATE TABLE `gear_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category_id` text,
	`name` text NOT NULL,
	`description` text,
	`weight_grams` integer DEFAULT 0 NOT NULL,
	`cost_cents` integer,
	`purchase_date` text,
	`status` text DEFAULT 'active' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`,`user_id`) REFERENCES `categories`(`id`,`user_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "gear_items_name_length" CHECK(length("gear_items"."name") between 1 and 256),
	CONSTRAINT "gear_items_description_length" CHECK("gear_items"."description" is null or length("gear_items"."description") <= 2000),
	CONSTRAINT "gear_items_weight_range" CHECK("gear_items"."weight_grams" between 0 and 100000),
	CONSTRAINT "gear_items_cost_range" CHECK("gear_items"."cost_cents" is null or ("gear_items"."cost_cents" between 0 and 9999999999)),
	CONSTRAINT "gear_items_purchase_date_shape" CHECK("gear_items"."purchase_date" is null or "gear_items"."purchase_date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "gear_items_status_enum" CHECK("gear_items"."status" in ('active', 'needs_repair', 'loaned_out', 'need_to_buy'))
);
--> statement-breakpoint
CREATE INDEX `gear_items_user_sort_idx` ON `gear_items` (`user_id`,`sort_order`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `gear_items_id_user_unique` ON `gear_items` (`id`,`user_id`);--> statement-breakpoint
-- Hand-added (drizzle has no trigger DSL; the snapshot does not track
-- this - any future migration that rebuilds gear_items must recreate it).
-- This trigger is the SINGLE enforcement point for the cap;
-- server/repos/gear-items.ts maps its message to a friendly 422. Keep the
-- message text in lockstep with isCapError() there.
CREATE TRIGGER `gear_items_user_cap`
BEFORE INSERT ON `gear_items`
WHEN (SELECT count(*) FROM `gear_items` WHERE `user_id` = NEW.`user_id`) >= 500
BEGIN
  SELECT RAISE(ABORT, 'gear item cap exceeded (500 per user)');
END;
