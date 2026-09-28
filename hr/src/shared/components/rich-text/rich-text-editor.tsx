import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@denel/ui'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import {
  Bold,
  Check,
  Heading,
  Heading1,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Minus,
  Pilcrow,
  Quote,
  Underline as UnderlineIcon,
  Upload,
  Video as VideoIcon,
  X,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { SlashCommand } from './slash-command'
import type { SlashItem } from './slash-menu'
import { Iframe, Video } from './tiptap-nodes'

// Shared TipTap rich-text editor. Emits the same HTML tags the legacy
// contentEditable editors did (p, b/strong, i/em, u, ul/ol/li, h*, a, img,
// video, iframe), so the backend sanitizer + all readers keep working.
//
// Media is opt-in per host via callbacks:
//   uploadImage  → shows the Image button + built-in upload/from-link dialog
//   uploadVideo  → shows the Video button (direct file pick → <video controls>)
//   youTubeMeta  → shows the YouTube button + built-in load/preview dialog

export interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  uploadImage?: (file: File) => Promise<string | null>
  uploadVideo?: (file: File) => Promise<string | null>
  youTubeMeta?: (url: string) => Promise<{ embedUrl: string; title: string } | null>
  /** Enable the "/" slash-command menu (Title, Section, lists, media…). */
  enableSlash?: boolean
  /**
   * Show the persistent formatting toolbar. Turn OFF for a clean, Notion-like
   * surface where blocks come from "/" and inline formatting comes from the
   * selection bubble menu. Defaults to on (the training editor relies on it).
   */
  showToolbar?: boolean
  className?: string
}

const CONTENT_CLASS =
  'min-h-[160px] rounded-md border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring ' +
  '[&_.ProseMirror]:min-h-[136px] [&_.ProseMirror]:outline-none ' +
  '[&_img]:w-full [&_img]:max-h-[420px] [&_img]:object-cover [&_img]:rounded-md [&_img]:my-2 ' +
  '[&_video]:w-full [&_video]:max-h-[420px] [&_video]:object-contain [&_video]:rounded-md [&_video]:my-2 ' +
  '[&_iframe]:w-full [&_iframe]:aspect-video [&_iframe]:rounded-md [&_iframe]:my-2 ' +
  '[&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_h*]:mt-2 ' +
  '[&_p]:mb-2 [&_ul]:list-disc [&_ul]:ml-5 [&_ol]:list-decimal [&_ol]:ml-5 ' +
  '[&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground ' +
  // Placeholder (from @tiptap/extension-placeholder) on the empty first line.
  '[&_.ProseMirror_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)] ' +
  '[&_.ProseMirror_p.is-editor-empty:first-child]:before:text-muted-foreground ' +
  '[&_.ProseMirror_p.is-editor-empty:first-child]:before:float-left ' +
  '[&_.ProseMirror_p.is-editor-empty:first-child]:before:h-0 ' +
  '[&_.ProseMirror_p.is-editor-empty:first-child]:before:pointer-events-none'

