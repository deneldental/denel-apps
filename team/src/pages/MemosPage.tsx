import { StatCard } from '@denel/ui/blocks'
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Megaphone,
  RefreshCw,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { staffApi } from '@/lib/api'
import { sanitizeHtml } from '@/lib/sanitize'
import { cn } from '@/lib/utils'
import { BLOCKNOTE_CONTENT_CLASS } from '@/shared/lib/blocknote-content'

const PAGE_SIZE = 10

interface Memo {
  id: string
  title: string
  body?: string
  content?: string
  audience: string
  level: 'info' | 'important' | 'warning' | 'critical'
  memoType?: string
  postedAt?: string
  createdAt?: string
  publishedAt?: string | null
  acknowledged?: boolean
  blocks?: Array<
    | { id: string; type: 'section'; title: string; content: string }
    | { id: string; type: 'divider' }
  >
}

const FILTER_TABS = [
  { value: '', label: 'All' },
  { value: 'announcement', label: 'Announcements' },
  { value: 'notice', label: 'Notices' },
  { value: 'meeting_memo', label: 'Meetings' },
]

// Tone palette keyed by urgency + read state
function getTone(memo: Memo): 'emerald' | 'amber' | 'sky' | 'brand' {
  if (memo.level === 'critical' || memo.level === 'warning') return 'brand'
  if (memo.acknowledged) return 'emerald'
  if (memo.level === 'important') return 'amber'
  return 'sky'
}

const TONE_STYLES = {
  emerald: {
    card: 'border-emerald-100 bg-emerald-50/70 text-emerald-950 hover:border-emerald-200 hover:bg-emerald-50',
    chip: 'bg-emerald-100 text-emerald-700',
    icon: 'text-emerald-500',
    dot: 'bg-emerald-400',
  },
  amber: {
    card: 'border-amber-100 bg-amber-50 text-amber-950 hover:border-amber-200 hover:bg-amber-100/50',
    chip: 'bg-amber-100 text-amber-700',
    icon: 'text-amber-500',
    dot: 'bg-amber-400',
  },
  sky: {
    card: 'border-sky-100 bg-sky-50 text-sky-950 hover:border-sky-200 hover:bg-sky-100/50',
    chip: 'bg-sky-100 text-sky-700',
    icon: 'text-sky-500',
    dot: 'bg-sky-400',
  },
  brand: {
    card: 'border-brand/20 bg-brand/5 text-foreground hover:border-brand/30 hover:bg-brand/10',
    chip: 'bg-brand/15 text-brand',
    icon: 'text-brand',
    dot: 'bg-brand',
  },
}

