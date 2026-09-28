// PR-20 — Memo detail rendered as a slide-in Sheet to match the create-memo
// flow (UI consistency: reading and authoring share the same affordance).
// Mounted from the memos list page on row click; the legacy /hr/memos/:id
// route still exists but just hops to /hr/memos and asks the list to open
// this sheet via location.state, so old bookmarks don't 404.

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  ScrollArea,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@denel/ui'
import {
  BellRing,
  CheckCircle2,
  Clock,
  Loader2,
  Megaphone,
  Pencil,
  Send,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { ContentBlock } from '@/features/staff/components/content-block-editor'
import {
  getMemoAcknowledgements,
  type MemoAcknowledgements,
  notifyUnreadMemo,
  setMemoPublished,
} from '@/lib/actions/memos'
import { api } from '@/lib/api-client'
import { sanitizeHtml } from '@/lib/sanitize'
import { StatusBadge } from '@/shared/components/status-badge'
import { TagBadge } from '@/shared/components/tag-badge'

type MemoLevel = 'info' | 'important' | 'warning' | 'critical'

type Memo = {
  id: string
  title: string
  audience: string
  level: MemoLevel
  content: string
  blocks: ContentBlock[]
  published: boolean
  createdAt: string
  updatedAt: string
  publishedAt?: string | null
}

// NOTE: `prose` is inert here — @tailwindcss/typography isn't installed in this
// app — so every element needs an explicit style. Without the list rules below,
// the CSS reset leaves <ul>/<ol> with list-style:none (i.e. no bullets at all).
const RICH_BODY_CLASS =
  'max-w-none space-y-2 [&_img]:w-full [&_img]:max-h-[420px] [&_img]:object-cover [&_img]:rounded-md [&_video]:w-full [&_video]:max-h-[420px] [&_video]:object-contain [&_video]:rounded-md [&_iframe]:w-full [&_iframe]:aspect-video [&_iframe]:rounded-md [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_h1]:text-lg [&_h1]:font-semibold [&_h3]:text-base [&_h3]:font-semibold [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_hr]:my-3'

function renderMemoBody(memo: Memo) {
  // Newer memos store the whole document (title H1 + sections) as `content` and
  // leave `blocks` empty; older memos used the block array. Prefer blocks when
  // present, else fall back to the content HTML.
  if (!memo.blocks?.length) {
    if (memo.content?.trim()) {
      return (
        <div
          className={RICH_BODY_CLASS}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(memo.content) }}
        />
      )
    }
    return <p className="text-sm text-muted-foreground">(no content)</p>
  }
  return memo.blocks.map((block) => {
    if (block.type === 'divider') {
      return <hr key={block.id} className="my-4 border-muted-foreground/20" />
    }
    return (
      <div key={block.id} className="space-y-2">
        <p className="font-medium">{block.title}</p>
        <div
          className={RICH_BODY_CLASS}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.content || '<p></p>') }}
        />
      </div>
    )
  })
}

