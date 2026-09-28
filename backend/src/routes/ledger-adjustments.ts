import { parse } from 'csv-parse/browser/esm/sync'
import { and, desc, eq, sql } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { getDb } from '../db'
import { expenses, patients, paymentPlans, payments, user } from '../db/schema'
import { createAuditLog } from '../lib/audit'
import { ensureExpensePosted } from '../lib/expense-service'
import { recalculatePlanBalances } from '../lib/ledger-utils'
import { logError } from '../lib/logger'
import { ROLES } from '../lib/modules'
import { getCurrentUser } from '../lib/rbac'
import { uploadToCategory } from '../lib/storage-router'
import type { HonoEnv } from '../lib/types'

const MONTH_NAMES = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
]

function getOrdinalSuffix(day: number): string {
  if (day > 3 && day < 21) return 'th'
  switch (day % 10) {
    case 1:
      return 'st'
    case 2:
      return 'nd'
    case 3:
      return 'rd'
    default:
      return 'th'
  }
}
const ledgerAdjustmentsApp = new Hono<HonoEnv>()

// Helper: verify requestor is admin, returns { user, adminName } or responds with error
async function requireAdmin(c: Context<HonoEnv>) {
  const currentUser = await getCurrentUser(c)
  if (!currentUser) {
    return { error: c.json({ error: 'Not authenticated' }, 401), user: null, adminName: '' }
  }

  const db = getDb(process.env.DATABASE_URL!)
  const dbUser = await db.query.user.findFirst({
    where: eq(user.id, currentUser.id),
  })

  if (!dbUser || dbUser.roleId !== ROLES.ADMIN) {
    return { error: c.json({ error: 'Admin access required' }, 403), user: null, adminName: '' }
  }

  const adminName = currentUser.name || currentUser.email || 'Admin'
  return { error: null, user: currentUser, adminName }
}

// GET /api/ledger-adjustments/patients
// Returns all patients (id, name, phone) for the patient selector
ledgerAdjustmentsApp.get('/patients', async (c) => {
  const { error } = await requireAdmin(c)
  if (error) return error

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const allPatients = await db.query.patients.findMany({
      columns: { id: true, name: true, phone: true },
      orderBy: (p, { asc }) => [asc(p.name)],
    })
    return c.json({ success: true, data: allPatients })
  } catch (err) {
    logError(err, { context: 'ledger-adjustments: fetch patients' })
    return c.json({ error: 'Failed to fetch patients' }, 500)
  }
})

// GET /api/ledger-adjustments/patient/:patientId/plan
// Returns the patient's payment plan with payment history and balance details
ledgerAdjustmentsApp.get('/patient/:patientId/plan', async (c) => {
  const { error } = await requireAdmin(c)
  if (error) return error

  const { patientId } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const plan = await db.query.paymentPlans.findFirst({
      where: eq(paymentPlans.patientId, patientId),
    })

    if (!plan) {
      return c.json({ success: true, data: null })
    }

    const planPayments = await db.query.payments.findMany({
      where: and(eq(payments.paymentPlanId, plan.id), eq(payments.status, 'posted')),
      orderBy: [desc(payments.createdAt)],
    })

    const totalPaid = planPayments.reduce((sum, p) => sum + p.amount, 0)
    const remaining = Math.max(0, plan.totalAmount - totalPaid)

    return c.json({
      success: true,
      data: { plan, payments: planPayments, totalPaid, remaining },
    })
  } catch (err) {
    logError(err, { context: 'ledger-adjustments: fetch plan details', patientId })
    return c.json({ error: 'Failed to fetch plan details' }, 500)
  }
})

// GET /api/ledger-adjustments/recent
// Returns the 30 most recent ledger adjustment payments for the audit table
ledgerAdjustmentsApp.get('/recent', async (c) => {
  const { error } = await requireAdmin(c)
  if (error) return error

  const db = getDb(process.env.DATABASE_URL!)
  try {
    // Ledger adjustments are identified by '[Ledger Adjustment' in their description
    const recentAdjustments = await db.query.payments.findMany({
      orderBy: [desc(payments.createdAt)],
      limit: 50,
    })

    // Filter to ledger adjustments client-side (description contains the marker)
    const filtered = recentAdjustments.filter((p) => p.description?.includes('[Ledger Adjustment'))

    return c.json({ success: true, data: filtered })
  } catch (err) {
    logError(err, { context: 'ledger-adjustments: fetch recent adjustments' })
    return c.json({ error: 'Failed to fetch recent adjustments' }, 500)
  }
})

