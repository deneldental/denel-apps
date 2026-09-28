import { ilike } from 'drizzle-orm'
import { db } from '@/lib/db'
import { patients } from '@/lib/db/schema'

async function checkSpecificPatient() {
  const patient = await db.query.patients.findFirst({
    where: ilike(patients.name, '%Accorley Benedicta Elorm%'),
  })

  console.log('Found patient:', JSON.stringify(patient, null, 2))

  // check count of total patients
  const all = await db.query.patients.findMany({
    columns: { id: true, patientId: true },
  })
  console.log('Total patients count:', all.length)

  // Check specifically for IDs starting with #FDM
  const importedCount = all.filter((p) => p.patientId?.startsWith('#FDM')).length
  console.log('Patients with #FDM prefix:', importedCount)
}

checkSpecificPatient().catch(console.error)
