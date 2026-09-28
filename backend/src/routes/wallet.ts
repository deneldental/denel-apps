import { desc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { walletTransactions } from '../db/schema'
import {
  autoSettleInvoices,
  creditWallet,
  getOrCreateWallet,
  writeTimeline,
} from '../lib/ledger-service'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'

const walletApp = new Hono<HonoEnv>()

// GET /api/wallet/patient/:patientId — wallet summary + transaction history
walletApp.get('/patient/:patientId', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { patientId } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)

  const wallet = await getOrCreateWallet(db, patientId)

  const transactions = await db.query.walletTransactions.findMany({
    where: eq(walletTransactions.patientId, patientId),
    orderBy: [desc(walletTransactions.createdAt)],
  })

  return c.json({ success: true, data: { wallet, transactions } })
})

// POST /api/wallet/patient/:patientId/credit — manually add credit (adjustment)
walletApp.post('/patient/:patientId/credit', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { patientId } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  const body = await c.req.json()

  if (!body.amount || body.amount <= 0) {
    return c.json({ error: 'amount must be a positive number' }, 400)
  }

  const { wallet, transaction } = await creditWallet(
    db,
    patientId,
    body.amount,
    'adjustment',
    null,
    body.description || 'Manual credit adjustment',
    user.id
  )

  await writeTimeline(
    db,
    patientId,
    'wallet_credit',
    `Wallet credited — GHS ${(body.amount / 100).toFixed(2)}`,
    {
      referenceType: 'wallet_transaction',
      referenceId: transaction.id,
      amount: body.amount,
      createdById: user.id,
    }
  )

  return c.json({ success: true, data: { wallet, transaction } })
})

// POST /api/wallet/patient/:patientId/allocate — allocate unallocated credit to an invoice
walletApp.post('/patient/:patientId/allocate', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const { patientId } = c.req.param()
  const db = getDb(process.env.DATABASE_URL!)
  const body = await c.req.json() // { invoiceId, amount }

  if (!body.invoiceId) return c.json({ error: 'invoiceId required' }, 400)
  if (!body.amount || body.amount <= 0) return c.json({ error: 'amount must be positive' }, 400)

  const wallet = await getOrCreateWallet(db, patientId)
  if (wallet.creditBalance < body.amount) {
    return c.json(
      {
        error: `Insufficient wallet balance. Available: GHS ${(wallet.creditBalance / 100).toFixed(2)}`,
      },
      400
    )
  }

  const settled = await autoSettleInvoices(db, patientId, null, body.amount, user.id)

  return c.json({ success: true, data: { settled } })
})

export { walletApp }
