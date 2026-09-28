import { api } from '@/lib/api-client'

export type PlanScheduleType = 'fixed' | 'flexible'
export type InstallmentPeriod = 'weekly' | 'biweekly' | 'monthly'
export type PlanStatus =
  | 'active'
  | 'activated'
  | 'completed'
  | 'defaulted'
  | 'cancelled'
  | 'overdue'
  | 'paused'
  | 'outstanding'

export type ScheduleItem = {
  id: string
  paymentPlanId: string
  sequence: number
  expectedDate: string
  expectedAmount: number
  status: 'pending' | 'paid' | 'partial' | 'overdue' | 'waived'
  amountReceived: number
}

export type CreatePlanV2Input = {
  patientId: string
  totalAmount: number
  scheduleType: PlanScheduleType
  startDate?: string
  numberOfInstallments?: number
  installmentPeriod?: InstallmentPeriod
  notes?: string | null
  templateId?: string | null
  treatments?: Array<{ treatmentId: string; name: string; amount: number }>
  revenueAccountCode?: string
  issueImmediately?: boolean
}

export async function getPlanSchedule(planId: string) {
  const res = await api.get<ScheduleItem[]>(`/api/payment-plans/${planId}/schedule`)
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function recomputePlanSchedule(planId: string) {
  return api.post<{ success: boolean }>(`/api/payment-plans/${planId}/recompute`, {})
}

export async function createPlanV2(input: CreatePlanV2Input) {
  return api.post<{
    plan: { id: string; planNumber: string; status: PlanStatus; invoiceId: string }
    invoice: { id: string; invoiceNumber: string; status: string; total: number }
    scheduleItems: ScheduleItem[]
  }>('/api/payment-plans/v2', input)
}