// POST /api/ledger-adjustments/one-time
// Creates a backdated one-time payment (not linked to any plan)
// Body: { patientId, amount, method, description?, transactionDate, reason }
ledgerAdjustmentsApp.post('/one-time', async (c) => {
  const { error, adminName, user: adminUser } = await requireAdmin(c)
  if (error) return error

  try {
    const body = await c.req.json()
    const { patientId, amount, method, description, transactionDate, reason, treatments } = body

    if (!patientId || !amount || !method || !transactionDate) {
      return c.json(
        { error: 'Missing required fields: patientId, amount, method, transactionDate' },
        400
      )
    }

    const effectiveDate = new Date(transactionDate)
    if (Number.isNaN(effectiveDate.getTime())) {
      return c.json({ error: 'Invalid transactionDate format' }, 400)
    }

    if (effectiveDate > new Date()) {
      return c.json({ error: 'transactionDate cannot be in the future' }, 400)
    }

    const db = getDb(process.env.DATABASE_URL!)

    const patient = await db.query.patients.findFirst({
      where: eq(patients.id, patientId),
      columns: { id: true },
    })
    if (!patient) return c.json({ error: 'Patient not found' }, 404)

    const oneTimeAmount = Math.round(Number(amount))

    const [newPayment] = await db
      .insert(payments)
      .values({
        patientId,
        amount: oneTimeAmount,
        method,
        status: 'posted',
        // Not tied to any invoice/allocation — the full amount sits unallocated,
        // matching payments_amount_split_check (allocated + unallocated = amount).
        allocatedAmount: 0,
        unallocatedAmount: oneTimeAmount,
        description: description || null,
        sendNotification: false,
        balance: null,
        treatments: treatments || [],
        createdAt: effectiveDate,
      })
      .returning()

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: adminUser?.id || 'system',
      action: 'create',
      module: 'ledger-adjustments',
      entityId: newPayment.id,
      entityName: `One-time adjustment for patient ${patientId}`,
      changes: { amount, reason, admin: adminName },
    })

    return c.json({ success: true, data: newPayment }, 201)
  } catch (err) {
    logError(err, { context: 'ledger-adjustments: create one-time adjustment' })
    return c.json({ error: 'Failed to create ledger adjustment' }, 500)
  }
})

// POST /api/ledger-adjustments/plan-installment
// Adds a backdated installment to a patient's existing payment plan
// Body: { patientId, amount, method, transactionDate, reason }
ledgerAdjustmentsApp.post('/plan-installment', async (c) => {
  const { error, adminName, user: adminUser } = await requireAdmin(c)
  if (error) return error

  try {
    const body = await c.req.json()
    const { patientId, amount, method, transactionDate, reason, treatments, description } = body

    if (!patientId || !amount || !method || !transactionDate) {
      return c.json(
        { error: 'Missing required fields: patientId, amount, method, transactionDate' },
        400
      )
    }

    const effectiveDate = new Date(transactionDate)
    if (Number.isNaN(effectiveDate.getTime())) {
      return c.json({ error: 'Invalid transactionDate format' }, 400)
    }

    if (effectiveDate > new Date()) {
      return c.json({ error: 'transactionDate cannot be in the future' }, 400)
    }

    const db = getDb(process.env.DATABASE_URL!)

    const plan = await db.query.paymentPlans.findFirst({
      where: eq(paymentPlans.patientId, patientId),
    })
    if (!plan) {
      return c.json({ error: 'No active payment plan found for this patient' }, 404)
    }

    const paymentAmount = Math.round(Number(amount))
    const _auditDesc = `[Ledger Adjustment by ${adminName}${reason ? ` — ${reason}` : ''}]`

    const [newPayment] = await db
      .insert(payments)
      .values({
        patientId,
        paymentPlanId: plan.id,
        amount: paymentAmount,
        method,
        status: 'posted',
        // Applied directly to the plan — fully allocated, matching
        // payments_amount_split_check (allocated + unallocated = amount).
        allocatedAmount: paymentAmount,
        unallocatedAmount: 0,
        description: description || null,
        sendNotification: false,
        balance: 0, // Will be set by recalculatePlanBalances
        treatments: treatments || [],
        createdAt: effectiveDate,
      })
      .returning()

    // Recalculate all balances for this plan chronologically
    const result = await recalculatePlanBalances(db, plan.id)
    const finalBalance = result?.finalBalance ?? 0

    c.set('skipAudit', true)
    await createAuditLog(db, {
      userId: adminUser?.id || 'system',
      action: 'create',
      module: 'ledger-adjustments',
      entityId: newPayment.id,
      entityName: `Plan adjustment for patient ${patientId}`,
      changes: { amount, reason, admin: adminName },
    })

    return c.json(
      {
        success: true,
        data: {
          payment: newPayment,
          planCompleted: finalBalance <= 0,
          newBalance: finalBalance,
          planId: plan.id,
        },
      },
      201
    )
  } catch (err) {
    logError(err, { context: 'ledger-adjustments: create plan installment adjustment' })
    return c.json({ error: 'Failed to create plan installment adjustment' }, 500)
  }
})

