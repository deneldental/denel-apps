import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import {
  BlockNoteEditor,
  BlockNoteSchema,
  defaultBlockSpecs,
  filterSuggestionItems,
  type PartialBlock,
} from '@blocknote/core'
import { BlockNoteView } from '@blocknote/mantine'
import {
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
} from '@blocknote/react'
import { Youtube } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { YouTubeBlock } from './youtube-block'

/**
 * The shared HR BlockNote editor — one authoring surface for the Handbook,
 * memos, and training materials, so writing feels the same everywhere.
 *
 * Extends BlockNote's defaults with a custom YouTube block, wires per-host file
 * upload, and exposes an imperative handle so a host can pull both the document
 * JSON (source of truth, re-edited losslessly) and an exported HTML render (for
 * the staff-facing readers) on save.
 */

export const hrBlockNoteSchema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, youtube: YouTubeBlock() },
})

/** BlockNote document — an array of blocks. Kept loose at call sites. */
export type HrDoc = unknown[]

/**
 * Parse legacy TipTap/HTML content into blocks for this schema (used when an
 * old memo/module is opened in BlockNote for the first time). The YouTube
 * block's `parse` recognises existing iframes, so embeds survive.
 */
export async function htmlToBlocks(html: string): Promise<HrDoc> {
  const tmp = BlockNoteEditor.create({ schema: hrBlockNoteSchema })
  return (await tmp.tryParseHTMLToBlocks(html)) as HrDoc
}

/** Track the app's `dark` class so BlockNote's chrome matches the theme. */
export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  )
  useEffect(() => {
    const el = document.documentElement
    const update = () => setIsDark(el.classList.contains('dark'))
    update()
    const observer = new MutationObserver(update)
    observer.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return isDark
}

export interface HrRichEditorHandle {
  /** Current document as BlockNote JSON — persist as the source of truth. */
  getDocument: () => HrDoc
  /** Standard HTML render of the document — persist for the read side. */
  getHTML: () => Promise<string>
  /** Markdown render of the document — lossy; used for export/download. */
  getMarkdown: () => Promise<string>
  /**
   * Replace the whole document from a Markdown string (lossy round-trip).
   * Used to re-import a previously downloaded handbook. Fires `onChange`.
   */
  setMarkdown: (markdown: string) => Promise<void>
}

interface HrRichEditorProps {
  /** Initial BlockNote document. Omit/empty for a blank editor. */
  initialContent?: HrDoc
  editable?: boolean
  /** Upload a dropped/picked file and return its URL (image/video/file blocks). */
  uploadFile: (file: File) => Promise<string>
  /** Fires on every edit — use to flag unsaved changes. */
  onChange?: () => void
  className?: string
}

export const HrRichEditor = forwardRef<HrRichEditorHandle, HrRichEditorProps>(function HrRichEditor(
  { initialContent, editable = true, uploadFile, onChange, className },
  ref
) {
  const isDark = useIsDark()

  const editor = useCreateBlockNote({
    schema: hrBlockNoteSchema,
    initialContent:
      initialContent && initialContent.length > 0 ? (initialContent as PartialBlock[]) : undefined,
    uploadFile,
  })

  useImperativeHandle(
    ref,
    () => ({
      getDocument: () => editor.document as HrDoc,
      getHTML: async () => editor.blocksToHTMLLossy(editor.document),
      getMarkdown: async () => editor.blocksToMarkdownLossy(editor.document),
      setMarkdown: async (markdown: string) => {
        const blocks = await editor.tryParseMarkdownToBlocks(markdown)
        editor.replaceBlocks(editor.document, blocks)
        onChange?.()
      },
    }),
    [editor, onChange]
  )

  return (
    <BlockNoteView
      editor={editor}
      editable={editable}
      theme={isDark ? 'dark' : 'light'}
      slashMenu={false}
      onChange={onChange}
      className={className}
    >
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) =>
          filterSuggestionItems(
            [
              ...getDefaultReactSlashMenuItems(editor),
              {
                title: 'YouTube',
                subtext: 'Embed a YouTube video',
                aliases: ['video', 'embed', 'youtube'],
                group: 'Media',
                icon: <Youtube size={18} />,
                onItemClick: () => {
                  const pos = editor.getTextCursorPosition().block
                  editor.insertBlocks([{ type: 'youtube' }], pos, 'after')
                },
              },
            ],
            query
          )
        }
      />
    </BlockNoteView>
  )
})
