import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'csv-parse/sync'
import { db } from '@/lib/db'
import { patients, paymentPlans } from '@/lib/db/schema'

interface CSVPatient {
  'Patient ID': string
  'Full Name': string
  'First Name': string
  Surname: string
  Gender: string
  Age: string
  Nationality: string
  Residence: string
  Phone: string
  Occupation: string
  'Date Joined': string
  Balance: string
}

async function importPatientsWithPaymentPlans() {
  console.log('🚀 Starting import of non-zero balance patients with payment plans...\n')

  // Read CSV file
  const csvPath = path.join(process.cwd(), 'patients_non_zero_balance.csv')
  const fileContent = fs.readFileSync(csvPath, 'utf-8')

  // Parse CSV
  const records: CSVPatient[] = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  })

  console.log(`📊 Found ${records.length} patients in CSV\n`)

  let imported = 0
  let plansCreated = 0
  let skipped = 0
  const errors: Array<{ name: string; error: string }> = []

  for (const record of records) {
    try {
      const age = parseInt(record.Age, 10)
      const isChild = age < 18
      const balance = parseFloat(record.Balance)

      // Skip if balance is 0 (safety check)
      if (balance === 0) {
        console.log(`⚠️  Skipping ${record['Full Name']} - zero balance`)
        skipped++
        continue
      }

      // Parse date
      const dateJoined = new Date(record['Date Joined'])
      if (Number.isNaN(dateJoined.getTime())) {
        throw new Error(`Invalid date: ${record['Date Joined']}`)
      }

      // Calculate DOB from age
      const dob = new Date()
      dob.setFullYear(dob.getFullYear() - age)

      // Use transaction to ensure patient and payment plan are created together
      await db.transaction(async (tx) => {
        // Insert patient
        const [patient] = await tx
          .insert(patients)
          .values({
            name: record['Full Name'].trim(),
            phone: isChild ? null : record.Phone.trim(),
            guardianPhone: isChild ? record.Phone.trim() : null,
            dob,
            gender: record.Gender.toLowerCase(),
            address: record.Residence?.trim() || null,
            occupation: record.Occupation?.trim() || null,
            nationality: record.Nationality?.trim() || 'Ghana',
            isChild,
            isOrtho: false,
            type: 'general' as const,
            createdAt: dateJoined,
            updatedAt: dateJoined,
          })
          .returning()

        // Create flexible payment plan
        const totalAmount = Math.abs(balance) // Convert negative to positive
        await tx.insert(paymentPlans).values({
          patientId: patient.id,
          type: 'flexible',
          totalAmount,
          status: 'outstanding',
          startDate: dateJoined,
          notes: 'Imported from legacy system - Outstanding balance',
          createdAt: dateJoined,
          updatedAt: dateJoined,
        })

        imported++
        plansCreated++
      })

      // Progress update
      if (imported % 50 === 0) {
        console.log(`✅ Progress: ${imported}/${records.length} processed`)
      }
    } catch (error) {
      skipped++
      errors.push({
        name: record['Full Name'],
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      console.error(`❌ Error importing ${record['Full Name']}:`, error)
    }
  }

  // Summary
  console.log('\n📋 Import Summary:')
  console.log(`✅ Successfully imported: ${imported} patients`)
  console.log(`💰 Payment plans created: ${plansCreated}`)
  console.log(`⚠️  Skipped: ${skipped} patients`)

  if (errors.length > 0) {
    console.log('\n❌ Errors:')
    errors.forEach((err) => {
      console.log(`  - ${err.name}: ${err.error}`)
    })
  }

  return { imported, plansCreated, skipped, errors }
}

// Run if called directly
if (require.main === module) {
  importPatientsWithPaymentPlans()
    .then((_result) => {
      console.log('\n✨ Import completed!')
      process.exit(0)
    })
    .catch((error) => {
      console.error('\n💥 Import failed:', error)
      process.exit(1)
    })
}

export { importPatientsWithPaymentPlans }
