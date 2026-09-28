import * as dotenv from 'dotenv'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '../db/schema'

dotenv.config({ path: '.dev.vars' })

const DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://framada:framada@localhost:5432/framada'
if (!DATABASE_URL) throw new Error('DATABASE_URL environment variable is required')

const cleanUrl = DATABASE_URL.replace(/([?&])sslmode=[^&]*/g, '$1')
  .replace(/[?&]$/, '')
  .replace(/\?&/, '?')

const isLocal = cleanUrl.includes('localhost') || cleanUrl.includes('127.0.0.1')
const pool = new Pool({
  connectionString: cleanUrl,
  ...(isLocal ? {} : { ssl: { rejectUnauthorized: false } }),
})
const db = drizzle(pool, { schema })

// Matched on `systemKey`, never on `name`. This script previously looked tags
// up by name and seeded lowercase 'insurance' — while migration 0109 had
// already inserted 'Insurance'. Postgres compares the UNIQUE name column
// case-sensitively, so both rows survived and the patient-intake insurance
// trigger bound to whichever the API returned first. `name` below is only used
// when creating a tag that does not exist yet; renames made in Settings are
// never reverted.
const SYSTEM_TAGS = [
  { systemKey: 'insurance', name: 'Insurance', color: 'emerald' },
  { systemKey: 'xray', name: 'X-ray', color: 'slate' },
  { systemKey: 'lab', name: 'Lab', color: 'slate' },
  { systemKey: 'ortho', name: 'Ortho', color: 'violet' },
]

async function main() {
  console.log(`🌱 Seeding system patient tags...\n`)

  for (const tag of SYSTEM_TAGS) {
    const byKey = await db.query.patientTags.findFirst({
      where: eq(schema.patientTags.systemKey, tag.systemKey),
    })

    if (byKey) {
      console.log(`✓ System tag '${byKey.name}' (${tag.systemKey}) already exists.`)
      continue
    }

    // No row carries the key yet — adopt a name match if one exists (the case
    // migration 0192 handles, kept here so a fresh DB and an upgraded one
    // converge) rather than creating a duplicate.
    const byName = await db.query.patientTags.findFirst({
      where: sql`lower(${schema.patientTags.name}) = lower(${tag.name})`,
    })

    if (byName) {
      await db
        .update(schema.patientTags)
        .set({ systemKey: tag.systemKey, isSystem: true })
        .where(eq(schema.patientTags.id, byName.id))
      console.log(`✓ Adopted existing tag '${byName.name}' as system key '${tag.systemKey}'.`)
      continue
    }

    await db.insert(schema.patientTags).values({
      name: tag.name,
      color: tag.color,
      isSystem: true,
      systemKey: tag.systemKey,
    })
    console.log(`✓ Created system tag '${tag.name}' (${tag.systemKey}).`)
  }

  console.log(`\n✅ System tags seeded successfully.`)
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Failed to seed patient tags:', err)
  process.exit(1)
})
