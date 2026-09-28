CREATE TABLE IF NOT EXISTS "inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sku" text UNIQUE,
	"category" text,
	"unit" text,
	"stockQuantity" integer DEFAULT 0 NOT NULL,
	"reorderLevel" integer DEFAULT 10,
	"image" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
