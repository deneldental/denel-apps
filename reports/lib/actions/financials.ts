import { api } from '@/lib/api-client'

export interface Transaction {
  id: string
  date: string
  amount: number
  type: 'income' | 'expense'
  description: string
  patientId?: string
  paymentMethod?: string
  reference?: string
  category?: string
  createdAt: string
}

export interface Pagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface PaginatedTransactions {
  transactions: Transaction[]
  pagination: Pagination
}

export interface FinancialRecordItem {
  date: string
  label: string
  income: number
  expenses: number
  balance: number
  transactions?: Transaction[]
}

export interface FinancialSummary {
  totalIncome: number
  totalExpenses: number
  netProfit: number
  netBalance: number
  transactionCount: number
}

export interface FinancialRecordResponse extends FinancialSummary {
  records: FinancialRecordItem[]
  pagination: Pagination
}

export async function getFinancialRecords(
  view: 'week' | 'month' | 'year',
  dateStr: string,
  page: number = 1,
  pageSize: number = 10
): Promise<FinancialRecordResponse | undefined> {
  const res = await api.get<FinancialRecordResponse>(
    `/api/financials/records?view=${view}&date=${dateStr}&page=${page}&pageSize=${pageSize}`
  )
  return res.data
}

export async function getDailyTransactions(
  dateStr: string,
  page: number = 1,
  pageSize: number = 20
): Promise<PaginatedTransactions | undefined> {
  const res = await api.get<PaginatedTransactions>(
    `/api/financials/daily?date=${dateStr}&page=${page}&pageSize=${pageSize}`
  )
  return res.data
}

export async function importFinancialRecords(formData: FormData) {
  const res = await api.post<any>('/api/financials/import', formData)
  return res
}

export async function importLegacyData() {
  // This requires local file system access ('monthly_data' folder)
  // Since we are moving to Hono/Workers, we can't easily do this via API.
  // If needed, this should be run as a separate migration script on a server with access to the CSVs.
  return {
    success: false,
    message: 'Legacy import not supported via backend API. Use migration scripts.',
  }
}
