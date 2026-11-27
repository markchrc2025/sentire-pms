CREATE TABLE "sync_state" (
	"id" char(26) PRIMARY KEY NOT NULL,
	"hub_id" text NOT NULL,
	"last_pushed_seq" bigint DEFAULT 0 NOT NULL,
	"last_pulled_cursor" text,
	"last_success_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_sign_ins" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp with time zone;