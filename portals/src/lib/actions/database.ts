import { api } from '@/lib/api-client'

export async function getManageableTables() {
  return api.get<string[]>('/api/database/tables')
}

/** The tables a CSV may be loaded into: the lookup tables only. */
export async function getImportableTables() {
  return api.get<string[]>('/api/database/importable-tables')
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

export interface ImportSkippedRow {
  /** The line of the file, counting the header as row 1. */
  row: number
  reason: string
}

export interface ImportResult {
  success: boolean
  /** Rows added. */
  count?: number
  /** Rows that were already in the table and were left as they are. */
  existing?: number
  /** The rows that were left out, with the reason (the server sends the first 200). */
  skipped?: ImportSkippedRow[]
  skippedTotal?: number
  error?: string
}

/**
 * Load a CSV into a lookup table. The text goes to the server exactly as it was read: the server
 * parses it (quoting and line breaks included), checks every row against the table and answers with
 * the rows it left out. This used to split lines on every comma here, so a quoted value such as
 * "Crown, porcelain" lost its row, and a row with the wrong number of cells vanished without a word.
 */
export async function importTableData(
  tableName: string,
  csvContent: string
): Promise<ImportResult> {
  const res = await api.post<unknown>(`/api/database/import/${tableName}`, { csv: csvContent })
  return res as unknown as ImportResult
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
