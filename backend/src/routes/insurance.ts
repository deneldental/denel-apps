/**
 * Insurance module — Phase 3
 *
 * Ghana-specific reconciliation tracker (not a claims system).
 * - Insurance companies (admin CRUD in Settings)
 * - Service pricing documents (PDF uploads, one "current" per company)
 * - Reconciliation entries (link to patient ledger)
 */

import { and, asc, desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import {
  insuranceCompanies,
  insuranceReconciliation,
  patientWallets,
  walletTransactions,
} from '../db/schema'
import { createAuditLog } from '../lib/audit'
import {
  postInsurancePayment,
  postInsuranceReceivable,
  postInsuranceShortfall,
  reverseInsuranceGL,
} from '../lib/insurance-gl-service'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const insuranceApp = new Hono<HonoEnv>()

// ═════════════════════════════════════════════════════════════════════════════
// Companies
// ═════════════════════════════════════════════════════════════════════════════

insuranceApp.get('/companies', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.INSURANCE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db.select().from(insuranceCompanies).orderBy(asc(insuranceCompanies.name))
  return c.json({ success: true, data: rows })
})

insuranceApp.get('/companies/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.INSURANCE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  const [row] = await db
    .select()
    .from(insuranceCompanies)
    .where(eq(insuranceCompanies.id, id))
    .limit(1)
  if (!row) return c.json({ error: 'Not found' }, 404)

  return c.json({ success: true, data: row })
})

insuranceApp.post('/companies', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.INSURANCE as string, ACTIONS.CREATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const body = await c.req.json()
  if (!body.name) return c.json({ error: 'name required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .insert(insuranceCompanies)
    .values({
      name: body.name,
      contactEmail: body.contactEmail ?? null,
      contactPhone: body.contactPhone ?? null,
      address: body.address ?? null,
      notes: body.notes ?? null,
      active: body.active ?? true,
    })
    .returning()

  await createAuditLog(db, {
    userId: user.id,
    action: 'create',
    module: 'insurance',
    entityId: row.id,
    entityName: `Insurance Company: ${row.name}`,
    changes: body,
  })

  return c.json({ success: true, data: row })
})

insuranceApp.patch('/companies/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.INSURANCE as string, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const body = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)

  const updates: any = { updatedAt: new Date() }
  for (const k of ['name', 'contactEmail', 'contactPhone', 'address', 'notes', 'active']) {
    if (body[k] !== undefined) updates[k] = body[k]
  }

  const [row] = await db
    .update(insuranceCompanies)
    .set(updates)
    .where(eq(insuranceCompanies.id, id))
    .returning()
  if (!row) return c.json({ error: 'Not found' }, 404)

  await createAuditLog(db, {
    userId: user.id,
    action: 'update',
    module: 'insurance',
    entityId: id,
    entityName: `Insurance Company: ${row.name}`,
    changes: updates,
  })

  return c.json({ success: true, data: row })
})

insuranceApp.delete('/companies/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.INSURANCE as string, ACTIONS.DELETE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db.delete(insuranceCompanies).where(eq(insuranceCompanies.id, id)).returning()
  if (!row) return c.json({ error: 'Not found' }, 404)

  await createAuditLog(db, {
    userId: user.id,
    action: 'delete',
    module: 'insurance',
    entityId: id,
    entityName: `Insurance Company: ${row.name}`,
  })

  return c.json({ success: true })
})

// ═════════════════════════════════════════════════════════════════════════════
// Reconciliation entries
// ═════════════════════════════════════════════════════════════════════════════

insuranceApp.get('/reconciliation', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.INSURANCE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const companyId = c.req.query('companyId')
  const patientId = c.req.query('patientId')
  const status = c.req.query('status') // 'reconciled' | 'pending'

  const conditions: any[] = []
  if (companyId) conditions.push(eq(insuranceReconciliation.companyId, companyId))
  if (patientId) conditions.push(eq(insuranceReconciliation.patientId, patientId))

  const rows = await db.query.insuranceReconciliation.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: [desc(insuranceReconciliation.recordedAt)],
    with: { patient: true, company: true },
    limit: 500,
  })

  const filtered = status
    ? rows.filter((r: any) => (status === 'reconciled' ? !!r.reconciledAt : !r.reconciledAt))
    : rows

  return c.json({ success: true, data: filtered })
})

insuranceApp.get('/reconciliation/patient/:patientId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.INSURANCE as string, ACTIONS.READ as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const db = getDb(process.env.DATABASE_URL!)
  const patientId = c.req.param('patientId')

  const rows = await db.query.insuranceReconciliation.findMany({
    where: eq(insuranceReconciliation.patientId, patientId),
    orderBy: [desc(insuranceReconciliation.recordedAt)],
    with: { company: true },
  })

  return c.json({ success: true, data: rows })
})

