import { api } from '@/lib/api-client'

export async function getManageableTables() {
  return api.get<string[]>('/api/database/tables')
}

export async function getTableTemplate(tableName: string) {
  return api.get<string>(`/api/database/template/${tableName}`)
}

export async function clearTable(tableName: string) {
  const res = await api.post<any>('/api/database/clear-table', { tableName })
  return res
}

export async function clearAllBusinessData() {
  const res = await api.post<any>('/api/database/clear-all', {})
  return res
}

export async function exportTableData(tableName: string) {
  return api.get<Record<string, unknown>[]>(`/api/database/export/${tableName}`)
}

export async function importTableData(tableName: string, csvContent: string) {
  // Parsing CSV client side for simplicity, then sending JSON to backend
  const lines = csvContent.split('\n').filter((line) => line.trim())
  if (lines.length < 2) return { success: false, error: 'Empty or invalid CSV' }

  const headers = lines[0].split(',').map((h) => h.trim())
  const records: any[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((v) => v.trim())
    if (values.length !== headers.length) continue
    const record: any = {}
    headers.forEach((h, idx) => {
      let val: any = values[idx]
      if (val === 'true') val = true
      else if (val === 'false') val = false
      else if (val === 'null' || val === '') val = null
      else if (!Number.isNaN(Number(val)) && h !== 'phone') val = Number(val)
      record[h] = val
    })
    records.push(record)
  }

  const res = await api.post<any>(`/api/database/import/${tableName}`, records)
  return res
}

/**
 * Convert an array of homogenous JSON objects into a CSV string. Header row
 * is the union of keys across all rows; missing values become empty strings.
 * Values containing commas, quotes, or newlines are double-quoted and have
 * embedded quotes escaped.
 */
export function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  const headers = Array.from(
    rows.reduce<Set<string>>((acc, row) => {
      for (const k of Object.keys(row)) acc.add(k)
      return acc
    }, new Set())
  )
  const escapeCsv = (val: unknown): string => {
    if (val === null || val === undefined) return ''
    const s = typeof val === 'object' ? JSON.stringify(val) : String(val)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsv((row as Record<string, unknown>)[h])).join(','))
  }
  return lines.join('\n')
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
