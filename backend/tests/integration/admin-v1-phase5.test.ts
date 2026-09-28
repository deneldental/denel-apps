/**
 * admin-v1 Phase 5 smoke tests — the long-tail per-module work. Each item gets a
 * test alongside its code. vitest + withRollback sandbox against the dev DB
 * (`doppler run -- pnpm --filter backend test`; plain `pnpm test` skips).
 *
 * Tests isolate via a unique patient name per case so they're deterministic even
 * though the dev DB already has real rows.
 */

import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { DB } from '../../src/db'
import {
  appointments,
  complianceDocuments,
  consentFormTemplates,
  dailyReports,
  doctors,
  items,
  journalEntries,
  labCases,
  labVendors,
  patients,
  sales,
  scheduledReminders,
  services,
  signedConsentForms,
  smsMessages,
  staff,
  staffRequests,
  staffTrainingProgress,
  trainingMaterials,
  treatmentTypes,
  xrayRecords,
} from '../../src/db/schema'
import {
  getCompletedRefIds,
  listCompletions,
  recordCompletion,
  removeCompletion,
} from '../../src/lib/activity-completions-service'
import { filterContactable, getContactablePatientIds } from '../../src/lib/comms-consent'
import { recordCommsCost } from '../../src/lib/comms-cost'
import {
  buildComplianceReminderMessage,
  selectComplianceDocsDueForReminder,
} from '../../src/lib/compliance-reminders'
import { runCrmAutoQueue, selectCrmAutoQueueCandidates } from '../../src/lib/crm-autoqueue'
import { buildModuleSummaries } from '../../src/lib/digest'
import { getOrCreatePeriodFor } from '../../src/lib/period-service'
import { searchLabCases } from '../../src/routes/labs'
import { countUnclearedLabExpenses, listDailyReports } from '../../src/routes/reports'
import { resolveCatalogPlanItems } from '../../src/routes/treatment-plans'
import { normalizeAdaGroup } from '../../src/routes/treatments'
import { searchXrayRecords } from '../../src/routes/xrays'
import { anyUserId, makePatient } from './_fixtures'
import { noDb, withRollback } from './_setup'

// ── §9.3 — X-ray list pagination + search ────────────────────────────────────

describe.skipIf(noDb)('admin-v1 §9.3 — X-ray list pagination + search', () => {
  it('paginates (limit/offset) and returns a total count', async () => {
    await withRollback(async (tx) => {
      const name = `IT XrayPg ${randomUUID().slice(0, 8)}`
      const pid = await makePatient(tx, name)
      for (let i = 0; i < 3; i++) {
        await tx
          .insert(xrayRecords)
          .values({ patientId: pid, imageUrl: `https://x/${i}.png`, origin: 'internal' })
      }
      const p1 = await searchXrayRecords(tx, { q: name, limit: 2, offset: 0 })
      expect(p1.total).toBe(3)
      expect(p1.data.length).toBe(2)
      expect(p1.limit).toBe(2)
      const p2 = await searchXrayRecords(tx, { q: name, limit: 2, offset: 2 })
      expect(p2.data.length).toBe(1)
    })
  })

  it('clamps the limit to 1..200', async () => {
    await withRollback(async (tx) => {
      const huge = await searchXrayRecords(tx, { limit: 9999 })
      expect(huge.limit).toBe(200)
      const zero = await searchXrayRecords(tx, { limit: 0 })
      expect(zero.limit).toBe(1) // 0 is finite → clamped to the min (1)
    })
  })

  it('search by patient name matches only that patient', async () => {
    await withRollback(async (tx) => {
      const name = `IT XrayQ ${randomUUID().slice(0, 8)}`
      const pid = await makePatient(tx, name)
      await tx
        .insert(xrayRecords)
        .values({ patientId: pid, imageUrl: 'https://x/a.png', origin: 'internal' })
      const res = await searchXrayRecords(tx, { q: name })
      expect(res.total).toBe(1)
      expect(res.data[0]?.patientId).toBe(pid)
    })
  })

  it('filters by origin', async () => {
    await withRollback(async (tx) => {
      const name = `IT XraySrc ${randomUUID().slice(0, 8)}`
      const pid = await makePatient(tx, name)
      await tx
        .insert(xrayRecords)
        .values({ patientId: pid, imageUrl: 'https://x/i.png', origin: 'internal' })
      await tx
        .insert(xrayRecords)
        .values({ patientId: pid, imageUrl: 'https://x/e.png', origin: 'external' })
      const ext = await searchXrayRecords(tx, { q: name, origin: 'external' })
      expect(ext.total).toBe(1)
      expect(ext.data[0]?.origin).toBe('external')
    })
  })
})

