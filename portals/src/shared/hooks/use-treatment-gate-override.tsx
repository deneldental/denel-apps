import { AlertTriangle } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import type { ApiResponse } from '@/lib/api-client'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Label } from '@/shared/components/ui/label'
import { Textarea } from '@/shared/components/ui/textarea'
import { usePermissions } from '@/shared/hooks/use-permissions'

/**
 * The 402 body the treatment payment gate returns. It carries the outstanding
 * balance and `overridable` so the client can offer the escape hatch without
 * having to re-derive whether one exists.
 */
export interface TreatmentGateBlock {
  error: string
  reason: string
  invoiceNumber: string | null
  balance: number
  overridable: true
}

/** Narrow a failed response to a gate block. */
export function isTreatmentGateBlock(res: unknown): res is TreatmentGateBlock {
  return (
    typeof res === 'object' &&
    res !== null &&
    (res as { overridable?: unknown }).overridable === true &&
    typeof (res as { error?: unknown }).error === 'string'
  )
}

/** What the caller re-sends on the retry. Spread into the original request body. */
export interface OverridePayload {
  override: true
  overrideReason: string
}

/**
 * Admin override for the treatment payment gate.
 *
 * The backend refuses unfunded treatment with a 402 and audits any override, but
 * it can only audit one it is actually told about. Without this dialog the only
 * way past a genuine emergency is switching the whole gate off — which is the
 * outcome the audited override exists to prevent.
 *
 *   const { promptOverride, overrideDialog } = useTreatmentGateOverride()
 *
 *   const res = await save()
 *   if (!res.success) {
 *     if (promptOverride(res, (o) => save(o))) return   // dialog took it from here
 *     surfaceApiError(res, 'Failed to save')
 *   }
 *   return (<>…{overrideDialog}</>)
 *
 * `promptOverride` returns true when it has taken responsibility for the
 * failure, so the caller knows not to also show an error toast.
 */
export function useTreatmentGateOverride() {
  const { isAdmin } = usePermissions()
  const [block, setBlock] = useState<TreatmentGateBlock | null>(null)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const retryRef = useRef<((payload: OverridePayload) => Promise<unknown>) | null>(null)

  const close = useCallback(() => {
    setBlock(null)
    setReason('')
    retryRef.current = null
  }, [])

  /**
   * Offer an override for a failed response. Returns false — meaning "not
   * handled, show your own error" — when the failure is not a gate block, or
   * when the user is not an admin and so has nothing to offer.
   */
  const promptOverride = useCallback(
    (
      res: ApiResponse<unknown> | unknown,
      retry: (payload: OverridePayload) => Promise<unknown>
    ) => {
      if (!isTreatmentGateBlock(res) || !isAdmin) return false
      retryRef.current = retry
      setBlock(res)
      setReason('')
      return true
    },
    [isAdmin]
  )

  async function submit() {
    const trimmed = reason.trim()
    // The backend rejects a blank reason too; blocking here keeps the user from
    // a pointless round-trip and makes the requirement obvious.
    if (!trimmed || !retryRef.current) return
    setSubmitting(true)
    try {
      await retryRef.current({ override: true, overrideReason: trimmed })
      close()
    } finally {
      setSubmitting(false)
    }
  }

  const overrideDialog = (
    <Dialog open={!!block} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Proceed without payment?
          </DialogTitle>
          <DialogDescription>{block?.error}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            This is recorded against your name in the audit log, with the reason you give below.
            Prefer taking a deposit or setting up a payment plan where you can.
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gate-override-reason" className="text-xs">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="gate-override-reason"
              rows={3}
              autoFocus
              placeholder="Why is this treatment proceeding before payment?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={submitting || reason.trim().length === 0}
          >
            {submitting ? 'Recording…' : 'Override and proceed'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { promptOverride, overrideDialog, isOverridePending: !!block }
}
