import { api } from '@/lib/api-client'

export type PeriodSummary = {
  range: { from: string; to: string }
  prior: { from: string; to: string }
  executive: {
    totalPayments: number
    totalExpenses: number
    netIncome: number
    marginPct: number
    newPatients: number
    newCases: number
    completedCases: number
    avgRevenuePerPatient: number
    collectionRate: number
    vsPrior: {
      totalPayments: number
      totalExpenses: number
      newPatients: number
      newCases: number
    }
  }
  finance: {
    expensesByCategory: Array<{ category: string; amount: number }>
    expensesByDay: Array<{ date: string; amount: number }>
    paymentsByTreatment: Array<{ treatment: string; amount: number; count: number }>
    paymentsByMethod: Array<{ method: string; amount: number }>
    paymentsByDay: Array<{ date: string; amount: number }>
    paymentsByPlan: Array<{ planId: string | null; planName: string; amount: number }>
    paymentPlans: { totalReceived: number; totalOutstanding: number }
    outstandingByTreatment: Array<{ treatment: string; amount: number }>
  }
  ops: {
    appointmentsBooked: number
    appointmentsCheckedIn: number
    appointmentsCancelled: number
    appointmentsNoShow: number
    appointmentsByDay: Array<{ date: string; count: number }>
    noShowRate: number
    cancellationRate: number
    newPatients: number
    returningPatients: number
    totalCases: number
    completedCases: number
    doctorUtilization: Array<{
      doctorId: string | null
      doctorName: string
      appointmentCount: number
      hours: number
    }>
  }
  clinical: {
    proceduresByType: Array<{ type: string; count: number; revenue: number }>
    xraysTaken: number
    prescriptionsIssued: number
    consentForms: { completed: number; outstanding: number }
  }
}

export type PeriodListEntry = {
  key: string
  label: string
  start: string
  end: string
  revenue: number
  expenses: number
  patientCount: number
  vsPrior: { revenuePct: number; expensesPct: number; patientCountPct: number }
}

export async function getPeriodSummary(from: string, to: string) {
  return api.get<PeriodSummary>(
    `/api/reports/period-summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  )
}

export async function getPeriodList(tier: 'weekly' | 'monthly' | 'quarterly', count = 6) {
  return api.get<PeriodListEntry[]>(`/api/reports/period-list?tier=${tier}&count=${count}`)
}
