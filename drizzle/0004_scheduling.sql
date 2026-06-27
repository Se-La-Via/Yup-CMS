ALTER TYPE "public"."entry_status" ADD VALUE 'scheduled' BEFORE 'pending_review';--> statement-breakpoint
ALTER TABLE "content_entries" ADD COLUMN "publish_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entries_due_schedule" ON "content_entries" USING btree ("status","publish_at");