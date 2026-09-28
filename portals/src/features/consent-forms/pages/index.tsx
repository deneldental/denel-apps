import { FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Switch } from '@/shared/components/ui/switch'
import { Textarea } from '@/shared/components/ui/textarea'

type Template = {
  id: string
  name: string
  category: string | null
  content: string
  requiresSignature: boolean
  requiresWitness: boolean
  active: boolean
  createdAt: string
}

const CATEGORIES = ['surgical', 'ortho', 'privacy', 'financial', 'photography', 'general']

export default function ConsentFormsPage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Template | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<Template[]>('/api/consent-forms/templates')
    if (res.success && res.data) setTemplates(res.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function confirmDelete() {
    if (!deleteTarget) return
    const res = await api.delete(`/api/consent-forms/templates/${deleteTarget.id}`)
    if (res.success) {
      toast.success('Template deleted')
      setDeleteTarget(null)
      load()
    } else {
      throw new Error(res.error || 'delete failed')
    }
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Consent Form Library</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Templates for patient consent — signed copies stored per patient.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          New Template
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-12 text-center">
          <FileText className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No consent templates yet.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border divide-y divide-border">
          {templates.map((t) => (
            <div key={t.id} className="px-4 py-3 flex items-center gap-3">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{t.name}</span>
                  {t.category && (
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {t.category}
                    </Badge>
                  )}
                  {t.requiresWitness && (
                    <Badge variant="secondary" className="text-[10px]">
                      Witness required
                    </Badge>
                  )}
                  {!t.active && (
                    <Badge variant="outline" className="text-[10px]">
                      Inactive
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {t.content.replace(/^#+ /gm, '').replace(/\n+/g, ' · ').slice(0, 100)}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => {
                    setEditing(t)
                    setDialogOpen(true)
                  }}
                  aria-label="Edit"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive"
                  onClick={() => setDeleteTarget(t)}
                  aria-label="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <TemplateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        template={editing}
        onSaved={() => {
          setDialogOpen(false)
          load()
        }}
      />

      <DeleteConfirmationDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete consent template?"
        description="Patients who already signed this template keep their signed copies — only the template is removed."
        itemName={deleteTarget?.name}
      />
    </div>
  )
}

function TemplateDialog({
  open,
  onOpenChange,
  template,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  template: Template | null
  onSaved: () => void
}) {
  const [name, setName] = useState(template?.name ?? '')
  const [category, setCategory] = useState(template?.category ?? '')
  const [content, setContent] = useState(template?.content ?? '')
  const [requiresSignature, setRequiresSignature] = useState(template?.requiresSignature ?? true)
  const [requiresWitness, setRequiresWitness] = useState(template?.requiresWitness ?? false)
  const [active, setActive] = useState(template?.active ?? true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setName(template?.name ?? '')
      setCategory(template?.category ?? '')
      setContent(template?.content ?? '')
      setRequiresSignature(template?.requiresSignature ?? true)
      setRequiresWitness(template?.requiresWitness ?? false)
      setActive(template?.active ?? true)
    }
  }, [open, template])

  async function save() {
    if (!name.trim() || !content.trim()) {
      toast.error('Name and content are required')
      return
    }
    setSaving(true)
    const payload = {
      name: name.trim(),
      category: category || null,
      content: content.trim(),
      requiresSignature,
      requiresWitness,
      active,
    }
    const res = template
      ? await api.patch(`/api/consent-forms/templates/${template.id}`, payload)
      : await api.post('/api/consent-forms/templates', payload)
    setSaving(false)
    if (res.success) {
      toast.success(template ? 'Updated' : 'Created')
      onSaved()
    } else toast.error((res.error as string) || 'Failed')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template ? 'Edit' : 'New'} Consent Template</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c} className="capitalize">
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Content (markdown)</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={14}
              className="font-mono text-xs"
              placeholder="# Title&#10;&#10;Main body of the consent form..."
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-xs">Signature</span>
              <Switch checked={requiresSignature} onCheckedChange={setRequiresSignature} />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-xs">Witness</span>
              <Switch checked={requiresWitness} onCheckedChange={setRequiresWitness} />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-xs">Active</span>
              <Switch checked={active} onCheckedChange={setActive} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