// ── §1.1 — activity completions log ──────────────────────────────────────────

describe.skipIf(noDb)('admin-v1 §1.1 — activity completions log', () => {
  it('records a completion and is idempotent per (type, refId)', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const refId = randomUUID()
      const a = await recordCompletion(tx, {
        activityType: 'recare',
        refId,
        label: 'IT recare',
        completedById: userId,
      })
      const b = await recordCompletion(tx, {
        activityType: 'recare',
        refId,
        label: 'IT recare again',
        completedById: userId,
      })
      expect(b.id).toBe(a.id) // same row — no duplicate
    })
  })

  it('lists completed (paginated, with completer name) and supports undo', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const refId = randomUUID()
      const row = await recordCompletion(tx, {
        activityType: 'patient_reminder',
        refId,
        label: 'IT reminder',
        completedById: userId,
      })
      const listed = await listCompletions(tx, { activityType: 'patient_reminder', limit: 50 })
      const mine = listed.data.find((r) => r.id === row.id)
      expect(mine).toBeTruthy()
      expect(mine?.completedByName).toBeTruthy() // joined to the user

      const removed = await removeCompletion(tx, row.id)
      expect(removed?.id).toBe(row.id)
      const after = await getCompletedRefIds(tx, 'patient_reminder')
      expect(after.has(refId)).toBe(false) // returned to Pending
    })
  })

  it('getCompletedRefIds surfaces completed refs for the Pending computation', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const refId = randomUUID()
      await recordCompletion(tx, { activityType: 'overdue', refId, completedById: userId })
      const set = await getCompletedRefIds(tx, 'overdue')
      expect(set.has(refId)).toBe(true)
    })
  })
})

// ── §8.2 — lab case list pagination + search ─────────────────────────────────

describe.skipIf(noDb)('admin-v1 §8.2 — lab case list pagination + search', () => {
  async function makeVendor(tx: Parameters<Parameters<typeof withRollback>[0]>[0]) {
    const [v] = await tx
      .insert(labVendors)
      .values({ name: `IT Vendor ${randomUUID().slice(0, 8)}`, type: 'external' })
      .returning()
    return v.id
  }

  it('paginates within a vendor (limit/offset + total) and searches by case number', async () => {
    await withRollback(async (tx) => {
      const pid = await makePatient(tx, 'IT Lab Patient')
      const vendorId = await makeVendor(tx)
      const cn = `LC-IT-${randomUUID().slice(0, 8)}`
      for (let i = 0; i < 3; i++) {
        await tx.insert(labCases).values({
          caseNumber: `${cn}-${i}`,
          serviceName: 'IT Service',
          patientId: pid,
          vendorId,
          status: 'draft',
          domain: 'internal',
        })
      }
      const page = await searchLabCases(tx, { vendorId, limit: 2 })
      expect(page.total).toBe(3)
      expect(page.data.length).toBe(2)
      const byCn = await searchLabCases(tx, { q: `${cn}-1` })
      expect(byCn.total).toBe(1)
    })
  })

  it('filters by status', async () => {
    await withRollback(async (tx) => {
      const pid = await makePatient(tx, 'IT Lab Status')
      const vendorId = await makeVendor(tx)
      await tx.insert(labCases).values({
        caseNumber: `LC-${randomUUID().slice(0, 8)}`,
        serviceName: 'S',
        patientId: pid,
        vendorId,
        status: 'draft',
        domain: 'internal',
      })
      await tx.insert(labCases).values({
        caseNumber: `LC-${randomUUID().slice(0, 8)}`,
        serviceName: 'S',
        patientId: pid,
        vendorId,
        status: 'sent',
        domain: 'internal',
      })
      const sent = await searchLabCases(tx, { vendorId, status: 'sent' })
      expect(sent.total).toBe(1)
      expect(sent.data[0]?.status).toBe('sent')
    })
  })
})

