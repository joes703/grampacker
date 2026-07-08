CREATE TABLE `list_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`list_id` text NOT NULL,
	`gear_item_id` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`is_worn` integer DEFAULT false NOT NULL,
	`is_consumable` integer DEFAULT false NOT NULL,
	`is_packed` integer DEFAULT false NOT NULL,
	`is_ready` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`,`user_id`) REFERENCES `lists`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`gear_item_id`,`user_id`) REFERENCES `gear_items`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "list_items_quantity_range" CHECK("list_items"."quantity" between 1 and 9999),
	CONSTRAINT "list_items_worn_xor_consumable" CHECK(not ("list_items"."is_worn" and "list_items"."is_consumable"))
);
--> statement-breakpoint
CREATE INDEX `list_items_user_list_sort_idx` ON `list_items` (`user_id`,`list_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `list_items_list_sort_idx` ON `list_items` (`list_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `list_items_gear_item_user_idx` ON `list_items` (`gear_item_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `lists` (
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
	CONSTRAINT "lists_name_length" CHECK(length("lists"."name") between 1 and 256),
	CONSTRAINT "lists_description_length" CHECK("lists"."description" is null or length("lists"."description") <= 2000),
	CONSTRAINT "lists_slug_shape" CHECK(length("lists"."slug") = 6)
);
--> statement-breakpoint
CREATE INDEX `lists_user_sort_idx` ON `lists` (`user_id`,`sort_order`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `lists_id_user_unique` ON `lists` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `lists_slug_unique` ON `lists` (`slug`);--> statement-breakpoint
-- Hand-added (drizzle has no trigger DSL; the snapshot does not track
-- these - any future migration that rebuilds lists or list_items must
-- recreate them). Each trigger is the SINGLE enforcement point for its
-- cap; server/repos/db-errors.ts maps the messages to friendly 422s.
-- Keep the message text in lockstep with the matchers there.
CREATE TRIGGER `lists_user_cap`
BEFORE INSERT ON `lists`
WHEN (SELECT count(*) FROM `lists` WHERE `user_id` = NEW.`user_id`) >= 100
BEGIN
  SELECT RAISE(ABORT, 'list cap exceeded (100 per user)');
END;
--> statement-breakpoint
CREATE TRIGGER `list_items_list_cap`
BEFORE INSERT ON `list_items`
WHEN (SELECT count(*) FROM `list_items` WHERE `list_id` = NEW.`list_id`) >= 300
BEGIN
  SELECT RAISE(ABORT, 'list item cap exceeded (300 per list)');
END;
