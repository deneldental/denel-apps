import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Check, Inbox, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { queryKeys } from '@/lib/query-keys'
import { Button } from '@/shared/components/ui/button'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Label } from '@/shared/components/ui/label'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { Textarea } from '@/shared/components/ui/textarea'
import { formatCurrency } from '@/shared/utils/currency'

export interface PaymentConfirmation {
  id: string
  amount: number
  reference: string | null
  note: string | null
  methodLabel: string | null
  status: string
  createdAt: string
  patientId: string
  patientName: string | null
  patientCode: string | null
  invoiceId: string
  invoiceNumber: string | null
  invoiceBalance: number | null
}

export function usePendingConfirmations() {
  return useQuery({
    queryKey: queryKeys.appPayments.confirmations('pending'),
    queryFn: async () => {
      const res = await api.get<PaymentConfirmation[]>('/api/payment-confirmations?status=pending')
      return res.success && res.data ? res.data : []
    },
  })
}

export function PendingConfirmationsTab({ onChanged }: { onChanged?: () => void }) {
  const queryClient = useQueryClient()
  const { data: requests = [], isLoading } = usePendingConfirmations()
  const [confirmTarget, setConfirmTarget] = useState<PaymentConfirmation | null>(null)
  const [rejectTarget, setRejectTarget] = useState<PaymentConfirmation | null>(null)

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: queryKeys.appPayments.all })
    queryClient.invalidateQueries({ queryKey: queryKeys.payments.all })
    queryClient.invalidateQueries({ queryKey: queryKeys.clinicLedger.all })
    onChanged?.()
  }

  const confirmMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post(`/api/payment-confirmations/${id}/confirm`, {})
      if (!res.success) throw new Error(res.error ?? 'Could not confirm')
      return res
    },
    onSuccess: () => {
      toast.success('Payment recorded')
      invalidate()
      setConfirmTarget(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (isLoading) {
    return <Skeleton className="h-40 w-full rounded-xl" />
  }

  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
        <Inbox className="h-10 w-10 text-muted-foreground/30" />
        <p className="font-medium text-muted-foreground">No pending requests</p>
        <p className="text-sm text-muted-foreground/70">
          Payment confirmations submitted from the patient app appear here.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead>Invoice</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link
                    to={`/patients/${r.patientId}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {r.patientName ?? 'Patient'}
                  </Link>
                  {r.patientCode && (
                    <p className="font-mono text-xs text-muted-foreground">{r.patientCode}</p>
                  )}
                </TableCell>
                <TableCell>
                  <Link
                    to={`/invoices/${r.invoiceId}`}
                    className="font-mono text-xs hover:underline"
                  >
                    {r.invoiceNumber ?? '—'}
                  </Link>
                  {r.invoiceBalance != null && (
                    <p className="text-xs text-muted-foreground">
                      Bal {formatCurrency(Number(r.invoiceBalance))}
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-sm">{r.methodLabel ?? '—'}</TableCell>
                <TableCell className="text-sm font-semibold">
                  {formatCurrency(Number(r.amount))}
                </TableCell>
                <TableCell className="max-w-[180px]">
                  {r.reference ? (
                    <span className="text-xs">{r.reference}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                  {r.note && (
                    <p className="truncate text-xs text-muted-foreground italic" title={r.note}>
                      {r.note}
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {format(new Date(r.createdAt), 'MMM d, h:mm a')}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive"
                      onClick={() => setRejectTarget(r)}
                    >
                      <X className="mr-1 h-3.5 w-3.5" />
                      Reject
                    </Button>
                    <Button size="sm" onClick={() => setConfirmTarget(r)}>
                      <Check className="mr-1 h-3.5 w-3.5" />
                      Confirm
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <DeleteConfirmationDialog
        open={!!confirmTarget}
        onOpenChange={(o) => !o && setConfirmTarget(null)}
        onConfirm={async () => {
          if (confirmTarget) await confirmMutation.mutateAsync(confirmTarget.id)
        }}
        title="Record this payment?"
        description={
          confirmTarget
            ? `This records ${formatCurrency(Number(confirmTarget.amount))} from ${
                confirmTarget.patientName ?? 'the patient'
              } against ${confirmTarget.invoiceNumber ?? 'the invoice'} and posts it to the ledger.`
            : ''
        }
        tone="default"
        confirmLabel="Confirm & record"
        isLoading={confirmMutation.isPending}
      />

      <RejectDialog
        request={rejectTarget}
        onClose={() => setRejectTarget(null)}
        onRejected={() => {
          invalidate()
          setRejectTarget(null)
        }}
      />
    </>
  )
}

function RejectDialog({
  request,
  onClose,
  onRejected,
}: {
  request: PaymentConfirmation | null
  onClose: () => void
  onRejected: () => void
}) {
  const [reason, setReason] = useState('')

  const rejectMutation = useMutation({
    mutationFn: async () => {
      if (!request) return
      const res = await api.post(`/api/payment-confirmations/${request.id}/reject`, {
        reason: reason.trim(),
      })
      if (!res.success) throw new Error(res.error ?? 'Could not reject')
      return res
    },
    onSuccess: () => {
      toast.success('Request rejected')
      setReason('')
      onRejected()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog
      open={!!request}
      onOpenChange={(o) => {
        if (!o) {
          setReason('')
          onClose()
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject payment request</DialogTitle>
          <DialogDescription>
            The patient sees this reason in the app. Be specific so they can fix it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor="reject-reason">Reason</Label>
          <Textarea
            id="reject-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. We couldn't find this transfer — please check the reference and resend."
            rows={3}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => rejectMutation.mutate()}
            disabled={!reason.trim() || rejectMutation.isPending}
          >
            {rejectMutation.isPending ? 'Rejecting…' : 'Reject request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
