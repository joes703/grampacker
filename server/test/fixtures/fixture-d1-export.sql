PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE IF NOT EXISTS "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'0000_baseline.sql','2026-10-16 06:32:55');
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
INSERT INTO "user" ("id","name","email","email_verified","image","created_at","updated_at") VALUES('u-ann','Ann','ann@example.test',1,NULL,1760000000000,1760000000000);
INSERT INTO "user" ("id","name","email","email_verified","image","created_at","updated_at") VALUES('u-bob','Bob O''Neil','bob@example.test',1,NULL,1760000001000,1760000001000);
INSERT INTO "user" ("id","name","email","email_verified","image","created_at","updated_at") VALUES('u-cyd','Cyd ✓','cyd@example.test',0,NULL,1760000002000,1760000002000);
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
INSERT INTO "session" ("id","expires_at","token","created_at","updated_at","ip_address","user_agent","user_id") VALUES('s-ann',1890000000000,'session-token-fixture-ann',1760000000000,1760000000000,'203.0.113.5','fixture-agent','u-ann');
INSERT INTO "session" ("id","expires_at","token","created_at","updated_at","ip_address","user_agent","user_id") VALUES('s-bob',1890000000000,'session-token-fixture-bob',1760000001000,1760000001000,NULL,NULL,'u-bob');
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
INSERT INTO "account" ("id","account_id","provider_id","user_id","access_token","refresh_token","id_token","access_token_expires_at","refresh_token_expires_at","scope","password","created_at","updated_at") VALUES('acc-ann','u-ann','credential','u-ann',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1760000000000,1760000000000);
INSERT INTO "account" ("id","account_id","provider_id","user_id","access_token","refresh_token","id_token","access_token_expires_at","refresh_token_expires_at","scope","password","created_at","updated_at") VALUES('acc-bob','u-bob','credential','u-bob',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1760000001000,1760000001000);
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
INSERT INTO "verification" ("id","identifier","value","expires_at","created_at","updated_at") VALUES('v-1','magic-link-fixture-identifier','verification-value-fixture',1890000000000,1792132417933,1792132417933);
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
INSERT INTO "passkey" ("id","name","public_key","user_id","credential_id","counter","device_type","backed_up","transports","created_at","aaguid") VALUES('pk-ann-1','Ann laptop','pQECAyYgASFYIFixture+publicKey/AAA=','u-ann','cred-ann-1_-AZaz09',7,'multiDevice',1,'internal,hybrid',1760000000500,'fbfc3007-154e-4ecc-8c0b-6e020557d7bd');
INSERT INTO "passkey" ("id","name","public_key","user_id","credential_id","counter","device_type","backed_up","transports","created_at","aaguid") VALUES('pk-bob-1',NULL,'pQECAyYgASFYIFixture+publicKey/BBB=','u-bob','cred-bob-1',0,'singleDevice',0,NULL,1760000001500,NULL);
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`window_start` integer NOT NULL
);
INSERT INTO "rate_limits" ("key","count","window_start") VALUES('fixture-bucket',3,1760000000000);
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "categories_name_length" CHECK(length("categories"."name") between 1 and 128)
);
INSERT INTO "categories" ("id","user_id","name","sort_order","created_at") VALUES('c-ann-shelter','u-ann','Shelter',0,1760000000000);
INSERT INTO "categories" ("id","user_id","name","sort_order","created_at") VALUES('c-ann-cook','u-ann','Cooking',1,1760000000000);
INSERT INTO "categories" ("id","user_id","name","sort_order","created_at") VALUES('c-bob-misc','u-bob','Misc',0,1760000001000);
CREATE TABLE IF NOT EXISTS "gear_items" (
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
INSERT INTO "gear_items" ("id","user_id","category_id","name","description","weight_grams","cost_cents","purchase_date","status","sort_order","created_at","updated_at") VALUES('g-ann-tent','u-ann','c-ann-shelter','Tent','Two-person; "quoted" text',1130.5,45000,'2025-04-01','active',0,1760000000000,1760000000000);
INSERT INTO "gear_items" ("id","user_id","category_id","name","description","weight_grams","cost_cents","purchase_date","status","sort_order","created_at","updated_at") VALUES('g-ann-pack','u-ann',NULL,'Backpack',NULL,900,NULL,NULL,'active',1,1760000000000,1760000000000);
INSERT INTO "gear_items" ("id","user_id","category_id","name","description","weight_grams","cost_cents","purchase_date","status","sort_order","created_at","updated_at") VALUES('g-ann-stove','u-ann','c-ann-cook','Stove',replace('line one\nline two','\n',char(10)),85.25,3999,NULL,'needs_repair',2,1760000000000,1760000000000);
INSERT INTO "gear_items" ("id","user_id","category_id","name","description","weight_grams","cost_cents","purchase_date","status","sort_order","created_at","updated_at") VALUES('g-bob-hat','u-bob','c-bob-misc','Hat',NULL,60,NULL,NULL,'need_to_buy',0,1760000001000,1760000001000);
CREATE TABLE IF NOT EXISTS "lists" (
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
INSERT INTO "lists" ("id","user_id","name","description","slug","is_shared","is_draft","sort_order","created_at","updated_at") VALUES('l-ann-trip','u-ann','Sierra trip','Shared trip','AbC123',1,0,0,1760000000000,1760000000000);
INSERT INTO "lists" ("id","user_id","name","description","slug","is_shared","is_draft","sort_order","created_at","updated_at") VALUES('l-ann-draft','u-ann','Draft list',NULL,'dRaFt1',0,1,1,1760000000000,1760000000000);
INSERT INTO "lists" ("id","user_id","name","description","slug","is_shared","is_draft","sort_order","created_at","updated_at") VALUES('l-bob-day','u-bob','Day hike',NULL,'b0bDay',0,0,0,1760000001000,1760000001000);
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
INSERT INTO "list_items" ("id","user_id","list_id","gear_item_id","quantity","is_worn","is_consumable","is_packed","is_ready","sort_order","created_at","updated_at","packing_location_id","pack_sort_order") VALUES('li-ann-pack','u-ann','l-ann-trip','g-ann-pack',1,1,0,1,1,0,1760000000000,1760000000000,NULL,0);
INSERT INTO "list_items" ("id","user_id","list_id","gear_item_id","quantity","is_worn","is_consumable","is_packed","is_ready","sort_order","created_at","updated_at","packing_location_id","pack_sort_order") VALUES('li-ann-tent','u-ann','l-ann-trip','g-ann-tent',1,0,0,1,0,1,1760000000000,1760000000000,'pl-ann-main',0);
INSERT INTO "list_items" ("id","user_id","list_id","gear_item_id","quantity","is_worn","is_consumable","is_packed","is_ready","sort_order","created_at","updated_at","packing_location_id","pack_sort_order") VALUES('li-ann-stove','u-ann','l-ann-trip','g-ann-stove',2,0,0,0,0,2,1760000000000,1760000000000,'pl-ann-main',1);
INSERT INTO "list_items" ("id","user_id","list_id","gear_item_id","quantity","is_worn","is_consumable","is_packed","is_ready","sort_order","created_at","updated_at","packing_location_id","pack_sort_order") VALUES('li-ann-draft-tent','u-ann','l-ann-draft','g-ann-tent',1,0,0,0,0,0,1760000000000,1760000000000,NULL,0);
INSERT INTO "list_items" ("id","user_id","list_id","gear_item_id","quantity","is_worn","is_consumable","is_packed","is_ready","sort_order","created_at","updated_at","packing_location_id","pack_sort_order") VALUES('li-bob-hat','u-bob','l-bob-day','g-bob-hat',1,1,0,0,0,0,1760000001000,1760000001000,NULL,0);
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
INSERT INTO "packing_locations" ("id","user_id","list_id","name","sort_order","created_at","updated_at","container_list_item_id") VALUES('pl-ann-main','u-ann','l-ann-trip','Main compartment',0,1760000000000,1760000000000,'li-ann-pack');
INSERT INTO "packing_locations" ("id","user_id","list_id","name","sort_order","created_at","updated_at","container_list_item_id") VALUES('pl-ann-loose','u-ann','l-ann-trip','Loose',1,1760000000000,1760000000000,NULL);
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
INSERT INTO "list_food_slots" ("id","user_id","list_id","day_number","meal","created_at","updated_at") VALUES('fs-ann-d1-b','u-ann','l-ann-trip',1,'breakfast',1760000000000,1760000000000);
INSERT INTO "list_food_slots" ("id","user_id","list_id","day_number","meal","created_at","updated_at") VALUES('fs-ann-d1-d','u-ann','l-ann-trip',1,'dinner',1760000000000,1760000000000);
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
INSERT INTO "list_food_items" ("id","user_id","list_id","name","weight_grams","quantity","sort_order","created_at","updated_at","is_packed","is_ready","packing_location_id","pack_sort_order","is_per_meal") VALUES('fi-ann-oats','u-ann','l-ann-trip','Oats',80,1,0,1760000000000,1760000000000,1,0,'pl-ann-loose',0,1);
INSERT INTO "list_food_items" ("id","user_id","list_id","name","weight_grams","quantity","sort_order","created_at","updated_at","is_packed","is_ready","packing_location_id","pack_sort_order","is_per_meal") VALUES('fi-ann-cheese','u-ann','l-ann-trip','Cheese',200,1,1,1760000000000,1760000000000,0,0,NULL,0,0);
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
INSERT INTO "list_food_item_slots" ("food_item_id","slot_id","user_id","list_id") VALUES('fi-ann-oats','fs-ann-d1-b','u-ann','l-ann-trip');
INSERT INTO "list_food_item_slots" ("food_item_id","slot_id","user_id","list_id") VALUES('fi-ann-cheese','fs-ann-d1-b','u-ann','l-ann-trip');
INSERT INTO "list_food_item_slots" ("food_item_id","slot_id","user_id","list_id") VALUES('fi-ann-cheese','fs-ann-d1-d','u-ann','l-ann-trip');
CREATE TABLE `_pack_reorder_guard` (
  `list_id` text PRIMARY KEY NOT NULL,
  `ok` integer NOT NULL
) WITHOUT ROWID;
CREATE TABLE `_food_pack_reorder_guard` (
  `list_id` text PRIMARY KEY NOT NULL,
  `ok` integer NOT NULL
) WITHOUT ROWID;
CREATE TABLE `_packing_location_delete_state` (
  `list_item_id` text PRIMARY KEY,
  `new_rank` integer NOT NULL,
  `seq` integer NOT NULL
) WITHOUT ROWID;
CREATE TABLE `_food_location_delete_state` (
  `food_item_id` text PRIMARY KEY,
  `new_rank` integer NOT NULL,
  `seq` integer NOT NULL
) WITHOUT ROWID;
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('d1_migrations',1);
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);
CREATE UNIQUE INDEX `categories_id_user_unique` ON `categories` (`id`,`user_id`);
CREATE INDEX `categories_user_sort_idx` ON `categories` (`user_id`,`sort_order`,`name`);
CREATE UNIQUE INDEX `gear_items_id_user_unique` ON `gear_items` (`id`,`user_id`);
CREATE INDEX `gear_items_user_sort_idx` ON `gear_items` (`user_id`,`sort_order`,`name`);
CREATE INDEX `list_food_item_slots_list_idx` ON `list_food_item_slots` (`list_id`);
CREATE INDEX `list_food_item_slots_slot_idx` ON `list_food_item_slots` (`slot_id`);
CREATE UNIQUE INDEX `list_food_items_id_list_user_unique` ON `list_food_items` (`id`,`list_id`,`user_id`);
CREATE UNIQUE INDEX `list_food_items_id_user_unique` ON `list_food_items` (`id`,`user_id`);
CREATE INDEX `list_food_items_list_sort_idx` ON `list_food_items` (`list_id`,`sort_order`);
CREATE UNIQUE INDEX `list_food_items_pack_cohort_uq` ON `list_food_items` (`list_id`,`packing_location_id`,`pack_sort_order`);
CREATE UNIQUE INDEX `list_food_items_pack_unassigned_uq` ON `list_food_items` (`list_id`,`pack_sort_order`) WHERE `packing_location_id` IS NULL;
CREATE INDEX `list_food_items_packing_location_idx` ON `list_food_items` (`packing_location_id`);
CREATE UNIQUE INDEX `list_food_slots_day_meal_unique` ON `list_food_slots` (`list_id`,`day_number`,`meal`);
CREATE UNIQUE INDEX `list_food_slots_id_list_user_unique` ON `list_food_slots` (`id`,`list_id`,`user_id`);
CREATE UNIQUE INDEX `list_food_slots_id_user_unique` ON `list_food_slots` (`id`,`user_id`);
CREATE INDEX `list_food_slots_list_day_idx` ON `list_food_slots` (`list_id`,`day_number`);
CREATE INDEX `list_items_gear_item_user_idx` ON `list_items` (`gear_item_id`,`user_id`);
CREATE INDEX `list_items_list_sort_idx` ON `list_items` (`list_id`,`sort_order`);
CREATE UNIQUE INDEX `list_items_pack_cohort_uq` ON `list_items` (`list_id`,`packing_location_id`,`pack_sort_order`);
CREATE UNIQUE INDEX `list_items_pack_unassigned_uq` ON `list_items` (`list_id`,`pack_sort_order`) WHERE `packing_location_id` IS NULL;
CREATE INDEX `list_items_packing_location_idx` ON `list_items` (`packing_location_id`);
CREATE INDEX `list_items_user_list_sort_idx` ON `list_items` (`user_id`,`list_id`,`sort_order`);
CREATE UNIQUE INDEX `lists_id_user_unique` ON `lists` (`id`,`user_id`);
CREATE UNIQUE INDEX `lists_slug_unique` ON `lists` (`slug`);
CREATE INDEX `lists_user_sort_idx` ON `lists` (`user_id`,`sort_order`,`name`);
CREATE UNIQUE INDEX `packing_locations_container_item_unique` ON `packing_locations` (`container_list_item_id`);
CREATE UNIQUE INDEX `packing_locations_id_list_user_unique` ON `packing_locations` (`id`,`list_id`,`user_id`);
CREATE UNIQUE INDEX `packing_locations_id_user_unique` ON `packing_locations` (`id`,`user_id`);
CREATE INDEX `packing_locations_list_sort_idx` ON `packing_locations` (`list_id`,`sort_order`);
CREATE INDEX `passkey_credentialID_idx` ON `passkey` (`credential_id`);
CREATE INDEX `passkey_userId_idx` ON `passkey` (`user_id`);
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);
CREATE TRIGGER `categories_user_cap`
BEFORE INSERT ON `categories`
WHEN (SELECT count(*) FROM `categories` WHERE `user_id` = NEW.`user_id`) >= 500
BEGIN
  SELECT RAISE(ABORT, 'category cap exceeded (500 per user)');
