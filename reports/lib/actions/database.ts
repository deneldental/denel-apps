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
