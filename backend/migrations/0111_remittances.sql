-- admin-v1 §14.2 / F — remittances of statutory payables to government.
CREATE TABLE IF NOT EXISTS "remittances" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "payableCode" text NOT NULL,
  "payableName" text,
  "amount" numeric(15, 2) NOT NULL,
  "reference" text,
  "paidAt" timestamp DEFAULT now() NOT NULL,
  "createdById" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
