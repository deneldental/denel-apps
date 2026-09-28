import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  amortizePrepaid,
  listFixedAssets,
  listPrepaid,
  type PrepaidAsset,
} from '@/lib/actions/fixed-assets'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { formatCurrency } from '@/shared/utils/currency'
import { CreateAssetSheet } from '../components/create-asset-sheet'
import { CreatePrepaidSheet } from '../components/create-prepaid-sheet'

function statusBadge(status: string) {
  if (status === 'disposed' || status === 'fully_amortized') {
    return <Badge variant="outline">{status === 'disposed' ? 'Disposed' : 'Fully amortized'}</Badge>
  }
  return <Badge variant="secondary">Active</Badge>
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function FixedAssetsPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'assets' | 'prepaid'>('assets')
  const [assetSheetOpen, setAssetSheetOpen] = useState(false)
  const [prepaidSheetOpen, setPrepaidSheetOpen] = useState(false)

  const {
    data: assets = [],
    isLoading: assetsLoading,
    isError: assetsError,
  } = useQuery({
    queryKey: queryKeys.fixedAssets.list(),
    queryFn: async () => {
      const res = await listFixedAssets()
      if (!res.success) throw new Error(res.error ?? 'Failed to load')
      return res.data
    },
  })

  const {
    data: prepaid = [],
    isLoading: prepaidLoading,
    isError: prepaidError,
  } = useQuery({
    queryKey: queryKeys.fixedAssets.prepaid(),
    queryFn: async () => {
      const res = await listPrepaid()
      if (!res.success) throw new Error(res.error ?? 'Failed to load')
      return res.data
    },
  })

  const amortizeMutation = useMutation({
    mutationFn: (p: PrepaidAsset) => amortizePrepaid(p.id),
    onSuccess: (res) => {
      if (!res.success) {
        toast.error(res.error ?? 'Failed to amortize')
        return
      }
      if (res.data?.posted) {
        toast.success('Posted this month’s amortization to the GL.')
      } else {
        const reason = res.data?.reason
        toast.info(
          reason === 'already_posted'
            ? 'This month is already posted.'
            : reason === 'out_of_window'
              ? 'This month is outside the amortization window.'
              : reason === 'closed_period'
                ? 'The accounting period for this month is closed.'
                : 'Nothing to post this month.'
        )
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.fixedAssets.prepaid() })
    },
    onError: () => toast.error('Failed to amortize prepaid asset'),
  })

  return (
    <div className="space-y-4 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Asset register</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Capitalize fixed assets and track straight-line depreciation, plus prepaid expenses you
            amortize monthly. Each posting writes a balanced journal entry to the GL.
          </p>
        </div>
        {tab === 'assets' ? (
          <Button onClick={() => setAssetSheetOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New asset
          </Button>
        ) : (
          <Button onClick={() => setPrepaidSheetOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New prepaid
          </Button>
        )}
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'assets' | 'prepaid')}>
        <TabsList>
          <TabsTrigger value="assets">Fixed assets</TabsTrigger>
          <TabsTrigger value="prepaid">Prepaid</TabsTrigger>
        </TabsList>

        {/* ── Fixed assets ─────────────────────────────────────────────── */}
        <TabsContent value="assets" className="mt-4">
          {assetsError ? (
            <div className="flex items-center gap-3 text-sm text-red-600">
              <span>Failed to load assets.</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  queryClient.invalidateQueries({ queryKey: queryKeys.fixedAssets.list() })
                }
              >
                Retry
              </Button>
            </div>
          ) : assetsLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : assets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No fixed assets yet. Create one to start tracking depreciation.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Acquired</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Salvage</TableHead>
                  <TableHead className="text-right">Life</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {a.category ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm">{fmtDate(a.acquisitionDate)}</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(a.acquisitionCost)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(a.salvageValue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.usefulLifeMonths} mo
                    </TableCell>
                    <TableCell>{statusBadge(a.status)}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/financials/assets/${a.id}`}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        {/* ── Prepaid ──────────────────────────────────────────────────── */}
        <TabsContent value="prepaid" className="mt-4">
          {prepaidError ? (
            <div className="flex items-center gap-3 text-sm text-red-600">
              <span>Failed to load prepaid assets.</span>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  queryClient.invalidateQueries({ queryKey: queryKeys.fixedAssets.prepaid() })
                }
              >
                Retry
              </Button>
            </div>
          ) : prepaidLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : prepaid.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No prepaid assets yet. Create one to amortize a prepayment monthly.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Monthly</TableHead>
                  <TableHead className="text-right">Term</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {prepaid.map((p) => {
                  const closed = p.status === 'fully_amortized'
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-sm">{fmtDate(p.startDate)}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(p.totalAmount)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatCurrency(p.monthlyAmount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{p.months} mo</TableCell>
                      <TableCell>{statusBadge(p.status)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={closed || amortizeMutation.isPending}
                          onClick={() => amortizeMutation.mutate(p)}
                        >
                          {amortizeMutation.isPending && amortizeMutation.variables?.id === p.id ? (
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          ) : null}
                          Amortize this month
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>

      <CreateAssetSheet
        open={assetSheetOpen}
        onOpenChange={setAssetSheetOpen}
        onCreated={() => queryClient.invalidateQueries({ queryKey: queryKeys.fixedAssets.list() })}
      />
      <CreatePrepaidSheet
        open={prepaidSheetOpen}
        onOpenChange={setPrepaidSheetOpen}
        onCreated={() =>
          queryClient.invalidateQueries({ queryKey: queryKeys.fixedAssets.prepaid() })
        }
      />
    </div>
  )
}
