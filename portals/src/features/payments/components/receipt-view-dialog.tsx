import { format } from 'date-fns'
import { Printer } from 'lucide-react'
import { forwardRef, useEffect, useRef } from 'react'
import { useReactToPrint } from 'react-to-print'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { formatAmount } from '@/shared/utils/currency'
import {
  hasInvoiceTotals,
  methodStatusSuffix,
  reversalBanner,
} from '@/shared/utils/receipt-display'

// ── Types ────────────────────────────────────────────────────────────────────

interface ReceiptAllocation {
  invoiceNumber: string
  invoiceTotal: number | null
  invoiceSubtotal?: number | null
  invoiceTaxTotal?: number | null
  amountApplied: number
  remainingBalance: number | null
  status: string | null
  treatments?: string[]
  items?: { name: string; cost: number }[]
}

interface ReceiptMethod {
  method: string
  amount: number
  reference: string | null
  paymentNumber: string | null
  /** 'reversed' once this method's payment has been reversed. */
  status?: string
}

export interface ReceiptDataShape {
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
  allocations?: ReceiptAllocation[]
  /** When the original payment was a split, every sibling source comes back
   *  here so the slip can show "Payment Method 1: cash 500 / Method 2:
   *  wallet 200". Single-source payments still get one entry. */
  methods?: ReceiptMethod[]
  unallocatedAmount?: number
  paymentNumber?: string | null
  paymentNumbers?: string[]
  invoiceNumbers?: string[]
  /**
   * 'reversed' when every payment on the receipt has been reversed, 'partly_reversed' when only
   * some methods of a split have been, otherwise 'posted'. `amountPaid` counts the payments still
   * in force; `reversedAmount` is what was reversed.
   */
  status?: 'posted' | 'reversed' | 'partly_reversed'
  reversedAmount?: number
}

interface ReceiptViewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  receiptData: ReceiptDataShape
  autoPrint?: boolean
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function ghs(n: number) {
  return `GHS ${formatAmount(n)}`
}

function methodLabel(m: string) {
  if (!m) return ''
  return m
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bMomo\b/, 'Mobile Money')
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

function deriveService(receiptData: ReceiptDataShape): string {
  const fromAllocs =
    receiptData.allocations?.flatMap((a) => a.treatments ?? []).filter((s) => s.trim()) ?? []
  if (fromAllocs.length > 0) return [...new Set(fromAllocs)].join(', ')
  return receiptData.paymentFor || 'Service Payment'
}

function deriveReference(receiptData: ReceiptDataShape): string | null {
  const invs = receiptData.invoiceNumbers ?? receiptData.allocations?.map((a) => a.invoiceNumber)
  if (invs && invs.length > 0) return invs.join(', ')
  if (receiptData.paymentNumbers && receiptData.paymentNumbers.length > 0)
    return receiptData.paymentNumbers.join(', ')
  return receiptData.paymentNumber ?? null
}

function deriveBalance(receiptData: ReceiptDataShape): number | null {
  if (receiptData.balance != null) return receiptData.balance
  if (receiptData.allocations && receiptData.allocations.length > 0) {
    const balances = receiptData.allocations
      .map((a) => a.remainingBalance)
      .filter((b): b is number => b != null)
    if (balances.length === 0) return null
    return balances.reduce((s, b) => s + b, 0)
  }
  return null
}

// ── Component ────────────────────────────────────────────────────────────────

