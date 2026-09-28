import { Badge, Button, Card, CardContent, Input, Textarea } from '@denel/ui'
import { ArrowDown, ArrowUp, GripVertical, Minus, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

export type ContentBlock =
  | {
      id: string
      type: 'section'
      title: string
      content: string
    }
  | {
      id: string
      type: 'divider'
    }

interface ContentBlockEditorProps {
  blocks: ContentBlock[]
  onChange: (blocks: ContentBlock[]) => void
  blockLabel: string
}

export function ContentBlockEditor({ blocks, onChange, blockLabel }: ContentBlockEditorProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null)

  const addSection = () => {
    onChange([
      ...blocks,
      {
        id: Date.now().toString(),
        type: 'section',
        title: `${blockLabel} section`,
        content: '',
      },
    ])
  }

  const addDivider = () => {
    onChange([...blocks, { id: Date.now().toString(), type: 'divider' }])
  }

  const updateSection = (id: string, field: 'title' | 'content', value: string) => {
    onChange(
      blocks.map((block) => {
        if (block.id !== id || block.type !== 'section') {
          return block
        }

        return {
          ...block,
          [field]: value,
        }
      })
    )
  }

  const moveBlock = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= blocks.length) {
      return
    }

    const nextBlocks = [...blocks]
    const [movedBlock] = nextBlocks.splice(fromIndex, 1)
    nextBlocks.splice(toIndex, 0, movedBlock)
    onChange(nextBlocks)
  }

  const removeBlock = (id: string) => {
    onChange(blocks.filter((block) => block.id !== id))
  }

  const handleDrop = (targetIndex: number) => {
    if (!draggedId) {
      return
    }

    const sourceIndex = blocks.findIndex((block) => block.id === draggedId)
    if (sourceIndex === -1 || sourceIndex === targetIndex) {
      setDraggedId(null)
      return
    }

    moveBlock(sourceIndex, targetIndex)
    setDraggedId(null)
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
          Add Divider
        </Button>
      </div>

      <div className="rounded-lg border bg-muted/20 p-4 space-y-4">
        {blocks.length > 0 ? (
          blocks.map((block, index) => (
            <div key={block.id}>
              {index > 0 && <hr className="border-dashed border-muted-foreground/30 mb-4" />}
              {block.type === 'section' ? (
                <Card
                  className="border-dashed"
                  draggable
                  onDragStart={() => setDraggedId(block.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => handleDrop(index)}
                >
                  <CardContent className="p-4 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <GripVertical className="h-4 w-4 cursor-grab" />
                        <span>Drag to reorder</span>
                      </div>
                      <div className="flex items-center gap-2">
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
                    </div>

                    <div className="space-y-2">
                      <Input
                        value={block.title}
                        onChange={(event) => updateSection(block.id, 'title', event.target.value)}
                        placeholder={`${blockLabel} section title`}
                      />
                      <Textarea
                        value={block.content}
                        onChange={(event) => updateSection(block.id, 'content', event.target.value)}
                        rows={5}
                        placeholder="Write section content here..."
                      />
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div
                  className="rounded-lg border border-dashed bg-background px-4 py-3 flex items-center justify-between"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => handleDrop(index)}
                >
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Minus className="h-4 w-4" />
                    <span>Divider</span>
                    <Badge variant="outline">horizontal line</Badge>
                  </div>
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
              )}
            </div>
          ))
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
            No sections yet. Add a section to begin building the content.
          </div>
        )}
      </div>
    </div>
  )
}
