import { inArray, like } from 'drizzle-orm'
import { db } from '@/lib/db'
import { patients, paymentPlans } from '@/lib/db/schema'

async function migrateLegacyPatients() {
  console.log('🚀 Starting migration of legacy patients...')

  try {
    // 1. Find payment plans with the specific note
    const targetNote = 'Imported from legacy system - Outstanding balance'
    const plans = await db.query.paymentPlans.findMany({
      where: like(paymentPlans.notes, `%${targetNote}%`),
      columns: {
        patientId: true,
      },
    })

    if (plans.length === 0) {
      console.log('ℹ️ No payment plans found with the specified note.')
      return
    }

    const patientIds = plans.map((p) => p.patientId)
    console.log(`Found ${patientIds.length} patients to migrate.`)

    // 2. Update patients
    // Drizzle doesn't support update with join directly easily in all drivers, so we use IDs
    // Batching might be needed if there are huge numbers, but for "some patients" this should be fine.

    // De-duplicate IDs just in case
    const uniquePatientIds = [...new Set(patientIds)]

    const result = await db
      .update(patients)
      .set({ type: 'legacy' })
      .where(inArray(patients.id, uniquePatientIds))
      .returning({ id: patients.id })

    console.log(`✅ Successfully migrated ${result.length} patients to 'legacy' type.`)
  } catch (error) {
    console.error('❌ Error during migration:', error)
  } finally {
    process.exit(0)
  }
}

// Run if called directly
if (require.main === module) {
  migrateLegacyPatients()
}
