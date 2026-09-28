// Sample-data generator for the PeriodReport. When the backend returns an empty
// payload (no payments, no patients, no appointments in the range), the report
// falls back to this so the UI is previewable. A "Sample data" badge tells the
// user it's not real numbers.
//
// The output shape matches `PeriodSummary` exactly. Numbers scale with range
// length so weekly/monthly/quarterly reports each look proportionate.

import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import type { PeriodSummary } from '@/lib/actions/period-report'

// Deterministic pseudo-random — seed by date string so the sample doesn't
// jitter on every render but does differ between weeks/months/quarters.
function seeded(seed: number, salt: number): number {
  const x = Math.sin((seed + 1) * 6151 + salt * 41719) * 54321
  return x - Math.floor(x)
}

function dateSeed(iso: string): number {
  let s = 0
  for (let i = 0; i < iso.length; i++) s = (s * 31 + iso.charCodeAt(i)) | 0
  return Math.abs(s)
}

export function buildSamplePeriodSummary(from: string, to: string): PeriodSummary {
  const start = parseISO(from)
  const end = parseISO(to)
  const days = Math.max(1, differenceInCalendarDays(end, start) + 1)
  const seed = dateSeed(from)

  // Tier-aware base scale. A week has ~7 days; a month ~30; a quarter ~90.
  // Daily revenue average ~3500 GHS, daily expense ~1200, ~6 appointments/day.
  const dailyRevenue = 3200 + Math.round(seeded(seed, 1) * 700)
  const dailyExpense = 950 + Math.round(seeded(seed, 2) * 500)
  const dailyAppts = 5 + Math.round(seeded(seed, 3) * 4)

  const totalPayments = Math.round(dailyRevenue * days * (0.85 + seeded(seed, 4) * 0.3))
  const totalExpenses = Math.round(dailyExpense * days * (0.85 + seeded(seed, 5) * 0.3))
  const newPatients = Math.max(1, Math.round(days * (0.6 + seeded(seed, 6) * 0.6)))
  const newCases = Math.max(1, Math.round(newPatients * (0.7 + seeded(seed, 7) * 0.4)))
  const completedCases = Math.round(newCases * (0.5 + seeded(seed, 8) * 0.4))
  const uniquePayers = Math.max(1, Math.round(newPatients * 1.8))
  const totalInvoiced = Math.round(totalPayments * 1.15)
  const totalPaidOnInvoices = Math.round(totalInvoiced * (0.7 + seeded(seed, 9) * 0.25))

  // ── Executive ──────────────────────────────────────────────────────────
  const netIncome = totalPayments - totalExpenses
  const marginPct = totalPayments > 0 ? (netIncome / totalPayments) * 100 : 0
  const collectionRate = totalInvoiced > 0 ? (totalPaidOnInvoices / totalInvoiced) * 100 : 0
  const avgRevenuePerPatient = uniquePayers > 0 ? totalPayments / uniquePayers : 0

  // Pseudo vs-prior — small random swings around 0
  const vsPrior = {
    totalPayments: -8 + seeded(seed, 10) * 32,
    totalExpenses: -10 + seeded(seed, 11) * 22,
    newPatients: -12 + seeded(seed, 12) * 30,
    newCases: -8 + seeded(seed, 13) * 24,
  }

  // ── Finance breakdowns ─────────────────────────────────────────────────
  const expenseCats = [
    { category: 'Lab', weight: 0.32 },
    { category: 'Supplies', weight: 0.22 },
    { category: 'Salaries', weight: 0.25 },
    { category: 'Utilities', weight: 0.08 },
    { category: 'Rent', weight: 0.1 },
    { category: 'Other', weight: 0.03 },
  ]
  const expensesByCategory = expenseCats.map((c) => ({
    category: c.category,
    amount: Math.round(totalExpenses * c.weight),
  }))

  const treatments = [
    { name: 'Cleaning', share: 0.18, perCount: 220 },
    { name: 'Filling', share: 0.22, perCount: 380 },
    { name: 'Root Canal', share: 0.2, perCount: 1850 },
    { name: 'Extraction', share: 0.1, perCount: 320 },
    { name: 'Crown', share: 0.15, perCount: 2100 },
    { name: 'Whitening', share: 0.08, perCount: 950 },
    { name: 'Consultation', share: 0.07, perCount: 150 },
  ]
  const paymentsByTreatment = treatments
    .map((t) => {
      const amount = Math.round(totalPayments * t.share)
      const count = Math.max(1, Math.round(amount / t.perCount))
      return { treatment: t.name, amount, count }
    })
    .sort((a, b) => b.amount - a.amount)

  const methods = [
    { method: 'cash', share: 0.32 },
    { method: 'momo', share: 0.28 },
    { method: 'card', share: 0.18 },
    { method: 'insurance', share: 0.14 },
    { method: 'transfer', share: 0.08 },
  ]
  const paymentsByMethod = methods.map((m) => ({
    method: m.method,
    amount: Math.round(totalPayments * m.share),
  }))

  // Per-day spread — Mon–Sat busier than Sun. Pick a peak day for realism.
  const peakIndex = Math.floor(seeded(seed, 14) * days)
  const expensesByDay: Array<{ date: string; amount: number }> = []
  const paymentsByDay: Array<{ date: string; amount: number }> = []
  const appointmentsByDay: Array<{ date: string; count: number }> = []

  // Cap charts at ~31 entries; for quarterly (90 days) pick the last 31 days
  // so the bars stay legible.
  const maxBars = 31
  const stride = days > maxBars ? Math.ceil(days / maxBars) : 1
  let payRunning = 0
  let expRunning = 0
  let apptRunning = 0
  for (let i = 0; i < days; i++) {
    const dayDate = format(addDays(start, i), 'yyyy-MM-dd')
    const dow = (start.getUTCDay() + i) % 7
    const dowFactor = dow === 0 ? 0.4 : dow === 6 ? 0.7 : 1
    const peakBoost = i === peakIndex ? 1.7 : 1
    const noise = 0.7 + seeded(seed, 100 + i) * 0.7

    const dayPay = Math.round(dailyRevenue * dowFactor * peakBoost * noise)
    const dayExp = Math.round(dailyExpense * dowFactor * (0.8 + seeded(seed, 200 + i) * 0.5))
    const dayAppts = Math.max(0, Math.round(dailyAppts * dowFactor * peakBoost * noise))

    payRunning += dayPay
    expRunning += dayExp
    apptRunning += dayAppts

    if (i % stride === 0) {
      paymentsByDay.push({ date: dayDate, amount: payRunning })
      expensesByDay.push({ date: dayDate, amount: expRunning })
      appointmentsByDay.push({ date: dayDate, count: apptRunning })
      payRunning = 0
      expRunning = 0
      apptRunning = 0
    }
  }
  // Flush any trailing accumulated bucket
  if (payRunning > 0 || expRunning > 0 || apptRunning > 0) {
    const lastDate = format(end, 'yyyy-MM-dd')
    paymentsByDay.push({ date: lastDate, amount: payRunning })
    expensesByDay.push({ date: lastDate, amount: expRunning })
    appointmentsByDay.push({ date: lastDate, count: apptRunning })
  }

  // Payment plans
  const paymentsByPlan = [
    {
      planId: 'sample-plan-1',
      planName: 'Ortho — Phase 1',
      amount: Math.round(totalPayments * 0.12),
    },
    {
      planId: 'sample-plan-2',
      planName: 'Implants Plan',
      amount: Math.round(totalPayments * 0.08),
    },
    { planId: 'sample-plan-3', planName: 'Crown Bridge', amount: Math.round(totalPayments * 0.05) },
  ]
  const paymentPlans = {
    totalReceived: paymentsByPlan.reduce((s, p) => s + p.amount, 0),
    totalOutstanding: Math.round(totalPayments * 0.45),
  }

  const outstandingByTreatment = [
    { treatment: 'Crown', amount: Math.round(totalPayments * 0.15) },
    { treatment: 'Root Canal', amount: Math.round(totalPayments * 0.12) },
    { treatment: 'Implants', amount: Math.round(totalPayments * 0.1) },
    { treatment: 'Ortho', amount: Math.round(totalPayments * 0.08) },
  ]

  // ── Ops ────────────────────────────────────────────────────────────────
  const appointmentsBooked = appointmentsByDay.reduce((s, d) => s + d.count, 0)
  const appointmentsCheckedIn = Math.round(appointmentsBooked * (0.78 + seeded(seed, 15) * 0.12))
  const appointmentsCancelled = Math.round(appointmentsBooked * (0.05 + seeded(seed, 16) * 0.05))
  const appointmentsNoShow = Math.round(appointmentsBooked * (0.04 + seeded(seed, 17) * 0.06))
  const noShowRate = appointmentsBooked > 0 ? (appointmentsNoShow / appointmentsBooked) * 100 : 0
  const cancellationRate =
    appointmentsBooked > 0 ? (appointmentsCancelled / appointmentsBooked) * 100 : 0
  const returningPatients = Math.max(0, Math.round(uniquePayers - newPatients))

  const doctorUtilization = [
    {
      doctorId: 'sample-doc-1',
      doctorName: 'Dr. Ama Mensah',
      appointmentCount: Math.round(appointmentsBooked * 0.42),
      hours: Math.round(appointmentsBooked * 0.42 * 0.5 * 10) / 10,
    },
    {
      doctorId: 'sample-doc-2',
      doctorName: 'Dr. Kwesi Owusu',
      appointmentCount: Math.round(appointmentsBooked * 0.36),
      hours: Math.round(appointmentsBooked * 0.36 * 0.5 * 10) / 10,
    },
    {
      doctorId: 'sample-doc-3',
      doctorName: 'Dr. Linda Osei',
      appointmentCount: Math.round(appointmentsBooked * 0.22),
      hours: Math.round(appointmentsBooked * 0.22 * 0.5 * 10) / 10,
    },
  ]

  // ── Clinical ───────────────────────────────────────────────────────────
  const proceduresByType = [
    { type: 'Cleaning', count: Math.round(days * 1.2), revenue: Math.round(totalPayments * 0.18) },
    { type: 'Filling', count: Math.round(days * 0.9), revenue: Math.round(totalPayments * 0.22) },
    { type: 'Extraction', count: Math.round(days * 0.4), revenue: Math.round(totalPayments * 0.1) },
    {
      type: 'Root Canal',
      count: Math.round(days * 0.25),
      revenue: Math.round(totalPayments * 0.2),
    },
    {
      type: 'Crown Fit',
      count: Math.round(days * 0.18),
      revenue: Math.round(totalPayments * 0.15),
    },
    {
      type: 'Consultation',
      count: Math.round(days * 0.6),
      revenue: Math.round(totalPayments * 0.07),
    },
    {
      type: 'Whitening',
      count: Math.round(days * 0.12),
      revenue: Math.round(totalPayments * 0.08),
    },
  ].sort((a, b) => b.count - a.count)

  const xraysTaken = Math.round(days * (0.8 + seeded(seed, 18) * 0.6))
  const prescriptionsIssued = Math.round(days * (0.6 + seeded(seed, 19) * 0.5))
  const consentCompleted = Math.round(days * (0.4 + seeded(seed, 20) * 0.4))
  const consentOutstanding = 3 + Math.round(seeded(seed, 21) * 6)

  return {
    range: { from, to },
    prior: { from, to },
    executive: {
      totalPayments,
      totalExpenses,
      netIncome,
      marginPct,
      newPatients,
      newCases,
      completedCases,
      avgRevenuePerPatient,
      collectionRate,
      vsPrior,
    },
    finance: {
      expensesByCategory,
      expensesByDay,
      paymentsByTreatment,
      paymentsByMethod,
      paymentsByDay,
      paymentsByPlan,
      paymentPlans,
      outstandingByTreatment,
    },
    ops: {
      appointmentsBooked,
      appointmentsCheckedIn,
      appointmentsCancelled,
      appointmentsNoShow,
      appointmentsByDay,
      noShowRate,
      cancellationRate,
      newPatients,
      returningPatients,
      totalCases: newCases,
      completedCases,
      doctorUtilization,
    },
    clinical: {
      proceduresByType,
      xraysTaken,
      prescriptionsIssued,
      consentForms: { completed: consentCompleted, outstanding: consentOutstanding },
    },
  }
}

/** Returns true when the period payload has no real activity worth showing. */
export function isPeriodEmpty(p: PeriodSummary): boolean {
  return (
    p.executive.totalPayments === 0 &&
    p.executive.totalExpenses === 0 &&
    p.executive.newPatients === 0 &&
    p.ops.appointmentsBooked === 0
  )
}
