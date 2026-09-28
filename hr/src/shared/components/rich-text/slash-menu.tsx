import type { Editor, Range } from '@tiptap/core'
import type { LucideIcon } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

export interface SlashItem {
  title: string
  description?: string
  icon: LucideIcon
  /** Section header this item renders under (e.g. "Basic", "Media"). */
  group?: string
  /** Extra words to match the typed query against. */
  keywords?: string[]
  command: (opts: { editor: Editor; range: Range }) => void
}

export interface SlashMenuHandle {
  onKeyDown: (opts: { event: KeyboardEvent }) => boolean
}

interface SlashMenuProps {
  items: SlashItem[]
  command: (item: SlashItem) => void
}

export const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(({ items, command }, ref) => {
  const [selected, setSelected] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // Reset the highlight whenever the filtered list changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: items is unread, only tracked so this resets when the filtered list changes
  useEffect(() => setSelected(0), [items])

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const pick = (index: number) => {
    const item = items[index]
    if (item) command(item)
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false
      if (event.key === 'ArrowUp') {
        setSelected((s) => (s + items.length - 1) % items.length)
        return true
      }
      if (event.key === 'ArrowDown') {
        setSelected((s) => (s + 1) % items.length)
        return true
      }
      if (event.key === 'Enter') {
        pick(selected)
        return true
      }
      return false
    },
  }))

  if (items.length === 0) {
    return (
      <div className="w-64 rounded-md border bg-popover p-2 text-sm text-muted-foreground shadow-md">
        No matches
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      className="max-h-80 w-72 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg"
    >
      {items.map((item, index) => {
        const Icon = item.icon
        // Render a section header the first time a group appears. Selection
        // stays on the flat index so keyboard nav ignores the grouping.
        const showHeader = item.group && item.group !== items[index - 1]?.group
        return (
          <div key={item.title}>
            {showHeader && (
              <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {item.group}
              </p>
            )}
            <button
              type="button"
              data-index={index}
              // Mousedown would blur the editor before the click runs the command.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(index)}
              onMouseEnter={() => setSelected(index)}
              className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm ${
                index === selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
              }`}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border bg-background">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium leading-tight">{item.title}</span>
                {item.description && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.description}
                  </span>
                )}
              </span>
              {index === selected && (
                <kbd className="shrink-0 rounded border bg-muted px-1 text-[10px] text-muted-foreground">
                  ↵
                </kbd>
              )}
            </button>
          </div>
        )
      })}
    </div>
  )
})

SlashMenu.displayName = 'SlashMenu'
