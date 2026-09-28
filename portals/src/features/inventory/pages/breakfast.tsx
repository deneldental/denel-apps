import { format } from 'date-fns'
import { Coffee, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { Badge } from '@/shared/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Switch } from '@/shared/components/ui/switch'

interface InvRow {
  id: string
  name: string
  unit: string | null
  stockQuantity: number
  reorderLevel: number | null
}
interface SubRow {
  id: string
  weekStart: string
  note: string | null
  createdAt: string
  submittedBy: string | null
  items: { itemName: string; quantity: number }[]
  ackCount: number
  totalStaff: number
}
interface BData {
  inventory: InvRow[]
  submissions: SubRow[]
  notificationsEnabled: boolean
}

const fmtWeek = (ymd: string) => format(new Date(`${ymd}T00:00:00`), 'MMM d, yyyy')

export default function BreakfastTrackingPage() {
  const [data, setData] = useState<BData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<BData>('/api/breakfast')
    if (res.success && res.data) setData(res.data)
    setLoading(false)
  }, [])
  useEffect(() => {
    load()
  }, [load])

  async function toggleNotif(enabled: boolean) {
    setData((d) => (d ? { ...d, notificationsEnabled: enabled } : d))
    const res = await api.patch('/api/breakfast/settings', { enabled })
    if (res.success) {
      toast.success(
        enabled ? 'Breakfast notifications enabled' : 'Breakfast notifications disabled'
      )
    } else {
      toast.error(res.error || 'Failed to update setting')
      load()
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!data) return <p className="p-4 text-sm text-muted-foreground">Couldn’t load breakfast.</p>

  return (
    <div className="space-y-6 p-1">
      <div className="flex items-center gap-2">
        <Coffee className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight">Breakfast</h1>
      </div>

      {/* Notifications setting */}
      <Card>
        <CardContent className="flex items-center justify-between gap-4 p-4">
          <div>
            <p className="text-sm font-medium">Breakfast notifications</p>
            <p className="text-xs text-muted-foreground">
              Push staff when the weekly breakfast list is submitted.
            </p>
          </div>
          <Switch checked={data.notificationsEnabled} onCheckedChange={toggleNotif} />
        </CardContent>
      </Card>

      {/* Inventory levels */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Breakfast inventory</CardTitle>
        </CardHeader>
        <CardContent>
          {data.inventory.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No breakfast items yet — add inventory items with category “breakfast”.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {data.inventory.map((it) => {
                const low = it.reorderLevel != null && it.stockQuantity <= it.reorderLevel
                return (
                  <div key={it.id} className="flex items-center justify-between py-2">
                    <span className="text-sm">{it.name}</span>
                    <span
                      className={`text-sm font-medium ${low ? 'text-red-500' : 'text-foreground'}`}
                    >
                      {it.stockQuantity} {it.unit || ''}
                      {low && (
                        <Badge variant="destructive" className="ml-2 text-[10px]">
                          Low
                        </Badge>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Weekly submissions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Weekly submissions</CardTitle>
        </CardHeader>
        <CardContent>
          {data.submissions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No weekly breakfast submitted yet.</p>
          ) : (
            <div className="space-y-3">
              {data.submissions.map((s) => (
                <div key={s.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">Week of {fmtWeek(s.weekStart)}</p>
                    <Badge variant="secondary" className="text-[11px]">
                      {s.ackCount}/{s.totalStaff} received
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    by {s.submittedBy ?? 'Unknown'}
                  </p>
                  <p className="mt-1 text-xs">
                    {s.items.map((i) => `${i.itemName} ×${i.quantity}`).join(', ')}
                  </p>
                  {s.note && <p className="mt-1 text-xs text-muted-foreground">{s.note}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
