import { ArrowLeft, Book, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { staffApi } from '@/lib/api'

interface InlineText {
  type: 'text'
  text: string
  styles?: {
    bold?: boolean
    italic?: boolean
    underline?: boolean
    strikethrough?: boolean
    textColor?: string
  }
}

interface Block {
  id: string
  type: string
  props?: {
    level?: number
    textColor?: string
    alignment?: 'left' | 'center' | 'right' | 'justify'
    checked?: boolean
    url?: string
    caption?: string
    name?: string
  }
  content?: InlineText[] | string
  children?: Block[]
}

interface HandbookData {
  content: Block[] | null
  updatedAt: string | null
  updatedBy: string | null
}

export default function HrHandbookPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<HandbookData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    staffApi
      .getHandbook()
      .then((res) => {
        if (res.success && res.data) {
          setData(res.data as HandbookData)
        } else {
          setError(res.error || 'Failed to load handbook')
        }
      })
      .catch(() => setError('Failed to retrieve handbook. Please try again.'))
      .finally(() => setLoading(false))
  }, [])

  function renderInlineContent(content: unknown) {
    if (!content) return null
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return (content as any[]).map((item, idx) => {
        if (item.type === 'text') {
          let node: React.ReactNode = item.text
          // biome-ignore lint/suspicious/noArrayIndexKey: BlockNote inline elements have no stable unique IDs
          const keyPrefix = `text-${idx}`
          if (item.styles?.bold) node = <strong key={`b-${keyPrefix}`}>{node}</strong>
          if (item.styles?.italic) node = <em key={`i-${keyPrefix}`}>{node}</em>
          if (item.styles?.underline) node = <u key={`u-${keyPrefix}`}>{node}</u>
          if (item.styles?.strikethrough) {
            node = (
              <span key={`s-${keyPrefix}`} className="line-through">
                {node}
              </span>
            )
          }
          if (item.styles?.code) {
            node = (
              <code
                key={`code-${keyPrefix}`}
                className="bg-stone-100 text-primary px-1 py-0.5 rounded text-[0.9em] font-mono"
              >
                {node}
              </code>
            )
          }
          if (item.styles?.textColor && item.styles.textColor !== 'default') {
            node = (
              <span key={`c-${keyPrefix}`} style={{ color: item.styles.textColor }}>
                {node}
              </span>
            )
          }
          // biome-ignore lint/suspicious/noArrayIndexKey: BlockNote inline elements have no stable unique IDs
          return <span key={idx}>{node}</span>
        }
        if (item.type === 'link') {
          return (
            <a
              key={idx}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline"
            >
              {renderInlineContent(item.content)}
            </a>
          )
        }
        return null
      })
    }
    return null
  }

  function getYouTubeId(url: string) {
    const m = url.match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
    )
    return m?.[1] ?? null
  }

  function RenderBlock({ block }: { block: Block }) {
    const alignmentClass = block.props?.alignment ? `text-${block.props.alignment}` : ''

    const renderChildren = () => {
      if (!block.children || block.children.length === 0) return null
      return (
        <div className="mt-2 pl-4">
          {block.children.map((child) => (
            <RenderBlock key={child.id} block={child} />
          ))}
        </div>
      )
    }

    switch (block.type) {
      case 'heading': {
        const level = block.props?.level ?? 1
        if (level === 1) {
          return (
            <div className="mb-3 mt-6">
              <h1 className={`text-2xl font-bold tracking-tight text-primary ${alignmentClass}`}>
                {renderInlineContent(block.content)}
              </h1>
              {renderChildren()}
            </div>
          )
        }
        if (level === 2) {
          return (
            <div className="mb-2.5 mt-5">
              <h2 className={`text-xl font-bold text-primary ${alignmentClass}`}>
                {renderInlineContent(block.content)}
              </h2>
              {renderChildren()}
            </div>
          )
        }
        return (
          <div className="mb-2 mt-4">
            <h3 className={`text-lg font-semibold text-primary ${alignmentClass}`}>
              {renderInlineContent(block.content)}
            </h3>
            {renderChildren()}
          </div>
        )
      }

      case 'bulletListItem':
        return (
          <div className="mb-2.5">
            <div className="flex items-start gap-2.5 pl-4 text-sm text-stone-700 leading-relaxed">
              <span className="text-primary font-bold select-none">•</span>
              <span className="flex-1">{renderInlineContent(block.content)}</span>
            </div>
            {renderChildren()}
          </div>
        )

      case 'numberedListItem':
        return (
          <div className="mb-2.5">
            <div className="flex items-start gap-2.5 pl-4 text-sm text-stone-700 leading-relaxed">
              <span className="text-primary font-bold select-none">1.</span>
              <span className="flex-1">{renderInlineContent(block.content)}</span>
            </div>
            {renderChildren()}
          </div>
        )

      case 'checkListItem':
        return (
          <div className="mb-2.5">
            <div className="flex items-start gap-2.5 pl-4 text-sm text-stone-700 leading-relaxed">
              <input
                type="checkbox"
                checked={!!block.props?.checked}
                readOnly
                className="mt-1 h-3.5 w-3.5 rounded-sm border-stone-300 text-primary focus:ring-primary/20"
              />
              <span
                className={`flex-1 ${block.props?.checked ? 'line-through text-stone-400' : ''}`}
              >
                {renderInlineContent(block.content)}
              </span>
            </div>
            {renderChildren()}
          </div>
        )

      case 'toggleListItem':
      case 'toggle':
        return (
          <details className="group border border-stone-200 rounded-xl mb-3 mt-3 overflow-hidden">
            <summary className="cursor-pointer font-semibold bg-stone-50 hover:bg-stone-100 p-3 flex items-center select-none text-primary text-sm">
              <span className="flex-1">{renderInlineContent(block.content)}</span>
            </summary>
            <div className="p-4 bg-white border-t border-stone-100">
              {block.children?.map((child) => (
                <RenderBlock key={child.id} block={child} />
              ))}
            </div>
          </details>
        )

      case 'quote':
        return (
          <div className="mb-3.5 mt-4">
            <blockquote
              className={`border-l-4 border-primary/40 bg-stone-50 pl-4 py-2 rounded-r-lg italic text-stone-700 text-sm ${alignmentClass}`}
            >
              {renderInlineContent(block.content)}
            </blockquote>
            {renderChildren()}
          </div>
        )

      case 'codeBlock':
        return (
          <div className="mb-3.5 mt-4 relative">
            <pre
              className={`bg-stone-800 text-stone-50 p-4 rounded-xl overflow-x-auto text-sm font-mono ${alignmentClass}`}
            >
              <code>{renderInlineContent(block.content)}</code>
            </pre>
            {renderChildren()}
          </div>
        )

      case 'table': {
        const tableContent = block.content as any
        if (tableContent?.type === 'tableContent' && Array.isArray(tableContent.rows)) {
          return (
            <div className="mb-4 mt-4 overflow-x-auto rounded-xl border border-stone-200">
              <table className={`w-full text-sm text-left text-stone-700 ${alignmentClass}`}>
                <tbody>
                  {tableContent.rows.map((row: any, rIdx: number) => (
                    <tr
                      key={rIdx}
                      className="border-b border-stone-100 last:border-0 hover:bg-stone-50 transition-colors"
                    >
                      {row.cells?.map((cell: any, cIdx: number) => (
                        <td
                          key={cIdx}
                          className="px-4 py-3 border-r border-stone-100 last:border-0 align-top"
                        >
                          {renderInlineContent(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {renderChildren()}
            </div>
          )
        }
        return null
      }

      case 'divider':
        return <hr className="my-5 border-stone-200" />

      case 'image': {
        const url = block.props?.url ?? (typeof block.content === 'string' ? block.content : '')
        return url ? (
          <figure className="my-4">
            <img
              src={url}
              alt={block.props?.caption || block.props?.name || 'Handbook visual'}
              className="rounded-xl border border-stone-150 max-w-full h-auto mx-auto shadow-xs"
            />
            {block.props?.caption && (
              <figcaption className="mt-1.5 text-center text-xs text-stone-400">
                {block.props.caption}
              </figcaption>
            )}
            {renderChildren()}
          </figure>
        ) : null
      }

      case 'video': {
        const url = block.props?.url ?? (typeof block.content === 'string' ? block.content : '')
        return url ? (
          <div className="my-4">
            {/* biome-ignore lint/a11y/useMediaCaption: HR policy video uploads do not require a separate track */}
            <video src={url} className="rounded-xl max-w-full h-auto mx-auto shadow-xs" controls />
            {renderChildren()}
          </div>
        ) : null
      }

      case 'audio': {
        const url = block.props?.url ?? (typeof block.content === 'string' ? block.content : '')
        return url ? (
          <div className="my-4">
            {/* biome-ignore lint/a11y/useMediaCaption: HR policy audio uploads do not require a separate track */}
            <audio src={url} controls className="w-full" />
            {renderChildren()}
          </div>
        ) : null
      }

      case 'file': {
        const url = block.props?.url ?? (typeof block.content === 'string' ? block.content : '')
        return url ? (
          <div className="my-3">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-stone-150 bg-stone-50 px-3 py-2 text-sm text-primary hover:bg-stone-100"
            >
              <Book size={16} />
              {block.props?.name || 'Download file'}
            </a>
            {renderChildren()}
          </div>
        ) : null
      }

      case 'youtube': {
        const url = block.props?.url ?? (typeof block.content === 'string' ? block.content : '')
        const ytid = getYouTubeId(url)
        return ytid ? (
          <div className="my-4">
            <div className="aspect-video w-full rounded-xl overflow-hidden shadow-xs border border-stone-150">
              <iframe
                src={`https://www.youtube.com/embed/${ytid}`}
                title="YouTube video player"
                className="w-full h-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
            {renderChildren()}
          </div>
        ) : null
      }

      case 'paragraph':
      default:
        return (
          <div className="mb-3.5">
            <p className={`text-sm text-stone-700 leading-relaxed ${alignmentClass}`}>
              {renderInlineContent(block.content) || <span className="invisible">_</span>}
            </p>
            {renderChildren()}
          </div>
        )
    }
  }

  return (
    <div className="page-enter p-5 pb-8 space-y-5">
      {/* Top Header */}
      <div className="pt-2 flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate('/profile')}
          className="hover:bg-stone-100 rounded-xl"
          aria-label="Back to Profile"
        >
          <ArrowLeft size={20} className="text-primary" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">HR Handbook</h1>
          <p className="text-sm text-muted-foreground">Company Policies & Guidelines</p>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-xs text-muted-foreground">Loading handbook...</p>
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-4">
          {/* Metadata Card */}
          {data?.updatedAt && (
            <div className="text-[11px] text-stone-400 bg-stone-50 border border-stone-100 rounded-xl px-3 py-2 flex justify-between">
              <span>Last updated: {new Date(data.updatedAt).toLocaleDateString()}</span>
              {data.updatedBy && <span>Updated by: {data.updatedBy}</span>}
            </div>
          )}

          {/* Handbook Content */}
          {data?.content && data.content.length > 0 ? (
            <Card className="border-stone-150 rounded-2xl shadow-xs overflow-hidden">
              <CardContent className="p-6 md:p-8 space-y-1">
                {data.content.map((block) => (
                  <RenderBlock key={block.id} block={block} />
                ))}
              </CardContent>
            </Card>
          ) : (
            <Card className="border-stone-150 rounded-2xl shadow-xs text-center py-16 px-6">
              <CardContent className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-stone-50 flex items-center justify-center">
                  <Book size={24} className="text-primary/60" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-md font-bold text-stone-800">No policies published yet</h3>
                  <p className="text-sm text-stone-500 max-w-xs mx-auto">
                    The HR handbook will appear here once published by HR.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
