import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useClinicalPreferences } from '@/features/clinical/use-clinical-preferences'
import { api } from '@/lib/api-client'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Textarea } from '@/shared/components/ui/textarea'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { localDateISO } from '@/shared/lib/dates'
import { centsToInput, formatAmount, inputToCents } from '@/shared/utils/currency'
import type { LabCase, LabCaseDomain, LabVendor, ServiceCatalogEntry } from '../types'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  vendors: LabVendor[]
  initialCase?: LabCase
  onSaved: () => void
}

type Patient = { id: string; name: string; patientId: string | null }
type Doctor = { id: string; user?: { id: string; name: string } | null; name?: string | null }

interface UnitRow {
  id: string // stable key for reconciliation
  label: string
  cost: string // decimal Cedis string for input control
}

/** Application-type name for an entry, falling back to the legacy unitType. */
function entryScopeName(entry: ServiceCatalogEntry | undefined | null): string {
  if (entry?.scope?.name) return entry.scope.name
  if (entry?.unitType === 'per_tooth') return 'tooth'
  if (entry?.unitType === 'per_arch') return 'arch'
  return 'unit'
}

function defaultUnitsFor(scopeName: string, unitPriceCents: number): UnitRow[] {
  const costStr = centsToInput(unitPriceCents)
  if (scopeName === 'arch') {
    return [
      { id: crypto.randomUUID(), label: 'Upper arch', cost: costStr },
      { id: crypto.randomUUID(), label: 'Lower arch', cost: costStr },
    ]
  }
  if (scopeName === 'tooth') {
    return [{ id: crypto.randomUUID(), label: 'Tooth 1', cost: costStr }]
  }
  return [{ id: crypto.randomUUID(), label: 'Unit 1', cost: costStr }]
}

