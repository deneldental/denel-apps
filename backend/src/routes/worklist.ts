/**
 * worklist.ts — the "Activity" visit-worklist lens (build plan P2).
 *
 * Activity is NOT a new entity — it is a read lens over today's visits
 * (appointments) enriched with billing + clinical state. Two lenses:
 *   • GET /doctor    — the doctor's day-sheet queue (their visits; the
 *                      `awaiting_estimate` subset is price-actionable).
 *   • GET /reception — the same visits through a billing lens (estimate_ready
 *                      → Confirm & Accept Payment; checked_in direct-bill).
 *
 * Route base is /api/worklist (NOT /api/activities — that name is taken by an
 * unrelated dashboard action-items feature).
 */

import { randomUUID } from 'node:crypto'
import { Money } from '@denel/utils'
import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { type DB, getDb } from '../db'
import {
  appointments,
  doctors,
  invoiceLines,
  invoices,
  medicalRecords,
  patients,
  pendingMedicalRecords,
  prescriptions,
  treatmentPlanItems,
  treatmentPlans,
  user as userTable,
} from '../db/schema'
import type { PaymentMethod } from '../lib/channel-accounts'
import {
  resolveDoctorForUser,
  resolveDoctorIdForUser,
  resolveLoginUserIdForDoctor,
} from '../lib/doctor-identity'
import { createEstimateDraft, EstimateValidationError } from '../lib/estimate-service'
import { issueInvoice } from '../lib/invoice-service'
import { logError } from '../lib/logger'
import { ACTIONS, MODULES } from '../lib/modules'
import { ensureCaseForPlan } from '../lib/patient-case-service'
import { sendPaymentConfirmationSms } from '../lib/payment-confirmation-sms'
import { createDraftPayment, postPayment } from '../lib/payment-service'
import { checkPermission, getCurrentUser } from '../lib/rbac'
import { getInvoiceFundingBatch } from '../lib/treatment-funding'
import type { HonoEnv } from '../lib/types'

export const worklistApp = new Hono<HonoEnv>()

const MODULE = MODULES.APPOINTMENTS

// Non-terminal statuses that belong on an active worklist.
const ACTIVE_STATUSES = ['scheduled', 'confirmed', 'checked_in', 'in_chair']

/** ?date=YYYY-MM-DD → [dayStart, nextDayStart). Defaults to the server's today. */
function dayRange(dateStr?: string): { start: Date; end: Date; iso: string } {
  const base = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date()
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const iso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
  return { start, end, iso }
}

export interface WorklistVisit {
  appointmentId: string
  /** Payment gate: treatment cannot start until the estimate is funded. */
  treatmentBlocked?: boolean
  treatmentBlockedReason?: string | null
  patientId: string | null
  patientName: string
  patientPhone: string | null
  doctorId: string | null
  doctorName: string | null
  date: string
  status: string
  type: string
  requiresEstimate: boolean
  estimateStatus: string | null
  checkedInAt: string | null
  hasPendingNote: boolean
  estimateInvoiceId: string | null
  estimateTotal: number | null
  estimateInvoiceStatus: string | null
  treatmentPlanId: string | null
}

/**
 * Which standalone estimates (draft one-time invoices with no visit) a lens lists.
 * Chosen by the caller, never defaulted: listing them all on a doctor's sheet put
 * every patient's name, phone and estimate total in front of every doctor (F16).
 */
type StandaloneScope =
  | { kind: 'all' } // reception, and an admin viewing every doctor
  | { kind: 'createdBy'; userId: string } // a doctor: only the ones they wrote
  | { kind: 'none' }

/**
 * Load the day's active visits enriched with the estimate (draft/issued invoice
 * linked to the visit) and the pending-clinical-note flag.
 */
