/**
 * Lightweight CSV download helper for analytics tabs. No dependencies — a thin
 * wrapper over Blob + URL.createObjectURL so every report can offer a one-click
 * "Export CSV" without each tab re-implementing escaping and download.
 *
 * Usage:
 *   downloadCsv('top-patients-2026.csv', ['Patient', 'Revenue'], rows.map(r => [r.name, r.revenue]))
 */

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  // Quote whenever the value contains a comma, quote, newline, or carriage return.
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function toCsv(headers: string[], rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  const lines = [headers.map(escapeCell).join(',')]
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(','))
  }
  return lines.join('\n')
}

/**
 * Build a CSV from headers + rows and trigger a browser download.
 *
 * @param filename — suggested filename including .csv extension
 * @param headers  — column titles, in display order
 * @param rows     — 2D array; each row should have the same arity as `headers`
 */
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: ReadonlyArray<ReadonlyArray<unknown>>
): void {
  const csv = toCsv(headers, rows)
  // BOM prefix helps Excel auto-detect UTF-8 (so accented patient names render).
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Convenience: a YYYY-MM-DD suffix for filenames. */
export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10)
}
