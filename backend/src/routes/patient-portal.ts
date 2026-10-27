/**
 * /api/patient-portal/*
 *
 * Patient-scoped read-only endpoints used by the PWA patient portal.
 * All routes require a valid patient_session cookie (enforced by getSessionPatient).
 */

import { and, asc, desc, eq, inArray, isNull, ne, notInArray, or } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db'
import {
  appointments,
  appointmentTypes,
  appPaymentMethods,
  caseStages,
  invoiceLines,
  invoices,
  medicalRecords,
  patientCases,
  patientDocuments,
  patients,
  patientWallets,
  paymentAllocations,
  paymentConfirmations,
  paymentPlanScheduleItems,
  paymentPlans,
  payments,
  pushSubscriptions,
  smsMessages,
  walletTransactions,
  websiteBookings,
  xrayRecords,
} from '../db/schema'
import { getBranding } from '../lib/branding'
import { logError } from '../lib/logger'
import { patientIsOrtho } from '../lib/patient-tags-query'
import { renderHtmlToPdf } from '../lib/pdf-render'
import { sendPushToPatients } from '../lib/push'
import { REDACTED_SMS_BODY } from '../lib/sms-redaction'
import { renderStatementHtml } from '../lib/statement-html'
import { uploadToCategory } from '../lib/storage-router'
import type { HonoEnv } from '../lib/types'
import { uploadProfiles, validateUpload } from '../lib/upload-validation'
import { getSessionPatient } from './patient-auth'
import { buildLedgerEntries } from './patient-statements'

const patientPortalApp = new Hono<HonoEnv>()

// Middleware — every route in this app requires a valid patient session
patientPortalApp.use('/*', async (c, next) => {
  const session = await getSessionPatient(c)
  if (!session) return c.json({ error: 'Not authenticated' }, 401)
  c.set('patientUser', session.patient)
  return next()
})

// ─── GET /appointments ────────────────────────────────────────────────────────

patientPortalApp.get('/appointments', async (c) => {
  const patient = c.get('patientUser')!
  const db = getDb(process.env.DATABASE_URL!)

  const rows = await db.query.appointments.findMany({
    where: eq(appointments.patientId, patient.id),
    orderBy: [desc(appointments.date)],
    with: {
      doctor: {
        with: { user: { columns: { name: true } } },
      },
    },
  })

  return c.json({ success: true, data: rows })
})

// ─── GET /records ─────────────────────────────────────────────────────────────

patientPortalApp.get('/records', async (c) => {
  const patient = c.get('patientUser')!
  const db = getDb(process.env.DATABASE_URL!)

  const rows = await db.query.medicalRecords.findMany({
    where: eq(medicalRecords.patientId, patient.id),
    orderBy: [desc(medicalRecords.date)],
    with: {
      doctor: {
        with: { user: { columns: { name: true } } },
      },
    },
    // Summary-only per Phase 6: exclude internal clinical notes + examination.
    // Patient sees date, doctor, treatment, prescription, simple diagnosis label only.
    columns: {
      id: true,
      date: true,
      diagnosis: true,
      treatment: true,
      prescription: true,
      createdAt: true,
    },
  })

  return c.json({ success: true, data: rows })
})

