import { useState } from 'react'
import { toast } from 'sonner'
import { useToothNotation } from '@/features/clinical/use-clinical-preferences'
import { api } from '@/lib/api-client'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { Button } from '@/shared/components/ui/button'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
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
import { SignaturePad } from '@/shared/components/ui/signature-pad'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'
import { ensureUploaded, uploadSignature } from '@/shared/lib/upload-blob'
import { formatAmount } from '@/shared/utils/currency'
import type { TreatmentPlan } from '../types'

const VALID_RELATIONSHIPS = ['self', 'guardian', 'spouse', 'other'] as const
type Relationship = (typeof VALID_RELATIONSHIPS)[number]

function coerceRelationship(value: string | undefined | null): Relationship {
  return VALID_RELATIONSHIPS.includes(value as Relationship) ? (value as Relationship) : 'self'
}

interface Props {
  plan: TreatmentPlan
  open: boolean
  onClose: () => void
  onAccepted: () => void
}

/**
 * Full-screen-ish dialog for presenting a plan to the patient.
 * Shows read-only summary + cost, collects signature.
 */
export function TreatmentPlanPresentDialog({ plan, open, onClose, onAccepted }: Props) {
  const { toothLabel } = useToothNotation()
  const [signature, setSignature] = useState<string | null>(plan.signatureData ?? null)
  const [signedByName, setSignedByName] = useState(plan.signedByName ?? '')
  const [relationship, setRelationship] = useState<Relationship>(
    coerceRelationship(plan.signedRelationship)
  )
  const [declineOpen, setDeclineOpen] = useState(false)
  const [declining, setDeclining] = useState(false)

  const { isSubmitting, submit } = useSubmitGuard()

  const isDirty =
    signature !== (plan.signatureData ?? null) ||
    signedByName !== (plan.signedByName ?? '') ||
    relationship !== coerceRelationship(plan.signedRelationship)

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose,
  })

  const planIsFinalized = plan.status === 'accepted' || plan.status === 'declined'

  async function accept() {
    await submit(async () => {
      if (!signature) {
        toast.error('Patient signature is required')
        return
      }
      if (!signedByName.trim()) {
        toast.error('Name of signer is required')
        return
      }
      // If the signature is a freshly captured data URL, upload to R2 first and
      // persist the public URL. Already-uploaded URLs (re-opened dialog) pass
      // through unchanged.
      let signatureUrl: string | null
      try {
        signatureUrl = await ensureUploaded(signature, (blob) =>
          uploadSignature(blob, { kind: 'treatment-plan', patientId: plan.patientId })
        )
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to upload signature'
        toast.error(message)
        return
      }
      const res = await api.patch(`/api/treatment-plans/${plan.id}`, {
        status: 'accepted',
        signatureData: signatureUrl,
        signedByName: signedByName.trim(),
        signedRelationship: relationship,
      })
      if (res.success) {
        toast.success('Plan accepted')
        onAccepted()
      } else {
        surfaceApiError(res, 'Failed to save')
      }
    })
  }

  async function confirmDecline() {
    setDeclining(true)
    try {
      const res = await api.patch(`/api/treatment-plans/${plan.id}`, { status: 'declined' })
      if (res.success) {
        toast.success('Plan marked as declined')
        setDeclineOpen(false)
        onAccepted()
      } else {
        surfaceApiError(res, 'Failed to mark as declined')
        throw new Error('decline failed')
      }
    } finally {
      setDeclining(false)
    }
  }

  // Group items by phase
  const itemsByPhase: Record<number, typeof plan.items> = {}
  for (const it of plan.items) {
    if (!itemsByPhase[it.phase]) itemsByPhase[it.phase] = []
    itemsByPhase[it.phase].push(it)
  }

  return (
    <Dialog open={open} onOpenChange={guardedOnOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Treatment Plan — {plan.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {plan.notes && (
            <div className="rounded-md bg-muted/30 border border-border px-3 py-2">
              <p className="text-sm">{plan.notes}</p>
            </div>
          )}

          {/* Plan details — phased */}
          <div className="space-y-3">
            {Object.keys(itemsByPhase)
              .sort((a, b) => Number(a) - Number(b))
              .map((phaseStr) => {
                const phase = Number(phaseStr)
                const phaseItems = itemsByPhase[phase]
                const phaseTotal = phaseItems.reduce((s, i) => s + i.estimatedCost, 0)
                return (
                  <div key={phase} className="rounded-lg border border-border overflow-hidden">
                    <div className="px-3 py-2 bg-muted/30 border-b border-border flex items-center justify-between">
                      <span className="text-sm font-medium">Phase {phase}</span>
                      <span className="text-sm font-medium">
                        GHS {formatAmount(Number(phaseTotal))}
                      </span>
                    </div>
                    <table className="w-full text-sm">
                      <thead className="text-xs text-muted-foreground">
                        <tr>
                          <th className="text-left px-3 py-1.5">Procedure</th>
                          <th className="text-left px-3 py-1.5 w-16">Tooth</th>
                          <th className="text-right px-3 py-1.5 w-28">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {phaseItems.map((item) => (
                          <tr key={item.id} className="border-t border-border">
                            <td className="px-3 py-2">
                              {item.procedureName}
                              {item.notes && (
                                <p className="text-xs text-muted-foreground">{item.notes}</p>
                              )}
                            </td>
                            <td className="px-3 py-2 font-mono text-xs">
                              {item.toothNumber != null ? toothLabel(item.toothNumber) : '—'}
                            </td>
                            <td className="px-3 py-2 text-right">
                              GHS {formatAmount(Number(item.estimatedCost))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              })}
          </div>

          <div className="flex items-center justify-between rounded-md bg-card border border-border px-4 py-3">
            <span className="text-base font-medium">Total Estimate</span>
            <span className="text-2xl font-bold">
              GHS {formatAmount(Number(plan.totalEstimated))}
            </span>
          </div>

          {/* Signature block */}
          <div className="rounded-lg border border-border p-4 space-y-3">
            <p className="text-sm font-medium">Patient Acknowledgment &amp; Signature</p>
            <p className="text-xs text-muted-foreground">
              By signing below, the patient (or authorized representative) acknowledges
              understanding of the proposed treatment plan, the estimated costs, and consents to
              proceed with the listed procedures.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="signed-by-name" className="text-xs">
                  Signed by (full name)
                </Label>
                <Input
                  id="signed-by-name"
                  value={signedByName}
                  onChange={(e) => setSignedByName(e.target.value)}
                  placeholder="Patient or representative name"
                  maxLength={100}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signed-relationship" className="text-xs">
                  Relationship
                </Label>
                <Select
                  value={relationship}
                  onValueChange={(v) => setRelationship(coerceRelationship(v))}
                >
                  <SelectTrigger id="signed-relationship">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="self">Self (patient)</SelectItem>
                    <SelectItem value="guardian">Guardian / Parent</SelectItem>
                    <SelectItem value="spouse">Spouse</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-xs mb-1.5 block">Signature</Label>
              <SignaturePad
                value={signature}
                onChange={setSignature}
                disabled={isSubmitting || planIsFinalized}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setDeclineOpen(true)}
            className="text-destructive mr-auto"
            disabled={isSubmitting || planIsFinalized}
          >
            Mark as Declined
          </Button>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={accept} disabled={isSubmitting || planIsFinalized}>
            {isSubmitting ? 'Saving…' : 'Accept & Sign'}
          </Button>
        </DialogFooter>
      </DialogContent>

      <DeleteConfirmationDialog
        open={declineOpen}
        onOpenChange={setDeclineOpen}
        onConfirm={confirmDecline}
        title="Mark plan as declined?"
        description="The plan stays on file with a 'declined' status. You can present it again later."
        tone="default"
        confirmLabel="Mark declined"
        isLoading={declining}
      />

      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </Dialog>
  )
}
