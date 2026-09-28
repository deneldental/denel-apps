import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, Building2, CreditCard, Pencil, Plus, Smartphone, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
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
import { Textarea } from '@/shared/components/ui/textarea'

interface AppPaymentMethod {
  id: string
  label: string
  type: string
  instructions: string | null
  isActive: boolean
  sortOrder: number
}

const TYPE_OPTIONS = [
  { value: 'bank', label: 'Bank transfer', icon: Building2 },
  { value: 'momo', label: 'Mobile money', icon: Smartphone },
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'other', label: 'Other', icon: CreditCard },
] as const

function TypeIcon({ type, className }: { type: string; className?: string }) {
  const opt = TYPE_OPTIONS.find((o) => o.value === type) ?? TYPE_OPTIONS[3]
  const Icon = opt.icon
  return <Icon className={className} />
}

export default function PaymentMethodsPage() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<AppPaymentMethod | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AppPaymentMethod | null>(null)

  const { data: methods = [], isLoading } = useQuery({
    queryKey: queryKeys.appPayments.methods(),
    queryFn: async () => {
      const res = await api.get<AppPaymentMethod[]>('/api/app-payment-methods')
      return res.success && res.data ? res.data : []
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.delete(`/api/app-payment-methods/${id}`)
      if (!res.success) throw new Error(res.error ?? 'Could not delete')
      return res
    },
    onSuccess: () => {
      toast.success('Payment method removed')
      queryClient.invalidateQueries({ queryKey: queryKeys.appPayments.methods() })
      setDeleteTarget(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const toggleMutation = useMutation({
    mutationFn: async (m: AppPaymentMethod) => {
      const res = await api.patch(`/api/app-payment-methods/${m.id}`, { isActive: !m.isActive })
      if (!res.success) throw new Error(res.error ?? 'Could not update')
      return res
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.appPayments.methods() })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }

  function openEdit(m: AppPaymentMethod) {
    setEditing(m)
    setDialogOpen(true)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Patient App Payment Methods</h1>
          <p className="text-muted-foreground">
            Options patients see when paying an invoice in the app — with the details they need to
            send money.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add method
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ) : methods.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <CreditCard className="h-10 w-10 text-muted-foreground/30" />
          <p className="font-medium text-muted-foreground">No payment methods yet</p>
          <p className="text-sm text-muted-foreground/70">
            Add a bank account or mobile-money number patients can pay into.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {methods.map((m) => (
            <div
              key={m.id}
              className="flex items-start gap-4 rounded-xl border border-border bg-card p-4"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <TypeIcon type={m.type} className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{m.label}</p>
                  {!m.isActive && (
                    <Badge variant="outline" className="text-xs">
                      Hidden
                    </Badge>
                  )}
                </div>
                {m.instructions && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {m.instructions}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <div className="mr-1 flex items-center gap-2">
                  <Switch
                    checked={m.isActive}
                    onCheckedChange={() => toggleMutation.mutate(m)}
                    aria-label="Active"
                  />
                </div>
                <Button variant="ghost" size="icon" onClick={() => openEdit(m)} aria-label="Edit">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setDeleteTarget(m)}
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <MethodDialog
        open={dialogOpen}
        method={editing}
        onOpenChange={setDialogOpen}
        onSaved={() => {
          setDialogOpen(false)
          queryClient.invalidateQueries({ queryKey: queryKeys.appPayments.methods() })
        }}
      />

      <DeleteConfirmationDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        onConfirm={async () => {
          if (deleteTarget) await deleteMutation.mutateAsync(deleteTarget.id)
        }}
        title="Remove payment method?"
        description={`"${deleteTarget?.label}" will no longer show in the patient app. Existing payment records are unaffected.`}
        confirmLabel="Remove"
        isLoading={deleteMutation.isPending}
      />
    </div>
  )
}

function MethodDialog({
  open,
  method,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  method: AppPaymentMethod | null
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const [label, setLabel] = useState('')
  const [type, setType] = useState('bank')
  const [instructions, setInstructions] = useState('')
  const [isActive, setIsActive] = useState(true)

  // Reseed the form each time the dialog opens.
  useEffect(() => {
    if (open) {
      setLabel(method?.label ?? '')
      setType(method?.type ?? 'bank')
      setInstructions(method?.instructions ?? '')
      setIsActive(method?.isActive ?? true)
    }
  }, [open, method])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        label: label.trim(),
        type,
        instructions: instructions.trim() || null,
        isActive,
      }
      const res = method
        ? await api.patch(`/api/app-payment-methods/${method.id}`, body)
        : await api.post('/api/app-payment-methods', body)
      if (!res.success) throw new Error(res.error ?? 'Could not save')
      return res
    },
    onSuccess: () => {
      toast.success(method ? 'Payment method updated' : 'Payment method added')
      onSaved()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{method ? 'Edit payment method' : 'Add payment method'}</DialogTitle>
          <DialogDescription>
            What patients see when they tap "Pay now" on an invoice.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="m-label">Label</Label>
            <Input
              id="m-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. GCB Bank or MTN MoMo"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="m-type">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="m-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="m-instructions">Details / instructions</Label>
            <Textarea
              id="m-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={
                'e.g.\nAccount name: Denel Dental\nAccount no: 1234567890\nBranch: Accra'
              }
              rows={4}
            />
            <p className="text-xs text-muted-foreground">
              Shown to the patient once they pick this method. Include the account number / phone.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-muted-foreground">Show this method in the patient app.</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!label.trim() || saveMutation.isPending}
          >
            {saveMutation.isPending ? 'Saving…' : method ? 'Save changes' : 'Add method'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