// Patient-safe one-line summary of a case stage's clinical data. Deliberately
// excludes raw images (base64), internal ids, and staff-only free-text notes.
// biome-ignore lint/suspicious/noExplicitAny: stage `data` is loosely-typed jsonb
function summarizeStage(stageType: string, data: any): string | null {
  if (!data || typeof data !== 'object') return null
  switch (stageType) {
    case 'patient_concern':
    case 'presenting_complaint':
      return (
        (typeof data.chiefComplaint === 'string' && data.chiefComplaint) ||
        (typeof data.complaint === 'string' && data.complaint) ||
        null
      )
    case 'oral_health': {
      const fields = [
        { key: 'allergies', label: 'Allergies' },
        { key: 'medications', label: 'Current medication' },
        { key: 'gumBleeding', label: 'Gum bleeding' },
        { key: 'recentDental', label: 'Recent dental work' },
      ]
      const flagged = fields
        .filter((f) => data[f.key]?.value === 'yes')
        .map((f) => (data[f.key].detail ? `${f.label}: ${data[f.key].detail}` : f.label))
      return flagged.length ? flagged.join(' · ') : 'No concerns reported'
    }
    case 'examination': {
      if (Array.isArray(data.conditions) && data.conditions.length) {
        return data.conditions
          .map(
            // biome-ignore lint/suspicious/noExplicitAny: loose
            (c: any) =>
              `${c.label ?? c.type}${Array.isArray(c.teeth) && c.teeth.length ? ` (${c.teeth.join(', ')})` : ''}`
          )
          .join(' · ')
      }
      if (data.examTypeName) {
        const imgs = Array.isArray(data.images) ? data.images.length : 0
        return `${data.examTypeName}${imgs ? ` · ${imgs} image${imgs === 1 ? '' : 's'}` : ''}`
      }
      return null
    }
    case 'treatment_plan': {
      if (Array.isArray(data.stages)) {
        const procs = data.stages.flatMap(
          // biome-ignore lint/suspicious/noExplicitAny: loose
          (st: any) =>
            Array.isArray(st.entries)
              ? st.entries.map((e: any) => e.procedureName).filter(Boolean)
              : []
        )
        return procs.length ? procs.join(' · ') : null
      }
      return null
    }
    case 'prescription':
    case 'medications': {
      if (Array.isArray(data.medications)) {
        const meds = data.medications
          // biome-ignore lint/suspicious/noExplicitAny: loose
          .map((m: any) =>
            [m.medication, m.dosage, m.frequency, m.duration].filter(Boolean).join(' ')
          )
          .filter(Boolean)
        return meds.length ? meds.join(' · ') : null
      }
      return null
    }
    case 'diagnosis': {
      if (Array.isArray(data.diagnoses))
        // biome-ignore lint/suspicious/noExplicitAny: loose
        return (
          data.diagnoses
            .map((d: any) => d.name ?? d.label ?? d)
            .filter(Boolean)
            .join(' · ') || null
        )
      if (typeof data.diagnosis === 'string') return data.diagnosis || null
      return null
    }
    default:
      return null
  }
}

// ─── GET /cases ───────────────────────────────────────────────────────────────
// The patient's clinical cases (the clinic's per-episode records), with stages
// grouped into visits. Mirrors the portal's Medical Records → Cases view.
patientPortalApp.get('/cases', async (c) => {
  const patient = c.get('patientUser')!
  const db = getDb(process.env.DATABASE_URL!)

  const cases = await db
    .select({
      id: patientCases.id,
      caseNumber: patientCases.caseNumber,
      status: patientCases.status,
      chiefComplaint: patientCases.chiefComplaint,
      createdAt: patientCases.createdAt,
      closedAt: patientCases.closedAt,
    })
    .from(patientCases)
    .where(and(eq(patientCases.patientId, patient.id), isNull(patientCases.deletedAt)))
    .orderBy(desc(patientCases.createdAt))

  const ids = cases.map((cse) => cse.id)
  const stages = ids.length
    ? await db
        .select({
          caseId: caseStages.caseId,
          stageType: caseStages.stageType,
          visitDate: caseStages.visitDate,
          data: caseStages.data,
        })
        .from(caseStages)
        .where(and(inArray(caseStages.caseId, ids), isNull(caseStages.deletedAt)))
        .orderBy(asc(caseStages.visitDate))
    : []

  const data = cases.map((cse) => {
    const byVisit = new Map<string, { type: string; summary: string | null }[]>()
    for (const s of stages.filter((x) => x.caseId === cse.id)) {
      const list = byVisit.get(s.visitDate) ?? []
      list.push({ type: s.stageType, summary: summarizeStage(s.stageType, s.data) })
      byVisit.set(s.visitDate, list)
    }
    const visits = [...byVisit.entries()]
      .map(([visitDate, stageList]) => ({ visitDate, stages: stageList }))
      .sort((a, b) => b.visitDate.localeCompare(a.visitDate))
    return { ...cse, visits }
  })

  return c.json({ success: true, data })
})

// ─── GET /payments ────────────────────────────────────────────────────────────
// Returns invoices + wallet summary

