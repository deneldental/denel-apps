import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'csv-parse/sync'
import { db } from '@/lib/db'
import { patients } from '@/lib/db/schema'

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

async function importZeroBalancePatients() {
  console.log('🚀 Starting import of zero-balance patients...\n')

  // Read CSV file
  const csvPath = path.join(process.cwd(), 'patients_zero_balance.csv')
  const fileContent = fs.readFileSync(csvPath, 'utf-8')

  // Parse CSV
  const records: CSVPatient[] = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  })

  console.log(`📊 Found ${records.length} patients in CSV\n`)

  let imported = 0
  let skipped = 0
  const errors: Array<{ name: string; error: string }> = []

  // Process in batches of 100
  const batchSize = 100
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize)
    const patientsToInsert = []

    for (const record of batch) {
      try {
        const age = parseInt(record.Age, 10)
        const isChild = age < 18

        // Parse date - handle format "Mon Dec 05, 2022"
        const dateJoined = new Date(record['Date Joined'])
        if (Number.isNaN(dateJoined.getTime())) {
          throw new Error(`Invalid date: ${record['Date Joined']}`)
        }

        // Calculate DOB from age (approximate)
        const dob = new Date()
        dob.setFullYear(dob.getFullYear() - age)

        const patientData = {
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
        }

        patientsToInsert.push(patientData)
      } catch (error) {
        skipped++
        errors.push({
          name: record['Full Name'],
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    // Batch insert
    if (patientsToInsert.length > 0) {
      await db.insert(patients).values(patientsToInsert)
      imported += patientsToInsert.length
    }

    // Progress update
    if ((i + batchSize) % 500 === 0 || i + batchSize >= records.length) {
      console.log(
        `✅ Progress: ${Math.min(i + batchSize, records.length)}/${records.length} processed`
      )
    }
  }

  // Summary
  console.log('\n📋 Import Summary:')
  console.log(`✅ Successfully imported: ${imported} patients`)
  console.log(`⚠️  Skipped: ${skipped} patients`)

  if (errors.length > 0) {
    console.log('\n❌ Errors:')
    errors.slice(0, 10).forEach((err) => {
      console.log(`  - ${err.name}: ${err.error}`)
    })
    if (errors.length > 10) {
      console.log(`  ... and ${errors.length - 10} more errors`)
    }
  }

  return { imported, skipped, errors }
}

// Run if called directly
if (require.main === module) {
  importZeroBalancePatients()
    .then((_result) => {
      console.log('\n✨ Import completed!')
      process.exit(0)
    })
    .catch((error) => {
      console.error('\n💥 Import failed:', error)
      process.exit(1)
    })
}

export { importZeroBalancePatients }
