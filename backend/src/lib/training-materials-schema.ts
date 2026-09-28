import { sql } from 'drizzle-orm'
import { logger } from './logger'

export async function ensureTrainingMaterialsSchema(db: any) {
  const alters = [
    `ALTER TABLE "training_materials" ADD COLUMN IF NOT EXISTS "quizTimer" integer`,
    `ALTER TABLE "training_materials" ADD COLUMN IF NOT EXISTS "quizQuestions" jsonb DEFAULT '[]'::jsonb`,
    `ALTER TABLE "training_materials" ADD COLUMN IF NOT EXISTS "blocks" jsonb DEFAULT '[]'::jsonb`,
    `ALTER TABLE "training_materials" ADD COLUMN IF NOT EXISTS "published" boolean DEFAULT false`,
    `ALTER TABLE "training_materials" ADD COLUMN IF NOT EXISTS "publishedAt" timestamp`,
    `ALTER TABLE "training_materials" ADD COLUMN IF NOT EXISTS "audience" text DEFAULT 'All Staff'`,
    `ALTER TABLE "training_materials" ADD COLUMN IF NOT EXISTS "level" text DEFAULT 'info'`,
  ]

  for (const stmt of alters) {
    try {
      await db.execute(sql.raw(stmt))
    } catch (err: any) {
      // Column already exists or other non-fatal error — log and continue
      logger.warn(`[ensureTrainingMaterialsSchema] ${stmt} -> ${err?.message}`)
    }
  }
}
