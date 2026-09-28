// Supplier shapes returned by `/api/suppliers` (backend/src/routes/suppliers.ts).
//
// These replace the `MockSupplier` interface that used to live in
// `features/store/__mock__/suppliers.ts`. That mock was never wired to
// anything — the list page, the detail page and both sheets have always read
// live data — but its *shape* outlived it: `supplier-detail.tsx` kept a
// `toMockShape()` adapter that bent the real API row into the mock's fields,
// inventing three of them in the process (`category` was hardcoded to
// 'Other', `contactName` was the email address, `lastOrderAt` was always
// null). The adapter is gone and these are the real columns.

export interface Supplier {
  id: string
  name: string
  contactEmail: string | null
  contactPhone: string | null
  address: string | null
  paymentTerms: string | null
  notes: string | null
  active: boolean
  tin: string | null
  defaultPaymentTermsDays: number | null
  createdAt: string
  updatedAt: string
}

/**
 * `GET /api/suppliers/:id` additionally derives the date of the supplier's most
 * recent non-void bill. Null when they have never been billed. The list
 * endpoint does not compute it.
 */
export interface SupplierDetail extends Supplier {
  lastOrderAt: string | null
}