patientPortalApp.get('/payments', async (c) => {
  const patient = c.get('patientUser')!
  const db = getDb(process.env.DATABASE_URL!)

  const [invoiceRows, wallet, txRows] = await Promise.all([
    // Match the portal's "active patient invoices" view: exclude archived rows
    // (incl. superseded plan child-installments), specialist-billed invoices,
    // and void/draft/written-off statuses. Balances come from the `balance`
    // column (not legacy amount − paidAmount) so totals tally with the portal.
    db.query.invoices.findMany({
      where: and(
        eq(invoices.patientId, patient.id),
        eq(invoices.archived, false),
        eq(invoices.billToType, 'patient'),
        notInArray(invoices.status, ['void', 'draft', 'written_off'])
      ),
      orderBy: [desc(invoices.createdAt)],
    }),
    db.query.patientWallets.findFirst({
      where: eq(patientWallets.patientId, patient.id),
    }),
    db.query.walletTransactions.findMany({
      where: eq(walletTransactions.patientId, patient.id),
      orderBy: [desc(walletTransactions.createdAt)],
      limit: 50,
    }),
  ])

  return c.json({
    success: true,
    data: {
      invoices: invoiceRows,
      wallet: wallet ?? null,
      transactions: txRows,
    },
  })
})

// ─── GET /profile ─────────────────────────────────────────────────────────────

patientPortalApp.get('/profile', async (c) => {
  const patient = c.get('patientUser')!
  const db = getDb(process.env.DATABASE_URL!)

  // §2.7: derive isOrtho from the 'Ortho' patient tag (legacy column retired).
  const isOrtho = await patientIsOrtho(db, patient.id)

  return c.json({
    success: true,
    data: {
      id: patient.id,
      patientId: patient.patientId,
      name: patient.name,
      email: patient.email,
      phone: patient.phone,
      dob: patient.dob,
      gender: patient.gender,
      address: patient.address,
      occupation: patient.occupation,
      category: patient.category,
      isOrtho,
      isChild: patient.isChild,
      guardianName: patient.guardianName,
      guardianPhone: patient.guardianPhone,
      insuranceProvider: patient.insuranceProvider,
      insurancePolicyNumber: patient.insurancePolicyNumber,
      nationality: patient.nationality,
      profileImage: patient.profileImage,
    },
  })
})

// ─── PATCH /profile ───────────────────────────────────────────────────────────

patientPortalApp.patch('/profile', async (c) => {
  const patient = c.get('patientUser')!
  const db = getDb(process.env.DATABASE_URL!)
  const body = await c.req.json()

  const ALLOWED_FIELDS = new Set([
    'phone',
    'email',
    'address',
    'occupation',
    'emergencyContactName',
    'emergencyContactPhone',
    'profileImage',
  ])

  const update: Record<string, string | null> = {}
  for (const [key, value] of Object.entries(body)) {
    if (!ALLOWED_FIELDS.has(key)) continue
    if (value !== null && typeof value !== 'string') continue
    update[key] = value as string | null
  }

  if (Object.keys(update).length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400)
  }

  const [updated] = await db
    .update(patients)
    .set(update)
    .where(eq(patients.id, patient.id))
    .returning({
      phone: patients.phone,
      email: patients.email,
      address: patients.address,
      occupation: patients.occupation,
      emergencyContactName: patients.emergencyContactName,
      emergencyContactPhone: patients.emergencyContactPhone,
      profileImage: patients.profileImage,
    })

  return c.json({ success: true, data: updated })
})

// ─── POST /avatar ─────────────────────────────────────────────────────────────
// Patient self-service profile photo. Session-gated (middleware); the storage
// path is derived from the SESSION patient id, so a patient can only ever write
// their OWN avatar (never an arbitrary key). Sets profileImage atomically and
// returns the URL. Replaces the old flow that POSTed to the staff-only
// /api/upload route (which 401s for patient sessions).
patientPortalApp.post('/avatar', async (c) => {
  const patient = c.get('patientUser')!
  try {
    const formData = await c.req.formData()
    const file = formData.get('file') as File | null
    if (!file) return c.json({ error: 'Missing file' }, 400)

    const validation = await validateUpload(file, uploadProfiles.image)
    if (!validation.ok) return c.json({ error: validation.error }, 400)

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const key = `patients/${patient.id}/avatar/${Date.now()}.${ext}`
    const result = await uploadToCategory(
      'patient_records',
      key,
      Buffer.from(validation.buffer as ArrayBuffer),
      file.type
    )

    const db = getDb(process.env.DATABASE_URL!)
    await db
      .update(patients)
      .set({ profileImage: result.url, updatedAt: new Date() })
      .where(eq(patients.id, patient.id))

    return c.json({ success: true, data: { url: result.url } })
  } catch (error) {
    logError(error, { context: '[patient-portal] avatar upload', patientId: patient.id })
    return c.json({ error: 'Failed to upload photo' }, 500)
  }
})