// GET /api/ledger-adjustments/patient/:patientId/one-time-payments
// Returns all completed one-time payments (not linked to a plan) for a patient
ledgerAdjustmentsApp.get('/patient/:patientId/one-time-payments', async (c) => {
  const { error } = await requireAdmin(c)
  if (error) return error

  const { patientId } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const oneTimePayments = await db.query.payments.findMany({
      where: and(
        eq(payments.patientId, patientId),
        eq(payments.status, 'posted'),
        sql`${payments.paymentPlanId} IS NULL`
      ),
      orderBy: [desc(payments.createdAt)],
    })

    return c.json({ success: true, data: oneTimePayments })
  } catch (err) {
    logError(err, { context: 'ledger-adjustments: fetch one-time payments', patientId })
    return c.json({ error: 'Failed to fetch one-time payments' }, 500)
  }
})

// POST /api/ledger-adjustments/transfer-to-plan
// Transfers a one-time payment into the patient's payment plan
// Body: { paymentId, patientId }
ledgerAdjustmentsApp.post('/transfer-to-plan', async (c) => {
  const { error, adminName, user: adminUser } = await requireAdmin(c)
  if (error) return error

  try {
    const body = await c.req.json()
    const { paymentId, patientId } = body

    if (!paymentId || !patientId) {
      return c.json({ error: 'Missing required fields: paymentId, patientId' }, 400)
    }

    const db = getDb(process.env.DATABASE_URL!)

    // Verify payment exists, belongs to patient, and has no plan
    const payment = await db.query.payments.findFirst({
      where: and(eq(payments.id, paymentId), eq(payments.patientId, patientId)),
    })

    if (!payment) return c.json({ error: 'Payment not found' }, 404)
    if (payment.paymentPlanId) {
      return c.json({ error: 'Payment is already linked to a payment plan' }, 400)
    }

    // Find the patient's payment plan
    const plan = await db.query.paymentPlans.findFirst({
      where: eq(paymentPlans.patientId, patientId),
    })

    if (!plan) {
      return c.json({ error: 'No payment plan found for this patient' }, 404)
    }

    // Link the payment to the plan
    await db
      .update(payments)
      .set({ paymentPlanId: plan.id, balance: 0 })
      .where(eq(payments.id, paymentId))

    // Recalculate all plan balances
    const result = await recalculatePlanBalances(db, plan.id)
    const finalBalance = result?.finalBalance ?? 0

    await createAuditLog(db, {
      userId: adminUser?.id || 'system',
      action: 'update',
      module: 'ledger-adjustments',
      entityId: paymentId,
      entityName: `Transfer payment to plan for patient ${patientId}`,
      changes: { planId: plan.id, amount: payment.amount, admin: adminName },
    })

    return c.json({
      success: true,
      data: {
        planCompleted: finalBalance <= 0,
        newBalance: finalBalance,
        planId: plan.id,
      },
    })
  } catch (err) {
    logError(err, { context: 'ledger-adjustments: transfer payment to plan' })
    return c.json({ error: 'Failed to transfer payment to plan' }, 500)
  }
})

