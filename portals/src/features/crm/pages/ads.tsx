import { format, parseISO } from 'date-fns'
import { Copy, Megaphone, Pencil, Plus, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  type AdTemplate,
  createAdTemplate,
  deleteAdTemplate,
  getAdTemplates,
  updateAdTemplate,
} from '@/lib/actions/crm'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { queryKeys } from '@/lib/query-keys'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { Textarea } from '@/shared/components/ui/textarea'
import { SmsComposerSheet } from '../components/sms-composer-sheet'

const TEMPLATES_KEY = queryKeys.adTemplates.list()

export default function AdsPage() {
  const [search, setSearch] = useState('')
  const [editTarget, setEditTarget] = useState<AdTemplate | null | 'new'>(null)
  const [broadcastOpen, setBroadcastOpen] = useState(false)

  const templatesQuery = useApiQuery<AdTemplate[]>(TEMPLATES_KEY, () => getAdTemplates())
  const templates = templatesQuery.data ?? []
  const loading = templatesQuery.isLoading

  const createMutation = useApiMutation(
    (data: { name: string; body: string }) => createAdTemplate(data),
    { invalidates: [TEMPLATES_KEY] }
  )
  const updateMutation = useApiMutation(
    (vars: { id: string; data: { name: string; body: string } }) =>
      updateAdTemplate(vars.id, vars.data),
    { invalidates: [TEMPLATES_KEY] }
  )
  const deleteMutation = useApiMutation((id: string) => deleteAdTemplate(id), {
    invalidates: [TEMPLATES_KEY],
  })

  const filtered = templates.filter((t) =>
    `${t.name} ${t.body}`.toLowerCase().includes(search.trim().toLowerCase())
  )

  const handleCopy = (body: string, name: string) => {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(body)
    }
    toast.success(`Copied "${name}" to clipboard`)
  }

  const handleEdit = (tpl: AdTemplate) => setEditTarget(tpl)

  const handleCreate = () => setEditTarget('new')

  const handleSave = async (data: { name: string; body: string }) => {
    if (editTarget === 'new') {
      try {
        await createMutation.mutateAsync(data)
        toast.success('Template created')
        setEditTarget(null)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to create template')
      }
    } else if (editTarget) {
      try {
        await updateMutation.mutateAsync({ id: editTarget.id, data })
        toast.success('Template updated')
        setEditTarget(null)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update template')
      }
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id)
      toast.success('Template deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete template')
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
            <Megaphone className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Ads</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Reusable advertising templates for SMS and email campaigns.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="text-sm">
            {templates.length} templates
          </Badge>
          <Button variant="outline" onClick={() => setBroadcastOpen(true)}>
            <Send className="mr-2 h-4 w-4" />
            Send broadcast
          </Button>
          <Button onClick={handleCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Create template
          </Button>
        </div>
      </div>

      <div className="max-w-md">
        <Input
          placeholder="Search templates…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No templates match your search.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((tpl) => (
            <Card key={tpl.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{tpl.name}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Created {format(parseISO(tpl.createdAt), 'MMM d, yyyy')}
                </p>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <p className="line-clamp-4 flex-1 text-sm text-foreground/80">{tpl.body}</p>
                <div className="flex items-center justify-between gap-2 border-t pt-3">
                  <span className="text-xs text-muted-foreground">{tpl.body.length} chars</span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCopy(tpl.body, tpl.name)}
                    >
                      <Copy className="mr-1.5 h-3.5 w-3.5" />
                      Copy
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleEdit(tpl)}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(tpl.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <TemplateEditorSheet
        open={editTarget !== null}
        onOpenChange={(v) => {
          if (!v) setEditTarget(null)
        }}
        template={editTarget === 'new' ? null : editTarget}
        onSave={handleSave}
      />

      <SmsComposerSheet
        open={broadcastOpen}
        onOpenChange={setBroadcastOpen}
        audienceBuilder
        recipientLabel=""
        defaultMessage=""
        onSend={(_message, recipients) => {
          // TODO(backend-wiring): POST the resolved recipients to /api/sms/send.
          // Optimistic for now — the composer already fired the success toast.
          void recipients
        }}
      />
    </div>
  )
}

interface TemplateEditorSheetProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  template: AdTemplate | null
  onSave: (data: { name: string; body: string }) => Promise<void>
}

function TemplateEditorSheet({ open, onOpenChange, template, onSave }: TemplateEditorSheetProps) {
  const [name, setName] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setName(template?.name ?? '')
      setBody(template?.body ?? '')
    }
  }, [open, template])

  const canSave = name.trim().length > 0 && body.trim().length > 0

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    await onSave({ name: name.trim(), body: body.trim() })
    setSaving(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md flex flex-col gap-0 p-0">
        <SheetHeader className="p-6 pb-4 border-b">
          <SheetTitle>{template ? 'Edit template' : 'New template'}</SheetTitle>
          <SheetDescription>
            {template ? 'Update the name or body text.' : 'Create a reusable ad template.'}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tpl-name">Template name</Label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Mid-year Cleaning Promo"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tpl-body">Message body</Label>
            <Textarea
              id="tpl-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              placeholder="Write the SMS or email body…"
            />
            <p className="text-xs text-muted-foreground">{body.length} chars</p>
          </div>
        </div>
        <SheetFooter className="p-6 pt-4 border-t gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button disabled={!canSave || saving} onClick={handleSave}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
