import { parse } from 'csv-parse/browser/esm/sync'
import type { LedgerPatient } from '@/lib/actions/ledger-adjustments'

// ── Legacy column → standard column mapping ──────────────────────────────────
const LEGACY_COLUMN_MAP: Record<string, string> = {
  'DATE CREATED': 'Date',
  'PATIENT NAME': 'PatientName',
  TREATMENTS: 'Description',
  'PAYMENT METHOD': 'Method',
  'AMOUNT PAID': 'Amount',
  TYPE: 'Type',
  BALANCE: '__drop__',
}

/** Monthly-data format: Date, Patient ID, Patient Name, Treatment, Charge, Discount, Paid, Balance */
function isMonthlyDataFormat(headers: string[]): boolean {
  const h = new Set(headers.map((h) => h.trim()))
  return h.has('Patient ID') && h.has('Paid') && h.has('Treatment')
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type PaymentCsvRow = {
  PatientName: string
  PatientPhone: string
  Type: string
  Amount: string
  Method: string
  Date: string
  Description: string
  Reason: string
}

export type RowResult = {
  rowNum: number
  patientName: string
  transformed: PaymentCsvRow | null
  errors: string[]
  patientFound: boolean
  patientId?: string
}

export type CsvTransformResult = {
  /** True when the uploaded CSV used the legacy column names and was remapped */
  wasTransformed: boolean
  /** Rows that passed all format checks and matched a patient */
  validRows: RowResult[]
  /** Rows with format/validation errors */
  invalidRows: RowResult[]
  /** Rows whose format is fine but the patient name was not found */
  missingPatientRows: RowResult[]
  /** Unique patient names that could not be matched */
  missingPatientNames: string[]
  /** Full corrected CSV (all parseable rows, correct columns) — for download */
  transformedCsv: string
  /** CSV with only the matched-patient rows — used for the actual upload */
  uploadCsv: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse DD.MM.YYYY or try native Date parsing; returns YYYY-MM-DD or null */
function normalizeDate(raw: string): string | null {
  const ddmmyyyy = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy
    const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
    return Number.isNaN(new Date(iso).getTime()) ? null : iso
  }
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]
}

/** Strip currency symbols/text (e.g. "GHC 350.00") and return a numeric string or null */
function normalizeAmount(raw: string): string | null {
  const cleaned = raw.replace(/[^0-9.]/g, '')
  const num = parseFloat(cleaned)
  if (Number.isNaN(num) || num <= 0) return null
  return String(num)
}

/** Accept "one-time payment", "one-time", "plan installment", "plan-installment" etc. */
function normalizeType(raw: string): string | null {
  const lower = raw.toLowerCase().trim()
  if (lower === 'one-time' || lower === 'one-time payment' || lower === 'one time payment')
    return 'one-time'
  if (lower === 'plan-installment' || lower === 'plan installment' || lower === 'installment')
    return 'plan-installment'
  return null
}

