import { api } from '@/lib/api-client'

export async function createSale(input: any) {
  const res = await api.post<any>('/api/sales', input)
  return res
}

export async function getSales(startDate?: Date, endDate?: Date) {
  const query = new URLSearchParams()
  if (startDate) query.append('startDate', startDate.toISOString())
  if (endDate) query.append('endDate', endDate.toISOString())
  return api.get<any[]>(`/api/sales?${query.toString()}`)
}

export async function getDailySales(date: Date = new Date()) {
  return getSales(date, date)
}
