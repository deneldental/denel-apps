import { createReactBlockSpec } from '@blocknote/react'
import { Youtube } from 'lucide-react'
import { useState } from 'react'

/**
 * Custom BlockNote block: an embedded YouTube video.
 *
 * BlockNote has no native iframe/embed block, so we add one. It stores the
 * pasted URL in `props.url` and renders a responsive 16:9 iframe. On export
 * (`toExternalHTML`) it emits the same `<iframe>` markup the legacy TipTap
 * editor produced, so the stored read-side HTML — and its sanitiser allow-list
 * — is unchanged. `parse` recognises those iframes on HTML import, so existing
 * memo/training embeds survive being re-opened in BlockNote.
 */

/** Extract the 11-char video id from any common YouTube URL form. */
export function youTubeId(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  )
  return m?.[1] ?? null
}

function embedUrl(url: string): string | null {
  const id = youTubeId(url)
  return id ? `https://www.youtube.com/embed/${id}` : null
}

function Frame({ src, title }: { src: string; title?: string }) {
  return (
    <div
      className="relative my-1 w-full overflow-hidden rounded-md"
      style={{ paddingTop: '56.25%' }}
    >
      <iframe
        src={src}
        title={title || 'YouTube video'}
        className="absolute inset-0 h-full w-full"
        allow="accelerator; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
      />
    </div>
  )
}

export const YouTubeBlock = createReactBlockSpec(
  {
    type: 'youtube',
    propSchema: {
      url: { default: '' },
    },
    content: 'none',
  },
  {
    render: (props) => {
      const { block, editor } = props
      const url = block.props.url
      const src = url ? embedUrl(url) : null

      // Committed embed — show the player. Read-only viewers only ever hit this.
      if (src) return <Frame src={src} />

      if (!editor.isEditable) return null

      // Empty + editable → a paste box to set the URL.
      return <YouTubePrompt onSet={(u) => editor.updateBlock(block, { props: { url: u } })} />
    },
    toExternalHTML: (props) => {
      const src = props.block.props.url ? embedUrl(props.block.props.url) : null
      if (!src) return <div />
      return (
        <div className="youtube-embed">
          {/* biome-ignore lint/a11y/useIframeTitle: title set on read render */}
          <iframe
            src={src}
            width="560"
            height="315"
            allow="accelerator; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      )
    },
    parse: (element) => {
      // Recognise <iframe src="…youtube…"> on HTML import so existing embeds
      // become YouTube blocks instead of being dropped.
      const iframe = element.tagName === 'IFRAME' ? element : element.querySelector('iframe')
      const src = iframe?.getAttribute('src') ?? ''
      if (src && youTubeId(src)) return { url: src }
      return undefined
    },
  }
)

function YouTubePrompt({ onSet }: { onSet: (url: string) => void }) {
  const [value, setValue] = useState('')
  const valid = !!youTubeId(value)
  return (
    <div className="my-1 flex items-center gap-2 rounded-md border border-dashed bg-muted/40 p-3">
      <Youtube className="h-5 w-5 shrink-0 text-red-600" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && valid) onSet(value.trim())
        }}
        placeholder="Paste a YouTube URL and press Enter"
        className="flex-1 bg-transparent text-sm outline-none"
      />
      <button
        type="button"
        disabled={!valid}
        onClick={() => onSet(value.trim())}
        className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground disabled:opacity-40"
      >
        Embed
      </button>
    </div>
  )
}