// ─── POST /appointment-request ────────────────────────────────────────────────
// Phase 6: patient-initiated request (new booking | reschedule | cancellation)
// Body: {
//   requestType: 'new' | 'reschedule' | 'cancellation',
//   preferredDate?: string,
//   preferredTime?: string,
//   service?: string,
//   message?: string,
//   relatedAppointmentId?: string  // required for reschedule/cancellation
// }
patientPortalApp.post('/appointment-request', async (c) => {
  const patient = c.get('patientUser')!
  const db = getDb(process.env.DATABASE_URL!)
  const body = await c.req.json()

  const requestType = body.requestType || 'new'
  if (!['new', 'reschedule', 'cancellation'].includes(requestType)) {
    return c.json({ error: 'Invalid requestType' }, 400)
  }

  if (
    (requestType === 'reschedule' || requestType === 'cancellation') &&
    !body.relatedAppointmentId
  ) {
    return c.json({ error: 'relatedAppointmentId required for reschedule/cancellation' }, 400)
  }

  const [row] = await db
    .insert(websiteBookings)
    .values({
      name: patient.name,
      email: patient.email ?? null,
      phone: patient.phone ?? '',
      preferredDate: body.preferredDate ?? null,
      preferredTime: body.preferredTime ?? null,
      service: body.service ?? null,
      message: body.message ?? null,
      status: 'new',
      source: 'patient_pwa',
      patientId: patient.id,
      requestType,
      relatedAppointmentId: body.relatedAppointmentId ?? null,
    })
    .returning()

  return c.json({ success: true, data: row })
})

// ─── GET /appointment-requests ────────────────────────────────────────────────
// List patient's own pending requests
patientPortalApp.get('/appointment-requests', async (c) => {
  const patient = c.get('patientUser')!
  const db = getDb(process.env.DATABASE_URL!)

  const rows = await db
    .select()
    .from(websiteBookings)
    .where(eq(websiteBookings.patientId, patient.id))
    .orderBy(desc(websiteBookings.createdAt))
  return c.json({ success: true, data: rows })
})

// ─── DELETE /appointment-requests/:id ─────────────────────────────────────────
// Withdraw a request the patient made. Scoped to their own row and only while
// still pending (new | contacted) — once the clinic has actioned it (booked) or
// it's already cancelled, it can no longer be withdrawn here.
patientPortalApp.delete('/appointment-requests/:id', async (c) => {
  const patient = c.get('patientUser')!
  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')

  const existing = await db.query.websiteBookings.findFirst({
    where: and(eq(websiteBookings.id, id), eq(websiteBookings.patientId, patient.id)),
  })
  if (!existing) {
    return c.json({ error: 'Request not found' }, 404)
  }
  if (existing.status !== 'new' && existing.status !== 'contacted') {
    return c.json({ error: 'This request has already been processed and can’t be cancelled.' }, 409)
  }

  await db.delete(websiteBookings).where(eq(websiteBookings.id, id))
  return c.json({ success: true })
})

// ─── GET /appointment-types ───────────────────────────────────────────────────
// Active appointment types for the request form's service picker — the same
// canonical lookup the portal uses, so a request converts to a consistent type.
patientPortalApp.get('/appointment-types', async (c) => {
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select({
      id: appointmentTypes.id,
      name: appointmentTypes.name,
      displayName: appointmentTypes.displayName,
    })
    .from(appointmentTypes)
    .where(eq(appointmentTypes.isActive, true))
    .orderBy(asc(appointmentTypes.name))
  return c.json({ success: true, data: rows })
})

