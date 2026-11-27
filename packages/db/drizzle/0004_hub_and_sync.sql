CREATE TYPE "public"."device_kind" AS ENUM('WINDOWS_DESKTOP', 'ANDROID_TABLET', 'IPAD', 'MAC_DESKTOP', 'BROWSER');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('OPEN', 'RESOLVED', 'IGNORED');--> statement-breakpoint
CREATE TABLE "devices" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"organization_id" char(26) NOT NULL,
	"property_id" char(26) NOT NULL,
	"name" text NOT NULL,
	"kind" "device_kind" DEFAULT 'BROWSER' NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"paired_by_user_id" char(26),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hubs" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"organization_id" char(26) NOT NULL,
	"property_id" char(26) NOT NULL,
	"name" text NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"app_version" text,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_pushed_seq" bigint DEFAULT 0 NOT NULL,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pairing_codes" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"organization_id" char(26) NOT NULL,
	"property_id" char(26) NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"created_by_user_id" char(26) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_issues" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"event_id" char(26) NOT NULL,
	"direction" varchar(8) NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"reason" text NOT NULL,
	"status" "issue_status" DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "cloud_url" text;--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "hub_token" text;--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "organization_id" char(26);--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "property_id" char(26);--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "enrolled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_state" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_token_uq" ON "devices" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "hubs_token_uq" ON "hubs" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "hubs_property_idx" ON "hubs" USING btree ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_issues_event_dir_uq" ON "sync_issues" USING btree ("event_id","direction");