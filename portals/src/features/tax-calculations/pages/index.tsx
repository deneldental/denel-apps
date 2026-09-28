import { computeGhanaTax, GRA_TAX_RATES, type TaxBreakdown } from '@denel/utils'
import { format } from 'date-fns'
import { Calculator, History, Receipt, Save } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Switch } from '@/shared/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { Textarea } from '@/shared/components/ui/textarea'
import { formatAmount, formatCurrency } from '@/shared/utils/currency'

type SavedCalc = {
  id: string
  sourceType: string | null
  baseAmount: number
  applyVAT: boolean
  applyNHIL: boolean
  applyGETFund: boolean
  nhilAmount: number
  getfundAmount: number
  vatAmount: number
  totalTax: number
  grossTotal: number
  effectiveRate: number
  notes: string | null
  createdAt: string
}

export default function TaxCalculationsPage() {
  // Inputs
  const [baseAmount, setBaseAmount] = useState<string>('')
  const [applyVAT, setApplyVAT] = useState(true)
  const [applyNHIL, setApplyNHIL] = useState(true)
  const [applyGETFund, setApplyGETFund] = useState(true)
  const [notes, setNotes] = useState('')

  // Outputs (computed client-side via shared util for instant feedback)
  const [breakdown, setBreakdown] = useState<TaxBreakdown | null>(null)
  const [saving, setSaving] = useState(false)

  // History
  const [history, setHistory] = useState<SavedCalc[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)

  useEffect(() => {
    const n = parseFloat(baseAmount)
    if (!Number.isFinite(n) || n < 0) {
      setBreakdown(null)
      return
    }
    setBreakdown(computeGhanaTax(n, { applyVAT, applyNHIL, applyGETFund }))
  }, [baseAmount, applyVAT, applyNHIL, applyGETFund])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    const res = await api.get<SavedCalc[]>('/api/tax-calculations')
    if (res.success && res.data) setHistory(res.data)
    setHistoryLoading(false)
  }, [])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  async function save() {
    if (!breakdown) return
    setSaving(true)
    const res = await api.post('/api/tax-calculations/save', {
      baseAmount: breakdown.baseAmount,
      applyVAT,
      applyNHIL,
      applyGETFund,
      notes: notes || null,
      sourceType: 'standalone',
    })
    setSaving(false)
    if (res.success) {
      toast.success('Tax calculation saved')
      setNotes('')
      loadHistory()
    } else {
      toast.error((res.error as string) || 'Failed to save')
    }
  }

  function reset() {
    setBaseAmount('')
    setApplyVAT(true)
    setApplyNHIL(true)
    setApplyGETFund(true)
    setNotes('')
  }

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Calculator className="h-6 w-6" />
          Tax Calculations
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Ghana Revenue Authority — VAT ({(GRA_TAX_RATES.VAT * 100).toFixed(1)}%) + NHIL (
          {(GRA_TAX_RATES.NHIL * 100).toFixed(1)}%) + GETFund (
          {(GRA_TAX_RATES.GETFUND * 100).toFixed(1)}%). VAT compounds on top of NHIL + GETFund.
        </p>
      </div>

      <Tabs defaultValue="calculator">
        <TabsList>
          <TabsTrigger value="calculator">
            <Calculator className="mr-2 h-3.5 w-3.5" />
            Calculator
          </TabsTrigger>
          <TabsTrigger value="history">
            <History className="mr-2 h-3.5 w-3.5" />
            History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="calculator" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Inputs */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Inputs</CardTitle>
                <CardDescription>Base amount before any tax.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Base amount (GHS)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    value={baseAmount}
                    onChange={(e) => setBaseAmount(e.target.value)}
                    placeholder="0.00"
                    className="text-lg font-mono"
                  />
                </div>

                <div className="space-y-2 pt-2 border-t border-border">
                  <p className="text-xs uppercase tracking-wide font-medium text-muted-foreground">
                    Levies
                  </p>
                  <LevyToggle
                    label={`VAT — ${(GRA_TAX_RATES.VAT * 100).toFixed(1)}%`}
                    sub="Applied on top of NHIL + GETFund"
                    checked={applyVAT}
                    onCheckedChange={setApplyVAT}
                  />
                  <LevyToggle
                    label={`NHIL — ${(GRA_TAX_RATES.NHIL * 100).toFixed(1)}%`}
                    sub="National Health Insurance Levy"
                    checked={applyNHIL}
                    onCheckedChange={setApplyNHIL}
                  />
                  <LevyToggle
                    label={`GETFund — ${(GRA_TAX_RATES.GETFUND * 100).toFixed(1)}%`}
                    sub="Ghana Education Trust Fund"
                    checked={applyGETFund}
                    onCheckedChange={setApplyGETFund}
                  />
                </div>

                <div className="space-y-1.5 pt-2 border-t border-border">
                  <Label>Notes (optional)</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    placeholder="Invoice reference, patient name, etc."
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <Button variant="outline" onClick={reset} className="flex-1">
                    Reset
                  </Button>
                  <Button onClick={save} disabled={!breakdown || saving} className="flex-1">
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Breakdown</CardTitle>
                <CardDescription>Snapshot of levies applied.</CardDescription>
              </CardHeader>
              <CardContent>
                {breakdown ? (
                  <div className="space-y-1">
                    <Row label="Base Amount" value={breakdown.baseAmount} bold />
                    <Row label="NHIL" value={breakdown.nhilAmount} muted={!applyNHIL} />
                    <Row
                      label="GETFund Levy"
                      value={breakdown.getfundAmount}
                      muted={!applyGETFund}
                    />
                    <Row label="Levy Base (for VAT)" value={breakdown.levyBase} subtle />
                    <Row label="VAT" value={breakdown.vatAmount} muted={!applyVAT} />
                    <div className="border-t border-border my-2" />
                    <Row label="Total Tax" value={breakdown.totalTax} />
                    <Row label="Gross Total" value={breakdown.grossTotal} bold highlight />
                    <div className="mt-2 text-center">
                      <Badge variant="outline" className="text-[10px]">
                        Effective rate: {(breakdown.effectiveRate * 100).toFixed(2)}%
                      </Badge>
                    </div>
                  </div>
                ) : (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    Enter a base amount to see the breakdown.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent calculations</CardTitle>
              <CardDescription>
                Saved tax calc snapshots — useful for reconciling invoices against GRA filings.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {historyLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : history.length === 0 ? (
                <div className="py-10 text-center">
                  <Receipt className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No saved calculations yet.</p>
                </div>
              ) : (
                <div className="rounded-lg border border-border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead className="text-right">Base</TableHead>
                        <TableHead className="text-right">NHIL</TableHead>
                        <TableHead className="text-right">GETFund</TableHead>
                        <TableHead className="text-right">VAT</TableHead>
                        <TableHead className="text-right">Gross</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {(() => {
                              try {
                                return format(new Date(c.createdAt), 'MMM d, yyyy')
                              } catch {
                                return c.createdAt
                              }
                            })()}
                          </TableCell>
                          <TableCell className="text-xs capitalize">
                            {c.sourceType ?? '—'}
                          </TableCell>
                          <TableCell className="text-right text-sm">
                            {formatCurrency(c.baseAmount)}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {c.applyNHIL ? formatCurrency(c.nhilAmount) : '—'}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {c.applyGETFund ? formatCurrency(c.getfundAmount) : '—'}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {c.applyVAT ? formatCurrency(c.vatAmount) : '—'}
                          </TableCell>
                          <TableCell className="text-right text-sm font-semibold">
                            {formatCurrency(c.grossTotal)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Row({
  label,
  value,
  bold = false,
  muted = false,
  subtle = false,
  highlight = false,
}: {
  label: string
  value: number
  bold?: boolean
  muted?: boolean
  subtle?: boolean
  highlight?: boolean
}) {
  const labelClasses = [
    'text-sm',
    muted ? 'text-muted-foreground/60 line-through' : '',
    subtle ? 'text-xs italic text-muted-foreground' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const valueClasses = [
    'font-mono',
    bold ? 'text-lg font-bold' : 'text-sm',
    muted ? 'text-muted-foreground/60' : '',
    subtle ? 'text-xs text-muted-foreground' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div
      className={`flex items-center justify-between py-1.5 ${
        highlight ? 'bg-primary/5 -mx-4 px-4 rounded' : ''
      }`}
    >
      <span className={labelClasses}>{label}</span>
      <span className={valueClasses}>GHS {formatAmount(Number(value))}</span>
    </div>
  )
}

function LevyToggle({
  label,
  sub,
  checked,
  onCheckedChange,
}: {
  label: string
  sub: string
  checked: boolean
  onCheckedChange: (b: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[10px] text-muted-foreground">{sub}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}
