import { eq, isNull } from 'drizzle-orm'
import { db } from '../lib/db'
import { patients } from '../lib/db/schema'

async function assignPatientIds() {
  console.log('🔍 Checking for patients without IDs...\n')

  // Get all patients without patientId
  const patientsWithoutId = await db
    .select({
      id: patients.id,
      name: patients.name,
      patientId: patients.patientId,
      createdAt: patients.createdAt,
    })
    .from(patients)
    .where(isNull(patients.patientId))
    .orderBy(patients.createdAt)

  console.log(`📊 Found ${patientsWithoutId.length} patients without IDs\n`)

  if (patientsWithoutId.length === 0) {
    console.log('✅ All patients already have IDs!')
    process.exit(0)
  }

  // Get the highest existing patient ID to continue numbering
  const allPatients = await db
    .select({ patientId: patients.patientId })
    .from(patients)
    .orderBy(patients.patientId)

  let nextIdNumber = 1

  // Find the highest existing ID number
  for (const patient of allPatients) {
    if (patient.patientId) {
      const match = patient.patientId.match(/#FMD(\d+)/)
      if (match) {
        const idNum = parseInt(match[1], 10)
        if (idNum >= nextIdNumber) {
          nextIdNumber = idNum + 1
        }
      }
    }
  }

  console.log(`🔢 Starting ID assignment from #FMD${nextIdNumber.toString().padStart(6, '0')}\n`)

  let successCount = 0
  let errorCount = 0

  // Assign IDs in batches
  const batchSize = 100
  for (let i = 0; i < patientsWithoutId.length; i += batchSize) {
    const batch = patientsWithoutId.slice(i, i + batchSize)

    for (const patient of batch) {
      try {
        const patientId = `#FMD${nextIdNumber.toString().padStart(6, '0')}`

        await db.update(patients).set({ patientId }).where(eq(patients.id, patient.id))

        nextIdNumber++
        successCount++

        if (successCount % 100 === 0) {
          console.log(`✅ Progress: ${successCount}/${patientsWithoutId.length} IDs assigned`)
        }
      } catch (error) {
        console.error(`❌ Error assigning ID to patient ${patient.name}:`, error)
        errorCount++
      }
    }
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log('📋 ASSIGNMENT SUMMARY')
  console.log('='.repeat(60))
  console.log(`✅ Successfully assigned: ${successCount} patient IDs`)
  console.log(`❌ Failed: ${errorCount}`)
  console.log(`🔢 Next available ID: #FMD${nextIdNumber.toString().padStart(6, '0')}`)
  console.log('='.repeat(60))

  process.exit(0)
}

assignPatientIds().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
