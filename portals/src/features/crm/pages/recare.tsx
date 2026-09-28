import type { ColumnDef } from '@tanstack/react-table'
import { addDays, formatDistanceToNow, isPast } from 'date-fns'
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Repeat,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useCrmPolicies } from '@/features/crm/use-crm-policies'
import { api } from '@/lib/api-client'
import { DataTable } from '@/shared/components/data-table/data-table'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { PatientPicker, type PickerPatient } from '@/shared/components/patient-picker'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { Textarea } from '@/shared/components/ui/textarea'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'

type PlanStatus = 'pending' | 'alerted' | 'completed' | 'dismissed'
type ScopeType = 'patient' | 'treatment' | 'service'

interface RecarePlan {
  id: string
  patientId: string
  patient: { id: string; name: string } | null
  scopeType: ScopeType
  treatmentTypeId: string | null
  treatmentType: { id: string; name: string; displayName: string | null } | null
  serviceId: string | null
  service: { id: string; name: string } | null
  durationValue: number
  durationUnit: 'days' | 'weeks' | 'months'
  recurrence: 'one_time' | 'recurring'
  nextAlertDate: string
  isActive: boolean
  status: PlanStatus
  customMessage: string | null
  notes: string | null
}

interface TreatmentType {
  id: string
  name: string
}

interface ServiceOption {
  id: string
  name: string
  amount: number
  currency: string
  category: string
}

function StatusBadge({ status }: { status: PlanStatus }) {
  const map: Record<
    PlanStatus,
    { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }
  > = {
    pending: { label: 'Pending', variant: 'secondary' },
    alerted: { label: 'Alerted', variant: 'default' },
    completed: { label: 'Completed', variant: 'outline' },
    dismissed: { label: 'Dismissed', variant: 'outline' },
  }
  const { label, variant } = map[status]
  return <Badge variant={variant}>{label}</Badge>
}

// ─── New Plan Sheet ───────────────────────────────────────────────────────────

type RecallPreset = 'checkup' | 'scaling' | 'perio' | 'custom'
const RECALL_PRESET_MONTHS: Record<
  Exclude<RecallPreset, 'custom'>,
  (p: ReturnType<typeof useCrmPolicies>['policies']) => number
> = {
  checkup: (p) => p.recallCheckupMonths,
  scaling: (p) => p.recallScalingMonths,
  perio: (p) => p.recallPerioMonths,
}

interface NewPlanSheetProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: () => void
}

