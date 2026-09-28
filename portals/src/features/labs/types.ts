export type VendorType = 'internal' | 'external'
export type LabCaseStatus =
  | 'draft'
  | 'sent'
  | 'in_progress'
  | 'delayed'
  | 'received'
  | 'ready_for_insertion'
  | 'inserted'
  | 'cancelled'

export type LabUnitType = 'per_tooth' | 'per_arch' | 'per_case'

export interface LabServiceCategory {
  id: string
  name: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface LabBaseService {
  id: string
  name: string
  categoryId: string | null
  unitType: LabUnitType
  standardTurnaroundDays: number | null
  notes: string | null
  isActive: boolean
  category?: LabServiceCategory | null
}

/** Case-level domain — different from vendor.type. */
export type LabCaseDomain = 'internal' | 'external'

export interface LabVendor {
  id: string
  name: string
  type: VendorType
  contactEmail: string | null
  contactPhone: string | null
  address: string | null
  notes: string | null
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface LabVendorServiceExpressOption {
  id: string
  vendorServiceId: string
  label: string
  cost: number
  turnaroundDays: number
  isActive: boolean
  sortOrder: number | null
}

/** A vendor's extension of a base service: their price + turnaround. */
export interface LabVendorService {
  id: string
  vendorId: string
  baseServiceId: string
  regularCost: number | null
  clinicPrice: number | null
  regularTurnaroundDays: number | null
  notes: string | null
  active: boolean
  baseService?: LabBaseService
  expressOptions?: LabVendorServiceExpressOption[]
}

/** Response shape from GET /api/labs/service-catalog. */
export interface ServiceCatalogEntry {
  baseServiceId: string
  name: string
  unitType: LabUnitType
  /** Application type (0171) — drives the case-form unit layout. */
  scope: { name: string; displayName: string; quantityMode: 'single' | 'multi' } | null
  standardTurnaroundDays: number | null
  category: { id: string; name: string } | null
  offerings: Array<{
    serviceId: string
    vendorId: string
    vendorName: string
    vendorType: VendorType
    regularCost: number
    clinicPrice: number | null
    regularTurnaroundDays: number
    expressOptions: Array<{
      id: string
      label: string
      cost: number
      turnaroundDays: number
    }>
  }>
}

export interface LabCasePhoto {
  id: string
  labCaseId: string
  photoUrl: string
  photoType: 'prep' | 'shade' | 'impression' | 'final' | 'other'
  notes: string | null
  uploadedById: string | null
  uploadedAt: string
}

export interface LabCaseUnit {
  label: string
  cost: number
}

export interface LabCase {
  id: string
  caseNumber: string
  /** Null for external (referring-doctor-billed) cases. */
  patientId: string | null
  vendorId: string
  serviceId: string | null
  serviceName: string
  status: LabCaseStatus
  domain: LabCaseDomain
  /** When set, the receptionist picked an express tier from the vendor-service's options. */
  expressOptionId: string | null
  /** Per-unit cost breakdown. Sum equals labCost. */
  units: LabCaseUnit[]
  /** What we owe the lab vendor (sum of units[].cost). */
  labCost: number | null
  /** Internal: what we charge the patient. External: equals labCost (no markup). */
  patientCharge: number | null
  /** Set when cumulative payments cover labCost, or by the 2-week lazy fallback. */
  expenseReadyAt: string | null
  /** External cases: FK to specialists.id of the referring doctor. */
  referringDoctorId: string | null
  /** External cases: free-text patient name (no patient row created). */
  externalPatientName: string | null
  sentAt: string | null
  expectedReturn: string | null
  receivedAt: string | null
  insertedAt: string | null
  /** @deprecated use labCost — kept for backwards compat with older readers. */
  cost: number | null
  /** Our doctor responsible for the case clinically (specialists.id). */
  assignedDoctorId: string | null
  assignedTechnicianId: string | null
  /** Populated when status='delayed'. */
  delayReason: string | null
  externalExpenseId: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  patient?: { id: string; name: string; patientId: string | null } | null
  vendor?: { id: string; name: string; type: VendorType }
  photos?: LabCasePhoto[]
}

export const STATUS_LABELS: Record<LabCaseStatus, string> = {
  draft: 'Ordered',
  sent: 'Dispatched',
  in_progress: 'In Progress',
  delayed: 'Delayed',
  received: 'Shipped',
  ready_for_insertion: 'Ready',
  inserted: 'Inserted',
  cancelled: 'Cancelled',
}

export const STATUS_VARIANT: Record<
  LabCaseStatus,
  'default' | 'secondary' | 'success' | 'destructive' | 'outline' | 'warning'
> = {
  draft: 'outline',
  sent: 'secondary',
  in_progress: 'warning',
  delayed: 'destructive',
  received: 'secondary',
  ready_for_insertion: 'default',
  inserted: 'success',
  cancelled: 'destructive',
}

export const UNIT_TYPE_LABELS: Record<LabUnitType, string> = {
  per_tooth: 'Per tooth',
  per_arch: 'Per arch',
  per_case: 'Per case',
}