// ── §10.5 — daily report list pagination ─────────────────────────────────────

describe.skipIf(noDb)('admin-v1 §10.5 — daily report list pagination', () => {
  it('paginates within a date range (limit/offset + total)', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      // far-future dates isolate these from real reports
      for (let i = 1; i <= 3; i++) {
        await tx.insert(dailyReports).values({
          reportDate: new Date(`2099-03-0${i}`),
          checkedInCount: 0,
          newPatientsCount: 0,
          totalPayments: 0,
          totalExpenses: 0,
          balances: {},
          inventoryUsed: [],
          productsSold: [],
          moduleSummaries: {},
          submittedById: userId,
        })
      }
      const page = await listDailyReports(tx, { from: '2099-01-01', to: '2099-12-31', limit: 2 })
      expect(page.total).toBe(3)
      expect(page.data.length).toBe(2)
      const page2 = await listDailyReports(tx, {
        from: '2099-01-01',
        to: '2099-12-31',
        limit: 2,
        offset: 2,
      })
      expect(page2.data.length).toBe(1)
    })
  })
})

// ── §6.3 — treatment-plan items sourced from the services catalog ────────────

describe.skipIf(noDb)('admin-v1 §6.3 — treatment-plan items from catalog', () => {
  it('sources name + cost from the linked service; keeps free-text items', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const [svc] = await tx
        .insert(services)
        .values({ category: 'clinic', name: 'IT Scaling', amount: 250, createdById: userId })
        .returning()

      const resolved = await resolveCatalogPlanItems(tx, [
        // linked to the catalog — typed name/cost must be IGNORED in favour of the service
        { serviceId: svc.id, procedureName: 'typed-name-ignored', estimatedCost: 999 },
        // no serviceId — a custom procedure keeps its free-typed values
        { procedureName: 'Custom procedure', estimatedCost: 80 },
      ])

      expect(resolved[0].serviceId).toBe(svc.id)
      expect(resolved[0].procedureName).toBe('IT Scaling')
      expect(resolved[0].estimatedCost).toBe(250)
      expect(resolved[1].serviceId).toBeNull()
      expect(resolved[1].procedureName).toBe('Custom procedure')
      expect(resolved[1].estimatedCost).toBe(80)
    })
  })
})

// ── §6.4 — ADA-style category taxonomy ───────────────────────────────────────

describe('admin-v1 §6.4 — ADA taxonomy (pure)', () => {
  it('keeps valid groups and defaults unknown/empty to Adjunctive', () => {
    expect(normalizeAdaGroup('Restorative')).toBe('Restorative')
    expect(normalizeAdaGroup('Endodontics')).toBe('Endodontics')
    expect(normalizeAdaGroup('Bogus')).toBe('Adjunctive')
    expect(normalizeAdaGroup(undefined)).toBe('Adjunctive')
    expect(normalizeAdaGroup(42)).toBe('Adjunctive')
  })
})

describe.skipIf(noDb)('admin-v1 §6.4 — ADA taxonomy (db)', () => {
  it('treatment_types.adaGroup defaults to Adjunctive', async () => {
    await withRollback(async (tx) => {
      const [tt] = await tx
        .insert(treatmentTypes)
        .values({ name: `it-tt-${randomUUID().slice(0, 8)}` })
        .returning()
      expect(tt.adaGroup).toBe('Adjunctive')
    })
  })
})

// ── §10.4 — server-side lab-expense gate on report submission ─────────────────

