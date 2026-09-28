import { api } from '@/lib/api-client'

export type Account = {
  id: string
  code: string
  name: string
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  subtype: string | null
  parentId: string | null
  isControl: boolean
  controlPartyType: 'patient' | 'supplier' | 'specialist' | 'insurance' | null
  normalBalance: 'debit' | 'credit'
  isActive: boolean
  description: string | null
  createdAt: string
  updatedAt: string
}

export type Period = {
  id: string
  name: string
  startDate: string
  endDate: string
  status: 'open' | 'closed'
  closedAt: string | null
  closedBy: string | null
}

export type JournalLine = {
  id: string
  entryId: string
  lineNumber: number
  accountId: string
  debit: number
  credit: number
  partyType: string | null
  partyId: string | null
  description: string | null
  account?: Account
}

export type JournalEntry = {
  id: string
  entryNumber: string
  entryDate: string
  postedAt: string
  periodId: string
  description: string | null
  sourceDocType: string
  sourceDocId: string | null
  isReversal: boolean
  reversesEntryId: string | null
  createdBy: string
  createdAt: string
  lines?: JournalLine[]
}

export type ReconciliationDrift = {
  accountCode: string
  accountName: string
  glBalance: string
  subledgerBalance: string
  drift: string
}

export type FinanceHealth = {
  ranAt: string
  drifts: ReconciliationDrift[]
  unbalancedEntries: string[]
  ok: boolean
}

// ── Accounts ─────────────────────────────────────────────────────────────────

export async function listAccounts(opts?: { type?: string }) {
  const qs = opts?.type ? `?type=${encodeURIComponent(opts.type)}` : ''
  const res = await api.get<Account[]>(`/api/accounts${qs}`)
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function getAccount(id: string) {
  const res = await api.get<Account>(`/api/accounts/${id}`)
  return res
}

export async function createAccount(input: {
  code: string
  name: string
  type: Account['type']
  subtype?: string | null
  parentId?: string | null
  isControl?: boolean
  controlPartyType?: Account['controlPartyType']
  normalBalance: Account['normalBalance']
  description?: string | null
}) {
  return api.post<Account>('/api/accounts', input)
}

export async function updateAccount(id: string, input: Partial<Account>) {
  return api.patch<Account>(`/api/accounts/${id}`, input)
}

// ── Periods ──────────────────────────────────────────────────────────────────

export async function listPeriods() {
  const res = await api.get<Period[]>('/api/periods')
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function getPeriod(id: string) {
  return api.get<Period & { entryCount: number }>(`/api/periods/${id}`)
}

export async function closePeriod(id: string) {
  return api.post<Period>(`/api/periods/${id}/close`, {})
}

export async function reopenPeriod(id: string) {
  return api.post<Period>(`/api/periods/${id}/reopen`, {})
}

// ── Journal Entries ──────────────────────────────────────────────────────────

export async function listJournalEntries(opts?: { from?: string; to?: string }) {
  const params = new URLSearchParams()
  if (opts?.from) params.set('from', opts.from)
  if (opts?.to) params.set('to', opts.to)
  const qs = params.toString() ? `?${params.toString()}` : ''
  const res = await api.get<JournalEntry[]>(`/api/journal-entries${qs}`)
  return { success: res.success, data: res.data ?? [], error: res.error }
}

export async function getJournalEntry(id: string) {
  return api.get<JournalEntry>(`/api/journal-entries/${id}`)
}

export async function postManualJournalEntry(input: {
  entryDate: string
  description?: string | null
  lines: Array<{
    accountId: string
    debit?: number | string
    credit?: number | string
    partyType?: 'patient' | 'supplier' | 'specialist' | 'insurance' | null
    partyId?: string | null
    description?: string | null
  }>
}) {
  return api.post<JournalEntry>('/api/journal-entries', input)
}

export async function reverseJournalEntry(id: string, reason?: string) {
  return api.post<JournalEntry>(`/api/journal-entries/${id}/reverse`, { reason })
}

// ── Finance Health ───────────────────────────────────────────────────────────

export async function getFinanceHealth() {
  return api.get<FinanceHealth>('/api/finance-health')
}
