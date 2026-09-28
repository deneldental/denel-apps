import { ArrowLeft, FilePlus, Pencil } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  createDocTemplate,
  type DocTemplate,
  getDocTemplates,
  updateDocTemplate,
} from '@/lib/actions/documents'
import { uploadFile } from '@/lib/actions/upload'
import { useApiQuery } from '@/lib/query'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { PdfFieldEditor } from './pdf-field-editor'

const CATEGORIES = ['consent', 'compliance', 'hr', 'supplier', 'other']

// Shared with subject-documents.tsx (same literal value) so both surfaces
// read/refresh the same templates cache.
const DOC_TEMPLATES_KEY = ['documents', 'templates'] as const

export function TemplatesManager() {
  const [editing, setEditing] = useState<DocTemplate | null>(null)
  const [creating, setCreating] = useState(false)

  const { data: templates = [], refetch: reload } = useApiQuery(DOC_TEMPLATES_KEY, () =>
    getDocTemplates()
  )

  if (creating)
    return (
      <CreateTemplate
        onCancel={() => setCreating(false)}
        onCreated={(t) => {
          setCreating(false)
          setEditing(t)
        }}
      />
    )

  if (editing) {
    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => {
            setEditing(null)
            reload()
          }}
          className="flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Templates
        </button>
        <h3 className="font-medium">{editing.name}</h3>
        <FieldEditorView template={editing} />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Upload a PDF and place fields once; reuse it to fill + sign per subject.
        </p>
        <Button size="sm" onClick={() => setCreating(true)}>
          <FilePlus className="mr-1.5 h-4 w-4" /> New template
        </Button>
      </div>
      {templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No templates yet.</p>
      ) : (
        <div className="divide-y rounded-lg border">
          {templates.map((t) => (
            <div key={t.id} className="flex items-center justify-between p-3">
              <div>
                <p className="text-sm font-medium">{t.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t.category} · {t.fields.length} field(s)
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setEditing(t)}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Fields
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function FieldEditorView({ template }: { template: DocTemplate }) {
  const [saving, setSaving] = useState(false)
  return (
    <PdfFieldEditor
      pdfUrl={template.pdfUrl}
      initialFields={template.fields}
      saving={saving}
      onSave={async (fields) => {
        setSaving(true)
        const res = await updateDocTemplate(template.id, { fields })
        setSaving(false)
        if (!res.success) toast.error(res.error || 'Save failed')
      }}
    />
  )
}

function CreateTemplate({
  onCancel,
  onCreated,
}: {
  onCancel: () => void
  onCreated: (t: DocTemplate) => void
}) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState(CATEGORIES[0])
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function create() {
    const file = fileRef.current?.files?.[0]
    if (!name.trim() || !file) {
      toast.error('Enter a name and choose a PDF.')
      return
    }
    setBusy(true)
    const up = await uploadFile(file, {
      storageCategory: 'system_docs',
      folder: 'document-templates',
      profile: 'pdf',
    })
    if (!up.success || !up.url) {
      setBusy(false)
      toast.error(up.error || 'Upload failed')
      return
    }
    const res = await createDocTemplate({ name: name.trim(), category, pdfUrl: up.url, fields: [] })
    setBusy(false)
    if (res.success && res.data) {
      toast.success('Template created — now place its fields')
      onCreated(res.data)
    } else toast.error(res.error || 'Create failed')
  }

  return (
    <div className="max-w-md space-y-4">
      <button
        type="button"
        onClick={onCancel}
        className="flex items-center gap-1 text-sm text-primary hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Templates
      </button>
      <div className="space-y-1.5">
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ortho consent" />
      </div>
      <div className="space-y-1.5">
        <Label>Category</Label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label>Template PDF</Label>
        <input ref={fileRef} type="file" accept="application/pdf" className="block text-sm" />
      </div>
      <Button onClick={create} disabled={busy}>
        {busy ? 'Creating…' : 'Create & place fields'}
      </Button>
    </div>
  )
}
