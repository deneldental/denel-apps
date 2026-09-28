// Shared types for the patient ledger tab.
// Shape matches GET /api/patients/:patientId/ledger response.

export interface InvoiceSegment {
  id: string
  invoiceNumber: string
  amount: number
  paid: boolean
  paidAt: string | null
  color: string
}

export type LedgerEntryKind = 'payment' | 'charge' | 'adjustment' | 'wallet_credit' | 'wallet_debit'
export type LedgerReferenceSource = 'payment' | 'invoice' | 'wallet_transaction'

export interface LedgerEntry {
  id: string
  at: string
  kind: LedgerEntryKind
  description: string
  amount: number
  balanceAfter: number
  reference: string | null
  referenceId: string | null
  referenceSource: LedgerReferenceSource | null
}

export interface WalletCreditTransaction {
  id: string
  /** Active/remaining portion of this top-up — what still contributes to the
   *  current wallet balance after FIFO consumption by debits. */
  amount: number
  /** Original credited amount, before any debits were drawn against it. Equal
   *  to `amount` when the lot has not been touched. */
  originalAmount: number
  description: string
  sourceType: string
  createdAt: string
}

export interface OutstandingInvoice {
  id: string
  invoiceNumber: string
  amount: number
  paidAmount: number
  balance: number
  status: string
  dueDate: string | null
  description: string | null
  type: string
  createdAt: string
}

export interface CompletedPaymentAllocation {
  invoiceNumber: string
  amountApplied: number
  status: string | null
}

export interface CompletedPayment {
  id: string
  paymentNumber?: string | null
  /** Shared by every sibling row created from one split (multi-method)
   *  payment — the receipt endpoint already merges these; the ledger table
   *  groups them into a single row too. */
  paymentGroupId?: string | null
  amount: number
  allocatedAmount?: number
  unallocatedAmount?: number
  method: string
  description: string | null
  status: string
  isRefund: boolean
  createdAt: string
  allocatedInvoices?: CompletedPaymentAllocation[]
}

export interface PatientLedger {
  patientName?: string
  walletBalance: number
  walletCreditTransactions: WalletCreditTransaction[]
  outstandingBalance: number
  outstandingInvoices: OutstandingInvoice[]
  completedPayments: CompletedPayment[]
  planTotal: number
  invoices: InvoiceSegment[]
  ledgerEntries: LedgerEntry[]
}
