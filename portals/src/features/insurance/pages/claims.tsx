import { Loader2, Plus, Receipt } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  approveClaim,
  createInsuranceClaim,
  deleteClaim,
  denyClaim,
  getInsuranceClaims,
  type InsuranceClaim,
  payClaim,
  submitClaim,
} from '@/lib/actions/insurance-claims'
import { api } from '@/lib/api-client'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { PatientPicker } from '@/shared/components/patient-picker'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
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
import { formatAmount } from '@/shared/utils/currency'
import type { InsuranceCompany } from '../types'

const ghs = (n: number | null) => (n == null ? '—' : `GHS ${formatAmount(Number(n))}`)

const STATUS: Record<
  InsuranceClaim['status'],
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  pending: { label: 'Pending', variant: 'secondary' },
  submitted: { label: 'Submitted', variant: 'outline' },
  approved: { label: 'Approved', variant: 'default' },
  denied: { label: 'Denied', variant: 'destructive' },
  paid: { label: 'Paid', variant: 'default' },
}

const CLAIMS_KEY = queryKeys.insurance.claims()
const COMPANIES_KEY = queryKeys.insurance.companiesFull()

export default function InsuranceClaimsPage() {
  const [newOpen, setNewOpen] = useState(false)
  const [companyId, setCompanyId] = useState('')
  const [patientId, setPatientId] = useState('')
  const [amount, setAmount] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const claimsQuery = useApiQuery<InsuranceClaim[]>(CLAIMS_KEY, () => getInsuranceClaims())
  const claims = claimsQuery.data ?? []
  const companiesQuery = useApiQuery<InsuranceCompany[]>(COMPANIES_KEY, () =>
    api.get<InsuranceCompany[]>('/api/insurance/companies')
  )
  const companies = (companiesQuery.data ?? []).filter((c) => c.active)
  const loading = claimsQuery.isLoading || companiesQuery.isLoading

  const createMutation = useApiMutation(createInsuranceClaim, { invalidates: [CLAIMS_KEY] })
  const submitMutation = useApiMutation((id: string) => submitClaim(id), {
    invalidates: [CLAIMS_KEY],
  })
  const deleteMutation = useApiMutation((id: string) => deleteClaim(id), {
    invalidates: [CLAIMS_KEY],
  })
  const approveMutation = useApiMutation((id: string) => approveClaim(id), {
    invalidates: [CLAIMS_KEY],
  })
  const denyMutation = useApiMutation(
    (vars: { id: string; reason: string }) => denyClaim(vars.id, vars.reason),
    { invalidates: [CLAIMS_KEY] }
  )
  const payMutation = useApiMutation((id: string) => payClaim(id), { invalidates: [CLAIMS_KEY] })
  const saving = createMutation.isPending

  async function handleCreate() {
    const charged = Number(amount)
    if (!companyId || !patientId || !Number.isFinite(charged) || charged <= 0) {
      toast.error('Pick a company + patient and enter an amount')
      return
    }
    try {
      await createMutation.mutateAsync({ companyId, patientId, chargedAmount: charged })
      toast.success('Claim created')
      setNewOpen(false)
      setCompanyId('')
      setPatientId('')
      setAmount('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create claim')
    }
  }

  async function runAction<TVars>(
    id: string,
    mutation: { mutateAsync: (vars: TVars) => Promise<unknown> },
    vars: TVars,
    ok: string
  ) {
    setBusyId(id)
    try {
      await mutation.mutateAsync(vars)
      toast.success(ok)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Claims</h1>
          <p className="text-sm text-muted-foreground">
            Submit and track insurer claims. A claim can only be submitted once the insurer's
            pricing has no rows pending approval.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New claim
        </Button>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
      ) : claims.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed py-12 text-center">
          <Receipt className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No claims yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Claim #</th>
                <th className="px-3 py-2 text-left">Insurer</th>
                <th className="px-3 py-2 text-left">Patient</th>
                <th className="px-3 py-2 text-right">Charged</th>
                <th className="px-3 py-2 text-right">Approved</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((cl) => {
                const busy = busyId === cl.id
                return (
                  <tr key={cl.id} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{cl.claimNumber ?? '—'}</td>
                    <td className="px-3 py-2">{cl.companyName ?? '—'}</td>
                    <td className="px-3 py-2">{cl.patientName ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{ghs(cl.chargedAmount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{ghs(cl.approvedAmount)}</td>
                    <td className="px-3 py-2">
                      <Badge variant={STATUS[cl.status].variant} className="text-[10px]">
                        {STATUS[cl.status].label}
                      </Badge>
                      {cl.status === 'denied' && cl.denialReason && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({cl.denialReason})
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {cl.status === 'pending' && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => runAction(cl.id, submitMutation, cl.id, 'Submitted')}
                            >
                              Submit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              disabled={busy}
                              onClick={() => runAction(cl.id, deleteMutation, cl.id, 'Deleted')}
                            >
                              Delete
                            </Button>
                          </>
                        )}
                        {cl.status === 'submitted' && (
                          <>
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() => runAction(cl.id, approveMutation, cl.id, 'Approved')}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                runAction(
                                  cl.id,
                                  denyMutation,
                                  { id: cl.id, reason: 'Denied by insurer' },
                                  'Denied'
                                )
                              }
                            >
                              Deny
                            </Button>
                          </>
                        )}
                        {cl.status === 'approved' && (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => runAction(cl.id, payMutation, cl.id, 'Marked paid')}
                          >
                            Mark paid
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* New claim */}
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New claim</DialogTitle>
            <DialogDescription>File an insurer claim for a patient's charge.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Insurance company</Label>
              <Select value={companyId} onValueChange={setCompanyId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Patient</Label>
              <PatientPicker value={patientId} onChange={(id) => setPatientId(id)} />
            </div>
            <div className="space-y-1.5">
              <Label>Charged amount (GHS)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create claim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
