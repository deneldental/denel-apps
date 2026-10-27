import { format } from 'date-fns'
import { type BrandingConfig, getBranding } from '@/lib/actions/branding'
import { parseLocalDate } from '@/shared/lib/dates'
import { formatAmount } from '@/shared/utils/currency'
import {
  escapeHtml,
  hasInvoiceTotals,
  methodStatusSuffix,
  reversalBanner,
} from '@/shared/utils/receipt-display'

interface ReceiptData {
  patientName: string
  appointmentDate?: string
  amountPaid: number
  totalAmount?: number
  balance?: number
  paymentType: string
  paymentFor: string
  notes?: string | null
  clinicName: string
  clinicPhone?: string | null
  clinicAddress?: string | null
  clinicWebsite?: string | null
  generatedAt: string
  methods?: Array<{
    method: string
    amount: number
    reference?: string | null
    paymentNumber?: string | null
    /** 'reversed' once this method's payment has been reversed. */
    status?: string
  }>
  /** 'reversed' | 'partly_reversed' | 'posted'; `amountPaid` counts only payments still in force. */
  status?: 'posted' | 'reversed' | 'partly_reversed'
  reversedAmount?: number
  allocations?: {
    invoiceNumber: string
    invoiceTotal: number | null
    invoiceSubtotal?: number | null
    invoiceTaxTotal?: number | null
    amountApplied: number
    remainingBalance: number | null
    status: string | null
    treatments?: string[]
    items?: { name: string; cost: number }[]
  }[]
}

const MAX_SERVICE_LEN = 22 // Length of "scaling and  polishing"

function truncateService(service: string, maxLength: number = 22): string {
  if (!service) return ''
  if (service.length <= maxLength) return service
  return `${service.slice(0, maxLength).trimEnd()}...`
}

function formatReceiptDate(dateStr?: string | null): string {
  if (!dateStr) {
    return format(new Date(), 'dd MMM yyyy, hh:mm a')
  }
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return format(d, 'dd MMM yyyy, hh:mm a')
}

function methodLabel(m: string) {
  if (!m) return ''
  return m
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bMomo\b/, 'Mobile Money')
}

/**
 * Clinic details for the receipt header, from the branding config an admin
 * edits in Integrations → Branding.
 *
 * These used to come from `VITE_CLINIC_*` build-time env vars. Those vars were
 * never given values — not in the repo, not in Doppler — so `clinicPhone` and
 * `clinicAddress` were always `undefined` and the template quietly dropped both
 * lines. Only `clinicName` survived, on its hardcoded fallback. Website was
 * never plumbed through at all.
 *
 * Cached per page load: reception prints many receipts in a session and the
 * branding record changes rarely. Failure resolves to null rather than throwing
 * — a branding outage must never stop a payment receipt from printing, so the
 * env/hardcoded fallbacks below still apply.
 */
let brandingPromise: Promise<BrandingConfig | null> | null = null

function loadBranding(): Promise<BrandingConfig | null> {
  if (!brandingPromise) {
    brandingPromise = getBranding()
      .then((res) => res.data ?? null)
      .catch(() => null)
  }
  return brandingPromise
}

/**
 * The clinic details printed in a document's header: branding first, env vars as a fallback for
 * the offline/failed-fetch case. `phones` is ordered primary-first, so [0] is the number to print.
 */
function clinicDetailsFrom(branding: BrandingConfig | null) {
  return {
    clinicName: branding?.name || import.meta.env.VITE_CLINIC_NAME || 'Denel Dental Clinic',
    clinicPhone: branding?.phones?.[0] || import.meta.env.VITE_CLINIC_PHONE || undefined,
    clinicAddress: branding?.address || import.meta.env.VITE_CLINIC_ADDRESS || undefined,
    clinicWebsite: branding?.website || undefined,
  }
}

/**
 * Open the receipt window. MUST be called synchronously from the click handler:
 * browsers only trust `window.open` while the user gesture is still active, and
 * a popup opened after an awaited network call is blocked. `generatePaymentReceipt`
 * therefore opens the window first and fetches branding second. `what` names the
 * document being prepared, for the placeholder shown until it is written.
 */
