CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `passkey` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`public_key` text NOT NULL,
	`user_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`counter` integer NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer NOT NULL,
	`transports` text,
	`created_at` integer,
	`aaguid` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`window_start` integer NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "gear_items" (
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
	CONSTRAINT "gear_items_name_length" CHECK(length("gear_items"."name") between 1 and 256),
	CONSTRAINT "gear_items_description_length" CHECK("gear_items"."description" is null or length("gear_items"."description") <= 2000),
	CONSTRAINT "gear_items_weight_range" CHECK("gear_items"."weight_grams" between 0 and 100000),
	CONSTRAINT "gear_items_cost_range" CHECK("gear_items"."cost_cents" is null or ("gear_items"."cost_cents" between 0 and 9999999999)),
	CONSTRAINT "gear_items_purchase_date_shape" CHECK("gear_items"."purchase_date" is null or "gear_items"."purchase_date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "gear_items_status_enum" CHECK("gear_items"."status" in ('active', 'needs_repair', 'loaned_out', 'need_to_buy'))
);
--> statement-breakpoint
CREATE TABLE "lists" (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`slug` text NOT NULL,
	`is_shared` integer DEFAULT false NOT NULL,
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
	`updated_at` integer NOT NULL, `packing_location_id` text REFERENCES packing_locations(id) ON DELETE SET NULL, `pack_sort_order` integer NOT NULL DEFAULT 0,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`,`user_id`) REFERENCES `lists`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`gear_item_id`,`user_id`) REFERENCES `gear_items`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "list_items_quantity_range" CHECK("list_items"."quantity" between 1 and 9999),
	CONSTRAINT "list_items_worn_xor_consumable" CHECK(not ("list_items"."is_worn" and "list_items"."is_consumable"))
);
--> statement-breakpoint
CREATE TABLE `packing_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`list_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL, `container_list_item_id` text REFERENCES list_items(id) ON DELETE CASCADE,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`,`user_id`) REFERENCES `lists`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "packing_locations_name_length" CHECK(length("packing_locations"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE `list_food_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`list_id` text NOT NULL,
	`day_number` integer NOT NULL,
	`meal` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`,`user_id`) REFERENCES `lists`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "list_food_slots_meal_enum" CHECK("list_food_slots"."meal" in ('breakfast', 'lunch', 'dinner')),
	CONSTRAINT "list_food_slots_day_range" CHECK(typeof("list_food_slots"."day_number") = 'integer' and "list_food_slots"."day_number" between 1 and 30)
);
--> statement-breakpoint
CREATE TABLE `list_food_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`list_id` text NOT NULL,
	`name` text NOT NULL,
	`weight_grams` real NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL, `is_packed` integer NOT NULL DEFAULT 0, `is_ready` integer NOT NULL DEFAULT 0, `packing_location_id` text REFERENCES `packing_locations`(`id`) ON DELETE SET NULL, `pack_sort_order` integer NOT NULL DEFAULT 0, `is_per_meal` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`,`user_id`) REFERENCES `lists`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "list_food_items_name_length" CHECK(length("list_food_items"."name") between 1 and 128),
	CONSTRAINT "list_food_items_weight_range" CHECK("list_food_items"."weight_grams" between 0 and 100000),
	CONSTRAINT "list_food_items_quantity_range" CHECK(typeof("list_food_items"."quantity") = 'integer' and "list_food_items"."quantity" between 1 and 9999)
);
--> statement-breakpoint
CREATE TABLE `list_food_item_slots` (
	`food_item_id` text NOT NULL,
	`slot_id` text NOT NULL,
	`user_id` text NOT NULL,
	`list_id` text NOT NULL,
	PRIMARY KEY(`food_item_id`, `slot_id`),
	FOREIGN KEY (`food_item_id`,`list_id`,`user_id`) REFERENCES `list_food_items`(`id`,`list_id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`slot_id`,`list_id`,`user_id`) REFERENCES `list_food_slots`(`id`,`list_id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`,`user_id`) REFERENCES `lists`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `_pack_reorder_guard` (
  `list_id` text PRIMARY KEY NOT NULL,
  `ok` integer NOT NULL
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE `_food_pack_reorder_guard` (
  `list_id` text PRIMARY KEY NOT NULL,
  `ok` integer NOT NULL
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE `_packing_location_delete_state` (
  `list_item_id` text PRIMARY KEY,
  `new_rank` integer NOT NULL,
  `seq` integer NOT NULL
) WITHOUT ROWID;
--> statement-breakpoint
CREATE TABLE `_food_location_delete_state` (
  `food_item_id` text PRIMARY KEY,
  `new_rank` integer NOT NULL,
  `seq` integer NOT NULL
) WITHOUT ROWID;
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_id_user_unique` ON `categories` (`id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `categories_user_sort_idx` ON `categories` (`user_id`,`sort_order`,`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `gear_items_id_user_unique` ON `gear_items` (`id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `gear_items_user_sort_idx` ON `gear_items` (`user_id`,`sort_order`,`name`);
--> statement-breakpoint
CREATE INDEX `list_food_item_slots_list_idx` ON `list_food_item_slots` (`list_id`);
--> statement-breakpoint
CREATE INDEX `list_food_item_slots_slot_idx` ON `list_food_item_slots` (`slot_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `list_food_items_id_list_user_unique` ON `list_food_items` (`id`,`list_id`,`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `list_food_items_id_user_unique` ON `list_food_items` (`id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `list_food_items_list_sort_idx` ON `list_food_items` (`list_id`,`sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `list_food_items_pack_cohort_uq` ON `list_food_items` (`list_id`,`packing_location_id`,`pack_sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `list_food_items_pack_unassigned_uq` ON `list_food_items` (`list_id`,`pack_sort_order`) WHERE `packing_location_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `list_food_items_packing_location_idx` ON `list_food_items` (`packing_location_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `list_food_slots_day_meal_unique` ON `list_food_slots` (`list_id`,`day_number`,`meal`);
--> statement-breakpoint
CREATE UNIQUE INDEX `list_food_slots_id_list_user_unique` ON `list_food_slots` (`id`,`list_id`,`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `list_food_slots_id_user_unique` ON `list_food_slots` (`id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `list_food_slots_list_day_idx` ON `list_food_slots` (`list_id`,`day_number`);
--> statement-breakpoint
CREATE INDEX `list_items_gear_item_user_idx` ON `list_items` (`gear_item_id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `list_items_list_sort_idx` ON `list_items` (`list_id`,`sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `list_items_pack_cohort_uq` ON `list_items` (`list_id`,`packing_location_id`,`pack_sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `list_items_pack_unassigned_uq` ON `list_items` (`list_id`,`pack_sort_order`) WHERE `packing_location_id` IS NULL;
--> statement-breakpoint
CREATE INDEX `list_items_packing_location_idx` ON `list_items` (`packing_location_id`);
--> statement-breakpoint
CREATE INDEX `list_items_user_list_sort_idx` ON `list_items` (`user_id`,`list_id`,`sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `lists_id_user_unique` ON `lists` (`id`,`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `lists_slug_unique` ON `lists` (`slug`);
--> statement-breakpoint
CREATE INDEX `lists_user_sort_idx` ON `lists` (`user_id`,`sort_order`,`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `packing_locations_container_item_unique` ON `packing_locations` (`container_list_item_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `packing_locations_id_list_user_unique` ON `packing_locations` (`id`,`list_id`,`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `packing_locations_id_user_unique` ON `packing_locations` (`id`,`user_id`);
--> statement-breakpoint
CREATE INDEX `packing_locations_list_sort_idx` ON `packing_locations` (`list_id`,`sort_order`);
--> statement-breakpoint
CREATE INDEX `passkey_credentialID_idx` ON `passkey` (`credential_id`);
--> statement-breakpoint
CREATE INDEX `passkey_userId_idx` ON `passkey` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);
--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);
--> statement-breakpoint
CREATE TRIGGER `categories_user_cap`
BEFORE INSERT ON `categories`
WHEN (SELECT count(*) FROM `categories` WHERE `user_id` = NEW.`user_id`) >= 500
BEGIN
  SELECT RAISE(ABORT, 'category cap exceeded (500 per user)');
END;
--> statement-breakpoint
CREATE TRIGGER `gear_items_user_cap`
BEFORE INSERT ON `gear_items`
WHEN (SELECT count(*) FROM `gear_items` WHERE `user_id` = NEW.`user_id`) >= 500
BEGIN
  SELECT RAISE(ABORT, 'gear item cap exceeded (500 per user)');
END;
--> statement-breakpoint
CREATE TRIGGER `list_food_items_list_cap`
BEFORE INSERT ON `list_food_items`
WHEN (SELECT count(*) FROM `list_food_items` WHERE `list_id` = NEW.`list_id`) >= 200
BEGIN
  SELECT RAISE(ABORT, 'food item cap exceeded (200 per list)');
END;
--> statement-breakpoint
CREATE TRIGGER `list_food_items_location_same_list_insert`
BEFORE INSERT ON `list_food_items`
WHEN NEW.`packing_location_id` IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM `packing_locations`
                  WHERE `id` = NEW.`packing_location_id`
                    AND `list_id` = NEW.`list_id`
                    AND `user_id` = NEW.`user_id`)
BEGIN
  SELECT RAISE(ABORT, 'packing location does not belong to this list');
END;
--> statement-breakpoint
CREATE TRIGGER `list_food_items_location_same_list_update`
BEFORE UPDATE OF `packing_location_id`, `list_id`, `user_id` ON `list_food_items`
WHEN NEW.`packing_location_id` IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM `packing_locations`
                  WHERE `id` = NEW.`packing_location_id`
                    AND `list_id` = NEW.`list_id`
                    AND `user_id` = NEW.`user_id`)
BEGIN
  SELECT RAISE(ABORT, 'packing location does not belong to this list');
END;
--> statement-breakpoint
CREATE TRIGGER `list_food_items_pack_rank_range_ins`
BEFORE INSERT ON `list_food_items`
FOR EACH ROW
WHEN NEW.`pack_sort_order` < 0 OR NEW.`pack_sort_order` > 1000000000
BEGIN
  SELECT RAISE(ABORT, 'food pack_sort_order out of range (0..1000000000)');
END;
--> statement-breakpoint
CREATE TRIGGER `list_food_items_pack_rank_range_upd`
BEFORE UPDATE OF `pack_sort_order` ON `list_food_items`
FOR EACH ROW
WHEN NEW.`pack_sort_order` < -200 OR NEW.`pack_sort_order` > 1000000000
BEGIN
  SELECT RAISE(ABORT, 'food pack_sort_order out of range (-200..1000000000)');
END;
--> statement-breakpoint
CREATE TRIGGER `list_items_container_cycle_insert`
BEFORE INSERT ON `list_items`
WHEN NEW.`packing_location_id` IS NOT NULL
 AND EXISTS (
  WITH RECURSIVE `container_ancestors`(`item_id`) AS (
    SELECT `pl`.`container_list_item_id`
      FROM `packing_locations` `pl`
     WHERE `pl`.`id` = NEW.`packing_location_id`
       AND `pl`.`list_id` = NEW.`list_id`
       AND `pl`.`user_id` = NEW.`user_id`
       AND `pl`.`container_list_item_id` IS NOT NULL
    UNION
    SELECT `parent`.`container_list_item_id`
      FROM `container_ancestors` `ca`
      JOIN `list_items` `li`
        ON `li`.`id` = `ca`.`item_id`
       AND `li`.`list_id` = NEW.`list_id`
       AND `li`.`user_id` = NEW.`user_id`
      JOIN `packing_locations` `parent`
        ON `parent`.`id` = `li`.`packing_location_id`
       AND `parent`.`list_id` = NEW.`list_id`
       AND `parent`.`user_id` = NEW.`user_id`
     WHERE `parent`.`container_list_item_id` IS NOT NULL
  )
  SELECT 1 FROM `container_ancestors` WHERE `item_id` = NEW.`id`
 )
BEGIN
  SELECT RAISE(ABORT, 'container nesting cycle');
END;
--> statement-breakpoint
CREATE TRIGGER `list_items_container_cycle_update`
BEFORE UPDATE OF `packing_location_id`, `id`, `list_id`, `user_id` ON `list_items`
WHEN NEW.`packing_location_id` IS NOT NULL
 AND EXISTS (
  WITH RECURSIVE `container_ancestors`(`item_id`) AS (
    SELECT `pl`.`container_list_item_id`
      FROM `packing_locations` `pl`
     WHERE `pl`.`id` = NEW.`packing_location_id`
       AND `pl`.`list_id` = NEW.`list_id`
       AND `pl`.`user_id` = NEW.`user_id`
       AND `pl`.`container_list_item_id` IS NOT NULL
    UNION
    SELECT `parent`.`container_list_item_id`
      FROM `container_ancestors` `ca`
      JOIN `list_items` `li`
        ON `li`.`id` = `ca`.`item_id`
       AND `li`.`list_id` = NEW.`list_id`
       AND `li`.`user_id` = NEW.`user_id`
      JOIN `packing_locations` `parent`
        ON `parent`.`id` = `li`.`packing_location_id`
       AND `parent`.`list_id` = NEW.`list_id`
       AND `parent`.`user_id` = NEW.`user_id`
     WHERE `parent`.`container_list_item_id` IS NOT NULL
  )
  SELECT 1 FROM `container_ancestors` WHERE `item_id` = NEW.`id`
 )
BEGIN
  SELECT RAISE(ABORT, 'container nesting cycle');
END;
--> statement-breakpoint
CREATE TRIGGER `list_items_list_cap`
BEFORE INSERT ON `list_items`
WHEN (SELECT count(*) FROM `list_items` WHERE `list_id` = NEW.`list_id`) >= 300
BEGIN
  SELECT RAISE(ABORT, 'list item cap exceeded (300 per list)');
END;
--> statement-breakpoint
CREATE TRIGGER `list_items_location_same_list_insert`
BEFORE INSERT ON `list_items`
WHEN NEW.`packing_location_id` IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM `packing_locations`
                  WHERE `id` = NEW.`packing_location_id`
                    AND `list_id` = NEW.`list_id`
                    AND `user_id` = NEW.`user_id`)
BEGIN
  SELECT RAISE(ABORT, 'packing location does not belong to this list');
END;
--> statement-breakpoint
CREATE TRIGGER `list_items_location_same_list_update`
BEFORE UPDATE OF `packing_location_id`, `list_id`, `user_id` ON `list_items`
WHEN NEW.`packing_location_id` IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM `packing_locations`
                  WHERE `id` = NEW.`packing_location_id`
                    AND `list_id` = NEW.`list_id`
                    AND `user_id` = NEW.`user_id`)
BEGIN
  SELECT RAISE(ABORT, 'packing location does not belong to this list');
END;
--> statement-breakpoint
CREATE TRIGGER `list_items_pack_rank_range_ins`
BEFORE INSERT ON `list_items`
FOR EACH ROW
WHEN NEW.`pack_sort_order` < 0 OR NEW.`pack_sort_order` > 1000000000
BEGIN
  SELECT RAISE(ABORT, 'pack_sort_order out of range (0..1000000000)');
END;
--> statement-breakpoint
CREATE TRIGGER `list_items_pack_rank_range_upd`
BEFORE UPDATE OF `pack_sort_order` ON `list_items`
FOR EACH ROW
WHEN NEW.`pack_sort_order` < -300 OR NEW.`pack_sort_order` > 1000000000
BEGIN
  SELECT RAISE(ABORT, 'pack_sort_order out of range (-300..1000000000)');
END;
--> statement-breakpoint
CREATE TRIGGER `lists_user_cap`
BEFORE INSERT ON `lists`
WHEN (SELECT count(*) FROM `lists` WHERE `user_id` = NEW.`user_id`) >= 100
BEGIN
  SELECT RAISE(ABORT, 'list cap exceeded (100 per user)');
END;
--> statement-breakpoint
CREATE TRIGGER `packing_locations_container_cycle_update`
BEFORE UPDATE OF `container_list_item_id` ON `packing_locations`
WHEN NEW.`container_list_item_id` IS NOT NULL
 AND EXISTS (
  WITH RECURSIVE `assigned_locations`(`location_id`) AS (
    SELECT `li`.`packing_location_id`
      FROM `list_items` `li`
     WHERE `li`.`id` = NEW.`container_list_item_id`
       AND `li`.`list_id` = NEW.`list_id`
       AND `li`.`user_id` = NEW.`user_id`
       AND `li`.`packing_location_id` IS NOT NULL
    UNION
    SELECT `li`.`packing_location_id`
      FROM `assigned_locations` `al`
      JOIN `packing_locations` `pl`
        ON `pl`.`id` = `al`.`location_id`
       AND `pl`.`list_id` = NEW.`list_id`
       AND `pl`.`user_id` = NEW.`user_id`
      JOIN `list_items` `li`
        ON `li`.`id` = `pl`.`container_list_item_id`
       AND `li`.`list_id` = NEW.`list_id`
       AND `li`.`user_id` = NEW.`user_id`
     WHERE `li`.`packing_location_id` IS NOT NULL
  )
  SELECT 1 FROM `assigned_locations` WHERE `location_id` = NEW.`id`
 )
BEGIN
  SELECT RAISE(ABORT, 'container nesting cycle');
END;
--> statement-breakpoint
CREATE TRIGGER `packing_locations_container_same_list_insert`
BEFORE INSERT ON `packing_locations`
WHEN NEW.`container_list_item_id` IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM `list_items`
                  WHERE `id` = NEW.`container_list_item_id`
                    AND `list_id` = NEW.`list_id`
                    AND `user_id` = NEW.`user_id`)
BEGIN
  SELECT RAISE(ABORT, 'container item does not belong to this list');
END;
--> statement-breakpoint
CREATE TRIGGER `packing_locations_container_same_list_update`
BEFORE UPDATE OF `container_list_item_id`, `list_id`, `user_id` ON `packing_locations`
WHEN NEW.`container_list_item_id` IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM `list_items`
                  WHERE `id` = NEW.`container_list_item_id`
                    AND `list_id` = NEW.`list_id`
                    AND `user_id` = NEW.`user_id`)
BEGIN
  SELECT RAISE(ABORT, 'container item does not belong to this list');
END;
--> statement-breakpoint
CREATE TRIGGER `packing_locations_list_cap`
BEFORE INSERT ON `packing_locations`
WHEN (SELECT count(*) FROM `packing_locations` WHERE `list_id` = NEW.`list_id`) >= 30
BEGIN
  SELECT RAISE(ABORT, 'packing location cap exceeded (30 per list)');
END;
--> statement-breakpoint
CREATE TRIGGER `packing_locations_owner_immutable`
BEFORE UPDATE OF `list_id`, `user_id` ON `packing_locations`
WHEN NEW.`list_id` <> OLD.`list_id` OR NEW.`user_id` <> OLD.`user_id`
BEGIN
  SELECT RAISE(ABORT, 'packing location cannot change list or owner');
END;
--> statement-breakpoint
CREATE TRIGGER `packing_locations_rerank_food_orphans`
BEFORE DELETE ON `packing_locations`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM `list_food_items` AS `fi`
  WHERE `fi`.`list_id` = OLD.`list_id` AND `fi`.`packing_location_id` = OLD.`id`
)
BEGIN
  DELETE FROM `list_food_items`
   WHERE `list_id` = OLD.`list_id`
     AND `packing_location_id` = OLD.`id`
     AND NOT EXISTS (SELECT 1 FROM `lists` WHERE `id` = OLD.`list_id`);

  INSERT INTO `_food_location_delete_state` (`food_item_id`, `new_rank`, `seq`)
  SELECT * FROM (
    SELECT `x`.`id`,
           CASE
             WHEN (SELECT coalesce(max(`u`.`pack_sort_order`), -1) + 1
                     FROM `list_food_items` AS `u`
                    WHERE `u`.`list_id` = OLD.`list_id`
                      AND `u`.`packing_location_id` IS NULL)
                  + (SELECT max(`s`.`pack_sort_order`) FROM `list_food_items` AS `s`
                      WHERE `s`.`list_id` = OLD.`list_id`
                        AND `s`.`packing_location_id` = OLD.`id`)
                  <= 1000000000
             THEN (SELECT coalesce(max(`u`.`pack_sort_order`), -1) + 1
                     FROM `list_food_items` AS `u`
                    WHERE `u`.`list_id` = OLD.`list_id`
                      AND `u`.`packing_location_id` IS NULL)
                  + `x`.`pack_sort_order`
             ELSE row_number() OVER (
                    ORDER BY CASE WHEN `x`.`packing_location_id` IS NULL THEN 0 ELSE 1 END,
                             `x`.`pack_sort_order`, `x`.`id`) - 1
           END,
           row_number() OVER (
             ORDER BY CASE WHEN `x`.`packing_location_id` IS NULL THEN 0 ELSE 1 END,
                      `x`.`pack_sort_order`, `x`.`id`) - 1
      FROM `list_food_items` AS `x`
     WHERE `x`.`list_id` = OLD.`list_id`
       AND EXISTS (SELECT 1 FROM `lists` WHERE `id` = OLD.`list_id`)
       AND (
         `x`.`packing_location_id` = OLD.`id`
         OR (`x`.`packing_location_id` IS NULL
             AND (SELECT coalesce(max(`u`.`pack_sort_order`), -1) + 1
                    FROM `list_food_items` AS `u`
                   WHERE `u`.`list_id` = OLD.`list_id`
                     AND `u`.`packing_location_id` IS NULL)
                 + (SELECT max(`s`.`pack_sort_order`) FROM `list_food_items` AS `s`
                     WHERE `s`.`list_id` = OLD.`list_id`
                       AND `s`.`packing_location_id` = OLD.`id`)
                 > 1000000000)
       )
  );

  UPDATE `list_food_items`
     SET `pack_sort_order` = -1 - (
           SELECT `s`.`seq` FROM `_food_location_delete_state` AS `s`
            WHERE `s`.`food_item_id` = `list_food_items`.`id`)
   WHERE `list_food_items`.`id` IN (SELECT `food_item_id` FROM `_food_location_delete_state`);

  UPDATE `list_food_items`
     SET `packing_location_id` = NULL,
         `pack_sort_order` = (
           SELECT `s`.`new_rank` FROM `_food_location_delete_state` AS `s`
            WHERE `s`.`food_item_id` = `list_food_items`.`id`)
   WHERE `list_food_items`.`id` IN (SELECT `food_item_id` FROM `_food_location_delete_state`);

  DELETE FROM `_food_location_delete_state`
   WHERE `food_item_id` IN (SELECT `id` FROM `list_food_items` WHERE `list_id` = OLD.`list_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `packing_locations_rerank_orphans`
BEFORE DELETE ON `packing_locations`
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM `list_items` AS `li`
  WHERE `li`.`list_id` = OLD.`list_id` AND `li`.`packing_location_id` = OLD.`id`
)
BEGIN
  -- The parent list is ALREADY GONE, so every row here is doomed: list_items
  -- cascades from lists, and SQLite removes the parent row before applying the
  -- child actions. Delete them now instead of re-ranking rows that are about
  -- to be deleted anyway.
  --
  -- This is what keeps a big cascade linear. Re-ranking per location rewrites
  -- the whole growing Unassigned cohort each time, so an account at the schema
  -- caps (100 lists x 30 locations x 300 items) turns one DELETE into millions
  -- of row changes - past D1's 30-second query ceiling, where it would time out
  -- and roll the whole deletion back.
  DELETE FROM `list_items`
   WHERE `list_id` = OLD.`list_id`
     AND `packing_location_id` = OLD.`id`
     AND NOT EXISTS (SELECT 1 FROM `lists` WHERE `id` = OLD.`list_id`);

  INSERT INTO `_packing_location_delete_state` (`list_item_id`, `new_rank`, `seq`)
  SELECT * FROM (
    SELECT `x`.`id`,
           CASE
             WHEN (SELECT coalesce(max(`u`.`pack_sort_order`), -1) + 1
                     FROM `list_items` AS `u`
                    WHERE `u`.`list_id` = OLD.`list_id`
                      AND `u`.`packing_location_id` IS NULL)
                  + (SELECT max(`s`.`pack_sort_order`) FROM `list_items` AS `s`
                      WHERE `s`.`list_id` = OLD.`list_id`
                        AND `s`.`packing_location_id` = OLD.`id`)
                  <= 1000000000
             THEN (SELECT coalesce(max(`u`.`pack_sort_order`), -1) + 1
                     FROM `list_items` AS `u`
                    WHERE `u`.`list_id` = OLD.`list_id`
                      AND `u`.`packing_location_id` IS NULL)
                  + `x`.`pack_sort_order`
             ELSE row_number() OVER (
                    ORDER BY CASE WHEN `x`.`packing_location_id` IS NULL THEN 0 ELSE 1 END,
                             `x`.`pack_sort_order`, `x`.`id`) - 1
           END,
           row_number() OVER (
             ORDER BY CASE WHEN `x`.`packing_location_id` IS NULL THEN 0 ELSE 1 END,
                      `x`.`pack_sort_order`, `x`.`id`) - 1
      FROM `list_items` AS `x`
     WHERE `x`.`list_id` = OLD.`list_id`
       AND EXISTS (SELECT 1 FROM `lists` WHERE `id` = OLD.`list_id`)
       AND (
         `x`.`packing_location_id` = OLD.`id`
         OR (`x`.`packing_location_id` IS NULL
             AND (SELECT coalesce(max(`u`.`pack_sort_order`), -1) + 1
                    FROM `list_items` AS `u`
                   WHERE `u`.`list_id` = OLD.`list_id`
                     AND `u`.`packing_location_id` IS NULL)
                 + (SELECT max(`s`.`pack_sort_order`) FROM `list_items` AS `s`
                     WHERE `s`.`list_id` = OLD.`list_id`
                       AND `s`.`packing_location_id` = OLD.`id`)
                 > 1000000000)
       )
  );

  UPDATE `list_items`
     SET `pack_sort_order` = -1 - (
           SELECT `s`.`seq` FROM `_packing_location_delete_state` AS `s`
            WHERE `s`.`list_item_id` = `list_items`.`id`)
   WHERE `list_items`.`id` IN (SELECT `list_item_id` FROM `_packing_location_delete_state`);

  UPDATE `list_items`
     SET `packing_location_id` = NULL,
         `pack_sort_order` = (
           SELECT `s`.`new_rank` FROM `_packing_location_delete_state` AS `s`
            WHERE `s`.`list_item_id` = `list_items`.`id`)
   WHERE `list_items`.`id` IN (SELECT `list_item_id` FROM `_packing_location_delete_state`);

  DELETE FROM `_packing_location_delete_state`
   WHERE `list_item_id` IN (SELECT `id` FROM `list_items` WHERE `list_id` = OLD.`list_id`);
END;
--> statement-breakpoint
