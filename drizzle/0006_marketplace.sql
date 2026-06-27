CREATE TABLE IF NOT EXISTS "marketplace_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"specifier" text NOT NULL,
	"version" text,
	"author" text,
	"homepage" text,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_items_name_unique" UNIQUE("name")
);
