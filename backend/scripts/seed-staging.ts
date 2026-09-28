/**
 * seed-staging.ts
 *
 * CLEARS all clinic data from the staging database and seeds it with
 * realistic dummy data.
 *
 * PRESERVES: user, session, account, verification (auth tables)
 *            roles, permissions, role_permissions, permission_bundles,
 *            bundle_permissions, role_bundles, role_scopes, user_scopes (RBAC)
 *
 * Run: npx tsx backend/scripts/seed-staging.ts
 */

import { eq, sql } from 'drizzle-orm'
import { getDb } from '../src/db'
import * as schema from '../src/db/schema'

// ── Target database ──────────────────────────────────────────────────────────
// Read from env so we never commit credentials. Run with:
//   doppler run --config stg -- pnpm tsx backend/scripts/seed-staging.ts
const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('✖  DATABASE_URL env var is not set.')
  console.error('   Run via: doppler run --config stg -- pnpm tsx backend/scripts/seed-staging.ts')
  process.exit(1)
}

const db = getDb(DATABASE_URL)

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function daysFromNow(n: number) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d
}

function dob(yearsAgo: number) {
  const d = new Date()
  d.setFullYear(d.getFullYear() - yearsAgo)
  return d
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function rand(min: number, max: number) {
  return Math.round(Math.random() * (max - min) + min)
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('━━━ Framada Staging Seed ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('Target:', DATABASE_URL.split('@')[1]?.split('/')[0])
  console.log('')

  // ── Step 0: Capture existing admin user + doctors ────────────────────────
  console.log('→ Capturing existing staff users…')
  const existingUsers = await db.query.user.findMany()
  const adminUser =
    existingUsers.find((u) => u.roleId === 'admin' || u.role === 'admin') ?? existingUsers[0]

  if (!adminUser) {
    console.error('✖  No users found. Cannot seed without at least one admin user.')
    console.error('   Create an admin account via the portal first, then run this script.')
    process.exit(1)
  }

  console.log(`   Admin user: ${adminUser.name} <${adminUser.email}>`)

  // Find users we can use as doctor profiles
  const doctorUsers = existingUsers.filter((u) => u.roleId === 'doctor' || u.role === 'doctor')
  console.log(`   Doctor users found: ${doctorUsers.length}`)

  // ── Step 1: Truncate all clinic tables (CASCADE) ─────────────────────────
  console.log('')
  console.log('→ Truncating clinic tables…')

  // Truncate each table individually — skip gracefully if a table doesn't exist yet
  // (handles staging DBs where some migrations haven't been applied)
  // Order matters only for tables without CASCADE dependencies. Postgres
  // TRUNCATE ... CASCADE handles the rest, and the DO-block below skips
  // tables that don't exist yet (graceful fallback for early-stage staging).
  const tablesToTruncate = [
    // Child-first for safety even though we CASCADE
    'patient_timeline',
    'wallet_transactions',
    'patient_wallets',
    'xray_share_access_log',
    'xray_share_links',
    'xray_records',
    'xray_types',
    'lab_case_photos',
    'lab_cases',
    'lab_services',
    'lab_vendors',
    'insurance_reconciliation_entries',
    'insurance_pricing_documents',
    'insurance_companies',
    'signed_consent_forms',
    'consent_form_templates',
    'patient_perio_entries',
    'patient_odontogram',
    'patient_documents',
    'patient_photos',
    'treatment_plan_items',
    'treatment_plans',
    'recalls',
    'patient_reminders',
    'tax_calculations',
    'invoices',
    'payments',
    'payment_plans',
    'payment_plan_templates',
    'pending_medical_records',
    'medical_records',
    'appointments',
    'doctor_unavailability',
    'doctors',
    'patients',
    'staff_otp_codes',
    'staff_credentials',
    'staff_questionnaire_responses',
    'staff_questionnaire_questions',
    'staff_questionnaires',
    'staff_training_progress',
    'training_materials',
    'staff_memos',
    'document_access_logs',
    'staff_documents',
    'staff_requests',
    'performance_scores',
    'staff',
    'expenses',
    'sales',
    'daily_reports',
    'inventory',
    'suppliers',
    'products',
    'messages',
    'website_bookings',
    'scheduled_reminders',
    'sms_messages',
    'email_messages',
    'audit_logs',
    'ortho_consent_forms',
    'sync_log',
    'patient_sessions',
    'compliance_documents',
    'clinic_settings',
    'units',
    'categories',
    'appointment_types',
    'treatment_types',
    'expense_categories',
    'payment_methods',
  ]

  await db.execute(
    sql.raw(`
    DO $$
    DECLARE
      t text;
      tables text[] := ARRAY[${tablesToTruncate.map((t) => `'${t}'`).join(', ')}];
    BEGIN
      FOREACH t IN ARRAY tables LOOP
        BEGIN
          EXECUTE 'TRUNCATE TABLE ' || quote_ident(t) || ' CASCADE';
        EXCEPTION WHEN undefined_table THEN
          RAISE NOTICE 'Skipping % (table does not exist)', t;
        END;
      END LOOP;
    END $$;
  `)
  )
  console.log('   ✓ All clinic tables cleared')

  // ── Step 1b: Apply any missing schema additions ───────────────────────────
  console.log('')
  console.log('→ Applying missing schema columns/tables…')

  // Add missing columns to staff table (added in later migrations)
  await db.execute(sql`
    ALTER TABLE staff
      ADD COLUMN IF NOT EXISTS "staffId" text NOT NULL DEFAULT 'FDM-LEGACY',
      ADD COLUMN IF NOT EXISTS "userId" text REFERENCES "user"("id") ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS "username" text,
      ADD COLUMN IF NOT EXISTS "email" text,
      ADD COLUMN IF NOT EXISTS "phone" text,
      ADD COLUMN IF NOT EXISTS "position" text,
      ADD COLUMN IF NOT EXISTS "dateOfJoining" timestamp,
      ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS "isExternalTrainer" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "profileImage" text,
      ADD COLUMN IF NOT EXISTS "emergencyContactName" text,
      ADD COLUMN IF NOT EXISTS "emergencyContactPhone" text
  `)

  // Create compliance_documents if it doesn't exist
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "compliance_documents" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "documentName" text NOT NULL,
      "category" text NOT NULL,
      "documentUrl" text,
      "dateIssued" timestamp,
      "dateExpired" timestamp,
      "reminderEnabled" boolean NOT NULL DEFAULT false,
      "reminderMonthsBefore" integer DEFAULT 3,
      "reminderPhones" jsonb DEFAULT '[]',
      "reminderMessage" text,
      "createdById" text REFERENCES "user"("id") ON DELETE SET NULL,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )
  `)

  // Create staff_otp_codes if it doesn't exist
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "staff_otp_codes" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "staffId" uuid NOT NULL REFERENCES "staff"("id") ON DELETE CASCADE,
      "code" text NOT NULL,
      "phone" text NOT NULL,
      "purpose" text NOT NULL DEFAULT 'password_reset',
      "expiresAt" timestamp NOT NULL,
      "usedAt" timestamp,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )
  `)

  // Add missing patient columns (added in later migrations)
  await db.execute(sql`
    ALTER TABLE patients
      ADD COLUMN IF NOT EXISTS "pwaAccessEnabled" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "pwaPasswordHash" text,
      ADD COLUMN IF NOT EXISTS "pwaAccessGrantedAt" timestamp,
      ADD COLUMN IF NOT EXISTS "pwaAccessGrantedById" text REFERENCES "user"("id") ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS "howDidYouHear" text,
      ADD COLUMN IF NOT EXISTS "howDidYouHearOther" text,
      ADD COLUMN IF NOT EXISTS "nationality" text DEFAULT 'Ghanaian',
      ADD COLUMN IF NOT EXISTS "category" text NOT NULL DEFAULT 'ongoing',
      ADD COLUMN IF NOT EXISTS "insurancePolicyNumber" text,
      ADD COLUMN IF NOT EXISTS "guardianOccupation" text
  `)

  console.log('   ✓ Schema additions applied')

  // ── Step 2: Lookup tables ─────────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding lookup tables…')

  await db.insert(schema.paymentMethods).values([
    { name: 'cash', displayName: 'Cash' },
    { name: 'card', displayName: 'Card / POS' },
    { name: 'momo', displayName: 'Mobile Money' },
    { name: 'bank_transfer', displayName: 'Bank Transfer' },
    { name: 'insurance', displayName: 'Insurance' },
  ])

  await db.insert(schema.treatmentTypes).values([
    { name: 'consultation', displayName: 'Consultation' },
    { name: 'checkup', displayName: 'Routine Checkup' },
    { name: 'extraction', displayName: 'Tooth Extraction' },
    { name: 'filling', displayName: 'Dental Filling' },
    { name: 'scaling', displayName: 'Scaling & Polishing' },
    { name: 'orthodontics', displayName: 'Orthodontic Treatment' },
    { name: 'surgery', displayName: 'Oral Surgery' },
    { name: 'whitening', displayName: 'Teeth Whitening' },
    { name: 'root_canal', displayName: 'Root Canal Treatment' },
    { name: 'crown', displayName: 'Dental Crown' },
  ])

  await db.insert(schema.expenseCategories).values([
    { name: 'rent', displayName: 'Rent & Facility' },
    { name: 'supplies', displayName: 'Clinical Supplies' },
    { name: 'utilities', displayName: 'Utilities' },
    { name: 'payroll', displayName: 'Staff Payroll' },
    { name: 'marketing', displayName: 'Marketing & Advertising' },
    { name: 'equipment', displayName: 'Equipment & Maintenance' },
    { name: 'other', displayName: 'Other' },
  ])

  await db.insert(schema.appointmentTypes).values([
    { name: 'consultation', displayName: 'Consultation' },
    { name: 'checkup', displayName: 'Routine Checkup' },
    { name: 'follow-up', displayName: 'Follow-up' },
    { name: 'procedure', displayName: 'Procedure' },
    { name: 'emergency', displayName: 'Emergency' },
  ])

  await db.insert(schema.units).values([
    { name: 'box', displayName: 'Box' },
    { name: 'pcs', displayName: 'Pieces (pcs)' },
    { name: 'pack', displayName: 'Pack' },
    { name: 'bottle', displayName: 'Bottle' },
    { name: 'tube', displayName: 'Tube' },
    { name: 'pair', displayName: 'Pair' },
    { name: 'roll', displayName: 'Roll' },
    { name: 'kg', displayName: 'Kilogram (kg)' },
  ])

  // categories table has only {id, name, isActive} — no displayName column
  await db.insert(schema.categories).values([
    { name: 'clinical' },
    { name: 'orthodontics' },
    { name: 'hygiene' },
    { name: 'radiology' },
    { name: 'retail' },
    { name: 'surgical' },
  ])

  console.log('   ✓ Lookup tables seeded')

  // ── Step 3: Staff & Doctors ───────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding staff & doctors…')

  // Create staff records for existing users
  const staffRecords = []

  // Admin user → admin staff
  const [adminStaff] = await db
    .insert(schema.staff)
    .values({
      staffId: 'FDM-S0001',
      userId: adminUser.id,
      fullName: adminUser.name,
      email: adminUser.email,
      phone: adminUser.phone ?? '0200000000',
      role: 'admin',
      position: 'Clinic Administrator',
      employmentType: 'permanent',
      status: 'active',
      dateOfJoining: daysAgo(730),
    })
    .returning()

  staffRecords.push(adminStaff)

  // Doctor users → doctor staff + doctor profiles
  const seededDoctors: (typeof schema.doctors.$inferSelect)[] = []

  if (doctorUsers.length >= 2) {
    // Use existing doctor users
    for (let i = 0; i < Math.min(2, doctorUsers.length); i++) {
      const u = doctorUsers[i]
      const [s] = await db
        .insert(schema.staff)
        .values({
          staffId: `FDM-S000${2 + i}`,
          userId: u.id,
          fullName: u.name,
          email: u.email,
          phone: u.phone ?? `020000000${i + 1}`,
          role: 'doctor',
          position: i === 0 ? 'Lead Orthodontist' : 'General Dentist',
          employmentType: 'permanent',
          status: 'active',
          dateOfJoining: daysAgo(500 - i * 120),
        })
        .returning()
      staffRecords.push(s)

      const [doc] = await db
        .insert(schema.doctors)
        .values({
          userId: u.id,
          specialty: i === 0 ? 'Orthodontics' : 'General Dentistry',
          licenseNumber: `GDA-${2020 + i}-${1000 + i}`,
          bio:
            i === 0
              ? 'Specialist in orthodontic treatment with 8 years of clinical experience.'
              : 'General dentist with a focus on restorative and preventive care.',
          contactNumber: u.phone ?? `020000000${i + 1}`,
        })
        .returning()
      seededDoctors.push(doc)
    }
  } else {
    // Fallback: create two doctor profile from admin user (for demo only)
    // In a real scenario we'd need two separate users
    console.log('   ⚠  Fewer than 2 doctor users found. Creating doctor profile from admin.')
    const [doc] = await db
      .insert(schema.doctors)
      .values({
        userId: adminUser.id,
        specialty: 'General Dentistry',
        licenseNumber: 'GDA-2020-1001',
        bio: 'Admin doctor profile for demo purposes.',
        contactNumber: adminUser.phone ?? '0200000000',
      })
      .returning()
    seededDoctors.push(doc)
  }

  // Two extra non-doctor staff members
  await db.insert(schema.staff).values([
    {
      staffId: 'FDM-S0004',
      fullName: 'Sarah Adjei',
      email: 'sarah.adjei@framada.app',
      phone: '0244567890',
      role: 'receptionist',
      position: 'Front Desk Receptionist',
      employmentType: 'permanent',
      status: 'active',
      dateOfJoining: daysAgo(400),
    },
    {
      staffId: 'FDM-S0005',
      fullName: 'Kwame Boateng',
      email: 'kwame.boateng@framada.app',
      phone: '0557891234',
      role: 'assistant',
      position: 'Dental Assistant',
      employmentType: 'contract',
      status: 'active',
      dateOfJoining: daysAgo(280),
    },
  ])

  console.log(`   ✓ ${staffRecords.length + 2} staff records created`)
  console.log(`   ✓ ${seededDoctors.length} doctor profile(s) created`)

  const doctorA = seededDoctors[0]
  const doctorB = seededDoctors[1] ?? seededDoctors[0]

  // ── Step 4: Patients (20) ─────────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding patients…')

  const patientData = [
    {
      name: 'Test Henry',
      phone: '0553424972',
      patientId: '#TEST001',
      gender: 'male',
      dob: dob(30),
      category: 'ongoing',
      isChild: false,
    },
    {
      name: 'Kofi Asante',
      phone: '0244100001',
      patientId: '#FDM0002',
      gender: 'male',
      dob: dob(35),
      category: 'ongoing',
      isChild: false,
      email: 'kofi.asante@email.com',
      occupation: 'Teacher',
      nationality: 'Ghanaian',
    },
    {
      name: 'Abena Mensah',
      phone: '0244100002',
      patientId: '#FDM0003',
      gender: 'female',
      dob: dob(28),
      category: 'ongoing',
      isChild: false,
      email: 'abena.mensah@email.com',
      occupation: 'Nurse',
      nationality: 'Ghanaian',
    },
    {
      name: 'Kwame Osei',
      phone: '0244100003',
      patientId: '#FDM0004',
      gender: 'male',
      dob: dob(42),
      category: 'ongoing',
      _ortho: true,
      isChild: false,
      email: 'kwame.osei@email.com',
      occupation: 'Engineer',
      nationality: 'Ghanaian',
    },
    {
      name: 'Adwoa Boateng',
      phone: '0244100004',
      patientId: '#FDM0005',
      gender: 'female',
      dob: dob(16),
      category: 'ongoing',
      isChild: true,
      guardianName: 'Emma Boateng',
      guardianPhone: '0244500005',
      guardianEmail: 'emma.boateng@email.com',
      guardianOccupation: 'Banker',
    },
    {
      name: 'Yaw Darko',
      phone: '0244100005',
      patientId: '#FDM0006',
      gender: 'male',
      dob: dob(55),
      category: 'one_time',
      isChild: false,
      occupation: 'Retired',
      nationality: 'Ghanaian',
    },
    {
      name: 'Akosua Amponsah',
      phone: '0244100006',
      patientId: '#FDM0007',
      gender: 'female',
      dob: dob(31),
      category: 'ongoing',
      _ortho: true,
      isChild: false,
      email: 'akosua.a@email.com',
      occupation: 'Accountant',
      nationality: 'Ghanaian',
    },
    {
      name: 'Emmanuel Owusu',
      phone: '0244100007',
      patientId: '#FDM0008',
      gender: 'male',
      dob: dob(24),
      category: 'ongoing',
      isChild: false,
      email: 'e.owusu@email.com',
      occupation: 'Student',
      nationality: 'Ghanaian',
    },
    {
      name: 'Ama Sarpong',
      phone: '0244100008',
      patientId: '#FDM0009',
      gender: 'female',
      dob: dob(45),
      category: 'ongoing',
      _ortho: true,
      isChild: false,
      email: 'ama.sarpong@email.com',
      occupation: 'Business Owner',
      nationality: 'Ghanaian',
    },
    {
      name: 'Kwabena Agyei',
      phone: '0244100009',
      patientId: '#FDM0010',
      gender: 'male',
      dob: dob(9),
      category: 'ongoing',
      isChild: true,
      guardianName: 'Joyce Agyei',
      guardianPhone: '0244500010',
      guardianOccupation: 'Trader',
    },
    {
      name: 'Nana Yaa Prempeh',
      phone: '0244100010',
      patientId: '#FDM0011',
      gender: 'female',
      dob: dob(38),
      category: 'ongoing',
      isChild: false,
      email: 'nana.yaa@email.com',
      occupation: 'Lawyer',
      nationality: 'Ghanaian',
    },
    {
      name: 'Samuel Tetteh',
      phone: '0244100011',
      patientId: '#FDM0012',
      gender: 'male',
      dob: dob(52),
      category: 'one_time',
      isChild: false,
      nationality: 'Ghanaian',
    },
    {
      name: 'Gifty Amoah',
      phone: '0244100012',
      patientId: '#FDM0013',
      gender: 'female',
      dob: dob(29),
      category: 'ongoing',
      _ortho: true,
      isChild: false,
      email: 'gifty.amoah@email.com',
      occupation: 'Pharmacist',
      nationality: 'Ghanaian',
    },
    {
      name: 'Bright Asare',
      phone: '0244100013',
      patientId: '#FDM0014',
      gender: 'male',
      dob: dob(33),
      category: 'ongoing',
      isChild: false,
      occupation: 'Driver',
      nationality: 'Ghanaian',
    },
    {
      name: 'Abigail Frimpong',
      phone: '0244100014',
      patientId: '#FDM0015',
      gender: 'female',
      dob: dob(19),
      category: 'ongoing',
      isChild: false,
      email: 'abigail.f@email.com',
      occupation: 'Student',
      nationality: 'Ghanaian',
    },
    {
      name: 'Isaac Barimah',
      phone: '0244100015',
      patientId: '#FDM0016',
      gender: 'male',
      dob: dob(61),
      category: 'one_time',
      isChild: false,
      nationality: 'Ghanaian',
    },
    {
      name: 'Efua Quansah',
      phone: '0244100016',
      patientId: '#FDM0017',
      gender: 'female',
      dob: dob(41),
      category: 'ongoing',
      _ortho: true,
      isChild: false,
      email: 'efua.q@email.com',
      occupation: 'Doctor',
      nationality: 'Ghanaian',
      emergencyContactName: 'James Quansah',
      emergencyContactPhone: '0244600017',
    },
    {
      name: 'Daniel Adjei',
      phone: '0244100017',
      patientId: '#FDM0018',
      gender: 'male',
      dob: dob(27),
      category: 'ongoing',
      isChild: false,
      occupation: 'IT Specialist',
      nationality: 'Ghanaian',
    },
    {
      name: 'Maame Serwa Appiah',
      phone: '0244100018',
      patientId: '#FDM0019',
      gender: 'female',
      dob: dob(34),
      category: 'ongoing',
      isChild: false,
      email: 'maame.s@email.com',
      occupation: 'Graphic Designer',
      nationality: 'Ghanaian',
    },
    {
      name: 'Frank Owusu Asante',
      phone: '0244100019',
      patientId: '#FDM0020',
      gender: 'male',
      dob: dob(48),
      category: 'ongoing',
      isChild: false,
      occupation: 'Contractor',
      nationality: 'Ghanaian',
      insuranceProvider: 'Star Health Insurance',
      insurancePolicyNumber: 'SHI-2024-48291',
    },
  ]

  const insertedPatients = await db
    .insert(schema.patients)
    .values(
      // §2.7 — type/isOrtho are no longer seeded as columns. `_ortho` is a
      // local marker (stripped here) used below to assign the 'Ortho' tag.
      patientData.map(({ _ortho, ...p }) => ({
        ...p,
        address: `${rand(1, 100)} ${pick(['Main St', 'Liberation Rd', 'Ring Rd', 'Independence Ave'])}, Accra`,
        createdAt: daysAgo(rand(60, 400)),
        updatedAt: new Date(),
      }))
    )
    .returning()

  // Create wallets for all patients
  await db
    .insert(schema.patientWallets)
    .values(insertedPatients.map((p) => ({ patientId: p.id, creditBalance: 0 })))

  // §2.7 — assign the 'Ortho' tag to the patients that were previously isOrtho.
  const orthoTag = await db.query.patientTags.findFirst({
    where: eq(schema.patientTags.name, 'Ortho'),
  })
  if (orthoTag) {
    const orthoLinks = insertedPatients
      .filter((_, idx) => patientData[idx]?._ortho === true)
      .map((p) => ({ patientId: p.id, tagId: orthoTag.id }))
    if (orthoLinks.length > 0) {
      await db.insert(schema.patientTagLinks).values(orthoLinks).onConflictDoNothing()
    }
  }

  console.log(`   ✓ ${insertedPatients.length} patients seeded`)

  // ── Step 5: Appointments (30) ─────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding appointments…')

  type AppStatus = 'completed' | 'scheduled' | 'cancelled' | 'no-show'
  type AppType = 'consultation' | 'checkup' | 'follow-up' | 'procedure'

  const appointmentDefs: Array<{
    patientIdx: number
    doctorId: string
    daysOffset: number
    status: AppStatus
    type: AppType
    notes?: string
    duration: number
  }> = [
    // Past completed
    {
      patientIdx: 1,
      doctorId: doctorB.id,
      daysOffset: -80,
      status: 'completed',
      type: 'consultation',
      notes: 'Initial consultation. Patient complains of tooth sensitivity.',
      duration: 30,
    },
    {
      patientIdx: 2,
      doctorId: doctorB.id,
      daysOffset: -75,
      status: 'completed',
      type: 'checkup',
      notes: 'Routine checkup. No cavities found.',
      duration: 30,
    },
    {
      patientIdx: 3,
      doctorId: doctorA.id,
      daysOffset: -70,
      status: 'completed',
      type: 'procedure',
      notes: 'Fitted upper braces. Patient briefed on care routine.',
      duration: 60,
    },
    {
      patientIdx: 4,
      doctorId: doctorB.id,
      daysOffset: -65,
      status: 'completed',
      type: 'checkup',
      notes: 'Child patient. Milk teeth examined. No issues.',
      duration: 20,
    },
    {
      patientIdx: 5,
      doctorId: doctorB.id,
      daysOffset: -60,
      status: 'completed',
      type: 'procedure',
      notes: 'Lower left molar extraction. Successful.',
      duration: 45,
    },
    {
      patientIdx: 6,
      doctorId: doctorA.id,
      daysOffset: -55,
      status: 'completed',
      type: 'procedure',
      notes: 'Orthodontic wire replacement. Minor adjustments.',
      duration: 40,
    },
    {
      patientIdx: 7,
      doctorId: doctorB.id,
      daysOffset: -50,
      status: 'completed',
      type: 'consultation',
      notes: 'Pain in wisdom tooth area. X-ray taken.',
      duration: 30,
    },
    {
      patientIdx: 8,
      doctorId: doctorA.id,
      daysOffset: -48,
      status: 'completed',
      type: 'procedure',
      notes: 'Brace bracket replacement. Routine checkup on alignment.',
      duration: 35,
    },
    {
      patientIdx: 9,
      doctorId: doctorB.id,
      daysOffset: -45,
      status: 'completed',
      type: 'checkup',
      notes: 'Routine checkup for child. Fluoride applied.',
      duration: 25,
    },
    {
      patientIdx: 10,
      doctorId: doctorB.id,
      daysOffset: -40,
      status: 'completed',
      type: 'follow-up',
      notes: 'Follow-up on previous filling. Healing well.',
      duration: 20,
    },
    {
      patientIdx: 11,
      doctorId: doctorB.id,
      daysOffset: -38,
      status: 'completed',
      type: 'procedure',
      notes: 'Scaling and polishing. Heavy tartar removed.',
      duration: 40,
    },
    {
      patientIdx: 12,
      doctorId: doctorA.id,
      daysOffset: -35,
      status: 'completed',
      type: 'procedure',
      notes: 'Initial brace fitting. Lower set.',
      duration: 60,
    },
    {
      patientIdx: 13,
      doctorId: doctorB.id,
      daysOffset: -30,
      status: 'completed',
      type: 'procedure',
      notes: 'Composite filling on upper right premolar.',
      duration: 45,
    },
    {
      patientIdx: 14,
      doctorId: doctorB.id,
      daysOffset: -28,
      status: 'completed',
      type: 'checkup',
      notes: 'Routine checkup. Light staining noted.',
      duration: 30,
    },
    {
      patientIdx: 1,
      doctorId: doctorB.id,
      daysOffset: -25,
      status: 'completed',
      type: 'follow-up',
      notes: 'Sensitivity improving. Patient advised to use sensitivity toothpaste.',
      duration: 20,
    },
    {
      patientIdx: 15,
      doctorId: doctorB.id,
      daysOffset: -22,
      status: 'completed',
      type: 'procedure',
      notes: 'Root canal therapy on upper left molar.',
      duration: 90,
    },
    {
      patientIdx: 16,
      doctorId: doctorA.id,
      daysOffset: -20,
      status: 'completed',
      type: 'procedure',
      notes: 'Orthodontic review. Slight overcrowding on right side.',
      duration: 45,
    },
    {
      patientIdx: 2,
      doctorId: doctorB.id,
      daysOffset: -18,
      status: 'completed',
      type: 'procedure',
      notes: 'Teeth whitening. 3 shades lighter achieved.',
      duration: 60,
    },
    // Cancelled / no-show
    {
      patientIdx: 17,
      doctorId: doctorB.id,
      daysOffset: -15,
      status: 'cancelled',
      type: 'checkup',
      notes: 'Patient cancelled — travel.',
      duration: 30,
    },
    {
      patientIdx: 18,
      doctorId: doctorB.id,
      daysOffset: -12,
      status: 'no-show',
      type: 'consultation',
      duration: 30,
    },
    // Upcoming scheduled
    {
      patientIdx: 3,
      doctorId: doctorA.id,
      daysOffset: 3,
      status: 'scheduled',
      type: 'procedure',
      notes: 'Monthly brace adjustment.',
      duration: 40,
    },
    {
      patientIdx: 6,
      doctorId: doctorA.id,
      daysOffset: 4,
      status: 'scheduled',
      type: 'follow-up',
      notes: 'Check alignment progress.',
      duration: 30,
    },
    {
      patientIdx: 7,
      doctorId: doctorB.id,
      daysOffset: 5,
      status: 'scheduled',
      type: 'procedure',
      notes: 'Wisdom tooth extraction — pre-assessment done.',
      duration: 60,
    },
    {
      patientIdx: 19,
      doctorId: doctorB.id,
      daysOffset: 6,
      status: 'scheduled',
      type: 'checkup',
      duration: 30,
    },
    {
      patientIdx: 10,
      doctorId: doctorB.id,
      daysOffset: 7,
      status: 'scheduled',
      type: 'follow-up',
      notes: 'Review crown preparation.',
      duration: 30,
    },
    {
      patientIdx: 8,
      doctorId: doctorA.id,
      daysOffset: 8,
      status: 'scheduled',
      type: 'procedure',
      notes: 'Upper brace monthly review.',
      duration: 35,
    },
    {
      patientIdx: 12,
      doctorId: doctorA.id,
      daysOffset: 10,
      status: 'scheduled',
      type: 'procedure',
      notes: 'Lower brace monthly review.',
      duration: 35,
    },
    {
      patientIdx: 13,
      doctorId: doctorB.id,
      daysOffset: 12,
      status: 'scheduled',
      type: 'checkup',
      notes: 'Check filling integrity.',
      duration: 20,
    },
    {
      patientIdx: 0,
      doctorId: doctorB.id,
      daysOffset: 14,
      status: 'scheduled',
      type: 'consultation',
      notes: 'Test patient appointment.',
      duration: 30,
    },
    {
      patientIdx: 4,
      doctorId: doctorB.id,
      daysOffset: 15,
      status: 'scheduled',
      type: 'checkup',
      notes: 'Child routine checkup.',
      duration: 20,
    },
  ]

  const apptHours = [8, 9, 10, 11, 14, 15, 16]

  const insertedAppointments = []
  for (const def of appointmentDefs) {
    const patient = insertedPatients[def.patientIdx]
    if (!patient) continue

    const apptDate = new Date()
    apptDate.setDate(apptDate.getDate() + def.daysOffset)
    apptDate.setHours(pick(apptHours), 0, 0, 0)

    const [appt] = await db
      .insert(schema.appointments)
      .values({
        patientId: patient.id,
        doctorId: def.doctorId,
        date: apptDate,
        durationMinutes: def.duration,
        status: def.status,
        type: def.type,
        notes: def.notes ?? null,
        createdAt: new Date(apptDate.getTime() - 7 * 24 * 60 * 60 * 1000),
        updatedAt: new Date(),
      })
      .returning()

    insertedAppointments.push({ ...appt, patientIdx: def.patientIdx })
  }

  console.log(`   ✓ ${insertedAppointments.length} appointments seeded`)

  // ── Step 6: Medical Records (for completed appointments) ──────────────────
  console.log('')
  console.log('→ Seeding medical records…')

  const completedAppts = insertedAppointments.filter((a) => a.status === 'completed')

  const diagnoses = [
    'Dental caries — upper right molar',
    'Gingivitis',
    'Tooth sensitivity — cervical erosion',
    'Malocclusion — class II',
    'Periapical abscess',
    'Dental plaque build-up',
    'Enamel hypoplasia',
    'Bruxism',
    'Impacted wisdom tooth',
    'Chronic periodontitis',
  ]
  const prescriptions = [
    'Amoxicillin 500mg TDS × 5 days',
    'Ibuprofen 400mg PRN',
    'Chlorhexidine mouthwash BD × 2 weeks',
    'Paracetamol 1g TDS × 3 days',
    'Metronidazole 400mg TDS × 7 days',
    'No medication required',
    'Sensitive toothpaste — daily use',
  ]

  for (const appt of completedAppts) {
    await db.insert(schema.medicalRecords).values({
      patientId: appt.patientId,
      doctorId: appt.doctorId,
      createdById: adminUser.id,
      date: appt.date,
      complaint: 'Patient-reported discomfort or routine visit.',
      examination: 'Full intra-oral examination performed.',
      diagnosis: pick(diagnoses),
      treatment:
        appt.type === 'procedure' ? 'Procedure performed as planned.' : 'Reviewed and advised.',
      prescription: pick(prescriptions),
      notes: appt.notes ?? null,
      createdAt: appt.date,
      updatedAt: appt.date,
    })
  }

  console.log(`   ✓ ${completedAppts.length} medical records seeded`)

  // ── Step 7: Payment Plans + Invoices + Payments ───────────────────────────
  console.log('')
  console.log('→ Seeding payment plans, invoices & payments…')

  // Payment plan templates
  const [tmpl1] = await db
    .insert(schema.paymentPlanTemplates)
    .values({
      name: 'Standard Ortho Plan',
      totalAmount: 8500,
      amountPerInstallment: 850,
      paymentFrequency: 'monthly',
      isDefault: true,
      isActive: true,
      description: 'Standard 10-month orthodontic treatment plan.',
    })
    .returning()

  const [tmpl2] = await db
    .insert(schema.paymentPlanTemplates)
    .values({
      name: 'Flexible Treatment Plan',
      totalAmount: 3500,
      amountPerInstallment: 700,
      paymentFrequency: 'monthly',
      isDefault: false,
      isActive: true,
      description: '5-month flexible payment for restorative work.',
    })
    .returning()

  // Define plans: ortho patients + one restorative
  type PlanStatus = 'activated' | 'completed' | 'paused' | 'overdue'
  const planDefs: Array<{
    patientIdx: number
    templateId: string
    total: number
    installment: number
    installments: number
    frequency: string
    status: PlanStatus
    paidInstallments: number
    type: 'fixed' | 'flexible'
  }> = [
    {
      patientIdx: 3,
      templateId: tmpl1.id,
      total: 8500,
      installment: 850,
      installments: 10,
      frequency: 'monthly',
      status: 'activated',
      paidInstallments: 4,
      type: 'fixed',
    },
    {
      patientIdx: 6,
      templateId: tmpl1.id,
      total: 7800,
      installment: 780,
      installments: 10,
      frequency: 'monthly',
      status: 'activated',
      paidInstallments: 6,
      type: 'fixed',
    },
    {
      patientIdx: 8,
      templateId: tmpl1.id,
      total: 9200,
      installment: 920,
      installments: 10,
      frequency: 'monthly',
      status: 'paused',
      paidInstallments: 2,
      type: 'fixed',
    },
    {
      patientIdx: 12,
      templateId: tmpl1.id,
      total: 8500,
      installment: 850,
      installments: 10,
      frequency: 'monthly',
      status: 'activated',
      paidInstallments: 1,
      type: 'fixed',
    },
    {
      patientIdx: 16,
      templateId: tmpl1.id,
      total: 9000,
      installment: 900,
      installments: 10,
      frequency: 'monthly',
      status: 'overdue',
      paidInstallments: 3,
      type: 'fixed',
    },
    {
      patientIdx: 15,
      templateId: tmpl2.id,
      total: 3500,
      installment: 700,
      installments: 5,
      frequency: 'monthly',
      status: 'activated',
      paidInstallments: 1,
      type: 'fixed',
    },
  ]

  const paymentMethods = ['cash', 'momo', 'card', 'bank_transfer']
  let invoiceCounter = 1
  let totalPaymentsSeeded = 0

  for (const pd of planDefs) {
    const patient = insertedPatients[pd.patientIdx]
    if (!patient) continue

    const planStart = daysAgo(pd.paidInstallments * 30 + 10)

    const [plan] = await db
      .insert(schema.paymentPlans)
      .values({
        patientId: patient.id,
        templateId: pd.templateId,
        type: pd.type,
        originalAmount: pd.total,
        discountAmount: 0,
        totalAmount: pd.total,
        amountPerInstallment: pd.installment,
        numberOfInstallments: pd.installments,
        paymentFrequency: pd.frequency,
        startDate: planStart,
        status: pd.status,
        notes: `${pd.status === 'paused' ? 'Patient requested pause — travelling. Resumes next month.' : ''}`,
        treatments: [
          { treatmentId: 'orthodontics', name: 'Orthodontic Treatment', amount: pd.total },
        ],
      })
      .returning()

    // Timeline event for plan creation
    await db.insert(schema.patientTimeline).values({
      patientId: patient.id,
      eventType: 'plan_created',
      referenceType: 'plan',
      referenceId: plan.id,
      title: `Payment plan created — GHS ${pd.total.toLocaleString()}`,
      description: `${pd.installments} installments of GHS ${pd.installment} (${pd.frequency})`,
      amount: pd.total,
      createdById: adminUser.id,
      createdAt: planStart,
    })

    // Create installment invoices
    for (let i = 1; i <= pd.installments; i++) {
      const dueDate = new Date(planStart)
      dueDate.setMonth(dueDate.getMonth() + (i - 1))

      const isPaid = i <= pd.paidInstallments
      const invoiceNum = `INV-2026-${String(invoiceCounter++).padStart(5, '0')}`
      const invStatus = isPaid
        ? 'paid'
        : pd.status === 'overdue' && i === pd.paidInstallments + 1
          ? 'overdue'
          : 'pending'

      const [inv] = await db
        .insert(schema.invoices)
        .values({
          invoiceNumber: invoiceNum,
          patientId: patient.id,
          planId: plan.id,
          type: 'plan_installment',
          installmentNumber: i,
          status: invStatus,
          amount: pd.installment,
          paidAmount: isPaid ? pd.installment : 0,
          dueDate,
          description: `Installment ${i} of ${pd.installments}`,
          treatments: [
            { treatmentId: 'orthodontics', name: 'Orthodontic Treatment', amount: pd.installment },
          ],
          createdAt: dueDate,
          updatedAt: dueDate,
        })
        .returning()

      if (isPaid) {
        const payDate = new Date(dueDate)
        payDate.setDate(payDate.getDate() + rand(0, 5))

        await db.insert(schema.payments).values({
          patientId: patient.id,
          paymentPlanId: plan.id,
          invoiceId: inv.id,
          amount: pd.installment,
          method: pick(paymentMethods),
          status: 'completed',
          description: `Plan installment ${i} of ${pd.installments}`,
          sendNotification: false,
          treatments: [
            { treatmentId: 'orthodontics', name: 'Orthodontic Treatment', amount: pd.installment },
          ],
          createdAt: payDate,
        })

        await db.insert(schema.patientTimeline).values({
          patientId: patient.id,
          eventType: 'payment_received',
          referenceType: 'invoice',
          referenceId: inv.id,
          title: `Payment received — GHS ${pd.installment.toLocaleString()}`,
          description: `Installment ${i} of ${pd.installments} via ${pick(paymentMethods)}`,
          amount: pd.installment,
          createdById: adminUser.id,
          createdAt: payDate,
        })

        totalPaymentsSeeded++
      }
    }
  }

  // One-time payments (for non-plan patients)
  const oneTimePaymentDefs = [
    { patientIdx: 1, amount: 350, desc: 'Scaling & Polishing', method: 'cash' },
    { patientIdx: 2, amount: 500, desc: 'Teeth Whitening', method: 'momo' },
    { patientIdx: 4, amount: 180, desc: 'Child checkup + fluoride', method: 'cash' },
    { patientIdx: 5, amount: 420, desc: 'Molar extraction', method: 'cash' },
    { patientIdx: 7, amount: 280, desc: 'Consultation + X-ray', method: 'card' },
    { patientIdx: 9, amount: 150, desc: 'Child checkup', method: 'cash' },
    { patientIdx: 10, amount: 450, desc: 'Composite filling', method: 'momo' },
    { patientIdx: 11, amount: 600, desc: 'Scaling & root planing', method: 'bank_transfer' },
    { patientIdx: 13, amount: 380, desc: 'Dental filling', method: 'card' },
    { patientIdx: 14, amount: 200, desc: 'Checkup + cleaning', method: 'cash' },
    { patientIdx: 17, amount: 1800, desc: 'Root canal treatment', method: 'momo' },
    { patientIdx: 18, amount: 320, desc: 'Teeth whitening', method: 'cash' },
    { patientIdx: 19, amount: 250, desc: 'Consultation', method: 'cash' },
  ]

  for (const op of oneTimePaymentDefs) {
    const patient = insertedPatients[op.patientIdx]
    if (!patient) continue

    const payDate = daysAgo(rand(5, 75))
    const invoiceNum = `INV-2026-${String(invoiceCounter++).padStart(5, '0')}`

    const [inv] = await db
      .insert(schema.invoices)
      .values({
        invoiceNumber: invoiceNum,
        patientId: patient.id,
        type: 'one_time',
        status: 'paid',
        amount: op.amount,
        paidAmount: op.amount,
        description: op.desc,
        createdAt: payDate,
        updatedAt: payDate,
      })
      .returning()

    await db.insert(schema.payments).values({
      patientId: patient.id,
      invoiceId: inv.id,
      amount: op.amount,
      method: op.method,
      status: 'completed',
      description: op.desc,
      sendNotification: false,
      createdAt: payDate,
    })

    await db.insert(schema.patientTimeline).values({
      patientId: patient.id,
      eventType: 'payment_received',
      referenceType: 'invoice',
      referenceId: inv.id,
      title: `Payment received — GHS ${op.amount.toLocaleString()}`,
      description: `${op.desc} via ${op.method}`,
      amount: op.amount,
      createdById: adminUser.id,
      createdAt: payDate,
    })

    totalPaymentsSeeded++
  }

  console.log(`   ✓ ${planDefs.length} payment plans seeded`)
  console.log(`   ✓ ${invoiceCounter - 1} invoices created`)
  console.log(`   ✓ ${totalPaymentsSeeded} payments recorded`)

  // ── Step 8: Registration timeline events ──────────────────────────────────
  console.log('')
  console.log('→ Seeding registration timeline events…')

  for (const patient of insertedPatients) {
    await db.insert(schema.patientTimeline).values({
      patientId: patient.id,
      eventType: 'registration',
      title: 'Patient registered',
      description: `${patient.name} registered at Framada Dental Clinic.`,
      createdById: adminUser.id,
      createdAt: patient.createdAt,
    })
  }

  // Appointment timeline events for completed ones
  for (const appt of insertedAppointments.filter((a) => a.status === 'completed')) {
    await db.insert(schema.patientTimeline).values({
      patientId: appt.patientId,
      eventType: 'appointment',
      referenceType: 'appointment',
      referenceId: appt.id,
      title: `Appointment completed — ${appt.type}`,
      description: appt.notes ?? 'Appointment attended and completed.',
      createdById: adminUser.id,
      createdAt: appt.date,
    })
  }

  console.log('   ✓ Timeline events seeded')

  // ── Step 9: Expenses ──────────────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding expenses…')

  const expenseDefs = [
    // Monthly rent (3 months)
    {
      category: 'rent',
      amount: 5500,
      desc: 'Monthly clinic rent — April 2026',
      date: daysAgo(11),
      paidTo: 'Landlord Properties Ltd',
      method: 'bank_transfer',
    },
    {
      category: 'rent',
      amount: 5500,
      desc: 'Monthly clinic rent — March 2026',
      date: daysAgo(41),
      paidTo: 'Landlord Properties Ltd',
      method: 'bank_transfer',
    },
    {
      category: 'rent',
      amount: 5500,
      desc: 'Monthly clinic rent — February 2026',
      date: daysAgo(71),
      paidTo: 'Landlord Properties Ltd',
      method: 'bank_transfer',
    },
    // Utilities
    {
      category: 'utilities',
      amount: 380,
      desc: 'Electricity bill — April',
      date: daysAgo(9),
      paidTo: 'ECG',
      method: 'bank_transfer',
    },
    {
      category: 'utilities',
      amount: 410,
      desc: 'Electricity bill — March',
      date: daysAgo(39),
      paidTo: 'ECG',
      method: 'bank_transfer',
    },
    {
      category: 'utilities',
      amount: 360,
      desc: 'Electricity bill — February',
      date: daysAgo(69),
      paidTo: 'ECG',
      method: 'bank_transfer',
    },
    {
      category: 'utilities',
      amount: 90,
      desc: 'Water bill — March',
      date: daysAgo(40),
      paidTo: 'GWCL',
      method: 'cash',
    },
    {
      category: 'utilities',
      amount: 85,
      desc: 'Water bill — February',
      date: daysAgo(70),
      paidTo: 'GWCL',
      method: 'cash',
    },
    // Supplies
    {
      category: 'supplies',
      amount: 1200,
      desc: 'Dental gloves & masks (bulk)',
      date: daysAgo(15),
      paidTo: 'Medic Supplies Ghana',
      method: 'momo',
    },
    {
      category: 'supplies',
      amount: 650,
      desc: 'Composite resin & adhesives',
      date: daysAgo(28),
      paidTo: 'Dentsply Ghana',
      method: 'bank_transfer',
    },
    {
      category: 'supplies',
      amount: 850,
      desc: 'Orthodontic brackets & bands',
      date: daysAgo(45),
      paidTo: 'Ormco Distributors',
      method: 'bank_transfer',
    },
    {
      category: 'supplies',
      amount: 430,
      desc: 'Sterilization pouches & solutions',
      date: daysAgo(55),
      paidTo: 'Medic Supplies Ghana',
      method: 'cash',
    },
    {
      category: 'supplies',
      amount: 280,
      desc: 'X-ray films and developer solution',
      date: daysAgo(62),
      paidTo: 'Radiology Supplies Ltd',
      method: 'cash',
    },
    {
      category: 'supplies',
      amount: 920,
      desc: 'Composite & bonding materials restock',
      date: daysAgo(72),
      paidTo: 'Dentsply Ghana',
      method: 'bank_transfer',
    },
    // Payroll
    {
      category: 'payroll',
      amount: 4800,
      desc: 'Staff payroll — April 2026',
      date: daysAgo(10),
      paidTo: 'Staff',
      method: 'bank_transfer',
    },
    {
      category: 'payroll',
      amount: 4800,
      desc: 'Staff payroll — March 2026',
      date: daysAgo(40),
      paidTo: 'Staff',
      method: 'bank_transfer',
    },
    {
      category: 'payroll',
      amount: 4800,
      desc: 'Staff payroll — February 2026',
      date: daysAgo(70),
      paidTo: 'Staff',
      method: 'bank_transfer',
    },
    // Equipment
    {
      category: 'equipment',
      amount: 750,
      desc: 'Dental chair servicing — chair 2',
      date: daysAgo(30),
      paidTo: 'Equip Tech Services',
      method: 'bank_transfer',
    },
    {
      category: 'equipment',
      amount: 1400,
      desc: 'Autoclave maintenance contract',
      date: daysAgo(60),
      paidTo: 'SciMed Ghana',
      method: 'bank_transfer',
    },
    // Marketing
    {
      category: 'marketing',
      amount: 500,
      desc: 'Social media ads — Instagram/Facebook',
      date: daysAgo(20),
      paidTo: 'Meta Ads',
      method: 'card',
    },
    {
      category: 'marketing',
      amount: 300,
      desc: 'Flyer printing and distribution',
      date: daysAgo(50),
      paidTo: 'QuickPrint Accra',
      method: 'cash',
    },
    // Other
    {
      category: 'other',
      amount: 180,
      desc: 'Office stationery and printer ink',
      date: daysAgo(25),
      paidTo: 'MaxMart',
      method: 'cash',
    },
    {
      category: 'other',
      amount: 220,
      desc: 'Staff refreshments and tea supplies',
      date: daysAgo(35),
      paidTo: 'Local Vendor',
      method: 'cash',
    },
  ]

  await db.insert(schema.expenses).values(
    expenseDefs.map((e) => ({
      category: e.category,
      amount: e.amount,
      date: e.date,
      description: e.desc,
      paidTo: e.paidTo,
      paymentMethod: e.method,
      createdAt: e.date,
    }))
  )

  console.log(`   ✓ ${expenseDefs.length} expenses seeded`)

  // ── Step 10: Inventory ────────────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding inventory…')

  await db.insert(schema.inventory).values([
    {
      name: 'Nitrile Gloves (Medium)',
      category: 'clinical',
      unit: 'box',
      sku: 'INV-GLV-M',
      stockQuantity: 25,
      reorderLevel: 5,
      description: '100-count boxes of nitrile examination gloves.',
    },
    {
      name: 'Nitrile Gloves (Large)',
      category: 'clinical',
      unit: 'box',
      sku: 'INV-GLV-L',
      stockQuantity: 18,
      reorderLevel: 5,
    },
    {
      name: 'Surgical Masks (50-pack)',
      category: 'clinical',
      unit: 'pack',
      sku: 'INV-MSK',
      stockQuantity: 40,
      reorderLevel: 10,
      description: 'Disposable 3-ply surgical masks.',
    },
    {
      name: 'Chlorhexidine Solution',
      category: 'hygiene',
      unit: 'bottle',
      sku: 'INV-CHX',
      stockQuantity: 12,
      reorderLevel: 3,
      description: '500ml antiseptic mouthwash concentrate.',
    },
    {
      name: 'Composite Resin (A2)',
      category: 'clinical',
      unit: 'pcs',
      sku: 'INV-CMP-A2',
      stockQuantity: 8,
      reorderLevel: 2,
    },
    {
      name: 'Composite Resin (A3)',
      category: 'clinical',
      unit: 'pcs',
      sku: 'INV-CMP-A3',
      stockQuantity: 6,
      reorderLevel: 2,
    },
    {
      name: 'Ortho Brackets (Pre-Adj)',
      category: 'orthodontics',
      unit: 'pack',
      sku: 'INV-BRK',
      stockQuantity: 15,
      reorderLevel: 4,
      description: 'Pre-adjusted edgewise brackets — MBT prescription.',
    },
    {
      name: 'Ortho Bands (Molar)',
      category: 'orthodontics',
      unit: 'pack',
      sku: 'INV-BND',
      stockQuantity: 20,
      reorderLevel: 5,
    },
    {
      name: 'Archwires (Niti Round)',
      category: 'orthodontics',
      unit: 'pack',
      sku: 'INV-AWR-N',
      stockQuantity: 30,
      reorderLevel: 8,
    },
    {
      name: 'Ligature Ties',
      category: 'orthodontics',
      unit: 'pack',
      sku: 'INV-LIG',
      stockQuantity: 50,
      reorderLevel: 10,
    },
    {
      name: 'Cotton Rolls (200-pack)',
      category: 'clinical',
      unit: 'pack',
      sku: 'INV-CTN',
      stockQuantity: 22,
      reorderLevel: 5,
    },
    {
      name: 'X-Ray Films (Size 2)',
      category: 'radiology',
      unit: 'pack',
      sku: 'INV-XRY',
      stockQuantity: 4,
      reorderLevel: 2,
      description: 'Periapical X-ray films, pack of 100.',
    },
    {
      name: 'Disposable Bibs',
      category: 'hygiene',
      unit: 'pack',
      sku: 'INV-BIB',
      stockQuantity: 15,
      reorderLevel: 3,
    },
    {
      name: 'Suture Threads 3-0',
      category: 'surgical',
      unit: 'box',
      sku: 'INV-SUT',
      stockQuantity: 6,
      reorderLevel: 2,
    },
  ])

  console.log('   ✓ 14 inventory items seeded')

  // ── Step 11: Products (retail) ────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding products…')

  await db.insert(schema.products).values([
    {
      name: 'Electric Toothbrush',
      category: 'retail',
      sku: 'PRD-ETB',
      unit: 'pcs',
      price: 180,
      costPrice: 110,
      stockQuantity: 12,
      quantityPerPack: 1,
      reorderLevel: 3,
      description: 'Rechargeable electric toothbrush with 2 brush heads.',
    },
    {
      name: 'Whitening Strips (7-day)',
      category: 'retail',
      sku: 'PRD-WST',
      unit: 'pack',
      price: 95,
      costPrice: 55,
      stockQuantity: 20,
      quantityPerPack: 1,
      reorderLevel: 5,
    },
    {
      name: 'Dental Floss (50m)',
      category: 'retail',
      sku: 'PRD-DFL',
      unit: 'pcs',
      price: 25,
      costPrice: 12,
      stockQuantity: 35,
      quantityPerPack: 1,
      reorderLevel: 10,
    },
    {
      name: 'Antiseptic Mouthwash',
      category: 'retail',
      sku: 'PRD-MWS',
      unit: 'bottle',
      price: 45,
      costPrice: 28,
      stockQuantity: 18,
      quantityPerPack: 1,
      reorderLevel: 6,
    },
    {
      name: 'Sensitivity Toothpaste',
      category: 'retail',
      sku: 'PRD-STP',
      unit: 'tube',
      price: 40,
      costPrice: 22,
      stockQuantity: 24,
      quantityPerPack: 1,
      reorderLevel: 8,
      description: 'Sensodyne Rapid Relief 75ml.',
    },
    {
      name: 'Tongue Cleaner',
      category: 'retail',
      sku: 'PRD-TGC',
      unit: 'pcs',
      price: 20,
      costPrice: 10,
      stockQuantity: 30,
      quantityPerPack: 1,
      reorderLevel: 10,
    },
  ])

  console.log('   ✓ 6 products seeded')

  // ── Step 12: Website Bookings ─────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding website bookings…')

  await db.insert(schema.websiteBookings).values([
    {
      name: 'Francis Acheampong',
      phone: '0244800001',
      email: 'francis@email.com',
      preferredDate: '2026-04-16',
      preferredTime: '10:00',
      service: 'general',
      message: 'Looking for a routine checkup.',
      status: 'new',
    },
    {
      name: 'Grace Akyeampong',
      phone: '0244800002',
      email: 'grace@email.com',
      preferredDate: '2026-04-17',
      preferredTime: '09:00',
      service: 'whitening',
      message: 'Interested in teeth whitening.',
      status: 'contacted',
    },
    {
      name: 'Patrick Nkrumah',
      phone: '0244800003',
      preferredDate: '2026-04-18',
      preferredTime: '14:00',
      service: 'ortho',
      message: 'Want to know about braces.',
      status: 'new',
    },
    {
      name: 'Linda Asiedu',
      phone: '0244800004',
      email: 'linda@email.com',
      preferredDate: '2026-04-14',
      preferredTime: '11:00',
      service: 'general',
      message: 'Toothache since last week.',
      status: 'booked',
    },
    {
      name: 'Michael Ofori',
      phone: '0244800005',
      preferredDate: '2026-04-10',
      preferredTime: '15:00',
      service: 'general',
      status: 'booked',
      staffNotes: 'Converted to appointment — booked for April 14.',
    },
  ])

  console.log('   ✓ 5 website bookings seeded')

  // ── Step 13: Suppliers ────────────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding suppliers…')

  const insertedSuppliers = await db
    .insert(schema.suppliers)
    .values([
      {
        name: 'Medic Supplies Ghana',
        contactEmail: 'sales@medicsupplies.gh',
        contactPhone: '0302123456',
        address: 'Spintex Road, Accra',
        paymentTerms: 'Net 30',
        notes: 'Primary PPE & consumables supplier.',
        active: true,
      },
      {
        name: 'Dentsply Ghana',
        contactEmail: 'ghana@dentsply.com',
        contactPhone: '0302789012',
        address: 'East Legon, Accra',
        paymentTerms: 'Net 45',
        notes: 'Composites, bonding agents, endo files.',
        active: true,
      },
      {
        name: 'Ormco Distributors',
        contactEmail: 'orders@ormco-gh.com',
        contactPhone: '0302345678',
        address: 'Airport Residential, Accra',
        paymentTerms: 'Net 30',
        notes: 'Orthodontic brackets, wires, bands.',
        active: true,
      },
      {
        name: 'SciMed Ghana',
        contactEmail: 'info@scimed.gh',
        contactPhone: '0302901234',
        address: 'Tema Industrial Area',
        paymentTerms: 'Net 60',
        notes: 'Autoclave service contract and spares.',
        active: true,
      },
      {
        name: 'Radiology Supplies Ltd',
        contactEmail: 'sales@radiosupplies.gh',
        contactPhone: '0302567890',
        address: 'Ridge, Accra',
        paymentTerms: 'COD',
        notes: 'X-ray films, developer solutions. Not actively used.',
        active: false,
      },
    ])
    .returning()

  console.log(`   ✓ ${insertedSuppliers.length} suppliers seeded`)

  // ── Step 14: Clinic Settings ──────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding clinic settings…')

  await db.insert(schema.clinicSettings).values([
    {
      key: 'clinic_info',
      value: {
        name: 'Framada Dental Clinic',
        tagline: 'Your smile, our mission.',
        address: '15 Liberation Road, Ridge, Accra, Ghana',
        phone: '0302000000',
        email: 'hello@framada.app',
        website: 'https://framadadental.com',
        registrationNumber: 'GDA-CL-2019-00042',
        taxId: 'GRA-TIN-P0012345678',
      },
      updatedById: adminUser.id,
    },
    {
      key: 'operating_hours',
      value: {
        monday: { open: '08:00', close: '18:00' },
        tuesday: { open: '08:00', close: '18:00' },
        wednesday: { open: '08:00', close: '18:00' },
        thursday: { open: '08:00', close: '18:00' },
        friday: { open: '08:00', close: '18:00' },
        saturday: { open: '09:00', close: '14:00' },
        sunday: null,
      },
      updatedById: adminUser.id,
    },
    {
      key: 'finance_visibility',
      value: {
        revenue: true,
        expenses: true,
        profit: true,
        outstanding: true,
        taxes: true,
        insurance_reconciliation: true,
      },
      updatedById: adminUser.id,
    },
    {
      key: 'tax_rates',
      value: { vat: 0.15, nhil: 0.025, getfund: 0.025 },
      updatedById: adminUser.id,
    },
    {
      key: 'appointment_defaults',
      value: {
        slotMinutes: 30,
        bufferMinutes: 5,
        confirmationHoursBefore: 24,
      },
      updatedById: adminUser.id,
    },
  ])

  console.log('   ✓ 5 clinic settings seeded')

  // ── Step 15: Lab module (vendors, services, cases, photos) ────────────────
  console.log('')
  console.log('→ Seeding lab module…')

  const insertedLabVendors = await db
    .insert(schema.labVendors)
    .values([
      {
        name: 'Precision Dental Lab',
        type: 'external',
        contactEmail: 'orders@precisionlab.gh',
        contactPhone: '0244111222',
        address: 'Osu, Accra',
        notes: 'Crowns, bridges, removable prosthetics.',
        active: true,
      },
      {
        name: 'Framada In-House Lab',
        type: 'internal',
        address: 'On-site',
        notes: 'Chairside adjustments & simple appliances.',
        active: true,
      },
      {
        name: 'OrthoForm Labs',
        type: 'external',
        contactEmail: 'jobs@orthoform.gh',
        contactPhone: '0244333444',
        address: 'Tesano, Accra',
        notes: 'Retainers, aligners, nightguards.',
        active: true,
      },
    ])
    .returning()

  const insertedLabServices = await db
    .insert(schema.labServices)
    .values([
      {
        vendorId: insertedLabVendors[0].id,
        serviceName: 'PFM Crown',
        category: 'crown',
        defaultTurnaroundDays: 10,
        defaultCost: 450,
        notes: 'Porcelain-fused-to-metal.',
        active: true,
      },
      {
        vendorId: insertedLabVendors[0].id,
        serviceName: 'Zirconia Crown',
        category: 'crown',
        defaultTurnaroundDays: 14,
        defaultCost: 650,
        notes: 'Full zirconia, high strength.',
        active: true,
      },
      {
        vendorId: insertedLabVendors[0].id,
        serviceName: '3-Unit Bridge',
        category: 'bridge',
        defaultTurnaroundDays: 14,
        defaultCost: 1200,
        active: true,
      },
      {
        vendorId: insertedLabVendors[0].id,
        serviceName: 'Partial Denture (Acrylic)',
        category: 'denture',
        defaultTurnaroundDays: 21,
        defaultCost: 800,
        active: true,
      },
      {
        vendorId: insertedLabVendors[2].id,
        serviceName: 'Hawley Retainer (Upper)',
        category: 'retainer',
        defaultTurnaroundDays: 7,
        defaultCost: 250,
        active: true,
      },
      {
        vendorId: insertedLabVendors[2].id,
        serviceName: 'Clear Retainer',
        category: 'retainer',
        defaultTurnaroundDays: 5,
        defaultCost: 180,
        active: true,
      },
      {
        vendorId: insertedLabVendors[2].id,
        serviceName: 'Nightguard',
        category: 'nightguard',
        defaultTurnaroundDays: 10,
        defaultCost: 350,
        active: true,
      },
    ])
    .returning()

  const insertedLabCases = await db
    .insert(schema.labCases)
    .values([
      {
        caseNumber: 'LC-001001',
        patientId: insertedPatients[1].id,
        vendorId: insertedLabVendors[0].id,
        serviceId: insertedLabServices[1].id,
        serviceName: 'Zirconia Crown',
        status: 'in_progress',
        toothNumbers: [36],
        shade: 'A2',
        impressionType: 'digital',
        sentAt: daysAgo(12),
        expectedReturn: daysFromNow(2),
        cost: 650,
        notes: 'Patient prefers natural shade; delivered scan via intra-oral scanner.',
        createdById: adminUser.id,
        createdAt: daysAgo(12),
      },
      {
        caseNumber: 'LC-001002',
        patientId: insertedPatients[10].id,
        vendorId: insertedLabVendors[0].id,
        serviceId: insertedLabServices[2].id,
        serviceName: '3-Unit Bridge',
        status: 'received',
        toothNumbers: [14, 15, 16],
        shade: 'A3',
        impressionType: 'PVS',
        sentAt: daysAgo(25),
        expectedReturn: daysAgo(5),
        receivedAt: daysAgo(3),
        cost: 1200,
        notes: 'Fit and finish look good; ready for try-in.',
        createdById: adminUser.id,
        createdAt: daysAgo(25),
      },
      {
        caseNumber: 'LC-001003',
        patientId: insertedPatients[3].id,
        vendorId: insertedLabVendors[2].id,
        serviceId: insertedLabServices[5].id,
        serviceName: 'Clear Retainer',
        status: 'ready_for_insertion',
        toothNumbers: [],
        impressionType: 'digital',
        sentAt: daysAgo(10),
        expectedReturn: daysAgo(3),
        receivedAt: daysAgo(3),
        cost: 180,
        createdById: adminUser.id,
        createdAt: daysAgo(10),
      },
      {
        caseNumber: 'LC-001004',
        patientId: insertedPatients[15].id,
        vendorId: insertedLabVendors[0].id,
        serviceId: insertedLabServices[3].id,
        serviceName: 'Partial Denture (Acrylic)',
        status: 'inserted',
        toothNumbers: [24, 25, 26],
        shade: 'A3',
        impressionType: 'alginate',
        sentAt: daysAgo(40),
        expectedReturn: daysAgo(20),
        receivedAt: daysAgo(18),
        insertedAt: daysAgo(15),
        cost: 800,
        notes: 'Patient very satisfied. Minor adjustment on first recall.',
        createdById: adminUser.id,
        createdAt: daysAgo(40),
      },
      {
        caseNumber: 'LC-001005',
        patientId: insertedPatients[6].id,
        vendorId: insertedLabVendors[2].id,
        serviceId: insertedLabServices[6].id,
        serviceName: 'Nightguard',
        status: 'sent',
        toothNumbers: [],
        impressionType: 'digital',
        sentAt: daysAgo(4),
        expectedReturn: daysFromNow(6),
        cost: 350,
        notes: 'For bruxism control.',
        createdById: adminUser.id,
        createdAt: daysAgo(4),
      },
      {
        caseNumber: 'LC-001006',
        patientId: insertedPatients[8].id,
        vendorId: insertedLabVendors[0].id,
        serviceId: insertedLabServices[0].id,
        serviceName: 'PFM Crown',
        status: 'draft',
        toothNumbers: [46],
        shade: 'A2',
        cost: 450,
        notes: 'Awaiting impression.',
        createdById: adminUser.id,
        createdAt: daysAgo(1),
      },
    ])
    .returning()

  const labCasePhotosToInsert = insertedLabCases
    .filter((c) => ['in_progress', 'received', 'ready_for_insertion', 'inserted'].includes(c.status))
    .map((c) => ({
      labCaseId: c.id,
      photoUrl: `https://placehold.co/800x600?text=LabCase-${c.caseNumber}`,
      photoType: 'prep',
      notes: `Prep photo for ${c.serviceName}`,
      uploadedById: adminUser.id,
      uploadedAt: c.createdAt,
    }))
  if (labCasePhotosToInsert.length > 0) {
    await db.insert(schema.labCasePhotos).values(labCasePhotosToInsert)
  }

  console.log(
    `   ✓ ${insertedLabVendors.length} vendors · ${insertedLabServices.length} services · ${insertedLabCases.length} cases · ${labCasePhotosToInsert.length} photos`
  )

  // ── Step 16: X-rays ───────────────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding x-ray module…')

  const insertedXrayTypes = await db
    .insert(schema.xrayTypes)
    .values([
      {
        name: 'periapical',
        displayName: 'Periapical',
        description: 'Single-tooth imaging showing root and crown.',
        active: true,
      },
      {
        name: 'bitewing',
        displayName: 'Bitewing',
        description: 'For interproximal caries detection.',
        active: true,
      },
      {
        name: 'panoramic',
        displayName: 'Panoramic (OPG)',
        description: 'Full-mouth overview.',
        active: true,
      },
      {
        name: 'occlusal',
        displayName: 'Occlusal',
        description: 'Floor of mouth / palate.',
        active: true,
      },
      {
        name: 'cbct',
        displayName: 'Cone-Beam CT',
        description: '3D volumetric imaging (usually referred out).',
        active: true,
      },
      {
        name: 'lateral_ceph',
        displayName: 'Lateral Cephalometric',
        description: 'Orthodontic treatment planning.',
        active: true,
      },
    ])
    .returning()

  const insertedXrayRecords = await db
    .insert(schema.xrayRecords)
    .values([
      {
        patientId: insertedPatients[1].id,
        xrayTypeId: insertedXrayTypes[0].id,
        source: 'internal',
        toothNumber: 36,
        imageUrl: 'https://placehold.co/800x1000?text=PA-36',
        thumbnailUrl: 'https://placehold.co/200x250?text=PA-36',
        capturedAt: daysAgo(20),
        uploadedById: adminUser.id,
        uploadedAt: daysAgo(20),
        notes: 'Periapical for endo planning.',
      },
      {
        patientId: insertedPatients[10].id,
        xrayTypeId: insertedXrayTypes[2].id,
        source: 'internal',
        imageUrl: 'https://placehold.co/1400x700?text=OPG',
        thumbnailUrl: 'https://placehold.co/350x175?text=OPG',
        capturedAt: daysAgo(30),
        uploadedById: adminUser.id,
        uploadedAt: daysAgo(30),
        notes: 'Routine full-mouth OPG.',
      },
      {
        patientId: insertedPatients[3].id,
        xrayTypeId: insertedXrayTypes[5].id,
        source: 'internal',
        imageUrl: 'https://placehold.co/800x1000?text=LatCeph',
        thumbnailUrl: 'https://placehold.co/200x250?text=LatCeph',
        capturedAt: daysAgo(90),
        uploadedById: adminUser.id,
        uploadedAt: daysAgo(90),
        notes: 'Orthodontic baseline ceph.',
      },
      {
        patientId: insertedPatients[6].id,
        xrayTypeId: insertedXrayTypes[1].id,
        source: 'internal',
        imageUrl: 'https://placehold.co/800x600?text=BW',
        thumbnailUrl: 'https://placehold.co/200x150?text=BW',
        capturedAt: daysAgo(45),
        uploadedById: adminUser.id,
        uploadedAt: daysAgo(45),
      },
      {
        patientId: insertedPatients[15].id,
        xrayTypeId: insertedXrayTypes[4].id,
        source: 'external',
        imageUrl: 'https://placehold.co/1200x1200?text=CBCT',
        thumbnailUrl: 'https://placehold.co/300x300?text=CBCT',
        externalClinicName: 'Greater Accra Imaging Center',
        externalCapturedDate: daysAgo(100),
        uploadedById: adminUser.id,
        uploadedAt: daysAgo(95),
        notes: 'CBCT referred out for implant planning.',
      },
    ])
    .returning()

  const [xrayShareActive] = await db
    .insert(schema.xrayShareLinks)
    .values({
      linkToken: 'shr_abc123def456',
      accessCode: '248135',
      xrayRecordIds: [insertedXrayRecords[0].id, insertedXrayRecords[1].id],
      patientId: insertedPatients[1].id,
      recipientName: 'Dr. Addo (Referring)',
      recipientContact: '0244900001',
      createdById: adminUser.id,
      createdAt: daysAgo(3),
      expiresAt: daysFromNow(4),
      accessCount: 2,
      verifiedAt: daysAgo(2),
    })
    .returning()

  const [xrayShareExpired] = await db
    .insert(schema.xrayShareLinks)
    .values({
      linkToken: 'shr_expired987xyz',
      accessCode: '771423',
      xrayRecordIds: [insertedXrayRecords[2].id],
      patientId: insertedPatients[3].id,
      recipientName: 'Ortho Specialist Ghana',
      recipientContact: 'referrals@ortho-gh.com',
      createdById: adminUser.id,
      createdAt: daysAgo(20),
      expiresAt: daysAgo(13),
      revokedAt: daysAgo(13),
      revokedById: adminUser.id,
      accessCount: 5,
      verifiedAt: daysAgo(18),
    })
    .returning()

  await db.insert(schema.xrayShareAccessLog).values([
    {
      shareLinkId: xrayShareActive.id,
      accessedAt: daysAgo(2),
      ipAddress: '197.255.100.20',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      action: 'view_code_request',
    },
    {
      shareLinkId: xrayShareActive.id,
      accessedAt: daysAgo(2),
      ipAddress: '197.255.100.20',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      action: 'view_code_verify',
    },
    {
      shareLinkId: xrayShareActive.id,
      accessedAt: daysAgo(2),
      ipAddress: '197.255.100.20',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      action: 'view_xray',
      xrayRecordId: insertedXrayRecords[0].id,
    },
    {
      shareLinkId: xrayShareExpired.id,
      accessedAt: daysAgo(18),
      ipAddress: '197.255.200.30',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0)',
      action: 'view_xray',
      xrayRecordId: insertedXrayRecords[2].id,
    },
  ])

  console.log(
    `   ✓ ${insertedXrayTypes.length} types · ${insertedXrayRecords.length} records · 2 share links`
  )

  // ── Step 17: Consent forms (library + signed) ─────────────────────────────
  console.log('')
  console.log('→ Seeding consent forms…')

  const insertedConsentTemplates = await db
    .insert(schema.consentFormTemplates)
    .values([
      {
        name: 'General Treatment Consent',
        category: 'general',
        content:
          '# General Treatment Consent\n\nI consent to dental treatment as explained by my dentist at Framada Dental Clinic. I understand the risks and benefits of the recommended procedures and have had an opportunity to ask questions.',
        requiresSignature: true,
        requiresWitness: false,
        active: true,
        createdById: adminUser.id,
      },
      {
        name: 'Orthodontic Treatment Consent',
        category: 'ortho',
        content:
          '# Orthodontic Treatment Consent\n\nI consent to orthodontic treatment including braces, wires, periodic adjustments, and retainer wear after treatment. I understand compliance is essential to achieve the planned outcome.',
        requiresSignature: true,
        requiresWitness: false,
        active: true,
        createdById: adminUser.id,
      },
      {
        name: 'Surgical Extraction Consent',
        category: 'surgical',
        content:
          '# Surgical Extraction Consent\n\nI consent to the extraction of the indicated tooth/teeth. I understand the risks including bleeding, infection, dry socket, and nerve injury.',
        requiresSignature: true,
        requiresWitness: true,
        active: true,
        createdById: adminUser.id,
      },
      {
        name: 'Privacy & Data Consent',
        category: 'privacy',
        content:
          '# Privacy Consent\n\nI consent to Framada Dental Clinic storing my personal and health data in accordance with Ghana Data Protection Act, 2012 (Act 843).',
        requiresSignature: true,
        requiresWitness: false,
        active: true,
        createdById: adminUser.id,
      },
      {
        name: 'Photography & Imaging Consent',
        category: 'photography',
        content:
          '# Photography Consent\n\nI consent to clinical photographs being taken for record-keeping and treatment planning. I understand they will not be used for marketing without separate written consent.',
        requiresSignature: true,
        requiresWitness: false,
        active: true,
        createdById: adminUser.id,
      },
      {
        name: 'Financial Agreement',
        category: 'financial',
        content:
          '# Financial Agreement\n\nI agree to the payment terms discussed. I understand that payment plan installments are due on the scheduled dates and that missed payments may incur fees.',
        requiresSignature: true,
        requiresWitness: false,
        active: true,
        createdById: adminUser.id,
      },
    ])
    .returning()

  const tinyPngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen0YrMAAAAASUVORK5CYII='

  await db.insert(schema.signedConsentForms).values([
    {
      templateId: insertedConsentTemplates[0].id,
      patientId: insertedPatients[1].id,
      signatureData: tinyPngBase64,
      signedByName: insertedPatients[1].name,
      relationshipToPatient: 'self',
      contentSnapshot: insertedConsentTemplates[0].content,
      signedAt: daysAgo(60),
      collectedById: adminUser.id,
    },
    {
      templateId: insertedConsentTemplates[1].id,
      patientId: insertedPatients[3].id,
      signatureData: tinyPngBase64,
      signedByName: insertedPatients[3].name,
      relationshipToPatient: 'self',
      contentSnapshot: insertedConsentTemplates[1].content,
      signedAt: daysAgo(90),
      collectedById: adminUser.id,
    },
    {
      templateId: insertedConsentTemplates[1].id,
      patientId: insertedPatients[6].id,
      signatureData: tinyPngBase64,
      signedByName: insertedPatients[6].name,
      relationshipToPatient: 'self',
      contentSnapshot: insertedConsentTemplates[1].content,
      signedAt: daysAgo(75),
      collectedById: adminUser.id,
    },
    {
      templateId: insertedConsentTemplates[2].id,
      patientId: insertedPatients[5].id,
      signatureData: tinyPngBase64,
      signedByName: insertedPatients[5].name,
      relationshipToPatient: 'self',
      witnessName: 'Sarah Adjei',
      witnessSignatureData: tinyPngBase64,
      contentSnapshot: insertedConsentTemplates[2].content,
      signedAt: daysAgo(55),
      collectedById: adminUser.id,
      notes: 'Wisdom tooth extraction — surgical consent required.',
    },
    {
      templateId: insertedConsentTemplates[3].id,
      patientId: insertedPatients[1].id,
      signatureData: tinyPngBase64,
      signedByName: insertedPatients[1].name,
      relationshipToPatient: 'self',
      contentSnapshot: insertedConsentTemplates[3].content,
      signedAt: daysAgo(60),
      collectedById: adminUser.id,
    },
    {
      templateId: insertedConsentTemplates[4].id,
      patientId: insertedPatients[3].id,
      signatureData: tinyPngBase64,
      signedByName: insertedPatients[3].name,
      relationshipToPatient: 'self',
      contentSnapshot: insertedConsentTemplates[4].content,
      signedAt: daysAgo(90),
      collectedById: adminUser.id,
    },
    {
      templateId: insertedConsentTemplates[0].id,
      patientId: insertedPatients[4].id,
      signatureData: tinyPngBase64,
      signedByName: 'Emma Boateng',
      relationshipToPatient: 'guardian',
      contentSnapshot: insertedConsentTemplates[0].content,
      signedAt: daysAgo(40),
      collectedById: adminUser.id,
      notes: 'Guardian signing for child patient.',
    },
  ])

  console.log(
    `   ✓ ${insertedConsentTemplates.length} templates · 7 signed forms`
  )

  // ── Step 18: Insurance (companies, pricing docs, reconciliation) ──────────
  console.log('')
  console.log('→ Seeding insurance module…')

  const insertedInsuranceCompanies = await db
    .insert(schema.insuranceCompanies)
    .values([
      {
        name: 'Star Health Insurance',
        contactEmail: 'claims@starhealth.gh',
        contactPhone: '0302555111',
        address: 'Airport City, Accra',
        notes: 'Primary insurer partner.',
        active: true,
      },
      {
        name: 'Nationwide Medical',
        contactEmail: 'claims@nationwide.gh',
        contactPhone: '0302555222',
        address: 'Labone, Accra',
        active: true,
      },
      {
        name: 'Apex Dental Cover',
        contactEmail: 'support@apexcover.gh',
        contactPhone: '0302555333',
        address: 'Cantonments, Accra',
        notes: 'Specialist dental-only plans.',
        active: true,
      },
      {
        name: 'Legacy Health Plan',
        contactPhone: '0302555444',
        notes: 'Lapsed — no new claims accepted.',
        active: false,
      },
    ])
    .returning()

  const insertedPricingDocs = await db
    .insert(schema.insurancePricingDocuments)
    .values([
      {
        companyId: insertedInsuranceCompanies[0].id,
        fileName: 'StarHealth-Pricing-2026.pdf',
        fileUrl: 'https://placehold.co/dummy-pricing.pdf',
        fileSize: 245000,
        mimeType: 'application/pdf',
        isCurrent: true,
        version: '2026.01',
        effectiveFrom: new Date('2026-01-01'),
        notes: 'Current rates; reviewed Jan 2026.',
        uploadedById: adminUser.id,
        uploadedAt: daysAgo(100),
      },
      {
        companyId: insertedInsuranceCompanies[0].id,
        fileName: 'StarHealth-Pricing-2025.pdf',
        fileUrl: 'https://placehold.co/dummy-archived.pdf',
        fileSize: 238000,
        mimeType: 'application/pdf',
        isCurrent: false,
        version: '2025.01',
        effectiveFrom: new Date('2025-01-01'),
        notes: 'Archived — superseded.',
        uploadedById: adminUser.id,
        uploadedAt: daysAgo(400),
      },
      {
        companyId: insertedInsuranceCompanies[1].id,
        fileName: 'Nationwide-Dental-Schedule.pdf',
        fileUrl: 'https://placehold.co/dummy-nationwide.pdf',
        fileSize: 180000,
        mimeType: 'application/pdf',
        isCurrent: true,
        version: '2026.Q1',
        effectiveFrom: new Date('2026-01-01'),
        uploadedById: adminUser.id,
        uploadedAt: daysAgo(95),
      },
      {
        companyId: insertedInsuranceCompanies[2].id,
        fileName: 'ApexCover-Rates.pdf',
        fileUrl: 'https://placehold.co/dummy-apex.pdf',
        fileSize: 156000,
        mimeType: 'application/pdf',
        isCurrent: true,
        version: '2026',
        effectiveFrom: new Date('2026-01-15'),
        uploadedById: adminUser.id,
        uploadedAt: daysAgo(85),
      },
    ])
    .returning()

  // Grab some medical records to reference as the treatment source
  const medRecsForInsurance = await db
    .select({ id: schema.medicalRecords.id, patientId: schema.medicalRecords.patientId })
    .from(schema.medicalRecords)
    .limit(8)

  if (medRecsForInsurance.length >= 4) {
    await db.insert(schema.insuranceReconciliation).values([
      {
        companyId: insertedInsuranceCompanies[0].id,
        patientId: insertedPatients[19].id,
        cardNumber: 'SHI-2024-48291',
        treatmentSourceType: 'medical_record',
        treatmentSourceId: medRecsForInsurance[0].id,
        chargedAmount: 450,
        insurerPaidAmount: 420,
        reconciledAt: daysAgo(15),
        notes: 'Standard reimbursement — 30 GHS deductible applied.',
        recordedById: adminUser.id,
        recordedAt: daysAgo(30),
      },
      {
        companyId: insertedInsuranceCompanies[0].id,
        patientId: insertedPatients[19].id,
        cardNumber: 'SHI-2024-48291',
        treatmentSourceType: 'medical_record',
        treatmentSourceId: medRecsForInsurance[1].id,
        chargedAmount: 280,
        notes: 'Claim submitted — awaiting reconciliation.',
        recordedById: adminUser.id,
        recordedAt: daysAgo(10),
      },
      {
        companyId: insertedInsuranceCompanies[1].id,
        patientId: medRecsForInsurance[2].patientId,
        cardNumber: 'NW-2026-11234',
        treatmentSourceType: 'medical_record',
        treatmentSourceId: medRecsForInsurance[2].id,
        chargedAmount: 1200,
        insurerPaidAmount: 1080,
        reconciledAt: daysAgo(5),
        recordedById: adminUser.id,
        recordedAt: daysAgo(25),
      },
      {
        companyId: insertedInsuranceCompanies[2].id,
        patientId: medRecsForInsurance[3].patientId,
        cardNumber: 'APX-88421',
        treatmentSourceType: 'medical_record',
        treatmentSourceId: medRecsForInsurance[3].id,
        chargedAmount: 350,
        notes: 'Awaiting supporting X-ray upload.',
        recordedById: adminUser.id,
        recordedAt: daysAgo(3),
      },
    ])
  }

  console.log(
    `   ✓ ${insertedInsuranceCompanies.length} companies · ${insertedPricingDocs.length} pricing docs · 4 reconciliation entries`
  )

  // ── Step 19: Doctor unavailability ────────────────────────────────────────
  console.log('')
  console.log('→ Seeding doctor unavailability…')

  await db.insert(schema.doctorUnavailability).values([
    {
      doctorId: doctorA.id,
      startTime: daysAgo(21),
      endTime: daysAgo(19),
      reason: 'Continuing education — GDA refresher course',
    },
    {
      doctorId: doctorA.id,
      startTime: daysFromNow(14),
      endTime: daysFromNow(16),
      reason: 'Annual leave',
    },
    {
      doctorId: doctorB.id,
      startTime: daysFromNow(30),
      endTime: daysFromNow(31),
      reason: 'Family commitment',
    },
  ])

  console.log('   ✓ 3 doctor unavailability blocks seeded')

  // ── Step 20: Treatment plans & items ──────────────────────────────────────
  console.log('')
  console.log('→ Seeding treatment plans…')

  // Ortho patients: 3, 6, 8, 12, 16 · pick restorative candidates from the rest
  type PlanItemDef = {
    procedureName: string
    phase: number
    estimatedCost: number
    status: 'pending' | 'scheduled' | 'completed' | 'cancelled'
    toothNumber: number | null
  }
  type PlanDef = {
    patientIdx: number
    title: string
    totalEstimated: number
    status: 'draft' | 'presented' | 'accepted' | 'in_progress' | 'completed' | 'declined'
    presentedAt?: Date
    acceptedAt?: Date
    completedAt?: Date
    signedByName?: string
    signedRelationship?: string
    notes?: string
    items: PlanItemDef[]
  }
  const planDefinitions: PlanDef[] = [
    {
      patientIdx: 3,
      title: 'Comprehensive Orthodontic Treatment — Upper & Lower',
      totalEstimated: 8500,
      status: 'in_progress',
      presentedAt: daysAgo(120),
      acceptedAt: daysAgo(118),
      signedByName: insertedPatients[3].name,
      signedRelationship: 'self',
      notes: '24-month fixed appliance plan. Extraction of 14, 24.',
      items: [
        { procedureName: 'Initial records & photographs', phase: 1, estimatedCost: 250, status: 'completed', toothNumber: null },
        { procedureName: 'Extraction 14', phase: 1, estimatedCost: 180, status: 'completed', toothNumber: 14 },
        { procedureName: 'Extraction 24', phase: 1, estimatedCost: 180, status: 'completed', toothNumber: 24 },
        { procedureName: 'Bonding — upper arch', phase: 2, estimatedCost: 2200, status: 'completed', toothNumber: null },
        { procedureName: 'Bonding — lower arch', phase: 2, estimatedCost: 2200, status: 'scheduled', toothNumber: null },
        { procedureName: 'Monthly adjustments (×18)', phase: 3, estimatedCost: 3000, status: 'pending', toothNumber: null },
        { procedureName: 'Debond & retainers', phase: 4, estimatedCost: 490, status: 'pending', toothNumber: null },
      ],
    },
    {
      patientIdx: 6,
      title: 'Ortho — Class II correction',
      totalEstimated: 7200,
      status: 'accepted',
      presentedAt: daysAgo(45),
      acceptedAt: daysAgo(40),
      signedByName: insertedPatients[6].name,
      signedRelationship: 'self',
      notes: 'Headgear option declined; patient opted for elastics.',
      items: [
        { procedureName: 'Diagnostic cephalometric X-ray', phase: 1, estimatedCost: 300, status: 'completed', toothNumber: null },
        { procedureName: 'Bonding — full mouth', phase: 2, estimatedCost: 4000, status: 'scheduled', toothNumber: null },
        { procedureName: 'Monthly adjustments (×18)', phase: 3, estimatedCost: 2400, status: 'pending', toothNumber: null },
        { procedureName: 'Debond & upper Hawley', phase: 4, estimatedCost: 500, status: 'pending', toothNumber: null },
      ],
    },
    {
      patientIdx: 12,
      title: 'Ortho — mild crowding',
      totalEstimated: 6800,
      status: 'presented',
      presentedAt: daysAgo(8),
      notes: 'Presented — awaiting patient decision on payment plan.',
      items: [
        { procedureName: 'Records & study models', phase: 1, estimatedCost: 350, status: 'pending', toothNumber: null },
        { procedureName: 'Bonding — upper & lower', phase: 2, estimatedCost: 3800, status: 'pending', toothNumber: null },
        { procedureName: 'Monthly adjustments (×15)', phase: 3, estimatedCost: 2250, status: 'pending', toothNumber: null },
        { procedureName: 'Debond & retainers', phase: 4, estimatedCost: 400, status: 'pending', toothNumber: null },
      ],
    },
    {
      patientIdx: 1,
      title: 'Full-mouth restorative rehabilitation',
      totalEstimated: 5400,
      status: 'in_progress',
      presentedAt: daysAgo(75),
      acceptedAt: daysAgo(70),
      signedByName: insertedPatients[1].name,
      signedRelationship: 'self',
      notes: 'Multi-phase crowns and composite restorations.',
      items: [
        { procedureName: 'Composite filling 16-O', phase: 1, estimatedCost: 180, status: 'completed', toothNumber: 16 },
        { procedureName: 'Composite filling 26-MO', phase: 1, estimatedCost: 220, status: 'completed', toothNumber: 26 },
        { procedureName: 'RCT 36', phase: 2, estimatedCost: 900, status: 'scheduled', toothNumber: 36 },
        { procedureName: 'PFM Crown 36', phase: 2, estimatedCost: 1400, status: 'pending', toothNumber: 36 },
        { procedureName: 'Crown lengthening 46', phase: 3, estimatedCost: 700, status: 'pending', toothNumber: 46 },
        { procedureName: 'Zirconia Crown 46', phase: 3, estimatedCost: 2000, status: 'pending', toothNumber: 46 },
      ],
    },
    {
      patientIdx: 10,
      title: 'Posterior restorative plan',
      totalEstimated: 2100,
      status: 'completed',
      presentedAt: daysAgo(200),
      acceptedAt: daysAgo(198),
      completedAt: daysAgo(30),
      signedByName: insertedPatients[10].name,
      signedRelationship: 'self',
      items: [
        { procedureName: 'Amalgam filling 37-O', phase: 1, estimatedCost: 180, status: 'completed', toothNumber: 37 },
        { procedureName: 'Composite filling 47-MOD', phase: 1, estimatedCost: 320, status: 'completed', toothNumber: 47 },
        { procedureName: 'Scaling & polishing', phase: 2, estimatedCost: 200, status: 'completed', toothNumber: null },
        { procedureName: 'PFM Crown 46', phase: 3, estimatedCost: 1400, status: 'completed', toothNumber: 46 },
      ],
    },
  ]

  const insertedTreatmentPlans = await db
    .insert(schema.treatmentPlans)
    .values(
      planDefinitions.map((p) => ({
        patientId: insertedPatients[p.patientIdx].id,
        title: p.title,
        totalEstimated: p.totalEstimated,
        status: p.status,
        presentedAt: p.presentedAt ?? null,
        acceptedAt: p.acceptedAt ?? null,
        completedAt: p.completedAt ?? null,
        signatureData: p.signedByName ? tinyPngBase64 : null,
        signedByName: p.signedByName ?? null,
        signedRelationship: p.signedRelationship ?? null,
        notes: p.notes ?? null,
        createdById: adminUser.id,
      }))
    )
    .returning()

  let planItemCount = 0
  for (let i = 0; i < planDefinitions.length; i++) {
    const plan = insertedTreatmentPlans[i]
    const def = planDefinitions[i]
    await db.insert(schema.treatmentPlanItems).values(
      def.items.map((item, idx) => ({
        planId: plan.id,
        procedureName: item.procedureName,
        toothNumber: item.toothNumber,
        phase: item.phase,
        estimatedCost: item.estimatedCost,
        status: item.status,
        sortOrder: idx,
      }))
    )
    planItemCount += def.items.length
  }

  console.log(
    `   ✓ ${insertedTreatmentPlans.length} treatment plans · ${planItemCount} plan items`
  )

  // ── Step 21: Ortho consent forms ──────────────────────────────────────────
  console.log('')
  console.log('→ Seeding ortho consent forms…')

  const orthoPatientIndices = [3, 6, 8, 12]

  await db.insert(schema.orthoConsentForms).values(
    orthoPatientIndices.map((idx, i) => ({
      patientId: insertedPatients[idx].id,
      consentFormUrl: `https://placehold.co/ortho-consent-${insertedPatients[idx].id}.pdf`,
      status: (i < 3 ? 'signed' : 'unsigned') as 'signed' | 'unsigned',
      uploadedById: adminUser.id,
      uploadedAt: i < 3 ? daysAgo(rand(30, 120)) : null,
      notes: i < 3 ? 'Signed by patient after case presentation.' : 'Scheduled for next visit.',
    }))
  )

  console.log(`   ✓ ${orthoPatientIndices.length} ortho consent forms seeded`)

  // ── Step 22: Pending medical records (checked-in queue) ───────────────────
  console.log('')
  console.log('→ Seeding pending medical records…')

  const completedApptsForPending = insertedAppointments.filter((a) => a.status === 'completed')
  const pendingSeedCount = Math.min(2, completedApptsForPending.length)

  if (pendingSeedCount > 0) {
    await db.insert(schema.pendingMedicalRecords).values(
      completedApptsForPending.slice(0, pendingSeedCount).map((appt, i) => ({
        patientId: insertedPatients[appt.patientIdx].id,
        doctorId: i % 2 === 0 ? doctorA.id : doctorB.id,
        appointmentId: appt.id,
        checkedInAt: daysAgo(rand(0, 1)),
        status: 'pending',
      }))
    )
  }

  console.log(`   ✓ ${pendingSeedCount} pending medical records seeded`)

  // ── Step 23: Patient photos ───────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding patient photos…')

  await db.insert(schema.patientPhotos).values([
    {
      patientId: insertedPatients[3].id,
      category: 'intraoral',
      clinicalScope: true,
      imageUrl: tinyPngBase64,
      thumbnailUrl: tinyPngBase64,
      capturedAt: daysAgo(120),
      notes: 'Pre-treatment occlusal view — upper arch.',
      uploadedById: adminUser.id,
    },
    {
      patientId: insertedPatients[3].id,
      category: 'before',
      clinicalScope: true,
      imageUrl: tinyPngBase64,
      thumbnailUrl: tinyPngBase64,
      capturedAt: daysAgo(120),
      notes: 'Frontal view — before bonding.',
      uploadedById: adminUser.id,
    },
    {
      patientId: insertedPatients[6].id,
      category: 'portrait',
      clinicalScope: false,
      imageUrl: tinyPngBase64,
      thumbnailUrl: tinyPngBase64,
      capturedAt: daysAgo(40),
      notes: 'Patient file photo.',
      uploadedById: adminUser.id,
    },
    {
      patientId: insertedPatients[10].id,
      category: 'after',
      clinicalScope: true,
      imageUrl: tinyPngBase64,
      thumbnailUrl: tinyPngBase64,
      capturedAt: daysAgo(30),
      notes: 'Post-crown cementation 46.',
      uploadedById: adminUser.id,
    },
    {
      patientId: insertedPatients[1].id,
      category: 'intraoral',
      clinicalScope: true,
      imageUrl: tinyPngBase64,
      thumbnailUrl: tinyPngBase64,
      capturedAt: daysAgo(60),
      notes: 'Lower arch caries assessment.',
      uploadedById: adminUser.id,
    },
    {
      patientId: insertedPatients[8].id,
      category: 'before',
      clinicalScope: true,
      imageUrl: tinyPngBase64,
      thumbnailUrl: tinyPngBase64,
      capturedAt: daysAgo(15),
      notes: 'Records session — pre-ortho.',
      uploadedById: adminUser.id,
    },
  ])

  console.log('   ✓ 6 patient photos seeded')

  // ── Step 24: Patient documents ────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding patient documents…')

  await db.insert(schema.patientDocuments).values([
    {
      patientId: insertedPatients[19].id,
      category: 'insurance_card',
      clinicalScope: false,
      fileName: 'starhealth-card-front.jpg',
      fileUrl: 'https://placehold.co/insurance-card-1.jpg',
      fileSize: 142000,
      mimeType: 'image/jpeg',
      notes: 'Star Health card — front scan.',
      uploadedById: adminUser.id,
    },
    {
      patientId: insertedPatients[19].id,
      category: 'id',
      clinicalScope: false,
      fileName: 'ghana-card.pdf',
      fileUrl: 'https://placehold.co/ghana-card.pdf',
      fileSize: 210000,
      mimeType: 'application/pdf',
      notes: 'Ghana Card — verified.',
      uploadedById: adminUser.id,
    },
    {
      patientId: insertedPatients[3].id,
      category: 'consent',
      clinicalScope: true,
      fileName: 'ortho-consent-signed.pdf',
      fileUrl: 'https://placehold.co/ortho-consent-signed.pdf',
      fileSize: 320000,
      mimeType: 'application/pdf',
      notes: 'Signed ortho consent — archived copy.',
      uploadedById: adminUser.id,
    },
    {
      patientId: insertedPatients[1].id,
      category: 'consent',
      clinicalScope: true,
      fileName: 'extraction-consent.pdf',
      fileUrl: 'https://placehold.co/extraction-consent.pdf',
      fileSize: 180000,
      mimeType: 'application/pdf',
      uploadedById: adminUser.id,
    },
    {
      patientId: insertedPatients[12].id,
      category: 'id',
      clinicalScope: false,
      fileName: 'passport-scan.pdf',
      fileUrl: 'https://placehold.co/passport.pdf',
      fileSize: 260000,
      mimeType: 'application/pdf',
      notes: 'Passport used as ID — non-Ghanaian resident.',
      uploadedById: adminUser.id,
    },
  ])

  console.log('   ✓ 5 patient documents seeded')

  // ── Step 25: Odontogram ───────────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding odontogram entries…')

  await db.insert(schema.patientOdontogram).values([
    {
      patientId: insertedPatients[1].id,
      toothNumber: 16,
      surface: 'O',
      condition: 'filling_composite',
      notes: 'Existing composite — good margins.',
      recordedById: adminUser.id,
    },
    {
      patientId: insertedPatients[1].id,
      toothNumber: 26,
      surface: 'M',
      condition: 'caries',
      notes: 'Early mesial caries.',
      recordedById: adminUser.id,
    },
    {
      patientId: insertedPatients[1].id,
      toothNumber: 36,
      surface: 'whole',
      condition: 'rct',
      notes: 'Pending endo treatment.',
      recordedById: adminUser.id,
    },
    {
      patientId: insertedPatients[1].id,
      toothNumber: 46,
      surface: 'D',
      condition: 'caries',
      recordedById: adminUser.id,
    },
    {
      patientId: insertedPatients[10].id,
      toothNumber: 37,
      surface: 'O',
      condition: 'filling_amalgam',
      recordedById: adminUser.id,
    },
    {
      patientId: insertedPatients[10].id,
      toothNumber: 47,
      surface: 'O',
      condition: 'filling_composite',
      recordedById: adminUser.id,
    },
    {
      patientId: insertedPatients[10].id,
      toothNumber: 46,
      surface: 'whole',
      condition: 'crown',
      notes: 'PFM crown — cemented.',
      recordedById: adminUser.id,
    },
    {
      patientId: insertedPatients[10].id,
      toothNumber: 18,
      surface: 'whole',
      condition: 'extracted',
      recordedById: adminUser.id,
    },
    {
      patientId: insertedPatients[3].id,
      toothNumber: 14,
      surface: 'whole',
      condition: 'extracted',
      notes: 'Extracted for ortho space creation.',
      recordedById: adminUser.id,
    },
    {
      patientId: insertedPatients[3].id,
      toothNumber: 24,
      surface: 'whole',
      condition: 'extracted',
      notes: 'Extracted for ortho space creation.',
      recordedById: adminUser.id,
    },
  ])

  console.log('   ✓ 10 odontogram entries seeded')

  // ── Step 26: Perio chart entries ──────────────────────────────────────────
  console.log('')
  console.log('→ Seeding perio chart entries…')

  const perioExamA = crypto.randomUUID()
  const perioExamB = crypto.randomUUID()
  const perioSites = ['MB', 'B', 'DB', 'ML', 'L', 'DL'] as const

  const perioRows: Array<{
    patientId: string
    examId: string
    toothNumber: number
    site: string
    pocketDepth: number
    recordedById: string
    recordedAt: Date
  }> = []

  for (const toothNumber of [16, 26, 36]) {
    for (const site of perioSites) {
      perioRows.push({
        patientId: insertedPatients[1].id,
        examId: perioExamA,
        toothNumber,
        site,
        pocketDepth: rand(2, 5),
        recordedById: adminUser.id,
        recordedAt: daysAgo(60),
      })
    }
  }

  for (const toothNumber of [46, 47]) {
    for (const site of perioSites) {
      perioRows.push({
        patientId: insertedPatients[10].id,
        examId: perioExamB,
        toothNumber,
        site,
        pocketDepth: rand(1, 4),
        recordedById: adminUser.id,
        recordedAt: daysAgo(25),
      })
    }
  }

  await db.insert(schema.patientPerioEntries).values(perioRows)

  console.log(`   ✓ ${perioRows.length} perio entries seeded (2 exam sessions)`)

  // ── Step 27: Recalls ──────────────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding recalls…')

  await db.insert(schema.recalls).values([
    {
      patientId: insertedPatients[0].id,
      recallReason: '6-month scaling & polishing',
      recallDueDate: daysFromNow(45),
      status: 'pending',
      notes: 'Auto-created after last hygiene visit.',
    },
    {
      patientId: insertedPatients[2].id,
      recallReason: 'Annual checkup',
      recallDueDate: daysFromNow(5),
      status: 'due',
      contactedAt: daysAgo(2),
      contactedById: adminUser.id,
      contactNotes: 'Called patient — will book next week.',
    },
    {
      patientId: insertedPatients[5].id,
      recallReason: '6-month checkup',
      recallDueDate: daysAgo(20),
      status: 'overdue',
      contactedAt: daysAgo(18),
      contactedById: adminUser.id,
      contactNotes: 'Left voicemail; no response yet.',
    },
    {
      patientId: insertedPatients[10].id,
      recallReason: 'Post-crown review (46)',
      recallDueDate: daysAgo(35),
      status: 'completed',
      completedAppointmentId: insertedAppointments.find((a) => a.status === 'completed')?.id ?? null,
      notes: 'Reviewed — crown stable.',
    },
    {
      patientId: insertedPatients[7].id,
      recallReason: 'Ortho consult follow-up',
      recallDueDate: daysAgo(10),
      status: 'dismissed',
      dismissedAt: daysAgo(8),
      dismissedById: adminUser.id,
      dismissReason: 'Patient declined further treatment.',
    },
    {
      patientId: insertedPatients[11].id,
      recallReason: '1-year checkup',
      recallDueDate: daysFromNow(90),
      status: 'pending',
    },
    {
      patientId: insertedPatients[14].id,
      recallReason: 'Extraction site review',
      recallDueDate: daysFromNow(3),
      status: 'due',
    },
  ])

  console.log('   ✓ 7 recalls seeded')

  // ── Step 28: Patient reminders ────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding patient reminders…')

  await db.insert(schema.patientReminders).values([
    {
      patientId: insertedPatients[3].id,
      title: 'Order replacement bracket (14 area)',
      notes: 'Patient reported loose bracket — source new one from Ormco.',
      reminderDate: daysFromNow(2),
      assignedToId: doctorUsers[0]?.id ?? adminUser.id,
      status: 'pending',
      createdById: adminUser.id,
    },
    {
      patientId: insertedPatients[1].id,
      title: 'Confirm insurance pre-auth for crown',
      notes: 'Call Star Health before scheduling 36 crown.',
      reminderDate: daysFromNow(5),
      assignedToId: adminUser.id,
      status: 'pending',
      createdById: adminUser.id,
    },
    {
      patientId: insertedPatients[4].id,
      title: 'Call guardian re: fluoride visit',
      reminderDate: daysAgo(10),
      assignedToId: adminUser.id,
      status: 'completed',
      completedAt: daysAgo(9),
      completedById: adminUser.id,
      completionNotes: 'Spoke with mum — visit booked.',
      createdById: adminUser.id,
    },
    {
      patientId: insertedPatients[19].id,
      title: 'Chase insurance claim reconciliation',
      reminderDate: daysFromNow(7),
      assignedToId: adminUser.id,
      status: 'pending',
      createdById: adminUser.id,
    },
    {
      patientId: insertedPatients[9].id,
      title: 'Send recall SMS — 6-month checkup',
      reminderDate: daysAgo(3),
      status: 'completed',
      completedAt: daysAgo(3),
      completedById: adminUser.id,
      completionNotes: 'SMS sent via batch job.',
      createdById: adminUser.id,
    },
    {
      patientId: insertedPatients[16].id,
      title: 'Follow up on ortho consent upload',
      notes: 'Patient promised to drop it on next visit.',
      reminderDate: daysFromNow(1),
      assignedToId: doctorUsers[0]?.id ?? adminUser.id,
      status: 'pending',
      createdById: adminUser.id,
    },
  ])

  console.log('   ✓ 6 patient reminders seeded')

  // ── Step 30: Fetch all staff (incl. non-doctor staff) ─────────────────────
  console.log('')
  console.log('→ Fetching all staff records…')

  const allStaff = await db.select().from(schema.staff)
  const staffByName = new Map(allStaff.map((s) => [s.fullName, s]))
  const receptionist = staffByName.get('Sarah Adjei') ?? allStaff[0]
  const assistant = staffByName.get('Kwame Boateng') ?? allStaff[0]
  const doctorStaffA = staffRecords[1] ?? staffRecords[0]
  const doctorStaffB = staffRecords[2] ?? staffRecords[1] ?? staffRecords[0]

  console.log(`   ✓ ${allStaff.length} staff records fetched`)

  // ── Step 31: Staff Documents (HR) ─────────────────────────────────────────
  console.log('')
  console.log('→ Seeding staff documents…')

  const insertedStaffDocs = await db
    .insert(schema.staffDocuments)
    .values([
      {
        staffId: doctorStaffA.id,
        title: 'Appointment Letter — Lead Orthodontist',
        description: 'Initial appointment letter on joining Framada.',
        documentType: 'appointment_letter',
        fileUrl: `staff/${doctorStaffA.id}/files/appointment-letter.pdf`,
        uploadedAt: daysAgo(500),
      },
      {
        staffId: doctorStaffA.id,
        title: 'Promotion Letter — Senior Clinician',
        description: 'Promotion to senior clinical lead.',
        documentType: 'promotion_letter',
        fileUrl: `staff/${doctorStaffA.id}/files/promotion-letter.pdf`,
        uploadedAt: daysAgo(120),
      },
      {
        staffId: doctorStaffB.id,
        title: 'Appointment Letter — General Dentist',
        documentType: 'appointment_letter',
        fileUrl: `staff/${doctorStaffB.id}/files/appointment-letter.pdf`,
        uploadedAt: daysAgo(380),
      },
      {
        staffId: receptionist.id,
        title: 'Front Desk Policy Handbook',
        description: 'Standard operating procedures for front desk.',
        documentType: 'policy',
        fileUrl: `staff/${receptionist.id}/files/front-desk-policy.pdf`,
        uploadedAt: daysAgo(60),
      },
      {
        staffId: assistant.id,
        title: 'Internal Memo — Sterilisation Protocol Update',
        documentType: 'memo',
        fileUrl: `staff/${assistant.id}/files/sterilisation-memo.pdf`,
        uploadedAt: daysAgo(15),
      },
    ])
    .returning()

  console.log(`   ✓ ${insertedStaffDocs.length} staff documents seeded`)

  // ── Step 32: Staff Requests ───────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding staff requests…')

  await db.insert(schema.staffRequests).values([
    {
      staffId: receptionist.id,
      requestType: 'leave',
      subType: 'annual_leave',
      description: 'Annual leave for family trip.',
      reason: 'Pre-planned family vacation.',
      startDate: daysFromNow(14),
      endDate: daysFromNow(21),
      urgencyLevel: 'normal',
      status: 'pending',
      submittedAt: daysAgo(2),
    },
    {
      staffId: doctorStaffB.id,
      requestType: 'leave',
      subType: 'sick_leave',
      description: 'Recovering from flu.',
      startDate: daysAgo(5),
      endDate: daysAgo(3),
      urgencyLevel: 'high',
      status: 'approved',
      reviewedById: adminUser.id,
      reviewedAt: daysAgo(4),
      reviewComments: 'Approved. Get well soon.',
      submittedAt: daysAgo(5),
    },
    {
      staffId: assistant.id,
      requestType: 'permit',
      subType: 'early_departure',
      description: 'Early departure for antenatal appointment.',
      startDate: daysAgo(10),
      endDate: daysAgo(10),
      urgencyLevel: 'normal',
      status: 'approved',
      reviewedById: adminUser.id,
      reviewedAt: daysAgo(11),
      reviewComments: 'Approved.',
      submittedAt: daysAgo(12),
    },
    {
      staffId: doctorStaffA.id,
      requestType: 'emergency',
      subType: 'emergency_advance',
      description: 'Emergency salary advance for medical bills.',
      amount: 3500,
      urgencyLevel: 'urgent',
      status: 'approved',
      reviewedById: adminUser.id,
      reviewedAt: daysAgo(20),
      reviewComments: 'Approved; deductions over 3 months.',
      submittedAt: daysAgo(21),
    },
    {
      staffId: receptionist.id,
      requestType: 'permit',
      subType: 'wfh',
      description: 'Work from home for half day.',
      reason: 'Awaiting home delivery.',
      startDate: daysAgo(7),
      endDate: daysAgo(7),
      urgencyLevel: 'low',
      status: 'rejected',
      reviewedById: adminUser.id,
      reviewedAt: daysAgo(7),
      reviewComments: 'Role requires on-site presence.',
      submittedAt: daysAgo(8),
    },
    {
      staffId: assistant.id,
      requestType: 'official_support',
      subType: 'pay_certificate',
      description: 'Request for salary certificate for visa application.',
      urgencyLevel: 'normal',
      status: 'pending',
      submittedAt: daysAgo(1),
    },
  ])

  console.log('   ✓ 6 staff requests seeded')

  // ── Step 33: Performance Scores ───────────────────────────────────────────
  console.log('')
  console.log('→ Seeding performance scores…')

  await db.insert(schema.performanceScores).values([
    {
      staffId: doctorStaffA.id,
      evaluationPeriod: '2026-Q1',
      category: 'technical_skills',
      score: 4.5,
      notes: 'Consistently precise ortho case handling.',
      feedback: 'Keep mentoring junior staff.',
      evaluatedById: adminUser.id,
      evaluatedAt: daysAgo(40),
    },
    {
      staffId: doctorStaffA.id,
      evaluationPeriod: '2026-Q1',
      category: 'patient_satisfaction',
      score: 4.8,
      feedback: 'High patient NPS.',
      evaluatedById: adminUser.id,
      evaluatedAt: daysAgo(40),
    },
    {
      staffId: doctorStaffB.id,
      evaluationPeriod: '2026-Q1',
      category: 'technical_skills',
      score: 4.0,
      notes: 'Solid restorative work.',
      evaluatedById: adminUser.id,
      evaluatedAt: daysAgo(38),
    },
    {
      staffId: doctorStaffB.id,
      evaluationPeriod: '2026-Q1',
      category: 'teamwork',
      score: 4.2,
      feedback: 'Collaborates well with hygienists.',
      evaluatedById: adminUser.id,
      evaluatedAt: daysAgo(38),
    },
    {
      staffId: receptionist.id,
      evaluationPeriod: '2026-Q1',
      category: 'soft_skills',
      score: 4.6,
      feedback: 'Excellent patient communication.',
      evaluatedById: adminUser.id,
      evaluatedAt: daysAgo(35),
    },
    {
      staffId: receptionist.id,
      evaluationPeriod: '2026-Q1',
      category: 'attendance',
      score: 5.0,
      notes: 'Perfect attendance this period.',
      evaluatedById: adminUser.id,
      evaluatedAt: daysAgo(35),
    },
    {
      staffId: assistant.id,
      evaluationPeriod: '2026-03',
      category: 'technical_skills',
      score: 3.8,
      notes: 'Improving on chairside assisting.',
      evaluatedById: adminUser.id,
      evaluatedAt: daysAgo(20),
    },
    {
      staffId: assistant.id,
      evaluationPeriod: '2026-03',
      category: 'attendance',
      score: 4.0,
      evaluatedById: adminUser.id,
      evaluatedAt: daysAgo(20),
    },
    {
      staffId: doctorStaffA.id,
      evaluationPeriod: '2026-03',
      category: 'soft_skills',
      score: 4.3,
      feedback: 'Calm under pressure.',
      evaluatedById: adminUser.id,
      evaluatedAt: daysAgo(18),
    },
  ])

  console.log('   ✓ 9 performance scores seeded')

  // ── Step 34: Staff Memos ──────────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding staff memos…')

  await db.insert(schema.staffMemos).values([
    {
      title: 'Updated Sterilisation Protocol',
      audience: 'Clinical Staff',
      level: 'important',
      content: 'All autoclave cycles must now be logged in the new spore-test register.',
      blocks: [
        { id: 'b1', type: 'section', title: 'Background', content: 'Following the Q1 audit we are tightening sterilisation logging.' },
        { id: 'b2', type: 'divider' },
        { id: 'b3', type: 'section', title: 'Action Required', content: 'Log every autoclave cycle and attach the spore-test strip weekly.' },
      ],
      published: true,
      createdById: adminUser.id,
      publishedAt: daysAgo(12),
    },
    {
      title: 'Public Holiday Schedule — April',
      audience: 'All Staff',
      level: 'info',
      content: 'Clinic will be closed on public holidays. See attached schedule.',
      blocks: [
        { id: 'b1', type: 'section', title: 'Closed Days', content: 'April 18 (Good Friday) and April 21 (Easter Monday).' },
      ],
      published: true,
      createdById: adminUser.id,
      publishedAt: daysAgo(30),
    },
    {
      title: 'New Patient Intake Workflow',
      audience: 'Front Desk',
      level: 'info',
      content: 'Draft of the revised patient intake workflow for review.',
      blocks: [
        { id: 'b1', type: 'section', title: 'Overview', content: 'Digital-first intake with iPad sign-in and e-consent.' },
      ],
      published: false,
      createdById: adminUser.id,
    },
    {
      title: 'Dress Code Reminder',
      audience: 'All Staff',
      level: 'info',
      content: 'Gentle reminder on clinic dress code standards.',
      published: false,
      createdById: adminUser.id,
    },
  ])

  console.log('   ✓ 4 staff memos seeded')

  // ── Step 35: Staff Credentials ────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding staff credentials…')

  await db.insert(schema.staffCredentials).values([
    {
      staffId: doctorStaffA.id,
      credentialType: 'DDS License',
      credentialName: 'Dental Surgeon License',
      issuingBody: 'Ghana Dental Association',
      issueDate: daysAgo(1800),
      expiryDate: daysFromNow(400),
      documentUrl: `staff/${doctorStaffA.id}/credentials/dds-license.pdf`,
      reminderDaysBefore: 60,
      reminderEnabled: true,
      createdById: adminUser.id,
    },
    {
      staffId: doctorStaffA.id,
      credentialType: 'BLS',
      credentialName: 'Basic Life Support Certification',
      issuingBody: 'Red Cross Ghana',
      issueDate: daysAgo(600),
      expiryDate: daysFromNow(30),
      documentUrl: `staff/${doctorStaffA.id}/credentials/bls.pdf`,
      notes: 'Renewal scheduled.',
      reminderDaysBefore: 45,
      reminderEnabled: true,
      createdById: adminUser.id,
    },
    {
      staffId: doctorStaffB.id,
      credentialType: 'DDS License',
      credentialName: 'Dental Surgeon License',
      issuingBody: 'Ghana Dental Association',
      issueDate: daysAgo(1400),
      expiryDate: daysFromNow(700),
      reminderDaysBefore: 60,
      reminderEnabled: true,
      createdById: adminUser.id,
    },
    {
      staffId: doctorStaffB.id,
      credentialType: 'DEA',
      credentialName: 'Controlled Substance Registration',
      issuingBody: 'Food & Drugs Authority',
      issueDate: daysAgo(400),
      expiryDate: daysFromNow(15),
      notes: 'Expires very soon — renew immediately.',
      reminderDaysBefore: 30,
      reminderEnabled: true,
      createdById: adminUser.id,
    },
    {
      staffId: assistant.id,
      credentialType: 'BLS',
      credentialName: 'Basic Life Support Certification',
      issuingBody: 'Red Cross Ghana',
      issueDate: daysAgo(200),
      expiryDate: daysFromNow(530),
      reminderDaysBefore: 60,
      reminderEnabled: true,
      createdById: adminUser.id,
    },
    {
      staffId: receptionist.id,
      credentialType: 'First Aid',
      credentialName: 'Workplace First Aid Certificate',
      issuingBody: 'St John Ambulance Ghana',
      issueDate: daysAgo(300),
      expiryDate: daysFromNow(45),
      reminderDaysBefore: 30,
      reminderEnabled: false,
      createdById: adminUser.id,
    },
  ])

  console.log('   ✓ 6 staff credentials seeded')

  // ── Step 36: Staff Questionnaires ─────────────────────────────────────────
  console.log('')
  console.log('→ Seeding staff questionnaires…')

  const insertedQuestionnaires = await db
    .insert(schema.staffQuestionnaires)
    .values([
      { name: 'Weekly Wellbeing Pulse', active: true, frequency: 'weekly', createdById: adminUser.id },
      { name: 'Annual Engagement Survey 2026', active: true, frequency: 'one-time', createdById: adminUser.id },
    ])
    .returning()

  const weeklyQ = insertedQuestionnaires[0]
  const annualQ = insertedQuestionnaires[1]

  // ── Step 37: Staff Questionnaire Questions ────────────────────────────────
  console.log('')
  console.log('→ Seeding questionnaire questions…')

  const insertedQuestions = await db
    .insert(schema.staffQuestionnaireQuestions)
    .values([
      { questionnaireId: weeklyQ.id, text: 'How supported did you feel by your team this week?', questionType: 'scale', options: [], scale: '1-5', orderIndex: 1 },
      { questionnaireId: weeklyQ.id, text: 'How manageable was your workload this week?', questionType: 'scale', options: [], scale: '1-5', orderIndex: 2 },
      { questionnaireId: weeklyQ.id, text: 'Which area needs the most attention next week?', questionType: 'multichoice', options: ['Patient flow', 'Equipment', 'Team communication', 'Training'], scale: '1-5', orderIndex: 3 },
      { questionnaireId: annualQ.id, text: 'Overall, how satisfied are you working at Framada?', questionType: 'scale', options: [], scale: '1-5', orderIndex: 1 },
      { questionnaireId: annualQ.id, text: 'Which benefit matters most to you?', questionType: 'multichoice', options: ['Health insurance', 'Training budget', 'Flexible hours', 'Bonus'], scale: '1-5', orderIndex: 2 },
    ])
    .returning()

  console.log(`   ✓ ${insertedQuestionnaires.length} questionnaires · ${insertedQuestions.length} questions`)

  // ── Step 38: Staff Questionnaire Responses ────────────────────────────────
  console.log('')
  console.log('→ Seeding questionnaire responses…')

  const weeklyScaleQ1 = insertedQuestions[0]
  const weeklyScaleQ2 = insertedQuestions[1]
  const weeklyChoiceQ = insertedQuestions[2]
  const annualScaleQ = insertedQuestions[3]

  const week1 = daysAgo(21)
  const week2 = daysAgo(14)
  const week3 = daysAgo(7)

  await db.insert(schema.staffQuestionnaireResponses).values([
    { staffId: doctorStaffA.id, questionId: weeklyScaleQ1.id, weekStartDate: week1, score: 4 },
    { staffId: doctorStaffA.id, questionId: weeklyScaleQ1.id, weekStartDate: week2, score: 5 },
    { staffId: doctorStaffA.id, questionId: weeklyScaleQ1.id, weekStartDate: week3, score: 4 },
    { staffId: doctorStaffA.id, questionId: weeklyScaleQ2.id, weekStartDate: week3, score: 3 },
    { staffId: receptionist.id, questionId: weeklyScaleQ1.id, weekStartDate: week2, score: 5 },
    { staffId: receptionist.id, questionId: weeklyScaleQ1.id, weekStartDate: week3, score: 4 },
    { staffId: receptionist.id, questionId: weeklyChoiceQ.id, weekStartDate: week3, score: 0, answer: 'Patient flow' },
    { staffId: assistant.id, questionId: weeklyScaleQ2.id, weekStartDate: week1, score: 3 },
    { staffId: assistant.id, questionId: weeklyScaleQ2.id, weekStartDate: week3, score: 4 },
    { staffId: assistant.id, questionId: annualScaleQ.id, weekStartDate: daysAgo(60), score: 4 },
  ])

  console.log('   ✓ 10 questionnaire responses seeded')

  // ── Step 39: Training Materials ───────────────────────────────────────────
  console.log('')
  console.log('→ Seeding training materials…')

  const insertedTraining = await db
    .insert(schema.trainingMaterials)
    .values([
      {
        title: 'Infection Control Fundamentals',
        description: 'Mandatory onboarding module on infection control.',
        materialType: 'document',
        contentUrl: 'staff/training/infection-control.pdf',
        isMandatory: true,
        deadline: daysFromNow(30),
        blocks: [
          { id: 'b1', type: 'section', title: 'Introduction', content: 'Why infection control matters in dental practice.' },
          { id: 'b2', type: 'divider' },
          { id: 'b3', type: 'section', title: 'PPE Standards', content: 'Correct donning and doffing procedures.' },
        ],
        quizQuestions: [],
        assignedTo: ['all'],
        audience: 'All Staff',
        level: 'important',
        published: true,
        uploadedById: adminUser.id,
        publishedAt: daysAgo(90),
      },
      {
        title: 'Chairside Assisting — Video Series',
        description: 'Four-part video series on efficient chairside assisting.',
        materialType: 'video',
        externalUrl: 'https://videos.framada.app/chairside-series',
        isMandatory: false,
        blocks: [
          { id: 'b1', type: 'section', title: 'Module Overview', content: 'Four 15-minute videos covering suction, transfer, and anticipation.' },
        ],
        quizQuestions: [],
        assignedTo: [assistant.id],
        audience: 'Clinical Assistants',
        level: 'info',
        published: true,
        uploadedById: adminUser.id,
        publishedAt: daysAgo(45),
      },
      {
        title: 'Patient Communication Quiz',
        description: 'Quick 10-question quiz on patient communication best practices.',
        materialType: 'quiz',
        isMandatory: true,
        deadline: daysFromNow(14),
        passingScore: 70,
        quizTimer: 15,
        blocks: [
          { id: 'b1', type: 'section', title: 'Instructions', content: 'Answer all questions. 70% required to pass.' },
        ],
        quizQuestions: [
          { id: 'q1', text: 'What is the first step when greeting a new patient?', questionType: 'multichoice', options: ['Smile and introduce yourself', 'Ask for their insurance card', 'Hand them paperwork', 'Call the doctor'], correctAnswerIndex: 0, orderIndex: 1 },
          { id: 'q2', text: 'When a patient expresses anxiety, you should…', questionType: 'multichoice', options: ['Dismiss their concerns', 'Acknowledge and explain the procedure', 'Call the doctor immediately', 'Reschedule them'], correctAnswerIndex: 1, orderIndex: 2 },
          { id: 'q3', text: 'Rate the importance of active listening.', questionType: 'scale', options: [], correctAnswerIndex: 5, orderIndex: 3 },
        ],
        assignedTo: ['all'],
        audience: 'All Staff',
        level: 'important',
        published: true,
        uploadedById: adminUser.id,
        publishedAt: daysAgo(10),
      },
      {
        title: 'Orthodontic Appliance Handling',
        description: 'Advanced module on handling ortho appliances.',
        materialType: 'module',
        contentUrl: 'staff/training/ortho-appliances.pdf',
        isMandatory: false,
        blocks: [
          { id: 'b1', type: 'section', title: 'Bracket Placement', content: 'Best practices for bracket placement precision.' },
          { id: 'b2', type: 'divider' },
          { id: 'b3', type: 'section', title: 'Wire Sequencing', content: 'Recommended arch-wire progression.' },
        ],
        quizQuestions: [],
        assignedTo: [doctorStaffA.id, doctorStaffB.id],
        audience: 'Doctors',
        level: 'info',
        published: true,
        uploadedById: adminUser.id,
        publishedAt: daysAgo(60),
      },
      {
        title: 'Front Desk SOP (Draft)',
        description: 'Draft SOP document for the front desk team.',
        materialType: 'document',
        contentUrl: 'staff/training/front-desk-sop-draft.pdf',
        isMandatory: false,
        blocks: [
          { id: 'b1', type: 'section', title: 'Draft Notice', content: 'This document is still in draft — feedback welcome.' },
        ],
        quizQuestions: [],
        assignedTo: [receptionist.id],
        audience: 'Front Desk',
        level: 'info',
        published: false,
        uploadedById: adminUser.id,
      },
    ])
    .returning()

  console.log(`   ✓ ${insertedTraining.length} training materials seeded`)

  // ── Step 40: Staff Training Progress ──────────────────────────────────────
  console.log('')
  console.log('→ Seeding staff training progress…')

  const trainingInfection = insertedTraining[0]
  const trainingChairside = insertedTraining[1]
  const trainingQuiz = insertedTraining[2]
  const trainingOrtho = insertedTraining[3]

  await db.insert(schema.staffTrainingProgress).values([
    { staffId: doctorStaffA.id, trainingId: trainingInfection.id, status: 'completed', progressPercent: 100, startedAt: daysAgo(80), completedAt: daysAgo(75), certificateIssued: true },
    { staffId: doctorStaffA.id, trainingId: trainingOrtho.id, status: 'completed', progressPercent: 100, startedAt: daysAgo(55), completedAt: daysAgo(50), certificateIssued: true },
    { staffId: doctorStaffA.id, trainingId: trainingQuiz.id, status: 'in_progress', progressPercent: 40, startedAt: daysAgo(3) },
    { staffId: doctorStaffB.id, trainingId: trainingInfection.id, status: 'completed', progressPercent: 100, startedAt: daysAgo(78), completedAt: daysAgo(72), certificateIssued: true },
    { staffId: doctorStaffB.id, trainingId: trainingOrtho.id, status: 'in_progress', progressPercent: 60, startedAt: daysAgo(40) },
    { staffId: doctorStaffB.id, trainingId: trainingQuiz.id, status: 'not_started', progressPercent: 0 },
    { staffId: receptionist.id, trainingId: trainingInfection.id, status: 'completed', progressPercent: 100, startedAt: daysAgo(85), completedAt: daysAgo(80), certificateIssued: true },
    { staffId: receptionist.id, trainingId: trainingQuiz.id, status: 'completed', progressPercent: 100, score: 90, startedAt: daysAgo(8), completedAt: daysAgo(7), certificateIssued: true },
    { staffId: assistant.id, trainingId: trainingChairside.id, status: 'in_progress', progressPercent: 75, startedAt: daysAgo(30) },
    { staffId: assistant.id, trainingId: trainingInfection.id, status: 'not_started', progressPercent: 0 },
  ])

  console.log('   ✓ 10 training progress records seeded')

  // ── Step 41: Document Access Logs ─────────────────────────────────────────
  console.log('')
  console.log('→ Seeding document access logs…')

  await db.insert(schema.documentAccessLogs).values([
    { documentId: insertedStaffDocs[0].id, staffId: doctorStaffA.id, action: 'viewed', accessedAt: daysAgo(30) },
    { documentId: insertedStaffDocs[0].id, staffId: doctorStaffA.id, action: 'downloaded', accessedAt: daysAgo(29) },
    { documentId: insertedStaffDocs[1].id, staffId: doctorStaffA.id, action: 'viewed', accessedAt: daysAgo(10) },
    { documentId: insertedStaffDocs[3].id, staffId: receptionist.id, action: 'downloaded', accessedAt: daysAgo(5) },
    { documentId: insertedStaffDocs[4].id, staffId: assistant.id, action: 'viewed', accessedAt: daysAgo(2) },
  ])

  console.log('   ✓ 5 document access logs seeded')

  // ── Step 42: Scheduled reminders ──────────────────────────────────────────
  console.log('')
  console.log('→ Seeding scheduled reminders…')

  await db.insert(schema.scheduledReminders).values([
    {
      name: '48-hour appointment reminder',
      type: 'appointment_pre',
      triggerType: 'before_appointment',
      triggerOffsetHours: 48,
      messageTemplate:
        'Hi {PatientName}, this is a reminder of your appointment at Framada Dental on {AppointmentDate}. Reply CANCEL to reschedule.',
      isActive: true,
      lastRunAt: daysAgo(1),
      createdById: adminUser.id,
    },
    {
      name: '24-hour appointment reminder',
      type: 'appointment_pre',
      triggerType: 'before_appointment',
      triggerOffsetHours: 24,
      messageTemplate:
        'Hi {PatientName}, see you tomorrow at Framada Dental for your appointment on {AppointmentDate}. Call 0302000000 if you need to reschedule.',
      isActive: true,
      lastRunAt: daysAgo(1),
      createdById: adminUser.id,
    },
    {
      name: 'Birthday greeting',
      type: 'birthday',
      triggerType: 'recurring',
      cronExpression: '0 9 * * *',
      messageTemplate:
        'Happy birthday, {PatientName}! The Framada Dental family wishes you a wonderful year ahead.',
      isActive: true,
      lastRunAt: daysAgo(2),
      createdById: adminUser.id,
    },
    {
      name: 'Monthly payment due notice',
      type: 'payment_due',
      triggerType: 'recurring',
      cronExpression: '0 10 1 * *',
      messageTemplate:
        'Hi {PatientName}, a friendly reminder that an installment on your payment plan is now due. Patient ID: {PatientID}.',
      isActive: true,
      createdById: adminUser.id,
    },
  ])

  console.log('   ✓ 4 scheduled reminders seeded')

  // ── Step 43: SMS messages ─────────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding SMS messages…')

  const firstName = (name: string) => name.split(' ')[0]

  await db.insert(schema.smsMessages).values([
    {
      messageId: 'hubtel-msg-00001',
      recipient: insertedPatients[0].phone ?? '0244000000',
      content: `Hi ${firstName(insertedPatients[0].name)}, reminder of your appointment tomorrow at Framada Dental.`,
      type: 'followup',
      status: 'delivered',
      patientId: insertedPatients[0].id,
      from: 'Framada',
      sentById: adminUser.id,
      sentAt: daysAgo(3),
      deliveredAt: daysAgo(3),
    },
    {
      messageId: 'hubtel-msg-00002',
      recipient: insertedPatients[1].phone ?? '0244000000',
      content: `Happy birthday, ${firstName(insertedPatients[1].name)}! From everyone at Framada Dental.`,
      type: 'birthday',
      status: 'delivered',
      patientId: insertedPatients[1].id,
      from: 'Framada',
      sentById: adminUser.id,
      sentAt: daysAgo(5),
      deliveredAt: daysAgo(5),
    },
    {
      batchId: 'hubtel-batch-00010',
      recipient: insertedPatients[2].phone ?? '0244000000',
      content: 'Framada Dental is offering free cleaning consultations this Saturday. Book now at framada.app.',
      type: 'bulk',
      status: 'sent',
      patientId: insertedPatients[2].id,
      from: 'Framada',
      sentById: adminUser.id,
      sentAt: daysAgo(7),
    },
    {
      batchId: 'hubtel-batch-00010',
      recipient: insertedPatients[3].phone ?? '0244000000',
      content: 'Framada Dental is offering free cleaning consultations this Saturday. Book now at framada.app.',
      type: 'bulk',
      status: 'delivered',
      patientId: insertedPatients[3].id,
      from: 'Framada',
      sentById: adminUser.id,
      sentAt: daysAgo(7),
      deliveredAt: daysAgo(7),
    },
    {
      batchId: 'hubtel-batch-00010',
      recipient: insertedPatients[4].phone ?? '0244000000',
      content: 'Framada Dental is offering free cleaning consultations this Saturday. Book now at framada.app.',
      type: 'bulk',
      status: 'failed',
      patientId: insertedPatients[4].id,
      from: 'Framada',
      sentById: adminUser.id,
      sentAt: daysAgo(7),
    },
    {
      messageId: 'hubtel-msg-00003',
      recipient: insertedPatients[5].phone ?? '0244000000',
      content: `Hi ${firstName(insertedPatients[5].name)}, please call 0302000000 to schedule your 6-month recall.`,
      type: 'followup',
      status: 'delivered',
      patientId: insertedPatients[5].id,
      from: 'Framada',
      sentById: adminUser.id,
      sentAt: daysAgo(10),
      deliveredAt: daysAgo(10),
    },
    {
      messageId: 'hubtel-msg-00004',
      recipient: insertedPatients[6].phone ?? '0244000000',
      content: `Happy birthday, ${firstName(insertedPatients[6].name)}! Enjoy 10% off any treatment this month.`,
      type: 'birthday',
      status: 'sent',
      patientId: insertedPatients[6].id,
      from: 'Framada',
      sentById: adminUser.id,
      sentAt: daysAgo(2),
    },
    {
      messageId: 'hubtel-msg-00005',
      recipient: insertedPatients[7].phone ?? '0244000000',
      content: `Hi ${firstName(insertedPatients[7].name)}, a payment of GHS 350 was received. Thank you!`,
      type: 'followup',
      status: 'pending',
      patientId: insertedPatients[7].id,
      from: 'Framada',
      sentById: adminUser.id,
      sentAt: daysAgo(1),
    },
  ])

  console.log('   ✓ 8 SMS messages seeded')

  // ── Step 44: Email messages ───────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding email messages…')

  await db.insert(schema.emailMessages).values([
    {
      resendId: 'resend-0001',
      recipient: insertedPatients[0].email ?? 'patient0@example.com',
      subject: 'Your Framada Dental appointment summary',
      content: '<p>Hi there,</p><p>Thanks for visiting Framada Dental. Attached is the summary of your appointment.</p>',
      type: 'followup',
      status: 'sent',
      patientId: insertedPatients[0].id,
      sentById: adminUser.id,
      sentAt: daysAgo(4),
    },
    {
      resendId: 'resend-0002',
      recipient: insertedPatients[1].email ?? 'patient1@example.com',
      subject: `Happy birthday, ${firstName(insertedPatients[1].name)}!`,
      content: '<p>Wishing you a wonderful year from all of us at Framada Dental. Enjoy a complimentary cleaning on your next visit.</p>',
      type: 'birthday',
      status: 'sent',
      patientId: insertedPatients[1].id,
      sentById: adminUser.id,
      sentAt: daysAgo(6),
    },
    {
      resendId: 'resend-0003',
      recipient: insertedPatients[2].email ?? 'patient2@example.com',
      subject: 'April newsletter — keep your smile bright',
      content: '<p>Monthly tips on maintaining oral health, new services, and special offers.</p>',
      type: 'bulk',
      status: 'sent',
      patientId: insertedPatients[2].id,
      sentById: adminUser.id,
      sentAt: daysAgo(9),
    },
    {
      resendId: 'resend-0004',
      recipient: insertedPatients[3].email ?? 'patient3@example.com',
      subject: 'April newsletter — keep your smile bright',
      content: '<p>Monthly tips on maintaining oral health, new services, and special offers.</p>',
      type: 'bulk',
      status: 'failed',
      patientId: insertedPatients[3].id,
      sentById: adminUser.id,
      sentAt: daysAgo(9),
    },
    {
      recipient: insertedPatients[4].email ?? 'patient4@example.com',
      subject: 'Consent form for your upcoming procedure',
      content: '<p>Please review and sign the attached consent form before your next visit.</p>',
      type: 'custom',
      status: 'sent',
      patientId: insertedPatients[4].id,
      sentById: adminUser.id,
      sentAt: daysAgo(2),
    },
  ])

  console.log('   ✓ 5 email messages seeded')

  // ── Step 45: Staff-to-staff messages ──────────────────────────────────────
  console.log('')
  console.log('→ Seeding staff-to-staff messages…')

  const otherUser = existingUsers.find((u) => u.id !== adminUser.id)
  if (!otherUser) {
    console.log('   ⚠  Fewer than 2 users — skipping staff messages section')
  } else {
    await db.insert(schema.messages).values([
      { senderId: adminUser.id, receiverId: otherUser.id, content: 'Morning! Please review the updated appointment schedule for this week.', read: true, createdAt: daysAgo(5) },
      { senderId: otherUser.id, receiverId: adminUser.id, content: 'Reviewed — all looks good. I added a note for the 10am patient tomorrow.', read: true, createdAt: daysAgo(5) },
      { senderId: adminUser.id, receiverId: otherUser.id, content: 'Can you confirm the lab case pickup for Mrs. Boateng?', read: true, createdAt: daysAgo(3) },
      { senderId: otherUser.id, receiverId: adminUser.id, content: 'Confirmed — picked up this morning. Patient is scheduled for Friday insertion.', read: false, createdAt: daysAgo(2) },
      { senderId: adminUser.id, receiverId: otherUser.id, content: 'Please restock the composite tray before lunch. Running low.', read: false, createdAt: daysAgo(1) },
    ])
    console.log('   ✓ 5 staff messages seeded')
  }

  // ── Step 46: Compliance documents ─────────────────────────────────────────
  console.log('')
  console.log('→ Seeding compliance documents…')

  await db.insert(schema.complianceDocuments).values([
    {
      documentName: 'Dental Council Practice License',
      category: 'health',
      documentUrl: 'https://placehold.co/compliance/dental-council-license.pdf',
      dateIssued: daysAgo(300),
      dateExpired: daysFromNow(65),
      reminderEnabled: true,
      reminderMonthsBefore: 3,
      reminderPhones: ['0302000000', adminUser.phone ?? '0244000000'],
      reminderMessage: 'Dental Council practice license expires in 3 months. Renew soon.',
      createdById: adminUser.id,
    },
    {
      documentName: 'GRA Tax Clearance Certificate',
      category: 'finance',
      documentUrl: 'https://placehold.co/compliance/gra-tax-clearance.pdf',
      dateIssued: daysAgo(180),
      dateExpired: daysFromNow(185),
      reminderEnabled: true,
      reminderMonthsBefore: 2,
      reminderPhones: [adminUser.phone ?? '0244000000'],
      reminderMessage: 'GRA tax clearance certificate renewal is approaching.',
      createdById: adminUser.id,
    },
    {
      documentName: 'Business Operating Permit (AMA)',
      category: 'operations',
      documentUrl: 'https://placehold.co/compliance/ama-operating-permit.pdf',
      dateIssued: daysAgo(90),
      dateExpired: daysFromNow(275),
      reminderEnabled: false,
      createdById: adminUser.id,
    },
    {
      documentName: 'Data Protection Commission Registration',
      category: 'data',
      documentUrl: 'https://placehold.co/compliance/dpc-registration.pdf',
      dateIssued: daysAgo(220),
      dateExpired: daysFromNow(145),
      reminderEnabled: true,
      reminderMonthsBefore: 3,
      reminderPhones: [adminUser.phone ?? '0244000000'],
      reminderMessage: 'DPC registration renewal due soon.',
      createdById: adminUser.id,
    },
    {
      documentName: 'Fire Safety Certificate (GNFS)',
      category: 'fire',
      documentUrl: 'https://placehold.co/compliance/gnfs-fire-safety.pdf',
      dateIssued: daysAgo(340),
      dateExpired: daysFromNow(25),
      reminderEnabled: true,
      reminderMonthsBefore: 1,
      reminderPhones: ['0302000000'],
      reminderMessage: 'Fire safety certificate expires within a month — schedule inspection.',
      createdById: adminUser.id,
    },
  ])

  console.log('   ✓ 5 compliance documents seeded')

  // ── Step 47: Tax calculations ─────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding tax calculations…')

  const taxRates = { vat: 0.15, nhil: 0.025, getfund: 0.025 }
  const computeTax = (base: number) => {
    const nhilAmount = base * taxRates.nhil
    const getfundAmount = base * taxRates.getfund
    const levyBase = base + nhilAmount + getfundAmount
    const vatAmount = levyBase * taxRates.vat
    const totalTax = nhilAmount + getfundAmount + vatAmount
    const grossTotal = base + totalTax
    const effectiveRate = totalTax / base
    return { nhilAmount, getfundAmount, levyBase, vatAmount, totalTax, grossTotal, effectiveRate }
  }

  type TaxInput = {
    sourceType: 'invoice' | 'payment' | 'standalone'
    baseAmount: number
    patientIdx: number | null
    notes?: string
  }
  const taxInputs: TaxInput[] = [
    { sourceType: 'invoice', baseAmount: 450, patientIdx: 0, notes: 'PFM crown treatment invoice' },
    { sourceType: 'invoice', baseAmount: 1200, patientIdx: 1, notes: '3-unit bridge invoice' },
    { sourceType: 'payment', baseAmount: 650, patientIdx: 2, notes: 'Zirconia crown payment' },
    { sourceType: 'payment', baseAmount: 350, patientIdx: 3, notes: 'Nightguard payment' },
    { sourceType: 'standalone', baseAmount: 200, patientIdx: null, notes: 'Standalone fee calc' },
    { sourceType: 'invoice', baseAmount: 800, patientIdx: 4, notes: 'Partial denture invoice' },
    { sourceType: 'payment', baseAmount: 180, patientIdx: 5, notes: 'Clear retainer payment' },
  ]

  await db.insert(schema.taxCalculations).values(
    taxInputs.map((t) => {
      const c = computeTax(t.baseAmount)
      return {
        sourceType: t.sourceType,
        patientId: t.patientIdx !== null ? insertedPatients[t.patientIdx].id : null,
        baseAmount: t.baseAmount,
        applyVAT: true,
        applyNHIL: true,
        applyGETFund: true,
        nhilAmount: c.nhilAmount,
        getfundAmount: c.getfundAmount,
        levyBase: c.levyBase,
        vatAmount: c.vatAmount,
        totalTax: c.totalTax,
        grossTotal: c.grossTotal,
        effectiveRate: c.effectiveRate,
        ratesSnapshot: taxRates,
        notes: t.notes,
        createdById: adminUser.id,
      }
    })
  )

  console.log(`   ✓ ${taxInputs.length} tax calculations seeded`)

  // ── Step 48: Audit logs ───────────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding audit logs…')

  await db.insert(schema.auditLogs).values([
    {
      userId: adminUser.id,
      action: 'create',
      module: 'patients',
      entityId: insertedPatients[0].id,
      entityName: insertedPatients[0].name,
      afterJson: { name: insertedPatients[0].name, phone: insertedPatients[0].phone },
      ipAddress: '102.176.12.4',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0',
      createdAt: daysAgo(18),
    },
    {
      userId: adminUser.id,
      action: 'update',
      module: 'patients',
      entityId: insertedPatients[1].id,
      entityName: insertedPatients[1].name,
      beforeJson: { phone: '0244000001' },
      afterJson: { phone: insertedPatients[1].phone },
      changedFields: ['phone'],
      reason: 'Patient requested number update.',
      ipAddress: '102.176.12.4',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0',
      createdAt: daysAgo(14),
    },
    {
      userId: adminUser.id,
      action: 'create',
      module: 'appointments',
      entityId: insertedAppointments[0]?.id,
      entityName: 'Routine cleaning appointment',
      afterJson: { status: 'scheduled' },
      ipAddress: '102.176.12.4',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0',
      createdAt: daysAgo(12),
    },
    {
      userId: adminUser.id,
      action: 'update',
      module: 'appointments',
      entityId: insertedAppointments[1]?.id,
      entityName: 'Filling appointment',
      beforeJson: { status: 'scheduled' },
      afterJson: { status: 'completed' },
      changedFields: ['status'],
      ipAddress: '102.176.12.4',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/17',
      createdAt: daysAgo(10),
    },
    {
      userId: adminUser.id,
      action: 'create',
      module: 'payments',
      entityName: 'Payment GHS 650',
      afterJson: { amount: 650, method: 'momo' },
      ipAddress: '102.176.12.4',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0',
      createdAt: daysAgo(8),
    },
    {
      userId: adminUser.id,
      action: 'update',
      module: 'payments',
      entityName: 'Payment GHS 450',
      beforeJson: { amount: 400 },
      afterJson: { amount: 450 },
      changedFields: ['amount'],
      reason: 'Correcting charge after reconciliation.',
      ipAddress: '102.176.12.4',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0',
      createdAt: daysAgo(7),
    },
    {
      userId: adminUser.id,
      action: 'delete',
      module: 'appointments',
      entityName: 'Cancelled consultation slot',
      beforeJson: { status: 'scheduled', patientName: 'Test Patient' },
      reason: 'Patient double-booked.',
      ipAddress: '102.176.12.4',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0',
      createdAt: daysAgo(6),
    },
    {
      userId: adminUser.id,
      action: 'create',
      module: 'staff',
      entityId: staffRecords[0]?.id,
      entityName: 'New staff record',
      afterJson: { role: 'receptionist' },
      ipAddress: '102.176.12.4',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0',
      createdAt: daysAgo(20),
    },
    {
      userId: adminUser.id,
      action: 'update',
      module: 'staff',
      entityId: staffRecords[0]?.id,
      entityName: 'Staff record update',
      beforeJson: { jobTitle: 'Receptionist' },
      afterJson: { jobTitle: 'Senior Receptionist' },
      changedFields: ['jobTitle'],
      ipAddress: '102.176.12.4',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0',
      createdAt: daysAgo(4),
    },
    {
      userId: adminUser.id,
      action: 'login',
      module: 'auth',
      entityName: 'Admin login',
      ipAddress: '102.176.12.4',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0',
      createdAt: daysAgo(1),
    },
    {
      userId: adminUser.id,
      action: 'logout',
      module: 'auth',
      entityName: 'Admin logout',
      ipAddress: '102.176.12.4',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0',
      createdAt: daysAgo(1),
    },
    {
      userId: adminUser.id,
      action: 'delete',
      module: 'patients',
      entityName: 'Duplicate patient record',
      beforeJson: { firstName: 'Dup', lastName: 'Licate' },
      reason: 'Duplicate of existing patient record.',
      ipAddress: '102.176.12.4',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0',
      createdAt: daysAgo(2),
    },
  ])

  console.log('   ✓ 12 audit log entries seeded')

  // ── Step 49: Daily reports ────────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding daily reports…')

  const supplierIdForJson = insertedSuppliers[0].id

  const insertedDailyReports = await db
    .insert(schema.dailyReports)
    .values([
      {
        reportDate: daysAgo(7),
        checkedInCount: 12,
        newPatientsCount: 3,
        totalPayments: 2450,
        totalExpenses: 620,
        balances: [
          { method: 'cash', amount: 320 },
          { method: 'momo', amount: 1430 },
          { method: 'card', amount: 700 },
        ],
        inventoryUsed: [
          { id: supplierIdForJson, quantity: 4 },
          { id: supplierIdForJson, quantity: 2 },
        ],
        productsSold: [{ id: supplierIdForJson, quantity: 1 }],
        submittedById: adminUser.id,
        createdAt: daysAgo(7),
      },
      {
        reportDate: daysAgo(5),
        checkedInCount: 9,
        newPatientsCount: 1,
        totalPayments: 1780,
        totalExpenses: 2100,
        balances: [
          { method: 'cash', amount: 280 },
          { method: 'momo', amount: 1000 },
          { method: 'card', amount: 500 },
        ],
        inventoryUsed: [{ id: supplierIdForJson, quantity: 3 }],
        productsSold: [],
        additionalNote: 'Expenses exceeded payments due to bulk PPE restock.',
        submittedById: adminUser.id,
        createdAt: daysAgo(5),
      },
      {
        reportDate: daysAgo(3),
        checkedInCount: 15,
        newPatientsCount: 4,
        totalPayments: 3260,
        totalExpenses: 480,
        balances: [
          { method: 'cash', amount: 560 },
          { method: 'momo', amount: 1900 },
          { method: 'card', amount: 800 },
        ],
        inventoryUsed: [
          { id: supplierIdForJson, quantity: 6 },
          { id: supplierIdForJson, quantity: 1 },
        ],
        productsSold: [{ id: supplierIdForJson, quantity: 2 }],
        submittedById: adminUser.id,
        createdAt: daysAgo(3),
      },
      {
        reportDate: daysAgo(1),
        checkedInCount: 11,
        newPatientsCount: 2,
        totalPayments: 2100,
        totalExpenses: 390,
        balances: [
          { method: 'cash', amount: 420 },
          { method: 'momo', amount: 1180 },
          { method: 'card', amount: 500 },
        ],
        inventoryUsed: [{ id: supplierIdForJson, quantity: 2 }],
        productsSold: [{ id: supplierIdForJson, quantity: 1 }],
        submittedById: adminUser.id,
        createdAt: daysAgo(1),
      },
    ])
    .returning()

  console.log(`   ✓ ${insertedDailyReports.length} daily reports seeded`)

  // ── Step 50: Sales ────────────────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding sales…')

  const allProducts = await db.select().from(schema.products).limit(10)

  if (allProducts.length === 0) {
    console.log('   ⚠  No products found — skipping sales section')
  } else {
    const pickProduct = (i: number) => allProducts[Math.min(i, allProducts.length - 1)]
    await db.insert(schema.sales).values([
      { productId: pickProduct(0).id, quantity: 2, unitPrice: 45, costPrice: 25, totalAmount: 90, profit: 40, saleDate: daysAgo(7), status: 'submitted', dailyReportId: insertedDailyReports[0].id, createdAt: daysAgo(7) },
      { productId: pickProduct(1).id, quantity: 1, unitPrice: 120, costPrice: 70, totalAmount: 120, profit: 50, saleDate: daysAgo(5), status: 'submitted', dailyReportId: insertedDailyReports[1].id, createdAt: daysAgo(5) },
      { productId: pickProduct(2).id, quantity: 3, unitPrice: 30, costPrice: 18, totalAmount: 90, profit: 36, saleDate: daysAgo(3), status: 'submitted', dailyReportId: insertedDailyReports[2].id, createdAt: daysAgo(3) },
      { productId: pickProduct(3).id, quantity: 1, unitPrice: 85, costPrice: 55, totalAmount: 85, profit: 30, saleDate: daysAgo(1), status: 'submitted', dailyReportId: insertedDailyReports[3].id, createdAt: daysAgo(1) },
      { productId: pickProduct(4).id, quantity: 2, unitPrice: 60, costPrice: 40, totalAmount: 120, profit: 40, saleDate: new Date(), status: 'draft', createdAt: new Date() },
      { productId: pickProduct(0).id, quantity: 4, unitPrice: 45, costPrice: 25, totalAmount: 180, profit: 80, saleDate: new Date(), status: 'draft', createdAt: new Date() },
    ])
    console.log('   ✓ 6 sales seeded')
  }

  // ── Step 51: Wallet transactions ──────────────────────────────────────────
  console.log('')
  console.log('→ Seeding wallet transactions…')

  const allWallets = await db.select().from(schema.patientWallets).limit(5)

  if (allWallets.length === 0) {
    console.log('   ⚠  No patient wallets found — skipping wallet transactions section')
  } else {
    type WalletTxInsert = typeof schema.walletTransactions.$inferInsert
    const walletTxns: WalletTxInsert[] = []

    if (allWallets[0]) {
      walletTxns.push(
        { walletId: allWallets[0].id, patientId: allWallets[0].patientId, type: 'credit', amount: 200, sourceType: 'payment', description: 'Initial payment credit', balanceBefore: 0, balanceAfter: 200, createdById: adminUser.id, createdAt: daysAgo(20) },
        { walletId: allWallets[0].id, patientId: allWallets[0].patientId, type: 'debit', amount: 50, sourceType: 'invoice_charge', description: 'Consultation invoice charge', balanceBefore: 200, balanceAfter: 150, createdById: adminUser.id, createdAt: daysAgo(15) },
        { walletId: allWallets[0].id, patientId: allWallets[0].patientId, type: 'credit', amount: 100, sourceType: 'payment', description: 'Top-up payment', balanceBefore: 150, balanceAfter: 250, createdById: adminUser.id, createdAt: daysAgo(8) }
      )
    }
    if (allWallets[1]) {
      walletTxns.push(
        { walletId: allWallets[1].id, patientId: allWallets[1].patientId, type: 'credit', amount: 500, sourceType: 'payment', description: 'Down-payment on treatment plan', balanceBefore: 0, balanceAfter: 500, createdById: adminUser.id, createdAt: daysAgo(12) },
        { walletId: allWallets[1].id, patientId: allWallets[1].patientId, type: 'debit', amount: 300, sourceType: 'invoice_charge', description: 'Crown installment charge', balanceBefore: 500, balanceAfter: 200, createdById: adminUser.id, createdAt: daysAgo(6) }
      )
    }
    if (allWallets[2]) {
      walletTxns.push(
        { walletId: allWallets[2].id, patientId: allWallets[2].patientId, type: 'credit', amount: 150, sourceType: 'payment', description: 'Overpayment credit held in wallet', balanceBefore: 0, balanceAfter: 150, createdById: adminUser.id, createdAt: daysAgo(4) }
      )
    }

    await db.insert(schema.walletTransactions).values(walletTxns)
    console.log(`   ✓ ${walletTxns.length} wallet transactions seeded`)
  }

  // ── Step 52: Sync log ─────────────────────────────────────────────────────
  console.log('')
  console.log('→ Seeding sync log entries…')

  await db.insert(schema.syncLog).values([
    { entityType: 'medical_record', entityId: insertedPatients[0].id, syncMode: 'auto', destination: 'pwa-sync-hash-0xA1B2', success: true, syncedAt: daysAgo(6) },
    { entityType: 'payment', entityId: insertedPatients[1].id, syncMode: 'manual', destination: 'finance-sync-hash-0xC3D4', success: true, syncedAt: daysAgo(4) },
    { entityType: 'medical_record', entityId: insertedPatients[2].id, syncMode: 'auto', destination: 'pwa-sync-hash-0xE5F6', success: false, errorMessage: 'Timeout contacting destination endpoint after 30s', syncedAt: daysAgo(3) },
    { entityType: 'payment', entityId: insertedPatients[3].id, syncMode: 'auto', destination: 'finance-sync-hash-0x7890', success: true, syncedAt: daysAgo(2) },
    { entityType: 'medical_record', entityId: insertedPatients[4].id, syncMode: 'manual', destination: 'pwa-sync-hash-0x1234', success: false, errorMessage: 'Validation error: missing required field `bloodType`', syncedAt: daysAgo(1) },
    { entityType: 'payment', entityId: insertedPatients[5].id, syncMode: 'auto', destination: 'finance-sync-hash-0x5678', success: true, syncedAt: daysAgo(1) },
  ])

  console.log('   ✓ 6 sync log entries seeded')

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('✓  Staging database seeded successfully')
  console.log('')
  console.log('  Patients       :', insertedPatients.length)
  console.log('  Appointments   :', insertedAppointments.length)
  console.log('  Medical Records:', completedAppts.length)
  console.log('  Payment Plans  :', planDefs.length)
  console.log('  Invoices       :', invoiceCounter - 1)
  console.log('  Payments       :', totalPaymentsSeeded)
  console.log('  Expenses       :', expenseDefs.length)
  console.log('  Inventory items: 14')
  console.log('  Products       : 6')
  console.log('  Website bookings: 5')
  console.log('')
  console.log('  Auth tables preserved — your admin login is unchanged.')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

seed().catch((err) => {
  console.error('✖  Seed failed:', err)
  process.exit(1)
})
