import * as dotenv from 'dotenv'
import { getDb } from '../db'
import { appointments, doctorUnavailability } from '../db/schema'

dotenv.config()

async function main() {
  const db = getDb(process.env.DATABASE_URL!)
  const unavail = await db.select().from(doctorUnavailability)
  console.log('--- Doctor Unavailability ---')
  console.log(JSON.stringify(unavail, null, 2))

  const appts = await db.select().from(appointments)
  console.log('--- Appointments ---')
  console.log(JSON.stringify(appts, null, 2))
}

main().catch(console.error)