async function loadVisits(
  db: ReturnType<typeof getDb>,
  opts: { start: Date; end: Date; doctorId?: string; standalone: StandaloneScope }
): Promise<WorklistVisit[]> {
  const conds = [
    gte(appointments.date, opts.start),
    lt(appointments.date, opts.end),
    inArray(appointments.status, ACTIVE_STATUSES),
  ]
  if (opts.doctorId) conds.push(eq(appointments.doctorId, opts.doctorId))

  const rows = await db
    .select({
      appointmentId: appointments.id,
      patientId: appointments.patientId,
      patientName: patients.name,
      patientPhone: patients.phone,
      doctorId: appointments.doctorId,
      doctorName: userTable.name,
      date: appointments.date,
      status: appointments.status,
      type: appointments.type,
      requiresEstimate: appointments.requiresEstimate,
      estimateStatus: appointments.estimateStatus,
      checkedInAt: appointments.checkedInAt,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .leftJoin(doctors, eq(doctors.id, appointments.doctorId))
    .leftJoin(userTable, eq(userTable.id, doctors.userId))
    .where(and(...conds))
    .orderBy(appointments.date)

  const apptIds = rows.map((r) => r.appointmentId)

  // Estimate = the invoice linked to the visit (draft while pending, issued after
  // reception confirms). Newest wins if more than one.
  const invRows = apptIds.length
    ? await db
        .select({
          id: invoices.id,
          appointmentId: invoices.appointmentId,
          total: invoices.total,
          status: invoices.status,
          invoiceNumber: invoices.invoiceNumber,
        })
        .from(invoices)
        .where(inArray(invoices.appointmentId, apptIds))
    : []
  const invByAppt = new Map<string, (typeof invRows)[number]>()
  for (const inv of invRows) {
    if (inv.appointmentId && !invByAppt.has(inv.appointmentId))
      invByAppt.set(inv.appointmentId, inv)
  }

  // Plans are resolved by their invoice link (0208), not by title or by date.
  const patientIds = rows.map((r) => r.patientId)
  const plans = patientIds.length
    ? await db
        .select({
          id: treatmentPlans.id,
          patientId: treatmentPlans.patientId,
          sourceInvoiceId: treatmentPlans.sourceInvoiceId,
        })
        .from(treatmentPlans)
        .where(inArray(treatmentPlans.patientId, patientIds))
    : []
  const planByInvoice = new Map<string, (typeof plans)[number]>()
  for (const pl of plans) {
    if (pl.sourceInvoiceId && !planByInvoice.has(pl.sourceInvoiceId)) {
      planByInvoice.set(pl.sourceInvoiceId, pl)
    }
  }

  const pendRows = apptIds.length
    ? await db
        .select({ appointmentId: pendingMedicalRecords.appointmentId })
        .from(pendingMedicalRecords)
        .where(
          and(
            inArray(pendingMedicalRecords.appointmentId, apptIds),
            eq(pendingMedicalRecords.status, 'pending')
          )
        )
    : []
  const pendingSet = new Set(pendRows.map((p) => p.appointmentId).filter(Boolean) as string[])

  // Whether treatment is payment-blocked, decided by the same rule the gate
  // enforces — not re-derived on the client, which cannot see payment plans or
  // insurance cover and would badge a plan-covered visit as blocked.
  const funding = await getInvoiceFundingBatch(
    db,
    invRows.map((i) => i.id)
  )

  const baseVisits = rows.map((r) => {
    const inv = invByAppt.get(r.appointmentId) ?? null
    // Was: match on `title.includes(invoiceNumber)` OR "any plan created today".
    // The first broke on rename, the second attached unrelated plans to a visit.
    const plan = inv ? (planByInvoice.get(inv.id) ?? null) : null
    return {
      appointmentId: r.appointmentId,
      patientId: r.patientId,
      patientName: r.patientName,
      patientPhone: r.patientPhone ?? null,
      doctorId: r.doctorId,
      doctorName: r.doctorName ?? null,
      date: r.date instanceof Date ? r.date.toISOString() : String(r.date),
      status: r.status,
      type: r.type,
      requiresEstimate: r.requiresEstimate,
      estimateStatus: r.estimateStatus ?? null,
      checkedInAt: r.checkedInAt instanceof Date ? r.checkedInAt.toISOString() : null,
      hasPendingNote: pendingSet.has(r.appointmentId),
      /** Payment gate: true when treatment cannot start yet. Server-decided. */
      treatmentBlocked: inv ? !(funding.get(inv.id)?.funded ?? true) : false,
      treatmentBlockedReason: inv ? (funding.get(inv.id)?.detail ?? null) : null,
      estimateInvoiceId: inv?.id ?? null,
      estimateTotal: inv ? Number(inv.total) : null,
      estimateInvoiceStatus: inv?.status ?? null,
      treatmentPlanId: plan?.id ?? null,
    }
  })

  // Append standalone estimates (draft one-time invoices with no appointment).
  // They are not tied to a date or a visit, so they stay listed until reception
  // confirms or cancels them. Which of them a lens may show is the caller's call
  // (`opts.standalone`): reception lists them all, a doctor only their own.
  const standaloneConds = [
    isNull(invoices.appointmentId),
    eq(invoices.type, 'one_time'),
    eq(invoices.status, 'draft'),
  ]
  if (opts.standalone.kind === 'createdBy') {
    standaloneConds.push(eq(invoices.createdBy, opts.standalone.userId))
  }
  const standaloneEstimates =
    opts.standalone.kind === 'none'
      ? []
      : await db
          .select({
            id: invoices.id,
            patientId: invoices.patientId,
            patientName: patients.name,
            patientPhone: patients.phone,
            total: invoices.total,
            status: invoices.status,
            createdAt: invoices.createdAt,
          })
          .from(invoices)
          .innerJoin(patients, eq(patients.id, invoices.patientId))
          .where(and(...standaloneConds))
          .orderBy(desc(invoices.createdAt))

  const standaloneFunding = await getInvoiceFundingBatch(
    db,
    standaloneEstimates.map((e) => e.id)
  )

  const syntheticVisits = standaloneEstimates.map((est) => ({
    appointmentId: est.id, // Use invoice ID as a dummy appointment key for the frontend
    patientId: est.patientId,
    patientName: est.patientName,
    patientPhone: est.patientPhone ?? null,
    doctorId: null,
    doctorName: null,
    date: est.createdAt instanceof Date ? est.createdAt.toISOString() : String(est.createdAt),
    status: 'none',
    type: 'estimate',
    requiresEstimate: true,
    estimateStatus: 'estimate_ready',
    checkedInAt: null,
    hasPendingNote: false,
    treatmentBlocked: !(standaloneFunding.get(est.id)?.funded ?? true),
    treatmentBlockedReason: standaloneFunding.get(est.id)?.detail ?? null,
    estimateInvoiceId: est.id,
    estimateTotal: Number(est.total),
    estimateInvoiceStatus: est.status,
    treatmentPlanId: null,
  }))

  return [...baseVisits, ...syntheticVisits]
}

// GET /api/worklist/doctor?date=&doctorId= — the doctor's day-sheet queue.
// A doctor gets their own sheet: their visits and the standalone estimates they
// wrote. Only an admin may name a doctor with ?doctorId, or omit it to see every
// doctor's (F16); anyone else naming a doctor but themselves is refused.
worklistApp.get('/doctor', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const { start, end, iso } = dayRange(c.req.query('date'))
  // roleId, not role: `user.role` is Better Auth's column and is nullable, so
  // an admin whose account predates Access Management reads as non-admin here
  // — which sent this handler down the "find this user's doctors row" path and
  // returned an empty worklist to the Activity page.
  const isAdmin = user.roleId === 'admin'

  const requestedDoctorId = c.req.query('doctorId') || undefined
  if (requestedDoctorId && !z.string().uuid().safeParse(requestedDoctorId).success) {
    return c.json({ error: 'Invalid doctorId' }, 400)
  }

  try {
    let doctorId = requestedDoctorId
    let standalone: StandaloneScope

    if (isAdmin) {
      if (doctorId) {
        // One doctor's sheet: the estimates written by the account behind that row.
        const owner = await resolveLoginUserIdForDoctor(db, doctorId)
        standalone = owner ? { kind: 'createdBy', userId: owner } : { kind: 'none' }
      } else {
        standalone = { kind: 'all' }
      }
    } else {
      // Resolves BOTH linkage shapes. This used to check doctors.userId alone,
      // which is null for every doctor created through the portal's
      // add-specialist flow — so correctly-linked doctors were told their
      // account was unlinked.
      const doc = await resolveDoctorForUser(db, user.id)
      // Naming a doctor used to skip the lookup above, so any holder of
      // appointments:read could read any doctor's whole day-sheet by passing an id.
      if (doctorId && doctorId !== doc?.id) {
        return c.json({ error: 'You can only view your own day-sheet' }, 403)
      }
      // No doctor profile is linked to this account, so there is no day-sheet to
      // show. `unlinked` distinguishes that from a genuinely empty day — without
      // it the UI renders "no visits today" and the misconfiguration stays hidden.
      if (!doc) return c.json({ success: true, data: { date: iso, visits: [], unlinked: true } })
      doctorId = doc.id
      standalone = { kind: 'createdBy', userId: user.id }
    }

    const visits = await loadVisits(db, { start, end, doctorId, standalone })
    return c.json({ success: true, data: { date: iso, visits, unlinked: false } })
  } catch (error) {
    logError(error, { context: 'Worklist doctor lens' })
    return c.json({ error: 'Failed to load worklist' }, 500)
  }
})

// ── Doctor weekly report ─────────────────────────────────────────────────────
// GET /api/worklist/doctor/weekly?weekStart=YYYY-MM-DD&doctorId=
// A week's compilation of one doctor's clinical activity: appointment outcomes,
// unique patients, estimate routing, clinical notes, prescriptions and treatment
// plans authored — plus a per-day appointment breakdown. Read-only; no money.
// Registered before the parameterless `/doctor` handler's siblings so the literal
// sub-path is unambiguous.

/** Monday-anchored week containing `dateStr` (or today). */
function weekRange(dateStr?: string): { start: Date; end: Date; iso: string } {
  const base = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date()
  const day = base.getDay() // 0 = Sunday
  const mondayOffset = day === 0 ? -6 : 1 - day
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate() + mondayOffset)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  const iso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
  return { start, end, iso }
}

