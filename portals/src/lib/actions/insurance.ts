import { api } from '@/lib/api-client'

export interface InsuranceCompany {
  id: string
  name: string
}

export async function getInsuranceCompanies() {
  return api.get<InsuranceCompany[]>('/api/insurance/companies')
}
