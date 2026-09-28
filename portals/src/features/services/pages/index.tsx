import { cedisToCents } from '@denel/utils'
import type { ColumnDef } from '@tanstack/react-table'
import {
  AlertTriangle,
  BadgeCheck,
  Ban,
  CheckCircle2,
  Clock,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ApplicationScopeTab } from '@/features/services/components/application-scope-tab'
import { ServiceCsvControls } from '@/features/services/components/service-csv-controls'
import { ServiceDoctorsSection } from '@/features/services/components/service-doctors-section'
import { ServicePricingMatrix } from '@/features/services/components/service-pricing-matrix'
import { ToothClassSection } from '@/features/services/components/tooth-class-section'
import { getLabBaseServices, type LabBaseService } from '@/lib/actions/lab-base-services'
import {
  type ApplicationScope,
  approveServiceRequest,
  createService,
  deleteService,
  getApplicationScopes,
  getPendingServices,
  getSalesTaxes,
  getServices,
  rejectServiceRequest,
  restoreService,
  type SalesTax,
  updateService,
} from '@/lib/actions/services'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { DataTable } from '@/shared/components/data-table/data-table'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Checkbox } from '@/shared/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Switch } from '@/shared/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { useConfirm } from '@/shared/hooks/use-confirm'
import { usePermissions } from '@/shared/hooks/use-permissions'
import { formatAmount } from '@/shared/utils/currency'

// ── Types ─────────────────────────────────────────────────────────────────────

type ServiceCategory = 'clinic' | 'xray' | 'lab' | 'insurance'
/** The page's real tabs. Categories are chosen per-service in the form, not by tab. */
type TabValue = 'all' | 'scopes' | 'tooth-classes' | 'pending'

interface ServiceRow {
  id: string
  category: ServiceCategory
  name: string
  /** Internal, clinic-defined billing code (SVC-000123). Null on legacy rows. */
  serviceCode: string | null
  amount: number
  currency: string
  isActive: boolean
  discountEligible: boolean
  taxStatus: 'exempt' | 'standard' | 'zero_rated'
  icd10Code: string | null
  /** Approval state, not "sellable right now" (that's `isActive`). A rejected
   *  proposal keeps its row but leaves the approval queue. */
  status: 'active' | 'pending' | 'rejected'
  treatmentTypeId: string | null
  scopeId: string | null
  taxIds: string[]
  tags: string[]
  priceRangeEnabled: boolean
  variantsEnabled: boolean
  priceMin: number | null
  priceMax: number | null
  xrayTypeId: string | null
  labServiceId: string | null
  labBaseServiceId: string | null
  deletedAt: string | null
  insuranceCompanyId: string | null
  cdtCode: string | null
  durationMinutes: number | null
  effectiveFrom: string | null
  costPrice: number | null
}

interface ChangeRequestRow {
  id: string
  /** Null when the request targets a lab base service instead. */
  serviceId: string | null
  labBaseServiceId: string | null
  /** Which catalog the request targets — resolved server-side. */
  targetKind: 'service' | 'lab_base_service'
  /** Name of the targeted service, resolved server-side across both catalogs. */
  targetName: string | null
  requestType: 'update' | 'deactivate' | 'activate'
  /** Snapshot of the edited fields as they were when the request was raised.
   *  Open-ended: the backend records every field the requester actually
   *  touched, not just amount/isActive. */
  currentValue: Record<string, unknown>
  requestedValue: Record<string, unknown>
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
}

// ─────────────────────────────────────────────────────────────────────────────

function formatGHS(amount: number) {
  return `GHS ${formatAmount(amount)}`
}

/**
 * Seed a cedis-denominated text input from a stored pesewa (cents) value.
 * Plain `n / 100` so `Number()` round-trips it — `formatAmount` groups with
 * commas and would break the parse. The cents boundary is re-crossed on save
 * via `cedisToCents`.
 */
function centsToCedisInput(cents: number): string {
  return String(cents / 100)
}

// ── Change-request diff rendering ─────────────────────────────────────────────
// A request can now carry any editable field, so the review table renders the
// real per-field before/after instead of assuming amount/isActive.

