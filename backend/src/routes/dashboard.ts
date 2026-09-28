import { addDays, endOfDay, isSameDay, startOfDay, subDays } from 'date-fns'
import { and, asc, desc, eq, gte, lte, or, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import {
  appointments,
  dailyReports,
  expenses,
  items,
  medicalRecords,
  orthoConsentForms,
  patients,
  payments,
  pendingMedicalRecords,
} from '../db/schema'
import { cache } from '../lib/cache'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES, ROLES } from '../lib/modules'
import { type AuthUser, checkPermission, getCurrentUser } from '../lib/rbac'
import { getLowStockThreshold } from '../lib/settings-store'
import type { HonoEnv } from '../lib/types'

const dashboardApp = new Hono<HonoEnv>()

// Stats endpoints are read-heavy and tolerate 30s of staleness for KPIs.
const STATS_CACHE_TTL_SECONDS = 30

async function memoizedStats<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const cached = cache.get<T>(key)
  if (cached !== null) return cached
  const fresh = await compute()
  cache.set(key, fresh, STATS_CACHE_TTL_SECONDS)
  return fresh
}

// Admin sees clinic-wide revenue/expense; others must not.
function isAdminUser(user: AuthUser): boolean {
  return user.roleId === ROLES.ADMIN
}

function isDoctorUser(user: AuthUser): boolean {
  return user.roleId === ROLES.DOCTOR
}

function isReceptionistUser(user: AuthUser): boolean {
  return user.roleId === ROLES.RECEPTIONIST
}

type Period = 'day' | 'week' | 'month'

function resolvePeriod(raw: string | undefined, fallback: Period): Period {
  return raw === 'day' || raw === 'week' || raw === 'month' ? raw : fallback
}

function windowForPeriod(period: Period): { startDate: Date; endDate: Date } {
  const now = new Date()
  const endDate = endOfDay(now)
  switch (period) {
    case 'day':
      return { startDate: startOfDay(now), endDate }
    case 'week':
      return { startDate: startOfDay(subDays(now, 7)), endDate }
    default:
      return { startDate: startOfDay(subDays(now, 30)), endDate }
  }
}

dashboardApp.get('/stats', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!isAdminUser(user)) return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const period = resolvePeriod(c.req.query('period'), 'month')
  const db = getDb(process.env.DATABASE_URL!)
  const { startDate, endDate } = windowForPeriod(period)

  try {
    const data = await memoizedStats(`dashboard:stats:admin:${period}`, async () => {
      const [totalPatientsResult, totalRevenueResult, totalExpensesResult, appointmentsStats] =
        await Promise.all([
          db
            .select({ count: sql<number>`cast(count(*) as integer)` })
            .from(patients)
            .where(and(gte(patients.createdAt, startDate), lte(patients.createdAt, endDate))),
          db
            .select({ total: sql<number>`cast(coalesce(sum(${payments.amount}), 0) as integer)` })
            .from(payments)
            .where(
              and(
                gte(payments.createdAt, startDate),
                lte(payments.createdAt, endDate),
                eq(payments.status, 'posted')
              )
            ),
          db
            .select({ total: sql<number>`cast(coalesce(sum(${expenses.amount}), 0) as integer)` })
            .from(expenses)
            .where(
              and(
                gte(expenses.date, startDate),
                lte(expenses.date, endDate),
                // Option A: only expenses ON THE BOOKS count (matches the GL P&L).
                sql`EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_doc_type = 'expense' AND je.is_reversal = false AND je.source_doc_id = ${expenses.id})`
              )
            ),
          db
            .select({ status: appointments.status, count: sql<number>`cast(count(*) as integer)` })
            .from(appointments)
            .where(and(gte(appointments.date, startDate), lte(appointments.date, endDate)))
            .groupBy(appointments.status),
        ])

      const checkedIn = appointmentsStats.find((s) => s.status === 'completed')?.count || 0
      const booked = appointmentsStats.reduce(
        (sum, s) => (s.status === 'scheduled' || s.status === 'completed' ? sum + s.count : sum),
        0
      )

      return {
        totalPatients: totalPatientsResult[0]?.count || 0,
        totalRevenue: totalRevenueResult[0]?.total || 0,
        totalExpenses: totalExpensesResult[0]?.total || 0,
        checkedIn,
        booked,
      }
    })

    return c.json({ success: true, data })
  } catch (error) {
    logError(error, { route: 'dashboard.stats', userId: user.id, period })
    return c.json({ error: 'Failed to fetch stats', code: 'DASHBOARD_STATS_FAILED' }, 500)
  }
})