// POST /api/ledger-adjustments/cleanup
// Temporary endpoint to strip '[Ledger Adjustment...]' from existing receipts
ledgerAdjustmentsApp.post('/cleanup', async (c) => {
  const { error } = await requireAdmin(c)
  if (error) return error

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const allPayments = await db.query.payments.findMany({
      where: (p, { isNotNull, like }) =>
        and(isNotNull(p.description), like(p.description, '%[Ledger Adjustment%')),
    })

    let updatedCount = 0
    for (const payment of allPayments) {
      if (!payment.description) continue

      // Regex to match the audit suffix, handling potential '|' separator
      // Matches: 'Original Text | [Ledger Adjustment...]' or just '[Ledger Adjustment...]'
      const cleanedDescription = payment.description
        .replace(/\s*\|?\s*\[Ledger Adjustment by .*?\]/g, '')
        .trim()

      await db
        .update(payments)
        .set({ description: cleanedDescription || null })
        .where(eq(payments.id, payment.id))

      updatedCount++
    }

    return c.json({ success: true, message: `Cleaned ${updatedCount} receipt descriptions.` })
  } catch (err: unknown) {
    logError(err, { context: 'ledger-adjustments: cleanup receipt descriptions' })
    const pgErr = err as { message?: string }
    return c.json({ error: `Cleanup failed: ${pgErr.message}` }, 500)
  }
})

// POST /api/ledger-adjustments/expense
// Creates a backdated expense record
ledgerAdjustmentsApp.post('/expense', async (c) => {
  const { error, adminName, user: adminUser } = await requireAdmin(c)
  if (error) return error

  try {
    const body = await c.req.json()
    const { category, amount, date, description, paidTo, paymentMethod, reason, attachmentUrl } =
      body

    if (!category || !amount || !date) {
      return c.json({ error: 'Missing required fields: category, amount, date' }, 400)
    }

    const parsedAmount = parseFloat(String(amount))
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      return c.json({ error: 'Invalid amount' }, 400)
    }

    const db = getDb(process.env.DATABASE_URL!)

    const desc = reason
      ? `${description || ''} | [Ledger Adjustment by ${adminName}: ${reason}]`
          .trim()
          .replace(/^\| /, '')
      : description || null

    const [newExpense] = await db
      .insert(expenses)
      .values({
        category,
        amount: parsedAmount,
        date: new Date(date),
        description: desc,
        paidTo: paidTo || null,
        paymentMethod: paymentMethod || null,
        attachmentUrl: attachmentUrl || null,
      })
      .returning()

    await createAuditLog(db, {
      userId: adminUser?.id,
      action: 'create',
      module: 'expenses',
      entityId: newExpense.id,
      entityName: `Backdated expense: GHS ${(parsedAmount / 100).toFixed(2)} (${category}) on ${date}`,
      changes: { amount: parsedAmount, category, reason: reason || null, admin: adminName },
    })

    // Phase 4: try to post it. Backdated into a closed month -> comes back as a
    // reason and shows on the unposted list rather than silently vanishing.
    if (adminUser?.id) {
      try {
        await ensureExpensePosted(db, newExpense, adminUser.id)
      } catch (glError) {
        logError(glError, { context: 'backdated expense GL posting (non-fatal)' })
      }
    }

    return c.json({ success: true, data: newExpense })
  } catch (err: unknown) {
    logError(err, { context: 'ledger-adjustments: create backdated expense' })
    return c.json({ error: 'Failed to create expense' }, 500)
  }
})

