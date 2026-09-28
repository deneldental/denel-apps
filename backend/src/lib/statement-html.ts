/**
 * statement-html.ts — build the HTML for a patient statement of account.
 *
 * Rendered to PDF by `pdf-render.ts` (Puppeteer). Everything is inlined (no
 * external CSS/fonts/images) so the headless browser needs no network. Replaces
 * the hand-drawn pdf-lib layout in `statement-pdf.ts` — HTML/CSS is far easier
 * to evolve, paginates itself, and matches the on-screen look.
 */

export interface StatementEntry {
  at: string // ISO timestamp
  type: string // Patient-facing label, e.g. 'Payment received', 'Invoice / Charge'
  description: string
  amount: number // signed (internal) — negative = payment, positive = charge
  balanceAfter: number
  /**
   * Patient-facing money direction, independent of the internal `amount` sign:
   *   'credit' → money in the patient's favour (payment, wallet) → +Amount, green
   *   'debit'  → a charge the patient owes (invoice)             → −Amount, red
   */
  direction: 'credit' | 'debit'
}

export interface StatementPdfInput {
  clinicName: string
  clinicPhone: string | null
  clinicAddress: string | null
  patientName: string
  patientIdDisplay: string | null // e.g. '#FDM000001'
  fromDate: Date
  toDate: Date
  entries: StatementEntry[]
  /**
   * Authoritative balance owed *now* — Σ remaining balance of outstanding
   * invoices (same as the ledger/profile). NOT derived from the row running
   * total, which can't reconcile once per-invoice overpayments / wallet
   * round-trips are involved. Positive = owed; 0 = settled.
   */
  amountDue: number
  generatedAt: Date
  generatedByName: string
}

