CREATE TABLE `packing_locations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`list_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`,`user_id`) REFERENCES `lists`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "packing_locations_name_length" CHECK(length("packing_locations"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE INDEX `packing_locations_list_sort_idx` ON `packing_locations` (`list_id`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `packing_locations_id_user_unique` ON `packing_locations` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `packing_locations_id_list_user_unique` ON `packing_locations` (`id`,`list_id`,`user_id`);--> statement-breakpoint
CREATE TRIGGER `packing_locations_list_cap`
BEFORE INSERT ON `packing_locations`
WHEN (SELECT count(*) FROM `packing_locations` WHERE `list_id` = NEW.`list_id`) >= 30
BEGIN
  SELECT RAISE(ABORT, 'packing location cap exceeded (30 per list)');
END;--> statement-breakpoint
ALTER TABLE `list_items` ADD `packing_location_id` text REFERENCES packing_locations(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `list_items_packing_location_idx` ON `list_items` (`packing_location_id`);--> statement-breakpoint
CREATE TRIGGER `list_items_location_same_list_insert`
BEFORE INSERT ON `list_items`
WHEN NEW.`packing_location_id` IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM `packing_locations`
                  WHERE `id` = NEW.`packing_location_id`
                    AND `list_id` = NEW.`list_id`
                    AND `user_id` = NEW.`user_id`)
BEGIN
  SELECT RAISE(ABORT, 'packing location does not belong to this list');
END;--> statement-breakpoint
CREATE TRIGGER `list_items_location_same_list_update`
BEFORE UPDATE OF `packing_location_id`, `list_id`, `user_id` ON `list_items`
WHEN NEW.`packing_location_id` IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM `packing_locations`
                  WHERE `id` = NEW.`packing_location_id`
                    AND `list_id` = NEW.`list_id`
                    AND `user_id` = NEW.`user_id`)
BEGIN
  SELECT RAISE(ABORT, 'packing location does not belong to this list');
END;--> statement-breakpoint
CREATE TRIGGER `packing_locations_owner_immutable`
BEFORE UPDATE OF `list_id`, `user_id` ON `packing_locations`
WHEN NEW.`list_id` <> OLD.`list_id` OR NEW.`user_id` <> OLD.`user_id`
BEGIN
  SELECT RAISE(ABORT, 'packing location cannot change list or owner');
END;
