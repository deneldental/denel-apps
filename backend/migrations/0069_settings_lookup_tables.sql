-- Settings lookup tables: document_tags, inventory_locations, compliance_categories, consent_templates

CREATE TABLE IF NOT EXISTS "document_tags" (
  "id"           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  "name"         text NOT NULL UNIQUE,
  "display_name" text NOT NULL,
  "color"        text NOT NULL DEFAULT 'slate',
  "is_active"    boolean NOT NULL DEFAULT true,
  "created_at"   timestamp DEFAULT now() NOT NULL,
  "updated_at"   timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "inventory_locations" (
  "id"          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  "name"        text NOT NULL,
  "code"        text NOT NULL UNIQUE,
  "description" text,
  "is_active"   boolean NOT NULL DEFAULT true,
  "created_at"  timestamp DEFAULT now() NOT NULL,
  "updated_at"  timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "compliance_categories" (
  "id"          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  "name"        text NOT NULL,
  "description" text,
  "color"       text NOT NULL DEFAULT 'slate',
  "icon_name"   text,
  "is_active"   boolean NOT NULL DEFAULT true,
  "created_at"  timestamp DEFAULT now() NOT NULL,
  "updated_at"  timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "consent_templates" (
  "id"          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  "name"        text NOT NULL,
  "type"        text NOT NULL DEFAULT 'general',
  "description" text,
  "pdf_url"     text,
  "pdf_key"     text,
  "is_active"   boolean NOT NULL DEFAULT true,
  "created_at"  timestamp DEFAULT now() NOT NULL,
  "updated_at"  timestamp DEFAULT now() NOT NULL
);
