import { parse } from 'csv-parse/browser/esm/sync'
import { format } from 'date-fns'
import { and, eq, gte, lt } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import { expenseCategories, expenses, payments } from '../db/schema'
import {
  getAccountByCode,
  type PaymentMethod,
  resolveChannelAccountId,
} from '../lib/channel-accounts'
import { ensureExpensePosted } from '../lib/expense-service'
import { FINANCE_ACCOUNTS } from '../lib/finance-accounts'
import { postJournalEntry } from '../lib/gl-service'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import type { HonoEnv } from '../lib/types'
import { DateParamError, parseQueryDate } from '../lib/validate-date'

// Returns [startOfDay, startOfNextDay) in UTC for a given UTC date string
function utcDayRange(date: Date): [Date, Date] {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const end = new Date(start.getTime() + 86_400_000) // +1 day
  return [start, end]
}

// Returns [startOfYear, startOfNextYear) in UTC
function utcYearRange(date: Date): [Date, Date] {
  const y = date.getUTCFullYear()
  return [new Date(Date.UTC(y, 0, 1)), new Date(Date.UTC(y + 1, 0, 1))]
}

// Returns [startOfMonth, startOfNextMonth) in UTC
function utcMonthRange(date: Date): [Date, Date] {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth()
  return [new Date(Date.UTC(y, m, 1)), new Date(Date.UTC(y, m + 1, 1))]
}

// Returns [startOfWeek Mon, startOfNextWeek Mon) in UTC
function utcWeekRange(date: Date): [Date, Date] {
  const day = date.getUTCDay() // 0=Sun, 1=Mon, ..., 6=Sat
  const diffToMon = day === 0 ? -6 : 1 - day // days to subtract to reach Monday
  const mon = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + diffToMon)
  )
  const nextMon = new Date(mon.getTime() + 7 * 86_400_000)
  return [mon, nextMon]
}

const financialsApp = new Hono<HonoEnv>()

financialsApp.get('/daily', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const dateStr = c.req.query('date') || new Date().toISOString()
  const page = parseInt(c.req.query('page') || '1', 10)
  const pageSize = parseInt(c.req.query('pageSize') || '20', 10)

  let date: Date
  try {
    date = parseQueryDate(dateStr, new Date())
  } catch (err) {
    if (err instanceof DateParamError) return c.json({ error: err.message }, 400)
    throw err
  }
  const [startDate, endDate] = utcDayRange(date)

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const dailyPayments = await db.query.payments.findMany({
      where: and(
        gte(payments.createdAt, startDate),
        lt(payments.createdAt, endDate),
        eq(payments.status, 'posted')
      ),
    })

    const dailyExpenses = await db.query.expenses.findMany({
      where: and(gte(expenses.date, startDate), lt(expenses.date, endDate)),
    })

    const allTransactions = [
      ...dailyPayments.map((p) => ({
        id: p.id,
        type: 'income',
        category: 'Payment',
        amount: p.amount,
        description: p.description,
        date: p.createdAt.toISOString(),
        paymentMethod: p.method,
      })),
      ...dailyExpenses.map((e) => ({
        id: e.id,
        type: 'expense',
        category: 'Expense',
        amount: e.amount,
        description: e.description ? `${e.category} - ${e.description}` : e.category,
        date: e.date.toISOString(),
        paymentMethod: e.paymentMethod || undefined,
      })),
    ]

    const sorted = allTransactions.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )
    const total = sorted.length
    const totalPages = Math.ceil(total / pageSize)
    const offset = (page - 1) * pageSize
    const paged = sorted.slice(offset, offset + pageSize)

    return c.json({
      success: true,
      data: {
        transactions: paged,
        pagination: { page, pageSize, total, totalPages },
      },
    })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed' }, 500)
  }
})