// ─── GET /payment-methods ─────────────────────────────────────────────────────
// Active payment options the clinic offers in the app (label + reference details).
patientPortalApp.get('/payment-methods', async (c) => {
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select({
      id: appPaymentMethods.id,
      label: appPaymentMethods.label,
      type: appPaymentMethods.type,
      instructions: appPaymentMethods.instructions,
    })
    .from(appPaymentMethods)
    .where(eq(appPaymentMethods.isActive, true))
    .orderBy(asc(appPaymentMethods.sortOrder), asc(appPaymentMethods.label))
  return c.json({ success: true, data: rows })
})

// ─── GET /payment-confirmations ───────────────────────────────────────────────
// The patient's own confirmation requests (drives per-invoice Pay-Now state).
patientPortalApp.get('/payment-confirmations', async (c) => {
  const patient = c.get('patientUser')!
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select({
      id: paymentConfirmations.id,
      invoiceId: paymentConfirmations.invoiceId,
      methodLabel: paymentConfirmations.methodLabel,
      amount: paymentConfirmations.amount,
      reference: paymentConfirmations.reference,
      status: paymentConfirmations.status,
      rejectionReason: paymentConfirmations.rejectionReason,
      createdAt: paymentConfirmations.createdAt,
      // When the request was confirmed/rejected — drives the in-app notification
      // timestamp (falls back to createdAt while still pending).
      updatedAt: paymentConfirmations.updatedAt,
    })
    .from(paymentConfirmations)
    .where(eq(paymentConfirmations.patientId, patient.id))
    .orderBy(desc(paymentConfirmations.createdAt))
  return c.json({ success: true, data: rows })
})

// ─── POST /payment-confirmations ──────────────────────────────────────────────
// Patient submits "Request confirmation" after paying an invoice manually.
patientPortalApp.post('/payment-confirmations', async (c) => {
  const patient = c.get('patientUser')!
  const db = getDb(process.env.DATABASE_URL!)
  const body = (await c.req.json().catch(() => ({}))) as {
    invoiceId?: string
    methodId?: string
    amount?: number
    reference?: string
    note?: string
  }

  if (!body.invoiceId) return c.json({ error: 'invoiceId is required' }, 400)

  const invoice = await db.query.invoices.findFirst({
    where: and(eq(invoices.id, body.invoiceId), eq(invoices.patientId, patient.id)),
  })
  if (!invoice) return c.json({ error: 'Invoice not found' }, 404)
  const balance = Number(invoice.balance)
  if (balance <= 0) return c.json({ error: 'This invoice is already settled.' }, 400)

  // One pending request per invoice.
  const existing = await db
    .select({ id: paymentConfirmations.id })
    .from(paymentConfirmations)
    .where(
      and(
        eq(paymentConfirmations.invoiceId, body.invoiceId),
        eq(paymentConfirmations.status, 'pending')
      )
    )
    .limit(1)
  if (existing.length > 0) {
    return c.json({ error: 'A confirmation is already pending for this invoice.' }, 409)
  }

  // Amount: default to balance; clamp to (0, balance].
  let amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) amount = balance
  if (amount > balance) amount = balance

  let methodLabel: string | null = null
  if (body.methodId) {
    const [m] = await db
      .select({ label: appPaymentMethods.label })
      .from(appPaymentMethods)
      .where(eq(appPaymentMethods.id, body.methodId))
      .limit(1)
    methodLabel = m?.label ?? null
  }

  const [row] = await db
    .insert(paymentConfirmations)
    .values({
      patientId: patient.id,
      invoiceId: body.invoiceId,
      methodId: body.methodId ?? null,
      methodLabel,
      amount,
      reference: typeof body.reference === 'string' ? body.reference.trim() || null : null,
      note: typeof body.note === 'string' ? body.note.trim() || null : null,
      status: 'pending',
    })
    .returning()
  return c.json({ success: true, data: row })
})

