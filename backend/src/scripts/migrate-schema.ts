import { sql } from 'drizzle-orm'
import { getDb } from '../db'

async function main() {
  const db = getDb(process.env.DATABASE_URL!)
  try {
    await db.execute(
      sql`ALTER TABLE patient_cases ADD COLUMN IF NOT EXISTS "planId" uuid REFERENCES treatment_plans(id) ON DELETE SET NULL;`
    )
    await db.execute(
      sql`ALTER TABLE case_stages ADD COLUMN IF NOT EXISTS "planItemId" uuid REFERENCES treatment_plan_items(id) ON DELETE SET NULL;`
    )
    console.log('Success')
  } catch (e) {
    console.error(e)
  }
  process.exit(0)
}
main()
