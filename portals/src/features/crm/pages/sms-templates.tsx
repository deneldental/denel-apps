import { Bell, Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { authClient } from '@/lib/auth-client'
import { ConfirmDiscardDialog } from '@/shared/components/confirm-discard-dialog'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { DeleteConfirmationDialog } from '@/shared/components/ui/delete-confirmation-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Switch } from '@/shared/components/ui/switch'
import { Textarea } from '@/shared/components/ui/textarea'
import { useFormDirtyGuard } from '@/shared/hooks/use-form-dirty-guard'
import { usePermissions } from '@/shared/hooks/use-permissions'
import { useSubmitGuard } from '@/shared/hooks/use-submit-guard'
import { surfaceApiError } from '@/shared/lib/api-error'

// ─── Types ────────────────────────────────────────────────────────────────────

type ReminderTemplate = {
  id: string
  name: string
  key: string | null
  messageTemplate: string
  isActive: boolean
  /** Admin-only templates are filtered out of every non-admin listing. */
  adminOnly: boolean
  createdAt: string
}

// ─── Placeholder preview ──────────────────────────────────────────────────────

function renderPreview(template: string) {
  return template
    .replace(/\{firstName\}/g, 'Jane')
    .replace(/\{date\}/g, 'Monday, May 5')
    .replace(/\{time\}/g, '10:00 AM')
    .replace(/\{clinicName\}/g, 'Denel Dental')
    .replace(/\{service\}/g, 'crown')
    .replace(/\{expectedDate\}/g, 'Monday, May 12')
}

// ─── Default / seed templates ─────────────────────────────────────────────────

const DEFAULT_TEMPLATES: Array<{ name: string; message: string; description: string }> = [
  {
    name: 'New Patient Welcome',
    message:
      'Welcome to {clinicName}, {firstName}! Your Patient ID has been created. We look forward to providing you with excellent dental care. Thank you for choosing us!',
    description: 'Sent automatically when a new patient is registered.',
  },
  {
    name: 'Appointment Reminder',
    message:
      'Hi {firstName}, this is a reminder that you have an appointment at {clinicName} on {date} at {time}. Please arrive 10 minutes early.',
    description: 'Standard appointment reminder SMS.',
  },
]

function DefaultTemplatesSection({
  existingNames,
  onAdd,
}: {
  existingNames: string[]
  onAdd: (name: string, message: string) => void
}) {
  const missing = DEFAULT_TEMPLATES.filter((t) => !existingNames.includes(t.name))
  if (missing.length === 0) return null

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Suggested templates</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          These standard templates are not in your library yet. Click to add.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {missing.map((t) => (
          <div
            key={t.name}
            className="rounded-xl border border-dashed border-border bg-muted/20 p-4 flex flex-col gap-3"
          >
            <div>
              <p className="font-semibold text-sm">{t.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed flex-1">
              {renderPreview(t.message)}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => onAdd(t.name, t.message)}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add template
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SmsTemplatesPage() {
  const [templates, setTemplates] = useState<ReminderTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const { isAdmin } = usePermissions()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ReminderTemplate | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ReminderTemplate | null>(null)
  const [formName, setFormName] = useState('')
  const [formMessage, setFormMessage] = useState('')
  const [formAdminOnly, setFormAdminOnly] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const { isSubmitting, submit } = useSubmitGuard()

  // Fix: wrap in useCallback with empty deps so the effect only fires on mount,
  // not on every render (the old bare function reference caused an infinite loop).
  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<ReminderTemplate[]>('/api/reminder-templates')
    if (res.success && res.data) setTemplates(res.data as ReminderTemplate[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function openCreate() {
    setEditing(null)
    setFormName('')
    setFormMessage('')
    setFormAdminOnly(false)
    setShowPreview(false)
    setDialogOpen(true)
  }

  function openEdit(t: ReminderTemplate) {
    setEditing(t)
    setFormName(t.name)
    setFormMessage(t.messageTemplate)
    setFormAdminOnly(!!t.adminOnly)
    setShowPreview(false)
    setDialogOpen(true)
  }

  function handleSave() {
    void submit(async () => {
      if (!formName.trim() || !formMessage.trim()) {
        toast.error('Name and message are required')
        return
      }
      if (editing) {
        const res = await api.patch(`/api/reminder-templates/${editing.id}`, {
          name: formName.trim(),
          messageTemplate: formMessage.trim(),
          adminOnly: formAdminOnly,
        })
        if (res.success) {
          toast.success('Template updated')
          setDialogOpen(false)
          void load()
        } else {
          surfaceApiError(res, 'Failed to update template')
        }
      } else {
        const res = await api.post('/api/reminder-templates', {
          name: formName.trim(),
          messageTemplate: formMessage.trim(),
          adminOnly: formAdminOnly,
        })
        if (res.success) {
          toast.success('Template created')
          setDialogOpen(false)
          void load()
        } else {
          surfaceApiError(res, 'Failed to create template')
        }
      }
    })
  }

  async function handleDelete() {
    if (!deleteTarget) return
    const res = await api.delete(`/api/reminder-templates/${deleteTarget.id}`)
    if (res.success) {
      toast.success('Template deleted')
      void load()
    } else {
      surfaceApiError(res, 'Failed to delete template')
    }
    setDeleteTarget(null)
  }

  const isDirty =
    formName !== (editing?.name ?? '') ||
    formMessage !== (editing?.messageTemplate ?? '') ||
    formAdminOnly !== !!editing?.adminOnly

  const { guardedOnOpenChange, confirmOpen, confirmDiscard, cancelDiscard } = useFormDirtyGuard({
    isDirty,
    onClose: () => setDialogOpen(false),
  })

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
            <Bell className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">SMS Templates</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              One place to edit every SMS the system sends — a change here applies everywhere.
              Supports{' '}
              <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
                {'{firstName}'}
              </span>
              , <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">{'{date}'}</span>,{' '}
              <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">{'{time}'}</span>,{' '}
              <span className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
                {'{clinicName}'}
              </span>{' '}
              placeholders.
            </p>
          </div>
        </div>
        {isAdmin && (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New template
          </Button>
        )}
      </div>

      {/* List */}
      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading templates…</p>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Bell className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="font-medium text-muted-foreground">No templates yet</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Create a template to use when sending patient reminders.
            </p>
            {isAdmin && (
              <Button variant="outline" className="mt-4" onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" />
                Create first template
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <div
              key={t.id}
              className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-sm truncate">{t.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <Badge variant={t.isActive ? 'secondary' : 'outline'} className="text-[10px]">
                      {t.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                    {t.adminOnly && (
                      <Badge
                        variant="outline"
                        className="gap-1 text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-400"
                        title="Admin only — hidden from other roles everywhere templates are listed or picked"
                      >
                        <Lock className="h-2.5 w-2.5" />
                        Admin only
                      </Badge>
                    )}
                    {t.key && (
                      <Badge
                        variant="outline"
                        className="text-[10px] font-mono"
                        title={`System template — sent automatically (${t.key})`}
                      >
                        {t.key}
                      </Badge>
                    )}
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => openEdit(t)}
                      aria-label="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {/* System (keyed) templates are wired into automated messaging —
                        editable but not deletable. */}
                    {!t.key && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setDeleteTarget(t)}
                        aria-label="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed flex-1">
                {renderPreview(t.messageTemplate)}
              </p>
              <p className="text-[10px] text-muted-foreground/50">
                {t.messageTemplate.length} chars
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Default / suggested templates — admin only */}
      {isAdmin && (
        <DefaultTemplatesSection
          existingNames={templates.map((t) => t.name)}
          onAdd={(name, message) => {
            setEditing(null)
            setFormName(name)
            setFormMessage(message)
            setShowPreview(false)
            setDialogOpen(true)
          }}
        />
      )}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={guardedOnOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit template' : 'New SMS template'}</DialogTitle>
            <DialogDescription>
              Use placeholders like{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">{'{firstName}'}</code> that are
              substituted when sending.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="rt-name">Template name</Label>
              <Input
                id="rt-name"
                placeholder="e.g. Appointment Reminder"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                maxLength={100}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="rt-body">Message</Label>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setShowPreview((p) => !p)}
                >
                  {showPreview ? 'Edit' : 'Preview'}
                </button>
              </div>
              {showPreview ? (
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm min-h-[100px] whitespace-pre-wrap">
                  {renderPreview(formMessage) || (
                    <span className="text-muted-foreground italic">Nothing to preview</span>
                  )}
                </div>
              ) : (
                <Textarea
                  id="rt-body"
                  rows={5}
                  placeholder="Hi {firstName}, your appointment at {clinicName} is on {date} at {time}. Please arrive 10 minutes early."
                  value={formMessage}
                  onChange={(e) => setFormMessage(e.target.value)}
                  maxLength={1000}
                />
              )}
              <p className="text-xs text-muted-foreground">
                Available: <span className="font-mono">{'{firstName}'}</span>,{' '}
                <span className="font-mono">{'{date}'}</span>,{' '}
                <span className="font-mono">{'{time}'}</span>,{' '}
                <span className="font-mono">{'{clinicName}'}</span>
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="rt-admin-only" className="cursor-pointer">
                  Admin only
                </Label>
                <p className="text-xs text-muted-foreground">
                  Hides this template from every other role — here and in the scheduling / reminder
                  template picker.
                </p>
              </div>
              <Switch
                id="rt-admin-only"
                checked={formAdminOnly}
                onCheckedChange={setFormAdminOnly}
                aria-label="Restrict this template to administrators"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => guardedOnOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSubmitting || !formName.trim() || !formMessage.trim()}
            >
              {isSubmitting ? 'Saving…' : editing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        onConfirm={handleDelete}
        title="Delete template"
        description="This will permanently delete the template. Patient-specific reminders using this template will not be affected."
        itemName={deleteTarget?.name}
      />

      <ConfirmDiscardDialog
        open={confirmOpen}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </div>
  )
}
