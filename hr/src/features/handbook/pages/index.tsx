import { Button } from '@denel/ui'
import { formatDistanceToNow } from 'date-fns'
import { BookText, Download, Loader2, Lock, Save, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  getHandbook,
  type HandbookBlock,
  type HandbookDoc,
  saveHandbook,
} from '@/lib/actions/handbook'
import { type UploadProfile, uploadFile } from '@/lib/actions/upload'
import { ACTIONS, MODULES } from '@/lib/modules'
import { HrRichEditor, type HrRichEditorHandle } from '@/shared/components/blocknote/editor'
import { EmptyState } from '@/shared/components/empty-state'
import { usePermissions } from '@/shared/hooks/use-permissions'

/**
 * HR Handbook — the company's living policy document.
 *
 * One shared, always-current handbook every staff member can read. HR admins
 * (settings:update) author it inline with BlockNote; everyone else sees the
 * same document read-only. Content is stored as BlockNote block-JSON on the
 * backend under a single clinic-settings key.
 */

/**
 * Upload a file dropped/picked inside the editor to clinic storage and hand the
 * URL back to BlockNote. BlockNote only renders the image/file upload UI when an
 * `uploadFile` handler is supplied — without this, image blocks are URL-only.
 * Applies to every file block (image, video, audio, generic file); the server
 * profile is chosen from the MIME type so its whitelist + magic-byte checks fit.
 */
async function uploadToStorage(file: File): Promise<string> {
  const profile: UploadProfile | undefined = file.type.startsWith('image/')
    ? 'image'
    : file.type === 'application/pdf'
      ? 'pdf'
      : file.type.startsWith('video/')
        ? 'video'
        : file.type.startsWith('audio/')
          ? 'audio'
          : undefined

  const res = await uploadFile(file, {
    storageCategory: 'system_docs',
    folder: 'handbook',
    profile,
  })
  if (!res.success || !res.url) throw new Error(res.error || 'Upload failed')
  return res.url
}

export default function HandbookPage() {
  const { isAdmin, hasPermission, isLoading: permsLoading } = usePermissions()
  const canEdit = isAdmin || hasPermission(MODULES.STAFF as string, ACTIONS.UPDATE as string)

  const [doc, setDoc] = useState<HandbookDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is unread, only bumped by Retry to force a re-run
  useEffect(() => {
    let alive = true
    setLoading(true)
    void (async () => {
      const res = await getHandbook()
      if (!alive) return
      if (res.success) {
        setDoc(res.data ?? null)
        setError(null)
      } else {
        setError(res.error || 'Failed to load the handbook')
      }
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [attempt])

  if (loading || permsLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // A failed/timed-out load looks identical to "no handbook yet" unless we
  // distinguish them — rendering the editor here would let an admin who
  // didn't notice the toast start typing into what looks like an empty
  // handbook and Save, permanently overwriting the real content.
  if (error) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <Header updatedAt={null} updatedBy={null} canEdit={false} />
        <EmptyState
          icon={BookText}
          title="Failed to load the handbook"
          description={error}
          action={{ label: 'Retry', onClick: () => setAttempt((n) => n + 1), variant: 'outline' }}
        />
      </div>
    )
  }

  const hasContent = !!doc?.content && doc.content.length > 0

  // Nothing authored yet, and this viewer can't author → a clean empty state
  // rather than a blank read-only editor.
  if (!hasContent && !canEdit) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <Header updatedAt={null} updatedBy={null} canEdit={false} />
        <EmptyState
          icon={BookText}
          title="No handbook yet"
          description="Company policies will appear here once HR publishes the handbook."
        />
      </div>
    )
  }

  // The editor is created with initialContent at mount, so it can only render
  // once the document has loaded — hence the split component below.
  return <HandbookEditor initial={doc} canEdit={canEdit} />
}