const CHANGE_FIELD_LABELS: Record<string, string> = {
  amount: 'Amount',
  isActive: 'Active',
  name: 'Name',
  category: 'Category',
  currency: 'Currency',
  discountEligible: 'Discount',
  taxStatus: 'Tax status',
  taxIds: 'Taxes',
  tags: 'Tags',
  scopeId: 'Application type',
  priceMin: 'Min price',
  priceMax: 'Max price',
  priceRangeEnabled: 'Price range',
  variantsEnabled: 'Variants',
  serviceCode: 'Code',
  icd10Code: 'ICD-10',
  cdtCode: 'CDT',
  durationMinutes: 'Duration (min)',
  effectiveFrom: 'Effective from',
  costPrice: 'Cost price',
  treatmentTypeId: 'Treatment type',
  xrayTypeId: 'X-ray type',
  labServiceId: 'Lab service',
  insuranceCompanyId: 'Insurer',
  // Lab base service requests share this table.
  standardTurnaroundDays: 'Turnaround (days)',
}

const MONEY_FIELDS = new Set(['amount', 'priceMin', 'priceMax', 'costPrice'])

function formatChangeValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) {
    if (value.length === 0) return 'none'
    // Tags are human-readable; taxIds and friends are uuids — count those.
    return field === 'tags' ? value.join(', ') : `${value.length} selected`
  }
  if (MONEY_FIELDS.has(field) && typeof value === 'number') return formatGHS(value)
  return String(value)
}

/** Fields whose requested value actually differs from the recorded current one. */
function changedFields(row: ChangeRequestRow): string[] {
  const requested = row.requestedValue ?? {}
  const current = row.currentValue ?? {}
  return Object.keys(requested).filter(
    (k) => JSON.stringify(requested[k] ?? null) !== JSON.stringify(current[k] ?? null)
  )
}

// ── Service create/edit dialog ────────────────────────────────────────────────

/**
 * Selectable service types. `insurance` is deliberately absent — it remains a
 * valid category server-side (and still backs
 * /api/services/lookup?insuranceCompanyId=), but insurance entries are created
 * through the insurance module rather than this form.
 */
const SERVICE_CATEGORIES: { value: ServiceCategory; label: string }[] = [
  { value: 'clinic', label: 'Clinic' },
  { value: 'xray', label: 'X-ray' },
  { value: 'lab', label: 'Lab' },
]

/** Covers every stored category, including ones the picker no longer offers. */
const CATEGORY_LABELS: Record<ServiceCategory, string> = {
  clinic: 'Clinic',
  xray: 'X-ray',
  lab: 'Lab',
  insurance: 'Insurance',
}

function categoryLabel(value: ServiceCategory) {
  return CATEGORY_LABELS[value] ?? value
}

interface ServiceFormProps {
  /** Seed value for a new service. Edits seed from `existing.category` instead. */
  category: ServiceCategory
  existing?: ServiceRow | null
  isAdmin: boolean
  onClose: () => void
  onSaved: () => void
}