describe.skipIf(noDb)('admin-v1 §10.4 — lab-expense gate', () => {
  it('counts an uncleared expense-ready lab case, and stops counting once cleared', async () => {
    await withRollback(async (tx) => {
      const HORIZON = new Date('2099-01-01')
      const before = await countUnclearedLabExpenses(tx, HORIZON)

      const pid = await makePatient(tx, 'IT Lab Gate')
      const [vendor] = await tx
        .insert(labVendors)
        .values({ name: `IT V ${randomUUID().slice(0, 8)}`, type: 'external' })
        .returning()
      const [lc] = await tx
        .insert(labCases)
        .values({
          caseNumber: `LC-${randomUUID().slice(0, 8)}`,
          serviceName: 'S',
          patientId: pid,
          vendorId: vendor.id,
          status: 'sent',
          domain: 'external',
          expenseReadyAt: new Date('2098-01-01'), // ready, uncleared (no externalExpenseId)
        })
        .returning()

      expect(await countUnclearedLabExpenses(tx, HORIZON)).toBe(before + 1)

      // recording the expense (externalExpenseId set) clears the gate
      await tx
        .update(labCases)
        .set({ externalExpenseId: randomUUID() })
        .where(eq(labCases.id, lc.id))
      expect(await countUnclearedLabExpenses(tx, HORIZON)).toBe(before)

      // a case ready AFTER the horizon does not count
      await tx.insert(labCases).values({
        caseNumber: `LC-${randomUUID().slice(0, 8)}`,
        serviceName: 'S',
        patientId: pid,
        vendorId: vendor.id,
        status: 'sent',
        domain: 'external',
        expenseReadyAt: new Date('2099-06-01'),
      })
      expect(await countUnclearedLabExpenses(tx, HORIZON)).toBe(before)
    })
  })
})

// ── §18.1 — comms consent (do-not-contact) ───────────────────────────────────

describe.skipIf(noDb)('admin-v1 §18.1 — comms consent', () => {
  async function makeOptedOut(tx: Parameters<Parameters<typeof withRollback>[0]>[0]) {
    const [p] = await tx
      .insert(patients)
      .values({
        name: `IT OptOut ${randomUUID().slice(0, 8)}`,
        dob: new Date('1990-01-01'),
        gender: 'other',
        doNotContact: true,
      })
      .returning()
    return p.id
  }

  it('getContactablePatientIds excludes opted-out patients', async () => {
    await withRollback(async (tx) => {
      const okId = await makePatient(tx, 'IT Contactable')
      const optedId = await makeOptedOut(tx)
      const set = await getContactablePatientIds(tx, [okId, optedId])
      expect(set.has(okId)).toBe(true)
      expect(set.has(optedId)).toBe(false)
    })
  })

  it('filterContactable drops opted-out, keeps contactable + ad-hoc (no patientId)', async () => {
    await withRollback(async (tx) => {
      const okId = await makePatient(tx, 'IT Contactable2')
      const optedId = await makeOptedOut(tx)
      const filtered = await filterContactable(tx, [
        { patientId: okId, phone: 'a' },
        { patientId: optedId, phone: 'b' },
        { patientId: null, phone: 'adhoc' },
      ])
      expect(filtered.map((r) => r.phone).sort()).toEqual(['a', 'adhoc'])
    })
  })
})

// ── §13.5 — SMS/email cost → Marketing expense (posts to GL) ──────────────────

describe.skipIf(noDb)('admin-v1 §13.5 — comms cost to the books', () => {
  it('records an SMS send as a posted Marketing expense', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      await getOrCreatePeriodFor(tx, new Date()) // GL post needs an open period
      const res = await recordCommsCost(tx, { channel: 'sms', count: 100, createdBy: userId })
      expect(res.amount).toBe(400) // 100 × GHS 0.04 = GHS 4.00, in cents
      expect(res.posted).toBe(true)
      expect(res.expenseId).toBeTruthy()
      const entry = await tx.query.journalEntries.findFirst({
        where: and(
          eq(journalEntries.sourceDocType, 'expense' as never),
          eq(journalEntries.sourceDocId, res.expenseId as string)
        ),
      })
      expect(entry).toBeTruthy()
    })
  })

  it('a zero-count send posts nothing', async () => {
    await withRollback(async (tx) => {
      const userId = await anyUserId(tx)
      const res = await recordCommsCost(tx, { channel: 'sms', count: 0, createdBy: userId })
      expect(res.amount).toBe(0)
      expect(res.posted).toBe(false)
    })
  })
})

// ── §10.1 — daily digest providers ───────────────────────────────────────────

