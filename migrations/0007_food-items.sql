CREATE TABLE `food_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`brand` text,
	`serving_description` text,
	`serving_weight_grams` real NOT NULL,
	`calories_per_serving` real NOT NULL,
	`servings_per_package` real,
	`fat_grams` real,
	`saturated_fat_grams` real,
	`carbs_grams` real,
	`fiber_grams` real,
	`sugar_grams` real,
	`protein_grams` real,
	`sodium_mg` real,
	`potassium_mg` real,
	`notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "food_items_name_length" CHECK(length("food_items"."name") between 1 and 256),
	CONSTRAINT "food_items_brand_length" CHECK("food_items"."brand" is null or length("food_items"."brand") <= 256),
	CONSTRAINT "food_items_serving_description_length" CHECK("food_items"."serving_description" is null or length("food_items"."serving_description") <= 256),
	CONSTRAINT "food_items_notes_length" CHECK("food_items"."notes" is null or length("food_items"."notes") <= 2000),
	CONSTRAINT "food_items_serving_weight_range" CHECK("food_items"."serving_weight_grams" > 0 and "food_items"."serving_weight_grams" <= 9999999.999),
	CONSTRAINT "food_items_calories_range" CHECK("food_items"."calories_per_serving" >= 0 and "food_items"."calories_per_serving" <= 99999999.99),
	CONSTRAINT "food_items_servings_per_package_range" CHECK("food_items"."servings_per_package" is null or ("food_items"."servings_per_package" > 0 and "food_items"."servings_per_package" <= 9999999.999)),
	CONSTRAINT "food_items_fat_range" CHECK("food_items"."fat_grams" is null or ("food_items"."fat_grams" >= 0 and "food_items"."fat_grams" <= 99999999.99)),
	CONSTRAINT "food_items_saturated_fat_range" CHECK("food_items"."saturated_fat_grams" is null or ("food_items"."saturated_fat_grams" >= 0 and "food_items"."saturated_fat_grams" <= 99999999.99)),
	CONSTRAINT "food_items_carbs_range" CHECK("food_items"."carbs_grams" is null or ("food_items"."carbs_grams" >= 0 and "food_items"."carbs_grams" <= 99999999.99)),
	CONSTRAINT "food_items_fiber_range" CHECK("food_items"."fiber_grams" is null or ("food_items"."fiber_grams" >= 0 and "food_items"."fiber_grams" <= 99999999.99)),
	CONSTRAINT "food_items_sugar_range" CHECK("food_items"."sugar_grams" is null or ("food_items"."sugar_grams" >= 0 and "food_items"."sugar_grams" <= 99999999.99)),
	CONSTRAINT "food_items_protein_range" CHECK("food_items"."protein_grams" is null or ("food_items"."protein_grams" >= 0 and "food_items"."protein_grams" <= 99999999.99)),
	CONSTRAINT "food_items_sodium_range" CHECK("food_items"."sodium_mg" is null or ("food_items"."sodium_mg" >= 0 and "food_items"."sodium_mg" <= 999999999.9)),
	CONSTRAINT "food_items_potassium_range" CHECK("food_items"."potassium_mg" is null or ("food_items"."potassium_mg" >= 0 and "food_items"."potassium_mg" <= 999999999.9))
);
--> statement-breakpoint
CREATE INDEX `food_items_user_sort_idx` ON `food_items` (`user_id`,`sort_order`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `food_items_id_user_unique` ON `food_items` (`id`,`user_id`);--> statement-breakpoint
-- Hand-added (drizzle has no trigger DSL; the snapshot does not track
-- this - any future migration that rebuilds food_items must recreate it).
-- This trigger is the SINGLE enforcement point for the cap;
-- server/repos/food-items.ts maps its message to a friendly 422. Keep the
-- message text in lockstep with isFoodCapError() there.
CREATE TRIGGER `food_items_user_cap`
BEFORE INSERT ON `food_items`
WHEN (SELECT count(*) FROM `food_items` WHERE `user_id` = NEW.`user_id`) >= 1000
BEGIN
  SELECT RAISE(ABORT, 'food item cap exceeded (1000 per user)');
END;
