ALTER TABLE `packing_locations` ADD `container_list_item_id` text REFERENCES list_items(id) ON DELETE CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX `packing_locations_container_item_unique` ON `packing_locations` (`container_list_item_id`);--> statement-breakpoint
CREATE TRIGGER `packing_locations_container_same_list_insert`
BEFORE INSERT ON `packing_locations`
WHEN NEW.`container_list_item_id` IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM `list_items`
                  WHERE `id` = NEW.`container_list_item_id`
                    AND `list_id` = NEW.`list_id`
                    AND `user_id` = NEW.`user_id`)
BEGIN
  SELECT RAISE(ABORT, 'container item does not belong to this list');
END;--> statement-breakpoint
CREATE TRIGGER `packing_locations_container_same_list_update`
BEFORE UPDATE OF `container_list_item_id`, `list_id`, `user_id` ON `packing_locations`
WHEN NEW.`container_list_item_id` IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM `list_items`
                  WHERE `id` = NEW.`container_list_item_id`
                    AND `list_id` = NEW.`list_id`
                    AND `user_id` = NEW.`user_id`)
BEGIN
  SELECT RAISE(ABORT, 'container item does not belong to this list');
END;--> statement-breakpoint
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
END;--> statement-breakpoint
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
END;--> statement-breakpoint
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
