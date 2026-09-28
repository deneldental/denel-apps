export type PayslipLine = {
  description: string
  payment?: number
  deduction?: number
  rate?: number
}

export interface PayrollRunPdfInput {
  clinicName: string
  logoUrl?: string | null
  runName: string
  payPeriodLabel: string
  generatedAt: Date
  generatedBy: string
  totals: {
    basicSalary: number
    allowances: number
    overtime: number
    grossPay: number
    paye: number
    ssnitTier1: number
    ssnitTier2: number
    netPay: number
    totalEmployerCost: number
  }
  staffRows: Array<{
    staffName: string
    staffCode: string | null
    basicSalary: number
    allowances: number
    overtime: number
    grossPay: number
    paye: number
    ssnitTier1: number
    ssnitTier2: number
    netPay: number
    totalEmployerCost: number
  }>
  payslips: any[]
}

function esc(value: string | null | undefined): string {
  if (value == null) return ''
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function money(n: number | null | undefined): string {
  if (n == null || n === 0) return '–'
  return n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

export function generatePayslipHtml(data: any, wrapInDocument = false): string {
  const isPaid = !!data.disbursedAt || data.status === 'paid'
  const isUnpaid = !isPaid && data.status && data.status !== 'draft' && data.status !== 'suspended'

  const watermarkHtml =
    isPaid || isUnpaid
      ? `
    <div class="watermark-status ${isPaid ? 'paid' : 'unpaid'}">
      ${isPaid ? 'PAID' : 'UNPAID'}
    </div>
  `
      : ''

  const logoWatermarkHtml =
    data.clinic.logoIconUrl || data.clinic.logoUrl
      ? `
    <div class="watermark-logo">
      <img src="${esc(data.clinic.logoIconUrl || data.clinic.logoUrl)}" alt=""/>
    </div>
  `
      : `
    <div class="watermark-text">${esc(data.clinic.name)}</div>
  `

  const logoHtml = data.clinic.logoUrl
    ? `
    <img src="${esc(data.clinic.logoUrl)}" class="logo" alt=""/>
  `
    : `
    <div class="clinic-name-header">${esc(data.clinic.name)}</div>
  `

  const linesHtml = data.lines
    .map(
      (l: any) => `
    <tr>
      <td>${esc(data.lineDateLabel)}</td>
      <td>${esc(l.description)}</td>
      <td class="num">${l.rate != null ? l.rate : '–'}</td>
      <td class="num">${money(l.payment)}</td>
      <td class="num">${money(l.deduction)}</td>
    </tr>
  `
    )
    .join('')

  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap');
    body { font-family: 'Inter', sans-serif; font-size: 11px; color: #0f172a; margin: 0; padding: 0; background: #fff; }
    * { box-sizing: border-box; }
    .payslip-container { position: relative; width: 100%; border: 1px solid #cbd5e1; padding: 2rem; background: #fff; margin-bottom: 2rem; overflow: hidden; }
    .watermark-status { position: absolute; right: 4rem; top: 6rem; z-index: 10; transform: rotate(-12deg); border: 6px solid; padding: 0.5rem 1.5rem; font-size: 3rem; font-weight: 900; letter-spacing: 0.1em; opacity: 0.3; }
    .watermark-status.paid { border-color: #059669; color: #059669; }
    .watermark-status.unpaid { border-color: #e11d48; color: #e11d48; }
    .watermark-logo, .watermark-text { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 0; opacity: 0.04; pointer-events: none; }
    .watermark-logo img { width: 60%; transform: rotate(-12deg); filter: grayscale(100%); }
    .watermark-text { font-size: 4rem; font-weight: 900; text-transform: uppercase; transform: translate(-50%, -50%) rotate(-24deg); white-space: nowrap; }
    .payslip-header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0f172a; padding-bottom: 1rem; margin-bottom: 1.5rem; position: relative; z-index: 1; }
    .logo-container .logo { height: 3rem; max-width: 220px; object-fit: contain; }
    .clinic-name-header { font-size: 18px; font-weight: 900; text-transform: uppercase; letter-spacing: -0.5px; }
    .payslip-title-block { text-align: right; }
    .payslip-title { font-size: 20px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.25em; }
    .payslip-period { font-size: 11px; font-weight: 600; color: #475569; }
    .info-blocks { display: flex; gap: 2rem; margin-bottom: 2rem; position: relative; z-index: 1; }
    .info-block { flex: 1; }
    .info-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #64748b; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-bottom: 6px; }
    .info-block table { width: 100%; border-collapse: collapse; }
    .info-block .lbl { width: 30%; font-size: 10px; text-transform: uppercase; color: #94a3b8; vertical-align: top; padding: 2px 8px 2px 0; }
    .info-block .val { font-size: 11px; font-weight: 600; color: #1e293b; padding: 2px 0; }
    .payslip-table { width: 100%; border-collapse: collapse; position: relative; z-index: 1; margin-bottom: 2rem; }
    .payslip-table th { background: #f8fafc; font-size: 10px; font-weight: 700; text-transform: uppercase; color: #64748b; padding: 8px; text-align: left; border-bottom: 1px solid #cbd5e1; }
    .payslip-table td { padding: 6px 8px; font-size: 11px; border-bottom: 1px solid #f1f5f9; color: #334155; }
    .payslip-table th.num, .payslip-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .payslip-table tfoot td { padding: 8px; font-weight: 700; font-size: 10px; color: #64748b; text-transform: uppercase; }
    .payslip-table .gross-row td { border-top: 1px solid #cbd5e1; }
    .payslip-table .deduct-row td { border-bottom: 2px solid #0f172a; }
    .payslip-table .net-row td { color: #0f172a; font-size: 12px; }
    .payslip-table tfoot td.val { color: #1e293b; }
    .payslip-table tfoot td.net-val { font-size: 16px; font-weight: 900; color: #0f172a; }
    .payslip-footer { display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; font-style: italic; }
  `

  const html = `
    <div class="payslip-container">
      ${watermarkHtml}
      ${logoWatermarkHtml}
      <div class="payslip-header">
        <div class="logo-container">${logoHtml}</div>
        <div class="payslip-title-block">
          <div class="payslip-title">Payslip</div>
          <div class="payslip-period">${esc(data.periodLabel)}</div>
        </div>
      </div>
      
      <div class="info-blocks">
        <div class="info-block">
          <div class="info-title">Employer</div>
          <table>
            <tr><td class="lbl">Name</td><td class="val">${esc(data.clinic.name)}</td></tr>
            <tr><td class="lbl">Address</td><td class="val">${esc(data.clinic.address || '–')}</td></tr>
            <tr><td class="lbl">Phone</td><td class="val">${esc(data.clinic.phone || '–')}</td></tr>
          </table>
        </div>
        <div class="info-block">
          <div class="info-title">Employee</div>
          <table>
            <tr><td class="lbl">Name</td><td class="val">${esc(data.staff.name)}</td></tr>
            <tr><td class="lbl">Code</td><td class="val">${esc(data.staff.staffCode || '–')}</td></tr>
            <tr><td class="lbl">TIN</td><td class="val">${esc(data.staff.tin || '–')}</td></tr>
            <tr><td class="lbl">Bank</td><td class="val">${esc(data.staff.bankName || '–')}</td></tr>
            <tr><td class="lbl">Account</td><td class="val">${esc(data.staff.bankAccount || '–')}</td></tr>
          </table>
        </div>
      </div>

      <table class="payslip-table">
        <thead>
          <tr>
            <th>Month/Year</th>
            <th>Description</th>
            <th class="num">Rate (%)</th>
            <th class="num">Payments</th>
            <th class="num">Deductions</th>
          </tr>
        </thead>
        <tbody>
          ${linesHtml}
        </tbody>
        <tfoot>
          <tr class="gross-row">
            <td colspan="3">GROSS TOTAL</td>
            <td class="num val">${money(data.grossTotal)}</td>
            <td></td>
          </tr>
          <tr class="deduct-row">
            <td colspan="4">NET DEDUCTIONS</td>
            <td class="num val">${money(data.netDeductions)}</td>
          </tr>
          <tr class="net-row">
            <td colspan="3">NET TOTAL</td>
            <td colspan="2" class="num net-val">${money(data.netTotal)}</td>
          </tr>
        </tfoot>
      </table>

      <div class="payslip-footer">
        <div>Generated ${esc(data.generatedLabel)}</div>
        ${data.employerSsnit ? `<div>SSNIT (Employer): ${money(data.employerSsnit)}</div>` : ''}
      </div>
    </div>
  `

  if (wrapInDocument) {
    return `<!DOCTYPE html><html><head><style>@page { size: A4 portrait; margin: 15mm; }\n${css}</style></head><body>${html}</body></html>`
  }

  return html
}

export function generatePayrollRunHtml(input: PayrollRunPdfInput): string {
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap');
    
    @page { size: A4 portrait; margin: 15mm; }
    body { font-family: 'Inter', sans-serif; font-size: 11px; color: #0f172a; margin: 0; padding: 0; background: #fff; }
    * { box-sizing: border-box; }
    
    .page-break { page-break-after: always; }
    
    .cover-page { height: 90vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
    .cover-logo { max-width: 300px; max-height: 120px; margin-bottom: 2rem; object-fit: contain; }
    .cover-title { font-size: 24px; font-weight: 900; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 1rem; }
    .cover-subtitle { font-size: 14px; color: #475569; }
    
    /* Payslip styles */
    .payslip-container { position: relative; width: 100%; border: 1px solid #cbd5e1; padding: 2rem; background: #fff; margin-bottom: 2rem; overflow: hidden; }
    .watermark-status { position: absolute; right: 4rem; top: 6rem; z-index: 10; transform: rotate(-12deg); border: 6px solid; padding: 0.5rem 1.5rem; font-size: 3rem; font-weight: 900; letter-spacing: 0.1em; opacity: 0.3; }
    .watermark-status.paid { border-color: #059669; color: #059669; }
    .watermark-status.unpaid { border-color: #e11d48; color: #e11d48; }
    .watermark-logo, .watermark-text { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 0; opacity: 0.04; pointer-events: none; }
    .watermark-logo img { width: 60%; transform: rotate(-12deg); filter: grayscale(100%); }
    .watermark-text { font-size: 4rem; font-weight: 900; text-transform: uppercase; transform: translate(-50%, -50%) rotate(-24deg); white-space: nowrap; }
    .payslip-header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0f172a; padding-bottom: 1rem; margin-bottom: 1.5rem; position: relative; z-index: 1; }
    .logo-container .logo { height: 3rem; max-width: 220px; object-fit: contain; }
    .clinic-name-header { font-size: 18px; font-weight: 900; text-transform: uppercase; letter-spacing: -0.5px; }
    .payslip-title-block { text-align: right; }
    .payslip-title { font-size: 20px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.25em; }
    .payslip-period { font-size: 11px; font-weight: 600; color: #475569; }
    .info-blocks { display: flex; gap: 2rem; margin-bottom: 2rem; position: relative; z-index: 1; }
    .info-block { flex: 1; }
    .info-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #64748b; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-bottom: 6px; }
    .info-block table { width: 100%; border-collapse: collapse; }
    .info-block .lbl { width: 30%; font-size: 10px; text-transform: uppercase; color: #94a3b8; vertical-align: top; padding: 2px 8px 2px 0; }
    .info-block .val { font-size: 11px; font-weight: 600; color: #1e293b; padding: 2px 0; }
    .payslip-table { width: 100%; border-collapse: collapse; position: relative; z-index: 1; margin-bottom: 2rem; }
    .payslip-table th { background: #f8fafc; font-size: 10px; font-weight: 700; text-transform: uppercase; color: #64748b; padding: 8px; text-align: left; border-bottom: 1px solid #cbd5e1; }
    .payslip-table td { padding: 6px 8px; font-size: 11px; border-bottom: 1px solid #f1f5f9; color: #334155; }
    .payslip-table th.num, .payslip-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
    .payslip-table tfoot td { padding: 8px; font-weight: 700; font-size: 10px; color: #64748b; text-transform: uppercase; }
    .payslip-table .gross-row td { border-top: 1px solid #cbd5e1; }
    .payslip-table .deduct-row td { border-bottom: 2px solid #0f172a; }
    .payslip-table .net-row td { color: #0f172a; font-size: 12px; }
    .payslip-table tfoot td.val { color: #1e293b; }
    .payslip-table tfoot td.net-val { font-size: 16px; font-weight: 900; color: #0f172a; }
    .payslip-footer { display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; font-style: italic; }
    
    /* Summary styles */
    .summary-title { font-size: 18px; font-weight: 900; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 1rem; border-bottom: 2px solid #0f172a; padding-bottom: 8px; }
    .summary-table { width: 100%; border-collapse: collapse; font-size: 10px; }
    .summary-table th { background: #f8fafc; font-weight: 700; text-transform: uppercase; color: #64748b; padding: 6px; text-align: left; border-bottom: 1px solid #cbd5e1; }
    .summary-table th.num { text-align: right; }
    .summary-table td { padding: 6px; border-bottom: 1px solid #f1f5f9; font-variant-numeric: tabular-nums; }
    .summary-table td.num { text-align: right; }
    .summary-table .name { font-weight: 600; color: #0f172a; }
    .summary-table .code { font-size: 9px; color: #64748b; display: block; }
    .summary-table tfoot td { font-weight: 700; padding: 8px 6px; border-top: 2px solid #0f172a; }
  `

  const coverHtml = `
    <div class="cover-page page-break">
      ${input.logoUrl ? `<img src="${esc(input.logoUrl)}" class="cover-logo" alt=""/>` : ''}
      <div class="cover-title">${esc(input.runName)}</div>
      <div class="cover-subtitle">${esc(input.payPeriodLabel)}</div>
      <div style="margin-top: 2rem; font-size: 10px; color: #64748b;">
        Generated ${esc(formatDateTime(input.generatedAt))} by ${esc(input.generatedBy)}
      </div>
    </div>
  `

  const slipsHtml = input.payslips
    .map(
      (ps) => `
    <div class="page-break">
      ${generatePayslipHtml(ps, false)}
    </div>
  `
    )
    .join('')

  const summaryRowsHtml = input.staffRows
    .map(
      (r) => `
    <tr>
      <td>
        <span class="name">${esc(r.staffName)}</span>
        ${r.staffCode ? `<span class="code">${esc(r.staffCode)}</span>` : ''}
      </td>
      <td class="num">${money(r.basicSalary)}</td>
      <td class="num">${money(r.allowances)}</td>
      <td class="num">${money(r.overtime)}</td>
      <td class="num" style="font-weight:600">${money(r.grossPay)}</td>
      <td class="num">${money(r.paye)}</td>
      <td class="num">${money(r.ssnitTier1)}</td>
      <td class="num">${money(r.ssnitTier2)}</td>
      <td class="num" style="font-weight:700; color:#0f172a;">${money(r.netPay)}</td>
      <td class="num">${money(r.totalEmployerCost)}</td>
    </tr>
  `
    )
    .join('')

  const summaryHtml = `
    <div>
      <div class="summary-title">Payroll Run Summary &middot; ${esc(input.runName)}</div>
      <table class="summary-table">
        <thead>
          <tr>
            <th>Staff Name</th>
            <th class="num">Basic</th>
            <th class="num">Allow.</th>
            <th class="num">Overtime</th>
            <th class="num">Gross</th>
            <th class="num">PAYE</th>
            <th class="num">Tier 1</th>
            <th class="num">Tier 2</th>
            <th class="num">Net</th>
            <th class="num">Emp. Cost</th>
          </tr>
        </thead>
        <tbody>
          ${summaryRowsHtml}
        </tbody>
        <tfoot>
          <tr>
            <td>TOTAL</td>
            <td class="num">${money(input.totals.basicSalary)}</td>
            <td class="num">${money(input.totals.allowances)}</td>
            <td class="num">${money(input.totals.overtime)}</td>
            <td class="num">${money(input.totals.grossPay)}</td>
            <td class="num">${money(input.totals.paye)}</td>
            <td class="num">${money(input.totals.ssnitTier1)}</td>
            <td class="num">${money(input.totals.ssnitTier2)}</td>
            <td class="num">${money(input.totals.netPay)}</td>
            <td class="num">${money(input.totals.totalEmployerCost)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `

  return `
    <!DOCTYPE html>
    <html>
      <head><style>${css}</style></head>
      <body>
        ${coverHtml}
        ${slipsHtml}
        ${summaryHtml}
      </body>
    </html>
  `
}
