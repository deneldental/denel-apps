/**
 * PayslipDocument — the printable payslip layout.
 *
 * A clean, monochrome, fully-tabulated payslip: Employer / Employee info blocks
 * above a single ledger-style table (Month/Year · Description · Rate · Payments ·
 * Deductions) that closes with GROSS TOTAL / NET DEDUCTIONS / NET TOTAL rows.
 * One component drives both the live create-time preview and the printed/PDF
 * output, so what HR builds is exactly what staff receive.
 */

export interface PayslipLine {
  /** e.g. "Monthly Salary", "PAYE", "SSNIT (Employee)". */
  description: string
  /** Percentage rate, when the line is rate-based (SSNIT, PAYE bands). */
  rate?: number | null
  /** Earning amount (goes in the Payments column). */
  payment?: number | null
  /** Deduction amount (goes in the Deductions column). */
  deduction?: number | null
}

export interface PayslipDocData {
  clinic: {
    name: string
    /** Header/letterhead logo (wide horizontal preferred). */
    logoUrl: string | null
    /** Square/icon logo for the centred watermark; falls back to `logoUrl`. */
    logoIconUrl?: string | null
    address: string | null
    phone: string | null
    email: string | null
    website?: string | null
  }
  staff: {
    name: string
    staffCode?: string | null
    position?: string | null
    department?: string | null
    ssnitId?: string | null
    tin?: string | null
    bankName?: string | null
    bankAccount?: string | null
  }
  /** Long period label, e.g. "March 2026". */
  periodLabel: string
  /** Per-row date shown in the Month/Year column, e.g. "31 Mar 26". */
  lineDateLabel: string
  generatedLabel: string
  status?: string | null
  disbursedAt?: string | null
  isUnpaid?: boolean
  lines: PayslipLine[]
  grossTotal: number
  netDeductions: number
  netTotal: number
  employerSsnit?: number
}

