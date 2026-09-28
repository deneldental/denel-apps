import { Info, Plus, Trash2, UserRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  getServiceDoctors,
  type ServiceDoctorLink,
  setServiceDoctors,
} from '@/lib/actions/services'
import { listSpecialists, type Specialist } from '@/lib/actions/specialists'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Switch } from '@/shared/components/ui/switch'

interface Props {
  serviceId: string
  isAdmin: boolean
  onDirtyChange?: (dirty: boolean) => void
}

interface Row {
  doctorId: string
  /** null = "use default" (the doctor's defaultCommissionRate). */
  commissionRate: number | null
  noCommission: boolean
}

export function ServiceDoctorsSection({ serviceId, isAdmin, onDirtyChange }: Props) {
  const [initial, setInitial] = useState<
    Map<string, { commissionRate: number | null; noCommission: boolean }>
  >(new Map())
  const [rows, setRows] = useState<Row[]>([])

  const specialistsQuery = useApiQuery<Specialist[]>(queryKeys.specialists.list(), () =>
    listSpecialists()
  )
  const specialists = specialistsQuery.data ?? []

  const DOCTORS_KEY = queryKeys.services.doctors(serviceId)
  const doctorsQuery = useApiQuery<ServiceDoctorLink[]>(DOCTORS_KEY, () =>
    getServiceDoctors(serviceId)
  )
  const loading = specialistsQuery.isLoading || doctorsQuery.isLoading

  // Re-seed the draft rows + dirty-comparison baseline whenever the server
  // links actually change — initial load, or after a successful save's refetch.
  useEffect(() => {
    if (!doctorsQuery.data) return
    const linked = doctorsQuery.data
    const initialMap = new Map(
      linked.map((l) => [
        l.doctorId,
        { commissionRate: l.commissionRate, noCommission: l.noCommission },
      ])
    )
    setInitial(initialMap)
    setRows(
      linked.map((l) => ({
        doctorId: l.doctorId,
        commissionRate: l.commissionRate,
        noCommission: l.noCommission,
      }))
    )
  }, [doctorsQuery.data])

  const saveMutation = useApiMutation(
    (links: Array<{ doctorId: string; commissionRate: number | null; noCommission: boolean }>) =>
      setServiceDoctors(serviceId, links),
    { invalidates: [DOCTORS_KEY] }
  )
  const saving = saveMutation.isPending

  const dirty = useMemo(() => {
    if (rows.length !== initial.size) return true
    for (const r of rows) {
      const prev = initial.get(r.doctorId)
      if (!prev) return true
      if (prev.commissionRate !== r.commissionRate || prev.noCommission !== r.noCommission) {
        return true
      }
    }
    return false
  }, [rows, initial])

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  const specialistById = useMemo(() => {
    const m = new Map<string, Specialist>()
    for (const s of specialists) m.set(s.id, s)
    return m
  }, [specialists])

  const availableSpecialists = useMemo(() => {
    const used = new Set(rows.map((r) => r.doctorId))
    return specialists.filter((s) => !used.has(s.id))
  }, [specialists, rows])

  function handleAdd() {
    if (availableSpecialists.length === 0) {
      toast.info('All active doctors are already linked.')
      return
    }
    setRows((prev) => [
      ...prev,
      { doctorId: availableSpecialists[0].id, commissionRate: null, noCommission: false },
    ])
  }

  function handleRemove(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx))
  }

  function handleChangeDoctor(idx: number, doctorId: string) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, doctorId } : r)))
  }

  function handleChangeRate(idx: number, raw: string) {
    const trimmed = raw.trim()
    if (trimmed === '') {
      setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, commissionRate: null } : r)))
      return
    }
    const n = Number(trimmed)
    if (Number.isNaN(n) || n < 0 || n > 100) return
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, commissionRate: n } : r)))
  }

  function handleToggleNoCommission(idx: number, next: boolean) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, noCommission: next } : r)))
  }

  async function handleSave() {
    if (!isAdmin) {
      toast.error('Only admins can change doctor links.')
      return
    }
    try {
      await saveMutation.mutateAsync(
        rows.map((r) => ({
          doctorId: r.doctorId,
          commissionRate: r.commissionRate,
          noCommission: r.noCommission,
        }))
      )
      toast.success(`Doctor links saved (${rows.length}).`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save doctor links')
    }
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2">
          <UserRound className="h-4 w-4" />
          Doctors & commission
        </Label>
        <Button
          variant="outline"
          size="sm"
          onClick={handleAdd}
          disabled={!isAdmin || availableSpecialists.length === 0}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add doctor
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
        <Info className="h-3 w-3 mt-[2px] shrink-0" />
        Internal doctors don't earn commission — they're salaried staff. External doctors earn the
        per-link rate, or their default if the rate is left blank. Toggle "No commission" to
        explicitly waive commission on this service.
      </p>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
          No doctors linked yet.
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row, idx) => {
            const s = specialistById.get(row.doctorId)
            const isInternal = s?.specialistType === 'internal'
            const fallback = s?.defaultCommissionRate ?? 0
            const rateDisabled = !isAdmin || isInternal || row.noCommission

            return (
              <div
                key={`${row.doctorId}-${idx}`}
                className="grid grid-cols-[1fr_140px_auto_auto] items-center gap-2 rounded-md border p-2"
              >
                <div className="min-w-0">
                  <Select
                    value={row.doctorId}
                    onValueChange={(v) => handleChangeDoctor(idx, v)}
                    disabled={!isAdmin}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {s && (
                        <SelectItem value={s.id}>
                          {s.name}
                          {s.specialistType === 'internal' ? ' (internal)' : ' (external)'}
                        </SelectItem>
                      )}
                      {availableSpecialists.map((opt) => (
                        <SelectItem key={opt.id} value={opt.id}>
                          {opt.name}
                          {opt.specialistType === 'internal' ? ' (internal)' : ' (external)'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {isInternal ? (
                  <Badge
                    variant="outline"
                    className="h-9 px-2 justify-center text-[11px] border-border text-foreground"
                  >
                    Internal
                  </Badge>
                ) : (
                  <div className="relative">
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      placeholder={row.noCommission ? '—' : `${fallback}% (default)`}
                      value={row.noCommission ? '' : (row.commissionRate ?? '')}
                      onChange={(e) => handleChangeRate(idx, e.target.value)}
                      className="h-9 pr-7"
                      disabled={rateDisabled}
                    />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      %
                    </span>
                  </div>
                )}

                {isInternal ? (
                  <div /> /* placeholder to keep grid columns aligned */
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Switch
                      checked={row.noCommission}
                      onCheckedChange={(v) => handleToggleNoCommission(idx, v)}
                      disabled={!isAdmin}
                      aria-label="No commission"
                    />
                    <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                      No commission
                    </span>
                  </div>
                )}

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => handleRemove(idx)}
                  disabled={!isAdmin}
                  aria-label="Remove doctor"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            )
          })}
        </div>
      )}

      {isAdmin && (
        <div className="flex items-center justify-end">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!dirty || saving}
            variant={dirty ? 'default' : 'outline'}
          >
            {saving ? 'Saving…' : dirty ? 'Save doctor links' : 'Saved'}
          </Button>
        </div>
      )}
    </div>
  )
}
