// Cross-cutting finance types shared between backend and frontend apps.
//
// Money values cross the wire as DECIMAL strings (the canonical form emitted
// by `Money.toDbValue`). Construct a Money on either side with
// `Money.fromString(value)`.

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'

export type NormalBalance = 'debit' | 'credit'

export type ControlPartyType = 'patient' | 'supplier' | 'specialist' | 'insurance'

export type Account = {
  id: string
  code: string
  name: string
  type: AccountType
  subtype: string | null
  parentId: string | null
  isControl: boolean
  controlPartyType: ControlPartyType | null
  normalBalance: NormalBalance
  isActive: boolean
  description: string | null
  createdAt: string
  updatedAt: string
}

export type PeriodStatus = 'open' | 'closed'

export type Period = {
  id: string
  name: string
  startDate: string
  endDate: string
  status: PeriodStatus
  closedAt: string | null
  closedBy: string | null
}

export type SourceDocType =
  | 'invoice'
  | 'payment'
  | 'credit_note'
  | 'refund'
  | 'bill'
  | 'specialist_payout'
  | 'write_off'
  | 'manual'
  | 'reversal'
  | 'depreciation'
  | 'period_close'

export type JournalLine = {
  id: string
  entryId: string
  lineNumber: number
  accountId: string
  debit: string
  credit: string
  partyType: ControlPartyType | null
  partyId: string | null
  description: string | null
}

export type JournalEntry = {
  id: string
  entryNumber: string
  entryDate: string
  postedAt: string
  periodId: string
  description: string | null
  sourceDocType: SourceDocType
  sourceDocId: string | null
  isReversal: boolean
  reversesEntryId: string | null
  createdBy: string
  createdAt: string
  lines?: JournalLine[]
}

export type JournalLineInput = {
  accountId: string
  debit?: string
  credit?: string
  partyType?: ControlPartyType | null
  partyId?: string | null
  description?: string | null
}

export type ReconciliationDrift = {
  accountCode: string
  accountName: string
  glBalance: string
  subledgerBalance: string
  drift: string
}

export type ReconciliationReport = {
  ranAt: string
  drifts: ReconciliationDrift[]
  ok: boolean
}

// ── Phase 2 — Invoices, lines, specialists, patient AR ──────────────────────

export type InvoiceStatus =
  | 'draft'
  | 'issued'
  | 'partially_paid'
  | 'paid'
  | 'void'
  | 'written_off'
  // Legacy enum values from the pre-Phase-2 model. Translated to the spec
  // values via `translateInvoiceStatus` for any consumer that still reads them.
  | 'pending'
  | 'partial'
  | 'waived'
  | 'overdue'

export type DiscountType = 'none' | 'percent' | 'amount'
export type SurchargeType = 'none' | 'percent' | 'amount'

export type InvoiceLine = {
  id: string
  invoiceId: string
  lineNumber: number
  treatmentId: string | null
  description: string
  quantity: string
  unitPrice: string
  surchargeType: SurchargeType
  surchargeValue: string
  surchargeAmount: string
  surchargeAuthorizedBy: string | null
  discountType: DiscountType
  discountValue: string
  discountAmount: string
  discountReason: string | null
  discountAuthorizedBy: string | null
  lineSubtotal: string
  lineAfterDiscount: string
  taxRate: string
  taxAmount: string
  lineTotal: string
  revenueAccountId: string
  providerId: string | null
  specialistId: string | null
  commissionRate: string | null
}

export type InvoiceLineInput = {
  treatmentId?: string | null
  description: string
  quantity?: number | string
  unitPrice: number | string
  surchargeType?: SurchargeType
  surchargeValue?: number | string
  surchargeAuthorizedBy?: string | null
  discountType?: DiscountType
  discountValue?: number | string
  discountReason?: string | null
  discountAuthorizedBy?: string | null
  taxRate?: number | string
  revenueAccountId: string
  providerId?: string | null
  specialistId?: string | null
  commissionRate?: number | string | null
}

