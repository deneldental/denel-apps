import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'csv-parse/sync'
import { db } from '../lib/db'
import { doctors, medicalRecords, patients, payments, user } from '../lib/db/schema'

interface CSVFinancialRecord {
  Date: string
  'Patient ID': string
  'Patient Name': string
  Treatment: string
  Charge: string
  Discount: string
  Paid: string
  Balance: string
}

async function repopulateFinancialRecords() {
  console.log('🚀 Starting optimized financial records population (Batch Mode)...')

  const monthlyDataDir = path.join(process.cwd(), 'monthly_data')
  if (!fs.existsSync(monthlyDataDir)) {
    console.error('❌ monthly_data directory not found!')
    process.exit(1)
  }

  const files = fs.readdirSync(monthlyDataDir).filter((f) => f.endsWith('.csv'))
  console.log(`Found ${files.length} CSV files to process.`)

  // 1. Get default doctor and user
  let defaultDoctor = await db.query.doctors.findFirst()
  const defaultUser = await db.query.user.findFirst() // Admin user

  if (!defaultDoctor) {
    console.log('⚠️  No doctors found. Creating a default "System Doctor"...')
    let doctorUser = defaultUser
    if (!doctorUser) {
      const [newUser] = await db
        .insert(user)
        .values({
          id: crypto.randomUUID(),
          name: 'System Import',
          email: 'import@system.local',
          emailVerified: true,
          role: 'admin',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning()
      doctorUser = newUser
    }

    const [newDoctor] = await db
      .insert(doctors)
      .values({
        userId: doctorUser?.id,
        specialty: 'General',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()
    defaultDoctor = newDoctor
  }

  if (!defaultDoctor) throw new Error('Failed to valid doctor for import.')
  const doctorId = defaultDoctor.id
  const userId = defaultUser?.id

  // 2. Load all patients into memory map
  console.log('📥 Loading patients into memory...')
  const allPatients = await db.query.patients.findMany({
    columns: { id: true, patientId: true, name: true },
  })

  // Maps for fast lookup
  const patientMapById = new Map<string, string>() // key: patientId text, val: uuid
  const patientMapByName = new Map<string, string>() // key: name, val: uuid

  for (const p of allPatients) {
    if (p.patientId) patientMapById.set(p.patientId.toUpperCase(), p.id)
    if (p.name) patientMapByName.set(p.name.trim().toLowerCase(), p.id)
  }
  console.log(`✅ Loaded ${allPatients.length} patients.`)

  // 3. Process CSVs in memory
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const medicalRecordsPayload: any[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paymentsPayload: any[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newPatientsPayload: any[] = []
  const newPatientNamesSet = new Set<string>()

  console.log('📂 Processing CSV files...')

  for (const file of files) {
    const filePath = path.join(monthlyDataDir, file)
    const fileContent = fs.readFileSync(filePath, 'utf-8')
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as CSVFinancialRecord[]

    for (const row of records) {
      const {
        Date: dateStr,
        'Patient ID': patientIdRef,
        'Patient Name': patientName,
        Treatment: treatment,
        Charge: chargeStr,
        Discount: discountStr,
        Paid: paidStr,
      } = row

      const date = new Date(dateStr)
      if (Number.isNaN(date.getTime())) continue

      // Resolve Patient ID
      let pUuid = patientMapById.get((patientIdRef || '').toUpperCase())
      if (!pUuid && patientName) {
        pUuid = patientMapByName.get(patientName.trim().toLowerCase())
      }

      // If still missing, we need to create it later?
      // For batch insert speed, we can't create one-by-one and get ID easily unless we pre-generate UUIDs.
      if (!pUuid && patientName) {
        // Check if already queued for creation
        const normName = patientName.trim()
        if (!newPatientNamesSet.has(normName.toLowerCase())) {
          // Generate UUID now
          const newId = crypto.randomUUID()
          newPatientsPayload.push({
            id: newId,
            name: normName,
            patientId: patientIdRef || undefined,
            dob: new Date('2000-01-01'), // Default
            gender: 'other',
            createdAt: date,
            updatedAt: date,
          })
          newPatientNamesSet.add(normName.toLowerCase())
          // Add to map so subsequent rows find it
          patientMapByName.set(normName.toLowerCase(), newId)
          if (patientIdRef) patientMapById.set(patientIdRef.toUpperCase(), newId)
          pUuid = newId
        } else {
          // It's in newPatientsPayload, find it (slow linear scan? or check map)
          pUuid = patientMapByName.get(normName.toLowerCase())
        }
      }

      if (pUuid) {
        // Medical Record
        if (treatment) {
          medicalRecordsPayload.push({
            patientId: pUuid,
            doctorId: doctorId,
            createdById: userId,
            date: date,
            treatment: treatment,
            notes: `Imported from ${file}. Charge: ${chargeStr}, Discount: ${discountStr}`,
            createdAt: date,
            updatedAt: date,
          })
        }

        // Payment
        const paidAmount = parseFloat(paidStr.replace(/,/g, '')) || 0
        if (paidAmount > 0) {
          paymentsPayload.push({
            patientId: pUuid,
            amount: Math.round(paidAmount * 100),
            method: 'cash',
            status: 'completed',
            description: `Payment for ${treatment}`,
            createdAt: date,
          })
        }
      }
    }
  }

  // 4. Batch Insert New Patients
  if (newPatientsPayload.length > 0) {
    console.log(`🆕 Creating ${newPatientsPayload.length} missing patients...`)
    // Insert in chunks of 1000
    for (let i = 0; i < newPatientsPayload.length; i += 1000) {
      await db
        .insert(patients)
        .values(newPatientsPayload.slice(i, i + 1000))
        .onConflictDoNothing()
      // onConflictDoNothing to be safe
    }
  }

  // 5. Batch Insert Medical Records
  if (medicalRecordsPayload.length > 0) {
    console.log(`📝 Inserting ${medicalRecordsPayload.length} medical records...`)
    for (let i = 0; i < medicalRecordsPayload.length; i += 1000) {
      await db.insert(medicalRecords).values(medicalRecordsPayload.slice(i, i + 1000))
    }
  }

  // 6. Batch Insert Payments
  if (paymentsPayload.length > 0) {
    console.log(`💰 Inserting ${paymentsPayload.length} payments...`)
    for (let i = 0; i < paymentsPayload.length; i += 1000) {
      await db.insert(payments).values(paymentsPayload.slice(i, i + 1000))
    }
  }

  console.log('✨ Financial records population complete!')
  process.exit(0)
}

repopulateFinancialRecords().catch((e) => {
  console.error(e)
  process.exit(1)
})
