import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { patients } from '@/lib/db/schema'

async function verifyLegacyCount() {
  try {
    const legacyPatients = await db.query.patients.findMany({
      where: eq(patients.type, 'legacy'),
    })
    console.log(`VERIFICATION: Found ${legacyPatients.length} legacy patients.`)
  } catch (error) {
    console.error(error)
  }
}

verifyLegacyCount()