END;
CREATE TRIGGER `gear_items_user_cap`
BEFORE INSERT ON `gear_items`
WHEN (SELECT count(*) FROM `gear_items` WHERE `user_id` = NEW.`user_id`) >= 500
BEGIN
  SELECT RAISE(ABORT, 'gear item cap exceeded (500 per user)');
END;
CREATE TRIGGER `list_food_items_list_cap`
BEFORE INSERT ON `list_food_items`
WHEN (SELECT count(*) FROM `list_food_items` WHERE `list_id` = NEW.`list_id`) >= 200
BEGIN
  SELECT RAISE(ABORT, 'food item cap exceeded (200 per list)');
END;
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
CREATE TRIGGER `list_food_items_pack_rank_range_ins`
BEFORE INSERT ON `list_food_items`
FOR EACH ROW
WHEN NEW.`pack_sort_order` < 0 OR NEW.`pack_sort_order` > 1000000000
BEGIN
  SELECT RAISE(ABORT, 'food pack_sort_order out of range (0..1000000000)');
END;
CREATE TRIGGER `list_food_items_pack_rank_range_upd`
BEFORE UPDATE OF `pack_sort_order` ON `list_food_items`
FOR EACH ROW
WHEN NEW.`pack_sort_order` < -200 OR NEW.`pack_sort_order` > 1000000000
BEGIN
  SELECT RAISE(ABORT, 'food pack_sort_order out of range (-200..1000000000)');