const COMPLETED_STATUSES = new Set(['completed'])
const NO_SHOW_STATUSES = new Set(['no_show', 'no-show'])
const CANCELLED_STATUSES = new Set(['cancelled'])

export interface DoctorWeeklySummary {
  weekStart: string
  weekEnd: string
  doctorId: string | null
  doctorName: string | null
  totals: {
    appointments: number
    completed: number
    noShow: number
    cancelled: number
    remaining: number
    uniquePatients: number
    estimatesRequested: number
    estimatesReady: number
    estimatesInvoiced: number
    clinicalNotes: number
    prescriptions: number
    treatmentPlans: number
    treatmentPlansAccepted: number
  }
  days: Array<{
    date: string
    appointments: number
    completed: number
    noShow: number
    cancelled: number
  }>
}

worklistApp.get('/doctor/weekly', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const { start, end, iso } = weekRange(c.req.query('weekStart'))
  // roleId, not role: `user.role` is Better Auth's column and is nullable, so
  // an admin whose account predates Access Management reads as non-admin here
  // — which sent this handler down the "find this user's doctors row" path and
  // returned an empty worklist to the Activity page.
  const isAdmin = user.roleId === 'admin'
  const weekEndIso = (() => {
    const last = new Date(end)
    last.setDate(last.getDate() - 1)
    return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
  })()

  const empty = (doctorId: string | null, doctorName: string | null): DoctorWeeklySummary => ({
    weekStart: iso,
    weekEnd: weekEndIso,
    doctorId,
    doctorName,
    totals: {
      appointments: 0,
      completed: 0,
      noShow: 0,
      cancelled: 0,
      remaining: 0,
      uniquePatients: 0,
      estimatesRequested: 0,
      estimatesReady: 0,
      estimatesInvoiced: 0,
      clinicalNotes: 0,
      prescriptions: 0,
      treatmentPlans: 0,
      treatmentPlansAccepted: 0,
    },
    days: Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      return {
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        appointments: 0,
        completed: 0,
        noShow: 0,
        cancelled: 0,
      }
    }),
  })

  try {
    // Resolve the doctor whose week we're reporting on. Admins may target another
    // doctor via ?doctorId; everyone else gets their own row.
    const requestedDoctorId = c.req.query('doctorId') || undefined
    // Same two-shape resolution as the day-sheet above: an admin may request a
    // specific doctor, otherwise resolve the caller's own profile by either link.
    const ownDoctorId =
      requestedDoctorId && isAdmin ? null : await resolveDoctorIdForUser(db, user.id)
    const targetDoctorId = requestedDoctorId && isAdmin ? requestedDoctorId : ownDoctorId

    const [doctorRow] = targetDoctorId
      ? await db
          .select({ id: doctors.id, userId: doctors.userId, name: userTable.name })
          .from(doctors)
          .leftJoin(userTable, eq(userTable.id, doctors.userId))
          .where(eq(doctors.id, targetDoctorId))
          .limit(1)
      : []

    // A caller with no doctor row has no clinical week of their own.
    if (!doctorRow) return c.json({ success: true, data: empty(null, null) })

    const summary = empty(doctorRow.id, doctorRow.name ?? null)

    // ── Appointments (the doctor's whole week, every status) ──────────────────
    const appts = await db
      .select({
        patientId: appointments.patientId,
        date: appointments.date,
        status: appointments.status,
        requiresEstimate: appointments.requiresEstimate,
        estimateStatus: appointments.estimateStatus,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.doctorId, doctorRow.id),
          gte(appointments.date, start),
          lt(appointments.date, end)
        )
      )

    const dayIndex = new Map(summary.days.map((d, i) => [d.date, i]))
    const seenPatients = new Set<string>()

    for (const a of appts) {
      const when = a.date instanceof Date ? a.date : new Date(a.date as unknown as string)
      const key = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')}`
      const bucket = summary.days[dayIndex.get(key) ?? -1]

      summary.totals.appointments++
      if (bucket) bucket.appointments++

      if (COMPLETED_STATUSES.has(a.status)) {
        summary.totals.completed++
        if (bucket) bucket.completed++
      } else if (NO_SHOW_STATUSES.has(a.status)) {
        summary.totals.noShow++
        if (bucket) bucket.noShow++
      } else if (CANCELLED_STATUSES.has(a.status)) {
        summary.totals.cancelled++
        if (bucket) bucket.cancelled++
      } else {
        summary.totals.remaining++
      }

      // "Seen" excludes visits the patient never attended.
      if (!NO_SHOW_STATUSES.has(a.status) && !CANCELLED_STATUSES.has(a.status)) {
        seenPatients.add(a.patientId)
      }

      if (a.requiresEstimate) summary.totals.estimatesRequested++
      if (a.estimateStatus === 'estimate_ready') summary.totals.estimatesReady++
      if (a.estimateStatus === 'invoiced') summary.totals.estimatesInvoiced++
    }
    summary.totals.uniquePatients = seenPatients.size

    // ── Authored clinical artefacts ───────────────────────────────────────────
    // Medical records are doctor-keyed; prescriptions and treatment plans record
    // the authoring user, so they're keyed off the doctor's user id.
    const [[notes], [scripts], plans] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(medicalRecords)
        .where(
          and(
            eq(medicalRecords.doctorId, doctorRow.id),
            gte(medicalRecords.date, start),
            lt(medicalRecords.date, end)
          )
        ),
      doctorRow.userId
        ? db
            .select({ count: sql<number>`count(*)::int` })
            .from(prescriptions)
            .where(
              and(
                eq(prescriptions.createdById, doctorRow.userId),
                gte(prescriptions.createdAt, start),
                lt(prescriptions.createdAt, end)
              )
            )
        : Promise.resolve([{ count: 0 }]),
      doctorRow.userId
        ? db
            .select({ status: treatmentPlans.status })
            .from(treatmentPlans)
            .where(
              and(
                eq(treatmentPlans.createdById, doctorRow.userId),
                gte(treatmentPlans.createdAt, start),
                lt(treatmentPlans.createdAt, end)
              )
            )
        : Promise.resolve([] as Array<{ status: string }>),
    ])

    summary.totals.clinicalNotes = notes?.count ?? 0
    summary.totals.prescriptions = scripts?.count ?? 0
    summary.totals.treatmentPlans = plans.length
    summary.totals.treatmentPlansAccepted = plans.filter(
      (p) => p.status === 'accepted' || p.status === 'in_progress' || p.status === 'completed'
    ).length

    return c.json({ success: true, data: summary })
  } catch (error) {
    logError(error, { context: 'Worklist doctor weekly summary' })
    return c.json({ error: 'Failed to load weekly summary' }, 500)
  }
})

