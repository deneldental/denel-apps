import { format } from 'date-fns'
import { Check, Coffee, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { staffApi } from '@/lib/api'

interface BItem {
  id: string
  name: string
  unit: string | null
  stockQuantity: number
}
interface Submission {
  id: string
  weekStart: string
  note: string | null
  createdAt: string
  items: { itemName: string; quantity: number }[]
  acknowledged: boolean
  ackCount: number
  totalStaff: number
}
interface BreakfastData {
  isBreakfastLead: boolean
  currentWeekStart: string
  submission: Submission | null
  breakfastItems: BItem[]
}

const fmtWeek = (ymd: string) => format(new Date(`${ymd}T00:00:00`), 'MMM d, yyyy')

export default function BreakfastPage() {
  const [data, setData] = useState<BreakfastData | null>(null)
  const [loading, setLoading] = useState(true)
  const [qty, setQty] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [acking, setAcking] = useState(false)

  async function load() {
    setLoading(true)
    const res = await staffApi.getBreakfast()
    if (res.success && res.data) setData(res.data as BreakfastData)
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!data) {
    return <div className="p-5 text-sm text-muted-foreground">Couldn’t load breakfast.</div>
  }

  const sub = data.submission
  const submittedThisWeek = !!sub && sub.weekStart === data.currentWeekStart
  const canSubmit = data.isBreakfastLead && !submittedThisWeek

  async function confirmReceipt() {
    if (!sub) return
    setAcking(true)
    const res = await staffApi.acknowledgeBreakfast(sub.id)
    setAcking(false)
    if (res.success) {
      toast.success('Receipt confirmed')
      load()
    } else {
      toast.error(res.error || 'Failed to confirm')
    }
  }

  async function submit() {
    if (!data) return
    const lines = data.breakfastItems
      .map((i) => ({ itemId: i.id, quantity: Number(qty[i.id] || 0) }))
      .filter((l) => l.quantity > 0)
    if (lines.length === 0) {
      toast.error('Enter a quantity for at least one item')
      return
    }
    setSubmitting(true)
    const res = await staffApi.submitBreakfast({ items: lines, note: note.trim() || undefined })
    setSubmitting(false)
    if (res.success) {
      toast.success('Weekly breakfast submitted — colleagues notified')
      setQty({})
      setNote('')
      load()
    } else {
      toast.error(res.error || 'Failed to submit')
    }
  }

  return (
    <div className="page-enter p-5 space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Breakfast</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Weekly staff breakfast pack</p>
      </div>

      {sub ? (
        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Coffee className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Week of {fmtWeek(sub.weekStart)}</h2>
              </div>
              <span className="text-xs text-muted-foreground shrink-0">
                {sub.ackCount}/{sub.totalStaff} confirmed
              </span>
            </div>
            <ul className="space-y-1.5 text-sm">
              {sub.items.map((it) => (
                <li
                  key={`${it.itemName}-${it.quantity}`}
                  className="flex items-center justify-between"
                >
                  <span>{it.itemName}</span>
                  <span className="font-medium">×{it.quantity}</span>
                </li>
              ))}
            </ul>
            {sub.note && (
              <p className="border-t border-border pt-2 text-xs text-muted-foreground">
                {sub.note}
              </p>
            )}
            {sub.acknowledged ? (
              <div className="flex items-center gap-2 pt-1 text-sm font-medium text-emerald-600">
                <Check className="h-4 w-4" /> You confirmed receipt
              </div>
            ) : (
              <Button onClick={confirmReceipt} disabled={acking} className="w-full">
                {acking && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Confirm I received my pack
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <Coffee className="h-10 w-10 text-muted-foreground/30" />
            <p className="text-muted-foreground">No breakfast submitted yet this week.</p>
          </CardContent>
        </Card>
      )}

      {canSubmit && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <div>
              <h2 className="font-semibold">Submit this week’s breakfast</h2>
              <p className="text-xs text-muted-foreground">
                Quantities decrement the breakfast inventory and notify everyone.
              </p>
            </div>
            {data.breakfastItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No breakfast items in inventory yet — ask admin to add some.
              </p>
            ) : (
              <div className="space-y-2">
                {data.breakfastItems.map((it) => (
                  <div key={it.id} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{it.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {it.stockQuantity} {it.unit || ''} in stock
                      </p>
                    </div>
                    <Input
                      type="number"
                      min="0"
                      max={it.stockQuantity}
                      value={qty[it.id] || ''}
                      onChange={(e) => setQty({ ...qty, [it.id]: e.target.value })}
                      placeholder="0"
                      className="w-20"
                    />
                  </div>
                ))}
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  placeholder="Note (optional)"
                />
                <Button onClick={submit} disabled={submitting} className="w-full">
                  {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  Submit & notify staff
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {data.isBreakfastLead && submittedThisWeek && (
        <p className="text-center text-sm font-medium text-emerald-600">
          ✓ This week’s breakfast has been submitted.
        </p>
      )}
    </div>
  )
}