/** Money → "12,000.00"; null/0 → an en-dash so empty cells read cleanly. */
function money(n: number | null | undefined): string {
  if (n == null || n === 0) return '–'
  return n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function rateCell(r: number | null | undefined): string {
  if (r == null) return '–'
  return `${r}`
}

function InfoBlock({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <div>
      <p className="mb-1.5 border-b border-slate-300 pb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
        {title}
      </p>
      <table className="w-full">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <td className="py-[2px] pr-2 align-top text-[10px] uppercase tracking-wide text-slate-400">
                {label}
              </td>
              <td className="py-[2px] text-[11px] font-semibold text-slate-800">{value || '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PayslipDocument({ data }: { data: PayslipDocData }) {
  const grossFromLines = data.lines.reduce((s, l) => s + (l.payment ?? 0), 0)
  const watermarkLogo = data.clinic.logoIconUrl ?? data.clinic.logoUrl

  const isPaid = !!data.disbursedAt || data.status === 'paid'
  const isUnpaid = !isPaid && data.status && data.status !== 'draft' && data.status !== 'suspended'

  return (
    <div className="relative mx-auto w-full max-w-[760px] overflow-hidden border border-slate-300 bg-white px-8 py-8 text-slate-900 shadow-sm">
      {/* Status Watermark */}
      {(isPaid || isUnpaid) && (
        <div
          aria-hidden
          className={`pointer-events-none absolute right-16 top-24 z-10 -rotate-12 border-[6px] px-6 py-2 text-6xl font-black uppercase tracking-widest opacity-30 ${
            isPaid ? 'border-emerald-600 text-emerald-600' : 'border-rose-600 text-rose-600'
          }`}
        >
          {isPaid ? 'PAID' : 'UNPAID'}
        </div>
      )}

      {/* Watermark — greyscale, no colour */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        {watermarkLogo ? (
          <img src={watermarkLogo} alt="" className="w-[60%] -rotate-12 opacity-[0.04] grayscale" />
        ) : (
          <span
            className="whitespace-nowrap text-6xl font-black uppercase tracking-tight text-slate-900 opacity-[0.04]"
            style={{ transform: 'rotate(-24deg)' }}
          >
            {data.clinic.name}
          </span>
        )}
      </div>

      <div className="relative">
        {/* ── Title ──────────────────────────────────────────────────────── */}
        <div className="flex items-end justify-between border-b-2 border-slate-900 pb-3">
          <div className="flex items-center gap-3">
            {data.clinic.logoUrl ? (
              <img
                src={data.clinic.logoUrl}
                alt={data.clinic.name}
                className="h-12 w-auto max-w-[220px] object-contain"
              />
            ) : (
              <p className="text-lg font-black uppercase tracking-tight text-slate-900">
                {data.clinic.name}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xl font-black uppercase tracking-[0.25em] text-slate-900">Payslip</p>
            <p className="text-[11px] font-semibold text-slate-600">{data.periodLabel}</p>
          </div>
        </div>

        {/* ── Employer / Employee info ───────────────────────────────────── */}
        <div className="mt-4 grid grid-cols-2 gap-8">
          <InfoBlock
            title="Employer Info"
            rows={[
              ['Name', data.clinic.name],
              ['Address', data.clinic.address ?? '–'],
              ['Contact', [data.clinic.phone, data.clinic.email].filter(Boolean).join('  ·  ')],
            ]}
          />
          <InfoBlock
            title="Employee Info"
            rows={[
              ['Name', data.staff.name],
              ['Staff ID', data.staff.staffCode ?? '–'],
              ['Position', data.staff.position ?? '–'],
              ['SSNIT No.', data.staff.ssnitId ?? '–'],
              ['TIN', data.staff.tin ?? '–'],
            ]}
          />
        </div>

        {/* ── Ledger table ───────────────────────────────────────────────── */}
        <table className="mt-5 w-full border-collapse text-[11px]">
          <thead>
            <tr className="border-y border-slate-900 text-slate-900">
              <th className="py-1.5 pr-2 text-left font-bold uppercase tracking-wide">
                Month/Year
              </th>
              <th className="py-1.5 px-2 text-left font-bold uppercase tracking-wide">
                Description
              </th>
              <th className="py-1.5 px-2 text-right font-bold uppercase tracking-wide">Rate [%]</th>
              <th className="py-1.5 px-2 text-right font-bold uppercase tracking-wide">Payments</th>
              <th className="py-1.5 pl-2 text-right font-bold uppercase tracking-wide">
                Deductions
              </th>
            </tr>
          </thead>
          <tbody>
            {data.lines.length > 0 ? (
              data.lines.map((l, i) => (
                <tr
                  // biome-ignore lint/suspicious/noArrayIndexKey: static, ordered ledger rows for a single render
                  key={`${l.description}-${i}`}
                  className="border-b border-slate-100"
                >
                  <td className="py-1.5 pr-2 whitespace-nowrap text-slate-500">
                    {data.lineDateLabel}
                  </td>
                  <td className="py-1.5 px-2 text-slate-800">{l.description}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-slate-600">
                    {rateCell(l.rate)}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-slate-800">
                    {money(l.payment)}
                  </td>
                  <td className="py-1.5 pl-2 text-right tabular-nums text-slate-800">
                    {money(l.deduction)}
                  </td>
                </tr>
              ))
            ) : (
              <tr className="border-b border-slate-100">
                <td colSpan={5} className="py-4 text-center italic text-slate-400">
                  No line items yet — enter the breakdown on the left.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="text-slate-900">
            <tr className="border-t-2 border-slate-900">
              <td colSpan={3} className="py-1.5 pr-2 text-right font-bold uppercase tracking-wide">
                Gross Total
              </td>
              <td className="py-1.5 px-2 text-right font-bold tabular-nums">
                {money(data.grossTotal || grossFromLines)}
              </td>
              <td className="py-1.5 pl-2" />
            </tr>
            <tr>
              <td colSpan={4} className="py-1.5 pr-2 text-right font-bold uppercase tracking-wide">
                Net Deductions
              </td>
              <td className="py-1.5 pl-2 text-right font-bold tabular-nums">
                {money(data.netDeductions)}
              </td>
            </tr>
            <tr className="border-y-2 border-slate-900">
              <td
                colSpan={3}
                className="py-2 pr-2 text-right text-[12px] font-black uppercase tracking-wide"
              >
                Net Total
              </td>
              <td colSpan={2} className="py-2 pl-2 text-right text-[13px] font-black tabular-nums">
                GHS {money(data.netTotal)}
              </td>
            </tr>
          </tfoot>
        </table>

        <p className="mt-1.5 text-[9px] text-slate-400">All amounts in Ghana Cedis (GHS).</p>

        {data.employerSsnit != null &&
          data.employerSsnit > 0 &&
          (() => {
            // Employee SSNIT is 5.5%, Employer is 13%. Total = 18.5%.
            // Tier 1 = 13.5%, Tier 2 = 5%.
            const employeeSsnitLine = data.lines.find((l) =>
              l.description.includes('SSNIT (Employee)')
            )
            const employeeSsnit = employeeSsnitLine?.deduction ?? 0
            const totalSsnit = employeeSsnit + data.employerSsnit
            const tier1 = totalSsnit * (13.5 / 18.5)
            const tier2 = totalSsnit * (5.0 / 18.5)

            return (
              <div className="mt-3 border-t border-slate-200 pt-2 text-[10px] text-slate-500">
                <p className="font-semibold text-slate-700 mb-0.5">
                  Statutory Pension Remittance (Total: GHS {money(totalSsnit)})
                </p>
                <p>
                  <span className="inline-block w-[140px]">Employer Contribution (13%):</span> GHS{' '}
                  {money(data.employerSsnit)}{' '}
                  <span className="italic text-slate-400">(Not deducted from salary)</span>
                </p>
                <p>
                  <span className="inline-block w-[140px]">Tier 1 (13.5%):</span> GHS {money(tier1)}{' '}
                  <span className="italic text-slate-400">(Paid to SSNIT)</span>
                </p>
                <p>
                  <span className="inline-block w-[140px]">Tier 2 (5%):</span> GHS {money(tier2)}{' '}
                  <span className="italic text-slate-400">(Paid to Private Pension Scheme)</span>
                </p>
              </div>
            )
          })()}

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <p className="mt-8 border-t border-dashed border-slate-300 pt-2 text-center text-[9px] text-slate-400">
          This is a computer-generated payslip and does not require a signature to be valid ·
          Generated {data.generatedLabel} · {data.clinic.name}
        </p>
      </div>
    </div>
  )
}
