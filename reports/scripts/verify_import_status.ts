import { db } from '@/lib/db'

async function checkPatients() {
  // Check for a few names that might be in the CSV
  // I'll wait to see the CSV content before populating this list
  // But generally I want to see if there are ANY patients with "isChild" flag set correctly or recent entries

  const count = await db.query.patients.findMany({
    limit: 5,
    orderBy: (patients, { desc }) => [desc(patients.createdAt)],
  })

  console.log('Recent 5 patients:', JSON.stringify(count, null, 2))
}

checkPatients().catch(console.error)
