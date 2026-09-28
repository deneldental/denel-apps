import { mergeAttributes, Node } from '@tiptap/core'

// Two atom block nodes so the TipTap editor can hold the same media the legacy
// contentEditable editors produced — a `<video controls>` (uploaded training
// clips) and a `<iframe>` (YouTube embeds in memos). Keeping the emitted HTML
// identical to before means the backend sanitizer allow-list and every reader
// (Team memo/training viewers) keep working unchanged — no data migration.

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    embedVideo: {
      /** Insert an uploaded `<video controls src>` block. */
      setVideo: (options: { src: string }) => ReturnType
    }
    embedIframe: {
      /** Insert a `<iframe>` embed block (YouTube). */
      setIframe: (options: { src: string; title?: string }) => ReturnType
    }
  }
}

export const Video = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: null },
      // Always render the boolean `controls` attribute back out.
      controls: {
        default: true,
        renderHTML: () => ({ controls: 'controls' }),
        parseHTML: () => true,
      },
    }
  },

  parseHTML() {
    return [{ tag: 'video' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['video', mergeAttributes(HTMLAttributes, { controls: 'controls' })]
  },

  addCommands() {
    return {
      setVideo:
        (options) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { src: options.src } }),
    }
  },
})

export const Iframe = Node.create({
  name: 'iframe',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: null },
      title: { default: null },
      width: { default: '560' },
      height: { default: '315' },
      frameborder: { default: '0' },
      allow: {
        default:
          'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
      },
      allowfullscreen: {
        default: true,
        renderHTML: () => ({ allowfullscreen: 'allowfullscreen' }),
        parseHTML: () => true,
      },
    }
  },

  parseHTML() {
    return [{ tag: 'iframe' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['iframe', mergeAttributes(HTMLAttributes)]
  },

  addCommands() {
    return {
      setIframe:
        (options) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { src: options.src, title: options.title ?? '' },
          }),
    }
  },
})
