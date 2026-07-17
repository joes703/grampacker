CREATE TABLE `food_pack_state` (
	`list_id` text NOT NULL,
	`food_item_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`list_id`, `food_item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`,`user_id`) REFERENCES `lists`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`food_item_id`,`user_id`) REFERENCES `food_items`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `food_pack_state_food_user_idx` ON `food_pack_state` (`food_item_id`,`user_id`);