/**
 * HTML sanitiser for user-authored rich text (memos, training blocks, etc.).
 *
 * Memo and training content blocks are stored as HTML strings produced by a
 * contentEditable + `document.execCommand` editor. Without sanitisation a
 * malicious admin or paste-from-Word can land `<script>` / `<img onerror>` /
 * `javascript:` URLs in the DB, which would execute every time the memo is
 * rendered with `dangerouslySetInnerHTML`.
 *
 * We allow only the formatting tags the editor produces. Inline event
 * handlers, scripts, styles, and `javascript:` URLs are stripped.
 */

import sanitizeHtml from 'sanitize-html'

// `private-file:` references (lib/private-files.ts) are what private uploads
// store; they never reach a browser — the API edge swaps them for signed links.
const SAFE_SCHEMES = ['http', 'https', 'mailto', 'tel', 'private-file']

const baseOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'b',
    'strong',
    'i',
    'em',
    'u',
    's',
    'strike',
    'ul',
    'ol',
    'li',
    'blockquote',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'a',
    'img',
    'span',
    'div',
    'pre',
    'code',
    'hr',
    'iframe', // for embedded video (constrained by allowedIframeHostnames below)
    // Inline-uploaded video (mp4/webm/mov from /api/upload). The src must
    // resolve to our storage URL via the schemes whitelist below; the
    // sanitizer also strips controls/poster down to attributes we allow.
    'video',
    'source',
    // Table blocks (BlockNote editor). Structure only — cell content is still
    // sanitised recursively by the tag/attribute rules above.
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    'caption',
    'colgroup',
    'col',
  ],
  allowedAttributes: {
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'style'],
    span: ['style'],
    div: ['style'],
    iframe: ['src', 'width', 'height', 'frameborder', 'allow', 'allowfullscreen', 'title'],
    video: ['src', 'controls', 'poster', 'width', 'height', 'style', 'preload'],
    source: ['src', 'type'],
    th: ['colspan', 'rowspan', 'style'],
    td: ['colspan', 'rowspan', 'style'],
    col: ['span', 'width', 'style'],
  },
  allowedSchemes: SAFE_SCHEMES,
  allowedSchemesByTag: {
    img: ['http', 'https', 'data', 'private-file'],
    video: ['http', 'https', 'private-file'],
    source: ['http', 'https', 'private-file'],
  },
  allowedSchemesAppliedToAttributes: ['href', 'src', 'cite'],
  // Restrict iframes to known-safe video providers
  allowedIframeHostnames: [
    'www.youtube.com',
    'youtube.com',
    'youtube-nocookie.com',
    'www.youtube-nocookie.com',
    'player.vimeo.com',
    'vimeo.com',
  ],
  // Whitelist a tiny subset of inline styles — colour + alignment only.
  allowedStyles: {
    '*': {
      color: [/^#(?:[0-9a-fA-F]{3}){1,2}$/, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/],
      'background-color': [/^#(?:[0-9a-fA-F]{3}){1,2}$/, /^rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)$/],
      'text-align': [/^(left|right|center|justify)$/],
      'font-weight': [/^(normal|bold|\d{3})$/],
    },
  },
  // Drop event handler attributes and on* outright (default behaviour, made
  // explicit for the reviewer)
  disallowedTagsMode: 'discard',
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        // External links open safely
        rel: 'noopener noreferrer nofollow',
        target: attribs.target === '_blank' ? '_blank' : (attribs.target ?? '_self'),
      },
    }),
  },
}

/**
 * Sanitise a single HTML string. Returns an empty string for non-string input.
 */
export function sanitizeHtmlString(input: unknown): string {
  if (typeof input !== 'string') return ''
  if (input.length === 0) return ''
  return sanitizeHtml(input, baseOptions)
}

/**
 * Sanitise the `content` field of a memo (a single HTML string).
 */
export function sanitizeMemoHtml(input: unknown): string {
  return sanitizeHtmlString(input)
}

/**
 * Sanitise the `blocks` array of a memo. Each block has a `content` field
 * that may contain HTML — strip everything else through to preserve block
 * shape (id, type, title).
 */
export function sanitizeMemoBlocks(input: unknown): unknown[] {
  if (!Array.isArray(input)) return []
  return input.map((block) => {
    if (!block || typeof block !== 'object') return block
    const b = block as Record<string, unknown>
    if (typeof b.content === 'string') {
      return { ...b, content: sanitizeHtmlString(b.content) }
    }
    return b
  })
}

/**
 * Sanitise training-material blocks (same shape as memo blocks).
 */
export function sanitizeTrainingBlocks(input: unknown): unknown[] {
  return sanitizeMemoBlocks(input)
}