// ─── GET /payment-plans ───────────────────────────────────────────────────────
// The patient's active (non-archived) payment plans + their installment schedule.
patientPortalApp.get('/payment-plans', async (c) => {
  const patient = c.get('patientUser')!
  const db = getDb(process.env.DATABASE_URL!)

  const plans = await db
    .select({
      id: paymentPlans.id,
      planNumber: paymentPlans.planNumber,
      status: paymentPlans.status,
      scheduleType: paymentPlans.scheduleType,
      totalAmount: paymentPlans.totalAmount,
      amountPerInstallment: paymentPlans.amountPerInstallment,
      numberOfInstallments: paymentPlans.numberOfInstallments,
      paymentFrequency: paymentPlans.paymentFrequency,
      installmentPeriod: paymentPlans.installmentPeriod,
      startDate: paymentPlans.startDate,
      endDate: paymentPlans.endDate,
    })
    .from(paymentPlans)
    .where(
      and(
        eq(paymentPlans.patientId, patient.id),
        eq(paymentPlans.archived, false),
        // Only ongoing plans — completed/cancelled plans are history, not active obligations.
        notInArray(paymentPlans.status, ['completed', 'cancelled'])
      )
    )
    .orderBy(desc(paymentPlans.createdAt))

  const ids = plans.map((p) => p.id)
  const items = ids.length
    ? await db
        .select({
          paymentPlanId: paymentPlanScheduleItems.paymentPlanId,
          sequence: paymentPlanScheduleItems.sequence,
          expectedDate: paymentPlanScheduleItems.expectedDate,
          expectedAmount: paymentPlanScheduleItems.expectedAmount,
          status: paymentPlanScheduleItems.status,
          amountReceived: paymentPlanScheduleItems.amountReceived,
        })
        .from(paymentPlanScheduleItems)
        .where(inArray(paymentPlanScheduleItems.paymentPlanId, ids))
        .orderBy(asc(paymentPlanScheduleItems.sequence))
    : []

  const data = plans.map((p) => ({
    ...p,
    schedule: items.filter((i) => i.paymentPlanId === p.id),
  }))
  return c.json({ success: true, data })
})

// ─── GET /payment-history ─────────────────────────────────────────────────────
// The patient's actual payments (the `payments` table — receipts the clinic
// recorded), which is what the portal shows. Distinct from the wallet ledger.
// Paginated via ?limit & ?offset; returns { data, hasMore }.
patientPortalApp.get('/payment-history', async (c) => {
  const patient = c.get('patientUser')!
  const db = getDb(process.env.DATABASE_URL!)
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') ?? 20)))
  const offset = Math.max(0, Number(c.req.query('offset') ?? 0))

  const rows = await db
    .select({
      id: payments.id,
      paymentNumber: payments.paymentNumber,
      method: payments.method,
      amount: payments.amount,
      status: payments.status,
      paymentDate: payments.paymentDate,
      createdAt: payments.createdAt,
    })
    .from(payments)
    .where(
      and(
        or(eq(payments.patientId, patient.id), eq(payments.partyId, patient.id)),
        eq(payments.direction, 'incoming'),
        eq(payments.status, 'posted')
      )
    )
    .orderBy(desc(payments.paymentDate), desc(payments.createdAt))
    .limit(limit + 1)
    .offset(offset)

  return c.json({ success: true, data: rows.slice(0, limit), hasMore: rows.length > limit })
})

// ─── GET /statement ─────────────────────────────────────────────────────────
// Full account statement as a PDF — same ledger + generator the portal uses.
patientPortalApp.get('/statement', async (c) => {
  const patient = c.get('patientUser')!
  const db = getDb(process.env.DATABASE_URL!)
  const fromDate = new Date(0)
  const toDate = new Date()
  const { entries, amountDue } = await buildLedgerEntries(db, patient.id, fromDate, toDate)
  const branding = await getBranding().catch(() => null)
  const pdf = await renderHtmlToPdf(
    renderStatementHtml({
      clinicName: branding?.name ?? 'Denel Dental Clinic',
      clinicPhone: branding?.phones?.[0] ?? null,
      clinicAddress: branding?.address ?? null,
      patientName: patient.name,
      patientIdDisplay: patient.patientId ?? null,
      fromDate,
      toDate,
      entries,
      amountDue,
      generatedAt: toDate,
      generatedByName: patient.name,
    })
  )
  return c.body(new Uint8Array(pdf), 200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'attachment; filename="framada-statement.pdf"',
  })
})

