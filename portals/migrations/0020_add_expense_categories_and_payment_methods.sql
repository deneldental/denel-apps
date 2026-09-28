CREATE TABLE IF NOT EXISTS "expense_categories" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL UNIQUE,
    "displayName" text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp DEFAULT now() NOT NULL,
    "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "payment_methods" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL UNIQUE,
    "displayName" text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp DEFAULT now() NOT NULL,
    "updatedAt" timestamp DEFAULT now() NOT NULL
);

-- Insert default expense categories
INSERT INTO "expense_categories" ("name", "displayName", "isActive") VALUES
    ('utilities', 'Utilities', true),
    ('rent', 'Rent', true),
    ('miscellaneous', 'Miscellaneous', true),
    ('others', 'Others', true)
ON CONFLICT ("name") DO NOTHING;

-- Insert default payment methods
INSERT INTO "payment_methods" ("name", "displayName", "isActive") VALUES
    ('cash', 'Cash', true),
    ('momo', 'MoMo', true),
    ('bank_transfer', 'Bank Transfer', true),
    ('card', 'Card', true),
    ('insurance', 'Insurance', true),
    ('transfer', 'Transfer', true)
ON CONFLICT ("name") DO NOTHING;
