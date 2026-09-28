import { format } from 'date-fns'
import { ChevronDown, Printer } from 'lucide-react'
import { forwardRef, useEffect, useRef, useState } from 'react'
import { useReactToPrint } from 'react-to-print'
import { toast } from 'sonner'
import { IssueCreditNoteDialog } from '@/features/credit-notes/components/issue-credit-note-dialog'
import { type BrandingConfig, getBranding } from '@/lib/actions/branding'
import {
  getInvoice,
  type InvoiceDraft,
  type InvoiceLine,
  listInvoiceLines,
  voidInvoice,
} from '@/lib/actions/invoices-v2'
import { useBranding } from '@/lib/branding-context'
import { usePermissions } from '@/lib/permissions-context'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { VoidDocumentDialog } from '@/shared/components/void-document-dialog'
import { formatAmount } from '@/shared/utils/currency'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoiceId: string | null
  /** If true, auto-trigger print on first successful load (e.g. for the
   *  "Print" action item — opens dialog AND immediately sends to printer). */
  autoPrint?: boolean
  patientName: string
  /** Fired after a credit note is posted or the invoice is voided, so the
   *  caller can refresh whatever surfaced this dialog (ledger, list, …). The
   *  dialog also re-fetches the invoice in place so the slip stays current. */
  onActioned?: () => void
}

/**
 * Every money value on an invoice arrives from the API as integer CENTS
 * (migration 0209). This used to be `Number(n).toFixed(2)`, which printed the
 * raw cent count under a GHS label — a GHS 18,000.00 invoice rendered as
 * "GHS 1800000.00" on the slip handed to the patient.
 *
 * `formatAmount` is the one cents-aware formatter; see
 * project-docs/money-unit-audit-and-remediation.md.
 */
function ghs(cents: number) {
  return `GHS ${formatAmount(cents)}`
}

export function InvoiceViewSheet({
  open,
  onOpenChange,
  invoiceId,
  autoPrint = false,
  patientName,
  onActioned,
}: Props) {
  // Initial value comes from the app-wide context (avoids a render flash with
  // defaults), but we re-fetch from the API every time the dialog opens so
  // edits made in Integrations → Branding show up immediately without a
  // page reload. People print live invoices — staleness here = wrong slip.
  const cachedBranding = useBranding()
  const [branding, setBranding] = useState<BrandingConfig>(cachedBranding)
  const clinic = {
    name: branding.name,
    phone: branding.phones?.[0] ?? null,
    address: branding.address ?? null,
    website: branding.website ?? null,
  }
  const [invoice, setInvoice] = useState<InvoiceDraft | null>(null)
  const [lines, setLines] = useState<InvoiceLine[]>([])
  const [loading, setLoading] = useState(false)
  const [creditNoteOpen, setCreditNoteOpen] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)

  // Re-fetch the invoice after a credit note / void so the slip (status,
  // balance) reflects the change without closing the dialog.
  async function reloadInvoice() {
    if (!invoiceId) return
    const res = await getInvoice(invoiceId)
    if (res.success && res.data) setInvoice(res.data as InvoiceDraft)
  }

  // An invoice can take a credit note or be voided only while it's "live"
  // (issued or partially paid). Drafts, paid, void, and written-off invoices
  // have no actionable reverse/refund path from this view.
  // Both write down what the patient owes, so both are admin-only.
  const isAdmin = usePermissions()?.isAdmin ?? false
  const isLive = invoice?.status === 'issued' || invoice?.status === 'partially_paid'
  const canIssueCreditNote = isAdmin && isLive
  const canVoid = isAdmin && isLive
  const hasReverseActions = canIssueCreditNote || canVoid

  // Refresh branding on dialog open. Tiny request; failure falls back to the
  // cached context value.
  useEffect(() => {
    if (!open) return
    let active = true
    getBranding()
      .then((res) => {
        if (active && res.success && res.data) setBranding(res.data)
      })
      .catch(() => {
        /* keep cached value */
      })
    return () => {
      active = false
    }
  }, [open])

  const slipRef = useRef<HTMLDivElement>(null)
  const handlePrint = useReactToPrint({
    contentRef: slipRef,
    documentTitle: invoice ? `Invoice ${invoice.invoiceNumber}` : 'Invoice',
    // A4 with reasonable margins — invoices are typically printed on A4 in
    // the clinic, unlike receipts (which target an 80mm thermal printer).
    pageStyle: `
      @page { size: A4; margin: 15mm; }
      @media print {
        html, body { background: #fff !important; }
      }
    `,
  })

  useEffect(() => {
    if (!open || !invoiceId) return
    let active = true
    setLoading(true)
    Promise.all([getInvoice(invoiceId), listInvoiceLines(invoiceId)])
      .then(([invRes, linesRes]) => {
        if (!active) return
        if (invRes.success && invRes.data) setInvoice(invRes.data as InvoiceDraft)
        else toast.error(invRes.error || 'Failed to load invoice')
        if (linesRes.success && linesRes.data) setLines(linesRes.data)
        setLoading(false)
        if (autoPrint) {
          // Slight delay so the slip is in the DOM before react-to-print
          // measures it.
          setTimeout(() => handlePrint(), 250)
        }
      })
      .catch(() => {
        if (!active) return
        toast.error('Failed to load invoice')
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open, invoiceId, autoPrint, handlePrint])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="!w-full !max-w-3xl flex flex-col p-0">
        <SheetHeader className="shrink-0 space-y-1 border-b px-6 pt-6 pb-4 text-left">
          <SheetTitle>Invoice</SheetTitle>
          <SheetDescription>View and print the invoice.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading || !invoice ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : (
            <InvoiceSlip
              ref={slipRef}
              invoice={invoice}
              lines={lines}
              patientName={patientName}
              clinic={clinic}
            />
          )}
        </div>

        <div className="shrink-0 border-t bg-background px-6 py-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {invoice && hasReverseActions && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  Reverse / Refund
                  <ChevronDown className="ml-1.5 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canIssueCreditNote && (
                  <DropdownMenuItem onSelect={() => setCreditNoteOpen(true)}>
                    Issue credit note…
                  </DropdownMenuItem>
                )}
                {canVoid && (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setVoidOpen(true)}
                  >
                    Void invoice…
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button onClick={() => handlePrint()} disabled={!invoice}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>
      </SheetContent>

      {invoice && (
        <IssueCreditNoteDialog
          open={creditNoteOpen}
          onOpenChange={setCreditNoteOpen}
          invoiceId={invoice.id}
          invoiceNumber={invoice.invoiceNumber}
          invoiceBalance={Number(invoice.balance)}
          invoiceTaxTotal={Number(invoice.taxTotal)}
          invoiceTotal={Number(invoice.total)}
          onPosted={async () => {
            await reloadInvoice()
            onActioned?.()
          }}
        />
      )}

      {invoice && (
        <VoidDocumentDialog
          open={voidOpen}
          onOpenChange={setVoidOpen}
          documentLabel="invoice"
          description="Posts a reversal entry. Allowed only when no payments are allocated to this invoice. Use a credit note for invoices that already have payments."
          onConfirm={async (reason) => {
            const res = await voidInvoice(invoice.id, reason)
            if (!res.success) {
              toast.error(res.error ?? 'Failed to void invoice')
              return false
            }
            toast.success('Invoice voided')
            await reloadInvoice()
            onActioned?.()
            return true
          }}
        />
      )}
    </Sheet>
  )
}

