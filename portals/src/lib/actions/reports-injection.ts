import { type ApiResponse, api } from '@/lib/api-client'

export type InjectionRow = {
  id: string
  section: string
  enabled: boolean
  config: Record<string, unknown>
  updatedById: string | null
  updatedAt: string
}

export function getInjectionConfigs(): Promise<ApiResponse<InjectionRow[]>> {
  return api.get<InjectionRow[]>('/api/reports-injection')
}

export function updateInjectionSection(
  section: string,
  payload: { enabled: boolean; config?: Record<string, unknown> }
): Promise<ApiResponse<InjectionRow>> {
  return api.put<InjectionRow>(`/api/reports-injection/${section}`, payload)
}