financialsApp.get('/records', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const view = c.req.query('view') || 'month'
  const dateStr = c.req.query('date') || new Date().toISOString()

  let date: Date
  try {
    date = parseQueryDate(dateStr, new Date())
  } catch (err) {
    if (err instanceof DateParamError) return c.json({ error: err.message }, 400)
    throw err
  }
  let startDate: Date
  let endDate: Date // exclusive upper bound
  let intervals: Date[]
  let getLabel: (d: Date) => string
  let getKey: (d: Date) => string

  if (view === 'week') {
    // UTC Monday-based week — must match WeekSelector on the frontend
    ;[startDate, endDate] = utcWeekRange(date)
    const days: Date[] = []
    for (let d = new Date(startDate); d < endDate; d = new Date(d.getTime() + 86_400_000)) {
      days.push(new Date(d))
    }
    intervals = days
    getLabel = (d) => format(d, 'EEE')
    getKey = (d) => d.toISOString().slice(0, 10) // yyyy-MM-dd in UTC
  } else if (view === 'month') {
    ;[startDate, endDate] = utcMonthRange(date)
    const days: Date[] = []
    for (let d = new Date(startDate); d < endDate; d = new Date(d.getTime() + 86_400_000)) {
      days.push(new Date(d))
    }
    intervals = days
    getLabel = (d) => String(d.getUTCDate())
    getKey = (d) => d.toISOString().slice(0, 10) // yyyy-MM-dd in UTC
  } else {
    // year
    ;[startDate, endDate] = utcYearRange(date)
    const months: Date[] = []
    for (let m = 0; m < 12; m++) {
      months.push(new Date(Date.UTC(date.getUTCFullYear(), m, 1)))
    }
    intervals = months
    getLabel = (d) => format(d, 'MMM')
    getKey = (d) => d.toISOString().slice(0, 7) // yyyy-MM in UTC
  }

  const db = getDb(process.env.DATABASE_URL!)
  try {
    const periodPayments = await db.query.payments.findMany({
      where: and(
        gte(payments.createdAt, startDate),
        lt(payments.createdAt, endDate),
        eq(payments.status, 'posted')
      ),
    })

    const periodExpenses = await db.query.expenses.findMany({
      where: and(gte(expenses.date, startDate), lt(expenses.date, endDate)),
    })

    const allTransactions = [
      ...periodPayments.map((p) => ({
        id: p.id,
        type: 'income',
        category: 'Payment',
        amount: p.amount,
        description: p.description,
        date: p.createdAt.toISOString(),
        paymentMethod: p.method,
      })),
      ...periodExpenses.map((e) => ({
        id: e.id,
        type: 'expense',
        category: 'Expense',
        amount: Number(e.amount),
        description: e.description ? `${e.category} - ${e.description}` : e.category,
        date: e.date.toISOString(),
        paymentMethod: e.paymentMethod || undefined,
      })),
    ]

    let totalIncome = 0
    let totalExpenses = 0
    const recordsMap = new Map<string, any>()

    intervals.forEach((d) => {
      const key = getKey(d)
      recordsMap.set(key, {
        date: d.toISOString(),
        label: getLabel(d),
        income: 0,
        expenses: 0,
        balance: 0,
        transactions: [],
      })
    })

    allTransactions.forEach((t) => {
      const iso = new Date(t.date).toISOString()
      const key = view === 'year' ? iso.slice(0, 7) : iso.slice(0, 10)
      if (recordsMap.has(key)) {
        const record = recordsMap.get(key)!
        if (t.type === 'income') {
          record.income += t.amount
          totalIncome += t.amount
        } else {
          record.expenses += t.amount
          totalExpenses += t.amount
        }
        record.balance = record.income - record.expenses
        record.transactions.push(t)
      }
    })

    const records = Array.from(recordsMap.values())

    return c.json({
      success: true,
      data: {
        totalIncome,
        totalExpenses,
        netProfit: totalIncome - totalExpenses,
        netBalance: totalIncome - totalExpenses,
        transactionCount: allTransactions.length,
        records,
        pagination: { page: 1, pageSize: 31, total: records.length, totalPages: 1 },
      },
    })
  } catch (_error: unknown) {
    return c.json({ error: 'Failed to fetch financial records' }, 500)
  }
})

