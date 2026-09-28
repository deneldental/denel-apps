import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Switch,
  Textarea,
} from '@denel/ui'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

interface EditModuleDialogProps {
  open: boolean
  initialTitle: string
  initialDescription: string
  initialAllowReassessment: boolean
  onOpenChange: (open: boolean) => void
  onSave: (title: string, description: string, allowReassessment: boolean) => Promise<void>
}

export function EditModuleDialog({
  open,
  initialTitle,
  initialDescription,
  initialAllowReassessment,
  onOpenChange,
  onSave,
}: EditModuleDialogProps) {
  const [title, setTitle] = useState(initialTitle)
  const [desc, setDesc] = useState(initialDescription)
  const [allowReassessment, setAllowReassessment] = useState(initialAllowReassessment)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setTitle(initialTitle)
      setDesc(initialDescription)
      setAllowReassessment(initialAllowReassessment)
    }
  }, [open, initialTitle, initialDescription, initialAllowReassessment])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(title, desc, allowReassessment)
      onOpenChange(false)
    } catch {
      // error already toasted by hook
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="rounded-lg max-w-md">
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit-title">Title *</Label>
            <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-desc">Description</Label>
            <Textarea
              id="edit-desc"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
            />
          </div>
          <div className="flex items-center justify-between pt-2">
            <div className="space-y-0.5">
              <Label>Allow Reassessment</Label>
              <div className="text-sm text-muted-foreground">
                Allow staff to retake this module after completing it
              </div>
            </div>
            <Switch checked={allowReassessment} onCheckedChange={setAllowReassessment} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
