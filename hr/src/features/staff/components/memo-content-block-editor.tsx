import { Button, Card, CardContent, Input } from '@denel/ui'
import { ArrowDown, ArrowUp, Minus, Plus, Trash2 } from 'lucide-react'
import type { ContentBlock } from '@/features/staff/components/content-block-editor'
import { getVideoMeta } from '@/lib/actions/memos'
import { uploadFile } from '@/lib/actions/upload'
import { RichTextEditor } from '@/shared/components/rich-text/rich-text-editor'

interface MemoContentBlockEditorProps {
  blocks: ContentBlock[]
  onChange: (blocks: ContentBlock[]) => void
}

async function uploadMemoImage(file: File): Promise<string | null> {
  const res = await uploadFile(file, { storageCategory: 'misc', folder: 'memos', profile: 'image' })
  return res.success && res.url ? res.url : null
}

async function memoYouTube(url: string): Promise<{ embedUrl: string; title: string } | null> {
  const res = await getVideoMeta(url)
  return res.success && res.data ? { embedUrl: res.data.embedUrl, title: res.data.title } : null
}

export function MemoContentBlockEditor({ blocks, onChange }: MemoContentBlockEditorProps) {
  const addSection = () => {
    onChange([
      ...blocks,
      { id: Date.now().toString(), type: 'section', title: 'New Section', content: '<p></p>' },
    ])
  }

  const addDivider = () => {
    onChange([...blocks, { id: Date.now().toString(), type: 'divider' }])
  }

  const updateSectionTitle = (id: string, value: string) => {
    onChange(
      blocks.map((block) =>
        block.id !== id || block.type !== 'section' ? block : { ...block, title: value }
      )
    )
  }

  const updateSectionContent = (id: string, value: string) => {
    onChange(
      blocks.map((block) =>
        block.id !== id || block.type !== 'section' ? block : { ...block, content: value }
      )
    )
  }

  const removeBlock = (id: string) => onChange(blocks.filter((block) => block.id !== id))

  const moveBlock = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= blocks.length) return
    const next = [...blocks]
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    onChange(next)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addSection} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Section
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={addDivider} className="gap-2">
          <Minus className="h-4 w-4" />
          Add Line
        </Button>
      </div>

      <div className="space-y-4">
        {blocks.length === 0 && (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No blocks yet. Add a section to start writing.
          </div>
        )}

        {blocks.map((block, index) => (
          <div key={block.id}>
            {block.type === 'divider' ? (
              <div className="flex items-center gap-2 rounded-md border border-dashed bg-background px-3 py-2">
                <Minus className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Horizontal line</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto"
                  onClick={() => removeBlock(block.id)}
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ) : (
              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-center gap-2">
                    <Input
                      value={block.title}
                      onChange={(event) => updateSectionTitle(block.id, event.target.value)}
                      placeholder="Section title"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => moveBlock(index, index - 1)}
                      disabled={index === 0}
                      aria-label="Move up"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => moveBlock(index, index + 1)}
                      disabled={index === blocks.length - 1}
                      aria-label="Move down"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeBlock(block.id)}
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>

                  <RichTextEditor
                    value={block.content || '<p></p>'}
                    onChange={(html) => updateSectionContent(block.id, html)}
                    placeholder="Write this section…"
                    uploadImage={uploadMemoImage}
                    youTubeMeta={memoYouTube}
                  />
                </CardContent>
              </Card>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
