import { api } from '@/lib/api-client'

export async function getPaymentPlanTemplates() {
  return api.get<any[]>('/api/payment-plans/templates')
}

export async function getPaymentPlanTemplate(id: string) {
  return api.get<any>(`/api/payment-plans/templates/${id}`)
}

export async function getDefaultPaymentPlanTemplate() {
  return api.get<any>('/api/payment-plans/templates/default')
}

export async function createPaymentPlanTemplate(data: any) {
  const res = await api.post<any>('/api/payment-plans/templates', data)
  return res
}

export async function updatePaymentPlanTemplate(id: string, data: any) {
  const res = await api.patch<any>(`/api/payment-plans/templates/${id}`, data)
  return res
}

export async function deletePaymentPlanTemplate(id: string) {
  const res = await api.delete<any>(`/api/payment-plans/templates/${id}`)
  return res
}