// GET /api/worklist/reception?date= — all of the day's visits, billing lens.
worklistApp.get('/reception', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.READ as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const { start, end, iso } = dayRange(c.req.query('date'))

  try {
    const visits = await loadVisits(db, { start, end, standalone: { kind: 'all' } })
    return c.json({ success: true, data: { date: iso, visits } })
  } catch (error) {
    logError(error, { context: 'Worklist reception lens' })
    return c.json({ error: 'Failed to load worklist' }, 500)
  }
})

// ── P3: POST /api/worklist/:id/estimate — doctor builds the estimate ──────────
// Body: { lines: [{ serviceId, quantity?, variantName?, toothClassId?, specialistId?,
//   discount? }], note? }. Creates/replaces a draft invoice priced from the matrix
// and stamps the visit `estimate_ready`. Gated on APPOINTMENTS.UPDATE (doctor task).
worklistApp.post('/:id/estimate', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  if (!Array.isArray(body.lines) || body.lines.length === 0)
    return c.json({ error: 'At least one line is required' }, 400)

  try {
    const result = await createEstimateDraft(
      db,
      {
        appointmentId: id,
        lines: body.lines,
        note: body.note ?? null,
        visitFrequency: body.visitFrequency ?? 'single',
      },
      user.id
    )
    return c.json({
      success: true,
      data: {
        invoiceId: result.invoice.id,
        total: Number(result.invoice.total),
        lineCount: result.lineCount,
      },
    })
  } catch (error) {
    // Same split as the standalone route: caller-fixable → 400 with the reason.
    if (error instanceof EstimateValidationError) {
      return c.json({ error: error.message }, 400)
    }
    logError(error, { context: 'Worklist estimate create', appointmentId: id })
    return c.json({ error: 'Failed to create estimate' }, 500)
  }
})

