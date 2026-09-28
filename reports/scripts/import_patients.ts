import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'csv-parse/sync'
import { db } from '../lib/db'
import { appointments, medicalRecords, patients, paymentPlans, payments } from '../lib/db/schema'

interface CSVPatient {
  id: string
  name: string
  email?: string
  phone?: string
  dob: string
  gender?: string
  address?: string
  occupation?: string
  profileImage?: string
  insuranceProvider?: string
  insurancePolicyNumber?: string
  emergencyContactName?: string
  emergencyContactPhone?: string
  guardianName?: string
  guardianPhone?: string
  guardianEmail?: string
  guardianAddress?: string
  guardianOccupation?: string
  isChild: string
  isOrtho: string
  type?: string
  nationality?: string
  patientId: string
  createdAt?: string
  updatedAt?: string
}

async function importPatients() {
  console.log('🚀 Starting Patient Import (Reset Mode)...')

  // 1. Cleanup
  console.log('🗑️  Cleaning up existing data...')
  try {
    // Delete dependent tables first
    console.log('Deleting medicalRecords...')
    await db
      .delete(medicalRecords)
      .catch((e) => console.error('Failed to delete medicalRecords:', e.message))

    console.log('Deleting payments...')
    await db.delete(payments).catch((e) => console.error('Failed to delete payments:', e.message))

    console.log('Deleting paymentPlans...')
    await db
      .delete(paymentPlans)
      .catch((e) => console.error('Failed to delete paymentPlans:', e.message))

    console.log('Deleting appointments...')
    await db
      .delete(appointments)
      .catch((e) => console.error('Failed to delete appointments:', e.message))

    // await db.delete(waitingList) // Not found in schema

    console.log('Deleting patients...')
    await db.delete(patients).catch((e) => console.error('Failed to delete patients:', e.message))

    console.log('✅ Database cleanup attempts finished.')
  } catch (error) {
    console.error('❌ Error cleaning database:', error)
    process.exit(1)
  }

  // 2. Read CSV
  const csvPath = path.join(process.cwd(), 'monthly_data', 'patients.csv')
  if (!fs.existsSync(csvPath)) {
    console.error('❌ patients.csv not found!')
    process.exit(1)
  }

  const fileContent = fs.readFileSync(csvPath, 'utf-8')
  const records = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CSVPatient[]

  console.log(`📊 Found ${records.length} patients to import.`)

  let imported = 0

  // Process in chunks or one by one? One by one for safety/logging.
  for (const record of records) {
    try {
      // Validate UUID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      if (!record.id || !uuidRegex.test(record.id)) {
        console.warn(`⚠️  Skipping invalid UUID: ${record.id} (${record.name})`)
        continue
      }

      // Map CSV fields to Schema
      // CSV: id,name,email,phone,dob,gender,address,...
      // Schema: id, name, email, phone, dob, gender, address, ...

      // Handle Dates
      // CSV dob: "2006-01-22 04:35:21.064"
      // CSV dob: "2006-01-22 04:35:21.064"
      const dob = record.dob ? new Date(record.dob) : new Date('1970-01-01')
      const createdAt = record.createdAt ? new Date(record.createdAt) : new Date()
      const updatedAt = record.updatedAt ? new Date(record.updatedAt) : new Date()

      await db
        .insert(patients)
        .values({
          id: record.id as string,
          name: record.name,
          email: record.email || null,
          phone: record.phone || null,
          dob: dob,
          gender: record.gender || 'other',
          address: record.address || null,
          occupation: record.occupation || null,
          profileImage: record.profileImage || null,

          // Insurance
          insuranceProvider: record.insuranceProvider || null,
          insurancePolicyNumber: record.insurancePolicyNumber || null,

          // Emergency Contact
          emergencyContactName: record.emergencyContactName || null,
          emergencyContactPhone: record.emergencyContactPhone || null,

          // Guardian
          guardianName: record.guardianName || null,
          guardianPhone: record.guardianPhone || null,
          guardianEmail: record.guardianEmail || null,
          guardianAddress: record.guardianAddress || null,
          guardianOccupation: record.guardianOccupation || null,

          // Status flags
          isChild: record.isChild === 'true',
          isOrtho: record.isOrtho === 'true',
          type: record.type || 'general',
          nationality: record.nationality || 'Ghana',

          patientId: record.patientId, // FMD#...
          createdAt: createdAt,
          updatedAt: updatedAt,
        })
        .onConflictDoUpdate({
          target: patients.patientId,
          set: {
            name: record.name,
            email: record.email || null,
            phone: record.phone || null,
            dob: dob,
            gender: record.gender || 'other',
            address: record.address || null,
            occupation: record.occupation || null,
            profileImage: record.profileImage || null,
            updatedAt: new Date(),
          },
        })

      imported++
      if (imported % 50 === 0) process.stdout.write('.')
    } catch (error) {
      console.error(`\n❌ Error importing patient ${record.name} (${record.id}):`, error)
    }
  }

  console.log(`\n✨ Successfully imported ${imported} patients.`)
  process.exit(0)
}

importPatients().catch(console.error)
