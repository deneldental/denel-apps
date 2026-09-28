import { Package } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getLowStockAlertNumber, setLowStockAlertNumber } from '@/lib/actions/settings'

export function LowStockAlertSection() {
  const [threshold, setThreshold] = useState<string>('10')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      const result = await getLowStockAlertNumber()
      if (mounted) {
        if (result.success && 'data' in result) {
          setThreshold(String(result.data))
        } else {
          toast.error((result as { error?: string }).error || 'Failed to load setting')
        }
        setIsLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  const handleSave = async () => {
    const num = Number(threshold)
    if (!Number.isFinite(num) || num < 0) {
      toast.error('Please enter a valid number (0 or greater)')
      return
    }
    setIsSaving(true)
    const result = await setLowStockAlertNumber(num)
    setIsSaving(false)
    if (result.success) {
      toast.success('Low stock alert number updated')
      if ('data' in result && result.data?.threshold !== undefined) {
        setThreshold(String(result.data.threshold))
      }
    } else {
      toast.error((result as { error?: string }).error || 'Failed to save')
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
