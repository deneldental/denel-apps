import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'csv-parse/sync'
import { db } from '../lib/db'
import { patients, paymentPlans } from '../lib/db/schema'

async function importPatientsNonZero() {
  const csvFilePath = path.join(process.cwd(), 'patients_non_zero_balance.csv')
  const fileContent = fs.readFileSync(csvFilePath, 'utf-8')

  const records: Array<Record<string, string>> = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  })

  console.log(`Found ${records.length} records to process.`)

  // Get the last patient ID to continue numbering
  const lastPatient = await db.query.patients.findFirst({
    orderBy: (patients, { desc }) => [desc(patients.patientId)],
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
        Balance: balanceStr,
      } = row

      const name = fullName || `${row['First Name']} ${row.Surname}`
      if (!name) {
        console.warn(`Skipping row with no name: ${JSON.stringify(row)}`)
        continue
      }

      // Calculate approximate DOB
      const age = parseInt(ageStr, 10) || 0
      const now = new Date()
      const birthYear = now.getFullYear() - age
      const dob = new Date(Date.UTC(birthYear, 0, 1))

      const isChild = age < 18

      // Parse Gender
      let gender = genderStr?.toLowerCase()
      if (gender !== 'male' && gender !== 'female') {
        gender = 'other'
      }

      // Parse Date Joined
      const createdAt = new Date(dateJoinedStr)
      if (Number.isNaN(createdAt.getTime())) {
        console.warn(`Invalid Date Joined for ${name}: ${dateJoinedStr}. Using current date.`)
      }

      // Parse Balance
      // Balance is like -800.00. Assuming this means they OWE 800.
      // So totalAmount for payment plan should be 800.
      const rawBalance = parseFloat(balanceStr.replace(/,/g, ''))
      const debtAmount = Math.abs(rawBalance) // Ensure positive number for debt
      const debtAmountCents = Math.round(debtAmount * 100)

      const patientId = `#FDM${nextId.toString().padStart(6, '0')}`
      nextId++

      // 1. Create Patient
      const patientData: typeof patients.$inferInsert = {
        name: name,
        patientId: patientId,
        dob: dob,
        gender: gender,
        isChild: isChild,
        isOrtho: false,
        type: 'general',
        nationality: nationality || 'Ghana',
        address: isChild ? undefined : residence,
        guardianAddress: isChild ? residence : undefined,
        phone: isChild ? undefined : phone,
        guardianPhone: isChild ? phone : undefined,
        occupation: isChild ? undefined : occupation,
        guardianOccupation: isChild ? occupation : undefined,
        createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
        updatedAt: new Date(),
      }

      const [newPatient] = await db.insert(patients).values(patientData).returning()

      // 2. Create Payment Plan if they have a debt
      if (debtAmountCents > 0) {
        const paymentPlanData: typeof paymentPlans.$inferInsert = {
          patientId: newPatient.id,
          totalAmount: debtAmountCents,
          // Actually, usually users want granular plans. But without input, 1 installment of full amount is safest interpretation of "outstanding balance".
          // Wait, if I set amountPerInstallment to totalAmount, it means they have to pay it all at once?
          // Let's set it to something small like 100 just to be safe? No, that's arbitrary.
          // I'll set amountPerInstallment to debtAmountCents for now.
          // Re-reading: "create a payment plan for all of them using the balance from the csv as the outstanding balance"
          // I'll set amountPerInstallment to debtAmountCents.
          amountPerInstallment: debtAmountCents,
          paymentFrequency: 'monthly',
          startDate: new Date(),
          status: 'activated',
          notes: 'Imported Initial Balance',
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        await db.insert(paymentPlans).values(paymentPlanData)
      }

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

importPatientsNonZero().catch(console.error)
