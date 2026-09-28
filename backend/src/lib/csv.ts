/**
 * csv.ts — tiny shared CSV parse/generate helpers.
 *
 * Parsing uses csv-parse (already a dependency; the browser/esm/sync entry is
 * the one the bundler is happy with — see financials.ts / ledger-adjustments.ts).
 * Generation is hand-rolled (RFC-4180 quoting) so we don't pull in csv-stringify.
 */
import { parse } from 'csv-parse/browser/esm/sync'

/**
 * Parse CSV text into row objects keyed by (trimmed) header. Tolerates a BOM,
 * quoted fields containing commas/newlines, blank lines, and a trailing newline.
 * Throws on malformed CSV (e.g. an unterminated quote).
 */
export function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^﻿/, '') // strip UTF-8 BOM Excel loves to add
  return parse(clean, {
    columns: (header: string[]) => header.map((h) => h.trim()),
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[]
}

/** Quote one CSV field iff it contains a comma, quote, or newline. */
function csvField(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Build CSV text (CRLF line endings, BOM-free) from an ordered header list. */
export function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [headers.map(csvField).join(',')]
  for (const row of rows) lines.push(headers.map((h) => csvField(row[h])).join(','))
  return `${lines.join('\r\n')}\r\n`
}

/** Parse a possibly-messy money/number cell → number, or null if blank/invalid. */
export function parseNum(v: unknown): number | null {
  if (v == null) return null
  const s = String(v)
    .replace(/[^0-9.-]/g, '')
    .trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Truthy CSV cell → boolean. 'true'/'1'/'yes'/'y'/'active' ⇒ true. */
export function parseBool(v: unknown, dflt = true): boolean {
  if (v == null || String(v).trim() === '') return dflt
  return /^(true|1|yes|y|active)$/i.test(String(v).trim())
}
