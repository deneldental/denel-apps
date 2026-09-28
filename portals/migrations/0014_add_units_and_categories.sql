CREATE TABLE IF NOT EXISTS "units" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL UNIQUE,
    "displayName" text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp DEFAULT now() NOT NULL,
    "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "categories" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL UNIQUE,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp DEFAULT now() NOT NULL,
    "updatedAt" timestamp DEFAULT now() NOT NULL
);

-- Insert default units
INSERT INTO "units" ("name", "displayName", "isActive") VALUES
    ('pcs', 'Pieces (pcs)', true),
    ('kg', 'Kilogram (kg)', true),
    ('g', 'Gram (g)', true),
    ('gallon', 'Gallon', true),
    ('liter', 'Liter (L)', true),
    ('ml', 'Milliliter (ml)', true),
    ('box', 'Box', true),
    ('pack', 'Pack', true),
    ('bottle', 'Bottle', true),
    ('tube', 'Tube', true),
    ('carton', 'Carton', true),
    ('roll', 'Roll', true),
    ('sheet', 'Sheet', true),
    ('pair', 'Pair', true),
    ('set', 'Set', true),
    ('other', 'Other', true)
ON CONFLICT ("name") DO NOTHING;

-- Insert default categories
INSERT INTO "categories" ("name", "isActive") VALUES
    ('consumables', true),
    ('instruments', true),
    ('materials', true),
    ('medicine', true),
    ('supplies', true),
    ('equipment', true),
    ('other', true)
ON CONFLICT ("name") DO NOTHING;
