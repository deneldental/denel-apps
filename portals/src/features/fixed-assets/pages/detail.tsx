import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  type DepreciationSchedule,
  generateSchedule,
  getFixedAsset,
  postDepreciation,
} from '@/lib/actions/fixed-assets'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { formatCurrency } from '@/shared/utils/currency'

function fmtPeriod(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { year: 'numeric', month: 'short' })
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function FixedAssetDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const queryClient = useQueryClient()

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.fixedAssets.detail(id),
    queryFn: async () => {
      const res = await getFixedAsset(id)
      if (!res.success) throw new Error(res.error ?? 'Failed to load')
      return res.data
    },
    enabled: id !== '',
  })

  const generateMutation = useMutation({
    mutationFn: () => generateSchedule(id),
    onSuccess: (res) => {
      if (!res.success) {
        toast.error(res.error ?? 'Failed to generate schedule')
        return
      }
      toast.success(`Schedule generated (${res.data?.length ?? 0} periods).`)
      queryClient.invalidateQueries({ queryKey: queryKeys.fixedAssets.detail(id) })
    },
    onError: () => toast.error('Failed to generate schedule'),
  })

  const postMutation = useMutation({
    mutationFn: (scheduleId: string) => postDepreciation(id, scheduleId),
    onSuccess: (res) => {
      if (!res.success) {
        toast.error(res.error ?? 'Failed to post depreciation')
        return
      }
      if (res.data?.posted) {
        toast.success('Posted depreciation to the GL.')
      } else {
        const reason = res.data?.reason
        toast.info(
          reason === 'already_posted'
            ? 'This period is already posted.'
            : reason === 'closed_period'
              ? 'The accounting period is closed.'
              : 'Nothing to post for this period.'
        )
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.fixedAssets.detail(id) })
    },
    onError: () => toast.error('Failed to post depreciation'),
  })

  const schedules = data?.schedules ?? []
  const postedTotal = schedules
    .filter((s) => s.posted)
    .reduce((sum, s) => sum + Number(s.amount), 0)
  const scheduleTotal = schedules.reduce((sum, s) => sum + Number(s.amount), 0)
  const remaining = scheduleTotal - postedTotal

  return (
    <div className="space-y-4 p-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/financials/assets">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to register
        </Link>
      </Button>

      {isError ? (
        <div className="flex items-center gap-3 text-sm text-red-600">
          <span>Failed to load this asset.</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: queryKeys.fixedAssets.detail(id) })
            }
          >
            Retry
          </Button>
        </div>
      ) : isLoading || !data ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold">{data.name}</h1>
                <Badge variant={data.status === 'active' ? 'secondary' : 'outline'}>
                  {data.status === 'active' ? 'Active' : 'Disposed'}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {data.category ? `${data.category} · ` : ''}Acquired {fmtDate(data.acquisitionDate)}{' '}
                · {data.usefulLifeMonths}-month straight-line life
              </p>
            </div>
            {schedules.length === 0 && (
              <Button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
              >
                {generateMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Generate schedule
              </Button>
            )}
          </header>

          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader>
                <CardDescription>Acquisition cost</CardDescription>
                <CardTitle className="font-mono text-2xl">
                  {formatCurrency(data.acquisitionCost)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Salvage value</CardDescription>
                <CardTitle className="font-mono text-2xl">
                  {formatCurrency(data.salvageValue)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Depreciated to date</CardDescription>
                <CardTitle className="font-mono text-2xl text-emerald-600">
                  {formatCurrency(postedTotal)}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>Remaining to depreciate</CardDescription>
                <CardTitle className="font-mono text-2xl">{formatCurrency(remaining)}</CardTitle>
              </CardHeader>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Depreciation schedule</CardTitle>
              <CardDescription>
                Straight-line monthly periods. Post each period to write DR Depreciation Expense /
                CR Accumulated Depreciation. Posting is idempotent — a posted period can’t
                double-post.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {schedules.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No schedule yet. Generate the depreciation schedule to lay out the monthly
                  periods.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {schedules.map((s: DepreciationSchedule) => {
                      const isPosting = postMutation.isPending && postMutation.variables === s.id
                      return (
                        <TableRow key={s.id}>
                          <TableCell className="text-sm">{fmtPeriod(s.periodDate)}</TableCell>
                          <TableCell className="text-right font-mono">
                            {formatCurrency(s.amount)}
                          </TableCell>
                          <TableCell>
                            {s.posted ? (
                              <Badge variant="outline" className="text-emerald-600">
                                Posted
                              </Badge>
                            ) : (
                              <Badge variant="secondary">Pending</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={s.posted || postMutation.isPending}
                              onClick={() => postMutation.mutate(s.id)}
                            >
                              {isPosting && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                              Post depreciation
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
