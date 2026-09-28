import { Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Textarea } from '@/shared/components/ui/textarea'
import {
  ALL_CONDITIONS,
  ALL_SURFACES,
  CONDITION_COLORS,
  CONDITION_LABELS,
  type OdontogramEntry,
  SURFACE_LABELS,
  type ToothCondition,
  type ToothSurface,
} from '../types'

interface ToothDetailDialogProps {
  /** The tooth in the configured notation; falls back to the FDI number. */
  toothLabel?: string
  patientId: string
  toothNumber: number | null
  open: boolean
  entries: OdontogramEntry[] // all entries for this tooth
  onClose: () => void
  onChange: () => void // reload callback
  canEdit: boolean
}

export function ToothDetailDialog({
  toothLabel,
  patientId,
  toothNumber,
  open,
  entries,
  onClose,
  onChange,
  canEdit,
}: ToothDetailDialogProps) {
  const [surface, setSurface] = useState<ToothSurface>('whole')
  const [condition, setCondition] = useState<ToothCondition>('healthy')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setSurface('whole')
      setCondition('healthy')
      setNotes('')
    }
  }, [open])

  async function handleAdd() {
    if (toothNumber == null) return
    setSaving(true)
    const res = await api.post('/api/odontogram', {
      patientId,
      toothNumber,
      surface,
      condition,
      notes: notes || null,
    })
    setSaving(false)
    if (res.success) {
      toast.success(`Tooth ${toothLabel ?? toothNumber} updated`)
      onChange()
      setNotes('')
    } else {
      toast.error((res.error as string) || 'Failed to save')
    }
  }

  async function handleDelete(id: string) {
    const res = await api.delete(`/api/odontogram/${id}`)
    if (res.success) {
      toast.success('Entry removed')
      onChange()
    } else {
      toast.error('Failed to delete')
    }
  }

  if (toothNumber == null) return null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tooth {toothLabel ?? toothNumber}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Existing entries */}
          <div>
            <p className="text-sm font-medium mb-2">Current conditions</p>
            {entries.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No conditions recorded.</p>
            ) : (
              <div className="space-y-1.5">
                {entries.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div
                        className="h-4 w-4 rounded border border-border shrink-0"
                        style={{ backgroundColor: CONDITION_COLORS[e.condition as ToothCondition] }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium">
                            {CONDITION_LABELS[e.condition as ToothCondition]}
                          </span>
                          <Badge variant="outline" className="text-[10px] h-5 font-mono">
                            {e.surface}
                          </Badge>
                        </div>
                        {e.notes && (
                          <p className="text-xs text-muted-foreground truncate">{e.notes}</p>
                        )}
                      </div>
                    </div>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => handleDelete(e.id)}
                        aria-label="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add new */}
          {canEdit && (
            <div className="space-y-3 rounded-md border border-dashed border-border p-3">
              <p className="text-sm font-medium">Add condition</p>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Surface</Label>
                  <Select value={surface} onValueChange={(v) => setSurface(v as ToothSurface)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ALL_SURFACES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {SURFACE_LABELS[s]}{' '}
                          {s !== 'whole' && (
                            <span className="font-mono text-xs ml-1 opacity-60">({s})</span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Condition</Label>
                  <Select
                    value={condition}
                    onValueChange={(v) => setCondition(v as ToothCondition)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ALL_CONDITIONS.map((c) => (
                        <SelectItem key={c} value={c}>
                          <div className="flex items-center gap-2">
                            <div
                              className="h-3 w-3 rounded border border-border"
                              style={{ backgroundColor: CONDITION_COLORS[c] }}
                            />
                            {CONDITION_LABELS[c]}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Notes (optional)</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Clinical notes, materials, etc."
                  rows={2}
                />
              </div>

              <Button onClick={handleAdd} disabled={saving} size="sm" className="w-full">
                {saving ? 'Saving…' : 'Add Condition'}
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