// POST /api/ledger-adjustments/payment
// Creates a backdated standalone payment (no patient required)
ledgerAdjustmentsApp.post('/payment', async (c) => {
  const { error, adminName, user: adminUser } = await requireAdmin(c)
  if (error) return error

  try {
    const body = await c.req.json()
    const { amount, method, date, description, reason } = body

    if (!amount || !method || !date) {
      return c.json({ error: 'Missing required fields: amount, method, date' }, 400)
    }

    const parsedAmount = parseFloat(String(amount))
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      return c.json({ error: 'Invalid amount' }, 400)
    }

    const db = getDb(process.env.DATABASE_URL!)

    const desc = reason
      ? `${description || ''} | [Ledger Adjustment by ${adminName}: ${reason}]`
          .trim()
          .replace(/^\| /, '')
      : description || null

    const standaloneAmount = Math.round(parsedAmount)

    const [newPayment] = await db
      .insert(payments)
      .values({
        amount: standaloneAmount,
        method,
        status: 'posted',
        // Not tied to any invoice/allocation — the full amount sits unallocated,
        // matching payments_amount_split_check (allocated + unallocated = amount).
        allocatedAmount: 0,
        unallocatedAmount: standaloneAmount,
        description: desc,
        createdAt: new Date(date),
      })
      .returning()

    await createAuditLog(db, {
      userId: adminUser?.id,
      action: 'create',
      module: 'ledger-adjustments',
      entityId: newPayment.id,
      entityName: `Backdated payment: GHS ${(parsedAmount / 100).toFixed(2)} via ${method} on ${date}`,
      changes: { amount: parsedAmount, method, reason: reason || null, admin: adminName },
    })

    return c.json({ success: true, data: newPayment })
  } catch (err: unknown) {
    logError(err, { context: 'ledger-adjustments: create backdated standalone payment' })
    return c.json({ error: 'Failed to create payment' }, 500)
  }
})

