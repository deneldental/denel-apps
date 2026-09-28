// Compensation step on the staff profile.
//
// Trimmed (Phase 5) to just the bank payout details — the base-salary history,
// allowances/deductions, loans/advances, and tax-ID panels were removed from
// this surface. The Payslip Builder + Payslip History (rendered by the detail
// page above this step) cover the payroll workflow.

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@denel/ui'
import { CreditCard, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { updateStaff } from '@/lib/actions/staff'

/** Minimum shape required by CompensationStep / BankDetailsCard. */
interface StaffRecord {
  id: string
  bankName: string | null
  bankAccountName: string | null
  bankAccountNumber: string | null
}

export function CompensationStep({ staff }: { staffId: string; staff: StaffRecord }) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Compensation &amp; Benefits</h2>
        <p className="text-sm text-muted-foreground">The bank account payroll pays into.</p>
      </div>

      <BankDetailsCard staff={staff} />
    </div>
  )
}

// ── Bank details (payment method) ─────────────────────────────────────────
//
// Bank only — mobile money is intentionally not editable here (Phase 5).

function BankDetailsCard({ staff }: { staff: StaffRecord }) {
  const [bankName, setBankName] = useState<string>(staff.bankName ?? '')
  const [bankAccountName, setBankAccountName] = useState<string>(staff.bankAccountName ?? '')
  const [bankAccountNumber, setBankAccountNumber] = useState<string>(staff.bankAccountNumber ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setBankName(staff.bankName ?? '')
    setBankAccountName(staff.bankAccountName ?? '')
    setBankAccountNumber(staff.bankAccountNumber ?? '')
  }, [staff.bankName, staff.bankAccountName, staff.bankAccountNumber])

  const isDirty =
    bankName !== (staff.bankName ?? '') ||
    bankAccountName !== (staff.bankAccountName ?? '') ||
    bankAccountNumber !== (staff.bankAccountNumber ?? '')

  async function handleSave() {
    setSaving(true)
    const res = await updateStaff(staff.id, {
      bankName: bankName.trim() || null,
      bankAccountName: bankAccountName.trim() || null,
      bankAccountNumber: bankAccountNumber.trim() || null,
    } as Record<string, unknown>)
    setSaving(false)
    if (!res.success) {
      toast.error(res.error || 'Failed to save bank details')
      return
    }
    toast.success('Bank details saved')
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-1.5">
          <CreditCard className="h-4 w-4" />
          Payment method — Bank
        </CardTitle>
        <CardDescription>
          The bank account payroll pays into. Optional; leave blank for non-bank payouts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="bank-name" className="text-xs">
              Bank name
            </Label>
            <Input
              id="bank-name"
              placeholder="e.g. GCB"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bank-acct-name" className="text-xs">
              Account name
            </Label>
            <Input
              id="bank-acct-name"
              value={bankAccountName}
              onChange={(e) => setBankAccountName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bank-acct-number" className="text-xs">
              Account number
            </Label>
            <Input
              id="bank-acct-number"
              value={bankAccountNumber}
              onChange={(e) => setBankAccountNumber(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={!isDirty || saving}>
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