export function ReceiptViewDialog({
  open,
  onOpenChange,
  receiptData,
  autoPrint = false,
}: ReceiptViewDialogProps) {
  // react-to-print clones the referenced node into a hidden iframe and fires
  // the browser print dialog from there — no more window.open + innerHTML.
  // The same React/Tailwind component is the single source of truth for both
  // on-screen and print, so styling drift is impossible.
  const slipRef = useRef<HTMLDivElement>(null)
  const handlePrint = useReactToPrint({
    contentRef: slipRef,
    documentTitle: `Receipt - ${receiptData.patientName}`,
    // 80mm thermal printer page size — common for clinic receipts. Browsers
    // that don't honour @page (older Safari) fall back to the user's default
    // print size, which still renders cleanly because the slip is 80mm wide.
    pageStyle: `
      @page { size: 80mm auto; margin: 4mm; }
      @media print {
        html, body { background: #fff !important; }
      }
    `,
  })

  // Auto-print support when opened specifically for printing
  useEffect(() => {
    if (open && autoPrint) {
      const timer = setTimeout(() => {
        handlePrint()
      }, 350)
      return () => clearTimeout(timer)
    }
  }, [open, autoPrint, handlePrint])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Payment Receipt</DialogTitle>
          <DialogDescription>View and print the payment receipt.</DialogDescription>
        </DialogHeader>

        <ReceiptSlip ref={slipRef} receiptData={receiptData} />

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={() => handlePrint()}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Slip — the renderable receipt, shared by on-screen and print ────────────

interface SlipProps {
  receiptData: ReceiptDataShape
}

const ReceiptSlip = forwardRef<HTMLDivElement, SlipProps>(function ReceiptSlip(
  { receiptData },
  ref
) {
  const service = deriveService(receiptData)
  const reference = deriveReference(receiptData)
  const balance = deriveBalance(receiptData)
  const methods: ReceiptMethod[] =
    receiptData.methods && receiptData.methods.length > 0
      ? receiptData.methods
      : [
          {
            method: receiptData.paymentType,
            amount: receiptData.amountPaid,
            reference: null,
            paymentNumber: receiptData.paymentNumber ?? null,
          },
        ]
  const isSplit = methods.length > 1
  const banner = reversalBanner(receiptData.status)

  return (
    <div
      ref={ref}
      className="receipt-slip"
      style={{
        fontFamily: "'Courier New', Courier, monospace",
        fontSize: '13px',
        lineHeight: 1.4,
        color: '#000',
        background: '#fff',
        padding: '16px',
        margin: '0 auto',
        maxWidth: '350px',
      }}
    >
      {/* ── Header — clinic identity (from branding) ─────────────────── */}
      <div style={{ textAlign: 'center', marginBottom: '14px' }}>
        <img
          src="/logo.png"
          alt="Logo"
          width={110}
          height={36}
          style={{ maxWidth: '110px', height: 'auto', display: 'block', margin: '0 auto 6px' }}
          onError={(e) => {
            ;(e.target as HTMLImageElement).style.display = 'none'
          }}
        />
        <div style={{ fontWeight: 'bold', fontSize: '15px' }}>{receiptData.clinicName}</div>
        {receiptData.clinicWebsite && (
          <div style={{ fontSize: '11px', lineHeight: 1.3 }}>
            {receiptData.clinicWebsite.replace(/^https?:\/\//i, '').replace(/\/$/, '')}
          </div>
        )}
        {receiptData.clinicPhone && (
          <div style={{ fontSize: '11px', lineHeight: 1.3 }}>{receiptData.clinicPhone}</div>
        )}
        {receiptData.clinicAddress && (
          <div style={{ fontSize: '11px', lineHeight: 1.3 }}>{receiptData.clinicAddress}</div>
        )}
        <div style={{ fontSize: '11px', lineHeight: 1.3, marginTop: '3px' }}>
          Date: {formatReceiptDate(receiptData.generatedAt)}
        </div>
        <div
          style={{
            fontSize: '13px',
            fontWeight: 'bold',
            marginTop: '10px',
            textTransform: 'uppercase',
            borderTop: '1px dashed #000',
            borderBottom: '1px dashed #000',
            padding: '6px 0',
          }}
        >
          Payment Receipt
        </div>
        {banner && (
          <div
            style={{
              fontSize: '14px',
              fontWeight: 'bold',
              marginTop: '8px',
              border: '2px solid #000',
              padding: '3px 0',
              letterSpacing: '2px',
            }}
          >
            {banner}
          </div>
        )}
      </div>

      {/* ── Body — name, service ───────────────────────────────────── */}
      <div style={{ margin: '12px 0' }}>
        <Row label="Patient:" value={receiptData.patientName} />
        {receiptData.appointmentDate && <Row label="Date:" value={receiptData.appointmentDate} />}
        {/* If we have allocations with items, render them as a table. Otherwise fallback to the old Service string. */}
        {receiptData.allocations &&
        receiptData.allocations.some((a) => a.items && a.items.length > 0) ? (
          <div style={{ marginTop: '12px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: 'left',
                      borderBottom: '1px solid #000',
                      paddingBottom: '4px',
                    }}
                  >
                    Item
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      borderBottom: '1px solid #000',
                      paddingBottom: '4px',
                    }}
                  >
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {receiptData.allocations
                  .flatMap((a) => a.items || [])
                  .map((item, idx) => (
                    <tr key={idx}>
                      <td
                        style={{
                          padding: '4px 0',
                          maxWidth: '180px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={item.name}
                      >
                        {truncateService(item.name)}
                      </td>
                      <td style={{ textAlign: 'right', padding: '4px 0' }}>{ghs(item.cost)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Row label="Service:" value={truncateService(service)} />
        )}
        {receiptData.notes && (
          <div style={{ display: 'flex', flexDirection: 'column', marginBottom: '8px' }}>
            <span style={{ fontWeight: 'bold' }}>Notes:</span>
            <span style={{ textAlign: 'left', fontSize: '12px' }}>{receiptData.notes}</span>
          </div>
        )}
      </div>

      {/* ── Amounts ──────────────────────────────────────────────────── */}
      <div
        style={{
          borderTop: '1px dashed #000',
          borderBottom: '1px dashed #000',
          padding: '15px 0',
          margin: '20px 0',
        }}
      >
        {/* Only a receipt of a real invoice has invoice totals; an itemised one-time payment does not. */}
        {hasInvoiceTotals(receiptData.allocations) && (
          <div style={{ marginBottom: '10px' }}>
            {(() => {
              const subtotal = receiptData.allocations!.reduce(
                (acc, a) => acc + (a.invoiceSubtotal || 0),
                0
              )
              const taxes = receiptData.allocations!.reduce(
                (acc, a) => acc + (a.invoiceTaxTotal || 0),
                0
              )
              return (
                <>
                  <Row label="Subtotal:" value={ghs(subtotal)} />
                  <Row label="Taxes:" value={ghs(taxes)} />
                  <Row label="Total:" value={ghs(subtotal + taxes)} />
                </>
              )
            })()}
          </div>
        )}
        <BigRow label="PAID:" value={ghs(receiptData.amountPaid)} />
        {receiptData.reversedAmount ? (
          <Row label="Reversed:" value={ghs(receiptData.reversedAmount)} />
        ) : null}
        {/* Payment methods section placed directly below "PAID" row, breakdown [100 + 50] removed */}
        <div style={{ margin: '6px 0 8px 0' }}>
          {isSplit ? (
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '3px' }}>
                Payment Methods:
              </div>
              {methods.map((m, idx) => (
                <div
                  key={`${m.paymentNumber ?? idx}`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    paddingLeft: '8px',
                    marginBottom: '2px',
                    fontSize: '12px',
                  }}
                >
                  <span>
                    {methodLabel(m.method)}
                    {methodStatusSuffix(m.status)}
                    {m.reference ? ` (${m.reference})` : ''}:
                  </span>
                  <span style={{ fontWeight: 'bold' }}>{ghs(m.amount)}</span>
                </div>
              ))}
            </div>
          ) : (
            <Row
              label="Method:"
              value={`${methodLabel(methods[0]?.method || receiptData.paymentType)}${methodStatusSuffix(methods[0]?.status)}${methods[0]?.reference ? ` (${methods[0].reference})` : ''}`}
            />
          )}
        </div>
        {balance != null && <BigRow label="Balance:" value={ghs(balance)} />}
        {reference && (
          <div style={{ marginTop: '6px' }}>
            <Row label="Reference:" value={reference} />
          </div>
        )}
      </div>

      {/* ── Footer — QR + thank you + timestamp at bottom ───────────── */}
      <div
        style={{
          marginTop: '30px',
          fontSize: '12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
        }}
      >
        <div style={{ textAlign: 'left' }}>
          <p style={{ margin: '5px 0' }}>Thank you!</p>
          <div
            style={{
              marginTop: '10px',
              fontWeight: 'bold',
              fontSize: '11px',
              color: '#000',
            }}
          >
            Please Note that Payments Made are Non-refundable.
          </div>
          <div style={{ marginTop: '15px' }}>
            <img
              src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=https://deneldental.com/scan"
              alt="Scan to Rate"
              width={100}
              height={100}
              style={{
                width: '100px',
                height: '100px',
                border: '1px solid #ddd',
                padding: '5px',
                background: '#fff',
                display: 'block',
              }}
            />
            <div style={{ fontSize: '10px', marginTop: '5px' }}>Scan to Rate Us</div>
          </div>
        </div>
        <div style={{ width: '120px', height: '80px' }}></div>
      </div>
    </div>
  )
})

// ── Sub-components ──────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '8px',
        marginBottom: '5px',
      }}
    >
      <span style={{ fontWeight: 'bold', flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}

function BigRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '16px',
        fontWeight: 'bold',
        marginBottom: '5px',
      }}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}