// POST /api/ledger-adjustments/payment-bulk
// Bulk-imports backdated patient payments from a CSV file.
// Body: multipart/form-data { csv: File }
// CSV columns: PatientName, PatientPhone, Type (one-time|plan-installment), Amount, Method, Date, Description, Reason
ledgerAdjustmentsApp.post('/payment-bulk', async (c) => {
  const { error, adminName, user: adminUser } = await requireAdmin(c)
  if (error) return error

  try {
    const formData = await c.req.formData()
    const csvFile = formData.get('csv') as File | null
    if (!csvFile) return c.json({ error: 'Missing csv file' }, 400)

    const csvText = await csvFile.text()
    const rows = parse(csvText, { columns: true, skip_empty_lines: true, trim: true }) as any[]

    if (rows.length === 0) {
      return c.json({ error: 'CSV file is empty or has no data rows' }, 400)
    }

    const db = getDb(process.env.DATABASE_URL!)
    const results: { row: number; id: string; type: string }[] = []
    const errors: string[] = []

    for (const [i, row] of rows.entries()) {
      const rowNum = i + 2
      const patientName = ((row.PatientName as string) || '').trim()
      const patientPhone = ((row.PatientPhone as string) || '').trim() || null
      const type = ((row.Type as string) || '').toLowerCase().trim()
      const amountStr = row.Amount as string
      const method = ((row.Method as string) || '').trim()
      const dateStr = row.Date as string
      const description = ((row.Description as string) || '').trim() || undefined
      const reason = ((row.Reason as string) || '').trim() || undefined

      if (!patientName || !type || !amountStr || !method || !dateStr) {
        errors.push(
          `Row ${rowNum}: Missing required fields (PatientName, Type, Amount, Method, Date)`
        )
        continue
      }

      if (type !== 'one-time' && type !== 'plan-installment') {
        errors.push(`Row ${rowNum}: Type must be "one-time" or "plan-installment", got "${type}"`)
        continue
      }

      const parsedAmount = parseFloat(String(amountStr))
      if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
        errors.push(`Row ${rowNum}: Invalid amount "${amountStr}"`)
        continue
      }

      const effectiveDate = new Date(dateStr)
      if (Number.isNaN(effectiveDate.getTime())) {
        errors.push(`Row ${rowNum}: Invalid date "${dateStr}"`)
        continue
      }
      if (effectiveDate > new Date()) {
        errors.push(`Row ${rowNum}: Date cannot be in the future`)
        continue
      }

      // Look up patient — phone first for precision, then name
      let patient: { id: string; name: string } | null = null
      if (patientPhone) {
        patient =
          (await db.query.patients.findFirst({
            where: eq(patients.phone, patientPhone),
            columns: { id: true, name: true },
          })) ?? null
      }
      if (!patient) {
        const matches = await db
          .select({ id: patients.id, name: patients.name })
          .from(patients)
          .where(sql`LOWER(${patients.name}) = LOWER(${patientName})`)
        if (matches.length === 0) {
          errors.push(`Row ${rowNum}: Patient "${patientName}" not found`)
          continue
        }
        if (matches.length > 1) {
          errors.push(
            `Row ${rowNum}: Multiple patients named "${patientName}" — add PatientPhone to disambiguate`
          )
          continue
        }
        patient = matches[0]
      }

      // ── Duplicate check ───────────────────────────────────────────────
      // Match on patient + amount + date + treatment description.
      // Stored description has an audit suffix ("Treatment | [Ledger Adjustment...]")
      // so we use LIKE to check containment. If no description in the CSV row,
      // fall back to patient + amount + date only (original behaviour).
      const dupDescription = description?.trim() || null
      const duplicate = dupDescription
        ? await db.execute<{ id: string }>(sql`
                    SELECT id FROM payments
                    WHERE "patientId" = ${patient.id}
                    AND amount = ${Math.round(parsedAmount)}
                    AND DATE("createdAt") = DATE(${effectiveDate.toISOString()})
                    AND status = 'posted'
                    AND description LIKE ${`%${dupDescription}%`}
                    LIMIT 1
                  `)
        : await db.execute<{ id: string }>(sql`
                    SELECT id FROM payments
                    WHERE "patientId" = ${patient.id}
                    AND amount = ${Math.round(parsedAmount)}
                    AND DATE("createdAt") = DATE(${effectiveDate.toISOString()})
                    AND status = 'posted'
                    LIMIT 1
                  `)
      if (duplicate.rows.length > 0) {
        errors.push(
          `Row ${rowNum}: Duplicate — ${patient.name} already has a GHS ${(parsedAmount / 100).toFixed(2)} payment on ${dateStr}${dupDescription ? ` for "${dupDescription}"` : ''} (id: ${duplicate.rows[0].id})`
        )
        continue
      }

      const auditSuffix = `[Ledger Adjustment by ${adminName}${reason ? `: ${reason}` : ''}]`
      const desc = description ? `${description} | ${auditSuffix}` : auditSuffix

      if (type === 'one-time') {
        const bulkOneTimeAmount = Math.round(parsedAmount)
        const [newPayment] = await db
          .insert(payments)
          .values({
            patientId: patient.id,
            amount: bulkOneTimeAmount,
            method,
            status: 'posted',
            // Not tied to any invoice/allocation — full amount sits unallocated,
            // matching payments_amount_split_check (allocated + unallocated = amount).
            allocatedAmount: 0,
            unallocatedAmount: bulkOneTimeAmount,
            description: desc,
            sendNotification: false,
            balance: null,
            treatments: [],
            createdAt: effectiveDate,
          })
          .returning()

        results.push({ row: rowNum, id: newPayment.id, type: 'one-time' })
      } else {
        const plan = await db.query.paymentPlans.findFirst({
          where: eq(paymentPlans.patientId, patient.id),
        })
        if (!plan) {
          errors.push(`Row ${rowNum}: No payment plan found for patient "${patient.name}"`)
          continue
        }

        const bulkInstallmentAmount = Math.round(parsedAmount)
        const [newPayment] = await db
          .insert(payments)
          .values({
            patientId: patient.id,
            paymentPlanId: plan.id,
            amount: bulkInstallmentAmount,
            method,
            status: 'posted',
            // Applied directly to the plan — fully allocated, matching
            // payments_amount_split_check (allocated + unallocated = amount).
            allocatedAmount: bulkInstallmentAmount,
            unallocatedAmount: 0,
            description: desc,
            sendNotification: false,
            balance: 0,
            treatments: [],
            createdAt: effectiveDate,
          })
          .returning()

        await recalculatePlanBalances(db, plan.id)
        results.push({ row: rowNum, id: newPayment.id, type: 'plan-installment' })
      }
    }

    const duplicateCount = errors.filter((e) => e.includes('Duplicate —')).length
    const errorCount = errors.length - duplicateCount

    if (results.length === 0 && duplicateCount === errors.length) {
      return c.json(
        {
          success: false,
          error: 'All rows already exist in the database — nothing imported',
          errors,
        },
        400
      )
    }
    if (results.length === 0) {
      return c.json({ success: false, error: 'No rows were imported', errors }, 400)
    }

    const parts = [`Imported ${results.length} payment${results.length !== 1 ? 's' : ''}`]
    if (duplicateCount > 0)
      parts.push(`${duplicateCount} duplicate${duplicateCount !== 1 ? 's' : ''} skipped`)
    if (errorCount > 0) parts.push(`${errorCount} error${errorCount !== 1 ? 's' : ''}`)
    const message = `${parts.join(', ')}.`
    return c.json(
      { success: true, data: { message, errors: errors.length > 0 ? errors : undefined } },
      201
    )
  } catch (err: unknown) {
    logError(err, { context: 'ledger-adjustments: bulk payment CSV import' })
    return c.json({ error: 'Failed to import payments' }, 500)
  }
})

