import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@denel/ui'
import { Edit, Loader2, Percent, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  createTaxBracket,
  deleteTaxBracket,
  getTaxBrackets,
  seedTaxBrackets,
  type TaxBracketRow,
  updateTaxBracket,
} from '@/lib/actions/tax-brackets'
import { api } from '@/lib/api-client'
import { StatusBadge } from '@/shared/components/status-badge'
import { TagBadge } from '@/shared/components/tag-badge'
import { useConfirm } from '@/shared/hooks/use-confirm'

interface TaxConfig {
  id: string
  taxType: string
  rate: number | string
  applicableTo: string
  effectiveFrom: string
  effectiveTo: string | null
  isActive: boolean
  notes: string | null
}

const TAX_TYPES = ['VAT', 'NHIL', 'GETFund', 'WHT_Services', 'WHT_Insurance', 'CIT_Rate'] as const
const APPLICABLE = ['income', 'expenses', 'contractors'] as const

const pct = (r: number | string) => `${(Number(r) * 100).toFixed(2)}%`
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—')

export default function TaxConfigurationPage() {
  const [activeTab, setActiveTab] = useState('general')
  const [rows, setRows] = useState<TaxConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const { confirm, confirmDialog } = useConfirm()

  // Payroll tax brackets states
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString())
  const [payrollBrackets, setPayrollBrackets] = useState<TaxBracketRow[]>([])
  const [payrollLoading, setPayrollLoading] = useState(false)
  const [seedingLoading, setSeedingLoading] = useState(false)
  const [bracketDialogOpen, setBracketDialogOpen] = useState(false)
  const [editingBracket, setEditingBracket] = useState<TaxBracketRow | null>(null)
  const [bracketForm, setBracketForm] = useState({
    taxType: 'paye' as 'paye' | 'ssnit_employee' | 'ssnit_employer',
    lowerBoundMonthly: '',
    upperBoundMonthly: '',
    ratePercent: '',
    isActive: true,
  })

  const loadGeneralTaxes = useCallback(async () => {
    setLoading(true)
    const res = await api.get<TaxConfig[]>('/api/tax-configurations')
    if (res.success && res.data) setRows(res.data)
    setLoading(false)
  }, [])

  const loadPayrollBrackets = useCallback(async () => {
    setPayrollLoading(true)
    const res = await getTaxBrackets(Number(selectedYear))
    if (res.success && res.data) {
      setPayrollBrackets(res.data.rows)
    } else {
      setPayrollBrackets([])
    }
    setPayrollLoading(false)
  }, [selectedYear])

  useEffect(() => {
    void loadGeneralTaxes()
  }, [loadGeneralTaxes])

  useEffect(() => {
    if (activeTab === 'payroll') {
      void loadPayrollBrackets()
    }
  }, [activeTab, loadPayrollBrackets])

  const active = rows.filter((r) => r.isActive)
  const history = rows.filter((r) => !r.isActive)

  async function handleSeedBrackets() {
    const ok = await confirm({
      title: 'Seed standard tax brackets',
      description: `This fills in the standard progressive tax brackets and SSNIT contributions ${selectedYear} is missing. Rates already configured for ${selectedYear} are left as they are.`,
      confirmLabel: 'Seed brackets',
      tone: 'default',
    })
    if (!ok) return

    setSeedingLoading(true)
    // Additive: the backend seeds only the tax types this year has no rows
    // for. Nothing is deleted, so a published payroll run over this year is
    // not disturbed and cannot block the seed.
    const res = await seedTaxBrackets(Number(selectedYear))
    setSeedingLoading(false)

    if (res.success) {
      const { inserted = 0, skipped = [] } = res.data ?? {}
      toast.success(
        skipped.length > 0
          ? `Added ${inserted} bracket${inserted === 1 ? '' : 's'} for ${selectedYear}. Existing ${skipped.join(' and ')} rates were left unchanged.`
          : `Standard tax brackets successfully seeded for ${selectedYear}.`
      )
      void loadPayrollBrackets()
      return
    }

    // Every type is already populated — the only thing left is the
    // destructive re-seed, so ask for it explicitly rather than silently
    // wiping rates the operator may have hand-tuned.
    if (res.code === 'YEAR_NOT_EMPTY') {
      await handleReplaceBrackets()
      return
    }

    toast.error(res.error || 'Failed to seed brackets')
  }

  async function handleReplaceBrackets() {
    const ok = await confirm({
      title: `Replace all ${selectedYear} brackets?`,
      description: `${selectedYear} already has every tax type configured. Replacing deletes all ${payrollBrackets.length} bracket rows for the year — including any rate edited by hand — and re-seeds the standard defaults. This cannot be undone.`,
      confirmLabel: 'Delete and re-seed',
      tone: 'destructive',
    })
    if (!ok) return

    setSeedingLoading(true)
    const res = await seedTaxBrackets(Number(selectedYear), true)
    setSeedingLoading(false)

    if (res.success) {
      toast.success(`${selectedYear} brackets replaced with the standard defaults.`)
      void loadPayrollBrackets()
      return
    }

    // A run that already computed against these rates blocks the wipe: its
    // payslips would stop reconciling with the DB rows behind them.
    if (res.code === 'ACTIVE_RUNS_EXIST') {
      const runs = (res.data as { runs?: Array<{ name: string; status: string }> } | undefined)
        ?.runs
      toast.error(
        runs?.length
          ? `Cannot replace ${selectedYear} — ${runs.map((r) => `"${r.name}" (${r.status})`).join(', ')} ${runs.length === 1 ? 'is' : 'are'} not archived. Archive from Payroll first, or edit the brackets individually instead.`
          : res.error || 'Failed to replace brackets',
        { duration: 10000 }
      )
      return
    }

    toast.error(res.error || 'Failed to replace brackets')
  }

  function handleAddBracketClick() {
    setEditingBracket(null)
    setBracketForm({
      taxType: 'paye',
      lowerBoundMonthly: '',
      upperBoundMonthly: '',
      ratePercent: '',
      isActive: true,
    })
    setBracketDialogOpen(true)
  }

  function handleEditBracketClick(row: TaxBracketRow) {
    setEditingBracket(row)
    setBracketForm({
      taxType: row.taxType,
      lowerBoundMonthly: String(row.lowerBoundMonthly),
      upperBoundMonthly: row.upperBoundMonthly ? String(row.upperBoundMonthly) : '',
      ratePercent: String(row.ratePercent),
      isActive: row.isActive,
    })
    setBracketDialogOpen(true)
  }

  async function handleSaveBracket() {
    const rate = Number(bracketForm.ratePercent)
    if (Number.isNaN(rate) || rate < 0 || rate > 100) {
      toast.error('Rate must be between 0 and 100%')
      return
    }

    const lower = Number(bracketForm.lowerBoundMonthly || 0)
    if (bracketForm.taxType === 'paye' && (Number.isNaN(lower) || lower < 0)) {
      toast.error('Lower bound monthly must be greater than or equal to 0')
      return
    }

    let upper: number | null = null
    if (bracketForm.taxType === 'paye' && bracketForm.upperBoundMonthly.trim()) {
      upper = Number(bracketForm.upperBoundMonthly)
      if (Number.isNaN(upper) || upper <= lower) {
        toast.error('Upper bound must be greater than the lower bound')
        return
      }
    }

    if (editingBracket) {
      const res = await updateTaxBracket(editingBracket.id, {
        lowerBoundMonthly: bracketForm.taxType === 'paye' ? lower : 0,
        upperBoundMonthly: bracketForm.taxType === 'paye' ? upper : null,
        ratePercent: rate,
        isActive: bracketForm.isActive,
      })
      if (res.success) {
        toast.success('Tax bracket updated.')
        setBracketDialogOpen(false)
        void loadPayrollBrackets()
      } else {
        toast.error(res.error || 'Failed to update tax bracket')
      }
    } else {
      const res = await createTaxBracket({
        bracketYear: Number(selectedYear),
        taxType: bracketForm.taxType,
        lowerBoundMonthly: bracketForm.taxType === 'paye' ? lower : 0,
        upperBoundMonthly: bracketForm.taxType === 'paye' ? upper : null,
        ratePercent: rate,
        isActive: bracketForm.isActive,
      })
      if (res.success) {
        toast.success('Tax bracket created.')
        setBracketDialogOpen(false)
        void loadPayrollBrackets()
      } else {
        toast.error(res.error || 'Failed to create tax bracket')
      }
    }
  }

  async function handleDeleteBracket(id: string) {
    const ok = await confirm({
      title: 'Delete tax bracket',
      description: 'This permanently deletes this tax bracket.',
      confirmLabel: 'Delete',
    })
    if (!ok) return
    const res = await deleteTaxBracket(id)
    if (res.success) {
      toast.success('Tax bracket deleted.')
      void loadPayrollBrackets()
    } else {
      toast.error(res.error || 'Failed to delete tax bracket')
    }
  }

  const payeRows = payrollBrackets.filter((b) => b.taxType === 'paye')
  const ssnitEeRows = payrollBrackets.filter((b) => b.taxType === 'ssnit_employee')
  const ssnitErRows = payrollBrackets.filter((b) => b.taxType === 'ssnit_employer')

  const yearsOptions = Array.from({ length: 10 }, (_, i) => {
    const y = new Date().getFullYear() - 2 + i
    return y.toString()
  })

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Percent className="h-6 w-6" />
            Tax Configuration
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View and manage tax components across the entire system.
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-[560px] mb-4">
          <TabsTrigger value="general">General Taxes</TabsTrigger>
          <TabsTrigger value="payroll">Payroll Taxes & Brackets</TabsTrigger>
          <TabsTrigger value="loans">Loans Configuration</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <div className="flex justify-between items-center">
            <p className="text-xs text-muted-foreground">
              GRA rates applied at runtime for VAT, NHIL, GETFund, WHT, and Corporate Income Tax
              (CIT).
            </p>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Set rate
            </Button>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Active rates</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : active.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No active rates.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tax</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead>Applies to</TableHead>
                      <TableHead>Effective from</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {active.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.taxType}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {pct(r.rate)}
                        </TableCell>
                        <TableCell className="capitalize text-sm text-muted-foreground">
                          {r.applicableTo}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {fmtDate(r.effectiveFrom)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {r.notes ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {history.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-muted-foreground">Rate history</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tax</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead>From</TableHead>
                      <TableHead>Until</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <TagBadge label={r.taxType}>{r.taxType}</TagBadge>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                          {pct(r.rate)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {fmtDate(r.effectiveFrom)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {fmtDate(r.effectiveTo)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="payroll" className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="py-year" className="text-sm font-medium">
                  Year
                </Label>
                <Select value={selectedYear} onValueChange={setSelectedYear}>
                  <SelectTrigger id="py-year" className="w-[120px] h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {yearsOptions.map((y) => (
                      <SelectItem key={y} value={y}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSeedBrackets}
                disabled={seedingLoading || payrollLoading}
              >
                {seedingLoading ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Seed {selectedYear} defaults
              </Button>
            </div>
            <Button size="sm" onClick={handleAddBracketClick}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add bracket
            </Button>
          </div>

          {payrollLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Graduated PAYE Table */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    PAYE Progressive Income Tax Brackets ({selectedYear})
                  </CardTitle>
                  <CardDescription>
                    Graduated monthly cedi brackets. Deductions evaluate progressively across these
                    bands.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {payeRows.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      No PAYE brackets found. Click "Seed {selectedYear} defaults" to initialize.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Monthly Income Band</TableHead>
                          <TableHead className="text-right">Rate</TableHead>
                          <TableHead className="text-center">Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[...payeRows]
                          .sort((a, b) => Number(a.lowerBoundMonthly) - Number(b.lowerBoundMonthly))
                          .map((r) => (
                            <TableRow key={r.id}>
                              <TableCell className="font-medium font-mono text-xs">
                                {r.upperBoundMonthly
                                  ? `GHS ${Number(r.lowerBoundMonthly).toLocaleString('en-GH', { minimumFractionDigits: 2 })} – GHS ${Number(r.upperBoundMonthly).toLocaleString('en-GH', { minimumFractionDigits: 2 })}`
                                  : `GHS ${Number(r.lowerBoundMonthly).toLocaleString('en-GH', { minimumFractionDigits: 2 })} and above`}
                              </TableCell>
                              <TableCell className="text-right font-semibold">
                                {Number(r.ratePercent)}%
                              </TableCell>
                              <TableCell className="text-center">
                                <StatusBadge tone={r.isActive ? 'success' : 'danger'}>
                                  {r.isActive ? 'Active' : 'Inactive'}
                                </StatusBadge>
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => handleEditBracketClick(r)}
                                  >
                                    <Edit className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive"
                                    onClick={() => handleDeleteBracket(r.id)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              {/* SSNIT Tables */}
              <div className="grid gap-6 md:grid-cols-2">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">
                      SSNIT Employee Contribution ({selectedYear})
                    </CardTitle>
                    <CardDescription>Deducted from staff gross monthly pay.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {ssnitEeRows.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        No rate configured.
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Rate</TableHead>
                            <TableHead className="text-center">Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ssnitEeRows.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell className="font-semibold">
                                {Number(r.ratePercent)}%
                              </TableCell>
                              <TableCell className="text-center">
                                <StatusBadge tone={r.isActive ? 'success' : 'danger'}>
                                  {r.isActive ? 'Active' : 'Inactive'}
                                </StatusBadge>
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => handleEditBracketClick(r)}
                                  >
                                    <Edit className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive"
                                    onClick={() => handleDeleteBracket(r.id)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">
                      SSNIT Employer Contribution ({selectedYear})
                    </CardTitle>
                    <CardDescription>
                      Paid by the clinic (not deducted from staff gross).
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {ssnitErRows.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">
                        No rate configured.
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Rate</TableHead>
                            <TableHead className="text-center">Status</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {ssnitErRows.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell className="font-semibold">
                                {Number(r.ratePercent)}%
                              </TableCell>
                              <TableCell className="text-center">
                                <StatusBadge tone={r.isActive ? 'success' : 'danger'}>
                                  {r.isActive ? 'Active' : 'Inactive'}
                                </StatusBadge>
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={() => handleEditBracketClick(r)}
                                  >
                                    <Edit className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-destructive"
                                    onClick={() => handleDeleteBracket(r.id)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="loans" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Loans Configuration
                <TagBadge>Coming soon</TagBadge>
              </CardTitle>
              <CardDescription>
                Configure staff loan products — interest rates, maximum principal, repayment terms,
                and the deduction rules payroll applies each run.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-12 text-center">
                <Percent className="h-6 w-6 text-muted-foreground" />
                <p className="text-sm font-medium">Loan configuration is on the way</p>
                <p className="max-w-md text-xs text-muted-foreground">
                  Staff loans are already deducted in payroll runs from each active loan's monthly
                  installment. This tab will let HR define loan products and default terms
                  centrally.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <SetRateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={() => {
          setDialogOpen(false)
          void loadGeneralTaxes()
        }}
      />

      {/* Bracket Add/Edit Dialog */}
      <Dialog open={bracketDialogOpen} onOpenChange={setBracketDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingBracket ? 'Edit Tax Bracket' : 'Add Tax Bracket'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Tax Type</Label>
              <Select
                value={bracketForm.taxType}
                onValueChange={(v) =>
                  setBracketForm((f) => ({
                    ...f,
                    taxType: v as 'paye' | 'ssnit_employee' | 'ssnit_employer',
                  }))
                }
                disabled={!!editingBracket}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paye">PAYE Graduated Tax</SelectItem>
                  <SelectItem value="ssnit_employee">SSNIT Employee Contribution</SelectItem>
                  <SelectItem value="ssnit_employer">SSNIT Employer Contribution</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {bracketForm.taxType === 'paye' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="br-lower">Lower Bound (GHS)</Label>
                  <Input
                    id="br-lower"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={bracketForm.lowerBoundMonthly}
                    onChange={(e) =>
                      setBracketForm((f) => ({ ...f, lowerBoundMonthly: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="br-upper">Upper Bound (GHS)</Label>
                  <Input
                    id="br-upper"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="None (top band)"
                    value={bracketForm.upperBoundMonthly}
                    onChange={(e) =>
                      setBracketForm((f) => ({ ...f, upperBoundMonthly: e.target.value }))
                    }
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="br-rate">Rate (%)</Label>
                <Input
                  id="br-rate"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  placeholder="e.g. 15"
                  value={bracketForm.ratePercent}
                  onChange={(e) => setBracketForm((f) => ({ ...f, ratePercent: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={bracketForm.isActive ? 'true' : 'false'}
                  onValueChange={(v) => setBracketForm((f) => ({ ...f, isActive: v === 'true' }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Active</SelectItem>
                    <SelectItem value="false">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBracketDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveBracket}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  )
}

function SetRateDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSaved: () => void
}) {
  const [taxType, setTaxType] = useState<string>(TAX_TYPES[0])
  const [ratePct, setRatePct] = useState('')
  const [applicableTo, setApplicableTo] = useState<string>('income')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setTaxType(TAX_TYPES[0])
      setRatePct('')
      setApplicableTo('income')
      setNotes('')
    }
  }, [open])

  async function handleSave() {
    const pctValue = Number(ratePct)
    if (!Number.isFinite(pctValue) || pctValue < 0 || pctValue > 100) {
      toast.error('Rate must be a percentage between 0 and 100.')
      return
    }
    setSaving(true)
    const res = await api.post('/api/tax-configurations', {
      taxType,
      rate: pctValue / 100,
      applicableTo,
      notes: notes.trim() || null,
    })
    setSaving(false)
    if (res.success) {
      toast.success(`${taxType} set to ${pctValue}%`)
      onSaved()
    } else {
      toast.error((res.error as string) || 'Failed to set rate')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Set tax rate</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <Label>Tax</Label>
            <Select value={taxType} onValueChange={setTaxType} disabled={saving}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TAX_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tax-rate">Rate (%)</Label>
            <Input
              id="tax-rate"
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder="e.g. 15"
              value={ratePct}
              onChange={(e) => setRatePct(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Applies to</Label>
            <Select value={applicableTo} onValueChange={setApplicableTo} disabled={saving}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APPLICABLE.map((a) => (
                  <SelectItem key={a} value={a} className="capitalize">
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tax-notes">Notes (optional)</Label>
            <Input
              id="tax-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={saving}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            This supersedes the current active {taxType} rate; the old rate is kept as history.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Set rate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
