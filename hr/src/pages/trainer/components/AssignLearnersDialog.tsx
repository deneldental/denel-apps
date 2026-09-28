import {
  Avatar,
  AvatarFallback,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@denel/ui'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Learner } from '../hooks/useModuleDetail'

function initialsOf(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

interface AssignLearnersDialogProps {
  open: boolean
  learners: Learner[]
  learnersLoading: boolean
  currentAssignedTo: string[]
  onOpenChange: (open: boolean) => void
  onAssign: (ids: string[]) => Promise<void>
}

export function AssignLearnersDialog({
  open,
  learners,
  learnersLoading,
  currentAssignedTo,
  onOpenChange,
  onAssign,
}: AssignLearnersDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(currentAssignedTo.includes('all') ? [] : currentAssignedTo)
  )
  const [saving, setSaving] = useState(false)

  // This dialog never unmounts — only `open` toggles visibility — so without
  // this, `selectedIds` stays stuck at whatever it was the last time it was
  // touched, even across a Cancel and a later reopen against a since-changed
  // `currentAssignedTo`.
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set(currentAssignedTo.includes('all') ? [] : currentAssignedTo))
    }
  }, [open, currentAssignedTo])

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAssign = async () => {
    setSaving(true)
    try {
      await onAssign([...selectedIds])
      onOpenChange(false)
    } catch {
      // error already toasted by hook
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-lg max-w-md max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Assign to learners</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-1 py-2">
          {learnersLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : learners.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No learners found.</p>
          ) : (
            learners.map((l) => (
              <label
                key={l.id}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent cursor-pointer"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border accent-primary shrink-0"
                  checked={selectedIds.has(l.id)}
                  onChange={() => toggle(l.id)}
                />
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                    {initialsOf(l.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{l.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{l.email}</p>
                </div>
              </label>
            ))
          )}
        </div>
        <DialogFooter className="gap-2">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleAssign} disabled={saving || selectedIds.size === 0}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Assign {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