function ServiceFormDialog({
  category: initialCategory,
  existing,
  isAdmin,
  onClose,
  onSaved,
}: ServiceFormProps) {
  const [step, setStep] = useState(1)
  const [category, setCategory] = useState<ServiceCategory>(existing?.category ?? initialCategory)
  const [labBaseServiceId, setLabBaseServiceId] = useState<string>(existing?.labBaseServiceId ?? '')
  const [name, setName] = useState(existing?.name ?? '')
  // Inputs are cedis; the columns are integer pesewas (cents). Seed converts
  // down, `saveDetails` converts back up via `cedisToCents`.
  const [amount, setAmount] = useState(existing ? centsToCedisInput(existing.amount) : '')
  const [isActive, setIsActive] = useState(existing?.isActive ?? true)
  const [discountEligible, setDiscountEligible] = useState(existing?.discountEligible ?? true)
  const [scopeId, setScopeId] = useState<string>(existing?.scopeId ?? '')
  const [taxIds, setTaxIds] = useState<string[]>(existing?.taxIds ?? [])
  // Clinical work is exempt in the common case, so the form defaults there and
  // only reveals the tax picker when the user opts out. An existing service is
  // exempt exactly when it carries no taxes.
  const [taxExempt, setTaxExempt] = useState(!(existing?.taxIds?.length ?? 0))
  // Tags are no longer editable here (the Category field replaced them), but an
  // existing row's tags are echoed back on save so editing never wipes them.
  const tags = existing?.tags ?? []
  const [saving, setSaving] = useState(false)
  // Admin create keeps the sheet open so the matrix + doctor steps (which need
  // the new service's id) become available.
  const [saved, setSaved] = useState<{ id: string } | null>(null)
  const current = existing ?? saved

  // Lab base templates are only needed once the user picks Lab, so the query
  // is deferred (enabled) rather than fired on every service form open. Same
  // key literal the Labs → Base Services tab uses for the same list.
  const labBaseServicesQuery = useApiQuery<LabBaseService[]>(
    ['lab-base-services'] as const,
    () => getLabBaseServices(),
    { enabled: category === 'lab' }
  )
  const labBaseServices = useMemo(
    () => (labBaseServicesQuery.data ?? []).filter((b) => b.isActive),
    [labBaseServicesQuery.data]
  )

  const scopesQuery = useApiQuery<ApplicationScope[]>(queryKeys.services.scopes(), () =>
    getApplicationScopes()
  )
  const scopes = scopesQuery.data ?? []

  const taxesQuery = useApiQuery<SalesTax[]>(queryKeys.services.salesTaxes(), () => getSalesTaxes())
  const taxes = taxesQuery.data ?? []

  const effectiveTaxPct =
    taxes.filter((t) => taxIds.includes(t.id)).reduce((s, t) => s + Number(t.rate), 0) * 100

  // Admin, non-insurance services get the full 3-step wizard; others are 1 step.
  const canConfigure = isAdmin && category !== 'insurance'
  const stepLabels = canConfigure
    ? ['Service details', 'Price matrix', 'Assign doctors']
    : ['Service details']

  async function saveDetails(): Promise<boolean> {
    if (!name.trim()) {
      toast.error('Service name is required.')
      return false
    }
    const p = parseFloat(amount)
    if (amount.trim() === '' || Number.isNaN(p) || p < 0) {
      toast.error('Enter a valid amount.')
      return false
    }
    const amt = p
    setSaving(true)
    // `amt` is cedis from the form. The API stores integer pesewas (cents), so
    // convert here — this is the write boundary, the same `Math.round(x * 100)`
    // every other money form already does.
    const payload: Record<string, unknown> = {
      category,
      name: name.trim(),
      amount: cedisToCents(amt),
      currency: 'GHS',
      scopeId: scopeId || null,
      taxIds: taxExempt ? [] : taxIds,
      taxStatus: !taxExempt && taxIds.length ? 'standard' : 'exempt',
      // The old guided price-range feature (min/max) is retired (0215) in
      // favour of per-line surcharge/discount at estimate time — always off
      // going forward so an admin editing an old range-enabled service clears
      // it rather than leaving a stale, now-inert flag.
      priceRangeEnabled: false,
      priceMin: null,
      priceMax: null,
      isActive,
      discountEligible,
      tags,
      // Cleared when the category moves away from Lab, so a re-categorised
      // service never keeps a dangling base-template reference.
      labBaseServiceId: category === 'lab' && labBaseServiceId ? labBaseServiceId : null,
    }
    const target = existing ?? saved
    const res = target
      ? await updateService(target.id, payload)
      : await createService(payload as Parameters<typeof createService>[0])
    setSaving(false)
    if (!res.success) {
      toast.error(res.error || 'Failed to save service')
      return false
    }
    onSaved()
    if (!target) {
      if (!isAdmin) {
        toast.success(`Service "${name}" submitted for approval.`)
        onClose()
        return false
      }
      setSaved((res.data as { id: string }) ?? null)
    } else {
      toast.success(`Service "${name}" saved.`)
    }
    return true
  }

  async function handlePrimary() {
    if (stepLabels.length === 1) {
      const ok = await saveDetails()
      if (ok) onClose()
      return
    }
    if (step === 1) {
      const ok = await saveDetails()
      if (ok) setStep(2)
      return
    }
    if (step < stepLabels.length) setStep(step + 1)
    else onClose()
  }

  return (
    <SheetContent className="!w-full overflow-y-auto sm:!max-w-[640px]">
      <SheetHeader className="mb-2">
        <SheetTitle>
          {current ? 'Edit' : 'Create'} Service — {categoryLabel(category)}
        </SheetTitle>
      </SheetHeader>

      {stepLabels.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
          {stepLabels.map((label, i) => {
            const n = i + 1
            const active = n === step
            const done = n < step
            return (
              <div key={label} className="flex items-center gap-1.5">
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                    active
                      ? 'bg-primary text-primary-foreground'
                      : done
                        ? 'bg-primary/20 text-primary'
                        : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {n}
                </span>
                <span className={active ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
                {n < stepLabels.length && <span className="mx-1 text-muted-foreground">›</span>}
              </div>
            )
          })}
        </div>
      )}

      <div className="grid gap-4 py-2">
        {step === 1 && (
          <>
            {/* `services.category` holds ONE value, so these checkboxes are
                exclusive: ticking one clears the rest. Rendered as checkboxes
                rather than a select purely for scanability. Unticking the
                current one is a no-op — a service always has a category. */}
            <div className="space-y-2">
              <Label>Category</Label>
              <div className="flex flex-wrap gap-4">
                {SERVICE_CATEGORIES.map((c) => (
                  <div key={c.value} className="flex items-center space-x-2">
                    <Checkbox
                      id={`category-${c.value}`}
                      checked={category === c.value}
                      onCheckedChange={(checked) => {
                        if (checked) setCategory(c.value)
                      }}
                      disabled={saving}
                    />
                    <label
                      htmlFor={`category-${c.value}`}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      {c.label}
                    </label>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Which catalog this service belongs to. Insurance services skip the price matrix and
                doctor steps.
              </p>
            </div>

            {/* Lab services bill against a vendor-agnostic base template. The base
                catalogue is administered in Labs → Base Services; this only links
                to it. Per-vendor cost resolves later, when a lab case is placed. */}
            {category === 'lab' && (
              <div className="space-y-2">
                <Label>Lab base service</Label>
                <Select
                  value={labBaseServiceId || '__none'}
                  onValueChange={(v) => setLabBaseServiceId(v === '__none' ? '' : v)}
                  disabled={saving}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Which lab template this bills against" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Not linked</SelectItem>
                    {labBaseServices.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                        {b.standardTurnaroundDays != null ? ` · ${b.standardTurnaroundDays}d` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {labBaseServices.length === 0
                    ? 'No active base services yet — add them under Labs → Base Services.'
                    : 'The lab template this price bills against. Vendor cost is resolved per case, not here.'}
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Service name</Label>
              <Input
                placeholder="Display name for this service"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={saving}
              />
            </div>

            <div className="space-y-2">
              <Label>Amount (GHS)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={saving}
              />
            </div>

            <div className="space-y-2">
              <Label>Application type</Label>
              <Select
                value={scopeId || '__none'}
                onValueChange={(v) => setScopeId(v === '__none' ? '' : v)}
                disabled={saving}
              >
                <SelectTrigger>
                  <SelectValue placeholder="How this service is measured" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">None (flat price)</SelectItem>
                  {scopes.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.displayName}
                      {s.quantityMode === 'multi' ? ' · quantity' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The unit it bills against. Variants + tooth-class pricing are set in the next step.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Tax exempt</Label>
                  <p className="text-xs text-muted-foreground">
                    Most clinical work is exempt. Turn off to charge VAT/NHIL/GETFund.
                  </p>
                </div>
                <Switch checked={taxExempt} onCheckedChange={setTaxExempt} disabled={saving} />
              </div>
              {taxExempt ? null : taxes.length === 0 ? (
                <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                  No sales taxes configured — add VAT/NHIL/GETFund in Settings → Tax.
                </p>
              ) : (
                <div className="space-y-1.5 rounded-md border p-2.5">
                  {taxes.map((t) => (
                    <label key={t.id} className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={taxIds.includes(t.id)}
                        onCheckedChange={(v) =>
                          setTaxIds((prev) =>
                            v === true ? [...prev, t.id] : prev.filter((x) => x !== t.id)
                          )
                        }
                        disabled={saving}
                      />
                      {t.taxType}
                      <span className="text-muted-foreground">
                        {(Number(t.rate) * 100).toFixed(2)}%
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {taxExempt
                  ? 'Exempt — no tax on this service.'
                  : taxIds.length === 0
                    ? 'No taxes selected yet — this service will still save as exempt.'
                    : `Effective rate ${effectiveTaxPct.toFixed(2)}% (stacked).`}
              </p>
            </div>

            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch checked={isActive} onCheckedChange={setIsActive} disabled={saving} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Discount eligible</Label>
              <Switch
                checked={discountEligible}
                onCheckedChange={setDiscountEligible}
                disabled={saving}
              />
            </div>
            {!isAdmin && (
              <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Changes will be submitted for admin approval before going live.
              </p>
            )}
          </>
        )}

        {step === 2 && current && <ServicePricingMatrix serviceId={current.id} isAdmin={isAdmin} />}
        {step === 3 && current && (
          <ServiceDoctorsSection serviceId={current.id} isAdmin={isAdmin} />
        )}
      </div>

      <SheetFooter className="mt-2">
        {step > 1 ? (
          <Button variant="outline" onClick={() => setStep(step - 1)} disabled={saving}>
            Back
          </Button>
        ) : (
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        )}
        <Button onClick={handlePrimary} disabled={saving}>
          {saving
            ? 'Saving…'
            : stepLabels.length === 1
              ? isAdmin
                ? current
                  ? 'Save changes'
                  : 'Create service'
                : 'Submit for approval'
              : step < stepLabels.length
                ? step === 1
                  ? current
                    ? 'Save & next'
                    : 'Create & next'
                  : 'Next'
                : 'Done'}
        </Button>
      </SheetFooter>
    </SheetContent>
  )
}

// ── Services table ────────────────────────────────────────────────────────────

interface ServicesTableProps {
  data: ServiceRow[]
  isAdmin: boolean
  onEdit: (row: ServiceRow) => void
  onDelete: (row: ServiceRow) => void
  onRestore: (row: ServiceRow) => void
}

function ServicesTable({ data, isAdmin, onEdit, onDelete, onRestore }: ServicesTableProps) {
  const columns = useMemo<ColumnDef<ServiceRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Name" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span
              className={`font-medium text-sm ${
                row.original.deletedAt ? 'text-muted-foreground line-through' : ''
              }`}
            >
              {row.original.name}
            </span>
            {row.original.deletedAt && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Retired
              </Badge>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'serviceCode',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Code" />,
        cell: ({ row }) => (
          <span className="font-mono text-sm text-muted-foreground">
            {row.original.serviceCode ?? <span className="italic">—</span>}
          </span>
        ),
      },
      {
        accessorKey: 'category',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
        cell: ({ row }) => (
          <Badge variant="outline" className="text-[10px] capitalize">
            {row.original.category}
          </Badge>
        ),
      },
      {
        accessorKey: 'amount',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" />,
        cell: ({ row }) => (
          <span className="text-sm font-mono">{formatGHS(row.original.amount)}</span>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Approval" />,
        cell: ({ row }) => {
          if (row.original.status === 'active') {
            return (
              <Badge className="gap-1 bg-emerald-500 hover:bg-emerald-600">
                <CheckCircle2 className="h-3 w-3" />
                Approved
              </Badge>
            )
          }
          // A rejected proposal must not read as "Pending" — it has left the
          // approval queue and will never go live as-is.
          if (row.original.status === 'rejected') {
            return (
              <Badge variant="destructive" className="gap-1">
                <Ban className="h-3 w-3" />
                Rejected
              </Badge>
            )
          }
          return (
            <Badge variant="secondary" className="gap-1">
              <Clock className="h-3 w-3" />
              Pending
            </Badge>
          )
        },
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-8 w-8 p-0" onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {row.original.deletedAt ? (
                isAdmin && (
                  <DropdownMenuItem onClick={() => onRestore(row.original)}>
                    <RotateCcw className="mr-2 h-3.5 w-3.5" />
                    Restore
                  </DropdownMenuItem>
                )
              ) : (
                <>
                  <DropdownMenuItem onClick={() => onEdit(row.original)}>
                    <Pencil className="mr-2 h-3.5 w-3.5" />
                    {isAdmin ? 'Edit' : 'Request change'}
                  </DropdownMenuItem>
                  {isAdmin && (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => onDelete(row.original)}
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      Delete
                    </DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [isAdmin, onEdit, onDelete, onRestore]
  )

  return <DataTable columns={columns} data={data} />
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ServicesPage() {
  const { isAdmin, hasPermission, isLoading: permsLoading } = usePermissions()
  // Non-admins granted services:create (e.g. receptionist) can propose a new
  // service — it saves as 'pending' for an admin to approve, same as the
  // existing "propose a change" flow on an existing row.
  const canCreateService = hasPermission('services', 'create')
  const { confirm, confirmDialog } = useConfirm()
  /** Opt-in view of retired (soft-deleted) rows, with restore. */
  const [showRetired, setShowRetired] = useState(false)
  // Non-admins with services:update don't write directly — the backend turns
  // their PATCH into a change request — but they may still raise one.
  const [activeTab, setActiveTab] = useState<TabValue>('all')

  const [serviceDialogOpen, setServiceDialogOpen] = useState(false)
  const [editingService, setEditingService] = useState<ServiceRow | null>(null)

  const SERVICES_KEY = queryKeys.services.list({ includeDeleted: showRetired })
  const servicesQuery = useApiQuery<{ rows: ServiceRow[]; count: number; truncated: boolean }>(
    SERVICES_KEY,
    async () => {
      const res = await getServices({ includeDeleted: showRetired })
      if (!res.success || !res.data) return { success: false, error: res.error }
      const rows = res.data as ServiceRow[]
      return {
        success: true,
        data: { rows, count: res.count ?? rows.length, truncated: Boolean(res.truncated) },
      }
    },
    { enabled: !permsLoading }
  )
  const services = servicesQuery.data?.rows ?? []
  const catalogTotal = servicesQuery.data?.count ?? 0
  const catalogTruncated = servicesQuery.data?.truncated ?? false

  const changeRequestsQuery = useApiQuery<ChangeRequestRow[]>(
    queryKeys.services.changeRequests(),
    () => getPendingServices(),
    { enabled: !permsLoading && isAdmin }
  )
  const changeRequests = changeRequestsQuery.data ?? []

  const loading =
    permsLoading || servicesQuery.isLoading || (isAdmin && changeRequestsQuery.isLoading)

  useEffect(() => {
    if (servicesQuery.isError) {
      toast.error(servicesQuery.error.message || 'Failed to load services')
    }
  }, [servicesQuery.isError, servicesQuery.error])

  const deleteMutation = useApiMutation((id: string) => deleteService(id), {
    invalidates: [queryKeys.services.all],
  })
  const restoreMutation = useApiMutation((id: string) => restoreService(id), {
    invalidates: [queryKeys.services.all],
  })
  const approveRequestMutation = useApiMutation((id: string) => approveServiceRequest(id), {
    invalidates: [queryKeys.services.all],
  })
  const rejectRequestMutation = useApiMutation((id: string) => rejectServiceRequest(id), {
    invalidates: [queryKeys.services.all],
  })
  const setStatusMutation = useApiMutation(
    (vars: { id: string; status: string; isActive?: boolean }) =>
      updateService(vars.id, { status: vars.status, isActive: vars.isActive }),
    { invalidates: [queryKeys.services.all] }
  )

  const pendingCount = useMemo(
    () => services.filter((s) => s.status === 'pending').length + changeRequests.length,
    [services, changeRequests]
  )

  function handleEditService(row: ServiceRow) {
    setEditingService(row)
    setServiceDialogOpen(true)
  }

  async function handleDeleteService(row: ServiceRow) {
    const ok = await confirm({
      title: 'Delete service',
      description:
        'The service is retired from every list and picker. Invoices that already ' +
        'reference it keep working. This is refused if the service has been billed.',
      itemName: row.name,
    })
    if (!ok) return

    try {
      await deleteMutation.mutateAsync(row.id)
      toast.success(`"${row.name}" deleted.`)
    } catch (err) {
      // The 409 body carries the real reason (e.g. "…on 4 billed invoice lines").
      toast.error(err instanceof Error ? err.message : 'Failed to delete service')
    }
  }

  async function handleRestoreService(row: ServiceRow) {
    try {
      await restoreMutation.mutateAsync(row.id)
      // Restored INACTIVE on purpose — re-offering it is a separate decision.
      toast.success(`"${row.name}" restored. It is inactive until you enable it.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to restore service')
    }
  }

  function handleCreateService() {
    setEditingService(null)
    setServiceDialogOpen(true)
  }

  function refreshAll() {
    servicesQuery.refetch()
    if (isAdmin) changeRequestsQuery.refetch()
  }

  async function handleApproveRequest(id: string, name: string) {
    try {
      await approveRequestMutation.mutateAsync(id)
      toast.success(`"${name}" approved.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve')
    }
  }

  async function handleRejectRequest(id: string, name: string) {
    try {
      await rejectRequestMutation.mutateAsync(id)
      toast.success(`"${name}" rejected.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reject')
    }
  }

  // Filtered views per tab
  const pendingServices = useMemo(() => services.filter((s) => s.status === 'pending'), [services])

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Services</h1>
          <p className="text-muted-foreground mt-1">
            One price catalog for every service type — clinical, x-ray, lab and insurance. Lab
            entries point at a base service in the Labs module.
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
        <TabsList>
          <TabsTrigger value="all">Services</TabsTrigger>
          <TabsTrigger value="scopes">Application type</TabsTrigger>
          <TabsTrigger value="tooth-classes">Tooth classes</TabsTrigger>
          {isAdmin && pendingCount > 0 && (
            <TabsTrigger value="pending">
              Pending
              <Badge variant="destructive" className="ml-2 h-5 px-1.5 text-xs">
                {pendingCount}
              </Badge>
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
              <CardTitle className="text-base">All Services</CardTitle>
              {(isAdmin || canCreateService) && (
                <div className="flex items-center gap-3">
                  {isAdmin && (
                    <>
                      {/* Retired rows are hidden by default; this is the only way back
                          to a soft-deleted service. */}
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                        <Switch
                          checked={showRetired}
                          onCheckedChange={setShowRetired}
                          disabled={loading}
                          aria-label="Show retired services"
                        />
                        Show retired
                      </label>
                      {/* Bulk CSV import/export rewrites the price catalog wholesale — admin only. */}
                      <ServiceCsvControls
                        category="clinic"
                        label="Services"
                        onImported={refreshAll}
                      />
                    </>
                  )}
                  {/* Non-admins with services:create still reach this — the dialog
                      itself (isAdmin=false) routes their submission to 'pending'
                      instead of creating it live. */}
                  <Button onClick={handleCreateService} disabled={loading}>
                    <Plus className="mr-2 h-4 w-4" />
                    New service
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {!loading && catalogTruncated && (
                <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Showing {services.length} of {catalogTotal} services — the catalog is larger
                    than this page&apos;s limit, so some rows are hidden here (search and sorting
                    below only cover the rows loaded). Export the CSV for the full catalog.
                  </span>
                </div>
              )}
              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : services.length > 0 ? (
                <ServicesTable
                  data={services}
                  isAdmin={isAdmin}
                  onEdit={handleEditService}
                  onDelete={handleDeleteService}
                  onRestore={handleRestoreService}
                />
              ) : (
                <div className="text-center py-10 text-muted-foreground text-sm">
                  No services yet.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scopes" className="mt-4">
          <ApplicationScopeTab isAdmin={isAdmin} />
        </TabsContent>

        {/* The second pricing-matrix lookup. Shares the matrix with application
            types but is administered on its own tab. */}
        <TabsContent value="tooth-classes" className="mt-4">
          <ToothClassSection isAdmin={isAdmin} />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="pending" className="mt-4 space-y-4">
            {pendingServices.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BadgeCheck className="h-4 w-4 text-amber-500" />
                    Pending new services
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <DataTable
                    columns={[
                      { accessorKey: 'name', header: 'Service' },
                      {
                        accessorKey: 'amount',
                        header: 'Amount',
                        cell: ({ row }) => (
                          <span className="font-mono text-sm">
                            {formatGHS((row.original as ServiceRow).amount)}
                          </span>
                        ),
                      },
                      {
                        id: 'actions',
                        cell: ({ row }) => {
                          const r = row.original as ServiceRow
                          return (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                className="h-7 gap-1 bg-emerald-500 hover:bg-emerald-600"
                                onClick={async () => {
                                  try {
                                    await setStatusMutation.mutateAsync({
                                      id: r.id,
                                      status: 'active',
                                    })
                                    toast.success(`"${r.name}" approved.`)
                                  } catch (err) {
                                    toast.error(
                                      err instanceof Error ? err.message : 'Failed to approve'
                                    )
                                  }
                                }}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 text-destructive"
                                onClick={async () => {
                                  // Must move the approval state out of
                                  // 'pending', or the row sits in this queue
                                  // forever, merely deactivated.
                                  try {
                                    await setStatusMutation.mutateAsync({
                                      id: r.id,
                                      status: 'rejected',
                                      isActive: false,
                                    })
                                    toast.success(`"${r.name}" rejected.`)
                                  } catch (err) {
                                    toast.error(
                                      err instanceof Error ? err.message : 'Failed to reject'
                                    )
                                  }
                                }}
                              >
                                <XCircle className="h-3.5 w-3.5" /> Reject
                              </Button>
                            </div>
                          )
                        },
                      },
                    ]}
                    data={pendingServices}
                  />
                </CardContent>
              </Card>
            )}

            {changeRequests.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BadgeCheck className="h-4 w-4 text-amber-500" />
                    Pending change requests
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <DataTable
                    columns={[
                      {
                        id: 'service',
                        header: 'Service',
                        cell: ({ row }) => {
                          const r = row.original as ChangeRequestRow
                          const fallback = services.find((x) => x.id === r.serviceId)?.name
                          return (
                            <div className="flex items-center gap-2">
                              <span className="text-sm">
                                {r.targetName ?? fallback ?? r.serviceId ?? r.labBaseServiceId}
                              </span>
                              {r.targetKind === 'lab_base_service' && (
                                <Badge variant="outline" className="text-[10px]">
                                  Lab
                                </Badge>
                              )}
                            </div>
                          )
                        },
                      },
                      {
                        accessorKey: 'requestType',
                        header: 'Change',
                        cell: ({ row }) => (
                          <Badge variant="outline" className="capitalize">
                            {(row.original as ChangeRequestRow).requestType}
                          </Badge>
                        ),
                      },
                      {
                        id: 'diff',
                        header: 'From → To',
                        cell: ({ row }) => {
                          const r = row.original as ChangeRequestRow
                          const changes = changedFields(r)
                          if (changes.length === 0) {
                            return (
                              <span className="text-xs italic text-muted-foreground">
                                No change
                              </span>
                            )
                          }
                          // Compact: this is a table cell, so show the first few
                          // fields and count the rest.
                          const shown = changes.slice(0, 3)
                          return (
                            <div className="space-y-0.5">
                              {shown.map((f) => (
                                <div key={f} className="whitespace-nowrap text-xs">
                                  <span className="text-foreground">
                                    {CHANGE_FIELD_LABELS[f] ?? f}
                                  </span>{' '}
                                  <span className="font-mono text-muted-foreground">
                                    {formatChangeValue(f, r.currentValue?.[f])} →{' '}
                                    {formatChangeValue(f, r.requestedValue?.[f])}
                                  </span>
                                </div>
                              ))}
                              {changes.length > shown.length && (
                                <div className="text-[10px] text-muted-foreground">
                                  +{changes.length - shown.length} more field
                                  {changes.length - shown.length === 1 ? '' : 's'}
                                </div>
                              )}
                            </div>
                          )
                        },
                      },
                      {
                        id: 'actions',
                        cell: ({ row }) => {
                          const r = row.original as ChangeRequestRow
                          // targetName covers both catalogs; the lookup is only a
                          // fallback for rows served before the API resolved names.
                          const label =
                            r.targetName ??
                            services.find((x) => x.id === r.serviceId)?.name ??
                            'this service'
                          return (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                className="h-7 gap-1 bg-emerald-500 hover:bg-emerald-600"
                                onClick={() => handleApproveRequest(r.id, label)}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1 text-destructive"
                                onClick={() => handleRejectRequest(r.id, label)}
                              >
                                <XCircle className="h-3.5 w-3.5" /> Reject
                              </Button>
                            </div>
                          )
                        },
                      },
                    ]}
                    data={changeRequests}
                  />
                </CardContent>
              </Card>
            )}

            {pendingServices.length === 0 && changeRequests.length === 0 && (
              <div className="text-center py-10 text-muted-foreground text-sm">
                Nothing pending. All clear.
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>

      {/* Only the Services tab opens this sheet; the lookup tabs administer
          their own rows. Listing the tab that CAN open it means a new lookup
          tab never has to be added to an exclusion list. */}
      {confirmDialog}

      {serviceDialogOpen && activeTab === 'all' && (
        <Sheet open={serviceDialogOpen} onOpenChange={setServiceDialogOpen}>
          <ServiceFormDialog
            category={editingService?.category ?? 'clinic'}
            existing={editingService}
            isAdmin={isAdmin}
            onClose={() => setServiceDialogOpen(false)}
            onSaved={refreshAll}
          />
        </Sheet>
      )}
    </div>
  )
}
