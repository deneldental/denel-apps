import { api } from '@/lib/api-client'

export async function getDoctors() {
  return api.get<any[]>('/api/doctors')
}