// ── Slip — shared by on-screen and print ────────────────────────────────────

interface SlipProps {
  invoice: InvoiceDraft
  lines: InvoiceLine[]
  patientName: string
  clinic: { name: string; phone: string | null; address: string | null; website: string | null }
}

const InvoiceSlip = forwardRef<HTMLDivElement, SlipProps>(function InvoiceSlip(
  { invoice, lines, patientName, clinic },
  ref
) {
  return (
    <div
      ref={ref}
      className="invoice-slip"
      style={{
        fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
        fontSize: '12px',
        lineHeight: 1.5,
        color: '#000',
        background: '#fff',
        padding: '24px',
        margin: '0 auto',
        maxWidth: '720px',
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          paddingBottom: '16px',
          borderBottom: '2px solid #000',
          marginBottom: '20px',
        }}
      >
        <div>
          <img
            src="/logo.png"
            alt="Logo"
            width={120}
            height={40}
            style={{ maxWidth: '120px', height: 'auto', marginBottom: '8px' }}
            onError={(e) => {
              ;(e.target as HTMLImageElement).style.display = 'none'
            }}
          />
          <div style={{ fontWeight: 'bold', fontSize: '18px' }}>{clinic.name}</div>
          {clinic.phone && <div style={{ fontSize: '12px' }}>{clinic.phone}</div>}
          {clinic.address && (
            <div style={{ fontSize: '12px', maxWidth: '300px' }}>{clinic.address}</div>
          )}
          {clinic.website && (
            <div style={{ fontSize: '12px' }}>
              <a href={clinic.website} style={{ color: '#000', textDecoration: 'none' }}>
                {clinic.website.replace(/^https?:\/\//i, '')}
              </a>
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', letterSpacing: '2px' }}>INVOICE</div>
          <div style={{ fontFamily: 'monospace', fontSize: '14px', marginTop: '4px' }}>
            {invoice.invoiceNumber}
          </div>
          <div style={{ marginTop: '8px' }}>
            <Badge variant="outline" className="text-[10px] capitalize">
              {String(invoice.status).replace('_', ' ')}
            </Badge>
          </div>
        </div>
      </div>

      {/* ── Bill-to + dates ─────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '20px',
          marginBottom: '24px',
        }}
      >
        <div>
          <div
            style={{
              fontSize: '10px',
              fontWeight: 'bold',
              textTransform: 'uppercase',
              color: '#666',
              marginBottom: '4px',
            }}
          >
            Bill To
          </div>
          <div style={{ fontSize: '14px', fontWeight: 'bold' }}>{patientName}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {invoice.issueDate && (
            <div style={{ marginBottom: '4px' }}>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  color: '#666',
                }}
              >
                Issued:{' '}
              </span>
              <span>{format(new Date(invoice.issueDate), 'MMM d, yyyy')}</span>
            </div>
          )}
          {invoice.dueDate && (
            <div>
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 'bold',
                  textTransform: 'uppercase',
                  color: '#666',
                }}
              >
                Due:{' '}
              </span>
              <span>{format(new Date(invoice.dueDate), 'MMM d, yyyy')}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Line items ──────────────────────────────────────────────── */}
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '12px',
          marginBottom: '16px',
        }}
      >
        <thead>
          <tr style={{ borderBottom: '1px solid #000' }}>
            <th
              style={{
                textAlign: 'left',
                padding: '8px 4px',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                fontSize: '10px',
              }}
            >
              Description
            </th>
            <th
              style={{
                textAlign: 'right',
                padding: '8px 4px',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                fontSize: '10px',
                width: '60px',
              }}
            >
              Qty
            </th>
            <th
              style={{
                textAlign: 'right',
                padding: '8px 4px',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                fontSize: '10px',
                width: '90px',
              }}
            >
              Unit
            </th>
            <th
              style={{
                textAlign: 'right',
                padding: '8px 4px',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                fontSize: '10px',
                width: '70px',
              }}
            >
              Disc
            </th>
            <th
              style={{
                textAlign: 'right',
                padding: '8px 4px',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                fontSize: '10px',
                width: '100px',
              }}
            >
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ padding: '16px', textAlign: 'center', color: '#888' }}>
                No line items.
              </td>
            </tr>
          ) : (
            lines.map((l) => (
              <tr key={l.id} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '8px 4px' }}>{l.description}</td>
                <td
                  style={{
                    padding: '8px 4px',
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {Number(l.quantity)}
                </td>
                <td
                  style={{
                    padding: '8px 4px',
                    textAlign: 'right',
                    fontFamily: 'monospace',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {ghs(Number(l.unitPrice))}
                </td>
                <td
                  style={{
                    padding: '8px 4px',
                    textAlign: 'right',
                    fontFamily: 'monospace',
                    fontVariantNumeric: 'tabular-nums',
                    color: Number(l.discountAmount) > 0 ? '#059669' : '#999',
                  }}
                >
                  {Number(l.discountAmount) > 0 ? `−${ghs(Number(l.discountAmount))}` : '—'}
                </td>
                <td
                  style={{
                    padding: '8px 4px',
                    textAlign: 'right',
                    fontFamily: 'monospace',
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 'bold',
                  }}
                >
                  {ghs(Number(l.lineTotal))}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* ── Totals ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ width: '260px' }}>
          {Number(invoice.discountTotal) > 0 && (
            <>
              <TotalRow label="Subtotal" value={ghs(Number(invoice.subtotal))} />
              <TotalRow
                label="Discount"
                value={`−${ghs(Number(invoice.discountTotal))}`}
                color="#059669"
              />
            </>
          )}
          <TotalRow label="Total" value={ghs(Number(invoice.total))} bold />
          <TotalRow label="Paid" value={ghs(Number(invoice.total) - Number(invoice.balance))} />
          <div
            style={{
              borderTop: '2px solid #000',
              marginTop: '4px',
              paddingTop: '8px',
            }}
          >
            <TotalRow label="Balance Due" value={ghs(Number(invoice.balance))} bold big />
          </div>
        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <div
        style={{
          marginTop: '40px',
          paddingTop: '16px',
          borderTop: '1px dashed #999',
          textAlign: 'center',
          fontSize: '11px',
          color: '#555',
        }}
      >
        <div style={{ fontWeight: 'bold', color: '#000' }}>Thank you!</div>
      </div>
    </div>
  )
})

function TotalRow({
  label,
  value,
  bold = false,
  big = false,
  color,
}: {
  label: string
  value: string
  bold?: boolean
  big?: boolean
  color?: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '4px 0',
        fontSize: big ? '16px' : '13px',
        fontWeight: bold ? 'bold' : 'normal',
        color,
      }}
    >
      <span>{label}</span>
      <span style={{ fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}