// ── P4: POST /api/worklist/:id/confirm — reception issues + optionally pays ────
// Body: { payment?: { method, amount, externalReference? }, sendSms?: boolean }. Issues the draft
// estimate (draft → issued, posts AR) and, if a payment is supplied, records it; with `sendSms`, the
// patient is texted a confirmation of what was paid (G08), once, after the commit.
// Gated on PAYMENTS.UPDATE (reception authorizes billing).
worklistApp.post('/:id/confirm', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))

  // Support the new multi-method array and the legacy single-payment object.
  const rawPayments = Array.isArray(body.payments)
    ? (body.payments as { method: string; amount: number; externalReference?: string | null }[])
    : body.payment
      ? [body.payment as { method: string; amount: number; externalReference?: string | null }]
      : []

  const acceptedLineItemIds = body.acceptedLineItemIds as string[] | undefined

  try {
    // `:id` is normally an appointment id. But `loadVisits` also emits SYNTHETIC
    // visits for standalone estimates — draft one-time invoices with no
    // appointment — using the invoice id as the visit key ("dummy appointment
    // key for the frontend"). So the same fallback `/cancel` already does is
    // required here, or every standalone estimate 404s on confirm and can be
    // cancelled but never accepted.
    let [draft] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.appointmentId, id), eq(invoices.status, 'draft')))
      .limit(1)

    if (!draft) {
      ;[draft] = await db
        .select()
        .from(invoices)
        .where(
          and(eq(invoices.id, id), isNull(invoices.appointmentId), eq(invoices.status, 'draft'))
        )
        .limit(1)
    }
    if (!draft) return c.json({ error: 'No draft estimate found for this visit' }, 404)

    const result = await db.transaction(async (tx) => {
      const now = new Date()

      // ── Handle Line Splitting ──
      if (acceptedLineItemIds && acceptedLineItemIds.length > 0) {
        const lines = await tx.query.invoiceLines.findMany({
          where: eq(invoiceLines.invoiceId, draft.id),
        })
        const rejectedLines = lines.filter((l) => !acceptedLineItemIds.includes(l.id))

        if (rejectedLines.length > 0) {
          const { generateInvoiceNumber } = await import('../lib/ledger-service')
          const num = await generateInvoiceNumber(tx as any)

          let newSub = Money.zero(),
            newSur = Money.zero(),
            newDis = Money.zero(),
            newTax = Money.zero(),
            newTot = Money.zero()
          for (const l of rejectedLines) {
            newSub = newSub.add(l.lineSubtotal)
            newSur = newSur.add(l.surchargeAmount)
            newDis = newDis.add(l.discountAmount)
            newTax = newTax.add(l.taxAmount)
            newTot = newTot.add(l.lineTotal)
          }

          const [newDraft] = await tx
            .insert(invoices)
            .values({
              invoiceNumber: num,
              patientId: draft.patientId,
              appointmentId: draft.appointmentId,
              type: draft.type,
              status: 'draft',
              amount: newTot.toDbValue(),
              total: newTot.toDbValue(),
              subtotal: newSub.toDbValue(),
              surchargeTotal: newSur.toDbValue(),
              discountTotal: newDis.toDbValue(),
              taxTotal: newTax.toDbValue(),
              currency: draft.currency,
              visitFrequency: draft.visitFrequency,
            })
            .returning()

          const rejectedLineIds = rejectedLines.map((l) => l.id)
          await tx
            .update(invoiceLines)
            .set({ invoiceId: newDraft.id })
            .where(inArray(invoiceLines.id, rejectedLineIds))
        }
      }

      const { invoice } = await issueInvoice(tx, draft.id, user.id, { entryDate: now })

      // ── Auto Create Treatment Plan & Case ──
      // Skip when this estimate already has a plan (0208). The doctor can build
      // one from the day-sheet before reception confirms, and confirm used to
      // create a second regardless — live data carries three plans for one
      // estimate from exactly that. Only checkable now the link is a real
      // column rather than a title string.
      const existingPlan = await tx
        .select({ id: treatmentPlans.id })
        .from(treatmentPlans)
        .where(eq(treatmentPlans.sourceInvoiceId, draft.id))
        .limit(1)

      const acceptedLines = existingPlan.length
        ? []
        : await tx.query.invoiceLines.findMany({
            where: eq(invoiceLines.invoiceId, draft.id),
          })
      if (acceptedLines.length > 0) {
        const [plan] = await tx
          .insert(treatmentPlans)
          .values({
            patientId: invoice.patientId as string,
            title: `Plan from Estimate ${invoice.invoiceNumber}`,
            // The real link (0208). The title stays a display string.
            sourceInvoiceId: invoice.id,
            totalEstimated: invoice.total,
            status: 'created',
            acceptedAt: now,
            createdById: draft.createdBy || user.id,
          })
          .returning()

        const planItemsToInsert = acceptedLines.map((line, i) => ({
          planId: plan.id,
          procedureName: line.description || 'Unknown Procedure',
          serviceId: line.serviceId,
          estimatedCost: line.lineTotal,
          status: 'pending',
          sortOrder: i,
        }))
        await tx.insert(treatmentPlanItems).values(planItemsToInsert)

        await ensureCaseForPlan(tx as DB, {
          planId: plan.id,
          patientId: invoice.patientId as string,
          createdById: draft.createdBy || user.id,
        })
      }

      let paymentId: string | null = null
      const paymentSources = rawPayments.filter((p) => Number(p.amount) > 0)
      const paymentGroupId = paymentSources.length > 1 ? randomUUID() : null
      let remainingInvoiceBalance = Money.from(invoice.balance)

      for (const src of paymentSources) {
        const amount = Money.from(src.amount)
        const alloc = amount.gt(remainingInvoiceBalance) ? remainingInvoiceBalance : amount
        const { payment: draftPayment } = await createDraftPayment(
          tx,
          {
            patientId: invoice.patientId as string,
            amount,
            method: src.method as PaymentMethod,
            // NOT the route param: for a standalone estimate `id` is an invoice
            // id, and `payments.appointmentId` is a real FK to `appointments`,
            // so passing it through raised a foreign-key violation. Null is
            // correct for an estimate with no visit behind it.
            appointmentId: draft.appointmentId,
            externalReference: src.externalReference ?? null,
            paymentGroupId,
            allocations: alloc.isPositive()
              ? [{ targetType: 'invoice', targetId: invoice.id, amount: alloc.toDbValue() }]
              : [],
          },
          user.id
        )
        const posted = await postPayment(tx, draftPayment.id, user.id)
        paymentId = posted.payment.id
        remainingInvoiceBalance = remainingInvoiceBalance.sub(alloc)
      }

      // Only for a real visit: a standalone estimate has no appointment, and
      // `id` is then an invoice id that matches no appointment row.
      if (draft.appointmentId) {
        await tx
          .update(appointments)
          .set({ estimateStatus: 'invoiced', updatedAt: now })
          .where(eq(appointments.id, draft.appointmentId))
      }

      return { invoiceId: invoice.id, paymentId }
    })

    // Committed. The text names what was posted (every method of a split, once) and cannot undo
    // the confirm: it never throws, and a failure rides along as `smsError` (F31).
    let smsError: string | undefined
    if (body.sendSms === true && result.paymentId) {
      smsError = (
        await sendPaymentConfirmationSms(db, { paymentId: result.paymentId, userId: user.id })
      ).error
    }
    return c.json({ success: true, data: result, ...(smsError ? { smsError } : {}) })
  } catch (error) {
    logError(error, { context: 'Worklist estimate confirm' })
    // A Drizzle failure's `message` is the entire SQL statement plus bound
    // params — it reached the browser as an unreadable wall of text that also
    // leaked the schema and a patient id. The detail belongs in the log; the
    // client gets a sentence. Errors we raise ourselves are still passed
    // through, since those are written to be read.
    const raw = error instanceof Error ? error.message : ''
    const isDbError = raw.startsWith('Failed query:') || raw.includes('\nparams:')
    return c.json({ error: isDbError || !raw ? 'Failed to confirm estimate' : raw }, 500)
  }
})