financialsApp.post('/import', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.CREATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  try {
    const body = await c.req.parseBody()
    const file = body.file as File
    if (!file) return c.json({ error: 'No file' }, 400)

    const text = await file.text()
    const db = getDb(process.env.DATABASE_URL!)

    const validCats = await db.select().from(expenseCategories)
    const validNames = validCats.map((cv) => cv.name.toLowerCase())

    const parsedData = parse(text, { columns: true, skip_empty_lines: true, trim: true }) as any[]
    const errors: string[] = []
    const records = []

    for (const [index, row] of parsedData.entries()) {
      const rowNum = index + 2
      const type = String(row.Type || '').toLowerCase()
      // The CSV is human-facing cedis; DB amounts (expenses/payments/GL) are integer pesewas (cents).
      const rawAmount = parseFloat(String(row.Amount || ''))
      const date = new Date(row.Date)

      if (Number.isNaN(rawAmount) || rawAmount < 0) {
        errors.push(`Row ${rowNum}: Invalid Amount`)
        continue
      }
      const amount = Math.round(rawAmount * 100)
      if (type !== 'income' && type !== 'expense') {
        errors.push(`Row ${rowNum}: Invalid Type`)
        continue
      }

      if (type === 'expense' && !validNames.includes(String(row.Category || '').toLowerCase())) {
        errors.push(`Row ${rowNum}: Invalid Category '${row.Category}'`)
        continue
      }

      records.push({
        date,
        type,
        category: row.Category,
        amount,
        description: row.Description,
        method: row.Method || 'cash',
      })
    }

    if (errors.length > 0) return c.json({ success: false, errors }, 400)

    for (const record of records) {
      if (record.type === 'expense') {
        const [imported] = await db
          .insert(expenses)
          .values({
            category: record.category,
            amount: record.amount,
            date: record.date,
            description: record.description,
            paymentMethod: record.method,
          })
          .returning()
        // Phase 4: post it (best-effort; old dates surface on the unposted list).
        try {
          await ensureExpensePosted(db, imported, user.id)
        } catch (glError) {
          logError(glError, { context: 'imported expense GL posting (non-fatal)' })
        }
      } else {
        // Imported income has no patient context (the CSV carries no patientId),
        // so we can't route it through recordLegacyPayment (which requires a
        // patient + builds AR allocations). Instead post a balanced JE directly:
        // DR Cash/Bank (by method) / CR Retail Sales Revenue (4200, the misc-
        // income revenue account in FINANCE_ACCOUNTS). This makes the row GL-
        // visible and lets us stamp a valid status ('posted' — the
        // payments_status_check allows only draft|posted|reversed; the old
        // 'completed' violated it).
        const description =
          record.category !== 'Payment'
            ? `${record.category} - ${record.description}`
            : record.description
        const cashAccountId = await resolveChannelAccountId(db, record.method as PaymentMethod)
        const revenueAccount = await getAccountByCode(db, FINANCE_ACCOUNTS.RETAIL_REVENUE)

        const entry = await postJournalEntry(db, {
          entryDate: record.date,
          sourceDocType: 'manual',
          description: description ?? 'Imported income',
          createdBy: user.id,
          lines: [
            { accountId: cashAccountId, debit: record.amount, description: description ?? null },
            {
              accountId: revenueAccount.id,
              credit: record.amount,
              description: description ?? null,
            },
          ],
        })

        await db.insert(payments).values({
          amount: record.amount,
          method: record.method,
          status: 'posted',
          // No invoice/patient context — the full amount sits unallocated,
          // matching payments_amount_split_check (allocated + unallocated = amount).
          allocatedAmount: 0,
          unallocatedAmount: record.amount,
          description,
          channelAccountId: cashAccountId,
          journalEntryId: entry.id,
          postedAt: new Date(),
          createdAt: record.date,
        })
      }
    }

    return c.json({ success: true, message: `Imported ${records.length} records` })
  } catch (e: unknown) {
    const pgErr = e as { message?: string }
    return c.json({ error: pgErr.message }, 500)
  }
})

export { financialsApp }
