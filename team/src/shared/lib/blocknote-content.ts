/**
 * Formatting for rendered BlockNote content (stored as `blocksToHTMLLossy`
 * semantic HTML and injected via dangerouslySetInnerHTML). Shared by every
 * staff-facing reader — training modules, memos, etc. — so authored content
 * formats identically everywhere.
 *
 * Two problems this solves:
 *  1. Tailwind's Preflight resets headings, lists, blockquotes, etc. to plain
 *     text, and this app has no typography plugin — so authored structure was
 *     rendering unformatted. These arbitrary-variant classes restore the
 *     element styling to match how BlockNote renders it (headings, lists,
 *     quotes, code, bold/italic, links…).
 *  2. Authored media (YouTube/Vimeo iframes, images) and wide tables/code carry
 *     fixed pixel sizes and overflow the viewport on a phone — the media/table
 *     rules keep everything within the available width.
 *
 * Compose it with a call site's own base text color/size.
 */
export const BLOCKNOTE_CONTENT_CLASS = [
  'max-w-full break-words',
  // Headings — BlockNote supports three levels.
  '[&_h1]:mt-6 [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:leading-tight [&_h1]:text-foreground',
  '[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:leading-tight [&_h2]:text-foreground',
  '[&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:leading-snug [&_h3]:text-foreground',
  '[&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:text-base [&_h4]:font-semibold [&_h4]:text-foreground',
  // First heading shouldn't push a big top margin.
  '[&>:first-child]:mt-0',
  // Paragraphs + spacing.
  '[&_p]:my-2 [&_p]:leading-relaxed',
  // Lists — markers + indentation, including nesting.
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6',
  '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6',
  '[&_li]:my-1 [&_li>ul]:my-1 [&_li>ol]:my-1',
  // Inline marks.
  '[&_strong]:font-semibold [&_strong]:text-foreground [&_b]:font-semibold [&_b]:text-foreground',
  '[&_em]:italic [&_u]:underline [&_s]:line-through [&_del]:line-through',
  // Inline code + fenced code blocks.
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]',
  '[&_pre]:my-3 [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:overflow-x-auto [&_pre]:max-w-full',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-xs',
  // Blockquote.
  '[&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-brand/30 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-muted-foreground',
  // Links.
  '[&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2 [&_a]:break-words',
  // Divider.
  '[&_hr]:my-4 [&_hr]:border-border',
  // Media — scale to width, never overflow.
  '[&_img]:my-4 [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-xl',
  '[&_video]:my-4 [&_video]:max-w-full [&_video]:h-auto [&_video]:rounded-xl',
  // Video embeds (YouTube/Vimeo) → fluid 16:9 box, dropping fixed width/height.
  '[&_iframe]:my-4 [&_iframe]:w-full [&_iframe]:max-w-full [&_iframe]:aspect-video [&_iframe]:h-auto [&_iframe]:rounded-xl',
  // Tables — bordered cells; scroll within their own box on narrow screens.
  '[&_table]:my-3 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto',
  '[&_th]:border [&_th]:border-border [&_th]:bg-muted/50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold',
  '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1',
].join(' ')
