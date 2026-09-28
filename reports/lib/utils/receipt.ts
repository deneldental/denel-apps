import { format } from 'date-fns'
import { formatAmount } from '@/lib/utils/currency'

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
}

function truncateService(service: string, maxLength: number = 22): string {
  if (!service) return ''
  if (service.length <= maxLength) return service
  return `${service.slice(0, maxLength).trimEnd()}...`
}

function formatReceiptDate(dateStr?: string | null): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function generateReceipt(receiptData: ReceiptData, autoPrint: boolean = true) {
  // Create a new window for the receipt
  // Use a width/height that mimics a receipt view but allows printing
  const receiptWindow = window.open('', '_blank', 'width=400,height=800')
  if (receiptWindow) {
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

    receiptWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Receipt - ${receiptData.patientName}</title>
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
            /* Optional visual guide for stamp placement */
            /* border: 1px dashed #ccc; */
          }
          @media print { 
            body { padding: 0.5cm; }
            .no-print { display: none; }
            .qr-code img {
              display: block !important;
              visibility: visible !important;
              opacity: 1 !important;
            }
            /* No page size restriction as requested */
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
            <div class="clinic-name">${receiptData.clinicName}</div>
            ${receiptData.clinicWebsite ? `<div class="clinic-website" style="font-size: 11px; margin-bottom: 2px;">${receiptData.clinicWebsite.replace(/^https?:\/\//i, '').replace(/\/$/, '')}</div>` : ''}
            ${receiptData.clinicPhone ? `<div class="clinic-phone" style="font-size: 11px; margin-bottom: 2px;">${receiptData.clinicPhone}</div>` : ''}
            ${receiptData.clinicAddress ? `<div class="clinic-address" style="font-size: 11px; margin-bottom: 2px;">${receiptData.clinicAddress}</div>` : ''}
            <div class="meta-info" style="font-size: 11px; margin-top: 3px;">Date: ${formatReceiptDate(receiptData.generatedAt)}</div>
            <div class="receipt-title">Payment Receipt</div>
          </div>

          <div class="content">
            <div class="row">
              <span class="label">Patient:</span>
              <span class="value">${receiptData.patientName}</span>
            </div>
            ${
              receiptData.appointmentDate
                ? `
            <div class="row">
              <span class="label">Date:</span>
              <span class="value">${receiptData.appointmentDate}</span>
            </div>`
                : ''
            }
            <div class="row">
              <span class="label">Service:</span>
              <span class="value" style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${receiptData.paymentFor}">${truncateService(receiptData.paymentFor, 22)}</span>
            </div>
            ${
              receiptData.notes
                ? `
            <div class="row" style="flex-direction: column;">
              <span class="label">Notes:</span>
              <span class="value" style="text-align: left; font-size: 12px;">${receiptData.notes}</span>
            </div>`
                : ''
            }
          </div>

          <div class="amount-section">
            <div class="total-row">
              <span>PAID:</span>
              <span>GHS ${formattedAmountPaid}</span>
            </div>
            <div class="row" style="margin: 6px 0 8px 0;">
              <span class="label">Method:</span>
              <span class="value" style="text-transform: capitalize">${receiptData.paymentType}</span>
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
              <p style="margin: 8px 0 0 0; font-weight: bold; font-size: 11px; color: #000;">
                Please Note that Payments Made are Non-refundable.
              </p>
              
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

              <div style="margin-top: 10px; font-size: 11px; color: #000; font-weight: bold;">
                ${receiptData.clinicWebsite || 'www.deneldental.com'}
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
  patientName: string
  amountPaid: number // in cents
  paymentMethod: string
  description?: string | null
  appointmentDate?: Date | string | null
  paymentPlanTotal?: number // in cents
  paymentPlanBalance?: number // in cents
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

  // Split by " - " to separate treatment types from additional notes
  const parts = description.split(' - ')
  const treatmentTypes = parts[0] || 'Service Payment'
  const additionalNotes = parts.length > 1 ? parts.slice(1).join(' - ') : null

  return { treatmentTypes, additionalNotes }
}

export function generatePaymentReceipt(params: PaymentReceiptParams) {
  const {
    patientName,
    amountPaid,
    paymentMethod,
    description,
    appointmentDate,
    paymentPlanTotal,
    paymentPlanBalance,
    paymentType = 'one-time',
    autoPrint = true,
  } = params

  // Pass amounts in cents directly to generateReceipt - formatAmount will handle conversion
  const amountPaidInCents = amountPaid
  const totalAmountInCents = paymentPlanTotal
  const balanceInCents = paymentPlanBalance

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

  const receiptData: ReceiptData = {
    patientName,
    appointmentDate: formattedAppointmentDate,
    amountPaid: amountPaidInCents,
    totalAmount: totalAmountInCents,
    balance: balanceInCents,
    paymentType: paymentMethod,
    paymentFor: treatmentTypes, // Use treatment types as the service
    notes: additionalNotes, // Use additional notes in the notes field
    clinicName: import.meta.env.VITE_CLINIC_NAME || 'Denel Dental Clinic',
    clinicPhone: import.meta.env.VITE_CLINIC_PHONE || undefined,
    clinicAddress: import.meta.env.VITE_CLINIC_ADDRESS || undefined,
    clinicWebsite: import.meta.env.VITE_CLINIC_WEBSITE || '',
    generatedAt: new Date().toLocaleString(),
  }

  generateReceipt(receiptData, autoPrint)
}