export function openReceiptWindow(what = 'receipt'): Window | null {
  // Width/height mimic a receipt view while still allowing printing.
  const w = window.open('', '_blank', 'width=400,height=800')
  if (w) {
    // Something to look at while branding loads — an empty popup reads as broken.
    w.document.write(
      '<!DOCTYPE html><html><head><title>Receipt</title></head>' +
        `<body style="font-family:system-ui;padding:24px;color:#555">Preparing ${what}…</body></html>`
    )
  }
  return w
}

export function generateReceipt(
  receiptData: ReceiptData,
  autoPrint: boolean = true,
  existingWindow?: Window | null
) {
  // Reuse the pre-opened window when there is one; only fall back to opening
  // here for synchronous callers.
  const receiptWindow = existingWindow ?? window.open('', '_blank', 'width=400,height=800')
  if (receiptWindow) {
    // Clear the placeholder before writing the real document.
    receiptWindow.document.open()
    // Format amounts using centralized utility (amountPaid, balance, and totalAmount are already in cents from database)
    const formattedAmountPaid = formatAmount(receiptData.amountPaid)
    const formattedBalance =
      receiptData.balance !== undefined && receiptData.balance !== null
        ? formatAmount(receiptData.balance)
        : null
    const formattedTotalAmount =
      receiptData.totalAmount !== undefined && receiptData.totalAmount !== null
        ? formatAmount(receiptData.totalAmount)
        : null

    const methods =
      receiptData.methods && receiptData.methods.length > 0
        ? receiptData.methods
        : [{ method: receiptData.paymentType, amount: receiptData.amountPaid }]
    const isSplit = methods.length > 1
    const banner = reversalBanner(receiptData.status)

    receiptWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Receipt - ${escapeHtml(receiptData.patientName)}</title>
        <style>
          body { 
            font-family: 'Courier New', Courier, monospace; 
            margin: 0; 
            padding: 20px; 
            color: #000; 
            font-size: 14px;
            line-height: 1.4;
          }
          .container {
            max-width: 350px;
            margin: 0 auto;
            background: #fff;
          }
          .header { 
            text-align: center; 
            margin-bottom: 20px; 
            padding-bottom: 10px; 
          }
          .logo img { 
            max-width: 120px; 
            height: auto;
            margin-bottom: 10px;
            display: block;
            margin-left: auto;
            margin-right: auto;
          }
          .clinic-name {
            font-weight: bold;
            font-size: 16px;
            margin-bottom: 5px;
          }
          /* The phone and address lines were referenced by the template but
             never styled — they'd have inherited the 16px clinic-name block and
             crowded the header. Sized down as secondary contact detail. */
          .clinic-phone,
          .clinic-address,
          .clinic-website {
            font-size: 11px;
            line-height: 1.4;
          }
          .receipt-title { 
            font-size: 16px; 
            font-weight: bold; 
            margin-top: 10px; 
            text-transform: uppercase; 
            border-top: 1px dashed #000;
            border-bottom: 1px dashed #000; 
            padding: 10px 0;
            display: block;
          }
          .meta-info {
            font-size: 10px;
            margin-top: 5px;
          }
          .content { 
            margin-bottom: 20px; 
            margin-top: 20px;
          }
          .row { 
            display: flex; 
            justify-content: space-between; 
            margin-bottom: 8px; 
          }
          .label { 
            font-weight: bold; 
          }
          .value { 
            text-align: right;
          }
          .amount-section { 
            border-top: 1px dashed #000; 
            border-bottom: 1px dashed #000; 
            padding: 15px 0; 
            margin: 20px 0; 
          }
          .total-row {
            display: flex;
            justify-content: space-between;
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 5px;
          }
          .balance-row {
            display: flex;
            justify-content: space-between;
            font-size: 14px;
          }
          .footer { 
            margin-top: 30px; 
            font-size: 12px; 
            display: flex; 
            justify-content: space-between; 
            align-items: flex-end; 
          }
          .footer-left { 
            text-align: left; 
          }
          .footer p { 
            margin: 5px 0; 
          }
          .qr-code { 
            margin-top: 10px; 
          }
          .qr-code img { 
            display: block; 
            width: 100px; 
            height: 100px; 
            border: 1px solid #ddd; 
            padding: 5px; 
            background: #fff; 
          }
          .stamp-space { 
            width: 120px; 
            height: 80px; 
          }
          @media print { 
            body { padding: 0.5cm; }
            .no-print { display: none; }
            .qr-code img { 
              display: block !important; 
              visibility: visible !important; 
              opacity: 1 !important; 
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">
              <!-- Use absolute path or full URL if needed, but relative usually works if same domain -->
              <img src="/logo.png" alt="Logo" onerror="this.style.display='none'"/>
            </div>
            <div class="clinic-name">${escapeHtml(receiptData.clinicName)}</div>
            ${receiptData.clinicWebsite ? `<div class="clinic-website">${escapeHtml(receiptData.clinicWebsite.replace(/^https?:\/\//i, '').replace(/\/$/, ''))}</div>` : ''}
            ${receiptData.clinicPhone ? `<div class="clinic-phone">${escapeHtml(receiptData.clinicPhone)}</div>` : ''}
            ${receiptData.clinicAddress ? `<div class="clinic-address">${escapeHtml(receiptData.clinicAddress)}</div>` : ''}
            <div class="clinic-date" style="font-size: 11px; line-height: 1.4; margin-top: 3px;">Date: ${escapeHtml(formatReceiptDate(receiptData.generatedAt))}</div>
            <div class="receipt-title">Payment Receipt</div>
            ${banner ? `<div style="font-size: 14px; font-weight: bold; margin-top: 8px; border: 2px solid #000; padding: 3px 0; letter-spacing: 2px;">${banner}</div>` : ''}
          </div>

          <div class="content">
            <div class="row">
              <span class="label">Patient:</span>
              <span class="value">${escapeHtml(receiptData.patientName)}</span>
            </div>
            ${
              receiptData.appointmentDate
                ? `
            <div class="row">
              <span class="label">Date:</span>
              <span class="value">${escapeHtml(receiptData.appointmentDate)}</span>
            </div>`
                : ''
            }
            ${
              receiptData.allocations &&
              receiptData.allocations.some((a) => a.items && a.items.length > 0)
                ? `
            <div style="margin-top: 15px;">
              <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <thead>
                  <tr>
                    <th style="text-align: left; border-bottom: 1px solid #000; padding-bottom: 4px;">Item</th>
                    <th style="text-align: right; border-bottom: 1px solid #000; padding-bottom: 4px;">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  ${receiptData.allocations
                    .flatMap((a) => a.items || [])
                    .map(
                      (item) => `
                    <tr>
                      <td style="padding: 4px 0; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(item.name)}">${escapeHtml(truncateService(item.name))}</td>
                      <td style="text-align: right; padding: 4px 0;">GHS ${formatAmount(item.cost)}</td>
                    </tr>
                  `
                    )
                    .join('')}
                </tbody>
              </table>
            </div>`
                : `
            <div class="row">
              <span class="label">Service:</span>
              <span class="value">${escapeHtml(truncateService(receiptData.paymentFor))}</span>
            </div>`
            }
            ${
              receiptData.notes
                ? `
            <div class="row" style="flex-direction: column;">
              <span class="label">Notes:</span>
              <span class="value" style="text-align: left; font-size: 12px;">${escapeHtml(receiptData.notes)}</span>
            </div>`
                : ''
            }
          </div>

          <div class="amount-section">
            ${
              hasInvoiceTotals(receiptData.allocations)
                ? (
                    () => {
                      const subtotal = receiptData.allocations!.reduce(
                        (acc, a) => acc + (a.invoiceSubtotal || 0),
                        0
                      )
                      const taxes = receiptData.allocations!.reduce(
                        (acc, a) => acc + (a.invoiceTaxTotal || 0),
                        0
                      )
                      return `
            <div class="row">
              <span class="label">Subtotal:</span>
              <span>GHS ${formatAmount(subtotal)}</span>
            </div>
            <div class="row">
              <span class="label">Taxes:</span>
              <span>GHS ${formatAmount(taxes)}</span>
            </div>
            <div class="row" style="margin-bottom: 10px;">
              <span class="label">Total:</span>
              <span>GHS ${formatAmount(subtotal + taxes)}</span>
            </div>`
                    }
                  )()
                : ''
            }
            <div class="total-row">
              <span>PAID:</span>
              <span>GHS ${formattedAmountPaid}</span>
            </div>
            ${
              receiptData.reversedAmount
                ? `
            <div class="row">
              <span class="label">Reversed:</span>
              <span>GHS ${formatAmount(receiptData.reversedAmount)}</span>
            </div>`
                : ''
            }
            <div style="margin: 6px 0 8px 0;">
              ${
                isSplit
                  ? `
                <div>
                  <div style="font-weight: bold; font-size: 12px; margin-bottom: 3px;">Payment Methods:</div>
                  ${methods
                    .map(
                      (m) => `
                    <div style="display: flex; justify-content: space-between; padding-left: 8px; margin-bottom: 2px; font-size: 12px;">
                      <span>${escapeHtml(methodLabel(m.method))}${methodStatusSuffix(m.status)}${m.reference ? ` (${escapeHtml(m.reference)})` : ''}:</span>
                      <span style="font-weight: bold;">GHS ${formatAmount(m.amount)}</span>
                    </div>`
                    )
                    .join('')}
                </div>`
                  : `
                <div class="row" style="margin-bottom: 2px;">
                  <span class="label">Method:</span>
                  <span class="value">${escapeHtml(methodLabel(methods[0]?.method || receiptData.paymentType))}${methodStatusSuffix(methods[0]?.status)}${methods[0]?.reference ? ` (${escapeHtml(methods[0].reference)})` : ''}</span>
                </div>`
              }
            </div>
            ${
              formattedBalance !== null
                ? `
            <div class="total-row">
              <span>Balance:</span>
              <span>GHS ${formattedBalance}</span>
            </div>`
                : ''
            }
            ${
              formattedTotalAmount !== null
                ? `
            <div class="balance-row">
              <span>Total Amount:</span>
              <span>GHS ${formattedTotalAmount}</span>
            </div>`
                : ''
            }
          </div>

          <div class="footer">
            <div class="footer-left">
              <p>Thank you!</p>
              <div style="margin-top: 10px; font-weight: bold; font-size: 11px; color: #000;">
                Please Note that Payments Made are Non-refundable.
              </div>
              
              <div class="qr-code">
                <img 
                  src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=https://deneldental.com/scan" 
                  alt="Scan to Rate Us"
                  width="100"
                  height="100"
                  style="display: block; max-width: 100px; height: auto;"
                />
                <div style="margin-top: 5px; font-size: 10px;">Scan to Rate Us</div>
              </div>
            </div>
            <div class="stamp-space"></div>
          </div>
        </div>

        ${
          autoPrint
            ? `
        <script>
          window.onload = function() {
            // Short delay to ensure image loads
            setTimeout(function() {
              window.print();
            }, 1000);
          }
        </script>`
            : ''
        }
      </body>
      </html>
    `)
    receiptWindow.document.close()
  }
}

interface PaymentReceiptParams {
  paymentId?: string // Optional payment ID to fetch full receipt data from API
  patientName: string
  amountPaid: number
  paymentMethod: string
  description?: string | null
  appointmentDate?: Date | string | null
  paymentPlanTotal?: number
  paymentPlanBalance?: number
  paymentType?: string // 'one-time' or 'plan'
  autoPrint?: boolean // whether to auto-print the receipt
}

// Helper function to parse description into treatment types and additional notes
function parseDescription(description: string | null | undefined): {
  treatmentTypes: string
  additionalNotes: string | null
} {
  if (!description) {
    return { treatmentTypes: 'Service Payment', additionalNotes: null }
  }

  // Remove the ledger adjustment audit note from the receipt
  let cleanDescription = description.replace(/\s*\|\s*\[Ledger Adjustment by.*?\]/g, '')
  cleanDescription = cleanDescription.replace(/\[Ledger Adjustment by.*?\]/g, '').trim()

  if (!cleanDescription) {
    return { treatmentTypes: 'Service Payment', additionalNotes: null }
  }

  // Split by " - " to separate treatment types from additional notes
  const parts = cleanDescription.split(' - ')
  const treatmentTypes = parts[0] || 'Service Payment'
  const additionalNotes = parts.length > 1 ? parts.slice(1).join(' - ') : null

  return { treatmentTypes, additionalNotes }
}

/**
 * Build and print a payment receipt.
 *
 * Async because the clinic's contact details come from the branding API. The
 * fetch is cached per page load and falls back on failure, so callers that
 * fire-and-forget still get a receipt; awaiting only matters if you need to know
 * the print dialog has opened.
 */
export async function generatePaymentReceipt(params: PaymentReceiptParams) {
  const {
    paymentId,
    patientName,
    amountPaid,
    paymentMethod,
    description,
    appointmentDate,
    paymentPlanTotal,
    paymentPlanBalance,
    autoPrint = true,
  } = params

  // Pass amounts (now in cents) directly to generateReceipt; formatAmount handles cents correctly.
  const amountPaidCents = amountPaid
  const totalAmountCents = paymentPlanTotal
  const balanceCents = paymentPlanBalance

  // Format appointment date
  let formattedAppointmentDate: string | undefined
  if (appointmentDate) {
    try {
      const date = typeof appointmentDate === 'string' ? new Date(appointmentDate) : appointmentDate
      formattedAppointmentDate = format(date, 'MMMM d, yyyy h:mm a')
    } catch (_e) {
      formattedAppointmentDate = undefined
    }
  }

  // Parse description to extract treatment types and additional notes
  const { treatmentTypes, additionalNotes } = parseDescription(description)

  // Opened BEFORE the await so the popup still rides the user's click.
  const receiptWindow = openReceiptWindow()

  const branding = await loadBranding()

  // Fetch rich receipt data if we have a paymentId
  let allocations: ReceiptData['allocations'] | undefined
  let methods: ReceiptData['methods'] | undefined
  let finalAmountPaid = amountPaidCents
  let finalBalance = balanceCents
  let finalTotalAmount = totalAmountCents
  let finalPaymentFor = treatmentTypes

  if (paymentId) {
    try {
      const { api } = await import('@/lib/api-client')
      const res = await api.get<any>(`/api/payments/${paymentId}/receipt`)
      if (res.data) {
        if (res.data.allocations) allocations = res.data.allocations
        if (res.data.methods) methods = res.data.methods
        if (res.data.amountPaid != null) finalAmountPaid = res.data.amountPaid
        if (res.data.totalAmount != null) finalTotalAmount = res.data.totalAmount
        if (res.data.balance != null) finalBalance = res.data.balance
        if (res.data.paymentFor) finalPaymentFor = res.data.paymentFor
      }
    } catch (error) {
      console.error('Failed to fetch rich receipt data:', error)
    }
  }

  const receiptData: ReceiptData = {
    patientName,
    appointmentDate: formattedAppointmentDate,
    amountPaid: finalAmountPaid,
    totalAmount: finalTotalAmount,
    balance: finalBalance,
    paymentType: paymentMethod,
    methods,
    paymentFor: finalPaymentFor, // Use treatment types or backend paymentFor
    notes: additionalNotes, // Use additional notes in the notes field
    allocations, // Included for the rich tabular receipt
    ...clinicDetailsFrom(branding),
    generatedAt: new Date().toLocaleString(),
  }

  generateReceipt(receiptData, autoPrint, receiptWindow)
}

interface OutstandingBalanceSlipParams {
  patientName: string
  /** The invoices that were open, each with the balance it had BEFORE this payment (cents). */
  invoices: Array<{ invoiceNumber: string; dueDate: string | null; balanceBefore: number }>
  /** What was paid just now (cents). */
  paidNow: number
  /** What the patient still owes after it (cents): the server's figure, printed as given. */
  balanceDue: number
  /** A window opened inside the click (`openReceiptWindow`); one is opened here when none is given. */
  existingWindow?: Window | null
  /** Whether to open the browser's print dialog (default: yes). */
  autoPrint?: boolean
}

/** A due date for print: `01 Oct 2026` for a plain `YYYY-MM-DD`, else whatever it was. */
function formatDueDate(due: string | null): string {
  if (!due) return 'No due date'
  const day = due.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? format(parseLocalDate(day), 'dd MMM yyyy') : due
}

/**
 * Print what a patient owes: the invoices that were open (with the balance each had before today's
 * payment), what was paid now, and the balance still due. A different paper from the payment
 * receipt: it is printed only when asked for, and the figures are printed as given (the Receive
 * Payment dialog hands in the server's), never worked out here.
 */
export async function printOutstandingBalanceSlip(params: OutstandingBalanceSlipParams) {
  const { patientName, invoices, paidNow, balanceDue, existingWindow, autoPrint = true } = params

  // The caller normally opens the window inside the click and hands it in; opened here (before
  // the await) only for a caller that did not.
  const slipWindow = existingWindow ?? openReceiptWindow('balance slip')
  if (!slipWindow) return

  const clinic = clinicDetailsFrom(await loadBranding())
  const rows =
    invoices.length > 0
      ? invoices
          .map(
            (inv) => `
                <tr>
                  <td style="padding: 3px 0;">${escapeHtml(inv.invoiceNumber)}</td>
                  <td style="padding: 3px 4px;">${escapeHtml(formatDueDate(inv.dueDate))}</td>
                  <td style="text-align: right; padding: 3px 0;">GHS ${formatAmount(inv.balanceBefore)}</td>
                </tr>`
          )
          .join('')
      : `
                <tr>
                  <td colspan="3" style="padding: 6px 0; text-align: center;">No outstanding invoices</td>
                </tr>`

  slipWindow.document.open()
  slipWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Outstanding Balance - ${escapeHtml(patientName)}</title>
        <style>
          body { font-family: 'Courier New', Courier, monospace; margin: 0; padding: 20px; color: #000; font-size: 14px; line-height: 1.4; }
          .container { max-width: 350px; margin: 0 auto; background: #fff; }
          .header { text-align: center; margin-bottom: 20px; padding-bottom: 10px; }
          .logo img { max-width: 120px; height: auto; margin-bottom: 10px; display: block; margin-left: auto; margin-right: auto; }
          .clinic-name { font-weight: bold; font-size: 16px; margin-bottom: 5px; }
          .clinic-phone, .clinic-address, .clinic-website { font-size: 11px; line-height: 1.4; }
          .slip-title { font-size: 16px; font-weight: bold; margin-top: 10px; text-transform: uppercase; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 10px 0; display: block; }
          .content { margin: 20px 0; }
          .row { display: flex; justify-content: space-between; margin-bottom: 8px; }
          .label { font-weight: bold; }
          .value { text-align: right; }
          .totals { border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 12px 0; margin: 16px 0; }
          .total-row { display: flex; justify-content: space-between; font-size: 18px; font-weight: bold; }
          .note { font-size: 11px; margin-top: 6px; }
          .footer { margin-top: 24px; font-size: 12px; }
          @media print { body { padding: 0.5cm; } }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">
              <img src="/logo.png" alt="Logo" onerror="this.style.display='none'"/>
            </div>
            <div class="clinic-name">${escapeHtml(clinic.clinicName)}</div>
            ${clinic.clinicWebsite ? `<div class="clinic-website">${escapeHtml(clinic.clinicWebsite.replace(/^https?:\/\//i, '').replace(/\/$/, ''))}</div>` : ''}
            ${clinic.clinicPhone ? `<div class="clinic-phone">${escapeHtml(clinic.clinicPhone)}</div>` : ''}
            ${clinic.clinicAddress ? `<div class="clinic-address">${escapeHtml(clinic.clinicAddress)}</div>` : ''}
            <div style="font-size: 11px; line-height: 1.4; margin-top: 3px;">Date: ${escapeHtml(formatReceiptDate(null))}</div>
            <div class="slip-title">Outstanding Balance</div>
          </div>

          <div class="content">
            <div class="row">
              <span class="label">Patient:</span>
              <span class="value">${escapeHtml(patientName)}</span>
            </div>
            <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 12px;">
              <thead>
                <tr>
                  <th style="text-align: left; border-bottom: 1px solid #000; padding-bottom: 4px;">Invoice</th>
                  <th style="text-align: left; border-bottom: 1px solid #000; padding-bottom: 4px;">Due</th>
                  <th style="text-align: right; border-bottom: 1px solid #000; padding-bottom: 4px;">Balance</th>
                </tr>
              </thead>
              <tbody>${rows}
              </tbody>
            </table>
            ${paidNow > 0 ? '<div class="note">Balances shown are before today’s payment.</div>' : ''}

            <div class="totals">
              <div class="row">
                <span class="label">Paid now</span>
                <span class="value">GHS ${formatAmount(paidNow)}</span>
              </div>
              <div class="total-row">
                <span>Balance due</span>
                <span>GHS ${formatAmount(balanceDue)}</span>
              </div>
            </div>
          </div>

          <div class="footer">
            <p>Thank you!</p>
          </div>
        </div>

        ${
          autoPrint
            ? `
        <script>
          window.onload = function() {
            // Short delay to ensure the logo loads
            setTimeout(function() {
              window.print();
            }, 1000);
          }
        </script>`
            : ''
        }
      </body>
      </html>
    `)
  slipWindow.document.close()
}