export function LabCaseFormDialog({ open, onOpenChange, vendors, initialCase, onSaved }: Props) {
  // Final turnaround fallback, mirroring the backend (settings-domain-audit S5-B).
  const { charting } = useClinicalPreferences({ enabled: open })
  const isEdit = !!initialCase

  // ── Domain (internal/external) ─────────────────────────────────────────────
  const [domain, setDomain] = useState<LabCaseDomain>('internal')

  // ── Internal: patient ──────────────────────────────────────────────────────
  const [patientId, setPatientId] = useState<string>('')
  const [patientSearch, setPatientSearch] = useState('')
  const [patients, setPatients] = useState<Patient[]>([])
  const [selectedPatientName, setSelectedPatientName] = useState<string>('')

  // ── External: patient name ─────────────────────────────────────────────────
  const [externalPatientName, setExternalPatientName] = useState<string>('')

  // ── Assigned doctor (also = referring doctor for external) ─────────────────
  const [assignedDoctorId, setAssignedDoctorId] = useState<string>('')
  const [doctors, setDoctors] = useState<Doctor[]>([])

  // ── Service catalog + chosen offering + express tier ───────────────────────
  const [catalog, setCatalog] = useState<ServiceCatalogEntry[]>([])
  const [baseServiceId, setBaseServiceId] = useState<string>('')
  const [vendorId, setVendorId] = useState<string>('')
  const [serviceId, setServiceId] = useState<string>('') // labServices.id
  const [expressOptionId, setExpressOptionId] = useState<string>('') // '' = regular tier

  // ── Units ──────────────────────────────────────────────────────────────────
  const [units, setUnits] = useState<UnitRow[]>([])

  // ── Internal-only: patient charge override (defaults to labCost) ───────────
  const [patientCharge, setPatientCharge] = useState<string>('')
  const [patientChargeOverridden, setPatientChargeOverridden] = useState(false)

  // ── Schedule / notes ───────────────────────────────────────────────────────
  const [expectedReturn, setExpectedReturn] = useState<string>('')
  const [notes, setNotes] = useState('')
  const [isDirty, setIsDirty] = useState(false)

  const { isSubmitting, submit } = useSubmitGuard()

  // ── Dirty guard ────────────────────────────────────────────────────────────
  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => onOpenChange(false),
  })

  // ── Reset / prefill on open ────────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      if (!isEdit) {
        setDomain('internal')
        setPatientId('')
        setPatientSearch('')
        setSelectedPatientName('')
        setExternalPatientName('')
        setAssignedDoctorId('')
        setBaseServiceId('')
        setVendorId('')
        setServiceId('')
        setExpressOptionId('')
        setUnits([])
        setPatientCharge('')
        setPatientChargeOverridden(false)
        setExpectedReturn('')
        setNotes('')
      }
      setIsDirty(false)
      return
    }
    if (initialCase) {
      setDomain(initialCase.domain)
      setPatientId(initialCase.patientId ?? '')
      setSelectedPatientName(initialCase.patient?.name ?? '')
      setExternalPatientName(initialCase.externalPatientName ?? '')
      setAssignedDoctorId(initialCase.assignedDoctorId ?? '')
      setVendorId(initialCase.vendorId)
      setServiceId(initialCase.serviceId ?? '')
      setExpressOptionId(initialCase.expressOptionId ?? '')
      setUnits(
        Array.isArray(initialCase.units) && initialCase.units.length > 0
          ? initialCase.units.map((u) => ({
              id: crypto.randomUUID(),
              label: u.label,
              cost: centsToInput(u.cost),
            }))
          : [
              {
                id: crypto.randomUUID(),
                label: 'Case',
                cost: centsToInput(initialCase.labCost ?? 0),
              },
            ]
      )
      setPatientCharge(centsToInput(initialCase.patientCharge ?? initialCase.labCost ?? 0))
      setPatientChargeOverridden(
        Number(initialCase.patientCharge ?? 0) !== Number(initialCase.labCost ?? 0)
      )
      setExpectedReturn(initialCase.expectedReturn ? initialCase.expectedReturn.slice(0, 10) : '')
      setNotes(initialCase.notes ?? '')
      setIsDirty(false)
    }
  }, [open, initialCase, isEdit])

  // ── Load reference data when dialog opens ──────────────────────────────────
  useEffect(() => {
    if (!open) return
    ;(async () => {
      const [catalogRes, doctorsRes] = await Promise.all([
        api.get<ServiceCatalogEntry[]>('/api/labs/service-catalog'),
        api.get<Doctor[]>('/api/doctors'),
      ])
      if (catalogRes.success && catalogRes.data) {
        setCatalog(catalogRes.data)
      } else if (!catalogRes.success) {
        toast.error('Failed to load service catalog — please close and reopen the dialog')
      }
      if (doctorsRes.success && doctorsRes.data) {
        setDoctors(doctorsRes.data)
      } else if (!doctorsRes.success) {
        toast.error('Failed to load doctors list — please close and reopen the dialog')
      }
    })()
  }, [open])

  // ── Restore baseServiceId from initialCase after catalog loads ────────────
  useEffect(() => {
    if (!initialCase || catalog.length === 0 || baseServiceId) return
    const entry = catalog.find((e) =>
      e.offerings.some((o) => o.serviceId === initialCase.serviceId)
    )
    if (entry) setBaseServiceId(entry.baseServiceId)
  }, [initialCase, catalog, baseServiceId])

  // ── Patient search (internal mode only) ────────────────────────────────────
  useEffect(() => {
    if (!open || isEdit || domain !== 'internal') return
    const t = setTimeout(async () => {
      const qs = patientSearch ? `?search=${encodeURIComponent(patientSearch)}` : ''
      const res = await api.get<Patient[]>(`/api/patients${qs}`)
      if (res.success && res.data) setPatients(res.data.slice(0, 20))
    }, 200)
    return () => clearTimeout(t)
  }, [patientSearch, open, isEdit, domain])

  // ── Derived: catalog entry + offering + express option ─────────────────────
  const selectedEntry = useMemo(
    () => catalog.find((e) => e.baseServiceId === baseServiceId) ?? null,
    [catalog, baseServiceId]
  )
  const selectedOffering = useMemo(
    () => selectedEntry?.offerings.find((o) => o.vendorId === vendorId) ?? null,
    [selectedEntry, vendorId]
  )
  const selectedExpressOption = useMemo(
    () => selectedOffering?.expressOptions.find((eo) => eo.id === expressOptionId) ?? null,
    [selectedOffering, expressOptionId]
  )

  const unitPrice = selectedExpressOption?.cost ?? selectedOffering?.regularCost ?? 0
  const labCost = units.reduce((s, u) => s + inputToCents(u.cost), 0)

  // Auto-fill patient charge to labCost (until user overrides), or clinicPrice if set.
  useEffect(() => {
    if (domain === 'external') return // external charge always = labCost
    if (patientChargeOverridden) return
    const chargePerUnit = selectedOffering?.clinicPrice ?? selectedOffering?.regularCost ?? 0
    const defaultCharge =
      selectedOffering?.clinicPrice != null ? chargePerUnit * (units.length || 1) : labCost
    setPatientCharge(centsToInput(defaultCharge))
  }, [
    labCost,
    domain,
    patientChargeOverridden,
    selectedOffering?.clinicPrice,
    selectedOffering?.regularCost,
    units.length,
  ])

  // When base service changes, clear the offering.
  function pickBaseService(id: string) {
    setBaseServiceId(id)
    setVendorId('')
    setServiceId('')
    setExpressOptionId('')
    setUnits([])
    setIsDirty(true)
  }

  // When vendor offering picked, seed units + expected-return from regular turnaround.
  function pickOffering(offeringServiceId: string) {
    setServiceId(offeringServiceId)
    setIsDirty(true)
    const offering = selectedEntry?.offerings.find((o) => o.serviceId === offeringServiceId)
    if (!offering) return
    setVendorId(offering.vendorId)
    setExpressOptionId('')
    if (selectedEntry) {
      setUnits(defaultUnitsFor(entryScopeName(selectedEntry), offering.regularCost))
    }
    const d = new Date()
    d.setDate(d.getDate() + (offering.regularTurnaroundDays || charting.defaultLabTurnaroundDays))
    setExpectedReturn(localDateISO(d))
  }

  // When express option changes, re-price all units to the express unit price
  // and reset expected-return to express turnaround.
  function pickExpressOption(id: string) {
    setExpressOptionId(id)
    setIsDirty(true)
    if (!selectedOffering || !selectedEntry) return
    const eo = id ? selectedOffering.expressOptions.find((o) => o.id === id) : null
    const newUnitPrice = eo ? eo.cost : selectedOffering.regularCost
    const newTurnaround =
      (eo ? eo.turnaroundDays : selectedOffering.regularTurnaroundDays) ||
      charting.defaultLabTurnaroundDays
    setUnits((prev) =>
      prev.length > 0
        ? prev.map((u) => ({ ...u, cost: centsToInput(newUnitPrice) }))
        : defaultUnitsFor(entryScopeName(selectedEntry), newUnitPrice)
    )
    const d = new Date()
    d.setDate(d.getDate() + newTurnaround)
    setExpectedReturn(localDateISO(d))
  }

  function addUnit() {
    const nextIndex = units.length + 1
    const label =
      entryScopeName(selectedEntry) === 'tooth' ? `Tooth ${nextIndex}` : `Unit ${nextIndex}`
    setUnits((prev) => [...prev, { id: crypto.randomUUID(), label, cost: centsToInput(unitPrice) }])
    setIsDirty(true)
  }

  function updateUnit(i: number, patch: Partial<UnitRow>) {
    setUnits((prev) => prev.map((u, idx) => (idx === i ? { ...u, ...patch } : u)))
  }

  function removeUnit(i: number) {
    setUnits((prev) => prev.filter((_, idx) => idx !== i))
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  function save() {
    void submit(async () => {
      if (!vendorId || !serviceId) {
        toast.error('Pick a service from a vendor')
        return
      }
      if (units.length === 0) {
        toast.error('Add at least one unit')
        return
      }
      // Warn if every unit has a zero cost (likely a data entry mistake).
      const hasZeroCost = units.some((u) => !(parseFloat(u.cost) > 0))
      if (hasZeroCost) {
        toast.error('Each unit must have a cost greater than 0')
        return
      }
      if (domain === 'internal' && !patientId) {
        toast.error('Pick a patient')
        return
      }
      if (domain === 'external' && !externalPatientName.trim()) {
        toast.error('External patient name is required')
        return
      }
      if (!assignedDoctorId) {
        toast.error('Pick a doctor for the case')
        return
      }
      // Validate expectedReturn format when present.
      if (expectedReturn && Number.isNaN(Date.parse(expectedReturn))) {
        toast.error('Expected return date is not a valid date')
        return
      }

      // For external cases, the assigned doctor is also the referring doctor.
      const effectiveReferringDoctorId = domain === 'external' ? assignedDoctorId : null

      const unitsPayload = units.map((u) => ({
        label: u.label.trim() || 'Unit',
        // The API speaks CENTS; the input holds decimal cedis.
        cost: inputToCents(u.cost),
      }))

      // On edit, strip vendorId/serviceId — the PATCH allowlist on the backend
      // does not include those fields, so sending them would be a silent no-op
      // and could mask that the service cannot be changed post-creation.
      const basePayload: Record<string, unknown> = isEdit
        ? {
            assignedDoctorId,
            expressOptionId: expressOptionId || null,
            units: unitsPayload,
            expectedReturn: expectedReturn || null,
            notes: notes || null,
            externalPatientName: domain === 'external' ? externalPatientName.trim() : null,
            referringDoctorId: effectiveReferringDoctorId,
          }
        : {
            domain,
            patientId: domain === 'internal' ? patientId : null,
            externalPatientName: domain === 'external' ? externalPatientName.trim() : null,
            referringDoctorId: effectiveReferringDoctorId,
            assignedDoctorId,
            vendorId,
            serviceId,
            expressOptionId: expressOptionId || null,
            units: unitsPayload,
            expectedReturn: expectedReturn || null,
            notes: notes || null,
          }

      // patientCharge only sent for internal (external auto-set = labCost on backend)
      if (domain === 'internal') {
        basePayload.patientCharge = inputToCents(patientCharge)
      }

      const res = isEdit
        ? await api.patch(`/api/labs/cases/${initialCase?.id}`, basePayload)
        : await api.post('/api/labs/cases', { ...basePayload, status: 'draft' })

      if (res.success) {
        setIsDirty(false)
        toast.success(isEdit ? 'Lab case updated' : 'Lab case created')
        onSaved()
      } else {
        surfaceApiError(res, 'Unexpected error — please try again')
      }
    })
  }

  const showPatientDropdown =
    !isEdit && !patientId && patients.length > 0 && patientSearch.length > 0

  const canSubmit =
    !!vendorId &&
    !!serviceId &&
    units.length > 0 &&
    !!assignedDoctorId &&
    (domain === 'internal' ? !!patientId : !!externalPatientName.trim())

  return (
    <>
      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
      <Dialog open={open} onOpenChange={guardedOnOpenChange}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEdit ? `Edit ${initialCase?.caseNumber}` : 'New Lab Case'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {/* Domain toggle */}
            {!isEdit && (
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Case Domain
                </Label>
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDomain('internal')
                      setPatientChargeOverridden(false)
                      setPatientCharge(labCost.toString())
                      setIsDirty(true)
                    }}
                    className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      domain === 'internal'
                        ? 'border-primary bg-primary/10 ring-1 ring-primary'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    <p className="font-medium">Internal</p>
                    <p className="text-xs text-muted-foreground">Our patient pays</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDomain('external')
                      setPatientChargeOverridden(false)
                      setIsDirty(true)
                    }}
                    className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      domain === 'external'
                        ? 'border-primary bg-primary/10 ring-1 ring-primary'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    <p className="font-medium">External</p>
                    <p className="text-xs text-muted-foreground">Referring doctor pays</p>
                  </button>
                </div>
              </div>
            )}

            {/* Patient / External patient */}
            {domain === 'internal' ? (
              <div className="space-y-1.5">
                <Label>Patient</Label>
                {isEdit ? (
                  <Input value={selectedPatientName} disabled />
                ) : (
                  <>
                    <Input
                      value={patientId ? selectedPatientName : patientSearch}
                      onChange={(e) => {
                        setPatientSearch(e.target.value)
                        if (patientId) {
                          setPatientId('')
                          setSelectedPatientName('')
                        }
                      }}
                      placeholder="Search patient…"
                    />
                    {showPatientDropdown && (
                      <div className="rounded-md border border-border bg-popover shadow-sm max-h-40 overflow-y-auto">
                        {patients.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className="w-full text-left px-3 py-1.5 hover:bg-muted text-sm"
                            onClick={() => {
                              setPatientId(p.id)
                              setSelectedPatientName(p.name)
                              setPatientSearch('')
                              setIsDirty(true)
                            }}
                          >
                            {p.name}
                            {p.patientId && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                {p.patientId}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Patient name</Label>
                <Input
                  value={externalPatientName}
                  onChange={(e) => {
                    setExternalPatientName(e.target.value)
                    setIsDirty(true)
                  }}
                  placeholder="Free-text name (we don't store as a patient record)"
                  maxLength={200}
                />
              </div>
            )}

            {/* Assigned doctor — for external cases, this is also the referring doctor. */}
            <div className="space-y-1.5">
              <Label>
                {domain === 'external' ? 'Assigned / referring doctor' : 'Assigned doctor'}
              </Label>
              <Select
                value={assignedDoctorId}
                onValueChange={(v) => {
                  setAssignedDoctorId(v)
                  setIsDirty(true)
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select doctor" />
                </SelectTrigger>
                <SelectContent>
                  {doctors.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.user?.name ?? d.name ?? 'Unknown'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Base service — picks the catalog entry. */}
            <div className="space-y-1.5">
              <Label>Lab service</Label>
              <Select value={baseServiceId} onValueChange={pickBaseService}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a service…" />
                </SelectTrigger>
                <SelectContent>
                  {catalog.length === 0 ? (
                    <SelectItem value="_none" disabled>
                      No services yet — configure under Services module
                    </SelectItem>
                  ) : (
                    catalog.map((e) => (
                      <SelectItem key={e.baseServiceId} value={e.baseServiceId}>
                        {e.name}
                        {e.category && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {e.category.name}
                          </span>
                        )}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Vendor offerings */}
            {selectedEntry && (
              <div className="space-y-2">
                <Label>Choose lab vendor</Label>
                {selectedEntry.offerings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No vendor offers this service yet. Link it from a vendor's detail page.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {selectedEntry.offerings.map((o) => {
                      const isSelected = serviceId === o.serviceId
                      const hasExpress = o.expressOptions.length > 0
                      return (
                        <button
                          key={o.serviceId}
                          type="button"
                          onClick={() => pickOffering(o.serviceId)}
                          className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${
                            isSelected
                              ? 'border-primary bg-primary/5 ring-1 ring-primary'
                              : 'border-border hover:bg-muted/40'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-sm">{o.vendorName}</p>
                              <Badge variant="outline" className="text-[10px] capitalize">
                                {o.vendorType}
                              </Badge>
                              {hasExpress && (
                                <Badge className="text-[10px] bg-amber-500 hover:bg-amber-500">
                                  Express avail.
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              GHS {formatAmount(Number(o.regularCost))} / {o.regularTurnaroundDays}d
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Express option dropdown — only when the chosen offering has any. */}
            {selectedOffering && selectedOffering.expressOptions.length > 0 && (
              <div className="space-y-1.5">
                <Label>Tier</Label>
                <Select
                  value={expressOptionId || '__regular'}
                  onValueChange={(v) => pickExpressOption(v === '__regular' ? '' : v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__regular">
                      Regular · GHS {formatAmount(Number(selectedOffering.regularCost))} ·{' '}
                      {selectedOffering.regularTurnaroundDays}d
                    </SelectItem>
                    {selectedOffering.expressOptions.map((eo) => (
                      <SelectItem key={eo.id} value={eo.id}>
                        {eo.label} · GHS {formatAmount(Number(eo.cost))} · {eo.turnaroundDays}d
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Units */}
            {selectedOffering && (
              <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                    Units (
                    {selectedEntry?.scope?.displayName ?? selectedEntry?.unitType.replace('_', ' ')}
                    )
                  </Label>
                  <Button type="button" size="sm" variant="outline" onClick={addUnit}>
                    <Plus className="mr-1 h-3 w-3" />
                    Add unit
                  </Button>
                </div>
                <ul className="space-y-2">
                  {units.map((u, i) => (
                    <li key={u.id} className="grid grid-cols-[1fr_120px_auto] gap-2">
                      <Input
                        value={u.label}
                        onChange={(e) => {
                          updateUnit(i, { label: e.target.value })
                          setIsDirty(true)
                        }}
                        placeholder="Label"
                      />
                      <Input
                        type="number"
                        step="0.01"
                        min={0}
                        value={u.cost}
                        onChange={(e) => {
                          updateUnit(i, { cost: e.target.value })
                          setIsDirty(true)
                        }}
                        placeholder="Cost"
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          removeUnit(i)
                          setIsDirty(true)
                        }}
                        disabled={units.length <= 1}
                        aria-label="Delete unit"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </li>
                  ))}
                </ul>
                <div className="pt-2 border-t border-border flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Lab cost (what we owe)</span>
                  <span className="font-mono font-semibold">
                    GHS {formatAmount(Number(labCost))}
                  </span>
                </div>
              </div>
            )}

            {/* Patient charge — INTERNAL ONLY. External charge = labCost (auto). */}
            {domain === 'internal' && selectedOffering && (
              <div className="space-y-1.5">
                <Label>Patient charge (GHS)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={patientCharge}
                  onChange={(e) => {
                    setPatientCharge(e.target.value)
                    setPatientChargeOverridden(true)
                    setIsDirty(true)
                  }}
                />
                <p className="text-[10px] text-muted-foreground">
                  Defaults to lab cost. Adjust to add clinic margin.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Expected return</Label>
              <Input
                type="date"
                value={expectedReturn}
                onChange={(e) => {
                  setExpectedReturn(e.target.value)
                  setIsDirty(true)
                }}
              />
              <p className="text-[10px] text-muted-foreground">
                Auto-set from the selected vendor + tier turnaround
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value)
                  setIsDirty(true)
                }}
                rows={2}
                maxLength={2000}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => guardedOnOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={save} disabled={isSubmitting || !canSubmit}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : isEdit ? (
                'Save Changes'
              ) : (
                'Create Case'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