dashboardApp.get('/doctor/stats', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!isDoctorUser(user) && !isAdminUser(user))
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const now = new Date()
  const todayStart = startOfDay(now)
  const todayEnd = endOfDay(now)

  try {
    const data = await memoizedStats('dashboard:stats:doctor', async () => {
      const [newPatients, signedConsentForms, pendingMedicalRecordsCount, todayAppointments] =
        await Promise.all([
          db
            .select({ count: sql<number>`cast(count(*) as integer)` })
            .from(patients)
            .where(and(gte(patients.createdAt, todayStart), lte(patients.createdAt, todayEnd))),
          db
            .select({ count: sql<number>`cast(count(*) as integer)` })
            .from(orthoConsentForms)
            .where(eq(orthoConsentForms.status, 'signed')),
          db
            .select({ count: sql<number>`cast(count(*) as integer)` })
            .from(pendingMedicalRecords)
            .where(eq(pendingMedicalRecords.status, 'pending')),
          db
            .select({ status: appointments.status, count: sql<number>`cast(count(*) as integer)` })
            .from(appointments)
            .where(and(gte(appointments.date, todayStart), lte(appointments.date, todayEnd)))
            .groupBy(appointments.status),
        ])

      const todayCheckedIn = todayAppointments.find((s) => s.status === 'completed')?.count || 0
      const todayBooked = todayAppointments.reduce(
        (sum, s) => (s.status === 'scheduled' || s.status === 'completed' ? sum + s.count : sum),
        0
      )

      return {
        newPatients: newPatients[0]?.count || 0,
        signedConsentForms: signedConsentForms[0]?.count || 0,
        pendingMedicalRecords: pendingMedicalRecordsCount[0]?.count || 0,
        todayCheckedIn,
        todayBooked,
      }
    })

    return c.json({ success: true, data })
  } catch (error) {
    logError(error, { route: 'dashboard.doctor.stats', userId: user.id })
    return c.json({ error: 'Failed to fetch doctor stats', code: 'DOCTOR_STATS_FAILED' }, 500)
  }
})

dashboardApp.get('/receptionist/stats', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!isReceptionistUser(user) && !isAdminUser(user))
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const period = resolvePeriod(c.req.query('period'), 'day')
  const db = getDb(process.env.DATABASE_URL!)
  const { startDate, endDate } = windowForPeriod(period)

  try {
    const data = await memoizedStats(`dashboard:stats:receptionist:${period}`, async () => {
      const [totalPatients, paymentsTotal, expensesTotal, appointmentsStats] = await Promise.all([
        db.select({ count: sql<number>`cast(count(*) as integer)` }).from(patients),
        db
          .select({ total: sql<number>`cast(coalesce(sum(${payments.amount}), 0) as integer)` })
          .from(payments)
          .where(
            and(
              gte(payments.createdAt, startDate),
              lte(payments.createdAt, endDate),
              eq(payments.status, 'posted')
            )
          ),
        db
          .select({ total: sql<number>`cast(coalesce(sum(${expenses.amount}), 0) as integer)` })
          .from(expenses)
          .where(
            and(
              gte(expenses.date, startDate),
              lte(expenses.date, endDate),
              // Option A: only expenses ON THE BOOKS count (matches the GL P&L).
              sql`EXISTS (SELECT 1 FROM journal_entries je WHERE je.source_doc_type = 'expense' AND je.is_reversal = false AND je.source_doc_id = ${expenses.id})`
            )
          ),
        db
          .select({ status: appointments.status, count: sql<number>`cast(count(*) as integer)` })
          .from(appointments)
          .where(and(gte(appointments.date, startDate), lte(appointments.date, endDate)))
          .groupBy(appointments.status),
      ])

      const checkedIn = appointmentsStats.find((s) => s.status === 'completed')?.count || 0
      const booked = appointmentsStats.reduce(
        (sum, s) => (s.status === 'scheduled' || s.status === 'completed' ? sum + s.count : sum),
        0
      )

      return {
        totalPatients: totalPatients[0]?.count || 0,
        todayPayments: paymentsTotal[0]?.total || 0,
        todayExpenses: expensesTotal[0]?.total || 0,
        todayCheckedIn: checkedIn,
        todayBooked: booked,
      }
    })

    return c.json({ success: true, data })
  } catch (error) {
    logError(error, { route: 'dashboard.receptionist.stats', userId: user.id, period })
    return c.json(
      { error: 'Failed to fetch receptionist stats', code: 'RECEPTIONIST_STATS_FAILED' },
      500
    )
  }
})

dashboardApp.get('/upcoming-appointments', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.APPOINTMENTS as string, ACTIONS.READ as string)))
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const limit = parseInt(c.req.query('limit') || '10', 10)
  const db = getDb(process.env.DATABASE_URL!)
  const now = new Date()

  try {
    const data = await db.query.appointments.findMany({
      where: and(
        gte(appointments.date, startOfDay(now)),
        or(eq(appointments.status, 'scheduled'), eq(appointments.status, 'completed'))
      ),
      orderBy: [asc(appointments.date)],
      limit,
      with: {
        patient: { columns: { name: true, phone: true } },
        doctor: { with: { user: { columns: { name: true } } } },
      },
    })
    return c.json({ success: true, data })
  } catch (error) {
    logError(error, { route: 'dashboard.upcoming-appointments', userId: user.id })
    return c.json(
      { error: 'Failed to fetch upcoming appointments', code: 'UPCOMING_APPTS_FAILED' },
      500
    )
  }
})

