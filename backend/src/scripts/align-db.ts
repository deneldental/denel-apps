import * as dotenv from 'dotenv'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { appointments, doctors, doctorUnavailability, specialists } from '../db/schema'

dotenv.config()

async function main() {
  const db = getDb(process.env.DATABASE_URL!)

  console.log('Migrating block times from duplicate profile to unified profile...')
  const updatedBlocks = await db
    .update(doctorUnavailability)
    .set({ doctorId: '6b1a6241-bef9-4a8d-882d-75227264abff' })
    .where(eq(doctorUnavailability.doctorId, 'e4ef884e-069b-4329-bf62-045919212cba'))
    .returning()
  console.log(`Migrated ${updatedBlocks.length} block time records.`)

  console.log('Migrating appointments from duplicate profile to unified profile...')
  const updatedAppts = await db
    .update(appointments)
    .set({ doctorId: '6b1a6241-bef9-4a8d-882d-75227264abff' })
    .where(eq(appointments.doctorId, 'e4ef884e-069b-4329-bf62-045919212cba'))
    .returning()
  console.log(`Migrated ${updatedAppts.length} appointment records.`)

  console.log('Unlinking inactive specialist profile from user ID...')
  await db
    .update(specialists)
    .set({ userId: null })
    .where(eq(specialists.id, 'f3a463a9-292c-443d-86eb-2b2889432cf1'))

  console.log('Linking active specialist profile to standard test doctor user ID...')
  await db
    .update(specialists)
    .set({ userId: '8d83b240-c52d-4265-83cf-c367e889b926' })
    .where(eq(specialists.id, 'b1b2c35f-53ea-43b5-8979-a70e3d91615d'))

  console.log('Deleting duplicate direct doctor profile...')
  await db.delete(doctors).where(eq(doctors.id, 'e4ef884e-069b-4329-bf62-045919212cba'))

  console.log('Database alignment completed successfully!')
}

main().catch(console.error)
