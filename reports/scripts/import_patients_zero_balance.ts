import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'csv-parse/sync'
import { db } from '../lib/db'
import { patients } from '../lib/db/schema'

async function importPatients() {
  const csvFilePath = path.join(process.cwd(), 'patients_zero_balance.csv')
  const fileContent = fs.readFileSync(csvFilePath, 'utf-8')

  const records: Array<Record<string, string>> = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  })

  console.log(`Found ${records.length} records to process.`)

  // Get the last patient ID to continue numbering
  const lastPatient = await db.query.patients.findFirst({
    orderBy: (patients, { desc }) => [desc(patients.createdAt)],
  })

  let nextId = 1
  if (lastPatient?.patientId) {
    const lastIdMatch = lastPatient.patientId.match(/FDM(\d+)/)
    if (lastIdMatch) {
      nextId = parseInt(lastIdMatch[1], 10) + 1
    }
  }

  let successCount = 0
  let errorCount = 0

  for (const row of records) {
    try {
      const {
        'Full Name': fullName,
        Age: ageStr,
        Gender: genderStr,
        Residence: residence,
        Phone: phone,
        Occupation: occupation,
        'Date Joined': dateJoinedStr,
        Nationality: nationality,
      } = row

      const name = fullName || `${row['First Name']} ${row.Surname}`
      if (!name) {
        console.warn(`Skipping row with no name: ${JSON.stringify(row)}`)
        continue
      }

      // Calculate approximate DOB
      const age = parseInt(ageStr, 10) || 0
      const now = new Date()
      // Create a date for Jan 1st of the birth year
      const birthYear = now.getFullYear() - age
      const dob = new Date(Date.UTC(birthYear, 0, 1))

      const isChild = age < 18

      // Parse Gender
      let gender = genderStr?.toLowerCase()
      if (gender !== 'male' && gender !== 'female') {
        gender = 'other' // Default fallback or maybe log warning
      }

      // Parse Date Joined
      const createdAt = new Date(dateJoinedStr)
      if (Number.isNaN(createdAt.getTime())) {
        console.warn(`Invalid Date Joined for ${name}: ${dateJoinedStr}. Using current date.`)
      }

      const patientId = `#FDM${nextId.toString().padStart(6, '0')}`
      nextId++

      const patientData: typeof patients.$inferInsert = {
        name: name,
        patientId: patientId,
        dob: dob,
        gender: gender,
        isChild: isChild,
        isOrtho: false, // Defaulting as not specified
        type: 'general',
        nationality: nationality || 'Ghana',
        // Address mapping
        address: isChild ? undefined : residence,
        guardianAddress: isChild ? residence : undefined,
        // Phone mapping
        phone: isChild ? undefined : phone,
        guardianPhone: isChild ? phone : undefined,
        // Occupation mapping
        occupation: isChild ? undefined : occupation,
        guardianOccupation: isChild ? occupation : undefined, // Assuming occupation in CSV for child might be guardian's or child's (usually child has 'Student')
        // Using Date Joined as createdAt
        createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
        updatedAt: new Date(),
      }

      // If child and occupation is 'Student', maybe guardianOccupation shouldn't be 'Student'?
      // User said "put the phone number in the guardian phone number field".
      // Did not explicitly say what to do with occupation if child, but schema requires 'guardianOccupation' if available?
      // Actually schema doesn't Strictly enforce it in DB layer (notNull is mainly for Typescript inferInsert if not set default),
      // but let's check schema.ts -> guardianOccupation: text('guardianOccupation') is nullable.
      // So we are safe.

      await db.insert(patients).values(patientData)
      successCount++
      if (successCount % 50 === 0) {
        console.log(`Processed ${successCount} patients...`)
      }
    } catch (err) {
      console.error(`Error processing row for ${row['Full Name']}:`, err)
      errorCount++
    }
  }

  console.log(`Finished. Success: ${successCount}, Failed: ${errorCount}`)
  process.exit(0)
}

importPatients().catch(console.error)
