CREATE TYPE "public"."adjust_kind" AS ENUM('PERCENT', 'FIXED');--> statement-breakpoint
CREATE TYPE "public"."charge_kind" AS ENUM('NONE', 'FIRST_NIGHT', 'PERCENT', 'FULL_STAY');--> statement-breakpoint
CREATE TYPE "public"."rate_plan_type" AS ENUM('STANDARD', 'DERIVED', 'PACKAGE');--> statement-breakpoint
CREATE TABLE "daily_rates" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"organization_id" char(26) NOT NULL,
	"property_id" char(26) NOT NULL,
	"rate_plan_id" char(26) NOT NULL,
	"room_type_id" char(26) NOT NULL,
	"stay_date" date NOT NULL,
	"rate_centavos" bigint,
	"min_stay" integer DEFAULT 1 NOT NULL,
	"max_stay" integer,
	"closed" boolean DEFAULT false NOT NULL,
	"closed_to_arrival" boolean DEFAULT false NOT NULL,
	"closed_to_departure" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_rates_ck" CHECK (("daily_rates"."rate_centavos" is null or "daily_rates"."rate_centavos" >= 0) and "daily_rates"."min_stay" between 1 and 365 and ("daily_rates"."max_stay" is null or "daily_rates"."max_stay" between "daily_rates"."min_stay" and 365))
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"organization_id" char(26) NOT NULL,
	"property_id" char(26) NOT NULL,
	"name" text NOT NULL,
	"guarantee" charge_kind DEFAULT 'NONE' NOT NULL,
	"guarantee_value" bigint DEFAULT 0 NOT NULL,
	"free_cancel_hours" integer,
	"late_cancel_penalty" charge_kind DEFAULT 'NONE' NOT NULL,
	"late_cancel_value" bigint DEFAULT 0 NOT NULL,
	"no_show_penalty" charge_kind DEFAULT 'FIRST_NIGHT' NOT NULL,
	"no_show_value" bigint DEFAULT 0 NOT NULL,
	"hold_hours" integer DEFAULT 0 NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policies_values_ck" CHECK ("policies"."guarantee_value" between 0 and 10000 and "policies"."late_cancel_value" between 0 and 10000 and "policies"."no_show_value" between 0 and 10000),
	CONSTRAINT "policies_hours_ck" CHECK (("policies"."free_cancel_hours" is null or "policies"."free_cancel_hours" between 0 and 8760) and "policies"."hold_hours" between 0 and 720)
);
--> statement-breakpoint
CREATE TABLE "rate_plans" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"organization_id" char(26) NOT NULL,
	"property_id" char(26) NOT NULL,
	"code" varchar(12) NOT NULL,
	"name" text NOT NULL,
	"type" "rate_plan_type" NOT NULL,
	"parent_id" char(26),
	"adjust_kind" "adjust_kind" DEFAULT 'PERCENT' NOT NULL,
	"adjust_value" bigint DEFAULT 0 NOT NULL,
	"package_add_centavos" bigint DEFAULT 0 NOT NULL,
	"inclusions" text,
	"policy_id" char(26) NOT NULL,
	"sell_online" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_plans_parent_ck" CHECK (("rate_plans"."type" = 'STANDARD' and "rate_plans"."parent_id" is null) or ("rate_plans"."type" <> 'STANDARD' and "rate_plans"."parent_id" is not null)),
	CONSTRAINT "rate_plans_package_ck" CHECK ("rate_plans"."package_add_centavos" >= 0)
);
--> statement-breakpoint
ALTER TABLE "daily_rates" ADD CONSTRAINT "daily_rates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_rates" ADD CONSTRAINT "daily_rates_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_rates" ADD CONSTRAINT "daily_rates_rate_plan_id_rate_plans_id_fk" FOREIGN KEY ("rate_plan_id") REFERENCES "public"."rate_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_rates" ADD CONSTRAINT "daily_rates_room_type_id_room_types_id_fk" FOREIGN KEY ("room_type_id") REFERENCES "public"."room_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_policy_id_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_rates_plan_type_date_uq" ON "daily_rates" USING btree ("rate_plan_id","room_type_id","stay_date");--> statement-breakpoint
CREATE INDEX "daily_rates_property_date_idx" ON "daily_rates" USING btree ("property_id","stay_date");--> statement-breakpoint
CREATE UNIQUE INDEX "policies_property_name_uq" ON "policies" USING btree ("property_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_plans_property_code_uq" ON "rate_plans" USING btree ("property_id","code");