function NewPlanSheet({ open, onOpenChange, onCreated }: NewPlanSheetProps) {
  const [patient, setPatient] = useState<PickerPatient | null>(null)
  const [scopeType, setScopeType] = useState<ScopeType>('patient')
  const [treatmentTypeId, setTreatmentTypeId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [treatmentTypes, setTreatmentTypes] = useState<TreatmentType[]>([])
  const [services, setServices] = useState<ServiceOption[]>([])
  // Recall presets come from Settings → CRM → Automations (settings-domain-audit S5-B).
  const { policies } = useCrmPolicies({ enabled: open })
  const [preset, setPreset] = useState<RecallPreset>('checkup')
  const [durationValue, setDurationValue] = useState(String(policies.recallCheckupMonths))
  const [durationUnit, setDurationUnit] = useState<'days' | 'weeks' | 'months'>('months')
  const [recurrence, setRecurrence] = useState<'one_time' | 'recurring'>('one_time')
  const [customMessage, setCustomMessage] = useState('')
  const [notes, setNotes] = useState('')
  const { isSubmitting, submit } = useSubmitGuard()

  // Load treatment types + active clinic services once
  useEffect(() => {
    api.get<TreatmentType[]>('/api/lookups/treatment-types').then((res) => {
      if (res.success && res.data) setTreatmentTypes(res.data)
    })
    // `activeOnly=1`, not `status=active`: `status` is the APPROVAL column, so
    // filtering on it alone let deactivated services into this picker.
    // `activeOnly` requires isActive === true AND status === 'active'.
    api.get<ServiceOption[]>('/api/services?category=clinic&activeOnly=1').then((res) => {
      if (res.success && res.data) setServices(res.data.filter((s) => s.name))
    })
  }, [])

  // Reset form when sheet opens
  useEffect(() => {
    if (open) {
      setPatient(null)
      setScopeType('patient')
      setTreatmentTypeId('')
      setServiceId('')
      setPreset('checkup')
      setDurationValue(String(policies.recallCheckupMonths))
      setDurationUnit('months')
      setRecurrence('one_time')
      setCustomMessage('')
      setNotes('')
    }
  }, [open, policies.recallCheckupMonths])

  function applyPreset(next: RecallPreset) {
    setPreset(next)
    if (next === 'custom') return
    setDurationValue(String(RECALL_PRESET_MONTHS[next](policies)))
    setDurationUnit('months')
  }

  function handleSave() {
    if (!patient) {
      toast.error('Select a patient')
      return
    }
    const dur = Number(durationValue)
    if (!dur || dur < 1) {
      toast.error('Duration must be at least 1')
      return
    }
    if (dur > 3650) {
      toast.error('Duration cannot exceed 3650 days / ~10 years')
      return
    }
    if (scopeType === 'treatment' && !treatmentTypeId) {
      toast.error('Select a service category')
      return
    }
    if (scopeType === 'service' && !serviceId) {
      toast.error('Select a service')
      return
    }

    void submit(async () => {
      const res = await api.post('/api/recare', {
        patientId: patient.id,
        scopeType,
        treatmentTypeId: scopeType === 'treatment' ? treatmentTypeId : null,
        serviceId: scopeType === 'service' ? serviceId : null,
        durationValue: dur,
        durationUnit,
        recurrence,
        customMessage: customMessage.trim() || null,
        notes: notes.trim() || null,
        isActive: true,
      })

      if (res.success) {
        toast.success('Recare plan created')
        onOpenChange(false)
        onCreated()
      } else {
        surfaceApiError(res, 'Failed to create recare plan')
      }
    })
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="!w-full !max-w-[500px] overflow-y-auto">
        <SheetHeader className="mb-6">
          <SheetTitle>New Recare Plan</SheetTitle>
        </SheetHeader>

        <div className="space-y-5 pb-6">
          {/* Patient */}
          <div className="space-y-1.5">
            <Label htmlFor="recare-patient">Patient</Label>
            <PatientPicker
              id="recare-patient"
              value={patient?.id ?? ''}
              onChange={(_id, p) => setPatient(p)}
              popoverWidthClass="w-[440px]"
            />
          </div>

          {/* Scope */}
          <div className="space-y-1.5">
            <Label>Scope</Label>
            <Select value={scopeType} onValueChange={(v) => setScopeType(v as ScopeType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="patient">Patient-specific</SelectItem>
                <SelectItem value="treatment">Service category</SelectItem>
                <SelectItem value="service">Specific service</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {scopeType === 'patient'
                ? 'A general follow-up plan for this patient.'
                : scopeType === 'treatment'
                  ? 'Triggered whenever any service in this category is completed.'
                  : 'Triggered when this specific service is completed.'}
            </p>
          </div>

          {/* Service category — shown only when scope=treatment */}
          {scopeType === 'treatment' && (
            <div className="space-y-1.5">
              <Label>Service Category</Label>
              <Select value={treatmentTypeId} onValueChange={setTreatmentTypeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a category…" />
                </SelectTrigger>
                <SelectContent>
                  {treatmentTypes.length === 0 && (
                    <SelectItem value="__none__" disabled>
                      No categories found
                    </SelectItem>
                  )}
                  {treatmentTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Service — shown only when scope=service */}
          {scopeType === 'service' && (
            <div className="space-y-1.5">
              <Label>Service</Label>
              <Select value={serviceId} onValueChange={setServiceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a service…" />
                </SelectTrigger>
                <SelectContent>
                  {services.length === 0 && (
                    <SelectItem value="__none__" disabled>
                      No services found
                    </SelectItem>
                  )}
                  {services.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Recall preset (Settings → CRM → Automations) */}
          <div className="space-y-1.5">
            <Label>Recall preset</Label>
            <Select value={preset} onValueChange={(v) => applyPreset(v as RecallPreset)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="checkup">
                  Routine checkup · every {policies.recallCheckupMonths} months
                </SelectItem>
                <SelectItem value="scaling">
                  Scaling & polishing · every {policies.recallScalingMonths} months
                </SelectItem>
                <SelectItem value="perio">
                  Perio maintenance · every {policies.recallPerioMonths} months
                </SelectItem>
                <SelectItem value="custom">Custom interval</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Duration */}
          <div className="space-y-1.5">
            <Label>Follow-up interval</Label>
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                max={3650}
                value={durationValue}
                onChange={(e) => {
                  setPreset('custom')
                  setDurationValue(e.target.value)
                }}
                className="w-24"
              />
              <Select
                value={durationUnit}
                onValueChange={(v) => {
                  setPreset('custom')
                  setDurationUnit(v as 'days' | 'weeks' | 'months')
                }}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="days">Days</SelectItem>
                  <SelectItem value="weeks">Weeks</SelectItem>
                  <SelectItem value="months">Months</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Recurrence */}
          <div className="space-y-1.5">
            <Label>Recurrence</Label>
            <Select
              value={recurrence}
              onValueChange={(v) => setRecurrence(v as 'one_time' | 'recurring')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="one_time">One-time</SelectItem>
                <SelectItem value="recurring">Recurring</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Custom message */}
          <div className="space-y-1.5">
            <Label htmlFor="recare-msg">
              Custom message <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="recare-msg"
              rows={3}
              maxLength={500}
              placeholder="Leave blank to use the default reminder template…"
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="recare-notes">
              Notes <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="recare-notes"
              rows={2}
              maxLength={1000}
              placeholder="Internal notes for this plan…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Plan
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RecarePage() {
  const [plans, setPlans] = useState<RecarePlan[]>([])
  const [loading, setLoading] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  // Track which plan IDs have an in-flight PATCH to prevent concurrent requests
  const inFlightIds = useRef<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<RecarePlan[]>('/api/recare')
    if (res.success && res.data) setPlans(res.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const dueSoonPlans = useMemo(
    () =>
      plans.filter(
        (p) => p.isActive && p.status === 'pending' && isPast(addDays(new Date(p.nextAlertDate), 7))
      ),
    [plans]
  )

  const updateStatus = useCallback(async (id: string, status: PlanStatus) => {
    if (inFlightIds.current.has(id)) return
    inFlightIds.current.add(id)
    try {
      const res = await api.patch(`/api/recare/${id}`, { status })
      if (res.success) {
        setPlans((prev) => prev.map((p) => (p.id === id ? { ...p, status } : p)))
        toast.success(`Plan marked as ${status}.`)
      } else {
        surfaceApiError(res, 'Failed to update plan')
      }
    } finally {
      inFlightIds.current.delete(id)
    }
  }, [])

  const toggleActive = useCallback(
    async (id: string) => {
      if (inFlightIds.current.has(id)) return
      const plan = plans.find((p) => p.id === id)
      if (!plan) return
      inFlightIds.current.add(id)
      try {
        const res = await api.patch(`/api/recare/${id}`, { isActive: !plan.isActive })
        if (res.success) {
          setPlans((prev) => prev.map((p) => (p.id === id ? { ...p, isActive: !p.isActive } : p)))
        } else {
          surfaceApiError(res, 'Failed to update plan')
        }
      } finally {
        inFlightIds.current.delete(id)
      }
    },
    [plans]
  )

  const columns = useMemo<ColumnDef<RecarePlan>[]>(
    () => [
      {
        accessorKey: 'patientId',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Patient" />,
        cell: ({ row }) => (
          <span className="font-medium text-sm">
            {row.original.patient?.name ?? row.original.patientId}
          </span>
        ),
      },
      {
        id: 'scope',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Scope" />,
        cell: ({ row }) => {
          const p = row.original
          if (p.scopeType === 'service') {
            return (
              <div className="text-sm">
                <Badge variant="default">Service</Badge>
                <span className="ml-2 text-muted-foreground">{p.service?.name ?? '—'}</span>
              </div>
            )
          }
          if (p.scopeType === 'treatment') {
            const name = p.treatmentType?.displayName || p.treatmentType?.name
            return (
              <div className="text-sm">
                <Badge variant="secondary">Category</Badge>
                <span className="ml-2 text-muted-foreground">{name ?? '—'}</span>
              </div>
            )
          }
          return <Badge variant="outline">Patient-specific</Badge>
        },
      },
      {
        id: 'schedule',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Schedule" />,
        cell: ({ row }) => {
          const p = row.original
          return (
            <span className="text-sm text-muted-foreground">
              Every {p.durationValue} {p.durationUnit} ·{' '}
              {p.recurrence === 'recurring' ? 'Recurring' : 'One-time'}
            </span>
          )
        },
      },
      {
        accessorKey: 'nextAlertDate',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Next Alert" />,
        cell: ({ row }) => {
          const date = new Date(row.original.nextAlertDate)
          const overdue = isPast(date)
          return (
            <span
              className={`text-sm ${overdue ? 'text-destructive font-medium' : 'text-muted-foreground'}`}
            >
              {overdue ? 'Overdue · ' : ''}
              {formatDistanceToNow(date, { addSuffix: true })}
            </span>
          )
        },
      },
      {
        accessorKey: 'isActive',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Active" />,
        cell: ({ row, table }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <Switch
              checked={row.original.isActive}
              onCheckedChange={() => (table.options.meta as any)?.toggleActive(row.original.id)}
            />
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'actions',
        cell: ({ row, table }) => {
          const p = row.original
          const meta = table.options.meta as any
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-8 w-8 p-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {p.status === 'pending' && (
                  <DropdownMenuItem onClick={() => meta?.updateStatus(p.id, 'alerted')}>
                    <AlertCircle className="mr-2 h-4 w-4 text-amber-500" /> Mark Alerted
                  </DropdownMenuItem>
                )}
                {p.status !== 'completed' && (
                  <DropdownMenuItem onClick={() => meta?.updateStatus(p.id, 'completed')}>
                    <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-500" /> Mark Completed
                  </DropdownMenuItem>
                )}
                {p.status !== 'dismissed' && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-muted-foreground"
                      onClick={() => meta?.updateStatus(p.id, 'dismissed')}
                    >
                      <XCircle className="mr-2 h-4 w-4" /> Dismiss
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        },
      },
    ],
    []
  )

  const tableMeta = useMemo(() => ({ updateStatus, toggleActive }), [updateStatus, toggleActive])

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Repeat className="h-7 w-7" />
            Recare
          </h1>
          <p className="text-muted-foreground mt-1">
            Schedule follow-up alerts for treatments or per-patient care plans.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button size="sm" onClick={() => setSheetOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            New Plan
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded" />
          ))}
        </div>
      ) : (
        <>
          {dueSoonPlans.length > 0 && (
            <Card className="border-amber-200 bg-amber-50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-amber-700 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {dueSoonPlans.length} plan{dueSoonPlans.length > 1 ? 's' : ''} due or overdue
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-amber-700">
                {dueSoonPlans.map((p) => (
                  <div key={p.id} className="flex items-center justify-between py-1">
                    <span>
                      {p.patient?.name ?? p.patientId} —{' '}
                      {p.treatmentType?.displayName ?? p.treatmentType?.name ?? 'Patient-specific'}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 border-amber-300"
                        onClick={() => updateStatus(p.id, 'alerted')}
                      >
                        Mark Alerted
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 border-amber-300"
                        onClick={() => updateStatus(p.id, 'completed')}
                      >
                        Complete
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="active">
            <TabsList>
              <TabsTrigger value="active">
                Active Plans
                <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-xs">
                  {plans.filter((p) => p.isActive).length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger value="all">All Plans</TabsTrigger>
            </TabsList>

            <TabsContent value="active" className="mt-4">
              <Card>
                <CardContent className="pt-4">
                  <DataTable
                    columns={columns}
                    data={plans.filter((p) => p.isActive)}
                    meta={tableMeta}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="all" className="mt-4">
              <Card>
                <CardContent className="pt-4">
                  <DataTable columns={columns} data={plans} meta={tableMeta} />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}

      <NewPlanSheet open={sheetOpen} onOpenChange={setSheetOpen} onCreated={load} />
    </div>
  )
}