export type Specialist = {
  id: string
  name: string
  contactEmail: string | null
  contactPhone: string | null
  tin: string | null
  defaultCommissionRate: string
  withholdingTaxRate: string
  payoutMethod: string | null
  payoutAccountDetails: Record<string, unknown> | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type PatientBalance = {
  patientId: string
  arBalance: string
  depositBalance: string
  updatedAt: string
}

// ── Phase 3 — Payments, allocations, refunds ────────────────────────────────

export type PaymentMethod =
  | 'cash'
  | 'card'
  | 'insurance'
  | 'transfer'
  | 'momo'
  | 'bank_transfer'
  | 'cheque'

export type PaymentDirection = 'incoming' | 'outgoing'

export type PaymentPartyType = 'patient' | 'supplier' | 'specialist'

export type PaymentStatus = 'draft' | 'posted' | 'reversed'

export type AllocationTargetType = 'invoice' | 'bill'

export type Payment = {
  id: string
  paymentNumber: string | null
  patientId: string | null
  paymentDate: string | null
  method: PaymentMethod
  direction: PaymentDirection
  partyType: PaymentPartyType
  partyId: string | null
  channelAccountId: string | null
  amount: string
  allocatedAmount: string
  unallocatedAmount: string
  externalReference: string | null
  description: string | null
  status: PaymentStatus
  journalEntryId: string | null
  postedAt: string | null
  reversedAt: string | null
  reversalJournalEntryId: string | null
  createdAt: string
}

export type PaymentAllocation = {
  id: string
  paymentId: string
  targetType: AllocationTargetType
  targetId: string
  amount: string
  allocatedAt: string
  allocatedBy: string | null
  notes: string | null
}

export type PaymentAllocationInput = {
  targetType: AllocationTargetType
  targetId: string
  amount: number | string
  notes?: string | null
}

// ── Phase 4 — Credit Notes, refunds, write-offs ─────────────────────────────

export type CreditNoteReason = 'discount' | 'correction' | 'cancellation' | 'goodwill' | 'write_off'

export type CreditNoteStatus = 'draft' | 'posted' | 'void'

export type CreditNote = {
  id: string
  creditNoteNumber: string
  invoiceId: string
  patientId: string
  issueDate: string
  reason: CreditNoteReason
  reasonNotes: string | null
  amount: string
  status: CreditNoteStatus
  journalEntryId: string | null
  approvedBy: string | null
  createdBy: string
  postedAt: string | null
  voidedAt: string | null
  voidedBy: string | null
  reversalJournalEntryId: string | null
  createdAt: string
  updatedAt: string
}

export type CreditNoteLine = {
  id: string
  creditNoteId: string
  invoiceLineId: string | null
  amount: string
  revenueAccountId: string
  description: string | null
}

export type CreditNoteLineInput = {
  invoiceLineId?: string | null
  amount: number | string
  revenueAccountId: string
  description?: string | null
}

// ── Phase 5 — Payment Plans (master invoice + schedule items) ──────────────

export type PaymentPlanScheduleType = 'fixed' | 'flexible'
export type PaymentPlanInstallmentPeriod = 'weekly' | 'biweekly' | 'monthly'
// Legacy status values kept alongside the spec's recommended set so old rows
// still resolve. Read code should treat 'activated' as 'active'.
export type PaymentPlanStatus =
  | 'active'
  | 'completed'
  | 'defaulted'
  | 'cancelled'
  | 'activated'
  | 'overdue'
  | 'paused'
  | 'outstanding'

export type PaymentPlanScheduleItemStatus = 'pending' | 'paid' | 'partial' | 'overdue' | 'waived'

export type PaymentPlanScheduleItem = {
  id: string
  paymentPlanId: string
  sequence: number
  expectedDate: string
  expectedAmount: string
  status: PaymentPlanScheduleItemStatus
  amountReceived: string
}

export function translatePlanStatus(
  legacy: string
): 'active' | 'completed' | 'defaulted' | 'cancelled' | 'paused' {
  switch (legacy) {
    case 'activated':
    case 'outstanding':
    case 'overdue':
    case 'active':
      return 'active'
    // M37: `paused` is its own state — a paused plan is not a cancelled one.
    // Collapsing it lost the distinction the clinic relies on.
    case 'paused':
      return 'paused'
    case 'completed':
      return 'completed'
    case 'defaulted':
      return 'defaulted'
    case 'cancelled':
      return 'cancelled'
    default:
      // M37: throw on a genuinely unknown value rather than `as any`-casting
      // garbage through — a silent bad status is how the books drift.
      throw new Error(`translatePlanStatus: unknown plan status "${legacy}"`)
  }
}

// ── Phase 6 — Supplier AP & Bills ───────────────────────────────────────────

export type BillStatus = 'draft' | 'posted' | 'partially_paid' | 'paid' | 'void'

export type Bill = {
  id: string
  billNumber: string
  supplierBillRef: string | null
  supplierId: string
  issueDate: string
  dueDate: string
  subtotal: string
  taxTotal: string
  total: string
  amountPaid: string
  balance: string
  status: BillStatus
  journalEntryId: string | null
  notes: string | null
  createdBy: string
  postedAt: string | null
  voidedAt: string | null
  createdAt: string
  updatedAt: string
}

export type BillLine = {
  id: string
  billId: string
  description: string
  quantity: string
  unitPrice: string
  taxRate: string
  taxAmount: string
  lineTotal: string
  expenseAccountId: string
}

export type BillLineInput = {
  description: string
  quantity?: number | string
  unitPrice: number | string
  taxRate?: number | string
  expenseAccountId: string
}

export type SupplierBalance = {
  supplierId: string
  apBalance: string
  updatedAt: string
}

// ── Phase 7 — Specialist Commissions ────────────────────────────────────────

export type CommissionStatus = 'accrued' | 'payable' | 'paid' | 'reversed'
export type PayoutStatus = 'draft' | 'posted' | 'paid'

export type SpecialistCommission = {
  id: string
  specialistId: string
  invoiceId: string
  invoiceLineId: string
  grossAmount: string
  commissionRate: string
  commissionAmount: string
  payableAmount: string
  status: CommissionStatus
  accruedAt: string
  becamePayableAt: string | null
  paidAt: string | null
  payoutId: string | null
}

export type SpecialistPayout = {
  id: string
  payoutNumber: string
  specialistId: string
  periodStart: string
  periodEnd: string
  grossAmount: string
  withholdingTaxAmount: string
  netAmount: string
  status: PayoutStatus
  paymentId: string | null
  journalEntryId: string | null
  createdBy: string
  postedAt: string | null
  paidAt: string | null
  createdAt: string
  updatedAt: string
}

export type SpecialistBalance = {
  specialistId: string
  accruedAmount: string
  payableAmount: string
  paidAmount: string
  updatedAt: string
}

// ── Phase 9 — Deferred Revenue ──────────────────────────────────────────────

export type DeferredRevenueEventTrigger = 'manual' | 'milestone' | 'period_close'

export type DeferredRevenueEvent = {
  id: string
  invoiceLineId: string
  amount: string
  trigger: DeferredRevenueEventTrigger
  milestoneRef: string | null
  recognizedAt: string
  recognizedBy: string
  journalEntryId: string | null
  notes: string | null
}

export type DeferredRevenueSummary = {
  invoiceLineId: string
  invoiceId: string
  invoiceNumber: string
  description: string
  lineAfterDiscount: string
  recognizedAmount: string
  remainingDeferred: string
  revenueAccountCode: string
  revenueAccountName: string
}

export function translatePaymentStatus(legacy: string): PaymentStatus {
  switch (legacy) {
    case 'completed':
      return 'posted'
    case 'refunded':
      return 'reversed'
    case 'pending':
    case 'failed':
      return 'draft'
    // Already-canonical values pass through unchanged.
    case 'draft':
    case 'posted':
    case 'reversed':
      return legacy
    default:
      // M37: throw on unknown rather than casting garbage through.
      throw new Error(`translatePaymentStatus: unknown payment status "${legacy}"`)
  }
}

export function translateInvoiceStatus(legacy: string): InvoiceStatus {
  switch (legacy) {
    case 'pending':
      return 'issued'
    case 'partial':
      return 'partially_paid'
    case 'waived':
      return 'written_off'
    // M37: `overdue` is not a stored status — it is a computed flag (due_date
    // vs today) layered on top of `issued`. Translating it to `issued` here is
    // intentional; callers derive "overdue" from the due date, they don't read
    // it off `status`.
    case 'overdue':
      return 'issued'
    // Already-canonical values pass through unchanged.
    case 'draft':
    case 'issued':
    case 'partially_paid':
    case 'paid':
    case 'void':
    case 'written_off':
      return legacy
    default:
      // M37: throw on unknown rather than casting garbage through.
      throw new Error(`translateInvoiceStatus: unknown invoice status "${legacy}"`)
  }
}