// POST /api/ledger-adjustments/expense-bulk
// Bulk-imports backdated expenses from a CSV file.
// Body: multipart/form-data { csv: File, attachments?: File[] }
// CSV columns: Date, Amount, Category, Description, PaidTo, Method, Attachment
// Attachment column values are relative paths (e.g. /receipt.jpg) matched against uploaded files.
ledgerAdjustmentsApp.post('/expense-bulk', async (c) => {
  const { error, adminName, user: adminUser } = await requireAdmin(c)
  if (error) return error

  try {
    const formData = await c.req.formData()
    const csvFile = formData.get('csv') as File | null
    if (!csvFile) return c.json({ error: 'Missing csv file' }, 400)

    // Build filename → File map from uploaded attachments
    const attachmentFiles = formData.getAll('attachments') as File[]
    const attachmentMap = new Map<string, File>()
    for (const file of attachmentFiles) {
      attachmentMap.set(file.name.toLowerCase(), file)
    }

    const csvText = await csvFile.text()
    const rows = parse(csvText, { columns: true, skip_empty_lines: true, trim: true }) as any[]

    if (rows.length === 0) {
      return c.json({ error: 'CSV file is empty or has no data rows' }, 400)
    }

    const db = getDb(process.env.DATABASE_URL!)

    const results: { row: number; id: string }[] = []
    const errors: string[] = []

    for (const [i, row] of rows.entries()) {
      const rowNum = i + 2 // row 1 is header
      const dateStr = row.Date as string
      const amountStr = row.Amount as string
      const category = row.Category as string
      const description = row.Description as string | undefined
      const paidTo = row.PaidTo as string | undefined
      const method = row.Method as string | undefined
      const attachmentPath = row.Attachment as string | undefined

      if (!dateStr || !amountStr || !category) {
        errors.push(`Row ${rowNum}: Missing required fields (Date, Amount, Category)`)
        continue
      }

      const parsedAmount = parseFloat(String(amountStr))
      if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
        errors.push(`Row ${rowNum}: Invalid amount "${amountStr}"`)
        continue
      }

      const date = new Date(dateStr)
      if (Number.isNaN(date.getTime())) {
        errors.push(`Row ${rowNum}: Invalid date "${dateStr}"`)
        continue
      }

      // Resolve and upload attachment if specified
      let attachmentUrl: string | undefined
      if (attachmentPath) {
        const normalizedName = attachmentPath.replace(/^\//, '').toLowerCase()
        const file = attachmentMap.get(normalizedName)
        if (file) {
          const year = date.getFullYear()
          const month = MONTH_NAMES[date.getMonth()]
          const day = date.getDate()
          const ext = file.name.split('.').pop() || 'bin'
          const categorySlug = category.toLowerCase().replace(/\s+/g, '_')
          const paidToSlug = paidTo ? paidTo.toLowerCase().replace(/\s+/g, '_') : ''
          const dayOrdinal = `${day}${getOrdinalSuffix(day)}`
          const monthLower = month.toLowerCase()
          let fileName = categorySlug
          if (paidToSlug) fileName += `_${paidToSlug}`
          fileName += `_${dayOrdinal}_${monthLower}_${year}.${ext}`
          const key = `expenses/${year}/${month}/${fileName}`

          const buffer = await file.arrayBuffer()
          const upload = await uploadToCategory('system_docs', key, Buffer.from(buffer), file.type)
          attachmentUrl = upload.url
        } else {
          errors.push(
            `Row ${rowNum}: Attachment file "${attachmentPath}" not found in uploaded files`
          )
        }
      }

      const desc = description || `[Ledger Adjustment by ${adminName}]`
      const [newExpense] = await db
        .insert(expenses)
        .values({
          category,
          amount: parsedAmount,
          date,
          description: desc,
          paidTo: paidTo || null,
          paymentMethod: method || null,
          attachmentUrl: attachmentUrl || null,
        })
        .returning()

      // Phase 4: post each imported expense (best-effort; old dates land on the
      // unposted list if their month is closed).
      if (adminUser?.id) {
        try {
          await ensureExpensePosted(db, newExpense, adminUser.id)
        } catch (glError) {
          logError(glError, { context: 'CSV expense GL posting (non-fatal)' })
        }
      }

      results.push({ row: rowNum, id: newExpense.id })
    }

    if (results.length === 0) {
      return c.json({ success: false, error: 'No rows were imported', errors }, 400)
    }

    const message = `Imported ${results.length} expense${results.length !== 1 ? 's' : ''}${errors.length > 0 ? ` (${errors.length} row${errors.length !== 1 ? 's' : ''} skipped)` : ''}.`
    return c.json(
      { success: true, data: { message, errors: errors.length > 0 ? errors : undefined } },
      201
    )
  } catch (err: unknown) {
    logError(err, { context: 'ledger-adjustments: bulk expense CSV import' })
    return c.json({ error: 'Failed to import expenses' }, 500)
  }
})

