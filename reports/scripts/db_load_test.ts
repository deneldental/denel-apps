import { sql } from 'drizzle-orm'
import { db } from '../lib/db/index'
import { patients } from '../lib/db/schema'

const CONCURRENCY = 50
const ITERATIONS = 20

async function runLoadTest() {
  console.log(`🚀 Starting DB Load Test`)
  console.log(`Configurations: Concurrency=${CONCURRENCY}, Iterations=${ITERATIONS}`)
  console.log(`Total Requests: ${CONCURRENCY * ITERATIONS}`)

  const startTime = performance.now()
  let successCount = 0
  let errorCount = 0

  // Helper to run a single "user session"
  const runWorker = async (_workerId: number) => {
    for (let i = 0; i < ITERATIONS; i++) {
      try {
        // Randomly choose an operation
        const op = Math.random()

        if (op < 0.4) {
          // 40% - Fetch random patient details
          await db.query.patients.findFirst({
            with: {
              medicalRecords: { limit: 5 },
              payments: { limit: 5 },
            },
          })
        } else if (op < 0.7) {
          // 30% - Count patients (heavy-ish)
          await db.select({ count: sql<number>`count(*)` }).from(patients)
        } else {
          // 30% - Fetch latest payments
          await db.query.payments.findMany({
            limit: 10,
            orderBy: (payments, { desc }) => [desc(payments.createdAt)],
          })
        }
        successCount++
      } catch (_error) {
        errorCount++
        // console.error(`Worker ${workerId} error:`, error)
      }
    }
  }

  // Launch workers
  const workers = []
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(runWorker(i))
  }

  await Promise.all(workers)

  const endTime = performance.now()
  const durationMs = endTime - startTime
  const durationSec = durationMs / 1000
  const throughput = (successCount / durationSec).toFixed(2)

  console.log(`\n✨ Load Test Complete!`)
  console.log(`--------------------------------`)
  console.log(`Time Taken: ${durationSec.toFixed(3)}s`)
  console.log(`Total Queries: ${successCount + errorCount}`)
  console.log(`Successful: ${successCount}`)
  console.log(`Failed: ${errorCount}`)
  console.log(`Throughput: ${throughput} req/s`)
  console.log(`--------------------------------`)

  process.exit(0)
}

runLoadTest().catch(console.error)