// POST /reconciliation — Create a new reconciliation entry + credit patient wallet
// Body: { companyId, patientId, cardNumber, treatmentSourceType, treatmentSourceId, chargedAmount, notes }
insuranceApp.post('/reconciliation', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.INSURANCE as string, ACTIONS.CREATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const body = await c.req.json()
  const required = [
    'companyId',
    'patientId',
    'cardNumber',
    'treatmentSourceType',
    'treatmentSourceId',
    'chargedAmount',
  ]
  for (const k of required) {
    if (!body[k] && body[k] !== 0) return c.json({ error: `${k} required` }, 400)
  }

  const db = getDb(process.env.DATABASE_URL!)

  // Fetch company for ledger description
  const [company] = await db
    .select()
    .from(insuranceCompanies)
    .where(eq(insuranceCompanies.id, body.companyId))
    .limit(1)
  if (!company) return c.json({ error: 'Invalid company' }, 400)

  // Fetch or create patient wallet
  let [wallet] = await db
    .select()
    .from(patientWallets)
    .where(eq(patientWallets.patientId, body.patientId))
    .limit(1)
  if (!wallet) {
    ;[wallet] = await db
      .insert(patientWallets)
      .values({
        patientId: body.patientId,
        creditBalance: 0,
      })
      .returning()
  }

  const chargedAmount = Number(body.chargedAmount)
  const newBalance = (wallet.creditBalance ?? 0) + chargedAmount

  // §7.x: wallet credit + reconciliation row + receivable GL, all in ONE
  // transaction — if the GL can't post (account missing / closed period) the
  // wallet credit must NOT persist, or the 2200 sub-ledger drifts from the books.
  let entry: typeof insuranceReconciliation.$inferSelect
  try {
    entry = await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as typeof db
      const [walletTx] = await tx
        .insert(walletTransactions)
        .values({
          walletId: wallet.id,
          patientId: body.patientId,
          type: 'credit',
          amount: chargedAmount,
          sourceType: 'insurance',
          description: `Insurance: ${company.name} — Card ${body.cardNumber}`,
          balanceBefore: wallet.creditBalance ?? 0,
          balanceAfter: newBalance,
          createdById: user.id,
        })
        .returning()
      await tx
        .update(patientWallets)
        .set({ creditBalance: newBalance, updatedAt: new Date() })
        .where(eq(patientWallets.id, wallet.id))
      const [rec] = await tx
        .insert(insuranceReconciliation)
        .values({
          companyId: body.companyId,
          patientId: body.patientId,
          cardNumber: body.cardNumber,
          treatmentSourceType: body.treatmentSourceType,
          treatmentSourceId: body.treatmentSourceId,
          chargedAmount,
          notes: body.notes ?? null,
          walletTransactionId: walletTx.id,
          recordedById: user.id,
        })
        .returning()
      const res = await postInsuranceReceivable(tx, {
        reconciliationId: rec.id,
        companyId: body.companyId,
        patientId: body.patientId,
        amount: chargedAmount,
        date: new Date(),
        createdBy: user.id,
      })
      if (!res.posted) throw new Error('RECEIVABLE_UNPOSTED')
      return rec
    })
  } catch (glErr) {
    logError(glErr, { context: 'insurance reconciliation POST (rolled back)' })
    return c.json(
      {
        error:
          'Could not record this insurance entry to the books (AR/credit account not set up, or the period is closed). Nothing was saved.',
      },
      409
    )
  }

  await createAuditLog(db, {
    userId: user.id,
    action: 'create',
    module: 'insurance',
    entityId: entry.id,
    entityName: `Insurance entry: ${company.name} — GHS ${(chargedAmount / 100).toFixed(2)}`,
    changes: body,
  })

  return c.json({ success: true, data: entry })
})