describe.skipIf(noDb)('admin-v1 §10.1 — digest providers', () => {
  it('summarizes labs / x-rays / store / new-patients for the day', async () => {
    await withRollback(async (tx) => {
      const day = new Date('2099-03-15T10:00:00.000Z') // far-future → isolated
      const [pat] = await tx
        .insert(patients)
        .values({
          name: `IT Digest ${randomUUID().slice(0, 8)}`,
          dob: new Date('1990-01-01'),
          gender: 'other',
          createdAt: day,
        })
        .returning()
      const [vendor] = await tx
        .insert(labVendors)
        .values({ name: `IT V ${randomUUID().slice(0, 8)}`, type: 'external' })
        .returning()
      await tx.insert(labCases).values({
        caseNumber: `LC-${randomUUID().slice(0, 8)}`,
        serviceName: 'S',
        patientId: pat.id,
        vendorId: vendor.id,
        status: 'sent',
        domain: 'external',
        createdAt: day,
      })
      await tx
        .insert(xrayRecords)
        .values({ patientId: pat.id, imageUrl: 'x', origin: 'internal', uploadedAt: day })
      const [item] = await tx
        .insert(items)
        .values({ name: `IT D ${randomUUID().slice(0, 8)}`, sellable: true })
        .returning()
      await tx.insert(sales).values({
        itemId: item.id,
        quantity: 1,
        unitPrice: 10,
        costPrice: 5,
        totalAmount: 10,
        profit: 5,
        status: 'submitted',
        saleDate: day,
      })

      const blocks = await buildModuleSummaries(tx, day)
      const mods = new Set(blocks.map((b) => b.module))
      expect(mods.has('labs')).toBe(true)
      expect(mods.has('xrays')).toBe(true)
      expect(mods.has('store')).toBe(true)
      expect(mods.has('new-patients')).toBe(true)
    })
  })

  const metric = (block: { metrics: { label: string; value: string | number }[] }, label: string) =>
    block.metrics.find((m) => m.label === label)?.value

  it('§13.6 — CRM block counts messages sent / failed for the day', async () => {
    await withRollback(async (tx) => {
      const day = new Date('2099-04-10T10:00:00.000Z')
      await tx.insert(smsMessages).values([
        { recipient: '+233200000001', content: 'x', type: 'bulk', status: 'sent', sentAt: day },
        { recipient: '+233200000002', content: 'y', type: 'bulk', status: 'failed', sentAt: day },
      ])
      const blocks = await buildModuleSummaries(tx, day)
      const crm = blocks.find((b) => b.module === 'crm')
      expect(crm).toBeTruthy()
      expect(metric(crm!, 'Messages sent')).toBe(2)
      expect(metric(crm!, 'Failed SMS')).toBe(1)
    })
  })

  it('§14.5 — HR block counts on-leave staff for the day', async () => {
    await withRollback(async (tx) => {
      const day = new Date('2099-04-11T10:00:00.000Z')
      const [s] = await tx
        .insert(staff)
        .values({
          staffId: `IT-${randomUUID().slice(0, 6)}`,
          fullName: 'IT Staff',
          employmentType: 'permanent',
          status: 'active',
          birthMonth: 4,
          birthDay: 11,
        })
        .returning()
      await tx.insert(staffRequests).values({
        staffId: s.id,
        requestType: 'leave',
        status: 'approved',
        startDate: new Date('2099-04-10T00:00:00.000Z'),
        endDate: new Date('2099-04-12T00:00:00.000Z'),
      })
      const blocks = await buildModuleSummaries(tx, day)
      const hr = blocks.find((b) => b.module === 'hr')
      expect(hr).toBeTruthy()
      expect(metric(hr!, 'On leave')).toBe(1)
      // Birthday match (Apr 11) — at least the staff we just inserted.
      expect(Number(metric(hr!, 'Birthdays'))).toBeGreaterThanOrEqual(1)
    })
  })

  it('§15.3 — Training block counts completions for the day', async () => {
    await withRollback(async (tx) => {
      const day = new Date('2099-04-12T10:00:00.000Z')
      const userId = await anyUserId(tx)
      const [s] = await tx
        .insert(staff)
        .values({
          staffId: `IT-${randomUUID().slice(0, 6)}`,
          fullName: 'IT Staff',
          employmentType: 'permanent',
        })
        .returning()
      const [tm] = await tx
        .insert(trainingMaterials)
        .values({ title: `IT Train ${randomUUID().slice(0, 8)}`, uploadedById: userId })
        .returning()
      await tx.insert(staffTrainingProgress).values({
        staffId: s.id,
        trainingId: tm.id,
        status: 'completed',
        completedAt: day,
      })
      const blocks = await buildModuleSummaries(tx, day)
      const training = blocks.find((b) => b.module === 'training')
      expect(training).toBeTruthy()
      expect(metric(training!, 'Completed today')).toBe(1)
    })
  })

  it('§17.3 — Compliance block counts documents added for the day', async () => {
    await withRollback(async (tx) => {
      const day = new Date('2099-04-13T10:00:00.000Z')
      await tx.insert(complianceDocuments).values({
        documentName: `IT Doc ${randomUUID().slice(0, 8)}`,
        category: 'health',
        createdAt: day,
      })
      const blocks = await buildModuleSummaries(tx, day)
      const compliance = blocks.find((b) => b.module === 'compliance')
      expect(compliance).toBeTruthy()
      expect(metric(compliance!, 'Added today')).toBe(1)
    })
  })

  it('§18.3 — Consents block counts forms signed for the day', async () => {
    await withRollback(async (tx) => {
      const day = new Date('2099-04-14T10:00:00.000Z')
      const patId = await makePatient(tx, `IT ${randomUUID().slice(0, 8)}`)
      const [tmpl] = await tx
        .insert(consentFormTemplates)
        .values({ name: `IT Tmpl ${randomUUID().slice(0, 8)}`, content: 'body' })
        .returning()
      await tx.insert(signedConsentForms).values({
        templateId: tmpl.id,
        patientId: patId,
        signatureData: 'x',
        signedByName: 'IT',
        contentSnapshot: 'body',
        signedAt: day,
      })
      const blocks = await buildModuleSummaries(tx, day)
      const consents = blocks.find((b) => b.module === 'consents')
      expect(consents).toBeTruthy()
      expect(metric(consents!, 'Signed today')).toBe(1)
    })
  })
})