function HandbookEditor({ initial, canEdit }: { initial: HandbookDoc | null; canEdit: boolean }) {
  const editorRef = useRef<HrRichEditorHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [meta, setMeta] = useState<{ updatedAt: string | null; updatedBy: string | null }>({
    updatedAt: initial?.updatedAt ?? null,
    updatedBy: initial?.updatedBy ?? null,
  })

  const handleSave = useCallback(async () => {
    const doc = editorRef.current?.getDocument() ?? []
    setSaving(true)
    const res = await saveHandbook(doc as HandbookBlock[])
    setSaving(false)
    if (!res.success) {
      toast.error(res.error || 'Failed to save the handbook')
      return
    }
    setDirty(false)
    setMeta({ updatedAt: res.data?.updatedAt ?? new Date().toISOString(), updatedBy: 'You' })
    toast.success('Handbook saved.')
  }, [])

  // Export the current document as a Markdown file. Lossy (BlockNote → Markdown),
  // but a clean, portable format for editing offline or archiving.
  const handleDownload = useCallback(async () => {
    if (!editorRef.current) return
    setDownloading(true)
    try {
      const md = await editorRef.current.getMarkdown()
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `hr-handbook-${new Date().toISOString().slice(0, 10)}.md`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Could not generate the Markdown file.')
    } finally {
      setDownloading(false)
    }
  }, [])

  // Re-import a Markdown file into the editor. Replaces the whole document and
  // marks it dirty — the admin reviews and then Saves to publish.
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset the input so re-picking the same file fires onChange again.
    e.target.value = ''
    if (!file || !editorRef.current) return
    setImporting(true)
    try {
      const text = await file.text()
      await editorRef.current.setMarkdown(text)
      setDirty(true)
      toast.success('Markdown imported — review the content, then Save to publish.')
    } catch {
      toast.error('Could not read that Markdown file.')
    } finally {
      setImporting(false)
    }
  }, [])

  return (
    <div className="flex flex-col gap-6 p-6">
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,text/markdown,text/plain"
        className="hidden"
        onChange={handleFileChange}
      />
      <Header
        updatedAt={meta.updatedAt}
        updatedBy={meta.updatedBy}
        canEdit={canEdit}
        saving={saving}
        dirty={dirty}
        onSave={handleSave}
        downloading={downloading}
        onDownload={handleDownload}
        importing={importing}
        onImport={() => fileInputRef.current?.click()}
      />

      <div className="rounded-xl border bg-background py-4">
        <HrRichEditor
          ref={editorRef}
          initialContent={initial?.content ?? undefined}
          editable={canEdit}
          uploadFile={uploadToStorage}
          onChange={() => setDirty(true)}
        />
      </div>
    </div>
  )
}

function Header({
  updatedAt,
  updatedBy,
  canEdit,
  saving = false,
  dirty = false,
  onSave,
  downloading = false,
  onDownload,
  importing = false,
  onImport,
}: {
  updatedAt: string | null
  updatedBy: string | null
  canEdit: boolean
  saving?: boolean
  dirty?: boolean
  onSave?: () => void
  downloading?: boolean
  onDownload?: () => void
  importing?: boolean
  onImport?: () => void
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <BookText className="h-7 w-7 text-muted-foreground" />
          HR Handbook
        </h1>
        <p className="mt-1 text-muted-foreground">
          {canEdit
            ? 'The living document of company policies — every staff member sees your latest saved version.'
            : 'The company policy handbook. Kept current by HR.'}
        </p>
        {updatedAt && (
          <p className="mt-1 text-xs text-muted-foreground">
            Last updated {formatDistanceToNow(new Date(updatedAt), { addSuffix: true })}
            {updatedBy ? ` by ${updatedBy}` : ''}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Download the current handbook as Markdown — available to any viewer. */}
        <Button variant="outline" onClick={onDownload} disabled={downloading}>
          {downloading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Download .md
        </Button>

        {canEdit ? (
          <>
            {/* Re-import a Markdown file — replaces the document (review, then Save). */}
            <Button variant="outline" onClick={onImport} disabled={importing || saving}>
              {importing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              Import .md
            </Button>

            <Button onClick={onSave} disabled={saving || !dirty}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  {dirty ? 'Save changes' : 'Saved'}
                </>
              )}
            </Button>
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" />
            Read-only
          </span>
        )}
      </div>
    </div>
  )
}
