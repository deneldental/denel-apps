import * as dotenv from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import * as schema from '../db/schema'

dotenv.config({ path: '.dev.vars' })

if (process.env.NODE_ENV === 'production') {
  console.error('✖ Refusing to run in production.')
  process.exit(1)
}

if (!process.env.DATABASE_URL) {
  console.error('✖ Missing DATABASE_URL in .dev.vars')
  process.exit(1)
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const db = drizzle(pool, { schema })

async function seedDoctorDashboard() {
  console.log('Seeding doctor dashboard data...')

  // 1. Find a doctor
  const allDoctors = await db.select().from(schema.doctors).limit(1)
  if (allDoctors.length === 0) {
    console.error('No doctors found in the database. Run test logins seed first.')
    process.exit(1)
  }
  const doctor = allDoctors[0]
  console.log(`Using doctor: ${doctor.id}`)

  const now = new Date()

  // 2. Create some patients for today
  console.log('Creating patients...')
  const createdPatients = await db
    .insert(schema.patients)
    .values([
      {
        name: 'Alice Smith',
        email: 'alice@test.com',
        phone: '0200000001',
        dob: new Date('1990-01-01'),
        gender: 'female',
        category: 'ongoing',
        createdAt: now,
        updatedAt: now,
      },
      {
        name: 'Bob Jones',
        email: 'bob@test.com',
        phone: '0200000002',
        dob: new Date('1985-05-12'),
        gender: 'male',
        category: 'ongoing',
        createdAt: now,
        updatedAt: now,
      },
      {
        name: 'Charlie Brown',
        email: 'charlie@test.com',
        phone: '0200000003',
        dob: new Date('2000-11-23'),
        gender: 'male',
        category: 'ongoing',
        createdAt: now,
        updatedAt: now,
      },
      {
        name: 'Diana Prince',
        email: 'diana@test.com',
        phone: '0200000004',
        dob: new Date('1995-07-08'),
        gender: 'female',
        category: 'ongoing',
        createdAt: now,
        updatedAt: now,
      },
    ])
    .returning()

  // 3. Create ortho consent forms for those patients (some signed)
  console.log('Creating ortho consent forms...')
  await db.insert(schema.orthoConsentForms).values([
    { patientId: createdPatients[0].id, status: 'signed', createdAt: now, updatedAt: now },
    { patientId: createdPatients[1].id, status: 'signed', createdAt: now, updatedAt: now },
    { patientId: createdPatients[2].id, status: 'unsigned', createdAt: now, updatedAt: now },
  ])

  // 4. Create pending medical records
  console.log('Creating pending medical records...')
  await db.insert(schema.pendingMedicalRecords).values([
    {
      patientId: createdPatients[0].id,
      doctorId: doctor.id,
      status: 'pending',
      checkedInAt: now,
      createdAt: now,
    },
    {
      patientId: createdPatients[1].id,
      doctorId: doctor.id,
      status: 'pending',
      checkedInAt: now,
      createdAt: now,
    },
    {
      patientId: createdPatients[2].id,
      doctorId: doctor.id,
      status: 'completed',
      checkedInAt: now,
      createdAt: now,
      completedAt: now,
    },
  ])

  // 5. Create appointments for today
  console.log('Creating appointments...')
  await db.insert(schema.appointments).values([
    {
      patientId: createdPatients[0].id,
      doctorId: doctor.id,
      date: now,
      durationMinutes: 30,
      status: 'scheduled',
      type: 'consultation',
      createdAt: now,
      updatedAt: now,
    },
    {
      patientId: createdPatients[1].id,
      doctorId: doctor.id,
      date: now,
      durationMinutes: 30,
      status: 'completed',
      type: 'checkup',
      createdAt: now,
      updatedAt: now,
    },
    {
      patientId: createdPatients[2].id,
      doctorId: doctor.id,
      date: now,
      durationMinutes: 60,
      status: 'checked_in',
      type: 'procedure',
      createdAt: now,
      updatedAt: now,
    },
    {
      patientId: createdPatients[3].id,
      doctorId: doctor.id,
      date: now,
      durationMinutes: 30,
      status: 'scheduled',
      type: 'follow-up',
      createdAt: now,
      updatedAt: now,
    },
  ])

  console.log('Successfully seeded doctor dashboard data!')
  process.exit(0)
}

seedDoctorDashboard().catch((err) => {
  console.error('Error seeding data:', err)
  process.exit(1)
})