END;
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
CREATE TRIGGER `list_items_list_cap`
BEFORE INSERT ON `list_items`
WHEN (SELECT count(*) FROM `list_items` WHERE `list_id` = NEW.`list_id`) >= 300
BEGIN
  SELECT RAISE(ABORT, 'list item cap exceeded (300 per list)');
END;
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
CREATE TRIGGER `list_items_pack_rank_range_ins`
BEFORE INSERT ON `list_items`
FOR EACH ROW
WHEN NEW.`pack_sort_order` < 0 OR NEW.`pack_sort_order` > 1000000000
BEGIN
  SELECT RAISE(ABORT, 'pack_sort_order out of range (0..1000000000)');
END;
CREATE TRIGGER `list_items_pack_rank_range_upd`
BEFORE UPDATE OF `pack_sort_order` ON `list_items`
FOR EACH ROW
WHEN NEW.`pack_sort_order` < -300 OR NEW.`pack_sort_order` > 1000000000
BEGIN
  SELECT RAISE(ABORT, 'pack_sort_order out of range (-300..1000000000)');
END;
CREATE TRIGGER `lists_user_cap`
BEFORE INSERT ON `lists`
WHEN (SELECT count(*) FROM `lists` WHERE `user_id` = NEW.`user_id`) >= 100
BEGIN
  SELECT RAISE(ABORT, 'list cap exceeded (100 per user)');
END;
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
CREATE TRIGGER `packing_locations_list_cap`
BEFORE INSERT ON `packing_locations`
WHEN (SELECT count(*) FROM `packing_locations` WHERE `list_id` = NEW.`list_id`) >= 30
BEGIN
  SELECT RAISE(ABORT, 'packing location cap exceeded (30 per list)');
END;
CREATE TRIGGER `packing_locations_owner_immutable`
BEFORE UPDATE OF `list_id`, `user_id` ON `packing_locations`
WHEN NEW.`list_id` <> OLD.`list_id` OR NEW.`user_id` <> OLD.`user_id`
BEGIN
  SELECT RAISE(ABORT, 'packing location cannot change list or owner');
END;
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