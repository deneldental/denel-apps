import { Extension } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion'
import { type SlashItem, SlashMenu, type SlashMenuHandle } from './slash-menu'

// A "/" slash-command menu built on @tiptap/suggestion. The host supplies the
// items via `getItems(query)`. Selecting an item runs its `command`, which is
// responsible for clearing the typed "/query" range (via editor.deleteRange).

export interface SlashCommandOptions {
  getItems: (query: string) => SlashItem[]
}

/**
 * Position the popup relative to its mount container (see `resolveMount`).
 * Absolute-in-container rather than fixed-on-body: the editor can sit inside a
 * Radix Sheet whose animation transforms create a containing block, which would
 * break `position: fixed`, and whose body-level pointer-events:none would make a
 * body-portalled popup unclickable.
 */
function positionPopup(
  popup: HTMLElement | null,
  container: HTMLElement | null,
  rect: DOMRect | null | undefined
) {
  if (!popup || !container || !rect) return
  const cRect = container.getBoundingClientRect()
  const menuHeight = popup.firstElementChild?.getBoundingClientRect().height ?? 300
  // Flip above the caret when there isn't room below it in the viewport.
  const below = rect.bottom + menuHeight < window.innerHeight
  popup.style.left = `${rect.left - cRect.left}px`
  popup.style.top = below
    ? `${rect.bottom - cRect.top + 4}px`
    : `${rect.top - cRect.top - menuHeight - 4}px`
}

/** Nearest RichTextEditor container; falls back to body for standalone use. */
function resolveMount(editorDom: Element): HTMLElement {
  return (editorDom.closest('[data-rte-editor]') as HTMLElement | null) ?? document.body
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: 'slashCommand',

  addOptions() {
    return { getItems: () => [] }
  },

  addProseMirrorPlugins() {
    const getItems = () => this.options.getItems

    const suggestion: Omit<SuggestionOptions<SlashItem>, 'editor'> = {
      char: '/',
      startOfLine: false,
      allowSpaces: false,
      // Selecting an item delegates entirely to the item's own command, which
      // clears the "/query" range itself.
      command: ({ editor, range, props }) => props.command({ editor, range }),
      items: ({ query }) => getItems()(query),
      render: () => {
        let component: ReactRenderer<SlashMenuHandle> | null = null
        let popup: HTMLElement | null = null
        let mount: HTMLElement | null = null

        return {
          onStart: (props) => {
            component = new ReactRenderer(SlashMenu, {
              props: { items: props.items, command: props.command },
              editor: props.editor,
            })
            mount = resolveMount(props.editor.view.dom)
            popup = document.createElement('div')
            popup.style.position = 'absolute'
            popup.style.zIndex = '60'
            // Re-enable interaction: an open Radix Sheet sets pointer-events:none
            // on everything outside its content.
            popup.style.pointerEvents = 'auto'
            mount.appendChild(popup)
            popup.appendChild(component.element)
            positionPopup(popup, mount, props.clientRect?.())
          },
          onUpdate: (props) => {
            component?.updateProps({ items: props.items, command: props.command })
            positionPopup(popup, mount, props.clientRect?.())
          },
          onKeyDown: (props) => {
            if (props.event.key === 'Escape') {
              popup?.remove()
              popup = null
              return true
            }
            return component?.ref?.onKeyDown({ event: props.event }) ?? false
          },
          onExit: () => {
            popup?.remove()
            popup = null
            mount = null
            component?.destroy()
            component = null
          },
        }
      },
    }

    return [Suggestion({ editor: this.editor, ...suggestion })]
  },
})
