import { Package } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { getLowStockAlertNumber, setLowStockAlertNumber } from '@/lib/actions/settings'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
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

const THRESHOLD_KEY = queryKeys.settings.lowStockThreshold()

export function LowStockAlertSection() {
  const [threshold, setThreshold] = useState<string>('10')

  const thresholdQuery = useApiQuery<number>(THRESHOLD_KEY, () => getLowStockAlertNumber())
  const isLoading = thresholdQuery.isLoading

  useEffect(() => {
    if (thresholdQuery.data === undefined) return
    setThreshold(String(thresholdQuery.data))
  }, [thresholdQuery.data])

  const saveMutation = useApiMutation((num: number) => setLowStockAlertNumber(num), {
    invalidates: [THRESHOLD_KEY],
  })
  const isSaving = saveMutation.isPending

  const handleSave = async () => {
    const num = Number(threshold)
    if (!Number.isFinite(num) || num < 0) {
      toast.error('Please enter a valid number (0 or greater)')
      return
    }
    try {
      const data = await saveMutation.mutateAsync(num)
      toast.success('Low stock alert number updated')
      if (data?.threshold !== undefined) setThreshold(String(data.threshold))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          Low Stock Alert
        </CardTitle>
        <CardDescription>
          Items with stock quantity at or below this number will appear in the Low Stock Alert on
          the dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex max-w-xs flex-col gap-2">
          <Label htmlFor="low-stock-threshold">Alert when quantity is at or below</Label>
          <div className="flex gap-2">
            <Input
              id="low-stock-threshold"
              type="number"
              min={0}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              disabled={isLoading}
              placeholder="10"
            />
            <Button onClick={handleSave} disabled={isLoading || isSaving}>
              {isSaving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
