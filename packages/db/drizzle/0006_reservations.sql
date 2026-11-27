CREATE TYPE "public"."discount_type" AS ENUM('SENIOR_CITIZEN', 'PWD', 'PROMO', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."res_source" AS ENUM('DIRECT_ENGINE', 'WALK_IN', 'PHONE', 'EMAIL', 'CORPORATE', 'TRAVEL_AGENT', 'OTA_AGODA', 'OTA_BOOKING', 'OTA_EXPEDIA', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."res_status" AS ENUM('INQUIRY', 'NOT_CONFIRMED', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW');--> statement-breakpoint
CREATE TABLE "guests" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"organization_id" char(26) NOT NULL,
	"property_id" char(26) NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" varchar(254),
	"mobile" varchar(32),
	"nationality" varchar(2),
	"address" text,
	"birth_date" date,
	"company" text,
	"notes" text,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"id_type" varchar(40),
	"id_number" varchar(60),
	"id_file_id" char(26),
	"anonymized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservation_discounts" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"organization_id" char(26) NOT NULL,
	"property_id" char(26) NOT NULL,
	"reservation_room_id" char(26) NOT NULL,
	"guest_id" char(26),
	"type" "discount_type" NOT NULL,
	"id_number" varchar(60),
	"holder_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservation_notes" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"organization_id" char(26) NOT NULL,
	"property_id" char(26) NOT NULL,
	"reservation_id" char(26) NOT NULL,
	"body" text NOT NULL,
	"author_user_id" char(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservation_rooms" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"organization_id" char(26) NOT NULL,
	"property_id" char(26) NOT NULL,
	"reservation_id" char(26) NOT NULL,
	"room_type_id" char(26) NOT NULL,
	"rate_plan_id" char(26) NOT NULL,
	"room_id" char(26),
	"check_in" date NOT NULL,
	"check_out" date NOT NULL,
	"adults" integer DEFAULT 1 NOT NULL,
	"children" integer DEFAULT 0 NOT NULL,
	"total_centavos" bigint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_rooms_dates_ck" CHECK ("reservation_rooms"."check_out" > "reservation_rooms"."check_in")
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"organization_id" char(26) NOT NULL,
	"property_id" char(26) NOT NULL,
	"code" varchar(12) NOT NULL,
	"status" "res_status" NOT NULL,
	"source" "res_source" NOT NULL,
	"check_in" date NOT NULL,
	"check_out" date NOT NULL,
	"main_guest_id" char(26) NOT NULL,
	"adults" integer DEFAULT 1 NOT NULL,
	"children" integer DEFAULT 0 NOT NULL,
	"total_centavos" bigint DEFAULT 0 NOT NULL,
	"guarantee_centavos" bigint DEFAULT 0 NOT NULL,
	"penalty_centavos" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"external_ref" varchar(60),
	"created_business_date" date NOT NULL,
	"created_by_user_id" char(26),
	"hold_until" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"checked_in_at" timestamp with time zone,
	"checked_out_at" timestamp with time zone,
	"checked_out_business_date" date,
	"cancelled_at" timestamp with time zone,
	"cancelled_business_date" date,
	"cancel_reason" text,
	"no_show_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_dates_ck" CHECK ("reservations"."check_out" > "reservations"."check_in"),
	CONSTRAINT "reservations_people_ck" CHECK ("reservations"."adults" >= 1 and "reservations"."children" >= 0)
);
--> statement-breakpoint
CREATE TABLE "room_nights" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"organization_id" char(26) NOT NULL,
	"property_id" char(26) NOT NULL,
	"reservation_id" char(26) NOT NULL,
	"reservation_room_id" char(26) NOT NULL,
	"room_type_id" char(26) NOT NULL,
	"room_id" char(26),
	"stay_date" date NOT NULL,
	"rate_centavos" bigint NOT NULL,
	"posted" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stored_files" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"organization_id" char(26) NOT NULL,
	"property_id" char(26) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"owner_id" char(26) NOT NULL,
	"file_name" text NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_by_user_id" char(26),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "stored_files_size_ck" CHECK ("stored_files"."size_bytes" <= 10485760)
);
--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_discounts" ADD CONSTRAINT "reservation_discounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_discounts" ADD CONSTRAINT "reservation_discounts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_discounts" ADD CONSTRAINT "reservation_discounts_reservation_room_id_reservation_rooms_id_fk" FOREIGN KEY ("reservation_room_id") REFERENCES "public"."reservation_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_discounts" ADD CONSTRAINT "reservation_discounts_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_notes" ADD CONSTRAINT "reservation_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_notes" ADD CONSTRAINT "reservation_notes_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_notes" ADD CONSTRAINT "reservation_notes_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_notes" ADD CONSTRAINT "reservation_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_rooms" ADD CONSTRAINT "reservation_rooms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_rooms" ADD CONSTRAINT "reservation_rooms_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_rooms" ADD CONSTRAINT "reservation_rooms_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_rooms" ADD CONSTRAINT "reservation_rooms_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_rooms" ADD CONSTRAINT "reservation_rooms_rate_plan_id_rate_plans_id_fk" FOREIGN KEY ("rate_plan_id") REFERENCES "public"."rate_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_rooms" ADD CONSTRAINT "reservation_rooms_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_main_guest_id_guests_id_fk" FOREIGN KEY ("main_guest_id") REFERENCES "public"."guests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_nights" ADD CONSTRAINT "room_nights_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_nights" ADD CONSTRAINT "room_nights_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_nights" ADD CONSTRAINT "room_nights_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_nights" ADD CONSTRAINT "room_nights_reservation_room_id_reservation_rooms_id_fk" FOREIGN KEY ("reservation_room_id") REFERENCES "public"."reservation_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_nights" ADD CONSTRAINT "room_nights_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_nights" ADD CONSTRAINT "room_nights_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guests_property_last_idx" ON "guests" USING btree ("property_id",lower("last_name"));--> statement-breakpoint
CREATE INDEX "guests_property_email_idx" ON "guests" USING btree ("property_id",lower("email"));--> statement-breakpoint
CREATE INDEX "guests_property_mobile_idx" ON "guests" USING btree ("property_id","mobile");--> statement-breakpoint
CREATE INDEX "reservation_notes_res_idx" ON "reservation_notes" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "reservation_rooms_res_idx" ON "reservation_rooms" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_property_code_uq" ON "reservations" USING btree ("property_id","code");--> statement-breakpoint
CREATE INDEX "reservations_property_dates_idx" ON "reservations" USING btree ("property_id","check_in","check_out");--> statement-breakpoint
CREATE INDEX "reservations_guest_idx" ON "reservations" USING btree ("main_guest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "room_nights_room_date_active_uq" ON "room_nights" USING btree ("room_id","stay_date") WHERE "room_nights"."active" and "room_nights"."room_id" is not null;--> statement-breakpoint
CREATE INDEX "room_nights_property_date_idx" ON "room_nights" USING btree ("property_id","stay_date");--> statement-breakpoint
CREATE INDEX "room_nights_res_room_idx" ON "room_nights" USING btree ("reservation_room_id");--> statement-breakpoint
CREATE INDEX "stored_files_owner_idx" ON "stored_files" USING btree ("owner_id");