/** Escape untrusted text before interpolating into HTML. */
function esc(value: string | null | undefined): string {
  if (value == null) return ''
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Integer CENTS in — statement amounts are money columns. */
function formatGhs(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents) / 100
  const [whole, frac = '00'] = abs.toFixed(2).split('.')
  const withCommas = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${sign}GHS ${withCommas}.${frac}`
}

function formatDate(d: Date): string {
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function formatDateTime(d: Date): string {
  return `${formatDate(d)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(
    d.getUTCMinutes()
  ).padStart(2, '0')} UTC`
}

export function renderStatementHtml(input: StatementPdfInput): string {
  const {
    clinicName,
    clinicPhone,
    clinicAddress,
    patientName,
    patientIdDisplay,
    fromDate,
    toDate,
    entries,
    amountDue,
    generatedAt,
    generatedByName,
  } = input

  // Money magnitude only — sign & colour come from each row's `direction`.
  const money = (n: number): string => formatGhs(Math.abs(n))
  // A signed, coloured amount for a single line.
  const signed = (e: StatementEntry): string => {
    const cls = e.direction === 'credit' ? 'credit' : 'debit'
    const sign = e.direction === 'credit' ? '+' : '&minus;'
    return `<span class="amt ${cls}">${sign}${esc(money(e.amount))}</span>`
  }

  const totalCharges = entries
    .filter((e) => e.direction === 'debit')
    .reduce((s, e) => s + Math.abs(e.amount), 0)
  const totalPayments = entries
    .filter((e) => e.direction === 'credit')
    .reduce((s, e) => s + Math.abs(e.amount), 0)
  // Authoritative — passed in from the invoice balances, not derived from rows.
  const owes = amountDue > 0.005
  const dueLabel = owes ? 'Amount due' : 'No balance due'
  const dueValue = owes ? money(amountDue) : 'GHS 0.00'

  const rows =
    entries.length === 0
      ? `<tr><td colspan="3" class="empty">No account activity during this period.</td></tr>`
      : entries
          .map(
            (e: StatementEntry) => `<tr>
              <td class="nowrap">${esc(formatDate(new Date(e.at)))}</td>
              <td>
                <div class="row-type">${esc(e.type)}</div>
                <div class="row-desc">${esc(e.description)}</div>
              </td>
              <td class="amt">${signed(e)}</td>
            </tr>`
          )
          .join('')

  const clinicMeta = [clinicAddress, clinicPhone].filter(Boolean).map(esc).join(' &middot; ')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1f2937; font-size: 12px; margin: 0; -webkit-print-color-adjust: exact;
  }
  .header { display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; }
  .clinic-name { font-size: 18px; font-weight: 700; color: #0f172a; }
  .clinic-meta { font-size: 10px; color: #6b7280; margin-top: 3px; }
  .doc-title { text-align: right; }
  .doc-title h1 { font-size: 15px; margin: 0; color: #0f172a; letter-spacing: .04em; text-transform: uppercase; }
  .doc-title .period { font-size: 10px; color: #6b7280; margin-top: 4px; }
  .meta-grid { display: flex; gap: 40px; margin-bottom: 14px; }
  .meta-block .label { font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: #9ca3af; }
  .meta-block .value { font-size: 12px; font-weight: 600; color: #111827; margin-top: 2px; }
  /* Amount-due callout */
  .due { display: flex; justify-content: space-between; align-items: center;
    border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; margin-bottom: 8px;
    background: ${owes ? '#fef2f2' : '#ecfdf5'}; }
  .due .label { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; }
  .due .value { font-size: 20px; font-weight: 700;
    color: ${owes ? '#dc2626' : '#059669'}; font-variant-numeric: tabular-nums; }
  /* Legend */
  .legend { font-size: 9.5px; color: #6b7280; margin: 0 0 14px; }
  .legend b.credit { color: #059669; }
  .legend b.debit { color: #dc2626; }
  table { width: 100%; border-collapse: collapse; }
  thead th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .05em;
    color: #6b7280; border-bottom: 1px solid #e5e7eb; padding: 6px 8px; }
  tbody td { padding: 7px 8px; border-bottom: 1px solid #f1f5f9; font-size: 11px; vertical-align: top; }
  th.amt, th.bal, td.amt, td.bal { text-align: right; white-space: nowrap; }
  td.bal { font-variant-numeric: tabular-nums; font-weight: 600; color: #0f172a; }
  td.nowrap { white-space: nowrap; }
  .row-type { font-weight: 600; color: #111827; }
  .row-desc { font-size: 10px; color: #6b7280; margin-top: 1px; }
  .amt { font-variant-numeric: tabular-nums; font-weight: 600; }
  .amt.credit { color: #059669; }
  .amt.debit { color: #dc2626; }
  td.empty { text-align: center; color: #9ca3af; padding: 24px; }
  .totals { margin-top: 16px; margin-left: auto; width: 280px; }
  .totals .row { display: flex; justify-content: space-between; padding: 5px 8px; font-size: 11px; }
  .totals .row .num { font-variant-numeric: tabular-nums; }
  .totals .row.charges .num { color: #dc2626; }
  .totals .row.payments .num { color: #059669; }
  .totals .row.grand { border-top: 2px solid #0f172a; margin-top: 4px; font-weight: 700; font-size: 13px; color: #0f172a; }
  .footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #e5e7eb;
    font-size: 9px; color: #9ca3af; display: flex; justify-content: space-between; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="clinic-name">${esc(clinicName)}</div>
      ${clinicMeta ? `<div class="clinic-meta">${clinicMeta}</div>` : ''}
    </div>
    <div class="doc-title">
      <h1>Account Statement</h1>
      <div class="period">${esc(formatDate(fromDate))} &ndash; ${esc(formatDate(toDate))}</div>
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-block">
      <div class="label">Patient</div>
      <div class="value">${esc(patientName)}</div>
      ${patientIdDisplay ? `<div class="clinic-meta">${esc(patientIdDisplay)}</div>` : ''}
    </div>
    <div class="meta-block">
      <div class="label">Statement Period</div>
      <div class="value">${esc(formatDate(fromDate))} &ndash; ${esc(formatDate(toDate))}</div>
    </div>
  </div>

  <div class="due">
    <span class="label">${esc(dueLabel)}</span>
    <span class="value">${esc(dueValue)}</span>
  </div>
  <p class="legend">
    <b class="credit">Payments &amp; credits (+)</b> are money in your favour &middot;
    <b class="debit">Charges (&minus;)</b> are amounts billed to you.
  </p>

  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Description</th>
        <th class="amt">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <div class="totals">
    <div class="row payments"><span>Total payments &amp; credits (this period)</span><span class="num">+${esc(money(totalPayments))}</span></div>
    <div class="row charges"><span>Total charges (this period)</span><span class="num">&minus;${esc(money(totalCharges))}</span></div>
    <div class="row grand"><span>Amount due now</span><span class="num">${esc(dueValue)}</span></div>
  </div>

  <div class="footer">
    <span>Generated ${esc(formatDateTime(generatedAt))} by ${esc(generatedByName)}</span>
    <span>${esc(clinicName)}</span>
  </div>
</body>
</html>`
}
