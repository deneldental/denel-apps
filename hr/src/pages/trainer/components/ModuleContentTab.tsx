import { Button } from '@denel/ui'
import { Loader2, Save } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { type UploadProfile, uploadFile } from '@/lib/actions/upload'
import {
  type HrDoc,
  HrRichEditor,
  type HrRichEditorHandle,
  htmlToBlocks,
} from '@/shared/components/blocknote/editor'
import type { ContentBlock } from '../hooks/useModuleDetail'

/**
 * Training module body — one BlockNote document (consistent with memos + the
 * Handbook). It reads/writes the module's HTML, stored as a single section
 * block, so the learner's viewer and any legacy multi-section modules keep
 * working with no migration.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Flatten legacy section/divider blocks into one HTML document to import. */
function legacyBlocksToHtml(blocks: ContentBlock[]): string {
  return blocks
    .map((b) =>
      b.type === 'divider'
        ? '<hr />'
        : `${b.title ? `<h2>${escapeHtml(b.title)}</h2>` : ''}${b.content || ''}`
    )
    .join('\n')
}

/** Upload an image/video/file dropped into the module's BlockNote editor. */
async function trainingUpload(file: File): Promise<string> {
  const profile: UploadProfile | undefined = file.type.startsWith('image/')
    ? 'image'
    : file.type.startsWith('video/')
      ? 'video'
      : file.type.startsWith('audio/')
        ? 'audio'
        : undefined
  const res = await uploadFile(file, { storageCategory: 'staff', folder: 'training', profile })
  if (!res.success || !res.url) throw new Error(res.error || 'Upload failed')
  return res.url
}

export function ModuleContentTab({
  initialBlocks,
  onSave,
}: {
  initialBlocks: ContentBlock[] | null
  onSave: (html: string) => Promise<void>
}) {
  const editorRef = useRef<HrRichEditorHandle>(null)
  const [doc, setDoc] = useState<HrDoc | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  // Convert the module's stored blocks into a BlockNote document once, when the
  // module has loaded.
  useEffect(() => {
    if (initialBlocks === null) return
    let alive = true
    const html = legacyBlocksToHtml(initialBlocks)
    void htmlToBlocks(html).then((blocks) => {
      if (alive) setDoc(blocks.length > 0 ? blocks : [])
    })
    return () => {
      alive = false
    }
  }, [initialBlocks])

  async function handleSave() {
    const html = (await editorRef.current?.getHTML()) ?? ''
    setSaving(true)
    try {
      await onSave(html)
      setDirty(false)
      toast.success('Content saved')
    } catch {
      toast.error('Failed to save content')
    } finally {
      setSaving(false)
    }
  }

  if (doc === null) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" /> {dirty ? 'Save content' : 'Saved'}
            </>
          )}
        </Button>
      </div>
      <div className="rounded-2xl border bg-background py-3">
        <HrRichEditor
          initialContent={doc}
          uploadFile={trainingUpload}
          onChange={() => setDirty(true)}
          ref={editorRef}
        />
      </div>
    </div>
  )
}