export default function MemosPage() {
  const [memos, setMemos] = useState<Memo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeType, setActiveType] = useState('')
  const [page, setPage] = useState(1)
  const [ackingId, setAckingId] = useState<string | null>(null)
  /** The memo currently open in the bottom sheet (null = closed). */
  const [selected, setSelected] = useState<Memo | null>(null)

  async function markAsRead(memoId: string) {
    if (ackingId) return
    setAckingId(memoId)
    setMemos((prev) => prev.map((m) => (m.id === memoId ? { ...m, acknowledged: true } : m)))
    // Keep the sheet open with the updated memo state
    setSelected((prev) => (prev?.id === memoId ? { ...prev, acknowledged: true } : prev))
    try {
      const res = await staffApi.acknowledgeMemo(memoId)
      if (!res.success) {
        setMemos((prev) => prev.map((m) => (m.id === memoId ? { ...m, acknowledged: false } : m)))
        setSelected((prev) => (prev?.id === memoId ? { ...prev, acknowledged: false } : prev))
      }
    } catch {
      setMemos((prev) => prev.map((m) => (m.id === memoId ? { ...m, acknowledged: false } : m)))
      setSelected((prev) => (prev?.id === memoId ? { ...prev, acknowledged: false } : prev))
    } finally {
      setAckingId(null)
    }
  }

  const loadMemos = async (type: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await staffApi.getMemos(type || undefined)
      if (res.success && Array.isArray(res.data)) {
        const normalized = (res.data as Memo[]).map((memo) => ({
          ...memo,
          postedAt: memo.postedAt || memo.publishedAt || memo.createdAt || new Date().toISOString(),
        }))
        setMemos(normalized)
      } else {
        setError(res.error || 'Failed to load memos')
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadMemos is defined inline; refetch only when filter changes
  useEffect(() => {
    void loadMemos(activeType)
    setPage(1)
  }, [activeType])

  const sortedMemos = useMemo(
    () =>
      [...memos].sort(
        (a, b) =>
          new Date(b.postedAt || b.createdAt || b.publishedAt || new Date()).getTime() -
          new Date(a.postedAt || a.createdAt || a.publishedAt || new Date()).getTime()
      ),
    [memos]
  )

  if (error) {
    return (
      <div className="page-enter p-5 space-y-4">
        <h1 className="text-xl font-bold tracking-tight">Memos</h1>
        <Card>
          <CardContent className="p-6 text-center space-y-3">
            <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-medium">Could not load memos</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
            <Button onClick={() => void loadMemos(activeType)} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const unreadCount = memos.filter((m) => !m.acknowledged).length
  const readCount = memos.filter((m) => m.acknowledged).length
  const criticalCount = memos.filter((m) => m.level === 'critical' || m.level === 'warning').length

  const totalPages = Math.max(1, Math.ceil(sortedMemos.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * PAGE_SIZE
  const pagedMemos = sortedMemos.slice(pageStart, pageStart + PAGE_SIZE)

  return (
    <div className="page-enter p-5 space-y-5 pb-20">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Memos</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Messages and announcements shared with your team.
        </p>
      </div>

      {!loading && !error && memos.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard tone="amber" icon={Megaphone} value={unreadCount} label="Unread" />
          <StatCard tone="emerald" icon={CheckCircle2} value={readCount} label="Read" />
          <StatCard tone="brand" icon={AlertCircle} value={criticalCount} label="Critical" />
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setActiveType(tab.value)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-bold border transition-all active:scale-95 duration-150',
              activeType === tab.value
                ? 'bg-primary text-white border-primary shadow-xs'
                : 'bg-background text-muted-foreground border-border hover:border-primary/30 hover:text-foreground'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2.5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton h-16 rounded-xl" />
          ))}
        </div>
      ) : sortedMemos.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No memos in this category yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {pagedMemos.map((memo) => {
            const tone = getTone(memo)
            const t = TONE_STYLES[tone]

            return (
              <button
                key={memo.id}
                type="button"
                onClick={() => setSelected(memo)}
                className={cn(
                  'w-full text-left relative flex items-center gap-3 rounded-2xl border px-4 py-3.5 transition-all duration-150 active:scale-[0.99] cursor-pointer',
                  t.card
                )}
              >
                {/* Unread dot */}
                {!memo.acknowledged && (
                  <span
                    className={cn('absolute top-3.5 left-2.5 h-1.5 w-1.5 rounded-full', t.dot)}
                  />
                )}

                {/* Icon */}
                <div className={cn('shrink-0', t.icon)}>
                  <Megaphone size={16} />
                </div>

                {/* Title */}
                <p className="font-semibold text-sm leading-snug flex-1 min-w-0 truncate pr-1">
                  {memo.title}
                </p>

                {/* Tags */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {memo.acknowledged && <CheckCircle2 size={14} className="text-emerald-500" />}
                  <Badge
                    variant="outline"
                    className={cn(
                      'capitalize font-bold border-none px-2 py-0.5 text-[9px] rounded-md',
                      t.chip
                    )}
                  >
                    {memo.level}
                  </Badge>
                  {memo.memoType && memo.memoType !== 'general' && (
                    <Badge
                      variant="outline"
                      className={cn(
                        'capitalize font-bold border-none px-2 py-0.5 text-[9px] rounded-md bg-background/60',
                        t.chip
                      )}
                    >
                      {memo.memoType.replace('_', ' ')}
                    </Badge>
                  )}
                </div>
              </button>
            )
          })}

          {sortedMemos.length > PAGE_SIZE && (
            <Pagination
              page={safePage}
              totalPages={totalPages}
              onChange={setPage}
              total={sortedMemos.length}
              pageSize={PAGE_SIZE}
            />
          )}
        </div>
      )}

      {/* ── Bottom-sheet detail view ─────────────────────────────────── */}
      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <SheetContent side="bottom" className="p-0 rounded-t-2xl max-h-[85dvh] overflow-y-auto">
          {selected && (
            <MemoSheetBody memo={selected} ackingId={ackingId} onMarkRead={markAsRead} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

// ─── Bottom-sheet body ───────────────────────────────────────────────────────
function MemoSheetBody({
  memo,
  ackingId,
  onMarkRead,
}: {
  memo: Memo
  ackingId: string | null
  onMarkRead: (id: string) => Promise<void>
}) {
  const tone = getTone(memo)
  const t = TONE_STYLES[tone]

  return (
    <div className="flex flex-col">
      {/* Drag handle */}
      <div className="flex justify-center pt-3 pb-1 shrink-0">
        <div className="h-1 w-10 rounded-full bg-muted-foreground/20" />
      </div>

      {/* Header */}
      <SheetHeader className="px-5 pt-3 pb-4 text-left shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0 flex-1">
            <div className={cn('mt-0.5 shrink-0', t.icon)}>
              <Megaphone size={18} />
            </div>
            <SheetTitle className="text-base font-bold leading-snug">{memo.title}</SheetTitle>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0 pt-0.5">
            <Badge
              variant="outline"
              className={cn(
                'capitalize font-bold border-none px-2 py-0.5 text-[9px] rounded-md',
                t.chip
              )}
            >
              {memo.level}
            </Badge>
            {memo.memoType && memo.memoType !== 'general' && (
              <Badge
                variant="outline"
                className={cn(
                  'capitalize font-bold border-none px-2 py-0.5 text-[9px] rounded-md bg-background/50',
                  t.chip
                )}
              >
                {memo.memoType.replace('_', ' ')}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Users size={10} />
            {memo.audience}
          </span>
          <span className="inline-flex items-center gap-1">
            <Calendar size={10} />
            {new Date(
              memo.postedAt || memo.createdAt || memo.publishedAt || new Date()
            ).toLocaleDateString()}
          </span>
        </div>
        <SheetDescription className="sr-only">{memo.title} memo details</SheetDescription>
      </SheetHeader>

      <div className="h-px bg-border shrink-0" />

      {/* Rich content */}
      <div className="px-5 py-4 overflow-y-auto flex-1">
        <div
          className={cn('w-full text-sm text-foreground', BLOCKNOTE_CONTENT_CLASS)}
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(memoToHtml(memo)) }}
        />
      </div>

      {/* Footer action */}
      <div className="px-5 pb-6 pt-3 border-t border-border shrink-0">
        {memo.acknowledged ? (
          <div className="flex items-center justify-center gap-2 py-2 text-emerald-600 text-sm font-semibold">
            <CheckCircle2 size={16} />
            You've read this memo
          </div>
        ) : (
          <Button
            type="button"
            className="w-full gap-2 h-11 rounded-xl font-bold text-sm bg-primary hover:bg-primary/90 text-white"
            onClick={() => void onMarkRead(memo.id)}
            disabled={ackingId === memo.id}
          >
            {ackingId === memo.id ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Marking as read…
              </>
            ) : (
              <>
                <Check size={15} />
                Mark as read
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  )
}

function Pagination({
  page,
  totalPages,
  onChange,
  total,
  pageSize,
}: {
  page: number
  totalPages: number
  onChange: (page: number) => void
  total: number
  pageSize: number
}) {
  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)
  return (
    <div className="flex items-center justify-between pt-3">
      <span className="text-xs text-muted-foreground">
        {start}–{end} of {total}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
        </Button>
        <span className="text-xs font-semibold px-2">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  )
}

function isSafeUrl(url: string) {
  const value = url.trim().toLowerCase()
  return (
    value.startsWith('http://') || value.startsWith('https://') || value.startsWith('data:image/')
  )
}

// Embeds are constrained to known video providers — mirrors the backend's
// allowedIframeHostnames so an <iframe> can only ever point at a video host.
const EMBED_HOSTS = [
  'www.youtube.com',
  'youtube.com',
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
  'player.vimeo.com',
  'vimeo.com',
]
function isSafeEmbedUrl(url: string) {
  try {
    return EMBED_HOSTS.includes(new URL(url.trim()).hostname.toLowerCase())
  } catch {
    return false
  }
}

function sanitizeMemoHtml(input: string) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(input, 'text/html')

  const allowed = new Set([
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    'ul',
    'ol',
    'li',
    'a',
    'img',
    'video',
    'source',
    // YouTube/Vimeo embeds authored in the memo editor. Without this the whole
    // <iframe> was dropped here before DOMPurify ever saw it, so embeds simply
    // vanished for staff. src is host-checked below.
    'iframe',
    'h1',
    'h2',
    'h3',
    'h4',
    'blockquote',
    'hr',
    'div',
    'span',
  ])

  const allowedAttrs: Record<string, Set<string>> = {
    a: new Set(['href', 'target', 'rel']),
    img: new Set(['src', 'alt']),
    video: new Set(['src', 'controls', 'poster']),
    source: new Set(['src', 'type']),
    iframe: new Set(['src', 'title', 'width', 'height', 'frameborder', 'allow', 'allowfullscreen']),
    div: new Set(['class']),
    span: new Set(['class']),
  }

  const walk = (node: Element) => {
    const tag = node.tagName.toLowerCase()

    if (!allowed.has(tag)) {
      const parent = node.parentNode
      if (parent) {
        while (node.firstChild) parent.insertBefore(node.firstChild, node)
        parent.removeChild(node)
      }
      return
    }

    // An embed that isn't a known video host is removed outright.
    if (tag === 'iframe' && !isSafeEmbedUrl(node.getAttribute('src') ?? '')) {
      node.parentNode?.removeChild(node)
      return
    }

    const attrs = Array.from(node.attributes)
    for (const attr of attrs) {
      const name = attr.name.toLowerCase()
      const value = attr.value

      if (name.startsWith('on')) {
        node.removeAttribute(attr.name)
        continue
      }

      const allowedForTag = allowedAttrs[tag]
      if (!allowedForTag?.has(name)) {
        node.removeAttribute(attr.name)
        continue
      }

      if ((name === 'href' || name === 'src') && !isSafeUrl(value)) {
        node.removeAttribute(attr.name)
      }
    }

    if (tag === 'a') {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }

    if (tag === 'video') {
      node.setAttribute('controls', 'true')
      ;(node as HTMLElement).style.width = '100%'
      ;(node as HTMLElement).style.maxHeight = '420px'
      ;(node as HTMLElement).style.objectFit = 'contain'
      ;(node as HTMLElement).style.borderRadius = '12px'
    }

    if (tag === 'img') {
      ;(node as HTMLElement).style.width = '100%'
      ;(node as HTMLElement).style.height = 'auto'
      ;(node as HTMLElement).style.maxHeight = '420px'
      ;(node as HTMLElement).style.objectFit = 'cover'
      ;(node as HTMLElement).style.borderRadius = '12px'
    }

    Array.from(node.children).forEach(walk)
  }

  Array.from(doc.body.children).forEach(walk)
  return doc.body.innerHTML
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function memoToHtml(memo: Memo) {
  if (memo.blocks?.length) {
    const html = memo.blocks
      .map((block) => {
        if (block.type === 'divider') return '<hr />'
        return `<section><h3>${escapeHtml(block.title)}</h3>${block.content || '<p></p>'}</section>`
      })
      .join('')
    return sanitizeMemoHtml(html)
  }

  if (memo.content) {
    return sanitizeMemoHtml(memo.content)
  }

  if (memo.body) {
    return `<p>${escapeHtml(memo.body).replace(/\n/g, '<br />')}</p>`
  }

  return ''
}
