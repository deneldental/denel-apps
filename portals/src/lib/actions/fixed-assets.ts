import { api } from '@/lib/api-client'

/**
 * Server-action wrappers for the Fixed Asset Register (admin-v1 §4.F6).
 * Mirrors backend/src/routes/fixed-assets.ts. The GL services keep the books
 * balanced + idempotent; the UI only triggers per-period posting actions.
 */

export type FixedAsset = {
  id: string
  name: string
  category: string | null
  acquisitionCost: number
  acquisitionDate: string
  usefulLifeMonths: number
  salvageValue: number
  depreciationMethod: string
  status: string
  assetAccountId: string | null
  expenseAccountId: string | null
  accumDepAccountId: string | null
  createdById: string | null
  createdAt: string
  updatedAt: string
}

export type DepreciationSchedule = {
  id: string
  fixedAssetId: string
  periodDate: string
  amount: number
  posted: boolean
  journalEntryId: string | null
  createdAt: string
}

export type FixedAssetDetail = FixedAsset & { schedules: DepreciationSchedule[] }

export type PrepaidAsset = {
  id: string
  name: string
  totalAmount: number
  startDate: string
  months: number
  monthlyAmount: number
  prepaidAccountId: string | null
  expenseAccountId: string | null
  status: string
  createdById: string | null
  createdAt: string
  updatedAt: string
}

export type CreateFixedAssetInput = {
  name: string
  category?: string | null
  acquisitionCost: number
  acquisitionDate: string
  usefulLifeMonths: number
  salvageValue?: number
}

export type CreatePrepaidInput = {
  name: string
  totalAmount: number
  startDate: string
  months: number
  monthlyAmount?: number
}

// ── Fixed assets ────────────────────────────────────────────────────────────

export async function listFixedAssets() {
  const res = await api.get<FixedAsset[]>('/api/fixed-assets')
  return { success: res.success, data: res.data ?? [], error: res.error, issues: res.issues }
}

export async function getFixedAsset(id: string) {
  return api.get<FixedAssetDetail>(`/api/fixed-assets/${id}`)
}

export async function createFixedAsset(input: CreateFixedAssetInput) {
  return api.post<FixedAsset>('/api/fixed-assets', input)
}

export async function generateSchedule(id: string) {
  return api.post<DepreciationSchedule[]>(`/api/fixed-assets/${id}/generate-schedule`, {})
}

export async function postDepreciation(id: string, scheduleId: string) {
  return api.post<{ posted: boolean; reason?: string; entryId?: string }>(
    `/api/fixed-assets/${id}/post-depreciation`,
    { scheduleId }
  )
}

// ── Prepaid assets ──────────────────────────────────────────────────────────

export async function listPrepaid() {
  const res = await api.get<PrepaidAsset[]>('/api/fixed-assets/prepaid')
  return { success: res.success, data: res.data ?? [], error: res.error, issues: res.issues }
}

export async function createPrepaid(input: CreatePrepaidInput) {
  return api.post<PrepaidAsset>('/api/fixed-assets/prepaid', input)
}

export async function amortizePrepaid(id: string, periodDate?: string) {
  return api.post<{ posted: boolean; reason?: string; entryId?: string }>(
    `/api/fixed-assets/prepaid/${id}/amortize`,
    periodDate ? { periodDate } : {}
  )
}