// PATCH /reconciliation/:id — Mark reconciled (enter insurerPaidAmount)
insuranceApp.patch('/reconciliation/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.INSURANCE as string, ACTIONS.UPDATE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const body = await c.req.json()
  const db = getDb(process.env.DATABASE_URL!)

  // §7.x: validate the insurer payment before recording it.
  if (body.insurerPaidAmount !== undefined) {
    const paid = Number(body.insurerPaidAmount)
    const [existing] = await db
      .select({
        chargedAmount: insuranceReconciliation.chargedAmount,
        insurerPaidAmount: insuranceReconciliation.insurerPaidAmount,
      })
      .from(insuranceReconciliation)
      .where(eq(insuranceReconciliation.id, id))
      .limit(1)
    if (!existing) return c.json({ error: 'Not found' }, 404)
    // Negative would inflate the bad-debt write-off and over-credit 1210.
    if (Number.isNaN(paid) || paid < 0) {
      return c.json({ error: 'Insurer payment must be zero or positive' }, 400)
    }
    // Overpay would push the debit-normal 1210 receivable negative.
    if (paid > Number(existing.chargedAmount)) {
      return c.json({ error: 'Insurer payment cannot exceed the charged amount' }, 400)
    }
    // A payment is already on the books — the payment/shortfall postings are
    // immutable (idempotent on the reconciliation id), so changing the amount here
    // would silently drift the GL. The correction path is delete + re-create
    // (DELETE reverses every entry). Reject an in-place change.
    if (existing.insurerPaidAmount != null && Number(existing.insurerPaidAmount) !== paid) {
      return c.json(
        {
          error:
            'A payment is already recorded for this entry. Delete and re-create it to change the amount.',
        },
        409
      )
    }
  }

  const updates: any = { updatedAt: new Date() }
  if (body.insurerPaidAmount !== undefined) {
    updates.insurerPaidAmount = Number(body.insurerPaidAmount)
    updates.reconciledAt = new Date()
  }
  if (body.notes !== undefined) updates.notes = body.notes

  const [row] = await db
    .update(insuranceReconciliation)
    .set(updates)
    .where(eq(insuranceReconciliation.id, id))
    .returning()
  if (!row) return c.json({ error: 'Not found' }, 404)

  // §7.x: when the insurer payment is entered, clear the receivable (best-effort).
  // Any shortfall (insurer under-paid the agreed amount, incl. a full denial) is
  // written off so 1210 clears fully — the clinic absorbs it, the patient is never
  // billed the gap. Posts once per reconciliation; a later correction is a known edge.
  if (body.insurerPaidAmount !== undefined) {
    const paid = Number(body.insurerPaidAmount)
    const charged = Number(row.chargedAmount)
    try {
      if (paid > 0) {
        await postInsurancePayment(db, {
          reconciliationId: id,
          companyId: row.companyId,
          amount: paid,
          date: new Date(),
          createdBy: user.id,
        })
      }
      const shortfall = charged - paid
      if (shortfall > 0) {
        await postInsuranceShortfall(db, {
          reconciliationId: id,
          companyId: row.companyId,
          amount: shortfall,
          date: new Date(),
          createdBy: user.id,
        })
      }
    } catch (glErr) {
      logError(glErr, { context: 'insurance payment/shortfall GL (non-fatal)' })
    }
  }

  await createAuditLog(db, {
    userId: user.id,
    action: 'update',
    module: 'insurance',
    entityId: id,
    entityName: 'Reconciliation',
    changes: updates,
  })

  return c.json({ success: true, data: row })
})

insuranceApp.delete('/reconciliation/:id', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.INSURANCE as string, ACTIONS.DELETE as string))) {
    return c.json({ error: 'Unauthorized' }, 403)
  }

  const id = c.req.param('id')
  const db = getDb(process.env.DATABASE_URL!)
  const [existing] = await db
    .select()
    .from(insuranceReconciliation)
    .where(eq(insuranceReconciliation.id, id))
    .limit(1)
  if (!existing) return c.json({ error: 'Not found' }, 404)

  // §7.x: reverse the GL (claim/payment/shortfall) + the wallet credit and delete
  // the row, all in ONE transaction so a failure can't leave a half-undone state.
  // A closed month blocks the reversal; a credit already spent blocks the delete.
  try {
    await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as typeof db
      // If the insurance-funded credit was already (partly) spent on a bill, the
      // wallet can't be cleanly clawed back — block rather than drive it negative.
      if (existing.walletTransactionId) {
        const [w] = await tx
          .select()
          .from(patientWallets)
          .where(eq(patientWallets.patientId, existing.patientId))
          .limit(1)
        if (w && (w.creditBalance ?? 0) < Number(existing.chargedAmount)) {
          throw new Error('CREDIT_SPENT')
        }
      }

      await reverseInsuranceGL(tx, id, user.id)

      // Reverse the wallet credit so the 2200 sub-ledger stays consistent with the GL.
      if (existing.walletTransactionId) {
        const [w] = await tx
          .select()
          .from(patientWallets)
          .where(eq(patientWallets.patientId, existing.patientId))
          .limit(1)
        if (w) {
          const amt = Number(existing.chargedAmount)
          const newBal = (w.creditBalance ?? 0) - amt
          await tx.insert(walletTransactions).values({
            walletId: w.id,
            patientId: existing.patientId,
            type: 'debit',
            amount: amt,
            sourceType: 'insurance',
            description: 'Reversal: insurance reconciliation deleted',
            balanceBefore: w.creditBalance ?? 0,
            balanceAfter: newBal,
            createdById: user.id,
          })
          await tx
            .update(patientWallets)
            .set({ creditBalance: newBal, updatedAt: new Date() })
            .where(eq(patientWallets.id, w.id))
        }
      }

      await tx.delete(insuranceReconciliation).where(eq(insuranceReconciliation.id, id))
    })
  } catch (err) {
    const msg = String((err as Error)?.message ?? err)
    if (msg.includes('CREDIT_SPENT')) {
      return c.json(
        {
          error:
            'This insurance credit has already been used on a bill. Reverse the payment that used it before deleting.',
        },
        409
      )
    }
    logError(err, { context: 'insurance delete: reversal blocked' })
    return c.json(
      { error: 'This entry posts into a closed accounting month. Reopen the month first.' },
      409
    )
  }

  await createAuditLog(db, {
    userId: user.id,
    action: 'delete',
    module: 'insurance',
    entityId: id,
    entityName: 'Reconciliation (reversed)',
  })

  return c.json({ success: true })
})

export { insuranceApp }
