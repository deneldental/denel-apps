import { Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { createEstimate, createStandaloneEstimate } from '@/lib/actions/worklist'
import { PatientPicker } from '@/shared/components/patient-picker'
import {
  computeServiceLinesTotal,
  previewServiceLine,
  type ServiceLine,
  ServiceLinesEditor,
  serviceLinesNeedSurchargeConfirm,
  useServiceCatalog,
} from '@/shared/components/service-lines-editor'
import { Button } from '@/shared/components/ui/button'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import { Label } from '@/shared/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { Textarea } from '@/shared/components/ui/textarea'
import { inputToCents } from '@/shared/utils/currency'
import { ghs } from './shared'

interface Props {
  appointmentId?: string
  patientId?: string
  patientName?: string
  planId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

/**
 * Create-estimate dialog (build plan P3). The doctor picks services and, per line,
 * a variant / tooth-class / quantity from the pricing matrix; the total previews
 * live. Submitting builds a draft-invoice estimate the reception later confirms.
 */
export function CreateEstimateSheet({
  appointmentId,
  patientId,
  patientName,
  planId,
  open,
  onOpenChange,
  onCreated,
}: Props) {
  const [lines, setLines] = useState<ServiceLine[]>([])
  const [note, setNote] = useState('')
  const [visitFrequency, setVisitFrequency] = useState<'single' | 'multiple'>('single')
  const [saving, setSaving] = useState(false)
  const [localPatientId, setLocalPatientId] = useState<string | null>(patientId ?? null)

  useEffect(() => {
    if (open) {
      setLocalPatientId(patientId ?? null)
    }
  }, [open, patientId])

  const services = useServiceCatalog(open)

  useEffect(() => {
    if (!open) {
      setLines([])
      setNote('')
    }
  }, [open])

  const total = useMemo(() => computeServiceLinesTotal(lines), [lines])

  const [confirmSurchargeOpen, setConfirmSurchargeOpen] = useState(false)

  function handleSubmit() {
    if (lines.length === 0) {
      toast.error('Add at least one service')
      return
    }
    if (serviceLinesNeedSurchargeConfirm(lines)) {
      setConfirmSurchargeOpen(true)
      return
    }
    void doCreate()
  }

  async function doCreate() {
    setSaving(true)

    const targetPatientId = localPatientId || patientId

    const isStandalone = !appointmentId || (localPatientId && localPatientId !== patientId)

    if (isStandalone && !targetPatientId) {
      toast.error('Please select a patient')
      setSaving(false)
      return
    }

    const mappedLines = lines.map((l) => ({
      serviceId: l.serviceId,
      variantName: l.variantName || null,
      toothClassId: l.toothClassId || null,
      quantity: previewServiceLine(l).quantity,
      surcharge:
        l.surchargeType !== 'none' && l.surchargeValue > 0
          ? {
              type: l.surchargeType as 'percent' | 'amount',
              value:
                l.surchargeType === 'amount' ? inputToCents(l.surchargeValue) : l.surchargeValue,
            }
          : null,
      discount:
        l.discountType !== 'none' && l.discountValue > 0
          ? {
              type: l.discountType as 'percent' | 'amount',
              value: l.discountType === 'amount' ? inputToCents(l.discountValue) : l.discountValue,
              reason: l.discountReason || null,
            }
          : null,
    }))

    const res =
      !isStandalone && appointmentId
        ? await createEstimate(appointmentId, mappedLines, note.trim() || null, visitFrequency)
        : await createStandaloneEstimate(
            targetPatientId!,
            mappedLines,
            note.trim() || null,
            visitFrequency,
            planId
          )

    setSaving(false)
    if (!res.success) {
      toast.error(res.error || 'Failed to create estimate')
      return
    }
    toast.success(
      appointmentId ? 'Estimate ready — sent to reception.' : 'Estimate created successfully.'
    )
    onOpenChange(false)
    onCreated()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>Create estimate{patientName ? ` — ${patientName}` : ''}</SheetTitle>
          <SheetDescription>
            Pick services and set the variant, tooth class, and quantity. The total previews live.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 pt-4">
          {!planId && !patientId && (
            <div className="space-y-1.5">
              <Label>Patient</Label>
              <PatientPicker
                value={localPatientId ?? ''}
                onChange={(id) => setLocalPatientId(id)}
              />
            </div>
          )}

          <ServiceLinesEditor services={services} lines={lines} setLines={setLines} />

          <div className="space-y-1.5">
            <Label>Note (optional)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Anything reception should know…"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Visit frequency</Label>
            <div className="flex bg-muted p-1 rounded-lg w-fit">
              <button
                type="button"
                className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${
                  visitFrequency === 'single'
                    ? 'bg-background shadow text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setVisitFrequency('single')}
              >
                Single visit
              </button>
              <button
                type="button"
                className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${
                  visitFrequency === 'multiple'
                    ? 'bg-background shadow text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setVisitFrequency('multiple')}
              >
                Multiple visits
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-muted/40 p-3">
            <span className="text-sm text-muted-foreground">Estimated total</span>
            <span className="text-lg font-semibold">{ghs(total)}</span>
          </div>
          <div className="flex items-center justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                saving || lines.length === 0 || (!localPatientId && !patientId && !appointmentId)
              }
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create estimate
            </Button>
          </div>
        </div>
      </SheetContent>

      <DeleteConfirmationDialog
        open={confirmSurchargeOpen}
        onOpenChange={setConfirmSurchargeOpen}
        onConfirm={doCreate}
        tone="default"
        confirmLabel="Add anyway"
        title="Large surcharge"
        description="One or more surcharges more than double a line's standard price. Double-check the entered value before continuing — this can't be undone once the estimate is sent to reception."
      />
    </Sheet>
  )
}
