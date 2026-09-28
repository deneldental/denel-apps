CREATE TABLE IF NOT EXISTS "supplier_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "supplier_id" uuid NOT NULL,
  "title" text NOT NULL,
  "file_name" text NOT NULL,
  "file_url" text NOT NULL,
  "file_key" text,
  "size_bytes" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "supplier_price_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "supplier_id" uuid NOT NULL,
  "item_name" text NOT NULL,
  "unit" text NOT NULL,
  "unit_price" numeric(12, 2) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
