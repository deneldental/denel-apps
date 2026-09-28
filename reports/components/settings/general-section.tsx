import { Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getLowStockAlertNumber, setLowStockAlertNumber } from '@/lib/actions/settings'

function SettingRow({
  label,
  value,
  children,
}: {
  label: string
  value: React.ReactNode
  children?: React.ReactNode
}) {
  const [editing, setEditing] = useState(false)
  return (
    <div className="flex flex-col gap-1 border-b border-border py-4 last:border-0">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          {!editing && <p className="mt-0.5 text-sm text-muted-foreground">{value}</p>}
        </div>
        {!editing && children !== undefined && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="shrink-0">
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        )}
      </div>
      {editing && children}
    </div>
  )
}

export function GeneralSection() {
  const [lowStockThreshold, setLowStockThreshold] = useState<string>('10')
  const [lowStockEditing, setLowStockEditing] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      const result = await getLowStockAlertNumber()
      if (mounted && result.success && 'data' in result) {
        setLowStockThreshold(String(result.data))
      }
      if (mounted) setIsLoading(false)
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  const handleSaveLowStock = async () => {
    const num = Number(lowStockThreshold)
    if (!Number.isFinite(num) || num < 0) {
      toast.error('Please enter a valid number (0 or greater)')
      return
    }
    setIsSaving(true)
    const result = await setLowStockAlertNumber(num)
    setIsSaving(false)
    if (result.success) {
      toast.success('Low stock alert number updated')
      setLowStockEditing(false)
    } else {
      toast.error((result as { error?: string }).error || 'Failed to save')
    }
  }

  const clinicName = import.meta.env.VITE_CLINIC_NAME || 'Denel Dental Clinic'

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card">
        <div className="px-6 py-4">
          <h3 className="text-base font-semibold">Profile</h3>
          <p className="text-sm text-muted-foreground">Your clinic and application settings.</p>
        </div>
        <div className="px-6 pb-6">
          <SettingRow label="Clinic name" value={clinicName} />
          <div className="flex flex-col gap-1 border-b border-border py-4 last:border-0">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground">Low stock alert</p>
                {!lowStockEditing && (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {isLoading ? '…' : `Alert when quantity is at or below ${lowStockThreshold}`}
                  </p>
                )}
              </div>
              {!lowStockEditing && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLowStockEditing(true)}
                  className="shrink-0"
                  disabled={isLoading}
                >
                  <Pencil className="h-4 w-4" />
                  Edit
                </Button>
              )}
            </div>
            {lowStockEditing && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="general-low-stock">Alert when quantity is at or below</Label>
                  <Input
                    id="general-low-stock"
                    type="number"
                    min={0}
                    value={lowStockThreshold}
                    onChange={(e) => setLowStockThreshold(e.target.value)}
                    className="w-28"
                  />
                </div>
                <Button onClick={handleSaveLowStock} disabled={isSaving}>
                  {isSaving ? 'Saving…' : 'Save'}
                </Button>
                <Button variant="outline" onClick={() => setLowStockEditing(false)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