/** Escape a single CSV field — wraps in quotes if it contains a comma or quote */
function csvField(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function rowToCsvLine(r: PaymentCsvRow): string {
  return [
    csvField(r.PatientName),
    csvField(r.PatientPhone),
    csvField(r.Type),
    csvField(r.Amount),
    csvField(r.Method),
    csvField(r.Date),
    csvField(r.Description),
    csvField(r.Reason),
  ].join(',')
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function transformAndValidatePaymentCsv(
  file: File,
  patients: LedgerPatient[]
): Promise<CsvTransformResult> {
  const text = await file.text()
  let rawRows: Record<string, string>[]
  try {
    rawRows = parse(text, { columns: true, skip_empty_lines: true, trim: true })
  } catch {
    return {
      wasTransformed: false,
      validRows: [],
      invalidRows: [
        {
          rowNum: 1,
          patientName: '',
          transformed: null,
          errors: ['Could not parse CSV file — check that it is a valid CSV.'],
          patientFound: false,
        },
      ],
      missingPatientRows: [],
      missingPatientNames: [],
      transformedCsv: '',
      uploadCsv: '',
    }
  }

  if (rawRows.length === 0) {
    return {
      wasTransformed: false,
      validRows: [],
      invalidRows: [],
      missingPatientRows: [],
      missingPatientNames: [],
      transformedCsv: '',
      uploadCsv: '',
    }
  }

  // Detect format
  const headers = Object.keys(rawRows[0])
  const isMonthly = isMonthlyDataFormat(headers)
  const isLegacy =
    !isMonthly && headers.some((h) => LEGACY_COLUMN_MAP[h.toUpperCase().trim()] !== undefined)
  const wasTransformed = isLegacy || isMonthly

  const allResults: RowResult[] = []

  for (const [i, rawRow] of rawRows.entries()) {
    const rowNum = i + 2
    const errors: string[] = []

    // ── Column remapping ──────────────────────────────────────────────────
    let row: Record<string, string>

    if (isMonthly) {
      // Monthly-data format: skip rows where Paid <= 0
      const paidRaw = (rawRow.Paid || '').trim()
      const paidNum = parseFloat(paidRaw.replace(/[^0-9.]/g, ''))
      if (Number.isNaN(paidNum) || paidNum <= 0) continue // skip balance-only rows silently

      row = {
        PatientName: (rawRow['Patient Name'] || '').replace(/\s+/g, ' ').trim(),
        PatientPhone: '',
        Type: 'one-time',
        Amount: String(paidNum),
        Method: 'cash',
        Date: (rawRow.Date || '').trim(),
        Description: (rawRow.Treatment || '').trim(),
        Reason: '',
      }
    } else if (isLegacy) {
      row = {}
      for (const [key, value] of Object.entries(rawRow)) {
        const mapped = LEGACY_COLUMN_MAP[key.toUpperCase().trim()]
        if (mapped === '__drop__') continue
        if (mapped) {
          row[mapped] = value
        } else {
          row[key] = value
        }
      }
    } else {
      row = { ...rawRow }
    }

    // ── Normalize fields ──────────────────────────────────────────────────

    // Patient name — collapse multiple spaces
    const patientName = (row.PatientName || '').replace(/\s+/g, ' ').trim()

    // Amount
    const rawAmount = (row.Amount || '').trim()
    const normalizedAmount = isMonthly ? rawAmount : rawAmount ? normalizeAmount(rawAmount) : null
    if (!rawAmount) {
      errors.push('Missing Amount')
    } else if (!isMonthly && !normalizedAmount) {
      errors.push(`Invalid amount "${rawAmount}"`)
    }

    // Date
    const rawDate = (row.Date || '').trim()
    const normalizedDate = rawDate ? normalizeDate(rawDate) : null
    if (!rawDate) {
      errors.push('Missing Date')
    } else if (!normalizedDate) {
      errors.push(`Invalid date "${rawDate}" — expected YYYY-MM-DD or DD.MM.YYYY`)
    } else if (new Date(normalizedDate) > new Date()) {
      errors.push(`Date "${normalizedDate}" is in the future`)
    }

    // Type
    const rawType = (row.Type || '').trim()
    const normalizedType = isMonthly ? 'one-time' : rawType ? normalizeType(rawType) : null
    if (!isMonthly) {
      if (!rawType) {
        errors.push('Missing Type')
      } else if (!normalizedType) {
        errors.push(`Invalid type "${rawType}" — must be "one-time" or "plan-installment"`)
      }
    }

    // Method
    const method = isMonthly ? 'cash' : (row.Method || '').trim()
    if (!isMonthly && !method) errors.push('Missing Method')

    // PatientName
    if (!patientName) errors.push('Missing PatientName')

    // ── Build transformed row ─────────────────────────────────────────────
    const transformed: PaymentCsvRow = {
      PatientName: patientName,
      PatientPhone: (row.PatientPhone || '').trim(),
      Type: normalizedType ?? rawType,
      Amount: normalizedAmount ?? rawAmount,
      Method: method,
      Date: normalizedDate ?? rawDate,
      Description: (row.Description || '').trim(),
      Reason: (row.Reason || '').trim(),
    }

    // ── Patient lookup ────────────────────────────────────────────────────
    let patientFound = false
    let patientId: string | undefined

    if (errors.length === 0 && patientName) {
      const phone = transformed.PatientPhone
      if (phone) {
        const byPhone = patients.find((p) => p.phone === phone)
        if (byPhone) {
          patientFound = true
          patientId = byPhone.id
        }
      }
      if (!patientFound) {
        const byName = patients.filter((p) => p.name.toLowerCase() === patientName.toLowerCase())
        if (byName.length === 1) {
          patientFound = true
          patientId = byName[0].id
        } else if (byName.length > 1) {
          // For historical imports: pick the first (oldest) match and note the ambiguity
          patientFound = true
          patientId = byName[0].id
          transformed.Reason = transformed.Reason
            ? transformed.Reason
            : `auto-matched (${byName.length} patients share this name)`
        }
      }
    }

    allResults.push({
      rowNum,
      patientName,
      transformed: errors.length === 0 ? transformed : null,
      errors,
      patientFound,
      patientId,
    })
  }

  const validRows = allResults.filter((r) => r.errors.length === 0 && r.patientFound)
  const invalidRows = allResults.filter((r) => r.errors.length > 0)
  const missingPatientRows = allResults.filter((r) => r.errors.length === 0 && !r.patientFound)
  const missingPatientNames = [...new Set(missingPatientRows.map((r) => r.patientName))]

  const CSV_HEADER = 'PatientName,PatientPhone,Type,Amount,Method,Date,Description,Reason'

  // All parseable rows (valid + missing) — corrected format — for download
  const allParseable = [...validRows, ...missingPatientRows].sort((a, b) => a.rowNum - b.rowNum)
  const transformedCsv = [
    CSV_HEADER,
    ...allParseable.map((r) => rowToCsvLine(r.transformed!)),
  ].join('\n')

  // Only matched rows — used for actual upload
  const uploadCsv = [CSV_HEADER, ...validRows.map((r) => rowToCsvLine(r.transformed!))].join('\n')

  return {
    wasTransformed,
    validRows,
    invalidRows,
    missingPatientRows,
    missingPatientNames,
    transformedCsv,
    uploadCsv,
  }
}
