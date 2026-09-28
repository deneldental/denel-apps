// One-shot cleanup: for every payment plan whose master invoice is still in
// `draft` status, run `issueInvoice` so the AR posts and the patient's
// outstanding balance reflects the plan. Idempotent — already-issued invoices
// are silently skipped.
//
// Run with:  doppler run --silent -- pnpm tsx scripts/issue-stuck-plan-invoices.ts

import { eq } from 'drizzle-orm'
import { getDb } from '../src/db'
import { invoices, paymentPlans } from '../src/db/schema'
import { issueInvoice } from '../src/lib/invoice-service'

async function main() {
  const db = getDb(process.env.DATABASE_URL!)

  // All non-terminal plans (anything that could still owe money).
  const plans = await db.query.paymentPlans.findMany()
  let issued = 0
  let skipped = 0
  let failed = 0

  for (const plan of plans) {
    if (!plan.invoiceId) {
      skipped++
      continue
    }
    const inv = await db.query.invoices.findFirst({ where: eq(invoices.id, plan.invoiceId) })
    if (!inv) {
      console.log(`[skip] plan ${plan.id} → invoice ${plan.invoiceId} not found`)
      skipped++
      continue
    }
    if (inv.status !== 'draft') {
      skipped++
      continue
    }

    // Attribute the issue to the invoice's createdBy (or a sentinel system user).
    const userId = inv.createdBy ?? 'system'
    try {
      await issueInvoice(db, inv.id, userId)
      console.log(`[ok]   plan ${plan.id} → ${inv.invoiceNumber} issued (GHS ${inv.total ?? inv.amount})`)
      issued++
    } catch (err: any) {
      console.error(`[FAIL] plan ${plan.id} → ${inv.invoiceNumber}: ${err?.message ?? err}`)
      failed++
    }
  }

  console.log(`\nDone. issued=${issued}, skipped=${skipped}, failed=${failed}`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