dashboardApp.get('/recent-reports', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.REPORTS as string, ACTIONS.READ as string)))
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const limit = parseInt(c.req.query('limit') || '7', 10)
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const data = await db.query.dailyReports.findMany({
      orderBy: [desc(dailyReports.reportDate)],
      limit,
      with: { submittedBy: true },
    })
    return c.json({ success: true, data })
  } catch (error) {
    logError(error, { route: 'dashboard.recent-reports', userId: user.id })
    return c.json({ error: 'Failed to fetch recent reports', code: 'RECENT_REPORTS_FAILED' }, 500)
  }
})

dashboardApp.get('/low-stock', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.INVENTORY as string, ACTIONS.READ as string)))
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const limit = parseInt(c.req.query('limit') || '10', 10)
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const threshold = await getLowStockThreshold(db)

    // §12.1 — single low-stock query over the unified catalog (was a separate
    // products + inventory union); `source` carries the legacy product|inventory tag.
    const all = await db
      .select({
        id: items.id,
        name: items.name,
        stockQuantity: items.stockQuantity,
        reorderLevel: items.reorderLevel,
        unit: items.unit,
        type: sql<string>`coalesce(${items.source}, 'item')`,
      })
      .from(items)
      .where(lte(items.stockQuantity, threshold))
      .orderBy(asc(items.stockQuantity))
      .limit(limit)
    return c.json({ success: true, data: all })
  } catch (error) {
    logError(error, { route: 'dashboard.low-stock', userId: user.id })
    return c.json({ error: 'Failed to fetch low stock', code: 'LOW_STOCK_FAILED' }, 500)
  }
})

dashboardApp.get('/recent-medical-records', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (
    !(await checkPermission(c, user.id, MODULES.MEDICAL_RECORDS as string, ACTIONS.READ as string))
  )
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const limit = parseInt(c.req.query('limit') || '10', 10)
  const db = getDb(process.env.DATABASE_URL!)

  try {
    const data = await db.query.medicalRecords.findMany({
      orderBy: [desc(medicalRecords.createdAt)],
      limit,
      with: { patient: true, doctor: { with: { user: true } } },
    })
    return c.json({ success: true, data })
  } catch (error) {
    logError(error, { route: 'dashboard.recent-medical-records', userId: user.id })
    return c.json(
      { error: 'Failed to fetch recent medical records', code: 'RECENT_RECORDS_FAILED' },
      500
    )
  }
})

dashboardApp.get('/alerts', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PATIENTS as string, ACTIONS.READ as string)))
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const now = new Date()
  const sevenDaysFromNow = addDays(now, 7)

  try {
    // Birthdays: do the MM-DD window filtering in SQL so we don't pull the
    // entire patients table into memory. Handles the year-end wrap (e.g. now
    // is Dec 28 → window ends Jan 4) via the OR branch.
    const todayMd = `${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`
    const endMd = `${(sevenDaysFromNow.getMonth() + 1).toString().padStart(2, '0')}-${sevenDaysFromNow.getDate().toString().padStart(2, '0')}`
    const wraps = todayMd > endMd

    const birthdayRows = await db
      .select({
        id: patients.id,
        name: patients.name,
        phone: patients.phone,
        dob: patients.dob,
        profileImage: patients.profileImage,
      })
      .from(patients)
      .where(
        wraps
          ? sql`to_char(${patients.dob}, 'MM-DD') >= ${todayMd}
                OR to_char(${patients.dob}, 'MM-DD') <= ${endMd}`
          : sql`to_char(${patients.dob}, 'MM-DD') BETWEEN ${todayMd} AND ${endMd}`
      )

    const upcomingBirthdays = birthdayRows.map((p) => {
      const dob = new Date(p.dob!)
      let bday = new Date(now.getFullYear(), dob.getMonth(), dob.getDate())
      if (bday < startOfDay(now))
        bday = new Date(now.getFullYear() + 1, dob.getMonth(), dob.getDate())
      return {
        ...p,
        type: 'birthday' as const,
        date: bday,
        isToday: isSameDay(bday, now),
        isTomorrow: isSameDay(bday, addDays(now, 1)),
      }
    })

    const followupDate = subDays(now, 30)
    const completedApps = await db.query.appointments.findMany({
      where: and(
        gte(appointments.date, followupDate),
        lte(appointments.date, now),
        eq(appointments.status, 'completed')
      ),
      orderBy: [desc(appointments.date)],
      limit: 10,
      with: { patient: true },
    })

    const followups = completedApps.map((a) => ({
      id: a.patient.id,
      name: a.patient.name,
      phone: a.patient.phone,
      profileImage: a.patient.profileImage,
      type: 'followup',
      date: a.date,
      appointmentId: a.id,
    }))

    return c.json({ success: true, data: { birthdays: upcomingBirthdays, followups } })
  } catch (error) {
    logError(error, { route: 'dashboard.alerts', userId: user.id })
    return c.json({ error: 'Failed to fetch alerts', code: 'ALERTS_FAILED' }, 500)
  }
})

export { dashboardApp }
