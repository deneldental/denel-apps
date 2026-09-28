import { sql } from 'drizzle-orm'

export async function ensureComplianceSchema(db: any) {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "compliance_documents" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "documentName" text NOT NULL,
      "category" text NOT NULL,
      "documentUrl" text,
      "dateIssued" timestamp,
      "dateExpired" timestamp,
      "reminderEnabled" boolean DEFAULT false NOT NULL,
      "reminderMonthsBefore" integer DEFAULT 3,
      "reminderPhones" jsonb DEFAULT '[]'::jsonb,
      "reminderMessage" text,
      "createdById" text,
      "createdAt" timestamp DEFAULT now() NOT NULL,
      "updatedAt" timestamp DEFAULT now() NOT NULL
    )
  `)
}