// ── §17.2 — compliance renewal reminders ──────────────────────────────────────

describe.skipIf(noDb)('admin-v1 §17.2 — compliance renewal reminders', () => {
  it('selects only docs inside the window, with phones, enabled, not yet reminded', async () => {
    await withRollback(async (tx) => {
      const now = new Date('2099-06-01T10:00:00.000Z')
      const mk = (over: Partial<typeof complianceDocuments.$inferInsert>) =>
        tx
          .insert(complianceDocuments)
          .values({
            documentName: `IT C ${randomUUID().slice(0, 8)}`,
            category: 'health',
            reminderEnabled: true,
            reminderMonthsBefore: 3,
            reminderPhones: ['+233200000001'],
            ...over,
          })
          .returning()
          .then(([r]) => r)

      // window for a 3-month reminder on a 2099-07-15 expiry = [2099-04-15, 2099-07-15]
      const due = await mk({ dateExpired: new Date('2099-07-15T00:00:00.000Z') })
      const tooFar = await mk({ dateExpired: new Date('2099-12-01T00:00:00.000Z') }) // window starts 2099-09-01
      const expired = await mk({ dateExpired: new Date('2099-05-01T00:00:00.000Z') }) // already past
      const disabled = await mk({
        dateExpired: new Date('2099-07-15T00:00:00.000Z'),
        reminderEnabled: false,
      })
      const noPhones = await mk({
        dateExpired: new Date('2099-07-15T00:00:00.000Z'),
        reminderPhones: [],
      })
      const alreadySent = await mk({
        dateExpired: new Date('2099-07-15T00:00:00.000Z'),
        lastReminderSentAt: new Date('2099-05-15T00:00:00.000Z'), // at/after window start
      })

      const ids = new Set((await selectComplianceDocsDueForReminder(tx, now)).map((d) => d.id))
      expect(ids.has(due.id)).toBe(true)
      expect(ids.has(tooFar.id)).toBe(false)
      expect(ids.has(expired.id)).toBe(false)
      expect(ids.has(disabled.id)).toBe(false)
      expect(ids.has(noPhones.id)).toBe(false)
      expect(ids.has(alreadySent.id)).toBe(false)
    })
  })
})