// ── P5: POST /api/worklist/:id/route — escape hatch: flip requires-estimate ────
// Body: { requiresEstimate: boolean }. Re-routes a checked-in visit between
// doctor-first (estimate) and reception-direct after the fact. Turning it off
// discards any un-issued draft estimate.
worklistApp.post('/:id/route', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const requiresEstimate = body.requiresEstimate === true

  try {
    const appt = await db.query.appointments.findFirst({ where: eq(appointments.id, id) })
    if (!appt) return c.json({ error: 'Appointment not found' }, 404)

    if (requiresEstimate) {
      // Route to the doctor. A checked-in visit is immediately actionable.
      const estimateStatus =
        appt.status === 'checked_in' || appt.status === 'in_chair' ? 'awaiting_estimate' : null
      await db
        .update(appointments)
        .set({ requiresEstimate: true, estimateStatus, updatedAt: new Date() })
        .where(eq(appointments.id, id))
    } else {
      // Back to reception-direct. Discard any un-issued draft estimate first.
      const drafts = await db
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.appointmentId, id), eq(invoices.status, 'draft')))
      for (const d of drafts) await db.delete(invoices).where(eq(invoices.id, d.id))
      await db
        .update(appointments)
        .set({ requiresEstimate: false, estimateStatus: null, updatedAt: new Date() })
        .where(eq(appointments.id, id))
    }
    return c.json({ success: true, data: { requiresEstimate } })
  } catch (error) {
    logError(error, { context: 'Worklist route flip' })
    return c.json({ error: 'Failed to change routing' }, 500)
  }
})