export function MemoDetailSheet({
  memoId,
  open,
  onOpenChange,
  onEdit,
  onDeleted,
  onChanged,
}: {
  /** Memo id to load. Null = sheet closed. */
  memoId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fired when the user clicks Edit — parent should open the editor sheet. */
  onEdit: (memoId: string) => void
  /** Fired after a successful delete so the parent can refresh its list. */
  onDeleted: () => void
  /** Fired after publish/unpublish so the parent can refresh its list. */
  onChanged?: () => void
}) {
  const [memo, setMemo] = useState<Memo | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [acks, setAcks] = useState<MemoAcknowledgements | null>(null)
  const [nudging, setNudging] = useState(false)

  const loadAcks = useCallback(async (id: string) => {
    const res = await getMemoAcknowledgements(id)
    if (res.success && res.data) setAcks(res.data)
    else setAcks(null)
  }, [])

  useEffect(() => {
    if (!memoId || !open) {
      setMemo(null)
      setAcks(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setAcks(null)
    api
      .get<Memo>(`/api/staff/memos/${memoId}`)
      .then((res) => {
        if (cancelled) return
        if (res.success && res.data) {
          setMemo(res.data)
          if (res.data.published) void loadAcks(res.data.id)
        } else toast.error(res.error || 'Memo not found')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [memoId, open, loadAcks])

  async function handleDelete() {
    if (!memo) return
    setDeleting(true)
    const res = await api.delete(`/api/staff/memos/${memo.id}`)
    setDeleting(false)
    if (res.success) {
      toast.success('Memo deleted')
      setConfirmDelete(false)
      onOpenChange(false)
      onDeleted()
    } else {
      toast.error(res.error || 'Failed to delete memo')
      setConfirmDelete(false)
    }
  }

  async function handleTogglePublish() {
    if (!memo) return
    const next = !memo.published
    setPublishing(true)
    const res = await setMemoPublished(memo.id, next)
    setPublishing(false)
    if (!res.success) {
      toast.error(res.error || 'Failed to update memo')
      return
    }
    if (next) {
      const n = res.data?.notified
      const pushed = n?.pushed ?? 0
      const texted = n?.texted ?? 0
      toast.success(
        `Memo published${pushed || texted ? ` — notified ${pushed} via app${texted ? `, ${texted} via SMS` : ''}` : ''}`
      )
    } else {
      toast.success('Memo unpublished')
    }
    setMemo({ ...memo, published: next, publishedAt: next ? new Date().toISOString() : null })
    if (next) void loadAcks(memo.id)
    else setAcks(null)
    onChanged?.()
  }

  async function handleNudge() {
    if (!memo) return
    setNudging(true)
    const res = await notifyUnreadMemo(memo.id)
    setNudging(false)
    if (res.success && res.data) {
      const { pushed, texted, pending } = res.data
      toast.success(
        pending === 0
          ? 'Everyone has read this memo — no reminders needed'
          : `Reminded ${pending} staff (${pushed} via app${texted ? `, ${texted} via SMS` : ''})`
      )
    } else {
      toast.error(res.error || 'Failed to send reminders')
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-[900px]">
          <SheetHeader className="border-b px-6 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <SheetTitle className="flex items-center gap-2">
                  <Megaphone className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{memo?.title ?? 'Memo'}</span>
                </SheetTitle>
                <SheetDescription>
                  {memo ? (
                    <>
                      Audience: <span className="font-medium">{memo.audience}</span> ·{' '}
                      {memo.published && memo.publishedAt
                        ? `Published ${new Date(memo.publishedAt).toLocaleString()}`
                        : `Last updated ${new Date(memo.updatedAt).toLocaleString()}`}
                    </>
                  ) : (
                    'Loading memo details…'
                  )}
                </SheetDescription>
              </div>
              {memo && (
                <div className="flex shrink-0 gap-2">
                  <StatusBadge status={memo.published ? 'published' : 'draft'} />
                  <TagBadge label={memo.level} className="capitalize">
                    {memo.level}
                  </TagBadge>
                </div>
              )}
            </div>
          </SheetHeader>

          <ScrollArea className="h-[calc(100vh-160px)]">
            <div className="space-y-4 px-6 py-5">
              {loading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : memo ? (
                <>
                  {renderMemoBody(memo)}

                  {/* Read receipts — only meaningful once published */}
                  {memo.published && acks && (
                    <div className="mt-2 rounded-lg border bg-muted/20 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          Read receipts
                          <span className="text-muted-foreground">
                            {acks.acknowledgedCount} / {acks.targetCount} read
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleNudge}
                          disabled={nudging || acks.pending.length === 0}
                        >
                          {nudging ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <BellRing className="mr-2 h-4 w-4" />
                          )}
                          Remind {acks.pending.length} unread
                        </Button>
                      </div>

                      <div className="mt-3 grid gap-4 sm:grid-cols-2">
                        <div>
                          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Read (
                            {acks.acknowledged.length})
                          </p>
                          {acks.acknowledged.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No one yet.</p>
                          ) : (
                            <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
                              {acks.acknowledged.map((a) => (
                                <li key={a.id} className="flex items-center justify-between gap-2">
                                  <span className="truncate">{a.staffName}</span>
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    {new Date(a.acknowledgedAt).toLocaleDateString()}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div>
                          <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            <Clock className="h-3.5 w-3.5" /> Not yet read ({acks.pending.length})
                          </p>
                          {acks.pending.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Everyone has read it.</p>
                          ) : (
                            <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
                              {acks.pending.map((p) => (
                                <li key={p.id} className="truncate">
                                  {p.name}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Memo not found.</p>
              )}
            </div>
          </ScrollArea>

          <SheetFooter className="border-t px-6 py-4">
            <Button
              variant="outline"
              className="mr-auto text-destructive hover:text-destructive"
              onClick={() => setConfirmDelete(true)}
              disabled={!memo}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
            <Button variant="outline" onClick={() => memo && onEdit(memo.id)} disabled={!memo}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Button>
            <Button onClick={handleTogglePublish} disabled={!memo || publishing}>
              {publishing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              {memo?.published ? 'Unpublish' : 'Publish & notify'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete memo?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{memo?.title}&quot;. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