// ─── GET /payment-history/:id/receipt ───────────────────────────────────────
// Receipt detail for one payment: amount/method/date + the invoices it was
// allocated to and the treatments billed on them.
patientPortalApp.get('/payment-history/:id/receipt', async (c) => {
  const patient = c.get('patientUser')!
  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')

  const [pay] = await db.select().from(payments).where(eq(payments.id, id)).limit(1)
  if (!pay) return c.json({ error: 'Payment not found' }, 404)
  if (pay.patientId !== patient.id && pay.partyId !== patient.id) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const allocs = await db
    .select({
      targetId: paymentAllocations.targetId,
      targetType: paymentAllocations.targetType,
      amount: paymentAllocations.amount,
    })
    .from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, id))

  const invoiceIds = allocs.filter((a) => a.targetType === 'invoice').map((a) => a.targetId)
  const invRows = invoiceIds.length
    ? await db
        .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
        .from(invoices)
        .where(inArray(invoices.id, invoiceIds))
    : []
  const lineRows = invoiceIds.length
    ? await db
        .select({ invoiceId: invoiceLines.invoiceId, description: invoiceLines.description })
        .from(invoiceLines)
        .where(inArray(invoiceLines.invoiceId, invoiceIds))
    : []

  const allocations = allocs
    .filter((a) => a.targetType === 'invoice')
    .map((a) => ({
      invoiceNumber: invRows.find((i) => i.id === a.targetId)?.invoiceNumber ?? null,
      amount: Number(a.amount),
      treatments: lineRows.filter((l) => l.invoiceId === a.targetId).map((l) => l.description),
    }))

  return c.json({
    success: true,
    data: {
      paymentNumber: pay.paymentNumber,
      method: pay.method,
      amount: Number(pay.amount),
      status: pay.status,
      paymentDate: pay.paymentDate ?? pay.createdAt,
      description: pay.description,
      patientName: patient.name,
      patientIdDisplay: patient.patientId,
      allocations,
    },
  })
})

// ─── GET /reminders ───────────────────────────────────────────────────────────
// Returns recent SMS messages sent to this patient as their reminder feed.

patientPortalApp.get('/reminders', async (c) => {
  const patient = c.get('patientUser')!
  const db = getDb(process.env.DATABASE_URL!)

  // A login code is stored only as a redaction stand-in (lib/sms-redaction.ts);
  // it is not a reminder, so it is left out of the feed.
  const rows = await db
    .select()
    .from(smsMessages)
    .where(and(eq(smsMessages.patientId, patient.id), ne(smsMessages.content, REDACTED_SMS_BODY)))
    .orderBy(desc(smsMessages.sentAt))
    .limit(30)

  // Map to reminder shape expected by PWA
  const data = rows.map((r) => ({
    id: r.id,
    patientId: patient.id,
    subject: r.type.replace(/_/g, ' ').replace(/\b\w/g, (ch: string) => ch.toUpperCase()),
    body: r.content,
    channel: 'sms' as const,
    scheduledFor: r.sentAt.toISOString(),
    status:
      r.status === 'delivered'
        ? 'delivered'
        : r.status === 'failed'
          ? 'failed'
          : r.status === 'pending'
            ? 'scheduled'
            : 'sent',
  }))

  return c.json({ success: true, data })
})

// ─── GET /documents ─────────────────────────────────────────────────────────
// The patient's own uploaded documents (insurance card, ID, consents, etc.).
patientPortalApp.get('/documents', async (c) => {
  const patient = c.get('patientUser')!
  const db = getDb(process.env.DATABASE_URL!)
  const rows = await db
    .select({
      id: patientDocuments.id,
      category: patientDocuments.category,
      fileName: patientDocuments.fileName,
      fileUrl: patientDocuments.fileUrl,
      mimeType: patientDocuments.mimeType,
      uploadedAt: patientDocuments.uploadedAt,
    })
    .from(patientDocuments)
    .where(eq(patientDocuments.patientId, patient.id))
    .orderBy(desc(patientDocuments.uploadedAt))
  return c.json({ success: true, data: rows })
})

// ─── GET /xrays ───────────────────────────────────────────────────────────────

