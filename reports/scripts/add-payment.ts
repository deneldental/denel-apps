import { randomUUID } from 'node:crypto'
import { ilike, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { patients, payments } from '@/lib/db/schema'

async function main() {
  const args = process.argv.slice(2)

  if (args.length < 3) {
    console.log(
      'Usage: npx tsx scripts/add-payment.ts <patient_name> <amount_ghs> <method> [description] [date]'
    )
    console.log(
      'Example: npx tsx scripts/add-payment.ts "John Doe" 500 cash "Consultation" "2023-10-25"'
    )
    process.exit(1)
  }

  const [patientName, amountStr, method, description, dateStr] = args
  const amount = parseFloat(amountStr)

  let createdAt = new Date()
  if (dateStr) {
    createdAt = new Date(dateStr)
    if (Number.isNaN(createdAt.getTime())) {
      console.error('Invalid date format:', dateStr)
      process.exit(1)
    }
  }

  if (Number.isNaN(amount)) {
    console.error('Invalid amount:', amountStr)
    process.exit(1)
  }

  console.log(`Searching for patient: "${patientName}"...`)

  const foundPatients = await db.query.patients.findMany({
    where: or(ilike(patients.name, `%${patientName}%`), ilike(patients.phone, `%${patientName}%`)),
    limit: 5,
  })

  if (foundPatients.length === 0) {
    console.error('No patient found matching that name or phone.')
    process.exit(1)
  }

  if (foundPatients.length > 1) {
    console.log('Multiple patients found. Please be more specific:')
    foundPatients.forEach((p) => {
      console.log(`- ${p.name} (Phone: ${p.phone || 'N/A'}, ID: ${p.id})`)
    })
    process.exit(1)
  }

  const patient = foundPatients[0]
  console.log(`Found patient: ${patient.name} (ID: ${patient.id})`)

  // Create payment
  // Note: Amount is now stored directly as GHS (no * 100)
  const paymentData = {
    id: randomUUID(),
    patientId: patient.id,
    amount: amount,
    method: method,
    status: 'completed',
    description: description || 'Manual payment',
    createdAt: createdAt,
    sendNotification: false,
  }

  try {
    await db.insert(payments).values(paymentData)
    console.log('✅ Payment added successfully!')
    console.log(`- Amount: GHS ${amount.toFixed(2)}`)
    console.log(`- Date: ${createdAt.toISOString()}`)
    console.log(`- Method: ${method}`)
    console.log(`- Patient: ${patient.name}`)
    console.log(`- ID: ${paymentData.id}`)
  } catch (error) {
    console.error('Failed to add payment:', error)
  }

  process.exit(0)
}

main().catch(console.error)