function ToolBtn({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      className={cn('h-8 w-8 p-0', active && 'bg-accent text-accent-foreground')}
      // Keep the editor selection — mousedown would otherwise blur it.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  uploadImage,
  uploadVideo,
  youTubeMeta,
  enableSlash,
  showToolbar = true,
  className,
}: RichTextEditorProps) {
  // Hold callbacks in refs so the editor is created once but always calls the
  // latest handlers (avoids recreating the editor / losing the cursor).
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // Slash items are rebuilt each render (they close over dialog openers), but
  // the editor is created once — so it reads them through a ref.
  const slashItemsRef = useRef<(query: string) => SlashItem[]>(() => [])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow' },
        },
      }),
      Image,
      Video,
      Iframe,
      Placeholder.configure({ placeholder: placeholder ?? 'Write here…' }),
      ...(enableSlash
        ? [SlashCommand.configure({ getItems: (query) => slashItemsRef.current(query) })]
        : []),
    ],
    content: value || '<p></p>',
    editorProps: { attributes: { class: 'ProseMirror' } },
    onUpdate: ({ editor }) => onChangeRef.current(editor.getHTML()),
  })

  // ── Link (inline composer) ──────────────────────────────────────────────
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const linkInputRef = useRef<HTMLInputElement | null>(null)

  const openLink = () => {
    if (!editor) return
    setLinkUrl(editor.getAttributes('link').href ?? '')
    setLinkOpen(true)
    setTimeout(() => linkInputRef.current?.focus(), 0)
  }
  const submitLink = () => {
    if (!editor) return
    const raw = linkUrl.trim()
    if (!raw) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      setLinkOpen(false)
      return
    }
    const href = /^(https?:|mailto:|tel:)/i.test(raw) ? raw : `https://${raw}`
    if (editor.state.selection.empty) {
      editor.chain().focus().insertContent(`<a href="${href}">${href}</a>`).run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    }
    setLinkOpen(false)
    setLinkUrl('')
  }

  // ── Image dialog ────────────────────────────────────────────────────────
  const [imageOpen, setImageOpen] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const [imageUploading, setImageUploading] = useState(false)

  const pickImageFile = async (file: File | undefined) => {
    if (!file || !uploadImage) return
    setImageUploading(true)
    const url = await uploadImage(file)
    setImageUploading(false)
    if (url) setImageUrl(url)
  }
  const confirmImage = () => {
    const url = imageUrl.trim()
    if (!url || !editor) return
    editor.chain().focus().setImage({ src: url }).run()
    setImageOpen(false)
    setImageUrl('')
  }

  // ── Video (direct file pick) ────────────────────────────────────────────
  const videoInputRef = useRef<HTMLInputElement | null>(null)
  const [videoUploading, setVideoUploading] = useState(false)
  const pickVideoFile = async (file: File | undefined) => {
    if (!file || !uploadVideo || !editor) return
    setVideoUploading(true)
    const url = await uploadVideo(file)
    setVideoUploading(false)
    if (url) editor.chain().focus().setVideo({ src: url }).run()
    else toast.error('Video upload failed')
  }

  // ── YouTube dialog ──────────────────────────────────────────────────────
  const [ytOpen, setYtOpen] = useState(false)
  const [ytUrl, setYtUrl] = useState('')
  const [ytLoading, setYtLoading] = useState(false)
  const [ytMeta, setYtMeta] = useState<{ embedUrl: string; title: string } | null>(null)
  const loadYt = async () => {
    if (!youTubeMeta || !ytUrl.trim()) return
    setYtLoading(true)
    setYtMeta(null)
    const meta = await youTubeMeta(ytUrl.trim())
    setYtLoading(false)
    if (meta) setYtMeta(meta)
    else toast.error('Could not read that YouTube link')
  }
  const confirmYt = () => {
    if (!ytMeta || !editor) return
    editor.chain().focus().setIframe({ src: ytMeta.embedUrl, title: ytMeta.title }).run()
    setYtOpen(false)
    setYtUrl('')
    setYtMeta(null)
  }

  // ── Slash-command items ─────────────────────────────────────────────────
  // Rebuilt each render (close over the dialog openers); the editor reads them
  // via slashItemsRef. Each command clears the typed "/query" range first.
  if (enableSlash) {
    slashItemsRef.current = (query: string) => {
      const basic: SlashItem[] = [
        {
          title: 'Title',
          description: 'Large memo heading (required)',
          icon: Heading1,
          keywords: ['h1', 'heading', 'name'],
          command: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run(),
        },
        {
          title: 'Section',
          description: 'Section subheading',
          icon: Heading3,
          keywords: ['h3', 'subheading'],
          command: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run(),
        },
        {
          title: 'Text',
          description: 'Plain paragraph',
          icon: Pilcrow,
          keywords: ['paragraph', 'body'],
          command: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).setParagraph().run(),
        },
        {
          title: 'Bullet list',
          icon: List,
          keywords: ['ul', 'unordered'],
          command: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).toggleBulletList().run(),
        },
        {
          title: 'Numbered list',
          icon: ListOrdered,
          keywords: ['ol', 'ordered'],
          command: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
        },
        {
          title: 'Quote',
          icon: Quote,
          keywords: ['blockquote'],
          command: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
        },
        {
          title: 'Divider',
          description: 'Horizontal line',
          icon: Minus,
          keywords: ['hr', 'rule', 'line'],
          command: ({ editor, range }) =>
            editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
        },
      ]
      const media: SlashItem[] = []
      if (uploadImage) {
        media.push({
          title: 'Image',
          description: 'Upload or link an image',
          icon: ImagePlus,
          keywords: ['photo', 'picture'],
          command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).run()
            setImageOpen(true)
          },
        })
      }
      if (uploadVideo) {
        media.push({
          title: 'Video',
          description: 'Upload a video clip',
          icon: VideoIcon,
          keywords: ['clip', 'mp4'],
          command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).run()
            videoInputRef.current?.click()
          },
        })
      }
      if (youTubeMeta) {
        media.push({
          title: 'YouTube',
          description: 'Embed a YouTube video',
          icon: VideoIcon,
          keywords: ['youtube', 'video', 'embed'],
          command: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).run()
            setYtOpen(true)
          },
        })
      }
      const items: SlashItem[] = [
        ...basic.map((i) => ({ ...i, group: 'Basic' })),
        ...media.map((i) => ({ ...i, group: 'Media' })),
      ]
      const q = query.trim().toLowerCase()
      if (!q) return items
      return items.filter(
        (i) => i.title.toLowerCase().includes(q) || (i.keywords ?? []).some((k) => k.includes(q))
      )
    }
  }

  if (!editor) return null

  return (
    <div className={cn('space-y-2', className)}>
      {/* Floating format bar — appears over a text selection. This is the only
          inline-formatting affordance when the persistent toolbar is hidden.
          It renders in-tree (not portalled to body), so it stays clickable
          inside a Radix Sheet. */}
      <BubbleMenu
        editor={editor}
        options={{ placement: 'top', offset: 8 }}
        className="flex items-center gap-0.5 rounded-md border bg-popover p-0.5 shadow-md"
      >
        <ToolBtn
          label="Bold"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn
          label="Italic"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn
          label="Underline"
          active={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <UnderlineIcon className="h-4 w-4" />
        </ToolBtn>
        <ToolBtn label="Link" active={editor.isActive('link')} onClick={openLink}>
          <Link2 className="h-4 w-4" />
        </ToolBtn>
      </BubbleMenu>

      {showToolbar && (
        <div className="flex flex-wrap items-center gap-1 rounded-md border bg-muted/20 px-1 py-1">
          <ToolBtn
            label="Bold"
            active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn
            label="Italic"
            active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn
            label="Underline"
            active={editor.isActive('underline')}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            <UnderlineIcon className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn
            label="Heading"
            active={editor.isActive('heading', { level: 3 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          >
            <Heading className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn
            label="Bullet list"
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn
            label="Numbered list"
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="h-4 w-4" />
          </ToolBtn>
          <ToolBtn label="Link" active={editor.isActive('link') || linkOpen} onClick={openLink}>
            <Link2 className="h-4 w-4" />
          </ToolBtn>
          {uploadImage && (
            <ToolBtn label="Insert image" onClick={() => setImageOpen(true)}>
              <ImagePlus className="h-4 w-4" />
            </ToolBtn>
          )}
          {uploadVideo && (
            <ToolBtn
              label="Insert video"
              disabled={videoUploading}
              onClick={() => videoInputRef.current?.click()}
            >
              {videoUploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <VideoIcon className="h-4 w-4" />
              )}
            </ToolBtn>
          )}
          {youTubeMeta && (
            <ToolBtn label="Insert YouTube video" onClick={() => setYtOpen(true)}>
              <VideoIcon className="h-4 w-4" />
            </ToolBtn>
          )}
          <Badge variant="outline" className="ml-auto">
            Rich Text
          </Badge>
        </div>
      )}

      {/* Inline link composer */}
      {linkOpen && (
        <div className="flex items-center gap-1 rounded-md border bg-card p-1">
          <Input
            ref={linkInputRef}
            type="url"
            inputMode="url"
            placeholder="https://…"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submitLink()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                setLinkOpen(false)
              }
            }}
            className="h-8 flex-1 text-sm"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onMouseDown={(e) => e.preventDefault()}
            onClick={submitLink}
            aria-label="Apply link"
            className="h-8 w-8 p-0"
          >
            <Check className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setLinkOpen(false)}
            aria-label="Cancel"
            className="h-8 w-8 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* `relative` + the data attr make this the mount/positioning root for the
          slash popup. It must live INSIDE this subtree: the memo editor sits in a
          Radix Sheet, which sets pointer-events:none on <body> while open, so a
          popup portalled to document.body would render but never receive clicks. */}
      <div className={`${CONTENT_CLASS} relative`} data-rte-editor>
        <EditorContent editor={editor} />
      </div>

      {uploadVideo && (
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) =>
            void pickVideoFile(e.target.files?.[0]).finally(() => {
              if (videoInputRef.current) videoInputRef.current.value = ''
            })
          }
        />
      )}

      {/* Image dialog */}
      <Dialog open={imageOpen} onOpenChange={setImageOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Insert image</DialogTitle>
            <DialogDescription>Upload from this device or paste an image link.</DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="upload">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="upload">Upload</TabsTrigger>
              <TabsTrigger value="link">From link</TabsTrigger>
            </TabsList>
            <TabsContent value="upload" className="pt-3">
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground hover:bg-muted/40">
                {imageUploading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Upload className="h-5 w-5" />
                )}
                <span>{imageUploading ? 'Uploading…' : 'Choose an image file'}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={imageUploading}
                  onChange={(e) => void pickImageFile(e.target.files?.[0])}
                />
              </label>
            </TabsContent>
            <TabsContent value="link" className="pt-3">
              <div className="space-y-1.5">
                <Label htmlFor="rte-image-url">Image URL</Label>
                <Input
                  id="rte-image-url"
                  placeholder="https://…"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                />
              </div>
            </TabsContent>
          </Tabs>
          {imageUrl && (
            <div className="rounded-md border bg-muted/20 p-2">
              <p className="mb-1 text-xs text-muted-foreground">Preview</p>
              <img
                src={imageUrl}
                alt="Preview"
                className="max-h-48 w-full rounded object-contain"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setImageOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmImage} disabled={!imageUrl || imageUploading}>
              Insert image
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* YouTube dialog */}
      <Dialog open={ytOpen} onOpenChange={setYtOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Insert YouTube video</DialogTitle>
            <DialogDescription>
              Paste a YouTube link and load it to preview the title.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="rte-yt-url">YouTube URL</Label>
              <Input
                id="rte-yt-url"
                placeholder="https://www.youtube.com/watch?v=…"
                value={ytUrl}
                onChange={(e) => setYtUrl(e.target.value)}
              />
            </div>
            <Button variant="outline" onClick={loadYt} disabled={!ytUrl || ytLoading}>
              {ytLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Load'}
            </Button>
          </div>
          {ytMeta && (
            <div className="rounded-md border bg-muted/20 p-2 text-sm">
              <p className="font-medium leading-snug">{ytMeta.title}</p>
              <p className="truncate text-xs text-muted-foreground">{ytMeta.embedUrl}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setYtOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmYt} disabled={!ytMeta}>
              Insert video
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