patientPortalApp.get('/xrays', async (c) => {
  const patient = c.get('patientUser')!
  const db = getDb(process.env.DATABASE_URL!)

  const rows = await db.query.xrayRecords.findMany({
    where: eq(xrayRecords.patientId, patient.id),
    orderBy: [desc(xrayRecords.uploadedAt)],
    with: {
      type: true,
    },
  })

  const data = rows.map((r) => ({
    id: r.id,
    patientId: r.patientId,
    type: r.type?.displayName ?? r.type?.name ?? 'X-ray',
    imageUrl: r.imageUrl,
    thumbnailUrl: r.thumbnailUrl ?? r.imageUrl,
    takenAt: (r.capturedAt ?? r.externalCapturedDate ?? r.uploadedAt).toISOString(),
    toothNumbers: r.toothNumber != null ? [r.toothNumber] : [],
    notes: r.notes ?? null,
    source: r.origin,
  }))

  return c.json({ success: true, data })
})

// ─── GET /xrays/:id ───────────────────────────────────────────────────────────

patientPortalApp.get('/xrays/:id', async (c) => {
  const patient = c.get('patientUser')!
  const db = getDb(process.env.DATABASE_URL!)
  const id = c.req.param('id')

  const row = await db.query.xrayRecords.findFirst({
    where: eq(xrayRecords.id, id),
    with: { type: true },
  })

  if (!row) return c.json({ error: 'Not found' }, 404)
  if (row.patientId !== patient.id) return c.json({ error: 'Forbidden' }, 403)

  return c.json({
    success: true,
    data: {
      id: row.id,
      patientId: row.patientId,
      type: row.type?.displayName ?? row.type?.name ?? 'X-ray',
      imageUrl: row.imageUrl,
      thumbnailUrl: row.thumbnailUrl ?? row.imageUrl,
      takenAt: (row.capturedAt ?? row.externalCapturedDate ?? row.uploadedAt).toISOString(),
      toothNumbers: row.toothNumber != null ? [row.toothNumber] : [],
      notes: row.notes ?? null,
      source: row.origin,
    },
  })
})

// ─── Push notifications (patient-scoped) ──────────────────────────────────────
// Session-gated. Subscriptions are stored against the SESSION patient id and
// delivered via sendPushToPatients(). The browser gets the VAPID public key from
// the public GET /api/push/vapid-public-key.

patientPortalApp.post('/push/subscribe', async (c) => {
  const patient = c.get('patientUser')!
  const body = await c.req.json().catch(() => null)
  const endpoint = body?.endpoint
  const p256dh = body?.keys?.p256dh
  const auth = body?.keys?.auth
  if (!endpoint || !p256dh || !auth) {
    return c.json({ error: 'endpoint, keys.p256dh, and keys.auth are required' }, 400)
  }

  const userAgent = body?.userAgent ?? c.req.header('User-Agent') ?? null
  const db = getDb(process.env.DATABASE_URL!)
  const [row] = await db
    .insert(pushSubscriptions)
    .values({ patientId: patient.id, endpoint, p256dh, auth, userAgent })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      // Re-point an existing endpoint to this patient (e.g. a shared device
      // handed to a different family member re-registers the same browser).
      set: { patientId: patient.id, userId: null, p256dh, auth, userAgent, lastUsedAt: new Date() },
    })
    .returning({ id: pushSubscriptions.id })

  return c.json({ success: true, data: { id: row.id } })
})

patientPortalApp.delete('/push/unsubscribe', async (c) => {
  const patient = c.get('patientUser')!
  const body = await c.req.json().catch(() => null)
  const endpoint = body?.endpoint
  if (!endpoint) return c.json({ error: 'endpoint is required' }, 400)

  const db = getDb(process.env.DATABASE_URL!)
  await db
    .delete(pushSubscriptions)
    .where(
      and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.patientId, patient.id))
    )
  return c.json({ success: true })
})

// POST /push/test — send a REAL web-push to the patient's own devices so the
// prefs screen can verify the whole pipeline end-to-end (not just a local
// Notification). Returns how many were delivered.
patientPortalApp.post('/push/test', async (c) => {
  const patient = c.get('patientUser')!
  const result = await sendPushToPatients([patient.id], {
    title: 'Denel',
    body: 'Notifications are on — this is a test.',
    url: '/patient/home',
  })
  if (!result.configured) {
    return c.json({ error: 'Push notifications not configured' }, 409)
  }
  return c.json({ success: true, data: { sent: result.sent } })
})

export { patientPortalApp }