// ── §17.2 — reminder message builder (pure, no DB) ────────────────────────────

describe('admin-v1 §17.2 — reminder message tokens', () => {
  const doc = {
    documentName: 'Fire Safety Certificate',
    dateExpired: new Date('2099-07-15T00:00:00.000Z'),
  }

  it('interpolates {documentName} and {dateExpired} in a custom message', () => {
    const msg = buildComplianceReminderMessage({
      ...doc,
      reminderMessage: 'Heads up: {documentName} expires {dateExpired}.',
    })
    expect(msg).toContain('Fire Safety Certificate')
    expect(msg).not.toContain('{documentName}')
    expect(msg).not.toContain('{dateExpired}')
  })

  it('falls back to a default message when none is configured', () => {
    const msg = buildComplianceReminderMessage({ ...doc, reminderMessage: null })
    expect(msg).toContain('Fire Safety Certificate')
    expect(msg.toLowerCase()).toContain('renewal')
  })
})

// ── §13.2 — CRM auto-queue (birthday + follow-up) ─────────────────────────────

describe.skipIf(noDb)('admin-v1 §13.2 — CRM auto-queue', () => {
  const now = new Date('2099-06-09T10:00:00.000Z')

  async function seed(tx: DB) {
    const tag = randomUUID().slice(0, 8)
    const [bday] = await tx
      .insert(patients)
      .values({
        name: `IT Bday ${tag}`,
        dob: new Date('1990-06-09'), // birthday = now's month/day
        gender: 'other',
        phone: '+233200000001',
      })
      .returning()
    const [optout] = await tx
      .insert(patients)
      .values({
        name: `IT Opt ${tag}`,
        dob: new Date('1985-06-09'), // same birthday, but opted out
        gender: 'other',
        phone: '+233200000002',
        doNotContact: true,
      })
      .returning()
    const [fu] = await tx
      .insert(patients)
      .values({
        name: `IT FU ${tag}`,
        dob: new Date('1992-02-02'),
        gender: 'other',
        phone: '+233200000003',
      })
      .returning()
    // appointments.doctorId is a required FK — reuse any existing doctor, or
    // mint one from a user if the dev DB has none.
    let [dr] = await tx.select({ id: doctors.id }).from(doctors).limit(1)
    if (!dr) {
      const userId = await anyUserId(tx)
      ;[dr] = await tx
        .insert(doctors)
        .values({ userId, specialty: 'General' })
        .returning({ id: doctors.id })
    }
    await tx.insert(appointments).values({
      patientId: fu.id,
      doctorId: dr.id,
      date: new Date('2099-06-06T17:00:00.000Z'),
      status: 'completed',
      type: 'checkup',
      completedAt: new Date('2099-06-06T18:00:00.000Z'), // ~60h before now → 48–72h window
    })
    return { bday, optout, fu }
  }

  it('selects today birthdays + 48–72h follow-ups, excludes opted-out', async () => {
    await withRollback(async (tx) => {
      const { bday, optout, fu } = await seed(tx)
      const byId = new Map(
        (await selectCrmAutoQueueCandidates(tx, now)).map((c) => [c.patientId, c.kind])
      )
      expect(byId.get(bday.id)).toBe('birthday')
      expect(byId.get(fu.id)).toBe('followup')
      expect(byId.has(optout.id)).toBe(false)
    })
  })

  it('queues with requiresConfirmation=true and is idempotent per (patient, kind, day)', async () => {
    await withRollback(async (tx) => {
      const { bday } = await seed(tx)
      await runCrmAutoQueue(tx, now)
      const rows1 = await tx
        .select()
        .from(scheduledReminders)
        .where(eq(scheduledReminders.patientId, bday.id))
      expect(rows1).toHaveLength(1)
      expect(rows1[0].requiresConfirmation).toBe(true)
      expect(rows1[0].confirmedAt).toBeNull()
      expect(rows1[0].status).toBe('pending')

      await runCrmAutoQueue(tx, now) // re-run same day
      const rows2 = await tx
        .select()
        .from(scheduledReminders)
        .where(eq(scheduledReminders.patientId, bday.id))
      expect(rows2).toHaveLength(1) // no duplicate
    })
  })
})
