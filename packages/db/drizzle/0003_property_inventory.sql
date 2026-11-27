CREATE TYPE "public"."block_type" AS ENUM('OUT_OF_SERVICE', 'OWNER_STAY', 'COURTESY_HOLD');--> statement-breakpoint
CREATE TYPE "public"."calc_basis" AS ENUM('PER_NIGHT', 'PER_STAY', 'PER_GUEST_PER_NIGHT', 'PER_RESERVATION');--> statement-breakpoint
CREATE TYPE "public"."calc_type" AS ENUM('PERCENT', 'FIXED');--> statement-breakpoint
CREATE TYPE "public"."hk_condition" AS ENUM('DIRTY', 'CLEAN', 'INSPECTED');--> statement-breakpoint
CREATE TYPE "public"."room_kind" AS ENUM('PRIVATE', 'DORM_BED', 'VIRTUAL');--> statement-breakpoint
CREATE TYPE "public"."tax_kind" AS ENUM('TAX', 'FEE', 'DISCOUNT');--> statement-breakpoint
CREATE TABLE "inventory_days" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"organization_id" char(26) NOT NULL,
	"property_id" char(26) NOT NULL,
	"room_type_id" char(26) NOT NULL,
	"stay_date" date NOT NULL,
	"total_units" integer NOT NULL,
	"blocked_units" integer DEFAULT 0 NOT NULL,
	"sold_units" integer DEFAULT 0 NOT NULL,
	"overbooked_units" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_days_nonneg_ck" CHECK ("inventory_days"."total_units" >= 0 and "inventory_days"."blocked_units" >= 0 and "inventory_days"."sold_units" >= 0 and "inventory_days"."overbooked_units" >= 0),
	CONSTRAINT "inventory_days_not_oversold_ck" CHECK ("inventory_days"."sold_units" + "inventory_days"."blocked_units" <= "inventory_days"."total_units" + "inventory_days"."overbooked_units")
);
--> statement-breakpoint
CREATE TABLE "room_blocks" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"organization_id" char(26) NOT NULL,
	"property_id" char(26) NOT NULL,
	"room_id" char(26) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"type" "block_type" NOT NULL,
	"reason" text NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_blocks_dates_ck" CHECK ("room_blocks"."end_date" > "room_blocks"."start_date")
);
--> statement-breakpoint
CREATE TABLE "room_types" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"organization_id" char(26) NOT NULL,
	"property_id" char(26) NOT NULL,
	"code" varchar(12) NOT NULL,
	"name" text NOT NULL,
	"kind" "room_kind" DEFAULT 'PRIVATE' NOT NULL,
	"max_guests" integer DEFAULT 2 NOT NULL,
	"base_rate_centavos" bigint NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "room_types_max_guests_ck" CHECK ("room_types"."max_guests" between 1 and 50),
	CONSTRAINT "room_types_base_rate_ck" CHECK ("room_types"."base_rate_centavos" >= 0)
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"organization_id" char(26) NOT NULL,
	"property_id" char(26) NOT NULL,
	"room_type_id" char(26) NOT NULL,
	"number" varchar(20) NOT NULL,
	"condition" "hk_condition" DEFAULT 'CLEAN' NOT NULL,
	"housekeeper_user_id" char(26),
	"condition_changed_at" timestamp with time zone,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_fees" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"organization_id" char(26) NOT NULL,
	"property_id" char(26) NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" text NOT NULL,
	"kind" "tax_kind" NOT NULL,
	"calc" "calc_type" NOT NULL,
	"basis" "calc_basis" DEFAULT 'PER_NIGHT' NOT NULL,
	"value" bigint NOT NULL,
	"inclusive" boolean DEFAULT false NOT NULL,
	"gl_code" varchar(30) NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_fees_value_ck" CHECK ("tax_fees"."value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_days" ADD CONSTRAINT "inventory_days_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_days" ADD CONSTRAINT "inventory_days_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_days" ADD CONSTRAINT "inventory_days_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_blocks" ADD CONSTRAINT "room_blocks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_blocks" ADD CONSTRAINT "room_blocks_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_blocks" ADD CONSTRAINT "room_blocks_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_types" ADD CONSTRAINT "room_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_types" ADD CONSTRAINT "room_types_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_housekeeper_user_id_users_id_fk" FOREIGN KEY ("housekeeper_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_fees" ADD CONSTRAINT "tax_fees_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_fees" ADD CONSTRAINT "tax_fees_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_days_type_date_uq" ON "inventory_days" USING btree ("room_type_id","stay_date");--> statement-breakpoint
CREATE INDEX "inventory_days_property_date_idx" ON "inventory_days" USING btree ("property_id","stay_date");--> statement-breakpoint
CREATE INDEX "room_blocks_room_idx" ON "room_blocks" USING btree ("room_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "room_types_property_code_uq" ON "room_types" USING btree ("property_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "rooms_property_number_uq" ON "rooms" USING btree ("property_id","number");--> statement-breakpoint
CREATE INDEX "rooms_type_idx" ON "rooms" USING btree ("room_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_fees_property_code_uq" ON "tax_fees" USING btree ("property_id","code");