// POST /api/ledger-adjustments/quick-create-patients
// Creates minimal patient records from names only (placeholder DOB = 1900-01-01).
// Used by the bulk-payment import UI to create missing patients in one step.
// Body: { names: string[] }
ledgerAdjustmentsApp.post('/quick-create-patients', async (c) => {
  const { error } = await requireAdmin(c)
  if (error) return error

  try {
    const { names } = (await c.req.json()) as { names: string[] }

    if (!Array.isArray(names) || names.length === 0) {
      return c.json({ error: 'names must be a non-empty array' }, 400)
    }

    const db = getDb(process.env.DATABASE_URL!)

    // Ensure the patient ID sequence exists
    await db.execute(sql`CREATE SEQUENCE IF NOT EXISTS patient_id_seq START WITH 1`)
    await db.execute(sql`
            DO $$
            DECLARE
                max_id BIGINT;
                cur_val BIGINT;
            BEGIN
                SELECT COALESCE(MAX(CAST(REGEXP_REPLACE("patientId", '[^0-9]', '', 'g') AS BIGINT)), 0)
                INTO max_id
                FROM patients
                WHERE "patientId" LIKE '#FDM%';

                SELECT last_value INTO cur_val FROM patient_id_seq;

                IF max_id >= cur_val THEN
                    PERFORM setval('patient_id_seq', max_id + 1, false);
                END IF;
            END $$
        `)

    const created: { id: string; name: string; patientId: string | null }[] = []
    const skipped: string[] = []

    for (const rawName of names) {
      const name = rawName.replace(/\s+/g, ' ').trim()
      if (!name) continue

      // Skip if already exists
      const existing = await db.execute<{ id: string }>(
        sql`SELECT id FROM patients WHERE LOWER(name) = LOWER(${name}) LIMIT 1`
      )
      if (existing.rows.length > 0) {
        skipped.push(name)
        continue
      }

      const seqResult = await db.execute<{ nextval: string }>(sql`SELECT nextval('patient_id_seq')`)
      const nextval = (seqResult.rows[0] as { nextval: string }).nextval
      const patientId = `#FDM${String(nextval).padStart(6, '0')}`

      const [newPatient] = await db
        .insert(patients)
        .values({
          name,
          patientId,
          dob: new Date('1900-01-01'), // placeholder — to be updated via patient profile
          gender: 'other', // placeholder — to be updated via patient profile
        })
        .returning({ id: patients.id, name: patients.name, patientId: patients.patientId })

      created.push(newPatient)
    }

    const message = `Created ${created.length} patient${created.length !== 1 ? 's' : ''}${skipped.length > 0 ? `, ${skipped.length} already existed` : ''}.`
    return c.json({ success: true, data: { message, created, skipped } }, 201)
  } catch (err: unknown) {
    logError(err, { context: 'ledger-adjustments: quick-create patients' })
    return c.json({ error: 'Failed to create patients' }, 500)
  }
})

export { ledgerAdjustmentsApp }
