import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Label,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@denel/ui'
import type { ColumnDef } from '@tanstack/react-table'
import { Megaphone, Plus, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { MemoDetailSheet } from '@/features/staff/components/memo-detail-sheet'
import { getStaff } from '@/lib/actions/staff'
import { type UploadProfile, uploadFile } from '@/lib/actions/upload'
import { api } from '@/lib/api-client'
import { ROLE_OPTIONS } from '@/lib/roles'
import { cn } from '@/lib/utils'
import {
  type HrDoc,
  HrRichEditor,
  type HrRichEditorHandle,
  htmlToBlocks,
} from '@/shared/components/blocknote/editor'
import { DataTable } from '@/shared/components/data-table/data-table'
import { DataTableColumnHeader } from '@/shared/components/data-table/data-table-column-header'
import { StatusBadge } from '@/shared/components/status-badge'
import { TagBadge } from '@/shared/components/tag-badge'

type MemoLevel = 'info' | 'important' | 'warning' | 'critical'
type MemoType = 'general' | 'announcement' | 'notice' | 'meeting_memo'

const MEMO_TYPE_OPTIONS: Array<{ value: MemoType; label: string }> = [
  { value: 'general', label: 'General' },
  { value: 'announcement', label: 'Announcement' },
  { value: 'notice', label: 'Notice' },
  { value: 'meeting_memo', label: 'Meeting' },
]

const PRIORITY_OPTIONS: Array<{ value: MemoLevel; label: string; activeClass: string }> = [
  { value: 'info', label: 'Info', activeClass: 'border-sky-500 bg-sky-500 text-white' },
  {
    value: 'important',
    label: 'Important',
    activeClass: 'border-indigo-500 bg-indigo-500 text-white',
  },
  { value: 'warning', label: 'Warning', activeClass: 'border-amber-500 bg-amber-500 text-white' },
  { value: 'critical', label: 'Critical', activeClass: 'border-red-500 bg-red-500 text-white' },
]

type AudienceFilter = {
  roles?: string[]
  staffIds?: string[]
}

type Memo = {
  id: string
  title: string
  audience: string
  audienceFilter?: AudienceFilter | null
  level: MemoLevel
  memoType?: MemoType
  content: string
  published: boolean
  createdAt: string
  updatedAt: string
  publishedAt?: string | null
  targetCount?: number
  acknowledgedCount?: number
}

type StaffOption = { id: string; fullName: string }

function summarizeAudience(filter: AudienceFilter, staffName?: Map<string, string>): string {
  const parts: string[] = []
  if (filter.roles?.length) {
    parts.push(
      filter.roles
        .map((r) => ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r.replace(/_/g, ' '))
        .join(', ')
    )
  }
  if (filter.staffIds?.length) {
    if (staffName) {
      parts.push(filter.staffIds.map((id) => staffName.get(id) ?? '?').join(', '))
    } else {
      parts.push(`${filter.staffIds.length} specific staff`)
    }
  }
  return parts.length === 0 ? 'All Staff' : parts.join(' · ')
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Pull the memo title out of the document's first <h1>. */
function extractTitle(html: string): string {
  if (typeof window === 'undefined') return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.querySelector('h1')?.textContent?.trim() ?? ''
}

/**
 * Store the body without the title H1 — the title lives in its own column and
 * both the Team card and the HR detail sheet render it as a heading separately,
 * so leaving the H1 in `content` would show the title twice. It's re-injected
 * for editing (see handleOpenEdit).
 */
function stripFirstH1(html: string): string {
  if (typeof window === 'undefined') return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelector('h1')?.remove()
  return doc.body.innerHTML
}

function htmlHasH1(html: string): boolean {
  return /<h1[\s>]/i.test(html)
}

// Media handlers passed to the slash editor.
/** Upload an image/video/file dropped into the memo's BlockNote editor. */
async function memoUpload(file: File): Promise<string> {
  const profile: UploadProfile | undefined = file.type.startsWith('image/')
    ? 'image'
    : file.type.startsWith('video/')
      ? 'video'
      : file.type.startsWith('audio/')
        ? 'audio'
        : undefined
  const res = await uploadFile(file, { storageCategory: 'misc', folder: 'memos', profile })
  if (!res.success || !res.url) throw new Error(res.error || 'Upload failed')
  return res.url
}

/** A blank memo doc — an empty H1 (the title) followed by a paragraph. */
function blankMemoDoc(): HrDoc {
  return [{ type: 'heading', props: { level: 1 } }, { type: 'paragraph' }]
}

export default function MemosPage() {
  const navigate = useNavigate()
  const location = useLocation()

  const [memos, setMemos] = useState<Memo[]>([])
  const [loading, setLoading] = useState(true)

  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft'>('all')
  const [levelFilter, setLevelFilter] = useState<'all' | MemoLevel>('all')

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingPublished, setEditingPublished] = useState(false)
  const [detailMemoId, setDetailMemoId] = useState<string | null>(null)
  const [detailSheetOpen, setDetailSheetOpen] = useState(false)

  // Only type + priority are structured fields now — the title and sections
  // live inside the content, authored via the "/" slash command.
  const [level, setLevel] = useState<MemoLevel>('info')
  const [memoType, setMemoType] = useState<MemoType>('general')
  const [audienceFilter, setAudienceFilter] = useState<AudienceFilter>({})
  const [showSpecificStaff, setShowSpecificStaff] = useState(false)
  // The BlockNote editor is the source of truth while the sheet is open; HTML
  // is derived from it only on save. `initialBlocks` seeds it (null = still
  // converting a legacy memo's HTML). `editorKey` remounts it per memo.
  const editorRef = useRef<HrRichEditorHandle>(null)
  const [initialBlocks, setInitialBlocks] = useState<HrDoc | null>(null)
  const [editorKey, setEditorKey] = useState('new')
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([])

  const ensureStaffOptions = useCallback(async () => {
    if (staffOptions.length > 0) return
    const res = await getStaff()
    if (res.success && Array.isArray(res.data)) {
      setStaffOptions(res.data.map((s) => ({ id: s.id, fullName: s.fullName })))
    }
  }, [staffOptions.length])

  const staffNameMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of staffOptions) m.set(s.id, s.fullName)
    return m
  }, [staffOptions])

  const filteredMemos = useMemo(() => {
    return memos.filter((m) => {
      if (statusFilter === 'published' && !m.published) return false
      if (statusFilter === 'draft' && m.published) return false
      if (levelFilter !== 'all' && m.level !== levelFilter) return false
      return true
    })
  }, [memos, statusFilter, levelFilter])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await api.get<Memo[]>('/api/staff/memos')
    if (res.success && Array.isArray(res.data)) {
      setMemos(res.data)
    } else {
      toast.error(res.error || 'Failed to load memos')
      setMemos([])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const state = location.state as { detailMemoId?: string } | null
    if (!state?.detailMemoId) return
    setDetailMemoId(state.detailMemoId)
    setDetailSheetOpen(true)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.state, location.pathname, navigate])

  const [pendingEditId, setPendingEditId] = useState<string | null>(null)
  useEffect(() => {
    const state = location.state as { editMemoId?: string } | null
    if (state?.editMemoId) {
      setPendingEditId(state.editMemoId)
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location.state, location.pathname, navigate])

  function handleOpenCreate() {
    setEditingId(null)
    setEditingPublished(false)
    setLevel('info')
    setMemoType('general')
    setAudienceFilter({})
    setShowSpecificStaff(false)
    setInitialBlocks(blankMemoDoc())
    setEditorKey(`new-${Date.now()}`)
    setSheetOpen(true)
    void ensureStaffOptions()
  }

  const handleOpenEdit = useCallback(
    async (memo: Memo) => {
      setEditingId(memo.id)
      setEditingPublished(memo.published)
      setLevel(memo.level)
      setMemoType(memo.memoType ?? 'general')
      const filter = memo.audienceFilter ?? {}
      setAudienceFilter(filter)
      setShowSpecificStaff((filter.staffIds?.length ?? 0) > 0)
      // Old memos kept the title in a separate column; surface it as an editable
      // H1 so the title stays intact under the new "title lives in the content" model.
      const html = htmlHasH1(memo.content)
        ? memo.content
        : `<h1>${escapeHtml(memo.title)}</h1>${memo.content || '<p></p>'}`
      // Convert the stored HTML into BlockNote blocks so the memo re-opens in the
      // same editor. Null while converting → the content card shows a spinner.
      setInitialBlocks(null)
      setEditorKey(memo.id)
      setSheetOpen(true)
      void ensureStaffOptions()
      setInitialBlocks(await htmlToBlocks(html))
    },
    [ensureStaffOptions]
  )

  useEffect(() => {
    if (!pendingEditId || memos.length === 0) return
    const memo = memos.find((m) => m.id === pendingEditId)
    if (memo) handleOpenEdit(memo)
    setPendingEditId(null)
  }, [memos, pendingEditId, handleOpenEdit])

  function toggleFilterValue(key: keyof AudienceFilter, value: string) {
    setAudienceFilter((prev) => {
      const current = prev[key] ?? []
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value]
      return { ...prev, [key]: next.length > 0 ? next : undefined }
    })
  }

  function toggleSpecificStaff(checked: boolean) {
    setShowSpecificStaff(checked)
    // Turning the mode off clears any specific-staff targeting.
    if (!checked) setAudienceFilter((prev) => ({ ...prev, staffIds: undefined }))
  }

  async function handleSave() {
    const html = (await editorRef.current?.getHTML()) ?? ''
    const title = extractTitle(html)
    if (!title) {
      toast.error('Add a title — start the content with a Heading 1')
      return
    }
    const audienceSummary = summarizeAudience(audienceFilter, staffNameMap)
    const payload = {
      title,
      audience: audienceSummary,
      audienceFilter,
      level,
      memoType,
      // Body only — the title H1 is stripped so it isn't rendered twice.
      content: stripFirstH1(html),
      blocks: [],
      published: editingId ? editingPublished : false,
    }
    const res = editingId
      ? await api.patch<Memo>(`/api/staff/memos/${editingId}`, payload)
      : await api.post<Memo>('/api/staff/memos', payload)
    if (res.success) {
      toast.success(editingId ? 'Memo updated' : 'Memo created (draft)')
      setSheetOpen(false)
      setEditingId(null)
      await load()
      return
    }
    toast.error(res.error || 'Failed to save memo')
  }

  const columns = useMemo<ColumnDef<Memo>[]>(
    () => [
      {
        accessorKey: 'title',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Title" />,
        cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
      },
      {
        accessorKey: 'audience',
        header: 'Audience',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{row.original.audience}</span>
        ),
      },
      {
        id: 'readReceipts',
        header: 'Read',
        cell: ({ row }) => {
          const m = row.original
          const ack = m.acknowledgedCount ?? 0
          const target = m.targetCount ?? 0
          if (!m.published) return <span className="text-xs text-muted-foreground">—</span>
          const pct = target === 0 ? 0 : Math.round((ack / target) * 100)
          return (
            <div className="flex items-center gap-1.5 text-xs">
              <Users className="h-3 w-3 text-muted-foreground" />
              <span className="tabular-nums">
                {ack} / {target}
              </span>
              {target > 0 && <span className="text-muted-foreground">({pct}%)</span>}
            </div>
          )
        },
      },
      {
        accessorKey: 'level',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Priority" />,
        cell: ({ row }) => (
          <TagBadge label={row.original.level} className="capitalize">
            {row.original.level}
          </TagBadge>
        ),
      },
      {
        accessorKey: 'published',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.published ? 'published' : 'draft'} />,
      },
      {
        accessorKey: 'updatedAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Updated" />,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.publishedAt
              ? new Date(row.original.publishedAt).toLocaleDateString()
              : new Date(row.original.updatedAt).toLocaleDateString()}
          </span>
        ),
      },
    ],
    []
  )

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Memos</h1>
          <p className="text-muted-foreground mt-1">
            Broadcast announcements and internal communications to staff.
          </p>
        </div>
        <Button onClick={handleOpenCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add new memo
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Megaphone className="h-5 w-5" />
                All memos
              </CardTitle>
              <CardDescription>Click a row to read, edit, or delete a memo.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
              >
                <SelectTrigger className="h-9 w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={levelFilter}
                onValueChange={(v) => setLevelFilter(v as typeof levelFilter)}
              >
                <SelectTrigger className="h-9 w-[140px]">
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All priorities</SelectItem>
                  {PRIORITY_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-muted-foreground">Loading…</div>
          ) : memos.length > 0 ? (
            <DataTable
              columns={columns}
              data={filteredMemos}
              meta={{
                onRowClick: (memo: Memo) => {
                  setDetailMemoId(memo.id)
                  setDetailSheetOpen(true)
                },
              }}
            />
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              No memos yet. Click &quot;Add new memo&quot; to create one.
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-[900px]">
          <SheetHeader className="border-b px-6 py-4">
            <SheetTitle>{editingId ? 'Edit Memo' : 'Create Memo'}</SheetTitle>
            <SheetDescription>
              Set the audience, type &amp; priority, then write the memo — type &quot;/&quot; for
              the title, sections, and media.
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="h-[calc(100vh-150px)]">
            <div className="space-y-4 px-6 py-4">
              {/* ── Card 1 — Audience ─────────────────────────────────────── */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">Audience</CardTitle>
                    <span className="text-xs text-muted-foreground">
                      {summarizeAudience(audienceFilter, staffNameMap)}
                    </span>
                  </div>
                  <CardDescription>
                    Leave everything unselected to broadcast to all active staff. Selections combine
                    — a staffer matches if they fit ANY of them.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Roles
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {ROLE_OPTIONS.map((opt) => {
                        const checked = audienceFilter.roles?.includes(opt.value) ?? false
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => toggleFilterValue('roles', opt.value)}
                            className={cn(
                              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                              checked
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border bg-background hover:bg-muted/50'
                            )}
                          >
                            {opt.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      checked={showSpecificStaff}
                      onCheckedChange={(v) => toggleSpecificStaff(v === true)}
                    />
                    <span>Target specific staff members</span>
                  </label>

                  {showSpecificStaff && (
                    <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border bg-background p-2">
                      {staffOptions.length === 0 ? (
                        <p className="px-1.5 py-1 text-xs text-muted-foreground">Loading staff…</p>
                      ) : (
                        staffOptions.map((s) => {
                          const checked = audienceFilter.staffIds?.includes(s.id) ?? false
                          return (
                            <label
                              key={s.id}
                              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/40"
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => toggleFilterValue('staffIds', s.id)}
                              />
                              <span className="truncate">{s.fullName}</span>
                            </label>
                          )
                        })
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* ── Card 2 — Type & Priority ──────────────────────────────── */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Type &amp; Priority</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Type
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {MEMO_TYPE_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setMemoType(opt.value)}
                          className={cn(
                            'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                            memoType === opt.value
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-background hover:bg-muted/50'
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Priority
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {PRIORITY_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setLevel(opt.value)}
                          className={cn(
                            'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                            level === opt.value
                              ? opt.activeClass
                              : 'border-border bg-background hover:bg-muted/50'
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* ── Card 3 — Content ──────────────────────────────────────── */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Content</CardTitle>
                  <CardDescription>
                    Start with a <strong>Heading 1</strong> for the title (required). Type{' '}
                    <span className="font-mono">/</span> for sections, lists, images, and YouTube
                    embeds.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {initialBlocks ? (
                    <HrRichEditor
                      key={editorKey}
                      ref={editorRef}
                      initialContent={initialBlocks}
                      uploadFile={memoUpload}
                    />
                  ) : (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      Loading editor…
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </ScrollArea>

          <SheetFooter className="border-t px-6 py-4">
            <Button variant="outline" onClick={() => setSheetOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>{editingId ? 'Update' : 'Create'} Memo</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <MemoDetailSheet
        memoId={detailMemoId}
        open={detailSheetOpen}
        onOpenChange={(next) => {
          setDetailSheetOpen(next)
          if (!next) setDetailMemoId(null)
        }}
        onEdit={(id) => {
          setDetailSheetOpen(false)
          setDetailMemoId(null)
          const memo = memos.find((m) => m.id === id)
          if (memo) handleOpenEdit(memo)
        }}
        onDeleted={() => {
          setDetailMemoId(null)
          void load()
        }}
        onChanged={() => void load()}
      />
    </div>
  )
}
