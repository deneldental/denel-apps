import { ExternalLink, FileSignature, Pencil, Plus, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  type ConsentTemplate,
  createConsentTemplate,
  deleteConsentTemplate,
  getConsentTemplates,
  updateConsentTemplate,
} from '@/lib/actions/consent-templates'
import { uploadFile } from '@/lib/actions/upload'
import { useApiMutation, useApiQuery } from '@/lib/query'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'
import { Textarea } from '@/shared/components/ui/textarea'

type ConsentTemplateType = 'ortho' | 'surgical' | 'general' | 'periodontal' | 'extraction' | 'other'

const TEMPLATE_TYPES: Array<{ value: ConsentTemplateType; label: string }> = [
  { value: 'ortho', label: 'Orthodontic' },
  { value: 'surgical', label: 'Surgical' },
  { value: 'general', label: 'General' },
  { value: 'periodontal', label: 'Periodontal' },
  { value: 'extraction', label: 'Extraction' },
  { value: 'other', label: 'Other' },
]

const TYPE_BADGE: Record<ConsentTemplateType, string> = {
  ortho: 'bg-blue-100 text-blue-700',
  surgical: 'bg-red-100 text-red-700',
  general: 'bg-slate-100 text-foreground',
  periodontal: 'bg-green-100 text-green-700',
  extraction: 'bg-yellow-100 text-yellow-700',
  other: 'bg-purple-100 text-purple-700',
}

const typeLabel = (t: string) => TEMPLATE_TYPES.find((x) => x.value === t)?.label ?? t
const typeBadge = (t: string) =>
  TYPE_BADGE[t as ConsentTemplateType] ?? 'bg-slate-100 text-foreground'

interface TemplateForm {
  name: string
  type: ConsentTemplateType
  description: string
  pdfUrl: string
}

const EMPTY_FORM: TemplateForm = { name: '', type: 'general', description: '', pdfUrl: '' }

const CONSENT_TEMPLATES_KEY = ['consent-templates'] as const

export function ConsentTemplatesSection() {
  const [showDialog, setShowDialog] = useState(false)
  const [editing, setEditing] = useState<ConsentTemplate | null>(null)
  const [form, setForm] = useState<TemplateForm>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<ConsentTemplate | null>(null)

  const templatesQuery = useApiQuery<ConsentTemplate[]>(CONSENT_TEMPLATES_KEY, () =>
    getConsentTemplates()
  )
  const templates = templatesQuery.data ?? []
  const loading = templatesQuery.isLoading

  const createMutation = useApiMutation(
    (data: { name: string; type: string; description: string | null; pdfUrl: string | null }) =>
      createConsentTemplate(data),
    { invalidates: [CONSENT_TEMPLATES_KEY] }
  )
  const updateMutation = useApiMutation(
    (vars: {
      id: string
      data: Partial<{
        name: string
        type: string
        description: string | null
        pdfUrl: string | null
        isActive: boolean
      }>
    }) => updateConsentTemplate(vars.id, vars.data),
    { invalidates: [CONSENT_TEMPLATES_KEY] }
  )
  const deleteMutation = useApiMutation((id: string) => deleteConsentTemplate(id), {
    invalidates: [CONSENT_TEMPLATES_KEY],
  })
  const saving = createMutation.isPending || updateMutation.isPending

  function openAdd() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setShowDialog(true)
  }

  function openEdit(t: ConsentTemplate) {
    setEditing(t)
    setForm({
      name: t.name,
      type: (t.type as ConsentTemplateType) ?? 'general',
      description: t.description ?? '',
      pdfUrl: t.pdfUrl ?? '',
    })
    setShowDialog(true)
  }

  // Real upload through the storage router (settings-domain-audit D9): the
  // PDF lands in the system-docs bucket and its URL fills the field.
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function handleUploadFile(file: File) {
    setUploading(true)
    try {
      const res = await uploadFile(file, {
        storageCategory: 'system_docs',
        folder: 'consent-templates',
        profile: 'pdf',
      })
      if (!res.success || !res.url) {
        toast.error(res.error || 'Upload failed')
        return
      }
      const url = res.url
      setForm((f) => ({ ...f, pdfUrl: url }))
      toast.success('PDF uploaded')
    } finally {
      setUploading(false)
    }
  }

  async function handleSave() {
    const name = form.name.trim()
    const description = form.description.trim() || null
    const pdfUrl = form.pdfUrl.trim() || null

    if (!name) {
      toast.error('Template name is required')
      return
    }

    try {
      if (editing) {
        await updateMutation.mutateAsync({
          id: editing.id,
          data: { name, type: form.type, description, pdfUrl },
        })
        toast.success('Template updated')
      } else {
        await createMutation.mutateAsync({ name, type: form.type, description, pdfUrl })
        toast.success('Template created')
      }
      setShowDialog(false)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : `Failed to ${editing ? 'update' : 'create'} template`
      )
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success('Template deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete template')
    }
    setDeleteTarget(null)
  }

  async function toggleActive(t: ConsentTemplate) {
    try {
      await updateMutation.mutateAsync({ id: t.id, data: { isActive: !t.isActive } })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update template')
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <CardTitle>Consent Templates</CardTitle>
            <CardDescription>
              PDF consent templates offered in the patient Compliance flow. Active templates appear
              when capturing a new signed consent.
            </CardDescription>
          </div>
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add Template
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : templates.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No consent templates yet. Add one to get started.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Template</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>PDF</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <div className="flex items-start gap-2">
                      <FileSignature className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div>
                        <div className="font-medium">{t.name}</div>
                        {t.description && (
                          <div className="text-xs text-muted-foreground">{t.description}</div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${typeBadge(t.type)}`}
                    >
                      {typeLabel(t.type)}
                    </span>
                  </TableCell>
                  <TableCell>
                    {t.pdfUrl ? (
                      <a
                        href={t.pdfUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        View
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <button type="button" onClick={() => toggleActive(t)}>
                      <Badge variant={t.isActive ? 'default' : 'secondary'}>
                        {t.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(t)}
                        title="Delete template"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Template' : 'Add Template'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="ct-name">Name</Label>
              <Input
                id="ct-name"
                placeholder="e.g. Orthodontic Treatment Consent"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-type">Type</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm((f) => ({ ...f, type: v as ConsentTemplateType }))}
              >
                <SelectTrigger id="ct-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_TYPES.map((tt) => (
                    <SelectItem key={tt.value} value={tt.value}>
                      {tt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-desc">Description (optional)</Label>
              <Textarea
                id="ct-desc"
                placeholder="Briefly describe what this template covers"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ct-url">Template PDF (optional)</Label>
              <div className="flex gap-2">
                <Input
                  id="ct-url"
                  placeholder="https://…/consent-template.pdf"
                  value={form.pdfUrl}
                  onChange={(e) => setForm((f) => ({ ...f, pdfUrl: e.target.value }))}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  aria-label="Upload template PDF"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleUploadFile(file)
                    e.target.value = ''
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  title="Upload a PDF"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  {uploading ? 'Uploading…' : 'Upload'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Upload a PDF (stored with the clinic's system documents) or paste a URL.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {editing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmationDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Consent Template"
        description="This will remove the template from the Compliance picker. Existing signed consents will keep their historical reference."
        itemName={deleteTarget?.name}
      />
    </Card>
  )
}
