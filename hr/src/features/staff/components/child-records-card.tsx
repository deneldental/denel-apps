import { CONTACT_TYPES, type ContactType } from '@denel/types'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@denel/ui'
import { HeartPulse, Loader2, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  addChildRecord,
  type ChildResource,
  listChildRecords,
  removeChildRecord,
  type StaffContact,
} from '@/lib/actions/staff-personal'
import { useConfirm } from '@/shared/hooks/use-confirm'
import { surfaceApiError } from '@/shared/lib/api-error'

/**
 * The one-to-many halves of the employee record (migration 0177): emergency
 * contacts, next of kin, qualifications, dependents, work experience.
 *
 * `staff` carried one flat set of columns for each of these, so a staffer could
 * have exactly one emergency contact and one qualification. The Personal card
 * still renders those flat columns; this card is the normalized surface that
 * supersedes them, and a later contract migration drops the flat columns once
 * every reader has moved across.
 *
 * All four resources are list/add/remove over a small field set, so they're
 * driven by config rather than four near-identical components — matching the
 * backend factory they call. See project-docs/staff-personal-data-build-plan.md.
 */

type FieldKind = 'text' | 'number' | 'date' | 'enum'

interface FieldSpec {
  key: string
  label: string
  kind: FieldKind
  placeholder?: string
  maxLength?: number
  /** enum only */
  options?: ReadonlyArray<{ value: string; label: string }>
  /** Rendered in the row summary. */
  primary?: boolean
}

/** Generic over the specific child-record shape (StaffContact today —
 *  StaffQualification/StaffDependent/StaffWorkExperience if one of those
 *  resources ever comes back onto this card). */
interface ResourceSpec<T> {
  resource: ChildResource
  title: string
  description: string
  icon: typeof HeartPulse
  addLabel: string
  fields: FieldSpec[]
  /** One-line summary of a saved row. */
  summarize: (row: T) => string
  /** Secondary line, e.g. a relationship or year. */
  detail?: (row: T) => string | null
}

const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  emergency: 'Emergency',
  next_of_kin: 'Next of kin',
}

const SPECS: ResourceSpec<StaffContact>[] = [
  {
    resource: 'contacts',
    title: 'Contacts',
    description:
      'Emergency contacts and next of kin. An emergency contact is who to call; next of kin is the legal or benefits contact — often different people.',
    icon: HeartPulse,
    addLabel: 'Add contact',
    fields: [
      {
        key: 'type',
        label: 'Type',
        kind: 'enum',
        options: CONTACT_TYPES.map((t) => ({ value: t, label: CONTACT_TYPE_LABELS[t] })),
      },
      { key: 'name', label: 'Name', kind: 'text', maxLength: 200, primary: true },
      { key: 'relationship', label: 'Relationship', kind: 'text', maxLength: 50 },
      { key: 'phone', label: 'Phone', kind: 'text', maxLength: 30 },
    ],
    // Name is optional — most existing records are phone-only.
    summarize: (r) => r.name || r.phone || '—',
    detail: (r) =>
      [CONTACT_TYPE_LABELS[r.type as ContactType], r.relationship, r.name ? r.phone : null]
        .filter(Boolean)
        .join(' · ') || null,
  },
  // Qualifications, dependents, and work experience were removed from the
  // Profile surface (Phase 5 cleanup) — the uploaded CV covers them, and the
  // HR wizard no longer captures them here. Contacts remain the one normalized
  // list HR actively manages.
]

export function ChildRecordsCard({ staffId }: { staffId: string }) {
  return (
    <div className="space-y-5">
      {SPECS.map((spec) => (
        <ResourceCard key={spec.resource} staffId={staffId} spec={spec} />
      ))}
    </div>
  )
}

function emptyDraft<T>(spec: ResourceSpec<T>): Record<string, string> {
  const d: Record<string, string> = {}
  for (const f of spec.fields) d[f.key] = f.kind === 'enum' ? (f.options?.[0]?.value ?? '') : ''
  return d
}

function ResourceCard<T extends { id: string }>({
  staffId,
  spec,
}: {
  staffId: string
  spec: ResourceSpec<T>
}) {
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>(() => emptyDraft(spec))
  const { confirm, confirmDialog } = useConfirm()

  const load = useCallback(async () => {
    setLoading(true)
    const res = await listChildRecords<T>(staffId, spec.resource)
    setLoading(false)
    if (res.success) setRows(res.data)
    else toast.error(res.error || `Failed to load ${spec.title.toLowerCase()}`)
  }, [staffId, spec.resource, spec.title])

  useEffect(() => {
    void load()
  }, [load])

  async function handleAdd() {
    setSaving(true)
    // '' means "not provided" — send null rather than empty strings so the
    // backend's "a name or a phone" style rules see the truth.
    const payload: Record<string, unknown> = {}
    for (const f of spec.fields) {
      const raw = draft[f.key]?.trim() ?? ''
      if (!raw) continue
      payload[f.key] = f.kind === 'number' ? Number(raw) : raw
    }
    const res = await addChildRecord(staffId, spec.resource, payload)
    setSaving(false)
    if (!res.success) {
      surfaceApiError(res, `Failed to add ${spec.title.toLowerCase()}`)
      return
    }
    setDraft(emptyDraft(spec))
    setShowForm(false)
    await load()
  }

  async function handleRemove(row: T) {
    const ok = await confirm({
      title: `Remove ${spec.title.toLowerCase()}`,
      description: 'This permanently removes this record.',
      itemName: spec.summarize(row),
      confirmLabel: 'Remove',
    })
    if (!ok) return
    const res = await removeChildRecord(spec.resource, row.id)
    if (!res.success) {
      surfaceApiError(res, 'Failed to remove')
      return
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id))
  }

  const Icon = spec.icon

  return (
    <>
      {confirmDialog}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Icon className="h-4 w-4" />
              {spec.title}
              {!loading && rows.length > 0 && (
                <Badge variant="outline" className="ml-1">
                  {rows.length}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>{spec.description}</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {spec.addLabel}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <div className="h-9 animate-pulse rounded-md bg-muted" />}

          {!loading && rows.length === 0 && !showForm && (
            <p className="text-sm italic text-muted-foreground">None recorded.</p>
          )}

          {!loading &&
            rows.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{spec.summarize(row)}</p>
                  {spec.detail?.(row) && (
                    <p className="truncate text-xs text-muted-foreground">{spec.detail(row)}</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(row)}
                  aria-label={`Remove ${spec.summarize(row)}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}

          {showForm && (
            <div className="space-y-3 rounded-md border bg-muted/30 p-3">
              <div className="grid grid-cols-2 gap-3">
                {spec.fields.map((f) => (
                  <div key={f.key} className="space-y-1.5">
                    <Label htmlFor={`${spec.resource}-${f.key}`} className="text-xs">
                      {f.label}
                    </Label>
                    {f.kind === 'enum' ? (
                      <Select
                        value={draft[f.key]}
                        onValueChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
                      >
                        <SelectTrigger id={`${spec.resource}-${f.key}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {f.options?.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id={`${spec.resource}-${f.key}`}
                        type={f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : 'text'}
                        placeholder={f.placeholder}
                        maxLength={f.maxLength}
                        value={draft[f.key]}
                        onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDraft(emptyDraft(spec))
                    setShowForm(false)
                  }}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button size="sm" onClick={handleAdd} disabled={saving}>
                  {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Save
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