// ── P4: POST /api/worklist/:id/cancel — reception cancels the estimate draft ───
// Deletes the un-issued draft and returns the visit to `awaiting_estimate`.
worklistApp.post('/:id/cancel', async (c) => {
  const user = await getCurrentUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (!(await checkPermission(c, user.id, MODULE as string, ACTIONS.UPDATE as string)))
    return c.json({ error: 'Unauthorized' }, 403)

  const db = getDb(process.env.DATABASE_URL!)
  const parsedId = z.string().uuid().safeParse(c.req.param('id'))
  if (!parsedId.success) return c.json({ error: 'Not found' }, 404)
  const id = parsedId.data

  try {
    let drafts = await db
      .select({ id: invoices.id, createdBy: invoices.createdBy })
      .from(invoices)
      .where(and(eq(invoices.appointmentId, id), eq(invoices.status, 'draft')))

    if (drafts.length === 0) {
      // Standalone estimates are keyed by their invoice id (see loadVisits). Only a
      // standalone one-time draft qualifies: this used to match ANY draft invoice
      // with that id, so a doctor (appointments:update) could delete a draft plan
      // instalment, or another doctor's estimate, by id.
      drafts = await db
        .select({ id: invoices.id, createdBy: invoices.createdBy })
        .from(invoices)
        .where(
          and(
            eq(invoices.id, id),
            isNull(invoices.appointmentId),
            eq(invoices.type, 'one_time'),
            eq(invoices.status, 'draft')
          )
        )
    }

    // Reception (who confirm billing) may cancel any estimate; anyone else only their own.
    if (
      drafts.some((d) => d.createdBy !== user.id) &&
      !(await checkPermission(c, user.id, MODULES.PAYMENTS as string, ACTIONS.UPDATE as string))
    ) {
      return c.json({ error: 'You can only cancel estimates you created' }, 403)
    }

    for (const d of drafts) {
      await db.delete(invoices).where(eq(invoices.id, d.id))
    }

    await db
      .update(appointments)
      .set({ estimateStatus: 'awaiting_estimate', updatedAt: new Date() })
      .where(eq(appointments.id, id))

    return c.json({ success: true, data: { cancelled: drafts.length } })
  } catch (error) {
    logError(error, { context: 'Worklist estimate cancel' })
    return c.json({ error: 'Failed to cancel estimate' }, 500)
  }
})
