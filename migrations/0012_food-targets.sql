CREATE TABLE `food_plan_daily_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`food_plan_id` text NOT NULL,
	`metric` text NOT NULL,
	`mode` text NOT NULL,
	`target_min` real,
	`target_max` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_plan_id`,`user_id`) REFERENCES `food_plans`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "food_plan_daily_targets_metric_enum" CHECK("food_plan_daily_targets"."metric" in ('calories', 'protein', 'carbs', 'fiber', 'sodium', 'calorie_density')),
	CONSTRAINT "daily_target_bounds" CHECK(
  ("food_plan_daily_targets"."target_min" is null or ("food_plan_daily_targets"."target_min" >= 0 and "food_plan_daily_targets"."target_min" < 100000000))
  and ("food_plan_daily_targets"."target_max" is null or ("food_plan_daily_targets"."target_max" >= 0 and "food_plan_daily_targets"."target_max" < 100000000))
  and (("food_plan_daily_targets"."mode" = 'min' and "food_plan_daily_targets"."target_min" is not null and "food_plan_daily_targets"."target_max" is null)
    or ("food_plan_daily_targets"."mode" = 'max' and "food_plan_daily_targets"."target_max" is not null and "food_plan_daily_targets"."target_min" is null)
    or ("food_plan_daily_targets"."mode" = 'range' and "food_plan_daily_targets"."target_min" is not null and "food_plan_daily_targets"."target_max" is not null
      and "food_plan_daily_targets"."target_min" <= "food_plan_daily_targets"."target_max")))
);
--> statement-breakpoint
CREATE INDEX `food_plan_daily_targets_user_idx` ON `food_plan_daily_targets` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `daily_target_one_per_metric` ON `food_plan_daily_targets` (`food_plan_id`,`metric`);--> statement-breakpoint
CREATE TABLE `food_plan_target_defaults` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`metric` text NOT NULL,
	`mode` text NOT NULL,
	`target_min` real,
	`target_max` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "food_plan_target_defaults_metric_enum" CHECK("food_plan_target_defaults"."metric" in ('calories', 'protein', 'carbs', 'fiber', 'sodium', 'calorie_density')),
	CONSTRAINT "default_target_bounds" CHECK(
  ("food_plan_target_defaults"."target_min" is null or ("food_plan_target_defaults"."target_min" >= 0 and "food_plan_target_defaults"."target_min" < 100000000))
  and ("food_plan_target_defaults"."target_max" is null or ("food_plan_target_defaults"."target_max" >= 0 and "food_plan_target_defaults"."target_max" < 100000000))
  and (("food_plan_target_defaults"."mode" = 'min' and "food_plan_target_defaults"."target_min" is not null and "food_plan_target_defaults"."target_max" is null)
    or ("food_plan_target_defaults"."mode" = 'max' and "food_plan_target_defaults"."target_max" is not null and "food_plan_target_defaults"."target_min" is null)
    or ("food_plan_target_defaults"."mode" = 'range' and "food_plan_target_defaults"."target_min" is not null and "food_plan_target_defaults"."target_max" is not null
      and "food_plan_target_defaults"."target_min" <= "food_plan_target_defaults"."target_max")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `default_target_one_per_metric` ON `food_plan_target_defaults` (`user_id`,`metric`);--> statement-breakpoint
CREATE TABLE `meal_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`food_plan_id` text NOT NULL,
	`meal_id` text NOT NULL,
	`metric` text NOT NULL,
	`mode` text NOT NULL,
	`target_min` real,
	`target_max` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_plan_id`,`user_id`) REFERENCES `food_plans`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meal_id`,`food_plan_id`) REFERENCES `meals`(`id`,`food_plan_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "meal_targets_metric_enum" CHECK("meal_targets"."metric" in ('calories', 'protein', 'fat_pct', 'sugar_pct', 'carb_protein_ratio')),
	CONSTRAINT "meal_target_bounds" CHECK(
  ("meal_targets"."target_min" is null or ("meal_targets"."target_min" >= 0 and "meal_targets"."target_min" < 100000000))
  and ("meal_targets"."target_max" is null or ("meal_targets"."target_max" >= 0 and "meal_targets"."target_max" < 100000000))
  and (("meal_targets"."mode" = 'min' and "meal_targets"."target_min" is not null and "meal_targets"."target_max" is null)
    or ("meal_targets"."mode" = 'max' and "meal_targets"."target_max" is not null and "meal_targets"."target_min" is null)
    or ("meal_targets"."mode" = 'range' and "meal_targets"."target_min" is not null and "meal_targets"."target_max" is not null
      and "meal_targets"."target_min" <= "meal_targets"."target_max"))),
	CONSTRAINT "meal_target_pct_ceiling" CHECK("meal_targets"."metric" not in ('fat_pct', 'sugar_pct')
        or (("meal_targets"."target_min" is null or "meal_targets"."target_min" <= 100)
          and ("meal_targets"."target_max" is null or "meal_targets"."target_max" <= 100)))
);
--> statement-breakpoint
CREATE INDEX `meal_targets_plan_idx` ON `meal_targets` (`food_plan_id`);--> statement-breakpoint
CREATE INDEX `meal_targets_user_idx` ON `meal_targets` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `meal_target_one_per_metric` ON `meal_targets` (`meal_id`,`metric`);